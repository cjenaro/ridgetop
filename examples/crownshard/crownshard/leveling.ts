import type { HeroClassId, OwnedHeroCard } from './types.ts'

export const MAX_HERO_LEVEL = 20

export const XP_ACTION_DAMAGE = 8
export const XP_ACTION_KO = 22
export const XP_ACTION_BOSS_KO = 40
export const XP_ACTION_SUPPORT = 10
export const XP_ACTION_REVIVE = 20
export const XP_VICTORY_BASE = 30
export const XP_VICTORY_PER_DIFFICULTY = 10
export const XP_VICTORY_SURVIVAL_BONUS = 15
export const XP_MERGE_TRANSFER_RATIO = 0.25

export interface HeroLevelProgress {
  readonly level: number
  readonly xp: number
  readonly xpForNext: number
  readonly xpToNext: number
  readonly ratio: number
  readonly isMaxLevel: boolean
}

export interface LevelStatBonuses {
  readonly hp: number
  readonly atk: number
  readonly def: number
  readonly speed: number
  readonly crit: number
}

export interface GrantHeroXpResult {
  readonly levelsGained: number
  readonly oldLevel: number
  readonly newLevel: number
  readonly xpGained: number
  readonly xpOverflow: number
}

interface HeroGrowthCurve {
  readonly hpPerLevel: number
  readonly atkPerLevel: number
  readonly defPerLevel: number
  readonly critPerMilestone: number
}

const HERO_GROWTH: Record<HeroClassId, HeroGrowthCurve> = {
  knight: { hpPerLevel: 5.0, atkPerLevel: 1.1, defPerLevel: 0.45, critPerMilestone: 0.015 },
  archer: { hpPerLevel: 3.5, atkPerLevel: 1.3, defPerLevel: 0.30, critPerMilestone: 0.025 },
  mage: { hpPerLevel: 3.2, atkPerLevel: 1.4, defPerLevel: 0.28, critPerMilestone: 0.020 },
  cleric: { hpPerLevel: 4.2, atkPerLevel: 1.15, defPerLevel: 0.38, critPerMilestone: 0.015 },
  rogue: { hpPerLevel: 3.8, atkPerLevel: 1.4, defPerLevel: 0.30, critPerMilestone: 0.025 },
  paladin: { hpPerLevel: 5.5, atkPerLevel: 1.2, defPerLevel: 0.50, critPerMilestone: 0.015 },
  cryomancer: { hpPerLevel: 3.6, atkPerLevel: 1.45, defPerLevel: 0.32, critPerMilestone: 0.020 },
  champion: { hpPerLevel: 5.5, atkPerLevel: 1.45, defPerLevel: 0.50, critPerMilestone: 0.020 }
}

/** Normalize a raw/optional hero level into the valid `[1, MAX_HERO_LEVEL]` integer range. */
export function normalizeHeroLevel(level: number | undefined): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return 1
  const n = Math.floor(level)
  if (n < 1) return 1
  if (n > MAX_HERO_LEVEL) return MAX_HERO_LEVEL
  return n
}

/** Normalize a hero's XP within its current level (always 0 at `MAX_HERO_LEVEL`). */
export function normalizeHeroXp(level: number, xp: number | undefined): number {
  const normLevel = normalizeHeroLevel(level)
  if (normLevel >= MAX_HERO_LEVEL) return 0
  if (typeof xp !== 'number' || !Number.isFinite(xp) || xp <= 0) return 0
  return Math.floor(xp)
}

/**
 * XP required to advance from `level` to `level + 1`.
 * Returns `0` once `level >= MAX_HERO_LEVEL`.
 */
export function xpRequiredForLevel(level: number): number {
  const norm = normalizeHeroLevel(level)
  if (norm >= MAX_HERO_LEVEL) return 0
  const d = norm - 1
  return 40 + d * 25 + Math.floor(d * d * 4)
}

/** Total cumulative XP invested in a hero at `(level, xp)` from Level 1 / 0 XP. */
export function totalXpForLevel(level: number | undefined, xp: number | undefined = 0): number {
  const normLevel = normalizeHeroLevel(level)
  const normXp = normalizeHeroXp(normLevel, xp)
  let sum = 0
  for (let l = 1; l < normLevel; l++) {
    sum += xpRequiredForLevel(l)
  }
  return sum + normXp
}

