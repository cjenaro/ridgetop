import type { Player } from '../examples/beacon-run/game/simulation.ts'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { evaluateDecisions, STEP, verifyBounded, verifyTrace } from 'ridgetop'
import { courses } from '../examples/beacon-run/game/level.ts'
import { platformerRules } from '../examples/beacon-run/game/rules.ts'
import { createPlayer, stepPlayer } from '../examples/beacon-run/game/simulation.ts'
import { createDecisionApi } from 'ridgetop/server'

const alphabet = [false, true].flatMap(jump => [
  { left: false, right: false, jump },
  { left: true, right: false, jump },
  { left: false, right: true, jump },
  { left: true, right: true, jump }
])
const depth = 4
const checkpointMoves = { ridge: 19, ruins: 25, summit: 23, storm: 18, foundry: 15, lastlight: 22 }
const goals = {
  'course-witness-finishes-with-chip-and-no-falls': {
    id: 'course-witness-finishes-with-chip-and-no-falls',
    test: ({ after }) => after.finished && after.signal && after.falls === 0
  },
  'checkpoint-run-reaches-respawn': {
    id: 'checkpoint-run-reaches-respawn', test: ({ after }) => after.falls > 0 && after.checkpoint
  }
}
const files = [
  'packages/ridgetop/framework/index.ts', 'packages/ridgetop/framework/server.ts', 'packages/ridgetop/framework/loop.ts',
  'packages/ridgetop/framework/platformer.ts', 'packages/ridgetop/framework/verification.ts',
  'examples/beacon-run/game/level.ts', 'examples/beacon-run/game/simulation.ts',
  'examples/beacon-run/game/rules.ts', 'examples/beacon-run/game/verification-routes.json', 'tools/verify-game.ts',
  'packages/ridgetop/framework/decision-api.ts', 'packages/ridgetop/framework/decision-providers.ts'
]

function stepFor(course) {
  return (player, action) => stepPlayer(player, {
    left: action.left, right: action.right, jump: player.jump + Number(action.jump)
  }, STEP, course)
}

function unpack(segments) {
  let jump = 0
  const actions = []
  for (const segment of segments) {
    for (let frame = 0; frame < segment.frames; frame++) {
      actions.push({ left: segment.left, right: segment.right, jump: frame === 0 && jump !== segment.jump })
    }
    jump = segment.jump
  }
  return actions
}

function encodeFailure(course, seed, initial, result) {
  if (result.status !== 'fail') return result
  const goal = Object.hasOwn(goals, result.rule) ? result.rule : undefined
  return { ...result, replay: { course, seed, initial, actions: result.actions, goal } }
}

const labels = ['completed', 'respawned', 'in-progress']
const rubric = 'Label the run completed if finish is true. Otherwise use respawned if falls is positive. Use in-progress in all other cases. Cite finish for completed and both finish and falls for other labels.'

function observe(initial: Player, step: ReturnType<typeof stepFor>, actions: typeof alphabet) {
  const result = verifyTrace({ initial, step, actions, checks: [] })
  if (result.status !== 'pass') throw new Error('Could not replay observation')
  return result.final
}

