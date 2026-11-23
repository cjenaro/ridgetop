import type { InstanceBatch, Matrix, MeshBackend } from './types.ts'
import { INSTANCE_SIZE } from './instances.ts'

function clip(polygon: number[][], distance: (point: number[]) => number) {
  const result: number[][] = []
  let start = polygon[polygon.length - 1]
  let a = distance(start)
  for (let idx = 0; idx < polygon.length; idx++) {
    const end = polygon[idx]
    const b = distance(end)
    if ((a < 0) !== (b < 0)) {
      const t = a / (a - b)
      result.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t,
        start[3] + (end[3] - start[3]) * t
      ])
    }
    if (b >= 0) result.push(end)
    start = end
    a = b
  }
  return result
}
const near = (point: number[]) => point[2]
const far = (point: number[]) => point[3] - point[2]
const left = (point: number[]) => point[3] + point[0]
const right = (point: number[]) => point[3] - point[0]
const bottom = (point: number[]) => point[3] + point[1]
const top = (point: number[]) => point[3] - point[1]
const clipPlanes = [near, far, left, right, bottom, top]

// Bits follow clipPlanes order. Shared bits reject a triangle before any clipping.
function outcode(x: number, y: number, z: number, w: number) {
  return (z < 0 ? 1 : 0) | (z > w ? 2 : 0) | (x < -w ? 4 : 0) |
    (x > w ? 8 : 0) | (y < -w ? 16 : 0) | (y > w ? 32 : 0)
}

const css = (r: number, g: number, b: number) => `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`

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

// Flat [x0, y0, z0, x1, y1, z1, ...] vertex coordinates in NDC.
interface Face { points: number[]; depth: number; tint: string; pixel: number }

