import type {
  BattleState,
  BattleUnit,
  CampaignState,
  DifficultyLevel,
  Rarity,
  StageDifficultyTier,
  StageMutatorId
} from './types.ts'

export const STAGE_DIFFICULTY_TIERS: readonly StageDifficultyTier[] = ['normal', 'veteran', 'mythic']

export const STAGE_MUTATOR_IDS: readonly StageMutatorId[] = [
  'blood_moon',
  'arcane_surge',
  'fog_of_war',
  'iron_vanguard',
  'venom_mist'
]

export const BLOOD_MOON_DAMAGE_MUL = 1.25
export const BLOOD_MOON_MELEE_DRAIN = 0.15
export const ARCANE_SURGE_START_AP_BONUS = 1
export const ARCANE_SURGE_MAX_AP_BONUS = 1
export const ARCANE_SURGE_EXTRA_CD_TICK = 1
export const FOG_OF_WAR_VISION_RADIUS = 4
export const IRON_VANGUARD_SHIELD_RATIO = 0.25
export const IRON_VANGUARD_DEF_BONUS = 1
export const VENOM_MIST_POISON_STACKS = 1

export interface StageTierSpec {
  readonly id: StageDifficultyTier
  readonly label: string
  readonly shortLabel: string
  readonly subtitle: string
  readonly rank: 0 | 1 | 2
  readonly hpMul: number
  readonly atkMul: number
  readonly defBonus: number
  readonly speedBonus: number
  readonly recommendedPowerMul: number
  readonly goldBonusPct: number
  readonly bonusDust: number
  readonly bonusShards: number
  readonly minDropRarity: Rarity
  readonly dropTierLabel: string
  readonly accentHex: string
}

export interface StageMutatorSpec {
  readonly id: StageMutatorId
  readonly label: string
  readonly shortLabel: string
  readonly desc: string
  readonly goldBonusPct: number
  readonly dropBonus: number
  readonly bonusDust: number
  readonly bonusShards: number
  readonly accentHex: string
}

export interface ScaledEnemyStats {
  readonly maxHp: number
  readonly atk: number
  readonly def: number
  readonly speed: number
  readonly shield: number
}

export interface ResolvedStageChallenge {
  readonly tier: StageDifficultyTier
  readonly mutators: readonly StageMutatorId[]
  readonly eligible: boolean
}

export interface ChallengeRewardSummary {
  readonly tier: StageDifficultyTier
  readonly mutators: readonly StageMutatorId[]
  readonly goldBonusPct: number
  readonly goldMultiplier: number
  readonly replayGold: number
  readonly bonusDust: number
  readonly bonusShards: number
  readonly dropWeights: Record<Rarity, number>
  readonly minDropRarity: Rarity
  readonly dropTierLabel: string
}

export const STAGE_TIER_SPECS: Readonly<Record<StageDifficultyTier, StageTierSpec>> = {
  normal: {
    id: 'normal',
    label: 'Normal',
    shortLabel: 'NRM',
    subtitle: 'Standard',
    rank: 0,
    hpMul: 1.0,
    atkMul: 1.0,
    defBonus: 0,
    speedBonus: 0,
    recommendedPowerMul: 1.0,
    goldBonusPct: 0,
    bonusDust: 0,
    bonusShards: 0,
    minDropRarity: 'common',
    dropTierLabel: 'Standard Drop',
    accentHex: '#8fd4ff'
  },
  veteran: {
    id: 'veteran',
    label: 'Veteran',
    shortLabel: 'VET',
    subtitle: 'Heroic',
    rank: 1,
    hpMul: 1.30,
    atkMul: 1.20,
    defBonus: 2,
    speedBonus: 1,
    recommendedPowerMul: 1.32,
    goldBonusPct: 60,
    bonusDust: 12,
    bonusShards: 4,
    minDropRarity: 'uncommon',
    dropTierLabel: 'Heroic (Rare+)',
    accentHex: '#ffb84d'
  },
  mythic: {
    id: 'mythic',
    label: 'Mythic',
    shortLabel: 'MYT',
    subtitle: 'Mythic',
    rank: 2,
    hpMul: 1.65,
    atkMul: 1.38,
    defBonus: 4,
    speedBonus: 2,
    recommendedPowerMul: 1.72,
    goldBonusPct: 135,
    bonusDust: 28,
    bonusShards: 10,
    minDropRarity: 'rare',
    dropTierLabel: 'Mythic (Epic+)',
    accentHex: '#d97aff'
  }
}

