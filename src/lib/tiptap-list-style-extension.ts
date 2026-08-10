import { Extension } from "@tiptap/core"

// Word's "Bullets ▾" and "Numbering ▾" galleries: which marker a list draws,
// and where a numbered list starts counting.
//
// Rendered as an inline `list-style-type` (plus `start` for ordered lists) so
// the choice travels in the body HTML to print, the PDF and the view modal —
// the same reason every other formatting extension here renders to style rather
// than to a class.

export const BULLET_STYLES = ["disc", "circle", "square"] as const
export const ORDERED_STYLES = ["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"] as const

export type BulletStyle = (typeof BULLET_STYLES)[number]
export type OrderedStyle = (typeof ORDERED_STYLES)[number]

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    listStyle: {
      setListStyle: (style: string) => ReturnType
      /** Word's "Set Numbering Value" — restart at 1, or continue from n. */
      setListStart: (start: number) => ReturnType
    }
  }
}

export const ListStyle = Extension.create({
  name: "listStyle",

  addOptions() {
    return { types: ["bulletList", "orderedList"] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          listStyle: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.listStyleType || null,
            renderHTML: (attrs: { listStyle?: string | null }) =>
              attrs.listStyle ? { style: `list-style-type: ${attrs.listStyle}` } : {},
          },
        },
      },
      {
        types: ["orderedList"],
        attributes: {
          start: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const n = parseInt(el.getAttribute("start") ?? "", 10)
              return Number.isFinite(n) && n !== 1 ? n : null
            },
            renderHTML: (attrs: { start?: number | null }) =>
              attrs.start && attrs.start !== 1 ? { start: String(attrs.start) } : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setListStyle:
        (style: string) =>
        ({ commands, editor }) => {
          // Only the list the caret is actually in — updateAttributes on a type
          // the selection isn't inside is a silent no-op, so trying both is how
          // one command serves the bullet and the numbered gallery alike.
          const type = editor.isActive("orderedList") ? "orderedList" : "bulletList"
          return commands.updateAttributes(type, { listStyle: style })
        },

      setListStart:
        (start: number) =>
        ({ commands }) => commands.updateAttributes("orderedList", { start }),
    }
  },
})
