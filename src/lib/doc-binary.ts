// Word 97-2003 (.doc) -> HTML, reading the binary format directly.
//
// 156 of the clinic's ~170 template files are binary .doc. The only reader this
// project had for them, `word-extractor`, returns a PLAIN STRING: no bold, no
// underline, no sizes, no spacing, no tables. Every one of those templates was
// therefore rebuilt from bare text by regexes that guessed which lines were
// headings — which is why an imported .doc never looked like the Word file it
// came from, no matter how the guesses were tuned.
//
// LibreOffice (doc-convert.ts) fixes that properly by converting to .docx, but
// it is a 400MB install that isn't on every host. This reader is the fallback
// that needs no install: it walks the FIB, the piece table and the CHPX/PAPX
// bin tables the same way Word does, so the formatting comes from the FILE
// rather than from a heuristic about what clinic reports usually look like.
//
// Nothing here knows anything about ultrasounds, headings or signatures — it
// reads whatever the document says and hands the result to the same importer
// every other format goes through.

import { readCfb } from "@/lib/cfb"
import { pxCss } from "@/lib/css-length"
import { rewriteWordLineHeight } from "@/lib/docx-render"

// ── FIB offsets ──────────────────────────────────────────────────────────────
// The File Information Block is a fixed layout: FibBase (32) + csw (2) +
// fibRgW97 (28) + cslw (2) + fibRgLw97 (88) + cbRgFcLcb (2), so the FcLcb pairs
// that point at every table start at 154 and are 8 bytes each.
const FIB_MAGIC = 0xA5EC
const FCLCB_BASE = 154
const fclcb = (index: number) => FCLCB_BASE + index * 8
const FC_STSHF = fclcb(1)
const FC_PLCFBTECHPX = fclcb(12)
const FC_PLCFBTEPAPX = fclcb(13)
const FC_STTBFFFN = fclcb(15)
const FC_CLX = fclcb(33)
const CCP_TEXT = 76
const FKP_SIZE = 512

// ── sprms (the property opcodes inside CHPX/PAPX grpprls) ────────────────────
const sprmCFBold = 0x0835
const sprmCFItalic = 0x0836
const sprmCFStrike = 0x0837
const sprmCKul = 0x2A3E
const sprmCHps = 0x4A43
const sprmCRgFtc0 = 0x4A4F
const sprmCIco = 0x2A42
const sprmCCv = 0x6870
const sprmCHighlight = 0x2A0C
const sprmCIss = 0x2A48
const sprmPIstd = 0x4600
const sprmPJc80 = 0x2403
const sprmPJc = 0x2461
const sprmPDxaRight = 0x840E
const sprmPDxaLeft = 0x840F
const sprmPDxaLeft1 = 0x8411
const sprmPDyaBefore = 0xA413
const sprmPDyaAfter = 0xA414
const sprmPDyaLine = 0x6412
const sprmPFInTable = 0x2416
const sprmPFTtp = 0x2417
const sprmTDefTable = 0xD608
const sprmTTableBorders80 = 0xD605
const sprmTTableBorders = 0xD613

/** Word's fixed 17-entry colour palette, indexed by the `ico` sprms. */
const ICO_COLORS = [
  "", "#000000", "#0000ff", "#00ffff", "#00ff00", "#ff00ff", "#ff0000", "#ffff00",
  "#ffffff", "#000080", "#008080", "#008000", "#800080", "#800000", "#808000",
  "#808080", "#c0c0c0",
]

interface Chp {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  halfPoints?: number
  ftc?: number
  color?: string
  highlight?: string
  vert?: "sup" | "sub"
}

interface TableCell { widthTwips: number; borders: boolean[] }   // [top, left, bottom, right]
interface TableDef {
  cells: TableCell[]
  /** Table-level [top, left, bottom, right] rules, when the row defines them. */
  outer?: boolean[]
  /** Table-level [horizontal, vertical] rules between cells. */
  inner?: boolean[]
}

