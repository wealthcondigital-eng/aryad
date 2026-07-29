// Browser-side .xlsx reader for the monthly patient register.
//
// No SheetJS / exceljs dependency: an .xlsx is a ZIP of XML parts, and the
// browser already ships both halves of what it takes to open one —
// DecompressionStream("deflate-raw") for the ZIP entries and DOMParser for the
// XML. That keeps a ~400 KB register import out of the bundle and off the
// server (only the parsed rows are POSTed).

// ── ZIP ──────────────────────────────────────────────────────────────────────

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Reads the central directory rather than scanning local headers, because a
// local header's sizes may be zero when the writer used a data descriptor.
async function unzip(buf: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const view  = new DataView(buf)
  const bytes = new Uint8Array(buf)

  let eocd = -1
  for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 66_000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file (no ZIP end record)")

  const count     = view.getUint16(eocd + 10, true)
  let   entryPtr  = view.getUint32(eocd + 16, true)
  const out: Record<string, Uint8Array> = {}
  const decoder   = new TextDecoder()

  for (let n = 0; n < count; n++) {
    if (view.getUint32(entryPtr, true) !== 0x02014b50) break
    const method     = view.getUint16(entryPtr + 10, true)
    const compSize   = view.getUint32(entryPtr + 20, true)
    const nameLen    = view.getUint16(entryPtr + 28, true)
    const extraLen   = view.getUint16(entryPtr + 30, true)
    const commentLen = view.getUint16(entryPtr + 32, true)
    const localOff   = view.getUint32(entryPtr + 42, true)
    const name       = decoder.decode(bytes.subarray(entryPtr + 46, entryPtr + 46 + nameLen))
    entryPtr += 46 + nameLen + extraLen + commentLen

    // Only the parts the register needs — skip printer settings, drawings, themes
    if (!/^(xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(name)) continue

    const lNameLen  = view.getUint16(localOff + 26, true)
    const lExtraLen = view.getUint16(localOff + 28, true)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw       = bytes.subarray(dataStart, dataStart + compSize)
    out[name] = method === 0 ? raw : await inflateRaw(raw)
  }
  return out
}

// ── Sheet extraction ─────────────────────────────────────────────────────────

type Grid = Record<number, Record<string, string>>   // row number → column letter → text

function parseXml(bytes: Uint8Array) {
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml")
  if (doc.querySelector("parsererror")) throw new Error("Could not read the workbook XML")
  return doc
}

function colOf(ref: string) {
  return ref.replace(/\d+/g, "")
}

function sheetGrid(doc: Document, shared: string[]): Grid {
  const grid: Grid = {}
  for (const row of Array.from(doc.getElementsByTagName("row"))) {
    const rNum = Number(row.getAttribute("r") || 0)
    if (!rNum) continue
    const cells: Record<string, string> = {}
    for (const c of Array.from(row.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r")
      if (!ref) continue
      const t = c.getAttribute("t") || "n"
      let text = ""
      if (t === "inlineStr") {
        text = Array.from(c.getElementsByTagName("t")).map((n) => n.textContent ?? "").join("")
      } else {
        const v = c.getElementsByTagName("v")[0]
        text = v?.textContent ?? ""
        if (t === "s") text = shared[Number(text)] ?? ""
      }
      text = text.trim()
      if (text) cells[colOf(ref)] = text
    }
    if (Object.keys(cells).length) grid[rNum] = cells
  }
  return grid
}

// ── Column mapping ───────────────────────────────────────────────────────────

export const REGISTER_FIELDS = [
  "srNo", "date", "name", "age", "gender", "contact", "department",
  "investigation", "referredBy", "paymentType", "charges", "discount",
  "paid", "balance", "entryBy",
] as const

export type RegisterField = (typeof REGISTER_FIELDS)[number]

// Header spellings seen across the monthly sheets. Longer/more specific
// spellings are matched first so "DISCOUNT CHARGES" never lands on `charges`.
const SYNONYMS: [RegisterField, string[]][] = [
  ["srNo",          ["SR NO", "SRNO", "SR", "S NO", "SERIAL NO", "SERIAL"]],
  ["date",          ["DATE"]],
  ["name",          ["NAME OF PATIENT", "PATIENT NAME", "PATIENTS NAME", "NAME"]],
  ["age",           ["AGE"]],
  ["gender",        ["SEX", "GENDER"]],
  ["contact",       ["CONTACT NO", "CONTACT NUMBER", "CONTACT", "MOBILE NO", "MOBILE", "PHONE NO", "PHONE"]],
  ["department",    ["DEPARTMENT", "DEPT", "MODALITY"]],
  ["investigation", ["INVESTIGATION", "INVESTIGATIONS", "TEST NAME", "TEST", "STUDY", "EXAMINATION"]],
  ["referredBy",    ["NAME OF REFFERD DOCTOR", "NAME OF REFERRED DOCTOR", "REFFERD DOCTOR", "REFERRED DOCTOR", "REFERRING DOCTOR", "REF BY", "REFERRED BY", "REFFERED BY", "DOCTOR NAME", "DOCTOR"]],
  ["paymentType",   ["PAYMENT TYPES", "PAYMENT TYPE", "PAYMENT MODE", "MODE OF PAYMENT", "PAYMENT"]],
  ["discount",      ["DISCOUNT CHARGES", "DISCOUNT AMOUNT", "DISCOUNT", "CONCESSION"]],
  ["paid",          ["PAID AMOUNT", "AMOUNT PAID", "PAID"]],
  ["balance",       ["BALANCE AMOUNT", "BALANCE", "DUE", "OUTSTANDING"]],
  ["charges",       ["TOTAL CHARGES", "CHARGES", "AMOUNT", "TOTAL", "RATE"]],
  ["entryBy",       ["ENTRY DONE BY", "ENTRY BY", "DONE BY", "ENTERED BY", "OPERATOR", "STAFF"]],
]

function norm(s: string) {
  return s.toUpperCase().replace(/[._:]/g, " ").replace(/\s+/g, " ").trim()
}

// Two passes — exact header match first, then "header contains synonym" — so a
// sheet that spells a column out in full doesn't lose it to a looser match.
function mapColumns(header: Record<string, string>): Partial<Record<RegisterField, string>> {
  const map: Partial<Record<RegisterField, string>> = {}
  const taken = new Set<string>()

  for (const pass of [0, 1]) {
    for (const [field, spellings] of SYNONYMS) {
      if (map[field]) continue
      for (const [col, raw] of Object.entries(header)) {
        if (taken.has(col)) continue
        const h = norm(raw)
        const hit = pass === 0 ? spellings.some((s) => h === s) : spellings.some((s) => h.includes(s))
        if (hit) { map[field] = col; taken.add(col); break }
      }
    }
  }
  return map
}

// ── Values ───────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function monthLabel(d: Date) {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

// Excel keeps dates as a day count from 1899-12-30 (its 1900 leap-year quirk
// already baked in). Anything in the plausible serial window is treated as a
// date; text dates fall through to Date parsing.
function toDate(text: string): Date | null {
  if (!text) return null
  const n = Number(text)
  if (Number.isFinite(n) && n > 20_000 && n < 80_000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000)
  }
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text.trim())
  if (dmy) {
    const [, d, m, y] = dmy
    const year = Number(y) < 100 ? 2000 + Number(y) : Number(y)
    const dt = new Date(Date.UTC(year, Number(m) - 1, Number(d)))
    return isNaN(dt.getTime()) ? null : dt
  }
  const dt = new Date(text)
  return isNaN(dt.getTime()) ? null : dt
}

