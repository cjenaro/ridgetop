import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import {
  CHAPTERS,
  CHAPTER_BY_ID,
  PLAYABLE_CHAPTERS
} from '../examples/crownshard/crownshard/data.ts'
import {
  MASTERY_MILESTONES,
  canClaimMasteryMilestone,
  canClaimStageMasteryChest,
  claimMasteryMilestone,
  claimStageMasteryChest,
  createInitialState,
  endPlayerTurn,
  getClaimableMasteryMilestones,
  getMaxMasteryStars,
  getNextMasteryMilestone,
  getStageMasteryChestReward,
  getStageMasteryObjectives,
  getStageMasteryRecord,
  getStageMasteryTurnLimit,
  getThreeStarStageCount,
  getTotalMasteryStars,
  hasClaimedMasteryMilestone,
  hasClaimedStageMasteryChest,
  loadSave,
  persistSave,
  refreshHighlights,
  restoreBattleState,
  selectTile,
  serializeBattleState,
  serializeSave,
  startChapterBattle,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { SAVE_KEY } from '../examples/crownshard/crownshard/simulation.ts'
import type { BattleUnit, GameState, SaveData } from '../examples/crownshard/crownshard/types.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value) },
    removeItem: key => { store.delete(key) }
  }
}

function placeUnit(state: GameState, unit: BattleUnit, col: number, row: number): void {
  const battle = state.battle!
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

function forceActiveAlly(state: GameState, ally: BattleUnit): void {
  const battle = state.battle!
  battle.phase = 'player'
  battle.activeUnitUid = ally.uid
  battle.selectedUnitUid = ally.uid
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  ally.moved = false
  ally.acted = false
  ally.stunTurns = 0
  refreshHighlights(battle, state.campaign)
}

function findAdjacentWalkablePair(state: GameState): [{ col: number; row: number }, { col: number; row: number }] {
  const battle = state.battle!
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols - 1; c++) {
      if (battle.cells[r][c].walkable && battle.cells[r][c + 1].walkable) {
        return [{ col: c, row: r }, { col: c + 1, row: r }]
      }
    }
  }
  return [{ col: 1, row: 1 }, { col: 2, row: 1 }]
}

function winBattleByRoutingEnemies(state: GameState): void {
  const battle = state.battle!
  const ally = battle.units.find(u => u.alive && u.team === 'ally')!
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  assert.ok(enemies.length > 0, 'Battle must have at least one alive enemy')
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].alive = false
    enemies[i].hp = 0
    enemies[i].shield = 0
  }
  const last = enemies[enemies.length - 1]
  last.hp = 1
  last.shield = 0
  const [pA, pB] = findAdjacentWalkablePair(state)
  // Clear any other units sitting on pA/pB
  for (const u of battle.units) {
    if (u.uid === ally.uid || u.uid === last.uid) continue
    if ((u.col === pA.col && u.row === pA.row) || (u.col === pB.col && u.row === pB.row)) {
      u.col = 0
      u.row = 0
    }
  }
  placeUnit(state, ally, pA.col, pA.row)
  placeUnit(state, last, pB.col, pB.row)
  forceActiveAlly(state, ally)
  const struck = selectTile(state, last.col, last.row)
  assert.equal(struck, true, 'Final strike must execute cleanly')
  assert.equal(battle.phase, 'victory', 'Defeating final enemy must trigger victory')
}

// =========================================================================
// 1. PAR TURN CALCULATION & OBJECTIVES ACROSS ALL 33 CHAPTERS
// =========================================================================

