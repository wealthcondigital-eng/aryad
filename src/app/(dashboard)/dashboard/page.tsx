"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import {
  Users, IndianRupee, UserPlus, TrendingUp, Tag,
  Phone, BadgeIndianRupee, ArrowRight, Clock,
  CheckCircle2, AlertCircle, MessageCircle,
  ClipboardEdit, Eye, Share2, Printer, FileText,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useRole } from "@/lib/role-context"
import { motion } from "motion/react"
import { ReportViewModal } from "@/components/report-view-modal"
import { BillDocViewer } from "@/components/bill-doc-viewer"
import { shareReportOnWhatsApp } from "@/lib/share-whatsapp"

interface StudyEntry {
  name: string
  category?: string
  reportStatus: "pending" | "in_progress" | "completed"
  reportSlug?: string
  billId?: string
  charges?: number
  paid?: number
  discount?: number
  paymentMode?: string
}

interface PatientDoc {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  address: string
  referredBy: string
  study: string
  studies?: StudyEntry[]
  reportStatus: "pending" | "in_progress" | "completed"
  charges: number
  paid: number
  discount: number
  paymentMode: string
  billId?: string
  reportSlug?: string
  createdAt: string
}

// Every patient has at least one study; older records are normalised by the API
function studiesOf(p: PatientDoc): StudyEntry[] {
  return p.studies?.length
    ? p.studies
    : [{ name: p.study, reportStatus: p.reportStatus, reportSlug: p.reportSlug }]
}

// Converts the saved report to PDF and stores it before WhatsApp opens, so the
// link in the message always resolves to a file. No contact is passed: WhatsApp
// Web opens on the logged-in account and the sender picks the recipient.
function shareOnWhatsApp(p: PatientDoc, sidx = 0) {
  const entry = studiesOf(p)[sidx]
  void shareReportOnWhatsApp({
    patientId: p._id,
    sidx,
    patientName: p.name,
    studyName: entry?.name ?? p.study,
  })
}

function dateOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}
function timeOf(d: string) {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
}
function payStatusOf(charges: number, paid: number) {
  if (charges === 0) return "pending"
  if (paid >= charges) return "paid"
  if (paid > 0) return "partial"
  return "pending"
}

function buildFillHref(p: PatientDoc, sidx = 0, mode: "fill" | "view" | "edit" = "fill") {
  const entry = studiesOf(p)[sidx]
  const params = new URLSearchParams({
    patient: p.name, study: entry?.name ?? p.study, sidx: String(sidx),
    refBy: p.referredBy || "Self",
    date: dateOf(p.createdAt), age: String(p.age), gender: p.gender,
    srNo: String(p.srNo), contact: p.contact, id: p._id,
    ...(mode === "view" ? { view: "1" } : {}),
    ...(mode === "edit" ? { load: "1" } : {}),
  })
  return `/reports/new?${params}`
}

function buildBillHref(p: PatientDoc, sidx = 0) {
  const study = studiesOf(p)[sidx]?.name || p.study
  const params = new URLSearchParams({
    id:      p._id,
    sidx:    String(sidx),
    name:    p.name,
    srNo:    String(p.srNo),
    study:   study,
    age:     String(p.age),
    gender:  p.gender,
    contact: p.contact,
    refBy:   p.referredBy || "Self",
  })
  return `/billing/new?${params}`
}

const payStatusStyle: Record<string, string> = {
  paid:    "bg-green-100 text-green-700",
  partial: "bg-yellow-100 text-yellow-700",
  pending: "bg-red-100 text-red-700",
}

function ReportStatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700"><CheckCircle2 className="h-3 w-3" />Done</span>
  if (status === "in_progress")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700"><Clock className="h-3 w-3" />In Progress</span>
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600"><AlertCircle className="h-3 w-3" />Pending</span>
}

// ─── Doctor dashboard ─────────────────────────────────────────────────────────

