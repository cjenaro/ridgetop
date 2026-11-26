import {
  artPalette, artPartBounds, artPoseBounds, artShapes, checkArtName, checkArtPaletteColor,
  checkArtPartStyle, checkArtVec3, checkFrameSize, createOrthoFrameAccumulator, isSafeArtKey,
  modelFromArtRecipe, parseArtClip, parseArtTube, visitTransformedVertices
} from './art-recipe.ts'
export { artPartBounds, artPoseBounds } from './art-recipe.ts'
import type { ArtBounds, ArtRecipe, ArtRecipeClip, ArtRecipeJoint, ArtRecipeJointPose, ArtRecipePart, ArtShape, ArtTone } from './art-recipe.ts'
import { quaternionFromEuler, rotateVec3, tubeMesh } from './geometry.ts'
import type { BlendMode, Vec3 } from './types.ts'

export interface ArtPartStyle {
  unlit?: number
  alpha?: number
  blend?: BlendMode
  shade?: number
  joint?: string
}

const origin: Vec3 = [0, 0, 0]
const normals = {
  center: origin, top: [0,1,0], bottom: [0,-1,0], left: [-1,0,0],
  right: [1,0,0], front: [0,0,1], back: [0,0,-1]
} as const
export type ArtFace = keyof typeof normals
type Surface = Exclude<ArtFace, 'center'>

function vec(fn: (axis: number) => number): Vec3 { return [fn(0), fn(1), fn(2)] }
function extent(b: ArtBounds, i: number) { return b.max[i] - b.min[i] }
const shapeBounds = new Map<ArtShape, ArtBounds>()

/** Center the footprint, ground the lowest vertex, adjust joint pivots, and frame all eight sprite directions. */
export function fitArtRecipe(input: ArtRecipe): ArtRecipe {
  const source = structuredClone(input)
  const model = modelFromArtRecipe(source)
  const bounds: ArtBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (let i = 0; i < model.parts.length; i++) {
    const b = artPartBounds(model.parts[i])
    for (let axis = 0; axis < 3; axis++) {
      if (b.min[axis] < bounds.min[axis]) bounds.min[axis] = b.min[axis]
      if (b.max[axis] > bounds.max[axis]) bounds.max[axis] = b.max[axis]
    }
  }
  const snapZero = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n)
  const cx = snapZero((bounds.min[0] + bounds.max[0]) / 2)
  const floor = snapZero(bounds.min[1])
  const cz = snapZero((bounds.min[2] + bounds.max[2]) / 2)
  if (source.joints) {
    const shiftedRoot = cx !== 0 || floor !== 0 || cz !== 0
    for (const j of source.joints) {
      if (j.pivot) j.pivot = [snapZero(j.pivot[0] - cx), snapZero(j.pivot[1] - floor), snapZero(j.pivot[2] - cz)]
      else if (j.parent === undefined && shiftedRoot) j.pivot = [snapZero(-cx), snapZero(-floor), snapZero(-cz)]
    }
  }
  const framer = createOrthoFrameAccumulator()
  for (let i = 0; i < model.parts.length; i++) {
    const part = model.parts[i]
    const [x, y, z] = part.position
    const shifted: Vec3 = [x - cx, y - floor, z - cz]
    source.parts[i].position = shifted
    visitTransformedVertices(
      part.mesh,
      shifted,
      part.scale,
      quaternionFromEuler(part.pitch, part.yaw, part.roll),
      framer.addPoint
    )
  }
  const { centerY, span } = framer.fit(source.frameSize)
  source.centerY = centerY
  source.span = span
  return source
}

export const artBases = ['empty', 'case', 'vessel', 'biped', 'quadruped', 'bird'] as const
export type ArtBase = typeof artBases[number]
export interface ArtBuilderOptions {
  base?: ArtBase
  reference?: ArtRecipe
  frameSize?: number
  primary?: ArtTone
  trim?: ArtTone
  /** Dimension multipliers for the starter body and its landmarks. */
  proportions?: Vec3
}

