import { Extension, Mark, mergeAttributes } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import type { EditorState, Transaction } from "@tiptap/pm/state"

// Word's Track Changes for the report body: while it is on, what you type is
// kept as an insertion and what you delete is kept as a deletion, both attributed
// to whoever made them, until somebody accepts or rejects.
//
// ── Why deletions are marked rather than restored ────────────────────────────
// The obvious implementation — let the delete happen, then put the removed text
// back with a "deleted" mark — means re-deriving positions across every step of
// every transaction, and a mistake there does not show up as a wrong colour, it
// shows up as a corrupted report. So nothing is ever removed in the first place:
// Backspace, Delete, typing over a selection and pasting over one are all
// intercepted BEFORE they delete, and simply mark the range instead. The
// document only ever grows while tracking, which is the safe direction.
//
// Accept/reject then work purely on those marks:
//   accept → drop insertion marks, delete deletion-marked text
//   reject → delete insertion-marked text, drop deletion marks
//
// Exports never show the markup: readCleanBody() in the report editor accepts a
// copy of the document before handing it to print, PDF or DOCX.

export const INSERT_MARK = "trackInsert"
export const DELETE_MARK = "trackDelete"

export const trackChangesKey = new PluginKey<TrackState>("trackChanges")

/**
 * `date` is stamped once when tracking is switched on, not per keystroke: marks
 * whose attributes differ cannot merge, and a fresh timestamp per character
 * produced one <span> per letter typed.
 */
type TrackState = { enabled: boolean; author: string; date: string }

type TrackAttrs = { author: string | null; date: string | null }

const attrSpec = {
  author: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-track-author"),
    renderHTML: (attrs: TrackAttrs) => (attrs.author ? { "data-track-author": attrs.author } : {}),
  },
  date: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute("data-track-date"),
    renderHTML: (attrs: TrackAttrs) => (attrs.date ? { "data-track-date": attrs.date } : {}),
  },
}

export const TrackInsertMark = Mark.create({
  name: INSERT_MARK,
  // Two people editing the same sentence should not have their insertions
  // merged into one attribution.
  inclusive: false,
  addAttributes: () => attrSpec,
  parseHTML: () => [{ tag: "span[data-track-insert]" }],
  renderHTML: ({ HTMLAttributes }) =>
    ["span", mergeAttributes(HTMLAttributes, { "data-track-insert": "1" }), 0],
})

export const TrackDeleteMark = Mark.create({
  name: DELETE_MARK,
  inclusive: false,
  addAttributes: () => attrSpec,
  parseHTML: () => [{ tag: "span[data-track-delete]" }],
  renderHTML: ({ HTMLAttributes }) =>
    ["span", mergeAttributes(HTMLAttributes, { "data-track-delete": "1" }), 0],
})

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    trackChanges: {
      setTrackChanges: (enabled: boolean, author?: string) => ReturnType
      /** Accept every change, or only those touching the selection. */
      acceptChanges: (scope?: "all" | "selection") => ReturnType
      rejectChanges: (scope?: "all" | "selection") => ReturnType
    }
  }
}

export function isTrackingChanges(state: EditorState): boolean {
  return trackChangesKey.getState(state)?.enabled ?? false
}

export interface TrackedChange {
  kind: "insert" | "delete"
  from: number
  to: number
  text: string
  author: string
  date: string
}

/** Every tracked change in the document, in document order — for the review pane. */
export function listTrackedChanges(state: EditorState): TrackedChange[] {
  const out: TrackedChange[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const mark of node.marks) {
      if (mark.type.name !== INSERT_MARK && mark.type.name !== DELETE_MARK) continue
      const kind = mark.type.name === INSERT_MARK ? "insert" : "delete"
      const last = out[out.length - 1]
      // Adjacent text nodes with the same mark are one change to a reader.
      if (last && last.kind === kind && last.to === pos && last.author === (mark.attrs.author ?? "")) {
        last.to = pos + node.nodeSize
        last.text += node.text ?? ""
      } else {
        out.push({
          kind,
          from: pos,
          to: pos + node.nodeSize,
          text: node.text ?? "",
          author: (mark.attrs.author as string) ?? "",
          date: (mark.attrs.date as string) ?? "",
        })
      }
    }
    return true
  })
  return out
}

