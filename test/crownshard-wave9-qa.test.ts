import assert from 'node:assert/strict'
import test from 'node:test'
import { EQUIPMENT_BY_ID } from '../examples/crownshard/crownshard/data.ts'
import { getHeroActiveGearSetIds } from '../examples/crownshard/crownshard/gear-sets.ts'
import {
  MAX_EQUIP_UPGRADE,
  findEligibleFuseDuplicate,
  findEligibleFuseDuplicates,
  getEquipUpgradePreview,
  upgradeEquipWithDuplicate
} from '../examples/crownshard/crownshard/gear-upgrade.ts'
import { BANTER_COOLDOWN_SECONDS, bondPairKey } from '../examples/crownshard/crownshard/hero-bonds.ts'
import { computePincerAssistDamage } from '../examples/crownshard/crownshard/pincer.ts'
import {
  SAVE_KEY,
  armSkill,
  autoEquipBestFit,
  computeCombatForecast,
  computeHeroStats,
  createInitialState,
  equipItem,
  findBestFitUpgrades,
  getEquipmentByUid,
  loadSave,
  persistSave,
  previewPathOpportunityAttacks,
  refreshHighlights,
  selectTile,
  serializeSave,
  startStageBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type {
  BattleState,
  BattleUnit,
  BossTelegraphZone,
  CampaignState,
  GameState,
  OwnedEquipCard
} from '../examples/crownshard/crownshard/types.ts'
import { computeOpportunityAttackDamage } from '../examples/crownshard/crownshard/zoc.ts'

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: key => { map.delete(key) }
  }
}

function addEquip(
  campaign: CampaignState,
  equipId: string,
  opts: { upgradeLevel?: number; locked?: boolean } = {}
): OwnedEquipCard {
  const spec = EQUIPMENT_BY_ID[equipId]
  assert.ok(spec, `Unknown equipId: ${equipId}`)
  const card: OwnedEquipCard = {
    uid: `eq_w9_${campaign.nextUid++}`,
    equipId: spec.id,
    slot: spec.slot,
    ...(opts.upgradeLevel !== undefined ? { upgradeLevel: opts.upgradeLevel } : {}),
    ...(opts.locked ? { locked: true } : {})
  }
  campaign.equipment.push(card)
  return card
}

function flattenBoard(battle: BattleState): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = {
        col: c,
        row: r,
        terrain: 'stone',
        heightLevel: 0,
        elevation: 0,
        walkable: true
      }
    }
  }
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number): void {
  unit.col = col
  unit.row = row
  const elev = battle.cells[row]?.[col]?.elevation ?? 0
  const [wx, wy, wz] = gridToWorld(col, row, elev, battle.cols, battle.rows)
  unit.x = wx
  unit.y = wy
  unit.z = wz
  unit.path = []
  unit.moveProgress = 0
}

function isolateUnits(battle: BattleState, keepUids: readonly string[]): void {
  const keep = new Set(keepUids)
  for (const u of battle.units) {
    if (!keep.has(u.uid)) {
      u.alive = false
      u.hp = 0
      u.downed = false
      u.koCountdown = 0
    }
  }
}

function runSingleBossTurn(state: GameState, boss: BattleUnit): void {
  const battle = state.battle!
  boss.ct = 100
  boss.moved = false
  boss.acted = false
  boss.stunTurns = 0
  battle.phase = 'enemy'
  battle.activeUnitUid = boss.uid
  battle.selectedUnitUid = boss.uid
  battle.pendingAction = null
  battle.enemyDelay = 0.01
  battle.enemyActedThisTurn = false
  for (let i = 0; i < 60 && !battle.enemyActedThisTurn && battle.phase === 'enemy'; i++) {
    stepGame(state, 0.05)
  }
  for (let i = 0; i < 40 && battle.units.some(u => u.path.length > 0); i++) {
    stepGame(state, 0.05)
  }
}

function runBattleTicks(state: GameState, steps = 40, dt = 0.08): void {
  for (let i = 0; i < steps; i++) {
    stepGame(state, dt)
  }
}

// ============================================================================
// 1. Duplicate Fusion fodder safety (+1..+5 copies are NEVER consumed)
// ============================================================================

