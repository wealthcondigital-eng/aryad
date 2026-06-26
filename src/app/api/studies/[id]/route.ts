import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Study from "@/models/Study"
import { STUDY_CATEGORIES } from "@/lib/study-catalogue"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()

    const update: Record<string, unknown> = {}

    if (body.price !== undefined) {
      const parsed = Number(body.price)
      if (isNaN(parsed) || parsed < 0) {
        return NextResponse.json({ error: "Invalid price" }, { status: 400 })
      }
      update.price = parsed
    }

    if (body.category !== undefined) {
      if (!(STUDY_CATEGORIES as readonly string[]).includes(body.category)) {
        return NextResponse.json({ error: "Invalid category" }, { status: 400 })
      }
      update.category = body.category
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const study = await Study.findByIdAndUpdate(id, { $set: update }, { new: true })
    if (!study) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ study })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
