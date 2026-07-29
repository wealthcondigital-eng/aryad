"use client"

// Column definitions for the imported monthly register, shared by the import
// preview and the saved-month grid so what you check before saving is exactly
// what you get after. Order and labels mirror the Excel sheet's own columns.

import { ExcelColumn } from "@/components/excel-table"
import { RegisterRow } from "@/lib/xlsx-read"

// A saved row is an imported row plus the bookkeeping the server added
export interface SavedRegisterRow extends RegisterRow {
  _id?: string
  month?: string
  sourceType?: "excel" | "manual" | "system"
  patientId?: string
  studyIndex?: number
  importKey?: string
  sheetName?: string
  fileName?: string
  importedAt?: string
  importedBy?: string
}

// `sourceType` was added after the first rows were written, and the import key
// already encodes the origin — so derive it rather than trusting the field to be
// there. A row that carries a patientId is a patient mirror, whatever it says.
export function sourceTypeOf(r: SavedRegisterRow): "excel" | "manual" | "system" {
  if (r.sourceType) return r.sourceType
  const key = String(r.importKey ?? "")
  if (r.patientId || key.startsWith("sys::")) return "system"
  if (key.includes("::man::")) return "manual"
  return "excel"
}

export const SOURCE_LABEL: Record<string, string> = {
  excel:  "Excel sheet",
  manual: "Added here",
  system: "System entry",
}

const SOURCE_STYLE: Record<string, string> = {
  excel:  "bg-amber-50 text-amber-700 border-amber-200",
  manual: "bg-violet-50 text-violet-700 border-violet-200",
  system: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

export function fmtRegisterDate(iso: string | null | undefined) {
  if (!iso) return ""
  const d = new Date(iso)
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
}

const money = (v: number) => (v ? `₹${v.toLocaleString("en-IN")}` : "—")

// Per-column editing metadata, applied only when the sheet is opened for typing.
// `editValue` hands the editor the raw value (an ISO date, a bare number) rather
// than the formatted cell text, so what you type over is what was stored.
// `inputClass` mirrors each column's rendered typography, so a cell being typed
// into is indistinguishable from the saved cells around it.
const EDIT_SPEC: Record<string, Partial<ExcelColumn<SavedRegisterRow>>> = {
  srNo:          { inputType: "number", editValue: (r) => (r.srNo == null ? "" : String(r.srNo)) },
  date:          { inputType: "date",   editValue: (r) => (r.date ? String(r.date).slice(0, 10) : "") },
  name:          { inputClass: "font-semibold text-gray-900" },
  age:           { inputType: "number", editValue: (r) => (r.age == null ? "" : String(r.age)) },
  gender:        { options: ["M", "F", "Other"] },
  contact:       {},
  department:    {},
  investigation: {},
  referredBy:    { inputClass: "font-medium text-gray-800" },
  paymentType:   {},
  charges:       { inputType: "number", editValue: (r) => String(r.charges ?? "") },
  discount:      { inputType: "number", editValue: (r) => String(r.discount ?? "") },
  paid:          { inputType: "number", editValue: (r) => String(r.paid ?? "") },
  // Balance is deliberately absent: it is charges − discount − paid, recomputed on
  // every save. Letting it be typed meant a stray 0 could override the arithmetic
  // and leave a row claiming nothing was due.
  entryBy:       {},
}

// Distinct values already in use, offered as type-ahead per column
export type RegisterSuggestions = Partial<Record<string, string[]>>

export function registerColumns(
  opts: {
    withMonth?: boolean
    withSource?: boolean
    editable?: boolean
    suggestions?: RegisterSuggestions
  } = {}
): ExcelColumn<SavedRegisterRow>[] {
  const cols: ExcelColumn<SavedRegisterRow>[] = []

  if (opts.withSource) {
    cols.push({
      key: "sourceType", label: "Source", width: 104, align: "center",
      text: (r) => SOURCE_LABEL[sourceTypeOf(r)],
      render: (r) => {
        const s = sourceTypeOf(r)
        return (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${SOURCE_STYLE[s]}`}>
            {SOURCE_LABEL[s]}
          </span>
        )
      },
    })
  }

  if (opts.withMonth) {
    cols.push({
      key: "month", label: "Month", width: 96,
      text: (r) => r.month ?? "",
      sortValue: (r) => new Date(`1 ${r.month ?? ""}`).getTime() || 0,
    })
  }

  cols.push(
    { key: "srNo", label: "Sr No", width: 62, numeric: true, align: "center",
      text: (r) => (r.srNo == null ? "" : String(r.srNo)), sortValue: (r) => r.srNo ?? 0 },
    { key: "date", label: "Date", width: 100,
      text: (r) => fmtRegisterDate(r.date), sortValue: (r) => (r.date ? new Date(r.date).getTime() : 0) },
    { key: "name", label: "Name of Patient", width: 185,
      text: (r) => r.name ?? "",
      render: (r) => <span className="font-semibold text-gray-900">{r.name}</span> },
    { key: "age", label: "Age", width: 52, numeric: true, align: "center",
      text: (r) => (r.age == null ? "" : String(r.age)), sortValue: (r) => r.age ?? 0 },
    { key: "gender", label: "Sex", width: 58, align: "center", text: (r) => r.gender ?? "" },
    { key: "contact", label: "Contact No.", width: 112, text: (r) => r.contact ?? "" },
    { key: "department", label: "Department", width: 116, text: (r) => r.department ?? "" },
    { key: "investigation", label: "Investigation", width: 200, text: (r) => r.investigation ?? "" },
    { key: "referredBy", label: "Referred Doctor", width: 180,
      text: (r) => r.referredBy ?? "",
      render: (r) => <span className="font-medium text-gray-800">{r.referredBy || "—"}</span> },
    { key: "paymentType", label: "Payment Type", width: 104, text: (r) => r.paymentType ?? "" },
    { key: "charges", label: "Charges", width: 88, numeric: true, align: "right", total: true,
      text: (r) => String(r.charges ?? 0), render: (r) => money(r.charges ?? 0) },
    { key: "discount", label: "Discount", width: 88, numeric: true, align: "right", total: true,
      text: (r) => String(r.discount ?? 0), render: (r) => money(r.discount ?? 0) },
    { key: "paid", label: "Paid", width: 88, numeric: true, align: "right", total: true,
      text: (r) => String(r.paid ?? 0), render: (r) => money(r.paid ?? 0) },
    { key: "balance", label: "Balance", width: 88, numeric: true, align: "right", total: true,
      text: (r) => String(r.balance ?? 0),
      render: (r) => (r.balance ? <span className="font-semibold text-red-600">₹{r.balance.toLocaleString("en-IN")}</span> : <span className="text-gray-300">—</span>) },
    { key: "entryBy", label: "Entry Done By", width: 110, text: (r) => r.entryBy ?? "" },
  )

  if (!opts.editable) return cols

  return cols.map((c) => {
    const spec = EDIT_SPEC[c.key]
    if (!spec) return c
    return { ...c, editable: true, ...spec, suggestions: opts.suggestions?.[c.key] }
  })
}
