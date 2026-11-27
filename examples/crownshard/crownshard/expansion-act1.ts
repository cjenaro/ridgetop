import { nextRandom } from 'ridgetop'
import { appendCombatLog } from './combat-log.ts'
import { CHAPTER_BY_ID, ENEMY_SPECS, EQUIPMENT_LIST } from './data.ts'
import { selectProtectedEquipment } from './forge.ts'
import { applyDisplacement } from './forced-movement.ts'
import { normalizeHeroLevel } from './leveling.ts'
import { computeScaledEnemyStats } from './mutators.ts'
import {
  cellHeightLevel,
  facingToYaw,
  gridToWorld,
  isUnitDowned,
  terrainElevation,
  terrainWalkable
} from './types.ts'
import type {
  BattleState,
  BattleUnit,
  CampaignState,
  EnemyArchetypeId,
  GameState,
  GridCoord,
  OakhavenExchangeDealId,
  OakhavenExchangeState,
  OwnedEquipCard,
  StageMechanicState
} from './types.ts'

export const OAKHAVEN_STAGE_ID = 'oakhaven_market'
export const GALEWIND_STAGE_ID = 'galewind_windmill'
export const EMERALD_DELTA_STAGE_ID = 'emerald_delta'
export const SOLIS_MONASTERY_STAGE_ID = 'sunken_monastery'

export const OAKHAVEN_PATRON_DISCOUNT_PCT = 20

export const GALEWIND_GUST_PERIOD = 2
export const GALEWIND_MIN_HEIGHT = 2
export const GALEWIND_PUSH_DIR: readonly [number, number] = [-1, 0]

export const EMERALD_TIDE_PERIOD = 2
export const EMERALD_TIDE_SPLASH_DAMAGE = 6
export const EMERALD_TIDE_FORD_TILES: readonly GridCoord[] = [
  { col: 2, row: 1 },
  { col: 3, row: 1 },
  { col: 6, row: 1 },
  { col: 2, row: 5 },
  { col: 3, row: 5 },
  { col: 6, row: 5 }
]

export const MONASTERY_REINFORCEMENT_ROUNDS: readonly number[] = [2, 4, 5]
export const MONASTERY_MAX_ALIVE_ENEMIES = 10

export interface OakhavenExchangeDealSpec {
  readonly id: OakhavenExchangeDealId
  readonly name: string
  readonly shortLabel: string
  readonly desc: string
  readonly baseCost: number
  readonly dustReward: number
  readonly shardsReward: number
  readonly grantsRelic: boolean
  readonly accentHex: string
}

export const OAKHAVEN_EXCHANGE_DEALS: readonly OakhavenExchangeDealSpec[] = [
  {
    id: 'dust_satchel',
    name: 'Arcane Dust Satchel',
    shortLabel: '+45 Dust',
    desc: 'Trade Gold for +45 Arcane Dust to forge gear at Camp.',
    baseCost: 95,
    dustReward: 45,
    shardsReward: 0,
    grantsRelic: false,
    accentHex: '#7ad4ff'
  },
  {
    id: 'hero_shard_crate',
    name: 'Vanguard Shard Crate',
    shortLabel: '+60 Shards',
    desc: 'Trade Gold for +60 Hero Shards toward recruiting heroes.',
    baseCost: 120,
    dustReward: 0,
    shardsReward: 60,
    grantsRelic: false,
    accentHex: '#c88cff'
  },
  {
    id: 'relic_caravan_bundle',
    name: 'Relic Caravan Cache',
    shortLabel: 'Relic Pack',
    desc: 'Purchase an Uncommon+ duplicate-protected Relic card.',
    baseCost: 175,
    dustReward: 0,
    shardsReward: 0,
    grantsRelic: true,
    accentHex: '#ffcb57'
  }
]

export interface OakhavenExchangeOffer {
  readonly deal: OakhavenExchangeDealSpec
  readonly cost: number
  readonly baseCost: number
  readonly discounted: boolean
  readonly unlocked: boolean
  readonly purchasedThisCycle: boolean
  readonly stockRemaining: number
  readonly affordable: boolean
  readonly canBuy: boolean
}

export interface OakhavenPurchaseResult {
  readonly ok: boolean
  readonly dealId: OakhavenExchangeDealId
  readonly goldSpent: number
  readonly dustGained: number
  readonly shardsGained: number
  readonly equipCard: OwnedEquipCard | null
  readonly reason: string | null
}

export interface GalewindGustResult {
  readonly triggered: boolean
  readonly pushedCount: number
  readonly affectedUids: readonly string[]
}

export interface EmeraldTideResult {
  readonly toggled: boolean
  readonly tideHigh: boolean
  readonly floodedCount: number
  readonly shiftedUids: readonly string[]
}

export interface MonasteryReinforcementSpawnSpec {
  readonly enemyId: EnemyArchetypeId
  readonly name: string
  readonly levelScale: number
  readonly preferredGate: GridCoord
}

export interface MonasteryWaveSpec {
  readonly round: number
  readonly waveNumber: number
  readonly label: string
  readonly spawns: readonly MonasteryReinforcementSpawnSpec[]
}

