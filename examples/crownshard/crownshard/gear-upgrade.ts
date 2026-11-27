import { EQUIPMENT_BY_ID, RARITY_META } from './data.ts'
import { getEquipSalvageDust } from './forge.ts'
import type { CampaignState, EquipmentSpec, GameState, OwnedEquipCard, Rarity } from './types.ts'

export const MAX_EQUIP_UPGRADE = 5

/** Multiplicative stat gain per temper level (+16% per level, with guaranteed flat minimums). */
export const EQUIP_UPGRADE_STAT_STEP = 0.16

/** Base Gold Reforge cost for each target level (+1 through +5) before rarity scaling. */
export const EQUIP_REFORGE_BASE_GOLD: readonly [number, number, number, number, number] = [
  45,
  85,
  140,
  220,
  340
]

/** Rarity cost multiplier for Gold Reforge and Duplicate Fusion. */
export const EQUIP_UPGRADE_RARITY_FACTOR: Readonly<Record<Rarity, number>> = {
  common: 1.0,
  uncommon: 1.25,
  rare: 1.6,
  epic: 2.1,
  legendary: 2.8
}

export interface UpgradedEquipStats {
  readonly atk: number
  readonly def: number
  readonly hp: number
  readonly speed: number
  readonly move: number
  readonly jump: number
  readonly range: number
  readonly crit: number
  readonly lifesteal: number
  readonly shieldStart: number
}

export interface EquipUpgradeCosts {
  readonly nextLevel: number
  readonly fuseGoldCost: number
  readonly reforgeGoldCost: number
}

export type EquipUpgradeStatKey = 'atk' | 'def' | 'hp' | 'shieldStart' | 'crit' | 'lifesteal'

export interface EquipUpgradeStatDelta {
  readonly key: EquipUpgradeStatKey
  readonly label: string
  readonly before: number
  readonly after: number
  readonly delta: number
  readonly isPercent: boolean
}

export interface EquipUpgradePreview {
  readonly equipUid: string
  readonly equipId: string
  readonly spec: EquipmentSpec
  readonly currentLevel: number
  readonly nextLevel: number
  readonly isMaxLevel: boolean
  readonly currentDisplayName: string
  readonly nextDisplayName: string
  readonly beforeStats: UpgradedEquipStats
  readonly afterStats: UpgradedEquipStats
  readonly statDeltas: readonly EquipUpgradeStatDelta[]
  readonly eligibleDuplicateCount: number
  readonly fuseDuplicateUid: string | null
  readonly fuseGoldCost: number
  readonly canFuseDuplicate: boolean
  readonly reforgeGoldCost: number
  readonly canGoldReforge: boolean
}

export interface EquipUpgradeResult {
  readonly equipUid: string
  readonly equipId: string
  readonly method: 'duplicate' | 'gold'
  readonly oldLevel: number
  readonly newLevel: number
  readonly goldSpent: number
  readonly consumedDuplicateUid: string | null
  readonly displayName: string
}

/** Clamp and sanitize an arbitrary upgrade level value into the valid integer range `0..5`. */
export function normalizeEquipUpgradeLevel(lvl: unknown): number {
  if (typeof lvl !== 'number' || !Number.isFinite(lvl)) return 0
  const floored = Math.floor(lvl)
  if (floored <= 0) return 0
  if (floored >= MAX_EQUIP_UPGRADE) return MAX_EQUIP_UPGRADE
  return floored
}

/**
 * Compute deterministic tempered equipment stats for a given upgrade level (`0..5`).
 * Level `0` returns the exact base `EquipmentSpec` stats unchanged.
 */
