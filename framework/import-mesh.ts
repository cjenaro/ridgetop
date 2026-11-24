import type { Color, Matrix, Mesh, Vec3 } from './types.ts'
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
  return value <= 0 ? 0 : value >= 1 ? 1 : value
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

function buildCompactMesh(positions: ArrayLike<number>, indices: readonly number[]): Mesh | null {
  const compactPositions: number[] = []
  const compactIndices: number[] = []
  const remap = new Map<number, number>()

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2]
    if (!isNonDegenerate(positions, i0, i1, i2)) continue
    for (const src of [i0, i1, i2]) {
      let dst = remap.get(src)
      if (dst === undefined) {
        dst = compactPositions.length / 3
        remap.set(src, dst)
        const at = src * 3
        compactPositions.push(positions[at], positions[at + 1], positions[at + 2])
      }
      compactIndices.push(dst)
    }
  }

  if (!compactIndices.length) return null
  return mesh(compactPositions, compactIndices)
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

  while (lineNo < rawLines.length) {
    const startLine = lineNo + 1
    let line = rawLines[lineNo++]
    while (line.endsWith('\\') && lineNo < rawLines.length) {
      line = line.slice(0, -1) + ' ' + rawLines[lineNo++]
    }
    const commentAt = line.indexOf('#')
    if (commentAt >= 0) line = line.slice(0, commentAt)
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
    const built = buildCompactMesh(positions, bucket.indices)
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

interface GltfBufferView {
  buffer?: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}

interface GltfAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
}

interface GltfMaterial {
  name?: string
  pbrMetallicRoughness?: {
    baseColorFactor?: number[]
  }
  emissiveFactor?: number[]
  extensions?: Record<string, unknown>
}

interface GltfPrimitive {
  attributes?: Record<string, number>
  indices?: number
  material?: number
  mode?: number
}

interface GltfMesh {
  name?: string
  primitives?: GltfPrimitive[]
}

interface GltfNode {
  name?: string
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

interface GltfRoot {
  asset?: { version?: string }
  scene?: number
  scenes?: { name?: string; nodes?: number[] }[]
  nodes?: GltfNode[]
  meshes?: GltfMesh[]
  materials?: GltfMaterial[]
  bufferViews?: GltfBufferView[]
  accessors?: GltfAccessor[]
}

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  throw new TypeError('Expected a Uint8Array or ArrayBuffer')
}

function nodeLocalMatrix(node: GltfNode): Matrix {
  if (Array.isArray(node.matrix)) {
    if (node.matrix.length !== 16 || !node.matrix.every(Number.isFinite)) {
      throw new RangeError('Invalid glTF node matrix')
    }
    return new Float32Array(node.matrix)
  }
  const t = node.translation ?? [0, 0, 0]
  const r = node.rotation ?? [0, 0, 0, 1]
  const s = node.scale ?? [1, 1, 1]
  if (t.length !== 3 || r.length !== 4 || s.length !== 3 ||
      ![...t, ...r, ...s].every(Number.isFinite)) {
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

function transformPoint(m: Matrix, x: number, y: number, z: number): Vec3 {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]
  ]
}

function resolveAccessorSlice(gltf: GltfRoot, bin: Uint8Array | null, accessorIndex: number, minStride: number) {
  const accessor = gltf.accessors?.[accessorIndex]
  if (!accessor) throw new RangeError(`Missing glTF accessor ${accessorIndex}`)
  if (!Number.isInteger(accessor.count) || accessor.count <= 0) {
    throw new RangeError(`Invalid glTF accessor count at ${accessorIndex}`)
  }
  if (accessor.bufferView === undefined) {
    throw new RangeError(`glTF accessor ${accessorIndex} has no bufferView`)
  }
  const viewDef = gltf.bufferViews?.[accessor.bufferView]
  if (!viewDef) throw new RangeError(`Missing glTF bufferView ${accessor.bufferView}`)
  if ((viewDef.buffer ?? 0) !== 0 || !bin) {
    throw new RangeError(`glTF bufferView ${accessor.bufferView} requires binary chunk buffer 0`)
  }
  const viewOffset = viewDef.byteOffset ?? 0
  const viewLength = viewDef.byteLength
  const accOffset = accessor.byteOffset ?? 0
  if (viewOffset < 0 || viewLength < 0 || accOffset < 0 || viewOffset + viewLength > bin.byteLength) {
    throw new RangeError(`glTF bufferView ${accessor.bufferView} exceeds binary chunk bounds`)
  }
  const stride = viewDef.byteStride ?? minStride
  if (!Number.isInteger(stride) || stride < minStride) {
    throw new RangeError(`Invalid glTF byteStride ${stride} for accessor ${accessorIndex}`)
  }
  const start = viewOffset + accOffset
  const end = start + (accessor.count - 1) * stride + minStride
  if (end > viewOffset + viewLength || end > bin.byteLength) {
    throw new RangeError(`glTF accessor ${accessorIndex} exceeds bufferView bounds`)
  }
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  return { accessor, dv, start, stride }
}

