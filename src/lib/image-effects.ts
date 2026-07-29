// Browser-only image processing for report images: downscaling on insert, and
// the "Glow Edges" artistic effect (background knock-out) the picture toolbar
// exposes.
//
// Everything runs on a <canvas> in the browser. No upload, no external service:
// report images are stored inline in the report body (a base64 data URL, same
// as signature stamps), so the pixels never leave the page they're pasted into.

/** Longest edge an inserted image is downscaled to before it goes in the body. */
const MAX_INSERT_DIM = 1400

/** Longest edge the background remover works at (keeps a 12MP photo responsive). */
const MAX_EFFECT_DIM = 1600

export interface PreparedImage {
  src: string
  /** Natural size of the (possibly downscaled) bitmap, in px. */
  width: number
  height: number
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Could not read that image."))
    img.src = src
  })
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("Could not read that file."))
    reader.readAsDataURL(file)
  })
}

/**
 * Reads a picked/pasted/dropped image file and downscales it for insertion.
 *
 * The whole report body — images included — is saved as one JSON payload, and
 * that payload has already hit the server's size limit once before (see the
 * "signature image is too large" branch in the report editor's save path). A
 * phone camera photo is 3-4000px wide and several MB as base64; at report print
 * size nothing above ~1400px is visible, so it is downscaled here rather than
 * carried around at full resolution for the life of the report.
 *
 * PNGs (and anything with transparency, e.g. an image that has already had its
 * background removed) stay PNG; everything else is re-encoded as JPEG, which is
 * far smaller for photos.
 */
export async function prepareImageFile(file: File): Promise<PreparedImage> {
  const dataUrl = await fileToDataUrl(file)
  const img = await loadImage(dataUrl)
  const natural = { width: img.naturalWidth || 200, height: img.naturalHeight || 150 }

  // SVGs are passed straight through. They're already tiny, they scale better
  // than any raster version of them would, and drawing one to a canvas is the
  // case browsers may treat as tainting it — getImageData would then throw
  // rather than give us pixels to re-encode.
  if (/^image\/svg/i.test(file.type)) return { src: dataUrl, ...natural }

  const scale = Math.min(1, MAX_INSERT_DIM / Math.max(natural.width, natural.height))
  const width = Math.max(1, Math.round(natural.width * scale))
  const height = Math.max(1, Math.round(natural.height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return { src: dataUrl, ...natural }
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(img, 0, 0, width, height)

  // Transparency is decided from the actual pixels, not the file's MIME type: a
  // PNG is usually a fully opaque screenshot or photo, and re-encoding one as
  // PNG saves nothing, while JPEG cuts it to a fraction of the size — which
  // matters because every image travels inside the report's own saved payload.
  let hasAlpha = /^image\/(png|webp|gif)/i.test(file.type)
  try {
    const px = ctx.getImageData(0, 0, width, height).data
    hasAlpha = false
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 250) { hasAlpha = true; break }
    }
  } catch {
    // Reading back can fail on a tainted canvas — keep the MIME-type guess.
  }

  let encoded: string
  if (hasAlpha) {
    encoded = canvas.toDataURL("image/png")
  } else {
    // Re-fill white behind the (opaque) image so a JPEG can't pick up black
    // edges from any stray semi-transparent pixel.
    ctx.globalCompositeOperation = "destination-over"
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
    ctx.globalCompositeOperation = "source-over"
    encoded = canvas.toDataURL("image/jpeg", 0.88)
  }

  // Re-encoding can come out LARGER than the original (a small optimized PNG
  // logo, say) — in which case keep the original bytes, as long as we didn't
  // need to downscale them.
  if (scale === 1 && encoded.length > dataUrl.length) return { src: dataUrl, ...natural }

  return { src: encoded, width, height }
}

/** Default colour tolerance for the background knock-out (0-255 scale). */
export const DEFAULT_BG_TOLERANCE = 42
export const MIN_BG_TOLERANCE = 12
export const MAX_BG_TOLERANCE = 120

/**
 * Knocks the background out of an image and returns a transparent PNG — what
 * the picture toolbar offers as the "Glow Edges" artistic effect, so a scanned
 * stamp, seal, logo or signature can be dropped straight onto the report
 * without its white paper square hiding the text behind it.
 *
 * It's an edge-seeded flood fill, not a "delete every white pixel" pass: pixels
 * are only cleared if they're within `tolerance` of the background colour AND
 * connected to the border. That distinction is the whole point on a medical
 * report — the white *inside* a scan, the paper showing through the middle of a
 * seal, the gaps inside letters of a logo all stay put, while the surrounding
 * page is removed.
 *
 * Edge pixels that only partly match are made partly transparent (rather than
 * kept or cleared outright), which is what stops the knocked-out shape from
 * showing the hard white fringe a plain threshold leaves behind.
 */
