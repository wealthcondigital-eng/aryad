// Shared parsing for imported Word templates (both legacy .doc and modern
// .docx). The clinic's real report files all follow the same shape: a
// NAME/DATE/AGE/REF.BY/SEX header block, then the study heading on its own
// line, then the actual findings. The report editor already renders the
// patient box and heading as separate, non-editable elements, so importing
// them again as part of the body would duplicate what's already on screen —
// these helpers detect and strip that leading block, recovering the real
// study heading along the way. Every step degrades gracefully: if the shape
// doesn't match, the original text/html is kept as-is rather than losing content.
//
// The body HTML is also normalised to the same "<div>line</div><div><br></div>"
// paragraph-plus-blank-line shape the bundled built-in templates already use
// (it's what a contentEditable box naturally produces too), with section
// labels like "LIVER :" bolded the same way — otherwise imported templates
// render cramped and unstyled next to the built-in ones.

const PATIENT_INFO_RE = /\b(NAME|DATE|AGE|REF\.?\s*BY|SEX|MOBILE|SR\.?\s*NO)\b/i

// The clinic's Word files end with the two-doctor signature block — the
// report editor already renders that separately (fixed, non-editable), so
// anything from this point on is dropped rather than duplicated in the body.
const SIGNATURE_RE = /DR\.?\s*PRADNYA\s*GORE|DR\.?\s*RAMNATH\s*GHUTE|CONSULTANT\s+RADIOLOGIST|M\.?D\.?\s*RADIOLOGY/i

// Standard report section labels ("IMPRESSION:", "FINDINGS", ...) are just as
// short and all-caps as a real study title, and for a brief report land
// inside the heading scan window too — excluded for the same reason as the
// signature block, otherwise a short report gets its section label mistaken
// for the title (swallowing the real heading and everything above it as
// "header" to strip).
const SECTION_LABEL_RE = /^(IMPRESSION|FINDINGS?|OBSERVATIONS?|CONCLUSION|OPINION|ADVICE|COMMENTS?|NOTES?)\s*:?\s*$/i

function looksLikeHeading(line: string): boolean {
  // An ordinal suffix ("2nd DIGIT", "3rd FINGER") is conventionally written
  // lowercase even inside an otherwise all-caps heading — stripped (digit and
  // all) before the case check so it doesn't fail a real heading for having
  // one lowercase "nd"/"rd"/"st"/"th" in it.
  const withoutOrdinals = line.replace(/\d+(st|nd|rd|th)\b/gi, "")
  const letters = withoutOrdinals.replace(/[^A-Za-z]/g, "")
  if (letters.length < 4 || letters.length > 100) return false
  // The signature block ("DR. PRADNYA GORE", "M.D. RADIOLOGY", ...) is also
  // short and all-caps, and for a brief report can fall inside the heading
  // scan window — excluding it explicitly stops it being mistaken for the
  // study title (which would otherwise swallow the entire body).
  return letters === letters.toUpperCase()
    && !PATIENT_INFO_RE.test(line) && !SIGNATURE_RE.test(line) && !SECTION_LABEL_RE.test(line)
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

// A line like "LIVER: Both lobes..." or "GALL BLADDER : is well..." — an
// all-caps label followed by a colon — matches how every section of the
// clinic's real reports is written and bolded.
const LABEL_LINE_RE = /^([A-Z][A-Z0-9 /&.,'()-]{1,45}?)\s*:\s*(.*)$/
const IMPRESSION_RE = /^IMPRESSION\s*:?$/i

// Renders one plain-text line the same way the clinic's Word templates do:
// section labels bolded ("LIVER :"), the IMPRESSION heading bolded+underlined,
// and (once inside the impression) the conclusion sentences bolded in full.
function formatLineAsHtml(line: string, boldWhole: boolean): string {
  if (boldWhole) return `<div><b>${escapeHtml(line)}</b></div>`
  const m = line.match(LABEL_LINE_RE)
  if (m) {
    const label = m[1].trim()
    const rest  = m[2].trim()
    return `<div><b>${escapeHtml(label)} :</b>${rest ? " " + escapeHtml(rest) : ""}</div>`
  }
  return `<div>${escapeHtml(line)}</div>`
}

// Plain-text lines → the clinic's div-per-line + blank-line-between HTML shape.
export function linesToClinicHtml(lines: string[]): string {
  let inImpression = false
  const parts: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (IMPRESSION_RE.test(line)) {
      parts.push("<div><b><u>IMPRESSION</u> :</b></div>", "<div><br></div>")
      inImpression = true
      continue
    }
    parts.push(formatLineAsHtml(line, inImpression), "<div><br></div>")
  }
  return parts.join("")
}

// Never lets a stripping step remove EVERYTHING — if truncating at the
// signature block would leave nothing, the untruncated lines are kept
// instead. A near-empty template is a worse outcome than an unremoved
// signature line.
function truncateAtSignature(lines: string[]): string[] {
  const idx = lines.findIndex((l) => SIGNATURE_RE.test(l))
  if (idx === -1) return lines
  const truncated = lines.slice(0, idx)
  return truncated.some((l) => l.trim()) ? truncated : lines
}

// Plain-text path (.doc via word-extractor). Scans the first ~15 lines for a
// short, all-caps line that isn't part of the patient-info block — that's the
// study heading. Everything after it becomes the body; everything before
// (the header block) is discarded, and everything from the doctors'
// signature block onward is dropped too. Returns the full text as body with
// no heading if nothing matches, so no content is ever silently dropped.
export function splitHeaderFromPlainText(raw: string): { heading: string; bodyHtml: string } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  // The real study title always immediately follows the patient-info block —
  // it's the FIRST plausible candidate, not the last. Scanning further and
  // preferring a later match would let a short all-caps line inside the body
  // (a section label that slipped past SECTION_LABEL_RE, say) outrank the
  // actual heading and swallow everything above it as "header".
  let headingIdx = -1
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    if (looksLikeHeading(lines[i])) { headingIdx = i; break }
  }

  const heading      = headingIdx >= 0 ? lines[headingIdx] : ""
  const afterHeading = headingIdx >= 0 ? lines.slice(headingIdx + 1) : lines
  let bodyLines      = truncateAtSignature(afterHeading)
  // Same safety net as above, one level up: if stripping the heading itself
  // left nothing (the detected "heading" was actually the last line), fall
  // back to the full text rather than an empty template.
  if (!bodyLines.some((l) => l.trim())) bodyLines = afterHeading.length ? afterHeading : lines

  return { heading, bodyHtml: linesToClinicHtml(bodyLines) }
}

