
import { Schema } from "prosemirror-model"

// Standalone ProseMirror schema for the report-editor prototype. Mirrors the
// HTML shape the existing contentEditable editor already produces (plain
// <p>/<strong>/<em>/<u> tags, <img data-sig-stamp> for signature stamps) so a
// document authored here could, in principle, be read by the app's existing
// parseHtml()/DOCX export without any format migration.
export const reportSchema = new Schema({
  nodes: {
    doc: { content: "block+" },

    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { align: { default: null } },
      parseDOM: [
        {
          tag: "p",
          getAttrs(dom) {
            const align = (dom as HTMLElement).style.textAlign
            return { align: align || null }
          },
        },
      ],
      toDOM(node) {
        const style = node.attrs.align ? `text-align:${node.attrs.align}` : ""
        return ["p", style ? { style } : {}, 0]
      },
    },

    text: { group: "inline" },

    // Signature stamp — an atomic inline node so it behaves like a single
    // character for cursor/selection purposes, same as the plain <img> the
    // current editor inserts. Position/size live in node attrs (not raw
    // style mutation) so drag/resize round-trips through undo/redo and
    // survives re-serialization to HTML.
    sig_image: {
      group: "inline",
      inline: true,
      atom: true,
      draggable: false,
      attrs: {
        src: {},
        width: { default: 140 },
        height: { default: 60 },
        left: { default: 0 },
        top: { default: 0 },
        kind: { default: "stamp" },
      },
      parseDOM: [
        {
          tag: "img[data-sig-stamp]",
          getAttrs(dom) {
            const el = dom as HTMLElement
            return {
              src: el.getAttribute("src") || "",
              width: parseFloat(el.style.width) || parseFloat(el.getAttribute("width") || "") || 140,
              height: parseFloat(el.style.height) || parseFloat(el.getAttribute("height") || "") || 60,
              left: parseFloat(el.style.left) || 0,
              top: parseFloat(el.style.top) || 0,
              kind: el.getAttribute("data-sig-kind") || "stamp",
            }
          },
        },
      ],
      toDOM(node) {
        const { src, width, height, left, top, kind } = node.attrs
        return [
          "img",
          {
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
          },
        ]
      },
    },
  },

  marks: {
    strong: {
      parseDOM: [
        { tag: "strong" },
        { tag: "b" },
        { style: "font-weight", getAttrs: (v) => (/^(bold|[6-9]\d\d)$/.test(v as string) ? null : false) },
      ],
      toDOM() {
        return ["strong", 0]
      },
    },
    em: {
      parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
      toDOM() {
        return ["em", 0]
      },
    },
    underline: {
      parseDOM: [{ tag: "u" }, { style: "text-decoration=underline" }],
      toDOM() {
        return ["u", 0]
      },
    },
    fontFamily: {
      attrs: { family: {} },
      parseDOM: [
        {
          style: "font-family",
          getAttrs: (v) => ({ family: (v as string).split(",")[0].trim().replace(/^['"]|['"]$/g, "") }),
        },
      ],
      toDOM(mark) {
        return ["span", { style: `font-family:${mark.attrs.family}` }, 0]
      },
    },
  },
})
