import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Bill from "@/models/Bill"
import { pdfResponse, pdfFileName, pdfUnavailableResponse } from "@/lib/pdf-response"

// GET /{slug}/pdf — the public file behind a shared link, e.g.
// /sagar-dutta-x-ray-chest-pa-report/pdf or /sagar-dutta-receipt/pdf.
// Report slugs may live on the legacy top-level field or inside the studies
// array; receipt slugs live on the Bill collection.
//
// `?download=1` switches the response from inline to attachment — the share
// page's Download button, for in-app browsers that can't render a PDF.
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await connectDB()
    const { slug } = await params
    const patient = await Patient.findOne({
      $or: [{ reportSlug: slug }, { "studies.reportSlug": slug }],
    }).select("reportPdf reportSlug name study studies.reportSlug studies.reportPdf studies.name")

    if (patient) {
      let pdf: string | undefined
      let studyName: string | undefined = patient.study
      if (patient.reportSlug === slug && patient.reportPdf) {
        pdf = patient.reportPdf
      } else {
        const entry = (patient.studies ?? []).find((s: { reportSlug: string }) => s.reportSlug === slug)
        pdf = entry?.reportPdf || (patient.reportSlug === slug ? patient.reportPdf : undefined)
        if (entry?.name) studyName = entry.name
      }
      if (pdf) return pdfResponse(pdf, pdfFileName(patient.name, "Report", studyName), req)
      // The slug is real, so this is a report that exists but has no PDF yet.
      return pdfUnavailableResponse("This report isn't ready yet.")
    }

    const bill = await Bill.findOne({ billSlug: slug }).select("billPdf patientName")
    if (bill?.billPdf) return pdfResponse(bill.billPdf, pdfFileName(bill.patientName, "Receipt"), req)

    return pdfUnavailableResponse("This link doesn't point to a report.")
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
