import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BLOOD_MOON_DAMAGE_MUL,
  BLOOD_MOON_MELEE_DRAIN,
  FOG_OF_WAR_VISION_RADIUS,
  IRON_VANGUARD_DEF_BONUS,
  STAGE_MUTATOR_IDS,
  STAGE_MUTATOR_SPECS,
  STAGE_TIER_SPECS,
  armSkill,
  armTacticCard,
  computeChallengeRewards,
  computeCombatForecast,
  computeIronVanguardShield,
  computeMoveAttackTiles,
  computeScaledEnemyStats,
  computeTacticTargetTiles,
  computeTargetTiles,
  createInitialState,
  endPlayerTurn,
  getHighestClearedStageTier,
  hasMutator,
  isEnemyShrouded,
  isTileRevealedInFog,
  isUnitVisibleToPlayer,
  loadSave,
  persistSave,
  recordClearedStageTier,
  refreshHighlights,
  resolveStageChallenge,
  restoreBattleState,
  selectTile,
  serializeBattleState,
  serializeSave,
  startChapterBattle,
  startStageBattle,
  stepGame,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { CHAPTERS, ENEMY_SPECS, EQUIPMENT_BY_ID, HERO_SPECS, RARITY_ORDER, TACTIC_BY_ID } from '../examples/crownshard/crownshard/data.ts'
import type { BattleUnit, GameState, Rarity, SaveData, StageDifficultyTier, StageMutatorId } from '../examples/crownshard/crownshard/types.ts'
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

function makeClearedState(chapterIndex = 0, seed = 4242): GameState {
  const state = createInitialState(seed)
  const chapter = CHAPTERS[chapterIndex]
  state.campaign.clearedStageIds.push(chapter.id)
  state.campaign.chaptersCleared = state.campaign.clearedStageIds.length
  recordClearedStageTier(state.campaign, chapter.id, 'normal')
  return state
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

function winBattleByRoutingEnemies(state: GameState): void {
  const battle = state.battle!
  const ally = battle.units.find(u => u.alive && u.team === 'ally')!
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  // Leave only the last enemy alive with 1 HP adjacent to our ally, defeat the rest
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].alive = false
    enemies[i].hp = 0
    enemies[i].shield = 0
  }
  const last = enemies[enemies.length - 1]
  last.hp = 1
  last.shield = 0
  placeUnit(state, ally, 2, 2)
  placeUnit(state, last, 3, 2)
  forceActiveAlly(state, ally)
  const struck = selectTile(state, last.col, last.row)
  assert.equal(struck, true, 'Final blow must execute cleanly')
  assert.equal(battle.phase, 'victory', 'Routing last enemy must trigger victory')
}

// =========================================================================
// 1. CLEARED-STAGE GATING & BACKWARDS COMPATIBILITY
// =========================================================================

test('gating: uncleared stages and endless waves clamp difficultyTier to normal with no mutators', () => {
  const state = createInitialState(101)
  const chapter = CHAPTERS[0]

  const res = resolveStageChallenge(state.campaign, chapter.id, 'mythic', ['blood_moon', 'fog_of_war'], 0)
  assert.equal(res.eligible, false)
  assert.equal(res.tier, 'normal')
  assert.deepEqual(res.mutators, [])

  // Requesting Mythic + mutators on an uncleared stage must clamp cleanly to Normal + []
  const b1 = startChapterBattle(state, 0, 0, { tier: 'mythic', mutators: ['blood_moon', 'iron_vanguard'] })
  assert.equal(b1.difficultyTier, 'normal')
  assert.deepEqual(b1.mutators, [])

  // Mark stage cleared -> now Veteran/Mythic + mutators are permitted
  state.campaign.clearedStageIds.push(chapter.id)
  const b2 = startChapterBattle(state, 0, { tier: 'veteran', mutators: ['venom_mist', 'blood_moon', 'blood_moon'] })
  assert.equal(b2.difficultyTier, 'veteran')
  // Deduplicated and sorted in canonical mutator order
  assert.deepEqual(b2.mutators, ['blood_moon', 'venom_mist'])

  // startStageBattle also supports options as 3rd argument
  const b3 = startStageBattle(state, chapter.id, { tier: 'mythic', mutators: ['fog_of_war'] })
  assert.equal(b3.difficultyTier, 'mythic')
  assert.deepEqual(b3.mutators, ['fog_of_war'])

  // Endless waves always clamp to normal with no stage mutators
  const bEndless = startChapterBattle(state, 0, 2, { tier: 'mythic', mutators: ['blood_moon'] })
  assert.equal(bEndless.difficultyTier, 'normal')
  assert.deepEqual(bEndless.mutators, [])

  // Default 2-arg call stays 100% backwards-compatible
  const bDefault = startChapterBattle(state, 0)
  assert.equal(bDefault.difficultyTier, 'normal')
  assert.deepEqual(bDefault.mutators, [])
})

