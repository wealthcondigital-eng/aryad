"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Search, LayoutTemplate, Info, Plus, Trash2, Loader2,
  AlertCircle, Eye, Upload, FileText, FolderPlus, Layers, FileStack,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { motion } from "motion/react"
import { REPORT_TEMPLATES, TemplateCategory } from "@/lib/report-templates"

const BUILT_IN_CATS: TemplateCategory[] = ["usg", "doppler", "xray", "pathology"]
const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  usg: "USG / Sonography", doppler: "Doppler", xray: "X-Ray", pathology: "Pathology",
}
const CATEGORY_COLOR: Record<TemplateCategory, string> = {
  usg:       "bg-blue-100 text-blue-700",
  doppler:   "bg-violet-100 text-violet-700",
  xray:      "bg-amber-100 text-amber-700",
  pathology: "bg-emerald-100 text-emerald-700",
}
// Custom (clinic-created) categories don't have a fixed colour, so pick one
// deterministically from a small palette based on the category name.
const CUSTOM_PALETTE = [
  "bg-pink-100 text-pink-700", "bg-cyan-100 text-cyan-700", "bg-orange-100 text-orange-700",
  "bg-indigo-100 text-indigo-700", "bg-teal-100 text-teal-700", "bg-rose-100 text-rose-700",
]
function isBuiltIn(cat: string): cat is TemplateCategory {
  return (BUILT_IN_CATS as string[]).includes(cat)
}
function categoryLabel(cat: string) {
  return isBuiltIn(cat) ? CATEGORY_LABEL[cat] : cat
}
function categoryColorOf(cat: string) {
  if (isBuiltIn(cat)) return CATEGORY_COLOR[cat]
  let hash = 0
  for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) | 0
  return CUSTOM_PALETTE[Math.abs(hash) % CUSTOM_PALETTE.length]
}

// Sentinel select value that reveals the "type a new category" input
const NEW_CATEGORY_VALUE = "__new__"

function deriveNameFromFile(fileName: string) {
  return fileName.replace(/\.docx?$/i, "").replace(/[_-]+/g, " ").trim()
}

interface TemplateRow {
  id: string
  category: string
  name: string
  heading: string
  preview: string
  body: string
  custom: boolean   // false = built-in bundled template, true = clinic-added (deletable)
  createdAt?: string
}

// How long an imported template keeps showing the "New" badge in the list —
// long enough for whoever added it (and anyone else who opens this page soon
// after) to spot it, short enough that the badge doesn't become meaningless
// clutter on templates from weeks ago.
const NEW_BADGE_WINDOW_MS = 24 * 60 * 60 * 1000

function isRecentlyAdded(t: TemplateRow): boolean {
  return t.custom && !!t.createdAt && Date.now() - new Date(t.createdAt).getTime() < NEW_BADGE_WINDOW_MS
}

