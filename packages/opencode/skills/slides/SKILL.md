---
name: slides
description: Draft a slide deck as markdown or HTML the user can present or paste into a slides app.
---

# Slides

Deliver a deck in the workspace. Do not depend on a binary `.pptx` tool unless one is already installed.

## Output

- Default: `slides/YYYY-MM-DD-<slug>.md` with `---` slide breaks
- Title slide first; one idea per slide; ≤6 bullets
- Speaker notes as a blockquote under the slide when the user will present
- Optional HTML (`slides/YYYY-MM-DD-<slug>.html`) only if asked to preview in a browser

## Shape

```markdown
# Deck title
Subtitle · YYYY-MM-DD

---

# Slide title

- Bullet
- Bullet
```

Keep the deck ≤12 slides unless the user asks for more. No decorative filler slides.
