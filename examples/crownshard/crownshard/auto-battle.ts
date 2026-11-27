import { canCounterAttack, computeCounterDamage, isMeleeSkillEligibleForCounter } from './counter-attack.ts'
import { HERO_SPECS, TACTIC_BY_ID } from './data.ts'
import { classifyElement, previewElementalCombo } from './elemental-combos.ts'
import { computeEndlessAttackerDamageMultiplier } from './endless-roguelite.ts'
import { closestFootprintCell, getUnitFootprintCells, unitOccupiesCell } from './expansion-act2.ts'
import { isEnemyShrouded, mutatorDamageMultiplier } from './mutators.ts'
import {
  adjustCoverBonusForAttacker,
  computeAttackerDamageMultiplier,
  computeBonusIgnoreArmor,
  computeDefenderIncomingDamageMultiplier,
  computePassiveRangeBonus,
  computeShieldWallDefBonus,
  unitTerrainMoveCost
} from './passives.ts'
import { computePincerAssistDamage, findPincerAssisters, isPincerMeleeSkill } from './pincer.ts'
import {
  BARRICADE_DEFAULT_HP,
  FACING_DIRS,
  TALL_GRASS_RANGED_COVER,
  TAUNT_RADIUS,
  cellHeightAt,
  cellHeightLevel,
  facingVector,
  isUnitDowned,
  terrainDefBonus
} from './types.ts'
import type {
  AttackArc,
  BattleSpeedMultiplier,
  BattleState,
  BattleUnit,
  FacingDir,
  GameState,
  GridCell,
  GridCoord,
  PathOpportunityPreview,
  SkillSpec,
  TacticCardSpec
} from './types.ts'
import {
  canEvadeZoneOfControl,
  computeAiOpportunityPenalty,
  getOpposingZocSentinelsAt,
  previewPathOpportunityAttacks
} from './zoc.ts'

/**
 * Crownshard Battle Speed & Auto-Battle tactical planner — pure simulation module
 * with zero browser globals so it compiles cleanly to Godot GDScript and Node.
 */

export const DEFAULT_BATTLE_SPEED: BattleSpeedMultiplier = 1
export const AUTO_BATTLE_THINK_DELAY = 0.24
export const AUTO_BATTLE_POST_ACT_DELAY = 0.20

export type AutoBattleActionKind =
  | 'tactic'
  | 'skill'
  | 'move_and_skill'
  | 'attack'
  | 'move_and_attack'
  | 'move'
  | 'end_turn'

export interface AutoBattleActionPlan {
  readonly kind: AutoBattleActionKind
  readonly actorUid: string
  readonly score: number
  readonly reason: string
  readonly moveTo?: GridCoord
  readonly targetCol?: number
  readonly targetRow?: number
  readonly skillIndex?: number
  readonly tacticUid?: string
  readonly facing?: FacingDir
}

/** Normalize persisted or external battle speed values to 1 | 2. */
export function normalizeBattleSpeed(raw: unknown): BattleSpeedMultiplier {
  return raw === 2 ? 2 : 1
}

/** Cycle battle speed between 1x and 2x. */
export function nextBattleSpeed(current: BattleSpeedMultiplier): BattleSpeedMultiplier {
  return current === 2 ? 1 : 2
}

/** Scale a sanitized positive timestep by the active battle speed multiplier. */
export function scaleBattleDt(dt: number, speed: BattleSpeedMultiplier): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0
  return dt * (speed === 2 ? 2 : 1)
}

/** Short HUD label for battle speed multiplier ('1x' | '2x'). */
export function formatBattleSpeedLabel(speed: BattleSpeedMultiplier): string {
  return speed === 2 ? '2x' : '1x'
}

// ===========================================================================
// Pure Grid, Line-of-Sight, Arc, and Traversal Helpers
// ===========================================================================

function manhattan(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

function inBounds(col: number, row: number, cols: number, rows: number): boolean {
  return col >= 0 && col < cols && row >= 0 && row < rows
}

function isIntactBarricadeCell(cell: GridCell | undefined): boolean {
  return Boolean(
    cell && cell.terrain === 'barricade' && !cell.walkable && (cell.barricadeHp ?? BARRICADE_DEFAULT_HP) > 0
  )
}

function activeUnitAt(battle: BattleState, col: number, row: number): BattleUnit | undefined {
  return battle.units.find(u => u.alive && unitOccupiesCell(u, col, row))
}

function downedAllyAt(battle: BattleState, col: number, row: number): BattleUnit | undefined {
  return battle.units.find(u => isUnitDowned(u) && u.col === col && u.row === row)
}

function unitOrDownedAtCell(battle: BattleState, col: number, row: number): BattleUnit | undefined {
  return battle.units.find(u => (u.alive || isUnitDowned(u)) && unitOccupiesCell(u, col, row))
}

function canStepBetween(fromCell: GridCell, toCell: GridCell, jump: number): boolean {
  if (!toCell.walkable) return false
  const diff = Math.abs(cellHeightLevel(toCell) - cellHeightLevel(fromCell))
  const isRamp = fromCell.terrain === 'stairs' || toCell.terrain === 'stairs'
  return diff <= (isRamp ? jump + 1 : jump)
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

function attackArc(
  attackerCol: number,
  attackerRow: number,
  defenderCol: number,
  defenderRow: number,
  defenderFacing: FacingDir
): AttackArc {
  const vc = attackerCol - defenderCol
  const vr = attackerRow - defenderRow
  if (vc === 0 && vr === 0) return 'front'
  const [fc, fr] = facingVector(defenderFacing)
  const dot = vc * fc + vr * fr
  const cross = Math.abs(vc * fr - vr * fc)
  if (dot > 0 && dot >= cross) return 'front'
  if (dot < 0 && -dot >= cross) return 'back'
  return 'flank'
}

function arcDmgMul(arc: AttackArc): number {
  if (arc === 'back') return 1.3
  if (arc === 'flank') return 1.15
  return 1.0
}

function effectiveRange(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  baseRange: number,
  attacker?: Partial<Pick<BattleUnit, 'heroId'>> | null
): number {
  if (baseRange <= 1) return baseRange
  const attackerLvl = cellHeightAt(battle, fromCol, fromRow)
  const diff = attackerLvl - cellHeightAt(battle, toCol, toRow)
  let eff = baseRange
  if (diff >= 1) eff += 1
  else if (diff <= -2) eff = Math.max(1, eff - 1)
  eff += computePassiveRangeBonus(attacker, attackerLvl, baseRange)
  return eff
}

function isSkillIndirect(skill: SkillSpec | null): boolean {
  if (!skill) return false
  if (skill.target === 'self' || skill.target === 'ally') return true
  if (skill.pattern === 'area3' || skill.pattern === 'cross' || skill.pattern === 'aura' || skill.pattern === 'self') {
    return true
  }
  return skill.id === 'shadowstep' || skill.id === 'phantom_exec'
}

function hasClearLoS(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  indirect = false
): boolean {
  if (indirect) return true
  const dx = toCol - fromCol
  const dy = toRow - fromRow
  if (Math.abs(dx) + Math.abs(dy) <= 1) return true

  const eyeH = cellHeightAt(battle, fromCol, fromRow) + 1.0
  const targetH = cellHeightAt(battle, toCol, toRow) + 0.8

  const blocks = (col: number, row: number, t: number): boolean => {
    if (!inBounds(col, row, battle.cols, battle.rows)) return false
    const cell = battle.cells[row][col]
    if (!cell || cell.terrain === 'void') return false
    const sightH = eyeH * (1 - t) + targetH * t
    const lvl = cellHeightLevel(cell)
    if (cell.terrain === 'pillar') return lvl + 2.5 > sightH
    if (isIntactBarricadeCell(cell)) return lvl + 1.8 > sightH
    return lvl > sightH + 0.05
  }

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity
  let tMaxX = dx !== 0 ? 0.5 * tDeltaX : Infinity
  let tMaxY = dy !== 0 ? 0.5 * tDeltaY : Infinity
  let cx = fromCol
  let cy = fromRow
  let tPrev = 0
  let guard = 0

  while ((cx !== toCol || cy !== toRow) && guard++ < 64) {
    if (Math.abs(tMaxX - tMaxY) < 1e-6) {
      const tCorner = Math.min(1, tMaxX)
      if (blocks(cx + stepX, cy, tCorner) && blocks(cx, cy + stepY, tCorner)) return false
      tPrev = tCorner
      cx += stepX
      cy += stepY
      tMaxX += tDeltaX
      tMaxY += tDeltaY
    } else if (tMaxX < tMaxY) {
      tPrev = Math.min(1, tMaxX)
      cx += stepX
      tMaxX += tDeltaX
    } else {
      tPrev = Math.min(1, tMaxY)
      cy += stepY
      tMaxY += tDeltaY
    }
    if (cx === toCol && cy === toRow) break
    const tNext = Math.min(tMaxX, tMaxY, 1)
    const tMid = (tPrev + tNext) * 0.5
    if (blocks(cx, cy, tMid)) return false
  }
  return true
}

function coverBonusFor(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  attacker?: Partial<Pick<BattleUnit, 'heroId' | 'weaponId' | 'armorId' | 'relicId'>> | null
): number {
  const dist = manhattan(fromCol, fromRow, toCol, toRow)
  if (dist < 2) return 0
  const ac = fromCol - toCol
  const ar = fromRow - toRow
  const defCell = inBounds(toCol, toRow, battle.cols, battle.rows) ? battle.cells[toRow][toCol] : undefined
  const defLvl = cellHeightAt(battle, toCol, toRow)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  let best = defCell?.terrain === 'tall_grass' ? TALL_GRASS_RANGED_COVER : 0
  for (const [dc, dr] of dirs) {
    const nc = toCol + dc
    const nr = toRow + dr
    if (!inBounds(nc, nr, battle.cols, battle.rows)) continue
    const neighbor = battle.cells[nr][nc]
    if (!neighbor || neighbor.terrain === 'void') continue
    const isWall = neighbor.terrain === 'pillar' || isIntactBarricadeCell(neighbor)
    const isCliff = !isWall && cellHeightLevel(neighbor) >= defLvl + 2
    if (!isWall && !isCliff) continue
    if (ac * dc + ar * dr > 0) best = Math.max(best, 4)
    else if (isWall) best = Math.max(best, 2)
  }
  return adjustCoverBonusForAttacker(best, attacker, cellHeightAt(battle, fromCol, fromRow))
}

function patternCoords(
  centerCol: number,
  centerRow: number,
  pattern: SkillSpec['pattern'] | TacticCardSpec['pattern'],
  cols: number,
  rows: number
): GridCoord[] {
  const out: GridCoord[] = []
  const push = (c: number, r: number) => {
    if (inBounds(c, r, cols, rows)) out.push({ col: c, row: r })
  }
  if (pattern === 'single' || pattern === 'self') {
    push(centerCol, centerRow)
  } else if (pattern === 'cross' || pattern === 'aura') {
    push(centerCol, centerRow)
    push(centerCol + 1, centerRow)
    push(centerCol - 1, centerRow)
    push(centerCol, centerRow + 1)
    push(centerCol, centerRow - 1)
  } else if (pattern === 'area3') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) push(centerCol + dc, centerRow + dr)
    }
  } else {
    push(centerCol, centerRow)
  }
  return out
}

