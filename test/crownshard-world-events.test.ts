import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import { CHAPTERS, CHAPTER_BY_ID, EQUIPMENT_BY_ID, TACTIC_BY_ID } from '../examples/crownshard/crownshard/data.ts'
import {
  MAX_WORLD_EVENTS, SAVE_KEY, WORLD_EVENT_AMBUSH_DURATION, WORLD_EVENT_GAUNTLET_DURATION,
  WORLD_EVENT_MERCHANT_DURATION, armSkill, buildWorldEventChapterSpec, buyWorldEventOffer,
  createInitialState, getEligibleWorldEventRoads, getUnitByUid, getWorldMapEventById,
  loadSave, persistSave, selectTile, serializeSave, startChapterBattle, startWorldEventBattle,
  stepGame, tickWorldMapEvents
} from '../examples/crownshard/crownshard/simulation.ts'
import type { StorageLike } from '../examples/crownshard/crownshard/simulation.ts'
import { cellHeightLevel, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BiomeId, SaveData, WorldEventKind, WorldMapEvent } from '../examples/crownshard/crownshard/types.ts'

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>()
  return {
    store,
    getItem(key: string) {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    }
  }
}

/** Verify every walkable cell (including all spawns and chests) forms a single jump-1 connected component. */
function assertJump1Connected(battle: BattleState, label: string): void {
  const walkableKeys: string[] = []
  const heightByKey = new Map<string, number>()

  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      const cell = battle.cells[r][c]
      if (terrainWalkable(cell.terrain)) {
        const key = `${c},${r}`
        walkableKeys.push(key)
        heightByKey.set(key, cellHeightLevel(cell))
      }
    }
  }
  assert.ok(walkableKeys.length > 0, `${label}: map must have walkable tiles`)

  const start = walkableKeys[0]
  const visited = new Set<string>([start])
  const queue: string[] = [start]
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

  while (queue.length > 0) {
    const cur = queue.shift()!
    const [cx, cy] = cur.split(',').map(Number)
    const ch = heightByKey.get(cur)!
    for (const [dc, dr] of dirs) {
      const nk = `${cx + dc},${cy + dr}`
      if (visited.has(nk) || !heightByKey.has(nk)) continue
      const nh = heightByKey.get(nk)!
      if (Math.abs(nh - ch) <= 1) {
        visited.add(nk)
        queue.push(nk)
      }
    }
  }

  assert.equal(
    visited.size,
    walkableKeys.length,
    `${label}: all ${walkableKeys.length} walkable tiles must be jump-1 connected (reached ${visited.size})`
  )

  for (const u of battle.units) {
    const k = `${u.col},${u.row}`
    assert.ok(visited.has(k), `${label}: unit ${u.name} at (${k}) must sit on jump-1 reachable walkable tile`)
  }
  for (const chest of battle.objective.chestTiles) {
    const k = `${chest.col},${chest.row}`
    assert.ok(visited.has(k), `${label}: chest at (${k}) must sit on jump-1 reachable walkable tile`)
  }
}

/** Finish the active battle cleanly by routing all enemies with the active ally hero. */
function winActiveBattle(state: ReturnType<typeof createInitialState>): void {
  const battle = state.battle!
  assert.ok(battle, 'Expected active battle')
  let guard = 0
  while (battle.phase === 'enemy' && guard++ < 600) {
    stepGame(state, STEP)
  }
  assert.equal(battle.phase, 'player', 'Expected player phase before finishing battle')

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  assert.ok(hero && hero.team === 'ally', 'Expected active ally hero')

  const enemies = battle.units.filter(u => u.alive && u.team === 'enemy')
  assert.ok(enemies.length > 0, 'Expected at least one alive enemy')
  for (let i = 0; i < enemies.length - 1; i++) {
    enemies[i].hp = 0
    enemies[i].alive = false
  }
  const lastEnemy = enemies[enemies.length - 1]
  lastEnemy.hp = 3
  lastEnemy.shield = 0
  hero.col = Math.max(0, lastEnemy.col - 1)
  hero.row = lastEnemy.row
  hero.acted = false
  hero.cooldowns = [0, 0, 0]
  assert.equal(armSkill(state, 0), true, 'Expected skill 0 to arm')
  assert.equal(selectTile(state, lastEnemy.col, lastEnemy.row), true, 'Expected lethal strike on last enemy')
  assert.equal(battle.phase, 'victory', 'Expected battle victory')
}

