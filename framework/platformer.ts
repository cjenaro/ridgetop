import type { PlatformerBody, RoomInput } from './types.ts'
type Surface = { x: number; y: number; w: number }

export function createPlatformer({ worldWidth, bodyWidth, bodyHeight, speed, gravity, jumpSpeed, boostSpeed = jumpSpeed }: {
  worldWidth: number; bodyWidth: number; bodyHeight: number; speed: number; gravity: number; jumpSpeed: number; boostSpeed?: number
}) {
  return function move(player: PlatformerBody, input: RoomInput, dt: number,
    { platforms, pads = [] }: { platforms: readonly Surface[]; pads?: readonly Surface[] },
    timing: { coyoteTicks: number; bufferTicks: number }) {
    const direction = Number(input.right) - Number(input.left)
    const pressed = input.jump !== player.jump
    player.moving = direction !== 0
    if (direction) player.facing = direction
    player.x = Math.max(0, Math.min(worldWidth - bodyWidth, player.x + direction * speed * dt))

    player.jump = input.jump
    player.buffer = pressed ? timing.bufferTicks : Math.max(0, player.buffer - 1)
    player.coyote = player.grounded ? timing.coyoteTicks : Math.max(0, player.coyote - 1)
    if (player.buffer && player.coyote) {
      const onPad = pads.some(pad => player.grounded && player.y + bodyHeight === pad.y &&
        player.x + bodyWidth > pad.x && player.x < pad.x + pad.w)
      player.vy = onPad ? -boostSpeed : -jumpSpeed
      player.coyote = player.buffer = 0
    }

    const oldFeet = player.y + bodyHeight
    player.vy += gravity * dt
    player.y += player.vy * dt
    player.grounded = false
    // Compare swept feet with each top. Pick the first top crossed in world space.
    let landing = Infinity
    for (const platform of platforms) {
      if (player.vy >= 0 && oldFeet <= platform.y && player.y + bodyHeight >= platform.y &&
          player.x < platform.x + platform.w && player.x + bodyWidth > platform.x) {
        landing = Math.min(landing, platform.y)
      }
    }
    if (landing !== Infinity) {
      player.y = landing - bodyHeight
      player.vy = 0
      player.grounded = true
    }

    return pressed
  }
}
