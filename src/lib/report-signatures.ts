// Shared signature-block rendering for reports — used by the on-screen
// editor/preview, print HTML, the downloaded Word file, and the shared PDF.
// A signatory's master image (uploaded once on the Signatures admin page)
// is never stamped onto a report automatically — it's only a source the
// "+ Add Signature" picker can copy from. A report only ever shows a
// signature once that's been explicitly done for THAT report (`overrideImage`
// set in its saved layout); until then every report renders exactly as it
// always has: blank space for a pen signature, name + credentials in text.

import type { jsPDF } from "jspdf"
import { DEFAULT_REPORT_FONT } from "@/lib/report-layout"

export interface Signatory {
  _id: string
  name: string
  credentials: string[]
  signatureImage: string   // base64 data URL, "" if none uploaded
}

// Per-report drag/resize override for a signatory's image (index 0/1 matches
// the two signature-block columns) — set once the user has manually dragged
// or resized it in the report editor; otherwise the default layout applies.
export interface SignatureLayout {
  left?: number
  top?: number
  width?: number
  height?: number
  hidden?: boolean
  hiddenSignatory?: boolean
  overrideImage?: string
  // Per-report rich text for the name / credential lines under the signature.
  // The doctor edits these in place in the report editor and formats them with
  // the normal toolbar (bold, italic, underline, size, colour, font), so a
  // report can style its own sign-off without changing the master Signatory
  // record every other report shares. Unset = render the plain name and
  // credentials exactly as before.
  nameHtml?: string
  credentialsHtml?: string
}

// ── Sign-off HTML sanitiser ──────────────────────────────────────────────────
// nameHtml/credentialsHtml come from a contentEditable, so they can carry
// anything the doctor pasted in — and they are re-rendered on the PUBLIC shared
// report page, which makes an unfiltered paste a stored-XSS route. This runs
// there too, so it is deliberately regex-based rather than DOM-based: the
// shared page renders on the server, where there is no DOMParser.
//
// The allowlist is only what the toolbar can actually produce.
const SIG_ALLOWED_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "strike", "span", "font", "br", "p", "div", "sub", "sup",
])

