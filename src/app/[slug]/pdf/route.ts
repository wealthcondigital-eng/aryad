import { NextRequest } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Bill from "@/models/Bill"
import { pdfResponse, pdfFileName, pdfUnavailableResponse } from "@/lib/pdf-response"

/**
 * The public document link.
 *
 * Reached two ways, both landing here with the same bare slug:
 *   /mr-yogesh-patel-abd-pel-male-report.pdf   (what patients are sent — the
 *                                               .pdf rewrite in next.config.ts)
 *   /mr-yogesh-patel-abd-pel-male-report/pdf   (older shared links)
 *
 * Report slugs may sit on the legacy top-level field or inside the studies
 * array; receipt slugs live on the Bill collection.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await connectDB()
    const { slug: raw } = await params
    // Belt and braces: the rewrite strips the extension, but a request that
    // somehow arrives with it still resolves to the same document.
    const slug = raw.replace(/\.pdf$/i, "")

    const patient = await Patient.findOne({
      $or: [{ reportSlug: slug }, { "studies.reportSlug": slug }],
    }).select("reportPdf reportSlug name study studies.reportSlug studies.reportPdf studies.name")

    if (patient) {
      let pdf: string | undefined
      let study: string | undefined = patient.study
      if (patient.reportSlug === slug && patient.reportPdf) {
        pdf = patient.reportPdf
      } else {
        const entry = (patient.studies ?? []).find(
          (s: { reportSlug?: string }) => s.reportSlug === slug
        )
        pdf = entry?.reportPdf || (patient.reportSlug === slug ? patient.reportPdf : undefined)
        if (entry?.name) study = entry.name
      }
      if (pdf) return pdfResponse(pdf, pdfFileName(patient.name, "Report", study), req)
      // The slug is real, the file just isn't built yet — say so in HTML, since
      // a person is reading this, not a script.
      return pdfUnavailableResponse("This report isn't ready yet.")
    }

    const bill = await Bill.findOne({ billSlug: slug }).select("billPdf patientName")
    if (bill) {
      if (bill.billPdf) return pdfResponse(bill.billPdf, pdfFileName(bill.patientName, "Receipt"), req)
      return pdfUnavailableResponse("This receipt isn't ready yet.")
    }

    return pdfUnavailableResponse("This link doesn't point to a document.")
  } catch {
    return pdfUnavailableResponse("Something went wrong opening this document.")
  }
}
