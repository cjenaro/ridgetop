import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { buildStaticBoardBatches } from '../examples/crownshard/crownshard/art.ts'
import { CHAPTERS } from '../examples/crownshard/crownshard/data.ts'
import {
  BARRICADE_DEFAULT_HP,
  COVER_HEAVY_DAMAGE_MUL,
  CRACKED_PILLAR_DEFAULT_HP,
  applyCoverCellDamage,
  computeCoverDamage,
  countBattleDestructibleCover,
  formatCoverForecastBadge,
  formatCoverTooltip,
  getCoverDamageRatio,
  getCoverHp,
  isCrackedPillarCell,
  isDestructibleCover,
  isHeavyCoverHit,
  previewCoverDamageOnCells
} from '../examples/crownshard/crownshard/destructible-cover.ts'
import { applyDisplacement } from '../examples/crownshard/crownshard/forced-movement.ts'
import { createCrownshardScene, pickCellFromRay } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill,
  armTacticCard,
  computeCombatForecast,
  computeCoverBonus,
  computeMoveTiles,
  computeTargetTiles,
  createInitialState,
  hasLineOfSight,
  restoreBattleState,
  selectHeroByUid,
  selectTile,
  serializeBattleState,
  startChapterBattle,
  startStageBattle,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import {
  COLLISION_IMPACT_DAMAGE,
  gridToWorld,
  terrainElevation,
  terrainWalkable
} from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, GridCell, TileTerrain } from '../examples/crownshard/crownshard/types.ts'
import { drawCombatForecast } from '../examples/crownshard/crownshard/ui-art.ts'

function makeCell(col: number, row: number, terrain: TileTerrain, heightLevel = 0): GridCell {
  const h = terrain === 'void' ? -1 : heightLevel
  return {
    col,
    row,
    terrain,
    elevation: terrainElevation(terrain, h),
    walkable: terrainWalkable(terrain),
    heightLevel: h,
    ...(terrain === 'barricade' ? { barricadeHp: BARRICADE_DEFAULT_HP, barricadeMaxHp: BARRICADE_DEFAULT_HP } : {}),
    ...(terrain === 'cracked_pillar' ? { pillarHp: CRACKED_PILLAR_DEFAULT_HP, pillarMaxHp: CRACKED_PILLAR_DEFAULT_HP } : {}),
    ...(terrain === 'lava_geyser' ? { geyserActive: false } : {}),
    ...(terrain === 'cursed_altar' ? { altarUsed: false } : {})
  }
}

function flattenBoard(battle: BattleState, terrain: TileTerrain = 'grass', heightLevel = 0): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, terrain, heightLevel)
    }
  }
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number): void {
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
  let frames = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      frames++
      let n = 0
      for (const b of batches) n += b.count
      lastInstances = n
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get lastInstances() { return lastInstances },
    get frames() { return frames }
  }
}

