"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ComboInput, StudyComboInput, INITIAL_DOCTORS, getSavedDoctors, saveDoctor, StudyOption } from "@/components/combo-input"
import { autoCategory } from "@/lib/study-catalogue"

export default function NewPatientPage() {
  const [name,         setName]         = useState("")
  const [age,          setAge]          = useState("")
  const [gender,       setGender]       = useState("")
  const [contact,      setContact]      = useState("")
  const [address,      setAddress]      = useState("")
  const [refDoctor,    setRefDoctor]    = useState("")
  const [study,        setStudy]        = useState("")
  const [studyCategory, setStudyCategory] = useState("")
  const [saved,        setSaved]        = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState("")
  const [savedSrNo,    setSavedSrNo]    = useState<number | null>(null)

  // Load suggestions from real sources after mount (avoids SSR localStorage issue)
  const [savedDoctors,   setSavedDoctors]   = useState<string[]>(INITIAL_DOCTORS)
  const [patientNames,   setPatientNames]   = useState<string[]>([])
  const [dbStudies,      setDbStudies]      = useState<StudyOption[]>([])

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
      .then((d) => setDbStudies((d.studies || []).map((s: { name: string; price: number; category: string }) => ({ name: s.name, price: s.price, category: s.category }))))
      .catch(() => {})
  }, [])

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
          study,
          studyCategory: studyCategory || autoCategory(study.trim()),
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
            setRefDoctor(""); setStudy(""); setSaved(false); setSavedSrNo(null)
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
            {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
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
              <Label>Study / Test <span className="text-red-500">*</span></Label>
              <StudyComboInput
                value={study}
                dbStudies={dbStudies}
                onChange={(v) => {
                  setStudy(v)
                  setStudyCategory(v.trim() ? autoCategory(v.trim()) : "")
                }}
                onSelect={(name, _price, cat) => {
                  setStudy(name)
                  setStudyCategory(cat)
                }}
              />
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
                disabled={!name || !age || !gender || !contact || !study || loading}
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
