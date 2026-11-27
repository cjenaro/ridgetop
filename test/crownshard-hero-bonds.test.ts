import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BANTER_COOLDOWN_SECONDS,
  BANTER_DURATION_SECONDS,
  BOND_ATK_MUL,
  BOND_CRIT_BONUS,
  BOND_DEF_MUL,
  BOND_PINCER_MUL,
  HERO_CLASS_IDS,
  MAX_BANTER_TEXT_LENGTH,
  bondPairKey,
  computePincerPairBondMultiplier,
  computeUnitBondAssist,
  formatCompactBondChip,
  formatSquadBondChip,
  getActiveBattleBondPairs,
  getBondBattles,
  getBondRank,
  getBondRankFromBattles,
  getBondRankTitle,
  getSquadBondSummary,
  getTotalBondRanks,
  parseBondPairKey,
  recordSquadBattleBonds,
  sanitizeHeroBonds,
  stepBattleBanter,
  triggerBattleBanter
} from '../examples/crownshard/crownshard/hero-bonds.ts'
import { computePincerAssistDamage } from '../examples/crownshard/crownshard/pincer.ts'
import {
  armSkill,
  computeCombatForecast,
  confirmDeployment,
  createInitialState,
  hydrateSave,
  loadSave,
  persistSave,
  refreshHighlights,
  restoreBattleState,
  selectTile,
  serializeBattleState,
  serializeSave,
  startChapterBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld, terrainElevation, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type {
  BanterTriggerKind,
  BattleState,
  BattleUnit,
  GridCell,
  HeroClassId,
  SaveData,
  TileTerrain
} from '../examples/crownshard/crownshard/types.ts'
import {
  drawBattleBanterToast,
  drawCombatForecast,
  drawSquadBondsStrip,
  drawUnitCard
} from '../examples/crownshard/crownshard/ui-art.ts'

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

function makeMemoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem(key: string) { return map.get(key) ?? null },
    setItem(key: string, value: string) { map.set(key, value) },
    removeItem(key: string) { map.delete(key) }
  }
}

