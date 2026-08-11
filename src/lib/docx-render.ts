// Server-side DOCX -> HTML at the highest fidelity this app can reach.
//
// Replaces the mammoth path for imported Word templates. mammoth is
// semantic-first BY DESIGN: it maps Word *styles* onto plain tags and
// deliberately throws away direct formatting. Measured on the clinic's own
// "Folliclular study.docx", its output carries ZERO style attributes — no
// font, no size, no colour, no indent, no table borders, no page setup. Only
// structure plus bold/underline survive, which is why every imported template
// arrived looking nothing like the Word file it came from.
//
// docx-preview renders the OOXML the way a viewer would instead, so fonts,
// sizes, spacing, indents, alignment, table borders and shading, images and
// section/page setup all come through. On the same file it produces 85
// font-family and 54 border declarations.
//
// Three things have to happen after it renders, or the fidelity doesn't
// survive the trip into the editor:
//
//   1. docx-preview puts most of its formatting in a generated <style> block of
//      class rules. Tiptap keeps `style` attributes but drops both stylesheets
//      and unknown classes, so the CSS is inlined onto the elements first.
//   2. It wraps the document in its own viewer chrome — a grey, padded, flexbox
//      "desk" with the page as a white sheet on top. That's UI for a preview
//      pane, not part of the document, and it has to be unwrapped or every
//      imported template arrives with a grey background and 30px of padding.
//   3. Word's own headers/footers are rendered too, but this app reserves the
//      letterhead bands itself (see report-layout.ts) and prints on
//      pre-printed stationery — so they are dropped rather than duplicated
//      into the body.

import type { JSDOM as JSDOMType } from "jsdom"
import { pxCss } from "@/lib/css-length"

/** Globals docx-preview reaches for directly rather than off the passed-in document. */
const DOM_GLOBALS = [
  "window", "document", "DOMParser", "XMLSerializer",
  "Node", "Element", "HTMLElement", "getComputedStyle", "Blob", "URL",
] as const

/**
 * Renders a .docx buffer to self-contained HTML with every style inlined.
 *
 * Runs under jsdom rather than in the browser so the import stays a single
 * server round trip — uploading the file, converting it on the client and
 * posting the HTML back would put the conversion (and its failure modes) in
 * front of the user for no gain.
 */
export async function renderDocxToHtml(buffer: Buffer): Promise<string> {
  const { JSDOM } = await import("jsdom")
  const dom: JSDOMType = new JSDOM("<!doctype html><body><div id=\"docx-root\"></div></body>", {
    pretendToBeVisual: true,
  })

  // Saved and restored around the render: this is a shared Node process serving
  // every other request, and leaving a jsdom `document` on globalThis would
  // leak into anything that feature-detects a DOM (report-layout.ts does
  // exactly that) and make it take browser code paths on the server.
  const saved = new Map<string, unknown>()
  for (const key of DOM_GLOBALS) {
    const g = globalThis as unknown as Record<string, unknown>
    saved.set(key, g[key])
    try {
      g[key] = key === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]
    } catch {
      // Some globals (navigator) are getter-only on newer Node — docx-preview
      // doesn't need them, so a failure to override is not fatal.
      saved.delete(key)
    }
  }

  try {
    const { renderAsync } = await import("docx-preview")
    const root = dom.window.document.getElementById("docx-root")!
    await renderAsync(buffer, root, undefined, {
      inWrapper: true,
      breakPages: true,
      ignoreWidth: false,
      ignoreHeight: false,
      // Word's own header/footer are reserved bands here, not body content.
      renderHeaders: false,
      renderFooters: false,
      renderFootnotes: true,
      // Images must travel inside the HTML: the template is stored as a single
      // HTML string in Mongo, so a blob: URL would be dead the moment this
      // request ends.
      useBase64URL: true,
    })
    return unwrapDocxChrome(await inlineStyles(root.innerHTML), dom)
  } finally {
    for (const [key, value] of saved) {
      try { (globalThis as unknown as Record<string, unknown>)[key] = value } catch { /* see above */ }
    }
    dom.window.close()
  }
}

/** Folds docx-preview's generated <style> rules into `style` attributes. */
async function inlineStyles(html: string): Promise<string> {
  try {
    // juice ships as CommonJS, so under ESM the callable lands on `.default` —
    // and a plain `require` isn't available here at all.
    const mod = await import("juice")
    const run = (mod as unknown as { default?: (h: string) => string }).default
      ?? (mod as unknown as (h: string) => string)
    return run(html)
  } catch {
    // A malformed stylesheet must not lose the document — the un-inlined HTML
    // still carries every structural element and its direct formatting.
    return html
  }
}

/**
 * Strips docx-preview's preview-pane chrome, returning just the page content.
 *
 * The wrapper is a grey flexbox "desk" and each section is a fixed-size white
 * sheet with its own page margins — correct for a viewer, wrong for content
 * being pasted into an editor that already draws its own A4 sheets.
 */
