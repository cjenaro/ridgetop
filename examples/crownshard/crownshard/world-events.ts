import {
  CHAPTERS,
  CHAPTER_BY_ID,
  ENEMY_SPECS,
  EQUIPMENT_BY_ID,
  EQUIPMENT_LIST,
  RARITY_META,
  TACTIC_BY_ID,
  TACTIC_LIST,
  WORLD_REGIONS
} from './data.ts'
import { selectProtectedEquipment } from './forge.ts'
import type {
  BiomeId,
  CampaignState,
  ChapterEnemySpawn,
  ChapterSpec,
  DifficultyLevel,
  EnemyArchetypeId,
  EquipmentSpec,
  GameState,
  OwnedEquipCard,
  OwnedTacticCard,
  Rarity,
  TacticCardSpec,
  TileTerrain,
  WorldEventKind,
  WorldEventMerchantDealKind,
  WorldEventMerchantOffer,
  WorldMapEvent,
  WorldRegionId
} from './types.ts'

export const MAX_WORLD_EVENTS = 2
export const WORLD_EVENT_MERCHANT_DURATION = 3
export const WORLD_EVENT_AMBUSH_DURATION = 3
export const WORLD_EVENT_GAUNTLET_DURATION = 2

export const WORLD_EVENT_KINDS: readonly WorldEventKind[] = [
  'wandering_merchant',
  'goblin_ambush',
  'timed_gauntlet'
]

export interface WorldEventRoadCandidate {
  readonly roadKey: string
  readonly fromStageId: string
  readonly toStageId: string
  readonly region: WorldRegionId
  readonly biome: BiomeId
  readonly difficulty: DifficultyLevel
  readonly recommendedPower: number
  readonly mapX: number
  readonly mapY: number
}

export interface WorldEventTickResult {
  readonly expiredIds: readonly string[]
  readonly spawned: readonly WorldMapEvent[]
  readonly active: readonly WorldMapEvent[]
}

export interface WorldEventPurchaseResult {
  readonly ok: boolean
  readonly eventId: string
  readonly offerIndex: number
  readonly goldSpent: number
  readonly dustGained: number
  readonly shardsGained: number
  readonly equipCard: OwnedEquipCard | null
  readonly tacticCard: OwnedTacticCard | null
  readonly eventCleared: boolean
  readonly reason: string | null
}

export interface WorldEventVictoryRewardPlan {
  readonly eventId: string
  readonly kind: WorldEventKind
  readonly title: string
  readonly gold: number
  readonly bonusDust: number
  readonly bonusShards: number
  readonly equipSpec: EquipmentSpec | null
}

const WORLD_EVENT_KIND_SET: ReadonlySet<string> = new Set(WORLD_EVENT_KINDS)
const DEAL_KIND_LOOKUP: ReadonlyMap<string, WorldEventMerchantDealKind> = new Map<string, WorldEventMerchantDealKind>([
  ['equipment', 'equipment'],
  ['dust', 'dust'],
  ['shards', 'shards'],
  ['tactic', 'tactic']
])
const RARITY_LOOKUP: ReadonlyMap<string, Rarity> = new Map<string, Rarity>([
  ['common', 'common'],
  ['uncommon', 'uncommon'],
  ['rare', 'rare'],
  ['epic', 'epic'],
  ['legendary', 'legendary']
])
const BIOME_LOOKUP: ReadonlyMap<string, BiomeId> = new Map<string, BiomeId>([
  ['meadow', 'meadow'],
  ['river', 'river'],
  ['crypt', 'crypt'],
  ['frost', 'frost'],
  ['volcano', 'volcano'],
  ['throne', 'throne'],
  ['dunes', 'dunes'],
  ['aether', 'aether'],
  ['expanse', 'expanse']
])
const REGION_LOOKUP: ReadonlyMap<string, WorldRegionId> = new Map<string, WorldRegionId>([
  ['solis_vale', 'solis_vale'],
  ['silverfen', 'silverfen'],
  ['ashen_catacombs', 'ashen_catacombs'],
  ['frostspire', 'frostspire'],
  ['emberwaste', 'emberwaste'],
  ['eclipse_dominion', 'eclipse_dominion'],
  ['sunbleached_dunes', 'sunbleached_dunes'],
  ['aether_isles', 'aether_isles'],
  ['shattered_expanse', 'shattered_expanse']
])
const ENEMY_ID_LOOKUP: ReadonlyMap<string, EnemyArchetypeId> = new Map<string, EnemyArchetypeId>(
  Object.values(ENEMY_SPECS).map(spec => [spec.id, spec.id])
)

