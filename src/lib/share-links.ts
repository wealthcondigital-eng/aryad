/**
 * The one place a shareable document link is built.
 *
 * Five screens send reports to patients (dashboard, patients, reports list,
 * the editor's post-submit screen, the view modal) and each used to spell the
 * URL out again, so a fix to the link had to be made five times.
 *
 * The link points at the SHARE PAGE (/{slug}), not at the file (/{slug}/pdf).
 * Patients open these inside WhatsApp's in-app browser, whose Android WebView
 * renders a PDF as a blank page; an HTML page always renders, names the
 * patient, and hands over the same patient-named PDF through its Open and
 * Download buttons.
 */

/** A report's public link — the pretty slug when it has one. */
export function reportShareUrl(
  origin: string,
  opts: { slug?: string; patientId: string; sidx?: number }
): string {
  if (opts.slug) return `${origin}/${opts.slug}`
  // No slug yet (an older report saved before slugs existed): the id route
  // still serves the file directly.
  return `${origin}/api/patients/${opts.patientId}/pdf?sidx=${opts.sidx ?? 0}`
}

/**
 * The link to actually send someone: always the readable
 * `/{patient-name}-{study-name}-report` one.
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
  if (opts.slug) return `${origin}/${opts.slug}`
  try {
    const res = await fetch(`/api/patients/${opts.patientId}/share-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sidx: opts.sidx ?? 0 }),
    })
    const data = await res.json()
    if (res.ok && data?.slug) return `${origin}/${data.slug}`
  } catch {}
  return reportShareUrl(origin, opts)
}

/** A receipt's public link. */
export function receiptShareUrl(origin: string, opts: { slug?: string; billId: string }): string {
  if (opts.slug) return `${origin}/${opts.slug}`
  return `${origin}/api/billing/${opts.billId}/pdf`
}
