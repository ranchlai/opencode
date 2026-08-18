# How Superpowers bootstraps into the first user message

Superpowers is **not** stored in the session. It is prepended **in memory** onto the first user message right before each LLM call.

Hands-on usage (smoke check, brainstorm → plan → TDD) is in [`superpowers.md`](superpowers.md). This note is the injection path in this checkout.

---

## Pipeline

1. Plugin loads (`superpowers/.opencode/plugins/superpowers.js`, from `package.json` `"main"`).
2. Each agent step in `packages/opencode/src/session/prompt.ts` reloads messages from the DB.
3. OpenCode fires `experimental.chat.messages.transform`.
4. The plugin prepends the bootstrap as a text part on the **first user message**.
5. That mutated array is converted to model messages and sent.

```text
opencode.json  "plugin": ["superpowers@…"]
        │
        ▼
package.json  "main": ".opencode/plugins/superpowers.js"
        │
        ├─ config hook  →  config.skills.paths += superpowers/skills
        │
        └─ experimental.chat.messages.transform
                 │
                 ▼
prompt.ts loop (every agent step)
  msgs = DB (MessageV2.stream → filterCompacted)
  Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
                 │
                 ▼
  first user message.parts.unshift(bootstrap text)
                 │
                 ▼
  MessageV2.toModelMessages(msgs)  →  LLM
  (the extra part is never written back to the DB)
```

`Plugin.trigger` runs every plugin hook against the same `output` object, so Superpowers mutates `msgs` in place.

---

## Where OpenCode calls the hook

Messages are reloaded from the DB at the start of every step, then transformed immediately before `processor.process`:

```ts
// packages/opencode/src/session/prompt.ts
let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
// ... tools, reminders, compaction checks ...
await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
const result = await processor.process({
  messages: [
    ...MessageV2.toModelMessages(msgs, model),
    // ...
  ],
})
```

The hook type lives in `packages/plugin/src/index.ts`:

```ts
"experimental.chat.messages.transform"?: (
  input: {},
  output: {
    messages: {
      info: Message
      parts: Part[]
    }[]
  },
) => Promise<void>
```

`Plugin.trigger` (`packages/opencode/src/plugin/index.ts`) iterates loaded hooks and calls `fn(input, output)`. There is no copy: plugins edit `output.messages` directly.

---

## What the plugin injects

On first use, `getBootstrapContent()` reads `superpowers/skills/using-superpowers/SKILL.md`, strips YAML frontmatter, then caches this string:

- wrapper: `<EXTREMELY_IMPORTANT>…</EXTREMELY_IMPORTANT>`
- preamble: “You have superpowers” + do **not** load `using-superpowers` again via `skill`
- the skill body (invoke relevant skills **before** answering or exploring)
- an OpenCode tool map (`todowrite`, `task`, `skill`, `read`, `apply_patch`, `bash`, `grep`/`glob`, `webfetch`)

The transform then finds the first user message and unshifts a text part:

```js
// superpowers/.opencode/plugins/superpowers.js
'experimental.chat.messages.transform': async (_input, output) => {
  const bootstrap = getBootstrapContent()
  if (!bootstrap || !output.messages.length) return
  const firstUser = output.messages.find(m => m.info.role === 'user')
  if (!firstUser || !firstUser.parts.length) return

  // Skip if this in-memory array already has the bootstrap
  if (firstUser.parts.some(p => p.type === 'text' && p.text.includes('EXTREMELY_IMPORTANT'))) return

  const ref = firstUser.parts[0]
  firstUser.parts.unshift({ ...ref, type: 'text', text: bootstrap })
}
```

So the model sees, on that first user turn:

1. bootstrap text part
2. the real first user text (e.g. “hello”)

Later user turns are left alone. The bootstrap stays on message 1 for the rest of the session (until compaction drops it — see below).

---

## Why a user message, not a system message

User-role injection avoids:

- repeating a system blob every turn (token bloat)
- extra system messages breaking some models (Qwen and others)

Those are Superpowers issues #750 and #894. OpenCode also has `experimental.chat.system.transform` (used for the system prompt in `agent.ts` / `llm.ts`). Superpowers does **not** use that hook.

---

## Why it runs every agent step

`prompt.ts` reloads from the DB each step. The extra part is never persisted, so a fresh array would otherwise lose the bootstrap.

Two guards keep that cheap and correct:

| Guard | What it does |
| --- | --- |
| **Dedup** | Skip if any first-user text part already contains `EXTREMELY_IMPORTANT` (in-memory double-fire, or an already-transformed array passed through again). |
| **Module cache** | Assemble the string once. `SKILL.md` is not re-read every step (`_bootstrapCache`; missing file is cached as `null`). |

After compaction, the first remaining user message gets the bootstrap again because the DB copy never had it. OpenCode does not set a separate “re-inject after compact” flag; per-step reload + dedup is the whole strategy.

---

## Skills registration is a different hook

The `config` hook only appends `superpowers/skills` to `config.skills.paths` so the native `skill` tool can discover the library. Bootstrap is the always-on trigger; those other skills load on demand.

```js
config: async (config) => {
  config.skills = config.skills || {}
  config.skills.paths = config.skills.paths || []
  if (!config.skills.paths.includes(superpowersSkillsDir)) {
    config.skills.paths.push(superpowersSkillsDir)
  }
}
```

Without the transform, skills can still be listed and loaded manually. Without the bootstrap, they usually are not auto-triggered (the agent jumps to code).

---

## What the model is told

Stripped body of `using-superpowers/SKILL.md` (the thing inside the wrapper):

- If there is even a 1% chance a skill applies, invoke it **before** any response — including clarifying questions and file reads.
- Announce “Using [skill] to [purpose]” and follow the skill exactly.
- Process skills first (`brainstorming`, `systematic-debugging`), then implementation skills.
- A “Red Flags” table of rationalizations (“this is simple”, “I need context first”, …).
- User instructions (`AGENTS.md`, …) beat skills; only skip a workflow when the human said to.

The OpenCode-specific preamble adds: this content is **already loaded** — do not call `skill` on `using-superpowers` again.

---

## Verify

New TUI session (`/new`):

```text
Tell me about your superpowers
```

A working inject answers from the bootstrap (has Superpowers, must invoke skills before acting, can name brainstorming / TDD / systematic-debugging). It should **not** load `using-superpowers` via `skill`.

Plugin-only test (no LLM):

```bash
# from superpowers/
tests/opencode/run-tests.sh
```

`tests/opencode/test-bootstrap-caching.mjs` calls the transform twice and asserts: one bootstrap part, one `SKILL.md` read, no extra disk work on the second call.

---

## Source map

| Piece | Path |
| --- | --- |
| Plugin | `superpowers/.opencode/plugins/superpowers.js` |
| Bootstrap skill | `superpowers/skills/using-superpowers/SKILL.md` |
| Hook call site | `packages/opencode/src/session/prompt.ts` |
| Hook type | `packages/plugin/src/index.ts` |
| `Plugin.trigger` | `packages/opencode/src/plugin/index.ts` |
| Cache / inject tests | `superpowers/tests/opencode/test-bootstrap-caching.mjs` |
| Porting notes (other harnesses) | `superpowers/docs/porting-to-a-new-harness.md` |
