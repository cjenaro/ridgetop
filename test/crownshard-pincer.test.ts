import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { computePincerAssistDamage, findPincerAssisters, isPincerMeleeSkill } from '../examples/crownshard/crownshard/pincer.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill, computeCombatForecast, createInitialState, endPlayerTurn,
  getHeroSkill, getUnitByUid, refreshHighlights, selectTile, startChapterBattle, stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld, terrainElevation, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, GameState, GridCell, TileTerrain } from '../examples/crownshard/crownshard/types.ts'
import { drawCombatForecast } from '../examples/crownshard/crownshard/ui-art.ts'

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

function makeActiveHero(battle: BattleState, hero: BattleUnit): void {
  battle.phase = 'player'
  battle.activeUnitUid = hero.uid
  battle.selectedUnitUid = hero.uid
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  hero.alive = true
  hero.downed = false
  hero.moved = false
  hero.acted = false
  hero.stunTurns = 0
}

function fakeRenderer() {
  let drawn = 0
  let lastInstances = 0
  let maxInstances = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      drawn++
      let total = 0
      for (const b of batches) total += b.count
      lastInstances = total
      maxInstances = Math.max(maxInstances, total)
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get drawn() { return drawn },
    get lastInstances() { return lastInstances },
    get maxInstances() { return maxInstances }
  }
}

function makeMockCanvasContext() {
  const texts: string[] = []
  let ops = 0
  const grad = { addColorStop() {} }
  const ctx = {
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
    fillText(text: string) { ops++; texts.push(text) },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

test('findPincerAssisters detects opposite E/W and N/S flanks and rejects L-shape, stunned, downed, cliff-blocked, and ranged attacks', () => {
  const state = createInitialState(9001)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const allies = battle.units.filter(u => u.team === 'ally')
  const enemies = battle.units.filter(u => u.team === 'enemy')
  assert.ok(allies.length >= 3 && enemies.length >= 2)

  const [knight, allyB, allyC] = allies
  const [enemyA, enemyB, ...restEnemies] = enemies
  for (const e of restEnemies) { e.alive = false; e.hp = 0 }

  // Park unused units far away
  placeUnit(battle, allyC, 0, 0)
  placeUnit(battle, enemyB, battle.cols - 1, battle.rows - 1)

  // 1. Horizontal E/W opposite flank: knight(2,2) -> enemyA(3,2) <- allyB(4,2)
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemyA, 3, 2)
  placeUnit(battle, allyB, 4, 2)
  const ew = findPincerAssisters(battle, knight, knight.col, knight.row, enemyA)
  assert.equal(ew.length, 1, 'Horizontal E/W opposite ally must qualify')
  assert.equal(ew[0].uid, allyB.uid)

  // Reverse E/W: allyB(4,2) -> enemyA(3,2) <- knight(2,2)
  const we = findPincerAssisters(battle, allyB, allyB.col, allyB.row, enemyA)
  assert.equal(we.length, 1, 'Reverse E/W opposite ally must qualify')
  assert.equal(we[0].uid, knight.uid)

  // 2. Vertical N/S opposite flank: knight(3,1) -> enemyA(3,2) <- allyB(3,3)
  placeUnit(battle, knight, 3, 1)
  placeUnit(battle, allyB, 3, 3)
  const ns = findPincerAssisters(battle, knight, knight.col, knight.row, enemyA)
  assert.equal(ns.length, 1, 'Vertical N/S opposite ally must qualify')
  assert.equal(ns[0].uid, allyB.uid)

  // 3. Non-opposite adjacent ally (90° L-shape): knight(3,1) -> enemyA(3,2), allyB at (4,2)
  placeUnit(battle, allyB, 4, 2)
  assert.equal(
    findPincerAssisters(battle, knight, knight.col, knight.row, enemyA).length,
    0,
    '90-degree L-shape adjacent ally must NOT trigger Pincer'
  )

  // 4. Stunned opposite ally does NOT qualify
  placeUnit(battle, allyB, 3, 3)
  allyB.stunTurns = 1
  assert.equal(
    findPincerAssisters(battle, knight, knight.col, knight.row, enemyA).length,
    0,
    'Stunned opposite ally must NOT trigger Pincer'
  )
  allyB.stunTurns = 0

  // 5. Downed / dead opposite ally does NOT qualify
  allyB.alive = false
  allyB.downed = true
  allyB.hp = 0
  assert.equal(
    findPincerAssisters(battle, knight, knight.col, knight.row, enemyA).length,
    0,
    'Downed opposite ally must NOT trigger Pincer'
  )
  allyB.alive = true
  allyB.downed = false
  allyB.hp = allyB.maxHp

  // 6. Ranged attack (distance >= 2) does NOT qualify even if an ally is adjacent on the opposite side
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemyA, 3, 2)
  placeUnit(battle, allyB, 4, 2)
  assert.equal(
    findPincerAssisters(battle, knight, knight.col, knight.row, enemyA).length,
    0,
    'Ranged attack (manhattan > 1) must NOT trigger Pincer'
  )

  // 7. Elevation difference exceeding assister jump prevents Pincer assist
  placeUnit(battle, knight, 2, 2)
  battle.cells[2][4] = makeCell(4, 2, 'hill', 3)
  placeUnit(battle, allyB, 4, 2)
  allyB.jump = 1
  assert.equal(
    findPincerAssisters(battle, knight, knight.col, knight.row, enemyA).length,
    0,
    'Assister above jump height difference must NOT trigger Pincer'
  )
  allyB.jump = 3
  assert.equal(
    findPincerAssisters(battle, knight, knight.col, knight.row, enemyA).length,
    1,
    'Assister within jump height difference qualifies for Pincer'
  )

  // 8. Symmetrical enemy pincer: enemyA(2,2) -> knight(3,2) <- enemyB(4,2)
  battle.cells[2][4] = makeCell(4, 2, 'grass', 0)
  placeUnit(battle, allyB, 0, battle.rows - 1)
  placeUnit(battle, enemyA, 2, 2)
  placeUnit(battle, knight, 3, 2)
  placeUnit(battle, enemyB, 4, 2)
  const enemyPincer = findPincerAssisters(battle, enemyA, enemyA.col, enemyA.row, knight)
  assert.equal(enemyPincer.length, 1, 'Enemies flanking a hero on opposite sides must also trigger Pincer')
  assert.equal(enemyPincer[0].uid, enemyB.uid)
})

