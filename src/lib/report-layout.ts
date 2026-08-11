// Shared report layout pieces matching the clinic's printed design:
// a double-bordered patient info box (NAME / REF. BY on the left,
// DATE / AGE / SEX on the right) followed by a bordered, centered,
// underlined study heading. Used by the report editor, view modal,
// print output and the WhatsApp-shared PDF so they all look identical.

import type { jsPDF } from "jspdf"
import { REPORT_TEMPLATES } from "@/lib/report-templates"
import { reportFontFaceCss } from "@/lib/report-fonts"

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
    // Deliberately does NOT stamp a paragraph gap: the document's own blank
    // lines and inline margins are the spacing (see globals.css).
    if (!el.style.marginBottom) el.style.marginBottom = "0"
    if (!el.style.whiteSpace) el.style.whiteSpace = "pre-wrap"
    if (!el.textContent?.trim() && (!el.firstElementChild || el.firstElementChild.tagName === "BR")) {
      // 1em, not 1.5: the floor is there to keep a blank line visible, and a
      // taller one silently overrides the line height of imported Word content.
      if (!el.style.minHeight) el.style.minHeight = "1em"
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

// ── Page breaks, for the plain-HTML views of a report ────────────────────────
// The editor lays out its A4 sheets through ProseMirror decorations (see
// tiptap-pagination-extension.ts). The view modal and the shared-PDF builder
// have no ProseMirror — they drop saved HTML into a div — but they must land on
// the SAME page breaks, or a report that was fitted onto one page in the editor
// comes out over two when it's viewed, printed or sent to the patient.
//
// So the measuring rules live here once and both of those call it: every block
// that would be drawn over the letterhead footer band moves to the next sheet,
// and a table too tall to fit on any sheet is broken between its rows rather
// than being allowed to run through the band (a table is a single block — there
// is nowhere to push it to).

/**
 * Marks a block the doctor forced onto a new sheet (Word's Ctrl+Enter). Lives
 * here rather than with the editor extension that writes it, because all three
 * paginators have to agree on it: the editor's decorations, paginateDomBlocks
 * (view modal + PDF), and the print window's own CSS page-break-before.
 */
export const PAGE_BREAK_ATTR = "data-page-break"

export const PAGE_SPACER_ROW_ATTR = "data-pgb-spacer"

// Word breaks a paragraph between its LINES when it doesn't fit in what's left
// of a page. Moving the whole paragraph instead — which is all a block-level
// margin can do — is what leaves a band of blank space above every long
// paragraph that happens to straddle a page boundary, and it cannot place a
// paragraph taller than one page's content area at all (there is no position
// where the whole block clears the footer, so it gets pushed once and then
// drawn straight through the letterhead band).
//
// The fix is a full-width inline-block spacer dropped between two line boxes:
// being 100% wide it takes a line to itself, and its height carries the rest of
// the paragraph past the footer band, the sheet gap and the next sheet's header
// band — the same trick the table path already uses with spacer <tr>s, one
// level down.
export const PAGE_SPACER_INLINE_ATTR = "data-pgb-inline"

export function isPageSpacerRow(el: Element | null | undefined): boolean {
  return !!el && el.nodeType === 1 && (el as HTMLElement).hasAttribute(PAGE_SPACER_ROW_ATTR)
}

export function isPageSpacerInline(el: Element | null | undefined): boolean {
  return !!el && el.nodeType === 1 && (el as HTMLElement).hasAttribute(PAGE_SPACER_INLINE_ATTR)
}

/**
 * Word's default widow/orphan control: never strand fewer than two lines of a
 * paragraph on either side of a page break. When a paragraph can't be split
 * without breaking this, the whole paragraph moves to the next sheet instead —
 * which is exactly what the old code did unconditionally.
 */
export const MIN_LINES_EITHER_SIDE = 2

/**
 * How much of a sheet may be left blank to keep a table intact.
 *
 * A table is one block, so the only ways to place one that doesn't fit in what's
 * left of a page are to move it whole (leaving a hole) or to break it between
 * rows. Neither is right unconditionally: Word flows tables across pages by
 * default, but this clinic's tables are 4-8 row biometry grids where splitting
 * is worse for the reader than a small gap.
 *
 * So the decision is made on the size of the HOLE rather than the size of the
 * table. Under a quarter of a sheet reads as ordinary spacing and the grid stays
 * whole; more than that reads as a printing fault, and it splits between rows
 * instead. A table taller than a whole sheet always splits — there is nowhere to
 * move it to.
 */
export const MAX_ORPHAN_GAP_RATIO = 0.25

/**
 * A header row reprinted at the top of a table's continuation page. Marked so it
 * is stripped alongside the spacers — like them it is layout scaffolding, and it
 * must never reach saved HTML, the DOCX export or the change-tracking diff,
 * where it would read as a duplicated row of real content.
 */
export const PAGE_REPEAT_ROW_ATTR = "data-pgb-repeat"

export function buildRepeatedHeaderRow(source: HTMLTableRowElement): HTMLTableRowElement {
  const clone = source.cloneNode(true) as HTMLTableRowElement
  clone.setAttribute(PAGE_REPEAT_ROW_ATTR, "1")
  clone.setAttribute("aria-hidden", "true")
  clone.removeAttribute("id")
  clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"))
  return clone
}

/** True when a table's first row is a real header row (all cells are `<th>`). */
export function isHeaderRow(row: HTMLTableRowElement | undefined): boolean {
  if (!row || !row.cells.length) return false
  return Array.from(row.cells).every((c) => c.tagName === "TH")
}

export function buildPageSpacerInline(height: number): HTMLElement {
  const span = document.createElement("span")
  span.setAttribute(PAGE_SPACER_INLINE_ATTR, "1")
  span.setAttribute("aria-hidden", "true")
  // `width:100%` is what forces the spacer onto its own line (and therefore the
  // following text onto the line after it); `vertical-align:top` keeps it from
  // adding the baseline leading an inline-block would otherwise contribute on
  // top of its explicit height.
  span.style.cssText =
    `display:inline-block;width:100%;height:${height}px;vertical-align:top;user-select:none;pointer-events:none;`
  return span
}

/**
 * A table's own rows, in document order, ignoring page-break spacers.
 *
 * `tableEl.rows` is wrong for both halves of that: it also collects the rows of
 * any table nested inside a cell, and it includes the spacer rows pagination
 * injects — either one desynchronises DOM row `i` from row `i` of the document,
 * which every row-height read and write depends on.
 */
export function reportTableRows(tableEl: HTMLTableElement): HTMLTableRowElement[] {
  const rows: HTMLTableRowElement[] = []
  const take = (el: Element) => {
    // Spacer rows AND repeated header rows are both scaffolding — either one
    // left in would desynchronise DOM row `i` from row `i` of the document,
    // which every row-height read and write depends on.
    if (el.tagName !== "TR") return
    if (isPageSpacerRow(el) || (el as HTMLElement).hasAttribute(PAGE_REPEAT_ROW_ATTR)) return
    rows.push(el as HTMLTableRowElement)
  }
  Array.from(tableEl.children).forEach((child) => {
    if (child.tagName === "TBODY" || child.tagName === "THEAD" || child.tagName === "TFOOT") {
      Array.from(child.children).forEach(take)
    } else take(child)
  })
  return rows
}

export function buildPageSpacerRow(height: number, colspan: number): HTMLTableRowElement {
  const tr = document.createElement("tr")
  tr.setAttribute(PAGE_SPACER_ROW_ATTR, "1")
  tr.setAttribute("aria-hidden", "true")
  tr.style.height = `${height}px`
  const td = document.createElement("td")
  td.setAttribute("colspan", String(Math.max(1, colspan)))
  // Inline, so it beats the table-cell border/padding rules — a bordered spacer
  // would draw a box across the letterhead band it exists to keep empty.
  td.style.cssText = "border:0;padding:0;background:transparent;"
  tr.appendChild(td)
  return tr
}

const SPACER_SELECTOR = `[${PAGE_SPACER_ROW_ATTR}],[${PAGE_SPACER_INLINE_ATTR}],[${PAGE_REPEAT_ROW_ATTR}]`

/**
 * Drops every page-break spacer — row and inline — from a subtree (or an HTML
 * string). Spacers are layout scaffolding, never content: they must be gone
 * before anything is saved, exported to DOCX, diffed for change tracking, or
 * re-measured for a fresh pagination run.
 */
export function stripPageSpacerRows<T extends HTMLElement | string>(target: T): T {
  if (typeof target === "string") {
    if (typeof DOMParser === "undefined") return target
    const doc = new DOMParser().parseFromString(target, "text/html")
    doc.querySelectorAll(SPACER_SELECTOR).forEach((n) => n.remove())
    return doc.body.innerHTML as T
  }
  target.querySelectorAll(SPACER_SELECTOR).forEach((n) => n.remove())
  return target
}

export interface LineBox {
  /** Vertical advance this line consumes — see the note on line-height below. */
  height: number
  /** Text node the line starts in, and the character offset it starts at. */
  node: Text
  offset: number
}

/**
 * Where each line of a text block starts, and how much vertical space it takes.
 *
 * Deliberately NOT coordinate-based. The obvious implementation — read each
 * line's rect, then hand the coordinates to caretRangeFromPoint (or
 * ProseMirror's posAtCoords) to find the matching document position — is broken
 * for exactly the documents this feature exists for: both APIs only resolve
 * points inside the VISIBLE VIEWPORT, so on any report taller than the window
 * every break below the fold silently returns null and the text runs straight
 * through the letterhead band. A (node, offset) pair has no such limit: the DOM
 * path inserts at it with a Range, and the editor maps it with posAtDOM.
 *
 * `height` is the line's ADVANCE (its line-height), not the height of the rect
 * getClientRects reports. Those rects are ink boxes — for 16px/1.5 text they
 * come back 17px tall against a real 24px advance, and accumulating the rect
 * height instead under-counts by 7px on every line, which after a page of text
 * is enough drift to place the next block inside a letterhead band. A line
 * carrying something taller than the type (an inline image, a large-font run)
 * keeps its measured height instead.
 */
export function naturalLineBoxes(dom: HTMLElement, zoom = 1): LineBox[] {
  if (typeof document === "undefined") return []

  const cs = getComputedStyle(dom)
  let lineHeight = parseFloat(cs.lineHeight)
  if (!Number.isFinite(lineHeight)) lineHeight = (parseFloat(cs.fontSize) || 16) * 1.2

  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      // Skip a previous pass's spacers, and nested tables — the row-splitting
      // path owns those.
      for (let el = n.parentElement; el && el !== dom; el = el.parentElement) {
        if (isPageSpacerInline(el) || isPageSpacerRow(el) || el.tagName === "TABLE") return NodeFilter.FILTER_REJECT
      }
      return n.nodeValue && n.nodeValue.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  const range = document.createRange()
  const lines: (LineBox & { top: number; bottom: number })[] = []

  // Rects come back in SCREEN pixels, so at any zoom other than 100% they must
  // be divided back into layout pixels — the unit `lineHeight` above is in, and
  // the unit every A4 constant is in. See PageBreakOpts.zoom.
  const charRect = (node: Text, i: number) => {
    range.setStart(node, i)
    range.setEnd(node, Math.min(i + 1, node.length))
    const r = range.getBoundingClientRect()
    return zoom === 1 ? r : { top: r.top / zoom, bottom: r.bottom / zoom }
  }

  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.length
    if (!len) continue

    // One entry per line this node contributes. Each pass binary-searches for
    // the first character sitting below the current line, so the cost is
    // O(lines × log length) rect reads rather than one read per character.
    let start = 0
    let startRect = charRect(n, 0)
    for (;;) {
      const record = { top: startRect.top, bottom: startRect.bottom, height: lineHeight, node: n, offset: start }
      const last = lines[lines.length - 1]
      // A line can span several text nodes (`<b>LIVER :</b> the rest`). Those
      // fragments are merged by vertical overlap — and the merged line keeps the
      // FIRST fragment's node/offset, which is where the line truly begins.
      if (last && record.top < last.bottom - 1) {
        last.bottom = Math.max(last.bottom, record.bottom)
        last.height = Math.max(last.height, lineHeight, last.bottom - last.top)
      } else {
        lines.push(record)
      }

      let lo = start + 1
      let hi = len
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (charRect(n, mid).top > startRect.top + 1) hi = mid
        else lo = mid + 1
      }
      if (lo >= len) break
      start = lo
      startRect = charRect(n, lo)
    }
  }

  return lines.map(({ height, node, offset }) => ({ height, node, offset }))
}

