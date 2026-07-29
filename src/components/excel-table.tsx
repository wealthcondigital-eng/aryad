"use client"

// A spreadsheet-style data grid with Excel's AutoFilter behaviour: every column
// header carries a funnel that opens a checkbox list of that column's distinct
// values, filters across columns combine with AND, and — like Excel — the values
// offered in one column's dropdown only include those still reachable under the
// *other* columns' filters. Sorting also lives in the dropdown, as it does in Excel.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowDownAZ, ArrowUpAZ, Filter, Loader2, Plus, Search, X } from "lucide-react"

// `text` is the canonical cell string — it drives filtering, sorting and export.
// `render` is optional and only changes what the cell looks like.
export interface ExcelColumn<T> {
  key: string
  label: string
  width?: number
  numeric?: boolean
  align?: "left" | "center" | "right"
  filterable?: boolean          // default true
  total?: boolean               // sum this column in the footer row
  text: (row: T) => string
  sortValue?: (row: T) => number | string
  render?: (row: T) => React.ReactNode
  // ── Inline editing (needs onCellCommit on the table) ──
  editable?: boolean
  inputType?: "text" | "number" | "date"
  options?: string[]            // renders a dropdown instead of a text box
  editValue?: (row: T) => string  // raw value for the editor; defaults to text()
  // Typography for the editor, so a cell being typed into looks like the cells
  // above it rather than like a form field dropped into the sheet
  inputClass?: string
  suggestions?: string[]        // type-ahead list of values already in use
}

// The always-empty row at the bottom of an editable sheet: type across it and it
// becomes a new record, exactly like typing on the next free line in Excel.
export interface NewRowSpec {
  draft: Record<string, string>
  onChange: (key: string, value: string) => void
  onCommit: () => void
  busy?: boolean
  hint?: string
  focusKey?: string   // cell an outside "add row" button should focus; defaults to the first editable one
  at?: "top" | "bottom"   // where the line sits in the sheet; default "top"
}

export type ExcelFilters = Record<string, string[]>

export const BLANK_LABEL = "(Blanks)"

type SortState = { key: string; dir: "asc" | "desc" } | null

function compare(a: number | string, b: number | string) {
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
}

// Single source of truth for a cell's filterable/sortable string
export function cellText<T>(col: ExcelColumn<T>, row: T) {
  return (col.text(row) ?? "").toString().trim() || BLANK_LABEL
}

// Same predicate the grid applies, exposed so callers can mirror the visible
// rows (counts, CSV export) without re-implementing it.
export function filterRows<T>(rows: T[], columns: ExcelColumn<T>[], filters: ExcelFilters): T[] {
  const keys = Object.keys(filters)
  if (keys.length === 0) return rows
  return rows.filter((r) =>
    keys.every((k) => {
      const col = columns.find((c) => c.key === k)
      return !col || filters[k].includes(cellText(col, r))
    })
  )
}

// ── Filter dropdown ──────────────────────────────────────────────────────────
// Rendered into a portal with fixed positioning so it is never clipped by the
// grid's horizontal scroll container.

