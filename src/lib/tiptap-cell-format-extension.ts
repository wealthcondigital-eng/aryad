import { Extension } from "@tiptap/core"

// Word's Table Design/Layout tabs, reduced to what a clinic's grids need:
// cell shading, vertical alignment inside a cell, and a borderless table.
//
// Cell attributes are set through prosemirror-tables' own setCellAttribute
// command, which applies to every cell in the current selection — so shading a
// header means selecting it and clicking once, exactly like Word.
//
// As everywhere else in this folder, the values render as inline styles on the
// <td>/<th>/<table> so print, PDF and the view modal need no extra knowledge.

/** Marks a table whose cell borders are hidden (see globals.css). */
export const BORDERLESS_ATTR = "data-borderless"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    cellFormat: {
      setCellShading: (color: string | null) => ReturnType
      setCellVerticalAlign: (align: "top" | "middle" | "bottom" | null) => ReturnType
      toggleTableBorders: () => ReturnType
    }
  }
}

export const CellFormat = Extension.create({
  name: "cellFormat",

  addGlobalAttributes() {
    return [
      {
        types: ["tableCell", "tableHeader"],
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              el.style.backgroundColor || el.getAttribute("bgcolor") || null,
            renderHTML: (attrs: { backgroundColor?: string | null }) =>
              attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {},
          },
          verticalAlign: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.verticalAlign || null,
            renderHTML: (attrs: { verticalAlign?: string | null }) =>
              attrs.verticalAlign ? { style: `vertical-align: ${attrs.verticalAlign}` } : {},
          },
        },
      },
      {
        types: ["table"],
        attributes: {
          borderless: {
            default: null,
            parseHTML: (el: HTMLElement) => (el.hasAttribute(BORDERLESS_ATTR) ? true : null),
            renderHTML: (attrs: { borderless?: boolean | null }) =>
              attrs.borderless ? { [BORDERLESS_ATTR]: "1" } : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setCellShading:
        (color: string | null) =>
        ({ commands }) => commands.setCellAttribute("backgroundColor", color),

      setCellVerticalAlign:
        (align: "top" | "middle" | "bottom" | null) =>
        ({ commands }) => commands.setCellAttribute("verticalAlign", align),

      toggleTableBorders:
        () =>
        ({ commands, editor }) =>
          commands.updateAttributes("table", { borderless: editor.getAttributes("table").borderless ? null : true }),
    }
  },
})
