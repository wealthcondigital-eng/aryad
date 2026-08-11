import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Bill from "@/models/Bill"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import { autoCategory } from "@/lib/study-catalogue"
import { syncPatientToRegister } from "@/lib/register-sync"
import { applyBillToStudies, patientTotals } from "@/lib/bill-allocation"

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
  // The money mirrors the WHOLE patient, not studies[0] like the report fields
  // do: now that each study carries its own share of the bill, the screens that
  // still read these top-level figures (the dashboard's day total, the paid /
  // pending badges) would under-count a multi-study patient by every study but
  // the first.
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
      const rawIdx = Number(body.studyIndex)
      // studyIndex < 0 (or missing) → this bill covers the whole patient, so
      // link every study whose name appears on the bill. Otherwise link just
      // the one billed study.
      const linkAll = !Number.isFinite(rawIdx) || rawIdx < 0
      let targets
      if (linkAll) {
        const billed = new Set((body.items ?? []).map((i: { study?: string }) => (i.study || "").trim().toLowerCase()))
        targets = patient.studies.filter((s: { name?: string }) => billed.has((s.name || "").trim().toLowerCase()))
        if (targets.length === 0) targets = patient.studies   // fallback: nothing matched by name
      } else {
        targets = [patient.studies[Math.min(Math.max(rawIdx, 0), Math.max(patient.studies.length - 1, 0))]]
      }
      // Each study takes its own line off the bill, not the bill's total — a
      // ₹1500 scan and a ₹700 scan on one ₹2200 bill are ₹1500 and ₹700.
      const billed = targets.filter(Boolean)
      applyBillToStudies(billed, body.items, body)
      for (const entry of billed) entry.billId = bill._id
      syncLegacyMirror(patient)
      patient.markModified("studies")

      // A name/referral correction typed while raising this bill is a patient-
      // record correction, not just this bill's detail — write it through to
      // the patient so reports and every other bill for them stay in sync too.
      const identitySync: Record<string, unknown> = {}
      if (typeof body.patientName === "string" && body.patientName.trim() && body.patientName.trim() !== patient.name) {
        patient.name = body.patientName.trim()
        identitySync.patientName = patient.name
      }
      if (typeof body.referredBy === "string" && body.referredBy.trim() && body.referredBy.trim() !== patient.referredBy) {
        patient.referredBy = body.referredBy.trim()
        identitySync.referredBy = patient.referredBy
      }

      await patient.save()

      // The bill's totals are what the monthly register's money columns show —
      // each study's own share of it, over anything typed onto the sheet before
      // this bill existed.
      await syncPatientToRegister(patient, "", { moneyFromBill: true })

      if (Object.keys(identitySync).length > 0) {
        await Bill.updateMany({ patientId: patient._id, _id: { $ne: bill._id } }, { $set: identitySync })
      }
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
