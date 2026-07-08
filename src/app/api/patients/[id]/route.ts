import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import Notification from "@/models/Notification"
import { autoCategory } from "@/lib/study-catalogue"

type PatientDoc = InstanceType<typeof Patient>

// Older records only carry the single legacy `study` + report fields.
// Materialize them into the `studies` array before any per-study operation.
function ensureStudies(patient: PatientDoc) {
  if ((patient.studies?.length ?? 0) === 0 && patient.study) {
    patient.studies = [{
      name:         patient.study,
      category:     autoCategory(patient.study),
      reportStatus: patient.reportStatus ?? "pending",
      reportBody:   patient.reportBody ?? "",
      reportDocx:   patient.reportDocx ?? "",
      reportPdf:    patient.reportPdf ?? "",
      reportSlug:   patient.reportSlug ?? "",
      editHistory:  patient.editHistory ?? [],
      billId:       patient.billId,
      charges:      patient.charges ?? 0,
      paid:         patient.paid ?? 0,
      discount:     patient.discount ?? 0,
      paymentMode:  patient.paymentMode ?? "Cash",
    }]
  }
}

// Keep the legacy top-level fields in sync (older UI paths still read them)
function syncLegacyMirror(patient: PatientDoc) {
  const first = patient.studies?.[0]
  if (!first) return
  patient.study       = first.name
  patient.reportBody  = first.reportBody
  patient.reportDocx  = first.reportDocx
  patient.reportPdf   = first.reportPdf
  patient.reportSlug  = first.reportSlug
  patient.editHistory = first.editHistory
  patient.billId      = first.billId
  patient.charges     = first.charges ?? 0
  patient.paid        = first.paid ?? 0
  patient.discount    = first.discount ?? 0
  patient.paymentMode = first.paymentMode ?? "Cash"

  const statuses: string[] = patient.studies.map((s: { reportStatus: string }) => s.reportStatus)
  patient.reportStatus =
    statuses.every((s) => s === "completed") ? "completed" :
    statuses.some((s) => s === "in_progress" || s === "completed") ? "in_progress" :
    "pending"
}

async function generateSlug(patient: PatientDoc, studyName: string, excludeId: string): Promise<string> {
  const nameBase  = patient.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const studyBase = studyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  let slug = `${nameBase}-${studyBase}-report`
  const taken = await Patient.findOne({
    _id: { $ne: excludeId },
    $or: [{ reportSlug: slug }, { "studies.reportSlug": slug }],
  }).select("_id")
  if (taken) slug = `${nameBase}-${studyBase}-${patient.srNo}-report`
  // also make sure it doesn't clash with another study of the same patient
  const clash = patient.studies.filter((s: { reportSlug: string }) => s.reportSlug === slug).length
  if (clash) slug = `${slug}-${clash + 1}`
  return slug
}

// GET /api/patients/:id
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const patient = await Patient.findById(id)
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 })
    ensureStudies(patient)
    return NextResponse.json({ patient })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// PATCH /api/patients/:id