export async function removeImageBackground(
  src: string,
  tolerance: number = DEFAULT_BG_TOLERANCE
): Promise<string> {
  const img = await loadImage(src)
  const scale = Math.min(1, MAX_EFFECT_DIM / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return src
  ctx.drawImage(img, 0, 0, w, h)

  const image = ctx.getImageData(0, 0, w, h)
  if (!knockOutBackground(image.data, w, h, tolerance)) return src
  ctx.putImageData(image, 0, 0)

  return canvas.toDataURL("image/png")
}

/**
 * The pixel half of removeImageBackground, split out from the canvas plumbing so
 * it can be exercised on a synthetic bitmap without a browser: rewrites `px`
 * (RGBA, row-major) in place and reports whether it found a background at all.
 */
export function knockOutBackground(
  px: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  tolerance: number = DEFAULT_BG_TOLERANCE
): boolean {
  // ── Background colour: the most common colour along the border ──────────────
  // Averaging the border instead would produce a colour that may not exist in
  // the image at all (a white page with a dark stripe down one side averages to
  // grey, and then nothing matches). A coarse 32-level histogram is enough to
  // find "the paper colour" while ignoring scanner noise.
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>()
  const sampleBorder = (x: number, y: number) => {
    const i = (y * w + x) * 4
    if (px[i + 3] < 8) return                    // already transparent
    const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3)
    const bin = bins.get(key)
    if (bin) { bin.count++; bin.r += px[i]; bin.g += px[i + 1]; bin.b += px[i + 2] }
    else bins.set(key, { count: 1, r: px[i], g: px[i + 1], b: px[i + 2] })
  }
  for (let x = 0; x < w; x++) { sampleBorder(x, 0); sampleBorder(x, h - 1) }
  for (let y = 0; y < h; y++) { sampleBorder(0, y); sampleBorder(w - 1, y) }

  let best: { count: number; r: number; g: number; b: number } | undefined
  bins.forEach((bin) => { if (!best || bin.count > best.count) best = bin })
  if (!best) return false
  const bgR = best.r / best.count
  const bgG = best.g / best.count
  const bgB = best.b / best.count

  // Squared distances — comparing squares avoids a sqrt per pixel.
  const tol = Math.max(MIN_BG_TOLERANCE, Math.min(MAX_BG_TOLERANCE, tolerance))
  const hardTol2 = tol * tol * 3          // fully background
  const softTol2 = (tol * 1.8) * (tol * 1.8) * 3  // partly background → partial alpha

  const dist2 = (i: number) => {
    const dr = px[i] - bgR
    const dg = px[i + 1] - bgG
    const db = px[i + 2] - bgB
    return dr * dr + dg * dg + db * db
  }

  // ── Flood fill inward from every border pixel ───────────────────────────────
  // Explicit stack rather than recursion: a full-page background is hundreds of
  // thousands of pixels deep and would blow the call stack.
  const CLEARED = 1, SOFT = 2
  const state = new Uint8Array(w * h)
  const stack: number[] = []
  const push = (p: number) => {
    if (state[p]) return
    const i = p * 4
    const d = dist2(i)
    if (d <= hardTol2) { state[p] = CLEARED; stack.push(p) }
    else if (d <= softTol2) { state[p] = SOFT }   // boundary: feathered, not walked through
  }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }

  while (stack.length) {
    const p = stack.pop() as number
    const x = p % w
    const y = (p - x) / w
    if (x > 0) push(p - 1)
    if (x < w - 1) push(p + 1)
    if (y > 0) push(p - w)
    if (y < h - 1) push(p + w)
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  // Cleared pixels go fully transparent; the feathered boundary ring fades
  // between the two tolerances so the remaining shape keeps a soft edge instead
  // of a jagged one, and its colour is left alone (de-fringing a 1px ring is
  // not worth the extra pass — the fade already hides the paper tint).
  const softSpan = softTol2 - hardTol2 || 1
  for (let p = 0; p < state.length; p++) {
    const i = p * 4
    if (state[p] === CLEARED) {
      px[i + 3] = 0
    } else if (state[p] === SOFT) {
      const t = (dist2(i) - hardTol2) / softSpan          // 0 at the cleared side, 1 at fully-kept
      px[i + 3] = Math.round(px[i + 3] * Math.max(0, Math.min(1, t)))
    }
  }

  return true
}
