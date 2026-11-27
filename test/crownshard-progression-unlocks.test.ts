import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import {
  getEquipCodexEntries,
  getEquipCodexEntry,
  getHeroCodexEntries,
  getHeroCodexEntry,
  isEquipDiscovered,
  isHeroDiscovered
} from '../examples/crownshard/crownshard/codex.ts'
import { CHAPTER_BY_ID, ENEMY_SPECS } from '../examples/crownshard/crownshard/data.ts'
import {
  BOSS_REMATCH_REWARD_SCALE,
  areAdvancedBattleToolsUnlocked,
  areMutatorsUnlockedForStage,
  areSecondaryCurrenciesVisible,
  buildBossRematchEnemies,
  getAllowedChallengeTiers,
  getUnlockedCampTabs,
  isBossRematchSkirmish,
  isBulkSalvageUnlocked,
  isCampTabUnlocked,
  isCampUnlocked,
  isCodexUnlocked,
  isGearTemperingUnlocked,
  isMasteryUnlocked,
  isSquadBondsUnlocked,
  isStageBossEncounter,
  isWorldMapRevealed,
  shouldLaunchDirectlyIntoBattle1
} from '../examples/crownshard/crownshard/progression-unlocks.ts'
import {
  createInitialState,
  refreshHighlights,
  selectTile,
  startStageBattle
} from '../examples/crownshard/crownshard/simulation.ts'
import type { BattleUnit, ChapterSpec, GameState } from '../examples/crownshard/crownshard/types.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'

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

function winBattleByRoutingEnemies(state: GameState): void {
  const battle = state.battle!
  const ally = battle.units.find(u => u.alive && u.team === 'ally')!
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  assert.ok(enemies.length > 0, 'Battle must have at least one enemy')
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].alive = false
    enemies[i].hp = 0
    enemies[i].shield = 0
  }
  const last = enemies[enemies.length - 1]
  last.hp = 1
  last.shield = 0
  battle.cells[2][2].terrain = 'grass'
  battle.cells[2][2].walkable = true
  battle.cells[2][3].terrain = 'grass'
  battle.cells[2][3].walkable = true
  placeUnit(state, ally, 2, 2)
  placeUnit(state, last, 3, 2)
  battle.phase = 'player'
  battle.activeUnitUid = ally.uid
  battle.selectedUnitUid = ally.uid
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  ally.moved = false
  ally.acted = false
  ally.stunTurns = 0
  refreshHighlights(battle, state.campaign)
  assert.equal(selectTile(state, last.col, last.row), true, 'Final blow must execute')
  assert.equal(battle.phase, 'victory', 'Routing last enemy must trigger victory')
}

