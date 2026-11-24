import type { Course, CourseId } from './level.ts'
import type { PlayerSnapshot } from './simulation.ts'
import { courses } from './level.ts'

export interface CampaignLevelRecord {
  ticks: number
  medal: number
  signal: boolean
}

export interface CampaignProgress {
  levels: Partial<Record<CourseId, CampaignLevelRecord>>
  sound: boolean
}

function isCourseId(id: string): id is CourseId {
  return Object.hasOwn(courses, id)
}

export const ROUTE: readonly CourseId[] = Object.freeze(Object.keys(courses).filter(isCourseId))
export const SAVE_KEY = 'ridgetop.campaign.v1'

export function loadCampaign(storage?: Pick<Storage, 'getItem'> | null): CampaignProgress {
  const levels: Partial<Record<CourseId, CampaignLevelRecord>> = {}
  let sound = true
  try {
    const raw = storage?.getItem(SAVE_KEY)
    const saved = raw ? JSON.parse(raw) : null
    for (const id of ROUTE) {
      const entry = saved?.levels?.[id]
      if (entry && Number.isSafeInteger(entry.ticks) && entry.ticks > 0 &&
          Number.isInteger(entry.medal) && entry.medal >= 1 && entry.medal <= 3) {
        levels[id] = { ticks: entry.ticks, medal: entry.medal, signal: entry.signal === true }
      }
    }
    sound = saved?.sound !== false
  } catch { /* The session remains playable when storage is unavailable. */ }
  return { levels, sound }
}

export function saveCampaign(storage: Pick<Storage, 'setItem'> | null | undefined, progress: CampaignProgress) {
  try { storage?.setItem(SAVE_KEY, JSON.stringify(progress)) }
  catch { /* In-memory progress remains available. */ }
}

export function medal(course: Pick<Course, 'par'>, player: Pick<PlayerSnapshot, 'falls' | 'ticks'>) {
  if (player.falls === 0 && player.ticks <= course.par * 60) return 3
  return player.falls <= 2 ? 2 : 1
}

export function recordRelay(
  progress: CampaignProgress,
  id: string,
  player: { finished: false } | Pick<PlayerSnapshot, 'finished' | 'ticks' | 'signal' | 'falls'>
) {
  if (!player.finished || !isCourseId(id)) return
  const previous = progress.levels[id]
  progress.levels[id] = {
    ticks: Math.min(previous?.ticks ?? Infinity, player.ticks),
    signal: Boolean(previous?.signal || player.signal),
    medal: Math.max(previous?.medal ?? 0, medal(courses[id], player))
  }
}

export function campaignSummary(progress: CampaignProgress) {
  let cleared = 0
  let signals = 0
  let gold = 0
  let ticks = 0
  let next: CourseId | undefined
  for (const id of ROUTE) {
    const record = progress.levels[id]
    if (!record) {
      next ??= id
      continue
    }
    cleared++
    signals += Number(record.signal)
    gold += Number(record.medal === 3)
    ticks += record.ticks
  }
  return { cleared, signals, gold, ticks, next, complete: next === undefined }
}
