import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import RegisterEntry from "@/models/RegisterEntry"
import RegisterRowRemoval from "@/models/RegisterRowRemoval"
import { applyCellEdits, isSystemRow } from "@/lib/register-cells"

const str = (v: unknown) => (v == null ? "" : String(v).trim())

// PATCH /api/register/[id] — correct one cell (or several) of a row
//
// Every row is editable, including the ones mirrored from a patient record. The
// sheet is the centre's own book: if a figure on it needs correcting, it gets
// corrected here. What keeps that correction is `editedFields` — the next sync
// from the patient rewrites every column of a system row EXCEPT the ones listed
// there, so a typed-over cell is never silently reverted while the rest of the
// row stays in step with the patient. See lib/register-cells.ts.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()

    const entry = await RegisterEntry.findById(id)
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await applyCellEdits(entry, body)
    await entry.save()
    return NextResponse.json({ entry })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// DELETE /api/register/[id] — take one row off the sheet
//
// The row is deleted outright, the way deleting a row in Excel removes it —
// including a row mirrored from a patient. The patient record and their report
// are untouched; only this line goes. The deleted document comes back in the
// response so the page can offer an undo without having to have kept a copy.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params

    const entry = await RegisterEntry.findById(id)
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // The patient is still in the system, so the next registration edit, the
    // next bill, or simply reopening the month would put this row straight
    // back. Recording the removal is what makes the delete stick — see
    // models/RegisterRowRemoval.ts for why it is keyed the way it is.
    if (isSystemRow(entry) && entry.patientId) {
      await RegisterRowRemoval.updateOne(
        { patientId: entry.patientId, studyIndex: entry.studyIndex ?? 0 },
        {
          $set: {
            studyName: str(entry.investigation),
            month:     str(entry.month),
            removedAt: new Date(),
            removedBy: str(req.nextUrl.searchParams.get("by")),
          },
        },
        { upsert: true }
      )
    }

    const removed = entry.toObject()
    await entry.deleteOne()
    return NextResponse.json({ deleted: true, row: removed })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
