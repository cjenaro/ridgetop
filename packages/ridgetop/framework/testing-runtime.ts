import type { Color, InstanceBatch, InstanceTag, Matrix, Mesh, Quaternion, Vec3 } from './types.ts'
import type { ArtModel, ArtRecipe, ArtShape } from './art-recipe.ts'
import type { SpriteClip } from './sprites.ts'

export interface CapturedFrame {
  readonly canvas: HTMLCanvasElement
  readonly viewProjection: Matrix
  readonly batches: readonly InstanceBatch[]
  readonly clear: Color
  readonly width: number
  readonly height: number
  readonly clientWidth: number
  readonly clientHeight: number
  readonly timestamp: number
}

export interface SpriteAtlasMeta {
  readonly id: string
  readonly src: string
  readonly manifestUrl?: string
  readonly frameWidth: number
  readonly frameHeight: number
  readonly rows: number
  readonly columns: number
  readonly clips: Readonly<Record<string, SpriteClip>>
  readonly image?: HTMLImageElement | HTMLCanvasElement
  /** Optional RGBA pixel buffer for headless alpha hit-testing. */
  readonly pixels?: Uint8ClampedArray
  readonly imageWidth?: number
  readonly imageHeight?: number
  readonly sourceSite?: string
}

export interface SpriteDrawRecord {
  readonly canvas: HTMLCanvasElement
  readonly atlas: SpriteAtlasMeta
  readonly clip?: string
  readonly frame: number
  readonly column: number
  readonly row: number
  readonly flip: boolean
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly point?: readonly [number, number]
}

export interface HudRegion {
  readonly id: string
  readonly label: string
  readonly asset?: string
  readonly source?: string
  readonly canvas?: HTMLCanvasElement
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly viewportWidth?: number
  readonly viewportHeight?: number
}

export interface ArtSourceInfo {
  readonly path: string
  readonly file: string | null
  readonly base: unknown
  readonly recipe?: ArtRecipe
}

export interface TestingHooks {
  snapshot?(): unknown
  restore?(scene: unknown): void | Promise<void>
  getArtSource?(asset: string): ArtSourceInfo | undefined
  onRecipeSaved?(asset: string, recipe: ArtRecipe): void
}

export interface RegisteredArtKit {
  readonly palette: Record<string, string>
  readonly models: Readonly<Record<string, ArtModel>>
  recipeFor?(name: string): ArtRecipe | undefined
  sourceSite?: string
}

export interface MeshMeta {
  readonly label?: string
  readonly sourceSite?: string
}

export interface RigMeta {
  readonly label?: string
  readonly sourceSite?: string
}

export interface Picked3DInstance {
  readonly batch: InstanceBatch
  readonly batchIndex: number
  readonly instanceIndex: number
  readonly position: Vec3
  readonly scale: Vec3
  readonly rotation: Quaternion
  readonly color: Color
  readonly unlit: number
  readonly tag?: InstanceTag
}

export interface RecognizedMember {
  readonly batchIndex: number
  readonly instanceIndex: number
  readonly part: string
  readonly joint?: string
  readonly shape?: string
  readonly colorHex: string
  readonly position: Vec3
  readonly scale: Vec3
  readonly triangles: number
  readonly unlit: number
  readonly sourceSite?: string
}

export interface RecognizedAsset {
  readonly kind: 'model' | 'rig' | 'mesh'
  readonly asset: string
  readonly instanceId: string
  readonly part?: string
  readonly joint?: string
  readonly groupId?: string
  readonly sourceSite: string
  readonly bounds: {
    readonly min: Vec3
    readonly max: Vec3
    readonly center: Vec3
    readonly size: Vec3
  }
  readonly screenBounds: readonly [number, number, number, number] | null
  readonly stats: {
    readonly instanceCount: number
    readonly triangleCount: number
    readonly vertexCount: number
    readonly batchCount: number
  }
  readonly colors: readonly string[]
  readonly members: readonly RecognizedMember[]
  readonly picked: Picked3DInstance
}

