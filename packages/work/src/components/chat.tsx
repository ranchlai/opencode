import type { Part, ToolPart } from "@opencode-ai/sdk/v2/client"
import { Markdown } from "@opencode-ai/ui/markdown"
import { createEffect, createMemo, For, on, Show } from "solid-js"
import { Ico } from "@/components/ui"
import type { Turn } from "@/context/store"

const hidden = new Set(["todowrite", "todoread"])

function label(part: ToolPart) {
  if (part.state.status === "completed") return part.state.title || part.tool
  if (part.state.status === "running") return part.state.title ?? part.tool
  if (part.state.status === "error") return `${part.tool} failed`
  return part.tool
}

function path(part: ToolPart) {
  const input = part.state.input
  const value = input?.filePath ?? input?.path
  if (typeof value === "string") return value
}

function Tool(props: { part: ToolPart; onFile?: (path: string) => void }) {
  const file = createMemo(() => path(props.part))
  const tone = () => {
    if (props.part.state.status === "error") return "text-text-diff-delete-base"
    if (props.part.state.status === "running") return "text-text-weak"
    return "text-text-weaker"
  }

  return (
    <button
      type="button"
      disabled={!file() || !props.onFile}
      onClick={() => {
        const value = file()
        if (!value) return
        props.onFile?.(value)
      }}
      class={`flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-12-regular ${tone()} ${
        file() && props.onFile ? "hover:bg-surface-base-hover" : ""
      }`}
    >
      <Ico name={props.part.state.status === "running" ? "spin" : "check"} size={11} />
      <span class="truncate">{label(props.part)}</span>
      <Show when={file()}>
        {(value) => <span class="truncate font-mono text-text-weaker">{value()}</span>}
      </Show>
    </button>
  )
}

function texts(parts: Part[]) {
  return parts.flatMap((part) => {
    if (part.type !== "text") return []
    if (part.synthetic) return []
    if (!part.text.trim()) return []
    return [part]
  })
}

function tools(parts: Part[]) {
  return parts.flatMap((part) => {
    if (part.type !== "tool") return []
    if (hidden.has(part.tool)) return []
    if (part.tool === "question" && (part.state.status === "pending" || part.state.status === "running")) return []
    return [part]
  })
}

function Bubble(props: { turn: Turn; onFile?: (path: string) => void }) {
  const role = () => props.turn.info.role
  const body = createMemo(() => texts(props.turn.parts))
  const work = createMemo(() => tools(props.turn.parts))

  return (
    <div class={`flex flex-col gap-2 ${role() === "user" ? "items-end" : "items-start"}`}>
      <Show when={role() === "user"}>
        <div class="max-w-[85%] rounded-2xl bg-surface-base-active px-3.5 py-2.5">
          <For each={body()}>
            {(part) => <div class="text-14-regular whitespace-pre-wrap text-text-strong">{part.text}</div>}
          </For>
        </div>
      </Show>

      <Show when={role() === "assistant"}>
        <div class="flex w-full max-w-full flex-col gap-2">
          <Show when={work().length > 0}>
            <div class="rounded-lg border border-border-weaker-base bg-surface-raised-base/60 px-2.5 py-1.5">
              <For each={work()}>{(part) => <Tool part={part} onFile={props.onFile} />}</For>
            </div>
          </Show>
          <For each={body()}>{(part) => <Markdown text={part.text} cacheKey={part.id} class="text-14-regular" />}</For>
        </div>
      </Show>
    </div>
  )
}

export function Chat(props: {
  turns: Turn[]
  running?: boolean
  onFile?: (path: string) => void
}) {
  let scroller: HTMLDivElement | undefined
  let pinned = true

  const visible = createMemo(() =>
    props.turns.filter((turn) => {
      if (turn.info.role === "user") return texts(turn.parts).length > 0
      return texts(turn.parts).length > 0 || tools(turn.parts).length > 0
    }),
  )

  const stick = () => {
    if (!scroller || !pinned) return
    scroller.scrollTop = scroller.scrollHeight
  }

  createEffect(
    on(
      () => [visible().length, props.running, visible().at(-1)?.info.id] as const,
      () => queueMicrotask(stick),
    ),
  )

  // while streaming the last message, follow only if the user is still pinned
  createEffect(
    on(
      () => {
        const last = visible().at(-1)
        if (!last) return ""
        return last.parts.map((part) => (part.type === "text" ? part.text.length : part.id)).join(":")
      },
      () => queueMicrotask(stick),
      { defer: true },
    ),
  )

  return (
    <div
      ref={scroller}
      onScroll={() => {
        if (!scroller) return
        const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
        pinned = gap < 96
      }}
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <div class="flex w-full flex-col gap-5 px-4 py-5 sm:px-6">
        <For each={visible()}>{(turn) => <Bubble turn={turn} onFile={props.onFile} />}</For>
        <Show when={props.running}>
          <div class="flex items-center gap-2 text-12-regular text-text-weaker">
            <Ico name="spin" size={12} class="animate-spin" />
            Working…
          </div>
        </Show>
        <Show when={visible().length === 0 && !props.running}>
          <div class="py-10 text-center text-12-regular text-text-weaker">No messages yet</div>
        </Show>
      </div>
    </div>
  )
}
