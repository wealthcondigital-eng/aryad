import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Phrase from "@/models/Phrase"

// GET /api/phrases — the clinic's quick phrases, most recent first
export async function GET() {
  try {
    await connectDB()
    const phrases = await Phrase.find().sort({ name: 1 })
    return NextResponse.json({ phrases })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/phrases — save the current selection as a reusable phrase
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const data = await req.json()
    const name = String(data.name ?? "").trim()
    const body = String(data.body ?? "").trim()
    if (!name || !body) {
      return NextResponse.json({ error: "Name and text are required" }, { status: 400 })
    }

    // Same name = the doctor is correcting the phrase, not collecting duplicates.
    const existing = await Phrase.findOne({
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    })
    if (existing) {
      existing.body = body
      await existing.save()
      return NextResponse.json({ phrase: existing })
    }

    const phrase = await Phrase.create({ name, body })
    return NextResponse.json({ phrase }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// DELETE /api/phrases?id=... — remove one
export async function DELETE(req: NextRequest) {
  try {
    await connectDB()
    const id = req.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })
    await Phrase.findByIdAndDelete(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