test('mastery par turns and objectives cover all 33 playable chapters sensibly', () => {
  assert.equal(PLAYABLE_CHAPTERS.length, 33, 'Expected all 33 playable chapters')
  assert.equal(getMaxMasteryStars(), 99, 'Max continent stars must be 33 * 3 = 99')

  const seenKinds = new Set<string>()
  for (const ch of PLAYABLE_CHAPTERS) {
    const par = getStageMasteryTurnLimit(ch)
    assert.ok(Number.isInteger(par) && par >= 5 && par <= 20, `${ch.id} par=${par} must be a sane tactical turn par`)

    const kind = ch.objective?.kind ?? 'rout'
    seenKinds.add(kind)

    if (kind === 'defend') {
      assert.equal(par, ch.objective?.targetTurns ?? 6, `Defend stage ${ch.id} par must match targetTurns`)
    }
    if (kind === 'seize' && ch.objective?.turnLimit !== undefined) {
      assert.ok(par < ch.objective.turnLimit, `Seize stage ${ch.id} par (${par}) must be strictly tighter than turnLimit (${ch.objective.turnLimit})`)
    }

    const objectives = getStageMasteryObjectives(ch, null)
    assert.equal(objectives.length, 3, `${ch.id} must expose exactly 3 mastery objectives`)
    assert.deepEqual(objectives.map(o => o.id), ['clear', 'no_ko', 'turn_par'])
    assert.equal(objectives.every(o => o.completed === false), true)

    const chest = getStageMasteryChestReward(ch)
    assert.ok(chest.gold >= 100 && chest.dust >= 20 && chest.shards >= 15, `${ch.id} mastery chest must grant meaningful Gold/Dust/Shards`)
  }

  assert.equal(seenKinds.has('rout'), true)
  assert.equal(seenKinds.has('assassinate'), true)
  assert.equal(seenKinds.has('defend'), true)
  assert.equal(seenKinds.has('seize'), true)

  // Gauntlet (Cinder Colosseum) must allow more turns than a single-wave Tier 4 rout
  const gauntletPar = getStageMasteryTurnLimit(CHAPTER_BY_ID.cinder_colosseum)
  const regularRoutPar = getStageMasteryTurnLimit(CHAPTER_BY_ID.border_watch)
  assert.ok(gauntletPar >= 14 && gauntletPar > regularRoutPar, `Gauntlet par (${gauntletPar}) must accommodate 3 waves`)

  // Final raid boss (First Sun Sanctum) scales higher than early assassinate (Lantern Crypt)
  assert.ok(
    getStageMasteryTurnLimit(CHAPTER_BY_ID.first_sun_sanctum) > getStageMasteryTurnLimit(CHAPTER_BY_ID.lantern_crypt),
    'Final 2-phase raid boss must have a higher turn par than Act 1 assassinate'
  )
})

// =========================================================================
// 2. EARNING 1★, 2★, AND 3★ ACROSS VICTORY SCENARIOS
// =========================================================================

test('earning 3★ on a clean under-par victory with zero hero KOs', () => {
  const state = createInitialState(101)
  const ch = CHAPTERS[0] // border_watch
  const par = getStageMasteryTurnLimit(ch)
  const goldBefore = state.campaign.gold

  startChapterBattle(state, ch.index)
  state.battle!.objective.roundsElapsed = par - 2
  winBattleByRoutingEnemies(state)

  const reward = state.battle!.reward!
  assert.equal(reward.gold, ch.rewardGold, 'Base battle gold must remain untouched by mastery')
  assert.equal(state.campaign.gold, goldBefore + ch.rewardGold)
  assert.ok(reward.masteryEarned, 'BattleReward must attach masteryEarned')
  assert.equal(reward.masteryEarned!.starsEarnedThisRun, 3)
  assert.equal(reward.masteryEarned!.prevStars, 0)
  assert.equal(reward.masteryEarned!.totalStars, 3)
  assert.equal(reward.masteryEarned!.newlyEarnedStars, 3)
  assert.equal(reward.masteryEarned!.cleared, true)
  assert.equal(reward.masteryEarned!.noKo, true)
  assert.equal(reward.masteryEarned!.underPar, true)
  assert.equal(reward.masteryEarned!.turnsTaken, par - 2)
  assert.equal(reward.masteryEarned!.turnPar, par)
  assert.equal(reward.masteryEarned!.heroKoCount, 0)
  assert.equal(reward.masteryEarned!.chestUnlockedNow, true)
  assert.equal(reward.masteryEarned!.chestClaimable, true)

  const rec = getStageMasteryRecord(state.campaign, ch.id)
  assert.deepEqual(rec, {
    stars: 3,
    cleared: true,
    noKo: true,
    underPar: true,
    bestTurns: par - 2
  })
  assert.equal(getTotalMasteryStars(state.campaign), 3)
  assert.equal(getThreeStarStageCount(state.campaign), 1)
})

