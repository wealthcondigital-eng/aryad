"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Sidebar } from "@/components/layout/sidebar"
import { Header } from "@/components/layout/header"
import { TopLoader } from "@/components/top-loader"
import { useRole } from "@/lib/role-context"
import { motion } from "motion/react"
import { Stethoscope } from "lucide-react"

function DashboardContent({ children }: { children: React.ReactNode }) {
  const { user, ready } = useRole()
  const router   = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (ready && !user) {
      router.push("/login")
    }
  }, [ready, user, router])

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-7">

          {/* Logo */}
          <motion.div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{
              background: "linear-gradient(135deg, #2563eb, #0891b2)",
              boxShadow: "0 8px 32px rgba(37,99,235,0.28), 0 2px 8px rgba(37,99,235,0.15)",
            }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <Stethoscope className="h-8 w-8 text-white" />
          </motion.div>

          {/* Brand */}
          <motion.div
            className="flex flex-col items-center gap-0.5"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.18 }}
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-500">Aarya</p>
            <p className="text-lg font-black text-slate-900">Diagnostics Center</p>
          </motion.div>

          {/* ECG heartbeat line */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.32 }}
          >
            <svg viewBox="0 0 200 32" fill="none" className="w-40">
              <defs>
                <linearGradient id="ecg-grad" x1="0" y1="0" x2="200" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
              </defs>
              <motion.polyline
                points="0,16 24,16 33,4 41,28 48,1 55,31 62,16 92,16 100,8 110,24 117,16 200,16"
                stroke="url(#ecg-grad)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 1 }}
                animate={{ pathLength: [0, 1, 1, 0], opacity: [1, 1, 0.6, 0] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "linear", times: [0, 0.55, 0.8, 1] }}
              />
            </svg>
          </motion.div>

        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <TopLoader />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden lg:ml-0">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardContent>{children}</DashboardContent>
}
