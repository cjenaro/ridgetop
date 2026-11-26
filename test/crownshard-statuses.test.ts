import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats, Vec3 } from '../packages/ridgetop/framework/index.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  applyStatus, armSkill, armTacticCard, computeCombatForecast, computePoisonDamage,
  computeTurnOrderPreview, createInitialState, effectiveSpeed, endPlayerTurn, equipItem,
  findProvokingTaunters, getUnitByUid, previewTurnOrderAfterAction, restoreBattleState,
  selectTile, serializeBattleState, startChapterBattle, startStageBattle, stepGame,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import { MAX_POISON_STACKS } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, GameState } from '../examples/crownshard/crownshard/types.ts'
import { drawCombatForecast, drawUnitCard } from '../examples/crownshard/crownshard/ui-art.ts'

function clearFlatBoard(battle: BattleState): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = { col: c, row: r, terrain: 'grass', elevation: 0, heightLevel: 0, walkable: true }
    }
  }
}

function placeUnit(battle: BattleState, u: BattleState['units'][number], col: number, row: number): void {
  u.col = col
  u.row = row
  u.x = (col - (battle.cols - 1) * 0.5) * 1.65
  u.z = (row - (battle.rows - 1) * 0.5) * 1.65
  u.y = 0
  u.path = []
  u.moveProgress = 0
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

function fakeCanvasCtx(): CanvasRenderingContext2D {
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
    fillText() {},
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 7 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
}

test('Taunt forces nearby enemy AI to target the Taunting tank instead of closer squishy mage and decrements cleanly', () => {
  const state = createInitialState(1001)
  const battle = startChapterBattle(state, 0)
  clearFlatBoard(battle)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!
  const mage = battle.units.find(u => u.heroId === 'mage')!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  const meleeEnemy = enemies[0]
  // Remove other enemies so only meleeEnemy acts
  for (let i = 1; i < enemies.length; i++) {
    enemies[i].alive = false
    enemies[i].hp = 0
  }

  // Park archer far away, place squishy low-HP mage ADJACENT (dist 1) to enemy, and tank knight at dist 2!
  placeUnit(battle, archer, 0, 0)
  placeUnit(battle, mage, 3, 2)
  placeUnit(battle, meleeEnemy, 4, 2)
  placeUnit(battle, knight, 4, 4)

  mage.hp = 12
  mage.shield = 0
  knight.hp = knight.maxHp
  knight.shield = 0
  knight.tauntTurns = 2

  assert.deepEqual(findProvokingTaunters(battle, meleeEnemy).map(u => u.uid), [knight.uid])

  // Make it meleeEnemy's turn directly
  battle.phase = 'enemy'
  battle.activeUnitUid = meleeEnemy.uid
  battle.selectedUnitUid = meleeEnemy.uid
  battle.enemyDelay = 0.01
  battle.enemyActedThisTurn = false
  meleeEnemy.ct = 100
  meleeEnemy.acted = false
  meleeEnemy.moved = false
  knight.ct = 0
  mage.ct = 0
  archer.ct = 0

  const knightHpBefore = knight.hp
  const mageHpBefore = mage.hp

  // Step until enemy completes its move + attack on the taunting knight
  for (let i = 0; i < 120 && battle.activeUnitUid === meleeEnemy.uid; i++) {
    stepGame(state, STEP)
  }

  assert.ok(knight.hp < knightHpBefore, `Expected Taunting Knight to take damage (${knight.hp} < ${knightHpBefore})`)
  assert.equal(mage.hp, mageHpBefore, 'Squishy adjacent mage must NOT be attacked while Tank is Taunting nearby!')

  // Verify tauntTurns decrements at the start of the Knight's turns: 2 -> 1 -> 0
  knight.ct = 100
  archer.ct = 0
  mage.ct = 0
  meleeEnemy.ct = 0
  battle.phase = 'player'
  battle.activeUnitUid = archer.uid
  endPlayerTurn(state)
  assert.equal(battle.activeUnitUid, knight.uid)
  assert.equal(knight.tauntTurns, 1, 'Taunt should decrement 2 -> 1 at start of Knight turn')

  knight.ct = 200
  endPlayerTurn(state)
  assert.equal(battle.activeUnitUid, knight.uid)
  assert.equal(knight.tauntTurns, 0, 'Taunt should decrement 1 -> 0 and expire on next Knight turn')
})

test('Haste boosts effectiveSpeed, accelerates CT turn order in live sim and previewTurnOrderAfterAction, and expires', () => {
  const state = createInitialState(1002)
  const battle = startChapterBattle(state, 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const baseSpd = effectiveSpeed(knight)
  knight.hasteTurns = 2
  const hastedSpd = effectiveSpeed(knight)
  assert.ok(hastedSpd > baseSpd, `Haste must boost effectiveSpeed (${hastedSpd} > ${baseSpd})`)
  assert.equal(hastedSpd, Math.round(knight.speed * 1.4))

  // Verify Slow + Haste combine cleanly without dropping below 3
  knight.slowTurns = 1
  const bothSpd = effectiveSpeed(knight)
  assert.ok(bothSpd < hastedSpd && bothSpd >= 3)
  knight.slowTurns = 0

  // Verify Haste accelerates turn order vs non-hasted baseline
  const cloneUnitsCt = () => battle.units.map(u => ({ uid: u.uid, ct: u.ct }))
  const savedCts = cloneUnitsCt()
  for (const u of battle.units) {
    u.ct = 20
    u.hasteTurns = 0
    u.slowTurns = 0
    u.burnTurns = 0
    u.stunTurns = 0
    u.poisonStacks = 0
  }
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  active.ct = 100
  const normalOrder = computeTurnOrderPreview(battle, 8)
  const normalIdx = normalOrder.findIndex((e, idx) => idx > 0 && e.uid === knight.uid)

  knight.hasteTurns = 2
  const hastedOrder = computeTurnOrderPreview(battle, 8)
  const hastedIdx = hastedOrder.findIndex((e, idx) => idx > 0 && e.uid === knight.uid)
  assert.ok(hastedIdx > 0 && (normalIdx < 0 || hastedIdx <= normalIdx), 'Hasted Knight should appear earlier in CT timeline')
  assert.equal(hastedOrder[hastedIdx].speed, hastedSpd)

  // Verify exact parity between previewTurnOrderAfterAction and real endPlayerTurn with Haste active
  for (const entry of savedCts) {
    const u = getUnitByUid(battle, entry.uid)
    if (u) u.ct = entry.ct
  }
  knight.ct = 98
  knight.hasteTurns = 1
  const preview = previewTurnOrderAfterAction(battle, 'move_and_act', 8)!
  assert.ok(preview)
  active.moved = true
  active.acted = true
  endPlayerTurn(state)
  assert.deepEqual(
    preview.projectedOrder,
    battle.turnOrder,
    'previewTurnOrderAfterAction must match live battle.turnOrder exactly when Haste ticks & expires'
  )
  assert.equal(knight.hasteTurns, 0, 'Haste must decrement 1 -> 0 at start of Knight turn')
})

test('Poison stacks up to cap, deals shield-piercing stack-scaled DoT, decays each turn, KOs cleanly, and matches turn preview', () => {
  const state = createInitialState(1003)
  const battle = startChapterBattle(state, 0)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  // Stack accumulation up to MAX_POISON_STACKS (5)
  applyStatus(battle, enemy, 'poison', 2)
  assert.equal(enemy.poisonStacks, 2)
  applyStatus(battle, enemy, 'poison', 2)
  assert.equal(enemy.poisonStacks, 4)
  applyStatus(battle, enemy, 'poison', 3)
  assert.equal(enemy.poisonStacks, MAX_POISON_STACKS, `Poison must cap at ${MAX_POISON_STACKS} stacks`)

  // Shield-piercing DoT at start of enemy's turn
  enemy.maxHp = 80
  enemy.hp = 60
  enemy.shield = 25
  const expectedDmg = computePoisonDamage(enemy) // round(80 * 0.05 * 5) = 20
  assert.equal(expectedDmg, 20)

  for (const u of battle.units) u.ct = 0
  active.ct = 100
  enemy.ct = 99
  battle.floatingNumbers = []
  endPlayerTurn(state)

  assert.equal(battle.activeUnitUid, enemy.uid)
  assert.equal(enemy.hp, 60 - expectedDmg, 'Poison DoT must pierce shield and subtract directly from HP')
  assert.equal(enemy.shield, 25, 'Poison must NOT consume shield')
  assert.equal(enemy.poisonStacks, MAX_POISON_STACKS - 1, 'Poison must decay by 1 stack at turn start')
  assert.ok(
    battle.floatingNumbers.some(fn => fn.text === `POISON -${expectedDmg}` && fn.color === '#8dff4f'),
    'Poison tick must emit green venom floating damage text'
  )

  // Lethal Poison preview parity & clean KO (even while enemy holds shield!)
  const secondEnemy = battle.units.filter(u => u.alive && u.team === 'enemy')[1]
  assert.ok(secondEnemy)
  battle.phase = 'player'
  battle.activeUnitUid = active.uid
  active.ct = 100
  active.moved = false
  active.acted = false
  for (const u of battle.units) {
    if (u.uid !== active.uid) u.ct = 0
  }
  enemy.ct = 99
  enemy.hp = 5
  enemy.shield = 40
  enemy.poisonStacks = 3 // dmg = round(80 * 0.05 * 3) = 12 >= 5 -> lethal!
  secondEnemy.ct = 90

  const preview = previewTurnOrderAfterAction(battle, 'move_and_act', 8)!
  assert.ok(!preview.projectedOrder.some(e => e.uid === enemy.uid), 'Turn preview must omit enemy killed by lethal Poison')

  active.moved = true
  active.acted = true
  endPlayerTurn(state)
  assert.equal(enemy.alive, false, 'Lethal Poison tick must KO the unit cleanly')
  assert.equal(enemy.hp, 0)
  assert.deepEqual(preview.projectedOrder, battle.turnOrder, 'Turn order preview must match live battle after lethal Poison KO')
})

test('Hero skills, enemy Bog Shaman, tactic cards, and equipment hooks apply Taunt, Haste, and Poison in battle', () => {
  const state = createInitialState(1004)
  // Build a custom squad with 2* Knight, 2* Rogue, Cleric, 2* Paladin + status equipment & tactics
  state.campaign.heroes = [
    { uid: 'h_knight', heroId: 'knight', stars: 2, weaponUid: 'eq_halberd', armorUid: 'eq_aegis', relicUid: null },
    { uid: 'h_rogue', heroId: 'rogue', stars: 2, weaponUid: null, armorUid: null, relicUid: 'eq_boots' },
    { uid: 'h_cleric', heroId: 'cleric', stars: 1, weaponUid: null, armorUid: null, relicUid: null }
  ]
  state.campaign.equipment.push(
    { uid: 'eq_halberd', equipId: 'dragonfang_spear', slot: 'weapon' },
    { uid: 'eq_aegis', equipId: 'aegis_of_dawn', slot: 'armor' },
    { uid: 'eq_boots', equipId: 'swift_boots', slot: 'relic' }
  )
  state.campaign.tactics.push(
    { uid: 'tac_taunt', tacticId: 'taunt_banner' },
    { uid: 'tac_venom', tacticId: 'venom_vial' },
    { uid: 'tac_gale', tacticId: 'wind_step' }
  )
  state.campaign.squadUids = ['h_knight', 'h_rogue', 'h_cleric']

  // Start Sunken Bridge (contains bog_shaman!)
  const battle = startStageBattle(state, 'sunken_bridge')
  clearFlatBoard(battle)

  const knight = battle.units.find(u => u.uid === 'h_knight')!
  const rogue = battle.units.find(u => u.uid === 'h_rogue')!
  const cleric = battle.units.find(u => u.uid === 'h_cleric')!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
  const shaman = battle.units.find(u => u.enemyId === 'bog_shaman')!
  assert.ok(shaman, 'Sunken Bridge should spawn a Bog Shaman')

  // 1. Equipment startStatus hooks: Aegis of Dawn -> start Taunt, Gale Striders -> start Haste
  assert.ok(knight.tauntTurns >= 1, 'Aegis of Dawn must grant start-of-battle Taunt')
  assert.ok(rogue.hasteTurns >= 1, 'Gale Striders must grant start-of-battle Haste')

  // 2. Hero Skill hooks: Knight Shield Bash -> self Taunt + Dragonfang Halberd on-hit Poison
  knight.tauntTurns = 0
  enemy.poisonStacks = 0
  enemy.hp = 90
  enemy.maxHp = 90
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  knight.acted = false
  knight.cooldowns = [0, 0, 0]

  assert.equal(armSkill(state, 0), true)
  const fcBash = computeCombatForecast(state, enemy.col, enemy.row)!
  assert.equal(fcBash.selfStatus, 'taunt', 'Shield Bash forecast must surface selfStatus taunt')
  assert.equal(selectTile(state, enemy.col, enemy.row), true)
  assert.equal(knight.tauntTurns, 2, 'Shield Bash must grant Knight 2 turns of Taunt')
  assert.ok(enemy.poisonStacks >= 1, 'Dragonfang Halberd on-hit hook must apply Poison')

  // 3. Knight Bulwark Aura -> self Taunt only (adjacent Cleric gets shield, NOT Taunt!)
  knight.tauntTurns = 0
  cleric.tauntTurns = 0
  knight.acted = false
  knight.cooldowns = [0, 0, 0]
  placeUnit(battle, cleric, 2, 3)
  assert.equal(armSkill(state, 1), true)
  assert.equal(knight.tauntTurns, 2, 'Bulwark Aura must grant Taunt to the Knight')
  assert.equal(cleric.tauntTurns, 0, 'Bulwark Aura must NOT force Taunt onto adjacent Cleric')

  // 4. Rogue Shadow Strike -> Poison x2
  enemy.poisonStacks = 0
  enemy.hp = 90
  placeUnit(battle, rogue, 1, 2)
  battle.activeUnitUid = rogue.uid
  rogue.acted = false
  rogue.cooldowns = [0, 0, 0]
  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, enemy.col, enemy.row), true)
  assert.equal(enemy.poisonStacks, 2, 'Rogue Shadow Strike must inflict Poison x2')

  // 5. Cleric Sunbeam Mend -> Haste
  knight.hasteTurns = 0
  battle.activeUnitUid = cleric.uid
  cleric.acted = false
  cleric.cooldowns = [0, 0, 0]
  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, knight.col, knight.row), true)
  assert.equal(knight.hasteTurns, 2, 'Cleric Sunbeam Mend must grant Haste')

  // 6. Tactic Cards: Vanguard Challenge (Taunt), Venom Flask (Poison x2), Gale Step (Haste)
  battle.ap = 4
  battle.hand = ['tac_taunt', 'tac_venom', 'tac_gale']
  cleric.tauntTurns = 0
  assert.equal(armTacticCard(state, 'tac_taunt'), true)
  assert.equal(selectTile(state, cleric.col, cleric.row), true)
  assert.equal(cleric.tauntTurns, 2, 'Vanguard Challenge tactic must grant Taunt')

  enemy.poisonStacks = 0
  enemy.hp = 90
  assert.equal(armTacticCard(state, 'tac_venom'), true)
  assert.equal(selectTile(state, enemy.col, enemy.row), true)
  assert.equal(enemy.poisonStacks, 2, 'Venom Flask tactic must inflict Poison x2')

  cleric.hasteTurns = 0
  assert.equal(armTacticCard(state, 'tac_gale'), true)
  assert.equal(selectTile(state, cleric.col, cleric.row), true)
  assert.equal(cleric.hasteTurns, 2, 'Gale Step tactic must grant Haste')

  // 7. Enemy Bog Shaman attack inflicts Poison
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== shaman.uid) { u.alive = false; u.hp = 0 }
  }
  knight.tauntTurns = 0
  cleric.tauntTurns = 0
  rogue.tauntTurns = 0
  knight.poisonStacks = 0
  knight.hp = knight.maxHp
  placeUnit(battle, shaman, 4, 2)
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, rogue, 0, 0)
  placeUnit(battle, cleric, 0, 4)
  battle.phase = 'enemy'
  battle.activeUnitUid = shaman.uid
  battle.enemyDelay = 0.01
  battle.enemyActedThisTurn = false
  shaman.ct = 100
  shaman.acted = false
  shaman.moved = false

  for (let i = 0; i < 60 && battle.activeUnitUid === shaman.uid; i++) {
    stepGame(state, STEP)
  }
  assert.equal(knight.poisonStacks, 2, 'Bog Shaman attack must inflict Poison x2 on targeted hero')

  // Unused import check guard
  assert.equal(typeof equipItem, 'function')
})

