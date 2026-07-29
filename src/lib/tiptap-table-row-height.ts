import TableRow from "@tiptap/extension-table-row"

// Row heights for report-body tables.
//
// prosemirror-tables (which Tiptap's Table extension wraps) ships a
// column-resize plugin and nothing at all for rows: cells carry a `colwidth`
// attribute, rows carry no height attribute, so dragging a table could only
// ever change its width. The clinic's Word measurement tables do set row
// heights though, and a doctor resizing a table expects both axes to move —
// this adds the missing half as a real node attribute so a height survives
// save/reload instead of being a DOM tweak that vanishes on the next open.
//
// Rendered as an inline `style="height:Npx"` on the <tr> specifically because
// the report body is stored, printed and exported as a plain HTML string: an
// inline style needs no stylesheet to travel with it, so the same height shows
// up in the editor, the view modal, the print window and the PDF without any
// of them having to know this extension exists.
export const TableRowHeight = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        // Reads back both the inline style this writes and the legacy
        // `height="N"` attribute Word/mammoth-imported tables can carry, so an
        // imported table's own row heights are preserved rather than reset.
        parseHTML: (element: HTMLElement) => {
          const raw = element.style.height || element.getAttribute("height") || ""
          const n = parseInt(raw, 10)
          return Number.isFinite(n) && n > 0 ? n : null
        },
        renderHTML: (attributes: { height?: number | null }) => {
          if (!attributes.height) return {}
          return { style: `height:${attributes.height}px` }
        },
      },
    }
  },
})
