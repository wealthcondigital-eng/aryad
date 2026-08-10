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
// What a doctors' sign-off is made of — by SHAPE, never by name.
//
// No clinic's doctors are written into this file: a template belongs to whoever
// uploaded it, and a rule keyed to two names would quietly stop working the day
// a locum signs a report or the app is used by another centre. What marks the
// block is that it consists of a name introduced by "Dr", a professional title,
// or a registration number — and nothing else (see isSignatureLine). The last
// alternative catches a registration number printed on its own, with no label,
// which is how several templates end.
const SIGNATURE_RE = /^\s*DRS?\.?\s*[A-Z]|CONSULTANT|\bRADIOLOGIST\b|\bSONOLOGIST\b|\bPATHOLOGIST\b|\bRADIOLOGY\b|\bMBBS\b|\bDMRD\b|\bDNB\b|\bM\.?\s?D\.?\b|REG(?:ISTRATION)?\.?\s*NO\.?|^\s*[\d][\d/.\-]{4,}\s*\.?\s*$/i

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
  // The signature block ("DR. <NAME>", "M.D. RADIOLOGY", ...) is also
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
  // Blank lines come from the DOCUMENT, not from this function.
  //
  // It used to drop every blank line in the source and then append one after
  // EVERY line it emitted, so an imported report came back double-spaced
  // throughout: two consecutive lines that sat together in Word ("Right kidney
  // measures cm." / "Left kidney measures cm.") arrived with a blank line
  // wedged between them, and a template that was two pages in Word became
  // three here. Runs of blanks are capped at one, which is the section break
  // the clinic's templates use — beyond that they are just noise from the
  // .doc text extraction.
  let blankRun = 0
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      // Never lead with a blank line, and never stack them.
      if (parts.length && blankRun === 0) { parts.push("<div><br></div>"); blankRun++ }
      continue
    }
    blankRun = 0
    if (IMPRESSION_RE.test(line)) {
      parts.push("<div><b><u>IMPRESSION</u> :</b></div>")
      inImpression = true
      continue
    }
    parts.push(formatLineAsHtml(line, inImpression))
  }
  return parts.join("")
}

/**
 * The pieces a sign-off is made of: names introduced by "Dr", professional
 * titles and qualifications, and registration numbers. Whatever is left after
 * removing these is real report content — which is what separates a sign-off
 * from the DECLARATION paragraph that names the same doctors.
 */
const SIGNATURE_TOKENS = new RegExp([
  // "Dr. Pradnya Gore", "DRS. A & B" — a name introduced by the title
  "DRS?\\.?\\s*[A-Z][A-Za-z.]*(?:\\s+[A-Z][A-Za-z.]*){0,3}",
  // A bare capitalised name run, for the second line of a two-column sign-off
  "[A-Z][A-Za-z.]+(?:\\s+[A-Z][A-Za-z.]+){1,3}",
  // Titles and qualifications
  "CONSULTANT|SENIOR|CHIEF|RADIOLOGIST|SONOLOGIST|PATHOLOGIST|PHYSICIAN|RADIOLOGY|RADIODIAGNOSIS",
  "M\\.?\\s?D\\.?|M\\.?B\\.?B\\.?S\\.?|D\\.?M\\.?R\\.?D\\.?|D\\.?N\\.?B\\.?",
  // "Registration No. 2007/10/3706", or the number on its own
  "REG(?:ISTRATION)?\\.?\\s*NO\\.?\\s*[\\d/.\\-]*",
  "[\\d/.\\-]{4,}",
].join("|"), "gi")

/** Nothing but names and titles is left once the tokens above are removed. */
const SIGNATURE_RESIDUE_MAX = 12

/** A safety valve — no plausible sign-off is longer than this. */
const SIGNATURE_BLOCK_MAX = 300

/**
 * Is this block the doctors' sign-off rather than report content?
 *
 * The distinction that matters: the clinic's DECLARATION paragraph ("I DR.
 * <NAME> declare that while conducting ultrasonography scanning on this
 * patient…") names the same doctors and must stay in the report, while the
 * sign-off is nothing BUT names, titles and a registration number — whether
 * that is two short lines or a two-column table holding both doctors at once.
 * So the test is what remains after the names and titles are taken out, not
 * how long the block is.
 */
