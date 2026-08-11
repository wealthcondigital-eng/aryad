// Browser-only: rasterizes clean report HTML (header/title/body/signatures)
// into paginated A4 sheets and packs them into a PDF via html2canvas-pro + jsPDF.
//
// Why not draw text directly with jsPDF? jsPDF only ships 4 built-in fonts
// (Helvetica/Times/Courier/Symbol), so any font picked in the report editor's
// toolbar (Georgia, Calibri, Tahoma, ...) would silently render as Helvetica.
// Rasterizing the same HTML the browser already renders on screen guarantees
// the exported PDF shows whichever font the browser actually used — at the
// cost of the PDF text no longer being selectable/searchable.

import { LETTERHEAD_TOP_PX, LETTERHEAD_BOTTOM_PX, A4_PAGE_PX, DEFAULT_REPORT_FONT, applyReportBodySpacing, REPORT_BODY_STYLE, REPORT_SIGS_STYLE, paginateDomBlocks } from "@/lib/report-layout"

const A4_WIDTH_PX = 794       // 210mm @ 96dpi — matches report-layout's mm/px basis
const CONTENT_SIDE_PX = 56    // left/right content margin (Tailwind px-14)
const CAPTURE_SCALE = 2       // render at 2x for crisp print/PDF quality

// ── Colours the rasterizer can't read ────────────────────────────────────────
// A colour function the rasterizer can't parse doesn't degrade — it throws, and
// the whole PDF build fails with it. That is exactly how every share ended up
// with no PDF behind it: this app is Tailwind v4 (an `oklch()` palette, which
// the production build's minifier rewrites to `lab()` on top of that), and
// anything without an explicit colour inherits `color` from <body>.
//
// html2canvas-pro reads lab/lch/oklab/oklch. It has no parser for
// `color-mix()`, which Tailwind writes for every `/opacity` utility — Chrome
// resolves most of those before they are ever read, but one involving
// `currentcolor` stays a literal `color-mix()` in the computed value and would
// reach the capture. The properties that can carry one are resolved below.
const COLOR_PROPS = [
  "color", "background-color", "border-top-color", "border-right-color",
  "border-bottom-color", "border-left-color", "outline-color", "text-decoration-color",
] as const

let probeCtx: CanvasRenderingContext2D | null | undefined

/**
 * A colour string as plain `rgb()`/hex, using the canvas as the converter — it
 * accepts every colour syntax the browser does and hands back a legacy value.
 * Returns null when the browser can't read it either, so the caller can fall
 * back rather than paint something wrong.
 */
