import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await connectDB()
    const bill = await Bill.findById(id).select("billPdf patientName")
    if (!bill || !bill.billPdf) {
      return NextResponse.json({ error: "PDF not available" }, { status: 404 })
    }
    const buffer = Buffer.from(bill.billPdf, "base64")
    const safeName = (bill.patientName || "Receipt").replace(/\s+/g, "_")
    const fileName = `${safeName}_Receipt.pdf`
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
