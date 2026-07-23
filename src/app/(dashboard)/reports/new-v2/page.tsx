"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { PmReportEditor } from "@/components/pm-report-editor"

// Standalone comparison page — not linked from the sidebar, not wired to
// patient data, submit, DOCX export, or pagination. Exists only to test-drive
// ProseMirror against the current contentEditable-based report editor at
// reports/new/page.tsx, without touching that file or its behavior at all.
export default function ReportEditorV2Page() {
  const [html, setHtml] = useState("")

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/reports/new" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="h-4 w-4" /> Back to current editor
      </Link>

      <h1 className="text-lg font-semibold text-gray-900 mb-1">ProseMirror report editor — prototype</h1>
      <p className="text-sm text-gray-500 mb-5 max-w-2xl">
        Try bold/italic/underline, fonts, and dragging/resizing the signature stamp.
        The panel below shows the live HTML it produces — the same plain-HTML-string
        format the app already stores as <code>reportBody</code>, so nothing about
        storage, printing, or DOCX export would need to change if this replaced the
        current editor.
      </p>

      <PmReportEditor onChangeHtml={setHtml} />

      <div className="mt-6">
        <h2 className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Live HTML output</h2>
        <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap text-gray-700">
{html || "(start typing above)"}
        </pre>
      </div>

      <div className="mt-6 text-xs text-gray-500 space-y-1.5 border-t border-gray-200 pt-4">
        <p><strong>Not built in this prototype (by design, to keep it comparable):</strong></p>
        <p>• Track changes — free open-source path is <code>prosemirror-changeset</code> rather than Tiptap&apos;s paid add-on.</p>
        <p>• A4 pagination — the app&apos;s existing MutationObserver/ResizeObserver engine measures rendered DOM, not editor internals, so it can be reused as-is against this editor&apos;s output.</p>
        <p>• DOCX/PDF export — already works off the HTML string today; would keep working unmodified.</p>
      </div>
    </div>
  )
}
