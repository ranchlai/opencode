import { Instance } from "@/project/instance"
import { SessionID } from "./schema"
import { Log } from "@/util/log"
import type { MessageV2 } from "./message-v2"
import { Database, eq, and, asc } from "../storage/db"
import { RepeatTable, RepeatItemTable } from "./session.sql"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Glob } from "../util/glob"
import path from "path"
import z from "zod"

export namespace SessionRepeat {
  const log = Log.create({ service: "session.repeat" })

  export const READY = "REPEAT_READY"
  export const BLOCKED = "REPEAT_BLOCKED"
  export const ITEM_DONE = "REPEAT_ITEM_DONE"
  export const ITEM_FAIL = "REPEAT_ITEM_FAIL"

  export const INLINE_MAX = 50
  export const FAIL_MAX = 20
  export const SUMMARY_MAX = 500

  export const Phase = z.enum(["prepare", "running", "done", "stopped", "blocked"])
  export type Phase = z.infer<typeof Phase>

  export const Counts = z
    .object({
      pending: z.number(),
      running: z.number(),
      ok: z.number(),
      fail: z.number(),
      total: z.number(),
    })
    .meta({ ref: "RepeatCounts" })
  export type Counts = z.infer<typeof Counts>

  export const Snap = z
    .object({
      sessionID: SessionID.zod,
      label: z.string(),
      phase: Phase,
      goal: z.string(),
      counts: Counts,
    })
    .meta({ ref: "RepeatSnap" })
  export type Snap = z.infer<typeof Snap>

  export const Event = {
    Updated: BusEvent.define("session.repeat.updated", Snap),
    Cleared: BusEvent.define("session.repeat.cleared", z.object({ sessionID: SessionID.zod })),
  }

  export type Info = {
    goal: string
    template?: string
    path?: string
    phase: Phase
    cursor: number
    rounds: number
    started: number
    deadline?: number
    max?: number
  }

  export type Parsed =
    | { kind: "stop" }
    | {
        kind: "start"
        goal: string
        deadline?: number
        max?: number
      }

  export type Source = {
    file?: string
    glob?: string
    items?: string[]
    prompt?: string
  }

