import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats, Vec3 } from '../packages/ridgetop/framework/index.ts'
import { HERO_SPECS, TACTIC_BY_ID } from '../examples/crownshard/crownshard/data.ts'
import {
  COMBUST_DAMAGE_PER_STACK,
  FREEZE_BONUS_DAMAGE,
  WILDFIRE_DAMAGE,
  WILDFIRE_MAX_TILES,
  classifyElement,
  classifyHazardElement,
  collectWildfirePatch,
  computeShatterDamage,
  previewElementalCombo,
  triggerElementalCombo
} from '../examples/crownshard/crownshard/elemental-combos.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill,
  armTacticCard,
  computeCombatForecast,
  createInitialState,
  endPlayerTurn,
  selectTile,
  startChapterBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import { KO_COUNTDOWN_TURNS, gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, CombatForecast, ElementalComboId, GameState } from '../examples/crownshard/crownshard/types.ts'
import { drawCombatForecast } from '../examples/crownshard/crownshard/ui-art.ts'

function clearFlatBoard(battle: BattleState): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = { col: c, row: r, terrain: 'grass', elevation: 0, heightLevel: 0, walkable: true }
    }
  }
}

function setTileTerrain(battle: BattleState, col: number, row: number, terrain: BattleState['cells'][number][number]['terrain']): void {
  const walkable = terrain !== 'water' && terrain !== 'lava' && terrain !== 'pillar' && terrain !== 'void' && terrain !== 'barricade'
  battle.cells[row][col] = {
    col,
    row,
    terrain,
    elevation: terrain === 'water' ? -0.22 : terrain === 'bridge' ? 0.08 : 0,
    heightLevel: 0,
    walkable,
    ...(terrain === 'lava_geyser' ? { geyserActive: true } : {})
  }
}

function placeUnit(battle: BattleState, u: BattleState['units'][number], col: number, row: number): void {
  u.col = col
  u.row = row
  const [x, y, z] = gridToWorld(col, row, battle.cells[row][col].elevation, battle.cols, battle.rows)
  u.x = x
  u.y = y
  u.z = z
  u.path = []
  u.moveProgress = 0
}

function setupElementalSquadBattle(seed: number): {
  state: GameState
  battle: BattleState
  mage: BattleState['units'][number]
  cryo: BattleState['units'][number]
  rogue: BattleState['units'][number]
  enemies: BattleState['units'][number][]
} {
  const state = createInitialState(seed)
  state.campaign.heroes = [
    { uid: 'h_mage', heroId: 'mage', stars: 2, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'h_cryo', heroId: 'cryomancer', stars: 2, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'h_rogue', heroId: 'rogue', stars: 2, weaponUid: null, armorUid: null, relicUid: null }
  ]
  state.campaign.squadUids = ['h_mage', 'h_cryo', 'h_rogue']
  state.campaign.tactics.push(
    { uid: 'tac_fire', tacticId: 'flame_scroll' },
    { uid: 'tac_frost', tacticId: 'frost_nova_scroll' },
    { uid: 'tac_venom', tacticId: 'venom_vial' }
  )

  const battle = startChapterBattle(state, 0)
  clearFlatBoard(battle)
  const mage = battle.units.find(u => u.uid === 'h_mage')!
  const cryo = battle.units.find(u => u.uid === 'h_cryo')!
  const rogue = battle.units.find(u => u.uid === 'h_rogue')!
  const enemies = battle.units.filter(u => u.team === 'enemy')

  // Neutralize crit variance for deterministic damage assertions in tests
  mage.crit = 0
  cryo.crit = 0
  rogue.crit = 0
  mage.cooldowns = [0, 0, 0]
  cryo.cooldowns = [0, 0, 0]
  rogue.cooldowns = [0, 0, 0]
  battle.phase = 'player'
  battle.ap = 6
  battle.hand = ['tac_fire', 'tac_frost', 'tac_venom']

  return { state, battle, mage, cryo, rogue, enemies }
}

