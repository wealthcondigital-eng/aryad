import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"

// GET /api/patients/:id/pdf — public (no auth) so the shared link works for patients
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const patient = await Patient.findById(id).select("reportPdf name study")
    if (!patient?.reportPdf) {
      return NextResponse.json({ error: "PDF not available" }, { status: 404 })
    }

    const buffer   = Buffer.from(patient.reportPdf, "base64")
    const safeName = (patient.name || "Patient").replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "")
    const fileName = `${safeName}_Report.pdf`

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
