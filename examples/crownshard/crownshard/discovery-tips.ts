import { cellHeightLevel, isUnitDowned, terrainWalkable } from './types.ts'
import type {
  BattleState,
  BattleUnit,
  CampaignState,
  CombatForecast,
  DiscoveryTipId,
  GameState,
  GridCoord,
  PathOpportunityPreview,
  TileTerrain
} from './types.ts'
import { computeZocPerimeterTiles, getOpposingZocSentinelsAt } from './zoc.ts'

/**
 * First-Time Discovery Tips — pure simulation catalog & trigger engine.
 * Zero browser globals so it compiles cleanly to Godot GDScript and Node.
 *
 * Rules:
 * - Each core mechanic / terrain tip fires at most once per campaign, tracked in `campaign.seenTips`.
 * - At most 1 tip is active (`battle.activeTipId`) at a time; extra event triggers queue in `battle.tipQueue`.
 * - Players can dismiss the active tip (`dismissDiscoveryTip`) or disable all tips (`skipAllDiscoveryTips`).
 */

export type DiscoveryTipIcon =
  | 'flag'
  | 'sword'
  | 'up'
  | 'crit'
  | 'sparkle'
  | 'bolt'
  | 'shield'
  | 'cards'
  | 'star'
  | 'heart'
  | 'target'

export type DiscoveryTipCategory = 'basics' | 'tactics' | 'terrain' | 'combat' | 'mission'

export interface DiscoveryTipSpec {
  readonly id: DiscoveryTipId
  readonly title: string
  readonly body: string
  readonly category: DiscoveryTipCategory
  readonly icon: DiscoveryTipIcon
  readonly accentHex: string
  readonly hotkeyHint?: string
}

export interface DiscoveryTipTriggerContext {
  readonly hoveredCell?: GridCoord | null
  readonly forecast?: CombatForecast | null
  readonly pathOa?: PathOpportunityPreview | null
  readonly hoveredTerrain?: TileTerrain | null
}

export const DISCOVERY_TIPS: readonly DiscoveryTipSpec[] = [
  {
    id: 'deploy',
    title: 'Squad Deployment',
    body: 'Click a hero and any blue tile to reposition or swap. Press F to rotate facing before starting.',
    category: 'basics',
    icon: 'flag',
    accentHex: '#5eeeff',
    hotkeyHint: 'F Rotate · Space Start'
  },
  {
    id: 'move_attack',
    title: 'Move, Strike & Wait-to-Face',
    body: 'Click blue tiles to move or foes to Move+Strike. End early with Wait (Space) to save CT and pick facing.',
    category: 'basics',
    icon: 'sword',
    accentHex: '#ffd24d',
    hotkeyHint: '1-4 Skills · Space Wait'
  },
  {
    id: 'high_ground',
    title: 'High Ground Advantage',
    body: 'Elevated ridges boost attack damage up to +35% and extend ranged reach. Claim stairs and hills early.',
    category: 'terrain',
    icon: 'up',
    accentHex: '#66e6a3'
  },
  {
    id: 'facing_backstab',
    title: 'Flank & Backstab Arcs',
    body: 'Strike from the side (+15% Flank) or rear (+30% Backstab) for bonus damage and to bypass melee counters.',
    category: 'tactics',
    icon: 'crit',
    accentHex: '#ff9a44'
  },
  {
    id: 'shrine',
    title: 'Sanctuary Shrines',
    body: 'Hold a glowing Sun Shrine to heal +14 HP at turn start, gain +1 DEF cover, and sustain AP for tactic turns.',
    category: 'terrain',
    icon: 'sparkle',
    accentHex: '#7ce8ff'
  },
  {
    id: 'hazards',
    title: 'Interactive Hazards',
    body: 'Lava Geysers erupt with Burn, Ice adds +1 glide, Cursed Altars trade HP for Empower+AP, Tall Grass shields ranged hits, and Barricades break.',
    category: 'terrain',
    icon: 'bolt',
    accentHex: '#ff7052'
  },
  {
    id: 'zoc',
    title: 'Zone of Control',
    body: 'Leaving a tile beside an enemy melee sentinel triggers a 75% Opportunity Attack. Rogues slip past safely.',
    category: 'tactics',
    icon: 'shield',
    accentHex: '#ff8c2b'
  },
  {
    id: 'tactic_cards',
    title: 'Tactic Cards & AP',
    body: 'Spend blue AP crystals to cast Tactic Cards from your hand without using a hero action. AP refills each round.',
    category: 'basics',
    icon: 'cards',
    accentHex: '#63d2ff'
  },
  {
    id: 'status_combos',
    title: 'Elemental Status Combos',
    body: 'Chain elements & statuses: Fire+Slow triggers Shatter, Frost on Wet/Ice Freezes, Fire+Grass spreads Wildfire, Fire+Poison triggers Combust.',
    category: 'combat',
    icon: 'star',
    accentHex: '#c884ff'
  },
  {
    id: 'ko_revive',
    title: '3-Turn Downed Window',
    body: 'Fallen heroes stay downed for 3 turns before KO. Use a Cleric revive skill or healing tactic to bring them back!',
    category: 'combat',
    icon: 'heart',
    accentHex: '#ff6b8b'
  },
  {
    id: 'objective_special',
    title: 'Special Mission Objective',
    body: 'Watch the top-left objective badge: Assassinate targets the boss, Defend guards a shrine/turns, and Seize claims goals or chests.',
    category: 'mission',
    icon: 'target',
    accentHex: '#ffd24d'
  }
]

