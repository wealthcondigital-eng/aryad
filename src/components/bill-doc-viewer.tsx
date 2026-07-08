"use client"

import { Printer, Share2, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useState } from "react"

interface EditEntry { editor: string; editedAt: string; changedFields: string[] }

const FIELD_LABELS: Record<string, string> = {
  charges: "Charges", discount: "Discount", paid: "Paid Amount",
  paymentMode: "Payment Mode", notes: "Notes", items: "Studies / Tests",
  referredBy: "Referred By", billDate: "Bill Date", patientName: "Patient Name",
}

export interface BillViewerProps {
  id?: string
  open: boolean
  onClose: () => void
  srNo: number | string
  name: string
  age: number | string
  gender: string
  contact: string
  referredBy?: string
  study: string
  items?: { study: string; quantity?: number; price?: number }[]  // multi-item bills
  billNo?: string                                                  // receipt number (falls back to srNo)
  charges: number
  discount?: number
  paid: number
  paymentMode?: string
  date?: string
  editHistory?: EditEntry[]
}

// One table row per bill item; single-study callers fall back to one row
function billRows(p: BillViewerProps): { study: string; amount: number }[] {
  if (p.items?.length) {
    return p.items.map((i) => ({ study: i.study, amount: (i.price ?? 0) * (i.quantity ?? 1) }))
  }
  return [{ study: p.study, amount: p.charges }]
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
  const discount    = p.discount ?? 0
  const dateStr     = formatDate(p.date)
  const receiptNo   = p.billNo ?? String(p.srNo)
  const rows        = billRows(p)

  const itemRowsHtml = rows.map((r, i) => `
      <tr>
        <td>${i + 1}.</td>
        <td>${r.study.toUpperCase()}</td>
        <td>${r.amount}</td>
        <td>${i === 0 ? discount : 0}</td>
        <td>${i === 0 ? p.paid : 0}</td>
      </tr>`).join("")

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment Receipt – ${p.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }

    .divider-thick { border-top: 2.5px solid #111; border-bottom: 2.5px solid #111; padding: 2px 0; text-align: center; font-weight: bold; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 1px; margin: 8px 0; }

    .patient-info { margin-bottom: 8px; font-size: 8.5pt; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; border-bottom: 1.5px solid #111; padding-bottom: 6px; }
    .patient-info div { margin-bottom: 1px; }
    .patient-info strong { font-weight: bold; }

    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 8px; }
    table th, table td { border: 1px solid #111; padding: 4px 6px; }
    table thead th { font-weight: bold; text-transform: uppercase; text-align: center; background: #f0f0f0; }
    table th:nth-child(1), table td:nth-child(1) { width: 50px; text-align: center; }
    table th:nth-child(3), table td:nth-child(3),
    table th:nth-child(4), table td:nth-child(4),
    table th:nth-child(5), table td:nth-child(5) { width: 70px; text-align: center; }
    .total-row td { font-weight: bold; background: #f9f9f9; }

    .footer { font-size: 9.5pt; margin-top: 4px; }
    .footer p { margin-bottom: 3px; }
    .footer strong { font-weight: bold; }

    @media print { body { padding: 6mm 10mm; } }
  </style>
</head>
<body>

  <!-- No clinic letterhead — receipts print on pre-printed stationery -->
  <div class="divider-thick">Payment Receipt</div>

  <div class="patient-info">
    <div><strong>NAME:</strong> ${p.name.toUpperCase()}</div>
    <div><strong>DATE:</strong> ${dateStr}</div>
    <div><strong>AGE / SEX:</strong> ${p.age} YRS &nbsp;/&nbsp; ${p.gender.toUpperCase()}</div>
    <div><strong>MOBILE:</strong> ${p.contact}</div>
    <div><strong>REF. BY:</strong> ${(p.referredBy || "Self").toUpperCase()}</div>
    <div><strong>SR. NO:</strong> #${p.srNo}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Sr.<br>No.</th>
        <th>Investigation of Patient</th>
        <th>Charges</th>
        <th>Discount</th>
        <th>Paid</th>
      </tr>
    </thead>
    <tbody>${itemRowsHtml}
      <tr class="total-row">
        <td colspan="2" style="text-align:center;">Total</td>
        <td>${p.charges}</td>
        <td>${discount}</td>
        <td>${p.paid}</td>
      </tr>
    </tbody>
  </table>

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

const generateBillPdfBlob = async (p: BillViewerProps): Promise<Blob> => {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const W = 210, M = 20, CW = W - M * 2
  let y = 18

  const ln = (pt: number) => pt * 0.352778 * 1.4

  // Draw title
  doc.setFont("helvetica", "bold")
  doc.setFontSize(14)
  doc.text("PAYMENT RECEIPT", W / 2, y, { align: "center" })
  y += 8

  // Draw line
  doc.setLineWidth(0.5)
  doc.line(M, y, W - M, y)
  y += 6

  // Draw Patient Info Grid
  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  
  const col1X = M
  const col2X = W / 2 + 5
  const rowH = 6

  const dateStr = formatDate(p.date)
  const receiptNo = p.billNo || String(p.srNo)

  // Row 1
  doc.setFont("helvetica", "bold"); doc.text("NAME:", col1X, y); doc.setFont("helvetica", "normal"); doc.text(p.name.toUpperCase(), col1X + 16, y)
  doc.setFont("helvetica", "bold"); doc.text("DATE:", col2X, y); doc.setFont("helvetica", "normal"); doc.text(dateStr, col2X + 16, y)
  y += rowH

  // Row 2
  doc.setFont("helvetica", "bold"); doc.text("AGE/SEX:", col1X, y); doc.setFont("helvetica", "normal"); doc.text(`${p.age} YRS / ${p.gender.toUpperCase()}`, col1X + 18, y)
  doc.setFont("helvetica", "bold"); doc.text("MOBILE:", col2X, y); doc.setFont("helvetica", "normal"); doc.text(p.contact, col2X + 18, y)
  y += rowH

  // Row 3
  doc.setFont("helvetica", "bold"); doc.text("REF. BY:", col1X, y); doc.setFont("helvetica", "normal"); doc.text((p.referredBy || "Self").toUpperCase(), col1X + 18, y)
  doc.setFont("helvetica", "bold"); doc.text("SR. NO:", col2X, y); doc.setFont("helvetica", "normal"); doc.text(`#${p.srNo}`, col2X + 16, y)
  y += rowH + 2

  // Draw line
  doc.line(M, y, W - M, y)
  y += 8

  // Draw Items Table
  const cols = [
    { name: "Sr.", w: 12, align: "center" },
    { name: "Investigation of Patient", w: 83, align: "left" },
    { name: "Charges", w: 25, align: "center" },
    { name: "Discount", w: 25, align: "center" },
    { name: "Paid", w: 25, align: "center" }
  ]

  // Draw table header
  doc.setFont("helvetica", "bold")
  let curX = M
  cols.forEach(col => {
    doc.text(col.name, curX + (col.align === "center" ? col.w / 2 : 0), y, { align: col.align as any })
    curX += col.w
  })
  y += 4
  doc.line(M, y, W - M, y)
  y += 6

  // Draw table rows
  doc.setFont("helvetica", "normal")
  const rows = billRows(p)
  const discount = p.discount ?? 0

  rows.forEach((r, i) => {
    curX = M
    // Sr No
    doc.text(`${i + 1}`, curX + cols[0].w / 2, y, { align: "center" })
    curX += cols[0].w

    // Investigation
    doc.text(r.study.toUpperCase(), curX, y)
    curX += cols[1].w

    // Charges
    doc.text(`${r.amount}`, curX + cols[2].w / 2, y, { align: "center" })
    curX += cols[2].w

    // Discount
    doc.text(`${i === 0 ? discount : 0}`, curX + cols[3].w / 2, y, { align: "center" })
    curX += cols[3].w

    // Paid
    doc.text(`${i === 0 ? p.paid : 0}`, curX + cols[4].w / 2, y, { align: "center" })
    y += rowH
  })

  doc.line(M, y, W - M, y)
  y += 6

  // Draw Total Row
  doc.setFont("helvetica", "bold")
  curX = M + cols[0].w
  doc.text("Total", curX, y)
  curX += cols[1].w

  doc.text(`${p.charges}`, curX + cols[2].w / 2, y, { align: "center" })
  curX += cols[2].w

  doc.text(`${discount}`, curX + cols[3].w / 2, y, { align: "center" })
  curX += cols[3].w

  doc.text(`${p.paid}`, curX + cols[4].w / 2, y, { align: "center" })
  y += rowH + 2

  doc.line(M, y, W - M, y)
  y += 8

  // Draw Footer
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text(`Payment Method: ${(p.paymentMode || "Cash").toUpperCase()}`, M, y)
  y += 5
  doc.text(`Receipt Number: ${receiptNo}`, M, y)

  return doc.output("blob")
}

export function BillDocViewer(props: BillViewerProps) {
  const { open, onClose, srNo, name, age, gender, contact, referredBy, study, charges, paid, paymentMode } = props
  const discount    = props.discount ?? 0
  const editHistory = props.editHistory ?? []
  const dateStr     = formatDate(props.date)
  const receiptNo   = props.billNo ?? String(srNo)
  const rows        = billRows(props)

  const [sharing, setSharing] = useState(false)

  const shareOnWhatsApp = async () => {
    if (sharing) return
    setSharing(true)
    try {
      const pdfBlob = await generateBillPdfBlob(props)

      // 1. Mobile Share (Direct PDF attachment)
      if (navigator.share && navigator.canShare) {
        const file = new File([pdfBlob], `Receipt_${name.replace(/\s+/g, "_")}.pdf`, { type: "application/pdf" })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: `Payment Receipt - ${name}`,
            text: `Dear ${name}, here is your payment receipt from Aarya Diagnostic Center.`,
          })
          setSharing(false)
          return
        }
      }

      // 2. Desktop Share (Web Link via wa.me)
      if (props.id) {
        const arrayBuf = await pdfBlob.arrayBuffer()
        const bytes    = new Uint8Array(arrayBuf)
        let binary = ""; bytes.forEach((b) => (binary += String.fromCharCode(b)))
        const base64   = btoa(binary)

        await fetch(`/api/billing/${props.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billPdf: base64, editor: "System" }),
        })

        const pdfUrl = `${window.location.origin}/api/billing/${props.id}/pdf`
        const msg = `Dear ${name},\n\nYour payment receipt for *${study}* from *Aarya Diagnostic Center* is ready.\n\n📄 Download Receipt:\n${pdfUrl}`
        window.open(`https://wa.me/91${contact.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`, "_blank")
      } else {
        const msg = `*Aarya Diagnostic Center*%0APayment Receipt No. ${receiptNo}%0A%0APatient: ${name}%0AStudy: ${study}%0ADate: ${dateStr}%0ACharges: ₹${charges}%0APaid: ₹${paid}%0APayment: ${paymentMode || "Cash"}%0A%0AThank you for visiting Aarya Diagnostic Center!`
        window.open(`https://wa.me/91${contact.replace(/\D/g, "")}?text=${msg}`, "_blank")
      }
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
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => printBill(props)}>
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

            {/* No clinic letterhead — receipts print on pre-printed stationery */}
            {/* PAYMENT RECEIPT label */}
            <div className="border-t-2 border-b-2 border-slate-800 py-0.5 text-center font-bold uppercase tracking-wider text-[11px] mb-3">
              Payment Receipt
            </div>

            {/* Patient info */}
            <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 text-slate-800 border-b border-slate-200 pb-3" style={{ fontSize: "10px" }}>
              <div className="flex gap-1.5"><span className="font-bold w-16 shrink-0">NAME:</span><span className="text-slate-700">{name.toUpperCase()}</span></div>
              <div className="flex gap-1.5"><span className="font-bold w-16 shrink-0">DATE:</span><span className="text-slate-700">{dateStr}</span></div>
              <div className="flex gap-1.5"><span className="font-bold w-16 shrink-0">AGE / SEX:</span><span className="text-slate-700">{age} YRS / {gender.toUpperCase()}</span></div>
              <div className="flex gap-1.5"><span className="font-bold w-16 shrink-0">MOBILE:</span><span className="text-slate-700">{contact}</span></div>
              <div className="flex gap-1.5"><span className="font-bold w-16 shrink-0">REF. BY:</span><span className="text-slate-700">{(referredBy || "Self").toUpperCase()}</span></div>
              <div className="flex gap-1.5"><span className="font-bold w-16 shrink-0">SR. NO:</span><span className="text-slate-700">#{srNo}</span></div>
            </div>

            {/* Table */}
            <table className="w-full border-collapse mb-3" style={{ fontSize: "10px" }}>
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-400 px-1.5 py-1 text-center font-bold uppercase w-8">Sr. No.</th>
                  <th className="border border-slate-400 px-1.5 py-1 font-bold uppercase">Investigation of Patient</th>
                  <th className="border border-slate-400 px-1.5 py-1 text-center font-bold uppercase w-14">Charges</th>
                  <th className="border border-slate-400 px-1.5 py-1 text-center font-bold uppercase w-14">Discount</th>
                  <th className="border border-slate-400 px-1.5 py-1 text-center font-bold uppercase w-12">Paid</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{i + 1}.</td>
                    <td className="border border-slate-400 px-1.5 py-1 uppercase">{r.study}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{r.amount}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{i === 0 ? discount : 0}</td>
                    <td className="border border-slate-400 px-1.5 py-1 text-center">{i === 0 ? paid : 0}</td>
                  </tr>
                ))}
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
