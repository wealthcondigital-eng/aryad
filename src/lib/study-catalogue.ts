// Category vocabulary for studies.
//
// It is deliberately the SAME vocabulary the report templates use: a template
// the clinic filed under "USG / Sonography" has to put its study in that
// column of the monthly register, not somewhere a keyword guess put it. A
// study's category is therefore always something a person chose — on the
// template, on the Studies page, or on the registration form — and is never
// derived from the study's name.
//
// Templates store the five bundled categories by key ("usg") and any
// clinic-created one verbatim ("MRI"), while studies and register rows store
// the display label. Everything is funnelled through canonicalCategory()
// before it is saved so both ends agree on one spelling.

export const BUILT_IN_CATEGORY_KEYS = ["usg", "doppler", "xray", "pathology", "obstetric"] as const
export type BuiltInCategoryKey = (typeof BUILT_IN_CATEGORY_KEYS)[number]

export const CATEGORY_LABEL: Record<BuiltInCategoryKey, string> = {
  usg:       "USG / Sonography",
  doppler:   "Doppler",
  xray:      "X-Ray",
  pathology: "Pathology",
  obstetric: "Obstetric USG",
}

// Every spelling that has ever been written for one of the five bundled
// categories — template keys, the labels themselves, and the older
// three-category study vocabulary ("Sonography") — mapped to one label.
const CATEGORY_ALIASES: Record<string, string> = {
  "usg":              CATEGORY_LABEL.usg,
  "sonography":       CATEGORY_LABEL.usg,
  "ultrasound":       CATEGORY_LABEL.usg,
  "usg / sonography": CATEGORY_LABEL.usg,
  "usg/sonography":   CATEGORY_LABEL.usg,
  "doppler":          CATEGORY_LABEL.doppler,
  "xray":             CATEGORY_LABEL.xray,
  "x-ray":            CATEGORY_LABEL.xray,
  "x ray":            CATEGORY_LABEL.xray,
  "pathology":        CATEGORY_LABEL.pathology,
  "obstetric":        CATEGORY_LABEL.obstetric,
  "obstetric usg":    CATEGORY_LABEL.obstetric,
}

// A category the clinic typed keeps its own casing ("MRI", "CT Scan"); one
// created in lower case by a bulk import reads better capitalised.
export const prettyCategory = (cat: string) => {
  const trimmed = cat.trim()
  return trimmed === trimmed.toLowerCase()
    ? trimmed.replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : trimmed
}

// The one spelling a category is stored under. Blank in, blank out — an
// uncategorised study stays uncategorised rather than being guessed at.
export function canonicalCategory(cat: string | null | undefined): string {
  const trimmed = String(cat ?? "").trim()
  if (!trimmed) return ""
  return CATEGORY_ALIASES[trimmed.toLowerCase()] ?? prettyCategory(trimmed)
}

// The five bundled categories, offered first wherever a category is picked.
export const STUDY_CATEGORIES = BUILT_IN_CATEGORY_KEYS.map((k) => CATEGORY_LABEL[k])

// The bundled categories plus whatever the clinic has actually used, bundled
// ones first and the clinic's own alphabetised after them.
export function mergeCategories(...lists: (string | null | undefined)[][]): string[] {
  const seen = new Set(STUDY_CATEGORIES)
  const extra: string[] = []
  for (const list of lists) {
    for (const raw of list) {
      const cat = canonicalCategory(raw)
      if (!cat || seen.has(cat)) continue
      seen.add(cat)
      extra.push(cat)
    }
  }
  return [...STUDY_CATEGORIES, ...extra.sort((a, b) => a.localeCompare(b))]
}

// Shown in place of a blank category — never written to the database.
export const UNCATEGORISED_LABEL = "Uncategorised"
