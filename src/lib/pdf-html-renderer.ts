// Browser-only: renders HTML (any structure) with inline bold into a jsPDF document

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderHtmlToPdf(doc: any, html: string, M: number, CW: number, startY: number, checkPage: (n: number) => void, lineH: number): number {
  let y = startY
  if (!html?.trim()) return y

  type Run = { text: string; bold: boolean }
  const BLOCK = new Set(["p","div","li","h1","h2","h3","h4","h5","h6","blockquote","pre","ul","ol"])

  // Collect text runs from any node, tracking bold through strong/b/style
  function getRuns(node: Node, bold: boolean): Run[] {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").replace(/\r?\n/g, " ")
      return t ? [{ text: t, bold }] : []
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === "br") return [{ text: "\n", bold: false }]
    const inlineStyle = (el.getAttribute("style") ?? "").replace(/\s/g, "")
    const isBold = bold || tag === "strong" || tag === "b"
      || inlineStyle.includes("font-weight:bold") || inlineStyle.includes("font-weight:700")
    return Array.from(el.childNodes).flatMap(c => getRuns(c, isBold))
  }

  function spaceW(): number {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10)
    return doc.getTextWidth(" ")
  }

  // Render a list of runs as word-wrapped lines
  function renderRuns(runs: Run[]) {
    type Token = { word: string; bold: boolean; br: boolean }
    const tokens: Token[] = []

    for (const run of runs) {
      if (run.text === "\n") { tokens.push({ word: "\n", bold: false, br: true }); continue }
      for (const part of run.text.split(/(\s+)/)) {
        if (!part) continue
        tokens.push(/^\s+$/.test(part)
          ? { word: " ", bold: false, br: false }
          : { word: part, bold: run.bold, br: false })
      }
    }

    let line: Token[] = [], lineW = 0

    const flush = () => {
      while (line.length && line[line.length - 1].word === " ") line.pop()
      if (!line.length) return
      checkPage(lineH)
      doc.setFontSize(10); doc.setTextColor(50)
      let x = M
      for (const tok of line) {
        if (tok.word === " ") { x += spaceW(); continue }
        doc.setFont("helvetica", tok.bold ? "bold" : "normal")
        doc.text(tok.word, x, y)
        x += doc.getTextWidth(tok.word)
      }
      y += lineH; line = []; lineW = 0
    }

    for (const tok of tokens) {
      if (tok.br) { flush(); continue }
      if (tok.word === " ") {
        if (line.length && line[line.length - 1].word !== " ") { line.push(tok); lineW += spaceW() }
        continue
      }
      doc.setFont("helvetica", tok.bold ? "bold" : "normal"); doc.setFontSize(10)
      const ww = doc.getTextWidth(tok.word)
      if (lineW + ww > CW && line.some(t => t.word !== " ")) flush()
      line.push(tok); lineW += ww
    }
    flush()
  }

  const body = new DOMParser().parseFromString(html, "text/html").body

  // Accumulates inline/text runs at the top level between block elements
  let pending: Run[] = []
  const flushPending = () => {
    if (pending.some(r => r.text.trim())) { renderRuns(pending); y += 2 }
    pending = []
  }

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").replace(/\r?\n/g, " ")
      if (t.trim()) pending.push({ text: t, bold: false })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()

    if (tag === "br") {
      // Treat <br> as a paragraph separator
      flushPending()
      return
    }

    if (BLOCK.has(tag)) {
      flushPending()
      const runs = Array.from(el.childNodes).flatMap(c => getRuns(c, false))
      if (runs.some(r => r.text.trim())) { renderRuns(runs); y += 2 }
      return
    }

    // Inline element — collect runs into pending buffer
    pending.push(...getRuns(el, false))
  }

  for (const child of Array.from(body.childNodes)) walk(child)
  flushPending()

  return y
}

export function pdfSlug(name: string, id: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return `${slug}-${id}`
}
