import { test, expect } from "bun:test"
import path from "path"
import { Web } from "../../src/server/web"
import { tmpdir } from "../fixture/fixture"

test("serves exact files and spa fallback", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "index.html"), "<html>ok</html>")
      await Bun.write(path.join(dir, "assets", "app.js"), "console.log(1)")
    },
  })

  expect(Web.resolve(tmp.path, "/")).toBe(path.join(tmp.path, "index.html"))
  expect(Web.resolve(tmp.path, "/index.html")).toBe(path.join(tmp.path, "index.html"))
  expect(Web.resolve(tmp.path, "/assets/app.js")).toBe(path.join(tmp.path, "assets", "app.js"))
  expect(Web.resolve(tmp.path, "/session/abc")).toBe(path.join(tmp.path, "index.html"))
  expect(Web.resolve(tmp.path, "/missing.js")).toBeUndefined()
})

test("rejects path traversal", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "index.html"), "<html>ok</html>")
    },
  })

  expect(Web.resolve(tmp.path, "/../index.html")).toBeUndefined()
  expect(Web.resolve(tmp.path, "/foo/../../index.html")).toBeUndefined()
})