function fakeRenderer() {
  let drawn = 0
  let maxInstances = 0
  const stats: RenderStats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      drawn++
      let n = 0
      for (const b of batches) n += b.count
      maxInstances = Math.max(maxInstances, n)
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get drawn() { return drawn },
    get maxInstances() { return maxInstances }
  }
}

function fakeCanvasCtx(drawnTexts: string[]): CanvasRenderingContext2D {
  const grad = { addColorStop() {} }
  return {
    save() {},
    restore() {},
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
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    fillText(text: string) { drawnTexts.push(text) },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
}

test('Elemental classification derives fire, frost, poison, holy, arcane cleanly from existing specs and hazards', () => {
  assert.equal(classifyElement(HERO_SPECS.mage.skills[0]), 'arcane')
  assert.equal(classifyElement(HERO_SPECS.mage.skills[1]), 'fire')
  assert.equal(classifyElement(HERO_SPECS.mage.skills[2]), 'fire')
  assert.equal(classifyElement(HERO_SPECS.cryomancer.skills[0]), 'frost')
  assert.equal(classifyElement(HERO_SPECS.cryomancer.skills[1]), 'frost')
  assert.equal(classifyElement(HERO_SPECS.cryomancer.skills[2]), 'frost')
  assert.equal(classifyElement(HERO_SPECS.rogue.skills[0]), 'poison')
  assert.equal(classifyElement(HERO_SPECS.rogue.skills[1]), 'poison')
  assert.equal(classifyElement(HERO_SPECS.paladin.skills[0]), 'holy')
  assert.equal(classifyElement(HERO_SPECS.knight.skills[0]), null)
  assert.equal(classifyElement(HERO_SPECS.archer.skills[0]), null)

  assert.equal(classifyElement(TACTIC_BY_ID.flame_scroll), 'fire')
  assert.equal(classifyElement(TACTIC_BY_ID.frost_nova_scroll), 'frost')
  assert.equal(classifyElement(TACTIC_BY_ID.venom_vial), 'poison')
  assert.equal(classifyElement(TACTIC_BY_ID.lightning_chain), 'arcane')

  assert.equal(classifyHazardElement('lava_geyser'), 'fire')
  assert.equal(classifyHazardElement('lava'), 'fire')
  assert.equal(classifyHazardElement('ice'), 'frost')
  assert.equal(classifyHazardElement('snow'), 'frost')
  assert.equal(classifyHazardElement('grass'), null)
})

test('Shatter: Fire on Slowed and Frost on Burned deal bonus burst damage, consume status, emit float/VFX, and match CombatForecast', () => {
  const { state, battle, mage, cryo, rogue, enemies } = setupElementalSquadBattle(2001)
  const target = enemies[0]
  placeUnit(battle, mage, 1, 2)
  placeUnit(battle, cryo, 1, 3)
  placeUnit(battle, rogue, 0, 0)
  placeUnit(battle, target, 3, 2)
  for (let i = 1; i < enemies.length; i++) placeUnit(battle, enemies[i], 6, i)

  target.maxHp = 100
  target.hp = 100
  target.shield = 0
  target.slowTurns = 2

  // 1. Mage Ember Nova (Fire) on Slowed target -> SHATTER!
  battle.activeUnitUid = mage.uid
  battle.selectedUnitUid = mage.uid
  mage.acted = false
  assert.equal(armSkill(state, 1), true)

  const fc = computeCombatForecast(state, target.col, target.row)!
  assert.ok(fc, 'CombatForecast must be computed for Ember Nova')
  assert.ok(fc.elementalCombo, 'Forecast must surface Shatter combo')
  assert.equal(fc.elementalCombo.id, 'shatter')
  const expectedBonus = computeShatterDamage(target)
  assert.equal(expectedBonus, 16)
  assert.equal(fc.elementalCombo.bonusDamage, expectedBonus)
  assert.equal(fc.elementalCombo.consumesStatus, 'slow')
  assert.equal(fc.targetHpAfterNormal, target.hp - fc.normalDmg - expectedBonus)

  battle.floatingNumbers = []
  state.vfx = []
  assert.equal(selectTile(state, target.col, target.row), true)

  assert.equal(target.hp, fc.targetHpAfterNormal, 'Live HP after Shatter must match CombatForecast exactly')
  assert.equal(target.slowTurns, 0, 'Shatter must consume Slow')
  assert.ok(target.burnTurns >= 2, 'Ember Nova should still apply Burn after Shatter resolves')
  assert.ok(
    battle.floatingNumbers.some(fn => fn.text === `SHATTER! -${expectedBonus}`),
    'Shatter must emit SHATTER! -N floating callout'
  )
  assert.ok(
    state.vfx.some(ev => ev.kind === 'combo' && ev.combo === 'shatter' && ev.bonusDamage === expectedBonus),
    'Shatter must emit combo VFX event'
  )

  // 2. Cryomancer Frost Lance (Frost) on now-Burning target -> Thermal Shock SHATTER!
  target.hp = 90
  target.slowTurns = 0
  target.burnTurns = 2
  battle.activeUnitUid = cryo.uid
  battle.selectedUnitUid = cryo.uid
  cryo.acted = false
  assert.equal(armSkill(state, 0), true)

  const fcThermal = computeCombatForecast(state, target.col, target.row)!
  assert.equal(fcThermal.elementalCombo?.id, 'shatter')
  assert.equal(fcThermal.elementalCombo?.consumesStatus, 'burn')
  assert.equal(fcThermal.targetHpAfterNormal, target.hp - fcThermal.normalDmg - expectedBonus)

  battle.floatingNumbers = []
  state.vfx = []
  assert.equal(selectTile(state, target.col, target.row), true)
  assert.equal(target.hp, fcThermal.targetHpAfterNormal)
  assert.equal(target.burnTurns, 0, 'Thermal Shock Shatter must consume Burn')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === `SHATTER! -${expectedBonus}`))
  assert.ok(state.vfx.some(ev => ev.kind === 'combo' && ev.combo === 'shatter'))

  // 3. Fire Tactic Card (Cinder Scroll) on Slowed target -> SHATTER!
  target.hp = 90
  target.burnTurns = 0
  target.slowTurns = 2
  assert.equal(armTacticCard(state, 'tac_fire'), true)
  const fcTactic = computeCombatForecast(state, target.col, target.row)!
  assert.equal(fcTactic.elementalCombo?.id, 'shatter')
  assert.equal(fcTactic.targetHpAfterNormal, target.hp - fcTactic.normalDmg - expectedBonus)

  state.vfx = []
  assert.equal(selectTile(state, target.col, target.row), true)
  assert.equal(target.hp, fcTactic.targetHpAfterNormal)
  assert.equal(target.slowTurns, 0)
  assert.ok(state.vfx.some(ev => ev.kind === 'combo' && ev.combo === 'shatter'))
})

