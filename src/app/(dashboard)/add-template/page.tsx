"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import {
  Search, LayoutTemplate, Info, Plus, Trash2, Loader2,
  AlertCircle, Eye, Upload, FileText, FolderPlus, Layers, FileStack,
  X, CheckCircle2, RotateCcw, Archive, FolderInput,
} from "lucide-react"
import { prettyCategory } from "@/components/template-card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { motion } from "motion/react"
import { REPORT_TEMPLATES, TemplateCategory } from "@/lib/report-templates"
import { useConfirm } from "@/components/confirm-dialog"

const BUILT_IN_CATS: TemplateCategory[] = ["usg", "doppler", "xray", "pathology", "obstetric"]
const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  usg: "USG / Sonography", doppler: "Doppler", xray: "X-Ray", pathology: "Pathology", obstetric: "Obstetric USG",
}
const CATEGORY_COLOR: Record<TemplateCategory, string> = {
  usg:       "bg-blue-100 text-blue-700",
  doppler:   "bg-violet-100 text-violet-700",
  xray:      "bg-amber-100 text-amber-700",
  pathology: "bg-emerald-100 text-emerald-700",
  obstetric: "bg-pink-100 text-pink-700",
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
  return isBuiltIn(cat) ? CATEGORY_LABEL[cat] : prettyCategory(cat)
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

function isWordFile(file: File) {
  // Word creates tiny `~$…` companion files while a document is open. They
  // only contain lock/owner metadata, never the document contents.
  return /\.docx?$/i.test(file.name) && !/^~\$/i.test(file.name)
}

interface TemplateRow {
  id: string
  category: string
  name: string
  heading: string
  preview: string
  body: string
  custom: boolean   // false = built-in bundled template, true = clinic-added
  removed?: boolean // built-in the clinic has removed (only listed when "show removed" is on)
  createdAt?: string
}

// One Word file queued in the import dialog. The whole batch shares a category;
// each file keeps its own name (editable) and its own outcome, so one bad file
// out of twenty doesn't sink the rest of the run.
type ImportStatus = "pending" | "uploading" | "done" | "duplicate" | "error"
interface ImportItem {
  key: string
  file: File
  name: string
  status: ImportStatus
  message?: string
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
  const { confirm } = useConfirm()
  const [customDocs, setCustomDocs] = useState<TemplateRow[]>([])
  const [hiddenIds,  setHiddenIds]  = useState<string[]>([])
  const [showRemoved, setShowRemoved] = useState(false)
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState("")
  const [catFilter,  setCatFilter]  = useState("All Categories")

  // Add-template dialog state
  const [addOpen,     setAddOpen]     = useState(false)
  const [addCatValue, setAddCatValue] = useState<string>("usg")
  const [newCatName,  setNewCatName]  = useState("")
  const [addError,    setAddError]    = useState("")
  const [queue,       setQueue]       = useState<ImportItem[]>([])
  const [importing,   setImporting]   = useState(false)
  const [dragOver,    setDragOver]    = useState(false)
  const [ranOnce,     setRanOnce]     = useState(false)   // an import batch has finished — show the summary
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // The import loop reads names from here rather than from the `queue` closure,
  // so a name typed while a batch is running still reaches the server.
  const queueRef = useRef<ImportItem[]>([])
  useEffect(() => { queueRef.current = queue }, [queue])

  // Preview + delete
  const [previewTpl,  setPreviewTpl]  = useState<TemplateRow | null>(null)
  const [busyId,      setBusyId]      = useState<string | null>(null)

  // Re-filing a template into another category (or into a brand new one)
  const [moveTpl,     setMoveTpl]     = useState<TemplateRow | null>(null)
  const [moveCat,     setMoveCat]     = useState("usg")
  const [moveNewCat,  setMoveNewCat]  = useState("")
  const [moveSaving,  setMoveSaving]  = useState(false)
  const [moveError,   setMoveError]   = useState("")

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
        setHiddenIds((d.hiddenBuiltIns ?? []).map((h: { id: string }) => h.id))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCustom() }, [])

  // Built-in bundled templates, normalised into the same row shape
  const allBuiltIn: TemplateRow[] = useMemo(() => (
    BUILT_IN_CATS.flatMap((cat) =>
      REPORT_TEMPLATES[cat].map((t) => ({
        id: t.id, category: cat, name: t.name, heading: t.heading,
        preview: t.preview, body: t.body, custom: false,
      }))
    )
  ), [])

  const hiddenSet   = useMemo(() => new Set(hiddenIds), [hiddenIds])
  const builtInDocs = useMemo(() => allBuiltIn.filter((t) => !hiddenSet.has(t.id)), [allBuiltIn, hiddenSet])
  const removedDocs = useMemo(
    () => allBuiltIn.filter((t) => hiddenSet.has(t.id)).map((t) => ({ ...t, removed: true })),
    [allBuiltIn, hiddenSet]
  )

  const allDocs = [...builtInDocs, ...customDocs, ...(showRemoved ? removedDocs : [])]
  const customCount  = customDocs.length

  // Every distinct category actually in use — the built-ins (always shown)
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

  // ── Add templates (Word import, one or many files at a time) ─────────────────
  const openAddDialog = () => {
    setAddCatValue("usg"); setNewCatName(""); setAddError("")
    setQueue([]); setRanOnce(false); setImporting(false)
    setAddOpen(true)
  }

  const addFiles = (files: File[]) => {
    const word = files.filter(isWordFile)
    const lockFiles = files.filter((file) => /^~\$/i.test(file.name))
    const unsupported = files.length - word.length - lockFiles.length
    if (lockFiles.length) {
      setAddError(`${lockFiles.length} temporary Word lock file${lockFiles.length === 1 ? " was" : "s were"} skipped. Close Word and select the matching file without “~$”.`)
    } else if (unsupported) {
      setAddError("Only .doc and .docx files can be imported — the rest were left out.")
    } else {
      setAddError("")
    }
    if (!word.length) return
    setQueue((prev) => {
      // The same file picked twice (easy to do across two trips to the picker)
      // would otherwise import as two identical templates.
      const seen = new Set(prev.map((i) => `${i.file.name}:${i.file.size}`))
      const fresh = word
        .filter((f) => !seen.has(`${f.name}:${f.size}`))
        .map((f, i) => ({
          key: `${f.name}:${f.size}:${prev.length + i}`,
          file: f,
          name: deriveNameFromFile(f.name),
          status: "pending" as ImportStatus,
        }))
      return [...prev, ...fresh]
    })
  }

  const updateItem = (key: string, patch: Partial<ImportItem>) =>
    setQueue((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const removeItem = (key: string) => setQueue((prev) => prev.filter((i) => i.key !== key))

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (importing) return
    addFiles(Array.from(e.dataTransfer.files ?? []))
  }

  // Uploads the given items one after another. Sequential on purpose: each file
  // goes through LibreOffice/mammoth conversion on the server, and firing twenty
  // of those at once is how the import starts timing out.
  // force=true re-sends files the server flagged as duplicate names.
  const runImport = async (items: ImportItem[], force = false) => {
    const category = addCatValue === NEW_CATEGORY_VALUE ? newCatName.trim() : addCatValue
    if (!category) { setAddError("Enter a name for the new category."); return }
    if (!items.length) { setAddError("Choose at least one .doc or .docx file to import."); return }

    setAddError("")
    setImporting(true)
    try {
      for (const item of items) {
        // Latest name, in case it was edited after the batch started.
        const current = queueRef.current.find((i) => i.key === item.key) ?? item
        updateItem(item.key, { status: "uploading", message: "" })
        try {
          const form = new FormData()
          form.append("category", category)
          form.append("name", current.name)
          form.append("file", current.file)
          if (force) form.append("force", "1")
          const res  = await fetch("/api/templates", { method: "POST", body: form })
          const data = await res.json()

          if (res.status === 409 && data.duplicate) {
            updateItem(item.key, { status: "duplicate", message: data.message || "A template with this name already exists." })
            continue
          }
          if (!res.ok) {
            updateItem(item.key, { status: "error", message: data.error || "Failed to import." })
            continue
          }
          const t = data.template
          const row: TemplateRow = {
            id: t._id, category: t.category, name: t.name, heading: t.heading,
            preview: t.preview, body: t.body, custom: true, createdAt: t.createdAt,
          }
          setCustomDocs((prev) => [row, ...prev])
          updateItem(item.key, { status: "done", message: "" })
        } catch {
          updateItem(item.key, { status: "error", message: "Upload failed — check the connection and try again." })
        }
      }
    } finally {
      setImporting(false)
      setRanOnce(true)
    }
  }

  const pending    = queue.filter((i) => i.status === "pending")
  const duplicates = queue.filter((i) => i.status === "duplicate")
  const failed     = queue.filter((i) => i.status === "error")
  const succeeded  = queue.filter((i) => i.status === "done")
  const uploadingIndex = queue.findIndex((i) => i.status === "uploading")

  // ── Delete / restore ────────────────────────────────────────────────────────
  const handleDelete = async (t: TemplateRow) => {
    if (!(await confirm({
      title: t.custom ? "Remove template?" : "Remove built-in template?",
      message: t.custom
        ? `"${t.name}" will be deleted. This can't be undone.`
        : `"${t.name}" will be hidden everywhere, including the report editor. You can put it back later from "Show removed".`,
      confirmLabel: "Remove",
      danger: true,
    }))) return
    setBusyId(t.id)
    try {
      const res = await fetch(`/api/templates/${t.id}`, { method: "DELETE" })
      if (!res.ok) return
      if (t.custom) setCustomDocs((prev) => prev.filter((c) => c.id !== t.id))
      else setHiddenIds((prev) => (prev.includes(t.id) ? prev : [...prev, t.id]))
    } finally {
      setBusyId(null)
    }
  }

  const openMove = (t: TemplateRow) => {
    setMoveTpl(t); setMoveCat(t.category); setMoveNewCat(""); setMoveError("")
  }

  const handleMove = async () => {
    if (!moveTpl) return
    const category = moveCat === NEW_CATEGORY_VALUE ? moveNewCat.trim() : moveCat
    if (!category) { setMoveError("Enter a name for the new category."); return }
    if (category === moveTpl.category) { setMoveTpl(null); return }
    setMoveSaving(true)
    setMoveError("")
    try {
      const res = await fetch(`/api/templates/${moveTpl.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      })
      const data = await res.json()
      if (!res.ok) { setMoveError(data.error || "Couldn't move this template."); return }
      setCustomDocs((prev) => prev.map((c) => (c.id === moveTpl.id ? { ...c, category } : c)))
      setMoveTpl(null)
    } catch {
      setMoveError("Couldn't move this template. Please try again.")
    } finally {
      setMoveSaving(false)
    }
  }

  const handleRestore = async (t: TemplateRow) => {
    setBusyId(t.id)
    try {
      const res = await fetch(`/api/templates/${t.id}`, { method: "POST" })
      if (res.ok) setHiddenIds((prev) => prev.filter((id) => id !== t.id))
    } finally {
      setBusyId(null)
    }
  }

  // No "Built-in" tile: nothing ships with the app any more, so it would read 0
  // forever. Every template here is one the clinic imported.
  const STATS = [
    { label: "Total Templates",   value: loading ? null : String(builtInDocs.length + customCount), icon: FileStack, color: "text-blue-500" },
    { label: "Categories",        value: String(allCategoryKeys.length),          icon: Layers,     color: "text-violet-500" },
    { label: "Imported (Custom)", value: loading ? null : String(customCount),    icon: Upload,     color: "text-emerald-500" },
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

      {/* ── Add Template dialog — imports one or many .doc/.docx files at once ── */}
      <Dialog open={addOpen} onOpenChange={(o) => { if (!o && !importing) setAddOpen(false) }}>
        {/* p-0 + per-section padding: the default grid gap-4 left the header,
            the two help lines and the footer rule floating at uneven distances. */}
        <DialogContent className="max-w-lg max-h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="space-y-1 px-5 pt-4 pb-3 border-b">
            <DialogTitle className="text-base flex items-center gap-2">
              <Upload className="h-4 w-4 text-blue-600" />Add Templates
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Import one Word file or a whole batch — each file becomes its own template.
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Category <span className="text-red-500">*</span></Label>
              <Select value={addCatValue} onValueChange={setAddCatValue} disabled={importing}>
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
                  disabled={importing}
                />
              )}
              <p className="text-[11px] leading-snug text-muted-foreground">Every file in this batch is added to this category.</p>
            </div>

            {/* Drop zone — click to open the file picker (multi-select) or drag
                a whole folder's worth of Word files straight in. */}
            <div className="space-y-1.5">
              <Label>Word Files (.doc or .docx) <span className="text-red-500">*</span></Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".doc,.docx"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []))
                  // Reset so re-picking the same file still fires onChange.
                  e.target.value = ""
                }}
              />
              <button
                type="button"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`flex w-full flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors disabled:opacity-60 ${
                  dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 hover:bg-blue-50/40"
                }`}
              >
                <Upload className="mb-1 h-5 w-5 text-blue-600" />
                <span className="text-sm font-medium text-gray-700">Click to choose files, or drop them here</span>
                <span className="text-[11px] text-muted-foreground">
                  Hold Ctrl or Shift in the picker to select several at once
                </span>
              </button>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Old .doc and modern .docx are both supported. The patient-info header in each file is
                detected and left out automatically.
              </p>
            </div>

            {/* The batch: one row per file, name editable, outcome per file */}
            {queue.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>{queue.length} file{queue.length !== 1 ? "s" : ""} selected</Label>
                  {!importing && (
                    <button
                      onClick={() => { setQueue([]); setRanOnce(false) }}
                      className="text-[11px] text-muted-foreground hover:text-red-600"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border divide-y">
                  {queue.map((item) => (
                    <div key={item.key} className="flex items-center gap-2 px-2.5 py-2">
                      <FileText className="h-4 w-4 shrink-0 text-blue-500" />
                      <div className="flex-1 min-w-0">
                        <input
                          value={item.name}
                          disabled={importing || item.status === "done"}
                          onChange={(e) => updateItem(item.key, {
                            name: e.target.value,
                            // Renaming is the fix for a duplicate, so clear that state as they type.
                            ...(item.status === "duplicate" ? { status: "pending" as ImportStatus, message: "" } : {}),
                          })}
                          className="h-7 w-full rounded border border-transparent bg-transparent px-1 text-sm font-medium hover:border-input focus:border-blue-400 focus:outline-none disabled:opacity-70"
                        />
                        <p className="px-1 text-[10px] text-muted-foreground truncate">
                          {item.message || item.file.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                        {item.status === "done"      && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                        {item.status === "duplicate" && (
                          <>
                            <span className="text-[10px] font-semibold text-amber-600">Duplicate</span>
                            <button
                              onClick={() => void runImport([item], true)}
                              disabled={importing}
                              className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200"
                            >
                              Add anyway
                            </button>
                          </>
                        )}
                        {item.status === "error" && <AlertCircle className="h-4 w-4 text-red-500" />}
                        {!importing && item.status !== "done" && (
                          <button
                            onClick={() => removeItem(item.key)}
                            className="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500"
                            title="Remove from list"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {addError && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600">{addError}</p>
              </div>
            )}

            {/* Batch summary once a run has finished */}
            {ranOnce && !importing && (
              <div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs text-gray-700 space-y-1">
                <p>
                  <span className="font-semibold text-emerald-700">{succeeded.length} added</span>
                  {duplicates.length > 0 && <> · <span className="font-semibold text-amber-700">{duplicates.length} already exist</span></>}
                  {failed.length > 0 && <> · <span className="font-semibold text-red-600">{failed.length} failed</span></>}
                  {pending.length > 0 && <> · {pending.length} still waiting</>}
                </p>
                {duplicates.length > 1 && (
                  <button
                    onClick={() => void runImport(duplicates, true)}
                    className="text-[11px] font-semibold text-amber-700 hover:underline"
                  >
                    Add all {duplicates.length} duplicates anyway
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t bg-slate-50 px-5 py-3">
            <p className="text-[11px] text-muted-foreground">
              {importing && uploadingIndex >= 0
                ? `Importing ${uploadingIndex + 1} of ${queue.length}…`
                : queue.length > 0 ? `${pending.length} ready to import` : ""}
            </p>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => setAddOpen(false)} disabled={importing}>
                {ranOnce && !pending.length ? "Done" : "Cancel"}
              </Button>
              <Button
                size="sm"
                disabled={!pending.length || importing}
                onClick={() => void runImport(pending)}
                className="bg-blue-600 hover:bg-blue-700 gap-1.5"
              >
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                {importing
                  ? "Importing…"
                  : `Import ${pending.length || ""} ${pending.length === 1 ? "template" : "templates"}`.replace(/\s+/g, " ")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Move dialog — re-files one template, creating the category if new ── */}
      <Dialog open={!!moveTpl} onOpenChange={(o) => { if (!o && !moveSaving) setMoveTpl(null) }}>
        <DialogContent className="max-w-sm gap-0 p-0 overflow-hidden">
          <DialogHeader className="space-y-1 px-5 pt-4 pb-3 border-b">
            <DialogTitle className="text-base flex items-center gap-2">
              <FolderInput className="h-4 w-4 text-blue-600" />Move template
            </DialogTitle>
            <p className="text-xs text-muted-foreground truncate">{moveTpl?.name}</p>
          </DialogHeader>
          <div className="px-5 py-4 space-y-1.5">
            <Label>Category</Label>
            <Select value={moveCat} onValueChange={(v) => { setMoveCat(v); setMoveError("") }} disabled={moveSaving}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUILT_IN_CATS.map((c) => <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>)}
                {customCategories.length > 0 && <SelectSeparator />}
                {customCategories.map((c) => <SelectItem key={c} value={c}>{prettyCategory(c)}</SelectItem>)}
                <SelectSeparator />
                <SelectItem value={NEW_CATEGORY_VALUE} className="text-blue-600 font-medium">
                  + Add new category…
                </SelectItem>
              </SelectContent>
            </Select>
            {moveCat === NEW_CATEGORY_VALUE && (
              <Input
                autoFocus
                value={moveNewCat}
                onChange={(e) => { setMoveNewCat(e.target.value); setMoveError("") }}
                placeholder="e.g. MRI, CT Scan"
                className="mt-1.5"
                disabled={moveSaving}
              />
            )}
            {moveError && <p className="text-xs text-red-600 pt-1">{moveError}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">
            <Button variant="outline" size="sm" onClick={() => setMoveTpl(null)} disabled={moveSaving}>Cancel</Button>
            <Button size="sm" onClick={() => void handleMove()} disabled={moveSaving} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
              {moveSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderInput className="h-3.5 w-3.5" />}
              {moveSaving ? "Moving…" : "Move"}
            </Button>
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
              <div className="report-paper bg-white rounded-lg shadow-sm border border-gray-200 p-8 max-w-xl mx-auto">
                <div className="text-center font-bold text-sm underline underline-offset-4 mb-5">
                  {previewTpl.heading}
                </div>
                <div
                  className="doc-field text-sm leading-relaxed text-gray-900"
                  dangerouslySetInnerHTML={{ __html: previewTpl.body }}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
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
          Any template can be removed — imported ones are deleted for good, built-in ones are hidden
          everywhere and can be put back from <strong>Show removed</strong>.
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
              {removedDocs.length > 0 && (
                <Button
                  variant={showRemoved ? "secondary" : "outline"}
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={() => setShowRemoved((v) => !v)}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {showRemoved ? "Hide removed" : `Show removed (${removedDocs.length})`}
                </Button>
              )}
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
                  {allDocs.length === 0
                    ? "No templates yet — import a Word format to get started."
                    : "No templates match your search."}
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
                        <div key={t.id} className={`group flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors ${t.removed ? "opacity-60" : ""}`}>
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${color} bg-opacity-20`}>
                            <LayoutTemplate className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className={`font-medium text-sm ${t.removed ? "line-through" : ""}`}>{t.name}</p>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                t.custom ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                              }`}>
                                {t.custom ? "Custom" : "Built-in"}
                              </span>
                              {t.removed && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                                  Removed
                                </span>
                              )}
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
                            {t.custom && !t.removed && (
                              <button
                                onClick={() => openMove(t)}
                                className="h-8 w-8 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-violet-100 text-violet-500 transition-all"
                                title="Move to another category"
                              >
                                <FolderInput className="h-4 w-4" />
                              </button>
                            )}
                            {t.removed ? (
                              <button
                                onClick={() => void handleRestore(t)}
                                disabled={busyId === t.id}
                                className="h-8 w-8 flex items-center justify-center rounded hover:bg-emerald-100 text-emerald-600 transition-all"
                                title="Restore this built-in template"
                              >
                                {busyId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                              </button>
                            ) : (
                              <button
                                onClick={() => void handleDelete(t)}
                                disabled={busyId === t.id}
                                className="h-8 w-8 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-100 text-red-500 transition-all"
                                title={t.custom ? "Delete template" : "Remove built-in template"}
                              >
                                {busyId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
