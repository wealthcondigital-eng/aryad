"use client"

import { useEffect, useRef, useState } from "react"
import { PenTool, Type, Upload, Eraser, CheckCircle2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cutOutSignature } from "@/lib/signature-cutout"

const SCRIPT_FONTS = [
  "'Segoe Script', 'Brush Script MT', cursive",
  "'Lucida Handwriting', 'Segoe Script', cursive",
]

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Freehand canvas — mouse or touch, matches how Word's own "Draw" signature
// tab works. Renders on a device-pixel-ratio-scaled canvas so the stroke
// stays crisp, but reports back its CSS (unscaled) size.
function DrawPad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const emptyRef = useRef(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.2
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#111"
  }, [])

  const posFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const commit = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(emptyRef.current ? null : canvas.toDataURL("image/png"))
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    drawingRef.current = true
    const { x, y } = posFromEvent(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext("2d")
    if (!ctx) return
    const { x, y } = posFromEvent(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    emptyRef.current = false
  }

  const handlePointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    commit()
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    emptyRef.current = true
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="w-full h-40 rounded-lg border-2 border-dashed border-gray-300 bg-white touch-none cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <Button type="button" size="sm" variant="ghost" onClick={clear} className="gap-1.5 text-xs text-gray-500">
        <Eraser className="h-3.5 w-3.5" />Clear
      </Button>
    </div>
  )
}