// - Registration fields (name, age, ...) are set normally
// - `studies` [{name, category}] replaces the study list, preserving report
//   data for entries whose name is unchanged
// - `addStudy` {name, category} appends a new study
// - Report fields (reportStatus/reportBody/reportDocx/reportPdf/editHistoryEntry)
//   target `studyIndex` (default 0)
// - `registrationEditHistoryEntry` is pushed onto the registration history stack
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    const body = await req.json()

    const {
      editHistoryEntry,
      registrationEditHistoryEntry,
      studyIndex: rawStudyIndex,
      addStudy,
      studyName,
      studies: studiesUpdate,
      reportStatus, reportBody, reportDocx, reportPdf,
      ...regularFields
    } = body

    const patient = await Patient.findById(id)
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 })
    ensureStudies(patient)

    // ── Plain registration fields ──
    const allowed = ["name", "age", "gender", "contact", "address", "referredBy", "srNo", "charges", "paid", "discount", "paymentMode", "billId"]
    for (const [k, v] of Object.entries(regularFields)) {
      if (allowed.includes(k)) (patient as unknown as Record<string, unknown>)[k] = v
      // legacy single-study edit from older clients
      if (k === "study" && typeof v === "string" && v.trim()) {
        if (patient.studies.length > 0) patient.studies[0].name = v.trim()
      }
    }

    // ── Replace / reconcile the study list (registration edit) ──
    if (Array.isArray(studiesUpdate)) {
      const cleaned = studiesUpdate
        .map((s: { name?: string; category?: string }) => ({
          name: String(s.name ?? "").trim(),
          category: s.category || autoCategory(String(s.name ?? "")),
        }))
        .filter((s) => s.name)
      if (cleaned.length > 0) {
        const old = patient.studies
        patient.studies = cleaned.map((s) => {
          // keep report data if the same study name existed before (or same position with same name)
          const match = old.find((o: { name: string }) => o.name === s.name)
          return match
            ? Object.assign(match, { category: s.category })
            : { name: s.name, category: s.category, reportStatus: "pending", reportBody: "", reportDocx: "", reportPdf: "", reportSlug: "", editHistory: [] }
        })
        await Promise.all(cleaned.map((s) =>
          Study.findOneAndUpdate(
            { name: s.name },
            { $setOnInsert: { name: s.name, category: s.category, price: 0, fromCatalogue: false, firstSeenAt: new Date() } },
            { upsert: true }
          )
        ))
      }
    }

    // ── Append a new study ──
    if (addStudy?.name && String(addStudy.name).trim()) {
      const name = String(addStudy.name).trim()
      const category = addStudy.category || autoCategory(name)
      patient.studies.push({
        name, category,
        reportStatus: "pending", reportBody: "", reportDocx: "", reportPdf: "", reportSlug: "", editHistory: [],
      })
      await Study.findOneAndUpdate(
        { name },
        { $setOnInsert: { name, category, price: 0, fromCatalogue: false, firstSeenAt: new Date() } },
        { upsert: true }
      )
    }

    // ── Rename the current study (report template / heading changed) ──
    if (typeof studyName === "string" && studyName.trim()) {
      const idx = Math.min(Math.max(Number(rawStudyIndex) || 0, 0), Math.max(patient.studies.length - 1, 0))
      const entry = patient.studies[idx]
      if (entry && entry.name !== studyName.trim()) {
        entry.name = studyName.trim()
        entry.category = autoCategory(entry.name)
        await Study.findOneAndUpdate(
          { name: entry.name },
          { $setOnInsert: { name: entry.name, category: entry.category, price: 0, fromCatalogue: false, firstSeenAt: new Date() } },
          { upsert: true }
        )
      }
    }

    // ── Per-study report fields ──
    const hasReportFields =
      reportStatus !== undefined || reportBody !== undefined ||
      reportDocx !== undefined || reportPdf !== undefined || !!editHistoryEntry

    if (hasReportFields) {
      const idx = Math.min(Math.max(Number(rawStudyIndex) || 0, 0), Math.max(patient.studies.length - 1, 0))
      const entry = patient.studies[idx]
      if (entry) {
        if (reportStatus !== undefined) entry.reportStatus = reportStatus
        if (reportBody   !== undefined) entry.reportBody   = reportBody
        if (reportDocx   !== undefined) entry.reportDocx   = reportDocx
        if (reportPdf    !== undefined) {
          entry.reportPdf = reportPdf
          if (!entry.reportSlug) entry.reportSlug = await generateSlug(patient, entry.name, id)
        }
        if (editHistoryEntry) entry.editHistory.unshift(editHistoryEntry)
      }
    }

    // ── Per-study billing fields ──
    const hasBillingFields =
      regularFields.charges !== undefined || regularFields.paid !== undefined ||
      regularFields.discount !== undefined || regularFields.paymentMode !== undefined || regularFields.billId !== undefined

    if (hasBillingFields) {
      const idx = Math.min(Math.max(Number(rawStudyIndex) || 0, 0), Math.max(patient.studies.length - 1, 0))
      const entry = patient.studies[idx]
      if (entry) {
        if (regularFields.charges !== undefined)     entry.charges = Number(regularFields.charges)
        if (regularFields.paid !== undefined)        entry.paid = Number(regularFields.paid)
        if (regularFields.discount !== undefined)    entry.discount = Number(regularFields.discount)
        if (regularFields.paymentMode !== undefined) entry.paymentMode = regularFields.paymentMode
        if (regularFields.billId !== undefined)      entry.billId = regularFields.billId
      }
    }

    if (registrationEditHistoryEntry) {
      patient.registrationEditHistory.unshift(registrationEditHistoryEntry)
    }

    syncLegacyMirror(patient)
    patient.markModified("studies")
    await patient.save()

    // Notify receptionists when a completed report is submitted
    if (editHistoryEntry && reportStatus === "completed") {
      const idx = Math.min(Math.max(Number(rawStudyIndex) || 0, 0), Math.max(patient.studies.length - 1, 0))
      const studyName = patient.studies[idx]?.name ?? patient.study
      await Notification.create({
        recipientRole: "receptionist",
        type: "report_submitted",
        title: "Report ready",
        message: `${patient.name} (Sr. ${patient.srNo})${studyName ? ` — ${studyName}` : ""}`,
        patientId: patient._id,
      })
    }

    // Notify doctors when registration details are edited
    if (registrationEditHistoryEntry) {
      await Notification.create({
        recipientRole: "doctor",
        type: "patient_edited",
        title: "Patient registration updated",
        message: `${patient.name} (Sr. ${patient.srNo}) details were edited`,
        patientId: patient._id,
      })
    }

    return NextResponse.json({ patient })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
