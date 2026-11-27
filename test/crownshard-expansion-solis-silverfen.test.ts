import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CHAPTER_BY_ID,
  EQUIPMENT_BY_ID,
  PLAYABLE_CHAPTERS
} from '../examples/crownshard/crownshard/data.ts'
import {
  EMERALD_DELTA_STAGE_ID,
  EMERALD_TIDE_FORD_TILES,
  GALEWIND_MIN_HEIGHT,
  GALEWIND_STAGE_ID,
  MONASTERY_MAX_ALIVE_ENEMIES,
  MONASTERY_REINFORCEMENT_ROUNDS,
  OAKHAVEN_EXCHANGE_DEALS,
  OAKHAVEN_STAGE_ID,
  SOLIS_MONASTERY_STAGE_ID,
  applyAct1StageRoundBoundary,
  applyEmeraldDeltaTide,
  applyGalewindGust,
  buyOakhavenDeal,
  canBuyOakhavenDeal,
  canTraverseStep,
  createInitialState,
  endPlayerTurn,
  getAct1StageMechanicStatus,
  getOakhavenDealCost,
  getOakhavenExchangeOffers,
  getUnitByUid,
  hasOakhavenPatronDiscount,
  isDeployTile,
  isEmeraldDeltaFordTile,
  isEmeraldTideHighOnRound,
  isGalewindGustImminent,
  isOakhavenExchangeUnlocked,
  isStageUnlocked,
  loadSave,
  persistSave,
  restoreBattleState,
  serializeBattleState,
  spawnMonasteryReinforcements,
  startStageBattle
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { cellHeightLevel, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState } from '../examples/crownshard/crownshard/types.ts'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'

const ACT1_EXPANSION_IDS = [
  OAKHAVEN_STAGE_ID,
  GALEWIND_STAGE_ID,
  EMERALD_DELTA_STAGE_ID,
  SOLIS_MONASTERY_STAGE_ID
] as const

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>()
  return {
    getItem(key) {
      return store.get(key) ?? null
    },
    setItem(key, value) {
      store.set(key, value)
    },
    removeItem(key) {
      store.delete(key)
    }
  }
}

function jump1Reachable(battle: BattleState, startCol: number, startRow: number): Set<string> {
  const seen = new Set<string>([`${startCol},${startRow}`])
  const q: [number, number][] = [[startCol, startRow]]
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  while (q.length > 0) {
    const [cc, cr] = q.shift()!
    const from = battle.cells[cr][cc]
    for (const [dc, dr] of dirs) {
      const nc = cc + dc
      const nr = cr + dr
      if (nr < 0 || nr >= battle.rows || nc < 0 || nc >= battle.cols) continue
      const k = `${nc},${nr}`
      if (seen.has(k)) continue
      const to = battle.cells[nr][nc]
      if (!canTraverseStep(from, to, 1)) continue
      seen.add(k)
      q.push([nc, nr])
    }
  }
  return seen
}

