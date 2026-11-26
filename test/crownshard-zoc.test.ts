import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  canEvadeZoneOfControl, canUndoMove, computeCombatForecast, computeZocPerimeterTiles,
  createInitialState, endPlayerTurn, findGridPath, formatOpportunityWarning, getUnitByUid,
  hasZoneOfControl, previewPathOpportunityAttacks, selectHeroByUid, selectTile,
  startChapterBattle, stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import {
  OPPORTUNITY_ATTACK_DAMAGE_MUL, gridToWorld, terrainElevation, terrainWalkable
} from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, EnemyArchetypeId, GridCell, HeroClassId, TileTerrain } from '../examples/crownshard/crownshard/types.ts'

function makeCell(col: number, row: number, terrain: TileTerrain = 'grass', heightLevel = 0): GridCell {
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

function flattenBoard(battle: Pick<BattleState, 'cols' | 'rows' | 'cells'>) {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, 'grass', 0)
    }
  }
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number) {
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

function fakeRenderer() {
  let lastInstances = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      let n = 0
      for (const b of batches) n += b.count
      lastInstances = n
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get lastInstances() { return lastInstances }
  }
}

test('hasZoneOfControl identifies frontline melee sentinels and excludes ranged, stunned, and downed/dead units', () => {
  const makeHeroStub = (heroId: HeroClassId, range: number, overrides: Partial<BattleUnit> = {}) => ({
    alive: true,
    stunTurns: 0,
    heroId,
    enemyId: undefined,
    range,
    ...overrides
  })
  const makeEnemyStub = (enemyId: EnemyArchetypeId, range: number, overrides: Partial<BattleUnit> = {}) => ({
    alive: true,
    stunTurns: 0,
    heroId: undefined,
    enemyId,
    range,
    ...overrides
  })

  // Frontline / sentinel heroes project ZoC (including Champion with range 2!)
  assert.equal(hasZoneOfControl(makeHeroStub('knight', 1)), true)
  assert.equal(hasZoneOfControl(makeHeroStub('paladin', 1)), true)
  assert.equal(hasZoneOfControl(makeHeroStub('champion', 2)), true)
  assert.equal(hasZoneOfControl(makeHeroStub('rogue', 1)), true)

  // Ranged heroes do NOT project ZoC
  assert.equal(hasZoneOfControl(makeHeroStub('archer', 3)), false)
  assert.equal(hasZoneOfControl(makeHeroStub('mage', 3)), false)
  assert.equal(hasZoneOfControl(makeHeroStub('cleric', 3)), false)
  assert.equal(hasZoneOfControl(makeHeroStub('cryomancer', 3)), false)

  // Frontline / sentinel enemies project ZoC (including Eclipse Archon boss!)
  assert.equal(hasZoneOfControl(makeEnemyStub('goblin', 1)), true)
  assert.equal(hasZoneOfControl(makeEnemyStub('orc_brute', 1)), true)
  assert.equal(hasZoneOfControl(makeEnemyStub('crypt_knight', 1)), true)
  assert.equal(hasZoneOfControl(makeEnemyStub('frost_golem', 1)), true)
  assert.equal(hasZoneOfControl(makeEnemyStub('eclipse_archon', 3)), true)

  // Ranged / support enemies do NOT project ZoC
  assert.equal(hasZoneOfControl(makeEnemyStub('bone_archer', 3)), false)
  assert.equal(hasZoneOfControl(makeEnemyStub('bog_shaman', 3)), false)

  // Stunned and downed/dead sentinels lose ZoC immediately
  assert.equal(hasZoneOfControl(makeHeroStub('knight', 1, { stunTurns: 1 })), false)
  assert.equal(hasZoneOfControl(makeHeroStub('paladin', 1, { alive: false })), false)
  assert.equal(hasZoneOfControl(makeEnemyStub('orc_brute', 1, { stunTurns: 2 })), false)
  assert.equal(hasZoneOfControl(makeEnemyStub('crypt_knight', 1, { alive: false })), false)

  // Nimble skirmisher trait: Rogue evades ZoC, Knight/Archer do not
  assert.equal(canEvadeZoneOfControl({ heroId: 'rogue', enemyId: undefined }), true)
  assert.equal(canEvadeZoneOfControl({ heroId: 'knight', enemyId: undefined }), false)
  assert.equal(canEvadeZoneOfControl({ heroId: 'archer', enemyId: undefined }), false)
  assert.equal(canEvadeZoneOfControl({ heroId: undefined, enemyId: 'goblin' }), false)
})

