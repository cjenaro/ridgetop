import type { Course } from './level.ts'
import type { Player } from './simulation.ts'
import { WIDTH } from './level.ts'
import { PLAYER_WIDTH, PLAYER_HEIGHT } from './simulation.ts'

type PlayerTransition = { before: Player; after: Player }

function samePlayer(before: Player, after: Player): boolean {
  const afterValues = new Map<string, unknown>(Object.entries(after))
  for (const [key, value] of Object.entries(before)) {
    if (!Object.is(value, afterValues.get(key))) return false
  }
  return true
}

export function platformerRules(course: Course) {
  const { beacon } = course
  const allCrystals = (1 << course.crystals.length) - 1
  return [
    { id: 'position-in-bounds', test: ({ after: p }: PlayerTransition) =>
      Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vy) &&
      p.x >= 0 && p.x <= WIDTH - PLAYER_WIDTH },
    { id: 'crystals-stay-collected', test: ({ before, after }: PlayerTransition) =>
      (after.crystals & before.crystals) === before.crystals },
    { id: 'checkpoint-requires-three-crystals', test: ({ after: p }: PlayerTransition) =>
      p.checkpoint === ((p.crystals & 7) === 7) },
    { id: 'grounded-player-has-support', test: ({ after: p }: PlayerTransition) =>
      !p.grounded || (p.vy === 0 && course.platforms.some(platform =>
        p.x < platform.x + platform.w && p.x + PLAYER_WIDTH > platform.x &&
        p.y + PLAYER_HEIGHT === platform.y)) },
    { id: 'finish-requires-crystals-and-beacon', test: ({ after: p }: PlayerTransition) =>
      !p.finished || (p.crystals === allCrystals && p.x < beacon.x + beacon.w &&
        p.x + PLAYER_WIDTH > beacon.x && p.y < beacon.y + beacon.h &&
        p.y + PLAYER_HEIGHT > beacon.y) },
    { id: 'finished-run-is-frozen', test: ({ before, after }: PlayerTransition) =>
      !before.finished || samePlayer(before, after) },
    { id: 'respawn-preserves-collected-items', test: ({ before, after }: PlayerTransition) => {
      if (after.falls === before.falls) return true
      const spawn = before.checkpoint ? course.checkpoint : course.spawn
      return after.falls === before.falls + 1 && after.x === spawn.x && after.y === spawn.y &&
        after.crystals === before.crystals && after.signal === before.signal
    } }
  ]
}
