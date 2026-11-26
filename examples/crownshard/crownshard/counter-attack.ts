import {
  cellHeightAt, facingVector, terrainDefBonus, vectorToFacing
} from './types.ts'
import type {
  AttackArc, BattleState, BattleUnit, CounterAvoidReason, FacingDir, SkillSpec
} from './types.ts'

/** Counter-attacks deal 70% of the defender's normal frontal basic attack damage. */
export const COUNTER_DAMAGE_MULTIPLIER = 0.7

/** Minimum damage floor for a melee counter-attack (70% of the 4-damage basic floor, rounded). */
export const COUNTER_MIN_DAMAGE = 3

export interface CounterEligibilityOptions {
  /** Attacker column when the strike lands (e.g. Move+Strike approach tile in forecasts). */
  readonly attackerCol?: number
  /** Attacker row when the strike lands (e.g. Move+Strike approach tile in forecasts). */
  readonly attackerRow?: number
  /** True when the incoming hit is projected to lethally KO the defender. */
  readonly incomingLethal?: boolean
  /** True when the incoming hit will inflict Stun on the defender. */
  readonly incomingStun?: boolean
}

export interface CounterDamageOptions {
  /** Attacker column when the counter lands (defaults to `attacker.col`). */
  readonly attackerCol?: number
  /** Attacker row when the counter lands (defaults to `attacker.row`). */
  readonly attackerRow?: number
  /** Attacker facing when the counter lands (defaults to facing toward defender). */
  readonly attackerFacing?: FacingDir
  /** Attacker HP before counter damage (e.g. after skill self-heal / lifesteal). */
  readonly attackerHp?: number
  /** Attacker shield before counter damage (e.g. after skill self-shield). */
  readonly attackerShield?: number
  /** Optional cover bonus for the attacker's tile (always 0 for adjacent melee). */
  readonly coverBonus?: number
}

export interface CounterDamageResult {
  readonly normalDmg: number
  readonly shieldAbsorbed: number
  readonly hpDamage: number
  readonly attackerHpAfter: number
  readonly lethalToAttacker: boolean
}

