import { ENEMY_SPECS } from './data.ts'
import { computeScaledEnemyStats } from './mutators.ts'
import {
  gridToWorld,
  isUnitDowned,
  facingToYaw,
  terrainWalkable
} from './types.ts'
import type {
  BattleState,
  BattleUnit,
  BiomeId,
  ElementKind,
  EnemyArchetypeId,
  GridCoord,
  StatusKind
} from './types.ts'

/**
 * Pure biome-specific enemy archetype & regional mini-boss helpers.
 * Zero browser globals and Godot-compiler-compatible.
 */

export const NECROMANCER_SUMMON_CAP = 2
export const NECROMANCER_SUMMON_COOLDOWN = 3
export const RIVER_TROLL_REGEN_AMOUNT = 8
export const RIVER_TROLL_SLAM_COOLDOWN = 2
export const PYROMANCER_NOVA_COOLDOWN = 3
export const ICE_WRAITH_CHILLED_BONUS_MUL = 1.30
export const MINIBOSS_SPECIAL_COOLDOWN = 2

export const BIOME_ENEMY_ARCHETYPES: readonly EnemyArchetypeId[] = [
  'ember_pyromancer',
  'ice_wraith',
  'bone_necromancer',
  'river_troll',
  'bone_thrall'
]

export const REGIONAL_MINIBOSS_ARCHETYPES: readonly EnemyArchetypeId[] = [
  'briar_warlord',
  'mire_matriarch',
  'ash_inquisitor',
  'frost_jarl',
  'magma_warden'
]

export type EnemySpecialMoveKind =
  | 'cinder_nova'
  | 'tidal_slam'
  | 'warlord_slam'
  | 'mire_miasma'
  | 'ash_nova'
  | 'frost_breath'
  | 'magma_slam'
  | 'cataclysm_slam'
  | 'abyssal_cleave'
  | 'eclipse_nova'

export interface TurnStartRegenResult {
  readonly amount: number
  readonly suppressedBy: 'none' | 'burn' | 'poison'
}

export interface EnemyBasicStatusEffect {
  readonly status: StatusKind
  readonly stacks?: number
}

export interface EnemySpecialDecision {
  readonly move: EnemySpecialMoveKind
  readonly vfxMove: 'eclipse_nova' | 'shaman_mend' | 'lich_summon' | 'frostwyrm_breath' | 'titan_slam' | 'fire_nova'
  readonly cooldownTurns: number
  readonly pattern: 'single' | 'cross'
  readonly powerMul: number
  readonly ignoreArmor: number
  readonly status?: StatusKind
  readonly statusStacks?: number
  readonly element?: ElementKind
  readonly knockbackDistance?: number
  readonly ignitesGeysers?: boolean
  readonly label: string
}

const ORTHO_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1]
]

