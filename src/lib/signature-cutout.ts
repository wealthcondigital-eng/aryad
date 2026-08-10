// Turn a scan or a phone photo of a pen signature into a transparent PNG.
//
// Doctors sign a blank sheet and photograph it, so what arrives is dark ink on
// paper that is never actually white — it is grey in the corners, warm under a
// desk lamp, and often has the shadow of the phone across one side. Uploading
// that as-is drops an opaque rectangle onto the report, which shows against the
// letterhead and covers whatever it overlaps.
//
// So the paper is measured rather than assumed: the background is estimated
// per-region and each pixel's alpha comes from how much darker it is than the
// paper *next to it*, which survives shadows and uneven lighting that a single
// global threshold does not. Partial alpha along the stroke edges keeps the
// signature anti-aliased instead of jagged.

const MAX_DIM = 1000        // signatures print ~220px wide; 1000 is already generous
const CELL = 32             // paper is sampled per 32px cell, then interpolated
const INK_LOW = 0.10        // below this much darker than paper → paper (noise, JPEG mush)
const INK_HIGH = 0.35       // at/above this → solid ink
const TRIM_PAD = 4          // px of paper left around the ink after cropping
const MAX_BYTES = 600_000   // the PNG is stored base64 in Mongo alongside the report

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Paper brightness and colour for every cell of the image.
 *
 * A cell's paper is its 85th-percentile luminance — bright enough to ignore the
 * ink crossing it, low enough to ignore a stray specular highlight. A cell that
 * a thick stroke covers completely has no paper of its own, so a dilation pass
 * lets it borrow the brightest value around it; that is what stops a hole from
 * opening in the middle of a heavy downstroke.
 */
function estimatePaper(data: Uint8ClampedArray, w: number, h: number, cols: number, rows: number) {
  const paperL = new Float32Array(cols * rows)
  const paperR = new Float32Array(cols * rows)
  const paperG = new Float32Array(cols * rows)
  const paperB = new Float32Array(cols * rows)
  const samples: number[] = []

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * CELL, x1 = Math.min(w, x0 + CELL)
      const y0 = cy * CELL, y1 = Math.min(h, y0 + CELL)
      samples.length = 0
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * w + x) * 4
          samples.push(luminance(data[i], data[i + 1], data[i + 2]))
        }
      }
      if (!samples.length) { paperL[cy * cols + cx] = 255; continue }
      samples.sort((a, b) => a - b)
      paperL[cy * cols + cx] = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.85))]
    }
  }

  // Dilate: a cell takes the brightest paper in its 3×3 neighbourhood.
  const dilated = new Float32Array(paperL)
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let best = paperL[cy * cols + cx]
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
          best = Math.max(best, paperL[ny * cols + nx])
        }
      }
      dilated[cy * cols + cx] = best
    }
  }

  // Average the colour of the pixels that ARE paper in each cell, so blue ink
  // on cream paper is unmixed against cream rather than against white.
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx
      const cut = dilated[c] * 0.94
      const x0 = cx * CELL, x1 = Math.min(w, x0 + CELL)
      const y0 = cy * CELL, y1 = Math.min(h, y0 + CELL)
      let r = 0, g = 0, b = 0, n = 0
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * w + x) * 4
          if (luminance(data[i], data[i + 1], data[i + 2]) < cut) continue
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
        }
      }
      if (n) { paperR[c] = r / n; paperG[c] = g / n; paperB[c] = b / n }
      else { paperR[c] = paperG[c] = paperB[c] = dilated[c] }
    }
  }

  return { paperL: dilated, paperR, paperG, paperB }
}

/** Bilinear read of a per-cell field at pixel (x, y), sampling cell centres. */
function sampleField(field: Float32Array, x: number, y: number, cols: number, rows: number): number {
  const fx = Math.min(cols - 1, Math.max(0, (x - CELL / 2) / CELL))
  const fy = Math.min(rows - 1, Math.max(0, (y - CELL / 2) / CELL))
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1)
  const tx = fx - x0, ty = fy - y0
  const top = field[y0 * cols + x0] * (1 - tx) + field[y0 * cols + x1] * tx
  const bot = field[y1 * cols + x0] * (1 - tx) + field[y1 * cols + x1] * tx
  return top * (1 - ty) + bot * ty
}