test('progressive disclosure unlock thresholds across wins 0, 1, 2, 3', () => {
  const state = createInitialState(1001)
  const c = state.campaign

  // Wins = 0 (brand new campaign)
  assert.equal(shouldLaunchDirectlyIntoBattle1(c), true)
  assert.equal(isWorldMapRevealed(c), false)
  assert.equal(isCampUnlocked(c), false)
  assert.deepEqual(getUnlockedCampTabs(c), [])
  assert.equal(isCampTabUnlocked(c, 'squad'), false)
  assert.equal(isGearTemperingUnlocked(c), false)
  assert.equal(isBulkSalvageUnlocked(c), false)
  assert.equal(isSquadBondsUnlocked(c), false)
  assert.equal(areSecondaryCurrenciesVisible(c), false)
  assert.equal(isCodexUnlocked(c), false)
  assert.equal(isMasteryUnlocked(c), false)
  assert.equal(areAdvancedBattleToolsUnlocked(c), false)

  // Secondary currencies become visible early if dust or shards > 0
  c.dust = 5
  assert.equal(areSecondaryCurrenciesVisible(c), true)
  c.dust = 0
  c.shards = 2
  assert.equal(areSecondaryCurrenciesVisible(c), true)
  c.shards = 0

  // Wins = 1 (after Battle 1)
  c.clearedStageIds = ['border_watch']
  c.battlesWon = 1
  assert.equal(shouldLaunchDirectlyIntoBattle1(c), false)
  assert.equal(isWorldMapRevealed(c), true)
  assert.equal(isCampUnlocked(c), true)
  assert.deepEqual(getUnlockedCampTabs(c), ['squad', 'armory'])
  assert.equal(isCampTabUnlocked(c, 'squad'), true)
  assert.equal(isCampTabUnlocked(c, 'armory'), true)
  assert.equal(isCampTabUnlocked(c, 'deck'), false)
  assert.equal(isCampTabUnlocked(c, 'packs'), false)
  assert.equal(isCampTabUnlocked(c, 'forge'), false)
  assert.equal(isCodexUnlocked(c), true)
  assert.equal(isMasteryUnlocked(c), true)
  assert.equal(areAdvancedBattleToolsUnlocked(c), true)
  assert.equal(isGearTemperingUnlocked(c), false)
  assert.equal(isBulkSalvageUnlocked(c), false)
  assert.equal(isSquadBondsUnlocked(c), false)
  assert.equal(areSecondaryCurrenciesVisible(c), false)

  // Wins = 2
  c.clearedStageIds = ['border_watch', 'miller_ford']
  c.battlesWon = 2
  assert.deepEqual(getUnlockedCampTabs(c), ['squad', 'armory', 'deck', 'packs'])
  assert.equal(isCampTabUnlocked(c, 'deck'), true)
  assert.equal(isCampTabUnlocked(c, 'packs'), true)
  assert.equal(isCampTabUnlocked(c, 'forge'), false)
  assert.equal(isGearTemperingUnlocked(c), false)

  // Wins = 3
  c.clearedStageIds = ['border_watch', 'miller_ford', 'sunken_bridge']
  c.battlesWon = 3
  assert.deepEqual(getUnlockedCampTabs(c), ['squad', 'armory', 'deck', 'packs', 'forge'])
  assert.equal(isCampTabUnlocked(c, 'forge'), true)
  assert.equal(isGearTemperingUnlocked(c), true)
  assert.equal(isBulkSalvageUnlocked(c), true)
  assert.equal(isSquadBondsUnlocked(c), true)
  assert.equal(areSecondaryCurrenciesVisible(c), true)
})

test('re-battle difficulty tiers and mutator gating across wins 0, 4, 8 and early/mid/late stages', () => {
  const state = createInitialState(2002)
  const c = state.campaign

  // Wins < 4: always normal only, no mutators
  c.clearedStageIds = ['border_watch', 'miller_ford', 'sunken_bridge']
  c.battlesWon = 3
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.border_watch), ['normal'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.briar_hollow), ['normal'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.eclipse_throne), ['normal'])
  assert.equal(areMutatorsUnlockedForStage(c, CHAPTER_BY_ID.briar_hollow), false)

  // Wins = 4: early Act 1 tutorial stages stay normal-only; mid-game unlocks veteran; late-game unlocks mythic
  c.battlesWon = 4
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.border_watch), ['normal'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.miller_ford), ['normal'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.sunken_bridge), ['normal'])
  assert.equal(areMutatorsUnlockedForStage(c, CHAPTER_BY_ID.border_watch), false)

  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.briar_hollow), ['normal', 'veteran'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.lantern_crypt), ['normal', 'veteran'])
  assert.equal(areMutatorsUnlockedForStage(c, CHAPTER_BY_ID.lantern_crypt), true)

  // Late-game Act 2 boss / Act 3+ stages unlock mythic at wins >= 4
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.bone_cathedral), ['normal', 'veteran', 'mythic'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.obsidian_gate), ['normal', 'veteran', 'mythic'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.eclipse_throne), ['normal', 'veteran', 'mythic'])

  // Wins = 8: mid-game stages also unlock mythic, while initial tutorial stages remain normal-only
  c.battlesWon = 8
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.border_watch), ['normal'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.briar_hollow), ['normal', 'veteran', 'mythic'])
  assert.deepEqual(getAllowedChallengeTiers(c, CHAPTER_BY_ID.lantern_crypt), ['normal', 'veteran', 'mythic'])
  assert.equal(areMutatorsUnlockedForStage(c, CHAPTER_BY_ID.briar_hollow), true)
})

