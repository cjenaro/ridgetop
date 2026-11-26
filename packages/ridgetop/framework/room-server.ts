import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { RoomInput } from './types.ts'
import type { WsConnection } from './ws.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { STEP } from './loop.ts'
import { sendText } from './host.ts'
import {
  acceptWsConnection,
  defaultHttpReason,
  encodeWsFrame,
  rejectUpgrade,
  validateWsUpgradeRequest
} from './ws.ts'

const resumeMs = 15_000
const frameBudget = 16_384
const maxInputQueue = 64

export type RoomAction = 'events' | 'input' | 'leave' | 'ws'

export interface RoomJoinOptions<World> {
  key: string
  world: World
  identity?: string
  resume?: string
}

export interface RoomInputSchema<Input> {
  initialInput(): Input
  parseInput(raw: unknown, previous: Input): Input | null
  mergeInput?(previous: Input, next: Input): Input
  idleInput?(previous: Input): Input
}

export interface RoomHostRejection {
  readonly reject: number
  readonly reason?: string
  readonly message?: string
}

export interface RoomHostMatch<World> {
  readonly key: string
  readonly world: World
  readonly identity?: string
  readonly resume?: string
}

export type RoomAuthorizeResult<World> =
  | { readonly ok: true; readonly world?: World; readonly identity?: string; readonly resume?: string }
  | { readonly ok: false; readonly status: number; readonly reason?: string; readonly message?: string }

export interface RoomHostHandlersOptions<World> {
  match(
    basePath: string,
    req: IncomingMessage,
    action: RoomAction
  ): RoomHostMatch<World> | RoomHostRejection | null | undefined
  authorize?(
    req: IncomingMessage,
    matched: RoomHostMatch<World>,
    action: 'events' | 'ws'
  ): RoomAuthorizeResult<World> | Promise<RoomAuthorizeResult<World>>
}

export interface RoomHostHandlers {
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, pathname: string): boolean | Promise<boolean>
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

export interface RoomService<World> {
  join(req: IncomingMessage, res: ServerResponse, options: RoomJoinOptions<World>): void
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, options: RoomJoinOptions<World>): boolean
  receive(req: IncomingMessage, res: ServerResponse, key: string, action: 'input' | 'leave'): Promise<void>
  createHostHandlers(options: RoomHostHandlersOptions<World>): RoomHostHandlers
  close(): void
}

type CustomRoomServiceOptions<World, Player, Snapshot extends object, Input> =
  RoomServiceOptions<World, Player, Snapshot, Input> & {
    parseInput(raw: unknown, previous: Input): Input | null
    initialInput(): Input
  }

interface ResolvedRoomServiceOptions<World, Player, Snapshot extends object, Input> {
  createPlayer(id: string, slot: number, world: World): Player
  restartPlayer?(player: Player, input: Input & { restart: number }, world: World): Player
  stepPlayer(player: Player, input: Input, dt: number, world: World, identity?: string): void
  snapshot(player: Player, world: World, identity?: string): Snapshot
  beforePublish?(world: World, connected: readonly { player: Player; identity?: string }[], tick: number): void
  parseInput(raw: unknown, previous: Input): Input | null
  initialInput(): Input
  mergeInput(previous: Input, next: Input): Input
  idleInput(previous: Input): Input
  requireRestart: boolean
  maxPayloadBytes?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return isRecord(value) && typeof value.then === 'function'
}

function isRoomHostRejection(value: unknown): value is RoomHostRejection {
  return isRecord(value) && typeof value.reject === 'number'
}

function splitRoomPathname(pathname: string): { basePath: string; action: RoomAction } | null {
  const slash = pathname.lastIndexOf('/')
  if (slash < 0) return null
  const tail = pathname.slice(slash + 1)
  if (tail === 'events' || tail === 'input' || tail === 'leave' || tail === 'ws') {
    return { basePath: pathname.slice(0, slash), action: tail }
  }
  return null
}

function extractResumeFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url, 'http://localhost').searchParams.get('resume') ?? ''
  } catch {
    return ''
  }
}

function hasCustomInputSchema<World, Player, Snapshot extends object, Input>(
  options:
    | RoomServiceOptions<World, Player, Snapshot, RoomInput>
    | CustomRoomServiceOptions<World, Player, Snapshot, Input>
): options is CustomRoomServiceOptions<World, Player, Snapshot, Input> {
  return typeof options.parseInput === 'function' && typeof options.initialInput === 'function'
}

// ---------------------------------------------------------------------------
// Platformer room input preset (backwards-compatible default for RoomInput)
// ---------------------------------------------------------------------------

const emptyPlatformerInput: RoomInput = Object.freeze({ left: false, right: false, jump: 0 })

export const platformerRoomInputSchema: Readonly<Required<RoomInputSchema<RoomInput>>> = Object.freeze({
  initialInput: (): RoomInput => ({ ...emptyPlatformerInput }),
  parseInput(raw: unknown, previous: RoomInput): RoomInput | null {
    if (!isRecord(raw)) return null
    if (
      typeof raw.left !== 'boolean' ||
      typeof raw.right !== 'boolean' ||
      !isSafeInt(raw.jump) ||
      raw.jump < previous.jump
    ) {
      return null
    }
    return { left: raw.left, right: raw.right, jump: raw.jump }
  },
  mergeInput: (_previous: RoomInput, next: RoomInput): RoomInput => next,
  idleInput: (previous: RoomInput): RoomInput => ({ left: false, right: false, jump: previous.jump })
})

// ---------------------------------------------------------------------------
// Generic authoritative RoomService
// ---------------------------------------------------------------------------

export function createRoomService<World, Player, Snapshot extends object>(
  options: RoomServiceOptions<World, Player, Snapshot, RoomInput>
): RoomService<World>
export function createRoomService<World, Player, Snapshot extends object, Input>(
  options: CustomRoomServiceOptions<World, Player, Snapshot, Input>
): RoomService<World>
export function createRoomService<World, Player, Snapshot extends object, Input = RoomInput>(
  options:
    | RoomServiceOptions<World, Player, Snapshot, RoomInput>
    | CustomRoomServiceOptions<World, Player, Snapshot, Input>
): RoomService<World> {
  if (hasCustomInputSchema(options)) {
    const initialInput = options.initialInput
    return createRoomServiceImpl({
      ...options,
      requireRestart: false,
      initialInput,
      parseInput: options.parseInput,
      mergeInput: options.mergeInput ?? ((_previous, next) => next),
      idleInput: options.idleInput ?? (() => initialInput())
    })
  }
  const customInitial = options.initialInput
  const hasCustomOverride = Boolean(options.parseInput || customInitial || options.mergeInput || options.idleInput)
  return createRoomServiceImpl<World, Player, Snapshot, RoomInput>({
    ...options,
    requireRestart: !hasCustomOverride,
    initialInput: customInitial ?? platformerRoomInputSchema.initialInput,
    parseInput: options.parseInput ?? platformerRoomInputSchema.parseInput,
    mergeInput: options.mergeInput ?? platformerRoomInputSchema.mergeInput,
    idleInput: options.idleInput ?? (customInitial ? () => customInitial() : platformerRoomInputSchema.idleInput)
  })
}

