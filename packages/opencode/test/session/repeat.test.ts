import { describe, expect, test } from "bun:test"
import path from "path"
import { mkdir } from "fs/promises"
import { SessionRepeat } from "../../src/session/repeat"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

const sid = SessionID.make("ses_repeat_test")

function assistant(text: string) {
  return {
    info: {} as any,
    parts: [{ type: "text" as const, text }],
  } as any
}

describe("SessionRepeat.parse", () => {
  test("stop aliases", () => {
    expect(SessionRepeat.parse("")).toEqual({ kind: "stop" })
    expect(SessionRepeat.parse("stop")).toEqual({ kind: "stop" })
    expect(SessionRepeat.parse("cancel")).toEqual({ kind: "stop" })
  })

  test("goal only", () => {
    expect(SessionRepeat.parse("translate docs")).toEqual({
      kind: "start",
      goal: "translate docs",
      deadline: undefined,
      max: undefined,
    })
  })

  test("duration budget", () => {
    const before = Date.now()
    const parsed = SessionRepeat.parse("2h translate docs")
    expect(parsed.kind).toBe("start")
    if (parsed.kind !== "start") return
    expect(parsed.goal).toBe("translate docs")
    expect(parsed.deadline).toBeGreaterThanOrEqual(before + 2 * 3_600_000)
    expect(parsed.deadline).toBeLessThanOrEqual(Date.now() + 2 * 3_600_000)
  })

  test("item cap", () => {
    expect(SessionRepeat.parse("50 docs/**/*.md")).toEqual({
      kind: "start",
      goal: "docs/**/*.md",
      deadline: undefined,
      max: 50,
    })
  })
})

describe("SessionRepeat.parseReady", () => {
  test("bare marker", () => {
    expect(SessionRepeat.parseReady("REPEAT_READY")).toEqual({})
  })

  test("file path", () => {
    expect(SessionRepeat.parseReady("REPEAT_READY queue.jsonl")).toEqual({ file: "queue.jsonl" })
  })

  test("glob", () => {
    expect(SessionRepeat.parseReady("REPEAT_READY docs/**/*.md")).toEqual({ glob: "docs/**/*.md" })
  })

  test("labeled", () => {
    expect(SessionRepeat.parseReady("REPEAT_READY file: items.jsonl")).toEqual({ file: "items.jsonl" })
    expect(SessionRepeat.parseReady("REPEAT_READY glob: src/*.ts")).toEqual({ glob: "src/*.ts" })
  })
})

describe("SessionRepeat.job and parseItem", () => {
  test("wraps item without substituting into sibling items", () => {
    const text = SessionRepeat.job({ goal: "lint", phase: "running", cursor: 0, rounds: 0, started: 0 }, "src/a.ts")
    expect(text).toContain("src/a.ts")
    expect(text).toContain("lint")
    expect(text).not.toContain("src/b.ts")
  })

  test("substitutes $ITEM", () => {
    const text = SessionRepeat.job(
      { goal: "unused", template: "fix $ITEM", phase: "running", cursor: 0, rounds: 0, started: 0 },
      "foo.ts",
    )
    expect(text).toContain("fix foo.ts")
    expect(text).not.toContain("$ITEM")
  })

  test("markers", () => {
    expect(SessionRepeat.parseItem("REPEAT_ITEM_DONE fixed lint")).toEqual({ ok: true, summary: "fixed lint" })
    expect(SessionRepeat.parseItem("REPEAT_ITEM_FAIL missing dep")).toEqual({ ok: false, summary: "missing dep" })
    expect(SessionRepeat.parseItem("")).toEqual({ ok: false, summary: "empty result" })
  })
})

