import { EQUIPMENT_BY_ID } from './data.ts'
import type { CampaignState, EquipFamily, HeroClassId } from './types.ts'

/**
 * Pure Class-Locked Equipment Families domain module.
 * Zero browser globals; compiles cleanly to Godot GDScript and runs identically on Node/Bun/Deno.
 *
 * Families:
 * - vanguard   (Swords & Plate): Knight, Paladin, Sunblade (champion)
 * - arcane     (Staves & Robes): Mage, Cleric, Cryomancer
 * - skirmisher (Bows & Light):   Archer, Rogue
 * - universal  (Relics):         All hero classes
 */

export interface EquipFamilyMeta {
  readonly id: EquipFamily
  readonly label: string
  readonly shortLabel: string
  readonly compactLabel: string
  readonly weaponLabel: string
  readonly armorLabel: string
  readonly classNames: string
  readonly heroes: readonly HeroClassId[]
  readonly accentHex: string
  readonly bgHex: string
}

export const EQUIP_FAMILY_ORDER: readonly EquipFamily[] = [
  'vanguard',
  'arcane',
  'skirmisher',
  'universal'
]

export const EQUIP_FAMILY_META: Readonly<Record<EquipFamily, EquipFamilyMeta>> = {
  vanguard: {
    id: 'vanguard',
    label: 'Swords & Plate',
    shortLabel: 'Swords/Plate',
    compactLabel: 'SWD/PLT',
    weaponLabel: 'Swords',
    armorLabel: 'Plate',
    classNames: 'Knight, Paladin, Sunblade',
    heroes: ['knight', 'paladin', 'champion'],
    accentHex: '#69b8ff',
    bgHex: '#152946'
  },
  arcane: {
    id: 'arcane',
    label: 'Staves & Robes',
    shortLabel: 'Staves/Robes',
    compactLabel: 'STF/RBE',
    weaponLabel: 'Staves',
    armorLabel: 'Robes',
    classNames: 'Mage, Cleric, Cryomancer',
    heroes: ['mage', 'cleric', 'cryomancer'],
    accentHex: '#c98aff',
    bgHex: '#281945'
  },
  skirmisher: {
    id: 'skirmisher',
    label: 'Bows & Light',
    shortLabel: 'Bows/Light',
    compactLabel: 'BOW/LGT',
    weaponLabel: 'Bows',
    armorLabel: 'Light',
    classNames: 'Archer, Rogue',
    heroes: ['archer', 'rogue'],
    accentHex: '#5de09e',
    bgHex: '#133328'
  },
  universal: {
    id: 'universal',
    label: 'Universal',
    shortLabel: 'Universal',
    compactLabel: 'ALL',
    weaponLabel: 'Relic',
    armorLabel: 'Relic',
    classNames: 'All Classes',
    heroes: ['knight', 'archer', 'mage', 'cleric', 'rogue', 'paladin', 'cryomancer', 'champion'],
    accentHex: '#ffd266',
    bgHex: '#332812'
  }
}

export const HERO_EQUIP_FAMILY: Readonly<Record<HeroClassId, EquipFamily>> = {
  knight: 'vanguard',
  paladin: 'vanguard',
  champion: 'vanguard',
  mage: 'arcane',
  cleric: 'arcane',
  cryomancer: 'arcane',
  archer: 'skirmisher',
  rogue: 'skirmisher'
}

/** Return the equipment family allowed for a given hero class. */
export function getHeroEquipFamily(heroId: HeroClassId): EquipFamily {
  return HERO_EQUIP_FAMILY[heroId]
}

/** Return metadata (labels, colors, hero classes) for an equipment family. */
export function getEquipFamilyMeta(family: EquipFamily): EquipFamilyMeta {
  return EQUIP_FAMILY_META[family]
}

/** Return equipment family metadata for a hero class. */
export function getHeroEquipFamilyMeta(heroId: HeroClassId): EquipFamilyMeta {
  return EQUIP_FAMILY_META[getHeroEquipFamily(heroId)]
}

/** Return the equipment family of an item by its `equipId` (relics are always `'universal'`). */
export function getEquipFamily(equipId: string): EquipFamily {
  const spec = EQUIPMENT_BY_ID[equipId]
  if (!spec) return 'universal'
  if (spec.slot === 'relic') return 'universal'
  return spec.family
}

/** True when `heroId` is permitted to equip `equipId` under class-family rules. */
export function canHeroEquipItem(heroId: HeroClassId, equipId: string): boolean {
  const spec = EQUIPMENT_BY_ID[equipId]
  if (!spec) return false
  if (spec.slot === 'relic' || spec.family === 'universal') return true
  return getHeroEquipFamily(heroId) === spec.family
}

/**
 * Return a human-readable incompatibility reason when `heroId` cannot equip `equipId`,
 * or `null` if compatible.
 */
export function getEquipCompatibilityReason(heroId: HeroClassId, equipId: string): string | null {
  const spec = EQUIPMENT_BY_ID[equipId]
  if (!spec) return 'Unknown equipment item'
  if (canHeroEquipItem(heroId, equipId)) return null
  const fam = EQUIP_FAMILY_META[spec.family]
  return `Requires ${fam.shortLabel} (${fam.classNames})`
}

/** Concise lock label for compact Armory cards (e.g., `"Staves/Robes only"`). */
export function getEquipShortLockLabel(equipId: string): string {
  const fam = EQUIP_FAMILY_META[getEquipFamily(equipId)]
  if (fam.id === 'universal') return 'Universal'
  return `${fam.shortLabel} only`
}

/**
 * Gracefully unequip any class-incompatible items from heroes back into inventory
 * without deleting the items. Used during save hydration / migration.
 * Returns the number of incompatible slots cleared.
 */
export function sanitizeHeroEquipmentFamilies(
  campaign: Pick<CampaignState, 'heroes' | 'equipment'>
): number {
  const byUid = new Map<string, string>()
  for (const item of campaign.equipment) {
    byUid.set(item.uid, item.equipId)
  }

  let unequippedCount = 0
  for (const hero of campaign.heroes) {
    if (hero.weaponUid) {
      const eqId = byUid.get(hero.weaponUid)
      if (eqId !== undefined && !canHeroEquipItem(hero.heroId, eqId)) {
        hero.weaponUid = null
        unequippedCount += 1
      }
    }
    if (hero.armorUid) {
      const eqId = byUid.get(hero.armorUid)
      if (eqId !== undefined && !canHeroEquipItem(hero.heroId, eqId)) {
        hero.armorUid = null
        unequippedCount += 1
      }
    }
    if (hero.relicUid) {
      const eqId = byUid.get(hero.relicUid)
      if (eqId !== undefined && !canHeroEquipItem(hero.heroId, eqId)) {
        hero.relicUid = null
        unequippedCount += 1
      }
    }
  }
  return unequippedCount
}
