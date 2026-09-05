import { useNavigate } from "@solidjs/router"
import { createMemo, createSignal, For, Show } from "solid-js"
import { ago, Dot, Empty } from "@/components/ui"
import { type State, useStore } from "@/context/store"

const filters = ["all", "waiting", "running", "review", "done"] as const

const rank: Record<State, number> = { waiting: 0, running: 1, review: 2, done: 3 }

const labels: Record<State, string> = {
  waiting: "Needs you",
  running: "Running",
  review: "Review",
  done: "Done",
}

export default function Tasks() {
  const store = useStore()
  const nav = useNavigate()
  const [filter, setFilter] = createSignal<(typeof filters)[number]>("all")

  const rows = createMemo(() => {
    const list = store
      .list()
      .map((task) => ({ task, state: store.state(task.id) }))
      .sort((a, b) => rank[a.state] - rank[b.state] || b.task.time.updated - a.task.time.updated)
    const active = filter()
    if (active === "all") return list
    return list.filter((row) => row.state === active)
  })

  const detail = (id: string, state: State) => {
    if (state === "waiting") {
      const perm = store.data.perm[id]?.[0]
      return perm ? `Needs you · ${perm.permission}` : "Needs you"
    }
    if (state === "running") {
      const todo = store.data.todo[id] ?? []
      const done = todo.filter((x) => x.status === "completed").length
      return todo.length > 0 ? `Running · ${done} of ${todo.length}` : "Running"
    }
    const files = store.data.diff[id]?.length ?? store.data.session[id]?.summary?.files ?? 0
    if (state === "review") return `Review · ${files} ${files === 1 ? "file" : "files"}`
    return "Done"
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div class="flex items-center gap-2">
        <div class="text-14-medium text-text-strong">Tasks</div>
        <div class="flex-1" />
        <For each={filters}>
          {(item) => (
            <button
              type="button"
              onClick={() => setFilter(item)}
              class={`rounded-full px-2.5 py-1 text-12-regular capitalize transition-colors ${
                filter() === item
                  ? "bg-surface-base-active text-text-strong"
                  : "text-text-weak hover:bg-surface-base-hover"
              }`}
            >
              {item === "waiting" ? "Needs you" : item}
            </button>
          )}
        </For>
      </div>

      <Show when={rows().length > 0} fallback={<Empty title="Nothing here" body="Start a task from the front page." />}>
        <div class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border-weak-base">
          <For each={rows()}>
            {(row) => (
              <button
                type="button"
                onClick={() => nav(`/task/${row.task.id}`)}
                class="flex w-full items-center gap-3 border-b border-border-weaker-base px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-base-hover"
              >
                <Dot state={row.state} />
                <div class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-12-medium text-text-base">{row.task.title || "Untitled task"}</span>
                  <span class="truncate text-12-regular text-text-weaker">{store.short(row.task.directory)}</span>
                </div>
                <span class="shrink-0 text-12-regular text-text-weak">{detail(row.task.id, row.state)}</span>
                <span class="w-8 shrink-0 text-right text-12-regular text-text-weaker">
                  {ago(row.task.time.updated)}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="text-12-regular text-text-weaker">{labels.waiting} sorts first, then running and review.</div>
    </div>
  )
}
