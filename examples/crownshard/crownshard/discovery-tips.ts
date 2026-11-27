import { HERO_SPECS } from './data.ts'
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
  TileTerrain,
  TurnOrderActionPreview
} from './types.ts'
import { computeZocPerimeterTiles, getOpposingZocSentinelsAt } from './zoc.ts'

/**
 * First-Time Discovery Tips — pure simulation catalog & cross-screen trigger engine.
 * Zero browser globals so it compiles cleanly to Godot GDScript and Node.
 *
 * Rules:
 * - Each mechanic, terrain, or screen tip fires at most once per campaign, tracked in `campaign.seenTips`.
 * - At most 1 tip is active (`battle.activeTipId` in battle; `campaign.activeScreenTipId` on non-battle screens).
 * - Extra event triggers queue in `battle.tipQueue` / `campaign.screenTipQueue`.
 * - Players can dismiss the active tip or disable all tips (`skipAllDiscoveryTips`).
 */

export type DiscoveryTipScreen = 'battle' | 'world_map' | 'camp' | 'codex'

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

export type DiscoveryTipCategory =
  | 'basics'
  | 'tactics'
  | 'terrain'
  | 'combat'
  | 'mission'
  | 'world'
  | 'camp'
  | 'codex'

export interface DiscoveryTipSpec {
  readonly id: DiscoveryTipId
  readonly screen: DiscoveryTipScreen
  readonly title: string
  readonly body: string
  readonly touchBody?: string
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
  readonly turnPreview?: TurnOrderActionPreview | null
}

export interface WorldMapDiscoveryTipContext {
  readonly selectedStageId?: string | null
  readonly selectedCleared?: boolean
  readonly hasWorldEvent?: boolean
  readonly oakhavenUnlocked?: boolean
  readonly masteryUnlocked?: boolean
  readonly challengeUnlocked?: boolean
  readonly isBossRematch?: boolean
  readonly crownlessDeepUnlocked?: boolean
  readonly endlessUnlocked?: boolean
}

export type CampDiscoveryTabId = 'squad' | 'armory' | 'deck' | 'forge' | 'packs'

export interface CampDiscoveryTipContext {
  readonly activeTab: CampDiscoveryTabId
  readonly has3StarHero?: boolean
  readonly hasSetPiece?: boolean
  readonly bondsUnlocked?: boolean
  readonly temperingUnlocked?: boolean
}

