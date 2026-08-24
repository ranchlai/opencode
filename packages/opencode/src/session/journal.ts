import { appendFileSync, mkdirSync } from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"

export namespace Journal {
  const log = Log.create({ service: "journal" })

  let ready = false

  export function dir() {
    return path.join(Global.Path.data, "journal")
  }

  export function file(id: string) {
    return path.join(dir(), `${id}.jsonl`)
  }

  export function write(event: { type: string; properties: unknown }) {
    if (event.type === "message.part.delta") return
    if (!owned(event.type)) return
    const id = session(event)
    if (!id) return
    const line =
      JSON.stringify({
        time: Date.now(),
        type: event.type,
        properties: event.properties,
      }) + "\n"
    if (!ready) {
      mkdirSync(dir(), { recursive: true })
      ready = true
    }
    const dest = file(id)
    try {
      appendFileSync(dest, line)
    } catch (err) {
      log.error("failed to append", { dest, error: err })
    }
  }

  function owned(type: string) {
    return (
      type.startsWith("session.") ||
      type.startsWith("message.") ||
      type.startsWith("todo.") ||
      type.startsWith("permission.") ||
      type.startsWith("question.")
    )
  }

  function session(event: { type: string; properties: unknown }) {
    if (typeof event.properties !== "object" || event.properties === null) return
    const props = event.properties as Record<string, unknown>
    if (typeof props.sessionID === "string") return props.sessionID
    const info = props.info
    if (info && typeof info === "object") {
      const rec = info as Record<string, unknown>
      if (typeof rec.sessionID === "string") return rec.sessionID
      if (event.type.startsWith("session.") && typeof rec.id === "string") return rec.id
    }
    const part = props.part
    if (part && typeof part === "object") {
      const rec = part as Record<string, unknown>
      if (typeof rec.sessionID === "string") return rec.sessionID
    }
  }
}
