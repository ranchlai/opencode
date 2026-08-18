---
marp: true
title: How to use OpenCode
description: Basics, Superpowers, Ralph Loop, agent loop, then /loop, /team
paginate: true
---

<!-- Slide 1 -->

# How to use OpenCode

This fork — TUI, `/loop`, `/team`, and project control

*Basics first. Advanced is the point of this talk.*

---

<!-- Slide 2 -->

# Agenda

1. **Basics** — what it is, first session, TUI
2. **Shape the agent** — config, rules, permissions
3. **Extend it** — commands, skills, tools, plugins, MCP
4. **Superpowers** — design → plan → TDD
5. **The agent loop** — one turn until stop
6. **Ralph Loop / `/loop`** — AFK until the goal is done
7. **Run in parallel** — `/team`
8. **Ops** — non-streaming, CLI, serve
9. **When to use what**

---

<!-- Slide 3 -->

# What OpenCode is

Open-source **AI coding agent**. Provider-agnostic. LSP-aware.

| Surface | Command | For |
| --- | --- | --- |
| TUI | `opencode` / `bun dev` | Daily work |
| One-shot | `opencode run "…"` | Scripts, CI |
| Server | `opencode serve` | Headless / remote TUI |

One session engine. The TUI is just the main client.

---

<!-- Slide 4 -->

# Run *this* repo

Public `npm i -g opencode-ai` is **upstream**. This fork is not that.

```bash
bun install
bun dev /path/to/project     # TUI
./build.sh --single          # binary → packages/opencode/dist/
```

Need **Bun 1.3+**, a modern terminal, an LLM key, git (for `/undo`).

---

<!-- Slide 5 -->

# First session

```bash
bun dev auth login           # or /connect in TUI
bun dev models
cd ~/code/my-app && bun dev ~/code/my-app
```

Then in the prompt:

```text
/models          → pick provider/model
/init            → write AGENTS.md, then commit it
```

```text
Give me a 10-line map of this repo.
```

---

<!-- Slide 6 -->

# TUI basics

| Do this | How |
| --- | --- |
| Attach a file | `@path` fuzzy search |
| Run a shell cmd | `!git status` |
| Cycle agents | `Tab` / `Shift+Tab` |
| Stop generation | `Escape` |
| Command palette | `Ctrl+P` |
| Leader shortcuts | `Ctrl+X` then a letter |

`N` new · `L` sessions · `M` models · `U` undo · `C` compact · `H` help · `Q` quit

---

<!-- Slide 7 -->

# Agents

**Primary** (you talk to them):

- **build** — default, full tools
- **plan** — analyze; edits and bash *ask* first

**Subagents** (`@name`, or spawned by the primary):

- **explore** — fast, read-only search
- **general** — multi-step, may edit

Typical loop: **plan → agree → Tab to build → small change → `/undo` if wrong**.

---

<!-- Slide 8 -->

# Advanced: config is layered

Prefer **project-local** files. Share them in git.

```text
opencode.json          models, permission, loop, experimental
tui.json               theme, keybinds   ← not in opencode.json
AGENTS.md              durable instructions
.cursor/rules/*.mdc    Cursor-compatible rules
.opencode/             commands, agents, skills, plugins, tools
```

Personal defaults: `~/.config/opencode/`
Credentials: `~/.local/share/opencode/auth.json`

---

<!-- Slide 9 -->

# Advanced: teach it the repo

**`AGENTS.md`** — layout, test commands, style, what not to touch.

**Cursor `.mdc`** — auto-discovered, no config listing needed.

```markdown
---
description: TypeScript conventions
globs: src/**/*.ts
alwaysApply: false
---
- Prefer const. Use Bun APIs.
```

| Frontmatter | Effect |
| --- | --- |
| `alwaysApply: true` | Every session |
| `globs` | When a matching file is read |
| `description` only | Agent loads it when relevant |

---

<!-- Slide 10 -->

# Advanced: permissions

`"allow"` · `"ask"` · `"deny"` — per tool, with globs.

```json
{
  "permission": {
    "*": "ask",
    "edit": "allow",
    "bash": {
      "*": "ask",
      "git *": "allow",
      "bun test*": "allow",
      "rm *": "deny"
    }
  }
}
```

Plan agent already *asks* on edit/bash. Tighten further for unattended `/loop`.

---

