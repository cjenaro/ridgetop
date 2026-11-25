import { createMeshPool, createRig, renderRig } from './animation.ts'
import type { JointPose, Rig, RigJoint, RigPart } from './animation.ts'
import { bakeVertexAO, box, mesh, multiply, perspective, quaternionFromEuler, rotateVec3, shadowDisc, view } from './geometry.ts'
import { renderMeshPixels } from './low-poly.ts'
import { color as parseHexColor } from './renderer.ts'
import type { Color, LightingOptions, Mesh, Vec3 } from './types.ts'

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value
}

/** Resolve a Color tuple or hex string (`#rgb`, `#rrggbb`, `#rrggbbaa`) into an RGBA Color. */
function resolveColor(input: Color | string): Color {
  if (typeof input === 'string') return parseHexColor(input)
  return [clamp01(input[0]), clamp01(input[1]), clamp01(input[2]), clamp01(input[3])]
}

/** Lighten (`delta > 0`) or darken (`delta < 0`) an RGBA color while preserving alpha. */
export function shadeColor(base: Color, delta: number): Color {
  const safe = Number.isFinite(delta) ? delta : 0
  return [
    clamp01(base[0] + safe),
    clamp01(base[1] + safe),
    clamp01(base[2] + safe),
    base[3]
  ]
}

/** Blend two RGBA colors linearly (`0 = a`, `1 = b`). */
export function mixColor(a: Color, b: Color, t: number): Color {
  const u = clamp01(Number.isFinite(t) ? t : 0)
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
    a[3] + (b[3] - a[3]) * u
  ]
}

// ---------------------------------------------------------------------------
// Flat-faceted lofted geometry & multi-zone per-face color baking
// ---------------------------------------------------------------------------

/** Parametric horizontal cross-section ring for `sculptLoft`. */
export interface SculptLoftParamRing {
  readonly y: number
  readonly rx: number
  readonly rz: number
  readonly xOffset?: number
  readonly zOffset?: number
  /** Flatten the +Z front side toward `zOffset + rz * (1 - frontFlat)` (0..0.6). */
  readonly frontFlat?: number
  /** Flatten the -Z back side toward `zOffset - rz * (1 - backFlat)` (0..0.6). */
  readonly backFlat?: number
  /** Pinch +/-X sides inward (`> 0`) or push outward (`< 0`). */
  readonly sidePinch?: number
  /** Uniform scale multiplier applied to `rx` and `rz` of this ring. */
  readonly topScale?: number
  /** Optional angular phase offset in radians. */
  readonly angleOffset?: number
}

/** Explicit 2D `[x, z]` polygon cross-section ring for `sculptLoft`. */
export interface SculptLoftPolygonRing {
  readonly y: number
  readonly points: readonly (readonly [number, number])[]
}

export type SculptLoftRing = SculptLoftParamRing | SculptLoftPolygonRing

export interface SculptLoftOptions {
  /** Number of sides for parametric rings (default 8 — planar front/back/sides + 45° corner chamfers). */
  readonly sides?: number
  /** Close the bottom ring with a flat cap (default true). */
  readonly capBottom?: boolean
  /** Close the top ring with a flat cap (default true). */
  readonly capTop?: boolean
  /** Optional post-bake vertex ambient occlusion strength (`0` disables, default `0`). */
  readonly aoStrength?: number
  /** Vertical AO gradient when `aoStrength > 0` (default `0.12`). */
  readonly aoGradient?: number
}

function isPolygonRing(ring: SculptLoftRing): ring is SculptLoftPolygonRing {
  return 'points' in ring
}

function signedAreaXZ(pts: readonly (readonly [number, number])[]): number {
  let area2 = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    area2 += a[0] * b[1] - b[0] * a[1]
  }
  return area2
}

function buildRingPoints(ring: SculptLoftRing, sides: number): [number, number][] {
  if (isPolygonRing(ring)) {
    if (ring.points.length < 3) {
      throw new RangeError('sculptLoft polygon rings require at least 3 [x, z] points')
    }
    const pts: [number, number][] = []
    for (let i = 0; i < ring.points.length; i++) {
      const p = ring.points[i]
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
        throw new RangeError('sculptLoft polygon ring points must be finite numbers')
      }
      pts.push([p[0], p[1]])
    }
    // Positive XZ area matches (cos a, sin a) increasing a, giving outward CCW side quads and caps.
    if (signedAreaXZ(pts) < 0) pts.reverse()
    return pts
  }

  const scale = ring.topScale ?? 1
  if (!Number.isFinite(ring.y) || !Number.isFinite(ring.rx) || !Number.isFinite(ring.rz) ||
      !Number.isFinite(scale) || ring.rx < 0 || ring.rz < 0 || scale < 0) {
    throw new RangeError('sculptLoft ring dimensions must be finite and non-negative')
  }
  const rx = ring.rx * scale
  const rz = ring.rz * scale
  const xOff = ring.xOffset ?? 0
  const zOff = ring.zOffset ?? 0
  const frontFlat = Math.max(0, Math.min(0.65, ring.frontFlat ?? 0))
  const backFlat = Math.max(0, Math.min(0.65, ring.backFlat ?? 0))
  const sidePinch = Math.max(-0.5, Math.min(0.5, ring.sidePinch ?? 0))
  const defaultOffset = sides % 2 === 0 ? Math.PI / sides : 0
  const phase = ring.angleOffset ?? defaultOffset
  // Normalize flat-aligned even polygons so rx / rz correspond directly to the flat face half-extents.
  const norm = ring.angleOffset === undefined && sides % 2 === 0 ? 1 / Math.cos(Math.PI / sides) : 1

  const frontLimit = rz * (1 - frontFlat)
  const backLimit = -rz * (1 - backFlat)
  const pts: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + phase
    let x = Math.cos(a) * rx * norm
    let z = Math.sin(a) * rz * norm
    if (rx > 0 && Math.abs(x) > rx) x = Math.sign(x) * rx
    if (rz > 0 && Math.abs(z) > rz) z = Math.sign(z) * rz
    if (frontFlat > 0 && z > frontLimit) z = frontLimit
    if (backFlat > 0 && z < backLimit) z = backLimit
    if (sidePinch !== 0 && rx > 1e-6) {
      const sideWeight = Math.abs(Math.cos(a))
      x *= 1 - sidePinch * sideWeight * sideWeight
    }
    pts.push([x + xOff, z + zOff])
  }
  return pts
}

function pushTriIfValid(
  positions: readonly number[],
  indices: number[],
  i0: number,
  i1: number,
  i2: number
) {
  const a0 = i0 * 3, a1 = i1 * 3, a2 = i2 * 3
  const e1x = positions[a1] - positions[a0]
  const e1y = positions[a1 + 1] - positions[a0 + 1]
  const e1z = positions[a1 + 2] - positions[a0 + 2]
  const e2x = positions[a2] - positions[a0]
  const e2y = positions[a2 + 1] - positions[a0 + 1]
  const e2z = positions[a2 + 2] - positions[a0 + 2]
  const cx = e1y * e2z - e1z * e2y
  const cy = e1z * e2x - e1x * e2z
  const cz = e1x * e2y - e1y * e2x
  if (cx * cx + cy * cy + cz * cz > 1e-14) {
    indices.push(i0, i1, i2)
  }
}

/**
 * Build a flat-faceted lofted low-poly mesh from an ordered sequence of cross-section rings.
 * Supports parametric rings (`rx`, `rz`, `frontFlat`, `backFlat`, `sidePinch`) and custom 2D `[x, z]`
 * polygon rings, with automatic closed bottom/top caps and verified outward CCW winding.
 */
