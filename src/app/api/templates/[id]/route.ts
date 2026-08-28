import { NextRequest, NextResponse } from "next/server"
import mongoose from "mongoose"
import { connectDB } from "@/lib/db"
import Template from "@/models/Template"
import HiddenTemplate from "@/models/HiddenTemplate"
import Study from "@/models/Study"
import Patient from "@/models/Patient"
import RegisterEntry from "@/models/RegisterEntry"
import { canonicalCategory } from "@/lib/study-catalogue"
import { REPORT_TEMPLATES, TemplateCategory } from "@/lib/report-templates"

/** The bundled built-in with this slug id, plus the category it lives in. */
function findBuiltIn(id: string): { name: string; category: TemplateCategory } | null {
  for (const cat of Object.keys(REPORT_TEMPLATES) as TemplateCategory[]) {
    const found = REPORT_TEMPLATES[cat].find((t) => t.id === id)
    if (found) return { name: found.name, category: cat }
  }
  return null
}

// DELETE /api/templates/:id — remove a template.
//
// Clinic-added templates are Mongo documents and are deleted outright. Built-ins
// ship inside the app bundle, so "deleting" one records it in HiddenTemplate and
// every list filters it out; POST to this same URL puts it back.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params

    const builtIn = findBuiltIn(id)
    if (builtIn) {
      await HiddenTemplate.updateOne(
        { templateId: id },
        { $setOnInsert: { templateId: id, name: builtIn.name, category: builtIn.category } },
        { upsert: true }
      )
      return NextResponse.json({ ok: true, hidden: true })
    }

    // An id that is neither a built-in slug nor a Mongo id can't match anything —
    // answer 404 rather than letting Mongoose throw a CastError (a 500).
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const deleted = await Template.findByIdAndDelete(id)
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// PATCH /api/templates/:id — re-file or rename a clinic-added template.
//
// Categories are free-form, so moving a template into one that doesn't exist
// yet is how a new category gets created — the same rule the import dialog
// follows. Built-ins live in the app bundle and can't be edited; hide one and
// import your own copy instead.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    if (findBuiltIn(id)) {
      return NextResponse.json({ error: "Built-in templates can't be edited" }, { status: 400 })
    }
    if (!mongoose.isValidObjectId(id)) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json()
    const update: { category?: string; name?: string } = {}
    if (body.category !== undefined) {
      const category = String(body.category).trim()
      if (!category) return NextResponse.json({ error: "Category can't be empty" }, { status: 400 })
      update.category = category
    }
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: "Name can't be empty" }, { status: 400 })
      update.name = name
    }
    if (!Object.keys(update).length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const template = await Template.findByIdAndUpdate(id, update, { new: true })
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Studies are filed under the same categories templates are, and a study
    // is normally the template of the same name. Moving the template is
    // therefore also the answer to "this study is in the wrong department" —
    // the study, the patients carrying it and their register rows all follow.
    // Rows whose DEPARTMENT was typed over by hand keep what was typed.
    let movedRows = 0
    if (update.category !== undefined) {
      const category = canonicalCategory(update.category)
      const nameRe = new RegExp(`^${template.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
      await Study.updateMany({ name: nameRe }, { $set: { category } })
      await Patient.updateMany(
        { "studies.name": nameRe },
        { $set: { "studies.$[s].category": category } },
        { arrayFilters: [{ "s.name": nameRe }] }
      )
      const res = await RegisterEntry.updateMany(
        { investigation: nameRe, sourceType: "system", editedFields: { $ne: "department" } },
        { $set: { department: category } }
      )
      movedRows = res.modifiedCount ?? 0
    }

    return NextResponse.json({ template, movedRows })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/templates/:id — restore a removed built-in template.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await connectDB()
    const { id } = await params
    if (!findBuiltIn(id)) return NextResponse.json({ error: "Not a built-in template" }, { status: 400 })
    await HiddenTemplate.deleteOne({ templateId: id })
    return NextResponse.json({ ok: true, restored: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
