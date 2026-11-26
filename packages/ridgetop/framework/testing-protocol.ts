import type { ArtRecipe } from './art-recipe.ts'
import type { ArtPin, ArtReview, ReviewScope, ReviewStatus, ReviewSurface } from './art-review.ts'

export class TestingProtocolError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'TestingProtocolError'
    this.status = status
  }
}

export interface ReviewEntry {
  note: ArtReview
  revision: string
}

export interface ReviewListResult {
  entries: ReviewEntry[]
  errors: string[]
}

export interface CreateReviewInput {
  id: string
  target: ArtPin
  scene: unknown
  comment: string
  png: string
}

export interface UpdateReviewInput {
  revision: string
  status: ReviewStatus
  reply?: string
}

export interface SaveRecipeInput {
  asset: string
  file: string | null
  base: unknown
  recipe: ArtRecipe
}

export interface SaveRecipeResult {
  saved: true
  file: string
}

export interface SpriteManifestInput {
  src: string
  frameWidth: number
  frameHeight: number
  clips?: Record<string, { column: number; row?: number; frames: number; frameMs: number }>
}

export interface SaveSpriteInput {
  name?: string
  file?: string | null
  png?: string
  manifest?: SpriteManifestInput
}

export interface SaveSpriteResult {
  saved: true
  files: string[]
}

export interface ReviewStorePort {
  listReviews(): Promise<ReviewListResult>
  createReview(input: CreateReviewInput): Promise<ReviewEntry>
  updateReview(id: string, input: UpdateReviewInput): Promise<ReviewEntry>
  deleteReview(id: string): Promise<void>
  beforeImageUrl(id: string): string
  saveRecipe(input: SaveRecipeInput): Promise<SaveRecipeResult>
  saveSprite(input: SaveSpriteInput): Promise<SaveSpriteResult>
}

export const REVIEW_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const VALID_SURFACES = new Set<string>(['model', 'rig', 'mesh', 'sprite', 'hud'])
const VALID_SCOPES = new Set<string>(['asset', 'instance', 'sprite', 'hud'])
const THREE_D_SURFACES = new Set<string>(['model', 'rig', 'mesh'])

export function protocolError(message: string, status = 400): never {
  throw new TestingProtocolError(message, status)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isReviewSurface(value: unknown): value is ReviewSurface {
  return typeof value === 'string' && VALID_SURFACES.has(value)
}

export function isReviewScope(value: unknown): value is ReviewScope {
  return typeof value === 'string' && VALID_SCOPES.has(value)
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return value === 'open' || value === 'ready' || value === 'resolved'
}

export function isThreeDSurface(surface: ReviewSurface): boolean {
  return THREE_D_SURFACES.has(surface)
}

export function allowedScopesForSurface(surface: ReviewSurface): readonly ReviewScope[] {
  if (surface === 'hud') return ['hud', 'asset', 'instance']
  if (surface === 'sprite') return ['sprite', 'asset', 'instance']
  return ['asset', 'instance']
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSafeNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSafePositiveIntUpTo(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max
}

function isNonEmptyBoundedString(value: unknown, maxLen: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLen
}

export function isUnitRegion(value: unknown): value is [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) return false
  for (let i = 0; i < 4; i++) {
    const n: unknown = value[i]
    if (!isFiniteNumber(n) || n < 0 || n > 1) return false
  }
  return value[0] <= value[2] && value[1] <= value[3]
}

export function validateReviewId(id: unknown): string {
  if (typeof id !== 'string' || !REVIEW_UUID_RE.test(id)) protocolError('Invalid review ID.')
  return id
}

export function validateReviewComment(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8_000) {
    protocolError('Enter between 1 and 8,000 characters.')
  }
  return value.trim()
}

