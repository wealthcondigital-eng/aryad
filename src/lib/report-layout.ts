// Shared report layout pieces matching the clinic's printed design:
// a double-bordered patient info box (NAME / REF. BY on the left,
// DATE / AGE / SEX on the right) followed by a bordered, centered,
// underlined study heading. Used by the report editor, view modal,
// print output and the WhatsApp-shared PDF so they all look identical.

import type { jsPDF } from "jspdf"

export interface ReportHeaderInfo {
  name: string
  refBy?: string
  date?: string
  age?: string | number
  gender?: string
  srNo?: string | number
}

// ── Print-window page shell ──────────────────────────────────────────────────
// Reports print on the clinic's pre-printed letterhead stationery, so the
// printed page must keep the top (logo) and bottom (address) bands empty.
// `@page { margin: 0 }` also stops the browser from adding its own
// date / title / URL lines over the letterhead; the thead/tfoot spacers
// repeat on every printed page so multi-page reports stay clear too.

export const LETTERHEAD_TOP_MM = 40    // pre-printed logo band
export const LETTERHEAD_BOTTOM_MM = 30 // pre-printed address band

// Same bands expressed in on-screen pixels (A4 @ 96dpi: 1mm ≈ 3.7795px),
// so the report editor's "paper" can reserve exactly the header/footer gap
// the Word file and printout use — WYSIWYG with the final document.
const MM_TO_PX = 96 / 25.4
export const A4_PAGE_PX = Math.round(297 * MM_TO_PX)          // 1123 — full A4 height
export const LETTERHEAD_TOP_PX = Math.round(LETTERHEAD_TOP_MM * MM_TO_PX)       // 151
export const LETTERHEAD_BOTTOM_PX = Math.round(LETTERHEAD_BOTTOM_MM * MM_TO_PX) // 113

export function printShellCss(): string {
  return `*{box-sizing:border-box;margin:0;padding:0;}
@page{size:A4;margin:0;}
body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.5;color:#111;}
table.pg{width:100%;border-collapse:collapse;}
td.pg-content{padding:15mm 20mm;}
@media print{
td.pg-content{padding:0 20mm;}
thead.pg-head>tr>td{height:${LETTERHEAD_TOP_MM}mm;}
tfoot.pg-foot>tr>td{height:${LETTERHEAD_BOTTOM_MM}mm;}
}`
}

export function printShellHtml(title: string, innerHtml: string, extraCss = ""): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${printShellCss()}${extraCss ? `\n${extraCss}` : ""}</style>
</head><body>
<table class="pg">
<thead class="pg-head"><tr><td></td></tr></thead>
<tbody><tr><td class="pg-content">
${innerHtml}
</td></tr></tbody>
<tfoot class="pg-foot"><tr><td></td></tr></tfoot>
</table>
</body></html>`
}

// ── HTML (print windows) ─────────────────────────────────────────────────────

export function reportHeaderHtml(i: ReportHeaderInfo): string {
  return `
<table style="width:100%;border-collapse:collapse;border:3px double #333;">
  <tr>
    <td style="padding:12px 16px;border:none;vertical-align:top;">
      <p style="margin:0 0 5px;font-weight:bold;font-size:11pt;">NAME - ${i.name.toUpperCase()}</p>
      <p style="margin:0${i.srNo ? " 0 5px" : ""};font-weight:bold;font-size:11pt;">REF. BY - ${(i.refBy || "SELF").toUpperCase()}</p>
      ${i.srNo ? `<p style="margin:0;font-weight:bold;font-size:11pt;">SR. NO - #${i.srNo}</p>` : ""}
    </td>
    <td style="padding:12px 16px;border:none;vertical-align:top;width:30%;white-space:nowrap;">
      <p style="margin:0 0 5px;font-weight:bold;font-size:11pt;">DATE - ${i.date || ""}</p>
      <p style="margin:0 0 5px;font-weight:bold;font-size:11pt;">AGE - ${i.age ? `${i.age} YRS` : "—"}</p>
      <p style="margin:0;font-weight:bold;font-size:11pt;">SEX - ${(i.gender || "—").toUpperCase()}</p>
    </td>
  </tr>
</table>`
}

export function reportTitleHtml(title: string): string {
  return `
<div style="text-align:center;margin:20px 0 18px;">
  <span style="display:inline-block;border:1.5px solid #333;padding:5px 30px;font-weight:bold;font-size:12.5pt;text-transform:uppercase;text-decoration:underline;">${title}</span>
</div>`
}

// ── jsPDF (shared / downloaded PDFs) ─────────────────────────────────────────
// A4 portrait, 20mm side margins — matches the existing PDF builders.

export function drawPdfReportHeader(doc: jsPDF, i: ReportHeaderInfo, y = 15): number {
  const W = 210, M = 20
  const boxH = 26

  // Double border: outer + inner rectangle
  doc.setDrawColor(60)
  doc.setLineWidth(0.5)
  doc.rect(M, y, W - 2 * M, boxH)
  doc.setLineWidth(0.2)
  doc.rect(M + 1.2, y + 1.2, W - 2 * M - 2.4, boxH - 2.4)

  doc.setTextColor(0)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10.5)

  const lx = M + 6
  doc.text(`NAME - ${i.name.toUpperCase()}`, lx, y + 7.5)
  doc.text(`REF. BY - ${(i.refBy || "SELF").toUpperCase()}`, lx, y + 13.5)
  if (i.srNo) doc.text(`SR. NO - #${i.srNo}`, lx, y + 19.5)

  const rx = W - M - 62
  doc.text(`DATE - ${i.date || ""}`, rx, y + 7.5)
  doc.text(`AGE - ${i.age ? `${i.age} YRS` : "—"}`, rx, y + 13.5)
  doc.text(`SEX - ${(i.gender || "—").toUpperCase()}`, rx, y + 19.5)

  return y + boxH + 10
}

export function drawPdfReportTitle(doc: jsPDF, title: string, y: number): number {
  const W = 210
  const t = title.toUpperCase()
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(0)

  const tw   = doc.getTextWidth(t)
  const boxW = Math.min(tw + 20, 180)
  const boxH = 10
  const bx   = (W - boxW) / 2

  doc.setDrawColor(60)
  doc.setLineWidth(0.35)
  doc.rect(bx, y, boxW, boxH)

  const ty = y + 6.5
  doc.text(t, W / 2, ty, { align: "center" })
  doc.setLineWidth(0.3)
  doc.line((W - tw) / 2, ty + 1.2, (W + tw) / 2, ty + 1.2)

  return y + boxH + 8
}
