import { RARITY_ORDER, TACTIC_BY_ID } from './data.ts'
import { terrainMoveCost } from './types.ts'
import type {
  AttackArc, BattleState, BattleUnit, CampaignState, GameState,
  HeroClassId, OwnedTacticCard, TileTerrain
} from './types.ts'

/**
 * Pure Hero Innate Passives, Equipment Special Effects, and Curated Tactic Deck Rules.
 * Zero browser globals so it compiles cleanly to Godot GDScript and runs identically on Node/Bun/Deno.
 */

export const MIN_TACTIC_DECK = 6
export const MAX_TACTIC_DECK = 12
export const RECOMMENDED_MIN_TACTIC_DECK = 8

export const SHIELD_WALL_DEF_BONUS = 3
export const ARCANE_CONDUIT_SPLASH_RATIO = 0.20
export const CHAMPION_KO_CT_SURGE = 25

export interface HeroPassiveSpec {
  readonly id: string
  readonly heroId: HeroClassId
  readonly name: string
  readonly shortLabel: string
  readonly desc: string
  readonly accentHex: string
}

export interface EquipEffectSpec {
  readonly equipId: string
  readonly name: string
  readonly shortLabel: string
  readonly desc: string
  readonly accentHex: string
  readonly jumpBonus?: number
  readonly ignoresSnowMoveCost?: boolean
  readonly burnOnCrit?: boolean
  readonly chillMeleeAttacker?: boolean
  readonly healOnKo?: number
  readonly bossDamageMul?: number
  readonly firstKoApRefund?: number
  readonly lowHpTurnStartShield?: { readonly hpRatioBelow: number; readonly shield: number }
  readonly skillDamageTakenMul?: number
  readonly vsBurnOrStunDamageMul?: number
  readonly vsSlowDamageMul?: number
  readonly turnStartHpRegen?: number
  readonly ignoreCoverDef?: number
  readonly highDefArmorPierce?: { readonly minDef: number; readonly bonusIgnoreArmor: number }
}

export interface TacticDeckCurve {
  readonly total: number
  readonly min: number
  readonly max: number
  readonly avgCost: number
  /** Counts of cards costing [0 AP, 1 AP, 2+ AP] in the active deck. */
  readonly byCost: readonly [number, number, number]
}

export const HERO_PASSIVES: Record<HeroClassId, HeroPassiveSpec> = {
  knight: {
    id: 'shield_wall',
    heroId: 'knight',
    name: 'Shield Wall',
    shortLabel: 'Adj Allies +3 DEF',
    desc: 'Adjacent living allies gain +3 DEF.',
    accentHex: '#69c2ff'
  },
  archer: {
    id: 'eagle_eyrie',
    heroId: 'archer',
    name: 'Eagle Eyrie',
    shortLabel: 'H1+: +1 Rng · Ignore Cover',
    desc: 'On high ground (H1+), gain +1 Range and ignore enemy Cover DEF.',
    accentHex: '#6ee09e'
  },
  rogue: {
    id: 'shadow_step',
    heroId: 'rogue',
    name: 'Shadow Step',
    shortLabel: '+20% Backstab Crit · Evade ZoC',
    desc: '+20% Backstab crit chance and slips past enemy Zones of Control.',
    accentHex: '#d482ff'
  },
  cleric: {
    id: 'overflowing_grace',
    heroId: 'cleric',
    name: 'Overflowing Grace',
    shortLabel: 'Overheal -> Shield (50% HP)',
    desc: 'Excess healing above max HP converts into Shield (up to 50% target max HP).',
    accentHex: '#ffe478'
  },
  cryomancer: {
    id: 'glacial_stride',
    heroId: 'cryomancer',
    name: 'Glacial Stride',
    shortLabel: 'Snow 1 Mov · +20% vs Slow',
    desc: 'Ignores Snow movement penalty (costs 1) and deals +20% DMG to Slowed foes.',
    accentHex: '#7adfff'
  },
  mage: {
    id: 'arcane_conduit',
    heroId: 'mage',
    name: 'Arcane Conduit',
    shortLabel: 'Skill KO: +1 AP & 20% Splash',
    desc: 'Skill KOs refund +1 AP and splash 20% magic DMG to 1 adjacent enemy.',
    accentHex: '#ff9b5e'
  },
  paladin: {
    id: 'vengeful_aegis',
    heroId: 'paladin',
    name: 'Vengeful Aegis',
    shortLabel: 'Shield Block: +30% Ctr & +4 SHD',
    desc: 'Blocking a frontal melee hit with Shield boosts Counter DMG +30% and grants +4 Shield.',
    accentHex: '#ffd15c'
  },
  champion: {
    id: 'relentless_momentum',
    heroId: 'champion',
    name: 'Relentless Momentum',
    shortLabel: 'On KO: Empower & +25 CT',
    desc: 'Securing a KO grants Empower and surges +25 CT.',
    accentHex: '#ff7066'
  }
}

