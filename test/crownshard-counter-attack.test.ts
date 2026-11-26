import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import { HERO_SPECS } from '../examples/crownshard/crownshard/data.ts'
import {
  COUNTER_DAMAGE_MULTIPLIER, canCounterAttack, computeCounterDamage,
  getCounterAvoidReason, isMeleeSkillEligibleForCounter
} from '../examples/crownshard/crownshard/counter-attack.ts'
import {
  armSkill, computeCombatForecast, createInitialState, endPlayerTurn,
  getUnitByUid, refreshHighlights, selectTile, setUnitFacing, startChapterBattle, stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import {
  KO_COUNTDOWN_TURNS, gridToWorld, isUnitDowned, terrainElevation, terrainWalkable
} from '../examples/crownshard/crownshard/types.ts'
import type {
  BattleState, BattleUnit, CombatForecast, GameState, GridCell, TileTerrain
} from '../examples/crownshard/crownshard/types.ts'
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
  const [x, y, z] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = x
  unit.y = y
  unit.z = z
  unit.path = []
  unit.moveProgress = 0
}

function setActivePlayer(battle: BattleState, campaign: GameState['campaign'], unit: BattleUnit): void {
  battle.phase = 'player'
  battle.activeUnitUid = unit.uid
  battle.selectedUnitUid = unit.uid
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  battle.pendingAction = null
  battle.facingPicker = null
  unit.moved = false
  unit.acted = false
  unit.stunTurns = 0
  unit.cooldowns = [0, 0, 0]
  refreshHighlights(battle, campaign)
}

