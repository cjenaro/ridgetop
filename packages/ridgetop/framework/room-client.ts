import type {
  RoomEntity, RoomInput, RoomPlayer, RoomPrediction, RoomStatus, RoomTransport, RoomWelcome
} from './types.ts'
import { STEP } from './loop.ts'

export interface ConnectRoomOptions<T extends RoomEntity = RoomPlayer, Input = RoomInput> {
  endpoint: string
  readInput(): Input
  onStatus(status: RoomStatus): void
  transport?: RoomTransport
  wsEndpoint?: string
  equalInput?(a: Input, b: Input): boolean
  serializeInput?(input: Input, meta: { restart: number; inputSeq: number }): Record<string, unknown>
  onWelcome?(welcome: RoomWelcome): void
  interpolate?(previous: T, next: T, alpha: number): T
  predict?: RoomPrediction<T, Input>
}

const maxPendingInputs = 256

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isDefaultRoomInput(value: unknown): value is RoomInput {
  if (!isRecord(value)) return false
  return (
    typeof value.left === 'boolean' &&
    typeof value.right === 'boolean' &&
    typeof value.jump === 'number' &&
    Object.keys(value).length === 3
  )
}

function isRoomWelcome(value: unknown): value is RoomWelcome {
  return isRecord(value) && typeof value.id === 'string' && typeof value.token === 'string'
}

function isRoomEntity<T extends RoomEntity>(value: unknown): value is T {
  return isRecord(value) && typeof value.id === 'string'
}

function isRoomSnapshot<T extends RoomEntity>(value: unknown): value is { tick: number; players: T[] } {
  return (
    isRecord(value) &&
    typeof value.tick === 'number' &&
    Array.isArray(value.players) &&
    value.players.every(isRoomEntity)
  )
}

function eventDataString(event: unknown): string | undefined {
  if (!isRecord(event) || event.data === undefined) return undefined
  return typeof event.data === 'string' ? event.data : String(event.data)
}

function readNumberField(obj: object, key: string): number | undefined {
  const val: unknown = Reflect.get(obj, key)
  return typeof val === 'number' ? val : undefined
}

function defaultEqualInput<Input>(a: Input, b: Input): boolean {
  if (Object.is(a, b)) return true
  if (!isRecord(a) || !isRecord(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i]
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) return false
  }
  return true
}

function defaultInterpolate<T extends RoomEntity>(old: T, next: T, alpha: number): T {
  const prevFalls: unknown = Reflect.get(old, 'falls')
  const nextFalls: unknown = Reflect.get(next, 'falls')
  if (old.revision !== next.revision || prevFalls !== nextFalls) return next
  const ox = readNumberField(old, 'x')
  const nx = readNumberField(next, 'x')
  const oy = readNumberField(old, 'y')
  const ny = readNumberField(next, 'y')
  const oz = readNumberField(old, 'z')
  const nz = readNumberField(next, 'z')
  const hasX = ox !== undefined && nx !== undefined
  const hasY = oy !== undefined && ny !== undefined
  const hasZ = oz !== undefined && nz !== undefined
  if (
    (hasX && Math.abs(ox - nx) > 100) ||
    (hasY && Math.abs(oy - ny) > 100) ||
    (hasZ && Math.abs(oz - nz) > 100)
  ) {
    return next
  }
  if (!hasX && !hasY && !hasZ) return next
  const blended: T = { ...next }
  if (hasX) Reflect.set(blended, 'x', ox + (nx - ox) * alpha)
  if (hasY) Reflect.set(blended, 'y', oy + (ny - oy) * alpha)
  if (hasZ) Reflect.set(blended, 'z', oz + (nz - oz) * alpha)
  return blended
}

function resolveWsUrl(endpoint: string, wsEndpoint?: string, resumeToken?: string): string {
  let url: string
  if (wsEndpoint) {
    url = wsEndpoint
  } else if (/^wss?:\/\//i.test(endpoint)) {
    url = endpoint
  } else if (/^https?:\/\//i.test(endpoint)) {
    url = endpoint.replace(/^http/i, 'ws') + '/ws'
  } else if (typeof globalThis.location === 'object' && globalThis.location?.origin) {
    const origin = globalThis.location.origin.replace(/^http/i, 'ws')
    url = origin + (endpoint.startsWith('/') ? endpoint : '/' + endpoint) + '/ws'
  } else {
    url = 'ws://localhost' + (endpoint.startsWith('/') ? endpoint : '/' + endpoint) + '/ws'
  }
  if (resumeToken) {
    const sep = url.includes('?') ? '&' : '?'
    url += sep + 'resume=' + encodeURIComponent(resumeToken)
  }
  return url
}

