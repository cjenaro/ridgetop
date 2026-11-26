export type SpriteOutlineMode = '4-way' | '8-way' | 'selout'

export interface SpriteOutlineOptions {
  readonly mode?: SpriteOutlineMode
  readonly palette?: readonly string[] | Readonly<Record<string, string | null>>
  /** Pixels with alpha <= this threshold are treated as transparent exterior (default `0`). */
  readonly emptyAlphaThreshold?: number
}

export interface SpriteFrame {
  readonly width: number
  readonly height: number
  rect(x: number, y: number, width: number, height: number, color: string): void
  polygon(points: readonly (readonly [number, number])[], color: string): void
  /** Set a single pixel (clipped cleanly to cell bounds). Pass `null` or `''` to erase to transparent. Supports `#rrggbb` or `#rrggbbaa`. */
  pixel(x: number, y: number, color: string | null): void
  /** Read a cell pixel as lowercase `#rrggbb`, or `null` if transparent or out of bounds. */
  getPixel(x: number, y: number): string | null
  /** Draw a pixel-perfect Bresenham line clipped cleanly to cell bounds. */
  line(x0: number, y0: number, x1: number, y1: number, color: string | null): void
  /** Draw a filled integer pixel ellipse clipped cleanly to cell bounds. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: string | null): void
  /** Draw a filled integer pixel circle clipped cleanly to cell bounds. */
  circle(cx: number, cy: number, radius: number, color: string | null): void
  /** Paint an exact ASCII pixel grid mapped through `palette` (`.` and `' '` stay transparent; clips cleanly to cell bounds). */
  stamp(x: number, y: number, rows: readonly string[], palette: Readonly<Record<string, string | null>>): void
  /** Mirror the left half of the cell horizontally onto the right half around `axisX` (defaults to cell center). */
  mirrorX(axisX?: number): void
  /** Copy opaque pixels from another cell in this sheet with optional `(dx, dy)` pixel shift. */
  copyFrom(column: number, row?: number, dx?: number, dy?: number): void
  /** Composite an RGBA pixel buffer into this cell at optional `(dx, dy)` pixel offset with alpha blending and bounds clipping. */
  blit(source: Uint8ClampedArray | Uint8Array, sourceWidth: number, sourceHeight: number, dx?: number, dy?: number): void
  /** Draw an airy, orphan-free 3×3 or 5×5 cross-star glint sparkle (recommended after `outline()`). */
  glint(cx: number, cy: number, coreColor: string, armColor?: string, size?: 3 | 5): void
  /**
   * Add a crisp 1px exterior outline around existing opaque pixels without overwriting interior art.
   * Pass a 6- or 8-digit hex color with `'4-way'` or `'8-way'`, OR pass `'selout'` for automatic
   * directional hue-shifted selective outlines. Pass `{ palette }` to snap selout colors onto
   * existing dark palette shades (zero palette bloat!).
   */
  outline(colorOrSelout: string, modeOrOptions?: SpriteOutlineMode | SpriteOutlineOptions): void
}

export interface HueRamp {
  readonly ink: string
  readonly dark: string
  readonly shade: string
  readonly mid: string
  readonly light: string
  readonly highlight: string
}

export interface SpriteAuditReport {
  readonly passed: boolean
  readonly frames: number
  readonly frameWidth: number
  readonly frameHeight: number
  readonly uniqueColors: number
  readonly orphans: number
  readonly edgeTouches: number
  readonly fillRatio: number
  readonly lumRange: number
  readonly footDriftPx: number
  readonly frameDeltaPx: number
  readonly warnings: string[]
}

const channelPack = new Uint8ClampedArray(4)
const wordPack = new Uint32Array(channelPack.buffer)

