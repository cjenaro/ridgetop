import { CHAPTER_BY_ID, PLAYABLE_CHAPTERS } from './data.ts'
import { getGauntletMaxRounds } from './expansion-endgame.ts'
import { isUnitDowned } from './types.ts'
import type {
  BattleMasteryEvaluation,
  BattleState,
  CampaignState,
  ChapterSpec,
  GameState,
  MasteryMilestoneSpec,
  StageMasteryChestReward,
  StageMasteryObjectiveSpec,
  StageMasteryRecord,
  StageMasteryStars
} from './types.ts'

/**
 * Pure 3-Star Stage Mastery System for Crownshard:
 * - Star 1 (`clear`): Clear the stage
 * - Star 2 (`no_ko`): Finish with Zero Hero KOs (no ally permanently fallen & none downed at victory)
 * - Star 3 (`turn_par`): Win within the stage's tactical turn par (and keep protect tile intact on Defend stages)
 * - Incremental star upgrades across replays
 * - One-time per-stage 3-star Mastery Chests + Continent-wide star Milestone Chests
 *
 * Zero external libraries, browser-global-free, and Godot-compiler-compatible.
 */

export const MAX_STAGE_MASTERY_STARS = 3

export const MASTERY_MILESTONES: readonly MasteryMilestoneSpec[] = [
  { threshold: 15, title: 'Vanguard Commendation', gold: 250, dust: 60, shards: 40 },
  { threshold: 30, title: 'Silver Banner Cache', gold: 450, dust: 110, shards: 75 },
  { threshold: 50, title: 'Golden Laurel Vault', gold: 750, dust: 180, shards: 120 },
  { threshold: 75, title: 'Sovereign War Chest', gold: 1200, dust: 280, shards: 180 },
  { threshold: 99, title: 'Grandmaster of Solis', gold: 2000, dust: 450, shards: 300 }
]

export interface StageMasteryChestClaimResult {
  readonly ok: boolean
  readonly stageId: string
  readonly gold: number
  readonly dust: number
  readonly shards: number
  readonly reason?: string
}

export interface MasteryMilestoneClaimResult {
  readonly ok: boolean
  readonly threshold: number
  readonly title: string
  readonly gold: number
  readonly dust: number
  readonly shards: number
  readonly reason?: string
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toMasteryStars(cleared: boolean, noKo: boolean, underPar: boolean): StageMasteryStars {
  const count = (cleared ? 1 : 0) + (noKo ? 1 : 0) + (underPar ? 1 : 0)
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  return 3
}

/**
 * Compute the tactical turn par (Star 3) for any playable Crownshard stage,
 * scaled cleanly by objective kind, gauntlet waves, enemy count, and difficulty tier.
 */
export function getStageMasteryTurnLimit(chapter: ChapterSpec): number {
  const obj = chapter.objective
  const kind = obj?.kind ?? 'rout'

  // Defend stages use their defensive survival turn target (and also require no protect breach)
  if (kind === 'defend') {
    const target = obj?.targetTurns !== undefined && obj.targetTurns > 0 ? Math.floor(obj.targetTurns) : 6
    return target
  }

  // Seize stages with a strict turn limit set a tighter tactical par (2 turns faster, min 5)
  if (kind === 'seize') {
    if (obj?.turnLimit !== undefined && obj.turnLimit > 0) {
      return Math.max(5, Math.floor(obj.turnLimit) - 2)
    }
    const chestBonus = (obj?.requiredChests ?? 0) > 0 ? Math.min(3, obj?.requiredChests ?? 0) : 0
    return 6 + Math.ceil(chapter.difficulty * 0.6) + chestBonus
  }

  // Assassinate stages scale by difficulty + boss/multi-phase allowance
  if (kind === 'assassinate') {
    const bossBonus = chapter.kind === 'boss' ? 2 : 0
    const phaseBonus = chapter.id === 'first_sun_sanctum' ? 2 : 0
    return 6 + Math.floor(chapter.difficulty * 0.75) + bossBonus + phaseBonus
  }

  // Rout & multi-wave gauntlet stages scale by enemy count, difficulty, boss status, and gauntlet rounds
  const enemyBonus = Math.min(3, Math.max(0, chapter.enemies.length - 2))
  const diffBonus = Math.ceil(chapter.difficulty * 0.85)
  const bossBonus = chapter.kind === 'boss' ? 1 : 0
  const gauntletRounds = getGauntletMaxRounds(chapter.id)
  const gauntletBonus = gauntletRounds > 1 ? (gauntletRounds - 1) * 3 : 0
  return 5 + enemyBonus + diffBonus + bossBonus + gauntletBonus
}

/**
 * Compute the player turn count used for Star 3 mastery evaluation and best-turn tracking.
 * Uses objective roundsElapsed (player turns completed) with a minimum of 1 once combat began.
 */
export function getBattleTurnsTaken(battle: Pick<BattleState, 'turn' | 'objective'>): number {
  const rounds = Math.floor(battle.objective.roundsElapsed)
  if (rounds > 0) return rounds
  return battle.turn > 0 ? 1 : 0
}

/** Compute the effective hero KO count at the end of a battle. */
export function getBattleHeroKoCount(battle: Pick<BattleState, 'units' | 'heroKoCount' | 'anyHeroFallen'>): number {
  let notAliveAllies = 0
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (u.team === 'ally' && !u.alive) notAliveAllies += 1
  }
  const tracked = Number.isFinite(battle.heroKoCount) ? Math.max(0, Math.floor(battle.heroKoCount)) : 0
  const fallenFloor = battle.anyHeroFallen ? 1 : 0
  return Math.max(tracked, notAliveAllies, fallenFloor)
}