test('All 4 Solis Vale & Silverfen expansion nodes are playable, non-overlapping, valid objectives, and jump-1 BFS connected', () => {
  for (const stageId of ACT1_EXPANSION_IDS) {
    const ch = CHAPTER_BY_ID[stageId]
    assert.ok(ch, `Stage ${stageId} must exist in CHAPTER_BY_ID`)
    assert.equal(Boolean(ch.comingSoon), false, `${stageId} must be playable (not comingSoon)`)
    assert.equal(ch.soonNote, undefined, `${stageId} should no longer carry a soonNote`)
    assert.ok(PLAYABLE_CHAPTERS.some(p => p.id === stageId), `${stageId} must appear in PLAYABLE_CHAPTERS`)
    assert.ok(ch.heights, `${stageId} must define explicit heights`)
    assert.ok(ch.modifierDesc && ch.modifierDesc.length > 0, `${stageId} must define modifierDesc`)
    assert.ok(ch.introText.length > 30, `${stageId} must define rich introText`)
    assert.ok(ch.rewardGold > ch.replayGold, `${stageId} firstClearReward gold must exceed replayGold`)
    if (ch.rewardEquipId) {
      assert.ok(EQUIPMENT_BY_ID[ch.rewardEquipId], `${stageId} rewardEquipId must exist`)
    }

    const state = createInitialState(7700 + ch.index)
    const battle = startStageBattle(state, stageId, 0, { deployPhase: true })

    // Verify void cutout and stairs exist for elevation invariants
    let hasVoid = false
    let hasStairs = false
    for (let r = 0; r < battle.rows; r++) {
      for (let c = 0; c < battle.cols; c++) {
        if (battle.cells[r][c].terrain === 'void') hasVoid = true
        if (battle.cells[r][c].terrain === 'stairs') hasStairs = true
      }
    }
    assert.equal(hasVoid, true, `${stageId} must include void cutout tiles`)
    assert.equal(hasStairs, true, `${stageId} must include stairs tiles`)

    // Verify all hero + enemy spawns are walkable, non-void, non-overlapping
    const occupied = new Set<string>()
    for (const [hc, hr] of ch.heroSpawns) {
      const cell = battle.cells[hr][hc]
      assert.equal(cell.walkable && terrainWalkable(cell.terrain), true, `${stageId} hero spawn (${hc},${hr}) walkable`)
      assert.equal(occupied.has(`${hc},${hr}`), false, `${stageId} unique hero spawn (${hc},${hr})`)
      occupied.add(`${hc},${hr}`)
    }
    for (const sp of ch.enemies) {
      const cell = battle.cells[sp.row][sp.col]
      assert.equal(cell.walkable && terrainWalkable(cell.terrain), true, `${stageId} enemy spawn (${sp.col},${sp.row}) walkable`)
      assert.equal(occupied.has(`${sp.col},${sp.row}`), false, `${stageId} unique enemy spawn (${sp.col},${sp.row})`)
      occupied.add(`${sp.col},${sp.row}`)
    }

    // Verify jump-1 BFS connectivity from every deploy tile to every enemy, objective tile, and chest
    for (const dt of battle.deployTiles) {
      const reach = jump1Reachable(battle, dt.col, dt.row)
      for (const sp of ch.enemies) {
        assert.equal(
          reach.has(`${sp.col},${sp.row}`),
          true,
          `${stageId}: deploy (${dt.col},${dt.row}) must reach enemy (${sp.col},${sp.row}) via jump-1`
        )
      }
      if (battle.objective.protectTile) {
        const pt = battle.objective.protectTile
        assert.equal(terrainWalkable(battle.cells[pt.row][pt.col].terrain), true)
        assert.equal(
          reach.has(`${pt.col},${pt.row}`),
          true,
          `${stageId}: deploy (${dt.col},${dt.row}) must reach protectTile (${pt.col},${pt.row})`
        )
      }
      if (battle.objective.goalTile) {
        const gt = battle.objective.goalTile
        assert.equal(isDeployTile(battle, gt.col, gt.row), false)
        assert.equal(reach.has(`${gt.col},${gt.row}`), true)
      }
      for (const ct of battle.objective.chestTiles) {
        assert.equal(terrainWalkable(battle.cells[ct.row][ct.col].terrain), true)
        assert.equal(isDeployTile(battle, ct.col, ct.row), false)
        assert.equal(
          reach.has(`${ct.col},${ct.row}`),
          true,
          `${stageId}: deploy (${dt.col},${dt.row}) must reach chest (${ct.col},${ct.row})`
        )
      }
    }
  }

  // Verify specific stage objectives & enemy roster expectations
  assert.equal(CHAPTER_BY_ID[OAKHAVEN_STAGE_ID].objective?.kind, 'seize')
  assert.equal(CHAPTER_BY_ID[OAKHAVEN_STAGE_ID].objective?.chestTiles?.length, 2)
  assert.equal(CHAPTER_BY_ID[EMERALD_DELTA_STAGE_ID].biome, 'river')
  assert.ok(CHAPTER_BY_ID[EMERALD_DELTA_STAGE_ID].enemies.some(e => e.id === 'river_troll'))
  assert.ok(CHAPTER_BY_ID[EMERALD_DELTA_STAGE_ID].enemies.some(e => e.id === 'bog_shaman'))
  assert.equal(CHAPTER_BY_ID[SOLIS_MONASTERY_STAGE_ID].objective?.kind, 'defend')
  assert.equal(CHAPTER_BY_ID[SOLIS_MONASTERY_STAGE_ID].objective?.targetTurns, 6)
  assert.ok(CHAPTER_BY_ID[SOLIS_MONASTERY_STAGE_ID].objective?.protectTile)
})

