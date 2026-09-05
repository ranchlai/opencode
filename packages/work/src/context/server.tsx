import { createSimpleContext } from "@opencode-ai/ui/context/helper"
import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { type Conn, normalize, sdk } from "@/sdk"

const KEY = "opencode.work:server"
const POLL = 10_000

function read() {
  const raw = localStorage.getItem(KEY)
  if (!raw) return
  return parse(raw)
}

function parse(raw: string) {
  try {
    const value = JSON.parse(raw) as Conn
    if (!value?.url) return
    return value
  } catch {
    return
  }
}

export const { use: useServer, provider: ServerProvider } = createSimpleContext({
  name: "Server",
  init: () => {
    const [state, set] = createStore({
      conn: read(),
      healthy: undefined as boolean | undefined,
    })

    const check = async (conn: Conn) => {
      const ok = await sdk(conn)
        .global.health()
        .then(() => true)
        .catch(() => false)
      set("healthy", ok)
    }

    createEffect(() => {
      const conn = state.conn
      if (!conn) return
      set("healthy", undefined)
      void check(conn)
      const timer = setInterval(() => void check(conn), POLL)
      onCleanup(() => clearInterval(timer))
    })

    return {
      get conn() {
        return state.conn
      },
      get healthy() {
        return state.healthy
      },
      connect(input: { url: string; password?: string }) {
        const url = normalize(input.url)
        if (!url) return
        const conn = { url, password: input.password || undefined }
        localStorage.setItem(KEY, JSON.stringify(conn))
        set("conn", conn)
        return conn
      },
      forget() {
        localStorage.removeItem(KEY)
        set("conn", undefined)
      },
    }
  },
})
