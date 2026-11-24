import { artPalette, artShapes, checkFrameSize, modelFromArtRecipe } from './art-recipe.ts'
import type { ArtPart, ArtRecipe, ArtRecipePart, ArtShape, ArtTone } from './art-recipe.ts'
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

/** Center the footprint, ground the lowest vertex, and frame all eight sprite directions. */
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
  const cx = (bounds.min[0] + bounds.max[0]) / 2, floor = bounds.min[1], cz = (bounds.min[2] + bounds.max[2]) / 2
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
  const timings = reference?.timings && { ...reference.timings }
  if (reference) {
    if (base !== 'empty' || proportions.some(n => n !== 1)) throw new Error('Choose either a reference or a scaled starter body')
    const model = modelFromArtRecipe(reference)
    parts.push(...structuredClone(reference.parts))
    model.parts.forEach(part => placed.set(part.name, artPartBounds(part)))
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
    if ((face as string) === 'center') throw new Error('Attach requires a surface face, not center')
    checkVector(size, id, true)
    const anchor = point(parent, face, offset)
    return solid(id, shape, size, tone, vec(i => anchor[i]+normals[face][i]*size[i]*.42), origin, unlit)
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
    const inset = n.reduce<number>((sum,v,i) => sum + Math.abs(v)*extent(b,i)*.12, 0)
    return between(id, vec(i => anchor[i]-n[i]*inset), vec(i => anchor[i]+n[i]*reach), [span,depth], tone, 'arch')
  }
  function disc(id: string, parent: string, face: Surface, diameter: number, depth: number, tone: ArtTone, offset: Vec3 = origin, shape: 'cylinder' | 'ring' = 'cylinder') {
    if (!(depth > 0 && Number.isFinite(depth))) throw new RangeError('Invalid disc depth for ' + id)
    const anchor = point(parent,face,offset), n = normals[face]
    return between(id, vec(i => anchor[i]-n[i]*depth*.12), vec(i => anchor[i]+n[i]*depth*.88), diameter, tone, shape)
  }
  function finish(): ArtRecipe {
    return fitArtRecipe({ format: 'ridgetop-art', version: 1, name, palette: {}, parts, frameSize, centerY: 0, span: 1,
      ...(timings && { timings }) })
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
  }
  return { solid, point, attach, between, handle, disc, adjust, remove, finish }
}
