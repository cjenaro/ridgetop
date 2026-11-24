function classificationQuestions({ labels, rubric, evidence }) {
  return [
    { name: 'label', type: 'choice', instructions: rubric, labels },
    ...evidence.map(({ id }, index) => ({
      name: 'evidence_' + index, type: 'predicate',
      instructions: rubric + '\nIs the evidence item with ID ' + JSON.stringify(id) +
        ' needed to justify the classification under this rubric?'
    }))
  ]
}

function normalize(getAnswer, request, predicateType, probabilityKey) {
  const classification = getAnswer('label')
  if (classification?.type !== 'choice' || !request.labels.includes(classification.choice)) {
    throw new Error('Decision provider did not return an allowed label')
  }
  const evidence = request.evidence.filter((_, index) => {
    const answer = getAnswer('evidence_' + index)
    const probability = answer?.[probabilityKey]
    if (answer?.type !== predicateType || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('Decision provider did not return a valid evidence judgment')
    }
    return probability > 0.5
  }).map(item => item.id)
  return { label: classification.choice, evidence }
}

const openai = {
  model: 'gpt-6-luna',
  endpoint: () => 'https://api.openai.com/v1/decisions',
  encode(request, model) {
    const questions = classificationQuestions(request).map(({ labels, ...question }) =>
      labels ? { ...question, choices: labels.map(value => ({ value })) } : question)
    const data = { input: request.input, evidence: request.evidence }
    return { model, input: [{ role: 'user', content: [{ type: 'input_json', data }] }], questions }
  },
  decode(response, request) {
    if (!Array.isArray(response?.answers)) throw new Error('OpenAI Decisions returned no answers')
    return normalize(name => {
      const answer = response.answers.find(item => item?.name === name)
      if (answer?.type === 'refusal') throw new Error('OpenAI Decisions refused question ' + name)
      return answer
    }, request, 'predicate', 'probability')
  }
}

function encodeSystemOne(request, model) {
  const questions = classificationQuestions(request).map(({ name, labels, instructions }) => [
    name,
    labels ? { type: 'choice', instructions, criteria: Object.fromEntries(labels.map(label => [label, label])) }
      : { type: 'noul', instructions }
  ])
  return { model, state: { input: request.input, evidence: request.evidence }, questions: Object.fromEntries(questions) }
}

function decodeSystemOne(response, request) {
  return normalize(name => response?.answers?.[name], request, 'noul', 'noul')
}

const providers = {
  http: {
    endpoint() { throw new Error('Set RIDGETOP_DECISION_URL to the decision endpoint') },
    encode: request => request,
    decode: response => response
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
        '/ai/run/@cf/cloudflare/' + encodeURIComponent(model)
    },
    encode: encodeSystemOne,
    decode(response, request) {
      if (response?.success !== true) throw new Error('Cloudflare Workers AI returned an unsuccessful result')
      return decodeSystemOne(response.result, request)
    }
  }
}

export function selectDecisionProvider(name, { endpoint, model, accountId, labels }) {
  if (!Object.hasOwn(providers, name)) {
    throw new TypeError('Unknown decision provider. Choose http, openai, clef, or jev')
  }
  const adapter = providers[name]
  model ??= adapter.model
  if (name !== 'http' && (!Array.isArray(labels) || labels.length < 2 || labels.length > 255)) {
    throw new RangeError('Native decision providers require 2 to 255 labels')
  }
  if (name === 'clef' && !['clef', 'clef-flash', 'clef-omni'].includes(model)) {
    throw new TypeError('Cloudflare model must be clef, clef-flash, or clef-omni')
  }
  return {
    endpoint: endpoint ?? adapter.endpoint(model, accountId),
    model,
    encode: request => adapter.encode(request, model),
    decode: adapter.decode
  }
}
