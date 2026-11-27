import type { Decision, DecisionUsage } from './types.ts'

export type DecisionProviderName = 'http' | 'openai' | 'clef' | 'jev' | 'typesafe'

export interface DecisionRequestContext<L extends string = string> {
  labels: readonly L[]
  rubric: string
  criteria?: Readonly<Record<string, string>>
  checkForBug?: boolean
  bugRubric?: string
  input: unknown
  evidence: readonly { id: string; [key: string]: unknown }[]
}

export interface DecodedDecisionDetails<L extends string = string> extends Decision<L> {
  readonly confidence?: number
  readonly probabilities?: Readonly<Record<string, number>>
  readonly evidenceProbabilities?: Readonly<Record<string, number>>
  readonly bugProbability?: number
  readonly bugSuspected?: boolean
  readonly model?: string
  readonly usage?: DecisionUsage
}

interface ClassificationQuestion {
  name: string
  type: 'choice' | 'predicate'
  instructions: string
  labels?: readonly string[]
  criteria?: Readonly<Record<string, string>>
}

interface ProviderAnswer {
  name?: unknown
  type?: unknown
  choice?: unknown
  confidence?: unknown
  probabilities?: unknown
  probability?: unknown
  noul?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDecisionProviderName(name: string): name is DecisionProviderName {
  return Object.hasOwn(providers, name)
}

interface DecisionProviderAdapter {
  model?: string
  endpoint(model?: string, accountId?: string): string
  encode<L extends string>(request: DecisionRequestContext<L>, model?: string): unknown
  decode<L extends string>(response: unknown, request: DecisionRequestContext<L>): Decision<L>
  decodeDetailed<L extends string>(response: unknown, request: DecisionRequestContext<L>): DecodedDecisionDetails<L>
}

const DEFAULT_BUG_RUBRIC =
  'Based on the current game state, recent actions, and last action outcome, did something unexpected, broken, soft-locked, unresponsive, or buggy happen?'

function classificationQuestions({ labels, rubric, criteria, checkForBug, bugRubric, evidence }: DecisionRequestContext): ClassificationQuestion[] {
  const list: ClassificationQuestion[] = [
    { name: 'label', type: 'choice', instructions: rubric, labels, criteria },
    ...evidence.map(({ id }, index): ClassificationQuestion => ({
      name: 'evidence_' + index, type: 'predicate',
      instructions: rubric + '\nIs the evidence item with ID ' + JSON.stringify(id) +
        ' needed to justify the classification under this rubric?'
    }))
  ]
  if (checkForBug) {
    list.push({
      name: 'bug_suspected',
      type: 'predicate',
      instructions: bugRubric || DEFAULT_BUG_RUBRIC
    })
  }
  return list
}

function extractProbabilities(raw: unknown): Readonly<Record<string, number>> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, number> = {}
  let count = 0
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value
      count++
    }
  }
  return count > 0 ? out : undefined
}

function extractUsage(raw: unknown): DecisionUsage | undefined {
  if (!isRecord(raw)) return undefined
  const inputTokens = typeof raw.input_tokens === 'number'
    ? raw.input_tokens
    : typeof raw.inputTokens === 'number' ? raw.inputTokens : undefined
  const outputTokens = typeof raw.output_tokens === 'number'
    ? raw.output_tokens
    : typeof raw.outputTokens === 'number' ? raw.outputTokens : undefined
  if (inputTokens === undefined && outputTokens === undefined) return undefined
  return { inputTokens, outputTokens }
}

