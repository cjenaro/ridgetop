import { evaluateJointFK, multiplyQuat, sortJointHierarchy } from './animation.ts'
import type { Easing } from './animation.ts'
import { archMesh, box, chamferedPrism, cylinder, gableMesh, octahedron, quaternionFromEuler, revolvedMesh, rotateVec3, rotationMatrix, tubeMesh, wedgeMesh } from './geometry.ts'
import { spriteDirections } from './low-poly.ts'
import { registerKnownShapes } from './testing-runtime.ts'
import type { BlendMode, Mesh, Quaternion, Vec3 } from './types.ts'

export const artPalette = {
  ground: '#92b878', leaf: '#43836c', wood: '#96694e', stone: '#889ba7',
  ink: '#344556', accent: '#eaa555', light: '#ffe4ad', glow: '#82ebd0'
}
export const artShapes = {
  box, prism: chamferedPrism(.16), cylinder: cylinder(7), cone: cylinder(7, 0), octahedron,
  oval: revolvedMesh([[0,-.5],[.30,-.40],[.47,-.19],[.50,.06],[.43,.29],[.26,.44],[0,.5]]),
  dome: revolvedMesh([[0,-.5],[.44,-.5],[.50,-.38],[.47,-.13],[.38,.14],[.23,.37],[0,.5]]),
  bowl: revolvedMesh([[0,-.5],[.30,-.5],[.42,-.28],[.50,.39],[.48,.5],[.40,.5],[.38,.31],[.28,-.22],[0,-.25]]),
  ring: revolvedMesh([[.36,-.5],[.47,-.5],[.50,-.32],[.50,.32],[.47,.5],[.36,.5],[.33,.30],[.33,-.30],[.36,-.5]]),
  taper: revolvedMesh([[0,-.5],[.5,-.5],[.23,.5],[0,.5]], 8),
  arch: archMesh(),
  wedge: wedgeMesh(),
  gable: gableMesh(),
  teardrop: revolvedMesh([[0,-.5],[.30,-.45],[.48,-.22],[.46,.04],[.34,.26],[.17,.42],[0,.5]], 8)
}
registerKnownShapes(artShapes)
export type BaseArtTone = keyof typeof artPalette
export type ArtTone = BaseArtTone | (string & {})
export type ArtShape = keyof typeof artShapes
type Palette = Record<string, string | undefined>

const shapeNames = new Map<Mesh, ArtShape>()
for (const key of Object.keys(artShapes)) {
  if (isArtShape(key)) shapeNames.set(artShapes[key], key)
}

