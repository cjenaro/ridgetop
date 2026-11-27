import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  AUTO_BATTLE_THINK_DELAY,
  DEFAULT_BATTLE_SPEED,
  armSkill,
  armTacticCard,
  beginWaitFacingPicker,
  cancelAutoBattle,
  chooseBestTurnEndFacing,
  createInitialState,
  endPlayerTurn,
  executeAutoBattleStep,
  formatBattleSpeedLabel,
  getUnitByUid,
  loadSave,
  nextBattleSpeed,
  normalizeBattleSpeed,
  persistSave,
  planAutoBattleAction,
  refreshHighlights,
  restoreBattleState,
  rotateActiveUnitFacing,
  scaleBattleDt,
  selectTile,
  serializeBattleState,
  serializeSave,
  setAutoBattle,
  setBattleSpeed,
  setUnitFacing,
  startChapterBattle,
  startStageBattle,
  stepGame,
  toggleAutoBattle,
  toggleBattleSpeed,
  undoMove,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld, isUnitDowned, terrainElevation, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleSaveSnapshot, BattleState, BattleUnit, GameState, GridCell, SaveData, TileTerrain } from '../examples/crownshard/crownshard/types.ts'
import { drawAutoBattlePill, drawIcon, drawIconButton } from '../examples/crownshard/crownshard/ui-art.ts'

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

