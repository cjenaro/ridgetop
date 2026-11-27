import { ENEMY_SPECS } from './data.ts'
import { computeScaledEnemyStats } from './mutators.ts'
import {
  facingToYaw,
  gridToWorld,
  isUnitDowned,
  terrainWalkable
} from './types.ts'
import type {
  BattleObjectiveSpec,
  BattleState,
  BattleUnit,
  BiomeId,
  CampaignState,
  ChapterEnemySpawn,
  DifficultyLevel,
  GridCoord,
  HeroClassId,
  StageMutatorId,
  TileTerrain
} from './types.ts'

/**
 * Pure Endgame Expansion Helpers for Crownshard:
 * - Cinder Arena 3-Round Gladiator Gauntlet
 * - Brimstone Maw Ignis Titan Cataclysm Slam geyser ignition
 * - Starfall Atoll mythic first-clear spoils
 * - Crownless Deep 10-Floor Secret Abyss Dungeon
 *
 * Zero browser globals and Godot-compiler-compatible.
 */

export const CINDER_ARENA_STAGE_ID = 'cinder_colosseum'
export const BRIMSTONE_MAW_STAGE_ID = 'molten_core'
export const STARFALL_ATOLL_STAGE_ID = 'starfall_atoll'
export const CROWNLESS_DEEP_STAGE_ID = 'abyssal_deep'

export const CINDER_ARENA_MAX_ROUNDS = 3
export const CINDER_ARENA_INTER_ROUND_HEAL_RATIO = 0.25
export const CINDER_ARENA_INTER_ROUND_AP_BONUS = 1

export const IGNIS_TITAN_GEYSER_IGNITE_RADIUS = 2

export const STARFALL_ATOLL_FIRST_CLEAR_DUST = 35
export const STARFALL_ATOLL_FIRST_CLEAR_SHARDS = 25

export const CROWNLESS_DEEP_MAX_FLOOR = 10
export const CROWNLESS_DEEP_FLOOR10_BONUS_DUST = 60
export const CROWNLESS_DEEP_FLOOR10_BONUS_SHARDS = 45
export const CROWNLESS_DEEP_FLOOR10_LEGEND_EQUIP = 'solis_crownblade'
export const CROWNLESS_DEEP_FLOOR10_LEGEND_HERO: HeroClassId = 'champion'

export interface GauntletWaveSpec {
  readonly round: number
  readonly title: string
  readonly bannerText: string
  readonly enemies: readonly ChapterEnemySpawn[]
}

export interface GauntletRecoveryResult {
  readonly healedUnits: number
  readonly totalHealed: number
  readonly apGained: number
}

export interface CrownlessDeepFloorSpec {
  readonly floor: number
  readonly title: string
  readonly subtitle: string
  readonly modifierSummary: string
  readonly difficulty: DifficultyLevel
  readonly recommendedPower: number
  readonly biome: BiomeId
  readonly mutators: readonly StageMutatorId[]
  readonly rewardGold: number
  readonly replayGold: number
  readonly bonusDust: number
  readonly bonusShards: number
  readonly grid: readonly (readonly TileTerrain[])[]
  readonly heights: readonly (readonly number[])[]
  readonly heroSpawns: readonly (readonly [number, number])[]
  readonly objective: BattleObjectiveSpec
  readonly enemies: readonly ChapterEnemySpawn[]
}

export interface CrownlessDeepRewardPlan {
  readonly floor: number
  readonly gold: number
  readonly bonusDust: number
  readonly bonusShards: number
  readonly firstFloorClear: boolean
  readonly isFloor10FirstClear: boolean
  readonly legendEquipId: string | null
  readonly legendHeroId: HeroClassId | null
}

// Terrain shorthands for readable, compact floor maps
const G: TileTerrain = 'grass'
const S: TileTerrain = 'stone'
const H: TileTerrain = 'hill'
const B: TileTerrain = 'bridge'
const W: TileTerrain = 'water'
const R: TileTerrain = 'shrine'
const P: TileTerrain = 'pillar'
const L: TileTerrain = 'lava'
const N: TileTerrain = 'snow'
const D: TileTerrain = 'darkstone'
const T: TileTerrain = 'stairs'
const V: TileTerrain = 'void'
const M: TileTerrain = 'lava_geyser'
const I: TileTerrain = 'ice'
const A: TileTerrain = 'cursed_altar'
const F: TileTerrain = 'tall_grass'

// =========================================================================
// 1. CINDER ARENA — 3-ROUND GLADIATOR GAUNTLET
// =========================================================================

