import { isUnitDowned, vectorToFacing } from './types.ts'
import type { BattleState, BattleUnit, FacingDir, GridCoord } from './types.ts'

export type GridCursorInputMode = 'pointer' | 'keyboard' | 'gamepad'
export type GridCursorVisualMode = 'normal' | 'attack' | 'ally' | 'deploy'

export interface GridCursorState {
  active: boolean
  col: number
  row: number
  inputMode: GridCursorInputMode
}

export interface GridCursorRenderSpec {
  readonly col: number
  readonly row: number
  readonly active: boolean
  readonly mode: GridCursorVisualMode
}

export interface GamepadSnapshot {
  readonly axes: readonly number[]
  readonly buttons: readonly boolean[]
}

export type GamepadNavActionKind =
  | 'move'
  | 'confirm'
  | 'cancel'
  | 'actionX'
  | 'actionY'
  | 'prev'
  | 'next'
  | 'camLeft'
  | 'camRight'
  | 'pause'

export interface GamepadNavAction {
  readonly kind: GamepadNavActionKind
  readonly dx: -1 | 0 | 1
  readonly dy: -1 | 0 | 1
}

export interface GamepadNavTracker {
  lastDx: -1 | 0 | 1
  lastDy: -1 | 0 | 1
  repeatTimer: number
  repeating: boolean
  prevConfirm: boolean
  prevCancel: boolean
  prevActionX: boolean
  prevActionY: boolean
  prevPrev: boolean
  prevNext: boolean
  prevCamLeft: boolean
  prevCamRight: boolean
  prevPause: boolean
}

export const GAMEPAD_STICK_DEADZONE = 0.45
export const GAMEPAD_REPEAT_INITIAL = 0.32
export const GAMEPAD_REPEAT_INTERVAL = 0.11

/** Create an inactive, uninitialized board grid cursor state. */
export function createGridCursorState(): GridCursorState {
  return {
    active: false,
    col: -1,
    row: -1,
    inputMode: 'pointer'
  }
}

function clampGridCoord(value: number, limit: number): number {
  if (limit <= 0) return 0
  if (value < 0) return 0
  if (value >= limit) return limit - 1
  return Math.trunc(value)
}

function findUnitByUid(battle: BattleState, uid: string | null): BattleUnit | null {
  if (!uid) return null
  for (let i = 0; i < battle.units.length; i++) {
    const unit = battle.units[i]
    if (unit.uid === uid) return unit
  }
  return null
}

function findAnchorCoord(battle: BattleState): GridCoord {
  if (battle.phase === 'deploy') {
    const selected = findUnitByUid(battle, battle.selectedUnitUid)
    if (selected && selected.alive && selected.team === 'ally') {
      return { col: selected.col, row: selected.row }
    }
    for (let i = 0; i < battle.units.length; i++) {
      const u = battle.units[i]
      if (u.alive && u.team === 'ally') {
        return { col: u.col, row: u.row }
      }
    }
    if (battle.deployTiles.length > 0) {
      return { col: battle.deployTiles[0].col, row: battle.deployTiles[0].row }
    }
    return { col: 0, row: 0 }
  }

  const active = findUnitByUid(battle, battle.activeUnitUid)
  if (active && active.alive) {
    return { col: active.col, row: active.row }
  }
  const selected = findUnitByUid(battle, battle.selectedUnitUid)
  if (selected && selected.alive) {
    return { col: selected.col, row: selected.row }
  }
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (u.alive && u.team === 'ally') {
      return { col: u.col, row: u.row }
    }
  }
  return { col: 0, row: 0 }
}

/**
 * Clamp cursor coordinates in-bounds for `battle`, and snap to the active hero
 * (or first deploy hero in `'deploy'` phase) if uninitialized or when `snapToAnchor` is true.
 */
export function syncGridCursorToBattle(
  cursor: GridCursorState,
  battle: BattleState | null,
  snapToAnchor = false
): GridCursorState {
  if (!battle || battle.cols <= 0 || battle.rows <= 0) return cursor
  const uninitialized = cursor.col < 0 || cursor.row < 0
  if (uninitialized || snapToAnchor) {
    const anchor = findAnchorCoord(battle)
    cursor.col = clampGridCoord(anchor.col, battle.cols)
    cursor.row = clampGridCoord(anchor.row, battle.rows)
    return cursor
  }
  cursor.col = clampGridCoord(cursor.col, battle.cols)
  cursor.row = clampGridCoord(cursor.row, battle.rows)
  return cursor
}

