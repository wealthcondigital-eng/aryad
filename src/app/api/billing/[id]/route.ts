import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import { autoCategory } from "@/lib/study-catalogue"

function ensureStudies(patient: any) {
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
  patient.charges     = first.charges ?? 0
  patient.paid        = first.paid ?? 0
  patient.discount    = first.discount ?? 0
  patient.paymentMode = first.paymentMode ?? "Cash"

  const statuses: string[] = patient.studies.map((s: any) => s.reportStatus)
  patient.reportStatus =
    statuses.every((s) => s === "completed") ? "completed" :
    statuses.some((s) => s === "in_progress" || s === "completed") ? "in_progress" :
    "pending"
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
  if (changedFields.length > 0) {
    updateObj.$push = { editHistory: { $each: [editEntry], $position: 0 } }
  }

  const updated = await Bill.findByIdAndUpdate(id, updateObj, { returnDocument: "after" })

  const patient = await Patient.findById(current.patientId)
  if (patient) {
    ensureStudies(patient)
    const studyIndex = patient.studies.findIndex((s: any) => s.billId?.toString() === id)
    if (studyIndex !== -1) {
      const entry = patient.studies[studyIndex]
      entry.charges = charges
      entry.paid = paid
      entry.discount = discount
      entry.paymentMode = paymentMode
    } else {
      if (patient.studies[0]) {
        patient.studies[0].charges = charges
        patient.studies[0].paid = paid
        patient.studies[0].discount = discount
        patient.studies[0].paymentMode = paymentMode
      }
    }
    syncLegacyMirror(patient)
    patient.markModified("studies")
    await patient.save()
  }

  // Update Study catalogue prices from updated bill items
  const items: Array<{ study: string; price: number }> = updatedFields.items ?? current.items ?? []
  for (const item of items) {
    if (!item.study || !item.price) continue
    const cat = autoCategory(item.study)
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