// =========================================================================
// 2. ENEMY STAT SCALING: NORMAL vs VETERAN vs MYTHIC
// =========================================================================

test('enemy scaling: Veteran and Mythic apply exact HP, ATK, DEF, SPD scaling vs Normal', () => {
  const state = makeClearedState(0, 777)
  const chapter = CHAPTERS[0]

  const normalBattle = startChapterBattle(state, 0, 0, { tier: 'normal' })
  const normalEnemies = normalBattle.units.filter(u => u.team === 'enemy')

  const vetBattle = startChapterBattle(state, 0, 0, { tier: 'veteran' })
  const vetEnemies = vetBattle.units.filter(u => u.team === 'enemy')

  const mythicBattle = startChapterBattle(state, 0, 0, { tier: 'mythic' })
  const mythicEnemies = mythicBattle.units.filter(u => u.team === 'enemy')

  assert.equal(normalEnemies.length, chapter.enemies.length)
  assert.equal(vetEnemies.length, chapter.enemies.length)
  assert.equal(mythicEnemies.length, chapter.enemies.length)

  for (let i = 0; i < chapter.enemies.length; i++) {
    const spawn = chapter.enemies[i]
    const spec = ENEMY_SPECS[spawn.id]
    const scale = spawn.levelScale ?? 1
    const base = {
      maxHp: Math.round(spec.maxHp * scale),
      atk: Math.round(spec.atk * scale),
      def: Math.round(spec.def * (1 + (scale - 1) * 0.5)),
      speed: spec.speed,
      baseShield: spec.isBoss ? 25 : 0
    }

    const n = normalEnemies[i]
    assert.equal(n.maxHp, base.maxHp)
    assert.equal(n.atk, base.atk)
    assert.equal(n.def, base.def)
    assert.equal(n.speed, base.speed)
    assert.equal(n.shield, base.baseShield)

    const vExpected = computeScaledEnemyStats(base, 'veteran')
    const v = vetEnemies[i]
    assert.equal(v.maxHp, Math.round(base.maxHp * STAGE_TIER_SPECS.veteran.hpMul))
    assert.equal(v.hp, vExpected.maxHp)
    assert.equal(v.atk, Math.round(base.atk * STAGE_TIER_SPECS.veteran.atkMul))
    assert.equal(v.def, base.def + STAGE_TIER_SPECS.veteran.defBonus)
    assert.equal(v.speed, base.speed + STAGE_TIER_SPECS.veteran.speedBonus)

    const mExpected = computeScaledEnemyStats(base, 'mythic')
    const m = mythicEnemies[i]
    assert.equal(m.maxHp, Math.round(base.maxHp * STAGE_TIER_SPECS.mythic.hpMul))
    assert.equal(m.hp, mExpected.maxHp)
    assert.equal(m.atk, Math.round(base.atk * STAGE_TIER_SPECS.mythic.atkMul))
    assert.equal(m.def, base.def + STAGE_TIER_SPECS.mythic.defBonus)
    assert.equal(m.speed, base.speed + STAGE_TIER_SPECS.mythic.speedBonus)

    assert.ok(m.maxHp > v.maxHp && v.maxHp > n.maxHp)
    assert.ok(m.atk > v.atk && v.atk > n.atk)
    assert.ok(m.def > v.def && v.def > n.def)
    assert.ok(m.speed > v.speed && v.speed > n.speed)
  }
})

// =========================================================================
// 3. MUTATOR: BLOOD MOON (+25% DMG, 15% MELEE DRAIN, FORECAST PARITY)
// =========================================================================

