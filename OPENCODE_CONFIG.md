# OpenCode Configuration Reference (for AI agents)

> **Audience:** Another AI (or human) that needs to **read, create, or modify** OpenCode configuration.
> **Source of truth:** `packages/opencode/src/config/config.ts`, `flag/flag.ts`, `session/instruction.ts`, `session/rule.ts`, `skill/skill.ts`, `agent/agent.ts`.
> **JSON Schema:** `https://opencode.ai/config.json` (runtime) · `https://opencode.ai/tui.json` (TUI)
> **Human docs:** [https://opencode.ai/docs](https://opencode.ai/docs)

This document is exhaustive and machine-oriented. Prefer exact field names below when editing configs.

---

## 0. What OpenCode is (one paragraph)

OpenCode is an AI coding agent (CLI / TUI / server / SDK). Behavior is shaped by:

1. **Runtime config** (`opencode.json` / `opencode.jsonc`) — models, permissions, MCP, agents, LSP, etc.
2. **TUI config** (`tui.json` / `tui.jsonc`) — theme, keybinds, scroll (separate from runtime).
3. **Instruction / rule files** — `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, plus `instructions` globs.
4. **Auto-discovered markdown assets** — agents, commands, skills, plugins, tools, themes under config directories.
5. **Auth / credentials** — `~/.local/share/opencode/auth.json` and provider env vars.
6. **Environment flags** — `OPENCODE_`* overrides.

When modifying config for a project, prefer **project-local** files so changes are version-controlled. Use global config only for personal preferences.

---



## 1. Where to put files (decision guide)


| Goal                                         | Put it here                                                           |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Project settings shared with team            | `<repo>/opencode.json` or `<repo>/opencode.jsonc`                     |
| Project agents / commands / skills / plugins | `<repo>/.opencode/` (see layout below)                                |
| Project LLM instructions                     | `<repo>/AGENTS.md` (preferred) or `.cursor/rules/*.mdc`               |
| Personal defaults for all projects           | `~/.config/opencode/opencode.json` and `~/.config/opencode/AGENTS.md` |
| Personal TUI theme/keybinds                  | `~/.config/opencode/tui.json`                                         |
| Extra config directory (CI / profiles)       | `$OPENCODE_CONFIG_DIR`                                                |
| One-off file override                        | `$OPENCODE_CONFIG=/path/to/file.json`                                 |
| Inline override (CI)                         | `$OPENCODE_CONFIG_CONTENT='{"model":"..."}'`                          |
| Disable project config entirely              | `OPENCODE_DISABLE_PROJECT_CONFIG=1`                                   |




### Typical project layout

```text
<repo>/
  opencode.json                 # runtime config (optional)
  tui.json                      # TUI config (optional)
  AGENTS.md                     # project instructions (recommended)
  CLAUDE.md                     # used only if AGENTS.md missing
  .cursor/rules/*.mdc           # Cursor-compatible rules (auto-discovered)
  .opencode/
    agent/ or agents/           # custom agents (*.md)
    command/ or commands/       # slash commands (*.md)
    skill/ or skills/           # skills (**/SKILL.md)
    plugin/ or plugins/         # local plugins (*.ts|*.js)
    tool/ or tools/             # custom tools (*.ts|*.js)
    themes/                     # custom TUI themes (*.json)
    opencode.json               # also loaded if present under .opencode
  .claude/skills/**/SKILL.md    # Claude Code skills (compat)
  .agents/skills/**/SKILL.md    # Agents skills (compat)
```



### Global layout

```text
~/.config/opencode/
  opencode.json | opencode.jsonc | config.json
  tui.json | tui.jsonc
  AGENTS.md
  agent|agents/, command|commands/, skill|skills/, plugin|plugins/, themes/, tool|tools/

~/.local/share/opencode/
  auth.json                     # provider OAuth / API keys (mode 0600)
  mcp-auth.json                 # MCP OAuth tokens
  snapshot/, plans/, log/, bin/

~/.cache/opencode/
  models.json
  skills/                       # cached remote skills