test('previewPathOpportunityAttacks detects leaving/skirting ZoC, ignores entry/clear paths, and caps 1 OA per sentinel', () => {
  const state = createInitialState(9001)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const goblin = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'goblin')!
  const boneArcher = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'bone_archer')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== goblin.uid && u.uid !== boneArcher.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  knight.hp = 70
  knight.maxHp = 70
  knight.shield = 0
  knight.move = 4
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, goblin, 3, 1) // ZoC covers (2,1), (4,1), (3,0), (3,2)
  placeUnit(battle, boneArcher, 1, 1) // Ranged unit: NO ZoC!

  // 1. Staying clear of melee sentinel (and even leaving ranged Bone Archer's adjacency!) -> 0 triggers
  const clearPreview = previewPathOpportunityAttacks(battle, knight, [{ col: 1, row: 3 }, { col: 1, row: 4 }])
  assert.equal(clearPreview.triggers.length, 0, 'Leaving ranged enemy adjacency must NOT trigger OA')

  // 2. Entering Goblin's ZoC at (2, 1) and stopping there -> 0 triggers
  const enterOnly = previewPathOpportunityAttacks(battle, knight, [{ col: 2, row: 2 }, { col: 2, row: 1 }])
  assert.equal(enterOnly.triggers.length, 0, 'Entering ZoC without leaving must NOT trigger OA')

  // 3. Skirting past Goblin via (2,2) -> (3,2) -> (4,2) leaves (3,2) which is adjacent to Goblin at (3,1) -> 1 OA at stepIndex 2!
  const skirtPath = [{ col: 2, row: 2 }, { col: 3, row: 2 }, { col: 4, row: 2 }]
  const skirtPreview = previewPathOpportunityAttacks(battle, knight, skirtPath)
  assert.equal(skirtPreview.triggers.length, 1)
  assert.equal(skirtPreview.triggers[0].stepIndex, 2)
  assert.equal(skirtPreview.triggers[0].fromCol, 3)
  assert.equal(skirtPreview.triggers[0].fromRow, 2)
  assert.equal(skirtPreview.triggers[0].attackerUid, goblin.uid)
  assert.ok(skirtPreview.triggers[0].projectedDamage >= 4)
  assert.equal(skirtPreview.totalDamage, skirtPreview.triggers[0].projectedDamage)
  assert.ok(formatOpportunityWarning(skirtPreview).includes('OPPORTUNITY ATTACK'))

  // 4. Re-entering and leaving same sentinel's ZoC in one movement action still caps at 1 OA per sentinel
  const zigzagPath = [{ col: 2, row: 2 }, { col: 3, row: 2 }, { col: 4, row: 2 }, { col: 4, row: 1 }, { col: 5, row: 1 }]
  const zigzagPreview = previewPathOpportunityAttacks(battle, knight, zigzagPath)
  assert.equal(zigzagPreview.triggers.length, 1, 'Each sentinel triggers at most 1 OA per movement action')

  // 5. Stunning the Goblin suppresses its ZoC
  goblin.stunTurns = 1
  assert.equal(previewPathOpportunityAttacks(battle, knight, skirtPath).triggers.length, 0)
  goblin.stunTurns = 0

  // 6. computeZocPerimeterTiles includes Goblin's orthogonal neighbors and excludes Bone Archer's
  const enemyZoc = computeZocPerimeterTiles(battle, 'enemy')
  assert.equal(enemyZoc.some(t => t.col === 3 && t.row === 2), true)
  assert.equal(enemyZoc.some(t => t.col === 0 && t.row === 1), false, 'Bone Archer must not project ZoC perimeter')
})

