import { randomBytes } from "crypto"
import z from "zod"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { PermissionNext } from "@/permission/next"
import { ModelID, ProviderID } from "@/provider/schema"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { Database, and, eq, inArray, ne } from "@/storage/db"
import { Log } from "@/util/log"
import { git } from "@/util/git"
import { Worktree } from "@/worktree"
import { TeamMemberTable, TeamTable, TeamTaskTable } from "./team.sql"

export namespace Team {
  const log = Log.create({ service: "team" })
  const waking = new Set<string>()
  const pending = new Map<string, number>()

  export const Status = z.enum(["active", "disbanded"])
  export type Status = z.infer<typeof Status>

  export const MemberStatus = z.enum(["starting", "busy", "idle", "shutdown", "error"])
  export type MemberStatus = z.infer<typeof MemberStatus>

  export const MemberRole = z.enum(["lead", "member"])
  export type MemberRole = z.infer<typeof MemberRole>

  export const TaskStatus = z.enum(["pending", "blocked", "claimed", "done"])
  export type TaskStatus = z.infer<typeof TaskStatus>

  export const PlanApproval = z.enum(["none", "pending", "approved", "rejected"])
  export type PlanApproval = z.infer<typeof PlanApproval>

  export const Info = z.object({
    id: z.string(),
    projectID: z.string(),
    name: z.string(),
    leadSessionID: SessionID.zod,
    status: Status,
    delegate: z.boolean(),
  })
  export type Info = z.infer<typeof Info>

  export const Member = z.object({
    id: z.string(),
    teamID: z.string(),
    name: z.string(),
    sessionID: SessionID.zod,
    agent: z.string(),
    providerID: z.string().optional(),
    modelID: z.string().optional(),
    role: MemberRole,
    status: MemberStatus,
    directory: z.string().optional(),
    branch: z.string().optional(),
    lastError: z.string().optional(),
    planApproval: PlanApproval,
    heartbeatAt: z.number().optional(),
  })
  export type Member = z.infer<typeof Member>

  export const Task = z.object({
    id: z.string(),
    teamID: z.string(),
    title: z.string(),
    status: TaskStatus,
    owner: z.string().optional(),
    deps: z.array(z.string()),
  })
  export type Task = z.infer<typeof Task>

  export const Snapshot = z.object({
    teamID: z.string(),
    name: z.string(),
    leadSessionID: SessionID.zod,
    delegate: z.boolean(),
    label: z.string(),
    members: z.array(
      z.object({
        name: z.string(),
        role: MemberRole,
        agent: z.string(),
        status: MemberStatus,
        sessionID: SessionID.zod,
        planApproval: PlanApproval,
        worktree: z.string().optional(),
        branch: z.string().optional(),
        error: z.string().optional(),
      }),
    ),
    tasks: z.object({
      pending: z.number(),
      blocked: z.number(),
      claimed: z.number(),
      done: z.number(),
      total: z.number(),
    }),
  })
  export type Snapshot = z.infer<typeof Snapshot>

  export const Event = {
    Created: BusEvent.define("team.created", z.object({ team: Info, snapshot: Snapshot })),
    MemberUpdated: BusEvent.define("team.member.updated", z.object({ member: Member, snapshot: Snapshot })),
    TaskUpdated: BusEvent.define("team.task.updated", z.object({ task: Task, snapshot: Snapshot })),
    Message: BusEvent.define(
      "team.message",
      z.object({
        teamID: z.string(),
        from: z.string(),
        to: z.string(),
        text: z.string(),
      }),
    ),
    Disbanded: BusEvent.define("team.disbanded", z.object({ teamID: z.string(), leadSessionID: SessionID.zod })),
  }

  const WRITE = ["edit", "write", "bash", "apply_patch"] as const

  function nid(prefix: string) {
    return `${prefix}_${Date.now().toString(16)}${randomBytes(6).toString("hex")}`
  }

  function denyWrites() {
    return WRITE.map((permission) => ({
      permission,
      pattern: "*",
      action: "deny" as const,
    }))
  }

  function allowWrites() {
    return WRITE.map((permission) => ({
      permission,
      pattern: "*",
      action: "allow" as const,
    }))
  }