export function sanitizeSignatureHtml(html: string): string {
  if (!html) return ""
  return html
    // Whole elements whose *content* is dangerous, not just their tag.
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, "")
    .replace(/<\/?([a-zA-Z0-9-]+)((?:"[^"]*"|'[^']*'|[^'">])*)>/g, (tag, rawName: string, rawAttrs: string) => {
      const name = rawName.toLowerCase()
      if (!SIG_ALLOWED_TAGS.has(name)) return ""
      if (tag.startsWith("</")) return `</${name}>`
      // style is the only attribute the toolbar writes (execCommand also emits
      // legacy <font color|face|size>), and even then any url()/expression() in
      // it is dropped — those are the two places a stylesheet can execute.
      const attrs: string[] = []
      const allowed = name === "font" ? /^(style|color|face|size)$/i : /^style$/i
      for (const m of rawAttrs.matchAll(/([a-zA-Z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g)) {
        const key = m[1].toLowerCase()
        if (!allowed.test(key)) continue
        const value = m[2].replace(/^["']|["']$/g, "")
        if (/url\s*\(|expression\s*\(|javascript:/i.test(value)) continue
        attrs.push(`${key}="${value.replace(/"/g, "&quot;")}"`)
      }
      return `<${name}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`
    })
}

/** A plain name/credential going into generated HTML, escaped. */
export function escapeSignatureText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Sanitised sign-off HTML flattened to plain text (jsPDF has no markup). */
export function signatureHtmlToText(html: string): string {
  return sanitizeSignatureHtml(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim()
}

export async function fetchSignatories(): Promise<Signatory[]> {
  try {
    const res = await fetch("/api/signatories")
    const data = await res.json()
    return data.signatories ?? []
  } catch {
    return []
  }
}

// Exported for reuse anywhere else a base64 data URL needs to become docx/
// jsPDF image bytes — imported template figures and inserted signature
// stamps need the exact same base64-decode and format-sniffing logic.
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? dataUrl
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function imageFormat(dataUrl: string): "png" | "jpg" | "gif" | "bmp" {
  if (/^data:image\/png/i.test(dataUrl)) return "png"
  if (/^data:image\/gif/i.test(dataUrl)) return "gif"
  if (/^data:image\/bmp/i.test(dataUrl)) return "bmp"
  return "jpg"
}

// ── HTML (print windows / webviews) ──────────────────────────────────────────
// The print/PDF twin of the <SignatureColumns> React component — and it must
// stay a faithful twin, because the editor and view modal render the component
// while the print window and the shared PDF render this string. Every number
// below (48px image row, 32px column gap, 4px row gap, 13px/10px type) is the
// component's Tailwind class translated to inline CSS; change one side and you
// have to change the other.
//
// It used to always emit the image row, with a `height:38px` spacer in any
// column that had no signature image. The component renders NO image row at all
// unless a signature image actually exists (a stamp is placed freehand in the
// body instead — see insertSignature), so every printed report carried ~42px of
// blank space above the doctors' names that the editor never showed, pushing the
// names down and sometimes onto an extra sheet.
export function signatureColumnsHtml(signatories: Signatory[], layouts?: (SignatureLayout | null | undefined)[]): string {
  const s0 = signatories[0]
  const s1 = signatories[1]
  const l0 = layouts?.[0]
  const l1 = layouts?.[1]

  // Only a per-report overrideImage ever shows here — never the signatory's
  // master image from the Signatures page — matching the component exactly.
  const imageOf = (s?: Signatory, layout?: SignatureLayout | null) =>
    s && !layout?.hidden && !layout?.hiddenSignatory ? layout?.overrideImage || undefined : undefined
  const img0 = imageOf(s0, l0)
  const img1 = imageOf(s1, l1)
  const hasAnyImg = !!(img0 || img1)

  const imgHtml = (src?: string, layout?: SignatureLayout | null) => {
    if (!src) return `<div style="flex:1;"></div>`
    const h = layout?.height ?? 48                                    // component: height 48px default
    const sizeCss = layout?.width ? `width:${layout.width}px;` : `max-width:160px;`  // component: max-w-[160px]
    const topVal = layout?.top ? Math.min(0, layout.top) : 0
    const offsetCss = layout?.left || topVal
      ? `position:relative;left:${layout?.left ?? 0}px;top:${topVal}px;`
      : ""
    return `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-height:48px;"><img src="${src}" alt="" style="height:${h}px;${sizeCss}object-fit:contain;display:block;${offsetCss}" /></div>`
  }

  const textHtml = (s?: Signatory, layout?: SignatureLayout | null) => {
    if (!s) return `<div style="flex:1;"></div>`
    // Sizes in px, not pt: the component uses text-[13px]/text-[10px], and 10pt
    // (13.3px) / 8pt (10.7px) rendered the printed names slightly larger than
    // the screen ones. Line height is left to inherit (1.5) on both sides.
    //
    // A per-report override replaces the text INSIDE the same wrapper, never
    // the wrapper itself: the wrapper carries the block's base size/weight/case,
    // so anything the doctor didn't explicitly restyle still matches every
    // other report, and a bold/coloured span simply overrides it from within.
    const name = layout?.nameHtml
      ? sanitizeSignatureHtml(layout.nameHtml)
      : escapeSignatureText(s.name)
    const credentials = layout?.credentialsHtml !== undefined
      ? sanitizeSignatureHtml(layout.credentialsHtml)
      : s.credentials
          .map((c, i) => `<p style="font-size:10px;text-transform:uppercase;color:#4b5563;${i === 0 ? "margin-top:2px;" : ""}">${escapeSignatureText(c)}</p>`)
          .join("")
    const credentialsBlock = layout?.credentialsHtml !== undefined
      ? `<div style="font-size:10px;text-transform:uppercase;color:#4b5563;margin-top:2px;">${credentials}</div>`
      : credentials
    return `<div style="flex:1;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;">${name}</p>${credentialsBlock}</div>`
  }

  // The 4px gap between the rows lives on the image row (component: `mb-1`), so
  // that with no image row there is no gap left dangling above the names.
  return `
<div style="width:100%;display:flex;flex-direction:column;">
  ${hasAnyImg ? `<div style="display:flex;gap:32px;align-items:flex-end;margin-bottom:4px;">${imgHtml(img0, l0)}${imgHtml(img1, l1)}</div>` : ""}
  <div style="display:flex;gap:32px;">
    ${l0?.hiddenSignatory ? '<div style="flex:1;"></div>' : textHtml(s0, l0)}${l1?.hiddenSignatory ? '<div style="flex:1;"></div>' : textHtml(s1, l1)}
  </div>
</div>`
}

// ── jsPDF (shared / downloaded PDFs) ─────────────────────────────────────────
// Draws the signature images (if any) directly above the existing name/
// credential text block, then the name + every credential line, one row per
// credential so it works whether a signatory has one line or several.
export function drawPdfSignatures(
  doc: jsPDF,
  signatories: Signatory[],
  M: number,
  W: number,
  y: number,
  ln: (pt: number) => number,
  layouts?: (SignatureLayout | null | undefined)[]
): number {
  const rightX = W / 2 + 5
  const imgW = 26, imgH = 11

  for (let i = 0; i < 2; i++) {
    const layout = layouts?.[i]
    if (layout?.hiddenSignatory) continue
    const displayImg = layout?.overrideImage
    if (!displayImg || layout?.hidden) continue
    const x = i === 0 ? M : rightX
    try {
      doc.addImage(displayImg, imageFormat(displayImg).toUpperCase(), x, y - imgH - 2, imgW, imgH)
    } catch { /* ignore an unreadable image rather than failing the whole PDF */ }
  }

  // jsPDF draws strings, not markup, so a per-report edited sign-off comes
  // through as its text — the words are what matter here; the styling is
  // carried by the HTML/DOCX paths that can represent it.
  const nameOf = (i: 0 | 1) => {
    const layout = layouts?.[i]
    if (layout?.hiddenSignatory) return ""
    return layout?.nameHtml ? signatureHtmlToText(layout.nameHtml) : signatories[i]?.name ?? ""
  }
  const credentialsOf = (i: 0 | 1) => {
    const layout = layouts?.[i]
    if (layout?.hiddenSignatory) return []
    if (layout?.credentialsHtml === undefined) return signatories[i]?.credentials ?? []
    return splitSignatureHtmlLines(layout.credentialsHtml).map(signatureHtmlToText).filter(Boolean)
  }

  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0)
  doc.text(nameOf(0), M, y)
  doc.text(nameOf(1), rightX, y)
  y += ln(9)

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(60)
  const creds0 = credentialsOf(0), creds1 = credentialsOf(1)
  const rows = Math.max(creds0.length, creds1.length)
  for (let i = 0; i < rows; i++) {
    doc.text(creds0[i] ?? "", M, y)
    doc.text(creds1[i] ?? "", rightX, y)
    y += ln(7.5)
  }
  return y
}

// ── docx (downloaded Word file) ──────────────────────────────────────────────
// Builds the two TableCells for the signature row, with an ImageRun above the
// name paragraph when a signature image is available.
// Word documents flow images inline (no absolute x/y placement here, same
// limitation the in-body signature stamps already have) — only the per-report
// resize override carries over, not the dragged position.
export async function buildDocxSignatureCells(signatories: Signatory[], layouts?: (SignatureLayout | null | undefined)[]) {
  const { Paragraph, TextRun, ImageRun } = await import("docx")

  const makeImg = (layout?: SignatureLayout | null) => {
    const children = []
    const displayImg = layout?.overrideImage
    if (displayImg && !layout?.hidden && !layout?.hiddenSignatory) {
      children.push(new Paragraph({
        children: [new ImageRun({
          type: imageFormat(displayImg),
          data: dataUrlToBytes(displayImg),
          transformation: { width: layout?.width ?? 110, height: layout?.height ?? 42 },
        })],
        spacing: { after: 40 },
      }))
    } else {
      // A table cell must contain at least one block-level element in OOXML, so
      // the "no signature image" cell can't simply be empty — but it can be a
      // 1pt paragraph instead of a default-size (11pt) one, which is the
      // difference between a hairline and a visible blank line above the
      // doctor's name. On screen and in print that row isn't rendered at all
      // (see signatureColumnsHtml), so this keeps Word close to both.
      children.push(new Paragraph({ children: [new TextRun({ text: "", size: 2 })] }))
    }
    return children
  }

  // A doctor-formatted name/credential block travels into Word as real runs, so
  // a bolded or coloured sign-off opens formatted rather than flattening back to
  // the default. Anything the parser can't represent falls back to plain text at
  // the block's own default size — never to nothing.
  const makeRuns = (html: string, defaultSize: number, defaultBold: boolean) =>
    parseSignatureHtmlRuns(html).map((r) => new TextRun({
      text: r.text,
      bold: r.bold ?? defaultBold,
      italics: r.italic,
      underline: r.underline ? {} : undefined,
      size: r.sizePt ? Math.round(r.sizePt * 2) : defaultSize,
      color: r.color,
      font: r.font || DEFAULT_REPORT_FONT,
    }))

  const makeText = (s?: Signatory, layout?: SignatureLayout | null) => {
    const children = []
    if (!s) {
      children.push(new Paragraph({ children: [new TextRun({ text: "", size: 20, font: DEFAULT_REPORT_FONT })] }))
      return children
    }
    children.push(new Paragraph({
      children: layout?.nameHtml
        ? makeRuns(layout.nameHtml, 20, true)
        : [new TextRun({ text: s.name, bold: true, size: 20, font: DEFAULT_REPORT_FONT })],
      spacing: { after: 40 },
    }))
    if (layout?.credentialsHtml !== undefined) {
      // Each <p>/<div>/<br> in the edited block is its own Word paragraph, the
      // same way each credential string was one before.
      for (const lineHtml of splitSignatureHtmlLines(layout.credentialsHtml)) {
        children.push(new Paragraph({ children: makeRuns(lineHtml, 16, false) }))
      }
    } else {
      for (const c of s.credentials) {
        children.push(new Paragraph({ children: [new TextRun({ text: c, size: 16, font: DEFAULT_REPORT_FONT })] }))
      }
    }
    return children
  }

  return {
    imgLeft: makeImg(layouts?.[0]),
    imgRight: makeImg(layouts?.[1]),
    textLeft: makeText(layouts?.[0]?.hiddenSignatory ? undefined : signatories[0], layouts?.[0]),
    textRight: makeText(layouts?.[1]?.hiddenSignatory ? undefined : signatories[1], layouts?.[1]),
  }
}

// ── Sign-off HTML → formatted runs (Word export) ─────────────────────────────
// A tiny inline-HTML reader, deliberately not a general one: the only markup
// that reaches here is what the report toolbar writes into the sign-off's
// contentEditable — b/strong, i/em, u, and span/font carrying a size, colour or
// family. Tags it doesn't know contribute their text and nothing else.

export interface SignatureRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  sizePt?: number
  color?: string
  font?: string
}

/**
 * Splits an edited credentials block into one string per rendered line.
 *
 * The line marker is NUL rather than a space or a newline: a credential really
 * is "CONSULTANT RADIOLOGIST", so splitting on whitespace would shred it into
 * one Word paragraph per word, and contentEditable HTML can carry newlines of
 * its own. NUL cannot appear in the sanitised markup, so it is unambiguous.
 */
export function splitSignatureHtmlLines(html: string): string[] {
  const lines = sanitizeSignatureHtml(html)
    .replace(/<br\s*\/?>/gi, "\u0000")
    .replace(/<\/(p|div)\s*>/gi, "\u0000")
    .replace(/<(p|div)\b[^>]*>/gi, "")
    .split("\u0000")
    .map((line) => line.trim())
    .filter((line) => signatureHtmlToText(line) !== "")
  // A cleared block still needs one (empty) paragraph — an OOXML table cell
  // cannot contain zero block-level elements.
  return lines.length ? lines : [""]
}

export function parseSignatureHtmlRuns(html: string): SignatureRun[] {
  const clean = sanitizeSignatureHtml(html)
  const runs: SignatureRun[] = []
  const stack: SignatureRun[] = [{ text: "" }]
  const top = () => stack[stack.length - 1]

  const readStyle = (attrs: string, base: SignatureRun): SignatureRun => {
    const next: SignatureRun = { ...base, text: "" }
    const style = /style\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? ""
    const weight = /font-weight\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
    if (weight) next.bold = weight === "bold" || Number(weight) >= 600
    if (/font-style\s*:\s*italic/i.test(style)) next.italic = true
    if (/text-decoration[^:]*:[^;]*underline/i.test(style)) next.underline = true
    const size = /font-size\s*:\s*([\d.]+)(pt|px)/i.exec(style)
    if (size) next.sizePt = size[2].toLowerCase() === "pt" ? Number(size[1]) : Number(size[1]) * 0.75
    const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
      ?? /color\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]
    if (color) next.color = normaliseDocxColor(color)
    const family = /font-family\s*:\s*([^;]+)/i.exec(style)?.[1]?.trim()
      ?? /face\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]
    if (family) next.font = family.split(",")[0].replace(/["']/g, "").trim()
    return next
  }

  const flush = () => {
    const current = top()
    if (current.text) {
      runs.push({ ...current })
      current.text = ""
    }
  }

  const tagRe = /<\/?([a-zA-Z0-9-]+)((?:"[^"]*"|'[^']*'|[^'">])*)>/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(clean)) !== null) {
    top().text += decodeSignatureEntities(clean.slice(cursor, match.index))
    cursor = match.index + match[0].length
    const name = match[1].toLowerCase()
    const closing = match[0].startsWith("</")
    if (name === "br") { flush(); top().text += "\n"; continue }
    if (closing) {
      flush()
      if (stack.length > 1) stack.pop()
      continue
    }
    flush()
    const base = top()
    if (name === "b" || name === "strong") stack.push({ ...base, text: "", bold: true })
    else if (name === "i" || name === "em") stack.push({ ...base, text: "", italic: true })
    else if (name === "u") stack.push({ ...base, text: "", underline: true })
    else if (name === "span" || name === "font") stack.push(readStyle(match[2], base))
    else stack.push({ ...base, text: "" })
  }
  top().text += decodeSignatureEntities(clean.slice(cursor))
  flush()

  return runs.length ? runs : [{ text: "" }]
}

/** Word wants a bare 6-digit hex; CSS may hand over #abc or rgb(...). */
function normaliseDocxColor(value: string): string | undefined {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const h = hex[1]
    return h.length === 3 ? h.split("").map((c) => c + c).join("").toUpperCase() : h.toUpperCase()
  }
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
      .join("").toUpperCase()
  }
  return undefined
}

function decodeSignatureEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
}
