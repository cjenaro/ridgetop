import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill, armTacticCard, beginWaitFacingPicker, canUndoMove, computeCombatForecast, computeDangerZone,
  computeEnemyThreat, createInitialState, endPlayerTurn, getUnitByUid, previewWaitFacing, refreshHighlights,
  rotateActiveUnitFacing, selectTile, setUnitFacing, startChapterBattle, stepGame, undoMove
} from '../examples/crownshard/crownshard/simulation.ts'
import {
  gridToWorld, terrainElevation, terrainWalkable
} from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, GameState, GridCell, TileTerrain } from '../examples/crownshard/crownshard/types.ts'

function makeCell(col: number, row: number, terrain: TileTerrain, heightLevel = 0): GridCell {
  const h = terrain === 'void' ? -1 : heightLevel
  return {
    col,
    row,
    terrain,
    elevation: terrainElevation(terrain, h),
    walkable: terrainWalkable(terrain),
    heightLevel: h
  }
}

function flattenArena(battle: BattleState, terrain: TileTerrain = 'grass', heightLevel = 0): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, terrain, heightLevel)
    }
  }
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number): void {
  const cell = battle.cells[row][col]
  const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = wx
  unit.y = wy
  unit.z = wz
  unit.path = []
  unit.moveProgress = 0
}

function walkToArrival(state: GameState, maxSteps = 200): void {
  for (let i = 0; i < maxSteps; i++) {
    stepGame(state, 1 / 30)
    if (!state.battle?.units.some(u => u.path.length > 0)) break
  }
}

function fakeRenderer() {
  let drawn = 0
  let lastInstances = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      drawn++
      let total = 0
      for (const b of batches) total += b.count
      lastInstances = total
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get drawn() { return drawn },
    get lastInstances() { return lastInstances }
  }
}

test('Undo Move restores turn-start col, row, x, y, z, facing, yaw, refunds movement, and recomputes full moveTiles', () => {
  const state = createInitialState(8101)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)
  battle.cells[2][3] = makeCell(3, 2, 'hill', 1)

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  assert.equal(hero.team, 'ally')
  const blockerEnemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== hero.uid && u.uid !== blockerEnemy.uid) { u.alive = false; u.hp = 0 }
  }
  placeUnit(battle, blockerEnemy, battle.cols - 1, battle.rows - 1)
  placeUnit(battle, hero, 2, 2)
  setUnitFacing(hero, 'n')
  refreshHighlights(battle, state.campaign)

  const startSnapshot = {
    col: hero.col,
    row: hero.row,
    x: hero.x,
    y: hero.y,
    z: hero.z,
    facing: hero.facing,
    yaw: hero.yaw
  }
  const initialMoveCount = battle.moveTiles.length
  assert.ok(initialMoveCount >= 6, 'Hero should have multiple reachable move tiles at turn start')
  assert.equal(canUndoMove(battle), false, 'Cannot undo before moving')
  assert.equal(undoMove(state), false)

  // Move onto elevated hill tile (3, 2)
  assert.equal(selectTile(state, 3, 2), true)
  walkToArrival(state)
  assert.equal(hero.col, 3)
  assert.equal(hero.row, 2)
  assert.equal(hero.moved, true)
  assert.equal(battle.moveTiles.length, 0, 'moveTiles cleared after moving')
  assert.ok(hero.y > startSnapshot.y, 'Hero climbed onto elevated hill')

  // Rotate facing after moving — undo should still be available and restore original facing/yaw!
  assert.equal(rotateActiveUnitFacing(state, 's'), true)
  assert.equal(hero.facing, 's')
  assert.equal(canUndoMove(battle), true)

  // Undo Move!
  assert.equal(undoMove(state), true)
  assert.equal(hero.col, startSnapshot.col)
  assert.equal(hero.row, startSnapshot.row)
  assert.ok(Math.abs(hero.x - startSnapshot.x) < 1e-6)
  assert.ok(Math.abs(hero.y - startSnapshot.y) < 1e-6)
  assert.ok(Math.abs(hero.z - startSnapshot.z) < 1e-6)
  assert.equal(hero.facing, startSnapshot.facing)
  assert.ok(Math.abs(hero.yaw - startSnapshot.yaw) < 1e-6)
  assert.equal(hero.moved, false)
  assert.equal(hero.path.length, 0)
  assert.equal(hero.animState, 'idle')
  assert.equal(battle.moveTiles.length, initialMoveCount, 'Full moveTiles must be restored after Undo Move')
  assert.equal(canUndoMove(battle), false, 'Cannot undo twice in a row')
  assert.equal(undoMove(state), false)

  // Mid-stride Undo Move cleanly cancels walk path and snaps back
  assert.equal(selectTile(state, 4, 2), true)
  stepGame(state, 0.05) // mid-walk!
  assert.ok(hero.path.length > 0, 'Hero should be mid-stride')
  assert.equal(hero.animState, 'run')
  assert.equal(canUndoMove(battle), true)
  assert.equal(undoMove(state), true)
  assert.equal(hero.col, startSnapshot.col)
  assert.equal(hero.row, startSnapshot.row)
  assert.ok(Math.abs(hero.x - startSnapshot.x) < 1e-6)
  assert.ok(Math.abs(hero.y - startSnapshot.y) < 1e-6)
  assert.ok(Math.abs(hero.z - startSnapshot.z) < 1e-6)
  assert.equal(hero.path.length, 0)
  assert.equal(hero.moveProgress, 0)
  assert.equal(hero.animState, 'idle')
  assert.equal(hero.moved, false)
})

