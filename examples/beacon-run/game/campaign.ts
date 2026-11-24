import { courses } from './level.ts'

export const ROUTE = Object.freeze(Object.keys(courses))
export const SAVE_KEY = 'ridgetop.campaign.v1'

export function loadCampaign(storage) {
  const levels = {}
  let sound = true
  try {
    const saved = JSON.parse(storage.getItem(SAVE_KEY))
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

export function saveCampaign(storage, progress) {
  try { storage.setItem(SAVE_KEY, JSON.stringify(progress)) }
  catch { /* In-memory progress remains available. */ }
}

export function medal(course, player) {
  if (player.falls === 0 && player.ticks <= course.par * 60) return 3
  return player.falls <= 2 ? 2 : 1
}

export function recordRelay(progress, id, player) {
  if (!player.finished || !Object.hasOwn(courses, id)) return
  const previous = progress.levels[id]
  progress.levels[id] = {
    ticks: Math.min(previous?.ticks ?? Infinity, player.ticks),
    signal: Boolean(previous?.signal || player.signal),
    medal: Math.max(previous?.medal ?? 0, medal(courses[id], player))
  }
}

export function campaignSummary(progress) {
  let cleared = 0
  let signals = 0
  let gold = 0
  let ticks = 0
  let next
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