test('Wave 9 QA #1: Duplicate Fusion protects +1..+5 tempered copies from being consumed as fodder', () => {
  const state = createInitialState(9001)
  const { campaign } = state
  campaign.gold = 3000

  const knight = campaign.heroes[0]
  const targetSword = getEquipmentByUid(campaign, knight.weaponUid)!
  assert.equal(targetSword.equipId, 'iron_sword')
  assert.equal(targetSword.upgradeLevel, undefined)

  // Add unlocked, unequipped tempered copies at +1, +3, and +5
  const plus1 = addEquip(campaign, 'iron_sword', { upgradeLevel: 1 })
  const plus3 = addEquip(campaign, 'iron_sword', { upgradeLevel: 3 })
  const plus5 = addEquip(campaign, 'iron_sword', { upgradeLevel: 5 })

  assert.deepEqual(findEligibleFuseDuplicates(campaign, targetSword.uid), [])
  assert.equal(findEligibleFuseDuplicate(campaign, targetSword.uid), null)
  const blockedPreview = getEquipUpgradePreview(campaign, targetSword.uid)!
  assert.equal(blockedPreview.eligibleDuplicateCount, 0)
  assert.equal(blockedPreview.canFuseDuplicate, false)
  assert.equal(upgradeEquipWithDuplicate(state, targetSword.uid), null)

  // All tempered copies remain untouched
  assert.ok(getEquipmentByUid(campaign, plus1.uid))
  assert.ok(getEquipmentByUid(campaign, plus3.uid))
  assert.ok(getEquipmentByUid(campaign, plus5.uid))

  // Adding a +0 duplicate allows exactly 1 fusion consuming ONLY the +0 copy
  const fodder0 = addEquip(campaign, 'iron_sword')
  assert.deepEqual(
    findEligibleFuseDuplicates(campaign, targetSword.uid).map(e => e.uid),
    [fodder0.uid]
  )
  const res = upgradeEquipWithDuplicate(state, targetSword.uid)
  assert.ok(res)
  assert.equal(res.consumedDuplicateUid, fodder0.uid)
  assert.equal(targetSword.upgradeLevel, 1)
  assert.equal(getEquipmentByUid(campaign, fodder0.uid), undefined)
  assert.ok(getEquipmentByUid(campaign, plus1.uid))
  assert.ok(getEquipmentByUid(campaign, plus3.uid))
  assert.ok(getEquipmentByUid(campaign, plus5.uid))

  // No eligible fodder remains after the single +0 copy is consumed
  assert.equal(findEligibleFuseDuplicate(campaign, targetSword.uid), null)
  assert.equal(upgradeEquipWithDuplicate(state, targetSword.uid), null)
})

// ============================================================================
// 2. Boss Telegraphed AoEs shatter Destructible Cover & respect Dynamic Weather
// ============================================================================

