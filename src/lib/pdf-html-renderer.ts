// Browser-only: renders HTML with inline bold/normal into a jsPDF document

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function renderHtmlToPdf(doc: any, html: string, M: number, CW: number, startY: number, checkPage: (n: number) => void, lineH: number): number {
  let y = startY

  type Run = { text: string; bold: boolean }

  function getRunsFromNode(node: Node, parentBold: boolean): Run[] {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent ?? "").replace(/[\r\n]+/g, " ")
      return t ? [{ text: t, bold: parentBold }] : []
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return []
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === "br") return [{ text: "\n", bold: false }]
    const isBold = parentBold || tag === "strong" || tag === "b"
    return Array.from(el.childNodes).flatMap(c => getRunsFromNode(c, isBold))
  }

  function spaceW(): number {
    doc.setFont("helvetica", "normal"); doc.setFontSize(10)
    return doc.getTextWidth(" ")
  }

  function measureWord(word: string, bold: boolean): number {
    doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(10)
    return doc.getTextWidth(word)
  }

  function renderRuns(runs: Run[]) {
    type Token = { word: string; bold: boolean; isBreak: boolean }
    const tokens: Token[] = []

    for (const run of runs) {
      if (run.text === "\n") { tokens.push({ word: "\n", bold: false, isBreak: true }); continue }
      for (const part of run.text.split(/(\s+)/)) {
        if (!part) continue
        tokens.push(/^\s+$/.test(part)
          ? { word: " ", bold: false, isBreak: false }
          : { word: part, bold: run.bold, isBreak: false })
      }
    }

    let lineTokens: Token[] = []
    let lineW = 0

    const flushLine = () => {
      while (lineTokens.length && lineTokens[lineTokens.length - 1].word === " ") lineTokens.pop()
      if (!lineTokens.length) return
      checkPage(lineH)
      doc.setFontSize(10); doc.setTextColor(50)
      let x = M
      for (const tok of lineTokens) {
        if (tok.word === " ") { x += spaceW(); continue }
        doc.setFont("helvetica", tok.bold ? "bold" : "normal")
        doc.text(tok.word, x, y)
        x += doc.getTextWidth(tok.word)
      }
      y += lineH; lineTokens = []; lineW = 0
    }

    for (const tok of tokens) {
      if (tok.isBreak) { flushLine(); continue }
      if (tok.word === " ") {
        if (lineTokens.length && lineTokens[lineTokens.length - 1].word !== " ") {
          lineTokens.push(tok); lineW += spaceW()
        }
        continue
      }
      const ww = measureWord(tok.word, tok.bold)
      if (lineW + ww > CW && lineTokens.some(t => t.word !== " ")) flushLine()
      lineTokens.push(tok); lineW += ww
    }
    while (lineTokens.length && lineTokens[lineTokens.length - 1].word === " ") lineTokens.pop()
    flushLine()
  }

  function walkNode(node: Node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element
      const tag = el.tagName.toLowerCase()
      if (["p", "div", "li", "h1", "h2", "h3", "h4"].includes(tag)) {
        const runs = Array.from(el.childNodes).flatMap(c => getRunsFromNode(c, false))
        if (runs.some(r => r.text.trim())) { renderRuns(runs); y += 2 }
        return
      }
    }
    for (const child of Array.from(node.childNodes ?? [])) walkNode(child)
  }

  for (const child of Array.from(new DOMParser().parseFromString(html, "text/html").body.childNodes))
    walkNode(child)

  return y
}

export function pdfSlug(name: string, id: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return `${slug}-${id}`
}