function toNum(text: string): number {
  const n = Number(String(text).replace(/[^\d.-]/g, ""))
  return Number.isFinite(n) ? n : 0
}

// ── Public shape ─────────────────────────────────────────────────────────────

export interface RegisterRow {
  rowNo: number
  srNo: number | null
  date: string | null          // ISO yyyy-mm-dd
  name: string
  age: number | null
  gender: string
  contact: string
  department: string
  investigation: string
  referredBy: string
  paymentType: string
  charges: number
  discount: number
  paid: number
  balance: number
  entryBy: string
}

export interface SheetRead {
  name: string                 // sheet tab name
  headerRow: number
  headers: Record<string, string>
  mapped: Partial<Record<RegisterField, string>>
  missing: RegisterField[]
  rows: RegisterRow[]
  skipped: number
  month: string                // detected "Jun 2026" ("" when undetectable)
}

const REQUIRED: RegisterField[] = ["name", "investigation", "referredBy"]

// The header is rarely on row 1 (these sheets keep a month title above it), so
// the first row that matches at least four known column names wins.
function findHeader(grid: Grid): { row: number; header: Record<string, string> } | null {
  const rowNums = Object.keys(grid).map(Number).sort((a, b) => a - b).slice(0, 15)
  for (const r of rowNums) {
    const header = grid[r]
    const hits = Object.keys(mapColumns(header)).length
    if (hits >= 4) return { row: r, header }
  }
  return null
}