test('Undo Move locks out after attacking, casting a skill, playing a tactic card, triggering a shrine, or ending turn', () => {
  // 1. Lockout after Basic Attack
  {
    const state = createInitialState(8102)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    const hero = getUnitByUid(battle, battle.activeUnitUid)!
    const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
    for (const u of battle.units) {
      if (u.uid !== hero.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
    }
    placeUnit(battle, hero, 2, 2)
    placeUnit(battle, enemy, 4, 2)
    enemy.hp = 200
    enemy.maxHp = 200
    refreshHighlights(battle, state.campaign)

    assert.equal(selectTile(state, 3, 2), true)
    walkToArrival(state)
    assert.equal(canUndoMove(battle), true)

    // Attack adjacent enemy at (4, 2)
    assert.equal(selectTile(state, 4, 2), true)
    assert.equal(hero.acted, true)
    assert.equal(canUndoMove(battle), false, 'Attacking must lock out Undo Move')
    assert.equal(undoMove(state), false)
    assert.equal(hero.col, 3, 'Failed undoMove must not mutate hero col')
    assert.equal(hero.row, 2, 'Failed undoMove must not mutate hero row')
  }

  // 2. Lockout after Casting a Skill
  {
    const state = createInitialState(8103)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    const hero = getUnitByUid(battle, battle.activeUnitUid)!
    const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
    for (const u of battle.units) {
      if (u.uid !== hero.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
    }
    placeUnit(battle, hero, 2, 2)
    placeUnit(battle, enemy, 4, 2)
    enemy.hp = 200
    enemy.maxHp = 200
    refreshHighlights(battle, state.campaign)

    assert.equal(selectTile(state, 3, 2), true)
    walkToArrival(state)
    assert.equal(canUndoMove(battle), true)

    assert.equal(armSkill(state, 0), true)
    if (!hero.acted) {
      assert.equal(selectTile(state, 4, 2), true)
    }
    assert.equal(hero.acted, true)
    assert.equal(canUndoMove(battle), false, 'Casting a skill must lock out Undo Move')
    assert.equal(undoMove(state), false)
    assert.equal(hero.col, 3)
    assert.equal(hero.row, 2)
  }

  // 3. Lockout after Playing a Tactic Card
  {
    const state = createInitialState(8104)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    const hero = getUnitByUid(battle, battle.activeUnitUid)!
    placeUnit(battle, hero, 1, 2)
    battle.ap = 4
    refreshHighlights(battle, state.campaign)

    assert.equal(selectTile(state, 2, 2), true)
    walkToArrival(state)
    assert.equal(canUndoMove(battle), true)

    const tacticUid = battle.hand[0]
    assert.ok(tacticUid, 'Hero should have at least one tactic card in hand')
    assert.equal(armTacticCard(state, tacticUid), true)
    if (battle.armedTacticUid) {
      const target = battle.targetTiles[0]
      assert.ok(target, 'Armed tactic should have a valid target tile')
      assert.equal(selectTile(state, target.col, target.row), true)
    }
    assert.equal(canUndoMove(battle), false, 'Playing a tactic card must lock out Undo Move')
    assert.equal(undoMove(state), false)
    assert.equal(hero.col, 2)
    assert.equal(hero.row, 2)
  }

  // 4. Lockout after Triggering a Shrine
  {
    const state = createInitialState(8105)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    battle.cells[2][3] = makeCell(3, 2, 'shrine', 0)
    const hero = getUnitByUid(battle, battle.activeUnitUid)!
    for (const u of battle.units) {
      if (u.uid !== hero.uid && u.team === 'ally') { u.alive = false; u.hp = 0 }
    }
    placeUnit(battle, hero, 2, 2)
    refreshHighlights(battle, state.campaign)

    assert.equal(selectTile(state, 3, 2), true)
    walkToArrival(state)
    assert.equal(hero.col, 3)
    assert.equal(hero.row, 2)
    assert.equal(canUndoMove(battle), false, 'Stepping onto a shrine must lock out Undo Move')
    assert.equal(undoMove(state), false)
    assert.equal(hero.col, 3)
    assert.equal(hero.row, 2)
  }

  // 5. Lockout after Ending Turn
  {
    const state = createInitialState(8106)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    const hero = getUnitByUid(battle, battle.activeUnitUid)!
    placeUnit(battle, hero, 1, 2)
    refreshHighlights(battle, state.campaign)

    assert.equal(selectTile(state, 2, 2), true)
    walkToArrival(state)
    assert.equal(canUndoMove(battle), true)

    endPlayerTurn(state)
    assert.equal(canUndoMove(battle), false, 'Ending turn must lock out Undo Move')
    assert.equal(undoMove(state), false)
    assert.equal(hero.col, 2)
    assert.equal(hero.row, 2)
  }
})

test('computeEnemyThreat respects multi-tier elevation, jump limits, void chasms, snow, pillar LoS, and flags flank/backstab tiles', () => {
  // Part A: Jump limit, void chasm, stairs, and snow cost for melee enemy
  {
    const state = createInitialState(8201)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)

    // Carve void chasm on col 4 and sheer H2 plateau on (2,1) with stairs only at (2,2)
    battle.cells[1][4] = makeCell(4, 1, 'void', -1)
    battle.cells[2][4] = makeCell(4, 2, 'void', -1)
    battle.cells[1][2] = makeCell(2, 1, 'stone', 2) // sheer cliff from H0!
    battle.cells[2][2] = makeCell(2, 2, 'stairs', 1) // climbable ramp!
    battle.cells[3][1] = makeCell(1, 3, 'snow', 0) // snow costs 2 move!

    const enemy = battle.units.find(u => u.team === 'enemy')!
    const ally = battle.units.find(u => u.team === 'ally')!
    for (const u of battle.units) {
      if (u.uid !== enemy.uid && u.uid !== ally.uid) { u.alive = false; u.hp = 0 }
    }
    enemy.move = 2
    enemy.jump = 1
    enemy.range = 1
    enemy.moved = true // Must still compute full upcoming threat even if enemy already moved last turn!
    enemy.acted = true
    placeUnit(battle, enemy, 1, 1)
    placeUnit(battle, ally, battle.cols - 1, battle.rows - 1)

    const threat = computeEnemyThreat(battle, enemy.uid)
    assert.equal(threat.moveTiles.some(t => t.col === 2 && t.row === 1), false, 'Jump-1 enemy cannot hop sheer 0->2 cliff directly')
    assert.equal(threat.moveTiles.some(t => t.col === 2 && t.row === 2), true, 'Jump-1 enemy can reach H1 stairs at (2,2)')
    assert.equal(threat.moveTiles.some(t => t.col === 4 && t.row === 1), false, 'Void chasm is never in moveTiles')
    assert.equal(threat.attackTiles.some(t => t.col === 4 && t.row === 1), false, 'Void chasm is never in attackTiles')
    // Snow at (1,3) from (1,1): (1,2) costs 1, entering snow (1,3) costs 2 => total 3 > move 2!
    assert.equal(threat.moveTiles.some(t => t.col === 1 && t.row === 3), false, 'Deep snow move cost 2 blocks reaching (1,3) with move 2')
  }

  // Part B: Multi-tier elevation ranged reach (+1 downhill, -1 steep uphill) and Pillar LoS
  {
    const state = createInitialState(8202)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)

    battle.cells[2][1] = makeCell(1, 2, 'hill', 3) // High perch H3
    battle.cells[2][5] = makeCell(5, 2, 'grass', 0) // Dist 4 downhill from (1,2)
    battle.cells[2][3] = makeCell(3, 2, 'grass', 0)
    battle.cells[0][3] = makeCell(3, 0, 'pillar', 0) // Blocks direct LoS along row 0!

    const enemy = battle.units.find(u => u.team === 'enemy')!
    const ally = battle.units.find(u => u.team === 'ally')!
    for (const u of battle.units) {
      if (u.uid !== enemy.uid && u.uid !== ally.uid) { u.alive = false; u.hp = 0 }
    }
    // Pin enemy on H3 perch by surrounding with sheer drop > jump so it cannot step off
    enemy.move = 1
    enemy.jump = 1
    enemy.range = 3
    assert.equal(enemy.isBoss, false)
    placeUnit(battle, enemy, 1, 2)
    placeUnit(battle, ally, battle.cols - 1, battle.rows - 1)

    const highThreat = computeEnemyThreat(battle, enemy.uid)
    assert.equal(highThreat.moveTiles.length, 0, 'Jump-1 enemy pinned on isolated H3 tower cannot step down 3 levels')
    assert.equal(
      highThreat.attackTiles.some(t => t.col === 5 && t.row === 2),
      true,
      'Ranged enemy on H3 gains +1 downhill reach (range 3 -> 4) to threaten (5,2)'
    )

    // Now test steep uphill penalty: enemy on H0 at (5,2) cannot shoot H3 at (2,2) (dist 3, effRange 2!)
    battle.cells[2][1] = makeCell(1, 2, 'grass', 0)
    battle.cells[2][2] = makeCell(2, 2, 'hill', 3)
    enemy.move = 0
    // Keep move=1 but surround (5,2) with void so enemy stays at (5,2)
    battle.cells[1][5] = makeCell(5, 1, 'void', -1)
    battle.cells[3][5] = makeCell(5, 3, 'void', -1)
    battle.cells[2][4] = makeCell(4, 2, 'void', -1)
    battle.cells[2][6] = makeCell(6, 2, 'void', -1)
    placeUnit(battle, enemy, 5, 2)
    const uphillThreat = computeEnemyThreat(battle, enemy.uid)
    assert.equal(
      uphillThreat.attackTiles.some(t => t.col === 2 && t.row === 2),
      false,
      'Steep uphill (-3 levels) shrinks range 3 -> 2 so (2,2) at dist 3 is outside threat reach'
    )

    // Pillar LoS blocking on flat row 0: enemy trapped at (1,0), pillar at (3,0), tile (4,0) is shadowed!
    flattenArena(battle, 'grass', 0)
    battle.cells[0][3] = makeCell(3, 0, 'pillar', 0)
    battle.cells[0][0] = makeCell(0, 0, 'void', -1)
    battle.cells[0][2] = makeCell(2, 0, 'void', -1)
    battle.cells[1][1] = makeCell(1, 1, 'void', -1)
    enemy.move = 1
    enemy.range = 4
    placeUnit(battle, enemy, 1, 0)
    const losThreat = computeEnemyThreat(battle, enemy.uid)
    assert.equal(losThreat.attackTiles.some(t => t.col === 4 && t.row === 0), false, 'Pillar at (3,0) must block enemy LoS to (4,0)')
    assert.equal(losThreat.attackTiles.some(t => t.col === 2 && t.row === 1), true, 'Open diagonal tile (2,1) remains threatened')
  }

  // Part C: Flank and Backstab threat detection against alive heroes
  {
    const state = createInitialState(8203)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)

    const enemy = battle.units.find(u => u.team === 'enemy')!
    const allies = battle.units.filter(u => u.team === 'ally')
    const backstabHero = allies[0]
    const flankHero = allies[1]
    for (const u of battle.units) {
      if (u.uid !== enemy.uid && u.uid !== backstabHero.uid && u.uid !== flankHero.uid) {
        u.alive = false
        u.hp = 0
      }
    }

    // Place enemy pinned at (2,2) with range 3
    battle.cells[1][2] = makeCell(2, 1, 'void', -1)
    battle.cells[3][2] = makeCell(2, 3, 'void', -1)
    battle.cells[2][1] = makeCell(1, 2, 'void', -1)
    battle.cells[2][3] = makeCell(3, 2, 'void', -1)
    enemy.move = 1
    enemy.range = 3
    placeUnit(battle, enemy, 2, 2)

    // backstabHero at (4,2) facing East -> enemy at (2,2) is directly behind them (BACKSTAB)!
    placeUnit(battle, backstabHero, 4, 2)
    setUnitFacing(backstabHero, 'e')

    // flankHero at (2,4) facing East -> enemy at (2,2) is to their north (FLANK)!
    placeUnit(battle, flankHero, 2, 4)
    setUnitFacing(flankHero, 'e')

    const threat = computeEnemyThreat(battle, enemy.uid)
    const backFlag = threat.flankThreatTiles.find(t => t.targetUid === backstabHero.uid)
    const flankFlag = threat.flankThreatTiles.find(t => t.targetUid === flankHero.uid)
    assert.ok(backFlag, 'Hero with back exposed to enemy must be flagged in flankThreatTiles')
    assert.equal(backFlag.arc, 'back')
    assert.equal(backFlag.col, backstabHero.col)
    assert.equal(backFlag.row, backstabHero.row)
    assert.ok(flankFlag, 'Hero with flank exposed to enemy must be flagged in flankThreatTiles')
    assert.equal(flankFlag.arc, 'flank')

    // Rotate backstabHero to face West (directly toward enemy) -> no longer flanked or backstabbed!
    setUnitFacing(backstabHero, 'w')
    const frontThreat = computeEnemyThreat(battle, enemy.uid)
    assert.equal(
      frontThreat.flankThreatTiles.some(t => t.targetUid === backstabHero.uid),
      false,
      'Hero facing the enemy head-on should not be flagged for flank/backstab'
    )
  }
})

