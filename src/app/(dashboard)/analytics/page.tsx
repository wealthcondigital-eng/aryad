"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Users, IndianRupee, TrendingUp, Activity,
  CreditCard, ArrowUpRight, ArrowDownRight, BarChart3, Calendar, ChevronDown,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { motion, AnimatePresence } from "framer-motion"

// ── Types ─────────────────────────────────────────────────────────────────────

interface PatientRow {
  _id: string; createdAt: string; study: string
  reportStatus: "pending" | "in_progress" | "completed"
  referredBy?: string; age: number; gender: string
  charges: number; paid: number
}

interface BillRow {
  _id: string; billDate: string; createdAt: string
  charges: number; paid: number; discount: number; paymentMode: string
  items: { study: string; price: number; quantity: number }[]
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function toDateStr(d: Date) { return d.toISOString().slice(0, 10) }
function toMonthStr(d: Date) { return d.toISOString().slice(0, 7) }

function getRangesFor(dateStr: string, weekStr: string, monthStr: string, year: number) {
  const now = new Date()

  // Selected day
  const todayDate  = new Date(dateStr + "T00:00:00")
  const todayStart = new Date(todayDate); todayStart.setHours(0, 0, 0, 0)
  const todayEnd   = new Date(todayDate); todayEnd.setHours(23, 59, 59, 999)
  const yestStart  = new Date(todayStart); yestStart.setDate(yestStart.getDate() - 1)
  const yestEnd    = new Date(todayEnd);   yestEnd.setDate(yestEnd.getDate() - 1)

  // Week containing weekStr
  const weekRef   = new Date(weekStr + "T00:00:00")
  const weekStart = new Date(weekRef); weekStart.setHours(0, 0, 0, 0)
  const dow       = weekStart.getDay()
  weekStart.setDate(weekStart.getDate() - (dow === 0 ? 6 : dow - 1))
  const lastWeekEnd   = new Date(weekStart.getTime() - 1)
  const lastWeekStart = new Date(lastWeekEnd)
  lastWeekStart.setDate(lastWeekStart.getDate() - 6)
  lastWeekStart.setHours(0, 0, 0, 0)

  // Selected month
  const [mY, mM] = monthStr.split("-").map(Number)
  const monthStart     = new Date(mY, mM - 1, 1, 0, 0, 0, 0)
  const lastMonthStart = new Date(mY, mM - 2, 1, 0, 0, 0, 0)
  const lastMonthEnd   = new Date(monthStart.getTime() - 1)

  // Selected year
  const yearStart = new Date(year, 0, 1, 0, 0, 0, 0)
  const yearEnd   = new Date(year, 11, 31, 23, 59, 59, 999)

  return { now, todayStart, todayEnd, yestStart, yestEnd, weekStart, lastWeekStart, lastWeekEnd, monthStart, lastMonthStart, lastMonthEnd, yearStart, yearEnd }
}

function inRange(dateStr: string, start: Date, end?: Date) {
  const d = new Date(dateStr)
  return d >= start && (!end || d <= end)
}

function billDate(b: BillRow) { return b.billDate || b.createdAt }

function fmtRev(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`
  if (v >= 1000)   return `₹${(v / 1000).toFixed(1)}k`
  return `₹${v}`
}

function growthPct(cur: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

// ── Data aggregators ──────────────────────────────────────────────────────────

function byHour(patients: PatientRow[], bills: BillRow[], day: Date) {
  const SLOTS = [8,9,10,11,12,13,14,15,16,17,18]
  const LBL: Record<number, string> = {8:"8AM",9:"9AM",10:"10AM",11:"11AM",12:"12PM",13:"1PM",14:"2PM",15:"3PM",16:"4PM",17:"5PM",18:"6PM"}
  const rows = SLOTS.map(h => {
    const s = new Date(day); s.setHours(h, 0, 0, 0)
    const e = new Date(day); e.setHours(h, 59, 59, 999)
    return {
      label:    LBL[h],
      patients: patients.filter(p => inRange(p.createdAt, s, e)).length,
      revenue:  bills.filter(b => inRange(billDate(b), s, e)).reduce((a, b) => a + b.paid, 0),
    }
  })
  return rows.filter(r => r.patients > 0 || r.revenue > 0)
}

function byDay(patients: PatientRow[], bills: BillRow[], weekStart: Date) {
  const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
  return DAYS.map((day, i) => {
    const s = new Date(weekStart); s.setDate(weekStart.getDate() + i); s.setHours(0,0,0,0)
    const e = new Date(s); e.setHours(23,59,59,999)
    return {
      label:    `${day} ${s.getDate()}`,
      patients: patients.filter(p => inRange(p.createdAt, s, e)).length,
      revenue:  bills.filter(b => inRange(billDate(b), s, e)).reduce((a, b) => a + b.paid, 0),
    }
  })
}

function byWeekOfMonth(patients: PatientRow[], bills: BillRow[], monthStart: Date) {
  const yr = monthStart.getFullYear(), mo = monthStart.getMonth()
  const last = new Date(yr, mo + 1, 0).getDate()
  return ([[1,7],[8,14],[15,21],[22,last]] as [number,number][]).map(([from, to], wi) => {
    const s = new Date(yr, mo, from, 0, 0, 0, 0)
    const e = new Date(yr, mo, to, 23, 59, 59, 999)
    return {
      label:    `Wk ${wi+1} (${from}–${to})`,
      patients: patients.filter(p => inRange(p.createdAt, s, e)).length,
      revenue:  bills.filter(b => inRange(billDate(b), s, e)).reduce((a, b) => a + b.paid, 0),
    }
  })
}

function byMonth(patients: PatientRow[], bills: BillRow[], year: number) {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
  const now = new Date()
  const isCurrentYear = year === now.getFullYear()
  const cutoffMo = isCurrentYear ? now.getMonth() : 11
  return MONTHS.map((lbl, mi) => {
    if (mi > cutoffMo) return { label: lbl, patients: 0, revenue: 0 }
    const s = new Date(year, mi, 1, 0, 0, 0, 0)
    const e = new Date(year, mi + 1, 0, 23, 59, 59, 999)
    return {
      label:    lbl,
      patients: patients.filter(p => inRange(p.createdAt, s, e)).length,
      revenue:  bills.filter(b => inRange(billDate(b), s, e)).reduce((a, b) => a + b.paid, 0),
    }
  })
}

function byRangeChunks(patients: PatientRow[], bills: BillRow[], start: Date, end: Date) {
  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  if (days === 1) return byHour(patients, bills, start)
  if (days <= 35) {
    const result = []
    for (let i = 0; i < days; i++) {
      const s = new Date(start); s.setDate(start.getDate() + i); s.setHours(0, 0, 0, 0)
      const e = new Date(s); e.setHours(23, 59, 59, 999)
      result.push({
        label:    s.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        patients: patients.filter(p => inRange(p.createdAt, s, e)).length,
        revenue:  bills.filter(b => inRange(billDate(b), s, e)).reduce((a, b) => a + b.paid, 0),
      })
    }
    return result
  }
  // Weekly chunks for longer ranges
  const result = []
  const cur = new Date(start); cur.setHours(0, 0, 0, 0)
  while (cur <= end) {
    const s = new Date(cur)
    const e = new Date(cur); e.setDate(cur.getDate() + 6); e.setHours(23, 59, 59, 999)
    const actualEnd = e > end ? new Date(end) : e
    result.push({
      label:    `${s.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}–${actualEnd.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}`,
      patients: patients.filter(p => inRange(p.createdAt, s, actualEnd)).length,
      revenue:  bills.filter(b => inRange(billDate(b), s, actualEnd)).reduce((a, b) => a + b.paid, 0),
    })
    cur.setDate(cur.getDate() + 7)
  }
  return result
}

function studyBreakdown(patients: PatientRow[], bills: BillRow[]) {
  const m: Record<string, { count: number; revenue: number }> = {}
  for (const p of patients) {
    if (!p.study) continue
    if (!m[p.study]) m[p.study] = { count: 0, revenue: 0 }
    m[p.study].count++
  }
  for (const b of bills) {
    for (const it of b.items ?? []) {
      if (!it.study) continue
      if (!m[it.study]) m[it.study] = { count: 0, revenue: 0 }
      m[it.study].revenue += it.price * it.quantity
    }
  }
  return Object.entries(m).map(([study, d]) => ({ study, ...d })).sort((a, b) => b.count - a.count).slice(0, 8)
}

function topDoctors(patients: PatientRow[], n = 5) {
  const m: Record<string, number> = {}
  for (const p of patients) {
    const name = (p.referredBy ?? "").trim()
    if (!name || name.toLowerCase() === "self") continue
    m[name] = (m[name] ?? 0) + 1
  }
  return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, n)
}

function paymentDist(bills: BillRow[]) {
  const m: Record<string, { count: number; amount: number }> = {}
  for (const b of bills) {
    const mode = b.paymentMode || "Cash"
    if (!m[mode]) m[mode] = { count: 0, amount: 0 }
    m[mode].count++; m[mode].amount += b.paid
  }
  return Object.entries(m).map(([mode, d]) => ({ mode, ...d })).sort((a, b) => b.count - a.count)
}

// ── Chart components ──────────────────────────────────────────────────────────

const CHART_H = 168

function VBarChart({ data, color, animKey }: {
  data: { label: string; value: number }[]
  color: string; animKey: string
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div key={animKey}>
      <div className="flex items-end gap-1 sm:gap-2" style={{ height: CHART_H }}>
        {data.map((d, i) => {
          const barH = Math.max((d.value / max) * (CHART_H - 28), d.value > 0 ? 6 : 0)
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-0.5">
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 + 0.35, duration: 0.2 }}
                className="text-[9px] font-bold text-gray-600 leading-none"
              >
                {d.value > 0 ? (d.value >= 1000 ? `${(d.value/1000).toFixed(1)}k` : d.value) : ""}
              </motion.span>
              <motion.div
                key={`${animKey}-${i}`}
                initial={{ height: 0 }}
                animate={{ height: barH }}
                transition={{ delay: i * 0.05, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                className="w-full rounded-t-lg"
                style={{ background: color }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-1 sm:gap-2 mt-2">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[9px] sm:text-[10px] text-muted-foreground truncate">{d.label}</div>
        ))}
      </div>
    </div>
  )
}

function HBarChart({ data, color, subKey, animKey }: {
  data: { label: string; value: number; sub?: number }[]
  color: string; subKey?: string; animKey: string
}) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div className="space-y-2.5" key={animKey}>
      {data.map((d, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.05, duration: 0.25 }}
          className="flex items-center gap-2"
        >
          <span className="text-xs text-gray-600 w-28 shrink-0 truncate">{d.label}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
            <motion.div
              key={`${animKey}-bar-${i}`}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max((d.value / max) * 100, d.value > 0 ? 8 : 0)}%` }}
              transition={{ delay: i * 0.05 + 0.1, duration: 0.55, ease: "easeOut" }}
              className="h-full rounded-full flex items-center px-2.5"
              style={{ background: color }}
            >
              <span className="text-[10px] text-white font-bold">{d.value}</span>
            </motion.div>
          </div>
          {d.sub !== undefined && (
            <span className="text-xs font-semibold text-green-600 w-20 text-right shrink-0">{fmtRev(d.sub)}</span>
          )}
        </motion.div>
      ))}
    </div>
  )
}