~/.opencode/                    # also scanned as a config directory
```

Managed / enterprise override dirs (highest precedence for config files only):

- macOS: `/Library/Application Support/opencode`
- Windows: `%ProgramData%/opencode`
- Linux: `/etc/opencode`

---



## 2. Config merge precedence (critical)

Runtime config layers merge **low → high** (later wins). Deep merge.


| Order | Source                                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Remote org defaults from well-known auth (`type: "wellknown"`)                                                                                                                                               |
| 2     | Global `~/.config/opencode/opencode.json{,c}`                                                                                                                                                                |
| 3     | `$OPENCODE_CONFIG` file                                                                                                                                                                                      |
| 4     | Project `opencode.json{,c}` (find-up cwd → worktree) — skipped if `OPENCODE_DISABLE_PROJECT_CONFIG`                                                                                                          |
| 5     | Config directories (global, `.opencode` walk, `~/.opencode`, `$OPENCODE_CONFIG_DIR`): load agents/commands/plugins/skills; load `opencode.json` if dir ends with `.opencode` or equals `OPENCODE_CONFIG_DIR` |
| 6     | `$OPENCODE_CONFIG_CONTENT` inline JSON                                                                                                                                                                       |
| 7     | Active OpenCode account / org API config                                                                                                                                                                     |
| 8     | Managed enterprise directory (highest)                                                                                                                                                                       |


**Special merge rules:**

- Arrays `plugin` and `instructions` are **concatenated and deduplicated**, not replaced.
- Plugin names: later duplicate wins.
- Deprecated `mode` → migrated into `agent` with `mode: "primary"`.
- Legacy top-level `tools` → converted to `permission` (`write`/`edit`/`patch`/`multiedit` → `edit`).
- `autoshare: true` → `share: "auto"` if `share` unset.
- Flags can override: `OPENCODE_PERMISSION` (JSON merge), `OPENCODE_DISABLE_AUTOCOMPACT` → `compaction.auto=false`, `OPENCODE_DISABLE_PRUNE` → `compaction.prune=false`.

**String substitutions** inside JSON config text:

- `{env:VAR_NAME}` — environment variable
- `{file:path}` — file contents (relative to config file directory; `~/` allowed)

**TUI config** (`tui.json`) is merged separately: global → `$OPENCODE_TUI_CONFIG` → project → `.opencode` dirs → managed.

**Do not put** `theme` / `keybinds` / nested `tui` in `opencode.json` anymore — they belong in `tui.json` (runtime strips them with a warning).

---



## 3. Minimal `opencode.json` examples

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-5",
  "small_model": "anthropic/claude-haiku-4-5"
}
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "openai/gpt-5",
  "permission": {
    "edit": "allow",
    "bash": "ask",
    "read": {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow"
    }
  },
  "instructions": ["CONTRIBUTING.md", "docs/guidelines.md"],
  "mcp": {
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "enabled": true
    }
  }
}
```

JSONC (comments + trailing commas) is supported via `opencode.jsonc`.

---



## 4. Complete `opencode.json` field reference

Schema is **strict** (`Config.Info`). Unknown top-level keys fail validation.

### 4.1 Top-level fields


| Field                | Type                                       | Meaning                                                           |
| -------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `$schema`            | `string?`                                  | Prefer `https://opencode.ai/config.json`                          |
| `logLevel`           | `"DEBUG" | "INFO" | "WARN" | "ERROR"?`     | Logging verbosity                                                 |
| `server`             | `Server?`                                  | For `opencode serve` / `web`                                      |
| `command`            | `Record<string, Command>?`                 | Named slash commands (also auto-loaded from markdown)             |
| `skills`             | `{ paths?: string[], urls?: string[] }?`   | Extra skill roots / remote skill indexes                          |
| `watcher`            | `{ ignore?: string[] }?`                   | File watcher ignore globs                                         |
| `plugin`             | `string[]?`                                | npm specs or `file://` paths; also auto-discovered                |
| `snapshot`           | `boolean?`                                 | `false` disables edit snapshots                                   |
| `share`              | `"manual" | "auto" | "disabled"?`          | Session sharing                                                   |
| `autoshare`          | `boolean?`                                 | **Deprecated** → use `share`                                      |
| `autoupdate`         | `boolean | "notify"?`                      | Auto-update behavior                                              |
| `disabled_providers` | `string[]?`                                | Disable auto-loaded providers (**wins over** `enabled_providers`) |
| `enabled_providers`  | `string[]?`                                | If set, **only** these providers are enabled                      |
| `model`              | `string?`                                  | Default model as `provider/model`                                 |
| `small_model`        | `string?`                                  | Lightweight model (titles, etc.) as `provider/model`              |
| `default_agent`      | `string?`                                  | Primary agent name; invalid → fall back toward `build`            |
| `username`           | `string?`                                  | Display name (default: OS user)                                   |
| `mode`               | agent map                                  | **Deprecated** → use `agent`                                      |
| `agent`              | agent map                                  | Built-ins + custom agent overrides                                |
| `provider`           | `Record<string, Provider>?`                | Provider/model overrides                                          |
| `mcp`                | `Record<string, Mcp | {enabled:boolean}>?` | MCP servers                                                       |
| `formatter`          | `false | Record<name, FormatterCfg>?`      | Format-on-write                                                   |
| `lsp`                | `false | Record<id, LspCfg>?`              | Language servers                                                  |
| `instructions`       | `string[]?`                                | Extra instruction files/globs/URLs (merged across layers)         |
| `layout`             | `"auto" | "stretch"?`                      | **Deprecated** (always stretch)                                   |
| `permission`         | `Permission?`                              | Global tool permissions (or bare `"allow"`/`"ask"`/`"deny"`)      |
| `tools`              | `Record<string, boolean>?`                 | **Deprecated** → converted to `permission`                        |
| `enterprise`         | `{ url?: string }?`                        | Enterprise / share base URL                                       |
| `compaction`         | `{ auto?, prune?, reserved? }?`            | Context compaction                                                |
| `loop`               | `{ verify?: string[] }?`                   | Autonomous `/loop` verify commands                                |
| `experimental`       | object                                     | See §4.12                                                         |