export interface MonasteryWaveResult {
  readonly triggered: boolean
  readonly waveNumber: number
  readonly round: number
  readonly spawnedUids: readonly string[]
}

export interface Act1RoundBoundarySummary {
  readonly stageId: string
  readonly galewind?: GalewindGustResult
  readonly tide?: EmeraldTideResult
  readonly monastery?: MonasteryWaveResult
}

export interface Act1StageMechanicHudStatus {
  readonly stageId: string
  readonly label: string
  readonly detail: string
  readonly urgent: boolean
  readonly accentHex: string
}

export const MONASTERY_WAVE_SPECS: readonly MonasteryWaveSpec[] = [
  {
    round: 2,
    waveNumber: 2,
    label: 'Cloister Raiders',
    spawns: [
      { enemyId: 'goblin', name: 'Abbey Raider', levelScale: 1.05, preferredGate: { col: 0, row: 2 } },
      { enemyId: 'bone_archer', name: 'Zealot Marksman', levelScale: 1.05, preferredGate: { col: 8, row: 2 } }
    ]
  },
  {
    round: 4,
    waveNumber: 3,
    label: 'Sanctum Breachers',
    spawns: [
      { enemyId: 'river_troll', name: 'Fen Crusher', levelScale: 1.05, preferredGate: { col: 0, row: 4 } },
      { enemyId: 'bog_shaman', name: 'Eclipse Cantor', levelScale: 1.05, preferredGate: { col: 8, row: 4 } }
    ]
  },
  {
    round: 5,
    waveNumber: 4,
    label: 'Final Zealots',
    spawns: [
      { enemyId: 'crypt_knight', name: 'Sanctum Templar', levelScale: 1.08, preferredGate: { col: 4, row: 0 } },
      { enemyId: 'goblin', name: 'Abbey Zealot', levelScale: 1.1, preferredGate: { col: 1, row: 5 } }
    ]
  }
]

const MONASTERY_FALLBACK_GATES: readonly GridCoord[] = [
  { col: 0, row: 2 },
  { col: 8, row: 2 },
  { col: 0, row: 4 },
  { col: 8, row: 4 },
  { col: 4, row: 0 },
  { col: 1, row: 5 },
  { col: 7, row: 1 },
  { col: 0, row: 3 },
  { col: 8, row: 3 },
  { col: 1, row: 0 },
  { col: 7, row: 6 }
]

const VALID_OAKHAVEN_DEAL_IDS: ReadonlySet<string> = new Set(
  OAKHAVEN_EXCHANGE_DEALS.map(d => d.id)
)

function pushStageFloat(battle: BattleState, x: number, y: number, z: number, text: string, color: string): void {
  battle.floatingNumbers.push({
    id: battle.nextFloatId++,
    x,
    y: y + 1.55,
    z,
    text,
    color,
    age: 0,
    duration: 1.15
  })
}

function isDealId(raw: unknown): raw is OakhavenExchangeDealId {
  return typeof raw === 'string' && VALID_OAKHAVEN_DEAL_IDS.has(raw)
}

export function getOakhavenExchangeDeal(dealId: OakhavenExchangeDealId): OakhavenExchangeDealSpec | undefined {
  return OAKHAVEN_EXCHANGE_DEALS.find(d => d.id === dealId)
}

/** Current rotating trade cycle at Oakhaven City (refreshes stock whenever the player wins a battle). */
export function getOakhavenExchangeCycle(campaign: Pick<CampaignState, 'battlesWon'>): number {
  const won = typeof campaign.battlesWon === 'number' && Number.isFinite(campaign.battlesWon)
    ? Math.max(0, Math.floor(campaign.battlesWon))
    : 0
  return won
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Normalize persisted Oakhaven Exchange purchase tracking safely for save/load. */
export function normalizeOakhavenExchange(raw: unknown, fallbackCycle = 0): OakhavenExchangeState {
  const safeFallback = Math.max(0, Math.floor(fallbackCycle || 0))
  if (!isPlainRecord(raw)) {
    return { cycle: safeFallback, boughtIds: [] }
  }
  const rawCycle = raw.cycle
  const cycle = typeof rawCycle === 'number' && Number.isFinite(rawCycle) && rawCycle >= 0
    ? Math.floor(rawCycle)
    : safeFallback
  const boughtIds: string[] = []
  const rawBought = raw.boughtIds
  if (Array.isArray(rawBought)) {
    for (const item of rawBought) {
      if (isDealId(item) && !boughtIds.includes(item)) {
        boughtIds.push(item)
      }
    }
  }
  return { cycle, boughtIds }
}

/** Oakhaven Exchange opens once Oakhaven City is unlocked on the World Map (after Border Watch) or cleared. */
export function isOakhavenExchangeUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds'>
): boolean {
  if (campaign.clearedStageIds.includes(OAKHAVEN_STAGE_ID)) return true
  const stage = CHAPTER_BY_ID[OAKHAVEN_STAGE_ID]
  if (!stage || stage.comingSoon) return false
  if (stage.requires.length === 0) return true
  if (stage.unlockMode === 'any') {
    return stage.requires.some(req => campaign.clearedStageIds.includes(req))
  }
  return stage.requires.every(req => campaign.clearedStageIds.includes(req))
}