test('earning 2★ when over par (zero KOs) or when a hero is downed/fallen at victory, and 1★ when both fail', () => {
  const ch = CHAPTERS[0]
  const par = getStageMasteryTurnLimit(ch)

  // Case A: Over par, 0 KOs -> 2★ (clear + no_ko)
  const sA = createInitialState(201)
  startChapterBattle(sA, ch.index)
  sA.battle!.objective.roundsElapsed = par + 4
  winBattleByRoutingEnemies(sA)
  assert.equal(sA.battle!.reward!.masteryEarned!.starsEarnedThisRun, 2)
  assert.equal(sA.battle!.reward!.masteryEarned!.noKo, true)
  assert.equal(sA.battle!.reward!.masteryEarned!.underPar, false)
  assert.equal(sA.battle!.reward!.masteryEarned!.chestClaimable, false)

  // Case B: Under par, 1 ally currently downed at victory -> 2★ (clear + turn_par)
  const sB = createInitialState(202)
  startChapterBattle(sB, ch.index)
  sB.battle!.objective.roundsElapsed = Math.max(1, par - 1)
  const alliesB = sB.battle!.units.filter(u => u.team === 'ally')
  alliesB[1].alive = false
  alliesB[1].hp = 0
  alliesB[1].downed = true
  alliesB[1].koCountdown = 2
  winBattleByRoutingEnemies(sB)
  assert.equal(sB.battle!.reward!.masteryEarned!.starsEarnedThisRun, 2)
  assert.equal(sB.battle!.reward!.masteryEarned!.noKo, false)
  assert.equal(sB.battle!.reward!.masteryEarned!.underPar, true)
  assert.equal(sB.battle!.reward!.masteryEarned!.heroKoCount, 1)

  // Case C: Over par AND an ally permanently fell via KO countdown -> 1★ (clear only)
  const sC = createInitialState(203)
  startChapterBattle(sC, ch.index)
  const alliesC = sC.battle!.units.filter(u => u.team === 'ally')
  // Simulate an ally reaching koCountdown === 1 with ct >= 100 so ending turn triggers permanent FALLEN!
  alliesC[2].alive = false
  alliesC[2].hp = 0
  alliesC[2].downed = true
  alliesC[2].koCountdown = 1
  alliesC[2].ct = 120
  forceActiveAlly(sC, alliesC[0])
  endPlayerTurn(sC)
  assert.equal(alliesC[2].downed, false, 'Countdown expiration must mark ally permanently fallen')
  assert.equal(sC.battle!.anyHeroFallen, true, 'BattleState.anyHeroFallen must latch true on permanent fall')
  assert.equal(sC.battle!.heroKoCount, 1, 'BattleState.heroKoCount must increment on permanent fall')

  sC.battle!.objective.roundsElapsed = par + 5
  winBattleByRoutingEnemies(sC)
  assert.equal(sC.battle!.reward!.masteryEarned!.starsEarnedThisRun, 1)
  assert.equal(sC.battle!.reward!.masteryEarned!.cleared, true)
  assert.equal(sC.battle!.reward!.masteryEarned!.noKo, false)
  assert.equal(sC.battle!.reward!.masteryEarned!.underPar, false)
  assert.equal(sC.battle!.reward!.masteryEarned!.heroKoCount, 1)
})

