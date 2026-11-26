import { createAlphaSorter, multiply, orthographic, view } from './geometry.ts'
import { frustum, visible } from './instances.ts'
import { parseHexRgba } from './sprite-sheet.ts'
import type {
  BlendMode, Color, InstanceBatch, LightingInput, LightingOptions, Matrix, Mesh,
  PreparedLighting, RenderStats, Vec3
} from './types.ts'

export const LIGHT_FLOATS = 72
export const GPU_LIGHT_FLOATS = 88
export const SHADOW_MAP_SIZE = 1024

const OFF_SUN_DIR = 0
const OFF_SUN_COLOR = 4
const OFF_FOG = 8
const OFF_FOG_EXTRA = 12
const OFF_POINT_POS = 16
const OFF_POINT_COL = 32
const OFF_SKY_HEMI = 48
const OFF_GROUND_TOON = 52
const OFF_RIM = 56
const OFF_SHADOW_CENTER = 60
const OFF_SHADOW_PARAMS = 64
const OFF_SHADOW_COLOR = 68
const OFF_LIGHT_MATRIX = 72

const IDENTITY_MATRIX: Matrix = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
])

export function color(hex: string): Color {
  try {
    const [r, g, b, a] = parseHexRgba(hex, true)
    return [r / 255, g / 255, b / 255, a / 255]
  } catch {
    throw new RangeError('Invalid hex color: ' + hex)
  }
}

function resetDefaultLight(out: Float32Array<ArrayBuffer>) {
  out.fill(0)
  out[OFF_SUN_DIR] = -0.48
  out[OFF_SUN_DIR + 1] = 0.8
  out[OFF_SUN_DIR + 2] = 0.36
  out[OFF_SUN_DIR + 3] = 0.52
  out[OFF_SUN_COLOR] = 1
  out[OFF_SUN_COLOR + 1] = 1
  out[OFF_SUN_COLOR + 2] = 1
  out[OFF_SUN_COLOR + 3] = 0
}