function makeMockCanvasContext() {
  const texts: string[] = []
  let ops = 0
  const grad = { addColorStop() {} }
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
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
    measureText(s: string) { return { width: s.length * 6.2 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

test('bondPairKey produces canonical sorted keys and rank thresholds advance 0 -> 1 -> 2 -> 3', () => {
  assert.equal(bondPairKey('knight', 'archer'), 'archer+knight')
  assert.equal(bondPairKey('archer', 'knight'), 'archer+knight')
  assert.deepEqual(parseBondPairKey('knight+archer'), ['archer', 'knight'])
  assert.equal(parseBondPairKey('knight+knight'), null)
  assert.equal(parseBondPairKey('knight+dragon'), null)

  assert.equal(getBondRankFromBattles(0), 0)
  assert.equal(getBondRankFromBattles(1), 1)
  assert.equal(getBondRankFromBattles(2), 1)
  assert.equal(getBondRankFromBattles(3), 2)
  assert.equal(getBondRankFromBattles(5), 2)
  assert.equal(getBondRankFromBattles(6), 3)
  assert.equal(getBondRankFromBattles(12), 3)

  assert.equal(getBondRankTitle(0), 'Unbonded')
  assert.equal(getBondRankTitle(1), 'Comrades')
  assert.equal(getBondRankTitle(2), 'Sworn Allies')
  assert.equal(getBondRankTitle(3), 'Unbroken Bond')

  const state = createInitialState(42)
  assert.deepEqual(state.campaign.heroBonds, {})
  assert.equal(getTotalBondRanks(state.campaign.heroBonds), 0)

  // Battle 1: Knight + Archer + Mage -> 3 pairs hit Rank 1
  const rankUps1 = recordSquadBattleBonds(state.campaign, ['knight', 'archer', 'mage'])
  assert.equal(rankUps1.length, 3)
  assert.ok(rankUps1.every(r => r.oldRank === 0 && r.newRank === 1 && r.battles === 1))
  assert.equal(getBondBattles(state.campaign.heroBonds, 'knight', 'archer'), 1)
  assert.equal(getBondRank(state.campaign.heroBonds, 'knight', 'archer'), 1)
  assert.equal(getTotalBondRanks(state.campaign.heroBonds), 3)

  // Battle 2: Still Rank 1 (no new rank-ups)
  const rankUps2 = recordSquadBattleBonds(state.campaign, ['knight', 'archer'])
  assert.equal(rankUps2.length, 0)
  assert.equal(getBondBattles(state.campaign.heroBonds, 'knight', 'archer'), 2)

  // Battle 3: Knight + Archer hits Rank 2 (Sworn Allies)
  const rankUps3 = recordSquadBattleBonds(state.campaign, ['knight', 'archer'])
  assert.equal(rankUps3.length, 1)
  assert.equal(rankUps3[0].key, 'archer+knight')
  assert.equal(rankUps3[0].oldRank, 1)
  assert.equal(rankUps3[0].newRank, 2)
  assert.equal(rankUps3[0].rankTitle, 'Sworn Allies')

  // Battles 4, 5, 6: Knight + Archer hits Rank 3 (Unbroken Bond)
  assert.equal(recordSquadBattleBonds(state.campaign, ['knight', 'archer']).length, 0)
  assert.equal(recordSquadBattleBonds(state.campaign, ['knight', 'archer']).length, 0)
  const rankUps6 = recordSquadBattleBonds(state.campaign, ['knight', 'archer'])
  assert.equal(rankUps6.length, 1)
  assert.equal(rankUps6[0].newRank, 3)
  assert.equal(rankUps6[0].rankTitle, 'Unbroken Bond')
})

test('winning a battle records squad bonds and attaches bondRankUps to BattleReward', () => {
  const state = createInitialState(101)
  const battle = startChapterBattle(state, 0)
  flattenArena(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  for (let i = 1; i < enemies.length; i++) {
    enemies[i].alive = false
    enemies[i].hp = 0
  }
  const lastEnemy = enemies[0]
  lastEnemy.hp = 1
  lastEnemy.shield = 0
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, lastEnemy, 3, 2)
  makeActiveHero(battle, knight)
  refreshHighlights(battle, state.campaign)

  selectTile(state, 3, 2)
  assert.equal(battle.phase, 'victory')
  assert.ok(battle.reward)
  assert.ok(battle.reward.bondRankUps && battle.reward.bondRankUps.length === 3)
  assert.equal(getBondRank(state.campaign.heroBonds, 'knight', 'archer'), 1)
  assert.equal(getBondRank(state.campaign.heroBonds, 'knight', 'mage'), 1)
  assert.equal(getBondRank(state.campaign.heroBonds, 'archer', 'mage'), 1)
  assert.equal(getSquadBondSummary(state.campaign).length, 3)
})

test('computeUnitBondAssist grants +5% ATK/DEF within 2 tiles, drops out of range or when partner is downed/KO', () => {
  const state = createInitialState(77)
  state.campaign.heroBonds['archer+knight'] = 1 // Rank 1
  const battle = startChapterBattle(state, 0)
  flattenArena(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const mage = battle.units.find(u => u.team === 'ally' && u.heroId === 'mage')!

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, archer, 4, 2) // Manhattan distance = 2 (in range!)
  placeUnit(battle, mage, 0, 0) // Unbonded with knight

  const assistInRange = computeUnitBondAssist(battle, knight)
  assert.equal(assistInRange.active, true)
  assert.equal(assistInRange.highestRank, 1)
  assert.equal(assistInRange.atkMul, BOND_ATK_MUL)
  assert.equal(assistInRange.defMul, BOND_DEF_MUL)
  assert.equal(assistInRange.critBonus, 0)
  assert.equal(assistInRange.pincerMul, 1)
  assert.equal(assistInRange.partners.length, 1)
  assert.equal(assistInRange.partners[0].heroId, 'archer')

  // Move archer to distance 3 -> bond assist drops off
  placeUnit(battle, archer, 5, 2)
  const assistOutOfRange = computeUnitBondAssist(battle, knight)
  assert.equal(assistOutOfRange.active, false)
  assert.equal(assistOutOfRange.atkMul, 1)
  assert.equal(assistOutOfRange.defMul, 1)

  // Move archer adjacent (dist 1) but downed -> drops off
  placeUnit(battle, archer, 3, 2)
  archer.alive = false
  archer.downed = true
  archer.koCountdown = 3
  const assistPartnerDowned = computeUnitBondAssist(battle, knight)
  assert.equal(assistPartnerDowned.active, false)

  // Revive archer -> active again
  archer.alive = true
  archer.downed = false
  archer.koCountdown = 0
  assert.equal(computeUnitBondAssist(battle, knight).active, true)
})

test('Rank 2 grants +5% Crit assist and Rank 3 grants +10% Pincer follow-up assist', () => {
  // Rank 2 Crit check
  const stateR2 = createInitialState(88)
  stateR2.campaign.heroBonds['archer+knight'] = 3 // Rank 2
  const battleR2 = startChapterBattle(stateR2, 0)
  flattenArena(battleR2)

  const knightR2 = battleR2.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archerR2 = battleR2.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const enemyR2 = battleR2.units.find(u => u.team === 'enemy')!
  placeUnit(battleR2, knightR2, 2, 2)
  placeUnit(battleR2, archerR2, 2, 3) // dist 1
  placeUnit(battleR2, enemyR2, 3, 2)
  enemyR2.facing = 'w' // frontal
  makeActiveHero(battleR2, knightR2)
  refreshHighlights(battleR2, stateR2.campaign)

  const assistR2 = computeUnitBondAssist(battleR2, knightR2)
  assert.equal(assistR2.highestRank, 2)
  assert.equal(assistR2.critBonus, BOND_CRIT_BONUS)
  assert.equal(assistR2.pincerMul, 1)

  const fcR2 = computeCombatForecast(stateR2, 3, 2)
  assert.ok(fcR2)
  assert.equal(fcR2.bondAssistRank, 2)
  assert.equal(fcR2.bondAssistCritPct, 5)
  assert.ok(Math.abs(fcR2.critChance - (knightR2.crit + BOND_CRIT_BONUS)) < 1e-6)

  // Rank 3 Pincer check: compare Rank 2 vs Rank 3 pincer damage
  const stateR3 = createInitialState(88)
  stateR3.campaign.heroBonds['archer+knight'] = 6 // Rank 3
  const battleR3 = startChapterBattle(stateR3, 0)
  flattenArena(battleR3)

  const knightR3 = battleR3.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archerR3 = battleR3.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const enemyR3 = battleR3.units.find(u => u.team === 'enemy')!
  knightR3.atk = 24
  archerR3.atk = 30
  enemyR3.def = 4
  enemyR3.hp = 120
  enemyR3.maxHp = 120
  placeUnit(battleR3, knightR3, 2, 2)
  placeUnit(battleR3, enemyR3, 3, 2)
  placeUnit(battleR3, archerR3, 4, 2) // opposite tile -> pincer!
  enemyR3.facing = 'w'

  // Set same stats on R2 battle for apples-to-apples pincer comparison
  knightR2.atk = 24
  archerR2.atk = 30
  enemyR2.def = 4
  enemyR2.hp = 120
  enemyR2.maxHp = 120
  placeUnit(battleR2, knightR2, 2, 2)
  placeUnit(battleR2, enemyR2, 3, 2)
  placeUnit(battleR2, archerR2, 4, 2)

  assert.equal(computePincerPairBondMultiplier(battleR2, knightR2, archerR2), 1)
  assert.equal(computePincerPairBondMultiplier(battleR3, knightR3, archerR3), BOND_PINCER_MUL)

  const pincerR2 = computePincerAssistDamage(battleR2, archerR2, enemyR2, knightR2)
  const pincerR3 = computePincerAssistDamage(battleR3, archerR3, enemyR3, knightR3)
  assert.ok(pincerR3 > pincerR2, `Expected Rank 3 pincer (${pincerR3}) > Rank 2 pincer (${pincerR2})`)

  makeActiveHero(battleR3, knightR3)
  refreshHighlights(battleR3, stateR3.campaign)
  const fcR3 = computeCombatForecast(stateR3, 3, 2)
  assert.ok(fcR3)
  assert.equal(fcR3.pincerDmg, pincerR3)
  assert.equal(fcR3.bondPincerBonus, true)
})

test('CombatForecast with active Bond assist matches actual combat damage to the integer', () => {
  const state = createInitialState(555)
  state.campaign.heroBonds['archer+knight'] = 6 // Rank 3
  const battle = startChapterBattle(state, 0)
  flattenArena(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const mage = battle.units.find(u => u.team === 'ally' && u.heroId === 'mage')!
  const enemy = battle.units.find(u => u.team === 'enemy')!

  // Deterministic non-crit strike with Rank 3 bond assist + pincer
  knight.atk = 26
  knight.crit = 0
  archer.atk = 24
  enemy.hp = 120
  enemy.maxHp = 120
  enemy.shield = 0
  enemy.def = 5
  enemy.facing = 'w'

  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  placeUnit(battle, archer, 4, 2) // opposite across enemy (dist 2 from knight -> Bond Assist + Pincer!)
  placeUnit(battle, mage, 0, battle.rows - 1) // away

  // Force non-crit by disabling crit roll (critChance = 0.05 from Rank 2+, so set base crit = -0.1 so clamped crit = 0)
  knight.crit = -0.1
  makeActiveHero(battle, knight)
  refreshHighlights(battle, state.campaign)

  const fc = computeCombatForecast(state, 3, 2)
  assert.ok(fc)
  assert.equal(fc.critChance, 0)
  assert.equal(fc.bondAssistRank, 3)
  assert.equal(fc.bondAssistAtkPct, 5)
  assert.ok((fc.pincerDmg ?? 0) > 0)

  const hpBefore = enemy.hp
  selectTile(state, 3, 2)
  const actualDamage = hpBefore - enemy.hp
  assert.equal(actualDamage, fc.normalDmg + (fc.pincerDmg ?? 0))
  assert.equal(enemy.hp, fc.targetHpAfterNormal)

  // Verify +5% ATK & +5% DEF bond assist visibly improves combat numbers vs unbonded baseline
  const baselineState = createInitialState(555)
  const baselineBattle = startChapterBattle(baselineState, 0)
  flattenArena(baselineBattle)
  const baseKnight = baselineBattle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const baseArcher = baselineBattle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const baseEnemy = baselineBattle.units.find(u => u.team === 'enemy')!
  baseKnight.atk = 26
  baseKnight.def = 20
  baseKnight.crit = -0.1
  baseEnemy.def = 5
  baseEnemy.facing = 'w'
  placeUnit(baselineBattle, baseKnight, 2, 2)
  placeUnit(baselineBattle, baseEnemy, 3, 2)
  placeUnit(baselineBattle, baseArcher, 2, 3) // dist 1, unbonded
  makeActiveHero(baselineBattle, baseKnight)
  refreshHighlights(baselineBattle, baselineState.campaign)
  const fcUnbonded = computeCombatForecast(baselineState, 3, 2)
  assert.ok(fcUnbonded)
  assert.equal(fcUnbonded.bondAssistRank, undefined)
  assert.ok(fc.normalDmg > fcUnbonded.normalDmg, `Expected bonded normalDmg (${fc.normalDmg}) > unbonded (${fcUnbonded.normalDmg})`)

  // Verify +5% DEF bond assist lowers enemy counter damage when bonded partner is within 2 tiles
  const defState = createInitialState(556)
  defState.campaign.heroBonds['archer+knight'] = 1
  const defBattle = startChapterBattle(defState, 0)
  flattenArena(defBattle)
  const defKnight = defBattle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const defArcher = defBattle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const defEnemy = defBattle.units.find(u => u.team === 'enemy')!
  defKnight.atk = 10
  defKnight.def = 20
  defKnight.hp = 100
  defKnight.maxHp = 100
  defEnemy.atk = 31
  defEnemy.def = 4
  defEnemy.hp = 100
  defEnemy.maxHp = 100
  defEnemy.range = 1
  defEnemy.facing = 'w'
  placeUnit(defBattle, defKnight, 2, 2)
  placeUnit(defBattle, defEnemy, 3, 2)
  placeUnit(defBattle, defArcher, 2, 3) // dist 1 -> +5% DEF assist active
  makeActiveHero(defBattle, defKnight)
  refreshHighlights(defBattle, defState.campaign)
  const fcDefBonded = computeCombatForecast(defState, 3, 2)
  assert.ok(fcDefBonded && fcDefBonded.canCounter)

  placeUnit(defBattle, defArcher, 0, battle.rows - 1) // dist > 2 -> bond assist off
  const fcDefUnbonded = computeCombatForecast(defState, 3, 2)
  assert.ok(fcDefUnbonded && fcDefUnbonded.canCounter)
  assert.ok(
    (fcDefBonded.counterDmg ?? 0) < (fcDefUnbonded.counterDmg ?? 0),
    `Expected bonded DEF counterDmg (${fcDefBonded.counterDmg}) < unbonded (${fcDefUnbonded.counterDmg})`
  )
})

test('Battle Banter triggers on battle_start, crit, pincer, heal, revive, ko, boss_phase, respects cooldown, auto-expires, and stays silent when unbonded', () => {
  // 1. Unbonded squad stays completely silent
  const unbondedState = createInitialState(12)
  const unbondedBattle = startChapterBattle(unbondedState, 0)
  assert.equal(unbondedBattle.bondPairsActive.length, 0)
  assert.equal(unbondedBattle.activeBanter, null)
  assert.equal(triggerBattleBanter(unbondedBattle, 'crit', { force: true }), null)

  // 2. Bonded squad triggers battle_start on battle launch (and deploy confirm)
  const state = createInitialState(34)
  state.campaign.heroBonds['archer+knight'] = 3 // Rank 2 (unlocks all triggers!)
  state.campaign.heroBonds['knight+mage'] = 6 // Rank 3
  const deployBattle = startChapterBattle(state, 0, { deployPhase: true })
  assert.equal(deployBattle.activeBanter, null) // silent during deploy setup
  confirmDeployment(state)
  const startBanter = state.battle?.activeBanter
  assert.ok(startBanter)
  assert.equal(startBanter.trigger, 'battle_start')
  assert.ok(startBanter.text.length > 0 && startBanter.text.length <= MAX_BANTER_TEXT_LENGTH)
  assert.ok(deployBattle.banterCooldown > 0)

  // 3. Throttling blocks immediate second banter while cooldown > 0
  const knight = deployBattle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = deployBattle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const suppressed = triggerBattleBanter(deployBattle, 'crit', { speakerUnit: knight })
  assert.equal(suppressed, null)

  // 4. Auto-expiration in stepGame clears activeBanter after duration and drains cooldown
  const totalStepTime = Math.max(BANTER_DURATION_SECONDS, BANTER_COOLDOWN_SECONDS) + 0.2
  for (let t = 0; t < totalStepTime; t += 0.05) {
    stepGame(state, 0.05)
  }
  assert.equal(deployBattle.activeBanter, null)
  assert.equal(deployBattle.banterCooldown, 0)

  // 5. Exercise crit, pincer, heal, revive, ko (enemy + ally downed), and boss_phase
  const triggersToTest: readonly BanterTriggerKind[] = ['crit', 'pincer', 'heal', 'revive', 'ko', 'boss_phase']
  for (const trig of triggersToTest) {
    deployBattle.banterCooldown = 0
    const entry = triggerBattleBanter(deployBattle, trig, {
      speakerUnit: knight,
      partnerUnit: archer
    })
    assert.ok(entry, `Expected banter for trigger "${trig}"`)
    assert.equal(entry.trigger, trig)
    assert.ok(entry.text.length <= MAX_BANTER_TEXT_LENGTH, `Quip too long (${entry.text.length}): "${entry.text}"`)
  }

  // Ally-downed KO reaction
  deployBattle.banterCooldown = 0
  archer.alive = false
  archer.downed = true
  const downedReaction = triggerBattleBanter(deployBattle, 'ko', { partnerUnit: archer, allyDowned: true })
  assert.ok(downedReaction)
  assert.equal(downedReaction.partnerHeroId, 'archer')
  assert.notEqual(downedReaction.speakerUid, archer.uid)
  assert.ok(downedReaction.text.length <= MAX_BANTER_TEXT_LENGTH)

  // Verify banter logged cleanly in Combat Log
  assert.ok(deployBattle.combatLog.some(e => e.text.includes('♥R')))
})

test('all hero class pairs generate crisp <= 56 char banter across every trigger', () => {
  const triggers: readonly BanterTriggerKind[] = ['battle_start', 'crit', 'pincer', 'heal', 'revive', 'ko', 'boss_phase']
  for (let i = 0; i < HERO_CLASS_IDS.length; i++) {
    for (let j = i + 1; j < HERO_CLASS_IDS.length; j++) {
      const a: HeroClassId = HERO_CLASS_IDS[i]
      const b: HeroClassId = HERO_CLASS_IDS[j]
      const mockUnits: BattleUnit[] = [
        {
          uid: `u_${a}`, team: 'ally', name: a, heroId: a, stars: 1, level: 1, isBoss: false,
          col: 1, row: 1, x: 0, y: 0, z: 0, yaw: 0, facing: 'e', path: [], moveProgress: 0,
          hp: 50, maxHp: 50, shield: 0, atk: 15, def: 5, speed: 10, ct: 0, move: 3, jump: 1,
          range: 1, crit: 0.1, lifesteal: 0, moved: false, acted: false, alive: true,
          downed: false, koCountdown: 0, burnTurns: 0, slowTurns: 0, stunTurns: 0,
          empowerTurns: 0, tauntTurns: 0, hasteTurns: 0, poisonStacks: 0,
          cooldowns: [0, 0, 0], animState: 'idle', animTimer: 0, hitFlash: 0, lungeX: 0, lungeZ: 0
        },
        {
          uid: `u_${b}`, team: 'ally', name: b, heroId: b, stars: 1, level: 1, isBoss: false,
          col: 2, row: 1, x: 0, y: 0, z: 0, yaw: 0, facing: 'e', path: [], moveProgress: 0,
          hp: 50, maxHp: 50, shield: 0, atk: 15, def: 5, speed: 10, ct: 0, move: 3, jump: 1,
          range: 1, crit: 0.1, lifesteal: 0, moved: false, acted: false, alive: true,
          downed: false, koCountdown: 0, burnTurns: 0, slowTurns: 0, stunTurns: 0,
          empowerTurns: 0, tauntTurns: 0, hasteTurns: 0, poisonStacks: 0,
          cooldowns: [0, 0, 0], animState: 'idle', animTimer: 0, hitFlash: 0, lungeX: 0, lungeZ: 0
        }
      ]
      const pair = getActiveBattleBondPairs({ [bondPairKey(a, b)]: 6 }, [a, b])
      const mockBattle = {
        units: mockUnits,
        bondPairsActive: pair,
        activeBanter: null,
        banterCooldown: 0,
        nextBanterId: 1,
        combatLog: [],
        nextLogId: 1,
        turn: 1
      }
      for (const trig of triggers) {
        mockBattle.banterCooldown = 0
        const entry = triggerBattleBanter(mockBattle, trig, { speakerUnit: mockUnits[0], partnerUnit: mockUnits[1] })
        assert.ok(entry, `Missing banter for ${a}+${b} on ${trig}`)
        assert.ok(entry.text.length <= MAX_BANTER_TEXT_LENGTH, `Banter exceeds ${MAX_BANTER_TEXT_LENGTH} chars: ${entry.text}`)
      }
    }
  }
})

test('SaveData and BattleSaveSnapshot round-trip preserves heroBonds and supports legacy saves cleanly', () => {
  const storage = makeMemoryStorage()
  const state = createInitialState(2025)
  state.campaign.heroBonds = sanitizeHeroBonds({
    'knight+archer': 4, // reversed order -> canonicalized to archer+knight
    'mage+cleric': 7,
    'knight+knight': 5, // invalid self-pair -> dropped
    'bogus+knight': 3, // unknown class -> dropped
    'rogue+paladin': 0 // zero -> dropped
  })
  assert.deepEqual(state.campaign.heroBonds, {
    'archer+knight': 4,
    'cleric+mage': 7
  })

  const battle = startChapterBattle(state, 0)
  assert.equal(battle.bondPairsActive.length, 1)
  assert.equal(battle.bondPairsActive[0].key, 'archer+knight')
  assert.equal(battle.bondPairsActive[0].rank, 2)

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  assert.deepEqual(loaded.campaign.heroBonds, {
    'archer+knight': 4,
    'cleric+mage': 7
  })
  assert.ok(loaded.activeBattle)
  assert.equal(loaded.activeBattle.bondPairsActive?.length, 1)

  const restoredState = createInitialState(1)
  assert.equal(hydrateSave(restoredState, loaded), true)
  assert.deepEqual(restoredState.campaign.heroBonds, {
    'archer+knight': 4,
    'cleric+mage': 7
  })
  assert.ok(restoredState.battle)
  assert.equal(restoredState.battle.bondPairsActive.length, 1)
  assert.equal(restoredState.battle.bondPairsActive[0].rank, 2)

  // Legacy save without heroBonds or bondPairsActive defaults cleanly to {}
  const baseSave = serializeSave(createInitialState(99))
  const legacySave: SaveData = {
    version: 1,
    campaign: {
      ...baseSave.campaign,
      heroBonds: undefined
    },
    activeBattle: null
  }
  const legacyState = createInitialState(99)
  assert.equal(hydrateSave(legacyState, legacySave), true)
  assert.deepEqual(legacyState.campaign.heroBonds, {})

  // Mid-battle snapshot without bondPairsActive falls back to campaign heroBonds
  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap)
  const legacySnap = { ...snap, bondPairsActive: undefined }
  const resumed = createInitialState(2025)
  resumed.campaign.heroBonds = { 'archer+knight': 6 }
  assert.equal(restoreBattleState(resumed, legacySnap), true)
  assert.equal(resumed.battle?.bondPairsActive.length, 1)
  assert.equal(resumed.battle?.bondPairsActive[0].rank, 3)
})

test('UI art drawBattleBanterToast, drawSquadBondsStrip, drawUnitCard, and drawCombatForecast render cleanly on mobile and desktop rects', () => {
  const state = createInitialState(404)
  state.campaign.heroBonds = { 'archer+knight': 3, 'knight+mage': 6 }
  const battle = startChapterBattle(state, 0)
  flattenArena(battle)

  const knight = battle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const archer = battle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, archer, 2, 3)
  placeUnit(battle, enemy, 3, 2)
  makeActiveHero(battle, knight)
  refreshHighlights(battle, state.campaign)

  // 1. Battle Banter Toast on narrow phone (375x667) and desktop (420px)
  assert.ok(battle.activeBanter)
  const m1 = makeMockCanvasContext()
  drawBattleBanterToast(m1.ctx, { x: 12, y: 455, width: 351, height: 44 }, battle.activeBanter, { compact: true })
  assert.ok(m1.ops > 0)
  assert.ok(m1.texts.some(t => t.includes(battle.activeBanter!.text.slice(0, 18))))
  assert.ok(m1.texts.some(t => t.includes('♥ R')))

  const m1Desktop = makeMockCanvasContext()
  drawBattleBanterToast(m1Desktop.ctx, { x: 430, y: 86, width: 420, height: 46 }, battle.activeBanter, { compact: false })
  assert.ok(m1Desktop.texts.some(t => t.includes(battle.activeBanter!.text)))

  // 2. Camp Squad Bonds Strip (empty & populated, mobile & wide)
  const pairs = getSquadBondSummary(state.campaign)
  assert.equal(pairs.length, 2)
  assert.ok(formatSquadBondChip(pairs[0]).includes('♥'))
  assert.ok(formatCompactBondChip(pairs[0]).includes('♥'))

  const m2 = makeMockCanvasContext()
  drawSquadBondsStrip(m2.ctx, { x: 8, y: 100, width: 350, height: 24 }, pairs, true)
  assert.ok(m2.texts.some(t => t.includes('BONDS')))

  const m3 = makeMockCanvasContext()
  drawSquadBondsStrip(m3.ctx, { x: 8, y: 100, width: 350, height: 24 }, [], true)
  assert.ok(m3.texts.some(t => t.includes('Deploy')))

  // 3. Unit Card & Combat Forecast with +5% Bond chip (compact 212px and wide 248px)
  const assist = computeUnitBondAssist(battle, knight)
  const m4 = makeMockCanvasContext()
  drawUnitCard(m4.ctx, { x: 0, y: 0, width: 212, height: 130 }, knight, undefined, knight.speed, 'Knight', undefined, assist)
  assert.ok(m4.texts.some(t => t.includes('+5%')))

  const m4Wide = makeMockCanvasContext()
  drawUnitCard(m4Wide.ctx, { x: 0, y: 0, width: 256, height: 130 }, knight, undefined, knight.speed, 'Knight', undefined, assist)
  assert.ok(m4Wide.texts.some(t => t.includes('+5% BOND')))

  armSkill(state, null)
  const fc = computeCombatForecast(state, 3, 2)
  assert.ok(fc)
  const m5 = makeMockCanvasContext()
  drawCombatForecast(m5.ctx, { x: 0, y: 0, width: 332, height: 112 }, fc, { compact: false })
  assert.ok(m5.texts.some(t => t.includes('BOND')))
})
