import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDecisionAgentHandler, createDecisionApi, parseDotEnv, resolveDecisionEnv } from '../packages/ridgetop/framework/server.ts'

const execute = promisify(execFile)

test('verification CLI sends three compact decision requests for eight fixtures', async t => {
  const requests: { body: { evidence: { id: string; value: unknown }[]; [key: string]: unknown }; authorization: string | undefined }[] = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw) as { evidence: { id: string; value: unknown }[]; [key: string]: unknown }
    requests.push({ body, authorization: req.headers.authorization })
    const finish = body.evidence.find(item => item.id === 'finish')?.value
    const falls = body.evidence.find(item => item.id === 'falls')?.value
    const label = finish ? 'completed' : falls ? 'respawned' : 'in-progress'
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ label, evidence: finish ? ['finish'] : ['finish', 'falls'] }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  const endpoint = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/decide'

  const { stdout } = await execute(process.execPath, ['tools/verify-game.ts', '--json', '--decision-api'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, RIDGETOP_DECISION_URL: endpoint, RIDGETOP_DECISION_TOKEN: 'fixture-token',
      RIDGETOP_DECISION_MAX_REQUESTS: '3', RIDGETOP_DECISION_PROVIDER: 'http' }
  })
  const decisions = JSON.parse(stdout).decisions
  assert.equal(decisions.passed, 8)
  assert.equal(decisions.requests.attempted, 3)
  assert.equal(decisions.requests.reused, 5)
  assert.equal(requests.length, 3)
  for (const { body, authorization } of requests) {
    assert.deepEqual(Object.keys(body), ['labels', 'rubric', 'input', 'evidence'])
    assert.equal(authorization, 'Bearer fixture-token')
  }

  const api = createDecisionApi({
    endpoint, labels: ['completed'], rubric: 'Classify the run', maxRequests: 1
  })
  const input = { input: null, evidence: [{ id: 'finish', value: true }, { id: 'falls', value: 0 }] }
  const [first, duplicate] = await Promise.all([api.decide(input), api.decide(input)])
  assert.deepEqual(first, duplicate)
  assert.notEqual(first, duplicate)
  await assert.rejects(api.decide({ ...input, input: 'changed' }), /budget exhausted/)
  await assert.rejects(api.decide({ ...input, input: 'x'.repeat(4096) }), /request exceeds/)
  const { limit, attempted, reused, overBudget } = api.report()
  assert.deepEqual({ limit, attempted, reused, overBudget }, { limit: 1, attempted: 1, reused: 1, overBudget: 1 })
  assert.equal(requests.length, 4)
})

test('OpenAI, Clef and Jev expose the same decision contract', async t => {
  const labels = ['completed', 'in-progress']
  const evidence = [{ id: 'finish', value: true }, { id: 'irrelevant', value: 12 }]
  const observation = { id: 'case-is-private', input: null, evidence }
  for (const provider of ['openai', 'clef', 'jev'] as const) {
    await t.test(provider, async t => {
      const urls = {
        openai: 'https://api.openai.com/v1/decisions',
        clef: 'https://api.cloudflare.com/client/v4/accounts/fixture/ai/run/@cf/cloudflare/clef-flash',
        jev: 'https://api.typesafe.ai/v1/systemone'
      }
      const models = { openai: 'gpt-6-luna', clef: 'clef-flash', jev: 'jev-latest' }
      const mocked = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, request?: RequestInit) => {
        assert.equal(url instanceof URL ? url.href : String(url), urls[provider])
        const headers = request?.headers as Record<string, string> | undefined
        assert.equal(headers?.Authorization, 'Bearer fixture-token')
        const rawBody = String(request?.body ?? '')
        const body = JSON.parse(rawBody)
        assert.equal(body.model, models[provider])
        assert.equal(rawBody.includes(observation.id), false)
        const label = { type: 'choice', choice: 'completed' }
        if (provider === 'openai') {
          assert.deepEqual(body.input[0].content[0], { type: 'input_json', data: { input: null, evidence } })
          assert.deepEqual(body.questions[0].choices, labels.map(value => ({ value })))
          assert.deepEqual(body.questions.map((question: { type: string }) => question.type), ['choice', 'predicate', 'predicate'])
          return Response.json({ answers: [
            { ...label, name: 'label' },
            { type: 'predicate', name: 'evidence_1', probability: 0.5 },
            { type: 'predicate', name: 'evidence_0', probability: 0.96 }
          ] })
        }
        assert.deepEqual(body.state, { input: null, evidence })
        assert.deepEqual(Object.keys(body.questions.label.criteria), labels)
        assert.equal(body.questions.evidence_0.type, 'noul')
        const result = { answers: {
          label, evidence_0: { type: 'noul', noul: 0.96 }, evidence_1: { type: 'noul', noul: 0.5 }
        } }
        return Response.json(provider === 'clef' ? { success: true, result } : result)
      })
      const api = createDecisionApi({ provider, accountId: 'fixture', token: 'fixture-token',
        labels, rubric: 'Classify from the finish state', maxRequests: 1 })
      assert.deepEqual(await api.decide(observation), { label: 'completed', evidence: ['finish'] })
      assert.deepEqual(await api.decide(observation), { label: 'completed', evidence: ['finish'] })
      assert.equal(mocked.mock.callCount(), 1)
    })
  }
})

