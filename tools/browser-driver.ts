import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

export interface BrowserPage {
  readonly browser: string
  readonly errors: readonly string[]
  evaluate(expression: string): Promise<unknown>
  navigate(url: string): Promise<void>
  reload(): Promise<void>
  clearErrors(): void
  addPreloadScript(source: string): Promise<() => Promise<void>>
  close(): Promise<void>
}

export interface ChromiumPage extends BrowserPage {
  call(method: string, params?: object): Promise<Record<string, unknown>>
  bringToFront(): Promise<void>
  capturePngBase64(params?: Record<string, unknown>): Promise<string>
  setViewport(width: number, height: number, mobile?: boolean): Promise<void>
  setTouchEnabled(enabled: boolean, maxTouchPoints?: number): Promise<void>
  dispatchKey(type: 'keyDown' | 'keyUp', code: string, keyName: string): Promise<Record<string, unknown>>
  dispatchTouch(type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Array<{ x: number; y: number }>): Promise<void>
  dispatchMouse(
    type: 'mousePressed' | 'mouseMoved' | 'mouseReleased',
    x: number,
    y: number,
    options?: { button?: string; buttons?: number; clickCount?: number }
  ): Promise<void>
  setFileInputFiles(selector: string, files: string[]): Promise<void>
}

export type BrowserTab = ChromiumPage

export interface FirefoxPage extends BrowserPage {
  readonly context: string
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  setViewport(width: number, height: number): Promise<void>
}

export interface FirefoxSession {
  readonly page: FirefoxPage
  stop(): Promise<void>
}

export interface UiRect {
  x: number
  y: number
  width: number
  height: number
}

export interface GameViewportOptions {
  stage: string
  uiLayer: string
  noScroll?: boolean
  matchingPixels?: boolean
  waitForFrame?: boolean
  label?: string
}

export interface HostedServerOptions {
  existingUrl?: string
  command?: string
  args?: readonly string[]
  cwd?: string | URL
  env?: NodeJS.ProcessEnv
  testing?: boolean
  tempPrefix?: string
  manageSaveDir?: boolean
  startupTimeoutMs?: number
  stdioStderr?: 'inherit' | 'pipe'
}

export interface HostedServer {
  readonly origin: string
  readonly port: number
  readonly saveFile?: string
  readonly tempDir?: string
  logs(): string
  stop(): Promise<void>
}

