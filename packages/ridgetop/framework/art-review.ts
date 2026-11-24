import { createArtKit } from './art.ts'
import { multiply, orthographic, view } from './geometry.ts'
import { INSTANCE_SIZE, frustum, instances, visible } from './instances.ts'
import { bakeSpritePixels, renderMeshFrame, renderMeshPixels, spriteDirections } from './low-poly.ts'
import type { ArtModel, ArtPart } from './art-recipe.ts'
import type { Picked3DInstance, SpriteDrawRecord } from './testing-runtime.ts'
import type { Color, InstanceBatch, Matrix, Quaternion, Vec3 } from './types.ts'

export type ReviewKit = ReturnType<typeof createArtKit<string>>
export interface ReviewObject { id: string; name: string; x: number; z: number; y?: number; yaw?: number }
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
    const direction = Math.floor((i/4 % width)/frameSize)
    counts[id-1][direction]++
  }
  const named: Record<string, number[]> = {}
  for (let i = 0; i < model.parts.length; i++) {
    const base = partName(model.parts[i], i)
    let key = base
    let suffix = 2
    while (Object.hasOwn(named, key)) key = `${base}#${suffix++}`
    Object.defineProperty(named, key, { value: counts[i], enumerable: true, writable: true, configurable: true })
  }
  return { frameSize, directions: spriteDirections, parts: named }
}
export function pickId(image: HTMLCanvasElement, u: number, v: number) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1) || image.width <= 0 || image.height <= 0) return 0
  const px = Math.min(image.width - 1, Math.floor(u * image.width))
  const py = Math.min(image.height - 1, Math.floor(v * image.height))
  const ctx = image.getContext('2d')
  if (!ctx) return 0
  const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data
  return a ? r + (g << 8) + (b << 16) : 0
}
export function reviewCanvas(width: number, height = width) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/** Uses the same transforms and depth test as the playfield, so the frontmost visible part wins. */
export function pickArtScene(kit: ReviewKit, objects: ReviewObject[], camera: Matrix, width: number, height: number, u: number, v: number) {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height) && u >= 0 && u <= 1 && v >= 0 && v <= 1)) return undefined
  const group = kit.group()
  const parts: { object: ReviewObject; part: string }[] = []
  for (const object of objects) {
    group.add(object.name, [object.x, object.y ?? 0, object.z], { yaw: object.yaw, partTint(part, i) {
      parts.push({ object, part: partName(part, i) })
      return tint(parts.length)
    } })
  }
  // Crop the orthographic camera to the clicked pixel. Depth and winding stay identical.
  const px = Math.min(width - 1, Math.floor(u * width))
  const py = Math.min(height - 1, Math.floor(v * height))
  const x = (px + .5) * 2 / width - 1
  const y = 1 - (py + .5) * 2 / height
  const crop = new Float32Array([width,0,0,0, 0,height,0,0, 0,0,1,0, -width*x,-height*y,0,1])
  const cropped = multiply(crop, camera)
  const planes = frustum(cropped)
  const culled = group.batches.filter(batch => visible(batch, planes))
  if (!culled.length) return undefined
  const { pixels } = renderMeshPixels(cropped, culled, 1, { ambient: 1 })
  const id = pixels[3] ? pixels[0] + (pixels[1] << 8) + (pixels[2] << 16) : 0
  return parts[id - 1]
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
        idBatch = instances(batch.mesh, { capacity: Math.min(batch.count, 32), blend: 'opaque' })
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

/** Recreate an asset at the saved yaw, elevation and framing. IDs use unlit colors for part picking. */
export function modelReviewFrame(kit: ReviewKit, pose: ArtView, size: number, ids = false) {
  if (!(Number.isFinite(pose.elevation) && Math.abs(pose.elevation) < Math.PI / 2)) {
    throw new RangeError('Review elevation must be strictly between -pi/2 and pi/2')
  }
  const group = kit.group(), canvas = reviewCanvas(size)
  const sprite = pose.surface !== 'model'
  let angle = 0
  if (sprite) {
    if (pose.clip === 'turntable') {
      const frame = Number.isFinite(pose.frame) ? Math.floor(pose.frame!) : 0
      angle = (((frame % spriteDirections.length) + spriteDirections.length) % spriteDirections.length) * Math.PI / 4
    } else {
      const idx = spriteDirections.indexOf(pose.clip as typeof spriteDirections[number])
      if (idx < 0) throw new RangeError('Unknown sprite direction clip: ' + pose.clip)
      angle = idx * Math.PI / 4
    }
  }
  const r = pose.span * 4, horizontal = r * Math.cos(pose.elevation)
  const camera = multiply(orthographic(pose.span, pose.span, pose.span / 100, pose.span * 8),
    view([horizontal * Math.sin(angle), pose.centerY + r * Math.sin(pose.elevation), horizontal * Math.cos(angle)], [0, pose.centerY, 0]))
  group.add(pose.asset, [0, 0, 0], { yaw: sprite ? 0 : pose.yaw, partTint: ids ? (_part, index) => tint(index + 1) : undefined })
  renderMeshFrame(canvas, camera, group.batches, ids ? { ambient: 1 } : undefined)
  return canvas
}