test('missing provider evidence fails and remains subject to the shared budget', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ answers: [
    { name: 'label', type: 'choice', choice: 'completed' }
  ] }))
  const api = createDecisionApi({ provider: 'openai', token: 'fixture-token',
    labels: ['completed', 'in-progress'], rubric: 'Classify from the finish state', maxRequests: 1 })
  const input = { input: null, evidence: [{ id: 'finish', value: true }] }
  await assert.rejects(api.decide(input), /valid evidence judgment/)
  await assert.rejects(api.decide(input), /budget exhausted/)
})

test('typesafe alias and decideDetailed preserve probabilities, confidence, and usage', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, request?: RequestInit) => {
    assert.equal(url instanceof URL ? url.href : String(url), 'https://api.typesafe.ai/v1/systemone')
    const body = JSON.parse(String(request?.body ?? ''))
    assert.equal(body.questions.label.criteria.attack, 'Strike weakened goblin')
    return Response.json({
      model: 'jev-1.14.0',
      answers: {
        label: { type: 'choice', choice: 'attack', confidence: 0.84, probabilities: { attack: 0.89, heal: 0.11 } },
        evidence_0: { type: 'noul', noul: 0.91 },
        evidence_1: { type: 'noul', noul: 0.22 },
        bug_suspected: { type: 'noul', noul: 0.78 }
      },
      usage: { input_tokens: 310, output_tokens: 55 }
    })
  })
  const api = createDecisionApi({
    provider: 'typesafe',
    token: 'ts-test-key',
    labels: ['attack', 'heal'],
    criteria: { attack: 'Strike weakened goblin', heal: 'Drink healing potion' },
    rubric: 'Pick the best tactical move',
    checkForBug: true,
    maxRequests: 2
  })
  const detailed = await api.decideDetailed({
    input: { hp: 40, enemyHp: 12 },
    evidence: [{ id: 'can_ko', value: true }, { id: 'hazard', value: false }]
  })
  assert.equal(detailed.label, 'attack')
  assert.deepEqual(detailed.evidence, ['can_ko'])
  assert.equal(detailed.confidence, 0.84)
  assert.deepEqual(detailed.probabilities, { attack: 0.89, heal: 0.11 })
  assert.deepEqual(detailed.evidenceProbabilities, { can_ko: 0.91, hazard: 0.22 })
  assert.equal(detailed.bugProbability, 0.78)
  assert.equal(detailed.bugSuspected, true)
  assert.equal(detailed.model, 'jev-1.14.0')
  assert.deepEqual(detailed.usage, { inputTokens: 310, outputTokens: 55 })
  assert.equal(detailed.cached, false)

  const cached = await api.decideDetailed({
    input: { hp: 40, enemyHp: 12 },
    evidence: [{ id: 'can_ko', value: true }, { id: 'hazard', value: false }]
  })
  assert.equal(cached.cached, true)
})