/** Find a deterministic campaign state that has an active event of the requested kind. */
function makeStateWithEventKind(kind: WorldEventKind): {
  state: ReturnType<typeof createInitialState>
  event: WorldMapEvent
} {
  for (let seed = 100; seed < 500; seed++) {
    const state = createInitialState(seed)
    state.campaign.clearedStageIds = ['border_watch', 'miller_ford', 'sunken_bridge']
    state.campaign.chaptersCleared = 3
    state.campaign.battlesWon = 3
    state.campaign.worldEvents = []
    tickWorldMapEvents(state.campaign)
    const found = state.campaign.worldEvents.find(e => e.kind === kind)
    if (found) return { state, event: found }
  }
  throw new Error(`Could not spawn event kind ${kind}`)
}

test('Deterministic spawning along cleared roads only — zero spawns before clearing Stage 1', () => {
  const fresh = createInitialState(1337)
  assert.equal(fresh.campaign.clearedStageIds.length, 0)
  assert.deepEqual(getEligibleWorldEventRoads(fresh.campaign), [])
  const beforeClear = tickWorldMapEvents(fresh.campaign)
  assert.equal(beforeClear.spawned.length, 0)
  assert.equal(fresh.campaign.worldEvents.length, 0, 'Zero events must spawn before Stage 1 is cleared')

  // Win Stage 1 in an actual battle -> tickWorldMapEvents runs automatically on victory
  startChapterBattle(fresh, 0, 0)
  winActiveBattle(fresh)
  assert.deepEqual(fresh.campaign.clearedStageIds, ['border_watch'])
  assert.equal(fresh.campaign.battlesWon, 1)
  assert.ok(fresh.campaign.worldEvents.length >= 1 && fresh.campaign.worldEvents.length <= MAX_WORLD_EVENTS)

  const clearedSet = new Set(fresh.campaign.clearedStageIds)
  for (const ev of fresh.campaign.worldEvents) {
    const from = CHAPTER_BY_ID[ev.fromStageId]
    const to = CHAPTER_BY_ID[ev.toStageId]
    assert.ok(from && to, 'Event endpoints must be valid chapters')
    assert.ok(
      clearedSet.has(from.id) || clearedSet.has(to.id),
      `Event ${ev.id} must anchor on a road with at least one cleared stage`
    )
    assert.ok(to.requires.includes(from.id), `Road ${from.id} -> ${to.id} must be a real prerequisite edge`)
    const expectedX = Math.round(((from.mapX + to.mapX) * 0.5) * 10000) / 10000
    const expectedY = Math.round(((from.mapY + to.mapY) * 0.5) * 10000) / 10000
    assert.equal(ev.mapX, expectedX, 'Event X must be anchored at road midpoint')
    assert.equal(ev.mapY, expectedY, 'Event Y must be anchored at road midpoint')
  }

  // Exact determinism check for identical (seed, battlesWon, clearedStageIds)
  const a = createInitialState(9001)
  const b = createInitialState(9001)
  a.campaign.clearedStageIds = ['border_watch', 'miller_ford']
  b.campaign.clearedStageIds = ['border_watch', 'miller_ford']
  a.campaign.battlesWon = 4
  b.campaign.battlesWon = 4
  const seedBefore = a.campaign.seed
  tickWorldMapEvents(a.campaign)
  tickWorldMapEvents(b.campaign)
  assert.equal(a.campaign.seed, seedBefore, 'tickWorldMapEvents must not perturb campaign.seed')
  assert.deepEqual(a.campaign.worldEvents, b.campaign.worldEvents, 'Spawning must be 100% deterministic')
  assert.equal(a.campaign.worldEvents.length, MAX_WORLD_EVENTS)
})

test('Expiration countdown across battles and automatic event replacement', () => {
  const state = createInitialState(2026)
  state.campaign.clearedStageIds = ['border_watch', 'miller_ford', 'sunken_bridge']
  state.campaign.battlesWon = 1

  const t1 = tickWorldMapEvents(state.campaign)
  assert.equal(t1.spawned.length, MAX_WORLD_EVENTS)
  const initialIds = state.campaign.worldEvents.map(e => e.id)
  const initialDurations = state.campaign.worldEvents.map(e => e.expiresAfterBattles)

  // Battle 2: durations decrement by 1, none expired yet (min initial duration is 2)
  state.campaign.battlesWon = 2
  const t2 = tickWorldMapEvents(state.campaign)
  assert.equal(t2.expiredIds.length, 0)
  assert.equal(state.campaign.worldEvents.length, MAX_WORLD_EVENTS)
  for (let i = 0; i < initialIds.length; i++) {
    const ev = getWorldMapEventById(state.campaign, initialIds[i])!
    assert.ok(ev)
    assert.equal(ev.expiresAfterBattles, initialDurations[i] - 1)
  }

  // Advance battles until every initial event has expired and been replaced
  let replacedAny = false
  for (let step = 3; step <= 6; step++) {
    state.campaign.battlesWon = step
    const res = tickWorldMapEvents(state.campaign)
    if (res.expiredIds.length > 0) {
      replacedAny = true
      assert.ok(res.spawned.length > 0, 'Expired event slots must spawn fresh replacement events')
    }
    assert.equal(state.campaign.worldEvents.length, MAX_WORLD_EVENTS)
  }
  assert.equal(replacedAny, true, 'Initial events must expire after 2-3 battles')
  for (const oldId of initialIds) {
    assert.equal(getWorldMapEventById(state.campaign, oldId), undefined, `Old event ${oldId} must have expired`)
  }
})

