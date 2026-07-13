"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Search, UserCheck, Info,
  ChevronDown, Loader2, FileText, ReceiptText,
  Clock, CheckCircle2, AlertCircle, Users, TrendingUp, X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { motion, AnimatePresence } from "framer-motion"
import { receiptLetterheadHtml, receiptPatientBoxHtml, receiptItemsTableHtml, ReceiptRow } from "@/lib/receipt-letterhead"

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

interface DoctorEntry {
  name: string
  referrals: number
}

// One entry per study a patient has — each study has its own report, bill and status
interface StudyEntry {
  name: string
  category?: string
  reportStatus: "pending" | "in_progress" | "completed"
  reportBody?: string
  reportSlug?: string
  billId?: string
  charges?: number
  paid?: number
  discount?: number
  paymentMode?: string
}

interface PatientRef {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  study: string
  studies?: StudyEntry[]
  referredBy: string
  reportStatus: "pending" | "in_progress" | "completed"
  reportBody?: string
  charges?: number
  paid?: number
  discount?: number
  paymentMode?: string
  billId?: string
  createdAt: string
}

// Every patient has at least one study; older records fall back to the legacy
// single-study fields so this always returns at least one entry.
function studiesOf(p: PatientRef): StudyEntry[] {
  return p.studies?.length
    ? p.studies
    : [{
        name: p.study, reportStatus: p.reportStatus, reportBody: p.reportBody,
        billId: p.billId, charges: p.charges, paid: p.paid,
        discount: p.discount, paymentMode: p.paymentMode,
      }]
}

interface BillDoc {
  _id: string
  srNo: number
  patientName: string
  age?: number
  gender?: string
  contact?: string
  referredBy: string
  items: { study: string; quantity: number; price: number; discount?: number }[]
  charges: number
  discount: number
  paid: number
  balance: number
  paymentMode: string
  billDate: string
  notes?: string
  createdAt: string
}

// ── HTML generators (exact same output as printBillReceipt / buildPrintHtml) ──

