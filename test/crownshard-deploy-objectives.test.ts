import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { CHAPTER_BY_ID, PLAYABLE_CHAPTERS } from '../examples/crownshard/crownshard/data.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill, beginBattleFromDeploy, confirmDeployment, createInitialState, endPlayerTurn,
  evaluateBattleObjective, getObjectiveProgressText, getUnitByUid, isChestClaimed, isDeployTile,
  loadSave, moveDeployUnit, persistSave, rotateDeployUnit, selectHeroByUid, selectTile,
  serializeBattleState, serializeSave, startChapterBattle, startStageBattle, stepGame,
  swapDeployUnit
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleObjectiveKind, GameState } from '../examples/crownshard/crownshard/types.ts'
import { drawDeployHeroChip, drawObjectiveBadge } from '../examples/crownshard/crownshard/ui-art.ts'

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) }
  }
}

function fakeRenderer() {
  let drawn = 0
  let lastInstances = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
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

test('Pre-battle deployment phase supports moving, swapping, rotating, rejecting invalid tiles, and confirming into Turn 1', () => {
  // 1. Default startChapterBattle stays backwards-compatible (enters 'player' immediately)
  const compatState = createInitialState(101)
  const compatBattle = startChapterBattle(compatState, 0)
  assert.equal(compatBattle.phase, 'player')
  assert.equal(compatBattle.turn, 1)

  // 2. Opting into deployPhase enters 'deploy' with expanded blue spawn zone
  const state = createInitialState(202)
  const battle = startChapterBattle(state, 0, 0, { deployPhase: true })
  assert.equal(battle.phase, 'deploy')
  assert.equal(battle.turn, 0)
  assert.equal(battle.activeUnitUid, null)
  assert.ok(battle.deployTiles.length >= 6, `Expected expanded deploy zone (>=6 tiles), got ${battle.deployTiles.length}`)
  for (const dt of battle.deployTiles) {
    assert.ok(battle.cells[dt.row][dt.col].walkable, `Deploy tile (${dt.col},${dt.row}) must be walkable`)
  }
  // Auto-save intentionally skips pre-battle deploy phase until Turn 1 launches
  assert.equal(serializeBattleState(battle, state.campaign.seed), null)

  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  assert.ok(allies.length >= 3)
  const heroA = allies[0]
  const heroB = allies[1]
  const heroC = allies[2]

  // Find an open deploy tile not currently occupied by any hero
  const openDeploy = battle.deployTiles.find(t =>
    !battle.units.some(u => u.alive && u.col === t.col && u.row === t.row)
  )!
  assert.ok(openDeploy, 'Expected at least one open blue deploy tile')

  // 3. Move heroA to open deploy tile via click-select + click-tile
  assert.equal(selectTile(state, heroA.col, heroA.row), true)
  assert.equal(battle.selectedUnitUid, heroA.uid)
  assert.equal(selectTile(state, openDeploy.col, openDeploy.row), true)
  assert.equal(heroA.col, openDeploy.col)
  assert.equal(heroA.row, openDeploy.row)
  const expectedCell = battle.cells[openDeploy.row][openDeploy.col]
  const [ex, ey, ez] = gridToWorld(openDeploy.col, openDeploy.row, expectedCell.elevation, battle.cols, battle.rows)
  assert.equal(heroA.x, ex)
  assert.equal(heroA.y, ey)
  assert.equal(heroA.z, ez)

  // 4. Swap heroA and heroB via click on heroB (while heroA is selected)
  const aBefore = { col: heroA.col, row: heroA.row }
  const bBefore = { col: heroB.col, row: heroB.row }
  assert.equal(selectTile(state, heroB.col, heroB.row), true)
  assert.equal(heroA.col, bBefore.col)
  assert.equal(heroA.row, bBefore.row)
  assert.equal(heroB.col, aBefore.col)
  assert.equal(heroB.row, aBefore.row)

  // Direct swapDeployUnit helper swaps heroB and heroC back and forth cleanly
  const cBefore = { col: heroC.col, row: heroC.row }
  assert.equal(swapDeployUnit(state, heroB.uid, heroC.uid), true)
  assert.equal(heroB.col, cBefore.col)
  assert.equal(heroB.row, cBefore.row)
  assert.equal(heroC.col, aBefore.col)
  assert.equal(heroC.row, aBefore.row)

  // 5. Reject placement on non-deploy tiles (both empty walkable non-deploy tile and impassable tile)
  let nonDeployWalkable: { col: number; row: number } | null = null
  for (let r = 0; r < battle.rows && !nonDeployWalkable; r++) {
    for (let c = 0; c < battle.cols && !nonDeployWalkable; c++) {
      if (
        battle.cells[r][c].walkable &&
        !isDeployTile(battle, c, r) &&
        !battle.units.some(u => u.alive && u.col === c && u.row === r)
      ) {
        nonDeployWalkable = { col: c, row: r }
      }
    }
  }
  assert.ok(nonDeployWalkable, 'Expected at least one non-deploy walkable tile on the board')
  const aPosBeforeReject = { col: heroA.col, row: heroA.row }
  assert.equal(moveDeployUnit(state, heroA.uid, nonDeployWalkable.col, nonDeployWalkable.row), false)
  assert.equal(selectTile(state, heroA.col, heroA.row), true)
  assert.equal(selectTile(state, nonDeployWalkable.col, nonDeployWalkable.row), false)
  assert.equal(heroA.col, aPosBeforeReject.col)
  assert.equal(heroA.row, aPosBeforeReject.row)

  // 6. Rotate initial facing (N/E/S/W) during deployment
  assert.equal(rotateDeployUnit(state, heroA.uid, 'n'), true)
  assert.equal(heroA.facing, 'n')
  assert.equal(rotateDeployUnit(state, heroA.uid), true)
  assert.equal(heroA.facing, 'e')
  assert.equal(rotateDeployUnit(state, heroB.uid, 's'), true)
  assert.equal(heroB.facing, 's')
  assert.equal(rotateDeployUnit(state, heroC.uid, 'w'), true)
  assert.equal(heroC.facing, 'w')

  // Snapshot exact pre-start positions & facings
  const snapshotBeforeConfirm = allies.map(u => ({
    uid: u.uid,
    col: u.col,
    row: u.row,
    facing: u.facing
  }))

  // 7. confirmDeployment transitions cleanly to Turn 1 preserving exact hero positions & facings
  assert.equal(confirmDeployment(state), true)
  assert.equal(battle.phase, 'player')
  assert.equal(battle.turn, 1)
  assert.ok(battle.activeUnitUid, 'Active unit must be chosen on Turn 1')
  assert.equal(beginBattleFromDeploy(state), false, 'Calling confirmDeployment again after battle started must return false')

  for (const snap of snapshotBeforeConfirm) {
    const unit = battle.units.find(u => u.uid === snap.uid)!
    assert.equal(unit.col, snap.col, `Hero ${unit.name} col must be preserved after deployment`)
    assert.equal(unit.row, snap.row, `Hero ${unit.name} row must be preserved after deployment`)
    assert.equal(unit.facing, snap.facing, `Hero ${unit.name} facing must be preserved after deployment`)
  }
})

test('Assassinate objective triggers immediate Victory when named boss falls even while minions remain alive', () => {
  const state = createInitialState(303)
  const battle = startStageBattle(state, 'eclipse_throne')
  assert.equal(battle.objective.kind, 'assassinate')
  assert.ok(battle.objective.targetEnemyUid, 'Assassinate battle must resolve targetEnemyUid')
  assert.equal(battle.objective.targetName, 'Archon Malakor')

  const boss = battle.units.find(u => u.uid === battle.objective.targetEnemyUid)!
  assert.ok(boss && boss.alive && boss.isBoss)
  const minions = battle.units.filter(u => u.alive && u.team === 'enemy' && u.uid !== boss.uid)
  assert.ok(minions.length >= 3, 'Eclipse Throne must have multiple minions alongside the boss')

  assert.equal(evaluateBattleObjective(battle).status, 'ongoing')
  assert.ok(getObjectiveProgressText(battle).includes('Archon Malakor'))

  // Move active hero adjacent to weakened boss and finish boss while all minions stay at full HP
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  boss.hp = 5
  boss.shield = 0
  active.col = boss.col - 1
  active.row = boss.row
  active.acted = false
  active.cooldowns = [0, 0, 0]
  selectHeroByUid(state, active.uid)
  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, boss.col, boss.row), true)

  assert.equal(boss.alive, false)
  assert.ok(minions.every(m => m.alive), 'Minions must still be alive when boss falls')
  assert.equal(evaluateBattleObjective(battle).status, 'victory')
  assert.equal(battle.phase, 'victory', 'Slaying target boss must immediately trigger Victory')
  assert.ok(battle.reward, 'Assassinate victory must grant stage reward')
})

