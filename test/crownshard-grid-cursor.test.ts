import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import {
  GAMEPAD_REPEAT_INITIAL,
  GAMEPAD_REPEAT_INTERVAL,
  GAMEPAD_STICK_DEADZONE,
  createGamepadNavTracker,
  createGridCursorState,
  cycleGridCursorTarget,
  getGridCursorCycleTargets,
  pollGamepadActions,
  resolveGridCursorVisualMode,
  screenDirToFacing,
  screenDirToGridDelta,
  stepGridCursorScreenDir,
  syncGridCursorToBattle
} from '../examples/crownshard/crownshard/grid-cursor.ts'
import type { GamepadSnapshot } from '../examples/crownshard/crownshard/grid-cursor.ts'
import { CAMERA_QUARTER_TURN, createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill,
  armTacticCard,
  beginWaitFacingPicker,
  confirmDeployment,
  confirmWaitFacingPicker,
  createInitialState,
  getUnitByUid,
  previewWaitFacing,
  selectTile,
  setUnitFacing,
  startChapterBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, FacingDir } from '../examples/crownshard/crownshard/types.ts'

function fakeRenderer() {
  let drawn = 0
  let lastInstances = 0
  let lastBatches: readonly { count: number }[] = []
  const stats: RenderStats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      drawn++
      lastBatches = batches.slice()
      let n = 0
      for (const b of batches) n += b.count
      lastInstances = n
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get drawn() { return drawn },
    get lastInstances() { return lastInstances },
    get lastBatches() { return lastBatches }
  }
}

function makePadSnap(
  pressedButtons: readonly number[] = [],
  axes: readonly number[] = [0, 0, 0, 0]
): GamepadSnapshot {
  const buttons: boolean[] = Array.from({ length: 16 }, () => false)
  for (const idx of pressedButtons) {
    if (idx >= 0 && idx < buttons.length) buttons[idx] = true
  }
  return { axes, buttons }
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number, facing: FacingDir = unit.facing) {
  unit.col = col
  unit.row = row
  const cell = battle.cells[row][col]
  const [x, y, z] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.x = x
  unit.y = y
  unit.z = z
  unit.path = []
  unit.moveProgress = 0
  setUnitFacing(unit, facing)
}

function clearBoardFlat(battle: BattleState) {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = {
        col: c,
        row: r,
        terrain: 'grass',
        elevation: 0,
        walkable: true,
        heightLevel: 0
      }
    }
  }
}