test('reviving a downed hero before victory preserves the Zero Hero KOs star', () => {
  const state = createInitialState(209)
  const ch = CHAPTERS[0]
  const par = getStageMasteryTurnLimit(ch)
  startChapterBattle(state, ch.index)
  const allies = state.battle!.units.filter(u => u.team === 'ally')

  // Ally 1 gets downed temporarily, then revived before countdown hits 0
  allies[1].alive = false
  allies[1].hp = 0
  allies[1].downed = true
  allies[1].koCountdown = 2
  // Revive them back into the fight
  allies[1].alive = true
  allies[1].downed = false
  allies[1].koCountdown = 0
  allies[1].hp = Math.round(allies[1].maxHp * 0.5)

  state.battle!.objective.roundsElapsed = par - 1
  winBattleByRoutingEnemies(state)

  assert.equal(state.battle!.anyHeroFallen, false)
  assert.equal(state.battle!.reward!.masteryEarned!.noKo, true)
  assert.equal(state.battle!.reward!.masteryEarned!.starsEarnedThisRun, 3)
})

test('defend stage Star 3 requires targetTurns par and unbreached protect tile', () => {
  const ch = CHAPTER_BY_ID.sunken_bridge
  const par = getStageMasteryTurnLimit(ch)
  assert.equal(par, 6)

  // Intact survival / clear within 6 turns -> 3★
  const s1 = createInitialState(301)
  startChapterBattle(s1, ch.index)
  s1.battle!.objective.roundsElapsed = 6
  winBattleByRoutingEnemies(s1)
  assert.equal(s1.battle!.reward!.masteryEarned!.underPar, true)
  assert.equal(s1.battle!.reward!.masteryEarned!.starsEarnedThisRun, 3)

  // Over 6 turns -> fails Star 3
  const s2 = createInitialState(302)
  startChapterBattle(s2, ch.index)
  s2.battle!.objective.roundsElapsed = 8
  winBattleByRoutingEnemies(s2)
  assert.equal(s2.battle!.reward!.masteryEarned!.underPar, false)
  assert.equal(s2.battle!.reward!.masteryEarned!.starsEarnedThisRun, 2)
})

test('endless mode victory does not overwrite campaign stage mastery', () => {
  const state = createInitialState(305)
  const throneIdx = CHAPTER_BY_ID.eclipse_throne.index
  startChapterBattle(state, throneIdx, 1)
  winBattleByRoutingEnemies(state)
  assert.equal(state.battle!.reward!.masteryEarned, undefined)
  assert.equal(getStageMasteryRecord(state.campaign, 'eclipse_throne').stars, 0)
})

// =========================================================================
// 3. INCREMENTAL STAR UPGRADES ACROSS REPLAYS
// =========================================================================

