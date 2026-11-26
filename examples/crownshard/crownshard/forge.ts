import { EQUIPMENT_BY_ID, EQUIPMENT_LIST, HERO_LIST, HERO_SPECS } from './data.ts'
import type {
  CampaignState, EquipSlot, EquipmentSpec, GameState, HeroClassId, HeroSpec,
  OwnedEquipCard, OwnedHeroCard, PackPityStatus, Rarity
} from './types.ts'

export const EPIC_PITY_THRESHOLD = 10
export const LEGENDARY_PITY_THRESHOLD = 40

/** Arcane Dust awarded when salvaging equipment cards by rarity. */
export const EQUIP_SALVAGE_DUST: Record<Rarity, number> = {
  common: 10,
  uncommon: 25,
  rare: 60,
  epic: 150,
  legendary: 400
}

/** Base Hero Shards awarded when salvaging hero cards by rarity (multiplied by stars). */
export const HERO_SALVAGE_SHARDS: Record<Rarity, number> = {
  common: 15,
  uncommon: 35,
  rare: 80,
  epic: 180,
  legendary: 400
}

/** Bonus Hero Shards awarded when a pack pulls an overflow copy of a 3★ maxed hero. */
export const MAX_HERO_OVERFLOW_SHARDS: Record<Rarity, number> = {
  common: 25,
  uncommon: 55,
  rare: 120,
  epic: 270,
  legendary: 600
}

/** Hero Shard crafting cost per rarity tier for forging a targeted 1★ hero card. */
export const HERO_CRAFT_COST: Record<Rarity, number> = {
  common: 60,
  uncommon: 140,
  rare: 320,
  epic: 720,
  legendary: 1600
}

/** Arcane Dust crafting cost per rarity tier for forging a targeted weapon, armor, or relic. */
export const EQUIP_CRAFT_COST: Record<Rarity, number> = {
  common: 40,
  uncommon: 100,
  rare: 240,
  epic: 600,
  legendary: 1600
}

function allocForgeUid(campaign: CampaignState, prefix: string): string {
  const id = `${prefix}_${campaign.nextUid}`
  campaign.nextUid += 1
  return id
}

function pickFromPool<T>(pool: readonly T[], roll: number): T {
  const clamped = roll < 0 ? 0 : roll >= 1 ? 0.999999 : roll
  const idx = Math.floor(clamped * pool.length) % pool.length
  return pool[idx]
}

/** Current pack pity progress and remaining packs until guaranteed Epic+ / Legendary drops. */
export function getPackPityStatus(
  campaign: Pick<CampaignState, 'packsSinceEpic' | 'packsSinceLegendary'>
): PackPityStatus {
  const packsSinceEpic = Math.max(0, Math.floor(campaign.packsSinceEpic || 0))
  const packsSinceLegendary = Math.max(0, Math.floor(campaign.packsSinceLegendary || 0))
  return {
    packsSinceEpic,
    epicIn: Math.max(1, EPIC_PITY_THRESHOLD - packsSinceEpic),
    packsSinceLegendary,
    legendaryIn: Math.max(1, LEGENDARY_PITY_THRESHOLD - packsSinceLegendary)
  }
}

/** Determine whether the current pack triggers Epic or Legendary pity protection. */
export function resolvePackPityFloor(
  nextSinceEpic: number,
  nextSinceLegendary: number
): 'legendary' | 'epic' | null {
  if (nextSinceLegendary >= LEGENDARY_PITY_THRESHOLD) return 'legendary'
  if (nextSinceEpic >= EPIC_PITY_THRESHOLD) return 'epic'
  return null
}

/** Reset pity counters when an Epic or Legendary card is pulled (Legendary resets both). */
export function updatePackPityCounters(
  campaign: Pick<CampaignState, 'packsSinceEpic' | 'packsSinceLegendary'>,
  bestRarity: Rarity
): void {
  if (bestRarity === 'legendary') {
    campaign.packsSinceLegendary = 0
    campaign.packsSinceEpic = 0
  } else if (bestRarity === 'epic') {
    campaign.packsSinceEpic = 0
  }
}

/** Returns true if the player already owns a 3★ max-ascended copy of `heroId`. */
export function hasMaxedHero(
  campaign: Pick<CampaignState, 'heroes'>,
  heroId: HeroClassId
): boolean {
  return campaign.heroes.some(h => h.heroId === heroId && h.stars >= 3)
}

/** Arcane Dust yielded when salvaging an equipment card of the given rarity. */
export function getEquipSalvageDust(rarity: Rarity): number {
  return EQUIP_SALVAGE_DUST[rarity]
}

/** Hero Shards yielded when salvaging a hero card of the given rarity and star tier. */
export function getHeroSalvageShards(rarity: Rarity, stars: 1 | 2 | 3): number {
  return HERO_SALVAGE_SHARDS[rarity] * stars
}

