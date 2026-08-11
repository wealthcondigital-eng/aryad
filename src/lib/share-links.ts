/**
 * The one place a shareable document link is built.
 *
 * Five screens send reports to patients (dashboard, patients, reports list,
 * the editor's post-submit screen, the view modal) and each used to spell the
 * URL out again, so a fix to the link had to be made five times.
 *
 * The link points straight at the FILE and ends in `.pdf`:
 *
 *     https://aaryad.com/mr-yogesh-patel-abd-pel-male-report.pdf
 *
 * A patient tapping that gets their report open in front of them, with no
 * intermediate page to read and no button to find. The `.pdf` suffix is what
 * makes the link self-explanatory in the chat and what makes phones hand it to
 * a PDF viewer; a rewrite in next.config.ts points it at the route handler.
 *
 * The HTML share page at `/{slug}` is still served and still works — it is
 * where to send someone whose in-app browser cannot display a PDF, since it
 * offers an explicit Download button for the very same file.
 */

/** A report's public link — the pretty slug when it has one. */
export function reportShareUrl(
  origin: string,
  opts: { slug?: string; patientId: string; sidx?: number }
): string {
  if (opts.slug) return `${origin}/${opts.slug}.pdf`
  // No slug yet (an older report saved before slugs existed): the id route
  // still serves the file directly.
  return `${origin}/api/patients/${opts.patientId}/pdf?sidx=${opts.sidx ?? 0}`
}

/**
 * The link to actually send someone: always the readable
 * `/{patient-name}-{study-name}-report.pdf` one.
 *
 * A report with no slug gets one minted here rather than being shared as
 * `/api/patients/<mongo id>/pdf?sidx=0` — a link that tells the patient
 * nothing, and looks to them like a tracking URL rather than their report.
 * Only if that call fails does the raw fallback get used, because sending a
 * working ugly link still beats sending none.
 */
export async function resolveReportShareUrl(
  origin: string,
  opts: { slug?: string; patientId: string; sidx?: number }
): Promise<string> {
  if (opts.slug) return `${origin}/${opts.slug}.pdf`
  try {
    const res = await fetch(`/api/patients/${opts.patientId}/share-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sidx: opts.sidx ?? 0 }),
    })
    const data = await res.json()
    if (res.ok && data?.slug) return `${origin}/${data.slug}.pdf`
  } catch {}
  return reportShareUrl(origin, opts)
}

/** A receipt's public link. */
export function receiptShareUrl(origin: string, opts: { slug?: string; billId: string }): string {
  if (opts.slug) return `${origin}/${opts.slug}.pdf`
  return `${origin}/api/billing/${opts.billId}/pdf`
}
