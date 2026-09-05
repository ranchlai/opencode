import type { FileDiff } from "@opencode-ai/sdk/v2/client"
import { diffLines } from "diff"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Ico } from "@/components/ui"

type Row = { type: "add" | "del" | "ctx" | "gap"; text: string }

function rows(file: FileDiff) {
  return diffLines(file.before ?? "", file.after ?? "").flatMap<Row>((chunk) => {
    const lines = chunk.value.replace(/\n$/, "").split("\n")
    if (chunk.added) return lines.map((text) => ({ type: "add", text }))
    if (chunk.removed) return lines.map((text) => ({ type: "del", text }))
    if (lines.length <= 4) return lines.map((text) => ({ type: "ctx", text }))
    return [
      { type: "ctx", text: lines[0] },
      { type: "gap", text: `${lines.length - 2} unchanged lines` },
      { type: "ctx", text: lines[lines.length - 1] },
    ]
  })
}

const tint = {
  add: "bg-surface-diff-add-weak text-text-diff-add-base",
  del: "bg-surface-diff-delete-weak text-text-diff-delete-base",
  ctx: "text-text-weak",
  gap: "text-text-weaker italic",
}

export function Diff(props: { file: FileDiff; open?: boolean }) {
  const [open, setOpen] = createSignal(props.open ?? false)
  const lines = createMemo(() => (open() || props.open ? rows(props.file) : []))

  return (
    <div class="overflow-hidden rounded-lg border border-border-weak-base">
      <Show when={!props.open}>
        <button
          type="button"
          onClick={() => setOpen(!open())}
          class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-base-hover"
        >
          <Ico name="file" size={12} class="text-icon-weak-base" />
          <span class="min-w-0 flex-1 truncate font-mono text-12-regular text-text-base">{props.file.file}</span>
          <span class="shrink-0 text-12-regular text-text-diff-add-base">+{props.file.additions}</span>
          <span class="shrink-0 text-12-regular text-text-diff-delete-base">-{props.file.deletions}</span>
        </button>
      </Show>
      <Show when={open() || props.open}>
        <div class={`overflow-auto py-1 ${props.open ? "max-h-none" : "max-h-80 border-t border-border-weaker-base"}`}>
          <For each={lines()}>
            {(line) => (
              <div class={`px-3 font-mono text-12-regular whitespace-pre-wrap ${tint[line.type]}`}>
                {line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}
                {line.text}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
