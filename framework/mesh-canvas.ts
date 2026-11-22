import { rotationMatrix } from './geometry.ts'
import type { InstanceBatch, Matrix, MeshBackend } from './types.ts'
import { INSTANCE_SIZE } from './instances.ts'

function clip(polygon, distance) {
  const result = []
  let start = polygon.at(-1)
  let a = distance(start)
  for (const end of polygon) {
    const b = distance(end)
    if ((a < 0) !== (b < 0)) {
      const t = a / (a - b)
      result.push(start.map((value, i) => value + (end[i] - value) * t))
    }
    if (b >= 0) result.push(end)
    start = end
    a = b
  }
  return result
}
const near = point => point[2]
const far = point => point[3] - point[2]
const left = point => point[3] + point[0]
const right = point => point[3] - point[0]
const bottom = point => point[3] + point[1]
const top = point => point[3] - point[1]
const clipPlanes = [near, far, left, right, bottom, top]

// Bits follow clipPlanes order. Shared bits reject a triangle before any clipping.
function outcode(x: number, y: number, z: number, w: number) {
  return Number(z < 0) | (Number(z > w) << 1) | (Number(x < -w) << 2) |
    (Number(x > w) << 3) | (Number(y < -w) << 4) | (Number(y > w) << 5)
}

function project(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15]
  ]
}
const css = (r, g, b) => `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`

// Pack through typed views so the word matches ImageData's RGBA bytes on any host.
const channels = new Uint8ClampedArray(4)
const packed = new Uint32Array(channels.buffer)
function pixel(r: number, g: number, b: number) {
  channels[0] = Math.round(r * 255)
  channels[1] = Math.round(g * 255)
  channels[2] = Math.round(b * 255)
  channels[3] = 255
  return packed[0]
}

interface Face { points: number[][]; depth: number; tint: string; pixel: number }

function transformBatch(matrix: Matrix, batch: InstanceBatch, polygons: Face[], [lx, ly, lz, ambient]: Float32Array, depthTest: boolean) {
  const vertices = batch.mesh.data
  const data = batch.data
  for (let i = 0; i < batch.count * INSTANCE_SIZE; i += INSTANCE_SIZE) {
    const x = data[i], y = data[i + 1], z = data[i + 2]
    const sx = data[i + 4], sy = data[i + 5], sz = data[i + 6]
    const [a, b, c, d, e, f, g, h, k] = rotationMatrix(data, i + 12)
    faces: for (let face = 0; face < vertices.length; face += 18) {
      let polygon: number[][] = []
      let outsideAny = 0
      let outsideAll = 63
      for (let j = face; j < face + 18; j += 6) {
        const px = vertices[j] * sx
        const py = vertices[j + 1] * sy
        const pz = vertices[j + 2] * sz
        const point = project(matrix, x + a * px + b * py + c * pz, y + d * px + e * py + f * pz, z + g * px + h * py + k * pz)
        const mask = outcode(point[0], point[1], point[2], point[3])
        outsideAny |= mask
        outsideAll &= mask
        polygon.push(point)
      }
      if (outsideAll) continue
      for (let plane = 0; outsideAny && plane < clipPlanes.length; plane++) {
        if (outsideAny & (1 << plane)) polygon = clip(polygon, clipPlanes[plane])
        if (polygon.length < 3) break
      }
      if (polygon.length < 3) continue
      let depth = 0
      for (const point of polygon) {
        const w = point[3]
        if (w <= 0) continue faces
        point[0] /= w
        point[1] /= w
        point[2] /= w
        depth += point[2]
      }
      let area = 0
      for (let j = 0; j < polygon.length; j++) {
        const a = polygon[j]
        const b = polygon[(j + 1) % polygon.length]
        area += a[0] * b[1] - a[1] * b[0]
      }
      if (area <= 0) continue
      const nx = vertices[face + 3] / sx
      const ny = vertices[face + 4] / sy
      const nz = vertices[face + 5] / sz
      const light = ambient + (1 - ambient) * Math.max(0,
        (lx * (a * nx + b * ny + c * nz) + ly * (d * nx + e * ny + f * nz) + lz * (g * nx + h * ny + k * nz)) / Math.hypot(nx, ny, nz))
      const brightness = light + (1 - light) * data[i + 11]
      const red = data[i + 8] * brightness, green = data[i + 9] * brightness, blue = data[i + 10] * brightness
      polygons.push({
        points: polygon, depth: depth / polygon.length,
        tint: depthTest ? '' : css(red, green, blue), pixel: depthTest ? pixel(red, green, blue) : 0
      })
    }
  }
}

