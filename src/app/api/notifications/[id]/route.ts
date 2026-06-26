import { NextRequest, NextResponse } from "next/server"
import jwt from "jsonwebtoken"
import { connectDB } from "@/lib/db"
import Notification from "@/models/Notification"

// PATCH /api/notifications/:id — mark one notification as read
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = req.cookies.get("aarya_token")?.value
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string }

    await connectDB()
    const { id } = await params
    await Notification.findByIdAndUpdate(id, { $addToSet: { readBy: decoded.id } })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
