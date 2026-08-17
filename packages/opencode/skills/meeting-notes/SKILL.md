---
name: meeting-notes
description: Turn a transcript, recording notes, or rough bullets into dated meeting notes with decisions and actions.
---

# Meeting notes

Write notes the attendees can file. Prefer a workspace markdown file over chat.

## Output

- Path: `notes/YYYY-MM-DD-<slug>.md`
- Header: title, date, attendees (if known), source (transcript / memory / user bullets)
- Sections: **Summary**, **Decisions**, **Actions**, **Notes**
- Actions as `- [ ] Owner — task (due if known)`
- Quote only when the wording matters; do not invent attendees or decisions

## Shape

```markdown
# Title

Date: YYYY-MM-DD
Attendees:

## Summary

## Decisions
-

## Actions
- [ ] Owner — task

## Notes
```
