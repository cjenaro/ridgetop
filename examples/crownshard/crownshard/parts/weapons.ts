import {
  bakeVertexAO,
  bakeZoneColors,
  bevelBox,
  extrudeMesh,
  mixColor,
  octahedron,
  quaternionFromEuler,
  rotateVec3,
  sculptLoft,
  shadeColor,
  tubeMesh
} from 'ridgetop'
import type { CharacterBuilder, CharacterPalette, Color, Mesh, RigPart, Vec3 } from 'ridgetop'

// ---------------------------------------------------------------------------
// Palette & Mesh Transform Helpers
// ---------------------------------------------------------------------------

const WHITE: Color = [1, 1, 1, 1]
const ZERO_ROT: readonly [number, number, number] = [0, 0, 0]

const C_SUN_GOLD: Color = [0.96, 0.78, 0.26, 1]
const C_SUN_GLOW: Color = [1.0, 0.89, 0.36, 1]
const C_CRIMSON: Color = [0.72, 0.14, 0.19, 1]
const C_CRIMSON_DARK: Color = [0.46, 0.09, 0.14, 1]
const C_ARCANE_CYAN: Color = [0.26, 0.90, 1.0, 1]
const C_FROST_ICE: Color = [0.64, 0.88, 1.0, 1]
const C_FROST_GLOW: Color = [0.84, 0.98, 1.0, 1]
const C_FROST_SHAFT: Color = [0.34, 0.44, 0.56, 1]
const C_BONE: Color = [0.88, 0.83, 0.72, 1]
const C_BONE_SHADE: Color = [0.66, 0.60, 0.50, 1]
const C_OBSIDIAN: Color = [0.20, 0.19, 0.27, 1]
const C_OBSIDIAN_EDGE: Color = [0.44, 0.46, 0.56, 1]
const C_VIOLET_GLOW: Color = [0.78, 0.34, 1.0, 1]
const C_PALADIN_COBALT: Color = [0.18, 0.38, 0.78, 1]
const C_PALADIN_IVORY: Color = [0.95, 0.92, 0.84, 1]
const C_PARCHMENT: Color = [0.93, 0.88, 0.74, 1]
const C_HORN_IVORY: Color = [0.91, 0.86, 0.73, 1]
const C_GOBLIN_IRON: Color = [0.35, 0.37, 0.40, 1]
const C_GOBLIN_RUST: Color = [0.44, 0.31, 0.24, 1]
const C_TOME_COVER: Color = [0.44, 0.16, 0.22, 1]
const C_DARK_STEEL: Color = [0.32, 0.35, 0.44, 1]
const C_BRIGHT_STEEL: Color = [0.80, 0.85, 0.91, 1]
const C_DARK_WOOD: Color = [0.36, 0.22, 0.15, 1]
const C_BOW_WOOD: Color = [0.64, 0.40, 0.21, 1]

/**
 * Bake a local scale, rotation, and translation directly into a mesh so multi-part
 * weapons can share a single clean grip-pivot rotation without Euler gimbal drift.
 */
function transformMesh(
  source: Mesh,
  offset: Vec3 = [0, 0, 0],
  rotation: readonly [number, number, number] = ZERO_ROT,
  scale: Vec3 = [1, 1, 1]
): Mesh {
  const n = source.vertexCount
  const src = source.data
  const out = new Float32Array(src.length)
  const q = quaternionFromEuler(rotation[0], rotation[1], rotation[2])
  const sx = scale[0]
  const sy = scale[1]
  const sz = scale[2]
  const ox = offset[0]
  const oy = offset[1]
  const oz = offset[2]
  const invSx = Math.abs(sx) > 1e-6 ? 1 / sx : 1
  const invSy = Math.abs(sy) > 1e-6 ? 1 / sy : 1
  const invSz = Math.abs(sz) > 1e-6 ? 1 / sz : 1
  let maxRadiusSq = 0

  for (let i = 0; i < n; i++) {
    const o = i * 6
    const p = rotateVec3(q, [src[o] * sx, src[o + 1] * sy, src[o + 2] * sz])
    const px = p[0] + ox
    const py = p[1] + oy
    const pz = p[2] + oz
    out[o] = px
    out[o + 1] = py
    out[o + 2] = pz
    const rSq = px * px + py * py + pz * pz
    if (rSq > maxRadiusSq) maxRadiusSq = rSq

    const nr = rotateVec3(q, [src[o + 3] * invSx, src[o + 4] * invSy, src[o + 5] * invSz])
    const len = Math.hypot(nr[0], nr[1], nr[2]) || 1
    out[o + 3] = nr[0] / len
    out[o + 4] = nr[1] / len
    out[o + 5] = nr[2] / len
  }

  return source.colors
    ? { data: out, colors: source.colors.slice(), vertexCount: n, radius: Math.sqrt(maxRadiusSq) }
    : { data: out, vertexCount: n, radius: Math.sqrt(maxRadiusSq) }
}

/** Merge an array of already-oriented sub-meshes into a single batched mesh (optional AO). */
function mergeMeshes(sources: readonly Mesh[]): Mesh {
  let totalVerts = 0
  let hasColors = false
  for (let i = 0; i < sources.length; i++) {
    totalVerts += sources[i].vertexCount
    if (sources[i].colors) hasColors = true
  }
  const data = new Float32Array(totalVerts * 6)
  const colors = hasColors ? new Float32Array(totalVerts * 3) : undefined
  let vCursor = 0
  let maxRadiusSq = 0

  for (let s = 0; s < sources.length; s++) {
    const m = sources[s]
    data.set(m.data, vCursor * 6)
    if (colors) {
      if (m.colors) {
        colors.set(m.colors, vCursor * 3)
      } else {
        colors.fill(1, vCursor * 3, (vCursor + m.vertexCount) * 3)
      }
    }
    const rSq = m.radius * m.radius
    if (rSq > maxRadiusSq) maxRadiusSq = rSq
    vCursor += m.vertexCount
  }

  return colors
    ? { data, colors, vertexCount: totalVerts, radius: Math.sqrt(maxRadiusSq) }
    : { data, vertexCount: totalVerts, radius: Math.sqrt(maxRadiusSq) }
}

interface LocalSubPart {
  readonly name: string
  readonly mesh: Mesh
  readonly position?: Vec3
  readonly color: Color
  readonly unlit?: number
}

/**
 * Orient a whole multi-part weapon cleanly around its grip `[0, 0, 0]` so every sub-part
 * shares the exact same socket-space tilt and seats firmly inside the mannequin palm.
 */
function orientParts(
  parts: readonly LocalSubPart[],
  rotation: readonly [number, number, number],
  offset: Vec3 = [0, 0, 0]
): RigPart[] {
  const q = quaternionFromEuler(rotation[0], rotation[1], rotation[2])
  const out: RigPart[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    const lp = p.position ?? [0, 0, 0]
    const rp = rotateVec3(q, lp)
    out.push({
      name: p.name,
      mesh: p.mesh,
      position: [rp[0] + offset[0], rp[1] + offset[1], rp[2] + offset[2]],
      rotation,
      color: p.color,
      unlit: p.unlit
    })
  }
  return out
}

/** Build a diamond-section faceted blade lofted along +Y (width along Z, bevel thickness along X). */
function diamondBladeLoft(
  stations: readonly (readonly [y: number, halfThickX: number, halfWidthZ: number, zOff?: number])[],
  aoStrength = 0.14
): Mesh {
  const rings: { readonly y: number; readonly points: readonly (readonly [number, number])[] }[] = []
  for (let i = 0; i < stations.length; i++) {
    const [y, hx, hz, zOff = 0] = stations[i]
    const tx = Math.max(0.0025, hx)
    const tz = Math.max(0.003, hz)
    rings.push({
      y,
      points: [
        [tx, zOff],
        [0, tz + zOff],
        [-tx, zOff],
        [0, -tz + zOff]
      ]
    })
  }
  return sculptLoft(rings, { aoStrength, aoGradient: 0.08 })
}

/** Build an extruded 2D silhouette oriented in the YZ plane (weapon edge along +/-Z, thickness along X). */
function extrudeYZ(pointsZY: readonly (readonly [z: number, y: number])[], thicknessX: number, ao = 0.16): Mesh {
  // extrudeMesh puts polygon in XY with depth along Z; rotating yaw = -PI/2 maps +X -> +Z, +Z -> -X.
  const raw = extrudeMesh(pointsZY, thicknessX)
  const oriented = transformMesh(raw, [0, 0, 0], [0, -Math.PI * 0.5, 0])
  return ao > 0 ? bakeVertexAO(oriented, { strength: ao, verticalGradient: 0.08 }) : oriented
}

/** Build a closed polygonal ring lying in the XZ plane using tubeMesh. */
function ringTube(radius: number, tubeRadius: number, segments = 12, sides = 5): Mesh {
  const pts: Vec3[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    pts.push([Math.cos(a) * radius, 0, Math.sin(a) * radius])
  }
  return bakeVertexAO(tubeMesh(pts, tubeRadius, sides), { strength: 0.14, verticalGradient: 0.06 })
}

// ---------------------------------------------------------------------------
// Cached Sculpted Weapon & Shield Meshes (built once on first use)
// ---------------------------------------------------------------------------

