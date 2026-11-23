import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RoomInput } from './types.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { STEP } from './loop.ts'
import { sendText } from './host.ts'

const emptyInput = Object.freeze({ left: false, right: false, jump: 0 })
const resumeMs = 15_000
const frameBudget = 16_384

export function createRoomService<World, Player, Snapshot extends object>({
  createPlayer, restartPlayer, stepPlayer, snapshot, beforePublish
}: {
  createPlayer(id: string, slot: number, world: World): Player
  restartPlayer(player: Player, input: RoomInput & { restart: number }, world: World): Player
  stepPlayer(player: Player, input: RoomInput, dt: number, world: World, identity?: string): void
  snapshot(player: Player, world: World, identity?: string): Snapshot
  beforePublish?(world: World, connected: readonly { player: Player; identity?: string }[], tick: number): void
}) {
  type Member = {
    id: string; slot: number; player: Player; input: RoomInput; res?: ServerResponse;
    lastInput: number; restart: number; expiresAt: number; identity?: string
  }
  const rooms = new Map<string, { world: World; members: Map<string, Member> }>()

  function join(req: IncomingMessage, res: ServerResponse, { key, world, identity }: { key: string; world: World; identity?: string }) {
    const resume = String(req.headers['last-event-id'] ?? '')
    let room = rooms.get(key)
    if (!room) {
      if (rooms.size >= 128) return sendText(res, 503, 'Server is full')
      room = { world, members: new Map() }
      rooms.set(key, room)
    }
    let member = room.members.get(resume)
    if (member && member.identity !== identity) return sendText(res, 401)
    if (member?.res) return sendText(res, 409, 'Player already connected')
    let token = resume
    if (!member) {
      const used = new Set(Array.from(room.members.values(), item => item.slot))
      if (used.size >= 8) return sendText(res, 409, 'Room is full')
      const slot = [0, 1, 2, 3, 4, 5, 6, 7].find(index => !used.has(index))
      const id = randomUUID()
      token = randomUUID()
      member = {
        id, slot, player: createPlayer(id, slot, room.world), input: emptyInput,
        lastInput: 0, restart: 0, expiresAt: Infinity, identity
      }
      room.members.set(token, member)
    }
    member.res = res
    member.expiresAt = Infinity
    member.lastInput = performance.now()
    startTimer()
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no'
    })
    res.write(`retry: 800\nid: ${token}\nevent: welcome\ndata: ${JSON.stringify({ id: member.id, token })}\n\n`)
    res.on('close', () => {
      if (member.res === res) {
        member.res = null
        member.expiresAt = performance.now() + resumeMs
        member.input = { ...emptyInput, jump: member.input.jump }
      }
    })
  }

  async function receive(req: IncomingMessage, res: ServerResponse, key: string, action: 'input' | 'leave') {
    const authorization = req.headers.authorization
    if (!authorization?.startsWith('Bearer ')) return sendText(res, 401)
    const token = authorization.slice(7)
    const room = rooms.get(key)
    const member = room?.members.get(token)
    if (!member) return sendText(res, 401)
    if (action === 'leave') {
      room.members.delete(token)
      member.res?.end()
      if (!room.members.size) {
        rooms.delete(key)
        if (!rooms.size) stopTimer()
      }
      return sendText(res, 204)
    }
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of req) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer
      bytes += buf.byteLength
      if (bytes > 512) {
        res.setHeader('Connection', 'close')
        return sendText(res, 413)
      }
      chunks.push(buf)
    }
    const body = Buffer.concat(chunks, bytes).toString('utf8')
    let input
    try { input = JSON.parse(body) } catch { return sendText(res, 400) }
    if (!member.res || room.members.get(token) !== member) return sendText(res, 401)
    if (typeof input?.left !== 'boolean' || typeof input.right !== 'boolean' ||
        !Number.isSafeInteger(input.jump) || input.jump < member.input.jump ||
        !Number.isSafeInteger(input.restart) || input.restart < member.restart) return sendText(res, 400)
    if (input.restart > member.restart) {
      member.restart = input.restart
      member.player = restartPlayer(member.player, input, room.world)
    }
    member.input = { left: input.left, right: input.right, jump: input.jump }
    member.lastInput = performance.now()
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
            if (now - member.lastInput > 600 && (member.input.left || member.input.right)) {
              member.input = { ...emptyInput, jump: member.input.jump }
            }
            stepPlayer(member.player, member.input, STEP, room.world, member.identity)
          }
          if (!room.members.size) {
            rooms.delete(key)
            continue
          }
          if (tick % 3 !== 0) continue
          const connected: Member[] = []
          for (const member of room.members.values()) {
            if (member.res) connected.push(member)
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
            players[i] = { ...snapshot(member.player, room.world, member.identity), id: member.id, slot: member.slot }
          }
          const packet = 'data: ' + JSON.stringify({ tick, players }) + '\n\n'
          for (let i = 0; i < connected.length; i++) {
            const res = connected[i].res!
            if (res.writableLength >= frameBudget) res.destroy()
            else res.write(packet)
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
    receive,
    close() {
      stopTimer()
      for (const { members } of rooms.values()) {
        for (const { res } of members.values()) res?.end()
      }
      rooms.clear()
    }
  }
}