function unwrapDocxChrome(html: string, dom: JSDOMType): string {
  const doc = new dom.window.DOMParser().parseFromString(`<body>${html}</body>`, "text/html")

  const sections = Array.from(doc.querySelectorAll("section"))
  const parts = sections.length
    ? sections
    : Array.from(doc.querySelectorAll(".docx-wrapper > *"))

  const host = doc.createElement("div")
  for (const part of (parts.length ? parts : [doc.body])) {
    // A section carries the sheet's own size and margins as inline styles. The
    // report editor supplies both, so they are dropped and only the children
    // are kept.
    while (part.firstChild) host.appendChild(part.firstChild)
  }

  // Inside each section docx-preview nests an <article> holding the actual
  // content. It has to come off too: splitHeaderFromHtml recognises the patient
  // block by matching a <table> at the very START of the string, and a wrapper
  // in front of it means nothing is ever stripped — the imported template then
  // repeats the patient box and study title that the editor already draws.
  for (const article of Array.from(host.querySelectorAll("article"))) {
    const parent = article.parentNode
    if (!parent) continue
    while (article.firstChild) parent.insertBefore(article.firstChild, article)
    parent.removeChild(article)
  }

  // docx-preview marks its own column/page break helpers; they describe ITS
  // pagination, not this app's, and the pagination engine here recomputes
  // breaks from measured geometry anyway.
  host.querySelectorAll(".docx-break, .docx-column-break").forEach((el) => el.remove())

  // Class names are dead weight once the CSS is inlined — the editor loads none
  // of docx-preview's stylesheet, so they can only collide with the app's own.
  host.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"))

  tidyInlineStyles(host, dom)
  return host.innerHTML
}

/**
 * Two clean-ups on the inlined styles, both about how the result behaves once
 * it is inside the report editor rather than a preview pane.
 *
 * 1. `min-height` is dropped. docx-preview stamps the line height onto every
 *    run and paragraph as a min-height; in the editor those floors fight the
 *    real line height (and each other) and make an imported template taller
 *    than the Word document it came from, page for page.
 *
 * 2. Adjacent spans carrying identical styles are merged. docx-preview emits
 *    ONE SPAN PER WORD — a 450-word template arrives as ~900 elements with five
 *    style declarations each, which is what the editor then has to lay out,
 *    paginate and store on every keystroke. Merging is lossless: same styles,
 *    same text, one element.
 */
/**
 * Word's line spacing → the CSS that renders the same height.
 *
 * OOXML's `w:lineRule="auto"` is a MULTIPLE OF THE FONT'S NATURAL LINE HEIGHT,
 * not of its point size: "single" (w:line="240") means one natural line, which
 * for a 12pt serif is about 14pt. docx-preview writes that as `line-height: 1`,
 * and CSS reads a unitless line-height as a multiple of the FONT SIZE — 12pt.
 * So every line, and every blank line, came out ~15% shorter than Word draws
 * it, and a whole imported template rendered visibly tighter than its original.
 *
 * `normal` is CSS's own "the font's natural line height", which is exactly what
 * Word means by single spacing — so that is what single becomes. Other
 * multiples keep their ratio, scaled by the same natural-leading factor, since
 * CSS cannot multiply `normal` directly.
 */
const NATURAL_LEADING = 1.15

export function rewriteWordLineHeight(style: string): string {
  return style.replace(/line-height:\s*([\d.]+)\s*(?=;|$)/gi, (whole, raw: string) => {
    const ratio = parseFloat(raw)
    if (!Number.isFinite(ratio) || ratio <= 0) return whole
    if (Math.abs(ratio - 1) < 0.02) return "line-height: normal"
    return `line-height: ${(ratio * NATURAL_LEADING).toFixed(2)}`
  })
}

function tidyInlineStyles(host: HTMLElement, dom: JSDOMType): void {
  host.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    // ProseMirror table/row attributes are numeric pixel values. Leaving Word's
    // native points in the HTML makes `12.9pt` come back as `12px`, and the
    // error compounds across every row. Normalize absolute point lengths once
    // at the import boundary so screen, pagination, PDF and DOCX all use the
    // same 96dpi measurements.
    const original = el.getAttribute("style") ?? ""
    const style = original.replace(/(-?[\d.]+)pt\b/gi, (value) => pxCss(value) ?? value)
    if (style !== original) el.setAttribute("style", style)
    const withLineHeight = rewriteWordLineHeight(style)
    if (withLineHeight !== style) el.setAttribute("style", withLineHeight)
    if (!withLineHeight.includes("min-height")) return
    const cleaned = withLineHeight
      .split(";")
      .filter((d) => !/^\s*min-height\s*:/i.test(d))
      .join(";")
      .replace(/^\s*;|;\s*$/g, "")
      .trim()
    if (cleaned) el.setAttribute("style", cleaned)
    else el.removeAttribute("style")
  })

  const sameShell = (a: Element, b: Element) =>
    a.tagName === b.tagName
    && a.tagName === "SPAN"
    && (a.getAttribute("style") ?? "") === (b.getAttribute("style") ?? "")
    && a.attributes.length === b.attributes.length

  for (const parent of Array.from(host.querySelectorAll("*")) as Element[]) {
    let child = parent.firstElementChild
    while (child) {
      const next = child.nextElementSibling
      // Only merge when they are truly adjacent: a text node between two spans
      // is content, and folding it away would delete it.
      if (next && child.nextSibling === next && sameShell(child, next)) {
        while (next.firstChild) child.appendChild(next.firstChild)
        next.remove()
        continue   // `child` may now merge with the one after that too
      }
      child = next
    }
  }

  void dom
}