function fakeRenderer() {
  let drawn = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
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

function fakeCanvas2dContext() {
  let ops = 0
  const texts: string[] = []
  const grad = { addColorStop() {} }
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    save() { ops++ },
    restore() { ops++ },
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    ellipse() {},
    rect() {},
    clip() {},
    fill() { ops++ },
    stroke() { ops++ },
    fillRect() { ops++ },
    strokeRect() {},
    fillText(text: string) {
      ops++
      texts.push(String(text))
    },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.2 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

// ===========================================================================
// 1. 1x / 2x Battle Speed Pacing & Deterministic Combat Parity
// ===========================================================================

test('Battle speed helpers normalize, toggle, format, and scale dt cleanly', () => {
  assert.equal(DEFAULT_BATTLE_SPEED, 1)
  assert.equal(normalizeBattleSpeed(1), 1)
  assert.equal(normalizeBattleSpeed(2), 2)
  assert.equal(normalizeBattleSpeed(3), 1)
  assert.equal(normalizeBattleSpeed(null), 1)
  assert.equal(normalizeBattleSpeed('2'), 1)

  assert.equal(nextBattleSpeed(1), 2)
  assert.equal(nextBattleSpeed(2), 1)
  assert.equal(formatBattleSpeedLabel(1), '1x')
  assert.equal(formatBattleSpeedLabel(2), '2x')

  assert.equal(scaleBattleDt(0.016, 1), 0.016)
  assert.equal(scaleBattleDt(0.016, 2), 0.032)
  assert.equal(scaleBattleDt(-0.5, 2), 0)
  assert.equal(scaleBattleDt(Number.NaN, 2), 0)

  const state = createInitialState(1001)
  assert.equal(state.campaign.battleSpeed, 1)
  assert.equal(toggleBattleSpeed(state), 2)
  assert.equal(state.campaign.battleSpeed, 2)

  const battle = startChapterBattle(state, 0)
  assert.equal(battle.battleSpeed, 2, 'New battle inherits campaign battleSpeed preference')
  assert.equal(setBattleSpeed(state, 1), 1)
  assert.equal(battle.battleSpeed, 1)
  assert.equal(state.campaign.battleSpeed, 1)
})

test('2x battle speed accelerates unit walk, timers, floating numbers, and enemy think delays by ~2x without changing combat outcomes', () => {
  const runAtSpeed = (speed: 1 | 2) => {
    const state = createInitialState(92601)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    setBattleSpeed(state, speed)

    const active = getUnitByUid(battle, battle.activeUnitUid)!
    placeUnit(battle, active, 1, 2)
    const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
    placeUnit(battle, enemy, 5, 2)
    // Park other units safely out of the way
    let parkRow = battle.rows - 1
    for (const u of battle.units) {
      if (u.uid === active.uid || u.uid === enemy.uid) continue
      if (u.team === 'ally') placeUnit(battle, u, 0, Math.max(0, parkRow--))
      else placeUnit(battle, u, battle.cols - 1, Math.max(0, parkRow--))
    }
    refreshHighlights(battle, state.campaign)

    // Walk 3 tiles east to (4, 2)
    assert.equal(selectTile(state, 4, 2), true)
    battle.floatingNumbers.push({
      id: 99, x: 0, y: 1, z: 0, text: 'TEST', color: '#fff', age: 0, duration: 0.6
    })
    battle.bannerTimer = 1.0
    active.hitFlash = 0.4

    let walkSteps = 0
    while (active.path.length > 0 && walkSteps < 200) {
      stepGame(state, STEP)
      walkSteps++
    }
    assert.equal(active.col, 4)
    assert.equal(active.row, 2)
    const bannerAfterWalk = battle.bannerTimer
    const floatCountAfterWalk = battle.floatingNumbers.length

    // Strike the adjacent enemy at (5, 2) and end turn so enemy executes its turn
    assert.equal(selectTile(state, 5, 2), true)
    const animTimerStart = active.animTimer
    assert.ok(animTimerStart > 0)

    let animSteps = 0
    while (active.animTimer > 0 && animSteps < 120) {
      stepGame(state, STEP)
      animSteps++
    }

    endPlayerTurn(state)
    let enemyPhaseSteps = 0
    while (battle.phase === 'enemy' && enemyPhaseSteps < 400) {
      stepGame(state, STEP)
      enemyPhaseSteps++
    }

    return {
      walkSteps,
      animSteps,
      enemyPhaseSteps,
      bannerAfterWalk,
      floatCountAfterWalk,
      seed: state.campaign.seed,
      turn: battle.turn,
      phase: battle.phase,
      units: battle.units.map(u => ({
        uid: u.uid, col: u.col, row: u.row, hp: u.hp, shield: u.shield, alive: u.alive, ct: u.ct, facing: u.facing
      }))
    }
  }

  const r1 = runAtSpeed(1)
  const r2 = runAtSpeed(2)

  // Timing speedup: ~2x fewer fixed steps for movement, attack animation, and enemy turns
  assert.ok(r2.walkSteps < r1.walkSteps * 0.6, `Expected 2x walk (${r2.walkSteps}) much faster than 1x (${r1.walkSteps})`)
  assert.ok(r2.animSteps < r1.animSteps * 0.6, `Expected 2x anim (${r2.animSteps}) much faster than 1x (${r1.animSteps})`)
  assert.ok(r2.enemyPhaseSteps <= Math.ceil(r1.enemyPhaseSteps * 0.6), `Expected 2x enemy turn (${r2.enemyPhaseSteps}) faster than 1x (${r1.enemyPhaseSteps})`)

  // Deterministic gameplay parity: exact same combat outcome, HP, positions, CT, facing, and RNG seed!
  assert.equal(r2.seed, r1.seed, 'RNG seed must be identical between 1x and 2x speed')
  assert.equal(r2.turn, r1.turn, 'Turn counter must be identical between 1x and 2x speed')
  assert.equal(r2.phase, r1.phase, 'Battle phase must be identical between 1x and 2x speed')
  assert.deepEqual(r2.units, r1.units, 'All unit states must be 100% identical between 1x and 2x speed')
})

// ===========================================================================
// 2. Tactical Auto-Battle Planner Tests
// ===========================================================================

test('Auto-Battle defaults to false and cannot be enabled during deploy, victory, or defeat', () => {
  const state = createInitialState(92602)
  const battle = startChapterBattle(state, 0, 0, { deployPhase: true })
  assert.equal(battle.phase, 'deploy')
  assert.equal(battle.autoBattle, false)
  assert.equal(setAutoBattle(state, true), false, 'Auto-battle must stay disabled during deploy phase')
  assert.equal(battle.autoBattle, false)

  const normalBattle = startChapterBattle(state, 0)
  assert.equal(normalBattle.phase, 'player')
  assert.equal(normalBattle.autoBattle, false, 'Auto-battle must default to false on battle start')
  assert.equal(toggleAutoBattle(state), true)
  assert.equal(normalBattle.autoBattle, true)
  assert.equal(normalBattle.autoBattleDelay, AUTO_BATTLE_THINK_DELAY)
  assert.equal(toggleAutoBattle(state), false)
  assert.equal(normalBattle.autoBattle, false)
})

test('planAutoBattleAction respects enemy Taunt, ZoC lethal OA avoidance, active lava geysers, High Ground, and Backstab arcs', () => {
  // A) Enemy Taunt priority
  {
    const state = createInitialState(92603)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    battle.hand = []

    const active = getUnitByUid(battle, battle.activeUnitUid)!
    active.range = 3
    placeUnit(battle, active, 2, 2)
    const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
    const weakEnemy = enemies[0]
    const taunter = enemies[1]
    weakEnemy.hp = 5
    weakEnemy.tauntTurns = 0
    placeUnit(battle, weakEnemy, 3, 2)
    taunter.hp = 60
    taunter.tauntTurns = 2
    placeUnit(battle, taunter, 4, 2)
    for (let i = 2; i < enemies.length; i++) enemies[i].alive = false
    refreshHighlights(battle, state.campaign)

    const plan = planAutoBattleAction(state)
    assert.ok(plan)
    assert.equal(plan.targetCol, taunter.col, 'Auto-battle must target the taunting enemy')
    assert.equal(plan.targetRow, taunter.row)
  }

  // B) Lethal ZoC OA avoidance & active lava geyser avoidance
  {
    const state = createInitialState(92604)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    battle.hand = []

    const active = getUnitByUid(battle, battle.activeUnitUid)!
    active.hp = 5 // Low HP so leaving a ZoC sentinel is lethal
    active.shield = 0
    active.range = 3
    placeUnit(battle, active, 2, 2)

    const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
    const sentinel = enemies[0]
    sentinel.range = 1
    sentinel.atk = 30
    placeUnit(battle, sentinel, 2, 3) // Adjacent sentinel projects ZoC onto (2,2)!
    for (let i = 1; i < enemies.length; i++) enemies[i].alive = false

    // Place an active lava geyser on (1,2)
    battle.cells[2][1] = { ...makeCell(1, 2, 'lava_geyser', 0), geyserActive: true }
    refreshHighlights(battle, state.campaign)

    const plan = planAutoBattleAction(state)
    assert.ok(plan)
    assert.ok(plan.kind === 'attack' || plan.kind === 'skill', `Should strike from safe current tile rather than dying to OA (got ${plan.kind})`)
    assert.equal(plan.moveTo, undefined, 'Must not move away and die to lethal OA')
  }

  // C) High Ground + Backstab preference
  {
    const state = createInitialState(92605)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    battle.hand = []

    const active = getUnitByUid(battle, battle.activeUnitUid)!
    active.range = 1
    active.move = 4
    active.cooldowns = [2, 2, 2]
    placeUnit(battle, active, 4, 0)
    const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
    const target = enemies[0]
    target.hp = 80
    target.range = 2 // Non-ZoC archer so moving around rear is clean
    placeUnit(battle, target, 4, 2)
    setUnitFacing(target, 'w') // Facing west -> east tile (5,2) is BACKSTAB!
    battle.cells[2][5] = makeCell(5, 2, 'hill', 1) // High ground + backstab on (5,2) in 3 steps: (5,0)->(5,1)->(5,2)!
    for (let i = 1; i < enemies.length; i++) enemies[i].alive = false
    let allyParkRow = battle.rows - 1
    for (const u of battle.units) {
      if (u.team === 'ally' && u.uid !== active.uid) placeUnit(battle, u, 0, Math.max(0, allyParkRow--))
    }
    refreshHighlights(battle, state.campaign)

    const plan = planAutoBattleAction(state)
    assert.ok(plan)
    assert.equal(plan.kind, 'move_and_attack')
    assert.deepEqual(plan.moveTo, { col: 5, row: 2 }, 'Auto-battle should prefer High Ground + Backstab tile')
  }
})

test('planAutoBattleAction uses Cleric heal & revive skills on wounded/downed allies and plays offensive skills off-cooldown', () => {
  const state = createInitialState(92606)
  // Add a Cleric to squad
  const clericUid = `hero_cleric_test`
  state.campaign.heroes.push({
    uid: clericUid,
    heroId: 'cleric',
    stars: 2,
    level: 3,
    xp: 0,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  })
  state.campaign.squadUids = [clericUid, state.campaign.heroes[0].uid, state.campaign.heroes[1].uid]
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)
  battle.hand = []

  const cleric = battle.units.find(u => u.heroId === 'cleric')!
  const knight = battle.units.find(u => u.heroId === 'knight')!
  const enemy = battle.units.find(u => u.team === 'enemy')!

  // Force Cleric to be active hero
  battle.phase = 'player'
  battle.activeUnitUid = cleric.uid
  cleric.moved = false
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  placeUnit(battle, cleric, 2, 2)
  placeUnit(battle, knight, 3, 2)
  placeUnit(battle, enemy, 5, 2)

  // 1) Downed ally -> Cleric MUST revive with Sunbeam Mend (skill 0) or Sanctuary Wave (skill 1)
  knight.alive = false
  knight.hp = 0
  knight.downed = true
  knight.koCountdown = 2
  refreshHighlights(battle, state.campaign)

  const revivePlan = planAutoBattleAction(state)
  assert.ok(revivePlan)
  assert.ok(revivePlan.kind === 'skill' || revivePlan.kind === 'move_and_skill')
  assert.ok(revivePlan.skillIndex === 0 || revivePlan.skillIndex === 1, 'Cleric should cast a revive skill')
  assert.equal(setAutoBattle(state, true), true)
  assert.equal(executeAutoBattleStep(state), true)
  assert.equal(knight.alive, true, 'Knight should be revived by Auto-Battle Cleric!')
  assert.equal(isUnitDowned(knight), false)

  // 2) Wounded ally -> Cleric heals wounded ally with Sunbeam Mend
  cleric.acted = false
  cleric.moved = false
  cleric.cooldowns = [0, 3, 3]
  knight.hp = Math.max(1, Math.floor(knight.maxHp * 0.25))
  refreshHighlights(battle, state.campaign)

  const healPlan = planAutoBattleAction(state)
  assert.ok(healPlan)
  assert.equal(healPlan.kind, 'skill')
  assert.equal(healPlan.skillIndex, 0)
  assert.equal(healPlan.targetCol, knight.col)
  assert.equal(healPlan.targetRow, knight.row)

  // 3) Offensive hero off-cooldown skill vs basic attack
  const archer = battle.units.find(u => u.heroId === 'archer')!
  battle.activeUnitUid = archer.uid
  archer.moved = false
  archer.acted = false
  archer.cooldowns = [0, 0, 0]
  placeUnit(battle, archer, 2, 4)
  placeUnit(battle, enemy, 5, 4)
  enemy.hp = 90
  refreshHighlights(battle, state.campaign)

  const skillPlan = planAutoBattleAction(state)
  assert.ok(skillPlan)
  assert.ok(skillPlan.kind === 'skill' || skillPlan.kind === 'move_and_skill', 'Archer should use Piercing Shot off-cooldown')
  assert.equal(skillPlan.skillIndex, 0)
})

test('planAutoBattleAction plays mission objectives (seize chests/goal, assassinate boss, defend protectTile) and chooses optimal turn-end facing', () => {
  // 1) Seize objective: claims required chest, then seizes goal tile for immediate victory!
  {
    const state = createInitialState(92607)
    const battle = startStageBattle(state, 'solis_crossing')
    // Configure explicit seize objective with 1 chest + 1 goal tile
    flattenArena(battle, 'grass', 0)
    battle.hand = []
    const active = getUnitByUid(battle, battle.activeUnitUid)!
    placeUnit(battle, active, 1, 2)
    let enemyParkRow = battle.rows - 1
    for (const u of battle.units) {
      if (u.team === 'enemy') placeUnit(battle, u, battle.cols - 1, Math.max(0, enemyParkRow--))
    }
    const obj = battle.objective as unknown as {
      kind: 'seize'
      chestTiles: readonly { col: number; row: number }[]
      claimedChests: { col: number; row: number }[]
      requiredChests: number
      goalTile?: { col: number; row: number }
      seized: boolean
    }
    obj.kind = 'seize'
    obj.chestTiles = [{ col: 3, row: 2 }]
    obj.claimedChests = []
    obj.requiredChests = 1
    obj.goalTile = { col: 4, row: 2 }
    obj.seized = false
    refreshHighlights(battle, state.campaign)

    // Step 1: Must move onto the required chest tile (either pure move or move+attack/skill from the chest!)
    const chestPlan = planAutoBattleAction(state)
    assert.ok(chestPlan)
    assert.ok(
      chestPlan.kind === 'move' || chestPlan.kind === 'move_and_attack' || chestPlan.kind === 'move_and_skill',
      `Expected move onto chest tile (got ${chestPlan.kind})`
    )
    assert.deepEqual(chestPlan.moveTo, { col: 3, row: 2 }, 'Auto-battle must claim required chest before seizing goal')

    // Simulate chest claimed; now goal tile at (4,2) is reachable -> instant seize victory!
    obj.claimedChests = [{ col: 3, row: 2 }]
    placeUnit(battle, active, 3, 2)
    active.moved = false
    const goalPlan = planAutoBattleAction(state)
    assert.ok(goalPlan)
    assert.equal(goalPlan.kind, 'move')
    assert.deepEqual(goalPlan.moveTo, { col: 4, row: 2 }, 'Auto-battle must seize goal tile for immediate victory')
  }

  // 2) Assassinate objective prioritizes the designated target enemy
  {
    const state = createInitialState(92613)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    battle.hand = []
    const active = getUnitByUid(battle, battle.activeUnitUid)!
    active.range = 3
    active.cooldowns = [2, 2, 2]
    placeUnit(battle, active, 2, 2)
    const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
    const decoy = enemies[0]
    const target = enemies[1]
    decoy.hp = 40
    target.hp = 40
    placeUnit(battle, decoy, 4, 2)
    placeUnit(battle, target, 4, 3)
    for (let i = 2; i < enemies.length; i++) enemies[i].alive = false
    const obj = battle.objective as unknown as { kind: 'assassinate'; targetEnemyUid?: string }
    obj.kind = 'assassinate'
    obj.targetEnemyUid = target.uid
    refreshHighlights(battle, state.campaign)

    const plan = planAutoBattleAction(state)
    assert.ok(plan)
    assert.equal(plan.targetCol, target.col, 'Auto-battle must focus the Assassinate target enemy')
    assert.equal(plan.targetRow, target.row)
  }

  // 3) Defend objective prioritizes enemies threatening the protectTile
  {
    const state = createInitialState(92614)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    battle.hand = []
    const active = getUnitByUid(battle, battle.activeUnitUid)!
    active.range = 3
    active.cooldowns = [2, 2, 2]
    placeUnit(battle, active, 3, 2)
    const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
    const farEnemy = enemies[0]
    const breacher = enemies[1]
    farEnemy.hp = 40
    breacher.hp = 40
    placeUnit(battle, farEnemy, 5, 2)
    placeUnit(battle, breacher, 1, 2) // Right next to protectTile (0, 2)!
    for (let i = 2; i < enemies.length; i++) enemies[i].alive = false
    const obj = battle.objective as unknown as { kind: 'defend'; protectTile?: { col: number; row: number } }
    obj.kind = 'defend'
    obj.protectTile = { col: 0, row: 2 }
    refreshHighlights(battle, state.campaign)

    const plan = planAutoBattleAction(state)
    assert.ok(plan)
    assert.equal(plan.targetCol, breacher.col, 'Auto-battle must focus enemy threatening the Defend tile')
    assert.equal(plan.targetRow, breacher.row)
  }

  // 4) Turn-end facing faces the nearest / highest-threat enemy
  {
    const state = createInitialState(92608)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    battle.hand = []
    const active = getUnitByUid(battle, battle.activeUnitUid)!
    placeUnit(battle, active, 3, 3)
    setUnitFacing(active, 'w') // Facing away from north threat
    active.moved = true
    active.acted = true

    const enemy = battle.units.find(u => u.team === 'enemy')!
    placeUnit(battle, enemy, 3, 1) // Directly North!
    for (const u of battle.units) {
      if (u.team === 'enemy' && u.uid !== enemy.uid) u.alive = false
    }

    const plan = planAutoBattleAction(state)
    assert.ok(plan)
    assert.equal(plan.kind, 'end_turn')
    assert.equal(plan.facing, 'n')
    assert.equal(chooseBestTurnEndFacing(battle, active), 'n')
  }
})

// ===========================================================================
// 3. Full Auto-Battle Run to Victory (Deterministic)
// ===========================================================================

test('Auto-Battle plays a full Chapter 1 battle deterministically to victory and stops cleanly on victory', () => {
  const runFullAutoBattle = (seed: number, speed: 1 | 2) => {
    const state = createInitialState(seed)
    const battle = startChapterBattle(state, 0)
    setBattleSpeed(state, speed)
    assert.equal(setAutoBattle(state, true), true)

    let steps = 0
    const maxSteps = 20000
    while (battle.phase !== 'victory' && battle.phase !== 'defeat' && steps < maxSteps) {
      stepGame(state, STEP)
      steps++
    }
    return {
      phase: battle.phase,
      autoBattleAtEnd: battle.autoBattle,
      turn: battle.turn,
      steps,
      seed: state.campaign.seed,
      battlesWon: state.campaign.battlesWon,
      survivingAllies: battle.units.filter(u => u.team === 'ally' && u.alive).map(u => ({ uid: u.uid, hp: u.hp, col: u.col, row: u.row }))
    }
  }

  const runA = runFullAutoBattle(2026, 2)
  const runB = runFullAutoBattle(2026, 2)
  const run1x = runFullAutoBattle(2026, 1)

  assert.equal(runA.phase, 'victory', 'Auto-Battle must win Chapter 1 cleanly')
  assert.equal(runA.autoBattleAtEnd, false, 'Auto-Battle must cleanly stop on victory')
  assert.equal(runA.battlesWon, 1)
  assert.ok(runA.survivingAllies.length >= 1)

  // Strict determinism across repeated runs AND 1x vs 2x speed!
  assert.deepEqual(runB, runA, 'Repeated Auto-Battle runs with the same seed must be 100% deterministic')
  assert.equal(run1x.phase, 'victory')
  assert.equal(run1x.turn, runA.turn, '1x and 2x Auto-Battle must finish on the exact same turn')
  assert.equal(run1x.seed, runA.seed, '1x and 2x Auto-Battle must end with the exact same RNG seed')
  assert.deepEqual(run1x.survivingAllies, runA.survivingAllies, '1x and 2x Auto-Battle must yield identical surviving hero states')
  assert.ok(runA.steps < run1x.steps * 0.6, `2x Auto-Battle (${runA.steps} steps) must be ~2x faster than 1x (${run1x.steps} steps)`)
})

// ===========================================================================
// 4. Manual Override Cancels Auto-Battle Cleanly
// ===========================================================================

test('Manual player actions (tile click, skill arm, tactic arm, undo move, wait-facing, rotate, cancel) cleanly turn off Auto-Battle', () => {
  const state = createInitialState(92610)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)
  refreshHighlights(battle, state.campaign)

  // 1. selectTile cancels autoBattle
  assert.equal(setAutoBattle(state, true), true)
  const moveTile = battle.moveTiles[0]
  assert.ok(moveTile)
  assert.equal(selectTile(state, moveTile.col, moveTile.row), true)
  assert.equal(battle.autoBattle, false, 'Manual tile click must cancel Auto-Battle')

  // Finish walk so we can test undoMove
  for (let i = 0; i < 120; i++) stepGame(state, STEP)

  // 2. undoMove cancels autoBattle
  assert.equal(setAutoBattle(state, true), true)
  assert.equal(undoMove(state), true)
  assert.equal(battle.autoBattle, false, 'Manual Undo Move must cancel Auto-Battle')

  // 3. armSkill cancels autoBattle
  assert.equal(setAutoBattle(state, true), true)
  assert.equal(armSkill(state, 0), true)
  assert.equal(battle.autoBattle, false, 'Manual armSkill must cancel Auto-Battle')
  armSkill(state, null)

  // 4. armTacticCard cancels autoBattle
  assert.ok(battle.hand.length > 0)
  battle.ap = 4
  assert.equal(setAutoBattle(state, true), true)
  assert.equal(armTacticCard(state, battle.hand[0]), true)
  assert.equal(battle.autoBattle, false, 'Manual armTacticCard must cancel Auto-Battle')
  armTacticCard(state, null)

  // 5. beginWaitFacingPicker cancels autoBattle
  assert.equal(setAutoBattle(state, true), true)
  assert.equal(beginWaitFacingPicker(state), true)
  assert.equal(battle.autoBattle, false, 'Manual Wait-to-Face must cancel Auto-Battle')

  // 6. rotateActiveUnitFacing cancels autoBattle
  assert.equal(setAutoBattle(state, true), true)
  assert.equal(rotateActiveUnitFacing(state, 'n'), true)
  assert.equal(battle.autoBattle, false, 'Manual rotateActiveUnitFacing must cancel Auto-Battle')

  // 7. cancelAutoBattle (Esc / Pause / Pill click) cancels autoBattle cleanly
  assert.equal(setAutoBattle(state, true), true)
  assert.equal(cancelAutoBattle(state), true)
  assert.equal(battle.autoBattle, false)
  assert.equal(cancelAutoBattle(state), false)
})