test('Freeze: Frost on wet/water-adjacent/ice tile or Slowed target applies Stun + bonus damage and matches CombatForecast', () => {
  const { state, battle, mage, cryo, rogue, enemies } = setupElementalSquadBattle(2002)
  const target = enemies[0]
  placeUnit(battle, cryo, 1, 2)
  placeUnit(battle, mage, 0, 0)
  placeUnit(battle, rogue, 0, 1)
  placeUnit(battle, target, 3, 2)
  for (let i = 1; i < enemies.length; i++) placeUnit(battle, enemies[i], 6, i)

  target.maxHp = 100
  target.hp = 100
  target.shield = 0
  target.slowTurns = 0
  target.stunTurns = 0
  target.burnTurns = 0

  // Dry grass, not slowed -> NO combo!
  battle.activeUnitUid = cryo.uid
  battle.selectedUnitUid = cryo.uid
  cryo.acted = false
  assert.equal(armSkill(state, 0), true)
  const dryFc = computeCombatForecast(state, target.col, target.row)!
  assert.equal(dryFc.elementalCombo, undefined, 'Dry un-slowed unit must NOT trigger Freeze')

  // Adjacent water (riverbank) -> FREEZE!
  setTileTerrain(battle, 3, 1, 'water')
  const wetFc = computeCombatForecast(state, target.col, target.row)!
  assert.equal(wetFc.elementalCombo?.id, 'freeze')
  assert.equal(wetFc.elementalCombo?.bonusDamage, FREEZE_BONUS_DAMAGE)
  assert.equal(wetFc.elementalCombo?.extraStatus, 'stun')
  assert.equal(wetFc.targetHpAfterNormal, target.hp - wetFc.normalDmg - FREEZE_BONUS_DAMAGE)

  battle.floatingNumbers = []
  state.vfx = []
  assert.equal(selectTile(state, target.col, target.row), true)
  assert.equal(target.hp, wetFc.targetHpAfterNormal)
  assert.ok(target.stunTurns >= 1, 'Freeze must apply Stun (stunTurns >= 1)')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === `FROZEN! -${FREEZE_BONUS_DAMAGE}`))
  assert.ok(state.vfx.some(ev => ev.kind === 'combo' && ev.combo === 'freeze'))

  // Standing on Ice tile -> FREEZE via Rime Seal tactic card!
  clearFlatBoard(battle)
  setTileTerrain(battle, target.col, target.row, 'ice')
  target.hp = 100
  target.slowTurns = 0
  target.stunTurns = 0
  assert.equal(armTacticCard(state, 'tac_frost'), true)
  const iceFc = computeCombatForecast(state, target.col, target.row)!
  assert.equal(iceFc.elementalCombo?.id, 'freeze')
  assert.equal(iceFc.targetHpAfterNormal, target.hp - iceFc.normalDmg - FREEZE_BONUS_DAMAGE)

  state.vfx = []
  assert.equal(selectTile(state, target.col, target.row), true)
  assert.equal(target.hp, iceFc.targetHpAfterNormal)
  assert.ok(target.stunTurns >= 1, 'Frost tactic on Ice tile must Freeze & Stun')
  assert.ok(state.vfx.some(ev => ev.kind === 'combo' && ev.combo === 'freeze'))

  // Dry grass, ALREADY slowed -> FREEZE!
  clearFlatBoard(battle)
  target.hp = 100
  target.slowTurns = 2
  target.stunTurns = 0
  cryo.acted = false
  cryo.cooldowns = [0, 0, 0]
  assert.equal(armSkill(state, 0), true)
  const slowedFc = computeCombatForecast(state, target.col, target.row)!
  assert.equal(slowedFc.elementalCombo?.id, 'freeze')
  assert.equal(selectTile(state, target.col, target.row), true)
  assert.ok(target.stunTurns >= 1, 'Frost on already-Slowed unit must upgrade chill into Freeze (Stun)')
})