export const DISCOVERY_TIPS: readonly DiscoveryTipSpec[] = [
  // ── Battle tips (original 11) ─────────────────────────────────────────────
  {
    id: 'deploy',
    screen: 'battle',
    title: 'Squad Deployment',
    body: 'Click a hero and any blue tile to reposition or swap. Press F to rotate facing before starting.',
    touchBody: 'Tap a hero and any blue tile to reposition or swap. Tap Rotate to adjust facing before starting.',
    category: 'basics',
    icon: 'flag',
    accentHex: '#5eeeff',
    hotkeyHint: 'F Rotate · Space Start'
  },
  {
    id: 'move_attack',
    screen: 'battle',
    title: 'Move, Strike & Wait-to-Face',
    body: 'Click blue tiles to move or foes to Move+Strike. End early with Wait (Space) to save CT and pick facing.',
    touchBody: 'Tap blue tiles to move or foes to Move+Strike. Tap Wait early to save CT and pick facing.',
    category: 'basics',
    icon: 'sword',
    accentHex: '#ffd24d',
    hotkeyHint: '1-4 Skills · Space Wait'
  },
  {
    id: 'high_ground',
    screen: 'battle',
    title: 'High Ground Advantage',
    body: 'Elevated ridges boost attack damage up to +35% and extend ranged reach. Claim stairs and hills early.',
    touchBody: 'Elevated ridges boost attack damage up to +35% and extend ranged reach. Tap stairs and hills to claim them early.',
    category: 'terrain',
    icon: 'up',
    accentHex: '#66e6a3'
  },
  {
    id: 'facing_backstab',
    screen: 'battle',
    title: 'Flank & Backstab Arcs',
    body: 'Strike from the side (+15% Flank) or rear (+30% Backstab) for bonus damage and to bypass melee counters.',
    touchBody: 'Tap behind or beside foes to strike from Flank (+15%) or Backstab (+30%) arcs and bypass melee counters.',
    category: 'tactics',
    icon: 'crit',
    accentHex: '#ff9a44'
  },
  {
    id: 'shrine',
    screen: 'battle',
    title: 'Sanctuary Shrines',
    body: 'Hold a glowing Sun Shrine to heal +14 HP at turn start, gain +1 DEF cover, and sustain AP for tactic turns.',
    touchBody: 'Move onto a glowing Sun Shrine to heal +14 HP at turn start, gain +1 DEF cover, and sustain AP.',
    category: 'terrain',
    icon: 'sparkle',
    accentHex: '#7ce8ff'
  },
  {
    id: 'hazards',
    screen: 'battle',
    title: 'Interactive Hazards',
    body: 'Lava Geysers erupt with Burn, Ice adds +1 glide, Cursed Altars trade HP for Empower+AP, Tall Grass shields ranged hits, and Barricades break.',
    touchBody: 'Tap hazard tiles to inspect: Lava Geysers burn, Ice glides +1, Cursed Altars grant Empower+AP, and Tall Grass shields ranged hits.',
    category: 'terrain',
    icon: 'bolt',
    accentHex: '#ff7052'
  },
  {
    id: 'zoc',
    screen: 'battle',
    title: 'Zone of Control',
    body: 'Leaving a tile beside an enemy melee sentinel triggers a 75% Opportunity Attack. Rogues slip past safely.',
    touchBody: 'Leaving a tile beside an enemy melee sentinel triggers a 75% Opportunity Attack. Rogues slip past safely.',
    category: 'tactics',
    icon: 'shield',
    accentHex: '#ff8c2b'
  },
  {
    id: 'tactic_cards',
    screen: 'battle',
    title: 'Tactic Cards & AP',
    body: 'Spend blue AP crystals to cast Tactic Cards from your hand without using a hero action. AP refills each round.',
    touchBody: 'Tap a Tactic Card in your hand and spend blue AP crystals without using a hero action. AP refills each round.',
    category: 'basics',
    icon: 'cards',
    accentHex: '#63d2ff'
  },
  {
    id: 'status_combos',
    screen: 'battle',
    title: 'Elemental Status Combos',
    body: 'Chain elements & statuses: Fire+Slow triggers Shatter, Frost on Wet/Ice Freezes, Fire+Grass spreads Wildfire, Fire+Poison triggers Combust.',
    touchBody: 'Chain elements & statuses: Fire+Slow triggers Shatter, Frost on Wet/Ice Freezes, Fire+Grass spreads Wildfire, Fire+Poison triggers Combust.',
    category: 'combat',
    icon: 'star',
    accentHex: '#c884ff'
  },
  {
    id: 'ko_revive',
    screen: 'battle',
    title: '3-Turn Downed Window',
    body: 'Fallen heroes stay downed for 3 turns before KO. Use a Cleric revive skill or healing tactic to bring them back!',
    touchBody: 'Fallen heroes stay downed for 3 turns before KO. Tap a Cleric revive skill or healing tactic to bring them back!',
    category: 'combat',
    icon: 'heart',
    accentHex: '#ff6b8b'
  },
  {
    id: 'objective_special',
    screen: 'battle',
    title: 'Special Mission Objective',
    body: 'Watch the top-left objective badge: Assassinate targets the boss, Defend guards a shrine/turns, and Seize claims goals or chests.',
    touchBody: 'Check the top-left objective badge: Assassinate targets the boss, Defend guards a shrine or turns, and Seize claims goals or chests.',
    category: 'mission',
    icon: 'target',
    accentHex: '#ffd24d'
  },

  // ── Battle tips (expanded 9) ──────────────────────────────────────────────
  {
    id: 'pincer',
    screen: 'battle',
    title: 'Pincer Follow-Up Strikes',
    body: 'Bracket a foe between two allies on opposite sides to trigger a free Pincer follow-up strike for extra damage.',
    touchBody: 'Position two allies on opposite sides of a foe to trigger a free Pincer follow-up strike for extra damage.',
    category: 'tactics',
    icon: 'sword',
    accentHex: '#ffb84d'
  },
  {
    id: 'forced_movement',
    screen: 'battle',
    title: 'Push, Pull & Slam Collisions',
    body: 'Shove foes into walls, units, or off ledges for bonus slam & fall damage, or knock them onto hazards.',
    touchBody: 'Tap a push, pull, or swap skill to shove foes into walls, units, hazards, or off ledges for bonus impact damage.',
    category: 'tactics',
    icon: 'bolt',
    accentHex: '#ff8a4c'
  },
  {
    id: 'destructible_cover',
    screen: 'battle',
    title: 'Destructible Cover',
    body: 'Barricades and Cracked Pillars block paths and ranged fire, but heavy attacks and shoves can shatter them open.',
    touchBody: 'Tap Barricades or Cracked Pillars with attacks or knockbacks to shatter cover and open new lanes.',
    category: 'terrain',
    icon: 'shield',
    accentHex: '#e0a96d'
  },
  {
    id: 'counter_attack',
    screen: 'battle',
    title: 'Melee Counter-Attacks',
    body: 'Front-facing melee foes retaliate if they survive your strike. Attack from flank/rear, range, or stun them to avoid counters.',
    touchBody: 'Front-facing melee foes counter if they survive. Tap flank or rear tiles, use range, or stun them to strike safely.',
    category: 'combat',
    icon: 'crit',
    accentHex: '#ff645c'
  },
  {
    id: 'ct_timeline',
    screen: 'battle',
    title: 'CT Turn Order & Saving CT',
    body: 'Speed fills each unit\'s Charge Time bar along the top timeline. Waiting without acting saves CT so your hero acts sooner.',
    touchBody: 'Speed fills each unit\'s CT bar on the top timeline. Tap Wait without acting to save CT and take your next turn sooner.',
    category: 'basics',
    icon: 'sparkle',
    accentHex: '#5eeeff',
    hotkeyHint: 'Space Wait'
  },
  {
    id: 'weather',
    screen: 'battle',
    title: 'Weather & Time of Day',
    body: 'Rain boosts frost & slows fire, Blizzards chill movement, and Dusk raises crit odds. Check the weather badge to adapt.',
    touchBody: 'Rain boosts frost & slows fire, Blizzards chill movement, and Dusk raises crit odds. Tap the weather badge to inspect.',
    category: 'terrain',
    icon: 'sparkle',
    accentHex: '#7ec8ff'
  },
  {
    id: 'boss_telegraph',
    screen: 'battle',
    title: 'Boss Telegraph Zones',
    body: 'Glowing red telegraph tiles warn where a boss will unleash a devastating attack next turn. Move allies clear before impact!',
    touchBody: 'Glowing red telegraph tiles mark an incoming boss attack. Tap safe tiles to move your heroes clear before impact!',
    category: 'combat',
    icon: 'target',
    accentHex: '#ff4f6d'
  },
  {
    id: 'stage_mechanic',
    screen: 'battle',
    title: 'Dynamic Stage Mechanic',
    body: 'This battlefield has a unique shifting rule—such as rising tides, gale gusts, or timed reinforcements. Plan turns around it!',
    touchBody: 'This battlefield has a shifting rule—such as rising tides, gale gusts, or timed reinforcements. Plan each turn around it!',
    category: 'mission',
    icon: 'star',
    accentHex: '#b48cff'
  },
  {
    id: 'bond_assist',
    screen: 'battle',
    title: 'Hero Bond Assists',
    body: 'Bonded heroes fighting within 2 tiles boost each other\'s ATK, crit chance, and Pincer follow-ups. Keep partners close!',
    touchBody: 'Bonded heroes fighting within 2 tiles boost each other\'s ATK, crit chance, and Pincer follow-ups. Keep partners close!',
    category: 'tactics',
    icon: 'heart',
    accentHex: '#ff85c0'
  },

  // ── World Map tips (8) ────────────────────────────────────────────────────
  {
    id: 'map_overview',
    screen: 'world_map',
    title: 'Campaign World Map',
    body: 'Click any unlocked landmark to inspect enemies, objectives, and rewards before deploying. Visit Camp anytime to upgrade.',
    touchBody: 'Tap any unlocked landmark to inspect enemies, objectives, and rewards before deploying. Tap Camp anytime to upgrade.',
    category: 'world',
    icon: 'flag',
    accentHex: '#5eeeff'
  },
  {
    id: 'map_mastery',
    screen: 'world_map',
    title: '3-Star Stage Mastery',
    body: 'Earn up to 3 Mastery Stars per stage (Clear, No KO, Under Turn Par) to unlock bonus chests and milestone rewards.',
    touchBody: 'Earn up to 3 Mastery Stars per stage (Clear, No KO, Under Turn Par) to unlock bonus chests and milestone rewards.',
    category: 'world',
    icon: 'star',
    accentHex: '#ffd24d'
  },
  {
    id: 'map_oakhaven',
    screen: 'world_map',
    title: 'Oakhaven Town & Exchange',
    body: 'Oakhaven is a safe hub town—trade Gold at the Exchange for Dust, Hero Shards, and Relic bundles that refresh between battles.',
    touchBody: 'Tap Oakhaven to visit the Exchange and trade Gold for Dust, Hero Shards, and Relic bundles that refresh between battles.',
    category: 'world',
    icon: 'sparkle',
    accentHex: '#66e6a3'
  },
  {
    id: 'map_world_event',
    screen: 'world_map',
    title: 'Roaming World Events',
    body: 'Timed map events appear between cleared roads—intercept Goblin Ambushes, enter Gauntlets, or shop Wandering Merchants before they expire.',
    touchBody: 'Tap glowing map events before they expire to intercept Goblin Ambushes, enter Gauntlets, or shop Wandering Merchants.',
    category: 'world',
    icon: 'bolt',
    accentHex: '#ff9a44'
  },
  {
    id: 'map_challenge_tiers',
    screen: 'world_map',
    title: 'Veteran & Mythic Tiers',
    body: 'Replay cleared stages on Veteran or Mythic difficulty with optional mutators for multiplied Gold, Dust, and Shard payouts.',
    touchBody: 'Tap Veteran or Mythic on cleared stages and toggle mutators for multiplied Gold, Dust, and Shard payouts.',
    category: 'world',
    icon: 'crit',
    accentHex: '#c884ff'
  },
  {
    id: 'map_boss_rematch',
    screen: 'world_map',
    title: 'Boss-Less Skirmish Rematches',
    body: 'Cleared boss arenas stay replayable as boss-less garrison skirmishes for 60% replay gold without the defeated boss.',
    touchBody: 'Tap cleared boss arenas to replay a boss-less garrison skirmish for 60% replay gold.',
    category: 'world',
    icon: 'target',
    accentHex: '#ff5f7e'
  },
  {
    id: 'map_crownless_deep',
    screen: 'world_map',
    title: 'The Crownless Deep',
    body: 'Descend multi-floor Abyssal trials for escalating challenges and rare endgame rewards. Tune your squad between floors.',
    touchBody: 'Tap the Crownless Deep to descend multi-floor Abyssal trials for escalating challenges and rare endgame rewards.',
    category: 'world',
    icon: 'shield',
    accentHex: '#9d7dff'
  },
  {
    id: 'map_endless',
    screen: 'world_map',
    title: 'Endless Spire',
    body: 'Battle infinite waves and draft stacking Blessings after each clear to push your best Endless Spire streak.',
    touchBody: 'Tap Endless Spire to battle infinite waves and draft stacking Blessings after each clear to push your best streak.',
    category: 'world',
    icon: 'up',
    accentHex: '#5ce1e6'
  },

  // ── Camp tips (8) ─────────────────────────────────────────────────────────
  {
    id: 'camp_squad_merge',
    screen: 'camp',
    title: 'Squad Roster & Star Merges',
    body: 'Click heroes to set your active squad and merge duplicate copies into 2★ and 3★ ranks to unlock stronger skills.',
    touchBody: 'Tap heroes to set your active squad and merge duplicate copies into 2★ and 3★ ranks to unlock stronger skills.',
    category: 'camp',
    icon: 'star',
    accentHex: '#ffd24d'
  },
  {
    id: 'camp_subspec',
    screen: 'camp',
    title: '3★ Hero Sub-Specializations',
    body: '3★ heroes can choose between two Sub-Specializations for tailored stat bonuses and signature passives—switch freely in Camp.',
    touchBody: 'Tap a 3★ hero to choose between two Sub-Specializations for tailored stat bonuses and passives—switch freely in Camp.',
    category: 'camp',
    icon: 'sparkle',
    accentHex: '#c884ff'
  },
  {
    id: 'camp_armory_diff',
    screen: 'camp',
    title: 'Armory & Stat Diffs',
    body: 'Hover or select weapons, armor, and relics to compare green/red stat diffs before equipping them to your active hero.',
    touchBody: 'Tap weapons, armor, and relics to preview green/red stat diffs before equipping them to your active hero.',
    category: 'camp',
    icon: 'shield',
    accentHex: '#66e6a3'
  },
  {
    id: 'camp_temper_sets',
    screen: 'camp',
    title: 'Tempering & Gear Sets',
    body: 'Spend Dust to Temper equipment up to +5, and equip 2 or 3 pieces from the same Gear Set to activate powerful set bonuses.',
    touchBody: 'Tap Temper to spend Dust upgrading gear up to +5, and equip 2 or 3 matching Set pieces for powerful set bonuses.',
    category: 'camp',
    icon: 'up',
    accentHex: '#ff9a44'
  },
  {
    id: 'camp_forge',
    screen: 'camp',
    title: 'The Forge & Salvaging',
    body: 'Salvage spare equipment for Dust, then craft targeted weapons, armor, relics, or Hero Shards directly at the Forge.',
    touchBody: 'Tap spare gear to Salvage for Dust, then craft targeted weapons, armor, relics, or Hero Shards directly at the Forge.',
    category: 'camp',
    icon: 'bolt',
    accentHex: '#ff7052'
  },
  {
    id: 'camp_tactic_deck',
    screen: 'camp',
    title: 'Tactic Deck Builder',
    body: 'Curate which Tactic Cards enter your battle draw pile—keep a lean deck so your strongest spells cycle reliably.',
    touchBody: 'Tap Tactic Cards to add or remove them from your battle deck—keep a lean deck so your best spells cycle reliably.',
    category: 'camp',
    icon: 'cards',
    accentHex: '#63d2ff'
  },
  {
    id: 'camp_packs_pity',
    screen: 'camp',
    title: 'Card Packs & Pity Tracker',
    body: 'Open Recruit, Vanguard, or Sovereign packs for new heroes, gear, and tactics. Built-in pity guarantees Epic and Legendary pulls.',
    touchBody: 'Tap Recruit, Vanguard, or Sovereign packs for heroes, gear, and tactics. Built-in pity guarantees Epic and Legendary pulls.',
    category: 'camp',
    icon: 'sparkle',
    accentHex: '#ffd24d'
  },
  {
    id: 'camp_bonds',
    screen: 'camp',
    title: 'Hero Bonds',
    body: 'Deploying the same pair of heroes together builds Bond Ranks (I–III), unlocking combat banter and adjacent assist bonuses.',
    touchBody: 'Deploying the same pair of heroes together builds Bond Ranks (I–III), unlocking combat banter and adjacent assist bonuses.',
    category: 'camp',
    icon: 'heart',
    accentHex: '#ff85c0'
  },

  // ── Codex tips (1) ────────────────────────────────────────────────────────
  {
    id: 'codex_overview',
    screen: 'codex',
    title: 'Tactical Codex & Bestiary',
    body: 'Browse unlocked rules, terrain effects, elemental combos, and defeated enemy stats anytime—and replay tips from Settings.',
    touchBody: 'Tap any tab to browse rules, terrain effects, elemental combos, and defeated enemy stats—and replay tips from Settings.',
    category: 'codex',
    icon: 'flag',
    accentHex: '#7ce8ff'
  }
]

