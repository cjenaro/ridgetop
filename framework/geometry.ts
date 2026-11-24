import type {
  InstanceBatch, Matrix, Mesh, ProjectShadowMeshOptions, Quaternion,
  ShadowProjection, ShadowProjectionOptions, Vec3
} from './types.ts'

// Matrices are column-major and use a right-handed view with clip depth in [0, 1].
export function multiply(a: Matrix, b: Matrix): Matrix {
  const result = new Float32Array(16)
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      const i = column * 4
      result[i + row] = a[row] * b[i] + a[4 + row] * b[i + 1] +
        a[8 + row] * b[i + 2] + a[12 + row] * b[i + 3]
    }
  }
  return result
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]
]
function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v)
  if (!length || !Number.isFinite(length)) throw new RangeError('Expected a finite, nonzero vector')
  return [v[0] / length, v[1] / length, v[2] / length]
}

export function view(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Matrix {
  const z = unit(sub(eye, target))
  const x = unit(cross(up, z))
  const y = cross(z, x)
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
  ])
}

export function orthographic(width: number, height: number, near: number, far: number): Matrix {
  if (!(width > 0 && height > 0 && near >= 0 && far > near) ||
      ![width, height, near, far].every(Number.isFinite)) throw new RangeError('Invalid orthographic volume')
  return new Float32Array([
    2 / width, 0, 0, 0, 0, 2 / height, 0, 0,
    0, 0, 1 / (near - far), 0, 0, 0, near / (near - far), 1
  ])
}

export function perspective(fieldOfView: number, aspect: number, near: number, far: number): Matrix {
  if (!(fieldOfView > 0 && fieldOfView < Math.PI && aspect > 0 && near > 0 && far > near) ||
      ![aspect, near, far].every(Number.isFinite)) throw new RangeError('Invalid perspective volume')
  const zoom = 1 / Math.tan(fieldOfView / 2)
  return new Float32Array([
    zoom / aspect, 0, 0, 0, 0, zoom, 0, 0,
    0, 0, far / (near - far), -1, 0, 0, near * far / (near - far), 0
  ])
}

export function mesh(positions: ArrayLike<number>, indices?: ArrayLike<number>): Mesh {
  if (!positions.length || positions.length % 3 || !Array.from(positions).every(Number.isFinite)) {
    throw new RangeError('Mesh positions must contain finite XYZ triples')
  }
  const count = indices?.length ?? positions.length / 3
  if (!count || count % 3) throw new RangeError('Mesh must contain complete triangles')
  const data = new Float32Array(count * 6)
  let radius = 0
  for (let i = 0; i < count; i += 3) {
    const points: Vec3[] = []
    for (let corner = 0; corner < 3; corner++) {
      const index = indices ? indices[i + corner] : i + corner
      if (!Number.isInteger(index) || index < 0 || index >= positions.length / 3) {
        throw new RangeError('Mesh index is outside the position array')
      }
      const at = index * 3
      const point: Vec3 = [positions[at], positions[at + 1], positions[at + 2]]
      radius = Math.max(radius, Math.hypot(...point))
      points.push(point)
    }
    const normal = unit(cross(sub(points[1], points[0]), sub(points[2], points[0])))
    for (let corner = 0; corner < 3; corner++) {
      const offset = (i + corner) * 6
      data.set(points[corner], offset)
      data.set(normal, offset + 3)
    }
  }
  return { data, vertexCount: count, radius }
}

export const box = mesh([
  -.5,-.5,-.5, .5,-.5,-.5, .5,.5,-.5, -.5,.5,-.5,
  -.5,-.5,.5, .5,-.5,.5, .5,.5,.5, -.5,.5,.5
], [
  0,3,2, 0,2,1, 4,5,6, 4,6,7, 0,4,7, 0,7,3,
  1,2,6, 1,6,5, 0,1,5, 0,5,4, 3,7,6, 3,6,2
])

