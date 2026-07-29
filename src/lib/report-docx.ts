// Builds the clinic's report as a real .docx file, for the report editor's
// "Download DOCX" button.
//
// Client-side only: `parseHtml` needs DOMParser, and the caller (the report
// editor page) is a client component. On the server `parseHtml` degrades to a
// single unformatted segment rather than throwing, so an accidental server
// import produces a plain-text report instead of a crash.

import { buildDocxSignatureCells, dataUrlToBytes, imageFormat, type Signatory, type SignatureLayout } from "@/lib/report-signatures"
import { DEFAULT_REPORT_FONT } from "@/lib/report-layout"
import { isFloatingWrap, readImageDataAttrs, type ImageWrap } from "@/lib/report-image"

export type Seg = {
  text: string; bold?: boolean; italic?: boolean; underline?: boolean; font?: string
  image?: string; imgWidth?: number; imgHeight?: number
  /** Word text-wrapping mode for an inserted image (see report-image.ts). */
  wrap?: ImageWrap
  /** Free-placement offset from the anchor, px — only set for floating wraps. */
  imgLeft?: number
  imgTop?: number
}

/** px → EMU (English Metric Units): 914400 per inch, at the app's 96dpi basis. */
const EMU_PER_PX = 9525

type DocxModule = Awaited<typeof import("docx")>