function normalizeDetailed<L extends string>(
  getAnswer: (name: string) => ProviderAnswer | undefined,
  request: DecisionRequestContext<L>,
  predicateType: string,
  probabilityKey: 'probability' | 'noul',
  meta?: { model?: string; usage?: DecisionUsage }
): DecodedDecisionDetails<L> {
  const classification = getAnswer('label')
  const choice = classification?.choice
  const matchedLabel = typeof choice === 'string' ? request.labels.find(label => label === choice) : undefined
  if (classification?.type !== 'choice' || matchedLabel === undefined) {
    throw new Error('Decision provider did not return an allowed label')
  }
  const evidenceProbabilities: Record<string, number> = {}
  const evidence = request.evidence.filter((item, index) => {
    const answer = getAnswer('evidence_' + index)
    const probability = answer?.[probabilityKey]
    if (answer?.type !== predicateType || typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('Decision provider did not return a valid evidence judgment')
    }
    evidenceProbabilities[item.id] = probability
    return probability > 0.5
  }).map(item => item.id)

  const confidence = typeof classification.confidence === 'number' && Number.isFinite(classification.confidence)
    ? classification.confidence
    : undefined
  const probabilities = extractProbabilities(classification.probabilities)

  let bugProbability: number | undefined
  if (request.checkForBug) {
    const bugAnswer = getAnswer('bug_suspected')
    const rawProb = bugAnswer?.[probabilityKey]
    if (typeof rawProb === 'number' && Number.isFinite(rawProb) && rawProb >= 0 && rawProb <= 1) {
      bugProbability = rawProb
    }
  }

  return {
    label: matchedLabel,
    evidence,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(probabilities ? { probabilities } : {}),
    ...(request.evidence.length > 0 ? { evidenceProbabilities } : {}),
    ...(bugProbability !== undefined ? { bugProbability, bugSuspected: bugProbability >= 0.5 } : {}),
    ...(meta?.model ? { model: meta.model } : {}),
    ...(meta?.usage ? { usage: meta.usage } : {})
  }
}

function toBasicDecision<L extends string>(detailed: DecodedDecisionDetails<L>): Decision<L> {
  return { label: detailed.label, evidence: detailed.evidence }
}

const openai: DecisionProviderAdapter = {
  model: 'gpt-6-luna',
  endpoint: () => 'https://api.openai.com/v1/decisions',
  encode(request, model) {
    const questions = classificationQuestions(request).map(({ labels, criteria, ...question }) =>
      labels
        ? {
            ...question,
            choices: labels.map(value => criteria?.[value] ? { value, description: criteria[value] } : { value })
          }
        : question)
    const data = { input: request.input, evidence: request.evidence }
    return { model, input: [{ role: 'user', content: [{ type: 'input_json', data }] }], questions }
  },
  decodeDetailed(response, request) {
    if (!isRecord(response) || !Array.isArray(response.answers)) {
      throw new Error('OpenAI Decisions returned no answers')
    }
    const answers = response.answers
    const model = typeof response.model === 'string' ? response.model : undefined
    const usage = extractUsage(response.usage)
    return normalizeDetailed(name => {
      const found = answers.find(item => isRecord(item) && item.name === name)
      const answer = isRecord(found) ? found : undefined
      if (answer?.type === 'refusal') throw new Error('OpenAI Decisions refused question ' + name)
      return answer
    }, request, 'predicate', 'probability', { model, usage })
  },
  decode(response, request) {
    return toBasicDecision(openai.decodeDetailed(response, request))
  }
}

function encodeSystemOne(request: DecisionRequestContext, model?: string) {
  const questions = classificationQuestions(request).map(({ name, labels, criteria, instructions }) => [
    name,
    labels
      ? {
          type: 'choice',
          instructions,
          criteria: Object.fromEntries(labels.map(label => [label, criteria?.[label] ?? label]))
        }
      : { type: 'noul', instructions }
  ])
  return { model, state: { input: request.input, evidence: request.evidence }, questions: Object.fromEntries(questions) }
}

function decodeSystemOneDetailed<L extends string>(response: unknown, request: DecisionRequestContext<L>): DecodedDecisionDetails<L> {
  const answers = isRecord(response) && isRecord(response.answers) ? response.answers : undefined
  const model = isRecord(response) && typeof response.model === 'string' ? response.model : undefined
  const usage = isRecord(response) ? extractUsage(response.usage) : undefined
  return normalizeDetailed(name => {
    const raw = answers?.[name]
    return isRecord(raw) ? raw : undefined
  }, request, 'noul', 'noul', { model, usage })
}

function decodeSystemOne<L extends string>(response: unknown, request: DecisionRequestContext<L>): Decision<L> {
  return toBasicDecision(decodeSystemOneDetailed(response, request))
}

