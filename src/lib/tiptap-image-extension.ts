import { Node, mergeAttributes } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import type { EditorView, NodeView } from "@tiptap/pm/view"
import {
  IMAGE_WRAP_OPTIONS, imageAnchorStyle, imageDataAttrs, imageStyle, isFloatingWrap,
  readImageDataAttrs, type ImageWrap, type ReportImageAttrs,
} from "@/lib/report-image"
import {
  DEFAULT_BG_TOLERANCE, MAX_BG_TOLERANCE, MIN_BG_TOLERANCE, removeImageBackground,
} from "@/lib/image-effects"

// An inserted report image (photo, scan, logo, stamp) as a Tiptap node, with
// Microsoft Word's text-wrapping modes and its "artistic effect" background
// knock-out.
//
// Modelled on the existing signature stamp node (tiptap-signature-extension.ts)
// and for the same reason: position/size/wrap live in node ATTRS, not as raw
// style mutations on a DOM node, so they survive ProseMirror's own redraws and
// undo/redo — and, more importantly here, so `editor.getHTML()` serializes them
// through the shared builders in report-image.ts. That serializer is what the
// view modal, print window and shared PDF each re-render, which is what keeps
// an image exactly where it was dropped across all four.
//
// The two are kept separate rather than merged: a signature stamp is a fixed
// inline stamp with its own drag/nudge conventions that the report editor's
// signature flow already depends on, while this node's whole point is the wrap
// modes. They share no behaviour beyond "draggable image".

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    reportImage: {
      insertReportImage: (attrs: Partial<ReportImageAttrs> & { src: string }) => ReturnType
    }
  }
}

// Original (pre-effect) pixels, so "Glow Edges" can be re-run at a different
// tolerance or undone. Session-only and deliberately NOT a node attr: the
// report body is saved as one JSON payload, and carrying a second full-size
// copy of every processed image inside the document would double that payload
// for a convenience that only matters while the doctor is still adjusting it.
const originals = new Map<string, { src: string; tolerance: number }>()

const PANEL_H = 34            // picture-toolbar height, used to park it above the image
const HANDLE = 11             // corner resize handle
const MIN_W = 24
// Drag reach for a floating image, measured from its anchor in the text — about
// an A4 sheet in each direction (794 × 1123px at the app's 96dpi basis).
const MAX_OFFSET_X = 700
const MAX_OFFSET_Y = 1100

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function btn(label: string, title: string): HTMLButtonElement {
  const b = document.createElement("button")
  b.type = "button"
  b.title = title
  b.textContent = label
  b.style.cssText =
    "height:22px;padding:0 6px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;" +
    "color:#374151;font-size:11px;font-weight:600;line-height:20px;cursor:pointer;white-space:nowrap;"
  return b
}

class ReportImageView implements NodeView {
  dom: HTMLElement
  private img: HTMLImageElement
  private handle: HTMLDivElement
  private grip: HTMLDivElement
  private panel: HTMLDivElement
  private wrapSelect: HTMLSelectElement
  private glowBtn: HTMLButtonElement
  private tolMinusBtn: HTMLButtonElement
  private tolPlusBtn: HTMLButtonElement
  private undoBtn: HTMLButtonElement
  private resetBtn: HTMLButtonElement
  private deleteBtn: HTMLButtonElement

  private node: PMNode
  private view: EditorView
  private getPos: () => number | undefined
  private selected = false
  private busy = false