// Typed name rendered in a cursive/script font — the "type it instead of
// drawing it" option Word and every e-signature tool also offers.
function TypePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const [text, setText] = useState("")
  const [fontIdx, setFontIdx] = useState(0)

  useEffect(() => {
    if (!text.trim()) { onChange(null); return }
    const canvas = document.createElement("canvas")
    canvas.width = 600
    canvas.height = 180
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = "#111"
    ctx.font = `64px ${SCRIPT_FONTS[fontIdx]}`
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    ctx.fillText(text.trim(), canvas.width / 2, canvas.height / 2)
    onChange(canvas.toDataURL("image/png"))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fontIdx])

  return (
    <div className="space-y-3">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your name"
        className="text-sm"
      />
      <div
        className="w-full h-32 rounded-lg border-2 border-dashed border-gray-300 bg-white flex items-center justify-center overflow-hidden"
        style={{ fontFamily: SCRIPT_FONTS[fontIdx], fontSize: 34, color: "#111" }}
      >
        {text.trim() || <span className="text-gray-300 text-sm" style={{ fontFamily: "inherit" }}>Preview</span>}
      </div>
      <div className="flex gap-2">
        {SCRIPT_FONTS.map((f, i) => (
          <button
            key={i} type="button" onClick={() => setFontIdx(i)}
            className={`flex-1 h-9 rounded-md border text-sm ${fontIdx === i ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}
            style={{ fontFamily: f }}
          >
            Style {i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}

// A phone photo of a pen signature can be several MB straight off the camera —
// far bigger than a signature ever needs to render at. cutOutSignature caps the
// resolution as it works and crops to the ink, which keeps the report save
// payload small; skipping that is what let a large upload blow past the
// server's request-size limit and fail the save silently.
const MAX_UPLOAD_DIM = 900

export interface SavedSignature {
  name: string
  image: string
}

/**
 * The signatures already uploaded on the Add Signature page, offered as
 * one-click options.
 *
 * Filling in a report shouldn't mean redrawing or re-uploading the same
 * signature every time — and when the clinic has more than one signing
 * radiologist, the doctor writing the report has to be able to say WHICH one
 * goes on this report. So every saved signature is listed and one is picked,
 * rather than a single image being assumed.
 *
 * Radix only mounts the active tab's content, so this only touches `pending`
 * while the "Saved" tab is actually selected.
 */
function SavedPad({ saved, onChange }: { saved: SavedSignature[]; onChange: (dataUrl: string | null) => void }) {
  const [selected, setSelected] = useState(0)
  const current = saved[selected] ?? saved[0]

  useEffect(() => { onChange(current?.image ?? null) }, [current, onChange])

  return (
    <div className="space-y-2">
      <div className="w-full h-40 rounded-lg border-2 border-dashed border-gray-300 bg-white flex items-center justify-center overflow-hidden">
        {current && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.image} alt={`${current.name} signature`} className="max-h-36 max-w-full object-contain" />
        )}
      </div>

      {saved.length > 1 ? (
        <div className="grid grid-cols-2 gap-2">
          {saved.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              onClick={() => setSelected(i)}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                i === selected ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image} alt="" className="h-7 w-14 shrink-0 object-contain" />
              <span className="truncate text-[11px] font-medium text-gray-700">{s.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      <p className="text-xs text-gray-500 text-center">
        {saved.length > 1
          ? "Pick whose signature to place, then click Insert"
          : `${current?.name ?? "Saved"} — click Insert to use it as-is`}
        , or switch tabs to draw, type or upload a different one.
      </p>
    </div>
  )
}

// Any image file from desktop — logo, scanned signature, photo of a pen
// signature, whatever the user has.
function UploadPad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File | null) => {
    if (!file) return
    // Some browsers/desktop file pickers leave File.type blank, so keep the
    // extension check as a fallback while still limiting this flow to the
    // three signature formats supported by the Signatures page.
    const supportedType = /^image\/(png|jpe?g)$/i.test(file.type)
    const supportedName = /\.(png|jpe?g)$/i.test(file.name)
    if (!supportedType && !(file.type === "" && supportedName)) {
      setError("Please choose a PNG, JPG, or JPEG image.")
      return
    }
    setError("")
    setWorking(true)
    const reader = new FileReader()
    reader.onload = async () => {
      // The cutout also does the downscaling. It has to: re-encoding as JPEG
      // first (what this used to do) drops the alpha channel, so a signature
      // could only ever land on the report as an opaque white box.
      const dataUrl = await cutOutSignature(reader.result as string, MAX_UPLOAD_DIM)
      setPreview(dataUrl)
      onChange(dataUrl)
      setWorking(false)
    }
    reader.onerror = () => { setError("Could not read that file."); setWorking(false) }
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-2">
      <div
        className="w-full h-40 rounded-lg border-2 border-dashed border-gray-300 bg-white flex items-center justify-center overflow-hidden cursor-pointer"
        onClick={() => inputRef.current?.click()}
      >
        {working ? (
          <p className="text-xs text-gray-400">Removing the background…</p>
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Signature" className="max-h-36 max-w-full object-contain" />
        ) : (
          <p className="text-xs text-gray-400 flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" />Click to choose an image</p>
        )}
      </div>
      <p className="text-[11px] text-gray-500 text-center">
        The paper behind the signature is removed automatically, so it sits on the report without a white box.
      </p>
      <input
        ref={inputRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

export interface SignatureInsertResult {
  dataUrl: string
  width: number
  height: number
}

export function SignaturePadDialog({
  open, onClose, onInsert, saved = [],
}: {
  open: boolean
  onClose: () => void
  onInsert: (result: SignatureInsertResult) => void
  // Signatures already uploaded on the Add Signature page. When there are any,
  // they open as the default tab: re-drawing a signature the clinic has
  // already stored is work nobody should have to repeat per report.
  saved?: SavedSignature[]
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [inserting, setInserting] = useState(false)

  const handleInsert = async () => {
    if (!pending) return
    setInserting(true)
    try {
      const img = await loadImage(pending)
      // Cap the initial insert size — the report editor's native contentEditable
      // resize handles let the user scale it up or down after it's placed.
      const maxW = 220
      const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1
      onInsert({ dataUrl: pending, width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) })
    } finally {
      setInserting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PenTool className="h-4 w-4" />Insert Signature
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue={saved.length ? "saved" : "draw"}>
          <TabsList className={saved.length ? "grid w-full grid-cols-4" : "grid w-full grid-cols-3"}>
            {saved.length > 0 && (
              <TabsTrigger value="saved" className="gap-1.5 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" />Saved
              </TabsTrigger>
            )}
            <TabsTrigger value="draw" className="gap-1.5 text-xs"><PenTool className="h-3.5 w-3.5" />Draw</TabsTrigger>
            <TabsTrigger value="type" className="gap-1.5 text-xs"><Type className="h-3.5 w-3.5" />Type</TabsTrigger>
            <TabsTrigger value="upload" className="gap-1.5 text-xs"><Upload className="h-3.5 w-3.5" />Upload</TabsTrigger>
          </TabsList>
          {saved.length > 0 && (
            <TabsContent value="saved"><SavedPad saved={saved} onChange={setPending} /></TabsContent>
          )}
          <TabsContent value="draw"><DrawPad onChange={setPending} /></TabsContent>
          <TabsContent value="type"><TypePad onChange={setPending} /></TabsContent>
          <TabsContent value="upload"><UploadPad onChange={setPending} /></TabsContent>
        </Tabs>

        <p className="text-[11px] text-gray-400 -mt-1">
          After inserting, click the signature in the report to drag it into place or drag its corner to resize — just like inserting a picture in Word.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="button" size="sm" disabled={!pending || inserting} onClick={handleInsert}>
            {inserting ? "Inserting…" : "Insert"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