export const octahedron = mesh([
  0,1,0, 1,0,0, 0,0,1, -1,0,0, 0,0,-1, 0,-1,0
], [0,2,1, 0,3,2, 0,4,3, 0,1,4, 5,1,2, 5,2,3, 5,3,4, 5,4,1])

/** A 1×1×1 prism with clipped corners and a scaled upper face. */
export function chamferedPrism(corner = .14, topWidth = .82, topDepth = topWidth): Mesh {
  if (!(corner > 0 && corner < .5 && topWidth > 0 && topDepth > 0) ||
      !Number.isFinite(topWidth + topDepth)) throw new RangeError('Invalid chamfered prism dimensions')
  const inner = .5 - corner
  const ring = [[.5, -inner], [.5, inner], [inner, .5], [-inner, .5],
    [-.5, inner], [-.5, -inner], [-inner, -.5], [inner, -.5]]
  const vertices = ring.flatMap(([x, z]) => [x, -.5, z, x * topWidth, .5, z * topDepth])
  const indices: number[] = []
  for (let i = 0; i < 8; i++) {
    const a = 2 * i
    const b = 2 * ((i + 1) % 8)
    indices.push(a, a + 1, b, b, a + 1, b + 1)
    if (i > 0 && i < 7) indices.push(0, a, b, 1, b + 1, a + 1)
  }
  return mesh(vertices, indices)
}

export function cylinder(sides = 6, topRadius = 1, bottomRadius = 1) {
  if (!Number.isInteger(sides) || sides < 3 || sides > 256 ||
      ![topRadius, bottomRadius].every(r => Number.isFinite(r) && r >= 0) ||
      topRadius + bottomRadius === 0) throw new RangeError('Invalid cylinder dimensions')
  const positions = [0, -.5, 0, 0, .5, 0]
  const indices = []
  for (let i = 0; i < sides; i++) {
    const angle = i * Math.PI * 2 / sides
    const x = Math.cos(angle)
    const z = Math.sin(angle)
    positions.push(x * bottomRadius, -.5, z * bottomRadius, x * topRadius, .5, z * topRadius)
    const a = 2 + i * 2
    const b = 2 + (i + 1) % sides * 2
    if (bottomRadius) indices.push(0, a, b, a, a + 1, b)
    if (topRadius) indices.push(1, b + 1, a + 1, b, a + 1, b + 1)
  }
  return mesh(positions, indices)
}

/** Revolve a section from its underside round to its inside. A zero radius closes a cap. */
export function revolvedMesh(section: readonly (readonly [radius: number, height: number])[], sides = 10) {
  if (section.length < 2 || !Number.isSafeInteger(sides) || sides < 3 || sides > 256) throw new RangeError('Invalid revolved section')
  const positions: number[] = [], indices: number[] = []
  for (const [ring, [radius, height]] of section.entries()) {
    if (radius < 0 || !Number.isFinite(radius + height)) throw new RangeError('Invalid section radius or height')
    for (let i = 0; i < sides; i++) {
      const angle = 2 * Math.PI * i / sides
      positions.push(radius * Math.cos(angle), height, radius * Math.sin(angle))
      if (!ring) continue
      const a = (ring - 1) * sides + i, b = (ring - 1) * sides + (i + 1) % sides
      if (section[ring - 1][0] > 0) indices.push(a, a + sides, b)
      if (radius > 0) indices.push(b, a + sides, b + sides)
    }
  }
  return mesh(positions, indices)
}

