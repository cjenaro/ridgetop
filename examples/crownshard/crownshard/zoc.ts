import { ENEMY_SPECS, HERO_SPECS } from './data.ts'
import { computeEndlessAttackerDamageMultiplier } from './endless-roguelite.ts'
import { getUnitPerimeterCells, isCellAdjacentToUnit } from './expansion-act2.ts'
import { mutatorDamageMultiplier } from './mutators.ts'
import {
  computeAttackerDamageMultiplier, computeBonusIgnoreArmor, computeShieldWallDefBonus
} from './passives.ts'
import {
  OPPORTUNITY_ATTACK_DAMAGE_MUL,
  cellHeightAt, facingVector, terrainDefBonus, terrainWalkable, vectorToFacing
} from './types.ts'
import type {
  AttackArc, BattleState, BattleUnit, FacingDir, GridCoord,
  OpportunityAttackTrigger, PathOpportunityPreview, ZocTileInfo
} from './types.ts'

/**
 * Zone of Control (ZoC) & Opportunity Attack (OA) rules — pure simulation module
 * with zero browser globals so it compiles cleanly to Godot GDScript and Node.
 *
 * Rules:
 * - Eligible frontline / melee / sentinel archetypes project a 4-way orthogonal
 *   Zone of Control when alive and NOT stunned:
 *   - Explicit `zoc?: boolean` on HeroSpec / EnemySpec takes precedence (e.g.
 *     Knight, Paladin, Champion for allies; Goblin, Ironclad Orc, Dread Knight,
 *     Frost Golem, Archon Malakor for enemies).
 *   - Ranged/support archetypes (Archer, Mage, Cleric, Cryomancer, Bone Archer,
 *     Eclipse Shaman) set `zoc: false` and never project ZoC.
 *   - Fallback for custom units without an explicit spec flag: `unit.range <= 1`.
 * - Nimble skirmishers with `evadeZoc: true` (Rogue / Kael) slip through enemy
 *   Zones of Control without provoking Opportunity Attacks.
 * - Entering a tile adjacent to a ZoC sentinel from outside does NOT provoke an OA.
 * - Leaving a tile orthogonally adjacent to an opposing ZoC sentinel provokes 1
 *   Opportunity Attack per sentinel per movement action, dealing 75% of basic
 *   melee strike damage (respecting armor, terrain DEF, elevation, Empower,
 *   facing/flank/backstab arc, and shield absorption).
 */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function elevationMultiplier(attackerLevel: number, defenderLevel: number): number {
  const diff = attackerLevel - defenderLevel
  if (diff >= 3) return 1.35
  if (diff === 2) return 1.28
  if (diff === 1) return 1.20
  if (diff <= -2) return 0.85
  if (diff === -1) return 0.92
  return 1.0
}

function attackArcFor(
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

/** True when `unit` currently projects a Zone of Control onto orthogonally adjacent tiles. */
export function hasZoneOfControl(
  unit: Pick<BattleUnit, 'alive' | 'stunTurns' | 'heroId' | 'enemyId' | 'range'>
): boolean {
  if (!unit.alive || unit.stunTurns > 0) return false
  if (unit.heroId) {
    const specZoc = HERO_SPECS[unit.heroId]?.zoc
    if (specZoc !== undefined) return specZoc
  }
  if (unit.enemyId) {
    const specZoc = ENEMY_SPECS[unit.enemyId]?.zoc
    if (specZoc !== undefined) return specZoc
  }
  return unit.range <= 1
}

/** True when `unit` has the nimble skirmisher trait (`evadeZoc`) that slips past enemy ZoC safely. */
export function canEvadeZoneOfControl(
  unit: Pick<BattleUnit, 'heroId' | 'enemyId'>
): boolean {
  if (unit.heroId && HERO_SPECS[unit.heroId]?.evadeZoc) return true
  if (unit.enemyId && ENEMY_SPECS[unit.enemyId]?.evadeZoc) return true
  return false
}

/** True when two grid coordinates are orthogonally adjacent (Manhattan distance === 1). */
export function isOrthogonallyAdjacent(c1: number, r1: number, c2: number, r2: number): boolean {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2) === 1
}

/** All opposing live, non-stunned ZoC sentinels orthogonally adjacent to `(col, row)`. */
export function getOpposingZocSentinelsAt(
  battle: Pick<BattleState, 'units'>,
  moverTeam: 'ally' | 'enemy',
  col: number,
  row: number
): BattleUnit[] {
  const out: BattleUnit[] = []
  for (const u of battle.units) {
    if (u.team === moverTeam) continue
    if (!hasZoneOfControl(u)) continue
    if (isCellAdjacentToUnit(u, col, row)) {
      out.push(u)
    }
  }
  return out
}