test('computePincerAssistDamage scales with ATK, DEF, elevation, empower, and enforces minimum 4 DMG', () => {
  const state = createInitialState(9002)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const assister = battle.units.find(u => u.team === 'ally')!
  const target = battle.units.find(u => u.team === 'enemy')!
  placeUnit(battle, assister, 4, 2)
  placeUnit(battle, target, 3, 2)

  assister.atk = 30
  assister.empowerTurns = 0
  target.def = 10
  // Basic dmg = round(30 - 10 * 0.72) = 23 -> 50% = round(11.5) = 12
  const baseDmg = computePincerAssistDamage(battle, assister, target)
  assert.equal(baseDmg, 12)

  // Empower (+35%) boosts pincer damage
  assister.empowerTurns = 2
  const empDmg = computePincerAssistDamage(battle, assister, target)
  assert.ok(empDmg > baseDmg, `Empowered pincer (${empDmg}) should exceed base (${baseDmg})`)
  assister.empowerTurns = 0

  // High ground boosts pincer damage
  battle.cells[2][4] = makeCell(4, 2, 'hill', 1)
  placeUnit(battle, assister, 4, 2)
  const highDmg = computePincerAssistDamage(battle, assister, target)
  assert.ok(highDmg > baseDmg, `High ground pincer (${highDmg}) should exceed flat (${baseDmg})`)

  // Very high target DEF still respects minimum 4 DMG
  battle.cells[2][4] = makeCell(4, 2, 'grass', 0)
  placeUnit(battle, assister, 4, 2)
  target.def = 90
  assert.equal(computePincerAssistDamage(battle, assister, target), 4, 'Minimum pincer damage must be 4')
})

