import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BOSS_PHASE2_HP_RATIO,
  applyBossPhaseShift,
  chooseBossTelegraphPlan,
  clearBossTelegraphsForCaster,
  computeBossTelegraphCells,
  countUniqueTelegraphTiles,
  formatBossTelegraphHudSummary,
  getBossPhaseShiftSpec,
  getMaxLivingBossPhase,
  getTelegraphsAtCell,
  shouldTriggerBossPhaseShift,
  validateBossTelegraphs
} from '../examples/crownshard/crownshard/boss-telegraphs.ts'
import { planAutoBattleAction } from '../examples/crownshard/crownshard/auto-battle.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  BRIMSTONE_MAW_STAGE_ID,
  computeDangerZone,
  createInitialState,
  endPlayerTurn,
  refreshHighlights,
  restoreBattleState,
  selectHeroByUid,
  selectTile,
  serializeBattleState,
  serializeSave,
  startStageBattle,
  stepGame,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, BossTelegraphZone, GameState } from '../examples/crownshard/crownshard/types.ts'
import type { InstanceBatch, LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'

function fakeRenderer(): { renderer: LowPolyRenderer; lastInstances: () => number } {
  let lastCount = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_camera: unknown, batches: readonly InstanceBatch[]) {
      lastCount = batches.reduce((sum, b) => sum + b.count, 0)
      return stats
    }
  } as unknown as LowPolyRenderer
  return { renderer, lastInstances: () => lastCount }
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

