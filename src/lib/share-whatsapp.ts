"use client"

/**
 * The one WhatsApp share flow: convert the saved report to PDF, store it, then
 * hand WhatsApp a link that opens that PDF.
 *
 * Every share button used to build a URL and open WhatsApp immediately, which
 * is why a report could be sent before any PDF of it existed. The conversion
 * now happens first, and the message is only composed once it has succeeded.
 *
 * Nothing is opened until the PDF is ready. Opening the WhatsApp tab up front
 * and parking a "preparing…" page in it does dodge the popup blocker, but it
 * puts an idle about:blank tab in front of the sender for the whole
 * conversion — so the wait is shown on the page that started the share
 * (showConvertingOverlay) and the tab only appears when there is something to
 * open. If the blocker swallows that late window.open, whatsAppPrompt turns the
 * same overlay into a button, which opens on a fresh click.
 */

import { buildAndStoreReportPdf } from "@/lib/report-pdf"
import { reportShareUrl } from "@/lib/share-links"
import { showAlert } from "@/components/confirm-dialog"

/**
 * A blocking "converting" overlay on the page that started the share.
 *
 * Rasterizing a multi-page report takes a few seconds, during which nothing
 * used to change on screen — so it read as a dead button, and a second click
 * would start a second conversion. Built with plain DOM rather than React so
 * the three list screens (and anything added later) get it from the one share
 * function instead of each wiring up its own spinner state.
 */
const OVERLAY_CSS =
  "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;" +
  "background:rgba(15,23,42,.45);backdrop-filter:blur(2px);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif"

const CARD_CSS =
  "background:#fff;border-radius:16px;padding:24px 28px;box-shadow:0 20px 45px rgba(15,23,42,.25);text-align:center;min-width:260px"

function overlay(inner: string): { host: HTMLDivElement; close: () => void } {
  const host = document.createElement("div")
  host.setAttribute("data-report-pdf-overlay", "")
  host.style.cssText = OVERLAY_CSS
  host.innerHTML = `<div style="${CARD_CSS}">${inner}</div>`
  document.body.appendChild(host)
  return { host, close: () => { try { host.remove() } catch {} } }
}

function showConvertingOverlay(): () => void {
  if (typeof document === "undefined") return () => {}
  return overlay(`
    <div style="width:34px;height:34px;margin:0 auto 12px;border:3px solid #dbeafe;border-top-color:#2563eb;border-radius:50%;animation:aaryaSpin .8s linear infinite"></div>
    <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a">Converting the report to PDF…</p>
    <p style="margin:6px 0 0;font-size:12px;color:#64748b">WhatsApp opens as soon as it is ready.</p>
    <style>@keyframes aaryaSpin{to{transform:rotate(360deg)}}</style>`).close
}

/**
 * Shown only when the browser refused the WhatsApp tab.
 *
 * A popup blocker discards a window.open that happens after an await, and a
 * report takes seconds to rasterize — so the click that started the share has
 * usually stopped counting as one by the time the link exists. The button here
 * is a fresh click, which is never blocked.
 */
function whatsAppPrompt(href: string) {
  if (typeof document === "undefined") return
  const { host, close } = overlay(`
    <div style="font-size:26px;margin-bottom:8px">✅</div>
    <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a">The report PDF is ready.</p>
    <p style="margin:6px 0 14px;font-size:12px;color:#64748b">Your browser blocked the new tab.</p>
    <a href="${href}" target="_blank" rel="noopener noreferrer"
       style="display:block;background:#16a34a;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 16px;border-radius:10px">
      Open WhatsApp
    </a>
    <button type="button" data-close
            style="margin-top:8px;background:none;border:0;color:#64748b;font-size:12px;cursor:pointer">Not now</button>`)
  host.addEventListener("click", (e) => {
    const el = e.target as HTMLElement
    if (el === host || el.closest("[data-close]") || el.closest("a")) close()
  })
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
 * human-readable) when there is one, so the caller can show it; nothing is
 * opened on failure, since there is no report to send.
 */
let sharing = false

export async function shareReportOnWhatsApp(t: WhatsAppShareTarget): Promise<{ ok: boolean; error?: string }> {
  // A second click while the first conversion is still running would rasterize
  // the same report twice and open two tabs.
  if (sharing) return { ok: true }
  sharing = true

  const hideOverlay = showConvertingOverlay()

  let result
  try {
    result = await buildAndStoreReportPdf(t.patientId, t.sidx)
  } finally {
    hideOverlay()
    sharing = false
  }

  if (!result.ok) {
    const error = result.empty
      ? "This report has no content yet, so there is nothing to send."
      : result.error || "Couldn't prepare the PDF."
    // Said here rather than left to the caller: the list screens share from a
    // plain function with no state of their own, and a failure that only came
    // back as a return value would leave the sender staring at a button that
    // did nothing.
    showAlert({ title: "Couldn't share this report", message: error })
    return { ok: false, error }
  }

  const url = reportShareUrl(window.location.origin, {
    slug: result.slug, patientId: t.patientId, sidx: t.sidx,
  })
  const msg = `Dear ${t.patientName},\n\nYour *${t.studyName}* report from *Aarya Diagnostics Center* is ready.\n\n📄 Download your report:\n${url}`
  const digits = (t.contact || "").replace(/\D/g, "")
  const wa = digits
    ? `https://wa.me/91${digits}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`

  const win = window.open(wa, "_blank")
  if (win) win.focus()
  else whatsAppPrompt(wa)
  return { ok: true }
}
