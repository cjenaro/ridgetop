import { cellHeightLevel, isUnitDowned, terrainWalkable } from './types.ts'
import type {
  BattleState,
  BattleUnit,
  BiomeId,
  EnemyArchetypeId,
  GridCoord,
  StatusKind
} from './types.ts'

/**
 * Pure Outer Frontier expansion rules for Sunbleached Dunes, Aether Isles & Shattered Expanse.
 * Covers frontier biome round-boundary hazards (Sandstorm Gusts, Lightning Conduits, Astral Rift Pulses)
 * and Tier VIII Apex multi-phase raid boss transitions (The Unbroken Crown Phase 1 -> Phase 2).
 * Zero browser globals and Godot-compiler-compatible.
 */

export const FRONTIER_BIOMES: readonly BiomeId[] = ['dunes', 'aether', 'expanse']

export const FRONTIER_BOSS_IDS: readonly EnemyArchetypeId[] = [
  'dune_sovereign_boss',
  'astral_warden_boss',
  'unbroken_crown_boss'
]

export const FRONTIER_STAGE_IDS: readonly string[] = [
  'mirage_oasis',
  'sunken_obelisk',
  'dune_sovereign',
  'tempest_spire',
  'skybreak_bastion',
  'obsidian_rift',
  'first_sun_sanctum'
]

export const SANDSTORM_GUST_PERIOD = 2
export const SANDSTORM_GUST_DAMAGE = 6
export const LIGHTNING_CONDUIT_PERIOD = 2
export const LIGHTNING_CONDUIT_DAMAGE = 10
export const ASTRAL_RIFT_PERIOD = 3
export const ASTRAL_RIFT_DAMAGE = 8

export const UNBROKEN_CROWN_PHASE2_HP_RATIO = 0.5
export const UNBROKEN_CROWN_PHASE2_SHIELD = 60
export const UNBROKEN_CROWN_PHASE2_ATK_BONUS = 5
export const UNBROKEN_CROWN_PHASE2_EMPOWER_TURNS = 2
export const UNBROKEN_CROWN_PHASE2_HASTE_TURNS = 2
export const UNBROKEN_CROWN_PHASE2_SUMMON_COUNT = 2
export const UNBROKEN_CROWN_PHASE2_BANNER = 'SOLAR ECLIPSE AWAKENING!'

export type FrontierHazardKind = 'none' | 'sandstorm' | 'lightning_conduit' | 'astral_rift'

export interface FrontierHazardStrike {
  readonly unitUid: string
  readonly col: number
  readonly row: number
  readonly damage: number
  readonly status?: StatusKind
  readonly label: string
  readonly vfxStyle: 'fire' | 'arcane' | 'shadow'
}

export interface FrontierRoundHazardResult {
  readonly triggered: boolean
  readonly kind: FrontierHazardKind
  readonly label: string
  readonly bannerText: string
  readonly strikes: readonly FrontierHazardStrike[]
}

export interface FrontierBossPhaseConfig {
  readonly phase: number
  readonly bannerText: string
  readonly shieldGain: number
  readonly atkBonus: number
  readonly empowerTurns: number
  readonly hasteTurns: number
  readonly summonArchetype: EnemyArchetypeId
  readonly summonCount: number
}

export interface FrontierBossPhaseResult {
  readonly triggered: boolean
  readonly newPhase: number
  readonly shieldGain: number
  readonly atkBonus: number
  readonly bannerText: string
}

const ORTHO_DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
]

const RING2_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [0, -2],
  [2, 0],
  [0, 2],
  [-2, 0]
]

/** True when `biome` is one of the three Outer Frontier expansion biomes. */
export function isFrontierBiome(biome: BiomeId): boolean {
  return biome === 'dunes' || biome === 'aether' || biome === 'expanse'
}

/** True when `enemyId` is one of the three Outer Frontier Raid Bosses. */
export function isFrontierBoss(enemyId?: EnemyArchetypeId): boolean {
  return (
    enemyId === 'dune_sovereign_boss' ||
    enemyId === 'astral_warden_boss' ||
    enemyId === 'unbroken_crown_boss'
  )
}

/** Resolve the signature round-boundary hazard active for a frontier biome. */
export function getFrontierHazardKind(biome: BiomeId): FrontierHazardKind {
  if (biome === 'dunes') return 'sandstorm'
  if (biome === 'aether') return 'lightning_conduit'
  if (biome === 'expanse') return 'astral_rift'
  return 'none'
}

function hasAdjacentTerrain(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  col: number,
  row: number,
  terrain: string
): boolean {
  for (const [dc, dr] of ORTHO_DIRS) {
    const nc = col + dc
    const nr = row + dr
    if (nc < 0 || nc >= battle.cols || nr < 0 || nr >= battle.rows) continue
    const neighbor = battle.cells[nr]?.[nc]
    if (neighbor && neighbor.terrain === terrain) return true
  }
  return false
}