test('CombatForecast previews Pincer assister, bonus damage, lethal KO, and Move+Attack approach tile Pincer', () => {
  const state = createInitialState(9003)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const mage = battle.units.find(u => u.team === 'ally' && u.heroId === 'mage')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  placeUnit(battle, mage, 0, battle.rows - 1)
  makeActiveHero(battle, knight)
  knight.crit = 0
  enemy.shield = 0

  // Direct adjacent Pincer: knight(2,2) -> enemy(3,2) <- archer(4,2)
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  placeUnit(battle, archer, 4, 2)
  const expectedPincer = computePincerAssistDamage(battle, archer, enemy)
  assert.ok(expectedPincer >= 4)

  // Set enemy HP so main strike alone is NOT lethal, but main strike + Pincer IS lethal!
  refreshHighlights(battle, state.campaign)
  const probeFc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.ok(probeFc)
  const lethalThresholdHp = probeFc.normalDmg + Math.max(1, expectedPincer - 1)
  enemy.hp = lethalThresholdHp
  enemy.maxHp = Math.max(enemy.maxHp, lethalThresholdHp + 10)

  const fc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.ok(fc, 'Forecast should exist for adjacent enemy')
  assert.equal(fc.pincerAssisterUid, archer.uid)
  assert.equal(fc.pincerAssisterName, archer.name)
  assert.equal(fc.pincerDmg, expectedPincer)
  assert.equal(fc.pincerFromCol, archer.col)
  assert.equal(fc.pincerFromRow, archer.row)
  assert.ok(enemy.hp > fc.normalDmg, 'Main strike alone should not be lethal')
  assert.equal(fc.targetHpAfterNormal, 0, 'Combined main + pincer damage must reduce projected HP to 0')
  assert.equal(fc.lethalNormal, true, 'Pincer follow-up securing KO must set lethalNormal = true')
  assert.equal(fc.lethalCrit, true)

  // Single-target melee skill (Knight Shield Bash) also previews Pincer!
  const sk0 = getHeroSkill(knight, 0)!
  assert.equal(isPincerMeleeSkill(sk0), true)
  assert.equal(armSkill(state, 0), true)
  const skFc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.equal(skFc.pincerAssisterUid, archer.uid)
  assert.equal(skFc.pincerDmg, expectedPincer)

  // Move+Attack Pincer forecast: knight starts at (0,2), moves to approach (2,2) opposite archer(4,2)
  armSkill(state, null)
  placeUnit(battle, knight, 0, 2)
  knight.move = 3
  refreshHighlights(battle, state.campaign)
  const maFc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.ok(maFc, 'Move+Attack forecast should exist')
  assert.equal(maFc.requiresMove, true)
  assert.equal(maFc.approachCol, 2, 'Move+Attack should pick opposite pincer approach tile (2,2)')
  assert.equal(maFc.approachRow, 2)
  assert.equal(maFc.pincerAssisterUid, archer.uid, 'Move+Attack forecast must preview Pincer from projected approach tile')
  assert.equal(maFc.pincerDmg, expectedPincer)
  assert.equal(maFc.lethalNormal, true)

  // Ranged attack forecast (Archer at (1,2) targeting enemy at (3,2) with Knight at (4,2)) must NOT show Pincer
  makeActiveHero(battle, archer)
  placeUnit(battle, archer, 1, 2)
  placeUnit(battle, enemy, 3, 2)
  placeUnit(battle, knight, 4, 2)
  refreshHighlights(battle, state.campaign)
  const rangedFc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.ok(rangedFc)
  assert.equal(rangedFc.pincerAssisterUid, undefined, 'Ranged attack must not preview Pincer')
  assert.equal(rangedFc.pincerDmg, undefined)
})

