import { artModels, createArtRecipe } from './art.ts'
import { fitArtRecipe } from './art-builder.ts'
import {
  artPalette, artShapes, checkArtPaletteColor, checkArtPartStyle, checkFrameSize,
  modelFromArtRecipe, parseArtTube
} from './art-recipe.ts'
import type { ArtModel, ArtRecipe, ArtRecipePart, ArtShape, ArtTone } from './art-recipe.ts'
import { pickRenderedScene, pickSpriteDraws } from './art-review.ts'
import type { ArtPin, ArtReview, ArtView, PickedSpriteDraw, ReviewScope, ReviewSurface } from './art-review.ts'
import {
  allowedScopesForSurface, checkPin, checkSpriteManifest, isRecord, isReviewScope, isReviewStatus,
  parseReviewEntry, parseReviewList, protocolError, validateReviewComment, validateReviewId
} from './testing-protocol.ts'
import type {
  CreateReviewInput, ReviewEntry, ReviewListResult, ReviewStorePort, SaveRecipeInput,
  SaveRecipeResult, SaveSpriteInput, SaveSpriteResult, SpriteManifestInput, UpdateReviewInput
} from './testing-protocol.ts'
import { recognizeAssetFromPick } from './testing-recognition.ts'
import {
  findRegisteredArtModel, getHudRegions, getLastFrame, getLastSpriteDraws, getTestingHooks,
  isTestingPaused, onTestingHooksRegistered, onTestingPause, setTestingPaused
} from './testing-runtime.ts'
import type {
  ArtSourceInfo, CapturedFrame, HudRegion, RecognizedAsset, RegisteredArtKit,
  SpriteDrawRecord, TestingHooks
} from './testing-runtime.ts'
import type { BlendMode, Vec3 } from './types.ts'

export interface ViewportRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface ArtPartEditPatch {
  name?: string
  shape?: ArtShape | 'tube'
  tone?: ArtTone
  position?: Vec3
  scale?: Vec3
  /** Euler rotation in degrees `[pitchDeg, yawDeg, rollDeg]`. */
  rotationDeg?: readonly [number, number, number]
  /** Optional explicit Euler radians (takes precedence over `rotationDeg` when provided). */
  pitch?: number | null
  yaw?: number | null
  roll?: number | null
  unlit?: number | null
  alpha?: number | null
  blend?: BlendMode | null
  shade?: number | null
  joint?: string | null
  points?: readonly Vec3[]
  radii?: number | readonly number[]
  sides?: number
}

export interface ArtRecipeEditor {
  getRecipe(): ArtRecipe
  getOriginal(): ArtRecipe
  isDirty(): boolean
  canUndo(): boolean
  getSelectedPartIndex(): number
  getSelectedPart(): ArtRecipePart
  getAvailableShapes(index?: number): (ArtShape | 'tube')[]
  getAvailableTones(): string[]
  getPaletteColor(tone: string): string
  toJson(): string
  selectPart(indexOrName: number | string): ArtRecipePart
  updatePart(patch: ArtPartEditPatch, index?: number): ArtRecipePart
  addPart(spec?: Partial<Omit<ArtRecipePart, 'name'>> & { name?: string }): { index: number; part: ArtRecipePart }
  duplicatePart(index?: number): { index: number; part: ArtRecipePart }
  deletePart(index?: number): { index: number; part: ArtRecipePart }
  setPaletteColor(tone: string, hex: string): void
  setFrameSize(frameSize: number): void
  setTiming(clip: string, frameMs: number): void
  fitAndGround(): ArtRecipe
  undo(): boolean
  discard(): void
  markSaved(savedRecipe?: ArtRecipe): void
}

export interface StudioSelection {
  surface: ReviewSurface
  asset: string
  instanceId: string
  source: string
  part?: string
  scope: ReviewScope
  region: [number, number, number, number]
  recognized?: RecognizedAsset
  spriteHit?: PickedSpriteDraw
  hudRegion?: HudRegion
  screenRect?: ViewportRect
  artSource?: ArtSourceInfo
  recipeEditor?: ArtRecipeEditor
  previewYaw: number
  previewElevation: number
  spriteClip?: string
  spriteFrame: number
  spriteFrameMs: number
  savedView?: ArtView
}

export type PickResult =
  | { readonly picked: true; readonly selection: StudioSelection; readonly message: string }
  | { readonly picked: false; readonly blocked?: 'not-paused' | 'busy' | 'dirty'; readonly message: string }

export interface ReloadCompareState {
  readonly ridgetopStudio: {
    readonly reviewId?: string
    readonly scene: unknown
  }
}

export interface TestingStudioEnvironment {
  getHudRegions?(): readonly HudRegion[]
  getLastSpriteDraws?(): readonly SpriteDrawRecord[]
  getLastFrame?(): CapturedFrame | undefined
  getTestingHooks?(): readonly TestingHooks[]
  findRegisteredArtModel?(name: string): { kit: RegisteredArtKit; model: ArtModel } | undefined
  getElementRect?(el: HTMLCanvasElement): ViewportRect
  getViewportSize?(): { width: number; height: number }
  getLocationUrl?(): string
  generateId?(): string
  isPaused?(): boolean
  setPaused?(paused: boolean): void
  onPause?(listener: (paused: boolean) => void): () => void
  onHooksRegistered?(listener: (hooks: TestingHooks) => void): () => void
}

export interface MemoryReviewStore extends ReviewStorePort {
  getBeforePng(id: string): string | undefined
  getSavedRecipe(key: string): ArtRecipe | undefined
  getSavedSprite(key: string): { png?: string; manifest?: SpriteManifestInput; files: string[] } | undefined
  /** Simulate an out-of-band edit (e.g., an agent replying on disk) to test conflict detection. */
  mutateReviewExternally(id: string, mutate: (note: ArtReview) => void): ReviewEntry
}

