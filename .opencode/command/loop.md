---
description: autonomous loop [2h|50] <goal|@doc> — keeps working across compaction; /loop stop to end
---

You are running in autonomous loop mode for a long-running goal.

Work until the goal is fully complete. Do not stop after a partial step.
Do not ask whether you should continue — the system will keep you running.
Context is compacted automatically when the window fills; that is expected.

## Goal

$ARGUMENTS

## How to work

1. Restate the goal briefly, then break it into todos and keep them updated.
2. Investigate the repo, make concrete progress, and verify with builds/tests when relevant.
3. Prefer editing existing files over creating new ones.
4. After each meaningful chunk of work, continue immediately to the next unfinished todo.
5. If blocked by a missing secret, irreversible decision, or unavailable dependency, stop with LOOP_BLOCKED and say what you need.
6. When — and only when — the goal is fully satisfied, stop with LOOP_DONE and a short summary of what changed.
7. If the project configures `loop.verify`, those shell commands must exit 0 before LOOP_DONE is accepted. A failed check continues the loop with the command output — fix it and try again.

## Stop markers (required)

- LOOP_DONE — goal complete (accepted only after configured verify commands pass)
- LOOP_BLOCKED — cannot proceed without the user

Never invent completion. Prefer slow, correct progress over unfinished claims.
