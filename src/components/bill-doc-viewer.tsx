"use client"

import { Printer, Share2, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"
import { receiptLetterheadHtml, receiptPatientBoxHtml, receiptItemsTableHtml, drawReceiptPatientBox, loadLogoDataUrl, CLINIC_ADDRESS, CLINIC_CONTACT_LINE } from "@/lib/receipt-letterhead"

interface EditEntry { editor: string; editedAt: string; changedFields: string[] }

const FIELD_LABELS: Record<string, string> = {
  charges: "Charges", discount: "Discount", paid: "Paid Amount",
  paymentMode: "Payment Mode", notes: "Notes", items: "Studies / Tests",
  referredBy: "Referred By", billDate: "Bill Date", patientName: "Patient Name",
}

export interface BillShareData {
  id?: string
  srNo: number | string
  name: string
  age: number | string
  gender: string
  contact: string
  referredBy?: string
  study: string
  items?: { study: string; quantity?: number; price?: number; discount?: number }[]  // multi-item bills
  billNo?: string                                                  // receipt number (falls back to srNo)
  charges: number
  discount?: number
  paid: number
  paymentMode?: string
  date?: string
  editHistory?: EditEntry[]
}

export interface BillViewerProps extends BillShareData {
  open: boolean
  onClose: () => void
}

// One table row per bill item; single-study callers fall back to one row
// (using the bill-level discount for that lone row, since there's only one
// study for it to belong to).
function billRows(p: BillShareData): { study: string; amount: number; discount: number }[] {
  if (p.items?.length) {
    return p.items.map((i) => ({ study: i.study, amount: (i.price ?? 0) * (i.quantity ?? 1), discount: i.discount ?? 0 }))
  }
  return [{ study: p.study, amount: p.charges, discount: p.discount ?? 0 }]
}

function formatDate(d?: string) {
  if (!d) {
    const n = new Date()
    return `${String(n.getDate()).padStart(2,"0")}/${String(n.getMonth()+1).padStart(2,"0")}/${n.getFullYear()}`
  }
  // convert YYYY-MM-DD to DD/MM/YYYY
  const parts = d.split("-")
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`
  return d
}

function formatEditDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    })
  } catch { return iso }
}

function buildBillPrintHtml(p: BillViewerProps): string {
  const dateStr     = formatDate(p.date)
  const receiptNo   = p.billNo ?? String(p.srNo)
  const rows        = billRows(p)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment Receipt – ${p.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }
    .divider-thick { border-top: 2.5px solid #111; border-bottom: 2.5px solid #111; padding: 2px 0; text-align: center; font-weight: bold; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 1px; margin: 8px 0; }
    .footer { font-size: 9.5pt; margin-top: 4px; }
    .footer p { margin-bottom: 3px; }
    .footer strong { font-weight: bold; }
    @media print { body { padding: 6mm 10mm; } }
  </style>
</head>
<body>

  ${receiptLetterheadHtml(typeof window !== "undefined" ? window.location.origin : "")}
  <div class="divider-thick">Payment Receipt</div>

  ${receiptPatientBoxHtml({ name: p.name, date: dateStr, age: p.age, gender: p.gender, contact: p.contact, referredBy: p.referredBy, srNo: p.srNo })}

  ${receiptItemsTableHtml(rows, p.charges, p.paid)}

  <div class="footer">
    <p><strong>Date:</strong> ${dateStr}</p>
    <p><strong>Payment Method</strong> - ${(p.paymentMode || "Cash").toUpperCase()}</p>
    <p><strong>Payment Receipt.</strong> ${receiptNo}</p>
  </div>


</body>
</html>`
}

function printBill(props: BillViewerProps) {
  const html = buildBillPrintHtml(props)
  const blob = new Blob([html], { type: "text/html" })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, "_blank", "width=620,height=800")
  if (!win) { alert("Please allow pop-ups to print."); URL.revokeObjectURL(url); return }
  setTimeout(() => win.print(), 600)
}

