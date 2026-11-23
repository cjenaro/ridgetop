import { instances } from './instances.ts'
import { quaternionFromEuler } from './geometry.ts'
import { bakeSpriteDirections } from './low-poly.ts'
import { color } from './renderer.ts'
import { artPalette, artShapes, checkArtModel, checkArtPalette, checkFrameSize } from './art-recipe.ts'
import type { ArtModel, ArtPart, ArtRecipe, ArtShape, ArtTone } from './art-recipe.ts'
import type { Color, InstanceBatch, Mesh, Vec3 } from './types.ts'
export { artPalette, artShapes, modelFromArtRecipe } from './art-recipe.ts'
export type { ArtModel, ArtPart, ArtRecipe, ArtRecipePart, ArtShape, ArtTone } from './art-recipe.ts'

const { box, prism, cylinder: trunk, cone: canopy, octahedron } = artShapes
function part(name: string, mesh: Mesh, position: Vec3, scale: Vec3, tone: ArtTone, yaw = 0, unlit = 0): ArtPart {
  return { name, mesh, position, scale, tone, yaw, unlit }
}

export const artModels = {
  ranger: { span: 1.8, centerY: .70, parts: [
    part('left-boot', prism, [-.16, .12, .06], [.24, .24, .38], 'ink'),
    part('right-boot', prism, [.16, .12, .06], [.24, .24, .38], 'ink'),
    part('jacket', prism, [0, .49, 0], [.56, .56, .40], 'accent'),
    part('belt', box, [0, .35, .02], [.55, .08, .40], 'ink'),
    part('backpack', prism, [0, .54, -.26], [.39, .42, .22], 'wood'),
    part('left-sleeve', prism, [-.33, .52, .04], [.16, .34, .19], 'wood', -.12),
    part('right-sleeve', prism, [.33, .52, .04], [.16, .34, .19], 'wood', .12),
    part('collar', prism, [0, .80, .02], [.60, .12, .51], 'glow'),
    part('helmet', prism, [0, 1.03, 0], [.68, .46, .55], 'accent'),
    part('visor', prism, [0, 1.01, .23], [.51, .22, .15], 'ink'),
    part('visor-light', box, [.07, 1.06, .309], [.19, .045, .02], 'glow', 0, .8),
    part('antenna', prism, [-.19, 1.28, -.01], [.13, .19, .16], 'light')
  ] },
  tile: { span: 1.52, centerY: -.11, parts: [
    part('earth', prism, [0, -.18, 0], [1, .32, 1], 'wood'),
    part('grass', box, [0, -.035, 0], [.955, .09, .955], 'ground')
  ] },
  pine: { span: 2.5, centerY: 1, parts: [
    part('trunk', trunk, [0, .33, 0], [.15, .66, .15], 'wood'),
    part('lower-branches', canopy, [0, .85, 0], [.57, .91, .57], 'leaf'),
    part('middle-branches', canopy, [0, 1.24, 0], [.45, .84, .45], 'leaf', .36),
    part('crown', canopy, [0, 1.62, 0], [.31, .72, .31], 'ground', .12)
  ] },
  rock: { span: 1.65, centerY: .30, parts: [
    part('boulder', prism, [-.10, .30, 0], [.89, .60, .69], 'stone', .38),
    part('pebble', prism, [.31, .14, .20], [.48, .28, .44], 'ink', -.36),
    part('moss', prism, [-.12, .59, 0], [.51, .05, .41], 'ground', .38)
  ] },
  crate: { span: 1.55, centerY: .4, parts: [
    part('case', prism, [0, .39, 0], [.79, .78, .76], 'wood'),
    part('left-band', box, [-.25, .41, 0], [.09, .78, .78], 'ink'),
    part('right-band', box, [.25, .41, 0], [.09, .78, .78], 'ink'),
    part('latch', box, [0, .42, .375], [.32, .18, .045], 'accent')
  ] },
  crystal: { span: 1.35, centerY: .49, parts: [
    part('base', prism, [0, .13, 0], [.44, .18, .43], 'accent', .3),
    part('main-crystal', octahedron, [0, .54, 0], [.30, .43, .26], 'glow', .38, .35),
    part('shard', octahedron, [-.22, .39, .06], [.12, .21, .12], 'light', .18, .45)
  ] },
  lantern: { span: 2.2, centerY: .80, parts: [
    part('foot', prism, [0, .12, 0], [.85, .24, .83], 'stone'),
    part('post', trunk, [0, .49, 0], [.13, .56, .13], 'wood'),
    part('lamp-base', prism, [0, .81, 0], [.57, .14, .57], 'ink'),
    part('light', prism, [0, 1.08, 0], [.38, .47, .38], 'light', 0, .85),
    part('left-frame', box, [-.20, 1.08, .20], [.055, .47, .055], 'wood'),
    part('right-frame', box, [.20, 1.08, .20], [.055, .47, .055], 'wood'),
    part('roof', canopy, [0, 1.47, 0], [.43, .42, .43], 'accent')
  ] },
  spark: { span: 1.2, centerY: .49, parts: [
    part('vertical-ray', octahedron, [0, .49, 0], [.15, .36, .13], 'light', 0, 1),
    part('cross-ray', octahedron, [0, .49, 0], [.32, .10, .13], 'glow', 0, 1),
    part('glint', octahedron, [.28, .75, 0], [.06, .11, .05], 'light', 0, 1)
  ] }
} satisfies Record<string, ArtModel>

