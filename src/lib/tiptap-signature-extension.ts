import { Node, mergeAttributes } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import type { EditorView, NodeView } from "@tiptap/pm/view"

// Signature stamp (the pen-tool "Insert signature" flow) as a Tiptap Node.
// Same interaction as the app's original raw-DOM stamp (pointer-driven drag,
// corner-handle resize — see the throwaway ProseMirror prototype at
// src/lib/pm-sig-image-view.ts, kept as an unmodified reference), but as a
// proper atomic node with attrs (src/width/height/left/top), so its position
// survives ProseMirror's own redraws/undo-redo instead of being a raw style
// mutation on a DOM node ProseMirror doesn't know it should preserve.
//
// This is NOT used for the two fixed "doctor" signature slots — those live
// entirely outside the editor, in <SignatureColumns>, and keep the app's
// original wrap-level drag/resize/nudge system untouched. A delete ("×")
// control is included here (the old system's floating toolbar isn't reused
// for stamps anymore, so this preserves the "remove a stamp" capability on
// its own).

export type SignatureKind = "stamp" | "doctor"

export interface SignatureAttrs {
  src: string
  width: number
  height: number
  left: number
  top: number
  kind: SignatureKind
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    signature: {
      insertSignature: (attrs: SignatureAttrs) => ReturnType
    }
  }
}

class SignatureNodeView implements NodeView {
  dom: HTMLElement
  img: HTMLImageElement
  handle: HTMLDivElement
  deleteBtn: HTMLButtonElement
  node: PMNode
  view: EditorView
  getPos: () => number | undefined

  private pendingLeft?: number
  private pendingTop?: number
  private pendingWidth?: number
  private pendingHeight?: number

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos

    const wrapper = document.createElement("span")
    wrapper.style.position = "relative"
    wrapper.style.display = "inline-block"

    const img = document.createElement("img")
    img.draggable = false
    img.style.display = "inline-block"
    img.style.cursor = "move"
    img.style.userSelect = "none"
    img.setAttribute("data-sig-stamp", "1")
    img.setAttribute("alt", "")

    const handle = document.createElement("div")
    handle.style.position = "absolute"
    handle.style.width = "10px"
    handle.style.height = "10px"
    handle.style.right = "-5px"
    handle.style.bottom = "-5px"
    handle.style.background = "#2563eb"
    handle.style.borderRadius = "2px"
    handle.style.cursor = "nwse-resize"
    handle.style.display = "none"

    const deleteBtn = document.createElement("button")
    deleteBtn.type = "button"
    deleteBtn.title = "Remove signature"
    deleteBtn.textContent = "×"
    deleteBtn.style.position = "absolute"
    deleteBtn.style.top = "-9px"
    deleteBtn.style.right = "-9px"
    deleteBtn.style.width = "16px"
    deleteBtn.style.height = "16px"
    deleteBtn.style.lineHeight = "14px"
    deleteBtn.style.padding = "0"
    deleteBtn.style.border = "1px solid white"
    deleteBtn.style.borderRadius = "50%"
    deleteBtn.style.background = "#ef4444"
    deleteBtn.style.color = "white"
    deleteBtn.style.fontSize = "11px"
    deleteBtn.style.cursor = "pointer"
    deleteBtn.style.display = "none"

    wrapper.appendChild(img)
    wrapper.appendChild(handle)
    wrapper.appendChild(deleteBtn)

    this.dom = wrapper
    this.img = img
    this.handle = handle
    this.deleteBtn = deleteBtn
    this.applyAttrs(node)

