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
import { useRole } from "@/lib/role-context"
import { receiptLetterheadHtml, receiptPatientBoxHtml, receiptItemsTableHtml, ReceiptRow } from "@/lib/receipt-letterhead"

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

interface BillItem { id: number; study: string; studyInput: string; price: number; qty: number; discount: number }

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
  const rows: ReceiptRow[] = data.items
    .filter((i) => i.study && i.price > 0)
    .map((i) => ({ study: i.study, amount: i.price * i.qty, discount: i.discount || 0 }))

  const totalCharges = data.items.filter(i => i.price > 0).reduce((s, i) => s + i.price * i.qty, 0)
  const dateStr = new Date(data.billDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt – ${data.billNo}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #111; padding: 10mm 14mm; max-width: 160mm; margin: 0 auto; }
    @media print { body { padding: 6mm 10mm; } }
    .footer-text { text-align: center; font-size: 9pt; color: #555; margin-top: 18px; padding-top: 10px; border-top: 1px solid #ccc; }
  </style>
</head>
<body>
  ${receiptLetterheadHtml(typeof window !== "undefined" ? window.location.origin : "")}
  <div style="border-top:2.5px solid #111;border-bottom:2.5px solid #111;padding:2px 0;text-align:center;font-weight:bold;font-size:9.5pt;text-transform:uppercase;letter-spacing:1px;margin:8px 0;">Payment Receipt</div>

  ${receiptPatientBoxHtml({ name: data.patientName, date: dateStr, age: data.age, gender: data.gender, contact: data.contact, referredBy: data.refDoctor, srNo: data.srNo })}

  ${receiptItemsTableHtml(rows, totalCharges, data.paidAmount)}

  <div style="font-size:9.5pt;">
    <p><strong>Bill No:</strong> ${data.billNo}</p>
    <p><strong>Payment Method</strong> - ${data.paymentMode.toUpperCase()}</p>
  </div>

  <div class="footer-text">Thank you for visiting Aarya Diagnostic Center</div>
</body>
</html>`

  const blob = new Blob([html], { type: "text/html" })
  const url  = URL.createObjectURL(blob)
  const win  = window.open(url, "_blank", "width=620,height=900")
  if (!win) { alert("Please allow pop-ups to print."); URL.revokeObjectURL(url); return }
  win.onafterprint = () => { win.close(); URL.revokeObjectURL(url) }
  setTimeout(() => win.print(), 600)
}

function NewBillingForm() {
  const params = useSearchParams()
  const router = useRouter()
  const { user } = useRole()
  const editorName = user?.name || "Staff"

  const patientIdParam = params.get("id")       ?? ""
  const nameParam      = params.get("name")     ?? ""
  const srNoParam      = parseInt(params.get("srNo") ?? "0", 10)
  const studyParam     = params.get("study")    ?? ""
  const ageParam       = parseInt(params.get("age") ?? "0", 10)
  const genderParam    = params.get("gender")   ?? ""
  const contactParam   = params.get("contact")  ?? ""
  const refByParam     = params.get("refBy")    ?? ""
  const billIdParam    = params.get("billId")   ?? ""
  // sidx present → bill just that one study; absent → whole-patient bill (all studies)
  const sidxRaw        = params.get("sidx")
  const sidxParam      = sidxRaw !== null && sidxRaw !== "" ? parseInt(sidxRaw, 10) : -1

  const [loading,      setLoading]      = useState(false)
  const [billNo,       setBillNo]       = useState("—")
  const [patientName,  setPatientName]  = useState(nameParam)
  const [refDoctor,    setRefDoctor]    = useState(refByParam)
  const [savedDoctors, setSavedDoctors] = useState<string[]>(() => getSavedDoctors())
  const [billDate,     setBillDate]     = useState(() => new Date().toISOString().split("T")[0])
  const [notes,        setNotes]        = useState("")
  const [paidAmount,   setPaidAmount]   = useState(0)
  const [paymentMode,  setPaymentMode]  = useState("Cash")
  const [saved,        setSaved]        = useState(false)
  const [savedBillData, setSavedBillData] = useState<SavedBillData | null>(null)

  // Patient details — start from URL params, then prefilled from the DB so the
  // receipt always carries the full patient data without re-typing it
  const [patientId, setPatientId] = useState(patientIdParam)
  const [srNo,      setSrNo]      = useState(srNoParam)
  const [age,       setAge]       = useState(ageParam)
  const [gender,    setGender]    = useState(genderParam)
  const [contact,   setContact]   = useState(contactParam)

  const [items, setItems] = useState<BillItem[]>([
    { id: 1, study: studyParam, studyInput: studyParam, price: 0, qty: 1, discount: 0 },
  ])

  // Patient picker (when the page is opened without a patient link)
  interface PickerPatient {
    _id: string; srNo: number; name: string; age: number; gender: string
    contact: string; referredBy: string; study: string
    studies?: { name: string; billId?: string | null }[]
  }
  const [allPatients, setAllPatients] = useState<PickerPatient[]>([])

  const applyPatient = (p: PickerPatient & { referredBy?: string }) => {
    setPatientId(p._id)
    setPatientName(p.name)
    setSrNo(p.srNo || 0)
    setAge(p.age || 0)
    setGender(p.gender || "")
    setContact(p.contact || "")
    if (!refByParam) setRefDoctor(p.referredBy && p.referredBy !== "Self" ? p.referredBy : "")
    // Whole-patient bill (sidxParam < 0): list every study that isn't billed yet
    // (so a study already on another bill isn't double-charged). Single-study
    // bill: just the one at sidxParam. Falls back to the legacy single study.
    const allStudies = p.studies?.length ? p.studies : (p.study ? [{ name: p.study }] : [])
    const unbilled   = allStudies.filter((s) => !(s as { billId?: string | null }).billId)
    const names = (sidxParam >= 0 && p.studies?.[sidxParam]?.name)
      ? [p.studies[sidxParam].name]
      : (unbilled.length ? unbilled : allStudies).map((s) => s.name).filter(Boolean)
    if (names.length > 0) {
      setItems(names.map((n, i) => ({ id: i + 1, study: n, studyInput: n, price: 0, qty: 1, discount: 0 })))
      // Fill known catalogue prices for the patient's studies
      fetch("/api/studies")
        .then((r) => r.json())
        .then((d) => {
          const priceMap: Record<string, number> = Object.fromEntries(
            (d.studies || []).map((s: { name: string; price: number }) => [s.name, s.price])
          )
          setItems((prev) => prev.map((it) => ({ ...it, price: it.price || priceMap[it.study] || 0 })))
        })
        .catch(() => {})
    }
  }

  useEffect(() => {
    if (billIdParam) return
    if (patientIdParam) {
      // Prefill everything from the patient record (incl. all their studies)
      fetch(`/api/patients/${patientIdParam}`)
        .then((r) => r.json())
        .then((d) => {
          const p = d.patient
          if (!p) return
          applyPatient(p)
        })
        .catch(() => {})
    } else {
      // No patient linked — offer a picker over all registered patients
      fetch("/api/patients")
        .then((r) => r.json())
        .then((d) => setAllPatients(d.patients || []))
        .catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientIdParam, billIdParam])

  // Edit mode: snapshot of values at load time, used for live change detection
  const [originalValues, setOriginalValues] = useState<{
    patientName: string; referredBy: string; billDate: string; notes: string
    paidAmount: number; paymentMode: string
    items: { study: string; price: number; qty: number; discount: number }[]
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
        const loadedPaid    = b.paid        || 0
        const loadedPayMode = b.paymentMode || "Cash"
        const loadedItems: BillItem[] = (b.items ?? []).map(
          (item: { study: string; quantity: number; price: number; discount?: number }, idx: number) => ({
            id: idx + 1, study: item.study, studyInput: item.study,
            price: item.price, qty: item.quantity,
            // Older bills (before per-study discount existed) only have a
            // whole-bill discount and no item.discount at all — migrate that
            // onto the first item on load so editing an old bill doesn't
            // silently drop its discount to zero once re-saved.
            discount: item.discount ?? (idx === 0 ? (b.discount || 0) : 0),
          })
        )

        setBillNo(b.billNo || `B-${1000 + b.srNo}`)
        setPatientName(loadedName)
        // Patient details for the printed receipt come from the saved bill
        setPatientId(b.patientId || patientIdParam)
        setSrNo(b.srNo || srNoParam)
        setAge(b.age || ageParam)
        setGender(b.gender || genderParam)
        setContact(b.contact || contactParam)
        setRefDoctor(loadedRef)
        setBillDate(loadedDate)
        setNotes(loadedNotes)
        setPaidAmount(loadedPaid)
        setPaymentMode(loadedPayMode)
        if (loadedItems.length > 0) setItems(loadedItems)

        setOriginalValues({
          patientName: loadedName,
          referredBy:  loadedRef,
          billDate:    loadedDate,
          notes:       loadedNotes,
          paidAmount:  loadedPaid,
          paymentMode: loadedPayMode,
          items:       loadedItems.map(i => ({ study: i.study, price: i.price, qty: i.qty, discount: i.discount })),
        })
        setEditHistory(b.editHistory ?? [])

        // Studies added to the patient AFTER this bill was raised (and not
        // billed anywhere else) are pulled in as fresh line items — priced
        // from the catalogue, removable before saving — instead of staying
        // invisible on the bill forever. Deliberately added after the
        // originalValues snapshot so they register as an "items" change,
        // keeping the change-highlight and the edit history honest.
        if (b.patientId) {
          fetch(`/api/patients/${b.patientId}`)
            .then((r) => r.json())
            .then(async (pd) => {
              const studies: { name?: string; billId?: string | null }[] = pd.patient?.studies ?? []
              const onBill = new Set(loadedItems.map((i) => i.study.trim().toLowerCase()))
              const extras = studies.filter((s) =>
                s.name?.trim() &&
                !onBill.has(s.name.trim().toLowerCase()) &&
                (!s.billId || String(s.billId) === billIdParam)
              )
              if (extras.length === 0) return
              let priceMap: Record<string, number> = {}
              try {
                const sd = await fetch("/api/studies").then((r) => r.json())
                priceMap = Object.fromEntries((sd.studies || []).map((s: { name: string; price: number }) => [s.name, s.price]))
              } catch {}
              setItems((prev) => [
                ...prev,
                ...extras.map((s, i) => ({
                  id: Date.now() + i,
                  study: s.name!.trim(), studyInput: s.name!.trim(),
                  price: priceMap[s.name!.trim()] || 0, qty: 1, discount: 0,
                })),
              ])
            })
            .catch(() => {})
        }
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
    if (paidAmount  !== originalValues.paidAmount)  ch.add("paid")
    if (paymentMode !== originalValues.paymentMode) ch.add("paymentMode")
    // Discount now lives per-item, so a discount edit shows up as an items change.
    const curItems  = JSON.stringify(items.map(i => ({ study: i.study, price: i.price, qty: i.qty, discount: i.discount })))
    const origItems = JSON.stringify(originalValues.items)
    if (curItems !== origItems) ch.add("items")
    return ch
  }, [originalValues, billIdParam, patientName, billDate, refDoctor, notes, paidAmount, paymentMode, items])

  const patientSectionChanged = liveChangedFields.has("patientName") || liveChangedFields.has("billDate")
  const doctorSectionChanged  = liveChangedFields.has("referredBy")  || liveChangedFields.has("notes")
  const studiesSectionChanged = liveChangedFields.has("items")
  const paymentSectionChanged = liveChangedFields.has("paid") || liveChangedFields.has("paymentMode")

  const addItem = () =>
    setItems((prev) => [...prev, { id: Date.now(), study: "", studyInput: "", price: 0, qty: 1, discount: 0 }])

  const updateItemDiscount = (id: number, discount: number) =>
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, discount } : i))

  const removeItem = (id: number) => {
    if (items.length === 1) return
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const updateItemStudy = (id: number, name: string, price: number) =>
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, study: name, studyInput: name, price } : i))

  const updateItemStudyInput = (id: number, val: string) =>
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, studyInput: val, study: val } : i))

  const subtotal  = items.reduce((acc, i) => acc + i.price * i.qty, 0)
  const discount  = items.reduce((acc, i) => acc + (i.discount || 0), 0)
  const netAmount = subtotal - discount
  const balance   = netAmount - paidAmount

  const doSave = async () => {
    if (!patientId && !billIdParam) {
      alert("No patient linked. Please pick a patient first.")
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
            editor:      editorName,
            patientName: patientName || nameParam,
            referredBy:  refDoctor || refByParam || "Self",
            items:       items.map((i) => ({ study: i.study, quantity: i.qty, price: i.price, discount: i.discount || 0 })),
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
            patientId,
            srNo,
            patientName: patientName || nameParam,
            age,
            gender,
            contact,
            referredBy:  refDoctor || refByParam || "Self",
            items:       items.map((i) => ({ study: i.study, quantity: i.qty, price: i.price, discount: i.discount || 0 })),
            charges:     subtotal,
            discount,
            paid:        paidAmount,
            paymentMode: paymentMode || "Cash",
            billDate,
            notes,
            studyIndex:  sidxParam,
          }),
        })
      }
      if (!res.ok) throw new Error("API error")
      const { bill } = await res.json()
      const savedNo = bill?.billNo || billNo
      setBillNo(savedNo)

      const newEditEntry: EditEntry = {
        editor:         editorName,
        editedAt:       new Date().toISOString(),
        changedFields:  Array.from(liveChangedFields),
        previousValues: {},
      }

      const snapData: SavedBillData = {
        billNo:      savedNo,
        patientName: patientName || nameParam,
        srNo,
        age,
        gender,
        contact,
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
                {patientId && !isEditMode ? (
                  <div className="flex items-center gap-2 px-3 py-2 border rounded-md bg-muted/40 text-sm font-medium">
                    {patientName}
                    {srNo > 0 && <Badge variant="secondary" className="ml-auto text-[10px]">#{srNo}</Badge>}
                  </div>
                ) : (
                  <ComboInput
                    value={patientName}
                    onChange={(v) => {
                      setPatientName(v)
                      if (!isEditMode) setPatientId("")
                    }}
                    suggestions={allPatients.map((p) => `${p.name} (#${p.srNo})`)}
                    placeholder="Type to search registered patients..."
                    onSelect={(label) => {
                      const m = label.match(/^(.*) \(#(\d+)\)$/)
                      const found = m
                        ? allPatients.find((p) => p.name === m[1] && String(p.srNo) === m[2])
                        : allPatients.find((p) => p.name === label)
                      if (found) applyPatient(found)
                      else setPatientName(label)
                    }}
                  />
                )}
                {Number(age) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {age} yrs · {gender} · {contact}
                  </p>
                )}
                {!patientId && !isEditMode && (
                  <p className="text-[11px] text-amber-600">
                    Pick a registered patient — their details prefill the receipt automatically.
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
            {/* Desktop header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
              <div className="col-span-4">Test / Study Name</div>
              <div className="col-span-1 text-center">Qty</div>
              <div className="col-span-2 text-right">Price (&#8377;)</div>
              <div className="col-span-2 text-right">Discount (&#8377;)</div>
              <div className="col-span-2 text-right">Net (&#8377;)</div>
              <div className="col-span-1"></div>
            </div>

            {items.map((item) => (
              <div key={item.id}>
                {/* Desktop View */}
                <div className="hidden sm:grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-4">
                    <StudyComboInput
                      value={item.studyInput}
                      onChange={(v) => updateItemStudyInput(item.id, v)}
                      onSelect={(name, price) => updateItemStudy(item.id, name, price)}
                      placeholder="Type to search test..."
                    />
                  </div>
                  <div className="col-span-1">
                    <Input
                      type="number" min={1}
                      value={item.qty}
                      onChange={(e) =>
                        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, qty: +e.target.value } : i))
                      }
                      className="text-center"
                    />
                  </div>
                  <div className="col-span-2">
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
                  <div className="col-span-2">
                    <Input
                      type="number" min={0}
                      value={item.discount || ""}
                      onChange={(e) => updateItemDiscount(item.id, +e.target.value)}
                      className="text-right"
                      placeholder="0"
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-end pt-2 text-sm font-medium text-muted-foreground">
                    &#8377;{Math.max(0, item.price * item.qty - item.discount).toLocaleString()}
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

                {/* Mobile View */}
                <div className="flex flex-col gap-2.5 sm:hidden border-b border-gray-100 pb-4 mb-2 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-muted-foreground font-semibold uppercase">Test / Study Name</Label>
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 text-xs flex items-center gap-1"
                      onClick={() => removeItem(item.id)}
                      disabled={items.length === 1}
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </Button>
                  </div>
                  <StudyComboInput
                    value={item.studyInput}
                    onChange={(v) => updateItemStudyInput(item.id, v)}
                    onSelect={(name, price) => updateItemStudy(item.id, name, price)}
                    placeholder="Type to search test..."
                  />
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground font-semibold uppercase">Qty</Label>
                      <Input
                        type="number" min={1}
                        value={item.qty}
                        onChange={(e) =>
                          setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, qty: +e.target.value } : i))
                        }
                        className="text-center h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground font-semibold uppercase">Price (₹)</Label>
                      <Input
                        type="number" min={0}
                        value={item.price || ""}
                        onChange={(e) =>
                          setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, price: +e.target.value } : i))
                        }
                        className="text-right h-8 text-xs"
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground font-semibold uppercase">Discount (₹)</Label>
                      <Input
                        type="number" min={0}
                        value={item.discount || ""}
                        onChange={(e) => updateItemDiscount(item.id, +e.target.value)}
                        className="text-right h-8 text-xs"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-right">
                    Net: &#8377;{Math.max(0, item.price * item.qty - item.discount).toLocaleString()}
                  </p>
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
              <p className="text-[11px] text-muted-foreground -mt-1">
                Discount is set per study in the table above.
              </p>
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
            items:       items.map((i) => ({ study: i.study, quantity: i.qty, price: i.price, discount: i.discount || 0 })),
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