test('stepGridCursorScreenDir maps screen cardinals accurately across all 4 camera yaw quadrants and clamps boundaries', () => {
  const cols = 8
  const rows = 6

  // 1. Yaw = 0 (facing North -Z): Up -> (0,-1), Down -> (0,+1), Left -> (-1,0), Right -> (+1,0)
  const cases: readonly {
    label: string
    yaw: number
    up: readonly [number, number]
    down: readonly [number, number]
    left: readonly [number, number]
    right: readonly [number, number]
  }[] = [
    { label: '0 rad (North)', yaw: 0, up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] },
    { label: '+PI/2 (West)', yaw: CAMERA_QUARTER_TURN, up: [-1, 0], down: [1, 0], left: [0, 1], right: [0, -1] },
    { label: 'PI (South)', yaw: Math.PI, up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] },
    { label: '-PI/2 (East)', yaw: -CAMERA_QUARTER_TURN, up: [1, 0], down: [-1, 0], left: [0, -1], right: [0, 1] }
  ]

  for (const c of cases) {
    assert.deepEqual(screenDirToGridDelta(0, -1, c.yaw), c.up, `${c.label} Up`)
    assert.deepEqual(screenDirToGridDelta(0, 1, c.yaw), c.down, `${c.label} Down`)
    assert.deepEqual(screenDirToGridDelta(-1, 0, c.yaw), c.left, `${c.label} Left`)
    assert.deepEqual(screenDirToGridDelta(1, 0, c.yaw), c.right, `${c.label} Right`)

    const cur = createGridCursorState()
    cur.col = 3
    cur.row = 3
    assert.equal(stepGridCursorScreenDir(cur, 0, -1, cols, rows, c.yaw), true)
    assert.equal(cur.col, 3 + c.up[0], `${c.label} step Up col`)
    assert.equal(cur.row, 3 + c.up[1], `${c.label} step Up row`)

    // Step opposite direction returns exactly to (3, 3)
    assert.equal(stepGridCursorScreenDir(cur, 0, 1, cols, rows, c.yaw), true)
    assert.equal(cur.col, 3)
    assert.equal(cur.row, 3)

    // Left then Right returns to (3, 3)
    assert.equal(stepGridCursorScreenDir(cur, -1, 0, cols, rows, c.yaw), true)
    assert.equal(cur.col, 3 + c.left[0], `${c.label} step Left col`)
    assert.equal(cur.row, 3 + c.left[1], `${c.label} step Left row`)
    assert.equal(stepGridCursorScreenDir(cur, 1, 0, cols, rows, c.yaw), true)
    assert.equal(cur.col, 3)
    assert.equal(cur.row, 3)
  }

  // Slightly off-cardinal free-orbited camera yaw still snaps cleanly to 1 cardinal tile
  assert.deepEqual(screenDirToGridDelta(0, -1, 0.28), [0, -1])
  assert.deepEqual(screenDirToGridDelta(1, 0, 0.28), [1, 0])

  // Boundary clamping at top-left (0, 0) and bottom-right (cols-1, rows-1)
  const clamped = createGridCursorState()
  clamped.col = 0
  clamped.row = 0
  assert.equal(stepGridCursorScreenDir(clamped, -1, 0, cols, rows, 0), false)
  assert.equal(stepGridCursorScreenDir(clamped, 0, -1, cols, rows, 0), false)
  assert.equal(clamped.col, 0)
  assert.equal(clamped.row, 0)

  clamped.col = cols - 1
  clamped.row = rows - 1
  assert.equal(stepGridCursorScreenDir(clamped, 1, 0, cols, rows, 0), false)
  assert.equal(stepGridCursorScreenDir(clamped, 0, 1, cols, rows, 0), false)
  assert.equal(clamped.col, cols - 1)
  assert.equal(clamped.row, rows - 1)

  // Zero delta does not move
  assert.equal(stepGridCursorScreenDir(clamped, 0, 0, cols, rows, 0), false)
})

test('screenDirToFacing matches visual cardinal directions across rotated camera yaws', () => {
  // Yaw = 0 (North): Up=n, Right=e, Down=s, Left=w
  assert.equal(screenDirToFacing(0, -1, 0), 'n')
  assert.equal(screenDirToFacing(1, 0, 0), 'e')
  assert.equal(screenDirToFacing(0, 1, 0), 's')
  assert.equal(screenDirToFacing(-1, 0, 0), 'w')

  // Yaw = +PI/2 (West): Up=w, Right=n, Down=e, Left=s
  assert.equal(screenDirToFacing(0, -1, CAMERA_QUARTER_TURN), 'w')
  assert.equal(screenDirToFacing(1, 0, CAMERA_QUARTER_TURN), 'n')
  assert.equal(screenDirToFacing(0, 1, CAMERA_QUARTER_TURN), 'e')
  assert.equal(screenDirToFacing(-1, 0, CAMERA_QUARTER_TURN), 's')

  // Yaw = PI (South): Up=s, Right=w, Down=n, Left=e
  assert.equal(screenDirToFacing(0, -1, Math.PI), 's')
  assert.equal(screenDirToFacing(1, 0, Math.PI), 'w')
  assert.equal(screenDirToFacing(0, 1, Math.PI), 'n')
  assert.equal(screenDirToFacing(-1, 0, Math.PI), 'e')

  // Yaw = -PI/2 (East): Up=e, Right=s, Down=w, Left=n
  assert.equal(screenDirToFacing(0, -1, -CAMERA_QUARTER_TURN), 'e')
  assert.equal(screenDirToFacing(1, 0, -CAMERA_QUARTER_TURN), 's')
  assert.equal(screenDirToFacing(0, 1, -CAMERA_QUARTER_TURN), 'w')
  assert.equal(screenDirToFacing(-1, 0, -CAMERA_QUARTER_TURN), 'n')
})

