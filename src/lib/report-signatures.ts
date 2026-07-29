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
    s && !layout?.hidden ? layout?.overrideImage || undefined : undefined
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

  const textHtml = (s?: Signatory) => {
    if (!s) return `<div style="flex:1;"></div>`
    // Sizes in px, not pt: the component uses text-[13px]/text-[10px], and 10pt
    // (13.3px) / 8pt (10.7px) rendered the printed names slightly larger than
    // the screen ones. Line height is left to inherit (1.5) on both sides.
    const credentialLines = s.credentials
      .map((c, i) => `<p style="font-size:10px;text-transform:uppercase;color:#4b5563;${i === 0 ? "margin-top:2px;" : ""}">${c}</p>`)
      .join("")
    return `<div style="flex:1;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;">${s.name}</p>${credentialLines}</div>`
  }

  // The 4px gap between the rows lives on the image row (component: `mb-1`), so
  // that with no image row there is no gap left dangling above the names.
  return `
<div style="width:100%;display:flex;flex-direction:column;">
  ${hasAnyImg ? `<div style="display:flex;gap:32px;align-items:flex-end;margin-bottom:4px;">${imgHtml(img0, l0)}${imgHtml(img1, l1)}</div>` : ""}
  <div style="display:flex;gap:32px;">
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

  const makeText = (s?: Signatory) => {
    const children = []
    children.push(new Paragraph({
      children: [new TextRun({ text: s?.name ?? "", bold: true, size: 20, font: DEFAULT_REPORT_FONT })],
      spacing: { after: 40 },
    }))
    for (const c of s?.credentials ?? []) {
      children.push(new Paragraph({ children: [new TextRun({ text: c, size: 16, font: DEFAULT_REPORT_FONT })] }))
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
