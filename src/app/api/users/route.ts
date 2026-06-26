import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { connectDB } from "@/lib/db"
import User from "@/models/User"

// GET /api/users — list all users (admin only)
export async function GET() {
  try {
    await connectDB()
    const users = await User.find().select("-password").sort({ createdAt: -1 })
    return NextResponse.json({ users })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/users — create a new user (admin only)
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()
    const { name, email, password, role, permissions } = body

    const exists = await User.findOne({ email: email.toLowerCase() })
    if (exists)
      return NextResponse.json({ error: "Email already in use" }, { status: 409 })

    const hashed = await bcrypt.hash(password, 10)
    const user = await User.create({ name, email, password: hashed, role, permissions })

    return NextResponse.json(
      { user: { id: user._id, name: user.name, email: user.email, role: user.role } },
      { status: 201 }
    )
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
