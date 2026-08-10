import { Mark, mergeAttributes } from "@tiptap/core"
import type { EditorState } from "@tiptap/pm/state"

// Word's comments: a note attached to a span of the report, for the doctor and
// the receptionist to talk about a finding without putting it in the report.
//
// The note text lives in the mark's own attributes, so a commented report is
// still just HTML — nothing to migrate, no second table to keep in step with
// the body, and a report that is copied or restored from a version brings its
// comments with it. Exports strip them (see stripComments).

export const COMMENT_MARK = "comment"

export interface ReportComment {
  id: string
  text: string
  author: string
  date: string
  from: number
  to: number
  /** The report text the comment is attached to, for the review pane. */
  quote: string
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comment: {
      addComment: (text: string, author: string) => ReturnType
      removeComment: (id: string) => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: COMMENT_MARK,
  inclusive: false,
  // Two comments can cover the same words (Word allows it); keeping them
  // separate marks rather than one merged range is what lets each be resolved
  // on its own.
  excludes: "",

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-comment-id"),
        renderHTML: (a: { id?: string }) => (a.id ? { "data-comment-id": a.id } : {}),
      },
      text: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-comment-text") ?? "",
        renderHTML: (a: { text?: string }) => (a.text ? { "data-comment-text": a.text } : {}),
      },
      author: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-comment-author") ?? "",
        renderHTML: (a: { author?: string }) => (a.author ? { "data-comment-author": a.author } : {}),
      },
      date: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-comment-date") ?? "",
        renderHTML: (a: { date?: string }) => (a.date ? { "data-comment-date": a.date } : {}),
      },
    }
  },

  parseHTML: () => [{ tag: "span[data-comment-id]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes), 0],

  addCommands() {
    return {
      addComment:
        (text: string, author: string) =>
        ({ state, chain }) => {
          if (state.selection.empty || !text.trim()) return false
          return chain()
            .setMark(COMMENT_MARK, {
              id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              text: text.trim(),
              author,
              date: new Date().toISOString(),
            })
            .run()
        },

      removeComment:
        (id: string) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.marks[COMMENT_MARK]
          let found = false
          state.doc.descendants((node, pos) => {
            if (!node.isText) return true
            const mark = node.marks.find((m) => m.type.name === COMMENT_MARK && m.attrs.id === id)
            if (mark) {
              tr.removeMark(pos, pos + node.nodeSize, mark)
              found = true
            }
            return true
          })
          if (found && dispatch) dispatch(tr)
          return found
        },
    }
  },
})

/** Every comment in the document, in document order, adjacent runs merged. */
export function listComments(state: EditorState): ReportComment[] {
  const byId = new Map<string, ReportComment>()
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const mark of node.marks) {
      if (mark.type.name !== COMMENT_MARK || !mark.attrs.id) continue
      const id = mark.attrs.id as string
      const existing = byId.get(id)
      if (existing) {
        existing.to = pos + node.nodeSize
        existing.quote += node.text ?? ""
      } else {
        byId.set(id, {
          id,
          text: (mark.attrs.text as string) ?? "",
          author: (mark.attrs.author as string) ?? "",
          date: (mark.attrs.date as string) ?? "",
          from: pos,
          to: pos + node.nodeSize,
          quote: node.text ?? "",
        })
      }
    }
    return true
  })
  return [...byId.values()].sort((a, b) => a.from - b.from)
}

/** Comment markup removed, text kept — for print, PDF, DOCX and the saved report. */
export function stripComments(html: string): string {
  if (typeof window === "undefined" || !html.includes("data-comment-id")) return html
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.querySelectorAll("[data-comment-id]").forEach((el) => {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  })
  return doc.body.innerHTML
}
