import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { RoomInput } from './types.ts'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { STEP } from './loop.ts'
import { sendText } from './host.ts'

const emptyInput: RoomInput = Object.freeze({ left: false, right: false, jump: 0 })
const resumeMs = 15_000
const frameBudget = 16_384
const maxInputQueue = 64
const wsGuid = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const wsKeyPattern = /^[A-Za-z0-9+/]{22}==$/
const utf8Fatal = new TextDecoder('utf-8', { fatal: true })

export interface RoomJoinOptions<World> {
  key: string
  world: World
  identity?: string
  resume?: string
}

export interface RoomServiceOptions<World, Player, Snapshot extends object, Input = RoomInput> {
  createPlayer(id: string, slot: number, world: World): Player
  restartPlayer?(player: Player, input: Input & { restart: number }, world: World): Player
  stepPlayer(player: Player, input: Input, dt: number, world: World, identity?: string): void
  snapshot(player: Player, world: World, identity?: string): Snapshot
  beforePublish?(world: World, connected: readonly { player: Player; identity?: string }[], tick: number): void
  parseInput?(raw: unknown, previous: Input): Input | null
  initialInput?(): Input
  mergeInput?(previous: Input, next: Input): Input
  idleInput?(previous: Input): Input
  maxPayloadBytes?: number
}

function defaultParseInput(raw: unknown, previous: RoomInput): RoomInput | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = raw as Record<string, unknown>
  if (
    typeof candidate.left !== 'boolean' ||
    typeof candidate.right !== 'boolean' ||
    !Number.isSafeInteger(candidate.jump) ||
    (candidate.jump as number) < previous.jump
  ) {
    return null
  }
  return { left: candidate.left, right: candidate.right, jump: candidate.jump as number }
}

function defaultIdleInput(previous: RoomInput): RoomInput {
  return { left: false, right: false, jump: previous.jump }
}

function encodeWsFrame(opcode: number, payload: Buffer): Buffer {
  const len = payload.byteLength
  let headerLen = 2
  if (len >= 65_536) headerLen = 10
  else if (len >= 126) headerLen = 4
  const frame = Buffer.allocUnsafe(headerLen + len)
  frame[0] = 0x80 | (opcode & 0x0f)
  if (len < 126) {
    frame[1] = len
  } else if (len < 65_536) {
    frame[1] = 126
    frame.writeUInt16BE(len, 2)
  } else {
    frame[1] = 127
    frame.writeBigUInt64BE(BigInt(len), 2)
  }
  payload.copy(frame, headerLen)
  return frame
}

function truncateUtf8(text: string, maxBytes: number): Buffer {
  const buf = Buffer.from(text, 'utf8')
  if (buf.byteLength <= maxBytes) return buf
  let end = maxBytes
  // Step back over UTF-8 continuation bytes (10xxxxxx) to find the start of the split character.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  // If the byte at `end` is a multi-byte lead byte whose full sequence exceeds maxBytes, exclude it.
  if (end > 0 && (buf[end] & 0x80) !== 0) {
    const lead = buf[end]
    const charLen = (lead & 0xe0) === 0xc0 ? 2 : (lead & 0xf0) === 0xe0 ? 3 : (lead & 0xf8) === 0xf0 ? 4 : 1
    if (end + charLen > maxBytes) return buf.subarray(0, end)
  }
  return buf.subarray(0, end)
}

function encodeWsClose(code: number, reason = ''): Buffer {
  const reasonBuf = reason ? truncateUtf8(reason, 123) : Buffer.alloc(0)
  const payload = Buffer.allocUnsafe(2 + reasonBuf.byteLength)
  payload.writeUInt16BE(code, 0)
  reasonBuf.copy(payload, 2)
  return encodeWsFrame(0x8, payload)
}

function isValidWireCloseCode(code: number): boolean {
  if (code >= 3000 && code <= 4999) return true
  return (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011)
}

function rejectUpgrade(socket: Duplex, status: number, reason: string, extraHeaders = '') {
  if (socket.listenerCount('error') === 0) socket.on('error', () => { /* ignore pre-close socket error */ })
  if (!socket.destroyed && socket.writable) {
    try {
      socket.write(`HTTP/1.1 ${status} ${reason}\r\nContent-Length: 0\r\nConnection: close\r\n${extraHeaders}\r\n`)
    } catch {
      /* ignore write errors on closing socket */
    }
  }
  socket.destroy()
}

