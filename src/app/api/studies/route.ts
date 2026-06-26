import { NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Study from "@/models/Study"
import Patient from "@/models/Patient"

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