    img.addEventListener("pointerdown", this.onDragStart)
    handle.addEventListener("pointerdown", this.onResizeStart)
    deleteBtn.addEventListener("pointerdown", this.onDeleteClick)
    img.addEventListener("click", this.onClick)
    document.addEventListener("pointerdown", this.onOutsidePointerDown, true)
  }

  private applyAttrs(node: PMNode) {
    const { src, width, height, left, top, kind } = node.attrs
    this.img.src = src
    this.img.style.width = `${width}px`
    this.img.style.height = `${height}px`
    this.img.style.position = "relative"
    this.img.style.left = `${left}px`
    this.img.style.top = `${top}px`
    this.img.setAttribute("data-sig-kind", kind)
  }

  private commitAttrs(patch: Partial<{ left: number; top: number; width: number; height: number }>) {
    const pos = this.getPos()
    if (pos == null) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch })
    this.view.dispatch(tr)
  }

  private onClick = (e: MouseEvent) => {
    e.stopPropagation()
    this.select()
  }

  private onOutsidePointerDown = (e: PointerEvent) => {
    if (!this.dom.contains(e.target as globalThis.Node)) this.deselect()
  }

  private onDeleteClick = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = this.getPos()
    if (pos == null) return
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
  }

  private onDragStart = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    this.select()
    const startX = e.clientX
    const startY = e.clientY
    const baseLeft = this.node.attrs.left as number
    const baseTop = this.node.attrs.top as number

    const onMove = (ev: PointerEvent) => {
      const left = baseLeft + (ev.clientX - startX)
      const top = baseTop + (ev.clientY - startY)
      this.img.style.left = `${left}px`
      this.img.style.top = `${top}px`
      this.pendingLeft = left
      this.pendingTop = top
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      this.commitAttrs({
        left: this.pendingLeft ?? baseLeft,
        top: this.pendingTop ?? baseTop,
      })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  private onResizeStart = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = this.node.attrs.width as number
    const startH = this.node.attrs.height as number

    const onMove = (ev: PointerEvent) => {
      const w = Math.max(24, startW + (ev.clientX - startX))
      const scale = w / startW
      const h = Math.max(12, Math.round(startH * scale))
      this.img.style.width = `${w}px`
      this.img.style.height = `${h}px`
      this.pendingWidth = w
      this.pendingHeight = h
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      this.commitAttrs({
        width: this.pendingWidth ?? startW,
        height: this.pendingHeight ?? startH,
      })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  private select() {
    this.handle.style.display = "block"
    this.deleteBtn.style.display = "block"
    this.dom.style.outline = "2px solid #2563eb"
  }

  private deselect() {
    this.handle.style.display = "none"
    this.deleteBtn.style.display = "none"
    this.dom.style.outline = "none"
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.applyAttrs(node)
    return true
  }

  stopEvent(event: Event) {
    return event.type.startsWith("pointer") || event.type === "click"
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.img.removeEventListener("pointerdown", this.onDragStart)
    this.handle.removeEventListener("pointerdown", this.onResizeStart)
    this.deleteBtn.removeEventListener("pointerdown", this.onDeleteClick)
    this.img.removeEventListener("click", this.onClick)
    document.removeEventListener("pointerdown", this.onOutsidePointerDown, true)
  }
}

export const SignatureExtension = Node.create({
  name: "signature",
  group: "inline",
  inline: true,
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      src: { default: "" },
      width: { default: 140 },
      height: { default: 60 },
      left: { default: 0 },
      top: { default: 0 },
      kind: { default: "stamp" },
    }
  },

  parseHTML() {
    return [
      {
        tag: "img[data-sig-stamp]",
        getAttrs: (el) => {
          const style = (el as HTMLElement).style
          return {
            src: (el as HTMLElement).getAttribute("src") || "",
            width: parseFloat(style.width) || parseFloat((el as HTMLElement).getAttribute("width") || "") || 140,
            height: parseFloat(style.height) || parseFloat((el as HTMLElement).getAttribute("height") || "") || 60,
            left: parseFloat(style.left) || 0,
            top: parseFloat(style.top) || 0,
            kind: (el as HTMLElement).getAttribute("data-sig-kind") || "stamp",
          }
        },
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { src, width, height, left, top, kind } = node.attrs
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        src,
        width: String(width),
        height: String(height),
        "data-sig-stamp": "1",
        "data-sig-kind": kind,
        draggable: "false",
        style:
          `display:inline-block;vertical-align:middle;position:relative;` +
          `left:${left}px;top:${top}px;width:${width}px;height:${height}px;` +
          `cursor:move;user-select:none;`,
      }),
    ]
  },

  addNodeView() {
    return ({ node, view, getPos }) => new SignatureNodeView(node, view, getPos as () => number | undefined)
  },

  addCommands() {
    return {
      insertSignature:
        (attrs: SignatureAttrs) =>
        ({ commands }) => {
          return commands.insertContent({ type: this.name, attrs })
        },
    }
  },
})
