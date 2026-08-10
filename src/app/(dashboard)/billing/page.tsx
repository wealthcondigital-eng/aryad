"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Plus, Search, Filter, MoreHorizontal, Printer, Pencil, History, X, Clock, Check, Eye, Share2 } from "lucide-react"
import { BillDocViewer, shareBillOnWhatsApp } from "@/components/bill-doc-viewer"
import { receiptLetterheadHtml, receiptPatientBoxHtml, receiptItemsTableHtml, ReceiptRow } from "@/lib/receipt-letterhead"
import { useRole } from "@/lib/role-context"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useConfirm, showAlert } from "@/components/confirm-dialog"

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
  editHistory: {
    editor: string
    editedAt: string
    changedFields: string[]
    previousValues: Record<string, unknown>
  }[]
  createdAt: string
}

// A patient row in the "Pending Billing" strip — every registered study that
// isn't linked to any bill yet shows here until a bill is raised for it.
interface UnbilledPatient {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  referredBy: string
  study: string
  createdAt: string
  studies?: { name: string; billId?: string | null }[]
}

function unbilledStudiesOf(p: UnbilledPatient): string[] {
  const entries = p.studies?.length ? p.studies : (p.study ? [{ name: p.study, billId: null }] : [])
  return entries.filter((s) => !s.billId && s.name).map((s) => s.name)
}

function createBillHref(p: UnbilledPatient): string {
  const params = new URLSearchParams({
    id: p._id,
    name: p.name,
    srNo: String(p.srNo),
    age: String(p.age),
    gender: p.gender,
    contact: p.contact,
    refBy: p.referredBy || "Self",
    study: p.study,
  })
  return `/billing/new?${params}`
}

function billStatus(b: BillDoc): "paid" | "partial" | "pending" {
  const net = b.charges - (b.discount ?? 0)
  if (b.paid >= net) return "paid"
  if (b.paid > 0) return "partial"
  return "pending"
}

function billNo(_b: BillDoc, index: number): string {
  return `B-${1000 + index + 1}`
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return iso
  }
}


const FIELD_LABELS: Record<string, string> = {
  patientName: "Patient Name",
  referredBy:  "Referred By",
  billDate:    "Bill Date",
  charges:     "Charges",
  discount:    "Discount",
  paid:        "Amount Paid",
  paymentMode: "Payment Mode",
  notes:       "Notes",
  items:       "Studies / Items",
}

function formatFieldValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—"
  if (field === "paid" || field === "charges" || field === "discount") {
    return `₹${Number(value).toLocaleString("en-IN")}`
  }
  if (field === "items" && Array.isArray(value)) {
    const names = (value as { study: string }[]).map((i) => i.study).filter(Boolean)
    return names.length ? names.join(", ") : "—"
  }
  if (field === "billDate") return formatDate(String(value))
  return String(value) || "—"
}

function getNewValue(
  field: string,
  editIndex: number,
  editHistory: BillDoc["editHistory"],
  bill: BillDoc,
): unknown {
  // Walk toward more-recent edits (lower indices) to find when this field was next changed
  for (let j = editIndex - 1; j >= 0; j--) {
    if (field in (editHistory[j].previousValues ?? {})) {
      return editHistory[j].previousValues[field]
    }
  }
  // No later edit touched this field — the current bill value is the result
  return (bill as unknown as Record<string, unknown>)[field]
}

