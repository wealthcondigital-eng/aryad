// Shared clinic letterhead for printed / PDF receipts — the logo, clinic name,
// address and contact line, matching the printed receipt format.

import type { jsPDF } from "jspdf"

export const CLINIC_NAME = "AARYA DIAGNOSTIC CENTER"
export const CLINIC_ADDRESS =
  "Shop no - 5, K. K. Smruti Building, New Maneklal Estate, S.N. Mehta Road, Ghatkopar (W) 400086"
export const CLINIC_CONTACT_LINE =
  "Contact no - 9819022444    aaryadiagnosticsmumbai@gmail.com"

// Letterhead block for print / share HTML receipts.
export function receiptLetterheadHtml(baseUrl: string): string {
  return `<div style="text-align:center;margin-bottom:10px;">
  <img src="${baseUrl}/logo.jpeg" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 6px;display:block;" />
  <h1 style="font-size:15pt;font-weight:bold;text-transform:uppercase;letter-spacing:2px;margin:0;">Aarya Diagnostic Center</h1>
  <p style="font-size:8.5pt;color:#333;line-height:1.6;margin:0;">Shop no - 5, K. K. Smruti Building, New Maneklal Estate, S.N. Mehta Road, Ghatkopar (W) 400086<br>Contact no - 9819022444 &nbsp;&nbsp; aaryadiagnosticsmumbai@gmail.com</p>
</div>`
}

