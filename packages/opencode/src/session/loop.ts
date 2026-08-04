import { Instance } from "@/project/instance"
import { SessionID } from "./schema"
import { Log } from "@/util/log"
import type { MessageV2 } from "./message-v2"

export namespace SessionLoop {
  const log = Log.create({ service: "session.loop" })

  export const DONE = "LOOP_DONE"
  export const BLOCKED = "LOOP_BLOCKED"

  export type Info = {
    goal: string
    started: number
    deadline?: number
    max?: number
    rounds: number
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
    return [
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
      .filter(Boolean)
      .join("\n")
  }

  export function get(sessionID: SessionID) {
    return state().get(sessionID)
  }

  export function start(
    sessionID: SessionID,
    input: {
      goal: string
      deadline?: number
      max?: number
      started?: number
    },
  ) {
    const info: Info = {
      goal: input.goal,
      started: input.started ?? Date.now(),
      deadline: input.deadline,
      max: input.max,
      rounds: 0,
    }
    state().set(sessionID, info)
    log.info("loop start", { sessionID, deadline: info.deadline, max: info.max })
    return info
  }

  export function stop(sessionID: SessionID) {
    if (!state().delete(sessionID)) return
    log.info("loop stop", { sessionID })
  }

  export function tick(sessionID: SessionID, assistant?: MessageV2.WithParts) {
    const data = state()
    const info = data.get(sessionID)
    if (!info) return

    if (ended(assistantText(assistant))) {
      data.delete(sessionID)
      log.info("loop finished", { sessionID, reason: "marker" })
      return
    }

    if (info.deadline && Date.now() >= info.deadline) {
      data.delete(sessionID)
      log.info("loop finished", { sessionID, reason: "deadline" })
      return
    }

    if (info.max !== undefined && info.rounds >= info.max) {
      data.delete(sessionID)
      log.info("loop finished", { sessionID, reason: "max" })
      return
    }

    info.rounds += 1
    data.set(sessionID, info)
    log.info("loop continue", { sessionID, rounds: info.rounds, max: info.max })
    return nudge(info)
  }
}
