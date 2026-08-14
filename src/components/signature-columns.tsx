"use client"

import type { Signatory, SignatureLayout } from "@/lib/report-signatures"
import { sanitizeSignatureHtml, escapeSignatureText } from "@/lib/report-signatures"

// Writes the starting HTML into a contentEditable exactly once per distinct
// value, tracked on the node itself. Without the guard every parent re-render
// (pagination, autosave ticks, a signatory refetch) would reset innerHTML and
// drop the caret mid-word; with a plain `dangerouslySetInnerHTML` React would
// do the same on its own schedule. After the seed the DOM owns the content and
// readSignatureLayout() in the editor reads it back at save time.
function seedEditable(el: HTMLElement | null, html: string) {
  if (!el) return
  if (el.dataset.sigSeedKey === html) return
  el.dataset.sigSeedKey = html
  el.innerHTML = sanitizeSignatureHtml(html)
  // What the browser actually parsed, not what we handed it — the editor
  // compares against this to tell "the doctor typed here" from "untouched",
  // and innerHTML round-trips (quoting, attribute order, implied tags) would
  // otherwise read as an edit the moment the report loads.
  el.dataset.sigSeedHtml = el.innerHTML
}

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

    // Read-only (view modal, print preview): render the saved rich text if this
    // report has any, else the plain signatory record — the same choice
    // signatureColumnsHtml makes, so screen and paper agree.
    if (!editable) {
      return (
        <div>
          {layout?.nameHtml ? (
            <p
              className="font-bold text-[13px] uppercase"
              dangerouslySetInnerHTML={{ __html: sanitizeSignatureHtml(layout.nameHtml) }}
            />
          ) : (
            <p className="font-bold text-[13px] uppercase flex items-center gap-1.5">{s.name}</p>
          )}
          {layout?.credentialsHtml !== undefined ? (
            <div
              className="text-[10px] uppercase text-gray-600 mt-0.5"
              dangerouslySetInnerHTML={{ __html: sanitizeSignatureHtml(layout.credentialsHtml) }}
            />
          ) : (
            s.credentials.map((c, i) => (
              <p key={i} className={`text-[10px] uppercase text-gray-600 ${i === 0 ? "mt-0.5" : ""}`}>{c}</p>
            ))
          )}
        </div>
      )
    }

    // Editable: the name and the credential block are contentEditable so the
    // doctor can select the text and hit Bold (or any other toolbar control)
    // exactly like body text. Seeded imperatively and never re-rendered from
    // props — a reactive `children`/`dangerouslySetInnerHTML` would wipe the
    // caret on every keystroke, the same reason the signature image's position
    // is owned by the DOM once touched (see applyInitialLayout).
    const defaultCredentialsHtml = s.credentials
      .map((c) => `<div>${escapeSignatureText(c)}</div>`)
      .join("")

    return (
      <div>
        {/* A <div>, not the <p> the read-only view uses: pressing Enter in a
            contentEditable makes the browser insert a block, and a <div>/<p>
            nested inside a <p> is invalid — the parser silently closes the
            outer <p> and the second line escapes the styled block. */}
        <div
          contentEditable
          suppressContentEditableWarning
          data-sig-text="name"
          data-sig-text-idx={index}
          ref={(el) => seedEditable(el, layout?.nameHtml ?? escapeSignatureText(s.name))}
          className="font-bold text-[13px] uppercase outline-none focus:bg-blue-50/50 rounded-sm cursor-text min-h-[1.2em]"
        />
        <div
          contentEditable
          suppressContentEditableWarning
          data-sig-text="credentials"
          data-sig-text-idx={index}
          ref={(el) => seedEditable(el, layout?.credentialsHtml ?? defaultCredentialsHtml)}
          className="text-[10px] uppercase text-gray-600 mt-0.5 outline-none focus:bg-blue-50/50 rounded-sm cursor-text min-h-[1.2em]"
        />
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
