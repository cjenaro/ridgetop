import type { Decision } from './types.ts'

export type DecisionProviderName = 'http' | 'openai' | 'clef' | 'jev'

interface DecisionRequestContext<L extends string = string> {
  labels: readonly L[]
  rubric: string
  input: unknown
  evidence: readonly { id: string; [key: string]: unknown }[]
}

interface ClassificationQuestion {
  name: string
  type: 'choice' | 'predicate'
  instructions: string
  labels?: readonly string[]
}

interface ProviderAnswer {
  name?: string
  type?: string
  choice?: string
  probability?: number
  noul?: number
}

interface DecisionProviderAdapter {
  model?: string
  endpoint(model?: string, accountId?: string): string
  encode<L extends string>(request: DecisionRequestContext<L>, model?: string): unknown
  decode<L extends string>(response: unknown, request: DecisionRequestContext<L>): Decision<L>
}

function classificationQuestions({ labels, rubric, evidence }: DecisionRequestContext): ClassificationQuestion[] {
  return [
    { name: 'label', type: 'choice', instructions: rubric, labels },
    ...evidence.map(({ id }, index): ClassificationQuestion => ({
      name: 'evidence_' + index, type: 'predicate',
      instructions: rubric + '\nIs the evidence item with ID ' + JSON.stringify(id) +
        ' needed to justify the classification under this rubric?'
    }))
  ]
}

function normalize<L extends string>(
  getAnswer: (name: string) => ProviderAnswer | undefined,
  request: DecisionRequestContext<L>,
  predicateType: string,
  probabilityKey: 'probability' | 'noul'
): Decision<L> {
  const classification = getAnswer('label')
  const choice = classification?.choice
  if (classification?.type !== 'choice' || typeof choice !== 'string' || !request.labels.includes(choice as L)) {
    throw new Error('Decision provider did not return an allowed label')
  }
  const evidence = request.evidence.filter((_, index) => {
    const answer = getAnswer('evidence_' + index)
    const probability = answer?.[probabilityKey]
    if (answer?.type !== predicateType || typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('Decision provider did not return a valid evidence judgment')
    }
    return probability > 0.5
  }).map(item => item.id)
  return { label: choice as L, evidence }
}

const openai: DecisionProviderAdapter = {
  model: 'gpt-6-luna',
  endpoint: () => 'https://api.openai.com/v1/decisions',
  encode(request, model) {
    const questions = classificationQuestions(request).map(({ labels, ...question }) =>
      labels ? { ...question, choices: labels.map(value => ({ value })) } : question)
    const data = { input: request.input, evidence: request.evidence }
    return { model, input: [{ role: 'user', content: [{ type: 'input_json', data }] }], questions }
  },
  decode(response, request) {
    const body = response as { answers?: unknown } | null | undefined
    if (!Array.isArray(body?.answers)) throw new Error('OpenAI Decisions returned no answers')
    const answers = body.answers as (ProviderAnswer | null | undefined)[]
    return normalize(name => {
      const answer = answers.find(item => item?.name === name) ?? undefined
      if (answer?.type === 'refusal') throw new Error('OpenAI Decisions refused question ' + name)
      return answer
    }, request, 'predicate', 'probability')
  }
}

function encodeSystemOne(request: DecisionRequestContext, model?: string) {
  const questions = classificationQuestions(request).map(({ name, labels, instructions }) => [
    name,
    labels ? { type: 'choice', instructions, criteria: Object.fromEntries(labels.map(label => [label, label])) }
      : { type: 'noul', instructions }
  ])
  return { model, state: { input: request.input, evidence: request.evidence }, questions: Object.fromEntries(questions) }
}

function decodeSystemOne<L extends string>(response: unknown, request: DecisionRequestContext<L>): Decision<L> {
  const answers = (response as { answers?: Record<string, ProviderAnswer | undefined> } | null | undefined)?.answers
  return normalize(name => answers?.[name], request, 'noul', 'noul')
}

const providers: Record<DecisionProviderName, DecisionProviderAdapter> = {
  http: {
    endpoint() { throw new Error('Set RIDGETOP_DECISION_URL to the decision endpoint') },
    encode: request => request,
    decode: <L extends string>(response: unknown) => response as Decision<L>
  },
  openai,
  jev: {
    model: 'jev-latest',
    endpoint: () => 'https://api.typesafe.ai/v1/systemone',
    encode: encodeSystemOne,
    decode: decodeSystemOne
  },
  clef: {
    model: 'clef-flash',
    endpoint(model, accountId) {
      if (!accountId) throw new Error('Set RIDGETOP_DECISION_ACCOUNT_ID for Cloudflare Workers AI')
      return 'https://api.cloudflare.com/client/v4/accounts/' + encodeURIComponent(accountId) +
        '/ai/run/@cf/cloudflare/' + encodeURIComponent(model ?? '')
    },
    encode: encodeSystemOne,
    decode(response, request) {
      const body = response as { success?: unknown; result?: unknown } | null | undefined
      if (body?.success !== true) throw new Error('Cloudflare Workers AI returned an unsuccessful result')
      return decodeSystemOne(body.result, request)
    }
  }
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
  if (!Object.hasOwn(providers, name)) {
    throw new TypeError('Unknown decision provider. Choose http, openai, clef, or jev')
  }
  const adapter = providers[name as DecisionProviderName]
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
    decode: (response: unknown, request: DecisionRequestContext<L>) => adapter.decode(response, request)
  }
}