test('Wildfire Spread: Fire hitting tall_grass ignites connected patch (up to 4 tiles), scorches tiles, damages & burns units, and previews affected tiles', () => {
  const { state, battle, mage, cryo, rogue, enemies } = setupElementalSquadBattle(2003)
  const targetA = enemies[0]
  const targetB = enemies[1]
  placeUnit(battle, mage, 0, 2)
  placeUnit(battle, cryo, 0, 0)
  placeUnit(battle, rogue, 0, 1)

  // Create a 5-tile connected tall_grass patch to verify BFS spreads up to WILDFIRE_MAX_TILES (4)
  const grassCoords: readonly [number, number][] = [
    [3, 2],
    [4, 2],
    [4, 3],
    [5, 3],
    [6, 3]
  ]
  for (const [c, r] of grassCoords) setTileTerrain(battle, c, r, 'tall_grass')

  // targetA stands at origin (3,2); targetB stands at (5,3) OUTSIDE Ember Nova's cross, but INSIDE the connected tall_grass patch!
  placeUnit(battle, targetA, 3, 2)
  placeUnit(battle, targetB, 5, 3)
  for (let i = 2; i < enemies.length; i++) placeUnit(battle, enemies[i], 6, 0)

  targetA.maxHp = 100
  targetA.hp = 100
  targetA.burnTurns = 0
  targetB.maxHp = 100
  targetB.hp = 100
  targetB.burnTurns = 0

  const patchPreview = collectWildfirePatch(battle, 3, 2)
  assert.equal(patchPreview.length, WILDFIRE_MAX_TILES, 'Wildfire BFS must cap at 4 connected tall_grass tiles')

  battle.activeUnitUid = mage.uid
  battle.selectedUnitUid = mage.uid
  mage.acted = false
  assert.equal(armSkill(state, 1), true) // Ember Nova (Fire, cross)

  const fc = computeCombatForecast(state, 3, 2)!
  assert.equal(fc.elementalCombo?.id, 'wildfire')
  assert.equal(fc.elementalCombo?.affectedTiles.length, WILDFIRE_MAX_TILES)
  assert.equal(fc.elementalCombo?.bonusDamage, WILDFIRE_DAMAGE)
  assert.equal(fc.targetHpAfterNormal, targetA.hp - fc.normalDmg - WILDFIRE_DAMAGE)

  battle.floatingNumbers = []
  state.vfx = []
  assert.equal(selectTile(state, 3, 2), true)

  // Every tile in the ignited 4-tile patch must now be scorched into darkstone, while the 5th tile beyond cap remains tall_grass
  for (const coord of patchPreview) {
    assert.equal(battle.cells[coord.row][coord.col].terrain, 'darkstone', `Tile (${coord.col},${coord.row}) must be scorched to darkstone`)
  }
  assert.equal(battle.cells[3][6].terrain, 'tall_grass', 'Tile beyond 4-tile Wildfire cap must remain unburned tall_grass')

  // Both targetA (at origin) and targetB (in connected grass outside cross) must have taken Wildfire damage & Burn!
  assert.equal(targetA.hp, fc.targetHpAfterNormal)
  assert.equal(targetB.hp, 100 - WILDFIRE_DAMAGE, 'Bystander standing in connected grass patch must take Wildfire damage')
  assert.ok(targetB.burnTurns >= 2, 'Bystander in ignited tall grass must receive Burn')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'WILDFIRE!'))
  assert.ok(state.vfx.some(ev => ev.kind === 'combo' && ev.combo === 'wildfire' && ev.cells.length === WILDFIRE_MAX_TILES))

  // Also test Cinder Scroll tactic card triggering Wildfire on a fresh 2-tile tall_grass patch!
  setTileTerrain(battle, 5, 1, 'tall_grass')
  setTileTerrain(battle, 6, 1, 'tall_grass')
  placeUnit(battle, targetA, 5, 1)
  targetA.hp = 100
  targetA.slowTurns = 0
  targetA.poisonStacks = 0
  assert.equal(armTacticCard(state, 'tac_fire'), true)
  const fcCard = computeCombatForecast(state, 5, 1)!
  assert.equal(fcCard.elementalCombo?.id, 'wildfire')
  assert.equal(fcCard.elementalCombo?.affectedTiles.length, 2)
  assert.equal(selectTile(state, 5, 1), true)
  assert.equal(battle.cells[1][5].terrain, 'darkstone')
  assert.equal(battle.cells[1][6].terrain, 'darkstone')
})