function DoctorDashboard({ name, patients, loading }: { name: string; patients: PatientDoc[]; loading: boolean }) {
  const [viewing, setViewing] = useState<{ p: PatientDoc; sidx: number } | null>(null)

  // One row per study — each study has its own report
  const rows = patients.flatMap((p) => studiesOf(p).map((entry, sidx) => ({ p, entry, sidx })))

  const pending   = rows.filter((r) => r.entry.reportStatus === "pending").length
  const inProg    = rows.filter((r) => r.entry.reportStatus === "in_progress").length
  const completed = rows.filter((r) => r.entry.reportStatus === "completed").length

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"

  return (
    <>
    {viewing && (
      <ReportViewModal
        patient={{ ...viewing.p, study: studiesOf(viewing.p)[viewing.sidx]?.name ?? viewing.p.study }}
        sidx={viewing.sidx}
        onClose={() => setViewing(null)}
      />
    )}
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">{greeting}, {name.split(" ").slice(0, 2).join(" ")}!</h1>
        <p className="text-sm text-muted-foreground">{today} · Today&apos;s patient queue</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Today", value: rows.length, border: "border-l-blue-500",   Icon: Users },
          { label: "Pending",     value: pending,          border: "border-l-slate-400",  Icon: AlertCircle },
          { label: "In Progress", value: inProg,           border: "border-l-yellow-500", Icon: Clock },
          { label: "Completed",   value: completed,        border: "border-l-green-500",  Icon: CheckCircle2 },
        ].map(({ label, value, border, Icon }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.3 }}
          >
            <Card className={`border-l-4 ${border} h-full`}>
              <CardContent className="p-4 flex items-center justify-between h-full">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                  {loading ? <Skeleton className="h-8 w-10 mt-1" /> : <p className="text-2xl font-bold mt-1">{value}</p>}
                </div>
                <Icon className="h-5 w-5 text-muted-foreground/40" />
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold">Today&apos;s Patient Queue</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <>
              {/* Desktop loading skeleton */}
              <div className="hidden md:block px-5 pb-2">
                {/* skeleton header bar */}
                <div className="flex items-center gap-4 py-3 border-b border-border/60 mb-1">
                  <Skeleton className="h-3 w-5" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-24 hidden sm:block" />
                  <Skeleton className="h-3 w-20 hidden md:block" />
                  <Skeleton className="h-3 w-12 hidden sm:block" />
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-3 w-16 ml-auto" />
                </div>
                {[...Array(6)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="grid grid-cols-7 gap-3 items-center py-3 border-b border-border/40 last:border-0"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.25, ease: "easeOut" }}
                  >
                    <Skeleton className="h-4 w-6" />
                    <div className="col-span-2 space-y-1.5">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                    <Skeleton className="h-4 w-28 hidden sm:block" />
                    <Skeleton className="h-4 w-24 hidden md:block" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-7 w-24 justify-self-end rounded-lg" />
                  </motion.div>
                ))}
              </div>

              {/* Mobile loading skeleton */}
              <div className="block md:hidden divide-y divide-border px-4 py-1">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="py-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-40" />
                    <div className="flex items-center justify-between pt-1">
                      <Skeleton className="h-5 w-20 rounded" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="flex items-center gap-1.5 justify-end pt-1">
                      <Skeleton className="h-7 w-20 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Desktop view: Grouped Cards */}
              <div className="hidden md:block space-y-4 px-5 pb-5 pt-3">
                {patients.length === 0 && (
                  <p className="text-center py-10 text-muted-foreground text-sm">
                    No patients registered today yet.
                  </p>
                )}
                {patients.map((p, i) => {
                  const pStudies = studiesOf(p)
                  return (
                    <div key={p._id} className="rounded-xl border bg-background shadow-sm overflow-hidden text-left">
                      {/* Column headers for the first card to keep alignment neat */}
                      {i === 0 && (
                        <div className="grid grid-cols-[minmax(240px,2fr)_minmax(140px,1.2fr)_120px_100px_100px_minmax(200px,1.8fr)] items-center gap-4 px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase bg-slate-50/50 border-b">
                          <span>Patient</span>
                          <span>Study</span>
                          <span>Referred By</span>
                          <span>Time</span>
                          <span>Report</span>
                          <span className="text-right">Action</span>
                        </div>
                      )}
                      
                      {/* List of study rows inside the card */}
                      {pStudies.map((entry, sidx) => {
                        const firstRow = sidx === 0
                        return (
                          <div
                            key={sidx}
                            className={`grid grid-cols-[minmax(240px,2fr)_minmax(140px,1.2fr)_120px_100px_100px_minmax(200px,1.8fr)] items-center gap-4 px-5 py-3.5 hover:bg-muted/10 transition-colors relative ${
                              !firstRow ? "border-t border-slate-100 bg-slate-50/30" : ""
                            }`}
                          >
                            {/* Visual Tree Connector Lines relative to row wrapper */}
                            {pStudies.length > 1 && (
                              <>
                                {firstRow ? (
                                  <div className="absolute left-[36px] top-[36px] bottom-0 w-0.5 bg-slate-200" />
                                ) : (
                                  <>
                                    {sidx < pStudies.length - 1 && (
                                      <div className="absolute left-[36px] top-0 bottom-0 w-0.5 bg-slate-200" />
                                    )}
                                    <div className="absolute left-[36px] top-0 w-[12px] h-[24px] border-l-2 border-b-2 border-slate-200 rounded-bl-md" />
                                  </>
                                )}
                              </>
                            )}

                            {/* Patient Info */}
                            <div className={`flex items-center gap-3 ${!firstRow ? "pl-7" : ""}`}>
                              {/* Avatar / File icon */}
                              <div className={`rounded-lg flex items-center justify-center shrink-0 relative z-10 ${
                                firstRow
                                  ? "h-8 w-8 bg-blue-50 text-blue-600 font-semibold text-xs"
                                  : "h-6 w-6 bg-slate-100 text-slate-500"
                              }`}>
                                {firstRow ? (
                                  p.name.split(" ").map((n) => n[0]).join("").slice(0, 2)
                                ) : (
                                  <FileText className="h-3.5 w-3.5" />
                                )}
                              </div>

                              <div>
                                {firstRow ? (
                                  <>
                                    <p className="font-semibold text-sm text-slate-800 leading-tight">{p.name}</p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5">{p.age}y {p.gender[0]} · #{p.srNo}</p>
                                  </>
                                ) : (
                                  <span className="text-xs text-muted-foreground">same patient</span>
                                )}
                              </div>
                            </div>

                            {/* Study */}
                            <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                              <span className="truncate">{entry.name}</span>
                              {pStudies.length > 1 && (
                                <span className="text-[9px] bg-blue-100 text-blue-700 px-1 py-0.2 rounded font-medium shrink-0">
                                  {sidx + 1}/{pStudies.length}
                                </span>
                              )}
                            </div>

                            {/* Referred By */}
                            <div className="text-xs text-muted-foreground truncate border-none">
                              {firstRow ? p.referredBy || "Self" : ""}
                            </div>

                            {/* Time */}
                            <div className="text-xs text-muted-foreground">
                              {timeOf(p.createdAt)}
                            </div>

                            {/* Report Status */}
                            <div>
                              <ReportStatusBadge status={entry.reportStatus} />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-1.5">
                              {entry.reportStatus === "completed" ? (
                                <>
                                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                                    onClick={() => setViewing({ p, sidx })}>
                                    <Eye className="h-3 w-3" />View
                                  </Button>
                                  <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
                                    <Link href={buildFillHref(p, sidx, "edit")}><ClipboardEdit className="h-3 w-3" />Edit</Link>
                                  </Button>
                                  <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700"
                                    onClick={() => shareOnWhatsApp(p, sidx)}>
                                    <MessageCircle className="h-3 w-3" />Share
                                  </Button>
                                </>
                              ) : (
                                <Button asChild size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700">
                                  <Link href={buildFillHref(p, sidx)}>
                                    <ClipboardEdit className="h-3 w-3" />
                                    {entry.reportStatus === "in_progress" ? "Continue" : "Fill Report"}
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {/* Mobile view: Cards list grouped by Patient */}
              <div className="block md:hidden px-4 pb-4 space-y-4 pt-3">
                {patients.length === 0 && (
                  <p className="text-center py-10 text-muted-foreground text-sm">
                    No patients registered today yet.
                  </p>
                )}
                {patients.map((p, i) => {
                  const pStudies = studiesOf(p)
                  return (
                    <div key={p._id} className="rounded-xl border bg-background shadow-sm overflow-hidden p-3.5 space-y-3">
                      {/* Top: Name, Age/Gender */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-mono font-bold text-slate-400">#{i + 1}</span>
                            <p className="font-semibold text-sm text-slate-800">{p.name}</p>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {p.age} yrs · {p.gender} · #{p.srNo}
                          </p>
                        </div>
                        <div className="text-right text-[11px] text-muted-foreground">
                          Ref: <span className="font-medium text-slate-700">{p.referredBy || "Self"}</span>
                        </div>
                      </div>

                      {/* Contact detail */}
                      <div className="flex items-center text-xs text-muted-foreground pt-0.5 border-t border-slate-100">
                        <Phone className="h-3 w-3 text-slate-400 mr-1.5 shrink-0" /> {p.contact}
                      </div>

                      {/* List of studies */}
                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        {pStudies.map((entry, sidx) => (
                          <div key={sidx} className="bg-slate-50 rounded-lg p-2.5 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-700">
                                {pStudies.length > 1 ? `${sidx + 1}. ` : ""}{entry.name}
                              </span>
                              <ReportStatusBadge status={entry.reportStatus} />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1.5 pt-1 justify-end">
                              {entry.reportStatus === "completed" ? (
                                <>
                                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2.5"
                                    onClick={() => setViewing({ p, sidx })}>
                                    <Eye className="h-3 w-3" />View Report
                                  </Button>
                                  <Button asChild variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2.5">
                                    <Link href={buildFillHref(p, sidx, "edit")}><ClipboardEdit className="h-3 w-3" />Edit</Link>
                                  </Button>
                                  <Button size="sm" className="h-7 text-[11px] gap-1 px-2.5 bg-green-600 hover:bg-green-700"
                                    onClick={() => shareOnWhatsApp(p, sidx)}>
                                    <MessageCircle className="h-3 w-3" />Share
                                  </Button>
                                </>
                              ) : (
                                <Button asChild size="sm" className="h-7 text-[11px] gap-1 px-2.5 bg-blue-600 hover:bg-blue-700">
                                  <Link href={buildFillHref(p, sidx)}>
                                    <ClipboardEdit className="h-3 w-3" />
                                    {entry.reportStatus === "in_progress" ? "Continue" : "Fill Report"}
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  )
}

// ─── Receptionist dashboard ───────────────────────────────────────────────────

function ReceptionistDashboard({ name, patients, loading }: { name: string; patients: PatientDoc[]; loading: boolean }) {
  const [viewReport, setViewReport] = useState<{ p: PatientDoc; sidx: number } | null>(null)
  const [viewBill,   setViewBill]   = useState<PatientDoc | null>(null)

  // One row per study — the receptionist can fill/edit each study's report separately
  const rows = patients.flatMap((p) => studiesOf(p).map((entry, sidx) => ({ p, entry, sidx })))

  const todayCollection = patients.reduce((s, p) => s + (p.paid || 0), 0)
  const todayTotal      = patients.reduce((s, p) => s + (p.charges || 0), 0)
  const pendingPay      = patients.filter((p) => payStatusOf(p.charges, p.paid) === "pending").length

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{greeting}, {name.split(" ")[0]}!</h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        <Button asChild className="bg-blue-600 hover:bg-blue-700 shadow-sm w-full sm:w-auto">
          <Link href="/patients/new"><UserPlus className="h-4 w-4 mr-2" />Register New Patient</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { border: "border-l-blue-500", label: "Today's Patients", skW: "w-10", content: !loading && <p className="text-2xl font-bold mt-1">{patients.length}</p> },
          { border: "border-l-green-500", label: "Collected", skW: "w-20", content: !loading && <><p className="text-2xl font-bold mt-1">₹{todayCollection.toLocaleString()}</p><p className="text-xs text-muted-foreground">of ₹{todayTotal.toLocaleString()}</p></> },
          { border: "border-l-red-400", label: "Pending Pay", skW: "w-10", content: !loading && <p className="text-2xl font-bold mt-1">{pendingPay}</p> },
        ].map(({ border, label, skW, content }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.3 }}
          >
            <Card className={`border-l-4 ${border} h-full`}>
              <CardContent className="p-4 h-full">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                {loading ? <Skeleton className={`h-8 ${skW} mt-1`} /> : content}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold">
            Today&apos;s Patients
            {!loading && <span className="ml-2 text-xs font-normal text-muted-foreground">{patients.length} registered</span>}
          </CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/patients" className="text-blue-600 text-xs flex items-center gap-1">
              View All <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <>
              {/* Desktop loading skeleton */}
              <div className="hidden md:block px-5 pb-2">
                <div className="flex items-center gap-4 py-3 border-b border-border/60 mb-1">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-24 hidden sm:block" />
                  <Skeleton className="h-3 w-16 ml-auto" />
                  <Skeleton className="h-3 w-16 hidden sm:block" />
                  <Skeleton className="h-3 w-20" />
                </div>
                {[...Array(6)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="grid grid-cols-6 gap-3 items-center py-3 border-b border-border/40 last:border-0"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.25, ease: "easeOut" }}
                  >
                    <div className="col-span-2 space-y-1.5">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-4 w-28 hidden sm:block" />
                    <Skeleton className="h-4 w-16 justify-self-end" />
                    <Skeleton className="h-5 w-16 rounded-full justify-self-center hidden sm:block" />
                    <Skeleton className="h-5 w-16 rounded-full justify-self-center" />
                  </motion.div>
                ))}
              </div>

              {/* Mobile loading skeleton */}
              <div className="block md:hidden divide-y divide-border px-4 py-1">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="py-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-40" />
                    <div className="flex items-center justify-between pt-1">
                      <Skeleton className="h-5 w-20 rounded" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <div className="flex items-center gap-1.5 justify-end pt-1">
                      <Skeleton className="h-7 w-20 rounded" />
                      <Skeleton className="h-7 w-20 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Desktop view: Grouped Cards */}
              <div className="hidden md:block space-y-4 px-5 pb-5 pt-3">
                {patients.length === 0 && (
                  <p className="text-center py-10 text-muted-foreground text-sm">
                    No patients registered today. <Link href="/patients/new" className="text-blue-600 underline">Register one</Link>
                  </p>
                )}
                {patients.map((p, i) => {
                  const pStudies = studiesOf(p)
                  const payStatus = payStatusOf(p.charges, p.paid)
                  return (
                    <div key={p._id} className="rounded-xl border bg-background shadow-sm overflow-hidden text-left">
                      {/* Column headers for the first card to keep alignment neat */}
                      {i === 0 && (
                        <div className="grid grid-cols-[minmax(240px,2fr)_minmax(140px,1.2fr)_100px_100px_100px_minmax(240px,2fr)] items-center gap-4 px-5 py-2.5 text-xs font-semibold text-muted-foreground uppercase bg-slate-50/50 border-b">
                          <span>Patient</span>
                          <span>Study</span>
                          <span>Charges</span>
                          <span>Payment</span>
                          <span>Report</span>
                          <span className="text-right">Actions</span>
                        </div>
                      )}

                      {/* List of study rows inside the card */}
                      {pStudies.map((entry, sidx) => {
                        const firstRow = sidx === 0
                        return (
                          <div
                            key={sidx}
                            className={`grid grid-cols-[minmax(240px,2fr)_minmax(140px,1.2fr)_100px_100px_100px_minmax(240px,2fr)] items-center gap-4 px-5 py-3.5 hover:bg-muted/10 transition-colors relative ${
                              !firstRow ? "border-t border-slate-100 bg-slate-50/30" : ""
                            }`}
                          >
                            {/* Visual Tree Connector Lines relative to row wrapper */}
                            {pStudies.length > 1 && (
                              <>
                                {firstRow ? (
                                  <div className="absolute left-[36px] top-[36px] bottom-0 w-0.5 bg-slate-200" />
                                ) : (
                                  <>
                                    {sidx < pStudies.length - 1 && (
                                      <div className="absolute left-[36px] top-0 bottom-0 w-0.5 bg-slate-200" />
                                    )}
                                    <div className="absolute left-[36px] top-0 w-[12px] h-[24px] border-l-2 border-b-2 border-slate-200 rounded-bl-md" />
                                  </>
                                )}
                              </>
                            )}

                            {/* Patient Info */}
                            <div className={`flex items-center gap-3 ${!firstRow ? "pl-7" : ""}`}>
                              {/* Avatar / File icon */}
                              <div className={`rounded-lg flex items-center justify-center shrink-0 relative z-10 ${
                                firstRow
                                  ? "h-8 w-8 bg-blue-50 text-blue-600 font-semibold text-xs"
                                  : "h-6 w-6 bg-slate-100 text-slate-500"
                              }`}>
                                {firstRow ? (
                                  p.name.split(" ").map((n) => n[0]).join("").slice(0, 2)
                                ) : (
                                  <FileText className="h-3.5 w-3.5" />
                                )}
                              </div>

                              <div>
                                {firstRow ? (
                                  <>
                                    <p className="font-semibold text-sm text-slate-800 leading-tight">{p.name}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                      <Phone className="h-2.5 w-2.5" />{p.contact}
                                    </p>
                                  </>
                                ) : (
                                  <span className="text-xs text-muted-foreground">same patient</span>
                                )}
                              </div>
                            </div>

                            {/* Study */}
                            <div className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                              <span className="truncate">{entry.name}</span>
                              {pStudies.length > 1 && (
                                <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded font-medium shrink-0">
                                  {sidx + 1}/{pStudies.length}
                                </span>
                              )}
                            </div>

                            {/* Charges */}
                            <div className="text-sm font-medium">
                              {firstRow ? `₹${p.charges || 0}` : ""}
                            </div>

                            {/* Payment Status */}
                            <div>
                              {firstRow && (
                                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${payStatusStyle[payStatus]}`}>
                                  {payStatus}
                                </span>
                              )}
                            </div>

                            {/* Report Status */}
                            <div>
                              {entry.reportStatus === "completed"
                                ? <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium"><CheckCircle2 className="h-3 w-3" />Ready</span>
                                : entry.reportStatus === "in_progress"
                                ? <span className="inline-flex items-center gap-1 text-xs text-yellow-700"><Clock className="h-3 w-3" />In Progress</span>
                                : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />Pending</span>
                              }
                            </div>

                            {/* Actions */}
                            <div className="flex items-center justify-end gap-1.5">
                              {entry.reportStatus === "completed" ? (
                                <>
                                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewReport({ p, sidx })}>
                                    <Eye className="h-3 w-3" />View
                                  </Button>
                                  <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
                                    <Link href={buildFillHref(p, sidx, "edit")}>
                                      <ClipboardEdit className="h-3 w-3" />Edit
                                    </Link>
                                  </Button>
                                  <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700"
                                    onClick={() => shareOnWhatsApp(p, sidx)}>
                                    <Share2 className="h-3 w-3" />Share
                                  </Button>
                                </>
                              ) : (
                                <Button asChild size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700">
                                  <Link href={buildFillHref(p, sidx)}>
                                    <ClipboardEdit className="h-3 w-3" />
                                    {entry.reportStatus === "in_progress" ? "Continue" : "Fill Report"}
                                  </Link>
                                </Button>
                              )}
                              {/* Bill actions for each study row */}
                              {!entry.billId ? (
                                <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1">
                                  <Link href={buildBillHref(p, sidx)}>
                                    <IndianRupee className="h-3 w-3" />Bill
                                  </Link>
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewBill({ ...p, charges: entry.charges || 0, paid: entry.paid || 0, discount: entry.discount || 0, paymentMode: entry.paymentMode || "Cash", billId: entry.billId?.toString() })}>
                                  <Printer className="h-3 w-3" />Bill
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>

              {/* Mobile view: Cards list grouped by Patient */}
              <div className="block md:hidden px-4 pb-4 space-y-4 pt-3">
                {patients.length === 0 && (
                  <p className="text-center py-10 text-muted-foreground text-sm">
                    No patients registered today.
                  </p>
                )}
                {patients.map((p) => {
                  const pStudies = studiesOf(p)
                  const payStatus = payStatusOf(p.charges, p.paid)
                  return (
                    <div key={p._id} className="rounded-xl border bg-background shadow-sm overflow-hidden p-3.5 space-y-3 text-left">
                      {/* Top: Name, Age/Gender */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm text-slate-800">{p.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            #{p.srNo} · {p.age} yrs · <span className="capitalize">{p.gender}</span>
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={`inline-flex rounded-full px-1.5 py-0.2 text-[9px] font-semibold uppercase ${payStatusStyle[payStatus]}`}>
                            {payStatus}
                          </span>
                          <span className="text-xs font-semibold text-slate-800">₹{(p.charges || 0).toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Contact & Referrer */}
                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-0.5 border-t border-slate-100">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3 text-slate-400 shrink-0" /> {p.contact}
                        </span>
                        <span>Ref: <span className="font-medium text-slate-700">{p.referredBy || "Self"}</span></span>
                      </div>

                      {/* List of studies under this patient */}
                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        {pStudies.map((entry, sidx) => {
                          return (
                            <div key={sidx} className="bg-slate-50 rounded-lg p-2.5 space-y-2">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-slate-700">
                                  {pStudies.length > 1 ? `${sidx + 1}. ` : ""}{entry.name}
                                </span>
                                {entry.reportStatus === "completed" ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-green-700 font-semibold px-2 py-0.5 rounded-full bg-green-50">
                                    <CheckCircle2 className="h-3 w-3" />Ready
                                  </span>
                                ) : entry.reportStatus === "in_progress" ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-yellow-700 font-medium px-2 py-0.5 rounded-full bg-yellow-50">
                                    <Clock className="h-3 w-3" />In Progress
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-medium px-2 py-0.5 rounded-full bg-slate-50">
                                    <Clock className="h-3 w-3" />Pending
                                  </span>
                                )}
                              </div>

                              {/* Actions for this study */}
                              <div className="flex items-center gap-1.5 pt-1 justify-end">
                                {entry.reportStatus === "completed" ? (
                                  <>
                                    <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2" onClick={() => setViewReport({ p, sidx })}>
                                      <Eye className="h-3 w-3" />View Report
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="hidden sm:flex h-7 text-[11px] gap-1 px-2"
                                      onClick={() => shareOnWhatsApp(p, sidx)}
                                    >
                                      <Share2 className="h-3 w-3" />Share
                                    </Button>
                                  </>
                                ) : (
                                  <Button asChild size="sm" className="h-7 text-[11px] gap-1 px-2.5 bg-blue-600 hover:bg-blue-700">
                                    <Link href={buildFillHref(p, sidx)}>
                                      <ClipboardEdit className="h-3 w-3" />
                                      {entry.reportStatus === "in_progress" ? "Continue" : "Fill"}
                                    </Link>
                                  </Button>
                                )}

                                {!entry.billId ? (
                                  <Button asChild size="sm" variant="outline" className="h-7 text-[11px] gap-1 px-2">
                                    <Link href={buildBillHref(p, sidx)}>
                                      <IndianRupee className="h-3 w-3" />Create Bill
                                    </Link>
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 px-2" onClick={() => setViewBill({ ...p, charges: entry.charges || 0, paid: entry.paid || 0, discount: entry.discount || 0, paymentMode: entry.paymentMode || "Cash", billId: entry.billId?.toString() })}>
                                    <Printer className="h-3 w-3" />Print Bill
                                  </Button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {viewReport && (
        <ReportViewModal
          patient={{ ...viewReport.p, study: studiesOf(viewReport.p)[viewReport.sidx]?.name ?? viewReport.p.study }}
          sidx={viewReport.sidx}
          onClose={() => setViewReport(null)}
        />
      )}
      {viewBill && (
        <BillDocViewer
          open={!!viewBill} onClose={() => setViewBill(null)}
          id={viewBill.billId?.toString()}
          srNo={viewBill.srNo} name={viewBill.name} age={viewBill.age}
          gender={viewBill.gender} contact={viewBill.contact}
          referredBy={viewBill.referredBy} study={studiesOf(viewBill).map((s) => s.name).join(", ")}
          charges={viewBill.charges} discount={viewBill.discount ?? 0} paid={viewBill.paid}
          paymentMode={viewBill.paymentMode || "Cash"}
          date={viewBill.createdAt?.split("T")[0]}
        />
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(v: number) {
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`
  if (v >= 1000)   return `₹${(v / 1000).toFixed(1)}k`
  return `₹${v.toLocaleString()}`
}

// ─── Admin dashboard ──────────────────────────────────────────────────────────

function AdminDashboard({ todayPatients, todayLoading }: { todayPatients: PatientDoc[]; todayLoading: boolean }) {
  const [allPatients, setAllPatients] = useState<PatientDoc[]>([])
  const [allLoading,  setAllLoading]  = useState(true)

  useEffect(() => {
    fetch("/api/patients")
      .then(r => r.json())
      .then(d => setAllPatients(d.patients ?? []))
      .catch(() => {})
      .finally(() => setAllLoading(false))
  }, [])

  const today = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })

  // ── Period boundaries ───────────────────────────────────────────────────────
  const now            = useMemo(() => new Date(), [])
  const thisMonthStart = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 1), [now])
  const lastMonthStart = useMemo(() => new Date(now.getFullYear(), now.getMonth() - 1, 1), [now])
  const lastMonthEnd   = useMemo(() => new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999), [now])

  const thisMonthPts = useMemo(() =>
    allPatients.filter(p => new Date(p.createdAt) >= thisMonthStart),
    [allPatients, thisMonthStart]
  )
  const lastMonthPts = useMemo(() =>
    allPatients.filter(p => { const d = new Date(p.createdAt); return d >= lastMonthStart && d <= lastMonthEnd }),
    [allPatients, lastMonthStart, lastMonthEnd]
  )

  const thisMonthRev  = useMemo(() => thisMonthPts.reduce((s, p) => s + (p.paid || 0), 0), [thisMonthPts])
  const lastMonthRev  = useMemo(() => lastMonthPts.reduce((s, p) => s + (p.paid || 0), 0), [lastMonthPts])
  const thisMonthDisc = useMemo(() => thisMonthPts.reduce((s, p) => s + (p.discount || 0), 0), [thisMonthPts])
  const revGrowth     = lastMonthRev > 0 ? Math.round(((thisMonthRev - lastMonthRev) / lastMonthRev) * 100) : null

  // ── Monthly summary (6 months) ──────────────────────────────────────────────
  const monthlySummary = useMemo(() =>
    Array.from({ length: 6 }, (_, i) => {
      const d     = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
      const pts   = allPatients.filter(p => { const pd = new Date(p.createdAt); return pd >= start && pd <= end })
      return {
        label:      d.toLocaleDateString("en-IN", { month: "short" }),
        patients:   pts.length,
        collection: pts.reduce((s, p) => s + (p.paid || 0), 0),
        isCurrent:  i === 0,
      }
    }).reverse(),
    [allPatients, now]
  )
  const maxCollection = Math.max(...monthlySummary.map(m => m.collection), 1)

  // ── Top studies this month ───────────────────────────────────────────────────
  const topStudies = useMemo(() => {
    const map: Record<string, { count: number; revenue: number }> = {}
    for (const p of thisMonthPts) {
      if (!p.study) continue
      if (!map[p.study]) map[p.study] = { count: 0, revenue: 0 }
      map[p.study].count++
      map[p.study].revenue += p.paid || 0
    }
    return Object.entries(map).map(([study, d]) => ({ study, ...d })).sort((a, b) => b.count - a.count).slice(0, 6)
  }, [thisMonthPts])

  // ── Top referring doctors this month ────────────────────────────────────────
  const topDoctors = useMemo(() => {
    const map: Record<string, number> = {}
    for (const p of thisMonthPts) {
      const name = (p.referredBy || "").trim()
      if (!name || name.toLowerCase() === "self") continue
      map[name] = (map[name] || 0) + 1
    }
    return Object.entries(map).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6)
  }, [thisMonthPts])

  // ── Outstanding dues (all-time) ──────────────────────────────────────────────
  const outstanding = useMemo(() =>
    allPatients
      .map(p => ({ ...p, balance: (p.charges || 0) - (p.discount || 0) - (p.paid || 0) }))
      .filter(p => p.balance > 0)
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 8),
    [allPatients]
  )
  const totalOutstanding = outstanding.reduce((s, p) => s + p.balance, 0)

  // ── Today ────────────────────────────────────────────────────────────────────
  const todayCollection = todayPatients.reduce((s, p) => s + (p.paid || 0), 0)
  const todayTotal      = todayPatients.reduce((s, p) => s + (p.charges || 0), 0)

  const STUDY_COLORS = ["#8b5cf6","#6366f1","#3b82f6","#06b6d4","#10b981","#f59e0b"]
  const RANK_STYLE   = [
    { bg: "bg-amber-50",  border: "border-amber-200", text: "text-amber-600",  bar: "#f59e0b" },
    { bg: "bg-slate-50",  border: "border-slate-200", text: "text-slate-500",  bar: "#94a3b8" },
    { bg: "bg-orange-50", border: "border-orange-200",text: "text-orange-500", bar: "#fb923c" },
  ]

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">{today}</p>
        </div>
        <Button asChild className="bg-blue-600 hover:bg-blue-700 shadow-sm w-full sm:w-auto">
          <Link href="/patients/new"><UserPlus className="h-4 w-4 mr-2" />New Patient</Link>
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            border: "border-l-blue-500", Icon: Users, iconColor: "text-blue-500",
            label: "Today's Patients", isLoading: todayLoading, skW: "w-10",
            value: <p className="text-2xl font-bold">{todayPatients.length}</p>,
          },
          {
            border: "border-l-green-500", Icon: IndianRupee, iconColor: "text-green-500",
            label: "Today's Collection", isLoading: todayLoading, skW: "w-20",
            value: <><p className="text-2xl font-bold">{fmtMoney(todayCollection)}</p><p className="text-xs text-muted-foreground mt-1">of {fmtMoney(todayTotal)} billed</p></>,
          },
          {
            border: "border-l-orange-500", Icon: BadgeIndianRupee, iconColor: "text-orange-500",
            label: "Month Collection", isLoading: allLoading, skW: "w-20",
            value: (
              <>
                <p className="text-2xl font-bold">{fmtMoney(thisMonthRev)}</p>
                {revGrowth !== null && (
                  <p className={`text-xs mt-1 flex items-center gap-0.5 ${revGrowth >= 0 ? "text-green-600" : "text-red-500"}`}>
                    <TrendingUp className="h-3 w-3" />{revGrowth >= 0 ? "+" : ""}{revGrowth}% vs last month
                  </p>
                )}
              </>
            ),
          },
          {
            border: "border-l-red-400", Icon: Tag, iconColor: "text-red-400",
            label: "Total Discount", isLoading: allLoading, skW: "w-16",
            value: <><p className="text-2xl font-bold">{fmtMoney(thisMonthDisc)}</p><p className="text-xs text-muted-foreground mt-1">This month</p></>,
          },
        ].map(({ border, Icon, iconColor, label, isLoading, skW, value }, i) => (
          <motion.div key={label} className="h-full" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.3 }}>
            <Card className={`border-l-4 ${border} h-full`}>
              <CardContent className="p-4 flex flex-col h-full">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                  <Icon className={`h-4 w-4 ${iconColor}`} />
                </div>
                {isLoading ? <Skeleton className={`h-8 ${skW}`} /> : value}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Today's patients table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold">
            Today&apos;s Patients
            {!todayLoading && <span className="ml-2 text-xs font-normal text-muted-foreground">{todayPatients.length} registered</span>}
          </CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/patients" className="text-blue-600 text-xs flex items-center gap-1">View All <ArrowRight className="h-3 w-3" /></Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {todayLoading ? (
            <div className="px-5 pb-2">
              <div className="flex items-center gap-4 py-3 border-b border-border/60 mb-1">
                <Skeleton className="h-3 w-6" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-24 hidden sm:block" />
                <Skeleton className="h-3 w-16 ml-auto" /><Skeleton className="h-3 w-16 hidden sm:block" /><Skeleton className="h-3 w-16" />
              </div>
              {[...Array(4)].map((_, i) => (
                <motion.div key={i} className="grid grid-cols-6 gap-3 items-center py-3 border-b border-border/40 last:border-0"
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                  <Skeleton className="h-4 w-6" />
                  <div className="col-span-2 space-y-1.5"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-24" /></div>
                  <Skeleton className="h-4 w-28 hidden sm:block" /><Skeleton className="h-4 w-16 justify-self-end" />
                  <Skeleton className="h-5 w-16 rounded-full justify-self-center hidden sm:block" />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs pl-5">Sr.</TableHead>
                  <TableHead className="text-xs">Patient</TableHead>
                  <TableHead className="text-xs hidden sm:table-cell">Study</TableHead>
                  <TableHead className="text-xs text-right">Charges</TableHead>
                  <TableHead className="text-xs text-center hidden sm:table-cell">Payment</TableHead>
                  <TableHead className="text-xs text-center pr-5">Report</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {todayPatients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm pl-5">
                      No patients registered today. <Link href="/patients/new" className="text-blue-600 underline">Register one</Link>
                    </TableCell>
                  </TableRow>
                )}
                {todayPatients.map((p, i) => {
                  const payStatus = payStatusOf(p.charges, p.paid)
                  return (
                    <TableRow key={p._id} className="hover:bg-muted/20">
                      <TableCell className="text-xs font-mono text-muted-foreground pl-5">{i + 1}</TableCell>
                      <TableCell>
                        <p className="font-medium text-sm">{p.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-2.5 w-2.5" />{p.contact}</p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">{p.study}</TableCell>
                      <TableCell className="text-right text-sm font-medium">₹{p.charges || 0}</TableCell>
                      <TableCell className="text-center hidden sm:table-cell">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${payStatusStyle[payStatus]}`}>{payStatus}</span>
                      </TableCell>
                      <TableCell className="text-center pr-5"><ReportStatusBadge status={p.reportStatus} /></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Monthly Summary */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Monthly Summary</CardTitle>
            {!allLoading && <span className="text-xs text-muted-foreground">Last 6 months</span>}
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {allLoading ? (
            <div className="grid grid-cols-6 gap-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {monthlySummary.map((m, i) => {
                const barPct = Math.round((m.collection / maxCollection) * 100)
                return (
                  <motion.div
                    key={m.label}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.3 }}
                    className={`relative rounded-xl border p-3 flex flex-col gap-2 ${m.isCurrent ? "bg-blue-50 border-blue-200" : "bg-muted/20 border-transparent hover:bg-muted/40"} transition-colors`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-bold ${m.isCurrent ? "text-blue-700" : "text-gray-600"}`}>{m.label}</span>
                      {m.isCurrent && <span className="text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full">NOW</span>}
                    </div>
                    {/* Mini bar */}
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${m.isCurrent ? "bg-blue-500" : "bg-gray-400"}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${barPct}%` }}
                        transition={{ delay: i * 0.06 + 0.2, duration: 0.5, ease: "easeOut" }}
                      />
                    </div>
                    <div>
                      <p className={`text-sm font-bold leading-tight ${m.isCurrent ? "text-blue-700" : "text-green-700"}`}>{fmtMoney(m.collection)}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{m.patients} patients</p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Studies + Top Doctors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

        {/* Top Studies This Month */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Top Studies This Month</CardTitle>
              <span className="text-xs text-muted-foreground">{thisMonthPts.length} total</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {allLoading ? (
              <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
            ) : topStudies.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No studies this month yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {topStudies.map((s, i) => {
                  const color = STUDY_COLORS[i] ?? "#9ca3af"
                  const pct   = Math.max((s.count / (topStudies[0]?.count || 1)) * 100, 8)
                  const total = topStudies.reduce((a, x) => a + x.count, 0)
                  const share = total > 0 ? Math.round((s.count / total) * 100) : 0
                  return (
                    <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="py-2.5 first:pt-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="h-5 w-5 rounded-md flex items-center justify-center shrink-0 text-[10px] font-bold"
                          style={{ background: `${color}18`, color }}>
                          {i + 1}
                        </div>
                        <span className="flex-1 text-sm font-medium text-gray-800 truncate" title={s.study}>{s.study}</span>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                          style={{ background: `${color}15`, color }}>
                          {s.count} {s.count === 1 ? "case" : "cases"}
                        </span>
                        {s.revenue > 0 && (
                          <span className="text-xs font-semibold text-emerald-600 shrink-0">{fmtMoney(s.revenue)}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 pl-7">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <motion.div className="h-full rounded-full"
                            style={{ background: `linear-gradient(90deg,${color}99,${color})` }}
                            initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                            transition={{ delay: i * 0.05 + 0.1, duration: 0.55, ease: "easeOut" }} />
                        </div>
                        <span className="text-[10px] font-semibold text-gray-400 w-7 text-right">{share}%</span>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Referring Doctors This Month */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Top Referring Doctors</CardTitle>
              <span className="text-xs text-muted-foreground">This month</span>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            {allLoading ? (
              <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
            ) : topDoctors.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No referrals recorded this month.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {(() => {
                  const totalRefs = topDoctors.reduce((s, d) => s + d.count, 0)
                  return topDoctors.map((d, i) => {
                    const style  = RANK_STYLE[i] ?? { bg: "bg-gray-50", border: "border-gray-100", text: "text-gray-400", bar: "#c084fc" }
                    const barPct = Math.max((d.count / (topDoctors[0]?.count || 1)) * 100, 8)
                    const share  = totalRefs > 0 ? Math.round((d.count / totalRefs) * 100) : 0
                    return (
                      <motion.div key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                        className="py-2.5 first:pt-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className={`h-6 w-6 rounded-lg border flex items-center justify-center shrink-0 ${style.bg} ${style.border}`}>
                            <span className={`text-[10px] font-extrabold ${style.text}`}>{i + 1}</span>
                          </div>
                          <span className="flex-1 text-sm font-semibold text-gray-800 truncate">{d.name}</span>
                          <span className="text-sm font-bold text-gray-900 shrink-0">{d.count}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{d.count === 1 ? "ref" : "refs"}</span>
                        </div>
                        <div className="flex items-center gap-2 pl-8">
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <motion.div className="h-full rounded-full"
                              style={{ background: `linear-gradient(90deg,${style.bar}88,${style.bar})` }}
                              initial={{ width: 0 }} animate={{ width: `${barPct}%` }}
                              transition={{ delay: i * 0.05 + 0.1, duration: 0.55, ease: "easeOut" }} />
                          </div>
                          <span className="text-[10px] font-semibold text-gray-400 w-7 text-right">{share}%</span>
                        </div>
                      </motion.div>
                    )
                  })
                })()}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* Outstanding Dues */}
      {!allLoading && outstanding.length > 0 && (
        <Card className="border-orange-100">
          <CardHeader className="pb-3 pt-4 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-semibold">Outstanding Dues</CardTitle>
                <span className="text-xs bg-orange-100 text-orange-700 font-semibold px-2 py-0.5 rounded-full">
                  {outstanding.length} patients
                </span>
              </div>
              <span className="text-sm font-bold text-orange-600">{fmtMoney(totalOutstanding)} pending</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs pl-5">Patient</TableHead>
                  <TableHead className="text-xs hidden sm:table-cell">Study</TableHead>
                  <TableHead className="text-xs text-right">Charges</TableHead>
                  <TableHead className="text-xs text-right hidden sm:table-cell">Paid</TableHead>
                  <TableHead className="text-xs text-right pr-5">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outstanding.map((p, i) => (
                  <motion.tr key={p._id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="border-b last:border-0 hover:bg-muted/20">
                    <TableCell className="pl-5 py-2.5">
                      <p className="font-medium text-sm">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{dateOf(p.createdAt)} · #{p.srNo}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground py-2.5 hidden sm:table-cell">{p.study}</TableCell>
                    <TableCell className="text-right text-xs py-2.5">{fmtMoney(p.charges || 0)}</TableCell>
                    <TableCell className="text-right text-xs text-green-600 py-2.5 hidden sm:table-cell">{fmtMoney(p.paid || 0)}</TableCell>
                    <TableCell className="text-right pr-5 py-2.5">
                      <span className="text-sm font-bold text-orange-600">{fmtMoney(p.balance)}</span>
                    </TableCell>
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  )
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useRole()
  const [todayPatients, setTodayPatients] = useState<PatientDoc[]>([])
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    fetch("/api/patients?date=today")
      .then((r) => r.json())
      .then((d) => setTodayPatients(d.patients || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (!user) return null

  if (user.role === "doctor" || user.role === "receptionist")
    return <ReceptionistDashboard name={user.name} patients={todayPatients} loading={loading} />
  return <AdminDashboard todayPatients={todayPatients} todayLoading={loading} />
}
