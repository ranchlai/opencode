# Superpowers tutorial (this repo)

[Superpowers](https://github.com/obra/superpowers) is a **methodology plugin** for coding agents: a bootstrap plus a library of skills that force design → plan → TDD → review instead of jumping straight into code.

This guide is for **this OpenCode checkout**. The plugin is already listed in the repo `opencode.json`. By the end you will have verified it loaded, walked the default feature workflow on a throwaway task, and known which skill fires when.

The main OpenCode tutorial is [`README.md`](README.md). Read that first if you have not yet run `bun dev`.

---

## 0. What Superpowers is (and is not)

Superpowers does **not** add new slash commands like `/loop` or `/team`. It injects instructions at session start and registers skills the agent loads with OpenCode's native `skill` tool.

| Piece | Role |
| --- | --- |
| **Bootstrap** (`using-superpowers`) | Injected into the first user message of every session. Rule: if a skill might apply, invoke it *before* answering or exploring. |
| **Skills** (`superpowers/skills/*/SKILL.md`) | Process playbooks. The agent sees names/descriptions, then loads the full file on demand. |
| **Plugin** (`superpowers/.opencode/plugins/superpowers.js`) | Registers the skills directory and injects the bootstrap via `experimental.chat.messages.transform`. |

Philosophy, in one line each:

- **TDD** — no production code without a failing test first
- **Systematic over ad-hoc** — root cause before a fix; evidence before "done"
- **YAGNI / DRY** — smallest design that works
- **Skills are mandatory** — not suggestions. The bootstrap treats skipping them as rationalization.

This is independent of this fork's `/loop` and `/team`. You can use Superpowers alone, or combine: brainstorm + plan with Superpowers, then `/loop` a long execution, or `/team` for parallel specialists.

---

## 1. How it is wired in this checkout

Repo-root `opencode.json` already has:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "experimental": {
    "disable_stream": true
  },
  "plugin": ["superpowers@git+https://github.com/obra/superpowers.git"]
}
```

On `bun dev` / `opencode`, OpenCode's plugin manager clones that git spec, loads `package.json` `"main"` (`.opencode/plugins/superpowers.js`), then:

1. **`config` hook** — appends Superpowers' `skills/` directory to `config.skills.paths`, so skills are discovered with no symlinks.
2. **Message transform** — prepends the `using-superpowers` body plus an OpenCode tool map to the first user message. Later steps skip re-injection if that text is already there. Internals: [`superpowers-bootstrap.md`](superpowers-bootstrap.md).

The `superpowers/` directory in this repo is a **local clone of the plugin source** (read the skills, run plugin tests). Runtime install is still the git plugin spec above unless you point `plugin` at the local folder.

### Use the local tree instead of GitHub

Useful when you are editing skills in `superpowers/`:

```json
{
  "plugin": ["./superpowers"]
}
```

Restart OpenCode after changing `plugin`.

### Personal vs project plugin

| Location | File | Scope |
| --- | --- | --- |
| This repo | `opencode.json` | Anyone who runs OpenCode **in this checkout** |
| Your machine | `~/.config/opencode/opencode.json` | Every project |

If you also use Claude Code, Cursor, Codex, etc., install Superpowers **separately** in each harness. OpenCode does not share their plugin stores.

---

## 2. First 10 minutes

### 2.1 Start this checkout

From the repo root (see [`README.md`](README.md) §2):

```bash
bun install
bun dev .
```

You need a logged-in provider (`bun dev auth login` or `/connect`).

### 2.2 Smoke check

In a **new** TUI session (`/new`), send exactly:

```text
Tell me about your superpowers
```

A working install answers from the bootstrap: it has Superpowers, it must invoke skills before acting, and it can name the library (brainstorming, TDD, systematic-debugging, …). It should **not** try to load `using-superpowers` again with the `skill` tool — that content is already injected.

If the model has no idea what you mean, the plugin did not load. Jump to §9.

Optional log check:

```bash
bun dev run --print-logs "hello" 2>&1 | grep -i superpowers
```

### 2.3 List and load a skill

Ask:

```text
Use the skill tool to list skills, then load brainstorming and summarize its hard gate in two sentences.
```

You should see `skill` tool calls, then a summary of: **no implementation until a design is presented and you approve it.**

Skill lookup order (first match wins):

1. Project: `.opencode/skills/`, also `.claude/skills/` and `.agents/skills/`
2. Personal: `~/.config/opencode/skills/`
3. Superpowers' bundled `skills/`

---

## 3. The default feature workflow

This is the path Superpowers is built around. Skills **auto-trigger** from the bootstrap; you do not type skill names unless you want to force one.

```text
brainstorming
    → spec at docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