/**
 * Sunbleached Dunes sandstorm gust rhythm: every `SANDSTORM_GUST_PERIOD` rounds,
 * shifting gusts scour units standing on exposed dunes (`heightLevel >= 1` or `hill`/`bridge`)
 * unless sheltered on a `shrine` or orthogonally beside a sandstone `pillar`.
 */
export function computeSandstormGustStrikes(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units' | 'biome'>,
  round: number
): FrontierHazardStrike[] {
  if (battle.biome !== 'dunes') return []
  if (round <= 0 || round % SANDSTORM_GUST_PERIOD !== 0) return []

  const strikes: FrontierHazardStrike[] = []
  for (const u of battle.units) {
    if (!u.alive) continue
    if (u.enemyId === 'dune_sovereign_boss') continue
    const cell = battle.cells[u.row]?.[u.col]
    if (!cell || cell.terrain === 'shrine') continue
    if (hasAdjacentTerrain(battle, u.col, u.row, 'pillar') || hasAdjacentTerrain(battle, u.col, u.row, 'cracked_pillar')) continue
    const h = cellHeightLevel(cell)
    const exposed = h >= 1 || cell.terrain === 'hill' || cell.terrain === 'bridge'
    if (!exposed) continue
    strikes.push({
      unitUid: u.uid,
      col: u.col,
      row: u.row,
      damage: SANDSTORM_GUST_DAMAGE,
      status: 'slow',
      label: 'SANDSTORM GUST',
      vfxStyle: 'fire'
    })
  }
  return strikes
}

/**
 * Aether Isles lightning conduit discharge: every `LIGHTNING_CONDUIT_PERIOD` rounds,
 * storm pylons (`pillar`) and exposed upper sky-terraces (`heightLevel >= 3` or `bridge` over void)
 * arc crackling lightning onto nearby units (shrines ground the current safely).
 */
export function computeLightningConduitStrikes(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units' | 'biome'>,
  round: number
): FrontierHazardStrike[] {
  if (battle.biome !== 'aether') return []
  if (round <= 0 || round % LIGHTNING_CONDUIT_PERIOD !== 0) return []

  const strikes: FrontierHazardStrike[] = []
  for (const u of battle.units) {
    if (!u.alive) continue
    if (u.enemyId === 'astral_warden_boss') continue
    const cell = battle.cells[u.row]?.[u.col]
    if (!cell || cell.terrain === 'shrine') continue
    const nearConduit = hasAdjacentTerrain(battle, u.col, u.row, 'pillar') || hasAdjacentTerrain(battle, u.col, u.row, 'cracked_pillar')
    const highSpire = cellHeightLevel(cell) >= 3
    const onSkyBridge = cell.terrain === 'bridge' && hasAdjacentTerrain(battle, u.col, u.row, 'void')
    if (!nearConduit && !highSpire && !onSkyBridge) continue
    strikes.push({
      unitUid: u.uid,
      col: u.col,
      row: u.row,
      damage: LIGHTNING_CONDUIT_DAMAGE,
      label: 'LIGHTNING CONDUIT',
      vfxStyle: 'arcane'
    })
  }
  return strikes
}

/**
 * Shattered Expanse astral rift pulse: every `ASTRAL_RIFT_PERIOD` rounds,
 * cosmic energy flares along void-edge ledges (`void`-adjacent non-shrine tiles).
 */
export function computeAstralRiftStrikes(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units' | 'biome'>,
  round: number
): FrontierHazardStrike[] {
  if (battle.biome !== 'expanse') return []
  if (round <= 0 || round % ASTRAL_RIFT_PERIOD !== 0) return []

  const strikes: FrontierHazardStrike[] = []
  for (const u of battle.units) {
    if (!u.alive) continue
    if (u.enemyId === 'unbroken_crown_boss') continue
    const cell = battle.cells[u.row]?.[u.col]
    if (!cell || cell.terrain === 'shrine') continue
    if (!hasAdjacentTerrain(battle, u.col, u.row, 'void')) continue
    strikes.push({
      unitUid: u.uid,
      col: u.col,
      row: u.row,
      damage: ASTRAL_RIFT_DAMAGE,
      status: 'burn',
      label: 'ASTRAL RIFT PULSE',
      vfxStyle: 'shadow'
    })
  }
  return strikes
}

/**
 * Evaluate whether a frontier biome round-boundary hazard triggers on `round` and collect targets.
 */