test('cycleGridCursorTarget cycles deploy heroes/tiles, armed skill/tactic targets, and attackable enemies', () => {
  const state = createInitialState(303)
  const battle = startChapterBattle(state, 0, 0, { deployPhase: true })
  assert.equal(battle.phase, 'deploy')

  const cursor = createGridCursorState()
  syncGridCursorToBattle(cursor, battle)
  const allies = battle.units.filter(u => u.team === 'ally' && u.alive)
  assert.ok(allies.length >= 2)
  assert.equal(cursor.col, allies[0].col)
  assert.equal(cursor.row, allies[0].row)

  // 1. Deploy phase: cycles through ally positions and open deploy tiles forward & backward
  const deployTargets = getGridCursorCycleTargets(battle)
  assert.ok(deployTargets.length >= battle.deployTiles.length)
  assert.equal(cycleGridCursorTarget(cursor, battle, 1), true)
  assert.equal(cursor.active, true)
  assert.equal(cursor.col, deployTargets[1].col)
  assert.equal(cursor.row, deployTargets[1].row)
  assert.equal(cycleGridCursorTarget(cursor, battle, -1), true)
  assert.equal(cursor.col, deployTargets[0].col)
  assert.equal(cursor.row, deployTargets[0].row)

  // 2. Enter player phase, place two enemies directly adjacent to active hero so both are attackable
  assert.equal(confirmDeployment(state), true)
  clearBoardFlat(battle)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const enemies = battle.units.filter(u => u.team === 'enemy' && u.alive)
  assert.ok(enemies.length >= 2)
  placeUnit(battle, active, 3, 2, 'e')
  placeUnit(battle, enemies[0], 4, 2, 'w')
  placeUnit(battle, enemies[1], 3, 3, 'n')
  // Recompute highlights via disarming skill (null)
  assert.equal(armSkill(state, null), true)
  assert.ok(battle.targetTiles.length >= 2, 'Both adjacent enemies should be attackable')

  // Unarmed player phase: cycles directly across attackable enemies
  cursor.col = active.col
  cursor.row = active.row
  assert.equal(cycleGridCursorTarget(cursor, battle, 1), true)
  const firstEnemyTarget = { col: cursor.col, row: cursor.row }
  assert.ok(
    (firstEnemyTarget.col === 4 && firstEnemyTarget.row === 2) ||
      (firstEnemyTarget.col === 3 && firstEnemyTarget.row === 3),
    'First cycle target should be an attackable enemy'
  )
  assert.equal(resolveGridCursorVisualMode(battle, firstEnemyTarget.col, firstEnemyTarget.row), 'attack')

  assert.equal(cycleGridCursorTarget(cursor, battle, 1), true)
  assert.ok(
    cursor.col !== firstEnemyTarget.col || cursor.row !== firstEnemyTarget.row,
    'Second cycle should advance to the other attackable enemy'
  )

  // 3. Armed skill: cycles valid highlighted skill targets
  assert.equal(armSkill(state, 0), true)
  assert.ok(battle.targetTiles.length > 0 || battle.moveAttackTiles.length > 0)
  const skillTargets = getGridCursorCycleTargets(battle)
  assert.ok(skillTargets.length > 0)
  assert.equal(cycleGridCursorTarget(cursor, battle, 1), true)
  assert.ok(
    skillTargets.some(t => t.col === cursor.col && t.row === cursor.row),
    'Armed skill cycle must land on a valid skill target tile'
  )
  armSkill(state, null)

  // 4. Armed tactic card (if any targetable card in hand): cycles tactic targets
  battle.ap = battle.maxAp
  const targetableTacticUid = battle.hand.find(uid => {
    const owned = state.campaign.tactics.find(t => t.uid === uid)
    return Boolean(owned && armTacticCard(state, uid) && battle.armedTacticUid === uid)
  })
  if (targetableTacticUid) {
    const tacticTargets = getGridCursorCycleTargets(battle)
    assert.ok(tacticTargets.length > 0)
    assert.equal(cycleGridCursorTarget(cursor, battle, 1), true)
    assert.ok(tacticTargets.some(t => t.col === cursor.col && t.row === cursor.row))
    armTacticCard(state, null)
  }

  // 5. No enemies in immediate range: falls back to active hero + enemies
  placeUnit(battle, active, 0, 0, 'e')
  for (let i = 0; i < enemies.length; i++) {
    placeUnit(battle, enemies[i], battle.cols - 1, Math.min(battle.rows - 1, i + 3), 'w')
  }
  active.move = 1
  active.range = 1
  armSkill(state, null)
  assert.equal(battle.targetTiles.length, 0)
  assert.equal(battle.moveAttackTiles.length, 0)
  const fallbackTargets = getGridCursorCycleTargets(battle)
  assert.ok(fallbackTargets.length >= 2)
  assert.equal(fallbackTargets[0].col, active.col)
  assert.equal(fallbackTargets[0].row, active.row)
})