export default function AddTemplatePage() {
  const [customDocs, setCustomDocs] = useState<TemplateRow[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState("")
  const [catFilter,  setCatFilter]  = useState("All Categories")

  // Add-template dialog state
  const [addOpen,     setAddOpen]     = useState(false)
  const [addCatValue, setAddCatValue] = useState<string>("usg")
  const [newCatName,  setNewCatName]  = useState("")
  const [addName,     setAddName]     = useState("")
  const [nameEdited,  setNameEdited]  = useState(false)   // true once the user has typed a name themselves
  const [addFile,     setAddFile]     = useState<File | null>(null)
  const [addSaving,   setAddSaving]   = useState(false)
  const [addError,    setAddError]    = useState("")
  const [duplicateMsg, setDuplicateMsg] = useState<string | null>(null)

  // Preview + delete
  const [previewTpl,  setPreviewTpl]  = useState<TemplateRow | null>(null)
  const [deletingId,  setDeletingId]  = useState<string | null>(null)

  const loadCustom = () => {
    setLoading(true)
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => {
        const rows: TemplateRow[] = (d.templates ?? []).map((t: {
          _id: string; category: string; name: string; heading: string; preview: string; body: string; createdAt?: string
        }) => ({
          id: t._id, category: t.category, name: t.name, heading: t.heading,
          preview: t.preview, body: t.body, custom: true, createdAt: t.createdAt,
        }))
        setCustomDocs(rows)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCustom() }, [])

  // Built-in bundled templates, normalised into the same row shape
  const builtInDocs: TemplateRow[] = useMemo(() => (
    BUILT_IN_CATS.flatMap((cat) =>
      REPORT_TEMPLATES[cat].map((t) => ({
        id: t.id, category: cat, name: t.name, heading: t.heading,
        preview: t.preview, body: t.body, custom: false,
      }))
    )
  ), [])

  const allDocs = [...builtInDocs, ...customDocs]
  const customCount  = customDocs.length
  const builtInCount = builtInDocs.length

  // Every distinct category actually in use — the 4 built-ins (always shown)
  // plus any the clinic has created, alphabetised after the built-ins.
  const customCategories = useMemo(() => (
    Array.from(new Set(customDocs.map((d) => d.category)))
      .filter((c) => !isBuiltIn(c))
      .sort((a, b) => a.localeCompare(b))
  ), [customDocs])
  const allCategoryKeys = [...BUILT_IN_CATS, ...customCategories]

  const filterCategories = ["All Categories", ...allCategoryKeys.map(categoryLabel)]

  const filtered = allDocs.filter((t) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase())
    const matchCat    = catFilter === "All Categories" || categoryLabel(t.category) === catFilter
    return matchSearch && matchCat
  })

  const grouped: Record<string, TemplateRow[]> = {}
  for (const t of filtered) {
    if (!grouped[t.category]) grouped[t.category] = []
    grouped[t.category].push(t)
  }

  // ── Add template (Word import) ────────────────────────────────────────────────
  const openAddDialog = () => {
    setAddCatValue("usg"); setNewCatName(""); setAddName(""); setNameEdited(false); setAddFile(null)
    setAddError(""); setDuplicateMsg(null)
    setAddOpen(true)
  }

  const handleFileChange = (file: File | null) => {
    setAddFile(file)
    setDuplicateMsg(null)
    // Keep the name following the file automatically — including when the
    // user swaps in a different file after already choosing one — until
    // they've actually typed a name of their own, at which point their
    // choice is left alone rather than being overwritten again.
    if (file && !nameEdited) setAddName(deriveNameFromFile(file.name))
  }

  // force=true bypasses the duplicate-name check — used when the user
  // confirms "Add Anyway" after seeing the duplicate warning below.
  const handleAdd = async (force = false) => {
    const category = addCatValue === NEW_CATEGORY_VALUE ? newCatName.trim() : addCatValue
    if (!category) { setAddError("Enter a name for the new category."); return }
    if (!addFile) { setAddError("Choose a .doc or .docx file to import."); return }
    setAddSaving(true)
    setAddError("")
    try {
      const form = new FormData()
      form.append("category", category)
      form.append("name", addName)
      form.append("file", addFile)
      if (force) form.append("force", "1")
      const res = await fetch("/api/templates", { method: "POST", body: form })
      const data = await res.json()
      if (res.status === 409 && data.duplicate) {
        setDuplicateMsg(data.message || "A template with this name already exists.")
        return
      }
      if (!res.ok) { setAddError(data.error || "Failed to add template."); return }
      const t = data.template
      const row: TemplateRow = { id: t._id, category: t.category, name: t.name, heading: t.heading, preview: t.preview, body: t.body, custom: true, createdAt: t.createdAt }
      setCustomDocs((prev) => [row, ...prev])
      setAddOpen(false)
      setDuplicateMsg(null)
      setPreviewTpl(row)
    } catch {
      setAddError("Failed to add template. Please try again.")
    } finally {
      setAddSaving(false)
    }
  }

  const handleDelete = async (t: TemplateRow) => {
    if (!confirm(`Remove "${t.name}"? This can't be undone.`)) return
    setDeletingId(t.id)
    try {
      const res = await fetch(`/api/templates/${t.id}`, { method: "DELETE" })
      if (res.ok) setCustomDocs((prev) => prev.filter((c) => c.id !== t.id))
    } finally {
      setDeletingId(null)
    }
  }

  const STATS = [
    { label: "Total Templates",   value: loading ? null : String(allDocs.length), icon: FileStack, color: "text-blue-500" },
    { label: "Categories",        value: String(allCategoryKeys.length),          icon: Layers,     color: "text-violet-500" },
    { label: "Imported (Custom)", value: loading ? null : String(customCount),    icon: Upload,     color: "text-emerald-500" },
    { label: "Built-in",          value: String(builtInCount),                    icon: LayoutTemplate, color: "text-gray-400" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Add Template</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Built-in templates plus any Word files the clinic has imported
          </p>
        </div>
        <Button onClick={openAddDialog} className="bg-blue-600 hover:bg-blue-700 gap-1.5 shadow-sm">
          <Plus className="h-4 w-4" />Add Template
        </Button>
      </div>

      {/* ── Add Template dialog — imports a .doc or .docx and creates a new template entry ── */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o) setAddOpen(false) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-blue-600" />Add Template
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Category <span className="text-red-500">*</span></Label>
              <Select value={addCatValue} onValueChange={setAddCatValue}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUILT_IN_CATS.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
                  {customCategories.length > 0 && <SelectSeparator />}
                  {customCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  <SelectSeparator />
                  <SelectItem value={NEW_CATEGORY_VALUE} className="text-blue-600 font-medium">
                    + Add new category…
                  </SelectItem>
                </SelectContent>
              </Select>
              {addCatValue === NEW_CATEGORY_VALUE && (
                <Input
                  autoFocus
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="e.g. MRI, CT Scan"
                  className="mt-1.5"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Template Name <span className="text-xs text-muted-foreground font-normal">(auto-filled from the file name)</span></Label>
              <Input
                value={addName}
                onChange={(e) => { setAddName(e.target.value); setNameEdited(true); setDuplicateMsg(null) }}
                placeholder="Choose a file below to fill this in"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Word File (.doc or .docx) <span className="text-red-500">*</span></Label>
              <input
                type="file"
                accept=".doc,.docx"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer cursor-pointer border border-input rounded-md"
              />
              <p className="text-[11px] text-muted-foreground">
                Both older (.doc) and modern (.docx) Word files are supported — the document&apos;s
                content is converted into a new template, and the patient-info header is detected
                and left out automatically.
              </p>
            </div>
            {addError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600">{addError}</p>
              </div>
            )}

            {/* Duplicate name found — offer to add it anyway rather than
                silently overwriting or silently blocking. */}
            {duplicateMsg ? (
              <>
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-amber-800 font-medium">Template already exists</p>
                    <p className="text-xs text-amber-700 mt-0.5">{duplicateMsg} Add it again as a duplicate?</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setDuplicateMsg(null)}>Cancel</Button>
                  <Button
                    size="sm" disabled={addSaving}
                    onClick={() => void handleAdd(true)}
                    className="bg-amber-600 hover:bg-amber-700 gap-1.5"
                  >
                    {addSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    {addSaving ? "Adding…" : "Add Anyway"}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={!addFile || addSaving} onClick={() => void handleAdd()} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
                  {addSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {addSaving ? "Importing…" : "Import & Save"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Preview dialog — shows how an imported (or built-in) template looks ── */}
      <Dialog open={!!previewTpl} onOpenChange={(o) => { if (!o) setPreviewTpl(null) }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-4 pb-3 border-b">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              <DialogTitle className="text-base">{previewTpl?.name}</DialogTitle>
            </div>
            <p className="text-xs text-muted-foreground">This is exactly how it will look when applied in the report editor.</p>
          </DialogHeader>
          {previewTpl && (
            <div className="flex-1 overflow-y-auto px-6 py-5 bg-slate-50">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 max-w-xl mx-auto">
                <div className="text-center font-bold uppercase text-sm underline underline-offset-4 mb-5">
                  {previewTpl.heading}
                </div>
                <div
                  className="text-sm leading-relaxed text-gray-800 [&_p]:mb-2 [&_div]:mb-2"
                  dangerouslySetInnerHTML={{ __html: previewTpl.body }}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {STATS.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.3 }}>
            <Card className="h-full">
              <CardContent className="p-4 h-full">
                <s.icon className={`h-4 w-4 mb-1.5 ${s.color}`} />
                {s.value === null ? <Skeleton className="h-8 w-16 mb-1" /> : <p className="text-2xl font-bold">{s.value}</p>}
                <p className="text-sm text-muted-foreground mt-0.5">{s.label}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          Templates added here immediately show up in the report editor&apos;s Templates panel.
          Built-in templates ship with the app and can&apos;t be removed; imported ones can be deleted.
          Need a category that isn&apos;t listed? Choose <strong>+ Add new category…</strong> when adding a template.
        </span>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Template Library</CardTitle>
              <CardDescription>
                {loading ? "Loading…" : `${filtered.length} template${filtered.length !== 1 ? "s" : ""}${catFilter !== "All Categories" ? ` in ${catFilter}` : ""}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative w-52">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search templates…" className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={catFilter} onValueChange={setCatFilter}>
                <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {filterCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="px-4 pb-2 pt-3">
              {[...Array(6)].map((_, i) => (
                <motion.div key={i} className="flex items-center gap-4 py-3 border-b border-border/40 last:border-0"
                  initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.055, duration: 0.25, ease: "easeOut" }}>
                  <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <>
              {filtered.length === 0 && (
                <p className="text-center py-10 text-muted-foreground text-sm">
                  {allCategoryKeys.length === 0 ? "No templates yet." : "No templates match your search."}
                </p>
              )}
              {allCategoryKeys.filter((cat) => grouped[cat]?.length).map((cat) => {
                const items = grouped[cat]
                const color = categoryColorOf(cat)
                return (
                  <div key={cat}>
                    <div className={`px-4 py-2 border-y border-border flex items-center gap-2 ${color} bg-opacity-50`}>
                      {!isBuiltIn(cat) && <FolderPlus className="h-3 w-3 opacity-70" />}
                      <p className="text-xs font-bold uppercase tracking-wide">{categoryLabel(cat)}</p>
                      <span className="text-[10px] font-medium opacity-70">{items.length} template{items.length !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="divide-y divide-border">
                      {items.map((t) => (
                        <div key={t.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${color} bg-opacity-20`}>
                            <LayoutTemplate className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-medium text-sm">{t.name}</p>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                t.custom ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                              }`}>
                                {t.custom ? "Custom" : "Built-in"}
                              </span>
                              {isRecentlyAdded(t) && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                                  New
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.preview}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => setPreviewTpl(t)}
                              className="h-8 w-8 flex items-center justify-center rounded hover:bg-blue-100 text-blue-500 transition-all"
                              title="Preview"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {t.custom && (
                              <button
                                onClick={() => void handleDelete(t)}
                                disabled={deletingId === t.id}
                                className="h-8 w-8 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 text-red-500 transition-all"
                                title="Delete template"
                              >
                                {deletingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
