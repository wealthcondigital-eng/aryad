import { Extension } from "@tiptap/core"

// Tiptap's own @tiptap/extension-text-style LineHeight has a real bug: its
// `types` option (documented example: `['heading', 'paragraph']`) only
// affects where the attribute can be *parsed from* — the setLineHeight/
// unsetLineHeight commands are hardcoded to `chain().setMark("textStyle",
// {lineHeight})` regardless of that option, i.e. always an inline mark, never
// a per-paragraph node attribute. That's why line spacing looked
// inconsistent: Word-style line spacing is a paragraph property, and
// TextAlign's own setTextAlign (which correctly uses
// `commands.updateAttributes(type, {...})`) is the pattern this should
// follow instead. This is a drop-in replacement with the same attribute
// shape/parsing but a command that actually updates the paragraph node.
export const LineHeight = Extension.create({
  name: "lineHeight",

  addOptions() {
    return { types: ["paragraph"] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.lineHeight || null,
            renderHTML: (attributes: { lineHeight?: string | null }) => {
              if (!attributes.lineHeight) return {}
              return { style: `line-height: ${attributes.lineHeight}` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight: string) =>
        ({ commands }) => {
          return this.options.types
            .map((type: string) => commands.updateAttributes(type, { lineHeight }))
            .every(Boolean)
        },
      unsetLineHeight:
        () =>
        ({ commands }) => {
          return this.options.types
            .map((type: string) => commands.updateAttributes(type, { lineHeight: null }))
            .every(Boolean)
        },
    }
  },
})