test('Leaving enemy ZoC triggers Opportunity Attack (exact damage, VFX, float, locks Undo Move) and works symmetrically for ally ZoC', () => {
  const state = createInitialState(9002)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const goblin = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'goblin')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== goblin.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  // Activate Knight's turn directly next to Goblin
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.hp = 70
  knight.maxHp = 70
  knight.shield = 0
  knight.moved = false
  knight.acted = false
  goblin.hp = 60
  goblin.maxHp = 60
  goblin.atk = 20
  goblin.shield = 0
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  selectHeroByUid(state, knight.uid)

  // Preview disengaging west from (2,2) -> (1,2)
  const disengagePath = findGridPath(battle, knight, 1, 2)
  const preview = previewPathOpportunityAttacks(battle, knight, disengagePath)
  assert.equal(preview.triggers.length, 1)
  assert.ok(preview.totalHpLoss >= 4)

  const hpBefore = knight.hp
  state.vfx = []
  state.sounds = []
  assert.equal(selectTile(state, 1, 2), true)
  for (let i = 0; i < 60; i++) stepGame(state, STEP)

  assert.equal(knight.col, 1)
  assert.equal(knight.row, 2)
  assert.equal(hpBefore - knight.hp, preview.totalHpLoss, 'Executed OA damage must match previewed OA damage')
  assert.equal(canUndoMove(battle), false, 'Triggering an Opportunity Attack must lock out Undo Move')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'OPPORTUNITY!'), 'Must emit OPPORTUNITY! floating text')
  assert.ok(state.vfx.some(ev => ev.kind === 'burst' && ev.style === 'slash' && ev.uid === goblin.uid), 'Must emit slash burst VFX')
  assert.ok(state.sounds.some(ev => ev.kind === 'slash'), 'Must emit slash sound')

  // Symmetrical check: Goblin moves away from Knight's ZoC and takes Knight's Opportunity Attack!
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  const goblinHpBefore = goblin.hp
  const knightOaPreview = previewPathOpportunityAttacks(battle, goblin, [{ col: 4, row: 2 }])
  assert.equal(knightOaPreview.triggers.length, 1)
  assert.equal(knightOaPreview.triggers[0].attackerUid, knight.uid)

  battle.phase = 'enemy'
  battle.activeUnitUid = goblin.uid
  battle.enemyActedThisTurn = true
  battle.enemyDelay = 5
  battle.oaTriggeredUids = []
  goblin.path = [{ col: 4, row: 2 }]
  goblin.moveProgress = 0
  battle.floatingNumbers = []
  state.vfx = []

  for (let i = 0; i < 60; i++) stepGame(state, STEP)

  assert.equal(goblin.col, 4)
  assert.equal(goblin.row, 2)
  assert.equal(goblinHpBefore - goblin.hp, knightOaPreview.totalHpLoss, 'Ally Knight must trigger symmetric OA on departing enemy')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'OPPORTUNITY!'))
  assert.ok(state.vfx.some(ev => ev.kind === 'burst' && ev.style === 'slash' && ev.uid === knight.uid))
  assert.equal(Math.round(knight.atk * OPPORTUNITY_ATTACK_DAMAGE_MUL) > 0, true)
})

test('Lethal Opportunity Attack downs active hero, halts movement, and cleanly advances turn without soft-locking', () => {
  const state = createInitialState(9003)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const goblin = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'goblin')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== archer.uid && u.uid !== goblin.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.hp = 4
  knight.shield = 0
  knight.moved = false
  knight.acted = false
  archer.hp = 50
  archer.ct = 95
  goblin.atk = 30
  goblin.ct = 20

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  placeUnit(battle, archer, 0, 0)
  selectHeroByUid(state, knight.uid)

  const preview = previewPathOpportunityAttacks(battle, knight, [{ col: 1, row: 2 }, { col: 0, row: 2 }])
  assert.equal(preview.lethal, true, 'Preview must flag lethal OA')

  // Confirm disengage move — Goblin's OA downs Knight immediately
  assert.equal(selectTile(state, 0, 2), true)
  for (let i = 0; i < 12; i++) stepGame(state, STEP)

  assert.equal(knight.alive, false, 'Lethal OA must down the moving hero')
  assert.equal(knight.downed, true, 'Downed hero enters FFT KO countdown state')
  assert.ok(knight.koCountdown > 0)
  assert.equal(knight.path.length, 0, 'Movement path must halt immediately on lethal OA')
  assert.equal(battle.phase === 'player' || battle.phase === 'enemy', true, 'Battle remains active with Archer alive')
  assert.notEqual(battle.activeUnitUid, knight.uid, 'Turn must cleanly advance past the downed active hero without soft-locking')
  assert.equal(battle.pendingAction, null)
  assert.equal(battle.moveUndo, null)
})

