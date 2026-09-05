import type { Config } from "@opencode-ai/sdk/v2/client"
import { createEffect, createSignal, onCleanup, untrack } from "solid-js"
import { useLanguage, type Locale } from "@/context/language"
import { useSettings } from "@/context/settings"
import { useGlobalSync } from "@/context/global-sync"
import { useTheme } from "@opencode-ai/ui/theme"

type Ui = NonNullable<Config["ui"]>

function json(value: unknown) {
  return JSON.stringify(value)
}

export function ConfigSync() {
  const global = useGlobalSync()
  const settings = useSettings()
  const theme = useTheme()
  const language = useLanguage()

  const [primed, setPrimed] = createSignal(false)
  let last = ""
  let timer: ReturnType<typeof setTimeout> | undefined

  const snap = (): Ui => ({
    theme: theme.themeId(),
    colorScheme: theme.colorScheme(),
    language: language.locale(),
    font: settings.appearance.font(),
    fontSize: settings.appearance.fontSize(),
    keybinds: { ...settings.current.keybinds },
    followup: settings.general.followup(),
    showReasoningSummaries: settings.general.showReasoningSummaries(),
    shellToolPartsExpanded: settings.general.shellToolPartsExpanded(),
    editToolPartsExpanded: settings.general.editToolPartsExpanded(),
    notifications: {
      agent: settings.notifications.agent(),
      permissions: settings.notifications.permissions(),
      errors: settings.notifications.errors(),
    },
    sounds: {
      agentEnabled: settings.sounds.agentEnabled(),
      agent: settings.sounds.agent(),
      permissionsEnabled: settings.sounds.permissionsEnabled(),
      permissions: settings.sounds.permissions(),
      errorsEnabled: settings.sounds.errorsEnabled(),
      errors: settings.sounds.errors(),
    },
  })

  const apply = (ui: Ui) => {
    if (ui.theme) theme.setTheme(ui.theme)
    if (ui.colorScheme) theme.setColorScheme(ui.colorScheme)
    if (ui.language) language.setLocale(ui.language as Locale)
    if (ui.font) settings.appearance.setFont(ui.font)
    if (ui.fontSize !== undefined) settings.appearance.setFontSize(ui.fontSize)
    if (ui.followup) settings.general.setFollowup(ui.followup)
    if (ui.showReasoningSummaries !== undefined) settings.general.setShowReasoningSummaries(ui.showReasoningSummaries)
    if (ui.shellToolPartsExpanded !== undefined) settings.general.setShellToolPartsExpanded(ui.shellToolPartsExpanded)
    if (ui.editToolPartsExpanded !== undefined) settings.general.setEditToolPartsExpanded(ui.editToolPartsExpanded)
    if (ui.notifications?.agent !== undefined) settings.notifications.setAgent(ui.notifications.agent)
    if (ui.notifications?.permissions !== undefined) settings.notifications.setPermissions(ui.notifications.permissions)
    if (ui.notifications?.errors !== undefined) settings.notifications.setErrors(ui.notifications.errors)
    if (ui.sounds?.agentEnabled !== undefined) settings.sounds.setAgentEnabled(ui.sounds.agentEnabled)
    if (ui.sounds?.agent) settings.sounds.setAgent(ui.sounds.agent)
    if (ui.sounds?.permissionsEnabled !== undefined) settings.sounds.setPermissionsEnabled(ui.sounds.permissionsEnabled)
    if (ui.sounds?.permissions) settings.sounds.setPermissions(ui.sounds.permissions)
    if (ui.sounds?.errorsEnabled !== undefined) settings.sounds.setErrorsEnabled(ui.sounds.errorsEnabled)
    if (ui.sounds?.errors) settings.sounds.setErrors(ui.sounds.errors)
    if (ui.keybinds) {
      for (const [action, bind] of Object.entries(ui.keybinds)) {
        if (bind) settings.keybinds.set(action, bind)
      }
    }
  }

  createEffect(() => {
    if (!global.ready) {
      setPrimed(false)
      return
    }
    if (primed()) return
    const ui = untrack(() => global.data.config.ui)
    if (ui) apply(ui)
    last = json(untrack(() => snap()))
    setPrimed(true)
  })

  createEffect(() => {
    const next = snap()
    if (!primed()) return
    const raw = json(next)
    if (raw === last) return
    last = raw
    clearTimeout(timer)
    timer = setTimeout(() => {
      void global.updateUi(next)
    }, 400)
  })

  onCleanup(() => clearTimeout(timer))

  return null
}
