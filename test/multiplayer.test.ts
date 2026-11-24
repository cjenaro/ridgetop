import type { AddressInfo } from 'node:net'
import type { RoomEntity } from '../packages/ridgetop/framework/index.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createConnection } from 'node:net'
import { connectRoom, STEP } from '../packages/ridgetop/framework/index.ts'
import { createRoomService } from '../packages/ridgetop/framework/server.ts'

interface ArenaInput {
  ax: number
  az: number
  fire: boolean
}

interface ArenaPlayer {
  id: string
  slot: number
  x: number
  z: number
  shots: number
  revision: number
}

interface ArenaSnapshot extends RoomEntity {
  x: number
  z: number
  shots: number
}

const SPEED = 120
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function parseArenaInput(raw: unknown): ArenaInput | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (
    typeof obj.ax !== 'number' || !Number.isFinite(obj.ax) || Math.abs(obj.ax) > 1 ||
    typeof obj.az !== 'number' || !Number.isFinite(obj.az) || Math.abs(obj.az) > 1 ||
    typeof obj.fire !== 'boolean'
  ) {
    return null
  }
  return { ax: obj.ax, az: obj.az, fire: obj.fire }
}

function createArenaServer(options: { maxPayloadBytes?: number } = {}) {
  const rooms = createRoomService<{ arena: string }, ArenaPlayer, Omit<ArenaSnapshot, 'id' | 'slot' | 'lastProcessedSeq'>, ArenaInput>({
    createPlayer: (id, slot) => ({ id, slot, x: slot * 10, z: 0, shots: 0, revision: 0 }),
    restartPlayer: (player, input) => ({ ...player, x: player.slot * 10, z: 0, shots: 0, revision: input.restart }),
    initialInput: () => ({ ax: 0, az: 0, fire: false }),
    parseInput: parseArenaInput,
    mergeInput: (prev, next) => ({ ax: next.ax, az: next.az, fire: prev.fire || next.fire }),
    idleInput: () => ({ ax: 0, az: 0, fire: false }),
    stepPlayer(player, input, dt) {
      player.x += input.ax * SPEED * dt
      player.z += input.az * SPEED * dt
      if (input.fire) {
        player.shots++
        input.fire = false
      }
    },
    snapshot: player => ({ x: player.x, z: player.z, shots: player.shots, revision: player.revision }),
    maxPayloadBytes: options.maxPayloadBytes
  })

  const route = /^\/rooms\/([a-z0-9-]+)\/(events|input|leave|ws)$/
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const match = route.exec(pathname)
    if (!match) {
      res.writeHead(404).end('Not found')
      return
    }
    const [, key, action] = match
    if (action === 'events' && req.method === 'GET') {
      rooms.join(req, res, { key, world: { arena: key } })
    } else if ((action === 'input' || action === 'leave') && req.method === 'POST') {
      await rooms.receive(req, res, key, action)
    } else {
      res.writeHead(405).end()
    }
  })

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const match = route.exec(pathname)
    if (!match || match[2] !== 'ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    rooms.upgrade(req, socket, head, { key: match[1], world: { arena: match[1] } })
  })

  return {
    server,
    rooms,
    async listen() {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      return (server.address() as AddressInfo).port
    },
    async close() {
      rooms.close()
      if (server.listening) {
        const closed = once(server, 'close')
        server.close()
        server.closeAllConnections()
        await closed
      }
    }
  }
}

async function openSse(url: string, headers: Record<string, string> = {}) {
  const abort = new AbortController()
  const res = await fetch(url, { headers, signal: abort.signal })
  assert.equal(res.status, 200)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  return {
    abort() { abort.abort() },
    async next<T = Record<string, unknown>>(): Promise<T> {
      while (!pending.includes('\n\n')) {
        const { value, done } = await reader.read()
        assert.equal(done, false, 'SSE stream ended early')
        pending += decoder.decode(value, { stream: true })
      }
      const split = pending.indexOf('\n\n')
      const packet = pending.slice(0, split)
      pending = pending.slice(split + 2)
      const data = packet.split('\n').find(line => line.startsWith('data: '))!
      return JSON.parse(data.slice(6)) as T
    },
    async until<T = Record<string, unknown>>(predicate: (value: T) => boolean): Promise<T> {
      for (let i = 0; i < 80; i++) {
        const value = await this.next<T>()
        if (predicate(value)) return value
      }
      assert.fail('Expected SSE snapshot did not arrive')
    }
  }
}