export interface TestingStudioSession {
  readonly store: ReviewStorePort
  isPaused(): boolean
  isDirty(): boolean
  isBusy(): boolean
  getStatus(): string
  setStatus(message: string): void
  getSelection(): StudioSelection | undefined
  getActiveReview(): ReviewEntry | undefined
  getRecipeEditor(): ArtRecipeEditor | undefined
  listReviews(): ReviewEntry[]
  getReview(id: string): ReviewEntry | undefined
  beforeImageUrl(id: string): string
  setPaused(paused: boolean): { ok: boolean; reason?: string }
  pickAt(clientX: number, clientY: number): PickResult
  selectPart(partName: string | undefined): void
  setScope(scope: ReviewScope): void
  setRegion(region: [number, number, number, number]): void
  setPreviewOrbit(yaw: number, elevation: number): void
  selectSpriteClip(clip: string | undefined): void
  setSpriteFrame(frame: number): void
  setSpriteFrameMs(frameMs: number): void
  buildArtView(sel?: StudioSelection): ArtView
  buildPin(sel?: StudioSelection): ArtPin
  captureSnapshot(): unknown
  restoreSnapshot(scene: unknown): Promise<void>
  lookupArtSource(asset: string): ArtSourceInfo | undefined
  fitRecipe(): ArtRecipe
  discardRecipeEdits(): void
  undoRecipeEdit(): boolean
  saveRecipe(): Promise<SaveRecipeResult>
  saveSprite(pngBase64?: string): Promise<SaveSpriteResult>
  refreshReviews(): Promise<ReviewListResult>
  createReview(comment: string, pngBase64: string): Promise<ReviewEntry>
  replyToReview(reply: string): Promise<ReviewEntry>
  toggleResolveReview(reply?: string): Promise<ReviewEntry>
  deleteReview(id?: string): Promise<void>
  openReview(idOrEntry: string | ReviewEntry): Promise<StudioSelection>
  prepareReloadCompareState(): ReloadCompareState
  resumeFromNavigation(input: { historyState?: unknown; search?: string }): Promise<{
    openedReview?: ReviewEntry
    restoredScene?: boolean
    clearHistoryState: boolean
  }>
  onChange(listener: () => void): () => void
  dispose(): void
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function isBuiltInArtModel(name: string): name is keyof typeof artModels {
  return Object.hasOwn(artModels, name)
}

function isArtShape(value: string): value is ArtShape {
  return Object.hasOwn(artShapes, value)
}

function isBaseArtTone(value: string): value is keyof typeof artPalette {
  return Object.hasOwn(artPalette, value)
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

export function surfaceLabel(surface: ReviewSurface): string {
  if (surface === 'model') return '3D Model'
  if (surface === 'rig') return '3D Rig'
  if (surface === 'mesh') return '3D Mesh'
  if (surface === 'sprite') return '2D Sprite'
  return 'HUD'
}

function recipeUsesV2Features(recipe: ArtRecipe): boolean {
  if (recipe.joints?.length || recipe.clips) return true
  for (let i = 0; i < recipe.parts.length; i++) {
    const p = recipe.parts[i]
    if (
      p.shape === 'tube' ||
      p.alpha !== undefined ||
      p.blend !== undefined ||
      p.shade !== undefined ||
      p.joint !== undefined ||
      !isBaseArtTone(p.tone)
    ) {
      return true
    }
  }
  for (const key of Object.keys(recipe.palette)) {
    if (!isBaseArtTone(key)) return true
  }
  return false
}

function uniquePartName(parts: readonly ArtRecipePart[], base: string): string {
  let idx = 2
  let candidate = base
  while (parts.some(p => p.name === candidate)) candidate = `${base}-${idx++}`
  return candidate
}

/**
 * Create a headless `.art.json` recipe editor shared by Testing Studio and Sprite Workshop.
 * Supports v1 + v2 parts (including lossless tube preservation), palette editing, `fitArtRecipe`
 * grounding, undo history, dirty tracking, and validation against `modelFromArtRecipe`.
 */
export function createArtRecipeEditor(initial: ArtRecipe, initialPart?: string): ArtRecipeEditor {
  modelFromArtRecipe(initial)
  let original = structuredClone(initial)
  let draft = structuredClone(initial)
  const undoStack: ArtRecipe[] = []
  let selectedPartIndex = initialPart
    ? Math.max(0, draft.parts.findIndex(p => p.name === initialPart))
    : 0
  let dirty = false

  function pushUndo() {
    undoStack.push(structuredClone(draft))
    if (undoStack.length > 50) undoStack.shift()
  }

  function commitCandidate(candidate: ArtRecipe, nextSelectedIndex?: number) {
    if (recipeUsesV2Features(candidate) && candidate.version < 2) {
      candidate.version = 2
    }
    modelFromArtRecipe(candidate)
    pushUndo()
    draft = candidate
    if (nextSelectedIndex !== undefined) {
      selectedPartIndex = Math.max(0, Math.min(draft.parts.length - 1, nextSelectedIndex))
    } else {
      selectedPartIndex = Math.max(0, Math.min(draft.parts.length - 1, selectedPartIndex))
    }
    dirty = !jsonEqual(draft, original)
  }

  return {
    getRecipe() {
      return draft
    },
    getOriginal() {
      return original
    },
    isDirty() {
      return dirty
    },
    canUndo() {
      return undoStack.length > 0
    },
    getSelectedPartIndex() {
      return selectedPartIndex
    },
    getSelectedPart() {
      return draft.parts[selectedPartIndex]
    },
    getAvailableShapes(index = selectedPartIndex) {
      const shapes: (ArtShape | 'tube')[] = Object.keys(artShapes).filter(isArtShape)
      if (draft.parts[index]?.shape === 'tube') shapes.push('tube')
      return shapes
    },
    getAvailableTones() {
      const tones = Object.keys(artPalette)
      for (const tone of Object.keys(draft.palette)) {
        if (!tones.includes(tone)) tones.push(tone)
      }
      return tones
    },
    getPaletteColor(tone: string) {
      const baseLookup: Record<string, string | undefined> = artPalette
      const raw = draft.palette[tone] ?? baseLookup[tone] ?? '#ffffff'
      return raw.startsWith('#') ? raw : '#' + raw
    },
    toJson() {
      return JSON.stringify(draft, null, 2) + '\n'
    },
    selectPart(indexOrName: number | string) {
      if (typeof indexOrName === 'number') {
        if (!Number.isInteger(indexOrName) || indexOrName < 0 || indexOrName >= draft.parts.length) {
          throw new RangeError('Part index out of range.')
        }
        selectedPartIndex = indexOrName
      } else {
        const idx = draft.parts.findIndex(p => p.name === indexOrName)
        if (idx < 0) throw new RangeError('Unknown part: ' + indexOrName)
        selectedPartIndex = idx
      }
      return draft.parts[selectedPartIndex]
    },
    updatePart(patch: ArtPartEditPatch, index = selectedPartIndex) {
      if (!Number.isInteger(index) || index < 0 || index >= draft.parts.length) {
        throw new RangeError('Part index out of range.')
      }
      const candidate = structuredClone(draft)
      const part = candidate.parts[index]

      if (patch.name !== undefined) {
        const nextName = patch.name.trim()
        if (!nextName) throw new Error('Part name cannot be empty.')
        if (nextName !== part.name && candidate.parts.some((p, i) => i !== index && p.name === nextName)) {
          throw new Error('Duplicate part name: ' + nextName)
        }
        part.name = nextName
      }

      if (patch.shape !== undefined) {
        if (part.shape === 'tube') {
          if (patch.shape !== 'tube') {
            throw new Error('Cannot change shape of a tube part directly.')
          }
        } else {
          if (patch.shape === 'tube') {
            const checked = parseArtTube(patch.points ?? part.points, patch.radii ?? part.radii, patch.sides ?? part.sides, part.name)
            part.shape = 'tube'
            part.points = checked.points
            part.radii = checked.radii
            part.sides = checked.sides
          } else if (!isArtShape(patch.shape)) {
            throw new Error('Unknown shape: ' + patch.shape)
          } else {
            part.shape = patch.shape
          }
        }
      }

      if (part.shape === 'tube' && (patch.points !== undefined || patch.radii !== undefined || patch.sides !== undefined)) {
        const checked = parseArtTube(
          patch.points ?? part.points,
          patch.radii ?? part.radii,
          patch.sides ?? part.sides,
          part.name
        )
        part.points = checked.points
        part.radii = checked.radii
        part.sides = checked.sides
      }

      if (patch.tone !== undefined) {
        if (!isBaseArtTone(patch.tone) && !Object.hasOwn(candidate.palette, patch.tone)) {
          throw new Error('Unknown tone: ' + patch.tone)
        }
        part.tone = patch.tone
      }

      if (patch.position !== undefined) {
        if (
          patch.position.length !== 3 ||
          !Number.isFinite(patch.position[0]) ||
          !Number.isFinite(patch.position[1]) ||
          !Number.isFinite(patch.position[2])
        ) {
          throw new RangeError('Positions must be finite and scales must be positive.')
        }
        part.position = [patch.position[0], patch.position[1], patch.position[2]]
      }

      if (patch.scale !== undefined) {
        if (
          patch.scale.length !== 3 ||
          !(Number.isFinite(patch.scale[0]) && patch.scale[0] > 0) ||
          !(Number.isFinite(patch.scale[1]) && patch.scale[1] > 0) ||
          !(Number.isFinite(patch.scale[2]) && patch.scale[2] > 0)
        ) {
          throw new RangeError('Positions must be finite and scales must be positive.')
        }
        part.scale = [patch.scale[0], patch.scale[1], patch.scale[2]]
      }

      if (patch.rotationDeg !== undefined) {
        const axes = ['pitch', 'yaw', 'roll'] as const
        for (let i = 0; i < 3; i++) {
          const deg = patch.rotationDeg[i]
          if (!Number.isFinite(deg)) throw new RangeError('Rotation angles must be finite numbers.')
          const axis = axes[i]
          const curDeg = (part[axis] ?? 0) * 180 / Math.PI
          if (Math.abs(deg - curDeg) > 1e-9) {
            const rad = deg * Math.PI / 180
            part[axis] = rad || undefined
          }
        }
      }

      const explicitAxes = [
        ['pitch', patch.pitch],
        ['yaw', patch.yaw],
        ['roll', patch.roll]
      ] as const
      for (const [axis, val] of explicitAxes) {
        if (val === undefined) continue
        if (val === null || val === 0) {
          part[axis] = undefined
        } else if (!Number.isFinite(val)) {
          throw new RangeError('Rotation angles must be finite numbers.')
        } else {
          part[axis] = val
        }
      }

      if (patch.unlit !== undefined) {
        if (patch.unlit === null || patch.unlit === 0) {
          part.unlit = undefined
        } else {
          checkArtPartStyle({ unlit: patch.unlit }, part.name)
          part.unlit = patch.unlit
        }
      }

      if (patch.alpha !== undefined) {
        if (patch.alpha === null) {
          part.alpha = undefined
        } else {
          checkArtPartStyle({ alpha: patch.alpha }, part.name)
          part.alpha = patch.alpha
        }
      }

      if (patch.blend !== undefined) {
        if (patch.blend === null) {
          part.blend = undefined
        } else {
          checkArtPartStyle({ blend: patch.blend }, part.name)
          part.blend = patch.blend
        }
      }

      if (patch.shade !== undefined) {
        if (patch.shade === null || patch.shade === 0) {
          part.shade = undefined
        } else {
          checkArtPartStyle({ shade: patch.shade }, part.name)
          part.shade = patch.shade
        }
      }

      if (patch.joint !== undefined) {
        part.joint = patch.joint === null || patch.joint === '' ? undefined : patch.joint
      }

      commitCandidate(candidate, index)
      return draft.parts[selectedPartIndex]
    },
    addPart(spec = {}) {
      const candidate = structuredClone(draft)
      const baseName = spec.name?.trim() || 'part'
      const name = uniquePartName(candidate.parts, baseName)
      const nextPart: ArtRecipePart = {
        name,
        shape: spec.shape ?? 'prism',
        position: spec.position ? [spec.position[0], spec.position[1], spec.position[2]] : [0, 0.5, 0],
        scale: spec.scale ? [spec.scale[0], spec.scale[1], spec.scale[2]] : [0.35, 0.35, 0.35],
        tone: spec.tone ?? 'accent',
        ...(spec.pitch ? { pitch: spec.pitch } : {}),
        ...(spec.yaw ? { yaw: spec.yaw } : {}),
        ...(spec.roll ? { roll: spec.roll } : {}),
        ...(spec.unlit ? { unlit: spec.unlit } : {}),
        ...(spec.alpha !== undefined ? { alpha: spec.alpha } : {}),
        ...(spec.blend !== undefined ? { blend: spec.blend } : {}),
        ...(spec.shade !== undefined ? { shade: spec.shade } : {}),
        ...(spec.joint !== undefined ? { joint: spec.joint } : {}),
        ...(spec.points !== undefined ? { points: spec.points.map(p => [p[0], p[1], p[2]] as const) } : {}),
        ...(spec.radii !== undefined ? { radii: typeof spec.radii === 'number' ? spec.radii : spec.radii.slice() } : {}),
        ...(spec.sides !== undefined ? { sides: spec.sides } : {})
      }
      candidate.parts.push(nextPart)
      commitCandidate(candidate, candidate.parts.length - 1)
      return { index: selectedPartIndex, part: draft.parts[selectedPartIndex] }
    },
    duplicatePart(index = selectedPartIndex) {
      if (!Number.isInteger(index) || index < 0 || index >= draft.parts.length) {
        throw new RangeError('Part index out of range.')
      }
      const candidate = structuredClone(draft)
      const cur = candidate.parts[index]
      const copy = structuredClone(cur)
      copy.name = uniquePartName(candidate.parts, cur.name + '-copy')
      copy.position = [round3(cur.position[0] + 0.15), cur.position[1], cur.position[2]]
      candidate.parts.splice(index + 1, 0, copy)
      commitCandidate(candidate, index + 1)
      return { index: selectedPartIndex, part: draft.parts[selectedPartIndex] }
    },
    deletePart(index = selectedPartIndex) {
      if (draft.parts.length <= 1) {
        throw new Error('A model recipe must keep at least one part.')
      }
      if (!Number.isInteger(index) || index < 0 || index >= draft.parts.length) {
        throw new RangeError('Part index out of range.')
      }
      const candidate = structuredClone(draft)
      candidate.parts.splice(index, 1)
      const nextIndex = Math.max(0, Math.min(candidate.parts.length - 1, index - 1))
      commitCandidate(candidate, nextIndex)
      return { index: selectedPartIndex, part: draft.parts[selectedPartIndex] }
    },
    setPaletteColor(tone: string, hex: string) {
      const checked = checkArtPaletteColor(tone, hex)
      const normalized = checked.startsWith('#') ? checked : '#' + checked
      const candidate = structuredClone(draft)
      candidate.palette[tone] = normalized
      commitCandidate(candidate)
    },
    setFrameSize(frameSize: number) {
      checkFrameSize(frameSize)
      const candidate = structuredClone(draft)
      candidate.frameSize = frameSize
      commitCandidate(candidate)
    },
    setTiming(clip: string, frameMs: number) {
      const candidate = structuredClone(draft)
      ;(candidate.timings ??= {})[clip] = frameMs
      commitCandidate(candidate)
    },
    fitAndGround() {
      const fitted = fitArtRecipe(structuredClone(draft))
      commitCandidate(fitted)
      return draft
    },
    undo() {
      const prev = undoStack.pop()
      if (!prev) return false
      draft = prev
      selectedPartIndex = Math.max(0, Math.min(draft.parts.length - 1, selectedPartIndex))
      dirty = !jsonEqual(draft, original)
      return true
    },
    discard() {
      draft = structuredClone(original)
      undoStack.length = 0
      selectedPartIndex = Math.max(0, Math.min(draft.parts.length - 1, selectedPartIndex))
      dirty = false
    },
    markSaved(savedRecipe?: ArtRecipe) {
      const next = savedRecipe ? structuredClone(savedRecipe) : structuredClone(draft)
      original = structuredClone(next)
      draft = next
      undoStack.length = 0
      selectedPartIndex = Math.max(0, Math.min(draft.parts.length - 1, selectedPartIndex))
      dirty = false
    }
  }
}

/** Production HTTP ReviewStorePort adapter communicating with `/__testing/*` endpoints. */
export function createHttpReviewStore(options: { baseUrl?: string; fetchFn?: typeof fetch } = {}): ReviewStorePort {
  const base = (options.baseUrl ?? '').replace(/\/$/, '')
  const doFetch = options.fetchFn ?? fetch
  const reviewsApi = base + '/__testing/reviews'
  const recipeApi = base + '/__testing/recipe'
  const spriteApi = base + '/__testing/sprite'

  async function apiJson(url: string, method = 'GET', body?: unknown): Promise<unknown> {
    const res = await doFetch(url, {
      method,
      cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    const data: unknown = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = isRecord(data) && typeof data.error === 'string' ? data.error : `Request failed (${res.status})`
      protocolError(msg, res.status)
    }
    return data
  }

  return {
    async listReviews() {
      return parseReviewList(await apiJson(reviewsApi))
    },
    async createReview(input: CreateReviewInput) {
      validateReviewId(input.id)
      checkPin(input.target)
      const comment = validateReviewComment(input.comment)
      return parseReviewEntry(await apiJson(reviewsApi, 'POST', { ...input, comment }))
    },
    async updateReview(id: string, input: UpdateReviewInput) {
      validateReviewId(id)
      if (!isReviewStatus(input.status)) protocolError('Invalid review status.')
      const reply = input.reply !== undefined ? validateReviewComment(input.reply) : undefined
      return parseReviewEntry(await apiJson(`${reviewsApi}/${id}`, 'PATCH', {
        revision: input.revision,
        status: input.status,
        ...(reply !== undefined ? { reply } : {})
      }))
    },
    async deleteReview(id: string) {
      validateReviewId(id)
      await apiJson(`${reviewsApi}/${id}`, 'DELETE')
    },
    beforeImageUrl(id: string) {
      return `${reviewsApi}/${id}/before.png`
    },
    async saveRecipe(input: SaveRecipeInput) {
      modelFromArtRecipe(input.recipe)
      const data = await apiJson(recipeApi, 'POST', input)
      if (!isRecord(data) || data.saved !== true || typeof data.file !== 'string') {
        protocolError('Unexpected recipe save response from server.', 500)
      }
      return { saved: true, file: data.file }
    },
    async saveSprite(input: SaveSpriteInput) {
      if (input.png === undefined && input.manifest === undefined) {
        protocolError('Provide a PNG image, a sprite manifest, or both.')
      }
      if (input.manifest !== undefined) checkSpriteManifest(input.manifest)
      const data = await apiJson(spriteApi, 'POST', input)
      if (!isRecord(data) || data.saved !== true || !Array.isArray(data.files)) {
        protocolError('Unexpected sprite save response from server.', 500)
      }
      const files = data.files.filter((f): f is string => typeof f === 'string')
      return { saved: true, files }
    }
  }
}

/** Deterministic in-memory ReviewStorePort adapter enforcing the exact same shared protocol invariants. */
export function createMemoryReviewStore(options: {
  now?: () => string
  initialReviews?: readonly ArtReview[]
  initialRecipes?: Readonly<Record<string, ArtRecipe>>
} = {}): MemoryReviewStore {
  const now = options.now ?? (() => new Date().toISOString())
  const reviews = new Map<string, { note: ArtReview; revision: string; png: string }>()
  const recipes = new Map<string, ArtRecipe>()
  const sprites = new Map<string, { png?: string; manifest?: SpriteManifestInput; files: string[] }>()
  let revSeq = 1

  const nextRevision = (id: string) => `mem-rev-${id.slice(0, 8)}-${revSeq++}`

  if (options.initialReviews) {
    for (const r of options.initialReviews) {
      const cloned = structuredClone(r)
      reviews.set(cloned.id, { note: cloned, revision: nextRevision(cloned.id), png: '' })
    }
  }
  if (options.initialRecipes) {
    for (const [key, value] of Object.entries(options.initialRecipes)) {
      recipes.set(key, structuredClone(value))
    }
  }

  return {
    async listReviews() {
      const entries = Array.from(reviews.values())
        .map(item => ({ note: structuredClone(item.note), revision: item.revision }))
        .sort((a, b) => b.note.created.localeCompare(a.note.created))
      return { entries, errors: [] }
    },
    async createReview(input: CreateReviewInput) {
      const id = validateReviewId(input.id)
      checkPin(input.target)
      const comment = validateReviewComment(input.comment)
      if (typeof input.png !== 'string' || !input.png.length) {
        protocolError('Expected a PNG preview.')
      }
      const existing = reviews.get(id)
      if (existing) {
        if (
          existing.note.comment !== comment ||
          !jsonEqual(existing.note.target, input.target) ||
          !jsonEqual(existing.note.scene, input.scene)
        ) {
          protocolError('This review ID already belongs to a different comment.', 409)
        }
        return { note: structuredClone(existing.note), revision: existing.revision }
      }
      const note: ArtReview = {
        version: 1,
        id,
        created: now(),
        status: 'open',
        comment,
        target: structuredClone(input.target),
        scene: structuredClone(input.scene),
        before: id + '.png',
        replies: []
      }
      const revision = nextRevision(id)
      reviews.set(id, { note, revision, png: input.png })
      return { note: structuredClone(note), revision }
    },
    async updateReview(id: string, input: UpdateReviewInput) {
      validateReviewId(id)
      const existing = reviews.get(id)
      if (!existing) protocolError('Review not found.', 404)
      if (existing.revision !== input.revision) {
        protocolError('The review changed on disk. Refresh the reviews and try again.', 409)
      }
      if (!isReviewStatus(input.status)) protocolError('Invalid review status.')
      existing.note.status = input.status
      if (input.reply) {
        existing.note.replies.push({ text: validateReviewComment(input.reply), date: now() })
      }
      existing.revision = nextRevision(id)
      return { note: structuredClone(existing.note), revision: existing.revision }
    },
    async deleteReview(id: string) {
      validateReviewId(id)
      if (!reviews.delete(id)) protocolError('Review not found.', 404)
    },
    beforeImageUrl(id: string) {
      return `memory://reviews/${id}/before.png`
    },
    async saveRecipe(input: SaveRecipeInput) {
      if (
        typeof input.asset !== 'string' ||
        !/^[a-z0-9][a-z0-9_-]*$/i.test(input.asset) ||
        input.asset === '__proto__' ||
        input.asset === 'constructor' ||
        input.asset === 'prototype'
      ) {
        protocolError('Invalid model role.')
      }
      modelFromArtRecipe(input.recipe)
      const key = input.file ?? `art/overrides.json#${input.asset}`
      const current = recipes.get(key) ?? null
      if (!jsonEqual(current, input.base)) {
        protocolError('The model changed on disk. Reload before editing it.', 409)
      }
      recipes.set(key, structuredClone(input.recipe))
      return { saved: true, file: input.file ?? 'art/overrides.json' }
    },
    async saveSprite(input: SaveSpriteInput) {
      if (input.png === undefined && input.manifest === undefined) {
        protocolError('Provide a PNG image, a sprite manifest, or both.')
      }
      if (input.manifest !== undefined) checkSpriteManifest(input.manifest)
      const stem = (input.file ?? `art/${input.name ?? 'sprite'}`).replace(/\.(?:png|json)$/i, '')
      if (/\.art$/i.test(stem) || stem === 'art/overrides') {
        protocolError('Sprite endpoint cannot overwrite recipe or overrides files.')
      }
      const files: string[] = []
      if (input.png !== undefined) files.push(stem + '.png')
      if (input.manifest !== undefined) files.push(stem + '.json')
      sprites.set(stem, {
        png: input.png,
        manifest: input.manifest ? structuredClone(input.manifest) : undefined,
        files
      })
      return { saved: true, files }
    },
    getBeforePng(id: string) {
      return reviews.get(id)?.png
    },
    getSavedRecipe(key: string) {
      const found = recipes.get(key)
      return found ? structuredClone(found) : undefined
    },
    getSavedSprite(key: string) {
      const found = sprites.get(key)
      return found ? structuredClone(found) : undefined
    },
    mutateReviewExternally(id: string, mutate: (note: ArtReview) => void) {
      const existing = reviews.get(id)
      if (!existing) protocolError('Review not found.', 404)
      mutate(existing.note)
      existing.revision = nextRevision(id)
      return { note: structuredClone(existing.note), revision: existing.revision }
    }
  }
}

function defaultElementRect(el: HTMLCanvasElement): ViewportRect {
  if (typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  return { left: 0, top: 0, width: el.width || 0, height: el.height || 0 }
}

function defaultViewportSize(): { width: number; height: number } {
  if (typeof window !== 'undefined') {
    return { width: window.innerWidth, height: window.innerHeight }
  }
  return { width: 1280, height: 720 }
}

function defaultLocationUrl(): string {
  if (typeof location !== 'undefined') return location.pathname + location.search
  return '/'
}

function defaultGenerateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const hex = (len: number) => Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`
}

/**
 * Create the headless Testing Studio session controller.
 * Owns picking & recognition, `.art.json` recipe editing, sprite inspection/saving,
 * review CRUD, dirty guards, and reload-compare restoration — completely decoupled from the DOM.
 */
export function createTestingStudioSession(options: {
  store?: ReviewStorePort
  env?: TestingStudioEnvironment
} = {}): TestingStudioSession {
  const store = options.store ?? createHttpReviewStore()
  const env = options.env ?? {}

  const readHudRegions = () => (env.getHudRegions ?? getHudRegions)()
  const readSpriteDraws = () => (env.getLastSpriteDraws ?? getLastSpriteDraws)()
  const readLastFrame = () => (env.getLastFrame ?? getLastFrame)()
  const readHooks = () => (env.getTestingHooks ?? getTestingHooks)()
  const findArtModel = (name: string) => (env.findRegisteredArtModel ?? findRegisteredArtModel)(name)
  const getElRect = (el: HTMLCanvasElement) => (env.getElementRect ?? defaultElementRect)(el)
  const getViewport = () => (env.getViewportSize ?? defaultViewportSize)()
  const getLocation = () => (env.getLocationUrl ?? defaultLocationUrl)()
  const genId = () => (env.generateId ?? defaultGenerateId)()
  const readPaused = () => (env.isPaused ?? isTestingPaused)()
  const writePaused = (paused: boolean) => (env.setPaused ?? setTestingPaused)(paused)
  const subPause = env.onPause ?? onTestingPause
  const subHooks = env.onHooksRegistered ?? onTestingHooksRegistered

  const entries = new Map<string, ReviewEntry>()
  const listeners = new Set<() => void>()
  let selection: StudioSelection | undefined
  let activeReview: ReviewEntry | undefined
  let busy = false
  let disposed = false
  let status = ''
  let draftReviewId = genId()
  let pendingRestore: { scene: unknown; entryId: string } | undefined

  function notify() {
    if (disposed) return
    for (const fn of Array.from(listeners)) {
      try { fn() } catch { /* Listener errors must not corrupt studio session state. */ }
    }
  }

  function setStatus(message: string) {
    status = message
    notify()
  }

  function isDirty(): boolean {
    return selection?.recipeEditor?.isDirty() ?? false
  }

  function lookupArtSource(asset: string): ArtSourceInfo | undefined {
    for (const hook of readHooks()) {
      const info = hook.getArtSource?.(asset)
      if (info) return info
    }
    const found = findArtModel(asset)
    if (found) {
      const recipe = found.kit.recipeFor?.(asset)
      return {
        path: found.kit.sourceSite ?? `art/overrides.json#${asset}`,
        file: null,
        base: null,
        recipe
      }
    }
    if (isBuiltInArtModel(asset)) {
      return {
        path: `art/overrides.json#${asset}`,
        file: null,
        base: null,
        recipe: createArtRecipe(asset)
      }
    }
    return undefined
  }

