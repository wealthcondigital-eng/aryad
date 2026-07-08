import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"

// GET /{slug}/pdf — pretty public PDF link e.g. /sagar-dutta-x-ray-chest-pa-report/pdf
// The slug may live on the legacy top-level field or inside the studies array.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await connectDB()
    const { slug } = await params
    const patient = await Patient.findOne({
      $or: [{ reportSlug: slug }, { "studies.reportSlug": slug }],
    }).select("reportPdf reportSlug name study studies.reportSlug studies.reportPdf studies.name")

    if (!patient) return NextResponse.json({ error: "PDF not available" }, { status: 404 })

    let pdf: string | undefined
    if (patient.reportSlug === slug && patient.reportPdf) {
      pdf = patient.reportPdf
    } else {
      const entry = (patient.studies ?? []).find((s: { reportSlug: string }) => s.reportSlug === slug)
      pdf = entry?.reportPdf || (patient.reportSlug === slug ? patient.reportPdf : undefined)
    }
    if (!pdf) return NextResponse.json({ error: "PDF not available" }, { status: 404 })

    const buffer   = Buffer.from(pdf, "base64")
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