function readPositions(gltf: GltfRoot, bin: Uint8Array | null, accessorIndex: number, world: Matrix): Float32Array {
  const { accessor, dv, start, stride } = resolveAccessorSlice(gltf, bin, accessorIndex, 12)
  if (accessor.type !== 'VEC3' || accessor.componentType !== 5126) {
    throw new RangeError(`glTF POSITION accessor ${accessorIndex} must be FLOAT VEC3`)
  }
  const out = new Float32Array(accessor.count * 3)
  for (let i = 0; i < accessor.count; i++) {
    const off = start + i * stride
    const x = dv.getFloat32(off, true)
    const y = dv.getFloat32(off + 4, true)
    const z = dv.getFloat32(off + 8, true)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new RangeError(`Non-finite vertex position in glTF accessor ${accessorIndex}`)
    }
    const [wx, wy, wz] = transformPoint(world, x, y, z)
    const dst = i * 3
    out[dst] = wx
    out[dst + 1] = wy
    out[dst + 2] = wz
  }
  return out
}

function readIndices(gltf: GltfRoot, bin: Uint8Array | null, accessorIndex: number, vertexCount: number): number[] {
  const accessor = gltf.accessors?.[accessorIndex]
  if (!accessor) throw new RangeError(`Missing glTF index accessor ${accessorIndex}`)
  if (accessor.type !== 'SCALAR') {
    throw new RangeError(`glTF index accessor ${accessorIndex} must be SCALAR`)
  }
  const compSize = accessor.componentType === 5121 ? 1
    : accessor.componentType === 5123 ? 2
    : accessor.componentType === 5125 ? 4
    : 0
  if (!compSize) {
    throw new RangeError(`Unsupported glTF index componentType ${accessor.componentType}`)
  }
  const { dv, start, stride } = resolveAccessorSlice(gltf, bin, accessorIndex, compSize)
  const out: number[] = new Array(accessor.count)
  for (let i = 0; i < accessor.count; i++) {
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

function extractMaterial(mat: GltfMaterial | undefined): { color: Color; unlit: number; material?: string } {
  if (!mat) return { color: WHITE, unlit: 0 }
  const bcf = mat.pbrMetallicRoughness?.baseColorFactor
  const br = bcf && Number.isFinite(bcf[0]) ? Math.max(0, bcf[0]) : 1
  const bg = bcf && Number.isFinite(bcf[1]) ? Math.max(0, bcf[1]) : 1
  const bb = bcf && Number.isFinite(bcf[2]) ? Math.max(0, bcf[2]) : 1
  const ba = bcf && Number.isFinite(bcf[3]) ? clamp01(bcf[3]) : 1

  const ef = mat.emissiveFactor
  const er = ef && Number.isFinite(ef[0]) ? Math.max(0, ef[0]) : 0
  const eg = ef && Number.isFinite(ef[1]) ? Math.max(0, ef[1]) : 0
  const eb = ef && Number.isFinite(ef[2]) ? Math.max(0, ef[2]) : 0

  const baseSum = br + bg + bb
  const emissiveSum = er + eg + eb
  const totalSum = baseSum + emissiveSum
  const isKhrUnlit = Boolean(mat.extensions && 'KHR_materials_unlit' in mat.extensions)

  const unlit = isKhrUnlit ? 1 : (emissiveSum > 0 && totalSum > 0 ? clamp01(emissiveSum / totalSum) : 0)
  const lr = clamp01(br + er)
  const lg = clamp01(bg + eg)
  const lb = clamp01(bb + eb)

  const color: Color = [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb), ba]
  return mat.name !== undefined ? { color, unlit, material: mat.name } : { color, unlit }
}

function primitiveTriangles(rawIndices: readonly number[], mode: number, flipWinding: boolean): number[] {
  const tris: number[] = []
  const pushTri = (a: number, b: number, c: number) => {
    if (flipWinding) tris.push(a, c, b)
    else tris.push(a, b, c)
  }

  if (mode === 4) {
    if (rawIndices.length < 3 || rawIndices.length % 3 !== 0) {
      throw new RangeError('glTF TRIANGLES primitive must contain complete triangles')
    }
    for (let i = 0; i < rawIndices.length; i += 3) {
      pushTri(rawIndices[i], rawIndices[i + 1], rawIndices[i + 2])
    }
  } else if (mode === 5) {
    for (let i = 0; i + 2 < rawIndices.length; i++) {
      if (i % 2 === 0) pushTri(rawIndices[i], rawIndices[i + 1], rawIndices[i + 2])
      else pushTri(rawIndices[i], rawIndices[i + 2], rawIndices[i + 1])
    }
  } else if (mode === 6) {
    for (let i = 1; i + 1 < rawIndices.length; i++) {
      pushTri(rawIndices[0], rawIndices[i], rawIndices[i + 1])
    }
  }
  return tris
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
  let gltf: GltfRoot
  try {
    const jsonText = new TextDecoder('utf-8').decode(u8.subarray(offset + 8, offset + 8 + jsonLength))
    gltf = JSON.parse(jsonText) as GltfRoot
  } catch (error) {
    throw new RangeError(`Invalid GLB JSON chunk: ${(error as Error).message}`)
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

  if (gltf.asset?.version && !gltf.asset.version.startsWith('2.')) {
    throw new RangeError(`Unsupported glTF asset version ${gltf.asset.version}`)
  }

  const parts: ImportedMeshPart[] = []

  function emitMesh(meshIndex: number, world: Matrix, nodeName?: string) {
    const meshDef = gltf.meshes?.[meshIndex]
    if (!meshDef) throw new RangeError(`Missing glTF mesh ${meshIndex}`)
    const primitives = meshDef.primitives ?? []
    const flipWinding = matrixDeterminant3(world) < 0
    const baseName = nodeName || meshDef.name || `mesh_${meshIndex}`

    for (let p = 0; p < primitives.length; p++) {
      const prim = primitives[p]
      const mode = prim.mode ?? 4
      if (mode !== 4 && mode !== 5 && mode !== 6) continue
      const posAccessor = prim.attributes?.POSITION
      if (posAccessor === undefined) {
        throw new RangeError(`glTF mesh ${meshIndex} primitive ${p} is missing POSITION attribute`)
      }

      const positions = readPositions(gltf, binChunk, posAccessor, world)
      const vertexCount = positions.length / 3
      const rawIndices = prim.indices !== undefined
        ? readIndices(gltf, binChunk, prim.indices, vertexCount)
        : Array.from({ length: vertexCount }, (_, idx) => idx)

      const triIndices = primitiveTriangles(rawIndices, mode, flipWinding)
      const built = buildCompactMesh(positions, triIndices)
      if (!built) continue

      const matDef = prim.material !== undefined ? gltf.materials?.[prim.material] : undefined
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

  const nodes = gltf.nodes ?? []
  const visiting = new Set<number>()

  function walkNode(nodeIndex: number, parentWorld: Matrix) {
    if (visiting.has(nodeIndex)) {
      throw new RangeError(`Cyclic glTF node hierarchy at node ${nodeIndex}`)
    }
    const node = nodes[nodeIndex]
    if (!node) throw new RangeError(`Missing glTF node ${nodeIndex}`)
    visiting.add(nodeIndex)
    const world = multiply(parentWorld, nodeLocalMatrix(node))
    if (node.mesh !== undefined) {
      emitMesh(node.mesh, world, node.name)
    }
    for (const childIndex of node.children ?? []) {
      walkNode(childIndex, world)
    }
    visiting.delete(nodeIndex)
  }

  if (gltf.scenes?.length) {
    const sceneIndex = gltf.scene ?? 0
    const scene = gltf.scenes[sceneIndex]
    if (!scene) throw new RangeError(`Missing glTF scene ${sceneIndex}`)
    for (const rootIndex of scene.nodes ?? []) {
      walkNode(rootIndex, IDENTITY)
    }
  } else if (nodes.length) {
    const childSet = new Set<number>()
    for (const node of nodes) {
      for (const child of node.children ?? []) childSet.add(child)
    }
    for (let i = 0; i < nodes.length; i++) {
      if (!childSet.has(i)) walkNode(i, IDENTITY)
    }
  } else if (gltf.meshes?.length) {
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
