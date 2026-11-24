import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as wait } from 'node:timers/promises'

interface BiDiPending {
  resolve: (value: any) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface BenchmarkRecord {
  backend: string
  workload: string
  width: number
  height: number
  count: number
  drawCalls: number
  triangles: number
  instances: number
  uploadBytes: number
  culledBatches: number
  samples: number
  cpuMedianMs: number
  cpuP95Ms: number
  frameMedianMs: number
  frameP95Ms: number
  browser: string
}

const RENDERER_NAMES = {
  webgl2: 'WebGL 2',
  canvas: 'Canvas 2D'
} as const

type FirefoxBackend = keyof typeof RENDERER_NAMES

const BACKENDS: FirefoxBackend[] = (process.env.RIDGETOP_FIREFOX_BACKENDS?.split(',') as FirefoxBackend[] | undefined)
  ?? ['webgl2', 'canvas']
const BENCHMARK_COUNT = Number(process.env.RIDGETOP_BENCHMARK_COUNT ?? '1024')
const FIREFOX_BIN = process.env.RIDGETOP_FIREFOX ?? 'firefox'

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(err => (err ? reject(err) : resolve(port)))
    })
  })
}

async function createFirefoxProfileDir(): Promise<string> {
  // Snap-packaged Firefox on Ubuntu cannot access /tmp; place profile inside snap common dir when present.
  const snapCommon = join(homedir(), 'snap', 'firefox', 'common')
  const baseDir = existsSync(snapCommon) ? snapCommon : tmpdir()
  return await mkdtemp(join(baseDir, 'ridgetop-ff-smoke-'))
}

async function until<T>(
  read: () => Promise<T>,
  expected: T | ((value: T) => boolean),
  description: string,
  limit = 160
): Promise<T> {
  let actual: T | undefined
  for (let i = 0; i < limit; i++) {
    actual = await read()
    if (typeof expected === 'function' ? (expected as (value: T) => boolean)(actual) : expected === actual) {
      return actual
    }
    await wait(100)
  }
  assert.fail(`${description}. Last value: ${JSON.stringify(actual)}`)
}

class FirefoxBiDi {
  private ws: WebSocket
  private nextId = 0
  private pending = new Map<number, BiDiPending>()
  readonly errors: string[] = []
  context = ''

