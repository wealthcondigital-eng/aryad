"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { LexicalReportEditor } from "@/components/lexical-report-editor"

// Standalone comparison page, same intent as reports/new-v2 (ProseMirror) —
// not linked from the sidebar, not wired to patient data, submit, DOCX export,
// or pagination. Exists only to test-drive Lexical against the current
// contentEditable-based report editor, without touching that file at all.
export default function ReportEditorV3Page() {
  const [html, setHtml] = useState("")

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/reports/new" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to current editor
      </Link>

      <h1 className="text-lg font-semibold text-gray-900 mb-1">Lexical report editor — prototype</h1>
      <p className="text-sm text-gray-500 mb-5 max-w-2xl">
        Same comparison as the ProseMirror prototype at <code>/reports/new-v2</code>, built with
        Meta&apos;s Lexical instead. Try bold/italic/underline, fonts, and dragging/resizing the
        signature stamp — the HTML panel below shows it produces the same plain-HTML-string shape
        the app already stores as <code>reportBody</code>.
      </p>

      <LexicalReportEditor onChangeHtml={setHtml} />

      <div className="mt-6">
        <h2 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Live HTML output</h2>
        <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap text-gray-700">
{html || "(start typing above)"}
        </pre>
      </div>

      <div className="mt-6 text-xs text-gray-500 space-y-1.5 border-t border-gray-200 pt-4">
        <p><strong>Not built in this prototype (by design, to keep it comparable):</strong></p>
        <p>• Track changes — Lexical has no built-in diffing; you&apos;d compare EditorState JSON snapshots yourself, similar effort to the app&apos;s current markChanges().</p>
        <p>• A4 pagination — the app&apos;s existing MutationObserver/ResizeObserver engine measures rendered DOM, not editor internals, so it can be reused as-is against this editor&apos;s output too.</p>
        <p>• DOCX/PDF export — already works off the HTML string today; would keep working unmodified.</p>
      </div>
    </div>
  )
}