test('computeDangerZone equals the union of all alive non-stunned enemy attack reaches with accurate threat counts and flank flags', () => {
  const state = createInitialState(8301)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const enemies = battle.units.filter(u => u.team === 'enemy')
  assert.ok(enemies.length >= 3, 'Chapter 0 should have at least 3 enemies')
  const [e0, e1, e2, ...restEnemies] = enemies
  for (const extra of restEnemies) { extra.alive = false; extra.hp = 0 }

  // e0 & e1 alive and active; e2 stunned (must be excluded cleanly); make another dead if present
  e0.alive = true; e0.stunTurns = 0; e0.move = 2; e0.range = 1
  e1.alive = true; e1.stunTurns = 0; e1.move = 1; e1.range = 2
  e2.alive = true; e2.stunTurns = 1; e2.move = 3; e2.range = 3

  placeUnit(battle, e0, 4, 2)
  placeUnit(battle, e1, 5, 2)
  placeUnit(battle, e2, battle.cols - 1, battle.rows - 1)

  const ally = battle.units.find(u => u.team === 'ally')!
  for (const u of battle.units) {
    if (u.team === 'ally' && u.uid !== ally.uid) { u.alive = false; u.hp = 0 }
  }
  placeUnit(battle, ally, 3, 2)
  setUnitFacing(ally, 'w') // Back exposed to enemies on the east!

  const t0 = computeEnemyThreat(battle, e0.uid)
  const t1 = computeEnemyThreat(battle, e1.uid)
  const t2 = computeEnemyThreat(battle, e2.uid)
  assert.equal(t2.attackTiles.length, 0, 'Stunned enemy must have empty attackTiles')

  const dz = computeDangerZone(battle)
  const expectedUnion = new Set<string>([
    ...t0.attackTiles.map(t => `${t.col},${t.row}`),
    ...t1.attackTiles.map(t => `${t.col},${t.row}`)
  ])
  const actualUnion = new Set<string>(dz.tiles.map(t => `${t.col},${t.row}`))

  assert.deepEqual(actualUnion, expectedUnion, 'Danger zone tile set must exactly match union of alive non-stunned enemy attack reaches')
  assert.equal(dz.enemyThreats.length, 2, 'Only alive non-stunned enemies should appear in enemyThreats')

  // Check overlapping tile at ally position (3,2): threatened by both e0 and e1 with backstab risk!
  const allyDanger = dz.tiles.find(t => t.col === 3 && t.row === 2)
  assert.ok(allyDanger, 'Ally tile (3,2) should be inside the danger zone')
  assert.equal(allyDanger.threatCount, 2, 'Both e0 and e1 threaten (3,2)')
  assert.equal(allyDanger.hasFlankRisk, true)
  assert.equal(allyDanger.hasBackstabRisk, true)
  assert.equal(allyDanger.highestArc, 'back')
  assert.equal(allyDanger.enemyUids.includes(e2.uid), false, 'Stunned enemy must not appear in enemyUids')

  // Kill e1 -> danger zone immediately drops e1's exclusive tiles and lowers overlap count
  e1.alive = false
  e1.hp = 0
  const dzAfterKo = computeDangerZone(battle)
  const expectedAfterKo = new Set(computeEnemyThreat(battle, e0.uid).attackTiles.map(t => `${t.col},${t.row}`))
  assert.deepEqual(
    new Set(dzAfterKo.tiles.map(t => `${t.col},${t.row}`)),
    expectedAfterKo,
    'Dead enemy must be excluded from computeDangerZone'
  )
  assert.equal(dzAfterKo.tiles.find(t => t.col === 3 && t.row === 2)?.threatCount, 1)
})

