import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Study from "@/models/Study"
import Notification from "@/models/Notification"
import { CATALOGUE_CATEGORY_MAP, CATALOGUE_PRICE_MAP, autoCategory } from "@/lib/study-catalogue"

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

    const cursor = Patient.find(query).sort({ createdAt: -1 })
    const patients = await (limit > 0 ? cursor.limit(limit) : cursor)
    return NextResponse.json({ patients })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/patients — register new patient
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const body = await req.json()

    // Auto-increment srNo
    const last = await Patient.findOne().sort({ srNo: -1 })
    const srNo = last ? last.srNo + 1 : 1001

    const patient = await Patient.create({ ...body, srNo })

    // Upsert the study into the Study catalogue (creates if not yet known)
    if (body.study) {
      // Use client-provided category → catalogue map → keyword auto-detection
      const cat = CATALOGUE_CATEGORY_MAP[body.study]
        ?? (body.studyCategory || autoCategory(body.study))
      const defaultPrice = CATALOGUE_PRICE_MAP[body.study] ?? 0
      await Study.findOneAndUpdate(
        { name: body.study },
        {
          $setOnInsert: {
            name:          body.study,
            category:      cat,
            price:         defaultPrice,
            fromCatalogue: !!CATALOGUE_CATEGORY_MAP[body.study],
            firstSeenAt:   new Date(),
          },
        },
        { upsert: true }
      )
    }

    // Notify all doctors about new patient registration
    await Notification.create({
      recipientRole: "doctor",
      type: "patient_registered",
      title: "New patient registered",
      message: `${patient.name} (Sr. ${patient.srNo})${patient.study ? ` — ${patient.study}` : ""}`,
      patientId: patient._id,
    })

    return NextResponse.json({ patient }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
