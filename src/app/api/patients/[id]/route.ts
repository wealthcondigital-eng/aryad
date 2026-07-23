import { NextRequest, NextResponse } from "next/server"
import mongoose from "mongoose"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import Bill from "@/models/Bill"
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
  patient.heading     = first.heading
  patient.headingFont = first.headingFont
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

// When a study is dropped from a patient's study list, pull its line off
// whatever Bill it was billed on (deleting the Bill outright if that was the
// only study on it), and keep any sibling studies still on that Bill in sync.
async function cascadeRemoveStudiesFromBills(patient: PatientDoc, removed: Array<{ name: string; billId?: mongoose.Types.ObjectId | null }>) {
  const billIds = Array.from(
    new Set(removed.filter((s) => s.billId).map((s) => String(s.billId)))
  )
  for (const billId of billIds) {
    const bill = await Bill.findById(billId)
    if (!bill) continue

    const droppedNames = new Set(
      removed.filter((s) => String(s.billId) === billId).map((s) => s.name.trim().toLowerCase())
    )
    bill.items = bill.items.filter((i: { study: string }) => !droppedNames.has(i.study.trim().toLowerCase()))

    if (bill.items.length === 0) {
      await Bill.findByIdAndDelete(billId)
      continue
    }

    bill.charges = bill.items.reduce((sum: number, i: { quantity: number; price: number }) => sum + i.quantity * i.price, 0)
    // The bill's discount/paid were never split per study, so there's no true
    // per-item amount to subtract when one study drops off — just clamp them
    // to the smaller charges total so the balance can't go negative/nonsensical
    // (e.g. "paid" exceeding what's left owed). Staff can correct the exact
    // split manually on the bill if needed.
    bill.discount = Math.min(bill.discount, bill.charges)
    bill.paid = Math.min(bill.paid, bill.charges - bill.discount)
    bill.balance = bill.charges - bill.discount - bill.paid
    await bill.save()

    // Studies still remaining on this patient that share the same bill need
    // their mirrored charges/balance updated to match the trimmed-down bill.
    for (const entry of patient.studies) {
      if (String(entry.billId) === billId) {
        entry.charges = bill.charges
        entry.paid = bill.paid
        entry.discount = bill.discount
        entry.paymentMode = bill.paymentMode
      }
    }
  }
}