test('Defend objective wins after surviving targetTurns and loses immediately if an enemy breaches protectTile', () => {
  // Case A: Surviving targetTurns triggers immediate Victory while enemies remain alive
  const winState = createInitialState(404)
  const winBattle = startStageBattle(winState, 'sunken_bridge')
  assert.equal(winBattle.objective.kind, 'defend')
  const targetTurns = winBattle.objective.targetTurns!
  assert.ok(targetTurns >= 5)
  assert.ok(winBattle.objective.protectTile)

  // Keep enemies safely far away & stunned so we can cleanly test surviving targetTurns
  for (const u of winBattle.units) {
    if (u.team === 'enemy') u.stunTurns = 20
  }

  let guard = 0
  while (winBattle.phase !== 'victory' && guard++ < 120) {
    if (winBattle.phase === 'player') {
      endPlayerTurn(winState)
    } else if (winBattle.phase === 'enemy') {
      stepGame(winState, STEP)
    } else {
      break
    }
  }
  assert.equal(winBattle.phase, 'victory', 'Surviving targetTurns must trigger Victory')
  assert.ok(winBattle.objective.roundsElapsed >= targetTurns)
  assert.ok(winBattle.units.some(u => u.alive && u.team === 'enemy'), 'Enemies can still be alive on Defend victory')
  assert.ok(winBattle.reward)

  // Case B: Enemy stepping onto protectTile triggers immediate Defeat!
  const loseState = createInitialState(405)
  const loseBattle = startStageBattle(loseState, 'obsidian_gate')
  assert.equal(loseBattle.objective.kind, 'defend')
  const protect = loseBattle.objective.protectTile!
  assert.ok(protect)

  // Clear any ally off the protect tile and place an enemy adjacent so it steps onto protectTile
  for (const u of loseBattle.units) {
    if (u.team === 'ally' && u.col === protect.col && u.row === protect.row) {
      u.col = 0
      u.row = 1
    }
  }
  const enemy = loseBattle.units.find(u => u.alive && u.team === 'enemy')!
  const startCell = loseBattle.cells[protect.row][protect.col - 1]
  const [ex, ey, ez] = gridToWorld(protect.col - 1, protect.row, startCell.elevation, loseBattle.cols, loseBattle.rows)
  enemy.col = protect.col - 1
  enemy.row = protect.row
  enemy.x = ex
  enemy.y = ey
  enemy.z = ez
  enemy.path = [{ col: protect.col, row: protect.row }]
  enemy.moveProgress = 0.9

  stepGame(loseState, 0.05)
  assert.equal(loseBattle.objective.protectBreached, true)
  assert.equal(evaluateBattleObjective(loseBattle).status, 'defeat')
  assert.equal(loseBattle.phase, 'defeat', 'Enemy breaching protected tile must trigger immediate Defeat')
  assert.ok(loseBattle.bannerText.toLowerCase().includes('breached'))
})

