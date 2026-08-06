import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionLoop } from "../../src/session/loop"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("SessionLoop.parse", () => {
  test("stop aliases", () => {
    expect(SessionLoop.parse("")).toEqual({ kind: "stop" })
    expect(SessionLoop.parse("stop")).toEqual({ kind: "stop" })
    expect(SessionLoop.parse("cancel")).toEqual({ kind: "stop" })
  })

  test("goal only", () => {
    expect(SessionLoop.parse("ship the feature")).toEqual({
      kind: "start",
      goal: "ship the feature",
      deadline: undefined,
      max: undefined,
    })
  })

  test("duration budget", () => {
    const before = Date.now()
    const parsed = SessionLoop.parse("2h implement auth")
    expect(parsed.kind).toBe("start")
    if (parsed.kind !== "start") return
    expect(parsed.goal).toBe("implement auth")
    expect(parsed.deadline).toBeGreaterThanOrEqual(before + 2 * 3_600_000)
    expect(parsed.deadline).toBeLessThanOrEqual(Date.now() + 2 * 3_600_000)
  })

  test("round budget", () => {
    expect(SessionLoop.parse("50 @GOAL.md")).toEqual({
      kind: "start",
      goal: "@GOAL.md",
      deadline: undefined,
      max: 50,
    })
  })
})

describe("SessionLoop.ended", () => {
  test("markers", () => {
    expect(SessionLoop.ended("all good LOOP_DONE")).toBe(true)
    expect(SessionLoop.ended("need key LOOP_BLOCKED")).toBe(true)
    expect(SessionLoop.ended("still working")).toBe(false)
  })
})

describe("SessionLoop.tick verify", () => {
  const sid = SessionID.make("ses_loop_verify_test")

  function assistant(text: string) {
    return {
      info: {} as any,
      parts: [{ type: "text" as const, text }],
    } as any
  }

  test("LOOP_DONE rejected when verify fails", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SessionLoop.start(sid, {
          goal: "ship it",
          verify: ["exit 1"],
        })
        const text = await SessionLoop.tick(sid, assistant("done LOOP_DONE"))
        expect(text).toContain("Verification failed")
        expect(text).toContain("exit 1")
        expect(SessionLoop.get(sid)).toBeDefined()
        SessionLoop.stop(sid)
      },
    })
  })

  test("LOOP_DONE accepted when verify passes", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SessionLoop.start(sid, {
          goal: "ship it",
          verify: ["exit 0"],
        })
        const text = await SessionLoop.tick(sid, assistant("done LOOP_DONE"))
        expect(text).toBeUndefined()
        expect(SessionLoop.get(sid)).toBeUndefined()
      },
    })
  })

  test("LOOP_BLOCKED skips verify", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SessionLoop.start(sid, {
          goal: "ship it",
          verify: ["exit 1"],
        })
        const text = await SessionLoop.tick(sid, assistant("need help LOOP_BLOCKED"))
        expect(text).toBeUndefined()
        expect(SessionLoop.get(sid)).toBeUndefined()
      },
    })
  })

  test("nudge lists verify commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SessionLoop.start(sid, {
          goal: "ship it",
          verify: ["bun typecheck"],
        })
        const text = await SessionLoop.tick(sid, assistant("still working"))
        expect(text).toContain("bun typecheck")
        expect(text).toContain("LOOP_DONE is accepted only after")
        SessionLoop.stop(sid)
      },
    })
  })

  test("verify runs in project directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "marker.txt"), "ok")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await SessionLoop.start(sid, {
          goal: "ship it",
          verify: ["test -f marker.txt"],
        })
        const text = await SessionLoop.tick(sid, assistant("LOOP_DONE"))
        expect(text).toBeUndefined()
        expect(SessionLoop.get(sid)).toBeUndefined()
      },
    })
  })

  test("persists to db and clears on stop", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Database, eq } = await import("../../src/storage/db")
        const { LoopTable } = await import("../../src/session/session.sql")

        await SessionLoop.start(sid, {
          goal: "survive restart",
          max: 10,
          verify: ["exit 0"],
        })
        await SessionLoop.tick(sid, assistant("still working"))

        const row = Database.use((db) => db.select().from(LoopTable).where(eq(LoopTable.session_id, sid)).get())
        expect(row?.goal).toBe("survive restart")
        expect(row?.rounds).toBe(1)
        expect(row?.max).toBe(10)

        SessionLoop.stop(sid)
        const gone = Database.use((db) => db.select().from(LoopTable).where(eq(LoopTable.session_id, sid)).get())
        expect(gone).toBeUndefined()
        expect(SessionLoop.get(sid)).toBeUndefined()
      },
    })
  })

  test("hydrates from db when memory empty", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Database } = await import("../../src/storage/db")
        const { LoopTable } = await import("../../src/session/session.sql")
        Database.use((db) =>
          db
            .insert(LoopTable)
            .values({
              session_id: sid,
              goal: "from db",
              started: Date.now(),
              rounds: 3,
              verify: [],
            })
            .run(),
        )

        const info = SessionLoop.get(sid)
        expect(info?.goal).toBe("from db")
        expect(info?.rounds).toBe(3)

        const text = await SessionLoop.tick(sid, assistant("continue"))
        expect(text).toContain("from db")
        expect(SessionLoop.get(sid)?.rounds).toBe(4)

        SessionLoop.stop(sid)
      },
    })
  })
})