test('complete mouse-free tactical battle turn via grid cursor: deploy swap -> confirm -> move -> attack -> wait-to-face', () => {
  const state = createInitialState(404)
  const battle = startChapterBattle(state, 0, 0, { deployPhase: true })
  const cursor = createGridCursorState()
  cursor.active = true
  cursor.inputMode = 'keyboard'

  // 1. Deploy phase: sync cursor to Hero 0, confirm to select, cycle to Hero 1, confirm to swap!
  syncGridCursorToBattle(cursor, battle)
  const allies = battle.units.filter(u => u.team === 'ally' && u.alive)
  const heroA = allies[0]
  const heroB = allies[1]
  const origACol = heroA.col
  const origARow = heroA.row
  const origBCol = heroB.col
  const origBRow = heroB.row

  assert.equal(cursor.col, origACol)
  assert.equal(cursor.row, origARow)
  assert.equal(selectTile(state, cursor.col, cursor.row), true, 'Confirm on Hero A selects Hero A for deployment')
  assert.equal(battle.selectedUnitUid, heroA.uid)

  // Cycle cursor onto Hero B and confirm swap
  assert.equal(cycleGridCursorTarget(cursor, battle, 1), true)
  assert.equal(cursor.col, origBCol)
  assert.equal(cursor.row, origBRow)
  assert.equal(selectTile(state, cursor.col, cursor.row), true, 'Confirm on Hero B swaps Hero A and Hero B')
  assert.equal(heroA.col, origBCol)
  assert.equal(heroA.row, origBRow)
  assert.equal(heroB.col, origACol)
  assert.equal(heroB.row, origARow)

  // 2. Confirm deployment to start battle
  assert.equal(confirmDeployment(state), true)
  assert.equal(battle.phase, 'player')

  // Normalize board terrain around active hero & one foe so step-by-step arrow movement is deterministic
  clearBoardFlat(battle)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.team === 'enemy' && u.alive)!
  for (const u of battle.units) {
    if (u.uid !== active.uid && u.uid !== enemy.uid) {
      placeUnit(battle, u, 0, battle.rows - 1)
    }
  }
  placeUnit(battle, active, 2, 2, 'e')
  placeUnit(battle, enemy, 4, 2, 'w')
  active.move = 3
  active.range = 1
  armSkill(state, null)

  // 3. Snap cursor to active hero, step Right (+1, 0) via camera-aligned arrow into reachable tile (3, 2), confirm move
  syncGridCursorToBattle(cursor, battle, true)
  assert.equal(cursor.col, 2)
  assert.equal(cursor.row, 2)
  assert.equal(stepGridCursorScreenDir(cursor, 1, 0, battle.cols, battle.rows, 0), true)
  assert.equal(cursor.col, 3)
  assert.equal(cursor.row, 2)
  assert.equal(selectTile(state, cursor.col, cursor.row), true, 'Confirm move via grid cursor starts path')
  assert.equal(active.moved, true)

  // Advance simulation until walk finishes
  for (let i = 0; i < 60 && active.path.length > 0; i++) {
    stepGame(state, 1 / 30)
  }
  assert.equal(active.path.length, 0)
  assert.equal(active.col, 3)
  assert.equal(active.row, 2)

  // 4. Cycle to adjacent enemy at (4, 2) and confirm basic attack!
  const hpBefore = enemy.hp + enemy.shield
  assert.equal(cycleGridCursorTarget(cursor, battle, 1), true)
  assert.equal(cursor.col, 4)
  assert.equal(cursor.row, 2)
  assert.equal(selectTile(state, cursor.col, cursor.row), true, 'Confirm attack on cycled enemy')
  assert.ok(enemy.hp + enemy.shield < hpBefore, 'Enemy must take damage from cursor-confirmed attack')

  // If the turn did not auto-end (hero can still wait-to-face) or on next ally turn, test facing picker via screenDirToFacing
  if (battle.phase === 'player') {
    const pickerActive = getUnitByUid(battle, battle.activeUnitUid)!
    const turnBefore = battle.turn
    assert.equal(beginWaitFacingPicker(state), true)
    // Rotate camera 90 degrees CW (+PI/2): pressing screen Up (0, -1) selects 'w'
    const chosenFacing = screenDirToFacing(0, -1, CAMERA_QUARTER_TURN)
    assert.equal(chosenFacing, 'w')
    assert.equal(previewWaitFacing(state, chosenFacing), true)
    assert.equal(battle.facingPicker?.previewFacing, 'w')
    assert.equal(confirmWaitFacingPicker(state), true)
    assert.equal(battle.facingPicker, null)
    assert.equal(pickerActive.facing, 'w')
    assert.equal(battle.turn, turnBefore + 1)
  }
})

