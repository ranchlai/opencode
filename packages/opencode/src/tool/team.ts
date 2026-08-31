import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./team.txt"
import { Team } from "@/team"
import { Flag } from "@/flag/flag"

const ACTIONS = [
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
  "complete",
  "claim",
  "add",
  "list",
  "send",
] as const

const TASKS = ["list", "add", "claim", "complete", "done", "finish", "create", "take"] as const

const parameters = z.object({
  action: z.enum(ACTIONS).describe("Team action to perform"),
  name: z
    .string()
    .optional()
    .describe("Team name for create; also accepted as teammate name for spawn/shutdown/approve/reject/merge"),
  delegate: z.boolean().optional().describe("Lead coordination-only mode for create"),
  member: z
    .string()
    .optional()
    .describe("Teammate name for spawn/shutdown/approve/reject/merge/message (preferred over name)"),
  agent: z.string().optional().describe("Agent type for spawn (explore, researcher, writer, analyst, build)"),
  prompt: z.string().optional().describe("Initial prompt for spawn; also accepted as message text"),
  model: z.string().optional().describe("Optional provider/model for spawn"),
  worktree: z.boolean().optional().describe("Create git worktree for spawn (default: true for build, false otherwise)"),
  plan_approval: z.boolean().optional().describe("Require lead plan approval before writes"),
  to: z.string().optional().describe("Message target: member name, lead, or *"),
  text: z.string().optional().describe("Message body; also accepted as spawn prompt"),
  task_action: z.enum(TASKS).optional().describe("Task board action"),
  title: z.string().optional().describe("Task title for add; also accepted as task id for claim/complete"),
  task_id: z.string().optional().describe("Task id or title for claim/complete"),
  id: z.string().optional().describe("Alias for task_id"),
  deps: z.array(z.string()).optional().describe("Dependency task ids or titles for add"),
})

export const TeamTool = Tool.define("team", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    formatValidationError(error) {
      const issues = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root"
          return `  - ${path}: ${issue.message}`
        })
        .join("\n")
      return [
        `Invalid team tool args:`,
        issues,
        "",
        "Actions: create, spawn, message, tasks, status, approve, reject, merge, shutdown, cleanup.",
        "create: name?",
        "spawn: member?, agent, prompt (name= and text= also work)",
        "message: to, text (member= and prompt= also work)",
        "tasks: task_action=list|add|claim|complete, title?, task_id?",
      ].join("\n")
    },
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (!Flag.OPENCODE_EXPERIMENTAL_TEAM_MODE) {
        throw new Error("team mode disabled; set OPENCODE_EXPERIMENTAL_TEAM_MODE=0 to leave it off")
      }

      Team.heartbeat(ctx.sessionID)

      const action =
        params.action === "send"
          ? "message"
          : params.action === "list"
            ? "status"
            : params.action === "complete" || params.action === "claim" || params.action === "add"
              ? "tasks"
              : params.action

      const membership = Team.bySession(ctx.sessionID)
      if (action !== "create" && !membership) {
        throw new Error("this session is not on a team. Lead: action=create with a short name first.")
      }
      if (membership && membership.member.role === "member") {
        const allowed = new Set(["message", "tasks", "status"])
        if (!allowed.has(action)) {
          throw new Error(`members cannot ${action}. Allowed: message, tasks, status.`)
        }
      }

      const ok = (title: string, output: unknown, metadata: Record<string, any> = {}) => {
        return {
          title,
          metadata,
          output: typeof output === "string" ? output : JSON.stringify(output, null, 2),
        }
      }

      const who = params.member ?? (action === "create" ? undefined : params.name)
      const prompt = params.prompt ?? params.text
      const text = params.text ?? params.prompt
      const to = params.to ?? (action === "message" ? who : undefined)
      const taskID =
        params.task_id ??
        params.id ??
        (params.task_action && params.task_action !== "add" ? params.title : undefined)

      switch (action) {
        case "create": {
          const team = await Team.create({
            name: params.name,
            sessionID: ctx.sessionID,
            delegate: params.delegate,
          })
          return ok(`team create ${team.name}`, team, { teamID: team.id })
        }
        case "spawn": {
          if (!params.agent) {
            throw new Error(
              "agent required for spawn. Try researcher, writer, explore, analyst, or build (aliases: scout, builder, research, docs).",
            )
          }
          if (!prompt) throw new Error("prompt required for spawn (prompt= or text=)")
          const result = await Team.spawn({
            sessionID: ctx.sessionID,
            member: who,
            agent: params.agent,
            prompt,
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
              next: "Call action=status after spawn. You will be woken when they finish.",
            },
            { sessionID: result.sessionID, worktree: result.worktree },
          )
        }
        case "message": {
          if (!to || !text) throw new Error("to and text required for message (member= / prompt= also work)")
          const result = await Team.message({
            sessionID: ctx.sessionID,
            to,
            text,
          })
          return ok(`team message ${to}`, result, result)
        }
        case "tasks": {
          const mapped =
            params.task_action === "done" || params.task_action === "finish"
              ? "complete"
              : params.task_action === "create"
                ? "add"
                : params.task_action === "take"
                  ? "claim"
                  : params.task_action
          const op =
            mapped ??
            (params.action === "complete"
              ? "complete"
              : params.action === "claim"
                ? "claim"
                : params.action === "add" || params.title
                  ? "add"
                  : taskID
                    ? "advance"
                    : "list")
          if (op === "list") {
            return ok("team tasks", Team.status(ctx.sessionID).board)
          }
          if (op === "add") {
            if (!params.title) throw new Error("title required for tasks add")
            const task = Team.addTask({
              sessionID: ctx.sessionID,
              title: params.title,
              deps: params.deps,
            })
            return ok("team task add", task, { taskID: task.id })
          }
          if (op === "advance") {
            if (!taskID) throw new Error("task_id or title required")
            const result = Team.advance({ sessionID: ctx.sessionID, taskID })
            return ok(`team task ${result.action}`, result)
          }
          if (op === "claim") {
            if (!taskID) throw new Error("task_id or title required for claim")
            const task = Team.claimTask({ sessionID: ctx.sessionID, taskID })
            return ok("team task claim", task, { taskID: task.id })
          }
          if (!taskID) throw new Error("task_id or title required for complete")
          const result = Team.completeTask({ sessionID: ctx.sessionID, taskID })
          return ok("team task complete", result, { taskID: result.done.id })
        }
        case "status": {
          const snap = Team.status(ctx.sessionID)
          return ok(`team status ${snap.name}`, snap, { teamID: snap.teamID })
        }
        case "approve":
        case "reject": {
          if (!who) throw new Error("member required for approve/reject")
          const result = await Team.approve({
            sessionID: ctx.sessionID,
            member: who,
            approve: action === "approve",
          })
          return ok(`team ${action} ${who}`, result, result)
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
        default:
          throw new Error(
            "unknown action. Use create, spawn, message, tasks, status, approve, reject, merge, shutdown, or cleanup.",
          )
      }
    },
  }
})
