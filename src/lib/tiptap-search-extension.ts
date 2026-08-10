import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { EditorState, Transaction } from "@tiptap/pm/state"
import type { Node as PMNode } from "@tiptap/pm/model"

// Word's Find & Replace (Ctrl+F / Ctrl+H) for the report body.
//
// Matches are highlighted with decorations rather than by touching the document:
// searching must never dirty a report or land in its undo history. Only Replace
// writes, and it writes exactly one range at a time so a replace-all stays a
// single undo step.

export interface SearchMatch { from: number; to: number }

export interface SearchState {
  term: string
  matchCase: boolean
  matches: SearchMatch[]
  /** Index into `matches`, or -1 when there is no current match. */
  current: number
  decorations: DecorationSet
}

export const searchPluginKey = new PluginKey<SearchState>("reportSearch")

const EMPTY: SearchState = {
  term: "", matchCase: false, matches: [], current: -1, decorations: DecorationSet.empty,
}

/**
 * Every occurrence of `term` in the document's text blocks.
 *
 * Walks text nodes and maps offsets back to document positions, so a match is
 * found even when it spans several runs of different formatting — searching the
 * rendered string instead would return offsets no position could be built from.
 */
function findMatches(doc: PMNode, term: string, matchCase: boolean): SearchMatch[] {
  if (!term) return []
  const out: SearchMatch[] = []
  const needle = matchCase ? term : term.toLowerCase()

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // One string per block, with each child's start position remembered.
    let text = ""
    const spans: { start: number; docPos: number }[] = []
    node.forEach((child, offset) => {
      if (child.isText) {
        spans.push({ start: text.length, docPos: pos + 1 + offset })
        text += child.text ?? ""
      } else {
        // A non-text leaf (image, signature) still occupies a position, so it
        // must occupy one character here or every later offset would be wrong.
        spans.push({ start: text.length, docPos: pos + 1 + offset })
        text += "￼"
      }
    })

    const haystack = matchCase ? text : text.toLowerCase()
    let at = haystack.indexOf(needle)
    while (at !== -1) {
      const toDoc = (offset: number) => {
        let span = spans[0]
        for (const s of spans) { if (s.start <= offset) span = s; else break }
        return span ? span.docPos + (offset - span.start) : pos + 1 + offset
      }
      out.push({ from: toDoc(at), to: toDoc(at + needle.length - 1) + 1 })
      at = haystack.indexOf(needle, at + Math.max(1, needle.length))
    }
    return false
  })

  return out
}

function buildState(doc: PMNode, term: string, matchCase: boolean, current: number): SearchState {
  const matches = findMatches(doc, term, matchCase)
  const index = matches.length ? Math.max(0, Math.min(current, matches.length - 1)) : -1
  const decorations = DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, { class: i === index ? "search-match search-match-current" : "search-match" })
    ),
  )
  return { term, matchCase, matches, current: index, decorations }
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    reportSearch: {
      setSearchTerm: (term: string, matchCase?: boolean) => ReturnType
      goToMatch: (delta: number) => ReturnType
      replaceCurrentMatch: (replacement: string) => ReturnType
      replaceAllMatches: (replacement: string) => ReturnType
      clearSearch: () => ReturnType
    }
  }
}

/** The plugin's state, for a UI that wants the match count. */
export function getSearchState(state: EditorState): SearchState {
  return searchPluginKey.getState(state) ?? EMPTY
}

export const ReportSearch = Extension.create({
  name: "reportSearch",

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchPluginKey,
        state: {
          init: () => EMPTY,
          apply(tr: Transaction, value: SearchState, _old: EditorState, next: EditorState) {
            const meta = tr.getMeta(searchPluginKey) as
              | { term?: string; matchCase?: boolean; current?: number }
              | undefined
            // Re-run on an edit too: replacing text shifts every match after it,
            // and a stale highlight would point at the wrong words.
            if (!meta && !tr.docChanged) return value
            const term = meta?.term ?? value.term
            const matchCase = meta?.matchCase ?? value.matchCase
            const current = meta?.current ?? value.current
            if (!term) return { ...EMPTY, matchCase }
            return buildState(next.doc, term, matchCase, current)
          },
        },
        props: {
          decorations: (state) => searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ]
  },

  addCommands() {
    return {
      setSearchTerm:
        (term: string, matchCase = false) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchPluginKey, { term, matchCase, current: 0 }))
          return true
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(searchPluginKey, { term: "", current: -1 }))
          return true
        },

      goToMatch:
        (delta: number) =>
        ({ state, tr, dispatch }) => {
          const s = getSearchState(state)
          if (!s.matches.length) return false
          const next = (s.current + delta + s.matches.length) % s.matches.length
          if (dispatch) {
            const match = s.matches[next]
            dispatch(
              tr.setMeta(searchPluginKey, { current: next })
                .setSelection(TextSelection.create(tr.doc, match.from, match.to))
                .scrollIntoView()
            )
          }
          return true
        },

      replaceCurrentMatch:
        (replacement: string) =>
        ({ state, tr, dispatch }) => {
          const s = getSearchState(state)
          const match = s.matches[s.current]
          if (!match) return false
          if (dispatch) {
            dispatch(
              tr.insertText(replacement, match.from, match.to)
                // Keep the same ordinal: after the replace, the match that
                // shuffles into this slot is the next one to look at.
                .setMeta(searchPluginKey, { current: s.current })
            )
          }
          return true
        },

      replaceAllMatches:
        (replacement: string) =>
        ({ state, tr, dispatch }) => {
          const s = getSearchState(state)
          if (!s.matches.length) return false
          if (dispatch) {
            // Back to front: replacing forwards would invalidate every later
            // position as soon as the text length changed.
            for (let i = s.matches.length - 1; i >= 0; i--) {
              const m = s.matches[i]
              tr.insertText(replacement, m.from, m.to)
            }
            dispatch(tr.setMeta(searchPluginKey, { current: 0 }))
          }
          return true
        },
    }
  },
})