/** Clearing Oakhaven City grants a permanent 20% Guild Patron discount on all Oakhaven Exchange deals. */
export function hasOakhavenPatronDiscount(
  campaign: Pick<CampaignState, 'clearedStageIds'>
): boolean {
  return campaign.clearedStageIds.includes(OAKHAVEN_STAGE_ID)
}

/** Effective Gold price of a Guild Exchange deal (20% off once Oakhaven City is cleared). */
export function getOakhavenDealCost(
  campaign: Pick<CampaignState, 'clearedStageIds'>,
  dealId: OakhavenExchangeDealId
): number {
  const deal = getOakhavenExchangeDeal(dealId)
  if (!deal) return 0
  if (!hasOakhavenPatronDiscount(campaign)) return deal.baseCost
  return Math.max(1, Math.round(deal.baseCost * (100 - OAKHAVEN_PATRON_DISCOUNT_PCT) / 100))
}

function getBoughtIdsForCurrentCycle(
  campaign: Pick<CampaignState, 'battlesWon' | 'oakhavenExchange'>
): readonly string[] {
  const cycle = getOakhavenExchangeCycle(campaign)
  if (!campaign.oakhavenExchange || campaign.oakhavenExchange.cycle !== cycle) {
    return []
  }
  return campaign.oakhavenExchange.boughtIds
}

/** Inspect a single Oakhaven Guild Exchange deal's live price, stock, and eligibility. */
export function getOakhavenExchangeOffer(
  campaign: Pick<CampaignState, 'gold' | 'battlesWon' | 'clearedStageIds' | 'oakhavenExchange'>,
  dealId: OakhavenExchangeDealId
): OakhavenExchangeOffer | null {
  const deal = getOakhavenExchangeDeal(dealId)
  if (!deal) return null
  const unlocked = isOakhavenExchangeUnlocked(campaign)
  const discounted = hasOakhavenPatronDiscount(campaign)
  const cost = getOakhavenDealCost(campaign, dealId)
  const bought = getBoughtIdsForCurrentCycle(campaign).includes(dealId)
  const stockRemaining = bought ? 0 : 1
  const affordable = campaign.gold >= cost
  const canBuy = unlocked && !bought && affordable
  return {
    deal,
    cost,
    baseCost: deal.baseCost,
    discounted,
    unlocked,
    purchasedThisCycle: bought,
    stockRemaining,
    affordable,
    canBuy
  }
}

/** List all Oakhaven Guild Exchange supply deals with live pricing & stock for the World Map inspector. */
export function getOakhavenExchangeOffers(
  campaign: Pick<CampaignState, 'gold' | 'battlesWon' | 'clearedStageIds' | 'oakhavenExchange'>
): OakhavenExchangeOffer[] {
  const out: OakhavenExchangeOffer[] = []
  for (const deal of OAKHAVEN_EXCHANGE_DEALS) {
    const offer = getOakhavenExchangeOffer(campaign, deal.id)
    if (offer) out.push(offer)
  }
  return out
}

/** Returns true if the player can currently purchase `dealId` at the Oakhaven Guild Exchange. */
export function canBuyOakhavenDeal(
  campaign: Pick<CampaignState, 'gold' | 'battlesWon' | 'clearedStageIds' | 'oakhavenExchange'>,
  dealId: OakhavenExchangeDealId
): boolean {
  const offer = getOakhavenExchangeOffer(campaign, dealId)
  return Boolean(offer && offer.canBuy)
}

/** Purchase a supply deal from the Oakhaven Guild Exchange using Gold. */
export function buyOakhavenDeal(
  state: GameState,
  dealId: OakhavenExchangeDealId
): OakhavenPurchaseResult {
  const campaign = state.campaign
  const deal = getOakhavenExchangeDeal(dealId)
  if (!deal) {
    return { ok: false, dealId, goldSpent: 0, dustGained: 0, shardsGained: 0, equipCard: null, reason: 'Unknown supply deal.' }
  }
  if (!isOakhavenExchangeUnlocked(campaign)) {
    return { ok: false, dealId, goldSpent: 0, dustGained: 0, shardsGained: 0, equipCard: null, reason: 'Unlock Oakhaven City first.' }
  }
  const cycle = getOakhavenExchangeCycle(campaign)
  const bought = getBoughtIdsForCurrentCycle(campaign)
  if (bought.includes(dealId)) {
    return { ok: false, dealId, goldSpent: 0, dustGained: 0, shardsGained: 0, equipCard: null, reason: 'Sold out until next battle victory.' }
  }
  const cost = getOakhavenDealCost(campaign, dealId)
  if (campaign.gold < cost) {
    return { ok: false, dealId, goldSpent: 0, dustGained: 0, shardsGained: 0, equipCard: null, reason: 'Not enough Gold.' }
  }

  campaign.gold -= cost
  let dustGained = 0
  let shardsGained = 0
  let equipCard: OwnedEquipCard | null = null

  if (deal.dustReward > 0) {
    campaign.dust = Math.max(0, Math.floor(campaign.dust || 0)) + deal.dustReward
    dustGained = deal.dustReward
  }
  if (deal.shardsReward > 0) {
    campaign.shards = Math.max(0, Math.floor(campaign.shards || 0)) + deal.shardsReward
    shardsGained = deal.shardsReward
  }
  if (deal.grantsRelic) {
    const relicPool = EQUIPMENT_LIST.filter(e => e.slot === 'relic' && e.rarity !== 'common')
    const pool = relicPool.length > 0 ? relicPool : EQUIPMENT_LIST.filter(e => e.slot === 'relic')
    const step = nextRandom(campaign.seed)
    campaign.seed = step.seed
    const spec = selectProtectedEquipment(pool, campaign, step.value)
    const uid = `eq_${campaign.nextUid}`
    campaign.nextUid += 1
    equipCard = {
      uid,
      equipId: spec.id,
      slot: spec.slot,
      locked: false
    }
    campaign.equipment.push(equipCard)
    state.sounds.push({ kind: 'pack', rarity: spec.rarity })
  } else {
    state.sounds.push({ kind: 'coin', pitch: 1.15 })
  }

  const nextBought = bought.slice()
  nextBought.push(dealId)
  campaign.oakhavenExchange = { cycle, boughtIds: nextBought }

  return {
    ok: true,
    dealId,
    goldSpent: cost,
    dustGained,
    shardsGained,
    equipCard,
    reason: null
  }
}