test('mutator blood_moon: +25% damage with CombatForecast parity and 15% melee HP drain', () => {
  const baseState = makeClearedState(0, 5050)
  const bmState = makeClearedState(0, 5050)

  const baseBattle = startChapterBattle(baseState, 0, 0, { tier: 'normal', mutators: [] })
  const bmBattle = startChapterBattle(bmState, 0, 0, { tier: 'normal', mutators: ['blood_moon'] })
  assert.equal(hasMutator(bmBattle, 'blood_moon'), true)

  const baseKnight = baseBattle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const baseEnemy = baseBattle.units.find(u => u.team === 'enemy')!
  const bmKnight = bmBattle.units.find(u => u.team === 'ally' && u.heroId === 'knight')!
  const bmEnemy = bmBattle.units.find(u => u.team === 'enemy')!

  // Place knight & enemy on identical flat grass tiles with 0 crit for deterministic damage check
  for (const [st, k, e] of [
    [baseState, baseKnight, baseEnemy],
    [bmState, bmKnight, bmEnemy]
  ] as const) {
    st.battle!.cells[2][2].terrain = 'grass'
    st.battle!.cells[2][3].terrain = 'grass'
    k.crit = 0
    k.lifesteal = 0
    k.hp = Math.max(10, k.maxHp - 30)
    k.facing = 'e'
    e.hp = 200
    e.maxHp = 200
    e.shield = 0
    e.facing = 'w' // frontal arc
    placeUnit(st, k, 2, 2)
    placeUnit(st, e, 3, 2)
    // Move other allies away so no pincer interferes
    let off = 0
    for (const u of st.battle!.units) {
      if (u.uid !== k.uid && u.uid !== e.uid && u.alive) {
        placeUnit(st, u, 0, off++)
      }
    }
    forceActiveAlly(st, k)
  }

  const baseFc = computeCombatForecast(baseState, 3, 2)!
  const bmFc = computeCombatForecast(bmState, 3, 2)!
  assert.ok(baseFc && bmFc)
  assert.ok(
    bmFc.normalDmg > baseFc.normalDmg,
    `Blood Moon forecast damage (${bmFc.normalDmg}) must exceed normal (${baseFc.normalDmg})`
  )
  // Counter damage also scales by +25% under Blood Moon
  assert.ok(
    (bmFc.counterDmg ?? 0) > (baseFc.counterDmg ?? 0),
    `Blood Moon counter damage (${bmFc.counterDmg}) must exceed normal (${baseFc.counterDmg})`
  )

  // Verify exact expected raw damage math: Math.round(atk * 1.25 - def * 0.72)
  const expectedBmDmg = Math.max(4, Math.round(bmKnight.atk * BLOOD_MOON_DAMAGE_MUL - bmEnemy.def * 0.72))
  assert.equal(bmFc.normalDmg, expectedBmDmg)

  // Stun enemy so we isolate attacker hit + melee drain without counter interference
  bmEnemy.stunTurns = 1
  const knightHpBefore = bmKnight.hp
  const enemyHpBefore = bmEnemy.hp
  const ok = selectTile(bmState, bmEnemy.col, bmEnemy.row)
  assert.equal(ok, true)

  const actualDmg = enemyHpBefore - bmEnemy.hp
  assert.equal(actualDmg, bmFc.normalDmg, 'Live Blood Moon damage must match CombatForecast exactly')
  const expectedDrain = Math.max(2, Math.round(actualDmg * BLOOD_MOON_MELEE_DRAIN))
  assert.equal(bmKnight.hp - knightHpBefore, expectedDrain, 'Blood Moon melee strike must drain 15% HP')

  // Verify ranged attack does NOT trigger Blood Moon melee drain
  const bmArcher = bmBattle.units.find(u => u.team === 'ally' && u.heroId === 'archer')!
  bmArcher.crit = 0
  bmArcher.lifesteal = 0
  bmArcher.hp = Math.max(10, bmArcher.maxHp - 25)
  placeUnit(bmState, bmArcher, 0, 2)
  forceActiveAlly(bmState, bmArcher)
  const archerHpBefore = bmArcher.hp
  const rangedOk = selectTile(bmState, bmEnemy.col, bmEnemy.row)
  assert.equal(rangedOk, true)
  assert.equal(bmArcher.hp, archerHpBefore, 'Ranged attacks must not receive Blood Moon melee HP drain')
})

// =========================================================================
// 4. MUTATOR: ARCANE SURGE (+1 AP, +1 MAX AP, FASTER COOLDOWNS)
// =========================================================================