export function checkPin(pin: unknown): asserts pin is ArtPin {
  if (!isRecord(pin)) protocolError('Invalid art review target.')
  const v = pin.view
  if (
    !isRecord(v) ||
    !isReviewSurface(v.surface) ||
    !isReviewScope(pin.scope) ||
    (pin.scope === 'hud' && v.surface !== 'hud') ||
    (pin.scope === 'sprite' && THREE_D_SURFACES.has(v.surface)) ||
    ![v.asset, v.instance, v.source].every(s => isNonEmptyBoundedString(s, 1024)) ||
    ![v.span, v.width, v.height].every(n => isFiniteNumber(n) && n > 0) ||
    !isFiniteNumber(v.centerY) ||
    !isFiniteNumber(v.yaw) ||
    !isFiniteNumber(v.elevation) ||
    Math.abs(v.elevation) >= Math.PI / 2 ||
    (pin.part !== undefined && (typeof pin.part !== 'string' || pin.part.length > 256)) ||
    (pin.editSource !== undefined && (typeof pin.editSource !== 'string' || pin.editSource.length > 1024)) ||
    (v.sheet !== undefined && (typeof v.sheet !== 'string' || v.sheet.length > 1024)) ||
    (v.handDrawn !== undefined && typeof v.handDrawn !== 'boolean') ||
    !Array.isArray(v.position) ||
    v.position.length !== 3 ||
    !isFiniteNumber(v.position[0]) ||
    !isFiniteNumber(v.position[1]) ||
    !isFiniteNumber(v.position[2]) ||
    !isUnitRegion(pin.region) ||
    (!THREE_D_SURFACES.has(v.surface) && (
      !isNonEmptyBoundedString(v.clip, 256) ||
      ![v.frame, v.column, v.row].every(isSafeNonNegativeInt)
    ))
  ) {
    protocolError('Invalid art review target.')
  }
}

export function checkReview(value: unknown, id: string): asserts value is ArtReview {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.id !== id ||
    !isReviewStatus(value.status) ||
    typeof value.created !== 'string' ||
    typeof value.comment !== 'string' ||
    !Array.isArray(value.replies) ||
    value.replies.some(r => !isRecord(r) || typeof r.text !== 'string')
  ) {
    protocolError('Invalid review file.')
  }
  checkPin(value.target)
}

export function checkSpriteManifest(manifest: unknown): asserts manifest is SpriteManifestInput {
  if (
    !isRecord(manifest) ||
    typeof manifest.src !== 'string' ||
    !/^[^/\\\0]+\.png$/i.test(manifest.src) ||
    ![manifest.frameWidth, manifest.frameHeight].every(n => isSafePositiveIntUpTo(n, 4096)) ||
    (manifest.clips !== undefined && !isRecord(manifest.clips))
  ) {
    protocolError('Invalid sprite manifest.')
  }
}

export function isReviewEntry(value: unknown): value is ReviewEntry {
  if (!isRecord(value) || typeof value.revision !== 'string' || !isRecord(value.note)) return false
  if (typeof value.note.id !== 'string') return false
  try {
    checkReview(value.note, value.note.id)
    return true
  } catch {
    return false
  }
}

export function parseReviewEntry(value: unknown): ReviewEntry {
  if (!isReviewEntry(value)) throw new TestingProtocolError('Unexpected review response from server.', 500)
  return value
}

export function parseReviewList(value: unknown): ReviewListResult {
  if (!isRecord(value) || !Array.isArray(value.entries) || !Array.isArray(value.errors)) {
    throw new TestingProtocolError('Unexpected reviews list response from server.', 500)
  }
  const entries = value.entries.filter(isReviewEntry)
  const errors = value.errors.filter((item): item is string => typeof item === 'string')
  return { entries, errors }
}

/**
 * Unified Testing Mode URL activation policy shared by runtime instrumentation and Testing Studio boot.
 * Explicit `?testing=0` / `?testing=false` always disables; `?testing=1` / `?testing=true` always enables;
 * `?review=<id>` enables unless explicitly disabled; otherwise falls back to `defaultEnabled`.
 */
export function resolveTestingUrlActivation(search: string | undefined, defaultEnabled = false): boolean {
  if (!search) return defaultEnabled
  try {
    const params = new URLSearchParams(search)
    const raw = params.get('testing')
    if (raw !== null) {
      const flag = raw.trim().toLowerCase()
      if (flag === '0' || flag === 'false') return false
      if (flag === '1' || flag === 'true') return true
    }
    if (params.has('review')) return true
    return defaultEnabled
  } catch {
    return defaultEnabled
  }
}
