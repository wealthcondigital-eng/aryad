import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { connectDB } from "@/lib/db"
import User from "@/models/User"

// PATCH /api/users/[id] — update user (permissions, active, name, role, password)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await connectDB()
    const body = await req.json()
    const { name, role, active, permissions, password } = body

    const update: Record<string, unknown> = {}
    if (name        !== undefined) update.name        = name
    if (role        !== undefined) update.role        = role
    if (active      !== undefined) update.active      = active
    if (permissions !== undefined) update.permissions = permissions
    if (password)                  update.password    = await bcrypt.hash(password, 10)

    const user = await User.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: false }
    ).select("-password")

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
    return NextResponse.json({ user })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// DELETE /api/users/[id] — permanently delete user
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await connectDB()
    const user = await User.findByIdAndDelete(id)
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