export function connectRoom<T extends RoomEntity = RoomPlayer, Input = RoomInput>({
  endpoint,
  readInput,
  onStatus,
  transport = 'sse',
  wsEndpoint,
  equalInput,
  serializeInput,
  onWelcome,
  interpolate,
  predict
}: ConnectRoomOptions<T, Input>) {
  type Snapshot = { tick: number; players: T[]; received: number }
  type PendingEntry = { seq: number; input: Input; dt: number }

  const isEqualInput = equalInput ?? defaultEqualInput
  const blendPlayer = interpolate ?? defaultInterpolate

  let id: string | undefined
  let token: string | undefined
  let activeTransport: 'sse' | 'ws' = transport === 'sse' ? 'sse' : 'ws'
  let latest: Snapshot | undefined
  let previous: Snapshot | undefined
  let lastSentInput: Input | undefined
  let lastSentRestart = -1
  let lastSentSeq = 0
  let sentAt = -Infinity
  let inFlight = false
  let restart = 0
  let jumpOffset = 0
  let closed = false

  // Client-side prediction & reconciliation state
  let inputSeq = 0
  let predicted: T | undefined
  let lastPredictAt: number | undefined
  let predictAccumulator = 0
  let usedExplicitStep = false
  const pendingInputs: PendingEntry[] = []

  const abort = new AbortController()
  let events: EventSource | undefined
  let ws: WebSocket | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let wsEverWelcomed = false

  function normalizeInput(raw: Input): Input {
    if (!serializeInput && isDefaultRoomInput(raw)) {
      return Object.assign({}, raw, { jump: Math.max(0, raw.jump - jumpOffset) })
    }
    return raw
  }

  function buildPayload(input: Input, seq: number): Record<string, unknown> {
    if (serializeInput) {
      const custom = serializeInput(input, { restart, inputSeq: seq })
      return custom.inputSeq === undefined ? { ...custom, inputSeq: seq } : custom
    }
    if (isDefaultRoomInput(input)) {
      return { left: input.left, right: input.right, jump: input.jump, restart, inputSeq: seq }
    }
    if (isRecord(input)) {
      const rec: Record<string, unknown> = input
      return { ...rec, restart, inputSeq: seq }
    }
    return { input, restart, inputSeq: seq }
  }

  function handleWelcome(welcome: RoomWelcome) {
    if (closed) return
    if (id !== welcome.id) {
      restart = 0
      inputSeq = 0
      lastSentSeq = 0
      const raw = readInput()
      jumpOffset = !serializeInput && isDefaultRoomInput(raw) ? raw.jump : 0
    }
    id = welcome.id
    token = welcome.token
    previous = latest = undefined
    lastSentInput = undefined
    lastSentRestart = -1
    sentAt = -Infinity
    predicted = undefined
    lastPredictAt = undefined
    predictAccumulator = 0
    pendingInputs.length = 0
    onWelcome?.(welcome)
    onStatus('connected')
  }

  function reconcile(snapshot: Snapshot) {
    if (!predict || !id) return
    const auth = snapshot.players.find(candidate => candidate.id === id)
    if (!auth) return
    const ack = typeof auth.lastProcessedSeq === 'number' && Number.isFinite(auth.lastProcessedSeq)
      ? auth.lastProcessedSeq
      : 0
    if (ack > 0 && pendingInputs.length > 0) {
      let drop = 0
      while (drop < pendingInputs.length && pendingInputs[drop].seq <= ack) drop++
      if (drop > 0) pendingInputs.splice(0, drop)
    }
    let state: T = { ...auth }
    for (let i = 0; i < pendingInputs.length; i++) {
      const entry = pendingInputs[i]
      state = predict.step(state, entry.input, entry.dt)
    }
    if (!predicted || !predict.equals || !predict.equals(predicted, state)) {
      predicted = state
    }
  }

  function handleSnapshot(data: { tick: number; players: T[] }) {
    if (closed) return
    if (latest && data.tick < latest.tick) return
    previous = latest
    latest = { tick: data.tick, players: data.players, received: performance.now() }
    reconcile(latest)
  }

  function startSse() {
    if (closed) return
    activeTransport = 'sse'
    if (typeof EventSource === 'undefined') {
      onStatus('unavailable')
      return
    }
    const source = new EventSource(endpoint + '/events')
    events = source
    source.addEventListener('welcome', event => {
      if (closed || events !== source) return
      const raw = eventDataString(event)
      if (raw === undefined) return
      const parsed: unknown = JSON.parse(raw)
      if (isRoomWelcome(parsed)) handleWelcome(parsed)
    })
    source.onmessage = event => {
      if (closed || events !== source) return
      const raw = eventDataString(event)
      if (raw === undefined) return
      const parsed: unknown = JSON.parse(raw)
      if (isRoomSnapshot<T>(parsed)) handleSnapshot(parsed)
    }
    source.onerror = () => {
      if (closed || events !== source) return
      const closedState = typeof EventSource.CLOSED === 'number' ? EventSource.CLOSED : 2
      onStatus(source.readyState === closedState ? 'unavailable' : 'reconnecting')
    }
  }

  function startWs(allowFallback: boolean) {
    if (closed) return
    if (typeof WebSocket === 'undefined') {
      if (allowFallback) startSse()
      else onStatus('unavailable')
      return
    }
    activeTransport = 'ws'
    let socket: WebSocket
    try {
      socket = new WebSocket(resolveWsUrl(endpoint, wsEndpoint, token))
    } catch {
      if (allowFallback) startSse()
      else onStatus('unavailable')
      return
    }
    ws = socket
    let failed = false

    function fallbackOrReconnect() {
      if (closed || ws !== socket || failed) return
      failed = true
      ws = undefined
      if (allowFallback && !wsEverWelcomed) {
        startSse()
        return
      }
      onStatus('reconnecting')
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined
        if (!closed) startWs(false)
      }, 800)
    }

    socket.onmessage = event => {
      if (closed || ws !== socket) return
      let parsed: unknown
      try { parsed = JSON.parse(String(event.data)) } catch { return }
      if (!isRecord(parsed)) return
      if (parsed.type === 'welcome' && isRoomWelcome(parsed)) {
        wsEverWelcomed = true
        handleWelcome({ id: parsed.id, token: parsed.token })
      } else if ((parsed.type === 'snapshot' || Array.isArray(parsed.players)) && isRoomSnapshot<T>(parsed)) {
        handleSnapshot(parsed)
      }
    }
    socket.onerror = () => {
      if (closed || ws !== socket) return
      try { socket.close() } catch { /* ignore */ }
      fallbackOrReconnect()
    }
    socket.onclose = () => {
      fallbackOrReconnect()
    }
  }

  if (transport === 'sse') startSse()
  else if (transport === 'ws') startWs(false)
  else startWs(true)

  function recordPredictedStep(dt: number): T | undefined {
    if (!predict || !token || closed) return undefined
    const input = normalizeInput(readInput())
    const seq = ++inputSeq
    pendingInputs.push({ seq, input, dt })
    if (pendingInputs.length > maxPendingInputs) pendingInputs.shift()
    if (predicted) {
      predicted = predict.step(predicted, input, dt)
    }
    return predicted
  }

  function step(dt = STEP): T | undefined {
    usedExplicitStep = true
    return recordPredictedStep(dt)
  }

  async function flush(now: number) {
    if (closed || !token) return

    if (predict && !usedExplicitStep) {
      if (lastPredictAt === undefined) {
        lastPredictAt = now
        predictAccumulator = 0
        recordPredictedStep(STEP)
      } else {
        const dt = Math.min(Math.max((now - lastPredictAt) / 1000, 0), STEP * 5)
        lastPredictAt = now
        predictAccumulator = Math.min(predictAccumulator + dt, STEP * 5)
        while (predictAccumulator >= STEP - 1e-9) {
          predictAccumulator = Math.max(0, predictAccumulator - STEP)
          recordPredictedStep(STEP)
        }
      }
    }

    if (activeTransport === 'ws') {
      const wsOpen = typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number' ? WebSocket.OPEN : 1
      if (!ws || ws.readyState !== wsOpen) return

      if (predict) {
        let transmitted = false
        for (let i = 0; i < pendingInputs.length; i++) {
          const entry = pendingInputs[i]
          if (entry.seq <= lastSentSeq) continue
          const payload = buildPayload(entry.input, entry.seq)
          try {
            ws.send(JSON.stringify({ ...payload, type: 'input' }))
          } catch {
            return
          }
          lastSentInput = entry.input
          lastSentRestart = restart
          lastSentSeq = entry.seq
          sentAt = now
          transmitted = true
        }
        if (!transmitted && (now - sentAt >= 180 || restart !== lastSentRestart)) {
          const input = normalizeInput(readInput())
          const seq = lastSentSeq || ++inputSeq
          const payload = buildPayload(input, seq)
          try {
            ws.send(JSON.stringify({ ...payload, type: 'input' }))
          } catch {
            return
          }
          lastSentInput = input
          lastSentRestart = restart
          lastSentSeq = seq
          sentAt = now
        }
        return
      }

      const input = normalizeInput(readInput())
      const changed = lastSentInput === undefined || restart !== lastSentRestart || !isEqualInput(input, lastSentInput)
      if (!changed && now - sentAt < 180) return
      const seq = changed ? ++inputSeq : (lastSentSeq || ++inputSeq)
      const payload = buildPayload(input, seq)
      try {
        ws.send(JSON.stringify({ ...payload, type: 'input' }))
      } catch {
        return
      }
      lastSentInput = input
      lastSentRestart = restart
      lastSentSeq = seq
      sentAt = now
      return
    }

    const esOpen = typeof EventSource !== 'undefined' && typeof EventSource.OPEN === 'number' ? EventSource.OPEN : 1
    if (!events || events.readyState !== esOpen || inFlight || now - sentAt < 25) return

    let input: Input
    let seq: number
    if (predict && pendingInputs.length > 0) {
      const newest = pendingInputs[pendingInputs.length - 1]
      input = newest.input
      seq = newest.seq
      if (seq === lastSentSeq && restart === lastSentRestart && now - sentAt < 180) return
    } else {
      input = normalizeInput(readInput())
      const changed = lastSentInput === undefined || restart !== lastSentRestart || !isEqualInput(input, lastSentInput)
      if (!changed && now - sentAt < 180) return
      seq = changed ? ++inputSeq : (lastSentSeq || ++inputSeq)
    }

    const payload = buildPayload(input, seq)
    sentAt = now
    inFlight = true
    const sendingToken = token
    const sendingRestart = restart
    try {
      const response = await fetch(endpoint + '/input', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sendingToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abort.signal
      })
      if (response.ok && token === sendingToken) {
        lastSentInput = input
        lastSentRestart = sendingRestart
        lastSentSeq = seq
      }
    } catch {
      // Retry the latest input when the stream and connection are ready.
    } finally {
      inFlight = false
    }
  }

  return {
    get id() { return id },
    get transport() { return activeTransport },
    flush,
    step,
    restart() { restart++ },
    sample(now: number): T[] {
      if (!latest) return predicted ? [predicted] : []
      const interval = previous ? (latest.tick - previous.tick) * STEP * 1000 : 0
      const alpha = interval > 0 ? Math.max(0, Math.min(1, (now - latest.received) / interval)) : 1
      return latest.players.map(player => {
        if (predict && id && player.id === id && predicted) return predicted
        const old = previous?.players.find(candidate => candidate.id === player.id)
        if (!old) return player
        return blendPlayer(old, player, alpha)
      })
    },
    close() {
      if (closed) return
      closed = true
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer)
        reconnectTimer = undefined
      }
      if (ws) {
        const socket = ws
        ws = undefined
        const wsOpen = typeof WebSocket !== 'undefined' && typeof WebSocket.OPEN === 'number' ? WebSocket.OPEN : 1
        try {
          if (socket.readyState === wsOpen) socket.send(JSON.stringify({ type: 'leave' }))
          socket.close(1000)
        } catch { /* ignore */ }
      }
      if (events) {
        events.close()
        events = undefined
      }
      abort.abort()
      if (token && activeTransport === 'sse') {
        fetch(endpoint + '/leave', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token }, keepalive: true
        }).catch(() => {})
      }
    }
  }
}