/** Parse `#rrggbb`, `#rrggbbaa` (or `#rgb` when `allowShort` is true) into `[r, g, b, a]` bytes (0–255). */
export function parseHexRgba(color: string, allowShort = false): [number, number, number, number] {
  if (typeof color !== 'string') throw new RangeError('Expected a six-digit RGB color')
  const raw = color.charCodeAt(0) === 35 ? color.slice(1) : color
  if (/^[0-9a-f]{6}$/i.test(raw)) {
    const n = Number.parseInt(raw, 16)
    return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255, 255]
  }
  if (/^[0-9a-f]{8}$/i.test(raw)) {
    const n = Number.parseInt(raw, 16) >>> 0
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
  }
  if (allowShort && /^[0-9a-f]{3}$/i.test(raw)) {
    const n = Number.parseInt(raw, 16)
    const r = (n >>> 8) & 15, g = (n >>> 4) & 15, b = n & 15
    return [(r << 4) | r, (g << 4) | g, (b << 4) | b, 255]
  }
  throw new RangeError('Expected a six-digit RGB color')
}

function packColor(color: string) {
  if (typeof color !== 'string' || !/^#?[0-9a-f]{6}$/i.test(color)) {
    throw new RangeError('Expected a six-digit RGB color')
  }
  const [r, g, b] = parseHexRgba(color)
  channelPack[0] = r
  channelPack[1] = g
  channelPack[2] = b
  channelPack[3] = 255
  return wordPack[0]
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360
  const sn = Math.max(0, Math.min(1, s))
  const ln = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = ln - c / 2
  let r = 0, g = 0, b = 0
  if (hn < 60) [r, g, b] = [c, x, 0]
  else if (hn < 120) [r, g, b] = [x, c, 0]
  else if (hn < 180) [r, g, b] = [0, c, x]
  else if (hn < 240) [r, g, b] = [0, x, c]
  else if (hn < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

function shiftTowardHue(h: number, target: number, amount: number): number {
  let diff = ((target - h + 540) % 360) - 180
  return (h + diff * amount + 360) % 360
}

/** Generate a cohesive indie pixel-art color ramp with perceptually natural cool shadows and warm highlights. */
export function hueShiftRamp(baseHex: string, { shadowHue, highlightHue = 48 }: { shadowHue?: number; highlightHue?: number } = {}): HueRamp {
  const [r, g, b] = parseHexRgba(baseHex)
  const [h, s, l] = rgbToHsl(r, g, b)
  // Warm reds/oranges/browns shift naturally toward deep crimson-umber (342 deg) instead of wrapping into neon magenta.
  const isWarmEarth = (h < 56 || h >= 332) && s > 0.14
  const resolvedShadowHue = shadowHue ?? (isWarmEarth ? 342 : h < 170 ? 222 : 242)
  const shadowPull = shadowHue !== undefined ? 1 : (isWarmEarth ? 0.65 : 1)
  const step = (targetHue: number, hAmt: number, dL: number, sMul: number) => {
    const nextHue = s < 0.02 ? targetHue : shiftTowardHue(h, targetHue, hAmt)
    const rawL = l + dL
    const nextL = dL < 0
      ? Math.max(Math.min(0.06, l), Math.min(l, rawL))
      : Math.min(Math.max(0.95, l), Math.max(l, rawL))
    const [cr, cg, cb] = hslToRgb(nextHue, Math.min(1, s * sMul + (s < 0.08 ? 0.04 : 0)), nextL)
    return toHex(cr, cg, cb)
  }
  return {
    ink: step(resolvedShadowHue, 0.50 * shadowPull, -l * 0.72, 1.06),
    dark: step(resolvedShadowHue, 0.34 * shadowPull, -0.24, 1.06),
    shade: step(resolvedShadowHue, 0.18 * shadowPull, -0.12, 1.03),
    mid: toHex(r, g, b),
    light: step(highlightHue, 0.22, +0.14, 0.96),
    highlight: step(highlightHue, 0.40, +0.28, 0.86)
  }
}

/** Wrap an RGBA pixel buffer into a browser `HTMLCanvasElement`. */
export function canvasFromRgbaPixels(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  errorMessage = 'Could not create the sprite sheet'
): HTMLCanvasElement {
  const image = document.createElement('canvas')
  image.width = width
  image.height = height
  const context = image.getContext('2d')
  if (!context) throw new Error(errorMessage)
  context.putImageData(new ImageData(pixels, width, height), 0, 0)
  return image
}

/**
 * Add a crisp 1px exterior outline around opaque pixels inside the `(x0, y0, regionWidth, regionHeight)`
 * sub-rectangle of an RGBA buffer of pixel stride `stride`, without overwriting interior pixels or bleeding
 * outside the region. Supports 6- or 8-digit hex colors (`'4-way'` / `'8-way'`) and hue-shifted `'selout'`
 * with optional palette snapping.
 */
export function outlinePixelRegion(
  pixels: Uint8ClampedArray,
  stride: number,
  x0: number,
  y0: number,
  regionWidth: number,
  regionHeight: number,
  colorOrSelout: string,
  modeOrOptions?: SpriteOutlineMode | SpriteOutlineOptions,
  scratch?: Uint8ClampedArray
): void {
  if (
    !Number.isSafeInteger(stride) || stride <= 0 ||
    !Number.isSafeInteger(x0) || x0 < 0 ||
    !Number.isSafeInteger(y0) || y0 < 0 ||
    !Number.isSafeInteger(regionWidth) || regionWidth <= 0 ||
    !Number.isSafeInteger(regionHeight) || regionHeight <= 0 ||
    x0 + regionWidth > stride ||
    ((y0 + regionHeight - 1) * stride + x0 + regionWidth) * 4 > pixels.length
  ) {
    throw new RangeError('outlinePixelRegion requires valid positive integer region bounds within the pixel buffer')
  }
  const opts = typeof modeOrOptions === 'object' && modeOrOptions !== null ? modeOrOptions : { mode: modeOrOptions }
  const mode = opts.mode
  const emptyAlphaThreshold = opts.emptyAlphaThreshold ?? 0
  const isSelout = colorOrSelout === 'selout' || mode === 'selout'
  const use8 = mode === '8-way'
  const fixed = isSelout ? null : parseHexRgba(colorOrSelout)
  const baseInk = isSelout && colorOrSelout !== 'selout' ? parseHexRgba(colorOrSelout) : [20, 28, 42, 255]
  let snapColors: [number, number, number][] | null = null
  if (isSelout && opts.palette) {
    const rawList = Array.isArray(opts.palette) ? opts.palette : Object.values(opts.palette)
    const parsed: [number, number, number][] = []
    for (const hex of rawList) {
      if (typeof hex !== 'string' || !hex) continue
      const [pr, pg, pb, pa] = parseHexRgba(hex)
      if (pa > 200) parsed.push([pr, pg, pb])
    }
    if (parsed.length) snapColors = parsed
  }
  const regionBytes = regionWidth * regionHeight * 4
  const snap = scratch && scratch.length >= regionBytes ? scratch : new Uint8ClampedArray(regionBytes)
  const rowBytes = regionWidth * 4
  for (let py = 0; py < regionHeight; py++) {
    const rowStart = ((y0 + py) * stride + x0) * 4
    snap.set(pixels.subarray(rowStart, rowStart + rowBytes), py * rowBytes)
  }
  const offsets = use8
    ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
    : [[-1, 0], [1, 0], [0, -1], [0, 1]]
  for (let py = 0; py < regionHeight; py++) {
    for (let px = 0; px < regionWidth; px++) {
      const si = (py * regionWidth + px) * 4
      if (snap[si + 3] > emptyAlphaThreshold) continue
      let nr = 0, ng = 0, nb = 0, hits = 0, topLeftBias = 0
      for (const [ox, oy] of offsets) {
        const nx = px + ox, ny = py + oy
        if (nx < 0 || nx >= regionWidth || ny < 0 || ny >= regionHeight) continue
        const ni = (ny * regionWidth + nx) * 4
        if (snap[ni + 3] > 128) {
          nr += snap[ni]; ng += snap[ni + 1]; nb += snap[ni + 2]; hits++
          if (oy > 0 || ox > 0) topLeftBias++
        }
      }
      if (!hits) continue
      const di = ((y0 + py) * stride + x0 + px) * 4
      if (fixed) {
        pixels[di] = fixed[0]; pixels[di + 1] = fixed[1]; pixels[di + 2] = fixed[2]; pixels[di + 3] = fixed[3]
      } else {
        const ar = nr / hits, ag = ng / hits, ab = nb / hits
        const [h, s, l] = rgbToHsl(ar, ag, ab)
        const litEdge = topLeftBias > 0
        const darkL = litEdge ? Math.max(0.14, l * 0.48) : Math.max(0.08, l * 0.24)
        const [or, og, ob] = hslToRgb(shiftTowardHue(h, 232, litEdge ? 0.30 : 0.55), Math.min(0.85, s * 1.05 + 0.08), darkL)
        const mix = litEdge ? 0.25 : 0.60
        let tr = Math.round(or * (1 - mix) + baseInk[0] * mix)
        let tg = Math.round(og * (1 - mix) + baseInk[1] * mix)
        let tb = Math.round(ob * (1 - mix) + baseInk[2] * mix)
        if (snapColors) {
          let bestD = Infinity, best = snapColors[0]
          for (let ci = 0; ci < snapColors.length; ci++) {
            const c = snapColors[ci]
            const cLum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
            if (cLum > (litEdge ? 145 : 75)) continue
            const dr = c[0] - tr, dg = c[1] - tg, db = c[2] - tb
            const d = dr * dr + dg * dg + db * db
            if (d < bestD) { bestD = d; best = c }
          }
          if (bestD === Infinity) {
            let minLum = Infinity
            for (let ci = 0; ci < snapColors.length; ci++) {
              const c = snapColors[ci]
              const cLum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
              if (cLum < minLum) { minLum = cLum; best = c }
            }
          }
          tr = best[0]; tg = best[1]; tb = best[2]
        }
        pixels[di] = tr; pixels[di + 1] = tg; pixels[di + 2] = tb; pixels[di + 3] = 255
      }
    }
  }
}

/** A transparent RGBA sheet. Drawing coordinates are local to the selected cell. */
export function createSpriteSheet(frameWidth: number, frameHeight: number, columns: number, rows = 1) {
  if (![frameWidth, frameHeight, columns, rows].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new RangeError('Sprite dimensions and grid sizes must be positive integers')
  }
  const width = frameWidth * columns
  const height = frameHeight * rows
  const pixels = new Uint8ClampedArray(width * height * 4)
  const words = new Uint32Array(pixels.buffer)

  function frame(column: number, row = 0): SpriteFrame {
    if (!Number.isInteger(column) || column < 0 || column >= columns ||
        !Number.isInteger(row) || row < 0 || row >= rows) throw new RangeError('Cell outside sprite sheet')
    const cellX = column * frameWidth
    const cellY = row * frameHeight
    const origin = cellY * width + cellX

    function span(x: number, end: number, y: number, packed: number) {
      if (x < 0 || end > frameWidth || y < 0 || y >= frameHeight) throw new RangeError('Drawing outside sprite frame')
      if (x >= end) return
      const start = origin + y * width + x
      words.fill(packed, start, start + (end - x))
    }

    function blendPixel(idx: number, r: number, g: number, b: number, a: number) {
      if (a === 255 || pixels[idx + 3] === 0) {
        pixels[idx] = r; pixels[idx + 1] = g; pixels[idx + 2] = b; pixels[idx + 3] = a
      } else if (a > 0) {
        const sa = a / 255, da = pixels[idx + 3] / 255
        const oa = sa + da * (1 - sa)
        pixels[idx] = Math.round((r * sa + pixels[idx] * da * (1 - sa)) / oa)
        pixels[idx + 1] = Math.round((g * sa + pixels[idx + 1] * da * (1 - sa)) / oa)
        pixels[idx + 2] = Math.round((b * sa + pixels[idx + 2] * da * (1 - sa)) / oa)
        pixels[idx + 3] = Math.round(oa * 255)
      }
    }

    function setPixelClipped(px: number, py: number, color: string | null) {
      const ix = Math.round(px), iy = Math.round(py)
      if (!(ix >= 0 && ix < frameWidth && iy >= 0 && iy < frameHeight)) return
      const idx = (origin + iy * width + ix) * 4
      if (!color) {
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = pixels[idx + 3] = 0
        return
      }
      const [r, g, b, a] = parseHexRgba(color)
      blendPixel(idx, r, g, b, a)
    }

    function readPixel(px: number, py: number): string | null {
      const ix = Math.round(px), iy = Math.round(py)
      if (!(ix >= 0 && ix < frameWidth && iy >= 0 && iy < frameHeight)) return null
      const idx = (origin + iy * width + ix) * 4
      if (pixels[idx + 3] === 0) return null
      return toHex(pixels[idx], pixels[idx + 1], pixels[idx + 2])
    }

    function drawEllipse(cx: number, cy: number, rx: number, ry: number, color: string | null) {
      if (!(rx > 0 && ry > 0)) return
      const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(frameWidth - 1, Math.ceil(cx + rx + 1))
      const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(frameHeight - 1, Math.ceil(cy + ry + 1))
      for (let py = y0; py <= y1; py++) {
        const dy = (py + 0.5 - cy) / ry
        for (let px = x0; px <= x1; px++) {
          const dx = (px + 0.5 - cx) / rx
          if (dx * dx + dy * dy <= 1) setPixelClipped(px, py, color)
        }
      }
    }

    return {
      width: frameWidth,
      height: frameHeight,
      rect(x, y, w, h, color) {
        if (![x, y, w, h].every(Number.isSafeInteger) || w < 0 || h < 0 ||
            x < 0 || y < 0 || x + w > frameWidth || y + h > frameHeight) {
          throw new RangeError('Rectangle outside sprite frame')
        }
        const packed = packColor(color)
        for (let py = y; py < y + h; py++) span(x, x + w, py, packed)
      },
      polygon(points, color) {
        const count = points.length
        if (count < 3) throw new RangeError('Expected at least three points within the sprite frame')
        let minY = Infinity
        let maxY = -Infinity
        for (let i = 0; i < count; i++) {
          const pt = points[i]
          const x = pt?.[0], y = pt?.[1]
          if (typeof x !== 'number' || typeof y !== 'number' ||
              !(x >= 0 && x <= frameWidth && y >= 0 && y <= frameHeight)) {
            throw new RangeError('Expected at least three points within the sprite frame')
          }
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
        const packed = packColor(color)
        const top = Math.ceil(minY - .5)
        const bottom = Math.ceil(maxY - .5)
        if (top >= bottom) return
        const edgeY0: number[] = []
        const edgeY1: number[] = []
        const edgeX0: number[] = []
        const edgeInvSlope: number[] = []
        for (let i = 0; i < count; i++) {
          const a = points[i]
          const b = points[i + 1 < count ? i + 1 : 0]
          const ay = a[1], by = b[1]
          if (ay === by) continue
          if (ay < by) {
            edgeY0.push(ay); edgeY1.push(by); edgeX0.push(a[0]); edgeInvSlope.push((b[0] - a[0]) / (by - ay))
          } else {
            edgeY0.push(by); edgeY1.push(ay); edgeX0.push(b[0]); edgeInvSlope.push((a[0] - b[0]) / (ay - by))
          }
        }
        const edgeCount = edgeY0.length
        const cuts: number[] = []
        for (let y = top; y < bottom; y++) {
          cuts.length = 0
          const scan = y + .5
          for (let e = 0; e < edgeCount; e++) {
            const y0 = edgeY0[e]
            if (scan >= y0 && scan < edgeY1[e]) {
              const cx = edgeX0[e] + (scan - y0) * edgeInvSlope[e]
              let pos = cuts.length
              cuts.push(cx)
              while (pos > 0 && cuts[pos - 1] > cx) {
                cuts[pos] = cuts[pos - 1]
                pos--
              }
              cuts[pos] = cx
            }
          }
          for (let i = 0; i + 1 < cuts.length; i += 2) {
            span(Math.ceil(cuts[i] - .5), Math.ceil(cuts[i + 1] - .5), y, packed)
          }
        }
      },
      pixel: setPixelClipped,
      getPixel: readPixel,
      line(x0, y0, x1, y1, color) {
        if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) return
        // Liang-Barsky clip to [-1, frameWidth] x [-1, frameHeight] so huge out-of-bounds spans stay O(max(W, H)).
        const dx0 = x1 - x0, dy0 = y1 - y0
        if (!Number.isFinite(dx0) || !Number.isFinite(dy0)) return
        let t0 = 0, t1 = 1
        const clip = (p: number, q: number) => {
          if (p === 0) return q >= 0
          const r = q / p
          if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r }
          else { if (r < t0) return false; if (r < t1) t1 = r }
          return true
        }
        if (!clip(-dx0, x0 + 1) || !clip(dx0, frameWidth - x0) || !clip(-dy0, y0 + 1) || !clip(dy0, frameHeight - y0)) return
        let ix0 = Math.round(x0 + dx0 * t0), iy0 = Math.round(y0 + dy0 * t0)
        const ix1 = Math.round(x0 + dx0 * t1), iy1 = Math.round(y0 + dy0 * t1)
        if (!Number.isFinite(ix0) || !Number.isFinite(iy0) || !Number.isFinite(ix1) || !Number.isFinite(iy1)) return
        const dx = Math.abs(ix1 - ix0), sx = ix0 < ix1 ? 1 : -1
        const dy = -Math.abs(iy1 - iy0), sy = iy0 < iy1 ? 1 : -1
        let err = dx + dy
        while (true) {
          setPixelClipped(ix0, iy0, color)
          if (ix0 === ix1 && iy0 === iy1) break
          const e2 = 2 * err
          if (e2 >= dy) { err += dy; ix0 += sx }
          if (e2 <= dx) { err += dx; iy0 += sy }
        }
      },
      ellipse: drawEllipse,
      circle(cx, cy, radius, color) { drawEllipse(cx, cy, radius, radius, color) },
      stamp(x, y, rowsGrid, palette) {
        for (let ry = 0; ry < rowsGrid.length; ry++) {
          const line = rowsGrid[ry]
          for (let rx = 0; rx < line.length; rx++) {
            const ch = line[rx]
            if (ch === '.' || ch === ' ') continue
            if (!Object.hasOwn(palette, ch)) throw new RangeError(`Unknown stamp palette key "${ch}"`)
            setPixelClipped(x + rx, y + ry, palette[ch])
          }
        }
      },
      mirrorX(axisX = frameWidth / 2) {
        if (!Number.isFinite(axisX)) return
        const half = Math.max(0, Math.min(frameWidth, Math.floor(axisX)))
        for (let py = 0; py < frameHeight; py++) {
          for (let px = 0; px < half; px++) {
            const mx = Math.round(axisX * 2 - 1 - px)
            if (mx < 0 || mx >= frameWidth) continue
            const src = origin + py * width + px
            const dst = origin + py * width + mx
            words[dst] = words[src]
          }
        }
      },
      copyFrom(srcCol, srcRow = 0, dx = 0, dy = 0) {
        if (!Number.isInteger(srcCol) || srcCol < 0 || srcCol >= columns ||
            !Number.isInteger(srcRow) || srcRow < 0 || srcRow >= rows) {
          throw new RangeError('Source cell outside sprite sheet')
        }
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
        const idxX = Math.round(dx), idxY = Math.round(dy)
        const srcOrigin = srcRow * frameHeight * width + srcCol * frameWidth
        const snap = new Uint8ClampedArray(frameWidth * frameHeight * 4)
        for (let py = 0; py < frameHeight; py++) {
          const sStart = (srcOrigin + py * width) * 4
          snap.set(pixels.subarray(sStart, sStart + frameWidth * 4), py * frameWidth * 4)
        }
        for (let py = 0; py < frameHeight; py++) {
          const ty = py + idxY
          if (ty < 0 || ty >= frameHeight) continue
          for (let px = 0; px < frameWidth; px++) {
            const tx = px + idxX
            if (tx < 0 || tx >= frameWidth) continue
            const si = (py * frameWidth + px) * 4
            if (snap[si + 3] > 0) {
              const di = (origin + ty * width + tx) * 4
              pixels[di] = snap[si]
              pixels[di + 1] = snap[si + 1]
              pixels[di + 2] = snap[si + 2]
              pixels[di + 3] = snap[si + 3]
            }
          }
        }
      },
      blit(source, sourceWidth, sourceHeight, dx = 0, dy = 0) {
        if (!Number.isSafeInteger(sourceWidth) || sourceWidth < 0 ||
            !Number.isSafeInteger(sourceHeight) || sourceHeight < 0 ||
            source.length < sourceWidth * sourceHeight * 4) {
          throw new RangeError('Invalid blit source dimensions')
        }
        if (sourceWidth === 0 || sourceHeight === 0 || !Number.isFinite(dx) || !Number.isFinite(dy)) return
        const ox = Math.round(dx), oy = Math.round(dy)
        const sx0 = Math.max(0, -ox)
        const sy0 = Math.max(0, -oy)
        const sx1 = Math.min(sourceWidth, frameWidth - ox)
        const sy1 = Math.min(sourceHeight, frameHeight - oy)
        if (sx0 >= sx1 || sy0 >= sy1) return
        const src = source.buffer === pixels.buffer ? new Uint8ClampedArray(source) : source
        for (let sy = sy0; sy < sy1; sy++) {
          const dstRow = origin + (sy + oy) * width + ox
          const srcRow = sy * sourceWidth
          for (let sx = sx0; sx < sx1; sx++) {
            const si = (srcRow + sx) * 4
            const a = src[si + 3]
            if (a === 0) continue
            blendPixel((dstRow + sx) * 4, src[si], src[si + 1], src[si + 2], a)
          }
        }
      },
      glint(cx, cy, coreColor, armColor = coreColor, size: 3 | 5 = 3) {
        const ix = Math.round(cx), iy = Math.round(cy)
        setPixelClipped(ix, iy, coreColor)
        setPixelClipped(ix - 1, iy, armColor)
        setPixelClipped(ix + 1, iy, armColor)
        setPixelClipped(ix, iy - 1, armColor)
        setPixelClipped(ix, iy + 1, armColor)
        if (size === 5) {
          setPixelClipped(ix - 2, iy, armColor)
          setPixelClipped(ix + 2, iy, armColor)
          setPixelClipped(ix, iy - 2, armColor)
          setPixelClipped(ix, iy + 2, armColor)
        }
      },
      outline(colorOrSelout, modeOrOptions) {
        outlinePixelRegion(pixels, width, cellX, cellY, frameWidth, frameHeight, colorOrSelout, modeOrOptions)
      }
    }
  }
  return { frameWidth, frameHeight, width, height, pixels, frame }
}

/** Automated pixel-art craft constraint checker (palette count, orphan noise, border margin, silhouette density, animation continuity). */
export function auditSpriteSheet(
  sheet: { frameWidth: number; frameHeight: number; width: number; height: number; pixels: Uint8ClampedArray },
  options: { maxColors?: number; maxFillRatio?: number; allowEdgeTouch?: boolean; maxFootDriftPx?: number; row?: number } = {}
): SpriteAuditReport {
  const { frameWidth: fw, frameHeight: fh, width: W, height: H, pixels } = sheet
  if (!Number.isSafeInteger(fw) || fw <= 0 || !Number.isSafeInteger(fh) || fh <= 0 ||
      !Number.isSafeInteger(W) || W < fw || !Number.isSafeInteger(H) || H < fh ||
      pixels.length < W * H * 4) {
    throw new RangeError('auditSpriteSheet requires valid positive integer sprite sheet dimensions')
  }
  const frames = Math.floor(W / fw)
  const totalRows = Math.floor(H / fh)
  const row = options.row ?? 0
  if (!Number.isInteger(row) || row < 0 || row >= totalRows) {
    throw new RangeError(`Sprite sheet row ${row} is outside 0..${totalRows - 1}`)
  }
  const maxColors = options.maxColors ?? 16
  const maxFillRatio = options.maxFillRatio ?? 0.60
  const allowEdge = options.allowEdgeTouch ?? false

  let totalOrphans = 0, totalEdges = 0, maxFill = 0, minLumRange = Infinity
  let minFootY = Infinity, maxFootY = -Infinity
  const sheetColors = new Set<number>()
  for (let f = 0; f < frames; f++) {
    const x0 = f * fw, y0 = row * fh
    let opaque = 0, lumMin = 255, lumMax = 0, maxY = -1
    const isOp = (px: number, py: number) =>
      px >= 0 && px < fw && py >= 0 && py < fh && pixels[((y0 + py) * W + (x0 + px)) * 4 + 3] > 16
    for (let py = 0; py < fh; py++) {
      for (let px = 0; px < fw; px++) {
        const i = ((y0 + py) * W + (x0 + px)) * 4
        if (!(pixels[i + 3] > 16)) continue
        opaque++
        if (py > maxY) maxY = py
        if (px === 0 || px === fw - 1 || py === 0 || py === fh - 1) totalEdges++
        sheetColors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])
        const lum = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
        if (lum < lumMin) lumMin = lum
        if (lum > lumMax) lumMax = lum
        if (!isOp(px - 1, py) && !isOp(px + 1, py) && !isOp(px, py - 1) && !isOp(px, py + 1)) totalOrphans++
      }
    }
    if (maxY >= 0) {
      if (maxY < minFootY) minFootY = maxY
      if (maxY > maxFootY) maxFootY = maxY
    }
    const fr = +(opaque / (fw * fh)).toFixed(3)
    if (fr > maxFill) maxFill = fr
    const lr = opaque ? Math.round(lumMax - lumMin) : 0
    if (lr < minLumRange) minLumRange = lr
  }
  const uniqueColors = sheetColors.size
  const fillRatio = maxFill
  const lumRange = minLumRange === Infinity ? 0 : minLumRange

  let minDelta = frames >= 2 ? Infinity : 0
  let minPairA = 0, minPairB = 1
  if (frames >= 2) {
    const y0 = row * fh
    const pairs = frames === 2 ? 1 : frames
    for (let f = 0; f < pairs; f++) {
      const fNext = (f + 1) % frames
      let delta = 0
      for (let py = 0; py < fh; py++) {
        for (let px = 0; px < fw; px++) {
          const i0 = ((y0 + py) * W + f * fw + px) * 4
          const i1 = ((y0 + py) * W + fNext * fw + px) * 4
          if (Math.abs(pixels[i0] - pixels[i1]) + Math.abs(pixels[i0 + 1] - pixels[i1 + 1]) +
              Math.abs(pixels[i0 + 2] - pixels[i1 + 2]) + Math.abs(pixels[i0 + 3] - pixels[i1 + 3]) > 16) {
            delta++
          }
        }
      }
      if (delta < minDelta) { minDelta = delta; minPairA = f; minPairB = fNext }
    }
  }
  const frameDeltaPx = minDelta === Infinity ? 0 : minDelta
  const footDriftPx = maxFootY >= minFootY ? maxFootY - minFootY : 0
  const warnings: string[] = []
  if (uniqueColors > maxColors) warnings.push(`Palette bloat: ${uniqueColors} colors exceeds max ${maxColors} (use disciplined hue-shifted ramps)`)
  if (totalOrphans > 0) warnings.push(`Orphan single-pixel noise detected (${totalOrphans} px)`)
  if (!allowEdge && totalEdges > 0) warnings.push(`Sprite touches frame edge (${totalEdges} px); leave >=1px breathing room`)
  if (fillRatio > maxFillRatio) warnings.push(`Silhouette too dense (fill ${fillRatio} > ${maxFillRatio}); carve negative space`)
  if (lumRange < 90) warnings.push(`Low value contrast (lumRange ${lumRange} < 90)`)
  if (options.maxFootDriftPx !== undefined && footDriftPx > options.maxFootDriftPx) {
    warnings.push(`Foot grounding drift (${footDriftPx}px > ${options.maxFootDriftPx}px)`)
  }
  if (frames > 1 && frameDeltaPx < Math.max(8, Math.round(fw * fh * 0.03))) {
    warnings.push(`Animation motion too subtle (${frameDeltaPx} changed px between frame ${minPairA} and ${minPairB})`)
  }
  return {
    passed: warnings.length === 0,
    frames, frameWidth: fw, frameHeight: fh,
    uniqueColors, orphans: totalOrphans, edgeTouches: totalEdges,
    fillRatio, lumRange, footDriftPx, frameDeltaPx, warnings
  }
}
