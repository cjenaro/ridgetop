import type { RenderStats, RendererName } from './types.ts'

export interface PerfSnapshot {
  readonly fps: number
  readonly minFps: number
  readonly frameMs: number
  readonly p95Ms: number
  readonly worstMs: number
  readonly simMs: number
  readonly renderMs: number
  readonly hudMs: number
  readonly uiMs: number
  readonly backend: RendererName | string
  readonly gpu: string
  readonly width: number
  readonly height: number
  readonly dpr: number
  readonly drawCalls: number
  readonly triangles: number
  readonly instances: number
  readonly uploadBytes: number
  readonly memoryMB: number | null
  readonly sampleCount: number
}

export interface PerfMonitor {
  /** Call once per rendered frame with phase timings (ms) and renderer stats. */
  record(sample: {
    now?: number
    simMs?: number
    renderMs?: number
    hudMs?: number
    uiMs?: number
    stats?: Readonly<RenderStats>
    backend?: RendererName | string
    gpu?: string
    width?: number
    height?: number
    dpr?: number
  }): PerfSnapshot
  /** Return the latest smoothed snapshot without mutating state. */
  snapshot(): PerfSnapshot
  /** Reset rolling history. */
  reset(): void
}

export interface PerfLogEntry extends PerfSnapshot {
  readonly ts: string
  readonly sessionId: string
  readonly game: string
  readonly screen: string
  readonly reason: 'interval' | 'spike' | 'manual' | 'unload'
  readonly spikeMs?: number
  readonly cores?: number
  readonly userAgent?: string
}

export interface PerfLoggerOptions {
  /** Game identifier stored in each log line. */
  readonly game: string
  /** Optional server endpoint to stream NDJSON entries (defaults to `/__perf/log`). Set to `null` to disable HTTP posting. */
  readonly endpoint?: string | null
  /** Milliseconds between periodic telemetry flushes (default 2500ms). */
  readonly intervalMs?: number
  /** Single-frame duration (ms) above which a spike log is triggered (default 65ms). */
  readonly spikeMs?: number
  /** localStorage key for offline session history (default `ridgetop:perf-log`). Set to `null` to disable. */
  readonly storageKey?: string | null
  /** Max localStorage entries retained (default 150). */
  readonly maxLocalEntries?: number
  /** Optional dynamic context provider (e.g., current screen or scene name). */
  readonly getScreen?: () => string
}

export interface PerfLogger {
  /** Unique session identifier. */
  readonly sessionId: string
  /** Call once per frame after `monitor.record(...)` with the last frame delta (ms) to emit periodic and spike logs. */
  tick(frameDeltaMs?: number): void
  /** Immediately persist a snapshot entry to localStorage and (if configured) the server log endpoint. */
  flush(reason?: PerfLogEntry['reason'], spikeMs?: number): PerfLogEntry | null
  /** Read locally buffered entries. */
  getHistory(): readonly PerfLogEntry[]
  /** Export locally buffered entries as newline-delimited JSON. */
  toNdjson(): string
  /** Number of entries emitted in this session. */
  readonly entryCount: number
  /** Whether the server log endpoint accepted the last flush. */
  readonly serverConnected: boolean
  /** Detach lifecycle listeners and flush one final entry. */
  dispose(): void
}

function readHeapMemoryMB(): number | null {
  const perf = typeof performance !== 'undefined' ? performance : undefined
  if (!perf || !('memory' in perf)) return null
  const mem = Reflect.get(perf, 'memory')
  if (typeof mem !== 'object' || mem === null || !('usedJSHeapSize' in mem)) return null
  const bytes = Reflect.get(mem, 'usedJSHeapSize')
  return typeof bytes === 'number' && Number.isFinite(bytes) ? Math.round((bytes / (1024 * 1024)) * 10) / 10 : null
}

/**
 * Lightweight, allocation-free rolling FPS & frame-budget monitor for Ridgetop games.
 * Tracks smoothed FPS, p95 and worst-frame spikes, per-phase CPU ms, and renderer draw/upload stats.
 */