function fakeCanvasCtx() {
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
    fillText(text: string) { ops++; texts.push(String(text)) },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

test('Pure counter-attack helpers enforce eligibility, avoid reasons, and 70% damage modifiers', () => {
  const state = createInitialState(7101)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!
  const goblin = battle.units.find(u => u.enemyId === 'goblin')!
  const boneArcher = battle.units.find(u => u.enemyId === 'bone_archer')!

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  setUnitFacing(knight, 'e')
  setUnitFacing(goblin, 'w')

  // Frontal adjacent melee vs eligible melee defender
  assert.equal(canCounterAttack(battle, knight, goblin, 'front', false), true)
  assert.equal(getCounterAvoidReason(battle, knight, goblin, 'front', false), null)

  // Flank & backstab avoid counter
  assert.equal(canCounterAttack(battle, knight, goblin, 'flank', false), false)
  assert.equal(getCounterAvoidReason(battle, knight, goblin, 'flank', false), 'flank')
  assert.equal(canCounterAttack(battle, knight, goblin, 'back', false), false)
  assert.equal(getCounterAvoidReason(battle, knight, goblin, 'back', false), 'backstab')

  // Ranged attacks, non-adjacent attacks, stunned defenders, lethal hits, and ranged defenders avoid counter
  assert.equal(canCounterAttack(battle, knight, goblin, 'front', true), false)
  assert.equal(getCounterAvoidReason(battle, knight, goblin, 'front', true), 'ranged')

  placeUnit(battle, archer, 1, 2)
  assert.equal(canCounterAttack(battle, archer, goblin, 'front', false), false)
  assert.equal(getCounterAvoidReason(battle, archer, goblin, 'front', false), 'ranged')

  assert.equal(canCounterAttack(battle, knight, goblin, 'front', false, { incomingLethal: true }), false)
  assert.equal(getCounterAvoidReason(battle, knight, goblin, 'front', false, { incomingLethal: true }), 'lethal')

  assert.equal(canCounterAttack(battle, knight, goblin, 'front', false, { incomingStun: true }), false)
  assert.equal(getCounterAvoidReason(battle, knight, goblin, 'front', false, { incomingStun: true }), 'stunned')

  goblin.stunTurns = 1
  assert.equal(canCounterAttack(battle, knight, goblin, 'front', false), false)
  assert.equal(getCounterAvoidReason(battle, knight, goblin, 'front', false), 'stunned')
  goblin.stunTurns = 0

  placeUnit(battle, boneArcher, 3, 2)
  assert.equal(boneArcher.range > 1, true)
  assert.equal(canCounterAttack(battle, knight, boneArcher, 'front', false), false)
  assert.equal(getCounterAvoidReason(battle, knight, boneArcher, 'front', false), null)

  // Skill eligibility helper
  assert.equal(isMeleeSkillEligibleForCounter(HERO_SPECS.knight.skills[0]), true, 'Shield Bash is single-target melee')
  assert.equal(isMeleeSkillEligibleForCounter(HERO_SPECS.paladin.skills[0]), true, 'Radiant Smite is single-target melee')
  assert.equal(isMeleeSkillEligibleForCounter(HERO_SPECS.knight.skills[1]), false, 'Bulwark Aura deals 0 damage')
  assert.equal(isMeleeSkillEligibleForCounter(HERO_SPECS.knight.skills[2]), false, 'Crown Cleave is cross AoE')
  assert.equal(isMeleeSkillEligibleForCounter(HERO_SPECS.archer.skills[0]), false, 'Piercing Shot is ranged')
  assert.equal(isMeleeSkillEligibleForCounter(HERO_SPECS.rogue.skills[0]), false, 'Shadow Strike has range 3')

  // Counter damage scales at 70%, respects elevation, terrain DEF, empower, and shield
  placeUnit(battle, goblin, 3, 2)
  goblin.atk = 20
  goblin.empowerTurns = 0
  knight.def = 5
  knight.hp = 60
  knight.shield = 0
  const baseBasic = Math.max(4, Math.round(20 - 5 * 0.72))
  const expectedBaseCounter = Math.max(3, Math.round(baseBasic * COUNTER_DAMAGE_MULTIPLIER))
  const flatRes = computeCounterDamage(battle, goblin, knight)
  assert.equal(flatRes.normalDmg, expectedBaseCounter)
  assert.equal(flatRes.hpDamage, expectedBaseCounter)
  assert.equal(flatRes.lethalToAttacker, false)

  // High ground boosts defender counter damage
  battle.cells[2][3] = makeCell(3, 2, 'hill', 2)
  const highRes = computeCounterDamage(battle, goblin, knight)
  assert.ok(highRes.normalDmg > flatRes.normalDmg, 'High ground should increase counter damage')

  // Empower boosts defender counter damage
  battle.cells[2][3] = makeCell(3, 2, 'grass', 0)
  goblin.empowerTurns = 2
  const empRes = computeCounterDamage(battle, goblin, knight)
  assert.ok(empRes.normalDmg > flatRes.normalDmg, 'Empower should increase counter damage')
  goblin.empowerTurns = 0

  // Darkstone terrain DEF reduces counter damage & shield absorbs HP loss
  battle.cells[2][2] = makeCell(2, 2, 'darkstone', 0)
  const darkRes = computeCounterDamage(battle, goblin, knight)
  assert.ok(darkRes.normalDmg <= flatRes.normalDmg, 'Terrain DEF should reduce counter damage')

  knight.hp = 5
  knight.shield = 0
  const lethalRes = computeCounterDamage(battle, goblin, knight)
  assert.equal(lethalRes.lethalToAttacker, true)
  knight.shield = lethalRes.normalDmg
  const shieldedRes = computeCounterDamage(battle, goblin, knight)
  assert.equal(shieldedRes.shieldAbsorbed, lethalRes.normalDmg)
  assert.equal(shieldedRes.hpDamage, 0)
  assert.equal(shieldedRes.lethalToAttacker, false)
})

test('Frontal melee strike triggers deterministic Counter-Attack matching CombatForecast with VFX/floats and no recursion', () => {
  const state = createInitialState(7102)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const goblin = battle.units.find(u => u.enemyId === 'goblin')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== goblin.uid) {
      u.hp = 0
      u.alive = false
    }
  }

  knight.hp = 70
  knight.maxHp = 74
  knight.shield = 0
  knight.crit = 0
  knight.lifesteal = 0
  goblin.hp = 120
  goblin.maxHp = 120
  goblin.atk = 18
  goblin.def = 4
  goblin.shield = 0
  goblin.stunTurns = 0

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  setUnitFacing(knight, 'e')
  setUnitFacing(goblin, 'w') // Goblin faces Knight -> frontal melee hit!
  setActivePlayer(battle, state.campaign, knight)

  const fc = computeCombatForecast(state, goblin.col, goblin.row)
  assert.ok(fc, 'CombatForecast must resolve for adjacent enemy')
  assert.equal(fc.attackArc, 'front')
  assert.equal(fc.canCounter, true)
  assert.equal(fc.counterAvoidReason, null)
  assert.ok((fc.counterDmg ?? 0) > 0, 'Forecast must preview positive counter damage')
  assert.equal(fc.counterLethal, false)

  const expectedCounter = computeCounterDamage(battle, goblin, knight).normalDmg
  assert.equal(fc.counterDmg, expectedCounter)

  battle.floatingNumbers.length = 0
  state.vfx.length = 0
  state.sounds.length = 0
  const knightHpBefore = knight.hp
  const goblinHpBefore = goblin.hp

  assert.equal(selectTile(state, goblin.col, goblin.row), true)

  // Goblin took knight's hit, then countered knight ONCE (no counter-counter!)
  assert.equal(goblin.hp, goblinHpBefore - fc.normalDmg, 'Defender takes only the single incoming strike (no counter-counter)')
  assert.equal(knight.hp, knightHpBefore - expectedCounter, 'Attacker takes exact forecasted counter damage')
  assert.equal(goblin.facing, 'w', 'Defender turns toward attacker during counter')
  assert.equal(goblin.animState, 'attack', 'Defender plays melee attack animation on counter')
  assert.ok(
    battle.floatingNumbers.some(f => f.text === 'COUNTER!'),
    'Counter-attack must emit COUNTER! floating callout'
  )
  assert.ok(
    battle.floatingNumbers.some(f => f.text === `-${expectedCounter}`),
    'Counter-attack must emit damage floating number'
  )
  const counterBursts = state.vfx.filter(v => v.kind === 'burst' && v.uid === goblin.uid)
  assert.equal(counterBursts.length, 1, 'Defender must emit exactly 1 slash burst VFX (no recursion)')
  const counterImpacts = state.vfx.filter(v => v.kind === 'impact' && v.uid === knight.uid && v.attackerUid === goblin.uid)
  assert.equal(counterImpacts.length, 1, 'Attacker must receive exactly 1 counter impact VFX')
  const incomingImpacts = state.vfx.filter(v => v.kind === 'impact' && v.uid === goblin.uid)
  assert.equal(incomingImpacts.length, 1, 'Defender must receive only 1 impact VFX (no counter-counter)')
})