export interface SmokeFilter {
  readonly terms: readonly string[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPredicate<T>(expected: T | ((value: T) => unknown)): expected is (value: T) => unknown {
  return typeof expected === 'function'
}

function isUiRect(value: unknown): value is UiRect {
  return isRecord(value) &&
    typeof value.x === 'number' && typeof value.y === 'number' &&
    typeof value.width === 'number' && typeof value.height === 'number'
}

export async function until<T>(
  read: () => Promise<T> | T,
  expected: T | ((value: T) => unknown),
  description: string,
  limit = 160,
  intervalMs = 100
): Promise<T> {
  let actual: T | undefined
  for (let i = 0; i < limit; i++) {
    actual = await read()
    if (isPredicate(expected) ? expected(actual) : expected === actual) return actual
    if (intervalMs > 0) await wait(intervalMs)
  }
  assert.fail(`${description}. Last value: ${JSON.stringify(actual)}`)
}

export async function status(page: BrowserPage, id: string): Promise<string | null | undefined> {
  const value = await page.evaluate(`document.querySelector(${JSON.stringify('#' + id)})?.textContent`)
  return typeof value === 'string' ? value : value === null ? null : undefined
}

export function click(page: BrowserPage, id: string): Promise<unknown> {
  return page.evaluate(`document.querySelector(${JSON.stringify('#' + id)})?.click()`)
}

export function key(
  tab: ChromiumPage,
  type: 'keyDown' | 'keyUp',
  code: string,
  keyName: string
): Promise<Record<string, unknown>> {
  return tab.dispatchKey(type, code, keyName)
}

export function uiState(page: BrowserPage, field: string): Promise<unknown> {
  return page.evaluate(`window.__ridgetopUi?.state?.()?.[${JSON.stringify(field)}]`)
}

export async function uiStateRecord(page: BrowserPage): Promise<Record<string, unknown>> {
  const value = await page.evaluate('window.__ridgetopUi?.state?.()')
  if (!isRecord(value)) assert.fail(`Expected UI state object, got ${typeof value}`)
  return value
}

export async function uiString(page: BrowserPage, field: string): Promise<string> {
  const value = await uiState(page, field)
  if (typeof value !== 'string') assert.fail(`Expected string for ui state ${field}, got ${typeof value}`)
  return value
}

export async function uiStringList(page: BrowserPage, field: string): Promise<string[] | undefined> {
  const value = await uiState(page, field)
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? value : undefined
}

export function uiAct(
  page: BrowserPage,
  id: string,
  action = 'press',
  payload?: unknown
): Promise<unknown> {
  const payloadArg = payload === undefined ? 'undefined' : JSON.stringify(payload)
  return page.evaluate(`window.__ridgetopUi?.act(${JSON.stringify(id)}, ${JSON.stringify(action)}, ${payloadArg})`)
}

export async function uiRect(page: BrowserPage, id: string): Promise<UiRect | undefined> {
  const value = await page.evaluate(`window.__ridgetopUi?.rects?.()?.[${JSON.stringify(id)}]`)
  return isUiRect(value) ? value : undefined
}

export function namespaceStorageScript(prefix: string): string {
  return `(() => {
    let storage
    try {
      storage = window.localStorage
    } catch {
      return
    }
    if (!storage) return
    const prefix = ${JSON.stringify(prefix)}
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: key => storage.getItem(prefix + key),
        setItem: (key, value) => storage.setItem(prefix + key, value),
        removeItem: key => storage.removeItem(prefix + key)
      }
    })
  })()`
}

export async function assertGameViewport(page: BrowserPage, options: GameViewportOptions): Promise<void> {
  const {
    stage,
    uiLayer,
    noScroll = true,
    matchingPixels = true,
    waitForFrame = true,
    label = stage
  } = options

  if (waitForFrame) {
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }

  const layout = await page.evaluate(`(() => {
    const world = document.getElementById(${JSON.stringify(stage)})
    const ui = document.getElementById(${JSON.stringify(uiLayer)})
    if (!world || !ui) return { missing: true }
    const fillsViewport = el => {
      const rect = el.getBoundingClientRect()
      return Math.abs(rect.top) <= 1 && Math.abs(rect.left) <= 1 &&
        Math.abs(rect.width - innerWidth) <= 1 && Math.abs(rect.height - innerHeight) <= 1
    }
    const ctx = ui.getContext('2d')
    let painted = false
    let nonUniform = false
    if (ctx && ui.width > 0 && ui.height > 0) {
      const data = ctx.getImageData(0, 0, ui.width, ui.height).data
      let firstKey = ''
      const stride = Math.max(4, Math.floor(data.length / 4096) * 4)
      for (let i = 0; i + 3 < data.length; i += stride) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]
        if (a > 0) painted = true
        const key = r + ',' + g + ',' + b + ',' + a
        if (!firstKey) firstKey = key
        else if (key !== firstKey) nonUniform = true
        if (painted && nonUniform) break
      }
    }
    const scrollEl = document.scrollingElement
    const scrollHeight = scrollEl ? scrollEl.scrollHeight : innerHeight
    return {
      sized: world.width > 0 && world.height > 0 && ui.width > 0 && ui.height > 0,
      playfield: fillsViewport(world),
      ui: fillsViewport(ui),
      noSeparateHud: document.querySelectorAll('canvas[id$="-hud"]').length === 0,
      noHtmlMenus: [...document.querySelectorAll('button, select')].every(el => Boolean(el.closest('#ridgetop-testing-root'))),
      noScroll: Math.abs(scrollHeight - innerHeight) <= 1,
      matchingPixels: ui.width === world.width && ui.height === world.height,
      painted,
      nonUniform
    }
  })()`)

  if (!isRecord(layout)) {
    assert.fail(`Viewport layout check returned non-object for ${label}`)
  }

  const expected: Record<string, boolean> = {
    sized: true,
    playfield: true,
    ui: true,
    noSeparateHud: true,
    noHtmlMenus: true,
    painted: true,
    nonUniform: true
  }
  const actual: Record<string, unknown> = {
    sized: layout.sized,
    playfield: layout.playfield,
    ui: layout.ui,
    noSeparateHud: layout.noSeparateHud,
    noHtmlMenus: layout.noHtmlMenus,
    painted: layout.painted,
    nonUniform: layout.nonUniform
  }
  if (noScroll) {
    expected.noScroll = true
    actual.noScroll = layout.noScroll
  }
  if (matchingPixels) {
    expected.matchingPixels = true
    actual.matchingPixels = layout.matchingPixels
  }
  assert.deepEqual(actual, expected, `viewport check failed for ${label}`)
}

export function parseSmokeFilter(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): SmokeFilter {
  const rawTerms: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--filter' || arg === '-f') {
      const next = argv[i + 1]
      if (!next || next.startsWith('-')) throw new Error(`Missing value after ${arg}`)
      rawTerms.push(next)
      i++
    } else if (arg.startsWith('--filter=')) {
      rawTerms.push(arg.slice('--filter='.length))
    }
  }
  if (rawTerms.length === 0 && env.RIDGETOP_SMOKE_FILTER) {
    rawTerms.push(env.RIDGETOP_SMOKE_FILTER)
  }
  const terms = rawTerms
    .flatMap(entry => entry.split(','))
    .map(term => term.trim().toLowerCase())
    .filter(term => term.length > 0)
  return { terms }
}