export const DISCOVERY_TIP_IDS: readonly DiscoveryTipId[] = DISCOVERY_TIPS.map(t => t.id)

export const DISCOVERY_TIP_BY_ID: Readonly<Record<DiscoveryTipId, DiscoveryTipSpec>> = Object.fromEntries(
  DISCOVERY_TIPS.map(spec => [spec.id, spec])
) as Record<DiscoveryTipId, DiscoveryTipSpec>

const VALID_TIP_SET: ReadonlySet<string> = new Set<string>(DISCOVERY_TIP_IDS)

const HAZARD_TERRAINS: ReadonlySet<TileTerrain> = new Set<TileTerrain>([
  'lava_geyser',
  'ice',
  'cursed_altar',
  'tall_grass',
  'barricade',
  'cracked_pillar'
])

/** True when `id` is a known DiscoveryTipId. */
export function isDiscoveryTipId(id: string): id is DiscoveryTipId {
  return VALID_TIP_SET.has(id)
}

/** Return modality-appropriate tip body text (touch copy on touch devices, desktop copy otherwise). */
export function getDiscoveryTipBody(spec: DiscoveryTipSpec, isTouch: boolean): string {
  return isTouch && spec.touchBody ? spec.touchBody : spec.body
}

/** Return desktop hotkey hint, or `undefined` on touch devices where keyboard shortcuts do not apply. */
export function getDiscoveryTipHotkey(spec: DiscoveryTipSpec, isTouch: boolean): string | undefined {
  return isTouch ? undefined : spec.hotkeyHint
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

/** Return the currently displayed battle discovery tip spec, or null if none is active or tips are disabled. */
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

function ensureScreenTipRuntime(campaign: CampaignState): void {
  if (campaign.activeScreenTipId === undefined) campaign.activeScreenTipId = null
  if (!Array.isArray(campaign.screenTipQueue)) campaign.screenTipQueue = []
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
 * Dismiss the currently visible battle discovery tip, mark it permanently seen in `campaign.seenTips`,
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
  state.campaign.activeScreenTipId = null
  state.campaign.screenTipQueue = []
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
    state.campaign.activeScreenTipId = null
    state.campaign.screenTipQueue = []
  }
  if (!enabled) {
    state.campaign.activeScreenTipId = null
    state.campaign.screenTipQueue = []
    if (state.battle) {
      state.battle.activeTipId = null
      state.battle.tipQueue = []
    }
  }
}