function EditHistoryModal({ bill, onClose }: { bill: BillDoc; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="font-semibold text-base flex items-center gap-2">
              <History className="h-4 w-4 text-blue-500" />Edit History
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{bill.patientName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-4 py-3">
          {bill.editHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No edits recorded for this bill.</p>
          ) : (
            <ol className="space-y-3">
              {bill.editHistory.map((entry, i) => (
                <li key={i} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <Clock className="h-3 w-3 text-blue-600" />
                    </div>
                    {i < bill.editHistory.length - 1 && (
                      <div className="w-px flex-1 bg-border mt-1" />
                    )}
                  </div>
                  <div className="pb-2 min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <p className="text-xs font-semibold">{entry.editor}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDate(entry.editedAt)}</p>
                    </div>
                    {entry.changedFields.length > 0 && (
                      <div className="space-y-1">
                        {entry.changedFields.map((field) => {
                          const prev = entry.previousValues?.[field]
                          const next = getNewValue(field, i, bill.editHistory, bill)
                          return (
                            <div key={field} className="flex items-center gap-1.5 flex-wrap text-[11px]">
                              <span className="text-muted-foreground font-medium min-w-0">
                                {FIELD_LABELS[field] ?? field}:
                              </span>
                              <span className="bg-red-50 text-red-500 border border-red-200 rounded px-1.5 py-px line-through">
                                {formatFieldValue(field, prev)}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="bg-green-50 text-green-700 border border-green-200 rounded px-1.5 py-px font-medium">
                                {formatFieldValue(field, next)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}

function printBillReceipt(b: BillDoc, index: number) {
  const bNo = billNo(b, index)
  const dateStr = formatDate(b.billDate || b.createdAt)
  const rows: ReceiptRow[] = b.items.map((item) => ({ study: item.study, amount: item.price * item.quantity, discount: item.discount || 0 }))
  const totalCharges = b.items.reduce((s, i) => s + i.price * i.quantity, 0)
  const baseUrl = typeof window !== "undefined" ? window.location.origin : ""

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt – ${bNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }
    @media print { body { padding: 6mm 10mm; } }
  </style>
</head>
<body>
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
</body>
</html>`

  const blob = new Blob([html], { type: "text/html" })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, "_blank", "width=620,height=800")
  if (!win) { showAlert({ title: "Pop-up blocked", message: "Allow pop-ups for this site to print." }); URL.revokeObjectURL(url); return }
  win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
  setTimeout(() => win.print(), 600)
}

// Quick-share from the row menu: same flow as the receipt modal's WhatsApp button
function shareBillReceipt(b: BillDoc, index: number) {
  shareBillOnWhatsApp({
    id:          b._id,
    srNo:        b.srNo,
    name:        b.patientName,
    age:         b.age ?? "—",
    gender:      b.gender || "—",
    contact:     b.contact || "",
    referredBy:  b.referredBy,
    study:       b.items.map((i) => i.study).join(", "),
    items:       b.items,
    billNo:      billNo(b, index),
    charges:     b.charges,
    discount:    b.discount,
    paid:        b.paid,
    paymentMode: b.paymentMode,
    date:        (b.billDate || b.createdAt)?.split("T")[0],
  }, { forceLink: true }).catch((e) => console.error(e))
}

const statusBadgeClass: Record<string, string> = {
  paid:    "bg-green-100 text-green-700",
  partial: "bg-yellow-100 text-yellow-700",
  pending: "bg-red-100 text-red-700",
}

function BillsTable({
  data,
  allBills,
  onMarkPaid,
  onViewHistory,
  onViewBill,
}: {
  data: BillDoc[]
  allBills: BillDoc[]
  onMarkPaid: (id: string) => void
  onViewHistory: (b: BillDoc) => void
  onViewBill: (b: BillDoc, index: number) => void
}) {
  return (
    <>
      {/* Desktop view: Table */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill / Patient</TableHead>
              <TableHead>Studies</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                  No bills found.
                </TableCell>
              </TableRow>
            )}
            {data.map((b) => {
              const status = billStatus(b)
              // find original index in allBills for stable bill number
              const origIdx = allBills.findIndex((x) => x._id === b._id)
              const bNo = billNo(b, origIdx >= 0 ? origIdx : 0)
              return (
                <TableRow key={b._id}>
                  <TableCell>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-sm">{b.patientName}</p>
                        {b.editHistory.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            <Pencil className="h-2.5 w-2.5" />edited
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{bNo} · {b.referredBy || "Self"}</p>
                      {b.editHistory.length > 0 && b.editHistory[0] && (
                        <p className="text-[10px] text-blue-500 mt-0.5">
                          Last edit: {b.editHistory[0].editor} · {formatDate(b.editHistory[0].editedAt)}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {b.items.map((s, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">{s.study}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(b.billDate || b.createdAt)}
                  </TableCell>
                  <TableCell className="text-right font-medium text-sm">&#8377;{b.charges.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-sm">&#8377;{b.paid.toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{b.paymentMode || "—"}</TableCell>
                  <TableCell>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass[status]}`}>
                      {status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onViewBill(b, origIdx >= 0 ? origIdx : 0)}>
                          <Eye className="h-3.5 w-3.5 mr-2" />
                          View Bill
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/billing/new?billId=${b._id}`} className="flex items-center">
                            <Pencil className="h-3.5 w-3.5 mr-2 text-blue-500" />
                            Edit Bill
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => printBillReceipt(b, origIdx >= 0 ? origIdx : 0)}>
                          <Printer className="h-3.5 w-3.5 mr-2" />
                          Print Receipt
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => shareBillReceipt(b, origIdx >= 0 ? origIdx : 0)}>
                          <Share2 className="h-3.5 w-3.5 mr-2 text-green-600" />
                          Share WhatsApp
                        </DropdownMenuItem>
                        {b.editHistory.length > 0 && (
                          <DropdownMenuItem onClick={() => onViewHistory(b)}>
                            <History className="h-3.5 w-3.5 mr-2 text-blue-500" />
                            View Edit History
                          </DropdownMenuItem>
                        )}
                        {status !== "paid" && (
                          <DropdownMenuItem onClick={() => onMarkPaid(b._id)}>
                            Mark as Paid
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile view: Cards list */}
      <div className="block md:hidden divide-y divide-border px-4 py-1">
        {data.length === 0 && (
          <p className="text-center py-10 text-muted-foreground text-sm">No bills found.</p>
        )}
        {data.map((b) => {
          const status = billStatus(b)
          const origIdx = allBills.findIndex((x) => x._id === b._id)
          const bNo = billNo(b, origIdx >= 0 ? origIdx : 0)
          return (
            <div key={b._id} className="py-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-semibold text-sm text-slate-800">{b.patientName}</p>
                    {b.editHistory.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] bg-blue-100 text-blue-700 px-1 py-0.2 rounded font-medium">
                        edited
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {bNo} · {formatDate(b.billDate || b.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${statusBadgeClass[status]}`}>
                    {status}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onViewBill(b, origIdx >= 0 ? origIdx : 0)}>
                        <Eye className="h-3.5 w-3.5 mr-2" />
                        View Bill
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link href={`/billing/new?billId=${b._id}`} className="flex items-center">
                          <Pencil className="h-3.5 w-3.5 mr-2 text-blue-500" />
                          Edit Bill
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => printBillReceipt(b, origIdx >= 0 ? origIdx : 0)}>
                        <Printer className="h-3.5 w-3.5 mr-2" />
                        Print Receipt
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => shareBillReceipt(b, origIdx >= 0 ? origIdx : 0)}>
                        <Share2 className="h-3.5 w-3.5 mr-2 text-green-600" />
                        Share WhatsApp
                      </DropdownMenuItem>
                      {b.editHistory.length > 0 && (
                        <DropdownMenuItem onClick={() => onViewHistory(b)}>
                          <History className="h-3.5 w-3.5 mr-2 text-blue-500" />
                          View Edit History
                        </DropdownMenuItem>
                      )}
                      {status !== "paid" && (
                        <DropdownMenuItem onClick={() => onMarkPaid(b._id)}>
                          Mark as Paid
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Studies */}
              <div className="flex flex-wrap gap-1">
                {b.items.map((s, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] py-0.2 px-1.5">{s.study}</Badge>
                ))}
              </div>

              {/* Pricing details */}
              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-muted-foreground">
                  Ref: <span className="font-medium text-slate-700">{b.referredBy || "Self"}</span>
                </span>
                <div className="flex items-center gap-3">
                  <span>
                    Total: <span className="font-semibold text-slate-800">₹{b.charges.toLocaleString()}</span>
                  </span>
                  <span>
                    Paid: <span className="font-semibold text-green-600">₹{b.paid.toLocaleString()}</span>
                  </span>
                  <span className="text-slate-400">|</span>
                  <span className="text-muted-foreground text-[10px] uppercase font-medium">{b.paymentMode || "Cash"}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function BillingPage() {
  const { notify } = useConfirm()
  const { user } = useRole()
  const [bills,        setBills]       = useState<BillDoc[]>([])
  const [loading,      setLoading]     = useState(true)
  const [search,       setSearch]      = useState("")
  const [historyBill,  setHistoryBill] = useState<BillDoc | null>(null)
  const [viewBill,     setViewBill]    = useState<{ bill: BillDoc; index: number } | null>(null)
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "pending" | "partial">("all")

  const fetchBills = useCallback(() => {
    setLoading(true)
    fetch("/api/billing")
      .then((r) => r.json())
      .then((d) => setBills(d.bills ?? []))
      .catch(() => setBills([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchBills() }, [fetchBills])

  // Patients with studies not yet on any bill — surfaced here so a freshly
  // registered report shows up in Billing right away, ready to be billed.
  const [unbilled, setUnbilled] = useState<UnbilledPatient[]>([])
  useEffect(() => {
    fetch("/api/patients")
      .then((r) => r.json())
      .then((d) => {
        const pts: UnbilledPatient[] = d.patients ?? []
        setUnbilled(pts.filter((p) => unbilledStudiesOf(p).length > 0))
      })
      .catch(() => setUnbilled([]))
  }, [])

  const handleMarkPaid = async (id: string) => {
    const bill = bills.find((b) => b._id === id)
    if (!bill) return
    try {
      await fetch(`/api/billing/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editor: user?.name || "Staff", paid: bill.charges }),
      })
      fetchBills()
    } catch {
      await notify({ title: "Update failed", message: "The bill could not be updated. Please try again." })
    }
  }

  const q = search.toLowerCase()
  const filtered = bills.filter(
    (b) =>
      !q ||
      b.patientName.toLowerCase().includes(q) ||
      b.referredBy?.toLowerCase().includes(q) ||
      String(b.srNo).includes(q) ||
      b.contact?.includes(q) ||
      b.items.some((i) => i.study.toLowerCase().includes(q))
  )

  const totalBilled    = bills.reduce((s, b) => s + b.charges, 0)
  const totalCollected = bills.reduce((s, b) => s + b.paid, 0)
  const totalPending   = totalBilled - totalCollected

  const paid    = filtered.filter((b) => billStatus(b) === "paid")
  const pending = filtered.filter((b) => billStatus(b) === "pending")
  const partial = filtered.filter((b) => billStatus(b) === "partial")

  return (
    <div className="space-y-6">
      {historyBill && <EditHistoryModal bill={historyBill} onClose={() => setHistoryBill(null)} />}
      {viewBill && (
        <BillDocViewer
          open
          onClose={() => setViewBill(null)}
          id={viewBill.bill._id}
          srNo={viewBill.bill.srNo}
          name={viewBill.bill.patientName}
          age={viewBill.bill.age ?? "—"}
          gender={viewBill.bill.gender || "—"}
          contact={viewBill.bill.contact || ""}
          referredBy={viewBill.bill.referredBy}
          study={viewBill.bill.items.map((i) => i.study).join(", ")}
          items={viewBill.bill.items}
          billNo={billNo(viewBill.bill, viewBill.index)}
          charges={viewBill.bill.charges}
          discount={viewBill.bill.discount}
          paid={viewBill.bill.paid}
          paymentMode={viewBill.bill.paymentMode}
          date={(viewBill.bill.billDate || viewBill.bill.createdAt)?.split("T")[0]}
          editHistory={viewBill.bill.editHistory}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage patient bills and payments</p>
        </div>
        <Button asChild>
          <Link href="/billing/new">
            <Plus className="h-4 w-4 mr-2" />
            New Bill
          </Link>
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Billed", value: `&#8377;${totalBilled.toLocaleString()}` },
          { label: "Collected",    value: `&#8377;${totalCollected.toLocaleString()}` },
          { label: "Pending",      value: `&#8377;${totalPending.toLocaleString()}` },
          { label: "Bills Count",  value: String(bills.length) },
        ].map((s) => (
          <Card key={s.label} className="h-full">
            <CardContent className="p-4 h-full">
              {loading
                ? <Skeleton className="h-7 w-24 mb-1" />
                : <p className="text-xl font-bold" dangerouslySetInnerHTML={{ __html: s.value }} />
              }
              <p className="text-sm text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pending billing — registered studies that have no bill yet */}
      {unbilled.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              Pending Billing
            </CardTitle>
            <CardDescription>
              {unbilled.length} patient{unbilled.length !== 1 ? "s" : ""} with studies not billed yet
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 divide-y divide-amber-100">
            {unbilled.map((p) => (
              <div key={p._id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{p.name} <span className="text-xs text-muted-foreground font-normal">· #{p.srNo}</span></p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {unbilledStudiesOf(p).map((s) => (
                      <span key={s} className="text-[11px] bg-white border border-amber-200 text-amber-800 px-2 py-0.5 rounded-full">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <Button asChild size="sm" className="shrink-0 h-8 text-xs gap-1.5">
                  <Link href={createBillHref(p)}>
                    <Plus className="h-3.5 w-3.5" />Create Bill
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Bills table with tabs */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Bills</CardTitle>
              <CardDescription>{loading ? "Loading…" : `${bills.length} bills total`}</CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search bill, patient..."
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={statusFilter !== "all" ? "default" : "outline"} size="icon">
                    <Filter className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {(
                    [
                      { value: "all",     label: "All",     count: filtered.length },
                      { value: "paid",    label: "Paid",    count: paid.length },
                      { value: "pending", label: "Pending", count: pending.length },
                      { value: "partial", label: "Partial", count: partial.length },
                    ] as const
                  ).map(({ value, label, count }) => (
                    <DropdownMenuItem
                      key={value}
                      onClick={() => setStatusFilter(value)}
                      className="flex items-center justify-between cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        {statusFilter === value
                          ? <Check className="h-3.5 w-3.5" />
                          : <span className="w-3.5 inline-block" />
                        }
                        {label}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <>
              {/* Desktop skeleton */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bill / Patient</TableHead>
                      <TableHead>Studies</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...Array(6)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Skeleton className="h-4 w-32 mb-1.5" />
                          <Skeleton className="h-3 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-28 rounded-full" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Skeleton className="h-4 w-14 ml-auto" />
                        </TableCell>
                        <TableCell className="text-right">
                          <Skeleton className="h-4 w-12 ml-auto" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-14 rounded-full" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-8 w-8 rounded-md" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Mobile skeleton */}
              <div className="block md:hidden divide-y divide-border px-4 py-1">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="py-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-40" />
                    <div className="flex gap-1.5">
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3.5 w-24" />
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <BillsTable
              data={
                statusFilter === "all"     ? filtered :
                statusFilter === "paid"    ? paid :
                statusFilter === "pending" ? pending :
                partial
              }
              allBills={bills}
              onMarkPaid={handleMarkPaid}
              onViewHistory={setHistoryBill}
              onViewBill={(bill, index) => setViewBill({ bill, index })}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
