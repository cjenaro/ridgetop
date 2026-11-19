import type { RoomInput } from '../framework/index.ts'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { STEP, verifyTrace } from '../framework/index.ts'
import { courses } from '../game/level.ts'
import { platformerRules } from '../game/rules.ts'
import { createPlayer, DEFAULT_JUMP_TIMING, EMPTY_INPUT, stepPlayer } from '../game/simulation.ts'

const jump = { ...EMPTY_INPUT, jump: 1 }
const right = { ...EMPTY_INPUT, right: true }
const intentProbes = {
  edge: [0, 2, 3, 4], landing: [1, 3, 4, 5]
}
const staleProbes = { edge: [5, 7], landing: [6, 8] }
const tuning = [
  { course: 'ridge', fall: 30, vy: 0, intent: intentProbes, stale: staleProbes },
  { course: 'ruins', fall: 60, vy: 60, intent: intentProbes, stale: staleProbes }
]
const holdout = [
  { course: 'storm', fall: 38, vy: 110,
    intent: { edge: [1, 4], landing: [2, 5] }, stale: { edge: [5, 9], landing: [6, 10] } },
  { course: 'lastlight', fall: 78, vy: -45,
    intent: { edge: [3, 4], landing: [1, 5] }, stale: { edge: [5, 11], landing: [6, 11] } }
]

function reach(player, advance, input, condition) {
  for (let tick = 0; tick < 180; tick++) {
    if (condition(player)) return tick
    advance(player, input)
  }
  throw new Error('Timing probe could not reach its starting state')
}

function measure(scenarios, timing) {
  const samples = []
  for (const scenario of scenarios) {
    const course = courses[scenario.course]
    const advance = (player, input) => stepPlayer(player, input, STEP, course, timing)
    const edge = createPlayer('edge', 0, course)
    reach(edge, advance, EMPTY_INPUT, player => player.grounded)
    reach(edge, advance, right, player => !player.grounded)
    const fallStart = createPlayer('landing', 0, course)
    fallStart.y -= scenario.fall
    fallStart.vy = scenario.vy
    const landingTick = reach(structuredClone(fallStart), advance, EMPTY_INPUT, player => player.grounded)
    for (const [expected, offsets] of [[true, scenario.intent], [false, scenario.stale]]) {
      for (const kind of ['edge', 'landing']) {
        for (const offset of offsets[kind]) {
          const player = structuredClone(kind === 'edge' ? edge : fallStart)
          const delay = kind === 'edge' ? offset : landingTick - offset - 1
          if (delay < 0) throw new Error('Landing probe starts too close to its impact tick')
          for (let tick = 0; tick < delay; tick++) advance(player, EMPTY_INPUT)
          advance(player, jump)
          let fired = player.vy < -300
          if (kind === 'landing') {
            for (let tick = 0; tick <= offset; tick++) {
              advance(player, jump)
              fired ||= player.vy < -300
            }
          }
          samples.push({ course: scenario.course, kind, offset, expected, fired })
        }
      }
    }
  }
  return {
    intentional: samples.filter(sample => sample.expected && sample.fired).length,
    intentionalTotal: samples.filter(sample => sample.expected).length,
    accidental: samples.filter(sample => !sample.expected && sample.fired).length,
    samples
  }
}

function verifyCourses(routes, timing) {
  return Object.entries(courses).map(([id, course]) => {
    const actions: RoomInput[] = routes[id].flatMap(segment => Array(segment.frames).fill({
      left: segment.left, right: segment.right, jump: segment.jump
    }))
    const result = verifyTrace({
      initial: createPlayer('tuning', 0, course),
      step: (player, action) => stepPlayer(player, action, STEP, course, timing),
      actions, checks: platformerRules(course),
      goal: { id: 'course-still-clears', test: ({ after }) => after.finished && after.signal && after.falls === 0 }
    })
    return { course: id, status: result.status, rule: result.status === 'fail' ? result.rule : undefined }
  })
}

export async function tuneJumps(baselineTiming = DEFAULT_JUMP_TIMING) {
  const routes = JSON.parse(await readFile(new URL('../game/verification-routes.json', import.meta.url), 'utf8'))
  const baseline: { timing: typeof DEFAULT_JUMP_TIMING; tuning: ReturnType<typeof measure>; holdout?: ReturnType<typeof measure> } = {
    timing: baselineTiming, tuning: measure(tuning, baselineTiming)
  }
  const candidates = []
  for (const coyoteTicks of [4, 5, 6, 7]) {
    for (const bufferTicks of [5, 6, 7, 8]) {
      const timing = { coyoteTicks, bufferTicks }
      const result = measure(tuning, timing)
      const eligible = result.accidental === 0 && !regressed(baseline.tuning, result)
      candidates.push({ timing, intentional: result.intentional, accidental: result.accidental, eligible })
    }
  }
  const selected = candidates.filter(candidate => candidate.eligible && candidate.intentional > baseline.tuning.intentional)
    .sort((a, b) => b.intentional - a.intentional || distance(a.timing, baselineTiming) - distance(b.timing, baselineTiming))[0]
  if (!selected) return { status: 'keep-baseline', baseline, candidates }

  // Choose once using the tuning probes. The holdout can veto this candidate.
  baseline.holdout = measure(holdout, baseline.timing)
  const proposal = {
    timing: selected.timing,
    holdout: measure(holdout, selected.timing),
    courses: verifyCourses(routes, selected.timing)
  }
  const approved = proposal.holdout.accidental === 0 &&
    proposal.holdout.intentional > baseline.holdout.intentional &&
    !regressed(baseline.holdout, proposal.holdout) &&
    proposal.courses.every(course => course.status === 'pass')
  return { status: approved ? 'candidate-passes' : 'keep-baseline', baseline, proposal, candidates }
}

function distance(timing, baseline) {
  return Math.abs(timing.coyoteTicks - baseline.coyoteTicks) +
    Math.abs(timing.bufferTicks - baseline.bufferTicks)
}

function regressed(before, after) {
  return before.samples.some((sample, index) =>
    sample.fired === sample.expected && after.samples[index].fired !== sample.expected)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await tuneJumps(), null, 2))
}