test('Single-target melee skill (Radiant Smite) triggers frontal counter-attack with self-shield before counter, while knockback (Shield Bash) pushes out of counter range', () => {
  const state = createInitialState(7103)
  state.campaign.heroes.push({
    uid: 'hero_paladin_counter',
    heroId: 'paladin',
    stars: 1,
    weaponUid: null,
    armorUid: null,
    relicUid: null
  })
  state.campaign.squadUids = [state.campaign.heroes[0].uid, 'hero_paladin_counter']
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const paladin = battle.units.find(u => u.heroId === 'paladin')!
  const goblin = battle.units.find(u => u.enemyId === 'goblin')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== paladin.uid && u.uid !== goblin.uid) {
      u.hp = 0
      u.alive = false
    }
  }

  // 1. Paladin Radiant Smite (single-target melee skill, no knockback): applies self-shield before frontal counter lands
  paladin.hp = 50
  paladin.maxHp = 100
  paladin.shield = 0
  paladin.crit = 0
  goblin.hp = 140
  goblin.maxHp = 140
  goblin.atk = 22
  goblin.stunTurns = 0

  placeUnit(battle, knight, 0, 0)
  placeUnit(battle, paladin, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  setUnitFacing(paladin, 'e')
  setUnitFacing(goblin, 'w')
  setActivePlayer(battle, state.campaign, paladin)

  assert.equal(armSkill(state, 0), true, 'Arm Paladin Radiant Smite (range 1, single)')
  const fc = computeCombatForecast(state, goblin.col, goblin.row)
  assert.ok(fc)
  assert.equal(fc.canCounter, true)
  const expectedCounterDmg = fc.counterDmg ?? 0
  assert.ok(expectedCounterDmg > 0)

  const shieldGain = HERO_SPECS.paladin.skills[0].shieldAmount
  const healGain = HERO_SPECS.paladin.skills[0].healAmount
  assert.equal(shieldGain, 8)
  const expectedAbsorbed = Math.min(shieldGain, expectedCounterDmg)
  const expectedHpLoss = Math.max(0, expectedCounterDmg - expectedAbsorbed)

  assert.equal(selectTile(state, goblin.col, goblin.row), true)
  assert.equal(paladin.shield, shieldGain - expectedAbsorbed, 'Radiant Smite self-shield must absorb counter damage')
  assert.equal(paladin.hp, Math.min(paladin.maxHp, 50 + healGain) - expectedHpLoss, 'Remaining counter damage applies to HP after self-heal & shield')

  // 2. Knight Shield Bash (knockback 1): pushes goblin out of melee reach, avoiding counter-attack in BOTH forecast & execution
  knight.hp = 50
  knight.shield = 0
  goblin.hp = 120
  goblin.stunTurns = 0
  placeUnit(battle, paladin, 0, 0)
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  setUnitFacing(knight, 'e')
  setUnitFacing(goblin, 'w')
  setActivePlayer(battle, state.campaign, knight)

  assert.equal(armSkill(state, 0), true, 'Arm Knight Shield Bash (knockback 1)')
  const fcBash = computeCombatForecast(state, goblin.col, goblin.row)
  assert.ok(fcBash)
  assert.equal(fcBash.canCounter, false, 'Shield Bash pushing enemy out of melee range avoids Counter-Attack in forecast')
  assert.equal(selectTile(state, goblin.col, goblin.row), true)
  assert.equal(goblin.col, 4, 'Goblin was knocked back 1 tile')
  assert.equal(knight.hp, 50, 'Knight takes 0 counter damage when knockback pushes foe out of reach')
  assert.equal(knight.shield, HERO_SPECS.knight.skills[0].shieldAmount, 'Knight keeps full Shield Bash shield')
})

