// Shared report layout pieces matching the clinic's printed design:
// a double-bordered patient info box (NAME / REF. BY on the left,
// DATE / AGE / SEX on the right) followed by a bordered, centered,
// underlined study heading. Used by the report editor, view modal,
// print output and the WhatsApp-shared PDF so they all look identical.

import type { jsPDF } from "jspdf"
import { REPORT_TEMPLATES } from "@/lib/report-templates"

// Shared title fallback: a report only gets a custom heading once a doctor
// has actually edited it — until then, every view of it (editor, view modal,
// reports list) should fall back to the SAME canonical template heading
// (e.g. study "Abd Pelvis" -> "ULTRASONOGRAPHY OF ABDOMEN AND PELVIS"), not
// just the raw study name, or the same report would show a different title
// depending on which screen you printed it from.
export function getDisplayTitle(studyName: string): string {
  if (!studyName) return ""
  for (const cat of Object.keys(REPORT_TEMPLATES)) {
    const list = REPORT_TEMPLATES[cat as keyof typeof REPORT_TEMPLATES]
    const found = list.find((t) => t.name.toLowerCase() === studyName.toLowerCase())
    if (found) return found.heading
  }
  return studyName
}

// Belt-and-suspenders version of the `.report-paper` CSS rule in globals.css:
// stamps the same 0.5em bottom-margin directly onto every paragraph/div as an
// inline style, so the report body's spacing can never depend on stylesheet
// cascade/specificity/load-order at all — call this right after injecting
// saved report HTML via `innerHTML` (the view modal, the shared PDF's host
// element) where there's no Tiptap/React re-render to keep restyling it.
export function applyReportBodySpacing(root: HTMLElement): void {
  root.style.whiteSpace = "pre-wrap"
  root.querySelectorAll<HTMLElement>("p, div").forEach((el) => {
    if (!el.style.marginBottom) el.style.marginBottom = "0.5em"
    if (!el.style.whiteSpace) el.style.whiteSpace = "pre-wrap"
    if (!el.textContent?.trim() && (!el.firstElementChild || el.firstElementChild.tagName === "BR")) {
      if (!el.style.minHeight) el.style.minHeight = "1.5em"
    }
  })
  const children = Array.from(root.children) as HTMLElement[]
  const last = children[children.length - 1]
  if (last) last.style.marginBottom = "0"
}

/**
 * Removes the `<span class="report-edited">` attribution wrappers (added by the
 * editor's post-submission change tracking) while keeping everything inside
 * them — for the view modal, print output and shared PDF, which show a clean
 * report rather than an edit diff.
 *
 * DOM-based on purpose. The obvious regex —
 * `/<span[^>]*report-edited[^>]*>([\s\S]*?)<\/span>/g` — is wrong the moment the
 * wrapped block contains a span of its own, and report bodies routinely do: a
 * font-family run, or an inserted image's anchor span. Being lazy, it stops at
 * the FIRST `</span>` it meets, which is the inner one, so it swallows the
 * inner element's closing tag and leaves the outer one stranded. The browser
 * then repairs that by re-nesting the following text inside the inner span —
 * and for an image anchor (a deliberately 0×0 inline-block) that means the rest
 * of the paragraph disappears into a zero-sized box.
 */
export function stripReportEditMarks(html: string): string {
  if (!html) return html
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    // Server-side (no DOM): fall back to the regex, which is safe enough for the
    // simple case and never runs where a report is actually displayed.
    return html.replace(/<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1")
  }
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.querySelectorAll("span.report-edited").forEach((span) => {
    const parent = span.parentNode
    if (!parent) return
    while (span.firstChild) parent.insertBefore(span.firstChild, span)
    parent.removeChild(span)
  })
  return doc.body.innerHTML
}

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

export const LETTERHEAD_TOP_MM = 40    // pre-printed logo band (default — doctors can resize per report)
export const LETTERHEAD_BOTTOM_MM = 30 // pre-printed address band

