import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import { CHAPTERS } from '../examples/crownshard/crownshard/data.ts'
import {
  SAVE_KEY, abandonBattle, armSkill, armTacticCard, createInitialState, createTurnBoundaryTracker,
  endPlayerTurn, getUnitByUid, hydrateSave, loadSave, persistSave, restoreBattleState, selectTile,
  serializeBattleState, serializeSave, setUnitFacing, shouldAutoSaveOnTurnBoundary, startChapterBattle,
  stepGame, syncTurnBoundaryTracker, validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { cellHeightLevel, facingToYaw, gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { BattleSaveSnapshot, BattleUnit, SaveData } from '../examples/crownshard/crownshard/types.ts'

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    }
  }
}

test('Mid-battle save/restore JSON round-trip preserves full deterministic state and RNG continuation', () => {
  const state = createInitialState(4242)
  // Start a battle with varied elevation & shrine/terrain (chapter 1 or 2)
  const battle = startChapterBattle(state, 1, 0)
  assert.equal(battle.phase, 'player')

  // Move active unit so moved=true and coordinates change
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const dest = battle.moveTiles[0]
  assert.ok(dest, 'Expected at least one reachable move tile')
  assert.equal(selectTile(state, dest.col, dest.row), true)
  for (let i = 0; i < 120; i++) stepGame(state, STEP)
  assert.equal(active.col, dest.col)
  assert.equal(active.row, dest.row)
  assert.equal(active.moved, true)

  // Play a tactic card to mutate hand, discardPile, ap, and tacticsPlayed
  const tacticUid = battle.hand[0]
  assert.ok(tacticUid)
  assert.equal(armTacticCard(state, tacticUid), true)
  if (battle.armedTacticUid && battle.targetTiles.length > 0) {
    const t = battle.targetTiles[0]
    assert.equal(selectTile(state, t.col, t.row), true)
  }
  assert.ok(battle.tacticsPlayed >= 1, 'Expected at least one tactic card played')
  assert.ok(battle.discardPile.includes(tacticUid), 'Played tactic should be in discard pile')

  // Mutate rich mid-battle unit state: HP, shield, facing, statuses, cooldowns, CT, shrineUsed
  active.hp = Math.max(1, active.maxHp - 17)
  active.shield = 14
  active.burnTurns = 2
  active.slowTurns = 1
  active.empowerTurns = 2
  active.cooldowns = [2, 1, 0]
  setUnitFacing(active, 'n')

  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
  enemy.hp = Math.max(1, enemy.maxHp - 11)
  enemy.stunTurns = 1
  enemy.ct = 73
  setUnitFacing(enemy, 's')

  // Mark a shrine (or cell 0,0) as shrineUsed to verify cell flag persistence
  const shrineCell = battle.cells.flat().find(c => c.terrain === 'shrine') ?? battle.cells[0][0]
  shrineCell.shrineUsed = true

  // Inject transient noise that must NOT leak into restored battle
  state.sounds.push({ kind: 'slash' })
  state.vfx.push({ kind: 'heal', at: [0, 0, 0] })
  battle.floatingNumbers.push({
    id: 99, x: 1, y: 2, z: 3, text: '-12', color: '#ff0000', age: 0.2, duration: 1
  })

  // Round-trip through JSON serialization via Storage
  const storage = createMemoryStorage()
  persistSave(storage, state)
  const rawJson = storage.getItem(SAVE_KEY)
  assert.ok(rawJson, 'Storage should contain serialized save JSON')
  const parsedAgain = JSON.parse(JSON.stringify(serializeSave(state))) as SaveData
  assert.ok(parsedAgain.activeBattle, 'Serialized save must include activeBattle mid-fight')

  const loadedSave = loadSave(storage)
  assert.ok(loadedSave && loadedSave.activeBattle, 'loadSave must return valid activeBattle')

  const resumed = createInitialState(999, loadedSave)
  const rb = resumed.battle
  assert.ok(rb, 'createInitialState must restore activeBattle')

  // Verify battle metadata & counters
  assert.equal(rb.stageId, battle.stageId)
  assert.equal(rb.chapterIndex, battle.chapterIndex)
  assert.equal(rb.endlessWave, battle.endlessWave)
  assert.equal(rb.biome, battle.biome)
  assert.equal(rb.cols, battle.cols)
  assert.equal(rb.rows, battle.rows)
  assert.equal(rb.turn, battle.turn)
  assert.equal(rb.phase, battle.phase)
  assert.equal(rb.activeUnitUid, battle.activeUnitUid)
  assert.equal(rb.selectedUnitUid, battle.selectedUnitUid)
  assert.equal(rb.ap, battle.ap)
  assert.equal(rb.maxAp, battle.maxAp)
  assert.equal(rb.tacticsPlayed, battle.tacticsPlayed)
  assert.deepEqual(rb.drawPile, battle.drawPile)
  assert.deepEqual(rb.hand, battle.hand)
  assert.deepEqual(rb.discardPile, battle.discardPile)
  assert.equal(resumed.campaign.seed, state.campaign.seed, 'RNG seed must match exactly')

  // Verify terrain, heightmap, and shrineUsed
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      assert.equal(rb.cells[r][c].terrain, battle.cells[r][c].terrain)
      assert.equal(cellHeightLevel(rb.cells[r][c]), cellHeightLevel(battle.cells[r][c]))
      assert.equal(rb.cells[r][c].elevation, battle.cells[r][c].elevation)
      assert.equal(Boolean(rb.cells[r][c].shrineUsed), Boolean(battle.cells[r][c].shrineUsed))
    }
  }
  assert.equal(rb.cells[shrineCell.row][shrineCell.col].shrineUsed, true)

  // Verify every unit's exact persistent fields & freshly derived world coords / yaw
  assert.equal(rb.units.length, battle.units.length)
  for (let i = 0; i < battle.units.length; i++) {
    const orig: BattleUnit = battle.units[i]
    const copy: BattleUnit = rb.units[i]
    assert.equal(copy.uid, orig.uid)
    assert.equal(copy.team, orig.team)
    assert.equal(copy.name, orig.name)
    assert.equal(copy.heroId, orig.heroId)
    assert.equal(copy.enemyId, orig.enemyId)
    assert.equal(copy.stars, orig.stars)
    assert.equal(copy.hp, orig.hp)
    assert.equal(copy.maxHp, orig.maxHp)
    assert.equal(copy.shield, orig.shield)
    assert.equal(copy.atk, orig.atk)
    assert.equal(copy.def, orig.def)
    assert.equal(copy.speed, orig.speed)
    assert.equal(copy.ct, orig.ct)
    assert.equal(copy.col, orig.col)
    assert.equal(copy.row, orig.row)
    assert.equal(copy.facing, orig.facing)
    assert.equal(copy.moved, orig.moved)
    assert.equal(copy.acted, orig.acted)
    assert.equal(copy.alive, orig.alive)
    assert.equal(copy.burnTurns, orig.burnTurns)
    assert.equal(copy.slowTurns, orig.slowTurns)
    assert.equal(copy.stunTurns, orig.stunTurns)
    assert.equal(copy.empowerTurns, orig.empowerTurns)
    assert.deepEqual(copy.cooldowns, orig.cooldowns)

    const cell = rb.cells[copy.row][copy.col]
    const [wx, wy, wz] = gridToWorld(copy.col, copy.row, cell.elevation, rb.cols, rb.rows)
    assert.equal(copy.x, wx)
    assert.equal(copy.y, wy)
    assert.equal(copy.z, wz)
    assert.equal(copy.yaw, facingToYaw(copy.facing))
    assert.deepEqual(copy.path, [])
    assert.equal(copy.animState, 'idle')
  }

  // Verify transient queues were cleared cleanly
  assert.deepEqual(resumed.sounds, [])
  assert.deepEqual(resumed.vfx, [])
  assert.deepEqual(rb.floatingNumbers, [])
  assert.equal(rb.turnOrder.length, 8)

  // Verify identical deterministic continuation on both original and resumed battles!
  endPlayerTurn(state)
  endPlayerTurn(resumed)
  for (let i = 0; i < 180; i++) {
    stepGame(state, STEP)
    stepGame(resumed, STEP)
  }
  assert.equal(resumed.battle!.turn, state.battle!.turn)
  assert.equal(resumed.battle!.phase, state.battle!.phase)
  assert.equal(resumed.battle!.activeUnitUid, state.battle!.activeUnitUid)
  assert.equal(resumed.campaign.seed, state.campaign.seed)
  assert.deepEqual(
    resumed.battle!.units.map(u => ({ uid: u.uid, hp: u.hp, shield: u.shield, col: u.col, row: u.row, ct: u.ct })),
    state.battle!.units.map(u => ({ uid: u.uid, hp: u.hp, shield: u.shield, col: u.col, row: u.row, ct: u.ct }))
  )
})