test('CrownshardScene renders 3D board cursor dynamically across all 4 modes without modifying static map batches', () => {
  const state = createInitialState(505)
  const battle = startChapterBattle(state, 0, 0, { deployPhase: true })
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  // Baseline frame without cursor
  scene.setGridCursor(null)
  scene.render(state, 1 / 60, 1280, 720)
  const baseInstances = fake.lastInstances
  const staticBatchCountBefore = fake.lastBatches[0]?.count ?? 0

  // Active cursor via setGridCursor adds sculpted 3D brackets + frame + diamond + floating crystal (4 dynamic instances)
  scene.setGridCursor({ col: 1, row: 2, active: true, mode: 'deploy' })
  scene.render(state, 1 / 60, 1280, 720)
  assert.ok(fake.lastInstances >= baseInstances + 4, `Expected >= 4 dynamic cursor instances (got ${fake.lastInstances} vs ${baseInstances})`)
  assert.equal(fake.lastBatches[0]?.count ?? 0, staticBatchCountBefore, 'Static map batch must remain untouched')

  // Switch to player phase and verify render(..., { gridCursor }) override works for every mode
  confirmDeployment(state)
  scene.setGridCursor(null)
  scene.render(state, 1 / 60, 1280, 720)
  const playerBase = fake.lastInstances

  for (const mode of ['normal', 'attack', 'ally', 'deploy'] as const) {
    scene.render(state, 1 / 60, 1280, 720, { gridCursor: { col: 2, row: 2, active: true, mode } })
    assert.ok(fake.lastInstances >= playerBase + 4, `Mode "${mode}" should emit dynamic 3D cursor instances`)
  }

  // Inactive cursor adds zero instances
  scene.render(state, 1 / 60, 1280, 720, { gridCursor: { col: 2, row: 2, active: false, mode: 'normal' } })
  assert.equal(fake.lastInstances, playerBase)
})