function buildBillHtml(b: BillDoc, baseUrl: string): string {
  const dateStr = new Date(b.billDate || b.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  const bNo = `B-${b.srNo || b._id.slice(-5).toUpperCase()}`
  const rows: ReceiptRow[] = b.items.map((item) => ({ study: item.study, amount: item.price * item.quantity, discount: item.discount || 0 }))
  const totalCharges = b.items.reduce((s, i) => s + i.price * i.quantity, 0)

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }
</style></head><body>
${receiptLetterheadHtml(baseUrl)}
<div style="border-top:2.5px solid #111;border-bottom:2.5px solid #111;padding:2px 0;text-align:center;font-weight:bold;font-size:9.5pt;text-transform:uppercase;letter-spacing:1px;margin:8px 0;">Payment Receipt</div>
${receiptPatientBoxHtml({ name: b.patientName, date: dateStr, age: b.age, gender: b.gender, contact: b.contact, referredBy: b.referredBy, srNo: b.srNo })}
${receiptItemsTableHtml(rows, totalCharges, b.paid)}
<div style="font-size:9.5pt;">
  <p><strong>Date:</strong> ${dateStr}</p>
  <p><strong>Payment Method</strong> - ${(b.paymentMode || "Cash").toUpperCase()}</p>
  <p><strong>Payment Receipt.</strong> ${bNo}</p>
</div>
<div style="text-align:center;font-size:9pt;color:#555;margin-top:18px;padding-top:10px;border-top:1px solid #ccc;">Thank you for visiting Aarya Diagnostic Center</div>
</body></html>`
}

// studyName/reportBody are passed explicitly (not read off `p`) since each of
// a patient's studies has its own name and report body.
function buildReportHtml(p: PatientRef, studyName: string, reportBody: string, baseUrl: string): string {
  const date = new Date(p.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  const infoRows: [string, string][] = [["NAME", p.name.toUpperCase()], ["DATE", date]]
  if (p.age)     infoRows.push(["AGE",    `${p.age} YRS`])
  if (p.contact) infoRows.push(["MOBILE", p.contact])
  infoRows.push(["REF. BY", (p.referredBy || "SELF").toUpperCase()])
  if (p.gender)  infoRows.push(["SEX",    p.gender.toUpperCase()])
  if (p.srNo)    infoRows.push(["SR. NO", `#${p.srNo}`])

  const infoHtml = infoRows.reduce<[string, string][][]>((rows, item, i) => {
    if (i % 2 === 0) rows.push([item])
    else rows[rows.length - 1].push(item)
    return rows
  }, []).map((pair) => `
    <div class="info-row">
      ${pair.map(([l, v]) => `<div class="info-cell"><span class="ilbl">${l}:</span><span>${v}</span></div>`).join("")}
    </div>`).join("")

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report – ${p.name}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; padding: 15mm 20mm; color: #111; }
.info-row { display: flex; gap: 30px; margin-bottom: 3px; }
.info-cell { display: flex; flex: 1; gap: 6px; font-size: 9pt; }
.ilbl { font-weight: bold; min-width: 56px; }
.info-block { border-bottom: 1px solid #aaa; padding-bottom: 10px; margin-bottom: 12px; }
.study { text-align: center; font-weight: bold; font-size: 12pt; text-transform: uppercase; text-decoration: underline; margin: 12px 0 14px; }
</style></head><body>
<div class="info-block">${infoHtml}</div>
<div class="study">${studyName}</div>
<div style="font-size:10pt;line-height:1.6;">${reportBody}</div>
</body></html>`
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.replace(/^Dr\.\s*/i, "").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
}

function patInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
}

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) }
  catch { return iso }
}

function billStatusOf(s: StudyEntry): "paid" | "partial" | "pending" | null {
  if (!s.charges) return null
  const net = s.charges - (s.discount ?? 0)
  if ((s.paid ?? 0) >= net) return "paid"
  if ((s.paid ?? 0) > 0) return "partial"
  return "pending"
}

const BILL_STATUS_STYLE: Record<string, string> = {
  paid:    "bg-green-100 text-green-700 border-green-200",
  partial: "bg-yellow-100 text-yellow-700 border-yellow-200",
  pending: "bg-red-100 text-red-700 border-red-200",
}

const REPORT_STATUS_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  completed:   { label: "Report Ready",  cls: "bg-green-100 text-green-700 border-green-200", icon: <CheckCircle2 className="h-3 w-3" /> },
  in_progress: { label: "In Progress",   cls: "bg-blue-100 text-blue-700 border-blue-200",    icon: <Clock className="h-3 w-3" /> },
  pending:     { label: "Pending",       cls: "bg-gray-100 text-gray-500 border-gray-200",    icon: <AlertCircle className="h-3 w-3" /> },
}

// ── Bill Modal ───────────────────────────────────────────────────────────────

// Read-only for the doctor's referral view — no print / edit-in-billing
// controls here; those live in Billing, which doctors don't need from this page.
function BillModal({ patient, sidx, onClose }: { patient: PatientRef; sidx: number; onClose: () => void }) {
  const [bill,    setBill]    = useState<BillDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const entry  = studiesOf(patient)[sidx]
  const billId = entry?.billId

  useEffect(() => {
    if (!billId) { setBill(null); setLoading(false); return }
    setLoading(true)
    fetch(`/api/billing/${billId}`)
      .then((r) => r.json())
      .then((d) => setBill(d.bill ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [billId])

  const receiptHtml = bill ? buildBillHtml(bill, typeof window !== "undefined" ? window.location.origin : "") : null

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden mx-2 sm:mx-0"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                <ReceiptText className="h-4 w-4 text-blue-600" />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-sm text-gray-900 truncate">Payment Receipt</h2>
                <p className="text-xs text-gray-400 truncate">{patient.name} · #{patient.srNo}{entry?.name ? ` · ${entry.name}` : ""}</p>
              </div>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden bg-gray-100">
            {loading && (
              <div className="flex items-center justify-center h-64 gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />Loading bill…
              </div>
            )}
            {!loading && !receiptHtml && (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <ReceiptText className="h-10 w-10 mb-2 opacity-20" />
                <p className="text-sm">No bill created for this study yet.</p>
              </div>
            )}
            {!loading && receiptHtml && (
              <iframe
                srcDoc={receiptHtml}
                className="w-full h-full border-0"
                style={{ minHeight: "500px" }}
                title="Bill Receipt"
              />
            )}
          </div>

          {/* Footer — view-only, no print / editing actions here */}
          <div className="flex items-center justify-end px-5 py-3 bg-gray-50 border-t border-gray-100 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Report Modal ─────────────────────────────────────────────────────────────

// Read-only for the doctor's referral view — no edit / continue / print
// controls here; report editing stays in the Reports section.
function ReportModal({ patient, sidx, onClose }: { patient: PatientRef; sidx: number; onClose: () => void }) {
  const entry      = studiesOf(patient)[sidx]
  const studyName  = entry?.name || patient.study
  const status     = entry?.reportStatus ?? "pending"
  const rMeta       = REPORT_STATUS_META[status] ?? REPORT_STATUS_META.pending

  // The patient list never carries reportBody (stripped for payload size), so
  // fetch the full record for this one study when the modal opens.
  const [reportBody, setReportBody] = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    setLoading(true)
    setReportBody(null)
    fetch(`/api/patients/${patient._id}`)
      .then((r) => r.json())
      .then((d) => {
        const body = d.patient?.studies?.[sidx]?.reportBody ?? d.patient?.reportBody ?? ""
        setReportBody(body || "")
      })
      .catch(() => setReportBody(""))
      .finally(() => setLoading(false))
  }, [patient._id, sidx])

  const reportHtml = reportBody
    ? buildReportHtml(patient, studyName, reportBody, typeof window !== "undefined" ? window.location.origin : "")
    : null

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-[2px] z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden mx-2 sm:mx-0"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                <FileText className="h-4 w-4 text-violet-600" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold text-sm text-gray-900 truncate">{studyName || "Report"}</h2>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${rMeta.cls}`}>
                    {rMeta.icon}{rMeta.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">{patient.name} · #{patient.srNo}</p>
              </div>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body — iframe rendering exact print HTML */}
          <div className="flex-1 overflow-hidden bg-gray-100">
            {loading ? (
              <div className="flex items-center justify-center h-64 gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />Loading report…
              </div>
            ) : reportHtml ? (
              <iframe
                srcDoc={reportHtml}
                className="w-full h-full border-0"
                style={{ minHeight: "500px" }}
                title="Report"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <FileText className="h-10 w-10 mb-2 opacity-20" />
                <p className="text-sm font-medium">No report submitted yet</p>
              </div>
            )}
          </div>

          {/* Footer — view-only, no edit / continue / print actions here */}
          <div className="flex items-center justify-end px-5 py-3 bg-gray-50 border-t border-gray-100 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Patient group card ───────────────────────────────────────────────────────
// One card per patient (not per study). The patient's identity — name, age,
// contact, date — is shown once at the top so it isn't repeated per test; each
// test the patient was referred for is then listed as its own plain row below,
// with its report/bill status spelled out in words rather than a dense strip
// of colored badges, and its own View Report / View Bill buttons.

function PatientGroupCard({
  patient, entries, index, onViewBill, onViewReport,
}: {
  patient: PatientRef
  entries: StudyEntry[]
  index: number
  onViewBill: (p: PatientRef, sidx: number) => void
  onViewReport: (p: PatientRef, sidx: number) => void
}) {
  const BILL_LABEL: Record<string, string> = { paid: "Paid", partial: "Partially Paid", pending: "Unpaid" }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.055, ease: "easeOut" }}
      className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-blue-300 hover:shadow-sm transition-all"
    >
      {/* Header — patient identity shown once, regardless of how many tests */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="h-10 w-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-bold shrink-0">
          {patInitials(patient.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900">{patient.name}</p>
            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">#{patient.srNo}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {patient.age > 0 && `${patient.age} yrs · ${patient.gender} · `}
            {patient.contact && `${patient.contact} · `}
            {fmtDate(patient.createdAt)}
          </p>
        </div>
        {entries.length > 1 && (
          <span className="text-xs font-semibold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full shrink-0">
            {entries.length} tests
          </span>
        )}
      </div>

      {/* One plain row per test this patient was referred for */}
      <div className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/50">
        {entries.map((entry, sidx) => {
          const bStatus = billStatusOf(entry)
          const rMeta   = REPORT_STATUS_META[entry.reportStatus] ?? REPORT_STATUS_META.pending
          const net     = (entry.charges ?? 0) - (entry.discount ?? 0)
          const balance = Math.max(0, net - (entry.paid ?? 0))

          return (
            <div key={sidx} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{entry.name}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs">
                  <span className={`inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded-full border ${rMeta.cls}`}>
                    {rMeta.icon}Report: {rMeta.label}
                  </span>
                  {bStatus ? (
                    <span className={`inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded-full border ${BILL_STATUS_STYLE[bStatus]}`}>
                      <ReceiptText className="h-3 w-3" />Bill: {BILL_LABEL[bStatus]}
                    </span>
                  ) : (
                    <span className="text-gray-400">No bill yet</span>
                  )}
                </div>
                {entry.charges ? (
                  <p className="text-xs text-gray-400 mt-1">
                    ₹{entry.charges.toLocaleString("en-IN")} charged · ₹{(entry.paid ?? 0).toLocaleString("en-IN")} paid
                    {balance > 0 && <span className="text-red-500"> · ₹{balance.toLocaleString("en-IN")} due</span>}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => onViewReport(patient, sidx)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-violet-50 hover:border-violet-300 text-xs font-semibold text-gray-700 hover:text-violet-700 transition-all"
                >
                  <FileText className="h-3.5 w-3.5" />View Report
                </button>
                <button
                  onClick={() => onViewBill(patient, sidx)}
                  disabled={!bStatus}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    bStatus
                      ? "border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-300 text-gray-700 hover:text-blue-700"
                      : "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
                  }`}
                >
                  <ReceiptText className="h-3.5 w-3.5" />View Bill
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ── Doctor row ────────────────────────────────────────────────────────────────

function DoctorRow({
  doc, colorCls, rank, isExpanded, isLoading, patients, onToggle, onViewBill, onViewReport,
}: {
  doc: DoctorEntry
  colorCls: string
  rank: number
  isExpanded: boolean
  isLoading: boolean
  patients: PatientRef[] | undefined
  onToggle: () => void
  onViewBill: (p: PatientRef, sidx: number) => void
  onViewReport: (p: PatientRef, sidx: number) => void
}) {
  return (
    <div className="border-b border-gray-100 last:border-0">
      <motion.div
        whileHover={{ backgroundColor: "rgba(59,130,246,0.03)" }}
        onClick={onToggle}
        className="flex items-center gap-4 px-5 py-4 cursor-pointer select-none"
      >
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-bold text-gray-300 w-4 text-right">{rank}</span>
          <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold ${colorCls}`}>
            {initials(doc.name)}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm text-gray-900">{doc.name}</p>
            <span className="inline-flex items-center gap-0.5 text-[10px] bg-green-100 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full font-semibold">
              <UserCheck className="h-2.5 w-2.5" />Active
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {doc.referrals} patient{doc.referrals !== 1 ? "s" : ""} referred
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-center hidden sm:block">
            <div className={`text-lg font-bold leading-none ${doc.referrals > 0 ? "text-blue-600" : "text-gray-300"}`}>
              {doc.referrals}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">referrals</p>
          </div>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className={`h-8 w-8 rounded-full flex items-center justify-center border transition-colors ${
              isExpanded ? "bg-blue-50 border-blue-200 text-blue-600" : "bg-gray-50 border-gray-200 text-gray-400"
            }`}
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
          </motion.div>
        </div>
      </motion.div>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div className="px-5 pb-5 pt-2 bg-gradient-to-b from-slate-50/70 to-white border-t border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-4 w-4 text-blue-500" />
                <p className="text-sm font-semibold text-gray-700">Referred Patients</p>
                {patients && (
                  <motion.span
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="text-[11px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold"
                  >
                    {patients.length}
                  </motion.span>
                )}
              </div>

              {isLoading && (
                <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />Fetching patients…
                </div>
              )}

              {!isLoading && patients && patients.length === 0 && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-center py-8 text-sm text-muted-foreground"
                >
                  No patients referred by {doc.name} yet.
                </motion.p>
              )}

              {!isLoading && patients && patients.length > 0 && (
                <div className="grid gap-3">
                  {patients.map((p, i) => (
                    <PatientGroupCard
                      key={p._id}
                      patient={p}
                      entries={studiesOf(p)}
                      index={i}
                      onViewBill={onViewBill}
                      onViewReport={onViewReport}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DoctorsPage() {
  const [search,         setSearch]         = useState("")
  const [allPatients,    setAllPatients]    = useState<PatientRef[]>([])
  const [pageLoading,    setPageLoading]    = useState(true)
  const [expandedDoctor, setExpandedDoctor] = useState<string | null>(null)
  const [loadingDoctor,  setLoadingDoctor]  = useState<string | null>(null)
  const [patientsByDoc,  setPatientsByDoc]  = useState<Record<string, PatientRef[]>>({})
  const [billModal,      setBillModal]      = useState<{ patient: PatientRef; sidx: number } | null>(null)
  const [reportModal,    setReportModal]    = useState<{ patient: PatientRef; sidx: number } | null>(null)

  useEffect(() => {
    fetch("/api/patients")
      .then((r) => r.json())
      .then((data) => {
        const patients: PatientRef[] = data.patients ?? []
        setAllPatients(patients)
        const map: Record<string, PatientRef[]> = {}
        for (const p of patients) {
          const key = (p.referredBy ?? "").trim()
          if (!key || key.toLowerCase() === "self") continue
          if (!map[key]) map[key] = []
          map[key].push(p)
        }
        setPatientsByDoc(map)
      })
      .catch(() => {})
      .finally(() => setPageLoading(false))
  }, [])

  const doctors: DoctorEntry[] = useMemo(() => {
    const countMap: Record<string, number> = {}
    for (const p of allPatients) {
      const key = (p.referredBy ?? "").trim()
      if (!key || key.toLowerCase() === "self") continue
      countMap[key] = (countMap[key] ?? 0) + 1
    }
    return Object.entries(countMap)
      .map(([name, referrals]) => ({ name, referrals }))
      .sort((a, b) => b.referrals - a.referrals)
  }, [allPatients])

  const totalReferrals = doctors.reduce((s, d) => s + d.referrals, 0)
  const pendingReports = allPatients.filter((p) => p.reportStatus === "pending" && p.referredBy && p.referredBy.toLowerCase() !== "self").length
  const doneReports    = allPatients.filter((p) => p.reportStatus === "completed" && p.referredBy && p.referredBy.toLowerCase() !== "self").length

  const filtered = doctors.filter((d) => !search || d.name.toLowerCase().includes(search.toLowerCase()))

  const toggleDoctor = async (doctorName: string) => {
    if (expandedDoctor === doctorName) { setExpandedDoctor(null); return }
    setExpandedDoctor(doctorName)
    if (patientsByDoc[doctorName] !== undefined) return
    setLoadingDoctor(doctorName)
    try {
      const res  = await fetch(`/api/patients?referredBy=${encodeURIComponent(doctorName)}`)
      const data = await res.json()
      setPatientsByDoc((prev) => ({ ...prev, [doctorName]: data.patients ?? [] }))
    } catch {
      setPatientsByDoc((prev) => ({ ...prev, [doctorName]: [] }))
    } finally {
      setLoadingDoctor(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Modals — rendered at page level to avoid overflow:hidden clipping inside expand panels */}
      {billModal   && <BillModal   patient={billModal.patient}   sidx={billModal.sidx}   onClose={() => setBillModal(null)}   />}
      {reportModal && <ReportModal patient={reportModal.patient} sidx={reportModal.sidx} onClose={() => setReportModal(null)} />}

      <div>
        <h1 className="text-2xl font-bold">Doctors</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Referring doctors sorted by number of patient referrals</p>
      </div>

      <motion.div
        className="grid grid-cols-2 sm:grid-cols-4 gap-4"
        initial="hidden" animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
      >
        {[
          { label: "Total Doctors",   value: pageLoading ? "—" : String(doctors.length),  icon: <Users className="h-4 w-4 text-blue-500" />        },
          { label: "Total Referrals", value: pageLoading ? "—" : String(totalReferrals),   icon: <TrendingUp className="h-4 w-4 text-violet-500" />  },
          { label: "Reports Pending", value: pageLoading ? "—" : String(pendingReports),   icon: <AlertCircle className="h-4 w-4 text-orange-400" /> },
          { label: "Reports Done",    value: pageLoading ? "—" : String(doneReports),      icon: <CheckCircle2 className="h-4 w-4 text-green-500" /> },
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

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Doctors are sourced from the <strong>Referred By</strong> field on patient records,
          sorted by referral count. Click any row to expand patient details.
        </span>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Doctor Directory</CardTitle>
              <CardDescription>
                {pageLoading ? "Loading…" : `${filtered.length} doctor${filtered.length !== 1 ? "s" : ""}`}
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
            <p className="text-center py-12 text-muted-foreground text-sm">
              {doctors.length === 0
                ? "No referral data yet. Add patients with a referring doctor to see them here."
                : "No doctors match your search."}
            </p>
          )}
          {!pageLoading && filtered.length > 0 && (
            <div>
              {filtered.map((doc, i) => (
                <DoctorRow
                  key={doc.name}
                  doc={doc}
                  colorCls={AVATAR_COLORS[i % AVATAR_COLORS.length]}
                  rank={i + 1}
                  isExpanded={expandedDoctor === doc.name}
                  isLoading={loadingDoctor === doc.name}
                  patients={patientsByDoc[doc.name]}
                  onToggle={() => toggleDoctor(doc.name)}
                  onViewBill={(p, sidx) => setBillModal({ patient: p, sidx })}
                  onViewReport={(p, sidx) => setReportModal({ patient: p, sidx })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
