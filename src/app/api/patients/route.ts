import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import Notification from "@/models/Notification"
import { canonicalCategory } from "@/lib/study-catalogue"
import { resolveStudyCategories } from "@/lib/study-category"
import { syncPatientToRegister } from "@/lib/register-sync"
import { visitDateToTimestamp } from "@/lib/visit-date"

type StudyInput = { name: string; category?: string }

// Add typed-in studies to the Study catalogue if they aren't known yet.
// A category chosen during registration is also written back onto an existing
// catalogue entry: the registration form is one of the places the clinic is
// meant to be able to file a study, so the next booking has to offer the
// category that was just picked rather than the one it is replacing.
async function upsertCatalogue(studies: StudyInput[]) {
  for (const s of studies) {
    const name     = String(s.name ?? "").trim()
    const category = canonicalCategory(s.category)
    if (!name) continue
    await Study.findOneAndUpdate(
      { name },
      {
        ...(category ? { $set: { category } } : {}),
        $setOnInsert: {
          name,
          ...(category ? {} : { category: "" }),
          price:         0,
          fromCatalogue: false,
          firstSeenAt:   new Date(),
        },
      },
      { upsert: true }
    )
  }
}

// Fill in the category of any study the caller didn't file itself, from the
// catalogue or from the report template of the same name. Never guessed from
// the study's name — an uncategorised study stays uncategorised.
async function withResolvedCategories(studies: StudyInput[]): Promise<{ name: string; category: string }[]> {
  const cleaned = studies
    .map((s) => ({ name: String(s.name ?? "").trim(), category: canonicalCategory(s.category) }))
    .filter((s) => s.name)
  const missing = cleaned.filter((s) => !s.category).map((s) => s.name)
  if (missing.length === 0) return cleaned
  const known = await resolveStudyCategories(missing)
  return cleaned.map((s) => (s.category ? s : { ...s, category: known.get(s.name.toLowerCase()) ?? "" }))
}

// Ensure every patient object returned to the UI has a materialized
// `studies` array (older records only have the single legacy `study` field).
function normalizeStudies(p: Record<string, unknown>) {
  const studies = p.studies as Record<string, unknown>[] | undefined
  if (!studies || studies.length === 0) {
    p.studies = p.study
      ? [{
          name:         p.study,
          category:     "",
          reportStatus: p.reportStatus ?? "pending",
          reportBody:   p.reportBody ?? "",
          reportSlug:   p.reportSlug ?? "",
          editHistory:  p.editHistory ?? [],
        }]
      : []
  }
  return p
}

// GET /api/patients — fetch all patients (optional ?date=today filter)
export async function GET(req: NextRequest) {
  try {
    await connectDB()
    const { searchParams } = new URL(req.url)
    const date  = searchParams.get("date")
    const month = searchParams.get("month")

    const search = searchParams.get("search")?.trim()
    const limit  = parseInt(searchParams.get("limit") ?? "0", 10)

    const referredBy = searchParams.get("referredBy")?.trim()

    const query: Record<string, unknown> = {}
    if (referredBy) {
      query.referredBy = { $regex: `^${referredBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" }
    }
    if (date === "today") {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end   = new Date(); end.setHours(23, 59, 59, 999)
      query.createdAt = { $gte: start, $lte: end }
    }
    if (month) {
      // month format: "Jun 2026"
      query.createdAt = {
        $gte: new Date(`1 ${month}`),
        $lt:  new Date(`1 ${month} +1 month`),
      }
    }
    if (search) {
      const asNum = Number(search)
      query.$or = [
        { name:    { $regex: search, $options: "i" } },
        { contact: { $regex: search } },
        ...(Number.isFinite(asNum) && asNum > 0 ? [{ srNo: asNum }] : []),
      ]
    }

    const cursor = Patient.find(query)
      .sort({ createdAt: -1 })
      // Exclude the heavy blobs from list responses — dedicated routes serve them
      .select("-reportDocx -reportPdf -reportBody -editHistory -studies.reportDocx -studies.reportPdf -studies.reportBody -studies.editHistory")
      .lean<Record<string, unknown>[]>()
    const patients = await (limit > 0 ? cursor.limit(limit) : cursor)
    return NextResponse.json({ patients: patients.map(normalizeStudies) })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/patients — register new patient (one or more studies)
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()

    // Accept multiple studies; fall back to the legacy single `study` field
    const rawStudies: StudyInput[] = Array.isArray(body.studies) && body.studies.length > 0
      ? body.studies
      : body.study
      ? [{ name: body.study, category: body.studyCategory }]
      : []

    const studyEntries = await withResolvedCategories(rawStudies)

    if (studyEntries.length === 0) {
      return NextResponse.json({ error: "At least one study is required" }, { status: 400 })
    }

    // Every registration creates a fresh patient record — even if the same
    // person already exists. Studies are only grouped under one record when
    // booked together in one registration or via the "Add Study" action.
    const last = await Patient.findOne().sort({ srNo: -1 })
    const srNo = last ? last.srNo + 1 : 1001

    const { studies: _studies, studyCategory: _sc, visitDate: _vd, createdAt: _ca, ...rest } = body

    // The date the patient was seen, which the form may have backdated. Mongoose
    // honours an explicit createdAt on create, so nothing else has to change:
    // the register, the report date and every "patients on this day" view all
    // read createdAt already. `enteredAt` keeps when it was really typed.
    const seenOn = visitDateToTimestamp(body.visitDate)

    const patient = await Patient.create({
      ...rest,
      ...(seenOn ? { createdAt: seenOn } : {}),
      enteredAt: new Date(),
      srNo,
      study:   studyEntries[0].name,               // legacy mirror
      studies: studyEntries.map((s) => ({
        name: s.name, category: s.category,
        reportStatus: "pending", reportBody: "", reportDocx: "", reportPdf: "", reportSlug: "", editHistory: [],
      })),
      reportStatus: "pending",
    })

    await upsertCatalogue(studyEntries)

    // Mirror the booking into this month's register sheet, so the month in the
    // app always shows the imported Excel rows *and* everything booked since
    await syncPatientToRegister(patient, body.entryBy ?? "")

    // Notify all doctors about new patient registration
    const studyNames = studyEntries.map((s) => s.name).join(", ")
    await Notification.create({
      recipientRole: "doctor",
      type: "patient_registered",
      title: "New patient registered",
      message: `${patient.name} (Sr. ${patient.srNo})${studyNames ? ` — ${studyNames}` : ""}`,
      patientId: patient._id,
    })

    return NextResponse.json({ patient }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