test('mutator arcane_surge: +1 start & max AP, faster hero & enemy skill cooldowns', () => {
  const normalState = makeClearedState(0, 6060)
  const surgeState = makeClearedState(0, 6060)

  const normalBattle = startChapterBattle(normalState, 0, 0, { tier: 'normal', mutators: [], deployPhase: true })
  const surgeBattle = startChapterBattle(surgeState, 0, 0, { tier: 'normal', mutators: ['arcane_surge'], deployPhase: true })

  // During deploy (before first turn AP grant): normal is 2/4, arcane_surge is 3/5
  assert.equal(normalBattle.ap, 2)
  assert.equal(normalBattle.maxAp, 4)
  assert.equal(surgeBattle.ap, 3)
  assert.equal(surgeBattle.maxAp, 5)

  // Live battle start (non-deploy): first player turn grants +1 AP (normal 3/4, surge 4/5)
  const liveSurge = startChapterBattle(surgeState, 0, 0, { tier: 'normal', mutators: ['arcane_surge'] })
  assert.equal(liveSurge.maxAp, 5)
  assert.equal(liveSurge.ap, 4)

  // Hero cooldown ticks down by 2 on hero turn start under Arcane Surge
  const hero = liveSurge.units.find(u => u.uid === liveSurge.activeUnitUid)!
  const enemy = liveSurge.units.find(u => u.alive && u.team === 'enemy')!
  hero.cooldowns = [3, 0, 0]
  enemy.cooldowns = [3, 0, 0]
  // Boost hero CT so hero acts immediately after endPlayerTurn
  for (const u of liveSurge.units) {
    if (u.uid !== hero.uid) u.ct = 0
  }
  hero.ct = 200
  endPlayerTurn(surgeState)

  // Enemy cooldown ticked down 1 at round boundary (3 -> 2)
  assert.equal(enemy.cooldowns[0], 2, 'Enemy skill cooldown must tick down 1 extra turn at round boundary under Arcane Surge')
  // Hero cooldown ticked down by 2 on hero's new turn start (3 -> 1)
  assert.equal(hero.cooldowns[0], 1, 'Hero skill cooldown must tick down by 2 on turn start under Arcane Surge')
})

// =========================================================================
// 5. MUTATOR: FOG OF WAR (SHROUD > 4 MANHATTAN, BLOCKS TARGETING UNTIL SPOTTED)
// =========================================================================

