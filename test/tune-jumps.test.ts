import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_JUMP_TIMING } from '../examples/beacon-run/game/simulation.ts'
import { tuneJumps } from '../tools/tune-jumps.ts'

test('jump tuning improves held-out intent while preserving stale-input and course checks', async () => {
  const current = structuredClone(DEFAULT_JUMP_TIMING)
  const earlierTiming = { coyoteTicks: 5, bufferTicks: 6 }
  const result = await tuneJumps(earlierTiming)
  assert.equal(result.status, 'candidate-passes')
  assert.deepEqual(result.baseline.timing, earlierTiming)
  assert.ok(result.proposal)
  assert.ok(result.baseline.holdout)
  assert.ok(result.proposal.holdout.intentional > result.baseline.holdout.intentional)
  assert.equal(result.proposal.holdout.accidental, 0)
  assert.equal(result.proposal.courses.length, 6)
  assert.ok(result.proposal.courses.every(course => course.status === 'pass'))
  assert.deepEqual(DEFAULT_JUMP_TIMING, current)
})