function hasVisibleText(html: string): boolean {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, "").trim().length > 0
}

// Converts mammoth's <p>-per-paragraph output into the same div-per-line +
// blank-line shape as the rest of the app, preserving whatever inline
// formatting (bold/italic/underline) and tables mammoth already produced —
// unlike the plain-text path, real formatting is available here so it's
// kept as-is rather than re-guessed. Also drops the doctors' signature block
// and anything after it, same as the plain-text path — unless doing so would
// leave nothing at all, in which case the untruncated version is kept.
export function convertParagraphsToDivs(html: string): string {
  const converted = html.replace(/<p>([\s\S]*?)<\/p>/gi, (_match, inner: string) => {
    const trimmed = inner.replace(/&nbsp;/gi, "").trim()
    if (!trimmed) return "<div><br></div>"
    return `<div>${inner}</div><div><br></div>`
  })

  const divRe = /<div>([\s\S]*?)<\/div>/gi
  let match: RegExpExecArray | null
  while ((match = divRe.exec(converted))) {
    const text = match[1].replace(/<[^>]+>/g, "").trim()
    if (text && SIGNATURE_RE.test(text)) {
      const truncated = converted.slice(0, match.index)
      return hasVisibleText(truncated) ? truncated : converted
    }
  }
  return converted
}

// Word documents sometimes lead with an empty bookmark/anchor paragraph
// (e.g. `<p><a id="_Hlk123"></a></p>`, invisible in the printed page) before
// the real patient-info table — strip any of those so the table is actually
// at the start of the string where the next step expects it.
function stripLeadingEmptyParagraphs(html: string): string {
  let s = html
  while (true) {
    const m = s.match(/^<p>((?:(?!<\/p>)[\s\S])*)<\/p>/i)
    if (!m) break
    const text = m[1].replace(/<[^>]+>/g, "").trim()
    if (text) break
    s = s.slice(m[0].length).trim()
  }
  return s
}

// Rich-HTML path (.docx via mammoth). The patient box is almost always a Word
// table at the very start; the heading is the short all-caps paragraph right
// after it. Strips both and returns the remaining HTML as the body.
export function splitHeaderFromHtml(html: string, plainText: string): { heading: string; bodyHtml: string } {
  let s = stripLeadingEmptyParagraphs(html.trim())

  // Drop leading table(s) that actually look like the NAME/DATE/AGE/REF.BY/SEX
  // patient-info block — checked by content, not just position. Some
  // templates box the study heading in its own leading table too (a bordered
  // title, same idea as a bordered patient box); blindly stripping every
  // consecutive leading table would silently delete that heading rather than
  // just fail to detect it, so stripping stops the moment a table's content
  // doesn't look like patient info.
  let strippedAnyTable = false
  while (true) {
    const m = s.match(/^<table[\s\S]*?<\/table>/i)
    if (!m) break
    const tableText = m[0].replace(/<[^>]+>/g, " ")
    if (!PATIENT_INFO_RE.test(tableText)) break
    s = stripLeadingEmptyParagraphs(s.slice(m[0].length).trim())
    strippedAnyTable = true
  }

  // The next paragraph — or, for templates that box the title instead, the
  // next small table wrapping it — is the study heading if it's short and
  // all-caps.
  let heading = ""
  const pMatch = s.match(/^<p>((?:(?!<\/p>)[\s\S])*)<\/p>/i)
  const tMatch = !pMatch ? s.match(/^<table[\s\S]*?<\/table>/i) : null
  const candidate = pMatch
    ? { whole: pMatch[0], text: pMatch[1].replace(/<[^>]+>/g, "").trim() }
    : tMatch
    ? { whole: tMatch[0], text: tMatch[0].replace(/<[^>]+>/g, " ").trim() }
    : null
  if (candidate) {
    const remainder = s.slice(candidate.whole.length).trim()
    // Only treat it as the heading (and consume it) if something is still
    // left afterward — otherwise this "heading" was actually the last real
    // content in the document, and removing it would leave an empty body.
    if (looksLikeHeading(candidate.text) && hasVisibleText(remainder)) {
      heading = candidate.text
      s = remainder
    }
  }

  // Structure didn't match what we expected (no leading table found at all) —
  // fall back to detecting the heading from the plain-text extraction instead
  // of guessing at the HTML, and leave the HTML body untouched either way.
  if (!strippedAnyTable && !heading) {
    const fallback = splitHeaderFromPlainText(plainText)
    if (fallback.heading) return { heading: fallback.heading, bodyHtml: convertParagraphsToDivs(html) }
  }

  return { heading, bodyHtml: convertParagraphsToDivs(s || html) }
}