export const DISCOVERY_TIP_IDS: readonly DiscoveryTipId[] = DISCOVERY_TIPS.map(t => t.id)

export const DISCOVERY_TIP_BY_ID: Readonly<Record<DiscoveryTipId, DiscoveryTipSpec>> = {
  deploy: DISCOVERY_TIPS[0],
  move_attack: DISCOVERY_TIPS[1],
  high_ground: DISCOVERY_TIPS[2],
  facing_backstab: DISCOVERY_TIPS[3],
  shrine: DISCOVERY_TIPS[4],
  hazards: DISCOVERY_TIPS[5],
  zoc: DISCOVERY_TIPS[6],
  tactic_cards: DISCOVERY_TIPS[7],
  status_combos: DISCOVERY_TIPS[8],
  ko_revive: DISCOVERY_TIPS[9],
  objective_special: DISCOVERY_TIPS[10]
}

const VALID_TIP_SET: ReadonlySet<string> = new Set<string>(DISCOVERY_TIP_IDS)

const HAZARD_TERRAINS: ReadonlySet<TileTerrain> = new Set<TileTerrain>([
  'lava_geyser',
  'ice',
  'cursed_altar',
  'tall_grass',
  'barricade'
])

/** True when `id` is a known DiscoveryTipId. */
export function isDiscoveryTipId(id: string): id is DiscoveryTipId {
  return VALID_TIP_SET.has(id)
}

