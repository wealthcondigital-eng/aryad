"use client"

import { useEffect, useRef, useState } from "react"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { DOMParser as PMDOMParser, DOMSerializer } from "prosemirror-model"
import { toggleMark, baseKeymap } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { history, undo, redo } from "prosemirror-history"
import { Bold, Italic, Underline, Undo2, Redo2, PenTool } from "lucide-react"
import { reportSchema } from "@/lib/pm-report-schema"
import { SigImageView } from "@/lib/pm-sig-image-view"

const FONT_FAMILIES = ["Arial", "Times New Roman", "Georgia", "Verdana", "Calibri", "Courier New"]

// A tiny inline SVG "signature" so the prototype can demo drag/resize without
// needing the app's real signature-pad/upload flow wired in.
const SAMPLE_SIGNATURE = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="60">
    <text x="4" y="40" font-family="Segoe Script, cursive" font-size="28" fill="#1d4ed8">Dr. Signature</text>
  </svg>`
)

function isMarkActive(state: EditorState, type: import("prosemirror-model").MarkType) {
  const { from, to, empty } = state.selection
  if (empty) return !!type.isInSet(state.storedMarks || state.selection.$from.marks())
  return state.doc.rangeHasMark(from, to, type)
}

export function PmReportEditor({ onChangeHtml }: { onChangeHtml?: (html: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [, bump] = useState(0)

  useEffect(() => {
    if (!hostRef.current) return

    const seed = document.createElement("div")
    seed.innerHTML = "<p>Start typing your report here…</p>"
    const doc = PMDOMParser.fromSchema(reportSchema).parse(seed)

    const state = EditorState.create({
      doc,
      schema: reportSchema,
      plugins: [
        history(),
        keymap({
          "Mod-z": undo,
          "Mod-y": redo,
          "Mod-Shift-z": redo,
          "Mod-b": toggleMark(reportSchema.marks.strong),
          "Mod-i": toggleMark(reportSchema.marks.em),
          "Mod-u": toggleMark(reportSchema.marks.underline),
        }),
        keymap(baseKeymap),
      ],
    })

    const emitHtml = (docNode: EditorState["doc"]) => {
      if (!onChangeHtml) return
      const serializer = DOMSerializer.fromSchema(reportSchema)
      const frag = serializer.serializeFragment(docNode.content)
      const wrap = document.createElement("div")
      wrap.appendChild(frag)
      onChangeHtml(wrap.innerHTML)
    }

    const view = new EditorView(hostRef.current, {
      state,
      nodeViews: {
        sig_image: (node, v, getPos) => new SigImageView(node, v, getPos),
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        bump((n) => n + 1)
        emitHtml(newState.doc)
      },
    })

    viewRef.current = view
    emitHtml(state.doc)
    return () => view.destroy()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const focusView = () => viewRef.current?.focus()

  const runMark = (markName: "strong" | "em" | "underline") => {
    const view = viewRef.current
    if (!view) return
    toggleMark(reportSchema.marks[markName])(view.state, view.dispatch)
    focusView()
  }

  const runHistory = (dir: "undo" | "redo") => {
    const view = viewRef.current
    if (!view) return
    ;(dir === "undo" ? undo : redo)(view.state, view.dispatch)
    focusView()
  }

  const setFont = (family: string) => {
    const view = viewRef.current
    if (!view) return
    const { from, to, empty } = view.state.selection
    if (empty) return
    const mark = reportSchema.marks.fontFamily.create({ family })
    view.dispatch(view.state.tr.addMark(from, to, mark))
    focusView()
  }

  const insertSignature = () => {
    const view = viewRef.current
    if (!view) return
    const node = reportSchema.nodes.sig_image.create({
      src: SAMPLE_SIGNATURE, width: 140, height: 60, left: 0, top: 0, kind: "stamp",
    })
    view.dispatch(view.state.tr.replaceSelectionWith(node))
    focusView()
  }

  const state = viewRef.current?.state
  const btnCls = (active: boolean) =>
    `h-8 w-8 flex items-center justify-center rounded transition-colors ${
      active ? "bg-blue-100 text-blue-700" : "hover:bg-gray-200 text-gray-700"
    }`

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5 flex-wrap">
        <button type="button" title="Bold" className={btnCls(!!state && isMarkActive(state, reportSchema.marks.strong))}
          onMouseDown={(e) => { e.preventDefault(); runMark("strong") }}>
          <Bold className="h-4 w-4" />
        </button>
        <button type="button" title="Italic" className={btnCls(!!state && isMarkActive(state, reportSchema.marks.em))}
          onMouseDown={(e) => { e.preventDefault(); runMark("em") }}>
          <Italic className="h-4 w-4" />
        </button>
        <button type="button" title="Underline" className={btnCls(!!state && isMarkActive(state, reportSchema.marks.underline))}
          onMouseDown={(e) => { e.preventDefault(); runMark("underline") }}>
          <Underline className="h-4 w-4" />
        </button>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <select
          className="h-8 text-xs border border-gray-200 rounded px-1.5 bg-white"
          defaultValue=""
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => { if (e.target.value) setFont(e.target.value) }}
        >
          <option value="" disabled>Font…</option>
          {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <button type="button" title="Undo" className={btnCls(false)}
          onMouseDown={(e) => { e.preventDefault(); runHistory("undo") }}>
          <Undo2 className="h-4 w-4" />
        </button>
        <button type="button" title="Redo" className={btnCls(false)}
          onMouseDown={(e) => { e.preventDefault(); runHistory("redo") }}>
          <Redo2 className="h-4 w-4" />
        </button>
        <span className="w-px h-4 bg-gray-300 mx-1" />
        <button type="button" title="Insert demo signature" className={btnCls(false)}
          onMouseDown={(e) => { e.preventDefault(); insertSignature() }}>
          <PenTool className="h-4 w-4" />
        </button>
        <span className="text-[11px] text-gray-400 ml-1">drag the stamp to move it, corner handle to resize</span>
      </div>
      <div ref={hostRef} className="pm-editor-surface" />
      <style>{`
        .pm-editor-surface .ProseMirror { min-height: 320px; padding: 20px; outline: none; font-size: 14px; line-height: 1.6; }
        .pm-editor-surface .ProseMirror p { margin: 0 0 8px; }
        .pm-editor-surface .ProseMirror-selectednode { outline: 2px solid #2563eb; }
      `}</style>
    </div>
  )
}