async function certify(api) {
  const [routeBytes, provenance] = await Promise.all([
    readFile(new URL('../examples/beacon-run/game/verification-routes.json', import.meta.url)),
    Promise.all(files.map(async path => {
      const bytes = await readFile(new URL('../' + path, import.meta.url))
      return [path, createHash('sha256').update(bytes).digest('hex')]
    }))
  ])
  const routes = JSON.parse(routeBytes.toString('utf8'))
  const reports = []
  const finishedStates = []
  for (const [id, course] of Object.entries(courses)) {
    const spawn = createPlayer('verification', 0, course)
    const checks = platformerRules(course)
    const step = stepFor(course)
    const seeds: Record<string, Player> = { spawn }
    const witness = verifyTrace({
      initial: spawn, checks, actions: unpack(routes[id]),
      step(player, action) {
        const before = structuredClone(player)
        step(player, action)
        if (!before.checkpoint && player.checkpoint) seeds.checkpoint = structuredClone(player)
        if (!before.finished && player.finished) {
          seeds['before-finish'] = before
          seeds.finished = structuredClone(player)
        }
      },
      goal: goals['course-witness-finishes-with-chip-and-no-falls']
    })
    if (witness.status === 'pass') finishedStates.push({ id, state: witness.final })
    let recovery
    if (seeds.checkpoint) {
      // Walk into the gap past the checkpoint island, then release movement.
      const actions = Array(checkpointMoves[id]).fill(alphabet[2]).concat(Array(90).fill(alphabet[0]))
      recovery = verifyTrace({
        initial: seeds.checkpoint, checks, actions,
        goal: goals['checkpoint-run-reaches-respawn'],
        step(player, action) {
          const before = structuredClone(player)
          step(player, action)
          if (!seeds['before-respawn'] && player.falls > before.falls) seeds['before-respawn'] = before
        }
      })
    }
    const bounded = Object.entries(seeds).map(([seed, initial]) => ({
      seed, ...encodeFailure(id, seed, initial, verifyBounded({ initial, step, alphabet, depth, checks }))
    }))
    reports.push({
      course: id,
      checks: checks.map(check => check.id),
      witness: encodeFailure(id, 'spawn', spawn, witness),
      recovery: recovery && encodeFailure(id, 'checkpoint', seeds.checkpoint, recovery),
      bounded
    })
  }

  const ridge = courses.ridge
  const initial = createPlayer('verification', 0, ridge)
  const observations = [
    ...finishedStates.map(({ id, state }) => ({ id: id + '-complete', state, expected: 'completed' })),
    { id: 'ridge-missed-jump', expected: 'respawned',
      state: observe(initial, stepFor(ridge), Array(135).fill(alphabet[2])) },
    { id: 'ridge-idle', expected: 'in-progress',
      state: observe(initial, stepFor(ridge), Array(15).fill(alphabet[0])) }
  ]
  const cases = observations.map(({ id, state, expected }) => ({
    id, input: null,
    evidence: [{ id: 'finish', value: state.finished }, { id: 'falls', value: state.falls }],
    expected: { label: expected, evidence: expected === 'completed' ? ['finish'] : ['finish', 'falls'] }
  }))
  function decideLocally({ evidence }) {
    const finish = evidence.find(item => item.id === 'finish').value
    const falls = evidence.find(item => item.id === 'falls').value
    if (finish) return { label: 'completed', evidence: ['finish'] }
    if (falls > 0) return { label: 'respawned', evidence: ['finish', 'falls'] }
    return { label: 'in-progress', evidence: ['finish', 'falls'] }
  }
  const decisions = await evaluateDecisions({ labels, cases, decide: api?.decide ?? decideLocally })
  const passed = reports.every(item => item.witness.status === 'pass' && item.recovery?.status === 'pass' &&
    item.bounded.length === 5 && item.bounded.every(check => check.status === 'pass')) && decisions.passed === decisions.total
  return {
    format: 'ridgetop-verification@1', status: passed ? 'pass' : 'fail',
    node: process.version, stepSeconds: STEP, alphabet, depth,
    sources: Object.fromEntries(provenance), courses: reports,
    decisions: {
      adapter: api?.provider ?? 'local-reference',
      model: api?.model,
      ...decisions,
      requests: api?.report()
    }
  }
}

async function replay(path) {
  const fixture = JSON.parse(await readFile(path, 'utf8'))
  if (!Object.hasOwn(courses, fixture.course) || !Array.isArray(fixture.actions) ||
      fixture.actions.some(action => !action || typeof action.left !== 'boolean' ||
        typeof action.right !== 'boolean' || typeof action.jump !== 'boolean')) {
    throw new TypeError('Expected a course ID and replay actions with Boolean left, right and jump')
  }
  const course = courses[fixture.course]
  const initial = fixture.initial ?? createPlayer('verification', 0, course)
  const checks = platformerRules(course)
  if (fixture.goal !== undefined && !Object.hasOwn(goals, fixture.goal)) {
    throw new TypeError('Unknown replay goal')
  }
  const goal = fixture.goal === undefined ? undefined : goals[fixture.goal]
  return { course: fixture.course, ...verifyTrace({ initial, step: stepFor(course), actions: fixture.actions, checks, goal }) }
}

try {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const remote = args.includes('--decision-api')
  const positional = args.filter(arg => arg !== '--json' && arg !== '--decision-api')
  if (positional.length && (remote || positional.length !== 2 || positional[0] !== '--replay')) {
    throw new Error('Usage: node tools/verify-game.js [--json] [--decision-api | --replay file.json]')
  }
  let api
  if (remote) {
    const provider = process.env.RIDGETOP_DECISION_PROVIDER ?? 'http'
    if (provider !== 'http' && provider !== 'openai' && provider !== 'clef' && provider !== 'jev') {
      throw new Error('Unknown decision provider. Choose http, openai, clef, or jev')
    }
    api = createDecisionApi({
      provider,
      endpoint: provider === 'http' ? process.env.RIDGETOP_DECISION_URL : undefined,
      token: process.env.RIDGETOP_DECISION_TOKEN,
      accountId: process.env.RIDGETOP_DECISION_ACCOUNT_ID, model: process.env.RIDGETOP_DECISION_MODEL,
      labels, rubric,
      maxRequests: Number(process.env.RIDGETOP_DECISION_MAX_REQUESTS ?? 3)
    })
  }
  const report = positional.length ? await replay(positional[1]) : await certify(api)
  if (json || !('courses' in report) || report.status !== 'pass') {
    console.log(JSON.stringify(report, null, 2))
  } else {
    const checks = report.courses.flatMap(course => course.bounded)
    console.log(report.courses.length + ' course witnesses and checkpoint recovery replays passed')
    console.log(checks.length + ' bounded runs passed across ' +
      checks.reduce((count, result) => count + result.transitions, 0).toLocaleString('en-US') + ' transitions')
    const { passed, total, requests } = report.decisions
    console.log(passed + ' / ' + total + (api ? ' API' : ' reference') + ' decisions passed')
    if (requests) console.log(requests.attempted + ' HTTP requests, ' + requests.reused + ' reused decisions')
  }
  if (report.status !== 'pass') process.exitCode = 1
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (process.argv.includes('--json')) console.log(JSON.stringify({ status: 'error', message }))
  else console.error(message)
  process.exitCode = 1
}