/**
 * A bare name line — "PRADNYA GORE", "A. K. Sharma" — with no "Dr" in front.
 *
 * Only ever accepted INSIDE a run that already contains a real sign-off line,
 * because on its own a short run of capitalised words is indistinguishable from
 * a section label ("URINARY BLADDER"). Sentence punctuation rules out prose.
 */
function looksLikeNameLine(text: string): boolean {
  const t = text.trim().replace(/[.,]+$/, "")
  if (!t || t.length > 40) return false
  if (/[!?;:]|\.\s/.test(t)) return false
  const words = t.split(/\s+/)
  if (words.length > 4) return false
  return words.every((w) => /^[A-Z][A-Za-z.'-]*$/.test(w))
}

function isSignatureLine(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > SIGNATURE_BLOCK_MAX) return false
  if (!SIGNATURE_RE.test(t)) return false
  const residue = t.replace(SIGNATURE_TOKENS, " ").replace(/[^A-Za-z0-9]+/g, " ").trim()
  return residue.length <= SIGNATURE_RESIDUE_MAX
}

/** Number of doctor names in the trailing Word sign-off (when detectable). */
export function countTrailingSignatories(raw: string): number | undefined {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let count = 0
  for (const line of lines.slice(-12)) {
    if (!isSignatureLine(line)) continue
    count += line.match(/\bDRS?\.?\s+[A-Z]/gi)?.length ?? 0
  }
  return count ? Math.min(2, count) : undefined
}

/**
 * How many doctors a sign-off names — counted from the block itself.
 *
 * A two-column Word sign-off puts both names on the SAME line, so this counts
 * "Dr"-introduced names rather than lines. Returns 0 when there is no sign-off.
 */
export function countSignatoriesIn(html: string): number {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ")
  // Case-insensitive: Word files mix "DR. A B" and "Dr C D" in the same
  // sign-off, and a case-sensitive count sees only the shouted one.
  return Math.min(2, text.match(/\bDRS?\.?\s*[A-Za-z]/gi)?.length ?? 0)
}

/** Does this body already end in a doctors' sign-off? */
export function hasTrailingSignatureBlock(html: string): boolean {
  return stripTrailingSignatureBlock(html) !== html
}

/**
 * Drops the doctors' sign-off from the END of an imported document.
 *
 * The report editor draws its own signature block under every report, so a
 * template that keeps the one from the Word file prints both — the clinic saw
 * "DR. <NAME> / CONSULTANT RADIOLOGIST" twice on every report.
 *
 * Only the trailing RUN is removed: walking back from the last line while each
 * one is blank or a short signature line. Cutting at the first mention instead
 * (which is what this used to do) took the DECLARATION paragraph with it,
 * because that paragraph names the doctors too.
 */
function truncateAtSignature(lines: string[]): string[] {
  let cut = lines.length
  let sawSignature = false
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim()
    if (!t) { cut = i; continue }
    if (isSignatureLine(t)) { cut = i; sawSignature = true; continue }
    if (sawSignature && looksLikeNameLine(t)) { cut = i; continue }
    break
  }
  // Trailing blank lines on their own are the document's, not a sign-off.
  if (!sawSignature || cut >= lines.length) return lines
  const truncated = lines.slice(0, cut)
  // A near-empty template is a worse outcome than an unremoved signature line.
  return truncated.some((l) => l.trim()) ? truncated : lines
}

/**
 * The HTML equivalent, for the .docx paths — same trailing-run rule, applied to
 * the document's top-level blocks.
 *
 * Regex rather than a DOM parse: this runs on the server for every import, the
 * blocks that carry a sign-off are always flat <p>/<div>/<table> siblings, and
 * a failed match here simply leaves the block in place rather than corrupting
 * the body.
 */
