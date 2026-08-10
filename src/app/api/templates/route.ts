import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Template from "@/models/Template"
import HiddenTemplate from "@/models/HiddenTemplate"
import { countTrailingSignatories, splitHeaderFromHtml, splitHeaderFromPlainText } from "@/lib/doc-import"
import { REPORT_TEMPLATES, TemplateCategory } from "@/lib/report-templates"

function buildPreview(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

// Case-insensitive exact-name match against both clinic-added templates (DB)
// and the built-in bundled ones — either counts as "already present". A
// built-in the clinic has removed does not: re-importing the clinic's own
// version of a template they deliberately deleted is the normal way to
// replace it, so warning about a clash with something no longer visible
// anywhere in the app would just be noise.
async function findDuplicateByName(name: string): Promise<{ source: "custom" | "built-in"; category: string } | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const re = new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")

  const existingCustom = await Template.findOne({ name: re })
  if (existingCustom) return { source: "custom", category: existingCustom.category }

  const hidden = new Set<string>((await HiddenTemplate.find().select("templateId")).map((h: { templateId: string }) => h.templateId))
  for (const cat of Object.keys(REPORT_TEMPLATES) as TemplateCategory[]) {
    const found = REPORT_TEMPLATES[cat].find((t) => t.name.toLowerCase() === trimmed.toLowerCase() && !hidden.has(t.id))
    if (found) return { source: "built-in", category: cat }
  }
  return null
}