test('Wandering Relic Caravan bargain purchases, delivery, out-of-stock rejection, and auto-departure', () => {
  const { state, event } = makeStateWithEventKind('wandering_merchant')
  assert.equal(event.expiresAfterBattles, WORLD_EVENT_MERCHANT_DURATION)
  assert.ok(event.offers && event.offers.length === 3, 'Merchant must offer exactly 3 bargains')

  // Reject when gold is insufficient
  state.campaign.gold = 10
  const poorRes = buyWorldEventOffer(state, event.id, 0)
  assert.equal(poorRes.ok, false)
  assert.equal(poorRes.goldSpent, 0)
  assert.equal(event.offers[0].purchased, false)

  // Give plenty of gold and purchase all 3 deals
  state.campaign.gold = 2000
  const equipCount0 = state.campaign.equipment.length
  const tacticCount0 = state.campaign.tactics.length
  const dust0 = state.campaign.dust
  const shards0 = state.campaign.shards

  // Deal 0: discounted Rare/Epic equipment
  const offer0 = event.offers[0]
  assert.equal(offer0.kind, 'equipment')
  assert.ok(offer0.cost < offer0.originalCost, 'Caravan equipment offer should be discounted')
  const r0 = buyWorldEventOffer(state, event.id, 0)
  assert.equal(r0.ok, true)
  assert.equal(r0.goldSpent, offer0.cost)
  assert.ok(r0.equipCard && EQUIPMENT_BY_ID[r0.equipCard.equipId])
  assert.equal(state.campaign.equipment.length, equipCount0 + 1)
  assert.equal(r0.eventCleared, false)

  // Out-of-stock rejection when re-buying Deal 0
  const dup0 = buyWorldEventOffer(state, event.id, 0)
  assert.equal(dup0.ok, false)
  assert.equal(dup0.goldSpent, 0)

  // Deal 1: Arcane Dust bundle
  const offer1 = event.offers[1]
  assert.equal(offer1.kind, 'dust')
  const r1 = buyWorldEventOffer(state, event.id, 1)
  assert.equal(r1.ok, true)
  assert.ok(r1.dustGained > 0)
  assert.equal(state.campaign.dust, dust0 + r1.dustGained)
  assert.equal(r1.eventCleared, false)

  // Deal 2: Rare/Epic Tactic or Hero Shards cache -> buying last deal departs caravan!
  const offer2 = event.offers[2]
  const r2 = buyWorldEventOffer(state, event.id, 2)
  assert.equal(r2.ok, true)
  if (offer2.kind === 'tactic') {
    assert.ok(r2.tacticCard && TACTIC_BY_ID[r2.tacticCard.tacticId])
    assert.equal(state.campaign.tactics.length, tacticCount0 + 1)
  } else {
    assert.ok(r2.shardsGained > 0)
    assert.equal(state.campaign.shards, shards0 + r2.shardsGained)
  }
  assert.equal(r2.eventCleared, true, 'Buying all 3 caravan deals must remove the caravan event')
  assert.equal(getWorldMapEventById(state.campaign, event.id), undefined)
  assert.equal(state.campaign.gold, 2000 - offer0.cost - offer1.cost - offer2.cost)
})

