import { createAnimator, createMeshPool, createRig, renderRig, sampleClip } from './animation.ts'
import type { AnimationClip, Keyframe, Rig, RigJoint, RigPart } from './animation.ts'
import { instances } from './instances.ts'
import { multiply, orthographic, quaternionFromEuler, view } from './geometry.ts'
import { applySpriteOutline, bakeSpriteDirections, bakeSpritePixels, renderMeshPixels, spriteDirections } from './low-poly.ts'
import { color } from './renderer.ts'
import type { SpriteAtlasSource, SpriteClip, SpriteSheetImage } from './sprites.ts'
import { artPalette, artPoseBounds, artShapes, checkArtModel, checkArtPalette, checkFrameSize, compileArtJoints, modelFromArtRecipe } from './art-recipe.ts'
import type { ArtModel, ArtPart, ArtRecipe, ArtShape, ArtTone } from './art-recipe.ts'
import { captureSourceSite, isTestingActive, nextTestingGroupId, registerArtKitRuntime } from './testing-runtime.ts'
import type { BlendMode, Color, InstanceBatch, LightingOptions, Mesh, Vec3 } from './types.ts'
export { artPalette, artShapes, modelFromArtRecipe } from './art-recipe.ts'
export type { ArtModel, ArtPart, ArtRecipe, ArtRecipeClip, ArtRecipeClipFrame, ArtRecipeJoint, ArtRecipeJointPose, ArtRecipePart, ArtShape, ArtTone } from './art-recipe.ts'

function resolvePartColor(base: Color, part: Pick<ArtPart, 'alpha' | 'shade'>): Color {
  const shade = part.shade ?? 0
  const alpha = part.alpha ?? 1
  if (!shade && alpha === 1) return base
  const clamp = (n: number) => n < 0 ? 0 : n > 1 ? 1 : n
  const r = shade >= 0 ? base[0] + (1 - base[0]) * shade : base[0] * (1 + shade)
  const g = shade >= 0 ? base[1] + (1 - base[1]) * shade : base[1] * (1 + shade)
  const b = shade >= 0 ? base[2] + (1 - base[2]) * shade : base[2] * (1 + shade)
  return [clamp(r), clamp(g), clamp(b), alpha]
}

function resolvePartBlend(part: Pick<ArtPart, 'alpha' | 'blend'>): BlendMode {
  if (part.blend) return part.blend
  return (part.alpha !== undefined && part.alpha < 1) ? 'alpha' : 'opaque'
}

export type SpriteDirection = typeof spriteDirections[number]

export interface ArtRig {
  readonly rig: Rig
  readonly clips: Readonly<Record<string, AnimationClip>>
  createAnimator(initial?: string): ReturnType<typeof createAnimator<string>>
}

export interface AnimatedSpriteOptions {
  /** Single clip name to bake. Mutually exclusive with `clips`. */
  clip?: string
  /** Ordered list of clip names to bake into one sheet. Defaults to all clips on the model. */
  clips?: readonly string[]
  /** Frames to sample per clip (single count or per-clip map). */
  frames?: number | Readonly<Record<string, number>>
  /** Playback frame rate used to compute `frameMs` (and default frame count when `frames` is omitted). */
  fps?: number
  /** Square pixel size of each cell. Defaults to `model.frameSize ?? 64`. */
  frameSize?: number
  /** Directions to render (one row per direction). Defaults to all 8 `spriteDirections`. */
  directions?: readonly SpriteDirection[]
  /** Keep the lowest vertex grounded at y = 0 on every sampled frame. Defaults to `true`. */
  alignFeet?: boolean
  /** Optional palette overrides for tone resolution. */
  palette?: Partial<Record<ArtTone, string>>
  /** Optional camera framing overrides. */
  span?: number
  centerY?: number
  elevation?: number
  lighting?: LightingOptions
  /** Optional 1px pixel-art exterior outline (`'selout'` or 6-digit hex color) for Dead Cells-style 3D-to-pixel sprite sheets. */
  outline?: string
  /** Manifest `src` filename. */
  src?: string
}

export interface BakedSpriteManifest extends SpriteAtlasSource {
  clips: Record<string, SpriteClip>
}

