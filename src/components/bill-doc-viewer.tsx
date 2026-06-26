"use client"

import { Printer, Share2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface EditEntry { editor: string; editedAt: string; changedFields: string[] }

const FIELD_LABELS: Record<string, string> = {
  charges: "Charges", discount: "Discount", paid: "Paid Amount",
  paymentMode: "Payment Mode", notes: "Notes", items: "Studies / Tests",
  referredBy: "Referred By", billDate: "Bill Date", patientName: "Patient Name",
}

export interface BillViewerProps {
  open: boolean
  onClose: () => void
  srNo: number | string
  name: string
  age: number | string
  gender: string
  contact: string
  referredBy?: string
  study: string
  charges: number
  discount?: number
  paid: number
  paymentMode?: string
  date?: string
  editHistory?: EditEntry[]
}

const ADC_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="90" height="90">
  <circle cx="60" cy="60" r="57" fill="white" stroke="#1a1a2e" stroke-width="2.5"/>
  <circle cx="60" cy="60" r="52" fill="none" stroke="#1a1a2e" stroke-width="1"/>
  <path id="topArc" d="M 10,60 A 50,50 0 0,1 110,60" fill="none"/>
  <text font-family="Arial, sans-serif" font-size="7.5" font-weight="bold" fill="#1a1a2e" letter-spacing="1.2">
    <textPath href="#topArc" startOffset="3%">AARYA DIAGNOSTIC CENTRE</textPath>
  </text>
  <path id="botArc" d="M 16,68 A 50,50 0 0,0 104,68" fill="none"/>
  <text font-family="Arial, sans-serif" font-size="6" fill="#1a1a2e" letter-spacing="0.8">
    <textPath href="#botArc" startOffset="12%">GHATKOPAR (W), MUMBAI</textPath>
  </text>
  <g transform="translate(60,57)">
    <ellipse cx="0" cy="-16" rx="3.5" ry="9" fill="#1a1a2e" opacity="0.85" transform="rotate(0)"/>
    <ellipse cx="0" cy="-16" rx="3.5" ry="9" fill="#1a1a2e" opacity="0.85" transform="rotate(45)"/>
    <ellipse cx="0" cy="-16" rx="3.5" ry="9" fill="#1a1a2e" opacity="0.85" transform="rotate(90)"/>
    <ellipse cx="0" cy="-16" rx="3.5" ry="9" fill="#1a1a2e" opacity="0.85" transform="rotate(135)"/>
    <ellipse cx="0" cy="-16" rx="3.5" ry="9" fill="#1a1a2e" opacity="0.85" transform="rotate(180)"/>
    <ellipse cx="0" cy="-16" rx="3.5" ry="9" fill="#1a1a2e" opacity="0.85" transform="rotate(225)"/>
    <ellipse cx="0" cy="-16" rx="3.5" ry="9" fill="#1a1a2e" opacity="0.85" transform="rotate(270)"/>
    <ellipse cx="0" cy="-16" rx="3.5" ry="9" fill="#1a1a2e" opacity="0.85" transform="rotate(315)"/>
    <circle cx="0" cy="0" r="8" fill="white"/>
    <circle cx="0" cy="0" r="3" fill="#1a1a2e"/>
  </g>
  <text x="60" y="82" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="#1a1a2e" letter-spacing="2">ADC</text>
  <line x1="28" y1="74" x2="47" y2="74" stroke="#1a1a2e" stroke-width="0.8"/>
  <line x1="73" y1="74" x2="92" y2="74" stroke="#1a1a2e" stroke-width="0.8"/>
</svg>`

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
  const editHistory = p.editHistory ?? []
  const dateStr     = formatDate(p.date)

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Payment Receipt – ${p.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }

    .header { text-align: center; margin-bottom: 10px; }
    .header svg { display: block; margin: 0 auto 6px; }
    .header h1 { font-size: 15pt; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 4px; }
    .header .addr { font-size: 8.5pt; color: #333; line-height: 1.6; }

    .divider-thick { border-top: 2.5px solid #111; border-bottom: 2.5px solid #111; padding: 2px 0; text-align: center; font-weight: bold; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 1px; margin: 8px 0; }

    .patient-info { margin-bottom: 8px; font-size: 9.5pt; }
    .patient-info p { margin-bottom: 2px; }
    .patient-info strong { text-transform: uppercase; }

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

  <div class="header">
    <img src="/logo.jpeg" alt="Aarya" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 6px;" />
    <h1>Aarya Diagnostic Center</h1>
    <div class="addr">
      Shop no - 5, K. K. Smruti Building, New Maneklal Estate, S.N. Mehta Road, Ghatkopar (W) 400086<br>
      Contact no - 9819022444 &nbsp;&nbsp;&nbsp; Email ID: - aaryadiagnosticsmumbai@gmail.com
    </div>
  </div>

  <div class="divider-thick">Payment Receipt</div>

  <div class="patient-info">
    <p><strong>Name: ${p.name.toUpperCase()}</strong></p>
    <p>Age: ${p.age} Yrs &nbsp;/&nbsp; Sex: ${p.gender.toUpperCase()}</p>
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
    <tbody>
      <tr>
        <td>1.</td>
        <td>${p.study.toUpperCase()}</td>
        <td>${p.charges}</td>
        <td>${discount}</td>
        <td>${p.paid}</td>
      </tr>
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
    <p><strong>Payment Receipt.</strong> ${p.srNo}</p>
  </div>


</body>
</html>`
}

