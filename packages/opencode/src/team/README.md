# Team Mode (Experimental)

Flat multi-agent teams for OpenCode: one **lead** session plus named **teammates** that work in parallel, message each other, and share a task board.

Expert groups are on by default. Disable with `OPENCODE_EXPERIMENTAL_TEAM_MODE=0`.

## Enable

On by default. To turn off:

```bash
OPENCODE_EXPERIMENTAL_TEAM_MODE=0 opencode
```

Optional `opencode.json`:

```json
{
  "experimental": {
    "team": {
      "max_members": 4,
      "default_worktree": true,
      "heartbeat_ms": 60000
    }
  }
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `max_members` | `4` | Cap on teammates (not counting lead) |
| `default_worktree` | `true` | Writers get an isolated git worktree |
| `heartbeat_ms` | `60000` | Busy members without a heartbeat are marked `error` |

## Quick start

### Slash command

```text
/team review auth for XSS and add tests
```

The lead agent creates a team, splits work into tasks, spawns specialists, and coordinates until done.

### Manual tool use

Ask the lead (or invoke the `team` tool directly):

```text
Create a team named auth-review.
Spawn scout (explore, no worktree) to map auth surfaces.
Spawn builder (build) to add tests.
Add tasks and keep status updated.
```

Equivalent tool calls:

```js
team({ action: "create", name: "auth-review" })

team({
  action: "spawn",
  member: "scout",
  agent: "explore",
  prompt: "Find auth/XSS surfaces and report findings",
  worktree: false,
})

team({
  action: "spawn",
  member: "builder",
  agent: "build",
  prompt: "Add tests for scout findings",
})

team({ action: "tasks", task_action: "add", title: "map auth routes" })
team({ action: "status" })
```

## How to see task status

### 1. `team` status (best overview)

```js
team({ action: "status" })
```

Returns:

- **`label`** — same text as the UI badge (e.g. `team:auth-review · 2 busy · 1 idle`)
- **`members`** — name, agent, status, plan approval, worktree/branch, errors
- **`tasks`** — counts: `pending`, `blocked`, `claimed`, `done`, `total`
- **`board`** — full task list with ids, titles, owners, deps

### 2. Task board only

```js
team({ action: "tasks", task_action: "list" })
```

Each task has:

| Field | Meaning |
| --- | --- |
| `id` | Use with `claim` / `complete` |
| `title` | Short description |
| `status` | `pending` · `blocked` · `claimed` · `done` |
| `owner` | Member name when claimed/done |
| `deps` | Task ids that must be `done` first |

### 3. Header badge (TUI + web UI)

When a session is on an active team, the session header shows a live badge, for example:

```text
team:auth-review · 2 busy · 1 idle
```

With delegate mode:

```text
team:auth-review · 1 busy · delegate
```

Badge updates from Bus events (`team.created`, `team.member.updated`, `team.task.updated`, `team.disbanded`).

### 4. Ask the lead in chat

```text
Show team status and the task board.
```

The model should call `team({ action: "status" })` (and/or `tasks` list) and summarize.

### Task lifecycle

```text
add → pending (or blocked if deps unfinished)
     → claim → claimed
     → complete → done
                  (dependents may unblock to pending)
```

```js
team({ action: "tasks", task_action: "add", title: "implement fix", deps: ["ttk_…"] })
team({ action: "tasks", task_action: "claim", task_id: "ttk_…" })
team({ action: "tasks", task_action: "complete", task_id: "ttk_…" })
```

## Tool reference

| Action | Who | Purpose |
| --- | --- | --- |
| `create` | caller → lead | Start team. Args: `name`, `delegate?` |
| `spawn` | lead | Background teammate. Args: `member`, `agent`, `prompt`, `model?`, `worktree?`, `plan_approval?` |
| `message` | all | Send to member name, `lead`, or `*`. Args: `to`, `text` |
| `tasks` | all | Board ops. Args: `task_action=list\|add\|claim\|complete`, `title?`, `task_id?`, `deps?` |
| `status` | all | Snapshot: badge label, members, task counts, full board |
| `approve` / `reject` | lead | Plan approval for writers. Args: `member` |
| `merge` | lead | Merge member worktree branch into the project. Args: `member` |
| `shutdown` | lead | Stop one or all members. Args: `member?` |
| `cleanup` | lead | Disband team and remove worktrees |

### Spawn tips

- Prefer **2–3** teammates.
- Research / review: `agent: "explore"`, `worktree: false`.
- Implementation: `agent: "build"` (worktree on by default).
- Risky writers: `plan_approval: true` — lead must `approve` before writes unlock.
- Optional model override: `model: "provider/model-id"`.

### Delegate mode

```js
team({ action: "create", name: "refactor", delegate: true })
```

Lead write tools are denied so the lead coordinates only. Permissions are restored on `cleanup`.

## Messaging

```js
team({ action: "message", to: "builder", text: "Focus on login form first" })
team({ action: "message", to: "lead", text: "Found 3 XSS candidates" })
team({ action: "message", to: "*", text: "Stop editing src/legacy" })
```

Idle members **and the lead** auto-wake on message. Busy sessions receive the message in-transcript; if more messages arrive while a wake is already running, they are queued and trigger another wake when the current turn ends.

When a teammate finishes, the lead is woken with an idle notice that includes a truncated summary of the member’s last assistant text.

## Worktrees and merge

Writing teammates usually get a branch under OpenCode’s worktree storage. After review:

```js
team({ action: "merge", member: "builder" })
```

Then:

```js
team({ action: "cleanup" })
```

## HTTP (advanced / UI sync)

With the flag on:

- `GET /experimental/team` — active team snapshots for the project
- `GET /experimental/team/session/:sessionID` — snapshot for one session (or `null`)

## Limits and rules

- One active team membership per session.
- Nested `task` subagents **cannot** use the `team` tool (avoids bus spam).
- Members may only use `message`, `tasks`, and `status`.
- Heartbeat: busy members that stop heartbeating are marked `error` and the lead is notified.
- On server restart, interrupted busy members are marked `error`; the lead should `message` or re-`spawn`.

## Example session

```text
You: /team harden session cookie handling

Lead:
  create "cookies"
  tasks add "audit Set-Cookie usage"
  tasks add "add regression tests" (deps: audit)
  spawn scout @explore
  spawn builder @build

Scout → message lead: findings…
Lead → message builder: implement fixes for A, B
Builder → claim / complete tasks
Lead → status  (tasks: done)
Lead → merge builder → cleanup
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No `team` tool / no `/team` | `OPENCODE_EXPERIMENTAL_TEAM_MODE` is `0` |
| No header badge | Session must be on an active team; refresh / wait for Bus events |
| `members cannot spawn` | Only the lead can spawn |
| Claim fails | Task already claimed, done, or deps not complete |
| Writer can’t edit | Waiting on `plan_approval` — lead must `approve` |
| Lead stuck “waiting” | Fixed by auto-waking the lead on member idle/message; restart session if on old build |
| Member stuck `error` | Heartbeat timeout or restart — message or re-spawn |

## Related code

- Core: `packages/opencode/src/team/`
- Tool: `packages/opencode/src/tool/team.ts`
- Slash prompt: `packages/opencode/src/command/template/team.txt`
- TUI badge: `packages/opencode/src/cli/cmd/tui/routes/session/header.tsx`
- Web badge: `packages/app/src/pages/session/message-timeline.tsx`
