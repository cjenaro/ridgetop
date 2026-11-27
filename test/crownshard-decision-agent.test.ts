import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrownshardDecisionAgent } from '../examples/crownshard/crownshard/decision-agent.ts'
import type { AutoBattleActionPlan } from '../examples/crownshard/crownshard/simulation.ts'
import {
  collectAutoBattleCandidates,
  confirmDeployment,
  createInitialState,
  executeAutoBattlePlan,
  getHeroSkill,
  getUnitByUid,
  refreshHighlights,
  setAutoBattle,
  startChapterBattle
} from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld, terrainElevation, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, GridCell, TileTerrain } from '../examples/crownshard/crownshard/types.ts'

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

function canonicalPlanKey(plan: AutoBattleActionPlan): string {
  return [
    plan.kind,
    plan.tacticUid ?? '',
    plan.skillIndex ?? '',
    plan.targetCol ?? '',
    plan.targetRow ?? '',
    plan.moveTo?.col ?? '',
    plan.moveTo?.row ?? ''
  ].join(':')
}

function setupCleanBattle(seed = 58201) {
  const state = createInitialState(seed)
  const battle = startChapterBattle(state, 0)
  if (battle.phase === 'deploy') {
    confirmDeployment(state)
  }
  flattenArena(battle, 'grass', 0)
  return { state, battle }
}

// ===========================================================================
// 1. collectAutoBattleCandidates: Deduplication, LoS, and Taunt Scoring
// ===========================================================================

test('collectAutoBattleCandidates deduplicates primary and loop candidates by action identity', () => {
  const { state, battle } = setupCleanBattle(58201)
  const actor = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  // Park all other units away and place actor adjacent to enemy
  placeUnit(battle, actor, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  for (const u of battle.units) {
    if (u.uid === actor.uid || u.uid === enemy.uid) continue
    u.alive = false
    u.hp = 0
  }
  refreshHighlights(battle, state.campaign)

  const candidates = collectAutoBattleCandidates(state, 10)
  assert.ok(candidates.length >= 2, 'Should emit at least two candidates')
  const keys = candidates.map(canonicalPlanKey)
  assert.equal(new Set(keys).size, keys.length, `Duplicate candidates emitted: ${keys.join(' | ')}`)

  // Also test when actor has already moved and acted (only end_turn is legal)
  actor.moved = true
  actor.acted = true
  const endOnly = collectAutoBattleCandidates(state, 6)
  assert.equal(endOnly.length, 1, 'Only one end_turn candidate should be emitted (not duplicated with primary)')
  assert.equal(endOnly[0].kind, 'end_turn')
})

test('collectAutoBattleCandidates enforces LoS for ranged single-target skills via isSkillIndirect', () => {
  const { state, battle } = setupCleanBattle(58202)
  // Find a ranged ally with a single-target offensive skill of range >= 3 (e.g. Ranger)
  const ranger = battle.units.find(u => {
    if (!u.alive || u.team !== 'ally') return false
    for (let i = 0; i < 3; i++) {
      const s = getHeroSkill(u, i)
      if (s && s.target === 'enemy' && s.pattern === 'single' && s.range >= 3 && s.id !== 'shadowstep' && s.id !== 'phantom_exec') {
        return true
      }
    }
    return false
  })
  assert.ok(ranger, 'Expected an ally hero with a ranged single-target skill (range >= 3)')

  // Make ranger the active unit and prevent moving so we test LoS from its exact tile
  battle.activeUnitUid = ranger.uid
  ranger.moved = true
  ranger.acted = false
  ranger.cooldowns = [0, 0, 0]

  let directSkillIdx = -1
  for (let i = 0; i < 3; i++) {
    const s = getHeroSkill(ranger, i)
    if (s && s.target === 'enemy' && s.pattern === 'single' && s.range >= 3 && s.id !== 'shadowstep' && s.id !== 'phantom_exec') {
      directSkillIdx = i
      break
    }
  }
  assert.notEqual(directSkillIdx, -1)

  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid === ranger.uid || u.uid === enemy.uid) continue
    u.alive = false
    u.hp = 0
  }

  // Place ranger at (1, 2) and enemy at (4, 2) (distance 3) with a tall pillar blocking (2, 2)
  placeUnit(battle, ranger, 1, 2)
  placeUnit(battle, enemy, 4, 2)
  battle.cells[2][2] = makeCell(2, 2, 'pillar', 2)
  refreshHighlights(battle, state.campaign)

  const blockedCandidates = collectAutoBattleCandidates(state, 10)
  const blockedDirectSkill = blockedCandidates.find(c => c.kind === 'skill' && c.skillIndex === directSkillIdx)
  assert.equal(blockedDirectSkill, undefined, 'Ranged single-target skill must not bypass pillar LoS')

  // Remove pillar -> LoS is now clear and the skill candidate should be offered
  battle.cells[2][2] = makeCell(2, 2, 'grass', 0)
  refreshHighlights(battle, state.campaign)

  const clearCandidates = collectAutoBattleCandidates(state, 10)
  const clearDirectSkill = clearCandidates.find(c => c.kind === 'skill' && c.skillIndex === directSkillIdx)
  assert.ok(clearDirectSkill, 'Ranged single-target skill should be offered when LoS is clear')
})

