"use client"

import { useState, useEffect, Fragment } from "react"
import Link from "next/link"
import {
  UserPlus, Search, MoreHorizontal, Phone, MapPin,
  ClipboardEdit, Eye, Share2, MessageCircle, CheckCircle2,
  Clock, AlertCircle, Printer, Loader2, History,
  X, Pencil, User, CalendarDays, FileText, Receipt,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRole } from "@/lib/role-context"
import { ReportViewModal } from "@/components/report-view-modal"
import { motion } from "motion/react"
import { BillDocViewer } from "@/components/bill-doc-viewer"
import { ComboInput, StudyComboInput, INITIAL_DOCTORS, getSavedDoctors, saveDoctor } from "@/components/combo-input"

interface RegistrationEditEntry {
  editor: string
  editedAt: string
  changedFields: string[]
  previousValues: Record<string, unknown>
}

interface PatientDoc {
  _id: string
  srNo: number
  name: string
  age: number
  gender: string
  contact: string
  address: string
  referredBy: string
  study: string
  reportStatus: "pending" | "in_progress" | "completed"
  charges: number
  paid: number
  discount: number
  paymentMode: string
  billId?: string
  registrationEditHistory?: RegistrationEditEntry[]
  createdAt: string
}

const PATIENT_FIELD_LABELS: Record<string, string> = {
  name:       "Full Name",
  age:        "Age",
  gender:     "Gender",
  contact:    "Contact No.",
  address:    "Address",
  referredBy: "Referred By",
  study:      "Study / Test",
}

function monthOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
}
function dateOf(d: string) {
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}
function dateTimeOf(d: string) {
  try {
    return new Date(d).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    })
  } catch { return d }
}
function isToday(d: string) {
  const now = new Date(); const date = new Date(d)
  return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
}

function ReportStatusBadge({ status }: { status: string }) {
  if (status === "completed")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700"><CheckCircle2 className="h-3 w-3" />Done</span>
  if (status === "in_progress")
    return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700"><Clock className="h-3 w-3" />In Progress</span>
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600"><AlertCircle className="h-3 w-3" />Pending</span>
}

function buildFillHref(p: PatientDoc, mode: "fill" | "edit" = "fill") {
  const params = new URLSearchParams({
    patient: p.name, study: p.study, refBy: p.referredBy || "Self",
    date: dateOf(p.createdAt), age: String(p.age), gender: p.gender,
    srNo: String(p.srNo), contact: p.contact, id: p._id,
    ...(mode === "edit" ? { load: "1" } : {}),
  })
  return `/reports/new?${params}`
}

// ─── View Patient Modal ───────────────────────────────────────────────────────

