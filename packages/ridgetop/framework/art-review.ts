import { createArtKit, modelFromArtRecipe } from './art.ts'
import { multiply, orthographic, uncoloredMesh, view } from './geometry.ts'
import { INSTANCE_SIZE, frustum, instances, visible } from './instances.ts'
import { bakeSpritePixels, renderMeshFrame, renderMeshPixels, spriteDirections } from './low-poly.ts'
import type { ArtModel, ArtPart, ArtRecipe } from './art-recipe.ts'
import type { Picked3DInstance, SpriteDrawRecord } from './testing-runtime.ts'
import type { Color, InstanceBatch, Matrix, Quaternion, Vec3 } from './types.ts'

function canonicalPartNames(parts: readonly ArtPart[]): string[] {
  const seen = new Set<string>()
  return parts.map((p, i) => {
    const base = partName(p, i)
    let key = base
    let suffix = 2
    while (seen.has(key)) key = `${base}#${suffix++}`
    seen.add(key)
    return key
  })
}

export type ReviewKit = ReturnType<typeof createArtKit<string>>
export type ReviewSurface = 'model' | 'rig' | 'mesh' | 'sprite' | 'hud'
export type ReviewScope = 'asset' | 'instance' | 'sprite' | 'hud'
export type ReviewStatus = 'open' | 'ready' | 'resolved'
export interface ArtView {
  surface: ReviewSurface
  asset: string; instance: string; source: string; position: number[]
  yaw: number; elevation: number; span: number; centerY: number; width: number; height: number
  clip?: string; frame?: number; column?: number; row?: number; handDrawn?: boolean; sheet?: string
}
export interface PickedSpriteDraw {
  readonly draw: SpriteDrawRecord
  readonly index: number
  readonly localU: number
  readonly localV: number
  readonly pixelX: number
  readonly pixelY: number
}
export interface ArtPin {
  view: ArtView; scope: ReviewScope; part?: string
  /** Game-relative file or asset reference to edit for this specific scope. */
  editSource?: string
  /** Fraction of the displayed asset, from top left. Equal corners describe a point. */
  region: [number, number, number, number]
}
export interface ArtReview {
  version: 1; id: string; status: ReviewStatus; comment: string; created: string
  target: ArtPin; scene: unknown; before: string; replies: { text: string; date: string }[]
}
export const partName = (part: ArtPart, index: number) => part.name ?? 'part-' + (index + 1)
function tint(id: number): Color { return [(id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255, 1] }

/** Count the pixels belonging to each visible named part in each sprite direction. */
export function spritePartVisibility<Name extends string>(kit: {
  model(name: Name): ArtModel
  group(): { batches: readonly InstanceBatch[]; add(name: Name, position: Vec3, options: { partTint(part: ArtPart, i: number): Color }): void }
}, asset: Name, frameSize: number) {
  const model = kit.model(asset), group = kit.group()
  const counts = model.parts.map(() => spriteDirections.map(() => 0))
  group.add(asset, [0,0,0], { partTint: (_part, i) => tint(i+1) })
  const { width, pixels } = bakeSpritePixels(group.batches, {
    span: model.span, center: [0,model.centerY,0], frameSize, lighting: { ambient: 1 }
  })
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i+3]) continue
    const id = pixels[i] + (pixels[i+1] << 8) + (pixels[i+2] << 16)
    if (id < 1 || id > counts.length) continue
    const direction = Math.floor((i/4 % width)/frameSize)
    counts[id-1][direction]++
  }
  const named: Record<string, number[]> = {}
  const keys = canonicalPartNames(model.parts)
  for (let i = 0; i < model.parts.length; i++) {
    Object.defineProperty(named, keys[i], { value: counts[i], enumerable: true, writable: true, configurable: true })
  }
  return { frameSize, directions: spriteDirections, parts: named }
}
export function reviewCanvas(width: number, height = width) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function instanceVisible(x: number, y: number, z: number, reach: number, planes: Float32Array): boolean {
  const minX = x - reach, maxX = x + reach
  const minY = y - reach, maxY = y + reach
  const minZ = z - reach, maxZ = z + reach
  for (let i = 0; i < 24; i += 4) {
    const px = planes[i], py = planes[i + 1], pz = planes[i + 2]
    if (px * (px >= 0 ? maxX : minX) + py * (py >= 0 ? maxY : minY) + pz * (pz >= 0 ? maxZ : minZ) + planes[i + 3] < 0) {
      return false
    }
  }
  return true
}