function depthTarget(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const image = ctx.createImageData(width, height)
  const pixels = new Uint32Array(image.data.buffer)
  const depth = new Float32Array(width * height)

  function triangle(a: number[], b: number[], c: number[], tint: number) {
    const ax = (1 + a[0]) * width / 2, ay = (1 - a[1]) * height / 2
    const bx = (1 + b[0]) * width / 2, by = (1 - b[1]) * height / 2
    const cx = (1 + c[0]) * width / 2, cy = (1 - c[1]) * height / 2
    const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (!area) return
    const x0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - .5))
    const x1 = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx) - .5))
    const y0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - .5))
    const y1 = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) - .5))
    const dax = (by - cy) / area, day = (cx - bx) / area
    const dbx = (cy - ay) / area, dby = (ax - cx) / area
    // The first two barycentric weights advance by a constant across a scanline.
    for (let y = y0; y <= y1; y++) {
      let wa = dax * (x0 + .5 - cx) + day * (y + .5 - cy)
      let wb = dbx * (x0 + .5 - cx) + dby * (y + .5 - cy)
      for (let x = x0; x <= x1; x++, wa += dax, wb += dbx) {
        if (wa < -1e-9 || wb < -1e-9 || wa + wb > 1 + 1e-9) continue
        const z = wa * (a[2] - c[2]) + wb * (b[2] - c[2]) + c[2]
        const index = y * width + x
        if (z < depth[index]) {
          depth[index] = z
          pixels[index] = tint
        }
      }
    }
  }
  return {
    width, height,
    draw(polygons: Face[], background: number) {
      depth.fill(1)
      pixels.fill(background)
      for (const { points, pixel } of polygons) {
        for (let i = 1; i + 1 < points.length; i++) triangle(points[0], points[i], points[i + 1], pixel)
      }
      ctx.putImageData(image, 0, 0)
    }
  }
}

export function canvasMeshes(canvas: HTMLCanvasElement, light: Float32Array<ArrayBuffer>,
  { transparent = false, depthTest = false } = {}): MeshBackend {
  const ctx = canvas.getContext('2d', { alpha: transparent })
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  const cache = new Map()
  let lastCamera
  let target: ReturnType<typeof depthTarget>
  return {
    name: 'Canvas 2D',
    maxDimension: 4096,
    draw(matrix, clear, visible, stats) {
      if (!lastCamera || matrix.some((value, index) => value !== lastCamera[index])) {
        cache.clear()
        lastCamera = new Float32Array(matrix)
      }
      const polygons: Face[] = []
      for (const batch of visible) {
        let entry = cache.get(batch)
        if (!entry || entry.revision !== batch.revision) {
          entry = { revision: batch.revision, polygons: [] }
          transformBatch(matrix, batch, entry.polygons, light, depthTest)
          cache.set(batch, entry)
        }
        for (const polygon of entry.polygons) polygons.push(polygon)
      }
      if (depthTest) {
        if (!target || target.width !== canvas.width || target.height !== canvas.height) target = depthTarget(ctx, canvas.width, canvas.height)
        target.draw(polygons, transparent ? 0 : pixel(clear[0], clear[1], clear[2]))
        stats.drawCalls = 1
        return
      }
      stats.drawCalls = polygons.length
      polygons.sort((a, b) => b.depth - a.depth)
      const w = canvas.width / 2
      const h = canvas.height / 2
      if (transparent) ctx.clearRect(0, 0, canvas.width, canvas.height)
      else {
        ctx.fillStyle = css(clear[0], clear[1], clear[2])
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      for (const { points, tint } of polygons) {
        ctx.fillStyle = tint
        ctx.beginPath()
        ctx.moveTo((1 + points[0][0]) * w, (1 - points[0][1]) * h)
        for (let i = 1; i < points.length; i++) ctx.lineTo((1 + points[i][0]) * w, (1 - points[i][1]) * h)
        ctx.closePath()
        ctx.fill()
      }
    },
    release(batch) { cache.delete(batch) },
    releaseMesh(mesh) {
      for (const batch of cache.keys()) if (batch.mesh === mesh) cache.delete(batch)
    },
    dispose() { cache.clear() }
  }
}
