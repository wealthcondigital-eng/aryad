// Server-side lookup of the category a study belongs to.
//
// Nothing here guesses from the study's name. A category only ever comes from
// somewhere a person put it:
//   1. the study's own record in the Studies catalogue, then
//   2. the report template of the same name (the clinic files those by
//      category on the Add Template page), then
//   3. blank — the study is uncategorised until someone picks a category.
//
// Blank is a real answer, not a failure: it shows as "Uncategorised" in the
// register and can be fixed in one click, which is far better than a wrong
// column that reads as deliberate.

import Study from "@/models/Study"
import Template from "@/models/Template"
import { canonicalCategory } from "@/lib/study-catalogue"

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Categories for many study names at once, keyed by lower-cased name. */
export async function resolveStudyCategories(names: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(
    names.map((n) => String(n ?? "").trim()).filter(Boolean).map((n) => n.toLowerCase())
  ))
  const found = new Map<string, string>()
  if (wanted.length === 0) return found

  const patterns = wanted.map((n) => new RegExp(`^${escapeRe(n)}$`, "i"))
  const [studies, templates] = await Promise.all([
    Study.find({ name: { $in: patterns } }, { name: 1, category: 1 }).lean<{ name: string; category?: string }[]>(),
    Template.find({ name: { $in: patterns } }, { name: 1, category: 1 }).lean<{ name: string; category?: string }[]>(),
  ])

  // Templates go in first so a catalogue entry that already has a category
  // overwrites them — the Studies page is the more specific place to set one.
  for (const t of templates) {
    const cat = canonicalCategory(t.category)
    if (cat) found.set(t.name.trim().toLowerCase(), cat)
  }
  for (const s of studies) {
    const cat = canonicalCategory(s.category)
    if (cat) found.set(s.name.trim().toLowerCase(), cat)
  }
  return found
}

/** Category for one study name, or "" when nobody has categorised it yet. */
export async function resolveStudyCategory(name: string | null | undefined): Promise<string> {
  const key = String(name ?? "").trim().toLowerCase()
  if (!key) return ""
  return (await resolveStudyCategories([key])).get(key) ?? ""
}

/**
 * The category to save for one study: what the caller explicitly chose, or
 * — only when it chose nothing — what is already on record for that name.
 */
export async function categoryFor(name: string, chosen?: string | null): Promise<string> {
  const explicit = canonicalCategory(chosen)
  if (explicit) return explicit
  return resolveStudyCategory(name)
}
