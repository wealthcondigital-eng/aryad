"use client"

import { useState, useEffect, Suspense, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Plus, Trash2, IndianRupee, Printer, Loader2, CheckCircle2, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { ComboInput, StudyComboInput, getSavedDoctors, saveDoctor } from "@/components/combo-input"

const paymentModes = ["Cash", "UPI", "Card", "Cheque", "NEFT/RTGS"]

const FIELD_LABELS: Record<string, string> = {
  charges:     "Charges",
  discount:    "Discount",
  paid:        "Paid Amount",
  paymentMode: "Payment Mode",
  notes:       "Notes",
  items:       "Studies / Tests",
  referredBy:  "Referred By",
  billDate:    "Bill Date",
  patientName: "Patient Name",
}

interface BillItem { id: number; study: string; studyInput: string; price: number; qty: number }

interface EditEntry {
  editor: string
  editedAt: string
  changedFields: string[]
  previousValues: Record<string, unknown>
}

interface SavedBillData {
  billNo:      string
  patientName: string
  srNo:        number
  age:         number
  gender:      string
  contact:     string
  refDoctor:   string
  billDate:    string
  items:       BillItem[]
  subtotal:    number
  discount:    number
  paidAmount:  number
  paymentMode: string
  notes:       string
  balance:     number
  editHistory: EditEntry[]
}

function formatEditDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    })
  } catch { return iso }
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
  if (field === "billDate") {
    try { return new Date(String(value)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) }
    catch { return String(value) }
  }
  return String(value) || "—"
}

function getHistoryNewValue(
  field: string,
  editIndex: number,
  editHistory: EditEntry[],
  currentBill: Record<string, unknown>,
): unknown {
  for (let j = editIndex - 1; j >= 0; j--) {
    if (field in (editHistory[j].previousValues ?? {})) {
      return editHistory[j].previousValues[field]
    }
  }
  return currentBill[field]
}

