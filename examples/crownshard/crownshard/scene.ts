import {
  color, createAnimator, createMeshPool, createParticles, createShadowBatch,
  mesh, multiply, perspective, quaternionFromEuler, renderRig, screenToRay,
  view, worldToScreen
} from 'ridgetop'
import type { Color, InstanceBatch, JointPose, LowPolyRenderer, Matrix, PointLight, RenderStats, Vec3 } from 'ridgetop'
import {
  BIOME_STYLES, ENEMY_RIGS,
  buildCampDioramaBatches, buildStaticBoardBatches, crispBevel, crownMesh, crystalMesh, flatRing,
  resolveHeroRig, roundPebble, smoothCone, softBevel, taperTrunk, tileQuad
} from './art.ts'
import {
  CAMP_FIDGETS, CLIP_IMPACT, LEAP_TUCK, UNIT_CLIPS,
  aimClipFor, attackClipFor, castClipFor, celebrateClipFor, deathClipFor, gaitFor, hitClipFor, idleClipFor, idleRateFor,
  runClipFor, runRateFor, skillClipFor, stanceOffsetFor, statusClipFor, turnClipFor, uidHash
} from './animations.ts'
import type { Gait, UnitClipName } from './animations.ts'
import { VFX_COLORS, arrowMesh, createBattleVfx } from './vfx.ts'
import type { StrikeShape } from './vfx.ts'
import {
  computeDangerZone, computeEnemyThreat, computeZocPerimeterTiles, evaluateAllFacingExposures, findGridPath,
  getEquipmentByUid, getHeroByUid, getHeroSkill, getPatternCells, getTacticByUid, getUnitByUid,
  getUnitFootprintCells, getUnitFootprintSize,
  hasMutator, isChestClaimed, isEnemyShrouded, isIntactBarricade, isTileRevealedInFog,
  previewPathOpportunityAttacks, unitAt, unitOrDownedAt
} from './simulation.ts'
import { TACTIC_BY_ID } from './data.ts'
import { BARRICADE_DEFAULT_HP, FACING_DIRS, TILE_SIZE, facingToYaw, facingVector, gridToWorld, isUnitDowned, vectorToFacing } from './types.ts'
import type {
  AttackArc, BattleState, BattleUnit, CombatForecast, DangerZoneMap, DisplacementKind, EnemyThreatMap,
  EquipSlot, FacingDir, FacingExposureLevel, FlankThreatTile, GameState, OwnedHeroCard
} from './types.ts'

const C_MOVE_TILE: Color = [0.22, 0.80, 1.0, 0.34]
const C_MOVE_BORDER: Color = [0.84, 0.97, 1.0, 0.94]
const C_DEPLOY_TILE: Color = [0.16, 0.54, 1.0, 0.36]
const C_DEPLOY_TILE_HOVER: Color = [0.34, 0.86, 1.0, 0.48]
const C_DEPLOY_BORDER: Color = [0.58, 0.90, 1.0, 0.96]
const C_DEPLOY_SEL_RING: Color = [1.0, 0.88, 0.36, 0.98]
const C_OBJ_SEIZE_TILE: Color = [1.0, 0.82, 0.22, 0.34]
const C_OBJ_SEIZE_GOLD: Color = [1.0, 0.90, 0.38, 0.98]
const C_OBJ_SEIZE_BEAM: Color = [1.0, 0.86, 0.34, 0.22]
const C_OBJ_DEFEND_TILE: Color = [0.22, 0.90, 0.96, 0.30]
const C_OBJ_DEFEND_CYAN: Color = [0.34, 0.96, 1.0, 0.96]
const C_OBJ_DEFEND_BEAM: Color = [0.32, 0.92, 0.96, 0.20]
const C_OBJ_DEFEND_BREACH: Color = [1.0, 0.22, 0.26, 0.96]
const C_OBJ_ASSASSINATE: Color = [1.0, 0.22, 0.32, 0.98]
const C_OBJ_CHEST_WOOD = color('8c5228')
const C_OBJ_CHEST_GOLD = color('ffd44f')
const C_ATTACK_TILE: Color = [1.0, 0.32, 0.14, 0.42]
const C_ATTACK_MARK: Color = [1.0, 0.94, 0.80, 0.98]
const C_FREE_RANGE_TILE: Color = [0.76, 0.86, 1.0, 0.12]
const C_FREE_RANGE_MARK: Color = [0.86, 0.92, 1.0, 0.42]
const C_FRIENDLY_FIRE_TILE: Color = [0.98, 0.18, 0.58, 0.56]
const C_FRIENDLY_FIRE_MARK: Color = [1.0, 0.92, 0.97, 0.98]
const C_MOVE_ATTACK_TILE: Color = [1.0, 0.68, 0.10, 0.42]
const C_MOVE_ATTACK_MARK: Color = [1.0, 0.96, 0.72, 0.98]
const C_ALLY_TARGET: Color = [0.24, 0.92, 0.74, 0.38]
const C_ALLY_MARK: Color = [0.94, 1.0, 0.97, 0.98]
const C_AOE_PREVIEW: Color = [1.0, 0.84, 0.24, 0.42]
const C_AOE_MARK: Color = [1.0, 0.97, 0.78, 0.98]
const C_DANGER_TILE: Color = [0.96, 0.34, 0.16, 0.22]
const C_FOG_TILE: Color = [0.09, 0.11, 0.22, 0.66]
const C_FOG_MIST: Color = [0.22, 0.19, 0.38, 0.34]
const C_FOG_SHROUD_UNIT: Color = [0.16, 0.20, 0.34, 0.34]
const C_DANGER_TILE_HIGH: Color = [0.96, 0.24, 0.16, 0.30]
const C_DANGER_HATCH: Color = [1.0, 0.72, 0.30, 0.56]
const C_DANGER_CORNER: Color = [1.0, 0.56, 0.22, 0.74]
const C_ENEMY_MOVE_TILE: Color = [0.92, 0.54, 0.14, 0.24]
const C_ENEMY_MOVE_DASH: Color = [1.0, 0.82, 0.36, 0.90]
const C_ENEMY_REACH_TILE: Color = [0.98, 0.22, 0.18, 0.28]
const C_ENEMY_REACH_HATCH: Color = [1.0, 0.62, 0.34, 0.82]
const C_FLANK_WARN: Color = [1.0, 0.78, 0.16, 0.96]
const C_BACKSTAB_WARN: Color = [1.0, 0.24, 0.66, 0.98]
const C_ZOC_PERIMETER: Color = [1.0, 0.44, 0.14, 0.16]
const C_ZOC_PERIMETER_MARK: Color = [1.0, 0.60, 0.22, 0.56]
const C_MOVE_PATH_STEP: Color = [0.46, 0.94, 1.0, 0.92]
const C_OA_WARN_TILE: Color = [1.0, 0.30, 0.10, 0.52]
const C_OA_WARN_MARK: Color = [1.0, 0.78, 0.22, 0.98]
const C_OA_ARC: Color = [1.0, 0.36, 0.14, 0.98]
const C_OA_SENTINEL_RING: Color = [1.0, 0.42, 0.14, 0.96]
const C_HOVER_TILE: Color = [1.0, 0.98, 0.90, 0.28]
const C_HOVER_BORDER: Color = [1.0, 1.0, 1.0, 0.98]
const C_APPROACH_RING: Color = [0.42, 0.95, 1.0, 0.96]
const C_TARGET_RETICLE: Color = [1.0, 0.32, 0.22, 0.96]
const C_EMPTY_RETICLE: Color = [0.76, 0.84, 0.98, 0.78]
const C_FORECAST_ARC: Color = [1.0, 0.80, 0.26, 0.94]
const C_FORECAST_ALLY_ARC: Color = [0.44, 0.98, 0.68, 0.94]
const C_FORECAST_FF_ARC: Color = [1.0, 0.34, 0.68, 0.96]
const C_PINCER_GOLD: Color = [1.0, 0.86, 0.32, 0.98]
const C_PINCER_CYAN: Color = [0.34, 0.96, 0.94, 0.96]
const C_DISPLACE_PUSH: Color = [0.34, 0.96, 1.0, 0.96]
const C_DISPLACE_HAZARD: Color = [1.0, 0.42, 0.16, 0.98]
const C_DISPLACE_SWAP: Color = [0.80, 0.50, 1.0, 0.96]
const C_FACING_ALLY: Color = [0.64, 0.95, 1.0, 0.96]
const C_FACING_ENEMY: Color = [1.0, 0.48, 0.22, 0.96]
const C_PICKER_SAFE: Color = [0.30, 0.96, 0.74, 0.96]
const C_PICKER_SAFE_DIM: Color = [0.26, 0.80, 0.66, 0.62]
const C_PICKER_FLANK: Color = [1.0, 0.74, 0.16, 0.98]
const C_PICKER_FLANK_DIM: Color = [0.96, 0.64, 0.14, 0.66]
const C_PICKER_BACK: Color = [1.0, 0.24, 0.28, 0.98]
const C_PICKER_BACK_DIM: Color = [0.94, 0.22, 0.26, 0.70]
const C_PICKER_SEL_RING: Color = [1.0, 0.94, 0.56, 0.98]
const C_PICKER_CONFIRM: Color = [1.0, 0.88, 0.34, 0.96]
const C_ACTIVE_RING: Color = [1.0, 0.85, 0.32, 0.96]
const C_SELECT_RING: Color = [0.70, 0.94, 1.0, 0.82]
const C_ENEMY_RING: Color = [0.98, 0.32, 0.30, 0.78]
const C_ALLY_RING: Color = [0.40, 0.82, 1.0, 0.62]
const C_SPOTLIGHT_ALLY: Color = [0.38, 0.94, 1.0, 0.96]
const C_SPOTLIGHT_ALLY_BEAM: Color = [0.42, 0.94, 1.0, 0.24]
const C_SPOTLIGHT_ENEMY: Color = [1.0, 0.48, 0.30, 0.96]
const C_SPOTLIGHT_ENEMY_BEAM: Color = [1.0, 0.44, 0.28, 0.24]
const C_SPOTLIGHT_GOLD: Color = [1.0, 0.92, 0.46, 0.94]
const C_STAR2_GOLD = color('f5c84c')
const C_STAR3_HALO: Color = [1.0, 0.88, 0.44, 0.86]
const C_FIRE_CORE = color('ff8f38')
const C_FIRE_TIP = color('ffe980')
const C_FROST = color('84e8ff')
const C_ARCANE = color('ad84ff')
const C_HOLY = color('fff0a0')
const C_SHADOW = color('cc64ff')
const C_HEAL = color('68ffa8')
const C_TAUNT = color('ff5944')
const C_HASTE = color('42f5d4')
const C_POISON = color('8dff4f')
const C_VENOM = color('b44cff')
const C_SHIELD: Color = [0.46, 0.86, 1.0, 0.38]
const C_HIT_FLASH = color('ffffff')
const C_CAMP_SKY = color('465a78')
const C_ARROW = color('f1dfb4')
const C_DUST: Color = [0.88, 0.82, 0.70, 0.55]
const C_ALLY_MOTE = color('ffe58a')
const C_ENEMY_MOTE = color('ff8a6e')
const C_ALLY_SOUL = color('9fe8ff')
const C_ENEMY_SOUL = color('d58cff')
const C_WOOD_TIMBER = color('9e5f38')
const C_WOOD_TIMBER_DARK = color('6e4026')
const C_IRON_BAND = color('48546b')
const C_GRASS_BLADE = color('49a354')
const C_GRASS_TIP = color('72c96b')
const C_CURSE_DIM = color('4a3c5e')
const C_ICE_SHEEN: Color = [0.82, 0.97, 1.0, 0.42]
const C_GEYSER_RING: Color = [1.0, 0.44, 0.16, 0.85]
const C_GEYSER_WARN: Color = [1.0, 0.52, 0.18, 0.45]
const C_ALTAR_RING: Color = [0.80, 0.36, 1.0, 0.78]
const C_KO_3: Color = [1.0, 0.78, 0.24, 0.94]
const C_KO_2: Color = [1.0, 0.48, 0.16, 0.96]
const C_KO_1: Color = [1.0, 0.22, 0.24, 0.98]
const C_REVIVE_TILE: Color = [1.0, 0.82, 0.28, 0.44]
const C_REVIVE_MARK: Color = [1.0, 0.96, 0.78, 0.98]

/** Death timing: topple clip, then sink + shrink into a soul-mote burst. */
const DEATH_SINK_START = 1.0
const DEATH_SINK_TIME = 0.7
const DEATH_TOTAL = DEATH_SINK_START + DEATH_SINK_TIME
/** Basic-attack strike trail shape per attack clip (weapon-specific swing arcs). */
const STRIKE_BY_CLIP: Partial<Record<UnitClipName, StrikeShape>> = {
  attack: 'slash',
  attack_overhead: 'overhead',
  attack_heavy: 'overhead',
  attack_axe: 'diagonal',
  attack_dark_cleave: 'dark',
  attack_thrust: 'thrust',
  attack_stab: 'thrust',
  attack_daggers: 'twin',
  attack_mace: 'mace',
  attack_pound: 'pound'
}

/** Seconds into a clip at which its blow lands / spell releases. */
function impactOf(clip: UnitClipName): number {
  return CLIP_IMPACT[clip] ?? 0.16
}

interface PendingHit {
  t: number
  arc: AttackArc
  crit: boolean
  blocked: boolean
  absorbed: number
  fromX: number
  fromZ: number
  hasAttacker: boolean
}

const ADD_JOINTS = ['body', 'head', 'armL', 'armR', 'legL', 'legR', 'cape'] as const

/** Flat ground-hugging directional facing chevron pointing down +Z outside the unit ring. */
const facingChevronMesh = (() => {
  const pos: number[] = []
  const idx: number[] = []
  function tri(a: Vec3, b: Vec3, c: Vec3) {
    const n = pos.length / 3
    pos.push(...a, ...b, ...c, ...a, ...c, ...b)
    idx.push(n, n + 1, n + 2, n + 3, n + 4, n + 5)
  }
  const y = 0.0
  // Crisp forward chevron arrowhead placed at z = 0.56..0.84
  tri([0, y, 0.86], [-0.20, y, 0.56], [0, y, 0.64])
  tri([0, y, 0.86], [0, y, 0.64], [0.20, y, 0.56])
  return mesh(pos, idx)
})()

/** Bold ground-plane directional arrow centered at origin pointing along +Z for the Wait-to-Face picker. */
const facingArrowMesh = (() => {
  const pos: number[] = []
  const idx: number[] = []
  function tri(a: Vec3, b: Vec3, c: Vec3) {
    const n = pos.length / 3
    pos.push(...a, ...b, ...c, ...a, ...c, ...b)
    idx.push(n, n + 1, n + 2, n + 3, n + 4, n + 5)
  }
  const y = 0.0
  // Arrowhead
  tri([0, y, 0.48], [-0.36, y, 0.02], [0.36, y, 0.02])
  // Stem
  tri([-0.14, y, 0.05], [-0.14, y, -0.32], [0.14, y, 0.05])
  tri([0.14, y, 0.05], [-0.14, y, -0.32], [0.14, y, -0.32])
  return mesh(pos, idx)
})()

/** Tapered double-sided octagonal light shaft for turn-order hover spotlight beacons (base radius 1, height 1). */
const spotlightBeamMesh = (() => {
  const pos: number[] = []
  const idx: number[] = []
  const sides = 8
  const rBot = 0.68
  const rTop = 0.46
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    const n = pos.length / 3
    pos.push(
      c0 * rBot, 0, s0 * rBot,
      c1 * rBot, 0, s1 * rBot,
      c1 * rTop, 1, s1 * rTop,
      c0 * rTop, 1, s0 * rTop
    )
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2)
  }
  return mesh(pos, idx)
})()

/** Build a flat ground-plane mesh from a list of 2D XZ quads (double-sided, unit tile scale [-0.5..0.5]). */
function flatOverlayMesh(rects: readonly (readonly [number, number, number, number])[]) {
  const pos: number[] = []
  const idx: number[] = []
  function quadXZ(x0: number, z0: number, x1: number, z1: number) {
    const n = pos.length / 3
    pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1)
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2)
  }
  for (const [x0, z0, x1, z1] of rects) quadXZ(x0, z0, x1, z1)
  return mesh(pos, idx)
}

/** Build a flat ground-plane mesh from arbitrary 2D XZ line segments with given half-width. */
function flatSegmentsMesh(segs: readonly (readonly [number, number, number, number])[], halfW: number) {
  const pos: number[] = []
  const idx: number[] = []
  for (const [x0, z0, x1, z1] of segs) {
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz) || 1
    const nx = (-dz / len) * halfW
    const nz = (dx / len) * halfW
    const n = pos.length / 3
    pos.push(
      x0 - nx, 0, z0 - nz,
      x0 + nx, 0, z0 + nz,
      x1 + nx, 0, z1 + nz,
      x1 - nx, 0, z1 - nz
    )
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2)
  }
  return mesh(pos, idx)
}

/** Colorblind-safe tile shape overlays (distinct silhouettes readable even in pure grayscale!). */
// 1. Hollow Square Frame + small center dot -> MOVE tile / Hover cursor
const tileFrameMesh = flatOverlayMesh([
  [-0.47, -0.47, 0.47, -0.39],
  [-0.47, 0.39, 0.47, 0.47],
  [-0.47, -0.39, -0.39, 0.39],
  [0.39, -0.39, 0.47, 0.39]
])
const tileDotMesh = flatOverlayMesh([[-0.08, -0.08, 0.08, 0.08]])
// 2. Bold Diagonal X Crosshair -> DIRECT ATTACK / FRIENDLY FIRE target
const tileCrossMesh = flatSegmentsMesh([
  [-0.30, -0.30, 0.30, 0.30],
  [0.30, -0.30, -0.30, 0.30]
], 0.055)
// 2b. Crossed-Swords Warning Emblem (blades + crossguards) -> OPPORTUNITY ATTACK provoked tile!
const tileCrossedSwordsMesh = flatSegmentsMesh([
  [-0.34, 0.34, 0.34, -0.34],
  [0.34, 0.34, -0.34, -0.34],
  [-0.28, 0.12, -0.12, 0.28],
  [0.28, 0.12, 0.12, 0.28]
], 0.052)
// 3. Four Corner L-Brackets [ ] -> Attack lock-on / Free skill range footprint
const tileCornersMesh = flatOverlayMesh([
  [-0.46, -0.46, -0.22, -0.39], [-0.46, -0.46, -0.39, -0.22],
  [0.22, -0.46, 0.46, -0.39], [0.39, -0.46, 0.46, -0.22],
  [-0.46, 0.39, -0.22, 0.46], [-0.46, 0.22, -0.39, 0.46],
  [0.22, 0.39, 0.46, 0.46], [0.39, 0.22, 0.46, 0.46]
])
// 4. Bold Medical/Support Plus (+) -> ALLY HEAL / SHIELD target
const tilePlusMesh = flatOverlayMesh([
  [-0.075, -0.28, 0.075, 0.28],
  [-0.28, -0.075, 0.28, 0.075]
])
// 5. Bold Hollow Diamond -> MOVE+ATTACK / AoE Blast Preview / Enemy Ground Ring!
const tileDiamondMesh = flatSegmentsMesh([
  [0, -0.42, 0.42, 0],
  [0.42, 0, 0, 0.42],
  [0, 0.42, -0.42, 0],
  [-0.42, 0, 0, -0.42]
], 0.045)
// 6. Parallel Diagonal Hazard Hatching -> ENEMY DANGER ZONE / ATTACK REACH (distinct from X, +, Square, Diamond!)
const tileHazardHatchMesh = flatSegmentsMesh([
  [-0.36, -0.06, -0.06, -0.36],
  [-0.34, 0.34, 0.34, -0.34],
  [0.06, 0.36, 0.36, 0.06]
], 0.028)
// 7. Diagonal Diamond-Corner Bevel Ticks -> Subtle DANGER ZONE perimeter without clashing with Move solid frame
const tileDangerCornersMesh = flatSegmentsMesh([
  [-0.44, -0.26, -0.26, -0.44],
  [0.26, -0.44, 0.44, -0.26],
  [0.44, 0.26, 0.26, 0.44],
  [-0.26, 0.44, -0.44, 0.26]
], 0.032)
// 8. Dashed Square Perimeter -> Inspected ENEMY MOVE RANGE (distinct from Hero's solid frame!)
const tileDashedFrameMesh = flatSegmentsMesh([
  [-0.42, -0.43, -0.14, -0.43], [0.14, -0.43, 0.42, -0.43],
  [-0.42, 0.43, -0.14, 0.43], [0.14, 0.43, 0.42, 0.43],
  [-0.43, -0.42, -0.43, -0.14], [-0.43, 0.14, -0.43, 0.42],
  [0.43, -0.42, 0.43, -0.14], [0.43, 0.14, 0.43, 0.42]
], 0.034)
// 9. Double-Chevron Warning Arrowhead -> FLANK / BACKSTAB directional threat indicator (pointing along +Z)
const flankWarningChevronMesh = (() => {
  const pos: number[] = []
  const idx: number[] = []
  function tri(a: Vec3, b: Vec3, c: Vec3) {
    const n = pos.length / 3
    pos.push(...a, ...b, ...c, ...a, ...c, ...b)
    idx.push(n, n + 1, n + 2, n + 3, n + 4, n + 5)
  }
  const y = 0.0
  // Outer sharp chevron
  tri([0, y, 0.42], [-0.24, y, 0.10], [0, y, 0.20])
  tri([0, y, 0.42], [0, y, 0.20], [0.24, y, 0.10])
  // Inner trailing chevron
  tri([0, y, 0.12], [-0.20, y, -0.16], [0, y, -0.06])
  tri([0, y, 0.12], [0, y, -0.06], [0.20, y, -0.16])
  return mesh(pos, idx)
})()