export const STAGE_MUTATOR_SPECS: Readonly<Record<StageMutatorId, StageMutatorSpec>> = {
  blood_moon: {
    id: 'blood_moon',
    label: 'Blood Moon',
    shortLabel: 'BLOOD',
    desc: 'All units deal +25% damage; melee attacks drain 15% HP.',
    goldBonusPct: 25,
    dropBonus: 1.0,
    bonusDust: 4,
    bonusShards: 1,
    accentHex: '#ff5e78'
  },
  arcane_surge: {
    id: 'arcane_surge',
    label: 'Arcane Surge',
    shortLabel: 'ARCANE',
    desc: 'Start with +1 AP & +1 Max AP; skill cooldowns tick faster for both sides.',
    goldBonusPct: 20,
    dropBonus: 1.0,
    bonusDust: 4,
    bonusShards: 1,
    accentHex: '#63d7ff'
  },
  fog_of_war: {
    id: 'fog_of_war',
    label: 'Fog of War',
    shortLabel: 'FOG',
    desc: 'Enemies outside distance 4 of any living ally are shrouded until spotted.',
    goldBonusPct: 30,
    dropBonus: 1.5,
    bonusDust: 6,
    bonusShards: 2,
    accentHex: '#9c8cff'
  },
  iron_vanguard: {
    id: 'iron_vanguard',
    label: 'Iron Vanguard',
    shortLabel: 'IRON',
    desc: 'Enemies begin battle with a 25% Max HP Fortified Shield and +1 DEF.',
    goldBonusPct: 25,
    dropBonus: 1.0,
    bonusDust: 5,
    bonusShards: 1,
    accentHex: '#9eb6d4'
  },
  venom_mist: {
    id: 'venom_mist',
    label: 'Venom Mist',
    shortLabel: 'VENOM',
    desc: 'At every round boundary, units off Sanctuary Shrines suffer +1 Poison stack.',
    goldBonusPct: 25,
    dropBonus: 1.0,
    bonusDust: 5,
    bonusShards: 1,
    accentHex: '#8dff4f'
  }
}

export function isStageDifficultyTier(raw: unknown): raw is StageDifficultyTier {
  return raw === 'normal' || raw === 'veteran' || raw === 'mythic'
}

export function isStageMutatorId(raw: unknown): raw is StageMutatorId {
  return (
    raw === 'blood_moon' ||
    raw === 'arcane_surge' ||
    raw === 'fog_of_war' ||
    raw === 'iron_vanguard' ||
    raw === 'venom_mist'
  )
}

export function normalizeStageDifficultyTier(raw: unknown): StageDifficultyTier {
  return isStageDifficultyTier(raw) ? raw : 'normal'
}