/** Ranges carrying one of the two marks, newest position first. */
function markedRanges(state: EditorState, markName: string, from: number, to: number) {
  const ranges: { from: number; to: number }[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true
    if (!node.marks.some((m) => m.type.name === markName)) return true
    const start = Math.max(pos, from)
    const end = Math.min(pos + node.nodeSize, to)
    const last = ranges[ranges.length - 1]
    if (last && last.to === start) last.to = end
    else ranges.push({ from: start, to: end })
    return true
  })
  return ranges
}

/**
 * Applies accept/reject over a range: one of the two marks has its text deleted,
 * the other simply loses the mark.
 *
 * Deletions run last-to-first so that earlier ranges keep their positions —
 * removing text front-to-back would invalidate every range after the first.
 */
function resolveChanges(
  state: EditorState,
  tr: Transaction,
  from: number,
  to: number,
  deleteMark: string,
  keepMark: string,
): Transaction {
  for (const r of markedRanges(state, keepMark, from, to)) {
    tr.removeMark(r.from, r.to, state.schema.marks[keepMark])
  }
  const doomed = markedRanges(state, deleteMark, from, to)
  for (let i = doomed.length - 1; i >= 0; i--) {
    tr.delete(doomed[i].from, doomed[i].to)
  }
  return tr
}