/** Bonus Hero Shards awarded when a pack rolls an excess copy of an already 3★ maxed hero. */
export function getDuplicateMaxHeroShards(rarity: Rarity): number {
  return MAX_HERO_OVERFLOW_SHARDS[rarity]
}

/**
 * Duplicate protection for Hero pulls:
 * 1. Prioritize unowned hero classes in the candidate pool.
 * 2. Next, prioritize hero classes the player does NOT yet own at 3★ max ascension.
 * 3. Fall back to the full candidate pool (where 3★ overflow converts into bonus Hero Shards).
 */
export function selectProtectedHero(
  candidates: readonly HeroSpec[],
  campaign: Pick<CampaignState, 'heroes'>,
  roll: number
): HeroSpec {
  const unowned = candidates.filter(spec => !campaign.heroes.some(h => h.heroId === spec.id))
  if (unowned.length > 0) return pickFromPool(unowned, roll)

  const nonMaxed = candidates.filter(spec => !hasMaxedHero(campaign, spec.id))
  if (nonMaxed.length > 0) return pickFromPool(nonMaxed, roll)

  return pickFromPool(candidates, roll)
}

/**
 * Duplicate protection for Equipment pulls:
 * Prioritize unowned equipment IDs in the candidate pool before rolling duplicates.
 */
export function selectProtectedEquipment(
  candidates: readonly EquipmentSpec[],
  campaign: Pick<CampaignState, 'equipment'>,
  roll: number
): EquipmentSpec {
  const unowned = candidates.filter(spec => !campaign.equipment.some(e => e.equipId === spec.id))
  if (unowned.length > 0) return pickFromPool(unowned, roll)
  return pickFromPool(candidates, roll)
}

/** Hero Shard cost to forge a targeted 1★ hero card in the Armory Forge. */
export function getHeroCraftCost(heroId: HeroClassId): number {
  const spec = HERO_SPECS[heroId]
  return spec ? HERO_CRAFT_COST[spec.rarity] : 0
}

/** Returns true if the campaign has enough Hero Shards to forge `heroId`. */
export function canCraftHero(
  campaign: Pick<CampaignState, 'shards'>,
  heroId: HeroClassId
): boolean {
  const cost = getHeroCraftCost(heroId)
  return cost > 0 && campaign.shards >= cost
}

/** Forge a targeted 1★ hero card directly into the roster using Hero Shards. */
export function craftHero(state: GameState, heroId: HeroClassId): OwnedHeroCard | null {
  const spec = HERO_SPECS[heroId]
  if (!spec) return null
  const cost = HERO_CRAFT_COST[spec.rarity]
  if (state.campaign.shards < cost) return null

  state.campaign.shards -= cost
  const card: OwnedHeroCard = {
    uid: allocForgeUid(state.campaign, 'hero'),
    heroId: spec.id,
    stars: 1,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  }
  state.campaign.heroes.push(card)
  state.sounds.push({ kind: 'pack', rarity: spec.rarity })
  return card
}

/** Arcane Dust cost to forge a targeted equipment/relic card in the Armory Forge. */
export function getEquipCraftCost(equipId: string): number {
  const spec = EQUIPMENT_BY_ID[equipId]
  return spec ? EQUIP_CRAFT_COST[spec.rarity] : 0
}

/** Returns true if the campaign has enough Arcane Dust to forge `equipId`. */
export function canCraftEquipment(
  campaign: Pick<CampaignState, 'dust'>,
  equipId: string
): boolean {
  const cost = getEquipCraftCost(equipId)
  return cost > 0 && campaign.dust >= cost
}

/** Forge a targeted weapon, armor, or relic directly into the Armory inventory using Arcane Dust. */
export function craftEquipment(state: GameState, equipId: string): OwnedEquipCard | null {
  const spec = EQUIPMENT_BY_ID[equipId]
  if (!spec) return null
  const cost = EQUIP_CRAFT_COST[spec.rarity]
  if (state.campaign.dust < cost) return null

  state.campaign.dust -= cost
  const card: OwnedEquipCard = {
    uid: allocForgeUid(state.campaign, 'eq'),
    equipId: spec.id,
    slot: spec.slot
  }
  state.campaign.equipment.push(card)
  state.sounds.push({ kind: 'pack', rarity: spec.rarity })
  return card
}

/** List all craftable hero classes in Armory Forge order. */
export function getCraftableHeroes(): readonly HeroSpec[] {
  return HERO_LIST
}

/** List craftable equipment recipes, optionally filtered by slot. */
export function getCraftableEquipment(slot: EquipSlot | 'all' = 'all'): readonly EquipmentSpec[] {
  if (slot === 'all') return EQUIPMENT_LIST
  return EQUIPMENT_LIST.filter(item => item.slot === slot)
}
