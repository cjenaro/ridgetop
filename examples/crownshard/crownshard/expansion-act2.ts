import { CHAPTER_BY_ID, ENEMY_SPECS } from './data.ts'
import { normalizeStageMutators } from './mutators.ts'
import {
  cellHeightLevel,
  gridToWorld,
  isUnitDowned,
  terrainWalkable
} from './types.ts'
import type {
  BattleState,
  BattleUnit,
  ElementKind,
  EnemyArchetypeId,
  GridCell,
  GridCoord,
  StageMutatorId,
  StatusKind
} from './types.ts'

/**
 * Pure Act II Expansion helpers for Ashen Catacombs & Frostspire Highlands:
 * - Innate stage mutators (e.g. Gloomwood Fog-of-War Stalker Hunt)
 * - Multi-tile 2x2 raid boss footprint geometry, occupancy, distance, movement & collision
 * - Boss signature mechanics for Lich Vaelen (Cursed-Soul Nova + Necromancy)
 *   and Rimefang the Glacial Frostwyrm (Glacial Breath cone/cross + Wing Buffet knockback 2)
 *
 * Zero browser globals; Godot GDScript compiler compatible.
 */

export const ACT2_EXPANSION_STAGE_IDS: readonly string[] = [
  'gloomwood_heart',
  'bone_cathedral',
  'runeforge_peak',
  'wyrm_eyrie'
]

export const LICH_VAELEN_SUMMON_CAP = 2
export const LICH_VAELEN_SUMMON_COOLDOWN = 3
export const LICH_VAELEN_SOUL_NOVA_COOLDOWN = 2

export const FROSTWYRM_BREATH_COOLDOWN = 2
export const FROSTWYRM_WING_BUFFET_COOLDOWN = 2
export const FROSTWYRM_WING_BUFFET_KNOCKBACK = 2
export const FROSTWYRM_BREATH_RANGE = 3

export interface LichSoulNovaSpec {
  readonly move: 'soul_nova'
  readonly vfxMove: 'eclipse_nova'
  readonly cooldownSlot: 1
  readonly cooldownTurns: number
  readonly pattern: 'cross'
  readonly powerMul: number
  readonly ignoreArmor: number
  readonly status: StatusKind
  readonly statusStacks: number
  readonly element: ElementKind
  readonly label: string
}

export interface FrostwyrmSpecialPlan {
  readonly move: 'glacial_breath' | 'wing_buffet'
  readonly vfxMove: 'frostwyrm_breath' | 'titan_slam'
  readonly cooldownSlot: 0 | 1
  readonly cooldownTurns: number
  readonly targetCol: number
  readonly targetRow: number
  readonly cells: readonly GridCoord[]
  readonly powerMul: number
  readonly ignoreArmor: number
  readonly status?: StatusKind
  readonly element?: ElementKind
  readonly knockbackDistance?: number
  readonly label: string
}

const CARDINAL_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]

