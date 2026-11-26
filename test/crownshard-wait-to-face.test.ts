import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import {
  CAMERA_QUARTER_TURN,
  cameraAlignedFacing,
  createCrownshardScene,
  facingPickerAnchor
} from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill,
  beginWaitFacingPicker,
  cancelWaitFacingPicker,
  chooseOptimalTurnEndFacing,
  computeAttackArc,
  confirmWaitFacingPicker,
  createInitialState,
  evaluateAllFacingExposures,
  evaluateFacingExposure,
  getUnitByUid,
  previewWaitFacing,
  setUnitFacing,
  startChapterBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import { FACING_DIRS, facingToYaw, gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, FacingDir, GameState } from '../examples/crownshard/crownshard/types.ts'
import { drawEndTurnButton } from '../examples/crownshard/crownshard/ui-art.ts'

function fakeRenderer() {
  let drawn = 0
  let lastInstances = 0
  const stats: RenderStats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      drawn++
      let n = 0
      for (const b of batches) n += b.count
      lastInstances = n
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get drawn() { return drawn },
    get lastInstances() { return lastInstances }
  }
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

function renderFrames(
  scene: ReturnType<typeof createCrownshardScene>,
  state: GameState,
  count: number,
  dt = 1 / 60
) {
  for (let i = 0; i < count; i++) {
    stepGame(state, dt)
    scene.render(state, dt, 1280, 720)
  }
}

test('evaluateFacingExposure accurately distinguishes Safe Front vs Flank vs Backstab and ignores out-of-range foes', () => {
  const state = createInitialState(101)
  const battle = startChapterBattle(state, 0)
  clearBoardFlat(battle)

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  // Isolate a single enemy adjacent to the hero on the East
  for (let i = 1; i < enemies.length; i++) enemies[i].alive = false
  const foe = enemies[0]
  foe.move = 3
  foe.range = 1
  foe.stunTurns = 0

  placeUnit(battle, hero, 3, 2, 'e')
  placeUnit(battle, foe, 4, 2, 'w')

  // Facing East (toward foe) -> Safe Front
  const expE = evaluateFacingExposure(battle, hero.uid, 'e')
  assert.equal(expE.level, 'safe')
  assert.equal(expE.worstArc, 'front')
  assert.equal(expE.backstabCount, 0)
  assert.equal(expE.flankCount, 0)
  assert.equal(expE.warningText, null)
  assert.equal(expE.threats.length, 1)
  assert.equal(expE.threats[0].inRangeNow, true)

  // Facing North or South -> Flank exposed
  for (const dir of ['n', 's'] as const) {
    const exp = evaluateFacingExposure(battle, hero.uid, dir)
    assert.equal(exp.level, 'flank')
    assert.equal(exp.worstArc, 'flank')
    assert.equal(exp.flankCount, 1)
    assert.equal(exp.backstabCount, 0)
    assert.ok(exp.warningText && exp.warningText.includes('FLANK'))
  }

  // Facing West (away from foe) -> Backstab exposed
  const expW = evaluateFacingExposure(battle, hero.uid, 'w')
  assert.equal(expW.level, 'back')
  assert.equal(expW.worstArc, 'back')
  assert.equal(expW.backstabCount, 1)
  assert.ok(expW.warningText && expW.warningText.includes('BACKSTAB'))

  // Enemy 2 tiles away (reachable next turn with move 3 + range 1) still flags backstab when hero faces away
  placeUnit(battle, foe, 6, 2, 'w')
  const expReachable = evaluateFacingExposure(battle, hero.uid, 'w')
  assert.equal(expReachable.level, 'back')
  assert.equal(expReachable.threats.length, 1)
  assert.equal(expReachable.threats[0].inRangeNow, false)
  assert.equal(expReachable.threats[0].canReachNextTurn, true)

  // Enemy far out of threat range (move 1, range 1, opposite corner) does NOT trigger exposure warning
  foe.move = 1
  foe.range = 1
  placeUnit(battle, hero, 0, 0, 'w')
  placeUnit(battle, foe, battle.cols - 1, battle.rows - 1, 'w')
  const expFar = evaluateFacingExposure(battle, hero.uid, 'w')
  assert.equal(expFar.level, 'safe')
  assert.equal(expFar.threats.length, 0)
  assert.equal(expFar.warningText, null)

  // Multi-enemy threats: East + North means facing West exposes Backstab + Flank simultaneously
  const foe2 = enemies[1]
  foe2.alive = true
  foe2.move = 3
  foe2.range = 1
  foe.move = 3
  placeUnit(battle, hero, 3, 2, 'e')
  placeUnit(battle, foe, 4, 2, 'w')
  placeUnit(battle, foe2, 3, 1, 's')

  const all = evaluateAllFacingExposures(battle, hero.uid)
  assert.equal(all.e.level, 'flank')
  assert.equal(all.e.backstabCount, 0)
  assert.equal(all.e.flankCount, 1)
  assert.equal(all.n.level, 'flank')
  assert.equal(all.n.backstabCount, 0)
  assert.equal(all.n.flankCount, 1)
  assert.equal(all.w.level, 'back')
  assert.equal(all.w.backstabCount, 1)
  assert.equal(all.w.flankCount, 1)
  assert.equal(all.s.level, 'back')
  assert.equal(all.s.backstabCount, 1)
  assert.equal(all.s.flankCount, 1)
})