test('Combust: Fire hitting a Poisoned target detonates all poisonStacks for scaled bonus damage and clears stacks', () => {
  const { state, battle, mage, cryo, rogue, enemies } = setupElementalSquadBattle(2004)
  const target = enemies[0]
  placeUnit(battle, mage, 1, 2)
  placeUnit(battle, cryo, 0, 0)
  placeUnit(battle, rogue, 0, 1)
  placeUnit(battle, target, 3, 2)
  for (let i = 1; i < enemies.length; i++) placeUnit(battle, enemies[i], 6, i)

  target.maxHp = 120
  target.hp = 120
  target.shield = 0
  target.poisonStacks = 3
  const expectedBonus = 3 * COMBUST_DAMAGE_PER_STACK // 21

  // 1. Fire Hero Skill (Ember Nova)
  battle.activeUnitUid = mage.uid
  battle.selectedUnitUid = mage.uid
  mage.acted = false
  assert.equal(armSkill(state, 1), true)

  const fc = computeCombatForecast(state, target.col, target.row)!
  assert.equal(fc.elementalCombo?.id, 'combust')
  assert.equal(fc.elementalCombo?.bonusDamage, expectedBonus)
  assert.equal(fc.elementalCombo?.consumesStatus, 'poison')
  assert.equal(fc.targetHpAfterNormal, target.hp - fc.normalDmg - expectedBonus)

  battle.floatingNumbers = []
  state.vfx = []
  assert.equal(selectTile(state, target.col, target.row), true)
  assert.equal(target.hp, fc.targetHpAfterNormal)
  assert.equal(target.poisonStacks, 0, 'Combust must detonate and clear all poisonStacks')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === `COMBUST! -${expectedBonus}`))
  assert.ok(state.vfx.some(ev => ev.kind === 'combo' && ev.combo === 'combust' && ev.bonusDamage === expectedBonus))

  // 2. Fire Tactic Card (Cinder Scroll) on 4 poison stacks
  target.hp = 120
  target.poisonStacks = 4
  const expectedCardBonus = 4 * COMBUST_DAMAGE_PER_STACK // 28
  assert.equal(armTacticCard(state, 'tac_fire'), true)
  const fcCard = computeCombatForecast(state, target.col, target.row)!
  assert.equal(fcCard.elementalCombo?.id, 'combust')
  assert.equal(fcCard.elementalCombo?.bonusDamage, expectedCardBonus)
  assert.equal(selectTile(state, target.col, target.row), true)
  assert.equal(target.hp, fcCard.targetHpAfterNormal)
  assert.equal(target.poisonStacks, 0)
})