test('incremental star upgrades merge Star 2 from run 1 and Star 3 from run 2 into 3★ total', () => {
  const state = createInitialState(401)
  const ch = CHAPTERS[0] // border_watch
  const par = getStageMasteryTurnLimit(ch)

  // Run 1: Zero Hero KOs, but over par (11 turns) -> 2★ (clear + no_ko)
  startChapterBattle(state, ch.index)
  state.battle!.objective.roundsElapsed = par + 4
  winBattleByRoutingEnemies(state)

  const eval1 = state.battle!.reward!.masteryEarned!
  assert.equal(eval1.starsEarnedThisRun, 2)
  assert.equal(eval1.prevStars, 0)
  assert.equal(eval1.totalStars, 2)
  assert.equal(eval1.newlyEarnedStars, 2)
  assert.equal(eval1.chestUnlockedNow, false)
  assert.equal(canClaimStageMasteryChest(state.campaign, ch.id), false)
  assert.equal(getStageMasteryRecord(state.campaign, ch.id).bestTurns, par + 4)

  // Run 2: Fast rush within par (par - 2 turns), but 1 hero is downed -> 2★ this run, merges to 3★ total!
  startChapterBattle(state, ch.index)
  state.battle!.objective.roundsElapsed = par - 2
  const allies = state.battle!.units.filter(u => u.team === 'ally')
  allies[1].alive = false
  allies[1].hp = 0
  allies[1].downed = true
  allies[1].koCountdown = 2
  winBattleByRoutingEnemies(state)

  const eval2 = state.battle!.reward!.masteryEarned!
  assert.equal(eval2.starsEarnedThisRun, 2)
  assert.equal(eval2.prevStars, 2)
  assert.equal(eval2.totalStars, 3, 'Cumulative stars must upgrade to 3★')
  assert.equal(eval2.newlyEarnedStars, 1)
  assert.equal(eval2.chestUnlockedNow, true, 'Reaching 3★ must unlock the stage Mastery Chest')
  assert.equal(eval2.chestClaimable, true)
  assert.equal(canClaimStageMasteryChest(state.campaign, ch.id), true)

  const rec2 = getStageMasteryRecord(state.campaign, ch.id)
  assert.deepEqual(rec2, {
    stars: 3,
    cleared: true,
    noKo: true,
    underPar: true,
    bestTurns: par - 2
  })

  // Run 3: Slower replay does NOT regress bestTurns or stars
  startChapterBattle(state, ch.index)
  state.battle!.objective.roundsElapsed = par + 6
  winBattleByRoutingEnemies(state)
  const rec3 = getStageMasteryRecord(state.campaign, ch.id)
  assert.equal(rec3.stars, 3)
  assert.equal(rec3.bestTurns, par - 2, 'bestTurns must retain the fastest clear')
  assert.equal(state.battle!.reward!.masteryEarned!.newlyEarnedStars, 0)
  assert.equal(state.battle!.reward!.masteryEarned!.chestUnlockedNow, false)
})

// =========================================================================
// 4. ONE-TIME STAGE MASTERY CHEST & CONTINENT MILESTONE CHEST CLAIMS
// =========================================================================

test('per-stage 3★ Mastery Chest rejects <3★ and double claims, awards Gold/Dust/Shards once', () => {
  const state = createInitialState(501)
  const ch = CHAPTER_BY_ID.eclipse_throne
  const expected = getStageMasteryChestReward(ch)

  // Reject on 0★
  const r0 = claimStageMasteryChest(state, ch.id)
  assert.equal(r0.ok, false)

  // Reject on unknown stage
  const rUnknown = claimStageMasteryChest(state, 'nonexistent_stage')
  assert.equal(rUnknown.ok, false)

  // Reject on 2★
  state.campaign.clearedStageIds.push(ch.id)
  state.campaign.stageMastery[ch.id] = { stars: 2, cleared: true, noKo: true, underPar: false, bestTurns: 14 }
  assert.equal(canClaimStageMasteryChest(state.campaign, ch.id), false)
  const r2 = claimStageMasteryChest(state, ch.id)
  assert.equal(r2.ok, false)

  // Upgrade to 3★ and claim once
  state.campaign.stageMastery[ch.id] = { stars: 3, cleared: true, noKo: true, underPar: true, bestTurns: 9 }
  assert.equal(canClaimStageMasteryChest(state.campaign, ch.id), true)
  const goldBefore = state.campaign.gold
  const dustBefore = state.campaign.dust
  const shardsBefore = state.campaign.shards
  const soundsBefore = state.sounds.length

  const rOk = claimStageMasteryChest(state, ch.id)
  assert.equal(rOk.ok, true)
  assert.equal(rOk.gold, expected.gold)
  assert.equal(rOk.dust, expected.dust)
  assert.equal(rOk.shards, expected.shards)
  assert.equal(state.campaign.gold, goldBefore + expected.gold)
  assert.equal(state.campaign.dust, dustBefore + expected.dust)
  assert.equal(state.campaign.shards, shardsBefore + expected.shards)
  assert.equal(state.sounds.length, soundsBefore + 1)
  assert.equal(hasClaimedStageMasteryChest(state.campaign, ch.id), true)
  assert.equal(canClaimStageMasteryChest(state.campaign, ch.id), false)

  // Reject double-claim
  const rDouble = claimStageMasteryChest(state, ch.id)
  assert.equal(rDouble.ok, false)
  assert.equal(state.campaign.gold, goldBefore + expected.gold)
})

