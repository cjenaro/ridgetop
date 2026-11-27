import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadTrace, parseReplayArgs } from '../tools/replay-decision.ts'

test('parseReplayArgs parses valid flags and defaults', () => {
  const defaults = parseReplayArgs([])
  assert.equal(defaults.session, undefined)
  assert.equal(defaults.file, undefined)
  assert.equal(defaults.untilStep, undefined)
  assert.equal(defaults.outDir, 'data/decision-replays')
  assert.equal(defaults.verifyJev, false)
  assert.equal(defaults.headed, false)

  const full = parseReplayArgs([
    '--session', 'sess-42',
    '--file', 'trace.json',
    '--until', '5',
    '--viewport', '1280x720',
    '--out', 'tmp/replays',
    '--game', '/beacon-run',
    '--verify-jev',
    '--headed'
  ])
  assert.deepEqual(full, {
    session: 'sess-42',
    file: 'trace.json',
    untilStep: 5,
    viewportRaw: '1280x720',
    outDir: 'tmp/replays',
    gameOverride: '/beacon-run',
    verifyJev: true,
    headed: true
  })
})

test('parseReplayArgs rejects invalid --until values', () => {
  for (const argv of [
    ['--until'],
    ['--until', ''],
    ['--until', 'abc'],
    ['--until', 'NaN'],
    ['--until', '0'],
    ['--until', '-3'],
    ['--until', '2.5'],
    ['--until', 'Infinity']
  ]) {
    assert.throws(() => parseReplayArgs(argv), /Invalid --until value/)
  }
})

test('loadTrace loads --session traces, applies --until, and skips malformed NDJSON lines', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ridgetop-replay-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const logPath = join(dir, 'decisions.ndjson')
  const lines = [
    JSON.stringify({ kind: 'decision', sessionId: 'sess-a', step: 1 }),
    '{not valid json at all',
    JSON.stringify({
      kind: 'outcome',
      sessionId: 'sess-a',
      game: '/crownshard',
      viewport: '1024x600',
      step: 1,
      source: 'ui',
      choice: 'ui:start',
      choiceLabel: 'Start',
      widgetId: 'start',
      widgetAction: 'press',
      beforeScreen: 'title',
      afterScreen: 'battle'
    }),
    'truncated-line',
    JSON.stringify({
      kind: 'outcome',
      sessionId: 'sess-a',
      game: '/crownshard',
      step: 2,
      source: 'adapter',
      choice: 'move_2_3',
      choiceLabel: 'Move to (2, 3)',
      beforeScreen: 'battle',
      afterScreen: 'battle'
    }),
    JSON.stringify({
      kind: 'outcome',
      sessionId: 'sess-a',
      game: '/crownshard',
      step: 3,
      source: 'adapter',
      choice: 'end_turn',
      choiceLabel: 'End Turn',
      beforeScreen: 'battle',
      afterScreen: 'enemy_turn'
    }),
    JSON.stringify({
      kind: 'outcome',
      sessionId: 'sess-b',
      game: '/beacon-run',
      step: 1,
      source: 'ui',
      choice: 'ui:play',
      choiceLabel: 'Play'
    })
  ]
  await writeFile(logPath, lines.join('\n') + '\n', 'utf8')

  const warnings: string[] = []
  t.mock.method(console, 'warn', (msg?: unknown) => {
    warnings.push(String(msg ?? ''))
  })

  const full = await loadTrace(parseReplayArgs(['--session', 'sess-a']), logPath)
  assert.equal(full.sessionId, 'sess-a')
  assert.equal(full.game, '/crownshard')
  assert.deepEqual(full.viewport, { width: 1024, height: 600 })
  assert.equal(full.steps.length, 3)
  assert.equal(full.steps[0].widgetId, 'start')
  assert.equal(full.steps[0].afterScreen, 'battle')
  assert.equal(full.steps[1].source, 'adapter')
  assert.equal(full.steps[1].choice, 'move_2_3')
  assert.equal(warnings.length, 2)

  const capped = await loadTrace(parseReplayArgs(['--session', 'sess-a', '--until', '2']), logPath)
  assert.equal(capped.steps.length, 2)
  assert.deepEqual(capped.steps.map(s => s.step), [1, 2])
})

test('loadTrace throws on nonexistent --session', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ridgetop-replay-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const logPath = join(dir, 'decisions.ndjson')
  await writeFile(
    logPath,
    JSON.stringify({ kind: 'outcome', sessionId: 'sess-only', step: 1, source: 'ui', choiceLabel: 'Play' }) + '\n',
    'utf8'
  )

  await assert.rejects(
    loadTrace(parseReplayArgs(['--session', 'does-not-exist']), logPath),
    /No recorded steps found for session "does-not-exist"/
  )
})

test('loadTrace loads --file traces and applies --until', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ridgetop-replay-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const filePath = join(dir, 'custom-trace.json')
  await writeFile(
    filePath,
    JSON.stringify({
      sessionId: 'file-sess',
      game: '/crownshard',
      viewport: { width: 900, height: 500 },
      steps: [
        { step: 1, source: 'ui', widgetId: 'play', choiceLabel: 'Play', afterScreen: 'battle' },
        { step: 2, source: 'adapter', choice: 'attack_1', choiceLabel: 'Attack' },
        { step: 3, source: 'adapter', choice: 'end_turn', choiceLabel: 'End Turn' }
      ]
    }),
    'utf8'
  )

  const full = await loadTrace(parseReplayArgs(['--file', filePath]))
  assert.equal(full.sessionId, 'file-sess')
  assert.deepEqual(full.viewport, { width: 900, height: 500 })
  assert.equal(full.steps.length, 3)

  const capped = await loadTrace(parseReplayArgs(['--file', filePath, '--until', '2']))
  assert.equal(capped.steps.length, 2)
  assert.deepEqual(capped.steps.map(s => s.step), [1, 2])
  assert.equal(capped.steps[1].choice, 'attack_1')

  const emptyPath = join(dir, 'empty-trace.json')
  await writeFile(emptyPath, JSON.stringify({ sessionId: 'empty', steps: [] }), 'utf8')
  await assert.rejects(
    loadTrace(parseReplayArgs(['--file', emptyPath])),
    /has 0 matching steps/
  )
})
