import { SessionLoop } from "./loop"

export namespace HardLoop {
  export type Info = SessionLoop.Info

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
    run: (text: string) => Promise<string>,
    abort?: AbortSignal,
  ): Promise<Result> {
    let extra: string | undefined
    while (true) {
      const hit = budget(info)
      if (hit) return { kind: hit.kind, rounds: info.rounds }
      if (abort?.aborted) return { kind: "abort", rounds: info.rounds }

      const text = await run(prompt(info, extra))
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
}
