import { For, Show } from "solid-js"
import { Ico } from "@/components/ui"

export function Composer(props: {
  text: string
  onText: (value: string) => void
  folder: string
  onFolder: (value: string) => void
  folders: { value: string; label: string }[]
  onSubmit: () => void
  busy?: boolean
  placeholder?: string
}) {
  let field: HTMLTextAreaElement | undefined

  const grow = () => {
    if (!field) return
    field.style.height = "auto"
    field.style.height = `${Math.min(field.scrollHeight, 220)}px`
  }

  const send = () => {
    if (props.busy) return
    if (!props.text.trim()) return
    if (!props.folder) return
    props.onSubmit()
    if (field) field.style.height = "auto"
  }

  return (
    <div class="rounded-xl border border-border-weak-base bg-surface-raised-base p-2.5">
      <textarea
        ref={field}
        rows={2}
        value={props.text}
        placeholder={props.placeholder ?? "Describe what should get done…"}
        onInput={(e) => {
          props.onText(e.currentTarget.value)
          grow()
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          if (e.shiftKey) return
          e.preventDefault()
          send()
        }}
        class="w-full resize-none bg-transparent px-1 py-1 text-14-regular text-text-base outline-none placeholder:text-text-weaker"
      />
      <div class="flex items-center gap-2">
        <label class="flex items-center gap-1.5 rounded-full border border-border-weak-base px-2 py-1 text-12-regular text-text-weak">
          <Ico name="folder" size={11} />
          <Show when={props.folders.length > 0} fallback={<span>No folders</span>}>
            <select
              value={props.folder}
              onChange={(e) => props.onFolder(e.currentTarget.value)}
              class="max-w-50 truncate bg-transparent text-12-regular text-text-weak outline-none"
            >
              <For each={props.folders}>
                {(item) => (
                  <option value={item.value} class="bg-background-base text-text-base">
                    {item.label}
                  </option>
                )}
              </For>
            </select>
          </Show>
        </label>
        <div class="flex-1" />
        <button
          type="button"
          title="Start"
          disabled={props.busy || !props.text.trim() || !props.folder}
          onClick={send}
          class="inline-flex size-7 items-center justify-center rounded-full bg-surface-interactive-base text-text-on-interactive-base transition-opacity disabled:opacity-30"
        >
          <Ico name="up" />
        </button>
      </div>
    </div>
  )
}