test('Lethal elemental combos cleanly invoke handleUnitDefeat (KO for enemies, downed window for allies) and checkBattleOutcome', () => {
  // 1. Enemy lethal KO via Shatter triggers Victory when last enemy dies
  {
    const { state, battle, mage, cryo, rogue, enemies } = setupElementalSquadBattle(2005)
    const lastEnemy = enemies[0]
    for (let i = 1; i < enemies.length; i++) {
      enemies[i].alive = false
      enemies[i].hp = 0
    }
    placeUnit(battle, mage, 1, 2)
    placeUnit(battle, cryo, 0, 0)
    placeUnit(battle, rogue, 0, 1)
    placeUnit(battle, lastEnemy, 3, 2)

    lastEnemy.maxHp = 100
    lastEnemy.shield = 0
    lastEnemy.slowTurns = 2

    battle.activeUnitUid = mage.uid
    battle.selectedUnitUid = mage.uid
    mage.acted = false
    assert.equal(armSkill(state, 1), true)

    const probeFc = computeCombatForecast(state, lastEnemy.col, lastEnemy.row)!
    // Set HP so primary hit leaves enemy alive (+5 HP), and Shatter (+16) delivers the lethal KO!
    lastEnemy.hp = probeFc.normalDmg + 5
    const lethalFc = computeCombatForecast(state, lastEnemy.col, lastEnemy.row)!
    assert.equal(lethalFc.lethalNormal, true, 'Forecast must report lethalNormal when combo finishes target')
    assert.equal(lethalFc.targetHpAfterNormal, 0)

    assert.equal(selectTile(state, lastEnemy.col, lastEnemy.row), true)
    assert.equal(lastEnemy.alive, false, 'Lethal Shatter must KO the enemy')
    assert.equal(lastEnemy.hp, 0)
    assert.equal(lastEnemy.downed, false, 'Enemies do not enter ally downed window')
    assert.equal(battle.phase, 'victory', 'checkBattleOutcome must award Victory when last enemy is KOed by combo')
  }

  // 2. Ally lethal hit via Wildfire spread enters downed window (KO_COUNTDOWN_TURNS) cleanly
  {
    const { state, battle, mage, cryo, rogue, enemies } = setupElementalSquadBattle(2006)
    placeUnit(battle, mage, 0, 2)
    placeUnit(battle, cryo, 4, 2) // standing in connected tall grass
    placeUnit(battle, rogue, 0, 0)
    placeUnit(battle, enemies[0], 6, 0)
    for (let i = 1; i < enemies.length; i++) placeUnit(battle, enemies[i], 6, i)

    setTileTerrain(battle, 3, 2, 'tall_grass')
    setTileTerrain(battle, 4, 2, 'tall_grass')
    cryo.hp = 6 // <= WILDFIRE_DAMAGE (10), so Wildfire will down Cryomancer!
    cryo.shield = 0

    battle.activeUnitUid = mage.uid
    battle.selectedUnitUid = mage.uid
    mage.acted = false
    assert.equal(armSkill(state, 1), true)

    // Cast Ember Nova on empty tall_grass at (3, 2) -> spreads to (4, 2) where low-HP Cryomancer stands
    assert.equal(selectTile(state, 3, 2), true)
    assert.equal(cryo.alive, false, 'Lethal Wildfire on ally must down them')
    assert.equal(cryo.downed, true, 'Ally KOed by combo must enter downed window via handleUnitDefeat')
    assert.equal(cryo.koCountdown, KO_COUNTDOWN_TURNS)
    assert.equal(battle.phase, 'player', 'Battle continues while other allies remain alive')
  }

  // 3. Lava Geyser hazard erupting under a Poisoned unit triggers Combust and handles lethal defeat
  {
    const { state, battle, mage, cryo, rogue, enemies } = setupElementalSquadBattle(2007)
    const enemy = enemies[0]
    placeUnit(battle, mage, 0, 0)
    placeUnit(battle, cryo, 0, 1)
    placeUnit(battle, rogue, 0, 2)
    setTileTerrain(battle, 4, 2, 'lava_geyser')
    placeUnit(battle, enemy, 4, 2)
    for (let i = 1; i < enemies.length; i++) placeUnit(battle, enemies[i], 6, i)

    enemy.maxHp = 80
    enemy.hp = 20 // survives 12 geyser DMG, dies to 3x7=21 Combust!
    enemy.shield = 0
    enemy.poisonStacks = 3
    for (const u of battle.units) u.ct = 0
    mage.ct = 100
    enemy.ct = 99
    // Set turn so next turn (battle.turn + 1) is even -> geyserActive === true
    battle.turn = 1
    battle.activeUnitUid = mage.uid
    mage.moved = true
    mage.acted = true

    endPlayerTurn(state)
    assert.equal(enemy.alive, false, 'Lava Geyser fire + Poison Combust must KO the enemy on turn start')
    assert.equal(enemy.hp, 0)
  }
})

