"use client"

import { useState } from "react"
import type { Signatory, SignatureLayout } from "@/lib/report-signatures"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SignaturePadDialog } from "@/components/signature-pad-dialog"

// Applies a saved drag/resize override exactly once per DOM node (idempotent,
// tracked via a data attribute) so it survives unrelated re-renders of the
// editor without a reactive `style` prop snapping the image back afterward —
// once the user drags/resizes it, imperative DOM mutation owns the position.
function applyInitialLayout(el: HTMLImageElement | null, layout?: SignatureLayout | null, signatureImage?: string) {
  if (!el) return
  const displayImg = layout?.overrideImage || signatureImage || ""
  const key = `${displayImg}-${layout?.left ?? ""}-${layout?.top ?? ""}-${layout?.width ?? ""}-${layout?.height ?? ""}`
  if (el.dataset.sigLayoutInit === key) return
  el.dataset.sigLayoutInit = key
  el.style.position = "relative"
  el.style.left   = layout?.left ? `${layout.left}px` : ""
  el.style.top    = layout?.top ? `${Math.min(0, layout.top)}px` : ""
  el.style.width  = layout?.width ? `${layout.width}px` : ""
  el.style.height = layout?.height ? `${layout.height}px` : ""
}

export function SignatureColumns({
  signatories, layouts, editable, onLayoutChange,
}: {
  signatories: Signatory[]
  layouts?: (SignatureLayout | null | undefined)[]
  editable?: boolean
  onLayoutChange?: (idx: number, layout: SignatureLayout | null) => void
}) {
  const s0 = signatories[0]
  const s1 = signatories[1]
  const l0 = layouts?.[0]
  const l1 = layouts?.[1]

  const [showPadIndex, setShowPadIndex] = useState<0 | 1 | null>(null)

  const renderImg = (index: 0 | 1, s?: Signatory, layout?: SignatureLayout | null) => {
    if (!s) return <div />
    const isHidden = layout?.hidden
    // The signatory's master image (from the Signatures admin page) is never
    // shown automatically — only an explicit per-report overrideImage (set by
    // clicking "+ Add Signature" for this report) renders here.
    const displayImg = isHidden ? undefined : layout?.overrideImage

    if (editable && !displayImg) {
      return (
        <div className="w-full h-12">
          <button
            type="button"
            onClick={() => setShowPadIndex(index)}
            className="w-full h-12 rounded border-2 border-dashed border-gray-300 hover:border-blue-400 bg-gray-50/50 hover:bg-blue-50/30 flex items-center justify-center text-gray-400 hover:text-blue-500 transition-all cursor-pointer pointer-events-auto"
          >
            <span className="text-[10px] font-bold tracking-wide uppercase">+ Add Signature</span>
          </button>
        </div>
      )
    }

    const inlineStyle: React.CSSProperties = {
      height: layout?.height ? `${layout.height}px` : "48px",
      objectFit: "contain",
      ...(layout?.width ? { width: `${layout.width}px` } : {}),
      ...(!editable && layout
        ? {
            position: "relative",
            ...(layout.left ? { left: `${layout.left}px` } : {}),
            ...(layout.top ? { top: `${Math.min(0, layout.top)}px` } : {}),
          }
        : editable
        ? { cursor: "move", userSelect: "none", maxWidth: "260px" }
        : {}),
    }

    return (
      <div className={`relative flex flex-col justify-end min-h-[48px] ${isHidden ? "pointer-events-none" : ""}`}>
        {displayImg ? (
          <img
            ref={editable ? (el) => {
              applyInitialLayout(el, layout, displayImg)
              if (el) {
                if (isHidden) {
                  el.style.display = "none"
                  el.setAttribute("data-sig-hidden", "true")
                } else {
                  el.style.display = ""
                  el.removeAttribute("data-sig-hidden")
                }
              }
            } : undefined}
            src={displayImg}
            alt={s.name}
            draggable={false}
            data-sig-stamp={editable ? "1" : undefined}
            data-sig-kind={editable ? "doctor" : undefined}
            data-sig-idx={editable ? index : undefined}
            className={editable || layout?.width ? "" : "max-w-[160px]"}
            style={inlineStyle}
          />
        ) : (
          <div className="h-12" />
        )}
      </div>
    )
  }

  const renderText = (index: 0 | 1, s?: Signatory, layout?: SignatureLayout | null) => {
    if (!s) return <div />
    return (
      <div>
        <p className="font-bold text-[13px] uppercase flex items-center gap-1.5">
          {s.name}
        </p>
        {s.credentials.map((c, i) => (
          <p key={i} className={`text-[10px] uppercase text-gray-600 ${i === 0 ? "mt-0.5" : ""}`}>{c}</p>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      {/* Signature Images Row (Aligned horizontally at the bottom of the row) */}
      <div className="grid grid-cols-2 gap-8 items-end">
        {renderImg(0, s0, l0)}
        {renderImg(1, s1, l1)}
      </div>
      {/* Doctor Names/Credentials Row (Always parallel) */}
      <div className="grid grid-cols-2 gap-8 mt-1">
        {renderText(0, s0, l0)}
        {renderText(1, s1, l1)}
      </div>


      {/* Signature Pad Dialog for Custom Signature */}
      {showPadIndex !== null && (
        <SignaturePadDialog
          open={showPadIndex !== null}
          onClose={() => setShowPadIndex(null)}
          savedImage={(showPadIndex === 0 ? s0 : s1)?.signatureImage || undefined}
          savedLabel={(showPadIndex === 0 ? s0 : s1)?.name}
          onInsert={(res) => {
            const idx = showPadIndex!
            const layout = layouts?.[idx]
            if (onLayoutChange) {
              onLayoutChange(idx, {
                ...(layout || {}),
                hidden: false,
                overrideImage: res.dataUrl,
                width: res.width,
                height: res.height,
              })
            }
            setShowPadIndex(null)
          }}
        />
      )}
    </div>
  )
}
