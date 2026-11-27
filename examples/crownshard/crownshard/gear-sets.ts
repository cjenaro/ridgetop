import { EQUIPMENT_BY_ID, EQUIPMENT_LIST } from './data.ts'
import type {
  AttackArc,
  BattleUnit,
  CampaignState,
  EquipmentSpec,
  GearSetId,
  OwnedHeroCard
} from './types.ts'

/**
 * Pure 2-Piece Gear Set Bonuses domain module.
 * Zero browser globals; compiles cleanly to Godot GDScript and runs identically on Node/Bun/Deno.
 *
 * Sets:
 * - solis      (Solis Vanguard):       Solar Resonance   — +4 ATK, +14 HP, +8 Start Shield, +10% Skill DMG
 * - frostguard (Frostguard Bastion):   Permafrost Bulwark — +3 DEF, +16 HP, +10 Start Shield, +15% DMG vs Slowed/Stunned
 * - windrunner (Windrunner Stride):    Gale Momentum     — +2 SPD, +12% Crit, +10% Flank/Backstab DMG
 * - shadowfang (Shadowfang Syndicate): Venom Fang        — +3 ATK, +10% Crit, +10% Lifesteal, +12% DMG vs Poisoned/Burning
 * - astral     (Astral Conclave):      Starlight Conduit — +4 ATK, +2 SPD, +15% Skill DMG
 */

export interface GearSetStatBonus {
  readonly atk: number
  readonly def: number
  readonly hp: number
  readonly speed: number
  readonly move: number
  readonly crit: number
  readonly lifesteal: number
  readonly shieldStart: number
}

export interface GearSetCombatRule {
  readonly skillDamageMul?: number
  readonly skillIgnoreArmorBonus?: number
  readonly vsSlowOrStunDamageMul?: number
  readonly flankOrBackDamageMul?: number
  readonly vsPoisonOrBurnDamageMul?: number
}

export interface GearSetSpec {
  readonly id: GearSetId
  readonly name: string
  readonly shortName: string
  readonly tag: string
  readonly perkName: string
  readonly shortPerk: string
  readonly desc: string
  readonly piecesRequired: 2
  readonly accentHex: string
  readonly bgHex: string
  readonly statBonus: GearSetStatBonus
  readonly combatRule: GearSetCombatRule
}

export interface GearSetProgress {
  readonly setId: GearSetId
  readonly spec: GearSetSpec
  readonly equippedCount: number
  readonly requiredCount: 2
  readonly active: boolean
  readonly itemIds: readonly string[]
}

export interface ActiveGearSetInfo {
  readonly setId: GearSetId
  readonly spec: GearSetSpec
  readonly equippedCount: number
  readonly itemIds: readonly string[]
}

export interface GearSetCombatBonus {
  readonly damageMul: number
  readonly bonusIgnoreArmor: number
  readonly triggeredSets: readonly GearSetId[]
}

export const GEAR_SET_ORDER: readonly GearSetId[] = [
  'solis',
  'frostguard',
  'windrunner',
  'shadowfang',
  'astral'
]

