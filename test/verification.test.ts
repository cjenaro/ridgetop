import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateDecisions, STEP, verifyBounded, verifyTrace } from '../packages/ridgetop/framework/index.ts'
import { courses } from '../examples/beacon-run/game/level.ts'
import { platformerRules } from '../examples/beacon-run/game/rules.ts'
import type { Player } from '../examples/beacon-run/game/simulation.ts'
import { createPlayer, stepPlayer } from '../examples/beacon-run/game/simulation.ts'

test('a forbidden finish produces the shortest replay with the failing rule and state', () => {
  const course = courses.ridge
  const initial = createPlayer('agent-test', 0, course)
  const model = {
    initial,
    step(player: Player, right: boolean) {
      stepPlayer(player, { left: false, right, jump: 0 }, STEP, course)
      if (right && player.grounded) player.finished = true
    },
    checks: platformerRules(course)
  }
  const bounded = verifyBounded({ ...model, alphabet: [false, true], depth: 15 })
  assert.equal(bounded.status, 'fail')
  assert.equal(bounded.rule, 'finish-requires-crystals-and-beacon')
  assert.ok(bounded.frame.tick > 1)
  assert.equal(bounded.actions.length, bounded.frame.tick)
  assert.equal(bounded.frame.after.crystals, 0)
  const replay = verifyTrace({ ...model, actions: bounded.actions })
  assert.equal(replay.status, 'fail')
  assert.equal(replay.rule, bounded.rule)
  assert.deepEqual(replay.frame, bounded.frame)
  assert.equal(initial.finished, false)
  assert.equal(initial.x, course.spawn.x)
})

test('bounded passes account for every input branch and budgets return inconclusive', () => {
  const model = {
    initial: { score: 0 },
    step(state: { score: number }, action: number) { state.score += action },
    checks: [{ id: 'nonnegative', test: ({ after }: { after: { score: number } }) => after.score >= 0 }],
    alphabet: [0, 1, 2], depth: 3
  }
  assert.deepEqual(verifyBounded(model), { status: 'pass', depth: 3, transitions: 39 })
  assert.deepEqual(verifyBounded({ ...model, maxTransitions: 6 }), {
    status: 'inconclusive', checkedDepth: 1, depth: 3, transitions: 6
  })
  const trace = verifyTrace({
    ...model, actions: [1, 2], goal: { id: 'score-target', test: ({ after }) => after.score === 4 }
  })
  assert.equal(trace.status, 'fail')
  assert.equal(trace.rule, 'score-target')
  assert.equal(trace.frame.after.score, 3)
})

test('classifier answers need the right label and valid supporting evidence', async () => {
  const fixture = { input: {}, evidence: [{ id: 'finish', value: true }],
    expected: { label: 'done', evidence: ['finish'] } }
  const report = await evaluateDecisions({
    labels: ['done', 'ongoing'],
    cases: ['correct', 'unsupported', 'fabricated', 'wrong', 'error'].map(id => ({ id, ...fixture })),
    async decide(observation) {
      assert.equal(Object.hasOwn(observation, 'expected'), false)
      switch (observation.id) {
        case 'correct': return { label: 'done', evidence: ['finish'] }
        case 'unsupported': return { label: 'done', evidence: [] }
        case 'fabricated': return { label: 'done', evidence: ['imaginary'] }
        case 'wrong': return { label: 'ongoing', evidence: ['finish'] }
        default: throw new Error('adapter failed')
      }
    }
  })
  assert.equal(report.passed, 1)
  assert.deepEqual(report.cases.map(item => item.status), ['pass', 'fail', 'invalid', 'fail', 'error'])
  const unsupported = report.cases[1]
  assert.equal(unsupported.status, 'fail')
  assert.deepEqual(unsupported.missingEvidence, ['finish'])
})