<!-- Slide 11 -->

# Advanced: custom slash commands

`.opencode/command/test.md`

```markdown
---
description: Run tests and fix failures
agent: build
---
Run the suite. Fix the smallest set of files that goes green.
$ARGUMENTS
```

```text
/test the auth package
```

`$ARGUMENTS`, `$1`, `$2` · backticks inject shell output · optional `model` / `subtask`.

---

<!-- Slide 12 -->

# Advanced: skills (on demand)

Folder + `SKILL.md`. Agent sees **name + description**, loads the body via the `skill` tool.

```text
.opencode/skills/git-release/SKILL.md
```

```markdown
---
name: git-release
description: Changelog, tag, sanity checks. Do not push tags unless asked.
---
```

Also: `.claude/skills/`, `.agents/skills/`, `~/.config/opencode/skills/`.

Keep descriptions specific so the model picks the right skill.

---

<!-- Slide 13 -->

# Advanced: custom tools & plugins

**Tools** — LLM-callable functions.

```ts
// .opencode/tools/database.ts  → tool name "database"
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Query the project database",
  args: { query: tool.schema.string() },
  async execute(args) { /* ... */ },
})
```

**Plugins** — event hooks (session end, chat params, headers).

- Local: `.opencode/plugin/*.ts`
- npm: `"plugin": ["some-package"]` in `opencode.json`

---

<!-- Slide 14 -->

# Advanced: MCP

External tools (browser, tickets, docs). They **cost context**.

```json
{
  "mcp": {
    "browser": {
      "type": "local",
      "command": ["npx", "-y", "some-mcp-server"]
    }
  }
}
```

```bash
opencode mcp add
opencode mcp list
```

Enable few servers. GitHub-style MCPs can blow the window.

---

<!-- Slide 15 -->

# Superpowers — a methodology plugin

Not a new slash command. This checkout already loads it in `opencode.json`.

| Piece | Role |
| --- | --- |
| **Bootstrap** (`using-superpowers`) | Injected into the first user message. If a skill might apply, invoke it *before* answering. |
| **Skills** | Playbooks: brainstorming, TDD, systematic-debugging, … |
| **Plugin** | Registers those skills and injects the bootstrap |

- **TDD** — no production code without a failing test first
- **Systematic** — root cause before a fix
- **YAGNI** — smallest design that works

Skills are **mandatory**, not hints. Independent of `/loop` and `/team` — brainstorm first, then use those to execute.

---

<!-- Slide 16 -->

# Superpowers — how it loads

```json
"plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]
```

On start: clone the git spec → inject bootstrap into the **first** user message → skills via the `skill` tool.

Smoke check in a **new** session (`/new`):

```text
Tell me about your superpowers
```

It should name the library and the rule: **invoke skills before acting**. Then try:

```text
Let's add a CLI flag that prints loaded plugins and exits.
```

Expect **brainstorming** (questions, a short design, your OK) — not code yet.

---

<!-- Slide 17 -->

# Superpowers — default feature path

```text
brainstorming     → spec (you approve)
writing-plans     → plan file
TDD per task      → red → green → refactor (+ review)
finish the branch
```

| You say | Skill first |
| --- | --- |
| “Let's build X” | **brainstorming** — no code until you OK the design |
| “Fix this bug” | **systematic-debugging** |
| Implement the plan | **test-driven-development** |

Hard gate: “this is too simple” still gets a short design. After that, `/loop` or `/team` if the work is long or parallel.

---

<!-- Slide 18 -->

# Ralph Loop — keep going until done

Named after **Ralph Wiggum** (*The Simpsons*): try, fail, try again — do not quit.

A pattern for an AI coding assistant that **iterates on its own** until a complex task is actually finished. Not a one-shot answer.

Ordinary assistants stop after one think-act round and often leave the work half done. Ralph Loop **refuses to idle**.

This fork’s `/loop` is that pattern: done token, intercept the stop, continue until the goal (or a budget) says stop.

---

<!-- Slide 19 -->

# Ralph Loop — mechanism

From “answer once” to “keep working”:

1. Give a **task** and a **done token** (classic: `<promise>DONE</promise>`; here: `LOOP_DONE`)
2. AI works: edit, test, commit
3. **Intercept the exit** — when it would stop, a stop-hook / tick catches it
4. **Check the token**
   - missing → feed the original goal again, continue from the repo
   - present → loop ends