function cardinalDeltaFromScreenAxis(dx: number, dy: number, cosYaw: number, sinYaw: number): readonly [number, number] {
  const worldDx = dx * cosYaw + dy * sinYaw
  const worldDz = -dx * sinYaw + dy * cosYaw
  if (Math.abs(worldDx) >= Math.abs(worldDz)) {
    return [worldDx >= 0 ? 1 : -1, 0]
  }
  return [0, worldDz >= 0 ? 1 : -1]
}

/**
 * Convert screen-space cardinal input (`screenDx` Right=+1/Left=-1, `screenDy` Down=+1/Up=-1)
 * into grid `(dCol, dRow)` aligned with the 3D battle camera's current `cameraYaw`.
 */
export function screenDirToGridDelta(
  screenDx: number,
  screenDy: number,
  cameraYaw: number
): readonly [number, number] {
  const sx = screenDx > 0 ? 1 : screenDx < 0 ? -1 : 0
  const sy = screenDy > 0 ? 1 : screenDy < 0 ? -1 : 0
  if (sx === 0 && sy === 0) return [0, 0]
  const safeYaw = Number.isFinite(cameraYaw) ? cameraYaw : 0
  const cosYaw = Math.cos(safeYaw)
  const sinYaw = Math.sin(safeYaw)
  let dCol = 0
  let dRow = 0
  if (sx !== 0) {
    const stepX = cardinalDeltaFromScreenAxis(sx, 0, cosYaw, sinYaw)
    dCol += stepX[0]
    dRow += stepX[1]
  }
  if (sy !== 0) {
    const stepY = cardinalDeltaFromScreenAxis(0, sy, cosYaw, sinYaw)
    dCol += stepY[0]
    dRow += stepY[1]
  }
  const clampedCol = dCol > 1 ? 1 : dCol < -1 ? -1 : dCol
  const clampedRow = dRow > 1 ? 1 : dRow < -1 ? -1 : dRow
  return [clampedCol, clampedRow]
}

/**
 * Step `cursor` one tile along screen-space `(screenDx, screenDy)` relative to `cameraYaw`,
 * clamping strictly to `[0..cols-1, 0..rows-1]`. Returns `true` if the tile changed.
 */
export function stepGridCursorScreenDir(
  cursor: GridCursorState,
  screenDx: number,
  screenDy: number,
  cols: number,
  rows: number,
  cameraYaw: number
): boolean {
  if (cols <= 0 || rows <= 0) return false
  const delta = screenDirToGridDelta(screenDx, screenDy, cameraYaw)
  const startCol = clampGridCoord(cursor.col < 0 ? 0 : cursor.col, cols)
  const startRow = clampGridCoord(cursor.row < 0 ? 0 : cursor.row, rows)
  const nextCol = clampGridCoord(startCol + delta[0], cols)
  const nextRow = clampGridCoord(startRow + delta[1], rows)
  const changed = nextCol !== cursor.col || nextRow !== cursor.row
  cursor.col = nextCol
  cursor.row = nextRow
  return changed
}

/**
 * Convert screen-space directional input (`screenDx`, `screenDy`) to the exact visual
 * cardinal world `FacingDir` ('n' | 'e' | 's' | 'w') at the current `cameraYaw`.
 */
export function screenDirToFacing(screenDx: number, screenDy: number, cameraYaw: number): FacingDir {
  const sx = screenDx > 0 ? 1 : screenDx < 0 ? -1 : 0
  const sy = screenDy > 0 ? 1 : screenDy < 0 ? -1 : 0
  if (sx === 0 && sy === 0) return 'n'
  const safeYaw = Number.isFinite(cameraYaw) ? cameraYaw : 0
  const cosYaw = Math.cos(safeYaw)
  const sinYaw = Math.sin(safeYaw)
  const worldDx = sx * cosYaw + sy * sinYaw
  const worldDz = -sx * sinYaw + sy * cosYaw
  return vectorToFacing(worldDx, worldDz, 'n')
}

function coordListHas(list: readonly GridCoord[], col: number, row: number): boolean {
  for (let i = 0; i < list.length; i++) {
    if (list[i].col === col && list[i].row === row) return true
  }
  return false
}

function pushUniqueCoord(list: GridCoord[], battle: BattleState, col: number, row: number): void {
  if (col < 0 || col >= battle.cols || row < 0 || row >= battle.rows) return
  const cell = battle.cells[row]?.[col]
  if (!cell || cell.terrain === 'void') return
  if (!coordListHas(list, col, row)) {
    list.push({ col, row })
  }
}