### 4.2 `server`

```ts
{
  port?: number          // positive int
  hostname?: string
  mdns?: boolean
  mdnsDomain?: string    // default conceptually opencode.local
  cors?: string[]        // full origins
}
```

Related env: `OPENCODE_SERVER_PASSWORD`, `OPENCODE_SERVER_USERNAME` (HTTP basic auth).

### 4.3 `command` (JSON)

```ts
{
  template: string       // required; may include $ARGUMENTS
  description?: string
  agent?: string
  model?: string         // provider/model
  subtask?: boolean
}
```

Also auto-loaded from `{command,commands}/**/*.md` (filename path = command name; frontmatter + body = template).

### 4.4 `skills`

```json
{
  "skills": {
    "paths": ["~/my-skills", "./local-skills"],
    "urls": ["https://example.com/.well-known/skills/"]
  }
}
```

Remote URLs fetch `{url}/index.json` and cache under `~/.cache/opencode/skills/`.

### 4.5 `mcp`

**Local:**

```json
{
  "type": "local",
  "command": ["npx", "-y", "some-mcp-server"],
  "environment": { "FOO": "bar" },
  "enabled": true,
  "timeout": 5000
}
```

**Remote:**

```json
{
  "type": "remote",
  "url": "https://example.com/mcp",
  "enabled": true,
  "headers": { "Authorization": "Bearer …" },
  "oauth": {
    "clientId": "…",
    "clientSecret": "…",
    "scope": "…"
  },
  "timeout": 5000
}
```

- `oauth` may be `false` to disable auto-detection.
- Partial override `{ "enabled": false }` is allowed.
- OAuth tokens stored in `~/.local/share/opencode/mcp-auth.json`.



### 4.6 `permission` (important)

Actions: `"ask" | "allow" | "deny"`.

May be a single action (`"allow"`) or an object. Key order is preserved; **last matching rule wins**.


| Key                                                                                          | Rule shape                              |
| -------------------------------------------------------------------------------------------- | --------------------------------------- |
| `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `external_directory`, `lsp`, `skill` | action **or** `Record<pattern, action>` |
| `todowrite`, `todoread`, `question`, `webfetch`, `websearch`, `codesearch`, `doom_loop`      | action only                             |
| `*` or any other tool / MCP tool name                                                        | via catchall                            |


Patterns support `*` and `?`. `~` / `$HOME` expand.

```json
{
  "permission": {
    "*": "ask",
    "read": {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow"
    },
    "edit": "allow",
    "bash": {
      "*": "ask",
      "git *": "allow",
      "bun test*": "allow"
    },
    "task": {
      "explore": "allow",
      "general": "allow",
      "code-reviewer": "deny"
    },
    "skill": {
      "*": "allow",
      "dangerous-*": "deny"
    },
    "doom_loop": "ask"
  }
}
```

**Also settable via** `OPENCODE_PERMISSION='{"bash":"deny"}'` (JSON merged in).

**Agent-level** `permission` merges on top of global permission for that agent.

Runtime defaults include broadly: tools allowed, `doom_loop: ask`, sensitive `.env` reads as `ask`, `external_directory` mostly `ask`, etc. Prefer explicit project rules when hardening.

### 4.7 `agent`

Named slots include built-ins: `plan`, `build` (primary); `general`, `explore` (subagent); `title`, `summary`, `compaction` (specialized/hidden). Catchall allows custom names.

```ts
{
  model?: string
  variant?: string
  temperature?: number
  top_p?: number
  prompt?: string
  tools?: Record<string, boolean>   // deprecated → permission
  disable?: boolean
  description?: string
  mode?: "subagent" | "primary" | "all"  // markdown agents default "all"
  hidden?: boolean                  // hide subagent from @ menu
  options?: Record<string, any>     // unknown keys folded into options
  color?: "#RRGGBB" | "primary"|"secondary"|"accent"|"success"|"warning"|"error"|"info"
  steps?: number                    // max agentic iterations
  maxSteps?: number                 // deprecated → steps
  permission?: Permission
}
```

**Markdown agents** under `{agent,agents}/**/*.md`:

```markdown
---
description: Reviews PRs for security issues
mode: subagent
model: anthropic/claude-sonnet-4-5
temperature: 0.1
color: "#FF5733"
steps: 20
permission:
  edit: deny
  bash: ask