export const GEAR_SET_SPECS: Readonly<Record<GearSetId, GearSetSpec>> = {
  solis: {
    id: 'solis',
    name: 'Solis Vanguard',
    shortName: 'Solis',
    tag: 'SOLIS',
    perkName: 'Solar Resonance',
    shortPerk: '+4 ATK, +14 HP, +8 SHD · +10% Skill DMG',
    desc: '2pc: +4 ATK, +14 HP, +8 Start Shield & +10% Skill DMG.',
    piecesRequired: 2,
    accentHex: '#ffd257',
    bgHex: '#382a12',
    statBonus: {
      atk: 4,
      def: 0,
      hp: 14,
      speed: 0,
      move: 0,
      crit: 0,
      lifesteal: 0,
      shieldStart: 8
    },
    combatRule: {
      skillDamageMul: 1.10
    }
  },
  frostguard: {
    id: 'frostguard',
    name: 'Frostguard Bastion',
    shortName: 'Frostguard',
    tag: 'FROST',
    perkName: 'Permafrost Bulwark',
    shortPerk: '+3 DEF, +16 HP, +10 SHD · +15% vs Slow/Stun',
    desc: '2pc: +3 DEF, +16 HP, +10 Start Shield & +15% DMG vs Slowed or Stunned foes.',
    piecesRequired: 2,
    accentHex: '#72dcff',
    bgHex: '#122c44',
    statBonus: {
      atk: 0,
      def: 3,
      hp: 16,
      speed: 0,
      move: 0,
      crit: 0,
      lifesteal: 0,
      shieldStart: 10
    },
    combatRule: {
      vsSlowOrStunDamageMul: 1.15
    }
  },
  windrunner: {
    id: 'windrunner',
    name: 'Windrunner Stride',
    shortName: 'Windrunner',
    tag: 'WIND',
    perkName: 'Gale Momentum',
    shortPerk: '+2 SPD, +12% Crit · +10% Flank/Back DMG',
    desc: '2pc: +2 SPD, +12% Crit & +10% Flank or Backstab DMG.',
    piecesRequired: 2,
    accentHex: '#5ef0aa',
    bgHex: '#123428',
    statBonus: {
      atk: 0,
      def: 0,
      hp: 0,
      speed: 2,
      move: 0,
      crit: 0.12,
      lifesteal: 0,
      shieldStart: 0
    },
    combatRule: {
      flankOrBackDamageMul: 1.10
    }
  },
  shadowfang: {
    id: 'shadowfang',
    name: 'Shadowfang Syndicate',
    shortName: 'Shadowfang',
    tag: 'SHDW',
    perkName: 'Venom Fang',
    shortPerk: '+3 ATK, +10% Crit/Leech · +12% vs Psn/Burn',
    desc: '2pc: +3 ATK, +10% Crit, +10% Lifesteal & +12% DMG vs Poisoned or Burning foes.',
    piecesRequired: 2,
    accentHex: '#d27dff',
    bgHex: '#2c1642',
    statBonus: {
      atk: 3,
      def: 0,
      hp: 0,
      speed: 0,
      move: 0,
      crit: 0.10,
      lifesteal: 0.10,
      shieldStart: 0
    },
    combatRule: {
      vsPoisonOrBurnDamageMul: 1.12
    }
  },
  astral: {
    id: 'astral',
    name: 'Astral Conclave',
    shortName: 'Astral',
    tag: 'ASTRAL',
    perkName: 'Starlight Conduit',
    shortPerk: '+4 ATK, +2 SPD · +15% Skill DMG',
    desc: '2pc: +4 ATK, +2 SPD & +15% Skill DMG.',
    piecesRequired: 2,
    accentHex: '#84c2ff',
    bgHex: '#16264a',
    statBonus: {
      atk: 4,
      def: 0,
      hp: 0,
      speed: 2,
      move: 0,
      crit: 0,
      lifesteal: 0,
      shieldStart: 0
    },
    combatRule: {
      skillDamageMul: 1.15
    }
  }
}

/** Return the full metadata & bonuses for a given GearSetId. */
export function getGearSetSpec(setId: GearSetId): GearSetSpec {
  return GEAR_SET_SPECS[setId]
}

/** Return the GearSetId for an equipment item, or `null` if it does not belong to a set. */
export function getEquipSetId(equipId: string | undefined): GearSetId | null {
  if (!equipId) return null
  return EQUIPMENT_BY_ID[equipId]?.setId ?? null
}

/** Return the GearSetSpec for an equipment item, or `null` if untagged. */
export function getEquipSetSpec(equipId: string | undefined): GearSetSpec | null {
  const setId = getEquipSetId(equipId)
  return setId ? GEAR_SET_SPECS[setId] : null
}

/** List all equipment specs belonging to a given set. */
export function getItemsInGearSet(setId: GearSetId): readonly EquipmentSpec[] {
  return EQUIPMENT_LIST.filter(item => item.setId === setId)
}