  constructor(node: PMNode, view: EditorView, getPos: () => number | undefined) {
    this.node = node
    this.view = view
    this.getPos = getPos

    const wrapper = document.createElement("span")

    const img = document.createElement("img")
    img.draggable = false
    img.setAttribute("alt", "")
    img.style.userSelect = "none"

    // Corner handle — aspect-ratio-locked resize, same affordance as the
    // signature stamp's.
    const handle = document.createElement("div")
    handle.style.cssText =
      `position:absolute;width:${HANDLE}px;height:${HANDLE}px;background:#2563eb;border:2px solid #fff;` +
      `border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.3);cursor:nwse-resize;display:none;z-index:61;`

    // Always-visible grip for floating images. A "Behind Text" image is painted
    // *under* the paragraph's line boxes, so a click over it lands in the text,
    // not on the image — there would otherwise be no way to select or drag one
    // back out once text covers it. (Word solves the same problem with its own
    // anchor/handle markers.) This sits above the text and is the reliable
    // grab point for both selecting and dragging.
    const grip = document.createElement("div")
    grip.title = "Drag to move this image · click to select"
    grip.style.cssText =
      "position:absolute;width:16px;height:16px;border-radius:4px;background:#2563eb;color:#fff;" +
      "font-size:10px;line-height:16px;text-align:center;cursor:move;box-shadow:0 1px 3px rgba(0,0,0,.35);" +
      "display:none;z-index:62;user-select:none;"
    grip.textContent = "✥"

    // ── Picture toolbar ──
    const panel = document.createElement("div")
    panel.style.cssText =
      "position:absolute;display:none;align-items:center;gap:4px;padding:4px;background:#fff;" +
      "border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:63;" +
      "white-space:nowrap;font-family:system-ui,sans-serif;"

    const wrapLabel = document.createElement("span")
    wrapLabel.textContent = "Wrap"
    wrapLabel.style.cssText = "font-size:10px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.04em;"

    const wrapSelect = document.createElement("select")
    wrapSelect.title = "Text wrapping — how the report text flows around this image"
    wrapSelect.style.cssText =
      "height:22px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;color:#374151;" +
      "font-size:11px;padding:0 2px;cursor:pointer;"
    IMAGE_WRAP_OPTIONS.forEach((o) => {
      const opt = document.createElement("option")
      opt.value = o.value
      opt.textContent = o.label
      wrapSelect.appendChild(opt)
    })

    const sep = () => {
      const s = document.createElement("span")
      s.style.cssText = "width:1px;height:16px;background:#e5e7eb;"
      return s
    }

    const glowBtn = btn(
      "✨ Glow Edges",
      "Artistic effect — removes the background (white paper, plain backdrop) so the image can be " +
      "placed freely anywhere on the report. Also switches wrapping to Behind Text."
    )
    const tolMinusBtn = btn("−", "Remove less background")
    const tolPlusBtn = btn("+", "Remove more background")
    const undoBtn = btn("↺", "Undo the effect and restore the original image")
    const resetBtn = btn("Reset", "Move the image back to its anchor point in the text")
    const deleteBtn = btn("×", "Remove this image")
    deleteBtn.style.color = "#ef4444"
    deleteBtn.style.borderColor = "#fecaca"

    panel.append(wrapLabel, wrapSelect, sep(), glowBtn, tolMinusBtn, tolPlusBtn, undoBtn, sep(), resetBtn, deleteBtn)
    wrapper.append(img, handle, grip, panel)

    this.dom = wrapper
    this.img = img
    this.handle = handle
    this.grip = grip
    this.panel = panel
    this.wrapSelect = wrapSelect
    this.glowBtn = glowBtn
    this.tolMinusBtn = tolMinusBtn
    this.tolPlusBtn = tolPlusBtn
    this.undoBtn = undoBtn
    this.resetBtn = resetBtn
    this.deleteBtn = deleteBtn

    this.applyAttrs(node)

    img.addEventListener("pointerdown", this.onImgPointerDown)
    img.addEventListener("click", this.onClick)
    grip.addEventListener("pointerdown", this.onGripPointerDown)
    handle.addEventListener("pointerdown", this.onResizeStart)
    wrapSelect.addEventListener("change", this.onWrapChange)
    glowBtn.addEventListener("click", this.onGlowEdges)
    tolMinusBtn.addEventListener("click", () => this.retune(-14))
    tolPlusBtn.addEventListener("click", () => this.retune(14))
    undoBtn.addEventListener("click", this.onUndoEffect)
    resetBtn.addEventListener("click", this.onResetPosition)
    deleteBtn.addEventListener("click", this.onDelete)
    document.addEventListener("pointerdown", this.onOutsidePointerDown, true)
  }

