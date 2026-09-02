import path from "path"
import { crc32, inflateRawSync } from "node:zlib"

export namespace Table {
  export type Cells = Record<string, string>

  export type File = {
    name: string
    mime: string
    bytes: Uint8Array
  }

  export type Item = {
    cells: Cells
    files: File[]
  }

  const ITEM = ["item", "bug", "title", "summary", "description", "text", "prompt"]
  const IMAGE: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  }

  export async function load(file: string): Promise<Item[]> {
    const raw = await Bun.file(file).arrayBuffer()
    const ext = path.extname(file).toLowerCase()
    if (ext === ".xlsx" || ext === ".xlsm") return xlsx(Buffer.from(raw))
    const text = Buffer.from(raw).toString("utf8").replace(/^\uFEFF/, "")
    if (ext === ".json") return json(text)
    if (ext === ".jsonl" || ext === ".ndjson") return jsonl(text)
    return csv(text)
  }

  export function item(cells: Cells, column?: string) {
    if (column) {
      const key = keyname(column)
      const hit = cells[key] ?? cells[column]
      if (hit?.trim()) return hit
    }
    for (const name of ITEM) {
      if (cells[name]?.trim()) return cells[name]
    }
    return Object.values(cells)
      .filter((value) => value.trim())
      .join("\n")
  }

  export async function save(file: string, rows: Cells[], columns?: string[]) {
    const keys = columns ?? names(rows)
    const ext = path.extname(file).toLowerCase()
    if (ext === ".csv") {
      await Bun.write(file, csvText(keys, rows))
      return
    }
    if (ext === ".xlsx" || ext === ".xlsm") {
      await Bun.write(file, book(keys, rows))
      return
    }
    throw new Error(`Unsupported table format: ${ext}`)
  }

  export function fill(tmpl: string, cells: Cells, index: number, column?: string) {
    const extra: Cells = {
      ...cells,
      item: item(cells, column),
      row: String(index + 1),
    }
    return tmpl.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name: string) => {
      const hit = extra[name.toLowerCase()]
      return hit === undefined ? match : hit
    })
  }

  function wrap(entry: unknown, i: number): Item[] {
    if (typeof entry === "string") return [{ cells: { item: entry }, files: [] }]
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const cells: Cells = {}
      for (const [name, value] of Object.entries(entry as Record<string, unknown>)) {
        cells[keyname(name)] = value == null ? "" : String(value)
      }
      return [{ cells, files: [] }]
    }
    throw new Error(`Invalid table row at index ${i}`)
  }

  function json(text: string): Item[] {
    const data = JSON.parse(text)
    if (Array.isArray(data)) return data.flatMap((entry, i) => wrap(entry, i))
    throw new Error("JSON table must be an array")
  }

  function jsonl(text: string): Item[] {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .flatMap((line, i) => wrap(JSON.parse(line), i))
  }

  function csv(text: string): Item[] {
    const grid = parseCsv(text)
    if (!grid.length) return []
    const header = grid[0].map((cell, i) => keyname(cell) || `col_${i + 1}`)
    return grid.slice(1).flatMap((line) => {
      if (line.every((cell) => !cell.trim())) return []
      const cells: Cells = {}
      for (let i = 0; i < header.length; i++) {
        cells[header[i]] = line[i] ?? ""
      }
      return [{ cells, files: [] }]
    })
  }

  function parseCsv(text: string) {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ""
    let quoted = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"'
            i++
            continue
          }
          quoted = false
          continue
        }
        cell += ch
        continue
      }
      if (ch === '"') {
        quoted = true
        continue
      }
      if (ch === ",") {
        row.push(cell)
        cell = ""
        continue
      }
      if (ch === "\n") {
        row.push(cell)
        rows.push(row)
        row = []
        cell = ""
        continue
      }
      if (ch === "\r") continue
      cell += ch
    }
    if (cell.length || row.length) {
      row.push(cell)
      rows.push(row)
    }
    return rows
  }

  function keyname(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
  }

  function xlsx(buf: Buffer): Item[] {
    const entries = unzip(buf)
    const sheet = entries.get("xl/worksheets/sheet1.xml")
    if (!sheet) throw new Error("xlsx is missing xl/worksheets/sheet1.xml")
    const shared = entries.get("xl/sharedStrings.xml")
    const strings = shared ? parseShared(plain(shared.toString("utf8"))) : []
    const xml = plain(sheet.toString("utf8"))
    const grid = parseSheet(xml, strings)
    if (!grid.length) return []
    const header = (grid[0] ?? []).map((cell, i) => keyname(cell) || `col_${i + 1}`)
    const byRow = pictures(entries)
    const named = cellimages(entries)
    return grid.slice(1).flatMap((line, i) => {
      const excel = i + 1
      const files = [...(byRow.get(excel) ?? [])]
      const cells: Cells = {}
      for (let c = 0; c < header.length; c++) {
        cells[header[c]] = line[c] ?? ""
      }
      for (const id of dispimg(Object.values(cells).join("\n"))) {
        const hit = named.get(id)
        if (hit) files.push(hit)
      }
      if (line.every((cell) => !cell.trim()) && !files.length) return []
      return [{ cells, files: dedupe(files) }]
    })
  }

  function pictures(entries: Map<string, Buffer>) {
    const out = new Map<number, File[]>()
    const rels = parseRels(entries.get("xl/worksheets/_rels/sheet1.xml.rels")?.toString("utf8") ?? "")
    for (const target of Object.values(rels)) {
      if (!target.includes("drawing")) continue
      const part = resolve("xl/worksheets/_rels/sheet1.xml.rels", target)
      const drawing = entries.get(part)
      if (!drawing) continue
      const embeds = parseRels(entries.get(relfile(part))?.toString("utf8") ?? "")
      const xml = plain(drawing.toString("utf8"))
      const re = /<(twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/\1>/gi
      let match: RegExpExecArray | null
      while ((match = re.exec(xml))) {
        const body = match[2]
        const from = body.match(/<from\b[^>]*>([\s\S]*?)<\/from>/i)?.[1] ?? ""
        const row = Number(from.match(/<row\b[^>]*>(\d+)<\/row>/i)?.[1])
        if (!Number.isFinite(row)) continue
        const rid = body.match(/<blip\b[^>]*\bembed="([^"]+)"/i)?.[1]
        if (!rid || !embeds[rid]) continue
        const file = media(entries, resolve(relfile(part), embeds[rid]))
        if (!file) continue
        const list = out.get(row) ?? []
        list.push(file)
        out.set(row, list)
      }
    }
    return out
  }

  function cellimages(entries: Map<string, Buffer>) {
    const out = new Map<string, File>()
    const xml = entries.get("xl/cellimages.xml")
    if (!xml) return out
    const embeds = parseRels(entries.get("xl/_rels/cellimages.xml.rels")?.toString("utf8") ?? "")
    const re = /<cellImage\b[^>]*>([\s\S]*?)<\/cellImage>/gi
    const text = plain(xml.toString("utf8"))
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) {
      const body = match[1]
      const name = attr(body.match(/<cNvPr\b([^>]*)>/i)?.[1] ?? "", "name")
      const rid = body.match(/<blip\b[^>]*\bembed="([^"]+)"/i)?.[1]
      if (!name || !rid || !embeds[rid]) continue
      const file = media(entries, resolve("xl/_rels/cellimages.xml.rels", embeds[rid]))
      if (file) out.set(name, file)
    }
    return out
  }

  function dispimg(text: string) {
    const out: string[] = []
    const re = /DISPIMG\s*\(\s*"([^"]+)"/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) out.push(match[1])
    return out
  }

  function media(entries: Map<string, Buffer>, loc: string): File | undefined {
    const bytes = entries.get(loc)
    if (!bytes) return
    const ext = path.posix.extname(loc).toLowerCase()
    const mime = IMAGE[ext]
    if (!mime) return
    return { name: path.posix.basename(loc), mime, bytes }
  }

  function parseRels(xml: string) {
    const out: Record<string, string> = {}
    const re = /<Relationship\b([^>]*)\/?>/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(xml))) {
      const id = attr(match[1], "Id")
      const target = attr(match[1], "Target")
      if (id && target) out[id] = target
    }
    return out
  }

  function relfile(part: string) {
    return path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`)
  }

  function resolve(from: string, target: string) {
    const cleaned = decodeURIComponent(target.replace(/\\/g, "/"))
    if (cleaned.startsWith("/")) return path.posix.normalize(cleaned.replace(/^\/+/, ""))
    const dir = path.posix.dirname(from).replace(/\/_rels$/, "")
    return path.posix.normalize(path.posix.join(dir, cleaned))
  }

  function dedupe(files: File[]) {
    const seen = new Set<string>()
    return files.filter((file) => {
      const key = `${file.name}:${file.bytes.byteLength}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  function plain(xml: string) {
    return xml.replace(/(<\/?)[\w.-]+:/g, "$1").replace(/(\s)[\w.-]+:([\w.-]+=)/g, "$1$2")
  }

  function parseShared(xml: string) {
    const out: string[] = []
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(xml))) {
      out.push(texts(match[1]))
    }
    return out
  }

  function parseSheet(xml: string, strings: string[]) {
    const rows: string[][] = []
    const re = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(xml))) {
      const attrs = match[1] ?? match[3] ?? ""
      const inner = match[2] ?? ""
      const ref = attr(attrs, "r")
      if (!ref) continue
      const letters = ref.match(/^[A-Z]+/i)?.[0] ?? "A"
      const index = Number(ref.match(/\d+/)?.[0] ?? "1") - 1
      const kind = attr(attrs, "t")
      const value =
        kind === "inlineStr" || kind === "str"
          ? texts(inner)
          : kind === "s"
            ? (strings[Number(tag(inner, "v"))] ?? "")
            : (tag(inner, "v") ?? texts(inner))
      const col = column(letters)
      const row = (rows[index] ??= [])
      row[col] = value
    }
    return rows.map((row) => {
      const width = row.length
      return Array.from({ length: width }, (_, i) => row[i] ?? "")
    })
  }

  function column(letters: string) {
    let n = 0
    for (const ch of letters.toUpperCase()) {
      n = n * 26 + (ch.charCodeAt(0) - 64)
    }
    return n - 1
  }

  function attr(input: string, name: string) {
    return input.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1]
  }

  function tag(xml: string, name: string) {
    return xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim()
  }

  function texts(xml: string) {
    const parts: string[] = []
    const re = /<t\b[^>]*>([\s\S]*?)<\/t>/gi
    let match: RegExpExecArray | null
    while ((match = re.exec(xml))) {
      parts.push(decode(match[1]))
    }
    return parts.join("")
  }

  function decode(input: string) {
    return input
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
  }

  function unzip(buf: Buffer) {
    const out = new Map<string, Buffer>()
    let eocd = -1
    const start = Math.max(0, buf.length - 22 - 65535)
    for (let i = buf.length - 22; i >= start; i--) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
        eocd = i
        break
      }
    }
    if (eocd < 0) throw new Error("invalid xlsx (zip)")
    const count = buf.readUInt16LE(eocd + 10)
    let off = buf.readUInt32LE(eocd + 16)
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("invalid xlsx central directory")
      const method = buf.readUInt16LE(off + 10)
      const size = buf.readUInt32LE(off + 20)
      const namelen = buf.readUInt16LE(off + 28)
      const extra = buf.readUInt16LE(off + 30)
      const comment = buf.readUInt16LE(off + 32)
      const local = buf.readUInt32LE(off + 42)
      const name = buf.subarray(off + 46, off + 46 + namelen).toString()
      off += 46 + namelen + extra + comment
      const lname = buf.readUInt16LE(local + 26)
      const lextra = buf.readUInt16LE(local + 28)
      const data = buf.subarray(local + 30 + lname + lextra, local + 30 + lname + lextra + size)
      const bytes = method === 0 ? Buffer.from(data) : method === 8 ? inflateRawSync(data) : undefined
      if (!bytes) throw new Error(`unsupported zip method ${method}`)
      out.set(name.replace(/\\/g, "/"), Buffer.from(bytes))
    }
    return out
  }

  function names(rows: Cells[]) {
    return [...new Set(rows.flatMap((row) => Object.keys(row)))]
  }

  function csvText(keys: string[], rows: Cells[]) {
    const lines = [keys.map(quote).join(","), ...rows.map((row) => keys.map((key) => quote(row[key] ?? "")).join(","))]
    return lines.join("\n") + "\n"
  }

  function quote(value: string) {
    if (!/[",\n\r]/.test(value)) return value
    return `"${value.replaceAll('"', '""')}"`
  }

  function book(keys: string[], rows: Cells[]) {
    const grid = [keys, ...rows.map((row) => keys.map((key) => row[key] ?? ""))]
    const cells = grid
      .map((line, r) => {
        const inner = line
          .map((value, c) => {
            const ref = `${alpha(c)}${r + 1}`
            return `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`
          })
          .join("")
        return `<row r="${r + 1}">${inner}</row>`
      })
      .join("")
    return zip({
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
      "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
      "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
      "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${cells}</sheetData>
</worksheet>`,
    })
  }

  function alpha(index: number) {
    let n = index
    let out = ""
    while (n >= 0) {
      out = String.fromCharCode((n % 26) + 65) + out
      n = Math.floor(n / 26) - 1
    }
    return out
  }

  function escape(text: string) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
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
}
