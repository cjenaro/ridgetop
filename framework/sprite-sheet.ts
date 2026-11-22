export interface SpriteFrame {
  rect(x: number, y: number, width: number, height: number, color: string): void
  polygon(points: readonly (readonly [number, number])[], color: string): void
}

function rgb(color: string) {
  if (!/^#?[0-9a-f]{6}$/i.test(color)) throw new RangeError('Expected a six-digit RGB color')
  return Number.parseInt(color.replace(/^#/, ''), 16)
}

/** A transparent RGBA sheet. Drawing coordinates are local to the selected cell. */
export function createSpriteSheet(frameWidth: number, frameHeight: number, columns: number, rows = 1) {
  if (![frameWidth, frameHeight, columns, rows].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new RangeError('Sprite dimensions and grid sizes must be positive integers')
  }
  const width = frameWidth * columns
  const height = frameHeight * rows
  const pixels = new Uint8ClampedArray(width * height * 4)

  function frame(column: number, row = 0): SpriteFrame {
    if (!Number.isInteger(column) || column < 0 || column >= columns ||
        !Number.isInteger(row) || row < 0 || row >= rows) throw new RangeError('Cell outside sprite sheet')
    const origin = row * frameHeight * width + column * frameWidth

    function span(x: number, end: number, y: number, tint: number) {
      if (x < 0 || end > frameWidth || y < 0 || y >= frameHeight) throw new RangeError('Drawing outside sprite frame')
      let at = (origin + y * width + x) * 4
      for (; x < end; x++) {
        pixels[at++] = tint >> 16
        pixels[at++] = (tint >> 8) & 255
        pixels[at++] = tint & 255
        pixels[at++] = 255
      }
    }
    return {
      rect(x, y, w, h, color) {
        if (![x, y, w, h].every(Number.isSafeInteger) || w < 0 || h < 0 ||
            x < 0 || y < 0 || x + w > frameWidth || y + h > frameHeight) {
          throw new RangeError('Rectangle outside sprite frame')
        }
        const tint = rgb(color)
        for (let py = y; py < y + h; py++) span(x, x + w, py, tint)
      },
      polygon(points, color) {
        if (points.length < 3 || points.some(([x, y]) => !(x >= 0 && x <= frameWidth && y >= 0 && y <= frameHeight))) {
          throw new RangeError('Expected at least three points within the sprite frame')
        }
        const tint = rgb(color)
        const top = Math.ceil(Math.min(...points.map(([, y]) => y)) - .5)
        const bottom = Math.ceil(Math.max(...points.map(([, y]) => y)) - .5)
        for (let y = top; y < bottom; y++) {
          const cuts: number[] = []
          const scan = y + .5
          for (let i = 0; i < points.length; i++) {
            const [ax, ay] = points[i]
            const [bx, by] = points[(i + 1) % points.length]
            if ((ay > scan) !== (by > scan)) cuts.push(ax + (bx - ax) * (scan - ay) / (by - ay))
          }
          cuts.sort((a, b) => a - b)
          for (let i = 0; i < cuts.length; i += 2) span(Math.ceil(cuts[i] - .5), Math.ceil(cuts[i + 1] - .5), y, tint)
        }
      }
    }
  }
  return { frameWidth, frameHeight, width, height, pixels, frame }
}
