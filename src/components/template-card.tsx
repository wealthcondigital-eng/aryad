"use client"

// One template in a picker: category badge, a "Custom" badge for clinic-added
// ones, the name, and a two-line preview of the body.
//
// Extracted from the built-in report editor so the Word editor's picker is the
// same component rather than a lookalike — the two pickers sit one click apart
// and any drift between them reads as a bug.

import type { ReportTemplate } from "@/lib/report-templates"

// Short display names for the four bundled categories. Clinic-created
// categories are free-form strings and are shown exactly as typed.
const BUILT_IN_TAB_LABEL: Record<string, string> = {
  usg: "USG", doppler: "Doppler", xray: "X-Ray", pathology: "Pathology", obstetric: "Obstetric USG",
}
// A category the clinic typed keeps its own casing ("MRI", "CT Scan"); one
// created in lower case by a bulk import reads better capitalised.
export const prettyCategory = (cat: string) =>
  cat === cat.toLowerCase() ? cat.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : cat

export const categoryTabLabel = (cat: string) => BUILT_IN_TAB_LABEL[cat] ?? prettyCategory(cat)

export function TemplateCard({
  tpl,
  categoryLabel,
  onApply,
}: {
  tpl: ReportTemplate
  categoryLabel?: string
  onApply: () => void
}) {
  return (
    <button
      type="button"
      onClick={onApply}
      className="group w-full text-left p-3.5 rounded-xl border border-gray-200 hover:border-blue-400 hover:shadow-sm bg-white transition-all"
    >
      <div className="flex items-center gap-1.5 flex-wrap mb-1">
        {categoryLabel && (
          <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{categoryLabel}</span>
        )}
        {tpl._id && (
          <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">Custom</span>
        )}
      </div>
      <p className="text-xs font-semibold text-gray-800 group-hover:text-blue-600 leading-snug line-clamp-2">
        {tpl.name}
      </p>
      <p className="text-[11px] text-gray-400 mt-1 leading-relaxed line-clamp-2">
        {tpl.preview}
      </p>
    </button>
  )
}