test('mutator fog_of_war: enemies beyond Manhattan distance 4 are shrouded and untargetable until spotted', () => {
  const state = makeClearedState(0, 7070)
  const battle = startChapterBattle(state, 0, 0, { tier: 'normal', mutators: ['fog_of_war'] })

  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  const archer = allies.find(u => u.heroId === 'archer') ?? allies[0]
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  const farEnemy = enemies[0]
  const nearEnemy = enemies[1] ?? enemies[0]

  // Cluster all allies at col 0, rows 0..2
  allies.forEach((a, idx) => placeUnit(state, a, 0, Math.min(battle.rows - 1, idx)))
  placeUnit(state, archer, 0, 2)
  // Give archer extra range (6) so range alone would reach col 5 — only Fog of War should block it!
  archer.range = 6

  // Put farEnemy at (6, 2) -> distance 6 from (0,2), > FOG_OF_WAR_VISION_RADIUS (4) from all allies
  placeUnit(state, farEnemy, 6, 2)
  // Put nearEnemy at (3, 2) -> distance 3 <= 4 from archer at (0,2)
  if (nearEnemy.uid !== farEnemy.uid) {
    placeUnit(state, nearEnemy, 3, 2)
  }
  // Clear line of sight along row 2
  for (let c = 0; c < battle.cols; c++) {
    battle.cells[2][c].terrain = 'grass'
    battle.cells[2][c].walkable = true
  }

  forceActiveAlly(state, archer)

  assert.equal(FOG_OF_WAR_VISION_RADIUS, 4)
  assert.equal(isTileRevealedInFog(battle, farEnemy.col, farEnemy.row), false)
  assert.equal(isUnitVisibleToPlayer(battle, farEnemy), false)
  assert.equal(isEnemyShrouded(battle, farEnemy), true)

  // Shrouded enemy is hidden from basic attack targets, skill targets, move+attack, and forecast!
  const basicTargets = computeTargetTiles(battle, archer, -1)
  assert.equal(basicTargets.some(t => t.col === farEnemy.col && t.row === farEnemy.row), false)
  if (nearEnemy.uid !== farEnemy.uid) {
    assert.equal(isEnemyShrouded(battle, nearEnemy), false)
    assert.equal(basicTargets.some(t => t.col === nearEnemy.col && t.row === nearEnemy.row), true)
  }

  const skillTargets = computeTargetTiles(battle, archer, 0)
  assert.equal(skillTargets.some(t => t.col === farEnemy.col && t.row === farEnemy.row), false)

  const moveAtk = computeMoveAttackTiles(battle, archer, -1, battle.moveTiles, battle.targetTiles)
  assert.equal(moveAtk.some(t => t.col === farEnemy.col && t.row === farEnemy.row), false)

  assert.equal(computeCombatForecast(state, farEnemy.col, farEnemy.row), null, 'Forecast must not reveal shrouded enemy')

  // Tactic card targeting 'enemy' also cannot target shrouded enemies
  const enemyTactic = state.campaign.tactics.find(t => TACTIC_BY_ID[t.tacticId]?.target === 'enemy')
  if (enemyTactic) {
    battle.ap = 5
    const tacTargets = computeTacticTargetTiles(battle, state.campaign, enemyTactic.uid)
    assert.equal(tacTargets.some(t => t.col === farEnemy.col && t.row === farEnemy.row), false)
  }

  // Advance an ally to (2, 2) -> distance to farEnemy (6, 2) is now 4 (SPOTTED!)
  placeUnit(state, archer, 2, 2)
  refreshHighlights(battle, state.campaign)
  assert.equal(isTileRevealedInFog(battle, farEnemy.col, farEnemy.row), true)
  assert.equal(isEnemyShrouded(battle, farEnemy), false)
  const spottedTargets = computeTargetTiles(battle, archer, -1)
  assert.equal(spottedTargets.some(t => t.col === farEnemy.col && t.row === farEnemy.row), true)
  const spottedForecast = computeCombatForecast(state, farEnemy.col, farEnemy.row)
  assert.ok(spottedForecast !== null && spottedForecast.targetUid === farEnemy.uid)
})

// =========================================================================
// 6. MUTATOR: IRON VANGUARD (25% HP SHIELD + 1 DEF)
// =========================================================================

test('mutator iron_vanguard: enemies start with 25% Max HP Fortified Shield and +1 DEF', () => {
  const state = makeClearedState(0, 8080)
  const vetBase = startChapterBattle(state, 0, 0, { tier: 'veteran', mutators: [] })
  const baseEnemies = vetBase.units.filter(u => u.team === 'enemy')

  const vetIron = startChapterBattle(state, 0, 0, { tier: 'veteran', mutators: ['iron_vanguard'] })
  const ironEnemies = vetIron.units.filter(u => u.team === 'enemy')

  for (let i = 0; i < baseEnemies.length; i++) {
    const b = baseEnemies[i]
    const iv = ironEnemies[i]
    assert.equal(iv.maxHp, b.maxHp)
    assert.equal(iv.def, b.def + IRON_VANGUARD_DEF_BONUS)
    assert.equal(iv.shield, b.shield + computeIronVanguardShield(iv.maxHp))
    assert.ok(iv.shield >= Math.round(iv.maxHp * 0.25))
  }

  // Verify CombatForecast accounts for Iron Vanguard shield & extra DEF accurately
  const ally = vetIron.units.find(u => u.alive && u.team === 'ally')!
  const target = ironEnemies[0]
  ally.crit = 0
  placeUnit(state, ally, 2, 2)
  placeUnit(state, target, 3, 2)
  target.stunTurns = 1
  forceActiveAlly(state, ally)
  const fc = computeCombatForecast(state, target.col, target.row)!
  assert.ok(fc)
  assert.equal(fc.targetShieldBefore, target.shield)
  const shieldBefore = target.shield
  const hpBefore = target.hp
  assert.equal(selectTile(state, target.col, target.row), true)
  const expectedAbsorbed = Math.min(shieldBefore, fc.normalDmg)
  assert.equal(target.shield, shieldBefore - expectedAbsorbed)
  assert.equal(target.hp, Math.max(0, hpBefore - Math.max(0, fc.normalDmg - shieldBefore)))
  assert.equal(target.hp, fc.targetHpAfterNormal)
})