/** Re-enable tips and clear all seen tip history so tips can be discovered again. */
export function resetDiscoveryTips(state: GameState): void {
  state.campaign.tipsDisabled = false
  state.campaign.seenTips = []
  state.campaign.activeScreenTipId = null
  state.campaign.screenTipQueue = []
  if (state.battle) {
    state.battle.activeTipId = null
    state.battle.tipQueue = []
  }
}

// ── Cross-screen tip engine (World Map, Camp, Codex) ─────────────────────────

/** Return the currently active discovery tip spec for `screen`, or null if none is active. */
export function getActiveScreenDiscoveryTip(
  campaign: Pick<CampaignState, 'seenTips' | 'tipsDisabled' | 'activeScreenTipId'>,
  screen: DiscoveryTipScreen
): DiscoveryTipSpec | null {
  if (!areDiscoveryTipsEnabled(campaign)) return null
  const activeId = campaign.activeScreenTipId
  if (!activeId) return null
  if (hasSeenDiscoveryTip(campaign, activeId)) return null
  const spec = getDiscoveryTipSpec(activeId)
  if (!spec || spec.screen !== screen) return null
  return spec
}

/**
 * Dismiss the currently active screen tip for `screen`, record it in `campaign.seenTips`,
 * and promote the next unseen queued tip belonging to `screen` (if any).
 */