function FilterMenu({
  anchor, label, options, selected, sort, onSort, onChange, onClose,
}: {
  anchor: DOMRect
  label: string
  options: string[]
  selected: string[] | undefined      // undefined = unfiltered (everything passes)
  sort: SortState
  onSort: (dir: "asc" | "desc" | null) => void
  onChange: (next: string[] | undefined) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  const visible = options.filter((o) => !query || o.toLowerCase().includes(query.toLowerCase()))
  const isChecked = (o: string) => (selected ? selected.includes(o) : true)
  const allVisibleChecked = visible.length > 0 && visible.every(isChecked)

  const toggle = (o: string) => {
    const current = selected ?? options
    const next = current.includes(o) ? current.filter((v) => v !== o) : [...current, o]
    onChange(next.length === options.length ? undefined : next)
  }

  const toggleAllVisible = () => {
    if (allVisibleChecked) {
      const current = selected ?? options
      const next = current.filter((v) => !visible.includes(v))
      onChange(next)
    } else {
      const next = Array.from(new Set([...(selected ?? []), ...visible]))
      onChange(next.length === options.length ? undefined : next)
    }
  }

  const WIDTH = 248
  const left = Math.min(Math.max(8, anchor.left - WIDTH + anchor.width), window.innerWidth - WIDTH - 8)
  const top  = Math.min(anchor.bottom + 4, window.innerHeight - 380)

  return createPortal(
    <div
      ref={ref}
      style={{ position: "fixed", left, top, width: WIDTH, zIndex: 60 }}
      className="bg-white rounded-lg shadow-2xl border border-gray-200 text-sm overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <span className="text-xs font-semibold text-gray-500 uppercase truncate">{label}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="py-1 border-b border-gray-100">
        <button
          onClick={() => onSort(sort?.key && sort.dir === "asc" ? null : "asc")}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 ${sort?.dir === "asc" ? "text-blue-600 font-semibold" : "text-gray-600"}`}
        >
          <ArrowUpAZ className="h-3.5 w-3.5" />Sort Ascending
        </button>
        <button
          onClick={() => onSort(sort?.key && sort.dir === "desc" ? null : "desc")}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 ${sort?.dir === "desc" ? "text-blue-600 font-semibold" : "text-gray-600"}`}
        >
          <ArrowDownAZ className="h-3.5 w-3.5" />Sort Descending
        </button>
      </div>

      <div className="p-2 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search values…"
            className="w-full h-7 pl-7 pr-2 text-xs border border-gray-200 rounded outline-none focus:border-blue-400"
          />
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto py-1">
        <label className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 cursor-pointer">
          <input type="checkbox" checked={allVisibleChecked} onChange={toggleAllVisible} className="h-3.5 w-3.5 accent-blue-600" />
          <span className="text-xs font-semibold text-gray-700">(Select All)</span>
        </label>
        {visible.map((o) => (
          <label key={o} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 cursor-pointer">
            <input type="checkbox" checked={isChecked(o)} onChange={() => toggle(o)} className="h-3.5 w-3.5 accent-blue-600" />
            <span className="text-xs text-gray-700 truncate" title={o}>{o}</span>
          </label>
        ))}
        {visible.length === 0 && <p className="px-3 py-3 text-xs text-gray-400 text-center">No matching values</p>}
      </div>

      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-t border-gray-100">
        <button onClick={() => onChange(undefined)} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
          Clear filter
        </button>
        <button onClick={onClose} className="text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded">
          Done
        </button>
      </div>
    </div>,
    document.body
  )
}

// ── Grid ─────────────────────────────────────────────────────────────────────