test('Oakhaven Guild Exchange enforces unlock gating, Guild Patron 20% discount, per-cycle stock, relic grants, and save persistence', () => {
  const storage = createMemoryStorage()
  const state = createInitialState(8801)
  state.campaign.gold = 600

  // Locked before Border Watch is cleared
  assert.equal(isOakhavenExchangeUnlocked(state.campaign), false)
  assert.equal(canBuyOakhavenDeal(state.campaign, 'dust_satchel'), false)
  const lockedRes = buyOakhavenDeal(state, 'dust_satchel')
  assert.equal(lockedRes.ok, false)

  // Clearing Border Watch unlocks Oakhaven City & Guild Exchange at base prices (no Patron discount yet)
  state.campaign.clearedStageIds.push('border_watch')
  state.campaign.chaptersCleared = 1
  state.campaign.battlesWon = 1
  assert.equal(isStageUnlocked(state.campaign, OAKHAVEN_STAGE_ID), true)
  assert.equal(isOakhavenExchangeUnlocked(state.campaign), true)
  assert.equal(hasOakhavenPatronDiscount(state.campaign), false)

  const dustBaseCost = getOakhavenDealCost(state.campaign, 'dust_satchel')
  assert.equal(dustBaseCost, OAKHAVEN_EXCHANGE_DEALS[0].baseCost)

  const buyDust = buyOakhavenDeal(state, 'dust_satchel')
  assert.equal(buyDust.ok, true)
  assert.equal(buyDust.goldSpent, dustBaseCost)
  assert.equal(buyDust.dustGained, 45)
  assert.equal(state.campaign.dust, 45)
  assert.equal(state.campaign.gold, 600 - dustBaseCost)

  // Cannot buy the same deal twice in the same battle cycle
  assert.equal(canBuyOakhavenDeal(state.campaign, 'dust_satchel'), false)
  const dupBuy = buyOakhavenDeal(state, 'dust_satchel')
  assert.equal(dupBuy.ok, false)

  // Persist save and verify Oakhaven purchase state survives reload
  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded, 'Save must load cleanly')
  const restored = createInitialState(1, loaded)
  assert.equal(restored.campaign.dust, 45)
  assert.equal(canBuyOakhavenDeal(restored.campaign, 'dust_satchel'), false, 'Sold-out deal must stay sold out after reload')
  assert.equal(canBuyOakhavenDeal(restored.campaign, 'hero_shard_crate'), true)

  // Clearing Oakhaven City increments battlesWon (refreshing stock) AND grants 20% Guild Patron discount
  restored.campaign.clearedStageIds.push(OAKHAVEN_STAGE_ID)
  restored.campaign.chaptersCleared = 2
  restored.campaign.battlesWon = 2
  assert.equal(hasOakhavenPatronDiscount(restored.campaign), true)

  const discountedDustCost = getOakhavenDealCost(restored.campaign, 'dust_satchel')
  assert.ok(discountedDustCost < dustBaseCost, 'Guild Patron discount must reduce gold cost')
  assert.equal(canBuyOakhavenDeal(restored.campaign, 'dust_satchel'), true, 'Stock must refresh on new battle cycle')

  // Buy Hero Shards & Relic Caravan Bundle at discounted rates
  const shardRes = buyOakhavenDeal(restored, 'hero_shard_crate')
  assert.equal(shardRes.ok, true)
  assert.equal(shardRes.shardsGained, 60)
  assert.equal(restored.campaign.shards, 60)

  const equipCountBefore = restored.campaign.equipment.length
  const relicRes = buyOakhavenDeal(restored, 'relic_caravan_bundle')
  assert.equal(relicRes.ok, true)
  assert.ok(relicRes.equipCard, 'Relic Caravan Cache must grant a Relic equipment card')
  assert.equal(relicRes.equipCard!.slot, 'relic')
  assert.notEqual(EQUIPMENT_BY_ID[relicRes.equipCard!.equipId].rarity, 'common')
  assert.equal(restored.campaign.equipment.length, equipCountBefore + 1)

  const offers = getOakhavenExchangeOffers(restored.campaign)
  assert.equal(offers.length, 3)
  assert.equal(offers.every(o => o.discounted), true)
  assert.equal(offers.find(o => o.deal.id === 'relic_caravan_bundle')?.stockRemaining, 0)
})

