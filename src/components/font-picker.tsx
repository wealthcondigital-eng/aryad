"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"
import { FONT_FAMILIES, fontStack } from "@/lib/report-fonts"

/**
 * Word's font menu: every name is drawn in its own typeface, so the list is the
 * preview. A native <select> can't be relied on for that — several browsers
 * render the popup with the OS menu font and ignore per-option font-family —
 * and it can't show the tick beside the current font either.
 *
 * The list is portalled to <body> because the formatting toolbar scrolls
 * horizontally (`overflow-x-auto`), which would clip an in-flow dropdown.
 */
export function FontPicker({
  value,
  onPick,
}: {
  value: string
  onPick: (family: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const openList = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.max(r.width, 200)
    setAnchor({
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
      top: r.bottom + 4,
      width,
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (listRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    const close = () => setOpen(false)
    // Scrolling the PAGE moves the button out from under the panel, so the panel
    // closes — but this is a capture-phase listener, so it also sees the list's
    // OWN scroll events, and closing on those made the menu impossible to use:
    // it vanished the moment you scrolled it (or, on open, the moment it scrolled
    // itself to the current font).
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDown, true)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      document.removeEventListener("mousedown", onDown, true)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [open])

  // Open on the font already in use, the way Word does — the list is 30 long
  // and the current choice is usually nowhere near the top. Set scrollTop
  // directly rather than scrollIntoView(): that scrolls every scrollable
  // ancestor too, which would drag the report out from under the menu.
  useLayoutEffect(() => {
    if (!open) return
    const list = listRef.current
    const current = list?.querySelector<HTMLElement>('[data-current="true"]')
    if (!list || !current) return
    list.scrollTop = current.offsetTop - list.clientHeight / 2 + current.offsetHeight / 2
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title="Font family"
        // preventDefault keeps the caret (and the text selection the font is
        // about to be applied to) exactly where it was in the document.
        onMouseDown={(e) => { e.preventDefault(); if (open) setOpen(false); else openList() }}
        className={`h-7 w-[132px] shrink-0 mr-1 flex items-center justify-between gap-1 rounded border bg-white px-1.5 text-[11px] text-gray-700 transition-colors ${open ? "border-blue-400" : "border-gray-200 hover:border-blue-300"
          }`}
      >
        <span className="truncate" style={{ fontFamily: fontStack(value) }}>{value}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />
      </button>

      {open && anchor && createPortal(
        <div
          ref={listRef}
          // Marks this as one of the editor's own popups. It is portalled to
          // <body>, so a menu that contains this picker cannot find it with
          // contains() and would otherwise dismiss itself — taking the picker
          // with it — the instant a font was clicked. See EditorMenus.
          data-editor-popup=""
          style={{ left: anchor.left, top: anchor.top, width: anchor.width }}
          className="fixed z-50 max-h-[min(60vh,420px)] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
        >
          {FONT_FAMILIES.map((f) => {
            const current = f === value
            return (
              <button
                key={f}
                type="button"
                tabIndex={-1}
                data-current={current}
                onMouseDown={(e) => { e.preventDefault(); onPick(f); setOpen(false) }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${current ? "bg-blue-50 text-blue-700" : "text-gray-800 hover:bg-gray-100"
                  }`}
              >
                <Check className={`h-3 w-3 shrink-0 ${current ? "opacity-100" : "opacity-0"}`} />
                {/* 15px, not the toolbar's 11px: a preview you can't see the
                    shapes of isn't a preview. */}
                <span className="truncate text-[15px] leading-6" style={{ fontFamily: fontStack(f) }}>{f}</span>
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}
