import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import { pdfResponse, pdfFileName, pdfUnavailableResponse } from "@/lib/pdf-response"

// GET /api/patients/:id/pdf?sidx=N — public (no auth) so a shared link works
// for the patient. The fallback used when a report has no pretty slug yet.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const sidx = parseInt(new URL(req.url).searchParams.get("sidx") ?? "0", 10) || 0
    const patient = await Patient.findById(id).select("reportPdf name study studies.reportPdf studies.name")
    const pdf: string | undefined = patient?.studies?.[sidx]?.reportPdf || patient?.reportPdf
    if (!pdf) return pdfUnavailableResponse("This report isn't ready yet.")

    const studyName = patient?.studies?.[sidx]?.name || patient?.study
    return pdfResponse(pdf, pdfFileName(patient?.name, "Report", studyName), req)
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