export function computeUpgradedEquipStats(
  spec: EquipmentSpec,
  upgradeLevel?: number
): UpgradedEquipStats {
  const lvl = normalizeEquipUpgradeLevel(upgradeLevel)
  const baseJump = spec.jump ?? 0
  if (lvl === 0) {
    return {
      atk: spec.atk,
      def: spec.def,
      hp: spec.hp,
      speed: spec.speed,
      move: spec.move,
      jump: baseJump,
      range: spec.range,
      crit: spec.crit,
      lifesteal: spec.lifesteal,
      shieldStart: spec.shieldStart
    }
  }

  const mul = 1 + EQUIP_UPGRADE_STAT_STEP * lvl
  const atk = spec.atk > 0 ? Math.max(spec.atk + lvl, Math.round(spec.atk * mul)) : spec.atk
  const def = spec.def > 0 ? Math.max(spec.def + lvl, Math.round(spec.def * mul)) : spec.def
  const hp = spec.hp > 0 ? Math.max(spec.hp + lvl * 3, Math.round(spec.hp * mul)) : spec.hp
  const shieldStart =
    spec.shieldStart > 0
      ? Math.max(spec.shieldStart + lvl * 2, Math.round(spec.shieldStart * mul))
      : spec.shieldStart
  const crit = spec.crit > 0 ? Math.round((spec.crit + 0.01 * lvl) * 1000) / 1000 : spec.crit
  const lifesteal =
    spec.lifesteal > 0 ? Math.round((spec.lifesteal + 0.02 * lvl) * 1000) / 1000 : spec.lifesteal

  return {
    atk,
    def,
    hp,
    speed: spec.speed,
    move: spec.move,
    jump: baseJump,
    range: spec.range,
    crit,
    lifesteal,
    shieldStart
  }
}

function roundToNearestFive(n: number): number {
  return Math.max(10, Math.round(n / 5) * 5)
}

/**
 * Compute the gold costs for both Temper / Reforge paths from `currentLevel` to `currentLevel + 1`.
 * Returns `null` when the item is already at `+5` (`MAX_EQUIP_UPGRADE`).
 */
export function getEquipUpgradeCosts(
  spec: EquipmentSpec,
  currentLevel: number
): EquipUpgradeCosts | null {
  const lvl = normalizeEquipUpgradeLevel(currentLevel)
  if (lvl >= MAX_EQUIP_UPGRADE) return null
  const nextLevel = lvl + 1
  const rarityFactor = EQUIP_UPGRADE_RARITY_FACTOR[spec.rarity]
  const baseGold = EQUIP_REFORGE_BASE_GOLD[lvl]
  const reforgeGoldCost = roundToNearestFive(baseGold * rarityFactor)
  const fuseFactor = 0.75 + 0.25 * rarityFactor
  const fuseGoldCost = roundToNearestFive(20 * nextLevel * fuseFactor)
  return {
    nextLevel,
    fuseGoldCost,
    reforgeGoldCost
  }
}

/**
 * Compute salvage Gold and Arcane Dust yields for an equipment card, including a proportional
 * refund bonus when salvaging tempered (`+1..+5`) gear.
 * Level `0` returns the exact base rarity salvage values unchanged.
 */
export function getUpgradedEquipSalvageYield(
  spec: EquipmentSpec,
  upgradeLevel?: number
): { readonly gold: number; readonly dust: number } {
  const lvl = normalizeEquipUpgradeLevel(upgradeLevel)
  const baseGold = RARITY_META[spec.rarity].salvage
  const baseDust = getEquipSalvageDust(spec.rarity)
  if (lvl === 0) {
    return { gold: baseGold, dust: baseDust }
  }
  const bonusGold = Math.round(baseGold * 0.5 * lvl) + lvl * 15
  const bonusDust = Math.round(baseDust * 0.35 * lvl)
  return {
    gold: baseGold + bonusGold,
    dust: baseDust + bonusDust
  }
}

/** Format equipment display name with `+N` temper suffix when `upgradeLevel > 0`. */
export function formatEquipDisplayName(spec: EquipmentSpec, upgradeLevel?: number): string {
  const lvl = normalizeEquipUpgradeLevel(upgradeLevel)
  return lvl > 0 ? `${spec.name} +${lvl}` : spec.name
}

/** Format a compact stat summary string for tempered equipment cards (e.g. "+8 ATK, +7% Crit"). */
export function formatUpgradedEquipSummary(spec: EquipmentSpec, upgradeLevel?: number): string {
  const lvl = normalizeEquipUpgradeLevel(upgradeLevel)
  if (lvl === 0) return spec.desc
  const s = computeUpgradedEquipStats(spec, lvl)
  const parts: string[] = []
  if (s.atk > 0) parts.push(`+${s.atk} ATK`)
  if (s.hp > 0) parts.push(`+${s.hp} HP`)
  if (s.def > 0) parts.push(`+${s.def} DEF`)
  if (s.shieldStart > 0) parts.push(`+${s.shieldStart} Shield`)
  if (s.speed > 0) parts.push(`+${s.speed} SPD`)
  if (s.move > 0) parts.push(`+${s.move} Mov`)
  if (s.range > 0) parts.push(`+${s.range} Rng`)
  if (s.crit > 0) parts.push(`+${Math.round(s.crit * 100)}% Crit`)
  if (s.lifesteal > 0) parts.push(`+${Math.round(s.lifesteal * 100)}% Drain`)
  return parts.length > 0 ? parts.join(', ') : spec.desc
}

