"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Editor } from "@tiptap/react"
import { findTable } from "@tiptap/pm/tables"
import {
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, List,
  ChevronUp, ChevronDown, Scissors, Copy, ClipboardPaste, Table2,
  ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine,
  Trash2, Maximize2, Combine, Split, Strikethrough,
  Superscript as SuperscriptIcon, Subscript as SubscriptIcon,
} from "lucide-react"
import { FontPicker } from "@/components/font-picker"
import { ColorPicker, SymbolPicker } from "@/components/editor-pickers"

/**
 * The actions both menus drive. They are the SAME handlers the top toolbar
 * uses — which is what makes the context menu route to the heading, the patient
 * box or the report body depending on which one the caret was last in, exactly
 * as the toolbar does.
 */
export type EditorMenuActions = {
  fontFamily: string
  fontSize: number
  onFontFamily: (family: string) => void
  onFontSizeStep: (delta: number) => void
  onLineSpacing: (value: string) => void
  onBold: () => void
  onItalic: () => void
  onUnderline: () => void
  onStrike: () => void
  onSuperscript: () => void
  onSubscript: () => void
  textColor?: string
  highlightColor?: string
  onTextColor: (color: string | null) => void
  onHighlight: (color: string | null) => void
  onSymbol: (symbol: string) => void
  onAlign: (align: "left" | "center" | "right") => void
  onBulletList: () => void
  onOrderedList: () => void
  onClearFormat: () => void
  table: {
    insertRowAbove: () => void
    insertRowBelow: () => void
    insertColumnLeft: () => void
    insertColumnRight: () => void
    deleteRow: () => void
    deleteColumn: () => void
    deleteTable: () => void
    fitTable: () => void
    mergeCells: () => void
    splitCell: () => void
  }
}

const SPACINGS = ["1", "1.15", "1.5", "2"]

// Every control commits on mousedown with the default prevented: a click that
// moves focus would collapse the very selection it is about to format.
function hold(run: () => void) {
  return (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); run() }
}

