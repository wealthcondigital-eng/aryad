import type { Node as PMNode } from "prosemirror-model"
import type { EditorView, NodeView } from "prosemirror-view"

// NodeView for the sig_image atomic node — reimplements the current editor's
// pointer-driven drag/resize (see insertSignature/beginDragSig/beginResizeSig
// in reports/new/page.tsx) but commits the final position/size as a node attr
// update (setNodeMarkup) instead of a bare style mutation, so it plays nicely
// with ProseMirror's undo history and serializes back out through toDOM.
export class SigImageView implements NodeView {
  dom: HTMLElement
  img: HTMLImageElement
  handle: HTMLDivElement
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

    wrapper.appendChild(img)
    wrapper.appendChild(handle)

    this.dom = wrapper
    this.img = img
    this.handle = handle
    this.applyAttrs(node)

    img.addEventListener("pointerdown", this.onDragStart)
    handle.addEventListener("pointerdown", this.onResizeStart)
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
    this.dom.style.outline = "2px solid #2563eb"
  }

  private deselect() {
    this.handle.style.display = "none"
    this.dom.style.outline = "none"
  }

  selectNode() {
    this.select()
  }

  deselectNode() {
    this.deselect()
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.applyAttrs(node)
    return true
  }

  // Drag/resize happen entirely inside this node view via native pointer
  // events, not ProseMirror's own event handling — stopEvent tells the view
  // to leave those events alone instead of treating them as a selection change.
  stopEvent(event: Event) {
    return event.type.startsWith("pointer")
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    this.img.removeEventListener("pointerdown", this.onDragStart)
    this.handle.removeEventListener("pointerdown", this.onResizeStart)
  }
}
