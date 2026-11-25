import type { Color, Matrix, Mesh } from './types.ts'
import { mesh, multiply, rotationMatrix } from './geometry.ts'

export interface ImportedMeshPart {
  readonly name: string
  readonly mesh: Mesh
  readonly color: Color
  readonly unlit: number
  readonly material?: string
}

const WHITE: Color = [1, 1, 1, 1]
const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_JSON = 0x4e4f534a // 'JSON'
const CHUNK_BIN = 0x004e4942 // 'BIN\0'

const IDENTITY: Matrix = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
])

function clamp01(value: number): number {
  return !(value > 0) ? 0 : value >= 1 ? 1 : value
}

function linearToSrgb(value: number): number {
  const c = clamp01(value)
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

function isNonDegenerate(positions: ArrayLike<number>, i0: number, i1: number, i2: number): boolean {
  const a = i0 * 3, b = i1 * 3, c = i2 * 3
  const e1x = positions[b] - positions[a]
  const e1y = positions[b + 1] - positions[a + 1]
  const e1z = positions[b + 2] - positions[a + 2]
  const e2x = positions[c] - positions[a]
  const e2y = positions[c + 1] - positions[a + 1]
  const e2z = positions[c + 2] - positions[a + 2]
  const nx = e1y * e2z - e1z * e2y
  const ny = e1z * e2x - e1x * e2z
  const nz = e1x * e2y - e1y * e2x
  const lenSq = nx * nx + ny * ny + nz * nz
  return Number.isFinite(lenSq) && lenSq > 0
}

function buildTriangleMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number> | null,
  vertexCount: number,
  mode: number,
  flipWinding: boolean,
  colors?: ArrayLike<number> | null
): Mesh | null {
  const count = indices ? indices.length : vertexCount
  let maxTris = 0
  if (mode === 4) {
    if (count < 3 || count % 3 !== 0) {
      throw new RangeError('glTF TRIANGLES primitive must contain complete triangles')
    }
    maxTris = count / 3
  } else if (mode === 5 || mode === 6) {
    if (count < 3) return null
    maxTris = count - 2
  } else {
    return null
  }

  const flat = new Float32Array(maxTris * 9)
  const flatCol = colors ? new Float32Array(maxTris * 9) : null
  let out = 0

  const emitTri = (a: number, b: number, c: number) => {
    const i0 = a
    const i1 = flipWinding ? c : b
    const i2 = flipWinding ? b : c
    if (!isNonDegenerate(positions, i0, i1, i2)) return
    const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3
    flat[out] = positions[p0]
    flat[out + 1] = positions[p0 + 1]
    flat[out + 2] = positions[p0 + 2]
    flat[out + 3] = positions[p1]
    flat[out + 4] = positions[p1 + 1]
    flat[out + 5] = positions[p1 + 2]
    flat[out + 6] = positions[p2]
    flat[out + 7] = positions[p2 + 1]
    flat[out + 8] = positions[p2 + 2]
    if (flatCol && colors) {
      flatCol[out] = colors[p0]; flatCol[out + 1] = colors[p0 + 1]; flatCol[out + 2] = colors[p0 + 2]
      flatCol[out + 3] = colors[p1]; flatCol[out + 4] = colors[p1 + 1]; flatCol[out + 5] = colors[p1 + 2]
      flatCol[out + 6] = colors[p2]; flatCol[out + 7] = colors[p2 + 1]; flatCol[out + 8] = colors[p2 + 2]
    }
    out += 9
  }

  if (mode === 4) {
    if (indices) {
      for (let i = 0; i < count; i += 3) emitTri(indices[i], indices[i + 1], indices[i + 2])
    } else {
      for (let i = 0; i < count; i += 3) emitTri(i, i + 1, i + 2)
    }
  } else if (mode === 5) {
    for (let i = 0; i + 2 < count; i++) {
      const a = indices ? indices[i] : i
      const b = indices ? indices[i + 1] : i + 1
      const c = indices ? indices[i + 2] : i + 2
      if ((i & 1) === 0) emitTri(a, b, c)
      else emitTri(a, c, b)
    }
  } else {
    const root = indices ? indices[0] : 0
    for (let i = 1; i + 1 < count; i++) {
      const b = indices ? indices[i] : i
      const c = indices ? indices[i + 1] : i + 1
      emitTri(root, b, c)
    }
  }

  if (out === 0) return null
  const finalPos = out === flat.length ? flat : flat.subarray(0, out)
  const finalCol = flatCol ? (out === flatCol.length ? flatCol : flatCol.subarray(0, out)) : undefined
  return mesh(finalPos, undefined, finalCol)
}

