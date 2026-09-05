import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Dot, Ico, Icon } from "@/components/ui"
import { useServer } from "@/context/server"
import { useStore } from "@/context/store"
import { label } from "@/sdk"

const WIDTH_KEY = "opencode.work:rail-width"
const WIDTH_DEFAULT = 216
const WIDTH_MIN = 160
const WIDTH_MAX = 360

function readWidth() {
  const raw = localStorage.getItem(WIDTH_KEY)
  const value = raw ? Number(raw) : WIDTH_DEFAULT
  if (!Number.isFinite(value)) return WIDTH_DEFAULT
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, value))
}

function Item(props: { name: "home" | "list"; label: string; href: string; active: boolean }) {
  const nav = useNavigate()
  return (
    <button
      type="button"
      onClick={() => nav(props.href)}
      class={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12-regular transition-colors ${
        props.active
          ? "bg-surface-base-active text-text-strong"
          : "text-text-weak hover:bg-surface-base-hover hover:text-text-base"
      }`}
    >
      <Ico name={props.name} />
      {props.label}
    </button>
  )
}

export function Rail() {
  const store = useStore()
  const server = useServer()
  const nav = useNavigate()
  const loc = useLocation()
  const [width, setWidth] = createSignal(readWidth())
  const [ceiling, setCeiling] = createSignal(WIDTH_MAX)

  const recent = createMemo(() => store.list().slice(0, 6))
  const health = createMemo(() => {
    if (server.healthy === true) return "bg-icon-success-base"
    if (server.healthy === false) return "bg-icon-critical-base"
    return "bg-border-strong-base"
  })

  const resize = (value: number) => {
    const next = Math.min(ceiling(), Math.max(WIDTH_MIN, value))
    setWidth(next)
    localStorage.setItem(WIDTH_KEY, String(next))
  }

  createEffect(() => {
    const sync = () => {
      const next = Math.min(WIDTH_MAX, Math.floor(window.innerWidth * 0.35))
      setCeiling(next)
      if (width() > next) resize(next)
    }
    sync()
    window.addEventListener("resize", sync)
    onCleanup(() => window.removeEventListener("resize", sync))
  })

  return (
    <div
      class="relative flex h-full min-h-0 shrink-0 flex-col gap-2.5 overflow-hidden border-r border-border-weak-base bg-background-weak p-2"
      style={{ width: `${width()}px` }}
    >
      <div class="flex items-center gap-0.5">
        <Icon title="Search">
          <Ico name="search" />
        </Icon>
        <div class="flex-1" />
        <Icon title="New task" onClick={() => nav("/")}>
          <Ico name="plus" />
        </Icon>
      </div>

      <div class="flex flex-col gap-0.5">
        <Item name="home" label="Home" href="/" active={loc.pathname === "/"} />
        <Item name="list" label="Tasks" href="/tasks" active={loc.pathname === "/tasks"} />
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-1">
        <div class="flex items-center gap-1 px-2 text-text-weaker">
          <Ico name="chevron" size={11} />
          <span class="text-12-regular">Recents</span>
          <div class="flex-1" />
          <Ico name="sliders" size={11} />
        </div>
        <div class="flex min-h-0 flex-col overflow-y-auto">
          <For each={recent()}>
            {(task) => (
              <button
                type="button"
                onClick={() => nav(`/task/${task.id}`)}
                class={`flex w-full items-center gap-2 overflow-hidden rounded-md px-2 py-1 text-left text-12-regular transition-colors ${
                  loc.pathname === `/task/${task.id}`
                    ? "bg-surface-base-active text-text-strong"
                    : "text-text-weak hover:bg-surface-base-hover hover:text-text-base"
                }`}
              >
                <Dot state={store.state(task.id)} />
                <span class="truncate">{task.title || "Untitled task"}</span>
              </button>
            )}
          </For>
          <Show when={recent().length === 0}>
            <div class="px-2 py-1 text-12-regular text-text-weaker">No tasks yet</div>
          </Show>
        </div>
      </div>

      <button
        type="button"
        onClick={() => nav("/connect")}
        class="flex items-center gap-2 overflow-hidden rounded-md border-t border-border-weak-base px-2 pt-2 text-left"
        title="Change server"
      >
        <span class={`size-1.5 shrink-0 rounded-full ${health()}`} />
        <span class="truncate text-12-regular text-text-weaker">{server.conn ? label(server.conn) : "no server"}</span>
      </button>

      <ResizeHandle
        direction="horizontal"
        edge="end"
        size={width()}
        min={WIDTH_MIN}
        max={ceiling()}
        onResize={resize}
      />
    </div>
  )
}