function mockCanvasCtx() {
  let ops = 0
  const texts: string[] = []
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
    fillText(s: string) { ops++; texts.push(s) },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

test('Cracked pillars & wooden barricades block movement/LoS and grant adjacent Cover while intact, then immediately clear both upon shattering', () => {
  const state = createInitialState(7101)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle, 'grass', 0)

  const archer = battle.units.find(u => u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== archer.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // Place a Cracked Pillar at (2, 2) directly between Archer (1, 2) and Enemy (4, 2)
  battle.cells[2][2] = makeCell(2, 2, 'cracked_pillar', 0)
  assert.equal(isCrackedPillarCell(battle.cells[2][2]), true)
  assert.equal(isDestructibleCover(battle.cells[2][2]), true)
  assert.equal(battle.cells[2][2].walkable, false)
  assert.deepEqual(getCoverHp(battle.cells[2][2]), { hp: CRACKED_PILLAR_DEFAULT_HP, maxHp: CRACKED_PILLAR_DEFAULT_HP, kind: 'cracked_pillar' })

  placeUnit(battle, archer, 1, 2)
  placeUnit(battle, enemy, 4, 2)
  archer.range = 4
  archer.atk = 18
  archer.crit = 0
  archer.acted = false
  archer.moved = false

  // Intact cracked pillar blocks direct LoS and movement
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), false, 'Intact cracked pillar must block direct LoS')
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, true), true, 'Indirect arcing skills clear cracked pillar')
  assert.equal(computeMoveTiles(battle, archer).some(m => m.col === 2 && m.row === 2), false, 'Intact cracked pillar must block movement')

  // Adjacent cracked pillar grants +4 attacker-facing Cover DEF
  battle.cells[2][3] = makeCell(3, 2, 'cracked_pillar', 0)
  assert.equal(computeCoverBonus(battle, 2, 0, 4, 2), 4, 'Intact adjacent cracked pillar grants +4 Cover DEF')
  battle.cells[2][3] = makeCell(3, 2, 'grass', 0)

  // Direct basic attack targets the Cracked Pillar and forecasts exact HP loss
  selectHeroByUid(state, archer.uid)
  const targets = computeTargetTiles(battle, archer, -1)
  assert.equal(targets.some(t => t.col === 2 && t.row === 2), true, 'Cracked pillar must be targetable by basic attack')
  const fc1 = computeCombatForecast(state, 2, 2)!
  assert.ok(fc1, 'Hovering cracked pillar must return CombatForecast')
  assert.equal(fc1.targetName, 'Cracked Pillar')
  assert.equal(fc1.targetHpBefore, CRACKED_PILLAR_DEFAULT_HP)
  assert.equal(fc1.coverDamage, 18)
  assert.equal(fc1.willShatterCover, false)

  // First basic shot cracks pillar: 35 -> 17 HP (still intact, < 50% HP!)
  assert.equal(selectTile(state, 2, 2), true)
  assert.equal(battle.cells[2][2].terrain, 'cracked_pillar')
  assert.equal(battle.cells[2][2].pillarHp, 17)
  assert.ok(getCoverDamageRatio(battle.cells[2][2]) > 0.5, 'Damaged pillar ratio should exceed 50%')
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), false, 'Damaged but intact pillar still blocks LoS')

  // Second shot shatters pillar (17 -> 0): becomes walkable stone, opens LoS immediately, emits cover_shatter VFX + log!
  archer.acted = false
  state.vfx.length = 0
  selectHeroByUid(state, archer.uid)
  const fc2 = computeCombatForecast(state, 2, 2)!
  assert.equal(fc2.willShatterCover, true)
  assert.equal(fc2.shatteredCoverCount, 1)
  assert.equal(selectTile(state, 2, 2), true)

  assert.equal(battle.cells[2][2].terrain, 'stone', 'Shattered cracked pillar converts to walkable stone')
  assert.equal(battle.cells[2][2].walkable, true)
  assert.equal(battle.cells[2][2].coverShattered, 'pillar')
  assert.equal(isDestructibleCover(battle.cells[2][2]), false)
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), true, 'Shattering cracked pillar opens LoS immediately')
  assert.equal(computeCoverBonus(battle, 1, 2, 3, 2), 0, 'Shattered pillar no longer provides adjacent cover bonus')
  assert.equal(computeMoveTiles(battle, archer).some(m => m.col === 2 && m.row === 2), true, 'Shattered pillar tile is immediately walkable')
  assert.ok(state.vfx.some(ev => ev.kind === 'cover_shatter' && ev.coverKind === 'pillar'), 'Must emit cover_shatter VFX')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'SHATTERED!'), 'Must emit SHATTERED! floating text')
  assert.ok(battle.combatLog.some(e => e.category === 'hazard' && e.text.includes('shatters Cracked Pillar')), 'Must log pillar shatter')

  const counts = countBattleDestructibleCover(battle)
  assert.equal(counts.intactCount, 0)
  assert.equal(counts.shatteredCount, 1)
})