/** Progress snapshot for UI meters and summaries. */
export function heroLevelProgress(level: number | undefined, xp: number | undefined): HeroLevelProgress {
  const normLevel = normalizeHeroLevel(level)
  if (normLevel >= MAX_HERO_LEVEL) {
    return {
      level: MAX_HERO_LEVEL,
      xp: 0,
      xpForNext: 0,
      xpToNext: 0,
      ratio: 1,
      isMaxLevel: true
    }
  }
  const xpForNext = xpRequiredForLevel(normLevel)
  const rawXp = normalizeHeroXp(normLevel, xp)
  const clampedXp = rawXp > xpForNext ? xpForNext : rawXp
  const xpToNext = xpForNext - clampedXp
  const ratio = xpForNext > 0 ? Math.min(1, clampedXp / xpForNext) : 1
  return {
    level: normLevel,
    xp: clampedXp,
    xpForNext,
    xpToNext,
    ratio,
    isMaxLevel: false
  }
}

/**
 * Incremental per-level stat bonuses for a hero class from Level 1 to Level 20.
 * At Level 1 all bonuses are strictly 0 to preserve baseline stat parity.
 * Milestones at Levels 5, 10, 15, and 20 grant additional SPD and CRIT nudges.
 */
export function levelStatBonuses(heroId: HeroClassId, level: number | undefined): LevelStatBonuses {
  const norm = normalizeHeroLevel(level)
  if (norm <= 1) {
    return { hp: 0, atk: 0, def: 0, speed: 0, crit: 0 }
  }
  const growth = HERO_GROWTH[heroId]
  const d = norm - 1
  const milestones = Math.floor(norm / 5)
  return {
    hp: Math.round(d * growth.hpPerLevel),
    atk: Math.floor(d * growth.atkPerLevel),
    def: Math.floor(d * growth.defPerLevel),
    speed: milestones,
    crit: Math.round(milestones * growth.critPerMilestone * 1000) / 1000
  }
}

/**
 * Award XP to an owned hero card in-place, resolving single or multi-level-ups,
 * preserving overflow XP into the new level, and capping cleanly at `MAX_HERO_LEVEL`.
 */
export function grantHeroXp(hero: OwnedHeroCard, amount: number): GrantHeroXpResult {
  const oldLevel = normalizeHeroLevel(hero.level)
  let level = oldLevel
  let xp = normalizeHeroXp(level, hero.xp)

  const rawGain = typeof amount === 'number' && Number.isFinite(amount) && amount > 0
    ? Math.floor(amount)
    : 0

  if (oldLevel >= MAX_HERO_LEVEL || rawGain <= 0) {
    hero.level = level
    hero.xp = level >= MAX_HERO_LEVEL ? 0 : xp
    return {
      levelsGained: 0,
      oldLevel,
      newLevel: level,
      xpGained: 0,
      xpOverflow: hero.xp
    }
  }

  let xpRemainingToMax = 0
  for (let l = level; l < MAX_HERO_LEVEL; l++) {
    xpRemainingToMax += xpRequiredForLevel(l)
  }
  xpRemainingToMax = Math.max(0, xpRemainingToMax - xp)
  const applied = Math.min(rawGain, xpRemainingToMax)

  xp += applied
  while (level < MAX_HERO_LEVEL) {
    const req = xpRequiredForLevel(level)
    if (req <= 0 || xp < req) break
    xp -= req
    level += 1
  }

  if (level >= MAX_HERO_LEVEL) {
    level = MAX_HERO_LEVEL
    xp = 0
  }

  hero.level = level
  hero.xp = xp
  return {
    levelsGained: level - oldLevel,
    oldLevel,
    newLevel: level,
    xpGained: applied,
    xpOverflow: xp
  }
}

/**
 * Victory completion XP bonus granted to every deployed hero.
 * Downed heroes still receive the base + difficulty XP; surviving heroes earn an extra survival bonus.
 */
export function victoryXpBonus(difficulty: number, endlessWave = 0, survived = true): number {
  const diff = Number.isFinite(difficulty) ? Math.max(1, Math.floor(difficulty)) : 1
  const wave = Number.isFinite(endlessWave) && endlessWave > 0 ? Math.min(10, Math.floor(endlessWave)) : 0
  const base = XP_VICTORY_BASE + diff * XP_VICTORY_PER_DIFFICULTY + wave * 10
  return survived ? base + XP_VICTORY_SURVIVAL_BONUS : base
}
