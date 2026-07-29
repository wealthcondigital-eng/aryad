import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { EditorView } from "@tiptap/pm/view"

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
  const found = prev.find(from, to)
  const spec = found[0]?.spec as { pgbMargin?: number } | undefined
  return spec?.pgbMargin ?? 0
}

export function computeBodyPageDecorations(view: EditorView, opts: PageBreakOpts): PageBreakResult {
  const { wrapTop, stride, a4PagePx, letterheadTopPx, letterheadBottomPx } = opts
  const prevSet = paginationPluginKey.getState(view.state) ?? DecorationSet.empty

  let page = opts.entryPage
  let exitBottomPx = opts.entryTopPx
  const decorations: Decoration[] = []
  const sigParts: string[] = []

  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset)
    if (!(dom instanceof HTMLElement)) return

    const rect = dom.getBoundingClientRect()
    const decoratedMargin = previousMargin(prevSet, offset, offset + node.nodeSize)
    const naturalTop = rect.top - wrapTop - decoratedMargin
    const naturalBottom = naturalTop + rect.height

    const footerLimit = page * stride + (a4PagePx - letterheadBottomPx)
    const pageTop = page * stride + letterheadTopPx

    let margin = 0
    if (naturalBottom > footerLimit + 1 && naturalTop > pageTop + 2) {
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

    exitBottomPx = naturalBottom + margin
  })

  return {
    decorationSet: DecorationSet.create(view.state.doc, decorations),
    exitPage: page,
    exitBottomPx,
    signature: sigParts.join("|"),
  }
}