export const EQUIP_EFFECTS: Record<string, EquipEffectSpec> = {
  ember_wand: {
    equipId: 'ember_wand',
    name: 'Ember Crit',
    shortLabel: 'Burn on Crit',
    desc: 'Critical hits ignite the target with Burn.',
    accentHex: '#f08742',
    burnOnCrit: true
  },
  swift_boots: {
    equipId: 'swift_boots',
    name: 'Gale Stride',
    shortLabel: '+1 Jump · Snow 1 Mov',
    desc: 'Grants +1 Jump and ignores Snow rough movement cost.',
    accentHex: '#5cd99e',
    jumpBonus: 1,
    ignoresSnowMoveCost: true
  },
  sunsteel_blade: {
    equipId: 'sunsteel_blade',
    name: 'Solar Execution',
    shortLabel: '+15% vs Burn/Stun',
    desc: 'Deals +15% DMG against Burning or Stunned foes.',
    accentHex: '#f0c44d',
    vsBurnOrStunDamageMul: 1.15
  },
  frostbite_staff: {
    equipId: 'frostbite_staff',
    name: 'Permafrost Focus',
    shortLabel: '+15% vs Slowed',
    desc: 'Deals +15% DMG against Slowed foes.',
    accentHex: '#6dd9ff',
    vsSlowDamageMul: 1.15
  },
  runed_mail: {
    equipId: 'runed_mail',
    name: 'Arcane Ward',
    shortLabel: '-15% Skill DMG Taken',
    desc: 'Reduces incoming skill and spell damage by 15%.',
    accentHex: '#5a9cf2',
    skillDamageTakenMul: 0.85
  },
  blood_amulet: {
    equipId: 'blood_amulet',
    name: 'Sanguine Harvest',
    shortLabel: '+14 HP on KO',
    desc: 'Restores +14 HP whenever the wearer secures a KO.',
    accentHex: '#e85a6f',
    healOnKo: 14
  },
  dragonfang_spear: {
    equipId: 'dragonfang_spear',
    name: 'Armor Rend',
    shortLabel: '+10% Pierce vs DEF 5+',
    desc: 'Ignores an extra 10% armor against targets with 5+ DEF.',
    accentHex: '#d66bff',
    highDefArmorPierce: { minDef: 5, bonusIgnoreArmor: 0.10 }
  },
  frostguard_plate: {
    equipId: 'frostguard_plate',
    name: 'Glacial Thorns',
    shortLabel: 'Chills Melee Attackers',
    desc: 'Adjacent melee attackers are chilled with Slow (1 turn).',
    accentHex: '#9d7bff',
    chillMeleeAttacker: true
  },
  eagle_charm: {
    equipId: 'eagle_charm',
    name: 'Deadeye Sight',
    shortLabel: 'Ignores 2 Cover DEF',
    desc: 'Ignores 2 points of enemy Cover DEF on ranged attacks.',
    accentHex: '#be7dff',
    ignoreCoverDef: 2
  },
  solis_crownblade: {
    equipId: 'solis_crownblade',
    name: 'Regicide',
    shortLabel: '+10% vs Boss · 1st KO +1 AP',
    desc: 'Deals +10% DMG vs Bosses and refunds +1 AP on first KO.',
    accentHex: '#ffe066',
    bossDamageMul: 1.10,
    firstKoApRefund: 1
  },
  aegis_of_dawn: {
    equipId: 'aegis_of_dawn',
    name: 'Dawn Bulwark',
    shortLabel: '<60% HP: +6 SHD/Turn',
    desc: 'Grants +6 Shield at turn start when below 60% HP.',
    accentHex: '#ffd15c',
    lowHpTurnStartShield: { hpRatioBelow: 0.6, shield: 6 }
  },
  heart_of_solis: {
    equipId: 'heart_of_solis',
    name: 'Solar Vitality',
    shortLabel: '+10 HP Regen/Turn',
    desc: 'Regenerates +10 HP at the start of each turn.',
    accentHex: '#ffdb6e',
    turnStartHpRegen: 10
  },
  solis_archstaff: {
    equipId: 'solis_archstaff',
    name: 'Arcane Surge',
    shortLabel: '+15% vs Burn/Stun',
    desc: 'Deals +15% DMG against Burning or Stunned foes.',
    accentHex: '#b882ff',
    vsBurnOrStunDamageMul: 1.15
  },
  celestial_staff: {
    equipId: 'celestial_staff',
    name: 'Starfire Conduit',
    shortLabel: '+12% vs Boss · Burn on Crit',
    desc: 'Deals +12% DMG vs Bosses and ignites foes with Burn on Crit.',
    accentHex: '#8ef4ff',
    bossDamageMul: 1.12,
    burnOnCrit: true
  },
  astral_vestments: {
    equipId: 'astral_vestments',
    name: 'Astral Ward',
    shortLabel: '-15% Skill DMG Taken',
    desc: 'Reduces incoming skill and spell damage by 15%.',
    accentHex: '#6ea8ff',
    skillDamageTakenMul: 0.85
  },
  glacier_raiment: {
    equipId: 'glacier_raiment',
    name: 'Rime Shroud',
    shortLabel: 'Chills Melee Attackers',
    desc: 'Adjacent melee attackers are chilled with Slow (1 turn).',
    accentHex: '#85e0ff',
    chillMeleeAttacker: true
  },
  starweaver_mantle: {
    equipId: 'starweaver_mantle',
    name: 'Starlight Aegis',
    shortLabel: '<60% HP: +8 SHD · -18% Skill DMG',
    desc: 'Grants +8 Shield at turn start below 60% HP & -18% incoming skill DMG.',
    accentHex: '#d499ff',
    lowHpTurnStartShield: { hpRatioBelow: 0.6, shield: 8 },
    skillDamageTakenMul: 0.82
  },
  gale_longbow: {
    equipId: 'gale_longbow',
    name: 'Windpiercer',
    shortLabel: 'Ignores 2 Cover DEF',
    desc: 'Ignores 2 points of enemy Cover DEF on ranged attacks.',
    accentHex: '#59d4ff',
    ignoreCoverDef: 2
  },
  shadowfang_bow: {
    equipId: 'shadowfang_bow',
    name: 'Fang Pierce',
    shortLabel: '+12% Pierce vs DEF 5+',
    desc: 'Ignores an extra 12% armor against targets with 5+ DEF.',
    accentHex: '#c76eff',
    highDefArmorPierce: { minDef: 5, bonusIgnoreArmor: 0.12 }
  },
  windrunner_bow: {
    equipId: 'windrunner_bow',
    name: 'Apex Hunter',
    shortLabel: '+12% vs Boss · Ignore 2 Cover',
    desc: 'Deals +12% DMG vs Bosses and ignores 2 Cover DEF.',
    accentHex: '#74f2b8',
    bossDamageMul: 1.12,
    ignoreCoverDef: 2
  },
  stalker_leathers: {
    equipId: 'stalker_leathers',
    name: 'Ridge Stride',
    shortLabel: '+1 Jump',
    desc: 'Grants +1 Jump height to scale ridges and walls effortlessly.',
    accentHex: '#5d87b8',
    jumpBonus: 1
  },
  shadowsilk_vest: {
    equipId: 'shadowsilk_vest',
    name: 'Shadow Siphon',
    shortLabel: '+10 HP on KO',
    desc: 'Restores +10 HP whenever the wearer secures a KO.',
    accentHex: '#a86bff',
    healOnKo: 10
  },
  nightwind_garb: {
    equipId: 'nightwind_garb',
    name: 'Nightwind Grace',
    shortLabel: '+8 HP Regen/Turn · +1 Jump',
    desc: 'Regenerates +8 HP each turn start and grants +1 Jump.',
    accentHex: '#5ce8b8',
    turnStartHpRegen: 8,
    jumpBonus: 1
  }
}

