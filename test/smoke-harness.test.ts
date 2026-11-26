import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import type { BrowserPage } from '../tools/browser-driver.ts'
import {
  assertGameViewport,
  click,
  isRecord,
  matchesSmokeFilter,
  namespaceStorageScript,
  parseSmokeFilter,
  startHostedServer,
  status,
  uiAct,
  uiRect,
  uiState,
  uiStateRecord,
  uiString,
  uiStringList,
  until
} from '../tools/browser-driver.ts'
import {
  parseBackends,
  parseBenchmarkRecord,
  runFilteredSuites,
  verifyBeaconRunCore,
  verifyBenchmarkCore,
  verifyCrownshardCore,
  verifySignalDriftCore,
  verifyStarterCore,
  verifyTestingModeCore,
  verifyTidewatchCore
} from '../tools/smoke-suites.ts'

interface FakeDomCanvas {
  id: string
  width: number
  height: number
  hidden: boolean
  rect: { top: number; left: number; width: number; height: number }
  pixels: Uint8ClampedArray
}

interface FakeDomElement {
  id?: string
  tag: string
  textContent: string
  value?: string
  href?: string
  insideTestingRoot?: boolean
  onClick?: () => void
}

interface FakePageOptions {
  innerWidth?: number
  innerHeight?: number
  scrollHeight?: number
  canvases?: FakeDomCanvas[]
  elements?: FakeDomElement[]
  initialState?: Record<string, unknown>
  rects?: Record<string, { x: number; y: number; width: number; height: number }>
  onAct?: (state: Record<string, unknown>, id: string, action: string, payload: unknown) => unknown
  onNavigate?: (url: string, state: Record<string, unknown>, page: FakeBrowserPage) => void
  onReload?: (state: Record<string, unknown>, page: FakeBrowserPage) => void
}

function makeNonUniformPixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  // Top-left transparent (0,0,0,0), middle pixel opaque colored (200,150,50,255)
  const mid = Math.floor((width * height) / 2) * 4
  data[mid] = 200
  data[mid + 1] = 150
  data[mid + 2] = 50
  data[mid + 3] = 255
  return data
}

function makeSolidPixels(width: number, height: number, r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = a
  }
  return data
}

class FakeBrowserPage implements BrowserPage {
  readonly browser = 'fake'
  readonly errors: string[] = []
  readonly navigatedUrls: string[] = []
  readonly actions: Array<{ id: string; action: string; payload: unknown }> = []
  readonly preloadScripts = new Map<number, string>()
  private nextPreloadId = 0
  private readonly rawStorage = new Map<string, string>()
  readonly state: Record<string, unknown>
  readonly canvases: FakeDomCanvas[]
  readonly elements: FakeDomElement[]
  readonly rects: Record<string, { x: number; y: number; width: number; height: number }>
  innerWidth: number
  innerHeight: number
  scrollHeight: number
  private readonly onAct?: FakePageOptions['onAct']
  private readonly onNavigate?: FakePageOptions['onNavigate']
  private readonly onReload?: FakePageOptions['onReload']
  private context: vm.Context

  constructor(options: FakePageOptions = {}) {
    this.innerWidth = options.innerWidth ?? 1280
    this.innerHeight = options.innerHeight ?? 800
    this.scrollHeight = options.scrollHeight ?? this.innerHeight
    this.canvases = options.canvases ?? []
    this.elements = options.elements ?? []
    this.state = { ...(options.initialState ?? {}) }
    this.rects = { ...(options.rects ?? {}) }
    this.onAct = options.onAct
    this.onNavigate = options.onNavigate
    this.onReload = options.onReload
    this.context = this.buildContext()
  }

