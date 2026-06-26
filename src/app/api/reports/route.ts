import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Report from "@/models/Report"
import Patient from "@/models/Patient"
import Notification from "@/models/Notification"

// GET /api/reports
export async function GET(req: NextRequest) {
  try {
    await connectDB()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get("status")
    const query: Record<string, unknown> = {}
    if (status) query.status = status

    const reports = await Report.find(query).sort({ createdAt: -1 })
    return NextResponse.json({ reports })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/reports — doctor submits a report
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()
    const report = await Report.create({ ...body, status: "submitted" })

    // Update patient reportStatus to completed
    await Patient.findByIdAndUpdate(body.patientId, { reportStatus: "completed" })

    // Notify receptionists that the report has been submitted
    await Notification.create({
      recipientRole: "receptionist",
      type: "report_submitted",
      title: "Report submitted",
      message: `${report.patientName} (Sr. ${report.srNo})${report.study ? ` — ${report.study}` : ""}${report.reportingDoctor ? ` by Dr. ${report.reportingDoctor}` : ""}`,
      patientId: report.patientId,
    })

    return NextResponse.json({ report }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
