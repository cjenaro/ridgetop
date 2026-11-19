import type {
  Counterexample, Decision, DecisionInput, DecisionOutcome, VerificationCheck, VerificationFrame, VerificationModel
} from './types.ts'

function copy<T>(value: T): T {
  return structuredClone(value)
}

function validate<S, A>(checks: readonly VerificationCheck<S, A>[]) {
  const ids = new Set()
  for (const { id, test } of checks) {
    if (typeof id !== 'string' || !id || ids.has(id) || typeof test !== 'function') {
      throw new TypeError('Checks need unique IDs and a test function')
    }
    ids.add(id)
  }
}

function failed<S, A>(checks: readonly VerificationCheck<S, A>[], frame: VerificationFrame<S, A>) {
  return checks.find(check => check.test(frame) !== true)?.id
}

function advance<S, A>(step: VerificationModel<S, A>['step'], before: S, action: A): S {
  const draft = copy(before)
  const result = step(draft, copy(action))
  if (result && typeof (result as { then?: unknown }).then === 'function') throw new TypeError('Verification requires a synchronous step')
  return result === undefined ? draft : result as S
}

function violation<S, A>(rule: string, frame: VerificationFrame<S, A>, actions: readonly A[]): Counterexample<S, A> {
  return { status: 'fail', rule, frame, actions }
}

export function verifyTrace<S, A>({ initial, step, actions, checks, goal }: VerificationModel<S, A> & {
  actions: readonly A[]; goal?: VerificationCheck<S, A>
}): { status: 'pass'; ticks: number; final: S } | Counterexample<S,A> {
  validate(goal ? [...checks, goal] : checks)
  let after = copy(initial)
  const origin = { tick: 0, before: after, after }
  const initialRule = failed(checks, origin)
  if (initialRule) return violation(initialRule, origin, [])
  let frame: VerificationFrame<S, A> = origin
  for (let tick = 1; tick <= actions.length; tick++) {
    const action = copy(actions[tick - 1])
    const before = after
    after = advance(step, before, action)
    frame = { tick, before, after, action }
    const rule = failed(checks, frame)
    if (rule) return violation(rule, frame, actions.slice(0, tick))
  }
  if (goal && failed([goal], frame)) return violation(goal.id, frame, actions.slice())
  return { status: 'pass', ticks: frame.tick, final: after }
}

export function verifyBounded<S, A>({ initial, step, alphabet, checks, depth, maxTransitions = 100_000 }:
  VerificationModel<S, A> & { alphabet: readonly A[]; depth: number; maxTransitions?: number }
): ({ status: 'pass'; depth: number } | { status: 'inconclusive'; checkedDepth: number; depth: number } |
  Counterexample<S, A>) & { transitions: number } {
  validate(checks)
  if (!Number.isSafeInteger(depth) || depth < 0 || !alphabet.length ||
      !Number.isSafeInteger(maxTransitions) || maxTransitions < 0) {
    throw new RangeError('Expected a nonempty alphabet, nonnegative depth and finite transition budget')
  }
  const starting = copy(initial)
  const origin = { tick: 0, before: starting, after: starting }
  const initialRule = failed(checks, origin)
  if (initialRule) return { ...violation(initialRule, origin, []), transitions: 0 }
  if (!depth) return { status: 'pass', depth, transitions: 0 }

  let transitions = 0
  // Traverse in breadth-first order so the first failure has a shortest input sequence.
  type Node = { state: S; parent: Node | null; action?: A }
  let frontier: Node[] = [{ state: starting, parent: null }]
  for (let tick = 1; tick <= depth; tick++) {
    const next: Node[] = []
    for (const node of frontier) {
      for (const input of alphabet) {
        if (transitions === maxTransitions) {
          return { status: 'inconclusive', checkedDepth: tick - 1, depth, transitions }
        }
        const action = copy(input)
        const after = advance(step, node.state, action)
        transitions++
        const frame = { tick, before: node.state, after, action }
        const rule = failed(checks, frame)
        if (rule) {
          const actions = [action]
          for (let ancestor = node; ancestor.parent; ancestor = ancestor.parent) {
            actions.push(ancestor.action)
          }
          return { ...violation(rule, frame, actions.reverse()), transitions }
        }
        if (tick < depth) next.push({ state: after, parent: node, action })
      }
    }
    frontier = next
  }
  return { status: 'pass', depth, transitions }
}

/**
 * Each case holds its labeled answer separately from the input sent to the
 * classifier. Evidence IDs must refer to supplied evidence for that case.
 */
export async function evaluateDecisions<I, E, L extends string>({ labels, cases, decide }: {
  labels: readonly L[]
  cases: readonly (DecisionInput<I, E> & { expected: Decision<L> })[]
  decide(input: DecisionInput<I, E>): Decision<L> | Promise<Decision<L>>
}): Promise<{ passed: number; total: number; cases: DecisionOutcome<L>[] }> {
  const allowed = new Set(labels)
  if (!allowed.size || allowed.size !== labels.length ||
      labels.some(label => typeof label !== 'string' || !label)) {
    throw new TypeError('Expected unique decision labels')
  }
  const ids = new Set()
  for (const { id, evidence, expected } of cases) {
    const available = new Set(evidence.map(item => item.id))
    if (typeof id !== 'string' || !id || ids.has(id) || !allowed.has(expected.label) ||
        available.size !== evidence.length || [...available].some(key => typeof key !== 'string' || !key) ||
        !Array.isArray(expected.evidence) || expected.evidence.some(key => !available.has(key))) {
      throw new TypeError('Invalid decision case: ' + id)
    }
    ids.add(id)
  }
  const outcome: DecisionOutcome<L>[] = []
  for (const { id, input, evidence, expected } of cases) {
    const available = new Set(evidence.map(item => item.id))
    let decision: Decision<L>
    try {
      decision = await decide(copy({ id, input, evidence }))
    } catch (error) {
      outcome.push({ id, status: 'error', message: error instanceof Error ? error.message : String(error) })
      continue
    }

    if (!allowed.has(decision?.label) || !Array.isArray(decision.evidence) ||
        new Set(decision.evidence).size !== decision.evidence.length ||
        decision.evidence.some(key => !available.has(key))) {
      outcome.push({ id, status: 'invalid' })
      continue
    }
    const missingEvidence = expected.evidence.filter(key => !decision.evidence.includes(key))
    const status = decision.label === expected.label && !missingEvidence.length ? 'pass' : 'fail'
    outcome.push({ id, status, label: decision.label, expected: expected.label,
      evidence: decision.evidence.slice(), missingEvidence })
  }
  const passed = outcome.filter(item => item.status === 'pass').length
  return { passed, total: cases.length, cases: outcome }
}