/**
 * Generic perspective + orthographic 3D batch ID picking.
 * Uses the exact projective pixel-crop matrix and depth-tested software rasterizer so the frontmost visible instance wins.
 */
export function pickRenderedScene(
  batches: readonly InstanceBatch[],
  camera: Matrix,
  width: number,
  height: number,
  u: number,
  v: number
): Picked3DInstance | undefined {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height) && u >= 0 && u <= 1 && v >= 0 && v <= 1)) return undefined
  const px = Math.min(width - 1, Math.floor(u * width))
  const py = Math.min(height - 1, Math.floor(v * height))
  const x = (px + .5) * 2 / width - 1
  const y = 1 - (py + .5) * 2 / height
  // Projective crop works identically for both orthographic and perspective matrices.
  const crop = new Float32Array([width, 0, 0, 0, 0, height, 0, 0, 0, 0, 1, 0, -width * x, -height * y, 0, 1])
  const cropped = multiply(crop, camera)
  const planes = frustum(cropped)

  const entries: Picked3DInstance[] = []
  const idBatches: InstanceBatch[] = []

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi]
    if (!visible(batch, planes)) continue
    let idBatch: InstanceBatch | undefined
    const d = batch.data
    const radius = batch.mesh.radius
    const isOpaque = batch.blend === 'opaque'
    const tags = batch.meta?.tags
    for (let ii = 0; ii < batch.count; ii++) {
      const at = ii * INSTANCE_SIZE
      const alpha = isOpaque ? 1 : d[at + 3]
      if (!isOpaque && alpha <= 0.004) continue
      const ix = d[at], iy = d[at + 1], iz = d[at + 2]
      const sx = d[at + 4], sy = d[at + 5], sz = d[at + 6]
      const reach = radius * Math.max(sx, sy, sz)
      if (!instanceVisible(ix, iy, iz, reach, planes)) continue
      const rot: Quaternion = [d[at + 12], d[at + 13], d[at + 14], d[at + 15]]
      const col: Color = [d[at + 8], d[at + 9], d[at + 10], alpha]
      const unlit = d[at + 11]
      entries.push({
        batch,
        batchIndex: bi,
        instanceIndex: ii,
        position: [ix, iy, iz],
        scale: [sx, sy, sz],
        rotation: rot,
        color: col,
        unlit,
        tag: tags?.[ii]
      })
      if (!idBatch) {
        idBatch = instances(uncoloredMesh(batch.mesh), { capacity: Math.min(batch.count, 32), blend: 'opaque' })
        idBatches.push(idBatch)
      }
      idBatch.add([ix, iy, iz], [sx, sy, sz], rot, tint(entries.length), 1)
    }
  }

  if (!idBatches.length) return undefined
  const { pixels } = renderMeshPixels(cropped, idBatches, 1, { ambient: 1 })
  const id = pixels[3] ? pixels[0] + (pixels[1] << 8) + (pixels[2] << 16) : 0
  return id > 0 ? entries[id - 1] : undefined
}

let spriteSampleCanvas: HTMLCanvasElement | undefined

function spritePixelOpaque(draw: SpriteDrawRecord, fx: number, fy: number): boolean {
  const { atlas, column, row } = draw
  const sx = column * atlas.frameWidth + fx
  const sy = row * atlas.frameHeight + fy
  if (atlas.pixels && atlas.imageWidth) {
    if (sx < 0 || sy < 0 || sx >= atlas.imageWidth) return false
    const offset = (sy * atlas.imageWidth + sx) * 4
    if (offset + 3 >= atlas.pixels.length) return false
    return atlas.pixels[offset + 3] > 0
  }
  if (atlas.image && typeof document !== 'undefined') {
    try {
      if (!spriteSampleCanvas) {
        spriteSampleCanvas = document.createElement('canvas')
        spriteSampleCanvas.width = 1
        spriteSampleCanvas.height = 1
      }
      const ctx = spriteSampleCanvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return true
      ctx.clearRect(0, 0, 1, 1)
      ctx.drawImage(atlas.image, sx, sy, 1, 1, 0, 0, 1, 1)
      return ctx.getImageData(0, 0, 1, 1).data[3] > 0
    } catch {
      return true
    }
  }
  return true
}