function resolveHeroEquipIds(
  campaign: Pick<CampaignState, 'equipment'>,
  hero: Pick<OwnedHeroCard, 'weaponUid' | 'armorUid' | 'relicUid'>
): readonly [string | undefined, string | undefined, string | undefined] {
  let weaponId: string | undefined
  let armorId: string | undefined
  let relicId: string | undefined
  if (hero.weaponUid || hero.armorUid || hero.relicUid) {
    for (const eq of campaign.equipment) {
      if (hero.weaponUid && eq.uid === hero.weaponUid) weaponId = eq.equipId
      if (hero.armorUid && eq.uid === hero.armorUid) armorId = eq.equipId
      if (hero.relicUid && eq.uid === hero.relicUid) relicId = eq.equipId
    }
  }
  return [weaponId, armorId, relicId]
}

/** Compute sorted gear set progress (`2/2` active sets first, then `1/2` partial sets) for a 3-slot loadout. */
export function getLoadoutGearSetProgress(
  weaponId: string | undefined,
  armorId: string | undefined,
  relicId: string | undefined
): GearSetProgress[] {
  const itemsBySet = new Map<GearSetId, string[]>()
  for (const eqId of [weaponId, armorId, relicId]) {
    if (!eqId) continue
    const setId = getEquipSetId(eqId)
    if (!setId) continue
    const list = itemsBySet.get(setId)
    if (list) list.push(eqId)
    else itemsBySet.set(setId, [eqId])
  }

  const out: GearSetProgress[] = []
  for (const setId of GEAR_SET_ORDER) {
    const itemIds = itemsBySet.get(setId)
    if (!itemIds || itemIds.length === 0) continue
    const spec = GEAR_SET_SPECS[setId]
    out.push({
      setId,
      spec,
      equippedCount: itemIds.length,
      requiredCount: spec.piecesRequired,
      active: itemIds.length >= spec.piecesRequired,
      itemIds
    })
  }
  out.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return b.equippedCount - a.equippedCount
  })
  return out
}

/** Return gear set progress (both `2/2` active and `1/2` partial) for a BattleUnit. */
export function getUnitGearSetProgress(
  unit: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined
): GearSetProgress[] {
  if (!unit) return []
  return getLoadoutGearSetProgress(unit.weaponId, unit.armorId, unit.relicId)
}

/** Return active 2-piece gear sets for a BattleUnit. */
export function getUnitActiveGearSets(
  unit: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined
): ActiveGearSetInfo[] {
  if (!unit) return []
  const progress = getLoadoutGearSetProgress(unit.weaponId, unit.armorId, unit.relicId)
  const active: ActiveGearSetInfo[] = []
  for (const entry of progress) {
    if (entry.active) {
      active.push({
        setId: entry.setId,
        spec: entry.spec,
        equippedCount: entry.equippedCount,
        itemIds: entry.itemIds
      })
    }
  }
  return active
}

/** Return gear set progress (both `2/2` active and `1/2` partial) for a campaign hero. */
export function getHeroGearSetProgress(
  campaign: Pick<CampaignState, 'equipment'>,
  hero: Pick<OwnedHeroCard, 'weaponUid' | 'armorUid' | 'relicUid'>
): GearSetProgress[] {
  const [weaponId, armorId, relicId] = resolveHeroEquipIds(campaign, hero)
  return getLoadoutGearSetProgress(weaponId, armorId, relicId)
}

/** Return active 2-piece gear sets for either a campaign hero or a live BattleUnit. */
export function getHeroActiveGearSets(
  campaign: Pick<CampaignState, 'equipment'>,
  hero: Pick<OwnedHeroCard, 'weaponUid' | 'armorUid' | 'relicUid'>
): ActiveGearSetInfo[]
export function getHeroActiveGearSets(
  unit: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined
): ActiveGearSetInfo[]
export function getHeroActiveGearSets(
  campaignOrUnit:
    | Pick<CampaignState, 'equipment'>
    | Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>>
    | null
    | undefined,
  hero?: Pick<OwnedHeroCard, 'weaponUid' | 'armorUid' | 'relicUid'>
): ActiveGearSetInfo[] {
  if (!campaignOrUnit) return []
  if (hero && 'equipment' in campaignOrUnit) {
    const [weaponId, armorId, relicId] = resolveHeroEquipIds(campaignOrUnit, hero)
    return getUnitActiveGearSets({ weaponId, armorId, relicId })
  }
  if ('equipment' in campaignOrUnit) return []
  return getUnitActiveGearSets(campaignOrUnit)
}

