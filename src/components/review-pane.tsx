"use client"

import { useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"
import { Check, X, MessageSquare, Plus, Trash2 } from "lucide-react"
import { listTrackedChanges, type TrackedChange } from "@/lib/tiptap-track-changes-extension"
import { listComments, type ReportComment } from "@/lib/tiptap-comment-extension"

function when(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

/**
 * Word's Reviewing pane: every tracked change and every comment in the report,
 * with accept/reject and resolve.
 *
 * Both lists are derived from the document itself on each transaction — there is
 * no separate store to fall out of step with the text, which is the whole reason
 * changes and comments are marks rather than a side table.
 */
export function ReviewPane({
  editor,
  author,
  onClose,
}: {
  editor: Editor | null
  author: string
  onClose: () => void
}) {
  const [changes, setChanges] = useState<TrackedChange[]>([])
  const [comments, setComments] = useState<ReportComment[]>([])
  const [draft, setDraft] = useState("")

  useEffect(() => {
    if (!editor) return
    const sync = () => {
      setChanges(listTrackedChanges(editor.state))
      setComments(listComments(editor.state))
    }
    sync()
    editor.on("transaction", sync)
    return () => { editor.off("transaction", sync) }
  }, [editor])

  const select = (from: number, to: number) => {
    editor?.chain().focus().setTextSelection({ from, to }).scrollIntoView().run()
  }

  const resolveOne = (c: TrackedChange, accept: boolean) => {
    if (!editor) return
    editor.chain().focus().setTextSelection({ from: c.from, to: c.to })
      [accept ? "acceptChanges" : "rejectChanges"]("selection")
      .run()
  }

  return (
    <aside className="flex w-full flex-col border-b border-gray-200 bg-white sm:w-[300px] sm:shrink-0 sm:border-b-0 sm:border-l">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <p className="text-sm font-semibold text-gray-800">Review</p>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* ── Tracked changes ── */}
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Changes ({changes.length})
            </p>
            {changes.length > 0 && (
              <div className="flex gap-1">
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().acceptChanges("all").run() }}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-green-700 hover:bg-green-50"
                >
                  Accept all
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().rejectChanges("all").run() }}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50"
                >
                  Reject all
                </button>
              </div>
            )}
          </div>

          {changes.length === 0 ? (
            <p className="py-2 text-[11px] text-gray-400">No tracked changes.</p>
          ) : (
            <div className="space-y-1.5">
              {changes.map((c) => (
                <div
                  key={`${c.kind}-${c.from}`}
                  onMouseDown={(e) => { e.preventDefault(); select(c.from, c.to) }}
                  className="cursor-pointer rounded-lg border border-gray-200 p-2 transition-colors hover:border-blue-300"
                >
                  <div className="flex items-start gap-1.5">
                    <span className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-bold uppercase ${c.kind === "insert" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}>
                      {c.kind === "insert" ? "Added" : "Deleted"}
                    </span>
                    <p className={`min-w-0 flex-1 truncate text-[12px] ${c.kind === "delete" ? "text-gray-500 line-through" : "text-gray-800"}`}>
                      {c.text}
                    </p>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">{c.author}{c.date ? ` · ${when(c.date)}` : ""}</span>
                    <div className="flex gap-1">
                      <button
                        type="button" title="Accept"
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); resolveOne(c, true) }}
                        className="flex h-5 w-5 items-center justify-center rounded text-green-600 hover:bg-green-50"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        type="button" title="Reject"
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); resolveOne(c, false) }}
                        className="flex h-5 w-5 items-center justify-center rounded text-red-500 hover:bg-red-50"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Comments ── */}
        <div className="px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Comments ({comments.length})
          </p>

          <div className="mb-2 flex gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !draft.trim()) return
                e.preventDefault()
                editor?.chain().focus().addComment(draft, author).run()
                setDraft("")
              }}
              placeholder="Comment on the selected text"
              className="h-7 min-w-0 flex-1 rounded border border-gray-200 px-2 text-[12px] focus:border-blue-400 focus:outline-none"
            />
            <button
              type="button"
              title="Add comment to the selected text"
              onMouseDown={(e) => {
                e.preventDefault()
                if (!draft.trim()) return
                editor?.chain().focus().addComment(draft, author).run()
                setDraft("")
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {comments.length === 0 ? (
            <p className="py-2 text-[11px] text-gray-400">
              Select some text, type a note and press Enter.
            </p>
          ) : (
            <div className="space-y-1.5">
              {comments.map((c) => (
                <div
                  key={c.id}
                  onMouseDown={(e) => { e.preventDefault(); select(c.from, c.to) }}
                  className="cursor-pointer rounded-lg border border-amber-200 bg-amber-50/60 p-2 transition-colors hover:border-amber-400"
                >
                  <div className="flex items-start gap-1.5">
                    <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                    <p className="min-w-0 flex-1 text-[12px] text-gray-800">{c.text}</p>
                    <button
                      type="button" title="Resolve (remove comment)"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); editor?.chain().focus().removeComment(c.id).run() }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-white hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="mt-1 truncate text-[10px] italic text-gray-500">&ldquo;{c.quote}&rdquo;</p>
                  <p className="text-[10px] text-gray-400">{c.author}{c.date ? ` · ${when(c.date)}` : ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