export function packLighting(
  options: LightingOptions = {},
  prev?: Float32Array<ArrayBuffer>,
  dest?: Float32Array<ArrayBuffer>
): Float32Array<ArrayBuffer> {
  const out = dest && dest.length >= LIGHT_FLOATS ? dest : new Float32Array(LIGHT_FLOATS)
  if (prev && prev !== out) {
    out.fill(0)
    if (prev.length >= 48) out.set(prev.subarray(0, Math.min(prev.length, LIGHT_FLOATS)))
    else resetDefaultLight(out)
  } else if (!prev) {
    resetDefaultLight(out)
  }
  const direction = options.direction ?? [out[OFF_SUN_DIR], out[OFF_SUN_DIR + 1], out[OFF_SUN_DIR + 2]]
  const ambient = options.ambient ?? out[OFF_SUN_DIR + 3]
  const [x, y, z] = direction
  const length = Math.hypot(x, y, z)
  if (!length || !Number.isFinite(length) || !(ambient >= 0 && ambient <= 1)) {
    throw new RangeError('Expected a nonzero light direction and ambient in the range 0–1')
  }
  out[OFF_SUN_DIR] = x / length
  out[OFF_SUN_DIR + 1] = y / length
  out[OFF_SUN_DIR + 2] = z / length
  out[OFF_SUN_DIR + 3] = ambient

  if (options.color) {
    out[OFF_SUN_COLOR] = options.color[0]
    out[OFF_SUN_COLOR + 1] = options.color[1]
    out[OFF_SUN_COLOR + 2] = options.color[2]
  }
  if (options.fogColor) {
    out[OFF_FOG] = options.fogColor[0]
    out[OFF_FOG + 1] = options.fogColor[1]
    out[OFF_FOG + 2] = options.fogColor[2]
  }
  if (options.fogNear !== undefined || options.fogFar !== undefined) {
    const prevNear = out[OFF_FOG + 3]
    const near = options.fogNear ?? prevNear
    const far = options.fogFar ?? (out[OFF_FOG_EXTRA] > 0 ? prevNear + 1 / out[OFF_FOG_EXTRA] : near)
    out[OFF_FOG + 3] = Number.isFinite(near) ? near : 0
    out[OFF_FOG_EXTRA] = Number.isFinite(far) && far > near ? 1 / (far - near) : 0
  }
  if (options.points !== undefined) {
    const count = Math.min(4, options.points.length)
    out[OFF_SUN_COLOR + 3] = count
    for (let i = 0; i < 4; i++) {
      const pBase = OFF_POINT_POS + i * 4
      const cBase = OFF_POINT_COL + i * 4
      if (i < count) {
        const pt = options.points[i]
        const rad = Math.max(0.05, pt.radius)
        out[pBase] = pt.position[0]
        out[pBase + 1] = pt.position[1]
        out[pBase + 2] = pt.position[2]
        out[pBase + 3] = 1 / (rad * rad)
        out[cBase] = pt.color[0]
        out[cBase + 1] = pt.color[1]
        out[cBase + 2] = pt.color[2]
        out[cBase + 3] = pt.intensity ?? 1
      } else {
        out[pBase] = out[pBase + 1] = out[pBase + 2] = out[pBase + 3] = 0
        out[cBase] = out[cBase + 1] = out[cBase + 2] = out[cBase + 3] = 0
      }
    }
  }
  if (options.skyColor || options.groundColor) {
    const hadHemi = out[OFF_SKY_HEMI + 3] > 0
    const sky = options.skyColor ?? (hadHemi ? [out[OFF_SKY_HEMI], out[OFF_SKY_HEMI + 1], out[OFF_SKY_HEMI + 2]] : [0.72, 0.84, 0.98])
    const ground = options.groundColor ?? (hadHemi ? [out[OFF_GROUND_TOON], out[OFF_GROUND_TOON + 1], out[OFF_GROUND_TOON + 2]] : [0.36, 0.30, 0.28])
    out[OFF_SKY_HEMI] = sky[0]
    out[OFF_SKY_HEMI + 1] = sky[1]
    out[OFF_SKY_HEMI + 2] = sky[2]
    out[OFF_SKY_HEMI + 3] = 1
    out[OFF_GROUND_TOON] = ground[0]
    out[OFF_GROUND_TOON + 1] = ground[1]
    out[OFF_GROUND_TOON + 2] = ground[2]
  }
  if (options.toonSteps !== undefined) {
    out[OFF_GROUND_TOON + 3] = Number.isFinite(options.toonSteps) && options.toonSteps >= 2 ? Math.floor(options.toonSteps) : 0
  }
  if (options.rimColor !== undefined) {
    out[OFF_RIM] = options.rimColor[0]
    out[OFF_RIM + 1] = options.rimColor[1]
    out[OFF_RIM + 2] = options.rimColor[2]
  }
  if (options.rimStrength !== undefined) {
    out[OFF_RIM + 3] = Number.isFinite(options.rimStrength) ? Math.max(0, Math.min(1, options.rimStrength)) : 0
    if (out[OFF_RIM + 3] > 0 && out[OFF_RIM] === 0 && out[OFF_RIM + 1] === 0 && out[OFF_RIM + 2] === 0) {
      out[OFF_RIM] = 1
      out[OFF_RIM + 1] = 1
      out[OFF_RIM + 2] = 1
    }
  }
  if (options.shadows !== undefined) {
    const sh = options.shadows
    const hadShadow = out[OFF_SHADOW_PARAMS + 3] > 0.5
    const enabled = sh.enabled !== undefined ? (sh.enabled ? 1 : 0) : out[OFF_SHADOW_PARAMS]
    const prevExt = out[OFF_SHADOW_CENTER + 3] > 0 ? out[OFF_SHADOW_CENTER + 3] : 24
    out[OFF_SHADOW_CENTER] = sh.center ? sh.center[0] : out[OFF_SHADOW_CENTER]
    out[OFF_SHADOW_CENTER + 1] = sh.center ? sh.center[1] : out[OFF_SHADOW_CENTER + 1]
    out[OFF_SHADOW_CENTER + 2] = sh.center ? sh.center[2] : out[OFF_SHADOW_CENTER + 2]
    out[OFF_SHADOW_CENTER + 3] = sh.extent !== undefined && Number.isFinite(sh.extent) && sh.extent > 1 ? sh.extent : prevExt
    out[OFF_SHADOW_PARAMS] = enabled
    out[OFF_SHADOW_PARAMS + 1] = sh.bias !== undefined && Number.isFinite(sh.bias) ? Math.max(0.0001, sh.bias) : (hadShadow ? out[OFF_SHADOW_PARAMS + 1] : 0.0028)
    out[OFF_SHADOW_PARAMS + 2] = sh.strength !== undefined && Number.isFinite(sh.strength) ? Math.max(0, Math.min(1, sh.strength)) : (hadShadow ? out[OFF_SHADOW_PARAMS + 2] : 0.46)
    out[OFF_SHADOW_PARAMS + 3] = 1
    if (sh.color) {
      out[OFF_SHADOW_COLOR] = sh.color[0]
      out[OFF_SHADOW_COLOR + 1] = sh.color[1]
      out[OFF_SHADOW_COLOR + 2] = sh.color[2]
      out[OFF_SHADOW_COLOR + 3] = 0
    } else if (!hadShadow) {
      out[OFF_SHADOW_COLOR] = 0.22
      out[OFF_SHADOW_COLOR + 1] = 0.28
      out[OFF_SHADOW_COLOR + 2] = 0.42
      out[OFF_SHADOW_COLOR + 3] = 0
    }
  }
  return out
}

