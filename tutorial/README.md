# OpenCode tutorial (this repo)

This is a hands-on guide to **this checkout** of OpenCode — not the public `opencode-ai` npm package. Upstream OpenCode is an open-source AI coding agent (TUI, CLI, server). This fork adds:

- **Non-streaming LLM calls** (`experimental.disable_stream`) for providers that mishandle SSE
- **`/loop`** for long-running goals that survive context compaction
- **`/repeat`** for many similar jobs with different inputs, each in a fresh child session
- **Team mode** (`/team`) so one lead can spawn specialists in parallel
- **Cursor `.mdc` project rules**, loaded the same way Cursor loads them

By the end you will have built the CLI from source, logged into a provider, taught OpenCode a project, and used the TUI, `/loop`, `/repeat`, and `/team`.

---

## 0. What you are running

| Surface | Command | Use it for |
| --- | --- | --- |
| **TUI** | `opencode` (or `bun dev`) | Daily interactive work |
| **One-shot CLI** | `opencode run "…"` | Scripts, CI, a single question |
| **Server** | `opencode serve` | Headless API / attach a TUI remotely |
| **Web / desktop** | `bun run --cwd packages/app dev` / Electron scripts | GUI clients on the same backend |

The TUI is the main product. Everything else talks to the same session engine.

---

## 1. Prerequisites