// ── Inserted images → Word picture runs ───────────────────────────────────────
// Each of the editor's wrap modes maps onto the Word feature it was named after,
// so an image dragged behind the text on screen opens as a real behind-text
// floating picture in Word — still draggable there — rather than as an inline
// picture dumped on its own line.
//
// The offsets are the one approximation. On screen they're measured from the
// image's anchor point in the text; Word's equivalent (`relative: COLUMN` /
// `relative: PARAGRAPH`) measures from the text column and the anchoring
// paragraph. Both are "offset from where this image belongs in the text", and
// for the sizes involved (a stamp nudged tens of px) they land in the same
// place; a doctor who then drags it in Word is adjusting the same anchor.
//
// Takes the already-imported `docx` namespace rather than importing it itself so
// both DOCX builders in the app — this file's, and the older fallback one on the
// reports list — produce identical picture runs from the same body HTML.
export function makeImageRun(docx: DocxModule, s: Seg) {
  const {
    ImageRun, HorizontalPositionAlign, HorizontalPositionRelativeFrom,
    VerticalPositionRelativeFrom, TextWrappingType, TextWrappingSide,
  } = docx

  const w = Math.min(s.imgWidth || 150, 640)
  const h = s.imgWidth && s.imgHeight
    ? Math.round(w * (s.imgHeight / s.imgWidth))
    : Math.min(s.imgHeight || 60, 400)
  const common = {
    type: imageFormat(s.image!),
    data: dataUrlToBytes(s.image!),
    transformation: { width: w, height: h },
  } as const

  if (s.wrap && isFloatingWrap(s.wrap)) {
    return new ImageRun({
      ...common,
      floating: {
        horizontalPosition: {
          relative: HorizontalPositionRelativeFrom.COLUMN,
          offset: Math.round((s.imgLeft || 0) * EMU_PER_PX),
        },
        verticalPosition: {
          relative: VerticalPositionRelativeFrom.PARAGRAPH,
          offset: Math.round((s.imgTop || 0) * EMU_PER_PX),
        },
        // Behind Text is exactly Word's "behind document" flag; In Front of Text
        // is the same anchoring with the picture left on top.
        behindDocument: s.wrap === "behind",
        allowOverlap: true,
        wrap: { type: TextWrappingType.NONE },
      },
    })
  }

  if (s.wrap === "square-left" || s.wrap === "square-right") {
    const left = s.wrap === "square-left"
    return new ImageRun({
      ...common,
      floating: {
        horizontalPosition: {
          relative: HorizontalPositionRelativeFrom.COLUMN,
          align: left ? HorizontalPositionAlign.LEFT : HorizontalPositionAlign.RIGHT,
        },
        verticalPosition: { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
        allowOverlap: false,
        // `side` is the side the TEXT flows down, so it's the mirror of the side
        // the image is floated to.
        wrap: { type: TextWrappingType.SQUARE, side: left ? TextWrappingSide.RIGHT : TextWrappingSide.LEFT },
        margins: { left: 0, right: 12 * EMU_PER_PX, top: 0, bottom: 4 * EMU_PER_PX },
      },
    })
  }

  return new ImageRun(common)
}

// Reads the font a run was set to via execCommand("fontName", ...), which
// Chrome/Firefox represent as a legacy <font face="..."> wrapper.
function fontOf(el: HTMLElement): string | undefined {
  if (el.tagName.toLowerCase() === "font" && el.getAttribute("face")) return el.getAttribute("face") || undefined
  const styleFont = el.style?.fontFamily
  return styleFont ? styleFont.split(",")[0].trim().replace(/^["']|["']$/g, "") : undefined
}

export function parseHtml(html: string): Seg[] {
  const segs: Seg[] = []
  if (typeof window === "undefined") return [{ text: html }]
  const doc = new DOMParser().parseFromString(html, "text/html")
  function walk(node: Node, fmt: { bold: boolean; italic: boolean; underline: boolean; font?: string }) {
    if (node.nodeType === 3) {
      const t = node.textContent ?? ""
      if (t) segs.push({ text: t, ...fmt })
    } else if (node.nodeType === 1) {
      const el = node as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (tag === "img") {
        // An image inserted through the report editor's Image button carries its
        // wrap mode and free-placement offsets as data attributes (see
        // report-image.ts), so Word can reproduce the same anchoring the screen
        // shows. Anything else — a template figure, an old pasted image — has no
        // such attributes and keeps the original plain-inline treatment.
        if (el.hasAttribute("data-rimg")) {
          const a = readImageDataAttrs(el)
          if (a.src) {
            segs.push({
              text: "", image: a.src, imgWidth: a.width, imgHeight: a.height,
              wrap: a.wrap, imgLeft: a.left, imgTop: a.top,
            })
          }
          return
        }
        const src = el.getAttribute("src") || ""
        if (src) {
          const w = parseFloat(el.style.width) || parseFloat(el.getAttribute("width") || "") || 0
          const h = parseFloat(el.style.height) || parseFloat(el.getAttribute("height") || "") || 0
          segs.push({ text: "", image: src, imgWidth: w, imgHeight: h })
        }
        return
      }
      const f = { ...fmt }
      if (tag === "b" || tag === "strong") f.bold = true
      if (tag === "i" || tag === "em")     f.italic = true
      if (tag === "u")                     f.underline = true
      f.font = fontOf(el) ?? f.font
      el.childNodes.forEach((c) => walk(c, f))
      // Table cells/rows have no natural line-break tag of their own, so a
      // DOCX/plain-text export would otherwise run every cell's text together
      // with no separator at all — space cells with a tab and end each row
      // with a newline so an exported table still reads as a table.
      if (tag === "td" || tag === "th") segs.push({ text: "\t" })
      if (["div", "p", "br", "li", "tr"].includes(tag)) segs.push({ text: "\n" })
    }
  }
  doc.body.childNodes.forEach((n) => walk(n, { bold: false, italic: false, underline: false }))
  return segs
}

export interface ReportDocxOptions {
  patient: string
  refBy: string
  srNo: string
  date: string
  age: string
  gender: string
  /** The doctor-edited study heading (falls back to the study name upstream). */
  docTitle: string
  headingFont?: string
  /** Font family chosen for the NAME/REF.BY/DATE/AGE/SEX box (whole box). */
  patientBoxFont?: string
  /** Clean body HTML — edit-attribution spans already stripped by the caller. */
  bodyHtml: string
  signatories: Signatory[]
  signatureLayouts?: (SignatureLayout | null | undefined)[]
}

export async function buildReportDocxBase64(opts: ReportDocxOptions): Promise<string> {
  const {
    patient, refBy, srNo, date, age, gender,
    docTitle, headingFont, patientBoxFont, bodyHtml, signatories, signatureLayouts,
  } = opts

  const docx = await import("docx")
  const {
    Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
    Table, TableRow, TableCell, WidthType,
  } = docx
  const sigCells = await buildDocxSignatureCells(signatories, signatureLayouts)

  // Vertical rhythm of the body.
  //
  // Every template body is stored as "<div>line</div><div><br></div>" — a real
  // line followed by a deliberately blank one. Rendering that literally gives
  // each line of findings a full empty line beneath it PLUS paragraph spacing,
  // which is where the cavernous gaps between "Transabdominal…", "Clinical
  // Details…" and "URINARY BLADDER…" came from.
  //
  // Word doesn't space paragraphs with empty paragraphs, it uses `spacing`. So
  // blank lines are collapsed away and turned into space-after on the preceding
  // real paragraph: one blank line reads as a paragraph break, several collapse
  // to the same break rather than accumulating. Nothing is lost — the visual
  // separation is still there, just proportionate.
  // Tuned down three times now after the gaps kept reading as too loose on
  // screen: a blank line in a template is a section separator, not a full
  // empty line of paper. Left as named constants specifically so the next
  // adjustment is a one-line change instead of another find-and-replace.
  const LINE_GAP  = 20  // twips after every line (~1pt), keeps lines from touching
  const BLOCK_GAP = 80  // twips after a line followed by blank line(s) (~4pt)

  const makeParas = (html: string, size = 20) => {
    const segs = parseHtml(html)

    // Pass 1 — group the segment stream into lines. A line is either runs of
    // text (images wrapped in line with the text ride along inside those runs),
    // a block image on its own line, an anchored floating image, or blank.
    // Collecting first (rather than emitting as we go) is what lets each
    // paragraph be built with its final spacing already known: the docx library
    // fixes paragraph properties at construction, so spacing cannot be widened
    // after the fact.
    type Run = InstanceType<typeof TextRun> | ReturnType<typeof makeImageRun>
    type Line =
      | { kind: "text"; runs: Run[] }
      | { kind: "image"; run: Run; center: boolean }
      | { kind: "float"; run: Run }
      | { kind: "blank" }

    const linesOut: Line[] = []
    let runs: Run[] = []
    const endLine = () => {
      linesOut.push(runs.length ? { kind: "text", runs } : { kind: "blank" })
      runs = []
    }

    segs.forEach((s) => {
      if (s.image) {
        const run = makeImageRun(docx, s)
        // In line with text: stays in the run stream, so a small figure sits in
        // the sentence it was inserted into instead of breaking the line.
        if (s.wrap === "inline") { runs.push(run); return }
        if (runs.length) endLine()
        // Floating pictures (behind/in front/squared) are anchored to a real
        // paragraph below rather than given one of their own — an empty
        // paragraph just to hold them would add a blank line of its own to the
        // page while the picture itself floats away from it.
        const floating = s.wrap && s.wrap !== "top-bottom"
        // "Top and Bottom" centers the picture on its own line, matching the
        // `margin: 0 auto` the same mode renders with on screen. An image with
        // no wrap attribute at all is a legacy/template figure — left aligned,
        // exactly as it has always exported.
        linesOut.push(floating
          ? { kind: "float", run }
          : { kind: "image", run, center: s.wrap === "top-bottom" })
        return
      }
      if (s.text === "\n") endLine()
      else runs.push(new TextRun({ text: s.text, bold: s.bold, italics: s.italic, underline: s.underline ? {} : undefined, font: s.font || DEFAULT_REPORT_FONT, size }))
    })
    if (runs.length) endLine()

    // Pass 2 — emit real content only, folding the blank lines that follow each
    // paragraph into its space-after. Consecutive blanks collapse to a single
    // block gap instead of stacking, and blanks before any content are dropped
    // so a template cannot start the report half-way down the page.
    const paras: InstanceType<typeof Paragraph>[] = []
    // Floating pictures waiting for a paragraph to be anchored to.
    let floats: Run[] = []
    const takeFloats = () => { const f = floats; floats = []; return f }

    for (let i = 0; i < linesOut.length; i++) {
      const line = linesOut[i]
      if (line.kind === "float") { floats.push(line.run); continue }

      if (line.kind === "blank") {
        paras.push(new Paragraph({ children: [...takeFloats(), new TextRun({ text: "", size })], spacing: { after: LINE_GAP } }))
        continue
      }

      if (line.kind === "image") {
        paras.push(new Paragraph({
          children: [...takeFloats(), line.run],
          ...(line.center ? { alignment: AlignmentType.CENTER } : {}),
          spacing: { after: LINE_GAP },
        }))
      } else {
        paras.push(new Paragraph({ children: [...takeFloats(), ...line.runs], spacing: { after: LINE_GAP } }))
      }
    }
    // Floating pictures anchored past the last line of the report still have to
    // land somewhere — give them a minimal paragraph of their own.
    if (floats.length) paras.push(new Paragraph({ children: takeFloats(), spacing: { after: LINE_GAP } }))

    return paras.length ? paras : [new Paragraph({ children: [new TextRun({ text: "", size })] })]
  }

  // A4 in twips (210 × 297mm). Declared on the section below so readers don't
  // fall back to their own default paper size.
  const A4_WIDTH  = 11906
  const A4_HEIGHT = 16838

  // Usable text column: A4 width minus the 1440-twip left/right page margins
  // set below.
  //
  // Every table here MUST declare `columnWidths`. Without it the docx library
  // emits `<w:tblGrid><w:gridCol w:w="100"/></w:tblGrid>` — a 100-twip (~1.7mm)
  // grid column, regardless of the percentage widths on the table and cells.
  // Renderers lay tables out from tblGrid, so a table with a correct
  // `tblW=100%` still collapses to its content width. That is what squeezed the
  // study heading into a narrow box and wrapped it over three lines; the
  // patient box only escaped it because its explicit per-cell `tcW`
  // percentages happened to override the bad grid.
  const TEXT_WIDTH = 9026
  const pctCell = (pct: number) => Math.round((TEXT_WIDTH * pct) / 100)

  // Heading box width, sized to the heading text itself rather than to the
  // full text column.
  //
  // No font-metrics library is available here (this runs in the browser off
  // DOMParser, not against a real rendering engine), so the width is an
  // estimate: ~165 twips (8.25pt) per character at this box's 13pt bold size,
  // which is deliberately biased a little wide — overshooting means a slightly
  // roomier box, undershooting means the heading wraps, and wrapping is the
  // worse failure mode. Calibrated against the clinic's own 123 real template
  // headings (14–56 characters, median 33): at this estimate the longest of
  // them lands almost exactly at the text-column width, which is why that's
  // also the clamp ceiling — the rare very long heading gets the full column
  // (matching the previous always-safe behaviour), while a typical short one
  // gets a box sized to match, not one stretched across the whole page.
  const CHAR_WIDTH_TWIPS  = 165
  const HEADING_PADDING   = 260  // cell margins (120 × 2) plus a small border allowance
  const HEADING_MIN_WIDTH = 2600 // ~4.6cm — keeps a one- or two-word heading from looking like a tag
  const headingBoxWidth = Math.min(
    TEXT_WIDTH,
    Math.max(HEADING_MIN_WIDTH, docTitle.length * CHAR_WIDTH_TWIPS + HEADING_PADDING)
  )

  const noBorder     = { style: BorderStyle.NONE,   size: 0, color: "ffffff" }
  const doubleBorder = { style: BorderStyle.DOUBLE, size: 6, color: "000000" }
  const boldLine = (text: string, spaceAfter = 0) =>
    new Paragraph({ children: [new TextRun({ text, bold: true, size: 22, font: patientBoxFont || DEFAULT_REPORT_FONT })], spacing: { after: spaceAfter } })

  // The Word file matches the clinic's printed design: a double-bordered
  // patient info box (NAME / REF. BY | DATE / AGE / SEX), then the
  // bordered underlined (editable) study heading, body and signatures.
  const children = [
    // A document can't *start* with a table either — with nothing before it,
    // there is no paragraph mark for a cursor to land in above the box, so
    // clicking there does nothing (Word itself auto-inserts an empty leading
    // paragraph in this exact situation; the `docx` library does not, it only
    // emits what it's given). Same near-invisible 1pt spacer as the
    // table-can't-follow-table separator below, so this reads as flush with
    // the page top until someone actually clicks and types there.
    new Paragraph({ children: [new TextRun({ text: "", size: 2 })], spacing: { before: 0, after: 20 } }),
    // ── Patient info box ──
    new Table({
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      columnWidths: [pctCell(62), pctCell(38)],
      layout: "fixed",
      borders: {
        top: doubleBorder, bottom: doubleBorder, left: doubleBorder, right: doubleBorder,
        insideHorizontal: noBorder, insideVertical: noBorder,
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: pctCell(62), type: WidthType.DXA },
              margins: { top: 160, bottom: 160, left: 200, right: 200 },
              children: [
                boldLine(`NAME - ${patient.toUpperCase()}`, 60),
                boldLine(`REF. BY - ${(refBy || "SELF").toUpperCase()}`, 60),
                ...(srNo ? [boldLine(`SR. NO - #${srNo}`)] : []),
              ],
            }),
            new TableCell({
              width: { size: pctCell(38), type: WidthType.DXA },
              margins: { top: 160, bottom: 160, left: 200, right: 200 },
              children: [
                boldLine(`DATE - ${date || ""}`, 60),
                boldLine(`AGE - ${age ? `${age} YRS` : "—"}`, 60),
                boldLine(`SEX - ${(gender || "—").toUpperCase()}`),
              ],
            }),
          ],
        }),
      ],
    }),
    // A table can't immediately follow another table in OOXML — something has
    // to separate them — but that separator doesn't have to read as a visible
    // blank line. It previously did: an unsized TextRun falls back to the
    // document's default run size (11pt), so this "empty" paragraph was really
    // an 11pt line plus 100 twips before/after, roughly 8mm of dead white space
    // between the patient box and the heading — exactly the gap that doesn't
    // exist in the clinic's real Word documents. Sized down to a 1pt run with
    // a hairline of spacing: present (still valid OOXML, still a real
    // paragraph mark), but no longer visible as a gap.
    new Paragraph({ children: [new TextRun({ text: "", size: 2 })], spacing: { before: 20, after: 20 } }),
    // ── Study heading — bordered box sized to its own text, centered ──
    // A one-cell TABLE, deliberately, and sized in absolute twips.
    //
    // Two earlier shapes failed. Percentage widths (`tblW=100%`) left the docx
    // library emitting a 100-twip tblGrid, and renderers lay tables out from
    // tblGrid — so the box collapsed to content width and wrapped the heading
    // over several lines. Switching to a bordered paragraph fixed the width but
    // broke something more important: Word can drag-resize a table's column
    // width by hand, but not a paragraph's border, so the box became
    // impossible to widen once opened.
    //
    // Full column width then over-corrected the other way: a three-word heading
    // in a box spanning the entire text column reads as an obvious mismatch next
    // to the patient info box above it. The width is now derived from the
    // heading's own length instead, via `headingBoxWidth` below, with the table
    // centered rather than stretched — so the box hugs the text the way a
    // hand-drawn box in Word would, is guaranteed to fit on one line (it's sized
    // FROM that line), and still keeps `layout: fixed` + matching tblW/tblGrid/
    // tcW so nothing is left for a renderer to infer. Drag the right border on
    // the ruler to widen or narrow it further by hand.
    new Table({
      alignment: AlignmentType.CENTER,
      width: { size: headingBoxWidth, type: WidthType.DXA },
      columnWidths: [headingBoxWidth],
      layout: "fixed",
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: "333333" },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "333333" },
        left: { style: BorderStyle.SINGLE, size: 6, color: "333333" },
        right: { style: BorderStyle.SINGLE, size: 6, color: "333333" },
        insideHorizontal: noBorder, insideVertical: noBorder,
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: headingBoxWidth, type: WidthType.DXA },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: docTitle, bold: true, size: 26, underline: {}, font: headingFont || DEFAULT_REPORT_FONT })],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    // Same fix, same reason, on the other side of the heading box.
    new Paragraph({ children: [new TextRun({ text: "", size: 2 })], spacing: { before: 20, after: 20 } }),
    // ── Report body ──
    ...makeParas(bodyHtml),
    // ── Gap before signatures ──
    // Was 1000 twips (~1.8cm) of dead space, which left a conspicuous hole
    // between the last finding and the doctors' names — and, because it is a
    // fixed gap rather than a page-bottom anchor, it did nothing useful when
    // the body was short either. Now a modest separator: the signature block
    // simply flows after the body, so adding or removing findings above moves
    // the names up and down with the content.
    new Paragraph({ children: [new TextRun({ text: "" })], spacing: { before: 200 } }),
    // ── Two-doctor signature block (as in the clinic's Word formats) ──
    new Table({
      width: { size: TEXT_WIDTH, type: WidthType.DXA },
      columnWidths: [pctCell(50), pctCell(50)],
      layout: "fixed",
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
        left: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
        right: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
        insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
        insideVertical: { style: BorderStyle.NONE, size: 0, color: "ffffff" },
      },
      rows: [
        // Row 1: Signature Images
        new TableRow({
          children: [
            new TableCell({
              width: { size: pctCell(50), type: WidthType.DXA },
              children: sigCells.imgLeft,
            }),
            new TableCell({
              width: { size: pctCell(50), type: WidthType.DXA },
              children: sigCells.imgRight,
            }),
          ],
        }),
        // Row 2: Doctor Names & Credentials
        new TableRow({
          children: [
            new TableCell({
              width: { size: pctCell(50), type: WidthType.DXA },
              children: sigCells.textLeft,
            }),
            new TableCell({
              width: { size: pctCell(50), type: WidthType.DXA },
              children: sigCells.textRight,
            }),
          ],
        }),
      ],
    }),
  ]

  // No reserved margin band. Reports no longer print onto pre-printed
  // letterhead — every doctor now positions their own logo/address/signature
  // content inside the body itself — so a blank top/bottom/left/right band
  // would just be dead space with nothing reserved for it. Content starts at
  // the paper edge; anyone who still needs margin for a specific report can
  // set one from Word's own Layout tab after opening the file.
  //
  // header/footer must be zeroed too, explicitly. The docx library defaults
  // those to 708 twips (0.5") whenever they're left out of `margin` — a leftover
  // band reserved for a header/footer that this document doesn't have — so
  // top: 0 alone still left a gap above the content.
  //
  // The page SIZE is declared explicitly too. Without `<w:pgSz>` a reader has to
  // fall back to its own default — relying on Word's own default (US Letter,
  // in its US builds) would silently reflow every report. Stating A4 is simply
  // correct: these reports are printed on A4.
  return await Packer.toBase64String(new Document({
    sections: [{
      properties: {
        page: {
          size: { width: A4_WIDTH, height: A4_HEIGHT },
          margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 },
        },
      },
      children,
    }],
  }))
}