test('Wave 9 QA #2: Boss telegraphed AoE shatters cracked_pillar/barricade cover and respects Rain/Blizzard weather', () => {
  function runTelegraphDetonation(
    weather: 'clear' | 'rain' | 'blizzard',
    element: 'fire' | 'frost'
  ): { hpLost: number; pillarWalkable: boolean; barricadeWalkable: boolean } {
    const state = createInitialState(9002)
    const battle = startStageBattle(state, 'eclipse_throne')
    flattenBoard(battle)
    Object.assign(battle, { weather })

    const boss = battle.units.find(u => u.enemyId === 'eclipse_archon')!
    const hero = battle.units.find(u => u.team === 'ally' && u.alive)!
    isolateUnits(battle, [boss.uid, hero.uid])
    placeUnit(battle, hero, 2, 2)
    placeUnit(battle, boss, 7, 5)
    boss.move = 0
    boss.atk = 60
    hero.hp = 400
    hero.maxHp = 400
    hero.def = 10
    hero.shield = 0
    hero.facing = 'e'

    // Place destructible cracked_pillar at (3,2) and barricade at (2,3)
    battle.cells[2][3] = {
      col: 3,
      row: 2,
      terrain: 'cracked_pillar',
      heightLevel: 0,
      elevation: 0,
      walkable: false,
      barricadeHp: 18,
      barricadeMaxHp: 18
    }
    battle.cells[3][2] = {
      col: 2,
      row: 3,
      terrain: 'barricade',
      heightLevel: 0,
      elevation: 0,
      walkable: false,
      barricadeHp: 18,
      barricadeMaxHp: 18
    }

    const zone: BossTelegraphZone = {
      id: 'tg_w9_1',
      casterUid: boss.uid,
      casterName: boss.name,
      moveId: element === 'fire' ? 'magma_eruption' : 'tempest_surge',
      label: element === 'fire' ? 'Magma Eruption' : 'Glacial Surge',
      element,
      cells: [
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 2, row: 3 }
      ],
      turnsRemaining: 1,
      damageMul: 1.25,
      flatDamage: 10,
      phase: 1
    }
    battle.bossTelegraphs = [zone]
    runSingleBossTurn(state, boss)

    return {
      hpLost: 400 - hero.hp,
      pillarWalkable: battle.cells[2][3].walkable && battle.cells[2][3].terrain !== 'cracked_pillar',
      barricadeWalkable: battle.cells[3][2].walkable && battle.cells[3][2].terrain !== 'barricade'
    }
  }

  const fireClear = runTelegraphDetonation('clear', 'fire')
  const fireRain = runTelegraphDetonation('rain', 'fire')
  assert.equal(fireClear.pillarWalkable, true, 'Boss telegraph AoE must shatter cracked_pillar cover')
  assert.equal(fireClear.barricadeWalkable, true, 'Boss telegraph AoE must shatter barricade cover')
  assert.ok(fireClear.hpLost > 0 && fireRain.hpLost > 0)
  assert.ok(
    fireRain.hpLost < fireClear.hpLost,
    `Rain weather must weaken fire boss telegraph (${fireRain.hpLost} < ${fireClear.hpLost})`
  )

  const frostClear = runTelegraphDetonation('clear', 'frost')
  const frostBlizzard = runTelegraphDetonation('blizzard', 'frost')
  assert.equal(frostBlizzard.pillarWalkable, true)
  assert.equal(frostBlizzard.barricadeWalkable, true)
  assert.ok(
    frostBlizzard.hpLost > frostClear.hpLost,
    `Blizzard weather must boost frost boss telegraph (${frostBlizzard.hpLost} > ${frostClear.hpLost})`
  )
})

// ============================================================================
// 3. Elemental Combos & Forced Movement crossing 50% Boss HP trigger Phase II
// ============================================================================

