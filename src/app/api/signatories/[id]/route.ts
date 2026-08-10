import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Signatory from "@/models/Signatory"

// PATCH /api/signatories/:id — a signatory's signature image and/or the lines
// printed under their name.
//
// The credential lines used to exist only as a seed in the parent route, which
// meant the block under a doctor's name could never say anything the code
// didn't already say — a registration number, a qualification, a second
// specialty. They are the clinic's data, so they are editable.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()

    const update: { signatureImage?: string; credentials?: string[]; name?: string } = {}
    if (typeof body.signatureImage === "string") update.signatureImage = body.signatureImage
    if (Array.isArray(body.credentials)) {
      update.credentials = body.credentials
        .map((line: unknown) => String(line ?? "").trim())
        .filter(Boolean)
        .slice(0, 6)   // the column is a few lines under a name, not a CV
    }
    if (typeof body.name === "string" && body.name.trim()) update.name = body.name.trim()

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const signatory = await Signatory.findByIdAndUpdate(id, update, { new: true })
    if (!signatory) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ signatory })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
