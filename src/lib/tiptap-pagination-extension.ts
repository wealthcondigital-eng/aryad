import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { EditorView } from "@tiptap/pm/view"
import type { Node as PMNode } from "@tiptap/pm/model"
import { reportTableRows, buildPageSpacerRow } from "@/lib/report-layout"

// Same A4 footer-band-overflow algorithm the app's existing paginate()
// (reports/new/page.tsx) already uses for the patient box / heading /
// signature block — but for the report body specifically, page-break spacing
// is applied as ProseMirror Decorations instead of a direct `style.marginTop`
// write. A raw style write on a node ProseMirror renders can be silently
// dropped whenever ProseMirror redraws that node (typing near it, any
// transaction touching it) since the write isn't part of the document or its
// render pipeline. Decorations go through ProseMirror's own render cycle, so
// they're reapplied deterministically instead of just hoping the DOM node
// that got a manual style write is still the same DOM node next render.

export const paginationPluginKey = new PluginKey<DecorationSet>("reportPagination")

export function createPaginationPlugin() {
  return new Plugin<DecorationSet>({
    key: paginationPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        const meta = tr.getMeta(paginationPluginKey)
        if (meta !== undefined) return meta as DecorationSet
        // No explicit update this transaction — just map existing decorations
        // through whatever edit happened (typing before/after a paginated block).
        return old.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations(state) {
        return paginationPluginKey.getState(state) ?? DecorationSet.empty
      },
    },
  })
}

export const PaginationExtension = Extension.create({
  name: "reportPagination",
  addProseMirrorPlugins() {
    return [createPaginationPlugin()]
  },
})

export interface PageBreakOpts {
  wrapTop: number
  entryPage: number
  entryTopPx: number
  stride: number
  a4PagePx: number
  letterheadTopPx: number
  letterheadBottomPx: number
}

// ── Page breaks INSIDE a table ───────────────────────────────────────────────
// A margin-top push can only ever move a whole block, which is enough for a
// paragraph but not for a table: a biometry grid taller than one page's content
// area has nowhere to be pushed to, so it used to run straight through the
// letterhead footer band and across the gap onto the next sheet — exactly what
// the printed page can't do (paper splits tables between rows).
//
// So a table that can't fit on one page is broken between its rows instead, by
// decorating the row that has to start the next sheet with a zero-content
// spacer <tr> tall enough to carry the caret past the footer band, the sheet
// gap and the next sheet's header band. A widget decoration is used rather than
// a style write for the same reason the margins are decorations (see above):
// it goes through ProseMirror's render cycle, and — being a decoration — it
// never becomes part of the document, so editor.getHTML(), the DOCX export and
// the print window stay completely unaware of it.
// The spacer-row mechanics are shared with the two plain-HTML views of a report
// (the view modal and the shared-PDF builder, via paginateDomBlocks) so all
// three break a long table in the same places — see report-layout.ts.
export { PAGE_SPACER_ROW_ATTR, isPageSpacerRow } from "@/lib/report-layout"

/** A table's own rows, page-break spacers skipped. See reportTableRows. */
export const tableBodyRows = reportTableRows

function buildSpacerRow(height: number, colspan: number): HTMLElement {
  const tr = buildPageSpacerRow(height, colspan)
  // Editor-only: the spacer is not part of the document, so the caret must not
  // be able to land in it.
  tr.setAttribute("contenteditable", "false")
  return tr
}

export interface PageBreakResult {
  decorationSet: DecorationSet
  exitPage: number
  exitBottomPx: number
  /**
   * Fingerprint of the margins this pass decided on. A single pass cannot be
   * trusted on its own: every node is measured against a DOM that still
   * reflects the PREVIOUS pass's margins, so the moment one node's push
   * changes, every node after it was measured from a stale position. The
   * caller re-runs until two consecutive passes produce the same fingerprint
   * (see paginate()) — that's the point at which measurements and applied
   * margins finally agree.
   */
  signature: string
}

// Reads how much margin-top WE previously decorated this exact node with
// (if any), so this pass can measure the node's natural, undecorated
// position without a DOM clear-then-reflow round trip — mirrors the
// original paginate()'s explicit "clear previous pushes before measuring"
// step, just computed arithmetically from the last DecorationSet instead.
function previousMargin(prev: DecorationSet, from: number, to: number): number {
  // Scanned rather than just reading found[0]: a split table's range also holds
  // this pass's in-table spacer widgets, and any one of them could come back
  // first — taking that one's (absent) margin would read as "never pushed" and
  // push the table a second time on the next pass.
  for (const deco of prev.find(from, to)) {
    const spec = deco.spec as { pgbMargin?: number } | undefined
    if (typeof spec?.pgbMargin === "number") return spec.pgbMargin
  }
  return 0
}

interface TableSplit {
  decorations: Decoration[]
  sigParts: string[]
  exitPage: number
  exitBottomPx: number
}