/** Compose reusable forms and attachments, then finish as an editable, palette-inheriting recipe. */
export function createArtBuilder(name: string, { base = 'empty', reference, frameSize = reference?.frameSize ?? 32, primary = 'leaf', trim = 'wood',
  proportions = [1,1,1] }: ArtBuilderOptions = {}) {
  checkArtName(name, 'Invalid asset name')
  if (!artBases.includes(base)) throw new Error('Unknown art base ' + base)
  checkFrameSize(frameSize)
  checkArtVec3(proportions, 'base proportions', true)
  if (!Object.hasOwn(artPalette, primary) || !Object.hasOwn(artPalette, trim)) throw new Error('Unknown base palette role')
  const parts: ArtRecipePart[] = []
  const placed = new Map<string, ArtBounds>()
  const customPalette: Record<string, string> = {}
  const joints: ArtRecipeJoint[] = []
  const jointIds = new Set<string>()
  const clips: Record<string, ArtRecipeClip> = {}
  const autoGroundClips = new Set<string>()
  const timings = reference?.timings && { ...reference.timings }
  if (reference) {
    if (base !== 'empty' || proportions.some(n => n !== 1)) throw new Error('Choose either a reference or a scaled starter body')
    const model = modelFromArtRecipe(reference)
    parts.push(...structuredClone(reference.parts))
    model.parts.forEach((part, index) => placed.set(part.name ?? reference.parts[index].name, artPartBounds(part)))
    for (const [role, hex] of Object.entries(reference.palette ?? {})) {
      if (typeof hex === 'string' && !Object.hasOwn(artPalette, role)) customPalette[role] = hex
    }
    if (reference.joints) {
      for (const j of structuredClone(reference.joints)) {
        joints.push(j)
        jointIds.add(j.id)
      }
    }
    if (reference.clips) Object.assign(clips, structuredClone(reference.clips))
  }

  function hasTone(tone: string): boolean {
    return Object.hasOwn(artPalette, tone) || Object.hasOwn(customPalette, tone)
  }

  /** Register a custom named palette role (e.g. `brass`, `fur`, `glass`) on this recipe while keeping base tones inheritable. */
  function palette(role: string, hex: string) {
    const validHex = checkArtPaletteColor(role, hex)
    customPalette[role] = validHex.startsWith('#') ? validHex : '#' + validHex
    return role
  }

  function applyStyle(target: ArtRecipePart, id: string, style?: number | ArtPartStyle) {
    if (style === undefined) return
    const opts: ArtPartStyle = typeof style === 'number' ? { unlit: style } : style
    const checked = checkArtPartStyle(opts, id)
    if (checked.unlit !== undefined) {
      if (checked.unlit > 0) target.unlit = checked.unlit
      else delete target.unlit
    }
    if (checked.alpha !== undefined) {
      if (checked.alpha < 1) target.alpha = checked.alpha
      else delete target.alpha
    }
    if (checked.blend !== undefined) {
      if (checked.blend !== 'opaque' || (target.alpha !== undefined && target.alpha < 1)) target.blend = checked.blend
      else delete target.blend
    }
    if (checked.shade !== undefined) {
      if (checked.shade !== 0) target.shade = checked.shade
      else delete target.shade
    }
    if (opts.joint !== undefined) {
      if (!isSafeArtKey(opts.joint) || !jointIds.has(opts.joint)) throw new Error('Unknown joint ' + opts.joint)
      target.joint = opts.joint
    }
  }

  function inheritJoint(childName: string, parentName: string) {
    const parentPart = parts.find(part => part.name === parentName)
    if (parentPart?.joint !== undefined) {
      const child = parts.find(part => part.name === childName)
      if (child && child.joint === undefined) child.joint = parentPart.joint
    }
  }

  function adjust(id: string, { tone, scaleBy, moveBy, rotation, rotateBy, unlit, alpha, blend, shade, joint: jointId }: {
    tone?: ArtTone; scaleBy?: Vec3; moveBy?: Vec3; rotation?: Vec3; rotateBy?: Vec3
    unlit?: number; alpha?: number; blend?: BlendMode; shade?: number; joint?: string
  }) {
    const index = parts.findIndex(part => part.name === id)
    if (index < 0) throw new Error('Unknown part ' + id)
    const next = { ...parts[index] }
    if (tone !== undefined) {
      if (!hasTone(tone)) throw new Error('Unknown tone for ' + id)
      next.tone = tone
    }
    if (scaleBy) { checkArtVec3(scaleBy, id, true); next.scale = vec(i => next.scale[i]*scaleBy[i]) }
    if (moveBy) { checkArtVec3(moveBy, id); next.position = vec(i => next.position[i]+moveBy[i]) }
    if (rotation) {
      checkArtVec3(rotation, id)
      if (rotation[0]) next.pitch = rotation[0]; else delete next.pitch
      if (rotation[1]) next.yaw = rotation[1]; else delete next.yaw
      if (rotation[2]) next.roll = rotation[2]; else delete next.roll
    }
    if (rotateBy) {
      checkArtVec3(rotateBy, id)
      const p = (next.pitch ?? 0) + rotateBy[0], y = (next.yaw ?? 0) + rotateBy[1], r = (next.roll ?? 0) + rotateBy[2]
      if (p) next.pitch = p; else delete next.pitch
      if (y) next.yaw = y; else delete next.yaw
      if (r) next.roll = r; else delete next.roll
    }
    applyStyle(next, id, { unlit, alpha, blend, shade, joint: jointId })
    checkArtVec3(next.scale, id, true)
    checkArtVec3(next.position, id)
    const adjMesh = next.shape === 'tube'
      ? (() => {
          if (!next.points || next.radii === undefined) throw new Error('Invalid tube part ' + id)
          return tubeMesh(next.points, next.radii, next.sides ?? 7)
        })()
      : artShapes[next.shape]
    placed.set(id, artPartBounds({ ...next, mesh: adjMesh }))
    parts[index] = next
    return id
  }
  function remove(id: string) {
    if (!placed.delete(id)) throw new Error('Unknown part ' + id)
    parts.splice(parts.findIndex(part => part.name === id), 1)
  }

  function solid(id: string, shape: ArtShape, size: Vec3, tone: ArtTone, center: Vec3 = origin, rotation: Vec3 = origin, style: number | ArtPartStyle = 0) {
    if (typeof id !== 'string' || !id.trim() || placed.has(id)) throw new Error('Each part needs a unique name: ' + id)
    if (!Object.hasOwn(artShapes, shape) || !hasTone(tone)) throw new Error('Unknown shape or tone for ' + id)
    checkArtVec3(size, id, true); checkArtVec3(center, id); checkArtVec3(rotation, id)
    const mesh = artShapes[shape]
    let b = shapeBounds.get(shape)
    if (!b) {
      b = artPartBounds({ mesh, position: origin, scale: [1,1,1] })
      shapeBounds.set(shape, b)
    }
    const scale = vec(i => size[i]/extent(b,i))
    const [pitch,yaw,roll] = rotation
    const part: ArtRecipePart = { name: id, shape, position: center, scale, tone,
      ...(pitch && { pitch }), ...(yaw && { yaw }), ...(roll && { roll }) }
    applyStyle(part, id, style)
    // Some odd-sided meshes have an off-center bounding box. Honor the requested center.
    const shift = rotateVec3(quaternionFromEuler(pitch,yaw,roll), vec(i => (b.min[i]+b.max[i])*scale[i]/2))
    part.position = vec(i => center[i]-shift[i])
    placed.set(id, artPartBounds({ ...part, mesh }))
    parts.push(part)
    return id
  }
  function point(parent: string, face: ArtFace = 'center', offset: Vec3 = origin): Vec3 {
    const b = placed.get(parent)
    if (!b) throw new Error('Unknown parent part ' + parent)
    if (!Object.hasOwn(normals, face)) throw new Error('Unknown attachment face ' + face)
    checkArtVec3(offset, parent)
    return vec(i => (b.min[i]+b.max[i]+normals[face][i]*extent(b,i))/2+offset[i])
  }
  function attach(id: string, parent: string, face: Surface, shape: ArtShape, size: Vec3, tone: ArtTone, offset: Vec3 = origin, style: number | ArtPartStyle = 0) {
    const faceName: string = face
    if (faceName === 'center') throw new Error('Attach requires a surface face, not center')
    checkArtVec3(size, id, true)
    const anchor = point(parent, face, offset)
    const created = solid(id, shape, size, tone, vec(i => anchor[i]+normals[face][i]*size[i]*.42), origin, style)
    inheritJoint(created, parent)
    return created
  }
  function between(id: string, from: Vec3, to: Vec3, width: number | readonly [number,number], tone: ArtTone, shape: ArtShape = 'cylinder', style?: number | ArtPartStyle) {
    checkArtVec3(from, id); checkArtVec3(to, id)
    const [dx,dy,dz] = vec(i => to[i]-from[i])
    const length = Math.hypot(dx,dy,dz)
    if (!length || !Number.isFinite(length)) throw new Error('Use distinct finite endpoints for ' + id)
    const [w,d] = typeof width === 'number' ? [width,width] : width
    // Roll turns local +Y toward X. Pitch then points the remaining component along YZ.
    const pitch = Math.atan2(dz,dy), roll = -Math.atan2(dx,Math.hypot(dy,dz))
    return solid(id, shape, [w,length,d], tone, vec(i => (from[i]+to[i])/2), [pitch,0,roll], style)
  }
  function curve(id: string, pts: readonly Vec3[], widths: number | readonly number[], tone: ArtTone, options: {
    shape?: ArtShape; overlap?: number; style?: ArtPartStyle; tipTone?: ArtTone
  } = {}) {
    if (pts.length < 2) throw new Error('curve requires at least two points for ' + id)
    for (let i = 0; i < pts.length; i++) checkArtVec3(pts[i], id)
    if (typeof widths === 'number') {
      if (!Number.isFinite(widths) || widths <= 0) throw new RangeError('curve width must be positive and finite for ' + id)
    } else if (!widths.length || !widths.every(w => typeof w === 'number' && Number.isFinite(w) && w > 0)) {
      throw new RangeError('curve widths must be a non-empty array of positive finite numbers for ' + id)
    }
    const shape = options.shape ?? 'cylinder'
    const overlap = options.overlap ?? 0
    if (!Number.isFinite(overlap)) throw new RangeError('curve overlap must be finite for ' + id)
    const created: string[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1]
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
      const len = Math.hypot(dx, dy, dz)
      if (!len) continue
      const pad = overlap > 0 ? overlap * Math.min(len, 0.2) : 0
      const ux = dx / len, uy = dy / len, uz = dz / len
      const from: Vec3 = (i > 0 && pad > 0) ? [a[0] - ux * pad, a[1] - uy * pad, a[2] - uz * pad] : a
      const to: Vec3 = (i < pts.length - 2 && pad > 0) ? [b[0] + ux * pad, b[1] + uy * pad, b[2] + uz * pad] : b
      const w = typeof widths === 'number' ? widths : (widths[i] ?? widths[widths.length - 1])
      const segTone = (i === pts.length - 2 && options.tipTone) ? options.tipTone : tone
      const segName = pts.length === 2 ? id : `${id}-${i + 1}`
      created.push(between(segName, from, to, w, segTone, shape, options.style))
    }
    return created
  }
  /** Sweep a seamless continuous low-poly tube mesh along a 3D polyline (zero bend seams, ideal for tails, arched handles, cage ribs, branches). */
  function tube(id: string, pts: readonly Vec3[], radii: number | readonly number[], tone: ArtTone, options: { sides?: number; style?: number | ArtPartStyle } = {}) {
    if (typeof id !== 'string' || !id.trim() || placed.has(id)) throw new Error('Each part needs a unique name: ' + id)
    if (!hasTone(tone)) throw new Error('Unknown tone for ' + id)
    const checked = parseArtTube(pts, radii, options.sides, id)
    // Center local tube geometry around its centroid so position shifts cleanly during fitArtRecipe.
    let cx = 0, cy = 0, cz = 0
    for (const p of checked.points) { cx += p[0]; cy += p[1]; cz += p[2] }
    cx /= checked.points.length; cy /= checked.points.length; cz /= checked.points.length
    const localPts: Vec3[] = checked.points.map(p => [p[0] - cx, p[1] - cy, p[2] - cz])
    const built = tubeMesh(localPts, checked.radii, checked.sides)
    const part: ArtRecipePart = {
      name: id, shape: 'tube', points: localPts, radii: checked.radii, sides: checked.sides,
      position: [cx, cy, cz], scale: [1, 1, 1], tone
    }
    applyStyle(part, id, options.style)
    placed.set(id, artPartBounds({ ...part, mesh: built }))
    parts.push(part)
    return id
  }
  /** Apply subtle automatic crevice darkening (`shade`) to opaque non-glowing parts tucked beneath overhanging surfaces. */
  function bakeCreviceShade(strength = 0.12) {
    const s = Number.isFinite(strength) ? Math.max(0, Math.min(0.25, strength)) : 0
    if (!s) return
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if ((p.unlit ?? 0) > 0.25 || (p.alpha ?? 1) < 0.9 || (p.blend && p.blend !== 'opaque')) continue
      const b = placed.get(p.name)
      if (!b) continue
      const cx = (b.min[0] + b.max[0]) * 0.5, cz = (b.min[2] + b.max[2]) * 0.5
      let covered = 0
      for (let j = 0; j < parts.length; j++) {
        if (i === j) continue
        const occ = parts[j]
        if ((occ.alpha ?? 1) < 0.9 || (occ.blend && occ.blend !== 'opaque')) continue
        const ob = placed.get(occ.name)
        if (!ob) continue
        if (ob.min[1] >= b.min[1] + (b.max[1] - b.min[1]) * 0.35 &&
            cx >= ob.min[0] && cx <= ob.max[0] && cz >= ob.min[2] && cz <= ob.max[2] &&
            (ob.max[0] - ob.min[0]) * (ob.max[2] - ob.min[2]) > (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) * 0.6) {
          covered++
        }
      }
      if (covered > 0) {
        const delta = -Math.min(s, covered * (s * 0.6))
        const nextShade = Math.max(-0.45, Math.min(0.45, (p.shade ?? 0) + delta))
        if (Math.abs(nextShade) > 1e-4) p.shade = Math.round(nextShade * 1000) / 1000
        else delete p.shade
      }
    }
  }
  /** Apply an expressive indie animation clip preset to whichever standard joints exist on this rig (`idle`, `walk`, `run`, `jump`, `celebrate`). */
  function applyClipPreset(
    clipName: string,
    preset: 'biped-idle' | 'biped-walk' | 'biped-run' | 'biped-jump' | 'biped-celebrate',
    options: { stride?: number; duration?: number; autoGround?: boolean } = {}
  ) {
    const has = (id: string) => jointIds.has(id)
    const filterPoses = (raw: Record<string, ArtRecipeJointPose>) => {
      const out: Record<string, ArtRecipeJointPose> = {}
      for (const [k, v] of Object.entries(raw)) if (has(k)) out[k] = v
      return out
    }
    const stride = options.stride ?? (preset === 'biped-run' ? 0.68 : 0.50)
    const armSwing = stride * 0.88
    const autoGround = options.autoGround ?? true
    let def: ArtRecipeClip
    if (preset === 'biped-idle') {
      const dur = options.duration ?? 1.6
      const a = filterPoses({
        root: { position: [0, 0, 0] }, body: { position: [0, 0, 0], rotation: [0.02, 0, 0] },
        head: { rotation: [-0.02, -0.06, 0] }, 'left-arm': { rotation: [0.05, 0, 0.05] }, 'right-arm': { rotation: [-0.04, 0, -0.05] },
        tail: { rotation: [0.06, -0.16, 0] }, mailbag: { rotation: [0.02, 0, 0.03] }, cape: { rotation: [0.06, 0, 0] }
      })
      const b = filterPoses({
        root: { position: [0, 0, 0] }, body: { position: [0, 0.028 * sy, 0], rotation: [-0.02, 0, 0] },
        head: { rotation: [0.03, 0.08, 0.03] }, 'left-arm': { rotation: [-0.04, 0, 0.08] }, 'right-arm': { rotation: [0.05, 0, -0.08] },
        tail: { rotation: [0.14, 0.18, 0] }, mailbag: { rotation: [-0.03, 0, -0.03] }, cape: { rotation: [0.12, 0, 0] }
      })
      def = { duration: dur, loop: true, easing: 'smooth', frames: [{ time: 0, poses: a }, { time: dur * 0.5, poses: b }, { time: dur, poses: structuredClone(a) }] }
    } else if (preset === 'biped-jump') {
      const dur = options.duration ?? 0.6
      def = {
        duration: dur, loop: false, easing: 'easeOut',
        frames: [
          { time: 0, poses: filterPoses({ root: { position: [0, 0, 0] }, body: { position: [0, -0.06 * sy, 0], rotation: [0.18, 0, 0] }, 'left-arm': { rotation: [0.45, 0, 0.15] }, 'right-arm': { rotation: [0.45, 0, -0.15] }, 'left-leg': { rotation: [-0.25, 0, 0] }, 'right-leg': { rotation: [-0.25, 0, 0] }, tail: { rotation: [-0.25, 0, 0] } }) },
          { time: dur * 0.45, poses: filterPoses({ root: { position: [0, 0.24 * sy, 0] }, body: { position: [0, 0.04 * sy, 0], rotation: [-0.08, 0, 0] }, head: { rotation: [-0.10, 0, 0] }, 'left-arm': { rotation: [-0.75, 0, 0.35] }, 'right-arm': { rotation: [-0.75, 0, -0.35] }, 'left-leg': { rotation: [-0.38, 0, 0] }, 'right-leg': { rotation: [0.35, 0, 0] }, tail: { rotation: [0.32, 0, 0] } }) },
          { time: dur, poses: filterPoses({ root: { position: [0, 0, 0] }, body: { position: [0, 0, 0], rotation: [0.05, 0, 0] }, 'left-arm': { rotation: [0, 0, 0.08] }, 'right-arm': { rotation: [0, 0, -0.08] }, 'left-leg': { rotation: [0, 0, 0] }, 'right-leg': { rotation: [0, 0, 0] }, tail: { rotation: [0.05, 0, 0] } }) }
        ]
      }
      return clip(clipName, def, { autoGround: options.autoGround ?? false })
    } else if (preset === 'biped-celebrate') {
      const dur = options.duration ?? 0.8
      const rest = filterPoses({ root: { position: [0, 0, 0] }, body: { position: [0, 0, 0], rotation: [0, 0, 0] }, 'left-arm': { rotation: [0, 0, 0.06] }, 'right-arm': { rotation: [0, 0, -0.06] }, tail: { rotation: [0.1, -0.2, 0] } })
      const cheer = filterPoses({ root: { position: [0, 0, 0] }, body: { position: [0, 0.09 * sy, 0], rotation: [-0.08, 0, 0] }, head: { rotation: [-0.14, 0, 0] }, 'left-arm': { rotation: [-1.15, 0, 0.38] }, 'right-arm': { rotation: [-1.15, 0, -0.38] }, tail: { rotation: [0.35, 0.32, 0] } })
      def = { duration: dur, loop: true, easing: 'backOut', frames: [{ time: 0, poses: rest }, { time: dur * 0.45, poses: cheer }, { time: dur, poses: structuredClone(rest) }] }
    } else if (preset === 'biped-walk' || preset === 'biped-run') {
      // biped-walk or biped-run
      const isRun = preset === 'biped-run'
      const dur = options.duration ?? (isRun ? 0.56 : 0.72)
      const lean = isRun ? 0.16 : 0.09
      const bounce = (isRun ? 0.06 : 0.038) * sy
      const f0 = filterPoses({
        root: { position: [0, 0, 0] },
        body: { position: [0, 0, 0], rotation: [lean, 0.11, -0.05] },
        head: { rotation: [-lean * 0.7, -0.09, 0.04] },
        'left-leg': { rotation: [-stride, 0, 0] }, 'right-leg': { rotation: [stride, 0, 0] },
        'left-arm': { rotation: [armSwing, 0, 0.08] }, 'right-arm': { rotation: [-armSwing, 0, -0.08] },
        tail: { rotation: [0.18, -0.32, -0.08] }, mailbag: { rotation: [0.14, 0, 0.14] }, cape: { rotation: [isRun ? 0.35 : 0.18, -0.1, 0] }
      })
      const f1 = filterPoses({
        root: { position: [0, 0, 0] },
        body: { position: [0, bounce, 0], rotation: [lean * 0.6, 0, 0] },
        head: { rotation: [-lean * 0.4, 0, 0] },
        'left-leg': { position: [0, 0, 0], rotation: [0, 0, 0] }, 'right-leg': { position: [0, 0.06 * sy, 0], rotation: [-stride * 0.25, 0, 0] },
        'left-arm': { rotation: [0, 0, 0.05] }, 'right-arm': { rotation: [0, 0, -0.05] },
        tail: { rotation: [0.28, 0, 0] }, mailbag: { rotation: [-0.08, 0, 0] }, cape: { rotation: [isRun ? 0.48 : 0.26, 0, 0] }
      })
      const f2 = filterPoses({
        root: { position: [0, 0, 0] },
        body: { position: [0, 0, 0], rotation: [lean, -0.11, 0.05] },
        head: { rotation: [-lean * 0.7, 0.09, -0.04] },
        'left-leg': { rotation: [stride, 0, 0] }, 'right-leg': { rotation: [-stride, 0, 0] },
        'left-arm': { rotation: [-armSwing, 0, 0.08] }, 'right-arm': { rotation: [armSwing, 0, -0.08] },
        tail: { rotation: [0.18, 0.32, 0.08] }, mailbag: { rotation: [-0.12, 0, -0.14] }, cape: { rotation: [isRun ? 0.35 : 0.18, 0.1, 0] }
      })
      const f3 = filterPoses({
        root: { position: [0, 0, 0] },
        body: { position: [0, bounce, 0], rotation: [lean * 0.6, 0, 0] },
        head: { rotation: [-lean * 0.4, 0, 0] },
        'left-leg': { position: [0, 0.06 * sy, 0], rotation: [-stride * 0.25, 0, 0] }, 'right-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
        'left-arm': { rotation: [0, 0, 0.05] }, 'right-arm': { rotation: [0, 0, -0.05] },
        tail: { rotation: [0.28, 0, 0] }, mailbag: { rotation: [0.08, 0, 0] }, cape: { rotation: [isRun ? 0.48 : 0.26, 0, 0] }
      })
      def = {
        duration: dur, loop: true, easing: 'smooth',
        frames: [
          { time: 0, poses: f0 },
          { time: dur * 0.25, poses: f1 },
          { time: dur * 0.5, poses: f2 },
          { time: dur * 0.75, poses: f3 },
          { time: dur, poses: structuredClone(f0) }
        ]
      }
    } else {
      throw new RangeError('Unknown clip preset: ' + String(preset))
    }
    return clip(clipName, def, { autoGround })
  }
  function handle(id: string, parent: string, face: Surface, span: number, reach: number, depth: number, tone: ArtTone, style?: number | ArtPartStyle) {
    if (!(reach > 0 && Number.isFinite(reach))) throw new RangeError('Invalid handle reach for ' + id)
    const anchor = point(parent, face), n = normals[face], b = placed.get(parent)
    if (!b) throw new Error('Unknown parent part ' + parent)
    const inset = n.reduce<number>((sum,v,i) => sum + Math.abs(v)*extent(b,i)*.12, 0)
    const created = between(id, vec(i => anchor[i]-n[i]*inset), vec(i => anchor[i]+n[i]*reach), [span,depth], tone, 'arch', style)
    inheritJoint(created, parent)
    return created
  }
  function disc(id: string, parent: string, face: Surface, diameter: number, depth: number, tone: ArtTone, offset: Vec3 = origin, shape: 'cylinder' | 'ring' = 'cylinder', style?: number | ArtPartStyle) {
    if (!(depth > 0 && Number.isFinite(depth))) throw new RangeError('Invalid disc depth for ' + id)
    const anchor = point(parent,face,offset), n = normals[face]
    const created = between(id, vec(i => anchor[i]-n[i]*depth*.12), vec(i => anchor[i]+n[i]*depth*.88), diameter, tone, shape, style)
    inheritJoint(created, parent)
    return created
  }

  /** Define a rig joint in model space (optionally parented to an earlier joint). */
  function joint(id: string, parent?: string, pivot?: Vec3) {
    if (!isSafeArtKey(id) || jointIds.has(id)) throw new Error('Each joint needs a unique valid id: ' + id)
    if (parent !== undefined && (!isSafeArtKey(parent) || !jointIds.has(parent))) {
      throw new Error('Unknown parent joint ' + parent)
    }
    const entry: ArtRecipeJoint = { id }
    if (parent !== undefined) entry.parent = parent
    if (pivot !== undefined) entry.pivot = checkArtVec3(pivot, id)
    joints.push(entry)
    jointIds.add(id)
    return id
  }
  /** Bind a named part to a defined rig joint. */
  function bind(partName: string, jointId: string) {
    const index = parts.findIndex(part => part.name === partName)
    if (index < 0) throw new Error('Unknown part ' + partName)
    if (!isSafeArtKey(jointId) || !jointIds.has(jointId)) throw new Error('Unknown joint ' + jointId)
    parts[index] = { ...parts[index], joint: jointId }
    return partName
  }
  /** Define or replace a named animation clip on the rig. Pass `{ autoGround: true }` to keep the lowest vertex at y=0 on every keyframe. */
  function clip(clipName: string, clipDef: ArtRecipeClip, options?: { autoGround?: boolean }) {
    clips[clipName] = parseArtClip(clipDef, clipName, jointIds, name)
    if (options?.autoGround) autoGroundClips.add(clipName)
    else autoGroundClips.delete(clipName)
    return clipName
  }

  function finish(): ArtRecipe {
    const needsV2 = Object.keys(customPalette).length > 0 || parts.some(p => p.shape === 'tube' || p.alpha !== undefined || p.blend !== undefined || p.shade !== undefined)
    const raw: ArtRecipe = {
      format: 'ridgetop-art', version: needsV2 ? 2 : 1, name, palette: { ...customPalette }, parts, frameSize, centerY: 0, span: 1,
      ...(timings && { timings }),
      ...(joints.length && { joints }),
      ...(Object.keys(clips).length && { clips })
    }
    const fitted = fitArtRecipe(raw)
    if (autoGroundClips.size && fitted.clips && fitted.joints?.some(j => j.id === 'root')) {
      const model = modelFromArtRecipe(fitted)
      for (const clipName of autoGroundClips) {
        const target = fitted.clips[clipName]
        if (!target) continue
        for (const frame of target.frames) {
          const existingRoot = frame.poses.root
          const rx = existingRoot?.position?.[0] ?? 0
          const rz = existingRoot?.position?.[2] ?? 0
          const probe: Record<string, ArtRecipeJointPose | undefined> = { ...frame.poses }
          if (existingRoot) {
            probe.root = { ...existingRoot, position: [rx, 0, rz] }
          }
          const b = artPoseBounds(model, probe)
          const lift = Math.abs(b.min[1]) > 1e-7 ? -b.min[1] : 0
          if (lift !== 0 || existingRoot?.position) {
            frame.poses.root = { ...existingRoot, position: [rx, lift, rz] }
          }
        }
      }
    }
    return fitted
  }

  // Dimensions here describe a one-unit starter. Author additions use world units.
  const scaled = (v: Vec3) => vec(i => v[i]*proportions[i])
  function mass(id: string, shape: ArtShape, size: Vec3, tone: ArtTone, at: Vec3) {
    solid(id,shape,scaled(size),tone,scaled(at))
  }
  function limb(id: string, a: Vec3, b: Vec3, width: number, tone: ArtTone, shape: ArtShape = 'taper') {
    const dy = Math.abs(b[1] - a[1]), dz = Math.abs(b[2] - a[2])
    const depthScale = dz > dy ? proportions[1] : proportions[2]
    between(id, scaled(a), scaled(b), [width * proportions[0], width * depthScale], tone, shape)
  }
  function registerStarterClip(clipName: string, clipDef: ArtRecipeClip) {
    clip(clipName, clipDef)
    autoGroundClips.add(clipName)
  }
  const sy = proportions[1], sz = proportions[2]

  if (base === 'case') {
    mass('body','prism',[1,.75,.58],primary,[0,.40,0])
    mass('base','prism',[.96,.12,.55],trim,[0,.065,0])
  } else if (base === 'vessel') {
    mass('body','bowl',[.94,.72,.82],primary,[0,.40,0])
    mass('foot','cylinder',[.54,.10,.47],trim,[0,.05,0])
    mass('rim','ring',[.96,.075,.84],trim,[0,.75,0])
  } else if (base === 'biped') {
    mass('body','prism',[.62,.58,.42],primary,[0,.63,0])
    mass('collar','oval',[.53,.12,.41],trim,[0,.90,0])
    mass('head','oval',[.49,.47,.43],'light',[0,1.12,.025])
    for (const [side,s] of [['left',-1],['right',1]] as const) {
      mass(side+'-boot','prism',[.225,.25,.35],'ink',[s*.15,.125,.045])
      limb(side+'-leg',[s*.14,.43,0],[s*.15,.16,0],.19,trim)
      limb(side+'-arm',[s*.265,.80,0],[s*.35,.49,.045],.205,primary)
      mass(side+'-hand','oval',[.14,.15,.14],'light',[s*.35,.47,.045])
      mass(side+'-eye','oval',[.064,.064,.046],'ink',[s*.096,1.16,.218])
    }
    joint('root', undefined, [0, 0, 0])
    joint('body', 'root', scaled([0, .43, 0]))
    joint('head', 'body', scaled([0, .90, .01]))
    joint('left-arm', 'body', scaled([-.265, .80, 0]))
    joint('right-arm', 'body', scaled([.265, .80, 0]))
    joint('left-leg', 'root', scaled([-.14, .43, 0]))
    joint('right-leg', 'root', scaled([.14, .43, 0]))
    bind('body', 'body'); bind('collar', 'body')
    bind('head', 'head'); bind('left-eye', 'head'); bind('right-eye', 'head')
    bind('left-arm', 'left-arm'); bind('left-hand', 'left-arm')
    bind('right-arm', 'right-arm'); bind('right-hand', 'right-arm')
    bind('left-leg', 'left-leg'); bind('left-boot', 'left-leg')
    bind('right-leg', 'right-leg'); bind('right-boot', 'right-leg')

    const idleStart: Record<string, ArtRecipeJointPose> = {
      root: { position: [0, 0, 0] },
      body: { position: [0, 0, 0], rotation: [0, 0, 0] },
      head: { rotation: [0, 0, 0] },
      'left-arm': { rotation: [0, 0, 0] },
      'right-arm': { rotation: [0, 0, 0] },
      'left-leg': { rotation: [0, 0, 0] },
      'right-leg': { rotation: [0, 0, 0] }
    }
    registerStarterClip('idle', {
      duration: 1.6, loop: true, easing: 'smooth',
      frames: [
        { time: 0, poses: structuredClone(idleStart) },
        {
          time: 0.8,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.018 * sy, 0], rotation: [0.025, 0, 0] },
            head: { rotation: [-0.035, 0.05, 0] },
            'left-arm': { rotation: [0.04, 0, 0.04] },
            'right-arm': { rotation: [-0.04, 0, -0.04] },
            'left-leg': { rotation: [0, 0, 0] },
            'right-leg': { rotation: [0, 0, 0] }
          }
        },
        { time: 1.6, poses: structuredClone(idleStart) }
      ]
    })
    const walkStrideLeft: Record<string, ArtRecipeJointPose> = {
      root: { position: [0, 0, 0] },
      body: { position: [0, 0, 0], rotation: [0.05, 0.06, -0.03] },
      head: { rotation: [-0.04, -0.05, 0.02] },
      'left-leg': { position: [0, 0, 0], rotation: [-0.32, 0, 0] },
      'right-leg': { position: [0, 0, 0], rotation: [0.32, 0, 0] },
      'left-arm': { rotation: [0.30, 0, 0.04] },
      'right-arm': { rotation: [-0.30, 0, -0.04] }
    }
    registerStarterClip('walk', {
      duration: 0.8, loop: true, easing: 'smooth',
      frames: [
        { time: 0, poses: structuredClone(walkStrideLeft) },
        {
          time: 0.2,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.025 * sy, 0], rotation: [0.02, 0, 0] },
            head: { rotation: [-0.02, 0, 0] },
            'left-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
            'right-leg': { position: [0, 0.04 * sy, 0], rotation: [0, 0, 0] },
            'left-arm': { rotation: [0, 0, 0] },
            'right-arm': { rotation: [0, 0, 0] }
          }
        },
        {
          time: 0.4,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0, 0], rotation: [0.05, -0.06, 0.03] },
            head: { rotation: [-0.04, 0.05, -0.02] },
            'left-leg': { position: [0, 0, 0], rotation: [0.32, 0, 0] },
            'right-leg': { position: [0, 0, 0], rotation: [-0.32, 0, 0] },
            'left-arm': { rotation: [-0.30, 0, 0.04] },
            'right-arm': { rotation: [0.30, 0, -0.04] }
          }
        },
        {
          time: 0.6,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.025 * sy, 0], rotation: [0.02, 0, 0] },
            head: { rotation: [-0.02, 0, 0] },
            'left-leg': { position: [0, 0.04 * sy, 0], rotation: [0, 0, 0] },
            'right-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
            'left-arm': { rotation: [0, 0, 0] },
            'right-arm': { rotation: [0, 0, 0] }
          }
        },
        { time: 0.8, poses: structuredClone(walkStrideLeft) }
      ]
    })
  } else if (base === 'quadruped') {
    mass('body','oval',[.70,.64,1.05],primary,[0,.52,-.045])
    mass('head','oval',[.46,.43,.45],primary,[0,.60,.51])
    mass('muzzle','oval',[.31,.22,.26],trim,[0,.53,.68])
    for (const [side,s] of [['left',-1],['right',1]] as const) {
      for (const [end,z] of [['fore',.26],['hind',-.35]] as const) {
        limb(side+'-'+end+'-leg',[s*.23,.47,z],[s*.255,.105,z+.045],.18,primary)
        mass(side+'-'+end+'-foot','oval',[.19,.16,.26],trim,[s*.255,.08,z+.075])
      }
      mass(side+'-eye','oval',[.075,.075,.06],'ink',[s*.15,.65,.656])
    }
    joint('root', undefined, [0, 0, 0])
    joint('body', 'root', scaled([0, .47, -.045]))
    joint('head', 'body', scaled([0, .56, .36]))
    joint('left-fore-leg', 'root', scaled([-.23, .47, .26]))
    joint('right-fore-leg', 'root', scaled([.23, .47, .26]))
    joint('left-hind-leg', 'root', scaled([-.23, .47, -.35]))
    joint('right-hind-leg', 'root', scaled([.23, .47, -.35]))
    bind('body', 'body')
    bind('head', 'head'); bind('muzzle', 'head'); bind('left-eye', 'head'); bind('right-eye', 'head')
    for (const side of ['left', 'right'] as const) {
      for (const end of ['fore', 'hind'] as const) {
        const j = side + '-' + end + '-leg'
        bind(j, j); bind(side + '-' + end + '-foot', j)
      }
    }

    const qIdleStart: Record<string, ArtRecipeJointPose> = {
      root: { position: [0, 0, 0] },
      body: { position: [0, 0, 0], rotation: [0, 0, 0] },
      head: { rotation: [0, 0, 0] },
      'left-fore-leg': { rotation: [0, 0, 0] },
      'right-fore-leg': { rotation: [0, 0, 0] },
      'left-hind-leg': { rotation: [0, 0, 0] },
      'right-hind-leg': { rotation: [0, 0, 0] }
    }
    registerStarterClip('idle', {
      duration: 1.6, loop: true, easing: 'smooth',
      frames: [
        { time: 0, poses: structuredClone(qIdleStart) },
        {
          time: 0.8,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.016 * sy, 0], rotation: [0.02, 0, 0] },
            head: { rotation: [-0.05, 0.05, 0] },
            'left-fore-leg': { rotation: [0, 0, 0] },
            'right-fore-leg': { rotation: [0, 0, 0] },
            'left-hind-leg': { rotation: [0, 0, 0] },
            'right-hind-leg': { rotation: [0, 0, 0] }
          }
        },
        { time: 1.6, poses: structuredClone(qIdleStart) }
      ]
    })
    const qWalkA: Record<string, ArtRecipeJointPose> = {
      root: { position: [0, 0, 0] },
      body: { position: [0, 0, 0], rotation: [0.03, 0, -0.025] },
      head: { rotation: [-0.04, 0.03, 0] },
      'left-fore-leg': { position: [0, 0, 0], rotation: [-0.28, 0, 0] },
      'right-hind-leg': { position: [0, 0, 0], rotation: [-0.28, 0, 0] },
      'right-fore-leg': { position: [0, 0, 0], rotation: [0.28, 0, 0] },
      'left-hind-leg': { position: [0, 0, 0], rotation: [0.28, 0, 0] }
    }
    registerStarterClip('walk', {
      duration: 0.8, loop: true, easing: 'smooth',
      frames: [
        { time: 0, poses: structuredClone(qWalkA) },
        {
          time: 0.2,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.02 * sy, 0], rotation: [0, 0, 0] },
            head: { rotation: [0.02, 0, 0] },
            'left-fore-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
            'right-hind-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
            'right-fore-leg': { position: [0, 0.035 * sy, 0], rotation: [0, 0, 0] },
            'left-hind-leg': { position: [0, 0.035 * sy, 0], rotation: [0, 0, 0] }
          }
        },
        {
          time: 0.4,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0, 0], rotation: [0.03, 0, 0.025] },
            head: { rotation: [-0.04, -0.03, 0] },
            'left-fore-leg': { position: [0, 0, 0], rotation: [0.28, 0, 0] },
            'right-hind-leg': { position: [0, 0, 0], rotation: [0.28, 0, 0] },
            'right-fore-leg': { position: [0, 0, 0], rotation: [-0.28, 0, 0] },
            'left-hind-leg': { position: [0, 0, 0], rotation: [-0.28, 0, 0] }
          }
        },
        {
          time: 0.6,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.02 * sy, 0], rotation: [0, 0, 0] },
            head: { rotation: [0.02, 0, 0] },
            'left-fore-leg': { position: [0, 0.035 * sy, 0], rotation: [0, 0, 0] },
            'right-hind-leg': { position: [0, 0.035 * sy, 0], rotation: [0, 0, 0] },
            'right-fore-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
            'left-hind-leg': { position: [0, 0, 0], rotation: [0, 0, 0] }
          }
        },
        { time: 0.8, poses: structuredClone(qWalkA) }
      ]
    })
  } else if (base === 'bird') {
    mass('body','oval',[.53,.50,.87],primary,[0,.61,-.04])
    limb('neck',[0,.72,.18],[0,1.02,.29],.24,primary)
    mass('head','oval',[.32,.33,.39],primary,[0,1.02,.30])
    limb('beak',[0,1.015,.435],[0,1.0,.77],.145,'accent','cone')
    limb('tail',[0,.61,-.31],[0,.73,-.72],.245,trim,'cone')
    for (const [side,s] of [['left',-1],['right',1]] as const) {
      mass(side+'-wing','oval',[.16,.28,.62],trim,[s*.22,.63,-.11])
      limb(side+'-leg',[s*.115,.45,-.02],[s*.12,.06,.015],.078,'accent','cylinder')
      mass(side+'-foot','prism',[.10,.065,.24],'ink',[s*.12,.035,.065])
      mass(side+'-eye','oval',[.055,.060,.054],'ink',[s*.126,1.065,.392])
    }
    joint('root', undefined, [0, 0, 0])
    joint('body', 'root', scaled([0, .50, -.04]))
    joint('head', 'body', scaled([0, .94, .27]))
    joint('tail', 'body', scaled([0, .61, -.31]))
    joint('left-wing', 'body', scaled([-.20, .63, .02]))
    joint('right-wing', 'body', scaled([.20, .63, .02]))
    joint('left-leg', 'root', scaled([-.115, .45, -.02]))
    joint('right-leg', 'root', scaled([.115, .45, -.02]))
    bind('body', 'body'); bind('neck', 'body')
    bind('head', 'head'); bind('beak', 'head'); bind('left-eye', 'head'); bind('right-eye', 'head')
    bind('tail', 'tail')
    bind('left-wing', 'left-wing'); bind('right-wing', 'right-wing')
    bind('left-leg', 'left-leg'); bind('left-foot', 'left-leg')
    bind('right-leg', 'right-leg'); bind('right-foot', 'right-leg')

    const bIdleStart: Record<string, ArtRecipeJointPose> = {
      root: { position: [0, 0, 0] },
      body: { position: [0, 0, 0], rotation: [0, 0, 0] },
      head: { position: [0, 0, 0], rotation: [0, 0, 0] },
      tail: { rotation: [0, 0, 0] },
      'left-wing': { rotation: [0, 0, 0] },
      'right-wing': { rotation: [0, 0, 0] },
      'left-leg': { rotation: [0, 0, 0] },
      'right-leg': { rotation: [0, 0, 0] }
    }
    registerStarterClip('idle', {
      duration: 1.6, loop: true, easing: 'smooth',
      frames: [
        { time: 0, poses: structuredClone(bIdleStart) },
        {
          time: 0.8,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.015 * sy, 0], rotation: [0.025, 0, 0] },
            head: { position: [0, 0, 0.015 * sz], rotation: [-0.04, 0.07, 0] },
            tail: { rotation: [0.06, 0, 0] },
            'left-wing': { rotation: [0, 0, 0.05] },
            'right-wing': { rotation: [0, 0, -0.05] },
            'left-leg': { rotation: [0, 0, 0] },
            'right-leg': { rotation: [0, 0, 0] }
          }
        },
        { time: 1.6, poses: structuredClone(bIdleStart) }
      ]
    })
    const bWalkA: Record<string, ArtRecipeJointPose> = {
      root: { position: [0, 0, 0] },
      body: { position: [0, 0, 0], rotation: [0.04, 0.04, -0.03] },
      head: { position: [0, 0, 0.03 * sz], rotation: [0.06, -0.04, 0] },
      tail: { rotation: [-0.06, 0, 0] },
      'left-wing': { rotation: [0, 0, 0.06] },
      'right-wing': { rotation: [0, 0, -0.04] },
      'left-leg': { position: [0, 0, 0], rotation: [-0.34, 0, 0] },
      'right-leg': { position: [0, 0, 0], rotation: [0.34, 0, 0] }
    }
    registerStarterClip('walk', {
      duration: 0.72, loop: true, easing: 'smooth',
      frames: [
        { time: 0, poses: structuredClone(bWalkA) },
        {
          time: 0.18,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.02 * sy, 0], rotation: [-0.01, 0, 0] },
            head: { position: [0, 0, -0.015 * sz], rotation: [-0.05, 0, 0] },
            tail: { rotation: [0.05, 0, 0] },
            'left-wing': { rotation: [0, 0, 0.02] },
            'right-wing': { rotation: [0, 0, -0.02] },
            'left-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
            'right-leg': { position: [0, 0.04 * sy, 0], rotation: [0, 0, 0] }
          }
        },
        {
          time: 0.36,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0, 0], rotation: [0.04, -0.04, 0.03] },
            head: { position: [0, 0, 0.03 * sz], rotation: [0.06, 0.04, 0] },
            tail: { rotation: [-0.06, 0, 0] },
            'left-wing': { rotation: [0, 0, 0.04] },
            'right-wing': { rotation: [0, 0, -0.06] },
            'left-leg': { position: [0, 0, 0], rotation: [0.34, 0, 0] },
            'right-leg': { position: [0, 0, 0], rotation: [-0.34, 0, 0] }
          }
        },
        {
          time: 0.54,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.02 * sy, 0], rotation: [-0.01, 0, 0] },
            head: { position: [0, 0, -0.015 * sz], rotation: [-0.05, 0, 0] },
            tail: { rotation: [0.05, 0, 0] },
            'left-wing': { rotation: [0, 0, 0.02] },
            'right-wing': { rotation: [0, 0, -0.02] },
            'left-leg': { position: [0, 0.04 * sy, 0], rotation: [0, 0, 0] },
            'right-leg': { position: [0, 0, 0], rotation: [0, 0, 0] }
          }
        },
        { time: 0.72, poses: structuredClone(bWalkA) }
      ]
    })
  }
  return { palette, solid, point, attach, between, curve, tube, handle, disc, adjust, remove, joint, bind, clip, applyClipPreset, bakeCreviceShade, finish }
}