interface TestingRuntimeState {
  active: boolean
  paused: boolean
  pauseListeners: Set<(paused: boolean) => void>
  lastFrame: CapturedFrame | undefined
  spriteDrawsByCanvas: Map<HTMLCanvasElement, SpriteDrawRecord[]>
  lastSpriteDraws: SpriteDrawRecord[]
  manualHudRegions: Map<string, HudRegion>
  canvasUiRegions: Map<HTMLCanvasElement, HudRegion[]>
  hooks: Set<TestingHooks>
  hookListeners?: Set<(hooks: TestingHooks) => void>
  artKits: Set<RegisteredArtKit>
  meshMeta: WeakMap<Mesh, MeshMeta>
  rigMeta: WeakMap<object, RigMeta>
  shapeLookup: WeakMap<Mesh, ArtShape>
  nextGroupId: number
  nextAtlasId: number
}

const GLOBAL_KEY = Symbol.for('ridgetop.testing.runtime')

const ART_SHAPE_NAMES: Readonly<Record<ArtShape, true>> = {
  box: true,
  prism: true,
  cylinder: true,
  cone: true,
  octahedron: true,
  oval: true,
  dome: true,
  bowl: true,
  ring: true,
  taper: true,
  arch: true
}

function isArtShape(name: string): name is ArtShape {
  return Object.hasOwn(ART_SHAPE_NAMES, name)
}

function isTestingRuntimeState(value: unknown): value is TestingRuntimeState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'active' in value &&
    typeof value.active === 'boolean' &&
    'paused' in value &&
    typeof value.paused === 'boolean' &&
    'pauseListeners' in value &&
    value.pauseListeners instanceof Set &&
    'spriteDrawsByCanvas' in value &&
    value.spriteDrawsByCanvas instanceof Map &&
    'hooks' in value &&
    value.hooks instanceof Set &&
    'artKits' in value &&
    value.artKits instanceof Set &&
    'meshMeta' in value &&
    value.meshMeta instanceof WeakMap &&
    'rigMeta' in value &&
    value.rigMeta instanceof WeakMap &&
    'shapeLookup' in value &&
    value.shapeLookup instanceof WeakMap
  )
}

function detectUrlTesting(): boolean {
  try {
    const loc = globalThis.location
    const search = typeof loc === 'object' && loc ? loc.search : undefined
    if (!search) return false
    const params = new URLSearchParams(search)
    const flag = params.get('testing')
    return flag === '1' || flag === 'true' || params.has('review')
  } catch {
    return false
  }
}

function getState(): TestingRuntimeState {
  const existing: unknown = Reflect.get(globalThis, GLOBAL_KEY)
  if (isTestingRuntimeState(existing)) return existing
  const state: TestingRuntimeState = {
    active: detectUrlTesting(),
    paused: false,
    pauseListeners: new Set(),
    lastFrame: undefined,
    spriteDrawsByCanvas: new Map(),
    lastSpriteDraws: [],
    manualHudRegions: new Map(),
    canvasUiRegions: new Map(),
    hooks: new Set(),
    artKits: new Set(),
    meshMeta: new WeakMap(),
    rigMeta: new WeakMap(),
    shapeLookup: new WeakMap(),
    nextGroupId: 1,
    nextAtlasId: 1
  }
  Reflect.set(globalThis, GLOBAL_KEY, state)
  return state
}

export function isTestingActive(): boolean {
  return getState().active
}

export function setTestingActive(active: boolean): void {
  const state = getState()
  state.active = Boolean(active)
  if (!state.active && state.paused) setTestingPaused(false)
}

export function isTestingPaused(): boolean {
  return getState().paused
}

export function setTestingPaused(paused: boolean): void {
  const state = getState()
  const next = Boolean(paused)
  if (state.paused === next) return
  state.paused = next
  for (const listener of Array.from(state.pauseListeners)) {
    try { listener(next) } catch { /* Listener errors must not break pause state. */ }
  }
}

export function onTestingPause(listener: (paused: boolean) => void): () => void {
  const state = getState()
  state.pauseListeners.add(listener)
  return () => { state.pauseListeners.delete(listener) }
}

