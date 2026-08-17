---
name: spreadsheets
description: Build or clean a spreadsheet-style deliverable (CSV, TSV, markdown table). Use for data cleanup, summaries, and simple models.
---

# Spreadsheets

Save tabular work as a file the user can open in Excel, Numbers, or Sheets.

## Output

- Default: `sheets/YYYY-MM-DD-<slug>.csv` (UTF-8, header row)
- Also write a short `sheets/YYYY-MM-DD-<slug>.md` with row count, column meanings, and caveats when the sheet is not self-explanatory
- Use TSV only if the data contains commas that would break CSV
- If `python3` and openpyxl (or similar) are available and the user asked for `.xlsx`, write xlsx; otherwise CSV is enough

## Rules

- Inspect the source files before summarizing; do not invent numbers
- Keep one fact per column; no merged-header tricks in CSV
- Call out missing values as empty cells, not guessed fills
- Include units in the header (`amount_usd`, `count`) rather than in every cell
