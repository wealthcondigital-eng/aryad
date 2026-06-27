"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Search, FileText, MoreHorizontal, Share2, Download,
  Eye, CheckCircle2, Clock, AlertCircle, Printer, Loader2,
  Activity, User, CalendarDays, Hash,
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
import { ReportViewModal } from "@/components/report-view-modal"
import { motion } from "motion/react"

interface PatientDoc {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  referredBy: string
  study: string
  reportStatus: "pending" | "in_progress" | "completed"
  reportDocx?: string
  reportSlug?: string
  createdAt: string
}

function monthOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
}
function dateOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function fillReportHref(p: PatientDoc, mode: "fill" | "edit" = "fill") {
  const params = new URLSearchParams({
    id:      p._id,
    patient: p.name,
    study:   p.study,
    refBy:   p.referredBy || "Self",
    date:    dateOf(p.createdAt),
    age:     String(p.age),
    gender:  p.gender,
    srNo:    String(p.srNo),
    contact: p.contact,
    ...(mode === "edit" ? { load: "1" } : {}),
  })
  return `/reports/new?${params}`
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700"><CheckCircle2 className="h-3 w-3" />Submitted</span>
  if (status === "in_progress")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700"><Clock className="h-3 w-3" />In Progress</span>
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600"><AlertCircle className="h-3 w-3" />Pending</span>
}

// ── HTML parse helper (browser-only) ─────────────────────────────────────────

type Seg = { text: string; bold?: boolean; italic?: boolean; underline?: boolean }

