import assert from 'node:assert/strict'
import test from 'node:test'
import { EQUIPMENT_BY_ID, HERO_LIST, TACTIC_LIST } from '../examples/crownshard/crownshard/data.ts'
import {
  CHAMPION_KO_CT_SURGE, EQUIP_EFFECTS, HERO_PASSIVES, MAX_TACTIC_DECK, MIN_TACTIC_DECK,
  SHIELD_WALL_DEF_BONUS, autoBuildTacticDeck, computeCombatForecast, computeCounterDamage,
  computeCoverBonus, computeHeroStats, computeMoveTiles, computeShieldWallDefBonus,
  computeTacticDeckCurve, computeTargetTiles, createInitialState, effectiveAttackRange,
  effectiveSpeed, endPlayerTurn, equipItem, findGridPath, getActiveTacticDeckUids,
  getEquipEffect, getHeroPassive, getUnitByUid, loadSave, persistSave, selectHeroByUid,
  selectTile, serializeSave, startChapterBattle, stepGame, toggleTacticInDeck,
  unitTerrainMoveCost, armSkill
} from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld, terrainElevation } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, GridCell, HeroClassId, TileTerrain } from '../examples/crownshard/crownshard/types.ts'
import {
  drawEquipCard, drawPassiveBanner, drawTacticDeckCard, drawTacticDeckHeader, drawUnitCard
} from '../examples/crownshard/crownshard/ui-art.ts'
import { STEP } from '../packages/ridgetop/framework/index.ts'

function makeCell(col: number, row: number, terrain: TileTerrain = 'grass', heightLevel = 0): GridCell {
  return {
    col,
    row,
    terrain,
    heightLevel,
    elevation: terrainElevation(terrain, heightLevel),
    walkable: terrain !== 'water' && terrain !== 'lava' && terrain !== 'pillar' && terrain !== 'void' && terrain !== 'barricade'
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
  unit.col = col
  unit.row = row
  const cell = battle.cells[row][col]
  const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.x = wx
  unit.y = wy
  unit.z = wz
}

function makeMockCanvasCtx(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} }
  const ctx: Record<string, unknown> = {
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    rect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    clip() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    translate() {},
    rotate() {},
    scale() {},
    fillText() {},
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(text: string) { return { width: text.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad },
    globalAlpha: 1,
    fillStyle: '#fff',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '12px sans-serif',
    textAlign: 'left',
    textBaseline: 'middle',
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    imageSmoothingEnabled: true
  }
  return ctx as unknown as CanvasRenderingContext2D
}

function makeMemoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) }
  }
}

test('All 8 Hero Innate Passives are defined in HERO_PASSIVES with complete metadata', () => {
  const allHeroIds: readonly HeroClassId[] = [
    'knight', 'archer', 'rogue', 'cleric', 'cryomancer', 'mage', 'paladin', 'champion'
  ]
  assert.equal(HERO_LIST.length, 8)
  for (const id of allHeroIds) {
    const passive = getHeroPassive(id)
    assert.ok(passive, `Hero ${id} must define an innate passive`)
    assert.equal(passive.heroId, id)
    assert.ok(passive.name.length > 0)
    assert.ok(passive.desc.length > 0)
    assert.ok(passive.shortLabel.length > 0)
    assert.equal(HERO_PASSIVES[id], passive)
  }
})

test('Knight Shield Wall grants +3 DEF to adjacent living allies (and not Knight himself) in forecast & live damage', () => {
  const state = createInitialState(3001)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const mage = battle.units.find(u => u.heroId === 'mage')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== mage.uid && u.uid !== enemy.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, mage, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  mage.hp = 80
  mage.maxHp = 80
  mage.shield = 0
  mage.facing = 'e'
  enemy.atk = 22
  enemy.crit = 0

  // Adjacent living Knight buffs Mage (+3 DEF) but NOT himself
  assert.equal(computeShieldWallDefBonus(battle, mage), SHIELD_WALL_DEF_BONUS)
  assert.equal(computeShieldWallDefBonus(battle, knight), 0)

  // Measure counter damage against Mage with Knight adjacent vs far away
  const withWall = computeCounterDamage(battle, enemy, mage)
  placeUnit(battle, knight, 0, 0)
  assert.equal(computeShieldWallDefBonus(battle, mage), 0)
  const withoutWall = computeCounterDamage(battle, enemy, mage)
  assert.ok(withWall.normalDmg < withoutWall.normalDmg, `Shield Wall (${withWall.normalDmg}) must reduce damage vs unguarded (${withoutWall.normalDmg})`)

  // Downed Knight does NOT project Shield Wall
  placeUnit(battle, knight, 1, 2)
  knight.alive = false
  assert.equal(computeShieldWallDefBonus(battle, mage), 0)
})