test('continent-wide star Milestone Chests unlock across thresholds and reject invalid/early/double claims', () => {
  const state = createInitialState(502)

  // Reject invalid milestone and early claim
  assert.equal(claimMasteryMilestone(state, 999).ok, false)
  assert.equal(claimMasteryMilestone(state, 15).ok, false)
  assert.equal(canClaimMasteryMilestone(state.campaign, 15), false)
  assert.equal(getClaimableMasteryMilestones(state.campaign).length, 0)
  assert.equal(getNextMasteryMilestone(state.campaign)?.threshold, 15)

  // Give 14 stars across stages 1..5 (4*3 + 1*2 = 14★), then win stage 0 with 3★ to cross 15★!
  for (let i = 1; i <= 4; i++) {
    const id = PLAYABLE_CHAPTERS[i].id
    state.campaign.clearedStageIds.push(id)
    state.campaign.stageMastery[id] = { stars: 3, cleared: true, noKo: true, underPar: true, bestTurns: 5 }
  }
  const id5 = PLAYABLE_CHAPTERS[5].id
  state.campaign.clearedStageIds.push(id5)
  state.campaign.stageMastery[id5] = { stars: 2, cleared: true, noKo: true, underPar: false, bestTurns: 12 }
  assert.equal(getTotalMasteryStars(state.campaign), 14)

  // Win border_watch cleanly for 3★ -> total becomes 17★, unlocking 15★ milestone!
  startChapterBattle(state, 0)
  state.battle!.objective.roundsElapsed = 3
  winBattleByRoutingEnemies(state)
  assert.deepEqual(state.battle!.reward!.masteryEarned!.newlyUnlockedMilestones, [15])
  assert.equal(getTotalMasteryStars(state.campaign), 17)
  assert.equal(canClaimMasteryMilestone(state.campaign, 15), true)
  assert.deepEqual(getClaimableMasteryMilestones(state.campaign).map(m => m.threshold), [15])

  // Claim 15★ milestone
  const spec15 = MASTERY_MILESTONES[0]
  const g0 = state.campaign.gold
  const d0 = state.campaign.dust
  const s0 = state.campaign.shards
  const c15 = claimMasteryMilestone(state, 15)
  assert.equal(c15.ok, true)
  assert.equal(c15.gold, spec15.gold)
  assert.equal(c15.dust, spec15.dust)
  assert.equal(c15.shards, spec15.shards)
  assert.equal(state.campaign.gold, g0 + spec15.gold)
  assert.equal(state.campaign.dust, d0 + spec15.dust)
  assert.equal(state.campaign.shards, s0 + spec15.shards)
  assert.equal(hasClaimedMasteryMilestone(state.campaign, 15), true)
  assert.equal(claimMasteryMilestone(state, 15).ok, false, 'Must reject double-claim of milestone')
  assert.equal(getNextMasteryMilestone(state.campaign)?.threshold, 30)

  // Perfect all 33 chapters (99★) and claim remaining milestones 30, 50, 75, 99
  for (const ch of PLAYABLE_CHAPTERS) {
    if (!state.campaign.clearedStageIds.includes(ch.id)) state.campaign.clearedStageIds.push(ch.id)
    state.campaign.stageMastery[ch.id] = { stars: 3, cleared: true, noKo: true, underPar: true, bestTurns: 4 }
  }
  assert.equal(getTotalMasteryStars(state.campaign), 99)
  assert.equal(getThreeStarStageCount(state.campaign), 33)
  assert.deepEqual(getClaimableMasteryMilestones(state.campaign).map(m => m.threshold), [30, 50, 75, 99])

  for (const threshold of [30, 50, 75, 99]) {
    const res = claimMasteryMilestone(state, threshold)
    assert.equal(res.ok, true, `Milestone ${threshold}★ must claim cleanly`)
  }
  assert.equal(getClaimableMasteryMilestones(state.campaign).length, 0)
  assert.equal(getNextMasteryMilestone(state.campaign), null)
})

