import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import {
  ACTION_CAMERA_CUES,
  cancelActionCamera,
  createActionCameraState,
  isActionCameraActive,
  isActionCameraEnabled,
  setActionCameraEnabled,
  stepActionCamera,
  triggerActionCameraCue
} from '../examples/crownshard/crownshard/action-camera.ts'
import { CHAPTER_BY_ID, ENEMY_SPECS } from '../examples/crownshard/crownshard/data.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  SAVE_KEY,
  armSkill,
  confirmDeployment,
  createInitialState,
  loadSave,
  persistSave,
  selectTile,
  serializeSave,
  startChapterBattle,
  stepGame,
  isActionCameraEnabled as simIsActionCameraEnabled,
  setActionCameraEnabled as simSetActionCameraEnabled
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { BattleUnit, EnemyArchetypeId, GameState } from '../examples/crownshard/crownshard/types.ts'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(initial))
  return {
    store,
    getItem(key: string) { return store.get(key) ?? null },
    setItem(key: string, value: string) { store.set(key, value) },
    removeItem(key: string) { store.delete(key) }
  }
}

function fakeRenderer() {
  let drawn = 0
  const stats: RenderStats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render() {
      drawn++
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get drawn() { return drawn }
  }
}

function flattenBoardToGrass(state: GameState): void {
  const battle = state.battle!
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

function placeUnit(state: GameState, unit: BattleUnit, col: number, row: number): void {
  const battle = state.battle!
  const cell = battle.cells[row][col]
  const [x, y, z] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = x
  unit.y = y
  unit.z = z
  unit.path = []
  unit.moveProgress = 0
}

function spawnEnemyUnit(state: GameState, enemyId: EnemyArchetypeId, col: number, row: number, uid: string): BattleUnit {
  const battle = state.battle!
  const spec = ENEMY_SPECS[enemyId]
  const cell = battle.cells[row][col]
  const [x, y, z] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  const unit: BattleUnit = {
    uid,
    team: 'enemy',
    name: spec.name,
    enemyId,
    stars: spec.isBoss ? 3 : 1,
    level: 10,
    isBoss: Boolean(spec.isBoss),
    bossPhase: spec.isBoss ? 1 : undefined,
    footprintSize: spec.footprintSize,
    col,
    row,
    x,
    y,
    z,
    yaw: 0,
    facing: 'w',
    path: [],
    moveProgress: 0,
    hp: spec.maxHp,
    maxHp: spec.maxHp,
    shield: 0,
    atk: spec.atk,
    def: spec.def,
    speed: spec.speed,
    ct: 100,
    move: spec.move,
    jump: spec.jump,
    range: spec.range,
    crit: 0.1,
    lifesteal: 0,
    moved: false,
    acted: false,
    alive: true,
    downed: false,
    koCountdown: 0,
    burnTurns: 0,
    slowTurns: 0,
    stunTurns: 0,
    empowerTurns: 0,
    tauntTurns: 0,
    hasteTurns: 0,
    poisonStacks: 0,
    cooldowns: [0, 0, 0],
    animState: 'idle',
    animTimer: 0,
    hitFlash: 0,
    lungeX: 0,
    lungeZ: 0
  }
  battle.units.push(unit)
  return unit
}

// ===========================================================================
// 1. Pure Action Camera Controller Tests
// ===========================================================================

test('action camera envelope eases in smoothly, holds near peak, and returns to exact neutral with zero overshoot', () => {
  for (const cue of ['crit', 'ultimate', 'boss_special'] as const) {
    const cfg = ACTION_CAMERA_CUES[cue]
    const cam = createActionCameraState()
    assert.equal(isActionCameraActive(cam), false)
    assert.equal(cam.currentZoom, 1)
    assert.deepEqual(cam.currentFocus, [0, 0, 0])
    assert.equal(cam.currentYaw, 0)

    const triggered = triggerActionCameraCue(cam, cue, [4.0, 0.5, -2.0], 1, true)
    assert.equal(triggered, true)
    assert.equal(isActionCameraActive(cam), true)
    assert.equal(cam.cue, cue)

    let minZoom = 1
    let maxFocusMag = 0
    let maxYawAbs = 0
    const dt = 1 / 60
    for (let i = 0; i < 180; i++) {
      stepActionCamera(cam, dt, 1)
      minZoom = Math.min(minZoom, cam.currentZoom)
      maxFocusMag = Math.max(maxFocusMag, Math.hypot(cam.currentFocus[0], cam.currentFocus[2]))
      maxYawAbs = Math.max(maxYawAbs, Math.abs(cam.currentYaw))
      // Zero overshoot below target zoom or above 1.0
      assert.ok(
        cam.currentZoom >= cfg.zoomMul - 1e-6 && cam.currentZoom <= 1 + 1e-6,
        `${cue} zoom out of bounds: ${cam.currentZoom} (target ${cfg.zoomMul})`
      )
    }

    assert.ok(minZoom < cfg.zoomMul + 0.03, `${cue} should reach near target zoom ${cfg.zoomMul} (got ${minZoom})`)
    assert.ok(maxFocusMag > 0.5, `${cue} should pull camera focus toward action (got ${maxFocusMag})`)
    if (cue === 'ultimate') {
      assert.ok(maxYawAbs > 0.04 && maxYawAbs <= 0.08 + 1e-6, `ultimate yaw flourish should stay within +/-0.08 rad (got ${maxYawAbs})`)
    } else if (cue === 'crit') {
      assert.equal(maxYawAbs, 0, 'crit should have no yaw flourish')
    }

    // After full envelope + settle, returns to exact neutral
    assert.equal(isActionCameraActive(cam), false, `${cue} must settle back to neutral`)
    assert.equal(cam.cue, null)
    assert.equal(cam.currentZoom, 1)
    assert.equal(cam.currentYaw, 0)
    assert.deepEqual(cam.currentFocus, [0, 0, 0])
  }
})

test('priority preemption: ultimate and boss_special preempt crit, while crit never cuts short ultimate or boss_special', () => {
  // 1. ultimate preempts active crit
  const cam = createActionCameraState()
  assert.equal(triggerActionCameraCue(cam, 'crit', [1, 0, 0], 1, true), true)
  stepActionCamera(cam, 0.12, 1)
  const zoomBeforePreempt = cam.currentZoom
  assert.ok(zoomBeforePreempt < 0.96)

  assert.equal(triggerActionCameraCue(cam, 'ultimate', [3, 0, 1], 1, true), true)
  assert.equal(cam.cue, 'ultimate')
  // Current damped zoom is preserved (no hard snap back to 1.0 on preemption)
  assert.equal(cam.currentZoom, zoomBeforePreempt)

  // 2. crit does NOT preempt active ultimate
  stepActionCamera(cam, 0.15, 1)
  const elapsedBeforeCrit = cam.elapsed
  assert.equal(triggerActionCameraCue(cam, 'crit', [-2, 0, -1], 1, true), false)
  assert.equal(cam.cue, 'ultimate')
  assert.equal(cam.elapsed, elapsedBeforeCrit)

  // 3. boss_special preempts active crit, and crit does NOT preempt active boss_special
  const cam2 = createActionCameraState()
  assert.equal(triggerActionCameraCue(cam2, 'crit', [1, 0, 1], 1, true), true)
  assert.equal(triggerActionCameraCue(cam2, 'boss_special', [-3, 0, 2], 1, true), true)
  assert.equal(cam2.cue, 'boss_special')
  assert.equal(triggerActionCameraCue(cam2, 'crit', [2, 0, -2], 1, true), false)
  assert.equal(cam2.cue, 'boss_special')
})

test('enabled=false is a no-op and pause (dt <= 0) freezes action camera cleanly', () => {
  const cam = createActionCameraState()
  assert.equal(triggerActionCameraCue(cam, 'ultimate', [3, 0, 2], 1, false), false)
  assert.equal(isActionCameraActive(cam), false)
  assert.equal(cam.cue, null)
  assert.equal(cam.currentZoom, 1)

  assert.equal(triggerActionCameraCue(cam, 'crit', [2, 0, 1], 1, true), true)
  stepActionCamera(cam, 0.10, 1)
  const snapshotZoom = cam.currentZoom
  const snapshotElapsed = cam.elapsed
  stepActionCamera(cam, 0, 1)
  stepActionCamera(cam, -0.05, 1)
  assert.equal(cam.currentZoom, snapshotZoom)
  assert.equal(cam.elapsed, snapshotElapsed)
})

test('2x battle speed completes action camera envelopes faster than 1x speed', () => {
  const cam1x = createActionCameraState()
  const cam2x = createActionCameraState()
  triggerActionCameraCue(cam1x, 'ultimate', [3, 0, -1], 1, true)
  triggerActionCameraCue(cam2x, 'ultimate', [3, 0, -1], 2, true)
  assert.ok(cam2x.duration < cam1x.duration, '2x cue duration must be shorter than 1x duration')

  let frames1x = 0
  while (isActionCameraActive(cam1x) && frames1x < 300) {
    stepActionCamera(cam1x, 1 / 60, 1)
    frames1x++
  }
  let frames2x = 0
  while (isActionCameraActive(cam2x) && frames2x < 300) {
    stepActionCamera(cam2x, 1 / 60, 2)
    frames2x++
  }
  assert.ok(frames2x < frames1x, `2x mode (${frames2x} frames) should settle faster than 1x (${frames1x} frames)`)
})

test('cancelActionCamera clears cue immediately and resets gracefully (or instantly when immediate=true)', () => {
  const cam = createActionCameraState()
  triggerActionCameraCue(cam, 'ultimate', [3.5, 0.4, 2.0], 1, true)
  for (let i = 0; i < 16; i++) stepActionCamera(cam, 1 / 60, 1)
  assert.ok(cam.currentZoom < 0.88)

  // Graceful cancel: clears cue & targets immediately without snapping currentZoom in 1 frame
  const zoomAtCancel = cam.currentZoom
  cancelActionCamera(cam)
  assert.equal(cam.cue, null)
  assert.equal(cam.priority, 0)
  assert.equal(cam.targetZoom, 1)
  assert.deepEqual(cam.targetFocus, [0, 0, 0])
  assert.equal(cam.currentZoom, zoomAtCancel)

  // Subsequent frames smoothly glide back to exact neutral
  let prevZoom = cam.currentZoom
  for (let i = 0; i < 60; i++) {
    stepActionCamera(cam, 1 / 60, 1)
    assert.ok(cam.currentZoom >= prevZoom - 1e-6 && cam.currentZoom <= 1 + 1e-6)
    prevZoom = cam.currentZoom
  }
  assert.equal(isActionCameraActive(cam), false)
  assert.equal(cam.currentZoom, 1)
  assert.deepEqual(cam.currentFocus, [0, 0, 0])

  // Immediate cancel snaps straight to exact neutral
  triggerActionCameraCue(cam, 'boss_special', [-3, 0, 1], 1, true)
  stepActionCamera(cam, 0.2, 1)
  cancelActionCamera(cam, true)
  assert.equal(isActionCameraActive(cam), false)
  assert.equal(cam.currentZoom, 1)
  assert.equal(cam.currentYaw, 0)
  assert.deepEqual(cam.currentFocus, [0, 0, 0])
})

// ===========================================================================
// 2. Live Simulation Emission Tests
// ===========================================================================

test('simulation emits ultimate camera_cue on 3-star hero skill cast (and not on 1-star skill)', () => {
  const state = createInitialState(77)
  // Promote starter Knight to 3 stars so skillIndex 2 (tier 3 ultimate) is unlocked
  state.campaign.heroes[0].stars = 3
  startChapterBattle(state, 0)
  confirmDeployment(state)
  flattenBoardToGrass(state)

  const battle = state.battle!
  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.acted = false
  knight.moved = false
  knight.crit = 0
  enemy.hp = 500
  enemy.maxHp = 500
  placeUnit(state, knight, 2, 2)
  placeUnit(state, enemy, 3, 2)

  // Cast 1-star skill (skillIndex 0): should NOT emit 'ultimate'
  state.vfx.length = 0
  armSkill(state, 0)
  selectTile(state, enemy.col, enemy.row)
  const cuesAfterTier1 = state.vfx.filter(ev => ev.kind === 'camera_cue')
  assert.equal(cuesAfterTier1.some(ev => ev.cue === 'ultimate'), false, '1-star skill must not emit ultimate camera_cue')

  // Cast 3-star skill (skillIndex 2): MUST emit 'ultimate'
  // (Shield Bash knocked enemy back by 1 tile, so re-place adjacent for range-1 Crown Cleave)
  placeUnit(state, knight, 2, 2)
  placeUnit(state, enemy, 3, 2)
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.acted = false
  knight.moved = false
  knight.cooldowns = [0, 0, 0]
  state.vfx.length = 0
  armSkill(state, 2)
  selectTile(state, enemy.col, enemy.row)
  const ultCue = state.vfx.find(ev => ev.kind === 'camera_cue' && ev.cue === 'ultimate')
  assert.ok(ultCue && ultCue.kind === 'camera_cue', '3-star skill must emit ultimate camera_cue')
  const expectedMidX = (knight.x + enemy.x) * 0.5
  const expectedMidZ = (knight.z + enemy.z) * 0.5
  assert.ok(Math.abs(ultCue.at[0] - expectedMidX) < 1e-4)
  assert.ok(Math.abs(ultCue.at[2] - expectedMidZ) < 1e-4)
})

test('simulation emits crit camera_cue when a critical hit lands', () => {
  const state = createInitialState(101)
  startChapterBattle(state, 0)
  confirmDeployment(state)
  flattenBoardToGrass(state)

  const battle = state.battle!
  const hero = battle.units.find(u => u.team === 'ally')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  battle.phase = 'player'
  battle.activeUnitUid = hero.uid
  battle.selectedUnitUid = hero.uid
  hero.acted = false
  hero.moved = false
  hero.crit = 1.0 // Guaranteed crit (clamped to 0.95 -> test with backstab/flank or loop until crit lands)
  enemy.hp = 500
  enemy.maxHp = 500
  enemy.facing = 'e' // Hero at (2,2) attacking enemy at (3,2) facing 'e' -> backstab (+0.20 crit -> 95%!)
  placeUnit(state, hero, 2, 2)
  placeUnit(state, enemy, 3, 2)

  let sawCritCue = false
  for (let attempt = 0; attempt < 6 && !sawCritCue; attempt++) {
    hero.acted = false
    hero.moved = false
    state.vfx.length = 0
    armSkill(state, -1)
    selectTile(state, enemy.col, enemy.row)
    const impact = state.vfx.find(ev => ev.kind === 'impact' && ev.crit)
    const cue = state.vfx.find(ev => ev.kind === 'camera_cue' && ev.cue === 'crit')
    if (impact) {
      assert.ok(cue && cue.kind === 'camera_cue', 'Critical impact must emit crit camera_cue')
      assert.ok(Math.abs(cue.at[0] - enemy.x) < 1e-4)
      assert.ok(Math.abs(cue.at[2] - enemy.z) < 1e-4)
      sawCritCue = true
    }
  }
  assert.equal(sawCritCue, true, 'Should land at least one guaranteed crit and emit crit camera_cue')
})

test('simulation emits boss_special camera_cue when Rimefang, Lich Vaelen, Ignis Titan, or Dune Sovereign uses its special', () => {
  const bossIds: readonly EnemyArchetypeId[] = [
    'frostwyrm_rimefang',
    'lich_vaelen',
    'ignis_titan',
    'dune_sovereign_boss'
  ]

  for (const bossId of bossIds) {
    const state = createInitialState(333)
    startChapterBattle(state, 0)
    confirmDeployment(state)
    flattenBoardToGrass(state)

    const battle = state.battle!
    // Keep only 1 hero and spawn our boss right in special range
    const hero = battle.units.find(u => u.team === 'ally')!
    battle.units.splice(0, battle.units.length, hero)
    hero.hp = 500
    hero.maxHp = 500
    placeUnit(state, hero, 2, 2)

    const boss = spawnEnemyUnit(state, bossId, 4, 2, `boss_${bossId}`)
    boss.cooldowns = [0, 0, 0]
    battle.phase = 'enemy'
    battle.activeUnitUid = boss.uid
    battle.enemyActedThisTurn = false
    battle.enemyDelay = 0.01
    state.vfx.length = 0

    // Step simulation so enemy executes its turn immediately
    stepGame(state, 0.05)

    const bossCue = state.vfx.find(ev => ev.kind === 'camera_cue' && ev.cue === 'boss_special')
    assert.ok(bossCue, `Boss ${bossId} must emit boss_special camera_cue on its signature special`)
  }
})

// ===========================================================================
// 3. 3D Scene Integration & Manual Control Override Tests
// ===========================================================================

test('CrownshardScene blends action camera cues, respects toggle, and cancels immediately on manual controls or battle swap', () => {
  const state = createInitialState(55)
  startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  // Baseline projection with neutral camera
  scene.render(state, 1 / 60, 1280, 720)
  assert.equal(scene.isActionCameraActive(), false)
  const neutralProj = scene.project(3.0, 0, 1.5, 1280, 720)
  assert.ok(neutralProj)

  // Push an ultimate cue and render several frames: scene activates action camera and moves projection
  state.vfx.push({ kind: 'camera_cue', cue: 'ultimate', at: [3.0, 0, 1.5] })
  for (let i = 0; i < 18; i++) scene.render(state, 1 / 60, 1280, 720)
  assert.equal(scene.isActionCameraActive(), true)
  assert.equal(scene.isCameraAnimating(), true)
  const zoomedProj = scene.project(3.0, 0, 1.5, 1280, 720)
  assert.ok(zoomedProj)
  const shift = Math.hypot(zoomedProj.x - neutralProj.x, zoomedProj.y - neutralProj.y)
  assert.ok(shift > 4, `Ultimate action camera should visibly shift/zoom projection (got ${shift.toFixed(2)}px)`)

  // Manual camera controls immediately cancel the active cue
  scene.rotateCamera(0.2)
  assert.equal(scene.getActionCameraState().cue, null, 'rotateCamera must cancel active action camera cue')

  state.vfx.push({ kind: 'camera_cue', cue: 'boss_special', at: [-2.0, 0, 1.0] })
  scene.render(state, 1 / 60, 1280, 720)
  assert.equal(scene.getActionCameraState().cue, 'boss_special')
  scene.snapCameraYaw(1)
  assert.equal(scene.getActionCameraState().cue, null, 'snapCameraYaw must cancel active action camera cue')

  state.vfx.push({ kind: 'camera_cue', cue: 'ultimate', at: [2.0, 0, -1.0] })
  scene.render(state, 1 / 60, 1280, 720)
  scene.zoomCamera(0.9)
  assert.equal(scene.getActionCameraState().cue, null, 'zoomCamera must cancel active action camera cue')

  state.vfx.push({ kind: 'camera_cue', cue: 'ultimate', at: [2.0, 0, -1.0] })
  scene.render(state, 1 / 60, 1280, 720)
  scene.resetCamera()
  assert.equal(scene.getActionCameraState().cue, null, 'resetCamera must cancel active action camera cue')

  // Battle transition immediately resets action camera to neutral
  state.vfx.push({ kind: 'camera_cue', cue: 'ultimate', at: [2.5, 0, 1.5] })
  for (let i = 0; i < 10; i++) scene.render(state, 1 / 60, 1280, 720)
  assert.equal(scene.isActionCameraActive(), true)
  startChapterBattle(state, 1)
  scene.render(state, 1 / 60, 1280, 720)
  assert.equal(scene.isActionCameraActive(), false, 'Starting a new battle must immediately reset action camera')

  // Disabling action camera via campaign setting prevents new cues from activating
  simSetActionCameraEnabled(state, false)
  state.vfx.push({ kind: 'camera_cue', cue: 'ultimate', at: [3.0, 0, 1.0] })
  for (let i = 0; i < 5; i++) scene.render(state, 1 / 60, 1280, 720)
  assert.equal(scene.isActionCameraActive(), false, 'Disabled action camera must ignore camera_cue events')
})

// ===========================================================================
// 4. Persistence & Legacy Save Tests
// ===========================================================================

test('actionCameraEnabled defaults to true, persists across save/load, and handles legacy saves missing the field', () => {
  const storage = memoryStorage()
  const state = createInitialState(42)
  assert.equal(state.campaign.actionCameraEnabled, true)
  assert.equal(isActionCameraEnabled(state.campaign), true)
  assert.equal(simIsActionCameraEnabled(state.campaign), true)

  // Disable and save
  setActionCameraEnabled(state, false)
  assert.equal(state.campaign.actionCameraEnabled, false)
  assert.equal(isActionCameraEnabled(state.campaign), false)
  persistSave(storage, state)

  const loadedOff = loadSave(storage)
  assert.ok(loadedOff)
  assert.equal(loadedOff.campaign.actionCameraEnabled, false)
  const hydratedOff = createInitialState(42, loadedOff)
  assert.equal(hydratedOff.campaign.actionCameraEnabled, false)
  assert.equal(simIsActionCameraEnabled(hydratedOff.campaign), false)

  // Re-enable and round-trip
  simSetActionCameraEnabled(hydratedOff, true)
  persistSave(storage, hydratedOff)
  const loadedOn = loadSave(storage)
  assert.ok(loadedOn)
  assert.equal(loadedOn.campaign.actionCameraEnabled, true)
  const hydratedOn = createInitialState(42, loadedOn)
  assert.equal(hydratedOn.campaign.actionCameraEnabled, true)

  // Legacy save missing actionCameraEnabled completely must default cleanly to true
  const rawSave = serializeSave(state)
  const legacyJson = JSON.parse(JSON.stringify(rawSave)) as { version: 1; campaign: Record<string, unknown> }
  delete legacyJson.campaign.actionCameraEnabled
  storage.setItem(SAVE_KEY, JSON.stringify(legacyJson))

  const loadedLegacy = loadSave(storage)
  assert.ok(loadedLegacy)
  assert.equal(loadedLegacy.campaign.actionCameraEnabled, true)
  const hydratedLegacy = createInitialState(42, loadedLegacy)
  assert.equal(hydratedLegacy.campaign.actionCameraEnabled, true)
  assert.equal(isActionCameraEnabled(hydratedLegacy.campaign), true)

  // Sanity check CHAPTER_BY_ID import used cleanly
  assert.ok(CHAPTER_BY_ID[hydratedLegacy.campaign.selectedStageId])
})

// ===========================================================================
// 5. Godot Compiler (`compileTsToGd`) & Package Registration Check
// ===========================================================================

test('action-camera.ts is browser-global-free, registered in godotEntries, and compiles cleanly via compileTsToGd', () => {
  const pkgPath = new URL('../examples/crownshard/package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    ridgetop?: { godotEntries?: string[] }
  }
  assert.ok(
    pkg.ridgetop?.godotEntries?.includes('crownshard/action-camera.ts'),
    'crownshard/action-camera.ts must be registered in examples/crownshard/package.json ridgetop.godotEntries'
  )

  const sourcePath = new URL('../examples/crownshard/crownshard/action-camera.ts', import.meta.url)
  const source = readFileSync(sourcePath, 'utf8')
  for (const forbidden of ['window', 'document', 'localStorage', 'HTMLCanvasElement', 'requestAnimationFrame']) {
    assert.equal(source.includes(forbidden), false, `action-camera.ts must not reference browser global "${forbidden}"`)
  }

  const gd = compileTsToGd(source, 'action-camera.ts')
  assert.ok(gd.length > 200, 'compileTsToGd must emit non-trivial GDScript for action-camera.ts')
  assert.ok(gd.includes('func createActionCameraState'), 'Compiled GDScript should contain createActionCameraState')
  assert.ok(gd.includes('func triggerActionCameraCue'), 'Compiled GDScript should contain triggerActionCameraCue')
  assert.ok(gd.includes('func stepActionCamera'), 'Compiled GDScript should contain stepActionCamera')
  assert.ok(gd.includes('func cancelActionCamera'), 'Compiled GDScript should contain cancelActionCamera')
})