export interface ArtRecipeJoint {
  id: string
  parent?: string
  /** Rest-pose pivot in model space (same coordinate frame as part positions). */
  pivot?: Vec3
}
export interface ArtRecipeJointPose {
  position?: Vec3
  rotation?: readonly [pitch: number, yaw: number, roll: number]
  scale?: Vec3
}
export interface ArtRecipeClipFrame {
  time: number
  poses: Record<string, ArtRecipeJointPose>
}
export interface ArtRecipeClip {
  duration: number
  loop?: boolean
  easing?: Easing
  frames: ArtRecipeClipFrame[]
}
export interface ArtTubeSpec {
  readonly points: readonly Vec3[]
  readonly radii: number | readonly number[]
  readonly sides: number
}
export interface ArtPart {
  name?: string
  mesh: Mesh
  position: Vec3
  scale: Vec3
  tone: ArtTone
  /** Radians around X, Y and Z. Roll is applied first, then pitch, then yaw. */
  pitch?: number
  yaw?: number
  roll?: number
  unlit?: number
  /** Optional opacity (`0–1`) for translucent or additive parts. Defaults to `1`. */
  alpha?: number
  /** Optional blend mode (`opaque`, `alpha`, or `additive`). Defaults to `alpha` if `alpha < 1`, else `opaque`. */
  blend?: BlendMode
  /** Optional per-part lightness nudge (`-0.5` darker to `+0.5` brighter) to separate adjacent materials cleanly. */
  shade?: number
  /** Optional joint id binding this part to an articulated rig joint. */
  joint?: string
  /** Preserved tube specification when authored from `shape: 'tube'`, enabling lossless recipe round-trips. */
  tube?: ArtTubeSpec
}
export interface ArtModel {
  /** Square camera span and vertical center. Model origins are at ground level. */
  span: number
  centerY: number
  parts: readonly ArtPart[]
  palette?: Palette
  frameSize?: number
  timings?: Record<string, number>
  joints?: readonly ArtRecipeJoint[]
  clips?: Readonly<Record<string, ArtRecipeClip>>
}
export interface ArtRecipePart extends Omit<ArtPart, 'mesh' | 'name' | 'tube'> {
  name: string
  shape: ArtShape | 'tube'
  /** For `shape: 'tube'`, local 3D polyline points swept into one seamless low-poly tube mesh. */
  points?: readonly Vec3[]
  /** For `shape: 'tube'`, constant radius or per-point radius array. */
  radii?: number | readonly number[]
  /** For `shape: 'tube'`, radial segments (`3–24`, default `7`). */
  sides?: number
}
export interface ArtRecipe {
  format: 'ridgetop-art'
  version: 1 | 2
  name: string
  span: number
  centerY: number
  frameSize: number
  palette: Palette
  parts: ArtRecipePart[]
  timings?: Record<string, number>
  joints?: ArtRecipeJoint[]
  clips?: Record<string, ArtRecipeClip>
}
export interface ArtBounds {
  min: [number, number, number]
  max: [number, number, number]
}
export type PlacedArtMesh = Pick<ArtPart, 'mesh' | 'position' | 'scale' | 'pitch' | 'yaw' | 'roll'>

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const VALID_EASINGS = new Set<string>(['linear', 'smooth', 'easeIn', 'easeOut', 'easeInOut', 'backOut', 'step'])
const VALID_TIMING_CLIPS = new Set<string>(['turntable', ...spriteDirections])
const HEX_COLOR_RE = /^#?[\da-f]{6}$/i
const ASSET_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
function isArtShape(value: unknown): value is ArtShape {
  return typeof value === 'string' && Object.hasOwn(artShapes, value)
}
function isArtTone(value: unknown): value is ArtTone {
  return typeof value === 'string' && Object.hasOwn(artPalette, value)
}
function isEasing(value: unknown): value is Easing {
  return typeof value === 'string' && VALID_EASINGS.has(value)
}
function isBlendMode(value: unknown): value is BlendMode {
  return value === 'opaque' || value === 'alpha' || value === 'additive'
}
export function isSafeArtKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim() && !FORBIDDEN_KEYS.has(value)
}