// =========================================================================
// STAGE MECHANIC STATE & SNAPSHOT SERIALIZATION
// =========================================================================

export function createInitialStageMechanicState(stageId: string): StageMechanicState | undefined {
  if (stageId === GALEWIND_STAGE_ID) {
    return { lastGustRound: 0 }
  }
  if (stageId === EMERALD_DELTA_STAGE_ID) {
    return { tideHigh: false }
  }
  if (stageId === SOLIS_MONASTERY_STAGE_ID) {
    return { spawnedWaves: [], nextReinforcementUid: 1 }
  }
  return undefined
}

export function cloneStageMechanicState(raw: StageMechanicState | undefined): StageMechanicState | undefined {
  if (!raw) return undefined
  const out: StageMechanicState = {}
  if (typeof raw.tideHigh === 'boolean') out.tideHigh = raw.tideHigh
  if (typeof raw.lastGustRound === 'number' && Number.isFinite(raw.lastGustRound)) {
    out.lastGustRound = Math.max(0, Math.floor(raw.lastGustRound))
  }
  if (Array.isArray(raw.spawnedWaves)) {
    out.spawnedWaves = raw.spawnedWaves
      .filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
      .map(n => Math.floor(n))
  }
  if (typeof raw.nextReinforcementUid === 'number' && Number.isFinite(raw.nextReinforcementUid)) {
    out.nextReinforcementUid = Math.max(1, Math.floor(raw.nextReinforcementUid))
  }
  return out
}

export function validateStageMechanicSnapshot(raw: unknown): StageMechanicState | undefined {
  if (!isPlainRecord(raw)) return undefined
  const out: StageMechanicState = {}
  const rawTide = raw.tideHigh
  if (typeof rawTide === 'boolean') {
    out.tideHigh = rawTide
  }
  const rawGust = raw.lastGustRound
  if (typeof rawGust === 'number' && Number.isFinite(rawGust) && rawGust >= 0) {
    out.lastGustRound = Math.floor(rawGust)
  }
  const rawWaves = raw.spawnedWaves
  if (Array.isArray(rawWaves)) {
    const waves: number[] = []
    for (const item of rawWaves) {
      if (typeof item === 'number' && Number.isFinite(item) && item > 0) {
        const w = Math.floor(item)
        if (!waves.includes(w)) waves.push(w)
      }
    }
    out.spawnedWaves = waves
  }
  const rawNext = raw.nextReinforcementUid
  if (typeof rawNext === 'number' && Number.isFinite(rawNext) && rawNext >= 1) {
    out.nextReinforcementUid = Math.floor(rawNext)
  }
  return out
}

function ensureStageMechanicState(battle: BattleState): StageMechanicState {
  if (!battle.stageMechanic) {
    battle.stageMechanic = createInitialStageMechanicState(battle.stageId) ?? {}
  }
  return battle.stageMechanic
}

// =========================================================================
// GALEWIND RIDGE: PERIODIC RIDGE GUST ON ELEVATED TILES (HEIGHT >= 2)
// =========================================================================

export function isGalewindGustImminent(
  battle: Pick<BattleState, 'stageId' | 'endlessWave' | 'objective'>
): boolean {
  if (battle.stageId !== GALEWIND_STAGE_ID || battle.endlessWave > 0) return false
  return battle.objective.roundsElapsed % GALEWIND_GUST_PERIOD === GALEWIND_GUST_PERIOD - 1
}

export function shouldTriggerGalewindGust(
  battle: Pick<BattleState, 'stageId' | 'endlessWave' | 'objective' | 'stageMechanic'>
): boolean {
  if (battle.stageId !== GALEWIND_STAGE_ID || battle.endlessWave > 0) return false
  const round = battle.objective.roundsElapsed
  if (round <= 0 || round % GALEWIND_GUST_PERIOD !== 0) return false
  const last = battle.stageMechanic?.lastGustRound ?? 0
  return round > last
}

