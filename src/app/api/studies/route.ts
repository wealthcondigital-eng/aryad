import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Study from "@/models/Study"
import Patient from "@/models/Patient"
import { canonicalCategory } from "@/lib/study-catalogue"
import { resolveStudyCategory } from "@/lib/study-category"

export async function GET() {
  try {
    await connectDB()

    const studies = await Study.find().sort({ category: 1, name: 1 })

    // Real-time stats
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999)
    const testsToday = await Patient.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } })

    const priced    = studies.filter((s) => s.price > 0)
    const avgRevenue = priced.length > 0
      ? Math.round(priced.reduce((sum, s) => sum + s.price, 0) / priced.length)
      : 0

    const categories = new Set(studies.map((s) => s.category)).size

    return NextResponse.json({
      studies,
      stats: { total: studies.length, categories, testsToday, avgRevenue },
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/studies — add a study to the catalogue (receptionist / doctor / admin)
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()

    const name = String(body.name ?? "").trim()
    if (!name) return NextResponse.json({ error: "Study name is required" }, { status: 400 })

    // Categories are whatever the clinic has created — the five bundled ones
    // are only a starting list, not a closed set. An unfiled study is saved
    // uncategorised rather than guessed into the wrong department.
    const category = canonicalCategory(body.category) || await resolveStudyCategory(name)

    const price = Math.max(0, Number(body.price) || 0)

    const existing = await Study.findOne({ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } })
    if (existing) return NextResponse.json({ error: "This study already exists" }, { status: 409 })

    const study = await Study.create({ name, category, price, fromCatalogue: false, firstSeenAt: new Date() })
    return NextResponse.json({ study }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
