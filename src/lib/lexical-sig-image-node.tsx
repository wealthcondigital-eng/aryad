"use client"

import { useRef } from "react"
import {
  DecoratorNode,
  $getNodeByKey,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalEditor,
} from "lexical"

// Signature stamp as a Lexical DecoratorNode — mirrors the sig_image node in
// pm-report-schema.ts (the ProseMirror prototype): an atomic inline node whose
// exportDOM() produces the exact same <img data-sig-stamp> shape the current
// contentEditable editor already writes into reportBody, so the HTML format
// stays compatible regardless of which editor produced it.

export type SigImageKind = "stamp" | "doctor"

export type SerializedSigImageNode = Spread<
  {
    type: "sig-image"
    version: 1
    src: string
    width: number
    height: number
    left: number
    top: number
    kind: SigImageKind
  },
  SerializedLexicalNode
>

function convertSigImageElement(domNode: Node): DOMConversionOutput | null {
  const el = domNode as HTMLElement
  const node = $createSignatureImageNode({
    src: el.getAttribute("src") || "",
    width: parseFloat(el.style.width) || parseFloat(el.getAttribute("width") || "") || 140,
    height: parseFloat(el.style.height) || parseFloat(el.getAttribute("height") || "") || 60,
    left: parseFloat(el.style.left) || 0,
    top: parseFloat(el.style.top) || 0,
    kind: (el.getAttribute("data-sig-kind") as SigImageKind) || "stamp",
  })
  return { node }
}

export class SignatureImageNode extends DecoratorNode<React.ReactNode> {
  __src: string
  __width: number
  __height: number
  __left: number
  __top: number
  __kind: SigImageKind

  static getType(): string {
    return "sig-image"
  }

  static clone(node: SignatureImageNode): SignatureImageNode {
    return new SignatureImageNode(
      node.__src, node.__width, node.__height, node.__left, node.__top, node.__kind, node.__key
    )
  }

  static importJSON(serialized: SerializedSigImageNode): SignatureImageNode {
    return $createSignatureImageNode(serialized)
  }

  exportJSON(): SerializedSigImageNode {
    return {
      type: "sig-image",
      version: 1,
      src: this.__src,
      width: this.__width,
      height: this.__height,
      left: this.__left,
      top: this.__top,
      kind: this.__kind,
    }
  }

  static importDOM(): DOMConversionMap | null {
    return {
      img: (node: HTMLElement) => {
        if (!node.hasAttribute("data-sig-stamp")) return null
        return { conversion: convertSigImageElement, priority: 1 }
      },
    }
  }

  exportDOM(): DOMExportOutput {
    const img = document.createElement("img")
    img.setAttribute("src", this.__src)
    img.setAttribute("width", String(this.__width))
    img.setAttribute("height", String(this.__height))
    img.setAttribute("data-sig-stamp", "1")
    img.setAttribute("data-sig-kind", this.__kind)
    img.setAttribute("draggable", "false")
    img.setAttribute(
      "style",
      `display:inline-block;vertical-align:middle;position:relative;` +
        `left:${this.__left}px;top:${this.__top}px;width:${this.__width}px;height:${this.__height}px;` +
        `cursor:move;user-select:none;`
    )
    return { element: img }
  }

  constructor(
    src: string, width: number, height: number, left: number, top: number, kind: SigImageKind, key?: NodeKey
  ) {
    super(key)
    this.__src = src
    this.__width = width
    this.__height = height
    this.__left = left
    this.__top = top
    this.__kind = kind
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span")
    span.style.display = "inline-block"
    span.style.position = "relative"
    return span
  }

  updateDOM(): boolean {
    return false
  }

  isInline(): boolean {
    return true
  }

  setPosition(left: number, top: number): void {
    const writable = this.getWritable()
    writable.__left = left
    writable.__top = top
  }

  setSize(width: number, height: number): void {
    const writable = this.getWritable()
    writable.__width = width
    writable.__height = height
  }

  decorate(editor: LexicalEditor, _config: EditorConfig): React.ReactNode {
    return (
      <SignatureImageComponent
        nodeKey={this.getKey()}
        src={this.__src}
        width={this.__width}
        height={this.__height}
        left={this.__left}
        top={this.__top}
        kind={this.__kind}
        editor={editor}
      />
    )
  }
}

export function $createSignatureImageNode(opts: {
  src: string; width: number; height: number; left: number; top: number; kind: SigImageKind
}): SignatureImageNode {
  return new SignatureImageNode(opts.src, opts.width, opts.height, opts.left, opts.top, opts.kind)
}

export function $isSignatureImageNode(node: unknown): node is SignatureImageNode {
  return node instanceof SignatureImageNode
}

// ── Drag-to-move, corner-handle-to-resize — same interaction as the current
// editor's beginDragSig/beginResizeSig, committed via editor.update() on
// pointerup so it round-trips through Lexical's own undo/redo history.
function SignatureImageComponent({
  nodeKey, src, width, height, left, top, kind, editor,
}: {
  nodeKey: string; src: string; width: number; height: number; left: number; top: number
  kind: SigImageKind; editor: LexicalEditor
}) {
  const imgRef = useRef<HTMLImageElement | null>(null)

  const commitPosition = (l: number, t: number) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isSignatureImageNode(node)) node.setPosition(l, t)
    })
  }
  const commitSize = (w: number, h: number) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isSignatureImageNode(node)) node.setSize(w, h)
    })
  }

  const onDragPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    let pendingLeft = left
    let pendingTop = top
    const onMove = (ev: PointerEvent) => {
      pendingLeft = left + (ev.clientX - startX)
      pendingTop = top + (ev.clientY - startY)
      if (imgRef.current) {
        imgRef.current.style.left = `${pendingLeft}px`
        imgRef.current.style.top = `${pendingTop}px`
      }
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      commitPosition(pendingLeft, pendingTop)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    let pendingW = width
    let pendingH = height
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(24, width + (ev.clientX - startX))
      const scale = w / width
      const h = Math.max(12, Math.round(height * scale))
      pendingW = w
      pendingH = h
      if (imgRef.current) {
        imgRef.current.style.width = `${w}px`
        imgRef.current.style.height = `${h}px`
      }
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      commitSize(pendingW, pendingH)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <img
        ref={imgRef}
        src={src}
        draggable={false}
        alt=""
        data-sig-stamp="1"
        data-sig-kind={kind}
        style={{
          display: "inline-block", verticalAlign: "middle", position: "relative",
          left, top, width, height, cursor: "move", userSelect: "none",
        }}
        onPointerDown={onDragPointerDown}
      />
      <div
        onPointerDown={onResizePointerDown}
        style={{
          position: "absolute", width: 10, height: 10, right: -5, bottom: -5,
          background: "#2563eb", borderRadius: 2, cursor: "nwse-resize",
        }}
      />
    </span>
  )
}
