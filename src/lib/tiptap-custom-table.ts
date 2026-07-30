import { Table } from "@tiptap/extension-table"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"

// Custom Tiptap Table extension that preserves the `width` attribute on `<table>`
// nodes (e.g. `style="width: 350px"` or `style="width: 50%"`).
//
// Standard `@tiptap/extension-table` defines no `width` attribute on table nodes,
// so any table-level width style in imported Word templates or saved report HTML
// was previously stripped out by ProseMirror's DOMParser, leaving the CSS rule
// `.doc-field table { width: 100% }` to force every table to 100% full width.
//
// This extension captures `style.width` / `width="..."` on parseHTML and renders
// `style="width: ..."` on renderHTML so custom/reduced table widths survive save,
// view modals, print, and DOCX generation.
//
// ── fontScale ────────────────────────────────────────────────────────────────
// It also carries the table's VERTICAL size, which needs a different mechanism
// entirely. A row's height in CSS is a minimum, never a maximum: once a row is
// as short as the text inside it, no height can shrink it further. So a doctor
// dragging a measurement grid smaller to pull the rest of the report onto one
// page could move the columns in (text just re-wraps) but the table would not
// get one pixel shorter vertically — the one direction they actually needed.
//
// Past that floor the table's own type scale is what gives: `fontScale` is a
// single 0.5–1 multiplier rendered as `font-size: <k>em` on the <table>, and
// because the cell padding (globals.css / printShellCss) is in em and the cell
// line-height is unitless, every vertical measurement inside the table follows
// it. The table shrinks proportionally, exactly like reducing the table's font
// size by hand in Word, and — being a plain inline style on the element — it
// looks the same in the editor, the view modal, the print window and the PDF
// without any of them knowing this extension exists.

export const TABLE_FONT_SCALE_MIN = 0.5

const SCALE_ATTR = "data-table-scale"

function clampScale(n: number): number {
  return Math.min(1, Math.max(TABLE_FONT_SCALE_MIN, n))
}

// Reads a scale back from either the attribute we write or, failing that, the
// `font-size: 72%` / `font-size: 0.72em` we render alongside it — so a report
// saved before this attribute existed (or one round-tripped through anything
// that keeps styles but drops data attributes) still comes back scaled.
function parseScale(element: HTMLElement): number | null {
  const raw = element.getAttribute(SCALE_ATTR)
  if (raw) {
    const n = parseFloat(raw)
    if (Number.isFinite(n) && n > 0 && n < 1) return clampScale(n)
  }
  const fs = element.style.fontSize
  if (fs) {
    const pct = fs.match(/^([\d.]+)%$/)
    if (pct) {
      const n = parseFloat(pct[1]) / 100
      if (Number.isFinite(n) && n > 0 && n < 1) return clampScale(n)
    }
    const em = fs.match(/^([\d.]+)em$/)
    if (em) {
      const n = parseFloat(em[1])
      if (Number.isFinite(n) && n > 0 && n < 1) return clampScale(n)
    }
  }
  return null
}

export const CustomTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const w = element.style.width || element.getAttribute("width") || ""
          return w.trim() || null
        },
        renderHTML: (attributes: { width?: string | null }) => {
          if (!attributes.width) return {}
          return { style: `width: ${attributes.width}` }
        },
      },
      fontScale: {
        default: null,
        parseHTML: parseScale,
        renderHTML: (attributes: { fontScale?: number | null }) => {
          const k = attributes.fontScale
          if (!k || k >= 1) return {}
          // Both: the style is what actually renders everywhere, the data
          // attribute is what parses back exactly (a font-size can be rewritten
          // or normalised by anything the HTML passes through).
          return { style: `font-size: ${k}em`, [SCALE_ATTR]: String(k) }
        },
      },
    }
  },

  // The editor renders tables through prosemirror-tables' TableView (a node
  // view), which builds the <table> element itself and only reads attributes
  // when it is first constructed — so the font-size above reaches saved HTML,
  // print and the view modal, but never the screen.
  //
  // This plugin closes that gap by syncing the style onto the live <table>
  // element after every update. Deliberately NOT a node decoration: a
  // decoration lands on the node's outer DOM (the .tableWrapper div), and since
  // `em` is relative to the inherited size, a wrapper at 0.5em with a table the
  // resize drag had just set to 0.7em rendered at 0.35 — the two multiplied
  // instead of one replacing the other. Writing the same property, in the same
  // place, from one source of truth can't do that.
  addProseMirrorPlugins() {
    const parent = this.parent?.() ?? []
    return [
      ...parent,
      new Plugin({
        key: new PluginKey("tableFontScale"),
        view: (editorView) => {
          const sync = (view: EditorView) => {
            view.state.doc.descendants((node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => {
              if (node.type.name !== "table") return
              const dom = view.nodeDOM(pos)
              const tableEl = dom instanceof HTMLElement
                ? (dom.tagName === "TABLE" ? dom : dom.querySelector("table"))
                : null
              if (tableEl instanceof HTMLElement) applyTableScaleToDom(tableEl, node.attrs.fontScale as number | null)
              return false   // no tables inside tables to look for
            })
          }
          sync(editorView)
          return { update: sync }
        },
      }),
    ]
  },
})

/**
 * Puts a table's stored scale onto its live element — the one write path the
 * editor uses, shared with the resize drag so the two can never disagree.
 * `null`/1 clears it, which is what makes the table full size again.
 */
export function applyTableScaleToDom(tableEl: HTMLElement, scale: number | null | undefined): void {
  const k = scale && scale < 1 ? clampScale(scale) : null
  const want = k ? `${k}em` : ""
  if (tableEl.style.fontSize !== want) tableEl.style.fontSize = want
  if (k) tableEl.setAttribute(SCALE_ATTR, String(k))
  else tableEl.removeAttribute(SCALE_ATTR)
}
