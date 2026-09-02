import { SessionLoop } from "./loop"
import { SessionID } from "./schema"
import { Instance } from "@/project/instance"
import { Config } from "@/config/config"
import { Process } from "@/util/process"
import { Log } from "@/util/log"

export namespace HardLoop {
  const log = Log.create({ service: "session.hard-loop" })
  const DEFAULT_MAX = 50

  export type Info = SessionLoop.Info

  type Job = {
    info: Info
    abort: AbortController
  }

  const jobs = Instance.state(() => new Map<string, Job>())

  export type Verdict =
    | { kind: "done" }
    | { kind: "blocked" }
    | { kind: "deadline" }
    | { kind: "max" }
    | { kind: "continue"; extra?: string }

  export function parse(raw: string) {
    return SessionLoop.parse(raw)
  }

  export function create(input: {
    goal: string
    deadline?: number
    max?: number
    verify?: string[]
    started?: number
  }): Info {
    return {
      goal: input.goal,
      started: input.started ?? Date.now(),
      deadline: input.deadline,
      max: input.max,
      rounds: 0,
      verify: input.verify ?? [],
    }
  }

  export function prompt(info: Info, extra?: string) {
    const lines = [
      "You are in a hard loop. This is a FRESH session — there is no prior chat.",
      "Inspect the repository first. Files, git history, and test output are your only memory.",
      `Round ${info.rounds + 1}${info.max ? ` / ${info.max}` : ""}.`,
      info.deadline ? `Deadline: ${new Date(info.deadline).toISOString()}.` : "",
      "",
      "Original goal:",
      info.goal,
      "",
      "Make concrete progress on the next unfinished part of the goal.",
      "Prefer editing existing files. Use todos.",
      `When the goal is fully complete, reply with ${SessionLoop.DONE} and a short summary.`,
      `If you are blocked and need the user, reply with ${SessionLoop.BLOCKED} and what you need.`,
    ]
    if (info.verify.length) {
      lines.push(
        "",
        `${SessionLoop.DONE} is accepted only after these commands exit 0:`,
        ...info.verify.map((cmd) => `- ${cmd}`),
      )
    }
    if (extra) {
      lines.push("", extra)
    }
    return lines.filter(Boolean).join("\n")
  }

  export function budget(info: Info): Extract<Verdict, { kind: "deadline" | "max" }> | undefined {
    if (info.deadline && Date.now() >= info.deadline) return { kind: "deadline" }
    if (info.max !== undefined && info.rounds >= info.max) return { kind: "max" }
  }

  export async function decide(
    info: Info,
    text: string,
  ): Promise<Extract<Verdict, { kind: "done" | "blocked" | "continue" }>> {
    if (text.includes(SessionLoop.BLOCKED)) return { kind: "blocked" }
    if (text.includes(SessionLoop.DONE)) {
      const fail = await SessionLoop.check(info.verify)
      if (fail) return { kind: "continue", extra: fail }
      return { kind: "done" }
    }
    return { kind: "continue" }
  }

  export type Result = {
    kind: "done" | "blocked" | "deadline" | "max" | "abort"
    rounds: number
  }

  export async function drive(
    info: Info,
    run: (text: string, abort?: AbortSignal) => Promise<string>,
    abort?: AbortSignal,
  ): Promise<Result> {
    let extra: string | undefined
    while (true) {
      const hit = budget(info)
      if (hit) return { kind: hit.kind, rounds: info.rounds }
      if (abort?.aborted) return { kind: "abort", rounds: info.rounds }

      const text = await run(prompt(info, extra), abort)
      extra = undefined
      info.rounds += 1

      if (abort?.aborted) return { kind: "abort", rounds: info.rounds }

      const verdict = await decide(info, text)
      if (verdict.kind === "done" || verdict.kind === "blocked") {
        return { kind: verdict.kind, rounds: info.rounds }
      }
      extra = verdict.extra
    }
  }

  export function get(id: SessionID) {
    return jobs().get(id)?.info
  }

  export function stop(id: SessionID) {
    const job = jobs().get(id)
    if (!job) return
    job.abort.abort()
    jobs().delete(id)
    log.info("hard-loop stop", { sessionID: id })
  }

  export async function start(
    id: SessionID,
    input: {
      goal: string
      deadline?: number
      max?: number
      verify?: string[]
      started?: number
    },
    run: (text: string, abort?: AbortSignal) => Promise<string>,
  ) {
    stop(id)
    const verify = input.verify !== undefined ? input.verify : ((await Config.get()).loop?.verify ?? [])
    const info = create({
      goal: input.goal,
      deadline: input.deadline,
      max: input.max ?? (input.deadline ? undefined : DEFAULT_MAX),
      verify,
      started: input.started,
    })
    const abort = new AbortController()
    jobs().set(id, { info, abort })
    log.info("hard-loop start", { sessionID: id, deadline: info.deadline, max: info.max, verify: info.verify.length })
    return drive(info, run, abort.signal).finally(() => {
      const cur = jobs().get(id)
      if (cur?.abort === abort) jobs().delete(id)
    })
  }

  export function exe() {
    const entry = process.argv[1]
    if (entry && /\.(c|m)?(t|j)sx?$/.test(entry)) return [process.execPath, entry]
    return [process.execPath]
  }

  export async function exec(opts: {
    cwd: string
    text: string
    model?: string
    agent?: string
    variant?: string
    files?: string[]
    title?: string
    abort?: AbortSignal
    echo?: boolean
  }) {
    const cmd = [
      ...exe(),
      "run",
      "--dir",
      opts.cwd,
      "--title",
      opts.title ?? "hard-loop",
      ...(opts.model ? ["--model", opts.model] : []),
      ...(opts.agent ? ["--agent", opts.agent] : []),
      ...(opts.variant ? ["--variant", opts.variant] : []),
      ...(opts.files ?? []).flatMap((file) => ["-f", file]),
      opts.text,
    ]
    if (!opts.echo) {
      const out = await Process.run(cmd, { cwd: opts.cwd, abort: opts.abort, nothrow: true })
      return { code: out.code, text: Buffer.concat([out.stdout, out.stderr]).toString() }
    }
    const child = Process.spawn(cmd, {
      cwd: opts.cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      abort: opts.abort,
    })
    const chunks: Buffer[] = []
    const pump = (src: NodeJS.ReadableStream | null, dest: NodeJS.WriteStream) => {
      if (!src) return
      return new Promise<void>((resolve, reject) => {
        src.on("data", (buf: Buffer) => {
          dest.write(buf)
          chunks.push(buf)
        })
        src.on("end", resolve)
        src.on("error", reject)
      })
    }
    const [code] = await Promise.all([child.exited, pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)])
    return { code, text: Buffer.concat(chunks).toString() }
  }
}