// Draws the same layout as the on-screen preview / print HTML:
// title between two thick rules, patient-info grid, fully bordered table
// with shaded header and total rows, then the Date / Payment Method / Receipt footer.
const generateBillPdfBlob = async (p: BillShareData): Promise<Blob> => {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const W = 210, M = 20

  const dateStr   = formatDate(p.date)
  const receiptNo = p.billNo || String(p.srNo)
  const rows      = billRows(p)
  const discount  = rows.reduce((sum, r) => sum + r.discount, 0)

  let y = 14
  doc.setDrawColor(17, 17, 17)
  doc.setTextColor(17, 17, 17)

  // ── Clinic letterhead (logo, name, address) ──
  const logo = await loadLogoDataUrl(typeof window !== "undefined" ? window.location.origin : "")
  if (logo) {
    try { doc.addImage(logo, "JPEG", W / 2 - 9, y, 18, 18) } catch { /* ignore bad image */ }
    y += 20
  }
  doc.setFont("helvetica", "bold")
  doc.setFontSize(15)
  doc.text("AARYA DIAGNOSTIC CENTER", W / 2, y, { align: "center" })
  y += 5
  doc.setFont("helvetica", "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(60)
  doc.text(CLINIC_ADDRESS, W / 2, y, { align: "center" })
  y += 4
  doc.text(CLINIC_CONTACT_LINE, W / 2, y, { align: "center" })
  y += 6
  doc.setTextColor(17, 17, 17)

  // ── Title between two thick rules ──
  doc.setLineWidth(0.7)
  doc.line(M, y, W - M, y)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11.5)
  doc.text("PAYMENT RECEIPT", W / 2, y + 5.7, { align: "center", charSpace: 0.5 })
  doc.line(M, y + 8.2, W - M, y + 8.2)
  y += 17

  // ── Patient info box — double border, matches the printed report design ──
  y = drawReceiptPatientBox(doc, {
    name: p.name, date: dateStr, age: p.age, gender: p.gender,
    contact: p.contact, referredBy: p.referredBy, srNo: p.srNo,
  }, y)

  // ── Bordered table matching the print layout ──
  // Discount and Paid are shown in the columns.
  const colW  = [12, 78, 26, 27, 27] // sums to the 170mm content width
  const rowH  = 8
  const cellX = (i: number) => M + colW.slice(0, i).reduce((a, b) => a + b, 0)

  type Cell = { text: string; span?: number; align?: "center" | "left" }
  const drawTableRow = (cells: Cell[], opts: { bold?: boolean; fillGray?: number } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal")
    let ci = 0
    for (const cell of cells) {
      const span = cell.span ?? 1
      const x = cellX(ci)
      const w = colW.slice(ci, ci + span).reduce((a, b) => a + b, 0)
      if (opts.fillGray !== undefined) {
        doc.setFillColor(opts.fillGray, opts.fillGray, opts.fillGray)
        doc.rect(x, y, w, rowH, "FD")
      } else {
        doc.rect(x, y, w, rowH, "S")
      }
      const ty = y + rowH / 2 + 1.3
      if ((cell.align ?? "center") === "center") {
        doc.text(cell.text, x + w / 2, ty, { align: "center" })
      } else {
        doc.text(cell.text, x + 2.5, ty)
      }
      ci += span
    }
    y += rowH
  }

  doc.setLineWidth(0.25)
  doc.setFontSize(9)
  drawTableRow([
    { text: "SR. NO." },
    { text: "INVESTIGATION OF PATIENT" },
    { text: "CHARGES" },
    { text: "DISCOUNT" },
    { text: "PAID" },
  ], { bold: true, fillGray: 240 })

  const netTotal = p.charges - discount
  const factor = netTotal > 0 ? p.paid / netTotal : 0

  rows.forEach((r, i) => {
    const rowNet = r.amount - (r.discount || 0)
    const rowPaid = Math.round(rowNet * factor)
    drawTableRow([
      { text: `${i + 1}.` },
      { text: r.study.toUpperCase(), align: "left" },
      { text: `${r.amount}` },
      { text: `${r.discount}` },
      { text: `${rowPaid}` },
    ])
  })

  drawTableRow([
    { text: "Total", span: 2 },
    { text: `${p.charges}` },
    { text: `${discount}` },
    { text: `${p.paid}` },
  ], { bold: true, fillGray: 249 })
  y += 8

  // ── Footer — Balance Due and Paid summary omitted because Paid is inside the table ──
  doc.setFontSize(9.5)
  const footer = (label: string, value: string) => {
    doc.setFont("helvetica", "bold")
    doc.text(label, M, y)
    const lw = doc.getTextWidth(label)
    doc.setFont("helvetica", "normal")
    doc.text(value, M + lw + 1.5, y)
    y += 5
  }
  footer("Date:", dateStr)
  footer("Payment Method -", (p.paymentMode || "Cash").toUpperCase())
  footer("Payment Receipt.", receiptNo)

  return doc.output("blob")
}