test('Wave 9 QA #3A: Elemental Combo (Shatter + Wildfire splash) crossing 50% boss HP triggers Phase II', () => {
  // Part 1: Direct Shatter combo drops boss from >50% to <=50%
  {
    const state = createInitialState(9003)
    const campMage = state.campaign.heroes.find(h => h.heroId === 'mage')!
    campMage.stars = 2 // unlocks skill 1: Ember Nova (fire AoE)
    const battle = startStageBattle(state, 'eclipse_throne')
    flattenBoard(battle)

    const boss = battle.units.find(u => u.enemyId === 'eclipse_archon')!
    const mage = battle.units.find(u => u.team === 'ally' && u.heroId === 'mage')!
    assert.ok(boss && mage)
    isolateUnits(battle, [boss.uid, mage.uid])
    placeUnit(battle, mage, 2, 2)
    placeUnit(battle, boss, 4, 2)

    // Configure HP so direct Ember Nova hit leaves boss slightly ABOVE 50%, then Shatter pushes below 50%
    boss.maxHp = 200
    boss.hp = 112
    boss.def = 40
    boss.shield = 25 // absorbs direct Ember Nova damage so boss stays >100 HP before Shatter!
    boss.slowTurns = 2 // primes Fire -> Shatter (16% maxHp = 32 true HP damage!)
    boss.bossPhase = 1

    mage.atk = 18
    mage.crit = 0
    mage.cooldowns = [0, 0, 0]
    mage.moved = false
    mage.acted = false

    battle.phase = 'player'
    battle.activeUnitUid = mage.uid
    battle.selectedUnitUid = mage.uid
    refreshHighlights(battle, state.campaign)
    assert.equal(armSkill(state, 1), true, 'Mage Ember Nova (fire) must arm')
    selectTile(state, boss.col, boss.row)
    runBattleTicks(state)

    assert.equal(boss.alive, true)
    assert.ok(boss.hp <= 100, `Expected boss HP <= 100 after Shatter, got ${boss.hp}`)
    assert.equal(boss.bossPhase, 2, 'Shatter combo crossing 50% HP must trigger Boss Phase II')
  }

  // Part 2: Wildfire splash ignited on adjacent empty tall_grass tile drops boss below 50% HP
  {
    const state = createInitialState(9004)
    const campMage = state.campaign.heroes.find(h => h.heroId === 'mage')!
    campMage.stars = 2 // unlocks skill 1: Ember Nova (fire AoE)
    const battle = startStageBattle(state, 'eclipse_throne')
    flattenBoard(battle)

    const boss = battle.units.find(u => u.enemyId === 'eclipse_archon')!
    const mage = battle.units.find(u => u.team === 'ally' && u.heroId === 'mage')!
    isolateUnits(battle, [boss.uid, mage.uid])
    placeUnit(battle, mage, 1, 2)
    placeUnit(battle, boss, 5, 2) // 2 tiles from Ember Nova center (3,2) so ONLY Wildfire splash hits boss!

    // Connected tall_grass path: (3,2) -> (4,2) -> (5,2)
    for (const col of [3, 4, 5]) {
      battle.cells[2][col].terrain = 'tall_grass'
    }
    boss.maxHp = 200
    boss.hp = 104 // >50%; Wildfire deals 10 dmg -> 94 <= 100!
    boss.shield = 0
    boss.bossPhase = 1

    mage.cooldowns = [0, 0, 0]
    mage.moved = false
    mage.acted = false

    battle.phase = 'player'
    battle.activeUnitUid = mage.uid
    battle.selectedUnitUid = mage.uid
    refreshHighlights(battle, state.campaign)
    assert.equal(armSkill(state, 1), true)
    // Target empty tall_grass at (3,2) -> Ember Nova cross hits (3,2),(4,2),(2,2),(3,1),(3,3) — NOT (5,2) directly!
    selectTile(state, 3, 2)
    runBattleTicks(state)

    assert.equal(boss.alive, true)
    assert.ok(boss.hp <= 100, `Expected Wildfire splash to drop boss to <=100 HP, got ${boss.hp}`)
    assert.equal(boss.bossPhase, 2, 'Wildfire splash crossing 50% boss HP must trigger Boss Phase II')
  }
})

test('Wave 9 QA #3B: Forced Movement collision crossing 50% boss HP triggers Phase II', () => {
  const state = createInitialState(9005)
  const battle = startStageBattle(state, 'eclipse_throne')
  flattenBoard(battle)

  const boss = battle.units.find(u => u.enemyId === 'eclipse_archon')!
  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  assert.ok(boss && knight)
  isolateUnits(battle, [boss.uid, knight.uid])

  // Knight at (2,2), Boss at (3,2), solid Pillar at (4,2) -> Shield Bash knockback slams boss into pillar!
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, boss, 3, 2)
  battle.cells[2][4] = {
    col: 4,
    row: 2,
    terrain: 'pillar',
    heightLevel: 1,
    elevation: 0.4,
    walkable: false
  }

  boss.maxHp = 200
  boss.hp = 106 // >50%; direct Shield Bash (~4 dmg) breaks small shield (boss stays >100 HP), then 12 collision dmg drops boss <= 100!
  boss.def = 40
  boss.shield = 4
  boss.bossPhase = 1

  knight.atk = 16
  knight.crit = 0
  knight.cooldowns = [0, 0, 0]
  knight.moved = false
  knight.acted = false

  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  refreshHighlights(battle, state.campaign)
  // Knight skill 0 is Shield Bash (knockback 1)
  assert.equal(armSkill(state, 0), true, 'Knight Shield Bash must arm')
  selectTile(state, boss.col, boss.row)
  runBattleTicks(state)

  assert.equal(boss.alive, true)
  assert.ok(boss.hp <= 100, `Expected forced movement collision to push boss <=100 HP, got ${boss.hp}`)
  assert.equal(boss.bossPhase, 2, 'Forced movement collision crossing 50% boss HP must trigger Boss Phase II')
})

// ============================================================================
// 4. Hero Bond `boss_phase` banter reliability even right after a Crit!
// ============================================================================