test('Battle auto-save round-trip preserves tauntTurns, hasteTurns, poisonStacks and supports legacy snapshots', () => {
  const state = createInitialState(1005)
  const battle = startChapterBattle(state, 0)
  const ally = battle.units.find(u => u.alive && u.team === 'ally')!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  ally.tauntTurns = 2
  ally.hasteTurns = 1
  enemy.poisonStacks = 4

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap)
  const jsonCopy = JSON.parse(JSON.stringify(snap))
  const resumed = createInitialState(999)
  assert.equal(restoreBattleState(resumed, jsonCopy), true)

  const rAlly = resumed.battle!.units.find(u => u.uid === ally.uid)!
  const rEnemy = resumed.battle!.units.find(u => u.uid === enemy.uid)!
  assert.equal(rAlly.tauntTurns, 2)
  assert.equal(rAlly.hasteTurns, 1)
  assert.equal(rEnemy.poisonStacks, 4)

  // Legacy save compatibility: snapshot without tauntTurns / hasteTurns / poisonStacks validates and defaults to 0
  const legacy = JSON.parse(JSON.stringify(snap))
  for (const u of legacy.units) {
    delete u.tauntTurns
    delete u.hasteTurns
    delete u.poisonStacks
  }
  const validated = validateBattleSnapshot(legacy)
  assert.ok(validated, 'Legacy battle snapshot omitting new status fields must validate cleanly')
  const resumedLegacy = createInitialState(888)
  assert.equal(restoreBattleState(resumedLegacy, legacy), true)
  for (const u of resumedLegacy.battle!.units) {
    assert.equal(u.tauntTurns, 0)
    assert.equal(u.hasteTurns, 0)
    assert.equal(u.poisonStacks, 0)
  }
})

