import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Report from "@/models/Report"
import Notification from "@/models/Notification"

// GET /api/reports/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const report = await Report.findById(id)
    if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ report })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// PATCH /api/reports/:id — doctor edits a report
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()
    const report = await Report.findByIdAndUpdate(id, body, { returnDocument: "after" })
    if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Notify receptionists when doctor edits an already-submitted report
    await Notification.create({
      recipientRole: "receptionist",
      type: "report_updated",
      title: "Report edited by doctor",
      message: `${report.patientName} (Sr. ${report.srNo})${report.reportingDoctor ? ` by Dr. ${report.reportingDoctor}` : ""}`,
      patientId: report.patientId,
    })

    return NextResponse.json({ report })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