  function captureSnapshot(): unknown {
    for (const hook of readHooks()) {
      if (hook.snapshot) {
        try { return hook.snapshot() } catch { /* Fall back to default scene metadata. */ }
      }
    }
    return { url: getLocation(), capturedAt: new Date().toISOString() }
  }

  async function restoreSnapshot(scene: unknown): Promise<void> {
    for (const hook of readHooks()) {
      if (hook.restore) await hook.restore(scene)
    }
  }

  function buildArtView(sel = selection): ArtView {
    if (!sel) throw new Error('No active selection.')
    if (sel.savedView) return structuredClone(sel.savedView)
    if (sel.surface === 'sprite' && sel.spriteHit) {
      const d = sel.spriteHit.draw
      const clipName = sel.spriteClip ?? d.clip ?? Object.keys(d.atlas.clips)[0] ?? 'frame'
      const clipSpec = d.atlas.clips[clipName]
      const col = clipSpec ? clipSpec.column + (sel.spriteFrame % Math.max(1, clipSpec.frames)) : d.column
      const row = clipSpec?.row ?? d.row
      return {
        surface: 'sprite',
        asset: sel.asset,
        instance: sel.instanceId,
        source: d.atlas.manifestUrl ?? d.atlas.sourceSite ?? d.atlas.src,
        sheet: d.atlas.src,
        position: [0, 0, 0],
        yaw: 0,
        elevation: 0,
        span: 1,
        centerY: 0,
        width: Math.max(1, Math.round(d.rect.width)),
        height: Math.max(1, Math.round(d.rect.height)),
        clip: clipName,
        frame: sel.spriteFrame,
        column: col,
        row,
        handDrawn: true
      }
    }
    if (sel.surface === 'hud' && sel.hudRegion) {
      return {
        surface: 'hud',
        asset: sel.asset,
        instance: sel.instanceId,
        source: sel.source,
        position: [0, 0, 0],
        yaw: 0,
        elevation: 0,
        span: 1,
        centerY: 0,
        width: Math.max(1, Math.round(sel.hudRegion.rect.width)),
        height: Math.max(1, Math.round(sel.hudRegion.rect.height)),
        clip: 'hud',
        frame: 0,
        column: 0,
        row: 0
      }
    }
    const recipe = sel.recipeEditor?.getRecipe()
    const center = sel.recognized?.bounds.center ?? [0, 0, 0]
    const size = sel.recognized?.bounds.size ?? [1, 1, 1]
    const span = recipe?.span ?? Math.max(0.5, Math.hypot(size[0], size[1], size[2]) * 1.25)
    const centerY = recipe?.centerY ?? center[1]
    const w = Math.max(1, Math.round(sel.screenRect?.width ?? 128))
    const h = Math.max(1, Math.round(sel.screenRect?.height ?? 128))
    return {
      surface: sel.surface,
      asset: sel.asset,
      instance: sel.instanceId,
      source: sel.source,
      position: [...center],
      yaw: sel.previewYaw,
      elevation: Math.max(-1.45, Math.min(1.45, sel.previewElevation)),
      span,
      centerY,
      width: w,
      height: h
    }
  }

