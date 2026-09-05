import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Composer } from "@/components/composer"
import { Ico } from "@/components/ui"
import { useStore } from "@/context/store"

const KEY = "opencode.work:folder"

const starters = ["Summarize what changed in this folder", "Sort the files by date", "Draft a status update"]

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

export default function Home() {
  const store = useStore()
  const nav = useNavigate()
  const [text, setText] = createSignal("")
  const [folder, setFolder] = createSignal(localStorage.getItem(KEY) ?? "")
  const [busy, setBusy] = createSignal(false)

  const folders = createMemo(() =>
    store.data.project.map((item) => ({ value: item.worktree, label: store.short(item.worktree) })),
  )

  const name = createMemo(() => {
    const base = store.data.home.split("/").filter(Boolean).pop()
    if (!base) return
    return base.charAt(0).toUpperCase() + base.slice(1)
  })

  createEffect(() => {
    const list = folders()
    if (list.length === 0) return
    if (list.some((item) => item.value === folder())) return
    setFolder(list[0].value)
  })

  const pick = (value: string) => {
    setFolder(value)
    localStorage.setItem(KEY, value)
  }

  const submit = async () => {
    setBusy(true)
    const id = await store.start({ directory: folder(), text: text().trim() }).catch(() => undefined)
    setBusy(false)
    if (!id) return
    setText("")
    nav(`/task/${id}`)
  }

  return (
    <div class="flex flex-1 flex-col items-center justify-center p-7">
      <div class="flex w-full max-w-130 flex-col gap-5">
        <div class="flex items-center justify-center gap-2">
          <Ico name="mark" size={18} class="text-icon-warning-base" />
          <span data-component="greeting" class="text-text-strong">
            {greeting()}
            <Show when={name()}>{(value) => `, ${value()}`}</Show>
          </span>
        </div>

        <Composer
          text={text()}
          onText={setText}
          folder={folder()}
          onFolder={pick}
          folders={folders()}
          onSubmit={() => void submit()}
          busy={busy()}
          placeholder="Turn the notes in this folder into a one-page brief…"
        />

        <Show
          when={folders().length > 0}
          fallback={
            <div class="text-center text-12-regular text-text-weaker">
              No folders known to this server yet. Open one with the TUI or desktop app first.
            </div>
          }
        >
          <div class="flex flex-wrap justify-center gap-1.5">
            <For each={starters}>
              {(item) => (
                <button
                  type="button"
                  onClick={() => setText(item)}
                  class="rounded-full border border-border-weak-base px-2.5 py-1 text-12-regular text-text-weak transition-colors hover:bg-surface-base-hover hover:text-text-base"
                >
                  {item}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
