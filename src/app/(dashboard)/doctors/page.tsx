"use client"

// Doctors — referral counts only.
//
// Counts span both sources of truth: patients booked in the system and the rows
// imported from the monthly Excel sheets, so a doctor's total is their whole
// history with the centre, not just what has been keyed in since go-live. The
// register itself lives on the Monthly Register page.

import { useState, useEffect, useMemo } from "react"
import {
  Search, Info, Loader2, CheckCircle2, AlertCircle, Users, TrendingUp, FileSpreadsheet,
} from "lucide-react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { motion } from "framer-motion"
import { SavedRegisterRow, sourceTypeOf } from "@/lib/register-columns"

// ── Constants ────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "bg-violet-100 text-violet-700",
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-orange-100 text-orange-700",
  "bg-pink-100 text-pink-700",
  "bg-indigo-100 text-indigo-700",
  "bg-teal-100 text-teal-700",
  "bg-rose-100 text-rose-700",
]

// ── Types ────────────────────────────────────────────────────────────────────

interface StudyEntry {
  name: string
  category?: string
  reportStatus: "pending" | "in_progress" | "completed"
}

interface PatientRef {
  _id: string
  srNo: number
  name: string
  study: string
  studies?: StudyEntry[]
  referredBy: string
  reportStatus: "pending" | "in_progress" | "completed"
  createdAt: string
}

// Every patient has at least one study; older records fall back to the legacy
// single-study field so this always returns at least one entry.
function studiesOf(p: PatientRef): StudyEntry[] {
  return p.studies?.length ? p.studies : [{ name: p.study, reportStatus: p.reportStatus }]
}

interface DoctorStat {
  name: string
  referrals: number     // distinct patients
  tests: number         // rows — one per investigation
  imported: number      // how many of those came from an Excel sheet
}

function initials(name: string) {
  return name.replace(/^Dr\.?\s*/i, "").split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase()
}

