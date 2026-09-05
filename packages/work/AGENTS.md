# `@opencode-ai/work`

Task-shaped web client for `opencode serve`. Independent from `packages/app` — shares only `@opencode-ai/sdk` and `@opencode-ai/ui` (tokens/CSS + a few primitives like `Markdown`, `ResizeHandle`, `MarkedProvider`). Do not import from `packages/app`.

## Local Dev

- Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
- Work UI: `bun --cwd packages/work dev` (or root `bun run dev:work`) — Vite on port **3001**
- Open `http://localhost:3001`, connect to `http://localhost:4096`

## Architecture

- **SolidJS + Vite** SPA; routes: `/connect`, `/`, `/tasks`, `/task/:id`
- **Server**: `context/server.tsx` — URL/password in `localStorage`, health poll
- **Store**: `context/store.tsx` — sessions as tasks, SSE via `global.event()`, turns/diff/todo/perm
- **Task page**: chat (multi-turn) + optional workspace panel; follow-up composer always available when idle

## UI conventions

- Chat fills all space between rail and workspace — **no fixed max-width** on the main column
- Rail and workspace are **resizable** via `@opencode-ai/ui/resize-handle`; widths persist in `localStorage`:
  - `opencode.work:rail-width` (160–360)
  - `opencode.work:workspace-width` (280–720)
- Assistant text: render with `@opencode-ai/ui/markdown` + `MarkedProvider` (never raw markdown)
- Workspace lists generated/changed files (write/edit/patch/diff); clear focus when switching tasks
- Chat auto-scroll only when the user is pinned near the bottom

## Do / Don't

- Do keep this client task-oriented (delegate → review → follow up), not a coding IDE clone
- Do use SDK v2 (`@opencode-ai/sdk/v2/client`) with `throwOnError: true`
- Do run `bun typecheck` from `packages/work`
- Don't pull session/layout code from `packages/app`
- Don't remount workspace preview on every turn update (stable path keys / entry identity)
- Don't leave workspace `focus` sticky across task id changes
