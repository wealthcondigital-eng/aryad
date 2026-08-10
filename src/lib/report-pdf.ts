"use client"

/**
 * Building a report's PDF and storing it, from anywhere.
 *
 * A report is written and saved as a document; the patient must receive a PDF.
 * That conversion used to happen in exactly two places — the view modal's Share
 * button and the editor's post-submit screen — because both had the rendered
 * report on screen to rasterize. Sharing from the reports list, the patients
 * list or the dashboard did no conversion at all: it just built a link and
 * opened WhatsApp, so the patient could be sent a link to a PDF that had never
 * been generated.
 *
 * buildPagedPdfBlob builds its own off-screen A4 host from HTML strings, so it
 * never needed the report to be on screen. This wraps it: fetch the saved
 * report, rasterize it, store it, and hand back the slug the link is built
 * from. The PDF is rebuilt on every share on purpose — a report that was
 * corrected after it was last shared must not go out as the old copy.
 */

import { reportHeaderHtml, reportTitleHtml, stripReportEditMarks, LETTERHEAD_TOP_PX, LETTERHEAD_BOTTOM_PX } from "@/lib/report-layout"
import { fetchSignatories, signatureColumnsHtml, type SignatureLayout } from "@/lib/report-signatures"

const dateOf = (d?: string) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""

export interface StoredReportPdf {
  ok: boolean
  slug?: string
  /** Set when there is simply nothing to convert yet. */
  empty?: boolean
  error?: string
}

export async function buildAndStoreReportPdf(patientId: string, sidx = 0): Promise<StoredReportPdf> {
  try {
    const res = await fetch(`/api/patients/${patientId}`)
    const data = await res.json()
    const p = data?.patient
    if (!p) return { ok: false, error: "Couldn't load this report." }

    const entry = p.studies?.[sidx] ?? {}
    const bodyHtml = stripReportEditMarks(entry.reportBody || p.reportBody || "")
    // Nothing written yet — converting a blank page to PDF and sending it is
    // worse than telling the sender the report isn't ready.
    if (!bodyHtml.replace(/<[^>]+>/g, "").trim()) return { ok: false, empty: true }

    const heading        = entry.heading        ?? p.heading        ?? ""
    const headingFont    = entry.headingFont    || p.headingFont    || undefined
    const patientBoxFont = entry.patientBoxFont || p.patientBoxFont || undefined
    const headerPx       = entry.headerHeightPx || p.headerHeightPx || LETTERHEAD_TOP_PX
    const footerPx       = entry.footerHeightPx || p.footerHeightPx || LETTERHEAD_BOTTOM_PX
    const layout: (SignatureLayout | null | undefined)[] = entry.signatureLayout || p.signatureLayout || []

    const signatories = await fetchSignatories()

    const { buildPagedPdfBlob } = await import("@/lib/dom-to-pdf")
    const pdfBlob = await buildPagedPdfBlob({
      headerHtml: reportHeaderHtml({
        name: p.name,
        refBy: p.referredBy,
        date: dateOf(entry.reportDate || p.reportDate || p.createdAt),
        age: p.age,
        gender: p.gender,
        srNo: p.srNo || undefined,
      }, patientBoxFont),
      // An empty heading yields no heading box at all (reportTitleHtml), which
      // is what a report written without a template should look like.
      titleHtml: reportTitleHtml(heading, headingFont),
      bodyHtml,
      signaturesHtml: signatureColumnsHtml(signatories, layout),
      headerTopPx: headerPx,
      footerBottomPx: footerPx,
    })

    const bytes = new Uint8Array(await pdfBlob.arrayBuffer())
    let binary = ""
    // Chunked so a multi-megabyte PDF can't blow the argument limit of
    // String.fromCharCode(...spread).
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    }
    const base64 = btoa(binary)

    // Storing the PDF also mints the report's slug server-side, so the pretty
    // link exists by the time this returns.
    const saveRes = await fetch(`/api/patients/${patientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportPdf: base64, studyIndex: sidx }),
    })
    if (!saveRes.ok) {
      return {
        ok: false,
        error: saveRes.status === 413
          ? "The report is too large to store — usually the images in it."
          : "Couldn't save the PDF. Please try again.",
      }
    }
    const saved = await saveRes.json()
    const slug = saved?.patient?.studies?.[sidx]?.reportSlug || saved?.patient?.reportSlug
    return { ok: true, slug }
  } catch (err) {
    // The real reason, not just "try again". A silent generic message here is
    // how a hard failure in the rasterizer (it could not parse Tailwind's
    // oklch colours, so every single conversion threw) went unnoticed long
    // enough for reports to be shared with no PDF behind them at all.
    console.error("Report PDF build failed:", err)
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Couldn't prepare the PDF: ${detail}` }
  }
}
