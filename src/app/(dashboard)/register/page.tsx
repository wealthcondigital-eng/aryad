"use client"

// Monthly Register — the centre's Excel register, kept as one sheet per month.
//
// A month works the way the workbook does: pick its tab, and you are on that
// month's sheet. Rows are typed straight into the grid — click a cell and type,
// Tab across, Enter on the green line at the bottom to add the next patient.
// Sheets can be imported from .xlsx, started from scratch, and are topped up
// automatically with every patient registered in the system that month.

import { useEffect, useMemo, useRef, useState } from "react"
import {
  FileSpreadsheet, Upload, Loader2, Trash2, Download, CheckCircle2,
  AlertTriangle, X, CalendarDays, Search, RefreshCw, Plus, ArrowDownUp,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ExcelTable, ExcelColumn, ExcelFilters, filterRows, toCsv } from "@/components/excel-table"
import { registerColumns, RegisterSuggestions, SavedRegisterRow, sourceTypeOf } from "@/lib/register-columns"
import { readRegisterWorkbook, SheetRead, monthLabel } from "@/lib/xlsx-read"
import { useRole } from "@/lib/role-context"
import { autoCategory, STUDY_CATEGORIES } from "@/lib/study-catalogue"

// Type-ahead lists and the "seen before" details for a repeat patient
interface Facets {
  name: string[]
  referredBy: string[]
  department: string[]
  investigation: string[]
  paymentType: string[]
  entryBy: string[]
  people: Record<string, { age: string; gender: string; contact: string }>
}

interface MonthSummary {
  month: string
  rows: number
  charges: number
  paid: number
  balance: number
  doctors: number
  sheetName: string
  fileName: string
  importedAt: string
}