test('Seize objective wins via goal tile or required chests and loses when turnLimit expires', () => {
  // Case A: Stepping an ally onto goalTile triggers immediate Victory while enemies live
  const goalState = createInitialState(505)
  const goalBattle = startStageBattle(goalState, 'frozen_lake')
  assert.equal(goalBattle.objective.kind, 'seize')
  const goal = goalBattle.objective.goalTile!
  assert.ok(goal)

  const hero = getUnitByUid(goalBattle, goalBattle.activeUnitUid)!
  const adjCol = goal.col - 1
  const adjRow = goal.row
  const adjCell = goalBattle.cells[adjRow][adjCol]
  const [hx, hy, hz] = gridToWorld(adjCol, adjRow, adjCell.elevation, goalBattle.cols, goalBattle.rows)
  hero.col = adjCol
  hero.row = adjRow
  hero.x = hx
  hero.y = hy
  hero.z = hz
  hero.moved = false
  selectHeroByUid(goalState, hero.uid)
  assert.ok(goalBattle.moveTiles.some(t => t.col === goal.col && t.row === goal.row), 'Goal tile must be reachable')
  assert.equal(selectTile(goalState, goal.col, goal.row), true)
  for (let i = 0; i < 60; i++) stepGame(goalState, STEP)

  assert.equal(goalBattle.objective.seized, true)
  assert.equal(goalBattle.phase, 'victory', 'Stepping onto Seize goal tile must immediately win')
  assert.ok(goalBattle.units.some(u => u.alive && u.team === 'enemy'), 'Enemies remain alive on Seize victory')

  // Case B: Claiming required treasure chests triggers immediate Victory & bonus gold
  const chestState = createInitialState(506)
  const chestBattle = startStageBattle(chestState, 'miller_ford')
  assert.equal(chestBattle.objective.kind, 'seize')
  assert.equal(chestBattle.objective.chestTiles.length, 2)
  assert.equal(chestBattle.objective.requiredChests, 2)
  const goldStart = chestState.campaign.gold

  const cHero = getUnitByUid(chestBattle, chestBattle.activeUnitUid)!
  const [chest1, chest2] = chestBattle.objective.chestTiles
  // Clear enemies off chest paths just in case
  for (const e of chestBattle.units) {
    if (e.team === 'enemy') e.stunTurns = 20
  }
  cHero.path = [chest1]
  cHero.moveProgress = 0.9
  stepGame(chestState, 0.05)
  assert.equal(isChestClaimed(chestBattle.objective, chest1.col, chest1.row), true)
  assert.equal(chestBattle.objective.claimedChests.length, 1)
  assert.equal(chestState.campaign.gold, goldStart + 25, 'Claiming a chest must award bonus gold')
  assert.equal(chestBattle.phase, 'player', 'One of two chests should keep battle ongoing')

  cHero.path = [chest2]
  cHero.moveProgress = 0.9
  stepGame(chestState, 0.05)
  assert.equal(chestBattle.objective.claimedChests.length, 2)
  assert.equal(chestBattle.phase, 'victory', 'Claiming all required chests must trigger Victory')

  // Case C: Exceeding turnLimit triggers Defeat
  const timeoutState = createInitialState(507)
  const timeoutBattle = startStageBattle(timeoutState, 'frozen_lake')
  const limit = timeoutBattle.objective.turnLimit!
  assert.ok(limit > 0)
  for (const e of timeoutBattle.units) {
    if (e.team === 'enemy') e.stunTurns = 30
  }
  let guard = 0
  while (timeoutBattle.phase !== 'defeat' && guard++ < 150) {
    if (timeoutBattle.phase === 'player') {
      endPlayerTurn(timeoutState)
    } else if (timeoutBattle.phase === 'enemy') {
      stepGame(timeoutState, STEP)
    } else {
      break
    }
  }
  assert.equal(timeoutBattle.phase, 'defeat', 'Exceeding Seize turnLimit must trigger Defeat')
  assert.equal(timeoutBattle.objective.roundsElapsed, limit)
  assert.ok(timeoutBattle.bannerText.toLowerCase().includes('turn limit'))
})