test('boss-less rematch skirmish strips boss, converts assassinate to rout, and scales replay gold by 60%', () => {
  const eclipseStage = CHAPTER_BY_ID.eclipse_throne
  assert.equal(isStageBossEncounter(eclipseStage), true)
  assert.equal(isStageBossEncounter(CHAPTER_BY_ID.border_watch), false)
  assert.equal(isStageBossEncounter(CHAPTER_BY_ID.lantern_crypt), false)

  // First clear of Eclipse Throne spawns Eclipse Archon with 'assassinate' objective
  const firstState = createInitialState(3003)
  assert.equal(isBossRematchSkirmish(firstState.campaign, eclipseStage), false)
  const firstBattle = startStageBattle(firstState, 'eclipse_throne', { deployPhase: false })
  assert.equal(firstBattle.objective.kind, 'assassinate')
  assert.equal(
    firstBattle.units.some(u => u.team === 'enemy' && u.enemyId === 'eclipse_archon' && u.isBoss),
    true,
    'First clear must spawn Eclipse Archon boss'
  )

  // Re-battle after clearing Eclipse Throne becomes a boss-less skirmish
  const rematchState = createInitialState(3004)
  rematchState.campaign.clearedStageIds.push('eclipse_throne')
  rematchState.campaign.chaptersCleared = 1
  rematchState.campaign.battlesWon = 1
  assert.equal(isBossRematchSkirmish(rematchState.campaign, eclipseStage), true)

  const rematchBattle = startStageBattle(rematchState, 'eclipse_throne', { deployPhase: false })
  const rematchEnemies = rematchBattle.units.filter(u => u.team === 'enemy')
  assert.ok(rematchEnemies.length > 0, 'Rematch skirmish must spawn remaining garrison enemies')
  assert.equal(
    rematchEnemies.some(u => u.isBoss || u.enemyId === 'eclipse_archon'),
    false,
    'Boss unit must not spawn in a boss-less rematch skirmish'
  )
  assert.equal(
    rematchBattle.objective.kind,
    'rout',
    'Assassinate objective must convert to rout on boss-less rematch'
  )

  // Victory on boss-less rematch scales replay gold by BOSS_REMATCH_REWARD_SCALE (60%)
  const goldBefore = rematchState.campaign.gold
  winBattleByRoutingEnemies(rematchState)
  const expectedGold = Math.round(eclipseStage.replayGold * BOSS_REMATCH_REWARD_SCALE)
  assert.equal(rematchState.battle!.reward!.gold, expectedGold)
  assert.equal(rematchState.campaign.gold, goldBefore + expectedGold)
  assert.equal(rematchState.battle!.reward!.specialRewardsClaimed, false)

  // Boss-only fallback spawns 2 thematic garrison enemies
  const bossOnlyStage: ChapterSpec = {
    ...eclipseStage,
    enemies: [{ id: 'eclipse_archon', col: 6, row: 2 }]
  }
  const fallbackEnemies = buildBossRematchEnemies(bossOnlyStage)
  assert.equal(fallbackEnemies.length, 2)
  for (const sp of fallbackEnemies) {
    assert.equal(Boolean(ENEMY_SPECS[sp.id].isBoss), false)
  }
})

