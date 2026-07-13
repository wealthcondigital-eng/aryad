import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { connectDB } from "@/lib/db"
import User from "@/models/User"
import { sendPasswordResetOtp } from "@/lib/mailer"

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email)
      return NextResponse.json({ error: "Email is required" }, { status: 400 })

    await connectDB()

    const user = await User.findOne({ email: email.toLowerCase(), active: true })

    // Always return a generic message so we don't reveal which emails are registered.
    if (user) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString()
      user.resetOtpHash = await bcrypt.hash(otp, 10)
      user.resetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000)
      user.resetOtpAttempts = 0
      await user.save()

      await sendPasswordResetOtp(user.email, user.name, otp)
    }

    return NextResponse.json({ message: "If that email is registered, an OTP has been sent." })
  } catch (err) {
    console.error("Forgot password error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