test('Resumed battle derives moveTiles/targetTiles/world positions and plays cleanly to victory', () => {
  const state = createInitialState(777)
  const battle = startChapterBattle(state, 0, 0)
  // End Turn 1 to reach an enemy turn, save DURING enemy phase, resume, then step to player turn
  endPlayerTurn(state)
  while (battle.phase === 'player') {
    endPlayerTurn(state)
  }
  assert.equal(battle.phase, 'enemy')
  const enemyTurnSnap = JSON.parse(JSON.stringify(serializeSave(state))) as SaveData
  assert.ok(enemyTurnSnap.activeBattle)
  assert.equal(enemyTurnSnap.activeBattle.phase, 'enemy')

  // Resume during enemy turn and step until next player turn
  const resumed = createInitialState(111, enemyTurnSnap)
  assert.ok(resumed.battle)
  assert.equal(resumed.battle.phase, 'enemy')
  let guard = 0
  while (resumed.battle.phase === 'enemy' && guard++ < 600) {
    stepGame(resumed, STEP)
  }
  assert.equal(resumed.battle.phase, 'player', 'Resumed enemy turn must advance to player turn')

  // Now save at start of player turn and resume again
  const playerSnap = JSON.parse(JSON.stringify(serializeSave(resumed))) as SaveData
  const resumedPlayer = createInitialState(222, playerSnap)
  const rb = resumedPlayer.battle!
  assert.equal(rb.phase, 'player')
  assert.ok(rb.moveTiles.length > 0, 'Resumed unmoved active hero must have valid moveTiles')
  assert.ok(rb.turnOrder.length > 0, 'Resumed battle must recompute turnOrder')

  // Immediately move on resumed turn
  const hero = getUnitByUid(rb, rb.activeUnitUid)!
  const tile = rb.moveTiles[0]
  assert.equal(selectTile(resumedPlayer, tile.col, tile.row), true)
  for (let i = 0; i < 120; i++) stepGame(resumedPlayer, STEP)
  assert.equal(hero.col, tile.col)
  assert.equal(hero.row, tile.row)
  assert.equal(hero.moved, true)

  // Attack last remaining enemy to finish battle cleanly
  const enemies = rb.units.filter(u => u.alive && u.team === 'enemy')
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].hp = 0
    enemies[i].alive = false
  }
  const lastEnemy = enemies[enemies.length - 1]
  lastEnemy.hp = 5
  hero.col = Math.max(0, lastEnemy.col - 1)
  hero.row = lastEnemy.row
  hero.acted = false
  hero.cooldowns = [0, 0, 0]
  assert.equal(armSkill(resumedPlayer, 0), true)
  assert.ok(rb.targetTiles.some(t => t.col === lastEnemy.col && t.row === lastEnemy.row))
  assert.equal(selectTile(resumedPlayer, lastEnemy.col, lastEnemy.row), true)

  assert.equal(rb.phase, 'victory')
  assert.ok(rb.reward)
  assert.equal(resumedPlayer.campaign.chaptersCleared, 1)
})