5. **Accumulate in the filesystem** — each round may get a fresh (or compacted) window; progress lives in code, tests, git, logs

```text
work → about to stop → token?  no → nudge / re-prompt → work
                         yes → done
```

---

<!-- Slide 20 -->

# Ralph Loop — HITL, AFK, safety

**Value:** short **AFK** (away from keyboard). Set the task, walk away, come back to review.

| Mode | When |
| --- | --- |
| **HITL** (human in the loop) | Watch every step; interrupt and steer. Best for learning and debugging. |
| **AFK** | Trust the prompt and the boundary; let it run. |

**Safety (do not loop forever):**

- **Max iterations** — hard cap (here: `/loop 50` or a deadline `2h`)
- **Manual stop** — `/loop stop` (classic Ralph: `/cancel-ralph`)

**Not the same as TDD / YAGNI.** Those are *how to write good code*. Ralph is *how to keep the AI working*. Combine them: each round is red → green → refactor; the prompt says YAGNI — only the smallest code for this task.

---

<!-- Slide 21 -->

# The agent loop

OpenCode is not “one LLM call per prompt”.

A **session** stays **busy** in `SessionPrompt.loop` until the model **stops calling tools** (or you hit Escape / a hard stop).

Two different “loops”:

| Loop | Code | Job |
| --- | --- | --- |
| **Session loop** | `prompt.ts` `loop()` | Keep going: LLM → tools → compact → again |
| **Autonomous `/loop`** | `loop.ts` `tick()` | After a stop, inject a nudge so it keeps working on a goal |

The rest of this section is the **session loop**. `/loop` sits on top of it.

---

<!-- Slide 22 -->

# One picture

```text
  user message  (or /command, or /loop nudge)
           │
           ▼
    ┌─────────────────────────────┐
    │     SessionPrompt.loop      │
    │         while true          │
    │                             │
    │  pending subtask?  → run it │
    │  overflow?         → compact│
    │  else: LLM + tools          │
    │                             │
    │  finish = tool-calls → again│
    │  finish = stop              │
    │       │                     │
    │       ▼                     │
    │  /loop active? → synthetic  │
    │       user nudge → again    │
    │  else break (idle)          │
    └─────────────────────────────┘
```

Status: **busy** inside the loop, **idle** when it exits.

---

<!-- Slide 23 -->

# One step (the LLM turn)

Each iteration that is not a subtask/compaction:

1. Load messages (skip already-compacted ones)
2. Resolve **agent**, **tools**, **permissions**, system prompt  
   (`AGENTS.md`, skills, team prompt, environment)
3. Create an **assistant** message
4. `SessionProcessor.process` → `LLM.stream()` (`streamText` or `generateText`)
5. Stream events become parts: reasoning, text, tool calls
6. Tools run (edit, bash, read, …). Snapshot git patches on the step.

Then the **session loop looks at `finish`** and decides: another iteration, compact, or stop.

---

<!-- Slide 24 -->

# Why it keeps going

The model finish reason is the switch:

| `finish` | Meaning | Session loop |
| --- | --- | --- |
| `tool-calls` | “I need tools” | **Continue** — run tools, call LLM again |
| `stop` / `end_turn` | Model is done talking | Check `/loop` tick, else **exit** |
| `unknown` | Ambiguous | Treat like still in-flight |
| error / abort / deny | Hard stop | **Exit** (deny can be configured not to) |

So “the agent loop” **is** tool-calling: read → think → edit → test → think … until a stop.

`agent.steps` caps how many of these iterations you allow.

---

<!-- Slide 25 -->

# Compaction mid-loop

Context is finite. Overflow does **not** kill the session.

```text
tokens too high
    → enqueue compaction part
    → compaction agent summarizes history
    → loop continues with the summary
```

- Checked after a finished assistant **and** after a processor step
- `/compact` is the manual version (`auto: false`)
- After the session loop exits, old tool outputs may be **pruned**

This is why `/loop` can run for hours: compaction is a **loop iteration**, not the end.

---

<!-- Slide 26 -->

# Inside the processor

`SessionProcessor` has its **own** `while (true)` around the stream:

- **Retry** transient API errors (status = retry, backoff)
- **Doom loop** — same tool + same args **3 times** → permission `doom_loop`
- **Permission / question deny** → usually `stop` the session loop  
  (`experimental.continue_loop_on_deny` to keep going)