function manhattanDist(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

/** True when this enemy archetype can summon skeletal minions. */
export function isSummonerArchetype(enemyId?: EnemyArchetypeId): boolean {
  return enemyId === 'bone_necromancer' || enemyId === 'ash_inquisitor'
}

/** True when this enemy archetype naturally regenerates HP at the start of its turn. */
export function isRegeneratingArchetype(enemyId?: EnemyArchetypeId): boolean {
  return enemyId === 'river_troll'
}

/** True when this enemy archetype is a named regional mini-boss. */
export function isRegionalMiniBoss(enemyId?: EnemyArchetypeId): boolean {
  return (
    enemyId === 'briar_warlord' ||
    enemyId === 'mire_matriarch' ||
    enemyId === 'ash_inquisitor' ||
    enemyId === 'frost_jarl' ||
    enemyId === 'magma_warden'
  )
}

/** Home biome affinity for each enemy archetype. */
export function getEnemyBiomeAffinity(enemyId: EnemyArchetypeId): BiomeId {
  if (enemyId === 'ember_pyromancer' || enemyId === 'magma_warden' || enemyId === 'ignis_titan') return 'volcano'
  if (enemyId === 'ice_wraith' || enemyId === 'frost_golem' || enemyId === 'frost_jarl') return 'frost'
  if (
    enemyId === 'bone_necromancer' ||
    enemyId === 'bone_thrall' ||
    enemyId === 'bone_archer' ||
    enemyId === 'crypt_knight' ||
    enemyId === 'ash_inquisitor'
  ) {
    return 'crypt'
  }
  if (enemyId === 'river_troll' || enemyId === 'bog_shaman' || enemyId === 'mire_matriarch') return 'river'
  if (enemyId === 'eclipse_archon' || enemyId === 'abyssal_sentinel') return 'throne'
  return 'meadow'
}

/** Projectile visual style for ranged enemy basic attacks. */
export function getEnemyProjectileStyle(
  enemyId?: EnemyArchetypeId
): 'arrow' | 'fire' | 'frost' | 'shadow' | 'arcane' {
  if (enemyId === 'bone_archer') return 'arrow'
  if (enemyId === 'ember_pyromancer' || enemyId === 'magma_warden' || enemyId === 'ignis_titan') return 'fire'
  if (enemyId === 'ice_wraith' || enemyId === 'frost_jarl') return 'frost'
  if (
    enemyId === 'eclipse_archon' ||
    enemyId === 'abyssal_sentinel' ||
    enemyId === 'bog_shaman' ||
    enemyId === 'bone_necromancer' ||
    enemyId === 'ash_inquisitor' ||
    enemyId === 'mire_matriarch'
  ) {
    return 'shadow'
  }
  return 'arcane'
}

/** Status inflicted on basic attack hit by biome archetypes & mini-bosses. */
export function getEnemyBasicAttackStatus(enemyId?: EnemyArchetypeId): EnemyBasicStatusEffect | null {
  if (enemyId === 'bog_shaman' || enemyId === 'mire_matriarch') {
    return { status: 'poison', stacks: 2 }
  }
  if (enemyId === 'ember_pyromancer' || enemyId === 'magma_warden' || enemyId === 'ignis_titan') {
    return { status: 'burn' }
  }
  if (enemyId === 'ice_wraith' || enemyId === 'frost_jarl' || enemyId === 'abyssal_sentinel') {
    return { status: 'slow' }
  }
  return null
}

/** Elemental affinity of an enemy's basic attack for Wave 4 elemental combos. */
export function getEnemyAttackElement(enemyId?: EnemyArchetypeId): ElementKind | null {
  if (enemyId === 'ember_pyromancer' || enemyId === 'magma_warden' || enemyId === 'ignis_titan') return 'fire'
  if (enemyId === 'ice_wraith' || enemyId === 'frost_jarl') return 'frost'
  if (enemyId === 'bog_shaman' || enemyId === 'mire_matriarch') return 'poison'
  return null
}

/**
 * Archetype-specific damage multiplier (e.g., Ice Wraith & Frost Jarl exploit Chilled/Slowed foes).
 */
export function computeEnemyArchetypeDamageMul(
  attacker: Pick<BattleUnit, 'enemyId'>,
  target: Pick<BattleUnit, 'slowTurns' | 'burnTurns' | 'poisonStacks'>
): number {
  if ((attacker.enemyId === 'ice_wraith' || attacker.enemyId === 'frost_jarl') && target.slowTurns > 0) {
    return ICE_WRAITH_CHILLED_BONUS_MUL
  }
  return 1.0
}

/**
 * Evaluate start-of-turn natural regeneration (e.g., River Troll regenerates +8 HP unless Burning or Poisoned).
 * Pass the unit's burn/poison state captured BEFORE start-of-turn DoT decrement.
 */
export function evaluateTurnStartRegeneration(
  unit: Pick<BattleUnit, 'alive' | 'enemyId' | 'hp' | 'maxHp' | 'burnTurns' | 'poisonStacks'>
): TurnStartRegenResult {
  if (!unit.alive || !isRegeneratingArchetype(unit.enemyId)) {
    return { amount: 0, suppressedBy: 'none' }
  }
  if (unit.burnTurns > 0) {
    return { amount: 0, suppressedBy: 'burn' }
  }
  if (unit.poisonStacks > 0) {
    return { amount: 0, suppressedBy: 'poison' }
  }
  if (unit.hp >= unit.maxHp) {
    return { amount: 0, suppressedBy: 'none' }
  }
  return {
    amount: Math.min(RIVER_TROLL_REGEN_AMOUNT, unit.maxHp - unit.hp),
    suppressedBy: 'none'
  }
}

/** Count currently living summoned units owned by `summonerUid`. */
export function countActiveSummonsFor(
  battle: Pick<BattleState, 'units'>,
  summonerUid: string
): number {
  let count = 0
  for (const u of battle.units) {
    if (u.alive && u.team === 'enemy' && u.summonerUid === summonerUid) {
      count += 1
    }
  }
  return count
}

/** True when a Necromancer / Ash Inquisitor can legally raise a new skeleton this turn. */
export function canSummonerRaiseMinion(
  battle: Pick<BattleState, 'units'>,
  summoner: Pick<BattleUnit, 'uid' | 'alive' | 'enemyId' | 'cooldowns'>,
  cap = NECROMANCER_SUMMON_CAP
): boolean {
  if (!summoner.alive || !isSummonerArchetype(summoner.enemyId)) return false
  if (summoner.cooldowns[0] > 0) return false
  return countActiveSummonsFor(battle, summoner.uid) < cap
}

/**
 * Find the best adjacent walkable unoccupied tile around `summoner` to raise a minion.
 * Prefers safe tiles (not active lava geysers) closest to `target`, with deterministic tie-breaking.
 */
export function findBestSummonTile(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  summoner: Pick<BattleUnit, 'col' | 'row'>,
  target?: Pick<BattleUnit, 'col' | 'row'> | null
): GridCoord | null {
  let best: GridCoord | null = null
  let bestScore = -99999

  for (const [dc, dr] of ORTHO_OFFSETS) {
    const col = summoner.col + dc
    const row = summoner.row + dr
    if (col < 0 || col >= battle.cols || row < 0 || row >= battle.rows) continue
    const cell = battle.cells[row]?.[col]
    if (!cell || !cell.walkable || !terrainWalkable(cell.terrain)) continue

    let occupied = false
    for (const u of battle.units) {
      if ((u.alive || isUnitDowned(u)) && u.col === col && u.row === row) {
        occupied = true
        break
      }
    }
    if (occupied) continue

    let score = 100
    if (cell.terrain === 'lava_geyser' && cell.geyserActive) score -= 50
    if (target) {
      score -= manhattanDist(col, row, target.col, target.row) * 8
    }
    if (score > bestScore) {
      bestScore = score
      best = { col, row }
    }
  }

  return best
}

/** Generate a deterministic unique UID for a newly summoned enemy unit. */
export function generateSummonUid(
  battle: Pick<BattleState, 'units'>,
  summonerUid: string,
  archetype: EnemyArchetypeId
): string {
  for (let seq = 1; seq <= 256; seq++) {
    const candidate = `summon_${summonerUid}_${archetype}_${seq}`
    let exists = false
    for (const u of battle.units) {
      if (u.uid === candidate) {
        exists = true
        break
      }
    }
    if (!exists) return candidate
  }
  return `summon_${summonerUid}_${archetype}_${battle.units.length + 1}`
}

/** Construct a ready-to-deploy summoned BattleUnit at `(col, row)` owned by `summoner`. */
export function createSummonedEnemyUnit(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units' | 'difficulty' | 'endlessWave'> &
    Partial<Pick<BattleState, 'difficultyTier' | 'mutators'>>,
  summoner: Pick<BattleUnit, 'uid' | 'level' | 'facing'>,
  archetype: EnemyArchetypeId,
  col: number,
  row: number
): BattleUnit {
  const spec = ENEMY_SPECS[archetype]
  const waveScale = battle.endlessWave > 0 ? 1 + battle.endlessWave * 0.20 : 1
  const diffScale = 1 + Math.max(0, battle.difficulty - 2) * 0.08
  const scale = waveScale * diffScale
  const cell = battle.cells[row][col]
  const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  const baseMaxHp = Math.max(12, Math.round(spec.maxHp * scale))
  const baseAtk = Math.max(6, Math.round(spec.atk * scale))
  const baseDef = Math.max(0, Math.round(spec.def * (1 + (scale - 1) * 0.5)))
  const scaled = computeScaledEnemyStats(
    { maxHp: baseMaxHp, atk: baseAtk, def: baseDef, speed: spec.speed },
    battle.difficultyTier ?? 'normal',
    battle.mutators ?? []
  )

  return {
    uid: generateSummonUid(battle, summoner.uid, archetype),
    team: 'enemy',
    name: spec.name,
    enemyId: archetype,
    stars: 1,
    level: Math.max(1, summoner.level - 1),
    isBoss: false,
    summonerUid: summoner.uid,
    col,
    row,
    x: wx,
    y: wy,
    z: wz,
    yaw: facingToYaw(summoner.facing),
    facing: summoner.facing,
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
    crit: 0.06,
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
  }
}

/**
 * Determine whether an enemy should execute its signature special move instead of a basic attack.
 */
export function chooseEnemySpecialMove(
  battle: Pick<BattleState, 'turn'>,
  enemy: Pick<BattleUnit, 'enemyId' | 'isBoss' | 'cooldowns'>
): EnemySpecialDecision | null {
  const eid = enemy.enemyId

  if (eid === 'ember_pyromancer' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'cinder_nova',
      vfxMove: 'fire_nova',
      cooldownTurns: PYROMANCER_NOVA_COOLDOWN,
      pattern: 'cross',
      powerMul: 1.15,
      ignoreArmor: 0.40,
      status: 'burn',
      element: 'fire',
      label: 'CINDER NOVA!'
    }
  }

  if (eid === 'river_troll' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'tidal_slam',
      vfxMove: 'titan_slam',
      cooldownTurns: RIVER_TROLL_SLAM_COOLDOWN,
      pattern: 'single',
      powerMul: 1.25,
      ignoreArmor: 0.20,
      knockbackDistance: 1,
      label: 'TIDAL SLAM!'
    }
  }

  if (eid === 'briar_warlord' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'warlord_slam',
      vfxMove: 'titan_slam',
      cooldownTurns: MINIBOSS_SPECIAL_COOLDOWN,
      pattern: 'cross',
      powerMul: 1.25,
      ignoreArmor: 0.25,
      knockbackDistance: 1,
      label: 'BRIAR CLEAVE!'
    }
  }

  if (eid === 'mire_matriarch' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'mire_miasma',
      vfxMove: 'eclipse_nova',
      cooldownTurns: MINIBOSS_SPECIAL_COOLDOWN,
      pattern: 'cross',
      powerMul: 1.10,
      ignoreArmor: 0.35,
      status: 'poison',
      statusStacks: 2,
      element: 'poison',
      label: 'MIRE MIASMA!'
    }
  }

  if (eid === 'ash_inquisitor' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'ash_nova',
      vfxMove: 'eclipse_nova',
      cooldownTurns: MINIBOSS_SPECIAL_COOLDOWN,
      pattern: 'cross',
      powerMul: 1.15,
      ignoreArmor: 0.40,
      status: 'burn',
      element: 'fire',
      label: 'ASHEN VERDICT!'
    }
  }

  if (eid === 'frost_jarl' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'frost_breath',
      vfxMove: 'frostwyrm_breath',
      cooldownTurns: MINIBOSS_SPECIAL_COOLDOWN,
      pattern: 'cross',
      powerMul: 1.20,
      ignoreArmor: 0.35,
      status: 'slow',
      element: 'frost',
      label: 'GLACIAL GALE!'
    }
  }

  if (eid === 'magma_warden' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'magma_slam',
      vfxMove: 'titan_slam',
      cooldownTurns: MINIBOSS_SPECIAL_COOLDOWN,
      pattern: 'cross',
      powerMul: 1.25,
      ignoreArmor: 0.35,
      status: 'burn',
      element: 'fire',
      knockbackDistance: 1,
      label: 'MAGMA SLAM!'
    }
  }

  if (eid === 'ignis_titan' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'cataclysm_slam',
      vfxMove: 'titan_slam',
      cooldownTurns: MINIBOSS_SPECIAL_COOLDOWN,
      pattern: 'cross',
      powerMul: 1.30,
      ignoreArmor: 0.35,
      status: 'burn',
      element: 'fire',
      knockbackDistance: 1,
      ignitesGeysers: true,
      label: 'CATACLYSM SLAM!'
    }
  }

  if (eid === 'abyssal_sentinel' && enemy.cooldowns[0] <= 0) {
    return {
      move: 'abyssal_cleave',
      vfxMove: 'eclipse_nova',
      cooldownTurns: 3,
      pattern: 'cross',
      powerMul: 1.20,
      ignoreArmor: 0.30,
      status: 'slow',
      label: 'ABYSSAL CLEAVE!'
    }
  }

  // Final boss Archon Malakor keeps classic even-turn Eclipse Nova cadence
  if (enemy.isBoss && eid === 'eclipse_archon' && battle.turn % 2 === 0) {
    return {
      move: 'eclipse_nova',
      vfxMove: 'eclipse_nova',
      cooldownTurns: 0,
      pattern: 'cross',
      powerMul: 1.15,
      ignoreArmor: 0.35,
      status: 'burn',
      element: 'fire',
      label: 'ECLIPSE NOVA!'
    }
  }

  return null
}
