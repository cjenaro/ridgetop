import type { AddressInfo } from 'node:net'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createGameServer } from '../server.ts'
import { createGameHost, createRecords, createRoomService } from '../packages/ridgetop/framework/server.ts'
import { connectRoom, createArtRecipe } from '../packages/ridgetop/framework/index.ts'
import { courses } from '../examples/beacon-run/game/level.ts'

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

type RoomEvent = { id?: string; token?: string; players: { id: string; x: number; y: number; revision: number }[] }

async function events(url: string, options: RequestInit = {}) {
  const abort = new AbortController()
  const res = await fetch(url, { ...options, signal: abort.signal })
  assert.equal(res.status, 200)
  assert.ok(res.body)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  return {
    abort() { abort.abort() },
    async next(): Promise<RoomEvent> {
      while (!pending.includes('\n\n')) {
        const { value, done } = await reader.read()
        assert.equal(done, false, 'SSE stream ended early')
        pending += decoder.decode(value, { stream: true })
      }
      const split = pending.indexOf('\n\n')
      const packet = pending.slice(0, split)
      pending = pending.slice(split + 2)
      const data = packet.split('\n').find(line => line.startsWith('data: '))
      assert.ok(data, 'Expected data line in SSE packet')
      return JSON.parse(data.slice(6)) as RoomEvent
    },
    async until(condition: (snapshot: RoomEvent) => boolean) {
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

  const post = (action: string, token: string | undefined, body?: unknown) => fetch(route + '/' + action, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined
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
  const resumed = await events(route + '/events', { headers: { 'Last-Event-ID': first.token ?? '' } })
  t.after(() => resumed.abort())
  assert.deepEqual(await resumed.next(), first)
  const restored = await resumed.until(data => data.players.length === 2)
  assert.equal(restored.players.find(p => p.id === first.id)?.revision, 1)
  assert.equal((await post('leave', first.token)).status, 204)
  await b.until(data => data.players.length === 1)
  assert.equal((await post('input', first.token, reset)).status, 401)
})

test('host HEAD sets Content-Length, records avoid temp-file races, and connectRoom rebases jump count', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-net-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(join(folder, 'hello.json'), '{"ok":true}')
  const app = createGameHost({ root: pathToFileURL(folder + '/'), files: ['hello.json'] })
  t.after(() => app.close())
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port
  const head = await fetch(base + '/hello.json', { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(head.headers.get('content-length'), '11')
  assert.equal(await head.text(), '')

  // Concurrent saves from two independent createRecords handles targeting the same file must not race on .tmp
  const saveFile = join(folder, 'records.json')
  const r1 = createRecords<{ v: number }>(saveFile)
  const r2 = createRecords<{ v: number }>(saveFile)
  r1.set('a', { v: 1 })
  r2.set('b', { v: 2 })
  await Promise.all([r1.save(), r2.save()])

  // connectRoom must rebase monotonic jump count on fresh welcome so prior solo jumps do not fire on join
  const prevES = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  const prevFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  const sent: Record<string, unknown>[] = []
  let fakeEs: EventTarget & { readyState: number; close(): void }
  class FakeEventSource extends EventTarget {
    static OPEN = 1
    static CLOSED = 2
    readyState = 1
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    constructor() { super(); fakeEs = this }
    close() { this.readyState = 2 }
  }
  Object.defineProperty(globalThis, 'EventSource', { value: FakeEventSource, configurable: true })
  Object.defineProperty(globalThis, 'fetch', {
    value: async (_url: string, init?: RequestInit) => {
      if (init?.body) sent.push(JSON.parse(String(init.body)))
      return { ok: true }
    },
    configurable: true
  })
  try {
    let jump = 5
    const room = connectRoom({
      endpoint: '/rooms/ridge/test',
      readInput: () => ({ left: false, right: false, jump }),
      onStatus() {}
    })
    fakeEs!.dispatchEvent(Object.assign(new Event('welcome'), { data: JSON.stringify({ id: 'p1', token: 't1' }) }))
    // Initial flush at now=0 must not be dropped by sentAt throttle
    await room.flush(0)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].jump, 0)
    assert.equal(sent[0].inputSeq, 1)
    jump = 6
    await room.flush(100)
    assert.equal(sent[1].jump, 1)
    assert.equal(sent[1].inputSeq, 2)
    // Reconnect with a new player ID (expired session) must rebase jump back to 0
    fakeEs!.dispatchEvent(Object.assign(new Event('welcome'), { data: JSON.stringify({ id: 'p2', token: 't2' }) }))
    await room.flush(200)
    assert.equal(sent[2].jump, 0)
    assert.equal(sent[2].inputSeq, 1)
    room.close()
    // Messages arriving after close() must be ignored
    const prevCount = sent.length
    fakeEs!.dispatchEvent(Object.assign(new Event('welcome'), { data: JSON.stringify({ id: 'p3', token: 't3' }) }))
    assert.equal(room.id, 'p2')
    assert.equal(sent.length, prevCount)
  } finally {
    if (prevES) Object.defineProperty(globalThis, 'EventSource', prevES)
    else delete (globalThis as Record<string, unknown>).EventSource
    if (prevFetch) Object.defineProperty(globalThis, 'fetch', prevFetch)
  }
})

test('createGameHost hosted=false strips data-hosted="1" and testingOptions routes /__testing/recipe artDir', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-host-opts-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  await writeFile(join(folder, 'index.html'), '<!doctype html><html><body data-hosted="1"><script type="module" src="/app.js"></script></body></html>')
  const app = createGameHost({
    root: pathToFileURL(folder + '/'),
    files: ['index.html'],
    aliases: { '/': 'index.html' },
    hosted: false,
    testing: true,
    testingOptions: { artDir: 'nested/art' }
  })
  t.after(() => app.close())
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port
  const html = await fetch(base + '/').then(r => r.text())
  assert.ok(!html.includes('data-hosted="1"'), 'Standalone host with hosted: false must strip data-hosted="1"')

  const recipe = createArtRecipe('lantern')
  const saveRes = await fetch(base + '/__testing/recipe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ asset: 'lantern', file: null, base: null, recipe })
  })
  assert.equal(saveRes.status, 200)
  const payload = await saveRes.json() as { saved: boolean; file: string }
  assert.equal(payload.saved, true)
  assert.equal(payload.file, 'nested/art/overrides.json')
  const savedOnDisk = JSON.parse(await readFile(join(folder, 'nested', 'art', 'overrides.json'), 'utf8')) as Record<string, unknown>
  assert.ok(savedOnDisk.lantern, 'Recipe must be persisted inside testingOptions.artDir')
})

