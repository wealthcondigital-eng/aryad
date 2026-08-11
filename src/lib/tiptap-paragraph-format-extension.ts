import { Extension } from "@tiptap/core"
import { PAGE_BREAK_ATTR } from "@/lib/report-layout"
import { cssLengthToPx } from "@/lib/css-length"

// Word's Paragraph dialog, as node attributes on the report body's paragraphs:
// left indent, first-line indent, space before/after, and "page break before".
//
// All four are rendered as plain inline styles (plus one data attribute for the
// break), which is the whole point: the print window, the PDF host, the view
// modal and the DOCX exporter all read the same body HTML, so a paragraph
// indented on screen is indented everywhere without any of them knowing this
// extension exists. Modelled on LineHeight in this folder — a paragraph
// property has to be a node attribute, never an inline mark.

/** One press of the indent button, in px (0.5" at the report's 96dpi basis). */
export const INDENT_STEP_PX = 48
export const MAX_INDENT_PX = INDENT_STEP_PX * 8

// The attribute name itself lives in report-layout.ts, with the other markers
// every paginator has to recognise (the editor's, the PDF's and print's).
export { PAGE_BREAK_ATTR } from "@/lib/report-layout"

/**
 * A CSS length in px, or null when the property simply isn't set.
 *
 * ZERO IS A VALUE, not "unset". Word writes "space after: 0" on the paragraphs
 * of a tight document, and an imported template that dropped those zeroes fell
 * back to this editor's own 0.5em paragraph gap — every line of an imported
 * report drifting half a line further down the page than the Word original.
 */
const px = cssLengthToPx

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setParagraphFormat: (attrs: Record<string, unknown>) => ReturnType
      changeParagraphIndent: (delta: number) => ReturnType
      togglePageBreakBefore: () => ReturnType
    }
  }
}

export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",

  addOptions() {
    return { types: ["paragraph"] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: null,
            parseHTML: (el: HTMLElement) => px(el.style.marginLeft || el.style.marginInlineStart),
            renderHTML: (attrs: { indent?: number | null }) =>
              attrs.indent != null ? { style: `margin-left: ${attrs.indent}px` } : {},
          },
          indentRight: {
            default: null,
            parseHTML: (el: HTMLElement) => px(el.style.marginRight || el.style.marginInlineEnd),
            renderHTML: (attrs: { indentRight?: number | null }) =>
              attrs.indentRight != null ? { style: `margin-right: ${attrs.indentRight}px` } : {},
          },
          firstLineIndent: {
            default: null,
            parseHTML: (el: HTMLElement) => px(el.style.textIndent),
            renderHTML: (attrs: { firstLineIndent?: number | null }) =>
              attrs.firstLineIndent != null ? { style: `text-indent: ${attrs.firstLineIndent}px` } : {},
          },
          spaceBefore: {
            default: null,
            parseHTML: (el: HTMLElement) => px(el.style.marginTop),
            renderHTML: (attrs: { spaceBefore?: number | null }) =>
              attrs.spaceBefore != null ? { style: `margin-top: ${attrs.spaceBefore}px` } : {},
          },
          spaceAfter: {
            default: null,
            parseHTML: (el: HTMLElement) => px(el.style.marginBottom),
            renderHTML: (attrs: { spaceAfter?: number | null }) =>
              attrs.spaceAfter != null ? { style: `margin-bottom: ${attrs.spaceAfter}px` } : {},
          },
          // The attribute is what the editor's pagination reads (it pushes the
          // paragraph to the next sheet itself, since the report is laid out as
          // one continuous column of A4 backdrops rather than real pages); the
          // CSS property alongside it is what the print window obeys.
          pageBreakBefore: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              el.hasAttribute(PAGE_BREAK_ATTR) || el.style.pageBreakBefore === "always" ? true : null,
            renderHTML: (attrs: { pageBreakBefore?: boolean | null }) =>
              attrs.pageBreakBefore
                ? { [PAGE_BREAK_ATTR]: "1", style: "page-break-before: always; break-before: page" }
                : {},
          },
        },
      },
    ]
  },

  addCommands() {
    const each = (
      run: (type: string) => boolean,
    ) => this.options.types.map(run).every(Boolean)

    return {
      setParagraphFormat:
        (attrs: Record<string, unknown>) =>
        ({ commands }) => each((type: string) => commands.updateAttributes(type, attrs)),

      /** Word's Increase/Decrease Indent, clamped to eight steps like Word's ruler. */
      changeParagraphIndent:
        (delta: number) =>
        ({ commands, editor }) => {
          const current = (editor.getAttributes("paragraph").indent as number) || 0
          const next = Math.max(0, Math.min(MAX_INDENT_PX, current + delta * INDENT_STEP_PX))
          return each((type: string) => commands.updateAttributes(type, { indent: next === 0 ? null : next }))
        },

      togglePageBreakBefore:
        () =>
        ({ commands, editor }) => {
          const on = !!editor.getAttributes("paragraph").pageBreakBefore
          return each((type: string) => commands.updateAttributes(type, { pageBreakBefore: on ? null : true }))
        },
    }
  },
})
