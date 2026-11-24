import { artPalette, artPoseBounds, artShapes, checkArtClip, checkFrameSize, isSafeArtKey, modelFromArtRecipe } from './art-recipe.ts'
export { artPoseBounds } from './art-recipe.ts'
import type { ArtPart, ArtRecipe, ArtRecipeClip, ArtRecipeJoint, ArtRecipeJointPose, ArtRecipePart, ArtShape, ArtTone } from './art-recipe.ts'
import { quaternionFromEuler, rotateVec3, rotationMatrix } from './geometry.ts'
import type { Vec3 } from './types.ts'

const origin: Vec3 = [0, 0, 0]
const normals = {
  center: origin, top: [0,1,0], bottom: [0,-1,0], left: [-1,0,0],
  right: [1,0,0], front: [0,0,1], back: [0,0,-1]
} as const
export type ArtFace = keyof typeof normals
type Surface = Exclude<ArtFace, 'center'>
type Bounds = { min: number[]; max: number[] }
type PlacedMesh = Pick<ArtPart, 'mesh' | 'position' | 'scale' | 'pitch' | 'yaw' | 'roll'>
const emptyBounds = (): Bounds => ({ min: [Infinity,Infinity,Infinity], max: [-Infinity,-Infinity,-Infinity] })

function visitVertices(part: PlacedMesh, visit: (x: number, y: number, z: number) => void) {
  const m = rotationMatrix(quaternionFromEuler(part.pitch, part.yaw, part.roll))
  const data = part.mesh.data
  for (let i = 0; i < data.length; i += 6) {
    const x = data[i] * part.scale[0], y = data[i+1] * part.scale[1], z = data[i+2] * part.scale[2]
    visit(part.position[0]+m[0]*x+m[1]*y+m[2]*z, part.position[1]+m[3]*x+m[4]*y+m[5]*z,
      part.position[2]+m[6]*x+m[7]*y+m[8]*z)
  }
}

/** Exact axis-aligned bounds after the authored scale and rotation. */
export function artPartBounds(part: PlacedMesh): Bounds {
  const bounds = emptyBounds()
  visitVertices(part, (x, y, z) => {
    bounds.min[0] = Math.min(bounds.min[0],x); bounds.max[0] = Math.max(bounds.max[0],x)
    bounds.min[1] = Math.min(bounds.min[1],y); bounds.max[1] = Math.max(bounds.max[1],y)
    bounds.min[2] = Math.min(bounds.min[2],z); bounds.max[2] = Math.max(bounds.max[2],z)
  })
  return bounds
}

function vec(fn: (axis: number) => number): Vec3 { return [fn(0), fn(1), fn(2)] }
function checkVector(v: Vec3, label: string, positive = false) {
  if (!Array.isArray(v) || v.length !== 3) {
    throw new RangeError('Expected three ' + (positive ? 'positive ' : '') + 'finite dimensions for ' + label)
  }
  for (let i = 0; i < 3; i++) {
    const n = v[i]
    if (typeof n !== 'number' || !Number.isFinite(n) || (positive && n <= 0)) {
      throw new RangeError('Expected three ' + (positive ? 'positive ' : '') + 'finite dimensions for ' + label)
    }
  }
}
function extent(b: Bounds, i: number) { return b.max[i] - b.min[i] }
const shapeBounds = new Map<ArtShape, Bounds>()
const angles = Array.from({ length: 8 }, (_, i) => [Math.sin(i * Math.PI / 4), Math.cos(i * Math.PI / 4)] as const)
const elevation = Math.PI / 6
const cosElevation = Math.cos(elevation)
const sinElevation = Math.sin(elevation)