// Same bands expressed in on-screen pixels (A4 @ 96dpi: 1mm ≈ 3.7795px),
// so the report editor's "paper" can reserve exactly the header/footer gap
// the Word file and printout use — WYSIWYG with the final document.
export const MM_TO_PX = 96 / 25.4
export const A4_PAGE_PX = Math.round(297 * MM_TO_PX)          // 1123 — full A4 height
export const LETTERHEAD_TOP_PX = Math.round(LETTERHEAD_TOP_MM * MM_TO_PX)       // 151
export const LETTERHEAD_BOTTOM_PX = Math.round(LETTERHEAD_BOTTOM_MM * MM_TO_PX) // 113

// Drag bounds for the resizable header/footer bands in the built-in editor —
// loose enough to fit anything from a thin logo strip to a tall clinic
// masthead, tight enough that a band can never be dragged away entirely or
// past the other one.
export const BAND_HEIGHT_MIN_PX = Math.round(10 * MM_TO_PX) // ~38px
export const BAND_HEIGHT_MAX_PX = Math.round(80 * MM_TO_PX) // ~302px

// Reports render in Cambria clinic-wide (heading, patient box, body) so a
// printed/DOCX/PDF report always matches whatever the built-in editor shows,
// regardless of which font a specific template or heading was authored in.
export const DEFAULT_REPORT_FONT = "Cambria"

// ── Shared type metrics: screen == print == PDF ───────────────────────────────
// The editor and the view modal both render the report body with Tailwind's
// `text-base leading-normal` — 16px / 1.5. 16px is exactly 12pt at 96dpi, so
// the same numbers are correct for print and for the rasterized PDF.
//
// These live here as one shared string specifically because print used to
// hardcode `font-size:10.5pt;line-height:1.625` (14px / 1.625) in three
// separate call sites: every printed report came out ~12% smaller and more
// loosely leaded than the editor had just previewed, and the printed page
// breaks landed in different places than the on-screen pagination predicted
// because the two were measuring different type sizes.
export const REPORT_BODY_FONT_SIZE_PX = 16   // === 12pt @ 96dpi === Tailwind text-base
export const REPORT_BODY_LINE_HEIGHT = 1.5   // === Tailwind leading-normal
// `position:relative;z-index:0` makes the body its own stacking context, which
// is what lets a "Behind Text" image (position:absolute, z-index:-1 — see
// report-image.ts) paint under the report's words yet still over the white page.
// Set inline here, not just in globals.css, because the print window and the
// PDF host build their own HTML documents and load none of the app's CSS.
export const REPORT_BODY_STYLE =
  `font-size:${REPORT_BODY_FONT_SIZE_PX}px;line-height:${REPORT_BODY_LINE_HEIGHT};color:#111827;white-space:pre-wrap;position:relative;z-index:0;`

// The signature row sits flush under the body, matching the editor's `mt-0`.
// Extra room before it is opened up by adding blank lines at the end of the
// body — and a freeform signature stamp lives inside the body flow rather than
// in this block — so a fixed gap here only ever shifted the printed page out of
// step with the editor (print/PDF used to hardcode an 8px top margin).
export const REPORT_SIGS_STYLE =
  "display:flex;gap:30px;margin-top:0;page-break-inside:avoid;break-inside:avoid;"

// Patient box + study title metrics, kept in sync with the editor's Tailwind
// classes so the hand-written HTML the print window and PDF use renders
// identically to the live document:
//   box    border-[6px] border-double border-black, px-5 py-2.5, mb-3
//   lines  text-[13px] font-bold, space-y-1 (4px between lines)
//   title  text-base (16px), py-1 px-8, min-w-[240px], border-[1.5px]
//          border-gray-700 (#374151), underline underline-offset-4,
//          tracking-wide (0.025em), wrapper mb-3
const BOX_BORDER = "6px double #000"
const BOX_PAD_Y = 10          // py-2.5
const BOX_PAD_X = 20          // px-5
const BOX_LINE = "font-weight:bold;font-size:13px;"
const BOX_LINE_GAP = 4        // space-y-1

