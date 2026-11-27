import { EQUIPMENT_BY_ID, HERO_SPECS } from './data.ts'
import {
  canHeroEquipItem,
  getEquipCompatibilityReason,
  getEquipFamily,
  getHeroEquipFamily
} from './equip-families.ts'
import { formatEquipDisplayName, normalizeEquipUpgradeLevel } from './gear-upgrade.ts'
import { computeHeroStats, findEquipOwner, getEquipmentByUid, getHeroByUid } from './simulation.ts'
import type { CampaignState, EquipFamily, EquipSlot, OwnedHeroCard, Rarity } from './types.ts'

export type ArmoryStatKey = 'atk' | 'def' | 'maxHp' | 'speed' | 'move' | 'range' | 'crit'

export interface ArmoryStatMeta {
  readonly key: ArmoryStatKey
  readonly label: string
  readonly shortLabel: string
  readonly isPercent: boolean
}

export const ARMORY_STAT_ORDER: readonly ArmoryStatMeta[] = [
  { key: 'atk', label: 'ATK', shortLabel: 'ATK', isPercent: false },
  { key: 'def', label: 'DEF', shortLabel: 'DEF', isPercent: false },
  { key: 'maxHp', label: 'HP', shortLabel: 'HP', isPercent: false },
  { key: 'speed', label: 'SPD', shortLabel: 'SPD', isPercent: false },
  { key: 'move', label: 'MOVE', shortLabel: 'MOV', isPercent: false },
  { key: 'range', label: 'RANGE', shortLabel: 'RNG', isPercent: false },
  { key: 'crit', label: 'CRIT', shortLabel: 'CRIT', isPercent: true }
]

export interface StatDiffEntry {
  readonly before: number
  readonly after: number
  readonly delta: number
}

export interface EquipmentStatDiff {
  readonly heroUid: string
  readonly heroName: string
  readonly heroFamily: EquipFamily
  readonly slot: EquipSlot
  readonly candidateEquipUid: string
  readonly candidateName: string
  readonly candidateUpgradeLevel: number
  readonly candidateRarity: Rarity
  readonly candidateFamily: EquipFamily
  readonly compatible: boolean
  readonly incompatibilityReason: string | null
  readonly currentItemName: string | null
  readonly currentItemUpgradeLevel: number
  readonly currentItemRarity: Rarity | null
  readonly isAlreadyEquipped: boolean
  readonly currentOwnerUid: string | null
  readonly currentOwnerName: string | null
  readonly stats: Readonly<Record<ArmoryStatKey, StatDiffEntry>>
  readonly powerBefore: number
  readonly powerAfter: number
  readonly netPowerDelta: number
  readonly hasAnyChange: boolean
}

function makeStatEntry(before: number, after: number): StatDiffEntry {
  return { before, after, delta: after - before }
}

/** Format a numeric stat delta with optional directional arrow and percent suffix. */
export function formatStatDelta(delta: number, isPercent = false, withArrow = true): string {
  const suffix = isPercent ? '%' : ''
  if (delta > 0) return `${withArrow ? '▲ ' : ''}+${delta}${suffix}`
  if (delta < 0) return `${withArrow ? '▼ ' : ''}${delta}${suffix}`
  return `0${suffix}`
}

/** Format a compact stat delta tag (no space after arrow) for dense hero stat strips. */
export function formatCompactStatDelta(delta: number, isPercent = false): string {
  const suffix = isPercent ? '%' : ''
  if (delta > 0) return `▲+${delta}${suffix}`
  if (delta < 0) return `▼${delta}${suffix}`
  return `0${suffix}`
}

/** Format a stat value (integer or integer percentage). */
export function formatStatValue(value: number, isPercent = false): string {
  return isPercent ? `${value}%` : `${value}`
}

/**
 * Purely compute the exact stat diff of equipping `candidateEquipUid` onto `heroUid`
 * without mutating `campaign` or any hero card.
 */
