/** CSS absolute lengths converted to the editor's 96dpi pixel coordinate system. */
export function cssLengthToPx(value: unknown): number | null {
  if (value === "" || value == null) return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null

  const match = String(value).trim().match(/^(-?[\d.]+)\s*(px|pt|pc|in|cm|mm|q)?$/i)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null

  switch ((match[2] || "px").toLowerCase()) {
    case "pt": return amount * 96 / 72
    case "pc": return amount * 16
    case "in": return amount * 96
    case "cm": return amount * 96 / 2.54
    case "mm": return amount * 96 / 25.4
    case "q": return amount * 96 / 101.6
    default: return amount
  }
}

/** Keeps enough precision for Word's half-point and twentieth-point measurements. */
export function pxCss(value: unknown): string | null {
  const px = cssLengthToPx(value)
  if (px == null) return null
  return `${Number(px.toFixed(3))}px`
}
