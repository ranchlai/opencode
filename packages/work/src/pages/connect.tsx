import { useNavigate } from "@solidjs/router"
import { createSignal, Show } from "solid-js"
import { Btn } from "@/components/ui"
import { useServer } from "@/context/server"
import { normalize, sdk } from "@/sdk"

export default function Connect() {
  const server = useServer()
  const nav = useNavigate()
  const [url, setUrl] = createSignal(server.conn?.url ?? "http://localhost:4096")
  const [password, setPassword] = createSignal(server.conn?.password ?? "")
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)

  const submit = async () => {
    const target = normalize(url())
    if (!target) return setError("Enter a server URL")
    setBusy(true)
    setError(undefined)
    const conn = { url: target, password: password() || undefined }
    const ok = await sdk(conn)
      .global.health()
      .then(() => true)
      .catch(() => false)
    setBusy(false)
    if (!ok) return setError("Could not reach that server")
    server.connect(conn)
    nav("/")
  }

  return (
    <div class="flex flex-1 items-center justify-center p-6">
      <div class="flex w-full max-w-100 flex-col gap-4">
        <div class="flex flex-col gap-1">
          <div class="text-14-medium text-text-strong">Connect to a machine</div>
          <div class="text-12-regular text-text-weak">
            The agent runs where the files are. This client only drives it.
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <input
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="http://localhost:4096"
            class="h-8 rounded-md border border-border-weak-base bg-surface-raised-base px-2.5 text-12-regular text-text-base outline-none focus:border-border-focus"
          />
          <input
            type="password"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="Password (optional)"
            class="h-8 rounded-md border border-border-weak-base bg-surface-raised-base px-2.5 text-12-regular text-text-base outline-none focus:border-border-focus"
          />
        </div>

        <Show when={error()}>
          <div class="text-12-regular text-text-diff-delete-base">{error()}</div>
        </Show>

        <div class="flex items-center gap-2">
          <Btn variant="primary" disabled={busy()} onClick={() => void submit()}>
            {busy() ? "Checking…" : "Connect"}
          </Btn>
          <Show when={server.conn}>
            <Btn variant="ghost" onClick={() => nav("/")}>
              Cancel
            </Btn>
          </Show>
        </div>

        <div class="text-12-regular text-text-weaker">
          Start one with <span class="font-mono">opencode serve --port 4096</span>
        </div>
      </div>
    </div>
  )
}
