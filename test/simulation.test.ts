import test from 'node:test'
import assert from 'node:assert/strict'
import { STEP } from '../framework/loop.ts'
import { createPlayer, EMPTY_INPUT, restartPlayer, stepPlayer } from '../game/simulation.ts'
import { courses, SPAWN } from '../game/level.ts'
import { courseRoute } from '../tools/course-route.ts'

for (const course of Object.values(courses)) {
  test(course.name + ' can be completed with its signal chip and no falls', () => {
    const { player } = courseRoute(course, { collectSignal: true })
    const other = createPlayer('two', 1, course)
    assert.equal(player.falls, 0)
    assert.equal(player.checkpoint, true)
    assert.equal(player.signal, true)
    assert.equal(other.crystals, 0)
    const finish = player.ticks
    stepPlayer(player, EMPTY_INPUT, STEP, course)
    assert.equal(player.ticks, finish)
  })
}

test('falling preserves crystals and uses the activated checkpoint', () => {
  const course = courses.ridge
  for (const checkpoint of [false, true]) {
    const player = createPlayer('one')
    player.x = 200
    player.crystals = checkpoint ? 7 : 1
    player.checkpoint = checkpoint
    player.signal = true
    for (let index = 0; index < 120 && !player.falls; index++) stepPlayer(player, EMPTY_INPUT, STEP)
    assert.equal(player.falls, 1)
    assert.equal(player.x, checkpoint ? course.checkpoint.x : SPAWN.x)
    assert.equal(player.crystals, checkpoint ? 7 : 1)
    assert.equal(player.signal, true)
    const reset = restartPlayer(player, { ...EMPTY_INPUT, jump: 2 })
    assert.equal(reset.checkpoint, false)
    assert.equal(reset.crystals, 0)
    assert.equal(reset.signal, false)
    assert.equal(reset.revision, player.revision + 1)
    assert.equal(reset.jump, 2)
  }
})

test('red contacts respawn the player, and a launch pad gives an extra boost', () => {
  const spikes = courses.storm.spikes[0]
  const victim = { ...createPlayer('one', 0, courses.storm), x: spikes.x, y: spikes.y - 22 }
  stepPlayer(victim, EMPTY_INPUT, STEP, courses.storm)
  assert.equal(victim.falls, 1)
  assert.equal(victim.x, courses.storm.spawn.x)

  const pad = courses.foundry.pads[0]
  const scout = {
    ...createPlayer('one', 0, courses.foundry), x: pad.x, y: pad.y - 32, grounded: true
  }
  stepPlayer(scout, { ...EMPTY_INPUT, jump: 1 }, STEP, courses.foundry)
  assert.ok(scout.vy < -600)
})