test('Flanking and backstabbing melee hits avoid Counter-Attack in both CombatForecast and execution', () => {
  const state = createInitialState(7104)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const goblin = battle.units.find(u => u.enemyId === 'goblin')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== goblin.uid) {
      u.hp = 0
      u.alive = false
    }
  }

  knight.hp = 65
  knight.shield = 0
  goblin.hp = 150
  goblin.maxHp = 150
  goblin.atk = 20

  // 1. Flank attack: Goblin faces North, Knight strikes from West (col 2 -> col 3)
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  setUnitFacing(goblin, 'n')
  setActivePlayer(battle, state.campaign, knight)

  const flankFc = computeCombatForecast(state, goblin.col, goblin.row)
  assert.ok(flankFc)
  assert.equal(flankFc.attackArc, 'flank')
  assert.equal(flankFc.canCounter, false)
  assert.equal(flankFc.counterDmg, 0)
  assert.equal(flankFc.counterAvoidReason, 'flank')

  battle.floatingNumbers.length = 0
  assert.equal(selectTile(state, goblin.col, goblin.row), true)
  assert.equal(knight.hp, 65, 'Flanking melee strike must avoid counter damage')
  assert.equal(battle.floatingNumbers.some(f => f.text === 'COUNTER!'), false)

  // 2. Backstab attack: Goblin faces East, Knight strikes from West (behind Goblin!)
  setUnitFacing(goblin, 'e')
  setActivePlayer(battle, state.campaign, knight)

  const backFc = computeCombatForecast(state, goblin.col, goblin.row)
  assert.ok(backFc)
  assert.equal(backFc.attackArc, 'back')
  assert.equal(backFc.canCounter, false)
  assert.equal(backFc.counterDmg, 0)
  assert.equal(backFc.counterAvoidReason, 'backstab')

  battle.floatingNumbers.length = 0
  assert.equal(selectTile(state, goblin.col, goblin.row), true)
  assert.equal(knight.hp, 65, 'Backstabbing melee strike must avoid counter damage')
  assert.equal(battle.floatingNumbers.some(f => f.text === 'COUNTER!'), false)
})