test('Backwards compatibility: legacy saves without activeBattle load identically', () => {
  const base = createInitialState(314)
  base.campaign.gold = 777
  base.campaign.battlesWon = 3
  base.campaign.clearedStageIds = [CHAPTERS[0].id, CHAPTERS[1].id]
  base.campaign.chaptersCleared = 2

  // Strip activeBattle completely to simulate pre-feature localStorage JSON
  const legacyPayload = {
    version: 1,
    campaign: serializeSave(base).campaign
  }
  const storage = createMemoryStorage()
  storage.setItem(SAVE_KEY, JSON.stringify(legacyPayload))

  const loaded = loadSave(storage)
  assert.ok(loaded)
  assert.equal(loaded.activeBattle, null)
  assert.equal(loaded.campaign.gold, 777)
  assert.equal(loaded.campaign.battlesWon, 3)
  assert.deepEqual(loaded.campaign.clearedStageIds, [CHAPTERS[0].id, CHAPTERS[1].id])

  const state = createInitialState(999, loaded)
  assert.equal(state.battle, null)
  assert.equal(state.campaign.gold, 777)
  assert.equal(state.campaign.chaptersCleared, 2)
})

test('Corrupted or invalid activeBattle snapshots are safely discarded without crashing or losing campaign', () => {
  const state = createInitialState(888)
  state.campaign.gold = 450
  startChapterBattle(state, 0, 0)
  const validSave = serializeSave(state)
  const validSnap = validSave.activeBattle!
  assert.ok(validSnap)

  const corruptedCases: unknown[] = [
    'not-an-object',
    42,
    [],
    { ...validSnap, version: 2 },
    { ...validSnap, stageId: 'nonexistent_stage_id' },
    { ...validSnap, biome: 'mars' },
    { ...validSnap, phase: 'victory' },
    { ...validSnap, phase: 'defeat' },
    { ...validSnap, turn: 0 },
    { ...validSnap, cols: 1 },
    { ...validSnap, cells: [] },
    { ...validSnap, units: [] },
    // Out-of-bounds unit coordinates
    { ...validSnap, units: validSnap.units.map((u, i) => (i === 0 ? { ...u, col: 99 } : u)) },
    // NaN HP
    { ...validSnap, units: validSnap.units.map((u, i) => (i === 0 ? { ...u, hp: Number.NaN } : u)) },
    // Duplicate UIDs
    { ...validSnap, units: [validSnap.units[0], { ...validSnap.units[0], col: 0, row: 0 }] },
    // Overlapping alive units on the exact same tile
    {
      ...validSnap,
      units: validSnap.units.map((u, i) =>
        i === 1 ? { ...u, col: validSnap.units[0].col, row: validSnap.units[0].row, alive: true } : u
      )
    },
    // Active unit points to wrong team for player phase
    {
      ...validSnap,
      phase: 'player',
      activeUnitUid: validSnap.units.find(u => u.team === 'enemy')!.uid
    },
    // Active unit is dead
    {
      ...validSnap,
      units: validSnap.units.map(u => (u.uid === validSnap.activeUnitUid ? { ...u, alive: false, hp: 0 } : u))
    },
    // No alive enemies left
    {
      ...validSnap,
      units: validSnap.units.map(u => (u.team === 'enemy' ? { ...u, alive: false, hp: 0 } : u))
    }
  ]

  for (const bad of corruptedCases) {
    assert.equal(validateBattleSnapshot(bad), null, `Expected snapshot to be rejected: ${JSON.stringify(bad).slice(0, 120)}`)

    const target = createInitialState(100)
    assert.equal(restoreBattleState(target, bad), false)
    assert.equal(target.battle, null)

    const storage = createMemoryStorage()
    storage.setItem(SAVE_KEY, JSON.stringify({
      version: 1,
      campaign: validSave.campaign,
      activeBattle: bad
    }))
    const loaded = loadSave(storage)
    assert.ok(loaded, 'Campaign must still load even when activeBattle is corrupted')
    assert.equal(loaded.campaign.gold, 450)
    assert.equal(loaded.activeBattle, null)

    const hydrated = createInitialState(50, loaded)
    assert.equal(hydrated.battle, null)
    assert.equal(hydrated.campaign.gold, 450)
  }

  // hydrateSave also handles invalid save gracefully
  const fresh = createInitialState(123)
  assert.equal(hydrateSave(fresh, null), false)
})