test('Wave 9 QA #4: boss_phase Hero Bond banter fires reliably even when a Crit triggers Phase II', () => {
  const state = createInitialState(9006)
  // Establish Rank 2 bond (3 battles) between knight & archer so both crit and boss_phase are unlocked
  state.campaign.heroBonds[bondPairKey('knight', 'archer')] = 4

  const battle = startStageBattle(state, 'eclipse_throne')
  flattenBoard(battle)

  const boss = battle.units.find(u => u.enemyId === 'eclipse_archon')!
  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  assert.ok(boss && knight && archer)
  isolateUnits(battle, [boss.uid, knight.uid, archer.uid])

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, archer, 1, 2)
  placeUnit(battle, boss, 3, 2)

  // Guarantee a Crit on Knight's basic strike, which triggers 'crit' banter (setting banterCooldown > 0)
  // right BEFORE triggerFrontierBossPhaseIfReady fires 'boss_phase' banter!
  knight.crit = 1.0
  knight.atk = 40
  knight.moved = false
  knight.acted = false

  boss.maxHp = 200
  boss.hp = 120
  boss.def = 0
  boss.shield = 0
  boss.bossPhase = 1

  battle.activeBanter = null
  battle.banterCooldown = 0
  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  refreshHighlights(battle, state.campaign)

  selectTile(state, boss.col, boss.row)
  runBattleTicks(state)

  assert.equal(boss.bossPhase, 2, 'Crit hit must push boss into Phase II')
  const banterAfter = state.battle!.activeBanter
  assert.ok(banterAfter, 'boss_phase banter must be active')
  assert.equal(
    banterAfter.trigger,
    'boss_phase',
    'boss_phase banter must override crit banter cooldown via force: true'
  )
  assert.equal(battle.banterCooldown > 0 && battle.banterCooldown <= BANTER_COOLDOWN_SECONDS, true)
})

// ============================================================================
// 5. CombatForecast parity for Hero Bonds on Move+Strike Pincer & OA Previews
// ============================================================================

test('Wave 9 QA #5A: Move+Strike Pincer forecast matches live bonded pincer damage when move enters Bond range', () => {
  const state = createInitialState(9007)
  // Give knight & archer Rank 3 bond (unbroken bond: +5% ATK within dist 2, +10% Pincer damage)
  state.campaign.heroBonds[bondPairKey('knight', 'archer')] = 6

  const battle = startStageBattle(state, 'sunlit_bridge')
  flattenBoard(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy' && u.alive)!
  assert.ok(knight && archer && enemy)
  isolateUnits(battle, [knight.uid, archer.uid, enemy.uid])

  // Start knight at (1,2), enemy at (4,2), bonded assister (archer) at (5,2).
  // Before move: dist(knight, archer) = 4 (> 2 -> archer has NO bond assist yet!).
  // After move to approach tile (3,2): dist(knight, archer) = 2 (<= 2 -> archer gains +5% ATK bond!).
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 4, 2)
  placeUnit(battle, archer, 5, 2)
  knight.move = 4
  knight.moved = false
  knight.acted = false
  archer.atk = 50
  archer.stunTurns = 0
  enemy.hp = 300
  enemy.maxHp = 300
  enemy.def = 10
  enemy.shield = 0

  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  battle.selectedUnitUid = knight.uid
  refreshHighlights(battle, state.campaign)

  const unbondedDmg = computePincerAssistDamage(battle, archer, enemy, knight)
  const forecast = computeCombatForecast(state, enemy.col, enemy.row)
  assert.ok(forecast, 'Move+Strike combat forecast must be available')
  assert.equal(forecast.pincerAssisterUid, archer.uid)
  assert.equal(forecast.bondPincerBonus, true)

  // Move knight onto approach tile (3,2) and compute live pincer assist damage
  placeUnit(battle, knight, 3, 2)
  const liveBondedDmg = computePincerAssistDamage(battle, archer, enemy, knight)

  assert.ok(
    liveBondedDmg > unbondedDmg,
    `Bonded assister damage (${liveBondedDmg}) must exceed unbonded (${unbondedDmg})`
  )
  assert.equal(
    forecast.pincerDmg,
    liveBondedDmg,
    'Move+Strike CombatForecast pincerDmg must match live pincer damage at the approach tile'
  )
})

