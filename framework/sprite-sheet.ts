export interface SpriteFrame {
  rect(x: number, y: number, width: number, height: number, color: string): void
  polygon(points: readonly (readonly [number, number])[], color: string): void
}

const channelPack = new Uint8ClampedArray(4)
const wordPack = new Uint32Array(channelPack.buffer)

function packColor(color: string) {
  if (typeof color !== 'string' || !/^#?[0-9a-f]{6}$/i.test(color)) {
    throw new RangeError('Expected a six-digit RGB color')
  }
  const tint = Number.parseInt(color.charCodeAt(0) === 35 ? color.slice(1) : color, 16)
  channelPack[0] = (tint >>> 16) & 255
  channelPack[1] = (tint >>> 8) & 255
  channelPack[2] = tint & 255
  channelPack[3] = 255
  return wordPack[0]
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
    const origin = row * frameHeight * width + column * frameWidth

    function span(x: number, end: number, y: number, packed: number) {
      if (x < 0 || end > frameWidth || y < 0 || y >= frameHeight) throw new RangeError('Drawing outside sprite frame')
      if (x >= end) return
      const start = origin + y * width + x
      words.fill(packed, start, start + (end - x))
    }
    return {
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
        // Precompute non-horizontal edges ordered by yMin for fast scanline intersection.
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
              // Insertion sort keeps cuts sorted with zero comparator closure overhead.
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
      }
    }
  }
  return { frameWidth, frameHeight, width, height, pixels, frame }
}