describe("SessionRepeat queue", () => {
  test("ready from JSONL and glob", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "queue.jsonl"), ["docs/a.md", '{"input":"docs/b.md"}', "docs/c.md"].join("\n"))
        await mkdir(path.join(dir, "docs"), { recursive: true })
        await Bun.write(path.join(dir, "docs", "x.md"), "x")
        await Bun.write(path.join(dir, "docs", "y.md"), "y")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionRepeat.start(sid, { goal: "translate" })
        await SessionRepeat.ready(sid, { file: "queue.jsonl" })
        expect(SessionRepeat.counts(sid)).toEqual({ pending: 3, running: 0, ok: 0, fail: 0, total: 3 })
        expect(SessionRepeat.get(sid)?.phase).toBe("running")
        SessionRepeat.stop(sid)

        const other = SessionID.make("ses_repeat_glob")
        SessionRepeat.start(other, { goal: "translate" })
        await SessionRepeat.ready(other, { glob: "docs/*.md" })
        expect(SessionRepeat.counts(other).total).toBe(2)
        SessionRepeat.stop(other)
      },
    })
  })

  test("rejects huge inline arrays", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionRepeat.start(sid, { goal: "x" })
        const items = Array.from({ length: SessionRepeat.INLINE_MAX + 1 }, (_, i) => `item-${i}`)
        await expect(SessionRepeat.lines({ items })).rejects.toThrow("capped")
        SessionRepeat.stop(sid)
      },
    })
  })

  test("runNext is sequential, continues on fail, archives ok", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionRepeat.start(sid, { goal: "lint $ITEM" })
        await SessionRepeat.ready(sid, { items: ["a.ts", "b.ts", "c.ts"] })

        const seen: string[] = []
        const execute = async (input: string, prompt: string) => {
          seen.push(input)
          expect(prompt).toContain(input)
          seen.filter((item) => item !== input).forEach((other) => expect(prompt).not.toContain(other))
          if (input === "b.ts") return { text: "REPEAT_ITEM_FAIL boom" }
          return { text: `REPEAT_ITEM_DONE ok ${input}`, child: SessionID.make(`ses_child_${input}`) }
        }

        expect(await SessionRepeat.runNext(sid, undefined, execute)).toBe("continue")
        expect(await SessionRepeat.runNext(sid, undefined, execute)).toBe("continue")
        expect(await SessionRepeat.runNext(sid, undefined, execute)).toBe("done")
        expect(seen).toEqual(["a.ts", "b.ts", "c.ts"])
        expect(SessionRepeat.counts(sid)).toEqual({ pending: 0, running: 0, ok: 2, fail: 1, total: 3 })
        expect(SessionRepeat.get(sid)?.phase).toBe("done")

        const text = SessionRepeat.report(sid)!
        expect(text).toContain("2 ok")
        expect(text).toContain("1 failed")
        expect(text).toContain("b.ts")
        expect(text).not.toContain("a.ts")

        SessionRepeat.stop(sid)
      },
    })
  })

  test("prepare nudge without REPEAT_READY", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionRepeat.start(sid, { goal: "translate docs" })
        const text = await SessionRepeat.tick(sid, assistant("still looking"))
        expect(text).toContain("translate docs")
        expect(text).toContain("REPEAT_READY")
        expect(SessionRepeat.get(sid)?.phase).toBe("prepare")
        SessionRepeat.stop(sid)
      },
    })
  })

  test("REPEAT_READY from glob", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.md"), "a")
        await Bun.write(path.join(dir, "b.md"), "b")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionRepeat.start(sid, { goal: "translate" })
        const text = await SessionRepeat.tick(sid, assistant("REPEAT_READY *.md"))
        expect(text).toBeUndefined()
        expect(SessionRepeat.get(sid)?.phase).toBe("running")
        expect(SessionRepeat.counts(sid).total).toBe(2)
        SessionRepeat.stop(sid)
      },
    })
  })

  test("REPEAT_BLOCKED stops prepare", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionRepeat.start(sid, { goal: "translate" })
        const text = await SessionRepeat.tick(sid, assistant("need a token REPEAT_BLOCKED"))
        expect(text).toBeUndefined()
        expect(SessionRepeat.get(sid)?.phase).toBe("blocked")
        SessionRepeat.stop(sid)
      },
    })
  })

  test("max caps items", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionRepeat.start(sid, { goal: "x", max: 2 })
        await SessionRepeat.ready(sid, { items: ["a", "b", "c"] })
        expect(SessionRepeat.counts(sid).total).toBe(2)
        SessionRepeat.stop(sid)
      },
    })
  })

  test("status does not dump the full list", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionRepeat.start(sid, { goal: "x" })
        const items = Array.from({ length: 40 }, (_, i) => `item-${i}`)
        await SessionRepeat.ready(sid, { items })
        const result = SessionRepeat.status(sid)
        const blob = JSON.stringify(result)
        expect(blob).not.toContain("item-10")
        expect(result).toMatchObject({ active: true, counts: { total: 40, pending: 40 } })
        SessionRepeat.stop(sid)
      },
    })
  })

  test("persists to db", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Database, eq } = await import("../../src/storage/db")
        const { RepeatTable } = await import("../../src/session/session.sql")

        SessionRepeat.start(sid, { goal: "survive restart", max: 10 })
        const row = Database.use((db) => db.select().from(RepeatTable).where(eq(RepeatTable.session_id, sid)).get())
        expect(row?.goal).toBe("survive restart")
        expect(row?.phase).toBe("prepare")
        expect(row?.max).toBe(10)

        SessionRepeat.stop(sid)
        const gone = Database.use((db) => db.select().from(RepeatTable).where(eq(RepeatTable.session_id, sid)).get())
        expect(gone).toBeUndefined()
        expect(SessionRepeat.get(sid)).toBeUndefined()
      },
    })
  })
})
