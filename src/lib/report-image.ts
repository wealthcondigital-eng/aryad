// Inserted report images (photos, scans, logos, stamps) and their Word-style
// text-wrapping modes.
//
// ONE source of truth for the markup, deliberately: the report body is stored
// as an HTML string and then re-rendered by four different consumers — the
// Tiptap editor (node view), the view modal (`innerHTML`), the print window
// (raw HTML in a fresh document with none of the app's CSS) and the shared PDF
// (html2canvas over hand-built HTML). If each one styled images its own way,
// an image dragged into place in the editor would land somewhere else on paper.
// So the wrap mode is expressed purely as inline styles built by the two
// functions below, which the node view and the HTML serializer both call —
// nothing about an image's placement depends on a stylesheet being loaded.
//
// Positions are px, in the same 794px-wide A4 coordinate space the editor,
// print output and PDF all share (see report-layout.ts) — that's what makes a
// freely-dragged "behind text" image land in the same spot in all four.

export type ImageWrap =
  | "inline"        // Word: "In Line with Text"
  | "square-left"   // Word: "Square", image floated left
  | "square-right"  // Word: "Square", image floated right
  | "top-bottom"    // Word: "Top and Bottom"
  | "behind"        // Word: "Behind Text"
  | "front"         // Word: "In Front of Text"

export interface ReportImageAttrs {
  src: string
  width: number
  height: number
  wrap: ImageWrap
  /** Offset from the image's anchor point in the text — only used when floating. */
  left: number
  top: number
  /** True once the "Glow Edges" artistic effect has knocked out the background. */
  bgRemoved?: boolean
}

export const IMAGE_WRAP_OPTIONS: { value: ImageWrap; label: string }[] = [
  { value: "inline", label: "In Line with Text" },
  { value: "square-left", label: "Square — left" },
  { value: "square-right", label: "Square — right" },
  { value: "top-bottom", label: "Top and Bottom" },
  { value: "behind", label: "Behind Text" },
  { value: "front", label: "In Front of Text" },
]

/**
 * "Behind Text" / "In Front of Text" — the two modes where the image leaves the
 * text flow entirely and can be dragged anywhere on the page. Everything else
 * keeps its place in the flow and pushes text around instead.
 */
export function isFloatingWrap(wrap: ImageWrap): boolean {
  return wrap === "behind" || wrap === "front"
}

/** Gutter between a squared (floated) image and the text flowing beside it. */
const SQUARE_GAP = 12

/**
 * Style for the anchor <span> that holds the image.
 *
 * A floating image's anchor collapses to a zero-sized box: it marks the spot in
 * the text the image belongs to (so the position survives editing above it, the
 * way a Word anchor does) while taking up no room itself — which is exactly why
 * text is free to run underneath a "Behind Text" image. It's also the
 * positioned ancestor the absolute offsets below resolve against, so an image
 * dragged 40px right of its anchor sits 40px right of that same word on paper.
 */
export function imageAnchorStyle(a: ReportImageAttrs): string {
  switch (a.wrap) {
    case "behind":
    case "front":
      return "position:relative;display:inline-block;width:0;height:0;line-height:0;vertical-align:baseline;"
    case "square-left":
      return `float:left;display:block;width:${a.width}px;margin:2px ${SQUARE_GAP}px 4px 0;`
    case "square-right":
      return `float:right;display:block;width:${a.width}px;margin:2px 0 4px ${SQUARE_GAP}px;`
    case "top-bottom":
      return `display:block;width:${a.width}px;margin:10px auto;`
    default:
      return "display:inline-block;vertical-align:middle;line-height:0;"
  }
}

/**
 * Style for the <img> itself.
 *
 * `z-index:-1` is what actually puts a "Behind Text" image behind the words,
 * and it only works because the report body element is its own stacking context
 * (`.doc-field { position:relative; z-index:0 }` in globals.css, and the same
 * pair inside REPORT_BODY_STYLE for the print/PDF paths). Without that, a
 * negative z-index would paint the image *behind the white page itself* — i.e.
 * invisible — since a negative-z child paints under its ancestors' backgrounds
 * up to the nearest stacking context.
 */
export function imageStyle(a: ReportImageAttrs): string {
  const size = `width:${a.width}px;height:${a.height}px;`
  if (isFloatingWrap(a.wrap)) {
    return (
      `position:absolute;left:${a.left}px;top:${a.top}px;${size}` +
      `z-index:${a.wrap === "behind" ? -1 : 5};max-width:none;`
    )
  }
  return `display:block;${size}max-width:none;`
}

/**
 * Data attributes carrying the wrap state through save → reload → export.
 *
 * Offsets are only written for the floating modes that actually use them, so an
 * in-flow image can't come back from a reload carrying a stale offset from
 * whatever it was before, and the saved HTML says exactly what it means.
 */
export function imageDataAttrs(a: ReportImageAttrs): Record<string, string> {
  return {
    "data-rimg": "1",
    "data-wrap": a.wrap,
    ...(isFloatingWrap(a.wrap) ? { "data-left": String(a.left), "data-top": String(a.top) } : {}),
    ...(a.bgRemoved ? { "data-bg-removed": "1" } : {}),
  }
}

/** Inverse of imageDataAttrs — used by the HTML parse rule and the DOCX export. */
export function readImageDataAttrs(el: HTMLElement): ReportImageAttrs {
  const num = (v: string | null, fallback = 0) => {
    const n = parseFloat(v ?? "")
    return Number.isFinite(n) ? n : fallback
  }
  const wrapAttr = el.getAttribute("data-wrap") as ImageWrap | null
  const wrap = IMAGE_WRAP_OPTIONS.some((o) => o.value === wrapAttr) ? (wrapAttr as ImageWrap) : "inline"
  return {
    src: el.getAttribute("src") || "",
    width: num(el.style?.width || el.getAttribute("width"), 200),
    height: num(el.style?.height || el.getAttribute("height"), 150),
    wrap,
    left: num(el.getAttribute("data-left")),
    top: num(el.getAttribute("data-top")),
    bgRemoved: el.getAttribute("data-bg-removed") === "1",
  }
}

// ── Insert-time sizing ───────────────────────────────────────────────────────
// A4 (794px) minus the 56px side padding the editor, print window and PDF all
// use — an image is never inserted wider than the text column, so it can't be
// clipped off the edge of the paper on the very first drop.
export const REPORT_CONTENT_WIDTH_PX = 794 - 56 * 2

export function fitInsertedSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  const w = naturalWidth || 200
  const h = naturalHeight || 150
  if (w <= REPORT_CONTENT_WIDTH_PX) return { width: Math.round(w), height: Math.round(h) }
  const scale = REPORT_CONTENT_WIDTH_PX / w
  return { width: REPORT_CONTENT_WIDTH_PX, height: Math.max(1, Math.round(h * scale)) }
}