export function sculptLoft(rings: readonly SculptLoftRing[], options: SculptLoftOptions = {}): Mesh {
  if (rings.length < 2) {
    throw new RangeError('sculptLoft requires at least 2 cross-section rings')
  }
  const sides = options.sides ?? 8
  if (!Number.isInteger(sides) || sides < 3 || sides > 64) {
    throw new RangeError('sculptLoft sides must be an integer between 3 and 64')
  }
  const capBottom = options.capBottom ?? true
  const capTop = options.capTop ?? true

  // Ensure bottom-to-top ordering so outward winding is consistent regardless of caller order.
  const ordered: readonly SculptLoftRing[] = rings[0].y <= rings[rings.length - 1].y
    ? rings
    : rings.slice().reverse()

  const ringPts: [number, number][][] = []
  let expectedCount = -1
  for (let r = 0; r < ordered.length; r++) {
    const pts = buildRingPoints(ordered[r], sides)
    if (expectedCount < 0) expectedCount = pts.length
    else if (pts.length !== expectedCount) {
      throw new RangeError('All rings passed to sculptLoft must have the same vertex count')
    }
    ringPts.push(pts)
  }

  const n = expectedCount
  const positions: number[] = []
  const indices: number[] = []

  for (let r = 0; r < ordered.length; r++) {
    const y = ordered[r].y
    const pts = ringPts[r]
    for (let i = 0; i < n; i++) {
      positions.push(pts[i][0], y, pts[i][1])
    }
  }

  for (let r = 0; r < ordered.length - 1; r++) {
    const base0 = r * n
    const base1 = (r + 1) * n
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n
      const a0 = base0 + i
      const b0 = base0 + next
      const a1 = base1 + i
      const b1 = base1 + next
      pushTriIfValid(positions, indices, a0, a1, b0)
      pushTriIfValid(positions, indices, b0, a1, b1)
    }
  }

  if (capBottom) {
    const pts = ringPts[0]
    let cx = 0, cz = 0
    for (let i = 0; i < n; i++) { cx += pts[i][0]; cz += pts[i][1] }
    const centerIdx = positions.length / 3
    positions.push(cx / n, ordered[0].y, cz / n)
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n
      pushTriIfValid(positions, indices, centerIdx, i, next)
    }
  }

  if (capTop) {
    const lastRing = ordered.length - 1
    const base = lastRing * n
    const pts = ringPts[lastRing]
    let cx = 0, cz = 0
    for (let i = 0; i < n; i++) { cx += pts[i][0]; cz += pts[i][1] }
    const centerIdx = positions.length / 3
    positions.push(cx / n, ordered[lastRing].y, cz / n)
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n
      pushTriIfValid(positions, indices, centerIdx, base + next, base + i)
    }
  }

  const built = mesh(positions, indices)
  const aoStrength = options.aoStrength ?? 0
  if (aoStrength > 0) {
    return bakeVertexAO(built, { strength: aoStrength, verticalGradient: options.aoGradient ?? 0.12 })
  }
  return built
}

/**
 * Bake per-triangle zone colors onto a mesh so a single draw call can carry subtle face zones
 * (cheek warmth, under-chin shadow, tunic trim, boot soles) across all Ridgetop backends.
 * Multiplies into existing `source.colors` when present.
 */
export function bakeZoneColors(
  source: Mesh,
  colorForTri: (cx: number, cy: number, cz: number, nx: number, ny: number, nz: number) => Color
): Mesh {
  const n = source.vertexCount
  const data = source.data
  const existing = source.colors && source.colors.length >= n * 3 ? source.colors : undefined
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i += 3) {
    const o0 = i * 6
    const o1 = (i + 1) * 6
    const o2 = (i + 2) * 6
    const cx = (data[o0] + data[o1] + data[o2]) / 3
    const cy = (data[o0 + 1] + data[o1 + 1] + data[o2 + 1]) / 3
    const cz = (data[o0 + 2] + data[o1 + 2] + data[o2 + 2]) / 3
    const nx = data[o0 + 3]
    const ny = data[o0 + 4]
    const nz = data[o0 + 5]
    const c = colorForTri(cx, cy, cz, nx, ny, nz)
    const r = clamp01(c[0])
    const g = clamp01(c[1])
    const b = clamp01(c[2])
    for (let k = 0; k < 3; k++) {
      const ci = (i + k) * 3
      out[ci] = existing ? existing[ci] * r : r
      out[ci + 1] = existing ? existing[ci + 1] * g : g
      out[ci + 2] = existing ? existing[ci + 2] * b : b
    }
  }
  return { data: source.data, colors: out, vertexCount: n, radius: source.radius }
}

// ---------------------------------------------------------------------------
// Palette & Socket contracts
// ---------------------------------------------------------------------------

export type CharacterPaletteRole =
  | 'skin'
  | 'skinShade'
  | 'hair'
  | 'hairShade'
  | 'eye'
  | 'primary'
  | 'primaryDark'
  | 'secondary'
  | 'metal'
  | 'metalDark'
  | 'leather'
  | 'leatherLight'
  | 'accent'
  | 'glow'

export type CharacterPalette = Record<CharacterPaletteRole, Color>

export const DEFAULT_CHARACTER_PALETTE: Readonly<CharacterPalette> = {
  skin: [0.95, 0.78, 0.65, 1],
  skinShade: [0.80, 0.60, 0.49, 1],
  hair: [0.56, 0.30, 0.17, 1],
  hairShade: [0.38, 0.19, 0.11, 1],
  eye: [0.14, 0.12, 0.16, 1],
  primary: [0.27, 0.56, 0.57, 1],
  primaryDark: [0.18, 0.36, 0.40, 1],
  secondary: [0.84, 0.76, 0.62, 1],
  metal: [0.68, 0.73, 0.80, 1],
  metalDark: [0.40, 0.45, 0.54, 1],
  leather: [0.43, 0.28, 0.21, 1],
  leatherLight: [0.62, 0.44, 0.31, 1],
  accent: [0.88, 0.69, 0.28, 1],
  glow: [0.55, 0.86, 0.98, 1]
}

/**
 * Create a complete CharacterPalette from partial Color or hex overrides.
 * Automatically derives matching shadow/dark/light tones when only base roles are supplied.
 */
export function createCharacterPalette(
  overrides?: Partial<Record<CharacterPaletteRole, Color | string>>
): CharacterPalette {
  const skin = overrides?.skin !== undefined ? resolveColor(overrides.skin) : DEFAULT_CHARACTER_PALETTE.skin
  const hair = overrides?.hair !== undefined ? resolveColor(overrides.hair) : DEFAULT_CHARACTER_PALETTE.hair
  const primary = overrides?.primary !== undefined ? resolveColor(overrides.primary) : DEFAULT_CHARACTER_PALETTE.primary
  const metal = overrides?.metal !== undefined ? resolveColor(overrides.metal) : DEFAULT_CHARACTER_PALETTE.metal
  const leather = overrides?.leather !== undefined ? resolveColor(overrides.leather) : DEFAULT_CHARACTER_PALETTE.leather

  return {
    skin,
    skinShade: overrides?.skinShade !== undefined
      ? resolveColor(overrides.skinShade)
      : (overrides?.skin !== undefined ? shadeColor(skin, -0.15) : DEFAULT_CHARACTER_PALETTE.skinShade),
    hair,
    hairShade: overrides?.hairShade !== undefined
      ? resolveColor(overrides.hairShade)
      : (overrides?.hair !== undefined ? shadeColor(hair, -0.16) : DEFAULT_CHARACTER_PALETTE.hairShade),
    eye: overrides?.eye !== undefined ? resolveColor(overrides.eye) : DEFAULT_CHARACTER_PALETTE.eye,
    primary,
    primaryDark: overrides?.primaryDark !== undefined
      ? resolveColor(overrides.primaryDark)
      : (overrides?.primary !== undefined ? shadeColor(primary, -0.16) : DEFAULT_CHARACTER_PALETTE.primaryDark),
    secondary: overrides?.secondary !== undefined ? resolveColor(overrides.secondary) : DEFAULT_CHARACTER_PALETTE.secondary,
    metal,
    metalDark: overrides?.metalDark !== undefined
      ? resolveColor(overrides.metalDark)
      : (overrides?.metal !== undefined ? shadeColor(metal, -0.24) : DEFAULT_CHARACTER_PALETTE.metalDark),
    leather,
    leatherLight: overrides?.leatherLight !== undefined
      ? resolveColor(overrides.leatherLight)
      : (overrides?.leather !== undefined ? shadeColor(leather, 0.16) : DEFAULT_CHARACTER_PALETTE.leatherLight),
    accent: overrides?.accent !== undefined ? resolveColor(overrides.accent) : DEFAULT_CHARACTER_PALETTE.accent,
    glow: overrides?.glow !== undefined ? resolveColor(overrides.glow) : DEFAULT_CHARACTER_PALETTE.glow
  }
}

