"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Search, FileText, MoreHorizontal, Share2, Download,
  Eye, CheckCircle2, Clock, AlertCircle, Printer, Loader2,
  Activity, User, CalendarDays, Hash, Trash2,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useRole } from "@/lib/role-context"
import { printShellHtml } from "@/lib/report-layout"
import { fetchSignatories, signatureColumnsHtml, buildDocxSignatureCells, dataUrlToBytes, imageFormat, type SignatureLayout } from "@/lib/report-signatures"
import { ReportViewModal } from "@/components/report-view-modal"
import { motion } from "motion/react"

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

interface PatientDoc {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  referredBy: string
  study: string
  studies?: StudyEntry[]
  reportStatus: "pending" | "in_progress" | "completed"
  reportSlug?: string
  createdAt: string
}

// One table row per study of a patient — each study has its own report
interface ReportRow {
  p: PatientDoc
  sidx: number
  study: string
  status: "pending" | "in_progress" | "completed"
  slug?: string
}

function toRows(patients: PatientDoc[]): ReportRow[] {
  return patients.flatMap((p) => {
    const entries: StudyEntry[] = p.studies?.length
      ? p.studies
      : [{ name: p.study, reportStatus: p.reportStatus, reportSlug: p.reportSlug }]
    return entries.map((s, sidx) => ({
      p, sidx,
      study:  s.name,
      status: s.reportStatus ?? "pending",
      slug:   s.reportSlug || (sidx === 0 ? p.reportSlug : undefined),
    }))
  })
}

function monthOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
}
function dateOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function fillReportHref(r: ReportRow, mode: "fill" | "edit" = "fill") {
  const params = new URLSearchParams({
    id:      r.p._id,
    sidx:    String(r.sidx),
    patient: r.p.name,
    study:   r.study,
    refBy:   r.p.referredBy || "Self",
    date:    dateOf(r.p.createdAt),
    age:     String(r.p.age),
    gender:  r.p.gender,
    srNo:    String(r.p.srNo),
    contact: r.p.contact,
    ...(mode === "edit" ? { load: "1" } : {}),
  })
  return `/reports/new?${params}`
}

function pdfUrlFor(r: ReportRow) {
  return r.slug
    ? `${window.location.origin}/${r.slug}/pdf`
    : `${window.location.origin}/api/patients/${r.p._id}/pdf?sidx=${r.sidx}`
}

function whatsAppShare(r: ReportRow) {
  const msg = `Dear ${r.p.name},\n\nYour *${r.study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrlFor(r)}`
  // Open WhatsApp Web on the logged-in account; sender picks the recipient
  window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank")
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700"><CheckCircle2 className="h-3 w-3" />Submitted</span>
  if (status === "in_progress")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700"><Clock className="h-3 w-3" />In Progress</span>
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600"><AlertCircle className="h-3 w-3" />Pending</span>
}

// ── HTML parse helper (browser-only) ─────────────────────────────────────────

type Seg = {
  text: string; bold?: boolean; italic?: boolean; underline?: boolean
  image?: string; imgWidth?: number; imgHeight?: number
}

function parseHtml(html: string): Seg[] {
  const segs: Seg[] = []
  if (typeof window === "undefined") return [{ text: html }]
  const doc = new DOMParser().parseFromString(html, "text/html")
  function walk(node: Node, fmt: { bold: boolean; italic: boolean; underline: boolean }) {
    if (node.nodeType === 3) {
      const t = node.textContent ?? ""
      if (t) segs.push({ text: t, ...fmt })
    } else if (node.nodeType === 1) {
      const el = node as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (tag === "img") {
        const src = el.getAttribute("src") || ""
        if (src) {
          const w = parseFloat(el.style.width) || parseFloat(el.getAttribute("width") || "") || 0
          const h = parseFloat(el.style.height) || parseFloat(el.getAttribute("height") || "") || 0
          segs.push({ text: "", image: src, imgWidth: w, imgHeight: h })
        }
        return
      }
      const f = { ...fmt }
      if (tag === "b" || tag === "strong") f.bold = true
      if (tag === "i" || tag === "em")     f.italic = true
      if (tag === "u")                     f.underline = true
      el.childNodes.forEach((c) => walk(c, f))
      if (["div", "p", "br", "li"].includes(tag)) segs.push({ text: "\n" })
    }
  }
  doc.body.childNodes.forEach((n) => walk(n, { bold: false, italic: false, underline: false }))
  return segs
}

