import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"

// GET /api/report/:slug/pdf — pretty URL; slug ends with the 24-char MongoDB ObjectId
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await connectDB()
    const { slug } = await params
    const id = slug.slice(-24)
    const patient = await Patient.findById(id).select("reportPdf name study")
    if (!patient?.reportPdf) {
      return NextResponse.json({ error: "PDF not available" }, { status: 404 })
    }
    const buffer   = Buffer.from(patient.reportPdf, "base64")
    const fileName = `Report_${(patient.name || "Patient").replace(/\s+/g, "_")}_${(patient.study || "Report").replace(/\s+/g, "_")}.pdf`
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control":       "no-store",
      },
    })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