// Shared by the receipt modal and the billing page row menu: generates the
// receipt PDF, stores it on the bill (minting the pretty /name-receipt/pdf
// slug), then opens WhatsApp with the download link.
export async function shareBillOnWhatsApp(p: BillShareData, opts: { forceLink?: boolean } = {}): Promise<void> {
  const pdfBlob = await generateBillPdfBlob(p)

  // 1. Native Share (Direct PDF attachment) — skipped when the caller
  // wants the wa.me link flow (e.g. the billing row quick-share)
  if (!opts.forceLink && navigator.share && navigator.canShare) {
    const file = new File([pdfBlob], `Receipt_${p.name.replace(/\s+/g, "_")}.pdf`, { type: "application/pdf" })
    if (navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `Payment Receipt - ${p.name}`,
        text: `Dear ${p.name}, here is your payment receipt from Aarya Diagnostic Center.`,
      })
      return
    }
  }

  const num = (p.contact || "").replace(/\D/g, "")

  // 2. Desktop Share (Web Link via wa.me)
  if (p.id) {
    const arrayBuf = await pdfBlob.arrayBuffer()
    const bytes    = new Uint8Array(arrayBuf)
    let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)))
    const base64   = btoa(binary)

    const res = await fetch(`/api/billing/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billPdf: base64, editor: "System" }),
    })

    // Prefer the pretty public link (/sagar-dutta-receipt/pdf); fall back to the id URL
    let pdfUrl = `${window.location.origin}/api/billing/${p.id}/pdf`
    try {
      const data = await res.json()
      if (data?.bill?.billSlug) pdfUrl = `${window.location.origin}/${data.bill.billSlug}/pdf`
    } catch { /* keep fallback URL */ }

    const msg = `Dear ${p.name},\n\nYour payment receipt for *${p.study}* from *Aarya Diagnostic Center* is ready.\n\n📄 Download Receipt:\n${pdfUrl}`
    // forceLink (billing row quick-share): open WhatsApp Web on the logged-in
    // account with the message ready, letting the sender pick the recipient
    const waUrl = !opts.forceLink && num
      ? `https://wa.me/91${num}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`
    window.open(waUrl, "_blank")
  } else {
    const receiptNo = p.billNo ?? String(p.srNo)
    const dateStr   = formatDate(p.date)
    const msg = `*Aarya Diagnostic Center*%0APayment Receipt No. ${receiptNo}%0A%0APatient: ${p.name}%0AStudy: ${p.study}%0ADate: ${dateStr}%0ACharges: ₹${p.charges}%0APaid: ₹${p.paid}%0APayment: ${p.paymentMode || "Cash"}%0A%0AThank you for visiting Aarya Diagnostic Center!`
    window.open(`https://wa.me/91${num}?text=${msg}`, "_blank")
  }
}