test('collectAutoBattleCandidates penalizes basic attacks against non-taunting enemies when taunted', () => {
  const { state, battle } = setupCleanBattle(58203)
  const actor = getUnitByUid(battle, battle.activeUnitUid)!
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  assert.ok(enemies.length >= 2, 'Expected at least 2 enemies in chapter 0 battle')

  const taunter = enemies[0]
  const other = enemies[1]
  for (const u of battle.units) {
    if (u.uid === actor.uid || u.uid === taunter.uid || u.uid === other.uid) continue
    u.alive = false
    u.hp = 0
  }

  // Lock actor in place with both enemies adjacent; give identical stats so only taunt differentiates score
  actor.moved = true
  actor.acted = false
  placeUnit(battle, actor, 3, 3)
  placeUnit(battle, taunter, 4, 3)
  placeUnit(battle, other, 2, 3)

  taunter.hp = 80
  taunter.maxHp = 80
  taunter.def = 5
  taunter.shield = 0
  taunter.tauntTurns = 2

  other.hp = 80
  other.maxHp = 80
  other.def = 5
  other.shield = 0
  other.tauntTurns = 0

  refreshHighlights(battle, state.campaign)
  const candidates = collectAutoBattleCandidates(state, 10)
  const attackTaunter = candidates.find(c => c.kind === 'attack' && c.targetCol === taunter.col && c.targetRow === taunter.row)
  const attackOther = candidates.find(c => c.kind === 'attack' && c.targetCol === other.col && c.targetRow === other.row)

  assert.ok(attackTaunter, 'Should include attack candidate on provoking taunter')
  assert.ok(attackOther, 'Should include attack candidate on non-taunting enemy (with heavy penalty)')
  assert.ok(
    attackTaunter.score - attackOther.score >= 400,
    `Expected taunter attack (${attackTaunter.score}) to outscore non-taunter (${attackOther.score}) by >= 400`
  )
})

// ===========================================================================
// 2. executeAutoBattlePlan: Preconditions & No Fallthrough to endPlayerTurn
// ===========================================================================

