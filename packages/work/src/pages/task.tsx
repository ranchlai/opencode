import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Chat } from "@/components/chat"
import { Files } from "@/components/files"
import { Btn, Dot, Empty, Ico } from "@/components/ui"
import { type State, useStore } from "@/context/store"

const labels: Record<State, string> = {
  waiting: "Needs you",
  running: "Running",
  review: "Review",
  done: "Done",
}

const WIDTH_KEY = "opencode.work:workspace-width"
const WIDTH_DEFAULT = 420
const WIDTH_MIN = 280
const WIDTH_MAX = 720

function readWidth() {
  const raw = localStorage.getItem(WIDTH_KEY)
  const value = raw ? Number(raw) : WIDTH_DEFAULT
  if (!Number.isFinite(value)) return WIDTH_DEFAULT
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, value))
}

function command(perm: PermissionRequest) {
  const value = perm.metadata?.["command"]
  if (typeof value === "string") return value
  return perm.patterns.join(" ")
}

function Reply(props: { onSend: (text: string) => void; placeholder: string; disabled?: boolean }) {
  const [text, setText] = createSignal("")
  let field: HTMLTextAreaElement | undefined

  const grow = () => {
    if (!field) return
    field.style.height = "auto"
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`
  }

  const send = () => {
    if (props.disabled) return
    if (!text().trim()) return
    props.onSend(text().trim())
    setText("")
    if (field) field.style.height = "auto"
  }

  return (
    <div class="rounded-xl border border-border-weak-base bg-surface-raised-base p-2.5">
      <textarea
        ref={field}
        rows={1}
        value={text()}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onInput={(e) => {
          setText(e.currentTarget.value)
          grow()
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          if (e.shiftKey) return
          e.preventDefault()
          send()
        }}
        class="w-full resize-none bg-transparent px-1 py-1 text-14-regular text-text-base outline-none placeholder:text-text-weaker disabled:opacity-50"
      />
      <div class="flex items-center gap-2">
        <div class="flex-1" />
        <button
          type="button"
          title="Send"
          disabled={props.disabled || !text().trim()}
          onClick={send}
          class="inline-flex size-7 items-center justify-center rounded-full bg-surface-interactive-base text-text-on-interactive-base transition-opacity disabled:opacity-30"
        >
          <Ico name="up" />
        </button>
      </div>
    </div>
  )
}

export default function Task() {
  const store = useStore()
  const params = useParams()
  const nav = useNavigate()
  const [panel, setPanel] = createSignal(true)
  const [focus, setFocus] = createSignal<string>()
  const [width, setWidth] = createSignal(readWidth())
  const [ceiling, setCeiling] = createSignal(WIDTH_MAX)

  const id = createMemo(() => params.id ?? "")
  const task = createMemo(() => store.data.session[id()])
  const state = createMemo(() => store.state(id()))
  const todo = createMemo(() => store.data.todo[id()] ?? [])
  const diff = createMemo(() => store.data.diff[id()] ?? [])
  const turns = createMemo(() => store.data.turn[id()] ?? [])
  const perm = createMemo(() => store.data.perm[id()]?.[0])
  const running = createMemo(() => state() === "running" || state() === "waiting")

  const openFile = (path: string) => {
    setFocus(path)
    setPanel(true)
  }

  const resize = (value: number) => {
    const next = Math.min(ceiling(), Math.max(WIDTH_MIN, value))
    setWidth(next)
    localStorage.setItem(WIDTH_KEY, String(next))
  }

  createEffect(() => {
    const sync = () => {
      const next = Math.min(WIDTH_MAX, Math.floor(window.innerWidth * 0.55))
      setCeiling(next)
      if (width() > next) resize(next)
    }
    sync()
    window.addEventListener("resize", sync)
    onCleanup(() => window.removeEventListener("resize", sync))
  })

  createEffect(() => {
    const key = id()
    setFocus(undefined)
    if (!key) return
    void store.open(key)
  })

  return (
    <Show when={task()} fallback={<Empty title="Task not found" body="It may have been deleted on the server." />}>
      {(current) => (
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-center gap-2 border-b border-border-weak-base px-4 py-2.5">
            <Dot state={state()} />
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-12-medium text-text-strong">{current().title || "Untitled task"}</span>
              <span class="truncate text-12-regular text-text-weaker">
                {labels[state()]} · {store.short(current().directory)}
              </span>
            </div>
            <div class="flex-1" />
            <Show when={todo().length > 0}>
              <span class="shrink-0 text-12-regular text-text-weaker">
                {todo().filter((x) => x.status === "completed").length}/{todo().length} steps
              </span>
            </Show>
            <Btn
              variant="ghost"
              title={panel() ? "Hide files" : "Show files"}
              onClick={() => setPanel(!panel())}
            >
              <Ico name="folder" size={12} />
              Files
            </Btn>
            <Show when={running()}>
              <Btn variant="ghost" onClick={() => void store.stop(id())}>
                Stop
              </Btn>
            </Show>
            <Show when={state() === "review"}>
              <Btn variant="primary" onClick={() => store.finish(id())}>
                Looks good
              </Btn>
            </Show>
          </div>

          <Show when={todo().length > 0}>
            <div class="flex gap-3 overflow-x-auto border-b border-border-weaker-base px-4 py-2">
              <For each={todo()}>
                {(item) => (
                  <div class="flex shrink-0 items-center gap-1.5">
                    <Ico
                      name={item.status === "completed" ? "check" : "spin"}
                      size={11}
                      class={item.status === "completed" ? "text-icon-success-base" : "text-icon-weak-base"}
                    />
                    <span
                      class={`text-12-regular ${
                        item.status === "completed" ? "text-text-weaker line-through" : "text-text-weak"
                      }`}
                    >
                      {item.content}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <Chat turns={turns()} running={running()} onFile={openFile} />

              <div class="border-t border-border-weak-base bg-background-base px-4 py-3 sm:px-6">
                <div class="w-full">
                  <Show when={state() === "waiting" && perm()}>
                    {(request) => (
                      <div class="mb-3 flex flex-col gap-2.5 rounded-xl border border-border-weak-base bg-surface-weak p-3">
                        <div class="flex items-center gap-2">
                          <Dot state="waiting" />
                          <span class="text-12-medium text-text-strong">
                            Allow {request().permission} in this folder?
                          </span>
                        </div>
                        <div class="font-mono text-12-regular text-text-weak">{command(request())}</div>
                        <div class="flex items-center gap-2">
                          <Btn variant="primary" onClick={() => void store.reply(request(), "once")}>
                            Allow once
                          </Btn>
                          <Btn variant="secondary" onClick={() => void store.reply(request(), "always")}>
                            Always in this folder
                          </Btn>
                          <Btn variant="ghost" onClick={() => void store.reply(request(), "reject")}>
                            Reject
                          </Btn>
                        </div>
                      </div>
                    )}
                  </Show>

                  <Show when={state() === "review"}>
                    <div class="mb-3 flex items-center gap-2">
                      <Btn variant="primary" onClick={() => store.finish(id())}>
                        Looks good
                      </Btn>
                      <Btn variant="ghost" onClick={() => void store.revert(id())}>
                        Reject changes
                      </Btn>
                      <div class="flex-1" />
                      <Btn variant="ghost" onClick={() => nav("/tasks")}>
                        Back to tasks
                      </Btn>
                    </div>
                  </Show>

                  <Reply
                    placeholder={running() ? "Agent is working…" : "Follow up…"}
                    disabled={running()}
                    onSend={(text) => void store.followup({ id: id(), text })}
                  />
                </div>
              </div>
            </div>

            <Show when={panel()}>
              <div class="relative flex h-full min-h-0 shrink-0 overflow-hidden" style={{ width: `${width()}px` }}>
                <ResizeHandle
                  direction="horizontal"
                  edge="start"
                  size={width()}
                  min={WIDTH_MIN}
                  max={ceiling()}
                  collapseThreshold={WIDTH_MIN - 40}
                  onResize={resize}
                  onCollapse={() => setPanel(false)}
                />
                <Files
                  turns={turns()}
                  diffs={diff()}
                  directory={current().directory}
                  focus={focus()}
                  onFocus={setFocus}
                />
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  )
}
