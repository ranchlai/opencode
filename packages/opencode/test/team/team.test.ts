import { describe, expect, test, spyOn, beforeAll, afterAll } from "bun:test"
import path from "path"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { Team } from "../../src/team"
import { Database } from "../../src/storage/db"
import { TeamMemberTable } from "../../src/team/team.sql"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("team mode", () => {
  let prompt: ReturnType<typeof spyOn>
  let cancel: ReturnType<typeof spyOn>

  beforeAll(() => {
    prompt = spyOn(SessionPrompt, "prompt").mockImplementation(
      (async () => undefined as never) as unknown as typeof SessionPrompt.prompt,
    )
    cancel = spyOn(SessionPrompt, "cancel").mockImplementation(() => undefined)
  })

  afterAll(() => {
    prompt.mockRestore()
    cancel.mockRestore()
  })
  test("create team and manage tasks", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const team = await Team.create({ name: "audit", sessionID: session.id })
        expect(team.name).toBe("audit")
        expect(Team.bySession(session.id)?.member.role).toBe("lead")
        expect(Team.bySession(session.id)?.member.agent).toBe("work")
        expect(Team.label(team.id)).toContain("team:audit")

        const first = Team.addTask({ sessionID: session.id, title: "map codebase" })
        expect(first.status).toBe("pending")

        const second = Team.addTask({
          sessionID: session.id,
          title: "implement",
          deps: [first.id],
        })
        expect(second.status).toBe("blocked")

        const claimed = Team.claimTask({ sessionID: session.id, taskID: first.id })
        expect(claimed.status).toBe("claimed")
        expect(claimed.owner).toBe("lead")

        const again = Team.claimTask({ sessionID: session.id, taskID: first.id })
        expect(again.owner).toBe("lead")
        expect(again.status).toBe("claimed")

        const done = Team.completeTask({ sessionID: session.id, taskID: first.id })
        expect(done.done.status).toBe("done")
        expect(done.freed.some((t) => t.id === second.id && t.status === "pending")).toBe(true)

        const snap = Team.status(session.id)
        expect(snap.members).toHaveLength(1)
        expect(snap.tasks.total).toBe(2)
        expect(snap.board).toHaveLength(2)
        expect(snap.label).toContain("team:audit")

        await Session.remove(session.id)
      },
    })
  })

  test("create is idempotent for the lead", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const first = await Team.create({ name: "one", sessionID: session.id })
        const second = await Team.create({ name: "two", sessionID: session.id })
        expect(second.id).toBe(first.id)
        expect(second.name).toBe("one")
        await Session.remove(session.id)
      },
    })
  })

  test("member role cannot spawn", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "crew", sessionID: lead.id })

        const child = await Session.createNext({
          parentID: lead.id,
          directory: tmp.path,
          title: "fake member",
        })

        const now = Date.now()
        Database.use((db) =>
          db
            .insert(TeamMemberTable)
            .values({
              id: `tmb_test${now}`,
              team_id: Team.bySession(lead.id)!.team.id,
              name: "scout",
              session_id: child.id,
              agent: "explore",
              role: "member",
              status: "idle",
              directory: tmp.path,
              plan_approval: "none",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        expect(Team.bySession(child.id)?.member.role).toBe("member")
        await expect(
          Team.spawn({
            sessionID: child.id,
            member: "other",
            agent: "explore",
            prompt: "nope",
            worktree: false,
          }),
        ).rejects.toThrow("only the team lead")

        await Session.remove(child.id)
        await Session.remove(lead.id)
      },
    })
  })

  test("delegate create and plan approval", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "safe", sessionID: lead.id, delegate: true })
        expect(team.delegate).toBe(true)
        expect(Team.label(team.id)).toContain("delegate")

        const child = await Session.createNext({
          parentID: lead.id,
          directory: tmp.path,
          title: "pending writer",
        })
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(TeamMemberTable)
            .values({
              id: `tmb_plan${now}`,
              team_id: team.id,
              name: "builder",
              session_id: child.id,
              agent: "build",
              role: "member",
              status: "idle",
              plan_approval: "pending",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const approved = await Team.approve({
          sessionID: lead.id,
          member: "builder",
          approve: true,
        })
        expect(approved.planApproval).toBe("approved")

        await Session.remove(child.id)
        await Session.remove(lead.id)
      },
    })
  })

  test("prompt helpers for lead and member", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "crew", sessionID: lead.id })
        expect(Team.prompt(lead.id)).toContain("lead of team")

        const child = await Session.createNext({
          parentID: lead.id,
          directory: path.join(tmp.path),
          title: "member",
        })
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(TeamMemberTable)
            .values({
              id: `tmb_prompt${now}`,
              team_id: Team.bySession(lead.id)!.team.id,
              name: "builder",
              session_id: child.id,
              agent: "build",
              role: "member",
              status: "idle",
              plan_approval: "pending",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        expect(Team.prompt(child.id)).toContain("builder")
        expect(Team.prompt(child.id)).toContain("plan")

        await Session.remove(child.id)
        await Session.remove(lead.id)
      },
    })
  })

  test("heartbeat marks stuck members", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "pulse", sessionID: lead.id })
        const child = await Session.createNext({
          parentID: lead.id,
          directory: tmp.path,
          title: "stuck",
        })
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(TeamMemberTable)
            .values({
              id: `tmb_heart${now}`,
              team_id: team.id,
              name: "worker",
              session_id: child.id,
              agent: "build",
              role: "member",
              status: "busy",
              plan_approval: "none",
              heartbeat_at: now - 120_000,
              time_created: now - 120_000,
              time_updated: now - 120_000,
            })
            .run(),
        )

        await Team.tick()
        expect(Team.bySession(child.id)?.member.status).toBe("error")

        await Session.remove(child.id)
        await Session.remove(lead.id)
      },
    })
  })

  test("spawn work defaults to no worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "office", sessionID: lead.id })
        const out = await Team.spawn({
          sessionID: lead.id,
          member: "helper",
          agent: "work",
          prompt: "summarize the sheet",
        })
        expect(out.member.agent).toBe("work")
        expect(out.worktree).toBeUndefined()
        await Team.cleanup({ sessionID: lead.id })
        await Session.remove(lead.id)
      },
    })
  })

  test("spawn writer without worktree", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "docs", sessionID: lead.id })
        const out = await Team.spawn({
          sessionID: lead.id,
          member: "scribe",
          agent: "writer",
          prompt: "draft a memo",
          worktree: false,
        })
        expect(out.member.agent).toBe("writer")
        expect(out.worktree).toBeUndefined()
        await Team.cleanup({ sessionID: lead.id })
        await Session.remove(lead.id)
      },
    })
  })

  test("weak llm: aliases, lookups, and recovery", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const named = await Team.create({ name: "Auth Review", sessionID: lead.id })
        expect(named.name).toBe("auth-review")

        const other = await Session.create({})
        const clash = await Team.create({ name: "auth-review", sessionID: other.id })
        expect(clash.name).toBe("auth-review-2")
        await Session.remove(other.id)

        const unnamed = await Team.create({ sessionID: lead.id })
        expect(unnamed.id).toBe(named.id)

        const scout = await Team.spawn({
          sessionID: lead.id,
          agent: "scout",
          prompt: "map auth",
        })
        expect(scout.member.name).toBe("explore")
        expect(scout.member.agent).toBe("explore")
        expect(scout.worktree).toBeUndefined()

        const writer = await Team.spawn({
          sessionID: lead.id,
          member: "Scribe",
          agent: "docs",
          prompt: "draft notes",
        })
        expect(writer.member.name).toBe("scribe")
        expect(writer.member.agent).toBe("writer")
        expect(writer.worktree).toBeUndefined()

        const msg = await Team.message({ sessionID: lead.id, to: "@Scribe", text: "focus on login" })
        expect(msg.delivered).toEqual(["scribe"])

        await expect(Team.message({ sessionID: lead.id, to: "nope", text: "hi" })).rejects.toThrow(/Known/)

        const first = Team.addTask({ sessionID: lead.id, title: "map auth routes" })
        const second = Team.addTask({
          sessionID: lead.id,
          title: "write tests",
          deps: ["map auth routes"],
        })
        expect(second.status).toBe("blocked")

        const claimed = Team.claimTask({ sessionID: lead.id, taskID: "map auth routes" })
        expect(claimed.id).toBe(first.id)
        expect(claimed.status).toBe("claimed")

        const done = Team.completeTask({ sessionID: lead.id, taskID: "map auth routes" })
        expect(done.done.status).toBe("done")
        expect(done.freed.some((t) => t.id === second.id && t.status === "pending")).toBe(true)

        const again = Team.completeTask({ sessionID: lead.id, taskID: first.id })
        expect(again.done.status).toBe("done")
        expect(again.freed).toHaveLength(0)

        const stepped = Team.advance({ sessionID: lead.id, taskID: "write tests" })
        expect(stepped.action).toBe("claim")
        if (stepped.action === "claim") expect(stepped.claimed.status).toBe("claimed")

        const snap = Team.status(lead.id)
        expect(snap.next.length).toBeGreaterThan(0)
        expect(Team.prompt(lead.id)).toContain("Spawn uses member")

        const child = await Session.createNext({
          parentID: lead.id,
          directory: tmp.path,
          title: "dead",
        })
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(TeamMemberTable)
            .values({
              id: `tmb_dead${now}`,
              team_id: named.id,
              name: "worker",
              session_id: child.id,
              agent: "build",
              role: "member",
              status: "error",
              last_error: "boom",
              plan_approval: "none",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const revived = await Team.spawn({
          sessionID: lead.id,
          member: "worker",
          agent: "build",
          prompt: "retry",
          worktree: false,
        })
        expect(revived.member.name).toBe("worker")
        expect(revived.sessionID).not.toBe(child.id)

        await Team.cleanup({ sessionID: lead.id })
        await Session.remove(lead.id)
      },
    })
  })

  test("heartbeat ignores members whose session is still busy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        const team = await Team.create({ name: "pulse-live", sessionID: lead.id })
        const child = await Session.createNext({
          parentID: lead.id,
          directory: tmp.path,
          title: "working",
        })
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(TeamMemberTable)
            .values({
              id: `tmb_live${now}`,
              team_id: team.id,
              name: "worker",
              session_id: child.id,
              agent: "build",
              role: "member",
              status: "busy",
              plan_approval: "none",
              heartbeat_at: now - 120_000,
              time_created: now - 120_000,
              time_updated: now - 120_000,
            })
            .run(),
        )

        SessionStatus.set(child.id, { type: "busy" })
        await Team.tick()
        expect(Team.bySession(child.id)?.member.status).toBe("busy")

        await Session.remove(child.id)
        await Session.remove(lead.id)
      },
    })
  })

  test("shutdown and error members do not consume the cap", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { experimental: { team: { max_members: 1 } } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lead = await Session.create({})
        await Team.create({ name: "cap", sessionID: lead.id })
        const first = await Team.spawn({
          sessionID: lead.id,
          member: "scout",
          agent: "explore",
          prompt: "look around",
          worktree: false,
        })
        await expect(
          Team.spawn({
            sessionID: lead.id,
            member: "scribe",
            agent: "writer",
            prompt: "draft",
            worktree: false,
          }),
        ).rejects.toThrow(/Live: scout/)

        await Team.shutdown({ sessionID: lead.id, member: "scout" })
        const second = await Team.spawn({
          sessionID: lead.id,
          member: "scribe",
          agent: "writer",
          prompt: "draft",
          worktree: false,
        })
        expect(second.member.name).toBe("scribe")

        Team.setMemberStatus({ sessionID: second.sessionID, status: "error", error: "boom" })
        const third = await Team.spawn({
          sessionID: lead.id,
          member: "analyst",
          agent: "analyst",
          prompt: "count",
          worktree: false,
        })
        expect(third.member.name).toBe("analyst")

        await Team.cleanup({ sessionID: lead.id })
        await Session.remove(first.sessionID)
        await Session.remove(lead.id)
      },
    })
  })
})