interface WeaponMeshes {
  // Broadsword
  readonly broadswordGrip: Mesh
  readonly broadswordPommel: Mesh
  readonly broadswordGuard: Mesh
  readonly broadswordBlade: Mesh
  readonly broadswordFuller: Mesh
  // Sunblade
  readonly sunbladeGrip: Mesh
  readonly sunbladePommel: Mesh
  readonly sunbladeGuard: Mesh
  readonly sunbladeGem: Mesh
  readonly sunbladeBlade: Mesh
  readonly sunbladeCore: Mesh
  // Arrow nocked
  readonly arrowShaft: Mesh
  readonly arrowFletching: Mesh
  readonly arrowHead: Mesh
  readonly arrowNock: Mesh
  // Staff arcane
  readonly staffArcaneShaft: Mesh
  readonly staffArcaneGrip: Mesh
  readonly staffArcaneGold: Mesh
  readonly staffArcaneCrystal: Mesh
  // Staff frost
  readonly staffFrostShaft: Mesh
  readonly staffFrostGrip: Mesh
  readonly staffFrostSpires: Mesh
  readonly staffFrostDiamond: Mesh
  // Mace sun
  readonly maceGrip: Mesh
  readonly maceShaft: Mesh
  readonly maceHeadGold: Mesh
  readonly maceCore: Mesh
  // Dagger (main & mirrored offhand)
  readonly daggerGrip: Mesh
  readonly daggerGuard: Mesh
  readonly daggerBlade: Mesh
  readonly daggerEdge: Mesh
  readonly offDaggerBlade: Mesh
  readonly offDaggerEdge: Mesh
  // Greataxe
  readonly axeHaft: Mesh
  readonly axeWrap: Mesh
  readonly axeCollar: Mesh
  readonly axeBlades: Mesh
  readonly axeEdges: Mesh
  readonly axeRivets: Mesh
  // Scythe bone
  readonly scytheShaft: Mesh
  readonly scytheWrap: Mesh
  readonly scytheCollar: Mesh
  readonly scytheBlade: Mesh
  readonly scytheEdge: Mesh
  // Goblin cleaver
  readonly cleaverGrip: Mesh
  readonly cleaverGuard: Mesh
  readonly cleaverBlade: Mesh
  readonly cleaverEdge: Mesh
  readonly cleaverRivets: Mesh
  // Obsidian greatsword
  readonly obsidianGrip: Mesh
  readonly obsidianGuard: Mesh
  readonly obsidianBlade: Mesh
  readonly obsidianEdges: Mesh
  readonly obsidianRunes: Mesh
  // Shields (common handle + distinct faces)
  readonly shieldGrip: Mesh
  readonly heaterRim: Mesh
  readonly heaterField: Mesh
  readonly heaterCrest: Mesh
  readonly paladinRim: Mesh
  readonly paladinCobalt: Mesh
  readonly paladinIvory: Mesh
  readonly paladinCross: Mesh
  readonly paladinGem: Mesh
  readonly bucklerRim: Mesh
  readonly bucklerWood: Mesh
  readonly bucklerBoss: Mesh
  readonly obsidianShieldRim: Mesh
  readonly obsidianShieldField: Mesh
  readonly obsidianShieldClaws: Mesh
  readonly obsidianShieldGem: Mesh
  // Offhand bow
  readonly bowLimbs: Mesh
  readonly bowGrip: Mesh
  readonly bowTips: Mesh
  readonly bowString: Mesh
  // Offhand spell orb
  readonly orbCrystal: Mesh
  readonly orbRing: Mesh
  readonly orbShards: Mesh
  // Offhand tome
  readonly tomeCover: Mesh
  readonly tomePages: Mesh
  readonly tomeGold: Mesh
  readonly tomeSigil: Mesh
}

let cachedMeshes: WeaponMeshes | undefined