  function buildPin(sel = selection): ArtPin {
    if (!sel) throw new Error('No active selection.')
    const pin: ArtPin = {
      view: buildArtView(sel),
      scope: sel.scope,
      ...(sel.part !== undefined ? { part: sel.part } : {}),
      editSource: sel.source,
      region: [...sel.region]
    }
    checkPin(pin)
    return pin
  }

  const unsubPause = subPause(paused => {
    if (!paused) {
      selection = undefined
      activeReview = undefined
    }
    notify()
  })

  const unsubHooks = subHooks(hooks => {
    if (!pendingRestore || !hooks.restore) return
    const { scene, entryId } = pendingRestore
    pendingRestore = undefined
    Promise.resolve(hooks.restore(scene)).then(() => {
      if (disposed) return
      if (activeReview?.note.id === entryId && selection) {
        const v = activeReview.note.target.view
        if (v.surface === 'model' && !selection.artSource) {
          const artSource = lookupArtSource(v.asset)
          if (artSource) {
            selection.artSource = artSource
            selection.recipeEditor = artSource.recipe
              ? createArtRecipeEditor(artSource.recipe, selection.part)
              : undefined
          }
        }
        notify()
      }
    }).catch(err => setStatus(errorMessage(err)))
  })

  async function refreshReviews(): Promise<ReviewListResult> {
    const result = await store.listReviews()
    entries.clear()
    for (const e of result.entries) entries.set(e.note.id, e)
    if (activeReview) {
      const refreshed = entries.get(activeReview.note.id)
      if (refreshed) activeReview = refreshed
      else activeReview = undefined
    }
    if (result.errors.length) {
      status = 'Could not load: ' + result.errors.join(', ')
    }
    notify()
    return result
  }