/**
 * All walkable, non-void tiles controlled by `controllingTeam`'s ZoC sentinels.
 * Used by scene/HUD overlays to subtly telegraph sentinel ZoC perimeters.
 */
export function computeZocPerimeterTiles(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  controllingTeam: 'ally' | 'enemy'
): ZocTileInfo[] {
  const byKey = new Map<string, { col: number; row: number; controllerUids: string[] }>()
  for (const u of battle.units) {
    if (u.team !== controllingTeam || !hasZoneOfControl(u)) continue
    const perim = getUnitPerimeterCells(battle, u)
    for (const p of perim) {
      const nc = p.col
      const nr = p.row
      const cell = battle.cells[nr]?.[nc]
      if (!cell || cell.terrain === 'void' || !terrainWalkable(cell.terrain)) continue
      const key = `${nc},${nr}`
      const existing = byKey.get(key)
      if (existing) {
        if (!existing.controllerUids.includes(u.uid)) existing.controllerUids.push(u.uid)
      } else {
        byKey.set(key, { col: nc, row: nr, controllerUids: [u.uid] })
      }
    }
  }
  return Array.from(byKey.values())
}

/**
 * Exact deterministic Opportunity Attack damage math (matches `applyDamage` with
 * `rawDamage = attacker.atk * OPPORTUNITY_ATTACK_DAMAGE_MUL`, `ignoreArmor = 0`, `canCrit = false`).
 */
export function computeOpportunityAttackDamage(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'> & Partial<Pick<BattleState, 'units' | 'mutators' | 'endlessBlessings'>>,
  attacker: Pick<BattleUnit, 'col' | 'row' | 'atk' | 'empowerTurns'> & Partial<Pick<BattleUnit, 'team' | 'heroId' | 'weaponId' | 'armorId' | 'relicId'>>,
  defender: Pick<BattleUnit, 'def' | 'shield'> & Partial<Pick<BattleUnit, 'uid' | 'team' | 'alive' | 'slowTurns' | 'burnTurns' | 'stunTurns' | 'isBoss'>>,
  defenderCol: number,
  defenderRow: number,
  defenderFacing: FacingDir,
  remainingShield = defender.shield
): {
  readonly damage: number
  readonly hpLoss: number
  readonly shieldAbsorbed: number
  readonly attackArc: AttackArc
} {
  let dmg = attacker.atk * OPPORTUNITY_ATTACK_DAMAGE_MUL
  const aLvl = cellHeightAt(battle, attacker.col, attacker.row)
  const dLvl = cellHeightAt(battle, defenderCol, defenderRow)
  dmg *= elevationMultiplier(aLvl, dLvl)
  const attackArc = attackArcFor(attacker.col, attacker.row, defenderCol, defenderRow, defenderFacing)
  dmg *= arcDamageMultiplier(attackArc)
  if (attacker.empowerTurns > 0) dmg *= 1.35
  dmg *= computeAttackerDamageMultiplier(attacker, {
    slowTurns: defender.slowTurns ?? 0,
    burnTurns: defender.burnTurns ?? 0,
    stunTurns: defender.stunTurns ?? 0,
    isBoss: Boolean(defender.isBoss)
  })
  dmg *= computeEndlessAttackerDamageMultiplier(
    battle.endlessBlessings,
    { team: attacker.team ?? 'enemy' },
    { slowTurns: defender.slowTurns ?? 0, stunTurns: defender.stunTurns ?? 0 }
  )
  dmg *= mutatorDamageMultiplier(battle)

  const cell = battle.cells[defenderRow]?.[defenderCol]
  const terrainDef = cell ? terrainDefBonus(cell.terrain) : 0
  const shieldWallDef = battle.units && defender.uid && defender.team
    ? computeShieldWallDefBonus(
        { units: battle.units },
        { uid: defender.uid, team: defender.team, col: defenderCol, row: defenderRow, alive: defender.alive ?? true }
      )
    : 0
  const bonusIgnoreArmor = clamp(computeBonusIgnoreArmor(attacker, defender.def), 0, 1)
  const effDef = Math.max(0, (defender.def + shieldWallDef) * (1 - bonusIgnoreArmor) + terrainDef)
  const damage = Math.max(4, Math.round(dmg - effDef * 0.72))
  const shieldPool = Math.max(0, remainingShield)
  const shieldAbsorbed = Math.min(shieldPool, damage)
  const hpLoss = damage - shieldAbsorbed
  return { damage, hpLoss, shieldAbsorbed, attackArc }
}

/**
 * Find opposing ZoC sentinels that will trigger an Opportunity Attack when `mover`
 * leaves `(fromCol, fromRow)`, excluding any sentinel that already struck during
 * this movement action.
 */