export const CINDER_ARENA_WAVES: readonly GauntletWaveSpec[] = [
  {
    round: 1,
    title: 'Opening Bout',
    bannerText: 'ROUND 1 / 3 — OPENING BOUT!',
    enemies: [
      { id: 'orc_brute', col: 6, row: 2, levelScale: 1.05, name: 'Pit Bruiser' },
      { id: 'ember_pyromancer', col: 7, row: 3, levelScale: 1.05, name: 'Cinder Pyromancer' },
      { id: 'goblin', col: 6, row: 4, levelScale: 1.15, name: 'Arena Skirmisher' },
      { id: 'crypt_knight', col: 7, row: 2, levelScale: 1.0, name: 'Iron Gladiator' }
    ]
  },
  {
    round: 2,
    title: 'Blood & Ash Wave',
    bannerText: 'ROUND 2 / 3 — BLOOD & ASH WAVE!',
    enemies: [
      { id: 'river_troll', col: 7, row: 3, levelScale: 1.05, name: 'Arena Crusher' },
      { id: 'ember_pyromancer', col: 7, row: 1, levelScale: 1.12, name: 'Ash Pyromancer' },
      { id: 'crypt_knight', col: 6, row: 4, levelScale: 1.10, name: 'Obsidian Duelist' },
      { id: 'bone_archer', col: 8, row: 2, levelScale: 1.15, name: 'Pit Marksman' }
    ]
  },
  {
    round: 3,
    title: 'Champion Finale',
    bannerText: 'FINAL ROUND 3 / 3 — CHAMPION WAVE!',
    enemies: [
      { id: 'magma_warden', col: 7, row: 3, levelScale: 1.0, name: 'Arena Champion Ignar' },
      { id: 'ember_pyromancer', col: 7, row: 5, levelScale: 1.15, name: 'Flame Herald' },
      { id: 'crypt_knight', col: 6, row: 2, levelScale: 1.15, name: 'Bloodsworn Guard' },
      { id: 'orc_brute', col: 6, row: 4, levelScale: 1.15, name: 'Cinder Juggernaut' }
    ]
  }
]

/** True when a stage uses the multi-round Gladiator Gauntlet progression. */
export function isGauntletStage(stageId: string): boolean {
  return stageId === CINDER_ARENA_STAGE_ID
}

/** Total rounds for a gauntlet stage (0 for non-gauntlet stages). */
export function getGauntletMaxRounds(stageId: string): number {
  return isGauntletStage(stageId) ? CINDER_ARENA_MAX_ROUNDS : 0
}

/** Look up the authored wave spec for a given gauntlet round (1-based). */
export function getGauntletWaveSpec(stageId: string, round: number): GauntletWaveSpec | null {
  if (!isGauntletStage(stageId)) return null
  for (let i = 0; i < CINDER_ARENA_WAVES.length; i++) {
    if (CINDER_ARENA_WAVES[i].round === round) {
      return CINDER_ARENA_WAVES[i]
    }
  }
  return null
}

/** True when all current-wave enemies have fallen and another gauntlet round remains. */
export function canAdvanceGauntletRound(
  battle: Pick<BattleState, 'stageId' | 'endlessWave' | 'gauntletRound' | 'gauntletMaxRounds' | 'units'>
): boolean {
  if (battle.endlessWave > 0 || !isGauntletStage(battle.stageId)) return false
  const round = battle.gauntletRound ?? 0
  const maxRounds = battle.gauntletMaxRounds ?? 0
  if (round < 1 || maxRounds <= 1 || round >= maxRounds) return false
  let aliveAllies = 0
  let aliveEnemies = 0
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (!u.alive) continue
    if (u.team === 'ally') aliveAllies += 1
    else aliveEnemies += 1
  }
  return aliveAllies > 0 && aliveEnemies === 0
}

function isTileOccupiedByUnit(
  units: readonly Pick<BattleUnit, 'alive' | 'downed' | 'koCountdown' | 'col' | 'row'>[],
  col: number,
  row: number
): boolean {
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    if ((u.alive || isUnitDowned(u)) && u.col === col && u.row === row) {
      return true
    }
  }
  return false
}

/**
 * Find a walkable, unoccupied tile for a spawning gauntlet gladiator,
 * preferring `(preferredCol, preferredRow)` and falling back to the nearest open cell.
 */
export function findOpenGauntletSpawnTile(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  preferredCol: number,
  preferredRow: number,
  extraOccupied: readonly GridCoord[] = []
): GridCoord | null {
  const isReserved = (c: number, r: number): boolean => {
    for (let i = 0; i < extraOccupied.length; i++) {
      if (extraOccupied[i].col === c && extraOccupied[i].row === r) return true
    }
    return isTileOccupiedByUnit(battle.units, c, r)
  }

  if (
    preferredCol >= 0 && preferredCol < battle.cols &&
    preferredRow >= 0 && preferredRow < battle.rows
  ) {
    const prefCell = battle.cells[preferredRow]?.[preferredCol]
    if (prefCell && prefCell.walkable && terrainWalkable(prefCell.terrain) && !isReserved(preferredCol, preferredRow)) {
      return { col: preferredCol, row: preferredRow }
    }
  }

  let best: GridCoord | null = null
  let bestScore = 999999
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      const cell = battle.cells[r]?.[c]
      if (!cell || !cell.walkable || !terrainWalkable(cell.terrain)) continue
      if (isReserved(c, r)) continue
      const dist = Math.abs(c - preferredCol) + Math.abs(r - preferredRow)
      const hazardPenalty = cell.terrain === 'lava_geyser' ? 3 : 0
      const score = dist * 10 + hazardPenalty
      if (score < bestScore) {
        bestScore = score
        best = { col: c, row: r }
      }
    }
  }
  return best
}

/**
 * Recover living allies between gauntlet waves: +25% max HP and +1 AP (clamped to caps).
 */