  private buildContext(): vm.Context {
    const rawStorage = this.rawStorage
    const canvases = this.canvases
    const elements = this.elements
    const state = this.state
    const rects = this.rects
    const actions = this.actions
    const onAct = this.onAct
    const self = this

    const makeCanvasHandle = (c: FakeDomCanvas) => ({
      id: c.id,
      get width() { return c.width },
      get height() { return c.height },
      get hidden() { return c.hidden },
      getBoundingClientRect: () => ({ ...c.rect }),
      getContext: (kind: string) => kind === '2d'
        ? { getImageData: () => ({ data: c.pixels }) }
        : null
    })

    const makeElementHandle = (el: FakeDomElement) => ({
      id: el.id ?? '',
      tagName: el.tag.toUpperCase(),
      get textContent() { return el.textContent },
      set textContent(v: string) { el.textContent = v },
      get value() { return el.value ?? '' },
      set value(v: string) { el.value = v },
      get href() { return el.href ?? '' },
      set href(v: string) { el.href = v },
      closest: (selector: string) => selector === '#ridgetop-testing-root' && el.insideTestingRoot ? {} : null,
      click: () => { el.onClick?.() }
    })

    const documentObj = {
      readyState: 'complete',
      get scrollingElement() {
        return { scrollHeight: self.scrollHeight }
      },
      getElementById(id: string) {
        const canvas = canvases.find(c => c.id === id)
        if (canvas) return makeCanvasHandle(canvas)
        const el = elements.find(e => e.id === id)
        return el ? makeElementHandle(el) : null
      },
      querySelector(selector: string) {
        if (selector.startsWith('#')) return documentObj.getElementById(selector.slice(1))
        const nameMatch = /^\[name=([^\]]+)\]$/.exec(selector)
        if (nameMatch) {
          const el = elements.find(e => e.id === nameMatch[1])
          return el ? makeElementHandle(el) : null
        }
        return null
      },
      querySelectorAll(selector: string) {
        if (selector === 'canvas[id$="-hud"]') {
          return canvases.filter(c => c.id.endsWith('-hud')).map(makeCanvasHandle)
        }
        if (selector === 'button, select') {
          return elements.filter(e => e.tag === 'button' || e.tag === 'select').map(makeElementHandle)
        }
        return []
      }
    }

    const windowObj: Record<string, unknown> = {
      innerWidth: self.innerWidth,
      innerHeight: self.innerHeight,
      document: documentObj,
      localStorage: {
        getItem: (key: string) => rawStorage.get(key) ?? null,
        setItem: (key: string, value: string) => { rawStorage.set(key, String(value)) },
        removeItem: (key: string) => { rawStorage.delete(key) }
      },
      requestAnimationFrame: (cb: (t: number) => void) => {
        cb(16)
        return 1
      },
      URL: {
        createObjectURL: (_blob: unknown) => 'blob:fake-url'
      },
      __ridgetopUi: {
        state: () => state,
        rects: () => rects,
        act: (id: string, action: string, payload: unknown) => {
          actions.push({ id, action, payload })
          return onAct ? onAct(state, id, action, payload) : true
        }
      }
    }
    windowObj.window = windowObj
    windowObj.globalThis = windowObj
    return vm.createContext(windowObj)
  }

  private runPreloadScripts() {
    for (const source of this.preloadScripts.values()) {
      vm.runInContext(source, this.context)
    }
  }

  async evaluate(expression: string): Promise<unknown> {
    return await vm.runInContext(`(${expression})`, this.context)
  }

  async navigate(url: string): Promise<void> {
    this.navigatedUrls.push(url)
    this.context = this.buildContext()
    this.runPreloadScripts()
    this.onNavigate?.(url, this.state, this)
  }

  async reload(): Promise<void> {
    this.context = this.buildContext()
    this.runPreloadScripts()
    this.onReload?.(this.state, this)
  }

  clearErrors(): void {
    this.errors.length = 0
  }

  async addPreloadScript(source: string): Promise<() => Promise<void>> {
    const id = ++this.nextPreloadId
    this.preloadScripts.set(id, source)
    return async () => {
      this.preloadScripts.delete(id)
    }
  }

  async close(): Promise<void> {
    this.preloadScripts.clear()
  }
}