function getUnlockedSkill(unit: BattleUnit, skillIndex: number): SkillSpec | null {
  if (!unit.heroId || skillIndex < 0 || skillIndex > 2) return null
  const spec = HERO_SPECS[unit.heroId]
  const skill = spec.skills[skillIndex]
  if (!skill || skill.tier > unit.stars) return null
  return skill
}

interface ReachableStand {
  readonly col: number
  readonly row: number
  readonly requiresMove: boolean
  readonly path: readonly GridCoord[]
  readonly oaPreview: PathOpportunityPreview
  readonly oaDamage: number
  readonly oaLethal: boolean
  readonly oaPenalty: number
  readonly terrainScore: number
}

const EMPTY_OA_PREVIEW: PathOpportunityPreview = {
  triggers: [],
  totalDamage: 0,
  totalHpLoss: 0,
  lethal: false
}

function computeReachableStands(battle: BattleState, actor: BattleUnit): ReachableStand[] {
  const stands: ReachableStand[] = [{
    col: actor.col,
    row: actor.row,
    requiresMove: false,
    path: [],
    oaPreview: EMPTY_OA_PREVIEW,
    oaDamage: 0,
    oaLethal: false,
    oaPenalty: 0,
    terrainScore: scoreTilePosition(battle, actor, actor.col, actor.row)
  }]
  if (actor.moved || actor.stunTurns > 0) return stands

  const maxMove = Math.max(1, actor.move - (actor.slowTurns > 0 ? 1 : 0))
  const ignoreZoc = canEvadeZoneOfControl(actor)
  const startKey = `${actor.col},${actor.row},0`
  const parent = new Map<string, { col: number; row: number; prevKey: string } | null>()
  const distMap = new Map<string, { dist: number; steps: number; oaRisk: number }>()
  const bestPosKey = new Map<string, { key: string; dist: number; steps: number; oaRisk: number }>()
  const queue: { col: number; row: number; dist: number; steps: number; oaRisk: number; glided: 0 | 1 }[] = [
    { col: actor.col, row: actor.row, dist: 0, steps: 0, oaRisk: 0, glided: 0 }
  ]
  parent.set(startKey, null)
  distMap.set(startKey, { dist: 0, steps: 0, oaRisk: 0 })
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

  const better = (
    aDist: number,
    aSteps: number,
    aRisk: number,
    bDist: number,
    bSteps: number,
    bRisk: number
  ): boolean => {
    if (aDist !== bDist) return aDist < bDist
    if (aSteps !== bSteps) return aSteps < bSteps
    return aRisk < bRisk
  }

  while (queue.length > 0) {
    let bestIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (better(
        queue[i].dist, queue[i].steps, queue[i].oaRisk,
        queue[bestIdx].dist, queue[bestIdx].steps, queue[bestIdx].oaRisk
      )) {
        bestIdx = i
      }
    }
    const cur = queue.splice(bestIdx, 1)[0]
    if (!cur) break
    const curKey = `${cur.col},${cur.row},${cur.glided}`
    const curBest = distMap.get(curKey)
    if (curBest && better(curBest.dist, curBest.steps, curBest.oaRisk, cur.dist, cur.steps, cur.oaRisk)) {
      continue
    }

    if (cur.steps > 0 && !unitOrDownedAtCell(battle, cur.col, cur.row)) {
      const posKey = `${cur.col},${cur.row}`
      const prevBest = bestPosKey.get(posKey)
      if (!prevBest || better(cur.dist, cur.steps, cur.oaRisk, prevBest.dist, prevBest.steps, prevBest.oaRisk)) {
        bestPosKey.set(posKey, { key: curKey, dist: cur.dist, steps: cur.steps, oaRisk: cur.oaRisk })
      }
    }

    const fromCell = battle.cells[cur.row][cur.col]
    const leavingRisk = ignoreZoc ? 0 : getOpposingZocSentinelsAt(battle, actor.team, cur.col, cur.row).length
    for (const [dc, dr] of dirs) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      if (!inBounds(nc, nr, battle.cols, battle.rows)) continue
      const cell = battle.cells[nr][nc]
      if (!canStepBetween(fromCell, cell, actor.jump)) continue
      const occ = unitOrDownedAtCell(battle, nc, nr)
      if (occ && occ.team !== actor.team) continue
      const baseCost = unitTerrainMoveCost(actor, cell.terrain)
      const canGlide = cur.glided === 0 && (cell.terrain === 'ice' || fromCell.terrain === 'ice')
      const stepCost = canGlide ? Math.max(0, baseCost - 1) : baseCost
      const nextGlided: 0 | 1 = canGlide ? 1 : cur.glided
      const nextDist = cur.dist + stepCost
      const nextSteps = cur.steps + 1
      const nextRisk = cur.oaRisk + leavingRisk
      if (nextDist > maxMove) continue
      const key = `${nc},${nr},${nextGlided}`
      const prev = distMap.get(key)
      if (!prev || better(nextDist, nextSteps, nextRisk, prev.dist, prev.steps, prev.oaRisk)) {
        parent.set(key, { col: cur.col, row: cur.row, prevKey: curKey })
        distMap.set(key, { dist: nextDist, steps: nextSteps, oaRisk: nextRisk })
        queue.push({ col: nc, row: nr, dist: nextDist, steps: nextSteps, oaRisk: nextRisk, glided: nextGlided })
      }
    }
  }

  for (const [posKey, entry] of bestPosKey.entries()) {
    const parts = posKey.split(',')
    const col = Number(parts[0])
    const row = Number(parts[1])
    const path: GridCoord[] = []
    let ck: string | null = entry.key
    let cc = col
    let cr = row
    while (ck) {
      if (cc === actor.col && cr === actor.row) break
      path.push({ col: cc, row: cr })
      const p: { col: number; row: number; prevKey: string } | null = parent.get(ck) ?? null
      if (!p) break
      cc = p.col
      cr = p.row
      ck = p.prevKey
    }
    path.reverse()
    if (path.length === 0) continue

    const oa = previewPathOpportunityAttacks(battle, actor, path)
    const oaPenalty = oa.triggers.length > 0 ? computeAiOpportunityPenalty(oa, false, false) : 0
    stands.push({
      col,
      row,
      requiresMove: true,
      path,
      oaPreview: oa,
      oaDamage: oa.totalHpLoss,
      oaLethal: oa.lethal,
      oaPenalty,
      terrainScore: scoreTilePosition(battle, actor, col, row)
    })
  }

  return stands
}