test('parseDotEnv and resolveDecisionEnv auto-detect TYPESAFE_API_KEY and strip inline comments', () => {
  const parsed = parseDotEnv(
    '# comment\n' +
    'export TYPESAFE_API_KEY="ts_secret_123 # keep"\n' +
    'OTHER=ok # trailing comment\n' +
    'EMPTY=# only comment\n'
  )
  assert.equal(parsed.TYPESAFE_API_KEY, 'ts_secret_123 # keep')
  assert.equal(parsed.OTHER, 'ok')
  assert.equal(parsed.EMPTY, '')
  const resolved = resolveDecisionEnv({ TYPESAFE_API_KEY: 'ts_key_abc' }, '/nonexistent-dir-for-test')
  assert.equal(resolved.provider, 'jev')
  assert.equal(resolved.token, 'ts_key_abc')
  assert.equal(resolved.configuredProviders.jev, true)
  assert.equal(resolved.configuredProviders.typesafe, true)
})

async function startDecisionTestServer(t: test.TestContext) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'ridgetop-decision-test-'))
  t.after(() => rm(tmpDir, { recursive: true, force: true }))
  const handler = createDecisionAgentHandler(pathToFileURL(tmpDir + '/'))
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const handled = await handler(req, res, pathname)
    if (!handled) { res.writeHead(404).end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => {
    server.close(resolve)
    server.closeAllConnections()
  }))
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  return { base, tmpDir }
}

test('decision agent server handler serves status and local heuristic probabilities', async t => {
  const { base } = await startDecisionTestServer(t)
  const statusRes = await fetch(base + '/__testing/decision/status')
  assert.equal(statusRes.status, 200)
  const statusJson = await statusRes.json()
  assert.equal(statusJson.ok, true)
  assert.equal(statusJson.configuredProviders.local, true)

  const decideRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'local',
      rubric: 'Pick strongest action',
      state: { turn: 1 },
      options: [
        { id: 'strike', label: 'Strike', description: 'Deal 25 dmg', heuristicScore: 95 },
        { id: 'wait', label: 'Wait', description: 'End turn', heuristicScore: 5 }
      ],
      evidence: [{ id: 'can_ko', value: true }]
    })
  })
  assert.equal(decideRes.status, 200)
  const decideJson = await decideRes.json()
  assert.equal(decideJson.ok, true)
  assert.equal(decideJson.choice, 'strike')
  assert.ok(decideJson.probabilities.strike > decideJson.probabilities.wait)
  assert.equal(decideJson.evidenceProbabilities.can_ko, 0.85)

  const outcomeRes = await fetch(base + '/__testing/decision/outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: 'test-session',
      step: 1,
      choice: 'strike',
      choiceLabel: 'Strike',
      executed: true,
      beforeScreen: 'battle',
      afterScreen: 'battle',
      stateChanged: true,
      anomalies: [],
      runtimeErrors: []
    })
  })
  assert.equal(outcomeRes.status, 200)

  const logRes = await fetch(base + '/__testing/decision/log')
  assert.equal(logRes.status, 200)
  const logJson = await logRes.json()
  assert.equal(logJson.ok, true)
  assert.equal(logJson.logPath, 'data/decisions.ndjson')
  assert.ok(logJson.summary.totalDecisions >= 1)
  assert.ok(logJson.summary.totalOutcomes >= 1)

  const popoutRes = await fetch(base + '/__testing/agent')
  assert.equal(popoutRes.status, 200)
  const popoutHtml = await popoutRes.text()
  assert.ok(popoutHtml.includes('testing-agent-popout.js'))

  // 1x1 transparent PNG
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const shotRes = await fetch(base + '/__testing/decision/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'test-session', step: 1, screen: 'title', dataUrl: tinyPng })
  })
  assert.equal(shotRes.status, 200)
  const shotJson = await shotRes.json()
  assert.equal(shotJson.ok, true)
  assert.ok(shotJson.url.startsWith('/__testing/decision/shot/test-session/'))
  const fetchedShot = await fetch(base + shotJson.url)
  assert.equal(fetchedShot.status, 200)
  assert.equal(fetchedShot.headers.get('content-type'), 'image/png')
})