// Patient info box for receipts — same double-bordered, bold "LABEL - VALUE"
// design used on printed reports, so the receipt reads consistently with them.
export function receiptPatientBoxHtml(p: {
  name: string
  date: string
  age?: number | string
  gender?: string
  contact?: string
  referredBy?: string
  srNo?: number | string
}): string {
  return `<table style="width:100%;border-collapse:collapse;border:3px double #333;margin-bottom:10px;">
  <tr>
    <td style="padding:10px 14px;border:none;vertical-align:top;">
      <p style="margin:0 0 4px;font-weight:bold;font-size:9.5pt;">NAME - ${p.name.toUpperCase()}</p>
      <p style="margin:0 0 4px;font-weight:bold;font-size:9.5pt;">REF. BY - ${(p.referredBy || "SELF").toUpperCase()}</p>
      ${p.srNo ? `<p style="margin:0 0 4px;font-weight:bold;font-size:9.5pt;">SR. NO - #${p.srNo}</p>` : ""}
      <p style="margin:0;font-weight:bold;font-size:9.5pt;">MOBILE - ${p.contact || "—"}</p>
    </td>
    <td style="padding:10px 14px;border:none;vertical-align:top;width:34%;white-space:nowrap;">
      <p style="margin:0 0 4px;font-weight:bold;font-size:9.5pt;">DATE - ${p.date}</p>
      <p style="margin:0 0 4px;font-weight:bold;font-size:9.5pt;">AGE - ${p.age ? `${p.age} YRS` : "—"}</p>
      <p style="margin:0;font-weight:bold;font-size:9.5pt;">SEX - ${(p.gender || "—").toUpperCase()}</p>
    </td>
  </tr>
</table>`
}

export interface ReceiptRow { study: string; amount: number; discount?: number }

// Itemised charges table with a real per-study Discount column (each study
// can carry its own discount, entered on the bill form) plus a Total row, then
// a Paid summary line below — Paid is never split per study (it's simply how
// much cash was collected for the whole visit), so it's shown once rather
// than invented per row. Uses <colgroup> + inline styles on every cell (not
// CSS nth-child selectors) so column widths/alignment stay correct regardless
// of the Total row's colspan — nth-child selectors miscount cells once a
// colspan is involved, which is what caused the Total row's Charges figure to
// drift out of alignment with the rows above it.
export function receiptItemsTableHtml(rows: ReceiptRow[], charges: number, paid: number): string {
  const cell = (text: string, opts: { align?: "left" | "center"; bold?: boolean; fill?: string } = {}) => {
    const align = opts.align ?? "center"
    const weight = opts.bold ? "font-weight:bold;" : ""
    const bg = opts.fill ? `background:${opts.fill};` : ""
    return `<td style="border:1px solid #111;padding:4px 6px;text-align:${align};${weight}${bg}">${text}</td>`
  }

  const totalDiscount = rows.reduce((sum, r) => sum + (r.discount || 0), 0)
  const netTotal = charges - totalDiscount
  const factor = netTotal > 0 ? paid / netTotal : 0

  const itemRowsHtml = rows.map((r, i) => {
    const rowNet = r.amount - (r.discount || 0)
    const rowPaid = Math.round(rowNet * factor)
    return `
    <tr>
      ${cell(`${i + 1}.`)}
      ${cell(r.study.toUpperCase(), { align: "left" })}
      ${cell(r.amount.toLocaleString())}
      ${cell((r.discount || 0).toLocaleString())}
      ${cell(rowPaid.toLocaleString())}
    </tr>`
  }).join("")

  const th = (text: string) =>
    `<th style="border:1px solid #111;padding:4px 6px;background:#f0f0f0;font-weight:bold;text-transform:uppercase;text-align:center;">${text}</th>`

  return `<table style="width:100%;border-collapse:collapse;font-size:9.5pt;margin-bottom:6px;">
  <colgroup><col style="width:42px"><col><col style="width:55px"><col style="width:55px"><col style="width:55px"></colgroup>
  <thead><tr>
    ${th("Sr.<br>No.")}${th("Investigation of Patient")}${th("Charges")}${th("Discount")}${th("Paid")}
  </tr></thead>
  <tbody>${itemRowsHtml}
    <tr>
      <td colspan="2" style="border:1px solid #111;padding:4px 6px;text-align:center;font-weight:bold;background:#f9f9f9;">Total</td>
      ${cell(charges.toLocaleString(), { bold: true, fill: "#f9f9f9" })}
      ${cell(totalDiscount.toLocaleString(), { bold: true, fill: "#f9f9f9" })}
      ${cell(paid.toLocaleString(), { bold: true, fill: "#f9f9f9" })}
    </tr>
  </tbody>
</table>`
}

// jsPDF version of the same double-bordered patient info box, for the
// WhatsApp-shared receipt PDF. Returns the y position after the box.
export function drawReceiptPatientBox(doc: jsPDF, p: {
  name: string; date: string; age?: number | string; gender?: string
  contact?: string; referredBy?: string; srNo?: number | string
}, y: number): number {
  const W = 210, M = 20
  const boxH = 30

  doc.setDrawColor(60)
  doc.setLineWidth(0.5)
  doc.rect(M, y, W - 2 * M, boxH)
  doc.setLineWidth(0.2)
  doc.rect(M + 1.2, y + 1.2, W - 2 * M - 2.4, boxH - 2.4)

  doc.setTextColor(0)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9.5)

  const lx = M + 6
  doc.text(`NAME - ${p.name.toUpperCase()}`, lx, y + 7)
  doc.text(`REF. BY - ${(p.referredBy || "SELF").toUpperCase()}`, lx, y + 13)
  if (p.srNo) doc.text(`SR. NO - #${p.srNo}`, lx, y + 19)
  doc.text(`MOBILE - ${p.contact || "—"}`, lx, y + 25)

  const rx = W - M - 60
  doc.text(`DATE - ${p.date}`, rx, y + 7)
  doc.text(`AGE - ${p.age ? `${p.age} YRS` : "—"}`, rx, y + 13)
  doc.text(`SEX - ${(p.gender || "—").toUpperCase()}`, rx, y + 19)

  return y + boxH + 8
}

// Load the clinic logo as a data URL so it can be embedded in a jsPDF receipt.
export async function loadLogoDataUrl(baseUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/logo.jpeg`)
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