// 10. Low-poly battlefield treasure chest coffer (used by Seize objective chest markers)
const chestMarkerMesh = (() => {
  const pos: number[] = []
  const idx: number[] = []
  function addBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const n = pos.length / 3
    pos.push(
      x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, // back
      x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1  // front
    )
    const faces = [
      [0, 2, 1], [0, 3, 2], // -Z
      [4, 5, 6], [4, 6, 7], // +Z
      [0, 1, 5], [0, 5, 4], // -Y
      [3, 7, 6], [3, 6, 2], // +Y
      [0, 4, 7], [0, 7, 3], // -X
      [1, 2, 6], [1, 6, 5]  // +X
    ]
    for (const [a, b, c] of faces) idx.push(n + a, n + b, n + c)
  }
  // Main chest body + beveled top lid
  addBox(-0.32, 0.02, -0.22, 0.32, 0.34, 0.22)
  addBox(-0.34, 0.34, -0.24, 0.34, 0.48, 0.24)
  return mesh(pos, idx)
})()

function vfxColor(style: 'slash' | 'arrow' | 'arcane' | 'fire' | 'frost' | 'holy' | 'shadow' | 'gold'): Color {
  if (style === 'fire') return C_FIRE_CORE
  if (style === 'frost') return C_FROST
  if (style === 'arcane') return C_ARCANE
  if (style === 'holy' || style === 'gold') return C_HOLY
  if (style === 'shadow') return C_SHADOW
  return C_FIRE_TIP
}

export const CAMERA_QUARTER_TURN = Math.PI / 2
export const CAMERA_FULL_TURN = Math.PI * 2
export const CAMERA_YAW_SMOOTH_SPEED = 14

/** Normalize any yaw angle (radians) into the canonical [-PI, PI) range. */
export function normalizeCameraYaw(rad: number): number {
  if (!Number.isFinite(rad)) return 0
  const wrapped = rad - CAMERA_FULL_TURN * Math.floor((rad + Math.PI) / CAMERA_FULL_TURN)
  return Object.is(wrapped, -0) ? 0 : wrapped
}

/** Signed shortest-arc angular difference from `from` to `to` in [-PI, PI). */
export function shortestYawDelta(from: number, to: number): number {
  return normalizeCameraYaw(to - from)
}

/**
 * Snap `currentTargetYaw` to the nearest 90-degree cardinal multiple and step by `steps * (PI / 2)`.
 * Keeps the continuous turn direction intact across rapid multi-snaps; normalize via `normalizeCameraYaw` for display.
 */
export function snapYawStep(currentTargetYaw: number, steps: number): number {
  const safeYaw = Number.isFinite(currentTargetYaw) ? currentTargetYaw : 0
  const deltaSteps = Number.isFinite(steps) ? Math.trunc(steps) : 0
  const nearestCardinal = Math.round(safeYaw / CAMERA_QUARTER_TURN) * CAMERA_QUARTER_TURN
  const next = nearestCardinal + deltaSteps * CAMERA_QUARTER_TURN
  return Object.is(next, -0) ? 0 : next
}

/** Framerate-independent exponential ease from `current` toward `target`. */
export function stepCameraYaw(current: number, target: number, dt: number, speed = CAMERA_YAW_SMOOTH_SPEED): number {
  if (!Number.isFinite(dt) || dt <= 0) return current
  const delta = target - current
  if (Math.abs(delta) < 1e-4) return target
  const alpha = 1 - Math.exp(-speed * dt)
  return current + delta * alpha
}

/** Convert screen-aligned horizontal pan deltas (right, down) into world XZ pan deltas at `yaw`. */
export function cameraRelativePanDelta(right: number, down: number, yaw: number): readonly [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [right * c + down * s, -right * s + down * c]
}

/** Nearest cardinal compass heading ('N' | 'W' | 'S' | 'E') the battle camera is facing. */
export function cameraCardinalHeading(yaw: number): 'N' | 'W' | 'S' | 'E' {
  const q = ((Math.round(normalizeCameraYaw(yaw) / CAMERA_QUARTER_TURN) % 4) + 4) % 4
  if (q === 1) return 'W'
  if (q === 2) return 'S'
  if (q === 3) return 'E'
  return 'N'
}

/** Map screen-aligned directional input (right, down) to a world cardinal FacingDir at camera `yaw`. */
export function cameraAlignedFacing(right: number, down: number, yaw: number): FacingDir {
  const [worldDx, worldDz] = cameraRelativePanDelta(right, down, yaw)
  return vectorToFacing(worldDx, worldDz, 'n')
}

/**
 * World-space anchor for one of the 4 on-board Wait-to-Face directional arrows around `unit`,
 * respecting multi-tier terrain elevation, tall cliffs/pillars, chasms, and board edges.
 */
export function facingPickerAnchor(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  unit: Pick<BattleUnit, 'col' | 'row' | 'x' | 'y' | 'z'>,
  dir: FacingDir
): Vec3 {
  const [dc, dr] = facingVector(dir)
  const nc = unit.col + dc
  const nr = unit.row + dr
  const inBounds = nc >= 0 && nc < battle.cols && nr >= 0 && nr < battle.rows
  const neighbor = inBounds ? battle.cells[nr]?.[nc] : undefined
  const dist = TILE_SIZE * 0.92
  const wx = unit.x + dc * dist
  const wz = unit.z + dr * dist
  let wy = unit.y
  if (neighbor && neighbor.terrain !== 'void') {
    wy = Math.max(neighbor.elevation, unit.y - 0.45)
  }
  return [wx, wy + 0.08, wz]
}

function wrapAngle(a: number): number {
  return normalizeCameraYaw(a)
}

type Animator = ReturnType<typeof createAnimator<UnitClipName>>

/** Presentation-only per-unit animation state (never read by the simulation). */
interface UnitFx {
  readonly anim: Animator
  readonly seed: number
  readonly seed2: number
  yaw: number
  lastState: string
  lastTimer: number
  action: UnitClipName | null
  actionT: number
  actionDur: number
  wasAlive: boolean
  wasDowned: boolean
  deathT: number
  kbX: number
  kbZ: number
  slideFromX: number
  slideFromY: number
  slideFromZ: number
  slideT: number
  slideDur: number
  slideArc: number
  slideKind: DisplacementKind | null
  lastCol: number
  lastRow: number
  lastElev: number
  landT: number
  landAmp: number
  pendingReady: boolean
  celebrateDelay: number
  stanceW: number
  fidgetTimer: number
  fidgetCount: number
  /** Clip chosen by a VFX event (skill/special/weapon) for the next attack/cast edge. */
  pendingClip: UnitClipName | null
  /** Hit reaction waiting for the attacker's clip to connect. */
  hitQueue: PendingHit | null
  /** Status onset reaction waiting for the current action to finish. */
  statusQueue: UnitClipName | null
  flashT: number
  simYaw: number
  prevBurn: number
  prevSlow: number
  prevStun: number
  prevEmpower: number
  prevTaunt: number
  prevHaste: number
  prevPoison: number
  auraTimer: number
  deathClip: UnitClipName
  readonly pos: [number, number, number]
  readonly scl: [number, number, number]
  readonly additive: Record<string, { rotation: [number, number, number] }>
}

interface Shot {
  style: 'arrow' | 'arcane' | 'fire' | 'frost' | 'holy' | 'shadow'
  from: Vec3
  to: Vec3
  peak: number
  age: number
  life: number
  trail: number
  delay: number
}

function intersectRayAABB(
  origin: Vec3,
  dir: Vec3,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number
): number | null {
  let tMin = 0
  let tMax = Infinity

  const axes: readonly (readonly [number, number, number, number])[] = [
    [origin[0], dir[0], minX, maxX],
    [origin[1], dir[1], minY, maxY],
    [origin[2], dir[2], minZ, maxZ]
  ]
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return null
      continue
    }
    const inv = 1 / d
    let t1 = (lo - o) * inv
    let t2 = (hi - o) * inv
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    if (t1 > tMin) tMin = t1
    if (t2 < tMax) tMax = t2
    if (tMin > tMax) return null
  }
  return tMin >= 0 ? tMin : null
}

/** Exact multi-height ray vs tile-AABB picking across height levels 0..4 (skips void chasms). */
export function pickCellFromRay(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  origin: Vec3,
  direction: Vec3
): { col: number; row: number } | null {
  const half = TILE_SIZE * 0.5
  let bestT = Infinity
  let bestCell: { col: number; row: number } | null = null

  for (let row = 0; row < battle.rows; row++) {
    const line = battle.cells[row]
    if (!line) continue
    for (let col = 0; col < battle.cols; col++) {
      const cell = line[col]
      if (!cell || cell.terrain === 'void') continue
      const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
      const minY = Math.min(-0.35, wy - 0.35)
      const t = intersectRayAABB(origin, direction, wx - half, minY, wz - half, wx + half, wy, wz + half)
      if (t !== null && t < bestT) {
        bestT = t
        bestCell = { col, row }
      }
    }
  }
  return bestCell
}