test('Campaign playable stages cover all 4 objective types with valid walkable coordinates and deploy zones', () => {
  const seenKinds = new Set<BattleObjectiveKind>()
  assert.equal(CHAPTER_BY_ID.border_watch.objective?.kind ?? 'rout', 'rout', 'Stage 1 must remain classic rout')

  for (const ch of PLAYABLE_CHAPTERS) {
    const state = createInitialState(600 + ch.index)
    const battle = startStageBattle(state, ch.id, 0, { deployPhase: true })
    seenKinds.add(battle.objective.kind)

    assert.ok(battle.deployTiles.length >= ch.heroSpawns.length, `${ch.id} must have >= heroSpawns deploy tiles`)
    for (const dt of battle.deployTiles) {
      assert.ok(dt.col >= 0 && dt.col < battle.cols && dt.row >= 0 && dt.row < battle.rows, `${ch.id} deploy tile in bounds`)
      assert.ok(terrainWalkable(ch.grid[dt.row][dt.col]), `${ch.id} deploy tile (${dt.col},${dt.row}) walkable`)
      assert.ok(!ch.enemies.some(e => e.col === dt.col && e.row === dt.row), `${ch.id} deploy tile must not overlap enemy`)
    }

    const obj = battle.objective
    if (obj.kind === 'assassinate') {
      assert.ok(obj.targetEnemyUid, `${ch.id} assassinate needs targetEnemyUid`)
      assert.ok(battle.units.some(u => u.uid === obj.targetEnemyUid && u.team === 'enemy'), `${ch.id} target enemy must exist`)
    }
    if (obj.protectTile) {
      const { col, row } = obj.protectTile
      assert.ok(col >= 0 && col < battle.cols && row >= 0 && row < battle.rows, `${ch.id} protectTile in bounds`)
      assert.ok(terrainWalkable(ch.grid[row][col]), `${ch.id} protectTile (${col},${row}) must be walkable`)
    }
    if (obj.goalTile) {
      const { col, row } = obj.goalTile
      assert.ok(col >= 0 && col < battle.cols && row >= 0 && row < battle.rows, `${ch.id} goalTile in bounds`)
      assert.ok(terrainWalkable(ch.grid[row][col]), `${ch.id} goalTile (${col},${row}) must be walkable`)
      assert.ok(!isDeployTile(battle, col, row), `${ch.id} goalTile must not overlap deploy zone`)
    }
    for (const ct of obj.chestTiles) {
      assert.ok(ct.col >= 0 && ct.col < battle.cols && ct.row >= 0 && ct.row < battle.rows, `${ch.id} chestTile in bounds`)
      assert.ok(terrainWalkable(ch.grid[ct.row][ct.col]), `${ch.id} chestTile (${ct.col},${ct.row}) must be walkable`)
      assert.ok(!isDeployTile(battle, ct.col, ct.row), `${ch.id} chestTile must not overlap deploy zone`)
    }
  }

  assert.equal(seenKinds.has('rout'), true, 'Campaign must include rout stages')
  assert.equal(seenKinds.has('assassinate'), true, 'Campaign must include assassinate stages')
  assert.equal(seenKinds.has('defend'), true, 'Campaign must include defend stages')
  assert.equal(seenKinds.has('seize'), true, 'Campaign must include seize stages')
})

