import type { AddressInfo } from 'node:net'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDecisionApi } from '../framework/server.ts'

const execute = promisify(execFile)

test('verification CLI sends three compact decision requests for eight fixtures', async t => {
  const requests = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push({ body, authorization: req.headers.authorization })
    const finish = body.evidence.find(item => item.id === 'finish').value
    const falls = body.evidence.find(item => item.id === 'falls').value
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
      const mocked = t.mock.method(globalThis, 'fetch', async (url, request) => {
        assert.equal(url.href, urls[provider])
        assert.equal(request.headers.Authorization, 'Bearer fixture-token')
        const body = JSON.parse(request.body)
        assert.equal(body.model, models[provider])
        assert.equal(request.body.includes(observation.id), false)
        const label = { type: 'choice', choice: 'completed' }
        if (provider === 'openai') {
          assert.deepEqual(body.input[0].content[0], { type: 'input_json', data: { input: null, evidence } })
          assert.deepEqual(body.questions[0].choices, labels.map(value => ({ value })))
          assert.deepEqual(body.questions.map(question => question.type), ['choice', 'predicate', 'predicate'])
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