export function createCrownshardScene(renderer: LowPolyRenderer) {
  const campBatches = buildCampDioramaBatches()
  let cachedBoardKey = ''
  let appliedLightingKey = ''
  let boardBatches: InstanceBatch[] = []
  let boardBraziers: Vec3[] = []

  const pool = createMeshPool(128)
  const particles = createParticles(320)
  const unitFx = new Map<string, UnitFx>()
  const shots: Shot[] = []
  const shadows = createShadowBatch({
    capacity: 64,
    color: [0.14, 0.17, 0.30],
    opacity: 0.28,
    penumbra: 0.28,
    offsetScale: 0.12,
    bias: 0.025
  })

  let lastMatrix: Matrix = multiply(perspective(Math.PI / 3.6, 16 / 9, 0.5, 120), view([0, 12, 13], [0, 0, 0]))
  let hoveredCell: { col: number; row: number } | null = null
  let activeForecast: CombatForecast | null = null
  let dangerZoneVisible = false
  let inspectedEnemyUid: string | null = null
  let spotlightUnitUid: string | null = null
  let cameraYawTarget = 0
  let cameraYawActual = 0
  const DEFAULT_CAMERA_PITCH = 0.72
  const MIN_CAMERA_PITCH = 0.28
  const MAX_CAMERA_PITCH = 1.38
  let cameraPitch = DEFAULT_CAMERA_PITCH
  let cameraPitchActual = DEFAULT_CAMERA_PITCH
  let cameraZoom = 1.0
  let cameraZoomActual = 1.0
  let cameraPanX = 0
  let cameraPanZ = 0
  const MIN_CAMERA_ZOOM = 0.58
  const MAX_CAMERA_ZOOM = 1.38
  let campFraming: 'title' | 'camp' | 'armory' | 'story' | 'world' = 'title'
  let campShift = 0
  let armoryFocusW = 0
  let armoryFocusX = 0
  let armoryFocusZ = -0.35
  const campEquipPulse = new Map<string, { t: number; dur: number; color: Color; spawned: boolean }>()
  let fireTimer = 0
  let lastBattle: BattleState | null = null
  let lastFloatId = -1
  let lastActiveUid: string | null = null
  let hitStop = 0
  let moteTimer = 0
  let hazardParticleTimer = 0
  /** Presentation-only camera shake (gait stomps, VFX slams) layered on the sim's battle.shake. */
  let localShake = 0
  const vfx = createBattleVfx(pool, particles, amount => { localShake = Math.max(localShake, amount) })

  function getFx(key: string, unit?: BattleUnit): UnitFx {
    let fx = unitFx.get(key)
    if (!fx) {
      const seed = uidHash(key)
      const anim = createAnimator(UNIT_CLIPS, 'idle')
      anim.step(seed * 2.4) // desync breathing across the squad
      const additive: Record<string, { rotation: [number, number, number] }> = {}
      for (const j of ADD_JOINTS) additive[j] = { rotation: [0, 0, 0] }
      const initialDowned = unit ? isUnitDowned(unit) : false
      if (initialDowned) {
        anim.play('death_kneel', 0)
        anim.step(0.95)
      }
      fx = {
        anim,
        seed,
        seed2: uidHash(key + '#'),
        yaw: unit?.yaw ?? 0,
        lastState: unit?.animState ?? 'idle',
        lastTimer: unit?.animTimer ?? 0,
        action: null,
        actionT: 0,
        actionDur: 0,
        wasAlive: unit?.alive ?? true,
        wasDowned: initialDowned,
        deathT: initialDowned ? DEATH_SINK_START - 0.08 : -1,
        kbX: 0,
        kbZ: 0,
        slideFromX: 0,
        slideFromY: 0,
        slideFromZ: 0,
        slideT: 0,
        slideDur: 0,
        slideArc: 0,
        slideKind: null,
        lastCol: unit?.col ?? 0,
        lastRow: unit?.row ?? 0,
        lastElev: unit?.y ?? 0,
        landT: 1,
        landAmp: 0,
        pendingReady: false,
        celebrateDelay: -1,
        stanceW: 1,
        fidgetTimer: 3 + seed * 6,
        fidgetCount: 0,
        pendingClip: null,
        hitQueue: null,
        statusQueue: null,
        flashT: 0,
        simYaw: unit?.yaw ?? 0,
        prevBurn: unit?.burnTurns ?? 0,
        prevSlow: unit?.slowTurns ?? 0,
        prevStun: unit?.stunTurns ?? 0,
        prevEmpower: unit?.empowerTurns ?? 0,
        prevTaunt: unit?.tauntTurns ?? 0,
        prevHaste: unit?.hasteTurns ?? 0,
        prevPoison: unit?.poisonStacks ?? 0,
        auraTimer: seed,
        deathClip: initialDowned ? 'death_kneel' : 'death',
        pos: unit ? [unit.x, unit.y, unit.z] : [0, 0, 0],
        scl: [1, 1, 1],
        additive
      }
      unitFx.set(key, fx)
    }
    return fx
  }

  function startAction(fx: UnitFx, clip: UnitClipName, fade: number) {
    fx.action = clip
    fx.actionT = 0
    fx.actionDur = UNIT_CLIPS[clip].duration
    fx.anim.trigger(clip, fade)
  }

  /** Blend archetype stance (idle family only) and the elevation-hop tuck into one reusable additive pose. */
  function fillAdditive(fx: UnitFx, stance: Readonly<Record<string, JointPose>>, stanceW: number, leapK: number) {
    for (const j of ADD_JOINTS) {
      const r = fx.additive[j].rotation
      const s = stance[j]?.rotation
      const l = LEAP_TUCK[j]
      r[0] = (s ? s[0] * stanceW : 0) + (l ? l[0] * leapK : 0)
      r[1] = (s ? s[1] * stanceW : 0) + (l ? l[1] * leapK : 0)
      r[2] = (s ? s[2] * stanceW : 0) + (l ? l[2] * leapK : 0)
    }
    return fx.additive
  }

  function ensureBoard(battle: BattleState) {
    let terrainHash = 2166136261
    for (let r = 0; r < battle.rows; r++) {
      const row = battle.cells[r]
      for (let c = 0; c < battle.cols; c++) {
        const t = row[c].terrain
        for (let k = 0; k < t.length; k++) {
          terrainHash = Math.imul(terrainHash ^ t.charCodeAt(k), 16777619)
        }
        terrainHash = Math.imul(terrainHash ^ 44, 16777619)
      }
    }
    const key = `${battle.stageId}:${battle.biome}:${battle.cols}x${battle.rows}:${battle.endlessWave}:${terrainHash >>> 0}`
    if (key === cachedBoardKey) return
    for (const b of boardBatches) renderer.release(b)
    const built = buildStaticBoardBatches(battle.biome, battle.cells)
    boardBatches = built.batches
    boardBraziers = built.brazierPositions
    cachedBoardKey = key
    appliedLightingKey = ''
  }

  function applyBattleLightingOnce(battle: BattleState) {
    const key = `battle:${battle.biome}:${cachedBoardKey}`
    if (key === appliedLightingKey) return
    appliedLightingKey = key

    const style = BIOME_STYLES[battle.biome]
    const points: PointLight[] = []
    for (let i = 0; i < Math.min(4, boardBraziers.length); i++) {
      points.push({
        position: boardBraziers[i],
        color: [style.propGlow[0], style.propGlow[1], style.propGlow[2]],
        radius: 7.2,
        intensity: battle.biome === 'crypt' || battle.biome === 'volcano' || battle.biome === 'throne' ? 1.18 : 0.72
      })
    }

    const shadowScale = Math.max(1, battle.cols / 8, battle.rows / 6)
    renderer.setLighting({
      direction: style.lightDir,
      ambient: style.ambient,
      color: style.lightColor,
      skyColor: style.skyBounce,
      groundColor: style.groundBounce,
      rimColor: [style.propGlow[0], style.propGlow[1], style.propGlow[2]],
      rimStrength: 0.28,
      fogColor: style.fog,
      fogNear: 28,
      fogFar: 88,
      points,
      shadows: {
        enabled: true,
        center: [0, 0, 0],
        extent: 12.5 * shadowScale,
        strength: 0.38,
        color: style.shadowTint
      }
    })
    shadows.setLighting(style.lightDir)
  }

  function applyCampLightingOnce() {
    if (appliedLightingKey === 'camp') return
    appliedLightingKey = 'camp'

    const style = BIOME_STYLES.meadow
    renderer.setLighting({
      direction: [-0.52, 0.76, 0.46],
      ambient: 0.46,
      color: [1.0, 0.93, 0.80],
      skyColor: [0.64, 0.74, 0.94],
      groundColor: [0.46, 0.38, 0.30],
      rimColor: [1.0, 0.86, 0.56],
      rimStrength: 0.30,
      fogColor: [0.28, 0.36, 0.48],
      fogNear: 22,
      fogFar: 64,
      points: [
        { position: [0, 0.85, 2.0], color: [1.0, 0.64, 0.28], radius: 8.2, intensity: 1.35 },
        { position: [0, 1.55, -2.55], color: [1.0, 0.88, 0.48], radius: 6.8, intensity: 0.95 },
        { position: [-3.3, 1.5, -1.4], color: [1.0, 0.84, 0.44], radius: 5.5, intensity: 0.78 },
        { position: [3.3, 1.5, -1.4], color: [1.0, 0.84, 0.44], radius: 5.5, intensity: 0.78 }
      ],
      shadows: {
        enabled: true,
        center: [0, 0, 0],
        extent: 10.5,
        strength: 0.40,
        color: [0.18, 0.22, 0.38]
      }
    })
    shadows.setLighting(style.lightDir)
  }

  function spawnDust(x: number, y: number, z: number, count: number, strength: number) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + x * 3.1 + z * 1.7
      const c = Math.cos(a), s = Math.sin(a)
      particles.spawn({
        mesh: roundPebble,
        blend: 'alpha',
        alphaFade: true,
        position: [x + c * 0.16, y + 0.05, z + s * 0.16],
        velocity: [c * 0.7 * strength, 0.35 + 0.25 * strength, s * 0.7 * strength],
        gravity: 0.5,
        drag: 3.2,
        scale: [0.11, 0.08, 0.11],
        endScale: 2.1,
        color: C_DUST,
        unlit: 0.35,
        life: 0.42 + 0.12 * strength
      })
    }
  }

  function spawnSparks(at: Vec3, col: Color, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      particles.spawn({
        mesh: crystalMesh,
        blend: 'additive',
        position: at,
        velocity: [Math.cos(a) * speed, 1.2 + (i % 3) * 0.5, Math.sin(a) * speed],
        gravity: 4.0,
        spin: 10,
        scale: [0.10, 0.14, 0.10],
        endScale: 0.1,
        color: col,
        unlit: 1,
        life: 0.32
      })
    }
  }

  /** Queue a hit reaction on the defender, timed to land when the attacker's blow connects. */
  function queueHit(battle: BattleState, ev: Extract<GameState['vfx'][number], { kind: 'impact' }>, delay: number) {
    const defender = getUnitByUid(battle, ev.uid)
    if (!defender) return
    const attacker = ev.attackerUid ? getUnitByUid(battle, ev.attackerUid) : null
    const dfx = getFx(defender.uid, defender)
    const prev = dfx.hitQueue
    // Multi-hit skills on one unit keep the strongest reaction at the earliest time
    dfx.hitQueue = {
      t: prev ? Math.min(prev.t, delay) : delay,
      arc: prev && prev.arc !== 'front' ? prev.arc : ev.arc,
      crit: ev.crit || Boolean(prev?.crit),
      blocked: ev.blocked && (!prev || prev.blocked),
      absorbed: ev.absorbed + (prev?.absorbed ?? 0),
      fromX: attacker ? attacker.x : defender.x,
      fromZ: attacker ? attacker.z : defender.z,
      hasAttacker: Boolean(attacker && attacker !== defender)
    }
  }

  function consumeVfx(state: GameState) {
    const battle = state.battle
    // Delay (s) at which the most recent action in this batch lands; trailing heal/shield/ko events sync to it.
    let landDelay = 0
    const attackLand = new Map<string, number>()
    for (const ev of state.vfx) {
      if (ev.kind === 'projectile') {
        const arrow = ev.style === 'arrow'
        const owner = battle && ev.uid ? getUnitByUid(battle, ev.uid) : null
        let delay = 0
        if (owner) {
          const clip = attackClipFor(owner.heroId, owner.enemyId, owner.weaponId)
          const ofx = getFx(owner.uid, owner)
          ofx.pendingClip = clip
          delay = impactOf(clip)
        }
        const life = arrow ? 0.28 : 0.34
        shots.push({ style: ev.style, from: ev.from, to: ev.to, peak: arrow ? 0.9 : 0.55, age: 0, life, trail: 0, delay })
        landDelay = delay + life
        if (owner) attackLand.set(owner.uid, landDelay)
      } else if (ev.kind === 'burst') {
        const owner = battle && ev.uid ? getUnitByUid(battle, ev.uid) : null
        if (owner) {
          // Weapon-specific melee strike trail, timed to the attack clip's impact frame
          const clip = attackClipFor(owner.heroId, owner.enemyId, owner.weaponId)
          getFx(owner.uid, owner).pendingClip = clip
          const d = impactOf(clip)
          vfx.strike(STRIKE_BY_CLIP[clip] ?? 'slash', [owner.x, owner.y, owner.z], [ev.at[0], ev.at[1] - 0.75, ev.at[2]], d)
          landDelay = d
          attackLand.set(owner.uid, d)
          continue
        }
        const col = vfxColor(ev.style)
        const rad = ev.radius ?? 0.9
        const count = rad > 1.4 ? 16 : 9
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2
          const spd = (1.6 + (i % 3) * 0.7) * rad
          particles.spawn({
            mesh: crystalMesh,
            position: ev.at,
            velocity: [Math.cos(a) * spd, 1.8 + (i % 4) * 0.65, Math.sin(a) * spd],
            gravity: 5.2,
            spin: 9,
            scale: [0.18, 0.22, 0.18],
            color: col,
            unlit: 0.96,
            life: 0.48
          })
        }
      } else if (ev.kind === 'skill') {
        const caster = battle ? getUnitByUid(battle, ev.uid) : null
        const clip = skillClipFor(ev.skillId, caster?.heroId)
        if (caster) getFx(caster.uid, caster).pendingClip = clip
        landDelay = vfx.skill(ev, impactOf(clip))
        attackLand.set(ev.uid, landDelay)
      } else if (ev.kind === 'tactic') {
        const caster = battle && ev.casterUid ? getUnitByUid(battle, ev.casterUid) : null
        let d = 0
        if (caster && caster.alive) {
          const cfx = getFx(caster.uid, caster)
          if (caster.path.length === 0) {
            startAction(cfx, 'command', 0.06)
            d = impactOf('command')
          }
        }
        landDelay = vfx.tactic(ev, d)
      } else if (ev.kind === 'special') {
        const boss = battle ? getUnitByUid(battle, ev.uid) : null
        const clip: UnitClipName = ev.move === 'eclipse_nova' ? 'boss_nova'
          : ev.move === 'lich_summon' ? 'boss_summon'
          : ev.move === 'frostwyrm_breath' ? 'boss_breath'
          : ev.move === 'titan_slam' ? 'boss_slam'
          : 'shaman_chant'
        if (boss) getFx(boss.uid, boss).pendingClip = clip
        const from: Vec3 = boss ? [boss.x, boss.y, boss.z] : ev.at
        landDelay = vfx.special(ev.move, from, ev.at, ev.cells, impactOf(clip))
        attackLand.set(ev.uid, landDelay)
      } else if (ev.kind === 'combo') {
        vfx.combo(ev, landDelay + 0.04)
      } else if (ev.kind === 'impact') {
        if (!battle) continue
        const d = ev.attackerUid ? (attackLand.get(ev.attackerUid) ?? landDelay) : landDelay
        queueHit(battle, ev, d)
        landDelay = d
      } else if (ev.kind === 'pincer') {
        const assister = battle ? getUnitByUid(battle, ev.assisterUid) : null
        const followDelay = landDelay + 0.10
        if (assister && assister.alive) {
          const clip = attackClipFor(assister.heroId, assister.enemyId, assister.weaponId)
          getFx(assister.uid, assister).pendingClip = clip
        }
        vfx.pincer(ev.attackerPos, ev.assisterPos, ev.targetPos, followDelay)
        landDelay = followDelay + 0.08
      } else if (ev.kind === 'heal') {
        const at = ev.at
        vfx.later(landDelay, () => {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2
            particles.spawn({
              mesh: crystalMesh,
              position: [at[0] + Math.cos(a) * 0.4, at[1], at[2] + Math.sin(a) * 0.4],
              velocity: [0, 1.8 + (i % 3) * 0.3, 0],
              gravity: 0.4,
              spin: 6,
              scale: [0.14, 0.18, 0.14],
              color: C_HEAL,
              unlit: 0.96,
              life: 0.65
            })
          }
        })
      } else if (ev.kind === 'revive') {
        const at = ev.at
        vfx.beam(at, VFX_COLORS.gold, landDelay, { radius: 0.46, height: 6.0, life: 0.88 })
        vfx.groundRing(at, VFX_COLORS.holy, landDelay + 0.05, 0.75, 0.25, 1.5, 2.2)
        vfx.motes(at, VFX_COLORS.gold, 14, 0.48, 2.2, landDelay + 0.08, 1.0)
        vfx.later(landDelay, () => {
          spawnSparks([at[0], at[1] + 0.5, at[2]], C_HOLY, 12, 2.1)
        })
      } else if (ev.kind === 'shield') {
        const at = ev.at
        vfx.later(landDelay, () => {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2
            particles.spawn({
              mesh: crystalMesh,
              position: [at[0] + Math.cos(a) * 0.45, at[1] + 0.2, at[2] + Math.sin(a) * 0.45],
              velocity: [Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5],
              gravity: 0.2,
              scale: [0.14, 0.16, 0.14],
              color: C_FROST,
              unlit: 0.95,
              life: 0.52
            })
          }
        })
      } else if (ev.kind === 'ko') {
        const at = ev.at
        const isBoss = Boolean(ev.isBoss)
        const isDownedKo = Boolean(ev.downed)
        vfx.later(landDelay, () => {
          hitStop = Math.max(hitStop, isBoss ? 0.22 : isDownedKo ? 0.09 : 0.12)
          const count = isBoss ? 22 : 12
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2
            particles.spawn({
              mesh: crystalMesh,
              position: at,
              velocity: [Math.cos(a) * 2.6, 2.8 + (i % 4) * 0.8, Math.sin(a) * 2.6],
              gravity: 6.4,
              spin: 11,
              scale: [0.20, 0.24, 0.20],
              color: isBoss ? C_SHADOW : isDownedKo ? C_KO_3 : C_FIRE_TIP,
              unlit: 0.95,
              life: 0.72
            })
          }
        })
      } else if (ev.kind === 'levelup') {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2
          particles.spawn({
            mesh: crystalMesh,
            position: ev.at,
            velocity: [Math.cos(a) * 2.1, 3.2 + (i % 3) * 0.7, Math.sin(a) * 2.1],
            gravity: 4.5,
            spin: 10,
            scale: [0.18, 0.24, 0.18],
            color: C_HOLY,
            unlit: 0.98,
            life: 0.80
          })
        }
      } else if (ev.kind === 'displace') {
        const u = battle ? getUnitByUid(battle, ev.uid) : null
        if (u) {
          const ufx = getFx(u.uid, u)
          ufx.slideFromX = ev.from[0] - ev.to[0]
          ufx.slideFromY = ev.from[1] - ev.to[1]
          ufx.slideFromZ = ev.from[2] - ev.to[2]
          ufx.slideT = 0
          ufx.slideDur = ev.displacementKind === 'swap' ? 0.30 : 0.24
          ufx.slideArc = ev.displacementKind === 'swap' ? 0.82 : (ev.fallDrop && ev.fallDrop >= 2 ? 0.44 : 0.18)
          ufx.slideKind = ev.displacementKind
          ufx.lastCol = u.col
          ufx.lastRow = u.row
          ufx.lastElev = u.y
        }
        spawnDust(ev.from[0], ev.from[1], ev.from[2], 6, 1.05)
        if (ev.displacementKind === 'swap') {
          vfx.groundRing(ev.from, C_DISPLACE_SWAP, 0, 0.45, 0.2, 1.15, 2.8)
          vfx.groundRing(ev.to, C_DISPLACE_SWAP, 0.04, 0.5, 0.2, 1.25, -2.8)
          spawnSparks([ev.to[0], ev.to[1] + 0.55, ev.to[2]], C_SHADOW, 10, 2.0)
        } else {
          if (ev.iceSlid) {
            spawnSparks([ev.to[0], ev.to[1] + 0.2, ev.to[2]], C_FROST, 9, 1.8)
          }
          if (ev.collided && ev.collided !== 'none') {
            vfx.groundRing(ev.to, C_DISPLACE_HAZARD, 0.06, 0.48, 0.22, 1.35, 3.2)
            spawnSparks([ev.to[0], ev.to[1] + 0.6, ev.to[2]], C_FIRE_TIP, 12, 2.4)
            localShake = Math.max(localShake, 0.26)
          }
          if (ev.fallDrop && ev.fallDrop >= 2) {
            spawnDust(ev.to[0], ev.to[1], ev.to[2], 12, 1.45)
            vfx.groundRing(ev.to, C_DISPLACE_HAZARD, 0.08, 0.55, 0.25, 1.5, -2.4)
            localShake = Math.max(localShake, 0.30)
          }
        }
      }
    }
    state.vfx.length = 0
  }

  /** Advance and draw in-flight projectiles: oriented arrows, glowing spell orbs with particle trails. */
  function updateShots(dt: number, time: number) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]
      if (s.delay > 0) {
        s.delay -= dt
        continue
      }
      s.age += dt
      const u = Math.min(1, s.age / s.life)
      const dx = s.to[0] - s.from[0], dy = s.to[1] - s.from[1], dz = s.to[2] - s.from[2]
      const x = s.from[0] + dx * u
      const y = s.from[1] + dy * u + Math.sin(u * Math.PI) * s.peak
      const z = s.from[2] + dz * u
      const col = vfxColor(s.style)
      if (u >= 1) {
        spawnSparks(s.to, s.style === 'arrow' ? C_ARROW : col, s.style === 'arrow' ? 5 : 8, s.style === 'arrow' ? 1.2 : 1.8)
        shots.splice(i, 1)
        continue
      }
      if (s.style === 'arrow') {
        const vy = dy + Math.cos(u * Math.PI) * Math.PI * s.peak
        const yaw = Math.atan2(dx, dz)
        const pitch = -Math.atan2(vy, Math.hypot(dx, dz))
        pool.add(arrowMesh, [x, y, z], [0.9, 0.9, 0.62], quaternionFromEuler(pitch, yaw, 0), C_ARROW, 0.35)
      } else {
        const pulse = 0.24 + Math.sin(time * 40) * 0.03
        pool.add(crystalMesh, [x, y, z], [pulse, pulse, pulse], time * 14, col, 1)
        pool.add(crystalMesh, [x, y, z], [pulse * 1.8, pulse * 1.8, pulse * 1.8], -time * 9, col, 1, 'additive')
        s.trail += dt
        while (s.trail >= 0.016) {
          s.trail -= 0.016
          particles.spawn({
            mesh: crystalMesh,
            blend: 'additive',
            position: [x, y, z],
            velocity: [Math.sin(time * 31 + i) * 0.4, 0.3, Math.cos(time * 29 + i) * 0.4],
            spin: 8,
            scale: [0.16, 0.16, 0.16],
            endScale: 0.05,
            color: col,
            unlit: 1,
            life: 0.28
          })
        }
      }
    }
  }

  /** Fire a queued hit reaction: directional/heavy/block clip, flash, knockback, hit-stop, impact streak. */
  function fireHit(unit: BattleUnit, fx: UnitFx, hit: PendingHit) {
    const dx = unit.x - hit.fromX, dz = unit.z - hit.fromZ
    const dist = Math.hypot(dx, dz)
    const directional = hit.hasAttacker && dist > 0.05
    // Direction the blow travels (attacker -> defender); unsourced damage (burn, cards) knocks from the front
    const attackYaw = directional ? Math.atan2(dx, dz) : fx.yaw + Math.PI
    fx.flashT = hit.blocked ? 0.08 : 0.2
    const at: Vec3 = [unit.x, unit.y, unit.z]
    if (hit.blocked) {
      vfx.impact(at, attackYaw, 'block', 0)
    } else {
      vfx.impact(at, attackYaw, hit.crit ? 'crit' : hit.arc === 'back' ? 'back' : hit.arc === 'flank' ? 'flank' : 'hit', 0)
      if (hit.absorbed > 0) vfx.sparks([unit.x, unit.y + 0.85, unit.z], VFX_COLORS.frost, 6, 1.6)
    }
    if (hit.crit || hit.arc === 'back') hitStop = Math.max(hitStop, hit.crit && hit.arc === 'back' ? 0.15 : 0.1)
    if (!unit.alive) return
    // Which side of the defender the blow came from (clip convention: local +X is the unit's left)
    const sideX = Math.cos(fx.yaw), sideZ = -Math.sin(fx.yaw)
    const side = (-dx) * sideX + (-dz) * sideZ > 0 ? 'left' : 'right'
    startAction(fx, hit.blocked ? 'block' : hitClipFor(hit.arc, side, hit.crit), 0.03)
    const kb = hit.blocked ? 0.12 : (hit.arc === 'back' ? 0.34 : hit.arc === 'flank' ? 0.28 : 0.24) * (hit.crit ? 1.4 : 1)
    if (directional) {
      fx.kbX = (dx / dist) * kb
      fx.kbZ = (dz / dist) * kb
    }
  }

  /** Persistent status VFX: embers (burn), frost rings (slow), gold aura (empower), aggro spikes (taunt), wind rings (haste), toxic bubbles (poison). */
  function drawStatusAura(unit: BattleUnit, fx: UnitFx, px: number, py: number, pz: number, scale: number, realDt: number, time: number) {
    fx.auraTimer -= realDt
    if (fx.auraTimer <= 0) {
      fx.auraTimer = 0.11
      if (unit.burnTurns > 0) vfx.embers([px, py + 0.25, pz], 2, 0.28)
      if (unit.empowerTurns > 0) vfx.motes([px, py, pz], VFX_COLORS.gold, 2, 0.42 * scale, 1.2, 0, 0.8)
      if (unit.slowTurns > 0) vfx.motes([px, py + 0.9 * scale, pz], VFX_COLORS.ice, 1, 0.3 * scale, -0.4, 0, 0.6)
      if (unit.tauntTurns > 0) vfx.motes([px, py + 0.2 * scale, pz], VFX_COLORS.taunt, 2, 0.52 * scale, 1.0, 0, 0.65)
      if (unit.hasteTurns > 0) vfx.motes([px, py + 0.35 * scale, pz], VFX_COLORS.haste, 2, 0.46 * scale, 1.7, 0, 0.55)
      if (unit.poisonStacks > 0) {
        const bubbleCount = Math.min(3, Math.max(1, Math.ceil(unit.poisonStacks / 2)))
        for (let i = 0; i < bubbleCount; i++) {
          const a = time * 3.1 + i * 2.1 + fx.seed * 6.28
          const r = (0.24 + (i % 2) * 0.14) * scale
          particles.spawn({
            mesh: roundPebble,
            blend: 'alpha',
            alphaFade: true,
            position: [px + Math.cos(a) * r, py + 0.22 * scale, pz + Math.sin(a) * r],
            velocity: [Math.cos(a) * 0.12, 0.85 + (i % 3) * 0.22, Math.sin(a) * 0.12],
            gravity: -0.25,
            spin: 4,
            scale: [0.09 * scale, 0.09 * scale, 0.09 * scale],
            endScale: 1.5,
            color: i % 2 === 0 ? [C_POISON[0], C_POISON[1], C_POISON[2], 0.88] : [C_VENOM[0], C_VENOM[1], C_VENOM[2], 0.82],
            unlit: 0.95,
            life: 0.72
          })
        }
      }
    }
    if (unit.burnTurns > 0) {
      for (let i = 0; i < 3; i++) {
        const a = time * 2.2 + (i / 3) * Math.PI * 2
        const fl = 0.16 + Math.sin(time * 26 + i * 2.3) * 0.04
        pool.add(crystalMesh, [px + Math.cos(a) * 0.24 * scale, py + 0.16, pz + Math.sin(a) * 0.24 * scale], [fl, fl * 1.9, fl], a, C_FIRE_CORE, 1, 'additive')
      }
    }
    if (unit.slowTurns > 0) {
      for (let i = 0; i < 2; i++) {
        const h = 0.22 + i * 0.32 + Math.sin(time * 2.4 + i * 1.7) * 0.05
        const r = (0.44 - i * 0.06) * scale
        pool.add(flatRing, [px, py + h * scale, pz], [r, 1, r], time * (i ? -1.4 : 1.1), [0.52, 0.91, 1.0, 0.72], 1, 'additive')
      }
    }
    if (unit.empowerTurns > 0) {
      const r = (0.62 + Math.sin(time * 5) * 0.05) * scale
      pool.add(flatRing, [px, py + 0.06, pz], [r, 1, r], -time * 1.8, [1.0, 0.84, 0.36, 0.8], 1, 'additive')
      const h = ((time * 0.9) % 1)
      pool.add(flatRing, [px, py + 0.1 + h * 1.5 * scale, pz], [r * (1 - h * 0.4), 1, r * (1 - h * 0.4)], time, [1.0, 0.9, 0.5, 0.7 * (1 - h)], 1, 'additive')
    }
    if (unit.tauntTurns > 0) {
      // Golden-crimson aggro shield perimeter ring + 4 orbiting guard spikes
      const pulse = 1 + Math.sin(time * 6.4) * 0.08
      const r = 0.72 * scale * pulse
      pool.add(flatRing, [px, py + 0.075, pz], [r, 1, r], time * 1.6, [C_TAUNT[0], C_TAUNT[1], C_TAUNT[2], 0.88], 1, 'additive')
      pool.add(flatRing, [px, py + 0.12, pz], [0.54 * scale, 1, 0.54 * scale], -time * 2.4, [1.0, 0.82, 0.34, 0.78], 1, 'additive')
      for (let i = 0; i < 4; i++) {
        const a = time * 1.9 + (i / 4) * Math.PI * 2
        const sr = 0.62 * scale
        const sy = py + (0.48 + Math.sin(time * 5 + i * 1.5) * 0.08) * scale
        const q = quaternionFromEuler(0.45, a, 0)
        pool.add(
          crystalMesh,
          [px + Math.sin(a) * sr, sy, pz + Math.cos(a) * sr],
          [0.10 * scale, 0.24 * scale, 0.10 * scale],
          q,
          i % 2 === 0 ? C_TAUNT : C_STAR2_GOLD,
          1,
          'additive'
        )
      }
    }
    if (unit.hasteTurns > 0) {
      // Bright cyan-emerald speed rings + fast orbiting wind streaks
      const r0 = (0.58 + Math.sin(time * 8.5) * 0.04) * scale
      pool.add(flatRing, [px, py + 0.14 * scale, pz], [r0, 1, r0], time * 4.8, [C_HASTE[0], C_HASTE[1], C_HASTE[2], 0.82], 1, 'additive')
      pool.add(flatRing, [px, py + 0.62 * scale, pz], [r0 * 0.82, 1, r0 * 0.82], -time * 5.6, [0.76, 1.0, 0.94, 0.68], 1, 'additive')
      for (let i = 0; i < 3; i++) {
        const a = time * 5.4 + (i / 3) * Math.PI * 2
        const wr = 0.54 * scale
        const wy = py + (0.28 + ((time * 1.8 + i / 3) % 1) * 1.05) * scale
        pool.add(
          crystalMesh,
          [px + Math.cos(a) * wr, wy, pz + Math.sin(a) * wr],
          [0.05 * scale, 0.05 * scale, 0.28 * scale],
          -a,
          C_HASTE,
          1,
          'additive'
        )
      }
    }
    if (unit.poisonStacks > 0) {
      // Pulsing acid-green miasma ring + stack-scaled rising toxic-violet / acid-green bubbling orbs
      const pr = (0.46 + Math.sin(time * 4.2) * 0.04) * scale
      pool.add(flatRing, [px, py + 0.068, pz], [pr, 1, pr], -time * 1.4, [C_POISON[0], C_POISON[1], C_POISON[2], 0.72], 1, 'additive')
      const orbCount = Math.min(5, Math.max(2, unit.poisonStacks + 1))
      for (let i = 0; i < orbCount; i++) {
        const phase = (time * 0.95 + i / orbCount + fx.seed) % 1
        const a = time * 2.0 + (i / orbCount) * Math.PI * 2
        const r = (0.30 + Math.sin(phase * Math.PI) * 0.16) * scale
        const s = (0.08 + Math.sin(phase * Math.PI) * 0.06) * scale
        const col: Color = i % 2 === 0
          ? [C_POISON[0], C_POISON[1], C_POISON[2], 0.88 * (1 - phase * 0.35)]
          : [C_VENOM[0], C_VENOM[1], C_VENOM[2], 0.85 * (1 - phase * 0.35)]
        pool.add(
          roundPebble,
          [px + Math.cos(a) * r, py + (0.18 + phase * 1.25) * scale, pz + Math.sin(a) * r],
          [s, s, s],
          a,
          col,
          0.95,
          'alpha'
        )
      }
    }
  }

  /** Archetype death flourishes: golem/brute crumble chunks, archon/shaman dissolve wisps, goblin tumble dust. */
  function deathFlourish(unit: BattleUnit, fx: UnitFx, before: number, after: number, scale: number) {
    const crossed = (t: number) => before < t && after >= t
    if (fx.deathClip === 'death_crumble' && crossed(0.55)) {
      localShake = Math.max(localShake, 0.12)
      const ice = unit.enemyId === 'frost_golem' || unit.enemyId === 'frostwyrm_rimefang'
      const magma = unit.enemyId === 'magma_warden'
      const troll = unit.enemyId === 'river_troll'
      const chunkCol: Color = ice ? [0.74, 0.90, 1.0, 1]
        : magma ? [0.96, 0.38, 0.14, 1]
        : troll ? [0.28, 0.56, 0.44, 1]
        : [0.42, 0.36, 0.30, 1]
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2
        particles.spawn({
          mesh: roundPebble,
          position: [unit.x + Math.cos(a) * 0.2, unit.y + 0.6 * scale, unit.z + Math.sin(a) * 0.2],
          velocity: [Math.cos(a) * 1.6, 1.8 + (i % 3) * 0.6, Math.sin(a) * 1.6],
          gravity: 7,
          spin: 6,
          scale: [0.16, 0.13, 0.16],
          endScale: 0.5,
          color: chunkCol,
          unlit: ice ? 0.4 : magma ? 0.85 : 0.1,
          life: 0.8
        })
      }
      vfx.dust([unit.x, unit.y, unit.z], 10, 1.6)
    } else if (fx.deathClip === 'death_dissolve' && after > 0.15) {
      fx.auraTimer -= after - before
      if (fx.auraTimer <= 0) {
        fx.auraTimer = 0.05
        vfx.motes([unit.x, unit.y + 0.4 * scale, unit.z], unit.isBoss ? C_SHADOW : C_ENEMY_SOUL, 2, 0.35 * scale, 1.6, 0, 0.7)
      }
    } else if (fx.deathClip === 'death_tumble' && crossed(0.5)) {
      vfx.dust([unit.x, unit.y, unit.z], 6, 1.1)
    } else if (fx.deathClip === 'death_kneel' && crossed(0.3)) {
      vfx.dust([unit.x, unit.y, unit.z], 4, 0.7)
    }
  }

  function renderUnit(
    battle: BattleState,
    unit: BattleUnit,
    dt: number,
    realDt: number,
    isActive: boolean,
    isSelected: boolean,
    time: number,
    pickerExposureLevel?: FacingExposureLevel | null
  ) {
    const fx = getFx(unit.uid, unit)
    const anim = fx.anim
    const rig = unit.team === 'ally' && unit.heroId
      ? resolveHeroRig(unit.heroId, {
          stars: unit.stars,
          weaponId: unit.weaponId,
          armorId: unit.armorId,
          relicId: unit.relicId
        })
      : ENEMY_RIGS[unit.enemyId ?? 'goblin']

    const fpSize = getUnitFootprintSize(unit)
    const scale = unit.enemyId === 'frostwyrm_rimefang' ? 1.78
      : unit.enemyId === 'eclipse_archon' ? 1.38
      : unit.enemyId === 'lich_vaelen' ? 1.36
      : unit.isBoss ? 1.32
      : unit.enemyId === 'frost_golem' || unit.enemyId === 'river_troll' ? 1.24
      : unit.enemyId === 'goblin' || unit.enemyId === 'bone_thrall' ? 0.90
      : unit.stars === 3 ? 1.12
      : unit.stars === 2 ? 1.05
      : 1.0

    fx.flashT = Math.max(0, fx.flashT - realDt)
    const queued = fx.hitQueue
    if (queued) {
      queued.t -= dt
      if (queued.t <= 0) {
        fx.hitQueue = null
        fireHit(unit, fx, queued)
      }
    }

    // ---------------------------------------------------------------- downed (3-turn KO revive window) & permanent death
    // A unit killed by a blow still in flight stays standing until that blow visually connects.
    if (!unit.alive && !fx.hitQueue) {
      if (isUnitDowned(unit)) {
        if (fx.wasAlive || !fx.wasDowned) {
          fx.wasAlive = false
          fx.wasDowned = true
          fx.deathT = 0
          fx.action = null
          fx.statusQueue = null
          fx.deathClip = 'death_kneel'
          fx.flashT = Math.max(fx.flashT, 0.12)
          anim.trigger(fx.deathClip, 0.04)
          const killer = getUnitByUid(battle, battle.activeUnitUid)
          if (killer && killer !== unit) {
            const kdx = killer.x - unit.x, kdz = killer.z - unit.z
            if (Math.hypot(kdx, kdz) > 0.05) fx.yaw = Math.atan2(kdx, kdz)
          }
        }
        const before = fx.deathT
        fx.deathT = Math.min(DEATH_SINK_START - 0.05, Math.max(0, fx.deathT) + dt)
        deathFlourish(unit, fx, before, fx.deathT, scale)
        anim.step(dt)
        const pose = anim.evaluate()
        const kbDecay = Math.pow(0.002, dt)
        fx.kbX *= kbDecay
        fx.kbZ *= kbDecay
        fx.pos[0] = unit.x + fx.kbX
        fx.pos[1] = unit.y
        fx.pos[2] = unit.z + fx.kbZ
        const flash = fx.flashT > 0
        renderRig(
          rig,
          { position: fx.pos, yaw: fx.yaw, scale },
          pose,
          pool,
          flash
            ? () => C_HIT_FLASH
            : (_joint, part) => [
                part.color[0] * 0.65 + 0.14,
                part.color[1] * 0.58 + 0.08,
                part.color[2] * 0.52 + 0.04,
                (part.color[3] ?? 1) * 0.72
              ]
        )
        shadows.add([unit.x, unit.y + 0.02, unit.z], { groundY: unit.y, radius: 0.62 * scale, opacity: 0.24 })

        // Pulsing KO countdown halo + floating crystal (amber 3 -> orange 2 -> red 1)
        const cd = Math.max(1, Math.min(3, unit.koCountdown))
        const koCol = cd === 1 ? C_KO_1 : cd === 2 ? C_KO_2 : C_KO_3
        const pulseSpeed = cd === 1 ? 8.5 : cd === 2 ? 6.0 : 4.2
        const pulseR = (0.72 + Math.sin(time * pulseSpeed) * 0.075) * scale
        const haloY = unit.y + 0.055
        pool.add(flatRing, [unit.x, haloY, unit.z], [pulseR, 1, pulseR], time * (cd === 1 ? 2.6 : 1.5), koCol, 1.0, 'additive')
        pool.add(flatRing, [unit.x, haloY + 0.02, unit.z], [pulseR * 0.68, 1, pulseR * 0.68], -time * 2.1, C_HOLY, 0.95, 'additive')
        const crystalY = unit.y + 1.18 * scale + Math.sin(time * pulseSpeed * 0.8) * 0.09
        pool.add(crystalMesh, [unit.x, crystalY, unit.z], [0.16 * scale, 0.28 * scale, 0.16 * scale], time * 3.0, koCol, 1.0, 'additive')
        for (let i = 0; i < cd; i++) {
          const a = time * 2.2 + (i / cd) * Math.PI * 2
          const ox = unit.x + Math.cos(a) * 0.44 * scale
          const oz = unit.z + Math.sin(a) * 0.44 * scale
          pool.add(crystalMesh, [ox, crystalY - 0.16, oz], [0.08 * scale, 0.12 * scale, 0.08 * scale], -time * 3.6 + i, koCol, 1.0, 'additive')
        }
        return
      }

      if (fx.wasDowned) {
        // Countdown hit 0: transition cleanly from collapsed pose into soul-mote fade-out
        fx.wasDowned = false
        fx.deathT = DEATH_SINK_START - 0.01
      } else if (fx.wasAlive) {
        fx.wasAlive = false
        fx.deathT = 0
        fx.action = null
        fx.statusQueue = null
        fx.deathClip = deathClipFor(unit.heroId, unit.enemyId, unit.isBoss)
        fx.flashT = Math.max(fx.flashT, 0.12)
        anim.trigger(fx.deathClip, 0.04)
        const killer = getUnitByUid(battle, battle.activeUnitUid)
        if (killer && killer !== unit) {
          const kdx = killer.x - unit.x, kdz = killer.z - unit.z
          // Face the killer so the backward topple flies away from the blow
          if (Math.hypot(kdx, kdz) > 0.05) fx.yaw = Math.atan2(kdx, kdz)
        }
      }
      if (fx.deathT < 0 || fx.deathT > DEATH_TOTAL) return
      const before = fx.deathT
      fx.deathT += dt
      deathFlourish(unit, fx, before, fx.deathT, scale)
      if (before < DEATH_SINK_START && fx.deathT >= DEATH_SINK_START) {
        spawnDust(unit.x, unit.y, unit.z, 8, 1.4)
        const soul = unit.team === 'ally' ? C_ALLY_SOUL : C_ENEMY_SOUL
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2
          particles.spawn({
            mesh: crystalMesh,
            blend: 'additive',
            position: [unit.x + Math.cos(a) * 0.3, unit.y + 0.25, unit.z + Math.sin(a) * 0.3],
            velocity: [Math.cos(a) * 0.4, 1.6 + (i % 3) * 0.5, Math.sin(a) * 0.4],
            gravity: -0.6,
            spin: 7,
            scale: [0.10, 0.16, 0.10],
            endScale: 0.1,
            color: soul,
            unlit: 1,
            life: 0.9
          })
        }
      }
      anim.step(dt)
      const pose = anim.evaluate()
      const sink = fx.deathT > DEATH_SINK_START ? Math.min(1, (fx.deathT - DEATH_SINK_START) / DEATH_SINK_TIME) : 0
      // Dissolving casters shrink away faster; everyone else sinks into the ground
      const shrink = fx.deathClip === 'death_dissolve' ? 0.85 : 0.6
      const ds = Math.max(0.02, scale * (1 - sink * sink * shrink))
      fx.pos[0] = unit.x + fx.kbX
      fx.pos[1] = unit.y - sink * (fx.deathClip === 'death_dissolve' ? 0.1 : 0.45)
      fx.pos[2] = unit.z + fx.kbZ
      const kbDecay = Math.pow(0.002, dt)
      fx.kbX *= kbDecay
      fx.kbZ *= kbDecay
      const flash = fx.flashT > 0
      renderRig(rig, { position: fx.pos, yaw: fx.yaw, scale: ds }, pose, pool, flash ? () => C_HIT_FLASH : undefined)
      shadows.add([unit.x, unit.y + 0.02, unit.z], { groundY: unit.y, radius: 0.62 * ds, opacity: 0.30 * (1 - sink) })
      return
    }
    if (!fx.wasAlive && unit.alive) {
      // Hero was revived: spring back onto their feet!
      startAction(fx, 'ready', 0.06)
    }
    fx.wasAlive = true
    fx.wasDowned = false
    fx.deathT = -1

    // ---------------------------------------------------------------- action triggers (edge-detected from sim state)
    const st = unit.animState
    const retrigger = st !== fx.lastState || unit.animTimer > fx.lastTimer + 1e-3
    if (retrigger && (st === 'attack' || st === 'cast')) {
      // Skills, enemy specials, and weapon overrides pick their clip from the matching VFX event
      const clip: UnitClipName = fx.pendingClip
        ?? (st === 'attack' ? attackClipFor(unit.heroId, unit.enemyId, unit.weaponId) : castClipFor(unit.heroId, unit.enemyId))
      fx.pendingClip = null
      startAction(fx, clip, 0.05)
    }
    // Sim 'hit' edges are ignored: hits are queued from impact events and fire when the blow connects.
    fx.lastState = st
    fx.lastTimer = unit.animTimer

    // Facing-pivot footwork when the unit is turned in place (Wait-to-Face / Turn Facing / AI end-of-turn)
    const teleported = unit.path.length === 0 && st === 'idle' &&
      (Math.abs(unit.col - fx.lastCol) + Math.abs(unit.row - fx.lastRow) > 1)
    if (teleported) {
      fx.yaw = unit.yaw
      fx.simYaw = unit.yaw
      fx.action = null
    }
    const yawJump = wrapAngle(unit.yaw - fx.simYaw)
    fx.simYaw = unit.yaw
    const canRetriggerTurn = !fx.action || fx.action === 'turn_l' || fx.action === 'turn_r' || fx.action === 'turn_about'
    if (!teleported && Math.abs(yawJump) > 0.3 && st === 'idle' && !retrigger && canRetriggerTurn && unit.path.length === 0) {
      startAction(fx, turnClipFor(Math.abs(yawJump) > 2.4 ? 'about' : yawJump > 0 ? 'left' : 'right'), 0.05)
    }

    // Status onset & DoT-tick reactions (burn/poison flinch, freeze shiver, stun stagger, taunt roar, haste/empower flex)
    const burnTicked = unit.burnTurns < fx.prevBurn && fx.hitQueue !== null && !fx.hitQueue.hasAttacker
    const poisonTicked = unit.poisonStacks < fx.prevPoison && fx.hitQueue !== null && !fx.hitQueue.hasAttacker
    const onset = unit.stunTurns > fx.prevStun ? 'stun'
      : (unit.burnTurns > fx.prevBurn || burnTicked) ? 'burn'
      : (unit.poisonStacks > fx.prevPoison || poisonTicked) ? 'poison'
      : unit.slowTurns > fx.prevSlow ? 'slow'
      : unit.tauntTurns > fx.prevTaunt ? 'taunt'
      : unit.hasteTurns > fx.prevHaste ? 'haste'
      : unit.empowerTurns > fx.prevEmpower ? 'empower'
      : null
    if (burnTicked) vfx.embers([unit.x, unit.y + 0.4, unit.z], 6, 0.35)
    if (poisonTicked) vfx.motes([unit.x, unit.y + 0.35, unit.z], VFX_COLORS.poison, 8, 0.38, 1.4, 0, 0.7)
    fx.prevStun = unit.stunTurns
    fx.prevBurn = unit.burnTurns
    fx.prevSlow = unit.slowTurns
    fx.prevEmpower = unit.empowerTurns
    fx.prevTaunt = unit.tauntTurns
    fx.prevHaste = unit.hasteTurns
    fx.prevPoison = unit.poisonStacks
    if (onset) fx.statusQueue = statusClipFor(onset)

    if (fx.pendingReady && st === 'idle' && !fx.action && unit.path.length === 0) {
      fx.pendingReady = false
      startAction(fx, 'ready', 0.06)
    }
    if (fx.statusQueue && !fx.action && !fx.hitQueue && st !== 'run' && unit.path.length === 0) {
      startAction(fx, fx.statusQueue, 0.08)
      fx.statusQueue = null
    }

    // ---------------------------------------------------------------- clip selection
    const gait: Gait = gaitFor(unit.heroId, unit.enemyId)
    const isForecastAttacker = Boolean(
      activeForecast &&
      battle.phase === 'player' &&
      (activeForecast.attackerUid === unit.uid || activeForecast.pincerAssisterUid === unit.uid) &&
      unit.path.length === 0 &&
      st !== 'run' &&
      !fx.action
    )
    if (st === 'run') {
      fx.action = null
      fx.pendingReady = false
      anim.play(runClipFor(gait), 0.08, runRateFor(gait))
    } else if (fx.action) {
      fx.actionT += dt
      if (fx.actionT >= fx.actionDur) fx.action = null
    }
    if (!fx.action && st !== 'run') {
      const victory = battle.phase === 'victory' && unit.team === 'ally'
      const gloat = battle.phase === 'defeat' && unit.team === 'enemy'
      if (victory || gloat || st === 'celebrate') {
        if (fx.celebrateDelay < 0) fx.celebrateDelay = fx.seed * 0.45
        fx.celebrateDelay = Math.max(0, fx.celebrateDelay - dt)
      } else {
        fx.celebrateDelay = -1
      }
      if (fx.celebrateDelay === 0) {
        anim.play(gloat ? 'taunt' : celebrateClipFor(fx.seed2), 0.12)
      } else if (isForecastAttacker && activeForecast) {
        anim.play(aimClipFor(unit.heroId, unit.enemyId, activeForecast.mode !== 'strike', unit.weaponId), 0.12)
      } else {
        anim.play(idleClipFor(unit.team, unit.hp / Math.max(1, unit.maxHp), unit.stunTurns > 0), 0.18, idleRateFor(unit.enemyId, fx.seed2))
      }
    }
    anim.step(dt)

    // ---------------------------------------------------------------- smooth facing, knockback, hops, footfalls
    let desiredYaw = unit.yaw
    if (isForecastAttacker && activeForecast) {
      const tCell = battle.cells[activeForecast.targetRow]?.[activeForecast.targetCol]
      if (tCell) {
        const [tx, , tz] = gridToWorld(activeForecast.targetCol, activeForecast.targetRow, tCell.elevation, battle.cols, battle.rows)
        if (Math.hypot(tx - unit.x, tz - unit.z) > 0.05) {
          desiredYaw = Math.atan2(tx - unit.x, tz - unit.z)
        }
      }
    }
    fx.yaw += wrapAngle(desiredYaw - fx.yaw) * Math.min(1, realDt * 14)
    const kbDecay = Math.pow(0.002, dt)
    fx.kbX *= kbDecay
    fx.kbZ *= kbDecay

    let extraY = 0
    let leapK = 0
    if (unit.path.length > 0) {
      const next = unit.path[0]
      const e0 = battle.cells[unit.row][unit.col].elevation
      const e1 = battle.cells[next.row][next.col].elevation
      const de = Math.abs(e1 - e0)
      if (de > 0.1) {
        const s = Math.sin(Math.min(1, unit.moveProgress) * Math.PI)
        extraY = s * (0.22 + de * 0.45)
        leapK = s
      }
    }
    if (unit.col !== fx.lastCol || unit.row !== fx.lastRow) {
      const elev = battle.cells[unit.row][unit.col].elevation
      const jumped = Math.abs(elev - fx.lastElev) > 0.1
      const heavyStep = gait === 'stomp' || gait === 'heavy'
      if (gait !== 'glide') spawnDust(unit.x, unit.y, unit.z, jumped ? 7 : heavyStep ? 5 : 3, jumped ? 1.3 : heavyStep ? 1.0 : 0.7)
      // Lumbering stompers rattle the camera on every footfall
      if (gait === 'stomp') localShake = Math.max(localShake, 0.07 * scale)
      fx.landT = 0
      fx.landAmp = jumped ? 0.18 : gait === 'stomp' ? 0.12 : gait === 'glide' ? 0.02 : 0.07
      fx.lastCol = unit.col
      fx.lastRow = unit.row
      fx.lastElev = elev
    }
    fx.landT += dt
    const squash = fx.landT < 0.2 ? Math.sin((fx.landT / 0.2) * Math.PI) * fx.landAmp : 0

    const clip = anim.clip
    const idleFamily = clip === 'idle' || clip === 'idle_enemy'
    fx.stanceW += ((idleFamily ? 1 : 0) - fx.stanceW) * Math.min(1, dt * 8)
    const additive = fillAdditive(fx, stanceOffsetFor(unit.heroId, unit.enemyId), fx.stanceW, leapK)
    const pose = anim.evaluate(additive)

    let slideOffX = 0
    let slideOffY = 0
    let slideOffZ = 0
    if (fx.slideDur > 0 && fx.slideT < fx.slideDur) {
      fx.slideT = Math.min(fx.slideDur, fx.slideT + dt)
      const u = fx.slideT / fx.slideDur
      const rem = Math.pow(1 - u, 3)
      slideOffX = fx.slideFromX * rem
      slideOffY = fx.slideFromY * rem + Math.sin(u * Math.PI) * fx.slideArc
      slideOffZ = fx.slideFromZ * rem
      if (fx.slideT >= fx.slideDur) {
        fx.slideDur = 0
        fx.slideKind = null
        fx.landT = 0
        fx.landAmp = 0.16
      }
    }

    const hoverY = unit.enemyId === 'ice_wraith'
      ? 0.14 + Math.sin(time * 3.4 + fx.seed * 6) * 0.08
      : unit.enemyId === 'lich_vaelen'
        ? 0.09 + Math.sin(time * 2.6 + fx.seed * 6) * 0.05
        : 0
    const px = unit.x + unit.lungeX + fx.kbX + slideOffX
    const pz = unit.z + unit.lungeZ + fx.kbZ + slideOffZ
    const py = unit.y + extraY + slideOffY + hoverY
    const flash = fx.flashT > 0
    fx.pos[0] = px
    fx.pos[1] = py
    fx.pos[2] = pz
    fx.scl[0] = scale * (1 + squash * 0.6)
    fx.scl[1] = scale * (1 - squash)
    fx.scl[2] = scale * (1 + squash * 0.6)

    const shrouded = isEnemyShrouded(battle, unit)
    const colorOverride = flash
      ? () => C_HIT_FLASH
      : shrouded
        ? () => C_FOG_SHROUD_UNIT
        : undefined
    renderRig(rig, { position: fx.pos, yaw: fx.yaw, scale: fx.scl }, pose, pool, colorOverride)

    const groundY = unit.y
    shadows.add([px, groundY + 0.02, pz], {
      groundY,
      radius: (fpSize === 2 ? 1.55 : 0.58 * scale) * (1 - Math.min(0.35, extraY * 0.5)),
      opacity: shrouded ? 0.14 : 0.30
    })

    if (shrouded) {
      // Shrouded in Fog of War: dim smoky ground veil, hide telemetry rings/chevrons/auras until spotted
      const fogPulse = (0.68 + Math.sin(time * 2.2 + unit.col + unit.row) * 0.08) * scale
      pool.add(flatRing, [px, groundY + 0.05, pz], [fogPulse, 1, fogPulse], time * 0.4, C_FOG_MIST, 0.9, 'alpha')
      return
    }

    // Colorblind-safe unit rings: Allies use smooth Circle ring, Enemies use Diamond ring + directional facing chevron!
    const ringColor = isActive ? C_ACTIVE_RING : isSelected ? C_SELECT_RING : unit.team === 'ally' ? C_ALLY_RING : C_ENEMY_RING
    const ringScale = (isActive ? 0.68 + Math.sin(time * 6) * 0.045 : 0.54) * scale
    if (fpSize === 2) {
      // Highlight all 4 tiles of a 2x2 raid boss's footprint so players can read its full hitbox clearly
      const fpCells = getUnitFootprintCells(unit)
      for (const fc of fpCells) {
        const fCell = battle.cells[fc.row]?.[fc.col]
        if (!fCell) continue
        const [fxw, fyw, fzw] = gridToWorld(fc.col, fc.row, fCell.elevation, battle.cols, battle.rows)
        pool.add(tileDiamondMesh, [fxw, fyw + 0.040, fzw], [TILE_SIZE * 0.72, 1, TILE_SIZE * 0.72], 0, ringColor, 0.72, 'alpha')
      }
      pool.add(flatRing, [px, groundY + 0.046, pz], [TILE_SIZE * 0.98, 1, TILE_SIZE * 0.98], time * 0.5, ringColor, 0.92, 'additive')
    } else if (unit.team === 'enemy') {
      pool.add(tileDiamondMesh, [px, groundY + 0.040, pz], [ringScale * 2.5, 1, ringScale * 2.5], 0, ringColor, 0.96, 'alpha')
    } else {
      pool.add(flatRing, [px, groundY + 0.038, pz], [ringScale, 1, ringScale], time * (isActive ? 1.1 : 0), ringColor, 0.95, 'alpha')
    }
    const facingCol = pickerExposureLevel === 'back'
      ? C_PICKER_BACK
      : pickerExposureLevel === 'flank'
        ? C_PICKER_FLANK
        : pickerExposureLevel === 'safe'
          ? C_PICKER_SAFE
          : isActive
            ? C_ACTIVE_RING
            : unit.team === 'ally'
              ? C_FACING_ALLY
              : C_FACING_ENEMY
    const chevronPulse = pickerExposureLevel ? (1.28 + Math.sin(time * 7.0) * 0.08) : (isActive ? 1.16 : 0.96)
    const chevronS = chevronPulse * scale
    pool.add(facingChevronMesh, [px, groundY + 0.046, pz], [chevronS, 1, chevronS], facingToYaw(unit.facing), facingCol, 0.98, 'alpha')

    if (unit.team === 'ally' && unit.stars >= 2) {
      const crownY = py + (1.72 + Math.sin(time * 3.4) * 0.05) * scale
      pool.add(crownMesh, [px, crownY, pz], [0.28, 0.22, 0.28], time * 1.1, C_STAR2_GOLD, 0.78)
    }
    if (unit.team === 'ally' && unit.stars >= 3) {
      pool.add(flatRing, [px, groundY + 0.056, pz], [0.76 * scale, 1, 0.76 * scale], -time * 1.4, C_STAR3_HALO, 0.95, 'additive')
    }
    if (unit.shield > 0) {
      pool.add(flatRing, [px, py + 0.56 * scale, pz], [0.58 * scale, 1, 0.58 * scale], time * 1.8, C_SHIELD, 0.9, 'additive')
    }
    if (spotlightUnitUid && unit.uid === spotlightUnitUid) {
      const spotCol = unit.team === 'ally' ? C_SPOTLIGHT_ALLY : C_SPOTLIGHT_ENEMY
      const beamCol = unit.team === 'ally' ? C_SPOTLIGHT_ALLY_BEAM : C_SPOTLIGHT_ENEMY_BEAM
      const pulse = 1 + Math.sin(time * 7.2) * 0.08
      const beamH = (unit.isBoss ? 4.2 : 3.4) * scale
      const beamW = (unit.isBoss ? 1.15 : 0.92) * scale * (1 + Math.sin(time * 5.0) * 0.05)
      // Pulsing outer golden-cyan / amber-crimson ground ring + counter-rotating gold inner ring
      pool.add(flatRing, [px, groundY + 0.062, pz], [0.88 * scale * pulse, 1, 0.88 * scale * pulse], time * 2.2, spotCol, 1.0, 'additive')
      pool.add(flatRing, [px, groundY + 0.068, pz], [0.64 * scale, 1, 0.64 * scale], -time * 2.8, C_SPOTLIGHT_GOLD, 1.0, 'additive')
      // Vertical translucent spotlight shaft rising from unit tile
      pool.add(spotlightBeamMesh, [px, groundY + 0.05, pz], [beamW, beamH, beamW], time * 0.65, beamCol, 1.0, 'additive')
      // Elevated hovering halo ring & spinning crystal beacon above the unit's head
      const haloY = py + (unit.isBoss ? 2.55 : 2.12) * scale + Math.sin(time * 6.0) * 0.08
      pool.add(flatRing, [px, haloY, pz], [0.54 * scale * pulse, 1, 0.54 * scale * pulse], -time * 2.6, C_SPOTLIGHT_GOLD, 1.0, 'additive')
      pool.add(crystalMesh, [px, haloY + 0.24, pz], [0.14 * scale, 0.24 * scale, 0.14 * scale], time * 3.8, spotCol, 1.0, 'additive')
    }
    drawStatusAura(unit, fx, px, groundY, pz, scale, realDt, time)
    if (unit.stunTurns > 0) {
      for (let i = 0; i < 3; i++) {
        const a = time * 4 + (i / 3) * Math.PI * 2
        pool.add(crystalMesh, [px + Math.cos(a) * 0.3, py + 1.7 * scale, pz + Math.sin(a) * 0.3], [0.08, 0.10, 0.08], a, C_FIRE_TIP, 1)
      }
    }
    if (unit.isBoss) {
      const bossCrystalCol = unit.enemyId === 'magma_warden' ? C_FIRE_CORE
        : unit.enemyId === 'frost_jarl' || unit.enemyId === 'frostwyrm_rimefang' ? C_FROST
        : unit.enemyId === 'mire_matriarch' || unit.enemyId === 'lich_vaelen' ? C_POISON
        : unit.enemyId === 'briar_warlord' ? C_STAR2_GOLD
        : C_SHADOW
      const orbitR = fpSize === 2 ? 1.48 : 0.94
      for (let i = 0; i < 3; i++) {
        const a = time * 1.6 + (i / 3) * Math.PI * 2
        pool.add(
          crystalMesh,
          [px + Math.cos(a) * orbitR, py + (fpSize === 2 ? 1.55 : 1.18) + Math.sin(time * 3 + i) * 0.14, pz + Math.sin(a) * orbitR],
          [0.20, 0.30, 0.20],
          a,
          bossCrystalCol,
          0.95
        )
      }
    }
  }

  /** Detect battle swaps, prune removed unit FX, and mark new active units (ready bounce) from sim state. */
  function trackBattleEvents(battle: BattleState) {
    if (battle !== lastBattle) {
      lastBattle = battle
      unitFx.clear()
      shots.length = 0
      particles.clear()
      vfx.clear()
      localShake = 0
      lastFloatId = -1
      lastActiveUid = null
      spotlightUnitUid = null
      inspectedEnemyUid = null
      hitStop = 0
      cameraZoom = 1.0
      cameraZoomActual = 1.0
      cameraPitch = DEFAULT_CAMERA_PITCH
      cameraPitchActual = DEFAULT_CAMERA_PITCH
      cameraPanX = 0
      cameraPanZ = 0
      for (const fn of battle.floatingNumbers) lastFloatId = Math.max(lastFloatId, fn.id)
    } else if (unitFx.size > battle.units.length + 12) {
      const activeUids = new Set(battle.units.map(u => u.uid))
      for (const key of unitFx.keys()) {
        if (!key.startsWith('camp_') && !activeUids.has(key)) {
          unitFx.delete(key)
        }
      }
    }
    for (const fn of battle.floatingNumbers) lastFloatId = Math.max(lastFloatId, fn.id)
    if (battle.activeUnitUid !== lastActiveUid) {
      lastActiveUid = battle.activeUnitUid
      const active = getUnitByUid(battle, battle.activeUnitUid)
      if (active && active.alive && (battle.phase === 'player' || battle.phase === 'enemy')) {
        getFx(active.uid, active).pendingReady = true
      }
    }
  }

  function renderBattle(state: GameState, dt: number, w: number, h: number): Readonly<RenderStats> {
    const battle = state.battle
    if (!battle) return renderer.render(lastMatrix, campBatches)

    ensureBoard(battle)
    applyBattleLightingOnce(battle)
    trackBattleEvents(battle)
    consumeVfx(state)
    // Scale combat animation, hit-stop, particles, and VFX by 1x/2x battle speed while keeping camera motion unscaled.
    const speedMul = battle.battleSpeed === 2 ? 2 : 1
    const fxDt = dt * speedMul
    const animDt = hitStop > 0 ? fxDt * 0.06 : fxDt
    hitStop = Math.max(0, hitStop - fxDt)
    particles.step(fxDt)
    pool.clear()
    shadows.clear()

    const style = BIOME_STYLES[battle.biome]
    localShake = Math.max(0, localShake - fxDt * 1.6)
    const shake = battle.shake + localShake
    const shakeX = shake > 0 ? Math.sin(state.time * 48) * shake * 0.18 : 0
    const shakeY = shake > 0 ? Math.cos(state.time * 54) * shake * 0.12 : 0

    cameraZoomActual += (cameraZoom - cameraZoomActual) * Math.min(1, dt * 14)
    cameraPitchActual += (cameraPitch - cameraPitchActual) * Math.min(1, dt * 14)
    cameraYawActual = stepCameraYaw(cameraYawActual, cameraYawTarget, dt)
    if (Math.abs(cameraYawTarget - cameraYawActual) < 1e-4) {
      cameraYawActual = normalizeCameraYaw(cameraYawTarget)
      cameraYawTarget = cameraYawActual
    }
    const maxPan = Math.max(0, (1.02 - cameraZoomActual) * 8.0)
    cameraPanX = Math.max(-maxPan, Math.min(maxPan, cameraPanX))
    cameraPanZ = Math.max(-maxPan, Math.min(maxPan, cameraPanZ))

    const aspect = Math.max(0.32, w / Math.max(1, h))
    const isPhonePortrait = aspect < 0.85
    const isPhoneLandscape = !isPhonePortrait && h < 480
    const boardScale = Math.max(0.86, Math.max(battle.cols / 8, battle.rows / 6))
    const baseDist = (isPhonePortrait
      ? 14.4 / Math.max(0.40, aspect)
      : isPhoneLandscape ? 15.0
      : aspect < 1.15 ? 16.5 : 14.2) * boardScale
    const baseEyeY = (isPhonePortrait ? baseDist * 0.78 : (isPhoneLandscape ? 12.2 : 11.8) * boardScale)
    const baseHoriz = baseDist * 0.92 + (isPhonePortrait ? 2.0 : 1.2)
    const orbitRadius = Math.hypot(baseHoriz, baseEyeY) * cameraZoomActual
    const horizDist = Math.cos(cameraPitchActual) * orbitRadius
    const eyeY = Math.sin(cameraPitchActual) * orbitRadius
    const camYaw = cameraYawActual
    const sinYaw = Math.sin(camYaw)
    const cosYaw = Math.cos(camYaw)
    const baseTargetOffset = isPhonePortrait ? 0.9 : isPhoneLandscape ? 0.72 : 0.35
    const target: Vec3 = [
      cameraPanX + sinYaw * baseTargetOffset,
      -0.2,
      cameraPanZ + cosYaw * baseTargetOffset
    ]
    const eye: Vec3 = [
      target[0] + sinYaw * horizDist + cosYaw * shakeX,
      eyeY + shakeY,
      target[2] + cosYaw * horizDist - sinYaw * shakeX
    ]
    lastMatrix = multiply(perspective(Math.PI / 3.9, aspect, 0.5, 220), view(eye, target))

    // -1. Dynamic interactive tactical hazards (Barricades, Lava Geysers, Cursed Altars, Ice Sheen, Swaying Tall Grass)
    hazardParticleTimer += dt
    const emitHazardSparks = hazardParticleTimer >= 0.16
    if (emitHazardSparks) hazardParticleTimer = 0
    for (let row = 0; row < battle.rows; row++) {
      for (let col = 0; col < battle.cols; col++) {
        const cell = battle.cells[row][col]
        if (cell.terrain === 'void') continue
        const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
        const phase = col * 1.7 + row * 2.3

        if (isIntactBarricade(cell)) {
          const maxHp = cell.barricadeMaxHp ?? BARRICADE_DEFAULT_HP
          const hp = cell.barricadeHp ?? maxHp
          const dmgFrac = Math.max(0, Math.min(1, 1 - hp / Math.max(1, maxHp)))
          const hScale = 1 - dmgFrac * 0.24
          const tilt = dmgFrac * 0.26
          // 4 sharpened palisade stakes + diagonal timber braces + iron band
          for (let i = 0; i < 4; i++) {
            const ox = (i - 1.5) * 0.34
            const oz = (i % 2 === 0 ? -0.10 : 0.10)
            const sTilt = (i % 2 === 0 ? 1 : -1) * (0.06 + tilt)
            pool.add(
              taperTrunk,
              [wx + ox, wy + 0.50 * hScale, wz + oz],
              [0.18, 1.02 * hScale, 0.18],
              quaternionFromEuler(sTilt, i * 0.4, sTilt * 0.5),
              i % 2 === 0 ? C_WOOD_TIMBER : C_WOOD_TIMBER_DARK
            )
          }
          pool.add(softBevel, [wx, wy + 0.42 * hScale, wz], [1.32, 0.16, 0.22], quaternionFromEuler(0, 0, 0.22 + tilt * 0.4), C_WOOD_TIMBER)
          pool.add(softBevel, [wx, wy + 0.68 * hScale, wz], [1.26, 0.14, 0.20], quaternionFromEuler(0, 0, -0.22 - tilt * 0.4), C_WOOD_TIMBER_DARK)
          pool.add(crispBevel, [wx, wy + 0.54 * hScale, wz], [1.34, 0.10, 0.26], 0, C_IRON_BAND)
          pool.add(roundPebble, [wx - 0.44, wy + 0.08, wz + 0.26], [0.22, 0.16, 0.20], phase, C_IRON_BAND)
          pool.add(roundPebble, [wx + 0.44, wy + 0.08, wz - 0.24], [0.20, 0.14, 0.22], phase + 1.1, C_IRON_BAND)
        } else if (cell.terrain === 'lava_geyser') {
          const pulse = 0.5 + 0.5 * Math.sin(state.time * 5.2 + phase)
          if (cell.geyserActive) {
            const jetH = 1.05 + Math.sin(state.time * 14 + phase) * 0.18
            const jetR = 0.34 + pulse * 0.08
            pool.add(smoothCone, [wx, wy + jetH * 0.46, wz], [jetR, jetH, jetR], state.time * 2.4, C_FIRE_CORE, 0.98)
            pool.add(crystalMesh, [wx, wy + jetH * 0.62, wz], [jetR * 0.72, jetH * 0.78, jetR * 0.72], -state.time * 3.8, C_FIRE_TIP, 1.0, 'additive')
            pool.add(flatRing, [wx, wy + 0.06, wz], [0.66 + pulse * 0.08, 1, 0.66 + pulse * 0.08], state.time * 2.2, C_GEYSER_RING, 1.0, 'additive')
            if (emitHazardSparks) {
              const a = state.time * 4.5 + phase
              particles.spawn({
                mesh: crystalMesh,
                blend: 'additive',
                position: [wx + Math.cos(a) * 0.22, wy + 0.35, wz + Math.sin(a) * 0.22],
                velocity: [Math.cos(a) * 0.5, 2.2 + pulse * 0.8, Math.sin(a) * 0.5],
                gravity: 2.2,
                spin: 9,
                scale: [0.11, 0.15, 0.11],
                endScale: 0.1,
                color: C_FIRE_TIP,
                unlit: 1,
                life: 0.58
              })
            }
          } else {
            // Simmering telegraph before eruption!
            const glowS = 0.22 + pulse * 0.07
            pool.add(crystalMesh, [wx, wy + 0.11, wz], [glowS * 1.4, glowS * 0.7, glowS * 1.4], state.time * 0.9, C_FIRE_CORE, 0.85)
            pool.add(flatRing, [wx, wy + 0.045, wz], [0.50 + pulse * 0.06, 1, 0.50 + pulse * 0.06], -state.time * 0.8, C_GEYSER_WARN, 0.92, 'alpha')
          }
        } else if (cell.terrain === 'cursed_altar') {
          if (!cell.altarUsed) {
            const hover = 0.74 + Math.sin(state.time * 3.6 + phase) * 0.09
            const rPulse = 0.58 + Math.sin(state.time * 4.4 + phase) * 0.06
            pool.add(crystalMesh, [wx, wy + hover, wz - 0.54], [0.22, 0.38, 0.22], state.time * 2.1 + phase, C_SHADOW, 1.0)
            pool.add(crystalMesh, [wx, wy + hover, wz - 0.54], [0.32, 0.48, 0.32], -state.time * 1.6, C_SHADOW, 0.92, 'additive')
            pool.add(flatRing, [wx, wy + 0.06, wz], [rPulse, 1, rPulse], -state.time * 1.5, C_ALTAR_RING, 0.98, 'additive')
            if (emitHazardSparks) {
              const a = state.time * 3.1 + phase
              particles.spawn({
                mesh: crystalMesh,
                blend: 'additive',
                position: [wx + Math.cos(a) * 0.36, wy + 0.14, wz + Math.sin(a) * 0.36],
                velocity: [-Math.sin(a) * 0.25, 1.15, Math.cos(a) * 0.25],
                spin: 7,
                scale: [0.08, 0.12, 0.08],
                endScale: 0.1,
                color: C_SHADOW,
                unlit: 1,
                life: 0.72
              })
            }
          } else {
            // Spent altar: dull dark shard resting low
            pool.add(crystalMesh, [wx, wy + 0.34, wz - 0.54], [0.16, 0.22, 0.16], phase, C_CURSE_DIM, 0.12)
          }
        } else if (cell.terrain === 'ice') {
          const shimmer = 0.5 + 0.5 * Math.sin(state.time * 2.8 + phase)
          const glint = 0.14 + shimmer * 0.09
          pool.add(tileQuad, [wx, wy + 0.022, wz], [TILE_SIZE * 0.68, 1, TILE_SIZE * 0.16], 0.78, C_ICE_SHEEN, 0.95, 'alpha')
          pool.add(crystalMesh, [wx - 0.42, wy + 0.05, wz + 0.38], [glint, glint * 0.55, glint], state.time * 0.8 + phase, C_FROST, 0.92, 'additive')
        } else if (cell.terrain === 'tall_grass') {
          const sway = Math.sin(state.time * 2.5 + phase) * 0.14
          const tufts: readonly (readonly [number, number, number])[] = [
            [-0.46, -0.42, 0.52],
            [0.44, -0.38, 0.48],
            [-0.44, 0.42, 0.50],
            [0.46, 0.40, 0.54],
            [0.02, -0.48, 0.46]
          ]
          for (let i = 0; i < tufts.length; i++) {
            const [ox, oz, h] = tufts[i]
            const lean = sway + Math.sin(state.time * 3.1 + phase + i) * 0.05
            pool.add(
              smoothCone,
              [wx + ox, wy + h * 0.48, wz + oz],
              [0.16, h, 0.16],
              quaternionFromEuler(lean, phase + i * 1.2, lean * 0.7),
              i % 2 === 0 ? C_GRASS_BLADE : C_GRASS_TIP
            )
          }
        }
      }
    }

    // 0. Enemy Danger Zone & Individual Enemy Threat overlays (layered cleanly below Move/Target/AoE!)
    const isBattleActive = battle.phase === 'deploy' || battle.phase === 'player' || battle.phase === 'enemy'
    let dangerZone: DangerZoneMap | null = null
    let focusedThreat: EnemyThreatMap | null = null
    if (isBattleActive) {
      let focusUid: string | null = null
      if (inspectedEnemyUid) {
        const u = getUnitByUid(battle, inspectedEnemyUid)
        if (u && u.team === 'enemy' && !isEnemyShrouded(battle, u)) focusUid = u.uid
      }
      if (!focusUid && hoveredCell && hoveredCell.row < battle.rows && hoveredCell.col < battle.cols) {
        const hovUnit = unitAt(battle, hoveredCell.col, hoveredCell.row)
        if (hovUnit && hovUnit.team === 'enemy' && !isEnemyShrouded(battle, hovUnit)) focusUid = hovUnit.uid
      }
      if (!focusUid && battle.selectedUnitUid) {
        const selUnit = getUnitByUid(battle, battle.selectedUnitUid)
        if (selUnit && selUnit.team === 'enemy' && !isEnemyShrouded(battle, selUnit)) focusUid = selUnit.uid
      }

      if (dangerZoneVisible) {
        dangerZone = computeDangerZone(battle)
        for (const tile of dangerZone.tiles) {
          const cell = battle.cells[tile.row]?.[tile.col]
          if (!cell || cell.terrain === 'void') continue
          const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
          const wash = tile.threatCount >= 2 ? C_DANGER_TILE_HIGH : C_DANGER_TILE
          pool.add(tileQuad, [wx, wy + 0.014, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, wash, 0.92, 'alpha')
          pool.add(tileHazardHatchMesh, [wx, wy + 0.018, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_DANGER_HATCH, 0.94, 'alpha')
          pool.add(tileDangerCornersMesh, [wx, wy + 0.020, wz], [TILE_SIZE * 0.90, 1, TILE_SIZE * 0.90], 0, C_DANGER_CORNER, 0.95, 'alpha')
        }
      }

      if (focusUid) {
        focusedThreat = computeEnemyThreat(battle, focusUid)
        for (const tile of focusedThreat.moveTiles) {
          const cell = battle.cells[tile.row]?.[tile.col]
          if (!cell || cell.terrain === 'void') continue
          const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
          pool.add(tileQuad, [wx, wy + 0.016, wz], [TILE_SIZE * 0.84, 1, TILE_SIZE * 0.84], 0, C_ENEMY_MOVE_TILE, 0.92, 'alpha')
          pool.add(tileDashedFrameMesh, [wx, wy + 0.021, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_ENEMY_MOVE_DASH, 0.96, 'alpha')
        }
        for (const tile of focusedThreat.attackTiles) {
          const cell = battle.cells[tile.row]?.[tile.col]
          if (!cell || cell.terrain === 'void') continue
          const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
          pool.add(tileQuad, [wx, wy + 0.017, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_ENEMY_REACH_TILE, 0.94, 'alpha')
          pool.add(tileHazardHatchMesh, [wx, wy + 0.022, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_ENEMY_REACH_HATCH, 0.96, 'alpha')
        }
        // Subtle directional chevron on staging tiles from which this enemy can flank/backstab an ally
        for (const origin of focusedThreat.flankOriginTiles) {
          const cell = battle.cells[origin.row]?.[origin.col]
          if (!cell || cell.terrain === 'void') continue
          const [wx, wy, wz] = gridToWorld(origin.col, origin.row, cell.elevation, battle.cols, battle.rows)
          const yaw = Math.atan2(origin.fromCol - origin.col, origin.fromRow - origin.row)
          const warnCol = origin.arc === 'back' ? C_BACKSTAB_WARN : C_FLANK_WARN
          pool.add(flankWarningChevronMesh, [wx, wy + 0.036, wz], [TILE_SIZE * 0.56, 1, TILE_SIZE * 0.56], yaw, warnCol, 0.96, 'alpha')
        }
      }
    }

    // 0.25 Fog of War mutator: shroud tiles outside Manhattan distance 4 of any living ally
    if (hasMutator(battle, 'fog_of_war')) {
      for (let row = 0; row < battle.rows; row++) {
        for (let col = 0; col < battle.cols; col++) {
          const cell = battle.cells[row][col]
          if (cell.terrain === 'void') continue
          if (isTileRevealedInFog(battle, col, row)) continue
          const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
          const drift = Math.sin(state.time * 1.4 + col * 1.1 + row * 1.7) * 0.04
          pool.add(tileQuad, [wx, wy + 0.042, wz], [TILE_SIZE * 0.98, 1, TILE_SIZE * 0.98], 0, C_FOG_TILE, 0.96, 'alpha')
          pool.add(tileQuad, [wx + drift, wy + 0.26, wz - drift], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_FOG_MIST, 0.94, 'alpha')
        }
      }
    }

    // 0.5 Pre-Battle Deployment Blue Spawn Zones
    if (battle.phase === 'deploy') {
      const deployPulse = 1 + Math.sin(state.time * 4.2) * 0.035
      for (const tile of battle.deployTiles) {
        const cell = battle.cells[tile.row]?.[tile.col]
        if (!cell || cell.terrain === 'void') continue
        const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
        const isHov = Boolean(hoveredCell && hoveredCell.col === tile.col && hoveredCell.row === tile.row)
        const occ = unitAt(battle, tile.col, tile.row)
        const isSelHero = Boolean(occ && occ.team === 'ally' && occ.uid === battle.selectedUnitUid)
        pool.add(tileQuad, [wx, wy + 0.024, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, isHov ? C_DEPLOY_TILE_HOVER : C_DEPLOY_TILE, 0.94, 'alpha')
        pool.add(tileFrameMesh, [wx, wy + 0.032, wz], [TILE_SIZE * 0.90, 1, TILE_SIZE * 0.90], 0, isSelHero ? C_DEPLOY_SEL_RING : C_DEPLOY_BORDER, 0.98, 'alpha')
        if (!occ) {
          pool.add(tileCornersMesh, [wx, wy + 0.035, wz], [TILE_SIZE * 0.84 * deployPulse, 1, TILE_SIZE * 0.84 * deployPulse], 0, C_DEPLOY_BORDER, 0.92, 'alpha')
          pool.add(tileDotMesh, [wx, wy + 0.036, wz], [TILE_SIZE * 0.72, 1, TILE_SIZE * 0.72], 0, C_DEPLOY_BORDER, 0.90, 'alpha')
        } else if (isSelHero) {
          const ringPulse = 0.78 + Math.sin(state.time * 6.5) * 0.06
          pool.add(flatRing, [wx, wy + 0.056, wz], [ringPulse, 1, ringPulse], state.time * 2.0, C_DEPLOY_SEL_RING, 1.0, 'additive')
        }
      }
    }

    // 0.6 3D Mission Objective Markers (Seize Beacon, Treasure Chests, Defend Relic Ward, Assassinate Target Crown)
    if (isBattleActive) {
      const obj = battle.objective
      const objPulse = 1 + Math.sin(state.time * 4.8) * 0.065

      if (obj.kind === 'seize' && obj.goalTile) {
        const gCell = battle.cells[obj.goalTile.row]?.[obj.goalTile.col]
        if (gCell && gCell.terrain !== 'void') {
          const [gx, gy, gz] = gridToWorld(obj.goalTile.col, obj.goalTile.row, gCell.elevation, battle.cols, battle.rows)
          pool.add(tileQuad, [gx, gy + 0.026, gz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_OBJ_SEIZE_TILE, 0.96, 'alpha')
          pool.add(tileDiamondMesh, [gx, gy + 0.038, gz], [TILE_SIZE * 0.90 * objPulse, 1, TILE_SIZE * 0.90 * objPulse], 0, C_OBJ_SEIZE_GOLD, 0.98, 'alpha')
          pool.add(flatRing, [gx, gy + 0.048, gz], [0.76 * objPulse, 1, 0.76 * objPulse], state.time * 1.6, C_OBJ_SEIZE_GOLD, 1.0, 'additive')
          pool.add(flatRing, [gx, gy + 0.054, gz], [0.54, 1, 0.54], -state.time * 2.2, C_STAR3_HALO, 1.0, 'additive')
          pool.add(spotlightBeamMesh, [gx, gy + 0.05, gz], [0.74, 2.8, 0.74], state.time * 0.6, C_OBJ_SEIZE_BEAM, 1.0, 'additive')
          const beaconY = gy + 1.55 + Math.sin(state.time * 3.4) * 0.14
          pool.add(crownMesh, [gx, beaconY, gz], [0.42, 0.34, 0.42], state.time * 1.4, C_OBJ_SEIZE_GOLD, 0.95)
        }
      }

      if (obj.kind === 'seize' && obj.chestTiles.length > 0) {
        for (let i = 0; i < obj.chestTiles.length; i++) {
          const ct = obj.chestTiles[i]
          if (isChestClaimed(obj, ct.col, ct.row)) continue
          const cCell = battle.cells[ct.row]?.[ct.col]
          if (!cCell || cCell.terrain === 'void') continue
          const [cx, cy, cz] = gridToWorld(ct.col, ct.row, cCell.elevation, battle.cols, battle.rows)
          const bob = Math.sin(state.time * 3.6 + i * 1.4) * 0.05
          pool.add(tileQuad, [cx, cy + 0.025, cz], [TILE_SIZE * 0.76, 1, TILE_SIZE * 0.76], 0, C_OBJ_SEIZE_TILE, 0.94, 'alpha')
          pool.add(flatRing, [cx, cy + 0.042, cz], [0.58 * objPulse, 1, 0.58 * objPulse], state.time * 1.8 + i, C_OBJ_SEIZE_GOLD, 0.98, 'additive')
          pool.add(chestMarkerMesh, [cx, cy + 0.03 + bob, cz], [0.92, 0.92, 0.92], Math.sin(state.time * 0.9 + i) * 0.25, C_OBJ_CHEST_WOOD, 0.22)
          pool.add(crystalMesh, [cx, cy + 0.68 + bob * 1.6, cz], [0.14, 0.22, 0.14], state.time * 3.2 + i, C_OBJ_CHEST_GOLD, 1.0, 'additive')
        }
      }

      if (obj.kind === 'defend' && obj.protectTile) {
        const pCell = battle.cells[obj.protectTile.row]?.[obj.protectTile.col]
        if (pCell && pCell.terrain !== 'void') {
          const [px, py, pz] = gridToWorld(obj.protectTile.col, obj.protectTile.row, pCell.elevation, battle.cols, battle.rows)
          const wardCol = obj.protectBreached ? C_OBJ_DEFEND_BREACH : C_OBJ_DEFEND_CYAN
          pool.add(tileQuad, [px, py + 0.026, pz], [TILE_SIZE * 0.90, 1, TILE_SIZE * 0.90], 0, C_OBJ_DEFEND_TILE, 0.96, 'alpha')
          pool.add(tileCornersMesh, [px, py + 0.036, pz], [TILE_SIZE * 0.92 * objPulse, 1, TILE_SIZE * 0.92 * objPulse], 0, wardCol, 0.98, 'alpha')
          pool.add(flatRing, [px, py + 0.048, pz], [0.80 * objPulse, 1, 0.80 * objPulse], state.time * 1.5, wardCol, 1.0, 'additive')
          pool.add(flatRing, [px, py + 0.056, pz], [0.58, 1, 0.58], -state.time * 2.0, C_OBJ_SEIZE_GOLD, 0.98, 'additive')
          pool.add(spotlightBeamMesh, [px, py + 0.05, pz], [0.82, 2.5, 0.82], -state.time * 0.55, C_OBJ_DEFEND_BEAM, 1.0, 'additive')
          for (let i = 0; i < 3; i++) {
            const a = state.time * 2.1 + (i / 3) * Math.PI * 2
            pool.add(
              crystalMesh,
              [px + Math.cos(a) * 0.64, py + 0.95 + Math.sin(state.time * 3.8 + i) * 0.14, pz + Math.sin(a) * 0.64],
              [0.12, 0.20, 0.12],
              a,
              i === 0 ? C_OBJ_SEIZE_GOLD : wardCol,
              1.0,
              'additive'
            )
          }
        }
      }

      if (obj.kind === 'assassinate' && obj.targetEnemyUid) {
        const targetUnit = getUnitByUid(battle, obj.targetEnemyUid)
        if (targetUnit && targetUnit.alive) {
          const tScale = targetUnit.isBoss ? 1.38 : 1.06
          const ringR = 0.86 * tScale * objPulse
          pool.add(flatRing, [targetUnit.x, targetUnit.y + 0.054, targetUnit.z], [ringR, 1, ringR], -state.time * 2.2, C_OBJ_ASSASSINATE, 1.0, 'additive')
          pool.add(tileDiamondMesh, [targetUnit.x, targetUnit.y + 0.058, targetUnit.z], [TILE_SIZE * 0.96 * objPulse, 1, TILE_SIZE * 0.96 * objPulse], 0, C_OBJ_ASSASSINATE, 0.98, 'alpha')
          const crownY = targetUnit.y + (targetUnit.isBoss ? 2.55 : 2.05) + Math.sin(state.time * 4.5) * 0.10
          pool.add(crownMesh, [targetUnit.x, crownY, targetUnit.z], [0.36 * tScale, 0.30 * tScale, 0.36 * tScale], state.time * 1.8, C_OBJ_ASSASSINATE, 0.96)
        }
      }
    }

    // 1. Move tiles: Hollow Square Frame + center dot (unmistakable vs Attack [X] even in grayscale!)
    for (const tile of battle.moveTiles) {
      const cell = battle.cells[tile.row][tile.col]
      const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
      pool.add(tileQuad, [wx, wy + 0.024, wz], [TILE_SIZE * 0.84, 1, TILE_SIZE * 0.84], 0, C_MOVE_TILE, 0.92, 'alpha')
      pool.add(tileFrameMesh, [wx, wy + 0.032, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_MOVE_BORDER, 0.96, 'alpha')
      pool.add(tileDotMesh, [wx, wy + 0.034, wz], [TILE_SIZE * 0.84, 1, TILE_SIZE * 0.84], 0, C_MOVE_BORDER, 0.96, 'alpha')
    }

    const activeUnit = getUnitByUid(battle, battle.activeUnitUid)
    const noUnitsMoving = !battle.units.some(u => u.path.length > 0)

    // 1b. Subtle Enemy Zone of Control (ZoC) perimeter markings while player hero can move
    if (battle.phase === 'player' && activeUnit && activeUnit.alive && !activeUnit.moved && !battle.facingPicker && noUnitsMoving) {
      const zocTiles = computeZocPerimeterTiles(battle, 'enemy')
      for (const zt of zocTiles) {
        const zCell = battle.cells[zt.row]?.[zt.col]
        if (!zCell || zCell.terrain === 'void') continue
        const [zx, zy, zz] = gridToWorld(zt.col, zt.row, zCell.elevation, battle.cols, battle.rows)
        pool.add(tileQuad, [zx, zy + 0.020, zz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_ZOC_PERIMETER, 0.90, 'alpha')
        pool.add(tileDangerCornersMesh, [zx, zy + 0.028, zz], [TILE_SIZE * 0.90, 1, TILE_SIZE * 0.90], 0, C_ZOC_PERIMETER_MARK, 0.94, 'alpha')
      }
    }
    const armedSkill = activeUnit && battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0
      ? getHeroSkill(activeUnit, battle.armedSkillIndex)
      : null
    const armedTactic = battle.armedTacticUid
      ? (() => {
          const owned = getTacticByUid(state.campaign, battle.armedTacticUid)
          return owned ? TACTIC_BY_ID[owned.tacticId] : null
        })()
      : null
    const isAllyTarget = Boolean(
      (armedSkill && (armedSkill.target === 'ally' || armedSkill.target === 'self')) ||
      (armedTactic && (armedTactic.target === 'ally' || armedTactic.target === 'any'))
    )

    // 2. Direct target tiles: distinct geometric icons (+ for Support/Heal/Revive, bold X + brackets for Attack, faint corners for free space)
    const canReviveArmed = Boolean(armedSkill?.canRevive || armedTactic?.canRevive)
    const bracketPulse = 1 + Math.sin(state.time * 6.0) * 0.045
    for (const tile of battle.targetTiles) {
      const cell = battle.cells[tile.row][tile.col]
      const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
      const occupant = canReviveArmed ? unitOrDownedAt(battle, tile.col, tile.row) : unitAt(battle, tile.col, tile.row)
      const isDownedRevive = Boolean(canReviveArmed && occupant && occupant.team === 'ally' && isUnitDowned(occupant))
      if (armedSkill) {
        const recommended = isDownedRevive || (isAllyTarget
          ? Boolean(occupant && occupant.team === 'ally')
          : Boolean((occupant && occupant.team === 'enemy') || isIntactBarricade(cell)))
        if (!recommended) {
          // Quiet free-space skill range footprint (subtle corner ticks so we never encourage clicking empty air or allies)
          pool.add(tileQuad, [wx, wy + 0.028, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_FREE_RANGE_TILE, 0.92, 'alpha')
          pool.add(tileCornersMesh, [wx, wy + 0.036, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_FREE_RANGE_MARK, 0.95, 'alpha')
          continue
        }
      }
      if (isDownedRevive) {
        pool.add(tileQuad, [wx, wy + 0.034, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_REVIVE_TILE, 0.96, 'alpha')
        pool.add(tilePlusMesh, [wx, wy + 0.044, wz], [TILE_SIZE * 0.88 * bracketPulse, 1, TILE_SIZE * 0.88 * bracketPulse], 0, C_REVIVE_MARK, 0.99, 'alpha')
        pool.add(tileCornersMesh, [wx, wy + 0.042, wz], [TILE_SIZE * 0.90 * bracketPulse, 1, TILE_SIZE * 0.90 * bracketPulse], 0, C_REVIVE_MARK, 0.98, 'alpha')
      } else if (isAllyTarget) {
        pool.add(tileQuad, [wx, wy + 0.032, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_ALLY_TARGET, 0.95, 'alpha')
        pool.add(tilePlusMesh, [wx, wy + 0.042, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_ALLY_MARK, 0.98, 'alpha')
        pool.add(tileCornersMesh, [wx, wy + 0.040, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_ALLY_MARK, 0.96, 'alpha')
      } else {
        pool.add(tileQuad, [wx, wy + 0.032, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_ATTACK_TILE, 0.95, 'alpha')
        pool.add(tileCrossMesh, [wx, wy + 0.044, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_ATTACK_MARK, 0.98, 'alpha')
        pool.add(tileCornersMesh, [wx, wy + 0.042, wz], [TILE_SIZE * 0.90 * bracketPulse, 1, TILE_SIZE * 0.90 * bracketPulse], 0, C_ATTACK_MARK, 0.98, 'alpha')
      }
    }

    // 3. Move+Attack reachable targets: distinct bold Diamond + Corner Brackets + rotating ring!
    for (const tile of battle.moveAttackTiles) {
      const cell = battle.cells[tile.row][tile.col]
      const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
      pool.add(
        tileQuad,
        [wx, wy + 0.030, wz],
        [TILE_SIZE * 0.84, 1, TILE_SIZE * 0.84],
        0,
        isAllyTarget ? C_ALLY_TARGET : C_MOVE_ATTACK_TILE,
        0.95,
        'alpha'
      )
      pool.add(
        isAllyTarget ? tilePlusMesh : tileDiamondMesh,
        [wx, wy + 0.042, wz],
        [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86],
        0,
        isAllyTarget ? C_ALLY_MARK : C_MOVE_ATTACK_MARK,
        0.98,
        'alpha'
      )
      pool.add(tileCornersMesh, [wx, wy + 0.040, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, isAllyTarget ? C_ALLY_MARK : C_MOVE_ATTACK_MARK, 0.96, 'alpha')
      const pulse = 0.60 + Math.sin(state.time * 5.5) * 0.05
      pool.add(flatRing, [wx, wy + 0.044, wz], [pulse, 1, pulse], state.time * 1.4, C_FORECAST_ARC, 0.96, 'alpha')
    }

    // 4. High-contrast Flank / Backstab threat markers on exposed hero tiles (colorblind-safe diamond + directional double-chevron!)
    if (isBattleActive && (focusedThreat || dangerZone)) {
      const flankWarnings = new Map<string, FlankThreatTile>()
      const addWarning = (ft: FlankThreatTile) => {
        const key = `${ft.col},${ft.row}`
        const prev = flankWarnings.get(key)
        if (!prev || (ft.arc === 'back' && prev.arc !== 'back')) {
          flankWarnings.set(key, ft)
        }
      }
      if (dangerZone) {
        for (const et of dangerZone.enemyThreats) {
          for (const ft of et.flankThreatTiles) addWarning(ft)
        }
      }
      if (focusedThreat) {
        for (const ft of focusedThreat.flankThreatTiles) addWarning(ft)
      }
      const warnPulse = 1 + Math.sin(state.time * 7.0) * 0.06
      for (const ft of flankWarnings.values()) {
        const cell = battle.cells[ft.row]?.[ft.col]
        if (!cell || cell.terrain === 'void') continue
        const [wx, wy, wz] = gridToWorld(ft.col, ft.row, cell.elevation, battle.cols, battle.rows)
        const warnCol = ft.arc === 'back' ? C_BACKSTAB_WARN : C_FLANK_WARN
        pool.add(tileDiamondMesh, [wx, wy + 0.050, wz], [TILE_SIZE * 0.92 * warnPulse, 1, TILE_SIZE * 0.92 * warnPulse], 0, warnCol, 0.98, 'alpha')
        const inDx = ft.col - ft.fromCol
        const inDz = ft.row - ft.fromRow
        const dirLen = Math.hypot(inDx, inDz) || 1
        const yaw = Math.atan2(inDx, inDz)
        const ox = wx - (inDx / dirLen) * TILE_SIZE * 0.34
        const oz = wz - (inDz / dirLen) * TILE_SIZE * 0.34
        pool.add(flankWarningChevronMesh, [ox, wy + 0.054, oz], [TILE_SIZE * 0.62 * warnPulse, 1, TILE_SIZE * 0.62 * warnPulse], yaw, warnCol, 0.98, 'alpha')
      }
    }

    // 5. On-board 4-way Wait-to-Face directional picker around the active hero
    let pickerUnitUid: string | null = null
    let pickerPreviewExposure: FacingExposureLevel | null = null
    if (battle.facingPicker && battle.phase === 'player') {
      const pickerUnit = getUnitByUid(battle, battle.facingPicker.unitUid)
      if (pickerUnit && pickerUnit.alive && pickerUnit.path.length === 0) {
        pickerUnitUid = pickerUnit.uid
        const exposures = evaluateAllFacingExposures(battle, pickerUnit.uid)
        pickerPreviewExposure = exposures[battle.facingPicker.previewFacing].level

        // Center pulsing confirm ring around the active hero
        const cPulse = 0.80 + Math.sin(state.time * 6.5) * 0.055
        pool.add(flatRing, [pickerUnit.x, pickerUnit.y + 0.052, pickerUnit.z], [cPulse, 1, cPulse], state.time * 1.6, C_PICKER_CONFIRM, 0.98, 'alpha')
        pool.add(flatRing, [pickerUnit.x, pickerUnit.y + 0.062, pickerUnit.z], [cPulse * 1.12, 1, cPulse * 1.12], -state.time * 2.1, C_PICKER_SEL_RING, 0.95, 'additive')

        // 4 directional arrows colored + shape-coded by live threat exposure
        for (const dir of FACING_DIRS) {
          const [ax, ay, az] = facingPickerAnchor(battle, pickerUnit, dir)
          const exp = exposures[dir]
          const isSel = battle.facingPicker.previewFacing === dir
          const dirYaw = facingToYaw(dir)
          const arrowCol = exp.level === 'back'
            ? (isSel ? C_PICKER_BACK : C_PICKER_BACK_DIM)
            : exp.level === 'flank'
              ? (isSel ? C_PICKER_FLANK : C_PICKER_FLANK_DIM)
              : (isSel ? C_PICKER_SAFE : C_PICKER_SAFE_DIM)
          const padScale = isSel ? 0.60 + Math.sin(state.time * 7.5) * 0.04 : 0.48
          const arrowScale = isSel ? 1.12 + Math.sin(state.time * 7.5) * 0.06 : 0.86

          pool.add(flatRing, [ax, ay - 0.02, az], [padScale, 1, padScale], isSel ? state.time * 2.2 : 0, isSel ? C_PICKER_SEL_RING : arrowCol, 0.95, 'alpha')
          if (exp.level === 'back') {
            pool.add(tileCrossMesh, [ax, ay - 0.012, az], [TILE_SIZE * 0.56, 1, TILE_SIZE * 0.56], 0, arrowCol, 0.96, 'alpha')
          } else if (exp.level === 'flank') {
            pool.add(tileDiamondMesh, [ax, ay - 0.012, az], [TILE_SIZE * 0.62, 1, TILE_SIZE * 0.62], 0, arrowCol, 0.94, 'alpha')
          }
          pool.add(facingArrowMesh, [ax, ay + 0.01, az], [arrowScale, 1, arrowScale], dirYaw, arrowCol, 0.98, 'alpha')
          if (isSel) {
            pool.add(flatRing, [ax, ay + 0.02, az], [padScale * 1.18, 1, padScale * 1.18], -state.time * 2.8, arrowCol, 0.98, 'additive')
            pool.add(
              crystalMesh,
              [ax, ay + 0.42 + Math.sin(state.time * 6.5) * 0.08, az],
              [0.11, 0.17, 0.11],
              state.time * 3.2,
              arrowCol,
              1.0,
              'additive'
            )
          }
        }
      }
    }

    const previewCell = battle.facingPicker
      ? null
      : activeForecast
        ? { col: activeForecast.targetCol, row: activeForecast.targetRow }
        : hoveredCell

    if (previewCell && (battle.phase === 'player' || battle.phase === 'deploy') && previewCell.row < battle.rows && previewCell.col < battle.cols) {
      const hCell = battle.cells[previewCell.row][previewCell.col]
      if (hCell.terrain !== 'void') {
        const [hx, hy, hz] = gridToWorld(previewCell.col, previewCell.row, hCell.elevation, battle.cols, battle.rows)
        pool.add(tileQuad, [hx, hy + 0.042, hz], [TILE_SIZE * 0.90, 1, TILE_SIZE * 0.90], 0, C_HOVER_TILE, 0.95, 'alpha')
        pool.add(tileFrameMesh, [hx, hy + 0.054, hz], [TILE_SIZE * 0.94, 1, TILE_SIZE * 0.94], 0, C_HOVER_BORDER, 0.98, 'alpha')
      }

      const isValidPreviewTarget =
        battle.targetTiles.some(t => t.col === previewCell.col && t.row === previewCell.row) ||
        battle.moveAttackTiles.some(t => t.col === previewCell.col && t.row === previewCell.row)
      if (isValidPreviewTarget && (armedSkill || armedTactic)) {
        const pattern = armedSkill ? armedSkill.pattern : armedTactic ? armedTactic.pattern : 'single'
        const previewCells = (pattern === 'cross' || pattern === 'area3' || pattern === 'aura')
          ? getPatternCells(previewCell.col, previewCell.row, pattern, battle.cols, battle.rows)
          : [previewCell]
        const isOffensiveSkill = Boolean(armedSkill && armedSkill.powerMul > 0)
        for (const pc of previewCells) {
          const c = battle.cells[pc.row][pc.col]
          if (c.terrain === 'void') continue
          const [px, py, pz] = gridToWorld(pc.col, pc.row, c.elevation, battle.cols, battle.rows)
          const occ = unitAt(battle, pc.col, pc.row)
          const isFriendlyHit = isOffensiveSkill && Boolean(
            occ && occ.team === 'ally' &&
            !(activeUnit && occ.uid === activeUnit.uid && !(previewCell.col === activeUnit.col && previewCell.row === activeUnit.row))
          )
          if (isFriendlyHit) {
            pool.add(tileQuad, [px, py + 0.052, pz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_FRIENDLY_FIRE_TILE, 0.98, 'alpha')
            pool.add(tileCrossMesh, [px, py + 0.058, pz], [TILE_SIZE * 0.92, 1, TILE_SIZE * 0.92], 0, C_FRIENDLY_FIRE_MARK, 0.98, 'alpha')
            pool.add(tileFrameMesh, [px, py + 0.056, pz], [TILE_SIZE * 0.92, 1, TILE_SIZE * 0.92], 0, C_FRIENDLY_FIRE_MARK, 0.98, 'alpha')
          } else if (pattern === 'cross' || pattern === 'area3' || pattern === 'aura') {
            pool.add(tileQuad, [px, py + 0.046, pz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_AOE_PREVIEW, 0.96, 'alpha')
            pool.add(tileDiamondMesh, [px, py + 0.052, pz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_AOE_MARK, 0.98, 'alpha')
          }
        }
      }
    }

    // Pre-attack 3D tactical preview: Move+Attack path, landing ring, pulsing lock-on reticle & targeting arc
    if (activeForecast && battle.phase === 'player' && !battle.units.some(u => u.path.length > 0)) {
      const fc = activeForecast
      const isHelpful = fc.isRevive || (!fc.isOffensive && fc.targetTeam === 'ally')
      const arcCol = fc.friendlyFire ? C_FORECAST_FF_ARC : fc.isRevive ? C_SPOTLIGHT_GOLD : isHelpful ? C_FORECAST_ALLY_ARC : fc.emptyTileTarget ? C_EMPTY_RETICLE : C_FORECAST_ARC
      const reticleCol = fc.friendlyFire ? C_FRIENDLY_FIRE_TILE : fc.isRevive ? C_SPOTLIGHT_GOLD : isHelpful ? C_ALLY_TARGET : fc.emptyTileTarget ? C_EMPTY_RETICLE : C_TARGET_RETICLE
      const tCell = battle.cells[fc.targetRow][fc.targetCol]
      const [tx, ty, tz] = gridToWorld(fc.targetCol, fc.targetRow, tCell.elevation, battle.cols, battle.rows)

      // Pulsing lock-on reticle & hovering diamond above target
      const rPulse = 0.72 + Math.sin(state.time * 7.5) * 0.08
      pool.add(flatRing, [tx, ty + 0.056, tz], [rPulse, 1, rPulse], -state.time * 2.4, reticleCol, 0.98, 'additive')
      pool.add(
        crystalMesh,
        [tx, ty + 2.05 + Math.sin(state.time * 6.5) * 0.12, tz],
        [0.16, 0.26, 0.16],
        state.time * 3.4,
        reticleCol,
        1.0
      )

      // Move+Attack approach path breadcrumbs + landing ring
      if (fc.requiresMove && fc.path.length > 0) {
        const aCell = battle.cells[fc.approachRow][fc.approachCol]
        const [ax, ay, az] = gridToWorld(fc.approachCol, fc.approachRow, aCell.elevation, battle.cols, battle.rows)
        const landPulse = 0.62 + Math.sin(state.time * 6.0) * 0.06
        pool.add(flatRing, [ax, ay + 0.052, az], [landPulse, 1, landPulse], state.time * 1.8, C_APPROACH_RING, 0.98, 'additive')
        for (let i = 0; i < fc.path.length; i++) {
          const step = fc.path[i]
          const sc = battle.cells[step.row][step.col]
          const [sx, sy, sz] = gridToWorld(step.col, step.row, sc.elevation, battle.cols, battle.rows)
          const bob = Math.sin(state.time * 6 - i * 0.9) * 0.05
          pool.add(crystalMesh, [sx, sy + 0.24 + bob, sz], [0.12, 0.12, 0.12], state.time * 2.5 + i, C_APPROACH_RING, 0.98, 'additive')
        }
      }

      // Animated parabolic targeting arc from approach (or current) position to target
      const fromCell = battle.cells[fc.approachRow][fc.approachCol]
      const [fx, fy, fz] = gridToWorld(fc.approachCol, fc.approachRow, fromCell.elevation, battle.cols, battle.rows)
      const dx = tx - fx
      const dz = tz - fz
      const dist = Math.hypot(dx, dz)
      if (dist > 0.2) {
        const peak = Math.min(1.85, 0.55 + dist * 0.24)
        const beadCount = 8
        const flow = (state.time * 1.35) % 1
        for (let i = 0; i < beadCount; i++) {
          const u = ((i + flow) / beadCount)
          if (u < 0.06 || u > 0.96) continue
          const bx = fx + dx * u
          const bz = fz + dz * u
          const by = (fy + 0.92) + ((ty + 0.85) - (fy + 0.92)) * u + Math.sin(u * Math.PI) * peak
          const sz = 0.09 + Math.sin(u * Math.PI) * 0.06
          pool.add(crystalMesh, [bx, by, bz], [sz, sz, sz], state.time * 4 + i, arcCol, 1.0, 'additive')
        }
      }

      // Live Pincer / Follow-Up 3D visual assist arc + highlight ring under assister
      if (
        fc.pincerAssisterUid &&
        fc.pincerFromCol !== undefined &&
        fc.pincerFromRow !== undefined
      ) {
        const pCell = battle.cells[fc.pincerFromRow]?.[fc.pincerFromCol]
        if (pCell) {
          const [px, py, pz] = gridToWorld(fc.pincerFromCol, fc.pincerFromRow, pCell.elevation, battle.cols, battle.rows)
          const pPulse = 0.70 + Math.sin(state.time * 7.2) * 0.07
          pool.add(flatRing, [px, py + 0.056, pz], [pPulse, 1, pPulse], state.time * 2.6, C_PINCER_GOLD, 0.98, 'additive')
          pool.add(flatRing, [px, py + 0.062, pz], [pPulse * 0.74, 1, pPulse * 0.74], -state.time * 3.4, C_PINCER_CYAN, 0.96, 'additive')
          pool.add(
            crystalMesh,
            [px, py + 1.98 + Math.sin(state.time * 6.8 + 1.2) * 0.10, pz],
            [0.14, 0.22, 0.14],
            -state.time * 3.6,
            C_PINCER_GOLD,
            1.0,
            'additive'
          )

          const pdx = tx - px
          const pdz = tz - pz
          const pDist = Math.hypot(pdx, pdz)
          if (pDist > 0.2) {
            const pPeak = Math.min(1.65, 0.62 + pDist * 0.22)
            const pBeads = 8
            const pFlow = (state.time * 1.6) % 1
            for (let i = 0; i < pBeads; i++) {
              const u = (i + pFlow) / pBeads
              if (u < 0.06 || u > 0.96) continue
              const bx = px + pdx * u
              const bz = pz + pdz * u
              const by = (py + 0.94) + ((ty + 0.85) - (py + 0.94)) * u + Math.sin(u * Math.PI) * pPeak
              const sz = 0.10 + Math.sin(u * Math.PI) * 0.06
              const bCol = i % 2 === 0 ? C_PINCER_GOLD : C_PINCER_CYAN
              pool.add(crystalMesh, [bx, by, bz], [sz, sz, sz], -state.time * 4.6 + i, bCol, 1.0, 'additive')
            }
          }
        }
      }
    }

    // Move-path preview & Opportunity Attack telegraphing (blue move tiles + Move+Attack paths)
    if (battle.phase === 'player' && activeUnit && activeUnit.alive && !battle.facingPicker && noUnitsMoving) {
      let candidatePath: readonly { readonly col: number; readonly row: number }[] = []
      let drawMoveBreadcrumbs = false
      let oaPreview = activeForecast?.opportunityAttacks ?? null

      const hov = hoveredCell
      if (activeForecast && activeForecast.requiresMove && activeForecast.path.length > 0) {
        candidatePath = activeForecast.path
        if (!oaPreview) {
          oaPreview = previewPathOpportunityAttacks(battle, activeUnit, candidatePath)
        }
      } else if (
        !activeForecast &&
        !activeUnit.moved &&
        hov &&
        battle.moveTiles.some(t => t.col === hov.col && t.row === hov.row)
      ) {
        candidatePath = findGridPath(battle, activeUnit, hov.col, hov.row)
        drawMoveBreadcrumbs = candidatePath.length > 0
        if (candidatePath.length > 0) {
          oaPreview = previewPathOpportunityAttacks(battle, activeUnit, candidatePath)
        }
      }

      const provokedStepSet = new Set<number>()
      if (oaPreview) {
        for (const tr of oaPreview.triggers) provokedStepSet.add(tr.stepIndex)
      }

      if (drawMoveBreadcrumbs && candidatePath.length > 0) {
        const dest = candidatePath[candidatePath.length - 1]
        const destCell = battle.cells[dest.row]?.[dest.col]
        if (destCell && destCell.terrain !== 'void') {
          const [dx, dy, dz] = gridToWorld(dest.col, dest.row, destCell.elevation, battle.cols, battle.rows)
          const ringPulse = 0.58 + Math.sin(state.time * 6.0) * 0.05
          const ringCol = provokedStepSet.size > 0 ? C_OA_WARN_MARK : C_APPROACH_RING
          pool.add(flatRing, [dx, dy + 0.052, dz], [ringPulse, 1, ringPulse], state.time * 1.8, ringCol, 0.98, 'additive')
        }
        for (let i = 0; i < candidatePath.length; i++) {
          const step = candidatePath[i]
          const sc = battle.cells[step.row]?.[step.col]
          if (!sc || sc.terrain === 'void') continue
          const [sx, sy, sz] = gridToWorld(step.col, step.row, sc.elevation, battle.cols, battle.rows)
          const bob = Math.sin(state.time * 6.2 - i * 0.85) * 0.05
          const isProvokedStep = provokedStepSet.has(i)
          const stepCol = isProvokedStep ? C_OA_ARC : C_MOVE_PATH_STEP
          const stepSize = isProvokedStep ? 0.16 : 0.11
          pool.add(crystalMesh, [sx, sy + 0.24 + bob, sz], [stepSize, stepSize, stepSize], state.time * 2.8 + i, stepCol, 0.98, 'additive')
        }
      }

      if (oaPreview && oaPreview.triggers.length > 0) {
        const oaPulse = 1 + Math.sin(state.time * 8.5) * 0.075
        const oaFlow = (state.time * 1.65) % 1
        for (const trig of oaPreview.triggers) {
          const fromCell = battle.cells[trig.fromRow]?.[trig.fromCol]
          const attCell = battle.cells[trig.attackerRow]?.[trig.attackerCol]
          if (!fromCell || fromCell.terrain === 'void') continue
          const [px, py, pz] = gridToWorld(trig.fromCol, trig.fromRow, fromCell.elevation, battle.cols, battle.rows)

          // Pulsing amber-red warning wash + crossed-swords emblem on the tile leaving enemy ZoC
          pool.add(tileQuad, [px, py + 0.050, pz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_OA_WARN_TILE, 0.96, 'alpha')
          pool.add(
            tileCrossedSwordsMesh,
            [px, py + 0.058, pz],
            [TILE_SIZE * 0.84 * oaPulse, 1, TILE_SIZE * 0.84 * oaPulse],
            0,
            C_OA_WARN_MARK,
            0.99,
            'alpha'
          )
          pool.add(flatRing, [px, py + 0.055, pz], [0.66 * oaPulse, 1, 0.66 * oaPulse], -state.time * 2.6, C_OA_ARC, 0.98, 'additive')

          if (attCell && attCell.terrain !== 'void') {
            const [ax, ay, az] = gridToWorld(trig.attackerCol, trig.attackerRow, attCell.elevation, battle.cols, battle.rows)
            // Pulsing warning ring beneath the threatening ZoC sentinel
            pool.add(flatRing, [ax, ay + 0.056, az], [0.74 * oaPulse, 1, 0.74 * oaPulse], state.time * 2.8, C_OA_SENTINEL_RING, 0.98, 'additive')

            // Animated strike-threat arc from threatening sentinel -> provoked tile
            const adx = px - ax
            const adz = pz - az
            const beadCount = 6
            for (let b = 0; b < beadCount; b++) {
              const u = (b + oaFlow) / beadCount
              if (u < 0.08 || u > 0.94) continue
              const bx = ax + adx * u
              const bz = az + adz * u
              const by = (ay + 0.82) + ((py + 0.56) - (ay + 0.82)) * u + Math.sin(u * Math.PI) * 0.68
              const bsz = 0.085 + Math.sin(u * Math.PI) * 0.055
              pool.add(crystalMesh, [bx, by, bz], [bsz, bsz, bsz], state.time * 4.5 + b, C_OA_ARC, 1.0, 'additive')
            }
          }
        }
      }

      // Projected forced-displacement slide arrow, landing ring & collision/hazard marker
      if (activeForecast?.displacementPreview) {
        const dp = activeForecast.displacementPreview
        const dFromCell = battle.cells[dp.fromRow]?.[dp.fromCol]
        const dToCell = battle.cells[dp.toRow]?.[dp.toCol]
        if (dFromCell && dToCell) {
          const [dsx, dsy, dsz] = gridToWorld(dp.fromCol, dp.fromRow, dFromCell.elevation, battle.cols, battle.rows)
          const [dex, dey, dez] = gridToWorld(dp.toCol, dp.toRow, dToCell.elevation, battle.cols, battle.rows)
          const hasCombo = dp.collisionDmg > 0 || dp.fallDmg > 0 || dp.hazardKind === 'lava_geyser' || dp.hazardKind === 'cursed_altar'
          const dispCol = dp.kind === 'swap'
            ? C_DISPLACE_SWAP
            : hasCombo
              ? C_DISPLACE_HAZARD
              : C_DISPLACE_PUSH

          const ddx = dex - dsx
          const ddz = dez - dsz
          const dDist = Math.hypot(ddx, ddz)
          if (dp.moved && dDist > 0.15) {
            const slideYaw = Math.atan2(ddx, ddz)
            const stepBeads = Math.max(4, Math.min(10, Math.round(dDist * 3)))
            const flow = (state.time * 1.9) % 1
            const arcPeak = dp.kind === 'swap' ? 0.78 : (dp.fallDrop >= 2 ? 0.42 : 0.18)
            for (let i = 0; i < stepBeads; i++) {
              const u = (i + flow) / stepBeads
              if (u < 0.08 || u > 0.96) continue
              const bx = dsx + ddx * u
              const bz = dsz + ddz * u
              const by = (dsy + 0.24) + ((dey + 0.24) - (dsy + 0.24)) * u + Math.sin(u * Math.PI) * arcPeak
              pool.add(facingChevronMesh, [bx, by, bz], [0.58, 1, 0.58], slideYaw, dispCol, 1.0, 'additive')
            }
            // Pulsing landing ring + directional arrowhead at destination tile
            const landR = 0.66 + Math.sin(state.time * 7.0) * 0.07
            pool.add(flatRing, [dex, dey + 0.062, dez], [landR, 1, landR], state.time * 2.2, dispCol, 1.0, 'additive')
            pool.add(facingChevronMesh, [dex, dey + 0.068, dez], [0.95, 1, 0.95], slideYaw, dispCol, 1.0, 'additive')

            // For Swap, also draw a matching violet landing ring on the target's tile for the caster!
            if (dp.kind === 'swap') {
              pool.add(flatRing, [dsx, dsy + 0.064, dsz], [landR * 0.92, 1, landR * 0.92], -state.time * 2.2, C_DISPLACE_SWAP, 1.0, 'additive')
            }
          }

          // Impact cross / warning ring on collided obstacle, unit, or chasm ledge
          if (dp.collidedWith !== 'none' && dp.collidedCell) {
            const cCell = battle.cells[dp.collidedCell.row]?.[dp.collidedCell.col]
            if (cCell) {
              const cElev = cCell.terrain === 'void' ? dToCell.elevation : cCell.elevation
              const [cx, cy, cz] = gridToWorld(dp.collidedCell.col, dp.collidedCell.row, cElev, battle.cols, battle.rows)
              const warnPulse = 0.72 + Math.sin(state.time * 9.0) * 0.09
              pool.add(flatRing, [cx, cy + 0.07, cz], [warnPulse, 1, warnPulse], -state.time * 3.0, C_DISPLACE_HAZARD, 1.0, 'additive')
              pool.add(tileCrossMesh, [cx, cy + 0.074, cz], [TILE_SIZE * 0.76, 1, TILE_SIZE * 0.76], 0, C_DISPLACE_HAZARD, 0.98, 'additive')
            }
          }
        }
      }
    }

    // Floating turn motes spiral up around the active unit
    if (activeUnit && activeUnit.alive && activeUnit.path.length === 0 && (battle.phase === 'player' || battle.phase === 'enemy')) {
      moteTimer += dt
      while (moteTimer >= 0.11) {
        moteTimer -= 0.11
        const a = state.time * 5.3
        particles.spawn({
          mesh: crystalMesh,
          blend: 'additive',
          position: [activeUnit.x + Math.cos(a) * 0.48, activeUnit.y + 0.1, activeUnit.z + Math.sin(a) * 0.48],
          velocity: [-Math.sin(a) * 0.35, 0.9, Math.cos(a) * 0.35],
          spin: 6,
          scale: [0.06, 0.09, 0.06],
          endScale: 0.2,
          color: activeUnit.team === 'ally' ? C_ALLY_MOTE : C_ENEMY_MOTE,
          unlit: 1,
          life: 0.95
        })
      }
    }

    for (const unit of battle.units) {
      renderUnit(
        battle,
        unit,
        animDt,
        fxDt,
        unit.uid === battle.activeUnitUid,
        unit.uid === battle.selectedUnitUid,
        state.time,
        unit.uid === pickerUnitUid ? pickerPreviewExposure : null
      )
    }

    vfx.update(fxDt)
    updateShots(fxDt, state.time)
    particles.emit(pool)

    const batches: InstanceBatch[] = [...boardBatches]
    if (shadows.batch.count > 0) batches.push(shadows.batch)
    for (const b of pool.batches) {
      if (b.count > 0) batches.push(b)
    }
    return renderer.render(lastMatrix, batches, style.sky)
  }

  function renderCamp(state: GameState, dt: number, w: number, h: number): Readonly<RenderStats> {
    applyCampLightingOnce()
    if (lastBattle) {
      lastBattle = null
      shots.length = 0
      particles.clear()
      vfx.clear()
      localShake = 0
    }
    particles.step(dt)
    pool.clear()
    shadows.clear()

    fireTimer += dt
    if (fireTimer >= 0.14) {
      fireTimer = 0
      const a = (state.time * 4.7) % (Math.PI * 2)
      particles.spawn({
        mesh: crystalMesh,
        position: [Math.cos(a) * 0.16, 0.24, 2.0 + Math.sin(a) * 0.16],
        velocity: [Math.cos(a) * 0.32, 1.38, Math.sin(a) * 0.32],
        gravity: -0.2,
        scale: [0.12, 0.16, 0.12],
        color: C_FIRE_TIP,
        unlit: 0.98,
        life: 0.62
      })
    }

    // Layered warm stylized flames dancing in the stone-ring campfire
    const flameScale = 0.34 + Math.sin(state.time * 10) * 0.045
    pool.add(crystalMesh, [0, 0.32, 2.0], [flameScale, flameScale * 1.48, flameScale], state.time * 2.2, C_FIRE_CORE, 0.98)
    pool.add(crystalMesh, [0, 0.42, 2.0], [flameScale * 0.58, flameScale * 0.95, flameScale * 0.58], -state.time * 2.6, C_FIRE_TIP, 0.98)

    const squad: OwnedHeroCard[] = state.campaign.squadUids
      .map(uid => getHeroByUid(state.campaign, uid))
      .filter((hero): hero is OwnedHeroCard => Boolean(hero))
    const selectedCampHero = getHeroByUid(state.campaign, state.campaign.selectedCampHeroUid)
    const count = squad.length

    interface CampDisplayHero {
      readonly hero: OwnedHeroCard
      readonly x: number
      readonly z: number
      readonly yaw: number
      readonly isSelected: boolean
    }
    const displayed: CampDisplayHero[] = []
    let focusGoalX = 0
    let focusGoalZ = -0.35
    let selectedInSquad = false
    for (let i = 0; i < count; i++) {
      const hero = squad[i]
      const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2
      const hx = offset * 2.35
      const hz = -0.35 + Math.abs(offset) * 0.55
      const isSelected = hero.uid === state.campaign.selectedCampHeroUid
      if (isSelected) {
        selectedInSquad = true
        focusGoalX = hx
        focusGoalZ = hz
      }
      const yaw = isSelected && campFraming === 'armory'
        ? Math.sin(state.time * 0.65) * 0.42
        : Math.atan2(-hx, 2.2 - hz)
      displayed.push({ hero, x: hx, z: hz, yaw, isSelected })
    }
    // If the hero being inspected in Armory is benched, spotlight them front-and-center!
    if (selectedCampHero && !selectedInSquad && campFraming === 'armory') {
      const bx = 0
      const bz = 0.78
      focusGoalX = bx
      focusGoalZ = bz
      displayed.push({
        hero: selectedCampHero,
        x: bx,
        z: bz,
        yaw: Math.sin(state.time * 0.65) * 0.42,
        isSelected: true
      })
    }

    const aspect = Math.max(0.32, w / Math.max(1, h))
    const isArmory = campFraming === 'armory'
    const campShiftTarget = campFraming === 'camp' || isArmory ? 1 : 0
    campShift += (campShiftTarget - campShift) * Math.min(1, dt * 6)
    armoryFocusW += ((isArmory ? 1 : 0) - armoryFocusW) * Math.min(1, dt * 7)
    armoryFocusX += (focusGoalX - armoryFocusX) * Math.min(1, dt * 8)
    armoryFocusZ += (focusGoalZ - armoryFocusZ) * Math.min(1, dt * 8)

    const orbit = Math.sin(state.time * 0.20) * (0.22 * (1 - armoryFocusW * 0.65))
    const baseDist = aspect < 0.85
      ? 6.1 / Math.max(0.45, aspect)
      : (h < 480 ? 9.4 : 8.4) + campShift * 0.6
    const armoryDist = aspect < 0.85 ? 5.2 / Math.max(0.50, aspect) : h < 480 ? 5.4 : 4.9
    const dist = baseDist + (armoryDist - baseDist) * armoryFocusW
    const baseEyeY = (aspect < 0.85 ? 5.2 : 4.3) + campShift * 0.55
    const armoryEyeY = aspect < 0.85 ? 2.85 : 2.45
    const eyeY = baseEyeY + (armoryEyeY - baseEyeY) * armoryFocusW
    const baseTargetY = 0.46 - campShift * (aspect < 0.85 ? 1.85 : h < 480 ? 0.6 : 1.15)
    const armoryTargetY = aspect < 0.85 ? 0.12 : h < 480 ? 0.42 : 0.26
    const targetY = baseTargetY + (armoryTargetY - baseTargetY) * armoryFocusW
    const baseTargetZ = -0.35 + campShift * 0.65
    const targetX = armoryFocusX * armoryFocusW
    const targetZ = baseTargetZ + (armoryFocusZ - baseTargetZ) * armoryFocusW
    const eye: Vec3 = [
      targetX + Math.sin(orbit) * dist,
      eyeY,
      targetZ + Math.cos(orbit) * dist + (1.3 * (1 - armoryFocusW))
    ]
    const target: Vec3 = [targetX, targetY, targetZ]
    lastMatrix = multiply(perspective(Math.PI / 3.9, aspect, 0.5, 90), view(eye, target))

    for (let i = 0; i < displayed.length; i++) {
      const { hero, x: hx, z: hz, yaw, isSelected } = displayed[i]
      const scale = hero.stars === 3 ? 1.16 : hero.stars === 2 ? 1.07 : 1.0
      const fx = getFx('camp_' + hero.uid)
      const anim = fx.anim

      // Occasional idle fidgets: look around, weapon flourish, stretch
      if (fx.action) {
        fx.actionT += dt
        if (fx.actionT >= fx.actionDur) fx.action = null
      } else {
        fx.fidgetTimer -= dt
        if (fx.fidgetTimer <= 0) {
          fx.fidgetCount++
          const pick = (fx.seed * 7.31 + fx.fidgetCount * 0.618) % 1
          startAction(fx, CAMP_FIDGETS[Math.floor(pick * CAMP_FIDGETS.length)], 0.3)
          fx.fidgetTimer = 4 + ((fx.seed2 * 3.7 + fx.fidgetCount * 0.414) % 1) * 6
        } else {
          anim.play('idle', 0.3, 0.9 + fx.seed2 * 0.2)
        }
      }
      anim.step(dt)
      fx.stanceW += ((anim.clip === 'idle' ? 1 : 0) - fx.stanceW) * Math.min(1, dt * 5)
      const pose = anim.evaluate(fillAdditive(fx, stanceOffsetFor(hero.heroId), fx.stanceW, 0))
      const campRig = resolveHeroRig(hero.heroId, {
        stars: hero.stars,
        weaponId: getEquipmentByUid(state.campaign, hero.weaponUid)?.equipId,
        armorId: getEquipmentByUid(state.campaign, hero.armorUid)?.equipId,
        relicId: getEquipmentByUid(state.campaign, hero.relicUid)?.equipId
      })
      renderRig(campRig, { position: [hx, 0.04, hz], yaw, scale }, pose, pool)
      shadows.add([hx, 0.06, hz], { groundY: 0.04, radius: 0.58 * scale, opacity: 0.30 })
      if (isSelected) {
        const ringR = (isArmory ? 0.80 + Math.sin(state.time * 4.5) * 0.04 : 0.72) * scale
        pool.add(flatRing, [hx, 0.065, hz], [ringR, 1, ringR], state.time * 1.0, C_ACTIVE_RING, 0.95, 'alpha')
        if (isArmory) {
          pool.add(flatRing, [hx, 0.075, hz], [ringR * 1.18, 1, ringR * 1.18], -state.time * 1.6, C_STAR3_HALO, 0.96, 'additive')
        }
      }
      const pulse = campEquipPulse.get(hero.uid)
      if (pulse) {
        if (!pulse.spawned) {
          pulse.spawned = true
          for (let k = 0; k < 14; k++) {
            const a = (k / 14) * Math.PI * 2
            particles.spawn({
              mesh: crystalMesh,
              blend: 'additive',
              position: [hx + Math.cos(a) * 0.36 * scale, 0.22, hz + Math.sin(a) * 0.36 * scale],
              velocity: [Math.cos(a) * 1.2, 1.9 + (k % 3) * 0.45, Math.sin(a) * 1.2],
              gravity: 3.4,
              spin: 9,
              scale: [0.11, 0.15, 0.11],
              endScale: 0.1,
              color: pulse.color,
              unlit: 1,
              life: 0.62
            })
          }
        }
        pulse.t += dt
        const u = Math.min(1, pulse.t / pulse.dur)
        const expand = (0.55 + u * 0.78) * scale
        const alpha = (1 - u) * 0.9
        pool.add(
          flatRing,
          [hx, 0.09 + u * 0.65 * scale, hz],
          [expand, 1, expand],
          state.time * 3.0,
          [pulse.color[0], pulse.color[1], pulse.color[2], alpha],
          1,
          'additive'
        )
        if (pulse.t >= pulse.dur) campEquipPulse.delete(hero.uid)
      }
      if (hero.stars >= 2) {
        pool.add(crownMesh, [hx, (1.72 + Math.sin(state.time * 3 + i) * 0.05) * scale, hz], [0.28, 0.22, 0.28], state.time, C_STAR2_GOLD, 0.8)
      }
      if (hero.stars >= 3) {
        pool.add(flatRing, [hx, 0.08, hz], [0.80 * scale, 1, 0.80 * scale], -state.time * 1.3, C_STAR3_HALO, 0.95, 'additive')
      }
    }

    particles.emit(pool)

    const batches: InstanceBatch[] = [...campBatches]
    if (shadows.batch.count > 0) batches.push(shadows.batch)
    for (const b of pool.batches) if (b.count > 0) batches.push(b)
    return renderer.render(lastMatrix, batches, C_CAMP_SKY)
  }

  function pickCellAt(
    battle: BattleState | null,
    cssX: number,
    cssY: number,
    width: number,
    height: number
  ): { col: number; row: number } | null {
    if (!battle) return null
    const ray = screenToRay(lastMatrix, cssX, cssY, width, height)
    if (!ray) return null
    return pickCellFromRay(battle, ray.origin, ray.direction)
  }

  /**
   * Hit-test the 4-way on-board Wait-to-Face picker (directional arrows or center confirm ring),
   * working across multi-tier elevation, board edges, zoom levels, and arbitrary camera yaw.
   */
  function pickFacingPickerAt(
    battle: BattleState | null,
    cssX: number,
    cssY: number,
    width: number,
    height: number
  ): 'confirm' | FacingDir | null {
    if (!battle || !battle.facingPicker || battle.phase !== 'player') return null
    const unit = getUnitByUid(battle, battle.facingPicker.unitUid)
    if (!unit || !unit.alive) return null

    const centerPt = worldToScreen(lastMatrix, unit.x, unit.y + 0.25, unit.z, width, height)
    const anchors: { kind: 'confirm' | FacingDir; x: number; y: number }[] = []
    if (centerPt) anchors.push({ kind: 'confirm', x: centerPt.x, y: centerPt.y })

    let stepSum = 0
    let stepCount = 0
    for (const dir of FACING_DIRS) {
      const [ax, ay, az] = facingPickerAnchor(battle, unit, dir)
      const pt = worldToScreen(lastMatrix, ax, ay, az, width, height)
      if (!pt) continue
      anchors.push({ kind: dir, x: pt.x, y: pt.y })
      if (centerPt) {
        stepSum += Math.hypot(pt.x - centerPt.x, pt.y - centerPt.y)
        stepCount += 1
      }
    }

    const avgStep = stepCount > 0 ? stepSum / stepCount : 72
    const hitRadius = Math.max(26, Math.min(66, avgStep * 0.46))
    let bestKind: 'confirm' | FacingDir | null = null
    let bestDist = hitRadius
    for (const a of anchors) {
      const d = Math.hypot(cssX - a.x, cssY - a.y)
      if (d <= bestDist) {
        bestDist = d
        bestKind = a.kind
      }
    }
    if (bestKind) return bestKind

    // Fallback: direct ray pick on active tile or adjacent cardinal tile
    const cell = pickCellAt(battle, cssX, cssY, width, height)
    if (!cell) return null
    const dc = cell.col - unit.col
    const dr = cell.row - unit.row
    if (dc === 0 && dr === 0) return 'confirm'
    if (Math.abs(dc) + Math.abs(dr) === 1) {
      return vectorToFacing(dc, dr, battle.facingPicker.previewFacing)
    }
    return null
  }

  function project(x: number, y: number, z: number, width: number, height: number) {
    return worldToScreen(lastMatrix, x, y, z, width, height)
  }

  return {
    render(state: GameState, dt: number, width: number, height: number): Readonly<RenderStats> {
      if (state.battle) return renderBattle(state, dt, width, height)
      return renderCamp(state, dt, width, height)
    },
    setCampFraming(mode: 'title' | 'camp' | 'armory' | 'story' | 'world') {
      campFraming = mode
    },
    /** Trigger an immediate celebratory weapon-flourish / equip pose & sparkle burst on a Camp hero. */
    triggerCampEquipFlourish(heroUid: string, slot?: EquipSlot, accentHex?: string) {
      const fx = getFx('camp_' + heroUid)
      const clip: UnitClipName = slot === 'weapon' ? 'fidget_twirl'
        : slot === 'armor' ? 'status_empower'
        : 'ready'
      startAction(fx, clip, 0.08)
      fx.fidgetTimer = 6.0
      campEquipPulse.set(heroUid, {
        t: 0,
        dur: 0.85,
        color: accentHex ? color(accentHex) : C_HOLY,
        spawned: false
      })
    },
    pickCellAt,
    pickFacingPickerAt,
    setHoveredCell(cell: { col: number; row: number } | null) {
      hoveredCell = cell
    },
    getHoveredCell() {
      return hoveredCell
    },
    setForecast(forecast: CombatForecast | null) {
      activeForecast = forecast
    },
    setDangerZoneVisible(visible: boolean) {
      dangerZoneVisible = visible
    },
    isDangerZoneVisible() {
      return dangerZoneVisible
    },
    toggleDangerZone() {
      dangerZoneVisible = !dangerZoneVisible
      return dangerZoneVisible
    },
    setInspectedEnemyUid(uid: string | null) {
      inspectedEnemyUid = uid
    },
    getInspectedEnemyUid() {
      return inspectedEnemyUid
    },
    /** Snap presentation rig cleanly to a unit's restored tile & facing (used by Undo Move). */
    snapUnit(unit: BattleUnit) {
      const fx = getFx(unit.uid, unit)
      fx.yaw = unit.yaw
      fx.simYaw = unit.yaw
      fx.lastCol = unit.col
      fx.lastRow = unit.row
      fx.lastElev = unit.y
      fx.lastState = unit.animState
      fx.lastTimer = unit.animTimer
      fx.action = null
      fx.actionT = 0
      fx.pendingReady = false
      fx.kbX = 0
      fx.kbZ = 0
      fx.landT = 0
      fx.landAmp = 0.08
      fx.anim.play(idleClipFor(unit.team, unit.hp / Math.max(1, unit.maxHp), unit.stunTurns > 0), 0.04)
      spawnDust(unit.x, unit.y, unit.z, 5, 0.8)
    },
    setSpotlightUnit(uid: string | null) {
      spotlightUnitUid = uid
    },
    getSpotlightUnit() {
      return spotlightUnitUid
    },
    rotateCamera(delta: number) {
      if (!Number.isFinite(delta)) return
      cameraYawTarget += delta
    },
    snapCameraYaw(steps: number) {
      cameraYawTarget = snapYawStep(cameraYawTarget, steps)
      return normalizeCameraYaw(cameraYawTarget)
    },
    setCameraYaw(rad: number, instant = false) {
      const normalized = normalizeCameraYaw(rad)
      if (instant) {
        cameraYawActual = normalized
        cameraYawTarget = normalized
      } else {
        cameraYawTarget = cameraYawActual + shortestYawDelta(cameraYawActual, normalized)
      }
      return normalized
    },
    getCameraYaw() {
      return normalizeCameraYaw(cameraYawTarget)
    },
    getCameraYawActual() {
      return normalizeCameraYaw(cameraYawActual)
    },
    isCameraAnimating() {
      return (
        Math.abs(cameraYawTarget - cameraYawActual) > 1e-3 ||
        Math.abs(cameraPitch - cameraPitchActual) > 1e-3 ||
        Math.abs(cameraZoom - cameraZoomActual) > 1e-3
      )
    },
    tiltCamera(delta: number) {
      cameraPitch = Math.max(MIN_CAMERA_PITCH, Math.min(MAX_CAMERA_PITCH, cameraPitch + delta))
    },
    setCameraPitch(p: number) {
      cameraPitch = Math.max(MIN_CAMERA_PITCH, Math.min(MAX_CAMERA_PITCH, p))
    },
    getCameraPitch() {
      return cameraPitch
    },
    getCameraPitchBounds() {
      return { min: MIN_CAMERA_PITCH, max: MAX_CAMERA_PITCH }
    },
    zoomCamera(factor: number) {
      cameraZoom = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, cameraZoom * factor))
    },
    setCameraZoom(z: number) {
      cameraZoom = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, z))
    },
    getCameraZoom() {
      return cameraZoom
    },
    getCameraZoomBounds() {
      return { min: MIN_CAMERA_ZOOM, max: MAX_CAMERA_ZOOM }
    },
    panCamera(dx: number, dz: number) {
      const maxPan = Math.max(0, (1.02 - cameraZoom) * 8.0)
      if (maxPan <= 0) {
        cameraPanX = 0
        cameraPanZ = 0
        return
      }
      const [worldDx, worldDz] = cameraRelativePanDelta(dx, dz, cameraYawActual)
      cameraPanX = Math.max(-maxPan, Math.min(maxPan, cameraPanX + worldDx))
      cameraPanZ = Math.max(-maxPan, Math.min(maxPan, cameraPanZ + worldDz))
    },
    resetCamera() {
      cameraYawTarget = cameraYawActual + shortestYawDelta(cameraYawActual, 0)
      cameraPitch = DEFAULT_CAMERA_PITCH
      cameraZoom = 1.0
      cameraPanX = 0
      cameraPanZ = 0
    },
    project,
    dispose() {
      for (const b of campBatches) renderer.release(b)
      for (const b of boardBatches) renderer.release(b)
      renderer.release(shadows.batch)
      for (const b of pool.batches) renderer.release(b)
    }
  }
}
