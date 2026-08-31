import { describe, expect, test } from "bun:test"
import path from "path"
import { crc32 } from "node:zlib"
import { Table } from "../../src/util/table"
import { Worktree } from "../../src/worktree"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("Table.load", () => {
  test("csv headers become $ITEM", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "bugs.csv"),
          `id,title,notes\nBUG-1,"crash, on save",urgent\nBUG-2,typo in README,\n`,
        )
        return path.join(dir, "bugs.csv")
      },
    })
    const rows = await Table.load(tmp.extra)
    expect(rows).toEqual([
      { cells: { id: "BUG-1", title: "crash, on save", notes: "urgent" }, files: [] },
      { cells: { id: "BUG-2", title: "typo in README", notes: "" }, files: [] },
    ])
    expect(Table.item(rows[0].cells)).toBe("crash, on save")
    expect(Table.fill("Fix $ID: $ITEM", rows[0].cells, 0)).toBe("Fix BUG-1: crash, on save")
  })

  test("jsonl strings", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "items.jsonl"), `"one"\n{"bug":"two"}\n`)
        return path.join(dir, "items.jsonl")
      },
    })
    const rows = await Table.load(tmp.extra)
    expect(rows).toEqual([
      { cells: { item: "one" }, files: [] },
      { cells: { bug: "two" }, files: [] },
    ])
  })

  test("xlsx inline strings", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "bugs.xlsx")
        await Bun.write(file, xlsx())
        return file
      },
    })
    const rows = await Table.load(tmp.extra)
    expect(rows.map((row) => row.cells)).toEqual([{ id: "BUG-1", title: "null deref" }])
    expect(rows[0].files).toEqual([])
    expect(Table.fill("row $ROW $TITLE", rows[0].cells, 0)).toBe("row 1 null deref")
  })

  test("xlsx screenshots attach to the row they sit on", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const file = path.join(dir, "bugs.xlsx")
        await Bun.write(file, xlsx(true))
        return file
      },
    })
    const rows = await Table.load(tmp.extra)
    expect(rows).toHaveLength(1)
    expect(rows[0].files).toHaveLength(1)
    expect(rows[0].files[0].name).toBe("image1.png")
    expect(rows[0].files[0].mime).toBe("image/png")
    expect(rows[0].files[0].bytes.byteLength).toBeGreaterThan(0)
  })
})

describe("Worktree.open", () => {
  test("checks out a populated worktree", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "readme.md"), "hello\n")
        const proc = Bun.spawn(["git", "add", "readme.md"], { cwd: dir, stdout: "ignore", stderr: "ignore" })
        await proc.exited
        const commit = Bun.spawn(["git", "commit", "-m", "add readme"], { cwd: dir, stdout: "ignore", stderr: "ignore" })
        await commit.exited
      },
    })
    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.open({ name: "hard-repeat-test" }),
    })
    try {
      expect(await Filesystem.exists(path.join(info.directory, "readme.md"))).toBe(true)
      expect(info.branch.startsWith("opencode/")).toBe(true)
    } finally {
      await Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.remove({ directory: info.directory }),
      })
    }
  })
})

function xlsx(shots = false) {
  const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>id</t></is></c>
      <c r="B1" t="inlineStr"><is><t>title</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>BUG-1</t></is></c>
      <c r="B2" t="inlineStr"><is><t>null deref</t></is></c>
    </row>
  </sheetData>
</worksheet>`
  const files: Record<string, string | Buffer> = { "xl/worksheets/sheet1.xml": sheet }
  if (shots) {
    files["xl/worksheets/_rels/sheet1.xml.rels"] = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`
    files["xl/drawings/drawing1.xml"] = `<?xml version="1.0"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>2</xdr:col><xdr:row>1</xdr:row></xdr:from>
    <xdr:to><xdr:col>3</xdr:col><xdr:row>2</xdr:row></xdr:to>
    <xdr:pic>
      <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`
    files["xl/drawings/_rels/drawing1.xml.rels"] = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`
    files["xl/media/image1.png"] = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    )
  }
  return zip(files)
}

function zip(files: Record<string, string | Buffer>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const n = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(n.length, 26)
    const piece = Buffer.concat([local, n, data])
    locals.push(piece)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc32(data), 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, n]))
    offset += piece.length
  }
  const center = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(locals.length, 8)
  eocd.writeUInt16LE(locals.length, 10)
  eocd.writeUInt32LE(center.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, center, eocd])
}
