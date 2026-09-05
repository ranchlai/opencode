import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { mergeDeep } from "remeda"
import { type Component, createEffect, createResource, createSignal, untrack } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import type { Config } from "@opencode-ai/sdk/v2/client"

function prune(value: unknown): unknown {
  if (value === null) return undefined
  if (Array.isArray(value)) return value.map(prune)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, prune(item)])
        .filter(([, item]) => item !== undefined),
    )
  }
  return value
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export const SettingsConfig: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const global = useGlobalSync()
  const [text, setText] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [loaded, setLoaded] = createSignal(false)

  const [defaults] = createResource(() =>
    globalSDK.client.config.defaults().then((x) => (x.data ?? {}) as Record<string, unknown>),
  )

  createEffect(() => {
    const base = defaults()
    if (!base || loaded()) return
    setText(pretty(mergeDeep(base, untrack(() => global.data.config) as Record<string, unknown>)))
    setLoaded(true)
  })

  const save = () => {
    let parsed: Config
    try {
      parsed = JSON.parse(text()) as Config
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("settings.config.invalid"), description: message })
      return
    }
    const next = prune(parsed) as Config
    setSaving(true)
    void global
      .updateConfig(next)
      .then(() => {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("settings.config.saved.title"),
          description: language.t("settings.config.saved.description"),
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setSaving(false))
  }

  const reset = () => {
    const base = defaults()
    if (!base) return
    setText(pretty(base))
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.config.title")}</h2>
          <p class="text-12-regular text-text-weak">{language.t("settings.config.description")}</p>
          <p class="text-12-regular text-text-weak">{global.data.path.config}</p>
        </div>
      </div>

      <div class="flex flex-col gap-4 max-w-[720px]">
        <textarea
          data-action="settings-config-editor"
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
          spellcheck={false}
          class="w-full min-h-[28rem] font-mono text-12-regular text-text-strong bg-surface-base rounded-lg p-3 border border-border-weak-base resize-y"
        />
        <div class="flex gap-2 justify-end">
          <Button variant="ghost" size="small" onClick={reset} disabled={defaults.loading}>
            {language.t("settings.config.reset")}
          </Button>
          <Button variant="primary" size="small" onClick={save} disabled={saving()}>
            {language.t("settings.config.save")}
          </Button>
        </div>
      </div>
    </div>
  )
}
