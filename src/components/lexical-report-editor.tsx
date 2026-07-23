"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND, UNDO_COMMAND, REDO_COMMAND,
} from "lexical"
import { $patchStyleText } from "@lexical/selection"
import { mergeRegister } from "@lexical/utils"
import { $generateHtmlFromNodes } from "@lexical/html"
import { Bold, Italic, Underline, Undo2, Redo2, PenTool } from "lucide-react"
import { SignatureImageNode, $createSignatureImageNode } from "@/lib/lexical-sig-image-node"

const FONT_FAMILIES = ["Arial", "Times New Roman", "Georgia", "Verdana", "Calibri", "Courier New"]

const SAMPLE_SIGNATURE = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="60">
    <text x="4" y="40" font-family="Segoe Script, cursive" font-size="28" fill="#1d4ed8">Dr. Signature</text>
  </svg>`
)

function Toolbar({ onInsertSignature }: { onInsertSignature: () => void }) {
  const [editor] = useLexicalComposerContext()
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUnderline, setIsUnderline] = useState(false)

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            setIsBold(selection.hasFormat("bold"))
            setIsItalic(selection.hasFormat("italic"))
            setIsUnderline(selection.hasFormat("underline"))
          }
        })
      })
    )
  }, [editor])

  const btnCls = (active: boolean) =>
    `h-8 w-8 flex items-center justify-center rounded transition-colors ${
      active ? "bg-blue-100 text-blue-700" : "hover:bg-gray-200 text-gray-700"
    }`

  const setFont = (family: string) => {
    editor.update(() => {
      const selection = $getSelection()
      if ($isRangeSelection(selection)) {
        $patchStyleText(selection, { "font-family": family })
      }
    })
  }

  return (
    <div className="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5 flex-wrap">
      <button type="button" title="Bold" className={btnCls(isBold)}
        onMouseDown={(e) => { e.preventDefault(); editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold") }}>
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" title="Italic" className={btnCls(isItalic)}
        onMouseDown={(e) => { e.preventDefault(); editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic") }}>
        <Italic className="h-4 w-4" />
      </button>
      <button type="button" title="Underline" className={btnCls(isUnderline)}
        onMouseDown={(e) => { e.preventDefault(); editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline") }}>
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
        onMouseDown={(e) => { e.preventDefault(); editor.dispatchCommand(UNDO_COMMAND, undefined) }}>
        <Undo2 className="h-4 w-4" />
      </button>
      <button type="button" title="Redo" className={btnCls(false)}
        onMouseDown={(e) => { e.preventDefault(); editor.dispatchCommand(REDO_COMMAND, undefined) }}>
        <Redo2 className="h-4 w-4" />
      </button>
      <span className="w-px h-4 bg-gray-300 mx-1" />
      <button type="button" title="Insert demo signature" className={btnCls(false)}
        onMouseDown={(e) => { e.preventDefault(); onInsertSignature() }}>
        <PenTool className="h-4 w-4" />
      </button>
      <span className="text-[11px] text-gray-400 ml-1">drag the stamp to move it, corner handle to resize</span>
    </div>
  )
}

// Gives the toolbar (outside the composer's children) a way to run a Lexical
// update — the ref is populated inside the composer, called from outside it.
function InsertSignaturePlugin({ triggerRef }: { triggerRef: React.MutableRefObject<(() => void) | null> }) {
  const [editor] = useLexicalComposerContext()
  triggerRef.current = () => {
    editor.update(() => {
      const selection = $getSelection()
      const node = $createSignatureImageNode({ src: SAMPLE_SIGNATURE, width: 140, height: 60, left: 0, top: 0, kind: "stamp" })
      if ($isRangeSelection(selection)) {
        selection.insertNodes([node])
      }
    })
  }
  return null
}

function HtmlEmitPlugin({ onChangeHtml }: { onChangeHtml?: (html: string) => void }) {
  const [editor] = useLexicalComposerContext()
  const handleChange = useCallback(() => {
    if (!onChangeHtml) return
    editor.getEditorState().read(() => {
      onChangeHtml($generateHtmlFromNodes(editor, null))
    })
  }, [editor, onChangeHtml])
  return <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
}

export function LexicalReportEditor({ onChangeHtml }: { onChangeHtml?: (html: string) => void }) {
  const insertSigRef = useRef<(() => void) | null>(null)

  const initialConfig = {
    namespace: "aarya-report-editor",
    nodes: [SignatureImageNode],
    onError(error: Error) {
      // eslint-disable-next-line no-console
      console.error(error)
    },
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <LexicalComposer initialConfig={initialConfig}>
        <Toolbar onInsertSignature={() => insertSigRef.current?.()} />
        <InsertSignaturePlugin triggerRef={insertSigRef} />
        <div className="relative">
          <RichTextPlugin
            contentEditable={<ContentEditable className="lexical-report-surface" />}
            placeholder={<div className="pointer-events-none absolute top-5 left-5 text-gray-400 text-sm">Start typing your report here…</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <HtmlEmitPlugin onChangeHtml={onChangeHtml} />
      </LexicalComposer>
      <style>{`
        .lexical-report-surface { min-height: 320px; padding: 20px; outline: none; font-size: 14px; line-height: 1.6; }
        .lexical-report-surface p { margin: 0 0 8px; }
      `}</style>
    </div>
  )
}