test('Goblin Ambush & Timed Gauntlet launch jump-1 connected maps, award bounty spoils, and clear event', () => {
  // 1. Merchant cannot launch combat battle
  const merch = makeStateWithEventKind('wandering_merchant')
  assert.equal(startWorldEventBattle(merch.state, merch.event.id), null)

  // 2. Goblin Ambush launch, jump-1 map check, victory rewards & clearing
  const ambush = makeStateWithEventKind('goblin_ambush')
  assert.equal(ambush.event.expiresAfterBattles, WORLD_EVENT_AMBUSH_DURATION)
  const goldBeforeAmbush = ambush.state.campaign.gold
  const dustBeforeAmbush = ambush.state.campaign.dust
  const clearedBeforeAmbush = ambush.state.campaign.clearedStageIds.slice()

  const ambushBattle = startWorldEventBattle(ambush.state, ambush.event.id)
  assert.ok(ambushBattle, 'Goblin Ambush must launch playable battle')
  assert.equal(ambushBattle.activeWorldEventId, ambush.event.id)
  assert.equal(ambushBattle.activeWorldEventKind, 'goblin_ambush')
  assert.equal(ambushBattle.biome, ambush.event.biome)
  assert.equal(ambushBattle.objective.chestTiles.length, 2, 'Goblin Ambush must place 2 treasure chests')
  assertJump1Connected(ambushBattle, 'goblin_ambush')

  winActiveBattle(ambush.state)
  assert.ok(ambushBattle.reward)
  assert.equal(ambushBattle.reward.worldEventId, ambush.event.id)
  assert.equal(ambushBattle.reward.gold, ambush.event.rewardGold)
  assert.equal(ambushBattle.reward.bonusDust, ambush.event.rewardDust)
  assert.equal(ambush.state.campaign.gold, goldBeforeAmbush + ambush.event.rewardGold)
  assert.equal(ambush.state.campaign.dust, dustBeforeAmbush + ambush.event.rewardDust)
  assert.deepEqual(ambush.state.campaign.clearedStageIds, clearedBeforeAmbush, 'Event battle must not fake story clear')
  assert.equal(getWorldMapEventById(ambush.state.campaign, ambush.event.id), undefined, 'Completed ambush must clear')

  // 3. Timed Gauntlet launch, jump-1 map check, victory Shards + Rare/Epic gear drop
  const gauntlet = makeStateWithEventKind('timed_gauntlet')
  assert.equal(gauntlet.event.expiresAfterBattles, WORLD_EVENT_GAUNTLET_DURATION)
  const shardsBefore = gauntlet.state.campaign.shards
  const equipBefore = gauntlet.state.campaign.equipment.length

  const gauntletBattle = startWorldEventBattle(gauntlet.state, gauntlet.event.id)
  assert.ok(gauntletBattle, 'Timed Gauntlet must launch playable battle')
  assert.equal(gauntletBattle.activeWorldEventId, gauntlet.event.id)
  assert.equal(gauntletBattle.activeWorldEventKind, 'timed_gauntlet')
  assertJump1Connected(gauntletBattle, 'timed_gauntlet')

  winActiveBattle(gauntlet.state)
  assert.ok(gauntletBattle.reward)
  assert.equal(gauntletBattle.reward.worldEventId, gauntlet.event.id)
  assert.ok((gauntletBattle.reward.bonusShards ?? 0) > 0, 'Timed Gauntlet must award bonus Hero Shards')
  assert.equal(gauntlet.state.campaign.shards, shardsBefore + gauntlet.event.rewardShards)
  assert.ok(gauntletBattle.reward.equipCard, 'Timed Gauntlet must award upgraded Rare/Epic gear drop')
  const dropSpec = EQUIPMENT_BY_ID[gauntletBattle.reward.equipCard.equipId]
  assert.ok(dropSpec && (dropSpec.rarity === 'rare' || dropSpec.rarity === 'epic'))
  assert.equal(gauntlet.state.campaign.equipment.length, equipBefore + 1)
  assert.equal(getWorldMapEventById(gauntlet.state.campaign, gauntlet.event.id), undefined, 'Completed gauntlet must clear')

  // 4. Verify jump-1 connectivity across EVERY biome for both combat event types
  const allBiomes: BiomeId[] = ['meadow', 'river', 'crypt', 'frost', 'volcano', 'throne', 'dunes', 'aether', 'expanse']
  for (const biome of allBiomes) {
    for (const kind of ['goblin_ambush', 'timed_gauntlet'] as const) {
      const syntheticEvent: WorldMapEvent = {
        ...ambush.event,
        id: `test_${kind}_${biome}`,
        kind,
        biome,
        enemies: undefined
      }
      const spec = buildWorldEventChapterSpec(syntheticEvent)
      const s = createInitialState(555)
      s.campaign.worldEvents = [syntheticEvent]
      const b = startWorldEventBattle(s, syntheticEvent.id)!
      assert.ok(b)
      assert.equal(spec.biome, biome)
      assertJump1Connected(b, `${kind}:${biome}`)
    }
  }
})

