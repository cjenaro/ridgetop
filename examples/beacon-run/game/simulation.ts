import type { CharacterView } from './expedition.ts'
import type { RoomInput } from 'ridgetop'
import { createPlatformer } from 'ridgetop'
import { WIDTH, HEIGHT, courses } from './level.ts'

export type JumpTiming = { bufferTicks: number; coyoteTicks: number }
export const DEFAULT_JUMP_TIMING: Readonly<JumpTiming> = Object.freeze({ bufferTicks: 6, coyoteTicks: 5 })

export const PLAYER_WIDTH = 24
export const PLAYER_HEIGHT = 32
export const EMPTY_INPUT: Readonly<RoomInput> = Object.freeze({ left: false, right: false, jump: 0 })

const move = createPlatformer({
  worldWidth: WIDTH, bodyWidth: PLAYER_WIDTH, bodyHeight: PLAYER_HEIGHT,
  speed: 250, gravity: 1320, jumpSpeed: 535, boostSpeed: 690
})

export function createPlayer(id: string, slot = 0, course = courses.ridge) {
  return {
    id, slot, ...course.spawn, vy: 0, grounded: false, facing: 1, moving: false,
    crystals: 0, falls: 0, finished: false, jump: 0, ticks: 0, started: false,
    checkpoint: false, signal: false, coyote: 0, buffer: 0, revision: 0
  }
}

export type Player = ReturnType<typeof createPlayer>
export type PlayerSnapshot = Pick<Player,
  'id' | 'slot' | 'x' | 'y' | 'vy' | 'grounded' | 'moving' | 'facing' | 'crystals' |
  'falls' | 'finished' | 'ticks' | 'signal' | 'checkpoint' | 'revision'
> & { character?: CharacterView }

export function restartPlayer(player: Player, input: RoomInput, course = courses.ridge) {
  return {
    ...createPlayer(player.id, player.slot, course),
    jump: input.jump, revision: player.revision + 1
  }
}

export function stepPlayer(player: Player, input: RoomInput, dt: number, course = courses.ridge, timing = DEFAULT_JUMP_TIMING) {
  if (player.finished) return
  const pressed = move(player, input, dt, course, timing)
  if (pressed || player.moving) player.started = true
  if (player.started) player.ticks++

  const hitSpikes = course.spikes.some(spikes =>
    player.x + PLAYER_WIDTH - 3 > spikes.x && player.x + 3 < spikes.x + spikes.w &&
    player.y + PLAYER_HEIGHT > spikes.y && player.y + 4 < spikes.y + spikes.h)
  if (hitSpikes || player.y > HEIGHT + 40) {
    const spawn = player.checkpoint ? course.checkpoint : course.spawn
    Object.assign(player, spawn, {
      vy: 0, grounded: false, moving: false, coyote: 0, buffer: 0, falls: player.falls + 1
    })
    return
  }

  const { crystals, beacon, signal } = course
  if (Math.abs(player.x + PLAYER_WIDTH / 2 - signal.x) < 17 &&
      Math.abs(player.y + PLAYER_HEIGHT / 2 - signal.y) < 19) player.signal = true
  for (let index = 0; index < crystals.length; index++) {
    const crystal = crystals[index]
    if (Math.abs(player.x + PLAYER_WIDTH / 2 - crystal.x) < 23 &&
        Math.abs(player.y + PLAYER_HEIGHT / 2 - crystal.y) < 25) player.crystals |= 1 << index
  }
  if ((player.crystals & 7) === 7) player.checkpoint = true
  if (player.crystals === (1 << crystals.length) - 1 &&
      player.x < beacon.x + beacon.w && player.x + PLAYER_WIDTH > beacon.x &&
      player.y < beacon.y + beacon.h && player.y + PLAYER_HEIGHT > beacon.y) {
    player.finished = true
    player.moving = false
  }
}