// =========================================================================
// 5. SAVE / RESUME ROUND-TRIP & LEGACY SAVE BACKWARDS COMPATIBILITY
// =========================================================================

test('campaign mastery records, chest claims, and milestones round-trip cleanly through serializeSave & loadSave', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(601)

  // Earn 3★ on first 5 stages (15★), claim chest on stage 0 and milestone 15★
  for (let i = 0; i < 5; i++) {
    const ch = PLAYABLE_CHAPTERS[i]
    state.campaign.clearedStageIds.push(ch.id)
    state.campaign.stageMastery[ch.id] = { stars: 3, cleared: true, noKo: true, underPar: true, bestTurns: 4 + i }
  }
  state.campaign.chaptersCleared = 5
  assert.equal(claimStageMasteryChest(state, PLAYABLE_CHAPTERS[0].id).ok, true)
  assert.equal(claimMasteryMilestone(state, 15).ok, true)

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded, 'loadSave must parse saved data')
  const restored = createInitialState(601, loaded)

  assert.equal(getTotalMasteryStars(restored.campaign), 15)
  assert.deepEqual(restored.campaign.stageMastery[PLAYABLE_CHAPTERS[0].id], {
    stars: 3, cleared: true, noKo: true, underPar: true, bestTurns: 4
  })
  assert.equal(hasClaimedStageMasteryChest(restored.campaign, PLAYABLE_CHAPTERS[0].id), true)
  assert.equal(hasClaimedMasteryMilestone(restored.campaign, 15), true)
  assert.equal(canClaimStageMasteryChest(restored.campaign, PLAYABLE_CHAPTERS[0].id), false)
  assert.equal(canClaimStageMasteryChest(restored.campaign, PLAYABLE_CHAPTERS[1].id), true)
})

test('legacy save without mastery fields loads cleanly and awards 1★ to already-cleared stages', () => {
  const storage = createMemoryStorage()
  const base = createInitialState(602)
  base.campaign.clearedStageIds = ['border_watch', 'sunken_bridge']
  base.campaign.chaptersCleared = 2
  const rawSave = serializeSave(base)
  // Strip mastery fields to emulate a legacy pre-mastery save
  const legacyObj = JSON.parse(JSON.stringify(rawSave)) as Record<string, Record<string, unknown>>
  delete legacyObj.campaign.stageMastery
  delete legacyObj.campaign.claimedStageMasteryChests
  delete legacyObj.campaign.claimedMasteryMilestones
  storage.setItem(SAVE_KEY, JSON.stringify(legacyObj))

  const loaded = loadSave(storage)
  assert.ok(loaded, 'Legacy save must load cleanly')
  const restored = createInitialState(602, loaded)

  assert.deepEqual(restored.campaign.stageMastery.border_watch, {
    stars: 1, cleared: true, noKo: false, underPar: false
  })
  assert.deepEqual(restored.campaign.stageMastery.sunken_bridge, {
    stars: 1, cleared: true, noKo: false, underPar: false
  })
  assert.equal(getTotalMasteryStars(restored.campaign), 2)
  assert.deepEqual(restored.campaign.claimedStageMasteryChests, [])
  assert.deepEqual(restored.campaign.claimedMasteryMilestones, [])

  // Replaying a legacy-cleared stage upgrades it from 1★ to 3★ cleanly
  startChapterBattle(restored, 0)
  restored.battle!.objective.roundsElapsed = 3
  winBattleByRoutingEnemies(restored)
  assert.equal(restored.battle!.reward!.masteryEarned!.prevStars, 1)
  assert.equal(restored.battle!.reward!.masteryEarned!.totalStars, 3)
  assert.equal(restored.battle!.reward!.masteryEarned!.newlyEarnedStars, 2)
  assert.equal(restored.battle!.reward!.masteryEarned!.chestUnlockedNow, true)
})