export function normalizeStageMutators(raw: readonly unknown[] | undefined | null): StageMutatorId[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const seen = new Set<StageMutatorId>()
  const out: StageMutatorId[] = []
  for (const item of raw) {
    if (isStageMutatorId(item) && !seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  // Canonical order for deterministic serialization & UI display
  out.sort((a, b) => STAGE_MUTATOR_IDS.indexOf(a) - STAGE_MUTATOR_IDS.indexOf(b))
  return out
}

export function stageTierRank(tier: StageDifficultyTier): number {
  return STAGE_TIER_SPECS[tier].rank
}

export function getStageTierSpec(tier: StageDifficultyTier): StageTierSpec {
  return STAGE_TIER_SPECS[tier]
}

export function getStageMutatorSpec(id: StageMutatorId): StageMutatorSpec {
  return STAGE_MUTATOR_SPECS[id]
}

/**
 * Resolve requested difficulty tier & mutators against stage eligibility.
 * Uncleared stages and Endless waves always clamp to `'normal'` with no mutators.
 */
export function resolveStageChallenge(
  campaign: Pick<CampaignState, 'clearedStageIds'>,
  stageId: string,
  requestedTier?: StageDifficultyTier,
  requestedMutators?: readonly StageMutatorId[],
  endlessWave = 0
): ResolvedStageChallenge {
  const eligible = endlessWave === 0 && campaign.clearedStageIds.includes(stageId)
  if (!eligible) {
    return { tier: 'normal', mutators: [], eligible: false }
  }
  const tier = normalizeStageDifficultyTier(requestedTier)
  const mutators = normalizeStageMutators(requestedMutators)
  return { tier, mutators, eligible: true }
}

function extractMutatorList(
  battleOrMutators: Partial<Pick<BattleState, 'mutators'>> | readonly StageMutatorId[] | null | undefined
): readonly StageMutatorId[] | undefined {
  if (!battleOrMutators) return undefined
  if ('mutators' in battleOrMutators) return battleOrMutators.mutators
  return Array.isArray(battleOrMutators) ? battleOrMutators : undefined
}

/** Check whether a battle or mutator list has a specific mutator active. */
export function hasMutator(
  battleOrMutators: Partial<Pick<BattleState, 'mutators'>> | readonly StageMutatorId[] | null | undefined,
  id: StageMutatorId
): boolean {
  const list = extractMutatorList(battleOrMutators)
  if (!Array.isArray(list) || list.length === 0) return false
  return list.includes(id)
}

/** Fortified starting shield granted to enemies by the `iron_vanguard` mutator. */
export function computeIronVanguardShield(maxHp: number): number {
  return Math.max(1, Math.round(Math.max(1, maxHp) * IRON_VANGUARD_SHIELD_RATIO))
}

/**
 * Pure deterministic enemy stat scaling for StageDifficultyTier + Iron Vanguard mutator.
 * Normal tier with no mutators returns exact unchanged base stats.
 */
export function computeScaledEnemyStats(
  base: {
    readonly maxHp: number
    readonly atk: number
    readonly def: number
    readonly speed: number
    readonly baseShield?: number
  },
  tier: StageDifficultyTier,
  mutators: readonly StageMutatorId[] = []
): ScaledEnemyStats {
  const spec = STAGE_TIER_SPECS[tier]
  const ironVanguard = hasMutator(mutators, 'iron_vanguard')
  const baseShield = base.baseShield ?? 0

  const maxHp = tier === 'normal'
    ? Math.max(1, Math.round(base.maxHp))
    : Math.max(1, Math.round(base.maxHp * spec.hpMul))
  const atk = tier === 'normal'
    ? Math.max(1, Math.round(base.atk))
    : Math.max(1, Math.round(base.atk * spec.atkMul))
  const def = Math.max(0, Math.round(base.def) + spec.defBonus + (ironVanguard ? IRON_VANGUARD_DEF_BONUS : 0))
  const speed = Math.max(1, Math.round(base.speed) + spec.speedBonus)
  const shield = baseShield + (ironVanguard ? computeIronVanguardShield(maxHp) : 0)

  return { maxHp, atk, def, speed, shield }
}

/** Damage multiplier granted by active mutators (`blood_moon`: 1.25×, otherwise 1.0×). */
export function mutatorDamageMultiplier(
  battleOrMutators: Partial<Pick<BattleState, 'mutators'>> | readonly StageMutatorId[] | null | undefined
): number {
  return hasMutator(battleOrMutators, 'blood_moon') ? BLOOD_MOON_DAMAGE_MUL : 1.0
}

/** Bonus melee HP drain ratio granted by `blood_moon` (`0.15` for melee hits, `0` otherwise). */
export function mutatorMeleeDrainBonus(
  battleOrMutators: Partial<Pick<BattleState, 'mutators'>> | readonly StageMutatorId[] | null | undefined,
  isMelee: boolean
): number {
  if (!isMelee) return 0
  return hasMutator(battleOrMutators, 'blood_moon') ? BLOOD_MOON_MELEE_DRAIN : 0
}

/** Starting AP and Max AP adjustments from `arcane_surge`. */
export function arcaneSurgeApBonuses(
  mutators: readonly StageMutatorId[] | null | undefined
): { readonly startApBonus: number; readonly maxApBonus: number } {
  if (!hasMutator(mutators, 'arcane_surge')) {
    return { startApBonus: 0, maxApBonus: 0 }
  }
  return { startApBonus: ARCANE_SURGE_START_AP_BONUS, maxApBonus: ARCANE_SURGE_MAX_AP_BONUS }
}

/** How many turns a unit's skill cooldowns tick down at the start of its turn (`2` under Arcane Surge, else `1`). */
export function cooldownTickStep(
  battleOrMutators: Partial<Pick<BattleState, 'mutators'>> | readonly StageMutatorId[] | null | undefined
): number {
  return hasMutator(battleOrMutators, 'arcane_surge') ? 1 + ARCANE_SURGE_EXTRA_CD_TICK : 1
}

/** True if tile `(col, row)` is revealed to the player under `fog_of_war` (or if Fog of War is inactive). */
export function isTileRevealedInFog(
  battle: Pick<BattleState, 'units'> & Partial<Pick<BattleState, 'mutators'>>,
  col: number,
  row: number
): boolean {
  if (!hasMutator(battle.mutators, 'fog_of_war')) return true
  for (const u of battle.units) {
    if (!u.alive || u.team !== 'ally') continue
    if (Math.abs(u.col - col) + Math.abs(u.row - row) <= FOG_OF_WAR_VISION_RADIUS) {
      return true
    }
  }
  return false
}

/** True if a unit is currently visible/spotted by the player. Allies are always visible. */
export function isUnitVisibleToPlayer(
  battle: Pick<BattleState, 'units'> & Partial<Pick<BattleState, 'mutators'>>,
  unit: Pick<BattleUnit, 'team' | 'col' | 'row' | 'alive'> & Partial<Pick<BattleUnit, 'footprintSize'>>
): boolean {
  if (unit.team === 'ally') return true
  if (!hasMutator(battle.mutators, 'fog_of_war')) return true
  const size = unit.footprintSize === 2 ? 2 : 1
  for (let dr = 0; dr < size; dr++) {
    for (let dc = 0; dc < size; dc++) {
      if (isTileRevealedInFog(battle, unit.col + dc, unit.row + dr)) return true
    }
  }
  return false
}

/** True if a living enemy is currently shrouded in `fog_of_war` and hidden from direct targeting. */
export function isEnemyShrouded(
  battle: Pick<BattleState, 'units'> & Partial<Pick<BattleState, 'mutators'>>,
  unit: Pick<BattleUnit, 'team' | 'col' | 'row' | 'alive'> & Partial<Pick<BattleUnit, 'footprintSize'>>
): boolean {
  return unit.team === 'enemy' && unit.alive && !isUnitVisibleToPlayer(battle, unit)
}

/** Base repeatable drop rarity weights for a stage difficulty (matches Normal tier with 0 mutators). */
export function baseReplayWeightsForDifficulty(diff: DifficultyLevel): Record<Rarity, number> {
  if (diff === 1) return { common: 84, uncommon: 15, rare: 1, epic: 0, legendary: 0 }
  if (diff === 2) return { common: 72, uncommon: 24, rare: 4, epic: 0, legendary: 0 }
  if (diff === 3) return { common: 58, uncommon: 32, rare: 9.5, epic: 0.5, legendary: 0 }
  if (diff === 4) return { common: 46, uncommon: 36, rare: 16.5, epic: 1.5, legendary: 0 }
  return { common: 36, uncommon: 38, rare: 22.5, epic: 3.2, legendary: 0.3 }
}

/**
 * Compute live replay gold, bonus Dust/Shards, upgraded drop rarity weights, and display labels
 * for any combination of StageDifficultyTier + StageMutatorIds.
 */
export function computeChallengeRewards(
  baseReplayGold: number,
  stageDifficulty: DifficultyLevel,
  tier: StageDifficultyTier,
  mutators: readonly StageMutatorId[] = []
): ChallengeRewardSummary {
  const normTier = normalizeStageDifficultyTier(tier)
  const normMutators = normalizeStageMutators(mutators)
  const tierSpec = STAGE_TIER_SPECS[normTier]

  let goldBonusPct = tierSpec.goldBonusPct
  let bonusDust = tierSpec.bonusDust
  let bonusShards = tierSpec.bonusShards
  let mutatorDropBonus = 0
  for (const mId of normMutators) {
    const mSpec = STAGE_MUTATOR_SPECS[mId]
    goldBonusPct += mSpec.goldBonusPct
    bonusDust += mSpec.bonusDust
    bonusShards += mSpec.bonusShards
    mutatorDropBonus += mSpec.dropBonus
  }

  const goldMultiplier = 1 + goldBonusPct / 100
  const replayGold = Math.round(baseReplayGold * goldMultiplier)

  const base = baseReplayWeightsForDifficulty(stageDifficulty)
  let dropWeights: Record<Rarity, number>
  let minDropRarity: Rarity = tierSpec.minDropRarity
  let dropTierLabel: string

  if (normTier === 'mythic') {
    dropWeights = {
      common: 0,
      uncommon: Math.round(base.uncommon * 0.35 * 10) / 10,
      rare: Math.round((Math.max(30, base.rare * 1.8 + 16) + mutatorDropBonus * 3.5) * 10) / 10,
      epic: Math.round((Math.max(20, base.epic * 3.5 + 16) + mutatorDropBonus * 3.5) * 10) / 10,
      legendary: Math.round((Math.max(6, base.legendary * 4 + 5) + mutatorDropBonus * 1.2) * 10) / 10
    }
    minDropRarity = 'rare'
    dropTierLabel = normMutators.length > 0 ? 'Mythic+ (Epic/Leg)' : 'Mythic (Rare–Leg)'
  } else if (normTier === 'veteran') {
    dropWeights = {
      common: Math.max(0, Math.round((base.common * 0.35 - mutatorDropBonus * 4) * 10) / 10),
      uncommon: Math.round((base.uncommon + 6) * 10) / 10,
      rare: Math.round((Math.max(22, base.rare * 1.7 + 12) + mutatorDropBonus * 3.5) * 10) / 10,
      epic: Math.round((Math.max(8, base.epic * 2.5 + 7) + mutatorDropBonus * 2.5) * 10) / 10,
      legendary: Math.round((Math.max(1, base.legendary * 2 + 1) + mutatorDropBonus * 0.5) * 10) / 10
    }
    minDropRarity = 'uncommon'
    dropTierLabel = normMutators.length > 0 ? 'Heroic+ (Rare/Epic)' : 'Heroic (Unc–Epic)'
  } else if (normMutators.length > 0) {
    dropWeights = {
      common: Math.max(10, Math.round((base.common - mutatorDropBonus * 6) * 10) / 10),
      uncommon: base.uncommon,
      rare: Math.round((base.rare + mutatorDropBonus * 4) * 10) / 10,
      epic: Math.round((base.epic + mutatorDropBonus * 2) * 10) / 10,
      legendary: Math.round((base.legendary + mutatorDropBonus * 0.4) * 10) / 10
    }
    minDropRarity = 'common'
    dropTierLabel = 'Boosted Drop'
  } else {
    dropWeights = { ...base }
    minDropRarity = 'common'
    dropTierLabel = stageDifficulty <= 2
      ? 'Com/Unc Drop'
      : stageDifficulty === 3 ? 'Up to Rare' : 'Rare/Slim Epic'
  }

  return {
    tier: normTier,
    mutators: normMutators,
    goldBonusPct,
    goldMultiplier,
    replayGold,
    bonusDust,
    bonusShards,
    dropWeights,
    minDropRarity,
    dropTierLabel
  }
}

/** Return the highest cleared difficulty tier for a stage, or `null` if the stage has never been cleared. */
export function getHighestClearedStageTier(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'clearedStageTiers'>,
  stageId: string
): StageDifficultyTier | null {
  if (!campaign.clearedStageIds.includes(stageId)) return null
  const recorded = campaign.clearedStageTiers?.[stageId]
  return isStageDifficultyTier(recorded) ? recorded : 'normal'
}

/** Record a stage clear at `tier`, preserving the highest tier ever achieved for that stage. */
export function recordClearedStageTier(
  campaign: Pick<CampaignState, 'clearedStageTiers'>,
  stageId: string,
  tier: StageDifficultyTier
): StageDifficultyTier {
  const norm = normalizeStageDifficultyTier(tier)
  if (!campaign.clearedStageTiers) {
    campaign.clearedStageTiers = {}
  }
  const existing = campaign.clearedStageTiers[stageId]
  if (!existing || stageTierRank(norm) > stageTierRank(existing)) {
    campaign.clearedStageTiers[stageId] = norm
  }
  return campaign.clearedStageTiers[stageId]
}

/** Sanitize persisted `clearedStageTiers` map against valid cleared stage IDs (legacy-save safe). */
export function sanitizeClearedStageTiers(
  raw: unknown,
  validClearedStageIds: readonly string[]
): Record<string, StageDifficultyTier> {
  const out: Record<string, StageDifficultyTier> = {}
  if (typeof raw !== 'object' || raw === null) return out
  const clearedSet = new Set(validClearedStageIds)
  for (const [stageId, val] of Object.entries(raw)) {
    if (clearedSet.has(stageId) && isStageDifficultyTier(val)) {
      out[stageId] = val
    }
  }
  return out
}