test('createGameHost mounts serves valid modules/assets and blocks traversal, symlinks, exclusions, and disallowed extensions', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-mounts-'))
  const outside = await mkdtemp(join(tmpdir(), 'ridgetop-outside-'))
  t.after(() => Promise.all([
    rm(folder, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]))
  await mkdir(join(folder, 'mod', 'parts'), { recursive: true })
  await writeFile(join(folder, 'mod', 'main.js'), 'export const ok = 1\n')
  await writeFile(join(folder, 'mod', 'style.css'), 'body { margin: 0 }\n')
  await writeFile(join(folder, 'mod', 'page.html'), '<!doctype html><html><head></head><body><script type="module" src="/mod/main.js"></script></body></html>')
  await writeFile(join(folder, 'mod', 'parts', 'blade.js'), 'export const blade = true\n')
  await writeFile(join(folder, 'mod', 'server.js'), 'export const secret = true\n')
  await writeFile(join(folder, 'mod', 'notes.txt'), 'not allowed')
  await writeFile(join(folder, 'mod', 'main.d.ts'), 'export declare const ok: number\n')
  await writeFile(join(folder, 'mod', 'main.js.map'), '{}')
  await writeFile(join(outside, 'leak.js'), 'export const leaked = true\n')
  await symlink(join(outside, 'leak.js'), join(folder, 'mod', 'link.js'))

  const app = createGameHost({
    root: pathToFileURL(folder + '/'),
    mounts: {
      '/mod/': { dir: pathToFileURL(join(folder, 'mod') + '/'), exclude: ['server.js'] }
    }
  })
  t.after(() => app.close())
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port

  const jsRes = await fetch(base + '/mod/main.js')
  assert.equal(jsRes.status, 200)
  assert.match(jsRes.headers.get('content-type') ?? '', /text\/javascript/)
  assert.match(await jsRes.text(), /export const ok = 1/)

  const nestedRes = await fetch(base + '/mod/parts/blade.js')
  assert.equal(nestedRes.status, 200)
  assert.match(await nestedRes.text(), /export const blade = true/)

  const cssRes = await fetch(base + '/mod/style.css')
  assert.equal(cssRes.status, 200)
  assert.match(cssRes.headers.get('content-type') ?? '', /text\/css/)

  const htmlRes = await fetch(base + '/mod/page.html')
  assert.equal(htmlRes.status, 200)
  assert.match(await htmlRes.text(), /<script type="importmap">/)

  // Security checks: traversal, encoded traversal, disallowed extensions, excluded files, symlinks
  assert.equal((await fetch(base + '/mod/../outside.js')).status, 404)
  assert.equal((await fetch(base + '/mod/%2e%2e/secret.js')).status, 404)
  assert.equal((await fetch(base + '/mod/parts/%2e%2e/server.js')).status, 404)
  assert.equal((await fetch(base + '/mod/server.js')).status, 404)
  assert.equal((await fetch(base + '/mod/notes.txt')).status, 404)
  assert.equal((await fetch(base + '/mod/main.d.ts')).status, 404)
  assert.equal((await fetch(base + '/mod/main.js.map')).status, 404)
  assert.equal((await fetch(base + '/mod/link.js')).status, 404)
})