function collectEquippedUids(campaign: CampaignState): Set<string> {
  const equippedUids = new Set<string>()
  for (const hero of campaign.heroes) {
    if (hero.weaponUid) equippedUids.add(hero.weaponUid)
    if (hero.armorUid) equippedUids.add(hero.armorUid)
    if (hero.relicUid) equippedUids.add(hero.relicUid)
  }
  return equippedUids
}

/**
 * Find all eligible duplicate fodder items for fusing into `targetEquipUid`:
 *  - Same `equipId`
 *  - Not the target item itself
 *  - Unlocked (`!item.locked`)
 *  - Unequipped (not equipped on any hero)
 *  - Untempered (`+0` only — `+1..+5` upgraded copies are protected from accidental fodder loss)
 */
export function findEligibleFuseDuplicates(
  campaign: CampaignState,
  targetEquipUid: string
): OwnedEquipCard[] {
  const target = campaign.equipment.find(e => e.uid === targetEquipUid)
  if (!target) return []
  const equippedUids = collectEquippedUids(campaign)
  const candidates: OwnedEquipCard[] = []
  for (const item of campaign.equipment) {
    if (item.uid === target.uid) continue
    if (item.equipId !== target.equipId) continue
    if (item.locked) continue
    if (equippedUids.has(item.uid)) continue
    if (normalizeEquipUpgradeLevel(item.upgradeLevel) > 0) continue
    candidates.push(item)
  }
  candidates.sort(
    (a, b) => normalizeEquipUpgradeLevel(a.upgradeLevel) - normalizeEquipUpgradeLevel(b.upgradeLevel)
  )
  return candidates
}

/** Find the single best duplicate fodder copy (`+0` untempered, unequipped & unlocked). */
export function findEligibleFuseDuplicate(
  campaign: CampaignState,
  targetEquipUid: string
): OwnedEquipCard | null {
  const candidates = findEligibleFuseDuplicates(campaign, targetEquipUid)
  return candidates.length > 0 ? candidates[0] : null
}

function buildStatDeltas(
  before: UpgradedEquipStats,
  after: UpgradedEquipStats
): EquipUpgradeStatDelta[] {
  const deltas: EquipUpgradeStatDelta[] = []
  const pushInt = (key: EquipUpgradeStatKey, label: string, b: number, a: number) => {
    if (a !== b) deltas.push({ key, label, before: b, after: a, delta: a - b, isPercent: false })
  }
  const pushPct = (key: EquipUpgradeStatKey, label: string, b: number, a: number) => {
    const bp = Math.round(b * 100)
    const ap = Math.round(a * 100)
    if (ap !== bp) deltas.push({ key, label, before: bp, after: ap, delta: ap - bp, isPercent: true })
  }
  pushInt('atk', 'ATK', before.atk, after.atk)
  pushInt('def', 'DEF', before.def, after.def)
  pushInt('hp', 'HP', before.hp, after.hp)
  pushInt('shieldStart', 'SHD', before.shieldStart, after.shieldStart)
  pushPct('crit', 'CRIT', before.crit, after.crit)
  pushPct('lifesteal', 'DRN', before.lifesteal, after.lifesteal)
  return deltas
}