/** Whether the battle finished with zero hero KOs (no ally permanently fallen and none downed at victory). */
export function didFinishWithZeroHeroKos(battle: Pick<BattleState, 'units' | 'heroKoCount' | 'anyHeroFallen'>): boolean {
  if (battle.anyHeroFallen) return false
  if ((battle.heroKoCount ?? 0) > 0) return false
  for (let i = 0; i < battle.units.length; i++) {
    const u = battle.units[i]
    if (u.team === 'ally' && (!u.alive || isUnitDowned(u))) {
      return false
    }
  }
  return true
}

/** One-time 3-star Mastery Chest reward for a stage, scaled by stage difficulty & kind. */
export function getStageMasteryChestReward(chapter: ChapterSpec): StageMasteryChestReward {
  const kindGold = chapter.kind === 'boss' ? 60 : chapter.kind === 'elite' ? 30 : 0
  const kindDust = chapter.kind === 'boss' ? 15 : chapter.kind === 'elite' ? 8 : 0
  const kindShards = chapter.kind === 'boss' ? 10 : chapter.kind === 'elite' ? 5 : 0
  return {
    gold: 80 + chapter.difficulty * 35 + kindGold,
    dust: 15 + chapter.difficulty * 8 + kindDust,
    shards: 10 + chapter.difficulty * 5 + kindShards
  }
}

/** Empty (0-star) mastery record for an uncleared stage. */
export function createEmptyStageMasteryRecord(): StageMasteryRecord {
  return {
    stars: 0,
    cleared: false,
    noKo: false,
    underPar: false
  }
}

/** Fetch the current mastery record for `stageId`, falling back cleanly to cleared status if missing. */
export function getStageMasteryRecord(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'stageMastery'>,
  stageId: string
): StageMasteryRecord {
  const existing = campaign.stageMastery ? campaign.stageMastery[stageId] : undefined
  if (existing) {
    const cleared = Boolean(existing.cleared) || campaign.clearedStageIds.includes(stageId)
    const noKo = Boolean(existing.noKo)
    const underPar = Boolean(existing.underPar)
    const stars = toMasteryStars(cleared, noKo, underPar)
    return existing.bestTurns !== undefined && Number.isFinite(existing.bestTurns) && existing.bestTurns > 0
      ? { stars, cleared, noKo, underPar, bestTurns: Math.floor(existing.bestTurns) }
      : { stars, cleared, noKo, underPar }
  }
  if (campaign.clearedStageIds.includes(stageId)) {
    return { stars: 1, cleared: true, noKo: false, underPar: false }
  }
  return createEmptyStageMasteryRecord()
}