async function rawUpgradeStatus(port: number, path: string): Promise<string> {
  const socket = createConnection({ host: '127.0.0.1', port })
  await once(socket, 'connect')
  const key = randomBytes(16).toString('base64')
  socket.write(
    `GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
  )
  let raw = ''
  for await (const chunk of socket) {
    raw += chunk.toString('utf8')
    if (raw.includes('\r\n\r\n')) break
  }
  socket.destroy()
  return raw.split('\r\n')[0] ?? ''
}

test('createGameHost upgrade seam upgrades WebSockets into createRoomService and rejects unhandled paths with 404', { timeout: 10_000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-ws-host-'))
  t.after(() => rm(folder, { recursive: true, force: true }))

  // 1. Host without upgrade handler cleanly rejects upgrades with 404
  const plain = createGameHost({ root: pathToFileURL(folder + '/') })
  t.after(() => plain.close())
  plain.server.listen(0, '127.0.0.1')
  await once(plain.server, 'listening')
  const plainPort = (plain.server.address() as AddressInfo).port
  assert.match(await rawUpgradeStatus(plainPort, '/rooms/test/ws'), /^HTTP\/1\.1 404 /)

  // 2. Host with upgrade seam wired to createRoomService
  const rooms = createRoomService<{ arena: string }, { x: number; revision: number }, { x: number; revision: number }>({
    createPlayer: () => ({ x: 0, revision: 0 }),
    stepPlayer(player, input, dt) {
      if (input.right) player.x += 100 * dt
      if (input.left) player.x -= 100 * dt
    },
    snapshot: player => ({ x: player.x, revision: player.revision })
  })
  const wsHost = createGameHost({
    root: pathToFileURL(folder + '/'),
    stop: rooms.close,
    upgrade(req, socket, head, pathname) {
      const match = /^\/rooms\/([a-z0-9-]+)\/ws$/.exec(pathname)
      if (!match) return false
      rooms.upgrade(req, socket, head, { key: match[1], world: { arena: match[1] } })
      return true
    }
  })
  t.after(() => wsHost.close())
  wsHost.server.listen(0, '127.0.0.1')
  await once(wsHost.server, 'listening')
  const wsPort = (wsHost.server.address() as AddressInfo).port
  assert.match(await rawUpgradeStatus(wsPort, '/unknown/ws'), /^HTTP\/1\.1 404 /)

  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/rooms/host-ws/ws`)
  t.after(() => { try { ws.close() } catch { /* ignore */ } })
  const messages: Record<string, unknown>[] = []
  let wake: (() => void) | undefined
  ws.onmessage = event => {
    messages.push(JSON.parse(String(event.data)) as Record<string, unknown>)
    wake?.()
    wake = undefined
  }
  const nextMsg = async () => {
    while (!messages.length) await new Promise<void>(resolve => { wake = resolve })
    return messages.shift()!
  }
  const welcome = await nextMsg()
  assert.equal(welcome.type, 'welcome')
  ws.send(JSON.stringify({ type: 'input', left: false, right: true, jump: 0, restart: 0, inputSeq: 1 }))
  let moved = false
  for (let i = 0; i < 60 && !moved; i++) {
    const msg = await nextMsg()
    if (msg.type === 'snapshot' && Array.isArray(msg.players)) {
      const me = (msg.players as { id: string; x: number }[]).find(p => p.id === welcome.id)
      if (me && me.x > 2) moved = true
    }
  }
  assert.equal(moved, true, 'WebSocket input through createGameHost upgrade seam must move player')
  ws.close(1000)

  // 3. Root createGameServer wires Beacon Run WS upgrades + blocks server-only modules in mounts
  const gameServer = createGameServer()
  t.after(() => gameServer.close())
  gameServer.server.listen(0, '127.0.0.1')
  await once(gameServer.server, 'listening')
  const gamePort = (gameServer.server.address() as AddressInfo).port
  const gameBase = `http://127.0.0.1:${gamePort}`
  assert.equal((await fetch(gameBase + '/game/character-store.js')).status, 404)
  assert.equal((await fetch(gameBase + '/starter/serve.js')).status, 404)
  assert.match(await rawUpgradeStatus(gamePort, '/not-a-room/ws'), /^HTTP\/1\.1 404 /)
  assert.match(await rawUpgradeStatus(gamePort, '/expeditions/ridge/guild/ws'), /^HTTP\/1\.1 401 /)

  const beaconWs = new WebSocket(`ws://127.0.0.1:${gamePort}/rooms/ridge/ws-smoke/ws`)
  t.after(() => { try { beaconWs.close() } catch { /* ignore */ } })
  const beaconWelcome = await new Promise<{ type: string; id: string; token: string }>(resolve => {
    beaconWs.onmessage = event => resolve(JSON.parse(String(event.data)))
  })
  assert.equal(beaconWelcome.type, 'welcome')
  assert.ok(beaconWelcome.id && beaconWelcome.token)
  beaconWs.close(1000)
})