export function evaluateFrontierRoundHazard(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units' | 'biome'>,
  round: number
): FrontierRoundHazardResult {
  const kind = getFrontierHazardKind(battle.biome)
  if (kind === 'sandstorm') {
    const strikes = computeSandstormGustStrikes(battle, round)
    const triggered = round > 0 && round % SANDSTORM_GUST_PERIOD === 0
    return {
      triggered,
      kind,
      label: 'Sandstorm Gust',
      bannerText: 'SANDSTORM GUST SWEEPS THE DUNES!',
      strikes
    }
  }
  if (kind === 'lightning_conduit') {
    const strikes = computeLightningConduitStrikes(battle, round)
    const triggered = round > 0 && round % LIGHTNING_CONDUIT_PERIOD === 0
    return {
      triggered,
      kind,
      label: 'Lightning Conduit',
      bannerText: 'LIGHTNING CONDUIT DISCHARGE!',
      strikes
    }
  }
  if (kind === 'astral_rift') {
    const strikes = computeAstralRiftStrikes(battle, round)
    const triggered = round > 0 && round % ASTRAL_RIFT_PERIOD === 0
    return {
      triggered,
      kind,
      label: 'Astral Rift Pulse',
      bannerText: 'ASTRAL RIFT SURGE!',
      strikes
    }
  }
  return {
    triggered: false,
    kind: 'none',
    label: '',
    bannerText: '',
    strikes: []
  }
}

/** Return the canonical Phase 2 awakening configuration for The Unbroken Crown. */
export function getUnbrokenCrownPhase2Config(): FrontierBossPhaseConfig {
  return {
    phase: 2,
    bannerText: UNBROKEN_CROWN_PHASE2_BANNER,
    shieldGain: UNBROKEN_CROWN_PHASE2_SHIELD,
    atkBonus: UNBROKEN_CROWN_PHASE2_ATK_BONUS,
    empowerTurns: UNBROKEN_CROWN_PHASE2_EMPOWER_TURNS,
    hasteTurns: UNBROKEN_CROWN_PHASE2_HASTE_TURNS,
    summonArchetype: 'crypt_knight',
    summonCount: UNBROKEN_CROWN_PHASE2_SUMMON_COUNT
  }
}

/**
 * True when The Unbroken Crown is alive, still in Phase 1, and its HP has dropped to <= 50% maxHp.
 */
export function shouldTriggerUnbrokenCrownPhase2(
  unit: Pick<BattleUnit, 'alive' | 'enemyId' | 'hp' | 'maxHp' | 'bossPhase'>
): boolean {
  if (!unit.alive || unit.enemyId !== 'unbroken_crown_boss') return false
  const currentPhase = unit.bossPhase ?? 1
  if (currentPhase >= 2) return false
  const threshold = Math.floor(unit.maxHp * UNBROKEN_CROWN_PHASE2_HP_RATIO)
  return unit.hp <= threshold
}

/**
 * Apply the Phase 1 -> Phase 2 Solar Eclipse Awakening state transition directly to `unit`.
 * Idempotent: returns `{ triggered: false, ... }` once `bossPhase >= 2`.
 */
export function applyFrontierBossPhaseTransition(unit: BattleUnit): FrontierBossPhaseResult {
  if (!shouldTriggerUnbrokenCrownPhase2(unit)) {
    return {
      triggered: false,
      newPhase: unit.bossPhase ?? 1,
      shieldGain: 0,
      atkBonus: 0,
      bannerText: ''
    }
  }

  const cfg = getUnbrokenCrownPhase2Config()
  unit.bossPhase = cfg.phase
  unit.shield += cfg.shieldGain
  unit.atk += cfg.atkBonus
  unit.burnTurns = 0
  unit.slowTurns = 0
  unit.stunTurns = 0
  unit.poisonStacks = 0
  unit.empowerTurns = Math.max(unit.empowerTurns, cfg.empowerTurns)
  unit.hasteTurns = Math.max(unit.hasteTurns, cfg.hasteTurns)
  unit.cooldowns[0] = 0

  return {
    triggered: true,
    newPhase: cfg.phase,
    shieldGain: cfg.shieldGain,
    atkBonus: cfg.atkBonus,
    bannerText: cfg.bannerText
  }
}

/**
 * Find up to `count` walkable unoccupied tiles near `boss` for Phase 2 vanguard reinforcements.
 */
export function findFrontierSummonTiles(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  boss: Pick<BattleUnit, 'col' | 'row'>,
  count: number
): GridCoord[] {
  const chosen: GridCoord[] = []
  for (const [dc, dr] of RING2_OFFSETS) {
    if (chosen.length >= count) break
    const col = boss.col + dc
    const row = boss.row + dr
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
    chosen.push({ col, row })
  }
  return chosen
}