- **Bun 1.3+** (this repo pins `bun@1.3.9`). Install from [bun.sh](https://bun.sh).
- A **modern terminal** (Ghostty, WezTerm, Kitty, Alacritty, iTerm2).
- An **LLM API key** (Anthropic, OpenAI, Google, OpenCode Zen, a local proxy, …).
- **Git**, if you want `/undo` / `/redo` of file edits (they snapshot via git).

Check Bun:

```bash
bun --version
```

---

## 2. Run this repo (not the public binary)

Do **not** `npm i -g opencode-ai` if you want the features in this fork. That installs upstream.

From the repo root:

```bash
bun install
```

### Fastest: development TUI

```bash
# OpenCode against some other project
bun dev /path/to/your/project

# OpenCode against this repo itself
bun dev .
```

`bun dev` is the local equivalent of the `opencode` binary. Subcommands work the same:

```bash
bun dev --help
bun dev auth login
bun dev run "What does packages/opencode/src/session/llm.ts do?"
```

### Standalone binary

```bash
./build.sh --single
```

The binary lands under `packages/opencode/dist/`, for example:

```bash
./packages/opencode/dist/opencode-darwin-arm64/bin/opencode
```

Replace `darwin-arm64` with your platform (`darwin-x64`, `linux-x64`, …). You can alias that path as `opencode` for the rest of this tutorial.

Desktop installers (optional):

```bash
./script/build-mac.sh          # .dmg
./script/build-windows.sh      # Windows installer
```

---

## 3. First 10 minutes

### 3.1 Log in a provider

```bash
bun dev auth login
```

Or, once the TUI is open, type `/connect`.

Credentials are stored at `~/.local/share/opencode/auth.json`. Environment variables and a project `.env` are also picked up.

List what you have:

```bash
bun dev auth list
bun dev models
```

### 3.2 Open a project

```bash
cd /path/to/your/project
bun dev /path/to/your/project   # from the OpenCode repo
# or, if you built a binary:
opencode
```

On first launch, pick a model with `/models` (or `Ctrl+X` then `M`). Format is `provider/model`, for example `anthropic/claude-sonnet-4-5`.

`F2` cycles recently used models.

### 3.3 Teach it the repo

In the TUI prompt:

```text
/init
```

OpenCode scans the project and writes (or updates) `AGENTS.md` at the project root. Commit that file. It is the main way you give durable instructions: layout, test commands, style, what not to touch.

Then send a real first prompt:

```text
Give me a 10-line map of this repo: what to run, where the core lives, and the riskiest directories to edit.
```

You can `@`-mention files while typing; that fuzzy-searches the working directory and attaches the file:

```text
How does auth work in @packages/functions/src/api/index.ts?
```

Prefix a line with `!` to run a shell command and feed the output into the conversation:

```text
!git status
```

---

## 4. Daily TUI workflow

### Agents (Tab)

Two built-in **primary** agents. Cycle with `Tab` / `Shift+Tab`.

| Agent | Role |
| --- | --- |
| **build** | Default. Full tools: edit files, run bash, search, … |
| **plan** | Read/analyze. File edits and bash default to *ask*. Use this to think before changing code. |

**Subagents** are invoked with `@name` (or by the primary agent on its own):

| Agent | Role |
| --- | --- |
| **explore** | Fast, read-only codebase search |
| **general** | Multi-step research / parallel work, can edit |

Example:

```text
@explore Find every place we parse JWT expiry, then summarize the call graph.
```

### Sessions

A **session** is one conversation (plus the file edits it made).

| Action | Slash | Key |
| --- | --- | --- |
| New session | `/new` | `Ctrl+X N` |
| List / resume | `/sessions` | `Ctrl+X L` |
| Compact (summarize old turns) | `/compact` | `Ctrl+X C` |
| Undo last turn **and** file changes | `/undo` | `Ctrl+X U` |
| Redo | `/redo` | `Ctrl+X R` |
| Stop generation | | `Escape` |
| Command palette | | `Ctrl+P` |
| Help | `/help` | `Ctrl+X H` |

Resume last session from the shell:

```bash
opencode --continue
# or
opencode -c
```

### Leader key

Most shortcuts use **`Ctrl+X` as leader**, then a letter: `M` models, `A` agents, `T` themes, `E` external editor, `Y` copy last assistant message, `Q` quit.

Newlines in the prompt: `Shift+Enter` or `Ctrl+J`.

### A typical edit loop

1. Stay on **plan** until you agree on the change.
2. `Tab` to **build**.
3. Ask for a small, testable change. Point at files with `@`.
4. Watch tool calls (edits, bash). Approve or deny when asked.
5. If it went wrong: `/undo`, tighten the prompt, try again.
6. When the thread is huge: `/compact`, or `/new` and keep going with `@` files.

---

## 5. Configure a project

Prefer **project-local** files so the team shares them.

```text
your-project/
  opencode.json          # models, permissions, loop, experimental
  AGENTS.md              # instructions (commit this)
  .cursor/rules/*.mdc    # Cursor-compatible rules (auto-discovered)
  .opencode/
    command/*.md         # custom slash commands
    agent/*.md           # custom agents
    skills/*/SKILL.md    # on-demand skills
    plugin/*.ts          # event hooks
```

Personal defaults (all projects) live in `~/.config/opencode/` (`opencode.json`, `tui.json`, `AGENTS.md`).

TUI theme/keybinds are **not** in `opencode.json`. Put them in `tui.json`.

### Minimal `opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
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

Permissions: `"allow"` runs immediately, `"ask"` prompts you, `"deny"` blocks.

This fork’s extra flags (see §7) also go here.

### Rules OpenCode will load

1. `AGENTS.md` walking up from the working directory (else `CLAUDE.md`)
2. `.cursor/rules/**/*.mdc` — Cursor frontmatter (`alwaysApply`, `globs`, `description`)
3. Global `~/.config/opencode/AGENTS.md`

You do **not** need to list `.mdc` files in config. Discovery is automatic.

Example Cursor rule:

```markdown
---
description: TypeScript conventions
globs: src/**/*.ts, src/**/*.tsx
alwaysApply: false
---

- Prefer `const` over `let`
- Use Bun APIs when available
```

`alwaysApply: true` injects the rule every session. With `globs`, it attaches when a matching file is read. With only `description`, the agent can load it when the task matches.

Full field reference: [`OPENCODE_CONFIG.md`](../OPENCODE_CONFIG.md).

---

## 6. Custom commands and skills

### Slash commands

Create `.opencode/command/test.md`:

```markdown
---
description: Run tests and fix failures
agent: build
---

Run the test suite. If anything fails, fix the smallest set of files that makes it green.
Show a short summary of what changed.
```

Then in the TUI:

```text
/test
```

Use `$ARGUMENTS` (or `$1`, `$2`) in the markdown body to pass extra text after the command name.

### Skills

Skills are folders with a `SKILL.md`. The agent sees names/descriptions and loads the full file on demand via the `skill` tool.

```text
.opencode/skills/git-release/SKILL.md
```

```markdown
---
name: git-release
description: Cut a release: changelog, tag, and sanity checks
---

1. Inspect commits since the last tag.
2. Draft changelog bullets.
3. Do not push tags unless the user asked.
```

Also discovered: `.claude/skills/`, `.agents/skills/`, and `~/.config/opencode/skills/`.

This checkout ships **Superpowers** as a plugin: a methodology (brainstorm → spec → plan → TDD → review) plus those skills. Hands-on guide: [`superpowers.md`](superpowers.md).

---

## 7. Features specific to this fork

### 7.1 Non-streaming (`disable_stream`)

Normal OpenCode uses `streamText()` so tokens appear as they arrive. Some providers, proxies, or local models break on SSE (hangs, truncated tool JSON).

This repo can wait for a **complete** `generateText()` response, then replay it as a fake stream so the rest of the UI is unchanged.

Enable in project or global config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "disable_stream": true
  }
}
```

This checkout’s own `opencode.json` already sets that. Tradeoff: no live typing; the UI sits until the full reply is ready.

Leave it `false` (or omit it) for the usual streaming experience.

### 7.2 `/loop` — long goals across compaction

Use this when the work will take many turns and you do not want to babysit “continue”.

```text
/loop 2h ship the auth refactor
/loop 50 @docs/roadmap.md
/loop stop
```

Budgets are optional and combinable:

| Form | Meaning |
| --- | --- |
| `2h`, `30m`, `90s`, `1d` | Time deadline |
| `50` | Max continuation rounds |
| free text or `@file` | The goal |

The agent must finish with `LOOP_DONE` or `LOOP_BLOCKED`. Compaction can run in the middle; the loop continues. State is stored in the local SQLite DB, so a restart can resume the same loop.

**Verify before “done”** so completion is not honor-system:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "loop": {
    "verify": ["bun typecheck", "bun test"]
  }
}
```

