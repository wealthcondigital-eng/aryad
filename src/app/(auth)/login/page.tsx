"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Lock, Mail, Stethoscope, CheckCircle2, AlertCircle, KeyRound, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useRole } from "@/lib/role-context"
import { motion, AnimatePresence } from "motion/react"

const highlights = [
  "Patient registration & billing in seconds",
  "Organ-wise diagnostic report builder",
  "WhatsApp sharing to patient & doctor",
  "Daily & monthly analytics dashboard",
]

const stats = [
  { v: "500+", l: "Daily Patients" },
  { v: "50+",  l: "Test Types" },
  { v: "100%", l: "Digital" },
]

export default function LoginPage() {
  const router = useRouter()
  const { login } = useRole()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [form, setForm]   = useState({ email: "", password: "" })
  const [error, setError] = useState("")

  // ── Forgot password ──────────────────────────────────────────────────────
  const [fpOpen, setFpOpen] = useState(false)
  const [fpStep, setFpStep] = useState<"email" | "otp">("email")
  const [fpEmail, setFpEmail] = useState("")
  const [fpOtp, setFpOtp] = useState("")
  const [fpNewPwd, setFpNewPwd] = useState("")
  const [fpConfirmPwd, setFpConfirmPwd] = useState("")
  const [fpLoading, setFpLoading] = useState(false)
  const [fpError, setFpError] = useState("")
  const [fpDone, setFpDone] = useState(false)

  const resetForgotState = () => {
    setFpStep("email"); setFpEmail(""); setFpOtp(""); setFpNewPwd(""); setFpConfirmPwd("")
    setFpError(""); setFpDone(false); setFpLoading(false)
  }

  const handleSendOtp = async () => {
    if (!fpEmail.trim()) { setFpError("Enter your email address."); return }
    setFpLoading(true); setFpError("")
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fpEmail.toLowerCase() }),
      })
      if (!res.ok) { setFpError("Something went wrong. Please try again."); return }
      setFpStep("otp")
    } catch {
      setFpError("Server error. Please try again.")
    } finally {
      setFpLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!fpOtp.trim()) { setFpError("Enter the OTP sent to your email."); return }
    if (fpNewPwd.length < 6) { setFpError("Password must be at least 6 characters."); return }
    if (fpNewPwd !== fpConfirmPwd) { setFpError("Passwords do not match."); return }
    setFpLoading(true); setFpError("")
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fpEmail.toLowerCase(), otp: fpOtp.trim(), newPassword: fpNewPwd }),
      })
      const data = await res.json()
      if (!res.ok) { setFpError(data.error ?? "Failed to reset password."); return }
      setFpDone(true)
      setForm(f => ({ ...f, email: fpEmail.toLowerCase() }))
      setTimeout(() => { setFpOpen(false); resetForgotState() }, 1600)
    } catch {
      setFpError("Server error. Please try again.")
    } finally {
      setFpLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    const ok = await login(form.email, form.password)
    if (ok) {
      setSuccess(true)
      setTimeout(() => router.push("/dashboard"), 900)
    } else {
      setError("Invalid email or password")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">

      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <div
        className="relative hidden lg:flex lg:w-[55%] flex-col overflow-hidden"
        style={{ background: "linear-gradient(135deg, #020b18 0%, #071a35 50%, #0a2347 100%)" }}
      >
        {/* Glow blobs */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-0 h-[450px] w-[450px] rounded-full opacity-30"
            style={{ background: "radial-gradient(circle, #1d4ed8 0%, transparent 70%)", transform: "translate(-30%, -30%)" }} />
          <div className="absolute bottom-0 right-0 h-[350px] w-[350px] rounded-full opacity-20"
            style={{ background: "radial-gradient(circle, #0e7490 0%, transparent 70%)", transform: "translate(30%, 30%)" }} />
        </div>
        {/* Grid */}
        <div className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }} />
        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: "linear-gradient(90deg, transparent, #3b82f6, #06b6d4, transparent)" }} />

        <div className="relative flex h-full flex-col px-14 py-12">

          {/* Brand */}
          <motion.div
            className="flex items-center gap-3.5"
            initial={{ opacity: 0, y: -18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          >
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{ background: "linear-gradient(135deg, #2563eb, #0891b2)" }}>
              <Stethoscope className="h-6 w-6 text-white" />
              <div className="absolute inset-0 rounded-2xl" style={{ boxShadow: "0 0 24px rgba(37,99,235,0.6)" }} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-400">Aarya</p>
              <p className="text-sm font-bold text-white leading-tight">Diagnostics Center</p>
            </div>
          </motion.div>

          {/* ECG line */}
          <motion.div
            className="my-10 w-full"
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 0.2, scaleX: 1 }}
            transition={{ duration: 1.1, ease: "easeOut", delay: 0.25 }}
            style={{ transformOrigin: "left" }}
          >
            <svg viewBox="0 0 600 60" className="w-full" fill="none">
              <polyline
                points="0,30 60,30 80,10 100,50 120,5 140,55 160,30 220,30 240,15 260,45 280,30 600,30"
                stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              />
            </svg>
          </motion.div>

          <div className="flex-1 flex flex-col justify-center">
            <motion.p
              className="text-xs font-bold uppercase tracking-[0.25em] text-blue-400 mb-4"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.35 }}
            >
              Advanced Diagnostics
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.45 }}
            >
              <h1 className="text-5xl font-black text-white leading-[1.1] mb-2">Aarya</h1>
              <h1 className="text-5xl font-black leading-[1.1] mb-6"
                style={{ background: "linear-gradient(90deg, #60a5fa, #22d3ee)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Diagnostics
              </h1>
              <h1 className="text-3xl font-black text-white/60 leading-[1.1] mb-8">Center</h1>
            </motion.div>

            <motion.p
              className="text-slate-400 text-base leading-relaxed max-w-sm mb-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.65 }}
            >
              Streamline your diagnostic center — from patient registration to report delivery, all in one place.
            </motion.p>

            <div className="space-y-3">
              {highlights.map((h, i) => (
                <motion.div
                  key={h}
                  className="flex items-center gap-3"
                  initial={{ opacity: 0, x: -18 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.75 + i * 0.1 }}
                >
                  <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0" />
                  <span className="text-sm text-slate-300">{h}</span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Stats footer */}
          <motion.div
            className="border-t border-white/10 pt-8 flex items-center justify-between"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.2 }}
          >
            <div className="flex gap-8">
              {stats.map((s) => (
                <div key={s.l}>
                  <p className="text-xl font-extrabold text-white">{s.v}</p>
                  <p className="text-xs text-slate-500">{s.l}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600">© 2026</p>
          </motion.div>
        </div>
      </div>

      {/* ── Right form panel ──────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col items-center justify-center bg-white px-8 py-12">
        <motion.div
          className="w-full max-w-[380px]"
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          {/* Mobile brand */}
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: "linear-gradient(135deg, #2563eb, #0891b2)" }}>
              <Stethoscope className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-black text-slate-900 leading-none text-base">Aarya Diagnostics</p>
              <p className="text-xs text-slate-400">Center</p>
            </div>
          </div>

          {/* Heading */}
          <motion.div
            className="mb-7"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
          >
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Sign In</h2>
            <p className="text-slate-400 text-sm mt-1.5">Enter your credentials to continue</p>
          </motion.div>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email */}
            <motion.div
              className="space-y-1.5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.25 }}
            >
              <Label htmlFor="email" className="text-slate-700 text-sm font-semibold">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@aaryadiagnostics.com"
                  className="pl-10 h-11 border-slate-200 rounded-xl bg-slate-50 focus-visible:bg-white focus-visible:ring-blue-500 transition-colors"
                  value={form.email}
                  onChange={(e) => { setForm({ ...form, email: e.target.value }); setError("") }}
                  required
                />
              </div>
            </motion.div>

            {/* Password */}
            <motion.div
              className="space-y-1.5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.35 }}
            >
              <Label htmlFor="password" className="text-slate-700 text-sm font-semibold">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-400 z-10" />
                <PasswordInput
                  id="password"
                  placeholder="••••••••"
                  className="pl-10 h-11 border-slate-200 rounded-xl bg-slate-50 focus-visible:bg-white focus-visible:ring-blue-500 transition-colors"
                  value={form.password}
                  onChange={(e) => { setForm({ ...form, password: e.target.value }); setError("") }}
                  required
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => { resetForgotState(); setFpEmail(form.email); setFpOpen(true) }}
                  className="text-xs font-medium text-blue-600 hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            </motion.div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5"
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ duration: 0.2 }}
                >
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-600">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Submit button */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.45 }}
            >
              <motion.div
                whileTap={!loading && !success ? { scale: 0.97 } : {}}
                whileHover={!loading && !success ? { scale: 1.015 } : {}}
                transition={{ duration: 0.15 }}
              >
                <Button
                  type="submit"
                  className="w-full h-12 rounded-xl font-bold text-sm text-white mt-1 transition-all duration-300"
                  style={{
                    background: success
                      ? "linear-gradient(135deg, #16a34a, #15803d)"
                      : loading
                        ? "#93c5fd"
                        : "linear-gradient(135deg, #2563eb, #0891b2)",
                  }}
                  disabled={loading || success}
                >
                  <AnimatePresence mode="wait">
                    {success ? (
                      <motion.span
                        key="success"
                        className="flex items-center gap-2"
                        initial={{ opacity: 0, scale: 0.7 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: "spring", stiffness: 320, damping: 20 }}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Welcome!
                      </motion.span>
                    ) : loading ? (
                      <motion.span
                        key="loading"
                        className="flex items-center gap-2"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        {/* Three bouncing dots */}
                        {[0, 1, 2].map((i) => (
                          <motion.span
                            key={i}
                            className="inline-block h-1.5 w-1.5 rounded-full bg-white"
                            animate={{ y: [0, -5, 0] }}
                            transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                          />
                        ))}
                        <span className="ml-1">Signing in...</span>
                      </motion.span>
                    ) : (
                      <motion.span
                        key="idle"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                      >
                        Sign In
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Button>
              </motion.div>
            </motion.div>
          </form>

          <motion.p
            className="mt-6 text-center text-xs text-slate-400"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.6 }}
          >
            © 2026 Aarya Diagnostics Center · All rights reserved
          </motion.p>
        </motion.div>
      </div>

      {/* ── Forgot Password Dialog ───────────────────────────────────────────── */}
      <Dialog open={fpOpen} onOpenChange={o => { setFpOpen(o); if (!o) resetForgotState() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4.5 w-4.5 text-blue-600" />
              Reset Password
            </DialogTitle>
          </DialogHeader>

          {fpDone ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-9 w-9 text-green-600" />
              <p className="text-sm font-medium">Password reset successfully</p>
              <p className="text-xs text-muted-foreground">You can now sign in with your new password.</p>
            </div>
          ) : fpStep === "email" ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Enter your registered email — we&apos;ll send a one-time code to reset your password.
              </p>
              {fpError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {fpError}
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Email</Label>
                <Input
                  type="email"
                  placeholder="you@aaryadiagnostics.com"
                  value={fpEmail}
                  onChange={e => setFpEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSendOtp()}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Enter the OTP sent to <span className="font-medium text-foreground">{fpEmail}</span> and choose a new password.
              </p>
              {fpError && (
                <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {fpError}
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">OTP</Label>
                <Input
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={fpOtp}
                  onChange={e => setFpOtp(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">New Password</Label>
                <PasswordInput
                  placeholder="Enter new password"
                  value={fpNewPwd}
                  onChange={e => setFpNewPwd(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Confirm Password</Label>
                <PasswordInput
                  placeholder="Re-enter new password"
                  value={fpConfirmPwd}
                  onChange={e => setFpConfirmPwd(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleResetPassword()}
                />
              </div>
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={fpLoading}
                className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50"
              >
                Resend OTP
              </button>
            </div>
          )}

          {!fpDone && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setFpOpen(false)}>Cancel</Button>
              {fpStep === "email" ? (
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleSendOtp} disabled={fpLoading}>
                  {fpLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</> : "Send OTP"}
                </Button>
              ) : (
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleResetPassword} disabled={fpLoading}>
                  {fpLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Resetting…</> : "Reset Password"}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}