/**
 * Trigger the Galewind Ridge gust at round boundaries (every 2 rounds):
 * pushes every alive unit on elevated ridges (heightLevel >= 2) 1 tile downwind (west)
 * through the existing forced-movement collision engine.
 */
export function applyGalewindGust(state: GameState): GalewindGustResult {
  const battle = state.battle
  if (!battle || !shouldTriggerGalewindGust(battle)) {
    return { triggered: false, pushedCount: 0, affectedUids: [] }
  }

  const mech = ensureStageMechanicState(battle)
  mech.lastGustRound = battle.objective.roundsElapsed

  // Collect all alive units standing on Height 2+ ridges
  const exposed = battle.units.filter(u => {
    if (!u.alive) return false
    const cell = battle.cells[u.row]?.[u.col]
    if (!cell) return false
    return cellHeightLevel(cell) >= GALEWIND_MIN_HEIGHT
  })

  // Sort downwind-first (lowest col first for westward push [-1, 0]) so leading units vacate tiles first
  exposed.sort((a, b) => {
    if (a.col !== b.col) return a.col - b.col
    return a.row - b.row
  })

  const affectedUids: string[] = []
  let pushedCount = 0

  for (const unit of exposed) {
    if (!unit.alive) continue
    const origin: GridCoord = {
      col: unit.col - GALEWIND_PUSH_DIR[0],
      row: unit.row - GALEWIND_PUSH_DIR[1]
    }
    const res = applyDisplacement(state, null, unit, { kind: 'knockback', distance: 1 }, origin)
    affectedUids.push(unit.uid)
    if (res.moved || res.preview.collidedWith !== 'none') {
      pushedCount += 1
      pushStageFloat(battle, unit.x, unit.y + 0.52, unit.z, 'GALEWIND!', '#9eeeff')
      state.vfx.push({ kind: 'burst', style: 'arcane', at: [unit.x, unit.y + 0.5, unit.z], radius: 0.72 })
    }
  }

  battle.bannerText = 'GALEWIND GUST!'
  battle.bannerTimer = 1.55
  battle.shake = Math.max(battle.shake, 0.24)
  state.sounds.push({ kind: 'card', pitch: 0.85 })

  if (exposed.length > 0) {
    appendCombatLog(
      battle,
      'hazard',
      `Galewind Gust sweeps Height 2+ ridges — ${pushedCount} exposed unit${pushedCount === 1 ? '' : 's'} blown west!`,
      { accentHex: '#7ad4ff' }
    )
  } else {
    appendCombatLog(
      battle,
      'hazard',
      'Galewind Gust howls across Height 2+ ridges (all units sheltered below)',
      { accentHex: '#7ad4ff' }
    )
  }

  return { triggered: true, pushedCount, affectedUids }
}

// =========================================================================
// EMERALD DELTA: RISING TIDE BRIDGE MECHANIC (TOGGLES EVERY 2 ROUNDS)
// =========================================================================

export function isEmeraldDeltaFordTile(col: number, row: number): boolean {
  for (const tile of EMERALD_TIDE_FORD_TILES) {
    if (tile.col === col && tile.row === row) return true
  }
  return false
}

/** High tide floods low-tide fords on rounds 2..3, 6..7, 10..11, etc. */
export function isEmeraldTideHighOnRound(roundsElapsed: number): boolean {
  if (roundsElapsed < EMERALD_TIDE_PERIOD) return false
  return Math.floor(roundsElapsed / EMERALD_TIDE_PERIOD) % 2 === 1
}

function isTileOccupiedByUnit(battle: BattleState, col: number, row: number, ignoreUid?: string): boolean {
  return battle.units.some(u => (u.alive || isUnitDowned(u)) && u.uid !== ignoreUid && u.col === col && u.row === row)
}

/**
 * Find the nearest dry, walkable, unoccupied shore tile to relocate a unit washed off a flooding ford.
 * Prefers non-ford walkable tiles, then falls back to any walkable unoccupied tile.
 */
export function findNearestDryShoreTile(
  battle: BattleState,
  fromCol: number,
  fromRow: number,
  ignoreUid?: string
): GridCoord | null {
  let bestDry: GridCoord | null = null
  let bestDryDist = 999
  let bestAny: GridCoord | null = null
  let bestAnyDist = 999

  for (let row = 0; row < battle.rows; row++) {
    for (let col = 0; col < battle.cols; col++) {
      const cell = battle.cells[row]?.[col]
      if (!cell || !cell.walkable || !terrainWalkable(cell.terrain)) continue
      if (isTileOccupiedByUnit(battle, col, row, ignoreUid)) continue
      const dist = Math.abs(col - fromCol) + Math.abs(row - fromRow)
      if (!isEmeraldDeltaFordTile(col, row)) {
        if (
          dist < bestDryDist ||
          (dist === bestDryDist && bestDry !== null && (col < bestDry.col || (col === bestDry.col && row < bestDry.row)))
        ) {
          bestDryDist = dist
          bestDry = { col, row }
        }
      }
      if (
        dist < bestAnyDist ||
        (dist === bestAnyDist && bestAny !== null && (col < bestAny.col || (col === bestAny.col && row < bestAny.row)))
      ) {
        bestAnyDist = dist
        bestAny = { col, row }
      }
    }
  }

  return bestDry ?? bestAny
}