function manhattanDist(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

function inGridBounds(col: number, row: number, cols: number, rows: number): boolean {
  return col >= 0 && col < cols && row >= 0 && row < rows
}

/** Return the innate mutators always active for a given stage (even on first clear). */
export function getInnateStageMutators(stageId: string): readonly StageMutatorId[] {
  const chapter = CHAPTER_BY_ID[stageId]
  if (chapter && chapter.innateMutators && chapter.innateMutators.length > 0) {
    return chapter.innateMutators
  }
  if (stageId === 'gloomwood_heart') {
    return ['fog_of_war']
  }
  return []
}

/** Merge innate stage mutators with player-selected challenge mutators in canonical order. */
export function mergeInnateStageMutators(
  stageId: string,
  activeMutators: readonly StageMutatorId[]
): StageMutatorId[] {
  const innate = getInnateStageMutators(stageId)
  if (innate.length === 0) return normalizeStageMutators(activeMutators)
  const combined: StageMutatorId[] = []
  for (const m of innate) combined.push(m)
  for (const m of activeMutators) combined.push(m)
  return normalizeStageMutators(combined)
}

/** Resolve square footprint side length for a unit (`1` for standard 1x1, `2` for 2x2 raid bosses). */
export function getUnitFootprintSize(
  unit: Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>> | null | undefined
): 1 | 2 {
  if (!unit) return 1
  if (unit.footprintSize === 2) return 2
  if (unit.footprintSize === 1) return 1
  if (unit.enemyId) {
    const spec = ENEMY_SPECS[unit.enemyId]
    if (spec && spec.footprintSize === 2) return 2
  }
  return 1
}

/** Return all grid coordinates covered by a `size x size` footprint anchored at `(col, row)`. */
export function getFootprintCellsAt(col: number, row: number, size: 1 | 2): GridCoord[] {
  if (size <= 1) return [{ col, row }]
  return [
    { col, row },
    { col: col + 1, row },
    { col, row: row + 1 },
    { col: col + 1, row: row + 1 }
  ]
}

/** Return all grid coordinates occupied by `unit`. */
export function getUnitFootprintCells(
  unit: Pick<BattleUnit, 'col' | 'row'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>
): GridCoord[] {
  return getFootprintCellsAt(unit.col, unit.row, getUnitFootprintSize(unit))
}

/** True when `unit` occupies `(col, row)` as part of its 1x1 or 2x2 footprint. */
export function unitOccupiesCell(
  unit: Pick<BattleUnit, 'col' | 'row'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>,
  col: number,
  row: number
): boolean {
  const size = getUnitFootprintSize(unit)
  if (size <= 1) return unit.col === col && unit.row === row
  return col >= unit.col && col < unit.col + size && row >= unit.row && row < unit.row + size
}

/** Minimum Manhattan distance from `(fromCol, fromRow)` to any tile occupied by `target`. */
export function distanceToUnitFootprint(
  fromCol: number,
  fromRow: number,
  target: Pick<BattleUnit, 'col' | 'row'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>
): number {
  const cells = getUnitFootprintCells(target)
  let best = 9999
  for (const c of cells) {
    const d = manhattanDist(fromCol, fromRow, c.col, c.row)
    if (d < best) best = d
  }
  return best
}

/** Minimum Manhattan distance between any tile of `unitA` and any tile of `unitB`. */
export function distanceBetweenUnits(
  unitA: Pick<BattleUnit, 'col' | 'row'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>,
  unitB: Pick<BattleUnit, 'col' | 'row'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>
): number {
  const cellsA = getUnitFootprintCells(unitA)
  const cellsB = getUnitFootprintCells(unitB)
  let best = 9999
  for (const a of cellsA) {
    for (const b of cellsB) {
      const d = manhattanDist(a.col, a.row, b.col, b.row)
      if (d < best) best = d
    }
  }
  return best
}

/** Return the tile inside `target`'s footprint closest to `(fromCol, fromRow)` with deterministic tie-breaking. */
export function closestFootprintCell(
  fromCol: number,
  fromRow: number,
  target: Pick<BattleUnit, 'col' | 'row'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>
): GridCoord {
  const cells = getUnitFootprintCells(target)
  let best = cells[0]
  let bestDist = manhattanDist(fromCol, fromRow, best.col, best.row)
  for (let i = 1; i < cells.length; i++) {
    const c = cells[i]
    const d = manhattanDist(fromCol, fromRow, c.col, c.row)
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

/** True when `(col, row)` is orthogonally adjacent to `unit`'s footprint (and not inside it). */
export function isCellAdjacentToUnit(
  unit: Pick<BattleUnit, 'col' | 'row'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>,
  col: number,
  row: number
): boolean {
  if (unitOccupiesCell(unit, col, row)) return false
  return distanceToUnitFootprint(col, row, unit) === 1
}

/** All in-bounds walkable tiles orthogonally bordering a unit's footprint. */
export function getUnitPerimeterCells(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  unit: Pick<BattleUnit, 'col' | 'row'> & Partial<Pick<BattleUnit, 'footprintSize' | 'enemyId'>>
): GridCoord[] {
  const footprint = getUnitFootprintCells(unit)
  const seen = new Set<string>()
  const out: GridCoord[] = []
  for (const fc of footprint) {
    for (const [dc, dr] of CARDINAL_DIRS) {
      const nc = fc.col + dc
      const nr = fc.row + dr
      if (!inGridBounds(nc, nr, battle.cols, battle.rows)) continue
      if (unitOccupiesCell(unit, nc, nr)) continue
      const key = `${nc},${nr}`
      if (seen.has(key)) continue
      seen.add(key)
      const cell = battle.cells[nr]?.[nc]
      if (!cell || !cell.walkable || cell.terrain === 'void') continue
      out.push({ col: nc, row: nr })
    }
  }
  return out
}

/**
 * Compute world-space center `[x, y, z]` for a unit anchored at `(col, row)`.
 * For 2x2 raid bosses, averages the 4 footprint tiles in XZ and uses the highest tile elevation.
 */
export function computeFootprintWorldCenter(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  col: number,
  row: number,
  footprintSize: 1 | 2 = 1
): [number, number, number] {
  if (footprintSize <= 1) {
    const elev = battle.cells[row]?.[col]?.elevation ?? 0
    return gridToWorld(col, row, elev, battle.cols, battle.rows)
  }
  const cells = getFootprintCellsAt(col, row, footprintSize)
  let sumX = 0
  let sumZ = 0
  let maxElev = -999
  let count = 0
  for (const c of cells) {
    if (!inGridBounds(c.col, c.row, battle.cols, battle.rows)) continue
    const elev = battle.cells[c.row]?.[c.col]?.elevation ?? 0
    const [wx, , wz] = gridToWorld(c.col, c.row, elev, battle.cols, battle.rows)
    sumX += wx
    sumZ += wz
    if (elev > maxElev) maxElev = elev
    count += 1
  }
  if (count === 0) {
    return gridToWorld(col, row, 0, battle.cols, battle.rows)
  }
  return [sumX / count, maxElev, sumZ / count]
}

/**
 * True when `(col, row)` can legally anchor a `footprintSize x footprintSize` unit:
 * all footprint tiles are in bounds, walkable, non-void, flat enough (max height delta <= 1),
 * and unoccupied by any other alive or downed unit.
 */
export function isValidFootprintAnchor(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  col: number,
  row: number,
  footprintSize: 1 | 2,
  ignoreUnitUid?: string
): boolean {
  const cells = getFootprintCellsAt(col, row, footprintSize)
  let minH = 99
  let maxH = -99
  for (const c of cells) {
    if (!inGridBounds(c.col, c.row, battle.cols, battle.rows)) return false
    const cell = battle.cells[c.row]?.[c.col]
    if (!cell || !cell.walkable || !terrainWalkable(cell.terrain) || cell.terrain === 'void') {
      return false
    }
    const h = cellHeightLevel(cell)
    if (h < minH) minH = h
    if (h > maxH) maxH = h
    for (const u of battle.units) {
      if (u.uid === ignoreUnitUid) continue
      if (!u.alive && !isUnitDowned(u)) continue
      if (unitOccupiesCell(u, c.col, c.row)) return false
    }
  }
  return maxH - minH <= 1
}

function canFootprintStep(
  fromCell: GridCell,
  toCell: GridCell,
  jump: number
): boolean {
  const diff = Math.abs(cellHeightLevel(toCell) - cellHeightLevel(fromCell))
  const isRamp = fromCell.terrain === 'stairs' || toCell.terrain === 'stairs'
  return diff <= (isRamp ? jump + 1 : jump)
}

/**
 * Compute valid 2x2 anchor perches a multi-tile boss can move/leap to within its move/jump budget.
 * Every intermediate and final anchor respects full 2x2 walkability and unit collision.
 */
export function computeFootprintMoveTiles(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  unit: BattleUnit,
  ignoreMoved = false
): GridCoord[] {
  const size = getUnitFootprintSize(unit)
  if (!unit.alive || (!ignoreMoved && unit.moved) || unit.stunTurns > 0) return []
  const maxMove = Math.max(1, unit.move - (unit.slowTurns > 0 ? 1 : 0))
  const visited = new Map<string, number>()
  const queue: { col: number; row: number; dist: number }[] = [{ col: unit.col, row: unit.row, dist: 0 }]
  visited.set(`${unit.col},${unit.row}`, 0)
  const out: GridCoord[] = []

  while (queue.length > 0) {
    const cur = queue.shift()
    if (!cur) break
    if (cur.dist > 0) {
      out.push({ col: cur.col, row: cur.row })
    }
    if (cur.dist >= maxMove) continue
    const fromCell = battle.cells[cur.row][cur.col]
    for (const [dc, dr] of CARDINAL_DIRS) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      const key = `${nc},${nr}`
      const nextDist = cur.dist + 1
      const prev = visited.get(key)
      if (prev !== undefined && nextDist >= prev) continue
      if (!isValidFootprintAnchor(battle, nc, nr, size, unit.uid)) continue
      const toCell = battle.cells[nr][nc]
      if (!canFootprintStep(fromCell, toCell, unit.jump)) continue
      visited.set(key, nextDist)
      queue.push({ col: nc, row: nr, dist: nextDist })
    }
  }
  return out
}

/** Shortest anchor-step path for a 2x2 raid boss moving from its current perch to `(goalCol, goalRow)`. */
export function findFootprintPath(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  unit: BattleUnit,
  goalCol: number,
  goalRow: number
): GridCoord[] {
  const size = getUnitFootprintSize(unit)
  if (unit.col === goalCol && unit.row === goalRow) return []
  const maxMove = Math.max(1, unit.move - (unit.slowTurns > 0 ? 1 : 0))
  const visited = new Set<string>([`${unit.col},${unit.row}`])
  const parent = new Map<string, GridCoord | null>()
  parent.set(`${unit.col},${unit.row}`, null)
  const queue: { col: number; row: number; dist: number }[] = [{ col: unit.col, row: unit.row, dist: 0 }]
  let found = false

  while (queue.length > 0) {
    const cur = queue.shift()
    if (!cur) break
    if (cur.col === goalCol && cur.row === goalRow) {
      found = true
      break
    }
    if (cur.dist >= maxMove) continue
    const fromCell = battle.cells[cur.row][cur.col]
    for (const [dc, dr] of CARDINAL_DIRS) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      const key = `${nc},${nr}`
      if (visited.has(key)) continue
      if (!isValidFootprintAnchor(battle, nc, nr, size, unit.uid)) continue
      const toCell = battle.cells[nr][nc]
      if (!canFootprintStep(fromCell, toCell, unit.jump)) continue
      visited.add(key)
      parent.set(key, { col: cur.col, row: cur.row })
      queue.push({ col: nc, row: nr, dist: cur.dist + 1 })
    }
  }

  if (!found) return []
  const path: GridCoord[] = []
  let curr: GridCoord | null = { col: goalCol, row: goalRow }
  while (curr && !(curr.col === unit.col && curr.row === unit.row)) {
    path.push(curr)
    curr = parent.get(`${curr.col},${curr.row}`) ?? null
  }
  path.reverse()
  return path
}

/** True when `enemyId` is a Frostwyrm raid boss. */
export function isFrostwyrmArchetype(enemyId?: EnemyArchetypeId): boolean {
  return enemyId === 'frostwyrm_rimefang'
}

/** True when `enemyId` is Lich Vaelen. */
export function isLichVaelenArchetype(enemyId?: EnemyArchetypeId): boolean {
  return enemyId === 'lich_vaelen'
}

/**
 * Check whether Lich Vaelen can unleash Cursed-Soul Nova (`cooldowns[1] === 0`),
 * kept on a separate cooldown slot from Raise Skeleton (`cooldowns[0]`).
 */
export function chooseLichVaelenSoulNova(
  enemy: Pick<BattleUnit, 'enemyId' | 'cooldowns'>
): LichSoulNovaSpec | null {
  if (enemy.enemyId !== 'lich_vaelen') return null
  if (enemy.cooldowns[1] > 0) return null
  return {
    move: 'soul_nova',
    vfxMove: 'eclipse_nova',
    cooldownSlot: 1,
    cooldownTurns: LICH_VAELEN_SOUL_NOVA_COOLDOWN,
    pattern: 'cross',
    powerMul: 1.25,
    ignoreArmor: 0.45,
    status: 'poison',
    statusStacks: 2,
    element: 'poison',
    label: 'CURSED-SOUL NOVA!'
  }
}

/**
 * Compute the wide frost cone/cross cells for Rimefang's Glacial Breath aimed toward `(targetCol, targetRow)`.
 * Excludes void tiles, pillars (stone pillars act as breath cover!), and Rimefang's own 2x2 footprint.
 */
export function computeGlacialBreathCells(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  wyrm: Pick<BattleUnit, 'col' | 'row' | 'footprintSize' | 'enemyId'>,
  targetCol: number,
  targetRow: number
): GridCoord[] {
  const origin = closestFootprintCell(targetCol, targetRow, wyrm)
  const dcRaw = targetCol - origin.col
  const drRaw = targetRow - origin.row
  let dirC = 0
  let dirR = 0
  if (Math.abs(dcRaw) >= Math.abs(drRaw)) {
    dirC = dcRaw >= 0 ? 1 : -1
  } else {
    dirR = drRaw >= 0 ? 1 : -1
  }
  const perpC = dirR === 0 ? 0 : 1
  const perpR = dirC === 0 ? 0 : 1

  const candidates: GridCoord[] = [
    // Wide frost cross centered on the primary target
    { col: targetCol, row: targetRow },
    { col: targetCol + 1, row: targetRow },
    { col: targetCol - 1, row: targetRow },
    { col: targetCol, row: targetRow + 1 },
    { col: targetCol, row: targetRow - 1 },
    // Extended breath cone flare 1 tile past target along the breath axis
    { col: targetCol + dirC + perpC, row: targetRow + dirR + perpR },
    { col: targetCol + dirC - perpC, row: targetRow + dirR - perpR }
  ]

  const seen = new Set<string>()
  const out: GridCoord[] = []
  for (const c of candidates) {
    if (!inGridBounds(c.col, c.row, battle.cols, battle.rows)) continue
    if (unitOccupiesCell(wyrm, c.col, c.row)) continue
    const key = `${c.col},${c.row}`
    if (seen.has(key)) continue
    seen.add(key)
    const cell = battle.cells[c.row]?.[c.col]
    if (!cell || cell.terrain === 'void' || cell.terrain === 'pillar') continue
    out.push({ col: c.col, row: c.row })
  }
  return out
}

/**
 * Decide which signature raid attack Rimefang uses this turn:
 * - Wing Buffet: hits all allies adjacent to Rimefang's 2x2 perimeter with Knockback 2 (into pillars/chasm ledges!).
 * - Glacial Breath: wide frost cone/cross hitting the highest-value ally cluster within range 3, applying Slow + Freeze/Shatter combos.
 */
export function chooseFrostwyrmSpecial(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'>,
  wyrm: BattleUnit,
  allies: readonly BattleUnit[]
): FrostwyrmSpecialPlan | null {
  if (!isFrostwyrmArchetype(wyrm.enemyId)) return null
  const livingAllies = allies.filter(a => a.alive)
  if (livingAllies.length === 0) return null

  const adjacentAllies = livingAllies.filter(a => distanceBetweenUnits(wyrm, a) === 1)
  const breathReady = wyrm.cooldowns[0] <= 0
  const buffetReady = wyrm.cooldowns[1] <= 0

  // Prefer Wing Buffet when surrounded by 2+ adjacent heroes OR when Breath is on cooldown and a hero is adjacent
  if (buffetReady && adjacentAllies.length > 0 && (adjacentAllies.length >= 2 || !breathReady)) {
    const perimeter = getUnitPerimeterCells(battle, wyrm)
    const focus = adjacentAllies[0]
    return {
      move: 'wing_buffet',
      vfxMove: 'titan_slam',
      cooldownSlot: 1,
      cooldownTurns: FROSTWYRM_WING_BUFFET_COOLDOWN,
      targetCol: focus.col,
      targetRow: focus.row,
      cells: perimeter,
      powerMul: 1.15,
      ignoreArmor: 0.25,
      knockbackDistance: FROSTWYRM_WING_BUFFET_KNOCKBACK,
      label: 'WING BUFFET!'
    }
  }

  // Glacial Breath: pick the ally within range 3 whose breath cone hits the most heroes (preferring already-slowed/burning targets for Freeze/Shatter!)
  if (breathReady) {
    let bestAlly: BattleUnit | null = null
    let bestCells: GridCoord[] = []
    let bestScore = -1
    for (const a of livingAllies) {
      if (distanceBetweenUnits(wyrm, a) > FROSTWYRM_BREATH_RANGE) continue
      const cells = computeGlacialBreathCells(battle, wyrm, a.col, a.row)
      let score = 0
      for (const c of cells) {
        for (const candidate of livingAllies) {
          if (candidate.col === c.col && candidate.row === c.row) {
            score += 10
            if (candidate.slowTurns > 0 || candidate.burnTurns > 0) score += 6
          }
        }
      }
      if (score > bestScore) {
        bestScore = score
        bestAlly = a
        bestCells = cells
      }
    }
    if (bestAlly && bestCells.length > 0) {
      return {
        move: 'glacial_breath',
        vfxMove: 'frostwyrm_breath',
        cooldownSlot: 0,
        cooldownTurns: FROSTWYRM_BREATH_COOLDOWN,
        targetCol: bestAlly.col,
        targetRow: bestAlly.row,
        cells: bestCells,
        powerMul: 1.20,
        ignoreArmor: 0.40,
        status: 'slow',
        element: 'frost',
        label: 'GLACIAL BREATH!'
      }
    }
  }

  // Fallback to Wing Buffet if an adjacent hero is present and ready
  if (buffetReady && adjacentAllies.length > 0) {
    const perimeter = getUnitPerimeterCells(battle, wyrm)
    const focus = adjacentAllies[0]
    return {
      move: 'wing_buffet',
      vfxMove: 'titan_slam',
      cooldownSlot: 1,
      cooldownTurns: FROSTWYRM_WING_BUFFET_COOLDOWN,
      targetCol: focus.col,
      targetRow: focus.row,
      cells: perimeter,
      powerMul: 1.15,
      ignoreArmor: 0.25,
      knockbackDistance: FROSTWYRM_WING_BUFFET_KNOCKBACK,
      label: 'WING BUFFET!'
    }
  }

  return null
}
