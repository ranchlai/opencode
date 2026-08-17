---
name: reports
description: Write a workspace report or brief (status update, research memo, proposal). Use when the user wants a document they can send or file.
---

# Reports

Produce a markdown report in the workspace. Prefer editing an existing draft when one is present.

## Output

- Path: `reports/YYYY-MM-DD-<slug>.md` under the workspace root unless the user names a file
- Title, date, author (user name if known), then body
- Short sections with headings; bullets over long prose
- End with **Next** (actions) when the topic needs follow-up
- Do not invent facts, numbers, or URLs

## Shape

```markdown
# Title

Date: YYYY-MM-DD

## Summary
One paragraph.

## Findings
- Point, with source if you have one

## Risks / open questions

## Next
- [ ] Action
```

Keep it under ~800 words unless the user asks for more.
