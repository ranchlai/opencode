import { describe, expect, test } from "bun:test"
import path from "path"
import { HardLoop } from "../../src/session/hard-loop"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("HardLoop.parse", () => {
  test("goal only", () => {
    expect(HardLoop.parse("ship the feature")).toEqual({
      kind: "start",
      goal: "ship the feature",
      deadline: undefined,
      max: undefined,
    })
  })

  test("round budget", () => {
    expect(HardLoop.parse("50 @GOAL.md")).toEqual({
      kind: "start",
      goal: "@GOAL.md",
      deadline: undefined,
      max: 50,
    })
  })
})

describe("HardLoop.prompt", () => {
  test("says this session is fresh", () => {
    const text = HardLoop.prompt(
      HardLoop.create({
        goal: "ship auth",
        max: 10,
        verify: ["bun test"],
      }),
    )
    expect(text).toContain("FRESH session")
    expect(text).toContain("ship auth")
    expect(text).toContain("Round 1 / 10")
    expect(text).toContain("LOOP_DONE")
    expect(text).toContain("bun test")
  })

  test("appends extra from a failed verify", () => {
    const text = HardLoop.prompt(HardLoop.create({ goal: "ship auth" }), "Verification failed")
    expect(text).toContain("Verification failed")
  })
})

describe("HardLoop.budget", () => {
  test("max is a process cap", () => {
    const info = HardLoop.create({ goal: "x", max: 2 })
    expect(HardLoop.budget(info)).toBeUndefined()
    info.rounds = 1
    expect(HardLoop.budget(info)).toBeUndefined()
    info.rounds = 2
    expect(HardLoop.budget(info)).toEqual({ kind: "max" })
  })

  test("deadline", () => {
    const info = HardLoop.create({ goal: "x", deadline: Date.now() - 1 })
    expect(HardLoop.budget(info)).toEqual({ kind: "deadline" })
  })
})

describe("HardLoop.decide", () => {
  test("markers", async () => {
    const info = HardLoop.create({ goal: "x" })
    expect(await HardLoop.decide(info, "all good LOOP_DONE")).toEqual({ kind: "done" })
    expect(await HardLoop.decide(info, "need key LOOP_BLOCKED")).toEqual({ kind: "blocked" })
    expect(await HardLoop.decide(info, "still working")).toEqual({ kind: "continue" })
  })

  test("LOOP_DONE rejected when verify fails", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = HardLoop.create({
          goal: "ship it",
          verify: ["exit 1"],
        })
        const verdict = await HardLoop.decide(info, "done LOOP_DONE")
        expect(verdict.kind).toBe("continue")
        if (verdict.kind !== "continue") return
        expect(verdict.extra).toContain("Verification failed")
        expect(verdict.extra).toContain("exit 1")
      },
    })
  })

  test("LOOP_DONE accepted when verify passes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "marker.txt"), "ok")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = HardLoop.create({
          goal: "ship it",
          verify: ["test -f marker.txt"],
        })
        expect(await HardLoop.decide(info, "LOOP_DONE")).toEqual({ kind: "done" })
      },
    })
  })

  test("LOOP_BLOCKED skips verify", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = HardLoop.create({
          goal: "ship it",
          verify: ["exit 1"],
        })
        expect(await HardLoop.decide(info, "need help LOOP_BLOCKED")).toEqual({ kind: "blocked" })
      },
    })
  })
})

describe("HardLoop.drive", () => {
  test("fresh processes remember only the filesystem", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "progress.txt")
    const seen: string[] = []
    const info = HardLoop.create({ goal: "count to 3 in progress.txt", max: 10 })
    const result = await HardLoop.drive(info, async (text) => {
      seen.push(text)
      const n = (await Bun.file(file).exists()) ? Number(await Bun.file(file).text()) + 1 : 1
      await Bun.write(file, String(n))
      if (n >= 3) return `counted to ${n} LOOP_DONE`
      return `counted to ${n}, still working`
    })

    expect(result).toEqual({ kind: "done", rounds: 3 })
    expect(await Bun.file(file).text()).toBe("3")
    expect(seen).toHaveLength(3)
    expect(seen[0]).toContain("Round 1")
    expect(seen[1]).toContain("Round 2")
    expect(seen[1]).toContain("FRESH session")
    expect(seen[1]).not.toContain("still working")
    expect(seen[2]).toContain("Round 3")
  })

  test("verify rejects LOOP_DONE until the check passes", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const marker = path.join(tmp.path, "done.txt")
        const info = HardLoop.create({
          goal: "write done.txt",
          max: 10,
          verify: ["test -f done.txt"],
        })
        let n = 0
        const result = await HardLoop.drive(info, async (text) => {
          n += 1
          if (n === 1) return "claiming complete LOOP_DONE"
          expect(text).toContain("Verification failed")
          expect(text).toContain("test -f done.txt")
          await Bun.write(marker, "ok")
          return "wrote the file LOOP_DONE"
        })
        expect(result).toEqual({ kind: "done", rounds: 2 })
        expect(await Bun.file(marker).exists()).toBe(true)
      },
    })
  })

  test("LOOP_BLOCKED stops the drive", async () => {
    const info = HardLoop.create({ goal: "need a secret", max: 10 })
    const result = await HardLoop.drive(info, async () => "missing API key LOOP_BLOCKED")
    expect(result).toEqual({ kind: "blocked", rounds: 1 })
  })

  test("max budget stops without LOOP_DONE", async () => {
    const info = HardLoop.create({ goal: "never finish", max: 2 })
    const result = await HardLoop.drive(info, async () => "still going")
    expect(result).toEqual({ kind: "max", rounds: 2 })
  })

  test("abort stops between rounds", async () => {
    const info = HardLoop.create({ goal: "x", max: 10 })
    const ac = new AbortController()
    const result = await HardLoop.drive(
      info,
      async () => {
        ac.abort()
        return "working"
      },
      ac.signal,
    )
    expect(result).toEqual({ kind: "abort", rounds: 1 })
  })
})