export function applyGauntletInterRoundRecovery(
  battle: Pick<BattleState, 'units' | 'ap' | 'maxAp'>
): GauntletRecoveryResult {
  let healedUnits = 0
  let totalHealed = 0
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (!u.alive || u.team !== 'ally') continue
    const heal = Math.max(1, Math.round(u.maxHp * CINDER_ARENA_INTER_ROUND_HEAL_RATIO))
    const actual = Math.min(heal, Math.max(0, u.maxHp - u.hp))
    if (actual > 0) {
      u.hp += actual
      healedUnits += 1
      totalHealed += actual
    }
  }
  const prevAp = battle.ap
  battle.ap = Math.min(battle.maxAp, battle.ap + CINDER_ARENA_INTER_ROUND_AP_BONUS)
  const apGained = Math.max(0, battle.ap - prevAp)
  return { healedUnits, totalHealed, apGained }
}

/**
 * Construct ready-to-deploy BattleUnits for the given Cinder Arena gauntlet wave.
 */
export function createGauntletWaveUnits(
  battle: Pick<BattleState, 'stageId' | 'cells' | 'cols' | 'rows' | 'units' | 'difficulty' | 'difficultyTier' | 'mutators'>,
  round: number
): BattleUnit[] {
  const wave = getGauntletWaveSpec(battle.stageId, round)
  if (!wave) return []

  const spawned: BattleUnit[] = []
  const reserved: GridCoord[] = []
  for (let i = 0; i < wave.enemies.length; i++) {
    const sp = wave.enemies[i]
    const tile = findOpenGauntletSpawnTile(battle, sp.col, sp.row, reserved)
    if (!tile) continue
    reserved.push(tile)
    const spec = ENEMY_SPECS[sp.id]
    const scale = sp.levelScale ?? 1
    const scaled = computeScaledEnemyStats(
      {
        maxHp: Math.round(spec.maxHp * scale),
        atk: Math.round(spec.atk * scale),
        def: Math.round(spec.def * (1 + (scale - 1) * 0.5)),
        speed: spec.speed,
        baseShield: spec.isBoss ? 25 : 0
      },
      battle.difficultyTier,
      battle.mutators
    )
    const cell = battle.cells[tile.row][tile.col]
    const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
    const levelBase = Math.max(1, Math.min(20, Math.round(battle.difficulty * 2 - 1 + (round - 1) + (spec.isBoss ? 2 : 0))))
    spawned.push({
      uid: `gauntlet_r${round}_${i}_${sp.id}`,
      team: 'enemy',
      name: sp.name ?? spec.name,
      enemyId: sp.id,
      stars: spec.isBoss ? 3 : 1,
      level: levelBase,
      isBoss: Boolean(spec.isBoss),
      col: tile.col,
      row: tile.row,
      x: wx,
      y: wy,
      z: wz,
      yaw: facingToYaw('w'),
      facing: 'w',
      path: [],
      moveProgress: 0,
      hp: scaled.maxHp,
      maxHp: scaled.maxHp,
      shield: scaled.shield,
      atk: scaled.atk,
      def: scaled.def,
      speed: scaled.speed,
      ct: scaled.speed * 2,
      move: spec.move,
      jump: spec.jump,
      range: spec.range,
      crit: 0.08,
      lifesteal: 0,
      moved: false,
      acted: false,
      alive: true,
      downed: false,
      koCountdown: 0,
      burnTurns: 0,
      slowTurns: 0,
      stunTurns: 0,
      empowerTurns: 0,
      tauntTurns: 0,
      hasteTurns: 0,
      poisonStacks: 0,
      cooldowns: [0, 0, 0],
      animState: 'idle',
      animTimer: 0,
      hitFlash: 0,
      lungeX: 0,
      lungeZ: 0
    })
  }
  return spawned
}

// =========================================================================
// 2. BRIMSTONE MAW — IGNIS TITAN CATACLYSM SLAM GEYSER IGNITION
// =========================================================================

/**
 * Ignite every `lava_geyser` tile within Manhattan distance `radius` of `(centerCol, centerRow)`.
 * Returns the coordinates of all geysers awakened by the tremor.
 */
export function igniteNearbyLavaGeysers(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  centerCol: number,
  centerRow: number,
  radius = IGNIS_TITAN_GEYSER_IGNITE_RADIUS
): GridCoord[] {
  const ignited: GridCoord[] = []
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      const dist = Math.abs(c - centerCol) + Math.abs(r - centerRow)
      if (dist > radius) continue
      const cell = battle.cells[r]?.[c]
      if (!cell || cell.terrain !== 'lava_geyser') continue
      cell.geyserActive = true
      ignited.push({ col: c, row: r })
    }
  }
  return ignited
}

// =========================================================================
// 3. STARFALL ATOLL — MYTHIC FIRST-CLEAR SPOILS
// =========================================================================

/** Bonus Arcane Dust & Hero Shards awarded on first clear of Starfall Atoll. */
export function getStarfallFirstClearBonus(
  stageId: string,
  firstClear: boolean
): { readonly bonusDust: number; readonly bonusShards: number } {
  if (stageId === STARFALL_ATOLL_STAGE_ID && firstClear) {
    return {
      bonusDust: STARFALL_ATOLL_FIRST_CLEAR_DUST,
      bonusShards: STARFALL_ATOLL_FIRST_CLEAR_SHARDS
    }
  }
  return { bonusDust: 0, bonusShards: 0 }
}