test('executeAutoBattlePlan validates actorUid, acted/moved flags, skill cooldowns, and never falls through to endPlayerTurn', () => {
  const { state, battle } = setupCleanBattle(58204)
  const actor = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
  placeUnit(battle, actor, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  refreshHighlights(battle, state.campaign)

  const initialUid = battle.activeUnitUid
  const initialTurn = battle.turn

  // 1. Wrong actorUid rejected without ending turn
  const wrongActorRes = executeAutoBattlePlan(state, {
    kind: 'attack',
    actorUid: 'not-the-active-actor',
    targetCol: enemy.col,
    targetRow: enemy.row,
    score: 100,
    reason: 'wrong actor'
  })
  assert.equal(wrongActorRes, false)
  assert.equal(battle.activeUnitUid, initialUid)
  assert.equal(battle.turn, initialTurn)
  assert.equal(battle.phase, 'player')

  // 2. Attack on empty tile fails without falling through to endPlayerTurn
  const badAttackRes = executeAutoBattlePlan(state, {
    kind: 'attack',
    actorUid: actor.uid,
    targetCol: 0,
    targetRow: 0,
    score: 50,
    reason: 'stale target'
  })
  assert.equal(badAttackRes, false)
  assert.equal(battle.activeUnitUid, initialUid, 'Failed attack must NOT call endPlayerTurn')
  assert.equal(battle.phase, 'player')

  // 3. Skill on cooldown rejected without falling through to endPlayerTurn
  actor.cooldowns[0] = 2
  const cdSkillRes = executeAutoBattlePlan(state, {
    kind: 'skill',
    actorUid: actor.uid,
    skillIndex: 0,
    targetCol: enemy.col,
    targetRow: enemy.row,
    score: 80,
    reason: 'cooldown skill'
  })
  assert.equal(cdSkillRes, false)
  assert.equal(battle.activeUnitUid, initialUid)
  actor.cooldowns[0] = 0

  // 4. Already-acted actor rejects attack, skill, move_and_attack, move_and_skill
  actor.acted = true
  assert.equal(
    executeAutoBattlePlan(state, {
      kind: 'attack',
      actorUid: actor.uid,
      targetCol: enemy.col,
      targetRow: enemy.row,
      score: 100,
      reason: 'already acted'
    }),
    false
  )
  assert.equal(
    executeAutoBattlePlan(state, {
      kind: 'move_and_attack',
      actorUid: actor.uid,
      moveTo: { col: 2, row: 3 },
      targetCol: enemy.col,
      targetRow: enemy.row,
      score: 100,
      reason: 'already acted'
    }),
    false
  )
  assert.equal(battle.activeUnitUid, initialUid)
  actor.acted = false

  // 5. Already-moved actor rejects move, move_and_attack, move_and_skill
  actor.moved = true
  assert.equal(
    executeAutoBattlePlan(state, {
      kind: 'move',
      actorUid: actor.uid,
      moveTo: { col: 2, row: 3 },
      score: 20,
      reason: 'already moved'
    }),
    false
  )
  assert.equal(
    executeAutoBattlePlan(state, {
      kind: 'move_and_skill',
      actorUid: actor.uid,
      moveTo: { col: 2, row: 3 },
      skillIndex: 0,
      targetCol: enemy.col,
      targetRow: enemy.row,
      score: 50,
      reason: 'already moved'
    }),
    false
  )
  assert.equal(battle.activeUnitUid, initialUid)

  // 6. Explicit end_turn succeeds and advances the turn
  const endRes = executeAutoBattlePlan(state, {
    kind: 'end_turn',
    actorUid: actor.uid,
    score: 0,
    reason: 'explicit end turn'
  })
  assert.equal(endRes, true)
  assert.notEqual(battle.activeUnitUid, initialUid)
})

// ===========================================================================
// 3. createCrownshardDecisionAgent: observe/act, staleness, screen, autoBattle
// ===========================================================================

test('createCrownshardDecisionAgent executes valid plans, rejects stale/replayed/off-screen act, and cancels autoBattle in ensurePlayable', () => {
  const { state, battle } = setupCleanBattle(58205)
  let screen = 'battle'
  let actedCallbacks = 0

  const agent = createCrownshardDecisionAgent({
    state,
    getScreen: () => screen,
    enterBattle: () => {
      startChapterBattle(state, 0)
      screen = 'battle'
    },
    confirmDeployment: () => confirmDeployment(state),
    onActed: () => {
      actedCallbacks++
    }
  })

  // ensurePlayable cancels built-in autoBattle
  setAutoBattle(state, true)
  assert.equal(battle.autoBattle, true)
  agent.ensurePlayable!()
  assert.equal(battle.autoBattle, false, 'ensurePlayable() must cancel built-in autoBattle')

  // Observe and execute a valid option
  const obs1 = agent.observe()
  assert.ok(obs1)
  assert.equal(obs1.ready, true)
  assert.ok(obs1.options.length > 0)
  const chosenId = obs1.options[0].id
  const callbacksBefore = actedCallbacks
  assert.equal(agent.act(chosenId), true, 'Valid observed option should execute')
  assert.equal(actedCallbacks, callbacksBefore + 1)

  // Replaying the same optionId immediately without re-observing must be rejected
  assert.equal(agent.act(chosenId), false, 'Replaying the same optionId must be rejected')

  // Finish any movement animation or pick a fresh battle for staleness checks
  const { state: state2, battle: battle2 } = setupCleanBattle(58206)
  let screen2 = 'battle'
  const agent2 = createCrownshardDecisionAgent({
    state: state2,
    getScreen: () => screen2,
    enterBattle: () => {
      startChapterBattle(state2, 0)
      screen2 = 'battle'
    },
    confirmDeployment: () => confirmDeployment(state2),
    onActed: () => {}
  })

  // Stale state: actor position changes between observe() and act()
  const obs2 = agent2.observe()
  assert.ok(obs2)
  assert.equal(obs2.ready, true)
  const actor2 = getUnitByUid(battle2, battle2.activeUnitUid)!
  actor2.col += 1
  assert.equal(agent2.act(obs2.options[0].id), false, 'act() must reject when actor position changed since observe()')
  actor2.col -= 1

  // Stale state: battle.ap changes between observe() and act()
  const obs3 = agent2.observe()
  assert.ok(obs3)
  battle2.ap += 1
  assert.equal(agent2.act(obs3.options[0].id), false, 'act() must reject when battle.ap changed since observe()')
  battle2.ap -= 1

  // Off-screen rejection: getScreen() !== 'battle'
  const obs4 = agent2.observe()
  assert.ok(obs4)
  screen2 = 'world_map'
  assert.equal(agent2.act(obs4.options[0].id), false, 'act() must reject when screen is not battle')
})