export interface BakedSpriteSheet extends SpriteSheetImage {
  manifest: BakedSpriteManifest
}

export interface BakedSpritePixels {
  width: number
  height: number
  pixels: Uint8ClampedArray<ArrayBuffer>
  manifest: BakedSpriteManifest
}

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

function isArtShape(key: string): key is ArtShape {
  return Object.hasOwn(artShapes, key)
}

const shapeNames = new Map<Mesh, ArtShape>()
for (const key of Object.keys(artShapes)) {
  if (isArtShape(key)) shapeNames.set(artShapes[key], key)
}

/** Make an independent, editable source file for a built-in model. */
export function createArtRecipe(name: keyof typeof artModels): ArtRecipe {
  if (!Object.hasOwn(artModels, name)) throw new Error('Unknown built-in art model: ' + name)
  const entry: ArtModel = artModels[name]
  const { span, centerY, parts } = entry
  const paletteMap: Record<string, string | undefined> = { ...artPalette, ...entry.palette }
  const palette = Object.fromEntries(parts.map(p => [p.tone, paletteMap[p.tone] ?? artPalette.accent]))
  return {
    format: 'ridgetop-art', version: 1, name, span, centerY, frameSize: 64, palette,
    parts: parts.map((p, index) => {
      const shape = shapeNames.get(p.mesh)
      if (!shape) throw new Error('Unknown art shape in built-in model: ' + name)
      return {
        name: p.name ?? 'part-' + (index + 1), shape,
        position: [p.position[0], p.position[1], p.position[2]] as const,
        scale: [p.scale[0], p.scale[1], p.scale[2]] as const,
        tone: p.tone, ...(p.pitch ? { pitch: p.pitch } : {}), ...(p.yaw ? { yaw: p.yaw } : {}),
        ...(p.roll ? { roll: p.roll } : {}), ...(p.unlit ? { unlit: p.unlit } : {}),
        ...(p.joint ? { joint: p.joint } : {})
      }
    }),
    ...(entry.joints ? { joints: Array.from(entry.joints, j => structuredClone(j)) } : {}),
    ...(entry.clips ? { clips: Object.fromEntries(Object.entries(entry.clips).map(([k, v]) => [k, structuredClone(v)])) } : {})
  }
}