  private attrs(): ReportImageAttrs {
    return this.node.attrs as unknown as ReportImageAttrs
  }

  private applyAttrs(node: PMNode) {
    const a = node.attrs as unknown as ReportImageAttrs
    // The anchor and image use the SHARED style builders — byte-identical to
    // what renderHTML() serializes, so the editor is genuinely WYSIWYG with the
    // saved report rather than merely similar to it.
    this.dom.setAttribute("data-rimg-anchor", "1")
    this.dom.style.cssText = imageAnchorStyle(a)
    // Non-floating anchors don't need to be positioned in the saved HTML, but
    // the editor's own handles/toolbar are absolutely positioned inside the
    // anchor, so they do need a containing block here.
    if (!isFloatingWrap(a.wrap)) this.dom.style.position = "relative"

    this.img.src = a.src
    this.img.style.cssText = imageStyle(a)
    this.img.style.cursor = isFloatingWrap(a.wrap) ? "move" : "default"
    // Cleared first: the offset/effect attributes are only present for the modes
    // that use them, so switching (say) Behind Text → In Line has to actually
    // take the old data-left off the element, not just stop writing it.
    for (const name of ["data-left", "data-top", "data-bg-removed"]) this.img.removeAttribute(name)
    Object.entries(imageDataAttrs(a)).forEach(([k, v]) => this.img.setAttribute(k, v))

    this.wrapSelect.value = a.wrap
    this.positionChrome(a)
    this.syncPanelState(a)
  }

  /** Places the toolbar / handles against the image's current box. */
  private positionChrome(a: ReportImageAttrs) {
    const floating = isFloatingWrap(a.wrap)
    const x = floating ? a.left : 0
    const y = floating ? a.top : 0
    this.panel.style.left = `${x}px`
    // Above the image normally, below it when the image is near the top of the
    // page — up there the toolbar would otherwise sit off the paper (or behind
    // the study-heading box, which is drawn on a layer of its own).
    const above = y - PANEL_H - 6
    this.panel.style.top = this.absoluteTop() + above < PANEL_H
      ? `${y + a.height + 6}px`
      : `${above}px`
    this.handle.style.left = `${x + a.width - HANDLE / 2}px`
    this.handle.style.top = `${y + a.height - HANDLE / 2}px`
    this.grip.style.left = `${x - 8}px`
    this.grip.style.top = `${y - 8}px`
    this.grip.style.display = floating && this.view.editable ? "block" : "none"
  }

  /** The anchor's distance from the top of the report body, for the flip above. */
  private absoluteTop(): number {
    const body = this.view.dom as HTMLElement
    if (!body.isConnected || !this.dom.isConnected) return Number.MAX_SAFE_INTEGER
    return this.dom.getBoundingClientRect().top - body.getBoundingClientRect().top
  }

  private syncPanelState(a: ReportImageAttrs) {
    const removed = !!a.bgRemoved
    this.tolMinusBtn.style.display = removed ? "inline-block" : "none"
    this.tolPlusBtn.style.display = removed ? "inline-block" : "none"
    this.undoBtn.style.display = removed && originals.has(a.src) ? "inline-block" : "none"
    this.resetBtn.style.display = isFloatingWrap(a.wrap) && (a.left || a.top) ? "inline-block" : "none"
    this.glowBtn.textContent = this.busy ? "✨ Working…" : removed ? "✨ Re-apply" : "✨ Glow Edges"
    this.glowBtn.disabled = this.busy
    this.glowBtn.style.background = removed ? "#eff6ff" : "#fff"
  }