function makeClientWsFrame(
  opcode: number,
  payload: Buffer,
  { fin = true, rsv = 0, masked = true, mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]) } = {}
): Buffer {
  const len = payload.byteLength
  let headerLen = 2
  if (len >= 65_536) headerLen = 10
  else if (len >= 126) headerLen = 4
  const frame = Buffer.allocUnsafe(headerLen + (masked ? 4 : 0) + len)
  frame[0] = (fin ? 0x80 : 0) | ((rsv & 0x7) << 4) | (opcode & 0x0f)
  const maskBit = masked ? 0x80 : 0
  if (len < 126) {
    frame[1] = maskBit | len
  } else if (len < 65_536) {
    frame[1] = maskBit | 126
    frame.writeUInt16BE(len, 2)
  } else {
    frame[1] = maskBit | 127
    frame.writeBigUInt64BE(BigInt(len), 2)
  }
  let offset = headerLen
  if (masked) {
    mask.copy(frame, offset)
    offset += 4
    for (let i = 0; i < len; i++) frame[offset + i] = payload[i] ^ mask[i & 3]
  } else {
    payload.copy(frame, offset)
  }
  return frame
}

async function openRawWs(port: number, path: string, customHeaders?: string) {
  const socket = createConnection({ host: '127.0.0.1', port })
  await once(socket, 'connect')
  const key = randomBytes(16).toString('base64')
  const request = customHeaders ?? (
    `GET ${path} HTTP/1.1\r\n` +
    `Host: 127.0.0.1:${port}\r\n` +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Key: ${key}\r\n` +
    'Sec-WebSocket-Version: 13\r\n\r\n'
  )

  let buf: Buffer = Buffer.alloc(0)
  const waiters: (() => void)[] = []
  let ended = false
  socket.on('data', (chunk: Buffer) => {
    buf = buf.byteLength ? Buffer.concat([buf, chunk]) : chunk
    while (waiters.length) waiters.shift()!()
  })
  socket.on('close', () => {
    ended = true
    while (waiters.length) waiters.shift()!()
  })
  socket.on('error', () => {
    ended = true
    while (waiters.length) waiters.shift()!()
  })

  async function waitData() {
    if (ended) return
    await new Promise<void>(resolve => waiters.push(resolve))
  }

  socket.write(request)

  while (!buf.includes('\r\n\r\n')) {
    if (ended) break
    await waitData()
  }
  const headerEnd = buf.indexOf('\r\n\r\n')
  const headerText = headerEnd >= 0 ? buf.subarray(0, headerEnd).toString('utf8') : buf.toString('utf8')
  buf = headerEnd >= 0 ? buf.subarray(headerEnd + 4) : Buffer.alloc(0)

  async function readFrame(): Promise<{ fin: boolean; opcode: number; masked: boolean; payload: Buffer }> {
    while (buf.byteLength < 2) {
      if (ended) throw new Error('Socket closed before frame header')
      await waitData()
    }
    const b0 = buf[0]
    const b1 = buf[1]
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let len = b1 & 0x7f
    let offset = 2
    if (len === 126) {
      while (buf.byteLength < 4) {
        if (ended) throw new Error('Socket closed before extended length')
        await waitData()
      }
      len = buf.readUInt16BE(2)
      offset = 4
    } else if (len === 127) {
      while (buf.byteLength < 10) {
        if (ended) throw new Error('Socket closed before 64-bit length')
        await waitData()
      }
      len = Number(buf.readBigUInt64BE(2))
      offset = 10
    }
    const total = offset + (masked ? 4 : 0) + len
    while (buf.byteLength < total) {
      if (ended) throw new Error('Socket closed before frame payload')
      await waitData()
    }
    const payload = Buffer.from(buf.subarray(offset + (masked ? 4 : 0), total))
    buf = buf.subarray(total)
    return { fin, opcode, masked, payload }
  }

  return {
    socket,
    key,
    headerText,
    readFrame,
    async waitClose() {
      if (!ended) await once(socket, 'close')
    }
  }
}

test('custom non-platformer input schema works over SSE+POST and WebSocket in the same room', { timeout: 10_000 }, async t => {
  const app = createArenaServer()
  const port = await app.listen()
  t.after(() => app.close())

  const base = `http://127.0.0.1:${port}/rooms/arena-1`
  const sse = await openSse(base + '/events')
  t.after(() => sse.abort())
  const welcomeA = await sse.next<{ id: string; token: string }>()

  const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms/arena-1/ws`)
  t.after(() => { try { ws.close() } catch { /* ignore */ } })

  const wsMessages: Record<string, unknown>[] = []
  let wsWaiter: (() => void) | undefined
  ws.onmessage = event => {
    wsMessages.push(JSON.parse(String(event.data)) as Record<string, unknown>)
    wsWaiter?.()
    wsWaiter = undefined
  }
  async function nextWs<T = Record<string, unknown>>(): Promise<T> {
    while (!wsMessages.length) {
      await new Promise<void>(resolve => { wsWaiter = resolve })
    }
    return wsMessages.shift() as T
  }
  async function untilWs<T = Record<string, unknown>>(predicate: (v: T) => boolean): Promise<T> {
    for (let i = 0; i < 80; i++) {
      const msg = await nextWs<T>()
      if (predicate(msg)) return msg
    }
    assert.fail('Expected WebSocket snapshot did not arrive')
  }

  const welcomeB = await nextWs<{ type: string; id: string; token: string }>()
  assert.equal(welcomeB.type, 'welcome')
  assert.ok(welcomeB.id && welcomeB.token)

  // Both SSE and WS players see each other in the shared room
  const shared = await sse.until<{ tick: number; players: ArenaSnapshot[] }>(snap => snap.players.length === 2)
  assert.deepEqual(shared.players.map(p => p.id), [welcomeA.id, welcomeB.id])

  // Custom validation rejects out-of-range input over HTTP POST and accepts valid input without restart field
  const post = (action: string, token: string, body?: unknown) =>
    fetch(`${base}/${action}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

  assert.equal((await post('input', welcomeA.token, { ax: 5, az: 0, fire: false })).status, 400)
  assert.equal((await post('input', welcomeA.token, { ax: 1, az: -0.5, fire: true, inputSeq: 1 })).status, 204)

  const movedA = await sse.until<{ tick: number; players: ArenaSnapshot[] }>(snap => {
    const p = snap.players.find(item => item.id === welcomeA.id)
    return Boolean(p && p.x > 5 && p.z < -2 && p.shots === 1 && p.lastProcessedSeq === 1)
  })
  assert.equal(movedA.players.find(p => p.id === welcomeA.id)!.shots, 1)

  // Player B drives over WebSocket with custom schema + inputSeq
  ws.send(JSON.stringify({ type: 'input', ax: 0, az: 1, fire: true, inputSeq: 1 }))
  ws.send(JSON.stringify({ type: 'input', ax: 0, az: 1, fire: false, inputSeq: 2 }))

  const movedB = await untilWs<{ type: string; tick: number; players: ArenaSnapshot[] }>(msg => {
    if (msg.type !== 'snapshot') return false
    const p = msg.players.find(item => item.id === welcomeB.id)
    return Boolean(p && p.z > 4 && p.shots === 1 && p.lastProcessedSeq === 2)
  })
  assert.equal(movedB.players.find(p => p.id === welcomeB.id)!.lastProcessedSeq, 2)

  // Restart works on custom schema over WebSocket
  ws.send(JSON.stringify({ type: 'input', ax: 0, az: 0, fire: false, restart: 1, inputSeq: 3 }))
  const restartedB = await untilWs<{ type: string; tick: number; players: ArenaSnapshot[] }>(msg => {
    if (msg.type !== 'snapshot') return false
    const p = msg.players.find(item => item.id === welcomeB.id)
    return Boolean(p && p.revision === 1 && p.z === 0 && p.shots === 0)
  })
  assert.equal(restartedB.players.find(p => p.id === welcomeB.id)!.revision, 1)

  // WebSocket disconnect + resume preserves player ID & revision
  ws.close(1000)
  await sse.until<{ players: ArenaSnapshot[] }>(snap => snap.players.length === 1)

  const wsResumed = new WebSocket(`ws://127.0.0.1:${port}/rooms/arena-1/ws?resume=${encodeURIComponent(welcomeB.token)}`)
  t.after(() => { try { wsResumed.close() } catch { /* ignore */ } })
  const resumedWelcome = await new Promise<{ type: string; id: string; token: string }>(resolve => {
    wsResumed.onmessage = event => resolve(JSON.parse(String(event.data)))
  })
  assert.equal(resumedWelcome.id, welcomeB.id)
  assert.equal(resumedWelcome.token, welcomeB.token)

  // Explicit WS leave removes player immediately
  wsResumed.send(JSON.stringify({ type: 'leave' }))
  await sse.until<{ players: ArenaSnapshot[] }>(snap => snap.players.length === 1)
})

