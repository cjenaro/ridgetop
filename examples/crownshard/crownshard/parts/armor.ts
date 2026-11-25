import {
  bakeVertexAO,
  bakeZoneColors,
  mixColor,
  octahedron,
  sculptLoft,
  shadeColor,
  tubeMesh
} from 'ridgetop'
import type {
  CharacterBuilder,
  CharacterPalette,
  Color,
  Mesh,
  RigPart,
  SculptLoftPolygonRing,
  Vec3
} from 'ridgetop'

const WHITE: Color = [1, 1, 1, 1]
const IVORY: Color = [0.97, 0.95, 0.89, 1]
const RADIANT_GOLD: Color = [0.96, 0.78, 0.26, 1]
const OBSIDIAN: Color = [0.16, 0.14, 0.22, 1]
const CRIMSON: Color = [0.78, 0.16, 0.22, 1]
const VIOLET_RUNE: Color = [0.72, 0.34, 0.98, 1]
const FUR_CREAM: Color = [0.91, 0.87, 0.80, 1]

type Side = -1 | 1

// ---------------------------------------------------------------------------
// Polygon Helpers (guaranteed convex / clean winding for sculptLoft)
// ---------------------------------------------------------------------------

function makeStarRing(
  y: number,
  spikes: number,
  outerRx: number,
  outerRz: number,
  innerRx: number,
  innerRz: number,
  xOff = 0,
  zOff = 0,
  phase = 0
): SculptLoftPolygonRing {
  const pts: [number, number][] = []
  const total = spikes * 2
  for (let i = 0; i < total; i++) {
    const a = (i / total) * Math.PI * 2 + phase
    const isOuter = i % 2 === 0
    const rx = isOuter ? outerRx : innerRx
    const rz = isOuter ? outerRz : innerRz
    pts.push([Math.cos(a) * rx + xOff, Math.sin(a) * rz + zOff])
  }
  return { y, points: pts }
}

/**
 * Convex 6-point cape ribbon cross-section with a subtle faceted back fold ridge.
 * Keeping the cross-section convex guarantees clean top/bottom caps with zero crossing faces.
 */
function makeCapeRing(
  y: number,
  halfW: number,
  zFront: number,
  thickness: number,
  archBack: number
): SculptLoftPolygonRing {
  const zEdge = zFront - thickness * 0.45
  const zBackMid = zFront - thickness - archBack
  const zBackSide = zFront - thickness - archBack * 0.55
  return {
    y,
    points: [
      [-halfW, zEdge],
      [0, zFront],
      [halfW, zEdge],
      [halfW * 0.52, zBackSide],
      [0, zBackMid],
      [-halfW * 0.52, zBackSide]
    ]
  }
}

/**
 * Faceted shield-diamond plate centered at [0, 0, 0] facing +Z.
 */