  function fromTeam(row: typeof TeamTable.$inferSelect): Info {
    return {
      id: row.id,
      projectID: row.project_id,
      name: row.name,
      leadSessionID: row.lead_session_id,
      status: row.status as Status,
      delegate: row.delegate === 1,
    }
  }

  function fromMember(row: typeof TeamMemberTable.$inferSelect): Member {
    return {
      id: row.id,
      teamID: row.team_id,
      name: row.name,
      sessionID: row.session_id,
      agent: row.agent,
      providerID: row.provider_id ?? undefined,
      modelID: row.model_id ?? undefined,
      role: row.role as MemberRole,
      status: row.status as MemberStatus,
      directory: row.directory ?? undefined,
      branch: row.branch ?? undefined,
      lastError: row.last_error ?? undefined,
      planApproval: (row.plan_approval as PlanApproval) ?? "none",
      heartbeatAt: row.heartbeat_at ?? undefined,
    }
  }

  function fromTask(row: typeof TeamTaskTable.$inferSelect): Task {
    return {
      id: row.id,
      teamID: row.team_id,
      title: row.title,
      status: row.status as TaskStatus,
      owner: row.owner ?? undefined,
      deps: row.deps ?? [],
    }
  }

  export async function maxMembers() {
    const cfg = await Config.get()
    return cfg.experimental?.team?.max_members ?? 4
  }

  export async function defaultWorktree() {
    const cfg = await Config.get()
    return cfg.experimental?.team?.default_worktree ?? true
  }

  export async function heartbeatMs() {
    const cfg = await Config.get()
    return cfg.experimental?.team?.heartbeat_ms ?? 60_000
  }

  export function get(id: string) {
    const row = Database.use((db) => db.select().from(TeamTable).where(eq(TeamTable.id, id)).get())
    if (!row) return
    return fromTeam(row)
  }

  export function bySession(sessionID: SessionID) {
    const row = Database.use((db) =>
      db.select().from(TeamMemberTable).where(eq(TeamMemberTable.session_id, sessionID)).get(),
    )
    if (!row) return
    const team = get(row.team_id)
    if (!team || team.status !== "active") return
    return { team, member: fromMember(row) }
  }

  export function members(teamID: string) {
    return Database.use((db) => db.select().from(TeamMemberTable).where(eq(TeamMemberTable.team_id, teamID)).all()).map(
      fromMember,
    )
  }

  export function tasks(teamID: string) {
    return Database.use((db) => db.select().from(TeamTaskTable).where(eq(TeamTaskTable.team_id, teamID)).all()).map(
      fromTask,
    )
  }

  export function memberByName(teamID: string, name: string) {
    const row = Database.use((db) =>
      db
        .select()
        .from(TeamMemberTable)
        .where(and(eq(TeamMemberTable.team_id, teamID), eq(TeamMemberTable.name, name)))
        .get(),
    )
    if (!row) return
    return fromMember(row)
  }

  export function label(teamID: string) {
    const team = get(teamID)
    if (!team) return ""
    const list = members(teamID).filter((m) => m.role === "member")
    const busy = list.filter((m) => m.status === "busy" || m.status === "starting").length
    const idle = list.filter((m) => m.status === "idle").length
    const err = list.filter((m) => m.status === "error").length
    const parts = [`team:${team.name}`]
    if (busy) parts.push(`${busy} busy`)
    if (idle) parts.push(`${idle} idle`)
    if (err) parts.push(`${err} error`)
    if (!list.length) parts.push("solo")
    if (team.delegate) parts.push("delegate")
    return parts.join(" · ")
  }

  export function snapshot(teamID: string): Snapshot | undefined {
    const team = get(teamID)
    if (!team) return
    const list = members(teamID)
    const board = tasks(teamID)
    const counts = {
      pending: board.filter((t) => t.status === "pending").length,
      blocked: board.filter((t) => t.status === "blocked").length,
      claimed: board.filter((t) => t.status === "claimed").length,
      done: board.filter((t) => t.status === "done").length,
      total: board.length,
    }
    return {
      teamID: team.id,
      name: team.name,
      leadSessionID: team.leadSessionID,
      delegate: team.delegate,
      label: label(teamID),
      members: list.map((m) => ({
        name: m.name,
        role: m.role,
        agent: m.agent,
        status: m.status,
        sessionID: m.sessionID,
        planApproval: m.planApproval,
        worktree: m.directory,
        branch: m.branch,
        error: m.lastError,
      })),
      tasks: counts,
    }
  }