test('Galewind Ridge triggers periodic wind-push on Height 2+ units every 2 rounds while sparing low-ground units', () => {
  const state = createInitialState(8802)
  const battle = startStageBattle(state, GALEWIND_STAGE_ID)

  // Ensure initial status is reported and round 1 telegraphs imminent gust
  const initHud = getAct1StageMechanicStatus(battle)
  assert.ok(initHud && initHud.stageId === GALEWIND_STAGE_ID)
  assert.equal(isGalewindGustImminent(battle), false)

  // Place one ally on high ground (col 5, row 2 -> height 2, clear tile (4,2) to the west)
  // and one ally on low ground (col 1, row 2 -> height 0)
  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  const highAlly = allies[0]
  const lowAlly = allies[1]
  // Move any enemy off (4,2) and (5,2) so highAlly has a clean 1-tile west push
  for (const e of enemies) {
    if ((e.col === 4 || e.col === 5) && e.row === 2) {
      e.col = 8
      e.row = 3
    }
  }
  highAlly.col = 5
  highAlly.row = 2
  lowAlly.col = 1
  lowAlly.row = 2

  assert.ok(cellHeightLevel(battle.cells[highAlly.row][highAlly.col]) >= GALEWIND_MIN_HEIGHT)
  assert.ok(cellHeightLevel(battle.cells[lowAlly.row][lowAlly.col]) < GALEWIND_MIN_HEIGHT)

  // Round 1: gust should NOT trigger yet, but telegraph becomes imminent
  battle.objective.roundsElapsed = 1
  assert.equal(isGalewindGustImminent(battle), true)
  const hudR1 = getAct1StageMechanicStatus(battle)
  assert.equal(hudR1?.urgent, true)
  const r1 = applyGalewindGust(state)
  assert.equal(r1.triggered, false)
  assert.equal(highAlly.col, 5)

  // Round 2: gust triggers! highAlly pushed 1 tile west (5 -> 4), lowAlly untouched (stays at 1)
  battle.objective.roundsElapsed = 2
  const r2 = applyAct1StageRoundBoundary(state)
  assert.ok(r2?.galewind?.triggered, 'Galewind Gust must trigger on Round 2')
  assert.equal(highAlly.col, 4, 'Exposed Height 2+ unit must be pushed 1 tile west')
  assert.equal(highAlly.row, 2)
  assert.equal(lowAlly.col, 1, 'Low-ground unit (height < 2) must be sheltered from Galewind Gust')
  assert.ok(battle.combatLog.some(e => e.text.includes('Galewind Gust')), 'Combat log must record Galewind Gust')

  // Re-invoking on same round 2 must NOT double-fire (guarded by lastGustRound)
  const dup = applyGalewindGust(state)
  assert.equal(dup.triggered, false)
  assert.equal(highAlly.col, 4)

  // Snapshot round-trip preserves lastGustRound
  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap && snap.stageMechanic?.lastGustRound === 2)
})