test('Mid-battle BattleSaveSnapshot save/resume preserves activeWorldEventId and awards event victory spoils', () => {
  const { state, event } = makeStateWithEventKind('goblin_ambush')
  const battle = startWorldEventBattle(state, event.id)!
  assert.ok(battle)
  assert.equal(battle.phase, 'player')

  // Move active hero once mid-battle before saving
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const dest = battle.moveTiles[0]
  assert.ok(dest)
  assert.equal(selectTile(state, dest.col, dest.row), true)
  for (let i = 0; i < 120; i++) stepGame(state, STEP)

  const storage = createMemoryStorage()
  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded && loaded.activeBattle, 'Active world event battle must serialize into save')
  assert.equal(loaded.activeBattle.activeWorldEventId, event.id)
  assert.equal(loaded.activeBattle.activeWorldEventKind, 'goblin_ambush')
  assert.equal(loaded.activeBattle.activeWorldEventTitle, event.title)

  const resumed = createInitialState(1, loaded)
  assert.ok(resumed.battle)
  assert.equal(resumed.battle.activeWorldEventId, event.id)
  assert.equal(resumed.battle.activeWorldEventKind, 'goblin_ambush')
  assert.equal(resumed.battle.objective.chestTiles.length, 2)

  const goldBefore = resumed.campaign.gold
  const dustBefore = resumed.campaign.dust
  winActiveBattle(resumed)
  assert.equal(resumed.battle.reward?.worldEventId, event.id)
  assert.equal(resumed.campaign.gold, goldBefore + event.rewardGold)
  assert.equal(resumed.campaign.dust, dustBefore + event.rewardDust)
  assert.equal(getWorldMapEventById(resumed.campaign, event.id), undefined)
})

test('Campaign save/load round-trip preserves worldEvents and supports legacy saves without worldEvents', () => {
  const { state, event } = makeStateWithEventKind('wandering_merchant')
  state.campaign.gold = 900
  const buyRes = buyWorldEventOffer(state, event.id, 0)
  assert.equal(buyRes.ok, true)

  const storage = createMemoryStorage()
  persistSave(storage, state)
  const loaded = loadSave(storage)
  assert.ok(loaded)
  const hydrated = createInitialState(77, loaded)
  assert.equal(hydrated.campaign.worldEvents.length, state.campaign.worldEvents.length)
  const restoredMerchant = getWorldMapEventById(hydrated.campaign, event.id)!
  assert.ok(restoredMerchant && restoredMerchant.offers)
  assert.equal(restoredMerchant.offers[0].purchased, true, 'Purchased offer state must persist across save/load')
  assert.equal(restoredMerchant.offers[1].purchased, false)

  // Legacy save compatibility: strip worldEvents completely
  const rawSave = JSON.parse(JSON.stringify(serializeSave(state))) as SaveData
  delete (rawSave.campaign as { worldEvents?: unknown }).worldEvents
  storage.setItem(SAVE_KEY, JSON.stringify(rawSave))
  const legacyLoaded = loadSave(storage)
  assert.ok(legacyLoaded)
  const legacyState = createInitialState(88, legacyLoaded)
  assert.deepEqual(legacyState.campaign.worldEvents, [], 'Legacy saves without worldEvents must default to []')

  // Corrupted worldEvents entries are safely skipped
  const badSave = JSON.parse(JSON.stringify(serializeSave(state))) as Record<string, unknown>
  ;(badSave.campaign as Record<string, unknown>).worldEvents = [
    null,
    42,
    { id: 'bad', kind: 'unknown_kind', fromStageId: 'border_watch', toStageId: 'miller_ford', expiresAfterBattles: 2 },
    { id: 'expired', kind: 'goblin_ambush', fromStageId: 'border_watch', toStageId: 'miller_ford', expiresAfterBattles: 0 }
  ]
  storage.setItem(SAVE_KEY, JSON.stringify(badSave))
  const sanitizedLoaded = loadSave(storage)
  assert.ok(sanitizedLoaded)
  assert.deepEqual(sanitizedLoaded.campaign.worldEvents, [])
})

test('world-events.ts is browser-global-free and compiles cleanly via compileTsToGd', () => {
  const source = readFileSync(
    new URL('../examples/crownshard/crownshard/world-events.ts', import.meta.url),
    'utf8'
  )
  assert.equal(/\b(window|document|localStorage|sessionStorage|navigator)\b/.test(source), false)
  const gd = compileTsToGd(source, 'world-events.ts')
  assert.equal(typeof gd, 'string')
  assert.ok(gd.length > 400, 'Compiled GDScript output should be non-empty')
  assert.ok(gd.includes('tickWorldMapEvents'), 'Compiled GDScript should emit tickWorldMapEvents')
  assert.ok(gd.includes('buyWorldEventOffer'), 'Compiled GDScript should emit buyWorldEventOffer')
  assert.ok(CHAPTERS.length > 0)
})