  export function listActive() {
    const rows = Database.use((db) =>
      db
        .select()
        .from(TeamTable)
        .where(and(eq(TeamTable.project_id, Instance.project.id), eq(TeamTable.status, "active")))
        .all(),
    )
    return rows.map((row) => snapshot(row.id)).filter(Boolean) as Snapshot[]
  }

  export async function create(input: { name: string; sessionID: SessionID; delegate?: boolean }) {
    const existing = bySession(input.sessionID)
    if (existing) throw new Error(`session already in team "${existing.team.name}"`)

    const name = input.name.trim()
    if (!name) throw new Error("team name required")

    const id = nid("tea")
    const mid = nid("tmb")
    const now = Date.now()
    const delegate = input.delegate === true

    Database.transaction((db) => {
      db.insert(TeamTable)
        .values({
          id,
          project_id: Instance.project.id,
          name,
          lead_session_id: input.sessionID,
          status: "active",
          delegate: delegate ? 1 : 0,
          time_created: now,
          time_updated: now,
        })
        .run()
      db.insert(TeamMemberTable)
        .values({
          id: mid,
          team_id: id,
          name: "lead",
          session_id: input.sessionID,
          agent: "build",
          role: "lead",
          status: "busy",
          directory: Instance.directory,
          plan_approval: "none",
          heartbeat_at: now,
          time_created: now,
          time_updated: now,
        })
        .run()
    })

    if (delegate) {
      await Session.setPermission({
        sessionID: input.sessionID,
        permission: denyWrites(),
      })
    }

    const team = get(id)!
    const snap = snapshot(id)!
    Bus.publish(Event.Created, { team, snapshot: snap })
    const lead = members(id).find((m) => m.role === "lead")!
    Bus.publish(Event.MemberUpdated, { member: lead, snapshot: snap })
    return team
  }

  export function setMemberStatus(input: {
    sessionID: SessionID
    status: MemberStatus
    error?: string
  }) {
    const now = Date.now()
    const row = Database.use((db) =>
      db
        .update(TeamMemberTable)
        .set({
          status: input.status,
          last_error: input.error,
          ...(input.status === "busy" || input.status === "starting" ? { heartbeat_at: now } : {}),
          time_updated: now,
        })
        .where(eq(TeamMemberTable.session_id, input.sessionID))
        .returning()
        .get(),
    )
    if (!row) return
    const member = fromMember(row)
    const snap = snapshot(member.teamID)
    if (snap) Bus.publish(Event.MemberUpdated, { member, snapshot: snap })
    return member
  }

  export function heartbeat(sessionID: SessionID) {
    const now = Date.now()
    const row = Database.use((db) =>
      db
        .update(TeamMemberTable)
        .set({ heartbeat_at: now, time_updated: now })
        .where(eq(TeamMemberTable.session_id, sessionID))
        .returning()
        .get(),
    )
    if (!row) return
    return fromMember(row)
  }

  function writable(agent: Agent.Info) {
    return WRITE.some((tool) => PermissionNext.evaluate(tool, "*", agent.permission).action !== "deny")
  }

  async function isolate(name: string) {
    if (Instance.project.vcs !== "git") return
    const info = await Worktree.makeWorktreeInfo(`team-${name}`)
    const created = await git(["worktree", "add", "-b", info.branch, info.directory], {
      cwd: Instance.worktree,
    })
    if (created.exitCode !== 0) {
      const err = [created.stderr.toString(), created.stdout.toString()].filter(Boolean).join("\n")
      throw new Error(err || "failed to create team worktree")
    }
    await Project.addSandbox(Instance.project.id, info.directory).catch(() => undefined)
    return info
  }

  function parseModel(model?: string) {
    if (!model) return
    const idx = model.indexOf("/")
    if (idx <= 0) throw new Error(`model must be provider/model, got "${model}"`)
    return {
      providerID: ProviderID.make(model.slice(0, idx)),
      modelID: ModelID.make(model.slice(idx + 1)),
    }
  }