function unitOccupiesTile(unit: BattleUnit, col: number, row: number): boolean {
  const size = unit.footprintSize ?? 1
  return col >= unit.col && col < unit.col + size && row >= unit.row && row < unit.row + size
}

function findUnitAtTile(battle: BattleState, col: number, row: number, includeDowned: boolean): BattleUnit | null {
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (!u.alive && !(includeDowned && isUnitDowned(u))) continue
    if (unitOccupiesTile(u, col, row)) return u
  }
  return null
}

function isTileIntactBarricade(battle: BattleState, col: number, row: number): boolean {
  const cell = battle.cells[row]?.[col]
  if (!cell || cell.terrain !== 'barricade') return false
  return (cell.barricadeHp ?? 1) > 0
}

function isClaimedChest(battle: BattleState, col: number, row: number): boolean {
  const claimed = battle.objective.claimedChests
  for (let i = 0; i < claimed.length; i++) {
    if (claimed[i].col === col && claimed[i].row === row) return true
  }
  return false
}

/**
 * Collect prioritized smart-cycle candidates for the current battle phase & armed state.
 */
export function getGridCursorCycleTargets(battle: BattleState): GridCoord[] {
  const candidates: GridCoord[] = []
  if (battle.cols <= 0 || battle.rows <= 0) return candidates

  if (battle.phase === 'deploy') {
    for (let i = 0; i < battle.units.length; i++) {
      const u = battle.units[i]
      if (u.alive && u.team === 'ally') {
        pushUniqueCoord(candidates, battle, u.col, u.row)
      }
    }
    for (let i = 0; i < battle.deployTiles.length; i++) {
      const tile = battle.deployTiles[i]
      pushUniqueCoord(candidates, battle, tile.col, tile.row)
    }
    return candidates
  }

  if (battle.phase !== 'player') {
    return candidates
  }

  const hasArmedSkill = battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0
  const hasArmedTactic = battle.armedTacticUid !== null && battle.armedTacticUid !== ''

  if (hasArmedSkill || hasArmedTactic) {
    const occupiedTargets: GridCoord[] = []
    const allTargets: GridCoord[] = []
    for (let i = 0; i < battle.targetTiles.length; i++) {
      const t = battle.targetTiles[i]
      pushUniqueCoord(allTargets, battle, t.col, t.row)
      const occ = findUnitAtTile(battle, t.col, t.row, true)
      if (occ || isTileIntactBarricade(battle, t.col, t.row)) {
        pushUniqueCoord(occupiedTargets, battle, t.col, t.row)
      }
    }
    for (let i = 0; i < battle.moveAttackTiles.length; i++) {
      const t = battle.moveAttackTiles[i]
      pushUniqueCoord(allTargets, battle, t.col, t.row)
      const occ = findUnitAtTile(battle, t.col, t.row, true)
      if (occ || isTileIntactBarricade(battle, t.col, t.row)) {
        pushUniqueCoord(occupiedTargets, battle, t.col, t.row)
      }
    }
    if (occupiedTargets.length > 0) return occupiedTargets
    return allTargets
  }

  // Player phase with nothing armed: prioritize directly attackable and move+attack targets
  for (let i = 0; i < battle.targetTiles.length; i++) {
    const t = battle.targetTiles[i]
    pushUniqueCoord(candidates, battle, t.col, t.row)
  }
  for (let i = 0; i < battle.moveAttackTiles.length; i++) {
    const t = battle.moveAttackTiles[i]
    pushUniqueCoord(candidates, battle, t.col, t.row)
  }
  if (candidates.length > 0) {
    return candidates
  }

  // Fallback when no enemies are in immediate strike range: active hero, interesting reachable tiles, then enemies
  const active = findUnitByUid(battle, battle.activeUnitUid)
  if (active && active.alive) {
    pushUniqueCoord(candidates, battle, active.col, active.row)
  }

  const goalTile = battle.objective.goalTile
  if (goalTile && coordListHas(battle.moveTiles, goalTile.col, goalTile.row)) {
    pushUniqueCoord(candidates, battle, goalTile.col, goalTile.row)
  }
  for (let i = 0; i < battle.objective.chestTiles.length; i++) {
    const ct = battle.objective.chestTiles[i]
    if (!isClaimedChest(battle, ct.col, ct.row) && coordListHas(battle.moveTiles, ct.col, ct.row)) {
      pushUniqueCoord(candidates, battle, ct.col, ct.row)
    }
  }
  for (let i = 0; i < battle.moveTiles.length; i++) {
    const mt = battle.moveTiles[i]
    const cell = battle.cells[mt.row]?.[mt.col]
    if (cell && cell.terrain === 'shrine' && !cell.shrineUsed) {
      pushUniqueCoord(candidates, battle, mt.col, mt.row)
    }
  }
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (u.alive && u.team === 'enemy') {
      pushUniqueCoord(candidates, battle, u.col, u.row)
    }
  }
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (u.alive && u.team === 'ally') {
      pushUniqueCoord(candidates, battle, u.col, u.row)
    }
  }
  return candidates
}

