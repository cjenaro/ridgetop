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

function project(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15]
  ]
}
const css = (r, g, b) => `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`

function transformBatch(matrix: Matrix, batch: InstanceBatch, polygons, [lx, ly, lz, ambient]: Float32Array) {
  const vertices = batch.mesh.data
  const data = batch.data
  for (let i = 0; i < batch.count * INSTANCE_SIZE; i += INSTANCE_SIZE) {
    const x = data[i], y = data[i + 1], z = data[i + 2]
    const sx = data[i + 4], sy = data[i + 5], sz = data[i + 6]
    const [a, b, c, d, e, f, g, h, k] = rotationMatrix(data, i + 12)
    for (let face = 0; face < vertices.length; face += 18) {
      let polygon = []
      for (let j = face; j < face + 18; j += 6) {
        const px = vertices[j] * sx
        const py = vertices[j + 1] * sy
        const pz = vertices[j + 2] * sz
        polygon.push(project(matrix, x + a * px + b * py + c * pz, y + d * px + e * py + f * pz, z + g * px + h * py + k * pz))
      }
      for (const plane of clipPlanes) {
        if (polygon.some(point => plane(point) < 0)) polygon = clip(polygon, plane)
        if (polygon.length < 3) break
      }
      if (polygon.length < 3 || polygon.some(point => point[3] <= 0)) continue
      const points = polygon.map(([px, py, pz, w]) => [px / w, py / w, pz / w])
      let area = 0
      for (let j = 0; j < points.length; j++) {
        const a = points[j]
        const b = points[(j + 1) % points.length]
        area += a[0] * b[1] - a[1] * b[0]
      }
      if (area <= 0) continue
      const nx = vertices[face + 3] / sx
      const ny = vertices[face + 4] / sy
      const nz = vertices[face + 5] / sz
      const light = ambient + (1 - ambient) * Math.max(0,
        (lx * (a * nx + b * ny + c * nz) + ly * (d * nx + e * ny + f * nz) + lz * (g * nx + h * ny + k * nz)) / Math.hypot(nx, ny, nz))
      const brightness = light + (1 - light) * data[i + 11]
      polygons.push({
        points,
        depth: points.reduce((sum, point) => sum + point[2], 0) / points.length,
        tint: css(data[i + 8] * brightness, data[i + 9] * brightness, data[i + 10] * brightness)
      })
    }
  }
}

export function canvasMeshes(canvas: HTMLCanvasElement, light: Float32Array<ArrayBuffer>): MeshBackend {
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Canvas 2D is unavailable')
  const cache = new Map()
  let lastCamera
  return {
    name: 'Canvas 2D',
    maxDimension: 4096,
    draw(matrix, clear, visible, stats) {
      if (!lastCamera || matrix.some((value, index) => value !== lastCamera[index])) {
        cache.clear()
        lastCamera = new Float32Array(matrix)
      }
      const polygons = []
      for (const batch of visible) {
        let entry = cache.get(batch)
        if (!entry || entry.revision !== batch.revision) {
          entry = { revision: batch.revision, polygons: [] }
          transformBatch(matrix, batch, entry.polygons, light)
          cache.set(batch, entry)
        }
        for (const polygon of entry.polygons) polygons.push(polygon)
      }
      polygons.sort((a, b) => b.depth - a.depth)
      const w = canvas.width / 2
      const h = canvas.height / 2
      ctx.fillStyle = css(clear[0], clear[1], clear[2])
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      for (const { points, tint } of polygons) {
        ctx.fillStyle = tint
        ctx.beginPath()
        ctx.moveTo((1 + points[0][0]) * w, (1 - points[0][1]) * h)
        for (let i = 1; i < points.length; i++) ctx.lineTo((1 + points[i][0]) * w, (1 - points[i][1]) * h)
        ctx.closePath()
        ctx.fill()
      }
      stats.drawCalls = polygons.length
    },
    release(batch) { cache.delete(batch) },
    releaseMesh(mesh) {
      for (const batch of cache.keys()) if (batch.mesh === mesh) cache.delete(batch)
    },
    dispose() { cache.clear() }
  }
}