// ── Generate DOCX base64 (fallback when no stored DOCX) ──────────────────────
// Matches the clinic Word format: starts at the study heading, no letterhead.

async function generateDocxBase64(r: ReportRow, reportHtml: string, signatureLayout: (SignatureLayout | null | undefined)[]): Promise<string> {
  const { Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle } = await import("docx")
  const signatories = await fetchSignatories()
  const sigCells = await buildDocxSignatureCells(signatories, signatureLayout)

  const cleanHtml = reportHtml.replace(
    /<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1"
  )

  const makeParas = (html: string, size = 20) => {
    const segs = parseHtml(html)
    const paras: InstanceType<typeof Paragraph>[] = []
    let line: InstanceType<typeof TextRun>[] = []
    const flush = () => {
      paras.push(new Paragraph({ children: line.length ? line : [new TextRun({ text: "", size })], spacing: { after: 80 } }))
      line = []
    }
    segs.forEach((s) => {
      if (s.image) {
        if (line.length) flush()
        const w = Math.min(s.imgWidth || 150, 450)
        const h = s.imgWidth && s.imgHeight ? Math.round(w * (s.imgHeight / s.imgWidth)) : Math.min(s.imgHeight || 60, 300)
        paras.push(new Paragraph({
          children: [new ImageRun({ type: imageFormat(s.image), data: dataUrlToBytes(s.image), transformation: { width: w, height: h } })],
          spacing: { after: 80 },
        }))
        return
      }
      if (s.text === "\n") { flush() }
      else { line.push(new TextRun({ text: s.text, bold: s.bold, italics: s.italic, underline: s.underline ? {} : undefined, size })) }
    })
    if (line.length) flush()
    return paras.length ? paras : [new Paragraph({ children: [new TextRun({ text: "", size })] })]
  }

  const noBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
    left: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
    right: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
  }

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: r.study.toUpperCase(), bold: true, size: 26, underline: {} })],
      spacing: { before: 120, after: 240 },
    }),
    ...makeParas(cleanHtml),
    new Paragraph({ children: [new TextRun("")], spacing: { before: 560 } }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [
        // Row 1: Signature Images
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: sigCells.imgLeft,
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: sigCells.imgRight,
            }),
          ],
        }),
        // Row 2: Doctor Names & Credentials
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: sigCells.textLeft,
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: sigCells.textRight,
            }),
          ],
        }),
      ],
    }),
  ]

  // 40mm top / 30mm bottom (in twips) keep the pre-printed letterhead bands empty
  return await Packer.toBase64String(new Document({
    sections: [{ properties: { page: { margin: { top: 2270, bottom: 1700, left: 1440, right: 1440 } } }, children }],
  }))
}

// ── Decode base64 DOCX and trigger download ───────────────────────────────────

function downloadDocx(base64: string, filename: string) {
  const binary = atob(base64)
  const bytes  = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement("a")
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ── Fetch the report body for one study of a patient ─────────────────────────

async function fetchStudyReport(r: ReportRow): Promise<{ body: string; docx: string; signatureLayout: (SignatureLayout | null | undefined)[] }> {
  // localStorage draft first (kept per study)
  const key = `aarya_report_${r.p.srNo || r.p.name.replace(/\s+/g, "_")}${r.sidx > 0 ? `_s${r.sidx}` : ""}`
  let body = ""
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null")
    if (saved?.body) body = saved.body
  } catch {}

  let docx = ""
  let signatureLayout: (SignatureLayout | null | undefined)[] = []
  try {
    const res = await fetch(`/api/patients/${r.p._id}`)
    const d   = await res.json()
    const entry = d.patient?.studies?.[r.sidx]
    if (!body) body = entry?.reportBody || d.patient?.reportBody || ""
    docx = entry?.reportDocx || (r.sidx === 0 ? d.patient?.reportDocx : "") || ""
    signatureLayout = entry?.signatureLayout || []
  } catch {}

  return { body, docx, signatureLayout }
}

// ── Print a submitted report directly ────────────────────────────────────────