/**
 * Parse a Wavefront `.obj` string into Ridgetop meshes grouped by `o`/`g`/`usemtl`.
 * Supports `v`, `f` (`v`, `v/vt`, `v//vn`, `v/vt/vn`), negative indices, and fan triangulation of quads/n-gons.
 */
export function parseObj(source: string): ImportedMeshPart[] {
  if (typeof source !== 'string' || !source.trim()) {
    throw new RangeError('OBJ source is empty')
  }

  const positions: number[] = []
  interface GroupBucket {
    name: string
    material?: string
    indices: number[]
  }
  const buckets = new Map<string, GroupBucket>()
  let currentObject = ''
  let currentGroup = ''
  let currentMaterial: string | undefined

  const rawLines = source.split(/\r?\n/)
  let lineNo = 0
  const stripComment = (raw: string) => {
    const at = raw.indexOf('#')
    return at >= 0 ? raw.slice(0, at) : raw
  }

  while (lineNo < rawLines.length) {
    const startLine = lineNo + 1
    let line = stripComment(rawLines[lineNo++])
    while (line.endsWith('\\') && lineNo < rawLines.length) {
      line = line.slice(0, -1) + ' ' + stripComment(rawLines[lineNo++])
    }
    const trimmed = line.trim()
    if (!trimmed) continue

    const parts = trimmed.split(/\s+/)
    const keyword = parts[0]

    if (keyword === 'v') {
      if (parts.length < 4) {
        throw new RangeError(`Invalid OBJ vertex at line ${startLine}: expected 3 coordinates`)
      }
      const x = Number(parts[1])
      const y = Number(parts[2])
      const z = Number(parts[3])
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new RangeError(`Invalid OBJ vertex coordinates at line ${startLine}`)
      }
      positions.push(x, y, z)
    } else if (keyword === 'o') {
      currentObject = trimmed.slice(1).trim()
      currentGroup = ''
    } else if (keyword === 'g') {
      currentGroup = trimmed.slice(1).trim()
    } else if (keyword === 'usemtl') {
      const mat = trimmed.slice(6).trim()
      currentMaterial = mat || undefined
    } else if (keyword === 'f') {
      if (parts.length < 4) {
        throw new RangeError(`Invalid OBJ face at line ${startLine}: expected at least 3 vertices`)
      }
      const vertexCount = positions.length / 3
      const faceIndices: number[] = []
      for (let i = 1; i < parts.length; i++) {
        const token = parts[i]
        const slashAt = token.indexOf('/')
        const vToken = slashAt >= 0 ? token.slice(0, slashAt) : token
        if (!/^-?\d+$/.test(vToken)) {
          throw new RangeError(`Invalid OBJ face vertex index "${token}" at line ${startLine}`)
        }
        const raw = Number(vToken)
        if (raw === 0 || !Number.isSafeInteger(raw)) {
          throw new RangeError(`Invalid OBJ face vertex index "${token}" at line ${startLine}`)
        }
        const idx = raw > 0 ? raw - 1 : vertexCount + raw
        if (idx < 0 || idx >= vertexCount) {
          throw new RangeError(`OBJ face vertex index ${raw} out of range at line ${startLine}`)
        }
        faceIndices.push(idx)
      }

      const partName = currentGroup || currentObject || currentMaterial || 'default'
      const key = `${partName}\0${currentMaterial ?? ''}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { name: partName, material: currentMaterial, indices: [] }
        buckets.set(key, bucket)
      }

      for (let k = 1; k + 1 < faceIndices.length; k++) {
        bucket.indices.push(faceIndices[0], faceIndices[k], faceIndices[k + 1])
      }
    }
  }

  if (!positions.length || !buckets.size) {
    throw new RangeError('OBJ source contains no valid faces')
  }

  const results: ImportedMeshPart[] = []
  for (const bucket of buckets.values()) {
    const built = buildTriangleMesh(positions, bucket.indices, positions.length / 3, 4, false)
    if (!built) continue
    const part: ImportedMeshPart = bucket.material !== undefined
      ? { name: bucket.name, mesh: built, color: WHITE, unlit: 0, material: bucket.material }
      : { name: bucket.name, mesh: built, color: WHITE, unlit: 0 }
    results.push(part)
  }

  if (!results.length) {
    throw new RangeError('OBJ source contains no valid non-degenerate triangles')
  }
  return results
}

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  throw new TypeError('Expected a Uint8Array or ArrayBuffer')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteArray(value: unknown, length: number): value is number[] {
  if (!Array.isArray(value) || value.length !== length) return false
  for (let i = 0; i < length; i++) {
    if (typeof value[i] !== 'number' || !Number.isFinite(value[i])) return false
  }
  return true
}

function getArrayObject(arr: unknown, index: unknown, label: string): Record<string, unknown> {
  if (!Array.isArray(arr) || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= arr.length) {
    throw new RangeError(`Missing glTF ${label} ${String(index)}`)
  }
  const item = arr[index]
  if (!isPlainObject(item)) {
    throw new RangeError(`Invalid glTF ${label} ${index}`)
  }
  return item
}

function nodeLocalMatrix(node: Record<string, unknown>): Matrix {
  if (node.matrix !== undefined) {
    if (!isFiniteArray(node.matrix, 16)) {
      throw new RangeError('Invalid glTF node matrix')
    }
    return new Float32Array(node.matrix)
  }
  const t = node.translation ?? [0, 0, 0]
  const r = node.rotation ?? [0, 0, 0, 1]
  const s = node.scale ?? [1, 1, 1]
  if (!isFiniteArray(t, 3) || !isFiniteArray(r, 4) || !isFiniteArray(s, 3)) {
    throw new RangeError('Invalid glTF node TRS transform')
  }
  const qLen = Math.hypot(r[0], r[1], r[2], r[3])
  const q = qLen > 0 ? [r[0] / qLen, r[1] / qLen, r[2] / qLen, r[3] / qLen] : [0, 0, 0, 1]
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = rotationMatrix(q)
  return new Float32Array([
    m00 * s[0], m10 * s[0], m20 * s[0], 0,
    m01 * s[1], m11 * s[1], m21 * s[1], 0,
    m02 * s[2], m12 * s[2], m22 * s[2], 0,
    t[0], t[1], t[2], 1
  ])
}

function matrixDeterminant3(m: Matrix): number {
  return (
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2])
  )
}

function resolveAccessorSlice(gltf: Record<string, unknown>, bin: Uint8Array | null, accessorIndex: number, minStride: number) {
  const accessor = getArrayObject(gltf.accessors, accessorIndex, 'accessor')
  if (typeof accessor.count !== 'number' || !Number.isSafeInteger(accessor.count) || accessor.count <= 0) {
    throw new RangeError(`Invalid glTF accessor count at ${accessorIndex}`)
  }
  const count = accessor.count
  if (accessor.bufferView === undefined) {
    throw new RangeError(`glTF accessor ${accessorIndex} has no bufferView`)
  }
  const viewDef = getArrayObject(gltf.bufferViews, accessor.bufferView, 'bufferView')
  if ((viewDef.buffer ?? 0) !== 0 || !bin) {
    throw new RangeError(`glTF bufferView ${String(accessor.bufferView)} requires binary chunk buffer 0`)
  }
  const viewOffset = viewDef.byteOffset ?? 0
  const viewLength = viewDef.byteLength
  const accOffset = accessor.byteOffset ?? 0
  if (
    typeof viewOffset !== 'number' || !Number.isSafeInteger(viewOffset) || viewOffset < 0 ||
    typeof viewLength !== 'number' || !Number.isSafeInteger(viewLength) || viewLength < 0 ||
    typeof accOffset !== 'number' || !Number.isSafeInteger(accOffset) || accOffset < 0 ||
    viewOffset + viewLength > bin.byteLength
  ) {
    throw new RangeError(`glTF bufferView ${String(accessor.bufferView)} exceeds binary chunk bounds`)
  }
  const stride = viewDef.byteStride ?? minStride
  if (typeof stride !== 'number' || !Number.isSafeInteger(stride) || stride < minStride) {
    throw new RangeError(`Invalid glTF byteStride ${String(stride)} for accessor ${accessorIndex}`)
  }
  const start = viewOffset + accOffset
  const end = start + (count - 1) * stride + minStride
  if (!Number.isSafeInteger(end) || end > viewOffset + viewLength || end > bin.byteLength) {
    throw new RangeError(`glTF accessor ${accessorIndex} exceeds bufferView bounds`)
  }
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  return { accessor, count, dv, start, stride }
}

function readPositions(gltf: Record<string, unknown>, bin: Uint8Array | null, accessorIndex: number, world: Matrix): Float32Array {
  const { accessor, count, dv, start, stride } = resolveAccessorSlice(gltf, bin, accessorIndex, 12)
  if (accessor.type !== 'VEC3' || accessor.componentType !== 5126) {
    throw new RangeError(`glTF POSITION accessor ${accessorIndex} must be FLOAT VEC3`)
  }
  const out = new Float32Array(count * 3)
  const m0 = world[0], m1 = world[1], m2 = world[2]
  const m4 = world[4], m5 = world[5], m6 = world[6]
  const m8 = world[8], m9 = world[9], m10 = world[10]
  const m12 = world[12], m13 = world[13], m14 = world[14]
  for (let i = 0; i < count; i++) {
    const off = start + i * stride
    const x = dv.getFloat32(off, true)
    const y = dv.getFloat32(off + 4, true)
    const z = dv.getFloat32(off + 8, true)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new RangeError(`Non-finite vertex position in glTF accessor ${accessorIndex}`)
    }
    const dst = i * 3
    out[dst] = m0 * x + m4 * y + m8 * z + m12
    out[dst + 1] = m1 * x + m5 * y + m9 * z + m13
    out[dst + 2] = m2 * x + m6 * y + m10 * z + m14
    if (!Number.isFinite(out[dst]) || !Number.isFinite(out[dst + 1]) || !Number.isFinite(out[dst + 2])) {
      throw new RangeError(`Transformed vertex position overflowed Float32 in glTF accessor ${accessorIndex}`)
    }
  }
  return out
}

function readIndices(gltf: Record<string, unknown>, bin: Uint8Array | null, accessorIndex: number, vertexCount: number): Uint32Array {
  const accessor = getArrayObject(gltf.accessors, accessorIndex, 'index accessor')
  if (accessor.type !== 'SCALAR') {
    throw new RangeError(`glTF index accessor ${accessorIndex} must be SCALAR`)
  }
  const compSize = accessor.componentType === 5121 ? 1
    : accessor.componentType === 5123 ? 2
    : accessor.componentType === 5125 ? 4
    : 0
  if (!compSize) {
    throw new RangeError(`Unsupported glTF index componentType ${String(accessor.componentType)}`)
  }
  const { count, dv, start, stride } = resolveAccessorSlice(gltf, bin, accessorIndex, compSize)
  const out = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    const off = start + i * stride
    const idx = compSize === 1 ? dv.getUint8(off)
      : compSize === 2 ? dv.getUint16(off, true)
      : dv.getUint32(off, true)
    if (idx >= vertexCount) {
      throw new RangeError(`glTF index ${idx} exceeds vertex count ${vertexCount}`)
    }
    out[i] = idx
  }
  return out
}

function readColors(gltf: Record<string, unknown>, bin: Uint8Array | null, accessorIndex: number, expectedCount: number): Float32Array | null {
  const accessor = getArrayObject(gltf.accessors, accessorIndex, 'color accessor')
  const comps = accessor.type === 'VEC3' ? 3 : accessor.type === 'VEC4' ? 4 : 0
  if (!comps) return null
  const compSize = accessor.componentType === 5126 ? 4 : accessor.componentType === 5121 ? 1 : accessor.componentType === 5123 ? 2 : 0
  if (!compSize) return null
  const { count, dv, start, stride } = resolveAccessorSlice(gltf, bin, accessorIndex, comps * compSize)
  if (count < expectedCount) return null
  const out = new Float32Array(expectedCount * 3)
  for (let i = 0; i < expectedCount; i++) {
    const off = start + i * stride
    for (let c = 0; c < 3; c++) {
      const raw = compSize === 4 ? dv.getFloat32(off + c * 4, true)
        : compSize === 1 ? dv.getUint8(off + c) / 255
        : dv.getUint16(off + c * 2, true) / 65535
      out[i * 3 + c] = linearToSrgb(Number.isFinite(raw) ? raw : 1)
    }
  }
  return out
}

function extractMaterial(mat: Record<string, unknown> | undefined): { color: Color; unlit: number; material?: string } {
  if (!isPlainObject(mat)) return { color: WHITE, unlit: 0 }
  const pbr = isPlainObject(mat.pbrMetallicRoughness) ? mat.pbrMetallicRoughness : undefined
  const bcf = Array.isArray(pbr?.baseColorFactor) ? pbr.baseColorFactor : undefined
  const br = bcf && typeof bcf[0] === 'number' && Number.isFinite(bcf[0]) ? Math.max(0, bcf[0]) : 1
  const bg = bcf && typeof bcf[1] === 'number' && Number.isFinite(bcf[1]) ? Math.max(0, bcf[1]) : 1
  const bb = bcf && typeof bcf[2] === 'number' && Number.isFinite(bcf[2]) ? Math.max(0, bcf[2]) : 1
  const ba = bcf && typeof bcf[3] === 'number' && Number.isFinite(bcf[3]) ? clamp01(bcf[3]) : 1

  const ef = Array.isArray(mat.emissiveFactor) ? mat.emissiveFactor : undefined
  const er = ef && typeof ef[0] === 'number' && Number.isFinite(ef[0]) ? Math.max(0, ef[0]) : 0
  const eg = ef && typeof ef[1] === 'number' && Number.isFinite(ef[1]) ? Math.max(0, ef[1]) : 0
  const eb = ef && typeof ef[2] === 'number' && Number.isFinite(ef[2]) ? Math.max(0, ef[2]) : 0

  const baseSum = br + bg + bb
  const emissiveSum = er + eg + eb
  const totalSum = baseSum + emissiveSum
  const isKhrUnlit = isPlainObject(mat.extensions) && Object.hasOwn(mat.extensions, 'KHR_materials_unlit')

  const unlit = isKhrUnlit ? 1 : (emissiveSum > 0 && totalSum > 0 ? clamp01(emissiveSum / totalSum) : 0)
  const lr = clamp01(br + er)
  const lg = clamp01(bg + eg)
  const lb = clamp01(bb + eb)

  const color: Color = [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb), ba]
  return typeof mat.name === 'string' ? { color, unlit, material: mat.name } : { color, unlit }
}

/**
 * Parse a binary glTF 2.0 (`.glb`) buffer into Ridgetop meshes with flat normals,
 * baked node hierarchy transforms, sRGB colors, and unlit factors.
 * Round-trips cleanly with Ridgetop's `encodeGlb`.
 */
export function parseGlb(bytes: Uint8Array | ArrayBuffer): ImportedMeshPart[] {
  const u8 = toUint8Array(bytes)
  if (u8.byteLength < 20) {
    throw new RangeError('GLB buffer is too short to contain a valid header')
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (dv.getUint32(0, true) !== GLB_MAGIC) {
    throw new RangeError('Invalid GLB header magic (expected "glTF")')
  }
  const version = dv.getUint32(4, true)
  if (version !== 2) {
    throw new RangeError(`Unsupported GLB version ${version} (expected 2)`)
  }
  const totalLength = dv.getUint32(8, true)
  if (totalLength < 20 || totalLength > u8.byteLength) {
    throw new RangeError(`Invalid GLB total length ${totalLength} for ${u8.byteLength}-byte buffer`)
  }

  let offset = 12
  const jsonLength = dv.getUint32(offset, true)
  const jsonType = dv.getUint32(offset + 4, true)
  if (jsonType !== CHUNK_JSON) {
    throw new RangeError('First GLB chunk must be JSON')
  }
  if (jsonLength === 0 || offset + 8 + jsonLength > totalLength) {
    throw new RangeError('GLB JSON chunk exceeds container length')
  }
  let gltf: Record<string, unknown>
  try {
    const jsonText = new TextDecoder('utf-8').decode(u8.subarray(offset + 8, offset + 8 + jsonLength))
    const parsed: unknown = JSON.parse(jsonText)
    if (!isPlainObject(parsed)) {
      throw new Error('Root JSON value must be an object')
    }
    gltf = parsed
  } catch (error) {
    throw new RangeError(`Invalid GLB JSON chunk: ${error instanceof Error ? error.message : String(error)}`)
  }
  offset += 8 + jsonLength

  let binChunk: Uint8Array | null = null
  while (offset < totalLength) {
    if (offset + 8 > totalLength) {
      throw new RangeError('Truncated GLB chunk header')
    }
    const chunkLength = dv.getUint32(offset, true)
    const chunkType = dv.getUint32(offset + 4, true)
    if (offset + 8 + chunkLength > totalLength) {
      throw new RangeError('GLB chunk exceeds container length')
    }
    if (chunkType === CHUNK_BIN && !binChunk) {
      binChunk = u8.subarray(offset + 8, offset + 8 + chunkLength)
    }
    offset += 8 + chunkLength
  }

  if (gltf.asset !== undefined) {
    if (!isPlainObject(gltf.asset)) {
      throw new RangeError('Invalid glTF asset header')
    }
    if (gltf.asset.version !== undefined && (typeof gltf.asset.version !== 'string' || !gltf.asset.version.startsWith('2.'))) {
      throw new RangeError(`Unsupported glTF asset version ${String(gltf.asset.version)}`)
    }
  }

  const parts: ImportedMeshPart[] = []

  function emitMesh(meshIndex: unknown, world: Matrix, nodeName?: string) {
    const meshDef = getArrayObject(gltf.meshes, meshIndex, 'mesh')
    const primitives = Array.isArray(meshDef.primitives) ? meshDef.primitives : []
    const flipWinding = matrixDeterminant3(world) < 0
    const baseName = (typeof nodeName === 'string' && nodeName) || (typeof meshDef.name === 'string' && meshDef.name) || `mesh_${String(meshIndex)}`

    for (let p = 0; p < primitives.length; p++) {
      const prim = primitives[p]
      if (!isPlainObject(prim)) {
        throw new RangeError(`Invalid glTF mesh ${String(meshIndex)} primitive ${p}`)
      }
      const mode = prim.mode ?? 4
      if (mode !== 4 && mode !== 5 && mode !== 6) continue
      const posAccessor = isPlainObject(prim.attributes) ? prim.attributes.POSITION : undefined
      if (typeof posAccessor !== 'number' || !Number.isInteger(posAccessor)) {
        throw new RangeError(`glTF mesh ${String(meshIndex)} primitive ${p} is missing POSITION attribute`)
      }

      const positions = readPositions(gltf, binChunk, posAccessor, world)
      const vertexCount = positions.length / 3
      const colAccessor = isPlainObject(prim.attributes) ? prim.attributes.COLOR_0 : undefined
      const vtxColors = typeof colAccessor === 'number' && Number.isInteger(colAccessor)
        ? readColors(gltf, binChunk, colAccessor, vertexCount)
        : null
      let rawIndices: Uint32Array | null = null
      if (prim.indices !== undefined) {
        if (typeof prim.indices !== 'number' || !Number.isInteger(prim.indices)) {
          throw new RangeError(`Missing glTF index accessor ${String(prim.indices)}`)
        }
        rawIndices = readIndices(gltf, binChunk, prim.indices, vertexCount)
      }

      const built = buildTriangleMesh(positions, rawIndices, vertexCount, mode, flipWinding, vtxColors)
      if (!built) continue

      const matDef = prim.material !== undefined ? getArrayObject(gltf.materials, prim.material, 'material') : undefined
      const { color, unlit, material } = extractMaterial(matDef)
      const name = primitives.length === 1
        ? baseName
        : (material ? `${baseName}/${material}` : `${baseName}/${p}`)

      const part: ImportedMeshPart = material !== undefined
        ? { name, mesh: built, color, unlit, material }
        : { name, mesh: built, color, unlit }
      parts.push(part)
    }
  }

  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : []
  const visiting = new Set<number>()
  const visited = new Set<number>()

  function walkNode(nodeIndex: unknown, parentWorld: Matrix) {
    if (typeof nodeIndex !== 'number' || !Number.isInteger(nodeIndex)) {
      throw new RangeError(`Missing glTF node ${String(nodeIndex)}`)
    }
    if (visiting.has(nodeIndex)) {
      throw new RangeError(`Cyclic glTF node hierarchy at node ${nodeIndex}`)
    }
    if (visited.has(nodeIndex)) {
      throw new RangeError(`Invalid glTF node hierarchy: node ${nodeIndex} has multiple parents`)
    }
    const node = getArrayObject(nodes, nodeIndex, 'node')
    visiting.add(nodeIndex)
    visited.add(nodeIndex)
    const world = multiply(parentWorld, nodeLocalMatrix(node))
    if (node.mesh !== undefined) {
      emitMesh(node.mesh, world, typeof node.name === 'string' ? node.name : undefined)
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) {
        throw new RangeError(`Invalid glTF children list at node ${nodeIndex}`)
      }
      for (let i = 0; i < node.children.length; i++) {
        walkNode(node.children[i], world)
      }
    }
    visiting.delete(nodeIndex)
  }

  if (Array.isArray(gltf.scenes) && gltf.scenes.length) {
    const sceneIndex = gltf.scene ?? 0
    const scene = getArrayObject(gltf.scenes, sceneIndex, 'scene')
    const rootNodes = scene.nodes ?? []
    if (!Array.isArray(rootNodes)) {
      throw new RangeError(`Invalid glTF scene ${String(sceneIndex)} nodes list`)
    }
    for (let i = 0; i < rootNodes.length; i++) {
      walkNode(rootNodes[i], IDENTITY)
    }
  } else if (nodes.length) {
    const childSet = new Set<number>()
    for (let i = 0; i < nodes.length; i++) {
      const node = getArrayObject(nodes, i, 'node')
      if (node.children !== undefined) {
        if (!Array.isArray(node.children)) {
          throw new RangeError(`Invalid glTF children list at node ${i}`)
        }
        for (let c = 0; c < node.children.length; c++) {
          const child = node.children[c]
          if (typeof child !== 'number' || !Number.isInteger(child)) {
            throw new RangeError(`Missing glTF node ${String(child)}`)
          }
          if (childSet.has(child)) {
            throw new RangeError(`Invalid glTF node hierarchy: node ${child} has multiple parents`)
          }
          childSet.add(child)
        }
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!childSet.has(i)) walkNode(i, IDENTITY)
    }
    if (visited.size < nodes.length) {
      throw new RangeError('Cyclic glTF node hierarchy')
    }
  } else if (Array.isArray(gltf.meshes) && gltf.meshes.length) {
    for (let i = 0; i < gltf.meshes.length; i++) {
      emitMesh(i, IDENTITY)
    }
  }

  if (!parts.length) {
    throw new RangeError('GLB contains no valid triangle meshes')
  }
  return parts
}

/**
 * Fetch and parse a `.glb` or `.obj` asset in browser or runtime environments with `fetch`.
 * Format is detected by GLB magic bytes (`glTF`) first, then URL extension or content type.
 */
export async function loadMesh(url: string | URL, init?: RequestInit): Promise<ImportedMeshPart[]> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`Failed to load mesh "${String(url)}": HTTP ${response.status}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const hasGlbMagic = bytes.byteLength >= 4 &&
    bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46

  if (hasGlbMagic) return parseGlb(bytes)

  const href = typeof url === 'string' ? url : url.href
  const cleanPath = href.split(/[?#]/, 1)[0].toLowerCase()
  const contentType = response.headers?.get?.('content-type')?.toLowerCase() ?? ''

  if (cleanPath.endsWith('.glb') || contentType.includes('model/gltf-binary')) {
    return parseGlb(bytes)
  }
  return parseObj(new TextDecoder('utf-8').decode(bytes))
}
