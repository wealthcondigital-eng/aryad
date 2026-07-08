"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Printer, Share2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reportHeaderHtml, reportTitleHtml, drawPdfReportHeader, drawPdfReportTitle } from "@/lib/report-layout"
import { REPORT_TEMPLATES } from "@/lib/report-templates"

const getDisplayTitle = (studyName: string) => {
  if (!studyName) return ""
  for (const cat of Object.keys(REPORT_TEMPLATES)) {
    const list = REPORT_TEMPLATES[cat as keyof typeof REPORT_TEMPLATES]
    const found = list.find(t => t.name.toLowerCase() === studyName.toLowerCase())
    if (found) return found.heading
  }
  return studyName
}

export interface ViewablePatient {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  referredBy: string
  study: string
  createdAt: string
}

function dateOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

export function ReportViewModal({
  patient,
  sidx = 0,
  onClose,
}: {
  patient: ViewablePatient
  sidx?: number          // which study of the patient (each study has its own report)
  onClose: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [reportBody, setReportBody] = useState("")
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const date = dateOf(patient.createdAt)

  useEffect(() => { setMounted(true) }, [])

  // Load: localStorage first, then MongoDB fallback (per study)
  useEffect(() => {
    const key = `aarya_report_${patient.srNo || patient.name.replace(/\s+/g, "_")}${sidx > 0 ? `_s${sidx}` : ""}`
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null")
      if (saved?.body) {
        setReportBody(saved.body)
        setLoading(false)
        return
      }
    } catch {}
    fetch(`/api/patients/${patient._id}`)
      .then((r) => r.json())
      .then((d) => setReportBody(d.patient?.studies?.[sidx]?.reportBody || d.patient?.reportBody || ""))
      .catch(() => setReportBody(""))
      .finally(() => setLoading(false))
  }, [patient, sidx])

  // Render HTML into the body div after load — strip edit-attribution markers for clean display
  useEffect(() => {
    if (!loading && bodyRef.current) {
      const clean = (reportBody || "").replace(
        /<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
        "$1"
      )
      bodyRef.current.innerHTML =
        clean || "<em style='color:#aaa;font-size:12px'>No report content saved yet.</em>"
    }
  }, [reportBody, loading])

  // Escape key closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = "" }
  }, [])

  const handleShare = async () => {
    setShareLoading(true)
    const stripEditMarks = (html: string) =>
      html.replace(/<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1")
    const bodyHtml  = stripEditMarks(bodyRef.current?.innerHTML || reportBody)
    const num = patient.contact?.replace(/\D/g, "") ?? ""

    try {
      const { jsPDF } = await import("jspdf")
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
      const W = 210, M = 20, CW = W - M * 2
      let y = 18
      const ln = (pt: number) => pt * 0.352778 * 1.4
      const checkPage = (need = 8) => { if (y + need > 282) { doc.addPage(); y = 18 } }

      // The PDF matches the printed report design: double-bordered patient
      // info box, then the bordered underlined study heading
      y = drawPdfReportHeader(doc, {
        name: patient.name, refBy: patient.referredBy, date,
        age: patient.age, gender: patient.gender, srNo: patient.srNo || undefined,
      })
      y = drawPdfReportTitle(doc, getDisplayTitle(patient.study), y)

      const { renderHtmlToPdf } = await import("@/lib/pdf-html-renderer")
      y = renderHtmlToPdf(doc, bodyHtml, M, CW, y, checkPage, 5.5)

      // Two-doctor signature block, matching the Word format
      checkPage(28); y += 22
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0)
      doc.text("DR. PRADNYA GORE", M, y)
      doc.text("DR. RAMNATH GHUTE", W / 2 + 5, y); y += ln(9)
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(60)
      doc.text("CONSULTANT RADIOLOGIST", M, y)
      doc.text("CONSULTANT RADIOLOGIST", W / 2 + 5, y); y += ln(7.5)
      doc.text("M.D. RADIOLOGY", W / 2 + 5, y)

      const pdfBlob   = doc.output("blob")
      const arrayBuf  = await pdfBlob.arrayBuffer()
      const bytes     = new Uint8Array(arrayBuf)
      let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)))
      const base64    = btoa(binary)

      const res  = await fetch(`/api/patients/${patient._id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reportPdf: base64, studyIndex: sidx }),
      })
      const data = await res.json()
      const slug = data?.patient?.studies?.[sidx]?.reportSlug || data?.patient?.reportSlug
      const pdfUrl = slug
        ? `${window.location.origin}/${slug}/pdf`
        : `${window.location.origin}/api/patients/${patient._id}/pdf?sidx=${sidx}`

      // Mobile Direct Share
      if (navigator.share && navigator.canShare) {
        const file = new File([pdfBlob], `Report_${patient.name.replace(/\s+/g, "_")}.pdf`, { type: "application/pdf" })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Report - ${patient.name}`,
            text: `Dear ${patient.name}, your ${patient.study} report from Aarya Diagnostics Center is ready.`,
          })
          setShareLoading(false)
          return
        }
      }

      const msg  = `Dear ${patient.name},\n\nYour *${patient.study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}`
      const waUrl = num ? `https://wa.me/91${num}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`
      setShareLoading(false)
      window.open(waUrl, "_blank")
      return
    } catch {}

    setShareLoading(false)
  }

  // Print output matches the printed report design: double-bordered patient
  // info box, bordered underlined study heading, body and signatures.
  const handlePrint = () => {
    const stripEditMarks = (html: string) =>
      html.replace(/<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1")
    const currentBody = stripEditMarks(bodyRef.current?.innerHTML || reportBody)

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report – ${patient.name}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.5;padding:15mm 20mm;color:#111;}@media print{body{padding:8mm 12mm;}}</style>
</head><body>
${reportHeaderHtml({ name: patient.name, refBy: patient.referredBy, date, age: patient.age, gender: patient.gender, srNo: patient.srNo || undefined })}
${reportTitleHtml(getDisplayTitle(patient.study))}
<div style="font-size:10pt;line-height:1.6;">${currentBody}</div>
<div style="display:flex;gap:30px;margin-top:80px;">
  <div style="flex:1;">
    <p style="font-weight:bold;font-size:10pt;text-transform:uppercase;">DR. PRADNYA GORE</p>
    <p style="font-size:8pt;color:#333;margin-top:2px;text-transform:uppercase;">Consultant Radiologist</p>
  </div>
  <div style="flex:1;">
    <p style="font-weight:bold;font-size:10pt;text-transform:uppercase;">DR. RAMNATH GHUTE</p>
    <p style="font-size:8pt;color:#333;margin-top:2px;text-transform:uppercase;">Consultant Radiologist</p>
    <p style="font-size:8pt;color:#333;margin-top:2px;text-transform:uppercase;">M.D. Radiology</p>
  </div>
</div>
</body></html>`

    const blob = new Blob([html], { type: "text/html" })
    const url  = URL.createObjectURL(blob)
    const win  = window.open(url, "_blank", "width=820,height=1000")
    if (!win) { alert("Please allow pop-ups."); URL.revokeObjectURL(url); return }
    win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
    setTimeout(() => win.print(), 600)
  }

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(6px)", backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden mx-2 sm:mx-0">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 sm:px-5 py-3 border-b bg-white shrink-0 gap-2 sm:gap-0">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">{patient.name} — {patient.study}</p>
            <p className="text-xs text-muted-foreground truncate">
              #{patient.srNo} · {date} · Ref: {patient.referredBy || "Self"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 justify-end shrink-0">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handlePrint}>
              <Printer className="h-3 w-3" />Print
            </Button>
            <Button size="sm" disabled={shareLoading} className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700" onClick={handleShare}>
              {shareLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}
              {shareLoading ? "Preparing..." : "Share PDF"}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Scrollable document */}
        <div className="overflow-y-auto flex-1 bg-slate-100 py-6 px-4">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-6 w-6 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
            </div>
          ) : (
            <div className="max-w-[680px] mx-auto bg-white shadow-lg rounded-sm px-4 sm:px-12 py-6 sm:py-10">

              {/* Patient info — matches the printed report header */}
              <div className="border-4 border-double border-gray-700 px-3 sm:px-4 py-2.5 sm:py-3 mb-5 flex flex-col sm:flex-row justify-between gap-3 sm:gap-4 text-xs font-bold text-gray-900">
                <div className="space-y-1 min-w-0">
                  <p className="truncate">NAME - {patient.name.toUpperCase()}</p>
                  <p className="truncate">REF. BY - {(patient.referredBy || "SELF").toUpperCase()}</p>
                  {patient.srNo > 0 && <p>SR. NO - #{patient.srNo}</p>}
                </div>
                <div className="space-y-1 shrink-0">
                  <p>DATE - {date}</p>
                  <p>AGE - {patient.age ? `${patient.age} YRS` : "—"}</p>
                  <p>SEX - {(patient.gender || "—").toUpperCase()}</p>
                </div>
              </div>

              {/* Study title — boxed like the printed report */}
              <div className="flex justify-center mb-5">
                <div className="text-center font-bold uppercase text-sm py-1.5 px-8 border-[1.5px] border-gray-700 underline underline-offset-4 tracking-wide text-gray-900">
                  {getDisplayTitle(patient.study)}
                </div>
              </div>

              {/* Report body */}
              <div
                ref={bodyRef}
                className="text-sm leading-relaxed text-gray-900 min-h-[200px]"
              />

              {/* Two-doctor signature block — matches print / Word */}
              <div className="mt-24 grid grid-cols-2 gap-8 select-none text-gray-900">
                <div>
                  <p className="font-bold text-xs uppercase">DR. PRADNYA GORE</p>
                  <p className="text-[10px] uppercase text-gray-600 mt-0.5">Consultant Radiologist</p>
                </div>
                <div>
                  <p className="font-bold text-xs uppercase">DR. RAMNATH GHUTE</p>
                  <p className="text-[10px] uppercase text-gray-600 mt-0.5">Consultant Radiologist</p>
                  <p className="text-[10px] uppercase text-gray-600">M.D. Radiology</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>,
    document.body
  )
}
