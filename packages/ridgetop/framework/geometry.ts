import type {
  InstanceBatch, Matrix, Mesh, ProjectShadowMeshOptions, Quaternion,
  ShadowProjection, ShadowProjectionOptions, Vec3
} from './types.ts'
import { isTestingActive, recordMeshMeta } from './testing-runtime.ts'

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
  const length = Math.hypot(v[0], v[1], v[2])
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

export function mesh(positions: ArrayLike<number>, indices?: ArrayLike<number>, colors?: ArrayLike<number>): Mesh {
  const posLen = positions.length
  if (!posLen || posLen % 3) {
    throw new RangeError('Mesh positions must contain finite XYZ triples')
  }
  for (let i = 0; i < posLen; i++) {
    if (!Number.isFinite(positions[i])) {
      throw new RangeError('Mesh positions must contain finite XYZ triples')
    }
  }
  const vertMax = posLen / 3
  const count = indices ? indices.length : vertMax
  if (!count || count % 3) throw new RangeError('Mesh must contain complete triangles')
  let expandedColors: Float32Array<ArrayBuffer> | undefined
  let colorMode: 'none' | 'perPos' | 'perVert' = 'none'
  if (colors) {
    if (indices && colors.length === posLen) colorMode = 'perPos'
    else if (colors.length === count * 3) colorMode = 'perVert'
    else if (colors.length === posLen) colorMode = 'perPos'
    else throw new RangeError('Mesh colors must supply 3 RGB floats per position or per triangle vertex')
    for (let i = 0; i < colors.length; i++) {
      if (!Number.isFinite(colors[i])) throw new RangeError('Mesh colors must contain finite RGB triples')
    }
    expandedColors = new Float32Array(count * 3)
  }
  const data = new Float32Array(count * 6)
  let radiusSq = 0
  for (let i = 0; i < count; i += 3) {
    const i0 = indices ? indices[i] : i
    const i1 = indices ? indices[i + 1] : i + 1
    const i2 = indices ? indices[i + 2] : i + 2
    if (
      !Number.isInteger(i0) || i0 < 0 || i0 >= vertMax ||
      !Number.isInteger(i1) || i1 < 0 || i1 >= vertMax ||
      !Number.isInteger(i2) || i2 < 0 || i2 >= vertMax
    ) {
      throw new RangeError('Mesh index is outside the position array')
    }
    const a0 = i0 * 3, a1 = i1 * 3, a2 = i2 * 3
    const x0 = positions[a0], y0 = positions[a0 + 1], z0 = positions[a0 + 2]
    const x1 = positions[a1], y1 = positions[a1 + 1], z1 = positions[a1 + 2]
    const x2 = positions[a2], y2 = positions[a2 + 1], z2 = positions[a2 + 2]
    const r0 = x0 * x0 + y0 * y0 + z0 * z0
    const r1 = x1 * x1 + y1 * y1 + z1 * z1
    const r2 = x2 * x2 + y2 * y2 + z2 * z2
    if (r0 > radiusSq) radiusSq = r0
    if (r1 > radiusSq) radiusSq = r1
    if (r2 > radiusSq) radiusSq = r2

    const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0
    const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0
    const cx = e1y * e2z - e1z * e2y
    const cy = e1z * e2x - e1x * e2z
    const cz = e1x * e2y - e1y * e2x
    const len = Math.hypot(cx, cy, cz)
    if (!Number.isFinite(len) || !len) throw new RangeError('Expected a finite, nonzero vector')
    const inv = 1 / len
    const nx = cx * inv, ny = cy * inv, nz = cz * inv

    const off = i * 6
    data[off] = x0; data[off + 1] = y0; data[off + 2] = z0
    data[off + 3] = nx; data[off + 4] = ny; data[off + 5] = nz
    data[off + 6] = x1; data[off + 7] = y1; data[off + 8] = z1
    data[off + 9] = nx; data[off + 10] = ny; data[off + 11] = nz
    data[off + 12] = x2; data[off + 13] = y2; data[off + 14] = z2
    data[off + 15] = nx; data[off + 16] = ny; data[off + 17] = nz

    if (expandedColors && colors) {
      const cOff = i * 3
      const s0 = colorMode === 'perPos' ? a0 : cOff
      const s1 = colorMode === 'perPos' ? a1 : cOff + 3
      const s2 = colorMode === 'perPos' ? a2 : cOff + 6
      expandedColors[cOff] = colors[s0]; expandedColors[cOff + 1] = colors[s0 + 1]; expandedColors[cOff + 2] = colors[s0 + 2]
      expandedColors[cOff + 3] = colors[s1]; expandedColors[cOff + 4] = colors[s1 + 1]; expandedColors[cOff + 5] = colors[s1 + 2]
      expandedColors[cOff + 6] = colors[s2]; expandedColors[cOff + 7] = colors[s2 + 1]; expandedColors[cOff + 8] = colors[s2 + 2]
    }
  }
  const created: Mesh = expandedColors
    ? { data, colors: expandedColors, vertexCount: count, radius: Math.sqrt(radiusSq) }
    : { data, vertexCount: count, radius: Math.sqrt(radiusSq) }
  if (isTestingActive()) recordMeshMeta(created)
  return created
}

