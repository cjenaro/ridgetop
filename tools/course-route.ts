import assert from 'node:assert/strict'
import { STEP } from 'ridgetop'
import { createPlayer, EMPTY_INPUT, stepPlayer } from '../examples/beacon-run/game/simulation.ts'

export function courseRoute(course, { collectSignal = false } = {}) {
  const player = createPlayer('one', 0, course)
  const input = { ...EMPTY_INPUT }
  const actions = []
  function until(condition) {
    let frames = 0
    while (frames < 180 && !condition()) {
      stepPlayer(player, input, STEP, course)
      frames++
    }
    assert.ok(condition(), JSON.stringify(player))
    if (frames) actions.push({ ...input, frames })
  }

  until(() => player.grounded)
  for (const [index, gem] of course.crystals.entries()) {
    input.right = true
    const edge = course.platforms[index].x + course.platforms[index].w - 27
    until(() => player.x >= edge)
    input.jump++
    until(() => player.x >= gem.x - 10)
    input.right = false
    until(() => player.grounded)
    assert.equal(player.crystals, (1 << (index + 1)) - 1)
    if (collectSignal && !player.signal && index + 1 === course.signal.platform) {
      const position = course.signal.x - 12
      if (player.x > position + 7) {
        input.left = true
        until(() => player.x <= position)
        input.left = false
      } else if (player.x < position - 7) {
        input.right = true
        until(() => player.x >= position)
        input.right = false
      }
      input.jump++
      until(() => !player.grounded)
      until(() => player.grounded)
      assert.equal(player.signal, true, course.name + ' signal chip is reachable')
    }
  }
  input.right = true
  until(() => player.finished)
  return { actions, player }
}