---
Focus on auth, injection, and secret leakage.
```

Nested path `agents/foo/bar.md` → agent name `foo/bar`.

Permission merge order per agent: defaults → agent built-ins → global `permission` → agent `permission`.

### 4.8 `provider`

```ts
{
  // ModelsDev.Provider partial fields, plus:
  whitelist?: string[]
  blacklist?: string[]
  models?: Record<modelId, ModelPartial & {
    variants?: Record<variantName, { disabled?: boolean, ... }>
  }>
  options?: {
    apiKey?: string
    baseURL?: string
    enterpriseUrl?: string      // GitHub Copilot Enterprise
    setCacheKey?: boolean
    timeout?: number | false    // default 300000 ms
    chunkTimeout?: number
    // + provider-specific catchall (e.g. Bedrock region/profile/endpoint)
  }
}
```

Model IDs are always referenced as `provider/model` at top-level `model` / `small_model` / agent `model`.

Providers appear when credentials/env exist (from models.dev). Filter with `enabled_providers` / `disabled_providers`.

Auth lives in `~/.local/share/opencode/auth.json` (do **not** commit). Connect via CLI `/connect` or `opencode providers`.

### 4.9 `formatter`

- `false` — disable all formatters
- or map:

```json
{
  "formatter": {
    "prettier": {
      "disabled": false,
      "command": ["prettier", "--write", "$FILE"],
      "environment": {},
      "extensions": [".ts", ".tsx", ".js"]
    }
  }
}
```



### 4.10 `lsp`

- `false` — disable all LSP
- Built-in server: `{ "disabled": true }` or `{ "command": [...], "extensions"?, "disabled"?, "env"?, "initialization"? }`
- **Custom** server IDs **require** `extensions`.

Built-in IDs include (non-exhaustive): `deno`, `typescript`, `vue`, `eslint`, `oxlint`, `biome`, `gopls`, `ruby-lsp`, `ty`, `pyright`, `elixir-ls`, `zls`, `csharp`, `fsharp`, `sourcekit-lsp`, `rust`, `clangd`, `svelte`, `astro`, `jdtls`, `kotlin-ls`, `yaml-ls`, `lua-ls`, `prisma`, `dart`, `ocaml-lsp`, `bash`, `terraform`, `texlab`, `dockerfile`, `gleam`, `clojure-lsp`, `nixd`, `tinymist`, `haskell-language-server`, `julials`, …

Env: `OPENCODE_DISABLE_LSP_DOWNLOAD=1` prevents auto-download.

### 4.11 `compaction` / `loop` / `enterprise`

```json
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 8192
  },
  "loop": {
    "verify": ["bun test", "bun typecheck"]
  },
  "enterprise": {
    "url": "https://opncd.ai"
  }
}
```

`loop.verify`: shell commands that must exit `0` before autonomous `/loop` or `/hard-loop` accepts `LOOP_DONE`. Run from project directory.

### 4.12 `experimental`

```json
{
  "experimental": {
    "disable_stream": false,
    "disable_paste_summary": false,
    "batch_tool": false,
    "openTelemetry": false,
    "primary_tools": ["edit", "bash"],
    "continue_loop_on_deny": false,
    "mcp_timeout": 30000,
    "team": {
      "max_members": 4,
      "default_worktree": true,
      "heartbeat_ms": 60000
    }
  }
}
```


| Field                   | Meaning                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `disable_stream`        | Use non-streaming `generateText` for LLM calls                               |
| `disable_paste_summary` | Disable paste summarization                                                  |
| `batch_tool`            | Enable batch tool                                                            |
| `openTelemetry`         | AI SDK experimental telemetry spans                                          |
| `primary_tools`         | Tools only available to primary agents                                       |
| `continue_loop_on_deny` | Keep agent loop going when a tool is denied                                  |
| `mcp_timeout`           | MCP request timeout (ms)                                                     |
| `team`                  | Team mode settings (requires `OPENCODE_EXPERIMENTAL_TEAM_MODE=1`; see below) |


`experimental.team` (fork / experimental multi-agent teams):


| Field              | Default       | Meaning                                               |
| ------------------ | ------------- | ----------------------------------------------------- |
| `max_members`      | `4` (max `8`) | Cap on teammates (not counting the lead)              |
| `default_worktree` | `true`        | Writers get an isolated git worktree                  |
| `heartbeat_ms`     | `60000`       | Busy teammates without a heartbeat are marked `error` |


Enable team mode with `OPENCODE_EXPERIMENTAL_TEAM_MODE=1` (or `OPENCODE_EXPERIMENTAL=1`). Then use `/team <goal>` in the TUI. See `packages/opencode/src/team/README.md` for the full workflow.

**Override the** `/team` **lead prompt** (useful for smaller models): define a custom command named `team` — it replaces the built-in slash template. Prefer a short, explicit prompt (e.g. require `member=` on spawn, max 2 teammates, call `status` after spawn).

Markdown (recommended):

```markdown
<!-- .opencode/commands/team.md -->
---
description: start an agent team for a goal
---