/**
 * Cycle the grid cursor across smart targets (`direction`: `1` forward, `-1` backward).
 * Activates the cursor on success and returns `true` if a target was selected.
 */
export function cycleGridCursorTarget(
  cursor: GridCursorState,
  battle: BattleState | null,
  direction: 1 | -1
): boolean {
  if (!battle) return false
  const candidates = getGridCursorCycleTargets(battle)
  if (candidates.length === 0) return false

  let currentIndex = -1
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].col === cursor.col && candidates[i].row === cursor.row) {
      currentIndex = i
      break
    }
  }

  let nextIndex = 0
  if (currentIndex < 0) {
    nextIndex = direction >= 0 ? 0 : candidates.length - 1
  } else {
    const step = direction >= 0 ? 1 : -1
    nextIndex = (currentIndex + step + candidates.length) % candidates.length
  }

  const chosen = candidates[nextIndex]
  cursor.col = chosen.col
  cursor.row = chosen.row
  cursor.active = true
  return true
}

/**
 * Determine the high-contrast 3D cursor visual tint mode for tile `(col, row)`.
 */
export function resolveGridCursorVisualMode(
  battle: BattleState | null,
  col: number,
  row: number
): GridCursorVisualMode {
  if (!battle) return 'normal'
  if (battle.phase === 'deploy') return 'deploy'
  if (battle.phase !== 'player') return 'normal'

  const isTarget = coordListHas(battle.targetTiles, col, row) || coordListHas(battle.moveAttackTiles, col, row)
  const occ = findUnitAtTile(battle, col, row, true)
  if (isTarget) {
    if (occ && occ.team === 'ally') return 'ally'
    return 'attack'
  }
  if (occ && occ.team === 'ally') return 'ally'
  return 'normal'
}

/** Create a pure edge-detection and hold-to-repeat state machine for W3C standard gamepads. */
export function createGamepadNavTracker(): GamepadNavTracker {
  return {
    lastDx: 0,
    lastDy: 0,
    repeatTimer: 0,
    repeating: false,
    prevConfirm: false,
    prevCancel: false,
    prevActionX: false,
    prevActionY: false,
    prevPrev: false,
    prevNext: false,
    prevCamLeft: false,
    prevCamRight: false,
    prevPause: false
  }
}

function readSnapButton(snap: GamepadSnapshot, index: number): boolean {
  return index >= 0 && index < snap.buttons.length ? Boolean(snap.buttons[index]) : false
}

function readSnapAxis(snap: GamepadSnapshot, index: number): number {
  if (index < 0 || index >= snap.axes.length) return 0
  const value = snap.axes[index]
  return Number.isFinite(value) ? value : 0
}

/**
 * Poll a plain W3C standard gamepad snapshot (`axes` + `buttons`) and emit discrete
 * edge-triggered button actions and hold-to-repeat directional moves.
 * Zero browser globals — 100% pure and unit-testable.
 */