function Btn({ onRun, title, children, wide }: {
  onRun: () => void; title: string; children: React.ReactNode; wide?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={hold(onRun)}
      className={`h-7 ${wide ? "px-1.5" : "w-7"} flex items-center justify-center rounded text-gray-700 hover:bg-gray-200 transition-colors`}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="mx-1 h-4 w-px bg-gray-200" />
}

/** Word's mini toolbar: font, size, weight, alignment, lists, spacing. */
function MiniStrip({ a, onDone }: { a: EditorMenuActions; onDone: () => void }) {
  return (
    <div className="flex items-center gap-0.5 px-1.5 py-1">
      <FontPicker value={a.fontFamily} onPick={(f) => { a.onFontFamily(f); onDone() }} />

      <div className="mr-1 flex items-center overflow-hidden rounded border border-gray-200 bg-white">
        <button
          type="button" title="Decrease font size"
          onMouseDown={hold(() => a.onFontSizeStep(-2))}
          className="flex h-7 items-center justify-center gap-0.5 border-r border-gray-200 px-1.5 text-gray-600 hover:bg-gray-100"
        >
          <span className="text-[10px] font-bold">A</span>
          <ChevronDown className="h-2.5 w-2.5 text-blue-500" />
        </button>
        <span className="w-7 select-none text-center text-[11px] font-medium text-gray-700">{a.fontSize}</span>
        <button
          type="button" title="Increase font size"
          onMouseDown={hold(() => a.onFontSizeStep(2))}
          className="flex h-7 items-center justify-center gap-0.5 border-l border-gray-200 px-1.5 text-gray-600 hover:bg-gray-100"
        >
          <span className="text-xs font-bold text-gray-700">A</span>
          <ChevronUp className="h-2.5 w-2.5 text-blue-500" />
        </button>
      </div>

      <Btn onRun={a.onBold} title="Bold (Ctrl+B)"><Bold className="h-3.5 w-3.5 stroke-[2.5]" /></Btn>
      <Btn onRun={a.onItalic} title="Italic (Ctrl+I)"><Italic className="h-3.5 w-3.5" /></Btn>
      <Btn onRun={a.onUnderline} title="Underline (Ctrl+U)"><Underline className="h-3.5 w-3.5" /></Btn>
      <Btn onRun={a.onStrike} title="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></Btn>
      <Btn onRun={a.onSuperscript} title="Superscript — cm², mm³"><SuperscriptIcon className="h-3.5 w-3.5" /></Btn>
      <Btn onRun={a.onSubscript} title="Subscript"><SubscriptIcon className="h-3.5 w-3.5" /></Btn>
      <Sep />
      <ColorPicker kind="text" value={a.textColor} onPick={a.onTextColor} onClear={() => a.onTextColor(null)} />
      <ColorPicker kind="highlight" value={a.highlightColor} onPick={a.onHighlight} onClear={() => a.onHighlight(null)} />
      <SymbolPicker onPick={(s) => { a.onSymbol(s); onDone() }} />
      <Sep />
      <Btn onRun={() => a.onAlign("left")} title="Align left"><AlignLeft className="h-3.5 w-3.5" /></Btn>
      <Btn onRun={() => a.onAlign("center")} title="Center"><AlignCenter className="h-3.5 w-3.5" /></Btn>
      <Btn onRun={() => a.onAlign("right")} title="Align right"><AlignRight className="h-3.5 w-3.5" /></Btn>
      <Sep />
      <Btn onRun={a.onBulletList} title="Bullet list"><List className="h-3.5 w-3.5" /></Btn>
      <Btn onRun={a.onOrderedList} title="Numbered list"><span className="text-[11px] font-semibold">1.</span></Btn>
      <Sep />
      {SPACINGS.map((v) => (
        <Btn key={v} wide onRun={() => a.onLineSpacing(v)} title={`Line spacing ${v}`}>
          <span className="text-[10px] font-semibold text-gray-600">{v}</span>
        </Btn>
      ))}
      <Sep />
      <Btn onRun={a.onClearFormat} title="Clear formatting" wide>
        <span className="text-[10px] font-medium text-gray-400">Clear</span>
      </Btn>
    </div>
  )
}

function Item({ onRun, icon, label, danger }: {
  onRun: () => void; icon: React.ReactNode; label: string; danger?: boolean
}) {
  return (
    <button
      type="button"
      onMouseDown={hold(onRun)}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors ${danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-100"
        }`}
    >
      <span className="shrink-0 text-gray-400">{icon}</span>
      {label}
    </button>
  )
}

/**
 * Word's two editing menus for the report document:
 *
 *  - right-click anywhere in the report → mini toolbar + a menu whose table
 *    half (insert/delete row & column, merge, fit) only appears when the click
 *    landed inside a table, the way Word's does;
 *  - select text with the mouse → the mini toolbar alone floats above the
 *    selection, so the common formatting is at the pointer rather than at the
 *    top of the screen.
 *
 * Both are portalled to <body>: the report sits inside scrolling, transformed
 * containers that would clip or mis-place an in-flow popup.
 */
export function EditorMenus({
  editor,
  containerRef,
  disabled,
  actions,
}: {
  editor: Editor | null
  containerRef: React.RefObject<HTMLElement | null>
  disabled?: boolean
  actions: EditorMenuActions
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; inTable: boolean } | null>(null)
  const [bar, setBar] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)

  const closeAll = useCallback(() => { setMenu(null); setBar(null) }, [])

  // ── Right-click ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (disabled) return

    const onContextMenu = (e: MouseEvent) => {
      // Shift+right-click falls through to the browser's own menu, which is the
      // only way to reach its spelling suggestions — no API exposes them, so a
      // page that always preempts the native menu takes spell-check with it.
      if (e.shiftKey) return
      const target = e.target as HTMLElement
      // Listening on the document and testing containment here (rather than
      // binding to the container itself) keeps working when the report area
      // remounts — the ref would otherwise still point at the old element.
      if (!containerRef.current?.contains(target)) return
      // The picture toolbar owns clicks on an image or a signature stamp.
      if (target.closest("[data-rimg]") || target.closest("[data-sig-kind]")) return
      e.preventDefault()

      // Right-clicking outside the selection moves the caret first (Word does
      // the same) — otherwise "delete row" would act on wherever the caret
      // happened to be, not the row actually clicked.
      let inTable = false
      if (editor && editor.view.dom.contains(target)) {
        const hit = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
        const { from, to } = editor.state.selection
        if (hit && (hit.pos < from || hit.pos > to)) {
          editor.commands.focus()
          editor.commands.setTextSelection(hit.pos)
        }
        inTable = !!findTable(editor.state.selection.$anchor)
      }
      setBar(null)
      setMenu({ x: e.clientX, y: e.clientY, inTable })
    }

    document.addEventListener("contextmenu", onContextMenu)
    return () => document.removeEventListener("contextmenu", onContextMenu)
  }, [editor, containerRef, disabled])

  // ── Selection mini toolbar ────────────────────────────────────────────────
  // Driven by mouseup/keyup rather than every selectionchange, so it appears
  // once the selection is finished instead of jittering along with the drag.
  useEffect(() => {
    if (disabled) return

    const show = () => {
      if (menuRef.current || menu) return
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setBar(null); return }
      const node = sel.anchorNode
      const el = containerRef.current
      if (!node || !el || !el.contains(node.nodeType === 1 ? node : node.parentNode)) { setBar(null); return }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      if (!rect || (!rect.width && !rect.height)) { setBar(null); return }
      setBar({ x: rect.left + rect.width / 2, y: rect.top })
    }

    // Clicks in the bar — or in the font list it opens, which is a portal of its
    // own on <body> — must neither hide it nor recompute its position.
    const inPopup = (t: EventTarget | null) => {
      const node = t as Node | null
      if (!node) return false
      if (barRef.current?.contains(node)) return true
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement
      return !!el?.closest("[data-editor-popup]")
    }
    const onMouseUp = (e: MouseEvent) => {
      if (inPopup(e.target)) return
      // After the browser has settled the selection this click produced.
      window.setTimeout(show, 0)
    }
    const onKeyUp = (e: KeyboardEvent) => { if (e.shiftKey || e.ctrlKey || e.metaKey) show() }
    const onMouseDown = (e: MouseEvent) => { if (!inPopup(e.target)) setBar(null) }

    document.addEventListener("mouseup", onMouseUp)
    document.addEventListener("keyup", onKeyUp)
    document.addEventListener("mousedown", onMouseDown)
    return () => {
      document.removeEventListener("mouseup", onMouseUp)
      document.removeEventListener("keyup", onKeyUp)
      document.removeEventListener("mousedown", onMouseDown)
    }
  }, [containerRef, disabled, menu])

  // ── Dismissal, shared ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!menu && !bar) return
    // The font picker inside these menus lives in its OWN portal on <body>, so
    // contains() cannot see it — without the data-editor-popup test, clicking a
    // font would dismiss this menu first and the pick would never be applied.
    const ours = (t: EventTarget | null) => {
      const node = t as Node | null
      if (!node) return false
      if (menuRef.current?.contains(node) || barRef.current?.contains(node)) return true
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement
      return !!el?.closest("[data-editor-popup]")
    }
    const onDown = (e: MouseEvent) => { if (!ours(e.target)) setMenu(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeAll() }
    // A scroll INSIDE a popup (the font list) must not dismiss it either.
    const onScroll = (e: Event) => { if (!ours(e.target)) closeAll() }
    document.addEventListener("mousedown", onDown, true)
    document.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", closeAll)
    return () => {
      document.removeEventListener("mousedown", onDown, true)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", closeAll)
    }
  }, [menu, bar, closeAll])

  // Flip/clamp both popups back inside the viewport once their real size is known.
  useLayoutEffect(() => {
    for (const el of [menuRef.current, barRef.current]) {
      if (!el) continue
      const r = el.getBoundingClientRect()
      const overRight = r.right > window.innerWidth - 8
      if (overRight || r.left < 8) {
        // The selection bar is centred with translateX(-50%); dropping the
        // transform first keeps `left` meaning the same thing for both popups.
        el.style.transform = "none"
        el.style.left = `${overRight ? Math.max(8, window.innerWidth - r.width - 8) : 8}px`
      }
      if (r.bottom > window.innerHeight - 8) el.style.top = `${Math.max(8, window.innerHeight - r.height - 8)}px`
      if (r.top < 8) el.style.top = "8px"
    }
  }, [menu, bar])

  if (disabled) return null

  const clipboard = {
    cut: () => document.execCommand("cut"),
    copy: () => document.execCommand("copy"),
    paste: async () => {
      // Blocked without clipboard permission in some browsers — Ctrl+V always
      // works, so a failure here is silent rather than an error the doctor has
      // to dismiss mid-report.
      try {
        const text = await navigator.clipboard.readText()
        if (!text) return
        if (editor?.isFocused) editor.chain().focus().insertContent(text).run()
        else document.execCommand("insertText", false, text)
      } catch { /* ignore */ }
    },
  }

  const t = actions.table
  const done = () => setMenu(null)

  return (
    <>
      {menu && createPortal(
        <div
          ref={menuRef}
          data-editor-popup=""
          style={{ left: menu.x, top: menu.y }}
          className="fixed z-[60] w-max rounded-lg border border-gray-200 bg-white shadow-2xl"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="border-b border-gray-100">
            <MiniStrip a={actions} onDone={done} />
          </div>

          <div className="py-1">
            <Item onRun={() => { clipboard.cut(); done() }} icon={<Scissors className="h-3.5 w-3.5" />} label="Cut" />
            <Item onRun={() => { clipboard.copy(); done() }} icon={<Copy className="h-3.5 w-3.5" />} label="Copy" />
            <Item onRun={() => { void clipboard.paste(); done() }} icon={<ClipboardPaste className="h-3.5 w-3.5" />} label="Paste" />
          </div>

          {menu.inTable && (
            <div className="border-t border-gray-100 py-1">
              <p className="flex items-center gap-1.5 px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                <Table2 className="h-3 w-3" />Table
              </p>
              <Item onRun={() => { t.insertRowAbove(); done() }} icon={<ArrowUpToLine className="h-3.5 w-3.5" />} label="Insert row above" />
              <Item onRun={() => { t.insertRowBelow(); done() }} icon={<ArrowDownToLine className="h-3.5 w-3.5" />} label="Insert row below" />
              <Item onRun={() => { t.insertColumnLeft(); done() }} icon={<ArrowLeftToLine className="h-3.5 w-3.5" />} label="Insert column left" />
              <Item onRun={() => { t.insertColumnRight(); done() }} icon={<ArrowRightToLine className="h-3.5 w-3.5" />} label="Insert column right" />
              <div className="my-1 h-px bg-gray-100" />
              <Item onRun={() => { t.mergeCells(); done() }} icon={<Combine className="h-3.5 w-3.5" />} label="Merge cells" />
              <Item onRun={() => { t.splitCell(); done() }} icon={<Split className="h-3.5 w-3.5" />} label="Split cell" />
              <Item onRun={() => { t.fitTable(); done() }} icon={<Maximize2 className="h-3.5 w-3.5" />} label="Fit table to page" />
              <div className="my-1 h-px bg-gray-100" />
              <Item onRun={() => { t.deleteRow(); done() }} icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete row" danger />
              <Item onRun={() => { t.deleteColumn(); done() }} icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete column" danger />
              <Item onRun={() => { t.deleteTable(); done() }} icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete table" danger />
            </div>
          )}
        </div>,
        document.body
      )}

      {bar && !menu && createPortal(
        <div
          ref={barRef}
          data-editor-popup=""
          // Above the selection, centred on it — 46px clears a line of text plus
          // the bar's own height.
          style={{ left: bar.x, top: Math.max(8, bar.y - 46), transform: "translateX(-50%)" }}
          className="fixed z-[55] rounded-lg border border-gray-200 bg-white shadow-xl"
        >
          <MiniStrip a={actions} onDone={() => setBar(null)} />
        </div>,
        document.body
      )}
    </>
  )
}