/** Return the 3 tactical mastery objectives for a stage along with their completion flags. */
export function getStageMasteryObjectives(
  chapter: ChapterSpec,
  record?: StageMasteryRecord | null
): readonly StageMasteryObjectiveSpec[] {
  const turnPar = getStageMasteryTurnLimit(chapter)
  const isDefend = chapter.objective?.kind === 'defend'
  const protectLabel = chapter.objective?.protectLabel ?? 'Ward'
  return [
    {
      id: 'clear',
      label: 'Clear stage',
      detail: `Achieve victory on ${chapter.title}`,
      completed: Boolean(record?.cleared)
    },
    {
      id: 'no_ko',
      label: 'Zero Hero KOs',
      detail: 'Finish with no fallen or downed allies',
      completed: Boolean(record?.noKo)
    },
    {
      id: 'turn_par',
      label: isDefend ? `Hold intact <= ${turnPar}T` : `Win in <= ${turnPar} turns`,
      detail: isDefend
        ? `Keep ${protectLabel} unbreached within ${turnPar} turns`
        : `Win in ${turnPar} player turns or fewer`,
      completed: Boolean(record?.underPar)
    }
  ]
}

/** Maximum mastery stars earnable across all playable chapters (33 * 3 = 99). */
export function getMaxMasteryStars(): number {
  return PLAYABLE_CHAPTERS.length * MAX_STAGE_MASTERY_STARS
}

/** Total mastery stars earned across all playable chapters in the campaign. */
export function getTotalMasteryStars(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'stageMastery'>
): number {
  let total = 0
  for (let i = 0; i < PLAYABLE_CHAPTERS.length; i++) {
    const stageId = PLAYABLE_CHAPTERS[i].id
    total += getStageMasteryRecord(campaign, stageId).stars
  }
  return total
}

/** Count how many playable stages have been perfected to 3★. */
export function getThreeStarStageCount(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'stageMastery'>
): number {
  let count = 0
  for (let i = 0; i < PLAYABLE_CHAPTERS.length; i++) {
    const stageId = PLAYABLE_CHAPTERS[i].id
    if (getStageMasteryRecord(campaign, stageId).stars === 3) count += 1
  }
  return count
}

export function hasClaimedStageMasteryChest(
  campaign: Pick<CampaignState, 'claimedStageMasteryChests'>,
  stageId: string
): boolean {
  return Array.isArray(campaign.claimedStageMasteryChests) && campaign.claimedStageMasteryChests.includes(stageId)
}

export function canClaimStageMasteryChest(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'stageMastery' | 'claimedStageMasteryChests'>,
  stageId: string
): boolean {
  const chapter = CHAPTER_BY_ID[stageId]
  if (!chapter || chapter.comingSoon) return false
  if (hasClaimedStageMasteryChest(campaign, stageId)) return false
  return getStageMasteryRecord(campaign, stageId).stars === 3
}

/** Claim the one-time 3-star Mastery Chest for `stageId`, granting Gold + Arcane Dust + Hero Shards. */
export function claimStageMasteryChest(state: GameState, stageId: string): StageMasteryChestClaimResult {
  const chapter = CHAPTER_BY_ID[stageId]
  if (!chapter || chapter.comingSoon) {
    return { ok: false, stageId, gold: 0, dust: 0, shards: 0, reason: 'Unknown stage' }
  }
  const { campaign } = state
  if (hasClaimedStageMasteryChest(campaign, stageId)) {
    return { ok: false, stageId, gold: 0, dust: 0, shards: 0, reason: '3★ Mastery Chest already claimed' }
  }
  const record = getStageMasteryRecord(campaign, stageId)
  if (record.stars < 3) {
    return { ok: false, stageId, gold: 0, dust: 0, shards: 0, reason: 'Earn all 3 stars on this stage first' }
  }

  const reward = getStageMasteryChestReward(chapter)
  campaign.gold += reward.gold
  campaign.dust += reward.dust
  campaign.shards += reward.shards
  if (!Array.isArray(campaign.claimedStageMasteryChests)) {
    campaign.claimedStageMasteryChests = []
  }
  campaign.claimedStageMasteryChests.push(stageId)
  state.sounds.push({ kind: 'coin', pitch: 1.18 })
  return {
    ok: true,
    stageId,
    gold: reward.gold,
    dust: reward.dust,
    shards: reward.shards
  }
}

export function getMasteryMilestoneSpec(threshold: number): MasteryMilestoneSpec | undefined {
  for (let i = 0; i < MASTERY_MILESTONES.length; i++) {
    if (MASTERY_MILESTONES[i].threshold === threshold) return MASTERY_MILESTONES[i]
  }
  return undefined
}

