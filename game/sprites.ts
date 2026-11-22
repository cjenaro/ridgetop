import type { PlayerSnapshot } from './simulation.ts'
import { createSpriteAtlas } from '../framework/index.ts'

export async function createSprites(canvas: HTMLCanvasElement, reducedMotion?: MediaQueryList) {
  const atlas = await createSpriteAtlas(canvas, '/game/assets/sprites.json')
  return {
    begin: atlas.begin,
    scout(player: PlayerSnapshot, point: readonly [number, number], scale: number, now: number, local: boolean) {
      const clip = player.finished ? 'idle' : !player.grounded ? (player.vy < -30 ? 'jump' : 'fall') :
        player.moving ? 'run' : 'idle'
      const time = player.finished || reducedMotion?.matches ? 0 : now
      if (local) atlas.marker(point, { offset: scale * .96, size: .008, minimumSize: 3, fill: '#f7ffe5' })
      atlas.drawClip(clip, time, point, { row: player.slot, height: scale, flip: player.facing < 0 })
    },
    signal(point: readonly [number, number], now: number) {
      atlas.drawClip('sparkle', reducedMotion?.matches ? 0 : now, point, { height: .064 })
    }
  }
}