/** Normalize raw `seenTips` array from saves: filter to valid tip IDs and deduplicate preserving order. */
export function normalizeSeenTips(raw: unknown): DiscoveryTipId[] {
  if (!Array.isArray(raw)) return []
  const out: DiscoveryTipId[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (!isDiscoveryTipId(item)) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** Look up a tip spec by ID (returns null when unset or unknown). */
export function getDiscoveryTipSpec(id: DiscoveryTipId | string | null | undefined): DiscoveryTipSpec | null {
  if (!id || !isDiscoveryTipId(id)) return null
  return DISCOVERY_TIP_BY_ID[id]
}

/** True when `tipId` has already been seen/dismissed in this campaign. */
export function hasSeenDiscoveryTip(
  campaign: Pick<CampaignState, 'seenTips'>,
  tipId: DiscoveryTipId
): boolean {
  return Array.isArray(campaign.seenTips) && campaign.seenTips.includes(tipId)
}

/** True when discovery tips are enabled (not skipped/disabled by the player). */
export function areDiscoveryTipsEnabled(campaign: Pick<CampaignState, 'tipsDisabled'>): boolean {
  return campaign.tipsDisabled !== true
}

/** Return the currently displayed discovery tip spec, or null if none is active or tips are disabled. */
export function getActiveDiscoveryTip(state: Pick<GameState, 'campaign' | 'battle'>): DiscoveryTipSpec | null {
  if (!areDiscoveryTipsEnabled(state.campaign)) return null
  const battle = state.battle
  if (!battle || !battle.activeTipId) return null
  if (battle.phase === 'victory' || battle.phase === 'defeat') return null
  if (hasSeenDiscoveryTip(state.campaign, battle.activeTipId)) return null
  return getDiscoveryTipSpec(battle.activeTipId)
}

function ensureTipRuntime(battle: BattleState): void {
  if (battle.activeTipId === undefined) battle.activeTipId = null
  if (!Array.isArray(battle.tipQueue)) battle.tipQueue = []
}

function recordSeenTip(campaign: CampaignState, tipId: DiscoveryTipId): void {
  if (!Array.isArray(campaign.seenTips)) campaign.seenTips = []
  if (!campaign.seenTips.includes(tipId)) {
    campaign.seenTips.push(tipId)
  }
}

/**
 * Activate or queue a discovery tip if tips are enabled and the tip has never been seen.
 * Never activates or queues duplicates. Always displays at most 1 tip at a time.
 */
export function enqueueDiscoveryTip(state: GameState, tipId: DiscoveryTipId): boolean {
  if (!areDiscoveryTipsEnabled(state.campaign)) return false
  const battle = state.battle
  if (!battle || battle.phase === 'victory' || battle.phase === 'defeat') return false
  if (hasSeenDiscoveryTip(state.campaign, tipId)) return false
  ensureTipRuntime(battle)

  if (battle.activeTipId === tipId) return false
  if (battle.tipQueue.includes(tipId)) return false

  if (battle.activeTipId === null) {
    battle.activeTipId = tipId
  } else {
    battle.tipQueue.push(tipId)
  }
  return true
}

/** Event hook alias to trigger/queue a discovery tip on first encounter. */
export function triggerDiscoveryTip(state: GameState, tipId: DiscoveryTipId): boolean {
  return enqueueDiscoveryTip(state, tipId)
}

/**
 * Dismiss the currently visible discovery tip, mark it permanently seen in `campaign.seenTips`,
 * and promote the next unseen queued tip (if any).
 */
export function dismissDiscoveryTip(state: GameState): DiscoveryTipId | null {
  const battle = state.battle
  if (!battle) return null
  ensureTipRuntime(battle)
  const dismissed = battle.activeTipId
  if (!dismissed) return null

  recordSeenTip(state.campaign, dismissed)
  battle.activeTipId = null

  if (areDiscoveryTipsEnabled(state.campaign)) {
    while (battle.tipQueue.length > 0) {
      const next = battle.tipQueue.shift()
      if (next && !hasSeenDiscoveryTip(state.campaign, next)) {
        battle.activeTipId = next
        break
      }
    }
  } else {
    battle.tipQueue = []
  }

  return dismissed
}

/** Permanently suppress all remaining discovery tips and clear any active/queued tip immediately. */
export function skipAllDiscoveryTips(state: GameState): void {
  state.campaign.tipsDisabled = true
  const battle = state.battle
  if (battle) {
    battle.activeTipId = null
    battle.tipQueue = []
  }
}

/** Enable or disable discovery tips (optionally resetting `seenTips` when re-enabling). */
export function setDiscoveryTipsEnabled(
  state: GameState,
  enabled: boolean,
  resetSeen = false
): void {
  state.campaign.tipsDisabled = !enabled
  if (resetSeen) {
    state.campaign.seenTips = []
  }
  if (!enabled && state.battle) {
    state.battle.activeTipId = null
    state.battle.tipQueue = []
  }
}

/** Re-enable tips and clear all seen tip history so tips can be discovered again. */
export function resetDiscoveryTips(state: GameState): void {
  state.campaign.tipsDisabled = false
  state.campaign.seenTips = []
  if (state.battle) {
    state.battle.activeTipId = null
    state.battle.tipQueue = []
  }
}

function isInteractiveHazardTerrain(terrain: TileTerrain | null | undefined): boolean {
  return terrain !== null && terrain !== undefined && HAZARD_TERRAINS.has(terrain)
}

function unitHasActiveStatus(u: BattleUnit): boolean {
  return (
    u.burnTurns > 0 ||
    u.slowTurns > 0 ||
    u.stunTurns > 0 ||
    u.empowerTurns > 0 ||
    u.tauntTurns > 0 ||
    u.hasteTurns > 0 ||
    u.poisonStacks > 0
  )
}

function battleHasHighGround(battle: BattleState): boolean {
  for (let r = 0; r < battle.rows; r++) {
    const row = battle.cells[r]
    if (!row) continue
    for (let c = 0; c < battle.cols; c++) {
      const cell = row[c]
      if (!cell || !terrainWalkable(cell.terrain)) continue
      if (cell.terrain === 'hill' || cellHeightLevel(cell) >= 1) return true
    }
  }
  return false
}

function battleHasTerrain(battle: BattleState, terrain: TileTerrain): boolean {
  for (let r = 0; r < battle.rows; r++) {
    const row = battle.cells[r]
    if (!row) continue
    for (let c = 0; c < battle.cols; c++) {
      if (row[c]?.terrain === terrain) return true
    }
  }
  return false
}

function battleHasInteractiveHazard(battle: BattleState): boolean {
  for (let r = 0; r < battle.rows; r++) {
    const row = battle.cells[r]
    if (!row) continue
    for (let c = 0; c < battle.cols; c++) {
      if (isInteractiveHazardTerrain(row[c]?.terrain)) return true
    }
  }
  return false
}

function battleHasAllyAdjacentToEnemyZoc(battle: BattleState): boolean {
  for (const u of battle.units) {
    if (!u.alive || u.team !== 'ally') continue
    if (getOpposingZocSentinelsAt(battle, 'ally', u.col, u.row).length > 0) return true
  }
  return false
}

function isCellInEnemyZoc(battle: BattleState, coord: GridCoord | null | undefined): boolean {
  if (!coord) return false
  const tiles = computeZocPerimeterTiles(battle, 'enemy')
  return tiles.some(t => t.col === coord.col && t.row === coord.row)
}

/**
 * Pure detector returning all eligible discovery tip IDs for the current battle snapshot
 * and optional hover/forecast context, sorted in descending contextual priority.
 * Does not mutate state or consult `seenTips`.
 */
export function detectBattleDiscoveryTips(
  battle: BattleState,
  context?: DiscoveryTipTriggerContext
): DiscoveryTipId[] {
  if (battle.phase === 'victory' || battle.phase === 'defeat') return []

  const candidates: DiscoveryTipId[] = []
  const pushUnique = (id: DiscoveryTipId) => {
    if (!candidates.includes(id)) candidates.push(id)
  }

  if (battle.phase === 'deploy') {
    pushUnique('deploy')
    if (battle.objective.kind !== 'rout') {
      pushUnique('objective_special')
    }
    return candidates
  }

  if (battle.phase !== 'player') {
    return candidates
  }

  const hovered = context?.hoveredCell ?? null
  const hoveredCell =
    hovered && hovered.row >= 0 && hovered.row < battle.rows && hovered.col >= 0 && hovered.col < battle.cols
      ? battle.cells[hovered.row]?.[hovered.col]
      : undefined
  const hoveredTerrain: TileTerrain | null = context?.hoveredTerrain ?? hoveredCell?.terrain ?? null
  const forecast = context?.forecast ?? null
  const pathOa = context?.pathOa ?? null
  const activeUnit = battle.activeUnitUid
    ? battle.units.find(u => u.uid === battle.activeUnitUid && u.alive)
    : undefined
  const activeCell = activeUnit ? battle.cells[activeUnit.row]?.[activeUnit.col] : undefined

  // 1. Urgent combat state: an ally just entered the 3-turn downed window
  if (battle.units.some(u => isUnitDowned(u))) {
    pushUnique('ko_revive')
  }

  // 2. Direct interactive encounters (hover, forecast, facing picker, armed tactic, adjacent ZoC)
  if (
    battle.facingPicker !== null ||
    (forecast !== null && (forecast.attackArc === 'flank' || forecast.attackArc === 'back'))
  ) {
    pushUnique('facing_backstab')
  }

  if (
    (pathOa !== null && pathOa.triggers.length > 0) ||
    (forecast?.opportunityAttacks !== undefined && forecast.opportunityAttacks.triggers.length > 0) ||
    battleHasAllyAdjacentToEnemyZoc(battle) ||
    isCellInEnemyZoc(battle, hovered)
  ) {
    pushUnique('zoc')
  }

  if (
    forecast?.elementalCombo !== undefined ||
    forecast?.status !== undefined ||
    forecast?.selfStatus !== undefined ||
    battle.units.some(u => u.alive && unitHasActiveStatus(u))
  ) {
    pushUnique('status_combos')
  }

  if (hoveredTerrain === 'shrine' || activeCell?.terrain === 'shrine') {
    pushUnique('shrine')
  }

  if (isInteractiveHazardTerrain(hoveredTerrain) || isInteractiveHazardTerrain(activeCell?.terrain)) {
    pushUnique('hazards')
  }

  if (
    forecast?.highGround === true ||
    (hoveredCell !== undefined && terrainWalkable(hoveredCell.terrain) && (hoveredCell.terrain === 'hill' || cellHeightLevel(hoveredCell) >= 1)) ||
    (activeCell !== undefined && (activeCell.terrain === 'hill' || cellHeightLevel(activeCell) >= 1))
  ) {
    pushUnique('high_ground')
  }

  if (battle.armedTacticUid !== null) {
    pushUnique('tactic_cards')
  }

  // 3. Baseline phase & map-presence triggers (fires on first player turn / first map containing mechanic)
  pushUnique('move_attack')

  if (battle.objective.kind !== 'rout') {
    pushUnique('objective_special')
  }

  if (battle.hand.length > 0 && battle.ap > 0) {
    pushUnique('tactic_cards')
  }

  if (battleHasHighGround(battle)) {
    pushUnique('high_ground')
  }

  if (battleHasTerrain(battle, 'shrine')) {
    pushUnique('shrine')
  }

  if (battleHasInteractiveHazard(battle)) {
    pushUnique('hazards')
  }

  return candidates
}

/**
 * Evaluate the current battle state and optional hover/forecast context, activating at most 1
 * unseen discovery tip if none is currently displayed.
 *
 * Also auto-clears the `deploy` tip once the battle transitions out of `'deploy'` phase so
 * stale deployment tips never linger into active combat.
 */
export function checkDiscoveryTipForBattle(
  state: GameState,
  context?: DiscoveryTipTriggerContext
): DiscoveryTipSpec | null {
  const battle = state.battle
  if (!battle) return null
  ensureTipRuntime(battle)

  if (!areDiscoveryTipsEnabled(state.campaign)) {
    battle.activeTipId = null
    battle.tipQueue = []
    return null
  }

  if (battle.phase === 'victory' || battle.phase === 'defeat') {
    battle.activeTipId = null
    battle.tipQueue = []
    return null
  }

  // If the player started the battle without explicitly dismissing the deploy tip, mark it seen cleanly.
  if (battle.activeTipId === 'deploy' && battle.phase !== 'deploy') {
    recordSeenTip(state.campaign, 'deploy')
    battle.activeTipId = null
  }

  // If the currently active tip was somehow already marked seen, clear it.
  if (battle.activeTipId && hasSeenDiscoveryTip(state.campaign, battle.activeTipId)) {
    battle.activeTipId = null
  }

  // Keep displaying the current active tip (at most 1 at a time).
  if (battle.activeTipId !== null) {
    return getDiscoveryTipSpec(battle.activeTipId)
  }

  // First drain any explicitly queued unseen tip.
  while (battle.tipQueue.length > 0) {
    const queued = battle.tipQueue.shift()
    if (queued && !hasSeenDiscoveryTip(state.campaign, queued)) {
      battle.activeTipId = queued
      return getDiscoveryTipSpec(queued)
    }
  }

  // Otherwise pick the single highest-priority unseen candidate from the current battle context.
  const candidates = detectBattleDiscoveryTips(battle, context)
  for (const id of candidates) {
    if (!hasSeenDiscoveryTip(state.campaign, id)) {
      battle.activeTipId = id
      return getDiscoveryTipSpec(id)
    }
  }

  return null
}