export function dismissScreenDiscoveryTip(
  campaign: CampaignState,
  screen: DiscoveryTipScreen
): DiscoveryTipId | null {
  ensureScreenTipRuntime(campaign)
  const activeId = campaign.activeScreenTipId
  if (!activeId) return null
  const activeSpec = getDiscoveryTipSpec(activeId)
  if (!activeSpec || activeSpec.screen !== screen) return null

  recordSeenTip(campaign, activeId)
  campaign.activeScreenTipId = null

  if (!areDiscoveryTipsEnabled(campaign)) {
    campaign.screenTipQueue = []
    return activeId
  }

  const queue = campaign.screenTipQueue!
  let promoted: DiscoveryTipId | null = null
  const remaining: DiscoveryTipId[] = []
  for (const id of queue) {
    if (hasSeenDiscoveryTip(campaign, id)) continue
    const spec = getDiscoveryTipSpec(id)
    if (!spec) continue
    if (promoted === null && spec.screen === screen) {
      promoted = id
    } else {
      remaining.push(id)
    }
  }
  campaign.screenTipQueue = remaining
  campaign.activeScreenTipId = promoted
  return activeId
}

function activateScreenDiscoveryTip(
  campaign: CampaignState,
  screen: DiscoveryTipScreen,
  candidates: readonly DiscoveryTipId[]
): DiscoveryTipSpec | null {
  ensureScreenTipRuntime(campaign)

  if (!areDiscoveryTipsEnabled(campaign)) {
    campaign.activeScreenTipId = null
    campaign.screenTipQueue = []
    return null
  }

  // Clear stale/seen active tip
  if (campaign.activeScreenTipId && hasSeenDiscoveryTip(campaign, campaign.activeScreenTipId)) {
    campaign.activeScreenTipId = null
  }

  // If the current active tip already belongs to this screen, keep displaying it
  if (campaign.activeScreenTipId) {
    const existing = getDiscoveryTipSpec(campaign.activeScreenTipId)
    if (existing && existing.screen === screen) {
      return existing
    }
    // Switching screens while an unseen tip from another screen was active: replace cleanly
    // (the other screen's tip stays unseen and will re-trigger when returning there).
    campaign.activeScreenTipId = null
  }

  // Drain any queued unseen tip for this screen first
  const queue = campaign.screenTipQueue!
  for (let i = 0; i < queue.length; i++) {
    const queuedId = queue[i]
    if (hasSeenDiscoveryTip(campaign, queuedId)) continue
    const spec = getDiscoveryTipSpec(queuedId)
    if (spec && spec.screen === screen) {
      queue.splice(i, 1)
      campaign.activeScreenTipId = queuedId
      return spec
    }
  }

  // Otherwise pick the highest-priority unseen candidate for this screen
  for (const id of candidates) {
    if (hasSeenDiscoveryTip(campaign, id)) continue
    const spec = getDiscoveryTipSpec(id)
    if (spec && spec.screen === screen) {
      campaign.activeScreenTipId = id
      return spec
    }
  }

  return null
}