  export async function spawn(input: {
    sessionID: SessionID
    member: string
    agent: string
    prompt: string
    model?: string
    worktree?: boolean
    plan_approval?: boolean
  }) {
    const ctx = bySession(input.sessionID)
    if (!ctx || ctx.member.role !== "lead") throw new Error("only the team lead can spawn members")
    if (ctx.team.status !== "active") throw new Error("team is not active")

    const name = input.member.trim().toLowerCase()
    if (!name || name === "lead") throw new Error("invalid member name")
    if (memberByName(ctx.team.id, name)) throw new Error(`member "${name}" already exists`)

    const peers = members(ctx.team.id).filter((m) => m.role === "member")
    const cap = await maxMembers()
    if (peers.length >= cap) throw new Error(`team member limit reached (${cap})`)

    const agent = await Agent.get(input.agent)
    if (!agent) throw new Error(`unknown agent "${input.agent}"`)

    const model = parseModel(input.model) ?? agent.model
    const useTree = input.worktree ?? ((await defaultWorktree()) && writable(agent))
    const tree = useTree ? await isolate(name) : undefined
    const directory = tree?.directory ?? Instance.directory
    const plan = input.plan_approval === true

    const session = await Session.createNext({
      parentID: input.sessionID,
      directory,
      title: `${ctx.team.name}/${name} (@${agent.name})`,
      permission: [
        {
          permission: "todowrite",
          pattern: "*",
          action: "deny",
        },
        {
          permission: "todoread",
          pattern: "*",
          action: "deny",
        },
        ...(plan ? denyWrites() : []),
      ],
    })

    const mid = nid("tmb")
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(TeamMemberTable)
        .values({
          id: mid,
          team_id: ctx.team.id,
          name,
          session_id: session.id,
          agent: agent.name,
          provider_id: model?.providerID,
          model_id: model?.modelID,
          role: "member",
          status: "starting",
          directory,
          branch: tree?.branch,
          plan_approval: plan ? "pending" : "none",
          heartbeat_at: now,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )

    const member = memberByName(ctx.team.id, name)!
    const snap = snapshot(ctx.team.id)!
    Bus.publish(Event.MemberUpdated, { member, snapshot: snap })

    const body = [
      `You are "${name}" on team "${ctx.team.name}".`,
      `Coordinate with the team tool using action=message|tasks|status only.`,
      `Do not create teams or spawn members.`,
      plan
        ? "Plan approval is required before edits. Research, send your plan to lead, and wait for approval."
        : "Prefer finishing claimed tasks, then idle.",
      `When finished: message lead with a concise findings summary, complete claimed tasks, then stop.`,
      "",
      input.prompt,
    ].join("\n")

    void run(member, body, model).catch((err) => {
      log.error("team member failed", { member: name, error: err })
      setMemberStatus({
        sessionID: session.id,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      })
    })

    return {
      member,
      sessionID: session.id,
      worktree: tree?.directory,
      branch: tree?.branch,
      planApproval: member.planApproval,
    }
  }

  async function summary(sessionID: SessionID) {
    const msgs = await Session.messages({ sessionID, limit: 30 })
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (msg.info.role !== "assistant") continue
      const text = msg.parts
        .flatMap((p) => (p.type === "text" && p.text ? [p.text] : []))
        .join("\n")
        .trim()
      if (!text) continue
      return text.length > 1500 ? `${text.slice(0, 1500)}…` : text
    }
    return ""
  }