export function hasClaimedMasteryMilestone(
  campaign: Pick<CampaignState, 'claimedMasteryMilestones'>,
  threshold: number
): boolean {
  return Array.isArray(campaign.claimedMasteryMilestones) && campaign.claimedMasteryMilestones.includes(threshold)
}

export function canClaimMasteryMilestone(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'stageMastery' | 'claimedMasteryMilestones'>,
  threshold: number
): boolean {
  const spec = getMasteryMilestoneSpec(threshold)
  if (!spec) return false
  if (hasClaimedMasteryMilestone(campaign, threshold)) return false
  return getTotalMasteryStars(campaign) >= threshold
}

export function getClaimableMasteryMilestones(
  campaign: Pick<CampaignState, 'clearedStageIds' | 'stageMastery' | 'claimedMasteryMilestones'>
): readonly MasteryMilestoneSpec[] {
  const total = getTotalMasteryStars(campaign)
  const out: MasteryMilestoneSpec[] = []
  for (let i = 0; i < MASTERY_MILESTONES.length; i++) {
    const m = MASTERY_MILESTONES[i]
    if (total >= m.threshold && !hasClaimedMasteryMilestone(campaign, m.threshold)) {
      out.push(m)
    }
  }
  return out
}

export function getNextMasteryMilestone(
  campaign: Pick<CampaignState, 'claimedMasteryMilestones'>
): MasteryMilestoneSpec | null {
  for (let i = 0; i < MASTERY_MILESTONES.length; i++) {
    const m = MASTERY_MILESTONES[i]
    if (!hasClaimedMasteryMilestone(campaign, m.threshold)) return m
  }
  return null
}

/** Claim a continent-wide star milestone chest (e.g. 15★, 30★, 50★, 75★, 99★). */
export function claimMasteryMilestone(state: GameState, threshold: number): MasteryMilestoneClaimResult {
  const spec = getMasteryMilestoneSpec(threshold)
  if (!spec) {
    return { ok: false, threshold, title: '', gold: 0, dust: 0, shards: 0, reason: 'Invalid mastery milestone' }
  }
  const { campaign } = state
  if (hasClaimedMasteryMilestone(campaign, threshold)) {
    return { ok: false, threshold, title: spec.title, gold: 0, dust: 0, shards: 0, reason: 'Milestone already claimed' }
  }
  const total = getTotalMasteryStars(campaign)
  if (total < threshold) {
    return {
      ok: false,
      threshold,
      title: spec.title,
      gold: 0,
      dust: 0,
      shards: 0,
      reason: `Need ${threshold}★ across Solis (${total}/${threshold}★)`
    }
  }

  campaign.gold += spec.gold
  campaign.dust += spec.dust
  campaign.shards += spec.shards
  if (!Array.isArray(campaign.claimedMasteryMilestones)) {
    campaign.claimedMasteryMilestones = []
  }
  campaign.claimedMasteryMilestones.push(threshold)
  campaign.claimedMasteryMilestones.sort((a, b) => a - b)
  state.sounds.push({ kind: 'coin', pitch: 1.25 })
  return {
    ok: true,
    threshold,
    title: spec.title,
    gold: spec.gold,
    dust: spec.dust,
    shards: spec.shards
  }
}

/**
 * Evaluate and persist 3-star stage mastery for a victorious campaign battle.
 * Merges newly earned objectives incrementally with any prior runs on the same stage.
 */
