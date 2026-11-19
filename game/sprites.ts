import type { PlayerSnapshot } from './simulation.ts'
import { createSpriteAtlas } from '../framework/index.ts'

export async function createSprites(canvas: HTMLCanvasElement, reducedMotion?: MediaQueryList) {
  const atlas = await createSpriteAtlas(canvas, {
    src: '/game/assets/sprites.png', frameWidth: 40, frameHeight: 48
  })
  return {
    begin: atlas.begin,
    scout(player: PlayerSnapshot, point: readonly [number, number], scale: number, now: number, local: boolean) {
      const time = reducedMotion?.matches ? 0 : now
      const pose = player.finished ? 0 :
        !player.grounded ? (player.vy < -30 ? 6 : 7) :
        player.moving ? 2 + Math.floor(time / 83) % 4 : Math.floor(time / 650) % 2
      if (local) atlas.marker(point, { offset: scale * .96, size: .008, minimumSize: 3, fill: '#f7ffe5' })
      atlas.draw(pose, player.slot, point, { height: scale, flip: player.facing < 0 })
    },
    signal(point: readonly [number, number], now: number) {
      const pose = reducedMotion?.matches ? 0 : Math.floor(now / 140) % 4
      atlas.draw(pose, 8, point, { height: .064 })
    }
  }
}
