// Shared signature-block rendering for reports — used by the on-screen
// editor/preview, print HTML, the downloaded Word file, and the shared PDF.
// A signatory's master image (uploaded once on the Signatures admin page)
// is never stamped onto a report automatically — it's only a source the
// "+ Add Signature" picker can copy from. A report only ever shows a
// signature once that's been explicitly done for THAT report (`overrideImage`
// set in its saved layout); until then every report renders exactly as it
// always has: blank space for a pen signature, name + credentials in text.

import type { jsPDF } from "jspdf"

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
  overrideImage?: string
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
// Renders just the two <div style="flex:1"> columns — the caller keeps its
// own outer wrapper (each existing call site already has its own spacing).
export function signatureColumnsHtml(signatories: Signatory[], layouts?: (SignatureLayout | null | undefined)[]): string {
  const s0 = signatories[0]
  const s1 = signatories[1]
  const l0 = layouts?.[0]
  const l1 = layouts?.[1]

  const imgHtml = (s?: Signatory, layout?: SignatureLayout | null) => {
    if (!s) return `<div style="flex:1;"></div>`
    if (layout?.hidden) return `<div style="flex:1;height:38px;"></div>`
    const displayImg = layout?.overrideImage
    const h = layout?.height ?? 38
    const sizeCss = layout?.width ? `width:${layout.width}px;` : `max-width:150px;`
    const topVal = layout?.top ? Math.min(0, layout.top) : 0
    const offsetCss = layout?.left || topVal
      ? `position:relative;left:${layout?.left ?? 0}px;top:${topVal}px;`
      : ""
    return displayImg
      ? `<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;min-height:38px;"><img src="${displayImg}" style="height:${h}px;${sizeCss}object-fit:contain;display:block;margin-bottom:3px;${offsetCss}" /></div>`
      : `<div style="flex:1;height:38px;"></div>`
  }

  const textHtml = (s?: Signatory) => {
    if (!s) return `<div style="flex:1;"></div>`
    const credentialLines = s.credentials
      .map((c) => `<p style="font-size:8pt;color:#333;margin-top:2px;text-transform:uppercase;">${c}</p>`)
      .join("")
    return `<div style="flex:1;"><p style="font-weight:bold;font-size:10pt;text-transform:uppercase;">${s.name}</p>${credentialLines}</div>`
  }

  return `
<div style="width:100%;display:flex;flex-direction:column;">
  <div style="display:flex;gap:30px;align-items:flex-end;">
    ${imgHtml(s0, l0)}${imgHtml(s1, l1)}
  </div>
  <div style="display:flex;gap:30px;margin-top:4px;">
    ${textHtml(s0)}${textHtml(s1)}
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
    const displayImg = layout?.overrideImage
    if (!displayImg || layout?.hidden) continue
    const x = i === 0 ? M : rightX
    try {
      doc.addImage(displayImg, imageFormat(displayImg).toUpperCase(), x, y - imgH - 2, imgW, imgH)
    } catch { /* ignore an unreadable image rather than failing the whole PDF */ }
  }

  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0)
  doc.text(signatories[0]?.name ?? "", M, y)
  doc.text(signatories[1]?.name ?? "", rightX, y)
  y += ln(9)

  doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(60)
  const rows = Math.max(signatories[0]?.credentials.length ?? 0, signatories[1]?.credentials.length ?? 0)
  for (let i = 0; i < rows; i++) {
    doc.text(signatories[0]?.credentials[i] ?? "", M, y)
    doc.text(signatories[1]?.credentials[i] ?? "", rightX, y)
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
    if (displayImg && !layout?.hidden) {
      children.push(new Paragraph({
        children: [new ImageRun({
          type: imageFormat(displayImg),
          data: dataUrlToBytes(displayImg),
          transformation: { width: layout?.width ?? 110, height: layout?.height ?? 42 },
        })],
        spacing: { after: 40 },
      }))
    } else {
      children.push(new Paragraph({ children: [] }))
    }
    return children
  }

  const makeText = (s?: Signatory) => {
    const children = []
    children.push(new Paragraph({
      children: [new TextRun({ text: s?.name ?? "", bold: true, size: 20 })],
      spacing: { after: 40 },
    }))
    for (const c of s?.credentials ?? []) {
      children.push(new Paragraph({ children: [new TextRun({ text: c, size: 16 })] }))
    }
    return children
  }

  return {
    imgLeft: makeImg(layouts?.[0]),
    imgRight: makeImg(layouts?.[1]),
    textLeft: makeText(signatories[0]),
    textRight: makeText(signatories[1]),
  }
}