interface Pap {
  istd: number
  jc?: number
  dxaLeft?: number
  dxaRight?: number
  dxaLeft1?: number
  dyaBefore?: number
  dyaAfter?: number
  lineTwips?: number
  lineMultiple?: boolean
  inTable?: boolean
  ttp?: boolean
  tableDef?: TableDef
}

export interface LegacyDocResult {
  /** Body HTML with the document's own fonts, weights, spacing and tables. */
  html: string
  /** The same content as plain text, for the importer's heading/signature detection. */
  text: string
}

// ── low-level helpers ────────────────────────────────────────────────────────

/** Operand length of a sprm, from the `spra` bits of its opcode. */
function sprmOperandSize(sprm: number, buf: Buffer, at: number): number {
  switch ((sprm >> 13) & 7) {
    case 0: case 1: return 1
    case 2: case 4: case 5: return 2
    case 3: return 4
    case 7: return 3
    default: {
      // Variable length: a leading size byte. sprmTDefTable is the exception —
      // its length is a 2-byte count that runs one short of the bytes that
      // follow it. Getting this wrong doesn't just lose the table: the walk
      // would resume mid-operand and read the rest of the paragraph's
      // properties as garbage, which is why it is measured rather than skipped.
      if (sprm === sprmTDefTable) return at + 2 <= buf.length ? buf.readUInt16LE(at) + 1 : 0
      return 1 + (buf[at] ?? 0)
    }
  }
}

function eachSprm(grpprl: Buffer, visit: (sprm: number, operandAt: number, size: number) => void): void {
  let at = 0
  while (at + 2 <= grpprl.length) {
    const sprm = grpprl.readUInt16LE(at)
    if (!sprm) break
    const operandAt = at + 2
    const size = sprmOperandSize(sprm, grpprl, operandAt)
    if (size < 0) { visit(sprm, operandAt, grpprl.length - operandAt); break }
    if (operandAt + size > grpprl.length) break
    visit(sprm, operandAt, size)
    at = operandAt + size
  }
}

/** Word's on/off operands: 0 off, 1 on, 128 inherit, 129 toggle. */
function toggle(current: boolean | undefined, value: number): boolean {
  if (value === 0) return false
  if (value === 1) return true
  if (value === 129) return !current
  return !!current
}