You are the lead of a small agent team.

## Goal
$ARGUMENTS

1. team action=create with a short name.
2. Add 1–2 tasks (action=tasks, task_action=add).
3. Spawn at most 2 teammates (action=spawn): set member=, agent=, prompt=, and worktree=false for explore.
4. Call action=status; when woken by idle teammates, synthesize and action=cleanup.

One tool call at a time. Keep teammate prompts short.
```

Or JSON:

```json
{
  "command": {
    "team": {
      "description": "start an agent team for a goal",
      "template": "You are the lead…\n\n## Goal\n$ARGUMENTS\n…"
    }
  }
}
```

Not configurable via config yet: tool description (`team` tool), active-session system blurb (`Team.prompt()`), and spawned-member bootstrap text.

Many experimental features are **env-gated** (see §8), not only this object.

### 4.13 `instructions`

```json
{
  "instructions": [
    "CONTRIBUTING.md",
    "docs/*.md",
    "packages/*/AGENTS.md",
    "~/shared/rules.md",
    "https://raw.githubusercontent.com/org/repo/main/STYLE.md"
  ]
}
```

- Relative globs resolve via find-up from cwd → worktree.
- HTTP(S) fetched with 5s timeout.
- Concatenated across config layers (deduped).
- `.mdc` files under auto-discovered `.cursor/rules/` are **not double-loaded** when also listed here; Cursor frontmatter modes still apply.

---



## 5. Instructions & rules (how the model gets project guidance)



### 5.1 Load order into the system prompt

1. Project `AGENTS.md` **or** (if missing) `CLAUDE.md` **or** deprecated `CONTEXT.md` — find-up from cwd toward worktree (first family wins).
2. Global: `$OPENCODE_CONFIG_DIR/AGENTS.md` → `~/.config/opencode/AGENTS.md` → `~/.claude/CLAUDE.md` (unless Claude prompt disabled).
3. Cursor rules with `alwaysApply: true` from `.cursor/rules/**/*.mdc`.
4. Paths from `instructions` (non-URL), excluding already-handled cursor rule paths.
5. Remote `instructions` URLs.
6. Catalog of Cursor **agent**-mode rules (descriptions + paths; model should `Read` when relevant).



### 5.2 Lazy attach (when the Read tool opens a file)

- Nested `AGENTS.md` / `CLAUDE.md` between the file and project root (not already in system).
- Cursor rules whose `globs` match the file.



### 5.3 Cursor `.mdc` rules (full support)

**Location:** `.cursor/rules/**/*.mdc` (also nested between cwd and worktree).

**Frontmatter:**

```markdown
---
description: TypeScript conventions
globs: src/**/*.ts, src/**/*.tsx
alwaysApply: false
---