export function matchesSmokeFilter(filter: SmokeFilter, ...tags: string[]): boolean {
  if (filter.terms.length === 0) return true
  const lowered = tags.map(tag => tag.toLowerCase())
  return filter.terms.some(term => lowered.some(tag => tag === term || tag.includes(term)))
}

async function waitProcessExit(child: ChildProcess, graceMs = 4_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const killer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, graceMs)
  try {
    await exited
  } finally {
    clearTimeout(killer)
  }
}

export async function startHostedServer(options: HostedServerOptions = {}): Promise<HostedServer> {
  const existing = options.existingUrl?.trim()
  if (existing) {
    const normalized = existing.replace(/\/$/, '')
    const parsed = new URL(normalized)
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
    return {
      origin: normalized,
      port,
      logs: () => '',
      stop: async () => {}
    }
  }

  const manageSaveDir = options.manageSaveDir ?? true
  const tempDir = manageSaveDir
    ? await mkdtemp(join(tmpdir(), options.tempPrefix ?? 'ridgetop-server-'))
    : undefined
  const saveFile = tempDir ? join(tempDir, 'characters.json') : undefined

  const command = options.command ?? process.execPath
  const baseArgs = options.args ? [...options.args] : ['dist/server.js']
  if (options.testing && !baseArgs.includes('--testing')) baseArgs.push('--testing')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '0',
    ...(saveFile ? { RIDGETOP_CHARACTER_SAVE: saveFile } : {}),
    ...options.env
  }

  const stderrMode = options.stdioStderr ?? 'inherit'
  const child = spawn(command, baseArgs, {
    cwd: options.cwd ?? new URL('../', import.meta.url),
    env,
    stdio: ['ignore', 'pipe', stderrMode]
  })
  const closed = once(child, 'close')
  closed.catch(() => {
    // Missing binary or early exit is surfaced by the readiness promise below.
  })

  let log = ''
  const record = (chunk: Buffer) => {
    log += chunk.toString()
  }
  if (child.stderr) child.stderr.on('data', record)

  const cleanup = async () => {
    await waitProcessExit(child)
    if (tempDir) await rm(tempDir, { recursive: true, force: true })
  }

  try {
    const timeoutMs = options.startupTimeoutMs ?? 15_000
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server startup timed out (${command} ${baseArgs.join(' ')})\n${log}`)), timeoutMs)
      const detach = () => {
        clearTimeout(timer)
        child.stdout?.off('data', onStdout)
        child.off('error', onError)
        child.off('close', onClose)
      }
      const onError = (err: Error) => {
        detach()
        reject(err)
      }
      const onClose = (code: number | null) => {
        detach()
        reject(new Error(`Server exited early (${code})\n${log}`))
      }
      const onStdout = (chunk: Buffer) => {
        record(chunk)
        const match = /listening on port (\d+)/.exec(log)
        if (match) {
          detach()
          resolve(Number(match[1]))
        }
      }
      child.stdout?.on('data', onStdout)
      child.once('error', onError)
      child.once('close', onClose)
    })

    return {
      origin: `http://127.0.0.1:${port}`,
      port,
      saveFile,
      tempDir,
      logs: () => log,
      stop: cleanup
    }
  } catch (error) {
    await cleanup().catch(() => {
      // Preserve the original startup failure.
    })
    throw error
  }
}