/** Generic 2D sprite reverse-order alpha hit-testing over recorded sprite draws. */
export function pickSpriteDraws(
  draws: readonly SpriteDrawRecord[],
  u: number,
  v: number
): PickedSpriteDraw | undefined {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return undefined
  for (let i = draws.length - 1; i >= 0; i--) {
    const draw = draws[i]
    const { rect, canvasWidth, canvasHeight } = draw
    if (!(canvasWidth > 0 && canvasHeight > 0 && rect.width > 0 && rect.height > 0)) continue
    const px = u * canvasWidth
    const py = v * canvasHeight
    if (px < rect.x || px > rect.x + rect.width || py < rect.y || py > rect.y + rect.height) continue
    const localU = Math.max(0, Math.min(1, (px - rect.x) / rect.width))
    const localV = Math.max(0, Math.min(1, (py - rect.y) / rect.height))
    const sampleU = draw.flip ? 1 - localU : localU
    const fx = Math.min(draw.atlas.frameWidth - 1, Math.max(0, Math.floor(sampleU * draw.atlas.frameWidth)))
    const fy = Math.min(draw.atlas.frameHeight - 1, Math.max(0, Math.floor(localV * draw.atlas.frameHeight)))
    if (!spritePixelOpaque(draw, fx, fy)) continue
    return { draw, index: i, localU, localV, pixelX: fx, pixelY: fy }
  }
  return undefined
}

const spriteDirectionsByLength = spriteDirections
  .map((name, index) => ({ name, index }))
  .sort((a, b) => b.name.length - a.name.length)

/** Recreate an asset at the saved yaw, elevation and framing. IDs use unlit colors for part picking. */
export function modelReviewFrame(kit: ReviewKit, pose: ArtView, size: number, ids = false) {
  if (!(Number.isFinite(pose.elevation) && Math.abs(pose.elevation) < Math.PI / 2)) {
    throw new RangeError('Review elevation must be strictly between -pi/2 and pi/2')
  }
  const group = kit.group(), canvas = reviewCanvas(size)
  const sprite = pose.surface === 'sprite'
  let angle = 0
  if (sprite) {
    if (pose.clip === 'turntable') {
      const frame = typeof pose.frame === 'number' && Number.isFinite(pose.frame) ? Math.floor(pose.frame) : 0
      angle = (((frame % spriteDirections.length) + spriteDirections.length) % spriteDirections.length) * Math.PI / 4
    } else {
      const clipName = typeof pose.clip === 'string' ? pose.clip : ''
      const matched = spriteDirectionsByLength.find(d => clipName === d.name || clipName.endsWith('-' + d.name))
      if (!matched) throw new RangeError('Unknown sprite direction clip: ' + pose.clip)
      angle = matched.index * Math.PI / 4
    }
  }
  const r = pose.span * 4, horizontal = r * Math.cos(pose.elevation)
  const camera = multiply(orthographic(pose.span, pose.span, pose.span / 100, pose.span * 8),
    view([horizontal * Math.sin(angle), pose.centerY + r * Math.sin(pose.elevation), horizontal * Math.cos(angle)], [0, pose.centerY, 0]))
  group.add(pose.asset, [0, 0, 0], { yaw: sprite ? 0 : pose.yaw, partTint: ids ? (_part, index) => tint(index + 1) : undefined })
  renderMeshFrame(canvas, camera, group.batches, ids ? { ambient: 1 } : undefined)
  return canvas
}