function manhattan(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

export function getHeroPassive(heroId: HeroClassId | undefined): HeroPassiveSpec | null {
  if (!heroId) return null
  return HERO_PASSIVES[heroId] ?? null
}

export function getEquipEffect(equipId: string | undefined): EquipEffectSpec | null {
  if (!equipId) return null
  return EQUIP_EFFECTS[equipId] ?? null
}

export function getEquipmentJumpBonus(equipId: string | undefined): number {
  if (!equipId) return 0
  return EQUIP_EFFECTS[equipId]?.jumpBonus ?? 0
}

export function getUnitEquipEffects(
  unit: Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'> | null | undefined
): EquipEffectSpec[] {
  if (!unit) return []
  const out: EquipEffectSpec[] = []
  const ids = [unit.weaponId, unit.armorId, unit.relicId]
  for (const id of ids) {
    if (!id) continue
    const eff = EQUIP_EFFECTS[id]
    if (eff) out.push(eff)
  }
  return out
}

export function unitHasEquip(
  unit: Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'> | null | undefined,
  equipId: string
): boolean {
  if (!unit) return false
  return unit.weaponId === equipId || unit.armorId === equipId || unit.relicId === equipId
}

/** True when the unit ignores Snow's 2-Move rough terrain cost (Cryomancer or Gale Striders). */
export function ignoresSnowMoveCost(
  unit: Partial<Pick<BattleUnit, 'heroId' | 'weaponId' | 'armorId' | 'relicId'>> | null | undefined
): boolean {
  if (!unit) return false
  if (unit.heroId === 'cryomancer') return true
  for (const eff of getUnitEquipEffects(unit)) {
    if (eff.ignoresSnowMoveCost) return true
  }
  return false
}

/** Unit-aware terrain movement cost (Snow costs 1 instead of 2 for Cryomancer / Gale Striders). */
export function unitTerrainMoveCost(
  unit: Partial<Pick<BattleUnit, 'heroId' | 'weaponId' | 'armorId' | 'relicId'>> | null | undefined,
  terrain: TileTerrain
): number {
  if (terrain === 'snow' && ignoresSnowMoveCost(unit)) return 1
  return terrainMoveCost(terrain)
}

/**
 * Knight Innate Passive — Shield Wall:
 * Adjacent living allies gain +3 DEF (does not self-buff the Knight).
 */
export function computeShieldWallDefBonus(
  battle: Pick<BattleState, 'units'> | null | undefined,
  defender: Pick<BattleUnit, 'uid' | 'team' | 'col' | 'row' | 'alive'>
): number {
  if (!battle || !defender.alive) return 0
  for (const u of battle.units) {
    if (!u.alive || u.team !== defender.team || u.uid === defender.uid) continue
    if (u.heroId !== 'knight') continue
    if (manhattan(u.col, u.row, defender.col, defender.row) === 1) {
      return SHIELD_WALL_DEF_BONUS
    }
  }
  return 0
}

/**
 * Archer Innate Passive — Eagle Eyrie (Range component):
 * +1 extra attack range when attacking from high ground (heightLevel >= 1).
 */
export function computePassiveRangeBonus(
  attacker: Partial<Pick<BattleUnit, 'heroId'>> | null | undefined,
  attackerHeightLevel: number,
  baseRange: number
): number {
  if (!attacker || baseRange <= 1) return 0
  if (attacker.heroId === 'archer' && attackerHeightLevel >= 1) return 1
  return 0
}

/**
 * Cover DEF adjustment for Archer's Eagle Eyrie (ignores Cover DEF on heightLevel >= 1)
 * and Skyhawk Crest (`eagle_charm`, ignores 2 Cover DEF).
 */
export function adjustCoverBonusForAttacker(
  rawCover: number,
  attacker: Partial<Pick<BattleUnit, 'heroId' | 'weaponId' | 'armorId' | 'relicId'>> | null | undefined,
  attackerHeightLevel: number
): number {
  if (rawCover <= 0 || !attacker) return Math.max(0, rawCover)
  if (attacker.heroId === 'archer' && attackerHeightLevel >= 1) return 0
  let reduction = 0
  for (const eff of getUnitEquipEffects(attacker)) {
    if (eff.ignoreCoverDef) reduction += eff.ignoreCoverDef
  }
  return Math.max(0, rawCover - reduction)
}

/**
 * Attacker-side passive & equipment damage multiplier:
 * - Cryomancer Glacial Stride: +20% vs Slowed foes
 * - Sunsteel Blade: +15% vs Burning or Stunned foes
 * - Frostbite Staff: +15% vs Slowed foes
 * - Solis Crownblade: +10% vs Bosses
 */
export function computeAttackerDamageMultiplier(
  attacker: Partial<Pick<BattleUnit, 'heroId' | 'weaponId' | 'armorId' | 'relicId'>> | null | undefined,
  defender: Pick<BattleUnit, 'slowTurns' | 'burnTurns' | 'stunTurns' | 'isBoss'>
): number {
  if (!attacker) return 1.0
  let mul = 1.0
  if (attacker.heroId === 'cryomancer' && defender.slowTurns > 0) {
    mul *= 1.20
  }
  for (const eff of getUnitEquipEffects(attacker)) {
    if (eff.vsBurnOrStunDamageMul && (defender.burnTurns > 0 || defender.stunTurns > 0)) {
      mul *= eff.vsBurnOrStunDamageMul
    }
    if (eff.vsSlowDamageMul && defender.slowTurns > 0) {
      mul *= eff.vsSlowDamageMul
    }
    if (eff.bossDamageMul && defender.isBoss) {
      mul *= eff.bossDamageMul
    }
  }
  return mul
}

/**
 * Defender-side incoming damage multiplier:
 * - Runed Chainmail (`runed_mail`): -15% incoming skill damage
 */
export function computeDefenderIncomingDamageMultiplier(
  defender: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined,
  isSkillDamage: boolean
): number {
  if (!defender || !isSkillDamage) return 1.0
  let mul = 1.0
  for (const eff of getUnitEquipEffects(defender)) {
    if (eff.skillDamageTakenMul !== undefined) {
      mul *= eff.skillDamageTakenMul
    }
  }
  return mul
}

/**
 * Bonus armor pierce from equipment:
 * - Dragonfang Halberd (`dragonfang_spear`): +10% armor pierce vs targets with DEF >= 5
 */
export function computeBonusIgnoreArmor(
  attacker: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined,
  defenderDef: number
): number {
  if (!attacker) return 0
  let bonus = 0
  for (const eff of getUnitEquipEffects(attacker)) {
    if (eff.highDefArmorPierce && defenderDef >= eff.highDefArmorPierce.minDef) {
      bonus += eff.highDefArmorPierce.bonusIgnoreArmor
    }
  }
  return bonus
}

/**
 * Rogue Innate Passive — Shadow Step:
 * +20% Backstab crit chance on back-arc attacks.
 */
export function computeBackstabPassiveCritBonus(
  attacker: Partial<Pick<BattleUnit, 'heroId'>> | null | undefined,
  attackArc: AttackArc
): number {
  if (attacker?.heroId === 'rogue' && attackArc === 'back') return 0.20
  return 0
}

/**
 * Cleric Innate Passive — Overflowing Grace:
 * Excess healing above target's maxHp converts into Shield (capped so shield from overheal
 * cannot push target's shield past 50% of target's maxHp).
 */
export function computeOverhealShield(
  healer: Partial<Pick<BattleUnit, 'heroId'>> | null | undefined,
  target: Pick<BattleUnit, 'hp' | 'maxHp' | 'shield'>,
  healAmount: number,
  baseShield = 0
): number {
  if (healer?.heroId !== 'cleric' || healAmount <= 0) return 0
  const missing = Math.max(0, target.maxHp - target.hp)
  const overheal = Math.max(0, healAmount - missing)
  if (overheal <= 0) return 0
  const cap = Math.floor(target.maxHp * 0.5)
  const room = Math.max(0, cap - (target.shield + baseShield))
  return Math.min(overheal, room)
}

/** Ember Scepter (`ember_wand`): Critical hits apply Burn. */
export function shouldApplyBurnOnCrit(
  attacker: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined
): boolean {
  for (const eff of getUnitEquipEffects(attacker)) {
    if (eff.burnOnCrit) return true
  }
  return false
}

/** Frostguard Plate (`frostguard_plate`): Chills adjacent melee attackers with Slow 1. */
export function shouldChillMeleeAttacker(
  defender: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined
): boolean {
  for (const eff of getUnitEquipEffects(defender)) {
    if (eff.chillMeleeAttacker) return true
  }
  return false
}

/** Crimson Pendant (`blood_amulet`): Heal +14 HP on KO. */
export function computeKoHealAmount(
  attacker: Partial<Pick<BattleUnit, 'weaponId' | 'armorId' | 'relicId'>> | null | undefined
): number {
  let heal = 0
  for (const eff of getUnitEquipEffects(attacker)) {
    if (eff.healOnKo) heal += eff.healOnKo
  }
  return heal
}

/**
 * Paladin Innate Passive — Vengeful Aegis:
 * Blocking damage with Shield on a frontal melee hit boosts Counter-Attack damage +30%
 * and grants +4 Shield on counter.
 */
export function computePaladinCounterBonus(
  defender: Partial<Pick<BattleUnit, 'heroId'>> | null | undefined,
  attackArc: AttackArc,
  shieldAbsorbed: number
): { readonly counterMul: number; readonly shieldGain: number } {
  if (defender?.heroId === 'paladin' && attackArc === 'front' && shieldAbsorbed > 0) {
    return { counterMul: 1.30, shieldGain: 4 }
  }
  return { counterMul: 1.0, shieldGain: 0 }
}

/**
 * Turn-start equipment triggers:
 * - Heart of Solis (`heart_of_solis`): +10 HP regen per turn start
 * - Aegis of Dawn (`aegis_of_dawn`): +6 Shield at turn start when below 60% HP
 */
export function computeTurnStartGearEffects(
  unit: Pick<BattleUnit, 'hp' | 'maxHp' | 'weaponId' | 'armorId' | 'relicId'>
): { readonly hpRegen: number; readonly shieldGain: number } {
  let hpRegen = 0
  let shieldGain = 0
  const hpRatio = unit.hp / Math.max(1, unit.maxHp)
  for (const eff of getUnitEquipEffects(unit)) {
    if (eff.turnStartHpRegen && unit.hp < unit.maxHp) {
      hpRegen += eff.turnStartHpRegen
    }
    if (eff.lowHpTurnStartShield && hpRatio < eff.lowHpTurnStartShield.hpRatioBelow) {
      shieldGain += eff.lowHpTurnStartShield.shield
    }
  }
  return { hpRegen, shieldGain }
}

// =========================================================================
// CURATED TACTIC DECK BUILDER (6..12 active battle cards)
// =========================================================================

/**
 * Returns the active battle Tactic Deck UIDs for `campaign`.
 * Backwards-compatible: if `activeTacticDeckUids` is omitted or empty,
 * defaults cleanly to owned tactics up to `MAX_TACTIC_DECK` (12).
 */
export function getActiveTacticDeckUids(
  campaign: Pick<CampaignState, 'tactics' | 'activeTacticDeckUids'>
): string[] {
  const owned = campaign.tactics
  if (owned.length === 0) return []
  const ownedSet = new Set<string>(owned.map(t => t.uid))
  const minFloor = Math.min(MIN_TACTIC_DECK, owned.length)

  if (Array.isArray(campaign.activeTacticDeckUids) && campaign.activeTacticDeckUids.length > 0) {
    const valid: string[] = []
    const seen = new Set<string>()
    for (const uid of campaign.activeTacticDeckUids) {
      if (!ownedSet.has(uid) || seen.has(uid)) continue
      seen.add(uid)
      valid.push(uid)
      if (valid.length >= MAX_TACTIC_DECK) break
    }
    if (valid.length > 0) {
      // Top up only if corrupted/salvaged below minimum playable floor
      if (valid.length < minFloor) {
        for (const t of owned) {
          if (seen.has(t.uid)) continue
          seen.add(t.uid)
          valid.push(t.uid)
          if (valid.length >= minFloor) break
        }
      }
      return valid
    }
  }

  return owned.slice(0, MAX_TACTIC_DECK).map(t => t.uid)
}

/**
 * Toggle an owned tactic card In or Out of the player's curated battle deck.
 * Enforces `MIN_TACTIC_DECK`..`MAX_TACTIC_DECK` bounds (or owned count when fewer than 6 owned).
 */
export function toggleTacticInDeck(state: GameState, tacticUid: string): boolean {
  const { campaign } = state
  const exists = campaign.tactics.some(t => t.uid === tacticUid)
  if (!exists) return false

  const active = getActiveTacticDeckUids(campaign)
  const minFloor = Math.min(MIN_TACTIC_DECK, campaign.tactics.length)
  const idx = active.indexOf(tacticUid)

  if (idx >= 0) {
    if (active.length <= minFloor) return false
    active.splice(idx, 1)
    campaign.activeTacticDeckUids = active
    state.sounds.push({ kind: 'card' })
    return true
  }

  if (active.length >= MAX_TACTIC_DECK) return false
  active.push(tacticUid)
  campaign.activeTacticDeckUids = active
  state.sounds.push({ kind: 'equip' })
  return true
}

function tacticRoleScore(tacticId: string, copyIndex: number): number {
  const spec = TACTIC_BY_ID[tacticId]
  if (!spec) return 0
  const rarityScore = RARITY_ORDER.indexOf(spec.rarity) * 26
  const costCurveBonus = spec.cost === 0 ? 22 : spec.cost === 1 ? 14 : 8
  const reviveBonus = spec.canRevive ? 12 : 0
  const utilBonus = spec.refreshMove || spec.apGain > 0 ? 10 : 0
  const aoeBonus = spec.pattern === 'all_allies' ? 16 : spec.pattern === 'area3' ? 12 : spec.pattern === 'cross' ? 8 : 0
  // Favor deck diversity: 1st copy gets full bonus, 2nd modest, 3rd+ penalized
  const dupPenalty = copyIndex === 0 ? 0 : copyIndex === 1 ? -14 : -34 - copyIndex * 10
  return rarityScore + costCurveBonus + reviveBonus + utilBonus + aoeBonus + dupPenalty
}

/**
 * Automatically curates a balanced battle tactic deck (up to 12 cards) prioritizing
 * higher-rarity cards, role diversity (healing/revive + damage + utility), and a smooth AP curve.
 */
export function autoBuildTacticDeck(state: GameState): string[] {
  const { campaign } = state
  const owned = campaign.tactics
  if (owned.length === 0) {
    campaign.activeTacticDeckUids = []
    return []
  }

  const targetCount = Math.min(MAX_TACTIC_DECK, owned.length)
  const seenPerId = new Map<string, number>()
  const scored: { card: OwnedTacticCard; score: number; cost: number; idx: number }[] = []

  for (let i = 0; i < owned.length; i++) {
    const card = owned[i]
    const copyIndex = seenPerId.get(card.tacticId) ?? 0
    seenPerId.set(card.tacticId, copyIndex + 1)
    const spec = TACTIC_BY_ID[card.tacticId]
    scored.push({
      card,
      score: tacticRoleScore(card.tacticId, copyIndex),
      cost: spec ? spec.cost : 1,
      idx: i
    })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.cost !== b.cost) return a.cost - b.cost
    return a.idx - b.idx
  })

  // Keep AP curve healthy: avoid filling more than 4 slots with 2+ AP heavy cards when cheaper cards exist
  const chosen: OwnedTacticCard[] = []
  const overflow: OwnedTacticCard[] = []
  let heavyCount = 0
  const maxHeavy = 4

  for (const entry of scored) {
    if (chosen.length >= targetCount) break
    if (entry.cost >= 2 && heavyCount >= maxHeavy) {
      overflow.push(entry.card)
      continue
    }
    chosen.push(entry.card)
    if (entry.cost >= 2) heavyCount += 1
  }
  for (const card of overflow) {
    if (chosen.length >= targetCount) break
    chosen.push(card)
  }

  const result = chosen.map(c => c.uid)
  campaign.activeTacticDeckUids = result
  state.sounds.push({ kind: 'equip' })
  return result.slice()
}

/** Summarizes deck size and AP curve [0-cost, 1-cost, 2+-cost] for Camp UI. */
export function computeTacticDeckCurve(
  campaign: Pick<CampaignState, 'tactics' | 'activeTacticDeckUids'>
): TacticDeckCurve {
  const activeUids = getActiveTacticDeckUids(campaign)
  const byUid = new Map<string, OwnedTacticCard>()
  for (const t of campaign.tactics) byUid.set(t.uid, t)
  let c0 = 0
  let c1 = 0
  let c2 = 0
  let costSum = 0
  let count = 0
  for (const uid of activeUids) {
    const owned = byUid.get(uid)
    const spec = owned ? TACTIC_BY_ID[owned.tacticId] : undefined
    if (!spec) continue
    count += 1
    costSum += spec.cost
    if (spec.cost <= 0) c0 += 1
    else if (spec.cost === 1) c1 += 1
    else c2 += 1
  }
  return {
    total: count,
    min: Math.min(MIN_TACTIC_DECK, campaign.tactics.length),
    max: MAX_TACTIC_DECK,
    avgCost: count > 0 ? Math.round((costSum / count) * 10) / 10 : 0,
    byCost: [c0, c1, c2]
  }
}
