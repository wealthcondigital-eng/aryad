"use client"

import type { Signatory, SignatureLayout } from "@/lib/report-signatures"

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
  signatories, layouts, editable,
}: {
  signatories: Signatory[]
  layouts?: (SignatureLayout | null | undefined)[]
  editable?: boolean
}) {
  const s0 = signatories[0]
  const s1 = signatories[1]
  const l0 = layouts?.[0]
  const l1 = layouts?.[1]

  const renderImg = (index: 0 | 1, s?: Signatory, layout?: SignatureLayout | null) => {
    if (!s) return <div />
    const isHidden = layout?.hidden
    // The signatory's master image (from the Signatures admin page) is never
    // shown automatically — only a per-report overrideImage renders here, and
    // only once one actually exists. There's deliberately no "+ Add
    // Signature" placeholder reserving space above the name when one doesn't:
    // a signature stamp is placed via the freeform in-body tool instead (see
    // insertSignature/SignatureExtension), positioned and sized by hand
    // wherever the doctor wants it — this row only ever shows a signature
    // that's already been placed that way.
    const displayImg = isHidden ? undefined : layout?.overrideImage
    // An empty placeholder, not `null`: this is a two-column grid, and a missing
    // child doesn't leave a hole — it shifts the remaining one into column 1. So
    // returning null when only the RIGHT doctor had a signature drew that
    // signature above the LEFT doctor's name. (The print/PDF twin in
    // signatureColumnsHtml keeps the same empty column for the same reason.)
    if (!displayImg) return <div />


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
    if (!s || layout?.hiddenSignatory) return <div />
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

  const hasAnyImg = (s0 && !l0?.hidden && !l0?.hiddenSignatory && l0?.overrideImage) || (s1 && !l1?.hidden && !l1?.hiddenSignatory && l1?.overrideImage)

  // Keep the two signatories locked to equal-width columns with inline layout
  // geometry. This block is rendered while async report/signatory data is
  // hydrating, and relying only on generated utility CSS allowed a refreshed
  // editor to briefly (and sometimes permanently) resolve the grid tracks as
  // max-content, placing both doctors immediately beside one another.
  const columnsStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    columnGap: "32px",
    width: "100%",
  }

  return (
    <div className="flex flex-col w-full" style={{ width: "100%" }}>
      {/* Signature Images Row — only renders if an image actually exists */}
      {hasAnyImg && (
        <div className="grid grid-cols-2 gap-8 items-end mb-1" style={columnsStyle}>
          {renderImg(0, s0, l0)}
          {renderImg(1, s1, l1)}
        </div>
      )}
      {/* Doctor Names/Credentials Row */}
      <div className="grid grid-cols-2 gap-8" style={columnsStyle}>
        {renderText(0, s0, l0)}
        {renderText(1, s1, l1)}
      </div>
    </div>
  )
}