export interface ArtAuditReport {
  readonly passed: boolean
  readonly parts: number
  readonly triangles: number
  readonly hiddenParts: string[]
  readonly detachedParts: string[]
  readonly components: number
  readonly edgeTouches: number
  readonly fillRatio: number
  readonly lumRange: number
  readonly warnings: string[]
}

/** Programmatic quality constraint audit for a low-poly ArtModel or ArtRecipe. */
export function auditArtModel(
  rawSource: ArtModel | ArtRecipe,
  options: { palette?: Record<string, string>; frameSize?: number; maxTriangles?: number; maxParts?: number } = {}
): ArtAuditReport {
  const source: ArtModel = 'format' in rawSource
    ? modelFromArtRecipe(rawSource)
    : rawSource
  const frameSize = options.frameSize ?? source.frameSize ?? 48
  const maxTriangles = options.maxTriangles ?? 2000
  const maxParts = options.maxParts ?? 48
  const kit = createArtKit({ palette: options.palette, models: { subject: source }, frameSize })
  const grp = kit.group()
  grp.add('subject', [0, 0, 0])
  const vis = spritePartVisibility(kit, 'subject', frameSize)
  let hiddenParts = Object.entries(vis.parts).filter(([, c]) => c.every(n => n === 0)).map(([k]) => k)
  // If translucent/additive shells exist, verify whether flagged inner parts are visible when glass shells are removed!
  const isTranslucent = (p: ArtModel['parts'][number]) =>
    (p.alpha !== undefined && p.alpha < 0.95) || (p.blend !== undefined && p.blend !== 'opaque')
  if (hiddenParts.length && source.parts.some(isTranslucent)) {
    const canonicalNames = canonicalPartNames(source.parts)
    const hiddenSet = new Set(hiddenParts)
    const opaqueNamedParts = source.parts
      .map((p, i) => ({ ...p, name: canonicalNames[i] }))
      .filter((p) => !isTranslucent(p))
    if (opaqueNamedParts.length) {
      const innerModel: ArtModel = { ...source, parts: opaqueNamedParts }
      const innerKit = createArtKit({ palette: options.palette, models: { inner: innerModel }, frameSize })
      const innerVis = spritePartVisibility(innerKit, 'inner', frameSize)
      hiddenParts = hiddenParts.filter(name => !Object.hasOwn(innerVis.parts, name) || innerVis.parts[name].every(n => n === 0))
    }
    // Also check any still-hidden translucent/additive inner part against opaque occluders alone
    const stillHidden: string[] = []
    for (const hName of hiddenParts) {
      const idx = canonicalNames.indexOf(hName)
      if (idx >= 0 && isTranslucent(source.parts[idx]) && hiddenSet.has(hName)) {
        const testParts = [...opaqueNamedParts, { ...source.parts[idx], name: hName, alpha: 1, blend: 'opaque' as const }]
        const testModel: ArtModel = { ...source, parts: testParts }
        const testKit = createArtKit({ palette: options.palette, models: { test: testModel }, frameSize })
        const testVis = spritePartVisibility(testKit, 'test', frameSize)
        if (!Object.hasOwn(testVis.parts, hName) || testVis.parts[hName].every(n => n === 0)) stillHidden.push(hName)
      } else {
        stillHidden.push(hName)
      }
    }
    hiddenParts = stillHidden
  }
  const baked = bakeSpritePixels(grp.batches, { span: source.span, center: [0, source.centerY, 0], frameSize })

  let edgeTouches = 0, opaque0 = 0, lumMin = 255, lumMax = 0
  for (let d = 0; d < 8; d++) {
    for (let py = 0; py < frameSize; py++) {
      for (let px = 0; px < frameSize; px++) {
        const idx = (py * baked.width + d * frameSize + px) * 4
        if (baked.pixels[idx + 3] <= 16) continue
        if (px === 0 || px === frameSize - 1 || py === 0 || py === frameSize - 1) edgeTouches++
        if (d === 0) {
          opaque0++
          const lum = 0.2126 * baked.pixels[idx] + 0.7152 * baked.pixels[idx + 1] + 0.0722 * baked.pixels[idx + 2]
          if (lum < lumMin) lumMin = lum
          if (lum > lumMax) lumMax = lum
        }
      }
    }
  }

  // Approximate per-part world AABB connectivity check to catch floating pieces.
  const boxes = source.parts.map(p => {
    const r = p.mesh.radius * Math.max(p.scale[0], p.scale[1], p.scale[2])
    return {
      min: [p.position[0] - r, p.position[1] - r, p.position[2] - r],
      max: [p.position[0] + r, p.position[1] + r, p.position[2] + r]
    }
  })
  const n = boxes.length
  const margin = Math.max(0.03, source.span * 0.02)
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.min[0] - margin <= b.max[0] && a.max[0] + margin >= b.min[0] &&
          a.min[1] - margin <= b.max[1] && a.max[1] + margin >= b.min[1] &&
          a.min[2] - margin <= b.max[2] && a.max[2] + margin >= b.min[2]) {
        adj[i].push(j); adj[j].push(i)
      }
    }
  }
  const visited = new Uint8Array(n)
  const comps: number[][] = []
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue
    const comp: number[] = []
    const q = [i]
    let head = 0
    visited[i] = 1
    while (head < q.length) {
      const cur = q[head++]
      comp.push(cur)
      for (const nxt of adj[cur]) if (!visited[nxt]) { visited[nxt] = 1; q.push(nxt) }
    }
    comps.push(comp)
  }
  comps.sort((a, b) => b.length - a.length)
  const detachedParts = comps.slice(1).flat().map(i => partName(source.parts[i], i))
  const triangles = Math.round(source.parts.reduce((s, p) => s + p.mesh.vertexCount / 3, 0))
  const fillRatio = +(opaque0 / (frameSize * frameSize)).toFixed(3)
  const lumRange = opaque0 ? Math.round(lumMax - lumMin) : 0
  const warnings: string[] = []
  if (hiddenParts.length) warnings.push(`Hidden parts (0 visible px): ${hiddenParts.join(', ')}`)
  if (detachedParts.length) warnings.push(`Potentially disconnected parts: ${detachedParts.join(', ')}`)
  if (edgeTouches > 0) warnings.push(`Touches sprite frame edge (${edgeTouches} px across 8 views)`)
  if (triangles > maxTriangles) warnings.push(`Triangle count ${triangles} exceeds indie budget ${maxTriangles}`)
  if (source.parts.length > maxParts) warnings.push(`Part count ${source.parts.length} exceeds budget ${maxParts}`)
  if (lumRange < 70) warnings.push(`Low luminance contrast (${lumRange}); add stronger value separation`)

  return {
    passed: warnings.length === 0,
    parts: source.parts.length,
    triangles,
    hiddenParts,
    detachedParts,
    components: comps.length,
    edgeTouches,
    fillRatio,
    lumRange,
    warnings
  }
}