function buildShadowMatrix(
  lx: number, ly: number, lz: number,
  cx: number, cy: number, cz: number,
  extent: number
): Matrix {
  const clampedY = Math.max(0.22, ly)
  const len = Math.hypot(lx, clampedY, lz) || 1
  const dx = lx / len, dy = clampedY / len, dz = lz / len
  const safeExtent = extent > 1 ? extent : 24
  const dist = safeExtent * 2.2
  const eye: Vec3 = [cx + dx * dist, cy + dy * dist, cz + dz * dist]
  const up: Vec3 = Math.abs(dy) > 0.96 ? [0, 0, 1] : [0, 1, 0]
  return multiply(orthographic(safeExtent * 2, safeExtent * 2, 0.5, safeExtent * 4.6), view(eye, [cx, cy, cz], up))
}

/** Build an orthographic directional sun view-projection matrix for shadow mapping. */
export function computeShadowMatrix(light: Float32Array | PreparedLighting): Matrix {
  if (light instanceof Float32Array) {
    return buildShadowMatrix(
      light[OFF_SUN_DIR], light[OFF_SUN_DIR + 1], light[OFF_SUN_DIR + 2],
      light[OFF_SHADOW_CENTER] || 0, light[OFF_SHADOW_CENTER + 1] || 0, light[OFF_SHADOW_CENTER + 2] || 0,
      light[OFF_SHADOW_CENTER + 3]
    )
  }
  return buildShadowMatrix(
    light.sunDir[0], light.sunDir[1], light.sunDir[2],
    light.shadowCenter[0], light.shadowCenter[1], light.shadowCenter[2],
    light.shadowExtent
  )
}

interface MutablePointLight {
  x: number
  y: number
  z: number
  invRadiusSq: number
  r: number
  g: number
  b: number
  intensity: number
}

export interface LightingState extends PreparedLighting {
  update(next: LightingOptions): void
}