/** Convert an ArtModel (rigged or static) and palette into a runtime animation Rig + AnimationClips. */
export function rigFromArtModel(model: ArtModel, palette: Partial<Record<ArtTone, string>> = {}): ArtRig {
  checkArtPalette(palette)
  const basePalette = { ...artPalette, ...palette }
  checkArtModel(model, 'model', basePalette)
  const resolved = { ...basePalette, ...model.palette }
  const toneColors = new Map(Object.entries(resolved).map(([role, hex]) => [role, color(hex)]))

  const srcJoints = model.joints ?? []
  const { parentIndex, restPos, indexById } = compileArtJoints(srcJoints)
  const partsByJoint: RigPart[][] = srcJoints.map(() => [])
  const unboundParts: RigPart[] = []

  for (const p of model.parts) {
    const jIdx = p.joint !== undefined ? indexById.get(p.joint) : undefined
    const rp = jIdx !== undefined ? restPos[jIdx] : [0, 0, 0]
    const partColor = toneColors.get(p.tone)
    if (!partColor) throw new RangeError('Unknown palette tone: ' + p.tone)
    const blend = resolvePartBlend(p)
    const rigPart: RigPart = {
      ...(p.name !== undefined ? { name: p.name } : {}),
      mesh: p.mesh,
      position: [p.position[0] - rp[0], p.position[1] - rp[1], p.position[2] - rp[2]],
      scale: [p.scale[0], p.scale[1], p.scale[2]],
      ...(p.pitch || p.yaw || p.roll ? { rotation: [p.pitch ?? 0, p.yaw ?? 0, p.roll ?? 0] as const } : {}),
      color: resolvePartColor(partColor, p),
      ...(p.unlit ? { unlit: p.unlit } : {}),
      ...(blend !== 'opaque' ? { blend } : {})
    }
    if (jIdx !== undefined) partsByJoint[jIdx].push(rigPart)
    else unboundParts.push(rigPart)
  }

  const rigJoints: RigJoint[] = srcJoints.map((j, idx) => {
    const pIdx = parentIndex[idx]
    const rp = restPos[idx]
    const prp = pIdx >= 0 ? restPos[pIdx] : [0, 0, 0]
    return {
      id: j.id,
      ...(j.parent !== undefined ? { parent: j.parent } : {}),
      pivot: [rp[0] - prp[0], rp[1] - prp[1], rp[2] - prp[2]],
      ...(partsByJoint[idx].length ? { parts: partsByJoint[idx] } : {})
    }
  })

  if (unboundParts.length || !rigJoints.length) {
    let staticId = 'root'
    if (indexById.has(staticId)) {
      staticId = '__static__'
      let suffix = 1
      while (indexById.has(staticId)) staticId = `__static_${suffix++}__`
    }
    rigJoints.unshift({ id: staticId, pivot: [0, 0, 0], parts: unboundParts })
  }

  const rig = createRig(rigJoints)
  const clips: Record<string, AnimationClip> = {}
  for (const [clipName, recipeClip] of Object.entries(model.clips ?? {})) {
    const tracks: Record<string, Keyframe[]> = Object.create(null)
    for (const frame of recipeClip.frames) {
      for (const [jointId, pose] of Object.entries(frame.poses)) {
        const list = Object.hasOwn(tracks, jointId) ? tracks[jointId] : (tracks[jointId] = [])
        list.push({
          t: frame.time,
          ...(pose.position ? { position: [pose.position[0], pose.position[1], pose.position[2]] as const } : {}),
          ...(pose.rotation ? { rotation: [pose.rotation[0], pose.rotation[1], pose.rotation[2]] as const } : {}),
          ...(pose.scale ? { scale: [pose.scale[0], pose.scale[1], pose.scale[2]] as const } : {}),
          ...(recipeClip.easing ? { ease: recipeClip.easing } : {})
        })
      }
    }
    clips[clipName] = {
      duration: recipeClip.duration,
      ...(recipeClip.loop !== undefined ? { loop: recipeClip.loop } : {}),
      tracks
    }
  }

  const clipNames = Object.keys(clips)
  const restClips: Record<string, AnimationClip> = { rest: { duration: 1, loop: true, tracks: {} } }
  return {
    rig,
    clips,
    createAnimator(initial?: string) {
      if (initial !== undefined) {
        if (!Object.hasOwn(clips, initial)) throw new RangeError('Unknown animation clip: ' + initial)
        return createAnimator(clips, initial)
      }
      if (!clipNames.length) return createAnimator(restClips, 'rest')
      const start = Object.hasOwn(clips, 'idle') ? 'idle' : clipNames[0]
      return createAnimator(clips, start)
    }
  }
}

/** Parse a `.art.json` recipe and convert it directly into a runtime Rig + AnimationClips. */
export function rigFromArtRecipe(recipe: unknown, palette?: Partial<Record<ArtTone, string>>): ArtRig {
  return rigFromArtModel(modelFromArtRecipe(recipe), palette)
}

function isArtRecipe(source: ArtModel | ArtRecipe): source is ArtRecipe {
  return source !== null && typeof source === 'object' && 'format' in source && source.format === 'ridgetop-art'
}

function resolveArtModel(source: ArtModel | ArtRecipe): ArtModel {
  if (isArtRecipe(source)) {
    return modelFromArtRecipe(source)
  }
  return source
}

const directionIndex = new Map<string, number>(spriteDirections.map((d, i) => [d, i]))

/**
 * Sample a rigged model's animation clip(s) across frames and directions into a single RGBA sprite sheet
 * without needing a DOM canvas. Rows correspond to directions and columns correspond to sequential clip frames.
 */