test('mid-battle BattleSaveSnapshot preserves heroKoCount & anyHeroFallen across save/resume', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(603)
  startChapterBattle(state, 0)
  const battle = state.battle!
  const allies = battle.units.filter(u => u.team === 'ally')

  // Simulate ally 2 permanently falling mid-battle
  allies[2].alive = false
  allies[2].hp = 0
  allies[2].downed = false
  allies[2].koCountdown = 0
  battle.heroKoCount = 1
  battle.anyHeroFallen = true

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap)
  assert.equal(snap!.heroKoCount, 1)
  assert.equal(snap!.anyHeroFallen, true)

  const validated = validateBattleSnapshot(snap)
  assert.ok(validated)
  assert.equal(validated!.heroKoCount, 1)
  assert.equal(validated!.anyHeroFallen, true)

  // Save & restore full state
  persistSave(storage, state)
  const loaded = loadSave(storage) as SaveData
  const resumed = createInitialState(603, loaded)
  assert.ok(resumed.battle)
  assert.equal(resumed.battle!.heroKoCount, 1)
  assert.equal(resumed.battle!.anyHeroFallen, true)

  // Finish the resumed battle quickly -> Star 2 (no_ko) MUST remain failed!
  resumed.battle!.objective.roundsElapsed = 3
  winBattleByRoutingEnemies(resumed)
  assert.equal(resumed.battle!.reward!.masteryEarned!.noKo, false)
  assert.equal(resumed.battle!.reward!.masteryEarned!.underPar, true)
  assert.equal(resumed.battle!.reward!.masteryEarned!.starsEarnedThisRun, 2)

  // Legacy battle snapshot without heroKoCount/anyHeroFallen restores cleanly and infers fallen allies
  const legacySnap = JSON.parse(JSON.stringify(snap)) as Record<string, unknown>
  delete legacySnap.heroKoCount
  delete legacySnap.anyHeroFallen
  const legacyResumed = createInitialState(604)
  assert.equal(restoreBattleState(legacyResumed, legacySnap), true)
  assert.equal(legacyResumed.battle!.heroKoCount, 1)
  assert.equal(legacyResumed.battle!.anyHeroFallen, true)
})

// =========================================================================
// 6. GODOT COMPILER COMPATIBILITY & PACKAGE REGISTRATION
// =========================================================================

test('mastery.ts is browser-global-free, registered in godotEntries, and compiles cleanly via compileTsToGd', () => {
  const masteryPath = resolve('examples/crownshard/crownshard/mastery.ts')
  const source = readFileSync(masteryPath, 'utf8')

  for (const forbidden of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'HTMLElement']) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`).test(source),
      false,
      `mastery.ts must not reference browser global "${forbidden}"`
    )
  }

  const pkg = JSON.parse(readFileSync(resolve('examples/crownshard/package.json'), 'utf8')) as {
    ridgetop?: { godotEntries?: string[] }
  }
  assert.ok(
    pkg.ridgetop?.godotEntries?.includes('crownshard/mastery.ts'),
    'examples/crownshard/package.json ridgetop.godotEntries must include "crownshard/mastery.ts"'
  )

  const gd = compileTsToGd(source, 'mastery.ts')
  assert.ok(gd.length > 200, 'compileTsToGd must emit non-trivial GDScript for mastery.ts')
  assert.ok(gd.includes('func getStageMasteryTurnLimit'), 'GDScript output must contain getStageMasteryTurnLimit')
  assert.ok(gd.includes('func claimStageMasteryChest'), 'GDScript output must contain claimStageMasteryChest')
  assert.ok(gd.includes('func claimMasteryMilestone'), 'GDScript output must contain claimMasteryMilestone')
})
