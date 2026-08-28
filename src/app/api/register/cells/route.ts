import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import RegisterEntry from "@/models/RegisterEntry"
import RegisterRowRemoval from "@/models/RegisterRowRemoval"
import { applyCellEdits } from "@/lib/register-cells"

// Writing many cells at once — the primitive behind pasting a block onto the
// sheet and behind undoing anything that touched more than one cell. One
// request instead of one per cell: a paste of 40 rows is 40 round trips
// otherwise, and an undo that half-applies is worse than no undo at all.
//
// PATCH /api/register/cells
// Body: { updates: [{ id, fields: { department: "X-Ray", paid: 500 } }, ...] }
export async function PATCH(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()
    const updates: { id?: string; fields?: Record<string, unknown> }[] =
      Array.isArray(body.updates) ? body.updates : []

    if (updates.length === 0) return NextResponse.json({ error: "Nothing to write" }, { status: 400 })
    if (updates.length > 2000) return NextResponse.json({ error: "Too many rows in one write" }, { status: 400 })

    const entries = []
    const missing: string[] = []
    for (const u of updates) {
      const id = String(u.id ?? "")
      if (!id || !u.fields) continue
      const entry = await RegisterEntry.findById(id)
      // A row deleted by someone else mid-paste isn't a reason to fail the
      // rest of the block — it is reported instead.
      if (!entry) { missing.push(id); continue }
      await applyCellEdits(entry, u.fields)
      await entry.save()
      entries.push(entry)
    }

    return NextResponse.json({ entries, written: entries.length, missing })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// Putting deleted rows back — the undo for a row delete.
//
// The row is re-inserted with its original _id and importKey so everything that
// pointed at it still does, and the removal record that was keeping a patient
// mirror deleted is cleared, or the next sync would take the row straight back
// off the sheet.
//
// POST /api/register/cells  Body: { restore: [ <row document>, ... ] }
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()
    const rows: Record<string, unknown>[] = Array.isArray(body.restore) ? body.restore : []
    if (rows.length === 0) return NextResponse.json({ error: "Nothing to restore" }, { status: 400 })

    let restored = 0
    for (const row of rows) {
      if (!row?._id) continue
      const { _id, __v: _v, ...rest } = row
      await RegisterEntry.updateOne({ _id }, { $set: rest, $setOnInsert: { _id } }, { upsert: true })
      if (rest.patientId) {
        await RegisterRowRemoval.deleteOne({
          patientId:  rest.patientId,
          studyIndex: (rest.studyIndex as number) ?? 0,
        })
      }
      restored++
    }

    return NextResponse.json({ restored })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