/** Crop away the empty paper around the ink and export a PNG under MAX_BYTES. */
function exportTrimmed(source: HTMLCanvasElement): string {
  const w = source.width, h = source.height
  const ctx = source.getContext("2d", { willReadFrequently: true })
  if (!ctx) return source.toDataURL("image/png")
  const { data } = ctx.getImageData(0, 0, w, h)

  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] <= 12) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return source.toDataURL("image/png")   // nothing left — caller falls back

  minX = Math.max(0, minX - TRIM_PAD); minY = Math.max(0, minY - TRIM_PAD)
  maxX = Math.min(w - 1, maxX + TRIM_PAD); maxY = Math.min(h - 1, maxY + TRIM_PAD)

  let cw = maxX - minX + 1, ch = maxY - minY + 1
  let out = document.createElement("canvas")
  out.width = cw; out.height = ch
  out.getContext("2d")?.drawImage(source, minX, minY, cw, ch, 0, 0, cw, ch)

  // A trimmed signature is usually well under the cap; a full-page scan of a
  // dense stamp can still overshoot it, so step the resolution down until it
  // fits rather than sending a multi-megabyte string to the API.
  let dataUrl = out.toDataURL("image/png")
  while (dataUrl.length > MAX_BYTES && cw > 300) {
    cw = Math.round(cw * 0.75); ch = Math.round(ch * 0.75)
    const smaller = document.createElement("canvas")
    smaller.width = cw; smaller.height = ch
    const sctx = smaller.getContext("2d")
    if (!sctx) break
    sctx.imageSmoothingQuality = "high"
    sctx.drawImage(out, 0, 0, cw, ch)
    out = smaller
    dataUrl = out.toDataURL("image/png")
  }
  return dataUrl
}

/**
 * Remove the paper behind a signature and return a transparent, trimmed PNG.
 *
 * Never throws and never returns something worse than what it was given: if the
 * image already has transparency (someone uploaded a proper cutout), if nothing
 * reads as ink, or if more than half the image does, the original is returned
 * untouched — those are the cases where "removing the background" would mean
 * erasing the signature or leaving it unchanged anyway.
 */
export async function cutOutSignature(src: string, maxDim = MAX_DIM): Promise<string> {
  try {
    const img = await loadImage(src)
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))

    const canvas = document.createElement("canvas")
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return src
    ctx.drawImage(img, 0, 0, w, h)

    const image = ctx.getImageData(0, 0, w, h)
    const data = image.data
    const total = w * h

    // Already a cutout (a PNG someone prepared elsewhere) — only crop it.
    let seen = 0, transparent = 0
    for (let i = 3; i < data.length; i += 4 * 7) { seen++; if (data[i] < 250) transparent++ }
    if (seen && transparent / seen > 0.02) return exportTrimmed(canvas)

    const cols = Math.max(1, Math.ceil(w / CELL))
    const rows = Math.max(1, Math.ceil(h / CELL))
    const { paperL, paperR, paperG, paperB } = estimatePaper(data, w, h, cols, rows)

    let ink = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const paper = Math.max(1, sampleField(paperL, x, y, cols, rows))
        const darker = 1 - luminance(data[i], data[i + 1], data[i + 2]) / paper
        let a = (darker - INK_LOW) / (INK_HIGH - INK_LOW)
        a = a <= 0 ? 0 : a >= 1 ? 1 : a
        if (a >= 0.5) ink++

        if (a <= 0) { data[i + 3] = 0; continue }
        if (a < 1) {
          // What the camera saw is the ink laid over the paper: recover the ink
          // itself so half-covered edge pixels don't keep a pale paper-coloured
          // halo once the paper behind them is gone.
          const pr = sampleField(paperR, x, y, cols, rows)
          const pg = sampleField(paperG, x, y, cols, rows)
          const pb = sampleField(paperB, x, y, cols, rows)
          data[i] = Math.max(0, Math.min(255, (data[i] - (1 - a) * pr) / a))
          data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - (1 - a) * pg) / a))
          data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - (1 - a) * pb) / a))
        }
        data[i + 3] = Math.round(a * 255)
      }
    }

    // Nothing found, or the "background" was most of the picture — either way
    // this isn't ink on paper and the doctor is better served by their own file.
    if (ink === 0 || ink > total * 0.55) return src

    ctx.putImageData(image, 0, 0)
    return exportTrimmed(canvas)
  } catch {
    return src
  }
}
