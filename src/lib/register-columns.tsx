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
  // Balance is charges − discount − paid and is recomputed on every save that
  // doesn't name it. Typing into it sets it outright, for the odd row where the
  // register's own figure is the one that has to stand. On a multi-study visit
  // the cell DRAWS the whole visit's dues, but it is still this row's own balance
  // that is edited here — the same as the name cell on a continuation row.
  balance:       { inputType: "number", editValue: (r) => String(r.balance ?? "") },
  entryBy:       {},
}

// Columns that describe the patient and the visit rather than the study. A
// patient billed for two studies gets a row per study, and these are written
// once — the way the centre's own sheets put the second investigation on the
// next line with the Sr No left blank.
const VISIT_COLUMNS = new Set(["srNo", "date", "name", "age", "gender", "contact", "referredBy", "entryBy"])

// Distinct values already in use, offered as type-ahead per column
export type RegisterSuggestions = Partial<Record<string, string[]>>

export function registerColumns(
  opts: {
    withMonth?: boolean
    withSource?: boolean
    editable?: boolean
    suggestions?: RegisterSuggestions
    /**
     * True for the second and later study of the same patient visit. Those rows
     * show only what differs — the investigation and its money — leaving the
     * patient's name, age and contact written once, on the first of them.
     */
    isContinuation?: (row: SavedRegisterRow) => boolean
    /**
     * For the FIRST row of a visit that has more than one study: what the visit
     * as a whole is owed, across all of its rows. Charges, discount and paid stay
     * per study — ₹1200 and ₹500 on their own lines — so the outstanding amount
     * would otherwise be split across two cells with no single figure to read.
     * Null for a single-study visit, whose own balance already is the total.
     */
    visitBalance?: (row: SavedRegisterRow) => { total: number; studies: number } | null
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
      // `text` stays this row's own balance, so the footer sums the month once
      // and the CSV export carries a figure per study rather than a total
      // repeated down the visit.
      text: (r) => String(r.balance ?? 0),
      render: (r) => {
        // A visit's dues are written once, on its first line, the way the sheet
        // writes the Sr No and the name once — the studies beside it carry their
        // own charges, and one of them alone is not what the patient owes.
        if (opts.isContinuation?.(r)) return null
        const visit = opts.visitBalance?.(r)
        const shown = visit ? visit.total : r.balance ?? 0
        if (!shown) return <span className="text-gray-300">—</span>
        return (
          <span
            className="font-semibold text-red-600"
            title={visit ? `₹${visit.total.toLocaleString("en-IN")} outstanding for this visit — all ${visit.studies} studies together` : undefined}
          >
            ₹{shown.toLocaleString("en-IN")}
          </span>
        )
      } },
    { key: "entryBy", label: "Entry Done By", width: 110, text: (r) => r.entryBy ?? "" },
  )

  let out = cols

  if (opts.editable) {
    out = out.map((c) => {
      const spec = EDIT_SPEC[c.key]
      if (!spec) return c
      return { ...c, editable: true, ...spec, suggestions: opts.suggestions?.[c.key] }
    })
  }

  const repeats = opts.isContinuation
  if (repeats) {
    out = out.map((c) => {
      if (!VISIT_COLUMNS.has(c.key)) return c
      const base = c.render ?? ((r: SavedRegisterRow) => c.text(r) || "")
      // Only what is DRAWN is blanked. `text` still returns the stored value, so
      // searching a patient's name, filtering by doctor and the CSV export all
      // still find the continuation rows — and clicking the empty cell opens the
      // editor on the real value, not on nothing.
      return { ...c, render: (r: SavedRegisterRow) => (repeats(r) ? null : base(r)) }
    })
  }

  return out
}