const jevAdapter: DecisionProviderAdapter = {
  model: 'jev-latest',
  endpoint: () => 'https://api.typesafe.ai/v1/systemone',
  encode: encodeSystemOne,
  decode: decodeSystemOne,
  decodeDetailed: decodeSystemOneDetailed
}

const httpAdapter: DecisionProviderAdapter = {
  endpoint() { throw new Error('Set RIDGETOP_DECISION_URL to the decision endpoint') },
  encode: request => request,
  decodeDetailed<L extends string>(response: unknown, request: DecisionRequestContext<L>): DecodedDecisionDetails<L> {
    if (!isRecord(response)) {
      throw new Error('Decision provider did not return an allowed label')
    }
    const label = typeof response.label === 'string'
      ? request.labels.find(item => item === response.label)
      : undefined
    if (label === undefined || !Array.isArray(response.evidence)) {
      throw new Error('Decision provider did not return an allowed label')
    }
    const evidence: string[] = []
    for (const item of response.evidence) {
      if (typeof item !== 'string') {
        throw new Error('Decision provider did not return a valid evidence judgment')
      }
      evidence.push(item)
    }
    const confidence = typeof response.confidence === 'number' && Number.isFinite(response.confidence)
      ? response.confidence
      : undefined
    const probabilities = extractProbabilities(response.probabilities)
    const evidenceProbabilities = extractProbabilities(response.evidenceProbabilities)
    const model = typeof response.model === 'string' ? response.model : undefined
    const usage = extractUsage(response.usage)
    return {
      label,
      evidence,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(probabilities ? { probabilities } : {}),
      ...(evidenceProbabilities ? { evidenceProbabilities } : {}),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {})
    }
  },
  decode<L extends string>(response: unknown, request: DecisionRequestContext<L>): Decision<L> {
    return toBasicDecision(httpAdapter.decodeDetailed(response, request))
  }
}

const clefAdapter: DecisionProviderAdapter = {
  model: 'clef-flash',
  endpoint(model, accountId) {
    if (!accountId) throw new Error('Set RIDGETOP_DECISION_ACCOUNT_ID for Cloudflare Workers AI')
    return 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) +
      '/ai/run/@cf/cloudflare/' + encodeURIComponent(model ?? '')
  },
  encode: encodeSystemOne,
  decodeDetailed(response, request) {
    if (!isRecord(response) || response.success !== true) {
      throw new Error('Cloudflare Workers AI returned an unsuccessful result')
    }
    return decodeSystemOneDetailed(response.result, request)
  },
  decode(response, request) {
    return toBasicDecision(clefAdapter.decodeDetailed(response, request))
  }
}

const providers: Record<DecisionProviderName, DecisionProviderAdapter> = {
  http: httpAdapter,
  openai,
  jev: jevAdapter,
  typesafe: jevAdapter,
  clef: clefAdapter
}

export function selectDecisionProvider<L extends string = string>(
  name: string,
  { endpoint, model, accountId, labels }: {
    endpoint?: string | URL
    model?: string
    accountId?: string
    labels?: readonly L[]
  }
) {
  if (!isDecisionProviderName(name)) {
    throw new TypeError('Unknown decision provider. Choose http, openai, clef, jev, or typesafe')
  }
  const adapter = providers[name]
  model ??= adapter.model
  if (name !== 'http' && (!Array.isArray(labels) || labels.length < 2 || labels.length > 255)) {
    throw new RangeError('Native decision providers require 2 to 255 labels')
  }
  if (name === 'clef' && (!model || !['clef', 'clef-flash', 'clef-omni'].includes(model))) {
    throw new TypeError('Cloudflare model must be clef, clef-flash, or clef-omni')
  }
  return {
    endpoint: endpoint ?? adapter.endpoint(model, accountId),
    model,
    encode: (request: DecisionRequestContext<L>) => adapter.encode(request, model),
    decode: (response: unknown, request: DecisionRequestContext<L>) => adapter.decode(response, request),
    decodeDetailed: (response: unknown, request: DecisionRequestContext<L>) => adapter.decodeDetailed(response, request)
  }
}