  private constructor(ws: WebSocket) {
    this.ws = ws
    const rejectAll = (reason: string) => {
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timeout)
        entry.reject(new Error(reason))
        this.pending.delete(id)
      }
    }
    this.ws.onclose = () => rejectAll('Firefox BiDi WebSocket closed unexpectedly')
    this.ws.onerror = () => rejectAll('Firefox BiDi WebSocket error')
    this.ws.onmessage = ({ data }: MessageEvent) => {
      const msg = JSON.parse(String(data))
      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id)
        if (!entry) return
        clearTimeout(entry.timeout)
        this.pending.delete(msg.id)
        if (msg.type === 'error') {
          entry.reject(new Error(`BiDi ${msg.error}: ${msg.message}`))
        } else {
          entry.resolve(msg.result)
        }
        return
      }
      if (msg.type === 'event' && msg.method === 'log.entryAdded') {
        const entry = msg.params
        if (entry?.level === 'error') {
          const detail = entry.text || entry.stackTrace?.callFrames?.[0]?.functionName || JSON.stringify(entry)
          this.errors.push(`[${entry.type ?? 'log'}] ${detail}`)
        }
      }
    }
  }

  static async connect(wsBaseUrl: string): Promise<FirefoxBiDi> {
    const ws = new WebSocket(wsBaseUrl + '/session')
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket error connecting to Firefox BiDi')), { once: true })
    })
    const client = new FirefoxBiDi(ws)
    await client.send('session.new', { capabilities: {} })
    await client.send('session.subscribe', { events: ['log.entryAdded'] })
    const tree = await client.send<{ contexts: Array<{ context: string }> }>('browsingContext.getTree', {})
    assert.ok(tree.contexts.length > 0, 'Firefox BiDi opened a browsing context')
    client.context = tree.contexts[0].context
    await client.send('browsingContext.setViewport', {
      context: client.context,
      viewport: { width: 1280, height: 800 }
    })
    return client
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = ++this.nextId
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`BiDi timeout calling ${method}`))
      }, 45_000)
      this.pending.set(id, { resolve, reject, timeout })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async addPreloadScript(functionDeclaration: string): Promise<string> {
    const res = await this.send<{ script: string }>('script.addPreloadScript', { functionDeclaration })
    return res.script
  }

  async removePreloadScript(script: string): Promise<void> {
    await this.send('script.removePreloadScript', { script })
  }

  async navigate(url: string): Promise<void> {
    await this.send('browsingContext.navigate', {
      context: this.context,
      url,
      wait: 'complete'
    })
  }

  async evaluate<T = any>(expression: string): Promise<T> {
    const wrapped = `(async () => { const __v = await (${expression}); return JSON.stringify(__v === undefined ? null : __v); })()`
    const res = await this.send<{
      type: string
      result?: { type: string; value?: string }
      exceptionDetails?: { text?: string }
    }>('script.evaluate', {
      expression: wrapped,
      target: { context: this.context },
      awaitPromise: true,
      resultOwnership: 'none'
    })
    if (res.type === 'exception') {
      throw new Error(`Page evaluation exception: ${res.exceptionDetails?.text ?? JSON.stringify(res)}`)
    }
    if (res.result?.type === 'string' && typeof res.result.value === 'string') {
      return JSON.parse(res.result.value) as T
    }
    return undefined as T
  }

  clearErrors(): void {
    this.errors.length = 0
  }

  async close(): Promise<void> {
    try {
      await this.send('session.end', {})
    } catch {
      // Ignore shutdown races
    }
    this.ws.close()
  }
}

async function startServer(): Promise<{ origin: string; stop: () => Promise<void> }> {
  const existing = process.env.RIDGETOP_URL
  if (existing) {
    return { origin: existing.replace(/\/$/, ''), stop: async () => {} }
  }
  const serverDir = await mkdtemp(join(tmpdir(), 'ridgetop-ff-server-'))
  const saveFile = join(serverDir, 'characters.json')
  const child = spawn(process.execPath, ['dist/server.js', '--testing'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', RIDGETOP_CHARACTER_SAVE: saveFile },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  let origin = ''
  for await (const line of createInterface({ input: child.stdout })) {
    const port = /listening on port (\d+)/.exec(line)?.[1]
    if (port) {
      origin = `http://127.0.0.1:${port}`
      break
    }
  }
  assert.ok(origin, 'Ridgetop testing server started')
  return {
    origin,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGTERM')
        await exited
      }
      await rm(serverDir, { recursive: true, force: true })
    }
  }
}