test('CrownshardScene renders Danger Zone + inspected enemy threat + move/target/AoE overlays + undo snap simultaneously without throwing', () => {
  const state = createInitialState(8401)
  const battle = startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
  // Expose hero's back so flank/backstab warning geometry is also exercised
  setUnitFacing(hero, 'w')

  // Baseline render (Danger Zone OFF, no enemy hovered)
  scene.render(state, 1 / 60, 1280, 720)
  const baseInstances = fake.lastInstances

  // Toggle Danger Zone ON + hover enemy + arm skill + set combat forecast simultaneously!
  assert.equal(scene.toggleDangerZone(), true)
  assert.equal(scene.isDangerZoneVisible(), true)
  scene.setInspectedEnemyUid(enemy.uid)
  assert.equal(scene.getInspectedEnemyUid(), enemy.uid)
  scene.setHoveredCell({ col: enemy.col, row: enemy.row })

  // Arm a hero skill (with AoE or target footprint) and attach a forecast if valid
  armSkill(state, 0)
  const previewTile = battle.targetTiles[0] ?? battle.moveAttackTiles[0]
  if (previewTile) {
    const fc = computeCombatForecast(state, previewTile.col, previewTile.row)
    scene.setForecast(fc)
    scene.setHoveredCell({ col: previewTile.col, row: previewTile.row })
  }

  for (let i = 0; i < 12; i++) {
    stepGame(state, 1 / 60)
    scene.render(state, 1 / 60, 1280, 720)
  }
  const overlayInstances = fake.lastInstances
  assert.ok(fake.drawn > 10)
  assert.ok(
    overlayInstances > baseInstances,
    `Danger Zone + enemy threat + action overlays (${overlayInstances}) should emit more instances than baseline (${baseInstances})`
  )

  // Move hero to a non-shrine tile, then Undo Move + scene.snapUnit and verify clean rendering
  armSkill(state, null)
  scene.setForecast(null)
  const dest = battle.moveTiles.find(t => battle.cells[t.row][t.col].terrain !== 'shrine')
  if (dest) {
    assert.equal(selectTile(state, dest.col, dest.row), true)
    walkToArrival(state)
    assert.equal(undoMove(state), true)
    scene.snapUnit(hero)
    scene.render(state, 1 / 60, 1280, 720)
  }

  scene.setDangerZoneVisible(false)
  scene.setInspectedEnemyUid(null)
  assert.equal(scene.isDangerZoneVisible(), false)
  scene.dispose()
})

test('Undo Move cleanly dismisses an open Wait-to-Face picker and restores turn-start tile and facing', () => {
  const state = createInitialState(8199)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)
  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  placeUnit(battle, hero, 2, 2)
  setUnitFacing(hero, 'e')
  refreshHighlights(battle, state.campaign)

  assert.equal(selectTile(state, 3, 2), true)
  walkToArrival(state)
  assert.equal(canUndoMove(battle), true)
  assert.equal(beginWaitFacingPicker(state), true)
  assert.ok(battle.facingPicker)
  assert.equal(previewWaitFacing(state, 'w'), true)

  assert.equal(undoMove(state), true)
  assert.equal(battle.facingPicker, null, 'undoMove must dismiss active Wait-to-Face picker')
  assert.equal(hero.col, 2)
  assert.equal(hero.row, 2)
  assert.equal(hero.facing, 'e', 'undoMove must restore turn-start facing, not Wait-to-Face preview')
  assert.equal(hero.moved, false)
  assert.equal(selectTile(state, 2, 3), true, 'selectTile must work immediately after undoing from Wait-to-Face')
})
