import { NextRequest, NextResponse } from "next/server"
import { connectDB } from "@/lib/db"
import Template from "@/models/Template"
import { countTrailingSignatories, htmlText, splitHeaderFromHtml, splitHeaderFromPlainText } from "@/lib/doc-import"
import { REPORT_TEMPLATES, TemplateCategory } from "@/lib/report-templates"

function buildPreview(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

// Case-insensitive exact-name match against both clinic-added templates (DB)
// and the built-in bundled ones — either counts as "already present".
async function findDuplicateByName(name: string): Promise<{ source: "custom" | "built-in"; category: string } | null> {
  const trimmed = name.trim()
  if (!trimmed) return null
  const re = new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")

  const existingCustom = await Template.findOne({ name: re })
  if (existingCustom) return { source: "custom", category: existingCustom.category }

  for (const cat of Object.keys(REPORT_TEMPLATES) as TemplateCategory[]) {
    const found = REPORT_TEMPLATES[cat].find((t) => t.name.toLowerCase() === trimmed.toLowerCase())
    if (found) return { source: "built-in", category: cat }
  }
  return null
}

// GET /api/templates — every clinic-added template (built-ins live in report-templates.ts)
export async function GET() {
  try {
    await connectDB()
    const templates = await Template.find().sort({ createdAt: -1 })
    return NextResponse.json({ templates })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

// POST /api/templates — add a new template, either:
//  - multipart/form-data with a `file` — modern .docx (via mammoth) or legacy
//    .doc (read directly by doc-binary.ts) are both accepted, or
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
        // high-fidelity path below instead of flattening it to plain text.
        // Returns null when LibreOffice isn't installed; that case is reported
        // explicitly below because silently losing the formatting is worse.
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
          previewSource = htmlText(split.bodyHtml)
        } else {
          // Legacy .doc with no LibreOffice on this host. doc-binary.ts reads
          // the binary format directly — fonts, sizes, bold/underline,
          // alignment, paragraph spacing and tables all come out of the FILE —
          // so these imports go down the same rich-HTML path a .docx does
          // instead of being rebuilt from bare text by regexes.
          const { parseLegacyDoc } = await import("@/lib/doc-binary")
          const parsed = parseLegacyDoc(buffer)

          if (parsed) {
            signatureCount = countTrailingSignatories(parsed.text)
            const split = splitHeaderFromHtml(parsed.html, parsed.text, true, true)
            detectedHeading = split.heading
            bodyHtml = split.bodyHtml
            previewSource = htmlText(split.bodyHtml)
          } else {
            // Encrypted, or some shape the reader doesn't recognise. Plain text
            // is all that's left, and doc-import.ts rebuilds an approximation.
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
            previewSource = htmlText(split.bodyHtml)
          }
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

    const preview = buildPreview(htmlText(body))
    const template = await Template.create({ category, name, heading, preview, body })
    return NextResponse.json({ template }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