test('GamepadNavTracker handles edge-triggers, deadzone filtering, and hold-to-repeat timing accurately', () => {
  const tracker = createGamepadNavTracker()

  // 1. Deadzone filtering: below 0.45 produces zero actions
  const belowDz = pollGamepadActions(tracker, makePadSnap([], [GAMEPAD_STICK_DEADZONE - 0.01, -0.44]), 0.016)
  assert.equal(belowDz.length, 0)

  // 2. Left stick past deadzone emits immediately, holds cleanly for 0.32s initial delay, then repeats every 0.11s
  const rightStick = makePadSnap([], [0.85, 0.1])
  const a0 = pollGamepadActions(tracker, rightStick, 0.016)
  assert.deepEqual(a0, [{ kind: 'move', dx: 1, dy: 0 }])

  // Holding for 0.20s (< 0.32s) -> no repeat yet
  assert.equal(pollGamepadActions(tracker, rightStick, 0.20).length, 0)
  // Holding another 0.12s (total 0.32s == GAMEPAD_REPEAT_INITIAL) -> first repeat triggers!
  const a1 = pollGamepadActions(tracker, rightStick, GAMEPAD_REPEAT_INITIAL - 0.20)
  assert.deepEqual(a1, [{ kind: 'move', dx: 1, dy: 0 }])

  // Holding 0.05s (< 0.11s) -> no repeat yet
  assert.equal(pollGamepadActions(tracker, rightStick, 0.05).length, 0)
  // Holding another 0.06s (total 0.11s == GAMEPAD_REPEAT_INTERVAL) -> second repeat triggers!
  const a2 = pollGamepadActions(tracker, rightStick, GAMEPAD_REPEAT_INTERVAL - 0.05)
  assert.deepEqual(a2, [{ kind: 'move', dx: 1, dy: 0 }])

  // Changing direction immediately emits without waiting for repeat timer
  const dpadUp = makePadSnap([12])
  const a3 = pollGamepadActions(tracker, dpadUp, 0.016)
  assert.deepEqual(a3, [{ kind: 'move', dx: 0, dy: -1 }])

  // Release resets directional state
  assert.equal(pollGamepadActions(tracker, makePadSnap(), 0.016).length, 0)

  // Diagonal stick resolves to dominant cardinal axis
  const diagStickVert = makePadSnap([], [0.55, -0.92])
  const a4 = pollGamepadActions(tracker, diagStickVert, 0.016)
  assert.deepEqual(a4, [{ kind: 'move', dx: 0, dy: -1 }])

  const diagStickHoriz = makePadSnap([], [-0.90, 0.50])
  const a5 = pollGamepadActions(tracker, diagStickHoriz, 0.016)
  assert.deepEqual(a5, [{ kind: 'move', dx: -1, dy: 0 }])

  // Release resets directional state again
  assert.equal(pollGamepadActions(tracker, makePadSnap(), 0.016).length, 0)

  // 3. All 9 W3C buttons are strictly edge-triggered
  const buttonMappings: readonly (readonly [number, string])[] = [
    [0, 'confirm'],
    [1, 'cancel'],
    [2, 'actionX'],
    [3, 'actionY'],
    [4, 'prev'],
    [5, 'next'],
    [6, 'camLeft'],
    [7, 'camRight'],
    [9, 'pause']
  ]
  for (const [btnIndex, expectedKind] of buttonMappings) {
    const rising = pollGamepadActions(tracker, makePadSnap([btnIndex]), 0.016)
    assert.deepEqual(rising, [{ kind: expectedKind, dx: 0, dy: 0 }], `Button ${btnIndex} rising edge`)

    // Still held -> must NOT re-fire
    const held = pollGamepadActions(tracker, makePadSnap([btnIndex]), 0.5)
    assert.equal(held.length, 0, `Button ${btnIndex} held should not re-trigger`)

    // Released -> no action
    assert.equal(pollGamepadActions(tracker, makePadSnap([]), 0.016).length, 0)

    // Re-pressed -> fires again
    const repressed = pollGamepadActions(tracker, makePadSnap([btnIndex]), 0.016)
    assert.deepEqual(repressed, [{ kind: expectedKind, dx: 0, dy: 0 }], `Button ${btnIndex} re-press`)

    // Clean release before next button
    pollGamepadActions(tracker, makePadSnap([]), 0.016)
  }

  // 4. Null snapshot (gamepad disconnected) safely resets all state
  pollGamepadActions(tracker, makePadSnap([0, 12]), 0.016)
  assert.equal(pollGamepadActions(tracker, null, 0.016).length, 0)
  const afterReconnect = pollGamepadActions(tracker, makePadSnap([0]), 0.016)
  assert.deepEqual(afterReconnect, [{ kind: 'confirm', dx: 0, dy: 0 }])
})

test('grid-cursor.ts is browser-global-free, registered in godotEntries, and compiles cleanly via compileTsToGd', () => {
  const cursorPath = resolve('examples/crownshard/crownshard/grid-cursor.ts')
  const source = readFileSync(cursorPath, 'utf8')

  for (const forbidden of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'HTMLElement']) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`).test(source),
      false,
      `grid-cursor.ts must not reference browser global "${forbidden}"`
    )
  }

  const pkg = JSON.parse(readFileSync(resolve('examples/crownshard/package.json'), 'utf8')) as {
    ridgetop?: { godotEntries?: string[] }
  }
  assert.ok(
    pkg.ridgetop?.godotEntries?.includes('crownshard/grid-cursor.ts'),
    'examples/crownshard/package.json ridgetop.godotEntries must include "crownshard/grid-cursor.ts"'
  )

  const gd = compileTsToGd(source, 'grid-cursor.ts')
  assert.ok(gd.length > 200, 'compileTsToGd must emit non-trivial GDScript for grid-cursor.ts')
  assert.ok(gd.includes('func createGridCursorState'), 'GDScript output must contain createGridCursorState')
  assert.ok(gd.includes('func stepGridCursorScreenDir'), 'GDScript output must contain stepGridCursorScreenDir')
  assert.ok(gd.includes('func cycleGridCursorTarget'), 'GDScript output must contain cycleGridCursorTarget')
  assert.ok(gd.includes('func screenDirToFacing'), 'GDScript output must contain screenDirToFacing')
  assert.ok(gd.includes('func pollGamepadActions'), 'GDScript output must contain pollGamepadActions')
})