function printBill(props: BillViewerProps) {
  const html = buildBillPrintHtml(props).replace('src="/logo.jpeg"', `src="${window.location.origin}/logo.jpeg"`)
  const blob = new Blob([html], { type: "text/html" })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, "_blank", "width=620,height=800")
  if (!win) { alert("Please allow pop-ups to print."); URL.revokeObjectURL(url); return }
  win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
  setTimeout(() => win.print(), 600)
}

export function BillDocViewer(props: BillViewerProps) {
  const { open, onClose, srNo, name, age, gender, contact, referredBy, study, charges, paid, paymentMode } = props
  const discount    = props.discount ?? 0
  const editHistory = props.editHistory ?? []
  const dateStr     = formatDate(props.date)

  const shareOnWhatsApp = () => {
    const msg = `*Aarya Diagnostic Center*%0APayment Receipt No. ${srNo}%0A%0APatient: ${name}%0AStudy: ${study}%0ADate: ${dateStr}%0ACharges: ₹${charges}%0APaid: ₹${paid}%0APayment: ${paymentMode || "Cash"}%0A%0AThank you for visiting Aarya Diagnostic Center!`
    window.open(`https://wa.me/91${contact.replace(/\D/g, "")}?text=${msg}`, "_blank")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col p-0 mx-2 sm:mx-auto">
        <DialogHeader className="px-5 pt-4 pb-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-base">Payment Receipt</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{name} · Receipt #{srNo}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => printBill(props)}>
                <Printer className="h-3.5 w-3.5" />Print
              </Button>
              <Button size="sm" className="gap-1.5 text-xs h-8 bg-green-600 hover:bg-green-700" onClick={shareOnWhatsApp}>
                <Share2 className="h-3.5 w-3.5" />WhatsApp
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Preview matching exact print layout */}
          <div className="border border-slate-200 rounded-lg p-4 bg-white text-[11px] font-[Arial,sans-serif]">

            {/* Header */}
            <div className="text-center mb-3">
              <div className="flex justify-center mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.jpeg" alt="Aarya Logo" className="h-16 w-16 rounded-full object-cover" />
              </div>
              <p className="font-bold text-sm uppercase tracking-widest">Aarya Diagnostic Center</p>
              <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">
                Shop no - 5, K. K. Smruti Building, New Maneklal Estate,<br />
                S.N. Mehta Road, Ghatkopar (W) 400086<br />
                Contact no - 9819022444 &nbsp;·&nbsp; aaryadiagnosticsmumbai@gmail.com
              </p>
            </div>

            {/* PAYMENT RECEIPT label */}
            <div className="border-t-2 border-b-2 border-slate-800 py-0.5 text-center font-bold uppercase tracking-wider text-[11px] mb-3">
              Payment Receipt
            </div>

            {/* Patient info */}
            <div className="mb-3 space-y-0.5">
              <p><strong>Name:</strong> {name.toUpperCase()}</p>
              <p><strong>Age:</strong> {age} Yrs &nbsp;/&nbsp; <strong>Sex:</strong> {gender.toUpperCase()}</p>
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
                <tr>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">1.</td>
                  <td className="border border-slate-400 px-1.5 py-1 uppercase">{study}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{charges}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{discount}</td>
                  <td className="border border-slate-400 px-1.5 py-1 text-center">{paid}</td>
                </tr>
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
              <p><strong>Payment Receipt.</strong> {srNo}</p>
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