function manhattanDist(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

function elevationMul(attackerLevel: number, defenderLevel: number): number {
  const diff = attackerLevel - defenderLevel
  if (diff >= 3) return 1.35
  if (diff === 2) return 1.28
  if (diff === 1) return 1.2
  if (diff === -1) return 0.92
  if (diff <= -2) return 0.85
  return 1.0
}

function attackArcBetween(
  fromCol: number,
  fromRow: number,
  targetCol: number,
  targetRow: number,
  targetFacing: FacingDir
): AttackArc {
  const vc = fromCol - targetCol
  const vr = fromRow - targetRow
  if (vc === 0 && vr === 0) return 'front'
  const [fc, fr] = facingVector(targetFacing)
  const dot = vc * fc + vr * fr
  const cross = Math.abs(vc * fr - vr * fc)
  if (dot > 0 && dot >= cross) return 'front'
  if (dot < 0 && -dot >= cross) return 'back'
  return 'flank'
}

function arcDamageMultiplier(arc: AttackArc): number {
  if (arc === 'back') return 1.30
  if (arc === 'flank') return 1.15
  return 1.0
}

/**
 * Returns true if a hero skill is a single-target adjacent melee weapon strike
 * that allows a surviving, unstunned frontal melee defender to counter-attack.
 */
export function isMeleeSkillEligibleForCounter(skill: SkillSpec | null | undefined): boolean {
  if (!skill) return false
  return skill.range === 1 && skill.pattern === 'single' && skill.powerMul > 0
}

/**
 * Determines whether `defender` will counter-attack `attacker` in response to an incoming hit.
 *
 * Rules:
 * - Both units must be alive and on opposing teams.
 * - Defender must survive the hit (`!incomingLethal`) and not be stunned (`stunTurns <= 0 && !incomingStun`).
 * - Incoming attack must be a frontal (`attackArc === 'front'`) adjacent melee strike (`manhattan === 1`,
 *   `!isRangedOrSkill`) against an eligible melee defender (`defender.range === 1`).
 */
export function canCounterAttack(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'> | null | undefined,
  attacker: Pick<BattleUnit, 'team' | 'col' | 'row' | 'alive' | 'range'> | null | undefined,
  defender: Pick<BattleUnit, 'team' | 'col' | 'row' | 'alive' | 'stunTurns' | 'range'> | null | undefined,
  attackArc: AttackArc,
  isRangedOrSkill = false,
  opts?: CounterEligibilityOptions
): boolean {
  if (!battle || !attacker || !defender) return false
  if (!attacker.alive || !defender.alive) return false
  if (defender.team === attacker.team) return false
  if (opts?.incomingLethal) return false
  if (defender.stunTurns > 0 || opts?.incomingStun) return false
  if (isRangedOrSkill) return false
  if (attackArc !== 'front') return false
  if (defender.range !== 1) return false

  const aCol = opts?.attackerCol ?? attacker.col
  const aRow = opts?.attackerRow ?? attacker.row
  return manhattanDist(aCol, aRow, defender.col, defender.row) === 1
}

/**
 * Explains why an eligible melee defender (`defender.range === 1`) cannot counter-attack,
 * or returns `null` if the defender will counter or is not a melee counter-capable unit.
 */
export function getCounterAvoidReason(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'> | null | undefined,
  attacker: Pick<BattleUnit, 'team' | 'col' | 'row' | 'alive' | 'range'> | null | undefined,
  defender: Pick<BattleUnit, 'team' | 'col' | 'row' | 'alive' | 'stunTurns' | 'range'> | null | undefined,
  attackArc: AttackArc,
  isRangedOrSkill = false,
  opts?: CounterEligibilityOptions
): CounterAvoidReason {
  if (!battle || !attacker || !defender) return null
  if (!attacker.alive || !defender.alive) return null
  if (defender.team === attacker.team) return null
  if (defender.range !== 1) return null
  if (canCounterAttack(battle, attacker, defender, attackArc, isRangedOrSkill, opts)) return null

  if (opts?.incomingLethal) return 'lethal'
  if (defender.stunTurns > 0 || opts?.incomingStun) return 'stunned'

  const aCol = opts?.attackerCol ?? attacker.col
  const aRow = opts?.attackerRow ?? attacker.row
  if (isRangedOrSkill || manhattanDist(aCol, aRow, defender.col, defender.row) !== 1) return 'ranged'
  if (attackArc === 'back') return 'backstab'
  if (attackArc === 'flank') return 'flank'
  return null
}

/**
 * Computes deterministic counter-attack damage dealt by `defender` back to `attacker`.
 * Counter strikes deal 70% of the defender's normal frontal basic attack damage,
 * accounting for attacker DEF, shield, elevation, cover/terrain DEF, empower,
 * and attacker's facing toward defender.
 */
export function computeCounterDamage(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  defender: Pick<BattleUnit, 'col' | 'row' | 'atk' | 'empowerTurns'>,
  attacker: Pick<BattleUnit, 'col' | 'row' | 'facing' | 'def' | 'hp' | 'shield'>,
  opts?: CounterDamageOptions
): CounterDamageResult {
  const attCol = opts?.attackerCol ?? attacker.col
  const attRow = opts?.attackerRow ?? attacker.row
  const attHp = opts?.attackerHp ?? attacker.hp
  const attShield = opts?.attackerShield ?? attacker.shield
  const attFacing = opts?.attackerFacing ?? vectorToFacing(defender.col - attCol, defender.row - attRow, attacker.facing)

  let raw = defender.atk
  const defLvl = cellHeightAt(battle, defender.col, defender.row)
  const attLvl = cellHeightAt(battle, attCol, attRow)
  raw *= elevationMul(defLvl, attLvl)

  const counterArc = attackArcBetween(defender.col, defender.row, attCol, attRow, attFacing)
  raw *= arcDamageMultiplier(counterArc)

  if (defender.empowerTurns > 0) {
    raw *= 1.35
  }

  const attCell = battle.cells[attRow]?.[attCol]
  const terrainDef = attCell ? terrainDefBonus(attCell.terrain) : 0
  const coverBonus = opts?.coverBonus ?? 0
  const effDef = Math.max(0, attacker.def + terrainDef + coverBonus)

  const fullBasicDmg = Math.max(4, Math.round(raw - effDef * 0.72))
  const normalDmg = Math.max(COUNTER_MIN_DAMAGE, Math.round(fullBasicDmg * COUNTER_DAMAGE_MULTIPLIER))
  const shieldAbsorbed = Math.min(Math.max(0, attShield), normalDmg)
  const hpDamage = Math.max(0, normalDmg - shieldAbsorbed)
  const attackerHpAfter = Math.max(0, attHp - hpDamage)

  return {
    normalDmg,
    shieldAbsorbed,
    hpDamage,
    attackerHpAfter,
    lethalToAttacker: attackerHpAfter <= 0
  }
}