// "Jun 2026" ⇄ "2026-06", so months can be picked with the native control
function monthToInput(label: string) {
  const d = new Date(`1 ${label}`)
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
function inputToMonth(value: string) {
  const [y, m] = value.split("-").map(Number)
  return y && m ? monthLabel(new Date(y, m - 1, 1)) : ""
}
const monthStamp = (label: string) => new Date(`1 ${label}`).getTime() || 0

// New rows land on today's date inside the current month, or on the 1st of a
// past month, so a date is never left blank by accident.
function defaultDate(month: string) {
  const first = new Date(`1 ${month}`)
  if (isNaN(first.getTime())) return ""
  const now = new Date()
  const d = now.getMonth() === first.getMonth() && now.getFullYear() === first.getFullYear() ? now : first
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export default function RegisterPage() {
  const { user } = useRole()
  const fileInput = useRef<HTMLInputElement>(null)

  const [months,      setMonths]      = useState<MonthSummary[]>([])
  const [activeMonth, setActiveMonth] = useState<string | null>(null)
  const [entries,     setEntries]     = useState<SavedRegisterRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null)
  const [reloadKey,   setReloadKey]   = useState(0)
  const [filters,     setFilters]     = useState<ExcelFilters>({})
  const [rowSearch,   setRowSearch]   = useState("")
  // Newest first by default, so a row typed on the entry line lands beside it
  const [rowOrder,    setRowOrder]    = useState<"newest" | "oldest">("newest")
  const [deleting,    setDeleting]    = useState(false)

  // New sheet (month) creation
  const [newSheetOpen,  setNewSheetOpen]  = useState(false)
  const [newSheetMonth, setNewSheetMonth] = useState("")

  // Import staging
  const [parsing,   setParsing]   = useState(false)
  const [sheets,    setSheets]    = useState<SheetRead[] | null>(null)
  const [fileName,  setFileName]  = useState("")
  const [picked,    setPicked]    = useState<number[]>([])
  const [monthEdit, setMonthEdit] = useState("")
  const [replace,   setReplace]   = useState(true)
  const [saving,    setSaving]    = useState(false)
  const [previewFilters, setPreviewFilters] = useState<ExcelFilters>({})

  const [error, setError] = useState("")
  const [toast, setToast] = useState("")

  // Typing on the sheet
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({})
  const [adding,     setAdding]     = useState(false)
  const [rowBusy,    setRowBusy]    = useState<string | null>(null)
  const [facets,     setFacets]     = useState<Facets | null>(null)

  const rowsLoading = !!activeMonth && loadedMonth !== activeMonth

  // Tabs run oldest → newest, the way a workbook's sheet tabs do. Sheets come
  // from the server (so one started here is still on the strip after a refresh),
  // plus the current month, which always has a tab whether or not it has rows.
  const monthTabs = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of months) map.set(m.month, m.rows)
    const now = monthLabel(new Date())
    if (!map.has(now)) map.set(now, 0)
    return Array.from(map, ([month, rows]) => ({ month, rows })).sort((a, b) => monthStamp(a.month) - monthStamp(b.month))
  }, [months])

  const sheetMonth = activeMonth ?? monthLabel(new Date())

  const loadMonths = async (selectMonth?: string) => {
    const res  = await fetch("/api/register")
    const data = await res.json()
    const list: MonthSummary[] = data.months ?? []
    setMonths(list)
    if (selectMonth) setActiveMonth(selectMonth)
    else if (!activeMonth) setActiveMonth(list[0]?.month ?? null)
    return list
  }

  useEffect(() => {
    fetch("/api/register")
      .then((r) => r.json())
      .then((d) => {
        const list: MonthSummary[] = d.months ?? []
        setMonths(list)
        setActiveMonth(list[0]?.month ?? monthLabel(new Date()))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeMonth) return
    let alive = true
    // facets=1 keeps the type-ahead lists current with whatever was just added
    fetch(`/api/register?month=${encodeURIComponent(activeMonth)}&facets=1`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setEntries(d.entries ?? [])
        if (d.facets) setFacets(d.facets)
      })
      .catch(() => { if (alive) setEntries([]) })
      .finally(() => { if (alive) setLoadedMonth(activeMonth) })
    return () => { alive = false }
  }, [activeMonth, reloadKey])

  // Put the caret on the entry line's first cell whenever a sheet opens, so it is
  // visibly blinking where the next row gets typed. Skipped if the user is
  // already typing somewhere (the search box, a cell), so focus is never stolen.
  useEffect(() => {
    if (loading || rowsLoading) return
    const active = document.activeElement
    if (active && active !== document.body && active.tagName !== "BUTTON") return
    document.querySelector<HTMLInputElement>("[data-newrow-first]")?.focus()
  }, [activeMonth, loading, rowsLoading])

  // A patient registered in another tab lands on their month's sheet — refetch on
  // return so it is there without anyone reaching for the reload button.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") setReloadKey((k) => k + 1) }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  const openMonth = (month: string) => {
    setActiveMonth(month)
    setFilters({})
    setRowSearch("")
    setDraftEdits({})
  }

  // ── Typing rows ────────────────────────────────────────────────────────────

  // The blank line at the bottom: seeded values, overlaid with whatever is typed
  const draft = useMemo<Record<string, string>>(
    () => ({ date: defaultDate(sheetMonth), entryBy: user?.name ?? "", ...draftEdits }),
    [sheetMonth, user?.name, draftEdits]
  )

  // Picking a suggestion should save the rest of the typing too: a patient who
  // has been here before brings their age/sex/contact, and an investigation
  // brings its department. Only blank fields are filled — never a typed-over one.
  const onDraftChange = (key: string, value: string) => {
    setDraftEdits((prev) => {
      const next = { ...prev, [key]: value }
      const blank = (k: string) => !(next[k] ?? draft[k] ?? "").trim()

      if (key === "name") {
        const seen = facets?.people?.[value.trim().toLowerCase()]
        if (seen) {
          if (seen.age     && blank("age"))     next.age     = seen.age
          if (seen.contact && blank("contact")) next.contact = seen.contact
          // The system writes "Male"/"Female"; the sheets write M/F
          if (seen.gender && blank("gender")) {
            next.gender = { male: "M", female: "F", m: "M", f: "F" }[seen.gender.trim().toLowerCase()] ?? seen.gender
          }
        }
      }

      if (key === "investigation" && value.trim() && blank("department")) {
        const known = entries.find((e) => (e.investigation ?? "").trim().toLowerCase() === value.trim().toLowerCase())
        const dept  = known?.department?.trim() || autoCategory(value)
        if (dept) next.department = dept
      }

      return next
    })
  }

  const addRow = async () => {
    if (!draft.name?.trim() || !draft.investigation?.trim()) {
      setError("A new row needs at least a patient name and an investigation")
      return
    }
    setAdding(true); setError("")
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, month: sheetMonth }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Could not add the row")
      setEntries((prev) => [data.entry, ...prev])
      setDraftEdits({})
      // Caret back to the start of the blank line, ready for the next patient
      document.querySelector<HTMLInputElement>("[data-newrow-first]")?.focus()
      loadMonths(sheetMonth).catch(() => {})
      setToast(`Added ${data.entry.name} to ${sheetMonth}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the row")
    } finally {
      setAdding(false)
    }
  }

  const commitCell = async (row: SavedRegisterRow, colKey: string, value: string) => {
    if (!row._id) return
    setRowBusy(row._id)
    try {
      const res = await fetch(`/api/register/${row._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [colKey]: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Could not save that change")
      setEntries((prev) => prev.map((e) => (e._id === row._id ? data.entry : e)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that change")
      setReloadKey((k) => k + 1)      // put the cell back to what is stored
    } finally {
      setRowBusy(null)
    }
  }

  const deleteRow = async (row: SavedRegisterRow) => {
    if (!row._id) return
    if (!confirm(`Remove ${row.name || "this row"} from ${row.month ?? sheetMonth}?`)) return
    setRowBusy(row._id)
    try {
      const res  = await fetch(`/api/register/${row._id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Could not remove the row")
      setEntries((prev) => prev.filter((e) => e._id !== row._id))
      loadMonths().catch(() => {})
      setToast(`Removed ${row.name || "the row"}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the row")
    } finally {
      setRowBusy(null)
    }
  }

  // ── Columns ────────────────────────────────────────────────────────────────

  // Everything already typed anywhere in the register, plus this month's rows and
  // the three fixed departments, offered while typing.
  const suggestions: RegisterSuggestions = useMemo(() => {
    const merge = (fromFacets: string[] | undefined, fromRows: (string | undefined)[], extra: string[] = []) =>
      Array.from(new Set([...(fromFacets ?? []), ...fromRows, ...extra].filter((v): v is string => !!v && !!v.trim())))
        .sort((a, b) => a.localeCompare(b))

    return {
      name:          merge(facets?.name,          entries.map((e) => e.name)),
      referredBy:    merge(facets?.referredBy,    entries.map((e) => e.referredBy)),
      department:    merge(facets?.department,    entries.map((e) => e.department), [...STUDY_CATEGORIES]),
      investigation: merge(facets?.investigation, entries.map((e) => e.investigation)),
      paymentType:   merge(facets?.paymentType,   entries.map((e) => e.paymentType), ["CASH", "G PAY", "CARD", "UPI"]),
      entryBy:       merge(facets?.entryBy,       entries.map((e) => e.entryBy)),
    }
  }, [facets, entries])

  const columns: ExcelColumn<SavedRegisterRow>[] = useMemo(() => [
    ...registerColumns({ withSource: true, editable: true, suggestions }),
    {
      key: "rowActions", label: "", width: 44, align: "center", filterable: false,
      text: () => "",
      render: (r) => {
        const locked = sourceTypeOf(r) === "system"
        return (
          <button
            onClick={() => deleteRow(r)}
            disabled={locked || rowBusy === r._id}
            title={locked ? "Comes from a patient record — delete the patient's study instead" : "Remove this row"}
            className={`h-6 w-6 rounded border flex items-center justify-center ${
              locked
                ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                : "border-gray-200 bg-white hover:bg-red-50 hover:border-red-300 text-gray-500 hover:text-red-700"
            }`}
          >
            {rowBusy === r._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </button>
        )
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rowBusy, suggestions])

  // The import preview is read-only — nothing there is saved yet
  const previewColumns = useMemo(() => registerColumns(), [])

  // ── Import ─────────────────────────────────────────────────────────────────

  const onFile = async (file: File) => {
    setError(""); setToast(""); setParsing(true); setSheets(null)
    try {
      const read = await readRegisterWorkbook(file)
      setSheets(read)
      setFileName(file.name)
      const biggest = read.reduce((best, s, i) => (s.rows.length > read[best].rows.length ? i : best), 0)
      setPicked([biggest])
      setMonthEdit(monthToInput(read[biggest].month))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file")
    } finally {
      setParsing(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const togglePick = (i: number) => {
    setPicked((prev) => {
      const next = prev.includes(i) ? prev.filter((v) => v !== i) : [...prev, i]
      if (next.length === 1 && sheets) setMonthEdit(monthToInput(sheets[next[0]].month))
      return next
    })
  }

  const singlePick = picked.length === 1 ? picked[0] : null
  const monthFor = (i: number) =>
    singlePick === i && monthEdit ? inputToMonth(monthEdit) : sheets?.[i].month ?? ""
  const unresolved = picked.filter((i) => !monthFor(i))

  // Workbooks often keep two versions of the same month on separate tabs — saving
  // both merges them by serial number, so say so before it happens.
  const clashingMonths = Array.from(
    new Set(picked.map((i) => monthFor(i)).filter((m, _, all) => m && all.filter((x) => x === m).length > 1))
  )

  const previewSheet = sheets && picked.length > 0 ? sheets[picked[0]] : null
  const previewRows: SavedRegisterRow[] = previewSheet?.rows ?? []

  const saveImport = async () => {
    if (!sheets || picked.length === 0 || unresolved.length > 0) return
    setSaving(true); setError("")
    try {
      let saved = 0, added = 0, updated = 0, removed = 0
      let lastMonth = ""
      for (const i of picked) {
        const sheet = sheets[i]
        const month = monthFor(i)
        const res = await fetch("/api/register/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            month, sheetName: sheet.name, fileName, replace,
            importedBy: user?.name ?? "",
            rows: sheet.rows,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Import failed")
        saved += data.saved; added += data.inserted; updated += data.updated; removed += data.removed
        lastMonth = month
      }
      setSheets(null); setPicked([]); setPreviewFilters({})
      await loadMonths(lastMonth)
      setReloadKey((k) => k + 1)
      setFilters({})
      setToast(`Saved ${saved} rows into ${lastMonth} — ${added} new, ${updated} updated${removed ? `, ${removed} removed` : ""}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed")
    } finally {
      setSaving(false)
    }
  }

  // ── Month level actions ────────────────────────────────────────────────────

  // Saved server-side, so an empty sheet keeps its tab across refreshes and only
  // "Remove sheet" ever takes it away.
  const createSheet = async () => {
    const month = inputToMonth(newSheetMonth)
    if (!month) { setError("Pick a month for the new sheet"); return }
    setNewSheetOpen(false)
    setNewSheetMonth("")
    try {
      const res  = await fetch("/api/register/sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, createdBy: user?.name ?? "" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Could not start that sheet")
      await loadMonths(month)
      openMonth(month)
      setToast(`Started the ${month} sheet — type the first row on the green line`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start that sheet")
    }
  }

  const deleteMonth = async () => {
    if (!activeMonth) return
    const question = entries.length === 0
      ? `Remove the empty ${activeMonth} sheet?`
      : `Remove the ${activeMonth} sheet and all ${entries.length} of its rows — imported and hand-added? The Excel file itself is untouched.`
    if (!confirm(question)) return
    setDeleting(true)
    try {
      await fetch(`/api/register?month=${encodeURIComponent(activeMonth)}`, { method: "DELETE" })
      setEntries([])
      const list = await loadMonths()
      setActiveMonth(list[0]?.month ?? monthLabel(new Date()))
      setReloadKey((k) => k + 1)
      setToast(`Removed the ${activeMonth} sheet`)
    } finally {
      setDeleting(false)
    }
  }

  // ── Grid data ──────────────────────────────────────────────────────────────

  // Rows in date order, but a patient's own lines always stay together in the
  // order the sheet has them — the second investigation of a visit follows the
  // first even when the newest visit is on top.
  const orderedEntries = useMemo(() => {
    const dir = rowOrder === "newest" ? -1 : 1
    return [...entries].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0
      const db = b.date ? new Date(b.date).getTime() : 0
      if (da !== db) return dir * (da - db)
      return (a.rowNo ?? 0) - (b.rowNo ?? 0)
    })
  }, [entries, rowOrder])

  const searchedRows = useMemo(() => {
    const q = rowSearch.trim().toLowerCase()
    if (!q) return orderedEntries
    return orderedEntries.filter((r) => columns.some((c) => (c.text(r) ?? "").toString().toLowerCase().includes(q)))
  }, [orderedEntries, rowSearch, columns])

  const visibleRows = useMemo(() => filterRows(searchedRows, columns, filters), [searchedRows, columns, filters])

  const exportCsv = () => {
    const cols = columns.filter((c) => c.filterable !== false)
    const blob = new Blob([toCsv(visibleRows, cols)], { type: "text/csv;charset=utf-8" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href = url
    a.download = `register-${sheetMonth.replace(/\s+/g, "-").toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeSummary = months.find((m) => m.month === activeMonth)

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Monthly Register</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            One sheet per month — import it, or type rows straight into the grid
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={parsing}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 disabled:opacity-60"
          >
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {parsing ? "Reading…" : "Import Excel sheet"}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center justify-between gap-2 p-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700"
          >
            <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{toast}</span>
            <button onClick={() => setToast("")}><X className="h-3.5 w-3.5" /></button>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center justify-between gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
          >
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{error}</span>
            <button onClick={() => setError("")}><X className="h-3.5 w-3.5" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Staged import ─────────────────────────────────────────────────── */}
      {sheets && (
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="h-4 w-4 text-blue-600 shrink-0" />
                <div className="min-w-0">
                  <CardTitle className="text-sm truncate">{fileName}</CardTitle>
                  <CardDescription className="text-xs">
                    {sheets.length} sheet{sheets.length !== 1 ? "s" : ""} read — tick the month(s) to save
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="h-3.5 w-3.5 accent-blue-600" />
                  Replace rows already saved for this month
                </label>
                <button
                  onClick={() => { setSheets(null); setPicked([]); setPreviewFilters({}) }}
                  className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={saveImport}
                  disabled={saving || picked.length === 0 || unresolved.length > 0}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Save {picked.length > 1 ? `${picked.length} sheets` : "to system"}
                </button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sheets.map((s, i) => {
                const on = picked.includes(i)
                const m  = monthFor(i)
                return (
                  <label
                    key={`${s.name}-${i}`}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      on ? "border-blue-400 bg-blue-50/60" : "border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <input type="checkbox" checked={on} onChange={() => togglePick(i)} className="h-3.5 w-3.5 mt-0.5 accent-blue-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-gray-800 truncate">{s.name.trim() || "(unnamed sheet)"}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.rows.length} rows{s.skipped ? ` · ${s.skipped} blank skipped` : ""}
                      </p>
                      <p className={`text-[11px] mt-0.5 font-medium ${m ? "text-blue-700" : "text-red-600"}`}>
                        {m || "month not detected"}
                      </p>
                      {s.missing.length > 0 && (
                        <p className="text-[11px] text-orange-600 mt-0.5">missing: {s.missing.join(", ")}</p>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>

            {singlePick !== null && (
              <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                <CalendarDays className="h-3.5 w-3.5 text-gray-500" />
                <span className="text-xs font-semibold text-gray-600">Save as the sheet for</span>
                <input
                  type="month"
                  value={monthEdit}
                  onChange={(e) => setMonthEdit(e.target.value)}
                  className="h-7 px-2 text-xs border border-gray-200 rounded outline-none focus:border-blue-400"
                />
                <span className="text-xs text-gray-500">detected from the sheet&apos;s dates — change it if it belongs to another month</span>
              </div>
            )}

            {clashingMonths.length > 0 && (
              <p className="text-xs text-orange-600 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                More than one selected sheet resolves to {clashingMonths.join(", ")} — they will be merged into that month and
                rows sharing a serial number will overwrite each other. Save them one at a time if that isn&apos;t what you want.
              </p>
            )}

            {unresolved.length > 0 && (
              <p className="text-xs text-red-600 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                No month could be detected for {unresolved.length} selected sheet{unresolved.length !== 1 ? "s" : ""} — select it on its own and set the month.
              </p>
            )}

            {previewSheet && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-600">
                  Preview — {previewSheet.name.trim()} · {previewRows.length} rows
                  <span className="font-normal text-gray-400"> (header row {previewSheet.headerRow})</span>
                </div>
                <ExcelTable
                  rows={previewRows}
                  columns={previewColumns}
                  filters={previewFilters}
                  onFiltersChange={setPreviewFilters}
                  rowKey={(r, i) => `p-${r.rowNo}-${i}`}
                  maxHeight="40vh"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Sheet tabs ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-1 border-b border-gray-200">
        {loading && (
          <span className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading sheets…
          </span>
        )}
        {!loading && monthTabs.map((t) => {
          const on = t.month === activeMonth
          return (
            <button
              key={t.month}
              onClick={() => openMonth(t.month)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px transition-colors ${
                on
                  ? "bg-white border-gray-200 text-blue-700"
                  : "bg-gray-50 border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {t.month}
              <span className={`text-[10px] font-bold px-1.5 rounded-full ${on ? "bg-blue-50 text-blue-700" : "bg-gray-200 text-gray-500"}`}>
                {t.rows}
              </span>
            </button>
          )
        })}

        {!loading && (
          newSheetOpen ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-1.5">
              <input
                type="month"
                autoFocus
                value={newSheetMonth}
                onChange={(e) => setNewSheetMonth(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createSheet(); if (e.key === "Escape") setNewSheetOpen(false) }}
                className="h-7 px-2 text-xs border border-gray-200 rounded outline-none focus:border-blue-400"
              />
              <button onClick={createSheet} className="h-7 px-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold">
                Create
              </button>
              <button onClick={() => setNewSheetOpen(false)} className="h-7 w-7 rounded hover:bg-gray-100 flex items-center justify-center text-gray-400">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <button
              onClick={() => { setNewSheetOpen(true); setNewSheetMonth(monthToInput(monthLabel(new Date()))) }}
              title="Start a sheet for another month"
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold text-gray-500 hover:text-blue-700 hover:bg-gray-50 rounded-t-lg"
            >
              <Plus className="h-3.5 w-3.5" />New sheet
            </button>
          )
        )}
      </div>

      {/* ── The month's sheet ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-sm">{sheetMonth} sheet</CardTitle>
              <CardDescription className="text-xs">
                {rowsLoading ? "Loading…" : `${visibleRows.length} of ${entries.length} rows`}
                {activeSummary && ` · ₹${activeSummary.charges.toLocaleString("en-IN")} charged · ₹${activeSummary.paid.toLocaleString("en-IN")} collected`}
                {activeSummary?.fileName && ` · from ${activeSummary.fileName}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  const first = document.querySelector<HTMLInputElement>("[data-newrow-first]")
                  first?.scrollIntoView({ block: "nearest" })
                  first?.focus()
                }}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                title="Jump to the blank line at the bottom of the sheet"
              >
                <Plus className="h-3.5 w-3.5" />Add row
              </button>
              <button
                onClick={() => setRowOrder((o) => (o === "newest" ? "oldest" : "newest"))}
                title="Flip the sheet order"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700"
              >
                <ArrowDownUp className="h-3.5 w-3.5" />
                {rowOrder === "newest" ? "Newest first" : "Oldest first"}
              </button>
              <div className="relative w-full sm:w-48">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search the sheet…" className="pl-8 h-8 text-xs" value={rowSearch} onChange={(e) => setRowSearch(e.target.value)} />
              </div>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                title="Reload"
                className="h-8 w-8 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 flex items-center justify-center text-gray-500"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={exportCsv}
                disabled={visibleRows.length === 0}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5" />Export
              </button>
              <button
                onClick={deleteMonth}
                // Enabled even when the sheet is empty — a sheet started by
                // mistake is the first thing anyone wants to remove
                disabled={deleting}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-600 disabled:opacity-40"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Remove sheet
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rowsLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Loading {sheetMonth}…
            </div>
          ) : (
            <ExcelTable
              rows={searchedRows}
              columns={columns}
              filters={filters}
              onFiltersChange={setFilters}
              rowKey={(r, i) => r._id ?? `${r.rowNo}-${i}`}
              emptyMessage={`Nothing in ${sheetMonth} yet — type the first row on the green line below.`}
              onCellCommit={commitCell}
              isRowLocked={(r) => sourceTypeOf(r) === "system"}
              newRow={{
                draft,
                onChange: onDraftChange,
                onCommit: addRow,
                busy: adding,
                focusKey: "name",
                hint: "Type across the green line and press Enter (or the ✚ at its end) to add the row. Click any saved cell to correct it — rows marked “System entry” are patients booked in the system and update themselves.",
              }}
              maxHeight="62vh"
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