test('RoomService.createHostHandlers and createGameHost upgrade rejection own route, method, and auth semantics', { timeout: 10_000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-host-handlers-'))
  t.after(() => rm(folder, { recursive: true, force: true }))

  // 1. Direct createGameHost upgrade hook returning { reject, reason }
  const rejectHost = createGameHost({
    root: pathToFileURL(folder + '/'),
    upgrade(_req, _socket, _head, pathname) {
      if (pathname === '/locked/ws') return { reject: 403, reason: 'Forbidden' }
      return false
    }
  })
  t.after(() => rejectHost.close())
  rejectHost.server.listen(0, '127.0.0.1')
  await once(rejectHost.server, 'listening')
  const rejectPort = (rejectHost.server.address() as AddressInfo).port
  assert.match(await rawUpgradeStatus(rejectPort, '/locked/ws'), /^HTTP\/1\.1 403 Forbidden/)
  assert.match(await rawUpgradeStatus(rejectPort, '/other/ws'), /^HTTP\/1\.1 404 Not Found/)

  // 2. RoomService.createHostHandlers mounted directly on createGameHost with match rejections + async authorize
  const rooms = createRoomService<{ arena: string }, { x: number; revision: number }, { x: number; revision: number }>({
    createPlayer: () => ({ x: 0, revision: 0 }),
    stepPlayer(player, input, dt) {
      if (input.right) player.x += 100 * dt
    },
    snapshot: player => ({ x: player.x, revision: player.revision })
  })

  const handlers = rooms.createHostHandlers({
    match(basePath) {
      const m = /^\/arenas\/([a-z0-9-]+)$/.exec(basePath)
      if (!m) return null
      if (m[1] === 'missing') return { reject: 404, reason: 'Not Found', message: 'Arena not found' }
      return { key: m[1], world: { arena: m[1] } }
    },
    async authorize(req, matched) {
      await Promise.resolve()
      if (matched.world.arena === 'private' && req.headers['x-pass'] !== 'ok') {
        return { ok: false, status: 401, reason: 'Unauthorized', message: 'Pass required' }
      }
      return { ok: true, world: { arena: matched.world.arena } }
    }
  })

  const app = createGameHost({
    root: pathToFileURL(folder + '/'),
    stop: rooms.close,
    ...handlers
  })
  t.after(() => app.close())
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const port = (app.server.address() as AddressInfo).port
  const base = `http://127.0.0.1:${port}`

  // Match rejection -> 404 on HTTP and WS
  const missingRes = await fetch(base + '/arenas/missing/events')
  assert.equal(missingRes.status, 404)
  assert.equal(await missingRes.text(), 'Arena not found')
  assert.match(await rawUpgradeStatus(port, '/arenas/missing/ws'), /^HTTP\/1\.1 404 Not Found/)

  // Method & upgrade enforcement -> 426 on HTTP /ws, 405 on wrong methods
  assert.equal((await fetch(base + '/arenas/alpha/ws')).status, 426)
  assert.equal((await fetch(base + '/arenas/alpha/events', { method: 'POST' })).status, 405)
  assert.equal((await fetch(base + '/arenas/alpha/input', { method: 'GET' })).status, 405)
  assert.equal((await fetch(base + '/arenas/alpha/leave', { method: 'GET' })).status, 405)

  // Async authorize rejection -> 401 on HTTP SSE and WS upgrade
  const deniedSse = await fetch(base + '/arenas/private/events')
  assert.equal(deniedSse.status, 401)
  assert.equal(await deniedSse.text(), 'Pass required')
  assert.match(await rawUpgradeStatus(port, '/arenas/private/ws'), /^HTTP\/1\.1 401 Unauthorized/)

  // Authorized SSE + POST input + leave flow
  const sse = await events(base + '/arenas/private/events', { headers: { 'x-pass': 'ok' } })
  t.after(() => sse.abort())
  const welcome = await sse.next()
  assert.ok(welcome.id && welcome.token)
  const postInput = await fetch(base + '/arenas/private/input', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + welcome.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ left: false, right: true, jump: 0, restart: 0 })
  })
  assert.equal(postInput.status, 204)
  await sse.until(snap => snap.players.some(p => p.id === welcome.id && p.x > 1))
  const leaveRes = await fetch(base + '/arenas/private/leave', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + welcome.token }
  })
  assert.equal(leaveRes.status, 204)

  // Authorized WS flow
  const ws = new WebSocket(`ws://127.0.0.1:${port}/arenas/alpha/ws`)
  t.after(() => { try { ws.close() } catch { /* ignore */ } })
  const wsWelcome = await new Promise<{ type: string; id: string; token: string }>(resolve => {
    ws.onmessage = event => resolve(JSON.parse(String(event.data)))
  })
  assert.equal(wsWelcome.type, 'welcome')
  assert.ok(wsWelcome.id && wsWelcome.token)
  ws.close(1000)
})