export function createPerfMonitor(windowSize = 60): PerfMonitor {
  const size = Math.max(8, Math.min(240, Math.floor(windowSize)))
  const frameTimes = new Float32Array(size)
  const scratchSort = new Float32Array(size)
  let head = 0
  let count = 0
  let lastNow = -1
  let emaSim = 0
  let emaRender = 0
  let emaHud = 0
  let emaUi = 0

  let current: PerfSnapshot = {
    fps: 0,
    minFps: 0,
    frameMs: 0,
    p95Ms: 0,
    worstMs: 0,
    simMs: 0,
    renderMs: 0,
    hudMs: 0,
    uiMs: 0,
    backend: '',
    gpu: '',
    width: 0,
    height: 0,
    dpr: 1,
    drawCalls: 0,
    triangles: 0,
    instances: 0,
    uploadBytes: 0,
    memoryMB: null,
    sampleCount: 0
  }

  return {
    record(sample) {
      const now = sample.now ?? (typeof performance !== 'undefined' ? performance.now() : 0)
      if (lastNow >= 0) {
        const dt = Math.max(0.1, Math.min(500, now - lastNow))
        frameTimes[head] = dt
        head = (head + 1) % size
        if (count < size) count++
      }
      lastNow = now

      const alpha = count <= 1 ? 1 : 0.14
      if (sample.simMs !== undefined) emaSim += (sample.simMs - emaSim) * alpha
      if (sample.renderMs !== undefined) emaRender += (sample.renderMs - emaRender) * alpha
      if (sample.hudMs !== undefined) emaHud += (sample.hudMs - emaHud) * alpha
      if (sample.uiMs !== undefined) emaUi += (sample.uiMs - emaUi) * alpha

      let sum = 0
      let worst = 0
      for (let i = 0; i < count; i++) {
        const v = frameTimes[i]
        scratchSort[i] = v
        sum += v
        if (v > worst) worst = v
      }
      let p95 = worst
      if (count > 1) {
        const view = scratchSort.subarray(0, count)
        view.sort()
        p95 = view[Math.min(count - 1, Math.floor(count * 0.95))]
      }
      const avgMs = count > 0 ? sum / count : 0
      const fps = avgMs > 0 ? 1000 / avgMs : 0
      const minFps = worst > 0 ? 1000 / worst : 0

      current = {
        fps,
        minFps,
        frameMs: avgMs,
        p95Ms: p95,
        worstMs: worst,
        simMs: emaSim,
        renderMs: emaRender,
        hudMs: emaHud,
        uiMs: emaUi,
        backend: sample.backend ?? current.backend,
        gpu: sample.gpu ?? current.gpu,
        width: sample.width ?? current.width,
        height: sample.height ?? current.height,
        dpr: sample.dpr ?? (typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : current.dpr),
        drawCalls: sample.stats?.drawCalls ?? current.drawCalls,
        triangles: sample.stats?.triangles ?? current.triangles,
        instances: sample.stats?.instances ?? current.instances,
        uploadBytes: sample.stats?.uploadBytes ?? current.uploadBytes,
        memoryMB: readHeapMemoryMB(),
        sampleCount: count
      }
      return current
    },
    snapshot() {
      return current
    },
    reset() {
      frameTimes.fill(0)
      head = 0
      count = 0
      lastNow = -1
      emaSim = emaRender = emaHud = emaUi = 0
    }
  }
}

/**
 * Persistent FPS telemetry logger that stores rolling snapshots in `localStorage` and streams
 * NDJSON entries to the Ridgetop server (`/__perf/log` -> `data/perf.ndjson`) so developers
 * and AI agents can directly inspect real user frame times, backends, and spikes.
 */
