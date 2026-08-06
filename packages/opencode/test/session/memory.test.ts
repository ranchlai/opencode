import { describe, expect, test } from "bun:test"
import { Memory } from "../../src/session/memory"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("Memory", () => {
  test("records and matches failed attempts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const args = { command: "bun test missing" }
        expect(Memory.match("bash", args)).toBeUndefined()

        Memory.record({
          tool: "bash",
          args,
          error: "exit code 1\nfail",
        })

        const hit = Memory.match("bash", args)
        expect(hit?.tool).toBe("bash")
        expect(hit?.error).toContain("exit code 1")

        const hint = Memory.warn("bash", args)
        expect(hint).toContain("WARNING")
        expect(hint).toContain("exit code 1")

        expect(Memory.warn("bash", { command: "other" })).toBeUndefined()
        Memory.clear()
        expect(Memory.match("bash", args)).toBeUndefined()
      },
    })
  })

  test("failed detects nonzero exit metadata", () => {
    expect(Memory.failed({ metadata: { exit: 0 }, output: "ok" })).toBeUndefined()
    expect(Memory.failed({ metadata: { exit: 2 }, output: "boom" })).toBe("boom")
    expect(Memory.failed({ metadata: { exit: 1 }, output: "  " })).toBe("exit code 1")
  })

  test("same key overwrites prior error", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const args = { path: "a.ts" }
        Memory.record({ tool: "edit", args, error: "first" })
        Memory.record({ tool: "edit", args, error: "second" })
        expect(Memory.match("edit", args)?.error).toBe("second")
        Memory.clear("edit")
        expect(Memory.match("edit", args)).toBeUndefined()
      },
    })
  })

  test("forget clears a successful retry", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const args = { command: "bun test" }
        Memory.record({ tool: "bash", args, error: "exit 1" })
        expect(Memory.warn("bash", args)).toContain("WARNING")
        Memory.forget("bash", args)
        expect(Memory.warn("bash", args)).toBeUndefined()
      },
    })
  })
})