Rule body here…
```


| `alwaysApply` | `description` | `globs` | Mode                                          |
| ------------- | ------------- | ------- | --------------------------------------------- |
| `true`        | —             | —       | **always** — every session                    |
| `false`       | —             | set     | **glob** — auto-attach on matching Read       |
| `false`       | set           | omitted | **agent** — listed; model Reads when relevant |
| `false`       | omitted       | omitted | **manual** — only via `@` / explicit Read     |


Notes for AIs editing rules:

- Extension **must** be `.mdc` for auto-discovery. Plain `.md` in `.cursor/rules/` is ignored unless listed in `instructions`.
- Frontmatter is stripped before injection; only the body is sent.
- `globs` may be a comma-separated string or a YAML array.
- Do **not** need to add `.cursor/rules/*.mdc` to `opencode.json`.



### 5.4 Prefer which instruction mechanism?


| Use case                             | Prefer                                  |
| ------------------------------------ | --------------------------------------- |
| Team-wide always-on project guidance | `AGENTS.md`                             |
| Path-scoped conventions (TS vs Go)   | `.cursor/rules/*.mdc` with `globs`      |
| Optional specialized playbooks       | `.mdc` with `description` **or** Skills |
| Reuse existing markdown docs         | `instructions: ["path"]`                |
| Personal preferences                 | `~/.config/opencode/AGENTS.md`          |


---



## 6. Skills

**File:** `**/SKILL.md` under skill directories.

**Required frontmatter (parsed in code):** `name`, `description`. Body = skill content.

**Discovery (later same-name overwrites):**

1. `~/.claude/skills`, `~/.agents/skills` (unless external skills disabled)
2. Project `.claude` / `.agents` (walk cwd→worktree)
3. Config dirs `{skill,skills}/**/SKILL.md`
4. `config.skills.paths`
5. `config.skills.urls`

Skills are loaded via the `skill` tool and gated by `permission.skill`.

Disable Claude/external skills: `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` or `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` (or master `OPENCODE_DISABLE_CLAUDE_CODE=1`).

---



## 7. Commands, plugins, custom tools, themes



### Commands

- JSON: `command.<name>`
- Markdown: `{command,commands}/**/*.md`
- Invoke in TUI as slash commands; template may use `$ARGUMENTS`.
- Same-name user commands **override** built-ins (e.g. `.opencode/commands/team.md` replaces `/team` when team mode is enabled). See §4.12 for a `/team` example tuned for weaker models.



### Plugins

- Config: `"plugin": ["@scope/pkg", "file:///abs/path"]`
- Auto: `{plugin,plugins}/*.{ts,js}` under config dirs
- Default auth plugins (Copilot/Codex) unless `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`



### Custom tools

- `{tool,tools}/*.{ts,js}` exporting a tool definition
- Controlled via `permission` by tool name



### Themes

- Built-ins (e.g. `tokyonight`, `catppuccin`, `opencode`, `system`, …)
- Custom: `{configDir}/themes/*.json`
- Selected in `tui.json`: `"theme": "tokyonight"`

---



## 8. Environment variables (`OPENCODE_*`)

Truthy = `"true"` or `"1"` (case-insensitive).

### Config / paths


| Variable                          | Effect                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| `OPENCODE_CONFIG`                 | Extra config file path                                             |
| `OPENCODE_CONFIG_CONTENT`         | Inline JSON/JSONC config                                           |
| `OPENCODE_CONFIG_DIR`             | Extra config directory                                             |
| `OPENCODE_TUI_CONFIG`             | Custom `tui.json` path                                             |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | Skip project `opencode.json`, `.opencode`, project rules discovery |
| `OPENCODE_PERMISSION`             | JSON permission object merged in                                   |
| `OPENCODE_STRICT_CONFIG_DEPS`     | Fail hard on bun install in config dirs                            |




### Features / safety


| Variable                                            | Effect                                      |
| --------------------------------------------------- | ------------------------------------------- |
| `OPENCODE_DISABLE_AUTOUPDATE`                       | Skip autoupdate                             |
| `OPENCODE_DISABLE_PRUNE`                            | `compaction.prune=false`                    |
| `OPENCODE_DISABLE_AUTOCOMPACT`                      | `compaction.auto=false`                     |
| `OPENCODE_DISABLE_TERMINAL_TITLE`                   | Don't set terminal title                    |
| `OPENCODE_DISABLE_DEFAULT_PLUGINS`                  | Skip built-in auth plugins                  |
| `OPENCODE_DISABLE_LSP_DOWNLOAD`                     | Don't auto-download LSPs                    |
| `OPENCODE_DISABLE_MODELS_FETCH`                     | Don't fetch models.dev                      |
| `OPENCODE_DISABLE_CLAUDE_CODE`                      | Disable Claude prompt + skills              |
| `OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`               | Skip `~/.claude/CLAUDE.md`                  |
| `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS`               | Skip `.claude`/`.agents` skills             |
| `OPENCODE_DISABLE_EXTERNAL_SKILLS`                  | Same for external skills                    |
| `OPENCODE_AUTO_SHARE`                               | Force auto-share                            |
| `OPENCODE_ENABLE_QUESTION_TOOL`                     | Force question tool outside app/cli/desktop |
| `OPENCODE_ENABLE_EXPERIMENTAL_MODELS`               | Experimental models                         |
| `OPENCODE_ENABLE_EXA` / `OPENCODE_EXPERIMENTAL_EXA` | Enable Exa websearch/codesearch             |




### Server / client / models


| Variable                                                | Effect                                         |
| ------------------------------------------------------- | ---------------------------------------------- |
| `OPENCODE_CLIENT`                                       | Default `"cli"`; also `app`, `desktop`, `acp`  |
| `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` | HTTP basic auth                                |
| `OPENCODE_MODELS_URL`                                   | models.dev base (default `https://models.dev`) |
| `OPENCODE_MODELS_PATH`                                  | Local models JSON override                     |
| `OPENCODE_GIT_BASH_PATH`                                | Windows Git Bash path                          |




### Experimental env


| Variable                                                     | Effect                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `OPENCODE_EXPERIMENTAL`                                      | Master experimental switch (enables several features)                  |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER` / `_DISABLE_FILEWATCHER` | File watcher toggles                                                   |
| `OPENCODE_EXPERIMENTAL_ICON_DISCOVERY`                       | Icon discovery                                                         |
| `OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT`               | Default true on win32 if unset                                         |
| `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`              | Positive int                                                           |
| `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`                     | Positive int                                                           |
| `OPENCODE_EXPERIMENTAL_OXFMT`                                | oxfmt                                                                  |
| `OPENCODE_EXPERIMENTAL_LSP_TY`                               | Prefer `ty` LSP                                                        |
| `OPENCODE_EXPERIMENTAL_LSP_TOOL`                             | Enable `lsp` tool                                                      |
| `OPENCODE_EXPERIMENTAL_PLAN_MODE`                            | Plan enter/exit tools                                                  |
| `OPENCODE_EXPERIMENTAL_TEAM_MODE`                            | Multi-agent `/team` + `team` tool (also via `OPENCODE_EXPERIMENTAL=1`) |
| `OPENCODE_EXPERIMENTAL_WORKSPACES`                           | Workspaces                                                             |
| `OPENCODE_EXPERIMENTAL_MARKDOWN`                             | Markdown renderer (default **on** unless `"false"`/`"0"`)              |


Also used: `OPENCODE_DISABLE_FILETIME_CHECK`, `OPENCODE_DISABLE_CHANNEL_DB`, `OPENCODE_SKIP_MIGRATIONS`, `OPENCODE_FAKE_VCS`, `OPENCODE_TEST_HOME`, `OPENCODE_TEST_MANAGED_CONFIG_DIR`, provider API keys from models.dev (`ANTHROPIC_API_KEY`, etc.), `VISUAL`/`EDITOR`.

---



## 9. TUI config (`tui.json`)

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "theme": "tokyonight",
  "scroll_speed": 1,
  "scroll_acceleration": { "enabled": true },
  "diff_style": "auto",
  "keybinds": {
    "leader": "ctrl+x",
    "session_new": "<leader>n",
    "model_list": "<leader>m"
  }
}
```


| Field                         | Type                  | Notes                                           |
| ----------------------------- | --------------------- | ----------------------------------------------- |
| `theme`                       | `string?`             | Built-in name, custom theme name, or `"system"` |
| `keybinds`                    | partial map           | Override defaults; `"none"` disables a binding  |
| `scroll_speed`                | `number?`             | min `0.001`                                     |
| `scroll_acceleration.enabled` | `boolean`             |                                                 |
| `diff_style`                  | `"auto" | "stacked"?` |                                                 |




### Default keybinds (reference)

Leader default: `ctrl+x`. Use `<leader>…` in bindings.


| Action                | Default                                      |
| --------------------- | -------------------------------------------- |
| `leader`              | `ctrl+x`                                     |
| `app_exit`            | `ctrl+c,ctrl+d,<leader>q`                    |
| `editor_open`         | `<leader>e`                                  |
| `theme_list`          | `<leader>t`                                  |
| `sidebar_toggle`      | `<leader>b`                                  |
| `status_view`         | `<leader>s`                                  |
| `session_new`         | `<leader>n`                                  |
| `session_list`        | `<leader>l`                                  |
| `session_timeline`    | `<leader>g`                                  |
| `session_export`      | `<leader>x`                                  |
| `session_compact`     | `<leader>c`                                  |
| `session_interrupt`   | `escape`                                     |
| `session_rename`      | `ctrl+r`                                     |
| `session_delete`      | `ctrl+d`                                     |
| `model_list`          | `<leader>m`                                  |
| `model_cycle_recent`  | `f2`                                         |
| `command_list`        | `ctrl+p`                                     |
| `agent_list`          | `<leader>a`                                  |
| `agent_cycle`         | `tab`                                        |
| `agent_cycle_reverse` | `shift+tab`                                  |
| `variant_cycle`       | `ctrl+t`                                     |
| `input_submit`        | `return`                                     |
| `input_newline`       | `shift+return,ctrl+return,alt+return,ctrl+j` |
| `messages_copy`       | `<leader>y`                                  |
| `messages_undo`       | `<leader>u`                                  |
| `messages_redo`       | `<leader>r`                                  |
| `tips_toggle`         | `<leader>h`                                  |


Many more bindings exist (input editing, message scroll, session tree). Full list: `Config.Keybinds` in `packages/opencode/src/config/config.ts`.

---



## 10. Built-in tools (permission targets)

Common tools an AI may need to allow/deny:


| Tool                                    | Role                                  |
| --------------------------------------- | ------------------------------------- |
| `bash`                                  | Shell                                 |
| `read`                                  | Read files                            |
| `edit` / write-family                   | Edit files (permission key is `edit`) |
| `glob` / `grep` / `list`                | Search / list                         |
| `task`                                  | Subagents (pattern = agent name)      |
| `skill`                                 | Load skills                           |
| `webfetch` / `websearch` / `codesearch` | Network search                        |
| `todowrite` / `todoread`                | Todo list                             |
| `question`                              | Ask user                              |
| `lsp`                                   | LSP tool (experimental flag)          |
| `external_directory`                    | Access outside project                |
| `doom_loop`                             | Detected repetitive tool loops        |
| MCP tool names                          | Whatever MCP servers expose           |


Conditional: `batch` (`experimental.batch_tool`), plan tools (`OPENCODE_EXPERIMENTAL_PLAN_MODE`).

---



## 11. Recipes for AI agents modifying config



### Set default model for a project

Edit `<repo>/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "provider/model-id",
  "small_model": "provider/small-model-id"
}
```



### Make the agent autonomous (fewer asks)

```json
{
  "permission": {
    "*": "allow",
    "doom_loop": "ask",
    "read": {
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow"
    }
  }
}
```



### Lock down production / review mode

```json
{
  "permission": {
    "*": "ask",
    "edit": "deny",
    "bash": "deny",
    "read": "allow",
    "grep": "allow",
    "glob": "allow",
    "list": "allow"
  },
  "default_agent": "plan"
}
```



### Add MCP server

```json
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "@package/mcp-server"],
      "enabled": true
    }
  }
}
```



### Add always-on project rules without AGENTS.md length

Create `.cursor/rules/core.mdc`:

```markdown
---
alwaysApply: true
---

- Prefer bun
- Run tests from package dirs, not repo root
```



### Add path-scoped TypeScript rules

```markdown
---
description: TypeScript style
globs: "**/*.ts,**/*.tsx"
alwaysApply: false
---

Use strict typing; avoid `any`.
```



### Reuse docs as instructions

```json
{
  "instructions": ["CONTRIBUTING.md", "docs/architecture.md"]
}
```



### Configure `/loop` verification

```json
{
  "loop": {
    "verify": ["bun test", "bun typecheck"]
  }
}
```



### Disable streaming (debugging / provider quirks)

```json
{
  "experimental": {
    "disable_stream": true
  }
}
```



### Custom primary agent via markdown

Write `.opencode/agent/reviewer.md` with frontmatter `mode: primary` (or `all`) and a clear `description` / body prompt. Optionally set `"default_agent": "reviewer"` in `opencode.json`.

---



## 12. Safety rules when an AI edits OpenCode config

1. **Never commit secrets.** Do not put API keys in `opencode.json` if it is tracked; use env vars / `/connect` / `auth.json`.
2. **Prefer project** `opencode.json` **+** `AGENTS.md` over editing the user's global `~/.config/opencode/` unless asked.
3. **Keep** `$schema` so editors validate.
4. **Do not invent top-level keys** — schema is strict; unknown keys fail load.
5. **Put theme/keybinds in** `tui.json`, not `opencode.json`.
6. **Permissions:** `"deny"` lo-blocks; `"ask"` prompts the user; `"allow"` is silent. Prefer `"ask"` for destructive shell when unsure.
7. `.env` **files:** keep behind `ask` or `deny` in `permission.read`.
8. **Validate JSON** after edits. JSONC allows comments if using `.jsonc`.
9. **After changing MCP/plugins**, user may need to restart OpenCode.
10. **Do not remove** existing team `AGENTS.md` content casually; append or add scoped `.mdc` rules instead.
11. **Tests in this monorepo** must run from package dirs (e.g. `packages/opencode`), not repo root.
12. When documenting for humans, link [https://opencode.ai/docs](https://opencode.ai/docs) — this file is for machine configuration.

---



## 13. Quick checklist: “configure OpenCode for this repo”

1. Create `opencode.json` with `$schema`, `model`, and any `permission` needed.
2. Create or update `AGENTS.md` with project conventions (or rely on `.cursor/rules/*.mdc`).
3. Optionally add `.opencode/agent|command|skill` assets.
4. Optionally add MCP under `mcp`.
5. Optionally add `instructions` for existing docs.
6. Optionally set `loop.verify` if using autonomous loops.
7. Leave credentials to env/`/connect`; do not embed keys.
8. Restart OpenCode / start a new session so config reloads.

---



## 14. File map (source)


| Concern        | Source                                                     |
| -------------- | ---------------------------------------------------------- |
| Runtime schema | `packages/opencode/src/config/config.ts`                   |
| TUI schema     | `packages/opencode/src/config/tui-schema.ts`               |
| Env flags      | `packages/opencode/src/flag/flag.ts`                       |
| Paths          | `packages/opencode/src/global/index.ts`, `config/paths.ts` |
| Instructions   | `packages/opencode/src/session/instruction.ts`             |
| Cursor `.mdc`  | `packages/opencode/src/session/rule.ts`                    |
| Skills         | `packages/opencode/src/skill/skill.ts`                     |
| Agents         | `packages/opencode/src/agent/agent.ts`                     |
| Permissions    | `packages/opencode/src/permission/next.ts`                 |
| Human docs     | `packages/web/src/content/docs/*.mdx`                      |


---

*Generated for AI consumption. When schema and this README diverge, trust the TypeScript Zod schemas.*