Each command runs from the project directory. If any exits non-zero, `LOOP_DONE` is rejected and the agent gets the output. `LOOP_BLOCKED` always stops without verify.

Give `/loop` a **concrete done condition**. Vague goals wander until the budget expires.

### 7.3 `/repeat` — many items, isolated chats

Use this when the same job must run on hundreds or thousands of inputs. The parent agent **prepares** the list; the system then runs **one fresh child session per item** so the parent context never fills with transcripts.

```text
/repeat translate every markdown file in docs/ to Chinese
/repeat 2h lint-fix packages/*
/repeat stop
```

Budgets are optional (same tokens as `/loop`): `2h` is a deadline; `50` caps how many items run.

**Prepare** — the parent LLM:

1. Discovers inputs (glob, grep, a script).
2. Writes them to a JSONL file (one item per line, or `{"input":"..."}`). **Do not paste the list into chat.**
3. Calls the `repeat` tool with `action=ready` and `file` or `glob`, or replies `REPEAT_READY docs/**/*.md`.

Inline `items` in the tool are capped at 50. Larger queues must be a file or glob.

**Run** — the system, not the parent LLM:

- Items run **one by one** in isolated child sessions.
- A failure is recorded; the queue **continues**.
- Successful children are archived so the sidebar does not grow to thousands of tabs. Failed children stay inspectable.
- You get **one** summary at the end (`N ok, M failed`), not a dump of every item.

The header badge shows progress, for example `repeat 47/1000 · 3 fail`.

### 7.4 `/team` — parallel specialists

Team mode is **off by default**. Enable it:

```bash
OPENCODE_EXPERIMENTAL_TEAM_MODE=1 bun dev /path/to/project
```

Or `OPENCODE_EXPERIMENTAL=1` (turns on several experimental flags). Optional config:

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

Then:

```text
/team review auth for XSS and add tests
```

The **lead** (your current session) creates a team, fills a task board, and spawns 2–3 teammates. Typical split:

- **explore** scout, `worktree: false` — research only
- **build** writer — isolated git worktree by default
- optional reviewer, read-only

The session header shows a live badge, for example `team:auth-review · 2 busy · 1 idle`.

Ask at any time:

```text
Show team status and the task board.
```

