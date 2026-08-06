import { createHash } from "crypto"
import { Instance } from "@/project/instance"
import { Database, eq, and, desc } from "../storage/db"
import { MemoryTable } from "./session.sql"
import { Identifier } from "@/id/id"
import type { ProjectID } from "../project/schema"
import z from "zod"

export namespace Memory {
  export const Info = z
    .object({
      id: z.string(),
      tool: z.string(),
      key: z.string(),
      error: z.string(),
      input: z.unknown().optional(),
      time: z.number(),
    })
    .meta({ ref: "Memory" })
  export type Info = z.infer<typeof Info>

  const ERROR_MAX = 2_000

  function clip(text: string) {
    if (text.length <= ERROR_MAX) return text
    return text.slice(0, ERROR_MAX)
  }

  export function key(tool: string, input: unknown) {
    const raw = JSON.stringify({ tool, input }) ?? `${tool}:unknown`
    return createHash("sha256").update(raw).digest("hex").slice(0, 32)
  }

  function project(): ProjectID {
    return Instance.project.id
  }

  export function record(input: { tool: string; args: unknown; error: string }) {
    const pid = project()
    const hash = key(input.tool, input.args)
    const id = Identifier.ascending("tool")
    Database.use((db) => {
      db.delete(MemoryTable)
        .where(and(eq(MemoryTable.project_id, pid), eq(MemoryTable.key, hash)))
        .run()
      db.insert(MemoryTable)
        .values({
          id,
          project_id: pid,
          tool: input.tool,
          key: hash,
          error: clip(input.error),
          input: input.args,
        })
        .run()
    })
  }

  export function match(tool: string, args: unknown): Info | undefined {
    const pid = project()
    const hash = key(tool, args)
    const row = Database.use((db) =>
      db
        .select()
        .from(MemoryTable)
        .where(and(eq(MemoryTable.project_id, pid), eq(MemoryTable.key, hash)))
        .orderBy(desc(MemoryTable.time_updated))
        .get(),
    )
    if (!row) return
    return {
      id: row.id,
      tool: row.tool,
      key: row.key,
      error: row.error,
      input: row.input ?? undefined,
      time: row.time_updated,
    }
  }

  export function warn(tool: string, args: unknown) {
    const prior = match(tool, args)
    if (!prior) return
    return [
      "WARNING: this exact tool call failed earlier in this project.",
      `Tool: ${prior.tool}`,
      `Previous error: ${prior.error}`,
      "Do not repeat the same failing approach — change the command, inputs, or strategy.",
    ].join("\n")
  }

  export function clear(tool?: string) {
    const pid = project()
    Database.use((db) => {
      if (!tool) {
        db.delete(MemoryTable).where(eq(MemoryTable.project_id, pid)).run()
        return
      }
      db.delete(MemoryTable)
        .where(and(eq(MemoryTable.project_id, pid), eq(MemoryTable.tool, tool)))
        .run()
    })
  }

  export function forget(tool: string, args: unknown) {
    const pid = project()
    const hash = key(tool, args)
    Database.use((db) =>
      db.delete(MemoryTable).where(and(eq(MemoryTable.project_id, pid), eq(MemoryTable.key, hash))).run(),
    )
  }

  export function failed(result: { metadata?: Record<string, any>; output?: string }) {
    const exit = result.metadata?.exit
    if (typeof exit === "number" && exit !== 0) {
      return result.output?.trim() || `exit code ${exit}`
    }
  }
}
