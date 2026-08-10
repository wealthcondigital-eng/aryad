import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import { pdfResponse, pdfFileName, pdfUnavailableResponse } from "@/lib/pdf-response"

// GET /api/report/:slug/pdf — legacy pretty URL; the slug ends with the
// 24-char MongoDB ObjectId. Kept working so links already sent to patients
// keep opening.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await connectDB()
    const { slug } = await params
    const id = slug.slice(-24)
    const patient = await Patient.findById(id).select("reportPdf name study")
    if (!patient?.reportPdf) return pdfUnavailableResponse("This report isn't ready yet.")

    return pdfResponse(patient.reportPdf, pdfFileName(patient.name, "Report", patient.study), req)
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