The lead should call `team({ action: "status" })`. When a builder finishes, the lead merges the worktree (`action=merge`) then `cleanup`.

Tips:

- Prefer 2–3 teammates, not a crowd.
- `delegate: true` on create so the lead only coordinates (write tools denied until cleanup).
- `plan_approval: true` on risky writers — lead must `approve` before they can edit.
- Nested `task` subagents cannot use the `team` tool.

If `/team` is missing, the flag is off. See [`packages/opencode/src/team/README.md`](../packages/opencode/src/team/README.md) for the full tool reference.

---

## 8. One-shot CLI and headless server

Non-interactive:

```bash
opencode run "Explain how SessionProcessor handles tool calls"
opencode run -m anthropic/claude-sonnet-4-5 -f src/index.ts "Review this file"
opencode run --format json "List the public exports of packages/sdk/js" 
opencode run -c "Continue from last session: finish the remaining todos"
```

Headless API (default port 4096):

```bash
opencode serve --port 4096
# another terminal:
opencode attach http://127.0.0.1:4096
opencode run --attach http://127.0.0.1:4096 "Summarize git diff"
```

Web UI during development: start `serve`, then `bun run --cwd packages/app dev`.

---

## 9. MCP (optional)

MCP servers give the agent extra tools (browser, tickets, docs, …).

```bash
opencode mcp add
opencode mcp list
```

Or in `opencode.json`:

```json
{
  "mcp": {
    "example": {
      "type": "local",
      "command": ["npx", "-y", "some-mcp-server"]
    }
  }
}
```

---

## 10. Suggested practice path

Do these in order on a throwaway clone of a repo you know.

1. **Map** — `/init`, then “summarize how tests are run”.
2. **Read-only** — `Tab` to plan, ask for a change proposal, do not apply it yet.
3. **Small edit** — `Tab` to build, implement one function, run tests with `!`.
4. **Undo** — `/undo` and confirm the files reverted.
5. **Rules** — add a `.cursor/rules` glob rule and a line in `AGENTS.md`; ask the agent to follow them.
6. **Loop** — `/loop 20m` with `loop.verify` pointed at a real test command.
7. **Repeat** — `/repeat` on a glob of files (write the list to JSONL; do not paste it).
8. **Team** — `OPENCODE_EXPERIMENTAL_TEAM_MODE=1`, then `/team` on a task that splits into research + implementation.

---

## 11. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Features from this README missing | You are on the public npm/brew binary. Run `bun dev` or the binary from `packages/opencode/dist`. |
| No models / auth errors | `opencode auth login`, `opencode models --refresh`. Confirm `~/.local/share/opencode/auth.json`. |
| Hangs or truncated tool calls | Set `experimental.disable_stream: true`. |
| `/team` or `team` tool missing | Export `OPENCODE_EXPERIMENTAL_TEAM_MODE=1`. |
| Agent “done” but tests fail | Add `loop.verify`; `/loop` will reject `LOOP_DONE`. |
| `/undo` does nothing to files | Project is not a git repo. |
| Permission prompts forever | Tighten `permission` in `opencode.json` (`allow` / `deny` / glob rules). |
| `bun install` / models.dev fails | `./build.sh` caches `https://models.dev/api.json` under `~/.cache/opencode/models.json`. You can set `MODELS_DEV_API_JSON=/path/to/api.json`. |
| Tests | Never run tests from the repo root. From `packages/opencode`: `bun test`. Typecheck: `bun typecheck` in that package. |

Logs: `~/.local/share/opencode/log/`.

---

## Where to go next

| Topic | Location |
| --- | --- |
| Superpowers (design → plan → TDD plugin) | [`superpowers.md`](superpowers.md) |
| How Superpowers bootstraps the first user message | [`superpowers-bootstrap.md`](superpowers-bootstrap.md) |
| Exhaustive config (for agents and humans) | [`OPENCODE_CONFIG.md`](../OPENCODE_CONFIG.md) |
| Team mode internals | [`packages/opencode/src/team/README.md`](../packages/opencode/src/team/README.md) |
| Contributing / `bun dev` details | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Upstream user docs | [opencode.ai/docs](https://opencode.ai/docs) |