export async function connectOrStartServer(options: {
  existingUrl?: string
  defaultOrigin?: string
  testing?: boolean
  tempPrefix?: string
} = {}): Promise<HostedServer> {
  if (options.existingUrl) {
    return await startHostedServer({ existingUrl: options.existingUrl })
  }
  const fallback = options.defaultOrigin ?? 'http://localhost:3000'
  try {
    const res = await fetch(`${fallback}/healthz`, { signal: AbortSignal.timeout(500) })
    if (res.ok) return await startHostedServer({ existingUrl: fallback })
  } catch {
    // No server running at defaultOrigin; start a managed one.
  }
  return await startHostedServer({
    testing: options.testing ?? true,
    tempPrefix: options.tempPrefix ?? 'ridgetop-smoke-server-'
  })
}

// ============================================================================
// Adapter 1: Chromium DevTools Protocol (CDP)
// ============================================================================

function debugUrl(): string {
  return process.env.CHROMIUM_DEBUG ?? 'http://localhost:9222'
}

interface DevToolsTarget {
  id: string
  webSocketDebuggerUrl: string
}

interface PendingCall {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

function isDevToolsTarget(value: unknown): value is DevToolsTarget {
  return isRecord(value) && typeof value.id === 'string' && typeof value.webSocketDebuggerUrl === 'string'
}

async function connectCdp(url: string) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map<number, PendingCall>()
  const errors: string[] = []
  let message = 0
  socket.onmessage = ({ data }) => {
    const packet: unknown = JSON.parse(String(data))
    if (!isRecord(packet)) return
    if (typeof packet.id === 'number') {
      const action = pending.get(packet.id)
      if (!action) return
      clearTimeout(action.timeout)
      pending.delete(packet.id)
      if (isRecord(packet.error) && typeof packet.error.message === 'string') {
        action.reject(new Error(packet.error.message))
      } else {
        action.resolve(isRecord(packet.result) ? packet.result : {})
      }
    }
    if (packet.method === 'Runtime.exceptionThrown' && isRecord(packet.params) &&
        isRecord(packet.params.exceptionDetails) && typeof packet.params.exceptionDetails.text === 'string') {
      errors.push(packet.params.exceptionDetails.text)
    }
    if (packet.method === 'Log.entryAdded' && isRecord(packet.params) &&
        isRecord(packet.params.entry) && packet.params.entry.level === 'error' &&
        typeof packet.params.entry.text === 'string') {
      errors.push(packet.params.entry.text)
    }
  }
  const call = (method: string, params?: object) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++message
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Timed out calling ' + method))
    }, 45_000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { call, errors, close: () => socket.close() }
}

async function attachCdpTarget(target: DevToolsTarget, beforeLoad?: string): Promise<ChromiumPage> {
  const { call, errors, close } = await connectCdp(target.webSocketDebuggerUrl)
  const page: ChromiumPage = {
    browser: 'chromium',
    call,
    errors,
    clearErrors() {
      errors.length = 0
    },
    async evaluate(expression: string): Promise<unknown> {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return isRecord(result.result) ? result.result.value : undefined
    },
    async navigate(url: string): Promise<void> {
      const navigation = await call('Page.navigate', { url })
      if (typeof navigation.errorText === 'string' && navigation.errorText) {
        throw new Error(`Chromium navigation failed (${url}): ${navigation.errorText}`)
      }
      await call('Page.bringToFront')
    },
    async reload(): Promise<void> {
      await call('Page.reload')
    },
    async addPreloadScript(source: string): Promise<() => Promise<void>> {
      const { identifier } = await call('Page.addScriptToEvaluateOnNewDocument', { source })
      if (typeof identifier !== 'string') throw new Error('Missing preload script identifier from DevTools')
      return async () => {
        await call('Page.removeScriptToEvaluateOnNewDocument', { identifier })
      }
    },
    async bringToFront(): Promise<void> {
      await call('Page.bringToFront')
    },
    async capturePngBase64(params: Record<string, unknown> = {}): Promise<string> {
      const result = await call('Page.captureScreenshot', { format: 'png', ...params })
      if (typeof result.data !== 'string') assert.fail('Missing screenshot data')
      return result.data
    },
    async setViewport(width: number, height: number, mobile = false): Promise<void> {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    },
    async setTouchEnabled(enabled: boolean, maxTouchPoints = 2): Promise<void> {
      await call('Emulation.setTouchEmulationEnabled', { enabled, maxTouchPoints })
    },
    dispatchKey(type, code, keyName) {
      return call('Input.dispatchKeyEvent', { type, key: keyName, code })
    },
    async dispatchTouch(type, touchPoints) {
      await call('Input.dispatchTouchEvent', { type, touchPoints })
    },
    async dispatchMouse(type, x, y, options = {}) {
      await call('Input.dispatchMouseEvent', { type, x, y, ...options })
    },
    async setFileInputFiles(selector: string, files: string[]): Promise<void> {
      const { root } = await call('DOM.getDocument')
      if (!isRecord(root) || typeof root.nodeId !== 'number') throw new Error('Missing DOM root node')
      const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector })
      if (typeof nodeId !== 'number') throw new Error(`Missing file input: ${selector}`)
      await call('DOM.setFileInputFiles', { nodeId, files })
    },
    async close() {
      close()
      await fetch(debugUrl() + '/json/close/' + target.id)
    }
  }
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Log.enable')
  if (beforeLoad) await page.addPreloadScript(beforeLoad)
  return page
}