/**
 * Bake subtle low-poly crevice ambient occlusion and optional vertical height gradient into per-vertex RGB colors.
 * Works across WebGPU, WebGL 2, Canvas 2D, and Godot exports with zero runtime shader overhead.
 */
export function bakeVertexAO(
  source: Mesh,
  { strength = 0.24, verticalGradient = 0.14 }: { strength?: number; verticalGradient?: number } = {}
): Mesh {
  const safeStrength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0.24
  const safeGrad = Number.isFinite(verticalGradient) ? Math.max(0, Math.min(1, verticalGradient)) : 0.14
  const n = source.vertexCount
  const data = source.data
  const base = source.colors && source.colors.length >= n * 3 ? source.colors : undefined
  const out = new Float32Array(n * 3)
  let minY = Infinity, maxY = -Infinity
  const qKey = (x: number, y: number, z: number) => `${Math.round(x * 200)},${Math.round(y * 200)},${Math.round(z * 200)}`
  const accum = new Map<string, [number, number, number]>()
  for (let i = 0; i < n; i++) {
    const o = i * 6
    const x = data[o], y = data[o + 1], z = data[o + 2]
    const nx = data[o + 3], ny = data[o + 4], nz = data[o + 5]
    if (y < minY) minY = y; if (y > maxY) maxY = y
    const k = qKey(x, y, z)
    let entry = accum.get(k)
    if (!entry) { entry = [0, 0, 0]; accum.set(k, entry) }
    entry[0] += nx; entry[1] += ny; entry[2] += nz
  }
  const hasSpanY = maxY - minY > 1e-4
  const spanY = hasSpanY ? maxY - minY : 1
  for (let i = 0; i < n; i++) {
    const o = i * 6
    const x = data[o], y = data[o + 1], z = data[o + 2]
    const nx = data[o + 3], ny = data[o + 4], nz = data[o + 5]
    const entry = accum.get(qKey(x, y, z))
    const ex = entry ? entry[0] : nx, ey = entry ? entry[1] : ny, ez = entry ? entry[2] : nz
    const avgLen = Math.hypot(ex, ey, ez) || 1
    // Sharp dihedral / inward-facing seams have lower alignment between face normal and smooth vertex normal.
    const align = Math.max(0, Math.min(1, (nx * ex + ny * ey + nz * ez) / avgLen))
    const downFactor = Math.max(0, -ny) * 0.45
    const crease = (1 - align) * 0.85 + downFactor
    const ao = Math.max(0.55, 1 - safeStrength * crease)
    const hT = hasSpanY ? (y - minY) / spanY : 1
    const grad = 1 - safeGrad * (1 - hT)
    const mul = Math.max(0.45, Math.min(1.12, ao * grad))
    const c = i * 3
    out[c] = Math.max(0, Math.min(1, (base ? base[c] : 1) * mul))
    out[c + 1] = Math.max(0, Math.min(1, (base ? base[c + 1] : 1) * mul))
    out[c + 2] = Math.max(0, Math.min(1, (base ? base[c + 2] : 1) * mul))
  }
  return { data: source.data, colors: out, vertexCount: source.vertexCount, radius: source.radius }
}

/**
 * Recompute smooth crease-angle vertex normals for a mesh so curved and beveled forms shade
 * softly (modern stylized low-poly look) while preserving crisp edges above `creaseAngleDeg`.
 * Works across WebGPU, WebGL 2, Canvas 2D, and Godot exports.
 */