  export type Outcome = {
    text: string
    child?: SessionID
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

  export function assistantText(msg?: MessageV2.WithParts) {
    if (!msg) return ""
    return msg.parts.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("\n")
  }

  export function parseReady(text: string): Source | undefined {
    const line = text.split("\n").find((item) => item.includes(READY))
    if (!line) return
    const rest = line.replace(/.*REPEAT_READY/, "").trim()
    if (!rest) return {}
    const file = rest.match(/file:\s*(\S+)/)
    if (file) return { file: file[1] }
    const glob = rest.match(/glob:\s*(\S+)/)
    if (glob) return { glob: glob[1] }
    if (/[*?\[]/.test(rest)) return { glob: rest }
    return { file: rest }
  }

  export function parseItem(text: string): { ok: boolean; summary: string } {
    if (!text.trim()) return { ok: false, summary: "empty result" }
    const fail = marker(text, ITEM_FAIL)
    if (fail !== undefined) return { ok: false, summary: clip(fail) }
    const done = marker(text, ITEM_DONE)
    if (done !== undefined) return { ok: true, summary: clip(done) }
    const last = text.trim().split("\n").filter(Boolean).at(-1) ?? text.trim()
    return { ok: true, summary: clip(last) }
  }

  function marker(text: string, token: string) {
    const idx = text.indexOf(token)
    if (idx < 0) return
    return text
      .slice(idx + token.length)
      .trim()
      .split("\n")[0]
      ?.trim()
  }

  export function job(info: Info, input: string) {
    const raw = info.template ?? info.goal
    const filled = raw.replaceAll("$ITEM", input).replaceAll("$INPUT", input)
    const tail = [
      `When finished, reply with ${ITEM_DONE} and a one-line summary.`,
      `If you cannot complete this item, reply with ${ITEM_FAIL} and a one-line reason.`,
    ]
    if (raw.includes("$ITEM") || raw.includes("$INPUT")) {
      return ["You are completing one unit of a repeated job. Do only this item.", "", filled, "", ...tail].join("\n")
    }
    return [
      "You are completing one unit of a repeated job. Do only this item. Do not look for other items.",
      "",
      "## Job",
      filled,
      "",
      "## This item",
      input,
      "",
      ...tail,
    ].join("\n")
  }

  export function nudge(info: Info) {
    return [
      "Repeat prepare is still active. Do not wait for the user.",
      `Round ${info.rounds + 1}.`,
      info.deadline ? `Deadline: ${new Date(info.deadline).toISOString()}.` : "",
      "",
      "Original job:",
      info.goal,
      "",
      "Enumerate every input. Write them to a JSONL file (one item per line) or use a glob.",
      "Never paste the full list into chat — that blows the context window.",
      "Then call the repeat tool with action ready, or reply with REPEAT_READY and a file path or glob.",
      `If you cannot proceed without the user, reply with ${BLOCKED}.`,
    ]
      .filter(Boolean)
      .join("\n")
  }

  function fromRow(row: typeof RepeatTable.$inferSelect): Info {
    return {
      goal: row.goal,
      template: row.template ?? undefined,
      path: row.items_path ?? undefined,
      phase: Phase.parse(row.phase),
      cursor: row.cursor,
      rounds: row.rounds,
      started: row.started,
      deadline: row.deadline ?? undefined,
      max: row.max ?? undefined,
    }
  }

  function save(sessionID: SessionID, info: Info) {
    Database.use((db) => {
      db.insert(RepeatTable)
        .values({
          session_id: sessionID,
          goal: info.goal,
          template: info.template,
          items_path: info.path,
          phase: info.phase,
          cursor: info.cursor,
          rounds: info.rounds,
          started: info.started,
          deadline: info.deadline,
          max: info.max,
        })
        .onConflictDoUpdate({
          target: RepeatTable.session_id,
          set: {
            goal: info.goal,
            template: info.template,
            items_path: info.path,
            phase: info.phase,
            cursor: info.cursor,
            rounds: info.rounds,
            started: info.started,
            deadline: info.deadline,
            max: info.max,
          },
        })
        .run()
    })
    publish(sessionID)
  }

  function clear(sessionID: SessionID) {
    Database.use((db) => {
      db.delete(RepeatItemTable).where(eq(RepeatItemTable.session_id, sessionID)).run()
      db.delete(RepeatTable).where(eq(RepeatTable.session_id, sessionID)).run()
    })
  }

  function load(sessionID: SessionID) {
    const row = Database.use((db) => db.select().from(RepeatTable).where(eq(RepeatTable.session_id, sessionID)).get())
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

  export function counts(sessionID: SessionID): Counts {
    const rows = Database.use((db) =>
      db.select({ status: RepeatItemTable.status }).from(RepeatItemTable).where(eq(RepeatItemTable.session_id, sessionID)).all(),
    )
    return rows.reduce<Counts>(
      (acc, row) => {
        if (row.status === "pending") acc.pending++
        else if (row.status === "running") acc.running++
        else if (row.status === "ok") acc.ok++
        else if (row.status === "fail") acc.fail++
        acc.total++
        return acc
      },
      { pending: 0, running: 0, ok: 0, fail: 0, total: 0 },
    )
  }

  export function label(sessionID: SessionID) {
    const info = get(sessionID)
    if (!info) return
    const tally = counts(sessionID)
    const done = tally.ok + tally.fail
    if (info.phase === "prepare") return `repeat prepare`
    if (info.phase === "running") {
      const fail = tally.fail ? ` · ${tally.fail} fail` : ""
      return `repeat ${done}/${tally.total}${fail}`
    }
    return `repeat ${info.phase} · ${tally.ok} ok · ${tally.fail} fail`
  }

  export function snap(sessionID: SessionID): Snap | undefined {
    const info = get(sessionID)
    if (!info) return
    const text = label(sessionID)
    if (!text) return
    return {
      sessionID,
      label: text,
      phase: info.phase,
      goal: info.goal,
      counts: counts(sessionID),
    }
  }

  export function list() {
    const rows = Database.use((db) => db.select().from(RepeatTable).all())
    return rows.flatMap((row) => {
      const info = fromRow(row)
      if (info.phase !== "prepare" && info.phase !== "running") return []
      state().set(row.session_id, info)
      const item = snap(row.session_id)
      return item ? [item] : []
    })
  }

  function publish(sessionID: SessionID) {
    const item = snap(sessionID)
    if (!item) return
    Bus.publish(Event.Updated, item)
  }

  export function start(
    sessionID: SessionID,
    input: {
      goal: string
      deadline?: number
      max?: number
      started?: number
      template?: string
    },
  ) {
    const info: Info = {
      goal: input.goal,
      template: input.template,
      phase: "prepare",
      cursor: 0,
      rounds: 0,
      started: input.started ?? Date.now(),
      deadline: input.deadline,
      max: input.max,
    }
    state().set(sessionID, info)
    save(sessionID, info)
    log.info("repeat start", { sessionID, deadline: info.deadline, max: info.max })
    return info
  }

  export function stop(sessionID: SessionID) {
    const info = get(sessionID)
    const child = running(sessionID)
    const had = state().delete(sessionID) || !!info
    if (child) {
      import("./prompt").then((mod) => mod.SessionPrompt.cancel(child)).catch(() => undefined)
    }
    clear(sessionID)
    if (!had) return
    Bus.publish(Event.Cleared, { sessionID })
    log.info("repeat stop", { sessionID })
  }

  function finish(sessionID: SessionID, phase: Phase) {
    const info = get(sessionID)
    if (!info) return
    info.phase = phase
    state().set(sessionID, info)
    save(sessionID, info)
    log.info("repeat finished", { sessionID, phase })
  }

  function clip(text: string) {
    const trimmed = text.trim()
    if (trimmed.length <= SUMMARY_MAX) return trimmed
    return trimmed.slice(0, SUMMARY_MAX)
  }

  function decode(line: string) {
    if (!line.startsWith("{")) return line
    const parsed = JSON.parse(line) as { input?: unknown; path?: unknown }
    if (typeof parsed.input === "string") return parsed.input
    if (typeof parsed.path === "string") return parsed.path
    return line
  }

  function resolve(file: string) {
    return path.isAbsolute(file) ? file : path.join(Instance.directory, file)
  }

  export async function lines(src: Source) {
    if (src.items) {
      if (src.items.length > INLINE_MAX) {
        throw new Error(
          `Inline items are capped at ${INLINE_MAX}. Write a JSONL file or pass a glob so the list stays out of the LLM context.`,
        )
      }
      return src.items.map((item) => item.trim()).filter(Boolean)
    }
    if (src.file) {
      const file = Bun.file(resolve(src.file))
      if (!(await file.exists())) throw new Error(`Repeat items file not found: ${src.file}`)
      return (await file.text())
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => decode(line))
        .filter(Boolean)
    }
    if (src.glob) {
      return (await Glob.scan(src.glob, { cwd: Instance.directory })).sort()
    }
    throw new Error("repeat ready needs file, glob, or items")
  }

  function write(sessionID: SessionID, inputs: string[]) {
    Database.transaction((db) => {
      db.delete(RepeatItemTable).where(eq(RepeatItemTable.session_id, sessionID)).run()
      const size = 100
      const chunks = Array.from({ length: Math.ceil(inputs.length / size) }, (_, i) => inputs.slice(i * size, i * size + size))
      for (const [idx, chunk] of chunks.entries()) {
        db.insert(RepeatItemTable)
          .values(
            chunk.map((input, offset) => ({
              session_id: sessionID,
              position: idx * size + offset,
              input,
              status: "pending",
            })),
          )
          .run()
      }
    })
  }

  function pending(sessionID: SessionID) {
    return Database.use((db) =>
      db
        .select()
        .from(RepeatItemTable)
        .where(and(eq(RepeatItemTable.session_id, sessionID), eq(RepeatItemTable.status, "pending")))
        .orderBy(asc(RepeatItemTable.position))
        .get(),
    )
  }

  function running(sessionID: SessionID) {
    const row = Database.use((db) =>
      db
        .select()
        .from(RepeatItemTable)
        .where(and(eq(RepeatItemTable.session_id, sessionID), eq(RepeatItemTable.status, "running")))
        .get(),
    )
    return row?.child_id ?? undefined
  }

  function patch(sessionID: SessionID, position: number, input: { status: string; summary?: string; child?: SessionID }) {
    Database.use((db) => {
      db.update(RepeatItemTable)
        .set({
          status: input.status,
          summary: input.summary,
          child_id: input.child,
        })
        .where(and(eq(RepeatItemTable.session_id, sessionID), eq(RepeatItemTable.position, position)))
        .run()
    })
  }

  export async function ready(sessionID: SessionID, src: Source) {
    const info = get(sessionID)
    if (!info) throw new Error("no repeat is active in this session — start with /repeat")
    const inputs = await lines(src)
    const capped = info.max !== undefined ? inputs.slice(0, info.max) : inputs
    if (!capped.length) return "No items found. Write a JSONL file or pass a glob, then REPEAT_READY."
    info.template = src.prompt ?? info.template
    info.path = src.file ?? src.glob
    info.phase = "running"
    info.cursor = 0
    write(sessionID, capped)
    state().set(sessionID, info)
    save(sessionID, info)
    log.info("repeat ready", { sessionID, total: capped.length, path: info.path })
  }

  export function status(sessionID: SessionID) {
    const info = get(sessionID)
    if (!info) return { active: false as const }
    const tally = counts(sessionID)
    const fails = Database.use((db) =>
      db
        .select()
        .from(RepeatItemTable)
        .where(and(eq(RepeatItemTable.session_id, sessionID), eq(RepeatItemTable.status, "fail")))
        .orderBy(asc(RepeatItemTable.position))
        .limit(FAIL_MAX)
        .all(),
    )
    return {
      active: true as const,
      label: label(sessionID),
      phase: info.phase,
      goal: info.goal,
      counts: tally,
      failures: fails.map((row) => ({
        position: row.position,
        input: row.input,
        summary: row.summary ?? undefined,
      })),
    }
  }

  export function report(sessionID: SessionID) {
    const info = get(sessionID)
    if (!info) return
    const tally = counts(sessionID)
    const fails = Database.use((db) =>
      db
        .select()
        .from(RepeatItemTable)
        .where(and(eq(RepeatItemTable.session_id, sessionID), eq(RepeatItemTable.status, "fail")))
        .orderBy(asc(RepeatItemTable.position))
        .limit(FAIL_MAX)
        .all(),
    )
    const extra = tally.fail > fails.length ? `\n…and ${tally.fail - fails.length} more failures.` : ""
    const list = fails.length
      ? [
          "",
          "Failures:",
          ...fails.map((row) => `- ${row.position + 1}. ${row.input}${row.summary ? `: ${row.summary}` : ""}`),
          extra,
        ]
      : []
    return [
      `Repeat ${info.phase}: ${tally.ok} ok, ${tally.fail} failed, ${tally.total} total.`,
      `Job: ${info.goal}`,
      ...list,
    ]
      .filter(Boolean)
      .join("\n")
  }

  export async function tick(sessionID: SessionID, assistant?: MessageV2.WithParts) {
    const info = get(sessionID)
    if (!info) return
    if (info.phase !== "prepare") return

    const data = state()
    const text = assistantText(assistant)

    if (text.includes(BLOCKED)) {
      finish(sessionID, "blocked")
      return
    }

    if (text.includes(READY)) {
      const src = parseReady(text) ?? {}
      const queued = counts(sessionID).total > 0
      if (!src.file && !src.glob && !src.items?.length && !queued) {
        return "REPEAT_READY needs a file path, a glob, or a prior repeat tool ready call that loaded items."
      }
      if (src.file || src.glob || src.items?.length) {
        const err = await ready(sessionID, src).then(
          (msg) => msg,
          (error) => (error instanceof Error ? error.message : String(error)),
        )
        if (err) return err
        return
      }
      info.phase = "running"
      data.set(sessionID, info)
      save(sessionID, info)
      return
    }

    if (info.deadline && Date.now() >= info.deadline) {
      finish(sessionID, "stopped")
      return report(sessionID)
    }

    info.rounds += 1
    data.set(sessionID, info)
    save(sessionID, info)
    log.info("repeat prepare", { sessionID, rounds: info.rounds })
    return nudge(info)
  }

  async function caller(sessionID: SessionID) {
    const { MessageV2 } = await import("./message-v2")
    for await (const item of MessageV2.stream(sessionID)) {
      if (item.info.role === "user" && item.info.model) {
        return { agent: item.info.agent, model: item.info.model }
      }
    }
    return { agent: "build", model: undefined }
  }

  async function spawn(
    sessionID: SessionID,
    input: string,
    text: string,
    abort?: AbortSignal,
    bind?: (child: SessionID) => void,
  ): Promise<Outcome> {
    const { Session } = await import(".")
    const { SessionPrompt } = await import("./prompt")
    const { MessageID } = await import("./schema")
    const { Config } = await import("../config/config")
    const parent = await caller(sessionID)
    const cfg = await Config.get()
    const session = await Session.create({
      parentID: sessionID,
      title: `repeat ${clip(input).slice(0, 40)}`,
      permission: [
        { permission: "todowrite", pattern: "*", action: "deny" },
        { permission: "todoread", pattern: "*", action: "deny" },
        { permission: "task", pattern: "*", action: "deny" },
        { permission: "team", pattern: "*", action: "deny" },
        { permission: "repeat", pattern: "*", action: "deny" },
        ...(cfg.experimental?.primary_tools?.map((t) => ({
          pattern: "*",
          action: "allow" as const,
          permission: t,
        })) ?? []),
      ],
    })
    bind?.(session.id)

    const cancel = () => SessionPrompt.cancel(session.id)
    abort?.addEventListener("abort", cancel)
    const result = await SessionPrompt.prompt({
      messageID: MessageID.ascending(),
      sessionID: session.id,
      ...(parent.model ? { model: parent.model } : {}),
      agent: parent.agent,
      tools: {
        todowrite: false,
        todoread: false,
        task: false,
        team: false,
        repeat: false,
        ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((t) => [t, false])),
      },
      parts: [{ type: "text", text }],
    }).then(
      (msg) => msg.parts.findLast((part) => part.type === "text")?.text ?? "",
      (err) => `${ITEM_FAIL} ${err instanceof Error ? err.message : String(err)}`,
    )
    abort?.removeEventListener("abort", cancel)
    return { text: result, child: session.id }
  }

  export async function runNext(
    sessionID: SessionID,
    abort?: AbortSignal,
    execute?: (input: string, prompt: string) => Promise<Outcome>,
  ): Promise<"continue" | "done"> {
    const info = get(sessionID)
    if (!info || info.phase !== "running") return "done"
    if (abort?.aborted) {
      finish(sessionID, "stopped")
      return "done"
    }
    if (info.deadline && Date.now() >= info.deadline) {
      finish(sessionID, "stopped")
      return "done"
    }

    const row = pending(sessionID)
    if (!row) {
      finish(sessionID, "done")
      return "done"
    }

    const tally = counts(sessionID)
    if (info.max !== undefined && tally.ok + tally.fail >= info.max) {
      finish(sessionID, "done")
      return "done"
    }

    const text = job(info, row.input)
    patch(sessionID, row.position, { status: "running" })
    info.cursor = row.position
    state().set(sessionID, info)
    save(sessionID, info)
    log.info("repeat item", { sessionID, position: row.position, total: tally.total })

    const run =
      execute ??
      ((item, prompt) =>
        spawn(sessionID, item, prompt, abort, (child) => {
          patch(sessionID, row.position, { status: "running", child })
        }))
    const outcome = await run(row.input, text)
    const still = get(sessionID)
    if (!still || still.phase !== "running") return "done"

    const parsed = parseItem(outcome.text)
    patch(sessionID, row.position, {
      status: parsed.ok ? "ok" : "fail",
      summary: parsed.summary,
      child: outcome.child,
    })
    if (parsed.ok && outcome.child) {
      const { Session } = await import(".")
      await Session.setArchived({ sessionID: outcome.child, time: Date.now() }).catch(() => undefined)
    }
    publish(sessionID)

    if (abort?.aborted) {
      finish(sessionID, "stopped")
      return "done"
    }
    if (!pending(sessionID)) {
      finish(sessionID, "done")
      return "done"
    }
    return "continue"
  }
}