export async function openTab(url: string, beforeLoad?: string): Promise<ChromiumPage> {
  const target: unknown = await fetch(debugUrl() + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json())
  if (!isDevToolsTarget(target)) throw new Error('Unexpected DevTools target response')
  const tab = await attachCdpTarget(target, beforeLoad)
  await tab.navigate(url)
  return tab
}

// Player release checks run in temporary profiles so downloads and saves stay isolated.
export async function openPlayerTab(downloadPath: string): Promise<ChromiumPage> {
  const info: unknown = await fetch(debugUrl() + '/json/version').then(r => r.json())
  if (!isRecord(info) || typeof info.webSocketDebuggerUrl !== 'string') {
    throw new Error('Unexpected DevTools version response')
  }
  const browser = await connectCdp(info.webSocketDebuggerUrl)
  const { browserContextId } = await browser.call('Target.createBrowserContext', { disposeOnDetach: true })
  if (typeof browserContextId !== 'string') {
    browser.close()
    throw new Error('Missing browserContextId from DevTools')
  }
  async function dispose() {
    try {
      await browser.call('Target.disposeBrowserContext', { browserContextId })
    } finally {
      browser.close()
    }
  }
  try {
    await browser.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, browserContextId })
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank', browserContextId })
    if (typeof targetId !== 'string') throw new Error('Missing targetId from DevTools')
    const targets: unknown = await fetch(debugUrl() + '/json/list').then(r => r.json())
    if (!Array.isArray(targets)) throw new Error('Unexpected DevTools target list')
    const target = targets.filter(isDevToolsTarget).find(entry => entry.id === targetId)
    if (!target) throw new Error('Browser target not found: ' + targetId)
    const tab = await attachCdpTarget(target)
    await tab.call('Network.enable')
    await tab.call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await tab.bringToFront()
    return {
      ...tab,
      async close() {
        try {
          await tab.close()
        } finally {
          await dispose()
        }
      }
    }
  } catch (error) {
    await dispose()
    throw error
  }
}

// ============================================================================
// Adapter 2: Firefox WebDriver BiDi
// ============================================================================

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