function headerHasToken(value: string | string[] | undefined, token: string): boolean {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '')
  return raw.split(',').some(part => part.trim().toLowerCase() === token)
}

function extractResumeFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url, 'http://localhost').searchParams.get('resume') ?? ''
  } catch {
    return ''
  }
}

export function createRoomService<World, Player, Snapshot extends object, Input = RoomInput>({
  createPlayer,
  restartPlayer,
  stepPlayer,
  snapshot,
  beforePublish,
  parseInput,
  initialInput,
  mergeInput,
  idleInput,
  maxPayloadBytes
}: RoomServiceOptions<World, Player, Snapshot, Input>) {
  const customSchema = Boolean(parseInput || initialInput || mergeInput || idleInput)
  const makeInitialInput: () => Input = initialInput ?? (() => ({ ...emptyInput }) as unknown as Input)
  const validateInput: (raw: unknown, previous: Input) => Input | null =
    parseInput ?? ((raw, previous) => defaultParseInput(raw, previous as unknown as RoomInput) as unknown as Input | null)
  const combineInput: (previous: Input, next: Input) => Input = mergeInput ?? ((_previous, next) => next)
  const toIdleInput: (previous: Input) => Input =
    idleInput ??
    (initialInput
      ? () => makeInitialInput()
      : previous => defaultIdleInput(previous as unknown as RoomInput) as unknown as Input)
  const httpPayloadLimit = maxPayloadBytes ?? 512
  const wsPayloadLimit = maxPayloadBytes ?? 4096

  type MemberTransport =
    | { kind: 'sse'; res: ServerResponse }
    | { kind: 'ws'; socket: Duplex; close(code?: number, reason?: string): void }

  type QueuedInput = { input: Input; seq: number }

  type Member = {
    id: string
    slot: number
    player: Player
    input: Input
    transport: MemberTransport | null
    lastInput: number
    idle: boolean
    restart: number
    receivedSeq: number
    lastProcessedSeq: number
    inputQueue: QueuedInput[]
    expiresAt: number
    identity?: string
  }

  type Room = { world: World; members: Map<string, Member> }
  const rooms = new Map<string, Room>()

  function detachMember(member: Member, transport: MemberTransport) {
    if (member.transport !== transport) return
    member.transport = null
    member.expiresAt = performance.now() + resumeMs
    member.input = toIdleInput(member.input)
    member.idle = true
    member.inputQueue.length = 0
  }

  function removeMember(key: string, room: Room, token: string, member: Member) {
    room.members.delete(token)
    const transport = member.transport
    member.transport = null
    member.inputQueue.length = 0
    if (transport) {
      if (transport.kind === 'sse') transport.res.end()
      else transport.close(1000, 'Left room')
    }
    if (!room.members.size) {
      rooms.delete(key)
      if (!rooms.size) stopTimer()
    }
  }

  function allocateMember(
    key: string,
    world: World,
    identity: string | undefined,
    resume: string
  ): { ok: true; room: Room; isNewRoom: boolean; member: Member; token: string } | { ok: false; status: number; message: string } {
    let room = rooms.get(key)
    const isNewRoom = !room
    if (!room) {
      if (rooms.size >= 128) return { ok: false, status: 503, message: 'Server is full' }
      room = { world, members: new Map() }
    }
    let member = resume ? room.members.get(resume) : undefined
    if (member && member.identity !== identity) return { ok: false, status: 401, message: '' }
    if (member?.transport) return { ok: false, status: 409, message: 'Player already connected' }
    let token = resume
    if (!member) {
      const used = new Set(Array.from(room.members.values(), item => item.slot))
      if (used.size >= 8) return { ok: false, status: 409, message: 'Room is full' }
      const slot = [0, 1, 2, 3, 4, 5, 6, 7].find(index => !used.has(index))!
      const id = randomUUID()
      token = randomUUID()
      member = {
        id,
        slot,
        player: createPlayer(id, slot, room.world),
        input: makeInitialInput(),
        transport: null,
        lastInput: 0,
        idle: true,
        restart: 0,
        receivedSeq: 0,
        lastProcessedSeq: 0,
        inputQueue: [],
        expiresAt: Infinity,
        identity
      }
      room.members.set(token, member)
    }
    if (isNewRoom) rooms.set(key, room)
    return { ok: true, room, isNewRoom, member, token }
  }

  function applyInputPayload(room: Room, member: Member, raw: unknown): boolean {
    if (!raw || typeof raw !== 'object') return false
    const envelope = raw as Record<string, unknown>
    const inputSource =
      envelope.type === 'input' && envelope.input && typeof envelope.input === 'object'
        ? envelope.input
        : raw

    const rawRestart =
      envelope.restart !== undefined
        ? envelope.restart
        : (inputSource as Record<string, unknown>).restart
    let restart = member.restart
    if (rawRestart !== undefined) {
      if (!Number.isSafeInteger(rawRestart) || (rawRestart as number) < member.restart) return false
      restart = rawRestart as number
    } else if (!customSchema) {
      return false
    }

    const rawSeq =
      envelope.inputSeq !== undefined
        ? envelope.inputSeq
        : (inputSource as Record<string, unknown>).inputSeq
    let seq: number | undefined
    if (rawSeq !== undefined) {
      if (!Number.isSafeInteger(rawSeq) || (rawSeq as number) < 0 || (rawSeq as number) < member.receivedSeq) {
        return false
      }
      seq = rawSeq as number
    }

    const latestInput = member.inputQueue.length > 0 ? member.inputQueue[member.inputQueue.length - 1].input : member.input
    const parsed = validateInput(inputSource, latestInput)
    if (parsed === null) return false

    const now = performance.now()
    if (restart > member.restart) {
      member.restart = restart
      member.inputQueue.length = 0
      if (restartPlayer) {
        const restartInput =
          parsed && typeof parsed === 'object'
            ? ({ ...(parsed as Record<string, unknown>), restart } as Input & { restart: number })
            : ({ restart } as unknown as Input & { restart: number })
        member.player = restartPlayer(member.player, restartInput, room.world)
      }
      member.input = parsed
      member.idle = false
      member.lastInput = now
      if (seq !== undefined) {
        member.receivedSeq = seq
        member.lastProcessedSeq = seq
      }
      return true
    }

    member.lastInput = now
    member.idle = false
    if (seq !== undefined) {
      if (seq > member.receivedSeq) {
        member.receivedSeq = seq
        if (member.inputQueue.length >= maxInputQueue) {
          const dropped = member.inputQueue.shift()!
          member.input = combineInput(member.input, dropped.input)
        }
        member.inputQueue.push({ input: parsed, seq })
      } else {
        // Equal seq (heartbeat / idempotent resend): keep current input fresh without re-queueing.
        member.input = combineInput(member.input, parsed)
      }
    } else {
      member.input = combineInput(member.input, parsed)
    }
    return true
  }

  function join(req: IncomingMessage, res: ServerResponse, { key, world, identity, resume }: RoomJoinOptions<World>) {
    if (res.destroyed || res.writableEnded) return
    const resumeToken = resume ?? String(req.headers['last-event-id'] ?? '')
    const result = allocateMember(key, world, identity, resumeToken)
    if ('status' in result) return sendText(res, result.status, result.message)
    const { member, token } = result
    const transport: MemberTransport = { kind: 'sse', res }
    member.transport = transport
    member.expiresAt = Infinity
    member.lastInput = performance.now()
    startTimer()
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    })
    res.write(`retry: 800\nid: ${token}\nevent: welcome\ndata: ${JSON.stringify({ id: member.id, token })}\n\n`)
    const detach = () => detachMember(member, transport)
    if (res.destroyed || res.writableEnded) detach()
    else res.on('close', detach)
  }

  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, { key, world, identity, resume }: RoomJoinOptions<World>): boolean {
    if (socket.destroyed) return false
    if (req.method !== 'GET') {
      rejectUpgrade(socket, 405, 'Method Not Allowed')
      return false
    }
    const wsVersion = String(req.headers['sec-websocket-version'] ?? '')
    if (wsVersion !== '13') {
      rejectUpgrade(socket, 426, 'Upgrade Required', 'Sec-WebSocket-Version: 13\r\n')
      return false
    }
    const wsKey = typeof req.headers['sec-websocket-key'] === 'string' ? req.headers['sec-websocket-key'].trim() : ''
    if (
      !headerHasToken(req.headers.upgrade, 'websocket') ||
      !headerHasToken(req.headers.connection, 'upgrade') ||
      !wsKeyPattern.test(wsKey) ||
      Buffer.from(wsKey, 'base64').byteLength !== 16
    ) {
      rejectUpgrade(socket, 400, 'Bad Request')
      return false
    }

    const resumeToken = resume ?? (extractResumeFromUrl(req.url) || String(req.headers['last-event-id'] ?? ''))
    const result = allocateMember(key, world, identity, resumeToken)
    if ('status' in result) {
      const reason = result.message || (result.status === 401 ? 'Unauthorized' : result.status === 409 ? 'Conflict' : 'Service Unavailable')
      rejectUpgrade(socket, result.status, reason)
      return false
    }

    const { room, member, token } = result
    let closed = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined

    function clearCloseTimer() {
      if (closeTimer !== undefined) {
        clearTimeout(closeTimer)
        closeTimer = undefined
      }
    }

    function closeSocket(code = 1000, reason = '') {
      if (closed) return
      closed = true
      if (!socket.destroyed && socket.writable) {
        try {
          socket.write(encodeWsClose(code, reason))
          socket.end()
          closeTimer = setTimeout(() => {
            closeTimer = undefined
            if (!socket.destroyed) socket.destroy()
          }, 1500)
          closeTimer.unref?.()
        } catch {
          socket.destroy()
        }
      } else if (!socket.destroyed) {
        socket.destroy()
      }
    }

    const transport: MemberTransport = { kind: 'ws', socket, close: closeSocket }
    const onDisconnect = () => {
      closed = true
      clearCloseTimer()
      detachMember(member, transport)
    }
    socket.on('close', onDisconnect)
    socket.on('error', onDisconnect)

    member.transport = transport
    member.expiresAt = Infinity
    member.lastInput = performance.now()
    startTimer()

    const accept = createHash('sha1').update(wsKey + wsGuid).digest('base64')
    ;(socket as Duplex & { setNoDelay?(noDelay?: boolean): void }).setNoDelay?.(true)
    try {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        '\r\n'
      )
      const welcomeFrame = encodeWsFrame(0x1, Buffer.from(JSON.stringify({ type: 'welcome', id: member.id, token }), 'utf8'))
      socket.write(welcomeFrame)
    } catch {
      onDisconnect()
      socket.destroy()
      return false
    }

    let pending: Buffer = Buffer.alloc(0)
    let fragments: Buffer[] | null = null
    let fragmentBytes = 0
    const maxPendingBytes = Math.max(65_536, (wsPayloadLimit + 14) * 16)

    function failWs(code: number, reason: string) {
      closeSocket(code, reason)
      detachMember(member, transport)
    }

    function handleTextMessage(text: string) {
      if (member.transport !== transport || room.members.get(token) !== member) return
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { return }
      if (!parsed || typeof parsed !== 'object') return
      const msg = parsed as Record<string, unknown>
      if (msg.type === 'leave') {
        removeMember(key, room, token, member)
        return
      }
      if (msg.type === 'ping') {
        if (!socket.destroyed && socket.writable && socket.writableLength < frameBudget) {
          socket.write(encodeWsFrame(0x1, Buffer.from(JSON.stringify({ type: 'pong' }), 'utf8')))
        }
        return
      }
      applyInputPayload(room, member, parsed)
    }

    function feed(chunk: Buffer) {
      if (closed || !chunk.byteLength) return
      if (pending.byteLength + chunk.byteLength > maxPendingBytes) return failWs(1009, 'Payload too large')
      pending = pending.byteLength ? Buffer.concat([pending, chunk]) : chunk
      while (!closed && pending.byteLength >= 2) {
        const b0 = pending[0]
        const b1 = pending[1]
        const fin = (b0 & 0x80) !== 0
        const rsv = b0 & 0x70
        const opcode = b0 & 0x0f
        const masked = (b1 & 0x80) !== 0
        let length = b1 & 0x7f
        let offset = 2

        if (rsv !== 0) return failWs(1002, 'Reserved bits set')
        if (!masked) return failWs(1002, 'Client frames must be masked')

        const isControl = (opcode & 0x08) !== 0
        if (isControl) {
          if (!fin) return failWs(1002, 'Control frames must not be fragmented')
          if (length > 125) return failWs(1002, 'Control frame too large')
        }

        if (length === 126) {
          if (pending.byteLength < 4) return
          length = pending.readUInt16BE(2)
          offset = 4
        } else if (length === 127) {
          if (pending.byteLength < 10) return
          const hi = pending.readUInt32BE(2)
          if (hi >= 0x8000_0000) return failWs(1002, 'Invalid 64-bit payload length')
          if (hi > 0x001f_ffff) return failWs(1009, 'Payload too large')
          length = Number(pending.readBigUInt64BE(2))
          offset = 10
        }

        if (length > wsPayloadLimit) return failWs(1009, 'Payload too large')

        if (!isControl) {
          if (opcode === 0x0) {
            if (!fragments) return failWs(1002, 'Unexpected continuation frame')
            if (fragmentBytes + length > wsPayloadLimit) return failWs(1009, 'Message too large')
          } else if (opcode === 0x1) {
            if (fragments) return failWs(1002, 'Expected continuation frame')
          } else if (opcode === 0x2) {
            return failWs(1003, 'Binary frames not supported')
          } else {
            return failWs(1002, 'Unsupported opcode')
          }
        } else if (opcode !== 0x8 && opcode !== 0x9 && opcode !== 0xa) {
          return failWs(1002, 'Unsupported control opcode')
        }

        const frameTotal = offset + 4 + length
        if (pending.byteLength < frameTotal) return

        const mask0 = pending[offset]
        const mask1 = pending[offset + 1]
        const mask2 = pending[offset + 2]
        const mask3 = pending[offset + 3]
        const payloadStart = offset + 4
        const payload = Buffer.allocUnsafe(length)
        for (let i = 0; i < length; i++) {
          const m = (i & 3) === 0 ? mask0 : (i & 3) === 1 ? mask1 : (i & 3) === 2 ? mask2 : mask3
          payload[i] = pending[payloadStart + i] ^ m
        }
        pending = frameTotal === pending.byteLength ? Buffer.alloc(0) : pending.subarray(frameTotal)

        if (opcode === 0x8) {
          if (length === 1) return failWs(1002, 'Invalid close payload')
          if (length >= 2) {
            const closeCode = payload.readUInt16BE(0)
            if (!isValidWireCloseCode(closeCode)) return failWs(1002, 'Invalid close code')
            if (length > 2) {
              try {
                utf8Fatal.decode(payload.subarray(2))
              } catch {
                return failWs(1007, 'Invalid UTF-8 in close reason')
              }
            }
            closeSocket(closeCode)
          } else {
            closeSocket(1000)
          }
          detachMember(member, transport)
          return
        }
        if (opcode === 0x9) {
          if (!socket.destroyed && socket.writable && socket.writableLength < frameBudget) {
            socket.write(encodeWsFrame(0xa, payload))
          }
          continue
        }
        if (opcode === 0xa) {
          continue
        }

        let complete: Buffer
        if (opcode === 0x1 && fin) {
          complete = payload
        } else {
          if (opcode === 0x1) {
            fragments = [payload]
            fragmentBytes = length
          } else {
            fragments!.push(payload)
            fragmentBytes += length
          }
          if (!fin) continue
          complete = Buffer.concat(fragments!, fragmentBytes)
          fragments = null
          fragmentBytes = 0
        }

        let text: string
        try {
          text = utf8Fatal.decode(complete)
        } catch {
          return failWs(1007, 'Invalid UTF-8')
        }
        handleTextMessage(text)
      }
    }

    socket.on('data', feed)
    if (head && head.byteLength > 0) feed(head)
    if (socket.destroyed) onDisconnect()
    return true
  }

  async function receive(req: IncomingMessage, res: ServerResponse, key: string, action: 'input' | 'leave') {
    const authorization = req.headers.authorization
    if (!authorization?.startsWith('Bearer ')) return sendText(res, 401)
    const token = authorization.slice(7)
    const room = rooms.get(key)
    const member = room?.members.get(token)
    if (!room || !member) return sendText(res, 401)
    if (action === 'leave') {
      removeMember(key, room, token, member)
      return sendText(res, 204)
    }
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer
      bytes += buf.byteLength
      if (bytes > httpPayloadLimit) {
        res.setHeader('Connection', 'close')
        return sendText(res, 413)
      }
      chunks.push(buf)
    }
    const body = Buffer.concat(chunks, bytes).toString('utf8')
    let input: unknown
    try { input = JSON.parse(body) } catch { return sendText(res, 400) }
    if (!member.transport || room.members.get(token) !== member) return sendText(res, 401)
    if (!applyInputPayload(room, member, input)) return sendText(res, 400)
    sendText(res, 204)
  }

  let previous = performance.now()
  let lag = 0
  let tick = 0
  let timer: ReturnType<typeof setInterval> | undefined

  function stopTimer() {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  function startTimer() {
    if (timer !== undefined) return
    previous = performance.now()
    lag = 0
    timer = setInterval(() => {
      const now = performance.now()
      lag += Math.min((now - previous) / 1000, STEP * 5)
      previous = now
      while (lag >= STEP) {
        lag -= STEP
        tick++
        for (const [key, room] of rooms) {
          for (const [token, member] of room.members) {
            if (now >= member.expiresAt) {
              room.members.delete(token)
              continue
            }
            if (member.inputQueue.length > 0) {
              const queued = member.inputQueue.shift()!
              member.input = combineInput(member.input, queued.input)
              member.idle = false
              stepPlayer(member.player, member.input, STEP, room.world, member.identity)
              if (queued.seq > member.lastProcessedSeq) member.lastProcessedSeq = queued.seq
            } else {
              if (!member.idle && now - member.lastInput > 600) {
                member.input = toIdleInput(member.input)
                member.idle = true
              }
              stepPlayer(member.player, member.input, STEP, room.world, member.identity)
              if (member.receivedSeq > member.lastProcessedSeq) member.lastProcessedSeq = member.receivedSeq
            }
          }
          if (!room.members.size) {
            rooms.delete(key)
            continue
          }
          if (tick % 3 !== 0) continue
          const connected: Member[] = []
          for (const member of room.members.values()) {
            if (member.transport) connected.push(member)
          }
          if (!connected.length) continue
          if (beforePublish) {
            const participants = new Array(connected.length)
            for (let i = 0; i < connected.length; i++) {
              participants[i] = { player: connected[i].player, identity: connected[i].identity }
            }
            beforePublish(room.world, participants, tick)
          }
          const players = new Array(connected.length)
          for (let i = 0; i < connected.length; i++) {
            const member = connected[i]
            players[i] = {
              ...snapshot(member.player, room.world, member.identity),
              id: member.id,
              slot: member.slot,
              lastProcessedSeq: member.lastProcessedSeq
            }
          }
          let ssePacket: string | undefined
          let wsFrame: Buffer | undefined
          for (let i = 0; i < connected.length; i++) {
            const member = connected[i]
            const transport = member.transport
            if (!transport) continue
            if (transport.kind === 'sse') {
              const res = transport.res
              if (res.destroyed || res.writableEnded) {
                detachMember(member, transport)
              } else if (res.writableLength >= frameBudget) {
                res.destroy()
              } else {
                ssePacket ??= 'data: ' + JSON.stringify({ tick, players }) + '\n\n'
                res.write(ssePacket)
              }
            } else {
              const socket = transport.socket
              if (socket.destroyed || !socket.writable) {
                detachMember(member, transport)
              } else if (socket.writableLength >= frameBudget) {
                socket.destroy()
              } else {
                wsFrame ??= encodeWsFrame(0x1, Buffer.from(JSON.stringify({ type: 'snapshot', tick, players }), 'utf8'))
                socket.write(wsFrame)
              }
            }
          }
        }
        if (!rooms.size) {
          stopTimer()
          return
        }
      }
    }, 8)
    timer.unref()
  }

  return {
    join,
    upgrade,
    receive,
    close() {
      stopTimer()
      for (const { members } of rooms.values()) {
        for (const member of members.values()) {
          const transport = member.transport
          member.transport = null
          if (!transport) continue
          if (transport.kind === 'sse') transport.res.end()
          else transport.close(1001, 'Server closing')
        }
      }
      rooms.clear()
    }
  }
}
