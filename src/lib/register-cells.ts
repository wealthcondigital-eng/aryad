// Writing cells on a register row.
//
// Extracted so the three ways cells get written all behave identically: typing
// into one cell, pasting a block over many, and undoing either of those. The
// rules that make a system row safe to type on — recording what was typed over
// in `editedFields`, keeping the balance honest, moving a row to the sheet its
// date belongs to — have to hold whichever way the write arrived.

import RegisterEntry from "@/models/RegisterEntry"
import { ensureRegisterSheet } from "@/lib/register-sheet"
import { registerMonthLabel, nextRegisterSerial } from "@/lib/register-sync"
import { isCustomColumn } from "@/lib/register-column-keys"

export const EDITABLE_CELLS = [
  "srNo", "date", "name", "age", "gender", "contact", "department",
  "investigation", "referredBy", "paymentType", "charges", "discount",
  "paid", "balance", "entryBy",
] as const

export type EditableCell = (typeof EDITABLE_CELLS)[number]

// Re-exported so server code has one import for the whole cell-writing story.
// They live in their own module because the grid in the browser needs them too,
// and this one pulls in Mongoose.
export { CUSTOM_COLUMN_PREFIX, isCustomColumn, customColumnKey } from "@/lib/register-column-keys"

const str = (v: unknown) => (v == null ? "" : String(v).trim())
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// A patient mirror is identified by its import key as well as its sourceType,
// so rows written before sourceType existed are still recognised as system rows.
export function isSystemRow(entry: { sourceType?: string; patientId?: unknown; importKey?: string }) {
  return entry.sourceType === "system" || !!entry.patientId || String(entry.importKey ?? "").startsWith("sys::")
}

type Entry = InstanceType<typeof RegisterEntry>

/**
 * Apply a set of cell values to one row, in place. The caller saves.
 * Only keys in EDITABLE_CELLS are touched; anything else is ignored.
 */
export async function applyCellEdits(entry: Entry, fields: Record<string, unknown>): Promise<void> {
  const system = isSystemRow(entry)
  const edited = new Set<string>(entry.editedFields ?? [])

  for (const key of EDITABLE_CELLS) {
    if (!(key in fields)) continue
    const v = fields[key]
    if (system) edited.add(key)
    switch (key) {
      case "srNo":
      case "age":
        entry[key] = v == null || str(v) === "" ? null : num(v); break
      case "charges": case "discount": case "paid": case "balance":
        entry[key] = num(v); break
      case "date": {
        const d = v ? new Date(v as string) : null
        entry.date = d && !isNaN(d.getTime()) ? d : null
        // Correcting a row's date to one in another month moves the row to that
        // month's sheet — the sheet a row belongs on IS its date, and leaving it
        // behind would file a July visit under August.
        if (entry.date) {
          const moved = registerMonthLabel(entry.date)
          if (moved !== entry.month) {
            entry.month = moved
            entry.srNo  = await nextRegisterSerial(moved)
            await ensureRegisterSheet(moved, "system")
          }
        }
        break
      }
      default:
        entry[key] = str(v)
    }
  }

  // Columns the clinic added itself. They are plain text and live together in
  // `extra`, but a typed-over value has to stick on a patient mirror exactly
  // like one in a built-in column, so they go on the edited list too.
  const custom = Object.keys(fields).filter(isCustomColumn)
  if (custom.length > 0) {
    const extra: Record<string, string> = { ...(entry.extra ?? {}) }
    for (const key of custom) {
      extra[key] = str(fields[key])
      if (system) edited.add(key)
    }
    entry.extra = extra
    entry.markModified("extra")
  }

  // Keep the balance honest unless it was explicitly supplied
  if (!("balance" in fields)) {
    entry.balance = Math.max(0, entry.charges - entry.discount - entry.paid)
    // A balance recomputed from a hand-set figure is itself hand-set, or the
    // next sync would put the patient's balance back over this row's money.
    if (system && edited.size > 0) edited.add("balance")
  }

  if (system) entry.editedFields = Array.from(edited)
}
