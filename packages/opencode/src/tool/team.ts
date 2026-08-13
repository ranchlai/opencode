import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./team.txt"
import { Team } from "@/team"
import { Flag } from "@/flag/flag"

const parameters = z.object({
  action: z
    .enum([
      "create",
      "spawn",
      "message",
      "tasks",
      "status",
      "shutdown",
      "cleanup",
      "approve",
      "reject",
      "merge",
    ])
    .describe("Team action to perform"),
  name: z
    .string()
    .optional()
    .describe("Team name for create; also accepted as teammate name for spawn/shutdown/approve/reject/merge"),
  delegate: z.boolean().optional().describe("Lead coordination-only mode for create"),
  member: z
    .string()
    .optional()
    .describe("Teammate name for spawn/shutdown/approve/reject/merge (preferred over name)"),
  agent: z.string().optional().describe("Agent type for spawn"),
  prompt: z.string().optional().describe("Initial prompt for spawn"),
  model: z.string().optional().describe("Optional provider/model for spawn"),
  worktree: z.boolean().optional().describe("Create git worktree for spawn (default: true for writers)"),
  plan_approval: z.boolean().optional().describe("Require lead plan approval before writes"),
  to: z.string().optional().describe("Message target: member name, lead, or *"),
  text: z.string().optional().describe("Message body"),
  task_action: z.enum(["list", "add", "claim", "complete"]).optional().describe("Task board action"),
  title: z.string().optional().describe("Task title for add"),
  task_id: z.string().optional().describe("Task id for claim/complete"),
  deps: z.array(z.string()).optional().describe("Dependency task ids for add"),
})

export const TeamTool = Tool.define("team", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (!Flag.OPENCODE_EXPERIMENTAL_TEAM_MODE) {
        throw new Error("team mode disabled; set OPENCODE_EXPERIMENTAL_TEAM_MODE=1")
      }

      Team.heartbeat(ctx.sessionID)

      const membership = Team.bySession(ctx.sessionID)
      if (params.action !== "create" && !membership) {
        throw new Error("this session is not on a team")
      }
      if (membership && membership.member.role === "member") {
        const allowed = new Set(["message", "tasks", "status"])
        if (!allowed.has(params.action)) {
          throw new Error(`members cannot ${params.action}`)
        }
      }

      const ok = (title: string, output: unknown, metadata: Record<string, any> = {}) => {
        return {
          title,
          metadata,
          output: typeof output === "string" ? output : JSON.stringify(output, null, 2),
        }
      }

      const who = params.member ?? (params.action === "create" ? undefined : params.name)

      switch (params.action) {
        case "create": {
          if (!params.name) throw new Error("name required for create")
          const team = await Team.create({
            name: params.name,
            sessionID: ctx.sessionID,
            delegate: params.delegate,
          })
          return ok(`team create ${team.name}`, team, { teamID: team.id })
        }
        case "spawn": {
          if (!who || !params.agent || !params.prompt) {
            throw new Error("member (or name), agent, and prompt required for spawn")
          }
          const result = await Team.spawn({
            sessionID: ctx.sessionID,
            member: who,
            agent: params.agent,
            prompt: params.prompt,
            model: params.model,
            worktree: params.worktree,
            plan_approval: params.plan_approval,
          })
          return ok(
            `team spawn ${result.member.name}`,
            {
              member: result.member.name,
              session_id: result.sessionID,
              agent: result.member.agent,
              worktree: result.worktree,
              branch: result.branch,
              plan_approval: result.planApproval,
              status: "started",
            },
            { sessionID: result.sessionID, worktree: result.worktree },
          )
        }
        case "message": {
          if (!params.to || !params.text) throw new Error("to and text required for message")
          const result = await Team.message({
            sessionID: ctx.sessionID,
            to: params.to,
            text: params.text,
          })
          return ok(`team message ${params.to}`, result, result)
        }
        case "tasks": {
          const action = params.task_action ?? "list"
          if (action === "list") {
            return ok("team tasks", Team.status(ctx.sessionID).board)
          }
          if (action === "add") {
            if (!params.title) throw new Error("title required for tasks add")
            const task = Team.addTask({
              sessionID: ctx.sessionID,
              title: params.title,
              deps: params.deps,
            })
            return ok("team task add", task, { taskID: task.id })
          }
          if (action === "claim") {
            if (!params.task_id) throw new Error("task_id required for claim")
            const task = Team.claimTask({ sessionID: ctx.sessionID, taskID: params.task_id })
            return ok("team task claim", task, { taskID: task.id })
          }
          if (!params.task_id) throw new Error("task_id required for complete")
          const result = Team.completeTask({ sessionID: ctx.sessionID, taskID: params.task_id })
          return ok("team task complete", result, { taskID: result.done.id })
        }
        case "status": {
          const snap = Team.status(ctx.sessionID)
          return ok(`team status ${snap.name}`, snap, { teamID: snap.teamID })
        }
        case "approve":
        case "reject": {
          if (!who) throw new Error("member required")
          const result = await Team.approve({
            sessionID: ctx.sessionID,
            member: who,
            approve: params.action === "approve",
          })
          return ok(`team ${params.action} ${who}`, result, result)
        }
        case "merge": {
          if (!who) throw new Error("member required for merge")
          const result = await Team.merge({
            sessionID: ctx.sessionID,
            member: who,
          })
          return ok(`team merge ${who}`, result, result)
        }
        case "shutdown": {
          const result = await Team.shutdown({
            sessionID: ctx.sessionID,
            member: who,
          })
          return ok("team shutdown", result, result)
        }
        case "cleanup": {
          const result = await Team.cleanup({ sessionID: ctx.sessionID })
          return ok("team cleanup", result, result)
        }
      }
    },
  }
})
