import type {
  Event,
  FileDiff,
  Message,
  Part,
  PermissionRequest,
  Project,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import { createSimpleContext } from "@opencode-ai/ui/context/helper"
import { createMemo, onCleanup, onMount } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { sdk } from "@/sdk"
import { useServer } from "./server"

export type State = "running" | "waiting" | "review" | "done"

export type Task = {
  id: string
  title: string
  directory: string
  parentID?: string
  time: { created: number; updated: number }
  summary?: { additions: number; deletions: number; files: number }
}

export type Turn = { info: Message; parts: Part[] }

const KEY = "opencode.work:reviewed"
const RETRY = 500

function reviewed() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>
  } catch {
    return {}
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shape(input: Session): Task {
  return {
    id: input.id,
    title: input.title,
    directory: input.directory,
    parentID: input.parentID,
    time: { created: input.time.created, updated: input.time.updated },
    summary: input.summary,
  }
}

export const { use: useStore, provider: StoreProvider } = createSimpleContext({
  name: "Store",
  init: () => {
    const server = useServer()
    const conn = server.conn
    if (!conn) throw new Error("Store requires a server connection")

    const client = sdk(conn)
    const abort = new AbortController()
    const stream = sdk(conn, { signal: abort.signal })

    const [data, set] = createStore({
      ready: false,
      home: "",
      project: [] as Project[],
      session: {} as Record<string, Task>,
      status: {} as Record<string, SessionStatus>,
      perm: {} as Record<string, PermissionRequest[]>,
      todo: {} as Record<string, Todo[]>,
      diff: {} as Record<string, FileDiff[]>,
      turn: {} as Record<string, Turn[]>,
      reviewed: reviewed(),
    })

    const put = (input: Session) => {
      if (input.parentID) return
      set("session", input.id, shape(input))
    }

    const reduce = (event: Event) => {
      if (event.type === "session.created") return put(event.properties.info)
      if (event.type === "session.updated") return put(event.properties.info)
      if (event.type === "session.deleted") {
        const id = event.properties.info.id
        return set(
          produce((d) => {
            delete d.session[id]
            delete d.status[id]
            delete d.perm[id]
            delete d.todo[id]
            delete d.diff[id]
            delete d.turn[id]
          }),
        )
      }
      if (event.type === "session.status") return set("status", event.properties.sessionID, event.properties.status)
      if (event.type === "session.idle") return set("status", event.properties.sessionID, { type: "idle" })
      if (event.type === "session.diff") return set("diff", event.properties.sessionID, event.properties.diff)
      if (event.type === "todo.updated") return set("todo", event.properties.sessionID, event.properties.todos)
      if (event.type === "permission.asked") {
        const perm = event.properties
        return set("perm", perm.sessionID, (prev) => [...(prev ?? []).filter((x) => x.id !== perm.id), perm])
      }
      if (event.type === "permission.replied") {
        const props = event.properties
        return set("perm", props.sessionID, (prev) => (prev ?? []).filter((x) => x.id !== props.requestID))
      }
      if (event.type === "message.updated") {
        const info = event.properties.info
        if (!data.turn[info.sessionID]) return
        return set("turn", info.sessionID, (prev) => {
          const next = (prev ?? []).filter((x) => x.info.id !== info.id)
          return [...next, { info, parts: prev?.find((x) => x.info.id === info.id)?.parts ?? [] }].sort((a, b) =>
            a.info.id < b.info.id ? -1 : 1,
          )
        })
      }
      if (event.type === "message.part.updated") {
        const part = event.properties.part
        if (!data.turn[part.sessionID]) return
        const index = data.turn[part.sessionID].findIndex((x) => x.info.id === part.messageID)
        if (index === -1) {
          const stub: Turn = {
            info: {
              id: part.messageID,
              sessionID: part.sessionID,
              role: "assistant",
              time: { created: Date.now() },
              parentID: "",
              modelID: "",
              providerID: "",
              mode: "",
              agent: "",
              path: { cwd: "", root: "" },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            },
            parts: [part],
          }
          return set("turn", part.sessionID, (prev) =>
            [...(prev ?? []), stub].sort((a, b) => (a.info.id < b.info.id ? -1 : 1)),
          )
        }
        return set("turn", part.sessionID, index, "parts", (prev) =>
          [...prev.filter((x) => x.id !== part.id), part].sort((a, b) => (a.id < b.id ? -1 : 1)),
        )
      }
      if (event.type === "message.part.delta") {
        const props = event.properties
        const list = data.turn[props.sessionID]
        if (!list) return
        const index = list.findIndex((x) => x.info.id === props.messageID)
        if (index === -1) return
        return set(
          "turn",
          props.sessionID,
          index,
          "parts",
          produce((parts) => {
            const part = parts.find((x) => x.id === props.partID) as Record<string, unknown> | undefined
            if (!part) return
            const current = part[props.field]
            if (typeof current !== "string" && current !== undefined) return
            part[props.field] = `${(current as string | undefined) ?? ""}${props.delta}`
          }),
        )
      }
    }

    const load = async () => {
      const [path, project, session] = await Promise.all([
        client.path.get(),
        client.project.list(),
        client.experimental.session.list({ roots: true, limit: 60 }),
      ])

      const roots = (session.data ?? []).filter((x) => !!x?.id && !x.parentID)
      const dirs = [...new Set(roots.map((x) => x.directory))]

      const detail = await Promise.all(
        dirs.map((directory) =>
          Promise.all([
            client.session.status({ directory }).catch(() => undefined),
            client.permission.list({ directory }).catch(() => undefined),
          ]),
        ),
      )

      set(
        produce((d) => {
          d.home = path.data?.home ?? ""
          d.project = project.data ?? []
          for (const item of roots) d.session[item.id] = shape(item)
          for (const [status, perm] of detail) {
            for (const [id, value] of Object.entries(status?.data ?? {})) d.status[id] = value
            for (const item of perm?.data ?? []) {
              if (!item?.sessionID) continue
              d.perm[item.sessionID] = [...(d.perm[item.sessionID] ?? []), item]
            }
          }
          d.ready = true
        }),
      )
    }

    const pump = async () => {
      while (!abort.signal.aborted) {
        await (async () => {
          const events = await stream.global.event({ signal: abort.signal })
          for await (const event of events.stream) {
            if (!event?.payload) continue
            reduce(event.payload)
          }
        })().catch(() => {})
        if (abort.signal.aborted) return
        await wait(RETRY)
      }
    }

    onMount(() => {
      void load().catch(() => set("ready", true))
      void pump()
    })

    onCleanup(() => abort.abort())

    const list = createMemo(() =>
      Object.values(data.session)
        .filter((x) => !x.parentID)
        .sort((a, b) => b.time.updated - a.time.updated),
    )

    const state = (id: string): State => {
      if ((data.perm[id]?.length ?? 0) > 0) return "waiting"
      const status = data.status[id]
      if (status && status.type !== "idle") return "running"
      if (data.reviewed[id]) return "done"
      const files = data.diff[id]?.length ?? data.session[id]?.summary?.files ?? 0
      if (files > 0) return "review"
      return "done"
    }

    const short = (dir: string) => (data.home && dir.startsWith(data.home) ? `~${dir.slice(data.home.length)}` : dir)

    return {
      data,
      list,
      state,
      short,
      get ready() {
        return data.ready
      },
      async open(id: string) {
        const directory = data.session[id]?.directory
        if (!directory) return
        if (!data.turn[id]) set("turn", id, [])
        const [turn, todo, diff] = await Promise.all([
          client.session.messages({ sessionID: id, directory, limit: 200 }).catch(() => undefined),
          client.session.todo({ sessionID: id, directory }).catch(() => undefined),
          client.session.diff({ sessionID: id, directory }).catch(() => undefined),
        ])
        set(
          produce((d) => {
            d.turn[id] = (turn?.data ?? []).filter((x) => !!x?.info?.id)
            d.todo[id] = todo?.data ?? []
            d.diff[id] = diff?.data ?? []
          }),
        )
      },
      async content(input: { directory: string; path: string }) {
        const relative = input.path.startsWith(input.directory)
          ? input.path.slice(input.directory.length).replace(/^\/+/, "")
          : input.path
        const result = await client.file
          .read({ directory: input.directory, path: relative || input.path })
          .catch(() => undefined)
        const body = result?.data
        if (!body) return
        if (body.type === "text") return body.content
        if (body.encoding === "base64") return
        return body.content
      },
      async start(input: { directory: string; text: string }) {
        const session = await client.session.create({ directory: input.directory })
        const created = session.data
        if (!created) return
        put(created)
        await client.session.promptAsync({
          sessionID: created.id,
          directory: input.directory,
          parts: [{ type: "text", text: input.text }],
        })
        set("status", created.id, { type: "busy" })
        return created.id
      },
      stop(id: string) {
        const directory = data.session[id]?.directory
        if (!directory) return
        return client.session.abort({ sessionID: id, directory }).catch(() => {})
      },
      async revert(id: string) {
        const directory = data.session[id]?.directory
        if (!directory) return
        await client.session.revert({ sessionID: id, directory }).catch(() => {})
        const diff = await client.session.diff({ sessionID: id, directory }).catch(() => undefined)
        set("diff", id, diff?.data ?? [])
      },
      reply(perm: PermissionRequest, response: "once" | "always" | "reject") {
        set("perm", perm.sessionID, (prev) => (prev ?? []).filter((x) => x.id !== perm.id))
        const directory = data.session[perm.sessionID]?.directory
        return client.permission.reply({ requestID: perm.id, directory, reply: response }).catch(() => {})
      },
      finish(id: string) {
        set("reviewed", id, true)
        localStorage.setItem(KEY, JSON.stringify({ ...data.reviewed, [id]: true }))
      },
      async followup(input: { id: string; text: string }) {
        const directory = data.session[input.id]?.directory
        if (!directory) return
        await client.session.promptAsync({
          sessionID: input.id,
          directory,
          parts: [{ type: "text", text: input.text }],
        })
        set("reviewed", input.id, false)
        set("status", input.id, { type: "busy" })
      },
    }
  },
})