export function smoothMesh(source: Mesh, creaseAngleDeg = 52): Mesh {
  const n = source.vertexCount
  const src = source.data
  const out = new Float32Array(src)
  const cosLimit = Math.cos(Math.max(0, Math.min(180, creaseAngleDeg)) * Math.PI / 180)
  const qKey = (x: number, y: number, z: number) => `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`

  // Store face normal + triangle area per vertex so large faces weight smooth normals evenly.
  const buckets = new Map<string, number[]>()
  const faceNormals = new Float32Array(n * 3)
  const faceWeights = new Float32Array(n)
  for (let i = 0; i < n; i += 3) {
    const o0 = i * 6, o1 = (i + 1) * 6, o2 = (i + 2) * 6
    const e1x = src[o1] - src[o0], e1y = src[o1 + 1] - src[o0 + 1], e1z = src[o1 + 2] - src[o0 + 2]
    const e2x = src[o2] - src[o0], e2y = src[o2 + 1] - src[o0 + 1], e2z = src[o2 + 2] - src[o0 + 2]
    const cx = e1y * e2z - e1z * e2y
    const cy = e1z * e2x - e1x * e2z
    const cz = e1x * e2y - e1y * e2x
    const area2 = Math.hypot(cx, cy, cz)
    const inv = area2 > 1e-10 ? 1 / area2 : 1
    const nx = area2 > 1e-10 ? cx * inv : src[o0 + 3]
    const ny = area2 > 1e-10 ? cy * inv : src[o0 + 4]
    const nz = area2 > 1e-10 ? cz * inv : src[o0 + 5]
    const weight = Math.max(1e-5, area2)
    for (let k = 0; k < 3; k++) {
      const vi = i + k
      const vo = vi * 6
      const fo = vi * 3
      faceNormals[fo] = nx; faceNormals[fo + 1] = ny; faceNormals[fo + 2] = nz
      faceWeights[vi] = weight
      const key = qKey(src[vo], src[vo + 1], src[vo + 2])
      let list = buckets.get(key)
      if (!list) { list = []; buckets.set(key, list) }
      list.push(vi)
    }
  }

  for (let i = 0; i < n; i++) {
    const vo = i * 6
    const fo = i * 3
    const fnx = faceNormals[fo], fny = faceNormals[fo + 1], fnz = faceNormals[fo + 2]
    const list = buckets.get(qKey(src[vo], src[vo + 1], src[vo + 2]))
    if (!list || list.length <= 1) continue
    let sx = 0, sy = 0, sz = 0
    for (let j = 0; j < list.length; j++) {
      const other = list[j]
      const ofo = other * 3
      const onx = faceNormals[ofo], ony = faceNormals[ofo + 1], onz = faceNormals[ofo + 2]
      if (fnx * onx + fny * ony + fnz * onz >= cosLimit) {
        const w = faceWeights[other]
        sx += onx * w; sy += ony * w; sz += onz * w
      }
    }
    const len = Math.hypot(sx, sy, sz)
    if (len > 1e-6) {
      out[vo + 3] = sx / len
      out[vo + 4] = sy / len
      out[vo + 5] = sz / len
    }
  }
  return source.colors
    ? { data: out, colors: source.colors, vertexCount: n, radius: source.radius }
    : { data: out, vertexCount: n, radius: source.radius }
}

/**
 * A 1×1×1 box with all 12 edges and 8 corners cleanly beveled in 3D, catching soft stylized
 * rim highlights on tiles, stonework, architectural trim, and armor plates.
 */
export function bevelBox(bevel = 0.14): Mesh {
  if (!(bevel > 0.005 && bevel < 0.45) || !Number.isFinite(bevel)) {
    throw new RangeError('Bevel must be between 0.005 and 0.45')
  }
  const h = 0.5
  const a = h - bevel
  // 24 vertices: 4 corners on each of the 6 faces (+X, -X, +Y, -Y, +Z, -Z), wound CCW outward.
  const pos: number[] = [
    // +X (0..3)
    h, -a, -a,   h,  a, -a,   h,  a,  a,   h, -a,  a,
    // -X (4..7)
    -h, -a,  a,  -h,  a,  a,  -h,  a, -a,  -h, -a, -a,
    // +Y (8..11)
    -a,  h,  a,   a,  h,  a,   a,  h, -a,  -a,  h, -a,
    // -Y (12..15)
    -a, -h, -a,   a, -h, -a,   a, -h,  a,  -a, -h,  a,
    // +Z (16..19)
    -a, -a,  h,   a, -a,  h,   a,  a,  h,  -a,  a,  h,
    // -Z (20..23)
    a, -a, -h,  -a, -a, -h,  -a,  a, -h,   a,  a, -h
  ]
  const idx: number[] = []
  const quad = (p0: number, p1: number, p2: number, p3: number) => {
    idx.push(p0, p1, p2, p0, p2, p3)
  }
  // 6 main faces
  for (let f = 0; f < 6; f++) {
    const b = f * 4
    quad(b, b + 1, b + 2, b + 3)
  }
  // 12 edge bevel strips (verified CCW outward around each edge)
  quad(1, 10, 9, 2)   // +X/+Y
  quad(0, 3, 14, 13)  // +X/-Y
  quad(3, 2, 18, 17)  // +X/+Z
  quad(1, 0, 20, 23)  // +X/-Z
  quad(5, 8, 11, 6)   // -X/+Y
  quad(7, 12, 15, 4)  // -X/-Y
  quad(4, 16, 19, 5)  // -X/+Z
  quad(6, 22, 21, 7)  // -X/-Z
  quad(19, 18, 9, 8)  // +Y/+Z
  quad(23, 22, 11, 10) // +Y/-Z
  quad(16, 15, 14, 17) // -Y/+Z
  quad(20, 13, 12, 21) // -Y/-Z
  // 8 corner triangles
  idx.push(
    2, 9, 18,    // +X +Y +Z
    1, 23, 10,   // +X +Y -Z
    3, 17, 14,   // +X -Y +Z
    0, 13, 20,   // +X -Y -Z
    5, 19, 8,    // -X +Y +Z
    6, 11, 22,   // -X +Y -Z
    4, 15, 16,   // -X -Y +Z
    7, 21, 12    // -X -Y -Z
  )
  return smoothMesh(mesh(pos, idx), 52)
}