function isUnclaimedChest(battle: BattleState, col: number, row: number): boolean {
  const obj = battle.objective
  if (!obj.chestTiles.some(c => c.col === col && c.row === row)) return false
  return !obj.claimedChests.some(c => c.col === col && c.row === row)
}

function getUnclaimedChests(battle: BattleState): GridCoord[] {
  return battle.objective.chestTiles.filter(
    c => !battle.objective.claimedChests.some(cl => cl.col === c.col && cl.row === c.row)
  )
}

function scoreTilePosition(battle: BattleState, actor: BattleUnit, col: number, row: number): number {
  const cell = battle.cells[row]?.[col]
  if (!cell) return -999
  const elev = cellHeightLevel(cell)
  let score = elev * (actor.range >= 2 ? 7 : 5) + terrainDefBonus(cell.terrain) * 3
  if (cell.terrain === 'tall_grass') score += actor.range >= 2 ? 6 : 4
  if (cell.terrain === 'shrine' && actor.hp < actor.maxHp) score += 18
  if (cell.terrain === 'lava_geyser' && cell.geyserActive) score -= 52
  if (cell.terrain === 'cursed_altar' && !cell.altarUsed) {
    // Only worth the dark pact HP drain if hero is healthy
    score += actor.hp > actor.maxHp * 0.65 ? 8 : -24
  }
  if (isUnclaimedChest(battle, col, row)) score += 140
  if (
    battle.objective.kind === 'seize' &&
    battle.objective.goalTile &&
    battle.objective.goalTile.col === col &&
    battle.objective.goalTile.row === row &&
    battle.objective.claimedChests.length >= battle.objective.requiredChests
  ) {
    score += 420
  }
  return score
}

/** BFS shortest walkable step distance from a goal tile across passable terrain (ignores dynamic unit congestion). */
function computeDistanceFieldToGoals(
  battle: BattleState,
  actor: BattleUnit,
  goals: readonly GridCoord[]
): Map<string, number> {
  const dist = new Map<string, number>()
  const queue: { col: number; row: number; d: number }[] = []
  for (const g of goals) {
    if (!inBounds(g.col, g.row, battle.cols, battle.rows)) continue
    const k = `${g.col},${g.row}`
    if (!dist.has(k)) {
      dist.set(k, 0)
      queue.push({ col: g.col, row: g.row, d: 0 })
    }
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    const curCell = battle.cells[cur.row][cur.col]
    for (const [dc, dr] of dirs) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      if (!inBounds(nc, nr, battle.cols, battle.rows)) continue
      const nextCell = battle.cells[nr][nc]
      if (!canStepBetween(nextCell, curCell, actor.jump)) continue
      const k = `${nc},${nr}`
      const nd = cur.d + unitTerrainMoveCost(actor, nextCell.terrain)
      const prev = dist.get(k)
      if (prev === undefined || nd < prev) {
        dist.set(k, nd)
        queue.push({ col: nc, row: nr, d: nd })
      }
    }
  }
  return dist
}

// ===========================================================================
// Taunt & Optimal Turn-End Facing
// ===========================================================================

/** Alive opposing enemies whose Taunt forces `actor` to prioritize targeting them. */
export function findAutoBattleProvokingTaunters(
  battle: BattleState,
  actor: BattleUnit
): BattleUnit[] {
  const moveBudget = Math.max(1, actor.move - (actor.slowTurns > 0 ? 1 : 0))
  const reachRadius = Math.max(TAUNT_RADIUS, moveBudget + actor.range)
  return battle.units.filter(
    u =>
      u.alive &&
      u.team !== actor.team &&
      u.tauntTurns > 0 &&
      !(actor.team === 'ally' && isEnemyShrouded(battle, u)) &&
      manhattan(actor.col, actor.row, u.col, u.row) <= reachRadius
  )
}

/**
 * Choose the optimal cardinal facing at turn end against all alive opposing units,
 * minimizing backstab and flank exposure while facing the nearest/highest-threat opponent.
 */
export function chooseBestTurnEndFacing(battle: BattleState, unit: BattleUnit): FacingDir {
  if (!unit.alive) return unit.facing
  const allOpponents = battle.units.filter(u => u.alive && u.team !== unit.team)
  const visibleOpponents = unit.team === 'ally'
    ? allOpponents.filter(u => !isEnemyShrouded(battle, u))
    : allOpponents
  const opponents = visibleOpponents.length > 0 ? visibleOpponents : allOpponents
  if (opponents.length === 0) return unit.facing

  const weighted = opponents.map(opp => {
    const dist = Math.max(1, manhattan(opp.col, opp.row, unit.col, unit.row))
    const effR = effectiveRange(battle, opp.col, opp.row, unit.col, unit.row, opp.range, opp)
    const inRangeNow = opp.stunTurns === 0 && dist <= effR && (opp.isBoss || hasClearLoS(battle, opp.col, opp.row, unit.col, unit.row, false))
    const oppMove = Math.max(1, opp.move - (opp.slowTurns > 0 ? 1 : 0))
    const canReachNextTurn = opp.stunTurns === 0 && (inRangeNow || dist <= oppMove + opp.range + 1)
    const atkPower = opp.atk * (opp.empowerTurns > 0 ? 1.25 : 1.0) * (1 + opp.crit * 0.5)
    const reachMul = inRangeNow ? 3.2 : canReachNextTurn ? 1.8 : 0.65
    const stunMul = opp.stunTurns > 0 ? 0.35 : 1.0
    const weight = (atkPower * reachMul * stunMul) / (dist + 0.5)
    const vc = opp.col - unit.col
    const vr = opp.row - unit.row
    const norm = Math.hypot(vc, vr) || 1
    return { opp, weight, nx: vc / norm, nz: vr / norm }
  })

  let bestDir: FacingDir = unit.facing
  let bestScore = -Infinity
  for (const dir of FACING_DIRS) {
    const [fc, fr] = facingVector(dir)
    let score = dir === unit.facing ? 0.01 : 0
    for (const item of weighted) {
      const arc = attackArc(item.opp.col, item.opp.row, unit.col, unit.row, dir)
      if (arc === 'back') score -= 100 * item.weight
      else if (arc === 'flank') score -= 35 * item.weight
      else score += 15 * item.weight
      const align = item.nx * fc + item.nz * fr
      score += align * 12 * item.weight
    }
    if (score > bestScore) {
      bestScore = score
      bestDir = dir
    }
  }
  return bestDir
}

// ===========================================================================
// Damage & Tactical Value Estimation
// ===========================================================================

function estimateStrikeDamage(
  battle: BattleState,
  attacker: BattleUnit,
  fromCol: number,
  fromRow: number,
  target: BattleUnit,
  rawPower: number,
  ignoreArmor: number,
  isSkill: boolean,
  isRangedOrIndirect: boolean
): { readonly damage: number; readonly arc: AttackArc; readonly lethal: boolean } {
  const defCell = battle.cells[target.row][target.col]
  const attackerLvl = cellHeightAt(battle, fromCol, fromRow)
  const targetLvl = cellHeightAt(battle, target.col, target.row)
  const elevMul = elevationMul(attackerLvl, targetLvl)
  const arc = attackArc(fromCol, fromRow, target.col, target.row, target.facing)
  const aMul = arcDmgMul(arc)
  const cover = isRangedOrIndirect ? coverBonusFor(battle, fromCol, fromRow, target.col, target.row, attacker) : 0
  const totalIgnore = Math.min(1, ignoreArmor + computeBonusIgnoreArmor(attacker, target.def))
  const effDef = Math.max(
    0,
    (target.def + computeShieldWallDefBonus(battle, target)) * (1 - totalIgnore) +
      terrainDefBonus(defCell.terrain) +
      cover
  )
  const empowerMul = attacker.empowerTurns > 0 ? 1.35 : 1.0
  const passiveAtkMul = computeAttackerDamageMultiplier(attacker, target)
  const endlessMul = computeEndlessAttackerDamageMultiplier(battle.endlessBlessings, attacker, target)
  const mutMul = mutatorDamageMultiplier(battle)
  const passiveDefMul = computeDefenderIncomingDamageMultiplier(target, isSkill)
  const dmg = Math.max(
    4,
    Math.round((rawPower * empowerMul * elevMul * aMul * passiveAtkMul * endlessMul * mutMul - effDef * 0.72) * passiveDefMul)
  )
  return {
    damage: dmg,
    arc,
    lethal: dmg >= target.hp + target.shield
  }
}

