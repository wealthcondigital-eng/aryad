"use client"

import { useEffect, useRef, useState } from "react"
import type { Editor } from "@tiptap/react"
import { X, ChevronUp, ChevronDown, Replace, CaseSensitive } from "lucide-react"
import { getSearchState } from "@/lib/tiptap-search-extension"

/**
 * Word's Find & Replace, as a panel docked under the toolbar.
 *
 * Opened with Ctrl+F (find) or Ctrl+H (find and replace) — both wired up by the
 * report page, which owns the open/closed state so the shortcuts work from
 * anywhere in the document, not only when this panel already has focus.
 */
export function FindReplacePanel({
  editor,
  mode,
  onClose,
}: {
  editor: Editor | null
  mode: "find" | "replace"
  onClose: () => void
}) {
  const [term, setTerm] = useState("")
  const [replacement, setReplacement] = useState("")
  const [matchCase, setMatchCase] = useState(false)
  const [stats, setStats] = useState({ count: 0, current: -1 })
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [mode])

  // Push the term into the plugin, and read the resulting match list back out.
  useEffect(() => {
    if (!editor) return
    editor.commands.setSearchTerm(term, matchCase)
    const sync = () => {
      const s = getSearchState(editor.state)
      setStats({ count: s.matches.length, current: s.current })
    }
    sync()
    editor.on("transaction", sync)
    return () => { editor.off("transaction", sync) }
  }, [editor, term, matchCase])

  // The highlights belong to the search, so they go when the panel does.
  useEffect(() => () => { editor?.commands.clearSearch() }, [editor])

  const step = (delta: number) => editor?.commands.goToMatch(delta)

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-blue-50/40 px-4 py-2 lg:px-6">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1) }
            if (e.key === "Escape") onClose()
          }}
          placeholder="Find"
          className="h-7 w-44 rounded border border-gray-200 bg-white px-2 text-[12px] focus:border-blue-400 focus:outline-none"
        />
        <span className="w-20 text-[11px] text-gray-500">
          {term ? (stats.count ? `${stats.current + 1} of ${stats.count}` : "No matches") : ""}
        </span>
        <button
          type="button" title="Previous match (Shift+Enter)"
          onMouseDown={(e) => { e.preventDefault(); step(-1) }}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-200"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button" title="Next match (Enter)"
          onMouseDown={(e) => { e.preventDefault(); step(1) }}
          className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-200"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        <button
          type="button" title="Match case"
          onMouseDown={(e) => { e.preventDefault(); setMatchCase((v) => !v) }}
          className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${matchCase ? "bg-blue-100 text-blue-700" : "text-gray-600 hover:bg-gray-200"
            }`}
        >
          <CaseSensitive className="h-3.5 w-3.5" />
        </button>
      </div>

      {mode === "replace" && (
        <div className="flex items-center gap-1">
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose() }}
            placeholder="Replace with"
            className="h-7 w-44 rounded border border-gray-200 bg-white px-2 text-[12px] focus:border-blue-400 focus:outline-none"
          />
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.commands.replaceCurrentMatch(replacement) }}
            className="flex h-7 items-center gap-1 rounded border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-700 hover:border-blue-300 hover:text-blue-600"
          >
            <Replace className="h-3 w-3" />Replace
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.commands.replaceAllMatches(replacement) }}
            className="flex h-7 items-center rounded border border-gray-200 bg-white px-2 text-[11px] font-medium text-gray-700 hover:border-blue-300 hover:text-blue-600"
          >
            Replace all
          </button>
        </div>
      )}

      <button
        type="button" title="Close (Esc)"
        onMouseDown={(e) => { e.preventDefault(); onClose() }}
        className="ml-auto flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