function tableWithin(el: HTMLElement): HTMLTableElement | null {
  if (el.tagName === "TABLE") return el as HTMLTableElement
  return el.querySelector("table")
}


export interface DomPageBreakOpts {
  /** Top-level blocks, in flow order (patient box, title, each body block, signatures). */
  items: HTMLElement[]
  /** Viewport top of the element the offsets are measured against. */
  wrapTop: number
  /** Sheet-to-sheet distance. Equals pagePx where sheets are drawn with no gap. */
  stride: number
  pagePx: number
  topPx: number
  bottomPx: number
}

/**
 * Applies the page breaks and returns the number of sheets used.
 * Pushes are recorded in `data-pgb` / `data-pgb-base` so a re-run measures the
 * natural layout again instead of stacking margin on margin.
 */
export function paginateDomBlocks(o: DomPageBreakOpts): number {
  const { items, wrapTop, stride, pagePx, topPx, bottomPx } = o
  const pageContentPx = pagePx - topPx - bottomPx

  // Undo the previous run first — every measurement below has to be of the
  // natural layout.
  items.forEach((it) => {
    if (it.dataset.pgb) {
      it.style.marginTop = it.getAttribute("data-pgb-base") || ""
      delete it.dataset.pgb
      it.removeAttribute("data-pgb-base")
    }
    // Clears spacer rows AND inline line-break spacers, and is called on the
    // block itself rather than only on a table inside it — a paragraph carries
    // its breaks directly. Leaving any behind would make the next run measure
    // the previous run's layout and stack break on break.
    stripPageSpacerRows(it)
    it.normalize()
  })

  let page = 0
  for (const it of items) {
    const table = tableWithin(it)
    const rowEls = table ? reportTableRows(table) : []
    const rowHeights = rowEls.map((r) => r.getBoundingClientRect().height)
    const rowsHeight = rowHeights.reduce((a, b) => a + b, 0)

    const rect = (table ?? it).getBoundingClientRect()
    const top = rect.top - wrapTop
    const height = table ? rowsHeight : rect.height

    const footerLimit = page * stride + (pagePx - bottomPx)
    const pageTop = page * stride + topPx

    // Mirrors computeBodyPageDecorations exactly — the editor and these
    // plain-HTML views MUST agree on every break or a report fitted onto one
    // sheet in the editor comes out over two when it's viewed, printed or sent
    // to the patient. Keep the two in step when either changes.
    //
    // What has to clear the band for this block to stay put: for a table too
    // tall for any sheet, just its first row, since the rest is split between
    // rows below anyway; for a table that fits, the whole table. A text block
    // is split between its LINES instead of being required to fit whole.
    const lines = table ? [] : naturalLineBoxes(it)

    // A blank line is only left where it falls while it still FITS above the
    // band — see the same rule in the editor's own pass
    // (tiptap-pagination-extension.ts). All three paginators have to agree.
    // One that no longer fits is pushed like any other block, because Word
    // never prints a line inside the bottom margin.
    const isBlankLine = !table && !it.textContent?.trim() && !it.querySelector("img")
    if (isBlankLine && top + height <= footerLimit + 1) continue

    let pushed = 0
    // A manual page break wins outright, exactly as in the editor's own pass —
    // otherwise a break the doctor put in would show on screen and vanish from
    // the PDF and the view modal, which share this function.
    let needsPush = it.hasAttribute(PAGE_BREAK_ATTR) || it.style.pageBreakBefore === "always"
    if (needsPush) {
      // Skip the fitting tests below; the decision is already made.
    } else if (isBlankLine) {
      needsPush = true    // it only reaches here having outgrown the page
    } else if (table) {
      // Move the whole grid only when it both fits on a sheet AND doing so
      // wouldn't leave a hole bigger than MAX_ORPHAN_GAP_RATIO. Otherwise the
      // table stays put and is broken between its rows below, so requiring only
      // its FIRST row to clear the footer is the right test.
      const keepWhole =
        rowsHeight <= pageContentPx
        && footerLimit - top <= pageContentPx * MAX_ORPHAN_GAP_RATIO
      const mustClear = keepWhole ? rowsHeight : (rowHeights[0] ?? 0)
      needsPush = top + mustClear > footerLimit + 1
    } else if (top + height > footerLimit + 1) {
      let fitting = 0
      let y = top
      for (const line of lines) {
        if (y + line.height > footerLimit + 1) break
        y += line.height
        fitting++
      }
      needsPush = !(
        lines.length >= MIN_LINES_EITHER_SIDE * 2
        && fitting >= MIN_LINES_EITHER_SIDE
        && lines.length - fitting >= MIN_LINES_EITHER_SIDE
      )
    }

    if (needsPush && top > pageTop + 2) {
      page++
      const target = page * stride + topPx
      const delta = target - top
      if (delta > 0) {
        const base = parseFloat(getComputedStyle(it).marginTop) || 0
        it.setAttribute("data-pgb-base", it.style.marginTop || "")
        it.dataset.pgb = "1"
        it.style.marginTop = `${base + delta}px`

        // Adjacent block margins COLLAPSE: the gap between two paragraphs is
        // max(this margin-top, the previous one's margin-bottom), so writing a
        // margin of `delta` actually moves the block by `delta` minus the
        // neighbour's bottom margin — landing it ~8px high with the report
        // body's 0.5em spacing, which is enough to put its first line inside
        // the letterhead band it was moved to clear.
        //
        // The editor's decoration path converges out of this by re-measuring
        // over several passes; this one runs once, so it corrects itself here
        // by measuring where the block actually landed.
        const landed = it.getBoundingClientRect().top - wrapTop
        const residual = target - landed
        if (Math.abs(residual) > 0.5) it.style.marginTop = `${base + delta + residual}px`
        pushed = it.getBoundingClientRect().top - wrapTop - top
      }
    }

    if (!table || !rowEls.length) {
      // Line-level breaks, run whether or not the block was just pushed: a block
      // moved to the top of a fresh sheet can still be taller than one page.
      if (lines.length >= MIN_LINES_EITHER_SIDE * 2) {
        // Two phases on purpose. Inserting at (node, offset) SPLITS that text
        // node — the original keeps the text before the offset and the
        // remainder becomes a new node — so any later line recorded against the
        // same node would have an offset past its new end. Deciding every break
        // first (pure arithmetic, no DOM writes) and then applying them from the
        // last to the first means each insertion only ever splits text that no
        // remaining break refers to.
        const breaks: { node: Text; offset: number; spacer: number }[] = []
        let cursor = top + pushed
        for (let i = 0; i < lines.length; i++) {
          const { height: lh, node, offset } = lines[i]
          const lineFooter = page * stride + (pagePx - bottomPx)
          const linePageTop = page * stride + topPx
          if (
            i > 0 && cursor + lh > lineFooter + 1 && cursor > linePageTop + 2
            && i >= MIN_LINES_EITHER_SIDE && lines.length - i >= MIN_LINES_EITHER_SIDE
          ) {
            const spacer = Math.round((page + 1) * stride + topPx - cursor)
            if (spacer > 0) {
              page++
              breaks.push({ node, offset, spacer })
              cursor += spacer
            }
          }
          cursor += lh
        }

        const at = document.createRange()
        for (let i = breaks.length - 1; i >= 0; i--) {
          const { node, offset, spacer } = breaks[i]
          at.setStart(node, Math.min(offset, node.length))
          at.collapse(true)
          at.insertNode(buildPageSpacerInline(spacer))
        }
      }
      continue
    }

    // Split between rows. Never before the first row — a break there is just
    // "move the whole table", which the push above has already decided.
    const colspan = rowEls[0].cells.length || 1
    // Only a genuine header row (every cell a <th>) is reprinted on the
    // continuation sheet. Most of the clinic's grids are plain measurement rows
    // with no header at all, and copying their first row onto page two would
    // invent a heading that isn't in the document.
    const headerRow = isHeaderRow(rowEls[0]) ? rowEls[0] : null
    let cursor = top + pushed
    rowEls.forEach((row, i) => {
      const rowFooter = page * stride + (pagePx - bottomPx)
      const rowPageTop = page * stride + topPx
      if (i > 0 && cursor + rowHeights[i] > rowFooter + 1 && cursor > rowPageTop + 2) {
        const spacer = Math.round((page + 1) * stride + topPx - cursor)
        if (spacer > 0) {
          page++
          row.parentNode?.insertBefore(buildPageSpacerRow(spacer, colspan), row)
          cursor += spacer
          if (headerRow) {
            const repeat = buildRepeatedHeaderRow(headerRow)
            row.parentNode?.insertBefore(repeat, row)
            cursor += repeat.getBoundingClientRect().height
          }
        }
      }
      cursor += rowHeights[i]
    })
  }

  return page + 1
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
/* No paragraph gap of our own — see the same rule in globals.css. */
td.pg-content .doc-field p, td.pg-content .doc-field div, td.pg-content .body p, td.pg-content .body div{margin:0;}
/* Only a genuinely empty line reserves height — see the same rule in globals.css. */
td.pg-content .doc-field p:empty, td.pg-content .doc-field div:empty, td.pg-content .body p:empty, td.pg-content .body div:empty{min-height:1em;}
td.pg-content .doc-field p:empty::before, td.pg-content .doc-field div:empty::before, td.pg-content p:empty::before, td.pg-content div:empty::before{content:"\\00a0";visibility:hidden;}
td.pg-content .doc-field > :last-child, td.pg-content .body > :last-child{margin-bottom:0;}
/* Lists — the *{margin:0;padding:0} reset above strips the marker's indent, and
   a print window has no stylesheet to put it back, so a bullet list would print
   as unmarked paragraphs. Mirrors the ".doc-field ul/ol/li" rules in
   globals.css so screen, print and PDF agree. */
/* Headings from the Styles gallery. The *{margin:0} reset above would otherwise
   print a section heading flush against the paragraph before it, and the browser
   default sizes are gone with it (mirrors the ".doc-field h1/h2/h3" rules in
   globals.css). */
td.pg-content .doc-field h1, td.pg-content .doc-field h2, td.pg-content .doc-field h3, td.pg-content .body h1, td.pg-content .body h2, td.pg-content .body h3{margin:0.4em 0 0.25em;line-height:1.25;font-weight:bold;}
td.pg-content .doc-field h1, td.pg-content .body h1{font-size:1.25em;}
td.pg-content .doc-field h2, td.pg-content .body h2{font-size:1.1em;text-decoration:underline;}
td.pg-content .doc-field h3, td.pg-content .body h3{font-size:1em;font-style:italic;}
/* A table the doctor switched to "borders off" in the editor prints the same
   way (mirrors the [data-borderless] rule in globals.css). */
td.pg-content .doc-field table[data-borderless="1"] td, td.pg-content .doc-field table[data-borderless="1"] th{border-color:transparent;}
td.pg-content .doc-field ul, td.pg-content .body ul, td.pg-content .doc-field ol, td.pg-content .body ol{margin:0 0 0.5em;padding-left:1.6em;}
td.pg-content .doc-field ul, td.pg-content .body ul{list-style:disc outside;}
td.pg-content .doc-field ol, td.pg-content .body ol{list-style:decimal outside;}
td.pg-content .doc-field li, td.pg-content .body li{margin:0 0 0.15em;}
td.pg-content .doc-field li > p, td.pg-content .doc-field li > div, td.pg-content .body li > p, td.pg-content .body li > div{margin:0;min-height:0;}
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
td.pg-content .doc-field table{border-collapse:collapse;table-layout:fixed;width:100%;max-width:100%;margin:8px 0;}
/* Cell padding in em (== the editor's rule in globals.css): a table the doctor
   scaled down to fit one page carries its scale as a font-size on the table
   element itself, so anything sized in px here would stay full size on paper and
   the printed table would come out taller than the page it was fitted to.
   (No backticks in this block — see the note further down: the whole stylesheet
   is one template literal.) */
td.pg-content .doc-field table td, td.pg-content .doc-field table th{border:1px solid #9ca3af;padding:0.1875em 0.375em;vertical-align:middle;overflow-wrap:break-word;word-break:break-word;}
td.pg-content .doc-field table p, td.pg-content .doc-field table div{margin:0 !important;min-height:0 !important;line-height:1.25;}
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
/* Page numbers. The obvious CSS answer — @page margin boxes with
   content:counter(page) — is unusable: no shipping browser implements them, and
   @page{margin:0} above (which the pre-printed letterhead needs) would disable
   them anyway. So each number is placed absolutely at a computed offset from the
   top of the document instead, which is exact because every sheet is exactly one
   A4 height with no browser margin.
   They sit in the TOP few mm of the reserved footer band: the band is left blank
   for the clinic's pre-printed address, and the top edge of it is the one strip
   that is both out of the body text's way and clear of the printed masthead. */
.pg-num{position:absolute;left:0;right:0;text-align:center;font-size:9pt;color:#374151;pointer-events:none;}
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

const A4_HEIGHT_MM = 297

/**
 * "Page N of M" for every sheet, absolutely positioned into the top of each
 * sheet's reserved footer band. See the .pg-num rule in printShellCss for why
 * this is done with arithmetic rather than CSS page counters.
 *
 * `pageCount` comes from paginateDomBlocks(), so the printed numbering always
 * agrees with the pagination the editor previewed — deriving it here
 * independently would be a second source of truth for how many sheets a report
 * takes, and the two would drift.
 */
export function pageNumbersHtml(pageCount: number, bottomMm: number = LETTERHEAD_BOTTOM_MM): string {
  if (!Number.isFinite(pageCount) || pageCount < 2) return ""
  const parts: string[] = []
  for (let i = 0; i < pageCount; i++) {
    const top = i * A4_HEIGHT_MM + (A4_HEIGHT_MM - bottomMm) + 2
    parts.push(`<div class="pg-num" style="top:${top}mm;">Page ${i + 1} of ${pageCount}</div>`)
  }
  return parts.join("")
}

export function printShellHtml(
  title: string,
  innerHtml: string,
  extraCss = "",
  topMm: number = LETTERHEAD_TOP_MM,
  bottomMm: number = LETTERHEAD_BOTTOM_MM,
  pageCount = 0,
): string {
  const numbers = pageNumbersHtml(pageCount, bottomMm)
  // A print window is written into about:blank and loads none of the app's CSS,
  // so the report's fonts have to travel with the HTML — with absolute URLs,
  // since a root-relative "/fonts/..." has no origin to resolve against there.
  const fontCss = reportFontFaceCss(typeof window !== "undefined" ? window.location.origin : "")
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>${fontCss}\n${printShellCss(topMm, bottomMm)}${extraCss ? `\n${extraCss}` : ""}</style>
</head><body${numbers ? ` style="position:relative;"` : ""}>
<table class="pg">
<thead class="pg-head"><tr><td></td></tr></thead>
<tbody><tr><td class="pg-content">
${innerHtml}
</td></tr></tbody>
<tfoot class="pg-foot"><tr><td></td></tr></tfoot>
</table>
${numbers}
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
