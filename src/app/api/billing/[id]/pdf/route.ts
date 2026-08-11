import { NextRequest } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"
import { pdfResponse, pdfFileName, pdfUnavailableResponse } from "@/lib/pdf-response"

// GET /api/billing/:id/pdf — the fallback receipt link, for bills saved before
// slugs existed; anything shared today goes out as /{slug}.pdf.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await connectDB()
    const bill = await Bill.findById(id).select("billPdf patientName")
    if (!bill?.billPdf) return pdfUnavailableResponse("This receipt isn't ready yet.")
    return pdfResponse(bill.billPdf, pdfFileName(bill.patientName, "Receipt"), req)
  } catch {
    return pdfUnavailableResponse("Something went wrong opening this receipt.")
  }
}