// =========================================================================
// 7. MUTATOR: VENOM MIST (+1 POISON OFF SHRINES ON ROUND BOUNDARY)
// =========================================================================

test('mutator venom_mist: round boundary inflicts +1 Poison on units off shrines and spares shrine occupants', () => {
  const state = makeClearedState(0, 9090)
  const battle = startChapterBattle(state, 0, 0, { tier: 'normal', mutators: ['venom_mist'] })

  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  const shrineAlly = allies[0]
  const exposedAlly = allies[1] ?? allies[0]
  const exposedEnemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  // Author deterministic shrine vs grass cells
  battle.cells[1][1].terrain = 'shrine'
  battle.cells[1][1].walkable = true
  battle.cells[2][2].terrain = 'grass'
  battle.cells[2][2].walkable = true
  battle.cells[2][5].terrain = 'grass'
  battle.cells[2][5].walkable = true

  placeUnit(state, shrineAlly, 1, 1)
  if (exposedAlly.uid !== shrineAlly.uid) {
    placeUnit(state, exposedAlly, 2, 2)
  }
  placeUnit(state, exposedEnemy, 5, 2)

  // Zero out poison initially and ensure active unit is shrineAlly
  for (const u of battle.units) u.poisonStacks = 0
  forceActiveAlly(state, shrineAlly)
  // Prevent next unit turn from consuming exposedEnemy's poison immediately by giving shrineAlly highest CT
  for (const u of battle.units) {
    if (u.uid !== shrineAlly.uid) u.ct = 0
  }
  shrineAlly.ct = 200

  endPlayerTurn(state)

  assert.equal(shrineAlly.poisonStacks, 0, 'Unit standing on Sanctuary Shrine must be immune to Venom Mist')
  if (exposedAlly.uid !== shrineAlly.uid) {
    assert.equal(exposedAlly.poisonStacks, 1, 'Exposed ally off shrine must gain +1 Poison stack at round boundary')
  }
  assert.equal(exposedEnemy.poisonStacks, 1, 'Exposed enemy off shrine must also gain +1 Poison stack at round boundary')
})

// =========================================================================
// 8. REWARDS: GOLD MULTIPLIER, DUST/SHARDS, DROP TIER UPGRADE & HIGHEST TIER
// =========================================================================