/**
 * Update Emerald Delta's tidal ford tiles every 2 rounds:
 * alternates marked ford tiles between walkable `'bridge'` and surging `'water'`,
 * safely shifting any unit on a flooding ford to the nearest dry shore tile with splash + Slow.
 */
export function applyEmeraldDeltaTide(state: GameState): EmeraldTideResult {
  const battle = state.battle
  if (!battle || battle.stageId !== EMERALD_DELTA_STAGE_ID || battle.endlessWave > 0) {
    return { toggled: false, tideHigh: false, floodedCount: 0, shiftedUids: [] }
  }

  const mech = ensureStageMechanicState(battle)
  const targetHigh = isEmeraldTideHighOnRound(battle.objective.roundsElapsed)
  const currentHigh = mech.tideHigh === true

  if (targetHigh === currentHigh) {
    return { toggled: false, tideHigh: currentHigh, floodedCount: 0, shiftedUids: [] }
  }

  mech.tideHigh = targetHigh
  let floodedCount = 0

  for (const ford of EMERALD_TIDE_FORD_TILES) {
    const cell = battle.cells[ford.row]?.[ford.col]
    if (!cell) continue
    if (targetHigh) {
      cell.terrain = 'water'
      cell.walkable = false
      cell.elevation = terrainElevation('water', 0)
      floodedCount += 1
    } else {
      cell.terrain = 'bridge'
      cell.walkable = true
      cell.elevation = terrainElevation('bridge', 0)
    }
    const [tx, ty, tz] = gridToWorld(ford.col, ford.row, cell.elevation, battle.cols, battle.rows)
    state.vfx.push({ kind: 'burst', style: 'frost', at: [tx, ty + 0.25, tz], radius: 0.7 })
  }

  const shiftedUids: string[] = []
  if (targetHigh) {
    const stranded = battle.units.filter(u => (u.alive || isUnitDowned(u)) && isEmeraldDeltaFordTile(u.col, u.row))
    for (const unit of stranded) {
      const dry = findNearestDryShoreTile(battle, unit.col, unit.row, unit.uid)
      if (!dry) continue
      const fromPos: [number, number, number] = [unit.x, unit.y, unit.z]
      const shoreCell = battle.cells[dry.row][dry.col]
      const [nx, ny, nz] = gridToWorld(dry.col, dry.row, shoreCell.elevation, battle.cols, battle.rows)
      unit.col = dry.col
      unit.row = dry.row
      unit.x = nx
      unit.y = ny
      unit.z = nz
      unit.path = []
      unit.moveProgress = 0
      battle.moveUndo = null
      shiftedUids.push(unit.uid)

      state.vfx.push({
        kind: 'displace',
        uid: unit.uid,
        displacementKind: 'knockback',
        from: fromPos,
        to: [nx, ny, nz]
      })

      if (unit.alive) {
        let splash = EMERALD_TIDE_SPLASH_DAMAGE
        let absorbed = 0
        if (unit.shield > 0) {
          absorbed = Math.min(unit.shield, splash)
          unit.shield -= absorbed
          splash -= absorbed
        }
        // Safe non-lethal tide wash so relocated units land ashore drenched & slowed
        const hpLoss = splash > 0 ? Math.min(splash, Math.max(0, unit.hp - 1)) : 0
        if (hpLoss > 0) {
          unit.hp -= hpLoss
          unit.hitFlash = 0.25
        }
        unit.slowTurns = Math.max(unit.slowTurns, 1)
        const tag = hpLoss > 0 ? `TIDE -${hpLoss} · SLOW!` : absorbed > 0 ? 'TIDE BLOCKED · SLOW!' : 'TIDE WASH · SLOW!'
        pushStageFloat(battle, unit.x, unit.y + 0.45, unit.z, tag, '#6ef0ff')
        appendCombatLog(
          battle,
          'hazard',
          `Rising Tide sweeps ${unit.name} ashore to (${dry.col},${dry.row})${hpLoss > 0 ? ` (-${hpLoss} HP, Slow)` : ' (Slow)'}`,
          { accentHex: '#5ee6ff' }
        )
      }
    }
    battle.bannerText = 'HIGH TIDE — FORDS FLOODED!'
    battle.bannerTimer = 1.65
    battle.shake = Math.max(battle.shake, 0.22)
    state.sounds.push({ kind: 'magic', pitch: 0.78 })
    appendCombatLog(
      battle,
      'hazard',
      `Rising Tide surges across Emerald Delta — ${floodedCount} timber fords submerged!`,
      { accentHex: '#5ee6ff' }
    )
  } else {
    battle.bannerText = 'LOW TIDE — FORDS PASSABLE!'
    battle.bannerTimer = 1.5
    state.sounds.push({ kind: 'card', pitch: 1.05 })
    appendCombatLog(
      battle,
      'system',
      'Marsh waters recede — Emerald Delta timber fords emerge and are passable again!',
      { accentHex: '#7cf2c4' }
    )
  }

  return { toggled: true, tideHigh: targetHigh, floodedCount, shiftedUids }
}