using-git-worktrees   (isolated branch / worktree)
writing-plans
    → plan at docs/superpowers/plans/YYYY-MM-DD-<feature>.md
subagent-driven-development   (or executing-plans)
    ↻ per task: test-driven-development + requesting-code-review
finishing-a-development-branch
```

### 3.1 Brainstorming — design before code

Trigger by asking to **build or change behavior**, even something small:

```text
Let's add a CLI flag that prints the loaded plugin names and exits.
```

What should happen:

1. Agent explores the repo (layout, similar flags, recent commits).
2. Questions **one at a time** (purpose, constraints, success).
3. Two or three approaches with a recommendation (YAGNI).
4. Design in digestible sections; it waits for your OK on each.
5. Writes `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, commits, asks you to review the file.
6. Only then invokes **writing-plans**.

**Hard gate:** no scaffolding, no implementation skill, no "quick prototype" until you approve the design. "This is too simple" is explicitly an anti-pattern; a tiny change still gets a short design.

If the work is several independent subsystems, brainstorming should split them into separate spec → plan → implement cycles.

**Visual companion (optional):** if a question is clearer as a mockup than as prose, the agent may offer a local brainstorm server (browser tab). Session files land in `<project>/.superpowers/brainstorm/`. Add `.superpowers/` to `.gitignore` if it is not there. To skip the Prime Radiant logo fetch: `SUPERPOWERS_DISABLE_TELEMETRY=1`.

### 3.2 Git worktrees — isolate the branch

After design approval, **using-git-worktrees** asks (unless you already said yes/no) whether to isolate:

> Would you like me to set up an isolated worktree? It protects your current branch from changes.

Say yes for real feature work. The agent prefers the harness's native isolation, then `git worktree`. If you are already in a worktree, it must not nest another.

Honor a standing preference in `AGENTS.md` so it stops asking.

### 3.3 Writing plans — junior-proof tasks

**writing-plans** turns the spec into `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`.

Expect:

- Header: goal, architecture, tech stack, global constraints
- File map before tasks
- Tasks small enough for a 2–5 minute step (failing test, run it, minimal code, tests pass, commit)
- Exact paths, commands, and verification — written as if the implementer has no repo context

Plans tell agentic workers to use **subagent-driven-development** (recommended) or **executing-plans**.

### 3.4 Execute the plan

| Skill | Use when |
| --- | --- |
| **subagent-driven-development** | Same session; tasks are mostly independent. Fresh implementer subagent per task (`task` / `general`), then a reviewer. Does **not** pause for "should I continue?" |
| **executing-plans** | You want a **separate** session with human checkpoints, or subagents are a poor fit. |

On OpenCode, "dispatch a subagent" is the `task` tool (`subagent_type: "general"` or `"explore"`).

During implementation, **test-driven-development** is in force:

1. **RED** — write one failing test, run it, confirm it fails for the right reason
2. **GREEN** — smallest code that passes
3. **REFACTOR** — clean up, stay green
4. Commit

Code written *before* the failing test is supposed to be **deleted**, not "adapted". Exceptions (prototypes, generated code, config) need you to say so.

After each SDD task: **requesting-code-review** (spec compliance, then quality). Critical findings block the next task.

### 3.5 Finish the branch

When the plan is done and tests are green, **finishing-a-development-branch** runs the full suite, then asks you:

1. Merge back to the base branch locally
2. Push and create a pull request
3. Keep the branch as-is

It should not discard work unless you explicitly ask. After a local merge it cleans up the worktree it created.

---

## 4. The other skills (when they fire)

These sit beside the happy path. The bootstrap still requires invoking them **before** improvising.

| Skill | Trigger |
| --- | --- |
| **systematic-debugging** | Any bug, test failure, unexpected behavior. Four phases; **no fix until root cause** (read errors, reproduce, recent changes, evidence). |
| **verification-before-completion** | About to say "fixed", "tests pass", or "done". Must run the proving command **in that turn** and paste evidence. Prior runs do not count. |
| **dispatching-parallel-agents** | Two or more **independent** investigations (unrelated failing tests, separate subsystems). Not for coupled failures. |
| **requesting-code-review** | End of a major chunk, before merge, or when stuck. Reviewer is a fresh subagent with SHAs + spec, not the implementer's chat history. |
| **receiving-code-review** | You (or another agent) pasted review comments. Verify against the codebase; push back if the comment is wrong; no performative agreement. |
| **writing-skills** | Creating or editing a `SKILL.md`. Treats skill authoring as TDD: baseline a failing agent, then write the skill. |
| **using-superpowers** | Always-on bootstrap. Do not reload it with `skill`. |

Priority when several apply: **process skills first** (brainstorming, systematic-debugging), then implementation. User instructions (`AGENTS.md`, explicit "skip brainstorming") beat skills.

---

## 5. What you type vs what the agent does

You usually talk in goals. The agent is supposed to pick skills.

| You say | Should happen |
| --- | --- |
| "Let's build X" / "add a feature" | `brainstorming` immediately — not `apply_patch` |
| "Fix this bug" / paste a stack trace | `systematic-debugging` before any patch |
| "Implement the plan in `docs/superpowers/plans/…`" | `subagent-driven-development` or `executing-plans` |
| "Ship it" / "we're done" | `verification-before-completion`, then `finishing-a-development-branch` |
| "Review this" | `requesting-code-review` |
| "Skip the design, just write it" | Follows **you**; skills yield to explicit user instructions |

To **force** a skill:

```text
Use the brainstorming skill. I want a spec for retrying failed provider HTTP calls.
```

To **skip** one, be explicit:

```text
Skip brainstorming and TDD. Make the smallest config change in opencode.json and stop.
```

---

## 6. Tool mapping (OpenCode)

Skills are written harness-agnostically ("create a todo", "dispatch a subagent"). The bootstrap maps them:

| Skill language | OpenCode tool |
| --- | --- |
| Create / complete todos | `todowrite` |
| `Subagent (general-purpose):` | `task` with `subagent_type: "general"` |
| Codebase exploration subagent | `task` with `subagent_type: "explore"` |
| Invoke a skill | `skill` |
| Read a file | `read` |
| Create / edit / delete files | `apply_patch` (and this fork's edit tools) |
| Shell | `bash` |
| Search | `grep`, `glob` |
| Fetch a URL | `webfetch` |

---

## 7. Your own skills next to Superpowers

Same format as [`README.md`](README.md) §6. Example personal skill:

```text
~/.config/opencode/skills/release-notes/SKILL.md
```

```markdown
---
name: release-notes
description: Use when drafting changelog or release notes from git history
---

1. Collect commits since the last tag.
2. Group by breaking / feature / fix.
3. Do not invent user-facing changes that are not in the diff.
```

Project skills: `.opencode/skills/<name>/SKILL.md`. They override Superpowers skills with the same name.

Keep Superpowers skills in `superpowers/` if you are contributing upstream; do not fork-specific workflows into that tree. Upstream rejects domain-specific or harness-only skills in core.

---

## 8. Practice path

Do this on a **throwaway clone** or a throwaway branch of a repo you know. Stay in the TUI (`bun dev /path/to/that/repo`).

1. **Smoke** — `/new`, then "Tell me about your superpowers". Confirm bootstrap, not a web search.
2. **Tiny design** — "Let's add a `--version` flag" (or equivalent). Answer questions; refuse to let it code until you approve a short design. Confirm a spec file under `docs/superpowers/specs/`.
3. **Plan** — approve the spec. Confirm a plan with RED/GREEN steps and real file paths.
4. **TDD** — say "go". Watch a failing test get run *before* production code. If it writes the implementation first, `/undo` and tell it to follow test-driven-development.
5. **Debug** — break a test on purpose, paste the failure, require systematic-debugging (root cause named) before a fix.
6. **Verify** — when it claims green, check that `verification-before-completion` ran the test command in that turn.
7. **Finish** — complete the toy feature and take option 3 (keep the branch) or delete the branch yourself.

Optional: combine with this fork — after a Superpowers plan exists, `/loop 30m` with `loop.verify` pointed at the plan's test command.

---

## 9. Troubleshooting

| Symptom | What to check |
| --- | --- |
| Agent never heard of Superpowers | `plugin` missing or typo in `opencode.json`. Restart after edits. Confirm you are on `bun dev` / this repo's binary, not public `opencode-ai`. |
| Skills listed but no bootstrap | OpenCode version without `experimental.chat.messages.transform`. Update this checkout. |
| Skills not listed | Ask it to use the `skill` tool. Plugin `config` hook must have pushed `superpowers/skills`. Each skill needs YAML frontmatter in `SKILL.md`. |
| Jumps into code on "let's build X" | Bootstrap not in the **first** user message (new session after plugin load). Say "use the brainstorming skill" once; if that works, injection is the bug. |
| Reloads `using-superpowers` via `skill` | Harmless but wasteful. Bootstrap already says not to. |
| Git plugin never updates | OpenCode/Bun may pin the git clone. Clear the plugin cache or pin a tag: `superpowers@git+https://github.com/obra/superpowers.git#v6.2.0`. |
| Windows git plugin install fails | Install with system npm into `~/.config/opencode` and set `"plugin": ["~/.config/opencode/node_modules/superpowers"]`. Details: [`superpowers/docs/README.opencode.md`](../superpowers/docs/README.opencode.md). |
| Old symlink install fighting the plugin | Remove `~/.config/opencode/plugins/superpowers.js` and `~/.config/opencode/skills/superpowers`. |
| Agent skips TDD / debugging | Quote the skill by name. Check `AGENTS.md` is not contradicting it. |

Logs: `~/.local/share/opencode/log/`.

---

## 10. Updating and contributing

**As a user of this OpenCode fork:** bump or unpin the git spec in `opencode.json`, restart, smoke-check with "Tell me about your superpowers".

**As someone editing `superpowers/`:** that tree is its own project (MIT, [obra/superpowers](https://github.com/obra/superpowers)). PRs must target their `dev` branch, fill their PR template, and they reject most agent-authored skill rewrites without eval evidence. Read `superpowers/CLAUDE.md` before touching skill prose.

Plugin-only tests (no LLM):

```bash
# from superpowers/
tests/opencode/run-tests.sh
```

Skill-behavior evals live in a separate harness (`evals/`); see `superpowers/docs/testing.md`.

---

## Where to go next

| Topic | Location |
| --- | --- |
| OpenCode TUI, `/loop`, `/team` | [`README.md`](README.md) |
| Superpowers README (all harnesses) | [`superpowers/README.md`](../superpowers/README.md) |
| OpenCode-specific plugin docs | [`superpowers/docs/README.opencode.md`](../superpowers/docs/README.opencode.md) |
| How bootstrap lands in the first user message | [`superpowers-bootstrap.md`](superpowers-bootstrap.md) |
| Porting / how bootstrap injection works | [`superpowers/docs/porting-to-a-new-harness.md`](../superpowers/docs/porting-to-a-new-harness.md) |
| Skill files (source of truth) | [`superpowers/skills/`](../superpowers/skills/) |
| Original announcement | [blog.fsck.com — Superpowers](https://blog.fsck.com/2025/10/09/superpowers/) |
