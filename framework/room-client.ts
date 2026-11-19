import type { RoomInput, RoomPlayer } from './types.ts'
import { STEP } from './loop.ts'

export function connectRoom<T extends RoomPlayer = RoomPlayer>({ endpoint, readInput, onStatus }: {
  endpoint: string
  readInput(): RoomInput
  onStatus(status: 'connected' | 'reconnecting' | 'unavailable'): void
}) {
  type Snapshot = { tick: number; players: T[]; received: number }
  let id: string | undefined
  let token: string | undefined
  let latest: Snapshot | undefined
  let previous: Snapshot | undefined
  let lastSent: (RoomInput & { restart: number }) | undefined
  let sentAt = 0
  let inFlight = false
  let restart = 0
  let closed = false
  const abort = new AbortController()
  const events = new EventSource(endpoint + '/events')

  events.addEventListener('welcome', event => {
    const welcome = JSON.parse((event as MessageEvent<string>).data) as { id: string; token: string }
    if (id && id !== welcome.id) restart = 0
    id = welcome.id
    token = welcome.token
    previous = latest = undefined
    lastSent = undefined
    onStatus('connected')
  })
  events.onmessage = event => {
    previous = latest
    latest = { ...JSON.parse(event.data), received: performance.now() }
  }
  events.onerror = () => {
    if (closed) return
    onStatus(events.readyState === EventSource.CLOSED ? 'unavailable' : 'reconnecting')
  }

  async function flush(now: number) {
    if (!token || closed || events.readyState !== EventSource.OPEN || inFlight || now - sentAt < 25) return
    const input = { ...readInput(), restart }
    if (lastSent && now - sentAt < 180 && input.restart === lastSent.restart &&
        input.left === lastSent.left && input.right === lastSent.right &&
        input.jump === lastSent.jump) return
    sentAt = now
    inFlight = true
    const sendingToken = token
    try {
      const response = await fetch(endpoint + '/input', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + sendingToken, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: abort.signal
      })
      if (response.ok && token === sendingToken) lastSent = input
    } catch {
      // Retry the latest input when the stream and connection are ready.
    } finally {
      inFlight = false
    }
  }

  return {
    get id() { return id },
    flush,
    restart() { restart++ },
    sample(now: number): T[] {
      if (!latest) return []
      const interval = previous ? (latest.tick - previous.tick) * STEP * 1000 : 0
      const alpha = interval ? Math.max(0, Math.min(1, (now - latest.received) / interval)) : 1
      return latest.players.map(player => {
        const old = previous?.players.find(candidate => candidate.id === player.id)
        if (!old || old.revision !== player.revision || old.falls !== player.falls || Math.abs(old.x - player.x) > 100 ||
            Math.abs(old.y - player.y) > 100) return player
        return {
          ...player,
          x: old.x + (player.x - old.x) * alpha,
          y: old.y + (player.y - old.y) * alpha
        }
      })
    },
    close() {
      if (closed) return
      closed = true
      events.close()
      abort.abort()
      if (token) {
        fetch(endpoint + '/leave', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token }, keepalive: true
        }).catch(() => {})
      }
    }
  }
}