export function findStepOpportunityAttackers(
  battle: Pick<BattleState, 'units'>,
  mover: Pick<BattleUnit, 'alive' | 'team' | 'heroId' | 'enemyId'>,
  fromCol: number,
  fromRow: number,
  alreadyTriggered: ReadonlySet<string>
): BattleUnit[] {
  if (!mover.alive || canEvadeZoneOfControl(mover)) return []
  const sentinels = getOpposingZocSentinelsAt(battle, mover.team, fromCol, fromRow)
  if (sentinels.length === 0) return []
  const out: BattleUnit[] = []
  for (const s of sentinels) {
    if (!alreadyTriggered.has(s.uid)) out.push(s)
  }
  return out
}

/**
 * Pure move-path telegraph preview: simulates walking `path` from `(unit.col, unit.row)`
 * and returns every step index, sentinel attacker, and projected OA damage along the path.
 */
export function previewPathOpportunityAttacks(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'> & Partial<Pick<BattleState, 'mutators'>>,
  unit: BattleUnit,
  path: readonly GridCoord[]
): PathOpportunityPreview {
  if (!unit.alive || path.length === 0 || canEvadeZoneOfControl(unit)) {
    return { triggers: [], totalDamage: 0, totalHpLoss: 0, lethal: false }
  }

  const triggers: OpportunityAttackTrigger[] = []
  const triggered = new Set<string>()
  let curCol = unit.col
  let curRow = unit.row
  let simHp = unit.hp
  let simShield = unit.shield
  let simFacing: FacingDir = unit.facing
  let totalDamage = 0
  let totalHpLoss = 0

  for (let stepIndex = 0; stepIndex < path.length; stepIndex++) {
    const next = path[stepIndex]
    const stepFacing = vectorToFacing(next.col - curCol, next.row - curRow, simFacing)
    const attackers = findStepOpportunityAttackers(battle, unit, curCol, curRow, triggered)
    for (const attacker of attackers) {
      triggered.add(attacker.uid)
      const calc = computeOpportunityAttackDamage(battle, attacker, unit, curCol, curRow, stepFacing, simShield)
      simShield = Math.max(0, simShield - calc.shieldAbsorbed)
      simHp = Math.max(0, simHp - calc.hpLoss)
      totalDamage += calc.damage
      totalHpLoss += calc.hpLoss
      const lethal = simHp <= 0
      triggers.push({
        stepIndex,
        fromCol: curCol,
        fromRow: curRow,
        toCol: next.col,
        toRow: next.row,
        attackerUid: attacker.uid,
        attackerName: attacker.name,
        attackerCol: attacker.col,
        attackerRow: attacker.row,
        projectedDamage: calc.damage,
        projectedHpLoss: calc.hpLoss,
        attackArc: calc.attackArc,
        lethal
      })
      if (lethal) break
    }
    if (simHp <= 0) break
    curCol = next.col
    curRow = next.row
    simFacing = stepFacing
  }

  return {
    triggers,
    totalDamage,
    totalHpLoss,
    lethal: simHp <= 0 && triggers.length > 0
  }
}

/**
 * Score penalty applied by Enemy AI when a candidate movement path provokes ally
 * Opportunity Attacks. Strongly avoids lethal OAs and deters needless disengagement
 * unless securing a lethal strike or breaching a mission defend tile.
 */
export function computeAiOpportunityPenalty(
  preview: PathOpportunityPreview,
  isLethalTargetAttack: boolean,
  isObjectiveBreach: boolean
): number {
  if (preview.triggers.length === 0) return 0
  if (preview.lethal) {
    return isObjectiveBreach ? 90 : 260
  }
  const basePenalty = preview.totalHpLoss * 2.8 + preview.triggers.length * 16 + (preview.totalDamage - preview.totalHpLoss) * 0.6
  if (isObjectiveBreach) return Math.round(basePenalty * 0.35)
  if (isLethalTargetAttack) return Math.round(basePenalty * 0.45)
  return Math.round(clamp(basePenalty, 12, 220))
}

/** Concise HUD warning label for a path that provokes Opportunity Attacks. */
export function formatOpportunityWarning(preview: PathOpportunityPreview): string {
  if (preview.triggers.length === 0) return ''
  const countPrefix = preview.triggers.length > 1 ? ` x${preview.triggers.length}` : ''
  const dmgText = preview.totalHpLoss > 0
    ? `-${preview.totalHpLoss} HP`
    : `BLOCKED ${preview.totalDamage}`
  const lethalSuffix = preview.lethal ? ' · LETHAL!' : ''
  return `⚠ OPPORTUNITY ATTACK${countPrefix} (${dmgText}${lethalSuffix})`
}