export function computeEquipmentStatDiff(
  campaign: CampaignState,
  heroUid: string,
  candidateEquipUid: string
): EquipmentStatDiff | null {
  const hero = getHeroByUid(campaign, heroUid)
  const candidate = getEquipmentByUid(campaign, candidateEquipUid)
  if (!hero || !candidate) return null

  const candidateSpec = EQUIPMENT_BY_ID[candidate.equipId]
  if (!candidateSpec) return null

  const heroSpec = HERO_SPECS[hero.heroId]
  const slot = candidate.slot
  const currentSlotUid =
    slot === 'weapon'
      ? hero.weaponUid
      : slot === 'armor'
        ? hero.armorUid
        : hero.relicUid

  const currentItem = getEquipmentByUid(campaign, currentSlotUid)
  const currentSpec = currentItem ? EQUIPMENT_BY_ID[currentItem.equipId] : undefined

  const owner = findEquipOwner(campaign, candidate.uid)
  const isAlreadyEquipped = currentSlotUid === candidate.uid || owner?.uid === hero.uid
  const otherOwner = owner && owner.uid !== hero.uid ? owner : undefined
  const currentOwnerUid = otherOwner ? otherOwner.uid : null
  const currentOwnerName = otherOwner ? HERO_SPECS[otherOwner.heroId].name : null

  const heroFamily = getHeroEquipFamily(hero.heroId)
  const candidateFamily = getEquipFamily(candidate.equipId)
  const compatible = canHeroEquipItem(hero.heroId, candidate.equipId)
  const incompatibilityReason = getEquipCompatibilityReason(hero.heroId, candidate.equipId)

  const beforeStats = computeHeroStats(campaign, hero)
  let afterStats = beforeStats
  if (!isAlreadyEquipped && compatible) {
    const hypotheticalHero: OwnedHeroCard = {
      ...hero,
      weaponUid: slot === 'weapon' ? candidate.uid : hero.weaponUid,
      armorUid: slot === 'armor' ? candidate.uid : hero.armorUid,
      relicUid: slot === 'relic' ? candidate.uid : hero.relicUid
    }
    afterStats = computeHeroStats(campaign, hypotheticalHero)
  }

  const critBefore = Math.round(beforeStats.crit * 100)
  const critAfter = Math.round(afterStats.crit * 100)

  const stats: Readonly<Record<ArmoryStatKey, StatDiffEntry>> = {
    atk: makeStatEntry(beforeStats.atk, afterStats.atk),
    def: makeStatEntry(beforeStats.def, afterStats.def),
    maxHp: makeStatEntry(beforeStats.maxHp, afterStats.maxHp),
    speed: makeStatEntry(beforeStats.speed, afterStats.speed),
    move: makeStatEntry(beforeStats.move, afterStats.move),
    range: makeStatEntry(beforeStats.range, afterStats.range),
    crit: makeStatEntry(critBefore, critAfter)
  }

  const netPowerDelta = afterStats.powerScore - beforeStats.powerScore
  const hasAnyChange =
    stats.atk.delta !== 0 ||
    stats.def.delta !== 0 ||
    stats.maxHp.delta !== 0 ||
    stats.speed.delta !== 0 ||
    stats.move.delta !== 0 ||
    stats.range.delta !== 0 ||
    stats.crit.delta !== 0

  const candidateUpgradeLevel = normalizeEquipUpgradeLevel(candidate.upgradeLevel)
  const currentItemUpgradeLevel = currentItem ? normalizeEquipUpgradeLevel(currentItem.upgradeLevel) : 0

  return {
    heroUid: hero.uid,
    heroName: heroSpec.name,
    heroFamily,
    slot,
    candidateEquipUid: candidate.uid,
    candidateName: formatEquipDisplayName(candidateSpec, candidateUpgradeLevel),
    candidateUpgradeLevel,
    candidateRarity: candidateSpec.rarity,
    candidateFamily,
    compatible,
    incompatibilityReason,
    currentItemName: currentSpec ? formatEquipDisplayName(currentSpec, currentItemUpgradeLevel) : null,
    currentItemUpgradeLevel,
    currentItemRarity: currentSpec ? currentSpec.rarity : null,
    isAlreadyEquipped,
    currentOwnerUid,
    currentOwnerName,
    stats,
    powerBefore: beforeStats.powerScore,
    powerAfter: afterStats.powerScore,
    netPowerDelta,
    hasAnyChange
  }
}