test('decision server enforces CSRF, SSRF, content-type, provider validation, and body size limits', async t => {
  const { base, tmpDir } = await startDecisionTestServer(t)

  const validBody = JSON.stringify({
    provider: 'local',
    options: [{ id: 'a', heuristicScore: 10 }, { id: 'b', heuristicScore: 1 }]
  })

  // Cross-origin Origin header -> 403
  const crossOriginRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: validBody
  })
  assert.equal(crossOriginRes.status, 403)

  // Sec-Fetch-Site: cross-site -> 403
  const crossSiteRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
    body: validBody
  })
  assert.equal(crossSiteRes.status, 403)

  // Missing / non-JSON Content-Type -> 415
  const textPlainRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: validBody
  })
  assert.equal(textPlainRes.status, 415)

  // Unknown provider -> 400
  const unknownProviderRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'not-a-real-provider',
      options: [{ id: 'a' }, { id: 'b' }]
    })
  })
  assert.equal(unknownProviderRes.status, 400)

  // Oversized body -> 413
  const oversizedRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'local',
      state: { pad: 'x'.repeat(50_000) },
      options: [{ id: 'a' }, { id: 'b' }]
    })
  })
  assert.equal(oversizedRes.status, 413)

  // SSRF: endpoint override with named provider + server token -> 403
  const prevKey = process.env.TYPESAFE_API_KEY
  process.env.TYPESAFE_API_KEY = 'server-secret-token'
  t.after(() => {
    if (prevKey === undefined) delete process.env.TYPESAFE_API_KEY
    else process.env.TYPESAFE_API_KEY = prevKey
  })
  const ssrfNamedRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'jev',
      endpoint: 'https://attacker.example/steal',
      options: [{ id: 'a' }, { id: 'b' }]
    })
  })
  assert.equal(ssrfNamedRes.status, 403)

  // SSRF: endpoint override on http without explicit client token -> 403
  const ssrfHttpRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'http',
      endpoint: 'https://attacker.example/steal',
      options: [{ id: 'a' }, { id: 'b' }]
    })
  })
  assert.equal(ssrfHttpRes.status, 403)

  // GET /shot/ path traversal, bad extension, and symlink rejection
  const badExtRes = await fetch(base + '/__testing/decision/shot/sess1/secret.txt')
  assert.equal(badExtRes.status, 400)
  const traversalRes = await fetch(base + '/__testing/decision/shot/sess1/..%2Fdecisions.ndjson')
  assert.equal(traversalRes.status, 400)

  // Symlink inside shots dir should be rejected with 403
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const shotUpload = await fetch(base + '/__testing/decision/screenshot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'symtest', step: 1, screen: 's', dataUrl: tinyPng })
  })
  assert.equal(shotUpload.status, 200)
  const secretFile = join(tmpDir, 'secret.png')
  await writeFile(secretFile, 'secret')
  await symlink(secretFile, join(tmpDir, 'data', 'decision-shots', 'symtest', 'evil.png'))
  const symRes = await fetch(base + '/__testing/decision/shot/symtest/evil.png')
  assert.equal(symRes.status, 403)
})

test('decision server coalesces concurrent identical requests and enforces session cap', async t => {
  const { base } = await startDecisionTestServer(t)
  let upstreamCalls = 0
  let releaseUpstream: (() => void) | undefined
  const upstreamGate = new Promise<void>(resolve => { releaseUpstream = resolve })

  const upstream = createServer(async (req, res) => {
    upstreamCalls++
    for await (const _chunk of req) { /* drain */ }
    await upstreamGate
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ label: 'a', evidence: ['e1'], confidence: 0.9 }))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  t.after(() => new Promise(resolve => {
    upstream.close(resolve)
    upstream.closeAllConnections()
  }))
  const upstreamUrl = 'http://127.0.0.1:' + (upstream.address() as AddressInfo).port + '/decide'

  const prevCap = process.env.RIDGETOP_DECISION_MAX_SESSION_REQUESTS
  process.env.RIDGETOP_DECISION_MAX_SESSION_REQUESTS = '1'
  t.after(() => {
    if (prevCap === undefined) delete process.env.RIDGETOP_DECISION_MAX_SESSION_REQUESTS
    else process.env.RIDGETOP_DECISION_MAX_SESSION_REQUESTS = prevCap
  })

  const payload = JSON.stringify({
    provider: 'http',
    endpoint: upstreamUrl,
    token: 'client-token',
    state: { turn: 1 },
    options: [{ id: 'a' }, { id: 'b' }],
    evidence: [{ id: 'e1', value: true }]
  })

  const p1 = fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  })
  const p2 = fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload
  })
  // Let both requests reach the handler before releasing upstream
  await new Promise(resolve => setTimeout(resolve, 30))
  releaseUpstream?.()

  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r1.status, 200)
  assert.equal(r2.status, 200)
  const [j1, j2] = await Promise.all([r1.json(), r2.json()])
  assert.equal(upstreamCalls, 1)
  assert.equal(j1.choice, 'a')
  assert.equal(j2.choice, 'a')
  assert.equal(j1.cached !== j2.cached, true)

  // Next distinct request should hit the session cap (1) and return 429
  const capRes = await fetch(base + '/__testing/decision/decide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'http',
      endpoint: upstreamUrl,
      token: 'client-token',
      state: { turn: 2 },
      options: [{ id: 'a' }, { id: 'b' }],
      evidence: [{ id: 'e1', value: true }]
    })
  })
  assert.equal(capRes.status, 429)
})