test('Executing a Pincer strike deals main + bonus damage, emits PINCER! float & VFX, and triggers KO/victory cleanly', () => {
  const state = createInitialState(9004)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const mage = battle.units.find(u => u.team === 'ally' && u.heroId === 'mage')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  placeUnit(battle, mage, 0, battle.rows - 1)
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  placeUnit(battle, archer, 4, 2)
  makeActiveHero(battle, knight)
  knight.crit = 0
  enemy.shield = 0
  enemy.hp = 120
  enemy.maxHp = 120

  refreshHighlights(battle, state.campaign)
  const fc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.ok(fc.pincerDmg && fc.pincerDmg >= 4)

  state.vfx.length = 0
  battle.floatingNumbers.length = 0
  const hpBefore = enemy.hp

  // Execute adjacent melee strike -> triggers Pincer Follow-Up!
  assert.equal(selectTile(state, enemy.col, enemy.row), true)
  assert.equal(enemy.hp, hpBefore - fc.normalDmg - fc.pincerDmg!, 'Enemy HP must drop by main + pincer damage')
  assert.equal(archer.animState, 'attack', 'Assister must perform follow-up attack animation')
  assert.ok(Math.hypot(archer.lungeX, archer.lungeZ) > 0.1, 'Assister must lunge toward target')
  assert.ok(
    battle.floatingNumbers.some(f => f.text === 'PINCER!'),
    'Must emit PINCER! floating text'
  )
  const pincerEv = state.vfx.find(ev => ev.kind === 'pincer')
  assert.ok(pincerEv && pincerEv.kind === 'pincer', 'Must emit pincer VFX event')
  assert.equal(pincerEv.attackerUid, knight.uid)
  assert.equal(pincerEv.assisterUid, archer.uid)
  assert.equal(pincerEv.targetUid, enemy.uid)
  assert.equal(pincerEv.damage, fc.pincerDmg)

  // Now test follow-up KO triggering victory!
  makeActiveHero(battle, knight)
  enemy.hp = fc.normalDmg + Math.max(1, fc.pincerDmg! - 1)
  refreshHighlights(battle, state.campaign)
  state.vfx.length = 0
  battle.floatingNumbers.length = 0

  assert.equal(selectTile(state, enemy.col, enemy.row), true)
  assert.equal(enemy.alive, false, 'Pincer follow-up must KO the target')
  assert.equal(enemy.hp, 0)
  assert.equal(battle.phase, 'victory', 'KO via Pincer follow-up must trigger checkBattleOutcome -> victory')
  assert.ok(state.vfx.some(ev => ev.kind === 'pincer'))
  assert.ok(state.vfx.some(ev => ev.kind === 'ko'))
})

test('Enemy Pincer Follow-Up triggers symmetrically when enemies flank a hero on opposite sides', () => {
  const state = createInitialState(9005)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const allies = battle.units.filter(u => u.team === 'ally')
  const enemies = battle.units.filter(u => u.team === 'enemy')
  const hero = allies[0]
  for (const a of allies.slice(1)) { a.alive = false; a.downed = false; a.koCountdown = 0; a.hp = 0 }
  const [e1, e2, ...rest] = enemies
  for (const e of rest) { e.alive = false; e.hp = 0 }

  e1.range = 1
  e2.range = 1
  e1.stunTurns = 0
  e2.stunTurns = 0
  e1.ct = 100
  e2.ct = 0
  hero.hp = 150
  hero.maxHp = 150
  hero.shield = 0
  hero.ct = 0

  // e1(2,2) -> hero(3,2) <- e2(4,2)
  placeUnit(battle, e1, 2, 2)
  placeUnit(battle, hero, 3, 2)
  placeUnit(battle, e2, 4, 2)

  // Hand turn over to enemy e1
  endPlayerTurn(state)
  battle.phase = 'enemy'
  battle.activeUnitUid = e1.uid
  battle.enemyActedThisTurn = false
  battle.enemyDelay = 0.01
  state.vfx.length = 0
  battle.floatingNumbers.length = 0

  const hpBefore = hero.hp
  for (let i = 0; i < 10 && !battle.enemyActedThisTurn; i++) {
    stepGame(state, 0.05)
  }

  assert.ok(hero.hp < hpBefore, 'Hero should take damage from enemy attack')
  assert.ok(
    battle.floatingNumbers.some(f => f.text === 'PINCER!'),
    'Symmetrical enemy Pincer must emit PINCER! float'
  )
  assert.ok(
    state.vfx.some(ev => ev.kind === 'pincer' && ev.attackerUid === e1.uid && ev.assisterUid === e2.uid),
    'Symmetrical enemy Pincer must emit pincer VFX event'
  )
})