function isVec3(value: unknown, positive = false): value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return false
  for (let i = 0; i < 3; i++) {
    const n = value[i]
    if (typeof n !== 'number' || !Number.isFinite(n) || (positive && n <= 0)) return false
  }
  return true
}
function cloneVec3(v: Vec3): [number, number, number] {
  return [v[0], v[1], v[2]]
}
function isOptionalFinite(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

export function checkArtName(value: unknown, message = 'Use letters, digits, hyphens or underscores for the model filename.'): string {
  if (typeof value !== 'string' || !ASSET_NAME_RE.test(value)) throw new Error(message)
  return value
}

export function checkArtVec3(value: unknown, label: string, positive = false): [number, number, number] {
  if (!isVec3(value, positive)) {
    throw new RangeError('Expected three ' + (positive ? 'positive ' : '') + 'finite dimensions for ' + label)
  }
  return [value[0], value[1], value[2]]
}

export function checkArtPaletteColor(role: string, hex: unknown, standardRoles = false): string {
  if (!isSafeArtKey(role)) throw new RangeError('Invalid palette role ' + role)
  if (standardRoles && !Object.hasOwn(artPalette, role)) throw new RangeError('Unknown palette role ' + role)
  if (typeof hex !== 'string' || !HEX_COLOR_RE.test(hex)) throw new RangeError('Expected a six-digit RGB color for ' + role)
  return hex
}

function parseArtPalette(palette: unknown, standardRoles = false): Palette {
  if (!isPlainRecord(palette)) throw new RangeError('Expected an art palette object')
  const out: Palette = {}
  for (const [role, hex] of Object.entries(palette)) {
    out[role] = checkArtPaletteColor(role, hex, standardRoles)
  }
  return out
}

export function checkArtPalette(palette: Palette, standardRoles = false) {
  parseArtPalette(palette, standardRoles)
}

export function checkFrameSize(size: number) {
  if (!Number.isInteger(size) || size < 1 || size > 1024) throw new RangeError('Frame size must be 1–1024 pixels')
}

function parseArtTimings(raw: unknown, label: string): Record<string, number> {
  if (!isPlainRecord(raw)) throw new RangeError('Invalid direction or frame time in ' + label)
  const out: Record<string, number> = {}
  for (const [clipName, ms] of Object.entries(raw)) {
    if (!isSafeArtKey(clipName) || !VALID_TIMING_CLIPS.has(clipName) || typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 1) {
      throw new RangeError('Invalid direction or frame time in ' + label)
    }
    out[clipName] = ms
  }
  return out
}

export interface CheckedArtPartStyle {
  unlit?: number
  alpha?: number
  blend?: BlendMode
  shade?: number
}

export function checkArtPartStyle(
  style: { unlit?: unknown; alpha?: unknown; blend?: unknown; shade?: unknown },
  label: string
): CheckedArtPartStyle {
  const out: CheckedArtPartStyle = {}
  if (style.unlit !== undefined) {
    if (typeof style.unlit !== 'number' || !Number.isFinite(style.unlit) || style.unlit < 0 || style.unlit > 1) {
      throw new RangeError('Unlit must be in 0–1 for ' + label)
    }
    out.unlit = style.unlit
  }
  if (style.alpha !== undefined) {
    if (typeof style.alpha !== 'number' || !Number.isFinite(style.alpha) || style.alpha < 0 || style.alpha > 1) {
      throw new RangeError('Alpha must be in 0–1 for ' + label)
    }
    out.alpha = style.alpha
  }
  if (style.blend !== undefined) {
    if (!isBlendMode(style.blend)) throw new RangeError('Unknown blend mode for ' + label)
    out.blend = style.blend
  }
  if (style.shade !== undefined) {
    if (typeof style.shade !== 'number' || !Number.isFinite(style.shade) || style.shade < -0.5 || style.shade > 0.5) {
      throw new RangeError('Shade must be in -0.5–0.5 for ' + label)
    }
    out.shade = style.shade
  }
  return out
}

export function parseArtTube(
  points: unknown,
  radii: unknown,
  sides: unknown,
  label: string
): { points: [number, number, number][]; radii: number | number[]; sides: number } {
  if (!Array.isArray(points) || points.length < 2) {
    throw new RangeError('Tube shape requires >= 2 valid XYZ points in ' + label)
  }
  const clonedPoints: [number, number, number][] = []
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    if (!isVec3(pt)) throw new RangeError('Tube shape requires >= 2 valid XYZ points in ' + label)
    clonedPoints.push([pt[0], pt[1], pt[2]])
  }
  let clonedRadii: number | number[]
  if (typeof radii === 'number' && Number.isFinite(radii) && radii > 0) {
    clonedRadii = radii
  } else if (Array.isArray(radii) && radii.length >= 1) {
    const arr: number[] = []
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i]
      if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) {
        throw new RangeError('Tube shape requires positive finite radii in ' + label)
      }
      arr.push(r)
    }
    clonedRadii = arr
  } else {
    throw new RangeError('Tube shape requires positive finite radii in ' + label)
  }
  const resolvedSides = sides === undefined ? 7 : sides
  if (typeof resolvedSides !== 'number' || !Number.isSafeInteger(resolvedSides) || resolvedSides < 3 || resolvedSides > 24) {
    throw new RangeError('Tube sides must be an integer in 3–24 in ' + label)
  }
  return { points: clonedPoints, radii: clonedRadii, sides: resolvedSides }
}

function parseArtJoints(raw: unknown, label: string): { joints: ArtRecipeJoint[]; jointIds: Set<string> } {
  if (!Array.isArray(raw)) throw new RangeError('Expected joints array in ' + label)
  const joints: ArtRecipeJoint[] = []
  const jointIds = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const j = raw[i]
    if (!isPlainRecord(j) || !isSafeArtKey(j.id) || jointIds.has(j.id)) {
      throw new RangeError('Each joint needs a unique valid id in ' + label)
    }
    if (j.pivot !== undefined && !isVec3(j.pivot)) {
      throw new RangeError('Invalid pivot for joint "' + j.id + '" in ' + label)
    }
    if (j.parent !== undefined && !isSafeArtKey(j.parent)) {
      throw new RangeError('Invalid parent joint for "' + j.id + '" in ' + label)
    }
    jointIds.add(j.id)
    const entry: ArtRecipeJoint = { id: j.id }
    if (j.parent !== undefined) entry.parent = j.parent
    if (j.pivot !== undefined) entry.pivot = [j.pivot[0], j.pivot[1], j.pivot[2]]
    joints.push(entry)
  }
  sortJointHierarchy(joints, {
    duplicate: () => new RangeError('Each joint needs a unique valid id in ' + label),
    missingParent: (id, parent) => new RangeError('Unknown parent joint "' + parent + '" for "' + id + '" in ' + label),
    cycle: id => new RangeError('Cyclic joint hierarchy detected at "' + id + '" in ' + label)
  })
  return { joints, jointIds }
}

