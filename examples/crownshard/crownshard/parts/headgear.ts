import {
  bakeVertexAO, bakeZoneColors, box, extrudeMesh, mixColor, octahedron, sculptLoft,
  shadeColor, tubeMesh, wedgeMesh
} from 'ridgetop'
import type { CharacterBuilder, CharacterPalette, Color, Mesh, RigPart, Vec3 } from 'ridgetop'

const WHITE: Color = [1, 1, 1, 1]

interface HeadgearMeshes {
  // 1. helm_knight_visored
  readonly knightShell: Mesh
  readonly knightBrowBand: Mesh
  readonly knightCrownRidge: Mesh
  readonly knightVisorProw: Mesh
  readonly knightVisorSlit: Mesh
  readonly knightEyeGlow: Mesh
  readonly knightHingeBoss: Mesh
  readonly knightPlumeSocket: Mesh
  readonly knightPlume: Mesh
  readonly knightGrilleSlot: Mesh

  // 2. helm_paladin_winged
  readonly paladinShell: Mesh
  readonly paladinRimTop: Mesh
  readonly paladinRimBot: Mesh
  readonly paladinBrowBar: Mesh
  readonly paladinNasalBar: Mesh
  readonly paladinVisorSlit: Mesh
  readonly paladinEyeGlow: Mesh
  readonly paladinWingMount: Mesh
  readonly paladinWingL: Mesh
  readonly paladinWingR: Mesh
  readonly paladinWingAccentL: Mesh
  readonly paladinWingAccentR: Mesh

  // 3. helm_champion_crown
  readonly crownBand: Mesh
  readonly crownLowerRim: Mesh
  readonly crownVelvetCap: Mesh
  readonly crownSpikeMain: Mesh
  readonly crownSpikeSide: Mesh
  readonly crownGemBezel: Mesh
  readonly crownGem: Mesh
  readonly crownSideStud: Mesh

  // 4. hood_ranger
  readonly rangerCrown: Mesh
  readonly rangerRearCowl: Mesh
  readonly rangerCheekL: Mesh
  readonly rangerCheekR: Mesh
  readonly rangerBrowHem: Mesh
  readonly rangerTrimL: Mesh
  readonly rangerTrimR: Mesh
  readonly rangerTail: Mesh
  readonly rangerTailTip: Mesh
  readonly rangerFeather: Mesh
  readonly rangerFeatherClasp: Mesh

  // 5. hat_wizard
  readonly wizardUnderCap: Mesh
  readonly wizardBrim: Mesh
  readonly wizardBand: Mesh
  readonly wizardSpire: Mesh
  readonly wizardRuneBezel: Mesh
  readonly wizardRuneGem: Mesh

  // 6. hat_cryo_tiara
  readonly cryoBand: Mesh
  readonly cryoBrowDip: Mesh
  readonly cryoInnerCap: Mesh
  readonly cryoSpireCenter: Mesh
  readonly cryoSpireMid: Mesh
  readonly cryoSpireSide: Mesh
  readonly cryoCenterGem: Mesh
  readonly cryoSideGem: Mesh

  // 7. hood_cleric_veil
  readonly clericCirclet: Mesh
  readonly clericHalo: Mesh
  readonly clericHaloRay: Mesh
  readonly clericSunBezel: Mesh
  readonly clericSunGem: Mesh
  readonly clericVeilCrown: Mesh
  readonly clericVeilBack: Mesh
  readonly clericVeilSideL: Mesh
  readonly clericVeilSideR: Mesh
  readonly clericVeilHem: Mesh

  // 8. cowl_rogue
  readonly rogueCrown: Mesh
  readonly rogueBrowPeak: Mesh
  readonly rogueRearCowl: Mesh
  readonly rogueCheekL: Mesh
  readonly rogueCheekR: Mesh
  readonly rogueLowerCollar: Mesh
  readonly rogueTrimBrow: Mesh
  readonly rogueTrimL: Mesh
  readonly rogueTrimR: Mesh
  readonly rogueTail: Mesh
  readonly rogueTailTip: Mesh

  // 9. helm_dark_lord
  readonly darkLordShell: Mesh
  readonly darkLordBrowBand: Mesh
  readonly darkLordJawGuard: Mesh
  readonly darkLordDorsalRidge: Mesh
  readonly darkLordBrowSpike: Mesh
  readonly darkLordSlit: Mesh
  readonly darkLordEyeGlow: Mesh
  readonly darkLordHornL: Mesh
  readonly darkLordHornR: Mesh

  // 10. helm_goblin_scrap
  readonly goblinDome: Mesh
  readonly goblinRim: Mesh
  readonly goblinStrap: Mesh
  readonly goblinStrapBuckle: Mesh
  readonly goblinChinStrap: Mesh
  readonly goblinPatchPlate: Mesh
  readonly goblinSpikeBoss: Mesh
  readonly goblinSpike: Mesh
  readonly goblinRivet: Mesh

  // 11. helm_bone_hood
  readonly boneHoodCrown: Mesh
  readonly boneHoodBrowPeak: Mesh
  readonly boneHoodRear: Mesh
  readonly boneHoodDrapeL: Mesh
  readonly boneHoodDrapeR: Mesh
  readonly boneHoodTail: Mesh
  readonly boneHoodTatter: Mesh
  readonly boneHoodGlowBrow: Mesh
  readonly boneHoodGlowSideL: Mesh
  readonly boneHoodGlowSideR: Mesh
  readonly boneHoodRuneClasp: Mesh
  readonly boneHoodBead: Mesh
}

let cachedHeadgearMeshes: HeadgearMeshes | undefined

function createMirroredExtrude(
  points: readonly (readonly [number, number])[],
  depth: number,
  mirrorX: boolean
): Mesh {
  if (!mirrorX) return extrudeMesh(points, depth)
  const mirrored: [number, number][] = []
  for (let i = 0; i < points.length; i++) {
    mirrored.push([-points[i][0], points[i][1]])
  }
  return extrudeMesh(mirrored, depth)
}

