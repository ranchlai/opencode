import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./repeat.txt"
import { SessionRepeat } from "../session/repeat"

const parameters = z.object({
  action: z.enum(["ready", "status", "stop"]).describe("Repeat action to perform"),
  file: z.string().optional().describe("Path to a JSONL or newline-delimited items file"),
  glob: z.string().optional().describe("Glob of files to use as items"),
  items: z
    .array(z.string())
    .max(SessionRepeat.INLINE_MAX)
    .optional()
    .describe(`Inline items (max ${SessionRepeat.INLINE_MAX}). Prefer file or glob for larger queues.`),
  prompt: z.string().optional().describe("Per-item template. $ITEM / $INPUT are replaced with the current item."),
})

export const RepeatTool = Tool.define("repeat", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      if (params.action === "stop") {
        SessionRepeat.stop(ctx.sessionID)
        return { title: "repeat stop", metadata: {}, output: "Repeat stopped." }
      }

      if (params.action === "status") {
        const result = SessionRepeat.status(ctx.sessionID)
        return {
          title: result.label ?? "repeat status",
          metadata: result,
          output: JSON.stringify(result, null, 2),
        }
      }

      const err = await SessionRepeat.ready(ctx.sessionID, {
        file: params.file,
        glob: params.glob,
        items: params.items,
        prompt: params.prompt,
      })
      if (err) {
        return { title: "repeat ready", metadata: {}, output: err }
      }
      const result = SessionRepeat.status(ctx.sessionID)
      return {
        title: result.label ?? "repeat ready",
        metadata: result,
        output: JSON.stringify(
          {
            started: true,
            label: result.label,
            counts: "counts" in result ? result.counts : undefined,
            note: "The system will run items one by one. Do not call repeat per item. You will get one summary at the end.",
          },
          null,
          2,
        ),
      }
    },
  }
})
