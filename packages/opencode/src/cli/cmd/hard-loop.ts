import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { UI } from "../ui"
import { bootstrap } from "../bootstrap"
import { Config } from "../../config/config"
import { Process } from "../../util/process"
import { HardLoop } from "../../session/hard-loop"
import { Filesystem } from "../../util/filesystem"

const DEFAULT_MAX = 50

export const HardLoopCommand = cmd({
  command: "hard-loop [prompt..]",
  describe: "rerun opencode in a fresh process until LOOP_DONE",
  builder: (yargs: Argv) => {
    return yargs
      .positional("prompt", {
        describe: "goal; leading 2h / 50 set a deadline or round cap",
        type: "string",
        array: true,
        default: [],
      })
      .option("max", {
        type: "number",
        describe: `stop after this many processes (default ${DEFAULT_MAX} if no budget)`,
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
      .option("dir", {
        type: "string",
        describe: "directory to run in",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to each round",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "print the first prompt without running",
      })
  },
  handler: async (args) => {
    const raw = [...args.prompt, ...(args["--"] || [])].join(" ").trim()
    const parsed = HardLoop.parse(raw)
    if (parsed.kind !== "start") {
      UI.error("hard-loop needs a goal")
      process.exit(1)
    }

    const max = args.max ?? parsed.max ?? (parsed.deadline ? undefined : DEFAULT_MAX)
    if (args.dir) {
      if (!(await Filesystem.isDir(args.dir))) {
        UI.error("Failed to change directory to " + args.dir)
        process.exit(1)
      }
      process.chdir(args.dir)
    }
    const cwd = process.cwd()

    await bootstrap(cwd, async () => {
      const info = HardLoop.create({
        goal: parsed.goal,
        deadline: parsed.deadline,
        max,
        verify: (await Config.get()).loop?.verify ?? [],
      })

      if (args.dryRun) {
        UI.println(HardLoop.prompt(info))
        return
      }

      const ac = new AbortController()
      const stop = () => ac.abort()
      process.on("SIGINT", stop)
      process.on("SIGTERM", stop)

      const exe = self()
      const result = await HardLoop.drive(
        info,
        async (text) => {
          UI.empty()
          UI.println(
            `${UI.Style.TEXT_INFO_BOLD}hard-loop ${info.rounds + 1}${info.max ? `/${info.max}` : ""}${UI.Style.TEXT_NORMAL}`,
          )
          const out = await capture(
            [
              ...exe,
              "run",
              "--dir",
              cwd,
              "--title",
              `hard-loop ${info.rounds + 1}`,
              ...(args.model ? ["--model", args.model] : []),
              ...(args.agent ? ["--agent", args.agent] : []),
              ...(args.variant ? ["--variant", args.variant] : []),
              ...[args.file ?? []].flat().flatMap((file) => ["-f", file]),
              text,
            ],
            cwd,
            ac.signal,
          )
          return out.text
        },
        ac.signal,
      )

      if (result.kind === "done") {
        UI.println(`${UI.Style.TEXT_SUCCESS_BOLD}hard-loop done${UI.Style.TEXT_NORMAL} after ${result.rounds} rounds`)
        return
      }
      if (result.kind === "abort") {
        UI.error("hard-loop interrupted")
        process.exitCode = 1
        return
      }
      UI.error(`hard-loop ${result.kind} after ${result.rounds} rounds`)
      process.exitCode = 1
    })
  },
})

function self() {
  const entry = process.argv[1]
  if (entry && /\.(c|m)?(t|j)sx?$/.test(entry)) return [process.execPath, entry]
  return [process.execPath]
}

async function capture(cmd: string[], cwd: string, abort: AbortSignal) {
  const child = Process.spawn(cmd, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    abort,
  })
  const chunks: Buffer[] = []
  const pump = (src: NodeJS.ReadableStream | null, dest: NodeJS.WriteStream) => {
    if (!src) return
    return new Promise<void>((resolve, reject) => {
      src.on("data", (buf: Buffer) => {
        dest.write(buf)
        chunks.push(buf)
      })
      src.on("end", resolve)
      src.on("error", reject)
    })
  }
  const [code] = await Promise.all([child.exited, pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)])
  return { code, text: Buffer.concat(chunks).toString() }
}