export const TrackChanges = Extension.create({
  name: "trackChanges",

  addProseMirrorPlugins() {
    return [
      new Plugin<TrackState>({
        key: trackChangesKey,
        state: {
          init: () => ({ enabled: false, author: "", date: "" }),
          apply(tr, value) {
            const meta = tr.getMeta(trackChangesKey) as Partial<TrackState> | undefined
            if (!meta) return value
            return {
              enabled: meta.enabled ?? value.enabled,
              author: meta.author ?? value.author,
              date: meta.date ?? value.date,
            }
          },
        },

        // Newly typed text picks up the insertion mark here, after the fact:
        // this is the one direction that is safe to handle by inspecting what
        // changed, because nothing was removed to lose track of.
        appendTransaction(trs, oldState, newState) {
          const { enabled, author, date } = trackChangesKey.getState(newState) ?? { enabled: false, author: "", date: "" }
          if (!enabled) return null
          if (!trs.some((t) => t.docChanged)) return null
          if (trs.some((t) => t.getMeta(trackChangesKey) || t.getMeta("trackSkip"))) return null

          const insertMark = newState.schema.marks[INSERT_MARK]
          const deleteMark = newState.schema.marks[DELETE_MARK]
          if (!insertMark) return null

          const tr = newState.tr
          let touched = false

          for (const t of trs) {
            for (let i = 0; i < t.steps.length; i++) {
              const map = t.steps[i].getMap()
              map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                if (newEnd <= newStart) return
                // Map the inserted range through everything that happened after
                // this step, so it still points at the same text.
                const from = t.mapping.slice(i + 1).map(newStart, -1)
                const to = t.mapping.slice(i + 1).map(newEnd, 1)
                if (to <= from || to > tr.doc.content.size) return
                tr.addMark(from, to, insertMark.create({ author, date }))
                // Text typed straight after deleted text would otherwise inherit
                // the strike-through as well.
                if (deleteMark) tr.removeMark(from, to, deleteMark)
                touched = true
              })
            }
          }

          if (!touched) return null
          return tr.setMeta(trackChangesKey, { enabled, author, date }).setMeta("addToHistory", false)
        },

        props: {
          // ── The interception that keeps deletions from ever happening ──────
          handleKeyDown(view, event) {
            const { enabled, author, date } = trackChangesKey.getState(view.state) ?? { enabled: false, author: "", date: "" }
            if (!enabled) return false
            if (event.key !== "Backspace" && event.key !== "Delete") return false

            const { state } = view
            const mark = state.schema.marks[DELETE_MARK]
            if (!mark) return false
            const { from, to, empty } = state.selection

            if (!empty) {
              // The selection has to be resolved against tr.doc: addMark returns
              // a new document, and ProseMirror rejects a selection built on the
              // one before it ("Selection passed to setSelection must point at
              // the current document").
              const tr = state.tr
                .addMark(from, to, mark.create({ author, date }))
                .removeMark(from, to, state.schema.marks[INSERT_MARK])
              tr.setSelection(TextSelection.create(tr.doc, to))
              view.dispatch(tr.setMeta(trackChangesKey, { enabled, author }))
              return true
            }

            // Collapsed: mark the single character the key would have removed,
            // and step over it — so holding Backspace walks back through the
            // sentence marking as it goes, exactly like Word.
            const at = event.key === "Backspace" ? from - 1 : from
            if (at < 0 || at + 1 > state.doc.content.size) return false
            const $at = state.doc.resolve(Math.max(0, at))
            // Nothing to mark across a block boundary; let the default handle it
            // (joining two paragraphs is a structural edit, not a text deletion).
            if (!$at.parent.isTextblock) return false
            if (event.key === "Backspace" && $at.parentOffset === 0) return false

            const tr = state.tr
              .addMark(at, at + 1, mark.create({ author, date }))
              .removeMark(at, at + 1, state.schema.marks[INSERT_MARK])
            tr.setSelection(TextSelection.create(tr.doc, event.key === "Backspace" ? at : at + 1))
            view.dispatch(tr.setMeta(trackChangesKey, { enabled, author }))
            return true
          },

          // Typing over a selection deletes it first — so mark it and collapse,
          // then let the character land normally (appendTransaction marks it as
          // an insertion).
          handleTextInput(view, from, to) {
            const { enabled, author, date } = trackChangesKey.getState(view.state) ?? { enabled: false, author: "", date: "" }
            if (!enabled || from === to) return false
            const mark = view.state.schema.marks[DELETE_MARK]
            if (!mark) return false
            const tr = view.state.tr
              .addMark(from, to, mark.create({ author, date }))
              .removeMark(from, to, view.state.schema.marks[INSERT_MARK])
            tr.setSelection(TextSelection.create(tr.doc, to))
            view.dispatch(tr.setMeta(trackChangesKey, { enabled, author }))
            return false   // the character itself still goes in, now at the end
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setTrackChanges:
        (enabled: boolean, author = "") =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(tr.setMeta(trackChangesKey, { enabled, author, date: new Date().toISOString() }))
          }
          return true
        },

      acceptChanges:
        (scope: "all" | "selection" = "all") =>
        ({ state, tr, dispatch }) => {
          const from = scope === "all" ? 0 : state.selection.from
          const to = scope === "all" ? state.doc.content.size : state.selection.to
          if (dispatch) {
            dispatch(resolveChanges(state, tr, from, to, DELETE_MARK, INSERT_MARK)
              .setMeta(trackChangesKey, trackChangesKey.getState(state)))
          }
          return true
        },

      rejectChanges:
        (scope: "all" | "selection" = "all") =>
        ({ state, tr, dispatch }) => {
          const from = scope === "all" ? 0 : state.selection.from
          const to = scope === "all" ? state.doc.content.size : state.selection.to
          if (dispatch) {
            dispatch(resolveChanges(state, tr, from, to, INSERT_MARK, DELETE_MARK)
              .setMeta(trackChangesKey, trackChangesKey.getState(state)))
          }
          return true
        },
    }
  },
})

/**
 * The accepted text of a tracked document, as HTML — insertions kept without
 * their markup, deletions dropped. Everything that leaves the editor (print,
 * PDF, DOCX, the saved report) goes through this, so a reader never sees
 * revision marks unless they are looking at the editor itself.
 */
export function acceptTrackedHtml(html: string): string {
  if (typeof window === "undefined" || !html.includes("data-track-")) return html
  const doc = new DOMParser().parseFromString(html, "text/html")
  doc.querySelectorAll("[data-track-delete]").forEach((el) => el.remove())
  doc.querySelectorAll("[data-track-insert]").forEach((el) => {
    const parent = el.parentNode
    if (!parent) return
    while (el.firstChild) parent.insertBefore(el.firstChild, el)
    parent.removeChild(el)
  })
  return doc.body.innerHTML
}