// Print output matches the Word file: starts directly at the study heading
// (no letterhead / patient block — reports print on pre-printed stationery).
async function printReportDirect(r: ReportRow) {
  const { body: reportBody, signatureLayout } = await fetchStudyReport(r)
  const signatories = await fetchSignatories()
  const p = r.p

  const cleanBody = reportBody.replace(/<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1")
  const body      = cleanBody || "<em style='color:#aaa;font-size:12px'>No report content saved.</em>"

  const html = printShellHtml(`Report – ${p.name}`, `
<div style="border-bottom: 1.5px solid #111; padding-bottom: 8px; margin-bottom: 14px; font-family: Arial, sans-serif; font-size: 9pt;">
  <table style="width: 100%; border-collapse: collapse; border: none;">
    <tr style="border: none;">
      <td style="width: 50%; padding: 2px 0; border: none; vertical-align: top;"><strong>NAME:</strong> ${p.name.toUpperCase()}</td>
      <td style="width: 50%; padding: 2px 0; border: none; vertical-align: top;"><strong>DATE:</strong> ${dateOf(p.createdAt)}</td>
    </tr>
    <tr style="border: none;">
      <td style="width: 50%; padding: 2px 0; border: none; vertical-align: top;"><strong>AGE:</strong> ${p.age} YRS</td>
      <td style="width: 50%; padding: 2px 0; border: none; vertical-align: top;"><strong>MOBILE:</strong> ${p.contact}</td>
    </tr>
    <tr style="border: none;">
      <td style="width: 50%; padding: 2px 0; border: none; vertical-align: top;"><strong>REF. BY:</strong> ${(p.referredBy || "Self").toUpperCase()}</td>
      <td style="width: 50%; padding: 2px 0; border: none; vertical-align: top;"><strong>SEX:</strong> ${p.gender.toUpperCase()}</td>
    </tr>
    <tr style="border: none;">
      <td style="width: 50%; padding: 2px 0; border: none; vertical-align: top;"><strong>SR. NO:</strong> #${p.srNo}</td>
      <td style="width: 50%; padding: 2px 0; border: none; vertical-align: top;"></td>
    </tr>
  </table>
</div>
<div style="text-align:center;font-weight:bold;font-size:12pt;text-transform:uppercase;text-decoration:underline;margin:12px 0 18px;">${r.study}</div>
<div style="font-size:10pt;line-height:1.6;">${body}</div>
<div style="display:flex;gap:30px;margin-top:50px;page-break-inside:avoid;break-inside:avoid;">${signatureColumnsHtml(signatories, signatureLayout)}</div>`)

  const blob = new Blob([html], { type: "text/html" })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, "_blank", "width=820,height=1000")
  if (!win) { alert("Please allow pop-ups to print."); URL.revokeObjectURL(url); return }
  win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
  setTimeout(() => win.print(), 600)
}

