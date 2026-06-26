"use client"

import { useState, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import { STUDY_CATALOGUE, autoCategory } from "@/lib/study-catalogue"

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

  const filtered = suggestions.filter((s) =>
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
const CAT_COLORS: Record<string, string> = {
  "Sonography":  "bg-blue-100 text-blue-700",
  "X-Ray":       "bg-orange-100 text-orange-700",
  "Blood Test":  "bg-red-100 text-red-700",
  "Pathology":   "bg-purple-100 text-purple-700",
  "MRI":         "bg-indigo-100 text-indigo-700",
  "CT Scan":     "bg-cyan-100 text-cyan-700",
  "Cardiology":  "bg-pink-100 text-pink-700",
  "Other":       "bg-gray-100 text-gray-600",
}

export function categoryColor(cat: string) {
  return CAT_COLORS[cat] ?? CAT_COLORS["Other"]
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

  // Merge DB studies with catalogue — DB takes precedence for same name
  const allStudies: StudyOption[] = (() => {
    if (!dbStudies || dbStudies.length === 0) return STUDY_CATALOGUE
    const dbNames = new Set(dbStudies.map((s) => s.name))
    const catalogueOnly = STUDY_CATALOGUE.filter((s) => !dbNames.has(s.name))
    return [...dbStudies, ...catalogueOnly]
  })()

  const filtered = value.trim().length === 0
    ? allStudies
    : allStudies.filter((s) =>
        s.name.toLowerCase().includes(value.toLowerCase()) ||
        s.category.toLowerCase().includes(value.toLowerCase())
      )

  const grouped = filtered.reduce<Record<string, StudyOption[]>>((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {})

  // Detect category for whatever is typed (for custom / unrecognised entries)
  const detectedCat = value.trim() ? autoCategory(value.trim()) : null
  const isExactMatch = allStudies.some((s) => s.name.toLowerCase() === value.trim().toLowerCase())

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

      {/* Category pill shown below input when value is typed */}
      {value.trim() && detectedCat && (
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[11px] text-muted-foreground">
            {isExactMatch ? "Category:" : "Auto-detected:"}
          </span>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${categoryColor(detectedCat)}`}>
            {detectedCat}
          </span>
          {!isExactMatch && (
            <span className="text-[10px] text-muted-foreground italic">(editable after saving)</span>
          )}
        </div>
      )}

      {open && Object.keys(grouped).length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {Object.entries(grouped).map(([cat, list]) => (
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
                    onSelect(s.name, s.price, s.category)
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