export function createPerfLogger(monitor: PerfMonitor, options: PerfLoggerOptions): PerfLogger {
  const endpoint = options.endpoint === undefined ? '/__perf/log' : options.endpoint
  const intervalMs = Math.max(500, options.intervalMs ?? 2500)
  const spikeThreshold = Math.max(25, options.spikeMs ?? 65)
  const storageKey = options.storageKey === undefined ? 'ridgetop:perf-log' : options.storageKey
  const maxLocal = Math.max(10, Math.min(1000, options.maxLocalEntries ?? 150))
  const sessionId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`

  const history: PerfLogEntry[] = []
  let lastFlushAt = 0
  let lastSpikeAt = 0
  let count = 0
  let connected = false
  let endpointDisabled = false
  let disposed = false

  function loadStored(): PerfLogEntry[] {
    if (!storageKey || typeof globalThis.localStorage === 'undefined') return []
    try {
      const raw = globalThis.localStorage.getItem(storageKey)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((x): x is PerfLogEntry => typeof x === 'object' && x !== null && 'fps' in x)
    } catch {
      return []
    }
  }

  function saveStored(entry: PerfLogEntry) {
    if (!storageKey || typeof globalThis.localStorage === 'undefined') return
    try {
      const existing = loadStored()
      existing.push(entry)
      while (existing.length > maxLocal) existing.shift()
      globalThis.localStorage.setItem(storageKey, JSON.stringify(existing))
    } catch {
      // Ignore storage quota / privacy errors
    }
  }

  function round1(v: number) { return Math.round(v * 10) / 10 }
  function round2(v: number) { return Math.round(v * 100) / 100 }

  function buildEntry(reason: PerfLogEntry['reason'], spikeMs?: number): PerfLogEntry {
    const s = monitor.snapshot()
    const nav = typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : undefined
    return {
      ts: new Date().toISOString(),
      sessionId,
      game: options.game,
      screen: options.getScreen ? options.getScreen() : 'default',
      reason,
      ...(spikeMs !== undefined ? { spikeMs: round1(spikeMs) } : {}),
      fps: round1(s.fps),
      minFps: round1(s.minFps),
      frameMs: round1(s.frameMs),
      p95Ms: round1(s.p95Ms),
      worstMs: round1(s.worstMs),
      simMs: round2(s.simMs),
      renderMs: round2(s.renderMs),
      hudMs: round2(s.hudMs),
      uiMs: round2(s.uiMs),
      backend: s.backend,
      gpu: s.gpu,
      width: s.width,
      height: s.height,
      dpr: round2(s.dpr),
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      instances: s.instances,
      uploadBytes: s.uploadBytes,
      memoryMB: s.memoryMB,
      sampleCount: s.sampleCount,
      ...(count === 0 && nav ? { cores: nav.hardwareConcurrency, userAgent: nav.userAgent.slice(0, 140) } : {})
    }
  }

  function postEntry(entry: PerfLogEntry, useBeacon = false) {
    if (!endpoint || endpointDisabled || typeof globalThis.location === 'undefined') return
    if (globalThis.location.protocol !== 'http:' && globalThis.location.protocol !== 'https:') return
    const body = JSON.stringify(entry)
    if (useBeacon && typeof globalThis.navigator?.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' })
        globalThis.navigator.sendBeacon(endpoint, blob)
      } catch {
        // Ignore unload beacon failures
      }
      return
    }
    if (typeof globalThis.fetch !== 'function') return
    globalThis.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).then(res => {
      if (res.ok) connected = true
      else if (res.status === 404 || res.status === 405 || res.status === 403) endpointDisabled = true
    }).catch(() => {
      // Offline / static host — localStorage history remains active
    })
  }

  function flush(reason: PerfLogEntry['reason'] = 'manual', spikeMs?: number): PerfLogEntry | null {
    if (disposed) return null
    const snap = monitor.snapshot()
    if (snap.sampleCount < 2 && reason !== 'manual') return null
    const entry = buildEntry(reason, spikeMs)
    history.push(entry)
    if (history.length > maxLocal) history.shift()
    saveStored(entry)
    postEntry(entry, reason === 'unload')
    count++
    lastFlushAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    return entry
  }

  const onUnload = () => { flush('unload') }
  const onVis = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush('unload')
  }
  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('pagehide', onUnload)
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVis)
  }

  return {
    sessionId,
    tick(frameDeltaMs?: number) {
      if (disposed) return
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      // Ignore multi-second pauses caused by backgrounded / sleeping browser tabs
      if (frameDeltaMs !== undefined && frameDeltaMs >= spikeThreshold && frameDeltaMs <= 2000 && now - lastSpikeAt >= 1500) {
        lastSpikeAt = now
        flush('spike', frameDeltaMs)
        return
      }
      if (lastFlushAt === 0) {
        if (monitor.snapshot().sampleCount >= 12) flush('interval')
      } else if (now - lastFlushAt >= intervalMs) {
        flush('interval')
      }
    },
    flush,
    getHistory() {
      return history.length ? history : loadStored()
    },
    toNdjson() {
      const list = history.length ? history : loadStored()
      return list.map(e => JSON.stringify(e)).join('\n')
    },
    get entryCount() { return count },
    get serverConnected() { return connected },
    dispose() {
      if (disposed) return
      flush('unload')
      disposed = true
      if (typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('pagehide', onUnload)
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', onVis)
      }
    }
  }
}