export function bakeAnimatedSpritePixels(source: ArtModel | ArtRecipe, options: AnimatedSpriteOptions = {}): BakedSpritePixels {
  const model = resolveArtModel(source)
  if (options.clip !== undefined && options.clips !== undefined) {
    throw new RangeError('Specify either clip or clips, not both')
  }
  const frameSize = options.frameSize ?? model.frameSize ?? 64
  checkFrameSize(frameSize)
  const elevation = options.elevation ?? Math.PI / 6
  if (!Number.isFinite(elevation) || Math.abs(elevation) >= Math.PI / 2) {
    throw new RangeError('Invalid sprite camera elevation')
  }
  if (options.fps !== undefined && !(typeof options.fps === 'number' && Number.isFinite(options.fps) && options.fps > 0)) {
    throw new RangeError('Animated sprite fps must be a positive finite number')
  }
  if (options.span !== undefined && !(typeof options.span === 'number' && Number.isFinite(options.span) && options.span > 0)) {
    throw new RangeError('Invalid sprite camera span')
  }
  if (options.centerY !== undefined && !(typeof options.centerY === 'number' && Number.isFinite(options.centerY))) {
    throw new RangeError('Invalid sprite camera centerY')
  }

  const directions = options.directions ?? spriteDirections
  if (!Array.isArray(directions) || !directions.length) {
    throw new RangeError('Expected at least one sprite direction')
  }
  const seenDirs = new Set<string>()
  const dirAngles: number[] = []
  for (const dir of directions) {
    const idx = directionIndex.get(dir)
    if (idx === undefined || seenDirs.has(dir)) throw new RangeError('Invalid or duplicate sprite direction: ' + String(dir))
    seenDirs.add(dir)
    dirAngles.push(idx * 2 * Math.PI / spriteDirections.length)
  }

  const { rig, clips: animClips } = rigFromArtModel(model, options.palette)
  let targetNames: string[]
  if (options.clip !== undefined) {
    if (!Object.hasOwn(animClips, options.clip)) throw new RangeError('Unknown animation clip: ' + options.clip)
    targetNames = [options.clip]
  } else if (options.clips !== undefined) {
    if (!Array.isArray(options.clips) || !options.clips.length) throw new RangeError('Expected at least one animation clip')
    const seenClips = new Set<string>()
    targetNames = []
    for (const cName of options.clips) {
      if (!Object.hasOwn(animClips, cName) || seenClips.has(cName)) {
        throw new RangeError('Unknown or duplicate animation clip: ' + String(cName))
      }
      seenClips.add(cName)
      targetNames.push(cName)
    }
  } else {
    const existing = Object.keys(animClips)
    targetNames = existing.length ? existing : ['rest']
  }

  const alignFeet = options.alignFeet ?? true
  const centerY = options.centerY ?? model.centerY
  const cosEl = Math.cos(elevation)
  const sinEl = Math.sin(elevation)
  const padding = Math.min(2, frameSize * .1)
  const innerFraction = Math.max(0.2, 1 - 2 * padding / frameSize)

  type SampledFrame = { poses: ReturnType<typeof sampleClip>; liftY: number }
  const plan: { name: string; startColumn: number; frameCount: number; frameMs: number; samples: SampledFrame[] }[] = []
  let totalColumns = 0
  let maxHalfSpan = 0

  for (const clipName of targetNames) {
    const hasClip = Object.hasOwn(animClips, clipName)
    const animClip: AnimationClip = hasClip ? animClips[clipName] : { duration: 1, loop: true, tracks: {} }
    let frameCount: number
    if (typeof options.frames === 'number') {
      frameCount = options.frames
    } else if (options.frames && typeof options.frames === 'object' && Object.hasOwn(options.frames, clipName)) {
      frameCount = options.frames[clipName]
    } else if (options.fps !== undefined) {
      frameCount = Math.max(1, Math.round(animClip.duration * options.fps))
    } else {
      frameCount = hasClip ? 4 : 1
    }
    if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 256) {
      throw new RangeError('Animated sprite frame count must be an integer in 1–256 for ' + clipName)
    }
    const frameMs = options.fps !== undefined
      ? Math.max(1, Math.round(1000 / options.fps))
      : Math.max(1, Math.round((animClip.duration * 1000) / frameCount))

    const samples: SampledFrame[] = []
    for (let f = 0; f < frameCount; f++) {
      const t = animClip.loop === false
        ? (frameCount > 1 ? (f / (frameCount - 1)) * animClip.duration : 0)
        : (f / frameCount) * animClip.duration
      const poses = sampleClip(animClip, t)
      const b = artPoseBounds(model, poses)
      const liftY = alignFeet ? -b.min[1] : 0
      if (options.span === undefined) {
        const xs = [b.min[0], b.max[0]]
        const ys = [b.min[1] + liftY, b.max[1] + liftY]
        const zs = [b.min[2], b.max[2]]
        for (const px of xs) for (const py of ys) for (const pz of zs) {
          const cyTerm = cosEl * (py - centerY)
          for (let d = 0; d < dirAngles.length; d++) {
            const sin = Math.sin(dirAngles[d]), cos = Math.cos(dirAngles[d])
            const u = Math.abs(cos * px - sin * pz)
            const v = Math.abs(cyTerm - sinEl * (sin * px + cos * pz))
            if (u > maxHalfSpan) maxHalfSpan = u
            if (v > maxHalfSpan) maxHalfSpan = v
          }
        }
      }
      samples.push({ poses, liftY })
    }
    plan.push({ name: clipName, startColumn: totalColumns, frameCount, frameMs, samples })
    totalColumns += frameCount
  }

  const span = options.span ?? Math.max(model.span, (2 * maxHalfSpan) / innerFraction)
  const width = totalColumns * frameSize
  const height = directions.length * frameSize
  const pixels = new Uint8ClampedArray(width * height * 4)
  const allEightCanonical = directions.length === spriteDirections.length &&
    directions.every((d, i) => d === spriteDirections[i])

  let cameras: ReturnType<typeof multiply>[] | null = null
  if (!allEightCanonical) {
    const projection = orthographic(span, span, span / 100, span * 8)
    const radius = span * 4
    const horizontal = radius * cosEl
    cameras = dirAngles.map(angle =>
      multiply(projection, view([horizontal * Math.sin(angle), centerY + radius * sinEl, horizontal * Math.cos(angle)], [0, centerY, 0]))
    )
  }

  const pool = createMeshPool(Math.max(16, model.parts.length))
  const rowBytes = frameSize * 4
  const manifestClips: Record<string, SpriteClip> = {}

  for (const entry of plan) {
    for (let row = 0; row < directions.length; row++) {
      manifestClips[entry.name + '-' + directions[row]] = {
        column: entry.startColumn,
        row,
        frames: entry.frameCount,
        frameMs: entry.frameMs
      }
    }
    for (let f = 0; f < entry.samples.length; f++) {
      const col = entry.startColumn + f
      const { poses, liftY } = entry.samples[f]
      pool.clear()
      renderRig(rig, { position: [0, liftY, 0] }, poses, pool)
      if (cameras === null) {
        const strip = bakeSpritePixels(pool.batches, {
          span, center: [0, centerY, 0], frameSize, elevation, lighting: options.lighting, outline: options.outline
        })
        const stripWidth = strip.width
        for (let row = 0; row < directions.length; row++) {
          for (let y = 0; y < frameSize; y++) {
            const srcStart = (y * stripWidth + row * frameSize) * 4
            const dstStart = ((row * frameSize + y) * width + col * frameSize) * 4
            pixels.set(strip.pixels.subarray(srcStart, srcStart + rowBytes), dstStart)
          }
        }
      } else {
        for (let row = 0; row < directions.length; row++) {
          const tile = renderMeshPixels(cameras[row], pool.batches, frameSize, options.lighting)
          if (options.outline) applySpriteOutline(tile.pixels, tile.width, tile.height, frameSize, options.outline)
          for (let y = 0; y < frameSize; y++) {
            const srcStart = y * rowBytes
            const dstStart = ((row * frameSize + y) * width + col * frameSize) * 4
            pixels.set(tile.pixels.subarray(srcStart, srcStart + rowBytes), dstStart)
          }
        }
      }
    }
  }

  return {
    width,
    height,
    pixels,
    manifest: {
      src: options.src ?? 'animated-sprite.png',
      frameWidth: frameSize,
      frameHeight: frameSize,
      clips: manifestClips
    }
  }
}