function parseHtml(html: string): Seg[] {
  const segs: Seg[] = []
  if (typeof window === "undefined") return [{ text: html }]
  const doc = new DOMParser().parseFromString(html, "text/html")
  function walk(node: Node, fmt: { bold: boolean; italic: boolean; underline: boolean }) {
    if (node.nodeType === 3) {
      const t = node.textContent ?? ""
      if (t) segs.push({ text: t, ...fmt })
    } else if (node.nodeType === 1) {
      const el = node as Element
      const tag = el.tagName.toLowerCase()
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

// ── Generate DOCX base64 from patient data + report HTML ─────────────────────

async function generateDocxBase64(p: PatientDoc, reportHtml: string): Promise<string> {
  const { Document, Packer, Paragraph, TextRun, AlignmentType } = await import("docx")
  const date = new Date(p.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  const cleanHtml = reportHtml.replace(
    /<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1"
  )

  const makeParas = (html: string, size = 20) => {
    const segs = parseHtml(html)
    const paras: InstanceType<typeof Paragraph>[] = []
    let line: InstanceType<typeof TextRun>[] = []
    const flush = () => {
      paras.push(new Paragraph({ children: line.length ? line : [new TextRun({ text: "", size })] }))
      line = []
    }
    segs.forEach((s) => {
      if (s.text === "\n") { flush() }
      else { line.push(new TextRun({ text: s.text, bold: s.bold, italics: s.italic, underline: s.underline ? {} : undefined, size })) }
    })
    if (line.length) flush()
    return paras.length ? paras : [new Paragraph({ children: [new TextRun({ text: "", size })] })]
  }

  const infoLines: [string, string][] = [["NAME", p.name.toUpperCase()], ["DATE", date]]
  if (p.age)     infoLines.push(["AGE",    `${p.age} YRS`])
  if (p.contact) infoLines.push(["MOBILE", p.contact])
  infoLines.push(["REF. BY", (p.referredBy || "SELF").toUpperCase()])
  if (p.gender)  infoLines.push(["SEX",    p.gender.toUpperCase()])
  if (p.srNo)    infoLines.push(["SR. NO", `#${p.srNo}`])

  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "AARYA DIAGNOSTICS CENTER", bold: true, size: 32 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Shop No. 5, K. K. Smruti Building, S.N. Mehta Road, Ghatkopar (W) 400086  ·  Tel: 9819022444", size: 18, color: "666666" })] }),
    new Paragraph({ children: [new TextRun("")] }),
    ...infoLines.map(([l, v]) => new Paragraph({ children: [new TextRun({ text: `${l}: `, bold: true, size: 20 }), new TextRun({ text: v, size: 20 })] })),
    new Paragraph({ children: [new TextRun("")] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: p.study.toUpperCase(), bold: true, size: 24, underline: {} })] }),
    new Paragraph({ children: [new TextRun("")] }),
    ...makeParas(cleanHtml),
  ]

  return await Packer.toBase64String(new Document({ sections: [{ children }] }))
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

// ── Main page ─────────────────────────────────────────────────────────────────

async function printReportDirect(p: PatientDoc) {
  // Try localStorage first, then API
  let reportBody = ""
  const key = `aarya_report_${p.srNo || p.name.replace(/\s+/g, "_")}`
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null")
    if (saved?.body) reportBody = saved.body
  } catch {}
  if (!reportBody) {
    try {
      const res = await fetch(`/api/patients/${p._id}`)
      const d   = await res.json()
      reportBody = d.patient?.reportBody ?? ""
    } catch {}
  }

  const date    = new Date(p.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  const cleanBody = reportBody.replace(/<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1")
  const body    = cleanBody || "<em style='color:#aaa;font-size:12px'>No report content saved.</em>"

  const infoData: [string, string][] = [["NAME", p.name.toUpperCase()], ["DATE", date]]
  if (p.age)     infoData.push(["AGE",    `${p.age} YRS`])
  if (p.contact) infoData.push(["MOBILE", p.contact])
  infoData.push(["REF. BY", (p.referredBy || "SELF").toUpperCase()])
  if (p.gender)  infoData.push(["SEX",    p.gender.toUpperCase()])
  if (p.srNo)    infoData.push(["SR. NO", `#${p.srNo}`])

  const infoHtml = infoData
    .reduce<[string, string][][]>((rows, item, i) => {
      if (i % 2 === 0) rows.push([item]); else rows[rows.length - 1].push(item)
      return rows
    }, [])
    .map((pair) =>
      `<div style="display:flex;gap:30px;margin-bottom:3px;">${pair
        .map(([l, v]) => `<div style="display:flex;flex:1;gap:6px;font-size:9pt;"><span style="font-weight:bold;min-width:56px;">${l}:</span><span>${v}</span></div>`)
        .join("")}</div>`
    ).join("")

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report – ${p.name}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.5;padding:15mm 20mm;color:#111;}@media print{body{padding:8mm 12mm;}}</style>
</head><body>
<div style="text-align:center;padding-bottom:10px;border-bottom:2px solid #111;margin-bottom:14px;">
  <img src="${window.location.origin}/logo.jpeg" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin:0 auto 6px;display:block;" />
  <h1 style="font-size:15pt;font-weight:bold;text-transform:uppercase;letter-spacing:2px;">Aarya Diagnostics Center</h1>
  <p style="font-size:9pt;color:#555;margin-top:4px;">Shop No. 5, K. K. Smruti Building, S.N. Mehta Road, Ghatkopar (W) 400086</p>
  <p style="font-size:9pt;color:#555;">Tel: 9819022444 &nbsp;·&nbsp; aaryadiagnosticsmumbai@gmail.com</p>
</div>
<div style="border-bottom:1px solid #aaa;padding-bottom:10px;margin-bottom:12px;">${infoHtml}</div>
<div style="text-align:center;font-weight:bold;font-size:12pt;text-transform:uppercase;text-decoration:underline;margin:12px 0 14px;">${p.study}</div>
<div style="font-size:10pt;line-height:1.6;">${body}</div>
</body></html>`

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
  const [viewing,      setViewing]      = useState<PatientDoc | null>(null)
  const [printingId,   setPrintingId]   = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const handlePrint = async (p: PatientDoc) => {
    setPrintingId(p._id)
    await printReportDirect(p)
    setPrintingId(null)
  }

  const handleDownloadDocx = async (p: PatientDoc) => {
    setDownloadingId(p._id)
    try {
      const res  = await fetch(`/api/patients/${p._id}`)
      const data = await res.json()
      const patient = data.patient ?? {}

      let base64: string = patient.reportDocx ?? ""

      // Fallback: generate DOCX on-the-fly from saved report body
      if (!base64) {
        const reportBody: string = patient.reportBody ?? ""
        if (!reportBody) {
          alert("No report content found. The doctor has not submitted a report yet.")
          return
        }
        base64 = await generateDocxBase64(p, reportBody)
      }

      downloadDocx(base64, `Report_${p.name.replace(/\s+/g, "_")}.docx`)
    } catch {
      alert("Failed to download. Please try again.")
    } finally {
      setDownloadingId(null)
    }
  }

  useEffect(() => {
    fetch("/api/patients")
      .then((r) => r.json())
      .then((data) => setPatients(data.patients || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const isDoctor       = user?.role === "doctor"
  const isReceptionist = user?.role === "receptionist"

  const uniqueMonths = Array.from(new Set(patients.map((p) => monthOf(p.createdAt))))
  const MONTHS = ["All Months", ...uniqueMonths]

  const filtered = patients.filter((p) => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.study.toLowerCase().includes(search.toLowerCase())
    const matchMonth  = monthFilter === "All Months" || monthOf(p.createdAt) === monthFilter
    const apiStatus   = p.reportStatus === "completed" ? "submitted" : p.reportStatus
    const matchStatus = statusFilter === "all" || apiStatus === statusFilter
    return matchSearch && matchMonth && matchStatus
  })

  const submitted  = patients.filter((p) => p.reportStatus === "completed").length
  const inProgress = patients.filter((p) => p.reportStatus === "in_progress").length
  const pending    = patients.filter((p) => p.reportStatus === "pending").length

  return (
    <>
      {/* View modal */}
      {viewing && <ReportViewModal patient={viewing} onClose={() => setViewing(null)} />}

      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Diagnostic reports for all patients</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { border: "border-l-green-500",  label: "Submitted",   val: submitted,   extra: isReceptionist && <p className="text-xs text-green-600 mt-0.5">Ready to print</p> },
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
              <div className="flex flex-wrap gap-2">
                <div className="relative w-48">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Patient or study..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={monthFilter} onValueChange={setMonthFilter}>
                  <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
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
              <div className="divide-y divide-border">
                {filtered.length === 0 && (
                  <p className="text-center py-10 text-muted-foreground text-sm">No reports match your filters.</p>
                )}
                {filtered.map((p) => (
                  <div key={p._id} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors">
                    <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <p className="font-semibold text-sm leading-none">{p.name}</p>
                        <StatusBadge status={p.reportStatus} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Activity className="h-3 w-3 text-purple-400 shrink-0" />
                          {p.study}
                        </span>
                        <span className="text-muted-foreground/30 text-xs hidden sm:inline">|</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3 text-blue-400 shrink-0" />
                          {p.referredBy || "Self"}
                        </span>
                        <span className="text-muted-foreground/30 text-xs hidden sm:inline">|</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Hash className="h-3 w-3 text-gray-400 shrink-0" />
                          {p.srNo}
                        </span>
                        <span className="text-muted-foreground/30 text-xs hidden sm:inline">|</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarDays className="h-3 w-3 text-green-400 shrink-0" />
                          {dateOf(p.createdAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Receptionist: view (modal) + print + share */}
                      {isReceptionist && p.reportStatus === "completed" && (
                        <>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewing(p)}>
                            <Eye className="h-3 w-3" />View
                          </Button>
                          <Button
                            variant="outline" size="sm" className="h-7 text-xs gap-1"
                            onClick={() => handlePrint(p)}
                            disabled={printingId === p._id}
                          >
                            {printingId === p._id
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Printer className="h-3 w-3" />}
                            Print
                          </Button>
                          <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700"
                            onClick={() => {
                              const pdfUrl = p.reportSlug ? `${window.location.origin}/${p.reportSlug}/pdf` : `${window.location.origin}/api/patients/${p._id}/pdf`
                              const msg = `Dear ${p.name},\n\nYour *${p.study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}`
                              window.open(`https://wa.me/91${p.contact}?text=${encodeURIComponent(msg)}`, "_blank")
                            }}>
                            <Share2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}

                      {/* Doctor: fill / continue or view (modal) + edit */}
                      {isDoctor && p.reportStatus !== "completed" && (
                        <Button asChild size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                          <Link href={fillReportHref(p)}>
                            {p.reportStatus === "in_progress" ? "Continue" : "Fill Report"}
                          </Link>
                        </Button>
                      )}
                      {isDoctor && p.reportStatus === "completed" && (
                        <>
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewing(p)}>
                            <Eye className="h-3 w-3" />View
                          </Button>
                          <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
                            <Link href={fillReportHref(p, "edit")}><FileText className="h-3 w-3" />Edit</Link>
                          </Button>
                        </>
                      )}
                      {isDoctor && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              {downloadingId === p._id
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <MoreHorizontal className="h-4 w-4" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="flex items-center gap-2"
                              disabled={downloadingId === p._id || p.reportStatus !== "completed"}
                              onClick={() => handleDownloadDocx(p)}
                            >
                              <Download className="h-3.5 w-3.5" />Download DOCX
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="flex items-center gap-2 text-green-700"
                              onClick={() => {
                                const pdfUrl = p.reportSlug ? `${window.location.origin}/${p.reportSlug}/pdf` : `${window.location.origin}/api/patients/${p._id}/pdf`
                                const msg = `Dear ${p.name},\n\nYour *${p.study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}`
                                window.open(`https://wa.me/91${p.contact}?text=${encodeURIComponent(msg)}`, "_blank")
                              }}>
                              <Share2 className="h-3.5 w-3.5" />Share on WhatsApp
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}

                      {/* Admin: all options */}
                      {!isDoctor && !isReceptionist && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              {downloadingId === p._id
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <MoreHorizontal className="h-4 w-4" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem className="flex items-center gap-2" onClick={() => setViewing(p)}>
                              <Eye className="h-3.5 w-3.5" />View Report
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="flex items-center gap-2"
                              onClick={() => handlePrint(p)}
                              disabled={p.reportStatus !== "completed"}
                            >
                              <Printer className="h-3.5 w-3.5" />Print
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="flex items-center gap-2"
                              disabled={downloadingId === p._id || p.reportStatus !== "completed"}
                              onClick={() => handleDownloadDocx(p)}
                            >
                              <Download className="h-3.5 w-3.5" />Download DOCX
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="flex items-center gap-2 text-green-700"
                              onClick={() => {
                                const pdfUrl = p.reportSlug ? `${window.location.origin}/${p.reportSlug}/pdf` : `${window.location.origin}/api/patients/${p._id}/pdf`
                                const msg = `Dear ${p.name},\n\nYour *${p.study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}`
                                window.open(`https://wa.me/91${p.contact}?text=${encodeURIComponent(msg)}`, "_blank")
                              }}>
                              <Share2 className="h-3.5 w-3.5" />Share on WhatsApp
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
