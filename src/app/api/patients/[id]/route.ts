import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Notification from "@/models/Notification"

// GET /api/patients/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const patient = await Patient.findById(id)
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ patient })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// PATCH /api/patients/:id
// Special field: editHistoryEntry — pushed to the FRONT of the editHistory stack
// All other fields are $set normally
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()

    const { editHistoryEntry, registrationEditHistoryEntry, ...regularFields } = body

    // Auto-generate pretty slug when PDF is first saved
    if (regularFields.reportPdf) {
      const cur = await Patient.findById(id).select("name srNo reportSlug")
      if (cur && !cur.reportSlug) {
        const base = cur.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
        let slug = `${base}-report`
        const taken = await Patient.findOne({ reportSlug: slug, _id: { $ne: id } }).select("_id")
        if (taken) slug = `${base}-${cur.srNo}-report`
        regularFields.reportSlug = slug
      }
    }

    // Build update: $set for regular fields, $push to front of stack for history
    const mongoUpdate: Record<string, unknown> = {}
    if (Object.keys(regularFields).length > 0) {
      mongoUpdate.$set = regularFields
    }
    const pushOps: Record<string, unknown> = {}
    if (editHistoryEntry) {
      pushOps.editHistory = { $each: [editHistoryEntry], $position: 0 }
    }
    if (registrationEditHistoryEntry) {
      pushOps.registrationEditHistory = { $each: [registrationEditHistoryEntry], $position: 0 }
    }
    if (Object.keys(pushOps).length > 0) {
      mongoUpdate.$push = pushOps
    }

    const patient = await Patient.findByIdAndUpdate(id, mongoUpdate, { returnDocument: "after" })
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Notify receptionists when doctor submits a completed report
    if (editHistoryEntry && regularFields.reportStatus === "completed") {
      await Notification.create({
        recipientRole: "receptionist",
        type: "report_submitted",
        title: "Report ready",
        message: `${patient.name} (Sr. ${patient.srNo})${patient.study ? ` — ${patient.study}` : ""}`,
        patientId: patient._id,
      })
    }

    // Notify doctors when registration details are edited
    if (registrationEditHistoryEntry) {
      await Notification.create({
        recipientRole: "doctor",
        type: "patient_edited",
        title: "Patient registration updated",
        message: `${patient.name} (Sr. ${patient.srNo}) details were edited`,
        patientId: patient._id,
      })
    }

    return NextResponse.json({ patient })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