export function printShellCss(topMm: number = LETTERHEAD_TOP_MM, bottomMm: number = LETTERHEAD_BOTTOM_MM): string {
  return `*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
@page{size:A4;margin:0;}
body{font-family:${DEFAULT_REPORT_FONT},Georgia,serif;font-size:12pt;line-height:1.5;color:#111827;}
table.pg{width:100%;border-collapse:collapse;}
td.pg-content{padding:15mm 14.8mm;}
/* Same per-line gap the built-in editor and view modal give every paragraph
   (see .report-paper in globals.css) — without it every line of the report
   body prints flush against the next, since the *{margin:0} reset above
   (needed to kill the browser's default page margins) also zeroes this. Any
   element with its own inline margin (the patient box's <p> tags, the title
   box) already overrides this by CSS precedence, so it only actually affects
   the plain body paragraphs it's meant for. */
td.pg-content .doc-field, td.pg-content .body, td.pg-content p, td.pg-content div{white-space:pre-wrap;word-break:break-word;}
td.pg-content .doc-field p, td.pg-content .doc-field div, td.pg-content .body p, td.pg-content .body div{margin:0 0 0.5em;min-height:1.5em;}
td.pg-content .doc-field p:empty::before, td.pg-content .doc-field div:empty::before, td.pg-content p:empty::before, td.pg-content div:empty::before{content:"\\00a0";visibility:hidden;}
td.pg-content .doc-field > :last-child, td.pg-content .body > :last-child{margin-bottom:0;}
/* Tables inside the report body — measurement grids from imported Word
   templates, anything inserted with the editor's table button — print with the
   same visible grid the editor and view modal show on screen (mirrors the
   ".doc-field table" rules in globals.css). Without this they print effectively
   invisible: a print window loads none of the app's stylesheet, so there is no
   border rule at all, and the *{margin:0;padding:0} reset above strips the cell
   padding too, leaving a biometry table as unaligned run-together text.
   Deliberately scoped under .doc-field: the page shell (table.pg) must keep its
   own borderless layout, and its single tbody row has to stay breakable across
   sheets for the letterhead spacers to work. */
td.pg-content .doc-field table{border-collapse:collapse;table-layout:fixed;width:100%;margin:8px 0;}
td.pg-content .doc-field table td, td.pg-content .doc-field table th{border:1px solid #9ca3af;padding:5px 8px;vertical-align:top;overflow-wrap:break-word;word-break:break-word;}
/* A body row split across two sheets prints its text sliced in half — keep each
   one whole. Scoped the same way for the same reason: the shell's own <tr> must
   stay breakable. */
td.pg-content .doc-field table tr{page-break-inside:avoid;break-inside:avoid;}
/* Inserted images (see report-image.ts). Every bit of an image's placement —
   wrap mode, size, offsets — is already inline on the elements themselves, so
   these rules exist only to keep the print environment from interfering: the
   usual print-stylesheet habit of img{max-width:100%} WOULD rescale a placed
   image, so its size is pinned explicitly, and overflow:visible keeps a Behind
   Text image that a doctor dragged past the text column from being clipped away
   on paper. (Note: no backticks anywhere in this block — the whole stylesheet
   is a template literal, and one would end the string mid-CSS.) */
td.pg-content .doc-field{overflow:visible;}
td.pg-content .doc-field span[data-rimg-anchor]{white-space:normal;}
td.pg-content .doc-field img[data-rimg]{max-width:none;}
/* Editor-only table affordances (prosemirror-tables' column drag handle and its
   cell-selection tint) are decorations that can survive into saved HTML — never
   let them reach paper. */
td.pg-content .doc-field .column-resize-handle{display:none;}
td.pg-content .doc-field .selectedCell::after{display:none;}
@media print{
/* Horizontal padding matched to the editor/view modal's own side padding
   (56px "px-14" ≈ 14.8mm) rather than a rounder 20mm — a free-form signature
   stamp's position is baked in as a fixed pixel offset from its natural spot
   in the text flow, so keeping the printed content column the same width as
   the screen keeps that offset landing in the same place on paper as it did
   on screen, instead of drifting because the page reflowed narrower/wider. */
td.pg-content{padding:0 14.8mm;}
thead.pg-head>tr>td{height:${topMm}mm;}
tfoot.pg-foot>tr>td{height:${bottomMm}mm;}
}`
}

export function printShellHtml(title: string, innerHtml: string, extraCss = "", topMm: number = LETTERHEAD_TOP_MM, bottomMm: number = LETTERHEAD_BOTTOM_MM): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${printShellCss(topMm, bottomMm)}${extraCss ? `\n${extraCss}` : ""}</style>
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