function toLegacyColor(value: string): string | null {
  if (probeCtx === undefined) probeCtx = document.createElement("canvas").getContext("2d")
  if (!probeCtx) return null
  try {
    probeCtx.fillStyle = value
    const out = String(probeCtx.fillStyle)
    return /^(#|rgb)/i.test(out) ? out : null
  } catch { return null }
}

function neutralizeUnreadableColors(root: HTMLElement) {
  const els: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
  for (const el of els) {
    const cs = getComputedStyle(el)
    for (const prop of COLOR_PROPS) {
      const value = cs.getPropertyValue(prop)
      if (!value.includes("color-mix(")) continue
      // `currentcolor` means nothing to the canvas, so it goes in as the
      // element's own resolved colour first.
      const resolved = toLegacyColor(value.replace(/currentcolor/gi, cs.color))
      // Nothing readable: a background disappears (the sheet under it is
      // white), anything else falls back to the report's ink colour.
      el.style.setProperty(prop, resolved ?? (prop === "background-color" ? "transparent" : "#111827"))
    }
  }
}

export async function buildPagedPdfBlob(opts: {
  topSpacerHtml?: string   // blank lines the doctor left under the patient box
  headerHtml: string       // reportHeaderHtml(...)
  titleHtml: string        // reportTitleHtml(...)
  bodyHtml: string         // cleaned report body HTML (font/bold/italic/images intact)
  signaturesHtml: string   // signatureColumnsHtml(...)
  headerTopPx?: number     // per-report resized top letterhead band; defaults to LETTERHEAD_TOP_PX
  footerBottomPx?: number  // per-report resized bottom letterhead band; defaults to LETTERHEAD_BOTTOM_PX
}): Promise<Blob> {
  const topPx    = opts.headerTopPx ?? LETTERHEAD_TOP_PX
  const bottomPx = opts.footerBottomPx ?? LETTERHEAD_BOTTOM_PX
  const host = document.createElement("div")
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${A4_WIDTH_PX}px;background:#ffffff;`

  const content = document.createElement("div")
  // `color` and `background` are set explicitly so nothing in here inherits the
  // app's theme colour from <body>: the report is black on white on paper, and
  // an inherited theme token is both wrong and — being oklch/lab — a needless
  // risk for the rasterizer.
  content.style.cssText = `padding:${topPx}px ${CONTENT_SIDE_PX}px ${bottomPx}px;box-sizing:border-box;font-family:${DEFAULT_REPORT_FONT},Georgia,serif;color:#111827;background:#ffffff;`
  // No Tailwind colour utility on the body div — REPORT_BODY_STYLE already
  // carries `color:#111827`, whereas `text-gray-900` resolves to a lab() value.
  content.innerHTML = `
    <div>${opts.headerHtml}</div>
    ${opts.topSpacerHtml ?? ""}
    <div>${opts.titleHtml}</div>
    <div id="pgb-body" class="doc-field report-paper" style="${REPORT_BODY_STYLE}">${opts.bodyHtml}</div>
    <div style="${REPORT_SIGS_STYLE}">${opts.signaturesHtml}</div>
  `
  host.appendChild(content)
  document.body.appendChild(host)

  try {
    const bodyEl = content.querySelector("#pgb-body") as HTMLElement
    applyReportBodySpacing(bodyEl)
    const items = Array.from(content.children).flatMap((child) =>
      child === bodyEl ? Array.from(bodyEl.children) as HTMLElement[] : [child as HTMLElement]
    )

    // Push any item that would fall in a page's footer band down to the top of
    // the next sheet, and break a table too tall for one sheet between its rows
    // — literally the same function the editor and the view modal paginate with
    // (paginateDomBlocks), so the PDF the patient receives breaks its pages
    // exactly where the doctor saw them break. `stride` is the page height with
    // no gap here: these sheets are stacked edge to edge for slicing, not drawn
    // with the on-screen grey gutter between them.
    const numPages = paginateDomBlocks({
      items,
      wrapTop: host.getBoundingClientRect().top,
      stride: A4_PAGE_PX,
      pagePx: A4_PAGE_PX,
      topPx,
      bottomPx,
    })
    host.style.height = `${numPages * A4_PAGE_PX}px`

    // html2canvas-pro, not html2canvas: 1.4.1 supports rgb/hsl and nothing
    // else, so it threw "unsupported color function" on the app's own palette
    // (`oklch()` in development, `lab()` once the production CSS is minified)
    // and every single PDF build failed. See the note on COLOR_PROPS above.
    // The -pro fork exists to parse the modern colour functions; the API is
    // otherwise identical.
    neutralizeUnreadableColors(host)
    const html2canvas = (await import("html2canvas-pro")).default
    const canvas = await html2canvas(host, { scale: CAPTURE_SCALE, backgroundColor: "#ffffff", useCORS: true })

    const { jsPDF } = await import("jspdf")
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
    const pxPerPage = A4_PAGE_PX * CAPTURE_SCALE

    for (let p = 0; p < numPages; p++) {
      if (p > 0) doc.addPage()
      const slice = document.createElement("canvas")
      slice.width  = canvas.width
      slice.height = pxPerPage
      const ctx = slice.getContext("2d")
      if (ctx) ctx.drawImage(canvas, 0, p * pxPerPage, canvas.width, pxPerPage, 0, 0, canvas.width, pxPerPage)
      doc.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297)
    }
    return doc.output("blob")
  } finally {
    document.body.removeChild(host)
  }
}