/**
 * Smooth rounded 3D capsule centered at Y in `[-height/2, +height/2]` — ideal for chunky
 * stylized miniature characters, rounded limbs, boulders, and cozy props.
 */
export function capsuleMesh(radius = 0.36, height = 1.0, sides = 12, capRings = 4): Mesh {
  if (!(radius > 0 && height >= radius * 2) || !Number.isFinite(radius + height) ||
      !Number.isSafeInteger(sides) || sides < 6 || sides > 64 ||
      !Number.isSafeInteger(capRings) || capRings < 2 || capRings > 16) {
    throw new RangeError('Invalid capsule dimensions')
  }
  const halfCyl = Math.max(0, height * 0.5 - radius)
  const section: [number, number][] = []
  for (let i = 0; i <= capRings; i++) {
    const a = -Math.PI * 0.5 + (Math.PI * 0.5 * i) / capRings
    const r = i === 0 ? 0 : Math.cos(a) * radius
    section.push([r, -halfCyl + Math.sin(a) * radius])
  }
  for (let i = 0; i <= capRings; i++) {
    if (i === 0 && halfCyl < 1e-4) continue
    const a = (Math.PI * 0.5 * i) / capRings
    const r = i === capRings ? 0 : Math.cos(a) * radius
    section.push([r, halfCyl + Math.sin(a) * radius])
  }
  return smoothMesh(revolvedMesh(section, sides), 72)
}

/**
 * Scalloped multi-lobed stylized foliage cone tier (1 unit tall, Y in `[-0.5, +0.5]`),
 * designed for layered miniature conifers and decorative trees.
 */
export function scallopedCone(lobes = 6, flare = 0.20, topRadius = 0.14): Mesh {
  if (!Number.isSafeInteger(lobes) || lobes < 3 || lobes > 24 ||
      !Number.isFinite(flare + topRadius) || flare < 0 || flare > 0.5 || topRadius < 0) {
    throw new RangeError('Invalid scalloped cone parameters')
  }
  const ringPts = lobes * 2
  const positions: number[] = [0, -0.44, 0, 0, 0.5, 0]
  const indices: number[] = []
  for (let i = 0; i < ringPts; i++) {
    const a = (i / ringPts) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    const isOuter = i % 2 === 0
    const br = isOuter ? 0.5 * (1 + flare) : 0.5 * (1 - flare * 0.65)
    const by = isOuter ? -0.50 : -0.43
    const mr = br * 0.66 + topRadius * 0.34
    const my = 0.04
    const tr = topRadius * (isOuter ? 1.06 : 0.94)
    positions.push(
      c * br, by, s * br,
      c * mr, my, s * mr,
      c * tr, 0.5, s * tr
    )
    const cur = 2 + i * 3
    const nxt = 2 + ((i + 1) % ringPts) * 3
    indices.push(0, cur, nxt)
    indices.push(cur, cur + 1, nxt, nxt, cur + 1, nxt + 1)
    if (topRadius > 1e-4) {
      indices.push(cur + 1, cur + 2, nxt + 1, nxt + 1, cur + 2, nxt + 2)
      indices.push(1, nxt + 2, cur + 2)
    } else {
      indices.push(cur + 1, 1, nxt + 1)
    }
  }
  return smoothMesh(mesh(positions, indices), 46)
}

