"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Table2 } from "lucide-react"

const MAX_ROWS = 8
const MAX_COLS = 10
const CELL = 16          // px, square side
const GAP = 3            // px between cells

/**
 * Word-style table inserter: the toolbar button opens a grid you sweep with the
 * mouse to choose the size, then click to insert.
 *
 * The popover is portalled to <body> because the formatting toolbar scrolls
 * horizontally (`overflow-x-auto`), which would otherwise clip it.
 */
export function TableGridPicker({
  onPick,
  disabled,
}: {
  onPick: (rows: number, cols: number) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)

  const gridWidth = MAX_COLS * CELL + (MAX_COLS - 1) * GAP

  const openAtButton = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    // Keep the panel on screen when the button sits near the right edge.
    const panelWidth = gridWidth + 20   // grid + the panel's own padding
    setAnchor({
      left: Math.max(8, Math.min(r.left, window.innerWidth - panelWidth - 8)),
      top: r.bottom + 6,
    })
    setHover(null)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    // Any scroll or resize moves the button out from under the panel.
    const close = () => setOpen(false)
    document.addEventListener("mousedown", onDown, true)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", close, true)
    return () => {
      document.removeEventListener("mousedown", onDown, true)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", close, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Insert table — pick the number of rows and columns"
        disabled={disabled}
        // preventDefault throughout, so the caret stays where it is in the
        // editor and the new table lands at the cursor rather than at the top.
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else openAtButton() }}
        className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${open ? "bg-gray-200 text-blue-600" : "hover:bg-gray-200 text-gray-700"
          }`}
      >
        <Table2 className="h-3.5 w-3.5" />
      </button>

      {open && anchor && createPortal(
        <div
          ref={popRef}
          data-editor-popup=""
          style={{ left: anchor.left, top: anchor.top }}
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2.5 select-none"
          onMouseLeave={() => setHover(null)}
        >
          <div
            className="grid"
            style={{
              width: gridWidth,
              gridTemplateColumns: `repeat(${MAX_COLS}, ${CELL}px)`,
              gap: GAP,
            }}
          >
            {Array.from({ length: MAX_ROWS }).map((_, r) =>
              Array.from({ length: MAX_COLS }).map((__, c) => {
                const rows = r + 1
                const cols = c + 1
                const on = hover !== null && rows <= hover.rows && cols <= hover.cols
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setHover({ rows, cols })}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onPick(rows, cols)
                      setOpen(false)
                    }}
                    style={{ width: CELL, height: CELL }}
                    className={`rounded-[2px] border transition-colors ${on
                        ? "bg-blue-500 border-blue-600"
                        : "bg-gray-50 border-gray-300 hover:border-blue-300"
                      }`}
                  />
                )
              })
            )}
          </div>

          <p className="mt-2 text-center text-[11px] font-medium text-gray-600">
            {hover ? `${hover.cols} × ${hover.rows} Table` : "Insert Table"}
          </p>
        </div>,
        document.body
      )}
    </>
  )
}