- **Escape** aborts the stream; unfinished tools marked error
- Tool results are written back as parts so the **next** LLM call sees them

Subagents (`task` / `@explore`) are **not** a nested session loop in the lead: they are a pending **subtask** part the outer loop executes, then continues.

---

<!-- Slide 27 -->

# How `/loop` uses this

When the session loop would **exit** (assistant `finish` is a real stop):

```text
SessionLoop.tick(session)
```

| Assistant said | tick does |
| --- | --- |
| `LOOP_BLOCKED` | finish autonomous loop, session idle |
| `LOOP_DONE` | run `loop.verify`; fail → **synthetic user message**, continue |
| budget hit | finish (`deadline` / `max` rounds) |
| still going | inject **nudge** (goal, round, verify cmds) as a synthetic user message |

That synthetic message is just another user turn — the **same** session loop starts again.

`/loop` does not replace the agent loop. It **refuses to idle** until the goal is done.

---

<!-- Slide 28 -->

# `/loop` — long goals

This fork’s **Ralph Loop**. Keeps working across **compaction**. You do not babysit “continue”.

Done token here is **`LOOP_DONE`** (or **`LOOP_BLOCKED`** if it needs you).

```text
/loop 2h ship the auth refactor
/loop 50 @docs/roadmap.md
/loop 2h 30 finish remaining todos
/loop stop
```

| Budget | Meaning |
| --- | --- |
| `2h` `30m` `1d` | Deadline |
| `50` | Max continuation rounds |
| text or `@file` | The goal |

Agent must end with **`LOOP_DONE`** or **`LOOP_BLOCKED`**.

---

<!-- Slide 29 -->

# `/loop` — verify, or it is honor-system

```json
{
  "loop": {
    "verify": ["bun typecheck", "bun test"]
  }
}
```

On `LOOP_DONE`:

1. Run each command from the project dir
2. All exit `0` → loop ends
3. Any failure → **rejected**; agent gets stdout and continues

`LOOP_BLOCKED` always stops (secret, irreversible choice, missing dep).

State lives in SQLite — restart can **resume** the same loop.

---

<!-- Slide 30 -->

# `/loop` — write a goal that can finish

**Bad:** “improve the codebase”

**Good:** “Make `packages/api` `bun test` green. Do not change public types.”

- Concrete done condition
- Always pair with `loop.verify`
- Round or time budget so a stuck agent cannot run forever
- Put conventions in `AGENTS.md`, not in the loop prompt

---

<!-- Slide 31 -->

# `/team` — parallel specialists

One **lead** session + named teammates + a shared task board.

**Off by default:**

```bash
OPENCODE_EXPERIMENTAL_TEAM_MODE=1 bun dev /path/to/project
```

```text
/team review auth for XSS and add tests
```

Lead: create team → split tasks → spawn 2–3 specialists → coordinate → merge → cleanup.

Header badge: `team:auth-review · 2 busy · 1 idle`

---

<!-- Slide 32 -->

# `/team` — spawn pattern

```js
team({ action: "create", name: "auth-review", delegate: true })

team({ action: "spawn", member: "scout", agent: "explore",
       prompt: "Map auth/XSS surfaces", worktree: false })

team({ action: "spawn", member: "builder", agent: "build",
       prompt: "Add tests for scout findings", plan_approval: true })

team({ action: "tasks", task_action: "add", title: "map auth routes" })
team({ action: "status" })
```

- Research: `explore`, **no worktree**
- Implementation: `build`, worktree **on**
- Risky writers: `plan_approval: true` — lead must `approve`

---

<!-- Slide 33 -->

# `/team` — board, merge, cleanup

```text
add → pending (or blocked on deps)
    → claim → claimed
    → complete → done
```

```js
team({ action: "message", to: "builder", text: "Login form first" })
team({ action: "message", to: "*", text: "Do not touch src/legacy" })
team({ action: "merge", member: "builder" })
team({ action: "cleanup" })
```

Idle members **and the lead** auto-wake on message. Nested `task` subagents **cannot** use `team`.

Prefer **2–3** teammates. Not a crowd.

---

<!-- Slide 34 -->

# Non-streaming LLM calls

Default: `streamText()` — tokens appear live.