/** A continuous inverted U in the XY plane, with flat feet on its lower face. */
export function archMesh() {
  const section: number[][] = [[-.5,-.5,-.32,-.5], [-.5,.04,-.32,.04]]
  for (let i = 1; i <= 6; i++) {
    const a = Math.PI - Math.PI * i / 6
    section.push([.5*Math.cos(a), .04+.46*Math.sin(a), .32*Math.cos(a), .04+.29*Math.sin(a)])
  }
  section.push([.5,-.5,.32,-.5])
  const positions: number[] = [], indices: number[] = []
  for (const [i,[ox,oy,ix,iy]] of section.entries()) {
    positions.push(ox,oy,-.5, ix,iy,-.5, ix,iy,.5, ox,oy,.5)
    if (!i) continue
    for (let k = 0; k < 4; k++) {
      const a = 4*(i-1)+k, b = 4*(i-1)+(k+1)%4
      indices.push(a,a+4,b, b,a+4,b+4)
    }
  }
  const end = positions.length / 3 - 4
  indices.push(0,1,3, 1,2,3, end,end+3,end+1, end+1,end+3,end+2)
  return mesh(positions, indices)
}

export function projectPoint(matrix: Matrix, x: number, y: number, z: number): [number, number] {
  const w = x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15]
  return [
    (x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12]) / w,
    (x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13]) / w
  ]
}

/**
 * Project a 3D world point to CSS-pixel screen coordinates, returning null if behind the camera
 * or outside the optional clip margin.
 */
export function worldToScreen(
  matrix: Matrix,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  margin = 0.1
): { x: number; y: number; depth: number } | null {
  const w = x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15]
  if (!(w > 1e-5)) return null
  const nx = (x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12]) / w
  const ny = (x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13]) / w
  const nz = (x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14]) / w
  const limit = 1 + margin
  if (nx < -limit || nx > limit || ny < -limit || ny > limit || nz < 0 || nz > 1) return null
  return { x: (nx * 0.5 + 0.5) * width, y: (0.5 - ny * 0.5) * height, depth: nz }
}

/** Pitch about X, yaw about Y, and roll about Z, applied roll first. */
export function quaternionFromEuler(pitch = 0, yaw = 0, roll = 0): Quaternion {
  const sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2)
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2)
  const sz = Math.sin(roll / 2), cz = Math.cos(roll / 2)
  return [
    cy * sx * cz + sy * cx * sz, sy * cx * cz - cy * sx * sz,
    cy * cx * sz - sy * sx * cz, cy * cx * cz + sy * sx * sz
  ]
}

export function rotationMatrix(q: ArrayLike<number>, offset = 0) {
  const x = q[offset], y = q[offset + 1], z = q[offset + 2], w = q[offset + 3]
  return [
    1 - 2 * (y*y + z*z), 2 * (x*y - z*w), 2 * (x*z + y*w),
    2 * (x*y + z*w), 1 - 2 * (x*x + z*z), 2 * (y*z - x*w),
    2 * (x*z - y*w), 2 * (y*z + x*w), 1 - 2 * (x*x + y*y)
  ]
}

export function rotateVec3(rotation: Quaternion, [x, y, z]: Vec3): Vec3 {
  const [a, b, c, d, e, f, g, h, i] = rotationMatrix(rotation)
  return [a*x + b*y + c*z, d*x + e*y + f*z, g*x + h*y + i*z]
}

/**
 * Camera-space depth along the viewing axis (larger values are farther from the camera).
 * Uses linear clip-W distance for perspective projections and clip-Z for orthographic/affine matrices.
 */
export function cameraDepth(matrix: Matrix, x: number, y: number, z: number): number {
  if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0) {
    return x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15]
  }
  const w = matrix[15]
  const cz = x * matrix[2] + y * matrix[6] + z * matrix[10] + matrix[14]
  return w && w !== 1 ? cz / w : cz
}

const INSERTION_RUN = 16
const INSTANCE_STRIDE = 16
const DEFAULT_SHADOW_LIGHT: Vec3 = [-0.48, 0.8, 0.36]

function insertionSortDesc(depths: Float32Array, indices: Int32Array, start: number, end: number) {
  for (let i = start + 1; i < end; i++) {
    const idx = indices[i]
    const d = depths[idx]
    let j = i - 1
    while (j >= start && depths[indices[j]] < d) {
      indices[j + 1] = indices[j]
      j--
    }
    indices[j + 1] = idx
  }
}