// GET /api/templates — every clinic-added template (built-ins live in
// report-templates.ts), plus the ids of built-ins the clinic has removed so
// callers can filter those out of the bundled list.
export async function GET() {
  try {
    await connectDB()
    const [templates, hidden] = await Promise.all([
      Template.find().sort({ createdAt: -1 }),
      HiddenTemplate.find().sort({ createdAt: -1 }),
    ])
    return NextResponse.json({
      templates,
      hiddenBuiltIns: hidden.map((h: { templateId: string; name: string; category: string }) => ({
        id: h.templateId, name: h.name, category: h.category,
      })),
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/templates — add a new template, either:
//  - multipart/form-data with a `file` — modern .docx (via mammoth) or legacy
//    .doc (via word-extractor) are both accepted, or
//  - application/json with a ready-made `body` HTML string
// A name that already exists (built-in or clinic-added) is rejected with a
// 409 unless the caller passes `force` — the client uses that to show a
// "this already exists — add anyway?" confirmation before resubmitting.
export async function POST(req: NextRequest) {
  try {
    await connectDB()
    const contentType = req.headers.get("content-type") || ""

    let category = "", name = "", heading = "", body = ""
    let signatureCount: number | undefined

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData()
      category = String(form.get("category") ?? "").trim()
      name     = String(form.get("name") ?? "").trim()
      const force = String(form.get("force") ?? "") === "1"
      const file = form.get("file")

      if (!(file instanceof Blob)) {
        return NextResponse.json({ error: "A .doc or .docx file is required" }, { status: 400 })
      }

      const fileName = (file as File).name || "Template"
      const isDocx = /\.docx$/i.test(fileName)
      const isDoc  = /\.doc$/i.test(fileName) && !isDocx
      if (!isDocx && !isDoc) {
        return NextResponse.json({ error: "Only .doc and .docx files are supported" }, { status: 400 })
      }

      if (!name) {
        // fall back to the filename (minus extension) if no name was typed
        name = fileName.replace(/\.docx?$/i, "").replace(/[_-]+/g, " ").trim()
      }
      if (!category) {
        return NextResponse.json({ error: "Category is required" }, { status: 400 })
      }

      // Check for a duplicate name before doing any (comparatively expensive)
      // file parsing — nothing is read from the upload at all in this case.
      if (!force) {
        const dup = await findDuplicateByName(name)
        if (dup) {
          return NextResponse.json({
            duplicate: true,
            message: `A template named "${name}" already exists${dup.source === "built-in" ? " (built-in)" : ""}.`,
          }, { status: 409 })
        }
      }

      const arrayBuf = await file.arrayBuffer()
      const buffer   = Buffer.from(arrayBuf)

      // The clinic's Word files always lead with a NAME/DATE/AGE/REF.BY/SEX
      // block and the study title before the actual findings — the report
      // editor already shows the patient box and heading separately, so pull
      // those out here rather than duplicating them inside the report body.
      let detectedHeading = "", bodyHtml = "", previewSource = ""

      // Corrupted files, password-protected files, and Word's own hidden
      // "~$file.doc" lock files (created while a document is open elsewhere)
      // all throw here — caught explicitly so the response is a clean 400
      // instead of a generic 500.
      try {
        // A legacy .doc is converted to .docx first so it can take the
        // high-fidelity path below instead of the text-only one. Returns null
        // when LibreOffice isn't installed on this host, in which case the old
        // word-extractor fallback still runs — see doc-convert.ts.
        let docxBuffer: Buffer | null = isDocx ? buffer : null
        if (!isDocx) {
          const { convertDocToDocx } = await import("@/lib/doc-convert")
          docxBuffer = await convertDocToDocx(buffer)
        }

        if (docxBuffer) {
          const { renderDocxToHtml } = await import("@/lib/docx-render")
          const html = await renderDocxToHtml(docxBuffer)
          // Plain text still comes from mammoth: it is only used to detect the
          // study heading when the HTML structure doesn't match the expected
          // shape, and it is the cheapest reliable way to get it.
          const mammoth = await import("mammoth")
          const { value: text } = await mammoth.extractRawText({ buffer: docxBuffer })
          signatureCount = countTrailingSignatories(text)
          if (!html.trim()) {
            return NextResponse.json({ error: "Couldn't read any content from that file" }, { status: 400 })
          }
          // Keep the source document's own sign-off. Rebuilding it from the
          // Signatures collection loses Word-specific font/weight/spacing and
          // credentials such as the registration number.
          const split = splitHeaderFromHtml(html, text, true, true)
          detectedHeading = split.heading
          bodyHtml = split.bodyHtml
          previewSource = split.bodyHtml.replace(/<[^>]+>/g, " ")
        } else {
          // Legacy .doc with no LibreOffice available. word-extractor returns
          // plain text only, so everything visual in the original is already
          // gone by this point and doc-import.ts rebuilds an approximation.
          const { default: WordExtractor } = await import("word-extractor")
          const doc = await new WordExtractor().extract(buffer)
          const text = doc.getBody()
          signatureCount = countTrailingSignatories(text)
          if (!text.trim()) {
            return NextResponse.json({ error: "Couldn't read any content from that file" }, { status: 400 })
          }
          const split = splitHeaderFromPlainText(text, true)
          detectedHeading = split.heading
          bodyHtml = split.bodyHtml
          previewSource = split.bodyHtml.replace(/<[^>]+>/g, " ")
        }
      } catch {
        return NextResponse.json({ error: "Couldn't read this file — it may be corrupted, password-protected, or not a real Word document" }, { status: 400 })
      }

      heading = String(form.get("heading") ?? "").trim() || detectedHeading || name.toUpperCase()
      body = bodyHtml
      const preview = buildPreview(previewSource)

      // Last line of defense: never let an unforeseen edge case in the
      // header/signature stripping reach Mongoose with an empty body —
      // that would throw an uncaught validation error (500) instead of a
      // clean, actionable message.
      if (!body.replace(/<[^>]+>/g, "").trim()) {
        return NextResponse.json({ error: "Couldn't extract any report content from that file" }, { status: 400 })
      }

      const template = await Template.create({
        category, name, heading, preview, body, signatureCount,
        preserveSignature: true,
      })
      return NextResponse.json({ template }, { status: 201 })
    }

    // JSON path — manually authored template (no file import)
    const json = await req.json()
    category = String(json.category ?? "").trim()
    name     = String(json.name ?? "").trim()
    heading  = String(json.heading ?? "").trim() || name.toUpperCase()
    body     = String(json.body ?? "")
    const force = json.force === true

    if (!category) return NextResponse.json({ error: "Category is required" }, { status: 400 })
    if (!name)  return NextResponse.json({ error: "Template name is required" }, { status: 400 })
    if (!body.trim()) return NextResponse.json({ error: "Template body is required" }, { status: 400 })

    if (!force) {
      const dup = await findDuplicateByName(name)
      if (dup) {
        return NextResponse.json({
          duplicate: true,
          message: `A template named "${name}" already exists${dup.source === "built-in" ? " (built-in)" : ""}.`,
        }, { status: 409 })
      }
    }

    const preview = buildPreview(body.replace(/<[^>]+>/g, " "))
    const template = await Template.create({ category, name, heading, preview, body })
    return NextResponse.json({ template }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