test('RFC 6455 WebSocket handshake, masked & fragmented frames, ping/pong, close, and protocol/size rejection', { timeout: 10_000 }, async t => {
  const app = createArenaServer({ maxPayloadBytes: 128 })
  const port = await app.listen()
  t.after(() => app.close())

  // 1. Invalid handshake rejections (bad key, bad version, bad method)
  const badKey = await openRawWs(
    port,
    '/rooms/proto/ws',
    `GET /rooms/proto/ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: not-valid\r\nSec-WebSocket-Version: 13\r\n\r\n`
  )
  assert.match(badKey.headerText, /^HTTP\/1\.1 400 /)
  badKey.socket.destroy()

  const badVersion = await openRawWs(
    port,
    '/rooms/proto/ws',
    `GET /rooms/proto/ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 8\r\n\r\n`
  )
  assert.match(badVersion.headerText, /^HTTP\/1\.1 426 /)
  assert.match(badVersion.headerText, /Sec-WebSocket-Version: 13/)
  badVersion.socket.destroy()

  // 2. Valid RFC 6455 handshake + Sec-WebSocket-Accept verification
  const client = await openRawWs(port, '/rooms/proto/ws')
  t.after(() => client.socket.destroy())
  assert.match(client.headerText, /^HTTP\/1\.1 101 Switching Protocols\r\n/)
  const expectedAccept = createHash('sha1').update(client.key + WS_GUID).digest('base64')
  assert.ok(client.headerText.includes(`Sec-WebSocket-Accept: ${expectedAccept}`))

  // First server frame must be unmasked text welcome frame
  const welcomeFrame = await client.readFrame()
  assert.equal(welcomeFrame.fin, true)
  assert.equal(welcomeFrame.opcode, 0x1)
  assert.equal(welcomeFrame.masked, false)
  const welcome = JSON.parse(welcomeFrame.payload.toString('utf8')) as { type: string; id: string; token: string }
  assert.equal(welcome.type, 'welcome')

  // 3. Fragmented masked text frame with an interleaved Ping control frame in the middle!
  const msgBytes = Buffer.from(JSON.stringify({ ax: 1, az: 0, fire: true, inputSeq: 1 }), 'utf8')
  const part1 = msgBytes.subarray(0, 12)
  const part2 = msgBytes.subarray(12)
  const pingPayload = Buffer.from('ping-42', 'utf8')

  // Send fragment 1 (split across two TCP writes to test incremental buffering)
  const frag1 = makeClientWsFrame(0x1, part1, { fin: false })
  client.socket.write(frag1.subarray(0, 3))
  client.socket.write(frag1.subarray(3))
  // Interleave Ping mid-fragmentation (valid per RFC 6455 §5.4)
  client.socket.write(makeClientWsFrame(0x9, pingPayload, { fin: true }))
  // Send final continuation fragment
  client.socket.write(makeClientWsFrame(0x0, part2, { fin: true }))

  // Wait for Pong reply (skipping any snapshots that may arrive around it)
  let gotPong = false
  let gotMoved = false
  for (let i = 0; i < 60 && (!gotPong || !gotMoved); i++) {
    const frame = await client.readFrame()
    if (frame.opcode === 0xa) {
      assert.deepEqual(frame.payload, pingPayload)
      gotPong = true
    } else if (frame.opcode === 0x1) {
      const data = JSON.parse(frame.payload.toString('utf8')) as { type: string; players?: ArenaSnapshot[] }
      const me = data.players?.find(p => p.id === welcome.id)
      if (me && me.x > 0 && me.shots === 1 && me.lastProcessedSeq === 1) gotMoved = true
    }
  }
  assert.equal(gotPong, true, 'Server must echo Pong with exact Ping payload')
  assert.equal(gotMoved, true, 'Server must reassemble fragmented masked text frame')

  // 4. Clean Close handshake (client sends Close 1000 -> server echoes Close 1000)
  const closeBody = Buffer.allocUnsafe(2)
  closeBody.writeUInt16BE(1000, 0)
  client.socket.write(makeClientWsFrame(0x8, closeBody))
  let closeCode = -1
  for (let i = 0; i < 40; i++) {
    const frame = await client.readFrame()
    if (frame.opcode === 0x8) {
      closeCode = frame.payload.readUInt16BE(0)
      break
    }
  }
  assert.equal(closeCode, 1000)
  await client.waitClose()

  // 5. Unmasked client frame -> Close 1002 Protocol Error
  const unmasked = await openRawWs(port, '/rooms/proto-err/ws')
  t.after(() => unmasked.socket.destroy())
  await unmasked.readFrame() // welcome
  unmasked.socket.write(makeClientWsFrame(0x1, Buffer.from('{}'), { masked: false }))
  let errCode = -1
  for (let i = 0; i < 20; i++) {
    const frame = await unmasked.readFrame()
    if (frame.opcode === 0x8) { errCode = frame.payload.readUInt16BE(0); break }
  }
  assert.equal(errCode, 1002)

  // 6. Reserved bits set -> Close 1002 Protocol Error
  const badRsv = await openRawWs(port, '/rooms/proto-err/ws')
  t.after(() => badRsv.socket.destroy())
  await badRsv.readFrame() // welcome
  badRsv.socket.write(makeClientWsFrame(0x1, Buffer.from('{}'), { rsv: 0x4 }))
  let rsvCode = -1
  for (let i = 0; i < 20; i++) {
    const frame = await badRsv.readFrame()
    if (frame.opcode === 0x8) { rsvCode = frame.payload.readUInt16BE(0); break }
  }
  assert.equal(rsvCode, 1002)

  // 7. Binary frame -> Close 1003 Unsupported Data
  const binClient = await openRawWs(port, '/rooms/proto-err/ws')
  t.after(() => binClient.socket.destroy())
  await binClient.readFrame() // welcome
  binClient.socket.write(makeClientWsFrame(0x2, Buffer.from([1, 2, 3])))
  let binCode = -1
  for (let i = 0; i < 20; i++) {
    const frame = await binClient.readFrame()
    if (frame.opcode === 0x8) { binCode = frame.payload.readUInt16BE(0); break }
  }
  assert.equal(binCode, 1003)

  // 8. Oversized payload (> maxPayloadBytes: 128) -> Close 1009 Message Too Big
  const bigClient = await openRawWs(port, '/rooms/proto-err/ws')
  t.after(() => bigClient.socket.destroy())
  await bigClient.readFrame() // welcome
  bigClient.socket.write(makeClientWsFrame(0x1, Buffer.alloc(200, 0x61)))
  let bigCode = -1
  for (let i = 0; i < 20; i++) {
    const frame = await bigClient.readFrame()
    if (frame.opcode === 0x8) { bigCode = frame.payload.readUInt16BE(0); break }
  }
  assert.equal(bigCode, 1009)

  // 9. Fragmented control frame -> Close 1002 Protocol Error
  const fragCtrl = await openRawWs(port, '/rooms/proto-err/ws')
  t.after(() => fragCtrl.socket.destroy())
  await fragCtrl.readFrame() // welcome
  fragCtrl.socket.write(makeClientWsFrame(0x9, Buffer.from('x'), { fin: false }))
  let fragCtrlCode = -1
  for (let i = 0; i < 20; i++) {
    const frame = await fragCtrl.readFrame()
    if (frame.opcode === 0x8) { fragCtrlCode = frame.payload.readUInt16BE(0); break }
  }
  assert.equal(fragCtrlCode, 1002)

  // 10. Invalid UTF-8 in text frame -> Close 1007 Invalid frame payload data
  const badUtf8 = await openRawWs(port, '/rooms/proto-err/ws')
  t.after(() => badUtf8.socket.destroy())
  await badUtf8.readFrame() // welcome
  badUtf8.socket.write(makeClientWsFrame(0x1, Buffer.from([0xff, 0xfe, 0xfd])))
  let utf8Code = -1
  for (let i = 0; i < 20; i++) {
    const frame = await badUtf8.readFrame()
    if (frame.opcode === 0x8) { utf8Code = frame.payload.readUInt16BE(0); break }
  }
  assert.equal(utf8Code, 1007)

  // 11. Pipelined frame arriving in upgrade `head` buffer is processed immediately
  const pipeSocket = createConnection({ host: '127.0.0.1', port })
  t.after(() => pipeSocket.destroy())
  await once(pipeSocket, 'connect')
  const pipeKey = randomBytes(16).toString('base64')
  const pipePing = Buffer.from('in-head', 'utf8')
  const pipeReq = Buffer.concat([
    Buffer.from(
      `GET /rooms/proto-head/ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${pipeKey}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      'utf8'
    ),
    makeClientWsFrame(0x9, pipePing)
  ])
  let pipeBuf: Buffer = Buffer.alloc(0)
  let pipeWaiter: (() => void) | undefined
  pipeSocket.on('data', (chunk: Buffer) => {
    pipeBuf = pipeBuf.byteLength ? Buffer.concat([pipeBuf, chunk]) : chunk
    pipeWaiter?.()
    pipeWaiter = undefined
  })
  pipeSocket.write(pipeReq)
  let foundHeadPong = false
  for (let i = 0; i < 30 && !foundHeadPong; i++) {
    if (pipeBuf.includes(pipePing)) foundHeadPong = true
    else await new Promise<void>(resolve => { pipeWaiter = resolve })
  }
  assert.equal(foundHeadPong, true, 'Ping pipelined in upgrade head buffer must receive Pong')
})

test('connectRoom supports auto transport fallback to SSE+POST and direct WS transport', { timeout: 10_000 }, async t => {
  // Part 1: Direct WS against real server with custom input & onWelcome
  const app = createArenaServer()
  const port = await app.listen()
  t.after(() => app.close())

  let currentInput: ArenaInput = { ax: 0, az: 0, fire: false }
  const statuses: string[] = []
  let welcomedId: string | undefined

  const wsRoom = connectRoom<ArenaSnapshot, ArenaInput>({
    endpoint: `http://127.0.0.1:${port}/rooms/auto-ws`,
    transport: 'auto',
    readInput: () => currentInput,
    onStatus: status => statuses.push(status),
    onWelcome: w => { welcomedId = w.id }
  })
  t.after(() => wsRoom.close())

  // Wait for welcome over WS
  for (let i = 0; i < 50 && !welcomedId; i++) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.ok(welcomedId)
  assert.equal(wsRoom.transport, 'ws')
  assert.equal(statuses[statuses.length - 1], 'connected')

  currentInput = { ax: 1, az: 0.5, fire: true }
  await wsRoom.flush(0)

  let moved: ArenaSnapshot | undefined
  for (let i = 0; i < 50; i++) {
    const sample = wsRoom.sample(performance.now())
    const me = sample.find(p => p.id === welcomedId)
    if (me && me.x > 2 && me.z > 1 && me.shots >= 1) {
      moved = me
      break
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.ok(moved, 'connectRoom over WS should move player and receive snapshots')
  wsRoom.close()

  // Part 2: transport='auto' falls back to SSE+POST when WebSocket upgrade fails
  const prevES = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  const prevWS = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
  const prevFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')

  let fakeEs: (EventTarget & { readyState: number; close(): void; onmessage: ((e: MessageEvent) => void) | null; onerror: (() => void) | null }) | undefined
  const posted: Record<string, unknown>[] = []

  class FailingWebSocket {
    static OPEN = 1
    readyState = 3
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    constructor() {
      queueMicrotask(() => {
        this.onerror?.()
        this.onclose?.()
      })
    }
    close() {}
    send() {}
  }

  class FakeEventSource extends EventTarget {
    static OPEN = 1
    static CLOSED = 2
    readyState = 1
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    constructor() {
      super()
      fakeEs = this
    }
    close() { this.readyState = 2 }
  }

  Object.defineProperty(globalThis, 'WebSocket', { value: FailingWebSocket, configurable: true })
  Object.defineProperty(globalThis, 'EventSource', { value: FakeEventSource, configurable: true })
  Object.defineProperty(globalThis, 'fetch', {
    value: async (_url: string, init?: RequestInit) => {
      if (init?.body) posted.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return { ok: true }
    },
    configurable: true
  })

  try {
    const fallbackStatuses: string[] = []
    const fallbackRoom = connectRoom<ArenaSnapshot, ArenaInput>({
      endpoint: '/rooms/fallback',
      transport: 'auto',
      readInput: () => ({ ax: -0.5, az: 0.25, fire: false }),
      onStatus: s => fallbackStatuses.push(s)
    })
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(fallbackRoom.transport, 'sse')
    assert.ok(fakeEs, 'Fallback must create EventSource when WebSocket fails')
    fakeEs!.dispatchEvent(Object.assign(new Event('welcome'), { data: JSON.stringify({ id: 'p-sse', token: 'tok-sse' }) }))
    assert.deepEqual(fallbackStatuses, ['connected'])
    await fallbackRoom.flush(0)
    assert.equal(posted.length, 1)
    assert.equal(posted[0].ax, -0.5)
    assert.equal(posted[0].az, 0.25)
    assert.equal(posted[0].fire, false)
    fallbackRoom.close()
  } finally {
    if (prevWS) Object.defineProperty(globalThis, 'WebSocket', prevWS)
    else delete (globalThis as Record<string, unknown>).WebSocket
    if (prevES) Object.defineProperty(globalThis, 'EventSource', prevES)
    else delete (globalThis as Record<string, unknown>).EventSource
    if (prevFetch) Object.defineProperty(globalThis, 'fetch', prevFetch)
  }
})

test('client-side prediction & server reconciliation under simulated latency with remote interpolation', async () => {
  const prevWS = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
  const sentFrames: Record<string, unknown>[] = []
  let fakeWs: FakeWS | undefined

  class FakeWS {
    static OPEN = 1
    readyState = 1
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    constructor() { fakeWs = this }
    send(data: string) { sentFrames.push(JSON.parse(data) as Record<string, unknown>) }
    close() { this.readyState = 3 }
    deliver(payload: unknown) {
      this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
    }
  }

  Object.defineProperty(globalThis, 'WebSocket', { value: FakeWS, configurable: true })

  try {
    let input: ArenaInput = { ax: 1, az: 0, fire: false }
    let equalsCalls = 0

    const predictStep = (state: ArenaSnapshot, inp: ArenaInput, dt: number): ArenaSnapshot => ({
      ...state,
      x: state.x + inp.ax * SPEED * dt,
      z: state.z + inp.az * SPEED * dt,
      shots: state.shots + (inp.fire ? 1 : 0)
    })

    const room = connectRoom<ArenaSnapshot, ArenaInput>({
      endpoint: '/rooms/predict-test',
      transport: 'ws',
      readInput: () => input,
      onStatus() {},
      predict: {
        step: predictStep,
        equals(a, b) {
          equalsCalls++
          return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6 && a.shots === b.shots
        }
      }
    })

    // 1. Welcome + initial authoritative snapshot (tick 0, local at x=0, remote at x=10)
    fakeWs!.deliver({ type: 'welcome', id: 'local', token: 'tok-local' })
    fakeWs!.deliver({
      type: 'snapshot',
      tick: 3,
      players: [
        { id: 'local', slot: 0, x: 0, z: 0, shots: 0, revision: 0, lastProcessedSeq: 0 },
        { id: 'remote', slot: 1, x: 10, z: 0, shots: 0, revision: 0, lastProcessedSeq: 0 }
      ]
    })

    // 2. Simulate 5 local fixed ticks under latency (NO server snapshots arrive yet!)
    //    Ticks 1..3: move +x; Tick 4: move +x & fire; Tick 5: move +z
    for (let tick = 1; tick <= 5; tick++) {
      if (tick === 4) input = { ax: 1, az: 0, fire: true }
      else if (tick === 5) input = { ax: 0, az: 1, fire: false }
      else input = { ax: 1, az: 0, fire: false }
      room.step(STEP)
      await room.flush(tick * 16)
    }

    // All 5 inputs transmitted with monotonic inputSeq 1..5
    assert.deepEqual(sentFrames.map(f => f.inputSeq), [1, 2, 3, 4, 5])

    // Local player is ALREADY predicted at x = 4 * SPEED * STEP, z = 1 * SPEED * STEP, shots = 1!
    const stepDist = SPEED * STEP
    const immediate = room.sample(performance.now()).find(p => p.id === 'local')!
    assert.ok(Math.abs(immediate.x - 4 * stepDist) < 1e-6)
    assert.ok(Math.abs(immediate.z - 1 * stepDist) < 1e-6)
    assert.equal(immediate.shots, 1)

    // 3. Delayed server snapshot arrives acknowledging lastProcessedSeq=2 (matching prediction)
    //    while remote player moved from x=10 to x=20 between tick 3 and tick 6
    const snapTime = performance.now()
    fakeWs!.deliver({
      type: 'snapshot',
      tick: 6,
      players: [
        { id: 'local', slot: 0, x: 2 * stepDist, z: 0, shots: 0, revision: 0, lastProcessedSeq: 2 },
        { id: 'remote', slot: 1, x: 20, z: 0, shots: 0, revision: 0, lastProcessedSeq: 0 }
      ]
    })

    // Reconciliation discards seq 1..2, replays seq 3, 4, 5 -> matches predicted state seamlessly!
    assert.ok(equalsCalls >= 1)
    const halfway = snapTime + 1.5 * STEP * 1000 // alpha ~= 0.5 of 3-tick interval
    const sampled = room.sample(halfway)
    const localAfterAck2 = sampled.find(p => p.id === 'local')!
    const remoteHalfway = sampled.find(p => p.id === 'remote')!

    assert.ok(Math.abs(localAfterAck2.x - 4 * stepDist) < 1e-6)
    assert.ok(Math.abs(localAfterAck2.z - 1 * stepDist) < 1e-6)
    assert.equal(localAfterAck2.shots, 1)
    // Remote player is smoothly interpolated (between 10 and 20, roughly ~15)
    assert.ok(remoteHalfway.x > 13 && remoteHalfway.x < 17, `Expected remote interpolation near 15, got ${remoteHalfway.x}`)

    // 4. Server sends authoritative correction at lastProcessedSeq=4 (e.g. wall blocked x at 2.5 * stepDist)
    fakeWs!.deliver({
      type: 'snapshot',
      tick: 9,
      players: [
        { id: 'local', slot: 0, x: 2.5 * stepDist, z: 0, shots: 1, revision: 0, lastProcessedSeq: 4 },
        { id: 'remote', slot: 1, x: 30, z: 0, shots: 0, revision: 0, lastProcessedSeq: 0 }
      ]
    })

    // Unacked seq 5 ({ ax: 0, az: 1, fire: false }) is replayed onto corrected authoritative state!
    const localCorrected = room.sample(performance.now()).find(p => p.id === 'local')!
    assert.ok(Math.abs(localCorrected.x - 2.5 * stepDist) < 1e-6)
    assert.ok(Math.abs(localCorrected.z - 1 * stepDist) < 1e-6)
    assert.equal(localCorrected.shots, 1)

    // 5. Final authoritative snapshot acknowledging lastProcessedSeq=5 clears all pending inputs
    fakeWs!.deliver({
      type: 'snapshot',
      tick: 12,
      players: [
        { id: 'local', slot: 0, x: 2.5 * stepDist, z: 1 * stepDist, shots: 1, revision: 0, lastProcessedSeq: 5 },
        { id: 'remote', slot: 1, x: 30, z: 0, shots: 0, revision: 0, lastProcessedSeq: 0 }
      ]
    })
    const localConverged = room.sample(performance.now()).find(p => p.id === 'local')!
    assert.ok(Math.abs(localConverged.x - 2.5 * stepDist) < 1e-6)
    assert.ok(Math.abs(localConverged.z - 1 * stepDist) < 1e-6)
    room.close()
  } finally {
    if (prevWS) Object.defineProperty(globalThis, 'WebSocket', prevWS)
    else delete (globalThis as Record<string, unknown>).WebSocket
  }
})

test('live WebSocket end-to-end prediction and reconciliation converges with authoritative server', { timeout: 10_000 }, async t => {
  const app = createArenaServer()
  const port = await app.listen()
  t.after(() => app.close())

  let input: ArenaInput = { ax: 0, az: 0, fire: false }
  let welcomed = false
  const room = connectRoom<ArenaSnapshot, ArenaInput>({
    endpoint: `http://127.0.0.1:${port}/rooms/live-predict`,
    transport: 'ws',
    readInput: () => input,
    onStatus() {},
    onWelcome() { welcomed = true },
    predict: {
      step(state, inp, dt) {
        return {
          ...state,
          x: state.x + inp.ax * SPEED * dt,
          z: state.z + inp.az * SPEED * dt,
          shots: state.shots + (inp.fire ? 1 : 0)
        }
      }
    }
  })
  t.after(() => room.close())

  // Wait for initial snapshot so predicted state anchors to authoritative spawn
  for (let i = 0; i < 60; i++) {
    if (welcomed && room.sample(performance.now()).length > 0) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.ok(welcomed)
  const initial = room.sample(performance.now()).find(p => p.id === room.id)!
  assert.equal(initial.x, 0)

  // Step 3 predicted frames locally moving +x, then stop
  input = { ax: 1, az: 0, fire: false }
  room.step(STEP)
  room.step(STEP)
  room.step(STEP)
  input = { ax: 0, az: 0, fire: false }
  room.step(STEP)

  // Immediately predicted at 3 * SPEED * STEP before even flushing!
  const beforeFlush = room.sample(performance.now()).find(p => p.id === room.id)!
  assert.ok(Math.abs(beforeFlush.x - 3 * SPEED * STEP) < 1e-5)

  // Flush all 4 sequenced inputs over real WebSocket and wait for server to ack lastProcessedSeq=4
  await room.flush(0)
  let converged = false
  for (let i = 0; i < 60; i++) {
    const me = room.sample(performance.now()).find(p => p.id === room.id)!
    if ((me.lastProcessedSeq ?? 0) >= 4) {
      assert.ok(Math.abs(me.x - 3 * SPEED * STEP) < 1e-4, `Expected converged x=${3 * SPEED * STEP}, got ${me.x}`)
      converged = true
      break
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.equal(converged, true, 'Server must process all 4 queued inputs and converge identically with prediction')
})

test('connectRoom custom equalInput, serializeInput, and flush-driven prediction without explicit step()', async () => {
  const prevWS = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket')
  const sentFrames: Record<string, unknown>[] = []
  let fakeWs: FakeWS | undefined

  class FakeWS {
    static OPEN = 1
    readyState = 1
    onmessage: ((e: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    onclose: (() => void) | null = null
    constructor() { fakeWs = this }
    send(data: string) { sentFrames.push(JSON.parse(data) as Record<string, unknown>) }
    close() { this.readyState = 3 }
    deliver(payload: unknown) {
      this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent)
    }
  }

  Object.defineProperty(globalThis, 'WebSocket', { value: FakeWS, configurable: true })
  try {
    let input: ArenaInput = { ax: 1, az: 0, fire: false }
    let serializeCount = 0
    const room = connectRoom<ArenaSnapshot, ArenaInput>({
      endpoint: '/rooms/hooks-test',
      transport: 'ws',
      readInput: () => input,
      onStatus() {},
      equalInput: (a, b) => a.ax === b.ax && a.az === b.az && a.fire === b.fire,
      serializeInput(inp, meta) {
        serializeCount++
        return { ax: inp.ax, az: inp.az, fire: inp.fire, restart: meta.restart, inputSeq: meta.inputSeq, customTag: true }
      },
      predict: {
        step: (state, inp, dt) => ({ ...state, x: state.x + inp.ax * SPEED * dt })
      }
    })
    fakeWs!.deliver({ type: 'welcome', id: 'p1', token: 't1' })
    fakeWs!.deliver({
      type: 'snapshot',
      tick: 3,
      players: [{ id: 'p1', slot: 0, x: 0, z: 0, shots: 0, revision: 0, lastProcessedSeq: 0 }]
    })

    // Drive prediction purely through flush(now) timestamps (like main.ts does!)
    await room.flush(0)
    await room.flush(1000 / 60)
    await room.flush(2000 / 60)
    assert.equal(serializeCount, 3)
    assert.equal(sentFrames[0].customTag, true)
    assert.deepEqual(sentFrames.map(f => f.inputSeq), [1, 2, 3])
    const local = room.sample(performance.now()).find(p => p.id === 'p1')!
    assert.ok(Math.abs(local.x - 3 * SPEED * STEP) < 1e-4)
    room.close()
  } finally {
    if (prevWS) Object.defineProperty(globalThis, 'WebSocket', prevWS)
    else delete (globalThis as Record<string, unknown>).WebSocket
  }
})