test('Ranged attacks, stunned defenders, ranged defenders, and lethal hits all avoid Counter-Attack', () => {
  // 1. Ranged attack (dist >= 2) against frontal melee Goblin
  {
    const state = createInitialState(7105)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    const archer = battle.units.find(u => u.heroId === 'archer')!
    const goblin = battle.units.find(u => u.enemyId === 'goblin')!
    for (const u of battle.units) {
      if (u.uid !== archer.uid && u.uid !== goblin.uid) { u.hp = 0; u.alive = false }
    }
    archer.hp = 45
    goblin.hp = 120
    goblin.maxHp = 120
    placeUnit(battle, archer, 1, 2)
    placeUnit(battle, goblin, 3, 2)
    setUnitFacing(goblin, 'w')
    setActivePlayer(battle, state.campaign, archer)

    const fc = computeCombatForecast(state, goblin.col, goblin.row)
    assert.ok(fc)
    assert.equal(fc.canCounter, false)
    assert.equal(fc.counterDmg, 0)
    assert.equal(fc.counterAvoidReason, 'ranged')

    assert.equal(selectTile(state, goblin.col, goblin.row), true)
    assert.equal(archer.hp, 45, 'Ranged attack at dist >= 2 must avoid counter-attack')
  }

  // 2. Frontal melee hit against Stunned melee defender
  {
    const state = createInitialState(7106)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    const knight = battle.units.find(u => u.heroId === 'knight')!
    const goblin = battle.units.find(u => u.enemyId === 'goblin')!
    for (const u of battle.units) {
      if (u.uid !== knight.uid && u.uid !== goblin.uid) { u.hp = 0; u.alive = false }
    }
    knight.hp = 60
    goblin.hp = 120
    goblin.maxHp = 120
    goblin.stunTurns = 1
    placeUnit(battle, knight, 2, 2)
    placeUnit(battle, goblin, 3, 2)
    setUnitFacing(goblin, 'w')
    setActivePlayer(battle, state.campaign, knight)

    const fc = computeCombatForecast(state, goblin.col, goblin.row)
    assert.ok(fc)
    assert.equal(fc.canCounter, false)
    assert.equal(fc.counterAvoidReason, 'stunned')

    assert.equal(selectTile(state, goblin.col, goblin.row), true)
    assert.equal(knight.hp, 60, 'Stunned defender must not counter-attack')
  }

  // 3. Frontal melee hit against Ranged defender (Bone Archer, range > 1)
  {
    const state = createInitialState(7107)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    const knight = battle.units.find(u => u.heroId === 'knight')!
    const boneArcher = battle.units.find(u => u.enemyId === 'bone_archer')!
    for (const u of battle.units) {
      if (u.uid !== knight.uid && u.uid !== boneArcher.uid) { u.hp = 0; u.alive = false }
    }
    knight.hp = 60
    boneArcher.hp = 120
    boneArcher.maxHp = 120
    assert.ok(boneArcher.range > 1)
    placeUnit(battle, knight, 2, 2)
    placeUnit(battle, boneArcher, 3, 2)
    setUnitFacing(boneArcher, 'w')
    setActivePlayer(battle, state.campaign, knight)

    const fc = computeCombatForecast(state, boneArcher.col, boneArcher.row)
    assert.ok(fc)
    assert.equal(fc.canCounter, false)
    assert.equal(fc.counterDmg, 0)
    assert.equal(fc.counterAvoidReason, null)

    assert.equal(selectTile(state, boneArcher.col, boneArcher.row), true)
    assert.equal(knight.hp, 60, 'Ranged defenders must not melee counter-attack')
  }

  // 4. Lethal frontal melee hit that KOs the melee defender
  {
    const state = createInitialState(7108)
    const battle = startChapterBattle(state, 0)
    flattenArena(battle, 'grass', 0)
    const knight = battle.units.find(u => u.heroId === 'knight')!
    const goblins = battle.units.filter(u => u.team === 'enemy')
    const targetGoblin = goblins.find(u => u.enemyId === 'goblin')!
    const spareEnemy = goblins.find(u => u.uid !== targetGoblin.uid)!
    for (const u of battle.units) {
      if (u.uid !== knight.uid && u.uid !== targetGoblin.uid && u.uid !== spareEnemy.uid) {
        u.hp = 0
        u.alive = false
      }
    }
    knight.hp = 60
    targetGoblin.hp = 5
    placeUnit(battle, knight, 2, 2)
    placeUnit(battle, targetGoblin, 3, 2)
    placeUnit(battle, spareEnemy, battle.cols - 1, battle.rows - 1)
    setUnitFacing(targetGoblin, 'w')
    setActivePlayer(battle, state.campaign, knight)

    const fc = computeCombatForecast(state, targetGoblin.col, targetGoblin.row)
    assert.ok(fc)
    assert.equal(fc.lethalNormal, true)
    assert.equal(fc.canCounter, false)
    assert.equal(fc.counterAvoidReason, 'lethal')

    assert.equal(selectTile(state, targetGoblin.col, targetGoblin.row), true)
    assert.equal(targetGoblin.alive, false)
    assert.equal(knight.hp, 60, 'KOd defender must not counter-attack')
  }
})