test('isRecord distinguishes plain objects from null, arrays, and primitives', () => {
  assert.equal(isRecord({ a: 1 }), true)
  assert.equal(isRecord({}), true)
  assert.equal(isRecord(null), false)
  assert.equal(isRecord(undefined), false)
  assert.equal(isRecord([1, 2]), false)
  assert.equal(isRecord('str'), false)
  assert.equal(isRecord(42), false)
})

test('until polls until predicate or value matches and fails with last value on timeout', async () => {
  let count = 0
  const hit = await until(() => ++count, v => v >= 3, 'reaches 3', 10, 0)
  assert.equal(hit, 3)

  const exact = await until(() => 'ready', 'ready', 'immediate match', 5, 0)
  assert.equal(exact, 'ready')

  await assert.rejects(
    () => until(() => 'still-loading', 'ready', 'never becomes ready', 3, 0),
    /never becomes ready\. Last value: "still-loading"/
  )
})

test('parseSmokeFilter, matchesSmokeFilter, and runFilteredSuites support CLI flags, aliases, and env', async () => {
  const empty = parseSmokeFilter([], {})
  assert.deepEqual(empty.terms, [])
  assert.equal(matchesSmokeFilter(empty, 'crownshard'), true)

  const fromFlag = parseSmokeFilter(['--filter', 'crownshard,lighthouse'], {})
  assert.deepEqual(fromFlag.terms, ['crownshard', 'lighthouse'])
  assert.equal(matchesSmokeFilter(fromFlag, 'crownshard'), true)
  assert.equal(matchesSmokeFilter(fromFlag, 'lighthouse', 'tidewatch'), true)
  assert.equal(matchesSmokeFilter(fromFlag, 'benchmark'), false)

  const fromEquals = parseSmokeFilter(['--filter=TideWatch', '-f', 'RACING'], {})
  assert.equal(matchesSmokeFilter(fromEquals, 'lighthouse', 'tidewatch'), true)
  assert.equal(matchesSmokeFilter(fromEquals, 'signal-drift', 'racing'), true)
  assert.equal(matchesSmokeFilter(fromEquals, 'starter'), false)

  const fromEnv = parseSmokeFilter([], { RIDGETOP_SMOKE_FILTER: 'beacon' })
  assert.equal(matchesSmokeFilter(fromEnv, 'beacon-run'), true)

  assert.throws(() => parseSmokeFilter(['--filter'], {}), /Missing value after --filter/)

  const ran: string[] = []
  const executed = await runFilteredSuites(fromFlag, [
    { name: 'models', run: async () => { ran.push('models') } },
    { name: 'lighthouse', aliases: ['tidewatch'], run: async () => { ran.push('lighthouse') } },
    { name: 'crownshard', run: async () => { ran.push('crownshard') } }
  ])
  assert.deepEqual(executed, ['lighthouse', 'crownshard'])
  assert.deepEqual(ran, ['lighthouse', 'crownshard'])

  await assert.rejects(
    () => runFilteredSuites(parseSmokeFilter(['--filter', 'nonexistent'], {}), [
      { name: 'crownshard', run: async () => {} }
    ]),
    /No smoke suites matched --filter "nonexistent"\. Available: crownshard/
  )
})

test('namespaceStorageScript isolates localStorage getItem, setItem, and removeItem by prefix', () => {
  const backing = new Map<string, string>()
  const win: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => { backing.set(k, v) },
      removeItem: (k: string) => { backing.delete(k) }
    }
  }
  win.window = win
  const ctx = vm.createContext(win)
  vm.runInContext(namespaceStorageScript('tab-a.'), ctx)

  vm.runInContext("window.localStorage.setItem('save', 'alpha')", ctx)
  assert.equal(backing.get('tab-a.save'), 'alpha')
  assert.equal(backing.get('save'), undefined)
  assert.equal(vm.runInContext("window.localStorage.getItem('save')", ctx), 'alpha')
  vm.runInContext("window.localStorage.removeItem('save')", ctx)
  assert.equal(backing.has('tab-a.save'), false)

  // Must silently no-op on opaque origins where reading window.localStorage throws SecurityError
  const opaqueWin: Record<string, unknown> = {}
  Object.defineProperty(opaqueWin, 'localStorage', {
    get() {
      throw new Error('SecurityError: The operation is insecure.')
    }
  })
  opaqueWin.window = opaqueWin
  assert.doesNotThrow(() => vm.runInContext(namespaceStorageScript('tab-b.'), vm.createContext(opaqueWin)))
})