function printReceipt(data: SavedBillData) {
  const itemRows = data.items
    .filter((i) => i.study && i.price > 0)
    .map(
      (i, idx) =>
        `<tr>
          <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx + 1}.</td>
          <td style="border:1px solid #111;padding:4px 6px;text-transform:uppercase;">${i.study}</td>
          <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${(i.price * i.qty).toLocaleString()}</td>
          <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx === 0 ? data.discount.toLocaleString() : 0}</td>
          <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${idx === 0 ? data.paidAmount.toLocaleString() : 0}</td>
        </tr>`
    )
    .join("")

  const totalCharges = data.items.filter(i => i.price > 0).reduce((s, i) => s + i.price * i.qty, 0)

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt – ${data.billNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }
    @media print { body { padding: 6mm 10mm; } }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { background: #f0f0f0; font-weight: bold; text-transform: uppercase; text-align: center; border: 1px solid #111; padding: 4px 6px; }
    .total-row td { font-weight: bold; background: #f9f9f9; }
    .footer-text { text-align: center; font-size: 9pt; color: #555; margin-top: 18px; padding-top: 10px; border-top: 1px solid #ccc; }
  </style>
</head>
<body>
  <div style="text-align:center;margin-bottom:10px;">
    <img src="/logo.jpeg" style="width:72px;height:72px;border-radius:50%;object-fit:cover;margin:0 auto 6px;display:block;" />
    <h1 style="font-size:15pt;font-weight:bold;text-transform:uppercase;letter-spacing:2px;">Aarya Diagnostic Center</h1>
    <p style="font-size:8.5pt;color:#333;line-height:1.6;">Shop no - 5, K. K. Smruti Building, New Maneklal Estate, S.N. Mehta Road, Ghatkopar (W) 400086<br>Contact no - 9819022444 &nbsp;&nbsp; aaryadiagnosticsmumbai@gmail.com</p>
  </div>

  <div style="border-top:2.5px solid #111;border-bottom:2.5px solid #111;padding:2px 0;text-align:center;font-weight:bold;font-size:9.5pt;text-transform:uppercase;letter-spacing:1px;margin:8px 0;">Payment Receipt</div>

  <div style="margin-bottom:8px;font-size:9.5pt;display:flex;justify-content:space-between;">
    <div>
      <p><strong>Name: ${data.patientName.toUpperCase()}</strong></p>
      ${data.srNo ? `<p>SR No: #${data.srNo}</p>` : ""}
      ${data.age > 0 ? `<p>Age: ${data.age} Yrs &nbsp;/&nbsp; Sex: ${data.gender.toUpperCase()}</p>` : ""}
      ${data.refDoctor ? `<p>Referred By: ${data.refDoctor}</p>` : ""}
    </div>
    <div style="text-align:right;">
      <p><strong>Bill No:</strong> ${data.billNo}</p>
      <p><strong>Date:</strong> ${new Date(data.billDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
    </div>
  </div>

  <table style="margin-bottom:8px;">
    <thead>
      <tr>
        <th style="width:40px;">Sr.<br>No.</th>
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
        <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${data.discount.toLocaleString()}</td>
        <td style="border:1px solid #111;padding:4px 6px;text-align:center;">${data.paidAmount.toLocaleString()}</td>
      </tr>
    </tbody>
  </table>

  <div style="font-size:9.5pt;">
    <p><strong>Payment Method</strong> - ${data.paymentMode.toUpperCase()}</p>
    ${Math.max(0, data.balance) > 0 ? `<p style="color:#dc2626;font-weight:bold;">Balance Due: &#8377;${Math.max(0, data.balance).toLocaleString()}</p>` : ""}
  </div>

  <div class="footer-text">Thank you for visiting Aarya Diagnostic Center</div>
</body>
</html>`

  const absoluteHtml = html.replace('src="/logo.jpeg"', `src="${window.location.origin}/logo.jpeg"`)
  const blob = new Blob([absoluteHtml], { type: "text/html" })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, "_blank", "width=620,height=900")
  if (!win) { alert("Please allow pop-ups to print."); URL.revokeObjectURL(url); return }
  win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
  setTimeout(() => win.print(), 600)
}

function NewBillingForm() {
  const params = useSearchParams()
  const router = useRouter()

  const patientIdParam = params.get("id")       ?? ""
  const nameParam      = params.get("name")     ?? ""
  const srNoParam      = parseInt(params.get("srNo") ?? "0", 10)
  const studyParam     = params.get("study")    ?? ""
  const ageParam       = parseInt(params.get("age") ?? "0", 10)
  const genderParam    = params.get("gender")   ?? ""
  const contactParam   = params.get("contact")  ?? ""
  const refByParam     = params.get("refBy")    ?? ""
  const billIdParam    = params.get("billId")   ?? ""

  const [loading,      setLoading]      = useState(false)
  const [billNo,       setBillNo]       = useState("—")
  const [patientName,  setPatientName]  = useState(nameParam)
  const [refDoctor,    setRefDoctor]    = useState(refByParam)
  const [savedDoctors, setSavedDoctors] = useState<string[]>(() => getSavedDoctors())
  const [billDate,     setBillDate]     = useState(() => new Date().toISOString().split("T")[0])
  const [notes,        setNotes]        = useState("")
  const [discount,     setDiscount]     = useState(0)
  const [paidAmount,   setPaidAmount]   = useState(0)
  const [paymentMode,  setPaymentMode]  = useState("Cash")
  const [saved,        setSaved]        = useState(false)
  const [savedBillData, setSavedBillData] = useState<SavedBillData | null>(null)

  const [items, setItems] = useState<BillItem[]>([
    { id: 1, study: studyParam, studyInput: studyParam, price: 0, qty: 1 },
  ])

  // Edit mode: snapshot of values at load time, used for live change detection
  const [originalValues, setOriginalValues] = useState<{
    patientName: string; referredBy: string; billDate: string; notes: string
    discount: number; paidAmount: number; paymentMode: string
    items: { study: string; price: number; qty: number }[]
  } | null>(null)
  const [editHistory, setEditHistory] = useState<EditEntry[]>([])

  // Fetch bill count for create mode
  useEffect(() => {
    if (billIdParam) return
    fetch("/api/billing")
      .then((r) => r.json())
      .then((d) => setBillNo(`B-${1001 + (d.bills?.length ?? 0)}`))
      .catch(() => setBillNo(srNoParam ? `B-${srNoParam}` : "B-1001"))
  }, [srNoParam, billIdParam])

  // Edit mode: fetch existing bill and snapshot for change tracking
  useEffect(() => {
    if (!billIdParam) return
    setLoading(true)
    fetch(`/api/billing/${billIdParam}`)
      .then((r) => r.json())
      .then((d) => {
        const b = d.bill
        if (!b) return

        const loadedName    = b.patientName || nameParam
        const loadedRef     = b.referredBy  || refByParam
        const loadedDate    = b.billDate    || new Date().toISOString().split("T")[0]
        const loadedNotes   = b.notes       || ""
        const loadedDisc    = b.discount    || 0
        const loadedPaid    = b.paid        || 0
        const loadedPayMode = b.paymentMode || "Cash"
        const loadedItems: BillItem[] = (b.items ?? []).map(
          (item: { study: string; quantity: number; price: number }, idx: number) => ({
            id: idx + 1, study: item.study, studyInput: item.study,
            price: item.price, qty: item.quantity,
          })
        )

        setBillNo(b.billNo || `B-${1000 + b.srNo}`)
        setPatientName(loadedName)
        setRefDoctor(loadedRef)
        setBillDate(loadedDate)
        setNotes(loadedNotes)
        setDiscount(loadedDisc)
        setPaidAmount(loadedPaid)
        setPaymentMode(loadedPayMode)
        if (loadedItems.length > 0) setItems(loadedItems)

        setOriginalValues({
          patientName: loadedName,
          referredBy:  loadedRef,
          billDate:    loadedDate,
          notes:       loadedNotes,
          discount:    loadedDisc,
          paidAmount:  loadedPaid,
          paymentMode: loadedPayMode,
          items:       loadedItems.map(i => ({ study: i.study, price: i.price, qty: i.qty })),
        })
        setEditHistory(b.editHistory ?? [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [billIdParam, nameParam, refByParam])

  // Compute which fields differ from the original snapshot (live, as user types)
  const liveChangedFields = useMemo(() => {
    if (!originalValues || !billIdParam) return new Set<string>()
    const ch = new Set<string>()
    if (patientName !== originalValues.patientName) ch.add("patientName")
    if (billDate    !== originalValues.billDate)    ch.add("billDate")
    if (refDoctor   !== originalValues.referredBy)  ch.add("referredBy")
    if (notes       !== originalValues.notes)       ch.add("notes")
    if (discount    !== originalValues.discount)    ch.add("discount")
    if (paidAmount  !== originalValues.paidAmount)  ch.add("paid")
    if (paymentMode !== originalValues.paymentMode) ch.add("paymentMode")
    const curItems  = JSON.stringify(items.map(i => ({ study: i.study, price: i.price, qty: i.qty })))
    const origItems = JSON.stringify(originalValues.items)
    if (curItems !== origItems) ch.add("items")
    return ch
  }, [originalValues, billIdParam, patientName, billDate, refDoctor, notes, discount, paidAmount, paymentMode, items])

  const patientSectionChanged = liveChangedFields.has("patientName") || liveChangedFields.has("billDate")
  const doctorSectionChanged  = liveChangedFields.has("referredBy")  || liveChangedFields.has("notes")
  const studiesSectionChanged = liveChangedFields.has("items")
  const paymentSectionChanged = liveChangedFields.has("discount") || liveChangedFields.has("paid") || liveChangedFields.has("paymentMode")

  const addItem = () =>
    setItems((prev) => [...prev, { id: Date.now(), study: "", studyInput: "", price: 0, qty: 1 }])

  const removeItem = (id: number) => {
    if (items.length === 1) return
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const updateItemStudy = (id: number, name: string, price: number) =>
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, study: name, studyInput: name, price } : i))

  const updateItemStudyInput = (id: number, val: string) =>
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, studyInput: val, study: val } : i))

  const subtotal  = items.reduce((acc, i) => acc + i.price * i.qty, 0)
  const netAmount = subtotal - discount
  const balance   = netAmount - paidAmount

  const doSave = async () => {
    if (!patientIdParam && !billIdParam) {
      alert("No patient linked. Please open this page from the patient queue.")
      return
    }
    if (!items.some((i) => i.study && i.price > 0)) {
      alert("Please add at least one study with a price.")
      return
    }
    setLoading(true)
    try {
      let res: Response
      if (billIdParam) {
        res = await fetch(`/api/billing/${billIdParam}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            editor:      "Receptionist",
            patientName: patientName || nameParam,
            referredBy:  refDoctor || refByParam || "Self",
            items:       items.map((i) => ({ study: i.study, quantity: i.qty, price: i.price })),
            charges:     subtotal,
            discount,
            paid:        paidAmount,
            paymentMode: paymentMode || "Cash",
            billDate,
            notes,
          }),
        })
      } else {
        res = await fetch("/api/billing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId:   patientIdParam,
            srNo:        srNoParam,
            patientName: patientName || nameParam,
            age:         ageParam,
            gender:      genderParam,
            contact:     contactParam,
            referredBy:  refDoctor || refByParam || "Self",
            items:       items.map((i) => ({ study: i.study, quantity: i.qty, price: i.price })),
            charges:     subtotal,
            discount,
            paid:        paidAmount,
            paymentMode: paymentMode || "Cash",
            billDate,
            notes,
          }),
        })
      }
      if (!res.ok) throw new Error("API error")
      const { bill } = await res.json()
      const savedNo = bill?.billNo || billNo
      setBillNo(savedNo)

      const newEditEntry: EditEntry = {
        editor:         "Receptionist",
        editedAt:       new Date().toISOString(),
        changedFields:  Array.from(liveChangedFields),
        previousValues: {},
      }

      const snapData: SavedBillData = {
        billNo:      savedNo,
        patientName: patientName || nameParam,
        srNo:        srNoParam,
        age:         ageParam,
        gender:      genderParam,
        contact:     contactParam,
        refDoctor:   refDoctor || refByParam || "Self",
        billDate,
        items:       [...items],
        subtotal,
        discount,
        paidAmount,
        paymentMode,
        notes,
        balance,
        editHistory: billIdParam ? [newEditEntry, ...editHistory] : [],
      }
      setSavedBillData(snapData)
      setSaved(true)
      router.push("/billing")
    } catch {
      alert("Failed to save bill. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const isEditMode = !!billIdParam
  const pageTitle  = isEditMode ? "Edit Bill" : "New Bill"

  const sectionBorderClass = (changed: boolean) =>
    changed ? "border-l-4 border-l-blue-500" : ""

  const modifiedTag = (
    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium normal-case tracking-normal leading-none">
      modified
    </span>
  )

  const changedFieldLabel = (field: string, label: string, required?: boolean) => (
    <Label className={`flex items-center gap-1.5 ${liveChangedFields.has(field) ? "text-blue-600 underline underline-offset-2 decoration-blue-400" : ""}`}>
      {label}
      {required && <span className="text-red-500">*</span>}
      {liveChangedFields.has(field) && (
        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium no-underline">
          modified
        </span>
      )}
    </Label>
  )

  const changedInputClass = (field: string) =>
    liveChangedFields.has(field) ? "border-blue-400 ring-1 ring-blue-200 focus:ring-blue-400" : ""

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/billing"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{pageTitle}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Bill No: {billNo}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditMode && liveChangedFields.size > 0 && (
            <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs">
              {liveChangedFields.size} field{liveChangedFields.size > 1 ? "s" : ""} modified
            </Badge>
          )}
          <Badge variant={saved ? "default" : "secondary"} className="text-sm">
            {saved ? "Saved" : isEditMode ? "Editing" : "Draft"}
          </Badge>
        </div>
      </div>

      {saved && (
        <div className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-green-800">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
          <span className="text-sm font-medium">Bill saved — {billNo}</span>
          <Link href="/billing" className="ml-auto text-xs text-green-700 underline underline-offset-2 hover:text-green-900">
            ← Back to Billing
          </Link>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void doSave() }} className="space-y-6">
        {/* Patient & Doctor */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className={sectionBorderClass(patientSectionChanged)}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                Patient
                {patientSectionChanged && modifiedTag}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {changedFieldLabel("patientName", "Patient Name", true)}
                {patientIdParam && !isEditMode ? (
                  <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/40 text-sm font-medium">
                    {patientName}
                    <Badge variant="secondary" className="ml-auto text-[10px]">#{srNoParam}</Badge>
                  </div>
                ) : (
                  <ComboInput
                    value={patientName}
                    onChange={setPatientName}
                    suggestions={[]}
                    placeholder="Type patient name..."
                  />
                )}
                {ageParam > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {ageParam} yrs · {genderParam} · {contactParam}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                {changedFieldLabel("billDate", "Bill Date", true)}
                <Input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  required
                  className={changedInputClass("billDate")}
                />
              </div>
            </CardContent>
          </Card>

          <Card className={sectionBorderClass(doctorSectionChanged)}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                Referring Doctor
                {doctorSectionChanged && modifiedTag}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {changedFieldLabel("referredBy", "Referred By")}
                <div onBlur={() => setSavedDoctors((prev) => saveDoctor(refDoctor, prev))}>
                  <ComboInput
                    value={refDoctor}
                    onChange={setRefDoctor}
                    suggestions={savedDoctors}
                    placeholder="Doctor name or leave blank"
                    onSelect={setRefDoctor}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">New names are saved automatically.</p>
              </div>
              <div className="space-y-2">
                {changedFieldLabel("notes", "Notes")}
                <Input
                  placeholder="Any billing notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={changedInputClass("notes")}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Studies / Tests */}
        <Card className={sectionBorderClass(studiesSectionChanged)}>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              Studies &amp; Tests
              {studiesSectionChanged && modifiedTag}
            </CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-3.5 w-3.5 mr-1" />Add Test
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
              <div className="col-span-6">Test / Study Name</div>
              <div className="col-span-2 text-center">Qty</div>
              <div className="col-span-3 text-right">Price (&#8377;)</div>
              <div className="col-span-1"></div>
            </div>

            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-12 gap-2 items-start">
                <div className="col-span-6">
                  <StudyComboInput
                    value={item.studyInput}
                    onChange={(v) => updateItemStudyInput(item.id, v)}
                    onSelect={(name, price) => updateItemStudy(item.id, name, price)}
                    placeholder="Type to search test..."
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    type="number" min={1}
                    value={item.qty}
                    onChange={(e) =>
                      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, qty: +e.target.value } : i))
                    }
                    className="text-center"
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    type="number" min={0}
                    value={item.price || ""}
                    onChange={(e) =>
                      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, price: +e.target.value } : i))
                    }
                    className="text-right"
                    placeholder="0"
                  />
                </div>
                <div className="col-span-1 flex justify-center pt-1">
                  <Button
                    type="button" variant="ghost" size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Payment */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className={sectionBorderClass(paymentSectionChanged)}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                Payment
                {paymentSectionChanged && modifiedTag}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {changedFieldLabel("paymentMode", "Payment Mode")}
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger className={changedInputClass("paymentMode")}>
                    <SelectValue placeholder="Cash / UPI / Card..." />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentModes.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                {changedFieldLabel("discount", "Discount (₹)")}
                <Input
                  type="number" min={0} placeholder="0"
                  value={discount || ""}
                  onChange={(e) => setDiscount(+e.target.value)}
                  className={changedInputClass("discount")}
                />
              </div>
              <div className="space-y-2">
                {changedFieldLabel("paid", "Paid Amount (₹)", true)}
                <Input
                  type="number" min={0} placeholder="Enter amount collected"
                  value={paidAmount || ""}
                  onChange={(e) => setPaidAmount(+e.target.value)}
                  required
                  className={changedInputClass("paid")}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-muted/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-medium">&#8377;{subtotal.toLocaleString()}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-orange-600">
                    <span>Discount</span>
                    <span>&#8722;&#8377;{discount.toLocaleString()}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-semibold text-base">
                  <span>Net Amount</span>
                  <span>&#8377;{netAmount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>Paid</span>
                  <span>&#8377;{paidAmount.toLocaleString()}</span>
                </div>
                <div className={`flex justify-between font-bold text-base ${balance > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  <span>Balance Due</span>
                  <span>&#8377;{Math.max(0, balance).toLocaleString()}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Edit History panel — shown only in edit mode when history exists */}
        {isEditMode && editHistory.length > 0 && (() => {
          const currentBill: Record<string, unknown> = {
            patientName,
            referredBy:  refDoctor,
            billDate,
            notes,
            discount,
            paid:        paidAmount,
            paymentMode,
            charges:     subtotal,
            items:       items.map((i) => ({ study: i.study, quantity: i.qty, price: i.price })),
          }
          return (
            <Card className="border-blue-200 bg-blue-50/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-blue-700 uppercase tracking-wider flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Edit History
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {editHistory.map((entry, i) => (
                    <li key={i} className="flex gap-2.5">
                      <div className="flex flex-col items-center">
                        <div className="h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                          <History className="h-2.5 w-2.5 text-blue-600" />
                        </div>
                        {i < editHistory.length - 1 && (
                          <div className="w-px flex-1 bg-blue-200 mt-1" />
                        )}
                      </div>
                      <div className="pb-2 min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-blue-800">{entry.editor}</span>
                          <span className="text-[11px] text-muted-foreground">{formatEditDate(entry.editedAt)}</span>
                        </div>
                        {entry.changedFields.length > 0 && (
                          <div className="space-y-1">
                            {entry.changedFields.map((field) => {
                              const prev = entry.previousValues?.[field]
                              const next = getHistoryNewValue(field, i, editHistory, currentBill)
                              return (
                                <div key={field} className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                  <span className="text-muted-foreground font-medium">
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
              </CardContent>
            </Card>
          )
        })()}

        <Separator />

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" asChild>
            <Link href="/billing">Cancel</Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!saved || !savedBillData}
            onClick={() => savedBillData && printReceipt(savedBillData)}
          >
            <Printer className="h-4 w-4 mr-2" />
            Print Receipt
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <IndianRupee className="h-4 w-4 mr-2" />}
            {loading ? "Saving…" : isEditMode ? "Update Bill" : "Save Bill"}
          </Button>
        </div>
      </form>
    </div>
  )
}

export default function NewBillingPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <NewBillingForm />
    </Suspense>
  )
}
