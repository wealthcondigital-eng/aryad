"use client"

// Monthly Register — the centre's Excel register, kept as one sheet per month.
//
// A month works the way the workbook does: pick its tab, and you are on that
// month's sheet. Rows are typed straight into the grid — click a cell and type,
// Tab across, Enter on the green line at the bottom to add the next patient.
// Sheets can be imported from .xlsx, started from scratch, and are topped up
// automatically with every patient registered in the system that month.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FileSpreadsheet, Upload, Loader2, Trash2, Download, CheckCircle2,
  AlertTriangle, X, CalendarDays, Search, RefreshCw, Plus, ArrowDownUp, Columns3, Undo2,
} from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ExcelTable, ExcelColumn, ExcelFilters, filterRows, toCsv } from "@/components/excel-table"
import { registerColumns, RegisterSuggestions, SavedRegisterRow, sourceTypeOf } from "@/lib/register-columns"
import { readRegisterWorkbook, SheetRead, monthLabel } from "@/lib/xlsx-read"
import { useRole } from "@/lib/role-context"
import { canonicalCategory } from "@/lib/study-catalogue"
import { useCategories } from "@/components/combo-input"
import { useConfirm } from "@/components/confirm-dialog"
import { isCustomColumn } from "@/lib/register-column-keys"

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

// One reversible change to the sheet. `label` is what the Undo button says it
// will take back, so it names the change in the user's terms ("Delete row"),
// not the mechanism.
type UndoStep =
  // Cells put back to what they held — a typed cell, a pasted block, an
  // emptied column all reduce to this.
  | { kind: "cells";   label: string; updates: { id: string; fields: Record<string, unknown> }[] }
  // Whole rows put back, tombstones and all
  | { kind: "restore"; label: string; rows: Record<string, unknown>[] }
  // A row that was added — undoing it takes it off again
  | { kind: "unadd";   label: string; ids: string[] }
  // A column taken off the sheet
  | { kind: "unhide";  label: string; column: string }

// A column the clinic added to a sheet. `after` is the key of the column it
// sits behind — "" puts it first — which is how the "where should this go?"
// answer is remembered.
type CustomColumn = { key: string; label: string; after: string }