const INTERNAL_FILES = [
  'testing-runtime', 'testing-studio', 'testing-boot',
  'instances', 'geometry', 'low-poly', 'art', 'art-recipe', 'art-review',
  'animation', 'sprites', 'ui-canvas'
]

function normalizeStackLocation(raw: string): string | undefined {
  let loc = raw.trim()
  if (!loc) return undefined
  // Strip wrapping parentheses around stack location entries
  const paren = loc.lastIndexOf('(')
  if (paren >= 0 && loc.endsWith(')')) loc = loc.slice(paren + 1, -1)
  else if (loc.startsWith('at ')) loc = loc.slice(3).trim()
  // Firefox/Safari format: "fn@url:line:col"
  const at = loc.indexOf('@')
  if (at >= 0 && !loc.includes('://', 0) || (at >= 0 && at < loc.indexOf('://'))) {
    loc = loc.slice(at + 1)
  }
  // Match path/url + :line(:col)?
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(loc)
  if (!match) return undefined
  let file = match[1]
  const line = match[2]
  if (!file || file.startsWith('node:') || file.startsWith('internal/') || file === '<anonymous>') return undefined
  try {
    if (file.startsWith('http://') || file.startsWith('https://')) {
      file = new URL(file).pathname.replace(/^\/+/, '')
    } else if (file.startsWith('file://')) {
      file = decodeURIComponent(new URL(file).pathname)
    }
  } catch { /* Keep raw file path if URL parsing fails. */ }
  file = file.replace(/\\/g, '/')
  // Strip repo / worktree absolute prefix down to project-relative path when recognizable
  const knownRoots = ['/framework/', '/game/', '/racing/', '/lighthouse/', '/starter/', '/models/', '/test/', '/tools/', '/dist/']
  for (const marker of knownRoots) {
    const idx = file.lastIndexOf(marker)
    if (idx >= 0) {
      file = file.slice(idx + 1)
      break
    }
  }
  if (file.startsWith('dist/')) file = file.slice(5)
  file = file.replace(/^\/+/, '')
  if (!file) return undefined
  return `${file}:${line}`
}

function isInternalFrame(normalized: string): boolean {
  const filePart = normalized.split(':')[0]
  if (!filePart.startsWith('framework/')) return false
  const base = filePart.slice('framework/'.length).replace(/\.(ts|js|mjs)$/, '')
  return INTERNAL_FILES.includes(base)
}

/** Capture project-relative `file:line` creation site ONLY when testing mode is active. */
export function captureSourceSite(stackOverride?: string): string | undefined {
  const state = getState()
  if (!state.active && stackOverride === undefined) return undefined
  const stack = stackOverride ?? new Error().stack
  if (!stack) return undefined
  const lines = stack.split('\n')
  let firstFramework: string | undefined
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line === 'Error') continue
    const loc = normalizeStackLocation(line)
    if (!loc) continue
    if (loc.startsWith('framework/testing-runtime.')) continue
    if (!isInternalFrame(loc)) return loc
    if (!firstFramework) firstFramework = loc
  }
  return firstFramework
}

export function registerKnownShapes(shapes: Readonly<Record<string, Mesh>>): void {
  const state = getState()
  for (const [name, mesh] of Object.entries(shapes)) {
    if (isArtShape(name)) state.shapeLookup.set(mesh, name)
  }
}

export function getKnownShapeName(mesh: Mesh): ArtShape | undefined {
  return getState().shapeLookup.get(mesh)
}

export function recordMeshMeta(mesh: Mesh, label?: string): void {
  const state = getState()
  if (!state.active) return
  if (state.meshMeta.has(mesh)) return
  state.meshMeta.set(mesh, { label, sourceSite: captureSourceSite() })
}

export function getMeshMeta(mesh: Mesh): MeshMeta | undefined {
  return getState().meshMeta.get(mesh)
}

export function recordRigMeta(rig: object, label?: string): void {
  const state = getState()
  if (!state.active) return
  if (state.rigMeta.has(rig)) return
  state.rigMeta.set(rig, { label, sourceSite: captureSourceSite() })
}