function buildHeadgearMeshes(): HeadgearMeshes {
  // -------------------------------------------------------------------------
  // 1. helm_knight_visored
  // -------------------------------------------------------------------------
  const knightShellRaw = sculptLoft([
    { y: -0.455, rx: 0.228, rz: 0.214, zOffset: -0.004, frontFlat: 0.08, backFlat: 0.06 },
    { y: -0.340, rx: 0.284, rz: 0.258, zOffset: -0.004, frontFlat: 0.08, backFlat: 0.06 },
    { y: -0.185, rx: 0.298, rz: 0.268, zOffset: -0.006, frontFlat: 0.06, backFlat: 0.06 },
    { y: -0.045, rx: 0.292, rz: 0.264, zOffset: -0.008, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.095, rx: 0.264, rz: 0.244, zOffset: -0.010 },
    { y:  0.180, rx: 0.186, rz: 0.176, zOffset: -0.012 },
    { y:  0.220, rx: 0.098, rz: 0.102, zOffset: -0.012 }
  ], { sides: 8 })
  const knightShell = bakeVertexAO(
    bakeZoneColors(knightShellRaw, (_cx, cy, _cz, _nx, ny) => {
      if (cy < -0.35) return [0.80, 0.82, 0.88, 1]
      if (ny > 0.55) return [1.08, 1.09, 1.12, 1]
      return WHITE
    }),
    { strength: 0.18, verticalGradient: 0.10 }
  )

  const knightBrowBand = sculptLoft([
    { y: -0.098, rx: 0.308, rz: 0.278, zOffset: -0.002, frontFlat: 0.06, backFlat: 0.06 },
    { y: -0.064, rx: 0.312, rz: 0.282, zOffset: -0.002, frontFlat: 0.06, backFlat: 0.06 },
    { y: -0.032, rx: 0.304, rz: 0.274, zOffset: -0.004, frontFlat: 0.06, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  // Chiseled front-to-back medial crown ridge
  const knightCrownRidge = bakeVertexAO(
    extrudeMesh([
      [-0.034, 0.06], [0.034, 0.06], [0.020, 0.256], [-0.020, 0.256]
    ], 0.44),
    { strength: 0.14, verticalGradient: 0.08 }
  )

  // Hinged angular knight visor prow (sharp central keel jutting toward +Z)
  const knightVisorProwRaw = sculptLoft([
    {
      y: -0.395,
      points: [
        [-0.215, 0.12], [0.000, 0.288], [0.215, 0.12],
        [0.165, 0.06], [-0.165, 0.06]
      ]
    },
    {
      y: -0.255,
      points: [
        [-0.256, 0.14], [0.000, 0.348], [0.256, 0.14],
        [0.180, 0.08], [-0.180, 0.08]
      ]
    },
    {
      y: -0.162,
      points: [
        [-0.252, 0.15], [0.000, 0.332], [0.252, 0.15],
        [0.180, 0.08], [-0.180, 0.08]
      ]
    }
  ])
  const knightVisorProw = bakeVertexAO(
    bakeZoneColors(knightVisorProwRaw, (_cx, cy, cz) => {
      if (cz > 0.28) return [1.08, 1.09, 1.12, 1]
      if (cy < -0.32) return [0.84, 0.86, 0.90, 1]
      return WHITE
    }),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  // Contoured recessed eye slit seated snugly within the curved visor front
  const knightVisorSlit = sculptLoft([
    { y: -0.172, rx: 0.214, rz: 0.036, zOffset: 0.228, frontFlat: 0.10 },
    { y: -0.104, rx: 0.218, rz: 0.038, zOffset: 0.230, frontFlat: 0.10 }
  ], { sides: 8 })

  const knightEyeGlow = sculptLoft([
    { y: -0.150, rx: 0.168, rz: 0.022, zOffset: 0.248, frontFlat: 0.12 },
    { y: -0.124, rx: 0.172, rz: 0.024, zOffset: 0.250, frontFlat: 0.12 }
  ], { sides: 8 })

  const knightHingeBoss = sculptLoft([
    { y: -0.040, rx: 0.042, rz: 0.042 },
    { y:  0.000, rx: 0.052, rz: 0.052 },
    { y:  0.040, rx: 0.042, rz: 0.042 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const knightPlumeSocket = sculptLoft([
    { y: 0.195, rx: 0.056, rz: 0.082, zOffset: -0.015 },
    { y: 0.275, rx: 0.042, rz: 0.064, zOffset: -0.020 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.08 })

  // Sweeping faceted crimson crest plume (+X maps to -Z backward with yaw = +PI/2!)
  const knightPlumeRaw = extrudeMesh([
    [-0.14, 0.24],
    [0.00, 0.38],
    [0.16, 0.44],
    [0.32, 0.40],
    [0.46, 0.26],
    [0.52, 0.06],
    [0.44, -0.02],
    [0.34, 0.10],
    [0.24, 0.22],
    [0.08, 0.26],
    [-0.06, 0.20]
  ], 0.092)
  const knightPlume = bakeVertexAO(
    bakeZoneColors(knightPlumeRaw, (_cx, cy) => (
      cy > 0.30 ? [1.14, 1.06, 1.04, 1] : cy < 0.16 ? [0.76, 0.72, 0.76, 1] : WHITE
    )),
    { strength: 0.16, verticalGradient: 0.10 }
  )

  const knightGrilleSlot = box

  // -------------------------------------------------------------------------
  // 2. helm_paladin_winged
  // -------------------------------------------------------------------------
  const paladinShellRaw = sculptLoft([
    { y: -0.450, rx: 0.248, rz: 0.234, zOffset: -0.004, frontFlat: 0.14, backFlat: 0.08 },
    { y: -0.320, rx: 0.292, rz: 0.264, zOffset: -0.004, frontFlat: 0.14, backFlat: 0.08 },
    { y: -0.140, rx: 0.298, rz: 0.268, zOffset: -0.006, frontFlat: 0.14, backFlat: 0.08 },
    { y:  0.085, rx: 0.288, rz: 0.260, zOffset: -0.008, frontFlat: 0.12, backFlat: 0.08 },
    { y:  0.195, rx: 0.246, rz: 0.226, zOffset: -0.010, frontFlat: 0.10 },
    { y:  0.228, rx: 0.168, rz: 0.158, zOffset: -0.010 }
  ], { sides: 8 })
  const paladinShell = bakeVertexAO(
    bakeZoneColors(paladinShellRaw, (_cx, cy, _cz, _nx, ny) => {
      if (ny > 0.55) return [1.05, 1.04, 1.02, 1]
      if (cy < -0.34) return [0.88, 0.86, 0.84, 1]
      return WHITE
    }),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const paladinRimTop = sculptLoft([
    { y: 0.142, rx: 0.296, rz: 0.268, zOffset: -0.008, frontFlat: 0.12, backFlat: 0.08 },
    { y: 0.198, rx: 0.260, rz: 0.238, zOffset: -0.010, frontFlat: 0.10 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  const paladinRimBot = sculptLoft([
    { y: -0.460, rx: 0.258, rz: 0.244, zOffset: -0.004, frontFlat: 0.14, backFlat: 0.08 },
    { y: -0.402, rx: 0.278, rz: 0.258, zOffset: -0.004, frontFlat: 0.14, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  const paladinBrowBar = sculptLoft([
    { y: -0.118, rx: 0.308, rz: 0.278, zOffset: -0.004, frontFlat: 0.12, backFlat: 0.06 },
    { y: -0.068, rx: 0.312, rz: 0.282, zOffset: -0.004, frontFlat: 0.12, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  const paladinNasalBar = sculptLoft([
    { y: -0.415, rx: 0.036, rz: 0.034, zOffset: 0.238 },
    { y: -0.220, rx: 0.044, rz: 0.040, zOffset: 0.244 },
    { y:  0.178, rx: 0.042, rz: 0.038, zOffset: 0.238 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  // Contoured recessed golden visor tucked cleanly within the ivory faceplate
  const paladinVisorSlit = sculptLoft([
    { y: -0.184, rx: 0.198, rz: 0.028, zOffset: 0.214, frontFlat: 0.14 },
    { y: -0.114, rx: 0.202, rz: 0.030, zOffset: 0.216, frontFlat: 0.14 }
  ], { sides: 8 })

  const paladinEyeGlow = sculptLoft([
    { y: -0.164, rx: 0.172, rz: 0.018, zOffset: 0.228, frontFlat: 0.14 },
    { y: -0.132, rx: 0.174, rz: 0.018, zOffset: 0.230, frontFlat: 0.14 }
  ], { sides: 8 })

  const paladinWingMount = sculptLoft([
    { y: -0.055, rx: 0.048, rz: 0.060 },
    { y:  0.000, rx: 0.062, rz: 0.074 },
    { y:  0.055, rx: 0.048, rz: 0.060 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  // Swept 3-tiered heroic golden wings (extruded in XY then yawed BACKWARD via +yaw on right, -yaw on left)
  const wingOutline: readonly (readonly [number, number])[] = [
    [0.00, -0.06],
    [0.14, -0.02],
    [0.26, 0.04],
    [0.19, 0.09],
    [0.34, 0.19],
    [0.24, 0.22],
    [0.40, 0.37],
    [0.28, 0.43],
    [0.15, 0.31],
    [0.06, 0.16],
    [-0.02, 0.04]
  ]
  const wingAccentOutline: readonly (readonly [number, number])[] = [
    [0.02, -0.01],
    [0.17, 0.09],
    [0.28, 0.29],
    [0.22, 0.33],
    [0.10, 0.17],
    [0.00, 0.05]
  ]
  const paladinWingR = bakeVertexAO(createMirroredExtrude(wingOutline, 0.052, false), { strength: 0.16, verticalGradient: 0.10 })
  const paladinWingL = bakeVertexAO(createMirroredExtrude(wingOutline, 0.052, true), { strength: 0.16, verticalGradient: 0.10 })
  const paladinWingAccentR = bakeVertexAO(createMirroredExtrude(wingAccentOutline, 0.064, false), { strength: 0.14, verticalGradient: 0.08 })
  const paladinWingAccentL = bakeVertexAO(createMirroredExtrude(wingAccentOutline, 0.064, true), { strength: 0.14, verticalGradient: 0.08 })

  // -------------------------------------------------------------------------
  // 3. helm_champion_crown
  // -------------------------------------------------------------------------
  const crownBandRaw = sculptLoft([
    { y: -0.050, rx: 0.266, rz: 0.242, zOffset: 0.002, frontFlat: 0.08, backFlat: 0.06 },
    { y:  0.005, rx: 0.274, rz: 0.250, zOffset: 0.000, frontFlat: 0.08, backFlat: 0.06 },
    { y:  0.072, rx: 0.284, rz: 0.260, zOffset: -0.002, frontFlat: 0.08, backFlat: 0.06 },
    { y:  0.100, rx: 0.272, rz: 0.248, zOffset: -0.002, frontFlat: 0.08, backFlat: 0.06 }
  ], { sides: 8 })
  const crownBand = bakeVertexAO(
    bakeZoneColors(crownBandRaw, (_cx, cy) => (
      cy < -0.015 ? [0.84, 0.80, 0.76, 1] : cy > 0.055 ? [1.10, 1.07, 1.00, 1] : WHITE
    )),
    { strength: 0.15, verticalGradient: 0.08 }
  )

  const crownLowerRim = sculptLoft([
    { y: -0.062, rx: 0.274, rz: 0.250, zOffset: 0.002, frontFlat: 0.08, backFlat: 0.06 },
    { y: -0.036, rx: 0.278, rz: 0.254, zOffset: 0.002, frontFlat: 0.08, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  // Regal crimson velvet cap seated inside the crown band (covers skull top y=+0.155 cleanly!)
  const crownVelvetCap = sculptLoft([
    { y: 0.015, rx: 0.252, rz: 0.228, zOffset: -0.004 },
    { y: 0.115, rx: 0.236, rz: 0.214, zOffset: -0.008 },
    { y: 0.176, rx: 0.168, rz: 0.156, zOffset: -0.010 },
    { y: 0.198, rx: 0.088, rz: 0.084, zOffset: -0.012 }
  ], { sides: 8, aoStrength: 0.18, aoGradient: 0.12 })

  const crownSpikeMain = sculptLoft([
    { y: 0.000, rx: 0.068, rz: 0.038 },
    { y: 0.130, rx: 0.048, rz: 0.028 },
    { y: 0.265, rx: 0.008, rz: 0.008 }
  ], { sides: 4, aoStrength: 0.14, aoGradient: 0.08 })

  const crownSpikeSide = sculptLoft([
    { y: 0.000, rx: 0.054, rz: 0.030 },
    { y: 0.092, rx: 0.036, rz: 0.022 },
    { y: 0.180, rx: 0.007, rz: 0.007 }
  ], { sides: 4, aoStrength: 0.14, aoGradient: 0.08 })

  const crownGemBezel = sculptLoft([
    { y: -0.058, rx: 0.052, rz: 0.028 },
    { y:  0.000, rx: 0.070, rz: 0.034 },
    { y:  0.058, rx: 0.052, rz: 0.028 }
  ], { sides: 6, aoStrength: 0.14, aoGradient: 0.06 })

  const crownGem = sculptLoft([
    { y: -0.044, rx: 0.012, rz: 0.014 },
    { y:  0.000, rx: 0.044, rz: 0.030 },
    { y:  0.044, rx: 0.012, rz: 0.014 }
  ], { sides: 6 })

  const crownSideStud = octahedron

  // -------------------------------------------------------------------------
  // 4. hood_ranger
  // -------------------------------------------------------------------------
  const rangerCrownRaw = sculptLoft([
    { y: -0.086, rx: 0.288, rz: 0.260, zOffset: -0.010, frontFlat: 0.08, backFlat: 0.06 },
    { y:  0.022, rx: 0.296, rz: 0.268, zOffset: -0.014, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.132, rx: 0.258, rz: 0.244, zOffset: -0.024 },
    { y:  0.208, rx: 0.172, rz: 0.184, zOffset: -0.046 },
    { y:  0.238, rx: 0.086, rz: 0.112, zOffset: -0.066 }
  ], { sides: 8 })
  const rangerCrown = bakeVertexAO(
    bakeZoneColors(rangerCrownRaw, (_cx, cy, _cz, _nx, ny) => {
      if (ny > 0.50) return [1.08, 1.10, 1.05, 1]
      if (cy < -0.03) return [0.88, 0.90, 0.88, 1]
      return WHITE
    }),
    { strength: 0.16, verticalGradient: 0.10 }
  )

  // Rear hood cowl enveloping back of skull & nape cleanly without touching front face
  const rangerRearCowl = sculptLoft([
    { y: -0.445, rx: 0.272, rz: 0.134, zOffset: -0.142, backFlat: 0.08 },
    { y: -0.280, rx: 0.294, rz: 0.148, zOffset: -0.136, backFlat: 0.06 },
    { y: -0.110, rx: 0.296, rz: 0.154, zOffset: -0.130, backFlat: 0.06 },
    { y:  0.045, rx: 0.286, rz: 0.150, zOffset: -0.128, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.18, aoGradient: 0.10 })

  // Contoured side drapes hugging the cheeks neatly without jutting forward
  const createHoodCheek = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.415, rx: 0.044, rz: 0.110, xOffset: side * 0.224, zOffset: 0.020 },
    { y: -0.265, rx: 0.054, rz: 0.146, xOffset: side * 0.252, zOffset: 0.022 },
    { y: -0.115, rx: 0.056, rz: 0.158, xOffset: side * 0.258, zOffset: 0.024 },
    { y: -0.030, rx: 0.050, rz: 0.146, xOffset: side * 0.250, zOffset: 0.018 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const rangerCheekL = createHoodCheek(-1)
  const rangerCheekR = createHoodCheek(1)

  // Gold brow hem tucked neatly onto the forehead lip (peaked subtly at center brow, above eyes!)
  const rangerBrowHem = sculptLoft([
    { y: -0.094, rx: 0.244, rz: 0.038, zOffset: 0.200, frontFlat: 0.14 },
    { y: -0.064, rx: 0.264, rz: 0.044, zOffset: 0.206, frontFlat: 0.12 },
    { y: -0.038, rx: 0.262, rz: 0.040, zOffset: 0.198, frontFlat: 0.12 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  // Tight gold cheek trim tracing the contoured hood edge
  const createHoodTrim = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.405, rx: 0.018, rz: 0.024, xOffset: side * 0.214, zOffset: 0.128 },
    { y: -0.245, rx: 0.022, rz: 0.028, xOffset: side * 0.240, zOffset: 0.166 },
    { y: -0.082, rx: 0.024, rz: 0.030, xOffset: side * 0.246, zOffset: 0.180 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const rangerTrimL = createHoodTrim(-1)
  const rangerTrimR = createHoodTrim(1)

  // Pointed rear hood tail extending back & drooping gracefully
  const rangerTail = bakeVertexAO(
    tubeMesh(
      [
        [0, 0.145, -0.155],
        [0, 0.120, -0.275],
        [0, 0.045, -0.405],
        [0, -0.055, -0.510]
      ],
      [0.145, 0.118, 0.068, 0.018],
      6
    ),
    { strength: 0.16, verticalGradient: 0.10 }
  )

  const rangerTailTip = sculptLoft([
    { y: -0.095, rx: 0.010, rz: 0.010, zOffset: -0.530 },
    { y: -0.052, rx: 0.026, rz: 0.026, zOffset: -0.506 },
    { y: -0.030, rx: 0.016, rz: 0.016, zOffset: -0.492 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  // Jaunty golden feather sweeping out & back from right temple
  const rangerFeatherRaw = extrudeMesh([
    [0.00, 0.00],
    [0.06, 0.08],
    [0.15, 0.22],
    [0.11, 0.25],
    [0.21, 0.40],
    [0.15, 0.46],
    [0.05, 0.35],
    [0.08, 0.30],
    [0.01, 0.18],
    [-0.02, 0.05]
  ], 0.034)
  const rangerFeather = bakeVertexAO(
    bakeZoneColors(rangerFeatherRaw, (_cx, cy) => (
      cy > 0.26 ? [1.10, 1.06, 0.96, 1] : WHITE
    )),
    { strength: 0.12, verticalGradient: 0.06 }
  )

  const rangerFeatherClasp = sculptLoft([
    { y: -0.028, rx: 0.032, rz: 0.032 },
    { y:  0.000, rx: 0.040, rz: 0.040 },
    { y:  0.028, rx: 0.032, rz: 0.032 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  // -------------------------------------------------------------------------
  // 5. hat_wizard
  // -------------------------------------------------------------------------
  const wizardUnderCap = sculptLoft([
    { y: -0.055, rx: 0.270, rz: 0.244, zOffset: -0.004, frontFlat: 0.08, backFlat: 0.06 },
    { y:  0.050, rx: 0.274, rz: 0.248, zOffset: -0.006 },
    { y:  0.155, rx: 0.225, rz: 0.206, zOffset: -0.010 }
  ], { sides: 8, aoStrength: 0.18, aoGradient: 0.10 })

  const wizardBrimRaw = sculptLoft([
    { y: -0.022, rx: 0.568, rz: 0.542, zOffset: -0.012 },
    { y:  0.018, rx: 0.586, rz: 0.560, zOffset: -0.012 },
    { y:  0.048, rx: 0.448, rz: 0.430, zOffset: -0.010 },
    { y:  0.062, rx: 0.286, rz: 0.266, zOffset: -0.006 }
  ], { sides: 8 })
  const wizardBrim = bakeVertexAO(
    bakeZoneColors(wizardBrimRaw, (_cx, _cy, _cz, _nx, ny) => (
      ny < -0.25 ? [0.74, 0.72, 0.82, 1] : ny > 0.4 ? [1.10, 1.08, 1.15, 1] : WHITE
    )),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const wizardBand = sculptLoft([
    { y: 0.042, rx: 0.298, rz: 0.276, zOffset: -0.006 },
    { y: 0.088, rx: 0.292, rz: 0.270, zOffset: -0.008 },
    { y: 0.128, rx: 0.274, rz: 0.254, zOffset: -0.010 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  // Expressive crooked witch/wizard spire with bold kink & bent drooping tip (stays cleanly inside camera frame!)
  const wizardSpireRaw = sculptLoft([
    { y: 0.046, rx: 0.284, rz: 0.264, xOffset: 0.000, zOffset: -0.006 },
    { y: 0.195, rx: 0.236, rz: 0.220, xOffset: 0.014, zOffset: -0.022 },
    { y: 0.345, rx: 0.164, rz: 0.158, xOffset: 0.056, zOffset: -0.064 },
    { y: 0.475, rx: 0.102, rz: 0.102, xOffset: 0.132, zOffset: -0.142 },
    { y: 0.560, rx: 0.054, rz: 0.056, xOffset: 0.228, zOffset: -0.252 },
    { y: 0.518, rx: 0.016, rz: 0.018, xOffset: 0.308, zOffset: -0.354 }
  ], { sides: 7 })
  const wizardSpire = bakeVertexAO(
    bakeZoneColors(wizardSpireRaw, (_cx, cy) => (
      cy > 0.42 ? [1.12, 1.10, 1.18, 1] : WHITE
    )),
    { strength: 0.16, verticalGradient: 0.10 }
  )

  const wizardRuneBezel = sculptLoft([
    { y: -0.058, rx: 0.044, rz: 0.024 },
    { y:  0.000, rx: 0.064, rz: 0.032 },
    { y:  0.058, rx: 0.044, rz: 0.024 }
  ], { sides: 4, aoStrength: 0.14, aoGradient: 0.06 })

  const wizardRuneGem = sculptLoft([
    { y: -0.046, rx: 0.010, rz: 0.012 },
    { y:  0.000, rx: 0.040, rz: 0.028 },
    { y:  0.046, rx: 0.010, rz: 0.012 }
  ], { sides: 4 })

  // -------------------------------------------------------------------------
  // 6. hat_cryo_tiara
  // -------------------------------------------------------------------------
  const cryoBand = sculptLoft([
    { y: -0.058, rx: 0.268, rz: 0.244, zOffset: 0.000, frontFlat: 0.08, backFlat: 0.06 },
    { y: -0.006, rx: 0.278, rz: 0.254, zOffset: -0.002, frontFlat: 0.08, backFlat: 0.06 },
    { y:  0.042, rx: 0.270, rz: 0.246, zOffset: -0.004, frontFlat: 0.08, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  const cryoBrowDip = sculptLoft([
    { y: -0.098, rx: 0.014, rz: 0.014, zOffset: 0.244 },
    { y: -0.044, rx: 0.068, rz: 0.030, zOffset: 0.240 },
    { y:  0.036, rx: 0.078, rz: 0.034, zOffset: 0.236 }
  ], { sides: 4, aoStrength: 0.12, aoGradient: 0.06 })

  // Frosted blue-silver skull cap seated inside the tiara so top skull is cloaked cleanly
  const cryoInnerCap = sculptLoft([
    { y: 0.010, rx: 0.256, rz: 0.234, zOffset: -0.006 },
    { y: 0.115, rx: 0.238, rz: 0.216, zOffset: -0.010 },
    { y: 0.180, rx: 0.172, rz: 0.160, zOffset: -0.012 },
    { y: 0.208, rx: 0.092, rz: 0.088, zOffset: -0.014 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.10 })

  const makeIceSpire = (height: number, radius: number): Mesh => {
    const raw = sculptLoft([
      { y: 0.000, rx: radius, rz: radius * 0.72 },
      { y: height * 0.34, rx: radius * 1.18, rz: radius * 0.84 },
      { y: height * 0.72, rx: radius * 0.62, rz: radius * 0.48 },
      { y: height, rx: 0.006, rz: 0.006 }
    ], { sides: 5 })
    return bakeVertexAO(
      bakeZoneColors(raw, (_cx, cy) => (
        cy > height * 0.58 ? [1.20, 1.22, 1.26, 1] : cy < height * 0.25 ? [0.84, 0.90, 0.98, 1] : WHITE
      )),
      { strength: 0.14, verticalGradient: 0.08 }
    )
  }

  const cryoSpireCenter = makeIceSpire(0.42, 0.056)
  const cryoSpireMid = makeIceSpire(0.32, 0.044)
  const cryoSpireSide = makeIceSpire(0.24, 0.036)

  const cryoCenterGem = sculptLoft([
    { y: -0.092, rx: 0.010, rz: 0.010 },
    { y: -0.018, rx: 0.052, rz: 0.036 },
    { y:  0.048, rx: 0.046, rz: 0.032 },
    { y:  0.118, rx: 0.008, rz: 0.008 }
  ], { sides: 6 })

  const cryoSideGem = sculptLoft([
    { y: -0.036, rx: 0.008, rz: 0.008 },
    { y:  0.000, rx: 0.026, rz: 0.020 },
    { y:  0.036, rx: 0.008, rz: 0.008 }
  ], { sides: 4 })

  // -------------------------------------------------------------------------
  // 7. hood_cleric_veil
  // -------------------------------------------------------------------------
  const clericCirclet = sculptLoft([
    { y: -0.052, rx: 0.270, rz: 0.246, zOffset: 0.000, frontFlat: 0.08, backFlat: 0.06 },
    { y: -0.014, rx: 0.280, rz: 0.254, zOffset: -0.002, frontFlat: 0.08, backFlat: 0.06 },
    { y:  0.022, rx: 0.274, rz: 0.248, zOffset: -0.004, frontFlat: 0.08, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  // Royal golden halo arch framing the crown behind the head
  const clericHalo = bakeVertexAO(
    tubeMesh(
      [
        [-0.31, -0.02, -0.04],
        [-0.34,  0.14, -0.06],
        [-0.24,  0.29, -0.08],
        [ 0.00,  0.36, -0.09],
        [ 0.24,  0.29, -0.08],
        [ 0.34,  0.14, -0.06],
        [ 0.31, -0.02, -0.04]
      ],
      [0.026, 0.032, 0.036, 0.040, 0.036, 0.032, 0.026],
      6
    ),
    { strength: 0.12, verticalGradient: 0.06 }
  )

  const clericHaloRay = sculptLoft([
    { y: 0.000, rx: 0.026, rz: 0.016 },
    { y: 0.095, rx: 0.006, rz: 0.006 }
  ], { sides: 4, aoStrength: 0.10, aoGradient: 0.06 })

  const clericSunBezel = sculptLoft([
    { y: -0.052, rx: 0.048, rz: 0.026 },
    { y:  0.000, rx: 0.064, rz: 0.032 },
    { y:  0.052, rx: 0.048, rz: 0.026 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const clericSunGem = sculptLoft([
    { y: -0.036, rx: 0.012, rz: 0.012 },
    { y:  0.000, rx: 0.040, rz: 0.028 },
    { y:  0.036, rx: 0.012, rz: 0.012 }
  ], { sides: 6 })

  const clericVeilCrown = sculptLoft([
    { y: -0.020, rx: 0.276, rz: 0.252, zOffset: -0.012, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.088, rx: 0.264, rz: 0.244, zOffset: -0.016 },
    { y:  0.176, rx: 0.194, rz: 0.184, zOffset: -0.020 },
    { y:  0.204, rx: 0.104, rz: 0.100, zOffset: -0.022 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  // Graceful pleated ivory veil cascading down behind the head and shoulders
  const clericVeilBackRaw = sculptLoft([
    { y: -0.520, rx: 0.312, rz: 0.096, zOffset: -0.190, backFlat: 0.08 },
    { y: -0.350, rx: 0.298, rz: 0.118, zOffset: -0.168, backFlat: 0.08 },
    { y: -0.160, rx: 0.288, rz: 0.136, zOffset: -0.146, backFlat: 0.06 },
    { y:  0.040, rx: 0.278, rz: 0.144, zOffset: -0.130, backFlat: 0.06 }
  ], { sides: 8 })
  const clericVeilBack = bakeVertexAO(
    bakeZoneColors(clericVeilBackRaw, (cx, cy) => {
      if (cy < -0.44) return [0.92, 0.90, 0.88, 1]
      if (Math.abs(cx) > 0.18) return [0.95, 0.94, 0.92, 1]
      return WHITE
    }),
    { strength: 0.16, verticalGradient: 0.10 }
  )

  // Seamless side veil drapes overlapping cleanly into the rear veil with zero side seam
  const createVeilSide = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.475, rx: 0.046, rz: 0.138, xOffset: side * 0.262, zOffset: -0.086 },
    { y: -0.265, rx: 0.050, rz: 0.154, xOffset: side * 0.268, zOffset: -0.062 },
    { y: -0.040, rx: 0.052, rz: 0.156, xOffset: side * 0.264, zOffset: -0.040 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.08 })

  const clericVeilSideL = createVeilSide(-1)
  const clericVeilSideR = createVeilSide(1)

  const clericVeilHem = sculptLoft([
    { y: -0.532, rx: 0.318, rz: 0.102, zOffset: -0.192, backFlat: 0.08 },
    { y: -0.494, rx: 0.314, rz: 0.098, zOffset: -0.188, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.14, aoGradient: 0.06 })

  // -------------------------------------------------------------------------
  // 8. cowl_rogue
  // -------------------------------------------------------------------------
  const rogueCrownRaw = sculptLoft([
    { y: -0.085, rx: 0.286, rz: 0.260, zOffset: -0.012, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.030, rx: 0.292, rz: 0.266, zOffset: -0.016, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.145, rx: 0.244, rz: 0.236, zOffset: -0.030 },
    { y:  0.220, rx: 0.150, rz: 0.172, zOffset: -0.058 },
    { y:  0.252, rx: 0.068, rz: 0.098, zOffset: -0.086 }
  ], { sides: 8 })
  const rogueCrown = bakeVertexAO(
    bakeZoneColors(rogueCrownRaw, (_cx, _cy, _cz, _nx, ny) => (
      ny > 0.50 ? [1.22, 1.20, 1.28, 1] : WHITE
    )),
    { strength: 0.18, verticalGradient: 0.10 }
  )

  // Sharp predatory assassin brow beak overhanging center forehead (clears eyes at y=-0.151!)
  const rogueBrowPeak = sculptLoft([
    { y: -0.114, rx: 0.032, rz: 0.024, zOffset: 0.232 },
    { y: -0.064, rx: 0.176, rz: 0.044, zOffset: 0.214, frontFlat: 0.10 },
    { y: -0.012, rx: 0.236, rz: 0.048, zOffset: 0.196, frontFlat: 0.10 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const rogueRearCowl = sculptLoft([
    { y: -0.450, rx: 0.262, rz: 0.130, zOffset: -0.142, backFlat: 0.08 },
    { y: -0.270, rx: 0.288, rz: 0.148, zOffset: -0.136, backFlat: 0.06 },
    { y: -0.090, rx: 0.292, rz: 0.154, zOffset: -0.130, backFlat: 0.06 },
    { y:  0.050, rx: 0.282, rz: 0.150, zOffset: -0.126, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.18, aoGradient: 0.10 })

  const createRogueCheek = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.420, rx: 0.042, rz: 0.108, xOffset: side * 0.220, zOffset: 0.022 },
    { y: -0.255, rx: 0.052, rz: 0.146, xOffset: side * 0.248, zOffset: 0.026 },
    { y: -0.095, rx: 0.054, rz: 0.160, xOffset: side * 0.254, zOffset: 0.028 },
    { y: -0.025, rx: 0.046, rz: 0.144, xOffset: side * 0.246, zOffset: 0.018 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const rogueCheekL = createRogueCheek(-1)
  const rogueCheekR = createRogueCheek(1)

  const rogueLowerCollar = sculptLoft([
    { y: -0.470, rx: 0.238, rz: 0.214, zOffset: 0.000, frontFlat: 0.10, backFlat: 0.08 },
    { y: -0.398, rx: 0.246, rz: 0.220, zOffset: 0.004, frontFlat: 0.10, backFlat: 0.08 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  // Sleek crimson brow trim hugged cleanly to the peaked hood opening
  const rogueTrimBrow = sculptLoft([
    { y: -0.118, rx: 0.036, rz: 0.016, zOffset: 0.238 },
    { y: -0.082, rx: 0.222, rz: 0.028, zOffset: 0.210, frontFlat: 0.12 },
    { y: -0.058, rx: 0.254, rz: 0.028, zOffset: 0.198, frontFlat: 0.12 }
  ], { sides: 8, aoStrength: 0.12, aoGradient: 0.06 })

  const createRogueTrim = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.405, rx: 0.016, rz: 0.022, xOffset: side * 0.210, zOffset: 0.130 },
    { y: -0.240, rx: 0.020, rz: 0.026, xOffset: side * 0.238, zOffset: 0.168 },
    { y: -0.080, rx: 0.022, rz: 0.026, xOffset: side * 0.246, zOffset: 0.184 }
  ], { sides: 6, aoStrength: 0.12, aoGradient: 0.06 })

  const rogueTrimL = createRogueTrim(-1)
  const rogueTrimR = createRogueTrim(1)

  const rogueTail = bakeVertexAO(
    tubeMesh(
      [
        [0, 0.165, -0.150],
        [0, 0.145, -0.285],
        [0, 0.082, -0.425],
        [0, -0.015, -0.535]
      ],
      [0.132, 0.102, 0.056, 0.016],
      5
    ),
    { strength: 0.18, verticalGradient: 0.10 }
  )

  const rogueTailTip = sculptLoft([
    { y: -0.036, rx: 0.008, rz: 0.008, zOffset: -0.556 },
    { y: -0.008, rx: 0.024, rz: 0.024, zOffset: -0.526 },
    { y:  0.016, rx: 0.018, rz: 0.018, zOffset: -0.506 }
  ], { sides: 5 })

  // -------------------------------------------------------------------------
  // 9. helm_dark_lord
  // -------------------------------------------------------------------------
  const darkLordShellRaw = sculptLoft([
    { y: -0.460, rx: 0.242, rz: 0.228, zOffset: -0.004, frontFlat: 0.06, backFlat: 0.08 },
    { y: -0.325, rx: 0.296, rz: 0.268, zOffset: -0.004, frontFlat: 0.04, backFlat: 0.08 },
    { y: -0.155, rx: 0.304, rz: 0.274, zOffset: -0.006, frontFlat: 0.04, backFlat: 0.08 },
    { y:  0.035, rx: 0.294, rz: 0.266, zOffset: -0.008, frontFlat: 0.04, backFlat: 0.08 },
    { y:  0.165, rx: 0.236, rz: 0.220, zOffset: -0.012 },
    { y:  0.232, rx: 0.128, rz: 0.132, zOffset: -0.014 }
  ], { sides: 8 })
  const darkLordShell = bakeVertexAO(
    bakeZoneColors(darkLordShellRaw, (_cx, cy, _cz, _nx, ny) => {
      if (ny > 0.45) return [1.32, 1.28, 1.44, 1]
      if (cy < -0.34) return [0.76, 0.74, 0.84, 1]
      return WHITE
    }),
    { strength: 0.18, verticalGradient: 0.10 }
  )

  // Steel-violet angular brow ridge separating crown & visor
  const darkLordBrowBand = sculptLoft([
    { y: -0.108, rx: 0.312, rz: 0.282, zOffset: -0.004, frontFlat: 0.04, backFlat: 0.06 },
    { y: -0.062, rx: 0.318, rz: 0.286, zOffset: -0.004, frontFlat: 0.04, backFlat: 0.06 },
    { y: -0.032, rx: 0.306, rz: 0.276, zOffset: -0.006, frontFlat: 0.04, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.08 })

  // Angular jutting warlord face-keel / jaw guard
  const darkLordJawGuard = sculptLoft([
    {
      y: -0.455,
      points: [
        [-0.210, 0.12], [0.000, 0.300], [0.210, 0.12],
        [0.150, 0.06], [-0.150, 0.06]
      ]
    },
    {
      y: -0.260,
      points: [
        [-0.258, 0.14], [0.000, 0.342], [0.258, 0.14],
        [0.175, 0.08], [-0.175, 0.08]
      ]
    },
    {
      y: -0.182,
      points: [
        [-0.248, 0.15], [0.000, 0.326], [0.248, 0.15],
        [0.175, 0.08], [-0.175, 0.08]
      ]
    }
  ], { aoStrength: 0.16, aoGradient: 0.08 })

  // Razor-sharp obsidian crown dorsal ridge (+X maps to -Z backward with yaw = +PI/2!)
  const darkLordDorsalRidge = bakeVertexAO(
    // Clean convex swept keel hugging the crown (no jagged notches jutting off the back)
    extrudeMesh([
      [-0.16, 0.12],
      [-0.08, 0.27],
      [ 0.06, 0.32],
      [ 0.18, 0.25],
      [ 0.22, 0.12],
      [ 0.14, 0.06]
    ], 0.046),
    { strength: 0.16, verticalGradient: 0.08 }
  )

  const darkLordBrowSpike = sculptLoft([
    { y: 0.000, rx: 0.048, rz: 0.036 },
    { y: 0.115, rx: 0.030, rz: 0.022 },
    { y: 0.220, rx: 0.007, rz: 0.007 }
  ], { sides: 4, aoStrength: 0.14, aoGradient: 0.08 })

  // Contoured recessed eye slit seated snugly inside the obsidian brow
  const darkLordSlit = sculptLoft([
    { y: -0.182, rx: 0.214, rz: 0.032, zOffset: 0.236, frontFlat: 0.10 },
    { y: -0.114, rx: 0.218, rz: 0.034, zOffset: 0.238, frontFlat: 0.10 }
  ], { sides: 8 })

  const darkLordEyeGlow = sculptLoft([
    { y: -0.018, rx: 0.064, rz: 0.014 },
    { y:  0.000, rx: 0.072, rz: 0.018 },
    { y:  0.016, rx: 0.058, rz: 0.012 }
  ], { sides: 4 })

  const createWarlordHorn = (side: -1 | 1): Mesh => {
    const pts: readonly Vec3[] = [
      [side * 0.24, 0.04, -0.01],
      [side * 0.39, 0.08,  0.04],
      [side * 0.49, 0.22,  0.09],
      [side * 0.47, 0.37,  0.14],
      [side * 0.36, 0.49,  0.17]
    ]
    const raw = tubeMesh(pts, [0.074, 0.062, 0.048, 0.030, 0.010], 5)
    return bakeVertexAO(
      bakeZoneColors(raw, (_cx, cy) => {
        if (cy > 0.34) return [1.85, 1.68, 2.05, 1]
        if (cy > 0.18) return [1.38, 1.28, 1.54, 1]
        return WHITE
      }),
      { strength: 0.16, verticalGradient: 0.08 }
    )
  }

  const darkLordHornL = createWarlordHorn(-1)
  const darkLordHornR = createWarlordHorn(1)

  // -------------------------------------------------------------------------
  // 10. helm_goblin_scrap
  // -------------------------------------------------------------------------
  const goblinDomeRaw = sculptLoft([
    { y: -0.068, rx: 0.284, rz: 0.262, zOffset: -0.004, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.028, rx: 0.280, rz: 0.258, zOffset: -0.006, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.132, rx: 0.232, rz: 0.218, zOffset: -0.010 },
    { y:  0.194, rx: 0.148, rz: 0.142, zOffset: -0.012 },
    { y:  0.218, rx: 0.074, rz: 0.072, zOffset: -0.012 }
  ], { sides: 8 })
  const goblinDome = bakeVertexAO(
    bakeZoneColors(goblinDomeRaw, (cx, cy, cz) => {
      if (cx > 0.08 && cy > 0.04 && cz > 0.02) return [0.82, 0.64, 0.56, 1]
      if (cx < -0.10 && cy < 0.05) return [0.76, 0.78, 0.80, 1]
      if (cy > 0.14) return [1.10, 1.08, 1.04, 1]
      return WHITE
    }),
    { strength: 0.18, verticalGradient: 0.10 }
  )

  const goblinRim = sculptLoft([
    { y: -0.086, rx: 0.314, rz: 0.288, zOffset: -0.004, frontFlat: 0.06, backFlat: 0.06 },
    { y: -0.052, rx: 0.308, rz: 0.282, zOffset: -0.004, frontFlat: 0.06, backFlat: 0.06 },
    { y: -0.036, rx: 0.286, rz: 0.264, zOffset: -0.004, frontFlat: 0.06, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.16, aoGradient: 0.08 })

  const goblinStrap = sculptLoft([
    { y: -0.036, rx: 0.296, rz: 0.272, zOffset: -0.004, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.018, rx: 0.294, rz: 0.270, zOffset: -0.006, frontFlat: 0.06, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.15, aoGradient: 0.06 })

  const goblinStrapBuckle = sculptLoft([
    { y: -0.038, rx: 0.044, rz: 0.024 },
    { y:  0.000, rx: 0.052, rz: 0.026 },
    { y:  0.038, rx: 0.044, rz: 0.024 }
  ], { sides: 4, aoStrength: 0.12, aoGradient: 0.06 })

  const goblinChinStrap = sculptLoft([
    { y: -0.340, rx: 0.020, rz: 0.034 },
    { y: -0.200, rx: 0.022, rz: 0.038 },
    { y: -0.060, rx: 0.024, rz: 0.040 }
  ], { sides: 4, aoStrength: 0.14, aoGradient: 0.06 })

  const goblinPatchPlate = bakeVertexAO(wedgeMesh(), { strength: 0.14, verticalGradient: 0.08 })

  const goblinSpikeBoss = sculptLoft([
    { y: 0.000, rx: 0.078, rz: 0.078 },
    { y: 0.040, rx: 0.062, rz: 0.062 }
  ], { sides: 6, aoStrength: 0.15, aoGradient: 0.06 })

  const goblinSpike = sculptLoft([
    { y: 0.000, rx: 0.048, rz: 0.048 },
    { y: 0.120, rx: 0.032, rz: 0.032 },
    { y: 0.260, rx: 0.007, rz: 0.007 }
  ], { sides: 5, aoStrength: 0.14, aoGradient: 0.08 })

  const goblinRivet = octahedron

  // -------------------------------------------------------------------------
  // 11. helm_bone_hood
  // -------------------------------------------------------------------------
  const boneHoodCrownRaw = sculptLoft([
    { y: -0.084, rx: 0.298, rz: 0.274, zOffset: -0.012, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.036, rx: 0.304, rz: 0.280, zOffset: -0.016, frontFlat: 0.06, backFlat: 0.06 },
    { y:  0.152, rx: 0.260, rz: 0.250, zOffset: -0.028 },
    { y:  0.228, rx: 0.168, rz: 0.188, zOffset: -0.054 },
    { y:  0.262, rx: 0.078, rz: 0.112, zOffset: -0.078 }
  ], { sides: 8 })
  const boneHoodCrown = bakeVertexAO(
    bakeZoneColors(boneHoodCrownRaw, (_cx, _cy, _cz, _nx, ny) => (
      ny > 0.45 ? [1.28, 1.24, 1.38, 1] : WHITE
    )),
    { strength: 0.18, verticalGradient: 0.10 }
  )

  const boneHoodBrowPeak = sculptLoft([
    { y: -0.114, rx: 0.036, rz: 0.024, zOffset: 0.238 },
    { y: -0.064, rx: 0.194, rz: 0.044, zOffset: 0.218, frontFlat: 0.10 },
    { y: -0.010, rx: 0.248, rz: 0.050, zOffset: 0.198, frontFlat: 0.10 }
  ], { sides: 6, aoStrength: 0.16, aoGradient: 0.08 })

  const boneHoodRear = sculptLoft([
    { y: -0.490, rx: 0.294, rz: 0.134, zOffset: -0.156, backFlat: 0.08 },
    { y: -0.300, rx: 0.302, rz: 0.156, zOffset: -0.144, backFlat: 0.06 },
    { y: -0.100, rx: 0.304, rz: 0.164, zOffset: -0.136, backFlat: 0.06 },
    { y:  0.050, rx: 0.296, rz: 0.158, zOffset: -0.132, backFlat: 0.06 }
  ], { sides: 8, aoStrength: 0.18, aoGradient: 0.10 })

  const createRaggedDrape = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.485, rx: 0.032, rz: 0.076, xOffset: side * 0.212, zOffset: 0.016 },
    { y: -0.355, rx: 0.056, rz: 0.128, xOffset: side * 0.248, zOffset: 0.028 },
    { y: -0.210, rx: 0.062, rz: 0.162, xOffset: side * 0.264, zOffset: 0.034 },
    { y: -0.070, rx: 0.060, rz: 0.172, xOffset: side * 0.266, zOffset: 0.036 },
    { y:  0.005, rx: 0.052, rz: 0.154, xOffset: side * 0.258, zOffset: 0.026 }
  ], { sides: 6, aoStrength: 0.18, aoGradient: 0.10 })

  const boneHoodDrapeL = createRaggedDrape(-1)
  const boneHoodDrapeR = createRaggedDrape(1)

  const boneHoodTail = bakeVertexAO(
    tubeMesh(
      [
        [0, 0.170, -0.158],
        [0, 0.135, -0.290],
        [0, 0.035, -0.430],
        [0, -0.110, -0.535]
      ],
      [0.148, 0.118, 0.066, 0.018],
      5
    ),
    { strength: 0.18, verticalGradient: 0.10 }
  )

  // Ragged hanging lower cloth tatters along the rear hem
  const boneHoodTatter = sculptLoft([
    { y: -0.120, rx: 0.008, rz: 0.008 },
    { y: -0.030, rx: 0.044, rz: 0.024 },
    { y:  0.040, rx: 0.056, rz: 0.028 }
  ], { sides: 4, aoStrength: 0.16, aoGradient: 0.08 })

  // Eerie glowing spectral trim tucked cleanly along the peaked brow & contoured cowl edge
  const boneHoodGlowBrow = sculptLoft([
    { y: -0.116, rx: 0.038, rz: 0.016, zOffset: 0.244 },
    { y: -0.080, rx: 0.232, rz: 0.028, zOffset: 0.214, frontFlat: 0.12 },
    { y: -0.056, rx: 0.262, rz: 0.028, zOffset: 0.202, frontFlat: 0.12 }
  ], { sides: 8 })

  const createBoneGlowSide = (side: -1 | 1): Mesh => sculptLoft([
    { y: -0.445, rx: 0.014, rz: 0.020, xOffset: side * 0.210, zOffset: 0.098 },
    { y: -0.255, rx: 0.018, rz: 0.024, xOffset: side * 0.250, zOffset: 0.174 },
    { y: -0.072, rx: 0.020, rz: 0.026, xOffset: side * 0.258, zOffset: 0.192 }
  ], { sides: 5 })

  const boneHoodGlowSideL = createBoneGlowSide(-1)
  const boneHoodGlowSideR = createBoneGlowSide(1)

  const boneHoodRuneClasp = sculptLoft([
    { y: -0.042, rx: 0.012, rz: 0.014 },
    { y:  0.000, rx: 0.036, rz: 0.024 },
    { y:  0.042, rx: 0.012, rz: 0.014 }
  ], { sides: 4 })

  const boneHoodBead = octahedron

  return {
    knightShell,
    knightBrowBand,
    knightCrownRidge,
    knightVisorProw,
    knightVisorSlit,
    knightEyeGlow,
    knightHingeBoss,
    knightPlumeSocket,
    knightPlume,
    knightGrilleSlot,

    paladinShell,
    paladinRimTop,
    paladinRimBot,
    paladinBrowBar,
    paladinNasalBar,
    paladinVisorSlit,
    paladinEyeGlow,
    paladinWingMount,
    paladinWingL,
    paladinWingR,
    paladinWingAccentL,
    paladinWingAccentR,

    crownBand,
    crownLowerRim,
    crownVelvetCap,
    crownSpikeMain,
    crownSpikeSide,
    crownGemBezel,
    crownGem,
    crownSideStud,

    rangerCrown,
    rangerRearCowl,
    rangerCheekL,
    rangerCheekR,
    rangerBrowHem,
    rangerTrimL,
    rangerTrimR,
    rangerTail,
    rangerTailTip,
    rangerFeather,
    rangerFeatherClasp,

    wizardUnderCap,
    wizardBrim,
    wizardBand,
    wizardSpire,
    wizardRuneBezel,
    wizardRuneGem,

    cryoBand,
    cryoBrowDip,
    cryoInnerCap,
    cryoSpireCenter,
    cryoSpireMid,
    cryoSpireSide,
    cryoCenterGem,
    cryoSideGem,

    clericCirclet,
    clericHalo,
    clericHaloRay,
    clericSunBezel,
    clericSunGem,
    clericVeilCrown,
    clericVeilBack,
    clericVeilSideL,
    clericVeilSideR,
    clericVeilHem,

    rogueCrown,
    rogueBrowPeak,
    rogueRearCowl,
    rogueCheekL,
    rogueCheekR,
    rogueLowerCollar,
    rogueTrimBrow,
    rogueTrimL,
    rogueTrimR,
    rogueTail,
    rogueTailTip,

    darkLordShell,
    darkLordBrowBand,
    darkLordJawGuard,
    darkLordDorsalRidge,
    darkLordBrowSpike,
    darkLordSlit,
    darkLordEyeGlow,
    darkLordHornL,
    darkLordHornR,

    goblinDome,
    goblinRim,
    goblinStrap,
    goblinStrapBuckle,
    goblinChinStrap,
    goblinPatchPlate,
    goblinSpikeBoss,
    goblinSpike,
    goblinRivet,

    boneHoodCrown,
    boneHoodBrowPeak,
    boneHoodRear,
    boneHoodDrapeL,
    boneHoodDrapeR,
    boneHoodTail,
    boneHoodTatter,
    boneHoodGlowBrow,
    boneHoodGlowSideL,
    boneHoodGlowSideR,
    boneHoodRuneClasp,
    boneHoodBead
  }
}

const ECLIPSE_HALO_Y = -0.120
const ECLIPSE_HALO_Z = -0.320

interface EclipseCrownMeshes {
  readonly band: Mesh
  readonly shard: Mesh
  readonly halo: Mesh
  readonly haloShard: Mesh
}

let cachedEclipseCrown: EclipseCrownMeshes | undefined

function getEclipseCrownMeshes(): EclipseCrownMeshes {
  if (cachedEclipseCrown) return cachedEclipseCrown
  const band = sculptLoft([
    { y: 0.050, rx: 0.284, rz: 0.262, zOffset: -0.006 },
    { y: 0.086, rx: 0.290, rz: 0.268, zOffset: -0.006 },
    { y: 0.118, rx: 0.270, rz: 0.250, zOffset: -0.008 }
  ], { sides: 8, aoStrength: 0.12, aoGradient: 0.06 })
  const shard = sculptLoft([
    { y: -0.020, rx: 0.040, rz: 0.026 },
    { y: 0.110, rx: 0.048, rz: 0.030 },
    { y: 0.300, rx: 0.004, rz: 0.004 }
  ], { sides: 4, aoStrength: 0.12, aoGradient: 0.08 })
  const ringPts: Vec3[] = []
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2
    ringPts.push([Math.cos(a) * 0.400, ECLIPSE_HALO_Y + Math.sin(a) * 0.400, ECLIPSE_HALO_Z])
  }
  const halo = tubeMesh(ringPts, 0.026, 5)
  const haloShard = sculptLoft([
    { y: -0.020, rx: 0.034, rz: 0.018 },
    { y: 0.060, rx: 0.030, rz: 0.016 },
    { y: 0.150, rx: 0.003, rz: 0.003 }
  ], { sides: 4, aoStrength: 0.10, aoGradient: 0.06 })
  cachedEclipseCrown = { band, shard, halo, haloShard }
  return cachedEclipseCrown
}

function getHeadgearMeshes(): HeadgearMeshes {
  if (!cachedHeadgearMeshes) {
    cachedHeadgearMeshes = buildHeadgearMeshes()
  }
  return cachedHeadgearMeshes
}

/**
 * Register all 11 Crownshard headgear parts on the `'headgear'` socket of a CharacterBuilder.
 * Parts are authored in `headgear` socket-local space (`[0, 0, 0]` at `[0, 0.455, 0]` on `head`).
 */
export function registerCrownshardHeadgear(builder: CharacterBuilder): void {
  // 1. Chiseled steel knight helm with gold brow band, hinged visor grille, cyan eye slit & crimson plume
  builder.registerPart('headgear', 'helm_knight_visored', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const steel = palette.metal
    const steelLight = shadeColor(steel, 0.08)
    const steelDark = palette.metalDark
    const gold = mixColor(palette.accent, [0.94, 0.74, 0.24, 1], 0.55)
    const slitDark: Color = [0.06, 0.08, 0.13, 1]
    const eyeGlow = mixColor(palette.glow, [0.38, 0.90, 1.0, 1], 0.50)
    const crimson: Color = [0.82, 0.16, 0.22, 1]

    return [
      { name: 'knight_shell', mesh: m.knightShell, color: steel },
      { name: 'knight_brow_band', mesh: m.knightBrowBand, color: gold },
      { name: 'knight_crown_ridge', mesh: m.knightCrownRidge, position: [0, 0, -0.012], color: steelDark },
      { name: 'knight_visor_prow', mesh: m.knightVisorProw, color: steelLight },
      { name: 'knight_visor_slit', mesh: m.knightVisorSlit, color: slitDark },
      { name: 'knight_eye_glow', mesh: m.knightEyeGlow, color: eyeGlow, unlit: 0.95 },
      { name: 'knight_grille_l1', mesh: m.knightGrilleSlot, position: [-0.092, -0.258, 0.278], rotation: [0, -0.58, 0], scale: [0.020, 0.088, 0.018], color: slitDark },
      { name: 'knight_grille_l2', mesh: m.knightGrilleSlot, position: [-0.146, -0.264, 0.242], rotation: [0, -0.60, 0], scale: [0.020, 0.076, 0.018], color: slitDark },
      { name: 'knight_grille_r1', mesh: m.knightGrilleSlot, position: [0.092, -0.258, 0.278], rotation: [0, 0.58, 0], scale: [0.020, 0.088, 0.018], color: slitDark },
      { name: 'knight_grille_r2', mesh: m.knightGrilleSlot, position: [0.146, -0.264, 0.242], rotation: [0, 0.60, 0], scale: [0.020, 0.076, 0.018], color: slitDark },
      { name: 'knight_hinge_l', mesh: m.knightHingeBoss, position: [-0.294, -0.155, 0.020], rotation: [0, 0, Math.PI * 0.5], color: gold },
      { name: 'knight_hinge_r', mesh: m.knightHingeBoss, position: [0.294, -0.155, 0.020], rotation: [0, 0, Math.PI * 0.5], color: gold },
      { name: 'knight_plume_socket', mesh: m.knightPlumeSocket, color: gold },
      // yaw = +PI/2 maps +X plume profile cleanly toward -Z (sweeping backward behind the helm!)
      { name: 'knight_plume', mesh: m.knightPlume, position: [0, 0, -0.015], rotation: [0, Math.PI * 0.5, 0], color: crimson }
    ]
  })

  // 2. Radiant ivory & gold crusader greathelm with bold swept golden side wings & golden visor
  builder.registerPart('headgear', 'helm_paladin_winged', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const ivory: Color = [0.95, 0.92, 0.85, 1]
    const gold = mixColor(palette.accent, [0.95, 0.76, 0.24, 1], 0.65)
    const goldBright = shadeColor(gold, 0.10)
    const slitDark: Color = [0.14, 0.10, 0.06, 1]
    const goldGlow: Color = [1.0, 0.88, 0.36, 1]

    return [
      { name: 'paladin_shell', mesh: m.paladinShell, color: ivory },
      { name: 'paladin_rim_top', mesh: m.paladinRimTop, color: gold },
      { name: 'paladin_rim_bot', mesh: m.paladinRimBot, color: gold },
      { name: 'paladin_brow_bar', mesh: m.paladinBrowBar, color: gold },
      { name: 'paladin_visor_slit', mesh: m.paladinVisorSlit, color: slitDark },
      { name: 'paladin_eye_glow', mesh: m.paladinEyeGlow, color: goldGlow, unlit: 0.95 },
      { name: 'paladin_nasal_bar', mesh: m.paladinNasalBar, color: goldBright },
      { name: 'paladin_wing_mount_l', mesh: m.paladinWingMount, position: [-0.294, -0.065, -0.012], rotation: [0, 0, Math.PI * 0.5], color: gold },
      { name: 'paladin_wing_mount_r', mesh: m.paladinWingMount, position: [0.294, -0.065, -0.012], rotation: [0, 0, Math.PI * 0.5], color: gold },
      // yaw = -0.46 on left (-X) and +0.46 on right (+X) sweeps both wings heroically BACKWARD toward -Z!
      { name: 'paladin_wing_l', mesh: m.paladinWingL, position: [-0.285, -0.045, -0.018], rotation: [0, -0.46, 0.08], color: gold },
      { name: 'paladin_wing_r', mesh: m.paladinWingR, position: [0.285, -0.045, -0.018], rotation: [0, 0.46, -0.08], color: gold },
      { name: 'paladin_wing_accent_l', mesh: m.paladinWingAccentL, position: [-0.285, -0.045, -0.018], rotation: [0, -0.46, 0.08], color: ivory },
      { name: 'paladin_wing_accent_r', mesh: m.paladinWingAccentR, position: [0.285, -0.045, -0.018], rotation: [0, 0.46, -0.08], color: ivory }
    ]
  })

  // 3. Stately faceted golden Sunstone Crown with pointed rays & glowing front ember gem
  builder.registerPart('headgear', 'helm_champion_crown', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const gold = mixColor(palette.accent, [0.96, 0.76, 0.22, 1], 0.65)
    const goldBright = shadeColor(gold, 0.08)
    const goldDark = shadeColor(gold, -0.14)
    const velvet: Color = [0.64, 0.14, 0.20, 1]
    const emberGlow: Color = [1.0, 0.46, 0.14, 1]

    return [
      { name: 'crown_band', mesh: m.crownBand, color: gold },
      { name: 'crown_lower_rim', mesh: m.crownLowerRim, color: goldBright },
      { name: 'crown_velvet_cap', mesh: m.crownVelvetCap, color: velvet },
      { name: 'crown_ray_front', mesh: m.crownSpikeMain, position: [0, 0.072, 0.236], rotation: [0.12, 0, 0], color: goldBright },
      { name: 'crown_ray_back', mesh: m.crownSpikeSide, position: [0, 0.072, -0.234], rotation: [-0.10, 0, 0], color: gold },
      { name: 'crown_ray_fl', mesh: m.crownSpikeSide, position: [-0.186, 0.072, 0.168], rotation: [0.08, -0.78, 0.10], color: goldBright },
      { name: 'crown_ray_fr', mesh: m.crownSpikeSide, position: [0.186, 0.072, 0.168], rotation: [0.08, 0.78, -0.10], color: goldBright },
      { name: 'crown_ray_l', mesh: m.crownSpikeSide, position: [-0.262, 0.072, -0.004], rotation: [0, Math.PI * 0.5, 0.12], color: gold },
      { name: 'crown_ray_r', mesh: m.crownSpikeSide, position: [0.262, 0.072, -0.004], rotation: [0, -Math.PI * 0.5, -0.12], color: gold },
      { name: 'crown_ray_bl', mesh: m.crownSpikeSide, position: [-0.184, 0.072, -0.172], rotation: [-0.08, 0.78, 0.10], color: gold },
      { name: 'crown_ray_br', mesh: m.crownSpikeSide, position: [0.184, 0.072, -0.172], rotation: [-0.08, -0.78, -0.10], color: gold },
      { name: 'crown_gem_bezel', mesh: m.crownGemBezel, position: [0, 0.038, 0.244], color: goldDark },
      { name: 'crown_gem_ember', mesh: m.crownGem, position: [0, 0.038, 0.260], color: emberGlow, unlit: 0.96 },
      { name: 'crown_stud_l', mesh: m.crownSideStud, position: [-0.276, 0.022, 0.010], scale: [0.024, 0.036, 0.036], color: emberGlow, unlit: 0.85 },
      { name: 'crown_stud_r', mesh: m.crownSideStud, position: [0.276, 0.022, 0.010], scale: [0.024, 0.036, 0.036], color: emberGlow, unlit: 0.85 }
    ]
  })

  // 4. Faceted emerald forest hood framing face & crown, gold brow hem, rear tail & jaunty feather
  builder.registerPart('headgear', 'hood_ranger', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const emerald = mixColor(palette.primary, [0.16, 0.52, 0.30, 1], 0.72)
    const emeraldDark = shadeColor(emerald, -0.12)
    const gold = mixColor(palette.accent, [0.92, 0.74, 0.26, 1], 0.60)
    const featherGold: Color = [0.98, 0.82, 0.28, 1]

    return [
      { name: 'ranger_crown', mesh: m.rangerCrown, color: emerald },
      { name: 'ranger_rear_cowl', mesh: m.rangerRearCowl, color: emeraldDark },
      { name: 'ranger_cheek_l', mesh: m.rangerCheekL, color: emerald },
      { name: 'ranger_cheek_r', mesh: m.rangerCheekR, color: emerald },
      { name: 'ranger_brow_hem', mesh: m.rangerBrowHem, color: gold },
      { name: 'ranger_trim_l', mesh: m.rangerTrimL, color: gold },
      { name: 'ranger_trim_r', mesh: m.rangerTrimR, color: gold },
      { name: 'ranger_tail', mesh: m.rangerTail, color: emeraldDark },
      { name: 'ranger_tail_tip', mesh: m.rangerTailTip, color: gold },
      { name: 'ranger_feather_clasp', mesh: m.rangerFeatherClasp, position: [0.272, 0.014, 0.032], rotation: [0, 0, Math.PI * 0.5], color: gold },
      // yaw = +0.52 sweeps the jaunty golden feather out & back cleanly!
      { name: 'ranger_feather', mesh: m.rangerFeather, position: [0.258, 0.008, 0.030], rotation: [-0.14, 0.52, -0.18], color: featherGold }
    ]
  })

  // 5. Dramatic wide-brimmed faceted wizard hat with tilted brim, gold hatband, cyan rune gem & crooked spire
  builder.registerPart('headgear', 'hat_wizard', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const indigo = mixColor(palette.primary, [0.24, 0.20, 0.58, 1], 0.74)
    const indigoDark = shadeColor(indigo, -0.12)
    const gold = mixColor(palette.accent, [0.94, 0.74, 0.26, 1], 0.60)
    const runeGlow = mixColor(palette.glow, [0.36, 0.92, 1.0, 1], 0.55)
    const tilt: readonly [number, number, number] = [-0.07, 0.02, 0.06]

    return [
      { name: 'wizard_undercap', mesh: m.wizardUnderCap, color: indigoDark },
      { name: 'wizard_brim', mesh: m.wizardBrim, position: [0, 0.022, 0], rotation: tilt, color: indigo },
      { name: 'wizard_band', mesh: m.wizardBand, position: [0, 0.022, 0], rotation: tilt, color: gold },
      { name: 'wizard_spire', mesh: m.wizardSpire, position: [0, 0.022, 0], rotation: tilt, color: indigo },
      { name: 'wizard_rune_bezel', mesh: m.wizardRuneBezel, position: [-0.006, 0.106, 0.264], rotation: tilt, color: gold },
      { name: 'wizard_rune_gem', mesh: m.wizardRuneGem, position: [-0.006, 0.106, 0.278], rotation: tilt, color: runeGlow, unlit: 0.96 }
    ]
  })

  // 6. Crystalline winter wizard hat / frost circlet with jagged ice spires & glowing cyan crystal
  builder.registerPart('headgear', 'hat_cryo_tiara', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const silverIce: Color = [0.82, 0.90, 0.97, 1]
    const iceMid: Color = [0.60, 0.86, 0.99, 1]
    const iceDeep: Color = [0.26, 0.48, 0.74, 1]
    const cryoGlow = mixColor(palette.glow, [0.42, 0.96, 1.0, 1], 0.65)

    return [
      { name: 'cryo_inner_cap', mesh: m.cryoInnerCap, color: iceDeep },
      { name: 'cryo_band', mesh: m.cryoBand, color: silverIce },
      { name: 'cryo_brow_dip', mesh: m.cryoBrowDip, color: silverIce },
      { name: 'cryo_spire_c', mesh: m.cryoSpireCenter, position: [0, 0.036, 0.228], rotation: [0.10, 0, 0], color: iceMid },
      { name: 'cryo_spire_fl', mesh: m.cryoSpireMid, position: [-0.145, 0.032, 0.200], rotation: [0.08, -0.35, 0.22], color: iceMid },
      { name: 'cryo_spire_fr', mesh: m.cryoSpireMid, position: [0.145, 0.032, 0.200], rotation: [0.08, 0.35, -0.22], color: iceMid },
      { name: 'cryo_spire_sl', mesh: m.cryoSpireSide, position: [-0.254, 0.026, 0.075], rotation: [-0.08, -0.70, 0.34], color: silverIce },
      { name: 'cryo_spire_sr', mesh: m.cryoSpireSide, position: [0.254, 0.026, 0.075], rotation: [-0.08, 0.70, -0.34], color: silverIce },
      { name: 'cryo_spire_bl', mesh: m.cryoSpireSide, position: [-0.215, 0.032, -0.135], rotation: [-0.24, 0.65, 0.26], color: iceMid },
      { name: 'cryo_spire_br', mesh: m.cryoSpireSide, position: [0.215, 0.032, -0.135], rotation: [-0.24, -0.65, -0.26], color: iceMid },
      { name: 'cryo_spire_back', mesh: m.cryoSpireSide, position: [0, 0.036, -0.225], rotation: [-0.24, 0, 0], color: silverIce },
      { name: 'cryo_gem_center', mesh: m.cryoCenterGem, position: [0, 0.085, 0.258], color: cryoGlow, unlit: 0.96 },
      { name: 'cryo_gem_l', mesh: m.cryoSideGem, position: [-0.266, 0.004, 0.095], rotation: [0, -0.75, 0], color: cryoGlow, unlit: 0.90 },
      { name: 'cryo_gem_r', mesh: m.cryoSideGem, position: [0.266, 0.004, 0.095], rotation: [0, 0.75, 0], color: cryoGlow, unlit: 0.90 }
    ]
  })

  // 7. Royal gold halo circlet with front sun-gem + clean sculpted ivory head-veil
  builder.registerPart('headgear', 'hood_cleric_veil', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const gold = mixColor(palette.accent, [0.95, 0.76, 0.26, 1], 0.65)
    const goldBright = shadeColor(gold, 0.08)
    const ivory: Color = [0.95, 0.92, 0.86, 1]
    const ivoryShade: Color = [0.87, 0.83, 0.77, 1]
    const sunGlow: Color = [1.0, 0.80, 0.26, 1]

    return [
      { name: 'cleric_veil_crown', mesh: m.clericVeilCrown, color: ivory },
      { name: 'cleric_veil_back', mesh: m.clericVeilBack, color: ivory },
      { name: 'cleric_veil_side_l', mesh: m.clericVeilSideL, color: ivoryShade },
      { name: 'cleric_veil_side_r', mesh: m.clericVeilSideR, color: ivoryShade },
      { name: 'cleric_veil_hem', mesh: m.clericVeilHem, color: gold },
      { name: 'cleric_circlet', mesh: m.clericCirclet, color: gold },
      { name: 'cleric_sun_bezel', mesh: m.clericSunBezel, position: [0, -0.012, 0.246], color: goldBright },
      { name: 'cleric_sun_gem', mesh: m.clericSunGem, position: [0, -0.012, 0.262], color: sunGlow, unlit: 0.96 },
      { name: 'cleric_halo', mesh: m.clericHalo, color: goldBright },
      { name: 'cleric_ray_top', mesh: m.clericHaloRay, position: [0, 0.365, -0.092], color: goldBright },
      { name: 'cleric_ray_l1', mesh: m.clericHaloRay, position: [-0.185, 0.318, -0.084], rotation: [0, 0, 0.56], color: gold },
      { name: 'cleric_ray_r1', mesh: m.clericHaloRay, position: [0.185, 0.318, -0.084], rotation: [0, 0, -0.56], color: gold },
      { name: 'cleric_ray_l2', mesh: m.clericHaloRay, position: [-0.318, 0.190, -0.068], rotation: [0, 0, 1.12], color: gold },
      { name: 'cleric_ray_r2', mesh: m.clericHaloRay, position: [0.318, 0.190, -0.068], rotation: [0, 0, -1.12], color: gold }
    ]
  })

  // 8. Sleek shadowed assassin cowl framing the brow with crimson trim & pointed back tail
  builder.registerPart('headgear', 'cowl_rogue', (_palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    // Lifted night-blue (still the darkest hero) so the cowl silhouette survives dark boards
    const shadow: Color = [0.28, 0.30, 0.41, 1]
    const shadowDeep: Color = [0.20, 0.21, 0.31, 1]
    const crimson: Color = [0.82, 0.16, 0.22, 1]

    return [
      { name: 'rogue_crown', mesh: m.rogueCrown, color: shadow },
      { name: 'rogue_brow_peak', mesh: m.rogueBrowPeak, color: shadow },
      { name: 'rogue_rear_cowl', mesh: m.rogueRearCowl, color: shadowDeep },
      { name: 'rogue_cheek_l', mesh: m.rogueCheekL, color: shadow },
      { name: 'rogue_cheek_r', mesh: m.rogueCheekR, color: shadow },
      { name: 'rogue_lower_collar', mesh: m.rogueLowerCollar, color: shadowDeep },
      { name: 'rogue_trim_brow', mesh: m.rogueTrimBrow, color: crimson },
      { name: 'rogue_trim_l', mesh: m.rogueTrimL, color: crimson },
      { name: 'rogue_trim_r', mesh: m.rogueTrimR, color: crimson },
      { name: 'rogue_tail', mesh: m.rogueTail, color: shadowDeep },
      { name: 'rogue_tail_tip', mesh: m.rogueTailTip, color: crimson }
    ]
  })

  // 9. Menacing obsidian boss warlord helm with curved faceted horns, sharp crown ridge & violet eye slits
  builder.registerPart('headgear', 'helm_dark_lord', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    // Palette-driven (crypt knight steel vs. other warlords) but kept in a moody low-mid value band
    const obsidian = mixColor(mixColor(palette.metalDark, palette.metal, 0.42), [0.30, 0.28, 0.38, 1], 0.20)
    const obsidianEdge = mixColor(palette.metal, palette.accent, 0.30)
    const hornBase = mixColor(palette.metal, [0.40, 0.37, 0.50, 1], 0.50)
    const slitDark: Color = [0.05, 0.04, 0.08, 1]
    const violetGlow = mixColor(palette.glow, [1, 1, 1, 1], 0.12)

    return [
      { name: 'darklord_shell', mesh: m.darkLordShell, color: obsidian },
      { name: 'darklord_brow_band', mesh: m.darkLordBrowBand, color: obsidianEdge },
      { name: 'darklord_jaw_guard', mesh: m.darkLordJawGuard, color: obsidianEdge },
      // yaw = +PI/2 sweeps dorsal crest cleanly toward -Z!
      { name: 'darklord_dorsal_ridge', mesh: m.darkLordDorsalRidge, position: [0, 0, -0.010], rotation: [0, Math.PI * 0.5, 0], color: obsidianEdge },
      { name: 'darklord_brow_spike_l', mesh: m.darkLordBrowSpike, position: [-0.172, 0.015, 0.224], rotation: [0.22, -0.30, 0.20], color: obsidianEdge },
      { name: 'darklord_brow_spike_r', mesh: m.darkLordBrowSpike, position: [0.172, 0.015, 0.224], rotation: [0.22, 0.30, -0.20], color: obsidianEdge },
      { name: 'darklord_slit', mesh: m.darkLordSlit, color: slitDark },
      { name: 'darklord_eye_l', mesh: m.darkLordEyeGlow, position: [-0.092, -0.148, 0.260], rotation: [0, -0.16, -0.18], color: violetGlow, unlit: 0.96 },
      { name: 'darklord_eye_r', mesh: m.darkLordEyeGlow, position: [0.092, -0.148, 0.260], rotation: [0, 0.16, 0.18], color: violetGlow, unlit: 0.96 },
      { name: 'darklord_horn_l', mesh: m.darkLordHornL, color: hornBase },
      { name: 'darklord_horn_r', mesh: m.darkLordHornR, color: hornBase }
    ]
  })

  // 9b. Eclipse Archon boss crown: lilac mask-helm, gold shard crown & a floating eclipse halo
  builder.registerPart('headgear', 'crown_eclipse', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const e = getEclipseCrownMeshes()
    const helm = mixColor(palette.metal, palette.primary, 0.18)
    const helmDark = mixColor(palette.metalDark, palette.primary, 0.25)
    const gold = mixColor(palette.accent, [0.96, 0.78, 0.26, 1], 0.50)
    const goldBright = shadeColor(gold, 0.10)
    const shard = mixColor(palette.glow, palette.primary, 0.55)
    const shardTip = mixColor(palette.glow, [1, 1, 1, 1], 0.15)
    const slitDark: Color = [0.05, 0.03, 0.08, 1]
    const glow = palette.glow
    const parts: RigPart[] = [
      { name: 'eclipse_shell', mesh: m.darkLordShell, color: helm },
      { name: 'eclipse_brow_band', mesh: m.darkLordBrowBand, color: gold },
      { name: 'eclipse_jaw_guard', mesh: m.darkLordJawGuard, color: helmDark },
      { name: 'eclipse_slit', mesh: m.darkLordSlit, color: slitDark },
      { name: 'eclipse_eye_l', mesh: m.darkLordEyeGlow, position: [-0.092, -0.148, 0.260], rotation: [0, -0.16, -0.18], color: glow, unlit: 0.96 },
      { name: 'eclipse_eye_r', mesh: m.darkLordEyeGlow, position: [0.092, -0.148, 0.260], rotation: [0, 0.16, 0.18], color: glow, unlit: 0.96 },
      { name: 'eclipse_crown_band', mesh: e.band, color: gold },
      { name: 'eclipse_crown_gem', mesh: octahedron, position: [0, 0.092, 0.288], scale: [0.040, 0.056, 0.024], color: glow, unlit: 0.96 },
      { name: 'eclipse_halo', mesh: e.halo, color: goldBright, unlit: 0.55 }
    ]
    // Crown of shadow shards (tallest at the front, tilting outward like a dark sunburst)
    const crown: readonly [number, number, number][] = [
      // [angle around head (0 = front), height scale, outward tilt]
      [0, 1.00, 0.18], [0.62, 0.78, 0.24], [-0.62, 0.78, 0.24], [1.25, 0.60, 0.30], [-1.25, 0.60, 0.30],
      [2.05, 0.50, 0.30], [-2.05, 0.50, 0.30], [Math.PI, 0.56, 0.26]
    ]
    for (let i = 0; i < crown.length; i++) {
      const [a, h, tilt] = crown[i]
      const sx = Math.sin(a)
      const cz = Math.cos(a)
      parts.push({
        name: `eclipse_shard_${i}`,
        mesh: e.shard,
        position: [sx * 0.262, 0.100, cz * 0.240 - 0.006],
        rotation: [cz * tilt, 0, -sx * tilt],
        scale: [1, h, 1],
        color: i === 0 ? shardTip : shard,
        unlit: i === 0 ? 0.80 : 0.30
      })
    }
    // Halo shards radiating outward from the eclipse ring behind the head
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8
      const r = 0.430
      parts.push({
        name: `eclipse_halo_shard_${i}`,
        mesh: e.haloShard,
        position: [Math.cos(a) * r, ECLIPSE_HALO_Y + Math.sin(a) * r, ECLIPSE_HALO_Z],
        rotation: [0, 0, a - Math.PI * 0.5],
        color: i % 2 === 0 ? shardTip : shard
      })
    }
    return parts
  })

  // 10. Battered iron raider pot-helm with crooked iron spike & leather strap
  builder.registerPart('headgear', 'helm_goblin_scrap', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const scrapIron: Color = [0.46, 0.48, 0.50, 1]
    const scrapDark: Color = [0.30, 0.31, 0.34, 1]
    const rustPatch: Color = [0.54, 0.34, 0.24, 1]
    const leather = palette.leather
    const brass = mixColor(palette.accent, [0.80, 0.62, 0.24, 1], 0.55)
    const tilt: readonly [number, number, number] = [-0.03, 0.02, -0.06]

    return [
      { name: 'goblin_dome', mesh: m.goblinDome, rotation: tilt, color: scrapIron },
      { name: 'goblin_rim', mesh: m.goblinRim, rotation: tilt, color: scrapDark },
      { name: 'goblin_strap', mesh: m.goblinStrap, rotation: tilt, color: leather },
      { name: 'goblin_buckle', mesh: m.goblinStrapBuckle, position: [-0.142, -0.002, 0.242], rotation: [-0.03, -0.52, -0.06], color: brass },
      { name: 'goblin_chinstrap_l', mesh: m.goblinChinStrap, position: [-0.258, 0.0, 0.042], rotation: [0, 0, 0.08], color: leather },
      { name: 'goblin_chinstrap_r', mesh: m.goblinChinStrap, position: [0.258, 0.0, 0.042], rotation: [0, 0, -0.08], color: leather },
      { name: 'goblin_patch', mesh: m.goblinPatchPlate, position: [0.190, 0.062, 0.125], rotation: [0.24, 0.72, -0.22], scale: [0.11, 0.10, 0.036], color: rustPatch },
      { name: 'goblin_spike_boss', mesh: m.goblinSpikeBoss, position: [-0.012, 0.205, -0.012], rotation: [0.10, 0, -0.18], color: scrapDark },
      { name: 'goblin_spike', mesh: m.goblinSpike, position: [-0.018, 0.228, -0.010], rotation: [0.18, 0.14, -0.32], color: shadeColor(scrapIron, 0.12) },
      { name: 'goblin_rivet_f', mesh: m.goblinRivet, position: [0.065, -0.046, 0.278], scale: [0.018, 0.018, 0.018], color: brass },
      { name: 'goblin_rivet_l', mesh: m.goblinRivet, position: [-0.288, -0.032, 0.085], scale: [0.018, 0.018, 0.018], color: brass },
      { name: 'goblin_rivet_r', mesh: m.goblinRivet, position: [0.288, -0.056, 0.085], scale: [0.018, 0.018, 0.018], color: brass }
    ]
  })

  // 11. Dark ragged necromancer cowl draped over a skull with eerie glowing trim
  builder.registerPart('headgear', 'helm_bone_hood', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    // Lifted, palette-tinted cloth so the hood silhouette survives dark crypt/bog boards
    const necromancerCloth = mixColor(palette.primary, [0.36, 0.32, 0.48, 1], 0.40)
    const necromancerShade = shadeColor(necromancerCloth, -0.09)
    const eerieGlow: Color = [0.36, 0.96, 0.62, 1]
    const boneTint: Color = [0.88, 0.85, 0.76, 1]

    return [
      { name: 'bonehood_crown', mesh: m.boneHoodCrown, color: necromancerCloth },
      { name: 'bonehood_brow_peak', mesh: m.boneHoodBrowPeak, color: necromancerCloth },
      { name: 'bonehood_rear', mesh: m.boneHoodRear, color: necromancerShade },
      { name: 'bonehood_drape_l', mesh: m.boneHoodDrapeL, color: necromancerCloth },
      { name: 'bonehood_drape_r', mesh: m.boneHoodDrapeR, color: necromancerCloth },
      { name: 'bonehood_tail', mesh: m.boneHoodTail, color: necromancerShade },
      // Ragged lower mantle tatters along the back edge
      { name: 'bonehood_tatter_c', mesh: m.boneHoodTatter, position: [0, -0.490, -0.256], rotation: [0.16, 0, 0], color: necromancerShade },
      { name: 'bonehood_tatter_l', mesh: m.boneHoodTatter, position: [-0.148, -0.485, -0.236], rotation: [0.14, -0.25, 0.10], color: necromancerCloth },
      { name: 'bonehood_tatter_r', mesh: m.boneHoodTatter, position: [0.148, -0.485, -0.236], rotation: [0.14, 0.25, -0.10], color: necromancerCloth },
      // Eerie spectral glowing trim hugged tightly to the hood lip
      { name: 'bonehood_glow_brow', mesh: m.boneHoodGlowBrow, color: eerieGlow, unlit: 0.92 },
      { name: 'bonehood_glow_l', mesh: m.boneHoodGlowSideL, color: eerieGlow, unlit: 0.92 },
      { name: 'bonehood_glow_r', mesh: m.boneHoodGlowSideR, color: eerieGlow, unlit: 0.92 },
      { name: 'bonehood_rune_clasp', mesh: m.boneHoodRuneClasp, position: [0, -0.048, 0.238], color: eerieGlow, unlit: 0.96 },
      { name: 'bonehood_bead_l', mesh: m.boneHoodBead, position: [-0.222, -0.375, 0.118], scale: [0.028, 0.036, 0.028], color: boneTint },
      { name: 'bonehood_bead_r', mesh: m.boneHoodBead, position: [0.222, -0.375, 0.118], scale: [0.028, 0.036, 0.028], color: boneTint }
    ]
  })

  // 12. Hooded Lich Sovereign cowl + jagged bone-gold necromantic crown & spectral eyes (Lich Vaelen)
  builder.registerPart('headgear', 'hood_lich_crown', (palette: CharacterPalette): RigPart[] => {
    const m = getHeadgearMeshes()
    const e = getEclipseCrownMeshes()
    const cowlCloth = mixColor(palette.primary, [0.24, 0.14, 0.42, 1], 0.42)
    const cowlShade = shadeColor(cowlCloth, -0.10)
    const gold = mixColor(palette.accent, [0.92, 0.78, 0.36, 1], 0.52)
    const soulGlow = palette.glow
    const soulBright = mixColor(palette.glow, [1, 1, 1, 1], 0.25)

    const parts: RigPart[] = [
      { name: 'lich_hood_crown', mesh: m.boneHoodCrown, color: cowlCloth },
      { name: 'lich_hood_brow', mesh: m.boneHoodBrowPeak, color: cowlCloth },
      { name: 'lich_hood_rear', mesh: m.boneHoodRear, color: cowlShade },
      { name: 'lich_hood_drape_l', mesh: m.boneHoodDrapeL, color: cowlCloth },
      { name: 'lich_hood_drape_r', mesh: m.boneHoodDrapeR, color: cowlCloth },
      { name: 'lich_hood_tail', mesh: m.boneHoodTail, color: cowlShade },
      { name: 'lich_hood_glow_brow', mesh: m.boneHoodGlowBrow, color: soulGlow, unlit: 0.94 },
      { name: 'lich_hood_glow_l', mesh: m.boneHoodGlowSideL, color: soulGlow, unlit: 0.90 },
      { name: 'lich_hood_glow_r', mesh: m.boneHoodGlowSideR, color: soulGlow, unlit: 0.90 },
      // Piercing spectral eyes peering from beneath the deep Lich hood
      { name: 'lich_eye_l', mesh: m.darkLordEyeGlow, position: [-0.088, -0.135, 0.228], rotation: [0, -0.14, -0.16], color: soulBright, unlit: 0.98 },
      { name: 'lich_eye_r', mesh: m.darkLordEyeGlow, position: [0.088, -0.135, 0.228], rotation: [0, 0.14, 0.16], color: soulBright, unlit: 0.98 },
      // Gilded necromantic circlet & twin curved lich horns piercing the cowl
      { name: 'lich_circlet', mesh: e.band, position: [0, 0.04, 0], color: gold },
      { name: 'lich_phylactery_gem', mesh: octahedron, position: [0, 0.145, 0.270], scale: [0.044, 0.068, 0.028], color: soulBright, unlit: 0.98 },
      { name: 'lich_horn_l', mesh: m.darkLordHornL, position: [-0.02, 0.05, -0.02], color: gold },
      { name: 'lich_horn_r', mesh: m.darkLordHornR, position: [0.02, 0.05, -0.02], color: gold }
    ]
    const spikes: readonly [number, number, number][] = [
      [0, 0.95, 0.14], [0.58, 0.72, 0.22], [-0.58, 0.72, 0.22], [1.18, 0.54, 0.26], [-1.18, 0.54, 0.26]
    ]
    for (let i = 0; i < spikes.length; i++) {
      const [a, h, tilt] = spikes[i]
      const sx = Math.sin(a)
      const cz = Math.cos(a)
      parts.push({
        name: `lich_crown_shard_${i}`,
        mesh: e.shard,
        position: [sx * 0.258, 0.130, cz * 0.236 - 0.004],
        rotation: [cz * tilt, 0, -sx * tilt],
        scale: [0.92, h, 0.92],
        color: i === 0 ? soulBright : gold,
        unlit: i === 0 ? 0.88 : 0.25
      })
    }
    return parts
  })
}