const shapeNames = new Map(Object.entries(artShapes).map(([key, mesh]) => [mesh, key as ArtShape]))

/** Make an independent, editable source file for a built-in model. */
export function createArtRecipe(name: keyof typeof artModels): ArtRecipe {
  if (!Object.hasOwn(artModels, name)) throw new Error('Unknown built-in art model: ' + name)
  const { span, centerY, parts } = artModels[name]
  const palette = Object.fromEntries(parts.map(p => [p.tone, artPalette[p.tone]]))
  return { format: 'ridgetop-art', version: 1, name, span, centerY, frameSize: 64, palette,
    parts: parts.map(p => ({ name: p.name, shape: shapeNames.get(p.mesh), position: [...p.position], scale: [...p.scale],
      tone: p.tone, ...(p.pitch ? { pitch: p.pitch } : {}), ...(p.yaw ? { yaw: p.yaw } : {}),
      ...(p.roll ? { roll: p.roll } : {}), ...(p.unlit ? { unlit: p.unlit } : {}) })) }
}

/** A palette and named model recipes shared by mesh batches and cached, in-memory sprite sheets. */
export function createArtKit<Extra extends string = never>({
  palette = {}, models, frameSize = 64
}: { palette?: Partial<Record<ArtTone, string>>; models?: Record<Extra, ArtModel>; frameSize?: number } = {}) {
  type Name = keyof typeof artModels | Extra
  const catalog: Record<string, ArtModel> = { ...artModels, ...models }
  checkArtPalette(palette)
  checkFrameSize(frameSize)
  const rgb = { ...artPalette, ...palette }
  function colorsFor(values: typeof rgb) {
    return new Map(Object.entries(values).map(([role, hex]) => [role, color(hex)]))
  }
  const colors = colorsFor(rgb)
  const overrides = new Map<Name, typeof colors>()
  for (const [name, recipe] of Object.entries(catalog)) {
    checkArtModel(recipe, name, rgb)
    if (recipe.palette) overrides.set(name as Name, colorsFor({ ...rgb, ...recipe.palette }))
  }
  const sprites = new Map<Name, ReturnType<typeof bakeSpriteDirections>>()

  function model(name: Name): ArtModel {
    if (!Object.hasOwn(catalog, name)) throw new RangeError('Unknown art model: ' + name)
    return catalog[name]
  }

  function group() {
    const batches: InstanceBatch[] = []
    const byMesh = new Map<Mesh, InstanceBatch>()
    return {
      batches: batches as readonly InstanceBatch[],
      clear() { for (const batch of batches) batch.clear() },
      add(name: Name, [x, y, z]: Vec3, { yaw = 0, scale = 1, partTint }:
        { yaw?: number; scale?: number; partTint?: (part: ArtPart, index: number) => Color } = {}) {
        if (!(scale > 0 && [x, y, z, scale, yaw].every(Number.isFinite))) throw new RangeError('Invalid art transform')
        const cos = Math.cos(yaw), sin = Math.sin(yaw)
        const tones = overrides.get(name) ?? colors
        let index = 0
        for (const piece of model(name).parts) {
          let batch = byMesh.get(piece.mesh)
          if (!batch) {
            batch = instances(piece.mesh)
            byMesh.set(piece.mesh, batch)
            batches.push(batch)
          }
          const [px, py, pz] = piece.position
          const [sx, sy, sz] = piece.scale
          const facing = yaw + (piece.yaw ?? 0)
          const rotation = piece.pitch || piece.roll ? quaternionFromEuler(piece.pitch, facing, piece.roll) : facing
          batch.add([x + (px * cos + pz * sin) * scale, y + py * scale, z + (pz * cos - px * sin) * scale],
            [sx * scale, sy * scale, sz * scale], rotation, partTint?.(piece, index) ?? tones.get(piece.tone), piece.unlit)
          index++
        }
      }
    }
  }

  function sprite(name: Name) {
    let sheet = sprites.get(name)
    if (!sheet) {
      const { span, centerY, frameSize: size = frameSize, timings } = model(name)
      const instance = group()
      instance.add(name, [0, 0, 0])
      sheet = bakeSpriteDirections(instance.batches, { span, center: [0, centerY, 0], frameSize: size,
        src: encodeURIComponent(name) + '-sheet.png' })
      for (const [clip, ms] of Object.entries(timings ?? {})) sheet.manifest.clips[clip].frameMs = ms
      sprites.set(name, sheet)
    }
    return sheet
  }

  return { model, group, sprite, palette: { ...rgb } }
}