// =========================================================================
// 4. CROWNLESS DEEP — 10-FLOOR SECRET ABYSS DUNGEON
// =========================================================================

const ABYSS_HERO_SPAWNS: readonly (readonly [number, number])[] = [[0, 2], [0, 3], [0, 4], [1, 3]]

export const CROWNLESS_DEEP_FLOORS: readonly CrownlessDeepFloorSpec[] = [
  // Floor 1 — Threshold of Ash (Tier VI · Darkness Trench)
  {
    floor: 1,
    title: 'Threshold of Ash',
    subtitle: 'Floor 1 / 10 · Pitch-Black Trench',
    modifierSummary: 'Fog of War · Cursed Altar & Obsidian Trench',
    difficulty: 6,
    recommendedPower: 1850,
    biome: 'throne',
    mutators: ['fog_of_war'],
    rewardGold: 320,
    replayGold: 165,
    bonusDust: 14,
    bonusShards: 10,
    grid: [
      [V, D, D, P, D, P, D, D, V],
      [D, D, T, D, D, D, T, D, D],
      [D, S, D, D, A, D, D, S, D],
      [D, S, T, D, D, D, T, S, D],
      [D, S, D, D, R, D, D, S, D],
      [D, D, T, D, D, D, T, D, D],
      [V, D, D, P, D, P, D, D, V]
    ],
    heights: [
      [-1, 1, 1, 1, 1, 1, 1, 1, -1],
      [ 1, 1, 1, 0, 0, 0, 1, 1,  1],
      [ 1, 1, 0, 0, 0, 0, 0, 1,  1],
      [ 1, 1, 1, 0, 0, 0, 1, 1,  1],
      [ 1, 1, 0, 0, 0, 0, 0, 1,  1],
      [ 1, 1, 1, 0, 0, 0, 1, 1,  1],
      [-1, 1, 1, 1, 1, 1, 1, 1, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 1 · Clear Trench',
      description: 'Rout the vanguard of the Crownless Deep to descend to Floor 2.'
    },
    enemies: [
      { id: 'abyssal_sentinel', col: 7, row: 3, levelScale: 1.0 },
      { id: 'crypt_knight', col: 6, row: 1, levelScale: 1.15 },
      { id: 'bone_necromancer', col: 7, row: 5, levelScale: 1.15 },
      { id: 'bone_archer', col: 8, row: 2, levelScale: 1.15 }
    ]
  },

  // Floor 2 — Pitch-Black Narrows (Tier VI · Fog + Venom Mist)
  {
    floor: 2,
    title: 'Pitch-Black Narrows',
    subtitle: 'Floor 2 / 10 · Shrouded Catacomb',
    modifierSummary: 'Fog of War + Venom Mist · Tall Grass Ambush',
    difficulty: 6,
    recommendedPower: 1940,
    biome: 'crypt',
    mutators: ['fog_of_war', 'venom_mist'],
    rewardGold: 350,
    replayGold: 180,
    bonusDust: 16,
    bonusShards: 12,
    grid: [
      [V, D, F, D, D, D, F, D, V],
      [D, F, T, D, P, D, T, F, D],
      [D, S, D, F, A, F, D, S, D],
      [D, S, T, D, D, D, T, S, D],
      [D, S, D, F, R, F, D, S, D],
      [D, F, T, D, P, D, T, F, D],
      [V, D, F, D, D, D, F, D, V]
    ],
    heights: [
      [-1, 0, 0, 1, 1, 1, 0, 0, -1],
      [ 0, 0, 1, 1, 1, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 1, 1, 1, 0,  0],
      [-1, 0, 0, 1, 1, 1, 0, 0, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 2 · Purge Narrows',
      description: 'Clear the toxic mist ambushers lurking in the Pitch-Black Narrows.'
    },
    enemies: [
      { id: 'mire_matriarch', col: 7, row: 3, levelScale: 1.15, name: 'Abyssal Matriarch' },
      { id: 'bog_shaman', col: 7, row: 1, levelScale: 1.25 },
      { id: 'crypt_knight', col: 5, row: 3, levelScale: 1.20 },
      { id: 'bone_archer', col: 8, row: 4, levelScale: 1.22 }
    ]
  },

  // Floor 3 — Geyser Fissure (Tier VI · Magma Hazards + Blood Moon)
  {
    floor: 3,
    title: 'Geyser Fissure',
    subtitle: 'Floor 3 / 10 · Volcanic Faultline',
    modifierSummary: 'Blood Moon · Erupting Lava Geysers & Obsidian Bridges',
    difficulty: 6,
    recommendedPower: 2040,
    biome: 'volcano',
    mutators: ['blood_moon'],
    rewardGold: 385,
    replayGold: 195,
    bonusDust: 18,
    bonusShards: 14,
    grid: [
      [V, L, D, D, D, D, D, L, V],
      [D, D, B, T, M, T, B, D, D],
      [D, S, L, D, D, D, L, S, D],
      [D, S, B, T, R, T, B, S, D],
      [D, S, L, D, D, D, L, S, D],
      [D, D, B, T, M, T, B, D, D],
      [V, L, D, D, D, D, D, L, V]
    ],
    heights: [
      [-1, 0, 0, 1, 1, 1, 0, 0, -1],
      [ 0, 0, 0, 1, 1, 1, 0, 0,  0],
      [ 0, 0, 0, 1, 2, 1, 0, 0,  0],
      [ 0, 0, 0, 1, 2, 1, 0, 0,  0],
      [ 0, 0, 0, 1, 2, 1, 0, 0,  0],
      [ 0, 0, 0, 1, 1, 1, 0, 0,  0],
      [-1, 0, 0, 1, 1, 1, 0, 0, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 3 · Cross Fissure',
      description: 'Vanquish the cinder vanguard guarding the volcanic fissure.'
    },
    enemies: [
      { id: 'abyssal_sentinel', col: 6, row: 3, levelScale: 1.08 },
      { id: 'ember_pyromancer', col: 7, row: 1, levelScale: 1.25 },
      { id: 'ember_pyromancer', col: 7, row: 5, levelScale: 1.25 },
      { id: 'orc_brute', col: 5, row: 2, levelScale: 1.28, name: 'Slag Marauder' }
    ]
  },

  // Floor 4 — Glacial Chasm (Tier VI · Ice Hazard + Iron Vanguard)
  {
    floor: 4,
    title: 'Glacial Chasm',
    subtitle: 'Floor 4 / 10 · Frozen Sea-Shelf',
    modifierSummary: 'Iron Vanguard · Ice Glide Sheets & Deep Snow',
    difficulty: 6,
    recommendedPower: 2140,
    biome: 'frost',
    mutators: ['iron_vanguard'],
    rewardGold: 420,
    replayGold: 210,
    bonusDust: 20,
    bonusShards: 16,
    grid: [
      [V, N, I, W, S, W, I, N, V],
      [N, I, I, B, T, B, I, I, N],
      [S, N, I, W, H, W, I, N, S],
      [S, S, T, B, R, B, T, S, S],
      [S, N, I, W, H, W, I, N, S],
      [N, I, I, B, T, B, I, I, N],
      [V, N, I, W, S, W, I, N, V]
    ],
    heights: [
      [-1, 0, 0, 0, 1, 0, 0, 0, -1],
      [ 0, 0, 0, 0, 1, 0, 0, 0,  0],
      [ 0, 0, 0, 0, 2, 0, 0, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 0, 0, 2, 0, 0, 0,  0],
      [ 0, 0, 0, 0, 1, 0, 0, 0,  0],
      [-1, 0, 0, 0, 1, 0, 0, 0, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 4 · Shatter Frost',
      description: 'Break through the armored frost wardens across the frozen chasm.'
    },
    enemies: [
      { id: 'frost_jarl', col: 7, row: 3, levelScale: 1.05, name: 'Deepfrost Jarl' },
      { id: 'frost_golem', col: 5, row: 3, levelScale: 1.22 },
      { id: 'ice_wraith', col: 7, row: 1, levelScale: 1.25 },
      { id: 'ice_wraith', col: 7, row: 5, levelScale: 1.25 }
    ]
  },

  // Floor 5 — Ossuary of Echoes (Tier VII · Necromancer Crypt)
  {
    floor: 5,
    title: 'Ossuary of Echoes',
    subtitle: 'Floor 5 / 10 · Necromancer Crypt',
    modifierSummary: 'Fog of War + Arcane Surge · Twin Cursed Altars & Summoners',
    difficulty: 7,
    recommendedPower: 2260,
    biome: 'crypt',
    mutators: ['fog_of_war', 'arcane_surge'],
    rewardGold: 470,
    replayGold: 235,
    bonusDust: 24,
    bonusShards: 18,
    grid: [
      [V, D, D, P, D, P, D, D, V],
      [D, S, T, D, A, D, T, S, D],
      [D, S, D, D, D, D, D, S, D],
      [D, S, T, D, R, D, T, S, D],
      [D, S, D, D, D, D, D, S, D],
      [D, S, T, D, A, D, T, S, D],
      [V, D, D, P, D, P, D, D, V]
    ],
    heights: [
      [-1, 0, 1, 1, 1, 1, 1, 0, -1],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 1, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [-1, 0, 1, 1, 1, 1, 1, 0, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 5 · Silence Crypt',
      description: 'Destroy the necromancer cabal before their skeletal horde overwhelms the crypt.'
    },
    enemies: [
      { id: 'ash_inquisitor', col: 7, row: 3, levelScale: 1.12, name: 'Ossuary Inquisitor' },
      { id: 'bone_necromancer', col: 7, row: 1, levelScale: 1.25 },
      { id: 'bone_necromancer', col: 7, row: 5, levelScale: 1.25 },
      { id: 'crypt_knight', col: 5, row: 2, levelScale: 1.25 },
      { id: 'bone_thrall', col: 5, row: 4, levelScale: 1.30 }
    ]
  },

  // Floor 6 — Bloodtide Crucible (Tier VII · Sunken River Ruin)
  {
    floor: 6,
    title: 'Bloodtide Crucible',
    subtitle: 'Floor 6 / 10 · Drowned Causeway',
    modifierSummary: 'Blood Moon + Venom Mist · Regenerating Trolls & Causeways',
    difficulty: 7,
    recommendedPower: 2380,
    biome: 'river',
    mutators: ['blood_moon', 'venom_mist'],
    rewardGold: 515,
    replayGold: 255,
    bonusDust: 28,
    bonusShards: 21,
    grid: [
      [V, G, F, W, S, W, F, G, V],
      [G, F, S, B, T, B, S, F, G],
      [G, S, F, W, S, W, F, S, G],
      [S, S, S, B, R, B, S, S, S],
      [G, S, F, W, S, W, F, S, G],
      [G, F, S, B, T, B, S, F, G],
      [V, G, F, W, S, W, F, G, V]
    ],
    heights: [
      [-1, 0, 0, 0, 1, 0, 0, 0, -1],
      [ 0, 0, 0, 0, 1, 0, 0, 0,  0],
      [ 0, 0, 0, 0, 1, 0, 0, 0,  0],
      [ 0, 0, 0, 0, 1, 0, 0, 0,  0],
      [ 0, 0, 0, 0, 1, 0, 0, 0,  0],
      [ 0, 0, 0, 0, 1, 0, 0, 0,  0],
      [-1, 0, 0, 0, 1, 0, 0, 0, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 6 · Break Bloodtide',
      description: 'Suppress the regenerating trolls and clear the drowned causeway.'
    },
    enemies: [
      { id: 'river_troll', col: 6, row: 2, levelScale: 1.25, name: 'Abyssal Troll' },
      { id: 'river_troll', col: 6, row: 4, levelScale: 1.25, name: 'Abyssal Troll' },
      { id: 'mire_matriarch', col: 8, row: 3, levelScale: 1.18, name: 'Bloodtide Matriarch' },
      { id: 'abyssal_sentinel', col: 7, row: 1, levelScale: 1.12 },
      { id: 'bog_shaman', col: 7, row: 5, levelScale: 1.30 }
    ]
  },

  // Floor 7 — Magma Kiln (Tier VII · Quad-Geyser Caldera)
  {
    floor: 7,
    title: 'Magma Kiln',
    subtitle: 'Floor 7 / 10 · Subterranean Crucible',
    modifierSummary: 'Blood Moon + Iron Vanguard · Quad Lava Geysers',
    difficulty: 7,
    recommendedPower: 2520,
    biome: 'volcano',
    mutators: ['blood_moon', 'iron_vanguard'],
    rewardGold: 560,
    replayGold: 275,
    bonusDust: 32,
    bonusShards: 24,
    grid: [
      [V, L, D, D, D, D, D, L, V],
      [D, D, M, T, D, T, M, D, D],
      [D, S, B, D, D, D, B, S, D],
      [D, S, L, T, R, T, L, S, D],
      [D, S, B, D, D, D, B, S, D],
      [D, D, M, T, D, T, M, D, D],
      [V, L, D, D, D, D, D, L, V]
    ],
    heights: [
      [-1, 0, 0, 1, 1, 1, 0, 0, -1],
      [ 0, 0, 0, 1, 1, 1, 0, 0,  0],
      [ 0, 0, 0, 1, 2, 1, 0, 0,  0],
      [ 0, 0, 0, 1, 2, 1, 0, 0,  0],
      [ 0, 0, 0, 1, 2, 1, 0, 0,  0],
      [ 0, 0, 0, 1, 1, 1, 0, 0,  0],
      [-1, 0, 0, 1, 1, 1, 0, 0, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 7 · Quench Kiln',
      description: 'Endure the erupting magma vents and topple the kiln warden.'
    },
    enemies: [
      { id: 'magma_warden', col: 7, row: 3, levelScale: 1.10, name: 'Kiln Warden' },
      { id: 'abyssal_sentinel', col: 5, row: 3, levelScale: 1.15 },
      { id: 'ember_pyromancer', col: 7, row: 1, levelScale: 1.32 },
      { id: 'ember_pyromancer', col: 7, row: 5, levelScale: 1.32 },
      { id: 'orc_brute', col: 6, row: 2, levelScale: 1.35, name: 'Cinder Executioner' }
    ]
  },

  // Floor 8 — Frostbite Sanctum (Tier VII · Dark Ice Labyrinth)
  {
    floor: 8,
    title: 'Frostbite Sanctum',
    subtitle: 'Floor 8 / 10 · Darkened Ice Hall',
    modifierSummary: 'Fog of War + Iron Vanguard · Slick Ice & Pillars',
    difficulty: 7,
    recommendedPower: 2660,
    biome: 'frost',
    mutators: ['fog_of_war', 'iron_vanguard'],
    rewardGold: 610,
    replayGold: 295,
    bonusDust: 36,
    bonusShards: 28,
    grid: [
      [V, N, I, P, S, P, I, N, V],
      [N, I, T, I, I, I, T, I, N],
      [S, I, D, I, A, I, D, I, S],
      [S, S, T, I, R, I, T, S, S],
      [S, I, D, I, D, I, D, I, S],
      [N, I, T, I, I, I, T, I, N],
      [V, N, I, P, S, P, I, N, V]
    ],
    heights: [
      [-1, 0, 0, 0, 1, 0, 0, 0, -1],
      [ 0, 0, 1, 1, 1, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 2, 1, 1, 0,  0],
      [ 0, 0, 1, 1, 1, 1, 1, 0,  0],
      [-1, 0, 0, 0, 1, 0, 0, 0, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 8 · Break Sanctum',
      description: 'Defeat the frost vanguard hidden in the pitch-black ice labyrinth.'
    },
    enemies: [
      { id: 'frost_jarl', col: 7, row: 3, levelScale: 1.15, name: 'Abyssal Jarl' },
      { id: 'frost_golem', col: 5, row: 3, levelScale: 1.32 },
      { id: 'abyssal_sentinel', col: 6, row: 2, levelScale: 1.20 },
      { id: 'ice_wraith', col: 7, row: 1, levelScale: 1.35 },
      { id: 'ice_wraith', col: 7, row: 5, levelScale: 1.35 }
    ]
  },

  // Floor 9 — Sovereign's Antechamber (Tier VIII · Twin-Hazard Gauntlet)
  {
    floor: 9,
    title: "Sovereign's Antechamber",
    subtitle: 'Floor 9 / 10 · Gate of the Deep',
    modifierSummary: 'Arcane Surge + Blood Moon · Fire & Ice Hazards + Titan Echo',
    difficulty: 8,
    recommendedPower: 2820,
    biome: 'throne',
    mutators: ['arcane_surge', 'blood_moon'],
    rewardGold: 680,
    replayGold: 330,
    bonusDust: 42,
    bonusShards: 32,
    grid: [
      [V, D, D, P, D, P, D, D, V],
      [D, D, T, M, I, M, T, D, D],
      [D, S, D, I, A, I, D, S, D],
      [D, S, T, D, D, D, T, S, D],
      [D, S, D, I, R, I, D, S, D],
      [D, D, T, M, I, M, T, D, D],
      [V, D, D, P, D, P, D, D, V]
    ],
    heights: [
      [-1, 1, 1, 1, 1, 1, 1, 1, -1],
      [ 1, 1, 1, 0, 0, 0, 1, 1,  1],
      [ 1, 1, 0, 0, 0, 0, 0, 1,  1],
      [ 1, 1, 1, 0, 0, 0, 1, 1,  1],
      [ 1, 1, 0, 0, 0, 0, 0, 1,  1],
      [ 1, 1, 1, 0, 0, 0, 1, 1,  1],
      [-1, 1, 1, 1, 1, 1, 1, 1, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'rout',
      label: 'Floor 9 · Breach Gate',
      description: 'Topple the Titan Echo and Abyssal Sentinels guarding the final throne.'
    },
    enemies: [
      { id: 'ignis_titan', col: 7, row: 3, levelScale: 1.05, name: 'Titan Echo' },
      { id: 'abyssal_sentinel', col: 6, row: 2, levelScale: 1.22 },
      { id: 'abyssal_sentinel', col: 6, row: 4, levelScale: 1.22 },
      { id: 'bone_necromancer', col: 8, row: 1, levelScale: 1.35 },
      { id: 'ember_pyromancer', col: 8, row: 5, levelScale: 1.35 }
    ]
  },

  // Floor 10 — Throne of the Crownless (Tier VIII · Abyssal Sovereign Climax)
  {
    floor: 10,
    title: 'Throne of the Crownless',
    subtitle: 'Floor 10 / 10 · Abyssal Sovereign',
    modifierSummary: 'Fog of War + Arcane Surge + Blood Moon · Pinnacles of the Deep',
    difficulty: 8,
    recommendedPower: 3000,
    biome: 'throne',
    mutators: ['fog_of_war', 'arcane_surge', 'blood_moon'],
    rewardGold: 850,
    replayGold: 380,
    bonusDust: 45,
    bonusShards: 35,
    grid: [
      [V, V, D, D, P, D, D, V, V],
      [V, D, D, M, D, T, D, D, V],
      [D, S, T, D, A, T, D, D, D],
      [D, S, T, D, D, T, D, D, D],
      [D, S, T, D, R, T, D, D, D],
      [V, D, D, M, D, T, D, D, V],
      [V, V, D, D, P, D, D, V, V]
    ],
    heights: [
      [-1, -1, 1, 1, 1, 1, 2, -1, -1],
      [-1,  0, 1, 1, 1, 2, 2,  2, -1],
      [ 0,  0, 1, 1, 1, 2, 2,  3,  3],
      [ 0,  0, 1, 1, 1, 2, 2,  3,  3],
      [ 0,  0, 1, 1, 1, 2, 2,  3,  3],
      [-1,  0, 1, 1, 1, 2, 2,  2, -1],
      [-1, -1, 1, 1, 1, 1, 2, -1, -1]
    ],
    heroSpawns: ABYSS_HERO_SPAWNS,
    objective: {
      kind: 'assassinate',
      targetEnemyId: 'eclipse_archon',
      targetName: 'Abyssal Sovereign',
      label: 'Floor 10 · Slay Abyssal Sovereign',
      description: 'Ascend the sunken obsidian throne and defeat the Abyssal Sovereign to conquer Crownless Deep.'
    },
    enemies: [
      { id: 'eclipse_archon', col: 7, row: 3, levelScale: 1.38, name: 'Abyssal Sovereign' },
      { id: 'abyssal_sentinel', col: 6, row: 2, levelScale: 1.25 },
      { id: 'abyssal_sentinel', col: 6, row: 4, levelScale: 1.25 },
      { id: 'ash_inquisitor', col: 7, row: 1, levelScale: 1.22, name: 'Sovereign Confessor' },
      { id: 'ember_pyromancer', col: 7, row: 5, levelScale: 1.38, name: 'Void Pyromancer' }
    ]
  }
]

/** True when `stageId` is the Crownless Deep 10-floor secret dungeon. */
export function isCrownlessDeepStage(stageId: string): boolean {
  return stageId === CROWNLESS_DEEP_STAGE_ID
}

/** Sanitize persisted cleared-floor count (0..10), defaulting to 0 for legacy saves. */
export function normalizeCrownlessDeepFloorCleared(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0
  const n = Math.floor(raw)
  if (n < 0) return 0
  if (n > CROWNLESS_DEEP_MAX_FLOOR) return CROWNLESS_DEEP_MAX_FLOOR
  return n
}

/** Next uncleared floor (1..10) for Crownless Deep progression. */
export function getNextCrownlessDeepFloor(
  campaign: Pick<CampaignState, 'crownlessDeepFloor'>
): number {
  const cleared = normalizeCrownlessDeepFloorCleared(campaign.crownlessDeepFloor)
  return Math.min(CROWNLESS_DEEP_MAX_FLOOR, cleared + 1)
}

/** Highest selectable floor (1..10): cleared + 1, capped at 10. */
export function getMaxSelectableCrownlessDeepFloor(
  campaign: Pick<CampaignState, 'crownlessDeepFloor'>
): number {
  return getNextCrownlessDeepFloor(campaign)
}

/** Active selected floor (1..maxSelectable) for Crownless Deep deployment / replay. */
export function getSelectedCrownlessDeepFloor(
  campaign: Pick<CampaignState, 'crownlessDeepFloor' | 'crownlessDeepSelectedFloor'>
): number {
  const maxFloor = getMaxSelectableCrownlessDeepFloor(campaign)
  const raw = campaign.crownlessDeepSelectedFloor
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const clamped = Math.max(1, Math.min(maxFloor, Math.floor(raw)))
    return clamped
  }
  return maxFloor
}

/** Update the selected Crownless Deep floor for replay or progression (clamped to unlocked range). */
export function setSelectedCrownlessDeepFloor(campaign: CampaignState, floor: number): number {
  const maxFloor = getMaxSelectableCrownlessDeepFloor(campaign)
  const clamped = Math.max(1, Math.min(maxFloor, Math.floor(floor)))
  campaign.crownlessDeepSelectedFloor = clamped
  return clamped
}

/** Fetch the encounter spec for Floor N (1..10), clamping out-of-range inputs safely. */
export function getCrownlessDeepFloorSpec(floor: number): CrownlessDeepFloorSpec {
  const idx = Math.max(1, Math.min(CROWNLESS_DEEP_MAX_FLOOR, Math.floor(floor))) - 1
  return CROWNLESS_DEEP_FLOORS[idx]
}

/** Concise HUD & World Map readout string (`Floor N / 10`). */
export function formatAbyssFloorLabel(floor: number): string {
  const clamped = Math.max(1, Math.min(CROWNLESS_DEEP_MAX_FLOOR, Math.floor(floor)))
  return `Floor ${clamped} / ${CROWNLESS_DEEP_MAX_FLOOR}`
}

/**
 * Compute Crownless Deep rewards for clearing `floor`, tracking first-time floor clear
 * and the one-time legendary Floor 10 completion spoils.
 */
export function resolveCrownlessDeepVictoryRewards(
  campaign: Pick<CampaignState, 'crownlessDeepFloor' | 'crownlessDeepRewardClaimed'>,
  floor: number
): CrownlessDeepRewardPlan {
  const spec = getCrownlessDeepFloorSpec(floor)
  const clearedBefore = normalizeCrownlessDeepFloorCleared(campaign.crownlessDeepFloor)
  const firstFloorClear = spec.floor > clearedBefore
  const isFloor10FirstClear = spec.floor === CROWNLESS_DEEP_MAX_FLOOR && campaign.crownlessDeepRewardClaimed !== true

  const gold = firstFloorClear ? spec.rewardGold : spec.replayGold
  const bonusDust = spec.bonusDust + (isFloor10FirstClear ? CROWNLESS_DEEP_FLOOR10_BONUS_DUST : 0)
  const bonusShards = spec.bonusShards + (isFloor10FirstClear ? CROWNLESS_DEEP_FLOOR10_BONUS_SHARDS : 0)

  return {
    floor: spec.floor,
    gold,
    bonusDust,
    bonusShards,
    firstFloorClear,
    isFloor10FirstClear,
    legendEquipId: isFloor10FirstClear ? CROWNLESS_DEEP_FLOOR10_LEGEND_EQUIP : null,
    legendHeroId: isFloor10FirstClear ? CROWNLESS_DEEP_FLOOR10_LEGEND_HERO : null
  }
}
