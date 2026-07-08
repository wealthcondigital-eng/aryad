import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import { autoCategory } from "@/lib/study-catalogue"

// GET /api/billing
export async function GET() {
  try {
    await connectDB()
    const bills = await Bill.find().sort({ createdAt: -1 })
    return NextResponse.json({ bills })
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

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

// POST /api/billing — create a new bill
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()
    const balance = (body.charges ?? 0) - (body.discount ?? 0) - (body.paid ?? 0)
    const bill = await Bill.create({ ...body, balance })

    // Update patient study-level paid/charges and link bill
    const patient = await Patient.findById(body.patientId)
    if (patient) {
      ensureStudies(patient)
      const studyIndex = Math.min(Math.max(Number(body.studyIndex) || 0, 0), Math.max(patient.studies.length - 1, 0))
      const entry = patient.studies[studyIndex]
      if (entry) {
        entry.charges = body.charges
        entry.paid = body.paid
        entry.discount = body.discount
        entry.paymentMode = body.paymentMode
        entry.billId = bill._id
      }
      syncLegacyMirror(patient)
      patient.markModified("studies")
      await patient.save()
    }

    // Update Study catalogue prices from bill items
    for (const item of body.items ?? []) {
      if (!item.study || !item.price) continue
      const cat = autoCategory(item.study)
      await Study.findOneAndUpdate(
        { name: item.study },
        {
          $set:        { price: item.price, lastBilledAt: new Date() },
          $setOnInsert: { name: item.study, category: cat, fromCatalogue: false, firstSeenAt: new Date() },
        },
        { upsert: true }
      )
    }

    return NextResponse.json({ bill }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
