"use client"

import { useRef } from "react"

/**
 * Word's horizontal ruler, above the page.
 *
 * Shows the printable width in inches with the letterhead margins shaded, and
 * carries the two indent markers a report actually uses: the first-line indent
 * (top triangle) and the left indent (bottom triangle). Dragging either writes
 * the same paragraph attributes the toolbar's indent buttons do, so the ruler is
 * a second way to reach one setting rather than a competing one.
 *
 * Word's arbitrary tab stops are deliberately not here: HTML has no way to
 * render one (there is no CSS tab-stop), so a ruler that let you place them
 * would be a control that quietly does nothing on paper.
 */
export function DocumentRuler({
  widthPx,
  sideMarginPx,
  indent,
  firstLineIndent,
  onChange,
  zoom = 1,
}: {
  /** Full paper width in layout px (the A4 sheet the report is drawn on). */
  widthPx: number
  /** Left/right printable margin in px — the shaded ends of the ruler. */
  sideMarginPx: number
  indent: number
  firstLineIndent: number
  onChange: (next: { indent?: number; firstLineIndent?: number }) => void
  zoom?: number
}) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const contentPx = widthPx - sideMarginPx * 2
  const PX_PER_INCH = 96

  const drag = (which: "indent" | "firstLine") => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const bar = barRef.current
    if (!bar) return
    const start = e.clientX
    const base = which === "indent" ? indent : firstLineIndent

    const onMove = (ev: PointerEvent) => {
      // Screen px → layout px, the unit the attribute is stored in.
      const delta = (ev.clientX - start) / (zoom || 1)
      // Snapped to Word's 1/8" ruler ticks, and never past the right margin.
      const raw = Math.max(0, Math.min(contentPx - 24, base + delta))
      const snapped = Math.round(raw / (PX_PER_INCH / 8)) * (PX_PER_INCH / 8)
      onChange(which === "indent" ? { indent: snapped } : { firstLineIndent: snapped })
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const ticks: React.ReactNode[] = []
  for (let x = 0; x <= contentPx; x += PX_PER_INCH / 8) {
    const inch = x / PX_PER_INCH
    const whole = Number.isInteger(inch)
    const half = Number.isInteger(inch * 2)
    ticks.push(
      <div
        key={x}
        className="absolute top-1/2 -translate-y-1/2 bg-gray-400"
        style={{ left: x, width: 1, height: whole ? 9 : half ? 6 : 3 }}
      />
    )
    if (whole && inch > 0) {
      ticks.push(
        <span
          key={`n${x}`}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-0.5 text-[8px] text-gray-500"
          style={{ left: x }}
        >
          {inch}
        </span>
      )
    }
  }

  return (
    <div className="mx-auto mb-1 select-none" style={{ width: widthPx }}>
      <div className="relative h-5 rounded-sm border border-gray-200 bg-white">
        {/* Margins */}
        <div className="absolute inset-y-0 left-0 bg-gray-100" style={{ width: sideMarginPx }} />
        <div className="absolute inset-y-0 right-0 bg-gray-100" style={{ width: sideMarginPx }} />

        <div ref={barRef} className="absolute inset-y-0" style={{ left: sideMarginPx, width: contentPx }}>
          {ticks}

          {/* First-line indent — Word draws it pointing down, at the top */}
          <div
            role="slider"
            aria-label="First line indent"
            aria-valuenow={firstLineIndent}
            tabIndex={0}
            onPointerDown={drag("firstLine")}
            title="First line indent"
            className="absolute -top-0.5 h-0 w-0 -translate-x-1/2 cursor-ew-resize border-x-[5px] border-t-[7px] border-x-transparent border-t-blue-500"
            style={{ left: indent + firstLineIndent }}
          />

          {/* Left indent — pointing up, at the bottom */}
          <div
            role="slider"
            aria-label="Left indent"
            aria-valuenow={indent}
            tabIndex={0}
            onPointerDown={drag("indent")}
            title="Left indent"
            className="absolute -bottom-0.5 h-0 w-0 -translate-x-1/2 cursor-ew-resize border-x-[5px] border-b-[7px] border-x-transparent border-b-blue-500"
            style={{ left: indent }}
          />
        </div>
      </div>
    </div>
  )
}