/** Build a complete pure preview of tempering `equipUid` from its current level to the next level. */
export function getEquipUpgradePreview(
  campaign: CampaignState,
  equipUid: string
): EquipUpgradePreview | null {
  const item = campaign.equipment.find(e => e.uid === equipUid)
  if (!item) return null
  const spec = EQUIPMENT_BY_ID[item.equipId]
  if (!spec) return null

  const currentLevel = normalizeEquipUpgradeLevel(item.upgradeLevel)
  const isMaxLevel = currentLevel >= MAX_EQUIP_UPGRADE
  const nextLevel = isMaxLevel ? MAX_EQUIP_UPGRADE : currentLevel + 1
  const beforeStats = computeUpgradedEquipStats(spec, currentLevel)
  const afterStats = computeUpgradedEquipStats(spec, nextLevel)
  const statDeltas = isMaxLevel ? [] : buildStatDeltas(beforeStats, afterStats)
  const costs = getEquipUpgradeCosts(spec, currentLevel)
  const duplicates = isMaxLevel ? [] : findEligibleFuseDuplicates(campaign, item.uid)
  const fuseDuplicate = duplicates.length > 0 ? duplicates[0] : null
  const fuseGoldCost = costs ? costs.fuseGoldCost : 0
  const reforgeGoldCost = costs ? costs.reforgeGoldCost : 0
  const canFuseDuplicate = !isMaxLevel && fuseDuplicate !== null && campaign.gold >= fuseGoldCost
  const canGoldReforge = !isMaxLevel && costs !== null && campaign.gold >= reforgeGoldCost

  return {
    equipUid: item.uid,
    equipId: item.equipId,
    spec,
    currentLevel,
    nextLevel,
    isMaxLevel,
    currentDisplayName: formatEquipDisplayName(spec, currentLevel),
    nextDisplayName: formatEquipDisplayName(spec, nextLevel),
    beforeStats,
    afterStats,
    statDeltas,
    eligibleDuplicateCount: duplicates.length,
    fuseDuplicateUid: fuseDuplicate ? fuseDuplicate.uid : null,
    fuseGoldCost,
    canFuseDuplicate,
    reforgeGoldCost,
    canGoldReforge
  }
}

/**
 * Temper `targetEquipUid` by +1 using Duplicate Fusion:
 * consumes 1 eligible unlocked unequipped duplicate of the same `equipId` (lowest level first)
 * plus the discounted gold cost.
 */
export function upgradeEquipWithDuplicate(
  state: GameState,
  targetEquipUid: string
): EquipUpgradeResult | null {
  const { campaign } = state
  const target = campaign.equipment.find(e => e.uid === targetEquipUid)
  if (!target) return null
  const spec = EQUIPMENT_BY_ID[target.equipId]
  if (!spec) return null

  const oldLevel = normalizeEquipUpgradeLevel(target.upgradeLevel)
  const costs = getEquipUpgradeCosts(spec, oldLevel)
  if (!costs) return null

  const fodder = findEligibleFuseDuplicate(campaign, target.uid)
  if (!fodder) return null
  if (campaign.gold < costs.fuseGoldCost) return null

  const fodderIdx = campaign.equipment.findIndex(e => e.uid === fodder.uid)
  if (fodderIdx < 0) return null

  campaign.equipment.splice(fodderIdx, 1)
  campaign.gold -= costs.fuseGoldCost
  target.upgradeLevel = costs.nextLevel
  state.sounds.push({ kind: 'merge' })

  return {
    equipUid: target.uid,
    equipId: target.equipId,
    method: 'duplicate',
    oldLevel,
    newLevel: costs.nextLevel,
    goldSpent: costs.fuseGoldCost,
    consumedDuplicateUid: fodder.uid,
    displayName: formatEquipDisplayName(spec, costs.nextLevel)
  }
}

/**
 * Temper `targetEquipUid` by +1 using Gold Reforge (no duplicate required).
 */
export function upgradeEquipWithGold(
  state: GameState,
  targetEquipUid: string
): EquipUpgradeResult | null {
  const { campaign } = state
  const target = campaign.equipment.find(e => e.uid === targetEquipUid)
  if (!target) return null
  const spec = EQUIPMENT_BY_ID[target.equipId]
  if (!spec) return null

  const oldLevel = normalizeEquipUpgradeLevel(target.upgradeLevel)
  const costs = getEquipUpgradeCosts(spec, oldLevel)
  if (!costs) return null
  if (campaign.gold < costs.reforgeGoldCost) return null

  campaign.gold -= costs.reforgeGoldCost
  target.upgradeLevel = costs.nextLevel
  state.sounds.push({ kind: 'merge' })

  return {
    equipUid: target.uid,
    equipId: target.equipId,
    method: 'gold',
    oldLevel,
    newLevel: costs.nextLevel,
    goldSpent: costs.reforgeGoldCost,
    consumedDuplicateUid: null,
    displayName: formatEquipDisplayName(spec, costs.nextLevel)
  }
}

/** Count how many owned equipment cards are tempered (`+1..+5`). */
export function countUpgradedEquipment(campaign: Pick<CampaignState, 'equipment'>): number {
  let count = 0
  for (const item of campaign.equipment) {
    if (normalizeEquipUpgradeLevel(item.upgradeLevel) > 0) count += 1
  }
  return count
}
