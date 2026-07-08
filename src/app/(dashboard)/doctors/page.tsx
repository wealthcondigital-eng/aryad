"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import Link from "next/link"
import {
  Search, Phone, UserCheck, Info, Calendar,
  ChevronDown, Loader2, FileText, ReceiptText,
  Clock, CheckCircle2, AlertCircle, Users, TrendingUp, X, Printer,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { motion, AnimatePresence } from "framer-motion"

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

interface PatientRef {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  study: string
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

interface BillDoc {
  _id: string
  srNo: number
  patientName: string
  age?: number
  gender?: string
  contact?: string
  referredBy: string
  items: { study: string; quantity: number; price: number }[]
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

  const itemRows = b.items.map((item, idx) => `
    <tr>
      <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx + 1}.</td>
      <td style="border:1px solid #111;padding:4px 6px;text-transform:uppercase;">${item.study}</td>
      <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${(item.price * item.quantity).toLocaleString()}</td>
      <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx === 0 ? (b.discount ?? 0).toLocaleString() : 0}</td>
      <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx === 0 ? b.paid.toLocaleString() : 0}</td>
    </tr>`).join("")

  const totalCharges = b.items.reduce((s, i) => s + i.price * i.quantity, 0)

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { background: #f0f0f0; font-weight: bold; text-transform: uppercase; text-align: center; border: 1px solid #111; padding: 4px 6px; }
.total-row td { font-weight: bold; background: #f9f9f9; }
.patient-info { margin-bottom: 8px; font-size: 8.5pt; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; border-bottom: 1.5px solid #111; padding-bottom: 6px; }
.patient-info div { margin-bottom: 1px; }
.patient-info strong { font-weight: bold; }
</style></head><body>
<div style="text-align:center;margin-bottom:10px;">
  <img src="${baseUrl}/logo.jpeg" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 6px;display:block;" />
  <h1 style="font-size:15pt;font-weight:bold;text-transform:uppercase;letter-spacing:2px;">Aarya Diagnostic Center</h1>
  <p style="font-size:8.5pt;color:#333;line-height:1.6;">Shop no - 5, K. K. Smruti Building, New Maneklal Estate, S.N. Mehta Road, Ghatkopar (W) 400086<br>Contact no - 9819022444 &nbsp;&nbsp; aaryadiagnosticsmumbai@gmail.com</p>
</div>
<div class="patient-info">
  <div><strong>NAME:</strong> ${b.patientName.toUpperCase()}</div>
  <div><strong>DATE:</strong> ${dateStr}</div>
  <div><strong>AGE / SEX:</strong> ${b.age || "—"} YRS &nbsp;/&nbsp; ${(b.gender || "—").toUpperCase()}</div>
  <div><strong>MOBILE:</strong> ${b.contact || "—"}</div>
  <div><strong>REF. BY:</strong> ${(b.referredBy || "Self").toUpperCase()}</div>
  <div><strong>SR. NO:</strong> #${b.srNo || "—"}</div>
</div>
<table style="margin-bottom:8px;">
  <thead><tr>
    <th style="width:50px;">Sr.<br>No.</th>
    <th>Investigation of Patient</th>
    <th style="width:70px;">Charges</th>
    <th style="width:70px;">Discount</th>
    <th style="width:70px;">Paid</th>
  </tr></thead>
  <tbody>
    ${itemRows}
    <tr class="total-row">
      <td colspan="2" style="border:1px solid #111;padding:4px 6px;text-align:center;">Total</td>
      <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${totalCharges.toLocaleString()}</td>
      <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${b.discount.toLocaleString()}</td>
      <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${b.paid.toLocaleString()}</td>
    </tr>
  </tbody>
</table>
<div style="font-size:9.5pt;">
  <p><strong>Date:</strong> ${dateStr}</p>
  <p><strong>Payment Method</strong> - ${(b.paymentMode || "Cash").toUpperCase()}</p>
  <p><strong>Payment Receipt.</strong> ${bNo}</p>
</div>
<div style="text-align:center;font-size:9pt;color:#555;margin-top:18px;padding-top:10px;border-top:1px solid #ccc;">Thank you for visiting Aarya Diagnostic Center</div>
</body></html>`
}

function buildReportHtml(p: PatientRef, baseUrl: string): string {
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
<div class="study">${p.study}</div>
<div style="font-size:10pt;line-height:1.6;">${p.reportBody ?? ""}</div>
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

function billStatusOf(p: PatientRef): "paid" | "partial" | "pending" | null {
  if (!p.charges) return null
  const net = p.charges - (p.discount ?? 0)
  if ((p.paid ?? 0) >= net) return "paid"
  if ((p.paid ?? 0) > 0) return "partial"
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

function BillModal({ patient, onClose }: { patient: PatientRef; onClose: () => void }) {
  const [bill,    setBill]    = useState<BillDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const iframeRef             = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!patient.billId) { setLoading(false); return }
    fetch(`/api/billing/${patient.billId}`)
      .then((r) => r.json())
      .then((d) => setBill(d.bill ?? null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [patient.billId])

  const receiptHtml = bill ? buildBillHtml(bill, typeof window !== "undefined" ? window.location.origin : "") : null

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.print()
  }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
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
            <div className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-blue-500" />
              <h2 className="font-semibold text-sm text-gray-900">Payment Receipt</h2>
              <span className="text-xs text-gray-400">— {patient.name} #{patient.srNo}</span>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
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
                <p className="text-sm">No bill created for this patient yet.</p>
              </div>
            )}
            {!loading && receiptHtml && (
              <iframe
                ref={iframeRef}
                srcDoc={receiptHtml}
                className="w-full h-full border-0"
                style={{ minHeight: "500px" }}
                title="Bill Receipt"
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 bg-gray-50 border-t border-gray-100 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
              Close
            </button>
            <div className="flex items-center gap-2">
              {receiptHtml && (
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                >
                  <Printer className="h-4 w-4" />Print
                </button>
              )}
              <Link
                href="/billing"
                onClick={onClose}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <ReceiptText className="h-4 w-4" />Open in Billing
              </Link>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Report Modal ─────────────────────────────────────────────────────────────

function ReportModal({ patient, onClose }: { patient: PatientRef; onClose: () => void }) {
  const iframeRef  = useRef<HTMLIFrameElement>(null)
  const reportUrl  = `/reports/new?id=${patient._id}&patient=${encodeURIComponent(patient.name)}&srNo=${patient.srNo}&study=${encodeURIComponent(patient.study ?? "")}&age=${patient.age}&gender=${patient.gender}&contact=${patient.contact}&refBy=${encodeURIComponent(patient.referredBy ?? "")}${patient.reportStatus !== "pending" ? "&load=1" : ""}`
  const reportHtml = patient.reportBody
    ? buildReportHtml(patient, typeof window !== "undefined" ? window.location.origin : "")
    : null

  const handlePrint = () => {
    iframeRef.current?.contentWindow?.print()
  }

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
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
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-violet-500" />
              <h2 className="font-semibold text-sm text-gray-900">Report</h2>
              <span className="text-xs text-gray-400">— {patient.name} #{patient.srNo}</span>
              {patient.study && (
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-medium">{patient.study}</span>
              )}
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body — iframe rendering exact print HTML */}
          <div className="flex-1 overflow-hidden bg-gray-100">
            {reportHtml ? (
              <iframe
                ref={iframeRef}
                srcDoc={reportHtml}
                className="w-full h-full border-0"
                style={{ minHeight: "500px" }}
                title="Report"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <FileText className="h-10 w-10 mb-2 opacity-20" />
                <p className="text-sm font-medium">No report submitted yet</p>
                <p className="text-xs mt-1 opacity-60">Open the editor to fill the report.</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 bg-gray-50 border-t border-gray-100 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
              Close
            </button>
            <div className="flex items-center gap-2">
              {reportHtml && (
                <button
                  onClick={handlePrint}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 hover:bg-gray-100 text-gray-700 text-sm font-medium rounded-lg transition-colors"
                >
                  <Printer className="h-4 w-4" />Print
                </button>
              )}
              <Link
                href={reportUrl}
                onClick={onClose}
                className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <FileText className="h-4 w-4" />
                {patient.reportStatus === "completed" ? "Edit Report" : patient.reportStatus === "in_progress" ? "Continue Report" : "Open Report Editor"}
              </Link>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ── Patient card ─────────────────────────────────────────────────────────────

function PatientCard({
  patient, index, onViewBill, onViewReport,
}: {
  patient: PatientRef
  index: number
  onViewBill: (p: PatientRef) => void
  onViewReport: (p: PatientRef) => void
}) {
  const bStatus = billStatusOf(patient)
  const rMeta   = REPORT_STATUS_META[patient.reportStatus] ?? REPORT_STATUS_META.pending
  const net     = (patient.charges ?? 0) - (patient.discount ?? 0)
  const balance = Math.max(0, net - (patient.paid ?? 0))

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.055, ease: "easeOut" }}
      className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="h-11 w-11 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-bold shrink-0">
          {patInitials(patient.name)}
        </div>

        <div className="flex-1 min-w-0">
          {/* Row 1: name + sr# */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-base font-bold text-gray-900">{patient.name}</p>
            <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">#{patient.srNo}</span>
          </div>

          {/* Row 2: meta chips */}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {patient.study && (
              <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-xs font-semibold">{patient.study}</span>
            )}
            {patient.age > 0 && (
              <span className="text-xs text-gray-500">{patient.age} yrs · {patient.gender}</span>
            )}
            {patient.contact && (
              <span className="text-xs text-gray-500 flex items-center gap-1"><Phone className="h-3 w-3" />{patient.contact}</span>
            )}
            <span className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(patient.createdAt)}</span>
          </div>

          {/* Row 3: status badges */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {bStatus && (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${BILL_STATUS_STYLE[bStatus]}`}>
                <ReceiptText className="h-3 w-3" />Bill: {bStatus}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${rMeta.cls}`}>
              {rMeta.icon}{rMeta.label}
            </span>
          </div>

          {/* Row 4: billing numbers */}
          {patient.charges ? (
            <div className="mt-3 flex items-center gap-3 flex-wrap p-3 bg-gray-50 rounded-lg">
              <div className="text-center">
                <p className="text-[11px] text-gray-400 mb-0.5">Charges</p>
                <p className="text-sm font-bold text-gray-800">₹{patient.charges.toLocaleString("en-IN")}</p>
              </div>
              <div className="h-8 w-px bg-gray-200" />
              <div className="text-center">
                <p className="text-[11px] text-gray-400 mb-0.5">Paid</p>
                <p className="text-sm font-bold text-green-600">₹{(patient.paid ?? 0).toLocaleString("en-IN")}</p>
              </div>
              {balance > 0 && (
                <>
                  <div className="h-8 w-px bg-gray-200" />
                  <div className="text-center">
                    <p className="text-[11px] text-gray-400 mb-0.5">Due</p>
                    <p className="text-sm font-bold text-red-500">₹{balance.toLocaleString("en-IN")}</p>
                  </div>
                </>
              )}
              {patient.paymentMode && (
                <>
                  <div className="h-8 w-px bg-gray-200" />
                  <div className="text-center">
                    <p className="text-[11px] text-gray-400 mb-0.5">Mode</p>
                    <p className="text-xs font-semibold text-gray-600">{patient.paymentMode}</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-400 italic">No billing record yet</p>
          )}

          {/* Row 5: action buttons */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => onViewBill(patient)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-300 text-xs font-semibold text-gray-700 hover:text-blue-700 transition-all"
            >
              <ReceiptText className="h-3.5 w-3.5" />View Bill
            </button>
            <button
              onClick={() => onViewReport(patient)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-violet-50 hover:border-violet-300 text-xs font-semibold text-gray-700 hover:text-violet-700 transition-all"
            >
              <FileText className="h-3.5 w-3.5" />
              {patient.reportStatus === "completed" ? "View Report" : patient.reportStatus === "in_progress" ? "Continue Report" : "Fill Report"}
            </button>
          </div>
        </div>
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
  onViewBill: (p: PatientRef) => void
  onViewReport: (p: PatientRef) => void
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
                    <PatientCard
                      key={p._id}
                      patient={p}
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
  const [billModal,      setBillModal]      = useState<PatientRef | null>(null)
  const [reportModal,    setReportModal]    = useState<PatientRef | null>(null)

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
      {billModal   && <BillModal   patient={billModal}   onClose={() => setBillModal(null)}   />}
      {reportModal && <ReportModal patient={reportModal} onClose={() => setReportModal(null)} />}

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
                  onViewBill={setBillModal}
                  onViewReport={setReportModal}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