function transformBatch(matrix: Matrix, batch: InstanceBatch, polygons: Face[], light: Float32Array, depthTest: boolean) {
  const lx = light[0], ly = light[1], lz = light[2], ambient = light[3]
  const vertices = batch.mesh.data
  const vLen = vertices.length
  const data = batch.data
  const end = batch.count * INSTANCE_SIZE
  const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2], m3 = matrix[3]
  const m4 = matrix[4], m5 = matrix[5], m6 = matrix[6], m7 = matrix[7]
  const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10], m11 = matrix[11]
  const m12 = matrix[12], m13 = matrix[13], m14 = matrix[14], m15 = matrix[15]

  for (let i = 0; i < end; i += INSTANCE_SIZE) {
    const x = data[i], y = data[i + 1], z = data[i + 2]
    const sx = data[i + 4], sy = data[i + 5], sz = data[i + 6]
    const qx = data[i + 12], qy = data[i + 13], qz = data[i + 14], qw = data[i + 15]
    const a = 1 - 2 * (qy * qy + qz * qz), b = 2 * (qx * qy - qz * qw), c = 2 * (qx * qz + qy * qw)
    const d = 2 * (qx * qy + qz * qw), e = 1 - 2 * (qx * qx + qz * qz), f = 2 * (qy * qz - qx * qw)
    const g = 2 * (qx * qz - qy * qw), h = 2 * (qy * qz + qx * qw), k = 1 - 2 * (qx * qx + qy * qy)

    // Pre-compose MVP = matrix * (T * R * S) once per instance.
    const a0 = a * sx, d0 = d * sx, g0 = g * sx
    const b0 = b * sy, e0 = e * sy, h0 = h * sy
    const c0 = c * sz, f0 = f * sz, k0 = k * sz

    const c00 = m0 * a0 + m4 * d0 + m8 * g0
    const c01 = m1 * a0 + m5 * d0 + m9 * g0
    const c02 = m2 * a0 + m6 * d0 + m10 * g0
    const c03 = m3 * a0 + m7 * d0 + m11 * g0

    const c10 = m0 * b0 + m4 * e0 + m8 * h0
    const c11 = m1 * b0 + m5 * e0 + m9 * h0
    const c12 = m2 * b0 + m6 * e0 + m10 * h0
    const c13 = m3 * b0 + m7 * e0 + m11 * h0

    const c20 = m0 * c0 + m4 * f0 + m8 * k0
    const c21 = m1 * c0 + m5 * f0 + m9 * k0
    const c22 = m2 * c0 + m6 * f0 + m10 * k0
    const c23 = m3 * c0 + m7 * f0 + m11 * k0

    const t0 = m0 * x + m4 * y + m8 * z + m12
    const t1 = m1 * x + m5 * y + m9 * z + m13
    const t2 = m2 * x + m6 * y + m10 * z + m14
    const t3 = m3 * x + m7 * y + m11 * z + m15

    const invSx = 1 / sx, invSy = 1 / sy, invSz = 1 / sz
    // Pre-transform light direction into instance local space scaled by 1/s.
    const llx = (lx * a + ly * d + lz * g) * invSx
    const lly = (lx * b + ly * e + lz * h) * invSy
    const llz = (lx * c + ly * f + lz * k) * invSz
    const r0 = data[i + 8], g0c = data[i + 9], b0c = data[i + 10], unlit = data[i + 11]

    faces: for (let face = 0; face < vLen; face += 18) {
      const v0x = vertices[face], v0y = vertices[face + 1], v0z = vertices[face + 2]
      const p0x = c00 * v0x + c10 * v0y + c20 * v0z + t0
      const p0y = c01 * v0x + c11 * v0y + c21 * v0z + t1
      const p0z = c02 * v0x + c12 * v0y + c22 * v0z + t2
      const p0w = c03 * v0x + c13 * v0y + c23 * v0z + t3
      const msk0 = outcode(p0x, p0y, p0z, p0w)

      const v1x = vertices[face + 6], v1y = vertices[face + 7], v1z = vertices[face + 8]
      const p1x = c00 * v1x + c10 * v1y + c20 * v1z + t0
      const p1y = c01 * v1x + c11 * v1y + c21 * v1z + t1
      const p1z = c02 * v1x + c12 * v1y + c22 * v1z + t2
      const p1w = c03 * v1x + c13 * v1y + c23 * v1z + t3
      const msk1 = outcode(p1x, p1y, p1z, p1w)

      const v2x = vertices[face + 12], v2y = vertices[face + 13], v2z = vertices[face + 14]
      const p2x = c00 * v2x + c10 * v2y + c20 * v2z + t0
      const p2y = c01 * v2x + c11 * v2y + c21 * v2z + t1
      const p2z = c02 * v2x + c12 * v2y + c22 * v2z + t2
      const p2w = c03 * v2x + c13 * v2y + c23 * v2z + t3
      const msk2 = outcode(p2x, p2y, p2z, p2w)

      if (msk0 & msk1 & msk2) continue
      const outsideAny = msk0 | msk1 | msk2

      let flat: number[]
      let depth: number
      if (outsideAny === 0) {
        if (p0w <= 0 || p1w <= 0 || p2w <= 0) continue
        const inv0 = 1 / p0w, inv1 = 1 / p1w, inv2 = 1 / p2w
        const x0 = p0x * inv0, y0 = p0y * inv0, z0 = p0z * inv0
        const x1 = p1x * inv1, y1 = p1y * inv1, z1 = p1z * inv1
        const x2 = p2x * inv2, y2 = p2y * inv2, z2 = p2z * inv2
        if ((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) <= 0) continue
        flat = [x0, y0, z0, x1, y1, z1, x2, y2, z2]
        depth = (z0 + z1 + z2) / 3
      } else {
        let polygon: number[][] = [
          [p0x, p0y, p0z, p0w],
          [p1x, p1y, p1z, p1w],
          [p2x, p2y, p2z, p2w]
        ]
        for (let plane = 0; plane < clipPlanes.length; plane++) {
          if (outsideAny & (1 << plane)) polygon = clip(polygon, clipPlanes[plane])
          if (polygon.length < 3) continue faces
        }
        const n = polygon.length
        flat = new Array(n * 3)
        depth = 0
        for (let j = 0; j < n; j++) {
          const pt = polygon[j]
          const w = pt[3]
          if (w <= 0) continue faces
          const inv = 1 / w
          const px = pt[0] * inv, py = pt[1] * inv, pz = pt[2] * inv
          flat[j * 3] = px
          flat[j * 3 + 1] = py
          flat[j * 3 + 2] = pz
          depth += pz
        }
        let area = 0
        for (let j = 0; j < n; j++) {
          const j3 = j * 3
          const next3 = ((j + 1) % n) * 3
          area += flat[j3] * flat[next3 + 1] - flat[j3 + 1] * flat[next3]
        }
        if (area <= 0) continue
        depth /= n
      }

      const fnx = vertices[face + 3], fny = vertices[face + 4], fnz = vertices[face + 5]
      const nx = fnx * invSx, ny = fny * invSy, nz = fnz * invSz
      const ndotl = llx * fnx + lly * fny + llz * fnz
      const diffuse = ndotl > 0 ? ndotl / Math.sqrt(nx * nx + ny * ny + nz * nz) : 0
      const shade = ambient + (1 - ambient) * diffuse
      const brightness = shade + (1 - shade) * unlit
      const red = r0 * brightness, green = g0c * brightness, blue = b0c * brightness
      polygons.push({
        points: flat, depth,
        tint: depthTest ? '' : css(red, green, blue),
        pixel: depthTest ? pixel(red, green, blue) : 0
      })
    }
  }
}