test('Enemy AI avoids unnecessary ally Opportunity Attacks when a safe path or tile exists', () => {
  const state = createInitialState(9004)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const goblin = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'goblin')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== archer.uid && u.uid !== goblin.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  // Place Goblin at (4, 2) with Knight sentinel guarding at (3, 1) and Archer at (2, 2):
  // Moving via (3, 2) -> (2, 2) is blocked/provokes Knight's ZoC, whereas moving south/safe avoids OA!
  knight.hp = 80
  knight.atk = 28
  archer.hp = 50
  goblin.hp = 40
  goblin.move = 3
  goblin.ct = 110
  knight.ct = 0
  archer.ct = 0
  placeUnit(battle, knight, 3, 1)
  placeUnit(battle, archer, 1, 2)
  placeUnit(battle, goblin, 4, 2)

  // Put Knight's turn first then end it so Goblin takes a full AI turn
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  endPlayerTurn(state)
  assert.equal(battle.phase, 'enemy')
  assert.equal(battle.activeUnitUid, goblin.uid)

  const goblinHpStart = goblin.hp
  let guard = 0
  while (battle.phase === 'enemy' && guard++ < 220) {
    stepGame(state, STEP)
  }

  assert.equal(goblin.hp, goblinHpStart, 'Goblin AI should choose a route/tile that avoids taking an unnecessary Knight OA')
  assert.equal(battle.floatingNumbers.some(fn => fn.text === 'OPPORTUNITY!'), false)
})

test('CrownshardScene renders ZoC perimeter & move-path OA telegraphs without throwing', () => {
  const state = createInitialState(9005)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const goblin = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'goblin')!
  const boneArcher = battle.units.find(u => u.team === 'enemy' && u.enemyId === 'bone_archer')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== goblin.uid && u.uid !== boneArcher.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.moved = false
  knight.acted = false
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2) // Adjacent sentinel!
  placeUnit(battle, boneArcher, 1, 2) // Adjacent target for Move+Attack test from afar
  selectHeroByUid(state, knight.uid)

  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  // Baseline render without hover
  scene.setHoveredCell(null)
  scene.render(state, 1 / 60, 1280, 720)
  const baselineInstances = fake.lastInstances

  // Hovering blue move tile (1, 3) provokes Goblin's OA when leaving (2, 2) -> renders warning markers & arc!
  scene.setHoveredCell({ col: 1, row: 3 })
  scene.render(state, 1 / 60, 1280, 720)
  const oaHoverInstances = fake.lastInstances
  assert.ok(oaHoverInstances > baselineInstances, 'Hovering OA-provoking move tile should add telegraph overlay instances')

  // Also verify Move+Attack forecast with OA triggers renders cleanly
  placeUnit(battle, boneArcher, 0, 2)
  selectHeroByUid(state, knight.uid)
  const fc = computeCombatForecast(state, 0, 2)
  assert.ok(fc && fc.requiresMove, 'Expected Move+Attack forecast onto Bone Archer')
  assert.ok(fc.opportunityAttacks && fc.opportunityAttacks.triggers.length > 0, 'Move+Attack forecast must include OA preview')
  scene.setForecast(fc)
  scene.render(state, 1 / 60, 1280, 720)
  assert.ok(fake.lastInstances > baselineInstances)
})
