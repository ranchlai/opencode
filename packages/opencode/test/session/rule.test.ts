import { describe, expect, test } from "bun:test"
import path from "path"
import { CursorRule } from "../../src/session/rule"
import { InstructionPrompt } from "../../src/session/instruction"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function writeRule(dir: string, name: string, body: string) {
  const filepath = path.join(dir, ".cursor", "rules", name)
  await Bun.write(filepath, body)
  return filepath
}

describe("CursorRule.parse", () => {
  test("parses alwaysApply rules", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeRule(
          dir,
          "always.mdc",
          `---
description: Always on
alwaysApply: true
---
Use bun.
`,
        )
      },
    })
    const rule = await CursorRule.parse(path.join(tmp.path, ".cursor", "rules", "always.mdc"))
    expect(rule?.mode).toBe("always")
    expect(rule?.content).toBe("Use bun.")
    expect(rule?.content.includes("alwaysApply")).toBe(false)
  })

  test("parses comma-separated globs", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeRule(
          dir,
          "ts.mdc",
          `---
globs: src/**/*.ts, src/**/*.tsx
alwaysApply: false
---
TypeScript only.
`,
        )
      },
    })
    const rule = await CursorRule.parse(path.join(tmp.path, ".cursor", "rules", "ts.mdc"))
    expect(rule?.mode).toBe("glob")
    expect(rule?.globs).toEqual(["src/**/*.ts", "src/**/*.tsx"])
  })

  test("parses agent-requested rules from description", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeRule(
          dir,
          "tests.mdc",
          `---
description: Conventions for Vitest unit tests
alwaysApply: false
---
Prefer bun:test.
`,
        )
      },
    })
    const rule = await CursorRule.parse(path.join(tmp.path, ".cursor", "rules", "tests.mdc"))
    expect(rule?.mode).toBe("agent")
    expect(rule?.description).toBe("Conventions for Vitest unit tests")
  })

  test("treats empty frontmatter as manual", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeRule(
          dir,
          "manual.mdc",
          `---
alwaysApply: false
---
Only when mentioned.
`,
        )
      },
    })
    const rule = await CursorRule.parse(path.join(tmp.path, ".cursor", "rules", "manual.mdc"))
    expect(rule?.mode).toBe("manual")
  })
})

describe("CursorRule discovery", () => {
  test("loads alwaysApply into system instructions", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeRule(
          dir,
          "always.mdc",
          `---
alwaysApply: true
---
Always follow this.
`,
        )
        await writeRule(
          dir,
          "manual.mdc",
          `---
alwaysApply: false
---
Manual only.
`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.system()
        const text = system.join("\n")
        expect(text).toContain("Always follow this.")
        expect(text).not.toContain("Manual only.")
        expect(text).not.toContain("alwaysApply:")
      },
    })
  })

  test("lists agent-requested rules in catalog", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeRule(
          dir,
          "review.mdc",
          `---
description: Code review checklist
alwaysApply: false
---
Check for races.
`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.system()
        const text = system.join("\n")
        expect(text).toContain("available_cursor_rules")
        expect(text).toContain("Code review checklist")
        expect(text).toContain(path.join(tmp.path, ".cursor", "rules", "review.mdc"))
        expect(text).not.toContain("Check for races.")
      },
    })
  })

  test("attaches glob rules when reading matching files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeRule(
          dir,
          "ts.mdc",
          `---
globs: "**/*.ts"
alwaysApply: false
---
Prefer const.
`,
        )
        await Bun.write(path.join(dir, "src", "file.ts"), "const x = 1")
        await Bun.write(path.join(dir, "readme.md"), "# hi")
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const hit = await InstructionPrompt.resolve([], path.join(tmp.path, "src", "file.ts"), "msg-1")
        expect(hit.length).toBe(1)
        expect(hit[0].content).toContain("Prefer const.")

        const miss = await InstructionPrompt.resolve([], path.join(tmp.path, "readme.md"), "msg-2")
        expect(miss).toEqual([])
      },
    })
  })

  test("does not duplicate cursor rules listed in instructions", async () => {
    await using tmp = await tmpdir({
      config: {
        instructions: [".cursor/rules/*.mdc"],
      },
      init: async (dir) => {
        await writeRule(
          dir,
          "always.mdc",
          `---
alwaysApply: true
---
One copy.
`,
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const system = await InstructionPrompt.system()
        const text = system.join("\n")
        expect(text.match(/One copy\./g)?.length).toBe(1)
      },
    })
  })
})