  async function run(
    member: Member,
    text: string,
    model?: { providerID: ProviderID; modelID: ModelID },
  ) {
    const exec = async () => {
      setMemberStatus({ sessionID: member.sessionID, status: "busy" })
      await SessionPrompt.prompt({
        sessionID: member.sessionID,
        agent: member.agent,
        model,
        parts: [{ type: "text", text }],
      })
      const latest = bySession(member.sessionID)
      if (!latest || latest.member.status === "shutdown") return
      setMemberStatus({ sessionID: member.sessionID, status: "idle" })
      const out = await summary(member.sessionID).catch(() => "")
      const note = out
        ? `${member.name} is idle.\n\nSummary:\n${out}\n\nCall team({action:"status"}). If all members are idle (and tasks done or dropped), synthesize for the user then cleanup. If others are still busy, keep coordinating.`
        : `${member.name} is idle. Call team({action:"status"}) and continue.`
      await notify(latest.team, member.name, note).catch((err) => {
        log.warn("idle notify failed", { member: member.name, error: err })
      })
    }

    if (member.directory && member.directory !== Instance.directory) {
      await Instance.provide({
        directory: member.directory,
        fn: exec,
      })
      return
    }
    await exec()
  }

  async function notify(team: Info, from: string, text: string) {
    const lead = members(team.id).find((m) => m.role === "lead")
    if (!lead) return
    await deliver({
      teamID: team.id,
      from,
      to: "lead",
      target: lead,
      text,
    })
  }

  async function deliver(input: {
    teamID: string
    from: string
    to: string
    target: Member
    text: string
  }) {
    if (input.target.status === "shutdown" || input.target.status === "error") return

    const text = `[team:${input.from}→${input.to}] ${input.text}`
    Bus.publish(Event.Message, {
      teamID: input.teamID,
      from: input.from,
      to: input.to,
      text: input.text,
    })

    const sid = input.target.sessionID
    const model =
      input.target.providerID && input.target.modelID
        ? {
            providerID: ProviderID.make(input.target.providerID),
            modelID: ModelID.make(input.target.modelID),
          }
        : undefined

    const inject = () =>
      SessionPrompt.prompt({
        sessionID: sid,
        noReply: true,
        parts: [{ type: "text", text, synthetic: true }],
      })

    const wake = async (body: string) => {
      if (input.target.role === "member") {
        setMemberStatus({ sessionID: sid, status: "busy" })
      }
      await SessionPrompt.prompt({
        sessionID: sid,
        agent: input.target.agent,
        model,
        parts: [{ type: "text", text: body, synthetic: true }],
      }).finally(() => {
        if (input.target.role !== "member") return
        const latest = bySession(sid)
        if (latest && latest.member.status !== "shutdown" && latest.member.status !== "error") {
          setMemberStatus({ sessionID: sid, status: "idle" })
        }
      })
    }

    const go = async () => {
      const status = SessionStatus.get(sid)
      if (status.type !== "idle") {
        await inject()
        return
      }

      if (waking.has(sid)) {
        await inject()
        pending.set(sid, (pending.get(sid) ?? 0) + 1)
        return
      }

      waking.add(sid)
      try {
        let first = true
        do {
          pending.set(sid, 0)
          const body = first
            ? text
            : `[team:system] Additional team messages arrived. Call team({action:"status"}) and continue.`
          first = false
          await wake(body)
        } while ((pending.get(sid) ?? 0) > 0 && SessionStatus.get(sid).type === "idle")
      } finally {
        waking.delete(sid)
      }
    }

    if (input.target.directory && input.target.directory !== Instance.directory) {
      await Instance.provide({
        directory: input.target.directory,
        fn: go,
      })
      return
    }
    await go()
  }

  export async function message(input: { sessionID: SessionID; to: string; text: string }) {
    const ctx = bySession(input.sessionID)
    if (!ctx) throw new Error("session is not on a team")
    if (!input.text.trim()) throw new Error("message text required")

    const from = ctx.member.name
    const to = input.to.trim()
    if (!to) throw new Error("message target required")

    if (to === "*") {
      const targets = members(ctx.team.id).filter((m) => m.name !== from)
      for (const target of targets) {
        await deliver({
          teamID: ctx.team.id,
          from,
          to: "*",
          target,
          text: input.text,
        })
      }
      return { delivered: targets.map((m) => m.name) }
    }

    const target =
      to === "lead" ? members(ctx.team.id).find((m) => m.role === "lead") : memberByName(ctx.team.id, to)
    if (!target) throw new Error(`unknown member "${to}"`)

    await deliver({
      teamID: ctx.team.id,
      from,
      to,
      target,
      text: input.text,
    })
    return { delivered: [target.name] }
  }