test('Wave 9 QA #5B: Opportunity Attack preview matches live OA damage with active Hero Bonds on defender & sentinel', () => {
  // Case 1: Bonded ally defender moving out of enemy ZoC (defender gets +5% DEF from adjacent bonded partner)
  {
    const state = createInitialState(9008)
    state.campaign.heroBonds[bondPairKey('knight', 'archer')] = 3

    const battle = startStageBattle(state, 'sunlit_bridge')
    flattenBoard(battle)

    const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
    const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
    const sentinel = battle.units.find(u => u.team === 'enemy' && u.alive && u.range <= 1)!
    assert.ok(knight && archer && sentinel)
    isolateUnits(battle, [knight.uid, archer.uid, sentinel.uid])

    // Knight at (3,2), bonded Archer at (3,3) (dist 1 -> +5% DEF), Enemy ZoC sentinel at (4,2)
    placeUnit(battle, knight, 3, 2)
    placeUnit(battle, archer, 3, 3)
    placeUnit(battle, sentinel, 4, 2)

    knight.hp = 200
    knight.maxHp = 200
    knight.def = 40
    knight.shield = 0
    knight.move = 3
    knight.moved = false
    knight.acted = false
    sentinel.atk = 60
    sentinel.stunTurns = 0

    battle.phase = 'player'
    battle.activeUnitUid = knight.uid
    battle.selectedUnitUid = knight.uid
    refreshHighlights(battle, state.campaign)

    const path = [{ col: 2, row: 2 }]
    const oaPreview = previewPathOpportunityAttacks(battle, knight, path)
    assert.equal(oaPreview.triggers.length, 1)

    // Compare against unbonded OA preview to prove bond DEF actually changed the damage
    const noBondCalc = computeOpportunityAttackDamage(
      { ...battle, bondPairsActive: [] },
      sentinel,
      knight,
      knight.col,
      knight.row,
      'w',
      0
    )
    assert.ok(
      oaPreview.totalDamage < noBondCalc.damage,
      `Bonded defender OA preview (${oaPreview.totalDamage}) must be lower than unbonded (${noBondCalc.damage})`
    )

    // Execute live movement and verify exact HP loss matches preview
    const hpBefore = knight.hp
    selectTile(state, 2, 2)
    runBattleTicks(state)
    const actualHpLoss = hpBefore - knight.hp
    assert.equal(
      actualHpLoss,
      oaPreview.totalHpLoss,
      'Live OA damage against bonded defender must exactly match previewPathOpportunityAttacks'
    )
  }

  // Case 2: Bonded ally sentinel striking a disengaging enemy (+5% ATK from bonded partner)
  {
    const state = createInitialState(9009)
    state.campaign.heroBonds[bondPairKey('knight', 'archer')] = 3

    const battle = startStageBattle(state, 'sunlit_bridge')
    flattenBoard(battle)

    const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
    const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
    const mover = battle.units.find(u => u.team === 'enemy' && u.alive)!
    assert.ok(knight && archer && mover)
    isolateUnits(battle, [knight.uid, archer.uid, mover.uid])

    placeUnit(battle, knight, 3, 2)
    placeUnit(battle, archer, 3, 3)
    placeUnit(battle, mover, 4, 2)
    knight.atk = 60
    knight.stunTurns = 0
    mover.def = 10
    mover.hp = 200
    mover.maxHp = 200
    mover.shield = 0

    const bondedCalc = computeOpportunityAttackDamage(battle, knight, mover, 4, 2, 'e', 0)
    const unbondedCalc = computeOpportunityAttackDamage(
      { ...battle, bondPairsActive: [] },
      knight,
      mover,
      4,
      2,
      'e',
      0
    )
    assert.ok(
      bondedCalc.damage > unbondedCalc.damage,
      `Bonded sentinel OA preview (${bondedCalc.damage}) must exceed unbonded (${unbondedCalc.damage})`
    )
  }
})

// ============================================================================
// 6. findBestFitUpgrades / autoEquipBestFit respects 2-Piece Gear Sets
// ============================================================================