export function BillDocViewer(props: BillViewerProps) {
  const { open, onClose, srNo, name, age, gender, contact, referredBy, charges, paid, paymentMode } = props

  // Callers that only know the bill id (e.g. patient list "Print Bill") don't
  // pass the line items — fetch them so a multi-study bill itemises each study.
  const [loadedItems, setLoadedItems] = useState<BillShareData["items"] | null>(null)
  useEffect(() => {
    if (!open || !props.id || props.items?.length) { setLoadedItems(null); return }
    let cancelled = false
    fetch(`/api/billing/${props.id}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.bill?.items?.length) setLoadedItems(d.bill.items) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, props.id, props.items])

  const data: BillViewerProps = props.items?.length ? props : { ...props, items: loadedItems ?? undefined }

  const editHistory = props.editHistory ?? []
  const dateStr     = formatDate(props.date)
  const receiptNo   = props.billNo ?? String(srNo)
  const rows        = billRows(data)
  const discount    = rows.reduce((sum, r) => sum + r.discount, 0)

  const [sharing, setSharing] = useState(false)

  const shareOnWhatsApp = async () => {
    if (sharing) return
    setSharing(true)
    try {
      await shareBillOnWhatsApp(data)
    } catch (e) {
      console.error(e)
    }
    setSharing(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col p-0 mx-2 sm:mx-auto">
        <DialogHeader className="pl-5 pr-12 pt-4 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base">Payment Receipt</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{name} · Receipt #{srNo}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => printBill(data)}>
                <Printer className="h-3.5 w-3.5" />Print
              </Button>
              <Button size="sm" className="gap-1.5 text-xs h-8 bg-green-600 hover:bg-green-700" onClick={shareOnWhatsApp} disabled={sharing}>
                {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                {sharing ? "Sharing..." : "WhatsApp"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Preview matching exact print layout */}
          <div className="border border-slate-200 rounded-lg p-4 bg-white text-[11px] font-[Arial,sans-serif]">

            {/* Clinic letterhead — logo, name, address, contact */}
            <div className="text-center mb-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.jpeg" alt="Aarya Diagnostic Center" className="w-14 h-14 rounded-full object-cover mx-auto mb-1.5" />
              <h1 className="text-[15px] font-bold uppercase tracking-[2px] text-slate-900">Aarya Diagnostic Center</h1>
              <p className="text-[8.5px] text-slate-600 leading-relaxed mt-0.5">
                {CLINIC_ADDRESS}<br />{CLINIC_CONTACT_LINE}
              </p>
            </div>

            {/* PAYMENT RECEIPT label */}
            <div className="border-t-2 border-b-2 border-slate-800 py-0.5 text-center font-bold uppercase tracking-wider text-[11px] mb-3">
              Payment Receipt
            </div>

            {/* Patient info */}
            <div className="mb-3 border-4 border-double border-slate-700 px-3 py-2.5 flex justify-between gap-4 text-slate-900" style={{ fontSize: "10px" }}>
              <div className="space-y-1 min-w-0">
                <p className="font-bold truncate">NAME - {name.toUpperCase()}</p>
                <p className="font-bold truncate">REF. BY - {(referredBy || "Self").toUpperCase()}</p>
                {Number(srNo) > 0 && <p className="font-bold">SR. NO - #{srNo}</p>}
                <p className="font-bold">MOBILE - {contact}</p>
              </div>
              <div className="space-y-1 shrink-0 whitespace-nowrap">
                <p className="font-bold">DATE - {dateStr}</p>
                <p className="font-bold">AGE - {age} YRS</p>
                <p className="font-bold">SEX - {gender.toUpperCase()}</p>
              </div>
            </div>

            {/* Table — Discount is real per-study data; Paid stays a summary
                line below since it's never split per study (just how much
                cash was collected for the whole visit). */}
            <table className="w-full border-collapse mb-1.5" style={{ fontSize: "10px" }}>
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 px-1.5 py-1 text-center font-bold uppercase w-8">Sr. No.</th>
                  <th className="border border-slate-400 px-1.5 py-1 font-bold uppercase">Investigation of Patient</th>
                  <th className="border border-slate-400 px-1.5 py-1 text-center font-bold uppercase w-14">Charges</th>
                  <th className="border border-slate-400 px-1.5 py-1 text-center font-bold uppercase w-14">Discount</th>
                  <th className="border border-slate-400 px-1.5 py-1 text-center font-bold uppercase w-14">Paid</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const netTotal = charges - discount
                  const factor = netTotal > 0 ? paid / netTotal : 0
                  return rows.map((r, i) => {
                    const rowNet = r.amount - r.discount
                    const rowPaid = Math.round(rowNet * factor)
                    return (
                      <tr key={i}>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">{i + 1}.</td>
                        <td className="border border-slate-400 px-1.5 py-1 uppercase">{r.study}</td>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">{r.amount}</td>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">{r.discount}</td>
                        <td className="border border-slate-400 px-1.5 py-1 text-center">{rowPaid}</td>
                      </tr>
                    )
                  })
                })()}
                <tr className="font-bold bg-slate-50">
                  <td className="border border-slate-400 px-1.5 py-1 text-center" colSpan={2}>Total</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{charges}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{discount}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{paid}</td>
                </tr>
              </tbody>
            </table>

            {/* Footer */}
            <div className="space-y-0.5">
              <p><strong>Date:</strong> {dateStr}</p>
              <p><strong>Payment Method</strong> - {(paymentMode || "Cash").toUpperCase()}</p>
              <p><strong>Payment Receipt.</strong> {receiptNo}</p>
            </div>

            {/* Edit History */}
            {editHistory.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide mb-2">Edit History</p>
                <div className="space-y-2">
                  {editHistory.map((entry, i) => (
                    <div key={i} className="border-l-2 border-blue-300 pl-2 text-[10px]">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="font-semibold text-blue-800">{entry.editor}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500">{formatEditDate(entry.editedAt)}</span>
                      </div>
                      {entry.changedFields.length > 0 && (
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {entry.changedFields.map(f => (
                            <span key={f} className="bg-blue-100 text-blue-700 px-1 py-0.5 rounded text-[9px] font-medium">
                              {FIELD_LABELS[f] || f}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