/** Stable, allocation-free descending index sort by `depths[index]` (farthest first). */
export function sortIndicesDesc(depths: Float32Array, indices: Int32Array, aux: Int32Array, count: number) {
  if (count <= 1) return
  if (count <= INSERTION_RUN) {
    insertionSortDesc(depths, indices, 0, count)
    return
  }
  for (let start = 0; start < count; start += INSERTION_RUN) {
    const end = start + INSERTION_RUN < count ? start + INSERTION_RUN : count
    insertionSortDesc(depths, indices, start, end)
  }
  let src = indices
  let dst = aux
  for (let width = INSERTION_RUN; width < count; width <<= 1) {
    for (let left = 0; left < count; left += width << 1) {
      const mid = left + width < count ? left + width : count
      const right = left + (width << 1) < count ? left + (width << 1) : count
      let i = left
      let j = mid
      let k = left
      while (i < mid && j < right) {
        if (depths[src[i]] >= depths[src[j]]) dst[k++] = src[i++]
        else dst[k++] = src[j++]
      }
      while (i < mid) dst[k++] = src[i++]
      while (j < right) dst[k++] = src[j++]
    }
    const tmp = src
    src = dst
    dst = tmp
  }
  if (src !== indices) {
    for (let i = 0; i < count; i++) indices[i] = src[i]
  }
}

export interface AlphaSorter {
  /** Sort `batches[start..start+count)` back-to-front into `out` (or compute index order). */
  sortBatchIndices(matrix: Matrix, batches: readonly InstanceBatch[], start: number, count: number): { inOrder: boolean; indices: Int32Array }
  /** Append `batches` sorted back-to-front into `out` without allocating. */
  sortBatches(matrix: Matrix, batches: readonly InstanceBatch[], out: InstanceBatch[]): void
  /** Compute back-to-front index order for `count` packed instances in `data`. */
  sortInstanceIndices(matrix: Matrix, data: Float32Array, count: number): { inOrder: boolean; indices: Int32Array }
  /** Pack `count` instances from `data` according to the last `sortInstanceIndices` result into a reusable buffer. */
  packInstances(data: Float32Array, count: number): Float32Array<ArrayBuffer>
}