test('Clef 64-question limit, httpAdapter.decodeDetailed validation, AbortSignal, and option bounds', async t => {
  // Option bounds validation
  assert.throws(() => createDecisionApi({
    endpoint: 'http://127.0.0.1:9999/decide',
    labels: ['a', 'b'],
    rubric: 'r',
    timeoutMs: 0
  }), /timeoutMs/)
  assert.throws(() => createDecisionApi({
    endpoint: 'http://127.0.0.1:9999/decide',
    labels: ['a', 'b'],
    rubric: 'r',
    maxRequestBytes: -1
  }), /maxRequestBytes/)
  assert.throws(() => createDecisionApi({
    endpoint: 'http://127.0.0.1:9999/decide',
    labels: ['a', 'b'],
    rubric: 'r',
    maxResponseBytes: Number.NaN
  }), /maxResponseBytes/)

  // Clef checkForBug 62-evidence limit (1 label + 62 evidence + 1 bug_suspected = 64 questions)
  const clefApi = createDecisionApi({
    provider: 'clef',
    accountId: 'acc',
    token: 'tok',
    labels: ['a', 'b'],
    rubric: 'r',
    checkForBug: true
  })
  const evidence63 = Array.from({ length: 63 }, (_, i) => ({ id: 'e' + i, value: i }))
  await assert.rejects(
    clefApi.decideDetailed({ input: null, evidence: evidence63 }),
    /62 evidence items/
  )

  // httpAdapter.decodeDetailed: bug fields, unknown evidence rejection, non-array evidence rejection
  let mockResponse: unknown = {
    label: 'a',
    evidence: ['e1'],
    bugProbability: 0.82
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json(mockResponse))
  const httpApi = createDecisionApi({
    endpoint: 'http://127.0.0.1:9999/decide',
    labels: ['a', 'b'],
    rubric: 'r',
    maxRequests: 5
  })
  const detailed = await httpApi.decideDetailed(
    { input: { step: 1 }, evidence: [{ id: 'e1', value: true }] },
    { useCache: false }
  )
  assert.equal(detailed.bugProbability, 0.82)
  assert.equal(detailed.bugSuspected, true)

  mockResponse = { label: 'a', evidence: ['unknown_id'] }
  await assert.rejects(
    httpApi.decideDetailed({ input: { step: 2 }, evidence: [{ id: 'e1', value: true }] }, { useCache: false }),
    /valid evidence judgment/
  )

  mockResponse = { label: 'a', evidence: 'not-an-array' }
  await assert.rejects(
    httpApi.decideDetailed({ input: { step: 3 }, evidence: [{ id: 'e1', value: true }] }, { useCache: false }),
    /evidence array/
  )

  // AbortSignal cancellation
  const controller = new AbortController()
  controller.abort(new Error('cancelled-by-caller'))
  await assert.rejects(
    httpApi.decideDetailed(
      { input: { step: 4 }, evidence: [{ id: 'e1', value: true }] },
      { useCache: false, signal: controller.signal }
    ),
    /cancelled-by-caller/
  )
})
