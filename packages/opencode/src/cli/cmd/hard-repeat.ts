import type { Argv } from "yargs"
import path from "path"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { Instance } from "../../project/instance"
import { Worktree } from "../../worktree"
import { Table } from "../../util/table"
import { Process } from "../../util/process"
import { Filesystem } from "../../util/filesystem"

const FALLBACK = `Fix this bug in the current worktree. Do not touch unrelated files.

$ITEM`

export const HardRepeatCommand = cmd({
  command: "hard-repeat <file> [prompt..]",
  describe: "for each spreadsheet row, run opencode in a fresh git worktree",
  builder: (yargs: Argv) => {
    return yargs
      .positional("file", {
        describe: "xlsx, csv, jsonl, or json list of items",
        type: "string",
        demandOption: true,
      })
      .positional("prompt", {
        describe: "per-item prompt; $ITEM and $COLUMN placeholders",
        type: "string",
        array: true,
        default: [],
      })
      .option("column", {
        alias: ["c"],
        type: "string",
        describe: "column to use for $ITEM (default: bug, title, or joined row)",
      })
      .option("jobs", {
        alias: ["j"],
        type: "number",
        default: 1,
        describe: "how many worktrees to run at once",
      })
      .option("max", {
        type: "number",
        describe: "stop after this many rows",
      })
      .option("model", {
        alias: ["m"],
        type: "string",
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort)",
      })
      .option("keep", {
        type: "boolean",
        default: true,
        describe: "keep worktrees after each run (default)",
      })
      .option("rm", {
        type: "boolean",
        default: false,
        describe: "remove a worktree after a successful run",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "print prompts and worktree names without running",
      })
  },
  handler: async (args) => {
    const file = path.resolve(args.file)
    if (!(await Filesystem.exists(file))) {
      UI.error(`File not found: ${args.file}`)
      process.exit(1)
    }

    const tmpl = [...args.prompt, ...(args["--"] || [])].join(" ").trim() || FALLBACK
    const rows = await Table.load(file)
    const list = args.max ? rows.slice(0, args.max) : rows
    if (!list.length) {
      UI.error("No rows in " + args.file)
      process.exit(1)
    }

    const jobs = Math.max(1, Math.floor(args.jobs || 1))
    const keep = args.rm ? false : args.keep
    let ok = 0
    let fail = 0

    if (args.dryRun) {
      for (let i = 0; i < list.length; i++) {
        const row = list[i]
        UI.println(`${i + 1}/${list.length} ${label(row, i)}`)
        UI.println(Table.fill(tmpl, row.cells, i, args.column))
        if (row.files.length) UI.println(`  screenshots: ${row.files.map((file) => file.name).join(", ")}`)
        UI.empty()
      }
      UI.println(`dry-run ${list.length} items, jobs=${jobs}`)
      return
    }

    await bootstrap(process.cwd(), async () => {
      if (Instance.project.vcs !== "git") {
        UI.error("hard-repeat needs a git repository so it can create worktrees")
        process.exit(1)
      }

      const exe = self()
      await pool(list, jobs, async (row, i) => {
        const name = label(row, i)
        const text = Table.fill(tmpl, row.cells, i, args.column)
        UI.println(`${UI.Style.TEXT_INFO_BOLD}${i + 1}/${list.length}${UI.Style.TEXT_NORMAL} ${name}`)

        const info = await Worktree.open({ name })
        UI.println(`  worktree ${info.directory}`)
        UI.println(`  branch   ${info.branch}`)

        const shots: string[] = []
        if (row.files.length) {
          const dir = path.join(info.directory, ".opencode", "repeat-media")
          for (let n = 0; n < row.files.length; n++) {
            const file = row.files[n]
            const dest = path.join(dir, `${n + 1}-${file.name}`)
            await Filesystem.write(dest, file.bytes)
            shots.push(dest)
            UI.println(`  screenshot ${file.name}`)
          }
        }

        const cmd = [
          ...exe,
          "run",
          "--dir",
          info.directory,
          "--title",
          name.slice(0, 80),
          ...shots.flatMap((file) => ["-f", file]),
          ...(args.model ? ["--model", args.model] : []),
          ...(args.agent ? ["--agent", args.agent] : []),
          ...(args.variant ? ["--variant", args.variant] : []),
          text,
        ]
        const child = Process.spawn(cmd, {
          cwd: info.directory,
          stdin: "ignore",
          stdout: "inherit",
          stderr: "inherit",
        })
        const code = await child.exited
        if (code === 0) {
          ok++
          if (!keep) await Worktree.remove({ directory: info.directory })
          return
        }
        fail++
        UI.error(`  item ${i + 1} failed (exit ${code}); worktree kept at ${info.directory}`)
      })
    })

    UI.empty()
    UI.println(`${ok} ok, ${fail} failed, ${list.length} total`)
    if (fail) process.exitCode = 1
  },
})

function self() {
  const entry = process.argv[1]
  if (entry && /\.(c|m)?(t|j)sx?$/.test(entry)) return [process.execPath, entry]
  return [process.execPath]
}

function label(item: Table.Item, i: number) {
  const id = item.cells.id || item.cells.bug || item.cells.title || String(i + 1)
  const slug = id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 40)
  return `repeat-${slug || i + 1}`
}

async function pool<T>(items: T[], jobs: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0
  const workers = Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      await fn(items[i], i)
    }
  })
  await Promise.all(workers)
}