function clampInt(n: number, lo: number, hi: number): number {
  const v = Math.floor(n)
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function toDifficulty(n: number): DifficultyLevel {
  const c = clampInt(n, 1, 8)
  if (c === 1) return 1
  if (c === 2) return 2
  if (c === 3) return 3
  if (c === 4) return 4
  if (c === 5) return 5
  if (c === 6) return 6
  if (c === 7) return 7
  return 8
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isWorldEventKind(raw: unknown): raw is WorldEventKind {
  return typeof raw === 'string' && WORLD_EVENT_KIND_SET.has(raw)
}

interface LocalRng {
  state: number
}

function createEventRng(seed: number, battlesWon: number, salt: number): LocalRng {
  let s = ((seed >>> 0) ^ 0x9e3779b9) >>> 0
  s = (Math.imul(s ^ ((battlesWon + 1) * 0x85ebca6b), 0xc2b2ae35) ^ (salt * 0x27d4eb2d)) >>> 0
  s ^= s >>> 15
  s = Math.imul(s | 1, 0x2c1b3c6d) >>> 0
  s ^= s >>> 12
  return { state: s === 0 ? 0x6d2b79f5 : s }
}

function nextLocalFloat(rng: LocalRng): number {
  let x = rng.state >>> 0
  x ^= (x << 13) >>> 0
  x ^= x >>> 17
  x ^= (x << 5) >>> 0
  rng.state = x === 0 ? 0x9e3779b9 : (x >>> 0)
  return (rng.state >>> 0) / 4294967296
}

function pickIndex(rng: LocalRng, length: number): number {
  if (length <= 1) return 0
  return Math.floor(nextLocalFloat(rng) * length) % length
}

function allocEventUid(campaign: CampaignState, prefix: string): string {
  const id = `${prefix}_${campaign.nextUid}`
  campaign.nextUid += 1
  return id
}

function estimateSquadPowerForScaling(campaign: Pick<CampaignState, 'heroes' | 'squadUids' | 'clearedStageIds'>): number {
  const squadCount = Math.max(1, campaign.squadUids.length)
  let total = 0
  for (let i = 0; i < campaign.squadUids.length; i++) {
    const uid = campaign.squadUids[i]
    const h = campaign.heroes.find(hero => hero.uid === uid)
    if (!h) continue
    const lvl = typeof h.level === 'number' && Number.isFinite(h.level) ? Math.max(1, Math.floor(h.level)) : 1
    const gearCount = (h.weaponUid ? 1 : 0) + (h.armorUid ? 1 : 0) + (h.relicUid ? 1 : 0)
    total += 45 + (h.stars - 1) * 28 + (lvl - 1) * 8 + gearCount * 14
  }
  const base = total > 0 ? total : squadCount * 60
  return Math.max(80, base + campaign.clearedStageIds.length * 6)
}

/**
 * Returns every World Map road connecting two playable stages where at least one
 * endpoint has been cleared. Zero roads are returned before clearing Stage 1.
 */
export function getEligibleWorldEventRoads(
  campaign: Pick<CampaignState, 'clearedStageIds'>
): WorldEventRoadCandidate[] {
  if (!Array.isArray(campaign.clearedStageIds) || campaign.clearedStageIds.length === 0) {
    return []
  }
  const clearedSet = new Set(campaign.clearedStageIds)
  const roads: WorldEventRoadCandidate[] = []
  const seenKeys = new Set<string>()

  for (let i = 0; i < CHAPTERS.length; i++) {
    const to = CHAPTERS[i]
    if (to.comingSoon) continue
    for (let j = 0; j < to.requires.length; j++) {
      const fromId = to.requires[j]
      const from = CHAPTER_BY_ID[fromId]
      if (!from || from.comingSoon) continue
      const fromCleared = clearedSet.has(from.id)
      const toCleared = clearedSet.has(to.id)
      if (!fromCleared && !toCleared) continue

      const roadKey = `${from.id}__${to.id}`
      if (seenKeys.has(roadKey)) continue
      seenKeys.add(roadKey)

      const anchor = fromCleared && toCleared
        ? (to.difficulty >= from.difficulty ? to : from)
        : (fromCleared ? from : to)

      const mapX = Math.round(((from.mapX + to.mapX) * 0.5) * 10000) / 10000
      const mapY = Math.round(((from.mapY + to.mapY) * 0.5) * 10000) / 10000

      roads.push({
        roadKey,
        fromStageId: from.id,
        toStageId: to.id,
        region: anchor.region,
        biome: anchor.biome,
        difficulty: anchor.difficulty,
        recommendedPower: anchor.recommendedPower,
        mapX,
        mapY
      })
    }
  }

  return roads
}

export function getWorldMapEventById(
  campaign: Pick<CampaignState, 'worldEvents'>,
  eventId: string | null | undefined
): WorldMapEvent | undefined {
  if (!eventId || !Array.isArray(campaign.worldEvents)) return undefined
  return campaign.worldEvents.find(ev => ev.id === eventId)
}

export function cloneWorldMapEvent(ev: WorldMapEvent): WorldMapEvent {
  return {
    id: ev.id,
    kind: ev.kind,
    title: ev.title,
    subtitle: ev.subtitle,
    fromStageId: ev.fromStageId,
    toStageId: ev.toStageId,
    region: ev.region,
    biome: ev.biome,
    difficulty: ev.difficulty,
    recommendedPower: ev.recommendedPower,
    mapX: ev.mapX,
    mapY: ev.mapY,
    expiresAfterBattles: ev.expiresAfterBattles,
    maxBattles: ev.maxBattles,
    rewardGold: ev.rewardGold,
    rewardDust: ev.rewardDust,
    rewardShards: ev.rewardShards,
    ...(ev.rewardEquipRarity !== undefined ? { rewardEquipRarity: ev.rewardEquipRarity } : {}),
    ...(ev.offers ? { offers: ev.offers.map(o => ({ ...o })) } : {}),
    ...(ev.enemies ? { enemies: ev.enemies.map(e => ({ ...e })) } : {}),
    spawnedAtBattlesWon: ev.spawnedAtBattlesWon
  }
}

export function removeWorldMapEvent(campaign: CampaignState, eventId: string): boolean {
  if (!Array.isArray(campaign.worldEvents)) {
    campaign.worldEvents = []
    return false
  }
  const idx = campaign.worldEvents.findIndex(ev => ev.id === eventId)
  if (idx < 0) return false
  campaign.worldEvents.splice(idx, 1)
  return true
}

function buildMerchantOffers(
  campaign: Pick<CampaignState, 'equipment'>,
  difficulty: DifficultyLevel,
  rng: LocalRng
): WorldEventMerchantOffer[] {
  // Deal 0: Discounted Rare or Epic Equipment card (duplicate-protected)
  const wantEpic = difficulty >= 4 || nextLocalFloat(rng) < 0.3
  const targetEquipRarity: Rarity = wantEpic ? 'epic' : 'rare'
  const equipPool = EQUIPMENT_LIST.filter(e => e.rarity === targetEquipRarity)
  const fallbackPool = equipPool.length > 0 ? equipPool : EQUIPMENT_LIST.filter(e => e.rarity === 'rare')
  const chosenEquip = selectProtectedEquipment(
    fallbackPool.length > 0 ? fallbackPool : EQUIPMENT_LIST,
    campaign,
    nextLocalFloat(rng)
  )
  const equipOrigCost = chosenEquip.rarity === 'epic' ? 320 : 195
  const equipSaleCost = chosenEquip.rarity === 'epic' ? 235 : 140

  // Deal 1: Arcane Dust bundle
  const dustAmount = 45 + difficulty * 10
  const dustOrigCost = Math.round(dustAmount * 2.15)
  const dustSaleCost = Math.round(dustOrigCost * 0.72)

  // Deal 2: Alternate deterministically between Rare/Epic Tactic card and Hero Shard Cache
  const offerTactic = nextLocalFloat(rng) < 0.55
  let deal2: WorldEventMerchantOffer
  if (offerTactic) {
    const tacticPool = TACTIC_LIST.filter(
      t => t.rarity === 'rare' || (difficulty >= 3 && t.rarity === 'epic')
    )
    const chosenTactic: TacticCardSpec = tacticPool.length > 0
      ? tacticPool[pickIndex(rng, tacticPool.length)]
      : TACTIC_LIST[pickIndex(rng, TACTIC_LIST.length)]
    const tacOrigCost = chosenTactic.rarity === 'epic' ? 240 : 165
    const tacSaleCost = chosenTactic.rarity === 'epic' ? 175 : 115
    deal2 = {
      id: `deal_tactic_${chosenTactic.id}`,
      kind: 'tactic',
      label: chosenTactic.name,
      shortLabel: chosenTactic.name,
      detail: `${RARITY_META[chosenTactic.rarity].label} Tactic · ${chosenTactic.desc}`,
      cost: tacSaleCost,
      originalCost: tacOrigCost,
      tacticId: chosenTactic.id,
      rarity: chosenTactic.rarity,
      purchased: false
    }
  } else {
    const shardsAmount = 60 + difficulty * 15
    const shardOrigCost = Math.round(shardsAmount * 1.95)
    const shardSaleCost = Math.round(shardOrigCost * 0.74)
    deal2 = {
      id: `deal_shards_${shardsAmount}`,
      kind: 'shards',
      label: `Hero Shard Cache (+${shardsAmount})`,
      shortLabel: `+${shardsAmount} Shards`,
      detail: `Claim +${shardsAmount} Hero Shards for Armory Hero Forging.`,
      cost: shardSaleCost,
      originalCost: shardOrigCost,
      shardsAmount,
      rarity: difficulty >= 4 ? 'epic' : 'rare',
      purchased: false
    }
  }

  return [
    {
      id: `deal_equip_${chosenEquip.id}`,
      kind: 'equipment',
      label: chosenEquip.name,
      shortLabel: chosenEquip.name,
      detail: `${RARITY_META[chosenEquip.rarity].label} ${chosenEquip.slot} · ${chosenEquip.desc}`,
      cost: equipSaleCost,
      originalCost: equipOrigCost,
      equipId: chosenEquip.id,
      rarity: chosenEquip.rarity,
      purchased: false
    },
    {
      id: `deal_dust_${dustAmount}`,
      kind: 'dust',
      label: `Arcane Dust Crate (+${dustAmount})`,
      shortLabel: `+${dustAmount} Dust`,
      detail: `Discounted caravan satchel granting +${dustAmount} Arcane Dust.`,
      cost: dustSaleCost,
      originalCost: dustOrigCost,
      dustAmount,
      rarity: 'rare',
      purchased: false
    },
    deal2
  ]
}

function buildAmbushEnemies(difficulty: DifficultyLevel, biome: BiomeId): ChapterEnemySpawn[] {
  const scale = Math.round((0.88 + (difficulty - 1) * 0.08) * 100) / 100
  let bruiserId: EnemyArchetypeId = 'orc_brute'
  let bruiserName = 'Loot Hauler'
  if (biome === 'river') {
    bruiserId = 'river_troll'
    bruiserName = 'Bridge Crusher'
  } else if (biome === 'frost') {
    bruiserId = 'ice_wraith'
    bruiserName = 'Frost Raider'
  } else if (biome === 'crypt' || biome === 'volcano' || biome === 'throne' || biome === 'expanse') {
    bruiserId = difficulty >= 4 ? 'crypt_knight' : 'bog_shaman'
    bruiserName = difficulty >= 4 ? 'Bounty Reaver' : 'Ambush Hexer'
  }

  let rangedId: EnemyArchetypeId = 'bone_archer'
  let rangedName = 'Roadside Marksman'
  if (biome === 'volcano' || biome === 'dunes' || biome === 'aether') {
    rangedId = 'ember_pyromancer'
    rangedName = 'Cinder Bandit'
  }

  return [
    { id: 'goblin', col: 5, row: 2, levelScale: scale, name: 'Caravan Pillager' },
    { id: 'goblin', col: 5, row: 3, levelScale: scale, name: 'Greedy Cutthroat' },
    { id: rangedId, col: 6, row: 1, levelScale: scale, name: rangedName },
    { id: bruiserId, col: 6, row: 4, levelScale: Math.max(0.85, Math.round((scale - 0.05) * 100) / 100), name: bruiserName }
  ]
}

function buildGauntletEnemies(difficulty: DifficultyLevel, biome: BiomeId): ChapterEnemySpawn[] {
  const scale = Math.round((0.92 + (difficulty - 1) * 0.08) * 100) / 100
  let leaderId: EnemyArchetypeId = 'briar_warlord'
  let leaderName = 'Gauntlet Champion'
  if (difficulty >= 5) {
    leaderId = biome === 'frost' ? 'frost_jarl' : 'magma_warden'
    leaderName = biome === 'frost' ? 'Vanguard Frost Jarl' : 'Vanguard Warlord'
  } else if (difficulty >= 3) {
    leaderId = biome === 'crypt' || biome === 'volcano' ? 'ash_inquisitor' : 'mire_matriarch'
    leaderName = biome === 'crypt' || biome === 'volcano' ? 'Ashen Duelist' : 'Gauntlet Warden'
  }

  const vanguardId: EnemyArchetypeId = difficulty >= 3 ? 'crypt_knight' : 'orc_brute'
  const casterId: EnemyArchetypeId = biome === 'frost'
    ? 'ice_wraith'
    : biome === 'volcano' || difficulty >= 4
      ? 'ember_pyromancer'
      : 'bog_shaman'
  const sniperId: EnemyArchetypeId = difficulty >= 5 ? 'bone_necromancer' : 'bone_archer'

  return [
    { id: leaderId, col: 6, row: 2, levelScale: Math.max(0.85, Math.round((scale - 0.08) * 100) / 100), name: leaderName },
    { id: vanguardId, col: 5, row: 1, levelScale: scale, name: 'Elite Shieldbearer' },
    { id: casterId, col: 5, row: 4, levelScale: scale, name: 'Gauntlet Arcanist' },
    { id: sniperId, col: 7, row: 3, levelScale: scale, name: 'Vanguard Marksman' }
  ]
}

function createEventOnRoad(
  campaign: Pick<CampaignState, 'heroes' | 'equipment' | 'squadUids' | 'clearedStageIds' | 'battlesWon'>,
  road: WorldEventRoadCandidate,
  kind: WorldEventKind,
  slotIndex: number,
  rng: LocalRng
): WorldMapEvent {
  const regionName = WORLD_REGIONS[road.region]?.name ?? 'Solis'
  const id = `wev_${campaign.battlesWon}_${slotIndex}_${kind}_${road.fromStageId}_${road.toStageId}`

  if (kind === 'wandering_merchant') {
    const offers = buildMerchantOffers(campaign, road.difficulty, rng)
    return {
      id,
      kind,
      title: 'Wandering Relic Caravan',
      subtitle: `Traveling Merchant · ${regionName}`,
      fromStageId: road.fromStageId,
      toStageId: road.toStageId,
      region: road.region,
      biome: road.biome,
      difficulty: road.difficulty,
      recommendedPower: road.recommendedPower,
      mapX: road.mapX,
      mapY: road.mapY,
      expiresAfterBattles: WORLD_EVENT_MERCHANT_DURATION,
      maxBattles: WORLD_EVENT_MERCHANT_DURATION,
      rewardGold: 0,
      rewardDust: 0,
      rewardShards: 0,
      offers,
      spawnedAtBattlesWon: campaign.battlesWon
    }
  }

  if (kind === 'goblin_ambush') {
    const enemies = buildAmbushEnemies(road.difficulty, road.biome)
    const rewardGold = 125 + road.difficulty * 35
    const rewardDust = 30 + road.difficulty * 12
    return {
      id,
      kind,
      title: 'Goblin Ambush Bounty',
      subtitle: `Roadside Raiders · ${regionName}`,
      fromStageId: road.fromStageId,
      toStageId: road.toStageId,
      region: road.region,
      biome: road.biome,
      difficulty: road.difficulty,
      recommendedPower: Math.max(95, Math.round(road.recommendedPower * 0.92)),
      mapX: road.mapX,
      mapY: road.mapY,
      expiresAfterBattles: WORLD_EVENT_AMBUSH_DURATION,
      maxBattles: WORLD_EVENT_AMBUSH_DURATION,
      rewardGold,
      rewardDust,
      rewardShards: 0,
      enemies,
      spawnedAtBattlesWon: campaign.battlesWon
    }
  }

  // timed_gauntlet: scales to the player's squad and local region tier
  const squadPower = estimateSquadPowerForScaling(campaign)
  const squadTier = clampInt(Math.round(squadPower / 85), 1, 8)
  const scaledDifficulty = toDifficulty(Math.max(road.difficulty, Math.min(road.difficulty + 1, squadTier)))
  const enemies = buildGauntletEnemies(scaledDifficulty, road.biome)
  const rewardGold = 140 + scaledDifficulty * 40
  const rewardDust = 20 + scaledDifficulty * 8
  const rewardShards = 55 + scaledDifficulty * 18
  const rewardEquipRarity: Rarity = scaledDifficulty >= 4 ? 'epic' : 'rare'

  return {
    id,
    kind: 'timed_gauntlet',
    title: 'Vanguard Gauntlet',
    subtitle: `Elite Challenge · ${regionName}`,
    fromStageId: road.fromStageId,
    toStageId: road.toStageId,
    region: road.region,
    biome: road.biome,
    difficulty: scaledDifficulty,
    recommendedPower: Math.max(120, Math.round(Math.max(road.recommendedPower * 1.08, squadPower * 0.95))),
    mapX: road.mapX,
    mapY: road.mapY,
    expiresAfterBattles: WORLD_EVENT_GAUNTLET_DURATION,
    maxBattles: WORLD_EVENT_GAUNTLET_DURATION,
    rewardGold,
    rewardDust,
    rewardShards,
    rewardEquipRarity,
    enemies,
    spawnedAtBattlesWon: campaign.battlesWon
  }
}

/**
 * Advances temporary World Map events after a battle victory:
 * 1. Decrements `expiresAfterBattles` on existing active events and removes stale ones.
 * 2. When at least 1 stage is cleared and fewer than 2 events are active, deterministically
 *    spawns fresh events along cleared roads using `campaign.seed` + `campaign.battlesWon`.
 */
export function tickWorldMapEvents(campaign: CampaignState): WorldEventTickResult {
  if (!Array.isArray(campaign.worldEvents)) {
    campaign.worldEvents = []
  }

  const expiredIds: string[] = []
  const surviving: WorldMapEvent[] = []
  for (let i = 0; i < campaign.worldEvents.length; i++) {
    const ev = campaign.worldEvents[i]
    const nextTurns = Math.floor(ev.expiresAfterBattles) - 1
    if (nextTurns <= 0) {
      expiredIds.push(ev.id)
    } else {
      ev.expiresAfterBattles = nextTurns
      surviving.push(ev)
    }
  }
  campaign.worldEvents = surviving

  const spawned: WorldMapEvent[] = []
  if (campaign.clearedStageIds.length < 1 || campaign.worldEvents.length >= MAX_WORLD_EVENTS) {
    return { expiredIds, spawned, active: campaign.worldEvents }
  }

  const eligibleRoads = getEligibleWorldEventRoads(campaign)
  if (eligibleRoads.length === 0) {
    return { expiredIds, spawned, active: campaign.worldEvents }
  }

  const rng = createEventRng(campaign.seed, campaign.battlesWon, 73)
  let slotIndex = 0
  while (campaign.worldEvents.length < MAX_WORLD_EVENTS) {
    const usedRoadKeys = new Set(campaign.worldEvents.map(e => `${e.fromStageId}__${e.toStageId}`))
    let availableRoads = eligibleRoads.filter(r => !usedRoadKeys.has(r.roadKey))
    if (availableRoads.length === 0) break

    // Prefer roads that aren't right on top of another active event pin
    const spacedRoads = availableRoads.filter(r =>
      campaign.worldEvents.every(ev => Math.hypot(ev.mapX - r.mapX, ev.mapY - r.mapY) >= 0.045)
    )
    if (spacedRoads.length > 0) {
      availableRoads = spacedRoads
    }

    const road = availableRoads[pickIndex(rng, availableRoads.length)]

    // Prefer event kinds not currently active so the overworld offers distinct choices
    const activeKinds = new Set(campaign.worldEvents.map(e => e.kind))
    const candidateKinds = WORLD_EVENT_KINDS.filter(k => !activeKinds.has(k))
    const kindPool = candidateKinds.length > 0 ? candidateKinds : WORLD_EVENT_KINDS
    const kind = kindPool[pickIndex(rng, kindPool.length)]

    const ev = createEventOnRoad(campaign, road, kind, slotIndex, rng)
    campaign.worldEvents.push(ev)
    spawned.push(ev)
    slotIndex += 1
  }

  return { expiredIds, spawned, active: campaign.worldEvents }
}

/**
 * Purchase one of the 3 rotating limited-time bargains from a Wandering Relic Caravan
 * directly on the World Map using Gold. Removes the caravan once all deals are sold out.
 */
export function buyWorldEventOffer(
  state: GameState,
  eventId: string,
  offerIndex: number
): WorldEventPurchaseResult {
  const { campaign } = state
  const fail = (reason: string): WorldEventPurchaseResult => ({
    ok: false,
    eventId,
    offerIndex,
    goldSpent: 0,
    dustGained: 0,
    shardsGained: 0,
    equipCard: null,
    tacticCard: null,
    eventCleared: false,
    reason
  })

  const ev = getWorldMapEventById(campaign, eventId)
  if (!ev) return fail('World event no longer available.')
  if (ev.kind !== 'wandering_merchant' || !Array.isArray(ev.offers)) {
    return fail('This event does not offer caravan deals.')
  }
  const idx = Math.floor(offerIndex)
  if (idx < 0 || idx >= ev.offers.length) {
    return fail('Invalid caravan offer.')
  }
  const offer = ev.offers[idx]
  if (offer.purchased) {
    return fail('Offer already sold out.')
  }
  if (campaign.gold < offer.cost) {
    return fail(`Need ${offer.cost}g (${campaign.gold}g available).`)
  }

  campaign.gold -= offer.cost
  let dustGained = 0
  let shardsGained = 0
  let equipCard: OwnedEquipCard | null = null
  let tacticCard: OwnedTacticCard | null = null

  if (offer.kind === 'equipment') {
    const spec = (offer.equipId ? EQUIPMENT_BY_ID[offer.equipId] : undefined) ?? EQUIPMENT_LIST[0]
    equipCard = {
      uid: allocEventUid(campaign, 'eq'),
      equipId: spec.id,
      slot: spec.slot
    }
    campaign.equipment.push(equipCard)
    state.sounds.push({ kind: 'pack', rarity: spec.rarity })
  } else if (offer.kind === 'tactic') {
    const spec = (offer.tacticId ? TACTIC_BY_ID[offer.tacticId] : undefined) ?? TACTIC_LIST[0]
    tacticCard = {
      uid: allocEventUid(campaign, 'tac'),
      tacticId: spec.id
    }
    campaign.tactics.push(tacticCard)
    state.sounds.push({ kind: 'card', pitch: 1.18 })
  } else if (offer.kind === 'dust') {
    dustGained = Math.max(1, Math.floor(offer.dustAmount ?? 45))
    campaign.dust += dustGained
    state.sounds.push({ kind: 'coin', pitch: 1.1 })
  } else {
    shardsGained = Math.max(1, Math.floor(offer.shardsAmount ?? 60))
    campaign.shards += shardsGained
    state.sounds.push({ kind: 'coin', pitch: 1.15 })
  }

  offer.purchased = true
  const allPurchased = ev.offers.every(o => o.purchased)
  if (allPurchased) {
    removeWorldMapEvent(campaign, ev.id)
  }

  return {
    ok: true,
    eventId: ev.id,
    offerIndex: idx,
    goldSpent: offer.cost,
    dustGained,
    shardsGained,
    equipCard,
    tacticCard,
    eventCleared: allPurchased,
    reason: null
  }
}

function biomeGroundTile(biome: BiomeId): TileTerrain {
  if (biome === 'frost') return 'snow'
  if (biome === 'crypt' || biome === 'volcano' || biome === 'throne' || biome === 'expanse') return 'darkstone'
  return 'grass'
}

/**
 * Constructs a playable ChapterSpec for a combat World Map event (`goblin_ambush` or `timed_gauntlet`).
 * Every walkable tile is strictly jump-1 connected (heights 0..1) and matches the local region's biome.
 */
export function buildWorldEventChapterSpec(event: WorldMapEvent): ChapterSpec {
  const anchor = CHAPTER_BY_ID[event.fromStageId] ?? CHAPTERS[0]
  const base = biomeGroundTile(event.biome)
  const brush: TileTerrain = event.biome === 'meadow' || event.biome === 'river' ? 'tall_grass' : base

  if (event.kind === 'goblin_ambush') {
    const grid: TileTerrain[][] = [
      [base, 'hill', brush, base, base, 'hill', brush, base],
      [base, base, base, 'stone', base, base, base, base],
      ['stone', 'stone', 'stone', 'stone', 'stone', 'stone', 'stone', 'stone'],
      ['stone', 'stone', 'stone', 'stone', 'stone', 'stone', 'stone', 'stone'],
      [base, base, base, base, 'stone', base, base, base],
      [base, brush, 'hill', base, base, brush, 'hill', base]
    ]
    const heights: number[][] = [
      [0, 1, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 1, 0]
    ]
    const enemies = event.enemies && event.enemies.length > 0
      ? event.enemies
      : buildAmbushEnemies(event.difficulty, event.biome)

    return {
      ...anchor,
      id: anchor.id,
      index: anchor.index,
      region: event.region,
      kind: 'treasure',
      difficulty: event.difficulty,
      recommendedPower: event.recommendedPower,
      title: event.title,
      subtitle: event.subtitle,
      biome: event.biome,
      introSpeaker: 'Caravan Scout',
      introText: 'Raiders sprung an ambush along the trade road! Claim both caravan chests or rout the bandits to collect the bounty.',
      outroSpeaker: 'Caravan Scout',
      outroText: 'The road is safe again! Take this bounty gold and Arcane Dust for your swift defense.',
      rewardGold: event.rewardGold,
      replayGold: event.rewardGold,
      rewardEquipId: null,
      rewardHeroId: null,
      grid,
      heights,
      heroSpawns: [[0, 2], [0, 3], [1, 2], [1, 3]],
      deployTiles: [
        [0, 1], [0, 2], [0, 3], [0, 4],
        [1, 1], [1, 2], [1, 3], [1, 4],
        [2, 2], [2, 3]
      ],
      objective: {
        kind: 'seize',
        label: 'Ambush Bounty',
        description: 'Claim both caravan chests or rout all roadside raiders.',
        chestTiles: [
          { col: 4, row: 1 },
          { col: 5, row: 4 }
        ],
        requiredChests: 2
      },
      innateMutators: [],
      enemies
    }
  }

  // timed_gauntlet: 8x6 symmetric elite arena with jump-1 elevated flanks & twin central shrines
  const grid: TileTerrain[][] = [
    [base, base, 'hill', 'hill', 'hill', 'hill', base, base],
    [base, 'stone', 'stone', 'stone', 'stone', 'stone', 'stone', base],
    ['stone', 'stone', 'stone', 'hill', 'shrine', 'stone', 'stone', 'stone'],
    ['stone', 'stone', 'stone', 'shrine', 'hill', 'stone', 'stone', 'stone'],
    [base, 'stone', 'stone', 'stone', 'stone', 'stone', 'stone', base],
    [base, base, 'hill', 'hill', 'hill', 'hill', base, base]
  ]
  const heights: number[][] = [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0]
  ]
  const enemies = event.enemies && event.enemies.length > 0
    ? event.enemies
    : buildGauntletEnemies(event.difficulty, event.biome)

  return {
    ...anchor,
    id: anchor.id,
    index: anchor.index,
    region: event.region,
    kind: 'elite',
    difficulty: event.difficulty,
    recommendedPower: event.recommendedPower,
    title: event.title,
    subtitle: event.subtitle,
    biome: event.biome,
    introSpeaker: 'Vanguard Herald',
    introText: 'An elite gauntlet force challenges your squad on the road! Best them for Hero Shards and upgraded gear.',
    outroSpeaker: 'Vanguard Herald',
    outroText: 'A commanding display of tactics! Claim the gauntlet shards and forged war spoils.',
    rewardGold: event.rewardGold,
    replayGold: event.rewardGold,
    rewardEquipId: null,
    rewardHeroId: null,
    grid,
    heights,
    heroSpawns: [[0, 2], [0, 3], [1, 1], [1, 4]],
    deployTiles: [
      [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
      [1, 1], [1, 2], [1, 3], [1, 4],
      [2, 2], [2, 3]
    ],
    objective: {
      kind: 'rout',
      label: 'Vanguard Gauntlet',
      description: 'Defeat the elite gauntlet vanguard to claim bonus Shards and upgraded gear.'
    },
    innateMutators: [],
    enemies
  }
}

/**
 * Computes victory spoils for a completed World Map combat event (duplicate-protected
 * Rare/Epic gear for `timed_gauntlet`, generous Bounty Gold + Dust for `goblin_ambush`).
 */
export function resolveWorldEventVictoryReward(
  campaign: Pick<CampaignState, 'seed' | 'battlesWon' | 'equipment'>,
  event: WorldMapEvent
): WorldEventVictoryRewardPlan {
  let equipSpec: EquipmentSpec | null = null
  if (event.kind === 'timed_gauntlet' || event.rewardEquipRarity !== undefined) {
    const targetRarity: Rarity = event.rewardEquipRarity ?? (event.difficulty >= 4 ? 'epic' : 'rare')
    const pool = EQUIPMENT_LIST.filter(e => e.rarity === targetRarity)
    const fallback = pool.length > 0 ? pool : EQUIPMENT_LIST.filter(e => e.rarity === 'rare')
    const rng = createEventRng(campaign.seed, campaign.battlesWon + event.spawnedAtBattlesWon, 311)
    equipSpec = selectProtectedEquipment(
      fallback.length > 0 ? fallback : EQUIPMENT_LIST,
      campaign,
      nextLocalFloat(rng)
    )
  }

  return {
    eventId: event.id,
    kind: event.kind,
    title: event.title,
    gold: Math.max(0, Math.floor(event.rewardGold)),
    bonusDust: Math.max(0, Math.floor(event.rewardDust)),
    bonusShards: Math.max(0, Math.floor(event.rewardShards)),
    equipSpec
  }
}

function sanitizeOffer(raw: unknown): WorldEventMerchantOffer | null {
  if (!isPlainRecord(raw)) return null
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  const kind = typeof raw.kind === 'string' ? DEAL_KIND_LOOKUP.get(raw.kind) : undefined
  if (!kind) return null
  if (typeof raw.label !== 'string' || raw.label.length === 0) return null
  if (!isFiniteNum(raw.cost) || raw.cost < 0) return null
  const rarity: Rarity = (typeof raw.rarity === 'string' ? RARITY_LOOKUP.get(raw.rarity) : undefined) ?? 'rare'
  const equipId = typeof raw.equipId === 'string' && EQUIPMENT_BY_ID[raw.equipId] ? raw.equipId : undefined
  const tacticId = typeof raw.tacticId === 'string' && TACTIC_BY_ID[raw.tacticId] ? raw.tacticId : undefined
  if (kind === 'equipment' && !equipId) return null
  if (kind === 'tactic' && !tacticId) return null

  return {
    id: raw.id,
    kind,
    label: raw.label,
    shortLabel: typeof raw.shortLabel === 'string' && raw.shortLabel.length > 0 ? raw.shortLabel : raw.label,
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    cost: Math.floor(raw.cost),
    originalCost: isFiniteNum(raw.originalCost) && raw.originalCost >= raw.cost
      ? Math.floor(raw.originalCost)
      : Math.floor(raw.cost),
    ...(equipId !== undefined ? { equipId } : {}),
    ...(tacticId !== undefined ? { tacticId } : {}),
    ...(isFiniteNum(raw.dustAmount) && raw.dustAmount > 0 ? { dustAmount: Math.floor(raw.dustAmount) } : {}),
    ...(isFiniteNum(raw.shardsAmount) && raw.shardsAmount > 0 ? { shardsAmount: Math.floor(raw.shardsAmount) } : {}),
    rarity,
    purchased: raw.purchased === true
  }
}

function sanitizeEnemySpawn(raw: unknown): ChapterEnemySpawn | null {
  if (!isPlainRecord(raw)) return null
  const enemyId = typeof raw.id === 'string' ? ENEMY_ID_LOOKUP.get(raw.id) : undefined
  if (!enemyId) return null
  if (!isFiniteNum(raw.col) || !isFiniteNum(raw.row)) return null
  const col = clampInt(raw.col, 0, 7)
  const row = clampInt(raw.row, 0, 5)
  return {
    id: enemyId,
    col,
    row,
    ...(isFiniteNum(raw.levelScale) && raw.levelScale > 0 ? { levelScale: raw.levelScale } : {}),
    ...(typeof raw.name === 'string' && raw.name.length > 0 ? { name: raw.name } : {})
  }
}

/**
 * Sanitizes persisted `worldEvents` from a save payload. Legacy saves missing the field
 * cleanly return `[]`. Corrupted or expired entries are skipped safely.
 */
export function sanitizeWorldMapEvents(raw: unknown): WorldMapEvent[] {
  if (!Array.isArray(raw)) return []
  const out: WorldMapEvent[] = []
  const seenIds = new Set<string>()

  for (let i = 0; i < raw.length; i++) {
    if (out.length >= MAX_WORLD_EVENTS) break
    const item = raw[i]
    if (!isPlainRecord(item)) continue
    if (typeof item.id !== 'string' || item.id.length === 0 || seenIds.has(item.id)) continue
    if (!isWorldEventKind(item.kind)) continue
    if (typeof item.fromStageId !== 'string' || !CHAPTER_BY_ID[item.fromStageId]) continue
    if (typeof item.toStageId !== 'string' || !CHAPTER_BY_ID[item.toStageId]) continue
    if (!isFiniteNum(item.expiresAfterBattles) || Math.floor(item.expiresAfterBattles) <= 0) continue

    const from = CHAPTER_BY_ID[item.fromStageId]
    const to = CHAPTER_BY_ID[item.toStageId]
    const region: WorldRegionId = (typeof item.region === 'string' ? REGION_LOOKUP.get(item.region) : undefined) ?? from.region
    const biome: BiomeId = (typeof item.biome === 'string' ? BIOME_LOOKUP.get(item.biome) : undefined) ?? from.biome
    const difficulty = isFiniteNum(item.difficulty) ? toDifficulty(item.difficulty) : from.difficulty
    const mapX = isFiniteNum(item.mapX) ? item.mapX : (from.mapX + to.mapX) * 0.5
    const mapY = isFiniteNum(item.mapY) ? item.mapY : (from.mapY + to.mapY) * 0.5
    const expiresAfterBattles = clampInt(item.expiresAfterBattles, 1, 10)
    const maxBattles = isFiniteNum(item.maxBattles)
      ? clampInt(Math.max(item.maxBattles, expiresAfterBattles), 1, 10)
      : expiresAfterBattles

    let offers: WorldEventMerchantOffer[] | undefined
    if (item.kind === 'wandering_merchant') {
      if (!Array.isArray(item.offers)) continue
      const validOffers: WorldEventMerchantOffer[] = []
      for (let j = 0; j < item.offers.length; j++) {
        const parsed = sanitizeOffer(item.offers[j])
        if (parsed) validOffers.push(parsed)
      }
      if (validOffers.every(o => o.purchased)) continue
      offers = validOffers
    }

    let enemies: ChapterEnemySpawn[] | undefined
    if (item.kind !== 'wandering_merchant') {
      const validEnemies: ChapterEnemySpawn[] = []
      if (Array.isArray(item.enemies)) {
        for (let j = 0; j < item.enemies.length; j++) {
          const parsed = sanitizeEnemySpawn(item.enemies[j])
          if (parsed) validEnemies.push(parsed)
        }
      }
      enemies = validEnemies.length > 0
        ? validEnemies
        : item.kind === 'goblin_ambush'
          ? buildAmbushEnemies(difficulty, biome)
          : buildGauntletEnemies(difficulty, biome)
    }

    const rewardEquipRarity: Rarity | undefined =
      typeof item.rewardEquipRarity === 'string' ? RARITY_LOOKUP.get(item.rewardEquipRarity) : undefined

    seenIds.add(item.id)
    out.push({
      id: item.id,
      kind: item.kind,
      title: typeof item.title === 'string' && item.title.length > 0 ? item.title : 'Road Event',
      subtitle: typeof item.subtitle === 'string' ? item.subtitle : WORLD_REGIONS[region].name,
      fromStageId: from.id,
      toStageId: to.id,
      region,
      biome,
      difficulty,
      recommendedPower: isFiniteNum(item.recommendedPower) && item.recommendedPower > 0
        ? Math.floor(item.recommendedPower)
        : from.recommendedPower,
      mapX,
      mapY,
      expiresAfterBattles,
      maxBattles,
      rewardGold: isFiniteNum(item.rewardGold) && item.rewardGold >= 0 ? Math.floor(item.rewardGold) : 0,
      rewardDust: isFiniteNum(item.rewardDust) && item.rewardDust >= 0 ? Math.floor(item.rewardDust) : 0,
      rewardShards: isFiniteNum(item.rewardShards) && item.rewardShards >= 0 ? Math.floor(item.rewardShards) : 0,
      ...(rewardEquipRarity !== undefined ? { rewardEquipRarity } : {}),
      ...(offers !== undefined ? { offers } : {}),
      ...(enemies !== undefined ? { enemies } : {}),
      spawnedAtBattlesWon: isFiniteNum(item.spawnedAtBattlesWon) && item.spawnedAtBattlesWon >= 0
        ? Math.floor(item.spawnedAtBattlesWon)
        : 0
    })
  }

  return out
}