function createRoomServiceImpl<World, Player, Snapshot extends object, Input>({
  createPlayer,
  restartPlayer,
  stepPlayer,
  snapshot,
  beforePublish,
  parseInput: validateInput,
  initialInput: makeInitialInput,
  mergeInput: combineInput,
  idleInput: toIdleInput,
  requireRestart,
  maxPayloadBytes
}: ResolvedRoomServiceOptions<World, Player, Snapshot, Input>): RoomService<World> {
  const httpPayloadLimit = maxPayloadBytes ?? 512
  const wsPayloadLimit = maxPayloadBytes ?? 4096

  type MemberTransport =
    | { kind: 'sse'; res: ServerResponse }
    | { kind: 'ws'; conn: WsConnection }

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
      else transport.conn.close(1000, 'Left room')
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
      const slot = [0, 1, 2, 3, 4, 5, 6, 7].find(index => !used.has(index))
      if (slot === undefined) return { ok: false, status: 409, message: 'Room is full' }
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
    if (!isRecord(raw)) return false
    const inputSource =
      raw.type === 'input' && isRecord(raw.input)
        ? raw.input
        : raw

    const rawRestart =
      raw.restart !== undefined
        ? raw.restart
        : inputSource.restart
    let restart = member.restart
    if (rawRestart !== undefined) {
      if (!isSafeInt(rawRestart) || rawRestart < member.restart) return false
      restart = rawRestart
    } else if (requireRestart) {
      return false
    }

    const rawSeq =
      raw.inputSeq !== undefined
        ? raw.inputSeq
        : inputSource.inputSeq
    let seq: number | undefined
    if (rawSeq !== undefined) {
      if (!isSafeInt(rawSeq) || rawSeq < 0 || rawSeq < member.receivedSeq) {
        return false
      }
      seq = rawSeq
    }

    const latestInput = member.inputQueue.length > 0 ? member.inputQueue[member.inputQueue.length - 1].input : member.input
    const parsed = validateInput(inputSource, latestInput)
    if (parsed === null) return false

    const now = performance.now()
    if (restart > member.restart) {
      member.restart = restart
      member.inputQueue.length = 0
      if (restartPlayer) {
        const restartInput: Input & { restart: number } = Object.assign({}, parsed, { restart })
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
          const dropped = member.inputQueue.shift()
          if (dropped) member.input = combineInput(member.input, dropped.input)
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
    const handshake = validateWsUpgradeRequest(req)
    if (!handshake.ok) {
      rejectUpgrade(socket, handshake.status, handshake.reason, handshake.extraHeaders)
      return false
    }

    const resumeToken = resume ?? (extractResumeFromUrl(req.url) || String(req.headers['last-event-id'] ?? ''))
    const result = allocateMember(key, world, identity, resumeToken)
    if ('status' in result) {
      const reason = result.message || defaultHttpReason(result.status)
      rejectUpgrade(socket, result.status, reason)
      return false
    }

    const { room, member, token } = result
    const welcomeFrame = encodeWsFrame(0x1, Buffer.from(JSON.stringify({ type: 'welcome', id: member.id, token }), 'utf8'))
    let transport: MemberTransport | undefined

    const conn = acceptWsConnection(socket, {
      accept: handshake.accept,
      head,
      initialFrame: welcomeFrame,
      maxPayloadBytes: wsPayloadLimit,
      frameBudget,
      onOpen(wsConn) {
        transport = { kind: 'ws', conn: wsConn }
        member.transport = transport
        member.expiresAt = Infinity
        member.lastInput = performance.now()
        startTimer()
      },
      onText(text) {
        if (!transport || member.transport !== transport || room.members.get(token) !== member) return
        let parsed: unknown
        try { parsed = JSON.parse(text) } catch { return }
        if (!isRecord(parsed)) return
        if (parsed.type === 'leave') {
          removeMember(key, room, token, member)
          return
        }
        if (parsed.type === 'ping') {
          if (transport.kind === 'ws') {
            transport.conn.sendText(JSON.stringify({ type: 'pong' }))
          }
          return
        }
        applyInputPayload(room, member, parsed)
      },
      onClose() {
        if (transport) detachMember(member, transport)
      }
    })

    if (!conn) {
      member.expiresAt = performance.now() + resumeMs
      startTimer()
      return false
    }
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
      const buf = typeof chunk === 'string'
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk)
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

  function createHostHandlers(options: RoomHostHandlersOptions<World>): RoomHostHandlers {
    function authorizeForAction(
      req: IncomingMessage,
      matched: RoomHostMatch<World>,
      action: 'events' | 'ws'
    ): RoomAuthorizeResult<World> | Promise<RoomAuthorizeResult<World>> {
      if (!options.authorize) {
        return { ok: true, world: matched.world, identity: matched.identity, resume: matched.resume }
      }
      return options.authorize(req, matched, action)
    }

    async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
      const split = splitRoomPathname(pathname)
      if (!split) return false
      const matched = options.match(split.basePath, req, split.action)
      if (!matched) return false
      if (isRoomHostRejection(matched)) {
        sendText(res, matched.reject, matched.message ?? '')
        return true
      }
      if (split.action === 'events') {
        if (req.method !== 'GET') {
          sendText(res, 405)
          return true
        }
        const auth = await authorizeForAction(req, matched, 'events')
        if (!auth.ok) {
          sendText(res, auth.status, auth.message ?? '')
          return true
        }
        join(req, res, {
          key: matched.key,
          world: auth.world !== undefined ? auth.world : matched.world,
          identity: auth.identity ?? matched.identity,
          resume: auth.resume ?? matched.resume
        })
        return true
      }
      if (split.action === 'input' || split.action === 'leave') {
        if (req.method !== 'POST') {
          sendText(res, 405)
          return true
        }
        await receive(req, res, matched.key, split.action)
        return true
      }
      sendText(res, 426, 'Upgrade Required')
      return true
    }

    function upgradeRoute(req: IncomingMessage, socket: Duplex, head: Buffer, pathname: string): boolean | Promise<boolean> {
      const split = splitRoomPathname(pathname)
      if (!split || split.action !== 'ws') return false
      const matched = options.match(split.basePath, req, 'ws')
      if (!matched) return false
      if (isRoomHostRejection(matched)) {
        rejectUpgrade(socket, matched.reject, matched.reason ?? defaultHttpReason(matched.reject))
        return true
      }
      const finishUpgrade = (auth: RoomAuthorizeResult<World>): boolean => {
        if (!auth.ok) {
          rejectUpgrade(socket, auth.status, auth.reason ?? defaultHttpReason(auth.status))
          return true
        }
        upgrade(req, socket, head, {
          key: matched.key,
          world: auth.world !== undefined ? auth.world : matched.world,
          identity: auth.identity ?? matched.identity,
          resume: auth.resume ?? matched.resume
        })
        return true
      }
      const authResult = authorizeForAction(req, matched, 'ws')
      if (isPromiseLike(authResult)) {
        return authResult.then(finishUpgrade)
      }
      return finishUpgrade(authResult)
    }

    return { handle, upgrade: upgradeRoute }
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
            const queued = member.inputQueue.shift()
            if (queued) {
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
            const participants: { player: Player; identity?: string }[] = []
            for (let i = 0; i < connected.length; i++) {
              participants.push({ player: connected[i].player, identity: connected[i].identity })
            }
            beforePublish(room.world, participants, tick)
          }
          const players: (Snapshot & { id: string; slot: number; lastProcessedSeq: number })[] = []
          for (let i = 0; i < connected.length; i++) {
            const member = connected[i]
            players.push({
              ...snapshot(member.player, room.world, member.identity),
              id: member.id,
              slot: member.slot,
              lastProcessedSeq: member.lastProcessedSeq
            })
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
              const socket = transport.conn.socket
              if (transport.conn.closed || socket.destroyed || !socket.writable) {
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
    createHostHandlers,
    close() {
      stopTimer()
      for (const { members } of rooms.values()) {
        for (const member of members.values()) {
          const transport = member.transport
          member.transport = null
          if (!transport) continue
          if (transport.kind === 'sse') transport.res.end()
          else transport.conn.close(1001, 'Server closing')
        }
      }
      rooms.clear()
    }
  }
}