  async function openReview(idOrEntry: string | ReviewEntry): Promise<StudioSelection> {
    if (isDirty()) {
      const msg = 'Save or discard pending edits first.'
      setStatus(msg)
      throw new Error(msg)
    }
    const entry = typeof idOrEntry === 'string' ? entries.get(idOrEntry) : idOrEntry
    if (!entry) throw new Error('Review not found.')
    if (!readPaused()) writePaused(true)
    const hasRestore = readHooks().some(h => typeof h.restore === 'function')
    if (hasRestore) {
      pendingRestore = undefined
      await restoreSnapshot(entry.note.scene)
    } else if (entry.note.scene !== undefined && entry.note.scene !== null) {
      pendingRestore = { scene: entry.note.scene, entryId: entry.note.id }
    }
    const pin = entry.note.target
    const v = pin.view
    const artSource = v.surface === 'model' ? lookupArtSource(v.asset) : undefined
    const recipeEditor = artSource?.recipe ? createArtRecipeEditor(artSource.recipe, pin.part) : undefined
    activeReview = entry
    selection = {
      surface: v.surface,
      asset: v.asset,
      instanceId: v.instance,
      source: pin.editSource ?? v.source,
      part: pin.part,
      scope: pin.scope,
      region: [...pin.region],
      artSource,
      recipeEditor,
      previewYaw: v.yaw,
      previewElevation: v.elevation,
      spriteClip: v.clip,
      spriteFrame: v.frame ?? 0,
      spriteFrameMs: 120,
      savedView: structuredClone(v)
    }
    notify()
    return selection
  }

