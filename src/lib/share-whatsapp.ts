"use client"

/**
 * The one WhatsApp share flow: convert the saved report to PDF, store it, then
 * hand WhatsApp a link that opens that PDF.
 *
 * Every share button used to build a URL and open WhatsApp immediately, which
 * is why a report could be sent before any PDF of it existed. The conversion
 * now happens first, and the message is only composed once it has succeeded.
 *
 * The WhatsApp tab is opened before the await (a popup blocker discards a
 * window.open that happens after one) and shows a short "preparing" page
 * meanwhile, so the sender isn't left staring at a blank tab while a
 * multi-page report rasterizes.
 */

import { buildAndStoreReportPdf } from "@/lib/report-pdf"
import { reportShareUrl } from "@/lib/share-links"

/**
 * A blocking "converting" overlay on the page that started the share.
 *
 * Rasterizing a multi-page report takes a few seconds, during which nothing
 * used to change on screen — so it read as a dead button, and a second click
 * would start a second conversion. Built with plain DOM rather than React so
 * the three list screens (and anything added later) get it from the one share
 * function instead of each wiring up its own spinner state.
 */
function showConvertingOverlay(): () => void {
  if (typeof document === "undefined") return () => {}
  const host = document.createElement("div")
  host.setAttribute("data-report-pdf-overlay", "")
  host.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(15,23,42,.45);backdrop-filter:blur(2px);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"
  host.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px 28px;box-shadow:0 20px 45px rgba(15,23,42,.25);text-align:center;min-width:260px">
      <div style="width:34px;height:34px;margin:0 auto 12px;border:3px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:aaryaSpin .8s linear infinite"></div>
      <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a">Converting the report to PDF…</p>
      <p style="margin:6px 0 0;font-size:12px;color:#64748b">WhatsApp opens as soon as it is ready.</p>
    </div>
    <style>@keyframes aaryaSpin{to{transform:rotate(360deg)}}</style>`
  document.body.appendChild(host)
  return () => { try { host.remove() } catch {} }
}

function holdingPage(win: Window | null, message: string) {
  if (!win) return
  try {
    win.document.write(`<!DOCTYPE html><meta charset="utf-8">
<title>Preparing the report…</title>
<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
             font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#0f172a">
  <div style="text-align:center">
    <div style="font-size:28px;margin-bottom:10px">📄</div>
    <p style="margin:0;font-size:15px;font-weight:600">${message}</p>
    <p style="margin:6px 0 0;font-size:13px;color:#64748b">This tab will open WhatsApp automatically.</p>
  </div>
</body>`)
    win.document.close()
  } catch { /* cross-origin or blocked — the redirect below still works */ }
}

export interface WhatsAppShareTarget {
  patientId: string
  sidx: number
  patientName: string
  studyName: string
  /** Digits only; omit to let the sender pick the recipient in WhatsApp. */
  contact?: string
}

/**
 * Converts, stores, then opens WhatsApp. Returns the problem (already
 * human-readable) when there is one, so the caller can show it; the opened
 * tab is closed in that case rather than left hanging.
 */
let sharing = false

export async function shareReportOnWhatsApp(t: WhatsAppShareTarget): Promise<{ ok: boolean; error?: string }> {
  // A second click while the first conversion is still running would rasterize
  // the same report twice and open two tabs.
  if (sharing) return { ok: true }
  sharing = true

  const win = typeof window !== "undefined" ? window.open("", "_blank") : null
  holdingPage(win, "Converting the report to PDF…")
  const hideOverlay = showConvertingOverlay()

  let result
  try {
    result = await buildAndStoreReportPdf(t.patientId, t.sidx)
  } finally {
    hideOverlay()
    sharing = false
  }

  if (!result.ok) {
    try { win?.close() } catch {}
    return {
      ok: false,
      error: result.empty
        ? "This report has no content yet, so there is nothing to send."
        : result.error || "Couldn't prepare the PDF.",
    }
  }

  const url = reportShareUrl(window.location.origin, {
    slug: result.slug, patientId: t.patientId, sidx: t.sidx,
  })
  const msg = `Dear ${t.patientName},\n\nYour *${t.studyName}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${url}`
  const digits = (t.contact || "").replace(/\D/g, "")
  const wa = digits
    ? `https://wa.me/91${digits}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`

  if (win) win.location.href = wa
  else window.open(wa, "_blank")
  return { ok: true }
}
