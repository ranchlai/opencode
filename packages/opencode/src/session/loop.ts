import { Instance } from "@/project/instance"
import { SessionID } from "./schema"
import { Log } from "@/util/log"
import type { MessageV2 } from "./message-v2"
import { Config } from "@/config/config"
import { Database, eq } from "../storage/db"
import { LoopTable } from "./session.sql"
import { $ } from "bun"

export namespace SessionLoop {
  const log = Log.create({ service: "session.loop" })

  export const DONE = "LOOP_DONE"
  export const BLOCKED = "LOOP_BLOCKED"

  const OUTPUT_MAX = 4_000

  export type Info = {
    goal: string
    started: number
    deadline?: number
    max?: number
    rounds: number
    verify: string[]
  }

  export type Parsed =
    | { kind: "stop" }
    | {
        kind: "start"
        goal: string
        deadline?: number
        max?: number
      }

  const UNIT: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }

  const state = Instance.state(() => new Map<string, Info>())

  export function parse(raw: string): Parsed {
    const text = raw.trim()
    if (!text || text === "stop" || text === "cancel" || text === "end") {
      return { kind: "stop" }
    }

    const parts = text.split(/\s+/).filter(Boolean)
    let deadline: number | undefined
    let max: number | undefined
    let i = 0

    while (i < parts.length) {
      const token = parts[i]!
      const dur = token.match(/^(\d+)([smhd])$/i)
      if (dur) {
        const amount = Number(dur[1])
        const ms = UNIT[dur[2]!.toLowerCase()]
        if (ms) deadline = Date.now() + amount * ms
        i++
        continue
      }
      if (/^\d+$/.test(token) && i === 0) {
        max = Number(token)
        i++
        continue
      }
      break
    }

    const goal = parts.slice(i).join(" ").trim()
    if (!goal) return { kind: "stop" }
    return { kind: "start", goal, deadline, max }
  }

  export function ended(text: string) {
    return text.includes(DONE) || text.includes(BLOCKED)
  }

  export function assistantText(msg?: MessageV2.WithParts) {
    if (!msg) return ""
    return msg.parts.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n")
  }

  export function nudge(info: Info) {
    const lines = [
      "Autonomous loop still active. Do not wait for the user.",
      `Round ${info.rounds + 1}${info.max ? ` / ${info.max}` : ""}.`,
      info.deadline ? `Deadline: ${new Date(info.deadline).toISOString()}.` : "",
      "",
      "Original goal:",
      info.goal,
      "",
      "Continue the next concrete step toward the goal.",
      "Use todos. Prefer editing existing files. Keep working until the goal is met.",
      `When fully complete, reply with ${DONE} and a short summary.`,
      `If you are blocked and need the user, reply with ${BLOCKED} and what you need.`,
    ]
    if (info.verify.length) {
      lines.push(
        "",
        `${DONE} is accepted only after these commands exit 0:`,
        ...info.verify.map((cmd) => `- ${cmd}`),
      )
    }
    return lines.filter(Boolean).join("\n")
  }

  function fromRow(row: typeof LoopTable.$inferSelect): Info {
    return {
      goal: row.goal,
      started: row.started,
      deadline: row.deadline ?? undefined,
      max: row.max ?? undefined,
      rounds: row.rounds,
      verify: row.verify,
    }
  }

  function save(sessionID: SessionID, info: Info) {
    Database.use((db) => {
      db.insert(LoopTable)
        .values({
          session_id: sessionID,
          goal: info.goal,
          started: info.started,
          deadline: info.deadline,
          max: info.max,
          rounds: info.rounds,
          verify: info.verify,
        })
        .onConflictDoUpdate({
          target: LoopTable.session_id,
          set: {
            goal: info.goal,
            started: info.started,
            deadline: info.deadline,
            max: info.max,
            rounds: info.rounds,
            verify: info.verify,
          },
        })
        .run()
    })
  }

  function clear(sessionID: SessionID) {
    Database.use((db) => db.delete(LoopTable).where(eq(LoopTable.session_id, sessionID)).run())
  }

  function load(sessionID: SessionID) {
    const row = Database.use((db) => db.select().from(LoopTable).where(eq(LoopTable.session_id, sessionID)).get())
    if (!row) return
    return fromRow(row)
  }

  export function get(sessionID: SessionID) {
    const data = state()
    const cached = data.get(sessionID)
    if (cached) return cached
    const info = load(sessionID)
    if (!info) return
    data.set(sessionID, info)
    return info
  }

  export async function start(
    sessionID: SessionID,
    input: {
      goal: string
      deadline?: number
      max?: number
      started?: number
      verify?: string[]
    },
  ) {
    const verify = input.verify !== undefined ? input.verify : ((await Config.get()).loop?.verify ?? [])
    const info: Info = {
      goal: input.goal,
      started: input.started ?? Date.now(),
      deadline: input.deadline,
      max: input.max,
      rounds: 0,
      verify,
    }
    state().set(sessionID, info)
    save(sessionID, info)
    log.info("loop start", { sessionID, deadline: info.deadline, max: info.max, verify: info.verify.length })
    return info
  }

  export function stop(sessionID: SessionID) {
    const had = state().delete(sessionID) || !!load(sessionID)
    clear(sessionID)
    if (!had) return
    log.info("loop stop", { sessionID })
  }

  function finish(sessionID: SessionID, reason: string) {
    state().delete(sessionID)
    clear(sessionID)
    log.info("loop finished", { sessionID, reason })
  }

  function clip(text: string) {
    if (text.length <= OUTPUT_MAX) return text
    return text.slice(text.length - OUTPUT_MAX)
  }

  async function run(cmd: string) {
    const result = await $`${{ raw: cmd }}`.cwd(Instance.directory).quiet().nothrow()
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    }
  }

  export async function check(cmds: string[]) {
    if (!cmds.length) return
    for (const cmd of cmds) {
      log.info("loop verify", { cmd })
      const result = await run(cmd)
      if (result.code === 0) continue
      const body = clip([result.stdout, result.stderr].filter(Boolean).join("\n").trim())
      return [
        `Verification failed — ${DONE} was not accepted.`,
        `Command: ${cmd}`,
        `Exit: ${result.code}`,
        body ? `Output:\n${body}` : "Output: (empty)",
        "",
        "Fix the failures, then reply with LOOP_DONE again when the goal is complete.",
        `If you cannot fix this without the user, reply with ${BLOCKED}.`,
      ].join("\n")
    }
  }

  export async function tick(sessionID: SessionID, assistant?: MessageV2.WithParts) {
    const info = get(sessionID)
    if (!info) return

    const data = state()
    const text = assistantText(assistant)

    if (text.includes(BLOCKED)) {
      finish(sessionID, "blocked")
      return
    }

    if (text.includes(DONE)) {
      const fail = await check(info.verify)
      if (fail) {
        info.rounds += 1
        data.set(sessionID, info)
        save(sessionID, info)
        log.info("loop verify failed", { sessionID, rounds: info.rounds })
        return [
          fail,
          "",
          "Original goal:",
          info.goal,
          info.verify.length ? `\nRequired checks:\n${info.verify.map((cmd) => `- ${cmd}`).join("\n")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      }
      finish(sessionID, "done")
      return
    }

    if (info.deadline && Date.now() >= info.deadline) {
      finish(sessionID, "deadline")
      return
    }

    if (info.max !== undefined && info.rounds >= info.max) {
      finish(sessionID, "max")
      return
    }

    info.rounds += 1
    data.set(sessionID, info)
    save(sessionID, info)
    log.info("loop continue", { sessionID, rounds: info.rounds, max: info.max })
    return nudge(info)
  }
}