export function pollGamepadActions(
  tracker: GamepadNavTracker,
  snap: GamepadSnapshot | null,
  dt: number
): GamepadNavAction[] {
  const actions: GamepadNavAction[] = []
  if (!snap) {
    tracker.lastDx = 0
    tracker.lastDy = 0
    tracker.repeatTimer = 0
    tracker.repeating = false
    tracker.prevConfirm = false
    tracker.prevCancel = false
    tracker.prevActionX = false
    tracker.prevActionY = false
    tracker.prevPrev = false
    tracker.prevNext = false
    tracker.prevCamLeft = false
    tracker.prevCamRight = false
    tracker.prevPause = false
    return actions
  }

  // D-pad (W3C standard mapping: 12=Up, 13=Down, 14=Left, 15=Right)
  const dpadUp = readSnapButton(snap, 12)
  const dpadDown = readSnapButton(snap, 13)
  const dpadLeft = readSnapButton(snap, 14)
  const dpadRight = readSnapButton(snap, 15)

  let dx: -1 | 0 | 1 = dpadRight && !dpadLeft ? 1 : dpadLeft && !dpadRight ? -1 : 0
  let dy: -1 | 0 | 1 = dpadDown && !dpadUp ? 1 : dpadUp && !dpadDown ? -1 : 0

  // Left stick (axes 0 = X, 1 = Y) with deadzone 0.45 when D-pad is idle on an axis
  const axisX = readSnapAxis(snap, 0)
  const axisY = readSnapAxis(snap, 1)
  const usedStickX = dx === 0 && Math.abs(axisX) >= GAMEPAD_STICK_DEADZONE
  const usedStickY = dy === 0 && Math.abs(axisY) >= GAMEPAD_STICK_DEADZONE
  if (usedStickX) {
    dx = axisX > 0 ? 1 : -1
  }
  if (usedStickY) {
    dy = axisY > 0 ? 1 : -1
  }
  // Favor dominant cardinal axis when tilted diagonally on the analog stick
  if (usedStickX && usedStickY && dx !== 0 && dy !== 0) {
    if (Math.abs(axisX) >= Math.abs(axisY)) {
      dy = 0
    } else {
      dx = 0
    }
  }

  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0
  if (dx === 0 && dy === 0) {
    tracker.lastDx = 0
    tracker.lastDy = 0
    tracker.repeatTimer = 0
    tracker.repeating = false
  } else if (dx !== tracker.lastDx || dy !== tracker.lastDy) {
    actions.push({ kind: 'move', dx, dy })
    tracker.lastDx = dx
    tracker.lastDy = dy
    tracker.repeatTimer = GAMEPAD_REPEAT_INITIAL
    tracker.repeating = false
  } else {
    tracker.repeatTimer -= safeDt
    if (tracker.repeatTimer <= 1e-6) {
      actions.push({ kind: 'move', dx, dy })
      tracker.repeating = true
      tracker.repeatTimer = GAMEPAD_REPEAT_INTERVAL
    }
  }

  // Standard W3C buttons: A=0, B=1, X=2, Y=3, LB=4, RB=5, LT=6, RT=7, Start=9
  const confirmNow = readSnapButton(snap, 0)
  if (confirmNow && !tracker.prevConfirm) actions.push({ kind: 'confirm', dx: 0, dy: 0 })
  tracker.prevConfirm = confirmNow

  const cancelNow = readSnapButton(snap, 1)
  if (cancelNow && !tracker.prevCancel) actions.push({ kind: 'cancel', dx: 0, dy: 0 })
  tracker.prevCancel = cancelNow

  const actionXNow = readSnapButton(snap, 2)
  if (actionXNow && !tracker.prevActionX) actions.push({ kind: 'actionX', dx: 0, dy: 0 })
  tracker.prevActionX = actionXNow

  const actionYNow = readSnapButton(snap, 3)
  if (actionYNow && !tracker.prevActionY) actions.push({ kind: 'actionY', dx: 0, dy: 0 })
  tracker.prevActionY = actionYNow

  const prevNow = readSnapButton(snap, 4)
  if (prevNow && !tracker.prevPrev) actions.push({ kind: 'prev', dx: 0, dy: 0 })
  tracker.prevPrev = prevNow

  const nextNow = readSnapButton(snap, 5)
  if (nextNow && !tracker.prevNext) actions.push({ kind: 'next', dx: 0, dy: 0 })
  tracker.prevNext = nextNow

  const camLeftNow = readSnapButton(snap, 6)
  if (camLeftNow && !tracker.prevCamLeft) actions.push({ kind: 'camLeft', dx: 0, dy: 0 })
  tracker.prevCamLeft = camLeftNow

  const camRightNow = readSnapButton(snap, 7)
  if (camRightNow && !tracker.prevCamRight) actions.push({ kind: 'camRight', dx: 0, dy: 0 })
  tracker.prevCamRight = camRightNow

  const pauseNow = readSnapButton(snap, 9)
  if (pauseNow && !tracker.prevPause) actions.push({ kind: 'pause', dx: 0, dy: 0 })
  tracker.prevPause = pauseNow

  return actions
}