export function getRigMeta(rig: object): RigMeta | undefined {
  return getState().rigMeta.get(rig)
}

export function nextTestingGroupId(prefix = 'grp'): string {
  const state = getState()
  return `${prefix}-${state.nextGroupId++}`
}

export function nextSpriteAtlasId(): string {
  const state = getState()
  return `atlas-${state.nextAtlasId++}`
}

export function registerArtKitRuntime(kit: RegisteredArtKit): () => void {
  const state = getState()
  state.artKits.add(kit)
  return () => { state.artKits.delete(kit) }
}

export function getRegisteredArtKits(): readonly RegisteredArtKit[] {
  return Array.from(getState().artKits)
}

export function findRegisteredArtModel(name: string): { kit: RegisteredArtKit; model: ArtModel } | undefined {
  for (const kit of getState().artKits) {
    if (Object.hasOwn(kit.models, name)) return { kit, model: kit.models[name] }
  }
  return undefined
}

export function recordFrame(frame: CapturedFrame): void {
  const state = getState()
  if (!state.active) return
  state.lastFrame = frame
}

export function getLastFrame(): CapturedFrame | undefined {
  return getState().lastFrame
}

export function recordSpriteBegin(canvas: HTMLCanvasElement): void {
  const state = getState()
  if (!state.active) return
  state.spriteDrawsByCanvas.set(canvas, [])
  rebuildLastSpriteDraws(state)
}

export function recordSpriteDraw(record: SpriteDrawRecord): void {
  const state = getState()
  if (!state.active) return
  let list = state.spriteDrawsByCanvas.get(record.canvas)
  if (!list) {
    list = []
    state.spriteDrawsByCanvas.set(record.canvas, list)
  }
  list.push(record)
  state.lastSpriteDraws.push(record)
}

function rebuildLastSpriteDraws(state: TestingRuntimeState): void {
  const all: SpriteDrawRecord[] = []
  for (const list of state.spriteDrawsByCanvas.values()) {
    for (let i = 0; i < list.length; i++) all.push(list[i])
  }
  state.lastSpriteDraws = all
}

export function getLastSpriteDraws(): readonly SpriteDrawRecord[] {
  return getState().lastSpriteDraws
}

export function registerHudRegion(region: HudRegion): () => void {
  const state = getState()
  state.manualHudRegions.set(region.id, region)
  return () => { state.manualHudRegions.delete(region.id) }
}

export function recordCanvasUiRegions(canvas: HTMLCanvasElement, regions: HudRegion[]): void {
  const state = getState()
  if (!state.active) return
  state.canvasUiRegions.set(canvas, regions)
}

export function getHudRegions(): readonly HudRegion[] {
  const state = getState()
  const out: HudRegion[] = []
  for (const region of state.manualHudRegions.values()) out.push(region)
  for (const list of state.canvasUiRegions.values()) {
    for (let i = 0; i < list.length; i++) out.push(list[i])
  }
  return out
}

export function registerTestingHooks(hooks: TestingHooks): () => void {
  const state = getState()
  state.hooks.add(hooks)
  if (state.hookListeners) {
    for (const listener of Array.from(state.hookListeners)) {
      try { listener(hooks) } catch { /* Listener errors must not break hook registration. */ }
    }
  }
  return () => { state.hooks.delete(hooks) }
}

export function onTestingHooksRegistered(listener: (hooks: TestingHooks) => void): () => void {
  const state = getState()
  state.hookListeners ??= new Set()
  state.hookListeners.add(listener)
  return () => { state.hookListeners?.delete(listener) }
}

export function getTestingHooks(): readonly TestingHooks[] {
  return Array.from(getState().hooks)
}