test('CrownshardScene renders live 3D Pincer assist arc in CombatForecast and executed pincer VFX without throwing', () => {
  const state = createInitialState(9006)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const mage = battle.units.find(u => u.team === 'ally' && u.heroId === 'mage')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  placeUnit(battle, mage, 0, battle.rows - 1)
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  placeUnit(battle, archer, 4, 2)
  enemy.hp = 120
  enemy.maxHp = 120
  makeActiveHero(battle, knight)
  refreshHighlights(battle, state.campaign)

  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  // Baseline forecast WITHOUT pincer (move archer off opposite tile)
  placeUnit(battle, archer, 4, 3)
  const nonPincerFc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.equal(nonPincerFc.pincerAssisterUid, undefined)
  scene.setForecast(nonPincerFc)
  scene.render(state, 1 / 60, 1280, 720)
  const nonPincerInstances = fake.lastInstances

  // Live forecast WITH pincer (place archer on opposite tile)
  placeUnit(battle, archer, 4, 2)
  const pincerFc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.equal(pincerFc.pincerAssisterUid, archer.uid)
  scene.setForecast(pincerFc)
  scene.render(state, 1 / 60, 1280, 720)
  const pincerInstances = fake.lastInstances
  assert.ok(
    pincerInstances > nonPincerInstances,
    `3D Pincer preview arc + assister ring (${pincerInstances}) must emit more instances than non-pincer forecast (${nonPincerInstances})`
  )

  // Execute the Pincer attack and animate the full VFX timeline cleanly
  scene.setForecast(null)
  assert.equal(selectTile(state, enemy.col, enemy.row), true)
  assert.ok(state.vfx.some(ev => ev.kind === 'pincer'))
  for (let i = 0; i < 50; i++) {
    stepGame(state, 1 / 60)
    scene.render(state, 1 / 60, 1280, 720)
  }
  assert.ok(fake.drawn > 50)
  assert.ok(fake.maxInstances > pincerInstances, 'Executed pincer VFX should spawn arc/slash/spark instances')
  scene.dispose()
})

test('drawCombatForecast renders the golden PINCER +N (AllyName) badge cleanly without throwing', () => {
  const state = createInitialState(9007)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  placeUnit(battle, archer, 4, 2)
  makeActiveHero(battle, knight)
  refreshHighlights(battle, state.campaign)

  const fc = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.ok(fc.pincerAssisterUid && fc.pincerDmg)

  const mock = makeMockCanvasContext()
  drawCombatForecast(mock.ctx, { x: 16, y: 16, width: 332, height: 104 }, fc, { compact: false, locked: true })
  assert.ok(mock.ops > 20)
  assert.ok(
    mock.texts.some(t => t.includes(`PINCER +${fc.pincerDmg}`)),
    `drawCombatForecast must render golden PINCER +${fc.pincerDmg} badge (rendered texts: ${mock.texts.join(', ')})`
  )

  // Compact layout also renders cleanly without throwing
  const compactMock = makeMockCanvasContext()
  drawCombatForecast(compactMock.ctx, { x: 8, y: 8, width: 290, height: 96 }, fc, { compact: true, locked: false })
  assert.ok(compactMock.ops > 20)
  assert.ok(compactMock.texts.some(t => t.includes(`PINCER +${fc.pincerDmg}`)))
})