function createPreparedLightingFromBuffer(packed: Float32Array<ArrayBuffer>): LightingState {
  const gpuUniforms = new Float32Array(GPU_LIGHT_FLOATS)
  const lightMatrix = new Float32Array(IDENTITY_MATRIX)
  const lightPlanes = new Float32Array(24)
  const sunDir: [number, number, number] = [0, 1, 0]
  const sunColor: [number, number, number] = [1, 1, 1]
  const fogColor: [number, number, number] = [0, 0, 0]
  const skyColor: [number, number, number] = [0, 0, 0]
  const groundColor: [number, number, number] = [0, 0, 0]
  const rimColor: [number, number, number] = [0, 0, 0]
  const shadowCenter: [number, number, number] = [0, 0, 0]
  const shadowColor: [number, number, number] = [0.22, 0.28, 0.42]
  const points: MutablePointLight[] = [
    { x: 0, y: 0, z: 0, invRadiusSq: 0, r: 0, g: 0, b: 0, intensity: 0 },
    { x: 0, y: 0, z: 0, invRadiusSq: 0, r: 0, g: 0, b: 0, intensity: 0 },
    { x: 0, y: 0, z: 0, invRadiusSq: 0, r: 0, g: 0, b: 0, intensity: 0 },
    { x: 0, y: 0, z: 0, invRadiusSq: 0, r: 0, g: 0, b: 0, intensity: 0 }
  ]
  const views = {
    sunDir: packed.subarray(OFF_SUN_DIR, OFF_SUN_DIR + 4),
    sunColor: packed.subarray(OFF_SUN_COLOR, OFF_SUN_COLOR + 4),
    fog: packed.subarray(OFF_FOG, OFF_FOG + 4),
    fogExtra: packed.subarray(OFF_FOG_EXTRA, OFF_FOG_EXTRA + 4),
    pointPos: packed.subarray(OFF_POINT_POS, OFF_POINT_POS + 16),
    pointCol: packed.subarray(OFF_POINT_COL, OFF_POINT_COL + 16),
    skyHemi: packed.subarray(OFF_SKY_HEMI, OFF_SKY_HEMI + 4),
    groundToon: packed.subarray(OFF_GROUND_TOON, OFF_GROUND_TOON + 4),
    rimLight: packed.subarray(OFF_RIM, OFF_RIM + 4),
    shadowParams: packed.subarray(OFF_SHADOW_PARAMS, OFF_SHADOW_PARAMS + 4),
    shadowColor: packed.subarray(OFF_SHADOW_COLOR, OFF_SHADOW_COLOR + 4)
  }

  let ambient = 0.52
  let fogNear = 0
  let invFogSpan = 0
  let pointCount = 0
  let hasHemi = false
  let toonSteps = 0
  let rimStrength = 0
  let shadowsEnabled = false
  let shadowExtent = 24
  let shadowBias = 0.0028
  let shadowStrength = 0.46
  let revision = 0

  function sync() {
    sunDir[0] = packed[OFF_SUN_DIR]
    sunDir[1] = packed[OFF_SUN_DIR + 1]
    sunDir[2] = packed[OFF_SUN_DIR + 2]
    ambient = packed[OFF_SUN_DIR + 3]
    sunColor[0] = packed[OFF_SUN_COLOR]
    sunColor[1] = packed[OFF_SUN_COLOR + 1]
    sunColor[2] = packed[OFF_SUN_COLOR + 2]
    pointCount = Math.max(0, Math.min(4, Math.round(packed[OFF_SUN_COLOR + 3])))
    fogColor[0] = packed[OFF_FOG]
    fogColor[1] = packed[OFF_FOG + 1]
    fogColor[2] = packed[OFF_FOG + 2]
    fogNear = packed[OFF_FOG + 3]
    invFogSpan = packed[OFF_FOG_EXTRA]
    for (let i = 0; i < 4; i++) {
      const pBase = OFF_POINT_POS + i * 4
      const cBase = OFF_POINT_COL + i * 4
      const pt = points[i]
      pt.x = packed[pBase]
      pt.y = packed[pBase + 1]
      pt.z = packed[pBase + 2]
      pt.invRadiusSq = packed[pBase + 3]
      pt.r = packed[cBase]
      pt.g = packed[cBase + 1]
      pt.b = packed[cBase + 2]
      pt.intensity = packed[cBase + 3]
    }
    hasHemi = packed[OFF_SKY_HEMI + 3] > 0.5
    skyColor[0] = hasHemi ? packed[OFF_SKY_HEMI] : 0
    skyColor[1] = hasHemi ? packed[OFF_SKY_HEMI + 1] : 0
    skyColor[2] = hasHemi ? packed[OFF_SKY_HEMI + 2] : 0
    groundColor[0] = hasHemi ? packed[OFF_GROUND_TOON] : 0
    groundColor[1] = hasHemi ? packed[OFF_GROUND_TOON + 1] : 0
    groundColor[2] = hasHemi ? packed[OFF_GROUND_TOON + 2] : 0
    toonSteps = packed[OFF_GROUND_TOON + 3] >= 2 ? packed[OFF_GROUND_TOON + 3] : 0
    rimStrength = packed[OFF_RIM + 3] > 0 ? packed[OFF_RIM + 3] : 0
    rimColor[0] = rimStrength > 0 ? packed[OFF_RIM] : 0
    rimColor[1] = rimStrength > 0 ? packed[OFF_RIM + 1] : 0
    rimColor[2] = rimStrength > 0 ? packed[OFF_RIM + 2] : 0
    shadowCenter[0] = packed[OFF_SHADOW_CENTER] || 0
    shadowCenter[1] = packed[OFF_SHADOW_CENTER + 1] || 0
    shadowCenter[2] = packed[OFF_SHADOW_CENTER + 2] || 0
    shadowExtent = packed[OFF_SHADOW_CENTER + 3] > 1 ? packed[OFF_SHADOW_CENTER + 3] : 24
    shadowsEnabled = packed[OFF_SHADOW_PARAMS] > 0.5
    shadowBias = packed[OFF_SHADOW_PARAMS + 1]
    shadowStrength = packed[OFF_SHADOW_PARAMS + 2]
    shadowColor[0] = packed[OFF_SHADOW_COLOR]
    shadowColor[1] = packed[OFF_SHADOW_COLOR + 1]
    shadowColor[2] = packed[OFF_SHADOW_COLOR + 2]

    if (shadowsEnabled) {
      lightMatrix.set(buildShadowMatrix(
        sunDir[0], sunDir[1], sunDir[2],
        shadowCenter[0], shadowCenter[1], shadowCenter[2],
        shadowExtent
      ))
      frustum(lightMatrix, lightPlanes)
    } else {
      lightMatrix.set(IDENTITY_MATRIX)
      lightPlanes.fill(0)
    }
    gpuUniforms.set(packed, 0)
    gpuUniforms.set(lightMatrix, OFF_LIGHT_MATRIX)
    revision++
  }

  sync()

  return {
    sunDir,
    get ambient() { return ambient },
    sunColor,
    fogColor,
    get fogNear() { return fogNear },
    get invFogSpan() { return invFogSpan },
    get pointCount() { return pointCount },
    points,
    get hasHemi() { return hasHemi },
    skyColor,
    groundColor,
    get toonSteps() { return toonSteps },
    rimColor,
    get rimStrength() { return rimStrength },
    get shadowsEnabled() { return shadowsEnabled },
    shadowCenter,
    get shadowExtent() { return shadowExtent },
    get shadowBias() { return shadowBias },
    get shadowStrength() { return shadowStrength },
    shadowColor,
    lightMatrix,
    lightPlanes,
    packed,
    gpuUniforms,
    views,
    get revision() { return revision },
    update(next: LightingOptions) {
      packLighting(next, packed, packed)
      sync()
    }
  }
}

