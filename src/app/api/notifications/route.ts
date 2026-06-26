import { NextRequest, NextResponse } from "next/server"
import jwt from "jsonwebtoken"
import { connectDB } from "@/lib/db"
import Notification from "@/models/Notification"

function decodeUser(req: NextRequest): { id: string; role: string } | null {
  try {
    const token = req.cookies.get("aarya_token")?.value
    if (!token) return null
    return jwt.verify(token, process.env.JWT_SECRET!) as { id: string; role: string }
  } catch {
    return null
  }
}

// GET /api/notifications — fetch notifications for current user's role
export async function GET(req: NextRequest) {
  try {
    const user = decodeUser(req)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await connectDB()
    const notifications = await Notification.find({ recipientRole: user.role })
      .sort({ createdAt: -1 })
      .limit(30)

    const items = notifications.map((n) => ({
      _id:      n._id,
      type:     n.type,
      title:    n.title,
      message:  n.message,
      createdAt: n.createdAt,
      isRead:   n.readBy.includes(user.id),
    }))

    return NextResponse.json({
      notifications: items,
      unreadCount: items.filter((n) => !n.isRead).length,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// PATCH /api/notifications — mark all as read for current user
export async function PATCH(req: NextRequest) {
  try {
    const user = decodeUser(req)
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    await connectDB()
    await Notification.updateMany(
      { recipientRole: user.role, readBy: { $ne: user.id } },
      { $push: { readBy: user.id } }
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