test('Victory, Defeat, and Retreat/Abandon clear the saved mid-battle snapshot', () => {
  const storage = createMemoryStorage()

  // 1. Victory clears activeBattle
  const winState = createInitialState(501)
  const winBattle = startChapterBattle(winState, 0, 0)
  persistSave(storage, winState)
  assert.ok(loadSave(storage)?.activeBattle, 'Active battle should be saved before victory')

  const hero = getUnitByUid(winBattle, winBattle.activeUnitUid)!
  const enemies = winBattle.units.filter(u => u.alive && u.team === 'enemy')
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].hp = 0
    enemies[i].alive = false
  }
  const lastEnemy = enemies[enemies.length - 1]
  lastEnemy.hp = 4
  hero.col = Math.max(0, lastEnemy.col - 1)
  hero.row = lastEnemy.row
  hero.acted = false
  hero.cooldowns = [0, 0, 0]
  armSkill(winState, 0)
  selectTile(winState, lastEnemy.col, lastEnemy.row)
  assert.equal(winBattle.phase, 'victory')
  assert.equal(serializeBattleState(winBattle), null)
  assert.equal(serializeSave(winState).activeBattle, null)
  persistSave(storage, winState)
  assert.equal(loadSave(storage)?.activeBattle, null, 'Victory must clear persisted activeBattle')

  // 2. Defeat clears activeBattle
  const loseState = createInitialState(502)
  const loseBattle = startChapterBattle(loseState, 0, 0)
  persistSave(storage, loseState)
  assert.ok(loadSave(storage)?.activeBattle, 'Active battle should be saved before defeat')

  const allies = loseBattle.units.filter(u => u.alive && u.team === 'ally')
  for (let i = 0; i < allies.length - 1; i++) {
    allies[i].hp = 0
    allies[i].alive = false
  }
  const lastAlly = allies[allies.length - 1]
  lastAlly.hp = 1
  lastAlly.shield = 0
  lastAlly.burnTurns = 2
  // Advance until burn KOs the final ally (or enemy KOs them)
  let guard = 0
  while (loseBattle.phase !== 'defeat' && guard++ < 400) {
    if (loseBattle.phase === 'player') endPlayerTurn(loseState)
    else stepGame(loseState, STEP)
  }
  assert.equal(loseBattle.phase, 'defeat')
  assert.equal(serializeBattleState(loseBattle), null)
  assert.equal(serializeSave(loseState).activeBattle, null)
  persistSave(storage, loseState)
  assert.equal(loadSave(storage)?.activeBattle, null, 'Defeat must clear persisted activeBattle')

  // 3. Retreat / Abandon clears activeBattle
  const retreatState = createInitialState(503)
  startChapterBattle(retreatState, 0, 0)
  persistSave(storage, retreatState)
  assert.ok(loadSave(storage)?.activeBattle, 'Active battle should be saved before retreat')

  assert.equal(abandonBattle(retreatState), true)
  assert.equal(retreatState.battle, null)
  assert.equal(serializeSave(retreatState).activeBattle, null)
  persistSave(storage, retreatState)
  assert.equal(loadSave(storage)?.activeBattle, null, 'Retreat/Abandon must clear persisted activeBattle')
})