test('Archer Eagle Eyrie grants +1 Range on high ground (H1+) and ignores enemy Cover DEF', () => {
  const state = createInitialState(3002)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle, 'grass', 0)

  const archer = battle.units.find(u => u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== archer.uid && u.uid !== enemy.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  archer.range = 3
  archer.crit = 0
  archer.acted = false
  enemy.hp = 100
  enemy.maxHp = 100
  enemy.shield = 0
  enemy.facing = 'w'

  // On flat ground (H0): base range 3, Cover applies normally
  placeUnit(battle, archer, 1, 2)
  placeUnit(battle, enemy, 4, 2)
  battle.cells[2][4] = makeCell(4, 2, 'tall_grass', 0)
  assert.equal(effectiveAttackRange(battle, 1, 2, 4, 2, 3, archer), 3)
  assert.equal(computeCoverBonus(battle, 1, 2, 4, 2, archer), 3)

  // Place Archer on H1 high ground, enemy also on H1 (equal height diff = 0, but Archer is on H1+!)
  battle.cells[2][1] = makeCell(1, 2, 'hill', 1)
  battle.cells[2][5] = makeCell(5, 2, 'tall_grass', 1)
  placeUnit(battle, archer, 1, 2)
  placeUnit(battle, enemy, 5, 2)

  // Dist = 4: normally out of range at same elevation (diff = 0), but Eagle Eyrie adds +1 Range on H1+!
  assert.equal(effectiveAttackRange(battle, 1, 2, 5, 2, 3, archer), 4)
  assert.equal(computeCoverBonus(battle, 1, 2, 5, 2, archer), 0, 'Eagle Eyrie must ignore enemy Cover DEF on H1+')

  battle.phase = 'player'
  battle.activeUnitUid = archer.uid
  selectHeroByUid(state, archer.uid)
  const targets = computeTargetTiles(battle, archer, -1)
  assert.equal(targets.some(t => t.col === 5 && t.row === 2), true, 'Archer on H1 must reach dist 4 on H1 via Eagle Eyrie')

  const fc = computeCombatForecast(state, 5, 2)!
  assert.ok(fc)
  assert.equal(fc.coverBonus, 0, 'CombatForecast must report 0 coverBonus for high-ground Archer')
  const hpBefore = enemy.hp
  assert.equal(selectTile(state, 5, 2), true)
  assert.equal(hpBefore - enemy.hp, fc.normalDmg, 'Live damage must match Eagle Eyrie forecast')
})

test('Rogue Shadow Step grants +20% Backstab crit chance on top of base Backstab crit', () => {
  const state = createInitialState(3003)
  state.campaign.heroes = [
    { uid: 'h_rogue', heroId: 'rogue', stars: 1, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'h_knight', heroId: 'knight', stars: 1, weaponUid: null, armorUid: null, relicUid: null }
  ]
  state.campaign.squadUids = ['h_rogue', 'h_knight']
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const rogue = battle.units.find(u => u.heroId === 'rogue')!
  const knight = battle.units.find(u => u.heroId === 'knight')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== rogue.uid && u.uid !== knight.uid && u.uid !== enemy.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  rogue.crit = 0.25
  knight.crit = 0.25
  placeUnit(battle, enemy, 3, 2)
  enemy.facing = 'e' // Facing east, so attacking from west (2, 2) is Backstab!

  // Knight backstab: 0.25 base + 0.20 backstab = 0.45
  placeUnit(battle, rogue, 0, 0)
  placeUnit(battle, knight, 2, 2)
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  knight.acted = false
  selectHeroByUid(state, knight.uid)
  const fcKnight = computeCombatForecast(state, 3, 2)!
  assert.equal(fcKnight.attackArc, 'back')
  assert.ok(Math.abs(fcKnight.critChance - 0.45) < 1e-6, `Expected Knight backstab crit 0.45, got ${fcKnight.critChance}`)

  // Rogue backstab: 0.25 base + 0.20 backstab + 0.20 Shadow Step = 0.65!
  placeUnit(battle, knight, 0, 0)
  placeUnit(battle, rogue, 2, 2)
  battle.activeUnitUid = rogue.uid
  rogue.acted = false
  selectHeroByUid(state, rogue.uid)
  const fcRogue = computeCombatForecast(state, 3, 2)!
  assert.equal(fcRogue.attackArc, 'back')
  assert.ok(Math.abs(fcRogue.critChance - 0.65) < 1e-6, `Expected Rogue backstab crit 0.65, got ${fcRogue.critChance}`)
})