// ===========================================================================
// 5. Save / Resume & Legacy Compatibility
// ===========================================================================

test('Battle speed persists cleanly across save/resume while Auto-Battle resets safely and legacy saves remain valid', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(92611)
  const battle = startChapterBattle(state, 0)
  setBattleSpeed(state, 2)
  setAutoBattle(state, true)
  assert.equal(battle.battleSpeed, 2)
  assert.equal(battle.autoBattle, true)

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  assert.equal(loaded.campaign.battleSpeed, 2, 'Campaign battleSpeed=2 must persist in save')
  assert.equal(loaded.activeBattle?.battleSpeed, 2, 'Active battle snapshot must persist battleSpeed=2')

  const resumed = createInitialState(1, loaded)
  assert.ok(resumed.battle)
  assert.equal(resumed.campaign.battleSpeed, 2)
  assert.equal(resumed.battle.battleSpeed, 2)
  assert.equal(resumed.battle.autoBattle, false, 'Auto-Battle must reset safely to false on battle resume')

  // Legacy save without battleSpeed on campaign or activeBattle validates & defaults to 1
  const rawSave = JSON.parse(JSON.stringify(serializeSave(state))) as SaveData
  delete (rawSave.campaign as { battleSpeed?: number }).battleSpeed
  const rawSnap = JSON.parse(JSON.stringify(serializeBattleState(battle, state.campaign.seed))) as Record<string, unknown>
  delete rawSnap.battleSpeed

  const validatedSnap = validateBattleSnapshot(rawSnap)
  assert.ok(validatedSnap, 'Legacy BattleSaveSnapshot omitting battleSpeed must validate cleanly')
  assert.equal(validatedSnap.battleSpeed, undefined)

  const legacyState = createInitialState(777, { ...rawSave, activeBattle: validatedSnap as BattleSaveSnapshot })
  assert.equal(legacyState.campaign.battleSpeed, 1)
  assert.equal(legacyState.battle?.battleSpeed, 1)
  assert.equal(legacyState.battle?.autoBattle, false)

  // Direct restoreBattleState on state with battleSpeed=2 inherits campaign preference when legacy snapshot omits it
  setBattleSpeed(legacyState, 2)
  assert.equal(restoreBattleState(legacyState, validatedSnap), true)
  assert.equal(legacyState.battle?.battleSpeed, 2)
  assert.equal(legacyState.battle?.autoBattle, false)
})

