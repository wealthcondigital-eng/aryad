import { NextRequest, NextResponse } from "next/server"
import mongoose from "mongoose"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import { generateReportSlug } from "@/lib/report-slug"

/**
 * POST /api/patients/:id/share-link  { sidx }  ->  { slug }
 *
 * Returns the report's pretty slug, creating it if the report doesn't have one.
 *
 * Reports saved before slugs were minted on save (they used to appear only
 * alongside a stored PDF) have none, and the share buttons would otherwise
 * fall back to the raw `/api/patients/<mongo id>/pdf?sidx=0` link. Rather than
 * migrating every old record, the share button asks for a slug the first time
 * one is needed and gets the same `{patient-name}-{study-name}-report` URL a
 * new report would have.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const sidx = Math.max(0, Number(body?.sidx) || 0)

    const patient = await Patient.findById(id)
    if (!patient) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Legacy record with no studies array: treat the top-level study as study 0.
    if ((patient.studies?.length ?? 0) === 0 && patient.study) {
      if (sidx !== 0) return NextResponse.json({ error: "No such study" }, { status: 404 })
      if (!patient.reportSlug) {
        patient.reportSlug = await generateReportSlug(
          { name: patient.name, srNo: patient.srNo, studies: [] }, patient.study, id
        )
        await patient.save()
      }
      return NextResponse.json({ slug: patient.reportSlug })
    }

    const entry = patient.studies?.[sidx]
    if (!entry) return NextResponse.json({ error: "No such study" }, { status: 404 })

    if (!entry.reportSlug) {
      entry.reportSlug = await generateReportSlug(patient, entry.name, id)
      // Study 0 is mirrored onto the legacy top-level field, which older
      // lookups (and the /{slug}/pdf route's first branch) still read.
      if (sidx === 0) patient.reportSlug = entry.reportSlug
      await patient.save()
    }

    return NextResponse.json({ slug: entry.reportSlug })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
