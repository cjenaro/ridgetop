import { EQUIPMENT_BY_ID, RARITY_META } from './data.ts'
import { getEquipSalvageDust } from './forge.ts'
import type { CampaignState, GameState, OwnedEquipCard, OwnedHeroCard } from './types.ts'

export interface BulkSalvagePreview {
  readonly count: number
  readonly totalGold: number
  readonly totalDust: number
  readonly equipUids: readonly string[]
}

export interface BulkSalvageResult {
  readonly salvagedCount: number
  readonly totalGold: number
  readonly totalDust: number
}

/**
 * Toggle the favorite/lock flag on an owned equipment card.
 * Returns true if the card existed and its lock state was toggled.
 */
export function toggleEquipLock(state: GameState, equipUid: string): boolean {
  const item = state.campaign.equipment.find(e => e.uid === equipUid)
  if (!item) return false
  item.locked = !item.locked
  state.sounds.push({ kind: 'card' })
  return true
}

/**
 * Toggle the favorite/lock flag on an owned hero card.
 * Returns true if the hero existed and its lock state was toggled.
 */
export function toggleHeroLock(state: GameState, heroUid: string): boolean {
  const hero = state.campaign.heroes.find(h => h.uid === heroUid)
  if (!hero) return false
  hero.locked = !hero.locked
  state.sounds.push({ kind: 'card' })
  return true
}

/**
 * Find all Common equipment duplicates eligible for one-click bulk salvage:
 *  1. Common rarity (`rarity === 'common'`)
 *  2. Unlocked (`!item.locked`)
 *  3. Unequipped (not equipped in any hero's weapon, armor, or relic slot)
 *  4. Excess duplicate: always preserves at least 1 copy of each `equipId`
 *     (preferring an already-equipped or locked copy, otherwise the first copy).
 */
export function findBulkSalvageableCommonDupes(campaign: CampaignState): OwnedEquipCard[] {
  const equippedUids = new Set<string>()
  for (const hero of campaign.heroes) {
    if (hero.weaponUid) equippedUids.add(hero.weaponUid)
    if (hero.armorUid) equippedUids.add(hero.armorUid)
    if (hero.relicUid) equippedUids.add(hero.relicUid)
  }

  // First pass: mark any Common equipId that already has at least 1 equipped or locked copy.
  const keptEquipIds = new Set<string>()
  for (const item of campaign.equipment) {
    const spec = EQUIPMENT_BY_ID[item.equipId]
    if (!spec || spec.rarity !== 'common') continue
    if (item.locked || equippedUids.has(item.uid)) {
      keptEquipIds.add(item.equipId)
    }
  }

  // Second pass: keep the first unlocked unequipped copy if none is kept yet; flag the rest.
  const salvageable: OwnedEquipCard[] = []
  for (const item of campaign.equipment) {
    const spec = EQUIPMENT_BY_ID[item.equipId]
    if (!spec || spec.rarity !== 'common') continue
    if (item.locked || equippedUids.has(item.uid)) continue
    if (!keptEquipIds.has(item.equipId)) {
      keptEquipIds.add(item.equipId)
      continue
    }
    salvageable.push(item)
  }

  return salvageable
}

/**
 * Preview how many unlocked unequipped Common duplicate equipment cards will be salvaged
 * and the exact total gold payout they will yield.
 */
export function previewBulkSalvageCommonDupes(campaign: CampaignState): BulkSalvagePreview {
  const dupes = findBulkSalvageableCommonDupes(campaign)
  let totalGold = 0
  let totalDust = 0
  const equipUids: string[] = []
  for (const item of dupes) {
    const spec = EQUIPMENT_BY_ID[item.equipId]
    if (!spec) continue
    equipUids.push(item.uid)
    totalGold += RARITY_META[spec.rarity].salvage
    totalDust += getEquipSalvageDust(spec.rarity)
  }
  return { count: equipUids.length, totalGold, totalDust, equipUids }
}

/**
 * Execute bulk salvage of all eligible Common duplicates using `salvageEquip`,
 * ensuring any single-item salvage rewards (gold, Arcane Dust, etc.) compose cleanly.
 */
export function executeBulkSalvageCommonDupes(
  state: GameState,
  salvageEquip: (state: GameState, equipUid: string) => number
): BulkSalvageResult {
  const dupes = findBulkSalvageableCommonDupes(state.campaign)
  if (dupes.length === 0) return { salvagedCount: 0, totalGold: 0, totalDust: 0 }

  const uids = dupes.map(item => item.uid)
  const soundStart = state.sounds.length
  const dustBefore = state.campaign.dust
  let salvagedCount = 0
  let totalGold = 0

  for (const uid of uids) {
    const gold = salvageEquip(state, uid)
    if (gold > 0) {
      salvagedCount += 1
      totalGold += gold
    }
  }

  // Coalesce repeated per-card coin chimes into a single crisp coin cue.
  if (salvagedCount > 1 && state.sounds.length > soundStart) {
    let keptCoin = false
    const compacted = state.sounds.slice(0, soundStart)
    for (let i = soundStart; i < state.sounds.length; i++) {
      const ev = state.sounds[i]
      if (ev.kind === 'coin') {
        if (!keptCoin) {
          compacted.push(ev)
          keptCoin = true
        }
      } else {
        compacted.push(ev)
      }
    }
    state.sounds = compacted
  }

  const totalDust = Math.max(0, state.campaign.dust - dustBefore)
  return { salvagedCount, totalGold, totalDust }
}

export function isHeroLocked(hero: Pick<OwnedHeroCard, 'locked'> | undefined): boolean {
  return Boolean(hero?.locked)
}

export function isEquipLocked(item: Pick<OwnedEquipCard, 'locked'> | undefined): boolean {
  return Boolean(item?.locked)
}