function objectiveTargetPriorityBonus(battle: BattleState, enemy: BattleUnit): number {
  let bonus = 0
  const obj = battle.objective
  if (obj.kind === 'assassinate' && obj.targetEnemyUid === enemy.uid) {
    bonus += 85
  }
  if (enemy.isBoss) bonus += 24
  if (obj.kind === 'defend' && obj.protectTile) {
    const d = manhattan(enemy.col, enemy.row, obj.protectTile.col, obj.protectTile.row)
    if (d <= 2) bonus += 60
    else if (d <= 4) bonus += 28
  }
  return bonus
}

function estimateCounterPenalty(
  battle: BattleState,
  actor: BattleUnit,
  fromCol: number,
  fromRow: number,
  target: BattleUnit,
  arc: AttackArc,
  isSkill: boolean,
  skill: SkillSpec | null,
  lethal: boolean
): number {
  if (lethal) return 0
  if (isSkill && skill && !isMeleeSkillEligibleForCounter(skill)) return 0
  const dist = manhattan(fromCol, fromRow, target.col, target.row)
  if (dist !== 1) return 0
  if (!canCounterAttack(battle, actor, target, arc, false, { attackerCol: fromCol, attackerRow: fromRow })) return 0
  const counter = computeCounterDamage(battle, target, actor, { attackerCol: fromCol, attackerRow: fromRow })
  if (counter.lethalToAttacker) return 110
  return Math.round(counter.hpDamage * 1.15)
}

function estimatePincerBonus(
  battle: BattleState,
  actor: BattleUnit,
  fromCol: number,
  fromRow: number,
  target: BattleUnit,
  skill: SkillSpec | null
): number {
  if (skill && !isPincerMeleeSkill(skill)) return 0
  if (!skill && actor.range > 1) return 0
  if (manhattan(fromCol, fromRow, target.col, target.row) !== 1) return 0
  const assisters = findPincerAssisters(battle, actor, fromCol, fromRow, target)
  if (assisters.length === 0) return 0
  return computePincerAssistDamage(battle, assisters[0], target)
}

function scoreOffensiveSkillOnCell(
  battle: BattleState,
  actor: BattleUnit,
  stand: ReachableStand,
  skill: SkillSpec,
  targetCol: number,
  targetRow: number,
  provokingTaunters: readonly BattleUnit[]
): number {
  const affected = patternCoords(targetCol, targetRow, skill.pattern, battle.cols, battle.rows)
  const isDawnsJudgment = skill.id === 'dawns_judgment'
  const directTarget = skill.canRevive ? unitOrDownedAtCell(battle, targetCol, targetRow) : activeUnitAt(battle, targetCol, targetRow)
  const isDawnsJudgmentSafe = isDawnsJudgment && (!directTarget || directTarget.team !== actor.team || isUnitDowned(directTarget))
  const isRangedOrIndirect = skill.range > 1 || isSkillIndirect(skill)
  const skillElem = classifyElement(skill)

  let score = 0
  let hitEnemyCount = 0
  let hitTaunter = false
  let hasKill = false
  let supportValue = 0

  for (const c of affected) {
    if (isDawnsJudgmentSafe && skill.canRevive) {
      const downed = downedAllyAt(battle, c.col, c.row)
      if (downed && downed.team === actor.team) {
        supportValue += 260 + (4 - downed.koCountdown) * 35
        continue
      }
    }
    const unit = activeUnitAt(battle, c.col, c.row)
    if (!unit) continue
    if (unit.uid === actor.uid && !(targetCol === stand.col && targetRow === stand.row)) continue

    if (unit.team === actor.team) {
      if (isDawnsJudgmentSafe) {
        const missing = Math.max(0, unit.maxHp - unit.hp)
        supportValue += Math.min(missing, skill.healAmount) * 1.8 + skill.shieldAmount * 0.4
        continue
      }
      // Strict friendly-fire guard: never nuke our own heroes!
      return -9999
    }

    hitEnemyCount += 1
    if (provokingTaunters.some(t => t.uid === unit.uid)) hitTaunter = true
    const raw = actor.atk * skill.powerMul + skill.flatBonus
    const est = estimateStrikeDamage(battle, actor, stand.col, stand.row, unit, raw, skill.ignoreArmor, true, isRangedOrIndirect)
    const pincerDmg = estimatePincerBonus(battle, actor, stand.col, stand.row, unit, skill)
    const combo = skillElem ? previewElementalCombo(battle, skillElem, unit, c.col, c.row) : null
    const comboDmg = combo ? combo.bonusDamage : 0
    const totalDmg = est.damage + pincerDmg + comboDmg
    const lethal = totalDmg >= unit.hp + unit.shield
    if (lethal) hasKill = true

    score += totalDmg * 2.2
    if (est.arc === 'back') score += 26
    else if (est.arc === 'flank') score += 13
    if (lethal) {
      score += 95 + objectiveTargetPriorityBonus(battle, unit)
    } else {
      score += objectiveTargetPriorityBonus(battle, unit) * 0.5
      if (skill.status === 'stun') score += 28
      else if (skill.status === 'burn' || skill.status === 'poison' || skill.status === 'slow') score += 12
    }
    if (combo) score += 22
    if (hitEnemyCount === 1) {
      score -= estimateCounterPenalty(battle, actor, stand.col, stand.row, unit, est.arc, true, skill, lethal)
    }
  }

  if (hitEnemyCount === 0 && supportValue === 0) return -9999
  if (provokingTaunters.length > 0 && hitEnemyCount > 0 && !hitTaunter) {
    // Respect Taunt!
    score -= 480
  }

  // Self sustain / buff bonuses attached to offensive skills (e.g. Knight Shield Bash, Paladin Radiant Smite)
  if (skill.shieldAmount > 0 && skill.pattern !== 'aura') score += skill.shieldAmount * 0.65
  if (skill.healAmount > 0 && skill.pattern === 'single' && actor.hp < actor.maxHp) {
    score += Math.min(actor.maxHp - actor.hp, skill.healAmount) * 1.4
  }
  if (skill.selfStatus === 'taunt' || skill.status === 'empower') score += 12

  // Stand tile positioning + OA penalty
  score += supportValue + stand.terrainScore * 0.7
  if (stand.requiresMove) {
    const oaPen = stand.oaPreview.triggers.length > 0
      ? computeAiOpportunityPenalty(stand.oaPreview, hasKill, false)
      : 0
    score -= oaPen
    if (stand.oaLethal) score -= 240
  }
  // Slight nudge to prefer off-cooldown skills over basic attacks when clearly impactful
  score += 8
  return score
}

// ===========================================================================
// Tactic Card Planner
// ===========================================================================