export type CharacterJointId = 'root' | 'body' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'cape'

export type CharacterSocket =
  | 'face'
  | 'brows'
  | 'ears'
  | 'hair'
  | 'beard'
  | 'headgear'
  | 'chest'
  | 'collar'
  | 'pauldrons'
  | 'belt'
  | 'skirt'
  | 'back'
  | 'bracerL'
  | 'bracerR'
  | 'bootL'
  | 'bootR'
  | 'mainHand'
  | 'offHand'

export interface CharacterSocketInfo {
  readonly joint: CharacterJointId
  /** Local offset relative to `joint` added to parts attached to this socket. */
  readonly anchor: Vec3
  /** Reference world-space position of the socket in rest pose (feet at `y = 0`). */
  readonly worldAnchor: Vec3
}

/** Standard joint pivots for the ~1.62-tall Ridgetop stylized character mannequin. */
export const CHARACTER_JOINT_PIVOTS: Readonly<Record<CharacterJointId, Vec3>> = {
  root: [0, 0, 0],
  body: [0, 0.50, 0],
  head: [0, 0.50, 0],
  armL: [-0.30, 0.40, 0],
  armR: [0.30, 0.40, 0],
  legL: [-0.115, 0.50, 0],
  legR: [0.115, 0.50, 0],
  cape: [0, 0.42, -0.15]
}

/**
 * Exact socket-to-joint anchor table. Parts registered for a socket are authored in
 * socket-local coordinates (`[0, 0, 0]` is directly at the socket anchor).
 */
export const CHARACTER_SOCKETS: Readonly<Record<CharacterSocket, CharacterSocketInfo>> = {
  face:      { joint: 'head', anchor: [0, 0.30, 0.220],   worldAnchor: [0, 1.30, 0.220] },
  brows:     { joint: 'head', anchor: [0, 0.365, 0.226],  worldAnchor: [0, 1.365, 0.226] },
  ears:      { joint: 'head', anchor: [0, 0.265, -0.008], worldAnchor: [0, 1.265, -0.008] },
  hair:      { joint: 'head', anchor: [0, 0.28, 0],       worldAnchor: [0, 1.28, 0] },
  beard:     { joint: 'head', anchor: [0, 0.135, 0.205],  worldAnchor: [0, 1.135, 0.205] },
  headgear:  { joint: 'head', anchor: [0, 0.455, 0],      worldAnchor: [0, 1.455, 0] },
  chest:     { joint: 'body', anchor: [0, 0.25, 0],       worldAnchor: [0, 0.75, 0] },
  collar:    { joint: 'body', anchor: [0, 0.46, 0],       worldAnchor: [0, 0.96, 0] },
  pauldrons: { joint: 'body', anchor: [0, 0.40, 0],       worldAnchor: [0, 0.90, 0] },
  belt:      { joint: 'body', anchor: [0, 0.13, 0],       worldAnchor: [0, 0.63, 0] },
  skirt:     { joint: 'body', anchor: [0, 0.08, 0],       worldAnchor: [0, 0.58, 0] },
  back:      { joint: 'cape', anchor: [0, 0, 0],          worldAnchor: [0, 0.92, -0.15] },
  bracerL:   { joint: 'armL', anchor: [-0.018, -0.28, 0.010], worldAnchor: [-0.318, 0.62, 0.010] },
  bracerR:   { joint: 'armR', anchor: [0.018, -0.28, 0.010],  worldAnchor: [0.318, 0.62, 0.010] },
  bootL:     { joint: 'legL', anchor: [0, -0.34, 0],      worldAnchor: [-0.115, 0.16, 0] },
  bootR:     { joint: 'legR', anchor: [0, -0.34, 0],      worldAnchor: [0.115, 0.16, 0] },
  mainHand:  { joint: 'armR', anchor: [0.028, -0.43, 0.036], worldAnchor: [0.328, 0.47, 0.036] },
  offHand:   { joint: 'armL', anchor: [-0.028, -0.43, 0.036], worldAnchor: [-0.328, 0.47, 0.036] }
}

export type CharacterBodyFactory = (palette: CharacterPalette) => Record<string, RigPart[]>
export type CharacterPartFactory = (palette: CharacterPalette) => RigPart[]

export interface CharacterSpec {
  readonly body?: string
  readonly palette?: Partial<Record<CharacterPaletteRole, Color | string>>
  readonly parts?: Partial<Record<CharacterSocket, string>>
  /** Optional uniform scale baked into the assembled character's joint pivots and part scales (default 1). */
  readonly scale?: number
  /** Merge opaque parts sharing a joint into one vertex-colored mesh per lighting bucket to minimize draw calls (default true). */
  readonly mergeJointMeshes?: boolean
  /** Optional debug/testing label for the created Rig. */
  readonly label?: string
}

export interface CharacterBuilder {
  readonly sockets: Readonly<Record<CharacterSocket, CharacterSocketInfo>>
  registerBody(id: string, factory: CharacterBodyFactory): void
  registerPart(socket: CharacterSocket, id: string, factory: CharacterPartFactory): void
  hasBody(id: string): boolean
  hasPart(socket: CharacterSocket, id: string): boolean
  listBodies(): string[]
  listParts(socket: CharacterSocket): string[]
  assemble(spec?: CharacterSpec): Rig
}

// ---------------------------------------------------------------------------
// Sculpted Base Mannequin Meshes (cached at module level for zero-cost reuse)
// ---------------------------------------------------------------------------

const WHITE: Color = [1, 1, 1, 1]

interface MannequinProfile {
  readonly torsoWidth: number
  readonly waistWidth: number
  readonly torsoDepth: number
  readonly armThick: number
  readonly legThick: number
}

interface MannequinMeshes {
  readonly head: Mesh
  readonly eyeBlock: Mesh
  readonly noseWedge: Mesh
  readonly earL: Mesh
  readonly earR: Mesh
  readonly neck: Mesh
  readonly torsoUpper: Mesh
  readonly pelvis: Mesh
  readonly armL: Mesh
  readonly armR: Mesh
  readonly handL: Mesh
  readonly handR: Mesh
  readonly thumbL: Mesh
  readonly thumbR: Mesh
  readonly thigh: Mesh
  readonly bootCuff: Mesh
  readonly bootFoot: Mesh
}

