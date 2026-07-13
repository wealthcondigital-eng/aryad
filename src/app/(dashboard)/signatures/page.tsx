"use client"

import { useState, useEffect, useRef } from "react"
import { PenTool, Info, Upload, Trash2, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Signatory } from "@/lib/report-signatures"

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function SignatoryCard({ s, onSaved }: { s: Signatory; onSaved: (s: Signatory) => void }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | null) => {
    if (!file) return
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      setError("Please choose a PNG or JPG image.")
      return
    }
    setSaving(true)
    setError("")
    try {
      const dataUrl = await fileToDataUrl(file)
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
    if (!confirm(`Remove ${s.name}'s signature image? Reports will fall back to a blank pen-signature space.`)) return
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
          <p className="text-xs text-muted-foreground mt-0.5">{s.credentials.join(" · ")}</p>
        </div>

        <div className="h-24 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
          {s.signatureImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.signatureImage} alt={`${s.name} signature`} className="max-h-20 max-w-[85%] object-contain" />
          ) : (
            <p className="text-xs text-gray-400">No signature uploaded yet</p>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
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
          A PNG with a transparent background looks best. If no image is uploaded, reports keep
          showing the same blank space for a pen signature as before.
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
