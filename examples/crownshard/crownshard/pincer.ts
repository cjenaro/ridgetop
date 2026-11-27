import { computeEndlessAttackerDamageMultiplier } from './endless-roguelite.ts'
import { closestFootprintCell, getUnitFootprintSize } from './expansion-act2.ts'
import { computePincerPairBondMultiplier, computeUnitBondAssist } from './hero-bonds.ts'
import { mutatorDamageMultiplier } from './mutators.ts'
import { cellHeightAt, terrainDefBonus } from './types.ts'
import type { BattleState, BattleUnit, SkillSpec } from './types.ts'

export const PINCER_DAMAGE_RATIO = 0.5
export const PINCER_MIN_DAMAGE = 4

function manhattan(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

function pincerElevationMultiplier(attackerLevel: number, defenderLevel: number): number {
  const diff = attackerLevel - defenderLevel
  if (diff >= 3) return 1.35
  if (diff === 2) return 1.28
  if (diff === 1) return 1.2
  if (diff === -1) return 0.92
  if (diff <= -2) return 0.85
  return 1.0
}

/**
 * Single-target adjacent melee skills (e.g. Shield Bash, Radiant Smite) qualify
 * to trigger a Pincer / Follow-Up assist strike alongside basic adjacent attacks.
 */
export function isPincerMeleeSkill(skill: SkillSpec): boolean {
  return skill.target === 'enemy' && skill.pattern === 'single' && skill.powerMul > 0 && skill.range <= 1
}

/**
 * Find qualifying Pincer / Follow-Up assisters for an attack originating at
 * `(attackerCol, attackerRow)` against `target`.
 *
 * Rules:
 * - Attack must be an adjacent melee strike (`manhattan === 1`) against an opposing team unit.
 * - Opposite tile directly across `target` is `(target.col + (target.col - attackerCol), target.row + (target.row - attackerRow))`.
 * - Any living, non-stunned teammate of `attacker` standing on that opposite tile whose
 *   elevation difference to `target` is within `Math.max(1, u.jump)` qualifies as a Pincer Assister.
 * - Symmetrical: works both for player heroes flanking an enemy and enemies pincering a hero.
 */
export function findPincerAssisters(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  attacker: Pick<BattleUnit, 'uid' | 'team' | 'alive'>,
  attackerCol: number,
  attackerRow: number,
  target: Pick<BattleUnit, 'uid' | 'team' | 'col' | 'row' | 'alive'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>
): BattleUnit[] {
  if (!attacker.alive || !target.alive) return []
  if (attacker.team === target.team) return []
  const hitCell = closestFootprintCell(attackerCol, attackerRow, target)
  if (manhattan(attackerCol, attackerRow, hitCell.col, hitCell.row) !== 1) return []

  const fpSize = getUnitFootprintSize(target)
  const stepCol = hitCell.col - attackerCol
  const stepRow = hitCell.row - attackerRow
  const oppCol = hitCell.col + stepCol * fpSize
  const oppRow = hitCell.row + stepRow * fpSize
  if (oppCol < 0 || oppCol >= battle.cols || oppRow < 0 || oppRow >= battle.rows) return []

  const targetHeight = cellHeightAt(battle, hitCell.col, hitCell.row)
  const assisters: BattleUnit[] = []
  for (const u of battle.units) {
    if (u.team !== attacker.team || u.uid === attacker.uid || !u.alive || u.stunTurns > 0) continue
    if (u.col !== oppCol || u.row !== oppRow) continue
    const assisterHeight = cellHeightAt(battle, u.col, u.row)
    if (Math.abs(assisterHeight - targetHeight) > Math.max(1, u.jump)) continue
    assisters.push(u)
  }
  return assisters
}

/**
 * Compute bonus Pincer Follow-Up strike damage: 50% of the assister's basic attack
 * damage accounting for elevation, empower, and target DEF + terrain DEF (minimum 4 DMG).
 */
export function computePincerAssistDamage(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'> & Partial<Pick<BattleState, 'units' | 'mutators' | 'endlessBlessings' | 'bondPairsActive'>>,
  assister: Pick<BattleUnit, 'col' | 'row' | 'atk' | 'empowerTurns'> & Partial<Pick<BattleUnit, 'uid' | 'team' | 'alive' | 'heroId' | 'downed'>>,
  target: Pick<BattleUnit, 'col' | 'row' | 'def'> & Partial<Pick<BattleUnit, 'uid' | 'team' | 'alive' | 'heroId' | 'downed' | 'slowTurns' | 'stunTurns'>>,
  attacker?: (Pick<BattleUnit, 'team'> & Partial<Pick<BattleUnit, 'uid' | 'col' | 'row' | 'heroId'>>) | null,
  opts?: { readonly attackerCol?: number; readonly attackerRow?: number }
): number {
  let dmg = assister.atk
  const aLvl = cellHeightAt(battle, assister.col, assister.row)
  const dLvl = cellHeightAt(battle, target.col, target.row)
  dmg *= pincerElevationMultiplier(aLvl, dLvl)
  if (assister.empowerTurns > 0) dmg *= 1.35
  dmg *= computeEndlessAttackerDamageMultiplier(
    battle.endlessBlessings,
    { team: assister.team ?? 'enemy' },
    { slowTurns: target.slowTurns ?? 0, stunTurns: target.stunTurns ?? 0 }
  )
  dmg *= mutatorDamageMultiplier(battle)
  const overrideCol = opts?.attackerCol
  const overrideRow = opts?.attackerRow
  const unitsForBond = battle.units
    ? (attacker?.uid && overrideCol !== undefined && overrideRow !== undefined
        ? battle.units.map(u =>
            u.uid === attacker.uid
              ? { ...u, col: overrideCol, row: overrideRow }
              : u
          )
        : battle.units)
    : undefined
  if (unitsForBond && assister.uid && assister.team) {
    const assisterBond = computeUnitBondAssist(
      { units: unitsForBond, bondPairsActive: battle.bondPairsActive },
      {
        uid: assister.uid,
        team: assister.team,
        col: assister.col,
        row: assister.row,
        alive: assister.alive ?? true,
        heroId: assister.heroId,
        downed: assister.downed
      }
    )
    if (assisterBond.active) dmg *= assisterBond.atkMul
  }

  const cell = battle.cells[target.row]?.[target.col]
  const terrainDef = cell ? terrainDefBonus(cell.terrain) : 0
  let bondedTargetDef = target.def
  if (unitsForBond && target.uid && target.team) {
    const targetBond = computeUnitBondAssist(
      { units: unitsForBond, bondPairsActive: battle.bondPairsActive },
      {
        uid: target.uid,
        team: target.team,
        col: target.col,
        row: target.row,
        alive: target.alive ?? true,
        heroId: target.heroId,
        downed: target.downed
      }
    )
    if (targetBond.active) bondedTargetDef *= targetBond.defMul
  }
  const effDef = Math.max(0, bondedTargetDef + terrainDef)
  const basicDmg = Math.max(PINCER_MIN_DAMAGE, Math.round(dmg - effDef * 0.72))
  const pincerBondMul = computePincerPairBondMultiplier(
    battle,
    attacker,
    assister.team ? { team: assister.team, heroId: assister.heroId } : null
  )
  return Math.max(PINCER_MIN_DAMAGE, Math.round(basicDmg * PINCER_DAMAGE_RATIO * pincerBondMul))
}