test('Lethal Counter-Attack downs attacking hero into 3-turn Downed Window and advances turn without soft-locking', () => {
  const state = createInitialState(7109)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!
  const goblin = battle.units.find(u => u.enemyId === 'goblin')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== archer.uid && u.uid !== goblin.uid) {
      u.hp = 0
      u.alive = false
    }
  }

  knight.hp = 4
  knight.shield = 0
  knight.lifesteal = 0
  knight.crit = 0
  archer.hp = 50
  goblin.hp = 140
  goblin.maxHp = 140
  goblin.atk = 24
  goblin.stunTurns = 0

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  placeUnit(battle, archer, 0, 0)
  setUnitFacing(knight, 'e')
  setUnitFacing(goblin, 'w')
  setActivePlayer(battle, state.campaign, knight)

  // Forecast must warn that the counter is LETHAL!
  const fc = computeCombatForecast(state, goblin.col, goblin.row)
  assert.ok(fc)
  assert.equal(fc.canCounter, true)
  assert.equal(fc.counterLethal, true)
  assert.ok((fc.counterDmg ?? 0) >= knight.hp)

  // Execute the suicidal frontal strike
  assert.equal(selectTile(state, goblin.col, goblin.row), true)

  // Knight must enter the 3-turn Downed Window, battle must continue, and active unit must advance cleanly!
  assert.equal(knight.hp, 0)
  assert.equal(knight.alive, false)
  assert.equal(knight.downed, true)
  assert.equal(knight.koCountdown, KO_COUNTDOWN_TURNS)
  assert.equal(isUnitDowned(knight), true)
  assert.equal(battle.phase === 'victory' || battle.phase === 'defeat', false, 'Battle continues while Archer still stands')
  assert.notEqual(battle.activeUnitUid, knight.uid, 'Turn must advance off the downed hero immediately (no soft-lock)')
  assert.ok(getUnitByUid(battle, battle.activeUnitUid), 'Next active unit must be alive and valid')

  // Verify the battle loop continues stepping cleanly to Archer's turn without soft-lock
  let guard = 0
  while (battle.phase === 'enemy' && guard++ < 400) {
    stepGame(state, STEP)
  }
  assert.equal(battle.phase, 'player', 'Battle must cleanly reach next player hero turn')
  assert.equal(battle.activeUnitUid, archer.uid)
  endPlayerTurn(state)
})

test('Enemy frontal melee strike triggers Hero counter-attack symmetrically', () => {
  const state = createInitialState(7110)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle, 'grass', 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const goblin = battle.units.find(u => u.enemyId === 'goblin')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== goblin.uid) {
      u.hp = 0
      u.alive = false
    }
  }

  knight.hp = 74
  knight.shield = 0
  knight.atk = 18
  knight.stunTurns = 0
  goblin.hp = 90
  goblin.maxHp = 90
  goblin.atk = 12
  goblin.def = 2
  goblin.shield = 0

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, goblin, 3, 2)
  setUnitFacing(knight, 'e') // Knight faces Goblin -> frontal!
  setUnitFacing(goblin, 'w')

  const expectedHeroCounter = computeCounterDamage(battle, knight, goblin).normalDmg
  assert.ok(expectedHeroCounter > 0)

  // Hand turn directly to Goblin
  battle.phase = 'enemy'
  battle.activeUnitUid = goblin.uid
  battle.enemyActedThisTurn = false
  battle.enemyDelay = 0.01
  battle.floatingNumbers.length = 0

  for (let i = 0; i < 60; i++) {
    stepGame(state, STEP)
    if (battle.enemyActedThisTurn) break
  }

  assert.equal(battle.enemyActedThisTurn, true)
  assert.equal(goblin.hp, 90 - expectedHeroCounter, 'Knight must counter-attack Goblin on a frontal melee hit')
  assert.ok(battle.floatingNumbers.some(f => f.text === 'COUNTER!'))
})

