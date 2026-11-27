import {
  bakeVertexAO,
  bakeZoneColors,
  mixColor,
  sculptLoft,
  shadeColor
} from 'ridgetop'
import type {
  CharacterBuilder,
  CharacterPalette,
  Color,
  Mesh,
  RigPart
} from 'ridgetop'

const WHITE: Color = [1, 1, 1, 1]
const TUSK_IVORY: Color = [0.95, 0.91, 0.79, 1]
const SCAR_CRIMSON: Color = [0.56, 0.15, 0.19, 1]

// ---------------------------------------------------------------------------
// Shared geometry helpers
// ---------------------------------------------------------------------------

function makeSpikeMesh(
  length: number,
  baseRx: number,
  baseRz: number,
  sides: number,
  xTip = 0,
  zTip = 0,
  aoStrength = 0.16
): Mesh {
  return sculptLoft([
    { y: 0.000, rx: baseRx, rz: baseRz },
    { y: length * 0.28, rx: baseRx * 0.92, rz: baseRz * 0.90, xOffset: xTip * 0.18, zOffset: zTip * 0.18 },
    { y: length * 0.68, rx: baseRx * 0.54, rz: baseRz * 0.52, xOffset: xTip * 0.58, zOffset: zTip * 0.58 },
    { y: length, rx: baseRx * 0.08, rz: baseRz * 0.08, xOffset: xTip, zOffset: zTip }
  ], { sides, aoStrength, aoGradient: 0.10 })
}

// ---------------------------------------------------------------------------
// 1. Skeleton Body Meshes
// ---------------------------------------------------------------------------

interface SkeletonMeshes {
  readonly cranium: Mesh
  readonly browRidge: Mesh
  readonly eyeSocket: Mesh
  readonly noseCavity: Mesh
  readonly upperJaw: Mesh
  readonly lowerJaw: Mesh
  readonly mouthGap: Mesh
  readonly toothBlock: Mesh
  readonly neckSpine: Mesh
  readonly thoracicSpine: Mesh
  readonly spineKnob: Mesh
  readonly ribCavity: Mesh
  readonly ribLow: Mesh
  readonly ribMid: Mesh
  readonly ribTop: Mesh
  readonly sternum: Mesh
  readonly clavicle: Mesh
  readonly pelvis: Mesh
  readonly humerusL: Mesh
  readonly humerusR: Mesh
  readonly forearmL: Mesh
  readonly forearmR: Mesh
  readonly handL: Mesh
  readonly handR: Mesh
  readonly thumbL: Mesh
  readonly thumbR: Mesh
  readonly femur: Mesh
  readonly kneeCap: Mesh
  readonly tibia: Mesh
  readonly foot: Mesh
}

let cachedSkeletonMeshes: SkeletonMeshes | undefined