const isSelf = (name: string) => !name || name.toLowerCase() === "self"

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DoctorsPage() {
  const [search,      setSearch]      = useState("")
  const [allPatients, setAllPatients] = useState<PatientRef[]>([])
  const [imported,    setImported]    = useState<SavedRegisterRow[]>([])
  const [pageLoading, setPageLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch("/api/patients").then((r) => r.json()).catch(() => ({ patients: [] })),
      // Imported monthly sheets — the referral history from before go-live
      fetch("/api/register?month=all").then((r) => r.json()).catch(() => ({ entries: [] })),
    ])
      .then(([pData, rData]) => {
        setAllPatients(pData.patients ?? [])
        setImported(rData.entries ?? [])
      })
      .finally(() => setPageLoading(false))
  }, [])

  // Sheet rows mirrored from system patients are skipped — the patient record
  // already counts them, and counting both would double every referral.
  const sheetRows = useMemo(() => imported.filter((e) => sourceTypeOf(e) !== "system"), [imported])

  const doctors: DoctorStat[] = useMemo(() => {
    const map: Record<string, { people: Set<string>; tests: number; imported: number }> = {}
    const bucket = (name: string) => (map[name] ??= { people: new Set(), tests: 0, imported: 0 })

    for (const p of allPatients) {
      const key = (p.referredBy ?? "").trim()
      if (isSelf(key)) continue
      const b = bucket(key)
      b.people.add(`live:${p._id}`)
      b.tests += studiesOf(p).length
    }

    for (const r of sheetRows) {
      const key = (r.referredBy ?? "").trim()
      if (isSelf(key)) continue
      const b = bucket(key)
      // An imported sheet has no patient ids, so a patient is a name on a date
      b.people.add(`sheet:${(r.name ?? "").toLowerCase()}|${r.date ?? ""}`)
      b.tests    += 1
      b.imported += 1
    }

    return Object.entries(map)
      .map(([name, v]) => ({ name, referrals: v.people.size, tests: v.tests, imported: v.imported }))
      .sort((a, b) => b.referrals - a.referrals || a.name.localeCompare(b.name))
  }, [allPatients, sheetRows])

  const filtered = doctors.filter((d) => !search || d.name.toLowerCase().includes(search.toLowerCase()))

  const totalReferrals = doctors.reduce((s, d) => s + d.referrals, 0)
  const importedRows   = doctors.reduce((s, d) => s + d.imported, 0)

  const referredStudies = allPatients
    .filter((p) => !isSelf((p.referredBy ?? "").trim()))
    .flatMap(studiesOf)
  const pendingReports = referredStudies.filter((s) => s.reportStatus !== "completed").length
  const doneReports    = referredStudies.filter((s) => s.reportStatus === "completed").length

  const topCount = filtered[0]?.referrals ?? 0

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Doctors</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Referring doctors ranked by how many patients they sent, across the system and every imported sheet
        </p>
      </div>

      <motion.div
        className="grid grid-cols-2 sm:grid-cols-4 gap-4"
        initial="hidden" animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
      >
        {[
          { label: "Total Doctors",   value: pageLoading ? "—" : String(doctors.length),  icon: <Users className="h-4 w-4 text-blue-500" />        },
          { label: "Total Referrals", value: pageLoading ? "—" : String(totalReferrals),  icon: <TrendingUp className="h-4 w-4 text-violet-500" /> },
          { label: "Reports Pending", value: pageLoading ? "—" : String(pendingReports),  icon: <AlertCircle className="h-4 w-4 text-orange-400" /> },
          { label: "Reports Done",    value: pageLoading ? "—" : String(doneReports),     icon: <CheckCircle2 className="h-4 w-4 text-green-500" /> },
        ].map((s) => (
          <motion.div key={s.label} className="h-full" variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
            <Card className="h-full">
              <CardContent className="p-4 h-full">
                <div className="mb-1">{s.icon}</div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Referral Counts</CardTitle>
              <CardDescription>
                {pageLoading
                  ? "Loading…"
                  : `${filtered.length} doctor${filtered.length !== 1 ? "s" : ""}${importedRows ? ` · ${importedRows} rows from imported sheets` : ""}`}
              </CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search doctor…" className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {pageLoading && (
            <div className="flex items-center justify-center py-16 gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Loading doctors…
            </div>
          )}

          {!pageLoading && filtered.length === 0 && (
            <p className="text-center py-14 text-muted-foreground text-sm px-4">
              {doctors.length === 0
                ? "No referral data yet. Register patients with a referring doctor, or import a monthly sheet."
                : "No doctors match your search."}
            </p>
          )}

          {!pageLoading && filtered.length > 0 && (
            <>
              <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 px-5 py-2 bg-slate-100 border-y border-gray-200 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                <span className="w-7">#</span>
                <span>Doctor</span>
                <span className="w-16 text-right">Tests</span>
                <span className="w-20 text-right">Patients</span>
              </div>
              <div className="divide-y divide-gray-100">
                {filtered.map((doc, i) => (
                  <motion.div
                    key={doc.name}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ duration: 0.18, delay: Math.min(i, 12) * 0.02 }}
                    className="grid grid-cols-[auto_1fr_auto_auto] gap-3 items-center px-5 py-2.5 hover:bg-gray-50/80"
                  >
                    <span className="w-7 text-xs font-bold text-gray-300 text-right">{i + 1}</span>

                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                        {initials(doc.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate" title={doc.name}>{doc.name}</p>
                        {/* Share of the top referrer, so the ranking reads at a glance */}
                        <div className="h-1 mt-1 w-full max-w-[220px] rounded-full bg-gray-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-blue-500/70"
                            style={{ width: `${topCount ? Math.max(4, (doc.referrals / topCount) * 100) : 0}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="w-16 text-right">
                      <p className="text-sm font-semibold text-gray-700">{doc.tests}</p>
                      {doc.imported > 0 && <p className="text-[10px] text-amber-600">{doc.imported} imported</p>}
                    </div>

                    <div className="w-20 text-right">
                      <span className="inline-block text-sm font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                        {doc.referrals}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          <strong>Patients</strong> counts people referred; <strong>Tests</strong> counts investigations, so a patient sent for
          two scans adds one patient and two tests. Walk-ins marked <em>Self</em> are left out. The month-by-month register
          itself lives on the{" "}
          <Link href="/register" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
            <FileSpreadsheet className="h-3.5 w-3.5" />Monthly Register
          </Link>{" "}
          page.
        </span>
      </div>
    </div>
  )
}
