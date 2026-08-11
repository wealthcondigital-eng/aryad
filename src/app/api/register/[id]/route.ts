import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import RegisterEntry from "@/models/RegisterEntry"

const str = (v: unknown) => (v == null ? "" : String(v).trim())
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// A patient mirror is identified by its import key as well as its sourceType, so
// rows written before sourceType existed are still recognised as system rows.
function isSystemRow(entry: { sourceType?: string; patientId?: unknown; importKey?: string }) {
  return entry.sourceType === "system" || !!entry.patientId || String(entry.importKey ?? "").startsWith("sys::")
}

const EDITABLE = [
  "srNo", "date", "name", "age", "gender", "contact", "department",
  "investigation", "referredBy", "paymentType", "charges", "discount",
  "paid", "balance", "entryBy",
] as const

// PATCH /api/register/[id] — correct one cell (or several) of a row
//
// Every row is editable, including the ones mirrored from a patient record. The
// sheet is the centre's own book: if a figure on it needs correcting, it gets
// corrected here. What keeps that correction is `editedFields` — the next sync
// from the patient rewrites every column of a system row EXCEPT the ones listed
// there, so a typed-over cell is never silently reverted while the rest of the
// row stays in step with the patient.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()

    const entry = await RegisterEntry.findById(id)
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const system = isSystemRow(entry)
    const edited = new Set<string>(entry.editedFields ?? [])

    for (const key of EDITABLE) {
      if (!(key in body)) continue
      const v = body[key]
      if (system) edited.add(key)
      switch (key) {
        case "srNo":
        case "age":
          entry[key] = v == null || str(v) === "" ? null : num(v); break
        case "charges": case "discount": case "paid": case "balance":
          entry[key] = num(v); break
        case "date": {
          const d = v ? new Date(v) : null
          entry.date = d && !isNaN(d.getTime()) ? d : null
          break
        }
        default:
          entry[key] = str(v)
      }
    }

    // Keep the balance honest unless it was explicitly supplied
    if (!("balance" in body)) {
      entry.balance = Math.max(0, entry.charges - entry.discount - entry.paid)
      // A balance recomputed from a hand-set figure is itself hand-set, or the
      // next sync would put the patient's balance back over this row's money.
      if (system && edited.size > 0) edited.add("balance")
    }

    if (system) entry.editedFields = Array.from(edited)

    await entry.save()
    return NextResponse.json({ entry })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// DELETE /api/register/[id] — take one row off the sheet
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params

    const entry = await RegisterEntry.findById(id)
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // A system row is hidden rather than deleted: the patient it mirrors is
    // still in the system, so a deleted row would simply reappear on the next
    // sync or the next time the month is opened. Hiding sticks, and the patient
    // record itself is untouched either way.
    if (isSystemRow(entry)) {
      entry.hidden = true
      await entry.save()
      return NextResponse.json({ deleted: true, hidden: true })
    }

    await entry.deleteOne()
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
