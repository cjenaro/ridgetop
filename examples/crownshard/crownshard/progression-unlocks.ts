import { CHAPTER_BY_ID, ENEMY_SPECS } from './data.ts'
import { terrainWalkable } from './types.ts'
import type {
  BiomeId,
  CampaignState,
  ChapterEnemySpawn,
  ChapterSpec,
  EnemyArchetypeId,
  StageDifficultyTier,
  WorldRegionId
} from './types.ts'

/**
 * Pure progressive disclosure unlock predicates, re-battle difficulty tier gating,
 * and boss-less rematch skirmish rules for Crownshard.
 * Zero browser globals; compiles cleanly to Godot GDScript via `compileTsToGd`.
 */

export type CampTabId = 'squad' | 'armory' | 'deck' | 'forge' | 'packs'

/** Reduced replay gold multiplier (60%) when re-battling a cleared boss stage as a boss-less skirmish. */
export const BOSS_REMATCH_REWARD_SCALE = 0.6

/** Early Act I tutorial stages that remain Standard ('normal') only without Veteran/Mythic/Mutators. */
export const EARLY_STANDARD_ONLY_STAGE_IDS: readonly string[] = [
  'border_watch',
  'miller_ford',
  'sunken_bridge'
]

/** Late-game regions that unlock Mythic re-battles once Veteran+ is unlocked. */
const LATE_GAME_REGIONS: readonly WorldRegionId[] = [
  'emberwaste',
  'eclipse_dominion',
  'sunbleached_dunes',
  'aether_isles',
  'shattered_expanse'
]

/** Resolve effective campaign progression wins across cleared stages and total battles won. */
export function getCampaignWins(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): number {
  const cleared = Array.isArray(campaign.clearedStageIds) ? campaign.clearedStageIds.length : 0
  const won = typeof campaign.battlesWon === 'number' && campaign.battlesWon > 0
    ? Math.floor(campaign.battlesWon)
    : 0
  return cleared > won ? cleared : won
}

/** P1: New players drop straight into Battle 1 (`border_watch`); World Map reveals after Victory 1. */
export function shouldLaunchDirectlyIntoBattle1(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): boolean {
  return campaign.clearedStageIds.length === 0 && campaign.battlesWon === 0
}

/** World Map unlocks after clearing Battle 1. */
export function isWorldMapRevealed(
  campaign: Pick<CampaignState, 'clearedStageIds'>
): boolean {
  return campaign.clearedStageIds.length >= 1
}

/** Camp unlocks after clearing Battle 1. */
export function isCampUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds'>
): boolean {
  return campaign.clearedStageIds.length >= 1
}

/** Progressive Camp tab disclosure based on campaign wins. */
export function getUnlockedCampTabs(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): CampTabId[] {
  const wins = getCampaignWins(campaign)
  if (wins <= 0) return []
  if (wins === 1) return ['squad', 'armory']
  if (wins === 2) return ['squad', 'armory', 'deck', 'packs']
  return ['squad', 'armory', 'deck', 'packs', 'forge']
}

/** True when a specific Camp tab is unlocked for the campaign. */
export function isCampTabUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>,
  tab: CampTabId
): boolean {
  return getUnlockedCampTabs(campaign).includes(tab)
}

/** Gear Tempering (+1..+5 upgrades) unlocks at 3 wins alongside Forge. */
export function isGearTemperingUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): boolean {
  return getCampaignWins(campaign) >= 3
}

/** Bulk Salvage unlocks at 3 wins alongside Forge. */
export function isBulkSalvageUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): boolean {
  return getCampaignWins(campaign) >= 3
}

/** Squad Bonds panel/badges unlock at 3 wins. */
export function isSquadBondsUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): boolean {
  return getCampaignWins(campaign) >= 3
}

/** Secondary currencies (Arcane Dust & Hero Shards) stay hidden until 3 wins or non-zero balance. */
export function areSecondaryCurrenciesVisible(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon' | 'dust' | 'shards'>
): boolean {
  return getCampaignWins(campaign) >= 3 || campaign.dust > 0 || campaign.shards > 0
}

/** Codex / Bestiary unlocks after Battle 1. */
export function isCodexUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): boolean {
  return getCampaignWins(campaign) >= 1
}

/** Stage Mastery stars & chests are deferred until Battle 2+ (wins >= 1). */
export function isMasteryUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): boolean {
  return getCampaignWins(campaign) >= 1
}

/** Advanced battle tools (Auto-Battle, Speed, Danger Zone, Combat Log) defer until Battle 2+ (wins >= 1). */
export function areAdvancedBattleToolsUnlocked(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>
): boolean {
  return getCampaignWins(campaign) >= 1
}

function resolveStageSpec(stageOrId: ChapterSpec | string): ChapterSpec | undefined {
  if (typeof stageOrId === 'string') return CHAPTER_BY_ID[stageOrId]
  return stageOrId
}

function isEarlyTutorialStage(stage: ChapterSpec): boolean {
  return EARLY_STANDARD_ONLY_STAGE_IDS.includes(stage.id)
}

