"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Plus, Search, Filter, MoreHorizontal, Printer, Pencil, History, X, Clock, Check } from "lucide-react"
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

interface BillDoc {
  _id: string
  srNo: number
  patientName: string
  referredBy: string
  items: { study: string; quantity: number; price: number }[]
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

  const itemRows = b.items
    .map(
      (item, idx) =>
        `<tr>
          <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx + 1}.</td>
          <td style="border:1px solid #111;padding:4px 6px;text-transform:uppercase;">${item.study}</td>
          <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${(item.price * item.quantity).toLocaleString()}</td>
          <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx === 0 ? (b.discount ?? 0).toLocaleString() : 0}</td>
          <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx === 0 ? b.paid.toLocaleString() : 0}</td>
        </tr>`
    )
    .join("")

  const totalCharges = b.items.reduce((s, i) => s + i.price * i.quantity, 0)

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt – ${bNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }
    @media print { body { padding: 6mm 10mm; } }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { background: #f0f0f0; font-weight: bold; text-transform: uppercase; text-align: center; border: 1px solid #111; padding: 4px 6px; }
    .total-row td { font-weight: bold; background: #f9f9f9; }
  </style>
</head>
<body>
  <div style="text-align:center;margin-bottom:10px;">
    <img src="/logo.jpeg" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 6px;display:block;" />
    <h1 style="font-size:15pt;font-weight:bold;text-transform:uppercase;letter-spacing:2px;">Aarya Diagnostic Center</h1>
    <p style="font-size:8.5pt;color:#333;line-height:1.6;">Shop no - 5, K. K. Smruti Building, New Maneklal Estate, S.N. Mehta Road, Ghatkopar (W) 400086<br>Contact no - 9819022444 &nbsp;&nbsp; aaryadiagnosticsmumbai@gmail.com</p>
  </div>

  <div style="border-top:2.5px solid #111;border-bottom:2.5px solid #111;padding:2px 0;text-align:center;font-weight:bold;font-size:9.5pt;text-transform:uppercase;letter-spacing:1px;margin:8px 0;">Payment Receipt</div>

  <div style="margin-bottom:8px;font-size:9.5pt;">
    <p><strong>Name: ${b.patientName.toUpperCase()}</strong></p>
    ${b.srNo ? `<p>SR No: #${b.srNo}</p>` : ""}
    ${b.referredBy ? `<p>Referred By: ${b.referredBy}</p>` : ""}
  </div>

  <table style="margin-bottom:8px;">
    <thead>
      <tr>
        <th style="width:50px;">Sr.<br>No.</th>
        <th>Investigation of Patient</th>
        <th style="width:70px;">Charges</th>
        <th style="width:70px;">Discount</th>
        <th style="width:70px;">Paid</th>
      </tr>
    </thead>
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
</body>
</html>`

  const absoluteHtml = html.replace('src="/logo.jpeg"', `src="${window.location.origin}/logo.jpeg"`)
  const blob = new Blob([absoluteHtml], { type: "text/html" })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, "_blank", "width=620,height=800")
  if (!win) { alert("Please allow pop-ups to print."); URL.revokeObjectURL(url); return }
  win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
  setTimeout(() => win.print(), 600)
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
}: {
  data: BillDoc[]
  allBills: BillDoc[]
  onMarkPaid: (id: string) => void
  onViewHistory: (b: BillDoc) => void
}) {
  return (
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
                    <DropdownMenuItem onClick={() => printBillReceipt(b, origIdx >= 0 ? origIdx : 0)}>
                      <Printer className="h-3.5 w-3.5 mr-2" />
                      Print Receipt
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href={`/billing/new?billId=${b._id}`}>Edit Bill</Link>
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
  )
}

export default function BillingPage() {
  const [bills,        setBills]       = useState<BillDoc[]>([])
  const [loading,      setLoading]     = useState(true)
  const [search,       setSearch]      = useState("")
  const [historyBill,  setHistoryBill] = useState<BillDoc | null>(null)
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

  const handleMarkPaid = async (id: string) => {
    const bill = bills.find((b) => b._id === id)
    if (!bill) return
    try {
      await fetch(`/api/billing/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editor: "Receptionist", paid: bill.charges }),
      })
      fetchBills()
    } catch {
      alert("Failed to update bill.")
    }
  }

  const q = search.toLowerCase()
  const filtered = bills.filter(
    (b) =>
      !q ||
      b.patientName.toLowerCase().includes(q) ||
      b.referredBy?.toLowerCase().includes(q) ||
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
            <div className="overflow-x-auto">
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
                    {/* Bill / Patient — two lines */}
                    <TableCell>
                      <Skeleton className="h-4 w-32 mb-1.5" />
                      <Skeleton className="h-3 w-24" />
                    </TableCell>
                    {/* Studies — badge pill shape */}
                    <TableCell>
                      <Skeleton className="h-5 w-28 rounded-full" />
                    </TableCell>
                    {/* Date */}
                    <TableCell>
                      <Skeleton className="h-4 w-20" />
                    </TableCell>
                    {/* Total */}
                    <TableCell className="text-right">
                      <Skeleton className="h-4 w-14 ml-auto" />
                    </TableCell>
                    {/* Paid */}
                    <TableCell className="text-right">
                      <Skeleton className="h-4 w-12 ml-auto" />
                    </TableCell>
                    {/* Mode */}
                    <TableCell>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                    {/* Status — badge pill shape */}
                    <TableCell>
                      <Skeleton className="h-5 w-14 rounded-full" />
                    </TableCell>
                    {/* Actions icon */}
                    <TableCell>
                      <Skeleton className="h-8 w-8 rounded-md" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          ) : (
            <div className="overflow-x-auto">
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
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
