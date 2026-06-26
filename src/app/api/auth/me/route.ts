import { NextRequest, NextResponse } from "next/server"
import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import { connectDB } from "@/lib/db"
import User from "@/models/User"

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("aarya_token")?.value
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string }
    await connectDB()

    const user = await User.findById(decoded.id).select("-password")
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    return NextResponse.json({ user })
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const token = req.cookies.get("aarya_token")?.value
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { id: string }
    await connectDB()

    const body = await req.json()
    const updates: Record<string, string> = {}

    if (body.name?.trim()) updates.name = body.name.trim()
    if (body.password?.trim()) updates.password = await bcrypt.hash(body.password.trim(), 10)

    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })

    const user = await User.findByIdAndUpdate(decoded.id, updates, { returnDocument: "after" }).select("-password")
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    return NextResponse.json({ user })
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 })
  }
}
