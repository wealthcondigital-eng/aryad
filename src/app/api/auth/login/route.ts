import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { connectDB } from "@/lib/db"
import User from "@/models/User"

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()

    if (!email || !password)
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 })

    await connectDB()

    const user = await User.findOne({ email: email.toLowerCase(), active: true })
    if (!user)
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid)
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    )

    const res = NextResponse.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
      },
    })

    res.cookies.set("aarya_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    })

    return res
  } catch (err) {
    console.error("Login error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