  function depsReady(teamID: string, deps: string[]) {
    if (!deps.length) return true
    const rows = Database.use((db) =>
      db
        .select()
        .from(TeamTaskTable)
        .where(and(eq(TeamTaskTable.team_id, teamID), inArray(TeamTaskTable.id, deps)))
        .all(),
    )
    if (rows.length !== deps.length) return false
    return rows.every((row) => row.status === "done")
  }

  export function addTask(input: { sessionID: SessionID; title: string; deps?: string[] }) {
    const ctx = bySession(input.sessionID)
    if (!ctx) throw new Error("session is not on a team")
    const title = input.title.trim()
    if (!title) throw new Error("task title required")
    const deps = input.deps ?? []
    const status: TaskStatus = depsReady(ctx.team.id, deps) ? "pending" : "blocked"
    const id = nid("ttk")
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(TeamTaskTable)
        .values({
          id,
          team_id: ctx.team.id,
          title,
          status,
          deps,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    const task = tasks(ctx.team.id).find((t) => t.id === id)!
    const snap = snapshot(ctx.team.id)!
    Bus.publish(Event.TaskUpdated, { task, snapshot: snap })
    return task
  }

  export function claimTask(input: { sessionID: SessionID; taskID: string }) {
    const ctx = bySession(input.sessionID)
    if (!ctx) throw new Error("session is not on a team")

    const task = Database.transaction((db) => {
      const row = db.select().from(TeamTaskTable).where(eq(TeamTaskTable.id, input.taskID)).get()
      if (!row || row.team_id !== ctx.team.id) throw new Error("task not found")
      if (row.status === "done") throw new Error("task already done")
      if (row.status === "claimed") throw new Error(`task already claimed by ${row.owner}`)
      if (!depsReady(ctx.team.id, row.deps ?? [])) throw new Error("task dependencies incomplete")

      const next = db
        .update(TeamTaskTable)
        .set({
          status: "claimed",
          owner: ctx.member.name,
          time_updated: Date.now(),
        })
        .where(and(eq(TeamTaskTable.id, input.taskID), inArray(TeamTaskTable.status, ["pending", "blocked"])))
        .returning()
        .get()
      if (!next) throw new Error("failed to claim task")
      return fromTask(next)
    })

    const snap = snapshot(ctx.team.id)!
    Bus.publish(Event.TaskUpdated, { task, snapshot: snap })
    return task
  }

  export function completeTask(input: { sessionID: SessionID; taskID: string }) {
    const ctx = bySession(input.sessionID)
    if (!ctx) throw new Error("session is not on a team")

    const updated = Database.transaction((db) => {
      const row = db.select().from(TeamTaskTable).where(eq(TeamTaskTable.id, input.taskID)).get()
      if (!row || row.team_id !== ctx.team.id) throw new Error("task not found")

      const done = db
        .update(TeamTaskTable)
        .set({
          status: "done",
          owner: row.owner ?? ctx.member.name,
          time_updated: Date.now(),
        })
        .where(eq(TeamTaskTable.id, input.taskID))
        .returning()
        .get()!

      const blocked = db
        .select()
        .from(TeamTaskTable)
        .where(and(eq(TeamTaskTable.team_id, ctx.team.id), eq(TeamTaskTable.status, "blocked")))
        .all()

      const freed: Task[] = []
      for (const item of blocked) {
        if (!depsReady(ctx.team.id, item.deps ?? [])) continue
        const next = db
          .update(TeamTaskTable)
          .set({ status: "pending", time_updated: Date.now() })
          .where(eq(TeamTaskTable.id, item.id))
          .returning()
          .get()
        if (next) freed.push(fromTask(next))
      }

      return { done: fromTask(done), freed }
    })

    const snap = snapshot(ctx.team.id)!
    Bus.publish(Event.TaskUpdated, { task: updated.done, snapshot: snap })
    for (const task of updated.freed) Bus.publish(Event.TaskUpdated, { task, snapshot: snap })
    return updated
  }

  export function status(sessionID: SessionID) {
    const ctx = bySession(sessionID)
    if (!ctx) throw new Error("session is not on a team")
    const snap = snapshot(ctx.team.id)!
    return {
      ...snap,
      you: ctx.member.name,
      board: tasks(ctx.team.id),
    }
  }

  export async function approve(input: { sessionID: SessionID; member: string; approve?: boolean }) {
    const ctx = bySession(input.sessionID)
    if (!ctx || ctx.member.role !== "lead") throw new Error("only the team lead can approve plans")
    const target = memberByName(ctx.team.id, input.member.trim().toLowerCase())
    if (!target) throw new Error(`unknown member "${input.member}"`)
    if (target.planApproval !== "pending") throw new Error(`member "${target.name}" is not awaiting plan approval`)

    const ok = input.approve !== false
    const now = Date.now()
    Database.use((db) =>
      db
        .update(TeamMemberTable)
        .set({
          plan_approval: ok ? "approved" : "rejected",
          time_updated: now,
        })
        .where(eq(TeamMemberTable.id, target.id))
        .run(),
    )

    if (ok) {
      await Session.setPermission({
        sessionID: target.sessionID,
        permission: allowWrites(),
      })
    }

    const member = memberByName(ctx.team.id, target.name)!
    const snap = snapshot(ctx.team.id)!
    Bus.publish(Event.MemberUpdated, { member, snapshot: snap })

    const text = ok
      ? "Plan approved. Write tools are unlocked — proceed."
      : "Plan rejected. Revise and send an updated plan."

    await SessionPrompt.prompt({
      sessionID: target.sessionID,
      noReply: true,
      parts: [
        {
          type: "text",
          synthetic: true,
          text: `[team:lead→${target.name}] ${text}`,
        },
      ],
    }).catch((err) => {
      log.warn("plan approval inject failed", { member: target.name, error: err })
    })

    if (SessionStatus.get(target.sessionID).type === "idle") {
      void run(member, text).catch((err) => {
        log.warn("plan approval wake failed", { member: target.name, error: err })
      })
    }

    return { member: member.name, planApproval: member.planApproval }
  }

  export async function merge(input: { sessionID: SessionID; member: string }) {
    const ctx = bySession(input.sessionID)
    if (!ctx || ctx.member.role !== "lead") throw new Error("only the team lead can merge")
    const target = memberByName(ctx.team.id, input.member.trim().toLowerCase())
    if (!target) throw new Error(`unknown member "${input.member}"`)
    if (!target.branch) throw new Error(`member "${target.name}" has no worktree branch`)

    const check = await git(["merge", "--no-edit", target.branch], { cwd: Instance.worktree })
    if (check.exitCode !== 0) {
      const err = [check.stderr.toString(), check.stdout.toString()].filter(Boolean).join("\n")
      throw new Error(err || `failed to merge ${target.branch}`)
    }

    return {
      member: target.name,
      branch: target.branch,
      merged: true,
    }
  }

  export async function shutdown(input: { sessionID: SessionID; member?: string }) {
    const ctx = bySession(input.sessionID)
    if (!ctx || ctx.member.role !== "lead") throw new Error("only the team lead can shutdown members")

    const targets = input.member
      ? [memberByName(ctx.team.id, input.member)].filter(Boolean)
      : members(ctx.team.id).filter((m) => m.role === "member")

    for (const target of targets as Member[]) {
      if (target.status === "shutdown") continue
      await deliver({
        teamID: ctx.team.id,
        from: "lead",
        to: target.name,
        target,
        text: "Please wrap up and stop. The lead requested shutdown.",
      })
      SessionPrompt.cancel(target.sessionID)
      setMemberStatus({ sessionID: target.sessionID, status: "shutdown" })
    }

    return { shutdown: (targets as Member[]).map((m) => m.name) }
  }

  export async function cleanup(input: { sessionID: SessionID }) {
    const ctx = bySession(input.sessionID)
    if (!ctx || ctx.member.role !== "lead") throw new Error("only the team lead can cleanup")

    await shutdown({ sessionID: input.sessionID })

    const peers = members(ctx.team.id).filter((m) => m.role === "member")
    for (const peer of peers) {
      if (peer.directory && peer.directory !== Instance.directory) {
        await Worktree.remove({ directory: peer.directory }).catch((err) => {
          log.warn("worktree remove failed", { directory: peer.directory, error: err })
        })
      }
    }

    if (ctx.team.delegate) {
      await Session.setPermission({
        sessionID: input.sessionID,
        permission: allowWrites(),
      })
    }

    Database.use((db) =>
      db
        .update(TeamTable)
        .set({ status: "disbanded", time_updated: Date.now() })
        .where(eq(TeamTable.id, ctx.team.id))
        .run(),
    )
    Bus.publish(Event.Disbanded, { teamID: ctx.team.id, leadSessionID: ctx.team.leadSessionID })
    return { teamID: ctx.team.id, status: "disbanded" as const }
  }

  export function recover() {
    const stale = Database.use((db) =>
      db
        .select()
        .from(TeamMemberTable)
        .innerJoin(TeamTable, eq(TeamMemberTable.team_id, TeamTable.id))
        .where(
          and(
            eq(TeamTable.status, "active"),
            eq(TeamTable.project_id, Instance.project.id),
            inArray(TeamMemberTable.status, ["starting", "busy"]),
            ne(TeamMemberTable.role, "lead"),
          ),
        )
        .all(),
    )

    if (!stale.length) return []

    const interrupted: string[] = []
    for (const row of stale) {
      const member = setMemberStatus({
        sessionID: row.team_member.session_id,
        status: "error",
        error: "interrupted by restart",
      })
      if (member) interrupted.push(member.name)
    }

    const leads = new Set(stale.map((row) => row.team.lead_session_id))
    for (const lead of leads) {
      const names = stale
        .filter((row) => row.team.lead_session_id === lead)
        .map((row) => row.team_member.name)
      void SessionPrompt.prompt({
        sessionID: lead,
        noReply: true,
        parts: [
          {
            type: "text",
            synthetic: true,
            text: `[team:system→lead] Teammates interrupted and need resume: ${names.join(", ")}`,
          },
        ],
      }).catch((err) => {
        log.warn("recover notify failed", { lead, error: err })
      })
    }

    return interrupted
  }

  let timer: ReturnType<typeof setInterval> | undefined

  export function watch() {
    if (timer) return
    timer = setInterval(() => {
      void tick().catch((err) => log.warn("team heartbeat tick failed", { error: err }))
    }, 15_000)
    timer.unref?.()
  }

  export async function tick() {
    const ms = await heartbeatMs()
    const cutoff = Date.now() - ms
    const stale = Database.use((db) =>
      db
        .select()
        .from(TeamMemberTable)
        .innerJoin(TeamTable, eq(TeamMemberTable.team_id, TeamTable.id))
        .where(
          and(
            eq(TeamTable.status, "active"),
            eq(TeamTable.project_id, Instance.project.id),
            eq(TeamMemberTable.status, "busy"),
            ne(TeamMemberTable.role, "lead"),
          ),
        )
        .all(),
    )

    for (const row of stale) {
      const at = row.team_member.heartbeat_at ?? row.team_member.time_updated
      if (!at || at > cutoff) continue
      const member = setMemberStatus({
        sessionID: row.team_member.session_id,
        status: "error",
        error: "heartbeat timeout",
      })
      if (!member) continue
      SessionPrompt.cancel(member.sessionID)
      const team = get(member.teamID)
      if (team) await notify(team, "system", `${member.name} stuck (no heartbeat) — marked error`)
    }
  }

  export function prompt(sessionID: SessionID) {
    const ctx = bySession(sessionID)
    if (!ctx || ctx.team.status !== "active") return
    if (ctx.member.role === "lead") {
      return [
        `You are lead of team "${ctx.team.name}"${ctx.team.delegate ? " in delegate mode (coordination only)" : ""}.`,
        "Use the team tool to spawn ≤3 specialists, share tasks, message, approve plans, and merge worktrees.",
        "Do not finish the user goal until the task board is clear or explicitly dropped.",
        `Status: ${label(ctx.team.id)}`,
      ].join(" ")
    }
    return [
      `You are "${ctx.member.name}" on team "${ctx.team.name}".`,
      "Use team action=message|tasks|status only. Do not create or spawn.",
      ctx.member.planApproval === "pending" ? "Writes locked until lead approves your plan." : "",
    ]
      .filter(Boolean)
      .join(" ")
  }
}