test('CrownshardScene and drawCombatForecast render all 4 elemental combos without throwing', () => {
  const { state, battle, mage, cryo, enemies } = setupElementalSquadBattle(2008)
  const target = enemies[0]
  placeUnit(battle, mage, 1, 2)
  placeUnit(battle, cryo, 1, 3)
  placeUnit(battle, target, 3, 2)

  // 1. Render all 4 combo VFX events + terrain rebuild in CrownshardScene
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)
  const at: Vec3 = [target.x, target.y, target.z]
  const cells: Vec3[] = [at, [at[0] + 1.65, at[1], at[2]], [at[0] + 1.65, at[1], at[2] + 1.65]]

  const combos: readonly ElementalComboId[] = ['shatter', 'freeze', 'wildfire', 'combust']
  for (const combo of combos) {
    state.vfx.push({ kind: 'combo', combo, at, cells, bonusDamage: 16 })
    for (let i = 0; i < 30; i++) {
      stepGame(state, 1 / 60)
      scene.render(state, 1 / 60, 1280, 720)
    }
  }
  // Verify Wildfire scorching tall_grass -> darkstone re-renders scene cleanly
  setTileTerrain(battle, 3, 2, 'tall_grass')
  setTileTerrain(battle, 4, 2, 'tall_grass')
  scene.render(state, 1 / 60, 1280, 720)
  triggerElementalCombo(state, mage, 'fire', null, 3, 2)
  assert.equal(battle.cells[2][3].terrain, 'darkstone')
  for (let i = 0; i < 40; i++) {
    stepGame(state, 1 / 60)
    scene.render(state, 1 / 60, 1280, 720)
  }
  assert.ok(fake.drawn > 100)
  assert.ok(fake.maxInstances > 40)

  // 2. Render drawCombatForecast with each of the 4 elemental combos (including empty-tile Wildfire)
  const rect = { x: 12, y: 12, width: 332, height: 104 }
  const expectedBadges: string[] = []

  const scenarios: { setup: () => void; caster: typeof mage; skillIdx: number; col: number; row: number; comboId: ElementalComboId }[] = [
    {
      setup: () => { clearFlatBoard(battle); target.hp = 80; target.maxHp = 100; target.slowTurns = 2; target.poisonStacks = 0; target.burnTurns = 0 },
      caster: mage, skillIdx: 1, col: target.col, row: target.row, comboId: 'shatter'
    },
    {
      setup: () => { clearFlatBoard(battle); setTileTerrain(battle, target.col, target.row, 'ice'); target.hp = 80; target.slowTurns = 0; target.poisonStacks = 0; target.burnTurns = 0 },
      caster: cryo, skillIdx: 0, col: target.col, row: target.row, comboId: 'freeze'
    },
    {
      setup: () => { clearFlatBoard(battle); setTileTerrain(battle, target.col, target.row, 'tall_grass'); setTileTerrain(battle, target.col + 1, target.row, 'tall_grass'); target.hp = 80; target.slowTurns = 0; target.poisonStacks = 0; target.burnTurns = 0 },
      caster: mage, skillIdx: 1, col: target.col, row: target.row, comboId: 'wildfire'
    },
    {
      setup: () => { clearFlatBoard(battle); target.hp = 80; target.slowTurns = 0; target.poisonStacks = 3; target.burnTurns = 0 },
      caster: mage, skillIdx: 1, col: target.col, row: target.row, comboId: 'combust'
    }
  ]

  for (const s of scenarios) {
    s.setup()
    battle.activeUnitUid = s.caster.uid
    battle.selectedUnitUid = s.caster.uid
    battle.armedSkillIndex = null
    s.caster.acted = false
    s.caster.cooldowns = [0, 0, 0]
    assert.equal(armSkill(state, s.skillIdx), true)
    const fc: CombatForecast | null = computeCombatForecast(state, s.col, s.row)
    assert.ok(fc && fc.elementalCombo && fc.elementalCombo.id === s.comboId)
    expectedBadges.push(fc.elementalCombo.badgeText)

    const drawnTexts: string[] = []
    drawCombatForecast(fakeCanvasCtx(drawnTexts), rect, fc)
    assert.ok(
      drawnTexts.some(t => t.includes(fc.elementalCombo!.label)),
      `drawCombatForecast must render ${s.comboId} combo badge (saw: ${drawnTexts.join(', ')})`
    )
  }

  // Also test empty-tile Wildfire forecast rendering (far from all units so no unit is in the cross)
  clearFlatBoard(battle)
  placeUnit(battle, target, 6, 4)
  setTileTerrain(battle, 1, 0, 'tall_grass')
  setTileTerrain(battle, 2, 0, 'tall_grass')
  battle.activeUnitUid = mage.uid
  battle.armedSkillIndex = null
  mage.acted = false
  mage.cooldowns = [0, 0, 0]
  assert.equal(armSkill(state, 1), true)
  const emptyWildfireFc = computeCombatForecast(state, 1, 0)!
  assert.equal(emptyWildfireFc.emptyTileTarget, true)
  assert.equal(emptyWildfireFc.elementalCombo?.id, 'wildfire')
  const emptyTexts: string[] = []
  drawCombatForecast(fakeCanvasCtx(emptyTexts), rect, emptyWildfireFc)
  assert.ok(emptyTexts.some(t => t.includes('WILDFIRE')), 'Empty-tile Wildfire forecast must draw WILDFIRE callout')
  assert.equal(expectedBadges.length, 4)

  // Verify previewElementalCombo direct API returns null for non-combo cases
  assert.equal(previewElementalCombo(battle, null, target, target.col, target.row), null)
})
