export type StudyCatalogueEntry = { name: string; price: number; category: string }

// Only three study types exist in this centre.
export const STUDY_CATEGORIES = [
  "X-Ray",
  "Sonography",
  "Pathology",
] as const

// The built-in catalogue is intentionally empty — the Studies list starts
// blank and only contains studies added by the staff (via the Studies page,
// patient registration or billing).
export const STUDY_CATALOGUE: StudyCatalogueEntry[] = []

export const CATALOGUE_CATEGORY_MAP: Record<string, string> = Object.fromEntries(
  STUDY_CATALOGUE.map((s) => [s.name, s.category])
)

export const CATALOGUE_PRICE_MAP: Record<string, number> = Object.fromEntries(
  STUDY_CATALOGUE.map((s) => [s.name, s.price])
)

// Detect one of the three categories from a typed study name.
export function autoCategory(name: string): string {
  if (CATALOGUE_CATEGORY_MAP[name]) return CATALOGUE_CATEGORY_MAP[name]
  const s = name.toLowerCase()
  if (/x-?ray|radiograph|barium|\bhsg\b|\bivp\b|\bmcu\b|\brgu\b|\bcxr\b/.test(s)) return "X-Ray"
  if (/usg|sono|ultrasound|doppler|obstetric|trimester|\btvs\b|fnac|carotid|venous|arterial|follicular|parotid|scrotum|\bavf\b|\bdvt\b/.test(s)) return "Sonography"
  return "Pathology"
}
