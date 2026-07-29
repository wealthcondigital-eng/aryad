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

// PATCH /api/register/[id] — correct one row of a month
//
// Rows mirrored from a patient record (sourceType "system") are not editable
// here: the patient record is their source, and the next sync would overwrite
// anything typed over them. Edit the patient instead.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()

    const entry = await RegisterEntry.findById(id)
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (isSystemRow(entry)) {
      return NextResponse.json(
        { error: "This row mirrors a patient record — edit the patient to change it" },
        { status: 409 }
      )
    }

    for (const key of EDITABLE) {
      if (!(key in body)) continue
      const v = body[key]
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
    }

    await entry.save()
    return NextResponse.json({ entry })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// DELETE /api/register/[id] — remove one row
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params

    const entry = await RegisterEntry.findById(id)
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (isSystemRow(entry)) {
      return NextResponse.json(
        { error: "This row mirrors a patient record — delete the patient's study instead" },
        { status: 409 }
      )
    }

    await entry.deleteOne()
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