// =========================================================================
// SOLIS MONASTERY: MULTI-WAVE ENEMY REINFORCEMENTS (ROUNDS 2, 4, 5)
// =========================================================================

export function getMonasteryPendingWaveRound(
  battle: Pick<BattleState, 'stageId' | 'endlessWave' | 'stageMechanic'>
): number | null {
  if (battle.stageId !== SOLIS_MONASTERY_STAGE_ID || battle.endlessWave > 0) return null
  const spawned = battle.stageMechanic?.spawnedWaves ?? []
  for (const r of MONASTERY_REINFORCEMENT_ROUNDS) {
    if (!spawned.includes(r)) return r
  }
  return null
}

function findOpenMonasterySpawnTile(battle: BattleState, preferred: GridCoord): GridCoord | null {
  const protect = battle.objective.protectTile
  const isCandidateValid = (col: number, row: number): boolean => {
    const cell = battle.cells[row]?.[col]
    if (!cell || !cell.walkable || !terrainWalkable(cell.terrain)) return false
    if (protect && protect.col === col && protect.row === row) return false
    if (isTileOccupiedByUnit(battle, col, row)) return false
    return true
  }

  if (isCandidateValid(preferred.col, preferred.row)) {
    return preferred
  }
  for (const gate of MONASTERY_FALLBACK_GATES) {
    if (isCandidateValid(gate.col, gate.row)) return gate
  }
  // Last-resort scan for any open walkable perimeter tile
  for (let row = 0; row < battle.rows; row++) {
    for (let col = 0; col < battle.cols; col++) {
      if (row === 0 || row === battle.rows - 1 || col === 0 || col === battle.cols - 1) {
        if (isCandidateValid(col, row)) return { col, row }
      }
    }
  }
  return null
}

/**
 * Spawn Solis Monastery reinforcement waves at rounds 2, 4, and 5 (once per wave, persisted across saves,
 * capped at MONASTERY_MAX_ALIVE_ENEMIES alive enemies).
 */
export function spawnMonasteryReinforcements(state: GameState): MonasteryWaveResult {
  const battle = state.battle
  if (!battle || battle.stageId !== SOLIS_MONASTERY_STAGE_ID || battle.endlessWave > 0) {
    return { triggered: false, waveNumber: 0, round: 0, spawnedUids: [] }
  }

  const round = battle.objective.roundsElapsed
  const waveSpec = MONASTERY_WAVE_SPECS.find(w => w.round === round)
  if (!waveSpec) {
    return { triggered: false, waveNumber: 0, round, spawnedUids: [] }
  }

  const mech = ensureStageMechanicState(battle)
  if (!mech.spawnedWaves) mech.spawnedWaves = []
  if (mech.spawnedWaves.includes(round)) {
    return { triggered: false, waveNumber: waveSpec.waveNumber, round, spawnedUids: [] }
  }
  mech.spawnedWaves.push(round)

  let aliveEnemies = battle.units.filter(u => u.alive && u.team === 'enemy').length
  let nextId = Math.max(1, Math.floor(mech.nextReinforcementUid ?? 1))
  const spawnedUids: string[] = []
  const spawnedNames: string[] = []

  for (const sp of waveSpec.spawns) {
    if (aliveEnemies >= MONASTERY_MAX_ALIVE_ENEMIES) break
    const tile = findOpenMonasterySpawnTile(battle, sp.preferredGate)
    if (!tile) break

    const spec = ENEMY_SPECS[sp.enemyId]
    const scaled = computeScaledEnemyStats(
      {
        maxHp: Math.round(spec.maxHp * sp.levelScale),
        atk: Math.round(spec.atk * sp.levelScale),
        def: Math.round(spec.def * (1 + (sp.levelScale - 1) * 0.5)),
        speed: spec.speed,
        baseShield: spec.isBoss ? 25 : 0
      },
      battle.difficultyTier,
      battle.mutators
    )
    const cell = battle.cells[tile.row][tile.col]
    const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
    const facing = tile.col <= Math.floor(battle.cols / 2) ? 'e' : 'w'
    const uid = `reinf_w${waveSpec.waveNumber}_${nextId}_${sp.enemyId}`
    nextId += 1

    const unit: BattleUnit = {
      uid,
      team: 'enemy',
      name: sp.name,
      enemyId: sp.enemyId,
      stars: spec.isBoss ? 3 : 1,
      level: normalizeHeroLevel(Math.round(battle.difficulty * 2 - 1 + (spec.isBoss ? 2 : 0))),
      isBoss: Boolean(spec.isBoss),
      col: tile.col,
      row: tile.row,
      x: wx,
      y: wy,
      z: wz,
      yaw: facingToYaw(facing),
      facing,
      path: [],
      moveProgress: 0,
      hp: scaled.maxHp,
      maxHp: scaled.maxHp,
      shield: scaled.shield,
      atk: scaled.atk,
      def: scaled.def,
      speed: scaled.speed,
      ct: Math.min(80, scaled.speed * 3),
      move: spec.move,
      jump: spec.jump,
      range: spec.range,
      crit: 0.08,
      lifesteal: 0,
      moved: false,
      acted: false,
      alive: true,
      downed: false,
      koCountdown: 0,
      burnTurns: 0,
      slowTurns: 0,
      stunTurns: 0,
      empowerTurns: 0,
      tauntTurns: 0,
      hasteTurns: 0,
      poisonStacks: 0,
      cooldowns: [0, 0, 0],
      animState: 'idle',
      animTimer: 0,
      hitFlash: 0,
      lungeX: 0,
      lungeZ: 0
    }
    battle.units.push(unit)
    aliveEnemies += 1
    spawnedUids.push(uid)
    spawnedNames.push(sp.name)

    state.vfx.push({ kind: 'burst', style: 'shadow', at: [wx, wy + 0.5, wz], radius: 0.95 })
    pushStageFloat(battle, wx, wy + 0.5, wz, 'REINFORCEMENT!', '#ff96a8')
  }

  mech.nextReinforcementUid = nextId

  if (spawnedUids.length > 0) {
    battle.bannerText = `WAVE ${waveSpec.waveNumber} — ${waveSpec.label.toUpperCase()}!`
    battle.bannerTimer = 1.75
    battle.shake = Math.max(battle.shake, 0.24)
    state.sounds.push({ kind: 'turn', team: 'enemy' })
    appendCombatLog(
      battle,
      'system',
      `Solis Monastery Wave ${waveSpec.waveNumber} (${waveSpec.label}): ${spawnedNames.join(' & ')} breach the cloisters!`,
      { accentHex: '#ff8a9b' }
    )
  }

  return { triggered: true, waveNumber: waveSpec.waveNumber, round, spawnedUids }
}