function planBestTacticCard(
  state: GameState,
  actor: BattleUnit,
  provokingTaunters: readonly BattleUnit[]
): AutoBattleActionPlan | null {
  const battle = state.battle
  if (!battle || battle.hand.length === 0) return null

  const allies = battle.units.filter(u => u.team === 'ally' && u.alive)
  const downedAllies = battle.units.filter(u => u.team === 'ally' && isUnitDowned(u))
  const enemies = battle.units.filter(u => u.team === 'enemy' && u.alive && !isEnemyShrouded(battle, u))
  if (enemies.length === 0) return null

  let best: AutoBattleActionPlan | null = null

  for (const tacticUid of battle.hand) {
    const owned = state.campaign.tactics.find(t => t.uid === tacticUid)
    if (!owned) continue
    const spec = TACTIC_BY_ID[owned.tacticId]
    if (!spec || battle.ap < spec.cost) continue

    // 1. All-allies blessing (Solar Blessing)
    if (spec.pattern === 'all_allies') {
      let score = 0
      for (const d of downedAllies) {
        if (spec.canRevive) score += 290 + (4 - d.koCountdown) * 40
      }
      for (const a of allies) {
        const missing = Math.max(0, a.maxHp - a.hp)
        score += Math.min(missing, spec.heal) * 2.1
        if (a.shield < 12) score += spec.shield * 0.45
        if (spec.status === 'empower' && a.empowerTurns === 0) score += 26
      }
      if (score >= 135 && (!best || score > best.score)) {
        const firstAlly = allies[0] ?? downedAllies[0]
        if (firstAlly) {
          best = {
            kind: 'tactic',
            actorUid: actor.uid,
            tacticUid,
            targetCol: firstAlly.col,
            targetRow: firstAlly.row,
            score,
            reason: `Play ${spec.name} for squad blessing`
          }
        }
      }
      continue
    }

    // 2. Ally-targeted tactics (Revive, Heal, AP Surge, Empower, Shield, Taunt, Wind Step)
    if (spec.target === 'ally') {
      // 0-cost AP surge whenever AP is below max
      if (spec.apGain > 0 && spec.cost === 0 && battle.ap < battle.maxAp) {
        const score = 165
        if (!best || score > best.score) {
          best = {
            kind: 'tactic',
            actorUid: actor.uid,
            tacticUid,
            targetCol: actor.col,
            targetRow: actor.row,
            score,
            reason: `Play ${spec.name} for +${spec.apGain} AP`
          }
        }
        continue
      }

      // Revive downed ally
      if (spec.canRevive && downedAllies.length > 0) {
        const urgent = downedAllies.slice().sort((a, b) => a.koCountdown - b.koCountdown)[0]
        const score = 310 + (4 - urgent.koCountdown) * 45
        if (!best || score > best.score) {
          best = {
            kind: 'tactic',
            actorUid: actor.uid,
            tacticUid,
            targetCol: urgent.col,
            targetRow: urgent.row,
            score,
            reason: `Revive ${urgent.name} with ${spec.name}`
          }
        }
        continue
      }

      // Heal wounded ally
      if (spec.heal > 0) {
        const hurt = allies
          .filter(a => a.hp < a.maxHp * 0.65)
          .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]
        if (hurt) {
          const missing = hurt.maxHp - hurt.hp
          const urgency = hurt.hp < hurt.maxHp * 0.42 ? 1.65 : 1.1
          const score = Math.min(missing, spec.heal) * 3.4 * urgency + spec.shield * 0.6
          if (score >= 95 && (!best || score > best.score)) {
            best = {
              kind: 'tactic',
              actorUid: actor.uid,
              tacticUid,
              targetCol: hurt.col,
              targetRow: hurt.row,
              score,
              reason: `Heal ${hurt.name} with ${spec.name}`
            }
          }
        }
        continue
      }

      // Empower active hero right before they attack
      if (spec.status === 'empower' && !actor.acted && actor.empowerTurns === 0) {
        let nearestEnemyDist = Infinity
        for (let i = 0; i < enemies.length; i++) {
          const d = manhattan(actor.col, actor.row, enemies[i].col, enemies[i].row)
          if (d < nearestEnemyDist) nearestEnemyDist = d
        }
        if (nearestEnemyDist <= actor.move + actor.range + 1) {
          const score = 115
          if (!best || score > best.score) {
            best = {
              kind: 'tactic',
              actorUid: actor.uid,
              tacticUid,
              targetCol: actor.col,
              targetRow: actor.row,
              score,
              reason: `Empower ${actor.name} with ${spec.name}`
            }
          }
        }
        continue
      }

      // Shield / Taunt on frontline hero in combat
      if ((spec.shield >= 16 || spec.status === 'taunt') && battle.ap >= spec.cost + 1) {
        const threatened = allies
          .filter(a => a.shield < 10 && enemies.some(e => manhattan(a.col, a.row, e.col, e.row) <= 2))
          .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0]
        if (threatened) {
          const score = 102 + (threatened.hp < threatened.maxHp * 0.6 ? 25 : 0)
          if (!best || score > best.score) {
            best = {
              kind: 'tactic',
              actorUid: actor.uid,
              tacticUid,
              targetCol: threatened.col,
              targetRow: threatened.row,
              score,
              reason: `Fortify ${threatened.name} with ${spec.name}`
            }
          }
        }
      }
      continue
    }

    // 3. Offensive enemy or AoE tile tactics (Cinder Scroll, Venom Flask, Rime Seal, Storm Decree)
    if ((spec.target === 'enemy' || spec.target === 'tile') && spec.damage > 0) {
      const tacticElem = classifyElement(spec)
      const candidates: GridCoord[] = []
      const seen = new Set<string>()
      for (const e of enemies) {
        const k = `${e.col},${e.row}`
        if (!seen.has(k)) {
          seen.add(k)
          candidates.push({ col: e.col, row: e.row })
        }
      }
      for (const cand of candidates) {
        const cell = battle.cells[cand.row]?.[cand.col]
        if (!cell || cell.terrain === 'pillar' || cell.terrain === 'void') continue
        const affected = patternCoords(cand.col, cand.row, spec.pattern, battle.cols, battle.rows)
        let score = 0
        let hitCount = 0
        let hitTaunter = false
        let lethalCount = 0
        for (const c of affected) {
          const u = activeUnitAt(battle, c.col, c.row)
          if (!u || u.team !== 'enemy') continue
          hitCount += 1
          if (provokingTaunters.some(t => t.uid === u.uid)) hitTaunter = true
          const effDef = Math.max(0, u.def * 0.4 + terrainDefBonus(battle.cells[u.row][u.col].terrain))
          const estDmg = Math.max(4, Math.round(spec.damage - effDef * 0.72))
          const combo = tacticElem ? previewElementalCombo(battle, tacticElem, u, c.col, c.row) : null
          const totalDmg = estDmg + (combo ? combo.bonusDamage : 0)
          const lethal = totalDmg >= u.hp + u.shield
          if (lethal) lethalCount += 1
          score += totalDmg * 2.2 + (lethal ? 95 + objectiveTargetPriorityBonus(battle, u) : objectiveTargetPriorityBonus(battle, u) * 0.35)
          if (spec.status === 'stun') score += 30
          else if (spec.status) score += 10
          if (combo) score += 20
        }
        if (hitCount === 0) continue
        if (provokingTaunters.length > 0 && !hitTaunter) score -= 450
        const minThreshold = lethalCount > 0 ? 90 : hitCount >= 2 ? 110 : battle.ap >= spec.cost + 1 ? 105 : 140
        if (score >= minThreshold && (!best || score > best.score)) {
          best = {
            kind: 'tactic',
            actorUid: actor.uid,
            tacticUid,
            targetCol: cand.col,
            targetRow: cand.row,
            score,
            reason: `Cast ${spec.name} on (${cand.col},${cand.row})`
          }
        }
      }
    }
  }

  return best
}

// ===========================================================================
// Main Tactical Auto-Battle Action Planner
// ===========================================================================

/**
 * Plan the next deterministic tactical action for the active player hero.
 * Returns `null` when not in player phase or while a unit is currently walking.
 */