function createCrestDiamondMesh(width: number, height: number, depth: number): Mesh {
  return sculptLoft([
    { y: -height, rx: width * 0.14, rz: depth * 0.35 },
    { y: -height * 0.25, rx: width * 0.85, rz: depth },
    { y: height * 0.32, rx: width, rz: depth },
    { y: height, rx: width * 0.42, rz: depth * 0.45 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })
}

/**
 * Faceted beveled hexagonal prism oriented along Y (rotate X by PI/2 to face +Z).
 */
function createHexDiscMesh(radius: number, thickness: number, bevel: number): Mesh {
  const halfT = thickness * 0.5
  const innerR = Math.max(0.005, radius - bevel)
  return sculptLoft([
    { y: -halfT, rx: innerR, rz: innerR, angleOffset: 0 },
    { y: -halfT * 0.45, rx: radius, rz: radius, angleOffset: 0 },
    { y: halfT * 0.45, rx: radius, rz: radius, angleOffset: 0 },
    { y: halfT, rx: innerR, rz: innerR, angleOffset: 0 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })
}

function createShoulderShell(
  side: Side,
  yBot: number,
  yTop: number,
  innerX: number,
  outerX: number,
  rzBase: number,
  flared = 0
): Mesh {
  const midX = (innerX + outerX) * 0.5
  const halfX = (outerX - innerX) * 0.5
  const s = side
  return sculptLoft([
    {
      y: yBot,
      rx: halfX * (1.06 + flared),
      rz: rzBase * 0.96,
      xOffset: s * (midX + 0.022),
      frontFlat: 0.08,
      backFlat: 0.08
    },
    {
      y: yBot + (yTop - yBot) * 0.38,
      rx: halfX * (1.04 + flared * 0.6),
      rz: rzBase * 1.04,
      xOffset: s * (midX + 0.008),
      frontFlat: 0.08,
      backFlat: 0.08
    },
    {
      y: yBot + (yTop - yBot) * 0.78,
      rx: halfX * 0.84,
      rz: rzBase * 0.92,
      xOffset: s * (midX - 0.022),
      frontFlat: 0.08,
      backFlat: 0.08
    },
    {
      y: yTop,
      rx: halfX * 0.48,
      rz: rzBase * 0.58,
      xOffset: s * (midX - 0.048)
    }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })
}

function createPauldronRim(
  side: Side,
  yBot: number,
  innerX: number,
  outerX: number,
  rzBase: number
): Mesh {
  const midX = (innerX + outerX) * 0.5
  const halfX = (outerX - innerX) * 0.5
  const s = side
  return sculptLoft([
    {
      y: yBot - 0.012,
      rx: halfX * 1.12,
      rz: rzBase * 1.04,
      xOffset: s * (midX + 0.026),
      frontFlat: 0.08,
      backFlat: 0.08
    },
    {
      y: yBot + 0.018,
      rx: halfX * 1.10,
      rz: rzBase * 1.03,
      xOffset: s * (midX + 0.020),
      frontFlat: 0.08,
      backFlat: 0.08
    }
  ], { sides: 8, aoStrength: 0.12, aoGradient: 0.06 })
}

function createWingBlade(side: Side, height: number, spread: number): Mesh {
  const s = side
  return sculptLoft([
    { y: -0.010, rx: 0.036, rz: 0.024, xOffset: s * 0.295, zOffset: -0.015 },
    { y: height * 0.35, rx: 0.056, rz: 0.034, xOffset: s * (0.355 + spread * 0.35), zOffset: -0.030 },
    { y: height * 0.72, rx: 0.048, rz: 0.026, xOffset: s * (0.415 + spread * 0.72), zOffset: -0.048 },
    { y: height, rx: 0.014, rz: 0.012, xOffset: s * (0.460 + spread), zOffset: -0.064 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })
}

function createSpikeCone(length: number, radius: number): Mesh {
  return sculptLoft([
    { y: 0, rx: radius, rz: radius },
    { y: length * 0.45, rx: radius * 0.62, rz: radius * 0.62 },
    { y: length, rx: 0.004, rz: 0.004 }
  ], { sides: 5, aoStrength: 0.14, aoGradient: 0.08 })
}

function createBracerSleeve(
  side: Side,
  yBot: number,
  yTop: number,
  rBotX: number,
  rBotZ: number,
  rTopX: number,
  rTopZ: number
): Mesh {
  const s = side
  return sculptLoft([
    { y: yBot, rx: rBotX, rz: rBotZ, xOffset: s * 0.006, zOffset: 0.004 },
    { y: (yBot + yTop) * 0.35, rx: (rBotX + rTopX) * 0.52, rz: (rBotZ + rTopZ) * 0.52, xOffset: s * 0.002, zOffset: 0.001 },
    { y: yTop, rx: rTopX, rz: rTopZ, xOffset: -s * 0.003, zOffset: -0.003 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })
}

function createBracerFin(side: Side): Mesh {
  const s = side
  return sculptLoft([
    { y: -0.056, rx: 0.014, rz: 0.024, xOffset: s * 0.084, zOffset: 0.002 },
    { y: 0.018, rx: 0.024, rz: 0.036, xOffset: s * 0.094, zOffset: -0.002 },
    { y: 0.096, rx: 0.016, rz: 0.028, xOffset: s * 0.098, zOffset: -0.006 },
    { y: 0.118, rx: 0.006, rz: 0.012, xOffset: s * 0.090, zOffset: -0.008 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })
}

function createTassetPlate(side: Side, yTop: number, yBot: number, flare: number): Mesh {
  const s = side
  return sculptLoft([
    { y: yBot, rx: 0.044, rz: 0.088, xOffset: s * (0.242 + flare), zOffset: 0.006, frontFlat: 0.08 },
    { y: (yTop + yBot) * 0.5, rx: 0.046, rz: 0.096, xOffset: s * (0.228 + flare * 0.5), zOffset: 0.004, frontFlat: 0.08 },
    { y: yTop, rx: 0.038, rz: 0.090, xOffset: s * 0.212, zOffset: 0.002, frontFlat: 0.08 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })
}

function createBootCuffFur(side: Side): Mesh {
  const xOff = side * 0.004
  return sculptLoft([
    makeStarRing(-0.014, 6, 0.098, 0.104, 0.088, 0.094, xOff, 0.002, 0.22),
    makeStarRing(0.036, 6, 0.109, 0.116, 0.092, 0.099, xOff, 0.002, 0.22),
    makeStarRing(0.078, 6, 0.112, 0.120, 0.092, 0.100, xOff, 0.002, 0.22),
    makeStarRing(0.106, 6, 0.100, 0.108, 0.085, 0.092, xOff, 0.002, 0.22)
  ], { aoStrength: 0.16, aoGradient: 0.10 })
}

function createBootCuffBand(side: Side, yBot: number, yTop: number, rx: number, rz: number): Mesh {
  const xOff = side * 0.004
  return sculptLoft([
    { y: yBot, rx: rx * 0.94, rz: rz * 0.94, xOffset: xOff, zOffset: 0.002 },
    { y: (yBot + yTop) * 0.5, rx, rz, xOffset: xOff, zOffset: 0.002 },
    { y: yTop, rx: rx * 1.02, rz: rz * 1.02, xOffset: xOff, zOffset: 0.002 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })
}

function createKneeGuard(side: Side): Mesh {
  const xOff = side * 0.004
  return sculptLoft([
    { y: 0.045, rx: 0.044, rz: 0.022, xOffset: xOff, zOffset: 0.106 },
    { y: 0.094, rx: 0.064, rz: 0.030, xOffset: xOff, zOffset: 0.112 },
    { y: 0.132, rx: 0.056, rz: 0.026, xOffset: xOff, zOffset: 0.106 },
    { y: 0.156, rx: 0.024, rz: 0.014, xOffset: xOff, zOffset: 0.096 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })
}

function createBootWing(side: Side): Mesh {
  const s = side
  return sculptLoft([
    { y: 0.012, rx: 0.012, rz: 0.022, xOffset: s * 0.104, zOffset: -0.008 },
    { y: 0.064, rx: 0.022, rz: 0.038, xOffset: s * 0.122, zOffset: -0.024 },
    { y: 0.116, rx: 0.014, rz: 0.026, xOffset: s * 0.132, zOffset: -0.042 },
    { y: 0.138, rx: 0.006, rz: 0.010, xOffset: s * 0.124, zOffset: -0.052 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })
}

// ---------------------------------------------------------------------------
// Cached Armor Mesh Library (built lazily once for zero per-unit cost)
// ---------------------------------------------------------------------------

interface ArmorMeshes {
  // Chest meshes
  readonly plateCuirass: Mesh
  readonly plateSurcoatFront: Mesh
  readonly plateSurcoatBack: Mesh
  readonly plateCollarRim: Mesh
  readonly chestCrest: Mesh
  readonly chestCrestInner: Mesh

  readonly rangerUnder: Mesh
  readonly rangerVest: Mesh
  readonly rangerStrapFront: Mesh
  readonly rangerStrapBack: Mesh
  readonly rangerStrapTop: Mesh
  readonly rangerClasp: Mesh

  readonly arcaneCoat: Mesh
  readonly arcaneStole: Mesh
  readonly arcaneStoleEdgeL: Mesh
  readonly arcaneStoleEdgeR: Mesh
  readonly arcaneCollar: Mesh
  readonly arcaneBroochOuter: Mesh
  readonly arcaneBroochGem: Mesh

  readonly clericTunic: Mesh
  readonly clericTabard: Mesh
  readonly clericTabardTrimL: Mesh
  readonly clericTabardTrimR: Mesh
  readonly clericSunOuter: Mesh
  readonly clericSunCore: Mesh

  readonly rogueJerkin: Mesh
  readonly rogueStrapBar: Mesh
  readonly rogueBuckle: Mesh
  readonly rogueSash: Mesh

  readonly obsidianCuirass: Mesh
  readonly obsidianCollar: Mesh
  readonly obsidianRidgeL: Mesh
  readonly obsidianRidgeR: Mesh
  readonly obsidianRuneFrame: Mesh
  readonly obsidianRuneCore: Mesh
  readonly obsidianRuneBar: Mesh

  // Pauldrons (L/R)
  readonly knightPauldronL: Mesh
  readonly knightPauldronR: Mesh
  readonly knightRimL: Mesh
  readonly knightRimR: Mesh
  readonly knightBoss: Mesh

  readonly paladinPauldronL: Mesh
  readonly paladinPauldronR: Mesh
  readonly paladinRimL: Mesh
  readonly paladinRimR: Mesh
  readonly paladinWingL: Mesh
  readonly paladinWingR: Mesh

  readonly rangerPadLTop: Mesh
  readonly rangerPadLLower: Mesh
  readonly rangerCapR: Mesh
  readonly rangerPauldronClasp: Mesh

  readonly arcaneMantleL: Mesh
  readonly arcaneMantleR: Mesh
  readonly arcaneTrimL: Mesh
  readonly arcaneTrimR: Mesh
  readonly arcaneGem: Mesh

  readonly spikedPauldronL: Mesh
  readonly spikedPauldronR: Mesh
  readonly spikeLarge: Mesh
  readonly spikeSmall: Mesh

  readonly gildedUpperL: Mesh
  readonly gildedUpperR: Mesh
  readonly gildedLowerL: Mesh
  readonly gildedLowerR: Mesh
  readonly gildedWingL: Mesh
  readonly gildedWingR: Mesh
  readonly gildedCrestGem: Mesh

  // Collars
  readonly scarfWrap: Mesh
  readonly scarfUpperFold: Mesh
  readonly scarfTail: Mesh
  readonly furCollar: Mesh
  readonly goldGorgetBase: Mesh
  readonly goldStandingCollar: Mesh
  readonly goldCollarGem: Mesh

  // Belts
  readonly beltStrapChunky: Mesh
  readonly beltStrapTrim: Mesh
  readonly beltHexOuter: Mesh
  readonly beltHexInner: Mesh
  readonly beltHexBoss: Mesh
  readonly beltSidePlate: Mesh
  readonly beltBrassBuckle: Mesh
  readonly beltPouchBody: Mesh
  readonly beltPouchFlap: Mesh
  readonly beltSashBand: Mesh
  readonly beltSashFold: Mesh
  readonly beltSashDrape: Mesh
  readonly beltSashTrim: Mesh

  // Skirts & Tassets
  readonly tassetUpperL: Mesh
  readonly tassetUpperR: Mesh
  readonly tassetLowerL: Mesh
  readonly tassetLowerR: Mesh
  readonly tabardFront: Mesh
  readonly tabardFrontTrim: Mesh
  readonly tabardBack: Mesh

  readonly robeSkirtBody: Mesh
  readonly robeSkirtHem: Mesh
  readonly robeSkirtFrontPanel: Mesh

  readonly rangerSkirtWaist: Mesh
  readonly rangerTailFrontL: Mesh
  readonly rangerTailFrontR: Mesh
  readonly rangerTailBack: Mesh
  readonly rangerTailTrimL: Mesh
  readonly rangerTailTrimR: Mesh
  readonly rangerTailTrimBack: Mesh

  // Back pieces
  readonly capeRoyalBody: Mesh
  readonly capeRoyalTrim: Mesh
  readonly capeClasp: Mesh

  readonly capeTatteredBody: Mesh
  readonly capeTatteredYoke: Mesh
  readonly capeTatterLong: Mesh
  readonly capeTatterMid: Mesh

  readonly quiverBody: Mesh
  readonly quiverRim: Mesh
  readonly quiverBand: Mesh
  readonly quiverCap: Mesh
  readonly arrowShaft: Mesh
  readonly arrowFletch: Mesh

  readonly haloSegment: Mesh
  readonly haloRayLong: Mesh
  readonly haloRayShort: Mesh
  readonly haloGem: Mesh

  // Bracers (L/R)
  readonly bracerPlateL: Mesh
  readonly bracerPlateR: Mesh
  readonly bracerPlateRimBotL: Mesh
  readonly bracerPlateRimBotR: Mesh
  readonly bracerPlateRimTopL: Mesh
  readonly bracerPlateRimTopR: Mesh
  readonly bracerPlateFinL: Mesh
  readonly bracerPlateFinR: Mesh

  readonly bracerLeatherL: Mesh
  readonly bracerLeatherR: Mesh
  readonly bracerStrapLowL: Mesh
  readonly bracerStrapLowR: Mesh
  readonly bracerStrapHighL: Mesh
  readonly bracerStrapHighR: Mesh
  readonly bracerStud: Mesh

  readonly bracerGoldL: Mesh
  readonly bracerGoldR: Mesh
  readonly bracerGoldFinL: Mesh
  readonly bracerGoldFinR: Mesh
  readonly bracerGoldGem: Mesh

  // Boot cuffs (L/R)
  readonly bootFurL: Mesh
  readonly bootFurR: Mesh
  readonly bootBaseStrapL: Mesh
  readonly bootBaseStrapR: Mesh

  readonly bootPlateL: Mesh
  readonly bootPlateR: Mesh
  readonly bootPlateRimL: Mesh
  readonly bootPlateRimR: Mesh
  readonly bootKneeGuardL: Mesh
  readonly bootKneeGuardR: Mesh

  readonly bootGoldL: Mesh
  readonly bootGoldR: Mesh
  readonly bootGoldWingL: Mesh
  readonly bootGoldWingR: Mesh
  readonly bootGoldShieldL: Mesh
  readonly bootGoldShieldR: Mesh
}

let cachedArmorMeshes: ArmorMeshes | undefined

function getArmorMeshes(): ArmorMeshes {
  if (cachedArmorMeshes) return cachedArmorMeshes

  // -------------------------------------------------------------------------
  // 1. CHEST MESHES (anchor [0, 0.25, 0] on body)
  // Keep waist (y ~ -0.12) <= rx 0.208 / rz 0.148 so ALL belts wrap outside cleanly.
  // -------------------------------------------------------------------------

  const rawPlateCuirass = sculptLoft([
    { y: -0.205, rx: 0.228, rz: 0.154, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.120, rx: 0.202, rz: 0.144, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.015, rx: 0.252, rz: 0.172, zOffset: 0.012, frontFlat: 0.04, backFlat: 0.08 },
    { y: 0.148, rx: 0.284, rz: 0.180, zOffset: 0.010, frontFlat: 0.06, backFlat: 0.08 },
    { y: 0.208, rx: 0.246, rz: 0.156, zOffset: 0.002 },
    { y: 0.236, rx: 0.158, rz: 0.128, zOffset: 0.000 }
  ], { sides: 8 })
  const zonedPlate = bakeZoneColors(rawPlateCuirass, (_cx, cy, _cz, _nx, _ny, nz) => {
    if (cy < -0.09) return [0.86, 0.88, 0.92, 1]
    if (nz > 0.55 && cy > 0.02) return [1.07, 1.07, 1.09, 1]
    return WHITE
  })
  const plateCuirass = bakeVertexAO(zonedPlate, { strength: 0.15, verticalGradient: 0.10 })

  const plateSurcoatFront = sculptLoft([
    { y: -0.202, rx: 0.092, rz: 0.018, zOffset: 0.152 },
    { y: -0.118, rx: 0.082, rz: 0.018, zOffset: 0.142 },
    { y: 0.018, rx: 0.104, rz: 0.020, zOffset: 0.178 },
    { y: 0.146, rx: 0.114, rz: 0.020, zOffset: 0.180 },
    { y: 0.204, rx: 0.088, rz: 0.016, zOffset: 0.146 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const plateSurcoatBack = sculptLoft([
    { y: -0.202, rx: 0.096, rz: 0.016, zOffset: -0.148 },
    { y: -0.118, rx: 0.084, rz: 0.016, zOffset: -0.138 },
    { y: 0.018, rx: 0.104, rz: 0.018, zOffset: -0.156 },
    { y: 0.148, rx: 0.112, rz: 0.018, zOffset: -0.162 },
    { y: 0.204, rx: 0.086, rz: 0.014, zOffset: -0.144 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const plateCollarRim = sculptLoft([
    { y: 0.214, rx: 0.174, rz: 0.142, zOffset: 0.004, frontFlat: 0.10 },
    { y: 0.244, rx: 0.152, rz: 0.124, zOffset: 0.002, frontFlat: 0.10 }
  ], { sides: 8, aoStrength: 0.12, aoGradient: 0.06 })

  const chestCrest = createCrestDiamondMesh(0.056, 0.068, 0.016)
  const chestCrestInner = createCrestDiamondMesh(0.032, 0.042, 0.014)

  // Ranger vest
  const rangerUnder = sculptLoft([
    { y: -0.210, rx: 0.226, rz: 0.154, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.120, rx: 0.194, rz: 0.138, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.010, rx: 0.236, rz: 0.162, zOffset: 0.008, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.148, rx: 0.274, rz: 0.170, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.212, rx: 0.236, rz: 0.148 },
    { y: 0.240, rx: 0.152, rz: 0.122 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.10 })

  const rawRangerVest = sculptLoft([
    { y: -0.165, rx: 0.212, rz: 0.150, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.105, rx: 0.204, rz: 0.146, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.020, rx: 0.246, rz: 0.170, zOffset: 0.008, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.148, rx: 0.282, rz: 0.176, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.202, rx: 0.242, rz: 0.152 }
  ], { sides: 8 })
  const zonedRangerVest = bakeZoneColors(rawRangerVest, (cx, cy, cz, _nx, _ny, nz) => {
    if (nz > 0.5 && cz > 0.10 && Math.abs(cx) < 0.085 && cy > 0.10) return [0.76, 0.78, 0.74, 1]
    if (cy < -0.11) return [0.88, 0.85, 0.82, 1]
    return WHITE
  })
  const rangerVest = bakeVertexAO(zonedRangerVest, { strength: 0.15, verticalGradient: 0.10 })

  // Diagonal cross-strap segments hugging the ranger vest cleanly
  const rangerStrapFront = sculptLoft([
    { y: -0.145, rx: 0.036, rz: 0.016, xOffset: 0.128, zOffset: 0.154 },
    { y: 0.020, rx: 0.038, rz: 0.018, xOffset: 0.004, zOffset: 0.176 },
    { y: 0.188, rx: 0.038, rz: 0.018, xOffset: -0.122, zOffset: 0.160 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const rangerStrapBack = sculptLoft([
    { y: -0.145, rx: 0.036, rz: 0.016, xOffset: 0.128, zOffset: -0.146 },
    { y: 0.020, rx: 0.038, rz: 0.018, xOffset: 0.004, zOffset: -0.164 },
    { y: 0.188, rx: 0.038, rz: 0.018, xOffset: -0.122, zOffset: -0.152 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const rangerStrapTop = sculptLoft([
    { y: 0.182, rx: 0.042, rz: 0.156, xOffset: -0.122, zOffset: 0.004 },
    { y: 0.218, rx: 0.038, rz: 0.142, xOffset: -0.122, zOffset: 0.004 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const rangerClasp = createHexDiscMesh(0.034, 0.018, 0.006)

  // Arcane robe
  const rawArcaneCoat = sculptLoft([
    { y: -0.214, rx: 0.232, rz: 0.158, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.120, rx: 0.200, rz: 0.142, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.012, rx: 0.242, rz: 0.166, zOffset: 0.008, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.150, rx: 0.278, rz: 0.174, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.214, rx: 0.242, rz: 0.152 },
    { y: 0.240, rx: 0.158, rz: 0.126 }
  ], { sides: 8 })
  const zonedArcaneCoat = bakeZoneColors(rawArcaneCoat, (cx, cy) => {
    if (Math.abs(cx) > 0.16 && cy < 0.06) return [0.88, 0.87, 0.94, 1]
    return WHITE
  })
  const arcaneCoat = bakeVertexAO(zonedArcaneCoat, { strength: 0.15, verticalGradient: 0.10 })

  const arcaneStole = sculptLoft([
    { y: -0.208, rx: 0.066, rz: 0.018, zOffset: 0.154 },
    { y: -0.118, rx: 0.058, rz: 0.018, zOffset: 0.144 },
    { y: 0.016, rx: 0.072, rz: 0.020, zOffset: 0.168 },
    { y: 0.150, rx: 0.084, rz: 0.020, zOffset: 0.172 },
    { y: 0.214, rx: 0.072, rz: 0.016, zOffset: 0.144 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const createStoleEdge = (side: Side): Mesh => sculptLoft([
    { y: -0.208, rx: 0.015, rz: 0.020, xOffset: side * 0.066, zOffset: 0.154 },
    { y: -0.118, rx: 0.015, rz: 0.020, xOffset: side * 0.058, zOffset: 0.144 },
    { y: 0.016, rx: 0.016, rz: 0.022, xOffset: side * 0.072, zOffset: 0.168 },
    { y: 0.150, rx: 0.017, rz: 0.022, xOffset: side * 0.084, zOffset: 0.172 },
    { y: 0.214, rx: 0.016, rz: 0.018, xOffset: side * 0.072, zOffset: 0.144 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.04 })

  const arcaneCollar = sculptLoft([
    { y: 0.206, rx: 0.184, rz: 0.146, zOffset: -0.008 },
    { y: 0.264, rx: 0.178, rz: 0.142, zOffset: -0.016 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.08 })

  const arcaneBroochOuter = createHexDiscMesh(0.048, 0.022, 0.008)
  const arcaneBroochGem = createCrestDiamondMesh(0.026, 0.036, 0.016)

  // Cleric vestment
  const rawClericTunic = sculptLoft([
    { y: -0.212, rx: 0.230, rz: 0.156, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.120, rx: 0.198, rz: 0.140, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.012, rx: 0.240, rz: 0.164, zOffset: 0.008, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.150, rx: 0.278, rz: 0.174, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.214, rx: 0.242, rz: 0.152 },
    { y: 0.240, rx: 0.158, rz: 0.126 }
  ], { sides: 8 })
  const zonedClericTunic = bakeZoneColors(rawClericTunic, (_cx, cy) => {
    if (cy > 0.175) return [0.99, 0.92, 0.72, 1]
    if (cy < -0.14) return [0.94, 0.92, 0.88, 1]
    return WHITE
  })
  const clericTunic = bakeVertexAO(zonedClericTunic, { strength: 0.14, verticalGradient: 0.08 })

  const clericTabard = sculptLoft([
    { y: -0.210, rx: 0.082, rz: 0.018, zOffset: 0.152 },
    { y: -0.118, rx: 0.072, rz: 0.018, zOffset: 0.142 },
    { y: 0.016, rx: 0.088, rz: 0.020, zOffset: 0.166 },
    { y: 0.150, rx: 0.098, rz: 0.020, zOffset: 0.172 },
    { y: 0.212, rx: 0.080, rz: 0.016, zOffset: 0.144 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const createTabardTrim = (side: Side): Mesh => sculptLoft([
    { y: -0.210, rx: 0.014, rz: 0.020, xOffset: side * 0.082, zOffset: 0.152 },
    { y: -0.118, rx: 0.014, rz: 0.020, xOffset: side * 0.072, zOffset: 0.142 },
    { y: 0.016, rx: 0.015, rz: 0.022, xOffset: side * 0.088, zOffset: 0.166 },
    { y: 0.150, rx: 0.016, rz: 0.022, xOffset: side * 0.098, zOffset: 0.172 },
    { y: 0.212, rx: 0.014, rz: 0.018, xOffset: side * 0.080, zOffset: 0.144 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.04 })

  const clericSunOuter = sculptLoft([
    makeStarRing(-0.010, 8, 0.056, 0.056, 0.036, 0.036),
    makeStarRing(0.010, 8, 0.052, 0.052, 0.034, 0.034)
  ], { aoStrength: 0.10, aoGradient: 0.04 })
  const clericSunCore = createHexDiscMesh(0.024, 0.022, 0.005)

  // Rogue leathers
  const rawRogueJerkin = sculptLoft([
    { y: -0.205, rx: 0.224, rz: 0.152, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.120, rx: 0.194, rz: 0.138, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.012, rx: 0.238, rz: 0.164, zOffset: 0.008, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.148, rx: 0.276, rz: 0.172, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.212, rx: 0.238, rz: 0.148 },
    { y: 0.240, rx: 0.154, rz: 0.122 }
  ], { sides: 8 })
  const zonedRogueJerkin = bakeZoneColors(rawRogueJerkin, (_cx, cy) => {
    if (cy > 0.14) return [0.84, 0.84, 0.88, 1]
    return WHITE
  })
  const rogueJerkin = bakeVertexAO(zonedRogueJerkin, { strength: 0.16, verticalGradient: 0.10 })

  const rogueStrapBar = sculptLoft([
    { y: -0.155, rx: 0.024, rz: 0.016 },
    { y: 0.000, rx: 0.026, rz: 0.018 },
    { y: 0.155, rx: 0.024, rz: 0.016 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.04 })

  const rogueBuckle = createHexDiscMesh(0.032, 0.020, 0.006)

  const rogueSash = sculptLoft([
    { y: -0.110, rx: 0.208, rz: 0.152, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.058, rx: 0.228, rz: 0.162, zOffset: 0.004, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.018, rx: 0.234, rz: 0.164, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.08 })

  // Obsidian boss plate
  const rawObsidianCuirass = sculptLoft([
    { y: -0.206, rx: 0.234, rz: 0.158, frontFlat: 0.08, backFlat: 0.08 },
    { y: -0.120, rx: 0.206, rz: 0.148, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.015, rx: 0.264, rz: 0.184, zOffset: 0.016, frontFlat: 0.00, backFlat: 0.06 },
    { y: 0.152, rx: 0.296, rz: 0.192, zOffset: 0.014, frontFlat: 0.02, backFlat: 0.06 },
    { y: 0.214, rx: 0.254, rz: 0.164, zOffset: 0.004 },
    { y: 0.242, rx: 0.166, rz: 0.136, zOffset: 0.000 }
  ], { sides: 8 })
  const zonedObsidian = bakeZoneColors(rawObsidianCuirass, (_cx, cy, _cz, _nx, _ny, nz) => {
    if (nz > 0.5 && cy > 0.02) return [1.14, 1.10, 1.22, 1]
    if (cy < -0.09) return [0.80, 0.78, 0.86, 1]
    return WHITE
  })
  const obsidianCuirass = bakeVertexAO(zonedObsidian, { strength: 0.18, verticalGradient: 0.12 })

  const obsidianCollar = sculptLoft([
    { y: 0.214, rx: 0.188, rz: 0.154, zOffset: 0.004 },
    { y: 0.258, rx: 0.172, rz: 0.142, zOffset: -0.002 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.08 })

  const createObsidianRidge = (side: Side): Mesh => sculptLoft([
    { y: -0.040, rx: 0.032, rz: 0.030, xOffset: side * 0.156, zOffset: 0.154 },
    { y: 0.085, rx: 0.046, rz: 0.036, xOffset: side * 0.192, zOffset: 0.166 },
    { y: 0.185, rx: 0.038, rz: 0.028, xOffset: side * 0.168, zOffset: 0.148 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const obsidianRuneFrame = createCrestDiamondMesh(0.066, 0.088, 0.020)
  const obsidianRuneCore = createCrestDiamondMesh(0.038, 0.062, 0.020)
  const obsidianRuneBar = sculptLoft([
    { y: -0.012, rx: 0.044, rz: 0.012 },
    { y: 0.012, rx: 0.044, rz: 0.012 }
  ], { sides: 6, aoStrength: 0.08, aoGradient: 0.04 })

  // -------------------------------------------------------------------------
  // 2. PAULDRON MESHES (anchor [0, 0.40, 0] on body)
  // Arm pivot at [+/-0.30, 0, 0]; chest outer at +/-0.25..0.28.
  // -------------------------------------------------------------------------

  const knightPauldronL = createShoulderShell(-1, -0.078, 0.088, 0.196, 0.412, 0.118, 0.04)
  const knightPauldronR = createShoulderShell(1, -0.078, 0.088, 0.196, 0.412, 0.118, 0.04)
  const knightRimL = createPauldronRim(-1, -0.074, 0.196, 0.412, 0.118)
  const knightRimR = createPauldronRim(1, -0.074, 0.196, 0.412, 0.118)
  const knightBoss = createHexDiscMesh(0.032, 0.022, 0.006)

  const paladinPauldronL = createShoulderShell(-1, -0.086, 0.098, 0.190, 0.428, 0.126, 0.08)
  const paladinPauldronR = createShoulderShell(1, -0.086, 0.098, 0.190, 0.428, 0.126, 0.08)
  const paladinRimL = createPauldronRim(-1, -0.082, 0.190, 0.428, 0.126)
  const paladinRimR = createPauldronRim(1, -0.082, 0.190, 0.428, 0.126)
  const paladinWingL = createWingBlade(-1, 0.175, 0.055)
  const paladinWingR = createWingBlade(1, 0.175, 0.055)

  const rangerPadLTop = createShoulderShell(-1, -0.030, 0.084, 0.194, 0.402, 0.112, 0.04)
  const rangerPadLLower = createShoulderShell(-1, -0.104, -0.008, 0.228, 0.418, 0.108, 0.06)
  const rangerCapR = createShoulderShell(1, -0.042, 0.066, 0.204, 0.374, 0.102, 0.00)
  const rangerPauldronClasp = createHexDiscMesh(0.028, 0.020, 0.005)

  const arcaneMantleL = createShoulderShell(-1, -0.090, 0.082, 0.172, 0.416, 0.132, 0.10)
  const arcaneMantleR = createShoulderShell(1, -0.090, 0.082, 0.172, 0.416, 0.132, 0.10)
  const arcaneTrimL = createPauldronRim(-1, -0.086, 0.172, 0.416, 0.132)
  const arcaneTrimR = createPauldronRim(1, -0.086, 0.172, 0.416, 0.132)
  const arcaneGem = createCrestDiamondMesh(0.026, 0.036, 0.016)

  const spikedPauldronL = createShoulderShell(-1, -0.088, 0.096, 0.192, 0.430, 0.126, 0.06)
  const spikedPauldronR = createShoulderShell(1, -0.088, 0.096, 0.192, 0.430, 0.126, 0.06)
  const spikeLarge = createSpikeCone(0.155, 0.036)
  const spikeSmall = createSpikeCone(0.108, 0.026)

  const gildedUpperL = createShoulderShell(-1, -0.032, 0.106, 0.188, 0.432, 0.128, 0.08)
  const gildedUpperR = createShoulderShell(1, -0.032, 0.106, 0.188, 0.432, 0.128, 0.08)
  const gildedLowerL = createShoulderShell(-1, -0.108, -0.010, 0.220, 0.448, 0.124, 0.10)
  const gildedLowerR = createShoulderShell(1, -0.108, -0.010, 0.220, 0.448, 0.124, 0.10)
  const gildedWingL = createWingBlade(-1, 0.168, 0.048)
  const gildedWingR = createWingBlade(1, 0.168, 0.048)
  const gildedCrestGem = createCrestDiamondMesh(0.028, 0.038, 0.018)

  // -------------------------------------------------------------------------
  // 3. COLLAR MESHES (anchor [0, 0.46, 0] on body)
  // Neck spans y = -0.025..+0.075, chin bottom at y = +0.04.
  // -------------------------------------------------------------------------

  const scarfWrap = sculptLoft([
    { y: -0.062, rx: 0.226, rz: 0.178, zOffset: 0.008, frontFlat: 0.08, backFlat: 0.06 },
    { y: -0.018, rx: 0.214, rz: 0.174, zOffset: 0.010, frontFlat: 0.08, backFlat: 0.06 },
    { y: 0.028, rx: 0.182, rz: 0.154, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const scarfUpperFold = sculptLoft([
    { y: -0.016, rx: 0.204, rz: 0.168, xOffset: -0.008, zOffset: 0.014, frontFlat: 0.08 },
    { y: 0.020, rx: 0.194, rz: 0.160, xOffset: -0.006, zOffset: 0.012, frontFlat: 0.08 },
    { y: 0.046, rx: 0.164, rz: 0.138, xOffset: -0.004, zOffset: 0.008, frontFlat: 0.10 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.08 })

  const scarfTail = sculptLoft([
    { y: -0.205, rx: 0.044, rz: 0.016, xOffset: 0.104, zOffset: 0.184 },
    { y: -0.115, rx: 0.054, rz: 0.022, xOffset: 0.096, zOffset: 0.184 },
    { y: -0.028, rx: 0.050, rz: 0.026, xOffset: 0.084, zOffset: 0.166 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const rawFurCollar = sculptLoft([
    makeStarRing(-0.056, 8, 0.286, 0.212, 0.246, 0.184, 0, 0.004, 0.12),
    makeStarRing(-0.014, 8, 0.298, 0.222, 0.256, 0.192, 0, 0.004, 0.24),
    makeStarRing(0.026, 8, 0.258, 0.196, 0.220, 0.168, 0, 0.002, 0.12),
    makeStarRing(0.054, 8, 0.186, 0.152, 0.162, 0.134, 0, 0.000, 0.24)
  ])
  const zonedFur = bakeZoneColors(rawFurCollar, (_cx, cy, _cz, _nx, ny) => {
    if (ny < -0.3 || cy < -0.042) return [0.82, 0.79, 0.77, 1]
    return WHITE
  })
  const furCollar = bakeVertexAO(zonedFur, { strength: 0.16, verticalGradient: 0.10 })

  const goldGorgetBase = sculptLoft([
    { y: -0.046, rx: 0.256, rz: 0.184, zOffset: 0.006, frontFlat: 0.06, backFlat: 0.06 },
    { y: -0.014, rx: 0.236, rz: 0.168, zOffset: 0.004, frontFlat: 0.06, backFlat: 0.06 },
    { y: 0.018, rx: 0.184, rz: 0.144, zOffset: 0.000 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  // High-backed regal collar rising behind the neck without blocking the chin
  const goldStandingCollar = sculptLoft([
    makeCapeRing(-0.016, 0.205, -0.094, 0.034, 0.048),
    makeCapeRing(0.068, 0.252, -0.108, 0.032, 0.058),
    makeCapeRing(0.152, 0.278, -0.124, 0.026, 0.062)
  ], { aoStrength: 0.14, aoGradient: 0.08 })

  const goldCollarGem = createCrestDiamondMesh(0.030, 0.040, 0.018)

  // -------------------------------------------------------------------------
  // 4. BELT MESHES (anchor [0, 0.13, 0] on body)
  // Waist chest armor is <= rx 0.208 / rz 0.148; belt sits at rx 0.228..0.236 / rz 0.168..0.174.
  // -------------------------------------------------------------------------

  const beltStrapChunky = sculptLoft([
    { y: -0.054, rx: 0.228, rz: 0.168, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.000, rx: 0.234, rz: 0.172, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.054, rx: 0.228, rz: 0.168, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const beltStrapTrim = sculptLoft([
    { y: -0.018, rx: 0.238, rz: 0.176, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.018, rx: 0.238, rz: 0.176, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.12, aoGradient: 0.06 })

  const beltHexOuter = createHexDiscMesh(0.086, 0.034, 0.014)
  const beltHexInner = createHexDiscMesh(0.058, 0.024, 0.008)
  const beltHexBoss = createHexDiscMesh(0.026, 0.020, 0.006)

  const beltSidePlate = sculptLoft([
    { y: -0.044, rx: 0.024, rz: 0.054 },
    { y: 0.000, rx: 0.030, rz: 0.062 },
    { y: 0.044, rx: 0.024, rz: 0.054 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const beltBrassBuckle = sculptLoft([
    { y: -0.052, rx: 0.058, rz: 0.026 },
    { y: 0.000, rx: 0.064, rz: 0.030 },
    { y: 0.052, rx: 0.058, rz: 0.026 }
  ], { sides: 8, aoStrength: 0.12, aoGradient: 0.06 })

  const beltPouchBody = sculptLoft([
    { y: -0.095, rx: 0.048, rz: 0.062 },
    { y: -0.042, rx: 0.054, rz: 0.068 },
    { y: 0.016, rx: 0.048, rz: 0.060 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  const beltPouchFlap = sculptLoft([
    { y: -0.034, rx: 0.052, rz: 0.056, xOffset: 0.008 },
    { y: 0.008, rx: 0.058, rz: 0.068, xOffset: 0.004 },
    { y: 0.032, rx: 0.046, rz: 0.058 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const beltSashBand = sculptLoft([
    { y: -0.062, rx: 0.232, rz: 0.172, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.000, rx: 0.238, rz: 0.176, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.062, rx: 0.230, rz: 0.170, frontFlat: 0.08, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  const beltSashFold = sculptLoft([
    { y: -0.024, rx: 0.244, rz: 0.180, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.024, rx: 0.244, rz: 0.180, frontFlat: 0.08, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.12, aoGradient: 0.06 })

  const beltSashDrape = sculptLoft([
    { y: -0.285, rx: 0.028, rz: 0.014, zOffset: 0.192 },
    { y: -0.220, rx: 0.072, rz: 0.020, zOffset: 0.190 },
    { y: -0.105, rx: 0.066, rz: 0.020, zOffset: 0.184 },
    { y: -0.010, rx: 0.058, rz: 0.022, zOffset: 0.178 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const beltSashTrim = sculptLoft([
    { y: -0.296, rx: 0.018, rz: 0.016, zOffset: 0.195 },
    { y: -0.238, rx: 0.068, rz: 0.022, zOffset: 0.193 },
    { y: -0.205, rx: 0.074, rz: 0.022, zOffset: 0.192 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.04 })

  // -------------------------------------------------------------------------
  // 5. SKIRT & TASSET MESHES (anchor [0, 0.08, 0] on body)
  // Pelvis spans y = -0.105..+0.052; legs outer X ~ 0.197; boots start at y = -0.34.
  // -------------------------------------------------------------------------

  const tassetUpperL = createTassetPlate(-1, 0.044, -0.102, 0.008)
  const tassetUpperR = createTassetPlate(1, 0.044, -0.102, 0.008)
  const tassetLowerL = createTassetPlate(-1, -0.082, -0.228, 0.024)
  const tassetLowerR = createTassetPlate(1, -0.082, -0.228, 0.024)

  const tabardFront = sculptLoft([
    { y: -0.305, rx: 0.048, rz: 0.018, zOffset: 0.174 },
    { y: -0.235, rx: 0.094, rz: 0.022, zOffset: 0.170 },
    { y: -0.095, rx: 0.088, rz: 0.022, zOffset: 0.158 },
    { y: 0.044, rx: 0.082, rz: 0.024, zOffset: 0.144 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const tabardFrontTrim = sculptLoft([
    { y: -0.314, rx: 0.036, rz: 0.020, zOffset: 0.177 },
    { y: -0.252, rx: 0.096, rz: 0.024, zOffset: 0.174 },
    { y: -0.218, rx: 0.096, rz: 0.024, zOffset: 0.172 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.04 })

  const tabardBack = sculptLoft([
    { y: -0.275, rx: 0.064, rz: 0.018, zOffset: -0.166 },
    { y: -0.190, rx: 0.096, rz: 0.020, zOffset: -0.158 },
    { y: -0.070, rx: 0.092, rz: 0.022, zOffset: -0.148 },
    { y: 0.044, rx: 0.086, rz: 0.024, zOffset: -0.138 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const rawRobeSkirt = sculptLoft([
    { y: -0.415, rx: 0.298, rz: 0.220, frontFlat: 0.08, backFlat: 0.08 },
    { y: -0.255, rx: 0.268, rz: 0.198, frontFlat: 0.08, backFlat: 0.08 },
    { y: -0.100, rx: 0.242, rz: 0.176, frontFlat: 0.08, backFlat: 0.08 },
    { y: 0.046, rx: 0.224, rz: 0.162, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8 })
  const zonedRobeSkirt = bakeZoneColors(rawRobeSkirt, (cx, cy) => {
    if (Math.abs(cx) > 0.18) return [0.90, 0.89, 0.94, 1]
    if (cy < -0.34) return [0.92, 0.91, 0.95, 1]
    return WHITE
  })
  const robeSkirtBody = bakeVertexAO(zonedRobeSkirt, { strength: 0.16, verticalGradient: 0.12 })

  const robeSkirtHem = sculptLoft([
    { y: -0.428, rx: 0.308, rz: 0.228, frontFlat: 0.08, backFlat: 0.08 },
    { y: -0.378, rx: 0.300, rz: 0.222, frontFlat: 0.08, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.12, aoGradient: 0.06 })

  const robeSkirtFrontPanel = sculptLoft([
    { y: -0.418, rx: 0.092, rz: 0.022, zOffset: 0.214 },
    { y: -0.255, rx: 0.082, rz: 0.020, zOffset: 0.194 },
    { y: -0.095, rx: 0.072, rz: 0.018, zOffset: 0.172 },
    { y: 0.040, rx: 0.064, rz: 0.018, zOffset: 0.158 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  // Split ranger tunic coat tails
  const rangerSkirtWaist = sculptLoft([
    { y: -0.086, rx: 0.236, rz: 0.168, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.012, rx: 0.228, rz: 0.164, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.048, rx: 0.222, rz: 0.160, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  const createRangerFrontTail = (side: Side): Mesh => {
    const s = side
    return sculptLoft([
      { y: -0.285, rx: 0.084, rz: 0.078, xOffset: s * 0.176, zOffset: 0.092 },
      { y: -0.170, rx: 0.086, rz: 0.082, xOffset: s * 0.164, zOffset: 0.086 },
      { y: -0.055, rx: 0.080, rz: 0.078, xOffset: s * 0.148, zOffset: 0.078 }
    ], { sides: 6, aoStrength: 0.15, aoGradient: 0.10 })
  }

  const createRangerTailTrim = (side: Side): Mesh => {
    const s = side
    return sculptLoft([
      { y: -0.296, rx: 0.088, rz: 0.082, xOffset: s * 0.178, zOffset: 0.094 },
      { y: -0.262, rx: 0.086, rz: 0.080, xOffset: s * 0.176, zOffset: 0.092 }
    ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })
  }

  const rangerTailBack = sculptLoft([
    { y: -0.320, rx: 0.236, rz: 0.064, zOffset: -0.156 },
    { y: -0.190, rx: 0.224, rz: 0.068, zOffset: -0.142 },
    { y: -0.050, rx: 0.212, rz: 0.068, zOffset: -0.122 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.10 })

  const rangerTailTrimBack = sculptLoft([
    { y: -0.332, rx: 0.242, rz: 0.068, zOffset: -0.160 },
    { y: -0.298, rx: 0.238, rz: 0.066, zOffset: -0.157 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  // -------------------------------------------------------------------------
  // 6. BACK MESHES (anchor [0, 0, 0] on cape joint at [0, 0.42, -0.15] on body)
  // Chest back reaches back.z ~ -0.025; anchor top snugly at z = +0.02..-0.04.
  // -------------------------------------------------------------------------

  const rawCapeRoyal = sculptLoft([
    makeCapeRing(-0.695, 0.352, -0.142, 0.028, 0.058),
    makeCapeRing(-0.460, 0.312, -0.108, 0.030, 0.052),
    makeCapeRing(-0.220, 0.266, -0.068, 0.032, 0.044),
    makeCapeRing(-0.040, 0.234, -0.022, 0.034, 0.034),
    makeCapeRing(0.032, 0.206, 0.016, 0.036, 0.024)
  ])
  const zonedCapeRoyal = bakeZoneColors(rawCapeRoyal, (_cx, cy, _cz, _nx, _ny, nz) => {
    if (nz > 0.35) return [0.74, 0.72, 0.78, 1]
    if (cy < -0.52) return [0.92, 0.90, 0.95, 1]
    return WHITE
  })
  const capeRoyalBody = bakeVertexAO(zonedCapeRoyal, { strength: 0.15, verticalGradient: 0.10 })

  const capeRoyalTrim = sculptLoft([
    makeCapeRing(-0.732, 0.362, -0.148, 0.032, 0.062),
    makeCapeRing(-0.668, 0.354, -0.138, 0.032, 0.060)
  ], { aoStrength: 0.10, aoGradient: 0.04 })

  const capeClasp = createHexDiscMesh(0.036, 0.022, 0.006)

  const rawCapeTattered = sculptLoft([
    makeCapeRing(-0.545, 0.295, -0.124, 0.024, 0.048),
    makeCapeRing(-0.340, 0.266, -0.088, 0.028, 0.044),
    makeCapeRing(-0.140, 0.238, -0.048, 0.030, 0.038),
    makeCapeRing(0.030, 0.206, 0.026, 0.034, 0.024)
  ])
  const zonedTattered = bakeZoneColors(rawCapeTattered, (_cx, cy, _cz, _nx, _ny, nz) => {
    if (nz > 0.35) return [0.70, 0.68, 0.74, 1]
    if (cy < -0.42) return [0.84, 0.82, 0.88, 1]
    return WHITE
  })
  const capeTatteredBody = bakeVertexAO(zonedTattered, { strength: 0.16, verticalGradient: 0.10 })

  const capeTatteredYoke = sculptLoft([
    makeCapeRing(-0.040, 0.242, -0.006, 0.042, 0.032),
    makeCapeRing(0.038, 0.218, 0.032, 0.044, 0.026)
  ], { aoStrength: 0.14, aoGradient: 0.06 })

  const capeTatterLong = sculptLoft([
    { y: -0.220, rx: 0.006, rz: 0.006, zOffset: -0.028 },
    { y: -0.100, rx: 0.036, rz: 0.014, zOffset: -0.012 },
    { y: 0.020, rx: 0.054, rz: 0.016 }
  ], { sides: 5, aoStrength: 0.14, aoGradient: 0.08 })

  const capeTatterMid = sculptLoft([
    { y: -0.150, rx: 0.006, rz: 0.006, zOffset: -0.018 },
    { y: -0.060, rx: 0.032, rz: 0.014, zOffset: -0.008 },
    { y: 0.020, rx: 0.046, rz: 0.016 }
  ], { sides: 5, aoStrength: 0.14, aoGradient: 0.08 })

  // Quiver & arrows
  const quiverBody = sculptLoft([
    { y: -0.235, rx: 0.056, rz: 0.048 },
    { y: -0.060, rx: 0.072, rz: 0.062 },
    { y: 0.140, rx: 0.084, rz: 0.072 },
    { y: 0.205, rx: 0.088, rz: 0.076 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  const quiverRim = sculptLoft([
    { y: 0.180, rx: 0.098, rz: 0.084 },
    { y: 0.222, rx: 0.100, rz: 0.086 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const quiverBand = sculptLoft([
    { y: -0.035, rx: 0.084, rz: 0.072 },
    { y: 0.015, rx: 0.086, rz: 0.074 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.04 })

  const quiverCap = sculptLoft([
    { y: -0.258, rx: 0.044, rz: 0.038 },
    { y: -0.222, rx: 0.062, rz: 0.054 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const arrowShaft = sculptLoft([
    { y: 0.000, rx: 0.012, rz: 0.012 },
    { y: 0.195, rx: 0.011, rz: 0.011 }
  ], { sides: 5, aoStrength: 0.10, aoGradient: 0.04 })

  const arrowFletch = sculptLoft([
    { y: 0.000, rx: 0.010, rz: 0.010 },
    { y: 0.025, rx: 0.036, rz: 0.014 },
    { y: 0.078, rx: 0.038, rz: 0.014 },
    { y: 0.096, rx: 0.014, rz: 0.008 }
  ], { sides: 6, aoStrength: 0.08, aoGradient: 0.04 })

  // Radiant halo (open octagonal golden sun-ring + radiating solar spikes)
  const haloSegment = sculptLoft([
    { y: -0.138, rx: 0.024, rz: 0.018 },
    { y: 0.000, rx: 0.028, rz: 0.022 },
    { y: 0.138, rx: 0.024, rz: 0.018 }
  ], { sides: 6, aoStrength: 0.08, aoGradient: 0.04 })

  const haloRayLong = sculptLoft([
    { y: 0.000, rx: 0.026, rz: 0.016 },
    { y: 0.082, rx: 0.018, rz: 0.012 },
    { y: 0.172, rx: 0.004, rz: 0.004 }
  ], { sides: 4, aoStrength: 0.06, aoGradient: 0.04 })

  const haloRayShort = sculptLoft([
    { y: 0.000, rx: 0.020, rz: 0.014 },
    { y: 0.112, rx: 0.004, rz: 0.004 }
  ], { sides: 4, aoStrength: 0.06, aoGradient: 0.04 })

  const haloGem = createCrestDiamondMesh(0.026, 0.034, 0.016)

  // -------------------------------------------------------------------------
  // 7. BRACER MESHES (anchor [+/-0.018, -0.28, 0.010] on armL / armR)
  // -------------------------------------------------------------------------

  const bracerPlateL = createBracerSleeve(-1, -0.060, 0.084, 0.074, 0.078, 0.088, 0.092)
  const bracerPlateR = createBracerSleeve(1, -0.060, 0.084, 0.074, 0.078, 0.088, 0.092)
  const bracerPlateRimBotL = createBracerSleeve(-1, -0.066, -0.042, 0.078, 0.082, 0.080, 0.084)
  const bracerPlateRimBotR = createBracerSleeve(1, -0.066, -0.042, 0.078, 0.082, 0.080, 0.084)
  const bracerPlateRimTopL = createBracerSleeve(-1, 0.064, 0.090, 0.090, 0.094, 0.092, 0.096)
  const bracerPlateRimTopR = createBracerSleeve(1, 0.064, 0.090, 0.090, 0.094, 0.092, 0.096)
  const bracerPlateFinL = createBracerFin(-1)
  const bracerPlateFinR = createBracerFin(1)

  const bracerLeatherL = createBracerSleeve(-1, -0.058, 0.080, 0.074, 0.078, 0.086, 0.090)
  const bracerLeatherR = createBracerSleeve(1, -0.058, 0.080, 0.074, 0.078, 0.086, 0.090)
  const bracerStrapLowL = createBracerSleeve(-1, -0.042, -0.016, 0.080, 0.084, 0.082, 0.086)
  const bracerStrapLowR = createBracerSleeve(1, -0.042, -0.016, 0.080, 0.084, 0.082, 0.086)
  const bracerStrapHighL = createBracerSleeve(-1, 0.024, 0.050, 0.088, 0.092, 0.090, 0.094)
  const bracerStrapHighR = createBracerSleeve(1, 0.024, 0.050, 0.088, 0.092, 0.090, 0.094)
  const bracerStud = createHexDiscMesh(0.016, 0.014, 0.004)

  const bracerGoldL = createBracerSleeve(-1, -0.062, 0.086, 0.076, 0.080, 0.090, 0.094)
  const bracerGoldR = createBracerSleeve(1, -0.062, 0.086, 0.076, 0.080, 0.090, 0.094)
  const bracerGoldFinL = createBracerFin(-1)
  const bracerGoldFinR = createBracerFin(1)
  const bracerGoldGem = createCrestDiamondMesh(0.018, 0.026, 0.014)

  // -------------------------------------------------------------------------
  // 8. BOOT CUFF MESHES (anchor [0, -0.34, 0] on legL / legR)
  // Base bootCuff spans y = 0.000..+0.080, rx = 0.086, rz = 0.092.
  // Keep inner edge <= 0.106 so left & right cuffs stay cleanly separated.
  // -------------------------------------------------------------------------

  const bootFurL = createBootCuffFur(-1)
  const bootFurR = createBootCuffFur(1)
  const bootBaseStrapL = createBootCuffBand(-1, -0.022, 0.010, 0.098, 0.104)
  const bootBaseStrapR = createBootCuffBand(1, -0.022, 0.010, 0.098, 0.104)

  const bootPlateL = createBootCuffBand(-1, -0.020, 0.094, 0.100, 0.108)
  const bootPlateR = createBootCuffBand(1, -0.020, 0.094, 0.100, 0.108)
  const bootPlateRimL = createBootCuffBand(-1, 0.078, 0.102, 0.104, 0.112)
  const bootPlateRimR = createBootCuffBand(1, 0.078, 0.102, 0.104, 0.112)
  const bootKneeGuardL = createKneeGuard(-1)
  const bootKneeGuardR = createKneeGuard(1)

  const bootGoldL = createBootCuffBand(-1, -0.020, 0.096, 0.101, 0.109)
  const bootGoldR = createBootCuffBand(1, -0.020, 0.096, 0.101, 0.109)
  const bootGoldWingL = createBootWing(-1)
  const bootGoldWingR = createBootWing(1)
  const bootGoldShieldL = createKneeGuard(-1)
  const bootGoldShieldR = createKneeGuard(1)

  cachedArmorMeshes = {
    plateCuirass,
    plateSurcoatFront,
    plateSurcoatBack,
    plateCollarRim,
    chestCrest,
    chestCrestInner,

    rangerUnder,
    rangerVest,
    rangerStrapFront,
    rangerStrapBack,
    rangerStrapTop,
    rangerClasp,

    arcaneCoat,
    arcaneStole,
    arcaneStoleEdgeL: createStoleEdge(-1),
    arcaneStoleEdgeR: createStoleEdge(1),
    arcaneCollar,
    arcaneBroochOuter,
    arcaneBroochGem,

    clericTunic,
    clericTabard,
    clericTabardTrimL: createTabardTrim(-1),
    clericTabardTrimR: createTabardTrim(1),
    clericSunOuter,
    clericSunCore,

    rogueJerkin,
    rogueStrapBar,
    rogueBuckle,
    rogueSash,

    obsidianCuirass,
    obsidianCollar,
    obsidianRidgeL: createObsidianRidge(-1),
    obsidianRidgeR: createObsidianRidge(1),
    obsidianRuneFrame,
    obsidianRuneCore,
    obsidianRuneBar,

    knightPauldronL,
    knightPauldronR,
    knightRimL,
    knightRimR,
    knightBoss,

    paladinPauldronL,
    paladinPauldronR,
    paladinRimL,
    paladinRimR,
    paladinWingL,
    paladinWingR,

    rangerPadLTop,
    rangerPadLLower,
    rangerCapR,
    rangerPauldronClasp,

    arcaneMantleL,
    arcaneMantleR,
    arcaneTrimL,
    arcaneTrimR,
    arcaneGem,

    spikedPauldronL,
    spikedPauldronR,
    spikeLarge,
    spikeSmall,

    gildedUpperL,
    gildedUpperR,
    gildedLowerL,
    gildedLowerR,
    gildedWingL,
    gildedWingR,
    gildedCrestGem,

    scarfWrap,
    scarfUpperFold,
    scarfTail,
    furCollar,
    goldGorgetBase,
    goldStandingCollar,
    goldCollarGem,

    beltStrapChunky,
    beltStrapTrim,
    beltHexOuter,
    beltHexInner,
    beltHexBoss,
    beltSidePlate,
    beltBrassBuckle,
    beltPouchBody,
    beltPouchFlap,
    beltSashBand,
    beltSashFold,
    beltSashDrape,
    beltSashTrim,

    tassetUpperL,
    tassetUpperR,
    tassetLowerL,
    tassetLowerR,
    tabardFront,
    tabardFrontTrim,
    tabardBack,

    robeSkirtBody,
    robeSkirtHem,
    robeSkirtFrontPanel,

    rangerSkirtWaist,
    rangerTailFrontL: createRangerFrontTail(-1),
    rangerTailFrontR: createRangerFrontTail(1),
    rangerTailBack,
    rangerTailTrimL: createRangerTailTrim(-1),
    rangerTailTrimR: createRangerTailTrim(1),
    rangerTailTrimBack,

    capeRoyalBody,
    capeRoyalTrim,
    capeClasp,

    capeTatteredBody,
    capeTatteredYoke,
    capeTatterLong,
    capeTatterMid,

    quiverBody,
    quiverRim,
    quiverBand,
    quiverCap,
    arrowShaft,
    arrowFletch,

    haloSegment,
    haloRayLong,
    haloRayShort,
    haloGem,

    bracerPlateL,
    bracerPlateR,
    bracerPlateRimBotL,
    bracerPlateRimBotR,
    bracerPlateRimTopL,
    bracerPlateRimTopR,
    bracerPlateFinL,
    bracerPlateFinR,

    bracerLeatherL,
    bracerLeatherR,
    bracerStrapLowL,
    bracerStrapLowR,
    bracerStrapHighL,
    bracerStrapHighR,
    bracerStud,

    bracerGoldL,
    bracerGoldR,
    bracerGoldFinL,
    bracerGoldFinR,
    bracerGoldGem,

    bootFurL,
    bootFurR,
    bootBaseStrapL,
    bootBaseStrapR,

    bootPlateL,
    bootPlateR,
    bootPlateRimL,
    bootPlateRimR,
    bootKneeGuardL,
    bootKneeGuardR,

    bootGoldL,
    bootGoldR,
    bootGoldWingL,
    bootGoldWingR,
    bootGoldShieldL,
    bootGoldShieldR
  }
  return cachedArmorMeshes
}

// ---------------------------------------------------------------------------
// Palette Derivation Helpers
// ---------------------------------------------------------------------------

function goldTone(palette: CharacterPalette): Color {
  return mixColor(palette.accent, RADIANT_GOLD, 0.55)
}

function ivoryTone(palette: CharacterPalette): Color {
  return mixColor(palette.secondary, IVORY, 0.58)
}

function obsidianTone(palette: CharacterPalette): Color {
  // Keep villain plate dark but palette-driven so midtones stay readable on dark boards
  return mixColor(palette.metalDark, OBSIDIAN, 0.40)
}

function furTone(palette: CharacterPalette): Color {
  return mixColor(palette.secondary, FUR_CREAM, 0.55)
}

function buildBracerParts(side: Side, kind: 'plate' | 'leather' | 'gold', palette: CharacterPalette): RigPart[] {
  const m = getArmorMeshes()
  const isL = side === -1
  const tag = isL ? 'l' : 'r'
  const gold = goldTone(palette)

  if (kind === 'plate') {
    return [
      { name: `bracer_plate_${tag}`, mesh: isL ? m.bracerPlateL : m.bracerPlateR, color: palette.metal },
      { name: `bracer_plate_rim_b_${tag}`, mesh: isL ? m.bracerPlateRimBotL : m.bracerPlateRimBotR, color: gold },
      { name: `bracer_plate_rim_t_${tag}`, mesh: isL ? m.bracerPlateRimTopL : m.bracerPlateRimTopR, color: gold },
      { name: `bracer_plate_fin_${tag}`, mesh: isL ? m.bracerPlateFinL : m.bracerPlateFinR, color: shadeColor(palette.metal, 0.08) }
    ]
  }

  if (kind === 'leather') {
    return [
      { name: `bracer_leather_${tag}`, mesh: isL ? m.bracerLeatherL : m.bracerLeatherR, color: palette.leather },
      { name: `bracer_strap_b_${tag}`, mesh: isL ? m.bracerStrapLowL : m.bracerStrapLowR, color: palette.leatherLight },
      { name: `bracer_strap_t_${tag}`, mesh: isL ? m.bracerStrapHighL : m.bracerStrapHighR, color: palette.leatherLight },
      {
        name: `bracer_stud_${tag}`,
        mesh: m.bracerStud,
        position: [side * 0.088, 0.036, 0.012],
        rotation: [0, 0, Math.PI * 0.5],
        color: gold
      }
    ]
  }

  return [
    { name: `bracer_gold_${tag}`, mesh: isL ? m.bracerGoldL : m.bracerGoldR, color: gold },
    { name: `bracer_gold_fin_${tag}`, mesh: isL ? m.bracerGoldFinL : m.bracerGoldFinR, color: shadeColor(gold, 0.10) },
    {
      name: `bracer_gold_gem_${tag}`,
      mesh: m.bracerGoldGem,
      position: [side * 0.096, 0.036, 0.008],
      rotation: [0, side * Math.PI * 0.5, 0],
      color: palette.glow,
      unlit: 0.85
    }
  ]
}

function buildBootCuffParts(side: Side, kind: 'fur' | 'plate' | 'gold', palette: CharacterPalette): RigPart[] {
  const m = getArmorMeshes()
  const isL = side === -1
  const tag = isL ? 'l' : 'r'
  const gold = goldTone(palette)

  if (kind === 'fur') {
    return [
      { name: `boot_fur_strap_${tag}`, mesh: isL ? m.bootBaseStrapL : m.bootBaseStrapR, color: palette.leather },
      { name: `boot_fur_${tag}`, mesh: isL ? m.bootFurL : m.bootFurR, color: furTone(palette) }
    ]
  }

  if (kind === 'plate') {
    return [
      { name: `boot_plate_${tag}`, mesh: isL ? m.bootPlateL : m.bootPlateR, color: palette.metal },
      { name: `boot_plate_rim_${tag}`, mesh: isL ? m.bootPlateRimL : m.bootPlateRimR, color: gold },
      { name: `boot_knee_${tag}`, mesh: isL ? m.bootKneeGuardL : m.bootKneeGuardR, color: shadeColor(palette.metal, 0.08) }
    ]
  }

  return [
    { name: `boot_gold_${tag}`, mesh: isL ? m.bootGoldL : m.bootGoldR, color: gold },
    { name: `boot_gold_wing_${tag}`, mesh: isL ? m.bootGoldWingL : m.bootGoldWingR, color: shadeColor(gold, 0.10) },
    { name: `boot_gold_shield_${tag}`, mesh: isL ? m.bootGoldShieldL : m.bootGoldShieldR, color: palette.primary }
  ]
}

// ---------------------------------------------------------------------------
// Full-leg plate greaves (cover bare shins/feet on any body, incl. skeletons)
// & the Eclipse Archon boss regalia (crescent pauldrons + flowing mantle)
// ---------------------------------------------------------------------------

interface GreaveMeshes {
  readonly sabaton: Mesh
  readonly toeCap: Mesh
  readonly greave: Mesh
  readonly ankleBand: Mesh
  readonly topBand: Mesh
  readonly kneeCop: Mesh
  readonly kneeFan: Mesh
  readonly cuisse: Mesh
}

interface EclipseRegaliaMeshes {
  readonly shellL: Mesh
  readonly shellR: Mesh
  readonly rimL: Mesh
  readonly rimR: Mesh
  readonly crescentL: Mesh
  readonly crescentR: Mesh
  readonly gem: Mesh
  readonly mantleBody: Mesh
  readonly mantleHem: Mesh
  readonly mantleYoke: Mesh
  readonly emblemRing: Mesh
  readonly emblemCore: Mesh
}

const greaveMeshCache = new Map<Side, GreaveMeshes>()
let cachedEclipseRegalia: EclipseRegaliaMeshes | undefined

/** Boot-socket local space: y = 0 sits at world 0.16, sole at y = -0.16, knee near y = +0.085. */
function getGreaveMeshes(side: Side): GreaveMeshes {
  const cached = greaveMeshCache.get(side)
  if (cached) return cached
  const x = side * 0.004
  const rawSabaton = sculptLoft([
    { y: -0.160, rx: 0.082, rz: 0.130, xOffset: x, zOffset: 0.050, frontFlat: 0.20, backFlat: 0.10 },
    { y: -0.130, rx: 0.086, rz: 0.134, xOffset: x, zOffset: 0.050, frontFlat: 0.18, backFlat: 0.10 },
    { y: -0.094, rx: 0.082, rz: 0.110, xOffset: x, zOffset: 0.034 },
    { y: -0.058, rx: 0.078, rz: 0.084, xOffset: x, zOffset: 0.010 }
  ], { sides: 8 })
  const sabaton = bakeVertexAO(bakeZoneColors(rawSabaton, (_cx, cy) => (
    cy < -0.146 ? [0.62, 0.60, 0.66, 1] : WHITE
  )), { strength: 0.14, verticalGradient: 0.08 })
  // Pointed armored toe cap riding on top of the sabaton (bright steel catches the high camera)
  const toeCap = sculptLoft([
    { y: -0.132, rx: 0.060, rz: 0.040, xOffset: x, zOffset: 0.142 },
    { y: -0.104, rx: 0.064, rz: 0.050, xOffset: x, zOffset: 0.120 },
    { y: -0.086, rx: 0.040, rz: 0.030, xOffset: x, zOffset: 0.098 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.06 })
  const greave = sculptLoft([
    { y: -0.072, rx: 0.076, rz: 0.082, xOffset: x, zOffset: 0.004, frontFlat: 0.06 },
    { y: 0.010, rx: 0.072, rz: 0.084, xOffset: x, zOffset: 0.010 },
    { y: 0.070, rx: 0.078, rz: 0.088, xOffset: x, zOffset: 0.008 },
    { y: 0.112, rx: 0.084, rz: 0.090, xOffset: x, zOffset: 0.004 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })
  const ankleBand = createBootCuffBand(side, -0.082, -0.046, 0.088, 0.094)
  const topBand = createBootCuffBand(side, 0.096, 0.128, 0.090, 0.096)
  // Faceted knee cop with a forward point + a flared side fan for a crisp armored silhouette
  const kneeCop = sculptLoft([
    { y: 0.090, rx: 0.050, rz: 0.020, xOffset: x, zOffset: 0.094 },
    { y: 0.132, rx: 0.078, rz: 0.040, xOffset: x, zOffset: 0.088 },
    { y: 0.180, rx: 0.070, rz: 0.036, xOffset: x, zOffset: 0.080 },
    { y: 0.214, rx: 0.030, rz: 0.018, xOffset: x, zOffset: 0.070 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })
  const kneeFan = sculptLoft([
    { y: 0.110, rx: 0.012, rz: 0.040, xOffset: side * 0.090, zOffset: 0.040 },
    { y: 0.160, rx: 0.016, rz: 0.052, xOffset: side * 0.098, zOffset: 0.036 },
    { y: 0.204, rx: 0.008, rz: 0.020, xOffset: side * 0.094, zOffset: 0.030 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.06 })
  const cuisse = sculptLoft([
    { y: 0.170, rx: 0.080, rz: 0.084, xOffset: x, zOffset: 0.004, frontFlat: 0.06 },
    { y: 0.260, rx: 0.090, rz: 0.092, xOffset: x, zOffset: 0.006, frontFlat: 0.06 },
    { y: 0.330, rx: 0.094, rz: 0.094, xOffset: x, zOffset: 0.004 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })
  const built: GreaveMeshes = { sabaton, toeCap, greave, ankleBand, topBand, kneeCop, kneeFan, cuisse }
  greaveMeshCache.set(side, built)
  return built
}

function getEclipseRegaliaMeshes(): EclipseRegaliaMeshes {
  if (cachedEclipseRegalia) return cachedEclipseRegalia
  const crescent = (s: Side): Mesh => bakeVertexAO(tubeMesh([
    [s * 0.270, 0.050, -0.010],
    [s * 0.400, 0.110, -0.030],
    [s * 0.468, 0.240, -0.050],
    [s * 0.452, 0.370, -0.064],
    [s * 0.380, 0.452, -0.070]
  ], [0.050, 0.046, 0.036, 0.022, 0.006], 5), { strength: 0.12, verticalGradient: 0.06 })

  // Long flowing royal mantle sweeping to the floor (cape joint space: anchor at world [0, 0.92, -0.15])
  const rawMantle = sculptLoft([
    makeCapeRing(-0.820, 0.470, -0.236, 0.030, 0.074),
    makeCapeRing(-0.560, 0.392, -0.160, 0.032, 0.064),
    makeCapeRing(-0.280, 0.316, -0.088, 0.034, 0.050),
    makeCapeRing(-0.050, 0.262, -0.026, 0.036, 0.036),
    makeCapeRing(0.034, 0.226, 0.014, 0.038, 0.026)
  ])
  const mantleBody = bakeVertexAO(bakeZoneColors(rawMantle, (_cx, cy, _cz, _nx, _ny, nz) => {
    // Inner lining glows royal magenta so the open front reads from the high board camera
    if (nz > 0.35) return [1.30, 0.62, 1.12, 1]
    if (cy < -0.64) return [0.86, 0.84, 0.92, 1]
    return WHITE
  }), { strength: 0.14, verticalGradient: 0.10 })
  const mantleHem = sculptLoft([
    makeCapeRing(-0.858, 0.480, -0.244, 0.034, 0.078),
    makeCapeRing(-0.790, 0.468, -0.230, 0.034, 0.074)
  ], { aoStrength: 0.10, aoGradient: 0.04 })
  const mantleYoke = sculptLoft([
    makeCapeRing(-0.050, 0.278, -0.010, 0.046, 0.034),
    makeCapeRing(0.046, 0.240, 0.034, 0.048, 0.028)
  ], { aoStrength: 0.12, aoGradient: 0.06 })
  // Back emblem: luminous eclipse ring around a dark sun disc
  const emblemPts: Vec3[] = []
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2
    emblemPts.push([Math.cos(a) * 0.105, -0.300 + Math.sin(a) * 0.105, -0.188])
  }
  const emblemRing = tubeMesh(emblemPts, 0.020, 4)
  const emblemCore = sculptLoft([
    { y: -0.010, rx: 0.080, rz: 0.080 },
    { y: 0.010, rx: 0.074, rz: 0.074 }
  ], { sides: 8 })
  cachedEclipseRegalia = {
    shellL: createShoulderShell(-1, -0.092, 0.104, 0.188, 0.440, 0.132, 0.10),
    shellR: createShoulderShell(1, -0.092, 0.104, 0.188, 0.440, 0.132, 0.10),
    rimL: createPauldronRim(-1, -0.092, 0.188, 0.440, 0.132),
    rimR: createPauldronRim(1, -0.092, 0.188, 0.440, 0.132),
    crescentL: crescent(-1),
    crescentR: crescent(1),
    gem: octahedron,
    mantleBody,
    mantleHem,
    mantleYoke,
    emblemRing,
    emblemCore
  }
  return cachedEclipseRegalia
}

let cachedSpikedRims: { readonly l: Mesh; readonly r: Mesh } | undefined
function getSpikedRimMeshes(): { readonly l: Mesh; readonly r: Mesh } {
  cachedSpikedRims ??= {
    l: createPauldronRim(-1, -0.088, 0.192, 0.430, 0.126),
    r: createPauldronRim(1, -0.088, 0.192, 0.430, 0.126)
  }
  return cachedSpikedRims
}

function trimTone(palette: CharacterPalette): Color {
  // Bright trim band that always contrasts with dark plate (silver for steel accents, gold for gold accents)
  return mixColor(palette.accent, [0.92, 0.92, 0.96, 1], 0.30)
}

function buildGreaveParts(side: Side, palette: CharacterPalette): RigPart[] {
  const m = getGreaveMeshes(side)
  const tag = side === -1 ? 'l' : 'r'
  const plate = palette.metal
  const plateLight = shadeColor(palette.metal, 0.10)
  const trim = trimTone(palette)
  return [
    { name: `greave_sabaton_${tag}`, mesh: m.sabaton, color: shadeColor(palette.metalDark, 0.04) },
    { name: `greave_toe_${tag}`, mesh: m.toeCap, color: plateLight },
    { name: `greave_shin_${tag}`, mesh: m.greave, color: plate },
    { name: `greave_ankle_${tag}`, mesh: m.ankleBand, color: trim },
    { name: `greave_band_${tag}`, mesh: m.topBand, color: trim },
    { name: `greave_knee_${tag}`, mesh: m.kneeCop, color: plateLight },
    { name: `greave_fan_${tag}`, mesh: m.kneeFan, color: trim },
    { name: `greave_cuisse_${tag}`, mesh: m.cuisse, color: shadeColor(palette.metal, -0.06) }
  ]
}

// ---------------------------------------------------------------------------
// Public Registration Entry Point
// ---------------------------------------------------------------------------

/**
 * Register Crownshard's complete modular low-poly armor, tunic, pauldron, collar,
 * belt, skirt, cloak, quiver, halo, bracer, and boot-cuff library onto a CharacterBuilder.
 */
export function registerCrownshardArmor(builder: CharacterBuilder): void {
  // -------------------------------------------------------------------------
  // CHEST
  // -------------------------------------------------------------------------
  builder.registerPart('chest', 'chest_plate', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'chest_plate_cuirass', mesh: m.plateCuirass, color: palette.metal },
      { name: 'chest_plate_surcoat_f', mesh: m.plateSurcoatFront, color: palette.primary },
      { name: 'chest_plate_surcoat_b', mesh: m.plateSurcoatBack, color: palette.primaryDark },
      { name: 'chest_plate_collar', mesh: m.plateCollarRim, color: gold },
      { name: 'chest_plate_crest', mesh: m.chestCrest, position: [0, 0.072, 0.186], color: gold },
      { name: 'chest_plate_crest_in', mesh: m.chestCrestInner, position: [0, 0.072, 0.194], color: shadeColor(gold, 0.14) }
    ]
  })

  builder.registerPart('chest', 'chest_ranger_vest', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'ranger_under', mesh: m.rangerUnder, color: palette.primaryDark },
      { name: 'ranger_vest', mesh: m.rangerVest, color: palette.primary },
      { name: 'ranger_strap_f', mesh: m.rangerStrapFront, color: palette.leather },
      { name: 'ranger_strap_b', mesh: m.rangerStrapBack, color: palette.leather },
      { name: 'ranger_strap_t', mesh: m.rangerStrapTop, color: palette.leatherLight },
      {
        name: 'ranger_clasp',
        mesh: m.rangerClasp,
        position: [-0.056, 0.098, 0.184],
        rotation: [Math.PI * 0.5, 0, 0],
        color: gold
      }
    ]
  })

  builder.registerPart('chest', 'chest_arcane_robe', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'arcane_coat', mesh: m.arcaneCoat, color: palette.primary },
      { name: 'arcane_stole', mesh: m.arcaneStole, color: palette.primaryDark },
      { name: 'arcane_stole_l', mesh: m.arcaneStoleEdgeL, color: gold },
      { name: 'arcane_stole_r', mesh: m.arcaneStoleEdgeR, color: gold },
      { name: 'arcane_collar', mesh: m.arcaneCollar, color: palette.primaryDark },
      {
        name: 'arcane_brooch_frame',
        mesh: m.arcaneBroochOuter,
        position: [0, 0.118, 0.184],
        rotation: [Math.PI * 0.5, 0, 0],
        color: gold
      },
      {
        name: 'arcane_brooch_gem',
        mesh: m.arcaneBroochGem,
        position: [0, 0.118, 0.194],
        color: palette.glow,
        unlit: 0.90
      }
    ]
  })

  builder.registerPart('chest', 'chest_cleric_vestment', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    const ivory = ivoryTone(palette)
    return [
      { name: 'cleric_tunic', mesh: m.clericTunic, color: ivory },
      { name: 'cleric_tabard', mesh: m.clericTabard, color: palette.primary },
      { name: 'cleric_trim_l', mesh: m.clericTabardTrimL, color: gold },
      { name: 'cleric_trim_r', mesh: m.clericTabardTrimR, color: gold },
      {
        name: 'cleric_sun_outer',
        mesh: m.clericSunOuter,
        position: [0, 0.068, 0.188],
        rotation: [Math.PI * 0.5, 0, 0],
        color: gold
      },
      {
        name: 'cleric_sun_core',
        mesh: m.clericSunCore,
        position: [0, 0.068, 0.196],
        rotation: [Math.PI * 0.5, 0, 0],
        color: shadeColor(gold, 0.16),
        unlit: 0.55
      }
    ]
  })

  builder.registerPart('chest', 'chest_rogue_leathers', (palette) => {
    const m = getArmorMeshes()
    const darkLeather = shadeColor(palette.leather, -0.16)
    const crimsonSash = mixColor(palette.accent, CRIMSON, 0.62)
    return [
      { name: 'rogue_jerkin', mesh: m.rogueJerkin, color: darkLeather },
      {
        name: 'rogue_strap_a',
        mesh: m.rogueStrapBar,
        position: [0, 0.048, 0.174],
        rotation: [0, 0, 0.62],
        color: palette.leatherLight
      },
      {
        name: 'rogue_strap_b',
        mesh: m.rogueStrapBar,
        position: [0, 0.048, 0.174],
        rotation: [0, 0, -0.62],
        color: palette.leatherLight
      },
      {
        name: 'rogue_buckle',
        mesh: m.rogueBuckle,
        position: [0, 0.048, 0.184],
        rotation: [Math.PI * 0.5, 0, 0],
        color: palette.metal
      },
      { name: 'rogue_sash', mesh: m.rogueSash, color: crimsonSash }
    ]
  })

  builder.registerPart('chest', 'chest_obsidian_plate', (palette) => {
    const m = getArmorMeshes()
    const darkIron = obsidianTone(palette)
    const ridgeIron = mixColor(palette.metal, darkIron, 0.35)
    const trim = trimTone(palette)
    const violetGlow = mixColor(palette.glow, VIOLET_RUNE, 0.22)
    return [
      { name: 'obsidian_cuirass', mesh: m.obsidianCuirass, color: darkIron },
      { name: 'obsidian_collar', mesh: m.obsidianCollar, color: trim },
      { name: 'obsidian_ridge_l', mesh: m.obsidianRidgeL, color: ridgeIron },
      { name: 'obsidian_ridge_r', mesh: m.obsidianRidgeR, color: ridgeIron },
      { name: 'obsidian_rune_frame', mesh: m.obsidianRuneFrame, position: [0, 0.068, 0.194], color: trim },
      { name: 'obsidian_rune_core', mesh: m.obsidianRuneCore, position: [0, 0.068, 0.204], color: violetGlow, unlit: 0.94 },
      {
        name: 'obsidian_rune_bar_l',
        mesh: m.obsidianRuneBar,
        position: [-0.072, 0.068, 0.194],
        rotation: [0, -0.35, 0.24],
        color: violetGlow,
        unlit: 0.90
      },
      {
        name: 'obsidian_rune_bar_r',
        mesh: m.obsidianRuneBar,
        position: [0.072, 0.068, 0.194],
        rotation: [0, 0.35, -0.24],
        color: violetGlow,
        unlit: 0.90
      }
    ]
  })

  // -------------------------------------------------------------------------
  // PAULDRONS
  // -------------------------------------------------------------------------
  builder.registerPart('pauldrons', 'pauldrons_knight', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'pauldron_knight_l', mesh: m.knightPauldronL, color: palette.metal },
      { name: 'pauldron_knight_r', mesh: m.knightPauldronR, color: palette.metal },
      { name: 'pauldron_knight_rim_l', mesh: m.knightRimL, color: gold },
      { name: 'pauldron_knight_rim_r', mesh: m.knightRimR, color: gold },
      { name: 'pauldron_knight_boss_l', mesh: m.knightBoss, position: [-0.365, 0.015, 0], rotation: [0, 0, Math.PI * 0.42], color: gold },
      { name: 'pauldron_knight_boss_r', mesh: m.knightBoss, position: [0.365, 0.015, 0], rotation: [0, 0, -Math.PI * 0.42], color: gold }
    ]
  })

  builder.registerPart('pauldrons', 'pauldrons_paladin', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    const ivory = ivoryTone(palette)
    return [
      { name: 'pauldron_paladin_l', mesh: m.paladinPauldronL, color: ivory },
      { name: 'pauldron_paladin_r', mesh: m.paladinPauldronR, color: ivory },
      { name: 'pauldron_paladin_rim_l', mesh: m.paladinRimL, color: gold },
      { name: 'pauldron_paladin_rim_r', mesh: m.paladinRimR, color: gold },
      { name: 'pauldron_paladin_wing_l', mesh: m.paladinWingL, color: gold },
      { name: 'pauldron_paladin_wing_r', mesh: m.paladinWingR, color: gold }
    ]
  })

  builder.registerPart('pauldrons', 'pauldrons_ranger', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'pauldron_ranger_l_top', mesh: m.rangerPadLTop, color: palette.leather },
      { name: 'pauldron_ranger_l_low', mesh: m.rangerPadLLower, color: palette.leatherLight },
      { name: 'pauldron_ranger_r_cap', mesh: m.rangerCapR, color: palette.leather },
      {
        name: 'pauldron_ranger_clasp',
        mesh: m.rangerPauldronClasp,
        position: [-0.258, 0.022, 0.114],
        rotation: [Math.PI * 0.5, 0.28, 0],
        color: gold
      }
    ]
  })

  builder.registerPart('pauldrons', 'pauldrons_arcane', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'pauldron_arcane_l', mesh: m.arcaneMantleL, color: palette.primaryDark },
      { name: 'pauldron_arcane_r', mesh: m.arcaneMantleR, color: palette.primaryDark },
      { name: 'pauldron_arcane_trim_l', mesh: m.arcaneTrimL, color: gold },
      { name: 'pauldron_arcane_trim_r', mesh: m.arcaneTrimR, color: gold },
      { name: 'pauldron_arcane_gem_l', mesh: m.arcaneGem, position: [-0.328, 0.015, 0.122], rotation: [0, -0.45, 0], color: palette.glow, unlit: 0.85 },
      { name: 'pauldron_arcane_gem_r', mesh: m.arcaneGem, position: [0.328, 0.015, 0.122], rotation: [0, 0.45, 0], color: palette.glow, unlit: 0.85 }
    ]
  })

  builder.registerPart('pauldrons', 'pauldrons_spiked', (palette) => {
    const m = getArmorMeshes()
    const darkIron = obsidianTone(palette)
    const spikeSteel = shadeColor(palette.metal, 0.06)
    const rims = getSpikedRimMeshes()
    const trim = trimTone(palette)
    return [
      { name: 'pauldron_spiked_l', mesh: m.spikedPauldronL, color: darkIron },
      { name: 'pauldron_spiked_r', mesh: m.spikedPauldronR, color: darkIron },
      { name: 'pauldron_spiked_rim_l', mesh: rims.l, color: trim },
      { name: 'pauldron_spiked_rim_r', mesh: rims.r, color: trim },
      // Left spikes
      { name: 'spike_l_main', mesh: m.spikeLarge, position: [-0.365, 0.042, 0], rotation: [0, 0, 0.68], color: spikeSteel },
      { name: 'spike_l_front', mesh: m.spikeSmall, position: [-0.340, 0.012, 0.088], rotation: [0.46, 0, 0.92], color: spikeSteel },
      { name: 'spike_l_back', mesh: m.spikeSmall, position: [-0.340, 0.012, -0.088], rotation: [-0.46, 0, 0.92], color: spikeSteel },
      // Right spikes
      { name: 'spike_r_main', mesh: m.spikeLarge, position: [0.365, 0.042, 0], rotation: [0, 0, -0.68], color: spikeSteel },
      { name: 'spike_r_front', mesh: m.spikeSmall, position: [0.340, 0.012, 0.088], rotation: [0.46, 0, -0.92], color: spikeSteel },
      { name: 'spike_r_back', mesh: m.spikeSmall, position: [0.340, 0.012, -0.088], rotation: [-0.46, 0, -0.92], color: spikeSteel }
    ]
  })

  builder.registerPart('pauldrons', 'pauldrons_gilded', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    const brightGold = shadeColor(gold, 0.12)
    return [
      { name: 'pauldron_gilded_up_l', mesh: m.gildedUpperL, color: gold },
      { name: 'pauldron_gilded_up_r', mesh: m.gildedUpperR, color: gold },
      { name: 'pauldron_gilded_lo_l', mesh: m.gildedLowerL, color: shadeColor(gold, -0.10) },
      { name: 'pauldron_gilded_lo_r', mesh: m.gildedLowerR, color: shadeColor(gold, -0.10) },
      { name: 'pauldron_gilded_wing_l', mesh: m.gildedWingL, color: brightGold },
      { name: 'pauldron_gilded_wing_r', mesh: m.gildedWingR, color: brightGold },
      { name: 'pauldron_gilded_gem_l', mesh: m.gildedCrestGem, position: [-0.348, 0.048, 0.114], rotation: [0, -0.42, 0], color: palette.glow, unlit: 0.88 },
      { name: 'pauldron_gilded_gem_r', mesh: m.gildedCrestGem, position: [0.348, 0.048, 0.114], rotation: [0, 0.42, 0], color: palette.glow, unlit: 0.88 }
    ]
  })

  // -------------------------------------------------------------------------
  // COLLARS
  // -------------------------------------------------------------------------
  builder.registerPart('collar', 'collar_scarf', (palette) => {
    const m = getArmorMeshes()
    const mainScarf = palette.accent
    const foldShade = shadeColor(mainScarf, -0.10)
    return [
      { name: 'collar_scarf_wrap', mesh: m.scarfWrap, color: mainScarf },
      { name: 'collar_scarf_fold', mesh: m.scarfUpperFold, color: foldShade },
      { name: 'collar_scarf_tail', mesh: m.scarfTail, color: mainScarf }
    ]
  })

  builder.registerPart('collar', 'collar_fur', (palette) => {
    const m = getArmorMeshes()
    return [
      { name: 'collar_fur_mantle', mesh: m.furCollar, color: furTone(palette) }
    ]
  })

  builder.registerPart('collar', 'collar_gold_mantle', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'collar_gold_gorget', mesh: m.goldGorgetBase, color: gold },
      { name: 'collar_gold_standing', mesh: m.goldStandingCollar, color: shadeColor(gold, 0.08) },
      { name: 'collar_gold_gem', mesh: m.goldCollarGem, position: [0, -0.022, 0.184], color: palette.glow, unlit: 0.80 }
    ]
  })

  // -------------------------------------------------------------------------
  // BELTS
  // -------------------------------------------------------------------------
  builder.registerPart('belt', 'belt_hex_plate', (palette) => {
    const m = getArmorMeshes()
    return [
      { name: 'belt_hex_strap', mesh: m.beltStrapChunky, color: palette.leather },
      { name: 'belt_hex_side_l', mesh: m.beltSidePlate, position: [-0.228, 0, 0.012], color: palette.metalDark },
      { name: 'belt_hex_side_r', mesh: m.beltSidePlate, position: [0.228, 0, 0.012], color: palette.metalDark },
      {
        name: 'belt_hex_outer',
        mesh: m.beltHexOuter,
        position: [0, 0, 0.174],
        rotation: [Math.PI * 0.5, 0, 0],
        color: palette.metal
      },
      {
        name: 'belt_hex_inner',
        mesh: m.beltHexInner,
        position: [0, 0, 0.188],
        rotation: [Math.PI * 0.5, 0, 0],
        color: palette.metalDark
      },
      {
        name: 'belt_hex_boss',
        mesh: m.beltHexBoss,
        position: [0, 0, 0.198],
        rotation: [Math.PI * 0.5, 0, 0],
        color: shadeColor(palette.metal, 0.12)
      }
    ]
  })

  builder.registerPart('belt', 'belt_ranger_pouches', (palette) => {
    const m = getArmorMeshes()
    const brass = goldTone(palette)
    return [
      { name: 'belt_ranger_strap', mesh: m.beltStrapChunky, color: palette.leather },
      { name: 'belt_ranger_trim', mesh: m.beltStrapTrim, color: palette.leatherLight },
      { name: 'belt_ranger_buckle', mesh: m.beltBrassBuckle, position: [0, 0, 0.172], color: brass },
      // Left hip pouch
      {
        name: 'belt_pouch_l_body',
        mesh: m.beltPouchBody,
        position: [-0.212, -0.022, 0.088],
        rotation: [0, 0.42, 0.10],
        color: palette.leather
      },
      {
        name: 'belt_pouch_l_flap',
        mesh: m.beltPouchFlap,
        position: [-0.212, -0.018, 0.088],
        rotation: [0, 0.42, 0.10],
        color: palette.leatherLight
      },
      // Right hip pouch
      {
        name: 'belt_pouch_r_body',
        mesh: m.beltPouchBody,
        position: [0.212, -0.022, 0.088],
        rotation: [0, -0.42, -0.10],
        color: palette.leather
      },
      {
        name: 'belt_pouch_r_flap',
        mesh: m.beltPouchFlap,
        position: [0.212, -0.018, 0.088],
        rotation: [0, -0.42, -0.10],
        color: palette.leatherLight
      }
    ]
  })

  builder.registerPart('belt', 'belt_arcane_sash', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'belt_sash_band', mesh: m.beltSashBand, color: palette.accent },
      { name: 'belt_sash_fold', mesh: m.beltSashFold, color: shadeColor(palette.accent, -0.10) },
      { name: 'belt_sash_drape', mesh: m.beltSashDrape, color: palette.accent },
      { name: 'belt_sash_trim', mesh: m.beltSashTrim, color: gold },
      {
        name: 'belt_sash_clasp',
        mesh: m.beltHexInner,
        position: [0, 0.004, 0.194],
        rotation: [Math.PI * 0.5, 0, 0],
        color: gold
      },
      {
        name: 'belt_sash_gem',
        mesh: m.beltHexBoss,
        position: [0, 0.004, 0.205],
        rotation: [Math.PI * 0.5, 0, 0],
        color: palette.glow,
        unlit: 0.85
      }
    ]
  })

  // -------------------------------------------------------------------------
  // SKIRT / TASSETS
  // -------------------------------------------------------------------------
  builder.registerPart('skirt', 'skirt_tassets', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'tasset_up_l', mesh: m.tassetUpperL, color: palette.metal },
      { name: 'tasset_up_r', mesh: m.tassetUpperR, color: palette.metal },
      { name: 'tasset_lo_l', mesh: m.tassetLowerL, color: shadeColor(palette.metal, -0.08) },
      { name: 'tasset_lo_r', mesh: m.tassetLowerR, color: shadeColor(palette.metal, -0.08) },
      { name: 'tabard_front', mesh: m.tabardFront, color: palette.primary },
      { name: 'tabard_front_trim', mesh: m.tabardFrontTrim, color: gold },
      { name: 'tabard_back', mesh: m.tabardBack, color: palette.primaryDark }
    ]
  })

  builder.registerPart('skirt', 'skirt_robe_hem', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'robe_skirt_body', mesh: m.robeSkirtBody, color: palette.primary },
      { name: 'robe_skirt_hem', mesh: m.robeSkirtHem, color: gold },
      { name: 'robe_skirt_panel', mesh: m.robeSkirtFrontPanel, color: palette.secondary }
    ]
  })

  builder.registerPart('skirt', 'skirt_ranger_tunic', (palette) => {
    const m = getArmorMeshes()
    return [
      { name: 'ranger_skirt_waist', mesh: m.rangerSkirtWaist, color: palette.primary },
      { name: 'ranger_tail_fl', mesh: m.rangerTailFrontL, color: palette.primary },
      { name: 'ranger_tail_fr', mesh: m.rangerTailFrontR, color: palette.primary },
      { name: 'ranger_tail_back', mesh: m.rangerTailBack, color: palette.primaryDark },
      { name: 'ranger_trim_fl', mesh: m.rangerTailTrimL, color: palette.leatherLight },
      { name: 'ranger_trim_fr', mesh: m.rangerTailTrimR, color: palette.leatherLight },
      { name: 'ranger_trim_back', mesh: m.rangerTailTrimBack, color: palette.leatherLight }
    ]
  })

  // -------------------------------------------------------------------------
  // BACK (CAPES, QUIVER, HALO)
  // -------------------------------------------------------------------------
  builder.registerPart('back', 'cape_royal', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'cape_royal_body', mesh: m.capeRoyalBody, color: palette.primary },
      { name: 'cape_royal_trim', mesh: m.capeRoyalTrim, color: gold },
      {
        name: 'cape_clasp_l',
        mesh: m.capeClasp,
        position: [-0.175, 0.024, 0.032],
        rotation: [Math.PI * 0.5, 0, 0],
        color: gold
      },
      {
        name: 'cape_clasp_r',
        mesh: m.capeClasp,
        position: [0.175, 0.024, 0.032],
        rotation: [Math.PI * 0.5, 0, 0],
        color: gold
      }
    ]
  })

  builder.registerPart('back', 'cape_tattered', (palette) => {
    const m = getArmorMeshes()
    const shadowCloth = shadeColor(palette.primary, -0.02)
    const tipShade = palette.primaryDark
    return [
      { name: 'cape_tattered_yoke', mesh: m.capeTatteredYoke, color: palette.metalDark },
      { name: 'cape_tattered_body', mesh: m.capeTatteredBody, color: shadowCloth },
      { name: 'cape_tatter_1', mesh: m.capeTatterLong, position: [-0.242, -0.525, -0.140], rotation: [0.18, 0, -0.10], color: tipShade },
      { name: 'cape_tatter_2', mesh: m.capeTatterMid, position: [-0.118, -0.525, -0.160], rotation: [0.16, 0, -0.04], color: shadowCloth },
      { name: 'cape_tatter_3', mesh: m.capeTatterLong, position: [0.000, -0.525, -0.168], rotation: [0.20, 0, 0.02], color: tipShade },
      { name: 'cape_tatter_4', mesh: m.capeTatterMid, position: [0.122, -0.525, -0.160], rotation: [0.15, 0, 0.06], color: shadowCloth },
      { name: 'cape_tatter_5', mesh: m.capeTatterLong, position: [0.244, -0.525, -0.138], rotation: [0.18, 0, 0.12], color: tipShade }
    ]
  })

  builder.registerPart('back', 'quiver_arrows', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    const rot: readonly [number, number, number] = [0.16, 0.08, -0.54]
    return [
      { name: 'quiver_body', mesh: m.quiverBody, position: [0.052, -0.105, -0.070], rotation: rot, color: palette.leather },
      { name: 'quiver_rim', mesh: m.quiverRim, position: [0.052, -0.105, -0.070], rotation: rot, color: palette.leatherLight },
      { name: 'quiver_band', mesh: m.quiverBand, position: [0.052, -0.105, -0.070], rotation: rot, color: gold },
      { name: 'quiver_cap', mesh: m.quiverCap, position: [0.052, -0.105, -0.070], rotation: rot, color: palette.metalDark },
      // Arrow 1 (outer right — clearly visible over right shoulder from Front!)
      { name: 'arrow_shaft_1', mesh: m.arrowShaft, position: [0.188, 0.062, -0.092], rotation: [0.18, 0.10, -0.60], color: palette.leatherLight },
      { name: 'arrow_fletch_1', mesh: m.arrowFletch, position: [0.278, 0.182, -0.120], rotation: [0.18, 0.10, -0.60], color: palette.accent },
      // Arrow 2 (center)
      { name: 'arrow_shaft_2', mesh: m.arrowShaft, position: [0.152, 0.082, -0.076], rotation: [0.14, 0.06, -0.52], color: palette.leatherLight },
      { name: 'arrow_fletch_2', mesh: m.arrowFletch, position: [0.232, 0.214, -0.098], rotation: [0.14, 0.06, -0.52], color: palette.secondary },
      // Arrow 3 (inner)
      { name: 'arrow_shaft_3', mesh: m.arrowShaft, position: [0.120, 0.070, -0.104], rotation: [0.20, 0.08, -0.44], color: palette.leatherLight },
      { name: 'arrow_fletch_3', mesh: m.arrowFletch, position: [0.188, 0.208, -0.136], rotation: [0.20, 0.08, -0.44], color: palette.accent }
    ]
  })

  builder.registerPart('back', 'halo_radiant', (palette) => {
    const m = getArmorMeshes()
    const gold = goldTone(palette)
    const brightGold = shadeColor(gold, 0.12)
    const parts: RigPart[] = []
    const cy = 0.315
    const cz = -0.112
    const ringRadius = 0.330
    const segCount = 8

    for (let i = 0; i < segCount; i++) {
      const a = (i / segCount) * Math.PI * 2
      const sx = Math.cos(a) * ringRadius
      const sy = cy + Math.sin(a) * ringRadius
      parts.push({
        name: `halo_seg_${i}`,
        mesh: m.haloSegment,
        position: [sx, sy, cz],
        rotation: [0, 0, a],
        color: gold,
        unlit: 0.44
      })

      // Radiating solar spikes straight outward from each segment's cardinal/diagonal midpoint
      const isMajor = i % 2 === 0
      const rx = Math.cos(a) * (ringRadius + 0.012)
      const ry = cy + Math.sin(a) * (ringRadius + 0.012)
      parts.push({
        name: `halo_ray_${i}`,
        mesh: isMajor ? m.haloRayLong : m.haloRayShort,
        position: [rx, ry, cz],
        rotation: [0, 0, a - Math.PI * 0.5],
        color: isMajor ? brightGold : gold,
        unlit: 0.52
      })
    }

    // 4 luminous cardinal sun-gems mounted on the ring
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2
      parts.push({
        name: `halo_gem_${k}`,
        mesh: m.haloGem,
        position: [Math.cos(a) * ringRadius, cy + Math.sin(a) * ringRadius, cz + 0.014],
        color: palette.glow,
        unlit: 0.92
      })
    }

    return parts
  })

  // -------------------------------------------------------------------------
  // BRACERS (registered identically in BOTH bracerL and bracerR)
  // -------------------------------------------------------------------------
  builder.registerPart('bracerL', 'bracer_plate', (palette) => buildBracerParts(-1, 'plate', palette))
  builder.registerPart('bracerR', 'bracer_plate', (palette) => buildBracerParts(1, 'plate', palette))

  builder.registerPart('bracerL', 'bracer_leather', (palette) => buildBracerParts(-1, 'leather', palette))
  builder.registerPart('bracerR', 'bracer_leather', (palette) => buildBracerParts(1, 'leather', palette))

  builder.registerPart('bracerL', 'bracer_gold', (palette) => buildBracerParts(-1, 'gold', palette))
  builder.registerPart('bracerR', 'bracer_gold', (palette) => buildBracerParts(1, 'gold', palette))

  // -------------------------------------------------------------------------
  // BOOT CUFFS (registered identically in BOTH bootL and bootR)
  // -------------------------------------------------------------------------
  builder.registerPart('bootL', 'boot_cuff_fur', (palette) => buildBootCuffParts(-1, 'fur', palette))
  builder.registerPart('bootR', 'boot_cuff_fur', (palette) => buildBootCuffParts(1, 'fur', palette))

  builder.registerPart('bootL', 'boot_cuff_plate', (palette) => buildBootCuffParts(-1, 'plate', palette))
  builder.registerPart('bootR', 'boot_cuff_plate', (palette) => buildBootCuffParts(1, 'plate', palette))

  builder.registerPart('bootL', 'boot_cuff_gold', (palette) => buildBootCuffParts(-1, 'gold', palette))
  builder.registerPart('bootR', 'boot_cuff_gold', (palette) => buildBootCuffParts(1, 'gold', palette))

  // Full-leg plate: sabaton + greave + knee cop + cuisse (hides bare shins/feet on skeletons & mannequins)
  builder.registerPart('bootL', 'boot_greave_plate', (palette) => buildGreaveParts(-1, palette))
  builder.registerPart('bootR', 'boot_greave_plate', (palette) => buildGreaveParts(1, palette))

  // -------------------------------------------------------------------------
  // ECLIPSE ARCHON BOSS REGALIA
  // -------------------------------------------------------------------------
  builder.registerPart('pauldrons', 'pauldrons_eclipse', (palette) => {
    const m = getEclipseRegaliaMeshes()
    const gold = goldTone(palette)
    const plate = mixColor(palette.metal, palette.primary, 0.35)
    return [
      { name: 'pauldron_eclipse_l', mesh: m.shellL, color: plate },
      { name: 'pauldron_eclipse_r', mesh: m.shellR, color: plate },
      { name: 'pauldron_eclipse_rim_l', mesh: m.rimL, color: gold },
      { name: 'pauldron_eclipse_rim_r', mesh: m.rimR, color: gold },
      { name: 'pauldron_eclipse_crescent_l', mesh: m.crescentL, color: shadeColor(gold, 0.08) },
      { name: 'pauldron_eclipse_crescent_r', mesh: m.crescentR, color: shadeColor(gold, 0.08) },
      { name: 'pauldron_eclipse_gem_l', mesh: m.gem, position: [-0.330, 0.020, 0.128], scale: [0.034, 0.046, 0.022], color: palette.glow, unlit: 0.92 },
      { name: 'pauldron_eclipse_gem_r', mesh: m.gem, position: [0.330, 0.020, 0.128], scale: [0.034, 0.046, 0.022], color: palette.glow, unlit: 0.92 }
    ]
  })

  builder.registerPart('back', 'mantle_eclipse', (palette) => {
    const m = getEclipseRegaliaMeshes()
    const gold = goldTone(palette)
    return [
      { name: 'mantle_eclipse_body', mesh: m.mantleBody, color: palette.primary },
      { name: 'mantle_eclipse_hem', mesh: m.mantleHem, color: gold },
      { name: 'mantle_eclipse_yoke', mesh: m.mantleYoke, color: gold },
      { name: 'mantle_eclipse_core', mesh: m.emblemCore, position: [0, -0.300, -0.180], rotation: [Math.PI * 0.5, 0, 0], color: palette.metalDark },
      { name: 'mantle_eclipse_ring', mesh: m.emblemRing, color: palette.glow, unlit: 0.90 }
    ]
  })
}