export function ExcelTable<T>({
  rows, columns, filters, onFiltersChange, rowKey, emptyMessage = "No rows match the current filters.", maxHeight = "62vh",
  onCellCommit, isRowLocked, newRow,
}: {
  rows: T[]
  columns: ExcelColumn<T>[]
  filters: ExcelFilters
  onFiltersChange: (next: ExcelFilters) => void
  rowKey: (row: T, i: number) => string
  emptyMessage?: string
  maxHeight?: string
  // Supplying this turns cells marked `editable` into click-to-type cells
  onCellCommit?: (row: T, colKey: string, value: string) => void | Promise<void>
  isRowLocked?: (row: T) => boolean
  newRow?: NewRowSpec
}) {
  const [sort, setSort] = useState<SortState>(null)
  const [open, setOpen] = useState<{ key: string; rect: DOMRect } | null>(null)
  // Which cell is open for typing, and what has been typed into it so far
  const [edit, setEdit] = useState<{ rowKey: string; colKey: string; value: string } | null>(null)
  const uid = useId()

  const editableKeys = columns.filter((c) => c.editable).map((c) => c.key)
  // Marked on the new row's first input so an "Add row" button elsewhere can focus it
  const firstEditableKey = editableKeys[0]

  const beginEdit = (row: T, key: string, col: ExcelColumn<T>) => {
    if (!onCellCommit || !col.editable || isRowLocked?.(row)) return
    setEdit({ rowKey: key, colKey: col.key, value: (col.editValue ?? col.text)(row) ?? "" })
  }

  // Tab moves the editor to the next cell, which unmounts the input; without
  // this the old input's blur would fire a second write against the new cell.
  const skipBlur = useRef(false)

  const commitEdit = async (row: T, original: string, moveTo?: string) => {
    if (!edit) return
    const { colKey, value } = edit
    if (moveTo) skipBlur.current = true
    if (moveTo) {
      const col = columns.find((c) => c.key === moveTo)
      setEdit(col ? { rowKey: edit.rowKey, colKey: moveTo, value: (col.editValue ?? col.text)(row) ?? "" } : null)
    } else {
      setEdit(null)
    }
    if (value !== original) await onCellCommit?.(row, colKey, value)
  }

  // Tab / Shift-Tab walk the editable cells of the row, like a spreadsheet
  const neighbourKey = (colKey: string, dir: 1 | -1) => {
    const i = editableKeys.indexOf(colKey)
    return i < 0 ? undefined : editableKeys[i + dir]
  }

  // Cell text matrix — filtering, sorting and the value lists all read from here
  const grid = useMemo(
    () => rows.map((r) => {
      const cells: Record<string, string> = {}
      for (const c of columns) cells[c.key] = cellText(c, r)
      return cells
    }),
    [rows, columns]
  )

  const passes = useCallback(
    (i: number, exceptKey?: string) => {
      for (const [key, allowed] of Object.entries(filters)) {
        if (key === exceptKey || !allowed) continue
        if (!allowed.includes(grid[i][key])) return false
      }
      return true
    },
    [filters, grid]
  )

  const visibleRows = useMemo(() => {
    const idx = rows.map((_, i) => i).filter((i) => passes(i))
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      if (col) {
        const val = (i: number) =>
          col.sortValue ? col.sortValue(rows[i]) : col.numeric ? Number(grid[i][col.key].replace(/[^\d.-]/g, "")) || 0 : grid[i][col.key]
        idx.sort((a, b) => (sort.dir === "asc" ? 1 : -1) * compare(val(a), val(b)))
      }
    }
    return idx
  }, [rows, grid, passes, sort, columns])

  // Excel behaviour: a column's dropdown lists values still reachable under the
  // other columns' filters, not the whole raw set.
  const optionsFor = (key: string) => {
    const set = new Set<string>()
    rows.forEach((_, i) => { if (passes(i, key)) set.add(grid[i][key]) })
    const col = columns.find((c) => c.key === key)
    return Array.from(set).sort((a, b) => {
      if (a === BLANK_LABEL) return 1
      if (b === BLANK_LABEL) return -1
      return col?.numeric ? Number(a.replace(/[^\d.-]/g, "")) - Number(b.replace(/[^\d.-]/g, "")) : compare(a, b)
    })
  }

  const totals = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of columns) {
      if (!c.total) continue
      out[c.key] = visibleRows.reduce((s, i) => s + (Number(grid[i][c.key].replace(/[^\d.-]/g, "")) || 0), 0)
    }
    return out
  }, [columns, visibleRows, grid])

  const activeKeys = Object.keys(filters)

  const align = (c: ExcelColumn<T>) =>
    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"

  // Editors are deliberately chrome-less and carry the column's own alignment and
  // type styling, so typing into a cell looks like the rows above it: same size,
  // same weight, same colour, text landing on the same baseline.
  const CELL_PAD  = "px-2 py-1.5"
  const inputCls = (c: ExcelColumn<T>) =>
    `w-full block p-0 m-0 h-[18px] leading-[18px] text-xs bg-transparent border-0 outline-none appearance-none ${align(c)} ${c.inputClass ?? "text-gray-700"}`

  const listId = (key: string) => `${uid}-dl-${key}`

  // A stored value the column doesn't list (the system writes "Male" where the
  // sheets write "M") must still be selectable, or opening the dropdown would
  // silently blank it.
  const selectOptions = (c: ExcelColumn<T>, value: string) =>
    value && !c.options?.includes(value) ? [value, ...(c.options ?? [])] : c.options ?? []

  // The blank entry line, rendered above or below the saved rows
  const newRowTr = newRow ? (
            
              <tr className="bg-emerald-50/30">
                {columns.map((c, ci) => (
                  <td key={c.key} className={`border border-emerald-200 ${CELL_PAD} align-middle ${align(c)}`}>
                    {c.editable ? (
                      c.options ? (
                        <select
                          value={newRow.draft[c.key] ?? ""}
                          onChange={(e) => newRow.onChange(c.key, e.target.value)}
                          className={inputCls(c)}
                        >
                          <option value=""></option>
                          {selectOptions(c, newRow.draft[c.key] ?? "").map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          type={c.inputType ?? "text"}
                          value={newRow.draft[c.key] ?? ""}
                          placeholder={c.label}
                          list={c.suggestions?.length ? listId(c.key) : undefined}
                          data-newrow-first={c.key === (newRow.focusKey ?? firstEditableKey) ? "true" : undefined}
                          onChange={(e) => newRow.onChange(c.key, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); newRow.onCommit() } }}
                          className={`${inputCls(c)} placeholder:text-emerald-800/25 placeholder:font-normal`}
                        />
                      )
                    ) : ci === columns.length - 1 ? (
                      // Enter works from any cell, but the button makes it obvious
                      <button
                        onClick={newRow.onCommit}
                        disabled={newRow.busy}
                        title="Add this row (or press Enter)"
                        className="h-[18px] w-6 mx-auto rounded bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center disabled:opacity-60"
                      >
                        {newRow.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      </button>
                    ) : (
                      <div className="h-[18px] flex items-center justify-center">
                        <span className="text-[10px] text-emerald-700/50">new</span>
                      </div>
                    )}
                  </td>
                ))}
              </tr>
              ) : null

  return (
    <div className="flex flex-col min-w-0">
      {/* Active filter chips */}
      {activeKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-gray-100 bg-blue-50/40">
          <span className="text-[11px] font-semibold text-gray-500 uppercase mr-1">Filters</span>
          {activeKeys.map((k) => {
            const col = columns.find((c) => c.key === k)
            const vals = filters[k]
            return (
              <span key={k} className="inline-flex items-center gap-1 text-[11px] bg-white border border-blue-200 text-blue-700 rounded-full pl-2 pr-1 py-0.5 max-w-[240px]">
                <strong className="font-semibold">{col?.label ?? k}:</strong>
                <span className="truncate">{vals.length <= 2 ? vals.join(", ") || "none" : `${vals.length} selected`}</span>
                <button
                  onClick={() => { const next = { ...filters }; delete next[k]; onFiltersChange(next) }}
                  className="h-3.5 w-3.5 rounded-full hover:bg-blue-100 flex items-center justify-center shrink-0"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )
          })}
          <button onClick={() => onFiltersChange({})} className="text-[11px] font-semibold text-gray-500 hover:text-red-600 ml-1">
            Clear all
          </button>
        </div>
      )}

      {newRow?.hint && (
        <p className="px-3 py-1.5 text-[11px] text-emerald-700 bg-emerald-50/60 border-b border-emerald-100">
          {newRow.hint}
        </p>
      )}

      {/* Grid */}
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-collapse text-xs" style={{ minWidth: columns.reduce((s, c) => s + (c.width ?? 120), 0) }}>
          <thead>
            <tr>
              {columns.map((c) => {
                const filtered = filters[c.key] !== undefined
                const sorted   = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    style={{ width: c.width, minWidth: c.width }}
                    className={`sticky top-0 z-20 bg-slate-100 border border-gray-200 px-2 py-2 font-bold text-[10.5px] uppercase tracking-wide text-gray-600 whitespace-nowrap ${align(c)}`}
                  >
                    <div className="flex items-center gap-1 justify-between">
                      <span className="truncate">{c.label}</span>
                      {c.filterable !== false && (
                        <button
                          onClick={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                            setOpen(open?.key === c.key ? null : { key: c.key, rect })
                          }}
                          className={`h-4 w-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                            filtered || sorted ? "bg-blue-600 text-white" : "text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                          }`}
                          title={filtered ? "Filtered" : "Filter / sort"}
                        >
                          <Filter className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {/* New rows are typed at the top by default, so the entry line is
                right under the headers and never scrolled away from */}
            {newRow?.at === "bottom" ? null : newRowTr}

            {visibleRows.map((i, n) => {
              const row    = rows[i]
              const key    = rowKey(row, i)
              const locked = isRowLocked?.(row) ?? false
              return (
                <tr key={key} className={n % 2 ? "bg-slate-50/60" : "bg-white"}>
                  {columns.map((c) => {
                    const canEdit   = !!onCellCommit && !!c.editable && !locked
                    const isEditing = edit?.rowKey === key && edit.colKey === c.key
                    const original  = (c.editValue ?? c.text)(row) ?? ""

                    if (isEditing) {
                      const common = {
                        autoFocus: true,
                        value: edit.value,
                        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
                          setEdit({ ...edit, value: e.target.value }),
                        onBlur: () => {
                          if (skipBlur.current) { skipBlur.current = false; return }
                          commitEdit(row, original)
                        },
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === "Enter")       { e.preventDefault(); commitEdit(row, original) }
                          else if (e.key === "Escape") { e.preventDefault(); setEdit(null) }
                          else if (e.key === "Tab")    {
                            e.preventDefault()
                            commitEdit(row, original, neighbourKey(c.key, e.shiftKey ? -1 : 1))
                          }
                        },
                        className: inputCls(c),
                      }
                      return (
                        <td key={c.key} className={`border border-blue-400 ${CELL_PAD} bg-blue-50/40 align-middle`}>
                          {c.options
                            ? <select {...common}>
                                <option value=""></option>
                                {selectOptions(c, edit.value).map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            : <input
                                type={c.inputType ?? "text"}
                                list={c.suggestions?.length ? listId(c.key) : undefined}
                                {...common}
                              />}
                        </td>
                      )
                    }

                    return (
                      <td
                        key={c.key}
                        onClick={canEdit ? () => beginEdit(row, key, c) : undefined}
                        title={canEdit ? "Click to edit" : locked && c.editable ? "Comes from a patient record" : undefined}
                        className={`border border-gray-200 ${CELL_PAD} text-gray-700 align-middle ${align(c)} ${
                          canEdit ? "cursor-text hover:bg-blue-50/60 hover:ring-1 hover:ring-inset hover:ring-blue-200" : ""
                        }`}
                      >
                        {c.render ? c.render(row) : grid[i][c.key] === BLANK_LABEL ? <span className="text-gray-300">—</span> : grid[i][c.key]}
                      </td>
                    )
                  })}
                </tr>
              )
            })}

            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="border border-gray-200 text-center py-10 text-gray-400">
                  {emptyMessage}
                </td>
              </tr>
            )}

            {newRow?.at === "bottom" ? newRowTr : null}
          </tbody>

          {visibleRows.length > 0 && Object.keys(totals).length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, ci) => (
                  <td key={c.key} className={`sticky bottom-0 z-10 bg-slate-100 border border-gray-200 px-2 py-1.5 font-bold text-gray-700 ${align(c)}`}>
                    {ci === 0 ? `${visibleRows.length} rows` : c.total ? `₹${totals[c.key].toLocaleString("en-IN")}` : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Type-ahead lists for the editable columns — native, so they behave the
          same in a cell as they do anywhere else in the browser */}
      {columns.filter((c) => c.suggestions?.length).map((c) => (
        <datalist key={c.key} id={listId(c.key)}>
          {c.suggestions!.slice(0, 500).map((s) => <option key={s} value={s} />)}
        </datalist>
      ))}

      {open && (
        <FilterMenu
          anchor={open.rect}
          label={columns.find((c) => c.key === open.key)?.label ?? open.key}
          options={optionsFor(open.key)}
          selected={filters[open.key]}
          sort={sort?.key === open.key ? sort : null}
          onSort={(dir) => setSort(dir ? { key: open.key, dir } : null)}
          onChange={(next) => {
            const nextFilters = { ...filters }
            if (next === undefined) delete nextFilters[open.key]
            else nextFilters[open.key] = next
            onFiltersChange(nextFilters)
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

// CSV of exactly what the grid shows, so the view can go straight back to Excel.
export function toCsv<T>(rows: T[], columns: ExcelColumn<T>[]) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const head = columns.map((c) => esc(c.label)).join(",")
  const body = rows.map((r) => columns.map((c) => esc((c.text(r) ?? "").toString())).join(",")).join("\n")
  return `${head}\n${body}`
}