/** Convenience list of active GearSetIds for a campaign hero (useful for UI state & telemetry). */
export function getHeroActiveGearSetIds(
  campaign: Pick<CampaignState, 'equipment'>,
  hero: Pick<OwnedHeroCard, 'weaponUid' | 'armorUid' | 'relicUid'>
): GearSetId[] {
  return getHeroActiveGearSets(campaign, hero).map(entry => entry.setId)
}

/** Aggregate flat stat bonuses granted by all active 2-piece gear sets in a 3-slot loadout. */
export function computeGearSetStatBonuses(
  weaponId: string | undefined,
  armorId: string | undefined,
  relicId: string | undefined
): GearSetStatBonus {
  const active = getUnitActiveGearSets({ weaponId, armorId, relicId })
  if (active.length === 0) {
    return { atk: 0, def: 0, hp: 0, speed: 0, move: 0, crit: 0, lifesteal: 0, shieldStart: 0 }
  }
  let atk = 0
  let def = 0
  let hp = 0
  let speed = 0
  let move = 0
  let crit = 0
  let lifesteal = 0
  let shieldStart = 0
  for (const entry of active) {
    const b = entry.spec.statBonus
    atk += b.atk
    def += b.def
    hp += b.hp
    speed += b.speed
    move += b.move
    crit += b.crit
    lifesteal += b.lifesteal
    shieldStart += b.shieldStart
  }
  return { atk, def, hp, speed, move, crit, lifesteal, shieldStart }
}

/**
 * Compute live combat damage multipliers & bonus armor pierce granted by active 2-piece gear sets.
 * Wired into both `previewDamageMath` (`CombatForecast`) and `applyDamageDetailed` for exact parity.
 */
export function computeGearSetCombatBonuses(
  unit: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined,
  target: Partial<Pick<BattleUnit, 'slowTurns' | 'stunTurns' | 'poisonStacks' | 'burnTurns'>> | null | undefined,
  isSkill: boolean,
  attackArc: AttackArc = 'front'
): GearSetCombatBonus {
  if (!unit) {
    return { damageMul: 1.0, bonusIgnoreArmor: 0, triggeredSets: [] }
  }
  const active = getUnitActiveGearSets(unit)
  if (active.length === 0) {
    return { damageMul: 1.0, bonusIgnoreArmor: 0, triggeredSets: [] }
  }

  let damageMul = 1.0
  let bonusIgnoreArmor = 0
  const triggeredSets: GearSetId[] = []

  const targetSlowOrStun = Boolean(target && ((target.slowTurns ?? 0) > 0 || (target.stunTurns ?? 0) > 0))
  const targetPoisonOrBurn = Boolean(target && ((target.poisonStacks ?? 0) > 0 || (target.burnTurns ?? 0) > 0))
  const isFlankOrBack = attackArc === 'flank' || attackArc === 'back'

  for (const entry of active) {
    const rule = entry.spec.combatRule
    let triggered = false
    if (isSkill && rule.skillDamageMul && rule.skillDamageMul !== 1) {
      damageMul *= rule.skillDamageMul
      triggered = true
    }
    if (isSkill && rule.skillIgnoreArmorBonus && rule.skillIgnoreArmorBonus > 0) {
      bonusIgnoreArmor += rule.skillIgnoreArmorBonus
      triggered = true
    }
    if (targetSlowOrStun && rule.vsSlowOrStunDamageMul && rule.vsSlowOrStunDamageMul !== 1) {
      damageMul *= rule.vsSlowOrStunDamageMul
      triggered = true
    }
    if (isFlankOrBack && rule.flankOrBackDamageMul && rule.flankOrBackDamageMul !== 1) {
      damageMul *= rule.flankOrBackDamageMul
      triggered = true
    }
    if (targetPoisonOrBurn && rule.vsPoisonOrBurnDamageMul && rule.vsPoisonOrBurnDamageMul !== 1) {
      damageMul *= rule.vsPoisonOrBurnDamageMul
      triggered = true
    }
    if (triggered) {
      triggeredSets.push(entry.setId)
    }
  }

  return { damageMul, bonusIgnoreArmor, triggeredSets }
}