  return {
    store,
    isPaused: readPaused,
    isDirty,
    isBusy: () => busy,
    getStatus: () => status,
    setStatus,
    getSelection: () => selection,
    getActiveReview: () => activeReview,
    getRecipeEditor: () => selection?.recipeEditor,
    listReviews: () => Array.from(entries.values()),
    getReview: (id: string) => entries.get(id),
    beforeImageUrl: (id: string) => store.beforeImageUrl(id),

    setPaused(paused: boolean) {
      if (busy) return { ok: false, reason: 'busy' }
      if (!paused && isDirty()) {
        const msg = 'Save or discard your pending recipe edits before resuming.'
        setStatus(msg)
        return { ok: false, reason: msg }
      }
      writePaused(paused)
      notify()
      return { ok: true }
    },

    pickAt(clientX: number, clientY: number): PickResult {
      if (!readPaused()) {
        return { picked: false, blocked: 'not-paused', message: 'Pause the game before picking an asset.' }
      }
      if (busy) {
        return { picked: false, blocked: 'busy', message: 'Wait for the current operation to finish.' }
      }
      if (isDirty()) {
        const message = 'Save or discard your current recipe edit before picking another asset.'
        setStatus(message)
        return { picked: false, blocked: 'dirty', message }
      }

      // 1. Registered HUD regions (topmost leaf non-fullscreen regions first)
      const hudRegions = readHudRegions()
      const viewport = getViewport()
      for (let i = hudRegions.length - 1; i >= 0; i--) {
        const reg = hudRegions[i]
        const baseRect: ViewportRect = reg.canvas
          ? getElRect(reg.canvas)
          : { left: 0, top: 0, width: viewport.width, height: viewport.height }
        const vw = reg.viewportWidth ?? baseRect.width
        const vh = reg.viewportHeight ?? baseRect.height
        if (vw <= 0 || vh <= 0) continue
        // Skip giant full-screen container panels so 3D/sprite clicks still pass through
        if (reg.rect.width >= vw * 0.88 && reg.rect.height >= vh * 0.88) continue
        const sx = baseRect.width / vw
        const sy = baseRect.height / vh
        const left = baseRect.left + reg.rect.x * sx
        const top = baseRect.top + reg.rect.y * sy
        const width = reg.rect.width * sx
        const height = reg.rect.height * sy
        if (clientX >= left && clientX <= left + width && clientY >= top && clientY <= top + height) {
          activeReview = undefined
          draftReviewId = genId()
          selection = {
            surface: 'hud',
            asset: reg.asset ?? reg.id,
            instanceId: reg.id,
            source: reg.source ?? `hud#${reg.id}`,
            scope: 'hud',
            region: [0.5, 0.5, 0.5, 0.5],
            hudRegion: reg,
            screenRect: { left, top, width, height },
            previewYaw: 0,
            previewElevation: 0,
            spriteFrame: 0,
            spriteFrameMs: 120
          }
          const message = `Picked HUD region "${reg.label}".`
          setStatus(message)
          return { picked: true, selection, message }
        }
      }

      // 2. 2D sprite draws (group per visible canvas; reverse draw order with alpha hit-test)
      const spriteDraws = readSpriteDraws()
      if (spriteDraws.length) {
        const byCanvas = new Map<HTMLCanvasElement, SpriteDrawRecord[]>()
        for (let i = 0; i < spriteDraws.length; i++) {
          const d = spriteDraws[i]
          let list = byCanvas.get(d.canvas)
          if (!list) {
            list = []
            byCanvas.set(d.canvas, list)
          }
          list.push(d)
        }
        const canvases = Array.from(byCanvas.keys())
        for (let c = canvases.length - 1; c >= 0; c--) {
          const spriteCanvas = canvases[c]
          const rect = getElRect(spriteCanvas)
          if (!(rect.width > 0 && rect.height > 0 && clientX >= rect.left && clientX <= rect.left + rect.width && clientY >= rect.top && clientY <= rect.top + rect.height)) {
            continue
          }
          const u = (clientX - rect.left) / rect.width
          const v = (clientY - rect.top) / rect.height
          const canvasDraws = byCanvas.get(spriteCanvas)
          if (!canvasDraws) continue
          const hit = pickSpriteDraws(canvasDraws, u, v)
          if (hit) {
            const d = hit.draw
            const scaleX = rect.width / d.canvasWidth
            const scaleY = rect.height / d.canvasHeight
            const name = d.atlas.src.split('/').at(-1)?.replace(/\.png$/i, '') || d.atlas.id
            activeReview = undefined
            draftReviewId = genId()
            selection = {
              surface: 'sprite',
              asset: name,
              instanceId: `${d.atlas.id}#${hit.index}`,
              source: d.atlas.manifestUrl ?? d.atlas.sourceSite ?? d.atlas.src,
              scope: 'sprite',
              region: [hit.localU, hit.localV, hit.localU, hit.localV],
              spriteHit: hit,
              screenRect: {
                left: rect.left + d.rect.x * scaleX,
                top: rect.top + d.rect.y * scaleY,
                width: d.rect.width * scaleX,
                height: d.rect.height * scaleY
              },
              previewYaw: 0,
              previewElevation: 0,
              spriteClip: d.clip,
              spriteFrame: d.frame,
              spriteFrameMs: (d.clip ? d.atlas.clips[d.clip]?.frameMs : undefined) ?? 120
            }
            const message = `Picked 2D sprite "${name}".`
            setStatus(message)
            return { picked: true, selection, message }
          }
        }
      }

      // 3. 3D rendered frame (perspective + orthographic exact batch ID picking)
      const frame = readLastFrame()
      if (frame) {
        const rect = getElRect(frame.canvas)
        if (rect.width > 0 && rect.height > 0 && clientX >= rect.left && clientX <= rect.left + rect.width && clientY >= rect.top && clientY <= rect.top + rect.height) {
          const u = (clientX - rect.left) / rect.width
          const v = (clientY - rect.top) / rect.height
          const hit = pickRenderedScene(frame.batches, frame.viewProjection, frame.width, frame.height, u, v)
          if (hit) {
            const recognized = recognizeAssetFromPick(frame.batches, frame.viewProjection, hit)
            const artSource = recognized.kind === 'model' ? lookupArtSource(recognized.asset) : undefined
            const recipeEditor = artSource?.recipe
              ? createArtRecipeEditor(artSource.recipe, recognized.part)
              : undefined
            const sb = recognized.screenBounds
            activeReview = undefined
            draftReviewId = genId()
            selection = {
              surface: recognized.kind,
              asset: recognized.asset,
              instanceId: recognized.instanceId,
              source: artSource?.path ?? recognized.sourceSite,
              part: recognized.part,
              scope: 'asset',
              region: [0.5, 0.5, 0.5, 0.5],
              recognized,
              artSource,
              recipeEditor,
              screenRect: sb ? {
                left: rect.left + sb[0] * rect.width,
                top: rect.top + sb[1] * rect.height,
                width: (sb[2] - sb[0]) * rect.width,
                height: (sb[3] - sb[1]) * rect.height
              } : undefined,
              previewYaw: 0.55,
              previewElevation: 0.42,
              spriteFrame: 0,
              spriteFrameMs: 120
            }
            const message = `Picked ${surfaceLabel(recognized.kind)} "${recognized.asset}" (${recognized.stats.triangleCount} tris).`
            setStatus(message)
            return { picked: true, selection, message }
          }
        }
      }

      const message = 'No visible asset under that click.'
      setStatus(message)
      return { picked: false, message }
    },

    selectPart(partName: string | undefined) {
      if (!selection) return
      selection.part = partName?.trim() || undefined
      if (selection.recipeEditor && selection.part) {
        const parts = selection.recipeEditor.getRecipe().parts
        if (parts.some(p => p.name === selection?.part)) {
          selection.recipeEditor.selectPart(selection.part)
        }
      }
      notify()
    },

    setScope(scope: ReviewScope) {
      if (!selection || activeReview) return
      const allowed = allowedScopesForSurface(selection.surface)
      if (!isReviewScope(scope) || !allowed.includes(scope)) {
        protocolError(`Scope "${scope}" is not valid for ${selection.surface} reviews.`)
      }
      selection.scope = scope
      notify()
    },

    setRegion(region: [number, number, number, number]) {
      if (!selection || activeReview) return
      selection.region = [region[0], region[1], region[2], region[3]]
      notify()
    },

    setPreviewOrbit(yaw: number, elevation: number) {
      if (!selection) return
      selection.previewYaw = yaw
      selection.previewElevation = Math.max(-1.35, Math.min(1.35, elevation))
      notify()
    },

    selectSpriteClip(clip: string | undefined) {
      if (!selection || !selection.spriteHit) return
      selection.spriteClip = clip || undefined
      const spec = selection.spriteClip ? selection.spriteHit.draw.atlas.clips[selection.spriteClip] : undefined
      selection.spriteFrame = 0
      selection.spriteFrameMs = spec?.frameMs ?? 120
      notify()
    },

    setSpriteFrame(frame: number) {
      if (!selection) return
      selection.spriteFrame = Math.max(0, Math.floor(frame))
      notify()
    },

    setSpriteFrameMs(frameMs: number) {
      if (!selection) return
      if (Number.isFinite(frameMs) && frameMs >= 16) {
        selection.spriteFrameMs = Math.round(frameMs)
        notify()
      }
    },

    buildArtView,
    buildPin,
    captureSnapshot,
    restoreSnapshot,
    lookupArtSource,

    fitRecipe() {
      const editor = selection?.recipeEditor
      if (!editor) throw new Error('No editable recipe selected.')
      const fitted = editor.fitAndGround()
      setStatus('Grounded and fitted model bounds.')
      return fitted
    },

    discardRecipeEdits() {
      const editor = selection?.recipeEditor
      if (!editor) return
      editor.discard()
      if (selection) selection.part = editor.getSelectedPart().name
      setStatus('Discarded unsaved edits.')
    },

    undoRecipeEdit() {
      const editor = selection?.recipeEditor
      if (!editor) return false
      const undone = editor.undo()
      if (undone && selection) {
        selection.part = editor.getSelectedPart().name
        setStatus('Undid last recipe change.')
      }
      return undone
    },

    async saveRecipe() {
      const sel = selection
      const editor = sel?.recipeEditor
      if (!sel || !editor) throw new Error('No editable recipe selected.')
      if (busy) throw new Error('Another operation is already in progress.')
      const recipe = editor.getRecipe()
      busy = true
      notify()
      try {
        const src = sel.artSource
        const result = await store.saveRecipe({
          asset: sel.asset,
          file: src?.file ?? null,
          base: src?.base ?? null,
          recipe
        })
        editor.markSaved(recipe)
        if (sel.artSource) {
          sel.artSource = {
            ...sel.artSource,
            base: structuredClone(recipe),
            recipe: structuredClone(recipe)
          }
        }
        for (const hook of readHooks()) hook.onRecipeSaved?.(sel.asset, structuredClone(recipe))
        status = `Saved ${result.file}! Reload to apply in-game.`
        return result
      } finally {
        busy = false
        notify()
      }
    },

    async saveSprite(pngBase64?: string) {
      const sel = selection
      const spriteHit = sel?.spriteHit
      if (!sel || sel.surface !== 'sprite' || !spriteHit) {
        throw new Error('No 2D sprite selected.')
      }
      if (busy) throw new Error('Another operation is already in progress.')
      const atlas = spriteHit.draw.atlas
      const clips: NonNullable<SpriteManifestInput['clips']> = {}
      for (const [clipName, spec] of Object.entries(atlas.clips)) {
        clips[clipName] = {
          column: spec.column,
          ...(spec.row !== undefined ? { row: spec.row } : {}),
          frames: spec.frames,
          frameMs: clipName === sel.spriteClip ? sel.spriteFrameMs : spec.frameMs
        }
      }
      const pngFileName = atlas.src.split('/').at(-1) || `${sel.asset}.png`
      const manifest: SpriteManifestInput = {
        src: pngFileName.endsWith('.png') ? pngFileName : `${sel.asset}.png`,
        frameWidth: atlas.frameWidth,
        frameHeight: atlas.frameHeight,
        clips
      }
      checkSpriteManifest(manifest)
      busy = true
      notify()
      try {
        const manifestFile = atlas.manifestUrl && /\.(?:png|json)$/i.test(atlas.manifestUrl)
          ? atlas.manifestUrl.replace(/^\/+/, '')
          : undefined
        const result = await store.saveSprite({
          ...(manifestFile ? { file: manifestFile } : { name: sel.asset }),
          ...(pngBase64 ? { png: pngBase64 } : {}),
          manifest
        })
        status = `Saved ${result.files.join(', ')}.`
        return result
      } finally {
        busy = false
        notify()
      }
    },

    refreshReviews,

    async createReview(comment: string, pngBase64: string) {
      if (!selection) throw new Error('Pick an asset before saving a comment.')
      if (busy) throw new Error('Another operation is already in progress.')
      const text = validateReviewComment(comment)
      const target = buildPin(selection)
      busy = true
      notify()
      try {
        const created = await store.createReview({
          id: draftReviewId,
          target,
          scene: captureSnapshot(),
          comment: text,
          png: pngBase64
        })
        activeReview = created
        draftReviewId = genId()
        await refreshReviews()
        status = `Saved reviews/${created.note.id}.json + before PNG.`
        notify()
        return created
      } finally {
        busy = false
        notify()
      }
    },

    async replyToReview(reply: string) {
      if (!activeReview) throw new Error('No active review selected.')
      if (busy) throw new Error('Another operation is already in progress.')
      const text = validateReviewComment(reply)
      busy = true
      notify()
      try {
        const updated = await store.updateReview(activeReview.note.id, {
          revision: activeReview.revision,
          status: activeReview.note.status,
          reply: text
        })
        activeReview = updated
        await refreshReviews()
        status = `Saved reply on reviews/${updated.note.id}.json.`
        notify()
        return updated
      } finally {
        busy = false
        notify()
      }
    },

    async toggleResolveReview(reply?: string) {
      if (!activeReview) throw new Error('No active review selected.')
      if (busy) throw new Error('Another operation is already in progress.')
      const nextStatus = activeReview.note.status === 'resolved' ? 'open' : 'resolved'
      const trimmedReply = reply?.trim() || undefined
      busy = true
      notify()
      try {
        const updated = await store.updateReview(activeReview.note.id, {
          revision: activeReview.revision,
          status: nextStatus,
          ...(trimmedReply !== undefined ? { reply: trimmedReply } : {})
        })
        activeReview = updated
        await refreshReviews()
        status = `Marked review ${nextStatus}.`
        notify()
        return updated
      } finally {
        busy = false
        notify()
      }
    },

    async deleteReview(id = activeReview?.note.id) {
      if (!id) throw new Error('No review specified to delete.')
      if (busy) throw new Error('Another operation is already in progress.')
      busy = true
      notify()
      try {
        await store.deleteReview(id)
        if (activeReview?.note.id === id) {
          activeReview = undefined
          draftReviewId = genId()
          if (selection) selection.savedView = undefined
        }
        await refreshReviews()
        status = `Deleted review ${id}.`
        notify()
      } finally {
        busy = false
        notify()
      }
    },

    openReview,

    prepareReloadCompareState(): ReloadCompareState {
      return {
        ridgetopStudio: {
          reviewId: activeReview?.note.id,
          scene: captureSnapshot()
        }
      }
    },

    async resumeFromNavigation({ historyState, search }: { historyState?: unknown; search?: string }) {
      const studioState = isRecord(historyState) && isRecord(historyState.ridgetopStudio)
        ? historyState.ridgetopStudio
        : undefined
      const stateReviewId = typeof studioState?.reviewId === 'string' ? studioState.reviewId : undefined
      const stateScene = studioState?.scene
      let urlReview: string | undefined
      if (search) {
        try {
          urlReview = new URLSearchParams(search).get('review') ?? undefined
        } catch {
          urlReview = undefined
        }
      }
      const wanted = stateReviewId ?? urlReview
      const wantedEntry = wanted ? entries.get(wanted) : undefined
      if (wantedEntry) {
        await openReview(wantedEntry)
        return { openedReview: wantedEntry, clearHistoryState: Boolean(studioState) }
      }
      if (studioState && stateScene !== undefined && stateScene !== null) {
        if (!readPaused()) writePaused(true)
        const hasRestore = readHooks().some(h => typeof h.restore === 'function')
        if (hasRestore) {
          await restoreSnapshot(stateScene)
        } else {
          pendingRestore = { scene: stateScene, entryId: '' }
        }
        setStatus('Restored pre-reload scene snapshot.')
        return { restoredScene: true, clearHistoryState: true }
      }
      return { clearHistoryState: Boolean(studioState) }
    },

    onChange(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },

    dispose() {
      if (disposed) return
      disposed = true
      unsubPause()
      unsubHooks()
      listeners.clear()
      if (readPaused()) writePaused(false)
    }
  }
}