/** Build a quaternion tilting `+Y` onto a terrain `normal`, composed with a local `yaw` rotation around `+Y`. */
export function normalTiltQuaternion(normal: Vec3, yaw = 0): Quaternion {
  const len = Math.hypot(normal[0], normal[1], normal[2])
  const nx = len > 1e-6 ? normal[0] / len : 0
  const ny = len > 1e-6 ? normal[1] / len : 1
  const nz = len > 1e-6 ? normal[2] / len : 0
  let tx = 0, ty = 0, tz = 0, tw = 1
  if (ny < 0.9999) {
    if (ny < -0.9999) { tx = 1; ty = 0; tz = 0; tw = 0 }
    else {
      // Cross((0,1,0), n) = (nz, 0, -nx), dot = ny
      const cx = nz, cz = -nx
      const w = 1 + ny
      const qLen = Math.hypot(cx, cz, w)
      tx = cx / qLen; tz = cz / qLen; tw = w / qLen
    }
  }
  if (!yaw) return [tx, ty, tz, tw]
  const sy = Math.sin(yaw * 0.5), cy = Math.cos(yaw * 0.5)
  // multiplyQuat(tilt, yawQ)
  return [
    tx * cy - tz * sy,
    tw * sy + ty * cy,
    tz * cy + tx * sy,
    tw * cy - ty * sy
  ]
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

/**
 * Flat double-sided crescent ribbon in the XZ plane (y = 0), centred on +Z and sweeping
 * `sweep` radians around +Y. Width tapers to points at both tips, so it reads as a
 * weapon-slash arc, shockwave fragment, or swirl blade when scaled and rotated.
 */
export function crescentMesh(sweep = Math.PI, innerRadius = 0.72, outerRadius = 1, segments = 12): Mesh {
  if (!Number.isFinite(sweep) || sweep <= 0 || sweep > Math.PI * 2 ||
      !Number.isFinite(innerRadius) || !Number.isFinite(outerRadius) ||
      innerRadius < 0 || outerRadius <= innerRadius ||
      !Number.isInteger(segments) || segments < 2 || segments > 256) throw new RangeError('Invalid crescent dimensions')
  const positions: number[] = []
  const indices: number[] = []
  const ring: [number, number, number, number][] = []
  for (let i = 0; i <= segments; i++) {
    const u = i / segments
    const a = -sweep / 2 + sweep * u
    const taper = Math.sin(u * Math.PI)
    const rIn = outerRadius - (outerRadius - innerRadius) * taper
    ring.push([Math.sin(a) * rIn, Math.cos(a) * rIn, Math.sin(a) * outerRadius, Math.cos(a) * outerRadius])
  }
  for (let side = 0; side < 2; side++) {
    const base = positions.length / 3
    for (const [ix, iz, ox, oz] of ring) positions.push(ix, 0, iz, ox, 0, oz)
    for (let i = 0; i < segments; i++) {
      const a = base + i * 2, b = a + 2
      // Tips collapse inner onto outer; skip the zero-area half of those quads
      const tri = (x: number, y: number, z: number) => {
        const ux = positions[y * 3] - positions[x * 3], uz = positions[y * 3 + 2] - positions[x * 3 + 2]
        const vx = positions[z * 3] - positions[x * 3], vz = positions[z * 3 + 2] - positions[x * 3 + 2]
        if (Math.abs(ux * vz - uz * vx) > 1e-9) indices.push(x, y, z)
      }
      if (side === 0) { tri(a, a + 1, b + 1); tri(a, b + 1, b) }
      else { tri(a, b + 1, a + 1); tri(a, b, b + 1) }
    }
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

/** A 1x1x1 triangular wedge (flat bottom, vertical back at z=-0.5, sloped face down to +Z). */
export function wedgeMesh(): Mesh {
  return mesh([
    -.5, -.5, -.5,  .5, -.5, -.5,  .5, -.5,  .5,  -.5, -.5,  .5,
    -.5,  .5, -.5,  .5,  .5, -.5
  ], [
    0, 1, 2,  0, 2, 3,
    0, 4, 5,  0, 5, 1,
    4, 3, 2,  4, 2, 5,
    0, 3, 4,
    1, 5, 2
  ])
}

/** A 1x1x1 symmetric pitched gable prism (ridge along Z at y=+0.5, flat base at y=-0.5). */
export function gableMesh(): Mesh {
  return mesh([
    -.5, -.5, -.5,  .5, -.5, -.5,  0, .5, -.5,
    -.5, -.5,  .5,  .5, -.5,  .5,  0, .5,  .5
  ], [
    0, 1, 4,  0, 4, 3,
    0, 2, 1,
    3, 4, 5,
    0, 3, 5,  0, 5, 2,
    1, 2, 5,  1, 5, 4
  ])
}

/** Extrude a simple 2D polygon in the XY plane along Z (`[-depth/2, +depth/2]`) with CCW outward winding. */
export function extrudeMesh(points: readonly (readonly [number, number])[], depth = 0.2): Mesh {
  if (points.length < 3 || !Number.isFinite(depth) || depth <= 0) {
    throw new RangeError('Expected >= 3 polygon points and positive depth')
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new RangeError('Extrude polygon points must be finite XY pairs')
    }
  }
  // Remove consecutive duplicate points, then remove collinear intermediate vertices
  const dedup: (readonly [number, number])[] = []
  for (let i = 0; i < points.length; i++) {
    const cur = points[i]
    const prev = dedup[dedup.length - 1]
    if (!prev || Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) > 1e-7) dedup.push(cur)
  }
  if (dedup.length > 1 && Math.hypot(dedup[0][0] - dedup[dedup.length - 1][0], dedup[0][1] - dedup[dedup.length - 1][1]) <= 1e-7) {
    dedup.pop()
  }
  const clean: (readonly [number, number])[] = []
  for (let i = 0; i < dedup.length; i++) {
    const a = dedup[(i + dedup.length - 1) % dedup.length]
    const b = dedup[i]
    const c = dedup[(i + 1) % dedup.length]
    const crossVal = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
    if (Math.abs(crossVal) > 1e-8) clean.push(b)
  }
  const n = clean.length
  if (n < 3) throw new RangeError('Extrude polygon has zero area')
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const a = clean[i], b = clean[(i + 1) % n]
    area2 += a[0] * b[1] - b[0] * a[1]
  }
  if (!Number.isFinite(area2) || Math.abs(area2) < 1e-8) throw new RangeError('Extrude polygon has zero area')
  const pts = area2 > 0 ? clean.slice() : clean.slice().reverse()
  const hz = depth * 0.5
  const positions: number[] = []
  for (let i = 0; i < n; i++) positions.push(pts[i][0], pts[i][1], hz)
  for (let i = 0; i < n; i++) positions.push(pts[i][0], pts[i][1], -hz)

  // Ear-clipping triangulation for arbitrary simple (including concave) 2D polygons.
  const idxList: number[] = []
  for (let i = 0; i < n; i++) idxList.push(i)
  const capTris: number[] = []
  const cross2 = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const inTri = (px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
    cross2(ax, ay, bx, by, px, py) >= -1e-9 &&
    cross2(bx, by, cx, cy, px, py) >= -1e-9 &&
    cross2(cx, cy, ax, ay, px, py) >= -1e-9
  let guard = n * n
  while (idxList.length > 3 && guard-- > 0) {
    let clipped = false
    for (let i = 0; i < idxList.length; i++) {
      const prev = idxList[(i + idxList.length - 1) % idxList.length]
      const cur = idxList[i]
      const next = idxList[(i + 1) % idxList.length]
      const [ax, ay] = pts[prev], [bx, by] = pts[cur], [cx, cy] = pts[next]
      if (cross2(ax, ay, bx, by, cx, cy) <= 1e-9) continue
      let contains = false
      for (let j = 0; j < idxList.length; j++) {
        const k = idxList[j]
        if (k === prev || k === cur || k === next) continue
        if (inTri(pts[k][0], pts[k][1], ax, ay, bx, by, cx, cy)) { contains = true; break }
      }
      if (!contains) {
        capTris.push(prev, cur, next)
        idxList.splice(i, 1)
        clipped = true
        break
      }
    }
    if (!clipped) break
  }
  if (idxList.length === 3) {
    const [a0, b0, c0] = idxList
    if (Math.abs(cross2(pts[a0][0], pts[a0][1], pts[b0][0], pts[b0][1], pts[c0][0], pts[c0][1])) > 1e-9) {
      capTris.push(a0, b0, c0)
    }
  }
  const indices: number[] = []
  for (let i = 0; i < capTris.length; i += 3) {
    indices.push(capTris[i], capTris[i + 1], capTris[i + 2])
    indices.push(n + capTris[i], n + capTris[i + 2], n + capTris[i + 1])
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    indices.push(i, n + i, n + j, i, n + j, j)
  }
  return mesh(positions, indices)
}

/** Sweep a low-poly closed circular tube along a 3D polyline with per-point radius. */
export function tubeMesh(points: readonly Vec3[], radii: number | readonly number[], sides = 7): Mesh {
  if (points.length < 2 || !Number.isSafeInteger(sides) || sides < 3 || sides > 64) {
    throw new RangeError('Expected >= 2 tube points and 3–64 sides')
  }
  if (typeof radii === 'number') {
    if (!Number.isFinite(radii) || radii <= 0) throw new RangeError('Tube radius must be positive and finite')
  } else {
    if (!radii.length) throw new RangeError('Tube radii array must be non-empty')
    for (let i = 0; i < radii.length; i++) {
      if (!Number.isFinite(radii[i]) || radii[i] <= 0) throw new RangeError('Tube radii must be positive and finite')
    }
  }
  // Deduplicate consecutive identical points while preserving matching radii
  const cleanPts: Vec3[] = []
  const cleanRadii: number[] = []
  const rawRAt = (i: number) => typeof radii === 'number' ? radii : (radii[i] ?? radii[radii.length - 1])
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
      throw new RangeError('Tube points must contain finite XYZ triples')
    }
    const prev = cleanPts[cleanPts.length - 1]
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) > 1e-6) {
      cleanPts.push(p)
      cleanRadii.push(rawRAt(i))
    }
  }
  if (cleanPts.length < 2) throw new RangeError('Tube requires >= 2 distinct points')
  const positions: number[] = []
  const indices: number[] = []
  let prevN: Vec3 = [1, 0, 0]
  for (let i = 0; i < cleanPts.length; i++) {
    const p = cleanPts[i]
    const prev = cleanPts[Math.max(0, i - 1)]
    const next = cleanPts[Math.min(cleanPts.length - 1, i + 1)]
    const diff = sub(next, prev)
    const fallback = i > 0 ? sub(p, prev) : sub(next, p)
    const t = Math.hypot(diff[0], diff[1], diff[2]) > 1e-6 ? unit(diff) : unit(fallback)
    if (i === 0) {
      const ref: Vec3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
      prevN = unit(cross(ref, t))
    } else {
      const proj = dot(prevN, t)
      const ortho: Vec3 = [prevN[0] - t[0] * proj, prevN[1] - t[1] * proj, prevN[2] - t[2] * proj]
      const len = Math.hypot(ortho[0], ortho[1], ortho[2])
      prevN = len > 1e-5 ? [ortho[0] / len, ortho[1] / len, ortho[2] / len] : unit(cross(Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], t))
    }
    const b = cross(t, prevN)
    const r = Math.max(1e-4, cleanRadii[i])
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2
      const ca = Math.cos(a) * r, sa = Math.sin(a) * r
      positions.push(p[0] + prevN[0] * ca + b[0] * sa, p[1] + prevN[1] * ca + b[1] * sa, p[2] + prevN[2] * ca + b[2] * sa)
    }
    if (i > 0) {
      const r0 = (i - 1) * sides, r1 = i * sides
      for (let s = 0; s < sides; s++) {
        const sn = (s + 1) % sides
        indices.push(r0 + s, r0 + sn, r1 + sn, r0 + s, r1 + sn, r1 + s)
      }
    }
  }
  const startCenter = positions.length / 3
  positions.push(cleanPts[0][0], cleanPts[0][1], cleanPts[0][2])
  const endCenter = positions.length / 3
  const last = cleanPts[cleanPts.length - 1]
  positions.push(last[0], last[1], last[2])
  const lastRing = (cleanPts.length - 1) * sides
  for (let s = 0; s < sides; s++) {
    const sn = (s + 1) % sides
    indices.push(startCenter, sn, s)
    indices.push(endCenter, lastRing + s, lastRing + sn)
  }
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