function MiniDonut({ segments, animKey }: {
  segments: { label: string; value: number; color: string }[]
  animKey: string
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  const R = 36, CIRC = 2 * Math.PI * R
  let offset = 0
  return (
    <div className="flex items-center gap-6" key={animKey}>
      <svg width="90" height="90" viewBox="0 0 100 100" className="shrink-0">
        <circle cx="50" cy="50" r={R} fill="none" stroke="#f1f5f9" strokeWidth="14" />
        {segments.map((seg, i) => {
          const dashLen = (seg.value / total) * CIRC
          const dashOffset = offset
          offset += dashLen
          return (
            <motion.circle
              key={`${animKey}-${i}`}
              cx="50" cy="50" r={R}
              fill="none"
              stroke={seg.color}
              strokeWidth="14"
              strokeDasharray={`${dashLen} ${CIRC - dashLen}`}
              strokeLinecap="butt"
              transform="rotate(-90 50 50)"
              initial={{ strokeDashoffset: CIRC, strokeDasharray: `0 ${CIRC}` }}
              animate={{ strokeDashoffset: -dashOffset, strokeDasharray: `${dashLen} ${CIRC - dashLen}` }}
              transition={{ delay: i * 0.12, duration: 0.55, ease: "easeOut" }}
            />
          )
        })}
        <text x="50" y="54" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#374151">{total}</text>
      </svg>
      <div className="space-y-1.5 min-w-0">
        {segments.map((seg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            transition={{ delay: i * 0.1 + 0.3 }}
            className="flex items-center gap-2"
          >
            <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: seg.color }} />
            <span className="text-xs text-gray-600 truncate">{seg.label}</span>
            <span className="text-xs font-semibold text-gray-800 ml-auto pl-2">{seg.value}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function KpiCard({ label, value, sub, growth, icon: Icon, accent }: {
  label: string; value: string; sub?: string; growth?: number | null
  icon: React.ComponentType<{ className?: string }>; accent: string
}) {
  return (
    <Card className={`border-l-4 ${accent} h-full`}>
      <CardContent className="p-4 h-full">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide leading-none mb-1.5">{label}</p>
            <p className="text-2xl font-bold leading-none">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Icon className="h-5 w-5 text-muted-foreground/25" />
            {growth !== undefined && growth !== null && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${growth >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                {growth >= 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                {Math.abs(growth)}%
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3 pt-4 px-5">
        <CardTitle className="text-sm font-semibold text-gray-800">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">{children}</CardContent>
    </Card>
  )
}

// ── Today view ────────────────────────────────────────────────────────────────

function TodayView({ patients, bills, ranges }: { patients: PatientRow[]; bills: BillRow[]; ranges: ReturnType<typeof getRangesFor> }) {
  const { todayStart, todayEnd, yestStart, yestEnd } = ranges

  const todayPts   = patients.filter(p => inRange(p.createdAt, todayStart, todayEnd))
  const yestPts    = patients.filter(p => inRange(p.createdAt, yestStart, yestEnd))
  const todayBills = bills.filter(b => inRange(billDate(b), todayStart, todayEnd))
  const yestBills  = bills.filter(b => inRange(billDate(b), yestStart, yestEnd))

  const todayRev   = todayBills.reduce((s, b) => s + b.paid, 0)
  const yestRev    = yestBills.reduce((s, b) => s + b.paid, 0)

  const hourly     = byHour(todayPts, todayBills, todayStart)
  const studies    = studyBreakdown(todayPts, todayBills)
  const rStatus    = { pending: todayPts.filter(p => p.reportStatus === "pending").length, inProgress: todayPts.filter(p => p.reportStatus === "in_progress").length, completed: todayPts.filter(p => p.reportStatus === "completed").length }
  const modes      = paymentDist(todayBills)
  const outstanding = todayBills.reduce((s, b) => s + Math.max(0, b.charges - (b.discount ?? 0) - b.paid), 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Patients" value={String(todayPts.length)} sub={todayStart.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})} growth={growthPct(todayPts.length, yestPts.length)} icon={Users} accent="border-l-blue-500" />
        <KpiCard label="Revenue Collected" value={fmtRev(todayRev)} sub="Bills paid today" growth={growthPct(todayRev, yestRev)} icon={IndianRupee} accent="border-l-green-500" />
        <KpiCard label="Studies Done" value={String(todayPts.length)} sub="All modalities" icon={Activity} accent="border-l-purple-500" />
        <KpiCard label="Outstanding" value={fmtRev(outstanding)} sub="Pending collection" icon={CreditCard} accent="border-l-orange-400" />
      </div>

      {hourly.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <SectionCard title="Patients per Hour">
            <VBarChart data={hourly.map(h => ({ label: h.label, value: h.patients }))} color="#3b82f6" animKey="today-pts" />
          </SectionCard>
          <SectionCard title="Revenue per Hour (₹)">
            <VBarChart data={hourly.map(h => ({ label: h.label, value: h.revenue }))} color="#22c55e" animKey="today-rev" />
          </SectionCard>
        </div>
      ) : (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No patients registered today yet.</CardContent></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="sm:col-span-2">
          <SectionCard title="Study-wise Breakdown — Today">
            {studies.length > 0
              ? <HBarChart data={studies.map(s => ({ label: s.study, value: s.count, sub: s.revenue }))} color="linear-gradient(90deg,#6366f1,#8b5cf6)" animKey="today-study" />
              : <p className="text-sm text-muted-foreground py-4">No studies today.</p>}
          </SectionCard>
        </div>
        <div className="space-y-5">
          <SectionCard title="Report Status">
            <MiniDonut
              segments={[
                { label: "Completed",   value: rStatus.completed,  color: "#22c55e" },
                { label: "In Progress", value: rStatus.inProgress, color: "#3b82f6" },
                { label: "Pending",     value: rStatus.pending,    color: "#e5e7eb" },
              ]}
              animKey="today-report"
            />
          </SectionCard>
          {modes.length > 0 && (
            <SectionCard title="Payment Mode">
              <MiniDonut
                segments={modes.map((m, i) => ({ label: m.mode, value: m.count, color: ["#3b82f6","#22c55e","#f59e0b","#8b5cf6"][i] ?? "#9ca3af" }))}
                animKey="today-mode"
              />
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Week view ─────────────────────────────────────────────────────────────────

function WeekView({ patients, bills, ranges }: { patients: PatientRow[]; bills: BillRow[]; ranges: ReturnType<typeof getRangesFor> }) {
  const { weekStart, lastWeekStart, lastWeekEnd } = ranges
  const weekEnd      = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999)
  const weekLabelFull = `${weekStart.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})} – ${weekEnd.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}`
  const weekPts  = patients.filter(p => inRange(p.createdAt, weekStart, weekEnd))
  const lastWPts = patients.filter(p => inRange(p.createdAt, lastWeekStart, lastWeekEnd))
  const weekBills = bills.filter(b => inRange(billDate(b), weekStart, weekEnd))
  const lastWBills = bills.filter(b => inRange(billDate(b), lastWeekStart, lastWeekEnd))

  const weekRev  = weekBills.reduce((s, b) => s + b.paid, 0)
  const lastWRev = lastWBills.reduce((s, b) => s + b.paid, 0)

  const days     = byDay(weekPts, weekBills, weekStart)
  const studies  = studyBreakdown(weekPts, weekBills)
  const doctors  = topDoctors(weekPts)
  const modes    = paymentDist(weekBills)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Week Patients" value={String(weekPts.length)} sub={weekLabelFull} growth={growthPct(weekPts.length, lastWPts.length)} icon={Users} accent="border-l-blue-500" />
        <KpiCard label="Revenue" value={fmtRev(weekRev)} sub="Week total" growth={growthPct(weekRev, lastWRev)} icon={IndianRupee} accent="border-l-green-500" />
        <KpiCard label="Avg / Day" value={String(Math.round(weekPts.length / 7))} sub="Patients per day" icon={TrendingUp} accent="border-l-orange-500" />
        <KpiCard label="Avg Revenue/Day" value={fmtRev(Math.round(weekRev / 7))} icon={BarChart3} accent="border-l-purple-500" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <SectionCard title="Patients per Day — This Week">
          <VBarChart data={days.map(d => ({ label: d.label, value: d.patients }))} color="#3b82f6" animKey="week-pts" />
        </SectionCard>
        <SectionCard title="Revenue per Day (₹) — This Week">
          <VBarChart data={days.map(d => ({ label: d.label, value: d.revenue }))} color="#22c55e" animKey="week-rev" />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="sm:col-span-2">
          <SectionCard title="Study Breakdown — This Week">
            {studies.length > 0
              ? <HBarChart data={studies.map(s => ({ label: s.study, value: s.count, sub: s.revenue }))} color="linear-gradient(90deg,#3b82f6,#6366f1)" animKey="week-study" />
              : <p className="text-sm text-muted-foreground py-4">No studies this week.</p>}
          </SectionCard>
        </div>
        <div className="space-y-5">
          {doctors.length > 0 && (
            <SectionCard title="Top Doctors">
              <div className="space-y-2">
                {doctors.map((d, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                    className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 font-bold w-4">{i + 1}</span>
                    <span className="flex-1 text-gray-700 font-medium truncate">{d.name}</span>
                    <span className="bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold">{d.count}</span>
                  </motion.div>
                ))}
              </div>
            </SectionCard>
          )}
          {modes.length > 0 && (
            <SectionCard title="Payment Mode">
              <MiniDonut
                segments={modes.map((m, i) => ({ label: m.mode, value: m.count, color: ["#3b82f6","#22c55e","#f59e0b","#8b5cf6"][i] ?? "#9ca3af" }))}
                animKey="week-mode"
              />
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({ patients, bills, ranges }: { patients: PatientRow[]; bills: BillRow[]; ranges: ReturnType<typeof getRangesFor> }) {
  const { monthStart, lastMonthStart, lastMonthEnd } = ranges
  const monthName = monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" })

  const monthEnd   = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999)
  const monthPts   = patients.filter(p => inRange(p.createdAt, monthStart, monthEnd))
  const lastMPts   = patients.filter(p => inRange(p.createdAt, lastMonthStart, lastMonthEnd))
  const monthBills = bills.filter(b => inRange(billDate(b), monthStart, monthEnd))
  const lastMBills = bills.filter(b => inRange(billDate(b), lastMonthStart, lastMonthEnd))

  const monthRev   = monthBills.reduce((s, b) => s + b.paid, 0)
  const lastMRev   = lastMBills.reduce((s, b) => s + b.paid, 0)

  const weeks      = byWeekOfMonth(monthPts, monthBills, monthStart)
  const studies    = studyBreakdown(monthPts, monthBills)
  const doctors    = topDoctors(monthPts)
  const modes      = paymentDist(monthBills)
  const outstanding = monthBills.reduce((s, b) => s + Math.max(0, b.charges - (b.discount ?? 0) - b.paid), 0)
  const collectRate = monthBills.length > 0
    ? Math.round((monthRev / monthBills.reduce((s, b) => s + b.charges - (b.discount ?? 0), 0)) * 100)
    : 0

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label={monthName} value={String(monthPts.length)} sub="Total patients" growth={growthPct(monthPts.length, lastMPts.length)} icon={Users} accent="border-l-blue-500" />
        <KpiCard label="Revenue" value={fmtRev(monthRev)} sub="Month total" growth={growthPct(monthRev, lastMRev)} icon={IndianRupee} accent="border-l-green-500" />
        <KpiCard label="Collection Rate" value={`${collectRate}%`} sub="Of billed amount" icon={TrendingUp} accent="border-l-purple-500" />
        <KpiCard label="Outstanding" value={fmtRev(outstanding)} sub="Pending collection" icon={CreditCard} accent="border-l-orange-400" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <SectionCard title={`Patients per Week — ${monthName}`}>
          <VBarChart data={weeks.map(w => ({ label: w.label, value: w.patients }))} color="#3b82f6" animKey="month-pts" />
        </SectionCard>
        <SectionCard title={`Revenue per Week (₹) — ${monthName}`}>
          <VBarChart data={weeks.map(w => ({ label: w.label, value: w.revenue }))} color="#22c55e" animKey="month-rev" />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="sm:col-span-2">
          <SectionCard title={`Study Category Breakdown — ${monthName}`}>
            {studies.length > 0
              ? <HBarChart data={studies.map(s => ({ label: s.study, value: s.count, sub: s.revenue }))} color="linear-gradient(90deg,#22c55e,#16a34a)" animKey="month-study" />
              : <p className="text-sm text-muted-foreground py-4">No studies this month.</p>}
          </SectionCard>
        </div>
        <div className="space-y-5">
          {doctors.length > 0 && (
            <SectionCard title="Top Referring Doctors">
              <div className="space-y-2">
                {doctors.map((d, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                    className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 font-bold w-4">{i + 1}</span>
                    <span className="flex-1 text-gray-700 font-medium truncate">{d.name}</span>
                    <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-semibold">{d.count}</span>
                  </motion.div>
                ))}
              </div>
            </SectionCard>
          )}
          {modes.length > 0 && (
            <SectionCard title="Payment Distribution">
              <MiniDonut
                segments={modes.map((m, i) => ({ label: `${m.mode} (${fmtRev(m.amount)})`, value: m.count, color: ["#3b82f6","#22c55e","#f59e0b","#8b5cf6"][i] ?? "#9ca3af" }))}
                animKey="month-mode"
              />
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Year view ─────────────────────────────────────────────────────────────────

function YearView({ patients, bills, ranges }: { patients: PatientRow[]; bills: BillRow[]; ranges: ReturnType<typeof getRangesFor> }) {
  const { yearStart, yearEnd } = ranges
  const year = yearStart.getFullYear()

  const yearPts   = patients.filter(p => inRange(p.createdAt, yearStart, yearEnd))
  const yearBills = bills.filter(b => inRange(billDate(b), yearStart, yearEnd))

  const yearRev   = yearBills.reduce((s, b) => s + b.paid, 0)
  const months    = byMonth(yearPts, yearBills, year)
  const maxPts    = Math.max(...months.map(m => m.patients), 1)
  const bestMonth = months.find(m => m.patients === maxPts)
  const studies   = studyBreakdown(yearPts, yearBills)
  const doctors   = topDoctors(yearPts, 8)
  const outstanding = yearBills.reduce((s, b) => s + Math.max(0, b.charges - (b.discount ?? 0) - b.paid), 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label={`${year} YTD`} value={String(yearPts.length)} sub="Total patients" icon={Users} accent="border-l-blue-500" />
        <KpiCard label="Revenue YTD" value={fmtRev(yearRev)} sub="Year to date" icon={IndianRupee} accent="border-l-green-500" />
        <KpiCard label="Best Month" value={bestMonth?.label ?? "—"} sub={`${maxPts} patients`} icon={TrendingUp} accent="border-l-orange-500" />
        <KpiCard label="Outstanding" value={fmtRev(outstanding)} sub="Total uncollected" icon={CreditCard} accent="border-l-red-400" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <SectionCard title={`Patients per Month — ${year}`}>
          <VBarChart data={months.map(m => ({ label: m.label, value: m.patients }))} color="#3b82f6" animKey="year-pts" />
        </SectionCard>
        <SectionCard title={`Revenue per Month (₹) — ${year}`}>
          <VBarChart data={months.map(m => ({ label: m.label, value: m.revenue }))} color="#22c55e" animKey="year-rev" />
        </SectionCard>
      </div>

      {/* Monthly summary table */}
      <SectionCard title={`Monthly Summary — ${year}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs font-medium text-muted-foreground">
                <th className="text-left py-2">Month</th>
                <th className="text-center py-2">Patients</th>
                <th className="text-right py-2">Revenue</th>
                <th className="text-right py-2 hidden sm:table-cell">Avg/Day</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {months.filter(m => m.patients > 0 || m.revenue > 0).map((m, i) => (
                <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className="hover:bg-muted/20">
                  <td className="py-2 font-medium">{m.label} {year}</td>
                  <td className="text-center py-2">{m.patients}</td>
                  <td className="text-right py-2 text-green-700 font-medium">{fmtRev(m.revenue)}</td>
                  <td className="text-right py-2 text-muted-foreground hidden sm:table-cell">{Math.round(m.patients / 26)}</td>
                </motion.tr>
              ))}
              {yearPts.length > 0 && (
                <tr className="border-t-2 font-bold bg-muted/20">
                  <td className="py-2">Total YTD</td>
                  <td className="text-center py-2">{yearPts.length}</td>
                  <td className="text-right py-2 text-green-700">{fmtRev(yearRev)}</td>
                  <td className="text-right py-2 hidden sm:table-cell">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

        {/* Top Studies */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-800">Top Studies — {year}</CardTitle>
              <span className="text-xs text-muted-foreground">{studies.length} types</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {studies.length > 0 ? (
              <div className="space-y-0 divide-y divide-gray-50">
                {studies.map((s, i) => {
                  const BAR_COLORS = ["#8b5cf6","#6366f1","#3b82f6","#06b6d4","#10b981","#f59e0b","#ef4444","#ec4899"]
                  const barColor = BAR_COLORS[i] ?? "#9ca3af"
                  const pct = Math.max((s.count / (studies[0]?.count || 1)) * 100, s.count > 0 ? 6 : 0)
                  const totalStudies = studies.reduce((a, x) => a + x.count, 0)
                  const share = totalStudies > 0 ? Math.round((s.count / totalStudies) * 100) : 0
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.3 }}
                      className="py-3 first:pt-1"
                    >
                      <div className="flex items-start gap-3">
                        {/* Rank */}
                        <div className="flex items-center justify-center h-6 w-6 rounded-lg shrink-0 mt-0.5"
                          style={{ background: `${barColor}18`, color: barColor }}>
                          <span className="text-[10px] font-bold">{i + 1}</span>
                        </div>

                        <div className="flex-1 min-w-0">
                          {/* Name + badges */}
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-sm font-medium text-gray-800 leading-tight" title={s.study}>{s.study}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                                style={{ background: `${barColor}15`, color: barColor }}>
                                {s.count} {s.count === 1 ? "case" : "cases"}
                              </span>
                              {s.revenue > 0 && (
                                <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                  {fmtRev(s.revenue)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Progress bar + share */}
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full rounded-full"
                                style={{ background: `linear-gradient(90deg, ${barColor}cc, ${barColor})` }}
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ delay: i * 0.06 + 0.15, duration: 0.6, ease: "easeOut" }}
                              />
                            </div>
                            <span className="text-[10px] font-semibold text-gray-400 w-7 text-right shrink-0">{share}%</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">No study data yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Doctor Leaderboard */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-800">Doctor Leaderboard — {year}</CardTitle>
              <span className="text-xs text-muted-foreground">{doctors.length} doctors</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {doctors.length > 0 ? (
              <div className="space-y-0 divide-y divide-gray-50">
                {(() => {
                  const totalRefs = doctors.reduce((s, d) => s + d.count, 0)
                  const RANK_STYLE = [
                    { bg: "bg-amber-50",  border: "border-amber-200", text: "text-amber-600",  bar: "#f59e0b" },
                    { bg: "bg-slate-50",  border: "border-slate-200", text: "text-slate-500",  bar: "#94a3b8" },
                    { bg: "bg-orange-50", border: "border-orange-200",text: "text-orange-500", bar: "#fb923c" },
                  ]
                  return doctors.map((d, i) => {
                    const style   = RANK_STYLE[i] ?? { bg: "bg-gray-50", border: "border-gray-100", text: "text-gray-400", bar: "#c084fc" }
                    const barPct  = Math.max((d.count / (doctors[0]?.count || 1)) * 100, 8)
                    const share   = totalRefs > 0 ? Math.round((d.count / totalRefs) * 100) : 0
                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.06, duration: 0.3 }}
                        className="py-3 first:pt-1"
                      >
                        <div className="flex items-start gap-3">
                          {/* Rank badge */}
                          <div className={`flex items-center justify-center h-7 w-7 rounded-xl border shrink-0 mt-0.5 ${style.bg} ${style.border}`}>
                            <span className={`text-[11px] font-extrabold ${style.text}`}>{i + 1}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Name + count */}
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-sm font-semibold text-gray-800 truncate">{d.name}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-sm font-bold text-gray-900">{d.count}</span>
                                <span className="text-xs text-muted-foreground">
                                  {d.count === 1 ? "referral" : "referrals"}
                                </span>
                              </div>
                            </div>

                            {/* Bar + share % */}
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <motion.div
                                  className="h-full rounded-full"
                                  style={{ background: `linear-gradient(90deg, ${style.bar}99, ${style.bar})` }}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${barPct}%` }}
                                  transition={{ delay: i * 0.06 + 0.15, duration: 0.6, ease: "easeOut" }}
                                />
                              </div>
                              <span className="text-[10px] font-semibold text-gray-400 w-7 text-right shrink-0">{share}%</span>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })
                })()}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">No referral data yet.</p>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}

// ── Custom range view ─────────────────────────────────────────────────────────

function CustomView({ patients, bills, startDate, endDate }: {
  patients: PatientRow[]; bills: BillRow[]
  startDate: string; endDate: string
}) {
  if (startDate > endDate) {
    return <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">End date must be on or after the start date.</CardContent></Card>
  }

  const start = new Date(startDate + "T00:00:00")
  const end   = new Date(endDate   + "T23:59:59.999")

  const pts = patients.filter(p => inRange(p.createdAt, start, end))
  const bls = bills.filter(b => inRange(billDate(b), start, end))

  const rev         = bls.reduce((s, b) => s + b.paid, 0)
  const outstanding = bls.reduce((s, b) => s + Math.max(0, b.charges - (b.discount ?? 0) - b.paid), 0)
  const billed      = bls.reduce((s, b) => s + b.charges - (b.discount ?? 0), 0)
  const collectRate = billed > 0 ? Math.round((rev / billed) * 100) : 0

  const days       = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const granularity = days === 1 ? "Hourly" : days <= 35 ? "Daily" : "Weekly"
  const chunks     = byRangeChunks(pts, bls, start, end)

  const studies = studyBreakdown(pts, bls)
  const doctors = topDoctors(pts)
  const modes   = paymentDist(bls)
  const rStatus = {
    pending:    pts.filter(p => p.reportStatus === "pending").length,
    inProgress: pts.filter(p => p.reportStatus === "in_progress").length,
    completed:  pts.filter(p => p.reportStatus === "completed").length,
  }

  const labelStart = start.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  const labelEnd   = end.toLocaleDateString("en-IN",   { day: "2-digit", month: "short", year: "numeric" })
  const rangeLabel = startDate === endDate ? labelStart : `${labelStart} – ${labelEnd}`

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Patients"          value={String(pts.length)} sub={rangeLabel}           icon={Users}         accent="border-l-blue-500"   />
        <KpiCard label="Revenue Collected" value={fmtRev(rev)}        sub="Paid in range"         icon={IndianRupee}   accent="border-l-green-500"  />
        <KpiCard label="Collection Rate"   value={`${collectRate}%`}  sub="Of billed amount"      icon={TrendingUp}    accent="border-l-purple-500" />
        <KpiCard label="Outstanding"       value={fmtRev(outstanding)} sub="Pending collection"   icon={CreditCard}    accent="border-l-orange-400" />
      </div>

      {chunks.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <SectionCard title={`Patients (${granularity})`}>
            <VBarChart data={chunks.map(c => ({ label: c.label, value: c.patients }))} color="#3b82f6" animKey="custom-pts" />
          </SectionCard>
          <SectionCard title={`Revenue (${granularity}) (₹)`}>
            <VBarChart data={chunks.map(c => ({ label: c.label, value: c.revenue }))} color="#22c55e" animKey="custom-rev" />
          </SectionCard>
        </div>
      ) : (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No patient data found for this date range.</CardContent></Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="sm:col-span-2">
          <SectionCard title="Study Breakdown">
            {studies.length > 0
              ? <HBarChart data={studies.map(s => ({ label: s.study, value: s.count, sub: s.revenue }))} color="linear-gradient(90deg,#6366f1,#8b5cf6)" animKey="custom-study" />
              : <p className="text-sm text-muted-foreground py-4">No studies in this range.</p>}
          </SectionCard>
        </div>
        <div className="space-y-5">
          {pts.length > 0 && (
            <SectionCard title="Report Status">
              <MiniDonut
                segments={[
                  { label: "Completed",   value: rStatus.completed,  color: "#22c55e" },
                  { label: "In Progress", value: rStatus.inProgress, color: "#3b82f6" },
                  { label: "Pending",     value: rStatus.pending,    color: "#e5e7eb" },
                ]}
                animKey="custom-report"
              />
            </SectionCard>
          )}
          {doctors.length > 0 && (
            <SectionCard title="Top Doctors">
              <div className="space-y-2">
                {doctors.map((d, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                    className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400 font-bold w-4">{i + 1}</span>
                    <span className="flex-1 text-gray-700 font-medium truncate">{d.name}</span>
                    <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">{d.count}</span>
                  </motion.div>
                ))}
              </div>
            </SectionCard>
          )}
          {modes.length > 0 && (
            <SectionCard title="Payment Mode">
              <MiniDonut
                segments={modes.map((m, i) => ({ label: m.mode, value: m.count, color: ["#3b82f6","#22c55e","#f59e0b","#8b5cf6"][i] ?? "#9ca3af" }))}
                animKey="custom-mode"
              />
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "today",  label: "Today"      },
  { key: "week",   label: "This Week"  },
  { key: "month",  label: "This Month" },
  { key: "year",   label: "This Year"  },
  { key: "custom", label: "Custom"     },
] as const

type Tab = typeof TABS[number]["key"]

function todayIso()     { return new Date().toISOString().slice(0, 10) }
function thisMonthIso() { return new Date().toISOString().slice(0, 7) }
function thisYear()     { return new Date().getFullYear() }

// ── Picker helpers ────────────────────────────────────────────────────────────

function StyledSelect({ value, onChange, options }: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none bg-white border border-gray-200 rounded-xl shadow-sm pl-3 pr-8 py-2 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer min-w-[160px]"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
    </div>
  )
}

function weekOptions(): { value: string; label: string }[] {
  const opts = []
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const dow = now.getDay()
  const curMon = new Date(now)
  curMon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1))
  for (let i = 0; i < 52; i++) {
    const mon = new Date(curMon); mon.setDate(curMon.getDate() - i * 7)
    const sun = new Date(mon);   sun.setDate(mon.getDate() + 6)
    opts.push({
      value: mon.toISOString().slice(0, 10),
      label: `${mon.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${sun.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
    })
  }
  return opts
}

function monthOptions(): { value: string; label: string }[] {
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"]
  const opts = []
  const now = new Date()
  for (let i = 0; i < 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    opts.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
    })
  }
  return opts
}

function yearOptions(): { value: string; label: string }[] {
  const cur = new Date().getFullYear()
  return [cur, cur - 1, cur - 2, cur - 3].map(y => ({ value: String(y), label: String(y) }))
}

export default function AnalyticsPage() {
  const [tab,      setTab]      = useState<Tab>("today")
  const [patients, setPatients] = useState<PatientRow[]>([])
  const [bills,    setBills]    = useState<BillRow[]>([])
  const [loading,  setLoading]  = useState(true)

  // Per-tab date selectors
  const [selDate,        setSelDate]        = useState(todayIso)       // YYYY-MM-DD
  const [selWeek,        setSelWeek]        = useState(todayIso)       // any date in target week
  const [selMonth,       setSelMonth]       = useState(thisMonthIso)   // YYYY-MM
  const [selYear,        setSelYear]        = useState(thisYear)       // number
  const [selRangeStart,  setSelRangeStart]  = useState(() => {         // custom range start (7 days ago)
    const d = new Date(); d.setDate(d.getDate() - 6); return toDateStr(d)
  })
  const [selRangeEnd, setSelRangeEnd] = useState(todayIso)             // custom range end

  useEffect(() => {
    Promise.all([
      fetch("/api/patients").then(r => r.json()),
      fetch("/api/billing").then(r => r.json()),
    ]).then(([pd, bd]) => {
      setPatients(pd.patients ?? [])
      setBills(bd.bills ?? [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const ranges = useMemo(
    () => getRangesFor(selDate, selWeek, selMonth, selYear),
    [selDate, selWeek, selMonth, selYear]
  )

  const rangesKey = `${selDate}-${selWeek}-${selMonth}-${selYear}-${selRangeStart}-${selRangeEnd}`

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">Patient visits · Revenue · Study breakdown · Referrals</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground border rounded-lg px-3 py-1.5 bg-muted/30">
          <Activity className="h-3.5 w-3.5" />
          <span>Live data</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex gap-1 rounded-xl border border-border bg-muted/40 p-1 w-fit">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className="relative px-4 py-1.5 text-sm font-medium z-10 transition-colors">
              {tab === t.key && (
                <motion.div layoutId="tab-pill" className="absolute inset-0 bg-white shadow-sm rounded-lg border border-blue-100" style={{ zIndex: -1 }} transition={{ type: "spring", stiffness: 400, damping: 30 }} />
              )}
              <span className={tab === t.key ? "text-blue-700" : "text-muted-foreground hover:text-foreground"}>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Contextual date selectors */}
        <AnimatePresence mode="wait">
          {tab === "today" && (
            <motion.div key="sel-day" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}
              className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                type="date"
                value={selDate}
                onChange={e => e.target.value && setSelDate(e.target.value)}
                max={todayIso()}
                className="text-sm border border-gray-200 rounded-xl shadow-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer"
              />
            </motion.div>
          )}
          {tab === "week" && (
            <motion.div key="sel-week" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}
              className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <StyledSelect value={selWeek} onChange={setSelWeek} options={weekOptions()} />
            </motion.div>
          )}
          {tab === "month" && (
            <motion.div key="sel-month" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}
              className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <StyledSelect value={selMonth} onChange={setSelMonth} options={monthOptions()} />
            </motion.div>
          )}
          {tab === "year" && (
            <motion.div key="sel-year" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}
              className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <StyledSelect value={String(selYear)} onChange={v => setSelYear(Number(v))} options={yearOptions()} />
            </motion.div>
          )}
          {tab === "custom" && (
            <motion.div key="sel-custom" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.18 }}
              className="flex flex-wrap items-center gap-2">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                type="date"
                value={selRangeStart}
                max={selRangeEnd}
                onChange={e => e.target.value && setSelRangeStart(e.target.value)}
                className="text-sm border border-gray-200 rounded-xl shadow-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer"
              />
              <span className="text-xs text-muted-foreground font-medium">to</span>
              <input
                type="date"
                value={selRangeEnd}
                min={selRangeStart}
                max={todayIso()}
                onChange={e => e.target.value && setSelRangeEnd(e.target.value)}
                className="text-sm border border-gray-200 rounded-xl shadow-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24 gap-2 text-sm text-muted-foreground">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
            <Activity className="h-5 w-5" />
          </motion.div>
          Loading analytics…
        </div>
      )}

      {/* Tab content */}
      {!loading && (
        <AnimatePresence mode="wait">
          <motion.div
            key={`${tab}-${rangesKey}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {tab === "today"  && <TodayView  patients={patients} bills={bills} ranges={ranges} />}
            {tab === "week"   && <WeekView   patients={patients} bills={bills} ranges={ranges} />}
            {tab === "month"  && <MonthView  patients={patients} bills={bills} ranges={ranges} />}
            {tab === "year"   && <YearView   patients={patients} bills={bills} ranges={ranges} />}
            {tab === "custom" && <CustomView patients={patients} bills={bills} startDate={selRangeStart} endDate={selRangeEnd} />}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  )
}
