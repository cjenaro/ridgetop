import { multiplyQuat } from './animation.ts'
import type { Easing } from './animation.ts'
import { archMesh, box, chamferedPrism, cylinder, octahedron, quaternionFromEuler, revolvedMesh, rotateVec3, rotationMatrix } from './geometry.ts'
import { spriteDirections } from './low-poly.ts'
import type { Mesh, Quaternion, Vec3 } from './types.ts'

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
  arch: archMesh()
}
export type ArtTone = keyof typeof artPalette
export type ArtShape = keyof typeof artShapes
type Palette = Partial<Record<ArtTone, string>>

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
  /** Optional joint id binding this part to an articulated rig joint. */
  joint?: string
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
export interface ArtRecipePart extends Omit<ArtPart, 'mesh' | 'name'> {
  name: string
  shape: ArtShape
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

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const VALID_EASINGS = new Set<string>(['linear', 'smooth', 'easeOut', 'easeInOut'])
const clips = new Set<string>(['turntable', ...spriteDirections])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
export function isSafeArtKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim() && !FORBIDDEN_KEYS.has(value)
}

export function checkArtPalette(palette: Palette, standardRoles = false) {
  if (!isPlainRecord(palette)) throw new RangeError('Expected an art palette object')
  for (const [role, hex] of Object.entries(palette)) {
    if (!isSafeArtKey(role)) throw new RangeError('Invalid palette role ' + role)
    if (standardRoles && !Object.hasOwn(artPalette, role)) throw new RangeError('Unknown palette role ' + role)
    if (typeof hex !== 'string' || !/^#?[\da-f]{6}$/i.test(hex)) throw new RangeError('Expected a six-digit RGB color for ' + role)
  }
}
export function checkFrameSize(size: number) {
  if (!Number.isInteger(size) || size < 1 || size > 1024) throw new RangeError('Frame size must be 1–1024 pixels')
}

function isVec3(value: unknown, positive = false): value is Vec3 {
  if (!Array.isArray(value) || value.length !== 3) return false
  for (let i = 0; i < 3; i++) {
    const n = value[i]
    if (typeof n !== 'number' || !Number.isFinite(n) || (positive && n <= 0)) return false
  }
  return true
}
function isOptionalFinite(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

export function checkArtClip(clip: ArtRecipeClip, clipName: string, jointIds: ReadonlySet<string>, label: string) {
  if (!isSafeArtKey(clipName)) throw new RangeError('Invalid animation clip name in ' + label)
  if (!isPlainRecord(clip)) throw new RangeError('Invalid animation clip ' + clipName + ' in ' + label)
  if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0) {
    throw new RangeError('Animation clip ' + clipName + ' must have a positive finite duration in ' + label)
  }
  if (clip.loop !== undefined && typeof clip.loop !== 'boolean') {
    throw new RangeError('Animation clip ' + clipName + ' loop must be a boolean in ' + label)
  }
  if (clip.easing !== undefined && (typeof clip.easing !== 'string' || !VALID_EASINGS.has(clip.easing))) {
    throw new RangeError('Unknown easing in animation clip ' + clipName + ' in ' + label)
  }
  if (!Array.isArray(clip.frames) || !clip.frames.length) {
    throw new RangeError('Animation clip ' + clipName + ' needs at least one keyframe in ' + label)
  }
  let prevTime = -Infinity
  for (let i = 0; i < clip.frames.length; i++) {
    const frame = clip.frames[i]
    if (!isPlainRecord(frame) || typeof frame.time !== 'number' || !Number.isFinite(frame.time) ||
        frame.time < 0 || frame.time > clip.duration) {
      throw new RangeError('Invalid keyframe time in clip ' + clipName + ' in ' + label)
    }
    if (frame.time < prevTime) {
      throw new RangeError('Keyframe times must be sorted in clip ' + clipName + ' in ' + label)
    }
    prevTime = frame.time
    if (!isPlainRecord(frame.poses)) {
      throw new RangeError('Expected keyframe poses map in clip ' + clipName + ' in ' + label)
    }
    for (const [jointId, pose] of Object.entries(frame.poses)) {
      if (!isSafeArtKey(jointId) || !jointIds.has(jointId)) {
        throw new RangeError('Unknown joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
      }
      if (!isPlainRecord(pose)) {
        throw new RangeError('Invalid pose for joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
      }
      if (pose.position !== undefined && !isVec3(pose.position)) {
        throw new RangeError('Invalid pose position for joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
      }
      if (pose.rotation !== undefined && !isVec3(pose.rotation)) {
        throw new RangeError('Invalid pose rotation for joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
      }
      if (pose.scale !== undefined && !isVec3(pose.scale, true)) {
        throw new RangeError('Invalid pose scale for joint "' + jointId + '" in clip ' + clipName + ' in ' + label)
      }
    }
  }
}

export function checkArtModel(model: ArtModel, name: string, palette: Palette = artPalette) {
  if (!(model?.span > 0 && Number.isFinite(model.span) && Number.isFinite(model.centerY) && Array.isArray(model.parts) && model.parts.length)) {
    throw new RangeError('Expected a camera span, centerY and model parts for ' + name)
  }
  if (model.palette !== undefined) checkArtPalette(model.palette)
  if (model.frameSize !== undefined) checkFrameSize(model.frameSize)
  if (model.timings !== undefined && (!isPlainRecord(model.timings) || Object.entries(model.timings).some(([clip, ms]) =>
    !isSafeArtKey(clip) || !clips.has(clip) || !Number.isSafeInteger(ms) || ms < 1))) {
    throw new RangeError('Invalid direction or frame time in ' + name)
  }
  const jointIds = new Set<string>()
  const parentMap = new Map<string, string>()
  if (model.joints !== undefined) {
    if (!Array.isArray(model.joints)) throw new RangeError('Expected joints array in ' + name)
    for (const joint of model.joints) {
      if (!isPlainRecord(joint)) throw new RangeError('Each joint needs a unique valid id in ' + name)
      const id = joint.id
      const parent = joint.parent
      const pivot = joint.pivot
      if (!isSafeArtKey(id) || jointIds.has(id)) {
        throw new RangeError('Each joint needs a unique valid id in ' + name)
      }
      if (pivot !== undefined && !isVec3(pivot)) {
        throw new RangeError('Invalid pivot for joint "' + id + '" in ' + name)
      }
      jointIds.add(id)
      if (parent !== undefined) {
        if (!isSafeArtKey(parent)) throw new RangeError('Invalid parent joint for "' + id + '" in ' + name)
        parentMap.set(id, parent)
      }
    }
    for (const [id, parent] of parentMap) {
      if (!jointIds.has(parent)) throw new RangeError('Unknown parent joint "' + parent + '" for "' + id + '" in ' + name)
    }
    const state = new Map<string, number>()
    const visit = (id: string) => {
      const s = state.get(id)
      if (s === 2) return
      if (s === 1) throw new RangeError('Cyclic joint hierarchy detected at "' + id + '" in ' + name)
      state.set(id, 1)
      const parent = parentMap.get(id)
      if (parent !== undefined) visit(parent)
      state.set(id, 2)
    }
    for (const id of jointIds) visit(id)
  }
  for (const p of model.parts) {
    const validMesh = Boolean(p?.mesh && Number.isSafeInteger(p.mesh.vertexCount) && p.mesh.vertexCount > 0 &&
      p.mesh.data && p.mesh.data.length === p.mesh.vertexCount * 6)
    if (!validMesh || !(Object.hasOwn(palette, p.tone) || Object.hasOwn(model.palette ?? {}, p.tone)) ||
        !isVec3(p.position) || !isVec3(p.scale, true) ||
        !isOptionalFinite(p.pitch) || !isOptionalFinite(p.yaw) || !isOptionalFinite(p.roll) ||
        !isOptionalFinite(p.unlit) || (p.unlit !== undefined && (p.unlit < 0 || p.unlit > 1))) {
      throw new RangeError('Invalid mesh, palette tone or transform in ' + name + (p?.name ? ' / ' + p.name : ''))
    }
    if (p.joint !== undefined && (!isSafeArtKey(p.joint) || !jointIds.has(p.joint))) {
      throw new RangeError('Unknown joint "' + String(p.joint) + '" on part ' + (p.name ?? '') + ' in ' + name)
    }
  }
  if (model.clips !== undefined) {
    if (!isPlainRecord(model.clips)) throw new RangeError('Expected clips map in ' + name)
    for (const [clipName, clip] of Object.entries(model.clips)) {
      checkArtClip(clip as ArtRecipeClip, clipName, jointIds, name)
    }
  }
}

/** Reject prototype-polluted records before structuredClone strips non-standard prototypes. */
function checkRawRecipePrototypes(input: unknown) {
  if (!isPlainRecord(input)) throw new Error('Expected a Ridgetop art recipe, version 1 or 2.')
  if (input.palette !== undefined && !isPlainRecord(input.palette)) throw new RangeError('Expected an art palette object')
  if (input.timings !== undefined && !isPlainRecord(input.timings)) throw new RangeError('Invalid direction or frame time')
  if (input.joints !== undefined) {
    if (!Array.isArray(input.joints)) throw new RangeError('Expected joints array')
    for (const j of input.joints) if (!isPlainRecord(j)) throw new RangeError('Invalid joint entry')
  }
  if (input.clips !== undefined) {
    if (!isPlainRecord(input.clips)) throw new RangeError('Expected clips map')
    for (const [clipName, clip] of Object.entries(input.clips)) {
      if (!isSafeArtKey(clipName) || !isPlainRecord(clip)) throw new RangeError('Invalid animation clip ' + clipName)
      if (Array.isArray(clip.frames)) {
        for (const frame of clip.frames) {
          if (!isPlainRecord(frame) || !isPlainRecord(frame.poses)) throw new RangeError('Invalid keyframe in clip ' + clipName)
          for (const [jointId, pose] of Object.entries(frame.poses)) {
            if (!isSafeArtKey(jointId) || !isPlainRecord(pose)) throw new RangeError('Invalid pose in clip ' + clipName)
          }
        }
      }
    }
  }
}

/** Read editable JSON into the same geometry used by live meshes and directional sprites. */
export function modelFromArtRecipe(value: unknown): ArtModel {
  checkRawRecipePrototypes(value)
  const input = value as ArtRecipe
  if (input?.format !== 'ridgetop-art' || (input.version !== 1 && input.version !== 2)) {
    throw new Error('Expected a Ridgetop art recipe, version 1 or 2.')
  }
  // Keep the live model and its cached sprites in sync if a caller continues editing the source.
  const source = structuredClone(input)
  if (typeof source.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(source.name)) throw new Error('Use letters, digits, hyphens or underscores for the model filename.')
  checkFrameSize(source.frameSize)
  checkArtPalette(source.palette, true)
  if (!Array.isArray(source.parts) || !source.parts.length) throw new Error('A recipe needs at least one named part.')
  const names = new Set<string>()
  const parts: ArtPart[] = source.parts.map(p => {
    if (typeof p?.name !== 'string' || !p.name.trim() || names.has(p.name)) throw new Error('Each model part needs a unique name.')
    if (!Object.hasOwn(artShapes, p.shape)) throw new Error('Unknown shape in ' + p.name)
    names.add(p.name)
    const part: ArtPart = {
      name: p.name, mesh: artShapes[p.shape], position: p.position, scale: p.scale, tone: p.tone,
      pitch: p.pitch, yaw: p.yaw, roll: p.roll, unlit: p.unlit
    }
    if (p.joint !== undefined) part.joint = p.joint
    return part
  })
  const model: ArtModel = {
    span: source.span, centerY: source.centerY, frameSize: source.frameSize, palette: source.palette, parts, timings: source.timings
  }
  if (source.joints !== undefined) model.joints = source.joints
  if (source.clips !== undefined) model.clips = source.clips
  checkArtModel(model, source.name)
  return model
}

const ZERO3: Vec3 = [0, 0, 0]
const ONE3: Vec3 = [1, 1, 1]
const IDENTITY_Q: Quaternion = [0, 0, 0, 1]

/** Topologically sort ArtRecipeJoints and resolve each joint's model-space rest position. */
export function compileArtJoints(joints: readonly ArtRecipeJoint[]) {
  const indexById = new Map<string, number>()
  for (let i = 0; i < joints.length; i++) indexById.set(joints[i].id, i)
  const parentIndex = joints.map(j => (j.parent !== undefined ? indexById.get(j.parent)! : -1))
  const visited = new Uint8Array(joints.length)
  const order: number[] = []
  function visit(i: number) {
    if (visited[i] === 2) return
    visited[i] = 1
    if (parentIndex[i] >= 0) visit(parentIndex[i])
    visited[i] = 2
    order.push(i)
  }
  for (let i = 0; i < joints.length; i++) visit(i)
  const restPos: Vec3[] = new Array(joints.length)
  for (const idx of order) {
    const j = joints[idx]
    const pIdx = parentIndex[idx]
    restPos[idx] = j.pivot ? [j.pivot[0], j.pivot[1], j.pivot[2]] : (pIdx >= 0 ? restPos[pIdx] : ZERO3)
  }
  return { order, parentIndex, restPos, indexById }
}

/** Exact axis-aligned bounds of a model evaluated under the given joint poses (matching renderRig FK). */
export function artPoseBounds(
  model: ArtModel,
  poses: Readonly<Record<string, ArtRecipeJointPose | undefined>> = {}
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const joints = model.joints ?? []
  const { order, parentIndex, restPos, indexById } = compileArtJoints(joints)
  const worldPos: Vec3[] = new Array(joints.length)
  const worldRot: Quaternion[] = new Array(joints.length)
  const worldScale: Vec3[] = new Array(joints.length)

  for (const idx of order) {
    const joint = joints[idx]
    const pose = poses[joint.id]
    const pIdx = parentIndex[idx]
    const pPos = pIdx >= 0 ? worldPos[pIdx] : ZERO3
    const pRot = pIdx >= 0 ? worldRot[pIdx] : IDENTITY_Q
    const pScl = pIdx >= 0 ? worldScale[pIdx] : ONE3
    const rp = restPos[idx]
    const prp = pIdx >= 0 ? restPos[pIdx] : ZERO3
    const off = pose?.position ?? ZERO3
    const localPos: Vec3 = [
      (rp[0] - prp[0] + off[0]) * pScl[0],
      (rp[1] - prp[1] + off[1]) * pScl[1],
      (rp[2] - prp[2] + off[2]) * pScl[2]
    ]
    const rOff = rotateVec3(pRot, localPos)
    worldPos[idx] = [pPos[0] + rOff[0], pPos[1] + rOff[1], pPos[2] + rOff[2]]
    const rotEuler = pose?.rotation
    worldRot[idx] = rotEuler ? multiplyQuat(pRot, quaternionFromEuler(rotEuler[0], rotEuler[1], rotEuler[2])) : pRot
    const ls = pose?.scale ?? ONE3
    worldScale[idx] = [pScl[0] * ls[0], pScl[1] * ls[1], pScl[2] * ls[2]]
  }

  for (const part of model.parts) {
    const jIdx = part.joint !== undefined ? indexById.get(part.joint) : undefined
    let finalPos: Vec3
    let finalScale: Vec3
    let finalRot: Quaternion
    if (jIdx !== undefined) {
      const rp = restPos[jIdx]
      const jPos = worldPos[jIdx], jRot = worldRot[jIdx], jScl = worldScale[jIdx]
      const lp: Vec3 = [(part.position[0] - rp[0]) * jScl[0], (part.position[1] - rp[1]) * jScl[1], (part.position[2] - rp[2]) * jScl[2]]
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
    const m = rotationMatrix(finalRot)
    const data = part.mesh.data
    const sx = finalScale[0], sy = finalScale[1], sz = finalScale[2]
    const ox = finalPos[0], oy = finalPos[1], oz = finalPos[2]
    for (let i = 0; i < data.length; i += 6) {
      const vx = data[i] * sx, vy = data[i + 1] * sy, vz = data[i + 2] * sz
      const wx = ox + m[0] * vx + m[1] * vy + m[2] * vz
      const wy = oy + m[3] * vx + m[4] * vy + m[5] * vz
      const wz = oz + m[6] * vx + m[7] * vy + m[8] * vz
      if (wx < min[0]) min[0] = wx
      if (wx > max[0]) max[0] = wx
      if (wy < min[1]) min[1] = wy
      if (wy > max[1]) max[1] = wy
      if (wz < min[2]) min[2] = wz
      if (wz > max[2]) max[2] = wz
    }
  }
  return { min, max }
}