export function stripTrailingSignatureBlock(html: string): string {
  if (!html.trim()) return html
  const blockRe = /<(p|div|h[1-6]|table)\b[^>]*>[\s\S]*?<\/\1>|<br\s*\/?>/gi
  const blocks: { start: number; end: number; text: string }[] = []
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html))) {
    blocks.push({
      start: m.index,
      end: m.index + m[0].length,
      text: m[0].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim(),
    })
  }
  if (!blocks.length) return html

  let cut = blocks.length
  let sawSignature = false
  for (let i = blocks.length - 1; i >= 0; i--) {
    const t = blocks[i].text
    if (!t) { cut = i; continue }
    if (isSignatureLine(t)) { cut = i; sawSignature = true; continue }
    if (sawSignature && looksLikeNameLine(t)) { cut = i; continue }
    break
  }
  // A tail of blank paragraphs is the document's own spacing — only a real
  // sign-off is removed. Even then the last block still gets the inner pass:
  // a document whose declaration and sign-off share ONE paragraph has nothing
  // for the block-level walk to find.
  if (!sawSignature || cut >= blocks.length) return stripSignatureAfterLastBreak(html)

  const kept = html.slice(0, blocks[cut].start)
  return hasVisibleText(kept) ? stripSignatureAfterLastBreak(kept) : stripSignatureAfterLastBreak(html)
}

/**
 * The same trim one level down, inside the final block.
 *
 * Word documents routinely put the declaration and the sign-off in ONE
 * paragraph separated by line breaks ("…to anybody in any manner.<br>DR.
 * <NAME><br>Dr <NAME>"), which the block-level pass above can only
 * keep or delete whole — and deleting it would take the declaration with it.
 * So the last block's own <br>-separated lines get the same treatment.
 */
function stripSignatureAfterLastBreak(html: string): string {
  // The last block that actually has text — trailing empty paragraphs are
  // common at the end of a Word document and would otherwise hide it.
  const blockRe = /<(p|div|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi
  let last: { start: number; end: number; whole: string; inner: string } | null = null
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html))) {
    const text = m[0].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").trim()
    if (text) last = { start: m.index, end: m.index + m[0].length, whole: m[0], inner: m[2] }
  }
  if (!last) return html

  const parts = last.inner.split(/<br\s*\/?>/i)
  if (parts.length < 2) return html

  let cut = parts.length
  let sawSignature = false
  for (let i = parts.length - 1; i >= 0; i--) {
    const text = parts[i].replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim()
    if (!text) { cut = i; continue }
    if (isSignatureLine(text)) { cut = i; sawSignature = true; continue }
    if (sawSignature && looksLikeNameLine(text)) { cut = i; continue }
    break
  }
  // Never leave the block empty: a paragraph that is ONLY a sign-off was
  // already handled by the block-level pass.
  if (!sawSignature || cut === 0 || cut >= parts.length) return html

  const rebuilt = last.whole.replace(last.inner, parts.slice(0, cut).join("<br>"))
  return html.slice(0, last.start) + rebuilt + html.slice(last.end)
}

// Plain-text path (.doc via word-extractor). Scans the first ~15 lines for a
// short, all-caps line that isn't part of the patient-info block — that's the
// study heading. Everything after it becomes the body; everything before
// (the header block) is discarded, and everything from the doctors'
// signature block onward is dropped too. Returns the full text as body with
// no heading if nothing matches, so no content is ever silently dropped.
export function splitHeaderFromPlainText(raw: string, preserveSignatureBlock = false): { heading: string; bodyHtml: string } {
  // Blank lines are KEPT: they are the document's own paragraph breaks, and
  // linesToClinicHtml now reproduces them instead of inventing one after every
  // line. Dropping them here is what made that invention necessary.
  const lines = raw.split(/\r?\n/).map((l) => l.trim())

  // The real study title always immediately follows the patient-info block —
  // it's the FIRST plausible candidate, not the last. Scanning further and
  // preferring a later match would let a short all-caps line inside the body
  // (a section label that slipped past SECTION_LABEL_RE, say) outrank the
  // actual heading and swallow everything above it as "header".
  let headingIdx = -1
  let scanned = 0
  for (let i = 0; i < lines.length && scanned < 15; i++) {
    if (!lines[i]) continue          // blank lines don't count toward the window
    scanned++
    if (looksLikeHeading(lines[i])) { headingIdx = i; break }
  }

  const heading      = headingIdx >= 0 ? lines[headingIdx] : ""
  const afterHeading = headingIdx >= 0 ? lines.slice(headingIdx + 1) : lines
  let bodyLines      = preserveSignatureBlock ? afterHeading : truncateAtSignature(afterHeading)
  // Same safety net as above, one level up: if stripping the heading itself
  // left nothing (the detected "heading" was actually the last line), fall
  // back to the full text rather than an empty template.
  if (!bodyLines.some((l) => l.trim())) bodyLines = afterHeading.length ? afterHeading : lines

  return { heading, bodyHtml: linesToClinicHtml(bodyLines) }
}

