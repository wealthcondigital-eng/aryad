// ── The report font list, and how each family renders off Windows ────────────
//
// Reports are written in the fonts a clinic already knows from Word — Cambria,
// Calibri, Arial, Times New Roman. Those are Windows/Office fonts: on Linux and
// on most Macs they simply are not installed, so the browser silently falls back
// to one default face and the whole font menu renders (and prints) identically.
// The doctor picks Georgia, gets whatever the system had. Same for the PDF, and
// for a receptionist opening the report on a different machine.
//
// So every family below is declared as a real @font-face whose first source is
// `local(...)` — the genuine font, when the machine has it — followed by a
// bundled open substitute in public/fonts. On a Windows clinic PC nothing
// changes: local() matches and the report is byte-for-byte the Word look. Off
// Windows the substitute renders instead, and for the six families that matter
// most it is metric-compatible (same advance widths as the original), so line
// breaks and page breaks land in exactly the same places:
//
//   Arimo ≈ Arial · Tinos ≈ Times New Roman · Cousine ≈ Courier New
//   Carlito ≈ Calibri · Caladea ≈ Cambria · Gelasio ≈ Georgia
//
// The rest map to the closest open face by character (Open Sans for the humanist
// Segoe/Candara/Corbel group, EB Garamond for the old-style serifs, and so on) —
// close enough to tell apart in the font menu and to read as the intended
// design, without claiming to match metrics.
//
// All bundled faces are OFL/Apache licensed (Chrome OS core fonts + Google
// Fonts), which is why they can ship in the repo — unlike Arial or Cambria.

type Generic = "serif" | "sans-serif" | "monospace" | "cursive"

type FontDef = {
  /** The family name written into the document, print HTML, PDF and DOCX. */
  name: string
  /** Bundled substitute file stem in public/fonts. */
  sub: string
  generic: Generic
  /** Extra locally-installed families to try before the bundled file. */
  locals?: string[]
  /** Substitutes shipped as a single regular face (display faces). */
  singleFace?: boolean
  /** Heavy families (Arial Black) take the substitute's bold at every weight. */
  alwaysBold?: boolean
}

const FONTS: FontDef[] = [
  { name: "Arial", sub: "arimo", generic: "sans-serif", locals: ["Helvetica", "Liberation Sans"] },
  { name: "Arial Black", sub: "arimo", generic: "sans-serif", alwaysBold: true },
  { name: "Arial Narrow", sub: "archivo-narrow", generic: "sans-serif", locals: ["Liberation Sans Narrow"] },
  { name: "Times New Roman", sub: "tinos", generic: "serif", locals: ["Liberation Serif"] },
  { name: "Courier New", sub: "cousine", generic: "monospace", locals: ["Liberation Mono"] },
  { name: "Georgia", sub: "gelasio", generic: "serif" },
  { name: "Verdana", sub: "open-sans", generic: "sans-serif", locals: ["DejaVu Sans"] },
  { name: "Calibri", sub: "carlito", generic: "sans-serif" },
  { name: "Cambria", sub: "caladea", generic: "serif" },
  { name: "Candara", sub: "open-sans", generic: "sans-serif" },
  { name: "Consolas", sub: "cousine", generic: "monospace", locals: ["DejaVu Sans Mono"] },
  { name: "Constantia", sub: "eb-garamond", generic: "serif" },
  { name: "Corbel", sub: "open-sans", generic: "sans-serif" },
  { name: "Tahoma", sub: "open-sans", generic: "sans-serif", locals: ["DejaVu Sans"] },
  { name: "Trebuchet MS", sub: "open-sans", generic: "sans-serif" },
  { name: "Segoe UI", sub: "open-sans", generic: "sans-serif", locals: ["Selawik", "Noto Sans"] },
  { name: "Segoe Print", sub: "comic-neue", generic: "cursive" },
  { name: "Segoe Script", sub: "comic-neue", generic: "cursive" },
  { name: "Garamond", sub: "eb-garamond", generic: "serif" },
  { name: "Book Antiqua", sub: "eb-garamond", generic: "serif", locals: ["Palatino", "P052"] },
  { name: "Bookman Old Style", sub: "gelasio", generic: "serif", locals: ["URW Bookman"] },
  { name: "Century Gothic", sub: "open-sans", generic: "sans-serif", locals: ["URW Gothic"] },
  { name: "Franklin Gothic Medium", sub: "arimo", generic: "sans-serif" },
  { name: "Palatino Linotype", sub: "eb-garamond", generic: "serif", locals: ["Palatino", "P052"] },
  { name: "Lucida Sans Unicode", sub: "open-sans", generic: "sans-serif", locals: ["DejaVu Sans"] },
  { name: "Lucida Console", sub: "cousine", generic: "monospace", locals: ["DejaVu Sans Mono"] },
  { name: "Comic Sans MS", sub: "comic-neue", generic: "cursive" },
  { name: "Impact", sub: "anton", generic: "sans-serif", singleFace: true },
  { name: "Rockwell", sub: "caladea", generic: "serif" },
  { name: "Perpetua", sub: "eb-garamond", generic: "serif" },
]

/** Font-menu order — the names a report actually stores. */
export const FONT_FAMILIES: string[] = FONTS.map((f) => f.name)

const GENERIC_BY_NAME = new Map(FONTS.map((f) => [f.name, f.generic]))

/**
 * `"Cambria", serif` — a family plus its generic, for anywhere a stack is
 * wanted rather than a bare name (the font menu's own previews, mostly).
 */
export function fontStack(name: string): string {
  const generic = GENERIC_BY_NAME.get(name) ?? "serif"
  return `"${name}", ${generic}`
}

const VARIANTS: { weight: 400 | 700; style: "normal" | "italic"; suffix: string }[] = [
  { weight: 400, style: "normal", suffix: "" },
  { weight: 700, style: "normal", suffix: " Bold" },
  { weight: 400, style: "italic", suffix: " Italic" },
  { weight: 700, style: "italic", suffix: " Bold Italic" },
]

/**
 * The @font-face block for every family above.
 *
 * `baseUrl` is prefixed to each file path: empty for the app itself (a normal
 * root-relative URL), and the app's origin for a print window, whose document is
 * written into `about:blank` and would resolve "/fonts/..." against nothing.
 */
export function reportFontFaceCss(baseUrl = ""): string {
  const base = baseUrl.replace(/\/$/, "")
  const out: string[] = []

  for (const f of FONTS) {
    for (const v of VARIANTS) {
      // A substitute shipped as one regular face covers all four slots; the
      // browser synthesizes the bold and the slant, exactly as it would for a
      // system font with no bold face of its own.
      const fileWeight = f.singleFace ? 400 : f.alwaysBold ? 700 : v.weight
      const fileStyle = f.singleFace ? "normal" : v.style
      const url = `${base}/fonts/${f.sub}-${fileWeight}-${fileStyle}.woff2`

      // Full names, not the bare family: `local("Arial")` inside a 700 face
      // matches Arial *Regular* and Windows would then draw "bold" text at
      // regular weight. The bare name belongs only in the regular slot.
      const locals = [
        `local("${f.name}${v.suffix}")`,
        ...(f.locals ?? []).map((l) => `local("${l}${v.suffix}")`),
      ]

      out.push(
        `@font-face{font-family:"${f.name}";font-style:${v.style};font-weight:${v.weight};` +
        `font-display:swap;src:${locals.join(",")},url("${url}") format("woff2");}`
      )
    }
  }

  return out.join("\n")
}