function isLateGameStage(stage: ChapterSpec): boolean {
  if (LATE_GAME_REGIONS.includes(stage.region)) return true
  if (stage.difficulty >= 5) return true
  if (stage.kind === 'boss' && stage.difficulty >= 4) return true
  return false
}

/**
 * Progressive re-battle difficulty tier gating (`ridgetop-5hr.9`).
 * Uses Crownshard's canonical `StageDifficultyTier` (`'normal' | 'veteran' | 'mythic'`).
 */
export function getAllowedChallengeTiers(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>,
  stageOrId: ChapterSpec | string
): StageDifficultyTier[] {
  const stage = resolveStageSpec(stageOrId)
  if (!stage) return ['normal']
  const wins = getCampaignWins(campaign)
  if (isEarlyTutorialStage(stage) || wins < 4) {
    return ['normal']
  }
  if (wins >= 8 || isLateGameStage(stage)) {
    return ['normal', 'veteran', 'mythic']
  }
  return ['normal', 'veteran']
}

/** Mutators unlock alongside Veteran difficulty on stages that support Veteran+. */
export function areMutatorsUnlockedForStage(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'battlesWon'>,
  stageOrId: ChapterSpec | string
): boolean {
  return getAllowedChallengeTiers(campaign, stageOrId).includes('veteran')
}

/** True if a specific enemy archetype is a boss or regional mini-boss. */
export function isBossArchetypeId(enemyId: EnemyArchetypeId): boolean {
  const spec = ENEMY_SPECS[enemyId]
  if (!spec) return false
  return Boolean(spec.isBoss) || spec.ai === 'boss'
}

/** True when a stage's enemy roster contains at least one boss/mini-boss unit. */
export function isStageBossEncounter(stageOrId: ChapterSpec | string): boolean {
  const stage = resolveStageSpec(stageOrId)
  if (!stage) return false
  for (const spawn of stage.enemies) {
    if (isBossArchetypeId(spawn.id)) return true
  }
  return false
}

/**
 * True when re-battling a boss stage that has already been cleared:
 * the defeated boss does not respawn, converting the stage into a garrison skirmish.
 */
export function isBossRematchSkirmish(
  campaign: Pick<CampaignState, 'clearedStageIds'>,
  stageOrId: ChapterSpec | string
): boolean {
  const stage = resolveStageSpec(stageOrId)
  if (!stage) return false
  return isStageBossEncounter(stage) && campaign.clearedStageIds.includes(stage.id)
}

function fallbackGarrisonArchetypesForBiome(biome: BiomeId): [EnemyArchetypeId, EnemyArchetypeId] {
  if (biome === 'meadow') return ['goblin', 'bone_archer']
  if (biome === 'river') return ['goblin', 'bog_shaman']
  if (biome === 'crypt') return ['crypt_knight', 'bone_archer']
  if (biome === 'frost') return ['frost_golem', 'ice_wraith']
  if (biome === 'volcano') return ['orc_brute', 'ember_pyromancer']
  return ['crypt_knight', 'ember_pyromancer']
}

/**
 * Build the enemy spawn list for a boss-less rematch skirmish.
 * Filters out all boss units; if a boss stage had ONLY boss units, spawns 2 thematic
 * non-boss garrison foes so the skirmish remains playable and winnable.
 */
export function buildBossRematchEnemies(stage: ChapterSpec): ChapterEnemySpawn[] {
  const garrison: ChapterEnemySpawn[] = []
  for (const spawn of stage.enemies) {
    if (!isBossArchetypeId(spawn.id)) {
      garrison.push(spawn)
    }
  }
  if (garrison.length > 0) return garrison

  const pair = fallbackGarrisonArchetypesForBiome(stage.biome)
  const firstBoss = stage.enemies[0]
  const baseCol = firstBoss ? firstBoss.col : 5
  const baseRow = firstBoss ? firstBoss.row : 2
  const rows = stage.grid.length
  const cols = stage.grid[0]?.length ?? 8
  const isWalkableTile = (r: number, c: number): boolean => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return false
    const t = stage.grid[r]?.[c]
    return t !== undefined && terrainWalkable(t)
  }
  const offsets: readonly [number, number][] = [
    [-1, 1],
    [0, 1],
    [0, -1],
    [-1, 0],
    [1, 0],
    [-1, -1],
    [1, 1],
    [1, -1]
  ]
  let altCol = baseCol > 0 ? baseCol - 1 : Math.min(cols - 1, baseCol + 1)
  let altRow = baseRow + 1 < rows ? baseRow + 1 : Math.max(0, baseRow - 1)
  for (const [dc, dr] of offsets) {
    if (isWalkableTile(baseRow + dr, baseCol + dc)) {
      altCol = baseCol + dc
      altRow = baseRow + dr
      break
    }
  }

  return [
    { id: pair[0], col: baseCol, row: baseRow, levelScale: firstBoss?.levelScale },
    { id: pair[1], col: altCol, row: altRow, levelScale: firstBoss?.levelScale }
  ]
}
