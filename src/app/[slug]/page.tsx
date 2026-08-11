import type { Metadata } from "next"
import { connectDB } from "@/lib/db"
import Patient from "@/models/Patient"
import Bill from "@/models/Bill"
import Signatory from "@/models/Signatory"
import { reportHeaderHtml, reportTitleHtml, stripReportEditMarks, REPORT_BODY_FONT_SIZE_PX, REPORT_BODY_LINE_HEIGHT } from "@/lib/report-layout"
import { signatureColumnsHtml, type Signatory as SignatoryInfo } from "@/lib/report-signatures"

/**
 * The page a patient lands on from the WhatsApp link.
 *
 * The link used to point straight at /{slug}/pdf. That is fine in a desktop
 * browser, but most patients open it inside WhatsApp's own in-app browser,
 * and the Android WebView cannot render a PDF at all — it shows a blank white
 * page. There is no header that fixes that; the answer is to send them to a
 * real HTML page which then hands over the file.
 *
 * So: this page states whose report it is, embeds the PDF where the browser
 * can show one, and always offers Open and Download buttons that go to the
 * same /{slug}/pdf file — named after the patient either way.
 */

type Found =
  | {
      kind: "report"; name: string; study: string; date: string; hasPdf: boolean
      /** Everything needed to draw the report itself when no PDF is stored. */
      render?: {
        bodyHtml: string
        heading: string
        headingFont?: string
        boxFont?: string
        age?: number
        gender?: string
        refBy?: string
        srNo?: number
        signatureLayout?: unknown[]
      }
    }
  | { kind: "receipt"; name: string; date: string; hasPdf: boolean }
  | null

const dateOf = (d?: Date | string) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""

/**
 * Looks the slug up without ever loading the base64 PDF itself — a stored
 * report runs to megabytes, and this page only needs to know whether one is
 * there. The `$strLenCP` projections answer that inside MongoDB.
 */
async function findBySlug(slug: string): Promise<Found> {
  await connectDB()

  const [patient] = await Patient.aggregate([
    { $match: { $or: [{ reportSlug: slug }, { "studies.reportSlug": slug }] } },
    { $limit: 1 },
    {
      $project: {
        name: 1, study: 1, createdAt: 1, reportSlug: 1,
        age: 1, gender: 1, referredBy: 1, srNo: 1,
        reportBody: 1, heading: 1, headingFont: 1, patientBoxFont: 1, signatureLayout: 1,
        hasRootPdf: { $gt: [{ $strLenCP: { $ifNull: ["$reportPdf", ""] } }, 0] },
        studies: {
          $map: {
            input: { $ifNull: ["$studies", []] }, as: "s",
            in: {
              name: "$$s.name",
              reportSlug: "$$s.reportSlug",
              // The body is the report itself, so it does come across — but
              // reportPdf/reportDocx (megabytes of base64) deliberately don't.
              reportBody: "$$s.reportBody",
              heading: "$$s.heading",
              headingFont: "$$s.headingFont",
              patientBoxFont: "$$s.patientBoxFont",
              signatureLayout: "$$s.signatureLayout",
              hasPdf: { $gt: [{ $strLenCP: { $ifNull: ["$$s.reportPdf", ""] } }, 0] },
            },
          },
        },
      },
    },
  ])

  if (patient) {
    const entry = (patient.studies ?? []).find((s: { reportSlug?: string }) => s.reportSlug === slug)
    const src = entry ?? patient
    const bodyHtml: string = src.reportBody || ""
    return {
      kind: "report",
      name: patient.name || "Patient",
      study: entry?.name || patient.study || "",
      date: dateOf(patient.createdAt),
      hasPdf: entry ? !!entry.hasPdf : !!patient.hasRootPdf,
      render: bodyHtml
        ? {
            bodyHtml,
            heading: src.heading || "",
            headingFont: src.headingFont || undefined,
            boxFont: src.patientBoxFont || undefined,
            age: patient.age,
            gender: patient.gender,
            refBy: patient.referredBy,
            srNo: patient.srNo,
            signatureLayout: src.signatureLayout || [],
          }
        : undefined,
    }
  }

  const [bill] = await Bill.aggregate([
    { $match: { billSlug: slug } },
    { $limit: 1 },
    {
      $project: {
        patientName: 1, createdAt: 1,
        hasPdf: { $gt: [{ $strLenCP: { $ifNull: ["$billPdf", ""] } }, 0] },
      },
    },
  ])
  if (bill) {
    return { kind: "receipt", name: bill.patientName || "Patient", date: dateOf(bill.createdAt), hasPdf: !!bill.hasPdf }
  }
  return null
}

// What WhatsApp shows in the link preview before anyone taps it.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const found = await findBySlug(slug).catch(() => null)
  if (!found) return { title: "Aarya Diagnostics Center" }
  const what = found.kind === "report" ? "Report" : "Receipt"
  return {
    title: `${found.name} — ${what} | Aarya Diagnostics Center`,
    description: found.kind === "report" && found.study
      ? `${found.study} · ${found.date}`
      : `${what} · ${found.date}`,
  }
}