Some proxies / local models **break SSE** (hangs, truncated tool JSON).

```json
{
  "experimental": {
    "disable_stream": true
  }
}
```

Uses `generateText()`, then **replays** a fake stream so the UI does not change.

Tradeoff: no live typing. Wait, then the whole reply dumps.

---

<!-- Slide 35 -->

# CLI, server, attach

```bash
opencode run "Explain SessionProcessor tool calls"
opencode run -m anthropic/claude-sonnet-4-5 -f src/index.ts "Review"
opencode run --format json "List public SDK exports"
opencode run -c "Finish the remaining todos"
```

```bash
opencode serve --port 4096
opencode attach http://127.0.0.1:4096
opencode run --attach http://127.0.0.1:4096 "Summarize git diff"
```

Reuse a warm server so MCP does not cold-boot on every `run`.

---

<!-- Slide 36 -->

# Recipe: unattended feature

1. `/init` + tighten `AGENTS.md`
2. Permissions: allow edit + test commands; deny `rm` / `git push`
3. `loop.verify`: typecheck + tests
4. **plan** agent: agree the design
5. `/loop 2h 40 land X without changing public API`
6. If it needs research + impl in parallel → **`/team`** instead (flag on)
7. Review the diff yourself; `/undo` is git-backed

---

<!-- Slide 37 -->

# When to use what

| Situation | Tool |
| --- | --- |
| Think before editing | **plan** agent |
| One focused change | **build**, `@` files |
| Design before any code | **Superpowers** brainstorming |
| Fix a bug with evidence | **systematic-debugging** |
| Model keeps calling tools | **Session loop** (automatic) |
| Hours of work, one goal | **Ralph Loop** → `/loop` + verify |
| Watch it work | **HITL**; walk away when you trust it |
| Research ∥ implement | **`/team`** (2–3 members) |
| Same prompt every day | Custom **`/command`** |
| Domain procedure | **Skill** |
| Broken streaming proxy | **`disable_stream`** |
| CI / scripts | **`opencode run`** |
| Extra product APIs | **MCP** (few) or **custom tool** |

---

<!-- Slide 38 -->

# Pitfalls

| Symptom | Fix |
| --- | --- |
| Agent jumps to code | Superpowers not loaded — `/new` then “Tell me about your superpowers” |
| Missing `/loop` `/team` `disable_stream` | You installed **upstream**, not this repo |
| Agent “stopped” after one reply | Normal — session loop exits when `finish ≠ tool-calls` |
| Agent never stops calling tools | `agent.steps` cap; doom_loop after 3 identical calls |
| No `/team` | `OPENCODE_EXPERIMENTAL_TEAM_MODE=1` |
| Loop “done” but tests fail | Add `loop.verify` |
| `/undo` does not revert files | Not a git repo |
| Context explodes | Too many MCP servers |
| Lead “waiting” forever | Auto-wake on idle; check heartbeats |
| Writer cannot edit | Lead must `approve` plan |

---

<!-- Slide 39 -->

# Recap

- **Basics:** `bun dev`, `/connect`, `/init`, `@`, `Tab`, `Ctrl+X`
- **Control:** `AGENTS.md`, `.mdc` rules, permission globs
- **Extend:** commands, skills, tools, plugins, MCP
- **Superpowers:** brainstorm → plan → TDD (skills before acting)
- **Ralph Loop:** intercept the stop until `LOOP_DONE` (HITL then AFK)
- **Session loop:** LLM → tools → compact → again until `finish ≠ tool-calls`
- **Unattended:** `/loop` is Ralph here — nudge + `loop.verify` + a budget
- **Parallel:** `/team` — lead, 2–3 specialists, worktrees, merge, cleanup
- **This fork:** `disable_stream`, loop, team, Cursor rules

---

<!-- Slide 40 -->

# Resources (this repo)

| | |
| --- | --- |
| Hands-on tutorial | `tutorial/README.md` |
| Superpowers | `tutorial/superpowers.md` |
| Config reference | `OPENCODE_CONFIG.md` |
| Team internals | `packages/opencode/src/team/README.md` |
| Dev / `bun dev` | `CONTRIBUTING.md` |
| Upstream docs | [opencode.ai/docs](https://opencode.ai/docs) |

```bash
OPENCODE_EXPERIMENTAL_TEAM_MODE=1 bun dev /path/to/project
```
