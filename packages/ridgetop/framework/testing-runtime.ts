import type { Color, InstanceBatch, InstanceTag, Matrix, Mesh, Quaternion, Vec3 } from './types.ts'
import type { ArtModel, ArtRecipe, ArtShape } from './art-recipe.ts'
import type { SpriteClip } from './sprites.ts'
import { resolveTestingUrlActivation } from './testing-protocol.ts'
import { recognizeAssetFromPick as recognizeAssetFromPickImpl } from './testing-recognition.ts'

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

export interface DecisionAgentOption {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly category?: string
  readonly heuristicScore?: number
}

export interface DecisionAgentEvidence {
  readonly id: string
  readonly value: unknown
  readonly label?: string
}

export interface DecisionAgentObservation {
  readonly ready: boolean
  readonly status: string
  readonly summary?: string
  readonly rubric: string
  readonly state: unknown
  readonly options: readonly DecisionAgentOption[]
  readonly evidence: readonly DecisionAgentEvidence[]
}

export interface DecisionAgentResult {
  readonly choice: string
  readonly provider?: string
  readonly model?: string
  readonly confidence?: number
  readonly probabilities?: Readonly<Record<string, number>>
  readonly evidence?: readonly string[]
  readonly evidenceProbabilities?: Readonly<Record<string, number>>
  readonly bugProbability?: number
  readonly bugSuspected?: boolean
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
  }
  readonly latencyMs?: number
  readonly cached?: boolean
}

export interface DecisionAgentAdapter {
  readonly name: string
  readonly description?: string
  readonly stepIntervalMs?: number
  ensurePlayable?(): void | Promise<void>
  observe(): DecisionAgentObservation | null
  act(optionId: string, decision?: DecisionAgentResult): boolean | void | Promise<boolean | void>
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
  decisionAgents?: Set<DecisionAgentAdapter>
  decisionAgentListeners?: Set<() => void>
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
  arch: true,
  wedge: true,
  gable: true,
  teardrop: true
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
    return resolveTestingUrlActivation(search, false)
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
  'testing-runtime', 'testing-studio', 'testing-session', 'testing-protocol', 'testing-recognition',
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
  const knownRoots = [
    '/examples/', '/crownshard/', '/framework/', '/game/', '/racing/', '/lighthouse/',
    '/starter/', '/models/', '/test/', '/tools/', '/dist/'
  ]
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

function isDisconnectedCanvas(canvas: HTMLCanvasElement): boolean {
  return typeof canvas.isConnected === 'boolean' && !canvas.isConnected
}

function pruneSpriteDraws(state: TestingRuntimeState): boolean {
  let pruned = false
  for (const canvas of Array.from(state.spriteDrawsByCanvas.keys())) {
    if (isDisconnectedCanvas(canvas)) {
      state.spriteDrawsByCanvas.delete(canvas)
      pruned = true
    }
  }
  return pruned
}

function pruneCanvasUiRegions(state: TestingRuntimeState): void {
  for (const canvas of Array.from(state.canvasUiRegions.keys())) {
    if (isDisconnectedCanvas(canvas)) {
      state.canvasUiRegions.delete(canvas)
    }
  }
}

export function recordSpriteBegin(canvas: HTMLCanvasElement): void {
  const state = getState()
  if (!state.active) return
  pruneSpriteDraws(state)
  if (!isDisconnectedCanvas(canvas)) {
    state.spriteDrawsByCanvas.set(canvas, [])
  }
  rebuildLastSpriteDraws(state)
}

export function recordSpriteDraw(record: SpriteDrawRecord): void {
  const state = getState()
  if (!state.active) return
  if (isDisconnectedCanvas(record.canvas)) return
  if (pruneSpriteDraws(state)) rebuildLastSpriteDraws(state)
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
  for (const [canvas, list] of state.spriteDrawsByCanvas.entries()) {
    if (isDisconnectedCanvas(canvas)) {
      state.spriteDrawsByCanvas.delete(canvas)
      continue
    }
    for (let i = 0; i < list.length; i++) all.push(list[i])
  }
  state.lastSpriteDraws = all
}

export function getLastSpriteDraws(): readonly SpriteDrawRecord[] {
  const state = getState()
  if (pruneSpriteDraws(state)) rebuildLastSpriteDraws(state)
  return state.lastSpriteDraws
}

export function registerHudRegion(region: HudRegion): () => void {
  const state = getState()
  state.manualHudRegions.set(region.id, region)
  return () => { state.manualHudRegions.delete(region.id) }
}

export function recordCanvasUiRegions(canvas: HTMLCanvasElement, regions: HudRegion[]): void {
  const state = getState()
  if (!state.active) return
  pruneCanvasUiRegions(state)
  if (!isDisconnectedCanvas(canvas)) {
    state.canvasUiRegions.set(canvas, regions)
  }
}

export function getHudRegions(): readonly HudRegion[] {
  const state = getState()
  pruneCanvasUiRegions(state)
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

export function registerDecisionAgent(adapter: DecisionAgentAdapter): () => void {
  const state = getState()
  state.decisionAgents ??= new Set()
  state.decisionAgents.add(adapter)
  if (state.decisionAgentListeners) {
    for (const listener of Array.from(state.decisionAgentListeners)) {
      try { listener() } catch { /* Listener errors must not break registration. */ }
    }
  }
  return () => {
    state.decisionAgents?.delete(adapter)
    if (state.decisionAgentListeners) {
      for (const listener of Array.from(state.decisionAgentListeners)) {
        try { listener() } catch { /* Listener errors must not break unregistration. */ }
      }
    }
  }
}

export function onDecisionAgentsChanged(listener: () => void): () => void {
  const state = getState()
  state.decisionAgentListeners ??= new Set()
  state.decisionAgentListeners.add(listener)
  return () => { state.decisionAgentListeners?.delete(listener) }
}

export function getDecisionAgents(): readonly DecisionAgentAdapter[] {
  return Array.from(getState().decisionAgents ?? [])
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
  state.decisionAgents?.clear()
  state.artKits.clear()
  state.nextGroupId = 1
  state.nextAtlasId = 1
}

/**
 * Automatically recognize and group a picked 3D instance (tagged ArtKit/Rig OR zero-tag plain mesh).
 * Delegates to `testing-recognition.ts` so runtime instrumentation stays slim while keeping `ridgetop/testing` stable.
 */
export function recognizeAssetFromPick(
  batches: readonly InstanceBatch[],
  viewProjection: Matrix,
  picked: Picked3DInstance
): RecognizedAsset {
  return recognizeAssetFromPickImpl(batches, viewProjection, picked)
}