/** Evaluate World Map context and activate at most 1 unseen World Map discovery tip. */
export function checkDiscoveryTipForWorldMap(
  campaign: CampaignState,
  context?: WorldMapDiscoveryTipContext
): DiscoveryTipSpec | null {
  const candidates: DiscoveryTipId[] = ['map_overview']

  if (context?.hasWorldEvent === true || (Array.isArray(campaign.worldEvents) && campaign.worldEvents.length > 0)) {
    candidates.push('map_world_event')
  }
  if (context?.oakhavenUnlocked === true || context?.selectedStageId === 'oakhaven') {
    candidates.push('map_oakhaven')
  }
  if (context?.masteryUnlocked === true || context?.selectedCleared === true) {
    candidates.push('map_mastery')
  }
  if (context?.challengeUnlocked === true) {
    candidates.push('map_challenge_tiers')
  }
  if (context?.isBossRematch === true) {
    candidates.push('map_boss_rematch')
  }
  if (context?.crownlessDeepUnlocked === true) {
    candidates.push('map_crownless_deep')
  }
  if (context?.endlessUnlocked === true) {
    candidates.push('map_endless')
  }

  return activateScreenDiscoveryTip(campaign, 'world_map', candidates)
}

/** Evaluate Camp tab & progression context and activate at most 1 unseen Camp discovery tip. */
export function checkDiscoveryTipForCamp(
  campaign: CampaignState,
  context: CampDiscoveryTipContext
): DiscoveryTipSpec | null {
  const candidates: DiscoveryTipId[] = []

  switch (context.activeTab) {
    case 'squad': {
      candidates.push('camp_squad_merge')
      if (context.has3StarHero === true || campaign.heroes.some(h => h.stars >= 3)) {
        candidates.push('camp_subspec')
      }
      if (context.bondsUnlocked === true || Object.keys(campaign.heroBonds ?? {}).length > 0) {
        candidates.push('camp_bonds')
      }
      break
    }
    case 'armory': {
      candidates.push('camp_armory_diff')
      if (context.temperingUnlocked === true || context.hasSetPiece === true) {
        candidates.push('camp_temper_sets')
      }
      break
    }
    case 'forge': {
      candidates.push('camp_forge')
      if (context.temperingUnlocked === true || context.hasSetPiece === true) {
        candidates.push('camp_temper_sets')
      }
      break
    }
    case 'deck': {
      candidates.push('camp_tactic_deck')
      break
    }
    case 'packs': {
      candidates.push('camp_packs_pity')
      break
    }
  }

  return activateScreenDiscoveryTip(campaign, 'camp', candidates)
}

