"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, AlertCircle, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ComboInput, StudyComboInput, CategorySelect, useCategories, INITIAL_DOCTORS, getSavedDoctors, saveDoctor, StudyOption } from "@/components/combo-input"
import { canonicalCategory } from "@/lib/study-catalogue"
import { toDateInput } from "@/lib/visit-date"

interface StudyRow { id: number; name: string; category: string }

export default function NewPatientPage() {
  const [name,         setName]         = useState("")
  const [age,          setAge]          = useState("")
  const [gender,       setGender]       = useState("")
  const [contact,      setContact]      = useState("")
  const [address,      setAddress]      = useState("")
  const [refDoctor,    setRefDoctor]    = useState("")
  const [studyRows,    setStudyRows]    = useState<StudyRow[]>([{ id: 1, name: "", category: "" }])
  // The day the patient was seen. Defaults to today, but an entry typed in late
  // has to be able to say so — it decides the report date and which month's
  // sheet of the register the studies land on.
  const [visitDate,    setVisitDate]    = useState(() => toDateInput(new Date()))
  const [saved,        setSaved]        = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState("")
  const [savedSrNo,    setSavedSrNo]    = useState<number | null>(null)

  // Load suggestions from real sources after mount (avoids SSR localStorage issue)
  const [savedDoctors,   setSavedDoctors]   = useState<string[]>(INITIAL_DOCTORS)
  const [patientNames,   setPatientNames]   = useState<string[]>([])
  const [dbStudies,      setDbStudies]      = useState<StudyOption[]>([])
  const [categories, addCategory] = useCategories()

  useEffect(() => {
    setSavedDoctors(getSavedDoctors())
    // Fetch patient names for autocomplete
    fetch("/api/patients")
      .then((r) => r.json())
      .then((d) => setPatientNames((d.patients || []).map((p: { name: string }) => p.name)))
      .catch(() => {})
    // Fetch real studies from DB for the combo input
    fetch("/api/studies")
      .then((r) => r.json())
      .then((d) => setDbStudies((d.studies || []).map((s: { name: string; price: number; category: string }) => ({ name: s.name, price: s.price, category: canonicalCategory(s.category) }))))
      .catch(() => {})
  }, [])

  // A study's category is whatever was picked on its row — the form never
  // derives one from the study name. A guessed department on the monthly
  // register reads as deliberate, so a known study brings its saved category
  // and an unknown one has to be filed by hand before the patient can be saved.
  const validStudies = studyRows
    .map((r) => ({ name: r.name.trim(), category: canonicalCategory(r.category) }))
    .filter((r) => r.name)

  const uncategorised = validStudies.filter((r) => !r.category).length

  const backdated = !!visitDate && visitDate !== toDateInput(new Date())
  const visitDay  = visitDate ? new Date(`${visitDate}T12:00:00Z`) : null
  const prettyVisitDate = visitDay
    ? visitDay.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    : ""
  const visitMonthLabel = visitDay
    ? visitDay.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })
    : ""

  const addStudyRow = () =>
    setStudyRows((prev) => [...prev, { id: Date.now(), name: "", category: "" }])

  const removeStudyRow = (id: number) =>
    setStudyRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.id !== id)))

  // Typing keeps whatever category the row already carries; picking a study
  // off the list adopts that study's saved category; clearing the name clears
  // the category with it.
  const updateStudyRow = (id: number, name: string, category?: string) =>
    setStudyRows((prev) => prev.map((r) => {
      if (r.id !== id) return r
      if (category !== undefined) return { ...r, name, category: canonicalCategory(category) }
      return { ...r, name, category: name.trim() ? r.category : "" }
    }))

  const setStudyCategory = (id: number, category: string) =>
    setStudyRows((prev) => prev.map((r) => (r.id === id ? { ...r, category } : r)))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setSavedDoctors((prev) => saveDoctor(refDoctor, prev))

    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:          name.trim(),
          age:           Number(age),
          gender,
          contact:       contact.trim(),
          address:       address.trim(),
          referredBy:    refDoctor.trim() || "Self",
          visitDate,
          studies:       validStudies,
          reportStatus:  "pending",
          charges: 0,
          paid:    0,
          discount: 0,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save")
      }

      const { patient } = await res.json()
      setSavedSrNo(patient.srNo)
      setSaved(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save patient. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (saved) {
    return (
      <div className="max-w-md mx-auto mt-24 text-center space-y-4">
        <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-xl font-bold">Patient Registered</h2>
        <p className="text-muted-foreground text-sm">
          <strong>{name}</strong> has been added as <strong>Sr. No. #{savedSrNo}</strong>.<br />
          The doctor can now fill the report from their queue.
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <Button variant="outline" onClick={() => {
            setName(""); setAge(""); setGender(""); setContact(""); setAddress("")
            setRefDoctor(""); setStudyRows([{ id: 1, name: "", category: "" }]); setSaved(false); setSavedSrNo(null)
            setVisitDate(toDateInput(new Date()))
          }}>
            Register Another
          </Button>
          <Button asChild><Link href="/patients">View Patients</Link></Button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/patients"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">New Patient Registration</h1>
          <p className="text-sm text-muted-foreground">
            {prettyVisitDate || "—"}{backdated && " · backdated"}
          </p>
        </div>
      </div>

      <form onSubmit={handleSave}>
        <Card>
          <CardContent className="pt-5 pb-6 px-5 space-y-4">

            <div className="space-y-1.5">
              <Label>Full Name <span className="text-red-500">*</span></Label>
              <ComboInput
                value={name}
                onChange={setName}
                suggestions={patientNames}
                placeholder="Patient full name"
                onSelect={setName}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Date of Visit <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                className={backdated ? "border-amber-400" : ""}
                required
              />
              <p className="text-[11px] text-muted-foreground">
                {backdated
                  ? `Backdated — this registration is filed under ${prettyVisitDate}, and its studies go on the ${visitMonthLabel} register sheet.`
                  : "Today. Change it to enter a visit you didn't get to on the day — the report date and the register sheet both follow this."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Age <span className="text-red-500">*</span></Label>
                <Input
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="e.g. 35"
                  type="number"
                  min={0}
                  max={120}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Gender <span className="text-red-500">*</span></Label>
                <Select value={gender} onValueChange={setGender} required>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
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
                  placeholder="10-digit mobile"
                  type="tel"
                  maxLength={10}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Address</Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Patient address (optional)"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Studies / Tests <span className="text-red-500">*</span></Label>
                <button
                  type="button"
                  onClick={addStudyRow}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />Add another study
                </button>
              </div>
              <div className="space-y-2">
                {studyRows.map((row, i) => (
                  <div key={row.id} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground font-mono pt-2.5 w-4 shrink-0">{i + 1}.</span>
                    <div className="flex-1 space-y-1.5">
                      <StudyComboInput
                        value={row.name}
                        dbStudies={dbStudies}
                        onChange={(v) => updateStudyRow(row.id, v)}
                        onSelect={(name, _price, cat) => updateStudyRow(row.id, name, cat)}
                      />
                      {row.name.trim() && (
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            Category <span className="text-red-500">*</span>
                          </span>
                          <CategorySelect
                            value={row.category}
                            onChange={(c) => setStudyCategory(row.id, c)}
                            categories={categories}
                            onCategoryAdded={addCategory}
                            placeholder="Choose a category"
                            className={`h-8 text-xs flex-1 ${row.category ? "" : "border-amber-400 text-amber-700"}`}
                          />
                        </div>
                      )}
                    </div>
                    <Button
                      type="button" variant="ghost" size="icon"
                      className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeStudyRow(row.id)}
                      disabled={studyRows.length === 1}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                A patient can have multiple studies — each gets its own separate report. The category
                decides which department the study lands under in the monthly register; a study you have
                registered before brings its own, and a new one has to be filed here.
              </p>
              {uncategorised > 0 && (
                <p className="text-[11px] text-amber-700">
                  {uncategorised === 1 ? "One study still needs" : `${uncategorised} studies still need`} a category.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Ref. By (Referring Doctor)</Label>
              <ComboInput
                value={refDoctor}
                onChange={setRefDoctor}
                suggestions={savedDoctors}
                placeholder="Type doctor name or leave blank for Self"
                onSelect={(v) => { setRefDoctor(v); setSavedDoctors((prev) => saveDoctor(v, prev)) }}
              />
              <p className="text-[11px] text-muted-foreground">
                Start typing — saved doctors appear as suggestions. New names are saved automatically.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={!name || !age || !gender || !contact || !visitDate || validStudies.length === 0 || uncategorised > 0 || loading}
                className="bg-blue-600 hover:bg-blue-700 px-6"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Saving...
                  </span>
                ) : "Save Patient"}
              </Button>
            </div>

          </CardContent>
        </Card>
      </form>
    </div>
  )
}