function getWeaponMeshes(): WeaponMeshes {
  if (cachedMeshes) return cachedMeshes

  // --- 1. Broadsword ---
  const broadswordGrip = sculptLoft([
    { y: -0.088, rx: 0.024, rz: 0.030 },
    { y: -0.030, rx: 0.027, rz: 0.034 },
    { y:  0.030, rx: 0.027, rz: 0.034 },
    { y:  0.088, rx: 0.025, rz: 0.031 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const broadswordPommel = sculptLoft([
    { y: -0.155, rx: 0.016, rz: 0.020 },
    { y: -0.122, rx: 0.044, rz: 0.048 },
    { y: -0.086, rx: 0.030, rz: 0.034 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const broadswordGuard = extrudeYZ([
    [-0.148, 0.095], [-0.122, 0.142], [-0.048, 0.138], [0, 0.158],
    [0.048, 0.138], [0.122, 0.142], [0.148, 0.095], [0.068, 0.082],
    [-0.068, 0.082]
  ], 0.056, 0.16)

  const broadswordBlade = diamondBladeLoft([
    [0.140, 0.028, 0.068],
    [0.420, 0.026, 0.064],
    [0.640, 0.022, 0.056],
    [0.790, 0.004, 0.005]
  ], 0.14)

  const broadswordFuller = sculptLoft([
    { y: 0.155, rx: 0.033, rz: 0.024 },
    { y: 0.570, rx: 0.029, rz: 0.017 },
    { y: 0.625, rx: 0.016, rz: 0.007 }
  ], { sides: 4, aoStrength: 0.10, aoGradient: 0.05 })

  // --- 2. Sunblade (Grand Gilded Greatsword) ---
  const sunbladeGrip = sculptLoft([
    { y: -0.110, rx: 0.027, rz: 0.032 },
    { y:  0.000, rx: 0.030, rz: 0.036 },
    { y:  0.110, rx: 0.028, rz: 0.033 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const sunbladePommel = sculptLoft([
    { y: -0.195, rx: 0.012, rz: 0.014 },
    { y: -0.152, rx: 0.054, rz: 0.060 },
    { y: -0.106, rx: 0.034, rz: 0.038 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const sunbladeGuard = mergeMeshes([
    extrudeYZ([
      [-0.242, 0.236], [-0.192, 0.258], [-0.074, 0.184], [0, 0.228],
      [0.074, 0.184], [0.192, 0.258], [0.242, 0.236], [0.172, 0.128],
      [0.068, 0.098], [-0.068, 0.098], [-0.172, 0.128]
    ], 0.070, 0.16),
    transformMesh(
      sculptLoft([
        { y: -0.022, rx: 0.038, rz: 0.044 },
        { y:  0.022, rx: 0.038, rz: 0.044 }
      ], { sides: 6, aoStrength: 0.12 }),
      [0, 0, 0]
    )
  ])

  const sunbladeGem = transformMesh(octahedron, [0, 0.158, 0], [0, 0, 0], [0.054, 0.062, 0.062])

  const sunbladeBlade = diamondBladeLoft([
    [0.185, 0.032, 0.098],
    [0.340, 0.032, 0.090],
    [0.750, 0.027, 0.082],
    [0.970, 0.005, 0.006]
  ], 0.14)

  const sunbladeCore = diamondBladeLoft([
    [0.205, 0.040, 0.038],
    [0.765, 0.034, 0.030],
    [0.885, 0.008, 0.006]
  ], 0)

  // --- 3. Arrow Nocked ---
  const arrowShaft = sculptLoft([
    { y: -0.22, rx: 0.017, rz: 0.017 },
    { y:  0.44, rx: 0.017, rz: 0.017 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const arrowNock = sculptLoft([
    { y: -0.260, rx: 0.022, rz: 0.022 },
    { y: -0.215, rx: 0.020, rz: 0.020 }
  ], { sides: 6, aoStrength: 0.12 })

  const vaneBase = extrudeMesh([
    [0.012, -0.232], [0.086, -0.248], [0.078, -0.105], [0.014, -0.062]
  ], 0.014)
  const arrowFletching = bakeVertexAO(
    mergeMeshes([
      transformMesh(vaneBase, [0, 0, 0], [0, 0, 0]),
      transformMesh(vaneBase, [0, 0, 0], [0, (Math.PI * 2) / 3, 0]),
      transformMesh(vaneBase, [0, 0, 0], [0, (Math.PI * 4) / 3, 0])
    ]),
    { strength: 0.12, verticalGradient: 0.06 }
  )

  const arrowHead = diamondBladeLoft([
    [0.420, 0.022, 0.052],
    [0.455, 0.028, 0.066],
    [0.620, 0.004, 0.004]
  ], 0.14)

  // --- 4. Staff Arcane ---
  const staffArcaneShaft = sculptLoft([
    { y: -0.36, rx: 0.026, rz: 0.026 },
    { y: -0.10, rx: 0.029, rz: 0.029 },
    { y:  0.14, rx: 0.030, rz: 0.030 },
    { y:  0.46, rx: 0.032, rz: 0.032, zOffset: 0.008 },
    { y:  0.64, rx: 0.038, rz: 0.038, zOffset: 0.010 }
  ], { sides: 6, aoStrength: 0.18, aoGradient: 0.10 })

  const staffArcaneGrip = sculptLoft([
    { y: -0.095, rx: 0.034, rz: 0.034 },
    { y:  0.000, rx: 0.036, rz: 0.036 },
    { y:  0.095, rx: 0.034, rz: 0.034 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const arcaneProng0 = tubeMesh(
    [
      [0.036, 0.68, 0.010],
      [0.108, 0.77, 0.010],
      [0.116, 0.90, 0.010],
      [0.072, 0.99, 0.010]
    ],
    [0.024, 0.022, 0.018, 0.011],
    5
  )
  const arcaneProng1 = transformMesh(arcaneProng0, [0, 0, 0], [0, Math.PI, 0])
  const arcaneProng2 = tubeMesh(
    [
      [0, 0.68, 0.044],
      [0, 0.77, 0.114],
      [0, 0.88, 0.110],
      [0, 0.96, 0.068]
    ],
    [0.022, 0.020, 0.016, 0.010],
    5
  )
  const arcaneProng3 = tubeMesh(
    [
      [0, 0.68, -0.026],
      [0, 0.77, -0.096],
      [0, 0.88, -0.092],
      [0, 0.96, -0.052]
    ],
    [0.022, 0.020, 0.016, 0.010],
    5
  )
  const staffArcaneGold = bakeVertexAO(
    mergeMeshes([
      // Butt ferrule cap (bottom at -0.415 -> safely above ground -0.47!)
      sculptLoft([
        { y: -0.415, rx: 0.016, rz: 0.016 },
        { y: -0.355, rx: 0.033, rz: 0.033 },
        { y: -0.320, rx: 0.030, rz: 0.030 }
      ], { sides: 6 }),
      // Upper collar below crystal cradle
      sculptLoft([
        { y: 0.60, rx: 0.042, rz: 0.042, zOffset: 0.010 },
        { y: 0.66, rx: 0.066, rz: 0.066, zOffset: 0.010 },
        { y: 0.71, rx: 0.054, rz: 0.054, zOffset: 0.010 }
      ], { sides: 6 }),
      arcaneProng0,
      arcaneProng1,
      arcaneProng2,
      arcaneProng3
    ]),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const staffArcaneCrystal = sculptLoft([
    { y: 0.74, rx: 0.008, rz: 0.008, zOffset: 0.010 },
    { y: 0.84, rx: 0.078, rz: 0.078, zOffset: 0.010 },
    { y: 0.93, rx: 0.068, rz: 0.068, zOffset: 0.010 },
    { y: 1.07, rx: 0.006, rz: 0.006, zOffset: 0.010 }
  ], { sides: 6, aoStrength: 0.06, aoGradient: 0.04 })

  // --- 5. Staff Frost ---
  const staffFrostShaft = bakeVertexAO(
    mergeMeshes([
      sculptLoft([
        { y: -0.415, rx: 0.015, rz: 0.015 },
        { y: -0.340, rx: 0.032, rz: 0.032 },
        { y:  0.220, rx: 0.030, rz: 0.030 },
        { y:  0.540, rx: 0.042, rz: 0.040 },
        { y:  0.640, rx: 0.056, rz: 0.052 }
      ], { sides: 6 }),
      sculptLoft([
        { y: 0.44, rx: 0.046, rz: 0.046 },
        { y: 0.50, rx: 0.058, rz: 0.058 },
        { y: 0.55, rx: 0.044, rz: 0.044 }
      ], { sides: 6 })
    ]),
    { strength: 0.16, verticalGradient: 0.10 }
  )

  const staffFrostGrip = sculptLoft([
    { y: -0.095, rx: 0.036, rz: 0.036 },
    { y:  0.000, rx: 0.038, rz: 0.038 },
    { y:  0.095, rx: 0.036, rz: 0.036 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const frostShardA = sculptLoft([
    { y: 0.60, rx: 0.044, rz: 0.036, xOffset: -0.052, zOffset: 0.014 },
    { y: 0.80, rx: 0.036, rz: 0.032, xOffset: -0.096, zOffset: 0.022 },
    { y: 1.05, rx: 0.005, rz: 0.005, xOffset: -0.048, zOffset: 0.018 }
  ], { sides: 5 })
  const frostShardB = sculptLoft([
    { y: 0.60, rx: 0.044, rz: 0.036, xOffset: 0.052, zOffset: -0.010 },
    { y: 0.82, rx: 0.036, rz: 0.032, xOffset: 0.098, zOffset: -0.016 },
    { y: 1.02, rx: 0.005, rz: 0.005, xOffset: 0.056, zOffset: -0.008 }
  ], { sides: 5 })
  const frostShardC = sculptLoft([
    { y: 0.58, rx: 0.036, rz: 0.044, xOffset: 0.008, zOffset: 0.056 },
    { y: 0.76, rx: 0.028, rz: 0.034, xOffset: 0.012, zOffset: 0.104 },
    { y: 0.94, rx: 0.005, rz: 0.005, xOffset: 0.006, zOffset: 0.068 }
  ], { sides: 5 })
  const frostShardD = sculptLoft([
    { y: 0.58, rx: 0.036, rz: 0.040, xOffset: -0.010, zOffset: -0.052 },
    { y: 0.74, rx: 0.026, rz: 0.030, xOffset: -0.012, zOffset: -0.092 },
    { y: 0.90, rx: 0.005, rz: 0.005, xOffset: -0.008, zOffset: -0.062 }
  ], { sides: 5 })
  const staffFrostSpires = bakeVertexAO(
    mergeMeshes([frostShardA, frostShardB, frostShardC, frostShardD]),
    { strength: 0.14, verticalGradient: 0.08 }
  )

  const staffFrostDiamond = transformMesh(octahedron, [0, 0.85, 0.004], [0, Math.PI * 0.25, 0], [0.068, 0.118, 0.068])

  // --- 6. Mace Sun (Flanged Golden Cleric War-Mace) ---
  const maceGrip = sculptLoft([
    { y: -0.095, rx: 0.028, rz: 0.030 },
    { y:  0.000, rx: 0.031, rz: 0.033 },
    { y:  0.095, rx: 0.028, rz: 0.030 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const maceShaft = sculptLoft([
    { y: 0.090, rx: 0.026, rz: 0.026 },
    { y: 0.390, rx: 0.030, rz: 0.030 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const maceFlangeRaw = extrudeMesh([
    [0.042, 0.405], [0.132, 0.445], [0.156, 0.545], [0.124, 0.648], [0.042, 0.678]
  ], 0.024)
  const maceFlanges: Mesh[] = [
    // Pommel
    sculptLoft([
      { y: -0.158, rx: 0.018, rz: 0.018 },
      { y: -0.124, rx: 0.044, rz: 0.044 },
      { y: -0.090, rx: 0.032, rz: 0.032 }
    ], { sides: 6 }),
    // Neck collar
    sculptLoft([
      { y: 0.365, rx: 0.044, rz: 0.044 },
      { y: 0.415, rx: 0.062, rz: 0.062 },
      { y: 0.445, rx: 0.052, rz: 0.052 }
    ], { sides: 6 }),
    // Top finial crown spike
    sculptLoft([
      { y: 0.640, rx: 0.058, rz: 0.058 },
      { y: 0.695, rx: 0.042, rz: 0.042 },
      { y: 0.790, rx: 0.006, rz: 0.006 }
    ], { sides: 6 })
  ]
  for (let i = 0; i < 6; i++) {
    maceFlanges.push(transformMesh(maceFlangeRaw, [0, 0, 0], [0, (i / 6) * Math.PI * 2, 0]))
  }
  const maceHeadGold = bakeVertexAO(mergeMeshes(maceFlanges), { strength: 0.16, verticalGradient: 0.08 })

  const maceCore = sculptLoft([
    { y: 0.435, rx: 0.056, rz: 0.056 },
    { y: 0.545, rx: 0.106, rz: 0.106 },
    { y: 0.655, rx: 0.056, rz: 0.056 }
  ], { sides: 8, aoStrength: 0.06, aoGradient: 0.04 })

  // --- 7. Dagger (Sleek Curved Dark-Steel Rogue Dagger + Mirrored Off-Hand) ---
  const daggerGrip = bakeVertexAO(
    mergeMeshes([
      sculptLoft([
        { y: -0.082, rx: 0.025, rz: 0.030 },
        { y:  0.000, rx: 0.029, rz: 0.034 },
        { y:  0.082, rx: 0.026, rz: 0.031 }
      ], { sides: 6 }),
      sculptLoft([
        { y: -0.142, rx: 0.014, rz: 0.016 },
        { y: -0.108, rx: 0.040, rz: 0.046 },
        { y: -0.078, rx: 0.028, rz: 0.032 }
      ], { sides: 6 })
    ]),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const daggerGuard = extrudeYZ([
    [-0.112, 0.118], [-0.084, 0.142], [0, 0.112], [0.092, 0.148],
    [0.118, 0.116], [0.056, 0.072], [-0.056, 0.072]
  ], 0.054, 0.16)

  const daggerBlade = extrudeYZ([
    [-0.034, 0.110], [-0.024, 0.265], [0.012, 0.420], [0.086, 0.560],
    [0.066, 0.400], [0.050, 0.240], [0.050, 0.110]
  ], 0.040, 0.16)

  const daggerEdge = extrudeYZ([
    [0.034, 0.120], [0.034, 0.250], [0.050, 0.400], [0.090, 0.568],
    [0.078, 0.395], [0.060, 0.238], [0.058, 0.118]
  ], 0.022, 0.08)

  const offDaggerBlade = extrudeYZ([
    [0.034, 0.110], [0.024, 0.265], [-0.012, 0.420], [-0.086, 0.560],
    [-0.066, 0.400], [-0.050, 0.240], [-0.050, 0.110]
  ], 0.040, 0.16)

  const offDaggerEdge = extrudeYZ([
    [-0.034, 0.120], [-0.034, 0.250], [-0.050, 0.400], [-0.090, 0.568],
    [-0.078, 0.395], [-0.060, 0.238], [-0.058, 0.118]
  ], 0.022, 0.08)

  // --- 8. Greataxe (Chunky Double-Bladed Orc Battleaxe) ---
  const axeHaft = sculptLoft([
    { y: -0.24, rx: 0.030, rz: 0.030 },
    { y:  0.12, rx: 0.033, rz: 0.033 },
    { y:  0.56, rx: 0.036, rz: 0.036 },
    { y:  0.70, rx: 0.034, rz: 0.034 }
  ], { sides: 6, aoStrength: 0.18, aoGradient: 0.10 })

  const axeWrap = bakeVertexAO(
    mergeMeshes([
      sculptLoft([
        { y: -0.095, rx: 0.038, rz: 0.038 },
        { y:  0.000, rx: 0.041, rz: 0.041 },
        { y:  0.095, rx: 0.038, rz: 0.038 }
      ], { sides: 6 }),
      sculptLoft([
        { y: 0.32, rx: 0.040, rz: 0.040 },
        { y: 0.40, rx: 0.042, rz: 0.042 }
      ], { sides: 6 })
    ]),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const axeCollar = bakeVertexAO(
    mergeMeshes([
      // Butt iron cap
      sculptLoft([
        { y: -0.285, rx: 0.020, rz: 0.020 },
        { y: -0.240, rx: 0.040, rz: 0.040 },
        { y: -0.205, rx: 0.036, rz: 0.036 }
      ], { sides: 6 }),
      // Central axe socket housing
      transformMesh(bevelBox(0.14), [0, 0.565, 0], ZERO_ROT, [0.098, 0.215, 0.118]),
      // Top crown spike
      sculptLoft([
        { y: 0.665, rx: 0.044, rz: 0.048 },
        { y: 0.725, rx: 0.030, rz: 0.032 },
        { y: 0.835, rx: 0.005, rz: 0.005 }
      ], { sides: 4 })
    ]),
    { strength: 0.18, verticalGradient: 0.08 }
  )

  const axeBladeWing: readonly (readonly [number, number])[] = [
    [0.045, 0.490], [0.165, 0.410], [0.245, 0.435], [0.275, 0.565],
    [0.245, 0.695], [0.165, 0.720], [0.045, 0.640]
  ]
  const axeBladeWingBack: readonly (readonly [number, number])[] = [
    [-0.045, 0.490], [-0.165, 0.410], [-0.245, 0.435], [-0.275, 0.565],
    [-0.245, 0.695], [-0.165, 0.720], [-0.045, 0.640]
  ]
  const axeBlades = mergeMeshes([
    extrudeYZ(axeBladeWing, 0.050, 0.16),
    extrudeYZ(axeBladeWingBack, 0.050, 0.16)
  ])

  const axeEdgeFront: readonly (readonly [number, number])[] = [
    [0.228, 0.422], [0.268, 0.442], [0.296, 0.565], [0.268, 0.688], [0.228, 0.708], [0.254, 0.565]
  ]
  const axeEdgeBack: readonly (readonly [number, number])[] = [
    [-0.228, 0.422], [-0.268, 0.442], [-0.296, 0.565], [-0.268, 0.688], [-0.228, 0.708], [-0.254, 0.565]
  ]
  const axeEdges = mergeMeshes([
    extrudeYZ(axeEdgeFront, 0.028, 0.08),
    extrudeYZ(axeEdgeBack, 0.028, 0.08)
  ])

  const rivetOffsets: readonly Vec3[] = [
    [0.054, 0.625, 0.034], [0.054, 0.505, 0.034], [0.054, 0.625, -0.034], [0.054, 0.505, -0.034],
    [-0.054, 0.625, 0.034], [-0.054, 0.505, 0.034], [-0.054, 0.625, -0.034], [-0.054, 0.505, -0.034],
    [0.032, 0.565, 0.145], [-0.032, 0.565, 0.145], [0.032, 0.565, -0.145], [-0.032, 0.565, -0.145]
  ]
  const rivetParts: Mesh[] = []
  for (let i = 0; i < rivetOffsets.length; i++) {
    rivetParts.push(transformMesh(octahedron, rivetOffsets[i], ZERO_ROT, [0.023, 0.023, 0.023]))
  }
  const axeRivets = mergeMeshes(rivetParts)

  // --- 9. Scythe Bone (Tall Bone-Shafted Reaper Scythe) ---
  const scytheShaft = bakeVertexAO(
    mergeMeshes([
      tubeMesh(
        [
          [0, -0.40, -0.010],
          [0, -0.18,  0.004],
          [0,  0.00,  0.000],
          [0,  0.28, -0.016],
          [0,  0.58,  0.012],
          [0,  0.82,  0.036]
        ],
        [0.024, 0.027, 0.029, 0.028, 0.031, 0.035],
        6
      ),
      // Knobby bone joints at bottom, mid-upper, and crown
      sculptLoft([
        { y: -0.420, rx: 0.034, rz: 0.038, zOffset: -0.012 },
        { y: -0.370, rx: 0.038, rz: 0.042, zOffset: -0.010 },
        { y: -0.335, rx: 0.026, rz: 0.028, zOffset: -0.008 }
      ], { sides: 6 }),
      sculptLoft([
        { y: 0.34, rx: 0.036, rz: 0.038, zOffset: -0.014 },
        { y: 0.38, rx: 0.044, rz: 0.046, zOffset: -0.012 },
        { y: 0.42, rx: 0.034, rz: 0.036, zOffset: -0.010 }
      ], { sides: 6 }),
      sculptLoft([
        { y: 0.80, rx: 0.046, rz: 0.052, zOffset: 0.036 },
        { y: 0.87, rx: 0.032, rz: 0.036, zOffset: 0.038 },
        { y: 0.94, rx: 0.008, rz: 0.008, zOffset: 0.040 }
      ], { sides: 6 })
    ]),
    { strength: 0.18, verticalGradient: 0.10 }
  )

  const scytheWrap = sculptLoft([
    { y: -0.095, rx: 0.035, rz: 0.035 },
    { y:  0.000, rx: 0.037, rz: 0.037 },
    { y:  0.095, rx: 0.035, rz: 0.035 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const scytheCollar = bakeVertexAO(
    mergeMeshes([
      sculptLoft([
        { y: 0.69, rx: 0.050, rz: 0.056, zOffset: 0.026 },
        { y: 0.76, rx: 0.062, rz: 0.072, zOffset: 0.034 },
        { y: 0.82, rx: 0.050, rz: 0.058, zOffset: 0.036 }
      ], { sides: 6 }),
      // Rear counterbalance bone/iron spike
      extrudeYZ([
        [0.01, 0.79], [-0.14, 0.82], [-0.08, 0.74], [0.01, 0.73]
      ], 0.032, 0.12)
    ]),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const scytheBlade = extrudeYZ([
    [0.02, 0.81], [0.18, 0.89], [0.39, 0.87], [0.56, 0.74], [0.66, 0.49],
    [0.53, 0.64], [0.36, 0.74], [0.18, 0.75], [0.02, 0.71]
  ], 0.044, 0.16)

  const scytheEdge = extrudeYZ([
    [0.05, 0.72], [0.19, 0.76], [0.37, 0.75], [0.54, 0.65], [0.675, 0.475],
    [0.51, 0.61], [0.35, 0.71], [0.17, 0.71], [0.05, 0.69]
  ], 0.022, 0.08)

  // --- 10. Goblin Cleaver (Notched Jagged Crude Iron Machete) ---
  const cleaverGrip = bakeVertexAO(
    mergeMeshes([
      sculptLoft([
        { y: -0.082, rx: 0.025, rz: 0.030 },
        { y:  0.000, rx: 0.029, rz: 0.034 },
        { y:  0.082, rx: 0.027, rz: 0.031 }
      ], { sides: 5 }),
      sculptLoft([
        { y: -0.130, rx: 0.024, rz: 0.026 },
        { y: -0.098, rx: 0.042, rz: 0.046 },
        { y: -0.078, rx: 0.030, rz: 0.032 }
      ], { sides: 5 })
    ]),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const cleaverGuard = extrudeYZ([
    [-0.082, 0.082], [-0.068, 0.120], [0.102, 0.128], [0.114, 0.084]
  ], 0.056, 0.16)

  // Jagged heavy cleaver profile with 2 distinct deep battle notches on the +Z cutting edge & hooked tip
  const cleaverBlade = extrudeYZ([
    [-0.046, 0.118], [-0.058, 0.370], [-0.068, 0.560], [0.018, 0.625],
    [0.118, 0.575], [0.088, 0.482], [0.036, 0.456], [0.098, 0.415],
    [0.092, 0.305], [0.034, 0.280], [0.086, 0.238], [0.074, 0.118]
  ], 0.046, 0.18)

  const cleaverEdge = extrudeYZ([
    [0.058, 0.122], [0.070, 0.238], [0.024, 0.280], [0.078, 0.308],
    [0.084, 0.415], [0.026, 0.456], [0.076, 0.485], [0.104, 0.570],
    [0.126, 0.578], [0.096, 0.478], [0.044, 0.454], [0.106, 0.415],
    [0.100, 0.302], [0.042, 0.278], [0.094, 0.235], [0.082, 0.122]
  ], 0.022, 0.08)

  const cleaverRivets = mergeMeshes([
    transformMesh(octahedron, [0.028, 0.20, -0.024], ZERO_ROT, [0.020, 0.020, 0.020]),
    transformMesh(octahedron, [-0.028, 0.20, -0.024], ZERO_ROT, [0.020, 0.020, 0.020]),
    transformMesh(octahedron, [0.028, 0.47, -0.036], ZERO_ROT, [0.022, 0.022, 0.022]),
    transformMesh(octahedron, [-0.028, 0.47, -0.036], ZERO_ROT, [0.022, 0.022, 0.022])
  ])

  // --- 11. Obsidian Greatsword (Massive Dark-Iron Warlord Greatsword + Violet Rune Core) ---
  const obsidianGrip = sculptLoft([
    { y: -0.115, rx: 0.029, rz: 0.034 },
    { y:  0.000, rx: 0.032, rz: 0.038 },
    { y:  0.115, rx: 0.030, rz: 0.035 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const obsidianGuard = mergeMeshes([
    // Jagged spiked pommel
    sculptLoft([
      { y: -0.215, rx: 0.008, rz: 0.008 },
      { y: -0.160, rx: 0.056, rz: 0.066 },
      { y: -0.110, rx: 0.036, rz: 0.042 }
    ], { sides: 6, aoStrength: 0.16 }),
    // Horned jagged warlord crossguard
    extrudeYZ([
      [-0.235, 0.250], [-0.185, 0.145], [-0.072, 0.098], [0.072, 0.098],
      [0.185, 0.145], [0.235, 0.250], [0.165, 0.210], [0.082, 0.172],
      [0, 0.210], [-0.082, 0.172], [-0.165, 0.210]
    ], 0.074, 0.18)
  ])

  // Wide jagged obsidian core blade with ricasso teeth
  const obsidianBlade = extrudeYZ([
    [-0.086, 0.185], [-0.122, 0.290], [-0.082, 0.340], [-0.098, 0.720],
    [-0.074, 0.865], [0, 1.005], [0.074, 0.865], [0.098, 0.720],
    [0.082, 0.340], [0.122, 0.290], [0.086, 0.185]
  ], 0.048, 0.16)

  // Brighter gunmetal beveled outer cutting edges so dark obsidian reads crisply against dark floors
  const obsidianEdges = diamondBladeLoft([
    [0.195, 0.018, 0.096],
    [0.340, 0.018, 0.092],
    [0.720, 0.016, 0.106],
    [0.865, 0.013, 0.082],
    [1.015, 0.004, 0.005]
  ], 0.10)

  const obsidianRunes = mergeMeshes([
    // Central glowing violet rune channel
    diamondBladeLoft([
      [0.240, 0.038, 0.030],
      [0.805, 0.033, 0.024],
      [0.895, 0.009, 0.007]
    ], 0),
    // Guard rune gem + 3 diamond rune nodes along blade + pommel gem
    transformMesh(octahedron, [0, 0.155, 0], ZERO_ROT, [0.056, 0.068, 0.068]),
    transformMesh(octahedron, [0, 0.420, 0], ZERO_ROT, [0.046, 0.064, 0.054]),
    transformMesh(octahedron, [0, 0.625, 0], ZERO_ROT, [0.042, 0.058, 0.048]),
    transformMesh(octahedron, [0, -0.162, 0], ZERO_ROT, [0.038, 0.040, 0.040])
  ])

  // --- Shared Shield Grip Handle (connects [0,0,0] inside handL to back of shield!) ---
  const shieldGrip = bakeVertexAO(
    mergeMeshes([
      sculptLoft([
        { y: -0.075, rx: 0.024, rz: 0.024 },
        { y:  0.075, rx: 0.024, rz: 0.024 }
      ], { sides: 6 }),
      // Upper & lower sturdy iron bracket struts connecting grip to shield face (+Z in shield-local space)
      transformMesh(bevelBox(0.14), [0,  0.062, 0.045], ZERO_ROT, [0.032, 0.026, 0.095]),
      transformMesh(bevelBox(0.14), [0, -0.062, 0.045], ZERO_ROT, [0.032, 0.026, 0.095])
    ]),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  // --- 12. Shield Heater ---
  const heaterOuterPoly: readonly (readonly [number, number])[] = [
    [0, -0.250], [0.132, -0.165], [0.196, -0.010], [0.200, 0.165],
    [0.132, 0.228], [0, 0.244], [-0.132, 0.228], [-0.200, 0.165],
    [-0.196, -0.010], [-0.132, -0.165]
  ]
  const heaterInnerPoly: readonly (readonly [number, number])[] = [
    [0, -0.206], [0.104, -0.134], [0.158, -0.008], [0.160, 0.136],
    [0.104, 0.188], [0, 0.200], [-0.104, 0.188], [-0.160, 0.136],
    [-0.158, -0.008], [-0.104, -0.134]
  ]
  const heaterRim = bakeVertexAO(
    transformMesh(extrudeMesh(heaterOuterPoly, 0.044), [0, 0.040, 0.088]),
    { strength: 0.18, verticalGradient: 0.10 }
  )
  const rawHeaterField = transformMesh(extrudeMesh(heaterInnerPoly, 0.026), [0, 0.040, 0.106])
  const heaterField = bakeVertexAO(
    bakeZoneColors(rawHeaterField, (_cx, cy) => (cy > 0.04 ? WHITE : [0.88, 0.88, 0.92, 1])),
    { strength: 0.14, verticalGradient: 0.08 }
  )
  const heaterCrest = bakeVertexAO(
    mergeMeshes([
      // Raised faceted diamond heraldic crest
      transformMesh(
        extrudeMesh([[0, -0.108], [0.082, 0], [0, 0.108], [-0.082, 0]], 0.026),
        [0, 0.045, 0.124]
      ),
      transformMesh(octahedron, [0, 0.045, 0.138], ZERO_ROT, [0.046, 0.062, 0.028]),
      // 4 crisp corner studs
      transformMesh(octahedron, [-0.142, 0.168, 0.114], ZERO_ROT, [0.018, 0.018, 0.016]),
      transformMesh(octahedron, [ 0.142, 0.168, 0.114], ZERO_ROT, [0.018, 0.018, 0.016]),
      transformMesh(octahedron, [-0.122, -0.085, 0.114], ZERO_ROT, [0.018, 0.018, 0.016]),
      transformMesh(octahedron, [ 0.122, -0.085, 0.114], ZERO_ROT, [0.018, 0.018, 0.016])
    ]),
    { strength: 0.14, verticalGradient: 0.06 }
  )

  // --- 13. Shield Tower Paladin ---
  const paladinOuterPoly: readonly (readonly [number, number])[] = [
    [0, -0.320], [0.142, -0.242], [0.205, -0.080], [0.214, 0.210],
    [0.145, 0.295], [0, 0.325], [-0.145, 0.295], [-0.214, 0.210],
    [-0.205, -0.080], [-0.142, -0.242]
  ]
  const paladinCobaltPoly: readonly (readonly [number, number])[] = [
    [0, -0.278], [0.118, -0.208], [0.172, -0.068], [0.178, 0.185],
    [0.120, 0.258], [0, 0.284], [-0.120, 0.258], [-0.178, 0.185],
    [-0.172, -0.068], [-0.118, -0.208]
  ]
  const paladinIvoryPoly: readonly (readonly [number, number])[] = [
    [0, -0.218], [0.088, -0.160], [0.132, -0.048], [0.136, 0.152],
    [0.090, 0.210], [0, 0.232], [-0.090, 0.210], [-0.136, 0.152],
    [-0.132, -0.048], [-0.088, -0.160]
  ]
  const paladinRim = bakeVertexAO(
    transformMesh(extrudeMesh(paladinOuterPoly, 0.046), [0, 0.055, 0.092]),
    { strength: 0.18, verticalGradient: 0.10 }
  )
  const paladinCobalt = bakeVertexAO(
    transformMesh(extrudeMesh(paladinCobaltPoly, 0.026), [0, 0.055, 0.108]),
    { strength: 0.15, verticalGradient: 0.08 }
  )
  const paladinIvory = bakeVertexAO(
    transformMesh(extrudeMesh(paladinIvoryPoly, 0.022), [0, 0.055, 0.118]),
    { strength: 0.12, verticalGradient: 0.06 }
  )
  const paladinCross = bakeVertexAO(
    mergeMeshes([
      // Vertical flared gold cross beam
      transformMesh(
        extrudeMesh([
          [-0.024, -0.185], [0.024, -0.185], [0.018, -0.04], [0.018, 0.10],
          [0.032, 0.185], [-0.032, 0.185], [-0.018, 0.10], [-0.018, -0.04]
        ], 0.024),
        [0, 0.065, 0.132]
      ),
      // Horizontal flared gold cross beam
      transformMesh(
        extrudeMesh([
          [-0.118, 0.012], [-0.040, 0.020], [0.040, 0.020], [0.118, 0.012],
          [0.118, 0.070], [0.040, 0.062], [-0.040, 0.062], [-0.118, 0.070]
        ], 0.024),
        [0, 0.065, 0.132]
      )
    ]),
    { strength: 0.12, verticalGradient: 0.06 }
  )
  const paladinGem = transformMesh(octahedron, [0, 0.106, 0.148], ZERO_ROT, [0.036, 0.044, 0.024])

  // --- 14. Shield Buckler (Compact Round Faceted Iron-and-Wood Buckler) ---
  const bucklerOuterPts: [number, number][] = []
  const bucklerInnerPts: [number, number][] = []
  const bucklerSides = 10
  for (let i = 0; i < bucklerSides; i++) {
    const a = (i / bucklerSides) * Math.PI * 2 + Math.PI / bucklerSides
    bucklerOuterPts.push([Math.cos(a) * 0.195, Math.sin(a) * 0.195])
    bucklerInnerPts.push([Math.cos(a) * 0.156, Math.sin(a) * 0.156])
  }
  const bucklerRim = bakeVertexAO(
    mergeMeshes([
      transformMesh(extrudeMesh(bucklerOuterPts, 0.038), [0, 0.020, 0.084]),
      // 4 crisp iron rim rivets
      transformMesh(octahedron, [ 0.000,  0.195, 0.102], ZERO_ROT, [0.018, 0.018, 0.016]),
      transformMesh(octahedron, [ 0.000, -0.155, 0.102], ZERO_ROT, [0.018, 0.018, 0.016]),
      transformMesh(octahedron, [ 0.175,  0.020, 0.102], ZERO_ROT, [0.018, 0.018, 0.016]),
      transformMesh(octahedron, [-0.175,  0.020, 0.102], ZERO_ROT, [0.018, 0.018, 0.016])
    ]),
    { strength: 0.18, verticalGradient: 0.08 }
  )
  const rawBucklerWood = transformMesh(extrudeMesh(bucklerInnerPts, 0.024), [0, 0.020, 0.098])
  const bucklerWood = bakeVertexAO(
    bakeZoneColors(rawBucklerWood, (cx) => {
      const band = Math.floor((cx + 0.2) * 16) % 2
      return band === 0 ? WHITE : [0.89, 0.85, 0.82, 1]
    }),
    { strength: 0.14, verticalGradient: 0.08 }
  )
  const bucklerBoss = bakeVertexAO(
    transformMesh(
      sculptLoft([
        { y: 0.000, rx: 0.072, rz: 0.072 },
        { y: 0.032, rx: 0.056, rz: 0.056 },
        { y: 0.054, rx: 0.022, rz: 0.022 }
      ], { sides: 8 }),
      [0, 0.020, 0.108],
      [Math.PI * 0.5, 0, 0]
    ),
    { strength: 0.14, verticalGradient: 0.06 }
  )

  // --- 15. Shield Obsidian (Menacing Jagged Dark-Iron Boss Shield + Violet Gem) ---
  const obsidianShieldOuter: readonly (readonly [number, number])[] = [
    [0, -0.295], [0.135, -0.185], [0.228, -0.020], [0.212, 0.155],
    [0.242, 0.268], [0.125, 0.218], [0, 0.278], [-0.125, 0.218],
    [-0.242, 0.268], [-0.212, 0.155], [-0.228, -0.020], [-0.135, -0.185]
  ]
  const obsidianShieldInner: readonly (readonly [number, number])[] = [
    [0, -0.225], [0.102, -0.140], [0.168, -0.012], [0.158, 0.135],
    [0.095, 0.182], [0, 0.205], [-0.095, 0.182], [-0.158, 0.135],
    [-0.168, -0.012], [-0.102, -0.140]
  ]
  const obsidianShieldRim = bakeVertexAO(
    transformMesh(extrudeMesh(obsidianShieldOuter, 0.048), [0, 0.045, 0.090]),
    { strength: 0.18, verticalGradient: 0.10 }
  )
  const obsidianShieldField = bakeVertexAO(
    transformMesh(extrudeMesh(obsidianShieldInner, 0.026), [0, 0.045, 0.108]),
    { strength: 0.16, verticalGradient: 0.08 }
  )
  const clawSpike = extrudeMesh([[0.040, -0.018], [0.138, 0], [0.040, 0.018]], 0.024)
  const obsidianShieldClaws = bakeVertexAO(
    mergeMeshes([
      transformMesh(clawSpike, [0, 0.048, 0.126], [0, 0, Math.PI * 0.25]),
      transformMesh(clawSpike, [0, 0.048, 0.126], [0, 0, Math.PI * 0.75]),
      transformMesh(clawSpike, [0, 0.048, 0.126], [0, 0, Math.PI * 1.25]),
      transformMesh(clawSpike, [0, 0.048, 0.126], [0, 0, Math.PI * 1.75])
    ]),
    { strength: 0.14, verticalGradient: 0.06 }
  )
  const obsidianShieldGem = transformMesh(octahedron, [0, 0.048, 0.138], ZERO_ROT, [0.058, 0.088, 0.042])

  // --- 16. Offhand Bow Recurve ---
  // Grip seated squarely at [0, 0, 0]; bold C-arch sweeps forward (+Z) out of the palm, curves back to
  // recurve knees, and kicks cleanly forward at horn tips — with a razor-straight taut bowstring!
  const bowLimbs = bakeVertexAO(
    tubeMesh(
      [
        [0, -0.37, -0.145],
        [0, -0.25, -0.045],
        [0, -0.12,  0.008],
        [0,  0.00,  0.010],
        [0,  0.12,  0.008],
        [0,  0.27, -0.045],
        [0,  0.41, -0.145]
      ],
      [0.023, 0.028, 0.032, 0.031, 0.032, 0.028, 0.023],
      6
    ),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const bowGrip = sculptLoft([
    { y: -0.082, rx: 0.035, rz: 0.038, zOffset: 0.009 },
    { y:  0.000, rx: 0.037, rz: 0.040, zOffset: 0.010 },
    { y:  0.082, rx: 0.035, rz: 0.038, zOffset: 0.009 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const bowTips = bakeVertexAO(
    mergeMeshes([
      // Top & bottom recurve horn tips kicking gracefully forward (+Z)
      tubeMesh(
        [[0, 0.39, -0.132], [0, 0.445, -0.155], [0, 0.495, -0.118]],
        [0.025, 0.021, 0.012],
        6
      ),
      tubeMesh(
        [[0, -0.35, -0.132], [0, -0.400, -0.152], [0, -0.440, -0.118]],
        [0.025, 0.021, 0.012],
        6
      ),
      // Decorative horn/ivory riser collars
      sculptLoft([
        { y: 0.110, rx: 0.036, rz: 0.036, zOffset: 0.008 },
        { y: 0.150, rx: 0.035, rz: 0.035, zOffset: 0.002 }
      ], { sides: 6 }),
      sculptLoft([
        { y: -0.150, rx: 0.035, rz: 0.035, zOffset: 0.002 },
        { y: -0.110, rx: 0.036, rz: 0.036, zOffset: 0.008 }
      ], { sides: 6 })
    ]),
    { strength: 0.14, verticalGradient: 0.06 }
  )

  // Razor-straight taut bowstring spanning directly between the recurve nocks
  const bowString = tubeMesh(
    [[0, -0.425, -0.130], [0, 0.475, -0.130]],
    [0.008, 0.008],
    4
  )

  // --- 17. Offhand Spell Orb ---
  const orbCrystal = sculptLoft([
    { y: -0.112, rx: 0.006, rz: 0.006 },
    { y: -0.055, rx: 0.088, rz: 0.088 },
    { y:  0.000, rx: 0.108, rz: 0.108 },
    { y:  0.055, rx: 0.088, rz: 0.088 },
    { y:  0.112, rx: 0.006, rz: 0.006 }
  ], { sides: 8, aoStrength: 0.06, aoGradient: 0.04 })

  const orbRing = mergeMeshes([
    transformMesh(ringTube(0.156, 0.016, 12, 5), [0, 0, 0], [0.56, 0.22, 0.36]),
    transformMesh(ringTube(0.132, 0.011, 10, 4), [0, 0, 0], [-0.48, -0.18, -0.44])
  ])

  const orbShards = mergeMeshes([
    transformMesh(octahedron, [ 0.145,  0.068,  0.042], [0.3, 0.2, 0.1], [0.024, 0.036, 0.024]),
    transformMesh(octahedron, [-0.140, -0.058, -0.036], [-0.2, 0.4, 0.2], [0.022, 0.032, 0.022])
  ])

  // --- 18. Offhand Tome (Heavy Leather-and-Gold Clasped Arcane Spellbook) ---
  const tomeCover = bakeVertexAO(
    mergeMeshes([
      // Front leather cover (+Z)
      transformMesh(bevelBox(0.16), [0, 0.02, 0.046], ZERO_ROT, [0.220, 0.295, 0.022]),
      // Back leather cover (-Z)
      transformMesh(bevelBox(0.16), [0, 0.02, -0.046], ZERO_ROT, [0.220, 0.295, 0.022]),
      // Heavy rounded spine (-X)
      transformMesh(bevelBox(0.22), [-0.102, 0.02, 0], ZERO_ROT, [0.034, 0.298, 0.114])
    ]),
    { strength: 0.18, verticalGradient: 0.08 }
  )

  const tomePages = bakeVertexAO(
    transformMesh(bevelBox(0.10), [0.008, 0.02, 0], ZERO_ROT, [0.194, 0.264, 0.072]),
    { strength: 0.14, verticalGradient: 0.06 }
  )

  const tomeGold = bakeVertexAO(
    mergeMeshes([
      // Front 4 gold corner brackets
      transformMesh(bevelBox(0.14), [ 0.086,  0.144, 0.054], ZERO_ROT, [0.054, 0.054, 0.018]),
      transformMesh(bevelBox(0.14), [ 0.086, -0.104, 0.054], ZERO_ROT, [0.054, 0.054, 0.018]),
      transformMesh(bevelBox(0.14), [-0.086,  0.144, 0.054], ZERO_ROT, [0.054, 0.054, 0.018]),
      transformMesh(bevelBox(0.14), [-0.086, -0.104, 0.054], ZERO_ROT, [0.054, 0.054, 0.018]),
      // Heavy golden book clasp wrapping the fore-edge (+X)
      transformMesh(bevelBox(0.14), [0.108, 0.02, 0], ZERO_ROT, [0.024, 0.064, 0.122]),
      transformMesh(bevelBox(0.14), [0.082, 0.02, 0.056], ZERO_ROT, [0.058, 0.044, 0.018]),
      // Raised gold spine ribs
      transformMesh(bevelBox(0.14), [-0.114,  0.095, 0], ZERO_ROT, [0.020, 0.022, 0.120]),
      transformMesh(bevelBox(0.14), [-0.114, -0.055, 0], ZERO_ROT, [0.020, 0.022, 0.120])
    ]),
    { strength: 0.14, verticalGradient: 0.06 }
  )

  const tomeSigil = mergeMeshes([
    transformMesh(octahedron, [0.002, 0.022, 0.060], ZERO_ROT, [0.046, 0.068, 0.016]),
    transformMesh(
      extrudeMesh([[-0.058, 0.006], [0.058, 0.006], [0.058, -0.006], [-0.058, -0.006]], 0.012),
      [0.002, 0.022, 0.060]
    )
  ])

  cachedMeshes = {
    broadswordGrip,
    broadswordPommel,
    broadswordGuard,
    broadswordBlade,
    broadswordFuller,
    sunbladeGrip,
    sunbladePommel,
    sunbladeGuard,
    sunbladeGem,
    sunbladeBlade,
    sunbladeCore,
    arrowShaft,
    arrowFletching,
    arrowHead,
    arrowNock,
    staffArcaneShaft,
    staffArcaneGrip,
    staffArcaneGold,
    staffArcaneCrystal,
    staffFrostShaft,
    staffFrostGrip,
    staffFrostSpires,
    staffFrostDiamond,
    maceGrip,
    maceShaft,
    maceHeadGold,
    maceCore,
    daggerGrip,
    daggerGuard,
    daggerBlade,
    daggerEdge,
    offDaggerBlade,
    offDaggerEdge,
    axeHaft,
    axeWrap,
    axeCollar,
    axeBlades,
    axeEdges,
    axeRivets,
    scytheShaft,
    scytheWrap,
    scytheCollar,
    scytheBlade,
    scytheEdge,
    cleaverGrip,
    cleaverGuard,
    cleaverBlade,
    cleaverEdge,
    cleaverRivets,
    obsidianGrip,
    obsidianGuard,
    obsidianBlade,
    obsidianEdges,
    obsidianRunes,
    shieldGrip,
    heaterRim,
    heaterField,
    heaterCrest,
    paladinRim,
    paladinCobalt,
    paladinIvory,
    paladinCross,
    paladinGem,
    bucklerRim,
    bucklerWood,
    bucklerBoss,
    obsidianShieldRim,
    obsidianShieldField,
    obsidianShieldClaws,
    obsidianShieldGem,
    bowLimbs,
    bowGrip,
    bowTips,
    bowString,
    orbCrystal,
    orbRing,
    orbShards,
    tomeCover,
    tomePages,
    tomeGold,
    tomeSigil
  }
  return cachedMeshes
}

// ---------------------------------------------------------------------------
// Public Registration Function
// ---------------------------------------------------------------------------

interface EclipseScepterMeshes {
  readonly shaft: Mesh
  readonly grip: Mesh
  readonly gold: Mesh
  readonly orb: Mesh
  readonly ring: Mesh
}

let cachedEclipseScepter: EclipseScepterMeshes | undefined

/** Boss scepter: long shaft, gold crescent cradle holding a dark eclipse orb wrapped in a glowing ring. */
function getEclipseScepterMeshes(): EclipseScepterMeshes {
  if (cachedEclipseScepter) return cachedEclipseScepter
  const shaft = sculptLoft([
    { y: -0.42, rx: 0.026, rz: 0.026 },
    { y: -0.10, rx: 0.030, rz: 0.030 },
    { y: 0.30, rx: 0.031, rz: 0.031 },
    { y: 0.66, rx: 0.036, rz: 0.036 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })
  const grip = sculptLoft([
    { y: -0.095, rx: 0.037, rz: 0.037 },
    { y: 0.000, rx: 0.039, rz: 0.039 },
    { y: 0.095, rx: 0.037, rz: 0.037 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })
  const collar = sculptLoft([
    { y: 0.620, rx: 0.040, rz: 0.040 },
    { y: 0.660, rx: 0.058, rz: 0.058 },
    { y: 0.710, rx: 0.044, rz: 0.044 }
  ], { sides: 6 })
  const butt = sculptLoft([
    { y: -0.500, rx: 0.006, rz: 0.006 },
    { y: -0.450, rx: 0.040, rz: 0.040 },
    { y: -0.410, rx: 0.034, rz: 0.034 }
  ], { sides: 6 })
  const cy = 0.880
  const arcPts: Vec3[] = []
  const arcR: number[] = []
  for (let i = 0; i <= 8; i++) {
    const a = (150 + (240 * i) / 8) * Math.PI / 180
    arcPts.push([Math.cos(a) * 0.180, cy + Math.sin(a) * 0.180, 0])
    const t = Math.sin((i / 8) * Math.PI)
    arcR.push(0.008 + t * 0.030)
  }
  const crescent = tubeMesh(arcPts, arcR, 5)
  const spike = sculptLoft([
    { y: 0.690, rx: 0.030, rz: 0.030 },
    { y: 0.720, rx: 0.020, rz: 0.020 }
  ], { sides: 6 })
  const gold = bakeVertexAO(mergeMeshes([collar, butt, crescent, spike]), { strength: 0.12, verticalGradient: 0.06 })
  const orb = sculptLoft([
    { y: cy - 0.092, rx: 0.020, rz: 0.020 },
    { y: cy - 0.062, rx: 0.072, rz: 0.072 },
    { y: cy, rx: 0.094, rz: 0.094 },
    { y: cy + 0.062, rx: 0.072, rz: 0.072 },
    { y: cy + 0.092, rx: 0.020, rz: 0.020 }
  ], { sides: 8, aoStrength: 0.10, aoGradient: 0.04 })
  const ringPts: Vec3[] = []
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2
    ringPts.push([Math.cos(a) * 0.118, cy + Math.sin(a) * 0.118, 0.012])
  }
  const ring = tubeMesh(ringPts, 0.016, 4)
  cachedEclipseScepter = { shaft, grip, gold, orb, ring }
  return cachedEclipseScepter
}

/**
 * Register all Crownshard main-hand weapons (11) and off-hand shields & relics (8)
 * onto a Ridgetop `CharacterBuilder`.
 */
export function registerCrownshardWeapons(builder: CharacterBuilder): void {
  // =========================================================================
  // MAIN HAND (`mainHand`) — 11 Weapons
  // =========================================================================

  builder.registerPart('mainHand', 'weapon_broadsword', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const steel = mixColor(palette.metal, C_BRIGHT_STEEL, 0.35)
    const gold = mixColor(palette.accent, C_SUN_GOLD, 0.45)
    return orientParts([
      { name: 'broadsword_grip', mesh: m.broadswordGrip, color: palette.leather },
      { name: 'broadsword_pommel', mesh: m.broadswordPommel, color: gold },
      { name: 'broadsword_guard', mesh: m.broadswordGuard, color: gold },
      { name: 'broadsword_blade', mesh: m.broadswordBlade, color: steel },
      { name: 'broadsword_fuller', mesh: m.broadswordFuller, color: palette.metalDark }
    ], [1.06, 0.10, -0.08])
  })

  builder.registerPart('mainHand', 'weapon_sunblade', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const gildedSteel = mixColor(palette.metal, [0.97, 0.92, 0.78, 1], 0.45)
    const gripCrimson = mixColor(palette.leather, C_CRIMSON_DARK, 0.55)
    return orientParts([
      { name: 'sunblade_grip', mesh: m.sunbladeGrip, color: gripCrimson },
      { name: 'sunblade_pommel', mesh: m.sunbladePommel, color: C_SUN_GOLD },
      { name: 'sunblade_guard', mesh: m.sunbladeGuard, color: C_SUN_GOLD },
      { name: 'sunblade_gem', mesh: m.sunbladeGem, color: C_SUN_GLOW, unlit: 0.92 },
      { name: 'sunblade_blade', mesh: m.sunbladeBlade, color: gildedSteel },
      { name: 'sunblade_core', mesh: m.sunbladeCore, color: C_SUN_GLOW, unlit: 0.94 }
    ], [0.88, 0.12, -0.10])
  })

  builder.registerPart('mainHand', 'weapon_arrow_nocked', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const fletch = mixColor(palette.accent, [0.95, 0.32, 0.24, 1], 0.45)
    const steel = mixColor(palette.metal, C_BRIGHT_STEEL, 0.40)
    return orientParts([
      { name: 'arrow_shaft', mesh: m.arrowShaft, color: palette.leatherLight },
      { name: 'arrow_nock', mesh: m.arrowNock, color: C_HORN_IVORY },
      { name: 'arrow_fletching', mesh: m.arrowFletching, color: fletch },
      { name: 'arrow_head', mesh: m.arrowHead, color: steel }
    ], [1.22, 0.14, -0.06])
  })

  builder.registerPart('mainHand', 'weapon_staff_arcane', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const wood = mixColor(palette.leather, C_DARK_WOOD, 0.35)
    const gold = mixColor(palette.accent, C_SUN_GOLD, 0.45)
    const cyan = mixColor(palette.glow, C_ARCANE_CYAN, 0.65)
    return orientParts([
      { name: 'staff_arcane_shaft', mesh: m.staffArcaneShaft, color: wood },
      { name: 'staff_arcane_grip', mesh: m.staffArcaneGrip, color: palette.leatherLight },
      { name: 'staff_arcane_gold', mesh: m.staffArcaneGold, color: gold },
      { name: 'staff_arcane_crystal', mesh: m.staffArcaneCrystal, color: cyan, unlit: 0.95 }
    ], [0.20, 0.04, -0.06])
  })

  builder.registerPart('mainHand', 'weapon_staff_frost', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const shaft = mixColor(palette.metalDark, C_FROST_SHAFT, 0.60)
    return orientParts([
      { name: 'staff_frost_shaft', mesh: m.staffFrostShaft, color: shaft },
      { name: 'staff_frost_grip', mesh: m.staffFrostGrip, color: palette.leather },
      { name: 'staff_frost_spires', mesh: m.staffFrostSpires, color: C_FROST_ICE, unlit: 0.28 },
      { name: 'staff_frost_diamond', mesh: m.staffFrostDiamond, color: C_FROST_GLOW, unlit: 0.96 }
    ], [0.20, 0.04, -0.06])
  })

  builder.registerPart('mainHand', 'weapon_mace_sun', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const gold = mixColor(palette.accent, C_SUN_GOLD, 0.60)
    return orientParts([
      { name: 'mace_sun_grip', mesh: m.maceGrip, color: palette.leather },
      { name: 'mace_sun_shaft', mesh: m.maceShaft, color: palette.metalDark },
      { name: 'mace_sun_head', mesh: m.maceHeadGold, color: gold },
      { name: 'mace_sun_core', mesh: m.maceCore, color: C_SUN_GLOW, unlit: 0.95 }
    ], [0.92, 0.10, -0.08])
  })

  builder.registerPart('mainHand', 'weapon_dagger', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const darkBlade = mixColor(palette.metalDark, C_DARK_STEEL, 0.65)
    const brightEdge = mixColor(palette.metal, C_BRIGHT_STEEL, 0.42)
    return orientParts([
      { name: 'dagger_grip', mesh: m.daggerGrip, color: C_CRIMSON },
      { name: 'dagger_guard', mesh: m.daggerGuard, color: C_CRIMSON_DARK },
      { name: 'dagger_blade', mesh: m.daggerBlade, color: darkBlade },
      { name: 'dagger_edge', mesh: m.daggerEdge, color: brightEdge }
    ], [0.98, 0.16, -0.08])
  })

  builder.registerPart('mainHand', 'weapon_greataxe', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const wood = mixColor(palette.leather, C_DARK_WOOD, 0.40)
    const darkIron = shadeColor(palette.metalDark, -0.06)
    const brightEdge = mixColor(palette.metal, C_BRIGHT_STEEL, 0.55)
    return orientParts([
      { name: 'greataxe_haft', mesh: m.axeHaft, color: wood },
      { name: 'greataxe_wrap', mesh: m.axeWrap, color: palette.leatherLight },
      { name: 'greataxe_collar', mesh: m.axeCollar, color: darkIron },
      { name: 'greataxe_blades', mesh: m.axeBlades, color: palette.metalDark },
      { name: 'greataxe_edges', mesh: m.axeEdges, color: brightEdge },
      { name: 'greataxe_rivets', mesh: m.axeRivets, color: C_BRIGHT_STEEL }
    ], [0.76, 0.10, -0.10])
  })

  builder.registerPart('mainHand', 'weapon_scythe_bone', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const darkIron = shadeColor(palette.metalDark, -0.08)
    const edgeSilver = mixColor(palette.metal, C_BRIGHT_STEEL, 0.55)
    return orientParts([
      { name: 'scythe_shaft', mesh: m.scytheShaft, color: C_BONE },
      { name: 'scythe_wrap', mesh: m.scytheWrap, color: palette.leather },
      { name: 'scythe_collar', mesh: m.scytheCollar, color: C_BONE_SHADE },
      { name: 'scythe_blade', mesh: m.scytheBlade, color: darkIron },
      { name: 'scythe_edge', mesh: m.scytheEdge, color: edgeSilver }
    ], [0.16, 0.18, -0.10])
  })

  builder.registerPart('mainHand', 'weapon_goblin_cleaver', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const edgeSteel = mixColor(palette.metal, C_BRIGHT_STEEL, 0.35)
    return orientParts([
      { name: 'cleaver_grip', mesh: m.cleaverGrip, color: palette.leather },
      { name: 'cleaver_guard', mesh: m.cleaverGuard, color: C_GOBLIN_RUST },
      { name: 'cleaver_blade', mesh: m.cleaverBlade, color: C_GOBLIN_IRON },
      { name: 'cleaver_edge', mesh: m.cleaverEdge, color: edgeSteel },
      { name: 'cleaver_rivets', mesh: m.cleaverRivets, color: C_BRIGHT_STEEL }
    ], [0.98, 0.12, -0.08])
  })

  builder.registerPart('mainHand', 'weapon_obsidian_greatsword', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const darkGrip = mixColor(palette.leather, C_OBSIDIAN, 0.55)
    const blade = mixColor(C_OBSIDIAN, palette.metalDark, 0.35)
    const guard = mixColor(C_OBSIDIAN_EDGE, palette.accent, 0.35)
    const edges = mixColor(C_OBSIDIAN_EDGE, palette.metal, 0.45)
    const runes = mixColor(palette.glow, C_VIOLET_GLOW, 0.30)
    return orientParts([
      { name: 'obsidian_sword_grip', mesh: m.obsidianGrip, color: darkGrip },
      { name: 'obsidian_sword_guard', mesh: m.obsidianGuard, color: guard },
      { name: 'obsidian_sword_blade', mesh: m.obsidianBlade, color: blade },
      { name: 'obsidian_sword_edges', mesh: m.obsidianEdges, color: edges },
      { name: 'obsidian_sword_runes', mesh: m.obsidianRunes, color: runes, unlit: 0.96 }
    ], [0.86, 0.12, -0.10])
  })

  builder.registerPart('mainHand', 'weapon_eclipse_scepter', (palette: CharacterPalette) => {
    const m = getEclipseScepterMeshes()
    const shaft = mixColor(palette.metalDark, palette.primary, 0.35)
    const gold = mixColor(palette.accent, C_SUN_GOLD, 0.50)
    const orb = mixColor(palette.metalDark, [0.10, 0.06, 0.16, 1], 0.55)
    return orientParts([
      { name: 'eclipse_scepter_shaft', mesh: m.shaft, color: shaft },
      { name: 'eclipse_scepter_grip', mesh: m.grip, color: palette.leather },
      { name: 'eclipse_scepter_gold', mesh: m.gold, color: gold },
      { name: 'eclipse_scepter_orb', mesh: m.orb, color: orb },
      { name: 'eclipse_scepter_ring', mesh: m.ring, color: palette.glow, unlit: 0.96 }
    ], [0.20, 0.04, -0.06])
  })

  // =========================================================================
  // OFF HAND (`offHand`) — 8 Shields & Relics
  // =========================================================================

  builder.registerPart('offHand', 'shield_heater', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const gold = mixColor(palette.accent, C_SUN_GOLD, 0.45)
    return orientParts([
      { name: 'shield_heater_grip', mesh: m.shieldGrip, color: palette.leather },
      { name: 'shield_heater_rim', mesh: m.heaterRim, color: gold },
      { name: 'shield_heater_field', mesh: m.heaterField, color: palette.primary },
      { name: 'shield_heater_crest', mesh: m.heaterCrest, color: shadeColor(gold, 0.06) }
    ], [-0.06, -0.82, 0.04])
  })

  builder.registerPart('offHand', 'shield_tower_paladin', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const gold = mixColor(palette.accent, C_SUN_GOLD, 0.65)
    return orientParts([
      { name: 'shield_paladin_grip', mesh: m.shieldGrip, color: palette.leather },
      { name: 'shield_paladin_rim', mesh: m.paladinRim, color: gold },
      { name: 'shield_paladin_cobalt', mesh: m.paladinCobalt, color: C_PALADIN_COBALT },
      { name: 'shield_paladin_ivory', mesh: m.paladinIvory, color: C_PALADIN_IVORY },
      { name: 'shield_paladin_cross', mesh: m.paladinCross, color: C_SUN_GOLD },
      { name: 'shield_paladin_gem', mesh: m.paladinGem, color: C_SUN_GLOW, unlit: 0.92 }
    ], [-0.05, -0.82, 0.04])
  })

  builder.registerPart('offHand', 'shield_buckler', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const iron = mixColor(palette.metalDark, C_DARK_STEEL, 0.40)
    const steelBoss = mixColor(palette.metal, C_BRIGHT_STEEL, 0.35)
    return orientParts([
      { name: 'shield_buckler_grip', mesh: m.shieldGrip, color: palette.leather },
      { name: 'shield_buckler_rim', mesh: m.bucklerRim, color: iron },
      { name: 'shield_buckler_wood', mesh: m.bucklerWood, color: palette.leatherLight },
      { name: 'shield_buckler_boss', mesh: m.bucklerBoss, color: steelBoss }
    ], [-0.04, -0.88, 0.04])
  })

  builder.registerPart('offHand', 'shield_obsidian', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const field = mixColor(palette.primary, palette.metalDark, 0.35)
    const rim = mixColor(C_OBSIDIAN_EDGE, palette.metal, 0.45)
    const claws = mixColor(C_OBSIDIAN_EDGE, palette.accent, 0.55)
    const gem = mixColor(palette.glow, C_VIOLET_GLOW, 0.25)
    return orientParts([
      { name: 'shield_obsidian_grip', mesh: m.shieldGrip, color: palette.leather },
      { name: 'shield_obsidian_rim', mesh: m.obsidianShieldRim, color: rim },
      { name: 'shield_obsidian_field', mesh: m.obsidianShieldField, color: field },
      { name: 'shield_obsidian_claws', mesh: m.obsidianShieldClaws, color: claws },
      { name: 'shield_obsidian_gem', mesh: m.obsidianShieldGem, color: gem, unlit: 0.96 }
    ], [-0.05, -0.82, 0.04])
  })

  builder.registerPart('offHand', 'offhand_bow_recurve', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const wood = mixColor(palette.leatherLight, C_BOW_WOOD, 0.55)
    return orientParts([
      { name: 'bow_recurve_limbs', mesh: m.bowLimbs, color: wood },
      { name: 'bow_recurve_grip', mesh: m.bowGrip, color: palette.leather },
      { name: 'bow_recurve_tips', mesh: m.bowTips, color: C_HORN_IVORY },
      { name: 'bow_recurve_string', mesh: m.bowString, color: C_PARCHMENT }
    ], [0.12, -0.22, 0.22], [-0.012, 0.010, 0.020])
  })

  builder.registerPart('offHand', 'offhand_spell_orb', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const gold = mixColor(palette.accent, C_SUN_GOLD, 0.50)
    const cyan = mixColor(palette.glow, C_ARCANE_CYAN, 0.55)
    return orientParts([
      { name: 'spell_orb_crystal', mesh: m.orbCrystal, color: cyan, unlit: 0.96 },
      { name: 'spell_orb_ring', mesh: m.orbRing, color: gold },
      { name: 'spell_orb_shards', mesh: m.orbShards, color: C_SUN_GLOW, unlit: 0.88 }
    ], [0, 0, 0], [-0.024, 0.032, 0.108])
  })

  builder.registerPart('offHand', 'offhand_tome', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const cover = mixColor(palette.leather, C_TOME_COVER, 0.65)
    const gold = mixColor(palette.accent, C_SUN_GOLD, 0.55)
    const sigil = mixColor(palette.glow, C_ARCANE_CYAN, 0.50)
    return orientParts([
      { name: 'tome_cover', mesh: m.tomeCover, color: cover },
      { name: 'tome_pages', mesh: m.tomePages, color: C_PARCHMENT },
      { name: 'tome_gold', mesh: m.tomeGold, color: gold },
      { name: 'tome_sigil', mesh: m.tomeSigil, color: sigil, unlit: 0.95 }
    ], [0.22, -0.62, 0.16], [-0.036, 0.012, 0.052])
  })

  builder.registerPart('offHand', 'offhand_dagger', (palette: CharacterPalette) => {
    const m = getWeaponMeshes()
    const darkBlade = mixColor(palette.metalDark, C_DARK_STEEL, 0.65)
    const brightEdge = mixColor(palette.metal, C_BRIGHT_STEEL, 0.42)
    return orientParts([
      { name: 'offhand_dagger_grip', mesh: m.daggerGrip, color: C_CRIMSON },
      { name: 'offhand_dagger_guard', mesh: m.daggerGuard, color: C_CRIMSON_DARK },
      { name: 'offhand_dagger_blade', mesh: m.offDaggerBlade, color: darkBlade },
      { name: 'offhand_dagger_edge', mesh: m.offDaggerEdge, color: brightEdge }
    ], [0.98, -0.16, 0.08])
  })
}