export default function ReportsPage() {
  const { user } = useRole()
  const [patients,     setPatients]     = useState<PatientDoc[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState("")
  const [monthFilter,  setMonthFilter]  = useState("All Months")
  const [statusFilter, setStatusFilter] = useState("all")
  const [viewing,      setViewing]      = useState<ReportRow | null>(null)
  const [printingKey,   setPrintingKey]   = useState<string | null>(null)
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null)

  const rowKey = (r: ReportRow) => `${r.p._id}_${r.sidx}`

  const handlePrint = async (r: ReportRow) => {
    setPrintingKey(rowKey(r))
    await printReportDirect(r)
    setPrintingKey(null)
  }

  const handleDownloadDocx = async (r: ReportRow) => {
    setDownloadingKey(rowKey(r))
    try {
      const { body, docx, signatureLayout } = await fetchStudyReport(r)
      let base64 = docx
      if (!base64) {
        if (!body) {
          alert("No report content found. The report has not been submitted yet.")
          return
        }
        base64 = await generateDocxBase64(r, body, signatureLayout)
      }
      downloadDocx(base64, `Report_${r.p.name.replace(/\s+/g, "_")}_${r.study.replace(/[^A-Za-z0-9]+/g, "_")}.docx`)
    } catch {
      alert("Failed to download. Please try again.")
    } finally {
      setDownloadingKey(null)
    }
  }

  const fetchPatients = () => {
    fetch("/api/patients")
      .then((r) => r.json())
      .then((data) => setPatients(data.patients || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchPatients() }, [])

  // Removes the study (and its report) from the patient, pulls its line off
  // the linked bill (deleting the bill if that was its only line), and — if
  // it was the patient's only study — the whole patient record.
  const handleDeleteReport = async (r: ReportRow) => {
    const isLast = (r.p.studies?.length ?? 1) <= 1
    const msg = isLast
      ? `Delete the "${r.study}" report for ${r.p.name}?\n\nThis is their only study, so the patient record and their bill will be deleted too. This cannot be undone.`
      : `Delete the "${r.study}" report for ${r.p.name}?\n\nThe study is removed from the patient and its line comes off their bill. This cannot be undone.`
    if (!confirm(msg)) return
    try {
      const res = await fetch(`/api/patients/${r.p._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeStudyIndex: r.sidx }),
      })
      if (!res.ok) throw new Error()
      fetchPatients()
    } catch {
      alert("Failed to delete the report. Please try again.")
    }
  }

  // Everyone (receptionist, doctor, admin) can create and edit reports now
  const canCreate = user?.permissions.reports.create ?? false

  const allRows = toRows(patients)

  const uniqueMonths = Array.from(new Set(allRows.map((r) => monthOf(r.p.createdAt))))
  const MONTHS = ["All Months", ...uniqueMonths]

  const filtered = allRows.filter((r) => {
    const matchSearch = !search ||
      r.p.name.toLowerCase().includes(search.toLowerCase()) ||
      r.study.toLowerCase().includes(search.toLowerCase())
    const matchMonth  = monthFilter === "All Months" || monthOf(r.p.createdAt) === monthFilter
    const apiStatus   = r.status === "completed" ? "submitted" : r.status
    const matchStatus = statusFilter === "all" || apiStatus === statusFilter
    return matchSearch && matchMonth && matchStatus
  })

  // Group contiguous rows by patient for visual threading
  const groupedRows = filtered.reduce<{ patient: PatientDoc; rows: ReportRow[] }[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (last && last.patient._id === r.p._id) {
      last.rows.push(r)
    } else {
      acc.push({ patient: r.p, rows: [r] })
    }
    return acc
  }, [])

  const submitted  = allRows.filter((r) => r.status === "completed").length
  const inProgress = allRows.filter((r) => r.status === "in_progress").length
  const pending    = allRows.filter((r) => r.status === "pending").length

  return (
    <>
      {/* View modal */}
      {viewing && (
        <ReportViewModal
          patient={{ ...viewing.p, study: viewing.study }}
          sidx={viewing.sidx}
          onClose={() => setViewing(null)}
        />
      )}

      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Each study has its own separate report — a patient can have several</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { border: "border-l-green-500",  label: "Submitted",   val: submitted,   extra: <p className="text-xs text-green-600 mt-0.5">Ready to print</p> },
            { border: "border-l-yellow-500", label: "In Progress", val: inProgress,  extra: null },
            { border: "border-l-slate-400",  label: "Pending",     val: pending,     extra: null },
          ].map(({ border, label, val, extra }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07, duration: 0.3 }}
            >
              <Card className={`border-l-4 ${border} h-full`}>
                <CardContent className="p-4 h-full">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                  {loading ? <Skeleton className="h-8 w-12 mt-1" /> : <p className="text-2xl font-bold mt-1">{val}</p>}
                  {!loading && extra}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-3 pt-4 px-5">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">All Reports</CardTitle>
                <CardDescription>{loading ? "Loading..." : `${filtered.length} reports`}</CardDescription>
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center justify-end w-full sm:w-auto">
                <div className="relative w-full sm:w-48">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Patient or study..." className="pl-9 h-9 w-full" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                  <Select value={monthFilter} onValueChange={setMonthFilter}>
                    <SelectTrigger className="h-9 w-full sm:w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-9 w-full sm:w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="px-5 pb-2 pt-3">
                {[...Array(7)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="flex items-center gap-4 py-3.5 border-b border-border/40 last:border-0"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.25, ease: "easeOut" }}
                  >
                    <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-36" />
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </div>
                      <Skeleton className="h-3 w-64" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Skeleton className="h-7 w-16 rounded-md" />
                      <Skeleton className="h-7 w-14 rounded-md" />
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="px-4 pb-4 pt-1 space-y-3">
                {groupedRows.length === 0 && (
                  <p className="text-center py-10 text-muted-foreground text-sm">No reports match your filters.</p>
                )}
                {groupedRows.map(({ patient, rows }) => {
                  const first = rows[0]
                  return (
                    <div key={patient._id} className="rounded-xl border bg-background shadow-sm overflow-hidden">
                      {/* Main patient row */}
                      <div key={rowKey(first)} className="relative flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-4 hover:bg-muted/30 transition-colors">
                        {rows.length > 1 && (
                          <div className="absolute left-[31px] sm:left-[39px] top-[44px] bottom-0 w-0.5 bg-slate-200" />
                        )}
                        <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0 relative z-10">
                          <FileText className="h-5 w-5 text-purple-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <p className="font-semibold text-sm leading-none">{first.p.name}</p>
                            <StatusBadge status={first.status} />
                            {(first.p.studies?.length ?? 0) > 1 && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                                study {first.sidx + 1}/{first.p.studies!.length}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Activity className="h-3 w-3 text-purple-400 shrink-0" />
                              {first.study}
                            </span>
                            <span className="text-muted-foreground/30 text-xs hidden sm:inline">|</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3 text-blue-400 shrink-0" />
                              {first.p.referredBy || "Self"}
                            </span>
                            <span className="text-muted-foreground/30 text-xs hidden sm:inline">|</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Hash className="h-3 w-3 text-gray-400 shrink-0" />
                              {first.p.srNo}
                            </span>
                            <span className="text-muted-foreground/30 text-xs hidden sm:inline">|</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <CalendarDays className="h-3 w-3 text-green-400 shrink-0" />
                              {dateOf(first.p.createdAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {/* Fill / continue — available to every role */}
                          {canCreate && first.status !== "completed" && (
                            <Button asChild size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                              <Link href={fillReportHref(first)}>
                                {first.status === "in_progress" ? "Continue" : "Fill Report"}
                              </Link>
                            </Button>
                          )}

                          {first.status === "completed" && (
                            <>
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewing(first)}>
                                <Eye className="h-3 w-3" />View
                              </Button>
                              {canCreate && (
                                <Button asChild variant="outline" size="sm" className="hidden sm:flex h-7 text-xs gap-1">
                                  <Link href={fillReportHref(first, "edit")}><FileText className="h-3 w-3" />Edit</Link>
                                </Button>
                              )}
                              <Button
                                variant="outline" size="sm" className="hidden sm:flex h-7 text-xs gap-1"
                                onClick={() => handlePrint(first)}
                                disabled={printingKey === rowKey(first)}
                              >
                                {printingKey === rowKey(first)
                                  ? <Loader2 className="h-3 w-3 animate-spin" />
                                  : <Printer className="h-3 w-3" />}
                                Print
                              </Button>
                              <Button size="sm" className="hidden sm:flex h-7 text-xs gap-1 bg-green-600 hover:bg-green-700" onClick={() => whatsAppShare(first)}>
                                <Share2 className="h-3 w-3" />
                              </Button>
                            </>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                {downloadingKey === rowKey(first)
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : <MoreHorizontal className="h-4 w-4" />}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="flex items-center gap-2"
                                onClick={() => first.status === "completed" && setViewing(first)}
                                disabled={first.status !== "completed"}
                              >
                                <Eye className="h-3.5 w-3.5" />View Report
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="flex items-center gap-2"
                                disabled={downloadingKey === rowKey(first) || first.status !== "completed"}
                                onClick={() => handleDownloadDocx(first)}
                              >
                                <Download className="h-3.5 w-3.5" />Download DOCX
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="flex items-center gap-2 text-green-700" onClick={() => whatsAppShare(first)}>
                                <Share2 className="h-3.5 w-3.5" />Share on WhatsApp
                              </DropdownMenuItem>
                              {canCreate && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="flex items-center gap-2 text-red-600 focus:text-red-600"
                                    onClick={() => handleDeleteReport(first)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />Delete Report
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* Nested study rows (2nd study onwards) — threaded under the patient */}
                      {rows.slice(1).map((r, idx) => (
                        <div key={rowKey(r)} className="relative flex items-center gap-2 sm:gap-4 pl-10 sm:pl-[56px] pr-3 sm:pr-5 py-3 bg-slate-50 hover:bg-slate-100/80 transition-colors border-t border-border/60">
                          {idx < rows.length - 2 && (
                            <div className="absolute left-[31px] sm:left-[39px] top-0 bottom-0 w-0.5 bg-slate-200" />
                          )}
                          <div className="absolute left-[31px] sm:left-[39px] top-0 w-3.5 sm:w-[18px] h-[26px] border-l-2 border-b-2 border-slate-200 rounded-bl-lg" />
                          
                          <div className="h-7 w-7 rounded-lg bg-purple-100/50 flex items-center justify-center shrink-0 relative z-10">
                            <FileText className="h-4 w-4 text-purple-500" />
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="font-medium text-sm text-slate-700">{r.p.name}</p>
                              <StatusBadge status={r.status} />
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">
                                study {r.sidx + 1}/{r.p.studies?.length || 1}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Activity className="h-3 w-3 text-purple-400 shrink-0" />
                                {r.study}
                              </span>
                              <span className="text-muted-foreground/30 text-[10px]">|</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <User className="h-3 w-3 text-blue-400 shrink-0" />
                                {r.p.referredBy || "Self"}
                              </span>
                              <span className="text-muted-foreground/30 text-[10px]">|</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Hash className="h-3 w-3 text-gray-400 shrink-0" />
                                {r.p.srNo}
                              </span>
                              <span className="text-muted-foreground/30 text-[10px]">|</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <CalendarDays className="h-3 w-3 text-green-400 shrink-0" />
                                {dateOf(r.p.createdAt)}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {/* Fill / continue — available to every role */}
                            {canCreate && r.status !== "completed" && (
                              <Button asChild size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                                <Link href={fillReportHref(r)}>
                                  {r.status === "in_progress" ? "Continue" : "Fill Report"}
                                </Link>
                              </Button>
                            )}

                            {r.status === "completed" && (
                              <>
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewing(r)}>
                                  <Eye className="h-3 w-3" />View
                                </Button>
                                {canCreate && (
                                  <Button asChild variant="outline" size="sm" className="hidden sm:flex h-7 text-xs gap-1">
                                    <Link href={fillReportHref(r, "edit")}><FileText className="h-3 w-3" />Edit</Link>
                                  </Button>
                                )}
                                <Button
                                  variant="outline" size="sm" className="hidden sm:flex h-7 text-xs gap-1"
                                  onClick={() => handlePrint(r)}
                                  disabled={printingKey === rowKey(r)}
                                >
                                  {printingKey === rowKey(r)
                                    ? <Loader2 className="h-3 w-3 animate-spin" />
                                    : <Printer className="h-3 w-3" />}
                                  Print
                                </Button>
                                <Button size="sm" className="hidden sm:flex h-7 text-xs gap-1 bg-green-600 hover:bg-green-700" onClick={() => whatsAppShare(r)}>
                                  <Share2 className="h-3 w-3" />
                                </Button>
                              </>
                            )}

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  {downloadingKey === rowKey(r)
                                    ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : <MoreHorizontal className="h-4 w-4" />}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  className="flex items-center gap-2"
                                  onClick={() => r.status === "completed" && setViewing(r)}
                                  disabled={r.status !== "completed"}
                                >
                                  <Eye className="h-3.5 w-3.5" />View Report
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="flex items-center gap-2"
                                  disabled={downloadingKey === rowKey(r) || r.status !== "completed"}
                                  onClick={() => handleDownloadDocx(r)}
                                >
                                  <Download className="h-3.5 w-3.5" />Download DOCX
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="flex items-center gap-2 text-green-700" onClick={() => whatsAppShare(r)}>
                                  <Share2 className="h-3.5 w-3.5" />Share on WhatsApp
                                </DropdownMenuItem>
                                {canCreate && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="flex items-center gap-2 text-red-600 focus:text-red-600"
                                      onClick={() => handleDeleteReport(r)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />Delete Report
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
