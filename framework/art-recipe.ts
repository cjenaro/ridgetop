import { box, chamferedPrism, cylinder, octahedron } from './geometry.ts'
import { spriteDirections } from './low-poly.ts'
import type { Mesh, Vec3 } from './types.ts'

export const artPalette = {
  ground: '#92b878', leaf: '#43836c', wood: '#96694e', stone: '#889ba7',
  ink: '#344556', accent: '#eaa555', light: '#ffe4ad', glow: '#82ebd0'
}
export const artShapes = { box, prism: chamferedPrism(.16), cylinder: cylinder(7), cone: cylinder(7, 0), octahedron }
export type ArtTone = keyof typeof artPalette
export type ArtShape = keyof typeof artShapes
type Palette = Partial<Record<ArtTone, string>>

export interface ArtPart {
  name?: string
  mesh: Mesh
  position: Vec3
  scale: Vec3
  tone: ArtTone
  yaw?: number
  unlit?: number
}
export interface ArtModel {
  /** Square camera span and vertical center. Model origins are at ground level. */
  span: number
  centerY: number
  parts: readonly ArtPart[]
  palette?: Palette
  frameSize?: number
  timings?: Record<string, number>
}
export interface ArtRecipePart extends Omit<ArtPart, 'mesh' | 'name'> {
  name: string
  shape: ArtShape
}
export interface ArtRecipe {
  format: 'ridgetop-art'
  version: 1
  name: string
  span: number
  centerY: number
  frameSize: number
  palette: Palette
  parts: ArtRecipePart[]
  timings?: Record<string, number>
}

function record(value: unknown) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

export function checkArtPalette(palette: Palette, standardRoles = false) {
  if (!record(palette)) throw new RangeError('Expected an art palette object')
  for (const [role, hex] of Object.entries(palette)) {
    if (standardRoles && !Object.hasOwn(artPalette, role)) throw new RangeError('Unknown palette role ' + role)
    if (typeof hex !== 'string' || !/^#?[\da-f]{6}$/i.test(hex)) throw new RangeError('Expected a six-digit RGB color for ' + role)
  }
}
export function checkFrameSize(size: number) {
  if (!Number.isInteger(size) || size < 1 || size > 1024) throw new RangeError('Frame size must be 1–1024 pixels')
}
const clips = new Set<string>(['turntable', ...spriteDirections])

export function checkArtModel(model: ArtModel, name: string, palette: Palette = artPalette) {
  if (!(model?.span > 0 && Number.isFinite(model.span) && Number.isFinite(model.centerY) && Array.isArray(model.parts) && model.parts.length)) {
    throw new RangeError('Expected a camera span, centerY and model parts for ' + name)
  }
  if (model.palette !== undefined) checkArtPalette(model.palette)
  if (model.frameSize !== undefined) checkFrameSize(model.frameSize)
  if (model.timings !== undefined && (!record(model.timings) || Object.entries(model.timings).some(([clip, ms]) =>
    !clips.has(clip) || !Number.isSafeInteger(ms) || ms < 1))) throw new RangeError('Invalid direction or frame time in ' + name)
  for (const p of model.parts) {
    if (!p?.mesh?.vertexCount || !(Object.hasOwn(palette, p.tone) || Object.hasOwn(model.palette ?? {}, p.tone)) ||
        p.position?.length !== 3 || !p.position.every?.(Number.isFinite) || p.scale?.length !== 3 || !p.scale.every?.(n => n > 0 && Number.isFinite(n)) ||
        !Number.isFinite(p.yaw ?? 0) || !Number.isFinite(p.unlit ?? 0) || (p.unlit ?? 0) < 0 || (p.unlit ?? 0) > 1) {
      throw new RangeError('Invalid mesh, palette tone or transform in ' + name + (p?.name ? ' / ' + p.name : ''))
    }
  }
}

/** Read editable JSON into the same geometry used by live meshes and directional sprites. */
export function modelFromArtRecipe(value: unknown): ArtModel {
  const input = value as ArtRecipe
  if (input?.format !== 'ridgetop-art' || input.version !== 1) throw new Error('Expected a Ridgetop art recipe, version 1.')
  // Keep the live model and its cached sprites in sync if a caller continues editing the source.
  const source = structuredClone(input)
  if (typeof source.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(source.name)) throw new Error('Use letters, digits, hyphens or underscores for the model filename.')
  checkFrameSize(source.frameSize)
  checkArtPalette(source.palette, true)
  if (!Array.isArray(source.parts) || !source.parts.length) throw new Error('A recipe needs at least one named part.')
  const names = new Set<string>()
  const parts = source.parts.map(p => {
    if (typeof p?.name !== 'string' || !p.name.trim() || names.has(p.name)) throw new Error('Each model part needs a unique name.')
    if (!Object.hasOwn(artShapes, p.shape)) throw new Error('Unknown shape in ' + p.name)
    names.add(p.name)
    return { name: p.name, mesh: artShapes[p.shape], position: p.position, scale: p.scale, tone: p.tone, yaw: p.yaw, unlit: p.unlit }
  })
  const model = { span: source.span, centerY: source.centerY, frameSize: source.frameSize, palette: source.palette, parts, timings: source.timings }
  checkArtModel(model, source.name)
  return model
}
