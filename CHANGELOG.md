# Changelog

## 1.3.0 — 2026-09-02

Fork release on top of upstream OpenCode 1.2.27.

### Features

- **Team mode** (`/team`): a lead session plus named teammates, a shared task board, and specialist agents (`work`, `writer`, `researcher`, `analyst`). On by default; disable with `OPENCODE_EXPERIMENTAL_TEAM_MODE=0`.
- **Office skills**: bundled reports, spreadsheets, slides, and meeting-notes. Spreadsheet jobs and team work/writer/analyst stay in the current repo; `build` still isolates in a worktree unless `--no-worktree`.
- **`/loop`**: long-running goals that survive context compaction, with `loop.verify`, durable loop state, and failed-attempt memory.
- **`/hard-loop`** (also `opencode hard-loop`): rerun OpenCode in a fresh process until `LOOP_DONE`; `/hard-loop stop` to end.
- **`/repeat`**: run the same job across many inputs in isolated child sessions.
- **`hard-repeat`**: one `opencode run` per spreadsheet/CSV row, each in its own git worktree.
- **Cursor `.mdc` rules**: load `.cursor/rules/**/*.mdc` with `alwaysApply`, globs, and description modes.
- **`/simplify`**: review and clean up recent changes for reuse and quality.
- **`/save` and `/save_and_quit`**: write the last model response to a file, optionally exiting.
- **Non-streaming LLM calls** via `experimental.disable_stream` for providers that mishandle SSE.
- **Session journal**: append-only JSONL log of session events.

### Docs

- Tutorial and slides for this fork (TUI, `/loop`, `/repeat`, `/team`).
- AI-oriented config reference in `OPENCODE_CONFIG.md`.
