"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { X, Printer, Share2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

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
  onClose,
}: {
  patient: ViewablePatient
  onClose: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const [reportBody, setReportBody] = useState("")
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const date = dateOf(patient.createdAt)

  useEffect(() => { setMounted(true) }, [])

  // Load: localStorage first, then MongoDB fallback
  useEffect(() => {
    const key = `aarya_report_${patient.srNo || patient.name.replace(/\s+/g, "_")}`
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
      .then((d) => setReportBody(d.patient?.reportBody ?? ""))
      .catch(() => setReportBody(""))
      .finally(() => setLoading(false))
  }, [patient])

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
    const pdfUrl    = `${window.location.origin}/api/patients/${patient._id}/pdf`
    const num       = patient.contact?.replace(/\D/g, "") ?? ""
    const msg       = `Dear ${patient.name},\n\nYour *${patient.study}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${pdfUrl}\n\nAarya Diagnostics Center\nTel: 9819022444`
    const waUrl     = num ? `https://wa.me/91${num}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`

    try {
      const { jsPDF } = await import("jspdf")
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
      const W = 210, M = 20, CW = W - M * 2
      let y = 18
      const ln = (pt: number) => pt * 0.352778 * 1.4
      const checkPage = (need = 8) => { if (y + need > 282) { doc.addPage(); y = 18 } }

      doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(0)
      doc.text("AARYA DIAGNOSTICS CENTER", W / 2, y, { align: "center" }); y += ln(16)
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100)
      doc.text("Shop No. 5, K. K. Smruti Building, S.N. Mehta Road, Ghatkopar (W) 400086", W / 2, y, { align: "center" }); y += ln(8)
      doc.text("Tel: 9819022444   ·   aaryadiagnosticsmumbai@gmail.com", W / 2, y, { align: "center" }); y += ln(8) + 2
      doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 5

      doc.setTextColor(0)
      const info: [string, string][] = [["NAME", patient.name.toUpperCase()], ["DATE", date]]
      if (patient.age)     info.push(["AGE",    `${patient.age} YRS`])
      if (patient.contact) info.push(["MOBILE", patient.contact])
      info.push(["REF. BY", (patient.referredBy || "SELF").toUpperCase()])
      if (patient.gender)  info.push(["SEX",    patient.gender.toUpperCase()])
      if (patient.srNo)    info.push(["SR. NO", `#${patient.srNo}`])
      for (let i = 0; i < info.length; i += 2) {
        const [ll, lv] = info[i]
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text(`${ll}:`, M, y)
        doc.setFont("helvetica", "normal"); doc.text(lv, M + doc.getTextWidth(`${ll}:`) + 1.5, y)
        if (info[i + 1]) {
          const [rl, rv] = info[i + 1]; const rx = W / 2 + 5
          doc.setFont("helvetica", "bold"); doc.text(`${rl}:`, rx, y)
          doc.setFont("helvetica", "normal"); doc.text(rv, rx + doc.getTextWidth(`${rl}:`) + 1.5, y)
        }
        y += ln(9) + 0.4
      }
      y += 2; doc.setDrawColor(180); doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 7

      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(0)
      doc.text(patient.study.toUpperCase(), W / 2, y, { align: "center" })
      const sw = doc.getTextWidth(patient.study.toUpperCase())
      doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line((W - sw) / 2, y + 1, (W + sw) / 2, y + 1)
      y += ln(12) + 5

      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(50)
      const plainText = new DOMParser().parseFromString(bodyHtml, "text/html").body.textContent ?? ""
      const wrappedLines = doc.splitTextToSize(plainText, CW)
      for (const line of wrappedLines) { checkPage(5.5); doc.text(line, M, y); y += 5.5 }

      checkPage(24); y += 10
      doc.setDrawColor(180); doc.setLineWidth(0.3); doc.line(M, y, M + 60, y); y += 4
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0)
      doc.text("DR. RAMESH MEHTA", M, y); y += ln(9)
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100)
      doc.text("Consultant Radiologist", M, y)

      const pdfBlob   = doc.output("blob")
      const arrayBuf  = await pdfBlob.arrayBuffer()
      const bytes     = new Uint8Array(arrayBuf)
      let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)))
      const base64    = btoa(binary)

      await fetch(`/api/patients/${patient._id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ reportPdf: base64 }),
      })
    } catch {}

    setShareLoading(false)
    window.open(waUrl, "_blank")
  }

  const handlePrint = () => {
    const stripEditMarks = (html: string) =>
      html.replace(/<span\b[^>]*class="[^"]*\breport-edited\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, "$1")
    const currentBody = stripEditMarks(bodyRef.current?.innerHTML || reportBody)
    const infoRows: [string, string][] = [["NAME", patient.name.toUpperCase()], ["DATE", date]]
    if (patient.age)     infoRows.push(["AGE",    `${patient.age} YRS`])
    if (patient.contact) infoRows.push(["MOBILE", patient.contact])
    infoRows.push(["REF. BY", (patient.referredBy || "SELF").toUpperCase()])
    if (patient.gender)  infoRows.push(["SEX",    patient.gender.toUpperCase()])
    if (patient.srNo)    infoRows.push(["SR. NO", `#${patient.srNo}`])

    const infoHtml = infoRows
      .reduce<[string, string][][]>((rows, item, i) => {
        if (i % 2 === 0) rows.push([item])
        else rows[rows.length - 1].push(item)
        return rows
      }, [])
      .map(
        (pair) => `<div style="display:flex;gap:30px;margin-bottom:3px;">${pair
          .map(([l, v]) => `<div style="display:flex;flex:1;gap:6px;font-size:9pt;"><span style="font-weight:bold;min-width:56px;">${l}:</span><span>${v}</span></div>`)
          .join("")}</div>`
      )
      .join("")

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report – ${patient.name}</title>
<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.5;padding:15mm 20mm;color:#111;}@media print{body{padding:8mm 12mm;}}</style>
</head><body>
<div style="text-align:center;padding-bottom:10px;border-bottom:2px solid #111;margin-bottom:14px;">
  <img src="${window.location.origin}/logo.jpeg" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin:0 auto 6px;display:block;" />
  <h1 style="font-size:15pt;font-weight:bold;text-transform:uppercase;letter-spacing:2px;">Aarya Diagnostics Center</h1>
  <p style="font-size:9pt;color:#555;margin-top:4px;">Shop No. 5, K. K. Smruti Building, S.N. Mehta Road, Ghatkopar (W) 400086</p>
  <p style="font-size:9pt;color:#555;">Tel: 9819022444 &nbsp;·&nbsp; aaryadiagnosticsmumbai@gmail.com</p>
</div>
<div style="border-bottom:1px solid #aaa;padding-bottom:10px;margin-bottom:12px;">${infoHtml}</div>
<div style="text-align:center;font-weight:bold;font-size:12pt;text-transform:uppercase;text-decoration:underline;margin:12px 0 14px;">${patient.study}</div>
<div style="font-size:10pt;line-height:1.6;">${currentBody}</div>
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
        <div className="flex items-center justify-between px-5 py-3 border-b bg-white shrink-0">
          <div>
            <p className="font-semibold text-sm">{patient.name} — {patient.study}</p>
            <p className="text-xs text-muted-foreground">
              #{patient.srNo} · {date} · Ref: {patient.referredBy || "Self"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
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
            <div className="max-w-[680px] mx-auto bg-white shadow-lg rounded-sm px-12 py-10">

              {/* Letterhead */}
              <div className="text-center pb-4 border-b-2 border-gray-900 mb-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.jpeg" alt="Aarya" className="h-14 w-14 rounded-full object-cover mx-auto mb-2" />
                <h1 className="text-lg font-bold uppercase tracking-widest text-gray-900">
                  Aarya Diagnostics Center
                </h1>
                <p className="text-[10px] text-gray-500 mt-1">
                  Shop No. 5, K. K. Smruti Building, S.N. Mehta Road, Ghatkopar (W) 400086
                </p>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  Tel: 9819022444 &nbsp;·&nbsp; aaryadiagnosticsmumbai@gmail.com
                </p>
              </div>

              {/* Patient info */}
              <div className="border-b border-gray-300 pb-3 mb-4">
                <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-gray-900">
                  <div className="flex gap-2"><span className="font-bold w-16 shrink-0">NAME:</span><span>{patient.name.toUpperCase()}</span></div>
                  <div className="flex gap-2"><span className="font-bold w-16 shrink-0">DATE:</span><span>{date}</span></div>
                  {patient.age > 0 && <div className="flex gap-2"><span className="font-bold w-16 shrink-0">AGE:</span><span>{patient.age} YRS</span></div>}
                  {patient.contact && <div className="flex gap-2"><span className="font-bold w-16 shrink-0">MOBILE:</span><span>{patient.contact}</span></div>}
                  <div className="flex gap-2"><span className="font-bold w-16 shrink-0">REF. BY:</span><span>{(patient.referredBy || "SELF").toUpperCase()}</span></div>
                  {patient.gender && <div className="flex gap-2"><span className="font-bold w-16 shrink-0">SEX:</span><span>{patient.gender.toUpperCase()}</span></div>}
                  {patient.srNo > 0 && <div className="flex gap-2"><span className="font-bold w-16 shrink-0">SR. NO:</span><span>#{patient.srNo}</span></div>}
                </div>
              </div>

              {/* Study title */}
              <div className="text-center font-bold uppercase text-sm py-1 underline underline-offset-4 tracking-wide mb-5 text-gray-900">
                {patient.study}
              </div>

              {/* Report body */}
              <div
                ref={bodyRef}
                className="text-sm leading-relaxed text-gray-900 min-h-[200px]"
              />
            </div>
          )}
        </div>
      </div>

    </div>,
    document.body
  )
}