export function createLightingState(options?: LightingOptions): LightingState {
  return createPreparedLightingFromBuffer(packLighting(options))
}

export function prepareLighting(options?: LightingOptions): PreparedLighting {
  return createLightingState(options)
}

export function normalizeLighting(input: LightingInput): PreparedLighting {
  if (!(input instanceof Float32Array)) return input
  const packed = new Float32Array(LIGHT_FLOATS)
  packed.set(input.subarray(0, Math.min(input.length, LIGHT_FLOATS)))
  if (input.length < 48) {
    packed[OFF_SUN_COLOR] = 1
    packed[OFF_SUN_COLOR + 1] = 1
    packed[OFF_SUN_COLOR + 2] = 1
  }
  return createPreparedLightingFromBuffer(packed)
}

export function gpuLightingUniforms(
  lighting: PreparedLighting,
  allowShadows: boolean,
  scratch: Float32Array<ArrayBuffer>
): Float32Array<ArrayBuffer> {
  if (allowShadows || !lighting.shadowsEnabled) return lighting.gpuUniforms
  scratch.set(lighting.gpuUniforms)
  scratch[OFF_SHADOW_PARAMS] = 0
  return scratch
}

export function glShadowParams(
  lighting: PreparedLighting,
  allowShadows: boolean,
  scratch: Float32Array<ArrayBuffer>
): Float32Array<ArrayBuffer> {
  if (allowShadows || !lighting.shadowsEnabled) return lighting.views.shadowParams
  scratch.set(lighting.views.shadowParams)
  scratch[0] = 0
  return scratch
}