/** Reusable scratch buffers for zero-allocation back-to-front alpha sorting. */
export function createAlphaSorter(initialCapacity = 32): AlphaSorter {
  let depths = new Float32Array(initialCapacity)
  let indices = new Int32Array(initialCapacity)
  let aux = new Int32Array(initialCapacity)
  let packed = new Float32Array(initialCapacity * INSTANCE_STRIDE)
  const result = { inOrder: true, indices }

  function ensure(count: number) {
    if (depths.length < count) {
      let next = Math.max(initialCapacity, depths.length)
      while (next < count) next <<= 1
      depths = new Float32Array(next)
      indices = new Int32Array(next)
      aux = new Int32Array(next)
      result.indices = indices
    }
  }

  function ensurePacked(count: number) {
    const needed = count * INSTANCE_STRIDE
    if (packed.length < needed) {
      let next = Math.max(initialCapacity * INSTANCE_STRIDE, packed.length)
      while (next < needed) next <<= 1
      packed = new Float32Array(next)
    }
  }

  function sortBatchIndices(matrix: Matrix, batches: readonly InstanceBatch[], start: number, count: number) {
    ensure(count)
    const isPerspective = matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0
    const m2 = matrix[2], m6 = matrix[6], m10 = matrix[10], m14 = matrix[14]
    const m3 = matrix[3], m7 = matrix[7], m11 = matrix[11], m15 = matrix[15]
    const invW = !isPerspective && m15 && m15 !== 1 ? 1 / m15 : 1
    let inOrder = true
    let prev = Infinity
    for (let i = 0; i < count; i++) {
      const b = batches[start + i]
      const cx = (b.min[0] + b.max[0]) * 0.5
      const cy = (b.min[1] + b.max[1]) * 0.5
      const cz = (b.min[2] + b.max[2]) * 0.5
      const d = isPerspective
        ? cx * m3 + cy * m7 + cz * m11 + m15
        : (cx * m2 + cy * m6 + cz * m10 + m14) * invW
      depths[i] = d
      indices[i] = i
      if (d > prev) inOrder = false
      prev = d
    }
    if (!inOrder) sortIndicesDesc(depths, indices, aux, count)
    result.inOrder = inOrder
    result.indices = indices
    return result
  }

  function sortBatches(matrix: Matrix, batches: readonly InstanceBatch[], out: InstanceBatch[]) {
    const count = batches.length
    if (count === 0) return
    if (count === 1) {
      out.push(batches[0])
      return
    }
    const { inOrder, indices: order } = sortBatchIndices(matrix, batches, 0, count)
    if (inOrder) {
      for (let i = 0; i < count; i++) out.push(batches[i])
    } else {
      for (let i = 0; i < count; i++) out.push(batches[order[i]])
    }
  }

  function sortInstanceIndices(matrix: Matrix, data: Float32Array, count: number) {
    ensure(count)
    const isPerspective = matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0
    const m2 = matrix[2], m6 = matrix[6], m10 = matrix[10], m14 = matrix[14]
    const m3 = matrix[3], m7 = matrix[7], m11 = matrix[11], m15 = matrix[15]
    const invW = !isPerspective && m15 && m15 !== 1 ? 1 / m15 : 1
    let inOrder = true
    let prev = Infinity
    for (let i = 0; i < count; i++) {
      const at = i * INSTANCE_STRIDE
      const x = data[at], y = data[at + 1], z = data[at + 2]
      const d = isPerspective
        ? x * m3 + y * m7 + z * m11 + m15
        : (x * m2 + y * m6 + z * m10 + m14) * invW
      depths[i] = d
      indices[i] = i
      if (d > prev) inOrder = false
      prev = d
    }
    if (!inOrder) sortIndicesDesc(depths, indices, aux, count)
    result.inOrder = inOrder
    result.indices = indices
    return result
  }

  function packInstances(data: Float32Array, count: number): Float32Array<ArrayBuffer> {
    ensurePacked(count)
    for (let k = 0; k < count; k++) {
      const src = indices[k] * INSTANCE_STRIDE
      const dst = k * INSTANCE_STRIDE
      for (let f = 0; f < INSTANCE_STRIDE; f++) {
        packed[dst + f] = data[src + f]
      }
    }
    return packed
  }

  return { sortBatchIndices, sortBatches, sortInstanceIndices, packInstances }
}

/** A flat unit-radius shadow disc in the XZ plane (`y = 0`) facing `+Y`. */
export function shadowDisc(sides = 12): Mesh {
  if (!Number.isInteger(sides) || sides < 3 || sides > 256) {
    throw new RangeError('Invalid shadow disc side count')
  }
  const vertexCount = sides * 3
  const data = new Float32Array(vertexCount * 6)
  for (let i = 0; i < sides; i++) {
    const a0 = i * Math.PI * 2 / sides
    const a1 = ((i + 1) % sides) * Math.PI * 2 / sides
    const off = i * 18
    // Center (0, 0, 0)
    data[off + 4] = 1
    // Next perimeter point (b)
    data[off + 6] = Math.cos(a1)
    data[off + 8] = Math.sin(a1)
    data[off + 10] = 1
    // Current perimeter point (a)
    data[off + 12] = Math.cos(a0)
    data[off + 14] = Math.sin(a0)
    data[off + 16] = 1
  }
  return { data, vertexCount, radius: 1 }
}

function normalizeLight(direction?: Vec3): [number, number, number] {
  const dir = direction ?? DEFAULT_SHADOW_LIGHT
  const len = Math.hypot(dir[0], dir[1], dir[2])
  if (!len || !Number.isFinite(len)) return [0, 1, 0]
  return [dir[0] / len, dir[1] / len, dir[2] / len]
}