export function evaluateAndRecordBattleMastery(
  campaign: CampaignState,
  battle: BattleState,
  chapter: ChapterSpec
): BattleMasteryEvaluation {
  const stageId = chapter.id
  const prevTotalStars = getTotalMasteryStars(campaign)
  const prevRecord = getStageMasteryRecord(campaign, stageId)
  const prevStars = prevRecord.stars

  const turnPar = getStageMasteryTurnLimit(chapter)
  const turnsTaken = getBattleTurnsTaken(battle)
  const heroKoCount = getBattleHeroKoCount(battle)

  const clearedThisRun = true
  const noKoThisRun = didFinishWithZeroHeroKos(battle)
  const defendIntact = chapter.objective?.kind !== 'defend' || !battle.objective.protectBreached
  const underParThisRun = turnsTaken <= turnPar && defendIntact
  const starsEarnedThisRun = toMasteryStars(clearedThisRun, noKoThisRun, underParThisRun)

  const mergedCleared = true
  const mergedNoKo = prevRecord.noKo || noKoThisRun
  const mergedUnderPar = prevRecord.underPar || underParThisRun
  const mergedStars = toMasteryStars(mergedCleared, mergedNoKo, mergedUnderPar)
  const bestTurns = prevRecord.bestTurns !== undefined
    ? Math.min(prevRecord.bestTurns, turnsTaken)
    : turnsTaken

  if (!campaign.stageMastery) {
    campaign.stageMastery = {}
  }
  campaign.stageMastery[stageId] = {
    stars: mergedStars,
    cleared: mergedCleared,
    noKo: mergedNoKo,
    underPar: mergedUnderPar,
    bestTurns
  }

  const nextTotalStars = getTotalMasteryStars(campaign)
  const newlyUnlockedMilestones: number[] = []
  for (let i = 0; i < MASTERY_MILESTONES.length; i++) {
    const threshold = MASTERY_MILESTONES[i].threshold
    if (
      prevTotalStars < threshold &&
      nextTotalStars >= threshold &&
      !hasClaimedMasteryMilestone(campaign, threshold)
    ) {
      newlyUnlockedMilestones.push(threshold)
    }
  }

  const chestClaimable = canClaimStageMasteryChest(campaign, stageId)
  const chestUnlockedNow = prevStars < 3 && mergedStars === 3 && chestClaimable

  return {
    stageId,
    starsEarnedThisRun,
    prevStars,
    totalStars: mergedStars,
    newlyEarnedStars: Math.max(0, mergedStars - prevStars),
    cleared: clearedThisRun,
    noKo: noKoThisRun,
    underPar: underParThisRun,
    turnsTaken,
    turnPar,
    heroKoCount,
    chestUnlockedNow,
    chestClaimable,
    newlyUnlockedMilestones
  }
}

/**
 * Sanitize persisted `stageMastery` from save data, enforcing valid playable stage IDs
 * and automatically backfilling 1★ for legacy saves' already-cleared stages.
 */
export function sanitizeStageMastery(
  raw: unknown,
  clearedStageIds: readonly string[]
): Record<string, StageMasteryRecord> {
  const out: Record<string, StageMasteryRecord> = {}
  const clearedSet = new Set<string>(clearedStageIds)

  if (isPlainRecord(raw)) {
    const keys = Object.keys(raw)
    for (let i = 0; i < keys.length; i++) {
      const stageId = keys[i]
      const chapter = CHAPTER_BY_ID[stageId]
      if (!chapter || chapter.comingSoon) continue
      const entry = raw[stageId]
      if (!isPlainRecord(entry)) continue
      const rawCleared = entry.cleared === true || clearedSet.has(stageId) || (typeof entry.stars === 'number' && entry.stars >= 1)
      if (!rawCleared) continue
      const noKo = entry.noKo === true
      const underPar = entry.underPar === true
      const stars = toMasteryStars(rawCleared, noKo, underPar)
      const bestTurns = typeof entry.bestTurns === 'number' && Number.isFinite(entry.bestTurns) && entry.bestTurns > 0
        ? Math.floor(entry.bestTurns)
        : undefined
      out[stageId] = bestTurns !== undefined
        ? { stars, cleared: true, noKo, underPar, bestTurns }
        : { stars, cleared: true, noKo, underPar }
    }
  }

  // Legacy save compatibility: ensure every already-cleared playable stage has at least 1★
  for (let i = 0; i < clearedStageIds.length; i++) {
    const stageId = clearedStageIds[i]
    const chapter = CHAPTER_BY_ID[stageId]
    if (!chapter || chapter.comingSoon) continue
    if (!out[stageId]) {
      out[stageId] = {
        stars: 1,
        cleared: true,
        noKo: false,
        underPar: false
      }
    }
  }

  return out
}

/** Sanitize persisted `claimedStageMasteryChests` list. */
export function sanitizeClaimedStageMasteryChests(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item !== 'string') continue
    const chapter = CHAPTER_BY_ID[item]
    if (!chapter || chapter.comingSoon) continue
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

/** Sanitize persisted `claimedMasteryMilestones` list, keeping only valid milestone thresholds sorted ascending. */
export function sanitizeClaimedMasteryMilestones(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item !== 'number' || !Number.isFinite(item)) continue
    const t = Math.floor(item)
    if (!getMasteryMilestoneSpec(t)) continue
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  out.sort((a, b) => a - b)
  return out
}