test('Wait-to-Face picker state machine: enter, preview all 4 directions, cancel restores facing, confirm commits with Wait CT bonus', () => {
  const state = createInitialState(202)
  const battle = startChapterBattle(state, 0)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  assert.equal(battle.phase, 'player')
  assert.equal(active.team, 'ally')
  const getPicker = () => battle.facingPicker
  assert.equal(getPicker(), null)

  setUnitFacing(active, 'e')
  const turnBefore = battle.turn
  const origFacing = active.facing

  // 1. Enter Wait-to-Face picker
  assert.equal(beginWaitFacingPicker(state), true)
  const opened = getPicker()
  assert.ok(opened)
  assert.equal(opened.unitUid, active.uid)
  assert.equal(opened.originalFacing, 'e')
  assert.equal(opened.previewFacing, 'e')
  assert.equal(battle.moveTiles.length, 0)
  assert.equal(battle.targetTiles.length, 0)

  // 2. Preview all 4 cardinal directions live
  for (const dir of FACING_DIRS) {
    previewWaitFacing(state, dir)
    assert.equal(getPicker()?.previewFacing, dir)
    assert.equal(active.facing, dir)
    assert.equal(active.yaw, facingToYaw(dir))
  }
  assert.equal(active.facing, 'w')

  // 3. Cancel restores original facing and returns to normal turn control WITHOUT ending turn
  assert.equal(cancelWaitFacingPicker(state), true)
  assert.equal(getPicker(), null)
  assert.equal(active.facing, origFacing)
  assert.equal(active.yaw, facingToYaw(origFacing))
  assert.equal(battle.turn, turnBefore)
  assert.equal(battle.activeUnitUid, active.uid)
  assert.ok(battle.moveTiles.length > 0, 'Move tiles should be restored after cancelling facing picker')

  // 4. Switching to a skill while picker is open cleanly cancels and restores original facing
  assert.equal(beginWaitFacingPicker(state), true)
  assert.equal(previewWaitFacing(state, 'n'), true)
  assert.equal(active.facing, 'n')
  assert.equal(armSkill(state, 0), true)
  assert.equal(battle.facingPicker, null)
  assert.equal(active.facing, origFacing)

  // 5. Confirm commits chosen facing, advances turn cleanly, and preserves full +40 CT Wait bonus
  active.moved = false
  active.acted = false
  active.ct = 100
  const ctBefore = active.ct
  assert.equal(beginWaitFacingPicker(state), true)
  assert.equal(previewWaitFacing(state, 's'), true)
  assert.equal(confirmWaitFacingPicker(state), true)

  assert.equal(battle.facingPicker, null)
  assert.equal(active.facing, 's')
  assert.equal(active.yaw, facingToYaw('s'))
  assert.equal(battle.turn, turnBefore + 1)
  // Unmoved + unacted Wait costs 60 CT (saving +40 CT), plus any CT ticks until next unit reaches 100
  assert.ok(
    active.ct >= ctBefore - 60,
    `Wait CT bonus should preserve at least 40 CT (got ${active.ct} from ${ctBefore})`
  )
  assert.ok(
    battle.floatingNumbers.some(fn => fn.text === 'WAIT +40 CT'),
    'Confirming Wait-to-Face without moving/acting should emit WAIT +40 CT float'
  )
})

test('Wait-to-Face confirm preserves +20 CT bonus when hero moved only', () => {
  const state = createInitialState(203)
  const battle = startChapterBattle(state, 0)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  active.moved = true
  active.acted = false
  active.ct = 100

  assert.equal(beginWaitFacingPicker(state), true)
  assert.equal(confirmWaitFacingPicker(state, 'n'), true)
  assert.equal(active.facing, 'n')
  assert.ok(
    battle.floatingNumbers.some(fn => fn.text === 'WAIT +20 CT'),
    'Confirming Wait-to-Face after moving only should emit WAIT +20 CT float'
  )
})

