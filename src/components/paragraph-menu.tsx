"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Ruler, IndentIncrease, IndentDecrease } from "lucide-react"

/**
 * Word's Paragraph dialog, cut down to the four things a report actually uses:
 * left indent, first-line indent, space before/after and line spacing.
 *
 * Values are in px because that is what the document stores (see
 * tiptap-paragraph-format-extension.ts); the labels are Word's inch/line
 * equivalents at the report's 96dpi basis, which is what a doctor recognises.
 */
export function ParagraphMenu({
  onIndent,
  onFormat,
  onLineSpacing,
}: {
  onIndent: (delta: number) => void
  onFormat: (attrs: Record<string, unknown>) => void
  onLineSpacing: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const openPanel = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setAnchor({ left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), top: r.bottom + 6 })
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
    document.addEventListener("mousedown", onDown, true)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown, true)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-[11px] text-gray-600">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )

  const Chip = ({ onRun, children, title }: { onRun: () => void; children: React.ReactNode; title?: string }) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onRun() }}
      className="h-6 min-w-6 rounded border border-gray-200 px-1.5 text-[11px] text-gray-700 hover:border-blue-300 hover:text-blue-600"
    >
      {children}
    </button>
  )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Paragraph — indents and spacing"
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else openPanel() }}
        className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${open ? "bg-gray-200 text-blue-600" : "hover:bg-gray-200 text-gray-700"
          }`}
      >
        <Ruler className="h-3.5 w-3.5" />
      </button>

      {open && anchor && createPortal(
        <div
          ref={panelRef}
          data-editor-popup=""
          style={{ left: anchor.left, top: anchor.top, width: 248 }}
          className="fixed z-50 rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
        >
          <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Paragraph</p>

          <Row label="Indent">
            <Chip onRun={() => onIndent(-1)} title="Decrease"><IndentDecrease className="h-3 w-3" /></Chip>
            <Chip onRun={() => onIndent(1)} title="Increase"><IndentIncrease className="h-3 w-3" /></Chip>
          </Row>

          <Row label="First line">
            <Chip onRun={() => onFormat({ firstLineIndent: null })}>None</Chip>
            <Chip onRun={() => onFormat({ firstLineIndent: 24 })}>0.25&quot;</Chip>
            <Chip onRun={() => onFormat({ firstLineIndent: 48 })}>0.5&quot;</Chip>
          </Row>

          <Row label="Space before">
            <Chip onRun={() => onFormat({ spaceBefore: null })}>0</Chip>
            <Chip onRun={() => onFormat({ spaceBefore: 6 })}>6</Chip>
            <Chip onRun={() => onFormat({ spaceBefore: 12 })}>12</Chip>
          </Row>

          <Row label="Space after">
            <Chip onRun={() => onFormat({ spaceAfter: null })}>0</Chip>
            <Chip onRun={() => onFormat({ spaceAfter: 6 })}>6</Chip>
            <Chip onRun={() => onFormat({ spaceAfter: 12 })}>12</Chip>
          </Row>

          <Row label="Line spacing">
            {["1", "1.15", "1.5", "2"].map((v) => (
              <Chip key={v} onRun={() => onLineSpacing(v)}>{v}</Chip>
            ))}
          </Row>
        </div>,
        document.body
      )}
    </>
  )
}