/** Pack mesh positions, normals, and optional vertex RGB colors into a 9-float (36-byte) interleaved vertex buffer. */
export function packMeshVertices(mesh: Mesh): Float32Array<ArrayBuffer> {
  const count = mesh.vertexCount
  const out = new Float32Array(count * 9)
  const src = mesh.data
  const cols = mesh.colors && mesh.colors.length >= count * 3 ? mesh.colors : undefined
  for (let i = 0; i < count; i++) {
    const s = i * 6, d = i * 9
    out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]
    out[d + 3] = src[s + 3]; out[d + 4] = src[s + 4]; out[d + 5] = src[s + 5]
    if (cols) {
      const c = i * 3
      out[d + 6] = cols[c]; out[d + 7] = cols[c + 1]; out[d + 8] = cols[c + 2]
    } else {
      out[d + 6] = 1; out[d + 7] = 1; out[d + 8] = 1
    }
  }
  return out
}

export interface CameraTracker {
  readonly revision: number
  update(matrix: Matrix): boolean
}

export function createCameraTracker(): CameraTracker {
  const last = new Float32Array(16)
  let has = false
  let revision = 0
  return {
    get revision() { return revision },
    update(matrix: Matrix): boolean {
      let changed = !has
      if (!changed) {
        for (let i = 0; i < 16; i++) {
          if (matrix[i] !== last[i]) { changed = true; break }
        }
      }
      if (changed) {
        last.set(matrix)
        has = true
        revision++
      }
      return changed
    }
  }
}

export interface ShadowCasterTracker {
  markDirty(): void
  needsUpdate(casters: readonly InstanceBatch[]): boolean
  commit(casters: readonly InstanceBatch[]): void
}

export function createShadowCasterTracker(): ShadowCasterTracker {
  let dirty = true
  const lastBatches: InstanceBatch[] = []
  const lastRevs: number[] = []
  return {
    markDirty() { dirty = true },
    needsUpdate(casters: readonly InstanceBatch[]): boolean {
      if (dirty || casters.length !== lastBatches.length) return true
      for (let i = 0; i < casters.length; i++) {
        if (casters[i] !== lastBatches[i] || casters[i].revision !== lastRevs[i]) return true
      }
      return false
    },
    commit(casters: readonly InstanceBatch[]) {
      lastBatches.length = casters.length
      lastRevs.length = casters.length
      for (let i = 0; i < casters.length; i++) {
        lastBatches[i] = casters[i]
        lastRevs[i] = casters[i].revision
      }
      dirty = false
    }
  }
}

export interface BatchUploadState {
  revision: number
  cameraRevision?: number
  lastOrder?: Int32Array
  lastCount?: number
  sorted?: boolean
}

export function resolveBatchUpload(
  state: BatchUploadState,
  batch: InstanceBatch,
  blend: BlendMode,
  matrix: Matrix,
  cameraRevision: number,
  instanceSorter: ReturnType<typeof createAlphaSorter>
): Float32Array<ArrayBuffer> | null {
  if (blend === 'alpha' && batch.count > 1) {
    const revisionChanged = state.revision !== batch.revision
    if (revisionChanged || state.cameraRevision !== cameraRevision || !state.sorted) {
      const count = batch.count
      const { inOrder, indices } = instanceSorter.sortInstanceIndices(matrix, batch.data, count)
      let orderChanged = revisionChanged || !state.sorted || state.lastCount !== count
      if (!orderChanged && state.lastOrder) {
        for (let k = 0; k < count; k++) {
          if (state.lastOrder[k] !== indices[k]) { orderChanged = true; break }
        }
      }
      state.cameraRevision = cameraRevision
      if (orderChanged) {
        const uploadData = inOrder ? batch.data : instanceSorter.packInstances(batch.data, count)
        if (!state.lastOrder || state.lastOrder.length < count) {
          state.lastOrder = new Int32Array(Math.max(count, state.lastOrder ? state.lastOrder.length * 2 : 16))
        }
        for (let k = 0; k < count; k++) state.lastOrder[k] = indices[k]
        state.lastCount = count
        state.revision = batch.revision
        state.sorted = true
        return uploadData
      }
    }
    return null
  }
  if (state.revision !== batch.revision) {
    state.revision = batch.revision
    state.sorted = false
    return batch.data
  }
  return null
}