  private commit(patch: Partial<ReportImageAttrs>) {
    const pos = this.getPos()
    if (pos == null) return
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...patch }))
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  private select() {
    if (!this.view.editable) return
    this.selected = true
    this.handle.style.display = "block"
    this.panel.style.display = "flex"
    this.img.style.outline = "2px solid #2563eb"
    this.img.style.outlineOffset = "1px"
  }

  private deselect() {
    this.selected = false
    this.handle.style.display = "none"
    this.panel.style.display = "none"
    this.img.style.outline = "none"
  }

  private onClick = (e: MouseEvent) => {
    e.stopPropagation()
    this.select()
  }

  private onOutsidePointerDown = (e: PointerEvent) => {
    if (this.selected && !this.dom.contains(e.target as globalThis.Node)) this.deselect()
  }

  // ── Drag / resize ───────────────────────────────────────────────────────────

  private onImgPointerDown = (e: PointerEvent) => {
    if (!this.view.editable) return
    this.select()
    // Only a floating image moves freely; the others hold their place in the
    // text flow, exactly as in Word.
    if (isFloatingWrap(this.attrs().wrap)) this.beginDrag(e)
  }

  private onGripPointerDown = (e: PointerEvent) => {
    if (!this.view.editable) return
    this.select()
    this.beginDrag(e)
  }

  private beginDrag(e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const a = this.attrs()
    const baseLeft = a.left
    const baseTop = a.top
    let left = baseLeft
    let top = baseTop

    const onMove = (ev: PointerEvent) => {
      // Clamped to roughly an A4 sheet's reach from the anchor (the offsets are
      // relative to a point in the text, and the same numbers are replayed on
      // paper): far enough to put an image anywhere on the page, close enough
      // that a runaway drag can't fling it somewhere unreachable.
      left = clamp(baseLeft + (ev.clientX - startX), -MAX_OFFSET_X, MAX_OFFSET_X)
      top = clamp(baseTop + (ev.clientY - startY), -MAX_OFFSET_Y, MAX_OFFSET_Y)
      this.img.style.left = `${left}px`
      this.img.style.top = `${top}px`
      this.positionChrome({ ...a, left, top })
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      this.commit({ left: Math.round(left), top: Math.round(top) })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  private onResizeStart = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const a = this.attrs()
    const startX = e.clientX
    const startY = e.clientY
    const ratio = a.height / (a.width || 1)
    let width = a.width
    let height = a.height

    const onMove = (ev: PointerEvent) => {
      // Whichever axis moved further drives the scale, so dragging the corner
      // feels right in both directions while the aspect ratio stays locked.
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      const delta = Math.abs(dy) > Math.abs(dx) ? dy / (ratio || 1) : dx
      width = Math.max(MIN_W, Math.round(a.width + delta))
      height = Math.max(Math.round(MIN_W * ratio) || 1, Math.round(width * ratio))
      this.img.style.width = `${width}px`
      this.img.style.height = `${height}px`
      if (!isFloatingWrap(a.wrap)) this.dom.style.width = `${width}px`
      this.positionChrome({ ...a, width, height })
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      this.commit({ width, height })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // ── Toolbar actions ─────────────────────────────────────────────────────────

  private onWrapChange = () => {
    const wrap = this.wrapSelect.value as ImageWrap
    // Leaving a floating mode drops the free-placement offsets: they're
    // measured from the anchor and mean nothing once the image is back in the
    // flow (keeping them would shift it away from the text it now belongs to).
    this.commit(isFloatingWrap(wrap) ? { wrap } : { wrap, left: 0, top: 0 })
  }

  private onDelete = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const pos = this.getPos()
    if (pos == null) return
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize))
  }

  private onResetPosition = (e: MouseEvent) => {
    e.preventDefault()
    this.commit({ left: 0, top: 0 })
  }

  /** "Glow Edges": knock the background out, then let the image float freely. */
  private onGlowEdges = async (e: MouseEvent) => {
    e.preventDefault()
    if (this.busy) return
    const a = this.attrs()
    const source = originals.get(a.src)
    const baseSrc = source?.src ?? a.src
    const tolerance = source?.tolerance ?? DEFAULT_BG_TOLERANCE
    await this.applyEffect(baseSrc, tolerance)
  }

  private retune = async (delta: number) => {
    if (this.busy) return
    const a = this.attrs()
    const source = originals.get(a.src)
    if (!source) return
    const tolerance = Math.max(MIN_BG_TOLERANCE, Math.min(MAX_BG_TOLERANCE, source.tolerance + delta))
    await this.applyEffect(source.src, tolerance)
  }

  private async applyEffect(baseSrc: string, tolerance: number) {
    this.busy = true
    this.syncPanelState(this.attrs())
    try {
      const out = await removeImageBackground(baseSrc, tolerance)
      const supersededSrc = this.attrs().src
      originals.set(out, { src: baseSrc, tolerance })
      // Nudging the tolerance re-runs the effect, and each run's output is a
      // full data URL — drop the version it replaces so a few adjustments don't
      // pin several megabytes of superseded bitmaps for the whole session.
      if (supersededSrc !== out && supersededSrc !== baseSrc) originals.delete(supersededSrc)
      const a = this.attrs()
      // Behind Text on purpose: a cut-out stamp/logo/seal is only useful if it
      // can then be dragged anywhere over the report, which is exactly what the
      // floating modes allow. Already-floating images keep the mode they have.
      this.commit({
        src: out,
        bgRemoved: true,
        ...(isFloatingWrap(a.wrap) ? {} : { wrap: "behind" as ImageWrap, left: 0, top: 0 }),
      })
    } catch {
      // A single unreadable image must never take the report editor down with
      // it — leave the original in place and let the doctor try again.
    } finally {
      this.busy = false
      this.syncPanelState(this.attrs())
    }
  }

  private onUndoEffect = (e: MouseEvent) => {
    e.preventDefault()
    const source = originals.get(this.attrs().src)
    if (!source) return
    this.commit({ src: source.src, bgRemoved: false })
  }

  // ── NodeView plumbing ───────────────────────────────────────────────────────

  update(node: PMNode) {
    if (node.type !== this.node.type) return false
    this.node = node
    this.applyAttrs(node)
    if (this.selected) this.select()
    return true
  }

  stopEvent(event: Event) {
    const target = event.target as globalThis.Node | null
    if (target && this.panel.contains(target)) return true
    return event.type.startsWith("pointer") || event.type === "click" || event.type === "mousedown"
  }

  ignoreMutation() {
    return true
  }

  destroy() {
    document.removeEventListener("pointerdown", this.onOutsidePointerDown, true)
  }
}