test('uiState, uiString, uiStringList, uiAct, uiRect, status, and click work over BrowserPage seam', async () => {
  let clicked = false
  const page = new FakeBrowserPage({
    initialState: {
      screen: 'battle',
      gold: 250,
      standings: ['You', 'Scout 1']
    },
    rects: {
      'cs-play': { x: 10, y: 20, width: 120, height: 48 }
    },
    elements: [
      { id: 'stats', tag: 'div', textContent: '420 triangles · WebGL 2' },
      { id: 'run', tag: 'button', textContent: 'Run', onClick: () => { clicked = true } }
    ],
    onAct: (st, id, action, payload) => {
      if (id === 'cs-pause' && action === 'press') st.screen = 'paused'
      if (id === 'course' && action === 'select') st.course = payload
      return true
    }
  })

  assert.equal(await uiState(page, 'screen'), 'battle')
  assert.equal(await uiString(page, 'screen'), 'battle')
  assert.deepEqual(await uiStringList(page, 'standings'), ['You', 'Scout 1'])
  assert.deepEqual(await uiRect(page, 'cs-play'), { x: 10, y: 20, width: 120, height: 48 })
  assert.equal(await uiRect(page, 'missing'), undefined)
  assert.deepEqual(await uiStateRecord(page), { screen: 'battle', gold: 250, standings: ['You', 'Scout 1'] })
  assert.equal(await status(page, 'stats'), '420 triangles · WebGL 2')

  await uiAct(page, 'cs-pause')
  assert.equal(await uiState(page, 'screen'), 'paused')
  await uiAct(page, 'course', 'select', 'summit')
  assert.equal(await uiState(page, 'course'), 'summit')

  await click(page, 'run')
  assert.equal(clicked, true)
  await assert.rejects(() => uiString(page, 'gold'), /Expected string for ui state gold/)
})

