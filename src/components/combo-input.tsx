"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  CATEGORY_LABEL, STUDY_CATEGORIES, UNCATEGORISED_LABEL, canonicalCategory, mergeCategories,
} from "@/lib/study-catalogue"

// ─── Shared doctor list (persisted in localStorage) ──────────────────────────
export const INITIAL_DOCTORS = [
  "Dr. Mukesh D. Mokal", "Dr. Raj Mehta", "Dr. Anjali Gupta",
  "Dr. Vikram Shah", "Dr. Priya Roy", "Dr. Suresh Joshi",
]

export function getSavedDoctors(): string[] {
  try {
    const stored = localStorage.getItem("aarya_doctors")
    return stored ? JSON.parse(stored) : INITIAL_DOCTORS
  } catch { return INITIAL_DOCTORS }
}

export function saveDoctor(name: string, current: string[]): string[] {
  const trimmed = name.trim()
  if (!trimmed || current.includes(trimmed)) return current
  const updated = [...current, trimmed]
  try { localStorage.setItem("aarya_doctors", JSON.stringify(updated)) } catch {}
  return updated
}

// ─── Typeable input with dropdown suggestions ─────────────────────────────────
export function ComboInput({
  value, onChange, suggestions, placeholder, onSelect,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  onSelect?: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // De-duplicate — the same name can appear in several records (repeat visits)
  const filtered = Array.from(new Set(suggestions)).filter((s) =>
    s.toLowerCase().includes(value.toLowerCase())
  )

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                onChange(s)
                onSelect?.(s)
                setOpen(false)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Category badge colours ───────────────────────────────────────────────────
// The five bundled categories keep a fixed colour so they read the same on the
// Studies page, the registration form and the template list. Clinic-created
// ones ("MRI", "CT Scan") get a colour picked deterministically from their
// name, so each keeps the same one everywhere without being registered here.
const CAT_COLORS: Record<string, string> = {
  [CATEGORY_LABEL.usg]:       "bg-blue-100 text-blue-700",
  [CATEGORY_LABEL.doppler]:   "bg-violet-100 text-violet-700",
  [CATEGORY_LABEL.xray]:      "bg-orange-100 text-orange-700",
  [CATEGORY_LABEL.pathology]: "bg-emerald-100 text-emerald-700",
  [CATEGORY_LABEL.obstetric]: "bg-pink-100 text-pink-700",
}
const CUSTOM_CAT_COLORS = [
  "bg-cyan-100 text-cyan-700", "bg-indigo-100 text-indigo-700", "bg-teal-100 text-teal-700",
  "bg-rose-100 text-rose-700", "bg-amber-100 text-amber-700", "bg-purple-100 text-purple-700",
]

export function categoryColor(cat: string) {
  const key = canonicalCategory(cat)
  if (!key) return "bg-gray-100 text-gray-600"
  if (CAT_COLORS[key]) return CAT_COLORS[key]
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0
  return CUSTOM_CAT_COLORS[Math.abs(hash) % CUSTOM_CAT_COLORS.length]
}

// ─── Shared category list ─────────────────────────────────────────────────────
// Every category in use anywhere — templates included, so a study picks up the
// category its report template was filed under instead of a separate guess.
export function useCategories(): [string[], (cat: string) => void] {
  const [categories, setCategories] = useState<string[]>(STUDY_CATEGORIES)

  useEffect(() => {
    fetch("/api/categories")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.categories) && d.categories.length) setCategories(d.categories) })
      .catch(() => {})
  }, [])

  // A category typed into the "+ Add new category…" box is usable straight
  // away; it reaches the server only when the record that uses it is saved.
  const addCategory = useCallback((cat: string) => {
    const clean = canonicalCategory(cat)
    if (!clean) return
    setCategories((prev) => (prev.includes(clean) ? prev : mergeCategories(prev, [clean])))
  }, [])

  return [categories, addCategory]
}