function hasVisibleText(html: string): boolean {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, "").trim().length > 0
}

// Converts mammoth's <p>-per-paragraph output into the same per-line <div>
// shape as the rest of the app, preserving whatever inline formatting
// (bold/italic/underline) and tables mammoth already produced.
export function convertParagraphsToDivs(html: string): string {
  // Word paragraphs styled "Heading 1"-"Heading 6" (section labels like
  // "GENERAL SCAN:", "FETAL ANATOMY:" in the clinic's real templates) come
  // out of mammoth as bare <h1>-<h6>, which the report editor has no
  // heading styles for — they render at the browser's default heading size
  // instead of matching the surrounding body text, blowing up a handful of
  // section labels to giant text while the rest of the page stays 12pt.
  // mammoth also doesn't carry over the bold that the Heading style itself
  // defines (only direct run-level bold survives), so it's added back here
  // to match how these lines actually look in Word.
  let converted = html.replace(/<h[1-6]>([\s\S]*?)<\/h[1-6]>/gi, (_match, inner: string) => {
    const trimmed = inner.replace(/&nbsp;/gi, "").trim()
    if (!trimmed) return "<div><br></div>"
    return `<div><strong>${inner}</strong></div>`
  })

  converted = converted.replace(/<p>([\s\S]*?)<\/p>/gi, (_match, inner: string) => {
    const trimmed = inner.replace(/&nbsp;/gi, "").trim()
    if (!trimmed) return "<div><br></div>"
    return `<div>${inner}</div>`
  })

  // Collapse 2 or more consecutive blank divs into a single clean section break
  converted = converted.replace(/(?:<div><br><\/div>\s*){2,}/gi, "<div><br></div>")

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
// `<p\b[^>]*>` rather than `<p>`: the high-fidelity importer (docx-render.ts)
// carries paragraph formatting as inline styles, so every paragraph arrives
// attributed. Matching only the bare tag silently stopped detecting anything at
// all on that path — the patient block and heading would be left in the body.
const LEADING_P_RE = /^<p\b[^>]*>((?:(?!<\/p>)[\s\S])*)<\/p>/i

function stripLeadingEmptyParagraphs(html: string): string {
  let s = html
  while (true) {
    const m = s.match(LEADING_P_RE)
    if (!m) break
    const text = m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, "").trim()
    if (text) break
    s = s.slice(m[0].length).trim()
  }
  return s
}

// Rich-HTML path (.docx via mammoth). The patient box is almost always a Word
// table at the very start; the heading is the short all-caps paragraph right
// after it. Strips both and returns the remaining HTML as the body.
export function splitHeaderFromHtml(
  html: string,
  plainText: string,
  /**
   * Set for HTML that already carries the original document's formatting (the
   * docx-render.ts path). It skips the paragraph-to-div rewrite below, which
   * exists to give mammoth's bare, style-less output the clinic's house look —
   * running it on high-fidelity HTML would throw away the very paragraph
   * attributes (alignment, indent, spacing) that path exists to preserve.
   */
  preserveFormatting = false,
  preserveSignatureBlock = false,
): { heading: string; bodyHtml: string } {
  const normalise = (h: string) => (preserveFormatting ? h : convertParagraphsToDivs(h))
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
  const pMatch = s.match(LEADING_P_RE)
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
    if (fallback.heading) return {
      heading: fallback.heading,
      bodyHtml: preserveSignatureBlock ? normalise(html) : stripTrailingSignatureBlock(normalise(html)),
    }
  }

  const bodyHtml = normalise(s || html)
  return { heading, bodyHtml: preserveSignatureBlock ? bodyHtml : stripTrailingSignatureBlock(bodyHtml) }
}