// The mirror image of cascadeRemoveStudiesFromBills: when a study is added to
// a patient who already has a bill, append it as a line on their most recent
// bill (at its catalogue price) so billing stays in step with the study list —
// otherwise a study added after billing never shows on any bill at all.
// Patients with no bill yet are left alone; the "New Bill" screen already
// picks up every unbilled study when a bill is eventually raised.
async function cascadeAddStudiesToBill(patient: PatientDoc, added: Array<{ name: string; billId?: mongoose.Types.ObjectId | null }>) {
  const unbilled = added.filter((s) => !s.billId && s.name?.trim())
  if (unbilled.length === 0) return

  const bill = await Bill.findOne({ patientId: patient._id }).sort({ createdAt: -1 })
  if (!bill) return

  const existingNames = new Set(bill.items.map((i: { study: string }) => i.study.trim().toLowerCase()))
  let changed = false
  for (const s of unbilled) {
    const name = s.name.trim()
    if (existingNames.has(name.toLowerCase())) {
      // Already a line for this study name (e.g. re-added after a rename) —
      // just link the entry back to the bill instead of double-charging.
      s.billId = bill._id
      continue
    }
    const catalogue = await Study.findOne({ name }).select("price")
    bill.items.push({ study: name, quantity: 1, price: catalogue?.price ?? 0, discount: 0 })
    existingNames.add(name.toLowerCase())
    s.billId = bill._id
    changed = true
  }
  if (!changed) return

  bill.charges = bill.items.reduce((sum: number, i: { quantity: number; price: number }) => sum + i.quantity * i.price, 0)
  bill.balance = bill.charges - bill.discount - bill.paid
  bill.editHistory.unshift({
    editor: "System (study added)",
    editedAt: new Date(),
    changedFields: ["items", "charges"],
    previousValues: {},
  })
  bill.markModified("items")
  await bill.save()

  // Every study entry linked to this bill mirrors the new totals.
  for (const entry of patient.studies) {
    if (String(entry.billId) === String(bill._id)) {
      entry.charges = bill.charges
      entry.paid = bill.paid
      entry.discount = bill.discount
      entry.paymentMode = bill.paymentMode
    }
  }
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
      removeStudyIndex,
      studyName,
      studies: studiesUpdate,
      reportStatus, reportBody, reportDocx, reportPdf, heading, headingFont, signatureLayout,
      ...regularFields
    } = body

    const patient = await Patient.findById(id)
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 })
    ensureStudies(patient)

    // ── Delete one study's report (drops the study + its bill line) ──
    // Removing the last remaining study deletes the whole patient record —
    // a patient with zero studies can't exist in this app.
    if (removeStudyIndex !== undefined) {
      const idx = Number(removeStudyIndex)
      if (!Number.isInteger(idx) || idx < 0 || idx >= patient.studies.length) {
        return NextResponse.json({ error: "Invalid study index" }, { status: 400 })
      }
      const removed = patient.studies.splice(idx, 1)
      await cascadeRemoveStudiesFromBills(patient, removed)
      if (patient.studies.length === 0) {
        await Patient.findByIdAndDelete(id)
        return NextResponse.json({ patient: null, deleted: true })
      }
      syncLegacyMirror(patient)
      patient.markModified("studies")
      await patient.save()
      return NextResponse.json({ patient })
    }

    // ── Plain registration fields ──
    const allowed = ["name", "age", "gender", "contact", "address", "referredBy", "srNo", "charges", "paid", "discount", "paymentMode", "billId"]
    // Bills keep their own copy of name/age/gender/contact/referredBy/srNo
    // (denormalized so a bill still reads correctly if a patient is later
    // deleted) — a registration edit has to push those same fields onto every
    // bill already raised for this patient, or the bill keeps showing
    // whatever was typed at booking time even after it's corrected here.
    const BILL_SYNC_FIELDS: Record<string, string> = {
      name: "patientName", age: "age", gender: "gender", contact: "contact", referredBy: "referredBy", srNo: "srNo",
    }
    const billSync: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(regularFields)) {
      if (allowed.includes(k)) (patient as unknown as Record<string, unknown>)[k] = v
      if (k in BILL_SYNC_FIELDS) billSync[BILL_SYNC_FIELDS[k]] = v
      // legacy single-study edit from older clients
      if (k === "study" && typeof v === "string" && v.trim()) {
        if (patient.studies.length > 0) patient.studies[0].name = v.trim()
      }
    }
    if (Object.keys(billSync).length > 0) {
      await Bill.updateMany({ patientId: patient._id }, { $set: billSync })
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
        // Matched by name, but each old entry is only used ONCE (a proper
        // multiset diff) — a plain "does cleaned contain this name" check
        // would treat two same-named studies (e.g. two "USG Abdomen" visits)
        // as still-present even when only one of the two duplicates remains,
        // silently keeping the other's stale bill line forever.
        const usedOldIndices = new Set<number>()
        const newIndices: number[] = []
        const merged = cleaned.map((s, mi) => {
          const matchIdx = old.findIndex((o: { name: string }, i: number) => !usedOldIndices.has(i) && o.name === s.name)
          if (matchIdx === -1) {
            newIndices.push(mi)
            return { name: s.name, category: s.category, reportStatus: "pending", reportBody: "", reportDocx: "", reportPdf: "", reportSlug: "", editHistory: [] }
          }
          usedOldIndices.add(matchIdx)
          return Object.assign(old[matchIdx], { category: s.category })
        })
        const removed = old.filter((_: unknown, i: number) => !usedOldIndices.has(i))
        if (removed.length > 0) await cascadeRemoveStudiesFromBills(patient, removed)

        patient.studies = merged
        await Promise.all(cleaned.map((s) =>
          Study.findOneAndUpdate(
            { name: s.name },
            { $setOnInsert: { name: s.name, category: s.category, price: 0, fromCatalogue: false, firstSeenAt: new Date() } },
            { upsert: true }
          )
        ))
        // Studies newly added by this edit also get a line on the existing bill
        if (newIndices.length > 0) {
          await cascadeAddStudiesToBill(patient, newIndices.map((i) => patient.studies[i]).filter(Boolean))
        }
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
      await cascadeAddStudiesToBill(patient, [patient.studies[patient.studies.length - 1]])
    }

    // ── Rename the current study (report template / heading changed) ──
    if (typeof studyName === "string" && studyName.trim()) {
      const idx = Math.min(Math.max(Number(rawStudyIndex) || 0, 0), Math.max(patient.studies.length - 1, 0))
      const entry = patient.studies[idx]
      if (entry && entry.name !== studyName.trim()) {
        const oldName = entry.name
        entry.name = studyName.trim()
        entry.category = autoCategory(entry.name)
        await Study.findOneAndUpdate(
          { name: entry.name },
          { $setOnInsert: { name: entry.name, category: entry.category, price: 0, fromCatalogue: false, firstSeenAt: new Date() } },
          { upsert: true }
        )
        // Keep the linked bill's line item labelled the same as the report —
        // otherwise the bill keeps showing the study's old name forever.
        if (entry.billId) {
          const bill = await Bill.findById(entry.billId)
          const item = bill?.items.find((i: { study: string }) => i.study.trim().toLowerCase() === oldName.trim().toLowerCase())
          if (bill && item) {
            item.study = entry.name
            bill.markModified("items")
            await bill.save()
          }
        }
      }
    }

    // ── Per-study report fields ──
    const hasReportFields =
      reportStatus !== undefined || reportBody !== undefined ||
      reportDocx !== undefined || reportPdf !== undefined || !!editHistoryEntry ||
      signatureLayout !== undefined || heading !== undefined || headingFont !== undefined

    if (hasReportFields) {
      const idx = Math.min(Math.max(Number(rawStudyIndex) || 0, 0), Math.max(patient.studies.length - 1, 0))
      const entry = patient.studies[idx]
      if (entry) {
        if (reportStatus !== undefined) entry.reportStatus = reportStatus
        if (reportBody   !== undefined) entry.reportBody   = reportBody
        if (reportDocx   !== undefined) entry.reportDocx   = reportDocx
        if (heading      !== undefined) entry.heading      = heading
        if (headingFont  !== undefined) entry.headingFont  = headingFont
        if (reportPdf    !== undefined) {
          entry.reportPdf = reportPdf
          if (!entry.reportSlug) entry.reportSlug = await generateSlug(patient, entry.name, id)
        }
        if (editHistoryEntry) entry.editHistory.unshift(editHistoryEntry)
        // Per-report drag/resize override for the two signature-block images
        if (signatureLayout !== undefined) entry.signatureLayout = signatureLayout
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