test('Cleric Overflowing Grace converts excess healing into Shield up to 50% target maxHp', () => {
  const state = createInitialState(3004)
  state.campaign.heroes = [
    { uid: 'h_cleric', heroId: 'cleric', stars: 1, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'h_knight', heroId: 'knight', stars: 1, weaponUid: null, armorUid: null, relicUid: null }
  ]
  state.campaign.squadUids = ['h_cleric', 'h_knight']
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const cleric = battle.units.find(u => u.heroId === 'cleric')!
  const knight = battle.units.find(u => u.heroId === 'knight')!
  placeUnit(battle, cleric, 1, 2)
  placeUnit(battle, knight, 2, 2)

  // Knight is at full HP (maxHp = 74 -> 50% cap = 37), 0 shield.
  // Sunbeam Mend heals 28 + 8 base Shield -> 28 overheal converts into Shield -> total 8 + 28 = 36 (<= 37 cap)
  knight.hp = knight.maxHp
  knight.shield = 0
  battle.phase = 'player'
  battle.activeUnitUid = cleric.uid
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  selectHeroByUid(state, cleric.uid)
  assert.equal(armSkill(state, 0), true)

  const fc = computeCombatForecast(state, 2, 2)!
  assert.ok(fc)
  assert.equal(fc.shieldAmount, 36, 'Forecast must include 8 base Shield + 28 Overflowing Grace overheal Shield')

  assert.equal(selectTile(state, 2, 2), true)
  assert.equal(knight.shield, 36, 'Live Sunbeam Mend overheal must convert into Shield matching forecast')

  // Casting again at 36 shield caps overheal conversion at 50% maxHp (37):
  // base shield (8) already pushes shield past 37 (36+8=44), so overheal adds 0 extra beyond base shield
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  selectHeroByUid(state, cleric.uid)
  assert.equal(armSkill(state, 0), true)
  const fcCapped = computeCombatForecast(state, 2, 2)!
  assert.equal(fcCapped.shieldAmount, 8, 'Overflowing Grace must not add overheal Shield past 50% maxHp cap')
})

test('Cryomancer Glacial Stride ignores Snow rough terrain cost (1 vs 2) and deals +20% DMG vs Slowed foes', () => {
  const state = createInitialState(3005)
  state.campaign.heroes = [
    { uid: 'h_cryo', heroId: 'cryomancer', stars: 1, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'h_mage', heroId: 'mage', stars: 1, weaponUid: null, armorUid: null, relicUid: null }
  ]
  state.campaign.squadUids = ['h_cryo', 'h_mage']
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle, 'snow', 0)

  const cryo = battle.units.find(u => u.heroId === 'cryomancer')!
  const mage = battle.units.find(u => u.heroId === 'mage')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== cryo.uid && u.uid !== mage.uid && u.uid !== enemy.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  assert.equal(unitTerrainMoveCost(cryo, 'snow'), 1)
  assert.equal(unitTerrainMoveCost(mage, 'snow'), 2)

  // With move = 3 on snow: Cryomancer can travel 3 snow tiles, Mage can only travel 1 snow tile!
  cryo.move = 3
  cryo.moved = false
  mage.move = 3
  mage.moved = false
  placeUnit(battle, cryo, 1, 2)
  placeUnit(battle, mage, 1, 4)
  placeUnit(battle, enemy, 5, 2)

  const cryoMoves = computeMoveTiles(battle, cryo)
  const mageMoves = computeMoveTiles(battle, mage)
  assert.equal(cryoMoves.some(t => t.col === 4 && t.row === 2), true, 'Cryomancer must move 3 tiles across Snow')
  assert.equal(mageMoves.some(t => t.col === 3 && t.row === 4), false, 'Mage cannot move 2 tiles across Snow with move 3')
  assert.equal(findGridPath(battle, cryo, 4, 2).length, 3, 'findGridPath must respect Cryomancer Snow cost 1')

  // +20% damage vs Slowed targets (forecast & live!)
  cryo.range = 4
  cryo.crit = 0
  cryo.acted = false
  enemy.hp = 120
  enemy.maxHp = 120
  enemy.shield = 0
  enemy.slowTurns = 0
  battle.phase = 'player'
  battle.activeUnitUid = cryo.uid
  selectHeroByUid(state, cryo.uid)
  const fcNormal = computeCombatForecast(state, 5, 2)!

  enemy.slowTurns = 2
  const fcSlowed = computeCombatForecast(state, 5, 2)!
  assert.ok(fcSlowed.normalDmg > fcNormal.normalDmg, `Cryomancer vs Slowed (${fcSlowed.normalDmg}) must exceed normal (${fcNormal.normalDmg})`)

  const hpBefore = enemy.hp
  assert.equal(selectTile(state, 5, 2), true)
  assert.equal(hpBefore - enemy.hp, fcSlowed.normalDmg, 'Live Cryomancer damage vs Slowed must match forecast')
})