test('assertGameViewport reconciles testing-root exclusion, non-uniform pixels, matchingPixels, and noScroll', async () => {
  const fullRect = { top: 0, left: 0, width: 1280, height: 800 }

  // 1. Valid viewport with testing-root button excluded
  const goodPage = new FakeBrowserPage({
    canvases: [
      { id: 'stage', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeNonUniformPixels(32, 32) },
      { id: 'ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeNonUniformPixels(32, 32) }
    ],
    elements: [
      { id: 'rt-pause-btn', tag: 'button', textContent: 'Pause', insideTestingRoot: true }
    ]
  })
  await assertGameViewport(goodPage, { stage: 'stage', uiLayer: 'ui' })

  // 2. Fails when HTML button exists outside #ridgetop-testing-root
  const menuPage = new FakeBrowserPage({
    canvases: [
      { id: 'stage', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeNonUniformPixels(32, 32) },
      { id: 'ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeNonUniformPixels(32, 32) }
    ],
    elements: [
      { id: 'rogue-btn', tag: 'button', textContent: 'Menu', insideTestingRoot: false }
    ]
  })
  await assert.rejects(() => assertGameViewport(menuPage, { stage: 'stage', uiLayer: 'ui' }), /viewport check failed/)

  // 3. Fails when UI canvas is blank (alpha 0) or uniform solid fill
  const blankUiPage = new FakeBrowserPage({
    canvases: [
      { id: 'stage', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeNonUniformPixels(32, 32) },
      { id: 'ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeSolidPixels(32, 32, 0, 0, 0, 0) }
    ]
  })
  await assert.rejects(() => assertGameViewport(blankUiPage, { stage: 'stage', uiLayer: 'ui' }), /viewport check failed/)

  const solidUiPage = new FakeBrowserPage({
    canvases: [
      { id: 'stage', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeNonUniformPixels(32, 32) },
      { id: 'ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeSolidPixels(32, 32, 255, 0, 0, 255) }
    ]
  })
  await assert.rejects(() => assertGameViewport(solidUiPage, { stage: 'stage', uiLayer: 'ui' }), /viewport check failed/)

  // 4. Optional noScroll and matchingPixels toggles
  const diffResScrollPage = new FakeBrowserPage({
    scrollHeight: 900,
    canvases: [
      { id: 'cs-stage', width: 1920, height: 1200, hidden: false, rect: fullRect, pixels: makeNonUniformPixels(32, 32) },
      { id: 'cs-ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: makeNonUniformPixels(32, 32) }
    ]
  })
  await assert.rejects(
    () => assertGameViewport(diffResScrollPage, { stage: 'cs-stage', uiLayer: 'cs-ui', noScroll: true, matchingPixels: true }),
    /viewport check failed/
  )
  await assertGameViewport(diffResScrollPage, { stage: 'cs-stage', uiLayer: 'cs-ui', noScroll: false, matchingPixels: false })
})

test('shared cross-browser suites run end-to-end against a fake BrowserPage adapter', async () => {
  const fullRect = { top: 0, left: 0, width: 1280, height: 800 }
  const painted = makeNonUniformPixels(32, 32)

  // Beacon Run
  const beaconPage = new FakeBrowserPage({
    canvases: [
      { id: 'stage', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: painted },
      { id: 'ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: painted },
      { id: 'sprites', width: 32, height: 32, hidden: false, rect: fullRect, pixels: painted }
    ],
    initialState: { backend: 'WebGL 2', connection: 'Solo practice', screen: 'play' },
    onAct: (st, id) => {
      if (id === 'pause') st.screen = 'pause'
      if (id === 'resume') st.screen = 'play'
      return true
    }
  })
  await verifyBeaconRunCore(beaconPage, 'http://fake.local', 'webgl2', { waitIntervalMs: 0 })
  assert.equal(beaconPage.navigatedUrls[0], 'http://fake.local/?mode=practice&renderer=webgl2')

  // Signal Drift (with garage upgrade + reload persistence)
  let savedPurse = '100 credits'
  const racingPage = new FakeBrowserPage({
    canvases: [
      { id: 'race-stage', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: painted },
      { id: 'race-ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: painted }
    ],
    initialState: {
      backend: 'Canvas 2D',
      screen: 'home',
      overlayTitle: 'Signal Drift',
      purse: '100 credits',
      eventsLocked: [false, true, true, true],
      garagePart: '',
      garageCredits: '100',
      garageTier: 'Tier 0 of 3',
      garageStats: '100→120'
    },
    onAct: (st, id) => {
      if (id === 'race-events') st.overlayTitle = 'Events'
      if (id === 'race-garage') st.screen = 'garage'
      if (id === 'upgrade-armor') st.garagePart = 'Shield'
      if (id === 'garage-install' && st.garageCredits === '100') {
        st.garageCredits = '20'
        st.garageTier = 'Tier 1 of 3 fitted'
        st.garageStats = '120→140'
        savedPurse = '20 credits'
      }
      if (id === 'garage-back') {
        st.screen = 'home'
        st.overlayTitle = 'Events'
      }
      if (id === 'race-start') st.screen = 'racing'
      return true
    },
    onReload: st => {
      st.screen = 'home'
      st.overlayTitle = 'Signal Drift'
      st.purse = savedPurse
    }
  })
  await verifySignalDriftCore(racingPage, 'http://fake.local', 'canvas', {
    storagePrefix: 'fake.racing.',
    checkGarageUpgrade: true,
    waitIntervalMs: 0
  })
  assert.equal(racingPage.preloadScripts.size, 0, 'storage preload cleaned up after Signal Drift suite')

  // Tidewatch / Lighthouse
  const lhPage = new FakeBrowserPage({
    canvases: [
      { id: 'lh-stage', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: painted },
      { id: 'lh-ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: painted }
    ],
    initialState: { screen: 'title', day: 1, coins: 20, fuel: 80, warmth: 100, carry: 0, shipsGuided: 0 },
    onAct: (st, id) => {
      if (id === 'lh-play') st.screen = 'playing'
      return true
    }
  })
  await verifyTidewatchCore(lhPage, 'http://fake.local', 'webgl2', { waitIntervalMs: 0 })

  // Crownshard
  const csPage = new FakeBrowserPage({
    canvases: [
      { id: 'cs-stage', width: 1920, height: 1200, hidden: false, rect: fullRect, pixels: painted },
      { id: 'cs-ui', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: painted }
    ],
    initialState: {
      backend: 'WebGL 2',
      screen: 'title',
      campTab: 'squad',
      gold: 120,
      battlePhase: null,
      battleCols: 0,
      battleRows: 0,
      battleTurn: 0,
      battleAlliesAlive: 0,
      battleEnemiesAlive: 0
    },
    onAct: (st, id) => {
      if (id === 'cs-play' || id === 'cs-camp-battle') st.screen = 'world'
      if (id === 'cs-world-camp') { st.screen = 'camp'; st.campTab = 'squad' }
      if (id === 'cs-tab-armory') st.campTab = 'armory'
      if (id === 'cs-world-deploy') st.screen = 'story'
      if (id === 'cs-story-go') {
        st.screen = 'battle'
        st.battlePhase = 'player'
        st.battleCols = 8
        st.battleRows = 6
        st.battleTurn = 1
        st.battleAlliesAlive = 3
        st.battleEnemiesAlive = 4
      }
      if (id === 'cs-pause') st.screen = 'paused'
      if (id === 'cs-resume') st.screen = 'battle'
      return true
    }
  })
  await verifyCrownshardCore(csPage, 'http://fake.local', 'webgl2', {
    storagePrefix: 'fake.crownshard.',
    waitIntervalMs: 0
  })

  // Starter
  const starterCanvases: FakeDomCanvas[] = [
    { id: 'world', width: 1280, height: 800, hidden: false, rect: fullRect, pixels: painted },
    { id: 'sprites', width: 32, height: 32, hidden: true, rect: fullRect, pixels: painted }
  ]
  const starterPage = new FakeBrowserPage({
    canvases: starterCanvases,
    initialState: { count: '0 / 3' },
    onAct: (_st, id) => {
      if (id === 'hud-view-toggle') {
        starterCanvases[0].hidden = true
        starterCanvases[1].hidden = false
      }
      return true
    }
  })
  await verifyStarterCore(starterPage, 'http://fake.local', 'webgl2', { waitIntervalMs: 0 })

  // Testing mode
  const testingElements: FakeDomElement[] = [
    {
      id: 'rt-pause-btn',
      tag: 'button',
      textContent: 'Pause & Inspect (F9)',
      insideTestingRoot: true,
      onClick: () => {
        testingElements.push({ id: 'ridgetop-testing-drawer', tag: 'div', textContent: 'Drawer' })
      }
    }
  ]
  const testingPage = new FakeBrowserPage({ elements: testingElements })
  await verifyTestingModeCore(testingPage, 'http://fake.local', 'webgl2', { waitIntervalMs: 0 })

  // Benchmark
  const resultEl: FakeDomElement = { id: 'result', tag: 'div', textContent: '' }
  const backendEl: FakeDomElement = { id: 'backend', tag: 'select', textContent: '', value: 'webgl2' }
  const countEl: FakeDomElement = { id: 'count', tag: 'input', textContent: '', value: '144' }
  const workloadEl: FakeDomElement = { id: 'workload', tag: 'select', textContent: '', value: 'static' }
  const downloadEl: FakeDomElement = { id: 'download', tag: 'a', textContent: '', href: 'blob:fake-bench' }
  const benchPage = new FakeBrowserPage({
    elements: [
      resultEl,
      backendEl,
      countEl,
      workloadEl,
      downloadEl,
      {
        id: 'run',
        tag: 'button',
        textContent: 'Run',
        onClick: () => {
          const count = Number(countEl.value ?? '144')
          const isDynamic = workloadEl.value === 'dynamic'
          const bytes = isDynamic ? count * 64 : 0
          resultEl.textContent = `WebGL 2 · 2 draws · ${bytes.toLocaleString('en-US')} bytes uploaded per frame`
          const record = {
            backend: 'WebGL 2',
            workload: workloadEl.value ?? 'static',
            width: 1280,
            height: 800,
            count,
            drawCalls: 2,
            triangles: count * 12,
            instances: count,
            uploadBytes: bytes,
            culledBatches: 0,
            samples: 30,
            cpuMedianMs: 0.4,
            cpuP95Ms: 0.8,
            frameMedianMs: 16.6,
            frameP95Ms: 17.2,
            browser: 'fake'
          }
          void benchPage.evaluate(`URL.createObjectURL({ text: () => Promise.resolve(${JSON.stringify(JSON.stringify(record))}) })`)
        }
      }
    ]
  })
  const outcomes = await verifyBenchmarkCore(
    benchPage,
    'http://fake.local',
    [{ backend: 'webgl2', workload: 'static' }, { backend: 'webgl2', workload: 'dynamic' }],
    { count: 144, captureJson: true, checkDownloadBlob: true, waitIntervalMs: 0 }
  )
  assert.equal(outcomes.length, 2)
  assert.equal(outcomes[0].record?.uploadBytes, 0)
  assert.equal(outcomes[1].record?.uploadBytes, 144 * 64)
})

test('parseBackends and parseBenchmarkRecord validate inputs strictly', () => {
  assert.deepEqual(parseBackends(undefined, ['webgl2', 'canvas']), ['webgl2', 'canvas'])
  assert.deepEqual(parseBackends('webgl2,canvas', ['webgpu']), ['webgl2', 'canvas'])
  assert.throws(() => parseBackends('invalid', ['webgl2']), /Unknown backend: invalid/)
  assert.throws(() => parseBackends('webgpu', ['webgl2'], ['webgl2', 'canvas']), /Unknown backend: webgpu/)

  const parsed = parseBenchmarkRecord({
    backend: 'WebGL 2',
    workload: 'static',
    width: 1280,
    height: 800,
    count: 1024,
    drawCalls: 2,
    triangles: 12288,
    instances: 1024,
    uploadBytes: 0,
    culledBatches: 0,
    samples: 30,
    cpuMedianMs: 1.1,
    cpuP95Ms: 2.0,
    frameMedianMs: 16.6,
    frameP95Ms: 18.0,
    browser: 'Firefox'
  })
  assert.equal(parsed.drawCalls, 2)
  assert.throws(() => parseBenchmarkRecord(null), TypeError)
  assert.throws(() => parseBenchmarkRecord({ backend: 'WebGL 2' }), TypeError)
})

test('startHostedServer handles existingUrl and manages spawned process lifecycle and temp dir cleanup', async () => {
  const existing = await startHostedServer({ existingUrl: 'http://127.0.0.1:4321/' })
  assert.equal(existing.origin, 'http://127.0.0.1:4321')
  assert.equal(existing.port, 4321)
  await existing.stop()

  const inlineServer = `
    import { createServer } from 'node:http';
    const s = createServer((_req, res) => { res.end('ok'); });
    s.listen(0, '127.0.0.1', () => {
      console.log('test server listening on port ' + s.address().port);
    });
  `
  const spawned = await startHostedServer({
    args: ['--input-type=module', '-e', inlineServer],
    tempPrefix: 'ridgetop-harness-test-'
  })
  try {
    assert.ok(spawned.port > 0)
    assert.ok(spawned.tempDir && existsSync(spawned.tempDir))
    const res = await fetch(spawned.origin)
    assert.equal(await res.text(), 'ok')
  } finally {
    await spawned.stop()
  }
  assert.ok(spawned.tempDir && !existsSync(spawned.tempDir), 'temp directory cleaned up on stop()')
})
