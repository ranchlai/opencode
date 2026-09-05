import { MarkedProvider } from "@opencode-ai/ui/context/marked"
import { ThemeProvider } from "@opencode-ai/ui/theme"
import { MetaProvider } from "@solidjs/meta"
import { Navigate, Route, Router } from "@solidjs/router"
import { type ParentProps, Show } from "solid-js"
import { Font } from "@/components/font"
import { Rail } from "@/components/rail"
import { ServerProvider, useServer } from "@/context/server"
import { StoreProvider } from "@/context/store"
import Connect from "@/pages/connect"
import Home from "@/pages/home"
import Task from "@/pages/task"
import Tasks from "@/pages/tasks"
import "@/index.css"

function Workspace(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.conn} fallback={<Navigate href="/connect" />}>
      <StoreProvider>
        <div class="flex min-h-0 min-w-0 flex-1">
          <Rail />
          <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{props.children}</div>
        </div>
      </StoreProvider>
    </Show>
  )
}

export default function App() {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <MarkedProvider>
          <ServerProvider>
            <Router>
              <Route path="/connect" component={Connect} />
              <Route path="/" component={Workspace}>
                <Route path="/" component={Home} />
                <Route path="/tasks" component={Tasks} />
                <Route path="/task/:id" component={Task} />
              </Route>
            </Router>
          </ServerProvider>
        </MarkedProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}