export {
  REVIEW_UUID_RE, TestingProtocolError, allowedScopesForSurface, checkPin, checkReview,
  checkSpriteManifest, isReviewEntry, isReviewScope, isReviewStatus, isReviewSurface,
  isThreeDSurface, isUnitRegion, parseReviewEntry, parseReviewList, resolveTestingUrlActivation,
  validateReviewComment, validateReviewId
} from './testing-protocol.ts'
export type {
  CreateReviewInput, ReviewEntry, ReviewListResult, ReviewStorePort, SaveRecipeInput,
  SaveRecipeResult, SaveSpriteInput, SaveSpriteResult, SpriteManifestInput, UpdateReviewInput
} from './testing-protocol.ts'
export {
  instanceWorldAabb, projectAabbToNormalizedScreen, recognizeAssetFromPick
} from './testing-recognition.ts'
export type { WorldAabb } from './testing-recognition.ts'
export {
  createArtRecipeEditor, createHttpReviewStore, createMemoryReviewStore,
  createTestingStudioSession, surfaceLabel
} from './testing-session.ts'
export type {
  ArtPartEditPatch, ArtRecipeEditor, MemoryReviewStore, PickResult, ReloadCompareState,
  StudioSelection, TestingStudioEnvironment, TestingStudioSession, ViewportRect
} from './testing-session.ts'