class FirefoxBiDiPage implements FirefoxPage {
  readonly browser = 'firefox'
  readonly errors: string[] = []
  private readonly ws: WebSocket
  private nextId = 0
  private readonly pending = new Map<number, PendingCall>()
  private _context = ''

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
      const msg: unknown = JSON.parse(String(data))
      if (!isRecord(msg)) return
      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id)
        if (!entry) return
        clearTimeout(entry.timeout)
        this.pending.delete(msg.id)
        if (msg.type === 'error') {
          entry.reject(new Error(`BiDi ${String(msg.error)}: ${String(msg.message)}`))
        } else {
          entry.resolve(isRecord(msg.result) ? msg.result : {})
        }
        return
      }
      if (msg.type === 'event' && msg.method === 'log.entryAdded' && isRecord(msg.params)) {
        const entry = msg.params
        if (entry.level === 'error') {
          const stack = isRecord(entry.stackTrace) && Array.isArray(entry.stackTrace.callFrames)
            ? entry.stackTrace.callFrames[0]
            : undefined
          const fnName = isRecord(stack) && typeof stack.functionName === 'string' ? stack.functionName : undefined
          const detail = (typeof entry.text === 'string' && entry.text) || fnName || JSON.stringify(entry)
          const entryType = typeof entry.type === 'string' ? entry.type : 'log'
          this.errors.push(`[${entryType}] ${detail}`)
        }
      }
    }
  }

  get context(): string {
    return this._context
  }

  static async connect(
    wsBaseUrl: string,
    viewport: { width: number; height: number } = { width: 1280, height: 800 }
  ): Promise<FirefoxBiDiPage> {
    const ws = new WebSocket(wsBaseUrl + '/session')
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('WebSocket error connecting to Firefox BiDi')), { once: true })
    })
    const page = new FirefoxBiDiPage(ws)
    await page.send('session.new', { capabilities: {} })
    await page.send('session.subscribe', { events: ['log.entryAdded'] })
    const tree = await page.send('browsingContext.getTree', {})
    const contexts = Array.isArray(tree.contexts) ? tree.contexts : []
    const firstContext = contexts[0]
    assert.ok(isRecord(firstContext) && typeof firstContext.context === 'string', 'Firefox BiDi opened a browsing context')
    page._context = firstContext.context
    await page.setViewport(viewport.width, viewport.height)
    return page
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++this.nextId
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`BiDi timeout calling ${method}`))
      }, 45_000)
      this.pending.set(id, { resolve, reject, timeout })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.send('browsingContext.setViewport', {
      context: this._context,
      viewport: { width, height }
    })
  }

  async addPreloadScript(source: string): Promise<() => Promise<void>> {
    const functionDeclaration = `() => {\n${source}\n}`
    const res = await this.send('script.addPreloadScript', { functionDeclaration })
    if (typeof res.script !== 'string') throw new Error('Missing preload script id from BiDi')
    const scriptId = res.script
    return async () => {
      await this.send('script.removePreloadScript', { script: scriptId })
    }
  }

  async navigate(url: string): Promise<void> {
    await this.send('browsingContext.navigate', {
      context: this._context,
      url,
      wait: 'complete'
    })
  }

  async reload(): Promise<void> {
    await this.send('browsingContext.reload', {
      context: this._context,
      wait: 'complete'
    })
  }

  async evaluate(expression: string): Promise<unknown> {
    const wrapped = `(async () => { const __v = await (${expression}); return JSON.stringify(__v === undefined ? null : __v); })()`
    const res = await this.send('script.evaluate', {
      expression: wrapped,
      target: { context: this._context },
      awaitPromise: true,
      resultOwnership: 'none'
    })
    if (res.type === 'exception') {
      const detail = isRecord(res.exceptionDetails) && typeof res.exceptionDetails.text === 'string'
        ? res.exceptionDetails.text
        : JSON.stringify(res)
      throw new Error(`Page evaluation exception: ${detail}`)
    }
    if (isRecord(res.result) && res.result.type === 'string' && typeof res.result.value === 'string') {
      const parsed: unknown = JSON.parse(res.result.value)
      return parsed
    }
    return undefined
  }

  clearErrors(): void {
    this.errors.length = 0
  }

  async close(): Promise<void> {
    try {
      await this.send('session.end', {})
    } catch {
      // Ignore shutdown races.
    }
    this.ws.close()
  }
}

export async function launchFirefoxSession(options: {
  binary?: string
  viewport?: { width: number; height: number }
} = {}): Promise<FirefoxSession> {
  const binary = options.binary ?? process.env.RIDGETOP_FIREFOX ?? 'firefox'
  const profileDir = await createFirefoxProfileDir()
  const port = await getFreePort()
  const ff = spawn(
    binary,
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
    await waitProcessExit(ff, 5_000)
    await rm(profileDir, { recursive: true, force: true })
  }

  let logs = ''
  let page: FirefoxBiDiPage
  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Firefox BiDi startup timed out:\n${logs}`)), 20_000)
      const detach = () => {
        clearTimeout(timer)
        ff.stdout?.off('data', onData)
        ff.stderr?.off('data', onData)
        ff.off('error', onError)
        ff.off('exit', onExit)
      }
      const onData = (chunk: Buffer) => {
        logs += chunk.toString()
        const match = /WebDriver BiDi listening on (ws:\/\/[^\s]+)/.exec(logs)
        if (match) {
          detach()
          resolve(match[1])
        }
      }
      const onError = (err: Error) => {
        detach()
        reject(err)
      }
      const onExit = (code: number | null) => {
        detach()
        reject(new Error(`Firefox exited early (${code}):\n${logs}`))
      }
      ff.stdout?.on('data', onData)
      ff.stderr?.on('data', onData)
      ff.once('error', onError)
      ff.once('exit', onExit)
    })

    page = await FirefoxBiDiPage.connect(wsUrl, options.viewport)
  } catch (error) {
    await cleanupFirefox().catch(() => {
      // Preserve startup error.
    })
    throw error
  }

  return {
    page,
    async stop() {
      await page.close()
      await cleanupFirefox()
    }
  }
}