/** Validate and deep-clone one animation clip against a known set of joint IDs. */
export function parseArtClip(clip: unknown, clipName: string, jointIds: ReadonlySet<string>, label: string): ArtRecipeClip {
  if (!isSafeArtKey(clipName)) throw new RangeError('Invalid animation clip name in ' + label)
  if (!isPlainRecord(clip)) throw new RangeError('Invalid animation clip ' + clipName + ' in ' + label)
  if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0) {
    throw new RangeError('Animation clip ' + clipName + ' must have a positive finite duration in ' + label)
  }
  const duration = clip.duration
  if (clip.loop !== undefined && typeof clip.loop !== 'boolean') {
    throw new RangeError('Animation clip ' + clipName + ' loop must be a boolean in ' + label)
  }
  let easing: Easing | undefined
  if (clip.easing !== undefined) {
    if (!isEasing(clip.easing)) {
      throw new RangeError('Unknown easing in animation clip ' + clipName + ' in ' + label)
    }
    easing = clip.easing
  }
  if (!Array.isArray(clip.frames) || !clip.frames.length) {
    throw new RangeError('Animation clip ' + clipName + ' needs at least one keyframe in ' + label)
  }
  const frames: ArtRecipeClipFrame[] = []
  let prevTime = -Infinity
  for (let i = 0; i < clip.frames.length; i++) {
    const frame = clip.frames[i]
    if (!isPlainRecord(frame) || typeof frame.time !== 'number' || !Number.isFinite(frame.time) ||
        frame.time < 0 || frame.time > duration) {
      throw new RangeError('Invalid keyframe time in clip ' + clipName + ' in ' + label)
    }
    if (frame.time < prevTime) {
      throw new RangeError('Keyframe times must be sorted in clip ' + clipName + ' in ' + label)
    }
    prevTime = frame.time
    if (!isPlainRecord(frame.poses)) {
      throw new RangeError('Expected keyframe poses map in clip ' + clipName + ' in ' + label)
    }
    const poses: Record<string, ArtRecipeJointPose> = {}
    for (const [jointId, rawPose] of Object.entries(frame.poses)) {
      if (!isSafeArtKey(jointId) || !jointIds.has(jointId)) {
        throw new RangeError('Unknown joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
      }
      if (!isPlainRecord(rawPose)) {
        throw new RangeError('Invalid pose for joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
      }
      const pose: ArtRecipeJointPose = {}
      if (rawPose.position !== undefined) {
        if (!isVec3(rawPose.position)) {
          throw new RangeError('Invalid pose position for joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
        }
        pose.position = cloneVec3(rawPose.position)
      }
      if (rawPose.rotation !== undefined) {
        if (!isVec3(rawPose.rotation)) {
          throw new RangeError('Invalid pose rotation for joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
        }
        pose.rotation = cloneVec3(rawPose.rotation)
      }
      if (rawPose.scale !== undefined) {
        if (!isVec3(rawPose.scale, true)) {
          throw new RangeError('Invalid pose scale for joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
        }
        pose.scale = cloneVec3(rawPose.scale)
      }
      poses[jointId] = pose
    }
    frames.push({ time: frame.time, poses })
  }
  return {
    duration,
    ...(clip.loop !== undefined ? { loop: clip.loop } : {}),
    ...(easing !== undefined ? { easing } : {}),
    frames
  }
}

export function checkArtClip(clip: ArtRecipeClip, clipName: string, jointIds: ReadonlySet<string>, label: string) {
  parseArtClip(clip, clipName, jointIds, label)
}

function parseArtClips(raw: unknown, jointIds: ReadonlySet<string>, label: string): Record<string, ArtRecipeClip> {
  if (!isPlainRecord(raw)) throw new RangeError('Expected clips map in ' + label)
  const parsed: Record<string, ArtRecipeClip> = {}
  for (const [clipName, rawClip] of Object.entries(raw)) {
    parsed[clipName] = parseArtClip(rawClip, clipName, jointIds, label)
  }
  return parsed
}

export function checkArtModel(model: ArtModel, name: string, palette: Palette = artPalette) {
  if (!(model?.span > 0 && Number.isFinite(model.span) && Number.isFinite(model.centerY) && Array.isArray(model.parts) && model.parts.length)) {
    throw new RangeError('Expected a camera span, centerY and model parts for ' + name)
  }
  if (model.palette !== undefined) checkArtPalette(model.palette)
  if (model.frameSize !== undefined) checkFrameSize(model.frameSize)
  if (model.timings !== undefined) parseArtTimings(model.timings, name)
  const jointIds = model.joints !== undefined
    ? parseArtJoints(model.joints, name).jointIds
    : new Set<string>()
  for (let i = 0; i < model.parts.length; i++) {
    const p = model.parts[i]
    const partLabel = name + (p?.name ? ' / ' + p.name : '')
    const validMesh = Boolean(p?.mesh && Number.isSafeInteger(p.mesh.vertexCount) && p.mesh.vertexCount > 0 &&
      p.mesh.data && p.mesh.data.length === p.mesh.vertexCount * 6)
    if (!validMesh || !(Object.hasOwn(palette, p.tone) || Object.hasOwn(model.palette ?? {}, p.tone)) ||
        !isVec3(p.position) || !isVec3(p.scale, true) ||
        !isOptionalFinite(p.pitch) || !isOptionalFinite(p.yaw) || !isOptionalFinite(p.roll)) {
      throw new RangeError('Invalid mesh, palette tone or transform in ' + partLabel)
    }
    checkArtPartStyle(p, partLabel)
    if (p.tube !== undefined) {
      if (!isPlainRecord(p.tube)) throw new RangeError('Invalid tube metadata in ' + partLabel)
      parseArtTube(p.tube.points, p.tube.radii, p.tube.sides, partLabel)
    }
    if (p.joint !== undefined && (!isSafeArtKey(p.joint) || !jointIds.has(p.joint))) {
      throw new RangeError('Unknown joint "' + String(p.joint) + '" on part ' + (p.name ?? '') + ' in ' + name)
    }
  }
  if (model.clips !== undefined) parseArtClips(model.clips, jointIds, name)
}

/** Read editable JSON into the same geometry used by live meshes and directional sprites, validating once in a single pass. */
export function modelFromArtRecipe(value: unknown): ArtModel {
  if (!isPlainRecord(value) || value.format !== 'ridgetop-art' || (value.version !== 1 && value.version !== 2)) {
    throw new Error('Expected a Ridgetop art recipe, version 1 or 2.')
  }
  const name = checkArtName(value.name)
  const frameSize = typeof value.frameSize === 'number' ? value.frameSize : NaN
  checkFrameSize(frameSize)
  const palette = parseArtPalette(value.palette)
  if (!Array.isArray(value.parts) || !value.parts.length) {
    throw new Error('A recipe needs at least one named part.')
  }
  const span = typeof value.span === 'number' ? value.span : NaN
  const centerY = typeof value.centerY === 'number' ? value.centerY : NaN
  if (!(span > 0 && Number.isFinite(span) && Number.isFinite(centerY))) {
    throw new RangeError('Expected a camera span, centerY and model parts for ' + name)
  }
  const timings = value.timings !== undefined ? parseArtTimings(value.timings, name) : undefined
  const parsedJoints = value.joints !== undefined ? parseArtJoints(value.joints, name) : undefined
  const jointIds = parsedJoints ? parsedJoints.jointIds : new Set<string>()

  const names = new Set<string>()
  const parts: ArtPart[] = []
  for (let i = 0; i < value.parts.length; i++) {
    const p = value.parts[i]
    if (!isPlainRecord(p) || typeof p.name !== 'string' || !p.name.trim() || names.has(p.name)) {
      throw new Error('Each model part needs a unique name.')
    }
    const partName = p.name
    const partLabel = name + ' / ' + partName
    let resolvedMesh: Mesh
    let tubeSpec: ArtTubeSpec | undefined
    if (p.shape === 'tube') {
      const checked = parseArtTube(p.points, p.radii, p.sides, partName)
      resolvedMesh = tubeMesh(checked.points, checked.radii, checked.sides)
      tubeSpec = checked
    } else {
      if (!isArtShape(p.shape)) throw new Error('Unknown shape in ' + partName)
      resolvedMesh = artShapes[p.shape]
    }
    names.add(partName)
    if (!isSafeArtKey(p.tone) || !(isArtTone(p.tone) || Object.hasOwn(palette, p.tone)) ||
        !isVec3(p.position) || !isVec3(p.scale, true) ||
        !isOptionalFinite(p.pitch) || !isOptionalFinite(p.yaw) || !isOptionalFinite(p.roll)) {
      throw new RangeError('Invalid mesh, palette tone or transform in ' + partLabel)
    }
    const style = checkArtPartStyle(p, partLabel)
    let joint: string | undefined
    if (p.joint !== undefined) {
      if (!isSafeArtKey(p.joint) || !jointIds.has(p.joint)) {
        throw new RangeError('Unknown joint "' + String(p.joint) + '" on part ' + partName + ' in ' + name)
      }
      joint = p.joint
    }
    parts.push({
      name: partName,
      mesh: resolvedMesh,
      position: cloneVec3(p.position),
      scale: cloneVec3(p.scale),
      tone: p.tone,
      pitch: p.pitch,
      yaw: p.yaw,
      roll: p.roll,
      unlit: style.unlit,
      ...(style.alpha !== undefined ? { alpha: style.alpha } : {}),
      ...(style.blend !== undefined ? { blend: style.blend } : {}),
      ...(style.shade !== undefined ? { shade: style.shade } : {}),
      ...(joint !== undefined ? { joint } : {}),
      ...(tubeSpec !== undefined ? { tube: tubeSpec } : {})
    })
  }

  const clips = value.clips !== undefined ? parseArtClips(value.clips, jointIds, name) : undefined
  const model: ArtModel = {
    span,
    centerY,
    frameSize,
    palette,
    parts,
    timings,
    ...(parsedJoints !== undefined ? { joints: parsedJoints.joints } : {}),
    ...(clips !== undefined ? { clips } : {})
  }
  return model
}

/**
 * Serialize any `ArtModel` whose parts use standard `artShapes` or `tube` metadata into an editable
 * v1/v2 `ArtRecipe`. Returns `undefined` if any part uses a custom procedural mesh without recipe metadata.
 */
export function recipeFromArtModel(
  name: string,
  model: ArtModel,
  options: { palette?: Palette; frameSize?: number } = {}
): ArtRecipe | undefined {
  let isV2 = Boolean(model.joints?.length || model.clips)
  const usedNames = new Set<string>()
  const recipeParts: ArtRecipePart[] = []

  for (let i = 0; i < model.parts.length; i++) {
    const p = model.parts[i]
    let shape: ArtShape | 'tube'
    let tubeFields: Pick<ArtRecipePart, 'points' | 'radii' | 'sides'> | undefined
    if (p.tube) {
      shape = 'tube'
      isV2 = true
      tubeFields = {
        points: p.tube.points.map(pt => [pt[0], pt[1], pt[2]] as const),
        radii: typeof p.tube.radii === 'number' ? p.tube.radii : p.tube.radii.slice(),
        sides: p.tube.sides
      }
    } else {
      const known = shapeNames.get(p.mesh)
      if (!known) return undefined
      shape = known
    }
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
      ...tubeFields,
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

  const mergedPalette: Palette = { ...artPalette, ...options.palette, ...model.palette }
  const usedPalette = Object.fromEntries(recipeParts.map(p => [p.tone, mergedPalette[p.tone] ?? artPalette.accent]))
  return {
    format: 'ridgetop-art',
    version: isV2 ? 2 : 1,
    name,
    span: model.span,
    centerY: model.centerY,
    frameSize: model.frameSize ?? options.frameSize ?? 64,
    palette: usedPalette,
    parts: recipeParts,
    ...(model.joints ? {
      joints: model.joints.map(j => ({
        id: j.id,
        ...(j.parent !== undefined ? { parent: j.parent } : {}),
        ...(j.pivot ? { pivot: [j.pivot[0], j.pivot[1], j.pivot[2]] as const } : {})
      }))
    } : {}),
    ...(model.clips ? {
      clips: Object.fromEntries(Object.entries(model.clips).map(([k, v]) => [k, structuredClone(v)]))
    } : {}),
    ...(model.timings ? { timings: { ...model.timings } } : {})
  }
}

const ZERO3: Vec3 = [0, 0, 0]
const ONE3: Vec3 = [1, 1, 1]
const IDENTITY_Q: Quaternion = [0, 0, 0, 1]

/** Topologically sort ArtRecipeJoints and resolve each joint's model-space rest position. */
export function compileArtJoints(joints: readonly ArtRecipeJoint[]) {
  const { order, parentIndex, indexById } = sortJointHierarchy(joints, {
    missingParent: (_id, parent) => new RangeError('Unknown joint parent: ' + parent),
    cycle: id => new RangeError('Cyclic joint parent: ' + id)
  })
  const restPos: Vec3[] = Array.from({ length: joints.length }, () => ZERO3)
  for (let i = 0; i < order.length; i++) {
    const idx = order[i]
    const j = joints[idx]
    const pIdx = parentIndex[idx]
    restPos[idx] = j.pivot ? [j.pivot[0], j.pivot[1], j.pivot[2]] : (pIdx >= 0 ? restPos[pIdx] : ZERO3)
  }
  return { order, parentIndex, restPos, indexById }
}

/** Visit every vertex of a mesh after applying scale, quaternion rotation, and translation. */
export function visitTransformedVertices(
  mesh: Mesh,
  position: Vec3,
  scale: Vec3,
  rotation: Quaternion,
  visit: (x: number, y: number, z: number) => void
) {
  const m = rotationMatrix(rotation)
  const data = mesh.data
  const sx = scale[0], sy = scale[1], sz = scale[2]
  const ox = position[0], oy = position[1], oz = position[2]
  for (let i = 0; i < data.length; i += 6) {
    const vx = data[i] * sx, vy = data[i + 1] * sy, vz = data[i + 2] * sz
    visit(
      ox + m[0] * vx + m[1] * vy + m[2] * vz,
      oy + m[3] * vx + m[4] * vy + m[5] * vz,
      oz + m[6] * vx + m[7] * vy + m[8] * vz
    )
  }
}

function expandBounds(bounds: ArtBounds, x: number, y: number, z: number) {
  if (x < bounds.min[0]) bounds.min[0] = x
  if (x > bounds.max[0]) bounds.max[0] = x
  if (y < bounds.min[1]) bounds.min[1] = y
  if (y > bounds.max[1]) bounds.max[1] = y
  if (z < bounds.min[2]) bounds.min[2] = z
  if (z > bounds.max[2]) bounds.max[2] = z
}

/** Exact axis-aligned bounds after the authored scale and rotation. */
export function artPartBounds(part: PlacedArtMesh): ArtBounds {
  const bounds: ArtBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  visitTransformedVertices(
    part.mesh,
    part.position,
    part.scale,
    quaternionFromEuler(part.pitch, part.yaw, part.roll),
    (x, y, z) => expandBounds(bounds, x, y, z)
  )
  return bounds
}

/** Exact axis-aligned bounds of a model evaluated under the given joint poses (matching renderRig FK). */
export function artPoseBounds(
  model: ArtModel,
  poses: Readonly<Record<string, ArtRecipeJointPose | undefined>> = {}
): ArtBounds {
  const bounds: ArtBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  const joints = model.joints ?? []
  const { order, parentIndex, restPos, indexById } = compileArtJoints(joints)
  const { worldPos, worldRot, worldScale } = evaluateJointFK(
    joints,
    order,
    parentIndex,
    poses,
    ZERO3,
    IDENTITY_Q,
    ONE3,
    (idx, pIdx) => {
      const rp = restPos[idx]
      const prp = pIdx >= 0 ? restPos[pIdx] : ZERO3
      return [rp[0] - prp[0], rp[1] - prp[1], rp[2] - prp[2]]
    }
  )

  const record = (wx: number, wy: number, wz: number) => expandBounds(bounds, wx, wy, wz)
  for (let i = 0; i < model.parts.length; i++) {
    const part = model.parts[i]
    const jIdx = part.joint !== undefined ? indexById.get(part.joint) : undefined
    let finalPos: Vec3
    let finalScale: Vec3
    let finalRot: Quaternion
    if (jIdx !== undefined) {
      const rp = restPos[jIdx]
      const jPos = worldPos[jIdx], jRot = worldRot[jIdx], jScl = worldScale[jIdx]
      const lp: Vec3 = [
        (part.position[0] - rp[0]) * jScl[0],
        (part.position[1] - rp[1]) * jScl[1],
        (part.position[2] - rp[2]) * jScl[2]
      ]
      const rotOff = rotateVec3(jRot, lp)
      finalPos = [jPos[0] + rotOff[0], jPos[1] + rotOff[1], jPos[2] + rotOff[2]]
      finalScale = [
        Math.max(1e-4, part.scale[0] * jScl[0]),
        Math.max(1e-4, part.scale[1] * jScl[1]),
        Math.max(1e-4, part.scale[2] * jScl[2])
      ]
      finalRot = (part.pitch || part.yaw || part.roll)
        ? multiplyQuat(jRot, quaternionFromEuler(part.pitch, part.yaw, part.roll))
        : jRot
    } else {
      finalPos = part.position
      finalScale = part.scale
      finalRot = quaternionFromEuler(part.pitch, part.yaw, part.roll)
    }
    visitTransformedVertices(part.mesh, finalPos, finalScale, finalRot, record)
  }
  return bounds
}

export const SPRITE_ELEVATION = Math.PI / 6
export const SPRITE_DIRECTION_ANGLES: readonly number[] = spriteDirections.map(
  (_, i) => (i * 2 * Math.PI) / spriteDirections.length
)

export interface OrthoFrameAccumulator {
  addPoint(px: number, py: number, pz: number): void
  addBounds(bounds: ArtBounds, offsetY?: number): void
  /** Compute centered `{ centerY, span }` covering all added points across the configured directions. */
  fit(frameSize: number): { centerY: number; span: number }
  /** Compute the minimum square span around the fixed `centerY` covering all added points. */
  spanAroundCenter(frameSize: number): number
}

/** Accumulate 3D points or AABBs across orthographic sprite camera angles to compute tight gutter-padded framing. */
export function createOrthoFrameAccumulator(
  options: { elevation?: number; angles?: readonly number[]; centerY?: number } = {}
): OrthoFrameAccumulator {
  const elevation = options.elevation ?? SPRITE_ELEVATION
  const cosEl = Math.cos(elevation)
  const sinEl = Math.sin(elevation)
  const refY = options.centerY ?? 0
  const rawAngles = options.angles ?? SPRITE_DIRECTION_ANGLES
  const trig = rawAngles.map(a => [Math.sin(a), Math.cos(a)] as const)
  let halfWidth = 0
  let low = Infinity
  let high = -Infinity
  let maxHalfSpan = 0

  function innerFraction(frameSize: number): number {
    const padding = Math.min(2, frameSize * 0.1)
    return Math.max(0.2, 1 - (2 * padding) / frameSize)
  }

  function addPoint(px: number, py: number, pz: number) {
    const cyTerm = cosEl * (py - refY)
    for (let d = 0; d < trig.length; d++) {
      const sin = trig[d][0]
      const cos = trig[d][1]
      const u = Math.abs(cos * px - sin * pz)
      if (u > halfWidth) halfWidth = u
      if (u > maxHalfSpan) maxHalfSpan = u
      const v = cyTerm - sinEl * (sin * px + cos * pz)
      if (v < low) low = v
      if (v > high) high = v
      const av = Math.abs(v)
      if (av > maxHalfSpan) maxHalfSpan = av
    }
  }

  function addBounds(bounds: ArtBounds, offsetY = 0) {
    const xs = [bounds.min[0], bounds.max[0]]
    const ys = [bounds.min[1] + offsetY, bounds.max[1] + offsetY]
    const zs = [bounds.min[2], bounds.max[2]]
    for (let ix = 0; ix < 2; ix++) {
      for (let iy = 0; iy < 2; iy++) {
        for (let iz = 0; iz < 2; iz++) {
          addPoint(xs[ix], ys[iy], zs[iz])
        }
      }
    }
  }

  return {
    addPoint,
    addBounds,
    fit(frameSize: number) {
      const centerY = refY + (low + high) / (2 * cosEl)
      const span = Math.max(2 * halfWidth, high - low) / innerFraction(frameSize)
      return { centerY, span }
    },
    spanAroundCenter(frameSize: number) {
      return (2 * maxHalfSpan) / innerFraction(frameSize)
    }
  }
}