test('Heavy hits deal bonus structural damage and AoE skills/tactics shatter cover alongside enemies', () => {
  // Pure heavy-hit structural damage verification
  assert.equal(isHeavyCoverHit(15, { powerMul: 1 }), false)
  assert.equal(computeCoverDamage(15, { powerMul: 1 }).damage, 15)
  assert.equal(isHeavyCoverHit(24, { powerMul: 1 }), true)
  assert.equal(computeCoverDamage(24, { powerMul: 1 }).damage, Math.round(24 * COVER_HEAVY_DAMAGE_MUL))
  assert.equal(isHeavyCoverHit(16, { powerMul: 1.5 }), true)
  assert.equal(computeCoverDamage(16, { powerMul: 1.5 }).damage, Math.round(16 * COVER_HEAVY_DAMAGE_MUL))
  assert.equal(isHeavyCoverHit(14, { isCrit: true }), true)
  assert.equal(computeCoverDamage(14, { isCrit: true }).damage, Math.round(14 * COVER_HEAVY_DAMAGE_MUL))

  const state = createInitialState(7102)
  // Promote Mage to 3* so AoE cross/area3 skills are unlocked, and add Meteor Call tactic card
  const mageCard = state.campaign.heroes.find(h => h.heroId === 'mage')!
  mageCard.stars = 3
  state.campaign.tactics.push({ uid: 'tac_storm_cover', tacticId: 'lightning_chain' })
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle, 'grass', 0)

  const mage = battle.units.find(u => u.heroId === 'mage')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== mage.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // Place enemy at (4, 2) flanked by a Cracked Pillar at (3, 2) and Timber Barricade at (4, 1)
  battle.cells[2][3] = makeCell(3, 2, 'cracked_pillar', 0)
  battle.cells[1][4] = makeCell(4, 1, 'barricade', 0)
  placeUnit(battle, mage, 1, 2)
  placeUnit(battle, enemy, 4, 2)
  mage.atk = 22
  mage.acted = false
  mage.cooldowns = [0, 0, 0]
  enemy.hp = 120
  enemy.maxHp = 120
  enemy.shield = 0
  battle.activeUnitUid = mage.uid
  battle.selectedUnitUid = mage.uid
  selectHeroByUid(state, mage.uid)

  // Arm Mage skill 1 (AoE cross) and aim at the enemy at (4, 2) -> forecast must detect BOTH cover obstacles in the cross!
  assert.equal(armSkill(state, 1), true)
  const fcAoe = computeCombatForecast(state, 4, 2)!
  assert.ok(fcAoe, 'AoE skill forecast on enemy must exist')
  assert.equal(fcAoe.damagedCoverCount, 2, 'Cross AoE aimed at enemy must hit adjacent cracked pillar + barricade')
  assert.equal(fcAoe.willShatterCover, true, 'Heavy AoE must forecast shattering cover')
  assert.ok((fcAoe.shatteredCoverCount ?? 0) >= 1)

  // Verify CombatForecast draws compact cover shatter badge cleanly on narrow mobile width (340px / compact)
  const ui = mockCanvasCtx()
  drawCombatForecast(ui.ctx, { x: 0, y: 0, width: 320, height: 108 }, fcAoe, { compact: true })
  assert.ok(ui.ops > 15)
  assert.ok(
    ui.texts.some(t => t.includes('SHATTER')),
    `Expected SHATTER cover badge in forecast texts, got: ${ui.texts.join(', ')}`
  )

  // Execute AoE skill -> enemy takes damage AND both adjacent obstacles take heavy AoE damage & shatter!
  assert.equal(selectTile(state, 4, 2), true)
  assert.ok(enemy.hp < 120, 'Enemy at AoE center must take damage')
  assert.equal(battle.cells[2][3].terrain, 'stone', 'Cracked pillar inside AoE must shatter to walkable stone')
  assert.equal(battle.cells[1][4].terrain, 'stone', 'Barricade inside AoE must shatter to walkable stone')
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), true, 'Shattering pillar via AoE immediately opens LoS')

  // Verify AoE Tactic Card (Storm Decree, area3, 32 DMG -> heavy hit 48 DMG) shatters fresh cover!
  battle.cells[2][3] = makeCell(3, 2, 'cracked_pillar', 0)
  battle.cells[3][4] = makeCell(4, 3, 'barricade', 0)
  battle.ap = 4
  battle.hand = ['tac_storm_cover']
  assert.equal(armTacticCard(state, 'tac_storm_cover'), true)
  const fcTactic = computeCombatForecast(state, 4, 2)!
  assert.equal(fcTactic.damagedCoverCount, 2)
  assert.equal(fcTactic.shatteredCoverCount, 2)
  assert.equal(fcTactic.willShatterCover, true)
  assert.equal(selectTile(state, 4, 2), true)
  assert.equal(battle.cells[2][3].terrain, 'stone')
  assert.equal(battle.cells[3][4].terrain, 'stone')
})

