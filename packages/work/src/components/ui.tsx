import { type JSX, type ParentProps, Show } from "solid-js"
import type { State } from "@/context/store"

const paths = {
  search: "M6.2 2.5a3.7 3.7 0 100 7.4 3.7 3.7 0 000-7.4z M9.2 9.2L12 12",
  home: "M2.5 6.5L7 2.8l4.5 3.7V11.5h-9z",
  plus: "M7 2.6v8.8 M2.6 7h8.8",
  list: "M3 4h8 M3 7h8 M3 10h5",
  folder: "M2.2 3.6h3.2l1 1.4h5.4v5.4H2.2z",
  chevron: "M4 6l3 3 3-3",
  sliders: "M3 4.5h8 M3 9.5h8 M5.5 3.2v2.6 M8.5 8.2v2.6",
  up: "M7 11V3.4 M3.8 6.6L7 3.4l3.2 3.2",
  mark: "M7 2.6v8.8 M3 4.4l8 5.2 M11 4.4l-8 5.2",
  check: "M3 7.4l2.6 2.6L11 4.6",
  file: "M3.6 2.4h4l3 3v6.2h-7z M7.4 2.4v3.2h3",
  spin: "M7 2.4a4.6 4.6 0 104.6 4.6",
} as const

export type Name = keyof typeof paths

export function Ico(props: { name: Name; size?: number; class?: string }) {
  return (
    <svg
      width={props.size ?? 13}
      height={props.size ?? 13}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`shrink-0 ${props.class ?? ""}`}
    >
      <path d={paths[props.name]} />
    </svg>
  )
}

const tones: Record<State, string> = {
  waiting: "bg-icon-warning-base",
  running: "bg-icon-info-base",
  review: "bg-icon-success-base",
  done: "bg-border-strong-base",
}

export function Dot(props: { state: State; size?: number }) {
  return (
    <span
      class={`shrink-0 rounded-full ${tones[props.state]}`}
      style={{ width: `${props.size ?? 6}px`, height: `${props.size ?? 6}px` }}
    />
  )
}

const variants = {
  primary: "bg-surface-interactive-base text-text-on-interactive-base hover:bg-surface-interactive-hover",
  secondary: "border border-border-weak-base text-text-base hover:bg-surface-base-hover",
  ghost: "text-text-weak hover:bg-surface-base-hover hover:text-text-base",
}

export function Btn(
  props: ParentProps<{
    variant?: keyof typeof variants
    disabled?: boolean
    title?: string
    onClick?: () => void
  }>,
) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={() => props.onClick?.()}
      class={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-12-medium transition-colors disabled:opacity-40 ${
        variants[props.variant ?? "secondary"]
      }`}
    >
      {props.children}
    </button>
  )
}

export function Icon(
  props: ParentProps<{
    title: string
    onClick?: () => void
  }>,
) {
  return (
    <button
      type="button"
      title={props.title}
      onClick={() => props.onClick?.()}
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-icon-weak-base transition-colors hover:bg-surface-base-hover hover:text-icon-base"
    >
      {props.children}
    </button>
  )
}

export function Empty(props: { title: string; body?: string; action?: JSX.Element }) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <div class="text-14-medium text-text-strong">{props.title}</div>
      <Show when={props.body}>
        <div class="text-12-regular text-text-weak">{props.body}</div>
      </Show>
      {props.action}
    </div>
  )
}

export function ago(time: number) {
  const delta = Date.now() - time
  const min = Math.round(delta / 60_000)
  if (min < 1) return "now"
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.round(hr / 24)}d`
}