/** Invert a 4×4 column-major matrix, returning null if singular or non-finite. */
export function invertMatrix(m: Matrix): Matrix | null {
  if (m.length < 16) return null
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3]
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7]
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11]
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15]

  const b00 = m00 * m11 - m01 * m10
  const b01 = m00 * m12 - m02 * m10
  const b02 = m00 * m13 - m03 * m10
  const b03 = m01 * m12 - m02 * m11
  const b04 = m01 * m13 - m03 * m11
  const b05 = m02 * m13 - m03 * m12
  const b06 = m20 * m31 - m21 * m30
  const b07 = m20 * m32 - m22 * m30
  const b08 = m20 * m33 - m23 * m30
  const b09 = m21 * m32 - m22 * m31
  const b10 = m21 * m33 - m23 * m31
  const b11 = m22 * m33 - m23 * m32

  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const inv = 1 / det
  const out = new Float32Array(16)
  out[0] = (m11 * b11 - m12 * b10 + m13 * b09) * inv
  out[1] = (m02 * b10 - m01 * b11 - m03 * b09) * inv
  out[2] = (m31 * b05 - m32 * b04 + m33 * b03) * inv
  out[3] = (m22 * b04 - m21 * b05 - m23 * b03) * inv
  out[4] = (m12 * b08 - m10 * b11 - m13 * b07) * inv
  out[5] = (m00 * b11 - m02 * b08 + m03 * b07) * inv
  out[6] = (m32 * b02 - m30 * b05 - m33 * b01) * inv
  out[7] = (m20 * b05 - m22 * b02 + m23 * b01) * inv
  out[8] = (m10 * b10 - m11 * b08 + m13 * b06) * inv
  out[9] = (m01 * b08 - m00 * b10 - m03 * b06) * inv
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * inv
  out[11] = (m21 * b02 - m20 * b04 - m23 * b00) * inv
  out[12] = (m11 * b07 - m10 * b09 - m12 * b06) * inv
  out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * inv
  out[14] = (m31 * b01 - m30 * b03 - m32 * b00) * inv
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * inv
  for (let i = 0; i < 16; i++) if (!Number.isFinite(out[i])) return null
  return out
}

