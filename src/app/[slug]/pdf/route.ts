import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Bill from "@/models/Bill"

function pdfResponse(base64: string, fileName: string) {
  const buffer = Buffer.from(base64, "base64")
  return new NextResponse(buffer, {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control":       "no-store",
    },
  })
}

function safeName(name?: string) {
  return (name || "Patient").replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "")
}

// GET /{slug}/pdf — pretty public PDF link, e.g. /sagar-dutta-x-ray-chest-pa-report/pdf
// or /sagar-dutta-receipt/pdf. Report slugs may live on the legacy top-level field
// or inside the studies array; receipt slugs live on the Bill collection.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await connectDB()
    const { slug } = await params
    const patient = await Patient.findOne({
      $or: [{ reportSlug: slug }, { "studies.reportSlug": slug }],
    }).select("reportPdf reportSlug name study studies.reportSlug studies.reportPdf studies.name")

    if (patient) {
      let pdf: string | undefined
      if (patient.reportSlug === slug && patient.reportPdf) {
        pdf = patient.reportPdf
      } else {
        const entry = (patient.studies ?? []).find((s: { reportSlug: string }) => s.reportSlug === slug)
        pdf = entry?.reportPdf || (patient.reportSlug === slug ? patient.reportPdf : undefined)
      }
      if (pdf) return pdfResponse(pdf, `${safeName(patient.name)}_Report.pdf`)
    }

    const bill = await Bill.findOne({ billSlug: slug }).select("billPdf patientName")
    if (bill?.billPdf) return pdfResponse(bill.billPdf, `${safeName(bill.patientName)}_Receipt.pdf`)

    return NextResponse.json({ error: "PDF not available" }, { status: 404 })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
