import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import Notification from "@/models/Notification"
import { autoCategory } from "@/lib/study-catalogue"

type StudyInput = { name: string; category?: string }

// Add typed-in studies to the Study catalogue if they aren't known yet
async function upsertCatalogue(studies: StudyInput[]) {
  for (const s of studies) {
    const name = String(s.name ?? "").trim()
    if (!name) continue
    await Study.findOneAndUpdate(
      { name },
      {
        $setOnInsert: {
          name,
          category:      s.category || autoCategory(name),
          price:         0,
          fromCatalogue: false,
          firstSeenAt:   new Date(),
        },
      },
      { upsert: true }
    )
  }
}

// Ensure every patient object returned to the UI has a materialized
// `studies` array (older records only have the single legacy `study` field).
function normalizeStudies(p: Record<string, unknown>) {
  const studies = p.studies as Record<string, unknown>[] | undefined
  if (!studies || studies.length === 0) {
    p.studies = p.study
      ? [{
          name:         p.study,
          category:     autoCategory(String(p.study)),
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

    const studyEntries = rawStudies
      .map((s) => ({ name: String(s.name ?? "").trim(), category: s.category || autoCategory(String(s.name ?? "")) }))
      .filter((s) => s.name)

    if (studyEntries.length === 0) {
      return NextResponse.json({ error: "At least one study is required" }, { status: 400 })
    }

    // Every registration creates a fresh patient record — even if the same
    // person already exists. Studies are only grouped under one record when
    // booked together in one registration or via the "Add Study" action.
    const last = await Patient.findOne().sort({ srNo: -1 })
    const srNo = last ? last.srNo + 1 : 1001

    const { studies: _studies, studyCategory: _sc, ...rest } = body

    const patient = await Patient.create({
      ...rest,
      srNo,
      study:   studyEntries[0].name,               // legacy mirror
      studies: studyEntries.map((s) => ({
        name: s.name, category: s.category,
        reportStatus: "pending", reportBody: "", reportDocx: "", reportPdf: "", reportSlug: "", editHistory: [],
      })),
      reportStatus: "pending",
    })

    await upsertCatalogue(studyEntries)

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
