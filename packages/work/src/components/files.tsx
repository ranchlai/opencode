import type { FileDiff } from "@opencode-ai/sdk/v2/client"
import { Markdown } from "@opencode-ai/ui/markdown"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { Diff } from "@/components/diff"
import { Empty, Ico } from "@/components/ui"
import type { Turn } from "@/context/store"
import { useStore } from "@/context/store"

export type Entry = {
  path: string
  adds?: number
  dels?: number
  kind: "added" | "modified" | "deleted" | "written"
}

function name(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path
}

function parent(path: string) {
  const parts = path.split("/").filter(Boolean)
  if (parts.length <= 1) return ""
  return parts.slice(0, -1).join("/")
}

function same(a: Entry, b: Entry) {
  return a.path === b.path && a.kind === b.kind && a.adds === b.adds && a.dels === b.dels
}

function gather(turns: Turn[], diffs: FileDiff[], cache: Map<string, Entry>) {
  const map = new Map<string, Entry>()

  const put = (item: Entry) => {
    const prev = cache.get(item.path)
    if (prev && same(prev, item)) {
      map.set(item.path, prev)
      return
    }
    map.set(item.path, item)
  }

  for (const file of diffs) {
    const kind =
      file.additions > 0 && file.deletions === 0
        ? ("added" as const)
        : file.deletions > 0 && file.additions === 0
          ? ("deleted" as const)
          : ("modified" as const)
    put({
      path: file.file,
      adds: file.additions,
      dels: file.deletions,
      kind,
    })
  }

  for (const turn of turns) {
    for (const part of turn.parts) {
      if (part.type === "patch") {
        for (const file of part.files) {
          if (map.has(file)) continue
          put({ path: file, kind: "written" })
        }
        continue
      }
      if (part.type !== "tool") continue
      if (part.state.status === "completed") {
        for (const file of part.state.attachments ?? []) {
          const path = file.source?.type === "file" ? file.source.path : file.filename
          if (!path || path.endsWith("/")) continue
          if (!map.has(path)) put({ path, kind: "written" })
        }
      }
      if (part.tool !== "write" && part.tool !== "edit" && part.tool !== "apply_patch") continue
      const input = part.state.input
      const path =
        typeof input?.filePath === "string"
          ? input.filePath
          : typeof input?.path === "string"
            ? input.path
            : undefined
      if (!path || path.endsWith("/")) continue
      if (map.has(path)) continue
      put({ path, kind: part.tool === "write" ? "written" : "modified" })
    }
  }

  cache.clear()
  for (const [key, value] of map) cache.set(key, value)
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function lookup(diffs: FileDiff[], path: string) {
  return diffs.find((file) => file.file === path)
}

function markdown(path: string) {
  return /\.(md|mdx|markdown)$/i.test(path)
}

function Preview(props: { path: string; directory: string; diff?: FileDiff }) {
  const store = useStore()
  const [mode, setMode] = createSignal<"preview" | "diff">("preview")

  const [text] = createResource(
    () => `${props.directory}\0${props.path}`,
    (key) => {
      const split = key.indexOf("\0")
      return store.content({ directory: key.slice(0, split), path: key.slice(split + 1) })
    },
  )

  createEffect(() => {
    props.path
    setMode("preview")
  })

  return (
    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div class="flex shrink-0 items-center gap-2 border-b border-border-weaker-base px-3 py-2">
        <Ico name="file" size={12} class="text-icon-weak-base" />
        <span class="min-w-0 flex-1 truncate font-mono text-12-regular text-text-base" title={props.path}>
          {props.path}
        </span>
        <Show when={props.diff}>
          <button
            type="button"
            onClick={() => setMode(mode() === "preview" ? "diff" : "preview")}
            class="shrink-0 rounded-md px-2 py-0.5 text-12-regular text-text-weak hover:bg-surface-base-hover"
          >
            {mode() === "preview" ? "Diff" : "Preview"}
          </button>
        </Show>
      </div>

      <div class="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain p-3">
        <Show
          when={mode() === "diff" && props.diff}
          fallback={
            <Show when={!text.loading} fallback={<div class="text-12-regular text-text-weaker">Loading…</div>}>
              <Show
                when={text() !== undefined}
                fallback={<div class="text-12-regular text-text-weaker">Could not read this file</div>}
              >
                <Show
                  when={markdown(props.path)}
                  fallback={
                    <pre class="min-w-0 whitespace-pre-wrap break-words font-mono text-12-regular text-text-base">
                      {text()}
                    </pre>
                  }
                >
                  <div class="min-w-0 overflow-x-auto">
                    <Markdown text={text() ?? ""} cacheKey={`file:${props.path}`} />
                  </div>
                </Show>
              </Show>
            </Show>
          }
        >
          {(file) => (
            <div class="min-w-0 overflow-x-auto">
              <Diff file={file()} open />
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

export function Files(props: {
  turns: Turn[]
  diffs: FileDiff[]
  directory: string
  focus?: string
  onFocus?: (path: string) => void
}) {
  const cache = new Map<string, Entry>()
  const rows = createMemo(() => gather(props.turns, props.diffs, cache))
  const [active, setActive] = createSignal<string>()

  const owned = (path: string) => {
    const list = rows()
    if (list.some((row) => row.path === path)) return true
    if (path.startsWith(props.directory)) return true
    if (!path.startsWith("/")) return true
    return false
  }

  createEffect(() => {
    const focus = props.focus
    const list = rows()
    props.directory

    if (focus && owned(focus)) {
      if (active() !== focus) setActive(focus)
      return
    }

    const current = active()
    if (current && list.some((row) => row.path === current)) return
    if (list.length === 0) {
      if (current !== undefined) setActive(undefined)
      return
    }
    setActive(list[0].path)
  })

  const diff = createMemo(() => {
    const path = active()
    if (!path) return
    return lookup(props.diffs, path)
  })

  const pick = (path: string) => {
    setActive(path)
    props.onFocus?.(path)
  }

  const extra = createMemo(() => {
    const path = active()
    if (!path) return
    if (rows().some((row) => row.path === path)) return
    if (!owned(path)) return
    return path
  })

  return (
    <div class="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border-weak-base bg-background-weak">
      <div class="flex shrink-0 items-center gap-2 border-b border-border-weak-base px-3 py-2.5">
        <span class="text-12-medium text-text-strong">Workspace</span>
        <span class="text-12-regular text-text-weaker">{rows().length}</span>
      </div>

      <Show
        when={rows().length > 0 || active()}
        fallback={<Empty title="No files yet" body="Generated and changed files will show up here." />}
      >
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div class="flex shrink-0 gap-1 overflow-x-auto border-b border-border-weaker-base px-2 py-1.5">
            <For each={rows()}>
              {(row) => (
                <button
                  type="button"
                  title={row.path}
                  onClick={() => pick(row.path)}
                  class={`flex max-w-40 shrink-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                    active() === row.path ? "bg-surface-base-active" : "hover:bg-surface-base-hover"
                  }`}
                >
                  <span class="truncate text-12-medium text-text-strong">{name(row.path)}</span>
                  <div class="flex items-center gap-1">
                    <Show when={row.adds !== undefined}>
                      <span class="text-12-regular text-text-diff-add-base">+{row.adds}</span>
                    </Show>
                    <Show when={row.dels !== undefined}>
                      <span class="text-12-regular text-text-diff-delete-base">-{row.dels}</span>
                    </Show>
                    <Show when={row.adds === undefined}>
                      <span class="truncate text-12-regular capitalize text-text-weaker">{row.kind}</span>
                    </Show>
                  </div>
                </button>
              )}
            </For>
            <Show when={extra()}>
              {(path) => (
                <button
                  type="button"
                  title={path()}
                  class="flex max-w-40 shrink-0 flex-col gap-0.5 rounded-md bg-surface-base-active px-2 py-1.5 text-left"
                >
                  <span class="truncate text-12-medium text-text-strong">{name(path())}</span>
                  <span class="truncate text-12-regular text-text-weaker">{parent(path()) || "open"}</span>
                </button>
              )}
            </Show>
          </div>

          <Show when={active()}>
            {(path) => <Preview path={path()} directory={props.directory} diff={diff()} />}
          </Show>
        </div>
      </Show>
    </div>
  )
}