export function resetTestingRuntime(): void {
  const state = getState()
  state.paused = false
  state.lastFrame = undefined
  state.spriteDrawsByCanvas.clear()
  state.lastSpriteDraws = []
  state.manualHudRegions.clear()
  state.canvasUiRegions.clear()
  state.hooks.clear()
  state.artKits.clear()
  state.nextGroupId = 1
  state.nextAtlasId = 1
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
  const hex = (v: number) => clamp(v).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

const INSTANCE_STRIDE = 16

function readInstanceTransform(batch: InstanceBatch, index: number) {
  const d = batch.data
  const at = index * INSTANCE_STRIDE
  const position: Vec3 = [d[at], d[at + 1], d[at + 2]]
  const alpha = d[at + 3]
  const scale: Vec3 = [d[at + 4], d[at + 5], d[at + 6]]
  const color: Color = [d[at + 8], d[at + 9], d[at + 10], alpha]
  const unlit = d[at + 11]
  const rotation: Quaternion = [d[at + 12], d[at + 13], d[at + 14], d[at + 15]]
  return { position, scale, rotation, color, unlit }
}

function instanceWorldAabb(batch: InstanceBatch, index: number): { min: [number, number, number]; max: [number, number, number] } {
  const { position: [x, y, z], scale: [sx, sy, sz], rotation: [qx, qy, qz, qw] } = readInstanceTransform(batch, index)
  const a = 1 - 2 * (qy * qy + qz * qz), b = 2 * (qx * qy - qz * qw), c = 2 * (qx * qz + qy * qw)
  const d = 2 * (qx * qy + qz * qw), e = 1 - 2 * (qx * qx + qz * qz), f = 2 * (qy * qz - qx * qw)
  const g = 2 * (qx * qz - qy * qw), h = 2 * (qy * qz + qx * qw), k = 1 - 2 * (qx * qx + qy * qy)
  const verts = batch.mesh.data
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < verts.length; i += 6) {
    const vx = verts[i] * sx, vy = verts[i + 1] * sy, vz = verts[i + 2] * sz
    const wx = x + a * vx + b * vy + c * vz
    const wy = y + d * vx + e * vy + f * vz
    const wz = z + g * vx + h * vy + k * vz
    if (wx < minX) minX = wx
    if (wy < minY) minY = wy
    if (wz < minZ) minZ = wz
    if (wx > maxX) maxX = wx
    if (wy > maxY) maxY = wy
    if (wz > maxZ) maxZ = wz
  }
  if (!Number.isFinite(minX)) {
    const r = batch.mesh.radius * Math.max(sx, sy, sz)
    return { min: [x - r, y - r, z - r], max: [x + r, y + r, z + r] }
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
}

function aabbIntersectsExpanded(
  a: { min: readonly number[]; max: readonly number[] },
  b: { min: readonly number[]; max: readonly number[] },
  margin: number
): boolean {
  return a.min[0] - margin <= b.max[0] && a.max[0] + margin >= b.min[0] &&
    a.min[1] - margin <= b.max[1] && a.max[1] + margin >= b.min[1] &&
    a.min[2] - margin <= b.max[2] && a.max[2] + margin >= b.min[2]
}

function projectAabbToNormalizedScreen(
  matrix: Matrix,
  min: Vec3,
  max: Vec3
): readonly [number, number, number, number] | null {
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity
  let anyVisible = false
  for (let ix = 0; ix < 2; ix++) {
    const x = ix ? max[0] : min[0]
    for (let iy = 0; iy < 2; iy++) {
      const y = iy ? max[1] : min[1]
      for (let iz = 0; iz < 2; iz++) {
        const z = iz ? max[2] : min[2]
        const w = x * matrix[3] + y * matrix[7] + z * matrix[11] + matrix[15]
        if (w <= 1e-5) continue
        const nx = (x * matrix[0] + y * matrix[4] + z * matrix[8] + matrix[12]) / w
        const ny = (x * matrix[1] + y * matrix[5] + z * matrix[9] + matrix[13]) / w
        const u = (nx + 1) * 0.5
        const v = (1 - ny) * 0.5
        if (u < minU) minU = u
        if (u > maxU) maxU = u
        if (v < minV) minV = v
        if (v > maxV) maxV = v
        anyVisible = true
      }
    }
  }
  if (!anyVisible) return null
  const c0 = Math.max(0, Math.min(1, minU))
  const c1 = Math.max(0, Math.min(1, minV))
  const c2 = Math.max(0, Math.min(1, maxU))
  const c3 = Math.max(0, Math.min(1, maxV))
  if (c2 <= c0 || c3 <= c1) return null
  return [c0, c1, c2, c3]
}

function sourceSiteFor(batch: InstanceBatch, tag?: InstanceTag): string {
  return tag?.sourceFile ?? batch.meta?.sourceFile ?? batch.meta?.sourceSite ?? getMeshMeta(batch.mesh)?.sourceSite ?? 'runtime'
}

function deriveUntaggedName(batch: InstanceBatch, sourceSite: string, shape?: string): string {
  if (batch.meta?.asset) return batch.meta.asset
  if (batch.meta?.label) return batch.meta.label
  const meshLabel = getMeshMeta(batch.mesh)?.label
  if (meshLabel) return meshLabel
  if (sourceSite && sourceSite !== 'runtime') {
    const base = sourceSite.split('/').at(-1)?.replace(/\.(ts|js|mjs)(?=:|$)/, '') ?? sourceSite
    return shape ? `${shape} (${base})` : base
  }
  const tris = Math.round(batch.mesh.vertexCount / 3)
  return shape ? `${shape}-mesh` : `mesh-${tris}tri`
}

/**
 * Automatically recognize and group a picked 3D instance (tagged ArtKit/Rig OR zero-tag plain mesh).
 * Returns inferred assembly bounds, screen rect, colors, triangle stats, and creation-site source attribution.
 */
export function recognizeAssetFromPick(
  batches: readonly InstanceBatch[],
  viewProjection: Matrix,
  picked: Picked3DInstance
): RecognizedAsset {
  const tag = picked.tag
  const kind: 'model' | 'rig' | 'mesh' = tag?.kind ?? picked.batch.meta?.kind ?? 'mesh'
  const groupId = tag?.groupId
  const selectedSlots: { batch: InstanceBatch; batchIndex: number; instanceIndex: number; aabb: { min: [number, number, number]; max: [number, number, number] } }[] = []

  if (groupId) {
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi]
      const tags = batch.meta?.tags
      if (!tags) continue
      for (let ii = 0; ii < batch.count; ii++) {
        if (tags[ii]?.groupId === groupId) {
          selectedSlots.push({ batch, batchIndex: bi, instanceIndex: ii, aabb: instanceWorldAabb(batch, ii) })
        }
      }
    }
  } else {
    // Zero-tag automatic grouping: start with the picked instance and merge touching/co-located parts
    // while avoiding swallowing giant background/ground slabs.
    const seedAabb = instanceWorldAabb(picked.batch, picked.instanceIndex)
    const seedSize = [
      seedAabb.max[0] - seedAabb.min[0],
      seedAabb.max[1] - seedAabb.min[1],
      seedAabb.max[2] - seedAabb.min[2]
    ]
    const seedMaxExtent = Math.max(seedSize[0], seedSize[1], seedSize[2], 0.1)
    const margin = Math.min(0.6, Math.max(0.12, seedMaxExtent * 0.25))
    const pickedSite = sourceSiteFor(picked.batch, tag)

    const visited = new Set<string>()
    const key = (bi: number, ii: number) => `${bi}:${ii}`
    const queue = [{ batch: picked.batch, batchIndex: picked.batchIndex, instanceIndex: picked.instanceIndex, aabb: seedAabb }]
    visited.add(key(picked.batchIndex, picked.instanceIndex))
    selectedSlots.push(queue[0])

    const MAX_GROUP = 64
    let head = 0
    while (head < queue.length && selectedSlots.length < MAX_GROUP) {
      const current = queue[head++]
      for (let bi = 0; bi < batches.length && selectedSlots.length < MAX_GROUP; bi++) {
        const batch = batches[bi]
        if (!batch.count) continue
        // Quick batch AABB reject
        if (!aabbIntersectsExpanded(current.aabb, batch, margin)) continue
        const batchSite = sourceSiteFor(batch)
        const sameSite = pickedSite !== 'runtime' && batchSite === pickedSite
        for (let ii = 0; ii < batch.count && selectedSlots.length < MAX_GROUP; ii++) {
          const slotKey = key(bi, ii)
          if (visited.has(slotKey)) continue
          // Do not merge tagged ArtKit/Rig instances into an untagged mesh group
          const otherTag = batch.meta?.tags?.[ii]
          if (otherTag?.groupId) continue
          const candAabb = instanceWorldAabb(batch, ii)
          const candExtent = Math.max(
            candAabb.max[0] - candAabb.min[0],
            candAabb.max[1] - candAabb.min[1],
            candAabb.max[2] - candAabb.min[2]
          )
          // Skip giant floor/terrain slabs relative to a small prop (unless same source site)
          if (!sameSite && candExtent > seedMaxExtent * 4) continue
          if (aabbIntersectsExpanded(current.aabb, candAabb, sameSite ? margin * 1.25 : margin)) {
            visited.add(slotKey)
            const entry = { batch, batchIndex: bi, instanceIndex: ii, aabb: candAabb }
            selectedSlots.push(entry)
            queue.push(entry)
          }
        }
      }
    }
  }

  if (!selectedSlots.length) {
    selectedSlots.push({
      batch: picked.batch,
      batchIndex: picked.batchIndex,
      instanceIndex: picked.instanceIndex,
      aabb: instanceWorldAabb(picked.batch, picked.instanceIndex)
    })
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let triangleCount = 0
  let vertexCount = 0
  const batchIndices = new Set<number>()
  const colorSet = new Set<string>()
  const members: RecognizedMember[] = []

  for (let i = 0; i < selectedSlots.length; i++) {
    const slot = selectedSlots[i]
    const { batch, batchIndex, instanceIndex, aabb } = slot
    if (aabb.min[0] < minX) minX = aabb.min[0]
    if (aabb.min[1] < minY) minY = aabb.min[1]
    if (aabb.min[2] < minZ) minZ = aabb.min[2]
    if (aabb.max[0] > maxX) maxX = aabb.max[0]
    if (aabb.max[1] > maxY) maxY = aabb.max[1]
    if (aabb.max[2] > maxZ) maxZ = aabb.max[2]
    batchIndices.add(batchIndex)
    const tris = Math.round(batch.mesh.vertexCount / 3)
    triangleCount += tris
    vertexCount += batch.mesh.vertexCount
    const tf = readInstanceTransform(batch, instanceIndex)
    const colorHex = rgbToHex(tf.color[0], tf.color[1], tf.color[2])
    colorSet.add(colorHex)
    const slotTag = batch.meta?.tags?.[instanceIndex]
    const shape = getKnownShapeName(batch.mesh)
    members.push({
      batchIndex,
      instanceIndex,
      part: slotTag?.part ?? (shape ? `${shape}-${i + 1}` : `part-${i + 1}`),
      joint: slotTag?.joint,
      shape,
      colorHex,
      position: tf.position,
      scale: tf.scale,
      triangles: tris,
      unlit: tf.unlit,
      sourceSite: sourceSiteFor(batch, slotTag)
    })
  }

  const min: Vec3 = [minX, minY, minZ]
  const max: Vec3 = [maxX, maxY, maxZ]
  const center: Vec3 = [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5]
  const size: Vec3 = [maxX - minX, maxY - minY, maxZ - minZ]
  const sourceSite = sourceSiteFor(picked.batch, tag)
  const pickedShape = getKnownShapeName(picked.batch.mesh)
  const asset = tag?.asset ?? deriveUntaggedName(picked.batch, sourceSite, pickedShape)
  const instanceId = tag?.instanceId ?? groupId ?? `batch-${picked.batchIndex}-inst-${picked.instanceIndex}`

  return {
    kind,
    asset,
    instanceId,
    part: tag?.part ?? (pickedShape ?? `part-1`),
    joint: tag?.joint,
    groupId,
    sourceSite,
    bounds: { min, max, center, size },
    screenBounds: projectAabbToNormalizedScreen(viewProjection, min, max),
    stats: {
      instanceCount: selectedSlots.length,
      triangleCount,
      vertexCount,
      batchCount: batchIndices.size
    },
    colors: Array.from(colorSet),
    members,
    picked
  }
}