test('Codex Hero and Gear discovery masking unlocks by ownership, starter status, or stage/region progression', () => {
  const state = createInitialState(4004)

  // Initial state: starter heroes (knight, archer, mage) discovered; later heroes masked
  assert.equal(isHeroDiscovered(state.campaign, 'knight'), true)
  assert.equal(isHeroDiscovered(state.campaign, 'archer'), true)
  assert.equal(isHeroDiscovered(state.campaign, 'mage'), true)
  assert.equal(isHeroDiscovered(state.campaign, 'cleric'), false)
  assert.equal(isHeroDiscovered(state.campaign, 'champion'), false)

  const maskedChampion = getHeroCodexEntry(state.campaign, 'champion')
  assert.equal(maskedChampion.discovered, false)
  assert.equal(maskedChampion.masked, true)
  assert.equal(maskedChampion.displayName, '???')

  const revealedKnight = getHeroCodexEntry(state.campaign, 'knight')
  assert.equal(revealedKnight.discovered, true)
  assert.equal(revealedKnight.masked, false)
  assert.equal(revealedKnight.displayName, 'Sir Aldric')

  // Clearing sunken_bridge reaches Silverfen & unlocks sunwell_glade -> discovers cleric
  state.campaign.clearedStageIds.push('sunken_bridge')
  assert.equal(isHeroDiscovered(state.campaign, 'cleric'), true)
  assert.equal(getHeroCodexEntry(state.campaign, 'cleric').displayName, 'Sera')
  assert.equal(isHeroDiscovered(state.campaign, 'champion'), false)

  // Gear masking: starter gear discovered, endgame gear masked until owned or chapter cleared
  assert.equal(isEquipDiscovered(state.campaign, 'iron_sword'), true)
  assert.equal(isEquipDiscovered(state.campaign, 'solis_crownblade'), false)
  const maskedBlade = getEquipCodexEntry(state.campaign, 'solis_crownblade')
  assert.equal(maskedBlade.discovered, false)
  assert.equal(maskedBlade.masked, true)
  assert.equal(maskedBlade.displayName, '???')

  // Clearing sunken_bridge discovers ember_wand (dropped by sunken_bridge)
  assert.equal(isEquipDiscovered(state.campaign, 'ember_wand'), true)
  assert.equal(getEquipCodexEntry(state.campaign, 'ember_wand').displayName, 'Ember Scepter')

  // Owning solis_crownblade discovers it even before clearing eclipse_throne
  state.campaign.equipment.push({ uid: 'eq_test_blade', equipId: 'solis_crownblade', slot: 'weapon' })
  assert.equal(isEquipDiscovered(state.campaign, 'solis_crownblade'), true)
  const revealedBlade = getEquipCodexEntry(state.campaign, 'solis_crownblade')
  assert.equal(revealedBlade.discovered, true)
  assert.equal(revealedBlade.masked, false)
  assert.equal(revealedBlade.displayName, 'Solis Crownblade')

  // Bulk helpers return all entries with discovered/masked flags
  assert.equal(getHeroCodexEntries(state.campaign).length, 8)
  assert.ok(getEquipCodexEntries(state.campaign).every(e => typeof e.discovered === 'boolean' && e.masked === !e.discovered))
})

test('progression-unlocks.ts is browser-global-free and compiles cleanly via compileTsToGd', () => {
  const source = readFileSync(
    new URL('../examples/crownshard/crownshard/progression-unlocks.ts', import.meta.url),
    'utf8'
  )
  for (const forbidden of ['window.', 'document.', 'localStorage', 'navigator.', 'HTMLCanvasElement']) {
    assert.equal(source.includes(forbidden), false, `progression-unlocks.ts must not reference ${forbidden}`)
  }
  const gd = compileTsToGd(source, 'progression-unlocks.ts')
  assert.equal(typeof gd, 'string')
  assert.ok(gd.length > 300)
  assert.ok(gd.includes('getAllowedChallengeTiers'))
  assert.ok(gd.includes('isBossRematchSkirmish'))
})