/** Center the footprint, ground the lowest vertex, adjust joint pivots, and frame all eight sprite directions. */
export function fitArtRecipe(input: ArtRecipe): ArtRecipe {
  const source = structuredClone(input)
  const model = modelFromArtRecipe(source)
  const bounds = emptyBounds()
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
  let halfWidth = 0, low = Infinity, high = -Infinity
  for (let i = 0; i < model.parts.length; i++) {
    const part = model.parts[i]
    const [x, y, z] = part.position
    const shifted: Vec3 = [x - cx, y - floor, z - cz]
    source.parts[i].position = shifted
    const m = rotationMatrix(quaternionFromEuler(part.pitch, part.yaw, part.roll))
    const data = part.mesh.data
    const sx = part.scale[0], sy = part.scale[1], sz = part.scale[2]
    const ox = shifted[0], oy = shifted[1], oz = shifted[2]
    for (let k = 0; k < data.length; k += 6) {
      const vx = data[k] * sx, vy = data[k + 1] * sy, vz = data[k + 2] * sz
      const px = ox + m[0] * vx + m[1] * vy + m[2] * vz
      const py = oy + m[3] * vx + m[4] * vy + m[5] * vz
      const pz = oz + m[6] * vx + m[7] * vy + m[8] * vz
      const cyTerm = cosElevation * py
      for (let d = 0; d < 8; d++) {
        const sin = angles[d][0], cos = angles[d][1]
        const u = Math.abs(cos * px - sin * pz)
        if (u > halfWidth) halfWidth = u
        const vertical = cyTerm - sinElevation * (sin * px + cos * pz)
        if (vertical < low) low = vertical
        if (vertical > high) high = vertical
      }
    }
  }
  source.centerY = (low + high) / (2 * cosElevation)
  const padding = Math.min(2, source.frameSize * .1)
  source.span = Math.max(2 * halfWidth, high - low) / (1 - 2 * padding / source.frameSize)
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
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) throw new Error('Invalid asset name')
  if (!artBases.includes(base)) throw new Error('Unknown art base ' + base)
  checkFrameSize(frameSize)
  checkVector(proportions, 'base proportions', true)
  if (!Object.hasOwn(artPalette, primary) || !Object.hasOwn(artPalette, trim)) throw new Error('Unknown base palette role')
  const parts: ArtRecipePart[] = []
  const placed = new Map<string, Bounds>()
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
    if (reference.joints) {
      for (const j of structuredClone(reference.joints)) {
        joints.push(j)
        jointIds.add(j.id)
      }
    }
    if (reference.clips) Object.assign(clips, structuredClone(reference.clips))
  }

  function inheritJoint(childName: string, parentName: string) {
    const parentPart = parts.find(part => part.name === parentName)
    if (parentPart?.joint !== undefined) {
      const child = parts.find(part => part.name === childName)
      if (child) child.joint = parentPart.joint
    }
  }

  function adjust(id: string, { tone, scaleBy, moveBy, unlit }: { tone?: ArtTone; scaleBy?: Vec3; moveBy?: Vec3; unlit?: number }) {
    const index = parts.findIndex(part => part.name === id)
    if (index < 0) throw new Error('Unknown part ' + id)
    const next = { ...parts[index] }
    if (tone !== undefined) {
      if (!Object.hasOwn(artPalette, tone)) throw new Error('Unknown tone for ' + id)
      next.tone = tone
    }
    if (scaleBy) { checkVector(scaleBy, id, true); next.scale = vec(i => next.scale[i]*scaleBy[i]) }
    if (moveBy) { checkVector(moveBy, id); next.position = vec(i => next.position[i]+moveBy[i]) }
    if (unlit !== undefined) {
      if (typeof unlit !== 'number' || !Number.isFinite(unlit) || unlit < 0 || unlit > 1) throw new RangeError('Unlit must be in 0–1 for ' + id)
      if (unlit > 0) next.unlit = unlit
      else delete next.unlit
    }
    checkVector(next.scale, id, true)
    checkVector(next.position, id)
    placed.set(id, artPartBounds({ ...next, mesh: artShapes[next.shape] }))
    parts[index] = next
    return id
  }
  function remove(id: string) {
    if (!placed.delete(id)) throw new Error('Unknown part ' + id)
    parts.splice(parts.findIndex(part => part.name === id), 1)
  }

  function solid(id: string, shape: ArtShape, size: Vec3, tone: ArtTone, center: Vec3 = origin, rotation: Vec3 = origin, unlit = 0) {
    if (typeof id !== 'string' || !id.trim() || placed.has(id)) throw new Error('Each part needs a unique name: ' + id)
    if (!Object.hasOwn(artShapes, shape) || !Object.hasOwn(artPalette, tone)) throw new Error('Unknown shape or tone for ' + id)
    if (typeof unlit !== 'number' || !Number.isFinite(unlit) || unlit < 0 || unlit > 1) throw new RangeError('Unlit must be in 0–1 for ' + id)
    checkVector(size, id, true); checkVector(center, id); checkVector(rotation, id)
    const mesh = artShapes[shape]
    let b = shapeBounds.get(shape)
    if (!b) {
      b = artPartBounds({ mesh, position: origin, scale: [1,1,1] })
      shapeBounds.set(shape, b)
    }
    const scale = vec(i => size[i]/extent(b,i))
    const [pitch,yaw,roll] = rotation
    const part: ArtRecipePart = { name: id, shape, position: center, scale, tone,
      ...(pitch && { pitch }), ...(yaw && { yaw }), ...(roll && { roll }), ...(unlit > 0 && { unlit }) }
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
    checkVector(offset, parent)
    return vec(i => (b.min[i]+b.max[i]+normals[face][i]*extent(b,i))/2+offset[i])
  }
  function attach(id: string, parent: string, face: Surface, shape: ArtShape, size: Vec3, tone: ArtTone, offset: Vec3 = origin, unlit = 0) {
    const faceName: string = face
    if (faceName === 'center') throw new Error('Attach requires a surface face, not center')
    checkVector(size, id, true)
    const anchor = point(parent, face, offset)
    const created = solid(id, shape, size, tone, vec(i => anchor[i]+normals[face][i]*size[i]*.42), origin, unlit)
    inheritJoint(created, parent)
    return created
  }
  function between(id: string, from: Vec3, to: Vec3, width: number | readonly [number,number], tone: ArtTone, shape: ArtShape = 'cylinder') {
    checkVector(from, id); checkVector(to, id)
    const [dx,dy,dz] = vec(i => to[i]-from[i])
    const length = Math.hypot(dx,dy,dz)
    if (!length || !Number.isFinite(length)) throw new Error('Use distinct finite endpoints for ' + id)
    const [w,d] = typeof width === 'number' ? [width,width] : width
    // Roll turns local +Y toward X. Pitch then points the remaining component along YZ.
    const pitch = Math.atan2(dz,dy), roll = -Math.atan2(dx,Math.hypot(dy,dz))
    return solid(id, shape, [w,length,d], tone, vec(i => (from[i]+to[i])/2), [pitch,0,roll])
  }
  function handle(id: string, parent: string, face: Surface, span: number, reach: number, depth: number, tone: ArtTone) {
    if (!(reach > 0 && Number.isFinite(reach))) throw new RangeError('Invalid handle reach for ' + id)
    const anchor = point(parent, face), n = normals[face], b = placed.get(parent)
    if (!b) throw new Error('Unknown parent part ' + parent)
    const inset = n.reduce<number>((sum,v,i) => sum + Math.abs(v)*extent(b,i)*.12, 0)
    const created = between(id, vec(i => anchor[i]-n[i]*inset), vec(i => anchor[i]+n[i]*reach), [span,depth], tone, 'arch')
    inheritJoint(created, parent)
    return created
  }
  function disc(id: string, parent: string, face: Surface, diameter: number, depth: number, tone: ArtTone, offset: Vec3 = origin, shape: 'cylinder' | 'ring' = 'cylinder') {
    if (!(depth > 0 && Number.isFinite(depth))) throw new RangeError('Invalid disc depth for ' + id)
    const anchor = point(parent,face,offset), n = normals[face]
    const created = between(id, vec(i => anchor[i]-n[i]*depth*.12), vec(i => anchor[i]+n[i]*depth*.88), diameter, tone, shape)
    inheritJoint(created, parent)
    return created
  }

  /** Define a rig joint in model space (optionally parented to an earlier joint). */
  function joint(id: string, parent?: string, pivot?: Vec3) {
    if (!isSafeArtKey(id) || jointIds.has(id)) throw new Error('Each joint needs a unique valid id: ' + id)
    if (parent !== undefined && (!isSafeArtKey(parent) || !jointIds.has(parent))) {
      throw new Error('Unknown parent joint ' + parent)
    }
    if (pivot !== undefined) checkVector(pivot, id)
    const entry: ArtRecipeJoint = { id }
    if (parent !== undefined) entry.parent = parent
    if (pivot !== undefined) entry.pivot = [pivot[0], pivot[1], pivot[2]]
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
  /** Define or replace a named animation clip on the rig. */
  function clip(clipName: string, clipDef: ArtRecipeClip) {
    checkArtClip(clipDef, clipName, jointIds, name)
    clips[clipName] = structuredClone(clipDef)
    autoGroundClips.delete(clipName)
    return clipName
  }

  function finish(): ArtRecipe {
    const raw: ArtRecipe = {
      format: 'ridgetop-art', version: 1, name, palette: {}, parts, frameSize, centerY: 0, span: 1,
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
  return { solid, point, attach, between, handle, disc, adjust, remove, joint, bind, clip, finish }
}
