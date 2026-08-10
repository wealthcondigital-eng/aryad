"use client"

import { useState, useEffect, useRef } from "react"
import { PenTool, Info, Upload, Trash2, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Signatory } from "@/lib/report-signatures"
import { useConfirm } from "@/components/confirm-dialog"
import { cutOutSignature } from "@/lib/signature-cutout"

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function SignatoryCard({ s, onSaved }: { s: Signatory; onSaved: (s: Signatory) => void }) {
  const { confirm } = useConfirm()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // The lines printed under the name in every report — one per line, so a
  // clinic can put its registration number, degrees or a second specialty
  // there without anyone touching the code.
  const [editingLines, setEditingLines] = useState<string | null>(null)
  const [savingLines, setSavingLines] = useState(false)

  const saveCredentials = async () => {
    if (editingLines === null) return
    setSavingLines(true)
    setError("")
    try {
      const res = await fetch(`/api/signatories/${s._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: editingLines.split("\n") }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Could not save."); return }
      onSaved(data.signatory)
      setEditingLines(null)
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1600)
    } catch {
      setError("Could not save. Please try again.")
    } finally {
      setSavingLines(false)
    }
  }

  const handleFile = async (file: File | null) => {
    if (!file) return
    const supportedType = /^image\/(png|jpe?g)$/i.test(file.type)
    const supportedName = /\.(png|jpe?g)$/i.test(file.name)
    if (!supportedType && !(file.type === "" && supportedName)) {
      setError("Please choose a PNG, JPG, or JPEG image.")
      return
    }
    setSaving(true)
    setError("")
    try {
      // A signature is signed on paper and photographed, so the upload arrives
      // as ink on a white-ish rectangle. Reports put it over the letterhead,
      // where that rectangle would be visible — the paper comes off here,
      // before it is stored, so every report that uses it is already clean.
      const dataUrl = await cutOutSignature(await fileToDataUrl(file))
      const res = await fetch(`/api/signatories/${s._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureImage: dataUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to save signature")
      onSaved(data.signatory)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signature")
    } finally {
      setSaving(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const handleRemove = async () => {
    if (!(await confirm({
      title: "Remove signature image?",
      message: `Reports will fall back to a blank pen-signature space for ${s.name}.`,
      confirmLabel: "Remove",
      danger: true,
    }))) return
    setSaving(true)
    try {
      const res = await fetch(`/api/signatories/${s._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureImage: "" }),
      })
      const data = await res.json()
      if (res.ok) onSaved(data.signatory)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <p className="font-semibold text-sm uppercase">{s.name}</p>
          {editingLines === null ? (
            <div className="mt-0.5 flex items-start justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {s.credentials.length ? s.credentials.join(" · ") : "No lines under the name yet"}
              </p>
              <button
                type="button"
                onClick={() => setEditingLines(s.credentials.join("\n"))}
                className="shrink-0 text-[11px] font-medium text-blue-600 hover:underline"
              >
                Edit lines
              </button>
            </div>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              <textarea
                autoFocus
                rows={4}
                value={editingLines}
                onChange={(e) => setEditingLines(e.target.value)}
                placeholder={"Consultant Radiologist\nRegistration No. 2007/10/3706"}
                className="w-full rounded-lg border border-gray-200 p-2 text-xs focus:border-blue-400 focus:outline-none"
              />
              <p className="text-[10px] text-muted-foreground">
                One line per row — printed under the name on every report, in the editor, print, PDF and Word.
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditingLines(null)} disabled={savingLines}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => void saveCredentials()} disabled={savingLines}>
                  {savingLines && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Save
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Checkerboard, so what shows here is exactly what the report gets:
        any paper left behind reads as a solid block against the squares. */}
        <div
          className="h-24 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center overflow-hidden"
          style={{
            backgroundColor: "#fff",
            backgroundImage: "linear-gradient(45deg,#eef1f4 25%,transparent 25%,transparent 75%,#eef1f4 75%),linear-gradient(45deg,#eef1f4 25%,transparent 25%,transparent 75%,#eef1f4 75%)",
            backgroundSize: "14px 14px",
            backgroundPosition: "0 0, 7px 7px",
          }}
        >
          {s.signatureImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.signatureImage} alt={`${s.name} signature`} className="max-h-20 max-w-[85%] object-contain" />
          ) : (
            <p className="text-xs text-gray-400">No signature uploaded yet</p>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground -mt-2">
          PNG or JPG. The paper background is removed automatically and the image is cropped to the signature.
        </p>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          <Button
            size="sm" variant="outline" disabled={saving}
            onClick={() => inputRef.current?.click()}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {s.signatureImage ? "Replace" : "Upload"} Signature
          </Button>
          {s.signatureImage && (
            <Button size="sm" variant="ghost" disabled={saving} onClick={handleRemove} className="gap-1.5 text-red-600 hover:text-red-700">
              <Trash2 className="h-3.5 w-3.5" />Remove
            </Button>
          )}
          {savedFlash && (
            <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />Saved</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default function SignaturesPage() {
  const [signatories, setSignatories] = useState<Signatory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/signatories")
      .then((r) => r.json())
      .then((d) => setSignatories(d.signatories ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSaved = (updated: Signatory) => {
    setSignatories((prev) => prev.map((s) => (s._id === updated._id ? updated : s)))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Report Signatures</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Upload each consultant radiologist&apos;s signature image once — it&apos;s stamped
          automatically on every report, print, and downloaded Word/PDF file from then on.
        </p>
      </div>

      <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <span>
          PNG, JPG, and JPEG uploads are converted to transparent, cropped PNG signatures before
          they are saved. If no image is uploaded, reports keep the same blank pen-signature space.
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {loading ? (
          [0, 1].map((i) => (
            <Card key={i}><CardContent className="p-5 space-y-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-8 w-32" />
            </CardContent></Card>
          ))
        ) : signatories.length === 0 ? (
          <p className="text-sm text-muted-foreground col-span-2 text-center py-10">
            <PenTool className="h-8 w-8 mx-auto mb-2 opacity-30" />
            No signatories found.
          </p>
        ) : (
          signatories.map((s) => <SignatoryCard key={s._id} s={s} onSaved={handleSaved} />)
        )}
      </div>
    </div>
  )
}
