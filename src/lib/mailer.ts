import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

// Edit this template to change how the OTP email looks.
export async function sendPasswordResetOtp(to: string, name: string, otp: string) {
  await transporter.sendMail({
    from: `"Aarya Diagnostics Center" <${process.env.SMTP_USER}>`,
    to,
    subject: "Your password reset OTP — Aarya Diagnostics Center",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 28px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #2563eb; margin: 0 0 4px;">Aarya Diagnostics Center</h2>
        <p style="color: #475569; font-size: 14px; margin-top: 18px;">Hi ${name},</p>
        <p style="color: #475569; font-size: 14px;">
          We received a request to reset your password. Use the OTP below to continue — it is valid for 10 minutes.
        </p>
        <div style="background: #f1f5f9; border-radius: 8px; padding: 16px; text-align: center; margin: 22px 0;">
          <span style="font-size: 30px; font-weight: bold; letter-spacing: 8px; color: #0f172a;">${otp}</span>
        </div>
        <p style="color: #475569; font-size: 13px;">
          If you didn't request this, you can safely ignore this email — your password will not change.
        </p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 26px;">© 2026 Aarya Diagnostics Center</p>
      </div>
    `,
  })
}
