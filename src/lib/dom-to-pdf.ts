// Browser-only: rasterizes clean report HTML (header/title/body/signatures)
// into paginated A4 sheets and packs them into a PDF via html2canvas + jsPDF.
//
// Why not draw text directly with jsPDF? jsPDF only ships 4 built-in fonts
// (Helvetica/Times/Courier/Symbol), so any font picked in the report editor's
// toolbar (Georgia, Calibri, Tahoma, ...) would silently render as Helvetica.
// Rasterizing the same HTML the browser already renders on screen guarantees
// the exported PDF shows whichever font the browser actually used — at the
// cost of the PDF text no longer being selectable/searchable.

import { LETTERHEAD_TOP_PX, LETTERHEAD_BOTTOM_PX, A4_PAGE_PX } from "@/lib/report-layout"

const A4_WIDTH_PX = 794       // 210mm @ 96dpi — matches report-layout's mm/px basis
const CONTENT_SIDE_PX = 56    // left/right content margin (Tailwind px-14)
const CAPTURE_SCALE = 2       // render at 2x for crisp print/PDF quality

export async function buildPagedPdfBlob(opts: {
  headerHtml: string       // reportHeaderHtml(...)
  titleHtml: string        // reportTitleHtml(...)
  bodyHtml: string         // cleaned report body HTML (font/bold/italic/images intact)
  signaturesHtml: string   // signatureColumnsHtml(...)
}): Promise<Blob> {
  const host = document.createElement("div")
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${A4_WIDTH_PX}px;background:#ffffff;`

  const content = document.createElement("div")
  content.style.cssText = `padding:${LETTERHEAD_TOP_PX}px ${CONTENT_SIDE_PX}px ${LETTERHEAD_BOTTOM_PX}px;box-sizing:border-box;font-family:Arial,sans-serif;`
  content.innerHTML = `
    <div>${opts.headerHtml}</div>
    <div style="margin:20px 0 18px;">${opts.titleHtml}</div>
    <div id="pgb-body" style="font-size:10pt;line-height:1.6;">${opts.bodyHtml}</div>
    <div style="display:flex;gap:30px;margin-top:80px;page-break-inside:avoid;break-inside:avoid;">${opts.signaturesHtml}</div>
  `
  host.appendChild(content)
  document.body.appendChild(host)

  try {
    const bodyEl = content.querySelector("#pgb-body") as HTMLElement
    const items = Array.from(content.children).flatMap((child) =>
      child === bodyEl ? Array.from(bodyEl.children) as HTMLElement[] : [child as HTMLElement]
    )

    // Push any item that would fall in a page's footer band down to the top
    // of the next sheet — the same page-break logic the live editor/report
    // viewer use for their on-screen pagination.
    const hostTop = host.getBoundingClientRect().top
    let page = 0
    for (const it of items) {
      const r      = it.getBoundingClientRect()
      const top    = r.top - hostTop
      const bottom = top + r.height
      const footerLimit = page * A4_PAGE_PX + (A4_PAGE_PX - LETTERHEAD_BOTTOM_PX)
      const pageTop      = page * A4_PAGE_PX + LETTERHEAD_TOP_PX
      if (bottom > footerLimit + 1 && top > pageTop + 2) {
        page++
        const target = page * A4_PAGE_PX + LETTERHEAD_TOP_PX
        const delta  = target - top
        if (delta > 0) {
          const base = parseFloat(getComputedStyle(it).marginTop) || 0
          it.style.marginTop = `${base + delta}px`
        }
      }
    }

    const numPages = page + 1
    host.style.height = `${numPages * A4_PAGE_PX}px`

    const html2canvas = (await import("html2canvas")).default
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