function ViewPatientModal({
  patient,
  onClose,
  onEdit,
}: {
  patient: PatientDoc
  onClose: () => void
  onEdit: () => void
}) {
  const editCount = patient.registrationEditHistory?.length ?? 0
  const lastEdit  = patient.registrationEditHistory?.[0]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-base">Patient Details</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5">
          {/* Avatar + name row */}
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
              {patient.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-base">{patient.name}</p>
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">#{patient.srNo}</span>
                {editCount > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                    <Pencil className="h-2.5 w-2.5" />Edited {editCount}×
                  </span>
                )}
              </div>
              {lastEdit && (
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Last edited by {lastEdit.editor} · {dateTimeOf(lastEdit.editedAt)}
                </p>
              )}
            </div>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Age</p>
              <p className="font-medium">{patient.age} yrs</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Gender</p>
              <p className="font-medium capitalize">{patient.gender}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Contact</p>
              <p className="font-medium">{patient.contact}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Address</p>
              <p className="font-medium">{patient.address || <span className="text-muted-foreground">—</span>}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Study / Test</p>
              <p className="font-medium">{patient.study}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Referred By</p>
              <p className="font-medium">{patient.referredBy || "Self"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Registered On</p>
              <p className="font-medium">{dateOf(patient.createdAt)}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button size="sm" className="gap-1.5" onClick={() => { onClose(); onEdit() }}>
            <Pencil className="h-3.5 w-3.5" />Edit Patient
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Patient Modal ───────────────────────────────────────────────────────

function EditPatientModal({
  patient,
  editorName,
  extraDoctors = [],
  onClose,
  onSaved,
}: {
  patient: PatientDoc
  editorName: string
  extraDoctors?: string[]
  onClose: () => void
  onSaved: (updated: PatientDoc) => void
}) {
  const [name,         setName]       = useState(patient.name)
  const [age,          setAge]        = useState(String(patient.age))
  const [gender,       setGender]     = useState(patient.gender)
  const [contact,      setContact]    = useState(patient.contact)
  const [address,      setAddress]    = useState(patient.address || "")
  const [referredBy,   setReferredBy] = useState(patient.referredBy || "")
  const [study,        setStudy]      = useState(patient.study)
  const [loading,      setLoading]    = useState(false)
  const [error,        setError]      = useState("")
  const [savedDoctors, setSavedDoctors] = useState<string[]>(() =>
    Array.from(new Set([...INITIAL_DOCTORS, ...extraDoctors]))
  )

  useEffect(() => {
    setSavedDoctors(Array.from(new Set([...getSavedDoctors(), ...extraDoctors])))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Detect which fields changed
  const changedFields = [
    name.trim()       !== patient.name.trim()              && "name",
    age               !== String(patient.age)              && "age",
    gender            !== patient.gender                   && "gender",
    contact.trim()    !== patient.contact.trim()           && "contact",
    address.trim()    !== (patient.address || "").trim()   && "address",
    referredBy.trim() !== (patient.referredBy || "").trim() && "referredBy",
    study             !== patient.study                    && "study",
  ].filter(Boolean) as string[]

  const hasChanges = changedFields.length > 0

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasChanges) { onClose(); return }
    setLoading(true)
    setError("")

    const previousValues: Record<string, unknown> = {}
    changedFields.forEach((f) => {
      previousValues[f] = patient[f as keyof PatientDoc]
    })

    const updateFields: Record<string, unknown> = {}
    if (changedFields.includes("name"))       updateFields.name       = name.trim()
    if (changedFields.includes("age"))        updateFields.age        = Number(age)
    if (changedFields.includes("gender"))     updateFields.gender     = gender
    if (changedFields.includes("contact"))    updateFields.contact    = contact.trim()
    if (changedFields.includes("address"))    updateFields.address    = address.trim()
    if (changedFields.includes("referredBy")) updateFields.referredBy = referredBy.trim() || "Self"
    if (changedFields.includes("study"))      updateFields.study      = study

    const registrationEditHistoryEntry = {
      editor:         editorName,
      editedAt:       new Date().toISOString(),
      changedFields,
      previousValues,
    }

    try {
      const res = await fetch(`/api/patients/${patient._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...updateFields, registrationEditHistoryEntry }),
      })
      if (!res.ok) throw new Error("Failed to update patient")
      const { patient: updated } = await res.json()
      setSavedDoctors((prev) => saveDoctor(referredBy, prev))
      onSaved(updated)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="font-semibold text-base flex items-center gap-2">
              <Pencil className="h-4 w-4 text-blue-500" />Edit Patient
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{patient.name} · #{patient.srNo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">

            {/* Changed fields indicator */}
            {hasChanges && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
                <span className="text-xs font-medium text-blue-700">{changedFields.length} change{changedFields.length !== 1 ? "s" : ""} detected:</span>
                {changedFields.map((f) => (
                  <span key={f} className="text-[11px] bg-blue-100 text-blue-800 border border-blue-300 rounded px-1.5 py-0.5 font-medium">
                    {PATIENT_FIELD_LABELS[f] ?? f}
                  </span>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Full Name <span className="text-red-500">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Patient full name"
                className={changedFields.includes("name") ? "border-blue-400 ring-1 ring-blue-200" : ""}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Age <span className="text-red-500">*</span></Label>
                <Input
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  type="number" min={0} max={120} required
                  className={changedFields.includes("age") ? "border-blue-400 ring-1 ring-blue-200" : ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Gender <span className="text-red-500">*</span></Label>
                <Select value={gender} onValueChange={setGender} required>
                  <SelectTrigger className={changedFields.includes("gender") ? "border-blue-400 ring-1 ring-blue-200" : ""}>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Contact No. <span className="text-red-500">*</span></Label>
                <Input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  type="tel" maxLength={10} required
                  className={changedFields.includes("contact") ? "border-blue-400 ring-1 ring-blue-200" : ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Optional"
                  className={changedFields.includes("address") ? "border-blue-400 ring-1 ring-blue-200" : ""}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Study / Test <span className="text-red-500">*</span></Label>
              <div className={changedFields.includes("study") ? "rounded-md ring-1 ring-blue-200 border border-blue-400" : ""}>
                <StudyComboInput value={study} onChange={setStudy} onSelect={setStudy} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Referred By</Label>
              <div className={changedFields.includes("referredBy") ? "rounded-md ring-1 ring-blue-200 border border-blue-400" : ""}>
                <ComboInput
                  value={referredBy}
                  onChange={setReferredBy}
                  suggestions={savedDoctors}
                  placeholder="Doctor name or leave blank for Self"
                  onSelect={(v) => { setReferredBy(v); setSavedDoctors((prev) => saveDoctor(v, prev)) }}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t shrink-0">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              size="sm"
              disabled={!name || !age || !gender || !contact || !study || loading}
              className="bg-blue-600 hover:bg-blue-700 gap-1.5 min-w-[120px]"
            >
              {loading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving...</>
              ) : hasChanges ? (
                <><CheckCircle2 className="h-3.5 w-3.5" />Save Changes</>
              ) : "No Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Patient Edit History Modal ───────────────────────────────────────────────

function PatientEditHistoryModal({
  patient,
  onClose,
}: {
  patient: PatientDoc
  onClose: () => void
}) {
  const history = patient.registrationEditHistory ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="font-semibold text-base flex items-center gap-2">
              <History className="h-4 w-4 text-blue-500" />Edit History
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{patient.name} · #{patient.srNo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No edits recorded for this patient.</p>
          ) : (
            <ol className="space-y-4">
              {history.map((entry, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-7 w-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <Clock className="h-3.5 w-3.5 text-blue-600" />
                    </div>
                    {i < history.length - 1 && (
                      <div className="w-px flex-1 bg-border mt-1" />
                    )}
                  </div>
                  <div className="pb-4 min-w-0 flex-1">
                    <p className="text-sm font-medium">{entry.editor}</p>
                    <p className="text-xs text-muted-foreground">{dateTimeOf(entry.editedAt)}</p>
                    {entry.changedFields.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Changed fields</p>
                        <div className="flex flex-wrap gap-1">
                          {entry.changedFields.map((f) => (
                            <span key={f} className="text-[11px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5 font-medium">
                              {PATIENT_FIELD_LABELS[f] ?? f}
                            </span>
                          ))}
                        </div>
                        {/* Previous values */}
                        <div className="mt-1.5 space-y-0.5">
                          {entry.changedFields.map((f) => (
                            entry.previousValues[f] !== undefined && (
                              <p key={f} className="text-[11px] text-muted-foreground">
                                <span className="font-medium text-foreground/70">{PATIENT_FIELD_LABELS[f] ?? f}:</span>{" "}
                                <span className="line-through">{String(entry.previousValues[f])}</span>
                              </p>
                            )
                          ))}
                        </div>
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

// ─── Doctor view ─────────────────────────────────────────────────────────────

function DoctorPatientsView() {
  const [activeTab,    setActiveTab]    = useState<"queue" | "history">("queue")
  const [todayPats,    setTodayPats]    = useState<PatientDoc[]>([])
  const [allPats,      setAllPats]      = useState<PatientDoc[]>([])
  const [loadingToday, setLoadingToday] = useState(true)
  const [loadingAll,   setLoadingAll]   = useState(false)
  const [search,   setSearch]   = useState("")
  const [viewing,  setViewing]  = useState<PatientDoc | null>(null)

  useEffect(() => {
    fetch("/api/patients?date=today")
      .then((r) => r.json())
      .then((d) => setTodayPats(d.patients || []))
      .catch(() => {})
      .finally(() => setLoadingToday(false))
  }, [])

  useEffect(() => {
    if (activeTab === "history" && allPats.length === 0) {
      setLoadingAll(true)
      fetch("/api/patients")
        .then((r) => r.json())
        .then((d) => setAllPats(d.patients || []))
        .catch(() => {})
        .finally(() => setLoadingAll(false))
    }
  }, [activeTab, allPats.length])

  // Pre-fill search from ?q= param (set by global header search)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")
    if (q) {
      setSearch(q)
      setActiveTab("history")
    }
  }, [])

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })

  const queueFiltered = todayPats.filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  )
  const historyFiltered = allPats.filter((p) =>
    !search ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.study.toLowerCase().includes(search.toLowerCase()) ||
    `${p.srNo}`.includes(search)
  )

  return (
    <>
    {viewing && <ReportViewModal patient={viewing} onClose={() => setViewing(null)} />}

    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Patients</h1>
        <p className="text-sm text-muted-foreground">{today}</p>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 bg-muted/40 rounded-lg p-1 w-fit">
        <button
          onClick={() => { setActiveTab("queue"); setSearch("") }}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === "queue" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Today&apos;s Queue
          {!loadingToday && <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">{todayPats.length}</span>}
        </button>
        <button
          onClick={() => { setActiveTab("history"); setSearch("") }}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${activeTab === "history" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <History className="h-3.5 w-3.5" />Patient History
        </button>
      </div>

      {/* ── TODAY'S QUEUE ── */}
      {activeTab === "queue" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Total Today", value: todayPats.length,                                              border: "border-l-blue-500"  },
              { label: "Pending",     value: todayPats.filter((p) => p.reportStatus !== "completed").length, border: "border-l-slate-400" },
              { label: "Completed",   value: todayPats.filter((p) => p.reportStatus === "completed").length, border: "border-l-green-500" },
            ].map(({ label, value, border }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.07, duration: 0.3 }}
              >
                <Card className={`border-l-4 ${border} h-full`}>
                  <CardContent className="p-4 h-full">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                    {loadingToday ? <Skeleton className="h-8 w-12 mt-1" /> : <p className="text-2xl font-bold mt-1">{value}</p>}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <CardTitle className="text-base">Patient Queue</CardTitle>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search patient..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingToday ? (
                <div className="px-4 pb-2">
                  <div className="flex items-center gap-3 py-3 border-b border-border/60 mb-1">
                    <Skeleton className="h-3 w-5" />
                    <Skeleton className="h-3 w-28" />
                    <Skeleton className="h-3 w-24 hidden sm:block" />
                    <Skeleton className="h-3 w-20 hidden sm:block" />
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-3 w-20 ml-auto" />
                  </div>
                  {[...Array(6)].map((_, i) => (
                    <motion.div
                      key={i}
                      className="flex items-center gap-3 py-3 border-b border-border/40 last:border-0"
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.25, ease: "easeOut" }}
                    >
                      <Skeleton className="h-4 w-5" />
                      <div className="flex items-center gap-2 flex-1">
                        <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-28" />
                          <Skeleton className="h-3 w-20" />
                        </div>
                      </div>
                      <Skeleton className="h-4 w-28 hidden sm:block" />
                      <Skeleton className="h-4 w-20 hidden sm:block" />
                      <Skeleton className="h-5 w-16 rounded-full" />
                      <Skeleton className="h-7 w-24 rounded-lg ml-auto" />
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Patient</TableHead>
                      <TableHead>Study</TableHead>
                      <TableHead className="hidden sm:table-cell">Referred By</TableHead>
                      <TableHead>Report</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queueFiltered.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                          No patients registered today yet.
                        </TableCell>
                      </TableRow>
                    )}
                    {queueFiltered.map((p, i) => (
                      <TableRow key={p._id} className="hover:bg-muted/20">
                        <TableCell className="text-xs font-mono text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-xs font-semibold text-purple-700 shrink-0">
                              {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{p.name}</p>
                              <p className="text-xs text-muted-foreground">#{p.srNo} · {p.age}y · {p.gender[0]}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.study}</TableCell>
                        <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">{p.referredBy || "Self"}</TableCell>
                        <TableCell><ReportStatusBadge status={p.reportStatus} /></TableCell>
                        <TableCell className="text-right">
                          {p.reportStatus === "completed" ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <Button variant="outline" size="sm" className="h-7 text-xs gap-1"
                                onClick={() => setViewing(p)}>
                                <Eye className="h-3 w-3" />View
                              </Button>
                              <Button asChild variant="outline" size="sm" className="h-7 text-xs gap-1">
                                <Link href={buildFillHref(p, "edit")}>
                                  <ClipboardEdit className="h-3 w-3" />Edit
                                </Link>
                              </Button>
                              <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700"
                                onClick={() => window.open(`https://wa.me/91${p.contact}?text=Dear+${encodeURIComponent(p.name)},+your+report+from+Aarya+Diagnostics+Center+is+ready.`)}>
                                <MessageCircle className="h-3 w-3" />Share
                              </Button>
                            </div>
                          ) : (
                            <Button asChild size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700">
                              <Link href={buildFillHref(p)}>
                                <ClipboardEdit className="h-3 w-3" />
                                {p.reportStatus === "in_progress" ? "Continue" : "Fill Report"}
                              </Link>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ── PATIENT HISTORY ── */}
      {activeTab === "history" && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Patient History</CardTitle>
                <CardDescription>{loadingAll ? "Loading..." : `${historyFiltered.length} patients`}</CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Name or study..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loadingAll ? (
              <div className="px-4 pb-2">
                <div className="flex items-center gap-3 py-3 border-b border-border/60 mb-1">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-24 hidden sm:block" />
                  <Skeleton className="h-3 w-20 hidden sm:block" />
                  <Skeleton className="h-3 w-16 hidden md:block" />
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-3 w-16 ml-auto" />
                </div>
                {[...Array(7)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="flex items-center gap-3 py-3 border-b border-border/40 last:border-0"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06, duration: 0.25, ease: "easeOut" }}
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                    <Skeleton className="h-4 w-28 hidden sm:block" />
                    <Skeleton className="h-4 w-24 hidden sm:block" />
                    <Skeleton className="h-4 w-16 hidden md:block" />
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-7 w-20 rounded-lg ml-auto" />
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient</TableHead>
                    <TableHead>Study</TableHead>
                    <TableHead className="hidden sm:table-cell">Referred By</TableHead>
                    <TableHead className="hidden md:table-cell">Date</TableHead>
                    <TableHead>Report</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyFiltered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                        No patients found.
                      </TableCell>
                    </TableRow>
                  )}
                  {historyFiltered.map((p) => (
                    <TableRow key={p._id} className="hover:bg-muted/20">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600 shrink-0">
                            {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{p.name}</p>
                            <p className="text-xs text-muted-foreground">#{p.srNo} · {p.age}y · {p.gender[0]}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.study}</TableCell>
                      <TableCell className="text-sm text-muted-foreground hidden sm:table-cell">{p.referredBy || "Self"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground hidden md:table-cell">{dateOf(p.createdAt)}</TableCell>
                      <TableCell><ReportStatusBadge status={p.reportStatus} /></TableCell>
                      <TableCell className="text-right">
                        {p.reportStatus === "completed" ? (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setViewing(p)}>
                            <Eye className="h-3 w-3" />View
                          </Button>
                        ) : (
                          <Button asChild size="sm" className="h-7 text-xs gap-1 bg-blue-600 hover:bg-blue-700">
                            <Link href={buildFillHref(p)}>
                              <ClipboardEdit className="h-3 w-3" />Fill Report
                            </Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
    </>
  )
}

// ─── Receptionist / Admin view ────────────────────────────────────────────────

function AllPatientsView({ canCreate, canEdit }: { canCreate: boolean; canEdit: boolean }) {
  const { user } = useRole()
  const [patients,       setPatients]      = useState<PatientDoc[]>([])
  const [loading,        setLoading]       = useState(true)
  const [viewReport,     setViewReport]    = useState<PatientDoc | null>(null)
  const [viewBill,       setViewBill]      = useState<PatientDoc | null>(null)
  const [viewingPatient, setViewingPatient] = useState<PatientDoc | null>(null)
  const [editingPatient, setEditingPatient] = useState<PatientDoc | null>(null)
  const [historyPatient, setHistoryPatient] = useState<PatientDoc | null>(null)
  const [search,         setSearch]        = useState("")
  const [monthFilter,    setMonthFilter]   = useState("All Months")

  useEffect(() => {
    fetch("/api/patients")
      .then((r) => r.json())
      .then((data) => setPatients(data.patients || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Pre-fill search from ?q= param (set by global header search)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")
    if (q) setSearch(q)
  }, [])

  const handlePatientSaved = (updated: PatientDoc) => {
    setPatients((prev) => prev.map((p) => p._id === updated._id ? { ...p, ...updated } : p))
  }

  const uniqueMonths = Array.from(new Set(patients.map((p) => monthOf(p.createdAt))))
  const MONTHS = ["All Months", ...uniqueMonths]

  const filtered = patients.filter((p) => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      `${p.srNo}`.includes(search) ||
      p.contact.includes(search)
    const matchMonth = monthFilter === "All Months" || monthOf(p.createdAt) === monthFilter
    return matchSearch && matchMonth
  })

  const todayCount = patients.filter((p) => isToday(p.createdAt)).length
  const thisMonth  = patients.filter((p) => monthOf(p.createdAt) === monthOf(new Date().toISOString())).length

  // Group filtered patients by date, newest first
  const groupedByDate = filtered
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .reduce<{ date: string; label: string; list: PatientDoc[] }[]>((groups, p) => {
      const d = dateOf(p.createdAt)
      const last = groups[groups.length - 1]
      if (last?.date === d) { last.list.push(p); return groups }
      const now  = new Date(); const pd = new Date(p.createdAt)
      const yest = new Date(now); yest.setDate(now.getDate() - 1)
      const label =
        pd.toDateString() === now.toDateString()  ? `Today · ${d}` :
        pd.toDateString() === yest.toDateString() ? `Yesterday · ${d}` : d
      groups.push({ date: d, label, list: [p] })
      return groups
    }, [])

  return (
    <div className="space-y-6">
      {/* Modals */}
      {viewReport    && <ReportViewModal patient={viewReport} onClose={() => setViewReport(null)} />}
      {viewingPatient && (
        <ViewPatientModal
          patient={viewingPatient}
          onClose={() => setViewingPatient(null)}
          onEdit={() => setEditingPatient(viewingPatient)}
        />
      )}
      {editingPatient && (
        <EditPatientModal
          patient={editingPatient}
          editorName={user?.name ?? "Staff"}
          extraDoctors={Array.from(new Set(
            patients.map((p) => p.referredBy).filter((r) => r && r !== "Self")
          ))}
          onClose={() => setEditingPatient(null)}
          onSaved={handlePatientSaved}
        />
      )}
      {historyPatient && (
        <PatientEditHistoryModal
          patient={historyPatient}
          onClose={() => setHistoryPatient(null)}
        />
      )}
      {viewBill && (
        <BillDocViewer
          open={!!viewBill} onClose={() => setViewBill(null)}
          srNo={viewBill.srNo} name={viewBill.name} age={viewBill.age}
          gender={viewBill.gender} contact={viewBill.contact}
          referredBy={viewBill.referredBy} study={viewBill.study}
          charges={viewBill.charges} discount={viewBill.discount ?? 0} paid={viewBill.paid}
          paymentMode={viewBill.paymentMode || "Cash"}
          date={viewBill.createdAt?.split("T")[0]}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Patients</h1>
          <p className="text-muted-foreground text-sm mt-0.5">All registered patients</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/patients/new"><UserPlus className="h-4 w-4 mr-2" />Register Patient</Link>
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Patients",  value: String(patients.length) },
          { label: "This Month",      value: String(thisMonth) },
          { label: "Today",           value: String(todayCount) },
          { label: "Pending Reports", value: String(patients.filter((p) => p.reportStatus === "pending").length) },
        ].map((s) => (
          <Card key={s.label} className="h-full">
            <CardContent className="p-4 h-full">
              {loading ? <Skeleton className="h-8 w-12 mb-1" /> : <p className="text-2xl font-bold">{s.value}</p>}
              <p className="text-sm text-muted-foreground mt-0.5">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Patient Registry</CardTitle>
              <CardDescription>
                {loading ? "Loading..." : `${filtered.length} patients${monthFilter !== "All Months" ? ` in ${monthFilter}` : ""}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-full sm:w-52">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search name, ID, phone..." className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={monthFilter} onValueChange={setMonthFilter}>
                <SelectTrigger className="h-9 w-full sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="px-4 pb-2">
              <div className="flex items-center gap-3 py-3 border-b border-border/60 mb-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-20 hidden md:block" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-3 w-8 ml-auto" />
              </div>
              {[...Array(7)].map((_, i) => (
                <motion.div
                  key={i}
                  className="flex items-center gap-3 py-3 border-b border-border/40 last:border-0"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.25, ease: "easeOut" }}
                >
                  <div className="flex items-center gap-2 flex-1">
                    <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-10" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24 hidden md:block" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-8 w-8 rounded-lg ml-auto" />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Age / Gender</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="hidden md:table-cell">Referred By</TableHead>
                  <TableHead>Study</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground text-sm">
                      No patients found.
                    </TableCell>
                  </TableRow>
                )}
                {groupedByDate.map(({ date, label, list }) => (
                  <Fragment key={date}>
                    {/* Date separator */}
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="py-2 px-4 bg-muted/40 border-y">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground uppercase tracking-wide">{label}</span>
                          <span className="text-xs text-muted-foreground">· {list.length} patient{list.length !== 1 ? "s" : ""}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {list.map((p) => {
                      const editCount = p.registrationEditHistory?.length ?? 0
                      return (
                        <TableRow key={p._id} className="cursor-pointer hover:bg-muted/20">
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                                {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <p className="font-medium text-sm">{p.name}</p>
                                  {editCount > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                                      <Pencil className="h-2.5 w-2.5" />edited
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">#{p.srNo}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm font-medium">{p.age} yrs</p>
                            <p className="text-xs text-muted-foreground capitalize">{p.gender}</p>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Phone className="h-3.5 w-3.5" />{p.contact}
                            </div>
                            {p.address && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <MapPin className="h-3 w-3" />{p.address}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm hidden md:table-cell">{p.referredBy || "Self"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[140px]">{p.study}</TableCell>
                          <TableCell><ReportStatusBadge status={p.reportStatus} /></TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">

                                {/* ── Patient info ── */}
                                <DropdownMenuItem
                                  className="flex items-center gap-2"
                                  onClick={() => setViewingPatient(p)}
                                >
                                  <User className="h-3.5 w-3.5 text-primary" />View Patient
                                </DropdownMenuItem>
                                {canEdit && (
                                  <DropdownMenuItem
                                    className="flex items-center gap-2"
                                    onClick={() => setEditingPatient(p)}
                                  >
                                    <Pencil className="h-3.5 w-3.5 text-blue-500" />Edit Patient
                                  </DropdownMenuItem>
                                )}
                                {editCount > 0 && (
                                  <DropdownMenuItem
                                    className="flex items-center gap-2"
                                    onClick={() => setHistoryPatient(p)}
                                  >
                                    <History className="h-3.5 w-3.5 text-amber-500" />
                                    Edit History
                                    <span className="ml-auto text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                                      {editCount}
                                    </span>
                                  </DropdownMenuItem>
                                )}

                                <DropdownMenuSeparator />

                                {/* ── Report ── */}
                                <DropdownMenuItem
                                  className="flex items-center gap-2"
                                  onClick={() => p.reportStatus === "completed" && setViewReport(p)}
                                  disabled={p.reportStatus !== "completed"}
                                >
                                  <FileText className="h-3.5 w-3.5" />View Report
                                </DropdownMenuItem>

                                <DropdownMenuSeparator />

                                {/* ── Bill ── */}
                                {p.reportStatus === "completed" && (
                                  <DropdownMenuItem className="flex items-center gap-2" onClick={() => setViewBill(p)}>
                                    <Printer className="h-3.5 w-3.5" />Print Bill
                                  </DropdownMenuItem>
                                )}
                                {p.billId ? (
                                  <DropdownMenuItem asChild>
                                    <Link href={`/billing/new?billId=${p.billId}`} className="flex items-center gap-2">
                                      <Receipt className="h-3.5 w-3.5 text-blue-500" />Edit Bill
                                    </Link>
                                  </DropdownMenuItem>
                                ) : canCreate && (
                                  <DropdownMenuItem asChild>
                                    <Link href="/billing/new" className="flex items-center gap-2">
                                      <Receipt className="h-3.5 w-3.5" />Create Bill
                                    </Link>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="flex items-center gap-2 text-green-700"
                                  onClick={() => window.open(`https://wa.me/91${p.contact}?text=Dear+${encodeURIComponent(p.name)},+your+report+from+Aarya+Diagnostics+Center+is+ready.`)}>
                                  <Share2 className="h-3.5 w-3.5" />Share Report
                                </DropdownMenuItem>

                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function PatientsPage() {
  const { user } = useRole()
  if (!user) return null
  if (user.role === "doctor") return <DoctorPatientsView />
  return (
    <AllPatientsView
      canCreate={user.permissions.patients.create}
      canEdit={user.permissions.patients.edit}
    />
  )
}