function depthTarget(width: number, height: number, pixels: Uint32Array) {
  const depth = new Float32Array(width * height)
  const halfW = width * .5, halfH = height * .5

  function triangle(pts: number[], ia: number, ib: number, ic: number, tint: number) {
    const ax = (1 + pts[ia]) * halfW, ay = (1 - pts[ia + 1]) * halfH, az = pts[ia + 2]
    const bx = (1 + pts[ib]) * halfW, by = (1 - pts[ib + 1]) * halfH, bz = pts[ib + 2]
    const cx = (1 + pts[ic]) * halfW, cy = (1 - pts[ic + 1]) * halfH, cz = pts[ic + 2]
    const area = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (!area) return
    const minX = ax < bx ? (ax < cx ? ax : cx) : (bx < cx ? bx : cx)
    const maxX = ax > bx ? (ax > cx ? ax : cx) : (bx > cx ? bx : cx)
    const minY = ay < by ? (ay < cy ? ay : cy) : (by < cy ? by : cy)
    const maxY = ay > by ? (ay > cy ? ay : cy) : (by > cy ? by : cy)
    const x0 = Math.max(0, Math.ceil(minX - .5))
    const x1 = Math.min(width - 1, Math.floor(maxX - .5))
    const y0 = Math.max(0, Math.ceil(minY - .5))
    const y1 = Math.min(height - 1, Math.floor(maxY - .5))
    if (x0 > x1 || y0 > y1) return
    const invArea = 1 / area
    const dax = (by - cy) * invArea, day = (cx - bx) * invArea
    const dbx = (cy - ay) * invArea, dby = (ax - cx) * invArea
    const azc = az - cz, bzc = bz - cz
    const dzx = dax * azc + dbx * bzc
    const startX = x0 + .5 - cx
    // The first two barycentric weights and depth advance by constants across a scanline.
    for (let y = y0; y <= y1; y++) {
      const dy = y + .5 - cy
      let wa = dax * startX + day * dy
      let wb = dbx * startX + dby * dy
      let z = wa * azc + wb * bzc + cz
      const row = y * width
      for (let x = x0; x <= x1; x++, wa += dax, wb += dbx, z += dzx) {
        if (wa < -1e-9 || wb < -1e-9 || wa + wb > 1 + 1e-9) continue
        const index = row + x
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
      for (let p = 0; p < polygons.length; p++) {
        const { points, pixel } = polygons[p]
        for (let i = 3; i + 3 < points.length; i += 3) triangle(points, 0, i, i + 3, pixel)
      }
    }
  }
}

/** Render a transparent strip with the same depth-tested triangles used by the live canvas backend. */
export function meshViewPixels(cameras: readonly Matrix[], batches: readonly InstanceBatch[], size: number, light: Float32Array<ArrayBuffer>) {
  const width = cameras.length * size
  const pixels = new Uint8ClampedArray(width * size * 4)
  const sheet = new Uint32Array(pixels.buffer), frame = new Uint32Array(size * size)
  const target = depthTarget(size, size, frame)
  const faces: Face[] = []
  for (let column = 0; column < cameras.length; column++) {
    const camera = cameras[column]
    faces.length = 0
    for (let b = 0; b < batches.length; b++) transformBatch(camera, batches[b], faces, light, true)
    target.draw(faces, 0)
    for (let y = 0; y < size; y++) sheet.set(frame.subarray(y * size, (y + 1) * size), y * width + column * size)
  }
  return { width, height: size, pixels }
}

export function canvasMeshes(canvas: HTMLCanvasElement, light: Float32Array<ArrayBuffer>,
  { transparent = false, depthTest = false } = {}): MeshBackend {
  const ctx = canvas.getContext('2d', { alpha: transparent })
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  const cache = new Map<InstanceBatch, { revision: number; polygons: Face[] }>()
  const lastCamera = new Float32Array(16)
  let hasCamera = false
  const polygons: Face[] = []
  let target: ReturnType<typeof depthTarget>
  let image: ImageData
  return {
    name: 'Canvas 2D',
    maxDimension: 4096,
    draw(matrix, clear, visible, stats) {
      let changed = !hasCamera
      if (!changed) {
        for (let i = 0; i < 16; i++) {
          if (matrix[i] !== lastCamera[i]) { changed = true; break }
        }
      }
      if (changed) {
        cache.clear()
        lastCamera.set(matrix)
        hasCamera = true
      }
      polygons.length = 0
      for (let b = 0; b < visible.length; b++) {
        const batch = visible[b]
        let entry = cache.get(batch)
        if (!entry || entry.revision !== batch.revision) {
          entry = { revision: batch.revision, polygons: [] }
          transformBatch(matrix, batch, entry.polygons, light, depthTest)
          cache.set(batch, entry)
        }
        const src = entry.polygons
        for (let i = 0; i < src.length; i++) polygons.push(src[i])
      }
      if (depthTest) {
        if (!target || target.width !== canvas.width || target.height !== canvas.height) {
          image = ctx.createImageData(canvas.width, canvas.height)
          target = depthTarget(canvas.width, canvas.height, new Uint32Array(image.data.buffer))
        }
        target.draw(polygons, transparent ? 0 : pixel(clear[0], clear[1], clear[2]))
        ctx.putImageData(image, 0, 0)
        stats.drawCalls = 1
        return
      }
      stats.drawCalls = polygons.length
      polygons.sort((a, b) => b.depth - a.depth)
      const w = canvas.width / 2
      const h = canvas.height / 2
      let lastFill = ''
      if (transparent) ctx.clearRect(0, 0, canvas.width, canvas.height)
      else {
        lastFill = css(clear[0], clear[1], clear[2])
        ctx.fillStyle = lastFill
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }
      for (let p = 0; p < polygons.length; p++) {
        const { points, tint } = polygons[p]
        if (tint !== lastFill) {
          ctx.fillStyle = tint
          lastFill = tint
        }
        ctx.beginPath()
        ctx.moveTo((1 + points[0]) * w, (1 - points[1]) * h)
        for (let i = 3; i < points.length; i += 3) ctx.lineTo((1 + points[i]) * w, (1 - points[i + 1]) * h)
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