export function planAutoBattleAction(state: GameState): AutoBattleActionPlan | null {
  const battle = state.battle
  if (!battle || battle.phase !== 'player') return null
  if (battle.units.some(u => u.path.length > 0)) return null

  const actor = battle.units.find(u => u.uid === battle.activeUnitUid && u.alive && u.team === 'ally')
  if (!actor) return null
  if (actor.stunTurns > 0) {
    return {
      kind: 'end_turn',
      actorUid: actor.uid,
      score: 0,
      reason: 'Unit is stunned',
      facing: chooseBestTurnEndFacing(battle, actor)
    }
  }

  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  const visibleEnemies = enemies.filter(u => !isEnemyShrouded(battle, u))
  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  const downedAllies = battle.units.filter(u => isUnitDowned(u) && u.team === 'ally')
  const provokingTaunters = findAutoBattleProvokingTaunters(battle, actor)
  const stands = computeReachableStands(battle, actor)

  // 1. Instant-win Seize Goal check (when all required chests are already claimed)
  if (!actor.moved && battle.objective.kind === 'seize' && battle.objective.goalTile) {
    const goal = battle.objective.goalTile
    if (battle.objective.claimedChests.length >= battle.objective.requiredChests) {
      const goalStand = stands.find(s => s.requiresMove && s.col === goal.col && s.row === goal.row && !s.oaLethal)
      if (goalStand) {
        return {
          kind: 'move',
          actorUid: actor.uid,
          moveTo: { col: goal.col, row: goal.row },
          score: 1000,
          reason: 'Seize goal tile for immediate victory'
        }
      }
    }
  }

  // 2. High-value Tactic Card check (revive downed hero, urgent heal, AP surge, strong AoE/buff)
  const tacticPlan = planBestTacticCard(state, actor, provokingTaunters)
  if (tacticPlan && tacticPlan.score >= 115) {
    return tacticPlan
  }

  // 3. If hero hasn't acted yet, evaluate Support Skills, Offensive Skills, and Basic Attacks across all stands
  let bestAction: AutoBattleActionPlan | null = null

  if (!actor.acted) {
    // 3a. Support / Heal / Revive / Self-Aura Skills (e.g. Cleric Sunbeam Mend, Sanctuary Wave, Knight Bulwark, Paladin Aegis)
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const skill = getUnlockedSkill(actor, sIdx)
      if (!skill || actor.cooldowns[sIdx] > 0) continue

      if (skill.target === 'self') {
        const anyNearEnemy = enemies.some(e => manhattan(actor.col, actor.row, e.col, e.row) <= 4)
        for (const stand of stands) {
          if (stand.oaLethal) continue
          const affected = patternCoords(stand.col, stand.row, skill.pattern, battle.cols, battle.rows)
          let score = 0
          let useful = false
          for (const c of affected) {
            if (skill.canRevive) {
              const downed = downedAllyAt(battle, c.col, c.row)
              if (downed && downed.team === actor.team) {
                score += 330 + (4 - downed.koCountdown) * 45
                useful = true
                continue
              }
            }
            const ally = c.col === stand.col && c.row === stand.row ? actor : activeUnitAt(battle, c.col, c.row)
            if (!ally || ally.team !== actor.team) continue
            const missing = Math.max(0, ally.maxHp - ally.hp)
            if (skill.healAmount > 0 && ally.hp < ally.maxHp * 0.78) {
              const urg = ally.hp < ally.maxHp * 0.45 ? 2.6 : 1.7
              score += Math.min(missing, skill.healAmount) * urg
              useful = true
            }
            if (anyNearEnemy && skill.shieldAmount > 0 && ally.shield < 12) {
              score += skill.shieldAmount * 1.15
              useful = true
            }
            if (anyNearEnemy && skill.status === 'empower' && ally.empowerTurns === 0) {
              score += 24
              useful = true
            }
          }
          if (!useful || score < 48) continue
          if (anyNearEnemy && skill.selfStatus === 'taunt') score += 20
          score += stand.terrainScore * 0.5 - stand.oaPenalty
          if (!bestAction || score > bestAction.score) {
            bestAction = stand.requiresMove
              ? {
                  kind: 'move_and_skill',
                  actorUid: actor.uid,
                  moveTo: { col: stand.col, row: stand.row },
                  skillIndex: sIdx,
                  targetCol: stand.col,
                  targetRow: stand.row,
                  score,
                  reason: `Move & cast ${skill.name}`
                }
              : {
                  kind: 'skill',
                  actorUid: actor.uid,
                  skillIndex: sIdx,
                  targetCol: stand.col,
                  targetRow: stand.row,
                  score,
                  reason: `Cast ${skill.name}`
                }
          }
        }
        continue
      }

      if (skill.target === 'ally') {
        const supportTargets: BattleUnit[] = []
        if (skill.canRevive) {
          for (const d of downedAllies) supportTargets.push(d)
        }
        for (const a of allies) {
          if (a.hp < a.maxHp * 0.78) supportTargets.push(a)
        }
        for (const target of supportTargets) {
          const isDowned = isUnitDowned(target)
          for (const stand of stands) {
            if (stand.oaLethal) continue
            const dist = manhattan(stand.col, stand.row, target.col, target.row)
            const effR = effectiveRange(battle, stand.col, stand.row, target.col, target.row, skill.range, actor)
            if (dist > effR) continue
            let score = 0
            if (isDowned && skill.canRevive) {
              score = 340 + (4 - target.koCountdown) * 45
            } else {
              const missing = Math.max(0, target.maxHp - target.hp)
              const urgency = target.hp < target.maxHp * 0.45 ? 3.2 : 2.0
              score = Math.min(missing, skill.healAmount) * urgency + skill.shieldAmount * 0.7
              if (skill.status === 'haste' && target.hasteTurns === 0) score += 16
            }
            score += stand.terrainScore * 0.5 - stand.oaPenalty
            if (!bestAction || score > bestAction.score) {
              bestAction = stand.requiresMove
                ? {
                    kind: 'move_and_skill',
                    actorUid: actor.uid,
                    moveTo: { col: stand.col, row: stand.row },
                    skillIndex: sIdx,
                    targetCol: target.col,
                    targetRow: target.row,
                    score,
                    reason: isDowned ? `Move & revive ${target.name} with ${skill.name}` : `Move & heal ${target.name} with ${skill.name}`
                  }
                : {
                    kind: 'skill',
                    actorUid: actor.uid,
                    skillIndex: sIdx,
                    targetCol: target.col,
                    targetRow: target.row,
                    score,
                    reason: isDowned ? `Revive ${target.name} with ${skill.name}` : `Heal ${target.name} with ${skill.name}`
                  }
            }
          }
        }
        continue
      }

      // 3b. Offensive Skills (single, cross, area3)
      if (skill.powerMul > 0) {
        const indirect = isSkillIndirect(skill)
        const candTargets: GridCoord[] = []
        const seenCand = new Set<string>()
        const addCand = (col: number, row: number) => {
          if (!inBounds(col, row, battle.cols, battle.rows)) return
          const terrain = battle.cells[row][col].terrain
          if (terrain === 'pillar' || terrain === 'void') return
          const k = `${col},${row}`
          if (!seenCand.has(k)) {
            seenCand.add(k)
            candTargets.push({ col, row })
          }
        }
        for (const e of visibleEnemies) {
          for (const fp of getUnitFootprintCells(e)) {
            addCand(fp.col, fp.row)
            if (skill.pattern === 'cross' || skill.pattern === 'area3') {
              addCand(fp.col + 1, fp.row)
              addCand(fp.col - 1, fp.row)
              addCand(fp.col, fp.row + 1)
              addCand(fp.col, fp.row - 1)
            }
          }
        }
        if (skill.id === 'dawns_judgment') {
          for (const d of downedAllies) addCand(d.col, d.row)
        }

        for (const stand of stands) {
          for (const cand of candTargets) {
            const dist = manhattan(stand.col, stand.row, cand.col, cand.row)
            if (dist < 1) continue
            const effR = effectiveRange(battle, stand.col, stand.row, cand.col, cand.row, skill.range, actor)
            if (dist > effR) continue
            if (!hasClearLoS(battle, stand.col, stand.row, cand.col, cand.row, indirect)) continue

            const score = scoreOffensiveSkillOnCell(battle, actor, stand, skill, cand.col, cand.row, provokingTaunters)
            if (score <= -500) continue
            if (!bestAction || score > bestAction.score) {
              bestAction = stand.requiresMove
                ? {
                    kind: 'move_and_skill',
                    actorUid: actor.uid,
                    moveTo: { col: stand.col, row: stand.row },
                    skillIndex: sIdx,
                    targetCol: cand.col,
                    targetRow: cand.row,
                    score,
                    reason: `Move & cast ${skill.name}`
                  }
                : {
                    kind: 'skill',
                    actorUid: actor.uid,
                    skillIndex: sIdx,
                    targetCol: cand.col,
                    targetRow: cand.row,
                    score,
                    reason: `Cast ${skill.name}`
                  }
            }
          }
        }
      }
    }

    // 3c. Basic Attacks on alive visible enemies (supports 2x2 multi-tile raid bosses!)
    for (const stand of stands) {
      for (const enemy of visibleEnemies) {
        const hitCell = closestFootprintCell(stand.col, stand.row, enemy)
        const dist = manhattan(stand.col, stand.row, hitCell.col, hitCell.row)
        const effR = effectiveRange(battle, stand.col, stand.row, hitCell.col, hitCell.row, actor.range, actor)
        if (dist > effR) continue
        if (!hasClearLoS(battle, stand.col, stand.row, hitCell.col, hitCell.row, false)) continue

        const est = estimateStrikeDamage(
          battle,
          actor,
          stand.col,
          stand.row,
          enemy,
          actor.atk,
          0,
          false,
          actor.range > 1
        )
        const pincerDmg = estimatePincerBonus(battle, actor, stand.col, stand.row, enemy, null)
        const totalDmg = est.damage + pincerDmg
        const lethal = totalDmg >= enemy.hp + enemy.shield
        const counterPen = estimateCounterPenalty(battle, actor, stand.col, stand.row, enemy, est.arc, false, null, lethal)

        let score = totalDmg * 2.2 - counterPen
        if (est.arc === 'back') score += 26
        else if (est.arc === 'flank') score += 13
        if (lethal) {
          score += 95 + objectiveTargetPriorityBonus(battle, enemy)
        } else {
          score += objectiveTargetPriorityBonus(battle, enemy) * 0.5
        }
        if (provokingTaunters.length > 0 && !provokingTaunters.some(t => t.uid === enemy.uid)) {
          score -= 480
        }
        score += stand.terrainScore * 0.7
        if (stand.requiresMove) {
          const oaPen = stand.oaPreview.triggers.length > 0
            ? computeAiOpportunityPenalty(stand.oaPreview, lethal, false)
            : 0
          score -= oaPen
          if (stand.oaLethal) score -= 240
        }
        // Ranged heroes prefer staying at distance >= 2 if possible
        if (actor.range >= 2 && dist === 1) score -= 10

        if (!bestAction || score > bestAction.score) {
          bestAction = stand.requiresMove
            ? {
                kind: 'move_and_attack',
                actorUid: actor.uid,
                moveTo: { col: stand.col, row: stand.row },
                targetCol: hitCell.col,
                targetRow: hitCell.row,
                score,
                reason: `Move & strike ${enemy.name}`
              }
            : {
                kind: 'attack',
                actorUid: actor.uid,
                targetCol: hitCell.col,
                targetRow: hitCell.row,
                score,
                reason: `Strike ${enemy.name}`
              }
        }
      }
    }

    if (bestAction && bestAction.score > -200) {
      return bestAction
    }
  }

  // 4. Smart Movement / Objective Advance (only if hero hasn't moved yet)
  if (!actor.moved && stands.length > 1) {
    // If already acted, only move to escape an active lava geyser or claim an adjacent chest!
    const currentCell = battle.cells[actor.row]?.[actor.col]
    const standingInHazard = Boolean(currentCell && currentCell.terrain === 'lava_geyser' && currentCell.geyserActive)
    if (actor.acted && !standingInHazard) {
      const chestStand = stands.find(s => s.requiresMove && isUnclaimedChest(battle, s.col, s.row) && !s.oaLethal)
      if (chestStand) {
        return {
          kind: 'move',
          actorUid: actor.uid,
          moveTo: { col: chestStand.col, row: chestStand.row },
          score: 180,
          reason: 'Claim nearby treasure chest'
        }
      }
      return {
        kind: 'end_turn',
        actorUid: actor.uid,
        score: 0,
        reason: 'Hold position for CT bonus & optimal facing',
        facing: chooseBestTurnEndFacing(battle, actor)
      }
    }

    // Build objective-driven goal coordinates
    const goals: GridCoord[] = []
    const unclaimedChests = getUnclaimedChests(battle)
    const isClericWithHurt =
      actor.heroId === 'cleric' &&
      (downedAllies.length > 0 || allies.some(a => a.uid !== actor.uid && a.hp < a.maxHp * 0.6))

    if (battle.objective.kind === 'seize') {
      if (battle.objective.claimedChests.length < battle.objective.requiredChests && unclaimedChests.length > 0) {
        for (const c of unclaimedChests) goals.push(c)
      } else if (battle.objective.goalTile) {
        goals.push(battle.objective.goalTile)
      }
    } else if (battle.objective.kind === 'assassinate' && battle.objective.targetEnemyUid) {
      const boss = enemies.find(e => e.uid === battle.objective.targetEnemyUid)
      if (boss) goals.push({ col: boss.col, row: boss.row })
    } else if (battle.objective.kind === 'defend' && battle.objective.protectTile) {
      const pt = battle.objective.protectTile
      const nearThreat = enemies
        .slice()
        .sort((a, b) => manhattan(a.col, a.row, pt.col, pt.row) - manhattan(b.col, b.row, pt.col, pt.row))[0]
      if (nearThreat) goals.push({ col: nearThreat.col, row: nearThreat.row })
      goals.push(pt)
    }

    if (goals.length === 0) {
      if (provokingTaunters.length > 0) {
        for (const t of provokingTaunters) goals.push({ col: t.col, row: t.row })
      } else if (isClericWithHurt) {
        for (const d of downedAllies) goals.push({ col: d.col, row: d.row })
        for (const a of allies) {
          if (a.uid !== actor.uid && a.hp < a.maxHp * 0.6) goals.push({ col: a.col, row: a.row })
        }
      } else {
        for (const e of enemies) goals.push({ col: e.col, row: e.row })
      }
    }

    const distField = computeDistanceFieldToGoals(battle, actor, goals)
    const fallbackDist = (c: number, r: number): number => {
      if (goals.length === 0) return 0
      let bestDist = Infinity
      for (let i = 0; i < goals.length; i++) {
        const d = manhattan(c, r, goals[i].col, goals[i].row)
        if (d < bestDist) bestDist = d
      }
      return bestDist
    }
    const goalDistAt = (c: number, r: number): number => distField.get(`${c},${r}`) ?? fallbackDist(c, r) + 4

    const currentGoalDist = goalDistAt(actor.col, actor.row)
    const currentScore = -currentGoalDist * 14 + stands[0].terrainScore
    let bestMove: ReachableStand | null = null
    let bestMoveScore = currentScore + 2

    for (const stand of stands) {
      if (!stand.requiresMove || stand.oaLethal) continue
      const gd = goalDistAt(stand.col, stand.row)
      let score = -gd * 14 + stand.terrainScore - stand.oaPenalty
      if (actor.range >= 2 && enemies.some(e => manhattan(stand.col, stand.row, e.col, e.row) === 1)) {
        score -= 12
      }
      if (score > bestMoveScore) {
        bestMoveScore = score
        bestMove = stand
      }
    }

    if (bestMove) {
      return {
        kind: 'move',
        actorUid: actor.uid,
        moveTo: { col: bestMove.col, row: bestMove.row },
        score: bestMoveScore,
        reason: standingInHazard ? 'Evade active lava geyser' : 'Advance toward tactical objective'
      }
    }
  }

  // 5. Fallback: smash an adjacent intact barricade if hero hasn't acted and enemies are blocked
  if (!actor.acted) {
    for (let r = 0; r < battle.rows; r++) {
      for (let c = 0; c < battle.cols; c++) {
        if (!isIntactBarricadeCell(battle.cells[r][c])) continue
        const dist = manhattan(actor.col, actor.row, c, r)
        const effR = effectiveRange(battle, actor.col, actor.row, c, r, actor.range, actor)
        if (dist >= 1 && dist <= effR && hasClearLoS(battle, actor.col, actor.row, c, r, false)) {
          return {
            kind: 'attack',
            actorUid: actor.uid,
            targetCol: c,
            targetRow: r,
            score: 12,
            reason: 'Clear destructible barricade'
          }
        }
      }
    }
  }

  // 6. End turn with smart facing toward nearest / highest-threat enemy
  return {
    kind: 'end_turn',
    actorUid: actor.uid,
    score: 0,
    reason: 'End turn with optimal facing',
    facing: chooseBestTurnEndFacing(battle, actor)
  }
}

