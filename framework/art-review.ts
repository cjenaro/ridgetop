import { createArtKit } from './art.ts'
import { multiply, orthographic, view } from './geometry.ts'
import { frustum, visible } from './instances.ts'
import { bakeSpritePixels, renderMeshFrame, renderMeshPixels, spriteDirections } from './low-poly.ts'
import type { ArtModel, ArtPart } from './art-recipe.ts'
import type { Color, InstanceBatch, Matrix, Vec3 } from './types.ts'

export type ReviewKit = ReturnType<typeof createArtKit<string>>
export interface ReviewObject { id: string; name: string; x: number; z: number; y?: number; yaw?: number }
export type ReviewScope = 'asset' | 'instance' | 'sprite' | 'hud'
export type ReviewStatus = 'open' | 'ready' | 'resolved'
export interface ArtView {
  surface: 'model' | 'sprite' | 'hud'
  asset: string; instance: string; source: string; position: number[]
  yaw: number; elevation: number; span: number; centerY: number; width: number; height: number
  clip?: string; frame?: number; column?: number; row?: number; handDrawn?: boolean; sheet?: string
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
    named[key] = counts[i]
  }
  return { frameSize, directions: spriteDirections, parts: named }
}
export function pickId(image: HTMLCanvasElement, u: number, v: number) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1) || image.width <= 0 || image.height <= 0) return 0
  const px = Math.min(image.width - 1, Math.floor(u * image.width))
  const py = Math.min(image.height - 1, Math.floor(v * image.height))
  const [r, g, b, a] = image.getContext('2d').getImageData(px, py, 1, 1).data
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
