"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Plus, Trash2, Loader2, Quote } from "lucide-react"

export type Phrase = { _id: string; name: string; body: string }

/**
 * Word's AutoText: stock sentences a doctor drops in at the caret rather than
 * retyping. Whole-report boilerplate stays in Templates — this is for the one
 * or two lines that recur inside a report ("No focal lesion is seen.").
 *
 * Phrases live on the server (see /api/phrases), so one written on the doctor's
 * machine is available on the receptionist's.
 */
export function QuickPhrases({
  onInsert,
  getSelectionHtml,
}: {
  onInsert: (html: string) => void
  /** The current selection, to seed "save as phrase". Empty when nothing is selected. */
  getSelectionHtml: () => { html: string; text: string }
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState<{ name: string; html: string } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/phrases")
      const data = await res.json()
      setPhrases(data.phrases ?? [])
    } catch { /* offline — the panel just shows what it has */ }
    setLoading(false)
  }

  const openPanel = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setAnchor({ left: Math.max(8, Math.min(r.left, window.innerWidth - 288)), top: r.bottom + 6 })
    setAdding(null)
    setOpen(true)
    void load()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const save = async () => {
    if (!adding?.name.trim() || !adding.html) return
    await fetch("/api/phrases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: adding.name.trim(), body: adding.html }),
    })
    setAdding(null)
    void load()
  }

  const remove = async (id: string) => {
    await fetch(`/api/phrases?id=${encodeURIComponent(id)}`, { method: "DELETE" })
    setPhrases((list) => list.filter((p) => p._id !== id))
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Quick phrases — stock sentences you can drop into any report"
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else openPanel() }}
        className={`h-7 shrink-0 px-2 flex items-center gap-1 rounded text-[11px] font-medium transition-colors ${open ? "bg-gray-200 text-blue-600" : "text-gray-700 hover:bg-gray-200"
          }`}
      >
        <Quote className="h-3.5 w-3.5" />Phrases
      </button>

      {open && anchor && createPortal(
        <div
          ref={panelRef}
          data-editor-popup=""
          style={{ left: anchor.left, top: anchor.top, width: 280 }}
          className="fixed z-50 rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quick phrases</p>
            <button
              type="button"
              title="Save the selected text as a phrase"
              onMouseDown={(e) => {
                e.preventDefault()
                const sel = getSelectionHtml()
                if (!sel.html) return
                setAdding({ name: sel.text.slice(0, 40), html: sel.html })
              }}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50"
            >
              <Plus className="h-3 w-3" />Add selection
            </button>
          </div>

          {adding && (
            <div className="border-b border-gray-100 bg-blue-50/50 px-3 py-2">
              <input
                autoFocus
                value={adding.name}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save() } }}
                placeholder="Name this phrase"
                className="h-7 w-full rounded border border-gray-200 px-2 text-[12px] focus:border-blue-400 focus:outline-none"
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setAdding(null) }}
                  className="rounded px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); void save() }}
                  className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto py-1">
            {loading ? (
              <p className="flex items-center justify-center gap-1.5 py-6 text-[11px] text-gray-400">
                <Loader2 className="h-3 w-3 animate-spin" />Loading…
              </p>
            ) : phrases.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11px] text-gray-400">
                No phrases yet. Select some text in the report and choose &ldquo;Add selection&rdquo;.
              </p>
            ) : (
              phrases.map((p) => (
                <div key={p._id} className="group flex items-center gap-1 px-1">
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); onInsert(p.body); setOpen(false) }}
                    className="flex-1 truncate rounded px-2 py-1.5 text-left text-[12px] text-gray-700 hover:bg-gray-100"
                    title={p.name}
                  >
                    {p.name}
                  </button>
                  <button
                    type="button"
                    title="Delete phrase"
                    onMouseDown={(e) => { e.preventDefault(); void remove(p._id) }}
                    className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
