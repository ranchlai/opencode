import { describe, expect, test } from "bun:test"
import { SessionLoop } from "../../src/session/loop"

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