test('drawCombatForecast renders COUNTER -N HP, COUNTER LETHAL!, and NO COUNTER (FLANK/BACKSTAB) cleanly', () => {
  const baseFc: CombatForecast = {
    mode: 'strike',
    actionName: 'Strike',
    skillIndex: null,
    attackerUid: 'hero_1',
    attackerName: 'Sir Aldric',
    attackerHeroId: 'knight',
    attackerStars: 1,
    targetUid: 'enemy_1',
    targetName: 'Ashen Goblin',
    targetTeam: 'enemy',
    targetEnemyId: 'goblin',
    targetCol: 3,
    targetRow: 2,
    approachCol: 2,
    approachRow: 2,
    requiresMove: false,
    path: [],
    normalDmg: 16,
    critDmg: 25,
    critChance: 0.1,
    healAmount: 0,
    shieldAmount: 0,
    selfShield: 0,
    highGround: false,
    elevationDiff: 0,
    coverBonus: 0,
    terrainDefBonus: 0,
    empowered: false,
    attackArc: 'front',
    isOffensive: true,
    isRevive: false,
    friendlyFire: false,
    friendlyFireCount: 0,
    emptyTileTarget: false,
    ignoreArmor: 0,
    aoeTargets: 1,
    targetHpBefore: 38,
    targetMaxHp: 38,
    targetShieldBefore: 0,
    targetHpAfterNormal: 22,
    targetHpAfterCrit: 13,
    lethalNormal: false,
    lethalCrit: false,
    alternatives: []
  }

  // 1. Standard frontal counter warning (expanded height)
  {
    const canvas = fakeCanvasCtx()
    drawCombatForecast(canvas.ctx, { x: 10, y: 10, width: 332, height: 126 }, {
      ...baseFc,
      canCounter: true,
      counterDmg: 9,
      counterLethal: false,
      counterAvoidReason: null
    })
    assert.ok(canvas.ops > 10)
    assert.ok(canvas.texts.some(t => t.includes('COUNTER -9 HP')), `Expected COUNTER -9 HP badge, got: ${canvas.texts.join(', ')}`)
  }

  // 2. Lethal counter warning (both expanded & compact fallback heights)
  {
    const { ctx, texts } = fakeCanvasCtx()
    drawCombatForecast(ctx, { x: 10, y: 10, width: 332, height: 126 }, {
      ...baseFc,
      canCounter: true,
      counterDmg: 14,
      counterLethal: true,
      counterAvoidReason: null
    })
    assert.ok(texts.some(t => t.includes('COUNTER LETHAL!')), `Expected COUNTER LETHAL! badge, got: ${texts.join(', ')}`)

    const compact = fakeCanvasCtx()
    drawCombatForecast(compact.ctx, { x: 10, y: 10, width: 300, height: 104 }, {
      ...baseFc,
      canCounter: true,
      counterDmg: 14,
      counterLethal: true,
      counterAvoidReason: null
    }, { compact: true })
    assert.ok(compact.texts.some(t => t.includes('COUNTER LETHAL!')))
  }

  // 3. Flank & Backstab avoidance badges
  {
    const flank = fakeCanvasCtx()
    drawCombatForecast(flank.ctx, { x: 10, y: 10, width: 332, height: 126 }, {
      ...baseFc,
      attackArc: 'flank',
      canCounter: false,
      counterDmg: 0,
      counterLethal: false,
      counterAvoidReason: 'flank'
    })
    assert.ok(flank.texts.some(t => t.includes('NO COUNTER (FLANK)')))

    const back = fakeCanvasCtx()
    drawCombatForecast(back.ctx, { x: 10, y: 10, width: 332, height: 126 }, {
      ...baseFc,
      attackArc: 'back',
      canCounter: false,
      counterDmg: 0,
      counterLethal: false,
      counterAvoidReason: 'backstab'
    })
    assert.ok(back.texts.some(t => t.includes('NO COUNTER (BACKSTAB)')))
  }
})
