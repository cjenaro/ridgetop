import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPerfLogger, createPerfMonitor } from '../packages/ridgetop/framework/index.ts'
import { createGameHost } from '../packages/ridgetop/framework/host.ts'

test('createPerfMonitor computes rolling FPS, p95, worstMs, and phase EMAs', () => {
  const perf = createPerfMonitor(20)
  let now = 100
  perf.record({ now, backend: 'WebGL 2', width: 1280, height: 720, dpr: 1.5 })
  for (let i = 0; i < 19; i++) {
    now += i === 10 ? 50 : 16
    perf.record({
      now,
      simMs: 0.4,
      renderMs: 2.1,
      hudMs: 0.3,
      uiMs: 0.2,
      stats: { drawCalls: 14, triangles: 6400, instances: 180, uploadBytes: 4096, culledBatches: 0 }
    })
  }
  const snap = perf.snapshot()
  assert.equal(snap.sampleCount, 19)
  assert.ok(snap.fps > 45 && snap.fps < 65)
  assert.equal(Math.round(snap.worstMs), 50)
  assert.ok(snap.p95Ms >= 16)
  assert.equal(snap.drawCalls, 14)
  assert.equal(snap.triangles, 6400)
  assert.equal(snap.backend, 'WebGL 2')

  const logger = createPerfLogger(perf, { game: 'test-game', endpoint: null, storageKey: null, getScreen: () => 'battle' })
  const entry = logger.flush('manual')
  assert.ok(entry)
  assert.equal(entry.game, 'test-game')
  assert.equal(entry.screen, 'battle')
  assert.equal(entry.reason, 'manual')
  assert.equal(logger.entryCount, 1)
  assert.ok(logger.toNdjson().includes('"game":"test-game"'))
  logger.dispose()
})

test('createGameHost persists /__perf/log telemetry to data/perf.ndjson and serves summary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ridgetop-perf-'))
  const app = createGameHost({
    root: pathToFileURL(dir + '/'),
    files: []
  })
  try {
    await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', () => resolve()))
    const addr = app.server.address()
    assert.ok(addr && typeof addr === 'object')
    const base = `http://127.0.0.1:${addr.port}`

    const post1 = await fetch(`${base}/__perf/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'crownshard', screen: 'battle', fps: 58.4, worstMs: 24.5, backend: 'WebGL 2' })
    })
    assert.equal(post1.status, 200)

    const post2 = await fetch(`${base}/__perf/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'crownshard', screen: 'camp', fps: 42.0, worstMs: 68.2, backend: 'WebGL 2' })
    })
    assert.equal(post2.status, 200)

    const disk = (await readFile(join(dir, 'data', 'perf.ndjson'), 'utf8')).trim().split('\n')
    assert.equal(disk.length, 2)
    assert.ok(disk[0].includes('"crownshard"'))

    const getRes = await fetch(`${base}/__perf/log`)
    assert.equal(getRes.status, 200)
    const body = await getRes.json()
    assert.equal(body.count, 2)
    assert.equal(body.summary.minFps, 42)
    assert.equal(body.summary.worstFrameMs, 68.2)
    assert.equal(body.recent.length, 2)

    const delRes = await fetch(`${base}/__perf/log`, { method: 'DELETE' })
    assert.equal(delRes.status, 200)
    const afterDel = await (await fetch(`${base}/__perf/log`)).json()
    assert.equal(afterDel.count, 0)
  } finally {
    await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