/**
 * Project a 3D caster position onto a horizontal ground plane (`y = groundY`) along the active light direction.
 * Computes ground offset, light-angle stretch, yaw alignment, altitude fade, and anti-Z-fighting Y bias.
 */
export function projectShadow(
  position: Vec3,
  options: ShadowProjectionOptions = {},
  out?: ShadowProjection
): ShadowProjection {
  const target: { position: [number, number, number]; scale: [number, number, number]; yaw: number; opacity: number; visible: boolean } =
    (out as { position: [number, number, number]; scale: [number, number, number]; yaw: number; opacity: number; visible: boolean } | undefined) ?? {
      position: [0, 0, 0],
      scale: [1, 1, 1],
      yaw: 0,
      opacity: 0,
      visible: false
    }
  const groundY = options.groundY ?? 0
  const radius = options.radius ?? 0.5
  const radiusZ = options.radiusZ ?? radius
  const baseOpacity = options.opacity ?? 0.38
  const maxHeight = options.maxHeight ?? 12
  const minScale = options.minScale ?? 0.55
  const maxStretch = options.maxStretch ?? 2.5
  const minLightY = Math.max(1e-3, options.minLightY ?? 0.25)
  const offsetScale = options.offsetScale ?? 1
  const bias = options.bias ?? 0.015

  const rawAlt = position[1] - groundY
  if (!Number.isFinite(rawAlt) || rawAlt < -1e-3 || !(maxHeight > 0) || !(radius > 0) || !(radiusZ > 0)) {
    target.position[0] = position[0]
    target.position[1] = groundY + bias
    target.position[2] = position[2]
    target.scale[0] = Math.max(1e-3, radius)
    target.scale[1] = 1
    target.scale[2] = Math.max(1e-3, radiusZ)
    target.yaw = 0
    target.opacity = 0
    target.visible = false
    return target
  }

  const altitude = rawAlt > 0 ? rawAlt : 0
  const heightT = Math.min(1, altitude / maxHeight)
  const fade = 1 - heightT
  const opacity = Math.max(0, Math.min(1, baseOpacity * fade))

  const [lx, ly, lz] = normalizeLight(options.direction)
  const horiz = Math.hypot(lx, lz)
  const effLy = Math.max(ly, minLightY)
  const lateralFactor = (altitude * offsetScale) / effLy
  const ox = horiz > 1e-6 ? -lx * lateralFactor : 0
  const oz = horiz > 1e-6 ? -lz * lateralFactor : 0

  const heightScale = 1 - heightT * (1 - Math.max(0.05, Math.min(2, minScale)))
  const rawStretch = horiz > 1e-6 ? 1 + (horiz / effLy) * 0.45 : 1
  const stretch = Math.min(Math.max(1, maxStretch), rawStretch)
  const yaw = horiz > 1e-6 ? Math.atan2(-lx, -lz) : 0

  target.position[0] = position[0] + ox
  target.position[1] = groundY + bias
  target.position[2] = position[2] + oz
  target.scale[0] = radius * heightScale
  target.scale[1] = 1
  target.scale[2] = radiusZ * heightScale * stretch
  target.yaw = yaw
  target.opacity = opacity
  target.visible = opacity > 0.004
  return target
}

/**
 * Project any 3D mesh along a directional light onto the local `y = 0` plane to form a flat planar shadow mesh.
 * Keeps light-facing triangles (normal `+Y`) so closed convex meshes project without double-blended seams.
 */