async function launchFirefox(): Promise<{ client: FirefoxBiDi; stop: () => Promise<void> }> {
  const profileDir = await createFirefoxProfileDir()
  const port = await getFreePort()
  const ff: ChildProcess = spawn(
    FIREFOX_BIN,
    [
      '--headless',
      '--new-instance',
      '--no-remote',
      '--profile', profileDir,
      `--remote-debugging-port=${port}`,
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  async function cleanupFirefox() {
    if (ff.exitCode === null && ff.signalCode === null) {
      const exited = once(ff, 'exit')
      ff.kill('SIGTERM')
      const killer = setTimeout(() => ff.kill('SIGKILL'), 5_000)
      try {
        await exited
      } finally {
        clearTimeout(killer)
      }
    }
    await rm(profileDir, { recursive: true, force: true })
  }

  let logs = ''
  let client: FirefoxBiDi
  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Firefox BiDi startup timed out:\n${logs}`)), 20_000)
      const detach = () => {
        clearTimeout(timer)
        ff.stdout?.off('data', onData)
        ff.stderr?.off('data', onData)
      }
      const onData = (chunk: Buffer) => {
        logs += chunk.toString()
        const match = /WebDriver BiDi listening on (ws:\/\/[^\s]+)/.exec(logs)
        if (match) {
          detach()
          resolve(match[1])
        }
      }
      ff.stdout?.on('data', onData)
      ff.stderr?.on('data', onData)
      ff.once('error', err => { detach(); reject(err) })
      ff.once('exit', code => { detach(); reject(new Error(`Firefox exited early (${code}):\n${logs}`)) })
    })

    client = await FirefoxBiDi.connect(wsUrl)
  } catch (error) {
    await cleanupFirefox().catch(() => {})
    throw error
  }
  return {
    client,
    async stop() {
      await client.close()
      await cleanupFirefox()
    }
  }
}

const uiState = (client: FirefoxBiDi, field: string) =>
  client.evaluate(`window.__ridgetopUi?.state?.()?.[${JSON.stringify(field)}]`)

const uiAct = (client: FirefoxBiDi, id: string, action = 'press', payload?: unknown) =>
  client.evaluate(`window.__ridgetopUi?.act(${JSON.stringify(id)}, ${JSON.stringify(action)}, ${JSON.stringify(payload)})`)

async function assertGameViewport(client: FirefoxBiDi, stage: string, hud: string, uiLayer: string): Promise<void> {
  await client.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const layout = await client.evaluate<Record<string, boolean>>(`(() => {
    const world = document.getElementById(${JSON.stringify(stage)})
    const layer = document.getElementById(${JSON.stringify(hud)})
    const ui = document.getElementById(${JSON.stringify(uiLayer)})
    if (!world || !layer || !ui) return { missing: true }
    const fillsViewport = el => {
      const rect = el.getBoundingClientRect()
      return Math.abs(rect.top) <= 1 && Math.abs(rect.left) <= 1 &&
        Math.abs(rect.width - innerWidth) <= 1 && Math.abs(rect.height - innerHeight) <= 1
    }
    const ctx = layer.getContext('2d')
    let painted = false
    if (ctx && layer.width > 0 && layer.height > 0) {
      const data = ctx.getImageData(0, 0, layer.width, layer.height).data
      for (let i = 3; i < data.length; i += 64) {
        if (data[i] > 0) { painted = true; break }
      }
    }
    return {
      playfield: fillsViewport(world),
      hud: fillsViewport(layer),
      ui: fillsViewport(ui),
      noHtmlMenus: [...document.querySelectorAll('button, select')].every(el => Boolean(el.closest('#ridgetop-testing-root'))),
      matchingPixels: layer.width === world.width && layer.height === world.height,
      painted
    }
  })()`)
  assert.deepEqual(layout, {
    playfield: true,
    hud: true,
    ui: true,
    noHtmlMenus: true,
    matchingPixels: true,
    painted: true
  }, `viewport check failed for ${stage}`)
}

let server: { origin: string; stop: () => Promise<void> } | undefined
let firefox: { client: FirefoxBiDi; stop: () => Promise<void> } | undefined
const benchmarkResults: BenchmarkRecord[] = []

try {
  server = await startServer()
  firefox = await launchFirefox()
  const { client } = firefox
  // 0. Inspect Firefox capabilities & GPU renderer info
  await client.navigate(`${server.origin}/benchmark`)
  const gpuInfo = await client.evaluate<{
    userAgent: string
    hasWebGPU: boolean
    webgl2: Record<string, string | null> | null
  }>(`(() => {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
    return {
      userAgent: navigator.userAgent,
      hasWebGPU: Boolean(navigator.gpu),
      webgl2: gl ? {
        renderer: gl.getParameter(gl.RENDERER),
        vendor: gl.getParameter(gl.VENDOR),
        version: gl.getParameter(gl.VERSION),
        unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null
      } : null
    }
  })()`)
  console.log('Firefox GPU info:', JSON.stringify(gpuInfo))
  assert.ok(gpuInfo.webgl2, 'Firefox WebGL 2 context available')

  // 1. Verify all 4 games across WebGL 2 and Canvas 2D
  for (const backend of BACKENDS) {
    const expectedName = RENDERER_NAMES[backend]

    // 1a. Beacon Run (/)
    client.clearErrors()
    await client.navigate(`${server.origin}/?mode=practice&renderer=${backend}`)
    await until(() => uiState(client, 'backend'), expectedName, `Beacon Run ${backend} initialized`)
    await until(() => uiState(client, 'connection'), 'Solo practice', `Beacon Run ${backend} practice loaded`)
    await assertGameViewport(client, 'stage', 'beacon-hud', 'ui')
    await uiAct(client, 'pause')
    await until(() => uiState(client, 'screen'), 'pause', `Beacon Run ${backend} pause`)
    await uiAct(client, 'resume')
    await until(() => uiState(client, 'screen'), 'play', `Beacon Run ${backend} resume`)
    assert.deepEqual(client.errors, [], `Beacon Run (${backend}) console/JS errors`)
    console.log(`PASS Firefox ${backend}: Beacon Run (/)`)

    // 1b. Signal Drift (/racing)
    client.clearErrors()
    await client.navigate(`${server.origin}/racing?renderer=${backend}`)
    await until(() => uiState(client, 'backend'), expectedName, `Signal Drift ${backend} initialized`)
    await uiAct(client, 'race-garage')
    await until(() => uiState(client, 'screen'), 'garage', `Signal Drift ${backend} garage`)
    await uiAct(client, 'garage-back')
    await uiAct(client, 'race-start')
    await until(() => uiState(client, 'screen'), 'racing', `Signal Drift ${backend} race started`)
    await assertGameViewport(client, 'race-stage', 'race-hud', 'race-ui')
    assert.deepEqual(client.errors, [], `Signal Drift (${backend}) console/JS errors`)
    console.log(`PASS Firefox ${backend}: Signal Drift (/racing)`)

    // 1c. Tidewatch (/lighthouse)
    client.clearErrors()
    await client.navigate(`${server.origin}/lighthouse?renderer=${backend}`)
    await until(() => uiState(client, 'screen'), 'title', `Tidewatch ${backend} title`)
    await uiAct(client, 'lh-play')
    await until(() => uiState(client, 'screen'), 'playing', `Tidewatch ${backend} playing`)
    await assertGameViewport(client, 'lh-stage', 'lh-hud', 'lh-ui')
    const lhState = await client.evaluate<Record<string, unknown>>('window.__ridgetopUi?.state?.()')
    for (const metric of ['day', 'coins', 'fuel', 'warmth', 'carry', 'shipsGuided']) {
      const value = lhState?.[metric]
      assert.ok(typeof value === 'number' && Number.isFinite(value), `Tidewatch ${backend} ${metric} finite`)
    }
    assert.deepEqual(client.errors, [], `Tidewatch (${backend}) console/JS errors`)
    console.log(`PASS Firefox ${backend}: Tidewatch (/lighthouse)`)

    // 1d. Starter / Lantern Grove (/starter/)
    client.clearErrors()
    await client.navigate(`${server.origin}/starter/?renderer=${backend}`)
    await until(() => uiState(client, 'count'), '0 / 3', `Starter ${backend} initialized`)
    const starterReady = await until(
      () => client.evaluate<boolean>(`(() => {
        const world = document.querySelector('#world')
        return Boolean(world && !world.hidden && world.width > 0 && world.height > 0)
      })()`),
      true,
      `Starter ${backend} 3D canvas active`
    )
    assert.equal(starterReady, true)
    await uiAct(client, 'hud-view-toggle', 'toggle')
    await until(
      () => client.evaluate<boolean>(`(() => {
        const layer = document.querySelector('#sprites')
        if (!layer || layer.hidden) return false
        const pixels = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
        return pixels.some((v, i) => i % 4 === 3 && v > 0)
      })()`),
      true,
      `Starter ${backend} 2D sprite view rendered`
    )
    assert.deepEqual(client.errors, [], `Starter (${backend}) console/JS errors`)
    console.log(`PASS Firefox ${backend}: Starter (/starter/)`)
  }

  // 2. Verify Testing Mode (?testing=1)
  client.clearErrors()
  await client.navigate(`${server.origin}/starter/?testing=1&renderer=webgl2`)
  await until(
    () => client.evaluate<string | null>("document.querySelector('#rt-pause-btn')?.textContent?.trim() ?? null"),
    'Pause & Inspect (F9)',
    'Testing Mode studio mounted on /starter/?testing=1'
  )
  await client.evaluate("document.querySelector('#rt-pause-btn').click()")
  await until(
    () => client.evaluate<boolean>("Boolean(document.querySelector('#ridgetop-testing-drawer'))"),
    true,
    'Testing Mode drawer opened on pause'
  )
  assert.deepEqual(client.errors, [], 'Testing Mode (?testing=1) console/JS errors')
  console.log('PASS Firefox webgl2: Testing Mode (/starter/?testing=1)')

  // 3. Run /benchmark across WebGL 2 and Canvas 2D (static + dynamic)
  const preloadId = await client.addPreloadScript(`() => {
    const orig = URL.createObjectURL.bind(URL)
    window.__ridgetopLastBenchmarkJson = null
    URL.createObjectURL = (blob) => {
      if (blob && typeof blob.text === 'function') {
        blob.text().then(text => { window.__ridgetopLastBenchmarkJson = text })
      }
      return orig(blob)
    }
  }`)
  try {
    client.clearErrors()
    await client.navigate(`${server.origin}/benchmark`)
    await until(() => client.evaluate<boolean>("document.readyState === 'complete'"), true, 'Benchmark page loaded')
    const workloads: Array<'static' | 'dynamic'> = ['static', 'dynamic']
    for (const backend of BACKENDS) {
      for (const workload of workloads) {
        await client.evaluate(`(() => {
          window.__ridgetopLastBenchmarkJson = null
          document.querySelector('[name=backend]').value = ${JSON.stringify(backend)}
          document.querySelector('[name=count]').value = ${JSON.stringify(String(BENCHMARK_COUNT))}
          document.querySelector('[name=workload]').value = ${JSON.stringify(workload)}
          document.querySelector('#run').click()
        })()`)
        const line = await until(
          () => client.evaluate<string | null>("document.querySelector('#result')?.textContent ?? null"),
          s => typeof s === 'string' && s.length > 0 && s !== 'Running…',
          `Firefox benchmark ${backend} ${workload}`,
          300
        )
        assert.ok(line !== null && line.startsWith(RENDERER_NAMES[backend] + ' ·'), `Unexpected benchmark result: ${line}`)
        const rawJson = await until(
          () => client.evaluate<string | null>('window.__ridgetopLastBenchmarkJson'),
          Boolean,
          `Firefox benchmark JSON capture ${backend} ${workload}`,
          50
        )
        const parsed = JSON.parse(rawJson as string) as BenchmarkRecord
        if (backend === 'webgl2' && workload === 'static') {
          assert.equal(parsed.drawCalls, 2, 'WebGL 2 static drawCalls === 2')
          assert.equal(parsed.uploadBytes, 0, 'WebGL 2 static uploadBytes === 0')
        }
        if (backend === 'webgl2' && workload === 'dynamic') {
          assert.equal(parsed.drawCalls, 2, 'WebGL 2 dynamic drawCalls === 2')
          assert.equal(parsed.uploadBytes, BENCHMARK_COUNT * 64, 'WebGL 2 dynamic uploadBytes === count * 64')
        }
        benchmarkResults.push(parsed)
        console.log(`BENCH Firefox ${backend} ${workload}: ${line}`)
      }
    }
    assert.deepEqual(client.errors, [], 'Benchmark page console/JS errors')
  } finally {
    await client.removePreloadScript(preloadId)
  }

  console.log('FIREFOX_BENCHMARK_JSON=' + JSON.stringify(benchmarkResults, null, 2))
  console.log('All Firefox headless smoke & benchmark checks passed.')
} finally {
  if (firefox) await firefox.stop()
  if (server) await server.stop()
}
