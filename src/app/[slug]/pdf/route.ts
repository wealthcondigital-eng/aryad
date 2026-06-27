import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"

// GET /{slug}/pdf — pretty public PDF link e.g. /sagar-dutta-report/pdf
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await connectDB()
    const { slug } = await params
    const patient = await Patient.findOne({ reportSlug: slug }).select("reportPdf name study")
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