test('rewards: Veteran/Mythic + mutators scale replay gold, award Dust/Shards, upgrade drop tier, and record highest cleared tier', () => {
  const chapter = CHAPTERS[0]

  const normPreview = computeChallengeRewards(chapter.replayGold, chapter.difficulty, 'normal', [])
  const vetPreview = computeChallengeRewards(chapter.replayGold, chapter.difficulty, 'veteran', ['blood_moon'])
  const mythPreview = computeChallengeRewards(chapter.replayGold, chapter.difficulty, 'mythic', ['blood_moon', 'fog_of_war'])

  assert.equal(normPreview.goldBonusPct, 0)
  assert.equal(normPreview.replayGold, chapter.replayGold)
  assert.equal(normPreview.bonusDust, 0)
  assert.equal(normPreview.bonusShards, 0)
  assert.equal(normPreview.minDropRarity, 'common')

  assert.equal(vetPreview.goldBonusPct, STAGE_TIER_SPECS.veteran.goldBonusPct + STAGE_MUTATOR_SPECS.blood_moon.goldBonusPct)
  assert.equal(vetPreview.replayGold, Math.round(chapter.replayGold * (1 + vetPreview.goldBonusPct / 100)))
  assert.equal(vetPreview.bonusDust, STAGE_TIER_SPECS.veteran.bonusDust + STAGE_MUTATOR_SPECS.blood_moon.bonusDust)
  assert.equal(vetPreview.bonusShards, STAGE_TIER_SPECS.veteran.bonusShards + STAGE_MUTATOR_SPECS.blood_moon.bonusShards)
  assert.equal(vetPreview.minDropRarity, 'uncommon')
  assert.ok(vetPreview.dropWeights.rare > normPreview.dropWeights.rare)
  assert.ok(vetPreview.dropWeights.epic > normPreview.dropWeights.epic)

  assert.equal(
    mythPreview.goldBonusPct,
    STAGE_TIER_SPECS.mythic.goldBonusPct + STAGE_MUTATOR_SPECS.blood_moon.goldBonusPct + STAGE_MUTATOR_SPECS.fog_of_war.goldBonusPct
  )
  assert.equal(mythPreview.replayGold, Math.round(chapter.replayGold * (1 + mythPreview.goldBonusPct / 100)))
  assert.equal(mythPreview.minDropRarity, 'rare')
  assert.ok(mythPreview.dropWeights.epic > vetPreview.dropWeights.epic)
  assert.ok(mythPreview.dropWeights.legendary > vetPreview.dropWeights.legendary)

  // Live victory execution: Veteran + blood_moon
  const state = makeClearedState(0, 1111)
  const goldBefore = state.campaign.gold
  const dustBefore = state.campaign.dust
  const shardsBefore = state.campaign.shards
  startChapterBattle(state, 0, 0, { tier: 'veteran', mutators: ['blood_moon'] })
  winBattleByRoutingEnemies(state)

  const reward = state.battle!.reward!
  assert.equal(reward.firstClear, false)
  assert.equal(reward.gold, vetPreview.replayGold)
  assert.equal(reward.bonusDust, vetPreview.bonusDust)
  assert.equal(reward.bonusShards, vetPreview.bonusShards)
  assert.equal(reward.difficultyTier, 'veteran')
  assert.deepEqual(reward.mutators, ['blood_moon'])
  assert.equal(state.campaign.gold, goldBefore + vetPreview.replayGold)
  assert.equal(state.campaign.dust, dustBefore + vetPreview.bonusDust)
  assert.equal(state.campaign.shards, shardsBefore + vetPreview.bonusShards)
  assert.equal(getHighestClearedStageTier(state.campaign, chapter.id), 'veteran')

  // Check drop rarity respects Veteran floor (>= uncommon)
  const getDropRarity = (r: typeof reward): Rarity => {
    if (r.equipCard) return EQUIPMENT_BY_ID[r.equipCard.equipId].rarity
    if (r.heroCard) return HERO_SPECS[r.heroCard.heroId].rarity
    return TACTIC_BY_ID[r.tacticCard!.tacticId].rarity
  }
  assert.ok(RARITY_ORDER.indexOf(getDropRarity(reward)) >= RARITY_ORDER.indexOf('uncommon'))

  // Win on Mythic -> upgrades highest cleared tier to 'mythic' and drop rarity >= 'rare'
  for (let s = 0; s < 12; s++) {
    const mState = makeClearedState(0, 2000 + s * 37)
    startChapterBattle(mState, 0, 0, { tier: 'mythic', mutators: ['fog_of_war'] })
    winBattleByRoutingEnemies(mState)
    const mReward = mState.battle!.reward!
    assert.equal(getHighestClearedStageTier(mState.campaign, chapter.id), 'mythic')
    assert.ok(
      RARITY_ORDER.indexOf(getDropRarity(mReward)) >= RARITY_ORDER.indexOf('rare'),
      `Mythic drop rarity (${getDropRarity(mReward)}) must be at least rare`
    )
  }

  // Replaying on Normal after clearing Mythic must NEVER downgrade highest cleared tier
  recordClearedStageTier(state.campaign, chapter.id, 'mythic')
  startChapterBattle(state, 0, 0, { tier: 'normal' })
  winBattleByRoutingEnemies(state)
  assert.equal(getHighestClearedStageTier(state.campaign, chapter.id), 'mythic')
})

// =========================================================================
// 9. SAVE / RESUME & LEGACY SAVE COMPATIBILITY
// =========================================================================