/** Evaluate Codex screen and trigger `'codex_overview'` once per campaign. */
export function checkDiscoveryTipForCodex(campaign: CampaignState): DiscoveryTipSpec | null {
  return activateScreenDiscoveryTip(campaign, 'codex', ['codex_overview'])
}

// ── Battle tip detection helpers ─────────────────────────────────────────────

function isInteractiveHazardTerrain(terrain: TileTerrain | null | undefined): boolean {
  return terrain !== null && terrain !== undefined && HAZARD_TERRAINS.has(terrain)
}

function isDestructibleCoverTerrain(terrain: TileTerrain | null | undefined): boolean {
  return terrain === 'barricade' || terrain === 'cracked_pillar'
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

function battleHasDestructibleCover(battle: BattleState): boolean {
  return battleHasTerrain(battle, 'barricade') || battleHasTerrain(battle, 'cracked_pillar')
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

function unitHasUnlockedDisplacementSkill(unit: BattleUnit | undefined): boolean {
  if (!unit || !unit.heroId) return false
  const spec = HERO_SPECS[unit.heroId]
  if (!spec) return false
  return spec.skills.some(skill => skill.tier <= unit.stars && skill.displacement !== undefined)
}

function battleHasAllyPincerSetup(battle: BattleState): boolean {
  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  if (allies.length < 2) return false
  const hasAllyAt = (col: number, row: number) => allies.some(a => a.col === col && a.row === row)
  for (const foe of battle.units) {
    if (!foe.alive || foe.team !== 'enemy') continue
    if (
      (hasAllyAt(foe.col - 1, foe.row) && hasAllyAt(foe.col + 1, foe.row)) ||
      (hasAllyAt(foe.col, foe.row - 1) && hasAllyAt(foe.col, foe.row + 1))
    ) {
      return true
    }
  }
  return false
}

function battleHasAdjacentBondPair(battle: BattleState): boolean {
  if (!Array.isArray(battle.bondPairsActive) || battle.bondPairsActive.length === 0) return false
  const aliveAllies = battle.units.filter(u => u.alive && u.team === 'ally' && u.heroId !== undefined)
  if (aliveAllies.length < 2) return false
  for (const pair of battle.bondPairsActive) {
    const a = aliveAllies.find(u => u.heroId === pair.heroA)
    const b = aliveAllies.find(u => u.heroId === pair.heroB)
    if (!a || !b) continue
    const dist = Math.abs(a.col - b.col) + Math.abs(a.row - b.row)
    if (dist <= 2) return true
  }
  return false
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
  const turnPreview = context?.turnPreview ?? null
  const activeUnit = battle.activeUnitUid
    ? battle.units.find(u => u.uid === battle.activeUnitUid && u.alive)
    : undefined
  const activeCell = activeUnit ? battle.cells[activeUnit.row]?.[activeUnit.col] : undefined

  // 1. Urgent combat state: downed ally or active boss telegraph
  if (battle.units.some(u => isUnitDowned(u))) {
    pushUnique('ko_revive')
  }

  if (Array.isArray(battle.bossTelegraphs) && battle.bossTelegraphs.length > 0) {
    pushUnique('boss_telegraph')
  }

  // 2. Direct interactive encounters (hover, forecast, facing picker, armed tactic, adjacent ZoC)
  if (
    battle.facingPicker !== null ||
    (forecast !== null && (forecast.attackArc === 'flank' || forecast.attackArc === 'back'))
  ) {
    pushUnique('facing_backstab')
  }

  if (
    forecast?.pincerAssisterUid !== undefined ||
    (forecast?.pincerDmg !== undefined && forecast.pincerDmg > 0) ||
    battleHasAllyPincerSetup(battle)
  ) {
    pushUnique('pincer')
  }

  if (forecast?.canCounter === true || (forecast?.counterDmg !== undefined && forecast.counterDmg > 0)) {
    pushUnique('counter_attack')
  }

  if (forecast?.displacementPreview !== undefined) {
    pushUnique('forced_movement')
  }

  if (
    isDestructibleCoverTerrain(hoveredTerrain) ||
    (forecast?.coverDamage !== undefined && forecast.coverDamage > 0) ||
    (forecast?.coverHits !== undefined && forecast.coverHits.length > 0) ||
    forecast?.willShatterCover === true
  ) {
    pushUnique('destructible_cover')
  }

  if (forecast?.bondAssistRank !== undefined) {
    pushUnique('bond_assist')
  }

  if (turnPreview !== null) {
    pushUnique('ct_timeline')
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

  if (battle.stageMechanic !== undefined) {
    pushUnique('stage_mechanic')
  }

  if (battle.weather !== 'clear' || battle.timeOfDay !== 'day' || forecast?.weatherNote !== undefined) {
    pushUnique('weather')
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

  if (battleHasDestructibleCover(battle)) {
    pushUnique('destructible_cover')
  }

  if (unitHasUnlockedDisplacementSkill(activeUnit)) {
    pushUnique('forced_movement')
  }

  if (battleHasAdjacentBondPair(battle)) {
    pushUnique('bond_assist')
  }

  if (battle.turn >= 2) {
    pushUnique('ct_timeline')
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
