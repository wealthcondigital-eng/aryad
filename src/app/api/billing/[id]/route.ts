import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import { resolveStudyCategory } from "@/lib/study-category"
import { syncPatientToRegister } from "@/lib/register-sync"
import { applyBillToStudies, patientTotals } from "@/lib/bill-allocation"

function ensureStudies(patient: any) {
  if ((patient.studies?.length ?? 0) === 0 && patient.study) {
    patient.studies = [{
      name:         patient.study,
      category:     "",
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

function syncLegacyMirror(patient: any) {
  const first = patient.studies?.[0]
  if (!first) return
  patient.study       = first.name
  patient.reportBody  = first.reportBody
  patient.reportDocx  = first.reportDocx
  patient.reportPdf   = first.reportPdf
  patient.reportSlug  = first.reportSlug
  patient.editHistory = first.editHistory
  patient.billId      = first.billId
  // Money mirrors the whole patient — see the note in api/billing/route.ts
  const money = patientTotals(patient.studies)
  patient.charges     = money.charges
  patient.paid        = money.paid
  patient.discount    = money.discount
  patient.paymentMode = first.paymentMode ?? "Cash"

  const statuses: string[] = patient.studies.map((s: any) => s.reportStatus)
  patient.reportStatus =
    statuses.every((s) => s === "completed") ? "completed" :
    statuses.some((s) => s === "in_progress" || s === "completed") ? "in_progress" :
    "pending"
}

// Pretty public slug for the receipt PDF, e.g. "sagar-dutta-receipt" → /sagar-dutta-receipt/pdf
async function generateBillSlug(bill: any): Promise<string> {
  const nameBase = String(bill.patientName || "patient")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  let slug = `${nameBase}-receipt`
  const taken = await Bill.findOne({ _id: { $ne: bill._id }, billSlug: slug }).select("_id")
  if (taken) slug = `${nameBase}-${bill.srNo}-receipt`
  let candidate = slug
  let n = 2
  while (await Bill.findOne({ _id: { $ne: bill._id }, billSlug: candidate }).select("_id")) {
    candidate = `${slug}-${n++}`
  }
  return candidate
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await connectDB()
  const bill = await Bill.findById(id)
  if (!bill) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ bill })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await connectDB()
  const body = await req.json()
  const { editor = "Staff", ...updatedFields } = body

  const current = await Bill.findById(id)
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Compute diff
  const trackFields = ["patientName", "referredBy", "billDate", "charges", "discount", "paid", "paymentMode", "notes", "items"]
  const changedFields: string[] = []
  const previousValues: Record<string, unknown> = {}
  for (const key of trackFields) {
    if (key in updatedFields && JSON.stringify(current.get(key)) !== JSON.stringify(updatedFields[key])) {
      changedFields.push(key)
      previousValues[key] = current.get(key)
    }
  }

  const charges     = updatedFields.charges     ?? current.charges
  const discount    = updatedFields.discount    ?? current.discount
  const paid        = updatedFields.paid        ?? current.paid
  const paymentMode = updatedFields.paymentMode ?? current.paymentMode
  const balance     = charges - discount - paid

  const editEntry = { editor, editedAt: new Date(), changedFields, previousValues }

  const updateObj: any = {
    $set: { ...updatedFields, balance, charges, discount, paid, paymentMode }
  }
  // Lazily mint the pretty receipt slug the first time a PDF is stored
  if (updatedFields.billPdf && !current.billSlug) {
    updateObj.$set.billSlug = await generateBillSlug(current)
  }
  if (changedFields.length > 0) {
    updateObj.$push = { editHistory: { $each: [editEntry], $position: 0 } }
  }

  const updated = await Bill.findByIdAndUpdate(id, updateObj, { returnDocument: "after" })

  const patient = await Patient.findById(current.patientId)
  if (patient) {
    ensureStudies(patient)
    // Mirror the bill totals onto every study this bill covers. A study whose
    // name was just added as a line item on this bill (via the edit screen)
    // gets linked here too — without that, an unbilled study added to the
    // bill would stay marked unbilled on the patient forever.
    const items = updatedFields.items ?? current.items ?? []
    const billedNames = new Set(
      items.map((i: { study: string }) => i.study.trim().toLowerCase())
    )
    const covered = []
    for (const entry of patient.studies) {
      const linked     = entry.billId?.toString() === id
      const nameOnBill = !entry.billId && billedNames.has((entry.name || "").trim().toLowerCase())
      if (!linked && !nameOnBill) continue
      if (nameOnBill) entry.billId = current._id
      covered.push(entry)
    }
    // Each covered study takes its own line off the bill rather than the bill's
    // total. Nothing matched at all (a study renamed since it was billed) still
    // has to land somewhere, so it goes on the first study as it always did.
    if (covered.length === 0 && patient.studies[0]) covered.push(patient.studies[0])
    applyBillToStudies(covered, items, { charges, discount, paid, paymentMode })
    syncLegacyMirror(patient)
    patient.markModified("studies")

    // A name/referral correction typed on the bill itself is a patient-record
    // correction, not a bill-only detail — write it through to the patient so
    // reports (which always read the live patient) and every other bill for
    // this patient stay in sync, not just the one bill being edited here.
    const identitySync: Record<string, unknown> = {}
    if (typeof updatedFields.patientName === "string" && updatedFields.patientName.trim() && updatedFields.patientName.trim() !== patient.name) {
      patient.name = updatedFields.patientName.trim()
      identitySync.patientName = patient.name
    }
    if (typeof updatedFields.referredBy === "string" && updatedFields.referredBy.trim() && updatedFields.referredBy.trim() !== patient.referredBy) {
      patient.referredBy = updatedFields.referredBy.trim()
      identitySync.referredBy = patient.referredBy
    }

    await patient.save()

    // The bill's totals are what the monthly register's money columns show —
    // each study's own share of it, over anything typed onto the sheet before.
    await syncPatientToRegister(patient, "", { moneyFromBill: true })

    if (Object.keys(identitySync).length > 0) {
      await Bill.updateMany({ patientId: patient._id, _id: { $ne: id } }, { $set: identitySync })
    }
  }

  // Update Study catalogue prices from updated bill items
  const items: Array<{ study: string; price: number }> = updatedFields.items ?? current.items ?? []
  for (const item of items) {
    if (!item.study || !item.price) continue
    const cat = await resolveStudyCategory(item.study)
    await Study.findOneAndUpdate(
      { name: item.study },
      {
        $set:         { price: item.price, lastBilledAt: new Date() },
        $setOnInsert: { name: item.study, category: cat, fromCatalogue: false, firstSeenAt: new Date() },
      },
      { upsert: true }
    )
  }

  return NextResponse.json({ bill: updated })
}
