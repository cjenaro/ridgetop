import type { BlendMode, Color, InstanceBatch, Matrix, Mesh, Quaternion, Vec3 } from './types.ts'

export const INSTANCE_SIZE = 16
const white: Vec3 = [1, 1, 1]
const origin: Vec3 = [0, 0, 0]
const uniformScale: Vec3 = [1, 1, 1]

export function instances(
  mesh: Mesh,
  options: number | { capacity?: number; blend?: BlendMode } = 16
): InstanceBatch {
  const capacity = typeof options === 'number' ? options : (options.capacity ?? 16)
  const blend: BlendMode = typeof options === 'number' ? 'opaque' : (options.blend ?? 'opaque')
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError('Invalid batch capacity')
  if (blend !== 'opaque' && blend !== 'alpha' && blend !== 'additive') throw new RangeError('Unknown blend mode')
  let data = new Float32Array(capacity * INSTANCE_SIZE)
  let count = 0
  let revision = 0
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  return {
    mesh, blend, min, max,
    get data() { return data },
    get count() { return count },
    get revision() { return revision },
    clear() {
      count = 0
      revision++
      min.fill(Infinity)
      max.fill(-Infinity)
    },
    add(position = origin, scale = uniformScale, rotation: number | Quaternion = 0, color: Vec3 | Color = white, unlit = 0) {
      if (count * INSTANCE_SIZE === data.length) {
        const enlarged = new Float32Array(data.length * 2)
        enlarged.set(data)
        data = enlarged
      }
      const [x, y, z] = position
      const [sx, sy, sz] = scale
      if (!(sx > 0 && sy > 0 && sz > 0 && Number.isFinite(sx + sy + sz))) {
        throw new RangeError('Instance scale must contain three finite, positive values')
      }
      const [r, g, b] = color
      const rawA = color.length >= 4 ? (color as Color)[3] : 1
      const alpha = Number.isFinite(rawA) ? Math.max(0, Math.min(1, rawA)) : 1
      const at = count * INSTANCE_SIZE
      data[at] = x
      data[at + 1] = y
      data[at + 2] = z
      data[at + 3] = alpha
      data[at + 4] = sx
      data[at + 5] = sy
      data[at + 6] = sz
      data[at + 8] = r
      data[at + 9] = g
      data[at + 10] = b
      data[at + 11] = unlit
      if (typeof rotation === 'number') {
        const half = rotation * .5
        data[at + 12] = 0
        data[at + 13] = Math.sin(half)
        data[at + 14] = 0
        data[at + 15] = Math.cos(half)
      } else {
        const qx = rotation[0], qy = rotation[1], qz = rotation[2], qw = rotation[3]
        const sq = qx * qx + qy * qy + qz * qz + qw * qw
        const norm = sq > 0 && Number.isFinite(sq) ? Math.sqrt(sq) : Math.hypot(qx, qy, qz, qw)
        if (!Number.isFinite(norm) || !norm) throw new RangeError('Rotation requires a finite, nonzero quaternion')
        const inv = 1 / norm
        data[at + 12] = qx * inv
        data[at + 13] = qy * inv
        data[at + 14] = qz * inv
        data[at + 15] = qw * inv
      }
      const reach = mesh.radius * Math.max(sx, sy, sz)
      min[0] = Math.min(min[0], x - reach)
      min[1] = Math.min(min[1], y - reach)
      min[2] = Math.min(min[2], z - reach)
      max[0] = Math.max(max[0], x + reach)
      max[1] = Math.max(max[1], y + reach)
      max[2] = Math.max(max[2], z + reach)
      count++
      revision++
    }
  }
}

export function frustum(matrix: Matrix, out = new Float32Array(24)) {
  // left, right, bottom, top, near, far. Normalize only if distances are needed.
  for (let i = 0; i < 4; i++) {
    const k = i * 4
    out[i] = matrix[k + 3] + matrix[k]
    out[4 + i] = matrix[k + 3] - matrix[k]
    out[8 + i] = matrix[k + 3] + matrix[k + 1]
    out[12 + i] = matrix[k + 3] - matrix[k + 1]
    out[16 + i] = matrix[k + 2]
    out[20 + i] = matrix[k + 3] - matrix[k + 2]
  }
  return out
}

export function visible(batch: InstanceBatch, planes: Float32Array) {
  if (!batch.count) return false
  const { min, max } = batch
  for (let i = 0; i < 24; i += 4) {
    const x = planes[i]
    const y = planes[i + 1]
    const z = planes[i + 2]
    if (x * (x >= 0 ? max[0] : min[0]) + y * (y >= 0 ? max[1] : min[1]) +
        z * (z >= 0 ? max[2] : min[2]) + planes[i + 3] < 0) return false
  }
  return true
}
