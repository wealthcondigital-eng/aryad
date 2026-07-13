import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { connectDB } from "@/lib/db"
import User from "@/models/User"

export async function POST(req: NextRequest) {
  try {
    const { email, otp, newPassword } = await req.json()
    if (!email || !otp || !newPassword)
      return NextResponse.json({ error: "Email, OTP and new password are required" }, { status: 400 })
    if (newPassword.length < 6)
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 })

    await connectDB()

    const user = await User.findOne({ email: email.toLowerCase(), active: true })
      .select("+resetOtpHash +resetOtpExpiresAt +resetOtpAttempts")

    if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt)
      return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 })

    if (user.resetOtpExpiresAt.getTime() < Date.now()) {
      user.resetOtpHash = undefined
      user.resetOtpExpiresAt = undefined
      user.resetOtpAttempts = 0
      await user.save()
      return NextResponse.json({ error: "OTP has expired. Please request a new one." }, { status: 400 })
    }

    if ((user.resetOtpAttempts ?? 0) >= 5)
      return NextResponse.json({ error: "Too many incorrect attempts. Please request a new OTP." }, { status: 429 })

    const valid = await bcrypt.compare(otp, user.resetOtpHash)
    if (!valid) {
      user.resetOtpAttempts = (user.resetOtpAttempts ?? 0) + 1
      await user.save()
      return NextResponse.json({ error: "Incorrect OTP" }, { status: 401 })
    }

    user.password = await bcrypt.hash(newPassword, 10)
    user.resetOtpHash = undefined
    user.resetOtpExpiresAt = undefined
    user.resetOtpAttempts = 0
    await user.save()

    return NextResponse.json({ message: "Password reset successfully" })
  } catch (err) {
    console.error("Reset password error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