test('Emerald Delta Rising Tide alternates low-tide fords every 2 rounds, safely shifts stranded units ashore with Slow, and persists cleanly', () => {
  const state = createInitialState(8803)
  const battle = startStageBattle(state, EMERALD_DELTA_STAGE_ID)

  // Initially Low Tide: all marked ford tiles are walkable bridges
  assert.equal(isEmeraldTideHighOnRound(0), false)
  assert.equal(isEmeraldTideHighOnRound(1), false)
  assert.equal(isEmeraldTideHighOnRound(2), true)
  assert.equal(isEmeraldTideHighOnRound(4), false)

  for (const ford of EMERALD_TIDE_FORD_TILES) {
    assert.equal(isEmeraldDeltaFordTile(ford.col, ford.row), true)
    assert.equal(battle.cells[ford.row][ford.col].terrain, 'bridge')
    assert.equal(battle.cells[ford.row][ford.col].walkable, true)
  }

  // Place an ally directly on a low-tide ford tile (col 2, row 1)
  const hero = battle.units.find(u => u.alive && u.team === 'ally')!
  hero.col = 2
  hero.row = 1
  const hpBefore = hero.hp
  const shieldBefore = hero.shield

  // Round 2: High Tide floods all marked ford tiles -> hero safely shifted to dry shore + splash/slow
  battle.objective.roundsElapsed = 2
  const surge = applyAct1StageRoundBoundary(state)
  assert.ok(surge?.tide?.toggled && surge.tide.tideHigh, 'Round 2 must trigger High Tide')
  assert.equal(surge.tide.floodedCount, EMERALD_TIDE_FORD_TILES.length)
  assert.ok(surge.tide.shiftedUids.includes(hero.uid), 'Unit on flooding ford must be shifted ashore')

  for (const ford of EMERALD_TIDE_FORD_TILES) {
    assert.equal(battle.cells[ford.row][ford.col].terrain, 'water')
    assert.equal(battle.cells[ford.row][ford.col].walkable, false)
  }
  assert.equal(isEmeraldDeltaFordTile(hero.col, hero.row), false, 'Shifted unit must no longer stand on a ford tile')
  assert.equal(battle.cells[hero.row][hero.col].walkable, true, 'Shifted unit must stand on a walkable dry tile')
  assert.ok(hero.slowTurns >= 1, 'Tide wash must apply Slow')
  assert.ok(hero.hp < hpBefore || hero.shield < shieldBefore, 'Tide wash must deal minor splash damage')
  assert.equal(hero.alive, true, 'Tide wash must keep relocated unit alive ashore')
  assert.ok(battle.combatLog.some(e => e.text.includes('Rising Tide')), 'Combat log must record Rising Tide')

  // Save/resume during High Tide preserves flooded cells & tideHigh flag
  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap, 'Battle snapshot must serialize during High Tide')
  assert.equal(snap.stageMechanic?.tideHigh, true)

  const resumedState = createInitialState(8803)
  assert.equal(restoreBattleState(resumedState, snap), true)
  const rb = resumedState.battle!
  assert.equal(rb.stageMechanic?.tideHigh, true)
  for (const ford of EMERALD_TIDE_FORD_TILES) {
    assert.equal(rb.cells[ford.row][ford.col].terrain, 'water')
    assert.equal(rb.cells[ford.row][ford.col].walkable, false)
  }

  // Round 4 after resume: Low Tide returns and restores walkable bridges!
  rb.objective.roundsElapsed = 4
  const recede = applyEmeraldDeltaTide(resumedState)
  assert.equal(recede.toggled, true)
  assert.equal(recede.tideHigh, false)
  for (const ford of EMERALD_TIDE_FORD_TILES) {
    assert.equal(rb.cells[ford.row][ford.col].terrain, 'bridge')
    assert.equal(rb.cells[ford.row][ford.col].walkable, true)
  }
})