// =========================================================================
// UNIFIED ROUND-BOUNDARY DISPATCH & HUD CALLOUT
// =========================================================================

/** Execute any active Act I / II expansion stage mechanic at a battle round boundary. */
export function applyAct1StageRoundBoundary(state: GameState): Act1RoundBoundarySummary | null {
  const battle = state.battle
  if (!battle || battle.phase === 'victory' || battle.phase === 'defeat' || battle.endlessWave > 0) {
    return null
  }
  if (battle.stageId === GALEWIND_STAGE_ID) {
    return { stageId: battle.stageId, galewind: applyGalewindGust(state) }
  }
  if (battle.stageId === EMERALD_DELTA_STAGE_ID) {
    return { stageId: battle.stageId, tide: applyEmeraldDeltaTide(state) }
  }
  if (battle.stageId === SOLIS_MONASTERY_STAGE_ID) {
    return { stageId: battle.stageId, monastery: spawnMonasteryReinforcements(state) }
  }
  return null
}

/** Concise HUD status chip for active Solis Vale & Silverfen stage mechanics. */
export function getAct1StageMechanicStatus(
  battle: Pick<BattleState, 'stageId' | 'endlessWave' | 'objective' | 'stageMechanic'>
): Act1StageMechanicHudStatus | null {
  if (battle.endlessWave > 0) return null

  if (battle.stageId === GALEWIND_STAGE_ID) {
    const imminent = isGalewindGustImminent(battle)
    return {
      stageId: battle.stageId,
      label: imminent ? 'GALEWIND NEXT ROUND' : 'GALEWIND RIDGE',
      detail: imminent
        ? 'Height 2+ units pushed 1 tile west!'
        : 'Gust sweeps Height 2+ every 2 rounds',
      urgent: imminent,
      accentHex: imminent ? '#7ad4ff' : '#a9d6f5'
    }
  }

  if (battle.stageId === EMERALD_DELTA_STAGE_ID) {
    const high = battle.stageMechanic?.tideHigh === true
    const turnsUntilFlip = EMERALD_TIDE_PERIOD - (battle.objective.roundsElapsed % EMERALD_TIDE_PERIOD)
    const urgent = turnsUntilFlip === 1
    return {
      stageId: battle.stageId,
      label: high ? 'HIGH TIDE · FORDS FLOODED' : 'LOW TIDE · FORDS OPEN',
      detail: high
        ? (urgent ? 'Waters recede next round' : `Recedes in ${turnsUntilFlip} rounds`)
        : (urgent ? 'Fords flood next round!' : `Rises in ${turnsUntilFlip} rounds`),
      urgent,
      accentHex: high ? '#5ee6ff' : '#7cf2c4'
    }
  }

  if (battle.stageId === SOLIS_MONASTERY_STAGE_ID) {
    const nextWaveRound = getMonasteryPendingWaveRound(battle)
    if (nextWaveRound === null) {
      return {
        stageId: battle.stageId,
        label: 'FINAL WAVE ENGAGED',
        detail: 'Hold the Relic Altar until Round 6',
        urgent: false,
        accentHex: '#ffcb57'
      }
    }
    const left = Math.max(0, nextWaveRound - battle.objective.roundsElapsed)
    return {
      stageId: battle.stageId,
      label: left <= 1 ? `REINFORCEMENTS R${nextWaveRound}!` : `NEXT WAVE · ROUND ${nextWaveRound}`,
      detail: left <= 1 ? 'Zealots breach the outer gates next round!' : `Wave arrives in ${left} rounds`,
      urgent: left <= 1,
      accentHex: left <= 1 ? '#ff8a9b' : '#f2c179'
    }
  }

  return null
}