test('Mid-battle auto-save round-trip preserves objective state, claimed chests, and turn progress', () => {
  const storage = createMemoryStorage()

  // 1. Seize with claimed chest & elapsed turns
  const seizeState = createInitialState(701)
  const seizeBattle = startStageBattle(seizeState, 'miller_ford')
  const hero = getUnitByUid(seizeBattle, seizeBattle.activeUnitUid)!
  const [chest1] = seizeBattle.objective.chestTiles
  hero.path = [chest1]
  hero.moveProgress = 0.9
  stepGame(seizeState, 0.05)
  seizeBattle.objective.roundsElapsed = 3

  persistSave(storage, seizeState)
  const loaded = loadSave(storage)
  assert.ok(loaded && loaded.activeBattle?.objective)
  const resumed = createInitialState(999, loaded)
  assert.ok(resumed.battle)
  assert.equal(resumed.battle.objective.kind, 'seize')
  assert.equal(resumed.battle.objective.roundsElapsed, 3)
  assert.equal(resumed.battle.objective.claimedChests.length, 1)
  assert.equal(isChestClaimed(resumed.battle.objective, chest1.col, chest1.row), true)
  assert.equal(resumed.battle.objective.turnLimit, seizeBattle.objective.turnLimit)

  // 2. Defend with elapsed turns & protectTile
  const defendState = createInitialState(702)
  const defendBattle = startStageBattle(defendState, 'sunken_bridge')
  defendBattle.objective.roundsElapsed = 4
  const defendJson = JSON.parse(JSON.stringify(serializeSave(defendState)))
  const defendResumed = createInitialState(999, defendJson)
  assert.ok(defendResumed.battle)
  assert.equal(defendResumed.battle.objective.kind, 'defend')
  assert.equal(defendResumed.battle.objective.roundsElapsed, 4)
  assert.equal(defendResumed.battle.objective.targetTurns, defendBattle.objective.targetTurns)
  assert.deepEqual(defendResumed.battle.objective.protectTile, defendBattle.objective.protectTile)

  // 3. Assassinate preserves targetEnemyUid & targetName
  const bossState = createInitialState(703)
  const bossBattle = startStageBattle(bossState, 'eclipse_throne')
  const bossJson = JSON.parse(JSON.stringify(serializeSave(bossState)))
  const bossResumed = createInitialState(999, bossJson)
  assert.ok(bossResumed.battle)
  assert.equal(bossResumed.battle.objective.kind, 'assassinate')
  assert.equal(bossResumed.battle.objective.targetEnemyUid, bossBattle.objective.targetEnemyUid)
  assert.equal(bossResumed.battle.objective.targetName, 'Archon Malakor')
})

