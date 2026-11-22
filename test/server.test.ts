import type { AddressInfo } from 'node:net'
import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGameServer } from '../server.ts'
import { createGameHost } from '../framework/server.ts'
import { courses } from '../game/level.ts'

test('game art folders serve PNG and JSON exports with encoded names', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-art-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const art = join(folder, 'art')
  await mkdir(art)
  const app = createGameHost({ root: pathToFileURL(folder + '/'), files: [], artDirectories: ['art'] })
  t.after(() => app.close())
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port + '/art/'
  assert.equal((await fetch(base + 'Coin.json')).status, 404)
  await writeFile(join(art, 'Coin #1.PNG'), new Uint8Array([137, 80, 78, 71]))
  await writeFile(join(art, 'Coin.json'), '{"src":"Coin%20%231.PNG"}')
  await writeFile(join(art, 'notes.txt'), 'local notes')
  const manifest = await fetch(base + 'Coin.json').then(r => r.json()) as { src: string }
  const image = await fetch(base + manifest.src)
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer())], [137, 80, 78, 71])
  assert.equal((await fetch(base + 'notes.txt')).status, 404)
  await rm(join(art, 'Coin.json'))
  assert.equal((await fetch(base + 'Coin.json')).status, 404)
})

async function events(url, options = {}) {
  const abort = new AbortController()
  const res = await fetch(url, { ...options, signal: abort.signal })
  assert.equal(res.status, 200)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  return {
    abort() { abort.abort() },
    async next() {
      while (!pending.includes('\n\n')) {
        const { value, done } = await reader.read()
        assert.equal(done, false, 'SSE stream ended early')
        pending += decoder.decode(value, { stream: true })
      }
      const split = pending.indexOf('\n\n')
      const packet = pending.slice(0, split)
      pending = pending.slice(split + 2)
      const data = packet.split('\n').find(line => line.startsWith('data: '))
      return JSON.parse(data.slice(6))
    },
    async until(condition) {
      for (let i = 0; i < 80; i++) {
        const snapshot = await this.next()
        if (condition(snapshot)) return snapshot
      }
      assert.fail('Expected player state did not arrive')
    }
  }
}

test('room protocol isolates courses, applies inputs once, and resumes disconnected runs', { timeout: 12_000 }, async t => {
  const app = createGameServer()
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  t.after(() => {
    const closed = once(app.server, 'close')
    app.close()
    return closed
  })
  const root = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port
  assert.equal(await fetch(root + '/healthz').then(r => r.text()), 'ok')
  assert.equal((await fetch(root + '/package.json')).status, 404)
  const route = root + '/rooms/summit/links'
  const a = await events(route + '/events')
  const first = await a.next()
  const b = await events(route + '/events')
  const second = await b.next()
  const other = await events(root + '/rooms/ruins/links/events')
  const third = await other.next()
  t.after(() => { a.abort(); b.abort(); other.abort() })

  const shared = await a.until(data => data.players.length === 2)
  assert.deepEqual(shared.players.map(p => p.id), [first.id, second.id])
  const isolated = await other.next()
  assert.deepEqual(isolated.players.map(p => p.id), [third.id])
  assert.ok(shared.players[0].y > courses.summit.spawn.y)

  const post = (action, token, body?) => fetch(route + '/' + action, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: body && JSON.stringify(body)
  })
  const input = { left: false, right: true, jump: 0, restart: 0 }
  assert.equal((await post('input', third.token, input)).status, 401)
  assert.equal((await post('input', first.token, input)).status, 204)
  const moving = await a.until(data => data.players[0].x > 85)
  assert.equal(moving.players[1].x, courses.summit.spawn.x)
  const reset = { ...input, right: false, restart: 1 }
  assert.equal((await post('input', first.token, reset)).status, 204)
  await a.until(data => data.players[0].revision === 1)
  assert.equal((await post('input', first.token, reset)).status, 204)
  assert.equal((await post('input', first.token, input)).status, 400)

  a.abort()
  await b.until(data => data.players.length === 1)
  const resumed = await events(route + '/events', { headers: { 'Last-Event-ID': first.token } })
  t.after(() => resumed.abort())
  assert.deepEqual(await resumed.next(), first)
  const restored = await resumed.until(data => data.players.length === 2)
  assert.equal(restored.players.find(p => p.id === first.id).revision, 1)
  assert.equal((await post('leave', first.token)).status, 204)
  await b.until(data => data.players.length === 1)
  assert.equal((await post('input', first.token, reset)).status, 401)
})