test('Solis Monastery spawns multi-wave reinforcements on rounds 2, 4, and 5, honors save/resume parity, and wins on Round 6 defense', () => {
  const state = createInitialState(8804)
  const battle = startStageBattle(state, SOLIS_MONASTERY_STAGE_ID)

  assert.equal(battle.objective.kind, 'defend')
  assert.equal(battle.objective.targetTurns, 6)
  assert.deepEqual(MONASTERY_REINFORCEMENT_ROUNDS, [2, 4, 5])

  const initialEnemyCount = battle.units.filter(u => u.alive && u.team === 'enemy').length
  assert.equal(initialEnemyCount, 4)

  // Round 1: no reinforcements yet
  battle.objective.roundsElapsed = 1
  assert.equal(spawnMonasteryReinforcements(state).triggered, false)
  assert.equal(battle.units.filter(u => u.alive && u.team === 'enemy').length, initialEnemyCount)

  // Round 2: Wave 2 arrives (+2 enemies)
  battle.objective.roundsElapsed = 2
  const w2 = applyAct1StageRoundBoundary(state)
  assert.ok(w2?.monastery?.triggered)
  assert.equal(w2.monastery.waveNumber, 2)
  assert.equal(w2.monastery.spawnedUids.length, 2)
  assert.equal(battle.units.filter(u => u.alive && u.team === 'enemy').length, initialEnemyCount + 2)
  assert.ok(battle.combatLog.some(e => e.text.includes('Solis Monastery Wave 2')))

  // Save/resume right after Round 2 -> spawnedWaves = [2] must persist so Wave 2 never duplicates
  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap)
  assert.deepEqual(snap.stageMechanic?.spawnedWaves, [2])

  const resumedState = createInitialState(8804)
  assert.equal(restoreBattleState(resumedState, snap), true)
  const rb = resumedState.battle!
  assert.deepEqual(rb.stageMechanic?.spawnedWaves, [2])
  assert.equal(spawnMonasteryReinforcements(resumedState).triggered, false, 'Wave 2 must not duplicate after resume')

  // Round 4: Wave 3 arrives (+2 enemies)
  rb.objective.roundsElapsed = 4
  const w3 = spawnMonasteryReinforcements(resumedState)
  assert.equal(w3.triggered, true)
  assert.equal(w3.waveNumber, 3)
  assert.equal(w3.spawnedUids.length, 2)
  assert.equal(rb.units.filter(u => u.alive && u.team === 'enemy').length, initialEnemyCount + 4)

  // Round 5: Wave 4 arrives (+2 enemies, still within MONASTERY_MAX_ALIVE_ENEMIES = 10)
  rb.objective.roundsElapsed = 5
  const w4 = spawnMonasteryReinforcements(resumedState)
  assert.equal(w4.triggered, true)
  assert.equal(w4.waveNumber, 4)
  assert.equal(w4.spawnedUids.length, 2)
  const totalAfterW4 = rb.units.filter(u => u.alive && u.team === 'enemy').length
  assert.equal(totalAfterW4, Math.min(MONASTERY_MAX_ALIVE_ENEMIES, initialEnemyCount + 6))

  // Verify no spawned reinforcement overlaps any other unit or the protectTile
  const occupied = new Set<string>()
  const pt = rb.objective.protectTile!
  for (const u of rb.units) {
    if (!u.alive) continue
    const key = `${u.col},${u.row}`
    assert.equal(occupied.has(key), false, `No overlapping units at (${key})`)
    occupied.add(key)
    if (u.team === 'enemy') {
      assert.equal(u.col === pt.col && u.row === pt.row, false, 'Reinforcement must not spawn on Relic Altar')
    }
  }

  // Round 6 via endPlayerTurn secures Defend Victory!
  rb.phase = 'player'
  const activeAlly = rb.units.find(u => u.alive && u.team === 'ally')!
  rb.activeUnitUid = activeAlly.uid
  assert.ok(getUnitByUid(rb, rb.activeUnitUid))
  endPlayerTurn(resumedState)
  assert.equal(rb.objective.roundsElapsed, 6)
  assert.equal(rb.phase, 'victory', 'Surviving 6 rounds at Solis Monastery must grant Defend Victory')
})

test('expansion-act1.ts compiles cleanly to GDScript via compileTsToGd', () => {
  const source = readFileSync(
    new URL('../examples/crownshard/crownshard/expansion-act1.ts', import.meta.url),
    'utf8'
  )
  const gd = compileTsToGd(source, 'expansion-act1.ts')
  assert.equal(typeof gd, 'string')
  assert.ok(gd.length > 200, 'Compiled GDScript output should be non-empty')
  assert.ok(gd.includes('buyOakhavenDeal') || gd.includes('applyGalewindGust'), 'Compiled GDScript should emit expansion functions')
})