// Walks a table's rows from `tableTop`, opening a page-break spacer before any
// row that would otherwise be drawn over the footer band. Never breaks before
// the first row — a break there is just "move the whole table down", which the
// caller has already decided about.
function splitTableRows(
  tableNode: PMNode,
  tablePos: number,
  rowEls: HTMLTableRowElement[],
  tableTop: number,
  startPage: number,
  opts: PageBreakOpts,
): TableSplit {
  const { stride, a4PagePx, letterheadTopPx, letterheadBottomPx } = opts
  const decorations: Decoration[] = []
  const sigParts: string[] = []
  const colspan = tableNode.firstChild?.childCount ?? 1
  let page = startPage
  let cursor = tableTop

  tableNode.forEach((_rowNode, offset, index) => {
    const el = rowEls[index]
    if (!el) return
    const rowPos = tablePos + 1 + offset
    const height = el.getBoundingClientRect().height
    const footerLimit = page * stride + (a4PagePx - letterheadBottomPx)
    const pageTop = page * stride + letterheadTopPx

    if (index > 0 && cursor + height > footerLimit + 1 && cursor > pageTop + 2) {
      page++
      const spacer = Math.round(page * stride + letterheadTopPx - cursor)
      if (spacer > 0) {
        decorations.push(
          Decoration.widget(rowPos, () => buildSpacerRow(spacer, colspan), {
            // Keyed by position+height so an unchanged break reuses its DOM
            // node instead of being torn down and rebuilt every pass.
            key: `pgb-row-${rowPos}-${spacer}`,
            side: -1,
            ignoreSelection: true,
            stopEvent: () => true,
          })
        )
        sigParts.push(`r${rowPos}:${spacer}`)
        cursor += spacer
      }
    }
    cursor += height
  })

  return { decorations, sigParts, exitPage: page, exitBottomPx: cursor }
}

export function computeBodyPageDecorations(view: EditorView, opts: PageBreakOpts): PageBreakResult {
  const { wrapTop, stride, a4PagePx, letterheadTopPx, letterheadBottomPx } = opts
  const prevSet = paginationPluginKey.getState(view.state) ?? DecorationSet.empty

  let page = opts.entryPage
  let exitBottomPx = opts.entryTopPx
  const decorations: Decoration[] = []
  const sigParts: string[] = []

  const pageContentPx = a4PagePx - letterheadTopPx - letterheadBottomPx

  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset)
    if (!(dom instanceof HTMLElement)) return

    const decoratedMargin = previousMargin(prevSet, offset, offset + node.nodeSize)

    // A table is measured from its rows, not from its wrapper's box: the
    // wrapper's height already includes any spacer rows the previous pass
    // opened inside it, and measuring that would read a split table as ever
    // taller and never settle.
    const tableEl = node.type.name === "table"
      ? (dom.tagName === "TABLE" ? (dom as HTMLTableElement) : dom.querySelector("table"))
      : null
    const rowEls = tableEl ? tableBodyRows(tableEl) : []
    const rowsHeight = rowEls.reduce((sum, r) => sum + r.getBoundingClientRect().height, 0)

    const rect = (tableEl ?? dom).getBoundingClientRect()
    const naturalTop = rect.top - wrapTop - decoratedMargin
    const naturalBottom = naturalTop + (tableEl ? rowsHeight : rect.height)

    const footerLimit = page * stride + (a4PagePx - letterheadBottomPx)
    const pageTop = page * stride + letterheadTopPx

    // What has to clear the footer band for this block to stay where it is.
    // For anything but a table that's the whole block. For a table that fits on
    // a page it's the whole table, so a grid is never split when it didn't have
    // to be. For a table too tall for any page it's just the FIRST ROW: the rest
    // will be split between rows below, but the row the table opens with still
    // has to start on a page that can hold it, or the table would begin by
    // painting over the band it was moved down to avoid.
    const firstRowHeight = rowEls[0]?.getBoundingClientRect().height ?? 0
    const mustClearFooter = !tableEl
      ? rect.height
      : rowsHeight <= pageContentPx ? rowsHeight : firstRowHeight

    let margin = 0
    if (naturalTop + mustClearFooter > footerLimit + 1 && naturalTop > pageTop + 2) {
      page++
      const target = page * stride + letterheadTopPx
      const delta = target - naturalTop
      if (delta > 0) margin = delta
    }

    if (margin > 0) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, { style: `margin-top:${margin}px` }, { pgbMargin: margin })
      )
      // Rounded: sub-pixel jitter in getBoundingClientRect would otherwise
      // keep the fingerprint changing forever and never let the caller settle.
      sigParts.push(`${offset}:${Math.round(margin)}`)
    }

    if (tableEl && rowEls.length) {
      const split = splitTableRows(node, offset, rowEls, naturalTop + margin, page, opts)
      decorations.push(...split.decorations)
      sigParts.push(...split.sigParts)
      page = split.exitPage
      exitBottomPx = split.exitBottomPx
      return
    }

    exitBottomPx = naturalBottom + margin
  })

  return {
    decorationSet: DecorationSet.create(view.state.doc, decorations),
    exitPage: page,
    exitBottomPx,
    signature: sigParts.join("|"),
  }
}
