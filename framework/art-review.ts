import { createArtKit } from './art.ts'
import { multiply, orthographic, view } from './geometry.ts'
import { renderMeshFrame, spriteDirections } from './low-poly.ts'
import type { ArtPart } from './art-recipe.ts'
import type { Color, Matrix } from './types.ts'

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
export function pickId(image: HTMLCanvasElement, u: number, v: number) {
  if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return 0
  const [r, g, b, a] = image.getContext('2d').getImageData(Math.floor(u * image.width), Math.floor(v * image.height), 1, 1).data
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
  const group = kit.group()
  const parts: { object: ReviewObject; part: string }[] = []
  for (const object of objects) {
    group.add(object.name, [object.x, object.y ?? 0, object.z], { yaw: object.yaw, partTint(part, i) {
      parts.push({ object, part: partName(part, i) })
      return tint(parts.length)
    } })
  }
  // Crop the orthographic camera to the clicked pixel. Depth and winding stay identical.
  const x = (Math.floor(u * width) + .5) * 2 / width - 1
  const y = 1 - (Math.floor(v * height) + .5) * 2 / height
  const crop = new Float32Array([width,0,0,0, 0,height,0,0, 0,0,1,0, -width*x,-height*y,0,1])
  const pixel = reviewCanvas(1)
  renderMeshFrame(pixel, multiply(crop, camera), group.batches, { ambient: 1 })
  return parts[pickId(pixel, .5, .5) - 1]
}

/** Recreate an asset at the saved yaw, elevation and framing. IDs use unlit colors for part picking. */
export function modelReviewFrame(kit: ReviewKit, pose: ArtView, size: number, ids = false) {
  const group = kit.group(), canvas = reviewCanvas(size)
  const sprite = pose.surface !== 'model'
  const angle = sprite ? spriteDirections.indexOf(pose.clip as typeof spriteDirections[number]) * Math.PI / 4 : 0
  const r = pose.span * 4, horizontal = r * Math.cos(pose.elevation)
  const camera = multiply(orthographic(pose.span, pose.span, pose.span / 100, pose.span * 8),
    view([horizontal * Math.sin(angle), pose.centerY + r * Math.sin(pose.elevation), horizontal * Math.cos(angle)], [0, pose.centerY, 0]))
  group.add(pose.asset, [0, 0, 0], { yaw: sprite ? 0 : pose.yaw, partTint: ids ? (_part, index) => tint(index + 1) : undefined })
  renderMeshFrame(canvas, camera, group.batches, ids ? { ambient: 1 } : undefined)
  return canvas
}