test('CrownshardScene renders deploy blue spawn zones and 3D objective markers across all mission types without throwing', () => {
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  const stages = ['border_watch', 'miller_ford', 'sunken_bridge', 'cursed_vault', 'eclipse_throne'] as const
  for (const stageId of stages) {
    const state = createInitialState(808)
    const battle = startStageBattle(state, stageId, 0, { deployPhase: true })
    scene.setHoveredCell(battle.deployTiles[0] ?? null)
    scene.render(state, 1 / 60, 1280, 720)
    assert.ok(fake.lastInstances > 10, `${stageId} deploy phase must emit instances`)

    // Select hero & render again during deploy
    const hero = battle.units.find(u => u.team === 'ally')!
    battle.selectedUnitUid = hero.uid
    scene.render(state, 1 / 60, 1280, 720)

    // Confirm deployment and render active objective markers
    assert.equal(confirmDeployment(state), true)
    scene.render(state, 1 / 60, 1280, 720)
    assert.ok(fake.lastInstances > 10, `${stageId} active battle with objective markers must emit instances`)
  }
  assert.ok(fake.drawn >= stages.length * 3)
  scene.dispose()

  // Smoke-check HUD Objective Badge & Deploy Hero Chip Canvas 2D painters
  let ops = 0
  const grad = { addColorStop() {} }
  const ctx = new Proxy({} as CanvasRenderingContext2D, {
    get(_t, prop) {
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 7 })
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => grad
      return () => { ops++ }
    },
    set() { return true }
  })
  for (const kind of ['rout', 'assassinate', 'defend', 'seize'] as const) {
    drawObjectiveBadge(ctx, { x: 8, y: 56, width: 256, height: 30 }, {
      kind,
      label: `Objective ${kind}`,
      progressText: `Progress ${kind}`,
      urgent: kind === 'defend'
    })
  }
  drawDeployHeroChip(
    ctx,
    { x: 10, y: 600, width: 140, height: 52 },
    { name: 'Sir Aldric', facing: 'e', selected: true },
    { hovered: false, pressed: false, disabled: false, selected: true, focused: false }
  )
  assert.ok(ops > 20, 'HUD painters must emit canvas draw calls')
})