/**
 * Collect a diverse set of top legal tactical action plans for the active player hero.
 * Used by the Ridgetop Decision Agent to let a Decision API (e.g. Typesafe JEV, Clef, OpenAI)
 * choose among meaningful tactical options with live probabilities.
 */
export function collectAutoBattleCandidates(state: GameState, maxCandidates = 6): AutoBattleActionPlan[] {
  const battle = state.battle
  if (!battle || battle.phase !== 'player') return []
  if (battle.units.some(u => u.path.length > 0)) return []

  const actor = battle.units.find(u => u.uid === battle.activeUnitUid && u.alive && u.team === 'ally')
  if (!actor) return []
  if (actor.stunTurns > 0) {
    return [{
      kind: 'end_turn',
      actorUid: actor.uid,
      score: 0,
      reason: 'Unit is stunned — end turn',
      facing: chooseBestTurnEndFacing(battle, actor)
    }]
  }

  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  const visibleEnemies = enemies.filter(u => !isEnemyShrouded(battle, u))
  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  const downedAllies = battle.units.filter(u => isUnitDowned(u) && u.team === 'ally')
  const provokingTaunters = findAutoBattleProvokingTaunters(battle, actor)
  const stands = computeReachableStands(battle, actor)

  const byKey = new Map<string, AutoBattleActionPlan>()
  const addCandidate = (key: string, plan: AutoBattleActionPlan) => {
    const existing = byKey.get(key)
    if (!existing || plan.score > existing.score) {
      byKey.set(key, plan)
    }
  }

  // Always include the heuristic planner's top recommendation first
  const primary = planAutoBattleAction(state)
  if (primary) {
    addCandidate(`primary:${primary.kind}:${primary.skillIndex ?? ''}:${primary.tacticUid ?? ''}:${primary.targetCol ?? ''},${primary.targetRow ?? ''}`, primary)
  }

  // Best tactic card
  const tacticPlan = planBestTacticCard(state, actor, provokingTaunters)
  if (tacticPlan && tacticPlan.score > 20) {
    addCandidate(`tactic:${tacticPlan.tacticUid}`, tacticPlan)
  }

  // Distinct skills & basic attacks
  if (!actor.acted) {
    for (let sIdx = 0; sIdx < 3; sIdx++) {
      const skill = getUnlockedSkill(actor, sIdx)
      if (!skill || actor.cooldowns[sIdx] > 0) continue

      if (skill.target === 'self') {
        const anyNearEnemy = enemies.some(e => manhattan(actor.col, actor.row, e.col, e.row) <= 4)
        for (const stand of stands) {
          if (stand.oaLethal) continue
          const affected = patternCoords(stand.col, stand.row, skill.pattern, battle.cols, battle.rows)
          let score = 0
          let useful = false
          for (const c of affected) {
            if (skill.canRevive && downedAllyAt(battle, c.col, c.row)) {
              score += 320
              useful = true
              continue
            }
            const ally = c.col === stand.col && c.row === stand.row ? actor : activeUnitAt(battle, c.col, c.row)
            if (!ally || ally.team !== actor.team) continue
            if (skill.healAmount > 0 && ally.hp < ally.maxHp * 0.85) {
              score += Math.min(ally.maxHp - ally.hp, skill.healAmount) * 1.9
              useful = true
            }
            if (anyNearEnemy && skill.shieldAmount > 0 && ally.shield < 12) {
              score += skill.shieldAmount * 1.15
              useful = true
            }
            if (anyNearEnemy && skill.status === 'empower' && ally.empowerTurns === 0) {
              score += 24
              useful = true
            }
          }
          if (!useful || score < 30) continue
          score += stand.terrainScore * 0.5 - stand.oaPenalty
          addCandidate(`skill:${sIdx}`, stand.requiresMove
            ? { kind: 'move_and_skill', actorUid: actor.uid, moveTo: { col: stand.col, row: stand.row }, skillIndex: sIdx, targetCol: stand.col, targetRow: stand.row, score, reason: `Move to (${stand.col},${stand.row}) & cast ${skill.name}` }
            : { kind: 'skill', actorUid: actor.uid, skillIndex: sIdx, targetCol: stand.col, targetRow: stand.row, score, reason: `Cast ${skill.name}` })
        }
      } else if (skill.target === 'ally') {
        for (const stand of stands) {
          if (stand.oaLethal) continue
          for (const ally of [...allies, ...downedAllies]) {
            const dist = manhattan(stand.col, stand.row, ally.col, ally.row)
            if (dist > skill.range) continue
            if (isUnitDowned(ally) && !skill.canRevive) continue
            if (!isUnitDowned(ally) && ally.hp >= ally.maxHp * 0.9 && skill.healAmount > 0) continue
            const score = isUnitDowned(ally)
              ? 340
              : Math.min(ally.maxHp - ally.hp, skill.healAmount) * 2.1 + stand.terrainScore * 0.4 - stand.oaPenalty
            addCandidate(`skill:${sIdx}:${ally.uid}`, stand.requiresMove
              ? { kind: 'move_and_skill', actorUid: actor.uid, moveTo: { col: stand.col, row: stand.row }, skillIndex: sIdx, targetCol: ally.col, targetRow: ally.row, score, reason: `Move & cast ${skill.name} on ${ally.name}` }
              : { kind: 'skill', actorUid: actor.uid, skillIndex: sIdx, targetCol: ally.col, targetRow: ally.row, score, reason: `Cast ${skill.name} on ${ally.name}` })
          }
        }
      } else {
        const indirect = skill.pattern !== 'single' || skill.range >= 3
        for (const stand of stands) {
          if (stand.oaLethal) continue
          for (const enemy of visibleEnemies) {
            const hitCell = closestFootprintCell(stand.col, stand.row, enemy)
            const dist = manhattan(stand.col, stand.row, hitCell.col, hitCell.row)
            if (dist < 1) continue
            const effR = effectiveRange(battle, stand.col, stand.row, hitCell.col, hitCell.row, skill.range, actor)
            if (dist > effR) continue
            if (!hasClearLoS(battle, stand.col, stand.row, hitCell.col, hitCell.row, indirect)) continue
            const score = scoreOffensiveSkillOnCell(battle, actor, stand, skill, hitCell.col, hitCell.row, provokingTaunters)
            if (score <= -300) continue
            addCandidate(`skill:${sIdx}:${enemy.uid}`, stand.requiresMove
              ? { kind: 'move_and_skill', actorUid: actor.uid, moveTo: { col: stand.col, row: stand.row }, skillIndex: sIdx, targetCol: hitCell.col, targetRow: hitCell.row, score, reason: `Move & cast ${skill.name} on ${enemy.name}` }
              : { kind: 'skill', actorUid: actor.uid, skillIndex: sIdx, targetCol: hitCell.col, targetRow: hitCell.row, score, reason: `Cast ${skill.name} on ${enemy.name}` })
          }
        }
      }
    }

    // Basic attacks against each reachable visible enemy
    for (const stand of stands) {
      for (const enemy of visibleEnemies) {
        const hitCell = closestFootprintCell(stand.col, stand.row, enemy)
        const dist = manhattan(stand.col, stand.row, hitCell.col, hitCell.row)
        const effR = effectiveRange(battle, stand.col, stand.row, hitCell.col, hitCell.row, actor.range, actor)
        if (dist > effR) continue
        if (!hasClearLoS(battle, stand.col, stand.row, hitCell.col, hitCell.row, false)) continue
        const est = estimateStrikeDamage(battle, actor, stand.col, stand.row, enemy, actor.atk, 0, false, actor.range > 1)
        const pincerDmg = estimatePincerBonus(battle, actor, stand.col, stand.row, enemy, null)
        const totalDmg = est.damage + pincerDmg
        const lethal = totalDmg >= enemy.hp + enemy.shield
        const counterPen = estimateCounterPenalty(battle, actor, stand.col, stand.row, enemy, est.arc, false, null, lethal)
        let score = totalDmg * 2.2 - counterPen + stand.terrainScore * 0.7
        if (lethal) score += 95 + objectiveTargetPriorityBonus(battle, enemy)
        if (stand.requiresMove && stand.oaLethal) score -= 240
        const tag = lethal ? ` (~${totalDmg} dmg, KO!)` : ` (~${totalDmg} dmg)`
        addCandidate(`attack:${enemy.uid}`, stand.requiresMove
          ? { kind: 'move_and_attack', actorUid: actor.uid, moveTo: { col: stand.col, row: stand.row }, targetCol: hitCell.col, targetRow: hitCell.row, score, reason: `Move to (${stand.col},${stand.row}) & strike ${enemy.name}${tag}` }
          : { kind: 'attack', actorUid: actor.uid, targetCol: hitCell.col, targetRow: hitCell.row, score, reason: `Strike ${enemy.name}${tag}` })
      }
    }
  }

  // Best pure reposition / objective advance move (if unit hasn't moved)
  if (!actor.moved && stands.length > 1) {
    const goals: GridCoord[] = enemies.map(e => ({ col: e.col, row: e.row }))
    if (battle.objective.kind === 'seize' && battle.objective.goalTile) goals.unshift(battle.objective.goalTile)
    const distField = computeDistanceFieldToGoals(battle, actor, goals)
    let bestAdvance: { stand: ReachableStand; score: number } | null = null
    let bestDefensive: { stand: ReachableStand; score: number } | null = null
    for (const stand of stands) {
      if (!stand.requiresMove || stand.oaLethal) continue
      const gd = distField.get(`${stand.col},${stand.row}`) ?? 10
      const advScore = -gd * 14 + stand.terrainScore - stand.oaPenalty
      if (!bestAdvance || advScore > bestAdvance.score) bestAdvance = { stand, score: advScore }
      const defScore = stand.terrainScore * 2 + gd * 4 - stand.oaPenalty
      if (!bestDefensive || defScore > bestDefensive.score) bestDefensive = { stand, score: defScore }
    }
    if (bestAdvance) {
      addCandidate('move:advance', {
        kind: 'move',
        actorUid: actor.uid,
        moveTo: { col: bestAdvance.stand.col, row: bestAdvance.stand.row },
        score: bestAdvance.score,
        reason: `Advance to (${bestAdvance.stand.col},${bestAdvance.stand.row})`
      })
    }
    if (bestDefensive && (!bestAdvance || bestDefensive.stand.col !== bestAdvance.stand.col || bestDefensive.stand.row !== bestAdvance.stand.row)) {
      addCandidate('move:defend', {
        kind: 'move',
        actorUid: actor.uid,
        moveTo: { col: bestDefensive.stand.col, row: bestDefensive.stand.row },
        score: bestDefensive.score - 20,
        reason: `Reposition to high-cover tile (${bestDefensive.stand.col},${bestDefensive.stand.row})`
      })
    }
  }

  // Always include End Turn as a fallback tactical choice
  addCandidate('end_turn', {
    kind: 'end_turn',
    actorUid: actor.uid,
    score: -5,
    reason: 'Hold position & end turn (save CT, optimal facing)',
    facing: chooseBestTurnEndFacing(battle, actor)
  })

  const sorted = Array.from(byKey.values()).sort((a, b) => b.score - a.score)
  const cap = Math.max(2, maxCandidates)
  return sorted.slice(0, cap)
}