// Column labels for the messages the page writes about a column, so an undo or
// a toast says "DEPARTMENT" rather than "department".
const COLUMN_LABELS: Record<string, string> = {
  sourceType: "Source", srNo: "Sr No", patientSrNo: "Patient ID", date: "Date",
  name: "Name of Patient", age: "Age", gender: "Sex", contact: "Contact No.",
  department: "Department", investigation: "Investigation", referredBy: "Referred Doctor",
  paymentType: "Payment Type", charges: "Charges", discount: "Discount", paid: "Paid",
  balance: "Balance", entryBy: "Entry Done By",
}
const columnLabel = (key: string) => COLUMN_LABELS[key] ?? key

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
  const { confirm, notify } = useConfirm()
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
  // What the toolbar's Delete button acts on — rows picked with the handles at
  // the start of them, or a column picked by its header. Only ever one of the
  // two: picking either drops the other.
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set())
  const [anchorRowId,    setAnchorRowId]    = useState<string | null>(null)   // for shift-click ranges
  const [selectedColKey, setSelectedColKey] = useState<string | null>(null)
  const [clearingCol, setClearingCol] = useState(false)
  const [pasting,     setPasting]     = useState(false)
  // Columns taken off this month's sheet. Stored on the sheet, so they stay off
  // for everyone until they're put back — the same as hiding a column in Excel.
  const [hiddenCols, setHiddenCols] = useState<string[]>([])
  // Columns the clinic added to this sheet itself — blank, typed into like any
  // other, sitting wherever they said to put them.
  const [customCols, setCustomCols] = useState<CustomColumn[]>([])
  const [addColOpen,  setAddColOpen]  = useState(false)
  const [addColName,  setAddColName]  = useState("")
  const [addColAfter, setAddColAfter] = useState("")
  const [addColSaving, setAddColSaving] = useState(false)
  const [addColError,  setAddColError]  = useState("")
  const [facets,     setFacets]     = useState<Facets | null>(null)
  const [categories] = useCategories()

  // ── Undo ──────────────────────────────────────────────────────────────────
  // Every change to the sheet pushes how to reverse it. Undo is what makes the
  // destructive things — delete a row, empty a column, paste over a block —
  // safe to reach for; without it every one of them is a decision.
  //
  // It lives in the page, not the database: this session's changes, gone on
  // refresh. That is honest about what it is, and it is what a mis-click needs.
  const [undoStack, setUndoStack] = useState<UndoStep[]>([])
  const [undoing,   setUndoing]   = useState(false)
  const pushUndo = (step: UndoStep) => setUndoStack((prev) => [...prev.slice(-49), step])

  // ── Picking rows ──────────────────────────────────────────────────────────
  // Plain click toggles one. Ctrl/Cmd adds or removes without losing the rest.
  // Shift takes everything between the last one picked and this one, in the
  // order the sheet is drawn — a spreadsheet's three ways of selecting rows.
  const toggleRowSelected = useCallback((id: string | null) => {
    if (!id) return
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setAnchorRowId(id)
  }, [])

  const pickRow = (id: string | null, mods: { shift: boolean; meta: boolean }, order: string[]) => {
    if (!id) return
    setSelectedColKey(null)
    if (mods.shift && anchorRowId) {
      const from = order.indexOf(anchorRowId)
      const to   = order.indexOf(id)
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from < to ? [from, to] : [to, from]
        setSelectedRowIds(new Set(order.slice(lo, hi + 1)))
        return
      }
    }
    if (mods.meta) { toggleRowSelected(id); return }
    // A plain click on the only selected row clears it, so clicking twice
    // deselects rather than leaving the row stuck as picked.
    setSelectedRowIds((prev) => (prev.size === 1 && prev.has(id) ? new Set() : new Set([id])))
    setAnchorRowId(id)
  }

  // Which department each study belongs to, straight from the studies
  // catalogue. Typing an investigation on the sheet fills DEPARTMENT from
  // this — the same answer the patient's own record gives, never a guess off
  // the study's name.
  const [studyDepartments, setStudyDepartments] = useState<Record<string, string>>({})
  useEffect(() => {
    fetch("/api/studies")
      .then((r) => r.json())
      .then((d) => setStudyDepartments(Object.fromEntries(
        (d.studies ?? [])
          .map((s: { name?: string; category?: string }) => [String(s.name ?? "").trim().toLowerCase(), canonicalCategory(s.category)])
          .filter(([name, cat]: [string, string]) => name && cat)
      )))
      .catch(() => {})
  }, [])

  // Ctrl/Cmd+Z anywhere on the page, except while a cell is being typed into —
  // there it belongs to the text box, undoing the typing rather than the sheet.
  const undoRef = useRef<() => void>(() => {})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
      e.preventDefault()
      undoRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

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
    // A row pick doesn't need clearing when the month changes: `selectedRow`
    // resolves the id against the loaded rows, so it falls to null on its own
    // and the Delete button goes back to disabled. A column pick is a column
    // name, which means the same thing on any sheet, so it survives the switch.
    let alive = true
    // facets=1 keeps the type-ahead lists current with whatever was just added
    fetch(`/api/register?month=${encodeURIComponent(activeMonth)}&facets=1`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setEntries(d.entries ?? [])
        setHiddenCols(d.hiddenColumns ?? [])
        setCustomCols(d.customColumns ?? [])
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
        // Nothing on record leaves DEPARTMENT blank to be picked by hand — a
        // guessed department is indistinguishable from one somebody chose.
        const dept  = known?.department?.trim() || studyDepartments[value.trim().toLowerCase()] || ""
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
      setDraftEdits({})
      // A row dated in another month goes onto that month's sheet — follow it
      // there rather than leaving the row apparently missing from this one.
      if (data.movedSheet) {
        await loadMonths(data.month)
        setToast(`Added ${data.entry.name} to ${data.month} — that is the month its date falls in`)
        return
      }
      setEntries((prev) => [data.entry, ...prev])
      if (data.entry?._id) pushUndo({ kind: "unadd", label: "adding the row", ids: [data.entry._id] })
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

  // What a cell holds right now, in the shape a write takes — so undo can put
  // exactly that back.
  const cellValue = (row: SavedRegisterRow, colKey: string): unknown => {
    const v = (row as unknown as Record<string, unknown>)[colKey]
    if (colKey === "date") return v ? String(v).slice(0, 10) : ""
    return v ?? ""
  }

  const commitCell = async (row: SavedRegisterRow, colKey: string, value: string) => {
    if (!row._id) return
    const before = cellValue(row, colKey)
    setRowBusy(row._id)
    try {
      const res = await fetch(`/api/register/${row._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [colKey]: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Could not save that change")
      const label = columnLabel(colKey)
      pushUndo({ kind: "cells", label: `edit to ${label}`, updates: [{ id: row._id, fields: { [colKey]: before } }] })
      // Correcting a date into another month moves the row to that month's
      // sheet, so it leaves this one rather than sitting here with a date that
      // doesn't belong to it.
      if (data.entry?.month && data.entry.month !== sheetMonth) {
        setEntries((prev) => prev.filter((e) => e._id !== row._id))
        loadMonths().catch(() => {})
        setToast(`${data.entry.name || "That row"} moved to the ${data.entry.month} sheet`)
        return
      }
      setEntries((prev) => prev.map((e) => (e._id === row._id ? data.entry : e)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that change")
      setReloadKey((k) => k + 1)      // put the cell back to what is stored
    } finally {
      setRowBusy(null)
    }
  }

  // Deleting one row or a whole selection — one confirm either way, the way a
  // spreadsheet deletes whatever you have highlighted.
  const deleteRows = async (rows: SavedRegisterRow[]) => {
    const targets = rows.filter((r) => r._id)
    if (targets.length === 0) return

    const many   = targets.length > 1
    const anySys = targets.some((r) => sourceTypeOf(r) === "system")
    const what   = many ? `${targets.length} rows` : (targets[0].name || "This row")
    if (!(await confirm({
      title: many ? `Delete ${targets.length} rows?` : "Delete row?",
      message: anySys
        ? `${what} ${many ? "are" : "is"} deleted off the ${sheetMonth} sheet. Patient records and their reports are untouched — only these lines go, and they won't come back on their own. Undo puts them back.`
        : `${what} ${many ? "are" : "is"} deleted from ${sheetMonth}. Undo puts ${many ? "them" : "it"} back.`,
      confirmLabel: many ? `Delete ${targets.length} rows` : "Delete row",
      danger: true,
    }))) return

    setRowBusy(targets[0]._id!)
    try {
      const by = encodeURIComponent(user?.name ?? "")
      const deleted: Record<string, unknown>[] = []
      for (const row of targets) {
        const res  = await fetch(`/api/register/${row._id}?by=${by}`, { method: "DELETE" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? "Could not remove the row")
        // The server hands back the document it deleted, so undo can put the
        // row back exactly as it was rather than from a guess held here.
        if (data.row) deleted.push(data.row)
      }
      const ids = new Set(targets.map((r) => r._id))
      setEntries((prev) => prev.filter((e) => !ids.has(e._id)))
      setSelectedRowIds(new Set())
      if (deleted.length > 0) {
        pushUndo({ kind: "restore", label: many ? `deleting ${deleted.length} rows` : "deleting the row", rows: deleted })
      }
      loadMonths().catch(() => {})
      setToast(many ? `Deleted ${targets.length} rows from ${sheetMonth}` : `Deleted ${targets[0].name || "the row"} from ${sheetMonth}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the row")
      setReloadKey((k) => k + 1)
    } finally {
      setRowBusy(null)
    }
  }

  const deleteRow = (row: SavedRegisterRow) => deleteRows([row])

  // The trash on each row calls through this rather than closing over
  // deleteRow, which is rebuilt every render — the column list can then declare
  // honest dependencies and stay memoized instead of being torn down each time.
  const deleteRowRef = useRef(deleteRow)
  useEffect(() => { deleteRowRef.current = deleteRow })

  // Emptying one column down the whole month — what selecting a column in a
  // spreadsheet and pressing Delete does. The columns themselves are the Excel
  // register's own and are fixed, so the column stays and its cells go blank.
  const clearColumn = async (colKey: string, label: string) => {
    if (!(await confirm({
      title: `Empty the ${label} column?`,
      message: `${label} is blanked on all ${entries.length} row${entries.length === 1 ? "" : "s"} of ${sheetMonth} — not just the ones on screen. The column itself stays on the sheet; only what is in it goes. On rows mirrored from a patient the blank sticks: the next sync won't put the old value back.`,
      confirmLabel: "Empty column",
      danger: true,
    }))) return
    setClearingCol(true); setError("")
    // Snapshot before the wipe: undo puts each row's own value back, not one
    // value across the column.
    const before = entries
      .filter((e) => e._id)
      .map((e) => ({ id: e._id!, fields: { [colKey]: cellValue(e, colKey) } }))
    try {
      const res  = await fetch("/api/register", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: sheetMonth, clearColumn: colKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Could not empty that column")
      if (before.length > 0) pushUndo({ kind: "cells", label: `emptying ${label}`, updates: before })
      setSelectedColKey(null)
      setReloadKey((k) => k + 1)
      loadMonths().catch(() => {})
      setToast(`Emptied ${label} on ${data.cleared} row${data.cleared === 1 ? "" : "s"}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not empty that column")
    } finally {
      setClearingCol(false)
    }
  }

  // Taking a column off the sheet, and putting it back. Nothing is erased —
  // the values stay in every row and reappear the moment it is unhidden.
  const setColumnHidden = async (colKey: string, hidden: boolean, label?: string) => {
    const before = hiddenCols
    setHiddenCols((prev) => (hidden ? [...new Set([...prev, colKey])] : prev.filter((k) => k !== colKey)))
    if (hidden) setSelectedColKey(null)
    try {
      const res = await fetch("/api/register/sheet", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: sheetMonth, [hidden ? "hideColumn" : "showColumn"]: colKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Could not change the columns")
      setHiddenCols(data.hiddenColumns ?? [])
      setToast(hidden
        ? `Removed the ${label ?? colKey} column from ${sheetMonth}`
        : `Added the ${label ?? colKey} column to ${sheetMonth}`)
    } catch (e) {
      setHiddenCols(before)      // put the column back if the sheet didn't take it
      setError(e instanceof Error ? e.message : "Could not change the columns")
    }
  }

  // Adding a column of the clinic's own: a name, and where on the sheet it
  // goes. It arrives blank on every row and is typed into like any other.
  const addColumn = async () => {
    const label = addColName.trim()
    if (!label) { setAddColError("Give the column a name"); return }
    setAddColSaving(true); setAddColError("")
    try {
      const res = await fetch("/api/register/sheet", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: sheetMonth, addColumn: { label, after: addColAfter } }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Could not add that column")
      setCustomCols(data.customColumns ?? [])
      setAddColOpen(false); setAddColName(""); setAddColAfter("")
      setToast(`Added the ${label} column to ${sheetMonth}`)
    } catch (e) {
      setAddColError(e instanceof Error ? e.message : "Could not add that column")
    } finally {
      setAddColSaving(false)
    }
  }

  // Deleting a column the clinic added. Unlike one of the register's own, there
  // is nothing underneath to preserve — the column and what was typed in it go.
  const dropColumn = async (colKey: string, label: string) => {
    if (!(await confirm({
      title: `Delete the ${label} column?`,
      message: `${label} and everything typed in it are deleted from ${sheetMonth}. This one is a column you added, so there is nothing underneath it to keep.`,
      confirmLabel: "Delete column",
      danger: true,
    }))) return
    setClearingCol(true); setError("")
    try {
      const res = await fetch("/api/register/sheet", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: sheetMonth, dropColumn: colKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Could not delete that column")
      setCustomCols(data.customColumns ?? [])
      setSelectedColKey(null)
      setReloadKey((k) => k + 1)
      setToast(`Deleted the ${label} column from ${sheetMonth}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete that column")
    } finally {
      setClearingCol(false)
    }
  }

  const removeColumn = async (colKey: string, label: string) => {
    if (!(await confirm({
      title: `Remove the ${label} column?`,
      message: `${label} comes off the ${sheetMonth} sheet and out of its export, and stays off. Every row keeps its value underneath, so if you ever want the column again "Add column" puts it back.`,
      confirmLabel: "Remove column",
      danger: true,
    }))) return
    await setColumnHidden(colKey, true, label)
    pushUndo({ kind: "unhide", label: `removing the ${label} column`, column: colKey })
  }

  // ── Paste ─────────────────────────────────────────────────────────────────
  // A block copied out of Excel drops onto the sheet from wherever the paste
  // starts, filling across and down. Only cells that already exist are written:
  // pasting past the last row doesn't invent patients — that is what Import
  // Excel sheet is for — and the toast says how many lines were left over.
  const pasteBlock = async (startRowKey: string | null, startColKey: string | null, cells: string[][]) => {
    const order = visibleRows
    const startRow = startRowKey ? order.findIndex((r) => r._id === startRowKey) : 0
    if (startRow < 0 || order.length === 0) return

    const writable = columns.filter((c) => c.editable).map((c) => c.key)
    const startCol = startColKey && writable.includes(startColKey) ? writable.indexOf(startColKey) : 0

    const updates: { id: string; fields: Record<string, unknown> }[] = []
    const before:  { id: string; fields: Record<string, unknown> }[] = []
    let overflow = 0

    cells.forEach((line, r) => {
      const target = order[startRow + r]
      if (!target?._id) { overflow++; return }
      const fields: Record<string, unknown> = {}
      const prev:   Record<string, unknown> = {}
      line.forEach((raw, c) => {
        const colKey = writable[startCol + c]
        if (!colKey) return
        fields[colKey] = raw.trim()
        prev[colKey]   = cellValue(target, colKey)
      })
      if (Object.keys(fields).length === 0) return
      updates.push({ id: target._id, fields })
      before.push({ id: target._id, fields: prev })
    })

    if (updates.length === 0) {
      setError("Nothing to paste here — the copied block starts past the last row of this sheet")
      return
    }

    if (!(await confirm({
      title: `Paste over ${updates.length} row${updates.length === 1 ? "" : "s"}?`,
      message: `${updates.length} row${updates.length === 1 ? "" : "s"} on ${sheetMonth} ${updates.length === 1 ? "is" : "are"} overwritten from the clipboard, starting at the row you picked.${overflow > 0 ? ` ${overflow} copied line${overflow === 1 ? "" : "s"} go past the end of the sheet and will be left out.` : ""} Undo puts the old values back.`,
      confirmLabel: "Paste",
    }))) return

    setPasting(true); setError("")
    try {
      const res  = await fetch("/api/register/cells", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Could not paste")
      pushUndo({ kind: "cells", label: `pasting over ${before.length} rows`, updates: before })
      setReloadKey((k) => k + 1)
      loadMonths().catch(() => {})
      setToast(`Pasted into ${data.written} row${data.written === 1 ? "" : "s"}${overflow > 0 ? ` · ${overflow} line${overflow === 1 ? "" : "s"} past the end of the sheet ignored` : ""}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not paste")
    } finally {
      setPasting(false)
    }
  }

  // ── Undo ──────────────────────────────────────────────────────────────────
  const undoLast = async () => {
    const step = undoStack[undoStack.length - 1]
    if (!step || undoing) return
    setUndoing(true); setError("")
    try {
      if (step.kind === "cells") {
        const res = await fetch("/api/register/cells", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: step.updates }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not undo")
      } else if (step.kind === "restore") {
        const res = await fetch("/api/register/cells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restore: step.rows }),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not undo")
      } else if (step.kind === "unadd") {
        for (const id of step.ids) await fetch(`/api/register/${id}`, { method: "DELETE" })
      } else if (step.kind === "unhide") {
        await setColumnHidden(step.column, false)
      }
      setUndoStack((prev) => prev.slice(0, -1))
      setSelectedRowIds(new Set())
      setReloadKey((k) => k + 1)
      loadMonths().catch(() => {})
      setToast(`Undid ${step.label}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not undo that")
    } finally {
      setUndoing(false)
    }
  }

  // The shortcut fires against whatever the latest render closed over, rather
  // than the stack as it stood when the listener was attached.
  useEffect(() => { undoRef.current = () => { void undoLast() } })

  const selectedRows = entries.filter((e) => e._id && selectedRowIds.has(e._id))
  // Both null means "nothing picked, nothing in flight" — comparing them
  // directly would read as busy and leave the toolbar button spinning forever.
  const deleteBusy = !!rowBusy || clearingCol || pasting || undoing

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
      department:    merge(facets?.department,    entries.map((e) => e.department), categories),
      investigation: merge(facets?.investigation, entries.map((e) => e.investigation)),
      paymentType:   merge(facets?.paymentType,   entries.map((e) => e.paymentType), ["CASH", "G PAY", "CARD", "UPI"]),
      entryBy:       merge(facets?.entryBy,       entries.map((e) => e.entryBy)),
    }
  }, [facets, entries, categories])

  // The second and later study of one visit, and what the visit owes as a whole.
  // Worked out from the month's rows themselves — a patient's study index, or
  // their name and date on a typed or imported row — never from where a row
  // happens to sit on screen, so sorting or filtering the grid can't leave a lone
  // row with its name blanked out.
  const visits = useMemo(() => {
    const groups = new Map<string, SavedRegisterRow[]>()
    for (const r of entries) {
      const name = (r.name ?? "").trim().toLowerCase()
      const key = sourceTypeOf(r) === "system" && r.patientId
        ? `p:${r.patientId}`
        : name ? `n:${name}|${r.date ? String(r.date).slice(0, 10) : ""}` : ""
      if (!key) continue          // a nameless imported line is already blank
      const list = groups.get(key)
      if (list) list.push(r)
      else groups.set(key, [r])
    }

    const continuationIds = new Set<string>()
    // First row of a multi-study visit → that visit's total dues
    const balanceByLeadId = new Map<string, { total: number; studies: number }>()
    for (const rows of groups.values()) {
      if (rows.length < 2) continue
      const ordered = [...rows].sort((a, b) =>
        (a.studyIndex ?? 0) - (b.studyIndex ?? 0) ||
        (a.rowNo ?? 0) - (b.rowNo ?? 0) ||
        String(a._id).localeCompare(String(b._id)))
      for (const r of ordered.slice(1)) if (r._id) continuationIds.add(r._id)
      const lead = ordered[0]
      if (lead?._id) {
        balanceByLeadId.set(lead._id, {
          total: ordered.reduce((s, r) => s + (Number(r.balance) || 0), 0),
          studies: ordered.length,
        })
      }
    }
    return { continuationIds, balanceByLeadId }
  }, [entries])

  // The row handle: pinned to the left edge so it is reachable without
  // scrolling the sheet sideways. Clicking it picks the row out for the
  // toolbar's "Delete row"; the trash on it removes that row in one click.
  const columns = useMemo<ExcelColumn<SavedRegisterRow>[]>(() => {
    const cols: ExcelColumn<SavedRegisterRow>[] = [
    {
      key: "rowActions", label: "Row", width: 66, align: "center", filterable: false, sticky: true,
      text: () => "",
      // Select-all for what is on screen — Excel's corner box. Half-selected
      // shows as indeterminate so it reads as "some, not all".
      renderHeader: ({ visibleKeys }) => {
        const all  = visibleKeys.length > 0 && visibleKeys.every((k) => selectedRowIds.has(k))
        const some = visibleKeys.some((k) => selectedRowIds.has(k))
        return (
          <input
            type="checkbox"
            checked={all}
            ref={(el) => { if (el) el.indeterminate = some && !all }}
            onChange={() => {
              setSelectedRowIds(all ? new Set() : new Set(visibleKeys))
              setSelectedColKey(null)
            }}
            title={all ? "Deselect every row on screen" : "Select every row on screen"}
            className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
          />
        )
      },
      render: (r) => {
        const picked = !!r._id && selectedRowIds.has(r._id)
        return (
          <div className="flex items-center justify-center gap-1.5">
            <input
              type="checkbox"
              checked={picked}
              onChange={() => { toggleRowSelected(r._id ?? null); setSelectedColKey(null) }}
              title={picked ? "Deselect this row" : "Select this row — shift-click a second one for a range"}
              className="h-3.5 w-3.5 accent-blue-600 cursor-pointer"
            />
            <button
              onClick={() => deleteRowRef.current(r)}
              disabled={!!r._id && rowBusy === r._id}
              title="Remove this row from the sheet"
              className="h-5 w-5 rounded border flex items-center justify-center border-gray-200 bg-white hover:bg-red-50 hover:border-red-300 text-gray-400 hover:text-red-700 disabled:opacity-50"
            >
              {!!r._id && rowBusy === r._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          </div>
        )
      },
    },
    ...registerColumns({
      withSource: true,
      editable: true,
      suggestions,
      isContinuation: (r) => !!r._id && visits.continuationIds.has(r._id),
      visitBalance: (r) => (r._id ? visits.balanceByLeadId.get(r._id) ?? null : null),
    }),
    ]

    // Columns taken off the sheet drop out here, in the one place the list is
    // built — so the grid, the search and the CSV export all agree on what the
    // sheet has, without a second memo to keep in step.
    const shown = cols.filter((c) => !hiddenCols.includes(c.key))

    // Then the clinic's own columns slot in behind whichever column they were
    // put after. One whose anchor has since been removed goes on the end rather
    // than disappearing with it.
    for (const cc of customCols) {
      const col: ExcelColumn<SavedRegisterRow> = {
        key: cc.key, label: cc.label, width: 140, editable: true,
        text: (r) => r.extra?.[cc.key] ?? "",
        suggestions: Array.from(new Set(
          entries.map((e) => e.extra?.[cc.key] ?? "").filter((v) => v.trim())
        )).sort((a, b) => a.localeCompare(b)),
      }
      const at = shown.findIndex((c) => c.key === cc.after)
      if (cc.after && at >= 0) shown.splice(at + 1, 0, col)
      else if (!cc.after) shown.splice(1, 0, col)   // "first" still sits after the row handle
      else shown.push(col)
    }
    return shown
  }, [rowBusy, suggestions, visits, selectedRowIds, toggleRowSelected, hiddenCols, customCols, entries])

  const selectedCol = selectedColKey ? columns.find((c) => c.key === selectedColKey) ?? null : null
  // A column with no `editable` flag is read-only (SOURCE is worked out from
  // the row, PATIENT ID belongs to the patient record) — it can be taken off
  // the sheet, but there is nothing in it to empty.
  const selectedColEmptiable = !!selectedCol?.editable
  const selectedColIsCustom  = !!selectedCol && isCustomColumn(selectedCol.key)

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
    if (!(await confirm({
      title: `Remove the ${activeMonth} sheet?`,
      message: entries.length === 0
        ? "The sheet is empty, so nothing else is affected."
        : `All ${entries.length} of its rows — imported and hand-added — go with it. The Excel file itself is untouched.`,
      confirmLabel: "Remove sheet",
      danger: true,
    }))) return
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

      {/* ── Add a column of your own ──────────────────────────────────────── */}
      {addColOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAddColOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b">
              <h2 className="font-semibold text-base">Add a column</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                A new blank column on the {sheetMonth} sheet, typed into like any other.
              </p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Column name <span className="text-red-500">*</span></label>
                <Input
                  autoFocus
                  value={addColName}
                  maxLength={40}
                  onChange={(e) => { setAddColName(e.target.value); setAddColError("") }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addColumn() } }}
                  placeholder="e.g. Remarks"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Where should it go?</label>
                <select
                  value={addColAfter}
                  onChange={(e) => setAddColAfter(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">First column</option>
                  {columns.filter((c) => !c.sticky).map((c) => (
                    <option key={c.key} value={c.key}>After {c.label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">
                  It sits here on this month&apos;s sheet. Other months keep their own columns.
                </p>
              </div>
              {addColError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-600">{addColError}</p>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">
              <button
                onClick={() => setAddColOpen(false)}
                className="h-8 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void addColumn()}
                disabled={!addColName.trim() || addColSaving}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-40"
              >
                {addColSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add column
              </button>
            </div>
          </div>
        </div>
      )}

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
                onClick={() => {
                  if (selectedCol) void clearColumn(selectedCol.key, selectedCol.label)
                  else if (selectedRows.length > 0) void deleteRows(selectedRows)
                }}
                disabled={deleteBusy || (selectedRows.length === 0 && !selectedColEmptiable)}
                title={
                  selectedCol && !selectedColEmptiable ? `${selectedCol.label} is worked out from the record — there is nothing in it to empty. Use "Remove column" to take it off the sheet.`
                  : selectedCol ? `Empty the ${selectedCol.label} column on every row of ${sheetMonth}`
                  : selectedRows.length > 0 ? `Delete ${selectedRows.length === 1 ? (selectedRows[0].name || "the selected row") : `${selectedRows.length} rows`} from ${sheetMonth}`
                  : "Pick rows (tick their boxes, or click a SOURCE / PATIENT ID cell — shift-click for a range) or a column heading, then Delete"
                }
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                {deleteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {selectedCol ? `Empty ${selectedCol.label}` : selectedRows.length > 1 ? `Delete ${selectedRows.length} rows` : "Delete row"}
              </button>
              <button
                onClick={() => void undoLast()}
                disabled={undoStack.length === 0 || undoing}
                title={undoStack.length > 0
                  ? `Undo ${undoStack[undoStack.length - 1].label}`
                  : "Nothing to undo yet — changes made on this sheet can be taken back here"}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
              >
                {undoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Undo
                {undoStack.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-gray-100 text-gray-600 px-1.5 text-[10px] font-bold">
                    {undoStack.length}
                  </span>
                )}
              </button>
              {selectedCol && (
                <button
                  onClick={() => (selectedColIsCustom
                    ? void dropColumn(selectedCol.key, selectedCol.label)
                    : void removeColumn(selectedCol.key, selectedCol.label))}
                  title={selectedColIsCustom
                    ? `Delete the ${selectedCol.label} column and everything typed in it`
                    : `Take the ${selectedCol.label} column off the ${sheetMonth} sheet — nothing is erased`}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-red-300 bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {selectedColIsCustom ? "Delete" : "Remove"} {selectedCol.label} column
                </button>
              )}
              {/* A removed column is gone from the sheet: nothing lists what
                  was deleted and nothing counts it. "Add column" makes a new
                  blank one of your own, not a way back to a removed built-in. */}
              <button
                onClick={() => { setAddColName(""); setAddColAfter(""); setAddColError(""); setAddColOpen(true) }}
                title="Add a new blank column to this sheet"
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700"
              >
                <Columns3 className="h-3.5 w-3.5" />Add column
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
              selectedKeys={selectedRowIds}
              selectedColumnKey={selectedColKey}
              onColumnSelect={(key) => { setSelectedColKey(key); if (key) setSelectedRowIds(new Set()) }}
              onRowSelect={(r, _key, mods, order) => pickRow(r._id ?? null, mods, order)}
              onPaste={pasteBlock}
              emptyMessage={`Nothing in ${sheetMonth} yet — type the first row on the green line below.`}
              onCellCommit={commitCell}
              newRow={{
                draft,
                onChange: onDraftChange,
                onCommit: addRow,
                busy: adding,
                focusKey: "name",
                hint: "Type across the green line and press Enter (or the ✚ at its end) to add the row. Set DATE to any past day for a visit you didn't get to on the day — a row dated in another month goes onto that month's sheet. Click any cell to correct it; Enter and ↑↓ move down and up the column, Tab moves across. Tick rows (shift-click for a range) to delete them, or click a column heading to empty or remove that column. Ctrl+C copies what you have picked as spreadsheet cells, Ctrl+V pastes a block from Excel over it, and Ctrl+Z takes back the last change.",
              }}
              maxHeight="62vh"
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
