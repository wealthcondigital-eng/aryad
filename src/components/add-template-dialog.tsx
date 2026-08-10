"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Upload, FileText } from "lucide-react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ReportTemplate } from "@/lib/report-templates"

/**
 * Adding a template without leaving the report.
 *
 * The Templates panel used to link to the Add Template page, which meant losing
 * the report being written to go and import a file — so the doctor either
 * finished the report first and forgot, or navigated away and lost the draft's
 * place. Same API and same duplicate-name handling as that page; it is only the
 * journey that changes.
 */

const NEW_CATEGORY = "__new__"

/** Word's filename minus extension, tidied into a template name. */
function nameFromFile(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim()
}

export function AddTemplateDialog({
  open,
  onClose,
  categories,
  defaultCategory,
  currentBodyHtml,
  currentHeading,
  onAdded,
}: {
  open: boolean
  onClose: () => void
  /** Category keys already in use, for the dropdown. */
  categories: string[]
  defaultCategory: string
  /** The report currently open, offered as the template's body. */
  currentBodyHtml: string
  currentHeading: string
  onAdded: (category: string, template: ReportTemplate) => void
}) {
  const [source, setSource] = useState<"file" | "current">("file")
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [nameEdited, setNameEdited] = useState(false)
  const [category, setCategory] = useState(defaultCategory)
  const [newCategory, setNewCategory] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [duplicate, setDuplicate] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setSource("file"); setFile(null); setName(""); setNameEdited(false)
    setCategory(defaultCategory); setNewCategory("")
    setError(""); setDuplicate(null); setSaving(false)
  }, [open, defaultCategory])

  const pickFile = (f: File | null) => {
    setFile(f)
    setDuplicate(null)
    // The name follows the file until the doctor types one of their own.
    if (f && !nameEdited) setName(nameFromFile(f.name))
  }

  // force=true is the "add anyway" the server asks for on a duplicate name.
  const submit = async (force = false) => {
    const cat = category === NEW_CATEGORY ? newCategory.trim() : category
    if (!cat) { setError("Enter a name for the new category."); return }
    if (source === "file" && !file) { setError("Choose a .doc or .docx file to import."); return }
    if (source === "current" && !currentBodyHtml.trim()) { setError("This report is empty — there is nothing to save."); return }
    if (source === "current" && !name.trim()) { setError("Give the template a name."); return }

    setSaving(true)
    setError("")
    try {
      let res: Response
      if (source === "file") {
        const form = new FormData()
        form.append("category", cat)
        form.append("name", name)
        form.append("file", file!)
        if (force) form.append("force", "1")
        res = await fetch("/api/templates", { method: "POST", body: form })
      } else {
        res = await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: cat,
            name: name.trim(),
            heading: currentHeading,
            body: currentBodyHtml,
            ...(force ? { force: true } : {}),
          }),
        })
      }
      const data = await res.json()
      if (res.status === 409 && data.duplicate) {
        setDuplicate(data.message || "A template with this name already exists.")
        return
      }
      if (!res.ok) { setError(data.error || "Failed to add template."); return }
      const t = data.template
      onAdded(t.category, { id: t._id, _id: t._id, name: t.name, heading: t.heading, preview: t.preview, body: t.body })
      onClose()
    } catch {
      setError("Failed to add template. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle className="text-base">Add template</DialogTitle>
          <DialogDescription className="text-sm text-gray-600">
            Import a Word file, or save the report you have open as a reusable template.
          </DialogDescription>
        </DialogHeader>

        {/* Where the body comes from */}
        <div className="grid grid-cols-2 gap-2">
          {([
            { id: "file", label: "Word file", icon: <Upload className="h-3.5 w-3.5" /> },
            { id: "current", label: "This report", icon: <FileText className="h-3.5 w-3.5" /> },
          ] as const).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => { setSource(o.id); setError(""); setDuplicate(null) }}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${source === o.id
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:border-blue-300"
                }`}
            >
              {o.icon}{o.label}
            </button>
          ))}
        </div>

        {source === "file" && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".doc,.docx"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-3 text-left text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600"
            >
              <Upload className="h-4 w-4 shrink-0" />
              <span className="truncate">{file ? file.name : "Choose a .doc or .docx file"}</span>
            </button>
          </div>
        )}

        <label className="block">
          <span className="text-[11px] font-medium text-gray-600">Template name</span>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setNameEdited(true); setDuplicate(null) }}
            placeholder={source === "current" ? "e.g. Anomaly scan — twin" : "Taken from the file name"}
            className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm focus:border-blue-400 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-medium text-gray-600">Category</span>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setError("") }}
            className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-2 text-sm focus:border-blue-400 focus:outline-none"
          >
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={NEW_CATEGORY}>+ Add new category…</option>
          </select>
        </label>

        {category === NEW_CATEGORY && (
          <input
            autoFocus
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name"
            className="h-9 w-full rounded-lg border border-gray-200 px-2.5 text-sm focus:border-blue-400 focus:outline-none"
          />
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
        {duplicate && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
            <p className="text-xs text-amber-800">{duplicate}</p>
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDuplicate(null)}>Change the name</Button>
              <Button size="sm" onClick={() => void submit(true)} disabled={saving}>Add anyway</Button>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={saving || !!duplicate}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {saving ? "Adding…" : "Add template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