/**
 * The report drawn as HTML, for when no PDF has been generated yet.
 *
 * PDFs are built in the browser when a doctor presses Share, so a report can
 * be finished and shared from a list screen before one exists. Sending the
 * patient a link that says "not ready yet" about a report that IS ready is
 * worse than simply showing them the report — same patient box, heading, body
 * and sign-off, drawn from the same helpers the printout uses.
 */
async function ReportPreview({ found, date }: { found: Extract<Found, { kind: "report" }>; date: string }) {
  const r = found.render
  if (!r) return null

  const docs = await Signatory.find().sort({ order: 1 }).lean<SignatoryInfo[]>().catch(() => [])
  const signatures = signatureColumnsHtml(
    docs ?? [],
    (r.signatureLayout ?? []) as Parameters<typeof signatureColumnsHtml>[1]
  )

  return (
    <div className="border-t border-slate-100 bg-slate-50 p-3 sm:p-5">
      <div className="report-paper mx-auto max-w-[794px] rounded-lg border border-slate-200 bg-white p-5 sm:p-10">
        <div dangerouslySetInnerHTML={{ __html: reportHeaderHtml(
          { name: found.name, refBy: r.refBy, date, age: r.age, gender: r.gender, srNo: r.srNo || undefined },
          r.boxFont,
        ) }} />
        <div dangerouslySetInnerHTML={{ __html: reportTitleHtml(r.heading, r.headingFont) }} />
        <div
          className="doc-field text-slate-900"
          style={{ fontSize: `${REPORT_BODY_FONT_SIZE_PX}px`, lineHeight: REPORT_BODY_LINE_HEIGHT, whiteSpace: "pre-wrap" }}
          dangerouslySetInnerHTML={{ __html: stripReportEditMarks(r.bodyHtml) }}
        />
        <div style={{ display: "flex", gap: "30px", marginTop: 0 }} dangerouslySetInnerHTML={{ __html: signatures }} />
      </div>
    </div>
  )
}

export default async function SharedDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await findBySlug(slug).catch(() => null)

  const heading = found?.kind === "receipt" ? "Receipt" : "Report"
  // The same file the WhatsApp link points at, in the same `.pdf` form, so a
  // patient who saves it from here gets the URL they were sent.
  const fileUrl = `/${encodeURIComponent(slug)}.pdf`
  const canPreview = found?.kind === "report" && !found.hasPdf && !!found.render

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-7">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-600">
              Aarya Diagnostics Center
            </p>
            {found ? (
              <>
                <h1 className="mt-1 text-lg font-bold text-slate-900 sm:text-xl">{found.name}</h1>
                <p className="mt-0.5 text-sm text-slate-500">
                  {heading}
                  {found.kind === "report" && found.study ? ` · ${found.study}` : ""}
                  {found.date ? ` · ${found.date}` : ""}
                </p>
              </>
            ) : (
              <h1 className="mt-1 text-lg font-bold text-slate-900 sm:text-xl">Document not found</h1>
            )}
          </div>

          {found?.hasPdf ? (
            <>
              <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:px-7">
                {/* Open in whatever the device uses for PDFs. */}
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
                >
                  Open {heading.toLowerCase()}
                </a>
                {/* ?download=1 sends it as an attachment, which is the only
                    thing that works in an in-app browser that can't display
                    a PDF. The file is named after the patient either way. */}
                <a
                  href={`${fileUrl}?download=1`}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-center text-sm font-semibold text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700"
                >
                  Download PDF
                </a>
              </div>

              {/* Inline preview for browsers that can render a PDF. Hidden on
                  small screens, where the in-app browsers mostly can't and an
                  empty grey box would only look broken. */}
              <div className="hidden border-t border-slate-100 bg-slate-50 p-3 sm:block">
                <iframe
                  src={`${fileUrl}#view=FitH`}
                  title={`${found.name} ${heading}`}
                  className="h-[70vh] w-full rounded-lg border border-slate-200 bg-white"
                />
              </div>
            </>
          ) : canPreview ? (
            /* No PDF stored, but the report itself is here — show it. */
            <ReportPreview found={found as Extract<Found, { kind: "report" }>} date={found?.date ?? ""} />
          ) : (
            <div className="px-5 py-8 text-center sm:px-7">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-xl">
                📄
              </div>
              <p className="text-sm font-semibold text-slate-800">
                {found ? `This ${heading.toLowerCase()} isn't ready yet.` : "This link doesn't point to a document."}
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">
                Please check with Aarya Diagnostics Center — once it is finalised, this same link will open it.
              </p>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Shared securely by Aarya Diagnostics Center
        </p>
      </div>
    </main>
  )
}