/** Bake a rigged model's animation clip(s) across directions into a browser HTMLCanvasElement sprite sheet. */
export function bakeAnimatedSpriteDirections(source: ArtModel | ArtRecipe, options: AnimatedSpriteOptions = {}): BakedSpriteSheet {
  const { width, height, pixels, manifest } = bakeAnimatedSpritePixels(source, options)
  const image = document.createElement('canvas')
  image.width = width
  image.height = height
  const context = image.getContext('2d')
  if (!context) throw new Error('Could not create the animated sprite sheet')
  context.putImageData(new ImageData(pixels, width, height), 0, 0)
  return { image, manifest }
}

const uncoloredMeshCache = new WeakMap<Mesh, Mesh>()
function meshWithoutVertexColors(source: Mesh): Mesh {
  if (!source.colors) return source
  let cached = uncoloredMeshCache.get(source)
  if (!cached) {
    cached = { data: source.data, vertexCount: source.vertexCount, radius: source.radius }
    uncoloredMeshCache.set(source, cached)
  }
  return cached
}

/** A palette and named model recipes shared by mesh batches, rigs and cached, in-memory sprite sheets. */
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
  const overrides = new Map<string, typeof colors>()
  for (const [name, recipe] of Object.entries(catalog)) {
    checkArtModel(recipe, name, rgb)
    if (recipe.palette) overrides.set(name, colorsFor({ ...rgb, ...recipe.palette }))
  }
  const sprites = new Map<Name, ReturnType<typeof bakeSpriteDirections>>()
  const rigs = new Map<Name, ArtRig>()
  const kitSourceSite = isTestingActive() ? captureSourceSite() : undefined

  function recipeFromModel(name: string): ArtRecipe | undefined {
    if (!Object.hasOwn(catalog, name)) return undefined
    const m = catalog[name]
    let isV2 = Boolean(m.joints?.length || m.clips)
    const usedNames = new Set<string>()
    const recipeParts = []
    for (let i = 0; i < m.parts.length; i++) {
      const p = m.parts[i]
      const shape = shapeNames.get(p.mesh)
      if (!shape) return undefined
      if (p.alpha !== undefined || p.blend !== undefined || p.shade !== undefined || p.joint !== undefined || !Object.hasOwn(artPalette, p.tone)) {
        isV2 = true
      }
      const baseName = p.name?.trim() || ('part-' + (i + 1))
      let uniqueName = baseName
      let suffix = 2
      while (usedNames.has(uniqueName)) uniqueName = `${baseName}-${suffix++}`
      usedNames.add(uniqueName)
      recipeParts.push({
        name: uniqueName,
        shape,
        position: [p.position[0], p.position[1], p.position[2]] as const,
        scale: [p.scale[0], p.scale[1], p.scale[2]] as const,
        tone: p.tone,
        ...(p.pitch ? { pitch: p.pitch } : {}),
        ...(p.yaw ? { yaw: p.yaw } : {}),
        ...(p.roll ? { roll: p.roll } : {}),
        ...(p.unlit ? { unlit: p.unlit } : {}),
        ...(p.alpha !== undefined ? { alpha: p.alpha } : {}),
        ...(p.blend !== undefined ? { blend: p.blend } : {}),
        ...(p.shade !== undefined ? { shade: p.shade } : {}),
        ...(p.joint !== undefined ? { joint: p.joint } : {})
      })
    }
    const mergedPalette: Record<string, string | undefined> = { ...rgb, ...m.palette }
    const usedPalette = Object.fromEntries(recipeParts.map(p => [p.tone, mergedPalette[p.tone] ?? artPalette.accent]))
    return {
      format: 'ridgetop-art',
      version: isV2 ? 2 : 1,
      name,
      span: m.span,
      centerY: m.centerY,
      frameSize: m.frameSize ?? frameSize,
      palette: usedPalette,
      parts: recipeParts,
      ...(m.joints ? { joints: m.joints.map(j => ({ id: j.id, ...(j.parent !== undefined ? { parent: j.parent } : {}), ...(j.pivot ? { pivot: [j.pivot[0], j.pivot[1], j.pivot[2]] as const } : {}) })) } : {}),
      ...(m.clips ? { clips: Object.fromEntries(Object.entries(m.clips).map(([k, v]) => [k, structuredClone(v)])) } : {}),
      ...(m.timings ? { timings: { ...m.timings } } : {})
    }
  }

  if (isTestingActive()) {
    registerArtKitRuntime({
      palette: { ...rgb },
      models: catalog,
      recipeFor: recipeFromModel,
      sourceSite: kitSourceSite
    })
  }

  function model(name: Name): ArtModel {
    if (!Object.hasOwn(catalog, name)) throw new RangeError('Unknown art model: ' + name)
    return catalog[name]
  }

  function rig(name: Name): ArtRig {
    let cached = rigs.get(name)
    if (!cached) {
      cached = rigFromArtModel(model(name), rgb)
      rigs.set(name, cached)
    }
    return cached
  }

  function group() {
    const batches: InstanceBatch[] = []
    const readonlyBatches: readonly InstanceBatch[] = batches
    const byMesh: Record<BlendMode, Map<Mesh, InstanceBatch>> = {
      opaque: new Map(), alpha: new Map(), additive: new Map()
    }
    return {
      batches: readonlyBatches,
      clear() { for (const batch of batches) batch.clear() },
      add(name: Name, [x, y, z]: Vec3, { yaw = 0, scale = 1, partTint, id }:
        { yaw?: number; scale?: number; partTint?: (part: ArtPart, index: number) => Color; id?: string } = {}) {
        if (!(scale > 0 && [x, y, z, scale, yaw].every(Number.isFinite))) throw new RangeError('Invalid art transform')
        const cos = Math.cos(yaw), sin = Math.sin(yaw)
        const tones = overrides.get(name) ?? colors
        const testing = isTestingActive()
        const groupId = testing ? nextTestingGroupId(String(name)) : undefined
        const instanceId = id ?? groupId
        let index = 0
        for (const piece of model(name).parts) {
          const blend = partTint ? 'opaque' : resolvePartBlend(piece)
          const pieceMesh = partTint ? meshWithoutVertexColors(piece.mesh) : piece.mesh
          const bucket = byMesh[blend]
          let batch = bucket.get(pieceMesh)
          if (!batch) {
            batch = instances(pieceMesh, {
              blend,
              ...(testing ? { meta: { kind: 'model', asset: String(name), sourceSite: kitSourceSite } } : {})
            })
            bucket.set(pieceMesh, batch)
            batches.push(batch)
          }
          const [px, py, pz] = piece.position
          const [sx, sy, sz] = piece.scale
          const facing = yaw + (piece.yaw ?? 0)
          const rotation = piece.pitch || piece.roll ? quaternionFromEuler(piece.pitch, facing, piece.roll) : facing
          const baseColor = tones.get(piece.tone)
          const tint = partTint?.(piece, index) ?? (baseColor ? resolvePartColor(baseColor, piece) : undefined)
          batch.add(
            [x + (px * cos + pz * sin) * scale, y + py * scale, z + (pz * cos - px * sin) * scale],
            [sx * scale, sy * scale, sz * scale],
            rotation,
            tint,
            piece.unlit,
            testing ? {
              kind: 'model',
              asset: String(name),
              part: piece.name ?? ('part-' + (index + 1)),
              instanceId,
              groupId,
              sourceFile: kitSourceSite
            } : undefined
          )
          index++
        }
      }
    }
  }

  function animatedSpritePixels(name: Name, options: AnimatedSpriteOptions = {}): BakedSpritePixels {
    const entry = model(name)
    return bakeAnimatedSpritePixels(entry, {
      frameSize: entry.frameSize ?? frameSize,
      palette: rgb,
      src: encodeURIComponent(name) + '-animated-sheet.png',
      ...options
    })
  }

  function animatedSprite(name: Name, options: AnimatedSpriteOptions = {}): BakedSpriteSheet {
    const entry = model(name)
    return bakeAnimatedSpriteDirections(entry, {
      frameSize: entry.frameSize ?? frameSize,
      palette: rgb,
      src: encodeURIComponent(name) + '-animated-sheet.png',
      ...options
    })
  }

  function sprite(name: Name, options?: AnimatedSpriteOptions): BakedSpriteSheet {
    if (options !== undefined) return animatedSprite(name, options)
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

  return { model, group, rig, sprite, animatedSprite, animatedSpritePixels, palette: { ...rgb } }
}
