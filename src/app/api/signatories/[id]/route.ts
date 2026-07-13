import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Signatory from "@/models/Signatory"

// PATCH /api/signatories/:id — upload (or clear, by sending an empty string)
// a signatory's signature image.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()
    if (typeof body.signatureImage !== "string") {
      return NextResponse.json({ error: "signatureImage is required" }, { status: 400 })
    }
    const signatory = await Signatory.findByIdAndUpdate(
      id,
      { signatureImage: body.signatureImage },
      { new: true }
    )
    if (!signatory) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ signatory })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
