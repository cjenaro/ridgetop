import type { Course, CourseId } from '../examples/beacon-run/game/level.ts'
import type { Player } from '../examples/beacon-run/game/simulation.ts'
import type { CourseRouteAction } from './course-route.ts'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { evaluateDecisions, STEP, verifyBounded, verifyTrace } from 'ridgetop'
import { courses } from '../examples/beacon-run/game/level.ts'
import { platformerRules } from '../examples/beacon-run/game/rules.ts'
import { createPlayer, stepPlayer } from '../examples/beacon-run/game/simulation.ts'
import { createDecisionApi, resolveDecisionEnv } from 'ridgetop/server'

type StepAction = { left: boolean; right: boolean; jump: boolean }

const alphabet: StepAction[] = [false, true].flatMap(jump => [
  { left: false, right: false, jump },
  { left: true, right: false, jump },
  { left: false, right: true, jump },
  { left: true, right: true, jump }
])
const depth = 4
const checkpointMoves: Record<CourseId, number> = { ridge: 19, ruins: 25, summit: 23, storm: 18, foundry: 15, lastlight: 22 }
const goals = {
  'course-witness-finishes-with-chip-and-no-falls': {
    id: 'course-witness-finishes-with-chip-and-no-falls',
    test: ({ after }: { after: Player }) => after.finished && after.signal && after.falls === 0
  },
  'checkpoint-run-reaches-respawn': {
    id: 'checkpoint-run-reaches-respawn', test: ({ after }: { after: Player }) => after.falls > 0 && after.checkpoint
  }
}
type GoalId = keyof typeof goals
const files = [
  'packages/ridgetop/framework/index.ts', 'packages/ridgetop/framework/server.ts', 'packages/ridgetop/framework/loop.ts',
  'packages/ridgetop/framework/platformer.ts', 'packages/ridgetop/framework/verification.ts',
  'examples/beacon-run/game/level.ts', 'examples/beacon-run/game/simulation.ts',
  'examples/beacon-run/game/rules.ts', 'examples/beacon-run/game/verification-routes.json', 'tools/verify-game.ts',
  'packages/ridgetop/framework/decision-api.ts', 'packages/ridgetop/framework/decision-providers.ts'
]

function stepFor(course: Course) {
  return (player: Player, action: StepAction) => stepPlayer(player, {
    left: action.left, right: action.right, jump: player.jump + Number(action.jump)
  }, STEP, course)
}

function unpack(segments: readonly CourseRouteAction[]): StepAction[] {
  let jump = 0
  const actions: StepAction[] = []
  for (const segment of segments) {
    for (let frame = 0; frame < segment.frames; frame++) {
      actions.push({ left: segment.left, right: segment.right, jump: frame === 0 && jump !== segment.jump })
    }
    jump = segment.jump
  }
  return actions
}

function encodeFailure<R extends { status: string; rule?: string; actions?: readonly StepAction[] }>(
  course: CourseId,
  seed: string,
  initial: Player,
  result: R
) {
  if (result.status !== 'fail') return result
  const rule = result.rule ?? ''
  const goal = Object.hasOwn(goals, rule) ? rule : undefined
  return { ...result, replay: { course, seed, initial, actions: result.actions, goal } }
}

const labels = ['completed', 'respawned', 'in-progress']
const rubric = 'Label the run completed if finish is true. Otherwise use respawned if falls is positive. Use in-progress in all other cases. Cite finish for completed and both finish and falls for other labels.'