test('CrownshardScene and HUD render Taunt, Haste, and Poison 3D auras, VFX, and UI badges without throwing', () => {
  const state = createInitialState(1006)
  const battle = startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  const ally = battle.units.find(u => u.alive && u.team === 'ally')!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  // Initial render before statuses
  scene.render(state, 1 / 60, 1280, 720)

  // Activate Taunt, Haste, and Poison + trigger tactic VFX and poison tick
  ally.tauntTurns = 2
  ally.hasteTurns = 2
  enemy.poisonStacks = 3

  const at: Vec3 = [enemy.x, enemy.y, enemy.z]
  const allyAt: Vec3 = [ally.x, ally.y, ally.z]
  state.vfx.push({ kind: 'tactic', tacticId: 'taunt_banner', style: 'holy', at: allyAt, cells: [allyAt], casterUid: ally.uid })
  state.vfx.push({ kind: 'tactic', tacticId: 'venom_vial', style: 'shadow', at, cells: [at], casterUid: ally.uid })

  for (let i = 0; i < 45; i++) {
    stepGame(state, 1 / 60)
    scene.render(state, 1 / 60, 1280, 720)
  }

  // Trigger poison tick reaction
  enemy.poisonStacks = 2
  state.vfx.push({ kind: 'impact', uid: enemy.uid, attackerUid: null, arc: 'front', crit: false, blocked: false, absorbed: 0, damage: 9 })
  for (let i = 0; i < 30; i++) {
    stepGame(state, 1 / 60)
    scene.render(state, 1 / 60, 1280, 720)
  }

  assert.ok(fake.drawn >= 75)
  assert.ok(fake.maxInstances > 40, '3D status auras and tactic VFX must emit rendered instances')

  // Verify drawUnitCard and drawCombatForecast draw Taunt/Haste/Poison badges cleanly
  const ctx = fakeCanvasCtx()
  drawUnitCard(ctx, { x: 0, y: 0, width: 260, height: 112 }, ally, undefined, effectiveSpeed(ally), 'Knight')
  drawUnitCard(ctx, { x: 0, y: 0, width: 260, height: 112 }, enemy, undefined, effectiveSpeed(enemy), 'Goblin')
  drawCombatForecast(
    ctx,
    { x: 0, y: 0, width: 320, height: 120 },
    {
      mode: 'skill',
      actionName: 'Shield Bash',
      skillIndex: 0,
      attackerUid: ally.uid,
      attackerName: ally.name,
      attackerHeroId: ally.heroId,
      attackerStars: ally.stars,
      targetUid: enemy.uid,
      targetName: enemy.name,
      targetTeam: 'enemy',
      targetEnemyId: enemy.enemyId,
      targetCol: enemy.col,
      targetRow: enemy.row,
      approachCol: ally.col,
      approachRow: ally.row,
      requiresMove: false,
      path: [],
      normalDmg: 18,
      critDmg: 28,
      critChance: 0.15,
      healAmount: 0,
      shieldAmount: 0,
      selfShield: 12,
      status: 'poison',
      selfStatus: 'taunt',
      targetTaunting: true,
      highGround: false,
      elevationDiff: 0,
      coverBonus: 0,
      terrainDefBonus: 0,
      empowered: false,
      attackArc: 'front',
      isOffensive: true,
      friendlyFire: false,
      friendlyFireCount: 0,
      emptyTileTarget: false,
      ignoreArmor: 0.2,
      aoeTargets: 1,
      targetHpBefore: enemy.hp,
      targetMaxHp: enemy.maxHp,
      targetShieldBefore: 0,
      targetHpAfterNormal: Math.max(0, enemy.hp - 18),
      targetHpAfterCrit: Math.max(0, enemy.hp - 28),
      lethalNormal: false,
      lethalCrit: false,
      alternatives: []
    }
  )
})