/**
 * Unproject a CSS-pixel screen coordinate `(x, y)` into a world-space ray `{ origin, direction }`
 * matching Ridgetop's clip depth `[0, 1]` convention for both perspective and orthographic cameras.
 */
export function screenToRay(
  matrix: Matrix,
  x: number,
  y: number,
  width: number,
  height: number
): { origin: Vec3; direction: Vec3 } | null {
  if (!(width > 0 && height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const inv = invertMatrix(matrix)
  if (!inv) return null
  const nx = (x / width) * 2 - 1
  const ny = 1 - (y / height) * 2

  const nearW = nx * inv[3] + ny * inv[7] + inv[15]
  const farW = nx * inv[3] + ny * inv[7] + inv[11] + inv[15]
  if (!Number.isFinite(nearW) || !Number.isFinite(farW) || Math.abs(nearW) < 1e-9 || Math.abs(farW) < 1e-9) return null

  const ox = (nx * inv[0] + ny * inv[4] + inv[12]) / nearW
  const oy = (nx * inv[1] + ny * inv[5] + inv[13]) / nearW
  const oz = (nx * inv[2] + ny * inv[6] + inv[14]) / nearW

  const fx = (nx * inv[0] + ny * inv[4] + inv[8] + inv[12]) / farW
  const fy = (nx * inv[1] + ny * inv[5] + inv[9] + inv[13]) / farW
  const fz = (nx * inv[2] + ny * inv[6] + inv[10] + inv[14]) / farW

  const dx = fx - ox, dy = fy - oy, dz = fz - oz
  const len = Math.hypot(dx, dy, dz)
  if (!Number.isFinite(len) || len < 1e-9) return null
  return { origin: [ox, oy, oz], direction: [dx / len, dy / len, dz / len] }
}

/** Intersect a world-space ray with the horizontal plane `y = planeY`, returning null if parallel or behind the origin. */
export function intersectRayPlane(origin: Vec3, direction: Vec3, planeY = 0): Vec3 | null {
  const dy = direction[1]
  if (!Number.isFinite(dy) || Math.abs(dy) < 1e-8) return null
  const t = (planeY - origin[1]) / dy
  if (!Number.isFinite(t) || t < 0) return null
  return [origin[0] + direction[0] * t, planeY, origin[2] + direction[2] * t]
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
  const baseCapacity = Number.isFinite(initialCapacity) ? Math.max(1, Math.floor(initialCapacity)) : 32
  let depths = new Float32Array(baseCapacity)
  let indices = new Int32Array(baseCapacity)
  let aux = new Int32Array(baseCapacity)
  let packed = new Float32Array(baseCapacity * INSTANCE_STRIDE)
  const result = { inOrder: true, indices }

  function ensure(count: number) {
    if (depths.length < count) {
      let next = Math.max(baseCapacity, depths.length, 1)
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
      let next = Math.max(baseCapacity * INSTANCE_STRIDE, packed.length, INSTANCE_STRIDE)
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

const _shadowMeta = { yaw: 0, opacity: 0, visible: false }

/**
 * Project a 3D caster position onto a horizontal ground plane (`y = groundY`) along the active light direction.
 * Computes ground offset, light-angle stretch, yaw alignment, altitude fade, and anti-Z-fighting Y bias.
 */
export function projectShadow(
  position: Vec3,
  options: ShadowProjectionOptions = {},
  out?: ShadowProjection
): ShadowProjection {
  const target: ShadowProjection = out ?? {
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
    _shadowMeta.yaw = 0
    _shadowMeta.opacity = 0
    _shadowMeta.visible = false
    Object.assign(target, _shadowMeta)
    return target
  }

  const altitude = rawAlt > 0 ? rawAlt : 0
  const heightT = Math.min(1, altitude / maxHeight)
  const fade = 1 - heightT
  const opacity = Math.max(0, Math.min(1, baseOpacity * fade))

  const dir = options.direction ?? DEFAULT_SHADOW_LIGHT
  const dirLen = Math.hypot(dir[0], dir[1], dir[2])
  const lx = dirLen > 0 && Number.isFinite(dirLen) ? dir[0] / dirLen : 0
  const ly = dirLen > 0 && Number.isFinite(dirLen) ? dir[1] / dirLen : 1
  const lz = dirLen > 0 && Number.isFinite(dirLen) ? dir[2] / dirLen : 0
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
  _shadowMeta.yaw = yaw
  _shadowMeta.opacity = opacity
  _shadowMeta.visible = opacity > 0.004
  Object.assign(target, _shadowMeta)
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