test('persistence: mid-battle save/resume & campaign save round-trip preserve difficultyTier, mutators, and clearedStageTiers', () => {
  const storage = createMemoryStorage()
  const state = makeClearedState(0, 31415)
  recordClearedStageTier(state.campaign, CHAPTERS[0].id, 'veteran')

  const activeMutators: StageMutatorId[] = ['blood_moon', 'arcane_surge', 'fog_of_war', 'iron_vanguard']
  const battle = startChapterBattle(state, 0, 0, { tier: 'mythic', mutators: activeMutators })
  assert.equal(battle.difficultyTier, 'mythic')
  assert.deepEqual(battle.mutators, ['blood_moon', 'arcane_surge', 'fog_of_war', 'iron_vanguard'])

  // Position units so an enemy is shrouded in fog before saving
  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  allies.forEach((a, idx) => {
    const r = Math.min(battle.rows - 1, idx)
    battle.cells[r][0].terrain = 'grass'
    battle.cells[r][0].walkable = true
    placeUnit(state, a, 0, r)
  })
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  const farCol = battle.cols - 1
  const farRow = Math.min(battle.rows - 1, 2)
  // Spread all enemies on the far column so no two units share a tile
  enemies.forEach((e, idx) => {
    const r = (farRow + idx) % battle.rows
    battle.cells[r][farCol].terrain = 'grass'
    battle.cells[r][farCol].walkable = true
    placeUnit(state, e, farCol, r)
  })
  const farEnemy = enemies[0]
  forceActiveAlly(state, allies[0])

  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded !== null)
  assert.ok(loaded.activeBattle !== null, 'activeBattle snapshot must validate cleanly')
  assert.equal(loaded.campaign.clearedStageTiers?.[CHAPTERS[0].id], 'veteran')
  assert.equal(loaded.activeBattle?.difficultyTier, 'mythic')
  assert.deepEqual(loaded.activeBattle?.mutators, ['blood_moon', 'arcane_surge', 'fog_of_war', 'iron_vanguard'])

  const resumed = createInitialState(999, loaded)
  assert.ok(resumed.battle !== null)
  assert.equal(resumed.battle.difficultyTier, 'mythic')
  assert.deepEqual(resumed.battle.mutators, ['blood_moon', 'arcane_surge', 'fog_of_war', 'iron_vanguard'])
  assert.equal(resumed.battle.maxAp, 5)
  assert.equal(getHighestClearedStageTier(resumed.campaign, CHAPTERS[0].id), 'veteran')

  // Fog of war shroud must immediately remain enforced after resume
  const resumedFarEnemy = resumed.battle.units.find(u => u.uid === farEnemy.uid)!
  assert.equal(isEnemyShrouded(resumed.battle, resumedFarEnemy), true)
  assert.equal(computeCombatForecast(resumed, resumedFarEnemy.col, resumedFarEnemy.row), null)

  // Invalid tier or mutator in tampered battle snapshot must be rejected cleanly
  const snap = serializeBattleState(battle, state.campaign.seed)!
  assert.equal(validateBattleSnapshot({ ...snap, difficultyTier: 'nightmare' }), null)
  assert.equal(validateBattleSnapshot({ ...snap, mutators: ['not_a_mutator'] }), null)

  // Legacy campaign & battle save (without clearedStageTiers, difficultyTier, or mutators) loads cleanly!
  const legacySave = serializeSave(state)
  delete (legacySave.campaign as { clearedStageTiers?: unknown }).clearedStageTiers
  if (legacySave.activeBattle) {
    delete (legacySave.activeBattle as { difficultyTier?: unknown }).difficultyTier
    delete (legacySave.activeBattle as { mutators?: unknown }).mutators
  }
  const legacyStorage = createMemoryStorage()
  legacyStorage.setItem('ridgetop.crownshard.save.v1', JSON.stringify(legacySave as SaveData))
  const parsedLegacy = loadSave(legacyStorage)
  assert.ok(parsedLegacy !== null)
  const hydratedLegacy = createInitialState(1337, parsedLegacy)
  assert.equal(getHighestClearedStageTier(hydratedLegacy.campaign, CHAPTERS[0].id), 'normal')
  assert.ok(hydratedLegacy.battle !== null)
  assert.equal(hydratedLegacy.battle.difficultyTier, 'normal')
  assert.deepEqual(hydratedLegacy.battle.mutators, [])

  // Explicit restoreBattleState also defaults legacy snapshots safely
  const standalone = createInitialState(77)
  const restoredOk = restoreBattleState(standalone, parsedLegacy.activeBattle)
  assert.equal(restoredOk, true)
  assert.equal(standalone.battle!.difficultyTier, 'normal')
  assert.deepEqual(standalone.battle!.mutators, [])

  // Verify all 5 mutators are registered and non-empty
  assert.equal(STAGE_MUTATOR_IDS.length, 5)
  const tiers: StageDifficultyTier[] = ['normal', 'veteran', 'mythic']
  for (const t of tiers) assert.ok(STAGE_TIER_SPECS[t].label.length > 0)
  // Step battle briefly to make sure no runtime exceptions occur under mutators
  stepGame(resumed, 0.016)
  assert.equal(armSkill(resumed, null), true)
  assert.equal(armTacticCard(resumed, null), true)
})
