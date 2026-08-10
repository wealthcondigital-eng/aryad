import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"
import { pdfResponse, pdfFileName, pdfUnavailableResponse } from "@/lib/pdf-response"

// GET /api/billing/:id/pdf — public, same as the report links: a receipt sent
// on WhatsApp is opened by the patient, not by a logged-in user.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await connectDB()
    const bill = await Bill.findById(id).select("billPdf patientName")
    if (!bill?.billPdf) return pdfUnavailableResponse("This receipt isn't ready yet.")

    return pdfResponse(bill.billPdf, pdfFileName(bill.patientName, "Receipt"), req)
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