test('Wave 9 QA #6: findBestFitUpgrades / autoEquipBestFit preserves active 2-piece sets and completes set synergies', () => {
  const state = createInitialState(9010)
  const { campaign } = state
  const mage = campaign.heroes.find(h => h.heroId === 'mage')!
  assert.ok(mage)

  // Equip 2-piece Astral Conclave on Mage: ember_wand (uncommon, astral) + astral_vestments (rare, astral)
  const emberWand = addEquip(campaign, 'ember_wand')
  const astralVestments = addEquip(campaign, 'astral_vestments')
  assert.equal(equipItem(state, mage.uid, emberWand.uid), true)
  assert.equal(equipItem(state, mage.uid, astralVestments.uid), true)
  assert.deepEqual(getHeroActiveGearSetIds(campaign, mage), ['astral'])

  // Add a frostbite_staff (rare, frostguard — individually higher raw stats than uncommon ember_wand,
  // but breaking 2pc Astral loses +4 ATK, +2 SPD & +15% Skill DMG!)
  const frostStaff = addEquip(campaign, 'frostbite_staff')
  const statsBefore = computeHeroStats(campaign, mage)

  const upgrades = findBestFitUpgrades(campaign, mage.uid)
  assert.equal(
    upgrades.some(eq => eq.uid === frostStaff.uid),
    false,
    'findBestFitUpgrades must NOT break active 2pc Astral set for an individual-slot swap downgrade'
  )

  const applied = autoEquipBestFit(state, mage.uid)
  assert.equal(applied.some(eq => eq.uid === frostStaff.uid), false)
  assert.deepEqual(getHeroActiveGearSetIds(campaign, mage), ['astral'])
  assert.ok(computeHeroStats(campaign, mage).powerScore >= statsBefore.powerScore)

  // Now test completing a 2-piece set from scratch:
  // Unequip mage's weapon so mage has 1pc Astral (astral_vestments) + unequipped ember_wand + unequipped frostbite_staff
  mage.weaponUid = null
  const bestToComplete = findBestFitUpgrades(campaign, mage.uid)
  assert.ok(
    bestToComplete.some(eq => eq.uid === emberWand.uid),
    'findBestFitUpgrades should choose ember_wand to complete 2pc Astral over standalone frostbite_staff'
  )
})

// ============================================================================
// 7. loadSave normalizes out-of-range / invalid equipment[].upgradeLevel
// ============================================================================

test('Wave 9 QA #7: loadSave directly normalizes invalid and out-of-range equipment upgradeLevel values', () => {
  const state = createInitialState(9011)
  addEquip(state.campaign, 'iron_plate', { upgradeLevel: 2 })
  addEquip(state.campaign, 'copper_signet', { upgradeLevel: 1 })
  addEquip(state.campaign, 'hunter_bow', { upgradeLevel: 3 })
  addEquip(state.campaign, 'iron_sword', { upgradeLevel: 4 })

  const storage = createMemoryStorage()
  persistSave(storage, state, null)

  // Corrupt the persisted JSON directly with out-of-range, float, negative, string, and zero upgradeLevel values
  const rawSave = structuredClone(serializeSave(state)) as unknown as {
    version: number
    campaign: { equipment: Array<Record<string, unknown>> }
    activeBattle: null
  }
  assert.ok(rawSave.campaign.equipment.length >= 5)
  rawSave.campaign.equipment[0].upgradeLevel = 99
  rawSave.campaign.equipment[1].upgradeLevel = -4
  rawSave.campaign.equipment[2].upgradeLevel = 2.9
  rawSave.campaign.equipment[3].upgradeLevel = 'corrupt'
  rawSave.campaign.equipment[4].upgradeLevel = 0
  storage.setItem(SAVE_KEY, JSON.stringify(rawSave))

  const loaded = loadSave(storage)
  assert.ok(loaded, 'Corrupted upgradeLevel values must not invalidate the save')
  assert.equal(loaded.campaign.equipment[0].upgradeLevel, MAX_EQUIP_UPGRADE)
  assert.equal(loaded.campaign.equipment[1].upgradeLevel, undefined)
  assert.equal(loaded.campaign.equipment[2].upgradeLevel, 2)
  assert.equal(loaded.campaign.equipment[3].upgradeLevel, undefined)
  assert.equal(loaded.campaign.equipment[4].upgradeLevel, undefined)
})