test('Knockback collision into a Cracked Pillar damages and shatters it when HP drops to 0', () => {
  const state = createInitialState(7103)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle, 'grass', 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  battle.cells[2][3] = makeCell(3, 2, 'cracked_pillar', 0)
  battle.cells[2][3].pillarHp = COLLISION_IMPACT_DAMAGE
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  enemy.hp = 60
  enemy.stunTurns = 0

  const res = applyDisplacement(state, knight, enemy, { kind: 'knockback', distance: 1 })
  assert.equal(res.preview.collidedWith, 'cracked_pillar')
  assert.equal(enemy.hp, 60 - COLLISION_IMPACT_DAMAGE)
  assert.equal(enemy.stunTurns, 1)
  assert.equal(res.barricadeDmgDealt, COLLISION_IMPACT_DAMAGE)
  assert.equal(res.barricadeShattered, true)
  assert.equal(battle.cells[2][3].terrain, 'stone')
  assert.equal(battle.cells[2][3].walkable, true)
  assert.equal(battle.cells[2][3].coverShattered, 'pillar')
})

test('Static/dynamic 3D scene rendering removes shattered pillars cleanly with zero ghost geometry & ray picking hits cracked pillars', () => {
  const state = createInitialState(7104)
  const battle = startStageBattle(state, 'border_watch')

  // Border Watch Act I must include both a Cracked Pillar and Timber Barricade right away
  const initCounts = countBattleDestructibleCover(battle)
  assert.ok(initCounts.crackedPillarCount >= 1, 'Act I Border Watch must include at least one cracked_pillar')
  assert.ok(initCounts.barricadeCount >= 1, 'Act I Border Watch must include at least one barricade')

  // Verify static batch emits NO pillar shaft for cracked_pillar (same static instance count before & after shattering!)
  const staticBefore = buildStaticBoardBatches(battle.biome, battle.cells)
  const staticInstancesBefore = staticBefore.batches.reduce((s, b) => s + b.count, 0)

  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)
  scene.render(state, STEP, 1280, 720)
  const dynamicInstancesBefore = fake.lastInstances

  // Locate the cracked pillar on Border Watch and verify ray pick hits its upper column
  let cpCell: GridCell | null = null
  for (const row of battle.cells) {
    for (const c of row) {
      if (c.terrain === 'cracked_pillar') cpCell = c
    }
  }
  assert.ok(cpCell, 'Expected cracked_pillar cell on Border Watch')
  const [wx, wy, wz] = gridToWorld(cpCell.col, cpCell.row, cpCell.elevation, battle.cols, battle.rows)
  const picked = pickCellFromRay(battle, [wx, wy + 5, wz], [0, -1, 0])
  assert.deepEqual(picked, { col: cpCell.col, row: cpCell.row }, 'Ray pick must hit cracked_pillar cleanly')

  // Shatter the cracked pillar
  const outcome = applyCoverCellDamage(cpCell, 50, { powerMul: 1.5 })
  assert.ok(outcome?.shattered)
  assert.equal(cpCell.terrain, 'stone')
  assert.equal(cpCell.coverShattered, 'pillar')

  // Static geometry count stays identical (only ground tile base was static — ZERO ghost pillar shaft!)
  const staticAfter = buildStaticBoardBatches(battle.biome, battle.cells)
  const staticInstancesAfter = staticAfter.batches.reduce((s, b) => s + b.count, 0)
  assert.equal(staticInstancesAfter, staticInstancesBefore, 'Cracked pillar must NOT bake ghost pillar geometry into static batches')

  // Dynamic render count decreases (tall cracked pillar replaced by low scattered rubble)
  scene.render(state, STEP, 1280, 720)
  const dynamicInstancesAfter = fake.lastInstances
  assert.ok(
    dynamicInstancesAfter < dynamicInstancesBefore,
    `Shattered pillar must render fewer dynamic meshes than intact pillar (${dynamicInstancesAfter} < ${dynamicInstancesBefore})`
  )

  // Verify tooltip & badge formatters (full & compact mobile)
  const fullTip = formatCoverTooltip(makeCell(0, 0, 'cracked_pillar', 0), false)!
  const compactTip = formatCoverTooltip(makeCell(0, 0, 'cracked_pillar', 0), true)!
  assert.ok(fullTip.includes('Cracked Pillar') && fullTip.includes('35/35 HP') && fullTip.includes('LoS'))
  assert.ok(compactTip.length < fullTip.length && compactTip.includes('35/35 HP'))
  assert.equal(formatCoverForecastBadge({ willShatterCover: true, shatteredCoverCount: 1, damagedCoverCount: 1 }, true), 'SHATTER COVER')
  assert.equal(formatCoverForecastBadge({ coverDamage: 18, damagedCoverCount: 1 }, true), 'COVER -18')
  assert.equal(previewCoverDamageOnCells(battle, [], 20).damagedCoverCount, 0)

  scene.dispose()
})