test('chooseOptimalTurnEndFacing faces nearest/highest-threat hero and avoids leaving back exposed', () => {
  const state = createInitialState(303)
  const battle = startChapterBattle(state, 0)
  clearBoardFlat(battle)

  const heroes = battle.units.filter(u => u.team === 'ally')
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const h of heroes) h.alive = false

  // Case 1: Single adjacent hero to the West while enemy is currently facing East (back exposed)
  const heroA = heroes[0]
  heroA.alive = true
  heroA.atk = 22
  heroA.range = 1
  heroA.move = 3
  placeUnit(battle, enemy, 4, 2, 'e')
  placeUnit(battle, heroA, 3, 2, 'e')

  const opt1 = chooseOptimalTurnEndFacing(battle, enemy)
  assert.equal(opt1, 'w', 'Enemy must turn West toward adjacent hero instead of leaving its back exposed')
  assert.equal(computeAttackArc(heroA.col, heroA.row, enemy.col, enemy.row, opt1), 'front')

  // Case 2: Weak distant hero to the South vs high-ATK adjacent hero to the North
  const heroB = heroes[1]
  heroB.alive = true
  heroA.atk = 10
  heroA.range = 1
  heroA.move = 2
  placeUnit(battle, heroA, 4, battle.rows - 1, 'n')

  heroB.atk = 36
  heroB.range = 1
  heroB.move = 3
  placeUnit(battle, heroB, 4, 1, 's')
  placeUnit(battle, enemy, 4, 2, 's')

  const opt2 = chooseOptimalTurnEndFacing(battle, enemy)
  assert.equal(opt2, 'n', 'Enemy should prioritize facing the adjacent high-threat hero to the North')

  // Case 3: Sandwiched between two equal adjacent heroes (East & West) -> turn sideways (N/S) to deny backstabs to both!
  heroA.atk = 24
  heroA.crit = 0.1
  heroA.range = 1
  heroB.atk = 24
  heroB.crit = 0.1
  heroB.range = 1
  placeUnit(battle, enemy, 4, 2, 'e')
  placeUnit(battle, heroA, 5, 2, 'w')
  placeUnit(battle, heroB, 3, 2, 'e')

  const opt3 = chooseOptimalTurnEndFacing(battle, enemy)
  assert.ok(opt3 === 'n' || opt3 === 's', `Expected sideways facing (n/s) to prevent backstab from either side, got ${opt3}`)
  assert.equal(computeAttackArc(heroA.col, heroA.row, enemy.col, enemy.row, opt3), 'flank')
  assert.equal(computeAttackArc(heroB.col, heroB.row, enemy.col, enemy.row, opt3), 'flank')
})

test('Enemy AI turn execution finishes with smart turn-end facing after stepping/acting', () => {
  const state = createInitialState(404)
  const battle = startChapterBattle(state, 0)
  clearBoardFlat(battle)

  const heroes = battle.units.filter(u => u.team === 'ally')
  const enemies = battle.units.filter(u => u.team === 'enemy')
  for (let i = 1; i < heroes.length; i++) heroes[i].alive = false
  for (let i = 1; i < enemies.length; i++) enemies[i].alive = false

  const hero = heroes[0]
  const enemy = enemies[0]
  // Put hero to the West of enemy, but start enemy facing East (back exposed!) and out of melee range so it must step
  hero.hp = 999
  hero.maxHp = 999
  hero.atk = 25
  hero.ct = 0
  enemy.hp = 120
  enemy.maxHp = 120
  enemy.move = 3
  enemy.range = 1
  enemy.ct = 100

  placeUnit(battle, hero, 1, 2, 'e')
  placeUnit(battle, enemy, 5, 2, 'e') // Back initially exposed to hero!

  // Force active enemy turn directly to test the complete stepped AI lifecycle
  battle.phase = 'enemy'
  battle.activeUnitUid = enemy.uid
  battle.selectedUnitUid = enemy.uid
  battle.enemyDelay = 0.05
  battle.enemyActedThisTurn = false
  const turnStart = battle.turn

  let safety = 0
  while (battle.turn === turnStart && safety++ < 240) {
    stepGame(state, 1 / 30)
  }

  assert.ok(battle.turn > turnStart, 'Enemy turn should complete and advance to next turn')
  assert.notEqual(
    computeAttackArc(hero.col, hero.row, enemy.col, enemy.row, enemy.facing),
    'back',
    `Enemy at (${enemy.col},${enemy.row}) facing '${enemy.facing}' must not leave its back exposed to hero at (${hero.col},${hero.row})`
  )
  assert.equal(
    enemy.facing,
    chooseOptimalTurnEndFacing(battle, enemy),
    'Enemy should end its stepped AI turn with chooseOptimalTurnEndFacing'
  )
})