function getSkeletonMeshes(): SkeletonMeshes {
  if (cachedSkeletonMeshes) return cachedSkeletonMeshes

  // Iconic chiseled skull cranium (high cheek bones, hollowed lower cheek transition)
  const rawCranium = sculptLoft([
    { y: 0.155, rx: 0.145, rz: 0.148, zOffset: -0.004, frontFlat: 0.10 },
    { y: 0.225, rx: 0.236, rz: 0.205, zOffset: 0.008, frontFlat: 0.10 },
    { y: 0.365, rx: 0.244, rz: 0.216, zOffset: 0.008, frontFlat: 0.08 },
    { y: 0.495, rx: 0.236, rz: 0.212, zOffset: 0.000, frontFlat: 0.06 },
    { y: 0.575, rx: 0.168, rz: 0.158, zOffset: -0.010 },
    { y: 0.602, rx: 0.095, rz: 0.090, zOffset: -0.014 }
  ], { sides: 8 })
  const zonedCranium = bakeZoneColors(rawCranium, (cx, cy, cz, _nx, ny, nz) => {
    if (ny < -0.35 && cy < 0.24) return [0.80, 0.77, 0.72, 1]
    if (cy > 0.23 && cy < 0.36 && cz > 0.12 && Math.abs(cx) > 0.13 && nz > 0.2) return [1.04, 1.02, 0.98, 1]
    return WHITE
  })
  const cranium = bakeVertexAO(zonedCranium, { strength: 0.16, verticalGradient: 0.09 })

  const browRidge = sculptLoft([
    { y: -0.016, rx: 0.175, rz: 0.032, frontFlat: 0.14 },
    { y:  0.006, rx: 0.192, rz: 0.040, frontFlat: 0.14 },
    { y:  0.024, rx: 0.166, rz: 0.028, frontFlat: 0.10 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const eyeSocket = sculptLoft([
    { y: -0.044, rx: 0.044, rz: 0.022 },
    { y:  0.004, rx: 0.056, rz: 0.028 },
    { y:  0.042, rx: 0.046, rz: 0.022 }
  ], { sides: 6 })

  const noseCavity = sculptLoft([
    { y: -0.032, rx: 0.034, rz: 0.020 },
    { y:  0.000, rx: 0.026, rz: 0.022 },
    { y:  0.036, rx: 0.006, rz: 0.014 }
  ], { sides: 6 })

  // Protruding maxilla + articulated lower jaw mandible (tucked cleanly into skull profile)
  const upperJaw = sculptLoft([
    { y: 0.092, rx: 0.132, rz: 0.092, zOffset: 0.094, frontFlat: 0.16 },
    { y: 0.155, rx: 0.152, rz: 0.112, zOffset: 0.086, frontFlat: 0.14 },
    { y: 0.205, rx: 0.144, rz: 0.106, zOffset: 0.078, frontFlat: 0.12 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const lowerJaw = sculptLoft([
    { y: 0.002, rx: 0.100, rz: 0.080, zOffset: 0.080, frontFlat: 0.18 },
    { y: 0.046, rx: 0.126, rz: 0.100, zOffset: 0.086, frontFlat: 0.16 },
    { y: 0.082, rx: 0.130, rz: 0.096, zOffset: 0.086, frontFlat: 0.16 }
  ], { sides: 8, aoStrength: 0.18, aoGradient: 0.10 })

  const mouthGap = sculptLoft([
    { y: 0.068, rx: 0.114, rz: 0.084, zOffset: 0.090, frontFlat: 0.14 },
    { y: 0.102, rx: 0.118, rz: 0.086, zOffset: 0.092, frontFlat: 0.14 }
  ], { sides: 6 })

  const toothBlock = sculptLoft([
    { y: -0.022, rx: 0.017, rz: 0.016 },
    { y:  0.022, rx: 0.017, rz: 0.016 }
  ], { sides: 4 })

  const neckSpine = sculptLoft([
    { y: 0.435, rx: 0.056, rz: 0.054, zOffset: -0.018 },
    { y: 0.485, rx: 0.044, rz: 0.046, zOffset: -0.014 },
    { y: 0.538, rx: 0.052, rz: 0.052, zOffset: -0.012 }
  ], { sides: 6, aoStrength: 0.18, aoGradient: 0.10 })

  const thoracicSpine = sculptLoft([
    { y: 0.065, rx: 0.044, rz: 0.046, zOffset: -0.044 },
    { y: 0.180, rx: 0.048, rz: 0.050, zOffset: -0.052 },
    { y: 0.310, rx: 0.052, rz: 0.054, zOffset: -0.058 },
    { y: 0.440, rx: 0.050, rz: 0.052, zOffset: -0.036 }
  ], { sides: 6, aoStrength: 0.18, aoGradient: 0.10 })

  const spineKnob = sculptLoft([
    { y: -0.020, rx: 0.026, rz: 0.032 },
    { y:  0.000, rx: 0.030, rz: 0.046 },
    { y:  0.020, rx: 0.022, rz: 0.028 }
  ], { sides: 6 })

  const ribCavity = sculptLoft([
    { y: 0.175, rx: 0.132, rz: 0.078, zOffset: -0.008 },
    { y: 0.285, rx: 0.165, rz: 0.096, zOffset: -0.002 },
    { y: 0.405, rx: 0.178, rz: 0.102, zOffset: -0.004 }
  ], { sides: 8 })

  const makeRibRing = (yCenter: number, rx: number, rz: number): Mesh => sculptLoft([
    { y: yCenter - 0.024, rx: rx * 0.94, rz: rz * 0.92, zOffset: 0.004, frontFlat: 0.12, backFlat: 0.10 },
    { y: yCenter, rx, rz, zOffset: 0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y: yCenter + 0.024, rx: rx * 0.94, rz: rz * 0.92, zOffset: 0.004, frontFlat: 0.12, backFlat: 0.10 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const ribLow = makeRibRing(0.205, 0.172, 0.112)
  const ribMid = makeRibRing(0.292, 0.206, 0.128)
  const ribTop = makeRibRing(0.378, 0.222, 0.134)

  const sternum = sculptLoft([
    { y: 0.220, rx: 0.038, rz: 0.028, zOffset: 0.126 },
    { y: 0.315, rx: 0.052, rz: 0.034, zOffset: 0.134 },
    { y: 0.415, rx: 0.062, rz: 0.034, zOffset: 0.128 },
    { y: 0.448, rx: 0.044, rz: 0.026, zOffset: 0.112 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const clavicle = sculptLoft([
    { y: 0.412, rx: 0.258, rz: 0.064, zOffset: 0.012 },
    { y: 0.440, rx: 0.282, rz: 0.076, zOffset: 0.010 },
    { y: 0.464, rx: 0.244, rz: 0.062, zOffset: 0.004 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const rawPelvis = sculptLoft([
    { y: -0.028, rx: 0.122, rz: 0.082 },
    { y:  0.038, rx: 0.194, rz: 0.114, frontFlat: 0.12, backFlat: 0.10 },
    { y:  0.112, rx: 0.176, rz: 0.104, frontFlat: 0.14, backFlat: 0.10 }
  ], { sides: 8 })
  const zonedPelvis = bakeZoneColors(rawPelvis, (cx, cy, _cz, _nx, _ny, nz) => {
    if (Math.abs(cx) < 0.06 && cy > 0.01 && Math.abs(nz) > 0.5) return [0.70, 0.66, 0.62, 1]
    return WHITE
  })
  const pelvis = bakeVertexAO(zonedPelvis, { strength: 0.16, verticalGradient: 0.10 })

  const createBoneUpperArm = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.185, rx: 0.048, rz: 0.048, xOffset: side * 0.008 },
    { y: -0.145, rx: 0.032, rz: 0.034, xOffset: side * 0.002 },
    { y: -0.045, rx: 0.034, rz: 0.036, xOffset: -side * 0.014 },
    { y:  0.018, rx: 0.056, rz: 0.056, xOffset: -side * 0.034 },
    { y:  0.050, rx: 0.038, rz: 0.040, xOffset: -side * 0.054 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const createBoneForearm = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.352, rx: 0.044, rz: 0.044, xOffset: side * 0.024, zOffset: 0.016 },
    { y: -0.310, rx: 0.030, rz: 0.032, xOffset: side * 0.020, zOffset: 0.012 },
    { y: -0.220, rx: 0.032, rz: 0.034, xOffset: side * 0.014, zOffset: 0.006 },
    { y: -0.172, rx: 0.048, rz: 0.048, xOffset: side * 0.008, zOffset: 0.002 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const createBoneHand = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.495, rx: 0.018, rz: 0.028, xOffset: side * 0.022, zOffset: 0.034 },
    { y: -0.452, rx: 0.036, rz: 0.056, xOffset: side * 0.028, zOffset: 0.036 },
    { y: -0.398, rx: 0.046, rz: 0.062, xOffset: side * 0.028, zOffset: 0.028 },
    { y: -0.346, rx: 0.040, rz: 0.044, xOffset: side * 0.024, zOffset: 0.016 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const createBoneThumb = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.440, rx: 0.012, rz: 0.016, xOffset: -side * 0.002, zOffset: 0.068 },
    { y: -0.398, rx: 0.018, rz: 0.022, xOffset: side * 0.008, zOffset: 0.054 },
    { y: -0.365, rx: 0.018, rz: 0.020, xOffset: side * 0.018, zOffset: 0.040 }
  ], { sides: 5, aoStrength: 0.12, aoGradient: 0.06 })

  const femur = sculptLoft([
    { y: -0.255, rx: 0.054, rz: 0.056 },
    { y: -0.215, rx: 0.036, rz: 0.038 },
    { y: -0.075, rx: 0.038, rz: 0.040 },
    { y: -0.015, rx: 0.056, rz: 0.056 },
    { y:  0.022, rx: 0.046, rz: 0.048 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const kneeCap = sculptLoft([
    { y: -0.285, rx: 0.036, rz: 0.028, zOffset: 0.042 },
    { y: -0.255, rx: 0.044, rz: 0.034, zOffset: 0.046 },
    { y: -0.228, rx: 0.034, rz: 0.024, zOffset: 0.040 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const tibia = sculptLoft([
    { y: -0.460, rx: 0.048, rz: 0.048 },
    { y: -0.420, rx: 0.032, rz: 0.036 },
    { y: -0.295, rx: 0.036, rz: 0.040 },
    { y: -0.250, rx: 0.052, rz: 0.054 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  // Skeletal foot grounded squarely at y = -0.500
  const foot = sculptLoft([
    { y: -0.500, rx: 0.060, rz: 0.108, zOffset: 0.042, frontFlat: 0.18 },
    { y: -0.476, rx: 0.062, rz: 0.110, zOffset: 0.044, frontFlat: 0.16 },
    { y: -0.448, rx: 0.052, rz: 0.082, zOffset: 0.026 },
    { y: -0.422, rx: 0.046, rz: 0.052, zOffset: 0.004 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  cachedSkeletonMeshes = {
    cranium,
    browRidge,
    eyeSocket,
    noseCavity,
    upperJaw,
    lowerJaw,
    mouthGap,
    toothBlock,
    neckSpine,
    thoracicSpine,
    spineKnob,
    ribCavity,
    ribLow,
    ribMid,
    ribTop,
    sternum,
    clavicle,
    pelvis,
    humerusL: createBoneUpperArm(-1),
    humerusR: createBoneUpperArm(1),
    forearmL: createBoneForearm(-1),
    forearmR: createBoneForearm(1),
    handL: createBoneHand(-1),
    handR: createBoneHand(1),
    thumbL: createBoneThumb(-1),
    thumbR: createBoneThumb(1),
    femur,
    kneeCap,
    tibia,
    foot
  }
  return cachedSkeletonMeshes
}

// ---------------------------------------------------------------------------
// 2. Goblin Body Meshes
// ---------------------------------------------------------------------------

interface GoblinMeshes {
  readonly head: Mesh
  readonly browRidge: Mesh
  readonly nose: Mesh
  readonly eyeSocket: Mesh
  readonly eyeGlow: Mesh
  readonly mouthSlit: Mesh
  readonly fang: Mesh
  readonly earBaseL: Mesh
  readonly earBaseR: Mesh
  readonly neck: Mesh
  readonly torso: Mesh
  readonly chestStrap: Mesh
  readonly strapBuckle: Mesh
  readonly waistBand: Mesh
  readonly loinFront: Mesh
  readonly loinBack: Mesh
  readonly armL: Mesh
  readonly armR: Mesh
  readonly wristWrapL: Mesh
  readonly wristWrapR: Mesh
  readonly handL: Mesh
  readonly handR: Mesh
  readonly thumbL: Mesh
  readonly thumbR: Mesh
  readonly legUpper: Mesh
  readonly legWrap: Mesh
  readonly foot: Mesh
}

let cachedGoblinMeshes: GoblinMeshes | undefined

function getGoblinMeshes(): GoblinMeshes {
  if (cachedGoblinMeshes) return cachedGoblinMeshes

  // Wide angular cheek/jaw, lower squatter cranium thrust slightly forward for hunched raider feel
  const rawHead = sculptLoft([
    { y: -0.025, rx: 0.104, rz: 0.124, zOffset: 0.044, frontFlat: 0.12 },
    { y:  0.115, rx: 0.236, rz: 0.204, zOffset: 0.032, frontFlat: 0.08 },
    { y:  0.245, rx: 0.258, rz: 0.214, zOffset: 0.024, frontFlat: 0.08 },
    { y:  0.375, rx: 0.244, rz: 0.208, zOffset: 0.012, frontFlat: 0.08 },
    { y:  0.475, rx: 0.204, rz: 0.184, zOffset: 0.002 },
    { y:  0.525, rx: 0.118, rz: 0.112, zOffset: -0.006 }
  ], { sides: 8 })
  const zonedHead = bakeZoneColors(rawHead, (cx, cy, cz, _nx, ny, nz) => {
    if (ny < -0.35 && cy < 0.12) return [0.80, 0.78, 0.76, 1]
    if (cy > 0.15 && cy < 0.26 && cz > 0.14 && Math.abs(cx) > 0.09 && nz > 0.25) return [1.06, 0.96, 0.90, 1]
    return WHITE
  })
  const head = bakeVertexAO(zonedHead, { strength: 0.15, verticalGradient: 0.08 })

  const browRidge = sculptLoft([
    { y: -0.022, rx: 0.084, rz: 0.032, frontFlat: 0.12 },
    { y:  0.004, rx: 0.092, rz: 0.038, frontFlat: 0.12 },
    { y:  0.026, rx: 0.078, rz: 0.026 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  // Sharp hooked pointed goblin nose projecting out along +Z
  const nose = sculptLoft([
    { y: 0.145, rx: 0.012, rz: 0.016, zOffset: 0.312 },
    { y: 0.188, rx: 0.032, rz: 0.058, zOffset: 0.266 },
    { y: 0.238, rx: 0.044, rz: 0.072, zOffset: 0.238 },
    { y: 0.292, rx: 0.036, rz: 0.046, zOffset: 0.214 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const eyeSocket = sculptLoft([
    { y: -0.030, rx: 0.052, rz: 0.020 },
    { y:  0.000, rx: 0.058, rz: 0.024 },
    { y:  0.028, rx: 0.050, rz: 0.018 }
  ], { sides: 6 })

  const eyeGlow = sculptLoft([
    { y: -0.018, rx: 0.036, rz: 0.014 },
    { y:  0.000, rx: 0.040, rz: 0.016 },
    { y:  0.018, rx: 0.034, rz: 0.012 }
  ], { sides: 6 })

  const mouthSlit = sculptLoft([
    { y: -0.014, rx: 0.096, rz: 0.018 },
    { y:  0.000, rx: 0.104, rz: 0.022 },
    { y:  0.014, rx: 0.094, rz: 0.016 }
  ], { sides: 6 })

  const fang = makeSpikeMesh(0.052, 0.016, 0.016, 4, 0, 0.008, 0.10)

  const createEarBase = (side: -1 | 1): Mesh => sculptLoft([
    { y: 0.228, rx: 0.020, rz: 0.032, xOffset: side * 0.242, zOffset: 0.004 },
    { y: 0.268, rx: 0.030, rz: 0.042, xOffset: side * 0.252, zOffset: 0.000 },
    { y: 0.308, rx: 0.020, rz: 0.030, xOffset: side * 0.240, zOffset: 0.002 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const neck = sculptLoft([
    { y: 0.395, rx: 0.106, rz: 0.104, zOffset: 0.022 },
    { y: 0.460, rx: 0.094, rz: 0.094, zOffset: 0.028 },
    { y: 0.520, rx: 0.088, rz: 0.088, zOffset: 0.030 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  // Hunched lean raider torso (back arched forward, narrow nimble waist)
  const torso = sculptLoft([
    { y: 0.045, rx: 0.156, rz: 0.114, zOffset: -0.014, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.160, rx: 0.172, rz: 0.128, zOffset: 0.006, frontFlat: 0.08, backFlat: 0.06 },
    { y: 0.300, rx: 0.224, rz: 0.158, zOffset: 0.024, frontFlat: 0.08, backFlat: 0.04 },
    { y: 0.405, rx: 0.240, rz: 0.168, zOffset: 0.014, frontFlat: 0.10, backFlat: 0.04 },
    { y: 0.468, rx: 0.172, rz: 0.144, zOffset: -0.014 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const chestStrap = sculptLoft([
    { y: -0.178, rx: 0.032, rz: 0.144 },
    { y:  0.000, rx: 0.042, rz: 0.158 },
    { y:  0.178, rx: 0.032, rz: 0.144 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const strapBuckle = sculptLoft([
    { y: -0.034, rx: 0.034, rz: 0.018 },
    { y:  0.000, rx: 0.042, rz: 0.022 },
    { y:  0.034, rx: 0.034, rz: 0.018 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const waistBand = sculptLoft([
    { y: -0.008, rx: 0.194, rz: 0.142, zOffset: -0.008, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.056, rx: 0.204, rz: 0.148, zOffset: -0.006, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.118, rx: 0.188, rz: 0.138, zOffset: -0.004, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  // Tattered ragged leather loincloth flaps (front & back asymmetric angled points)
  const loinFront = sculptLoft([
    { y: -0.185, rx: 0.046, rz: 0.018, xOffset: 0.016, zOffset: 0.136 },
    { y: -0.105, rx: 0.118, rz: 0.026, xOffset: 0.006, zOffset: 0.138 },
    { y:  0.008, rx: 0.146, rz: 0.030, zOffset: 0.130 },
    { y:  0.068, rx: 0.152, rz: 0.028, zOffset: 0.124 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  const loinBack = sculptLoft([
    { y: -0.165, rx: 0.064, rz: 0.018, xOffset: -0.012, zOffset: -0.128 },
    { y: -0.075, rx: 0.126, rz: 0.024, zOffset: -0.132 },
    { y:  0.055, rx: 0.146, rz: 0.026, zOffset: -0.128 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  const createGoblinArm = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.352, rx: 0.040, rz: 0.044, xOffset: side * 0.024, zOffset: 0.022 },
    { y: -0.240, rx: 0.054, rz: 0.058, xOffset: side * 0.018, zOffset: 0.016 },
    { y: -0.145, rx: 0.046, rz: 0.050, xOffset: side * 0.008, zOffset: 0.012 },
    { y: -0.045, rx: 0.060, rz: 0.064, xOffset: -side * 0.010, zOffset: 0.018 },
    { y:  0.030, rx: 0.056, rz: 0.060, xOffset: -side * 0.042, zOffset: 0.016 }
  ], { sides: 7, aoStrength: 0.16, aoGradient: 0.08 })

  const createGoblinWristWrap = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.348, rx: 0.052, rz: 0.056, xOffset: side * 0.024, zOffset: 0.022 },
    { y: -0.295, rx: 0.058, rz: 0.062, xOffset: side * 0.021, zOffset: 0.019 },
    { y: -0.242, rx: 0.062, rz: 0.066, xOffset: side * 0.018, zOffset: 0.016 }
  ], { sides: 7, aoStrength: 0.15, aoGradient: 0.08 })

  const createGoblinHand = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.506, rx: 0.018, rz: 0.026, xOffset: side * 0.022, zOffset: 0.038 },
    { y: -0.460, rx: 0.040, rz: 0.058, xOffset: side * 0.028, zOffset: 0.040 },
    { y: -0.402, rx: 0.050, rz: 0.066, xOffset: side * 0.028, zOffset: 0.032 },
    { y: -0.344, rx: 0.042, rz: 0.048, xOffset: side * 0.024, zOffset: 0.022 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const createGoblinThumb = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.444, rx: 0.013, rz: 0.018, xOffset: -side * 0.002, zOffset: 0.072 },
    { y: -0.404, rx: 0.020, rz: 0.024, xOffset: side * 0.008, zOffset: 0.060 },
    { y: -0.368, rx: 0.018, rz: 0.020, xOffset: side * 0.018, zOffset: 0.044 }
  ], { sides: 5, aoStrength: 0.12, aoGradient: 0.06 })

  // Nimble crouched goblin legs (bent knee forward +Z, grounded at y = -0.500)
  const legUpper = sculptLoft([
    { y: -0.310, rx: 0.050, rz: 0.056, zOffset: 0.024 },
    { y: -0.220, rx: 0.060, rz: 0.066, zOffset: 0.048 },
    { y: -0.100, rx: 0.070, rz: 0.076, zOffset: 0.020 },
    { y:  0.020, rx: 0.074, rz: 0.078, zOffset: -0.008 }
  ], { sides: 7, aoStrength: 0.16, aoGradient: 0.09 })

  const legWrap = sculptLoft([
    { y: -0.425, rx: 0.056, rz: 0.062, zOffset: -0.002 },
    { y: -0.340, rx: 0.064, rz: 0.070, zOffset: 0.016 },
    { y: -0.265, rx: 0.068, rz: 0.074, zOffset: 0.036 }
  ], { sides: 7, aoStrength: 0.16, aoGradient: 0.08 })

  const rawFoot = sculptLoft([
    { y: -0.500, rx: 0.068, rz: 0.116, zOffset: 0.046, frontFlat: 0.14 },
    { y: -0.474, rx: 0.070, rz: 0.118, zOffset: 0.048, frontFlat: 0.14 },
    { y: -0.440, rx: 0.062, rz: 0.092, zOffset: 0.026 },
    { y: -0.405, rx: 0.054, rz: 0.062, zOffset: 0.004 }
  ], { sides: 7 })
  const zonedFoot = bakeZoneColors(rawFoot, (_cx, cy) => (
    cy < -0.470 ? [0.72, 0.70, 0.72, 1] : WHITE
  ))
  const foot = bakeVertexAO(zonedFoot, { strength: 0.16, verticalGradient: 0.10 })

  cachedGoblinMeshes = {
    head,
    browRidge,
    nose,
    eyeSocket,
    eyeGlow,
    mouthSlit,
    fang,
    earBaseL: createEarBase(-1),
    earBaseR: createEarBase(1),
    neck,
    torso,
    chestStrap,
    strapBuckle,
    waistBand,
    loinFront,
    loinBack,
    armL: createGoblinArm(-1),
    armR: createGoblinArm(1),
    wristWrapL: createGoblinWristWrap(-1),
    wristWrapR: createGoblinWristWrap(1),
    handL: createGoblinHand(-1),
    handR: createGoblinHand(1),
    thumbL: createGoblinThumb(-1),
    thumbR: createGoblinThumb(1),
    legUpper,
    legWrap,
    foot
  }
  return cachedGoblinMeshes
}

// ---------------------------------------------------------------------------
// 3. Orc Brute Body Meshes
// ---------------------------------------------------------------------------

interface OrcBruteMeshes {
  readonly head: Mesh
  readonly underbiteJaw: Mesh
  readonly browSlab: Mesh
  readonly noseBridge: Mesh
  readonly eyeBlock: Mesh
  readonly eyeGlint: Mesh
  readonly mouthCrease: Mesh
  readonly tusk: Mesh
  readonly earL: Mesh
  readonly earR: Mesh
  readonly neck: Mesh
  readonly torso: Mesh
  readonly harnessStrap: Mesh
  readonly warBelt: Mesh
  readonly beltPlate: Mesh
  readonly pelvisFauld: Mesh
  readonly armL: Mesh
  readonly armR: Mesh
  readonly bracerWrapL: Mesh
  readonly bracerWrapR: Mesh
  readonly fistL: Mesh
  readonly fistR: Mesh
  readonly thumbL: Mesh
  readonly thumbR: Mesh
  readonly thigh: Mesh
  readonly kneePlate: Mesh
  readonly bootGreave: Mesh
  readonly bootFoot: Mesh
}

let cachedOrcBruteMeshes: OrcBruteMeshes | undefined

function getOrcBruteMeshes(): OrcBruteMeshes {
  if (cachedOrcBruteMeshes) return cachedOrcBruteMeshes

  // Heavy square-jawed hulking orc head
  const rawHead = sculptLoft([
    { y: 0.000, rx: 0.162, rz: 0.172, zOffset: 0.032, frontFlat: 0.14 },
    { y: 0.135, rx: 0.266, rz: 0.232, zOffset: 0.026, frontFlat: 0.10 },
    { y: 0.355, rx: 0.268, rz: 0.232, zOffset: 0.016, frontFlat: 0.10 },
    { y: 0.495, rx: 0.246, rz: 0.218, zOffset: 0.002, frontFlat: 0.08 },
    { y: 0.562, rx: 0.176, rz: 0.164, zOffset: -0.008 },
    { y: 0.588, rx: 0.102, rz: 0.096, zOffset: -0.012 }
  ], { sides: 8 })
  const zonedHead = bakeZoneColors(rawHead, (_cx, cy, _cz, _nx, ny) => {
    if (ny < -0.35 && cy < 0.14) return [0.78, 0.76, 0.75, 1]
    return WHITE
  })
  const head = bakeVertexAO(zonedHead, { strength: 0.16, verticalGradient: 0.09 })

  const underbiteJaw = sculptLoft([
    { y: 0.008, rx: 0.148, rz: 0.088, zOffset: 0.144, frontFlat: 0.18 },
    { y: 0.072, rx: 0.194, rz: 0.108, zOffset: 0.146, frontFlat: 0.16 },
    { y: 0.132, rx: 0.182, rz: 0.098, zOffset: 0.138, frontFlat: 0.16 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  // Heavy chiseled brow ridge overhanging fierce eyes (fused cleanly into skull temples)
  const browSlab = sculptLoft([
    { y: 0.340, rx: 0.204, rz: 0.052, zOffset: 0.202, frontFlat: 0.14 },
    { y: 0.378, rx: 0.214, rz: 0.062, zOffset: 0.208, frontFlat: 0.14 },
    { y: 0.412, rx: 0.194, rz: 0.046, zOffset: 0.196, frontFlat: 0.10 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  const noseBridge = sculptLoft([
    { y: 0.205, rx: 0.054, rz: 0.044, zOffset: 0.232, frontFlat: 0.16 },
    { y: 0.250, rx: 0.044, rz: 0.036, zOffset: 0.228 },
    { y: 0.298, rx: 0.032, rz: 0.024, zOffset: 0.218 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const eyeBlock = sculptLoft([
    { y: -0.024, rx: 0.046, rz: 0.018 },
    { y:  0.000, rx: 0.050, rz: 0.020 },
    { y:  0.024, rx: 0.044, rz: 0.016 }
  ], { sides: 6 })

  const eyeGlint = sculptLoft([
    { y: -0.011, rx: 0.022, rz: 0.012 },
    { y:  0.011, rx: 0.022, rz: 0.012 }
  ], { sides: 6 })

  const mouthCrease = sculptLoft([
    { y: -0.018, rx: 0.132, rz: 0.022 },
    { y:  0.018, rx: 0.128, rz: 0.020 }
  ], { sides: 6 })

  // Bold curved upturned ivory orc tusks
  const tusk = makeSpikeMesh(0.162, 0.034, 0.030, 6, 0.016, 0.038, 0.12)

  const createOrcEar = (side: -1 | 1): Mesh => sculptLoft([
    { y: 0.235, rx: 0.026, rz: 0.038, xOffset: side * 0.258, zOffset: -0.004 },
    { y: 0.285, rx: 0.052, rz: 0.050, xOffset: side * 0.292, zOffset: -0.018 },
    { y: 0.338, rx: 0.028, rz: 0.034, xOffset: side * 0.312, zOffset: -0.032 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  // Thick bull neck merging into massive trapezius ridge
  const neck = sculptLoft([
    { y: 0.430, rx: 0.188, rz: 0.154, zOffset: -0.006 },
    { y: 0.495, rx: 0.148, rz: 0.132, zOffset: 0.004 },
    { y: 0.545, rx: 0.126, rz: 0.118, zOffset: 0.010 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  // Broad-shouldered hulking barrel torso
  const torso = sculptLoft([
    { y: 0.095, rx: 0.228, rz: 0.162, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.245, rx: 0.292, rz: 0.194, zOffset: 0.016, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.405, rx: 0.336, rz: 0.204, zOffset: 0.012, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.478, rx: 0.278, rz: 0.178, zOffset: -0.004 },
    { y: 0.512, rx: 0.192, rz: 0.144, zOffset: -0.008 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const harnessStrap = sculptLoft([
    { y: -0.194, rx: 0.044, rz: 0.188 },
    { y:  0.000, rx: 0.054, rz: 0.204 },
    { y:  0.194, rx: 0.044, rz: 0.186 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const warBelt = sculptLoft([
    { y: 0.068, rx: 0.252, rz: 0.182, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.132, rx: 0.258, rz: 0.186, frontFlat: 0.10, backFlat: 0.08 },
    { y: 0.184, rx: 0.248, rz: 0.180, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const beltPlate = sculptLoft([
    { y: 0.058, rx: 0.064, rz: 0.032, zOffset: 0.176 },
    { y: 0.125, rx: 0.086, rz: 0.038, zOffset: 0.182 },
    { y: 0.192, rx: 0.064, rz: 0.032, zOffset: 0.176 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const pelvisFauld = sculptLoft([
    { y: -0.068, rx: 0.218, rz: 0.158, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.025, rx: 0.244, rz: 0.174, frontFlat: 0.10, backFlat: 0.08 },
    { y:  0.095, rx: 0.236, rz: 0.168, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  // Thick muscular faceted brute arms
  const createOrcArm = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.348, rx: 0.072, rz: 0.076, xOffset: side * 0.036, zOffset: 0.014 },
    { y: -0.230, rx: 0.098, rz: 0.102, xOffset: side * 0.032, zOffset: 0.008 },
    { y: -0.140, rx: 0.086, rz: 0.090, xOffset: side * 0.024, zOffset: 0.002 },
    { y: -0.025, rx: 0.114, rz: 0.116, xOffset: side * 0.012, zOffset: 0.002 },
    { y:  0.052, rx: 0.106, rz: 0.108, xOffset: -side * 0.026, zOffset: 0.002 },
    { y:  0.095, rx: 0.066, rz: 0.074, xOffset: -side * 0.068, zOffset: 0.002 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const createOrcBracer = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.344, rx: 0.084, rz: 0.088, xOffset: side * 0.036, zOffset: 0.014 },
    { y: -0.268, rx: 0.102, rz: 0.106, xOffset: side * 0.034, zOffset: 0.010 },
    { y: -0.214, rx: 0.106, rz: 0.110, xOffset: side * 0.032, zOffset: 0.008 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  const createOrcFist = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.506, rx: 0.044, rz: 0.054, xOffset: side * 0.030, zOffset: 0.034 },
    { y: -0.460, rx: 0.068, rz: 0.084, xOffset: side * 0.036, zOffset: 0.036 },
    { y: -0.398, rx: 0.082, rz: 0.096, xOffset: side * 0.038, zOffset: 0.028, frontFlat: 0.10 },
    { y: -0.340, rx: 0.072, rz: 0.076, xOffset: side * 0.036, zOffset: 0.016 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  const createOrcThumb = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.448, rx: 0.022, rz: 0.028, xOffset: -side * 0.006, zOffset: 0.082 },
    { y: -0.405, rx: 0.032, rz: 0.036, xOffset: side * 0.008, zOffset: 0.068 },
    { y: -0.365, rx: 0.030, rz: 0.032, xOffset: side * 0.024, zOffset: 0.050 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  // Heavy thighs + iron-plated armored war boots grounded at y = -0.500
  const thigh = sculptLoft([
    { y: -0.290, rx: 0.082, rz: 0.088 },
    { y: -0.170, rx: 0.096, rz: 0.102 },
    { y: -0.055, rx: 0.108, rz: 0.114 },
    { y:  0.030, rx: 0.110, rz: 0.114 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const kneePlate = sculptLoft([
    { y: -0.305, rx: 0.062, rz: 0.032, zOffset: 0.092 },
    { y: -0.255, rx: 0.078, rz: 0.042, zOffset: 0.100 },
    { y: -0.212, rx: 0.056, rz: 0.028, zOffset: 0.090 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const bootGreave = sculptLoft([
    { y: -0.408, rx: 0.092, rz: 0.098 },
    { y: -0.335, rx: 0.104, rz: 0.110 },
    { y: -0.268, rx: 0.112, rz: 0.118 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const rawBootFoot = sculptLoft([
    { y: -0.500, rx: 0.098, rz: 0.148, zOffset: 0.048, frontFlat: 0.18, backFlat: 0.10 },
    { y: -0.468, rx: 0.104, rz: 0.152, zOffset: 0.050, frontFlat: 0.18, backFlat: 0.10 },
    { y: -0.428, rx: 0.096, rz: 0.128, zOffset: 0.034, frontFlat: 0.14 },
    { y: -0.392, rx: 0.088, rz: 0.096, zOffset: 0.008 }
  ], { sides: 8 })
  const zonedBootFoot = bakeZoneColors(rawBootFoot, (_cx, cy) => (
    cy < -0.466 ? [0.68, 0.66, 0.70, 1] : WHITE
  ))
  const bootFoot = bakeVertexAO(zonedBootFoot, { strength: 0.16, verticalGradient: 0.10 })

  cachedOrcBruteMeshes = {
    head,
    underbiteJaw,
    browSlab,
    noseBridge,
    eyeBlock,
    eyeGlint,
    mouthCrease,
    tusk,
    earL: createOrcEar(-1),
    earR: createOrcEar(1),
    neck,
    torso,
    harnessStrap,
    warBelt,
    beltPlate,
    pelvisFauld,
    armL: createOrcArm(-1),
    armR: createOrcArm(1),
    bracerWrapL: createOrcBracer(-1),
    bracerWrapR: createOrcBracer(1),
    fistL: createOrcFist(-1),
    fistR: createOrcFist(1),
    thumbL: createOrcThumb(-1),
    thumbR: createOrcThumb(1),
    thigh,
    kneePlate,
    bootGreave,
    bootFoot
  }
  return cachedOrcBruteMeshes
}

// ---------------------------------------------------------------------------
// 4. Frost Golem Body Meshes
// ---------------------------------------------------------------------------

interface FrostGolemMeshes {
  readonly head: Mesh
  readonly visorRecess: Mesh
  readonly eyeShard: Mesh
  readonly crownShardTall: Mesh
  readonly crownShardSide: Mesh
  readonly torsoStone: Mesh
  readonly chestRecess: Mesh
  readonly coreOuter: Mesh
  readonly coreInner: Mesh
  readonly chestClamp: Mesh
  readonly shoulderCrystalMain: Mesh
  readonly shoulderCrystalSub: Mesh
  readonly backCrystal: Mesh
  readonly pelvisStone: Mesh
  readonly armUpperL: Mesh
  readonly armUpperR: Mesh
  readonly forearmL: Mesh
  readonly forearmR: Mesh
  readonly elbowCrystal: Mesh
  readonly pillarLeg: Mesh
  readonly kneeCrystal: Mesh
  readonly pillarFoot: Mesh
}

let cachedFrostGolemMeshes: FrostGolemMeshes | undefined

function getFrostGolemMeshes(): FrostGolemMeshes {
  if (cachedFrostGolemMeshes) return cachedFrostGolemMeshes

  // Monolithic faceted slate colossus head
  const rawHead = sculptLoft([
    { y: 0.025, rx: 0.156, rz: 0.168, zOffset: 0.018, frontFlat: 0.18 },
    { y: 0.175, rx: 0.244, rz: 0.222, zOffset: 0.014, frontFlat: 0.14 },
    { y: 0.375, rx: 0.264, rz: 0.236, zOffset: 0.010, frontFlat: 0.14 },
    { y: 0.510, rx: 0.222, rz: 0.204, zOffset: 0.000 },
    { y: 0.585, rx: 0.132, rz: 0.128, zOffset: -0.010 }
  ], { sides: 6 })
  const zonedHead = bakeZoneColors(rawHead, (_cx, cy, _cz, _nx, ny) => {
    if (ny > 0.55 && cy > 0.48) return [1.10, 1.15, 1.22, 1]
    if (ny < -0.4) return [0.76, 0.78, 0.84, 1]
    return WHITE
  })
  const head = bakeVertexAO(zonedHead, { strength: 0.16, verticalGradient: 0.08 })

  const visorRecess = sculptLoft([
    { y: 0.270, rx: 0.194, rz: 0.044, zOffset: 0.198, frontFlat: 0.18 },
    { y: 0.312, rx: 0.204, rz: 0.048, zOffset: 0.202, frontFlat: 0.18 },
    { y: 0.348, rx: 0.192, rz: 0.042, zOffset: 0.196, frontFlat: 0.18 }
  ], { sides: 6 })

  const eyeShard = sculptLoft([
    { y: -0.020, rx: 0.048, rz: 0.016 },
    { y:  0.004, rx: 0.056, rz: 0.020 },
    { y:  0.022, rx: 0.042, rz: 0.014 }
  ], { sides: 5 })

  const crownShardTall = makeSpikeMesh(0.220, 0.054, 0.052, 5, 0.008, -0.024, 0.12)
  const crownShardSide = makeSpikeMesh(0.165, 0.046, 0.042, 5, 0.022, -0.018, 0.12)

  // Massive jagged faceted slate torso
  const rawTorso = sculptLoft([
    { y: 0.068, rx: 0.214, rz: 0.168, frontFlat: 0.14, backFlat: 0.12 },
    { y: 0.205, rx: 0.286, rz: 0.210, zOffset: 0.014, frontFlat: 0.14, backFlat: 0.12 },
    { y: 0.385, rx: 0.358, rz: 0.236, zOffset: 0.012, frontFlat: 0.14, backFlat: 0.12 },
    { y: 0.488, rx: 0.312, rz: 0.208, zOffset: 0.000 },
    { y: 0.535, rx: 0.216, rz: 0.166, zOffset: -0.008 }
  ], { sides: 8 })
  const zonedTorso = bakeZoneColors(rawTorso, (_cx, cy, _cz, _nx, ny) => {
    if (ny > 0.52 && cy > 0.42) return [1.10, 1.16, 1.24, 1]
    if (cy < 0.16) return [0.84, 0.86, 0.90, 1]
    return WHITE
  })
  const torsoStone = bakeVertexAO(zonedTorso, { strength: 0.16, verticalGradient: 0.10 })

  const chestRecess = sculptLoft([
    { y: 0.185, rx: 0.072, rz: 0.036, zOffset: 0.194 },
    { y: 0.295, rx: 0.132, rz: 0.046, zOffset: 0.206 },
    { y: 0.405, rx: 0.088, rz: 0.036, zOffset: 0.196 }
  ], { sides: 6 })

  // Multi-faceted glowing frost diamond core
  const coreOuter = sculptLoft([
    { y: 0.196, rx: 0.016, rz: 0.016, zOffset: 0.224 },
    { y: 0.295, rx: 0.098, rz: 0.056, zOffset: 0.224 },
    { y: 0.394, rx: 0.016, rz: 0.016, zOffset: 0.224 }
  ], { sides: 6 })

  const coreInner = sculptLoft([
    { y: 0.236, rx: 0.012, rz: 0.012, zOffset: 0.254 },
    { y: 0.295, rx: 0.054, rz: 0.038, zOffset: 0.256 },
    { y: 0.354, rx: 0.012, rz: 0.012, zOffset: 0.254 }
  ], { sides: 6 })

  const chestClamp = sculptLoft([
    { y: -0.045, rx: 0.032, rz: 0.034 },
    { y:  0.000, rx: 0.040, rz: 0.040 },
    { y:  0.045, rx: 0.026, rz: 0.028 }
  ], { sides: 5, aoStrength: 0.14, aoGradient: 0.06 })

  const shoulderCrystalMain = makeSpikeMesh(0.330, 0.086, 0.078, 5, 0.028, -0.020, 0.10)
  const shoulderCrystalSub = makeSpikeMesh(0.235, 0.062, 0.056, 5, 0.020, -0.016, 0.10)
  const backCrystal = makeSpikeMesh(0.260, 0.066, 0.060, 5, 0.000, -0.038, 0.10)

  const pelvisStone = sculptLoft([
    { y: -0.052, rx: 0.188, rz: 0.144, frontFlat: 0.16, backFlat: 0.14 },
    { y:  0.026, rx: 0.242, rz: 0.178, frontFlat: 0.14, backFlat: 0.12 },
    { y:  0.098, rx: 0.224, rz: 0.170, frontFlat: 0.14, backFlat: 0.12 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  // Massive monolithic slate arms & crushing ice-edged gauntlets
  const createGolemUpperArm = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.195, rx: 0.098, rz: 0.104, xOffset: side * 0.036, zOffset: 0.004 },
    { y: -0.055, rx: 0.128, rz: 0.134, xOffset: side * 0.024, zOffset: 0.002 },
    { y:  0.058, rx: 0.124, rz: 0.130, xOffset: -side * 0.018, zOffset: 0.002 },
    { y:  0.115, rx: 0.082, rz: 0.088, xOffset: -side * 0.058, zOffset: 0.000 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  const createGolemForearm = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.512, rx: 0.086, rz: 0.098, xOffset: side * 0.044, zOffset: 0.036, frontFlat: 0.18 },
    { y: -0.435, rx: 0.112, rz: 0.124, xOffset: side * 0.046, zOffset: 0.032, frontFlat: 0.16 },
    { y: -0.315, rx: 0.118, rz: 0.126, xOffset: side * 0.044, zOffset: 0.018 },
    { y: -0.185, rx: 0.096, rz: 0.102, xOffset: side * 0.036, zOffset: 0.004 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  const elbowCrystal = makeSpikeMesh(0.165, 0.046, 0.044, 5, 0.012, -0.020, 0.10)

  // Heavy monolithic stone pillar legs grounded squarely at y = -0.500
  const pillarLeg = sculptLoft([
    { y: -0.415, rx: 0.106, rz: 0.112 },
    { y: -0.265, rx: 0.122, rz: 0.128 },
    { y: -0.105, rx: 0.118, rz: 0.124 },
    { y:  0.032, rx: 0.114, rz: 0.118 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  const kneeCrystal = makeSpikeMesh(0.125, 0.052, 0.042, 5, 0, 0.024, 0.10)

  const rawPillarFoot = sculptLoft([
    { y: -0.500, rx: 0.120, rz: 0.164, zOffset: 0.044, frontFlat: 0.20, backFlat: 0.12 },
    { y: -0.452, rx: 0.126, rz: 0.168, zOffset: 0.046, frontFlat: 0.18, backFlat: 0.12 },
    { y: -0.398, rx: 0.110, rz: 0.124, zOffset: 0.014 }
  ], { sides: 6 })
  const zonedPillarFoot = bakeZoneColors(rawPillarFoot, (_cx, cy) => (
    cy < -0.464 ? [0.70, 0.74, 0.82, 1] : WHITE
  ))
  const pillarFoot = bakeVertexAO(zonedPillarFoot, { strength: 0.16, verticalGradient: 0.10 })

  cachedFrostGolemMeshes = {
    head,
    visorRecess,
    eyeShard,
    crownShardTall,
    crownShardSide,
    torsoStone,
    chestRecess,
    coreOuter,
    coreInner,
    chestClamp,
    shoulderCrystalMain,
    shoulderCrystalSub,
    backCrystal,
    pelvisStone,
    armUpperL: createGolemUpperArm(-1),
    armUpperR: createGolemUpperArm(1),
    forearmL: createGolemForearm(-1),
    forearmR: createGolemForearm(1),
    elbowCrystal,
    pillarLeg,
    kneeCrystal,
    pillarFoot
  }
  return cachedFrostGolemMeshes
}

// ---------------------------------------------------------------------------
// 5. Ears, Brows, Hair, Beards & Face Accent Meshes
// ---------------------------------------------------------------------------

interface HeadAccessoryMeshes {
  // Ears (socket anchor [0, 0.265, -0.008] on head)
  readonly elfEarBlade: Mesh
  readonly goblinEarBlade: Mesh

  // Brows (socket anchor [0, 0.365, 0.226] on head)
  readonly browFierce: Mesh
  readonly browNoble: Mesh
  readonly browArched: Mesh

  // Shared hair base shells (socket anchor [0, 0.28, 0] on head)
  readonly hairCapStandard: Mesh
  readonly hairNapeShort: Mesh

  // hair_ponytail
  readonly ponytailBand: Mesh
  readonly ponytailBangSweep: Mesh
  readonly ponytailFrontLockR: Mesh
  readonly ponytailSideTuckL: Mesh
  readonly ponytailTieRing: Mesh
  readonly ponytailTail: Mesh

  // hair_mage_long
  readonly mageCrown: Mesh
  readonly mageSideLockL: Mesh
  readonly mageSideLockR: Mesh
  readonly mageBackFlow: Mesh
  readonly mageFrontPartL: Mesh
  readonly mageFrontPartR: Mesh

  // hair_noble_bob
  readonly bobCrown: Mesh
  readonly bobBangSweep: Mesh
  readonly bobSideL: Mesh
  readonly bobSideR: Mesh
  readonly bobBack: Mesh

  // hair_rogue_spiky
  readonly rogueBangSpike: Mesh
  readonly rogueSpikeLong: Mesh
  readonly rogueSpikeMed: Mesh
  readonly rogueSideburnL: Mesh
  readonly rogueSideburnR: Mesh

  // hair_champion_mane
  readonly maneCrownSweep: Mesh
  readonly maneCrestCenter: Mesh
  readonly maneWingL: Mesh
  readonly maneWingR: Mesh
  readonly maneBackLocks: Mesh
  readonly maneFrontSweep: Mesh

  // Beards (socket anchor [0, 0.135, 0.205] on head)
  readonly beardBraidedBody: Mesh
  readonly beardBraidedMustache: Mesh
  readonly beardBraidedBraid: Mesh
  readonly beardBraidedClasp: Mesh
  readonly beardBraidedTip: Mesh
  readonly beardSageBody: Mesh
  readonly beardSageMustache: Mesh
  readonly beardSageSideL: Mesh
  readonly beardSageSideR: Mesh
  readonly beardGoateeChin: Mesh
  readonly beardGoateeMustache: Mesh

  // Face accents (socket anchor [0, 0.30, 0.220] on head)
  readonly rogueMaskWrap: Mesh
  readonly rogueMaskNoseFold: Mesh
  readonly rogueMaskTail: Mesh
  readonly warpaintCheekBand: Mesh
  readonly warpaintTempleStripe: Mesh
  readonly scarMainGash: Mesh
  readonly scarSideNotch: Mesh
}

let cachedAccessoryMeshes: HeadAccessoryMeshes | undefined

function getAccessoryMeshes(): HeadAccessoryMeshes {
  if (cachedAccessoryMeshes) return cachedAccessoryMeshes

  // --- Ears ---
  // Sculpted along +Y from root y = 0 to tip y = L, then mounted with left/right outward roll & sweep!
  const rawElfEar = sculptLoft([
    { y: 0.000, rx: 0.032, rz: 0.044 },
    { y: 0.055, rx: 0.028, rz: 0.042, zOffset: -0.008 },
    { y: 0.125, rx: 0.020, rz: 0.030, zOffset: -0.024 },
    { y: 0.188, rx: 0.006, rz: 0.009, zOffset: -0.042 }
  ], { sides: 6 })
  const zonedElfEar = bakeZoneColors(rawElfEar, (_cx, cy, cz, _nx, _ny, nz) => {
    if (nz > 0.35 && cz > 0.005 && cy > 0.02 && cy < 0.12) return [0.88, 0.82, 0.80, 1]
    return WHITE
  })
  const elfEarBlade = bakeVertexAO(zonedElfEar, { strength: 0.14, verticalGradient: 0.08 })

  const rawGoblinEar = sculptLoft([
    { y: 0.000, rx: 0.038, rz: 0.062 },
    { y: 0.075, rx: 0.036, rz: 0.076, zOffset: -0.008 },
    { y: 0.175, rx: 0.025, rz: 0.054, zOffset: -0.026 },
    { y: 0.278, rx: 0.007, rz: 0.011, zOffset: -0.050 }
  ], { sides: 6 })
  const zonedGoblinEar = bakeZoneColors(rawGoblinEar, (_cx, cy, cz, _nx, _ny, nz) => {
    if (nz > 0.35 && cz > 0.005 && cy > 0.02 && cy < 0.16) return [0.80, 0.78, 0.74, 1]
    return WHITE
  })
  const goblinEarBlade = bakeVertexAO(zonedGoblinEar, { strength: 0.15, verticalGradient: 0.08 })

  // --- Brows ---
  const browFierce = sculptLoft([
    { y: -0.026, rx: 0.066, rz: 0.026, frontFlat: 0.14 },
    { y:  0.002, rx: 0.072, rz: 0.032, frontFlat: 0.14 },
    { y:  0.028, rx: 0.064, rz: 0.024 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const browNoble = sculptLoft([
    { y: -0.018, rx: 0.058, rz: 0.020, frontFlat: 0.12 },
    { y:  0.002, rx: 0.062, rz: 0.023, frontFlat: 0.12 },
    { y:  0.018, rx: 0.054, rz: 0.017 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const browArched = sculptLoft([
    { y: -0.013, rx: 0.056, rz: 0.018, frontFlat: 0.12 },
    { y:  0.002, rx: 0.060, rz: 0.021, frontFlat: 0.12 },
    { y:  0.014, rx: 0.048, rz: 0.015 }
  ], { sides: 6, aoStrength: 0.10, aoGradient: 0.05 })

  // --- Shared Hair Skull Cap & Short Nape ---
  // Head spans hair-local y = -0.28..+0.33, rx = 0.248 at temples (y = +0.095), brows at y = +0.085
  const hairCapStandard = sculptLoft([
    { y: 0.135, rx: 0.266, rz: 0.244, zOffset: -0.006, frontFlat: 0.09, backFlat: 0.06 },
    { y: 0.232, rx: 0.274, rz: 0.250, zOffset: -0.010, frontFlat: 0.08, backFlat: 0.06 },
    { y: 0.312, rx: 0.254, rz: 0.232, zOffset: -0.012, frontFlat: 0.06 },
    { y: 0.368, rx: 0.184, rz: 0.172, zOffset: -0.016 },
    { y: 0.394, rx: 0.104, rz: 0.098, zOffset: -0.018 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const hairNapeShort = sculptLoft([
    { y: -0.168, rx: 0.156, rz: 0.076, zOffset: -0.128, backFlat: 0.08 },
    { y: -0.042, rx: 0.228, rz: 0.122, zOffset: -0.118, backFlat: 0.06 },
    { y:  0.085, rx: 0.256, rz: 0.146, zOffset: -0.106, backFlat: 0.06 },
    { y:  0.195, rx: 0.266, rz: 0.156, zOffset: -0.094 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  // --- hair_ponytail (Lyra! Faceted cap + crisp headband + sweeping bangs below band + cheek lock + high ponytail) ---
  const ponytailBand = sculptLoft([
    { y: 0.132, rx: 0.278, rz: 0.256, zOffset: -0.005, frontFlat: 0.10, backFlat: 0.06 },
    { y: 0.174, rx: 0.284, rz: 0.260, zOffset: -0.006, frontFlat: 0.10, backFlat: 0.06 },
    { y: 0.204, rx: 0.278, rz: 0.255, zOffset: -0.007, frontFlat: 0.10, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.08 })

  const ponytailBangSweep = sculptLoft([
    { y: 0.094, rx: 0.122, rz: 0.022, xOffset: 0.048, zOffset: 0.214, frontFlat: 0.14 },
    { y: 0.126, rx: 0.194, rz: 0.028, xOffset: 0.018, zOffset: 0.212, frontFlat: 0.12 },
    { y: 0.154, rx: 0.206, rz: 0.028, xOffset: 0.004, zOffset: 0.206, frontFlat: 0.12 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  // Cheek-framing sculpted side lock draping cleanly outside right cheek (+X)
  const ponytailFrontLockR = sculptLoft([
    { y: -0.220, rx: 0.016, rz: 0.020, xOffset: 0.236, zOffset: 0.144 },
    { y: -0.095, rx: 0.036, rz: 0.044, xOffset: 0.248, zOffset: 0.136 },
    { y:  0.045, rx: 0.044, rz: 0.056, xOffset: 0.256, zOffset: 0.116 },
    { y:  0.165, rx: 0.046, rz: 0.064, xOffset: 0.252, zOffset: 0.072 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const ponytailSideTuckL = sculptLoft([
    { y: -0.095, rx: 0.026, rz: 0.036, xOffset: -0.240, zOffset: 0.068 },
    { y:  0.045, rx: 0.042, rz: 0.062, xOffset: -0.252, zOffset: 0.048 },
    { y:  0.165, rx: 0.046, rz: 0.072, xOffset: -0.254, zOffset: 0.024 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const ponytailTieRing = sculptLoft([
    { y: 0.248, rx: 0.064, rz: 0.064, zOffset: -0.228 },
    { y: 0.290, rx: 0.072, rz: 0.072, zOffset: -0.244 },
    { y: 0.326, rx: 0.062, rz: 0.062, zOffset: -0.232 }
  ], { sides: 7, aoStrength: 0.12, aoGradient: 0.06 })

  // Sweeping high faceted ponytail arching out from tie and cascading down back
  const rawPonytail = sculptLoft([
    { y: -0.285, rx: 0.028, rz: 0.028, zOffset: -0.354 },
    { y: -0.145, rx: 0.078, rz: 0.074, zOffset: -0.372 },
    { y:  0.045, rx: 0.114, rz: 0.106, zOffset: -0.380 },
    { y:  0.225, rx: 0.126, rz: 0.118, zOffset: -0.358 },
    { y:  0.348, rx: 0.112, rz: 0.108, zOffset: -0.296 },
    { y:  0.398, rx: 0.084, rz: 0.088, zOffset: -0.218 },
    { y:  0.355, rx: 0.058, rz: 0.066, zOffset: -0.172 }
  ], { sides: 7 })
  const zonedPonytail = bakeZoneColors(rawPonytail, (_cx, cy) => (
    cy < -0.05 ? [0.88, 0.86, 0.88, 1] : WHITE
  ))
  const ponytailTail = bakeVertexAO(zonedPonytail, { strength: 0.16, verticalGradient: 0.10 })

  // --- hair_mage_long (Parted crown + flowing side & back locks framing face cleanly) ---
  const mageCrown = sculptLoft([
    { y: 0.135, rx: 0.270, rz: 0.246, zOffset: -0.008, frontFlat: 0.08, backFlat: 0.06 },
    { y: 0.238, rx: 0.280, rz: 0.256, zOffset: -0.012, frontFlat: 0.06, backFlat: 0.06 },
    { y: 0.324, rx: 0.258, rz: 0.238, zOffset: -0.014 },
    { y: 0.382, rx: 0.186, rz: 0.176, zOffset: -0.018 },
    { y: 0.408, rx: 0.098, rz: 0.096, zOffset: -0.020 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const createMageSideLock = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.325, rx: 0.034, rz: 0.072, xOffset: side * 0.264, zOffset: 0.034 },
    { y: -0.180, rx: 0.054, rz: 0.112, xOffset: side * 0.268, zOffset: 0.020 },
    { y: -0.015, rx: 0.060, rz: 0.126, xOffset: side * 0.264, zOffset: 0.012 },
    { y:  0.140, rx: 0.058, rz: 0.126, xOffset: side * 0.258, zOffset: 0.004 },
    { y:  0.245, rx: 0.048, rz: 0.106, xOffset: side * 0.244, zOffset: -0.006 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.10 })

  const createMageFrontPart = (side: -1 | 1): Mesh => sculptLoft([
    { y: 0.096, rx: 0.076, rz: 0.028, xOffset: side * 0.168, zOffset: 0.194 },
    { y: 0.172, rx: 0.118, rz: 0.036, xOffset: side * 0.124, zOffset: 0.204 },
    { y: 0.258, rx: 0.114, rz: 0.036, xOffset: side * 0.088, zOffset: 0.188 },
    { y: 0.312, rx: 0.078, rz: 0.030, xOffset: side * 0.052, zOffset: 0.156 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const rawMageBack = sculptLoft([
    { y: -0.365, rx: 0.236, rz: 0.078, zOffset: -0.212, backFlat: 0.10 },
    { y: -0.215, rx: 0.264, rz: 0.106, zOffset: -0.186, backFlat: 0.08 },
    { y: -0.045, rx: 0.272, rz: 0.136, zOffset: -0.146, backFlat: 0.06 },
    { y:  0.115, rx: 0.276, rz: 0.158, zOffset: -0.114, backFlat: 0.06 },
    { y:  0.230, rx: 0.274, rz: 0.164, zOffset: -0.094 }
  ], { sides: 8 })
  const zonedMageBack = bakeZoneColors(rawMageBack, (_cx, cy) => (
    cy < -0.12 ? [0.88, 0.86, 0.90, 1] : WHITE
  ))
  const mageBackFlow = bakeVertexAO(zonedMageBack, { strength: 0.16, verticalGradient: 0.10 })

  // --- hair_noble_bob (Layered golden bob framing jaw cleanly) ---
  const bobCrown = sculptLoft([
    { y: 0.132, rx: 0.274, rz: 0.248, zOffset: -0.008, frontFlat: 0.08, backFlat: 0.06 },
    { y: 0.232, rx: 0.284, rz: 0.258, zOffset: -0.010, frontFlat: 0.06, backFlat: 0.06 },
    { y: 0.318, rx: 0.262, rz: 0.240, zOffset: -0.012 },
    { y: 0.376, rx: 0.188, rz: 0.178, zOffset: -0.016 },
    { y: 0.402, rx: 0.104, rz: 0.098, zOffset: -0.018 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const bobBangSweep = sculptLoft([
    { y: 0.106, rx: 0.144, rz: 0.022, xOffset: -0.026, zOffset: 0.204, frontFlat: 0.14 },
    { y: 0.158, rx: 0.218, rz: 0.030, xOffset: -0.008, zOffset: 0.202, frontFlat: 0.12 },
    { y: 0.228, rx: 0.226, rz: 0.032, xOffset: 0.000, zOffset: 0.190, frontFlat: 0.10 },
    { y: 0.296, rx: 0.158, rz: 0.028, xOffset: 0.000, zOffset: 0.160 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const createBobSide = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.235, rx: 0.034, rz: 0.058, xOffset: side * 0.232, zOffset: 0.044 },
    { y: -0.145, rx: 0.062, rz: 0.098, xOffset: side * 0.266, zOffset: 0.036 },
    { y: -0.015, rx: 0.068, rz: 0.114, xOffset: side * 0.276, zOffset: 0.024 },
    { y:  0.125, rx: 0.064, rz: 0.112, xOffset: side * 0.270, zOffset: 0.010 },
    { y:  0.225, rx: 0.052, rz: 0.094, xOffset: side * 0.256, zOffset: -0.002 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.09 })

  const bobBack = sculptLoft([
    { y: -0.230, rx: 0.208, rz: 0.082, zOffset: -0.152, backFlat: 0.08 },
    { y: -0.130, rx: 0.262, rz: 0.124, zOffset: -0.148, backFlat: 0.06 },
    { y:  0.015, rx: 0.278, rz: 0.148, zOffset: -0.126, backFlat: 0.06 },
    { y:  0.155, rx: 0.280, rz: 0.162, zOffset: -0.102 },
    { y:  0.235, rx: 0.274, rz: 0.164, zOffset: -0.092 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  // --- hair_rogue_spiky (Swept angular dark locks) ---
  const rogueBangSpike = makeSpikeMesh(0.185, 0.058, 0.034, 5, 0.026, 0.022, 0.14)
  const rogueSpikeLong = makeSpikeMesh(0.245, 0.078, 0.072, 5, 0.008, -0.048, 0.14)
  const rogueSpikeMed = makeSpikeMesh(0.190, 0.064, 0.060, 5, 0.014, -0.036, 0.14)

  const createRogueSideburn = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.132, rx: 0.016, rz: 0.022, xOffset: side * 0.232, zOffset: 0.076 },
    { y: -0.015, rx: 0.038, rz: 0.058, xOffset: side * 0.252, zOffset: 0.048 },
    { y:  0.125, rx: 0.048, rz: 0.086, xOffset: side * 0.260, zOffset: 0.022 },
    { y:  0.220, rx: 0.044, rz: 0.084, xOffset: side * 0.252, zOffset: 0.004 }
  ], { sides: 5, aoStrength: 0.15, aoGradient: 0.08 })

  // --- hair_champion_mane (Swept heroic thick locks) ---
  const maneCrownSweep = sculptLoft([
    { y: 0.145, rx: 0.276, rz: 0.252, zOffset: -0.012, frontFlat: 0.08, backFlat: 0.06 },
    { y: 0.255, rx: 0.288, rz: 0.264, zOffset: -0.016, frontFlat: 0.06 },
    { y: 0.352, rx: 0.256, rz: 0.244, zOffset: -0.024 },
    { y: 0.422, rx: 0.172, rz: 0.184, zOffset: -0.036 },
    { y: 0.456, rx: 0.092, rz: 0.112, zOffset: -0.048 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const maneCrestCenter = sculptLoft([
    { y: 0.275, rx: 0.132, rz: 0.215, zOffset: 0.006 },
    { y: 0.378, rx: 0.118, rz: 0.212, zOffset: -0.014 },
    { y: 0.468, rx: 0.082, rz: 0.168, zOffset: -0.044 },
    { y: 0.506, rx: 0.036, rz: 0.092, zOffset: -0.072 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const createManeWing = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.145, rx: 0.028, rz: 0.056, xOffset: side * 0.244, zOffset: -0.048 },
    { y: -0.015, rx: 0.052, rz: 0.096, xOffset: side * 0.264, zOffset: -0.024 },
    { y:  0.125, rx: 0.058, rz: 0.112, xOffset: side * 0.270, zOffset: -0.006 },
    { y:  0.245, rx: 0.050, rz: 0.098, xOffset: side * 0.256, zOffset: 0.000 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const maneBackLocks = sculptLoft([
    { y: -0.265, rx: 0.205, rz: 0.076, zOffset: -0.194, backFlat: 0.08 },
    { y: -0.135, rx: 0.262, rz: 0.124, zOffset: -0.172, backFlat: 0.06 },
    { y:  0.025, rx: 0.284, rz: 0.154, zOffset: -0.140, backFlat: 0.06 },
    { y:  0.185, rx: 0.286, rz: 0.168, zOffset: -0.110 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const maneFrontSweep = sculptLoft([
    { y: 0.148, rx: 0.178, rz: 0.026, xOffset: 0.016, zOffset: 0.204, frontFlat: 0.12 },
    { y: 0.222, rx: 0.214, rz: 0.036, xOffset: 0.006, zOffset: 0.198, frontFlat: 0.10 },
    { y: 0.308, rx: 0.184, rz: 0.042, xOffset: 0.000, zOffset: 0.170 },
    { y: 0.376, rx: 0.132, rz: 0.038, xOffset: 0.000, zOffset: 0.118 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  // --- Beards (socket anchor [0, 0.135, 0.205] on head; chin bottom y = -0.135, jaw sides x = +-0.232) ---
  // Note: z = -0.205 is head center! Wrapping back to zOffset = -0.095 hugs the lower jaw tightly from every angle!
  const rawBraidedBody = sculptLoft([
    { y: -0.215, rx: 0.088, rz: 0.056, zOffset: -0.012, frontFlat: 0.14 },
    { y: -0.125, rx: 0.182, rz: 0.108, zOffset: -0.046, frontFlat: 0.10 },
    { y: -0.030, rx: 0.246, rz: 0.148, zOffset: -0.082, frontFlat: 0.08 },
    { y:  0.048, rx: 0.252, rz: 0.144, zOffset: -0.090, frontFlat: 0.10 },
    { y:  0.098, rx: 0.246, rz: 0.118, zOffset: -0.106, frontFlat: 0.16 }
  ], { sides: 8 })
  const zonedBraidedBody = bakeZoneColors(rawBraidedBody, (_cx, cy, _cz, _nx, ny) => {
    if (ny < -0.3 || cy < -0.14) return [0.86, 0.84, 0.84, 1]
    return WHITE
  })
  const beardBraidedBody = bakeVertexAO(zonedBraidedBody, { strength: 0.16, verticalGradient: 0.10 })

  const beardBraidedMustache = sculptLoft([
    { y: -0.022, rx: 0.108, rz: 0.030, frontFlat: 0.14 },
    { y:  0.008, rx: 0.124, rz: 0.038, frontFlat: 0.14 },
    { y:  0.036, rx: 0.092, rz: 0.028, frontFlat: 0.12 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const beardBraidedBraid = sculptLoft([
    { y: -0.345, rx: 0.044, rz: 0.038, zOffset: 0.016 },
    { y: -0.268, rx: 0.062, rz: 0.052, zOffset: 0.018 },
    { y: -0.175, rx: 0.072, rz: 0.058, zOffset: 0.010 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const beardBraidedClasp = sculptLoft([
    { y: -0.348, rx: 0.056, rz: 0.050, zOffset: 0.016 },
    { y: -0.320, rx: 0.060, rz: 0.054, zOffset: 0.016 },
    { y: -0.292, rx: 0.056, rz: 0.050, zOffset: 0.016 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const beardBraidedTip = sculptLoft([
    { y: -0.422, rx: 0.010, rz: 0.010, zOffset: 0.020 },
    { y: -0.376, rx: 0.046, rz: 0.038, zOffset: 0.018 },
    { y: -0.340, rx: 0.038, rz: 0.032, zOffset: 0.016 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  // beard_sage (Grand long angular flowing wizard beard + sweeping mustache)
  const rawSageBody = sculptLoft([
    { y: -0.455, rx: 0.026, rz: 0.022, zOffset: 0.036 },
    { y: -0.345, rx: 0.118, rz: 0.064, zOffset: 0.026, frontFlat: 0.10 },
    { y: -0.205, rx: 0.194, rz: 0.106, zOffset: -0.014, frontFlat: 0.08 },
    { y: -0.068, rx: 0.244, rz: 0.144, zOffset: -0.064, frontFlat: 0.08 },
    { y:  0.036, rx: 0.252, rz: 0.142, zOffset: -0.086, frontFlat: 0.10 },
    { y:  0.095, rx: 0.246, rz: 0.116, zOffset: -0.104, frontFlat: 0.16 }
  ], { sides: 8 })
  const zonedSageBody = bakeZoneColors(rawSageBody, (cx, cy, _cz, _nx, ny) => {
    if (cy < -0.26 || ny < -0.3) return [0.88, 0.88, 0.92, 1]
    if (Math.abs(cx) < 0.08 && cy > -0.24) return [1.04, 1.04, 1.05, 1]
    return WHITE
  })
  const beardSageBody = bakeVertexAO(zonedSageBody, { strength: 0.16, verticalGradient: 0.10 })

  const beardSageMustache = sculptLoft([
    { y: -0.032, rx: 0.128, rz: 0.032, frontFlat: 0.12 },
    { y:  0.008, rx: 0.144, rz: 0.042, frontFlat: 0.12 },
    { y:  0.040, rx: 0.104, rz: 0.030, frontFlat: 0.10 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const createSageSideFlange = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.265, rx: 0.022, rz: 0.030, xOffset: side * 0.184, zOffset: 0.008 },
    { y: -0.135, rx: 0.056, rz: 0.064, xOffset: side * 0.228, zOffset: -0.016 },
    { y:  0.005, rx: 0.062, rz: 0.078, xOffset: side * 0.242, zOffset: -0.042 },
    { y:  0.092, rx: 0.048, rz: 0.068, xOffset: side * 0.236, zOffset: -0.066 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  // beard_goatee (Sharp sculpted chin beard + angular mustache)
  const beardGoateeChin = sculptLoft([
    { y: -0.232, rx: 0.018, rz: 0.018, zOffset: 0.008 },
    { y: -0.142, rx: 0.072, rz: 0.052, zOffset: -0.006, frontFlat: 0.14 },
    { y: -0.048, rx: 0.096, rz: 0.064, zOffset: -0.014, frontFlat: 0.14 },
    { y:  0.012, rx: 0.076, rz: 0.044, zOffset: -0.012, frontFlat: 0.14 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const beardGoateeMustache = sculptLoft([
    { y: -0.012, rx: 0.114, rz: 0.020, zOffset: 0.010, frontFlat: 0.16 },
    { y:  0.014, rx: 0.124, rz: 0.024, zOffset: 0.014, frontFlat: 0.16 },
    { y:  0.034, rx: 0.092, rz: 0.018, zOffset: 0.010, frontFlat: 0.14 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  // --- Face Accents (socket anchor [0, 0.30, 0.220] on head; eyes at y = +0.004, x = +-0.098) ---
  // face_mask_rogue: wraps completely around lower face, jaw, chin & rear neck (head center is z = -0.220!)
  const rawRogueMask = sculptLoft([
    { y: -0.312, rx: 0.148, rz: 0.160, zOffset: -0.204, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.205, rx: 0.246, rz: 0.226, zOffset: -0.208, frontFlat: 0.08, backFlat: 0.08 },
    { y: -0.095, rx: 0.262, rz: 0.238, zOffset: -0.210, frontFlat: 0.08, backFlat: 0.08 },
    { y: -0.048, rx: 0.258, rz: 0.232, zOffset: -0.212, frontFlat: 0.09, backFlat: 0.08 }
  ], { sides: 8 })
  const zonedRogueMask = bakeZoneColors(rawRogueMask, (_cx, cy, _cz, _nx, _ny, nz) => {
    if (cy > -0.082 && nz > 0.3) return [1.14, 1.14, 1.18, 1]
    if (cy < -0.23) return [0.84, 0.84, 0.88, 1]
    return WHITE
  })
  const rogueMaskWrap = bakeVertexAO(zonedRogueMask, { strength: 0.16, verticalGradient: 0.08 })

  // Sculpted triangular nose-bridge peak fold on front of mask (stays well below eyes!)
  const rogueMaskNoseFold = sculptLoft([
    { y: -0.105, rx: 0.138, rz: 0.024, zOffset: 0.006, frontFlat: 0.14 },
    { y: -0.052, rx: 0.092, rz: 0.024, zOffset: 0.008, frontFlat: 0.14 },
    { y: -0.026, rx: 0.036, rz: 0.018, zOffset: 0.006 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const rogueMaskTail = sculptLoft([
    { y: -0.245, rx: 0.024, rz: 0.018, zOffset: -0.468 },
    { y: -0.155, rx: 0.046, rz: 0.028, zOffset: -0.456 },
    { y: -0.088, rx: 0.038, rz: 0.028, zOffset: -0.436 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  // face_warpaint: crisp flush angled cheek bands hugging face plane & 45-degree cheek bevel
  const warpaintCheekBand = sculptLoft([
    { y: -0.018, rx: 0.056, rz: 0.012 },
    { y:  0.000, rx: 0.060, rz: 0.014 },
    { y:  0.018, rx: 0.056, rz: 0.012 }
  ], { sides: 6 })

  const warpaintTempleStripe = sculptLoft([
    { y: -0.034, rx: 0.018, rz: 0.012 },
    { y:  0.034, rx: 0.016, rz: 0.012 }
  ], { sides: 6 })

  // face_scar: crisp diagonal facial scar across right eye & cheek
  const scarMainGash = sculptLoft([
    { y: -0.108, rx: 0.010, rz: 0.008 },
    { y: -0.030, rx: 0.015, rz: 0.011 },
    { y:  0.035, rx: 0.015, rz: 0.011 },
    { y:  0.102, rx: 0.009, rz: 0.008 }
  ], { sides: 4 })

  const scarSideNotch = sculptLoft([
    { y: -0.028, rx: 0.008, rz: 0.007 },
    { y:  0.028, rx: 0.008, rz: 0.007 }
  ], { sides: 4 })

  cachedAccessoryMeshes = {
    elfEarBlade,
    goblinEarBlade,
    browFierce,
    browNoble,
    browArched,
    hairCapStandard,
    hairNapeShort,
    ponytailBand,
    ponytailBangSweep,
    ponytailFrontLockR,
    ponytailSideTuckL,
    ponytailTieRing,
    ponytailTail,
    mageCrown,
    mageSideLockL: createMageSideLock(-1),
    mageSideLockR: createMageSideLock(1),
    mageBackFlow,
    mageFrontPartL: createMageFrontPart(-1),
    mageFrontPartR: createMageFrontPart(1),
    bobCrown,
    bobBangSweep,
    bobSideL: createBobSide(-1),
    bobSideR: createBobSide(1),
    bobBack,
    rogueBangSpike,
    rogueSpikeLong,
    rogueSpikeMed,
    rogueSideburnL: createRogueSideburn(-1),
    rogueSideburnR: createRogueSideburn(1),
    maneCrownSweep,
    maneCrestCenter,
    maneWingL: createManeWing(-1),
    maneWingR: createManeWing(1),
    maneBackLocks,
    maneFrontSweep,
    beardBraidedBody,
    beardBraidedMustache,
    beardBraidedBraid,
    beardBraidedClasp,
    beardBraidedTip,
    beardSageBody,
    beardSageMustache,
    beardSageSideL: createSageSideFlange(-1),
    beardSageSideR: createSageSideFlange(1),
    beardGoateeChin,
    beardGoateeMustache,
    rogueMaskWrap,
    rogueMaskNoseFold,
    rogueMaskTail,
    warpaintCheekBand,
    warpaintTempleStripe,
    scarMainGash,
    scarSideNotch
  }
  return cachedAccessoryMeshes
}

// ---------------------------------------------------------------------------
// 5. Frostwyrm Dragon Raid-Boss Body Meshes
// ---------------------------------------------------------------------------

interface FrostwyrmMeshes {
  readonly cranium: Mesh
  readonly snoutUpper: Mesh
  readonly jawLower: Mesh
  readonly eyeCrystal: Mesh
  readonly hornMain: Mesh
  readonly hornSub: Mesh
  readonly fang: Mesh
  readonly neck: Mesh
  readonly chest: Mesh
  readonly bellyPlate: Mesh
  readonly frostCore: Mesh
  readonly tailBase: Mesh
  readonly tailTip: Mesh
  readonly dorsalSpine: Mesh
  readonly wingSpar: Mesh
  readonly wingSailOuter: Mesh
  readonly wingSailInner: Mesh
  readonly wingTalon: Mesh
  readonly hindLeg: Mesh
  readonly hindFoot: Mesh
  readonly tailFin: Mesh
}

let cachedFrostwyrmMeshes: FrostwyrmMeshes | undefined

function getFrostwyrmMeshes(): FrostwyrmMeshes {
  if (cachedFrostwyrmMeshes) return cachedFrostwyrmMeshes

  const cranium = sculptLoft([
    { y: 0.14, rx: 0.19, rz: 0.22, zOffset: 0.04, frontFlat: 0.10 },
    { y: 0.28, rx: 0.24, rz: 0.26, zOffset: 0.06, frontFlat: 0.12 },
    { y: 0.42, rx: 0.22, rz: 0.24, zOffset: 0.02, frontFlat: 0.10 },
    { y: 0.52, rx: 0.14, rz: 0.16, zOffset: -0.02 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const snoutUpper = sculptLoft([
    { y: 0.18, rx: 0.14, rz: 0.20, zOffset: 0.28, frontFlat: 0.18 },
    { y: 0.25, rx: 0.16, rz: 0.24, zOffset: 0.26, frontFlat: 0.16 },
    { y: 0.34, rx: 0.12, rz: 0.18, zOffset: 0.22, frontFlat: 0.14 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const jawLower = sculptLoft([
    { y: 0.06, rx: 0.11, rz: 0.16, zOffset: 0.24, frontFlat: 0.18 },
    { y: 0.12, rx: 0.13, rz: 0.20, zOffset: 0.23, frontFlat: 0.16 },
    { y: 0.16, rx: 0.12, rz: 0.17, zOffset: 0.20, frontFlat: 0.14 }
  ], { sides: 6, aoStrength: 0.18, aoGradient: 0.10 })

  const eyeCrystal = sculptLoft([
    { y: -0.024, rx: 0.052, rz: 0.024 },
    { y: 0.000, rx: 0.064, rz: 0.032 },
    { y: 0.024, rx: 0.048, rz: 0.020 }
  ], { sides: 6 })

  const hornMain = makeSpikeMesh(0.46, 0.066, 0.062, 6, 0, -0.22, 0.14)
  const hornSub = makeSpikeMesh(0.28, 0.044, 0.044, 5, 0, -0.14, 0.14)
  const fang = makeSpikeMesh(0.068, 0.018, 0.018, 4, 0, 0.01, 0.10)

  const neck = sculptLoft([
    { y: 0.36, rx: 0.20, rz: 0.22, zOffset: 0.02 },
    { y: 0.48, rx: 0.16, rz: 0.19, zOffset: 0.06 },
    { y: 0.58, rx: 0.15, rz: 0.17, zOffset: 0.08 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const chest = sculptLoft([
    { y: 0.00, rx: 0.26, rz: 0.28, zOffset: -0.02 },
    { y: 0.16, rx: 0.36, rz: 0.36, zOffset: 0.03 },
    { y: 0.34, rx: 0.38, rz: 0.34, zOffset: 0.04 },
    { y: 0.46, rx: 0.28, rz: 0.26, zOffset: 0.01 }
  ], { sides: 8, aoStrength: 0.18, aoGradient: 0.10 })

  const bellyPlate = sculptLoft([
    { y: 0.04, rx: 0.18, rz: 0.08, zOffset: 0.30, frontFlat: 0.16 },
    { y: 0.22, rx: 0.22, rz: 0.09, zOffset: 0.34, frontFlat: 0.16 },
    { y: 0.38, rx: 0.19, rz: 0.08, zOffset: 0.30, frontFlat: 0.14 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  const frostCore = sculptLoft([
    { y: 0.16, rx: 0.04, rz: 0.04, zOffset: 0.39 },
    { y: 0.25, rx: 0.11, rz: 0.06, zOffset: 0.40 },
    { y: 0.34, rx: 0.04, rz: 0.04, zOffset: 0.39 }
  ], { sides: 6 })

  const tailBase = sculptLoft([
    { y: -0.08, rx: 0.19, rz: 0.26, zOffset: -0.26 },
    { y: 0.02, rx: 0.15, rz: 0.34, zOffset: -0.44 },
    { y: 0.10, rx: 0.10, rz: 0.24, zOffset: -0.62 }
  ], { sides: 6, aoStrength: 0.18, aoGradient: 0.10 })

  const tailTip = makeSpikeMesh(0.46, 0.082, 0.082, 5, 0, -0.32, 0.16)
  const dorsalSpine = makeSpikeMesh(0.24, 0.048, 0.072, 5, 0, -0.08, 0.12)

  // Sweeping draconic wings anchored on armL / armR so idle & boss_breath flap them!
  const wingSpar = makeSpikeMesh(0.76, 0.056, 0.048, 6, 0.14, -0.18, 0.16)
  const wingSailOuter = sculptLoft([
    { y: -0.10, rx: 0.05, rz: 0.03 },
    { y: 0.18, rx: 0.34, rz: 0.036, zOffset: -0.12 },
    { y: 0.48, rx: 0.42, rz: 0.030, zOffset: -0.18 },
    { y: 0.66, rx: 0.14, rz: 0.022, zOffset: -0.12 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })
  const wingSailInner = sculptLoft([
    { y: -0.18, rx: 0.06, rz: 0.03 },
    { y: 0.08, rx: 0.26, rz: 0.032, zOffset: -0.10 },
    { y: 0.36, rx: 0.28, rz: 0.028, zOffset: -0.14 },
    { y: 0.46, rx: 0.10, rz: 0.020, zOffset: -0.08 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })
  const wingTalon = makeSpikeMesh(0.18, 0.034, 0.034, 4, 0, 0.04, 0.12)

  const hindLeg = sculptLoft([
    { y: -0.44, rx: 0.10, rz: 0.12 },
    { y: -0.24, rx: 0.12, rz: 0.14, zOffset: -0.02 },
    { y: -0.02, rx: 0.14, rz: 0.16 }
  ], { sides: 7, aoStrength: 0.18, aoGradient: 0.10 })

  const hindFoot = sculptLoft([
    { y: -0.500, rx: 0.13, rz: 0.20, zOffset: 0.06, frontFlat: 0.18 },
    { y: -0.440, rx: 0.12, rz: 0.18, zOffset: 0.05 },
    { y: -0.390, rx: 0.10, rz: 0.12, zOffset: 0.01 }
  ], { sides: 6, aoStrength: 0.18, aoGradient: 0.10 })

  const tailFin = makeSpikeMesh(0.32, 0.046, 0.095, 5, 0, -0.16, 0.12)

  cachedFrostwyrmMeshes = {
    cranium,
    snoutUpper,
    jawLower,
    eyeCrystal,
    hornMain,
    hornSub,
    fang,
    neck,
    chest,
    bellyPlate,
    frostCore,
    tailBase,
    tailTip,
    dorsalSpine,
    wingSpar,
    wingSailOuter,
    wingSailInner,
    wingTalon,
    hindLeg,
    hindFoot,
    tailFin
  }
  return cachedFrostwyrmMeshes
}

// ---------------------------------------------------------------------------
// Public Registration Entry Point
// ---------------------------------------------------------------------------

/**
 * Register Crownshard creature bodies (`skeleton`, `goblin`, `orc_brute`, `frost_golem`),
 * ears, brows, hair styles, beards, and face accents onto a `CharacterBuilder`.
 */
export function registerCrownshardBodiesAndHair(builder: CharacterBuilder): void {
  // === CREATURE BODIES ===

  builder.registerBody('skeleton', (palette: CharacterPalette): Record<string, RigPart[]> => {
    const m = getSkeletonMeshes()
    const bone = palette.skin
    const boneShade = palette.skinShade
    const hollow = mixColor(palette.eye, boneShade, 0.14)
    const toothColor = shadeColor(bone, 0.08)

    return {
      head: [
        { name: 'skel_cranium', mesh: m.cranium, color: bone },
        { name: 'skel_brow_ridge', mesh: m.browRidge, position: [0, 0.362, 0.194], color: bone },
        { name: 'skel_eye_l', mesh: m.eyeSocket, position: [-0.092, 0.302, 0.198], rotation: [0, 0, -0.08], color: palette.eye },
        { name: 'skel_eye_r', mesh: m.eyeSocket, position: [0.092, 0.302, 0.198], rotation: [0, 0, 0.08], color: palette.eye },
        { name: 'skel_nose', mesh: m.noseCavity, position: [0, 0.214, 0.204], color: palette.eye },
        { name: 'skel_upper_jaw', mesh: m.upperJaw, color: bone },
        { name: 'skel_mouth_gap', mesh: m.mouthGap, color: palette.eye },
        { name: 'skel_lower_jaw', mesh: m.lowerJaw, color: boneShade },
        { name: 'skel_tooth_1', mesh: m.toothBlock, position: [-0.054, 0.086, 0.178], color: toothColor },
        { name: 'skel_tooth_2', mesh: m.toothBlock, position: [-0.018, 0.086, 0.182], color: toothColor },
        { name: 'skel_tooth_3', mesh: m.toothBlock, position: [0.018, 0.086, 0.182], color: toothColor },
        { name: 'skel_tooth_4', mesh: m.toothBlock, position: [0.054, 0.086, 0.178], color: toothColor }
      ],
      body: [
        { name: 'skel_neck', mesh: m.neckSpine, color: boneShade },
        { name: 'skel_spine', mesh: m.thoracicSpine, color: boneShade },
        { name: 'skel_vertebra_1', mesh: m.spineKnob, position: [0, 0.150, -0.092], color: bone },
        { name: 'skel_vertebra_2', mesh: m.spineKnob, position: [0, 0.245, -0.104], color: bone },
        { name: 'skel_vertebra_3', mesh: m.spineKnob, position: [0, 0.340, -0.108], color: bone },
        { name: 'skel_rib_cavity', mesh: m.ribCavity, color: hollow },
        { name: 'skel_rib_low', mesh: m.ribLow, color: bone },
        { name: 'skel_rib_mid', mesh: m.ribMid, color: bone },
        { name: 'skel_rib_top', mesh: m.ribTop, color: bone },
        { name: 'skel_sternum', mesh: m.sternum, color: bone },
        { name: 'skel_clavicle', mesh: m.clavicle, color: bone },
        { name: 'skel_pelvis', mesh: m.pelvis, color: boneShade }
      ],
      armL: [
        { name: 'skel_humerus_l', mesh: m.humerusL, color: bone },
        { name: 'skel_forearm_l', mesh: m.forearmL, color: boneShade },
        { name: 'skel_hand_l', mesh: m.handL, color: bone },
        { name: 'skel_thumb_l', mesh: m.thumbL, color: bone }
      ],
      armR: [
        { name: 'skel_humerus_r', mesh: m.humerusR, color: bone },
        { name: 'skel_forearm_r', mesh: m.forearmR, color: boneShade },
        { name: 'skel_hand_r', mesh: m.handR, color: bone },
        { name: 'skel_thumb_r', mesh: m.thumbR, color: bone }
      ],
      legL: [
        { name: 'skel_femur_l', mesh: m.femur, color: bone },
        { name: 'skel_knee_l', mesh: m.kneeCap, color: boneShade },
        { name: 'skel_tibia_l', mesh: m.tibia, color: boneShade },
        { name: 'skel_foot_l', mesh: m.foot, color: bone }
      ],
      legR: [
        { name: 'skel_femur_r', mesh: m.femur, color: bone },
        { name: 'skel_knee_r', mesh: m.kneeCap, color: boneShade },
        { name: 'skel_tibia_r', mesh: m.tibia, color: boneShade },
        { name: 'skel_foot_r', mesh: m.foot, color: bone }
      ]
    }
  })

  builder.registerBody('goblin', (palette: CharacterPalette): Record<string, RigPart[]> => {
    const m = getGoblinMeshes()
    const skin = palette.skin
    const skinShade = palette.skinShade

    return {
      head: [
        { name: 'goblin_head', mesh: m.head, color: skin },
        { name: 'goblin_ear_base_l', mesh: m.earBaseL, color: skinShade },
        { name: 'goblin_ear_base_r', mesh: m.earBaseR, color: skinShade },
        { name: 'goblin_brow_l', mesh: m.browRidge, position: [-0.094, 0.326, 0.214], rotation: [0.06, 0.10, -0.26], color: skinShade },
        { name: 'goblin_brow_r', mesh: m.browRidge, position: [0.094, 0.326, 0.214], rotation: [0.06, -0.10, 0.26], color: skinShade },
        { name: 'goblin_nose', mesh: m.nose, color: skin },
        { name: 'goblin_eye_socket_l', mesh: m.eyeSocket, position: [-0.096, 0.266, 0.212], rotation: [0, 0.08, -0.18], color: palette.eye },
        { name: 'goblin_eye_socket_r', mesh: m.eyeSocket, position: [0.096, 0.266, 0.212], rotation: [0, -0.08, 0.18], color: palette.eye },
        { name: 'goblin_eye_glow_l', mesh: m.eyeGlow, position: [-0.096, 0.266, 0.224], rotation: [0, 0.08, -0.18], color: palette.glow, unlit: 0.72 },
        { name: 'goblin_eye_glow_r', mesh: m.eyeGlow, position: [0.096, 0.266, 0.224], rotation: [0, -0.08, 0.18], color: palette.glow, unlit: 0.72 },
        { name: 'goblin_mouth', mesh: m.mouthSlit, position: [0, 0.094, 0.212], color: palette.eye },
        { name: 'goblin_fang_l', mesh: m.fang, position: [-0.056, 0.084, 0.222], rotation: [0.12, 0, -0.10], color: TUSK_IVORY },
        { name: 'goblin_fang_r', mesh: m.fang, position: [0.056, 0.084, 0.222], rotation: [0.12, 0, 0.10], color: TUSK_IVORY }
      ],
      body: [
        { name: 'goblin_neck', mesh: m.neck, color: skinShade },
        { name: 'goblin_torso', mesh: m.torso, color: skin },
        { name: 'goblin_strap', mesh: m.chestStrap, position: [0, 0.258, 0.012], rotation: [0, 0, 0.66], color: palette.leather },
        { name: 'goblin_strap_buckle', mesh: m.strapBuckle, position: [0.012, 0.268, 0.172], color: palette.metalDark },
        { name: 'goblin_waist_band', mesh: m.waistBand, color: palette.leather },
        { name: 'goblin_loin_front', mesh: m.loinFront, color: palette.leatherLight },
        { name: 'goblin_loin_back', mesh: m.loinBack, color: palette.leather }
      ],
      armL: [
        { name: 'goblin_arm_l', mesh: m.armL, color: skin },
        { name: 'goblin_wrap_l', mesh: m.wristWrapL, color: palette.leather },
        { name: 'goblin_hand_l', mesh: m.handL, color: skin },
        { name: 'goblin_thumb_l', mesh: m.thumbL, color: skin }
      ],
      armR: [
        { name: 'goblin_arm_r', mesh: m.armR, color: skin },
        { name: 'goblin_wrap_r', mesh: m.wristWrapR, color: palette.leather },
        { name: 'goblin_hand_r', mesh: m.handR, color: skin },
        { name: 'goblin_thumb_r', mesh: m.thumbR, color: skin }
      ],
      legL: [
        { name: 'goblin_leg_l', mesh: m.legUpper, color: skinShade },
        { name: 'goblin_shin_wrap_l', mesh: m.legWrap, color: palette.leather },
        { name: 'goblin_foot_l', mesh: m.foot, color: palette.leatherLight }
      ],
      legR: [
        { name: 'goblin_leg_r', mesh: m.legUpper, color: skinShade },
        { name: 'goblin_shin_wrap_r', mesh: m.legWrap, color: palette.leather },
        { name: 'goblin_foot_r', mesh: m.foot, color: palette.leatherLight }
      ]
    }
  })

  builder.registerBody('orc_brute', (palette: CharacterPalette): Record<string, RigPart[]> => {
    const m = getOrcBruteMeshes()
    const skin = palette.skin
    const skinShade = palette.skinShade

    return {
      head: [
        { name: 'orc_head', mesh: m.head, color: skin },
        { name: 'orc_jaw', mesh: m.underbiteJaw, color: skinShade },
        { name: 'orc_brow', mesh: m.browSlab, color: skinShade },
        { name: 'orc_nose', mesh: m.noseBridge, color: skin },
        { name: 'orc_ear_l', mesh: m.earL, color: skinShade },
        { name: 'orc_ear_r', mesh: m.earR, color: skinShade },
        { name: 'orc_eye_l', mesh: m.eyeBlock, position: [-0.098, 0.304, 0.222], rotation: [0, 0.08, -0.14], color: palette.eye },
        { name: 'orc_eye_r', mesh: m.eyeBlock, position: [0.098, 0.304, 0.222], rotation: [0, -0.08, 0.14], color: palette.eye },
        { name: 'orc_eye_glint_l', mesh: m.eyeGlint, position: [-0.096, 0.304, 0.234], color: palette.glow, unlit: 0.55 },
        { name: 'orc_eye_glint_r', mesh: m.eyeGlint, position: [0.096, 0.304, 0.234], color: palette.glow, unlit: 0.55 },
        { name: 'orc_mouth', mesh: m.mouthCrease, position: [0, 0.128, 0.232], color: palette.eye },
        { name: 'orc_tusk_l', mesh: m.tusk, position: [-0.104, 0.104, 0.230], rotation: [0.22, -0.14, 0.18], color: TUSK_IVORY },
        { name: 'orc_tusk_r', mesh: m.tusk, position: [0.104, 0.104, 0.230], rotation: [0.22, 0.14, -0.18], color: TUSK_IVORY }
      ],
      body: [
        { name: 'orc_neck', mesh: m.neck, color: skinShade },
        { name: 'orc_torso', mesh: m.torso, color: skin },
        { name: 'orc_harness', mesh: m.harnessStrap, position: [0, 0.312, 0.012], rotation: [0, 0, -0.64], color: palette.leather },
        { name: 'orc_war_belt', mesh: m.warBelt, color: palette.leather },
        { name: 'orc_belt_plate', mesh: m.beltPlate, color: palette.metalDark },
        { name: 'orc_fauld', mesh: m.pelvisFauld, color: palette.primaryDark }
      ],
      armL: [
        { name: 'orc_arm_l', mesh: m.armL, color: skin },
        { name: 'orc_bracer_l', mesh: m.bracerWrapL, color: palette.metalDark },
        { name: 'orc_fist_l', mesh: m.fistL, color: skin },
        { name: 'orc_thumb_l', mesh: m.thumbL, color: skin }
      ],
      armR: [
        { name: 'orc_arm_r', mesh: m.armR, color: skin },
        { name: 'orc_bracer_r', mesh: m.bracerWrapR, color: palette.metalDark },
        { name: 'orc_fist_r', mesh: m.fistR, color: skin },
        { name: 'orc_thumb_r', mesh: m.thumbR, color: skin }
      ],
      legL: [
        { name: 'orc_thigh_l', mesh: m.thigh, color: palette.primaryDark },
        { name: 'orc_knee_l', mesh: m.kneePlate, color: palette.metal },
        { name: 'orc_greave_l', mesh: m.bootGreave, color: palette.metalDark },
        { name: 'orc_boot_l', mesh: m.bootFoot, color: palette.leather }
      ],
      legR: [
        { name: 'orc_thigh_r', mesh: m.thigh, color: palette.primaryDark },
        { name: 'orc_knee_r', mesh: m.kneePlate, color: palette.metal },
        { name: 'orc_greave_r', mesh: m.bootGreave, color: palette.metalDark },
        { name: 'orc_boot_r', mesh: m.bootFoot, color: palette.leather }
      ]
    }
  })

  builder.registerBody('frost_golem', (palette: CharacterPalette): Record<string, RigPart[]> => {
    const m = getFrostGolemMeshes()
    const slate = palette.metalDark
    const slateDark = shadeColor(palette.metalDark, -0.14)
    const slateMid = palette.primaryDark
    const iceBright = mixColor(palette.metal, palette.glow, 0.45)
    const iceDeep = mixColor(palette.primary, palette.glow, 0.25)
    const glowCore = palette.glow
    const glowHeart = shadeColor(palette.glow, 0.24)

    return {
      head: [
        { name: 'golem_head', mesh: m.head, color: slate },
        { name: 'golem_visor', mesh: m.visorRecess, color: slateDark },
        { name: 'golem_eye_l', mesh: m.eyeShard, position: [-0.094, 0.310, 0.228], rotation: [0, 0.10, -0.16], color: glowCore, unlit: 0.90 },
        { name: 'golem_eye_r', mesh: m.eyeShard, position: [0.094, 0.310, 0.228], rotation: [0, -0.10, 0.16], color: glowCore, unlit: 0.90 },
        { name: 'golem_crown_c', mesh: m.crownShardTall, position: [0, 0.525, -0.020], rotation: [-0.22, 0, 0], color: iceBright },
        { name: 'golem_crown_l', mesh: m.crownShardSide, position: [-0.118, 0.488, -0.012], rotation: [-0.18, 0, 0.36], color: iceDeep },
        { name: 'golem_crown_r', mesh: m.crownShardSide, position: [0.118, 0.488, -0.012], rotation: [-0.18, 0, -0.36], color: iceDeep }
      ],
      body: [
        { name: 'golem_torso', mesh: m.torsoStone, color: slate },
        { name: 'golem_chest_recess', mesh: m.chestRecess, color: slateDark },
        { name: 'golem_core_outer', mesh: m.coreOuter, color: glowCore, unlit: 0.85 },
        { name: 'golem_core_inner', mesh: m.coreInner, color: glowHeart, unlit: 1.0 },
        { name: 'golem_clamp_tl', mesh: m.chestClamp, position: [-0.096, 0.358, 0.214], rotation: [0, 0, -0.78], color: slateMid },
        { name: 'golem_clamp_tr', mesh: m.chestClamp, position: [0.096, 0.358, 0.214], rotation: [0, 0, 0.78], color: slateMid },
        { name: 'golem_clamp_bl', mesh: m.chestClamp, position: [-0.088, 0.232, 0.212], rotation: [0, 0, 0.78], color: slateMid },
        { name: 'golem_clamp_br', mesh: m.chestClamp, position: [0.088, 0.232, 0.212], rotation: [0, 0, -0.78], color: slateMid },
        // Jagged ice shoulder clusters
        { name: 'golem_sh_ice_l1', mesh: m.shoulderCrystalMain, position: [-0.278, 0.425, 0.004], rotation: [-0.14, 0, 0.42], color: iceBright },
        { name: 'golem_sh_ice_l2', mesh: m.shoulderCrystalSub, position: [-0.340, 0.392, -0.056], rotation: [-0.28, 0, 0.74], color: iceDeep },
        { name: 'golem_sh_ice_l3', mesh: m.shoulderCrystalSub, position: [-0.242, 0.448, -0.092], rotation: [-0.42, 0, 0.26], color: iceBright },
        { name: 'golem_sh_ice_r1', mesh: m.shoulderCrystalMain, position: [0.278, 0.425, 0.004], rotation: [-0.14, 0, -0.42], color: iceBright },
        { name: 'golem_sh_ice_r2', mesh: m.shoulderCrystalSub, position: [0.340, 0.392, -0.056], rotation: [-0.28, 0, -0.74], color: iceDeep },
        { name: 'golem_sh_ice_r3', mesh: m.shoulderCrystalSub, position: [0.242, 0.448, -0.092], rotation: [-0.42, 0, -0.26], color: iceBright },
        { name: 'golem_back_ice_1', mesh: m.backCrystal, position: [0, 0.415, -0.178], rotation: [-0.66, 0, 0], color: iceBright },
        { name: 'golem_back_ice_2', mesh: m.shoulderCrystalSub, position: [0, 0.268, -0.194], rotation: [-0.88, 0, 0], color: iceDeep },
        { name: 'golem_pelvis', mesh: m.pelvisStone, color: slateMid }
      ],
      armL: [
        { name: 'golem_upper_arm_l', mesh: m.armUpperL, color: slate },
        { name: 'golem_forearm_l', mesh: m.forearmL, color: slateMid },
        { name: 'golem_elbow_ice_l', mesh: m.elbowCrystal, position: [-0.110, -0.195, -0.036], rotation: [-0.38, 0, 1.05], color: iceBright }
      ],
      armR: [
        { name: 'golem_upper_arm_r', mesh: m.armUpperR, color: slate },
        { name: 'golem_forearm_r', mesh: m.forearmR, color: slateMid },
        { name: 'golem_elbow_ice_r', mesh: m.elbowCrystal, position: [0.110, -0.195, -0.036], rotation: [-0.38, 0, -1.05], color: iceBright }
      ],
      legL: [
        { name: 'golem_leg_l', mesh: m.pillarLeg, color: slate },
        { name: 'golem_knee_ice_l', mesh: m.kneeCrystal, position: [0, -0.275, 0.112], rotation: [0.34, 0, 0], color: iceBright },
        { name: 'golem_foot_l', mesh: m.pillarFoot, color: slateMid }
      ],
      legR: [
        { name: 'golem_leg_r', mesh: m.pillarLeg, color: slate },
        { name: 'golem_knee_ice_r', mesh: m.kneeCrystal, position: [0, -0.275, 0.112], rotation: [0.34, 0, 0], color: iceBright },
        { name: 'golem_foot_r', mesh: m.pillarFoot, color: slateMid }
      ]
    }
  })

  builder.registerBody('frostwyrm', (palette: CharacterPalette): Record<string, RigPart[]> => {
    const m = getFrostwyrmMeshes()
    const scaleMain = palette.primary
    const scaleDark = palette.primaryDark
    const bellyIce = mixColor(palette.metal, palette.secondary, 0.35)
    const wingMembrane = mixColor(palette.secondary, palette.glow, 0.36)
    const iceCrest = mixColor(palette.accent, palette.glow, 0.42)
    const glow = palette.glow
    const hornBone = mixColor(palette.metal, [0.95, 0.98, 1.0, 1], 0.45)

    return {
      head: [
        { name: 'wyrm_cranium', mesh: m.cranium, color: scaleMain },
        { name: 'wyrm_snout', mesh: m.snoutUpper, color: scaleMain },
        { name: 'wyrm_jaw', mesh: m.jawLower, color: scaleDark },
        { name: 'wyrm_eye_l', mesh: m.eyeCrystal, position: [-0.14, 0.32, 0.24], rotation: [0, 0.24, -0.18], color: glow, unlit: 0.98 },
        { name: 'wyrm_eye_r', mesh: m.eyeCrystal, position: [0.14, 0.32, 0.24], rotation: [0, -0.24, 0.18], color: glow, unlit: 0.98 },
        { name: 'wyrm_horn_l', mesh: m.hornMain, position: [-0.15, 0.44, -0.02], rotation: [-0.46, 0.12, 0.34], color: hornBone },
        { name: 'wyrm_horn_r', mesh: m.hornMain, position: [0.15, 0.44, -0.02], rotation: [-0.46, -0.12, -0.34], color: hornBone },
        { name: 'wyrm_brow_horn_l', mesh: m.hornSub, position: [-0.20, 0.32, 0.04], rotation: [-0.32, 0.20, 0.72], color: iceCrest },
        { name: 'wyrm_brow_horn_r', mesh: m.hornSub, position: [0.20, 0.32, 0.04], rotation: [-0.32, -0.20, -0.72], color: iceCrest },
        { name: 'wyrm_crest_c', mesh: m.dorsalSpine, position: [0, 0.48, -0.06], rotation: [-0.42, 0, 0], color: iceCrest },
        { name: 'wyrm_fang_l', mesh: m.fang, position: [-0.08, 0.15, 0.38], rotation: [Math.PI, 0, 0.08], color: TUSK_IVORY },
        { name: 'wyrm_fang_r', mesh: m.fang, position: [0.08, 0.15, 0.38], rotation: [Math.PI, 0, -0.08], color: TUSK_IVORY }
      ],
      body: [
        { name: 'wyrm_neck', mesh: m.neck, color: scaleMain },
        { name: 'wyrm_chest', mesh: m.chest, color: scaleMain },
        { name: 'wyrm_belly', mesh: m.bellyPlate, color: bellyIce },
        { name: 'wyrm_frost_core', mesh: m.frostCore, color: glow, unlit: 0.92 },
        { name: 'wyrm_spine_1', mesh: m.dorsalSpine, position: [0, 0.44, -0.24], rotation: [-0.72, 0, 0], color: iceCrest },
        { name: 'wyrm_spine_2', mesh: m.dorsalSpine, position: [0, 0.26, -0.30], rotation: [-0.95, 0, 0], color: iceCrest },
        { name: 'wyrm_tail_base', mesh: m.tailBase, color: scaleDark },
        { name: 'wyrm_tail_tip', mesh: m.tailTip, position: [0, 0.10, -0.70], rotation: [-1.10, 0, 0], color: iceCrest }
      ],
      armL: [
        { name: 'wyrm_wing_spar_l', mesh: m.wingSpar, position: [-0.14, 0.04, -0.06], rotation: [-0.26, 0.18, 0.96], color: scaleDark },
        { name: 'wyrm_wing_sail_outer_l', mesh: m.wingSailOuter, position: [-0.52, 0.16, -0.14], rotation: [-0.18, 0.22, 0.88], color: wingMembrane },
        { name: 'wyrm_wing_sail_inner_l', mesh: m.wingSailInner, position: [-0.24, 0.02, -0.12], rotation: [-0.14, 0.12, 0.56], color: bellyIce },
        { name: 'wyrm_wing_talon_l', mesh: m.wingTalon, position: [-0.62, 0.48, -0.10], rotation: [0.35, 0, 0.72], color: hornBone }
      ],
      armR: [
        { name: 'wyrm_wing_spar_r', mesh: m.wingSpar, position: [0.14, 0.04, -0.06], rotation: [-0.26, -0.18, -0.96], color: scaleDark },
        { name: 'wyrm_wing_sail_outer_r', mesh: m.wingSailOuter, position: [0.52, 0.16, -0.14], rotation: [-0.18, -0.22, -0.88], color: wingMembrane },
        { name: 'wyrm_wing_sail_inner_r', mesh: m.wingSailInner, position: [0.24, 0.02, -0.12], rotation: [-0.14, -0.12, -0.56], color: bellyIce },
        { name: 'wyrm_wing_talon_r', mesh: m.wingTalon, position: [0.62, 0.48, -0.10], rotation: [0.35, 0, -0.72], color: hornBone }
      ],
      legL: [
        { name: 'wyrm_leg_l', mesh: m.hindLeg, color: scaleDark },
        { name: 'wyrm_foot_l', mesh: m.hindFoot, color: scaleMain },
        { name: 'wyrm_claw_l1', mesh: m.fang, position: [-0.06, -0.46, 0.22], rotation: [1.35, 0, 0], color: hornBone },
        { name: 'wyrm_claw_l2', mesh: m.fang, position: [0.06, -0.46, 0.22], rotation: [1.35, 0, 0], color: hornBone }
      ],
      legR: [
        { name: 'wyrm_leg_r', mesh: m.hindLeg, color: scaleDark },
        { name: 'wyrm_foot_r', mesh: m.hindFoot, color: scaleMain },
        { name: 'wyrm_claw_r1', mesh: m.fang, position: [-0.06, -0.46, 0.22], rotation: [1.35, 0, 0], color: hornBone },
        { name: 'wyrm_claw_r2', mesh: m.fang, position: [0.06, -0.46, 0.22], rotation: [1.35, 0, 0], color: hornBone }
      ],
      cape: [
        { name: 'wyrm_dorsal_fin', mesh: m.tailFin, position: [0, 0.06, -0.10], rotation: [-0.72, 0, 0], color: iceCrest, unlit: 0.35 }
      ]
    }
  })

  // === EARS (anchor [0, 0.265, -0.008] on head) ===

  builder.registerPart('ears', 'elf_pointed', (palette) => {
    const m = getAccessoryMeshes()
    return [
      {
        name: 'ear_elf_l',
        mesh: m.elfEarBlade,
        position: [-0.214, -0.004, 0.002],
        rotation: [-0.18, 0.24, 0.90],
        color: palette.skin
      },
      {
        name: 'ear_elf_r',
        mesh: m.elfEarBlade,
        position: [0.214, -0.004, 0.002],
        rotation: [-0.18, -0.24, -0.90],
        color: palette.skin
      }
    ]
  })

  builder.registerPart('ears', 'goblin_long', (palette) => {
    const m = getAccessoryMeshes()
    return [
      {
        name: 'ear_goblin_l',
        mesh: m.goblinEarBlade,
        position: [-0.212, -0.008, 0.008],
        rotation: [-0.14, 0.18, 1.24],
        color: palette.skin
      },
      {
        name: 'ear_goblin_r',
        mesh: m.goblinEarBlade,
        position: [0.212, -0.008, 0.008],
        rotation: [-0.14, -0.18, -1.24],
        color: palette.skin
      }
    ]
  })

  // === BROWS (anchor [0, 0.365, 0.226] on head) ===

  builder.registerPart('brows', 'brows_fierce', (palette) => {
    const m = getAccessoryMeshes()
    return [
      {
        name: 'brow_fierce_l',
        mesh: m.browFierce,
        position: [-0.094, 0.004, 0.008],
        rotation: [0.04, 0.08, -0.22],
        color: palette.hair
      },
      {
        name: 'brow_fierce_r',
        mesh: m.browFierce,
        position: [0.094, 0.004, 0.008],
        rotation: [0.04, -0.08, 0.22],
        color: palette.hair
      }
    ]
  })

  builder.registerPart('brows', 'brows_noble', (palette) => {
    const m = getAccessoryMeshes()
    return [
      {
        name: 'brow_noble_l',
        mesh: m.browNoble,
        position: [-0.098, 0.004, 0.004],
        rotation: [0, 0.06, -0.06],
        color: palette.hair
      },
      {
        name: 'brow_noble_r',
        mesh: m.browNoble,
        position: [0.098, 0.004, 0.004],
        rotation: [0, -0.06, 0.06],
        color: palette.hair
      }
    ]
  })

  builder.registerPart('brows', 'brows_arched', (palette) => {
    const m = getAccessoryMeshes()
    return [
      // Confident sleek arched brows (inner arch slightly lifted, crisp outer tail)
      {
        name: 'brow_arched_l_in',
        mesh: m.browArched,
        position: [-0.088, 0.010, 0.004],
        scale: [0.76, 1, 1],
        rotation: [0, 0.06, -0.10],
        color: palette.hair
      },
      {
        name: 'brow_arched_l_out',
        mesh: m.browArched,
        position: [-0.132, 0.008, -0.002],
        scale: [0.58, 0.84, 0.92],
        rotation: [0, 0.16, 0.16],
        color: palette.hair
      },
      {
        name: 'brow_arched_r_in',
        mesh: m.browArched,
        position: [0.088, 0.010, 0.004],
        scale: [0.76, 1, 1],
        rotation: [0, -0.06, 0.10],
        color: palette.hair
      },
      {
        name: 'brow_arched_r_out',
        mesh: m.browArched,
        position: [0.132, 0.008, -0.002],
        scale: [0.58, 0.84, 0.92],
        rotation: [0, -0.16, -0.16],
        color: palette.hair
      }
    ]
  })

  // === HAIR (anchor [0, 0.28, 0] on head) ===

  builder.registerPart('hair', 'hair_ponytail', (palette) => {
    const m = getAccessoryMeshes()
    return [
      { name: 'hair_pt_cap', mesh: m.hairCapStandard, color: palette.hair },
      { name: 'hair_pt_nape', mesh: m.hairNapeShort, color: palette.hairShade },
      { name: 'hair_pt_headband', mesh: m.ponytailBand, color: palette.accent },
      { name: 'hair_pt_bangs', mesh: m.ponytailBangSweep, color: palette.hair },
      { name: 'hair_pt_lock_r', mesh: m.ponytailFrontLockR, color: palette.hair },
      { name: 'hair_pt_tuck_l', mesh: m.ponytailSideTuckL, color: palette.hairShade },
      { name: 'hair_pt_tie', mesh: m.ponytailTieRing, color: palette.accent },
      { name: 'hair_pt_tail', mesh: m.ponytailTail, color: palette.hair }
    ]
  })

  builder.registerPart('hair', 'hair_mage_long', (palette) => {
    const m = getAccessoryMeshes()
    return [
      { name: 'hair_mage_crown', mesh: m.mageCrown, color: palette.hair },
      { name: 'hair_mage_part_l', mesh: m.mageFrontPartL, color: palette.hair },
      { name: 'hair_mage_part_r', mesh: m.mageFrontPartR, color: palette.hair },
      { name: 'hair_mage_side_l', mesh: m.mageSideLockL, color: palette.hair },
      { name: 'hair_mage_side_r', mesh: m.mageSideLockR, color: palette.hair },
      { name: 'hair_mage_back', mesh: m.mageBackFlow, color: palette.hairShade }
    ]
  })

  builder.registerPart('hair', 'hair_noble_bob', (palette) => {
    const m = getAccessoryMeshes()
    return [
      { name: 'hair_bob_crown', mesh: m.bobCrown, color: palette.hair },
      { name: 'hair_bob_bangs', mesh: m.bobBangSweep, color: palette.hair },
      { name: 'hair_bob_side_l', mesh: m.bobSideL, color: palette.hair },
      { name: 'hair_bob_side_r', mesh: m.bobSideR, color: palette.hair },
      { name: 'hair_bob_back', mesh: m.bobBack, color: palette.hairShade }
    ]
  })

  builder.registerPart('hair', 'hair_rogue_spiky', (palette) => {
    const m = getAccessoryMeshes()
    return [
      { name: 'hair_rogue_cap', mesh: m.hairCapStandard, color: palette.hair },
      { name: 'hair_rogue_nape', mesh: m.hairNapeShort, color: palette.hairShade },
      { name: 'hair_rogue_sb_l', mesh: m.rogueSideburnL, color: palette.hairShade },
      { name: 'hair_rogue_sb_r', mesh: m.rogueSideburnR, color: palette.hairShade },
      // Swept angular bangs & crown spikes (tucked close to forehead)
      { name: 'hair_rogue_bang_1', mesh: m.rogueBangSpike, position: [-0.072, 0.258, 0.178], rotation: [0.24, 0.18, -2.55], color: palette.hair },
      { name: 'hair_rogue_bang_2', mesh: m.rogueBangSpike, position: [0.056, 0.270, 0.180], rotation: [0.20, -0.14, -2.35], color: palette.hair },
      { name: 'hair_rogue_sp_c', mesh: m.rogueSpikeLong, position: [0.008, 0.340, 0.045], rotation: [-0.54, 0.06, -0.08], color: palette.hair },
      { name: 'hair_rogue_sp_l', mesh: m.rogueSpikeMed, position: [-0.118, 0.312, 0.032], rotation: [-0.46, 0.24, 0.46], color: palette.hair },
      { name: 'hair_rogue_sp_r', mesh: m.rogueSpikeMed, position: [0.122, 0.316, 0.022], rotation: [-0.52, -0.22, -0.44], color: palette.hair },
      { name: 'hair_rogue_sp_b1', mesh: m.rogueSpikeLong, position: [-0.048, 0.320, -0.095], rotation: [-0.94, 0.12, 0.22], color: palette.hairShade },
      { name: 'hair_rogue_sp_b2', mesh: m.rogueSpikeMed, position: [0.064, 0.305, -0.110], rotation: [-1.02, -0.14, -0.24], color: palette.hairShade }
    ]
  })

  builder.registerPart('hair', 'hair_champion_mane', (palette) => {
    const m = getAccessoryMeshes()
    return [
      { name: 'hair_mane_crown', mesh: m.maneCrownSweep, color: palette.hair },
      { name: 'hair_mane_crest', mesh: m.maneCrestCenter, color: palette.hair },
      { name: 'hair_mane_front', mesh: m.maneFrontSweep, color: palette.hair },
      { name: 'hair_mane_wing_l', mesh: m.maneWingL, color: palette.hair },
      { name: 'hair_mane_wing_r', mesh: m.maneWingR, color: palette.hair },
      { name: 'hair_mane_back', mesh: m.maneBackLocks, color: palette.hairShade }
    ]
  })

  // === BEARDS (anchor [0, 0.135, 0.205] on head) ===

  builder.registerPart('beard', 'beard_braided', (palette) => {
    const m = getAccessoryMeshes()
    const stacheColor = shadeColor(palette.hair, 0.06)
    return [
      { name: 'beard_br_body', mesh: m.beardBraidedBody, color: palette.hair },
      { name: 'beard_br_stache_l', mesh: m.beardBraidedMustache, position: [-0.082, 0.022, 0.022], rotation: [0, 0.20, 0.24], color: stacheColor },
      { name: 'beard_br_stache_r', mesh: m.beardBraidedMustache, position: [0.082, 0.022, 0.022], rotation: [0, -0.20, -0.24], color: stacheColor },
      { name: 'beard_br_braid', mesh: m.beardBraidedBraid, color: palette.hairShade },
      { name: 'beard_br_clasp', mesh: m.beardBraidedClasp, color: palette.metal },
      { name: 'beard_br_tip', mesh: m.beardBraidedTip, color: palette.hair }
    ]
  })

  builder.registerPart('beard', 'beard_sage', (palette) => {
    const m = getAccessoryMeshes()
    const stacheColor = shadeColor(palette.hair, 0.06)
    return [
      { name: 'beard_sage_body', mesh: m.beardSageBody, color: palette.hair },
      { name: 'beard_sage_stache_l', mesh: m.beardSageMustache, position: [-0.094, 0.018, 0.028], rotation: [0, 0.22, 0.28], color: stacheColor },
      { name: 'beard_sage_stache_r', mesh: m.beardSageMustache, position: [0.094, 0.018, 0.028], rotation: [0, -0.22, -0.28], color: stacheColor },
      { name: 'beard_sage_side_l', mesh: m.beardSageSideL, color: palette.hairShade },
      { name: 'beard_sage_side_r', mesh: m.beardSageSideR, color: palette.hairShade }
    ]
  })

  builder.registerPart('beard', 'beard_goatee', (palette) => {
    const m = getAccessoryMeshes()
    return [
      { name: 'beard_goatee_chin', mesh: m.beardGoateeChin, color: palette.hair },
      { name: 'beard_goatee_stache', mesh: m.beardGoateeMustache, color: palette.hairShade }
    ]
  })

  // === FACE ACCENTS (anchor [0, 0.30, 0.220] on head) ===

  builder.registerPart('face', 'face_mask_rogue', (palette) => {
    const m = getAccessoryMeshes()
    const maskCloth = shadeColor(palette.primaryDark, -0.06)
    const maskFold = palette.primaryDark
    return [
      { name: 'face_mask_wrap', mesh: m.rogueMaskWrap, color: maskCloth },
      { name: 'face_mask_nose', mesh: m.rogueMaskNoseFold, color: maskFold },
      { name: 'face_mask_tail_l', mesh: m.rogueMaskTail, position: [-0.028, 0, 0], rotation: [0.16, 0, 0.14], color: maskCloth },
      { name: 'face_mask_tail_r', mesh: m.rogueMaskTail, position: [0.028, 0, 0], rotation: [0.16, 0, -0.14], color: maskFold }
    ]
  })

  builder.registerPart('face', 'face_warpaint', (palette) => {
    const m = getAccessoryMeshes()
    const paint = palette.accent
    const paintShade = shadeColor(palette.accent, -0.10)
    return [
      // Bold angled cheek stripes tucked neatly below eyes (stays clean even above full beards)
      { name: 'face_wp_l1', mesh: m.warpaintCheekBand, position: [-0.118, -0.044, -0.001], rotation: [0, 0.20, 0.14], color: paint },
      { name: 'face_wp_l2', mesh: m.warpaintCheekBand, position: [-0.128, -0.082, -0.005], rotation: [0, 0.22, 0.16], color: paintShade },
      { name: 'face_wp_r1', mesh: m.warpaintCheekBand, position: [0.118, -0.044, -0.001], rotation: [0, -0.20, -0.14], color: paint },
      { name: 'face_wp_r2', mesh: m.warpaintCheekBand, position: [0.128, -0.082, -0.005], rotation: [0, -0.22, -0.16], color: paintShade },
      // Vertical warrior temple accent above left brow
      { name: 'face_wp_brow', mesh: m.warpaintTempleStripe, position: [-0.098, 0.098, -0.002], rotation: [0, 0.08, -0.08], color: paint }
    ]
  })

  builder.registerPart('face', 'face_scar', (palette) => {
    const m = getAccessoryMeshes()
    const scarDeep = mixColor(palette.skinShade, SCAR_CRIMSON, 0.70)
    const scarEdge = mixColor(palette.skin, [0.98, 0.86, 0.84, 1], 0.45)
    return [
      { name: 'face_scar_edge', mesh: m.scarMainGash, position: [0.106, -0.004, 0.003], scale: [1.35, 1.04, 0.85], rotation: [0, -0.10, -0.28], color: scarEdge },
      { name: 'face_scar_main', mesh: m.scarMainGash, position: [0.104, -0.004, 0.005], rotation: [0, -0.10, -0.28], color: scarDeep },
      { name: 'face_scar_notch', mesh: m.scarSideNotch, position: [0.090, -0.064, 0.005], rotation: [0, -0.08, 0.85], color: scarDeep }
    ]
  })
}
