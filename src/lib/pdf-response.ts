import { NextResponse } from "next/server"

/**
 * Serving a stored PDF over a public link.
 *
 * Every report/receipt link a patient receives on WhatsApp ends up here, and
 * those links are opened inside WhatsApp's own in-app browser far more often
 * than in a real one. Three things about the old responses made that unreliable:
 *
 *  - No `Content-Length`. Next streams a plain Buffer body chunked, and the
 *    in-app WebViews (and iOS Quick Look) frequently show a blank page for a
 *    PDF of unknown length instead of rendering or downloading it.
 *  - No range support. Safari and several PDF viewers open a document by
 *    probing with `Range: bytes=0-...`; with no `Accept-Ranges` and no 206
 *    they can abandon the load.
 *  - A filename in `filename=` only, so anything non-ASCII in a patient's name
 *    was mangled in the saved file.
 *
 * Content is unchanged — the bytes were always correct; this is purely about
 * how they are handed over.
 */

/**
 * `Sagar_Dutta_Abd_Pelvis_Report.pdf` — safe on every filesystem, and it names
 * both the patient and the study, so someone holding several reports on their
 * phone can tell them apart.
 */
export function pdfFileName(
  name: string | undefined,
  suffix: "Report" | "Receipt",
  study?: string,
): string {
  const clean = (name || "Patient")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // strip accents rather than dropping the letter
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")

  // A long study name ("NORMAL OBS DOPPLER 3 RD TRIMISTER") would push the
  // filename past what a phone shows, so the study part is capped.
  const what = study
    ? study.normalize("NFKD").trim()
        .replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "")
        .replace(/_+/g, "_").replace(/^_|_$/g, "")
        .slice(0, 40).replace(/_$/, "")
    : ""

  return [clean || "Patient", what, suffix].filter(Boolean).join("_") + ".pdf"
}

/**
 * `inline` so a browser that can render a PDF just shows it; `attachment` when
 * the link carries `?download=1`, which is what the share page's Download
 * button uses for the WebViews that can't.
 */
function disposition(fileName: string, download: boolean): string {
  const kind = download ? "attachment" : "inline"
  // The plain filename is the ASCII fallback; filename* carries the real one.
  return `${kind}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export function pdfResponse(base64: string, fileName: string, req?: Request): NextResponse {
  const buffer = Buffer.from(base64, "base64")
  // A fresh Uint8Array, not the Buffer itself: a Buffer can be a view into a
  // larger shared pool, and a runtime that reads `.buffer` rather than the view
  // would serve the neighbouring bytes too.
  const bytes = new Uint8Array(buffer)
  const total = bytes.byteLength

  const url = req ? new URL(req.url) : null
  const download = url?.searchParams.get("download") === "1"

  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": disposition(fileName, download),
    "Content-Length": String(total),
    "Accept-Ranges": "bytes",
    // A report can be corrected and re-shared under the same link, so the
    // patient must never be served yesterday's copy out of a proxy cache.
    "Cache-Control": "no-store, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  }

  // Single-range requests only — that is all a PDF viewer's probe needs, and
  // multipart/byteranges would be a lot of machinery for no practical gain.
  const range = req?.headers.get("range")
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (match) {
    const [, rawStart, rawEnd] = match
    let start = rawStart ? parseInt(rawStart, 10) : NaN
    let end = rawEnd ? parseInt(rawEnd, 10) : total - 1
    if (!rawStart && rawEnd) {
      // "bytes=-500" means the LAST 500 bytes.
      start = Math.max(0, total - parseInt(rawEnd, 10))
      end = total - 1
    }
    if (Number.isNaN(start) || start >= total || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}`, "Accept-Ranges": "bytes" },
      })
    }
    end = Math.min(end, total - 1)
    const slice = bytes.slice(start, end + 1)
    return new NextResponse(slice, {
      status: 206,
      headers: { ...headers, "Content-Length": String(slice.byteLength), "Content-Range": `bytes ${start}-${end}/${total}` },
    })
  }

  return new NextResponse(bytes, { headers })
}

/**
 * What a patient sees when the link works but the PDF isn't there — a report
 * still being written, or one saved before the PDF was generated.
 *
 * HTML, not JSON: this is opened by a person, and `{"error":"PDF not
 * available"}` on a white page is indistinguishable from a broken link.
 */
export function pdfUnavailableResponse(message = "This report isn't ready yet."): NextResponse {
  const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report not available — Aarya Diagnostics Center</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f1f5f9;color:#0f172a;padding:24px}
  .card{background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(15,23,42,.08);padding:32px 28px;max-width:420px;text-align:center}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;line-height:1.6;color:#475569;margin:0}
  .mark{width:44px;height:44px;border-radius:12px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;
        justify-content:center;margin:0 auto 14px;font-size:22px}
</style></head><body>
  <div class="card">
    <div class="mark">📄</div>
    <h1>${message}</h1>
    <p>Please check with Aarya Diagnostics Center — once the report is finalised, this same link will open it.</p>
  </div>
</body></html>`
  return new NextResponse(html, {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  })
}
