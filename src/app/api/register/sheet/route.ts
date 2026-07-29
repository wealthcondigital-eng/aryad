import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import RegisterSheet from "@/models/RegisterSheet"

// POST /api/register/sheet — start a month's sheet
//
// Recorded separately from its rows so an empty sheet still has a tab after a
// refresh. Importing or typing into a month creates its sheet too, so the tab
// strip is the same list either way.
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body  = await req.json()
    const month = String(body.month ?? "").trim()
    if (!month) return NextResponse.json({ error: "month is required" }, { status: 400 })
    if (isNaN(new Date(`1 ${month}`).getTime())) {
      return NextResponse.json({ error: `"${month}" is not a month` }, { status: 400 })
    }

    const sheet = await RegisterSheet.findOneAndUpdate(
      { month },
      { $setOnInsert: { month, createdBy: String(body.createdBy ?? "").trim() } },
      { upsert: true, new: true }
    )

    return NextResponse.json({ sheet }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