test('Save/load round-trip preserves damaged & shattered cracked pillars/barricades and stays backward compatible with legacy saves', () => {
  const state = createInitialState(7105)
  const battle = startStageBattle(state, 'border_watch')

  // Set one damaged cracked pillar, one shattered pillar, and one damaged barricade
  battle.cells[3][3] = makeCell(3, 3, 'cracked_pillar', 0)
  battle.cells[3][3].pillarHp = 14
  battle.cells[3][3].pillarMaxHp = 35

  battle.cells[1][4] = makeCell(4, 1, 'barricade', 1)
  battle.cells[1][4].barricadeHp = 9
  battle.cells[1][4].barricadeMaxHp = 25

  battle.cells[2][4] = makeCell(4, 2, 'cracked_pillar', 0)
  applyCoverCellDamage(battle.cells[2][4], 40)
  assert.equal(battle.cells[2][4].terrain, 'stone')
  assert.equal(battle.cells[2][4].coverShattered, 'pillar')

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap, 'Battle with damaged & shattered cover must serialize')
  assert.ok(validateBattleSnapshot(snap), 'Serialized snapshot must pass validation')

  const restored = createInitialState(9999)
  assert.equal(restoreBattleState(restored, snap), true)
  const rb = restored.battle!

  assert.equal(rb.cells[3][3].terrain, 'cracked_pillar')
  assert.equal(rb.cells[3][3].pillarHp, 14)
  assert.equal(rb.cells[3][3].pillarMaxHp, 35)
  assert.equal(rb.cells[3][3].walkable, false)

  assert.equal(rb.cells[1][4].terrain, 'barricade')
  assert.equal(rb.cells[1][4].barricadeHp, 9)
  assert.equal(rb.cells[1][4].barricadeMaxHp, 25)

  assert.equal(rb.cells[2][4].terrain, 'stone')
  assert.equal(rb.cells[2][4].walkable, true)
  assert.equal(rb.cells[2][4].coverShattered, 'pillar')

  const counts = countBattleDestructibleCover(rb)
  assert.equal(counts.crackedPillarCount, 1)
  assert.equal(counts.barricadeCount, 1)
  assert.equal(counts.shatteredCount, 1)

  // Backward compatibility: legacy save cell with terrain 'cracked_pillar' & omitted pillarHp defaults cleanly
  const legacyCells = snap.cells.map(row => row.map(c => ({ terrain: c.terrain, heightLevel: c.heightLevel })))
  const legacySnap = { ...snap, cells: legacyCells }
  const validatedLegacy = validateBattleSnapshot(legacySnap)
  assert.ok(validatedLegacy, 'Legacy save without pillarHp/coverShattered must still validate')
  assert.equal(validatedLegacy.cells[3][3].pillarHp, CRACKED_PILLAR_DEFAULT_HP)
  assert.equal(validatedLegacy.cells[1][4].barricadeHp, BARRICADE_DEFAULT_HP)

  // Verify multiple campaign chapters feature cracked pillars
  const chaptersWithCracked = CHAPTERS.filter(ch => ch.grid.some(row => row.includes('cracked_pillar')))
  assert.ok(chaptersWithCracked.length >= 5, `Expected at least 5 campaign chapters with cracked pillars, got ${chaptersWithCracked.length}`)
})