function createArmLoft(side: -1 | 1, thick: number): Mesh {
  // Sloped chiseled deltoid tucking smoothly into torso shoulder -> tapered upper arm -> faceted forearm
  return sculptLoft([
    { y: -0.345, rx: 0.048 * thick, rz: 0.052 * thick, xOffset: side * 0.024, zOffset: 0.014 },
    { y: -0.245, rx: 0.064 * thick, rz: 0.068 * thick, xOffset: side * 0.018, zOffset: 0.008 },
    { y: -0.155, rx: 0.056 * thick, rz: 0.060 * thick, xOffset: side * 0.008, zOffset: 0.002 },
    { y: -0.055, rx: 0.072 * thick, rz: 0.074 * thick, xOffset: -side * 0.008, zOffset: 0.000 },
    { y:  0.018, rx: 0.068 * thick, rz: 0.070 * thick, xOffset: -side * 0.036, zOffset: 0.000 },
    { y:  0.052, rx: 0.044 * thick, rz: 0.050 * thick, xOffset: -side * 0.064, zOffset: 0.000 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.10 })
}

function createHandLoft(side: -1 | 1, thick: number): Mesh {
  // Iconic chiseled polygonal action-figure hand wedge (flat inward palm, faceted knuckles, angled point)
  return sculptLoft([
    { y: -0.502, rx: 0.022 * thick, rz: 0.030 * thick, xOffset: side * 0.020, zOffset: 0.032 },
    { y: -0.464, rx: 0.044 * thick, rz: 0.062 * thick, xOffset: side * 0.028, zOffset: 0.034 },
    { y: -0.405, rx: 0.058 * thick, rz: 0.074 * thick, xOffset: side * 0.030, zOffset: 0.026, frontFlat: 0.08 },
    { y: -0.340, rx: 0.050 * thick, rz: 0.054 * thick, xOffset: side * 0.024, zOffset: 0.015 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })
}

function createThumbLoft(side: -1 | 1, thick: number): Mesh {
  return sculptLoft([
    { y: -0.445, rx: 0.015 * thick, rz: 0.020 * thick, xOffset: -side * 0.004, zOffset: 0.072 },
    { y: -0.408, rx: 0.022 * thick, rz: 0.028 * thick, xOffset: side * 0.006, zOffset: 0.060 },
    { y: -0.370, rx: 0.022 * thick, rz: 0.024 * thick, xOffset: side * 0.018, zOffset: 0.044 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.08 })
}

function createEarLoft(side: -1 | 1): Mesh {
  return sculptLoft([
    { y: 0.220, rx: 0.022, rz: 0.034, xOffset: side * 0.236, zOffset: -0.016 },
    { y: 0.265, rx: 0.036, rz: 0.048, xOffset: side * 0.246, zOffset: -0.020 },
    { y: 0.315, rx: 0.032, rz: 0.042, xOffset: side * 0.242, zOffset: -0.016 },
    { y: 0.335, rx: 0.016, rz: 0.024, xOffset: side * 0.232, zOffset: -0.012 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.10 })
}

function buildMannequinMeshes(profile: MannequinProfile): MannequinMeshes {
  // Bold 5-ring chiseled 8-sided anatomical head:
  // Broad clean flat front face plane, crisp 45° cheek/temple chamfers, strong tapered heroic jaw & chin.
  const rawHead = sculptLoft([
    { y: 0.000, rx: 0.122, rz: 0.138, zOffset: 0.018, frontFlat: 0.10 },
    { y: 0.135, rx: 0.232, rz: 0.212, zOffset: 0.012, frontFlat: 0.08 },
    { y: 0.375, rx: 0.248, rz: 0.222, zOffset: 0.010, frontFlat: 0.08 },
    { y: 0.515, rx: 0.242, rz: 0.216, zOffset: 0.000, frontFlat: 0.06 },
    { y: 0.585, rx: 0.172, rz: 0.160, zOffset: -0.008, frontFlat: 0.04 },
    { y: 0.610, rx: 0.098, rz: 0.092, zOffset: -0.012 }
  ], { sides: 8 })

  // Subtle per-face tint multipliers: crisp under-jaw shadow & soft cheek warmth without striping the front face.
  const zonedHead = bakeZoneColors(rawHead, (cx, cy, cz, _nx, ny, nz) => {
    if (ny < -0.35 && cy < 0.14) return [0.88, 0.81, 0.80, 1]
    if (cy > 0.15 && cy < 0.26 && cz > 0.14 && Math.abs(cx) > 0.07 && nz > 0.35) return [1.0, 0.94, 0.92, 1]
    return WHITE
  })
  const head = bakeVertexAO(zonedHead, { strength: 0.14, verticalGradient: 0.08 })

  // Crisp horizontal faceted eye blocks (classic collectible low-poly readability)
  const eyeBlock = sculptLoft([
    { y: -0.022, rx: 0.040, rz: 0.014 },
    { y:  0.000, rx: 0.042, rz: 0.016 },
    { y:  0.022, rx: 0.040, rz: 0.013 }
  ], { sides: 6, aoStrength: 0.08, aoGradient: 0.04 })

  // Ultra-subtle chiseled chin/mouth accent plane (kept flat & understated so face reads clean like vinyl miniatures)
  const noseWedge = sculptLoft([
    { y: -0.014, rx: 0.036, rz: 0.008 },
    { y:  0.000, rx: 0.042, rz: 0.010 },
    { y:  0.014, rx: 0.036, rz: 0.008 }
  ], { sides: 6, aoStrength: 0.06, aoGradient: 0.04 })

  const neck = sculptLoft([
    { y: 0.435, rx: 0.112 * profile.torsoWidth, rz: 0.102 * profile.torsoDepth },
    { y: 0.485, rx: 0.098, rz: 0.094 },
    { y: 0.535, rx: 0.092, rz: 0.088 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  // Heroic V-tapered upper torso flowing cleanly into the shoulder caps
  const tw = profile.torsoWidth
  const ww = profile.waistWidth
  const td = profile.torsoDepth
  const rawTorsoUpper = sculptLoft([
    { y: 0.110, rx: 0.172 * ww, rz: 0.120 * td, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.250, rx: 0.218 * tw, rz: 0.144 * td, zOffset: 0.008, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.395, rx: 0.256 * tw, rz: 0.152 * td, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.452, rx: 0.218 * tw, rz: 0.130 * td, zOffset: 0.000 },
    { y: 0.478, rx: 0.145 * tw, rz: 0.106 * td, zOffset: 0.000 }
  ], { sides: 8 })
  const torsoUpper = bakeVertexAO(rawTorsoUpper, { strength: 0.15, verticalGradient: 0.10 })

  // Grounded pelvis / athletic trunks block (y=-0.025..0.135)
  const pelvis = sculptLoft([
    { y: -0.025, rx: 0.146 * ww, rz: 0.106 * td },
    { y:  0.042, rx: 0.208 * ww, rz: 0.136 * td, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.132, rx: 0.178 * ww, rz: 0.124 * td, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const lt = profile.legThick
  const thigh = sculptLoft([
    { y: -0.320, rx: 0.056 * lt, rz: 0.062 * lt },
    { y: -0.200, rx: 0.066 * lt, rz: 0.072 * lt },
    { y: -0.080, rx: 0.078 * lt, rz: 0.084 * lt },
    { y:  0.025, rx: 0.082 * lt, rz: 0.086 * lt }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const bootCuff = sculptLoft([
    { y: -0.340, rx: 0.066 * lt, rz: 0.072 * lt },
    { y: -0.322, rx: 0.080 * lt, rz: 0.086 * lt },
    { y: -0.260, rx: 0.086 * lt, rz: 0.092 * lt }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  // Angled faceted boot shaft + beveled foot planted squarely at local y = -0.500 (world y = 0.000)
  const rawBootFoot = sculptLoft([
    { y: -0.500, rx: 0.070 * lt, rz: 0.114 * lt, zOffset: 0.042, frontFlat: 0.16, backFlat: 0.08 },
    { y: -0.476, rx: 0.074 * lt, rz: 0.118 * lt, zOffset: 0.044, frontFlat: 0.16, backFlat: 0.08 },
    { y: -0.440, rx: 0.070 * lt, rz: 0.104 * lt, zOffset: 0.034, frontFlat: 0.14, backFlat: 0.08 },
    { y: -0.400, rx: 0.064 * lt, rz: 0.076 * lt, zOffset: 0.010 },
    { y: -0.322, rx: 0.064 * lt, rz: 0.070 * lt, zOffset: 0.000 }
  ], { sides: 8 })
  const zonedBoot = bakeZoneColors(rawBootFoot, (_cx, cy) => (
    cy < -0.472 ? [0.74, 0.72, 0.75, 1] : WHITE
  ))
  const bootFoot = bakeVertexAO(zonedBoot, { strength: 0.15, verticalGradient: 0.10 })

  return {
    head,
    eyeBlock,
    noseWedge,
    earL: createEarLoft(-1),
    earR: createEarLoft(1),
    neck,
    torsoUpper,
    pelvis,
    armL: createArmLoft(-1, profile.armThick),
    armR: createArmLoft(1, profile.armThick),
    handL: createHandLoft(-1, profile.armThick),
    handR: createHandLoft(1, profile.armThick),
    thumbL: createThumbLoft(-1, profile.armThick),
    thumbR: createThumbLoft(1, profile.armThick),
    thigh,
    bootCuff,
    bootFoot
  }
}

const mannequinMeshCache = new Map<string, MannequinMeshes>()

function getMannequinMeshes(key: string, profile: MannequinProfile): MannequinMeshes {
  let cached = mannequinMeshCache.get(key)
  if (!cached) {
    cached = buildMannequinMeshes(profile)
    mannequinMeshCache.set(key, cached)
  }
  return cached
}

function createHumanoidBodyFactory(key: string, profile: MannequinProfile): CharacterBodyFactory {
  return (palette: CharacterPalette): Record<string, RigPart[]> => {
    const m = getMannequinMeshes(key, profile)
    const eyelidShade = mixColor(palette.skin, palette.skinShade, 0.55)
    const lipTint = mixColor(palette.skin, [0.88, 0.58, 0.50, 1], 0.32)
    return {
      head: [
        { name: 'head_skull', mesh: m.head, color: palette.skin },
        { name: 'head_ear_l', mesh: m.earL, color: palette.skin },
        { name: 'head_ear_r', mesh: m.earR, color: palette.skin },
        { name: 'head_mouth_hint', mesh: m.noseWedge, position: [0, 0.145, 0.197], color: lipTint },
        { name: 'head_eye_l', mesh: m.eyeBlock, position: [-0.098, 0.304, 0.206], color: palette.eye },
        { name: 'head_eye_r', mesh: m.eyeBlock, position: [0.098, 0.304, 0.206], color: palette.eye },
        { name: 'head_lid_l', mesh: box, position: [-0.098, 0.330, 0.212], scale: [0.088, 0.014, 0.018], color: eyelidShade },
        { name: 'head_lid_r', mesh: box, position: [0.098, 0.330, 0.212], scale: [0.088, 0.014, 0.018], color: eyelidShade }
      ],
      body: [
        { name: 'body_neck', mesh: m.neck, color: palette.skinShade },
        { name: 'body_torso', mesh: m.torsoUpper, color: palette.skin },
        { name: 'body_pelvis', mesh: m.pelvis, color: palette.primaryDark }
      ],
      armL: [
        { name: 'arm_l_limb', mesh: m.armL, color: palette.skin },
        { name: 'arm_l_hand', mesh: m.handL, color: palette.skin },
        { name: 'arm_l_thumb', mesh: m.thumbL, color: palette.skin }
      ],
      armR: [
        { name: 'arm_r_limb', mesh: m.armR, color: palette.skin },
        { name: 'arm_r_hand', mesh: m.handR, color: palette.skin },
        { name: 'arm_r_thumb', mesh: m.thumbR, color: palette.skin }
      ],
      legL: [
        { name: 'leg_l_thigh', mesh: m.thigh, color: palette.primaryDark },
        { name: 'leg_l_cuff', mesh: m.bootCuff, color: palette.leatherLight },
        { name: 'leg_l_boot', mesh: m.bootFoot, color: palette.leather }
      ],
      legR: [
        { name: 'leg_r_thigh', mesh: m.thigh, color: palette.primaryDark },
        { name: 'leg_r_cuff', mesh: m.bootCuff, color: palette.leatherLight },
        { name: 'leg_r_boot', mesh: m.bootFoot, color: palette.leather }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Built-in Starter Parts (generic, ready out-of-the-box)
// ---------------------------------------------------------------------------

interface StarterMeshes {
  readonly tunicBody: Mesh
  readonly tunicHem: Mesh
  readonly tunicCollar: Mesh
  readonly beltBand: Mesh
  readonly beltBuckleOuter: Mesh
  readonly beltBuckleInner: Mesh
  readonly hairCrown: Mesh
  readonly hairBangMain: Mesh
  readonly hairBangSideL: Mesh
  readonly hairBangSideR: Mesh
  readonly hairNape: Mesh
  readonly hairTopCrest: Mesh
  readonly browBlock: Mesh
}

let cachedStarterMeshes: StarterMeshes | undefined

function getStarterMeshes(): StarterMeshes {
  if (cachedStarterMeshes) return cachedStarterMeshes

  // Socket 'chest' anchor is [0, 0.25, 0] on body (torso spans -0.25..+0.228 in socket-local Y)
  const rawTunic = sculptLoft([
    { y: -0.205, rx: 0.232, rz: 0.158, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.118, rx: 0.196, rz: 0.140, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.008, rx: 0.238, rz: 0.164, zOffset: 0.008, frontFlat: 0.08, backFlat: 0.08 },
    { y:  0.152, rx: 0.278, rz: 0.172, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.214, rx: 0.242, rz: 0.150, zOffset: 0.000 },
    { y:  0.242, rx: 0.156, rz: 0.124, zOffset: 0.000 }
  ], { sides: 8 })
  const zonedTunic = bakeZoneColors(rawTunic, (cx, cy, cz, _nx, _ny, nz) => {
    if (cy < -0.12) return [0.90, 0.90, 0.92, 1]
    if (nz > 0.5 && cz > 0.10 && Math.abs(cx) < 0.09 && cy > 0.08) return [1.06, 1.05, 1.04, 1]
    return WHITE
  })
  const tunicBody = bakeVertexAO(zonedTunic, { strength: 0.15, verticalGradient: 0.10 })

  // Lower tunic trim band (secondary accent color)
  const tunicHem = sculptLoft([
    { y: -0.245, rx: 0.242, rz: 0.166, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.198, rx: 0.236, rz: 0.162, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.08 })

  // Crisp folded collar trim sitting cleanly around neck base (zero z-fighting with torso plateau)
  const tunicCollar = sculptLoft([
    { y: 0.228, rx: 0.168, rz: 0.136, zOffset: 0.006, frontFlat: 0.12 },
    { y: 0.254, rx: 0.142, rz: 0.118, zOffset: 0.002, frontFlat: 0.10 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.08 })

  // Socket 'belt' anchor is [0, 0.13, 0] on body (cinched waist)
  const beltBand = sculptLoft([
    { y: -0.048, rx: 0.216, rz: 0.156, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.000, rx: 0.220, rz: 0.160, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.048, rx: 0.216, rz: 0.156, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  // Faceted octagonal buckle on front of belt (+Z)
  const beltBuckleOuter = sculptLoft([
    { y: -0.056, rx: 0.048, rz: 0.022 },
    { y: -0.024, rx: 0.066, rz: 0.026 },
    { y:  0.024, rx: 0.066, rz: 0.026 },
    { y:  0.056, rx: 0.048, rz: 0.022 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const beltBuckleInner = sculptLoft([
    { y: -0.034, rx: 0.034, rz: 0.016 },
    { y:  0.000, rx: 0.044, rz: 0.018 },
    { y:  0.034, rx: 0.034, rz: 0.016 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  // Socket 'hair' anchor is [0, 0.28, 0] on head (head spans -0.28..+0.33 in socket-local Y)
  // Cohesive sculpted hair hugging the cranium smoothly from every angle (zero detached back slabs!)
  const hairCrown = sculptLoft([
    { y: 0.135, rx: 0.264, rz: 0.242, zOffset: -0.008, frontFlat: 0.10, backFlat: 0.06 },
    { y: 0.225, rx: 0.272, rz: 0.248, zOffset: -0.010, frontFlat: 0.08, backFlat: 0.06 },
    { y: 0.305, rx: 0.254, rz: 0.232, zOffset: -0.012, frontFlat: 0.06 },
    { y: 0.362, rx: 0.186, rz: 0.172, zOffset: -0.016 },
    { y: 0.386, rx: 0.106, rz: 0.098, zOffset: -0.018 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  // Sculpted forehead fringe hugging close to the brow line (asymmetrical stylized sweep)
  const hairBangMain = sculptLoft([
    { y: 0.128, rx: 0.132, rz: 0.026, xOffset: -0.040, zOffset: 0.214, frontFlat: 0.14 },
    { y: 0.180, rx: 0.214, rz: 0.036, xOffset: -0.016, zOffset: 0.208, frontFlat: 0.12 },
    { y: 0.252, rx: 0.222, rz: 0.040, xOffset: -0.008, zOffset: 0.192, frontFlat: 0.10 },
    { y: 0.310, rx: 0.150, rz: 0.034, xOffset: 0.000, zOffset: 0.158 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const createSideburn = (side: -1 | 1) => sculptLoft([
    { y: -0.075, rx: 0.024, rz: 0.036, xOffset: side * 0.234, zOffset: 0.046 },
    { y:  0.035, rx: 0.040, rz: 0.068, xOffset: side * 0.248, zOffset: 0.026 },
    { y:  0.145, rx: 0.046, rz: 0.094, xOffset: side * 0.256, zOffset: 0.008 },
    { y:  0.225, rx: 0.042, rz: 0.088, xOffset: side * 0.248, zOffset: -0.004 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  // Integrated back-of-head hair shell hugging flush against the rear skull & tapering cleanly at the nape
  const hairNape = sculptLoft([
    { y: -0.165, rx: 0.150, rz: 0.072, zOffset: -0.128, backFlat: 0.08 },
    { y: -0.040, rx: 0.222, rz: 0.118, zOffset: -0.118, backFlat: 0.06 },
    { y:  0.085, rx: 0.252, rz: 0.142, zOffset: -0.106, backFlat: 0.06 },
    { y:  0.195, rx: 0.262, rz: 0.152, zOffset: -0.096 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  // Subtle sculpted top hair volume / swept tuft
  const hairTopCrest = sculptLoft([
    { y: 0.320, rx: 0.145, rz: 0.178, xOffset: 0.012, zOffset: -0.004 },
    { y: 0.388, rx: 0.118, rz: 0.152, xOffset: 0.018, zOffset: 0.008 },
    { y: 0.425, rx: 0.056, rz: 0.088, xOffset: 0.014, zOffset: 0.006 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const browBlock = sculptLoft([
    { y: -0.020, rx: 0.056, rz: 0.020 },
    { y:  0.002, rx: 0.062, rz: 0.024 },
    { y:  0.022, rx: 0.054, rz: 0.018 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  cachedStarterMeshes = {
    tunicBody,
    tunicHem,
    tunicCollar,
    beltBand,
    beltBuckleOuter,
    beltBuckleInner,
    hairCrown,
    hairBangMain,
    hairBangSideL: createSideburn(-1),
    hairBangSideR: createSideburn(1),
    hairNape,
    hairTopCrest,
    browBlock
  }
  return cachedStarterMeshes
}

function registerDefaultBodiesAndParts(builder: CharacterBuilder) {
  builder.registerBody('humanoid', createHumanoidBodyFactory('humanoid', {
    torsoWidth: 1.0,
    waistWidth: 1.0,
    torsoDepth: 1.0,
    armThick: 1.0,
    legThick: 1.0
  }))
  builder.registerBody('humanoid_slim', createHumanoidBodyFactory('humanoid_slim', {
    torsoWidth: 0.90,
    waistWidth: 0.88,
    torsoDepth: 0.94,
    armThick: 0.90,
    legThick: 0.94
  }))
  builder.registerBody('humanoid_broad', createHumanoidBodyFactory('humanoid_broad', {
    torsoWidth: 1.12,
    waistWidth: 1.08,
    torsoDepth: 1.08,
    armThick: 1.12,
    legThick: 1.08
  }))

  builder.registerPart('chest', 'tunic_basic', (palette) => {
    const m = getStarterMeshes()
    return [
      { name: 'tunic_body', mesh: m.tunicBody, color: palette.primary },
      { name: 'tunic_hem', mesh: m.tunicHem, color: palette.secondary },
      { name: 'tunic_collar', mesh: m.tunicCollar, color: palette.primaryDark }
    ]
  })

  builder.registerPart('belt', 'belt_basic', (palette) => {
    const m = getStarterMeshes()
    return [
      { name: 'belt_strap', mesh: m.beltBand, color: palette.leather },
      { name: 'belt_buckle_outer', mesh: m.beltBuckleOuter, position: [0, 0, 0.148], color: palette.metal },
      { name: 'belt_buckle_inner', mesh: m.beltBuckleInner, position: [0, 0, 0.164], color: palette.metalDark }
    ]
  })

  builder.registerPart('hair', 'hair_short', (palette) => {
    const m = getStarterMeshes()
    return [
      { name: 'hair_crown', mesh: m.hairCrown, color: palette.hair },
      { name: 'hair_bangs', mesh: m.hairBangMain, color: palette.hair },
      { name: 'hair_side_l', mesh: m.hairBangSideL, color: palette.hairShade },
      { name: 'hair_side_r', mesh: m.hairBangSideR, color: palette.hairShade },
      { name: 'hair_nape', mesh: m.hairNape, color: palette.hairShade },
      { name: 'hair_crest', mesh: m.hairTopCrest, color: palette.hair }
    ]
  })

  builder.registerPart('brows', 'brows_bold', (palette) => {
    const m = getStarterMeshes()
    return [
      { name: 'brow_l', mesh: m.browBlock, position: [-0.098, 0.002, 0.006], rotation: [0, 0.08, -0.08], color: palette.hair },
      { name: 'brow_r', mesh: m.browBlock, position: [0.098, 0.002, 0.006], rotation: [0, -0.08, 0.08], color: palette.hair }
    ]
  })
}

// ---------------------------------------------------------------------------
// Character Builder Registry & Assembler
// ---------------------------------------------------------------------------

const SOCKET_LIST: readonly CharacterSocket[] = [
  'face', 'brows', 'ears', 'hair', 'beard', 'headgear',
  'chest', 'collar', 'pauldrons', 'belt', 'skirt', 'back',
  'bracerL', 'bracerR', 'bootL', 'bootR', 'mainHand', 'offHand'
]

const JOINT_ORDER: readonly { readonly id: CharacterJointId; readonly parent?: CharacterJointId }[] = [
  { id: 'root' },
  { id: 'body', parent: 'root' },
  { id: 'head', parent: 'body' },
  { id: 'armL', parent: 'body' },
  { id: 'armR', parent: 'body' },
  { id: 'legL', parent: 'root' },
  { id: 'legR', parent: 'root' },
  { id: 'cape', parent: 'body' }
]

function offsetRigPart(part: RigPart, anchor: Vec3, scale: number): RigPart {
  const lp = part.position
  const px = ((lp ? lp[0] : 0) + anchor[0]) * scale
  const py = ((lp ? lp[1] : 0) + anchor[1]) * scale
  const pz = ((lp ? lp[2] : 0) + anchor[2]) * scale
  const ps = part.scale
  const scaled: Vec3 | undefined = scale === 1
    ? ps
    : [
        (ps ? ps[0] : 1) * scale,
        (ps ? ps[1] : 1) * scale,
        (ps ? ps[2] : 1) * scale
      ]
  return {
    name: part.name,
    mesh: part.mesh,
    position: [px, py, pz],
    scale: scaled,
    rotation: part.rotation,
    color: part.color,
    unlit: part.unlit,
    blend: part.blend
  }
}

function scaleBodyPart(part: RigPart, scale: number): RigPart {
  if (scale === 1) return part
  const lp = part.position
  const ps = part.scale
  return {
    name: part.name,
    mesh: part.mesh,
    position: lp ? [lp[0] * scale, lp[1] * scale, lp[2] * scale] : undefined,
    scale: [
      (ps ? ps[0] : 1) * scale,
      (ps ? ps[1] : 1) * scale,
      (ps ? ps[2] : 1) * scale
    ],
    rotation: part.rotation,
    color: part.color,
    unlit: part.unlit,
    blend: part.blend
  }
}

/**
 * Create a modular stylized character builder pre-loaded with sculpted humanoid mannequins
 * (`humanoid`, `humanoid_slim`, `humanoid_broad`) and starter socket parts (`tunic_basic`,
 * `belt_basic`, `hair_short`, `brows_bold`).
 */
export function createCharacterBuilder(): CharacterBuilder {
  const bodies = new Map<string, CharacterBodyFactory>()
  const partsBySocket = new Map<CharacterSocket, Map<string, CharacterPartFactory>>()
  for (let i = 0; i < SOCKET_LIST.length; i++) {
    partsBySocket.set(SOCKET_LIST[i], new Map())
  }

  const builder: CharacterBuilder = {
    sockets: CHARACTER_SOCKETS,
    registerBody(id, factory) {
      if (!id) throw new RangeError('Body id must be a non-empty string')
      bodies.set(id, factory)
    },
    registerPart(socket, id, factory) {
      if (!id) throw new RangeError('Part id must be a non-empty string')
      const bucket = partsBySocket.get(socket)
      if (!bucket) throw new RangeError(`Unknown character socket: ${socket}`)
      bucket.set(id, factory)
    },
    hasBody(id) {
      return bodies.has(id)
    },
    hasPart(socket, id) {
      return partsBySocket.get(socket)?.has(id) ?? false
    },
    listBodies() {
      return Array.from(bodies.keys())
    },
    listParts(socket) {
      const bucket = partsBySocket.get(socket)
      return bucket ? Array.from(bucket.keys()) : []
    },
    assemble(spec: CharacterSpec = {}): Rig {
      const bodyId = spec.body ?? 'humanoid'
      const bodyFactory = bodies.get(bodyId)
      if (!bodyFactory) throw new RangeError(`Unknown character body: ${bodyId}`)
      const scale = spec.scale ?? 1
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new RangeError('Character scale must be a positive finite number')
      }
      const palette = createCharacterPalette(spec.palette)
      const baseParts = bodyFactory(palette)

      const jointParts = new Map<string, RigPart[]>()
      for (let i = 0; i < JOINT_ORDER.length; i++) {
        const jid = JOINT_ORDER[i].id
        const list: RigPart[] = []
        const raw = baseParts[jid]
        if (raw) {
          for (let k = 0; k < raw.length; k++) list.push(scaleBodyPart(raw[k], scale))
        }
        jointParts.set(jid, list)
      }

      if (spec.parts) {
        for (let i = 0; i < SOCKET_LIST.length; i++) {
          const socket = SOCKET_LIST[i]
          const partId = spec.parts[socket]
          if (!partId) continue
          const bucket = partsBySocket.get(socket)
          const factory = bucket?.get(partId)
          if (!factory) {
            throw new RangeError(`Unknown character part "${partId}" for socket "${socket}"`)
          }
          const info = CHARACTER_SOCKETS[socket]
          const target = jointParts.get(info.joint)
          if (!target) continue
          const generated = factory(palette)
          for (let k = 0; k < generated.length; k++) {
            target.push(offsetRigPart(generated[k], info.anchor, scale))
          }
        }
      }

      const mergeJointParts = (list: RigPart[], jointId: string): RigPart[] => {
        if (list.length <= 1) return list
        const passthrough: RigPart[] = []
        const buckets = new Map<number, { unlit: number; parts: RigPart[] }>()
        for (let i = 0; i < list.length; i++) {
          const p = list[i]
          if (p.blend && p.blend !== 'opaque') {
            passthrough.push(p)
            continue
          }
          const u = p.unlit ?? 0
          const key = Math.round(u * 20)
          let bucket = buckets.get(key)
          if (!bucket) {
            bucket = { unlit: u, parts: [] }
            buckets.set(key, bucket)
          }
          bucket.parts.push(p)
        }
        const mergedOut: RigPart[] = []
        for (const bucket of buckets.values()) {
          if (bucket.parts.length === 1) {
            mergedOut.push(bucket.parts[0])
            continue
          }
          let totalVerts = 0
          for (const p of bucket.parts) totalVerts += p.mesh.vertexCount
          const data = new Float32Array(totalVerts * 6)
          const colors = new Float32Array(totalVerts * 3)
          let radiusSq = 0
          let vCursor = 0
          for (const p of bucket.parts) {
            const src = p.mesh.data
            const srcCol = p.mesh.colors
            const n = p.mesh.vertexCount
            const px = p.position ? p.position[0] : 0
            const py = p.position ? p.position[1] : 0
            const pz = p.position ? p.position[2] : 0
            const sx = p.scale ? p.scale[0] : 1
            const sy = p.scale ? p.scale[1] : 1
            const sz = p.scale ? p.scale[2] : 1
            const invSx = Math.abs(sx) > 1e-6 ? 1 / sx : 1
            const invSy = Math.abs(sy) > 1e-6 ? 1 / sy : 1
            const invSz = Math.abs(sz) > 1e-6 ? 1 / sz : 1
            const q = p.rotation ? quaternionFromEuler(p.rotation[0], p.rotation[1], p.rotation[2]) : null
            const cr = p.color[0]
            const cg = p.color[1]
            const cb = p.color[2]
            const flipWinding = sx * sy * sz < 0

            for (let tri = 0; tri < n; tri += 3) {
              const order = flipWinding ? [0, 2, 1] : [0, 1, 2]
              for (let k = 0; k < 3; k++) {
                const vi = tri + order[k]
                const so = vi * 6
                let vx = src[so] * sx
                let vy = src[so + 1] * sy
                let vz = src[so + 2] * sz
                let nx = src[so + 3] * invSx
                let ny = src[so + 4] * invSy
                let nz = src[so + 5] * invSz
                if (q) {
                  const rv = rotateVec3(q, [vx, vy, vz])
                  vx = rv[0]; vy = rv[1]; vz = rv[2]
                  const rn = rotateVec3(q, [nx, ny, nz])
                  nx = rn[0]; ny = rn[1]; nz = rn[2]
                }
                vx += px; vy += py; vz += pz
                const nLen = Math.hypot(nx, ny, nz) || 1
                nx /= nLen; ny /= nLen; nz /= nLen
                const dOff = vCursor * 6
                data[dOff] = vx; data[dOff + 1] = vy; data[dOff + 2] = vz
                data[dOff + 3] = nx; data[dOff + 4] = ny; data[dOff + 5] = nz
                const rSq = vx * vx + vy * vy + vz * vz
                if (rSq > radiusSq) radiusSq = rSq
                const cOff = vCursor * 3
                const scOff = vi * 3
                colors[cOff] = (srcCol ? srcCol[scOff] : 1) * cr
                colors[cOff + 1] = (srcCol ? srcCol[scOff + 1] : 1) * cg
                colors[cOff + 2] = (srcCol ? srcCol[scOff + 2] : 1) * cb
                vCursor++
              }
            }
          }
          const bakedMesh: Mesh = { data, colors, vertexCount: totalVerts, radius: Math.sqrt(radiusSq) }
          mergedOut.push({
            name: `${jointId}_baked`,
            mesh: bakedMesh,
            color: [1, 1, 1, 1],
            ...(bucket.unlit > 0 ? { unlit: bucket.unlit } : {})
          })
        }
        return mergedOut.concat(passthrough)
      }

      const shouldMerge = spec.mergeJointMeshes !== false
      const joints: RigJoint[] = []
      for (let i = 0; i < JOINT_ORDER.length; i++) {
        const def = JOINT_ORDER[i]
        const piv = CHARACTER_JOINT_PIVOTS[def.id]
        const scaledPivot: Vec3 = scale === 1
          ? piv
          : [piv[0] * scale, piv[1] * scale, piv[2] * scale]
        const list = jointParts.get(def.id)
        joints.push({
          id: def.id,
          parent: def.parent,
          pivot: scaledPivot,
          parts: list && list.length > 0 ? (shouldMerge ? mergeJointParts(list, def.id) : list) : undefined
        })
      }

      return createRig(joints, spec.label ?? `character:${bodyId}`)
    }
  }

  registerDefaultBodiesAndParts(builder)
  return builder
}

// ---------------------------------------------------------------------------
// Studio 4-Angle Turntable Renderer (Front, 3/4 Front-Right, Side, Back)
// ---------------------------------------------------------------------------

export interface CharacterTurntableOptions {
  /** Pixel width and height of each square turntable cell (default 256 -> 1024×256 strip). */
  readonly cellSize?: number
  /** Camera elevation angle in radians (default 0.22 rad ≈ 12.6° hero studio angle). */
  readonly elevation?: number
  /** Vertical look-at target height (default 0.86 — centers a ~1.62–1.85 character cleanly). */
  readonly targetY?: number
  /** Camera distance from the character (default 4.1). */
  readonly distance?: number
  /** Perspective vertical field-of-view in radians (default 0.50). */
  readonly fov?: number
  /** Camera yaw angles in radians (default Front 0, 3/4 Front-Right 0.65, Side π/2, Back π). */
  readonly angles?: readonly number[]
  /** Optional joint poses applied before rendering. */
  readonly poses?: Readonly<Record<string, JointPose | undefined>>
  /** Optional lighting override (defaults to warm studio key + cool violet-slate fill). */
  readonly lighting?: LightingOptions
  /** Studio backdrop RGBA color (default soft violet-slate `[0.42, 0.39, 0.45, 1]`; set alpha 0 for transparent). */
  readonly background?: Color
  /** Draw a soft contact shadow disc on `y = 0` under the feet (default true). */
  readonly groundShadow?: boolean
  /** Draw subtle 1px vertical dividers between turntable angles (default true). */
  readonly dividers?: boolean
}

const DEFAULT_TURNTABLE_ANGLES: readonly number[] = [0, 0.65, Math.PI * 0.5, Math.PI]
const DEFAULT_STUDIO_BG: Color = [0.43, 0.40, 0.46, 1]
const DEFAULT_STUDIO_LIGHTING: LightingOptions = {
  direction: [0.54, 0.74, 0.62],
  ambient: 0.52,
  color: [1.10, 1.01, 0.91],
  skyColor: [0.85, 0.82, 0.96],
  groundColor: [0.42, 0.36, 0.54],
  rimColor: [0.98, 0.94, 1.0],
  rimStrength: 0.24
}

let cachedGroundShadowMesh: Mesh | undefined

/**
 * Render a 4-angle studio turntable strip (Front, 3/4 Front-Right, Side, Back) of any Ridgetop Rig
 * into an RGBA pixel buffer without a DOM canvas — ideal for rapid visual validation and thumbnails.
 */
export function renderCharacterTurntablePixels(
  rig: Rig,
  options: CharacterTurntableOptions = {}
): { width: number; height: number; pixels: Uint8ClampedArray } {
  const cellSize = options.cellSize ?? 256
  if (!Number.isInteger(cellSize) || cellSize < 16 || cellSize > 1024) {
    throw new RangeError('Turntable cellSize must be an integer between 16 and 1024')
  }
  const angles = options.angles ?? DEFAULT_TURNTABLE_ANGLES
  if (angles.length === 0) {
    throw new RangeError('Turntable angles must contain at least one camera angle')
  }
  const elevation = options.elevation ?? 0.22
  const targetY = options.targetY ?? 0.86
  const distance = options.distance ?? 4.1
  const fov = options.fov ?? 0.50
  const lighting = options.lighting ?? DEFAULT_STUDIO_LIGHTING
  const bg = options.background ?? DEFAULT_STUDIO_BG
  const drawShadow = options.groundShadow ?? true
  const drawDividers = options.dividers ?? true

  const pool = createMeshPool(32)
  renderRig(rig, { position: [0, 0, 0] }, options.poses ?? {}, pool)
  if (drawShadow) {
    cachedGroundShadowMesh ??= shadowDisc(16)
    pool.add(
      cachedGroundShadowMesh,
      [-0.03, 0.002, -0.04],
      [0.44, 1, 0.36],
      0,
      [0.14, 0.12, 0.22, 0.44],
      1,
      'alpha'
    )
  }

  const width = cellSize * angles.length
  const height = cellSize
  const pixels = new Uint8ClampedArray(width * height * 4)
  const proj = perspective(fov, 1, 0.25, 25)
  const horiz = distance * Math.cos(elevation)
  const camY = targetY + distance * Math.sin(elevation)
  const opaqueBg = bg[3] > 0.001

  for (let col = 0; col < angles.length; col++) {
    const yaw = angles[col]
    const eye: Vec3 = [horiz * Math.sin(yaw), camY, horiz * Math.cos(yaw)]
    const camera = multiply(proj, view(eye, [0, targetY, 0]))
    const frame = renderMeshPixels(camera, pool.batches, cellSize, lighting)
    const src = frame.pixels
    const xOff = col * cellSize

    for (let y = 0; y < cellSize; y++) {
      // Subtle vertical studio backdrop gradient (brighter horizon floor, deeper upper backdrop)
      const gradT = y / (cellSize - 1 || 1)
      const studioBoost = 0.86 + gradT * 0.24
      const bgR = Math.min(255, Math.round(bg[0] * studioBoost * 255))
      const bgG = Math.min(255, Math.round(bg[1] * studioBoost * 255))
      const bgB = Math.min(255, Math.round(bg[2] * studioBoost * 255))
      const bgA = Math.round(bg[3] * 255)

      for (let x = 0; x < cellSize; x++) {
        const si = (y * cellSize + x) * 4
        const di = (y * width + xOff + x) * 4
        const sa = src[si + 3]
        if (!opaqueBg) {
          pixels[di] = src[si]
          pixels[di + 1] = src[si + 1]
          pixels[di + 2] = src[si + 2]
          pixels[di + 3] = sa
        } else if (sa >= 255) {
          pixels[di] = src[si]
          pixels[di + 1] = src[si + 1]
          pixels[di + 2] = src[si + 2]
          pixels[di + 3] = 255
        } else if (sa === 0) {
          pixels[di] = bgR
          pixels[di + 1] = bgG
          pixels[di + 2] = bgB
          pixels[di + 3] = bgA
        } else {
          const a = sa / 255
          const inv = 1 - a
          pixels[di] = Math.round(src[si] * a + bgR * inv)
          pixels[di + 1] = Math.round(src[si + 1] * a + bgG * inv)
          pixels[di + 2] = Math.round(src[si + 2] * a + bgB * inv)
          pixels[di + 3] = 255
        }
      }
    }
  }

  if (drawDividers && opaqueBg && angles.length > 1) {
    const divR = Math.max(0, Math.round(bg[0] * 0.74 * 255))
    const divG = Math.max(0, Math.round(bg[1] * 0.74 * 255))
    const divB = Math.max(0, Math.round(bg[2] * 0.74 * 255))
    for (let col = 1; col < angles.length; col++) {
      const dx = col * cellSize
      for (let y = 0; y < height; y++) {
        const di = (y * width + dx) * 4
        pixels[di] = divR
        pixels[di + 1] = divG
        pixels[di + 2] = divB
        pixels[di + 3] = 255
      }
    }
  }

  return { width, height, pixels }
}