export function reportHeaderHtml(i: ReportHeaderInfo, fontFamily?: string): string {
  // The editor puts px-5/py-2.5 on the box itself, not on each column, so the
  // cell padding is split: the outer edge of each cell carries the full 20px
  // and the inner edges carry none. Padding both cells all round instead
  // (which is what this used to do) would double the inset down the middle.
  const lead = `padding:${BOX_PAD_Y}px 0 ${BOX_PAD_Y}px ${BOX_PAD_X}px;border:none;vertical-align:top;`
  const trail = `padding:${BOX_PAD_Y}px ${BOX_PAD_X}px ${BOX_PAD_Y}px 0;border:none;vertical-align:top;width:30%;white-space:nowrap;`
  const line = (text: string, last = false) =>
    `<p style="margin:0 0 ${last ? 0 : BOX_LINE_GAP}px;${BOX_LINE}">${text}</p>`

  // A doctor-chosen font for the box applies to every line inside it (the
  // whole box is one font, same model as the study heading's headingFont) —
  // set on the table so it inherits down to all six lines at once.
  const fontCss = fontFamily ? `font-family:${fontFamily};` : ""

  return `
<table style="width:100%;border-collapse:collapse;border:${BOX_BORDER};margin:0 0 12px;${fontCss}">
  <tr>
    <td style="${lead}">
      ${line(`NAME - ${i.name.toUpperCase()}`)}
      ${line(`REF. BY - ${(i.refBy || "SELF").toUpperCase()}`, !i.srNo)}
      ${i.srNo ? line(`SR. NO - #${i.srNo}`, true) : ""}
    </td>
    <td style="${trail}">
      ${line(`DATE - ${i.date || ""}`)}
      ${line(`AGE - ${i.age ? `${i.age} YRS` : "—"}`)}
      ${line(`SEX - ${(i.gender || "—").toUpperCase()}`, true)}
    </td>
  </tr>
</table>`
}

export function reportTitleHtml(title: string, fontFamily?: string): string {
  const fontCss = fontFamily ? `font-family:${fontFamily};` : ""
  // Metrics mirror the editor's title box exactly (see the constants block
  // above): 16px bold, 4px/32px padding, a 240px floor so a short heading
  // still reads as a box rather than shrink-wrapping to the text, and the
  // 4px underline offset Tailwind's `underline-offset-4` applies.
  return `
<div style="text-align:center;margin:0 0 12px;">
  <span style="display:inline-block;box-sizing:border-box;min-width:240px;border:1.5px solid #374151;padding:4px 32px;font-weight:bold;font-size:16px;letter-spacing:0.025em;text-decoration:underline;text-underline-offset:4px;${fontCss}">${title}</span>
</div>`
}

// NOTE: the heading is rendered with the exact casing it was typed in — the
// doctor may want "Testing heading 1" and not "TESTING HEADING 1". Auto-derived
// fallback titles are upper-cased by their callers, so untouched headings look
// the same as before.

// ── jsPDF (shared / downloaded PDFs) ─────────────────────────────────────────
// A4 portrait, 20mm side margins — matches the existing PDF builders.

export function drawPdfReportHeader(doc: jsPDF, i: ReportHeaderInfo, y = 15): number {
  const W = 210, M = 20
  const boxH = 26

  // Double border: outer + inner rectangle
  doc.setDrawColor(0)
  doc.setLineWidth(0.6)
  doc.rect(M, y, W - 2 * M, boxH)
  doc.setLineWidth(0.3)
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
  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.setTextColor(0)

  const tw   = doc.getTextWidth(title)
  const boxW = Math.min(tw + 20, 180)
  const boxH = 10
  const bx   = (W - boxW) / 2

  doc.setDrawColor(60)
  doc.setLineWidth(0.35)
  doc.rect(bx, y, boxW, boxH)

  const ty = y + 6.5
  doc.text(title, W / 2, ty, { align: "center" })
  doc.setLineWidth(0.3)
  doc.line((W - tw) / 2, ty + 1.2, (W + tw) / 2, ty + 1.2)

  return y + boxH + 8
}
