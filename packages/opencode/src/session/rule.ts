import path from "path"
import { ConfigMarkdown } from "../config/markdown"
import { Flag } from "@/flag/flag"
import { Instance } from "../project/instance"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"
import { Log } from "../util/log"

const log = Log.create({ service: "rule" })

export namespace CursorRule {
  export type Mode = "always" | "glob" | "agent" | "manual"

  export type Info = {
    path: string
    name: string
    description?: string
    globs: string[]
    always: boolean
    content: string
    mode: Mode
  }

  const PATTERN = ".cursor/rules/**/*.mdc"

  function globs(value: unknown): string[] {
    if (!value) return []
    if (Array.isArray(value)) {
      return value
        .flatMap((item) => String(item).split(","))
        .map((item) => item.trim())
        .filter(Boolean)
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    }
    return []
  }

  function mode(input: { always: boolean; globs: string[]; description?: string }): Mode {
    if (input.always) return "always"
    if (input.globs.length > 0) return "glob"
    if (input.description) return "agent"
    return "manual"
  }

  function match(filepath: string, patterns: string[]) {
    const root = Instance.worktree === "/" ? Instance.directory : Instance.worktree
    const rel = path.relative(root, filepath).replaceAll("\\", "/")
    if (!rel || rel.startsWith("..")) return false
    return patterns.some((pattern) => {
      const cleaned = pattern.replace(/^\.\//, "")
      return Glob.match(cleaned, rel) || Glob.match(cleaned, path.basename(filepath))
    })
  }

  export async function parse(filepath: string): Promise<Info | undefined> {
    const md = await ConfigMarkdown.parse(filepath).catch((err) => {
      log.error("failed to load rule", { rule: filepath, err })
      return undefined
    })
    if (!md) return

    const data = md.data as Record<string, unknown>
    const description = typeof data.description === "string" ? data.description : undefined
    const always = data.alwaysApply === true
    const patterns = globs(data.globs)
    const content = md.content.trim()
    if (!content) return

    return {
      path: path.resolve(filepath),
      name: path.basename(filepath, ".mdc"),
      description,
      globs: patterns,
      always,
      content,
      mode: mode({ always, globs: patterns, description }),
    }
  }

  const state = Instance.state(async () => {
    const rules: Info[] = []
    if (Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
      return { rules }
    }

    const matches = await Filesystem.globUp(PATTERN, Instance.directory, Instance.worktree).catch((error) => {
      log.error("failed to scan cursor rules", { error })
      return [] as string[]
    })

    const seen = new Set<string>()
    for (const match of matches) {
      const resolved = path.resolve(match)
      if (seen.has(resolved)) continue
      seen.add(resolved)
      const rule = await parse(resolved)
      if (rule) rules.push(rule)
    }

    return { rules }
  })

  export async function all() {
    return state().then((x) => x.rules)
  }

  export async function paths() {
    return all().then((rules) => new Set(rules.map((rule) => rule.path)))
  }

  export async function always() {
    return all().then((rules) => rules.filter((rule) => rule.mode === "always"))
  }

  export async function agent() {
    return all().then((rules) => rules.filter((rule) => rule.mode === "agent"))
  }

  export async function forFile(filepath: string) {
    const rules = await all()
    return rules.filter((rule) => rule.mode === "glob" && match(filepath, rule.globs))
  }

  export function format(rule: Info) {
    return "Instructions from: " + rule.path + "\n" + rule.content
  }

  export function catalog(rules: Info[]) {
    if (rules.length === 0) return ""
    return [
      "Cursor rules are available for this project. When a task matches a rule description, use the Read tool on that rule's path to load it.",
      "<available_cursor_rules>",
      ...rules.flatMap((rule) => [
        `  <rule>`,
        `    <name>${rule.name}</name>`,
        `    <description>${rule.description}</description>`,
        `    <path>${rule.path}</path>`,
        `  </rule>`,
      ]),
      "</available_cursor_rules>",
    ].join("\n")
  }
}