/**
 * Draw visible batches in submission order when `alphaBatchesSorted` is already guaranteed by the
 * frame preparer, or sort contiguous alpha runs back-to-front for direct backend callers.
 */
export function forEachOrderedBatch(
  matrix: Matrix,
  batches: readonly InstanceBatch[],
  alphaBatchesSorted: boolean,
  getBatchSorter: () => ReturnType<typeof createAlphaSorter>,
  drawBatch: (batch: InstanceBatch) => void
) {
  if (alphaBatchesSorted) {
    for (let i = 0; i < batches.length; i++) drawBatch(batches[i])
    return
  }
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    if ((batch.blend ?? 'opaque') === 'alpha') {
      let j = i + 1
      while (j < batches.length && (batches[j].blend ?? 'opaque') === 'alpha') j++
      const runLen = j - i
      if (runLen > 1) {
        const { inOrder, indices } = getBatchSorter().sortBatchIndices(matrix, batches, i, runLen)
        if (inOrder) {
          for (let k = i; k < j; k++) drawBatch(batches[k])
        } else {
          for (let k = 0; k < runLen; k++) drawBatch(batches[i + indices[k]])
        }
        i = j - 1
        continue
      }
    }
    drawBatch(batch)
  }
}

export interface PreparedFrame {
  readonly visible: readonly InstanceBatch[]
  readonly shadowCasters?: readonly InstanceBatch[]
}

export interface FramePreparer {
  prepare(
    matrix: Matrix,
    batches: Iterable<InstanceBatch>,
    lighting: PreparedLighting,
    useShadows: boolean,
    stats: RenderStats
  ): PreparedFrame
}

export function createFramePreparer(): FramePreparer {
  const selected: InstanceBatch[] = []
  const alphaBatches: InstanceBatch[] = []
  const additiveBatches: InstanceBatch[] = []
  const shadowCasters: InstanceBatch[] = []
  const alphaSorter = createAlphaSorter(16)
  const planes = new Float32Array(24)

  return {
    prepare(matrix, batches, lighting, useShadows, stats) {
      frustum(matrix, planes)
      selected.length = 0
      alphaBatches.length = 0
      additiveBatches.length = 0
      shadowCasters.length = 0
      stats.triangles = stats.instances = stats.uploadBytes = stats.culledBatches = 0

      for (const batch of batches) {
        if (visible(batch, planes)) {
          if (batch.blend === 'opaque') selected.push(batch)
          else if (batch.blend === 'alpha') alphaBatches.push(batch)
          else additiveBatches.push(batch)
          stats.triangles += batch.mesh.vertexCount / 3 * batch.count
          stats.instances += batch.count
        } else if (batch.count) stats.culledBatches++
        if (useShadows && batch.blend === 'opaque' && visible(batch, lighting.lightPlanes)) {
          shadowCasters.push(batch)
        }
      }
      if (alphaBatches.length > 1) {
        alphaSorter.sortBatches(matrix, alphaBatches, selected)
      } else if (alphaBatches.length === 1) {
        selected.push(alphaBatches[0])
      }
      for (let i = 0; i < additiveBatches.length; i++) selected.push(additiveBatches[i])
      stats.drawCalls = selected.length
      return { visible: selected, shadowCasters: useShadows ? shadowCasters : undefined }
    }
  }
}