// ─── Category picker (with "+ Add new category…") ─────────────────────────────
const NEW_CATEGORY_VALUE = "__new__"

export function CategorySelect({
  value, onChange, categories, onCategoryAdded, className, placeholder,
}: {
  value: string
  onChange: (cat: string) => void
  categories: string[]
  onCategoryAdded?: (cat: string) => void
  className?: string
  placeholder?: string
}) {
  const [typing, setTyping] = useState(false)
  const [draft,  setDraft]  = useState("")

  const commitNew = () => {
    const clean = canonicalCategory(draft)
    setTyping(false); setDraft("")
    if (!clean) return
    onCategoryAdded?.(clean)
    onChange(clean)
  }

  if (typing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitNew}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commitNew() }
          if (e.key === "Escape") { setTyping(false); setDraft("") }
        }}
        placeholder="New category name"
        className={className}
      />
    )
  }

  // The list always contains the current value, even if it is an older
  // spelling no longer offered — otherwise opening the picker on a saved
  // record would silently blank its category.
  const options = value && !categories.includes(value) ? [value, ...categories] : categories

  return (
    <Select
      value={value}
      onValueChange={(v) => { if (v === NEW_CATEGORY_VALUE) setTyping(true); else onChange(v) }}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder ?? UNCATEGORISED_LABEL} />
      </SelectTrigger>
      <SelectContent>
        {options.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        <SelectItem value={NEW_CATEGORY_VALUE} className="text-blue-600 font-medium">
          + Add new category…
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

export type StudyOption = { name: string; price: number; category: string }

// ─── Study autocomplete with category headers + price ────────────────────────
export function StudyComboInput({
  value, onChange, onSelect, placeholder, dbStudies,
}: {
  value: string
  onChange: (v: string) => void
  onSelect: (name: string, price: number, category: string) => void
  placeholder?: string
  dbStudies?: StudyOption[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Suggestions come only from the studies saved in the database.
  // If the caller doesn't supply them, fetch once on mount.
  const [fetchedStudies, setFetchedStudies] = useState<StudyOption[]>([])
  useEffect(() => {
    if (dbStudies) return
    fetch("/api/studies")
      .then((r) => r.json())
      .then((d) => setFetchedStudies(
        (d.studies || []).map((s: { name: string; price: number; category: string }) =>
          ({ name: s.name, price: s.price, category: s.category }))
      ))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allStudies: StudyOption[] = dbStudies ?? fetchedStudies

  const filtered = value.trim().length === 0
    ? allStudies
    : allStudies.filter((s) =>
        s.name.toLowerCase().includes(value.toLowerCase()) ||
        s.category.toLowerCase().includes(value.toLowerCase())
      )

  const grouped = filtered.reduce<Record<string, StudyOption[]>>((acc, s) => {
    const cat = canonicalCategory(s.category) || UNCATEGORISED_LABEL
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {})

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? "Type to search study or test..."}
        autoComplete="off"
      />

      {open && Object.keys(grouped).length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {Object.entries(grouped)
            .sort(([a], [b]) =>
              // Studies nobody has categorised yet sit at the bottom of the list
              (a === UNCATEGORISED_LABEL ? 1 : 0) - (b === UNCATEGORISED_LABEL ? 1 : 0) || a.localeCompare(b)
            )
            .map(([cat, list]) => (
            <div key={cat}>
              <p className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider sticky top-0 flex items-center gap-2 ${categoryColor(cat)} bg-opacity-60`}>
                {cat}
              </p>
              {list.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm flex justify-between items-center hover:bg-blue-50 hover:text-blue-700 transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(s.name)
                    onSelect(s.name, s.price, canonicalCategory(s.category))
                    setOpen(false)
                  }}
                >
                  <span>{s.name}</span>
                  <span className="text-xs text-muted-foreground ml-4 shrink-0">
                    {s.price > 0 ? `₹${s.price}` : "—"}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