// ===========================================================================
// 6. Scene & UI Draw Smoke (Headless)
// ===========================================================================

test('UI speed/auto icons, toolbar buttons, active Auto-Battle pill, and 2x scene render cleanly without exceptions', () => {
  const { ctx, texts, ops: _ops } = fakeCanvas2dContext()
  const idleSt = { hovered: false, pressed: false, focused: false, selected: false, disabled: false }
  const activeSt = { hovered: true, pressed: false, focused: false, selected: true, disabled: false }

  // New vector icons
  drawIcon(ctx, 'fast-forward', 20, 20, 14, '#ffffff')
  drawIcon(ctx, 'auto', 40, 20, 14, '#9ef7d4')

  // Toolbar buttons (1x, 2x, Auto off, Auto on)
  drawIconButton(ctx, { x: 0, y: 0, width: 56, height: 30 }, 'fast-forward', idleSt, { active: false, label: '1x X' })
  drawIconButton(ctx, { x: 60, y: 0, width: 56, height: 30 }, 'fast-forward', activeSt, { active: true, label: '2x X' })
  drawIconButton(ctx, { x: 120, y: 0, width: 68, height: 30 }, 'auto', idleSt, { active: false, label: 'Auto B' })
  drawIconButton(ctx, { x: 192, y: 0, width: 68, height: 30 }, 'auto', activeSt, { active: true, label: 'Auto ON' })

  // Glowing active Auto-Battle pill (desktop & compact phone)
  drawAutoBattlePill(ctx, { x: 8, y: 88, width: 240, height: 26 }, 2, activeSt, false)
  drawAutoBattlePill(ctx, { x: 8, y: 88, width: 176, height: 24 }, 1, idleSt, true)

  assert.ok(texts.some(t => t.includes('2x')), 'Expected 2x speed label drawn')
  assert.ok(texts.some(t => t.includes('Auto ON')), 'Expected Auto ON button label drawn')
  assert.ok(texts.some(t => t.includes('AUTO-BATTLE 2x')), 'Expected active Auto-Battle pill label drawn')
  assert.ok(texts.some(t => t.includes('AUTO 1x')), 'Expected compact Auto-Battle pill label drawn')

  // Headless 3D scene render smoke at 1x and 2x speed
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)
  const state: GameState = createInitialState(92612)
  startChapterBattle(state, 0)
  setBattleSpeed(state, 1)
  scene.render(state, 1 / 60, 1280, 720)
  setBattleSpeed(state, 2)
  setAutoBattle(state, true)
  stepGame(state, STEP)
  scene.render(state, 1 / 60, 1280, 720)
  assert.equal(fake.drawn, 2, 'Scene should render cleanly at both 1x and 2x speeds')
  scene.dispose()
})
