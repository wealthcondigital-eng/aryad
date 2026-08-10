"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Ban } from "lucide-react"

/**
 * Shared plumbing for the small toolbar popovers (colour, highlight, symbols).
 *
 * They all portal to <body> for the same reason the font picker does — the
 * formatting toolbar scrolls horizontally, which would clip an in-flow panel —
 * and they all carry `data-editor-popup` so the right-click menu doesn't treat a
 * click inside them as a click outside itself.
 */
function usePopover() {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const openAt = (width: number) => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setAnchor({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: r.bottom + 6,
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
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

  return { open, setOpen, anchor, openAt, btnRef, panelRef }
}

// Word's standard colour row plus the tints a report actually uses: red for
// abnormal findings, blue for notes, green for normal ranges.
const TEXT_COLORS = [
  "#000000", "#374151", "#6b7280", "#9ca3af",
  "#b91c1c", "#dc2626", "#ea580c", "#d97706",
  "#15803d", "#16a34a", "#0d9488", "#0891b2",
  "#1d4ed8", "#2563eb", "#7c3aed", "#be185d",
]

const HIGHLIGHT_COLORS = [
  "#fef08a", "#fde68a", "#bbf7d0", "#bfdbfe",
  "#e9d5ff", "#fecaca", "#e5e7eb", "#a7f3d0",
]

const PANEL_W = 176

export function ColorPicker({
  kind,
  value,
  onPick,
  onClear,
}: {
  kind: "text" | "highlight"
  value?: string
  onPick: (color: string) => void
  onClear: () => void
}) {
  const { open, setOpen, anchor, openAt, btnRef, panelRef } = usePopover()
  const colors = kind === "text" ? TEXT_COLORS : HIGHLIGHT_COLORS
  const label = kind === "text" ? "Text colour" : "Highlight"

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={label}
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else openAt(PANEL_W) }}
        className={`h-7 w-7 flex flex-col items-center justify-center gap-0.5 rounded transition-colors ${open ? "bg-gray-200" : "hover:bg-gray-200"
          }`}
      >
        <span className={`text-[11px] font-bold leading-none ${kind === "text" ? "text-gray-700" : "text-gray-700"}`}>
          {kind === "text" ? "A" : "ab"}
        </span>
        {/* The colour bar under the letter, exactly like Word's two buttons. */}
        <span className="h-[3px] w-4 rounded-sm" style={{ background: value || (kind === "text" ? "#dc2626" : "#fef08a") }} />
      </button>

      {open && anchor && createPortal(
        <div
          ref={panelRef}
          data-editor-popup=""
          style={{ left: anchor.left, top: anchor.top, width: PANEL_W }}
          className="fixed z-50 rounded-lg border border-gray-200 bg-white p-2 shadow-xl"
        >
          <div className="grid grid-cols-4 gap-1.5">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onMouseDown={(e) => { e.preventDefault(); onPick(c); setOpen(false) }}
                className="h-7 w-7 rounded border border-black/10 transition-transform hover:scale-110"
                style={{ background: c }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onClear(); setOpen(false) }}
            className="mt-2 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-gray-600 hover:bg-gray-100"
          >
            <Ban className="h-3 w-3" />
            {kind === "text" ? "Automatic" : "No highlight"}
          </button>
        </div>,
        document.body
      )}
    </>
  )
}

// Everything a sonography/pathology report needs that isn't on a keyboard:
// units and measures first, then the maths and the arrows, then Greek.
const SYMBOLS = [
  "°", "±", "×", "÷", "≈", "≤", "≥", "≠",
  "µ", "²", "³", "½", "¼", "¾", "‰", "∅",
  "→", "←", "↑", "↓", "•", "–", "—", "…",
  "α", "β", "γ", "Δ", "λ", "π", "σ", "Ω",
  "♀", "♂", "†", "‡", "§", "¶", "©", "®",
]

export function SymbolPicker({ onPick }: { onPick: (symbol: string) => void }) {
  const { open, setOpen, anchor, openAt, btnRef, panelRef } = usePopover()

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Insert symbol"
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else openAt(232) }}
        className={`h-7 w-7 flex items-center justify-center rounded text-gray-700 transition-colors ${open ? "bg-gray-200" : "hover:bg-gray-200"
          }`}
      >
        <span className="text-[13px] leading-none">Ω</span>
      </button>

      {open && anchor && createPortal(
        <div
          ref={panelRef}
          data-editor-popup=""
          style={{ left: anchor.left, top: anchor.top, width: 232 }}
          className="fixed z-50 rounded-lg border border-gray-200 bg-white p-2 shadow-xl"
        >
          <div className="grid grid-cols-8 gap-1">
            {SYMBOLS.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onPick(s); setOpen(false) }}
                className="flex h-6 w-6 items-center justify-center rounded text-[13px] text-gray-800 hover:bg-blue-50 hover:text-blue-700"
              >
                {s}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
