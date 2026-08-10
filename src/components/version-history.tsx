"use client"

import { useEffect, useState } from "react"
import { History, Loader2, RotateCcw, X } from "lucide-react"

export type ReportVersion = { editor: string; editedAt: string; body: string }

/**
 * Earlier saves of this report, newest first.
 *
 * The store is the study's existing `editHistory` array — the same one the
 * submit flow already writes an entry to — so this is a reader for something the
 * clinic has been recording all along, plus the autosave that now feeds it.
 */
export function VersionHistory({
  patientId,
  studyIndex,
  currentBody,
  onRestore,
  onClose,
}: {
  patientId: string
  studyIndex: number
  currentBody: string
  onRestore: (body: string) => void
  onClose: () => void
}) {
  const [versions, setVersions] = useState<ReportVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<ReportVersion | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/patients/${patientId}`)
        const data = await res.json()
        const study = data?.patient?.studies?.[studyIndex]
        const list: ReportVersion[] = (study?.editHistory ?? []).filter((v: ReportVersion) => v?.body)
        if (!cancelled) setVersions(list)
      } catch { /* offline — nothing to show */ }
      if (!cancelled) setLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [patientId, studyIndex])

  const when = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime())
      ? "—"
      : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
  }

  return (
    <aside className="flex w-full flex-col border-b border-gray-200 bg-white sm:w-[300px] sm:shrink-0 sm:border-b-0 sm:border-l">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
          <History className="h-4 w-4 text-blue-500" />Versions
        </p>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="flex items-center justify-center gap-1.5 py-8 text-[11px] text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin" />Loading…
          </p>
        ) : versions.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-gray-400">
            No earlier versions yet. One is kept each time the report is autosaved after a change.
          </p>
        ) : (
          <div className="space-y-2">
            {versions.map((v, i) => (
              <div key={`${v.editedAt}-${i}`} className="rounded-lg border border-gray-200 p-2">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-medium text-gray-800">{when(v.editedAt)}</p>
                    <p className="truncate text-[10px] text-gray-400">{v.editor || "—"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      title="Preview this version"
                      onMouseDown={(e) => { e.preventDefault(); setPreview(preview === v ? null : v) }}
                      className="rounded px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100"
                    >
                      {preview === v ? "Hide" : "View"}
                    </button>
                    <button
                      type="button"
                      title="Replace the report with this version"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        if (v.body !== currentBody) onRestore(v.body)
                      }}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
                    >
                      <RotateCcw className="h-3 w-3" />Restore
                    </button>
                  </div>
                </div>

                {preview === v && (
                  <div
                    className="mt-2 max-h-48 overflow-y-auto rounded border border-gray-100 bg-gray-50 p-2 text-[11px] leading-snug text-gray-600"
                    // Read-only preview of the doctor's own saved report HTML.
                    dangerouslySetInnerHTML={{ __html: v.body }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