function monthOf(rows: RegisterRow[], sheetName: string): string {
  const tally: Record<string, number> = {}
  for (const r of rows) {
    if (!r.date) continue
    const key = monthLabel(new Date(r.date))
    tally[key] = (tally[key] ?? 0) + 1
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
  if (top) return top[0]

  // No usable dates — fall back to the tab name, e.g. "JUN - 2026", "JULY"
  const n = norm(sheetName)
  const mi = MONTHS.findIndex((m) => n.startsWith(m.toUpperCase()))
  const yr = /(20\d{2})/.exec(n)
  if (mi >= 0 && yr) return `${MONTHS[mi]} ${yr[1]}`
  return ""
}

export async function readRegisterWorkbook(file: File): Promise<SheetRead[]> {
  const parts = await unzip(await file.arrayBuffer())
  if (!parts["xl/workbook.xml"]) throw new Error("That file doesn't look like an Excel workbook")

  const shared: string[] = []
  if (parts["xl/sharedStrings.xml"]) {
    for (const si of Array.from(parseXml(parts["xl/sharedStrings.xml"]).getElementsByTagName("si"))) {
      shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""))
    }
  }

  const rels: Record<string, string> = {}
  if (parts["xl/_rels/workbook.xml.rels"]) {
    for (const rel of Array.from(parseXml(parts["xl/_rels/workbook.xml.rels"]).getElementsByTagName("Relationship"))) {
      rels[rel.getAttribute("Id") ?? ""] = rel.getAttribute("Target") ?? ""
    }
  }

  const wb  = parseXml(parts["xl/workbook.xml"])
  const out: SheetRead[] = []

  for (const sheet of Array.from(wb.getElementsByTagName("sheet"))) {
    const name   = sheet.getAttribute("name") ?? ""
    const rId    = sheet.getAttribute("r:id") ?? sheet.getAttribute("id") ?? ""
    const target = (rels[rId] ?? "").replace(/^\/?xl\//, "").replace(/^\.\//, "")
    const bytes  = parts[`xl/${target}`]
    if (!bytes) continue

    const grid = sheetGrid(parseXml(bytes), shared)
    const head = findHeader(grid)
    if (!head) continue

    const mapped = mapColumns(head.header)
    const get = (cells: Record<string, string>, f: RegisterField) => {
      const col = mapped[f]
      return col ? cells[col] ?? "" : ""
    }

    const rows: RegisterRow[] = []
    let skipped = 0
    for (const rNum of Object.keys(grid).map(Number).sort((a, b) => a - b)) {
      if (rNum <= head.row) continue
      const cells = grid[rNum]
      const name_ = get(cells, "name")
      const srRaw = get(cells, "srNo")
      // These sheets carry a serial number down past the last real entry, so a
      // row only counts when it names a patient or an investigation.
      if (!name_ && !get(cells, "investigation")) { skipped++; continue }
      // A repeated header (sheets often re-print it mid-month) is not data
      if (norm(name_) === norm(head.header[mapped.name ?? ""] ?? "")) { skipped++; continue }

      const date = toDate(get(cells, "date"))
      const charges  = toNum(get(cells, "charges"))
      const discount = toNum(get(cells, "discount"))
      const paid     = toNum(get(cells, "paid"))
      const balRaw   = get(cells, "balance")

      rows.push({
        rowNo: rNum,
        srNo: srRaw ? toNum(srRaw) : null,
        date: date ? date.toISOString().slice(0, 10) : null,
        name: name_,
        age: get(cells, "age") ? toNum(get(cells, "age")) : null,
        gender: get(cells, "gender"),
        contact: get(cells, "contact"),
        department: get(cells, "department"),
        investigation: get(cells, "investigation"),
        referredBy: get(cells, "referredBy"),
        paymentType: get(cells, "paymentType"),
        charges, discount, paid,
        balance: balRaw ? toNum(balRaw) : Math.max(0, charges - discount - paid),
        entryBy: get(cells, "entryBy"),
      })
    }

    if (rows.length === 0) continue

    out.push({
      name, headerRow: head.row, headers: head.header, mapped,
      missing: REQUIRED.filter((f) => !mapped[f]),
      rows, skipped, month: monthOf(rows, name),
    })
  }

  if (out.length === 0) throw new Error("No sheet in this workbook has a recognisable register header row")
  return out
}