function observe(initial: Player, step: ReturnType<typeof stepFor>, actions: typeof alphabet) {
  const result = verifyTrace({ initial, step, actions, checks: [] })
  if (result.status !== 'pass') throw new Error('Could not replay observation')
  return result.final
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCourseId(id: string): id is CourseId {
  return Object.hasOwn(courses, id)
}

function isGoalId(id: string): id is GoalId {
  return Object.hasOwn(goals, id)
}

function isStepAction(value: unknown): value is StepAction {
  return isRecord(value) &&
    typeof value.left === 'boolean' &&
    typeof value.right === 'boolean' &&
    typeof value.jump === 'boolean'
}

function isCourseRouteAction(value: unknown): value is CourseRouteAction {
  return isRecord(value) &&
    typeof value.left === 'boolean' &&
    typeof value.right === 'boolean' &&
    typeof value.jump === 'number' &&
    typeof value.frames === 'number'
}

function isPlayer(value: unknown): value is Player {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.slot === 'number' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.vy === 'number' &&
    typeof value.grounded === 'boolean' &&
    typeof value.facing === 'number' &&
    typeof value.moving === 'boolean' &&
    typeof value.crystals === 'number' &&
    typeof value.falls === 'number' &&
    typeof value.finished === 'boolean' &&
    typeof value.jump === 'number' &&
    typeof value.ticks === 'number' &&
    typeof value.started === 'boolean' &&
    typeof value.checkpoint === 'boolean' &&
    typeof value.signal === 'boolean' &&
    typeof value.coyote === 'number' &&
    typeof value.buffer === 'number' &&
    typeof value.revision === 'number'
}

function parseRoutes(raw: unknown): Record<CourseId, CourseRouteAction[]> {
  if (!isRecord(raw)) throw new TypeError('Expected verification routes object')
  const readCourse = (id: CourseId): CourseRouteAction[] => {
    const entry = raw[id]
    if (!Array.isArray(entry) || !entry.every(isCourseRouteAction)) {
      throw new TypeError('Invalid verification route for course ' + id)
    }
    return entry
  }
  return {
    ridge: readCourse('ridge'),
    ruins: readCourse('ruins'),
    summit: readCourse('summit'),
    storm: readCourse('storm'),
    foundry: readCourse('foundry'),
    lastlight: readCourse('lastlight')
  }
}

async function certify(api?: ReturnType<typeof createDecisionApi>) {
  const [routeBytes, provenance] = await Promise.all([
    readFile(new URL('../examples/beacon-run/game/verification-routes.json', import.meta.url)),
    Promise.all(files.map(async path => {
      const bytes = await readFile(new URL('../' + path, import.meta.url))
      return [path, createHash('sha256').update(bytes).digest('hex')] as const
    }))
  ])
  const routes = parseRoutes(JSON.parse(routeBytes.toString('utf8')))
  const reports = []
  const finishedStates: { id: CourseId; state: Player }[] = []
  for (const id of Object.keys(courses).filter(isCourseId)) {
    const course = courses[id]
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
  function decideLocally({ evidence }: { evidence: readonly { id: string; value: unknown }[] }) {
    const finish = Boolean(evidence.find(item => item.id === 'finish')?.value)
    const falls = Number(evidence.find(item => item.id === 'falls')?.value ?? 0)
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

async function replay(path: string) {
  const fixture: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(fixture) || typeof fixture.course !== 'string' || !isCourseId(fixture.course) ||
      !Array.isArray(fixture.actions) || !fixture.actions.every(isStepAction)) {
    throw new TypeError('Expected a course ID and replay actions with Boolean left, right and jump')
  }
  const courseId: CourseId = fixture.course
  const course = courses[courseId]
  let initial: Player
  if (fixture.initial === undefined) {
    initial = createPlayer('verification', 0, course)
  } else if (isPlayer(fixture.initial)) {
    initial = fixture.initial
  } else {
    throw new TypeError('Invalid replay initial player state')
  }
  const checks = platformerRules(course)
  let goal
  if (fixture.goal !== undefined) {
    if (typeof fixture.goal !== 'string' || !isGoalId(fixture.goal)) {
      throw new TypeError('Unknown replay goal')
    }
    goal = goals[fixture.goal]
  }
  return { course: courseId, ...verifyTrace({ initial, step: stepFor(course), actions: fixture.actions, checks, goal }) }
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
    const rawProvider = process.env.RIDGETOP_DECISION_PROVIDER
    let requested: 'http' | 'openai' | 'clef' | 'jev' | 'typesafe' | undefined
    if (rawProvider !== undefined) {
      if (rawProvider !== 'http' && rawProvider !== 'openai' && rawProvider !== 'clef' && rawProvider !== 'jev' && rawProvider !== 'typesafe') {
        throw new Error('Unknown decision provider. Choose http, openai, clef, jev, or typesafe')
      }
      requested = rawProvider
    }
    const resolved = resolveDecisionEnv(process.env, new URL('../', import.meta.url), requested)
    api = createDecisionApi({
      provider: resolved.provider,
      endpoint: resolved.provider === 'http' ? resolved.endpoint : undefined,
      token: resolved.token,
      accountId: resolved.accountId,
      model: resolved.model,
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
