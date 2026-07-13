import { NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Signatory from "@/models/Signatory"

// The two consultant radiologists who sign every report — seeded once so the
// signature-image upload UI always has something to attach a picture to,
// even before anyone's uploaded anything.
const DEFAULT_SIGNATORIES = [
  { name: "DR. PRADNYA GORE",  credentials: ["Consultant Radiologist"], order: 0 },
  { name: "DR. RAMNATH GHUTE", credentials: ["Consultant Radiologist", "M.D. Radiology"], order: 1 },
]

// GET /api/signatories — the report signatories, seeding the two known
// doctors on first use so the list is never empty.
export async function GET() {
  try {
    await connectDB()
    let signatories = await Signatory.find().sort({ order: 1 })
    if (signatories.length === 0) {
      await Signatory.insertMany(DEFAULT_SIGNATORIES)
      signatories = await Signatory.find().sort({ order: 1 })
    }
    return NextResponse.json({ signatories })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