export const ReportImageExtension = Node.create({
  name: "reportImage",
  group: "inline",
  inline: true,
  atom: true,
  draggable: false,

  // `rendered: false` throughout: every attribute is written into the HTML by
  // renderHTML() below, via the shared style/data-attribute builders. Left on
  // Tiptap's default, each one would ALSO be emitted as a bare HTML attribute
  // (`wrap="behind" left="40" bgRemoved="true"`) — invalid markup that says the
  // same thing twice and would drift the moment the two disagreed.
  addAttributes() {
    return {
      src: { default: "", rendered: false },
      width: { default: 240, rendered: false },
      height: { default: 180, rendered: false },
      wrap: { default: "inline" as ImageWrap, rendered: false },
      left: { default: 0, rendered: false },
      top: { default: 0, rendered: false },
      bgRemoved: { default: false, rendered: false },
    }
  },

  parseHTML() {
    return [
      {
        tag: "img[data-rimg]",
        getAttrs: (el) => readImageDataAttrs(el as HTMLElement) as unknown as Record<string, unknown>,
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as unknown as ReportImageAttrs
    return [
      "span",
      { "data-rimg-anchor": "1", style: imageAnchorStyle(a) },
      [
        "img",
        mergeAttributes(HTMLAttributes, imageDataAttrs(a), {
          src: a.src,
          alt: "",
          draggable: "false",
          width: String(a.width),
          height: String(a.height),
          style: imageStyle(a),
        }),
      ],
    ]
  },

  addNodeView() {
    return ({ node, view, getPos }) => new ReportImageView(node, view, getPos as () => number | undefined)
  },

  addCommands() {
    return {
      insertReportImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
