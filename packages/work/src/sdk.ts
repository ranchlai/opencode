import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

export type Conn = {
  url: string
  password?: string
}

export function normalize(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const full = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return full.replace(/\/+$/, "")
}

export function label(conn: Conn) {
  return conn.url.replace(/^https?:\/\//, "").replace(/\/+$/, "")
}

export function sdk(conn: Conn, opts?: { directory?: string; signal?: AbortSignal }) {
  return createOpencodeClient({
    baseUrl: conn.url,
    directory: opts?.directory,
    signal: opts?.signal,
    throwOnError: true,
    headers: conn.password ? { Authorization: `Basic ${btoa(`opencode:${conn.password}`)}` } : undefined,
  })
}

export type Client = ReturnType<typeof sdk>
