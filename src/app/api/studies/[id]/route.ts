import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Study from "@/models/Study"
import Patient from "@/models/Patient"
import RegisterEntry from "@/models/RegisterEntry"
import { canonicalCategory } from "@/lib/study-catalogue"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()

    const update: Record<string, unknown> = {}

    if (body.price !== undefined) {
      const parsed = Number(body.price)
      if (isNaN(parsed) || parsed < 0) {
        return NextResponse.json({ error: "Invalid price" }, { status: 400 })
      }
      update.price = parsed
    }

    // Categories are free-form: the clinic creates its own alongside the five
    // bundled ones, exactly as it does for report templates.
    if (body.category !== undefined) {
      const category = canonicalCategory(body.category)
      if (!category) return NextResponse.json({ error: "A category name is required" }, { status: 400 })
      update.category = category
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const study = await Study.findByIdAndUpdate(id, { $set: update }, { new: true })
    if (!study) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Re-filing a study is a correction, not a new fact about future bookings
    // only: every patient already carrying it, and every register row mirrored
    // from one, moves to the new department too. Rows whose DEPARTMENT was
    // typed over by hand on the sheet keep what was typed.
    let movedRows = 0
    if (update.category !== undefined) {
      const nameRe = new RegExp(`^${study.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
      await Patient.updateMany(
        { "studies.name": nameRe },
        { $set: { "studies.$[s].category": update.category } },
        { arrayFilters: [{ "s.name": nameRe }] }
      )
      const res = await RegisterEntry.updateMany(
        { investigation: nameRe, sourceType: "system", editedFields: { $ne: "department" } },
        { $set: { department: update.category } }
      )
      movedRows = res.modifiedCount ?? 0
    }

    return NextResponse.json({ study, movedRows })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// DELETE /api/studies/:id — remove a study from the catalogue
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const study = await Study.findByIdAndDelete(id)
    if (!study) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