function applyChpSprms(chp: Chp, grpprl: Buffer): void {
  eachSprm(grpprl, (sprm, at) => {
    switch (sprm) {
      case sprmCFBold: chp.bold = toggle(chp.bold, grpprl[at]); break
      case sprmCFItalic: chp.italic = toggle(chp.italic, grpprl[at]); break
      case sprmCFStrike: chp.strike = toggle(chp.strike, grpprl[at]); break
      case sprmCKul: chp.underline = grpprl[at] !== 0; break
      case sprmCHps: chp.halfPoints = grpprl.readUInt16LE(at); break
      case sprmCRgFtc0: chp.ftc = grpprl.readUInt16LE(at); break
      case sprmCIco: chp.color = ICO_COLORS[grpprl[at]] || undefined; break
      case sprmCHighlight: chp.highlight = ICO_COLORS[grpprl[at]] || undefined; break
      case sprmCIss: chp.vert = grpprl[at] === 1 ? "sup" : grpprl[at] === 2 ? "sub" : undefined; break
      case sprmCCv: {
        // COLORREF: red, green, blue, then a flag byte.
        const r = grpprl[at], g = grpprl[at + 1], b = grpprl[at + 2]
        chp.color = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`
        break
      }
    }
  })
}

function parseTableDef(grpprl: Buffer, at: number, size: number): TableDef | undefined {
  try {
    // cb (2) + itcMac (1) + (itcMac+1) column edges + itcMac × TC80 (20 bytes)
    const itcMac = grpprl[at + 2]
    if (!itcMac || itcMac > 64) return undefined
    const edgesAt = at + 3
    const edges: number[] = []
    for (let i = 0; i <= itcMac; i++) edges.push(grpprl.readInt16LE(edgesAt + i * 2))
    const tcAt = edgesAt + (itcMac + 1) * 2
    const cells: TableCell[] = []
    for (let i = 0; i < itcMac; i++) {
      const base = tcAt + i * 20
      if (base + 20 > at + size || base + 20 > grpprl.length) {
        cells.push({ widthTwips: edges[i + 1] - edges[i], borders: [true, true, true, true] })
        continue
      }
      // A BRC80 is width, line type, colour, spacing — type 0 means no line,
      // which is how Word marks the invisible tables used purely for layout.
      const borders = [0, 1, 2, 3].map((b) => grpprl[base + 4 + b * 4 + 1] !== 0 && grpprl[base + 4 + b * 4] !== 0)
      cells.push({ widthTwips: edges[i + 1] - edges[i], borders })
    }
    return { cells }
  } catch {
    return undefined
  }
}

function applyPapSprms(pap: Pap, grpprl: Buffer): void {
  eachSprm(grpprl, (sprm, at, size) => {
    switch (sprm) {
      case sprmPIstd: pap.istd = grpprl.readUInt16LE(at); break
      case sprmPJc80: case sprmPJc: pap.jc = grpprl[at]; break
      case sprmPDxaLeft: pap.dxaLeft = grpprl.readInt16LE(at); break
      case sprmPDxaRight: pap.dxaRight = grpprl.readInt16LE(at); break
      case sprmPDxaLeft1: pap.dxaLeft1 = grpprl.readInt16LE(at); break
      case sprmPDyaBefore: pap.dyaBefore = grpprl.readUInt16LE(at); break
      case sprmPDyaAfter: pap.dyaAfter = grpprl.readUInt16LE(at); break
      case sprmPDyaLine:
        pap.lineTwips = grpprl.readInt16LE(at)
        pap.lineMultiple = grpprl.readUInt16LE(at + 2) === 1
        break
      case sprmPFInTable: pap.inTable = grpprl[at] !== 0; break
      case sprmPFTtp: pap.ttp = grpprl[at] !== 0; break
      case sprmTDefTable: {
        const def = parseTableDef(grpprl, at, size)
        if (def) pap.tableDef = { ...(pap.tableDef ?? {}), ...def }
        break
      }
      case sprmTTableBorders80:
      case sprmTTableBorders: {
        // Six borders after a length byte: outer top/left/bottom/right, then
        // the horizontal and vertical lines between cells. Word puts a table's
        // grid here rather than on every cell, so a table read without it comes
        // out borderless even though it is ruled on screen. Word 97 writes them
        // as 4-byte BRC80s; later versions write the same six as 8-byte BRCs
        // with the colour first — both forms turn up in the clinic's files.
        const wide = sprm === sprmTTableBorders
        const stride = wide ? 8 : 4
        const brcAt = at + 1
        if (brcAt + stride * 6 > grpprl.length) break
        const on = (index: number) => {
          const base = brcAt + index * stride + (wide ? 4 : 0)
          return grpprl[base] !== 0 && grpprl[base + 1] !== 0    // line width, line type
        }
        pap.tableDef = {
          cells: pap.tableDef?.cells ?? [],
          outer: [on(0), on(1), on(2), on(3)],
          inner: [on(4), on(5)],
        }
        break
      }
    }
  })
}

// ── the property tables ──────────────────────────────────────────────────────

interface PropRange { start: number; end: number; grpprl: Bytes }

/** Buffer slices keep the parent's buffer type; this is only a widening alias. */
type Bytes = Buffer<ArrayBufferLike>

/**
 * Character or paragraph properties keyed by position in the WordDocument
 * stream. Both are stored the same way: a "bin table" of 512-byte pages, each
 * holding the runs that start within one chunk of the file.
 */
function readBinTable(word: Bytes, table: Bytes, fc: number, lcb: number, kind: "chpx" | "papx"): PropRange[] {
  const out: PropRange[] = []
  if (!lcb || fc + lcb > table.length) return out
  const plc = table.subarray(fc, fc + lcb)
  const n = Math.floor((plc.length - 4) / 8)
  for (let i = 0; i < n; i++) {
    const page = plc.readUInt32LE(4 * (n + 1) + i * 4)
    const at = page * FKP_SIZE
    if (at + FKP_SIZE > word.length) continue
    const fkp = word.subarray(at, at + FKP_SIZE)
    const crun = fkp[FKP_SIZE - 1]
    if (!crun) continue

    const fcs: number[] = []
    for (let r = 0; r <= crun; r++) fcs.push(fkp.readUInt32LE(r * 4))
    const entriesAt = 4 * (crun + 1)

    for (let r = 0; r < crun; r++) {
      let grpprl: Bytes = Buffer.alloc(0)
      if (kind === "chpx") {
        const offset = fkp[entriesAt + r]
        if (offset) {
          const chpxAt = offset * 2
          const cb = fkp[chpxAt]
          grpprl = fkp.subarray(chpxAt + 1, chpxAt + 1 + cb)
        }
      } else {
        // PAPX entries are 13-byte BX structures; only the first byte, the
        // word offset of the PAPX itself, matters here.
        const offset = fkp[entriesAt + r * 13]
        if (offset) {
          const papxAt = offset * 2
          const cb = fkp[papxAt]
          grpprl = cb !== 0
            ? fkp.subarray(papxAt + 1, papxAt + 1 + (2 * cb - 1))
            : fkp.subarray(papxAt + 2, papxAt + 2 + 2 * fkp[papxAt + 1])
        }
      }
      out.push({ start: fcs[r], end: fcs[r + 1], grpprl })
    }
  }
  out.sort((a, b) => a.start - b.start)
  return out
}

function findRange(ranges: PropRange[], fc: number): PropRange | undefined {
  let lo = 0, hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = ranges[mid]
    if (fc < r.start) hi = mid - 1
    else if (fc >= r.end) lo = mid + 1
    else return r
  }
  return undefined
}

// ── the stylesheet ───────────────────────────────────────────────────────────

interface Style { papx: Buffer; chpx: Buffer; base: number }

/**
 * Per-style property defaults. Without these, a document whose body font and
 * size live in its "Normal" style (which is most of them) imports at whatever
 * the app's default happens to be instead of what Word shows.
 */
function readStylesheet(table: Buffer, fc: number, lcb: number): Style[] {
  const styles: Style[] = []
  try {
    if (!lcb || fc + lcb > table.length) return styles
    const stsh = table.subarray(fc, fc + lcb)
    const cbStshi = stsh.readUInt16LE(0)
    const cstd = stsh.readUInt16LE(2)
    const cbStdBase = stsh.readUInt16LE(4)
    let at = 2 + cbStshi
    for (let i = 0; i < cstd; i++) {
      if (at + 2 > stsh.length) break
      const cbStd = stsh.readUInt16LE(at)
      at += 2
      if (!cbStd) { styles.push({ papx: Buffer.alloc(0), chpx: Buffer.alloc(0), base: 0x0FFF }); continue }
      const std = stsh.subarray(at, at + cbStd)
      at += cbStd + (cbStd % 2)   // entries are word-aligned
      try {
        const base = std.readUInt16LE(2) >> 4          // istdBase
        const stk = std.readUInt16LE(2) & 0x000F
        let p = cbStdBase
        const cch = std.readUInt16LE(p)                 // style name, as an Xstz
        p += 2 + cch * 2 + 2
        const upxs: Buffer[] = []
        while (p + 2 <= std.length) {
          const cbUpx = std.readUInt16LE(p)
          p += 2
          if (cbUpx === 0 || p + cbUpx > std.length) break
          upxs.push(std.subarray(p, p + cbUpx))
          p += cbUpx + (cbUpx % 2)
        }
        // Paragraph styles carry PAPX then CHPX; character styles only CHPX.
        // The PAPX's first 2 bytes are its istd, not a sprm.
        const papx = stk === 1 && upxs[0] ? upxs[0].subarray(2) : Buffer.alloc(0)
        const chpx = stk === 1 ? (upxs[1] ?? Buffer.alloc(0)) : (upxs[0] ?? Buffer.alloc(0))
        styles.push({ papx, chpx, base })
      } catch {
        styles.push({ papx: Buffer.alloc(0), chpx: Buffer.alloc(0), base: 0x0FFF })
      }
    }
  } catch {
    return styles
  }
  return styles
}

/** Walks a style's inheritance chain so a heading built on Normal keeps Normal's font. */
function stylePropsFor(styles: Style[], istd: number, pick: (s: Style) => Buffer): Buffer[] {
  const chain: Buffer[] = []
  let current = istd
  const seen = new Set<number>()
  while (current < styles.length && current !== 0x0FFF && !seen.has(current)) {
    seen.add(current)
    const style = styles[current]
    if (!style) break
    if (style.papx.length || style.chpx.length) chain.unshift(pick(style))
    current = style.base
  }
  return chain.filter((b) => b.length > 0)
}

// ── the font table ───────────────────────────────────────────────────────────

function readFontNames(table: Buffer, fc: number, lcb: number): string[] {
  const names: string[] = []
  try {
    if (!lcb || fc + lcb > table.length) return names
    const sttb = table.subarray(fc, fc + lcb)
    let at = sttb.readUInt16LE(0) === 0xFFFF ? 6 : 4
    // Every entry is an FFN: 39 bytes of metrics (flags, weight, charset,
    // PANOSE, font signature) and then the name as UTF-16.
    while (at < sttb.length) {
      const cch = sttb[at]
      if (!cch) break
      const entry = sttb.subarray(at + 1, at + 1 + cch)
      at += 1 + cch
      const nameAt = 39
      if (entry.length <= nameAt) { names.push(""); continue }
      let end = nameAt
      while (end + 1 < entry.length && entry.readUInt16LE(end) !== 0) end += 2
      names.push(entry.subarray(nameAt, end).toString("utf16le").trim())
    }
  } catch {
    return names
  }
  return names
}

// ── text ─────────────────────────────────────────────────────────────────────

/**
 * cp1252's 0x80-0x9F range — the only place it differs from Latin-1, and where
 * Word puts the curly quotes and dashes its autocorrect produces. Written as
 * code points so the table itself can't be mangled by an editor or a paste.
 */
const CP1252_HIGH = [
  0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
  0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
  0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
  0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
]

function decodeCompressed(bytes: Buffer): string {
  let out = ""
  for (const b of bytes) out += String.fromCharCode(b >= 0x80 && b <= 0x9F ? CP1252_HIGH[b - 0x80] : b)
  return out
}

/** Word's own in-text markers, which are structure rather than text. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

interface Piece { cpStart: number; cpEnd: number; fc: number; compressed: boolean }

function readPieceTable(table: Buffer, fcClx: number, lcbClx: number): Piece[] {
  const pieces: Piece[] = []
  if (!lcbClx || fcClx + lcbClx > table.length) return pieces
  const clx = table.subarray(fcClx, fcClx + lcbClx)
  let at = 0
  let plc: Buffer | null = null
  while (at < clx.length) {
    const kind = clx[at]
    if (kind === 1) { at += 3 + clx.readUInt16LE(at + 1); continue }   // Prc, skipped
    if (kind === 2) {
      const size = clx.readUInt32LE(at + 1)
      plc = clx.subarray(at + 5, at + 5 + size)
      break
    }
    break
  }
  if (!plc) return pieces
  const n = Math.floor((plc.length - 4) / 12)
  for (let i = 0; i < n; i++) {
    const cpStart = plc.readUInt32LE(i * 4)
    const cpEnd = plc.readUInt32LE((i + 1) * 4)
    const pcd = 4 * (n + 1) + i * 8
    const raw = plc.readUInt32LE(pcd + 2)
    const compressed = (raw & 0x40000000) !== 0
    pieces.push({ cpStart, cpEnd, fc: compressed ? (raw & 0x3FFFFFFF) / 2 : raw, compressed })
  }
  return pieces
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const escapeHtml = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const twipsToPx = (twips: number) => pxCss(`${twips / 20}pt`)

function chpKey(chp: Chp): string {
  return JSON.stringify([chp.bold, chp.italic, chp.underline, chp.strike, chp.halfPoints, chp.ftc, chp.color, chp.highlight, chp.vert])
}

function runHtml(text: string, chp: Chp, fonts: string[]): string {
  if (!text) return ""
  let html = escapeHtml(text).replace(/ {2,}/g, (run) => "&nbsp;".repeat(run.length - 1) + " ")
  if (chp.vert === "sup") html = `<sup>${html}</sup>`
  if (chp.vert === "sub") html = `<sub>${html}</sub>`
  if (chp.strike) html = `<s>${html}</s>`
  if (chp.underline) html = `<u>${html}</u>`
  if (chp.italic) html = `<em>${html}</em>`
  if (chp.bold) html = `<strong>${html}</strong>`

  const styles: string[] = []
  const font = chp.ftc !== undefined ? fonts[chp.ftc] : ""
  if (font) styles.push(`font-family: '${font.replace(/'/g, "")}'`)
  if (chp.halfPoints) {
    const px = pxCss(`${chp.halfPoints / 2}pt`)
    if (px) styles.push(`font-size: ${px}`)
  }
  if (chp.color && chp.color !== "#000000") styles.push(`color: ${chp.color}`)
  if (chp.highlight) styles.push(`background-color: ${chp.highlight}`)
  return styles.length ? `<span style="${styles.join("; ")}">${html}</span>` : html
}

function paragraphStyle(pap: Pap): string {
  const styles: string[] = []
  const align = ["left", "center", "right", "justify"][pap.jc ?? 0]
  if (align && align !== "left") styles.push(`text-align: ${align}`)
  // Word's paragraph spacing is explicit, so it is carried over explicitly —
  // including a 0, which is what stops the app's own default margin from
  // inventing a blank line the document never had.
  if (pap.dyaBefore !== undefined) styles.push(`margin-top: ${twipsToPx(pap.dyaBefore) ?? "0px"}`)
  if (pap.dyaAfter !== undefined) styles.push(`margin-bottom: ${twipsToPx(pap.dyaAfter) ?? "0px"}`)
  if (pap.dxaLeft) styles.push(`margin-left: ${twipsToPx(pap.dxaLeft)}`)
  if (pap.dxaRight) styles.push(`margin-right: ${twipsToPx(pap.dxaRight)}`)
  if (pap.dxaLeft1) styles.push(`text-indent: ${twipsToPx(pap.dxaLeft1)}`)
  if (pap.lineTwips) {
    // Word stores "multiple" line spacing in 240ths of a line and exact/at-least
    // spacing in twips. rewriteWordLineHeight owns the multiple → CSS rule, the
    // same one the .docx path uses, so both importers space text identically.
    if (pap.lineMultiple) styles.push(rewriteWordLineHeight(`line-height: ${(pap.lineTwips / 240).toFixed(3)}`))
    else styles.push(`line-height: ${twipsToPx(Math.abs(pap.lineTwips))}`)
  }
  return styles.join("; ")
}

interface Paragraph { html: string; pap: Pap; endedCell: boolean }

function paragraphHtml(p: Paragraph): string {
  const style = paragraphStyle(p.pap)
  return `<p${style ? ` style="${style}"` : ""}>${p.html}</p>`
}

/**
 * Rebuilds tables from the cell and row marks in the text.
 *
 * In a .doc there is no table element: paragraphs simply carry an "in table"
 * flag, end with a cell mark instead of a paragraph mark, and the row's own
 * layout (column widths and which edges have a visible border) lives on the
 * row-end paragraph. Borders are read from the file, so Word's invisible
 * layout tables stay invisible here too.
 */
function tableHtml(rows: { cells: Paragraph[][]; def?: TableDef }[]): string {
  const rowsHtml = rows.map((row, rowIndex) => {
    const grid = row.def?.outer
    const inner = row.def?.inner
    const cells = row.cells.map((cell, i) => {
      const def = row.def?.cells[i]
      const styles = ["padding: 1px 4px", "vertical-align: top"]
      if (def || grid) {
        // A cell's own border wins where it sets one; otherwise the edge falls
        // back to the table's grid — outer rules on the outside, the horizontal
        // and vertical rules in between.
        const own = def?.borders ?? [false, false, false, false]
        const lastRow = rowIndex === rows.length - 1
        const lastCell = i === row.cells.length - 1
        const on = [
          own[0] || (grid ? (rowIndex === 0 ? grid[0] : !!inner?.[0]) : false),
          own[1] || (grid ? (i === 0 ? grid[1] : !!inner?.[1]) : false),
          own[2] || (grid ? (lastRow ? grid[2] : !!inner?.[0]) : false),
          own[3] || (grid ? (lastCell ? grid[3] : !!inner?.[1]) : false),
        ]
        const edge = (visible: boolean) => (visible ? "1px solid #000" : "none")
        styles.push(`border-top: ${edge(on[0])}`, `border-left: ${edge(on[1])}`, `border-bottom: ${edge(on[2])}`, `border-right: ${edge(on[3])}`)
        const width = def ? twipsToPx(def.widthTwips) : null
        if (width) styles.push(`width: ${width}`)
      }
      return `<td style="${styles.join("; ")}">${cell.map(paragraphHtml).join("")}</td>`
    })
    return `<tr>${cells.join("")}</tr>`
  })
  return `<table style="border-collapse: collapse"><tbody>${rowsHtml.join("")}</tbody></table>`
}

// ── the reader ───────────────────────────────────────────────────────────────

/**
 * Reads a binary Word 97-2003 document. Returns null for anything it cannot
 * make sense of — a .docx, a corrupt file, an encrypted one — so callers can
 * fall back to their existing path instead of importing garbage.
 */
export function parseLegacyDoc(buffer: Buffer): LegacyDocResult | null {
  try {
    const cfb = readCfb(buffer)
    const word = cfb?.streams.get("WordDocument")
    if (!word || word.length < 512) return null
    if (word.readUInt16LE(0) !== FIB_MAGIC) return null

    // Word 6/95 wrote a different FIB layout at the same magic number. Reading
    // one with Word 97 offsets would not fail — it would produce confident
    // nonsense — so anything older is handed back to the text fallback.
    const nFib = word.readUInt16LE(2)
    if (nFib < 193) return null

    const flags = word.readUInt16LE(10)
    if (flags & 0x0100) return null      // fEncrypted — nothing to read without the key
    const table = cfb!.streams.get((flags & 0x0200) ? "1Table" : "0Table")
    if (!table) return null

    const ccpText = word.readUInt32LE(CCP_TEXT)
    if (!ccpText) return null

    const pieces = readPieceTable(table, word.readUInt32LE(FC_CLX), word.readUInt32LE(FC_CLX + 4))
    if (!pieces.length) return null

    const chpxRanges = readBinTable(word, table, word.readUInt32LE(FC_PLCFBTECHPX), word.readUInt32LE(FC_PLCFBTECHPX + 4), "chpx")
    const papxRanges = readBinTable(word, table, word.readUInt32LE(FC_PLCFBTEPAPX), word.readUInt32LE(FC_PLCFBTEPAPX + 4), "papx")
    const styles = readStylesheet(table, word.readUInt32LE(FC_STSHF), word.readUInt32LE(FC_STSHF + 4))
    const fonts = readFontNames(table, word.readUInt32LE(FC_STTBFFFN), word.readUInt32LE(FC_STTBFFFN + 4))

    // Flatten the document into characters plus the file position each came
    // from — every property lookup below is by position.
    const chars: string[] = []
    const charFcs: number[] = []
    for (const piece of pieces) {
      if (piece.cpStart >= ccpText) break
      const cpEnd = Math.min(piece.cpEnd, ccpText)
      const count = cpEnd - piece.cpStart
      if (count <= 0) continue
      const width = piece.compressed ? 1 : 2
      const bytes = word.subarray(piece.fc, piece.fc + count * width)
      const text = piece.compressed ? decodeCompressed(bytes) : bytes.toString("utf16le")
      for (let i = 0; i < text.length && i < count; i++) {
        chars.push(text[i])
        charFcs.push(piece.fc + i * width)
      }
    }
    if (!chars.length) return null

    const chpAt = (fc: number, istd: number): Chp => {
      const chp: Chp = {}
      for (const grpprl of stylePropsFor(styles, istd, (s) => s.chpx)) applyChpSprms(chp, grpprl)
      const direct = findRange(chpxRanges, fc)
      if (direct?.grpprl.length) applyChpSprms(chp, direct.grpprl)
      return chp
    }

    const papAt = (fc: number): Pap => {
      const range = findRange(papxRanges, fc)
      const pap: Pap = { istd: 0 }
      if (range?.grpprl.length) {
        pap.istd = range.grpprl.readUInt16LE(0)
        for (const grpprl of stylePropsFor(styles, pap.istd, (s) => s.papx)) applyPapSprms(pap, grpprl)
        applyPapSprms(pap, range.grpprl.subarray(2))
      }
      return pap
    }

    // Walk the text, closing a paragraph at every paragraph or cell mark.
    const blocks: (Paragraph | { table: { cells: Paragraph[][]; def?: TableDef }[] })[] = []
    let openRows: { cells: Paragraph[][]; def?: TableDef }[] | null = null
    let openCells: Paragraph[][] = []
    let openCell: Paragraph[] = []

    let runChars: string[] = []
    let runChp: Chp | null = null
    let runKey = ""
    let paraHtml = ""
    let paraText = ""
    let inField = 0          // 0 outside, 1 inside the field code, 2 inside its result
    const plainLines: string[] = []

    const flushRun = () => {
      if (runChp && runChars.length) paraHtml += runHtml(runChars.join(""), runChp, fonts)
      runChars = []
      runChp = null
      runKey = ""
    }

    const endParagraph = (fc: number, endedCell: boolean) => {
      flushRun()
      const pap = papAt(fc)
      const paragraph: Paragraph = { html: paraHtml, pap, endedCell }
      plainLines.push(paraText)
      paraHtml = ""
      paraText = ""

      if (pap.inTable) {
        if (!openRows) { openRows = []; openCells = []; openCell = [] }
        if (pap.ttp) {
          // The row-end mark: this paragraph is the marker itself, not content.
          if (openCell.length) { openCells.push(openCell); openCell = [] }
          openRows.push({ cells: openCells, def: pap.tableDef })
          openCells = []
          return
        }
        openCell.push(paragraph)
        if (endedCell) { openCells.push(openCell); openCell = [] }
        return
      }

      if (openRows) {
        if (openCell.length) openCells.push(openCell)
        if (openCells.length) openRows.push({ cells: openCells })
        if (openRows.length) blocks.push({ table: openRows })
        openRows = null; openCells = []; openCell = []
      }
      blocks.push(paragraph)
    }

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]
      const fc = charFcs[i]
      const code = ch.charCodeAt(0)

      if (code === 0x13) { inField = 1; continue }          // field code begins
      if (code === 0x14) { inField = 2; continue }          // its result follows
      if (code === 0x15) { inField = 0; continue }          // field ends
      if (inField === 1) continue                           // the instruction itself is not text

      if (code === 0x0D) { endParagraph(fc, false); continue }
      if (code === 0x07) { endParagraph(fc, true); continue }
      if (code === 0x0B) { flushRun(); paraHtml += "<br>"; paraText += "\n"; continue }
      if (code === 0x0C) { endParagraph(fc, false); continue }   // page break
      if (code === 0x01 || code === 0x08 || code === 0x02 || code === 0x05 || code === 0x1F) continue
      if (code === 0x1E) { /* non-breaking hyphen */ }

      const text = code === 0x1E ? "‑" : code === 0x09 ? "\t" : ch
      const pap = papAt(fc)
      const chp = chpAt(fc, pap.istd)
      const key = chpKey(chp)
      if (key !== runKey) { flushRun(); runChp = chp; runKey = key }
      runChars.push(text)
      paraText += text
    }
    endParagraph(charFcs[charFcs.length - 1] ?? 0, false)

    const html = blocks
      .map((block) => ("table" in block ? tableHtml(block.table) : paragraphHtml(block)))
      .join("\n")

    const text = plainLines.join("\n").replace(CONTROL_CHARS, "").trimEnd()
    if (!text.trim()) return null
    return { html, text }
  } catch {
    return null
  }
}