export function projectShadowMesh(source: Mesh, options: ProjectShadowMeshOptions = {}): Mesh {
  const [lx, ly, lz] = normalizeLight(options.direction)
  const minLightY = Math.max(1e-3, options.minLightY ?? 0.25)
  const effLy = Math.max(ly, minLightY)
  const invLy = 1 / effLy
  const sx = options.scale ? options.scale[0] : 1
  const sy = options.scale ? options.scale[1] : 1
  const sz = options.scale ? options.scale[2] : 1
  if (!(sx > 0 && sy > 0 && sz > 0 && Number.isFinite(sx + sy + sz))) {
    throw new RangeError('Shadow mesh scale must contain three finite, positive values')
  }

  let r0 = 1, r1 = 0, r2 = 0, r3 = 0, r4 = 1, r5 = 0, r6 = 0, r7 = 0, r8 = 1
  if (options.rotation !== undefined && options.rotation !== 0) {
    let q: Quaternion
    if (typeof options.rotation === 'number') {
      const half = options.rotation * 0.5
      q = [0, Math.sin(half), 0, Math.cos(half)]
    } else {
      const norm = Math.hypot(options.rotation[0], options.rotation[1], options.rotation[2], options.rotation[3])
      if (!norm || !Number.isFinite(norm)) throw new RangeError('Rotation requires a finite, nonzero quaternion')
      q = [options.rotation[0] / norm, options.rotation[1] / norm, options.rotation[2] / norm, options.rotation[3] / norm]
    }
    ;[r0, r1, r2, r3, r4, r5, r6, r7, r8] = rotationMatrix(q)
  }

  const src = source.data
  const vertCount = source.vertexCount
  const transformed = new Float32Array(vertCount * 3)
  let minY = Infinity
  for (let i = 0; i < vertCount; i++) {
    const s = i * 6
    const vx = src[s] * sx
    const vy = src[s + 1] * sy
    const vz = src[s + 2] * sz
    const tx = r0 * vx + r1 * vy + r2 * vz
    const ty = r3 * vx + r4 * vy + r5 * vz
    const tz = r6 * vx + r7 * vy + r8 * vz
    const d = i * 3
    transformed[d] = tx
    transformed[d + 1] = ty
    transformed[d + 2] = tz
    if (ty < minY) minY = ty
  }

  const baseY = options.baseY ?? minY
  const build = (doubleSided: boolean) => {
    const out: number[] = []
    let radius = 0
    for (let i = 0; i < vertCount; i += 3) {
      const i0 = i * 3, i1 = i0 + 3, i2 = i0 + 6
      const h0 = Math.max(0, transformed[i0 + 1] - baseY)
      const h1 = Math.max(0, transformed[i1 + 1] - baseY)
      const h2 = Math.max(0, transformed[i2 + 1] - baseY)
      const p0x = transformed[i0] - lx * h0 * invLy
      const p0z = transformed[i0 + 2] - lz * h0 * invLy
      const p1x = transformed[i1] - lx * h1 * invLy
      const p1z = transformed[i1 + 2] - lz * h1 * invLy
      const p2x = transformed[i2] - lx * h2 * invLy
      const p2z = transformed[i2 + 2] - lz * h2 * invLy
      const area = (p1z - p0z) * (p2x - p0x) - (p1x - p0x) * (p2z - p0z)
      if (area > 1e-8) {
        out.push(
          p0x, 0, p0z, 0, 1, 0,
          p1x, 0, p1z, 0, 1, 0,
          p2x, 0, p2z, 0, 1, 0
        )
        radius = Math.max(radius, Math.hypot(p0x, p0z), Math.hypot(p1x, p1z), Math.hypot(p2x, p2z))
      } else if (doubleSided && area < -1e-8) {
        out.push(
          p0x, 0, p0z, 0, 1, 0,
          p2x, 0, p2z, 0, 1, 0,
          p1x, 0, p1z, 0, 1, 0
        )
        radius = Math.max(radius, Math.hypot(p0x, p0z), Math.hypot(p1x, p1z), Math.hypot(p2x, p2z))
      }
    }
    return { out, radius }
  }

  let { out, radius } = build(Boolean(options.doubleSided))
  if (!out.length && !options.doubleSided) {
    ;({ out, radius } = build(true))
  }
  if (!out.length) {
    throw new RangeError('Mesh produced no visible shadow triangles on the ground plane')
  }
  return {
    data: new Float32Array(out),
    vertexCount: out.length / 6,
    radius
  }
}