test('Mage Arcane Conduit refunds +1 AP and splashes 20% magic DMG to 1 adjacent enemy on skill kill', () => {
  const state = createInitialState(3006)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const mage = battle.units.find(u => u.heroId === 'mage')!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  assert.ok(enemies.length >= 2)
  const target = enemies[0]
  const bystander = enemies[1]
  for (const u of battle.units) {
    if (u.uid !== mage.uid && u.uid !== target.uid && u.uid !== bystander.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  placeUnit(battle, mage, 1, 2)
  placeUnit(battle, target, 3, 2)
  placeUnit(battle, bystander, 4, 2) // Adjacent to target!
  target.hp = 5
  target.shield = 0
  bystander.hp = 50
  bystander.maxHp = 50
  bystander.shield = 0

  battle.phase = 'player'
  battle.activeUnitUid = mage.uid
  battle.ap = 1
  battle.maxAp = 4
  mage.acted = false
  mage.crit = 0
  mage.cooldowns = [0, 0, 0]
  selectHeroByUid(state, mage.uid)
  assert.equal(armSkill(state, 0), true) // Arcane Bolt (single target)

  const fc = computeCombatForecast(state, 3, 2)!
  const expectedSplash = Math.max(4, Math.round(fc.normalDmg * 0.20))

  assert.equal(selectTile(state, 3, 2), true)
  assert.equal(target.alive, false, 'Arcane Bolt must KO the low-HP target')
  assert.equal(battle.ap, 2, 'Arcane Conduit must refund +1 AP on skill KO')
  assert.equal(bystander.hp, 50 - expectedSplash, `Arcane Conduit must splash ${expectedSplash} magic DMG to adjacent foe`)
})

test('Paladin Vengeful Aegis boosts frontal shielded Counter-Attack by +30% and grants +4 Shield', () => {
  const state = createInitialState(3007)
  state.campaign.heroes = [
    { uid: 'h_paladin', heroId: 'paladin', stars: 1, weaponUid: null, armorUid: null, relicUid: null }
  ]
  state.campaign.squadUids = ['h_paladin']
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const paladin = battle.units.find(u => u.heroId === 'paladin')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== paladin.uid && u.uid !== enemy.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  placeUnit(battle, paladin, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  paladin.facing = 'e' // Frontal melee hit!
  paladin.hp = 88
  paladin.maxHp = 88
  paladin.atk = 22
  paladin.shield = 20 // Has shield to block damage!
  enemy.facing = 'w'
  enemy.hp = 90
  enemy.maxHp = 90
  enemy.shield = 0
  enemy.atk = 14
  enemy.def = 2
  enemy.range = 1
  enemy.crit = 0

  const baseCounterDmg = computeCounterDamage(battle, paladin, enemy).normalDmg
  const boostedCounterDmg = computeCounterDamage(battle, paladin, enemy, { counterMul: 1.30 }).normalDmg
  assert.ok(boostedCounterDmg > baseCounterDmg, `Vengeful Aegis counter (${boostedCounterDmg}) must exceed base (${baseCounterDmg})`)

  // Let enemy execute its frontal melee turn against shielded Paladin!
  battle.phase = 'enemy'
  battle.activeUnitUid = enemy.uid
  battle.enemyActedThisTurn = false
  battle.enemyDelay = 0.01
  const enemyHpBefore = enemy.hp
  for (let i = 0; i < 6; i++) stepGame(state, STEP)

  assert.equal(enemyHpBefore - enemy.hp, boostedCounterDmg, 'Shielded Paladin must deal +30% Vengeful Aegis counter damage')
  // Paladin had 20 shield, absorbed enemy hit (e.g. ~8), then gained +4 Shield on counter!
  assert.ok(paladin.shield > 20 - 14, 'Paladin must receive +4 bonus Shield on Vengeful Aegis counter')
})

test('Champion Relentless Momentum grants Empower and +25 CT surge on KO', () => {
  const state = createInitialState(3008)
  state.campaign.heroes = [
    { uid: 'h_champ', heroId: 'champion', stars: 1, weaponUid: null, armorUid: null, relicUid: null }
  ]
  state.campaign.squadUids = ['h_champ']
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const champ = battle.units.find(u => u.heroId === 'champion')!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  const victim = enemies[0]
  const survivor = enemies[1]
  for (const u of battle.units) {
    if (u.uid !== champ.uid && u.uid !== victim.uid && u.uid !== survivor.uid) {
      u.alive = false
      u.hp = 0
    }
  }

  placeUnit(battle, champ, 2, 2)
  placeUnit(battle, victim, 3, 2)
  placeUnit(battle, survivor, 6, 4)
  victim.hp = 5
  victim.shield = 0
  champ.empowerTurns = 0
  champ.ct = 100
  champ.acted = false
  battle.phase = 'player'
  battle.activeUnitUid = champ.uid
  selectHeroByUid(state, champ.uid)

  assert.equal(selectTile(state, 3, 2), true)
  assert.equal(victim.alive, false)
  assert.ok(champ.empowerTurns >= 1, 'Champion KO must grant Empower')
  assert.equal(champ.ct, 100 + CHAMPION_KO_CT_SURGE, 'Champion KO must grant +25 CT surge')
})

test('Equipment Special Effects trigger accurately in stats, movement, combat forecast, and live execution', () => {
  // 1. Swift Boots: +1 Jump in computeHeroStats & Snow move cost = 1
  const state = createInitialState(3010)
  const knightCard = state.campaign.heroes[0]
  const baseStats = computeHeroStats(state.campaign, knightCard)
  state.campaign.equipment.push(
    { uid: 'eq_boots', equipId: 'swift_boots', slot: 'relic' },
    { uid: 'eq_frost', equipId: 'frostguard_plate', slot: 'armor' },
    { uid: 'eq_blood', equipId: 'blood_amulet', slot: 'relic' },
    { uid: 'eq_ember', equipId: 'ember_wand', slot: 'weapon' },
    { uid: 'eq_runed', equipId: 'runed_mail', slot: 'armor' },
    { uid: 'eq_crown', equipId: 'solis_crownblade', slot: 'weapon' },
    { uid: 'eq_aegis', equipId: 'aegis_of_dawn', slot: 'armor' },
    { uid: 'eq_heart', equipId: 'heart_of_solis', slot: 'relic' },
    { uid: 'eq_eagle', equipId: 'eagle_charm', slot: 'relic' }
  )
  assert.equal(equipItem(state, knightCard.uid, 'eq_boots'), true)
  const bootedStats = computeHeroStats(state.campaign, knightCard)
  assert.equal(bootedStats.jump, baseStats.jump + 1, 'Gale Striders (swift_boots) must grant +1 Jump')

  const battle = startChapterBattle(state, 0)
  flattenBoard(battle, 'snow', 0)
  const knight = battle.units.find(u => u.heroId === 'knight')!
  const mage = battle.units.find(u => u.heroId === 'mage')!
  const archer = battle.units.find(u => u.heroId === 'archer')!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  const foe1 = enemies[0]
  const foe2 = enemies[1]
  for (const u of battle.units) {
    if (![knight.uid, mage.uid, archer.uid, foe1.uid, foe2.uid].includes(u.uid)) {
      u.alive = false
      u.hp = 0
    }
  }

  assert.equal(unitTerrainMoveCost(knight, 'snow'), 1, 'Gale Striders must reduce Snow move cost to 1')
  knight.move = 3
  knight.moved = false
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, mage, 0, 0)
  placeUnit(battle, archer, 0, 4)
  placeUnit(battle, foe1, 5, 2)
  placeUnit(battle, foe2, 6, 4)
  assert.equal(computeMoveTiles(battle, knight).some(t => t.col === 4 && t.row === 2), true, 'Gale Striders allows moving 3 tiles on Snow')

  // 2. Frostguard Plate: chills adjacent melee attacker with slowTurns = 1
  flattenBoard(battle, 'grass', 0)
  const frostKnight = Object.assign(knight, { armorId: 'frostguard_plate', hp: 90, maxHp: 90, shield: 0 })
  placeUnit(battle, frostKnight, 2, 2)
  placeUnit(battle, foe1, 3, 2)
  foe1.range = 1
  foe1.slowTurns = 0
  foe1.hp = 80
  foe1.maxHp = 80
  battle.phase = 'enemy'
  battle.activeUnitUid = foe1.uid
  battle.enemyActedThisTurn = false
  battle.enemyDelay = 0.01
  for (let i = 0; i < 6; i++) stepGame(state, STEP)
  assert.ok(foe1.slowTurns >= 1, 'Frostguard Plate must chill adjacent melee attacker with Slow')

  // 3. Ember Scepter: applies Burn on crit
  Object.assign(mage, { weaponId: 'ember_wand', crit: 0.95, acted: false })
  placeUnit(battle, mage, 1, 2)
  placeUnit(battle, foe1, 3, 2)
  foe1.hp = 150
  foe1.maxHp = 150
  foe1.burnTurns = 0
  foe1.facing = 'e' // Backstab + 0.95 crit -> clamped at 0.95; retry up to 3 deterministic seeds if needed
  let burnedOnCrit = false
  for (let attempt = 0; attempt < 5; attempt++) {
    mage.acted = false
    foe1.burnTurns = 0
    foe1.hp = 150
    battle.phase = 'player'
    battle.activeUnitUid = mage.uid
    selectHeroByUid(state, mage.uid)
    selectTile(state, 3, 2)
    if (foe1.burnTurns > 0) { burnedOnCrit = true; break }
  }
  assert.equal(burnedOnCrit, true, 'Ember Scepter (ember_wand) must inflict Burn on crit')

  // 4. Crimson Pendant (blood_amulet): heals +14 HP on KO
  Object.assign(knight, { relicId: 'blood_amulet', armorId: undefined, weaponId: undefined, hp: 50, maxHp: 90, lifesteal: 0, acted: false })
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, foe1, 3, 2)
  foe1.hp = 4
  foe1.shield = 0
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  selectHeroByUid(state, knight.uid)
  assert.equal(selectTile(state, 3, 2), true)
  assert.equal(foe1.alive, false)
  assert.equal(knight.hp, 64, 'Crimson Pendant (blood_amulet) must heal +14 HP on KO')

  // 5. Runed Chainmail (runed_mail): reduces incoming skill damage by 15% (forecast & live!)
  // Test Mage Arcane Bolt targeting an enemy wearing runed_mail vs without runed_mail
  foe2.hp = 100
  foe2.maxHp = 100
  foe2.def = 2
  foe2.shield = 0
  placeUnit(battle, mage, 3, 4)
  placeUnit(battle, foe2, 5, 4)
  Object.assign(mage, { weaponId: undefined })
  mage.crit = 0
  mage.acted = false
  mage.cooldowns = [0, 0, 0]
  battle.phase = 'player'
  battle.activeUnitUid = mage.uid
  selectHeroByUid(state, mage.uid)
  assert.equal(armSkill(state, 0), true)

  Object.assign(foe2, { armorId: undefined })
  const fcNoMail = computeCombatForecast(state, 5, 4)!
  Object.assign(foe2, { armorId: 'runed_mail' })
  const fcRuned = computeCombatForecast(state, 5, 4)!
  assert.ok(fcRuned.normalDmg < fcNoMail.normalDmg, `Runed Chainmail (${fcRuned.normalDmg}) must reduce skill damage vs bare (${fcNoMail.normalDmg})`)

  const hpBeforeSkill = foe2.hp
  assert.equal(selectTile(state, 5, 4), true)
  assert.equal(hpBeforeSkill - foe2.hp, fcRuned.normalDmg, 'Live skill damage against Runed Chainmail must match forecast')

  // Basic attack is NOT reduced by Runed Chainmail
  mage.acted = false
  selectHeroByUid(state, mage.uid)
  armSkill(state, null)
  Object.assign(foe2, { armorId: undefined })
  const fcBasicBare = computeCombatForecast(state, 5, 4)!
  Object.assign(foe2, { armorId: 'runed_mail' })
  const fcBasicRuned = computeCombatForecast(state, 5, 4)!
  assert.equal(fcBasicRuned.normalDmg, fcBasicBare.normalDmg, 'Runed Chainmail must only reduce skill damage, not basic attacks')

  // 6. Sunsteel Blade (+15% vs Burn/Stun), Frostbite Staff (+15% vs Slow), Dragonfang Halberd (+10% pierce vs DEF >= 5), Solis Crownblade (+10% vs Boss & +1 AP on first KO)
  Object.assign(foe2, { armorId: undefined, def: 8, isBoss: true, burnTurns: 0, slowTurns: 0, hp: 150, maxHp: 150 })
  Object.assign(mage, { weaponId: undefined, relicId: undefined })
  const fcBase = computeCombatForecast(state, 5, 4)!

  Object.assign(mage, { weaponId: 'sunsteel_blade' })
  foe2.burnTurns = 0
  const fcSunClean = computeCombatForecast(state, 5, 4)!
  foe2.burnTurns = 2
  const fcSunBurn = computeCombatForecast(state, 5, 4)!
  assert.ok(fcSunBurn.normalDmg > fcSunClean.normalDmg, 'Sunsteel Blade must deal +15% DMG against Burning foes')
  foe2.burnTurns = 0

  Object.assign(mage, { weaponId: 'frostbite_staff' })
  foe2.slowTurns = 0
  const fcFrostClean = computeCombatForecast(state, 5, 4)!
  foe2.slowTurns = 2
  const fcFrostSlow = computeCombatForecast(state, 5, 4)!
  assert.ok(fcFrostSlow.normalDmg > fcFrostClean.normalDmg, 'Frostbite Staff must deal +15% DMG against Slowed foes')
  foe2.slowTurns = 0

  Object.assign(mage, { weaponId: 'dragonfang_spear' })
  const fcSpearHighDef = computeCombatForecast(state, 5, 4)!
  assert.ok(fcSpearHighDef.normalDmg > fcBase.normalDmg, 'Dragonfang Halberd must pierce +10% armor vs high-DEF targets')

  Object.assign(mage, { weaponId: 'solis_crownblade' })
  Object.assign(foe2, { isBoss: false })
  const fcCrownNormal = computeCombatForecast(state, 5, 4)!
  Object.assign(foe2, { isBoss: true })
  const fcCrownBoss = computeCombatForecast(state, 5, 4)!
  assert.ok(fcCrownBoss.normalDmg > fcCrownNormal.normalDmg, 'Solis Crownblade must deal +10% DMG vs Bosses')

  // 7. Skyhawk Crest (eagle_charm): ignores 2 Cover DEF on flat ground
  battle.cells[4][5] = makeCell(5, 4, 'tall_grass', 0)
  Object.assign(mage, { weaponId: undefined, relicId: undefined })
  assert.equal(computeCoverBonus(battle, 3, 4, 5, 4, mage), 3)
  Object.assign(mage, { relicId: 'eagle_charm' })
  assert.equal(computeCoverBonus(battle, 3, 4, 5, 4, mage), 1, 'Skyhawk Crest (eagle_charm) must ignore 2 Cover DEF')

  // 8. Turn-start gear triggers: Aegis of Dawn (+6 Shield <60% HP) & Heart of Solis (+10 HP regen)
  Object.assign(knight, {
    armorId: 'aegis_of_dawn',
    relicId: 'heart_of_solis',
    hp: 40,
    maxHp: 100,
    shield: 0,
    ct: 120,
    speed: 24
  })
  foe2.ct = 0
  mage.ct = 0
  archer.ct = 0
  endPlayerTurn(state)
  const activeAfter = getUnitByUid(battle, battle.activeUnitUid)
  assert.equal(activeAfter?.uid, knight.uid)
  assert.equal(knight.hp, 50, 'Heart of Solis must regenerate +10 HP at turn start')
  assert.equal(knight.shield, 6, 'Aegis of Dawn must grant +6 Shield at turn start when below 60% HP')

  // 9. Solis Crownblade +1 AP on first KO
  Object.assign(knight, { weaponId: 'solis_crownblade', crownbladeKoUsed: false, acted: false })
  placeUnit(battle, knight, 4, 4)
  placeUnit(battle, foe2, 5, 4)
  foe2.hp = 4
  foe2.shield = 0
  battle.ap = 1
  battle.maxAp = 4
  selectHeroByUid(state, knight.uid)
  assert.equal(selectTile(state, 5, 4), true)
  assert.equal(foe2.alive, false)
  assert.equal(battle.ap, 2, 'Solis Crownblade must grant +1 AP on first KO')
  assert.equal(knight.crownbladeKoUsed, true)

  // 10. Verify all 12 EQUIP_EFFECTS map to valid EquipmentSpec IDs
  for (const eqId of Object.keys(EQUIP_EFFECTS)) {
    assert.ok(EQUIPMENT_BY_ID[eqId], `EQUIP_EFFECTS entry ${eqId} must exist in EQUIPMENT_BY_ID`)
    assert.ok(getEquipEffect(eqId))
  }
})

test('Curated Tactic Deck builder enforces 6..12 bounds, draws strictly from active deck, and persists via save/load', () => {
  const state = createInitialState(3020)
  // Add 10 extra tactics so player owns 16 total tactics (> MAX_TACTIC_DECK = 12)
  for (let i = 0; i < 10; i++) {
    const spec = TACTIC_LIST[i % TACTIC_LIST.length]
    state.campaign.tactics.push({ uid: `tac_extra_${i}`, tacticId: spec.id })
  }
  assert.equal(state.campaign.tactics.length, 16)

  // Backwards-compatible default when activeTacticDeckUids is unset: caps at MAX_TACTIC_DECK (12)
  assert.equal(state.campaign.activeTacticDeckUids, undefined)
  const defaultActive = getActiveTacticDeckUids(state.campaign)
  assert.equal(defaultActive.length, MAX_TACTIC_DECK)

  // Cannot add a 13th card when already at 12
  const benchedUid = state.campaign.tactics[14].uid
  assert.equal(defaultActive.includes(benchedUid), false)
  assert.equal(toggleTacticInDeck(state, benchedUid), false, 'Cannot exceed MAX_TACTIC_DECK (12)')

  // Bench cards down to MIN_TACTIC_DECK (6)
  for (let i = 0; i < 6; i++) {
    const uidToRemove = getActiveTacticDeckUids(state.campaign)[0]
    assert.equal(toggleTacticInDeck(state, uidToRemove), true)
  }
  assert.equal(getActiveTacticDeckUids(state.campaign).length, MIN_TACTIC_DECK)

  // Cannot drop below MIN_TACTIC_DECK (6)
  const lastRemovable = getActiveTacticDeckUids(state.campaign)[0]
  assert.equal(toggleTacticInDeck(state, lastRemovable), false, 'Cannot drop below MIN_TACTIC_DECK (6)')

  // Toggle a specific benched card INTO the curated 7-card deck
  assert.equal(toggleTacticInDeck(state, benchedUid), true)
  const curated = getActiveTacticDeckUids(state.campaign)
  assert.equal(curated.length, 7)
  assert.equal(curated.includes(benchedUid), true)

  // Verify startChapterBattle shuffles & draws STRICTLY from the 7 curated cards (zero benched cards!)
  const battle = startChapterBattle(state, 0)
  const battleCards = [...battle.hand, ...battle.drawPile, ...battle.discardPile].sort()
  assert.deepEqual(battleCards, curated.slice().sort(), 'Battle deck must contain ONLY curated activeTacticDeckUids')

  // Auto-Build builds a balanced 12-card deck and computeTacticDeckCurve reports valid totals
  const built = autoBuildTacticDeck(state)
  assert.equal(built.length, MAX_TACTIC_DECK)
  const curve = computeTacticDeckCurve(state.campaign)
  assert.equal(curve.total, MAX_TACTIC_DECK)
  assert.equal(curve.byCost[0] + curve.byCost[1] + curve.byCost[2], MAX_TACTIC_DECK)

  // Save/Load round-trip preserves activeTacticDeckUids cleanly!
  // Bench back down to 8 cards to confirm exact curated subset survives save/load
  for (let i = 0; i < 4; i++) {
    assert.equal(toggleTacticInDeck(state, getActiveTacticDeckUids(state.campaign)[0]), true)
  }
  const expectedSavedDeck = getActiveTacticDeckUids(state.campaign).slice()
  assert.equal(expectedSavedDeck.length, 8)

  const storage = makeMemoryStorage()
  state.battle = null
  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  const restored = createInitialState(9999, loaded)
  assert.deepEqual(getActiveTacticDeckUids(restored.campaign), expectedSavedDeck)

  // Also test serializeSave direct round-trip
  const directSaved = serializeSave(state)
  const restoredDirect = createInitialState(1111, directSaved)
  assert.deepEqual(getActiveTacticDeckUids(restoredDirect.campaign), expectedSavedDeck)
})

test('Camp Tactic Deck, Equipment Effect, and Innate Passive UI drawing runs cleanly without throwing', () => {
  const ctx = makeMockCanvasCtx()
  const state = createInitialState(3030)
  const battle = startChapterBattle(state, 0)
  const widgetState = { hovered: false, pressed: false, focused: false, selected: false, disabled: false }

  // 1. Passive banner for all 8 heroes (regular & compact)
  for (const hero of HERO_LIST) {
    const passive = getHeroPassive(hero.id)!
    assert.doesNotThrow(() => {
      drawPassiveBanner(ctx, { x: 0, y: 0, width: 320, height: 42 }, passive, false)
      drawPassiveBanner(ctx, { x: 0, y: 0, width: 220, height: 26 }, passive, true)
    })
  }

  // 2. Battle unit card with passive badge
  const ally = battle.units.find(u => u.team === 'ally')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  assert.doesNotThrow(() => {
    drawUnitCard(ctx, { x: 0, y: 0, width: 212, height: 134 }, ally, undefined, effectiveSpeed(ally), 'Knight')
    drawUnitCard(ctx, { x: 0, y: 0, width: 174, height: 62 }, ally, undefined, effectiveSpeed(ally), 'Knight')
    drawUnitCard(ctx, { x: 0, y: 0, width: 212, height: 134 }, enemy, undefined, effectiveSpeed(enemy), 'Foe')
  })

  // 3. Equipment cards with special effects
  assert.doesNotThrow(() => {
    drawEquipCard(ctx, { x: 0, y: 0, width: 260, height: 52 }, {
      slot: 'armor',
      spec: EQUIPMENT_BY_ID.frostguard_plate,
      effect: getEquipEffect('frostguard_plate')!,
      ownerText: 'Bag'
    }, widgetState)
    drawEquipCard(ctx, { x: 0, y: 0, width: 120, height: 48 }, {
      slot: 'weapon',
      spec: EQUIPMENT_BY_ID.solis_crownblade
    }, { ...widgetState, selected: true })
  })

  // 4. Tactic Deck Header & Toggleable Deck Cards
  const curve = computeTacticDeckCurve(state.campaign)
  assert.doesNotThrow(() => {
    drawTacticDeckHeader(ctx, { x: 0, y: 0, width: 520, height: 34 }, curve, state.campaign.tactics.length)
    drawTacticDeckCard(ctx, { x: 0, y: 0, width: 280, height: 52 }, {
      spec: TACTIC_LIST[0],
      inDeck: true
    }, { ...widgetState, selected: true })
    drawTacticDeckCard(ctx, { x: 0, y: 0, width: 280, height: 52 }, {
      spec: TACTIC_LIST[1],
      inDeck: false
    }, widgetState)
  })
})