test('Turn-boundary auto-save trigger fires only on turn changes and never on every frame', () => {
  const state = createInitialState(909)
  const tracker = createTurnBoundaryTracker()

  // No battle yet -> never fires
  assert.equal(shouldAutoSaveOnTurnBoundary(tracker, state.battle), false)

  // Start battle -> fires once for Turn 1
  const battle = startChapterBattle(state, 0, 0)
  assert.equal(shouldAutoSaveOnTurnBoundary(tracker, battle), true, 'Must fire at battle start (Turn 1)')

  // Stepping 120 idle frames within Turn 1 -> never fires again
  let idleTriggers = 0
  for (let i = 0; i < 120; i++) {
    stepGame(state, STEP)
    if (shouldAutoSaveOnTurnBoundary(tracker, battle)) idleTriggers++
  }
  assert.equal(idleTriggers, 0, 'Must NOT trigger auto-save during idle frames of the same turn')

  // End player turn -> advances to Turn 2 -> fires once
  endPlayerTurn(state)
  assert.equal(shouldAutoSaveOnTurnBoundary(tracker, battle), true, 'Must fire when advancing to Turn 2')
  assert.equal(shouldAutoSaveOnTurnBoundary(tracker, battle), false, 'Must not fire twice on Turn 2')

  // Step through enemy turns and count triggers vs actual turn increments
  const startTurn = battle.turn
  let triggers = 0
  let guard = 0
  while (battle.phase === 'enemy' && guard++ < 600) {
    stepGame(state, STEP)
    if (shouldAutoSaveOnTurnBoundary(tracker, battle)) triggers++
  }
  const turnsAdvanced = battle.turn - startTurn
  assert.ok(turnsAdvanced >= 1, 'Expected at least one turn boundary during enemy phase')
  assert.equal(triggers, turnsAdvanced, 'Auto-save must fire strictly once per turn boundary')

  // Syncing tracker after resume suppresses duplicate immediate save for the resumed turn
  const snap = serializeBattleState(battle, state.campaign.seed) as BattleSaveSnapshot
  const resumed = createInitialState(100)
  assert.equal(restoreBattleState(resumed, snap), true)
  const resumeTracker = createTurnBoundaryTracker()
  syncTurnBoundaryTracker(resumeTracker, resumed.battle)
  assert.equal(shouldAutoSaveOnTurnBoundary(resumeTracker, resumed.battle), false)
  endPlayerTurn(resumed)
  assert.equal(shouldAutoSaveOnTurnBoundary(resumeTracker, resumed.battle), true)

  // Clearing battle resets tracker so a future battle fires Turn 1 again
  abandonBattle(resumed)
  assert.equal(shouldAutoSaveOnTurnBoundary(resumeTracker, resumed.battle), false)
  const freshBattle = startChapterBattle(resumed, 0, 0)
  assert.equal(shouldAutoSaveOnTurnBoundary(resumeTracker, freshBattle), true)
})

test('Mid-path serialization snaps moving unit to destination without corrupting occupied cells', () => {
  const state = createInitialState(616)
  const battle = startChapterBattle(state, 0, 0)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const dest = battle.moveTiles[battle.moveTiles.length - 1]
  assert.ok(dest)

  // Start walking and step only 2 frames (mid-stride, path.length > 0)
  assert.equal(selectTile(state, dest.col, dest.row), true)
  stepGame(state, STEP)
  stepGame(state, STEP)
  assert.ok(active.path.length > 0, 'Unit should still be mid-path')

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap)
  const snapActive = snap.units.find(u => u.uid === active.uid)!
  assert.equal(snapActive.col, dest.col)
  assert.equal(snapActive.row, dest.row)

  const resumed = createInitialState(616)
  assert.equal(restoreBattleState(resumed, snap), true)
  const resumedActive = getUnitByUid(resumed.battle!, active.uid)!
  assert.equal(resumedActive.col, dest.col)
  assert.equal(resumedActive.row, dest.row)
  assert.deepEqual(resumedActive.path, [])
})
