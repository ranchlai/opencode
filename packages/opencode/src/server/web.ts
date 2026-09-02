import path from "path"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"

export namespace Web {
  export const csp =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"

  const root = lazy(() => {
    const dirs = [
      Flag.OPENCODE_WEB_DIR,
      path.join(import.meta.dirname, "../../../app/dist"),
      path.join(path.dirname(process.execPath), "web"),
    ]
    return dirs.find((dir) => dir && Filesystem.stat(path.join(dir, "index.html")))
  })

  export function resolve(dir: string, url: string) {
    const name = url === "/" ? "index.html" : decodeURIComponent(url.replace(/^\/+/, ""))
    const target = path.join(dir, name)
    if (!Filesystem.contains(dir, target)) return
    if (Filesystem.stat(target)?.isFile()) return target
    if (path.extname(name)) return
    const index = path.join(dir, "index.html")
    if (Filesystem.stat(index)?.isFile()) return index
  }

  export function file(url: string) {
    const dir = root()
    if (!dir) return
    const match = resolve(dir, url)
    if (!match) return
    return Bun.file(match)
  }
}