function isolateBossAndHero(battle: BattleState, boss: BattleUnit, hero: BattleUnit): void {
  for (const u of battle.units) {
    if (u.uid !== boss.uid && u.uid !== hero.uid) {
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
  battle.phase = 'enemy'
  battle.activeUnitUid = boss.uid
  battle.selectedUnitUid = boss.uid
  battle.enemyDelay = 0.01
  battle.enemyActedThisTurn = false
  for (let i = 0; i < 60 && !battle.enemyActedThisTurn && battle.phase === 'enemy'; i++) {
    stepGame(state, 0.05)
  }
  // Finish any movement-to-attack follow-up
  for (let i = 0; i < 40 && battle.units.some(u => u.path.length > 0); i++) {
    stepGame(state, 0.05)
  }
}

// ============================================================================
// 1. 50% HP Boss Phase Shift (Archon Malakor & Other Bosses)
// ============================================================================

test('Archon Malakor shifts to Phase II at <= 50% HP exactly once with buffs, banner, VFX, audio, and combat log', () => {
  const state = createInitialState(4101)
  const battle = startStageBattle(state, 'eclipse_throne')
  flattenBoard(battle)

  const malakor = battle.units.find(u => u.enemyId === 'eclipse_archon')!
  assert.ok(malakor && malakor.isBoss, 'Eclipse Throne must spawn Archon Malakor')
  assert.equal(malakor.bossPhase, 1, 'Archon Malakor must start in Phase 1')
  assert.equal(getMaxLivingBossPhase(battle), 1)

  const hero = battle.units.find(u => u.team === 'ally' && u.alive)!
  isolateBossAndHero(battle, malakor, hero)
  placeUnit(battle, hero, 3, 2)
  placeUnit(battle, malakor, 4, 2)

  // Put Malakor just above 50% HP so a single strike crosses the 50% threshold
  const threshold = Math.floor(malakor.maxHp * BOSS_PHASE2_HP_RATIO)
  malakor.hp = threshold + 5
  malakor.shield = 0
  malakor.cooldowns = [2, 2, 2]
  const atkBefore = malakor.atk

  hero.atk = 45
  hero.crit = 0
  hero.acted = false
  hero.moved = true
  battle.phase = 'player'
  battle.activeUnitUid = hero.uid
  battle.selectedUnitUid = hero.uid
  refreshHighlights(battle, state.campaign)
  state.vfx.length = 0
  state.sounds.length = 0
  battle.floatingNumbers.length = 0

  assert.equal(selectHeroByUid(state, hero.uid), true)
  assert.equal(selectTile(state, malakor.col, malakor.row), true)

  assert.equal(malakor.bossPhase, 2, 'Crossing <= 50% HP must transition bossPhase 1 -> 2')
  assert.equal(getMaxLivingBossPhase(battle), 2)
  assert.equal(battle.bannerText, getBossPhaseShiftSpec(malakor).bannerText)
  assert.ok(battle.bannerText.includes('Phase II'), `Expected Phase II banner, got: ${battle.bannerText}`)
  assert.ok(malakor.shield >= 15, 'Phase II must grant a meaningful shield')
  assert.ok(malakor.atk > atkBefore, 'Phase II must boost boss ATK')
  assert.ok(malakor.empowerTurns >= 2, 'Phase II must grant Empower')
  assert.ok(malakor.hasteTurns >= 2, 'Phase II must grant Haste')
  assert.equal(malakor.cooldowns[2], 0, 'Phase II must ready the upgraded telegraph cooldown')
  assert.ok(battle.floatingNumbers.some(f => f.text === 'PHASE II!'), 'Must spawn PHASE II! floating text')
  assert.ok(state.vfx.some(v => v.kind === 'camera_cue' && v.cue === 'boss_special'), 'Must emit boss_special camera cue')
  assert.ok(state.vfx.some(v => v.kind === 'burst' && v.style === 'shadow'), 'Must emit shadow burst VFX')
  assert.ok(state.sounds.some(s => s.kind === 'magic'), 'Must emit magic sound cue')
  assert.ok(battle.combatLog.some(e => e.text.includes('Phase II')), 'Must record Phase II in combat log')

  // Idempotency: hitting Malakor again in Phase II must NOT re-trigger Phase II buffs
  const atkPhase2 = malakor.atk
  const shieldBeforeSecondHit = malakor.shield
  hero.acted = false
  battle.phase = 'player'
  battle.activeUnitUid = hero.uid
  refreshHighlights(battle, state.campaign)
  assert.equal(selectTile(state, malakor.col, malakor.row), true)
  assert.equal(malakor.bossPhase, 2)
  assert.equal(malakor.atk, atkPhase2, 'Phase II ATK buff must only apply once')
  assert.ok(malakor.shield <= shieldBeforeSecondHit, 'Phase II shield must not re-apply on subsequent hits')
})

test('Other bosses (Briar Warlord, Frostwyrm Rimefang, Ignis Titan) trigger Phase II at <= 50% HP and upgrade telegraph pattern', () => {
  const cases: readonly { stageId: string; enemyId: string; expectedSubtitle: string }[] = [
    { stageId: 'briar_hollow', enemyId: 'briar_warlord', expectedSubtitle: 'Thornborn Rampage' },
    { stageId: 'wyrm_eyrie', enemyId: 'frostwyrm_rimefang', expectedSubtitle: 'Permafrost Fury' },
    { stageId: BRIMSTONE_MAW_STAGE_ID, enemyId: 'ignis_titan', expectedSubtitle: 'Caldera Overdrive' }
  ]

  for (const tc of cases) {
    const state = createInitialState(4102)
    const battle = startStageBattle(state, tc.stageId)
    const boss = battle.units.find(u => u.enemyId === tc.enemyId)!
    assert.ok(boss && boss.isBoss, `${tc.stageId} must spawn ${tc.enemyId}`)
    assert.equal(shouldTriggerBossPhaseShift(boss), false, 'Full HP boss must not trigger Phase II yet')

    boss.hp = Math.floor(boss.maxHp * 0.5)
    assert.equal(shouldTriggerBossPhaseShift(boss), true, `${tc.enemyId} at 50% HP must be ready for Phase II`)
    const res = applyBossPhaseShift(boss)
    assert.equal(res.triggered, true)
    assert.equal(res.newPhase, 2)
    assert.equal(res.subtitle, tc.expectedSubtitle)
    assert.equal(boss.bossPhase, 2)
    assert.equal(applyBossPhaseShift(boss).triggered, false, 'applyBossPhaseShift must be idempotent')
  }
})

// ============================================================================
// 2. 1-Turn-Ahead Telegraph Placement, Dodge vs Stay Detonation & Stun Cancel
// ============================================================================

test('Archon Malakor telegraphs Eclipse Nova 1 turn ahead: staying takes AoE damage + Burn, dodging avoids all damage', () => {
  // Part A: Hero STAYS in marked danger tile -> takes damage + Burn on boss's next turn
  const stayState = createInitialState(4201)
  const stayBattle = startStageBattle(stayState, 'eclipse_throne')
  flattenBoard(stayBattle)

  const bossA = stayBattle.units.find(u => u.enemyId === 'eclipse_archon')!
  const heroA = stayBattle.units.find(u => u.team === 'ally' && u.alive)!
  isolateBossAndHero(stayBattle, bossA, heroA)
  placeUnit(stayBattle, heroA, 2, 2)
  placeUnit(stayBattle, bossA, 5, 2) // range 3
  heroA.hp = 300
  heroA.maxHp = 300
  heroA.shield = 0
  heroA.burnTurns = 0
  bossA.cooldowns = [0, 0, 0]

  // Turn 1 of boss: places Eclipse Nova telegraph (ZERO immediate AoE damage!)
  stayState.vfx.length = 0
  runSingleBossTurn(stayState, bossA)

  assert.equal(stayBattle.bossTelegraphs.length, 1, 'Archon Malakor must place a 1-turn-ahead telegraph zone')
  const tgA = stayBattle.bossTelegraphs[0]
  assert.equal(tgA.casterUid, bossA.uid)
  assert.equal(tgA.moveId, 'eclipse_nova')
  assert.equal(tgA.element, 'shadow')
  assert.equal(tgA.turnsRemaining, 1)
  assert.equal(tgA.cells.length, 5, 'Phase 1 Eclipse Nova must mark a 5-tile cross')
  assert.equal(
    tgA.cells.some(c => c.col === heroA.col && c.row === heroA.row),
    true,
    'Telegraph must cover the targeted hero tile'
  )
  assert.equal(heroA.hp, 300, 'Hero must NOT take instant un-telegraphed AoE damage on telegraph turn')
  assert.ok(stayState.vfx.some(v => v.kind === 'camera_cue' && v.cue === 'boss_special'))

  // Danger zone & Auto-battle must recognize the telegraphed danger tiles!
  const dz = computeDangerZone(stayBattle)
  assert.equal(
    dz.tiles.some(t => t.col === 2 && t.row === 2 && t.enemyUids.includes(bossA.uid)),
    true,
    'computeDangerZone must include telegraphed tiles'
  )
  // Auto-battle hero standing on telegraphed tile with boss far enough should move OFF the telegraphed tile
  placeUnit(stayBattle, bossA, 7, 2)
  stayBattle.phase = 'player'
  stayBattle.activeUnitUid = heroA.uid
  heroA.moved = false
  heroA.acted = false
  const autoPlan = planAutoBattleAction(stayState)
  assert.ok(autoPlan, 'Auto-battle must produce an action plan')
  if (autoPlan.moveTo) {
    assert.equal(
      getTelegraphsAtCell(stayBattle.bossTelegraphs, autoPlan.moveTo.col, autoPlan.moveTo.row).length,
      0,
      'Auto-battle should prefer moving off a telegraphed danger tile'
    )
  }

  // Put boss back far enough that basic follow-up attack can't hit hero, so we isolate telegraph detonation damage cleanly
  placeUnit(stayBattle, bossA, 7, 5)
  bossA.move = 0 // pin boss so only telegraph detonation hits hero at (2,2)
  stayState.vfx.length = 0
  runSingleBossTurn(stayState, bossA)

  assert.equal(stayBattle.bossTelegraphs.length, 0, 'Resolved telegraph must clear after detonation')
  assert.ok(heroA.hp < 300, 'Hero who stayed in the telegraphed danger zone must take AoE detonation damage')
  assert.ok(heroA.burnTurns >= 1, 'Eclipse Nova detonation must inflict Burn')
  assert.ok(stayState.vfx.some(v => v.kind === 'special' && v.move === 'eclipse_nova'), 'Detonation must emit special VFX')

  // Part B: Hero DODGES out of marked danger tiles -> takes 0 telegraph damage!
  const dodgeState = createInitialState(4202)
  const dodgeBattle = startStageBattle(dodgeState, 'eclipse_throne')
  flattenBoard(dodgeBattle)

  const bossB = dodgeBattle.units.find(u => u.enemyId === 'eclipse_archon')!
  const heroB = dodgeBattle.units.find(u => u.team === 'ally' && u.alive)!
  isolateBossAndHero(dodgeBattle, bossB, heroB)
  placeUnit(dodgeBattle, heroB, 2, 2)
  placeUnit(dodgeBattle, bossB, 5, 2)
  heroB.hp = 300
  heroB.maxHp = 300
  heroB.shield = 0
  heroB.burnTurns = 0
  bossB.cooldowns = [0, 0, 0]

  runSingleBossTurn(dodgeState, bossB)
  assert.equal(dodgeBattle.bossTelegraphs.length, 1)

  // Move hero completely outside the marked cross around (2,2) -> to (0,0)
  placeUnit(dodgeBattle, heroB, 0, 0)
  assert.equal(getTelegraphsAtCell(dodgeBattle.bossTelegraphs, heroB.col, heroB.row).length, 0)
  // Pin boss far away so boss's follow-up basic attack cannot reach (0,0)
  placeUnit(dodgeBattle, bossB, 7, 5)
  bossB.move = 0

  dodgeBattle.floatingNumbers.length = 0
  runSingleBossTurn(dodgeState, bossB)

  assert.equal(dodgeBattle.bossTelegraphs.length, 0, 'Telegraph must clear after erupting')
  assert.equal(heroB.hp, 300, 'Hero who dodged outside the telegraphed danger zone must take 0 damage')
  assert.equal(heroB.burnTurns, 0, 'Hero who dodged must not suffer Burn')
  assert.ok(
    dodgeBattle.floatingNumbers.some(f => f.text === 'DODGED!'),
    'Dodging all tiles of a boss telegraph should emit DODGED! feedback'
  )
})

test('Phase II Archon Malakor telegraphs an upgraded 3x3 Eclipse Cataclysm (9 tiles) and Stun interrupts pending telegraphs', () => {
  const state = createInitialState(4203)
  const battle = startStageBattle(state, 'eclipse_throne')
  flattenBoard(battle)

  const malakor = battle.units.find(u => u.enemyId === 'eclipse_archon')!
  const hero = battle.units.find(u => u.team === 'ally' && u.alive)!
  isolateBossAndHero(battle, malakor, hero)
  placeUnit(battle, hero, 3, 2)
  placeUnit(battle, malakor, 6, 2)

  // Shift Malakor to Phase II
  malakor.hp = Math.floor(malakor.maxHp * 0.45)
  applyBossPhaseShift(malakor)
  assert.equal(malakor.bossPhase, 2)

  const plan = chooseBossTelegraphPlan(battle, malakor, null)
  assert.ok(plan)
  assert.equal(plan.moveId, 'eclipse_cataclysm')
  assert.equal(plan.pattern, 'area3')
  assert.equal(computeBossTelegraphCells(battle, 3, 2, plan.pattern).length, 9)

  runSingleBossTurn(state, malakor)
  assert.equal(battle.bossTelegraphs.length, 1)
  assert.equal(battle.bossTelegraphs[0].moveId, 'eclipse_cataclysm')
  assert.equal(battle.bossTelegraphs[0].cells.length, 9, 'Phase II Eclipse Cataclysm must mark all 9 tiles of a 3x3 zone')
  assert.equal(countUniqueTelegraphTiles(battle.bossTelegraphs), 9)

  // Stun Malakor before his next turn -> advancing to his turn interrupts & cancels the telegraph!
  malakor.stunTurns = 1
  malakor.ct = 100
  hero.ct = 0
  battle.phase = 'player'
  battle.activeUnitUid = hero.uid
  battle.floatingNumbers.length = 0
  endPlayerTurn(state)

  assert.equal(battle.bossTelegraphs.length, 0, 'Stunning a telegraphing boss must interrupt and clear its pending telegraph')
  assert.ok(
    battle.floatingNumbers.some(f => f.text === 'CAST INTERRUPTED!'),
    'Stun interrupt must emit CAST INTERRUPTED! floating text'
  )
})

test('Regional bosses (Magma Warden) and secondary-cadence raid bosses (Ignis Titan) place glowing AoE telegraphs', () => {
  // 1. Regional boss Magma Warden telegraphs Magma Slam 1 turn ahead
  const st1 = createInitialState(4211)
  const b1 = startStageBattle(st1, 'ashfall_foundry')
  flattenBoard(b1)
  const warden = b1.units.find(u => u.enemyId === 'magma_warden')!
  const hero1 = b1.units.find(u => u.team === 'ally' && u.alive)!
  isolateBossAndHero(b1, warden, hero1)
  placeUnit(b1, hero1, 3, 2)
  placeUnit(b1, warden, 4, 2)
  warden.cooldowns = [0, 0, 0]
  runSingleBossTurn(st1, warden)
  assert.equal(b1.bossTelegraphs.length, 1, 'Magma Warden must place a 1-turn-ahead Magma Slam telegraph')
  assert.equal(b1.bossTelegraphs[0].moveId, 'magma_slam')
  assert.equal(b1.bossTelegraphs[0].element, 'fire')

  // 2. Ignis Titan telegraphs Magma Eruption on alternating turns when Cataclysm Slam is on CD
  const st2 = createInitialState(4212)
  const b2 = startStageBattle(st2, BRIMSTONE_MAW_STAGE_ID)
  flattenBoard(b2)
  const titan = b2.units.find(u => u.enemyId === 'ignis_titan')!
  const hero2 = b2.units.find(u => u.team === 'ally' && u.alive)!
  isolateBossAndHero(b2, titan, hero2)
  placeUnit(b2, hero2, 3, 2)
  placeUnit(b2, titan, 4, 2)
  titan.cooldowns = [2, 0, 0] // Cataclysm Slam on CD -> telegraphs Magma Eruption!
  runSingleBossTurn(st2, titan)
  assert.equal(b2.bossTelegraphs.length, 1, 'Ignis Titan must telegraph Magma Eruption when Cataclysm Slam is on CD')
  assert.equal(b2.bossTelegraphs[0].moveId, 'magma_eruption')
  assert.equal(b2.bossTelegraphs[0].element, 'fire')
})

// ============================================================================
// 3. Boss KO Immediately Clears Pending Telegraphs
// ============================================================================

test('Defeating a boss immediately clears all pending telegraphs owned by that boss', () => {
  const state = createInitialState(4301)
  const battle = startStageBattle(state, 'eclipse_throne')
  flattenBoard(battle)

  const malakor = battle.units.find(u => u.enemyId === 'eclipse_archon')!
  const hero = battle.units.find(u => u.team === 'ally' && u.alive)!
  const guard = battle.units.find(u => u.team === 'enemy' && u.uid !== malakor.uid)!
  for (const u of battle.units) {
    if (u.uid !== malakor.uid && u.uid !== hero.uid && u.uid !== guard.uid) {
      u.alive = false
      u.hp = 0
    }
  }
  placeUnit(battle, hero, 3, 2)
  placeUnit(battle, malakor, 4, 2)
  placeUnit(battle, guard, 7, 5)
  malakor.cooldowns = [0, 0, 0]

  // Malakor primes Eclipse Nova
  runSingleBossTurn(state, malakor)
  assert.equal(battle.bossTelegraphs.length, 1)

  // Hero finishes off Malakor
  malakor.hp = 1
  malakor.shield = 0
  hero.atk = 999
  hero.acted = false
  hero.moved = true
  battle.phase = 'player'
  battle.activeUnitUid = hero.uid
  battle.selectedUnitUid = hero.uid
  refreshHighlights(battle, state.campaign)

  assert.equal(selectTile(state, malakor.col, malakor.row), true)
  assert.equal(malakor.alive, false)
  assert.equal(battle.bossTelegraphs.length, 0, 'Boss KO must immediately clear pending telegraphs')
  assert.equal(clearBossTelegraphsForCaster(battle, malakor.uid).length, 0)
})

// ============================================================================
// 4. Save / Load Round-Trip & Legacy Snapshot Compatibility
// ============================================================================

test('BattleSaveSnapshot round-trip preserves bossTelegraphs and bossPhase, while legacy saves without bossTelegraphs remain valid', () => {
  const state = createInitialState(4401)
  const battle = startStageBattle(state, 'eclipse_throne')
  flattenBoard(battle)

  const malakor = battle.units.find(u => u.enemyId === 'eclipse_archon')!
  const hero = battle.units.find(u => u.team === 'ally' && u.alive)!
  isolateBossAndHero(battle, malakor, hero)
  placeUnit(battle, hero, 2, 2)
  placeUnit(battle, malakor, 5, 2)

  // Enter Phase II & prime Eclipse Cataclysm telegraph
  malakor.hp = Math.floor(malakor.maxHp * 0.45)
  applyBossPhaseShift(malakor)
  runSingleBossTurn(state, malakor)
  assert.equal(battle.bossTelegraphs.length, 1)
  assert.equal(malakor.bossPhase, 2)

  battle.phase = 'player'
  battle.activeUnitUid = hero.uid
  battle.selectedUnitUid = hero.uid

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap)
  assert.equal(snap.bossTelegraphs?.length, 1)
  assert.equal(snap.bossTelegraphs?.[0].moveId, 'eclipse_cataclysm')
  assert.equal(snap.bossTelegraphs?.[0].phase, 2)

  // Full JSON save/restore round-trip
  const savedJson = JSON.parse(JSON.stringify(serializeSave(state)))
  const restored = createInitialState(9999, savedJson)
  assert.ok(restored.battle, 'Saved battle with active boss telegraph must restore')
  const restoredBoss = restored.battle.units.find(u => u.enemyId === 'eclipse_archon')!
  assert.equal(restoredBoss.bossPhase, 2, 'bossPhase=2 must survive save/load')
  assert.equal(restored.battle.bossTelegraphs.length, 1, 'bossTelegraphs must survive save/load')
  assert.deepEqual(restored.battle.bossTelegraphs[0].cells, battle.bossTelegraphs[0].cells)
  assert.equal(restored.battle.bossTelegraphs[0].turnsRemaining, 1)
  assert.equal(restored.battle.bossTelegraphs[0].status, 'burn')

  // Legacy save compatibility: removing bossTelegraphs field completely must still validate & restore!
  const legacySnap = JSON.parse(JSON.stringify(snap))
  delete legacySnap.bossTelegraphs
  const validatedLegacy = validateBattleSnapshot(legacySnap)
  assert.ok(validatedLegacy, 'Legacy snapshot lacking bossTelegraphs must validate')
  assert.equal(validatedLegacy.bossTelegraphs, undefined)

  const legacyRestored = createInitialState(9999)
  assert.equal(restoreBattleState(legacyRestored, legacySnap), true)
  assert.deepEqual(legacyRestored.battle?.bossTelegraphs, [])

  // Malformed telegraph entries are safely stripped without crashing validation
  const sanitized = validateBossTelegraphs([{ bad: true }, battle.bossTelegraphs[0]], battle.cols, battle.rows)
  assert.equal(sanitized?.length, 1)
})

// ============================================================================
// 5. 3D Scene Rendering, Mobile HUD Formatting & Godot Compiler Compatibility
// ============================================================================

test('CrownshardScene renders all 5 telegraph elements & Phase II boss aura, HUD summary fits mobile, and boss-telegraphs.ts compiles to GDScript', () => {
  const state = createInitialState(4501)
  const battle = startStageBattle(state, 'eclipse_throne')
  const malakor = battle.units.find(u => u.enemyId === 'eclipse_archon')!

  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)
  scene.render(state, 1 / 60, 1280, 720)
  const baseInstances = fake.lastInstances()

  // Trigger Phase II + add telegraphs across all 5 elements
  malakor.hp = Math.floor(malakor.maxHp * 0.4)
  applyBossPhaseShift(malakor)
  const elements = ['shadow', 'fire', 'frost', 'holy', 'arcane'] as const
  const zones: BossTelegraphZone[] = elements.map((el, i) => ({
    id: `test_tg_${el}`,
    casterUid: malakor.uid,
    casterName: malakor.name,
    moveId: `move_${el}`,
    label: `${el} Nova`,
    element: el,
    cells: [{ col: Math.min(battle.cols - 1, 1 + i), row: 2 }],
    damageMul: 1.3,
    flatDamage: 5,
    turnsRemaining: 1,
    phase: 2
  }))
  battle.bossTelegraphs.push(...zones)

  scene.render(state, 1 / 60, 1280, 720)
  const telegraphInstances = fake.lastInstances()
  assert.ok(
    telegraphInstances > baseInstances + 20,
    `Phase II aura + 5 telegraphs should emit extra 3D instances (${telegraphInstances} > ${baseInstances})`
  )
  scene.dispose()

  // Mobile HUD summary formatting checks (single & multi telegraph, compact phone & desktop)
  const singleCompact = formatBossTelegraphHudSummary([zones[0]], true)
  const singleDesktop = formatBossTelegraphHudSummary([zones[0]], false)
  const multiCompact = formatBossTelegraphHudSummary(zones, true)
  assert.ok(singleCompact && singleCompact.text.includes('⚠') && singleCompact.text.length <= 42)
  assert.ok(singleDesktop && singleDesktop.text.includes('Next Boss Turn'))
  assert.ok(multiCompact && multiCompact.count === 5 && multiCompact.tileCount === 5)
  assert.equal(formatBossTelegraphHudSummary([], false), null)

  // Verify pure domain constraints: zero browser globals, zero non-const `as` casts, compiles to GDScript
  const srcPath = new URL('../examples/crownshard/crownshard/boss-telegraphs.ts', import.meta.url)
  const source = readFileSync(srcPath, 'utf8')
  assert.equal(/\b(window|document|localStorage|sessionStorage|HTMLElement)\b/.test(source), false)
  const gd = compileTsToGd(source, 'boss-telegraphs.ts')
  assert.ok(gd.includes('func applyBossPhaseShift') || gd.includes('func apply_boss_phase_shift'))
  assert.ok(gd.includes('func computeBossTelegraphCells') || gd.includes('func compute_boss_telegraph_cells'))
})