test('CrownshardScene renders the 4-way on-board Facing Picker, triggers turn pivot, and picks cleanly at 0° and 90° camera yaws', () => {
  const state = createInitialState(505)
  const battle = startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  const active = getUnitByUid(battle, battle.activeUnitUid)!
  // Baseline render with cleared move/target tiles so we measure picker-only instance delta cleanly
  battle.moveTiles = []
  battle.targetTiles = []
  battle.moveAttackTiles = []
  scene.setCameraYaw(0, true)
  renderFrames(scene, state, 3)
  const baseInstances = fake.lastInstances

  // Open Wait-to-Face picker
  assert.equal(beginWaitFacingPicker(state), true)

  for (const yaw of [0, CAMERA_QUARTER_TURN, Math.PI, -CAMERA_QUARTER_TURN]) {
    scene.setCameraYaw(yaw, true)
    renderFrames(scene, state, 2)
    assert.ok(
      fake.lastInstances > baseInstances,
      `Expected on-board Facing Picker to render arrows + rings (yaw=${yaw}, got ${fake.lastInstances} <= ${baseInstances})`
    )

    // Cycle all 4 directions to exercise turnClipFor pivot animation + exposure highlights at each yaw
    for (const dir of FACING_DIRS) {
      previewWaitFacing(state, dir)
      renderFrames(scene, state, 4)
      assert.ok(fake.lastInstances > 20)

      // Verify projected arrow anchor round-trips cleanly through pickFacingPickerAt
      const [ax, ay, az] = facingPickerAnchor(battle, active, dir)
      const pt = scene.project(ax, ay, az, 1280, 720)
      assert.ok(pt, `Expected picker arrow '${dir}' to project on-screen at yaw=${yaw}`)
      const picked = scene.pickFacingPickerAt(battle, pt.x, pt.y, 1280, 720)
      assert.equal(picked, dir, `Expected pickFacingPickerAt to pick '${dir}' at yaw=${yaw}, got ${picked}`)
    }

    // Center confirm ring projects and picks as 'confirm'
    const centerPt = scene.project(active.x, active.y + 0.25, active.z, 1280, 720)
    assert.ok(centerPt)
    assert.equal(
      scene.pickFacingPickerAt(battle, centerPt.x, centerPt.y, 1280, 720),
      'confirm',
      `Expected center tile to pick 'confirm' at yaw=${yaw}`
    )
  }

  // Camera-aligned keyboard directions match screen orientation across 0° and 90° yaws
  assert.equal(cameraAlignedFacing(0, -1, 0), 'n')
  assert.equal(cameraAlignedFacing(1, 0, 0), 'e')
  assert.equal(cameraAlignedFacing(0, 1, 0), 's')
  assert.equal(cameraAlignedFacing(-1, 0, 0), 'w')

  assert.equal(cameraAlignedFacing(0, -1, CAMERA_QUARTER_TURN), 'w')
  assert.equal(cameraAlignedFacing(1, 0, CAMERA_QUARTER_TURN), 'n')
  assert.equal(cameraAlignedFacing(0, 1, CAMERA_QUARTER_TURN), 'e')
  assert.equal(cameraAlignedFacing(-1, 0, CAMERA_QUARTER_TURN), 's')

  scene.dispose()
})

test('drawEndTurnButton renders Wait-to-Face confirmation states cleanly across safe, flank, and back exposure', () => {
  let ops = 0
  const grad = { addColorStop() {} }
  const ctx = {
    save() { ops++ },
    restore() { ops++ },
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    rect() {},
    fill() { ops++ },
    stroke() { ops++ },
    fillRect() { ops++ },
    fillText() { ops++ },
    strokeText() {},
    measureText(s: string) { return { width: s.length * 6 } },
    createLinearGradient() { return grad }
  } as unknown as CanvasRenderingContext2D

  const rect = { x: 10, y: 10, width: 112, height: 134 }
  const st = { hovered: false, pressed: false, focused: false, disabled: false, selected: false }
  for (const level of ['safe', 'flank', 'back'] as const) {
    drawEndTurnButton(ctx, rect, { isPlayerTurn: true, ctBonus: 40, facingPicker: { facing: 'n', exposureLevel: level } }, st)
  }
  assert.ok(ops > 30)
})
