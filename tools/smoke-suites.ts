import assert from 'node:assert/strict'
import type { BrowserPage, SmokeFilter } from './browser-driver.ts'
import {
  assertGameViewport,
  click,
  isRecord,
  matchesSmokeFilter,
  namespaceStorageScript,
  status,
  uiAct,
  uiState,
  uiStateRecord,
  uiString,
  until
} from './browser-driver.ts'

export const RENDERER_NAMES = {
  webgpu: 'WebGPU',
  webgl2: 'WebGL 2',
  canvas: 'Canvas 2D'
} as const

export type SmokeBackend = keyof typeof RENDERER_NAMES

export function isSmokeBackend(value: string): value is SmokeBackend {
  return Object.hasOwn(RENDERER_NAMES, value)
}

export function parseBackends(
  raw: string | undefined,
  defaults: readonly SmokeBackend[],
  allowed: readonly SmokeBackend[] = ['webgpu', 'webgl2', 'canvas']
): SmokeBackend[] {
  if (!raw) return [...defaults]
  return raw.split(',').map(name => {
    const trimmed = name.trim()
    if (!isSmokeBackend(trimmed) || !allowed.includes(trimmed)) {
      throw new Error(`Unknown backend: ${trimmed}`)
    }
    return trimmed
  })
}

export interface BenchmarkRecord {
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

export function parseBenchmarkRecord(value: unknown): BenchmarkRecord {
  if (!isRecord(value)) throw new TypeError('Expected benchmark record object')
  const {
    backend, workload, width, height, count, drawCalls, triangles, instances,
    uploadBytes, culledBatches, samples, cpuMedianMs, cpuP95Ms, frameMedianMs, frameP95Ms, browser
  } = value
  if (typeof backend !== 'string' || typeof workload !== 'string' || typeof browser !== 'string' ||
      typeof width !== 'number' || typeof height !== 'number' || typeof count !== 'number' ||
      typeof drawCalls !== 'number' || typeof triangles !== 'number' || typeof instances !== 'number' ||
      typeof uploadBytes !== 'number' || typeof culledBatches !== 'number' || typeof samples !== 'number' ||
      typeof cpuMedianMs !== 'number' || typeof cpuP95Ms !== 'number' ||
      typeof frameMedianMs !== 'number' || typeof frameP95Ms !== 'number') {
    throw new TypeError('Invalid benchmark record fields')
  }
  return {
    backend, workload, width, height, count, drawCalls, triangles, instances,
    uploadBytes, culledBatches, samples, cpuMedianMs, cpuP95Ms, frameMedianMs, frameP95Ms, browser
  }
}

export interface CoreSuiteOptions {
  noScroll?: boolean
  storagePrefix?: string
  waitIntervalMs?: number
}

export interface SmokeSuiteEntry {
  name: string
  aliases?: readonly string[]
  run: () => Promise<void>
}

export async function runFilteredSuites(
  filter: SmokeFilter,
  suites: readonly SmokeSuiteEntry[]
): Promise<string[]> {
  const matched = suites.filter(suite =>
    matchesSmokeFilter(filter, suite.name, ...(suite.aliases ?? []))
  )
  if (matched.length === 0) {
    const available = suites.map(s => s.name).join(', ')
    throw new Error(`No smoke suites matched --filter "${filter.terms.join(',')}". Available: ${available}`)
  }
  const executed: string[] = []
  for (const suite of matched) {
    await suite.run()
    executed.push(suite.name)
  }
  return executed
}

async function withStorageNamespace<T>(
  page: BrowserPage,
  prefix: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!prefix) return await fn()
  const remove = await page.addPreloadScript(namespaceStorageScript(prefix))
  try {
    return await fn()
  } finally {
    await remove()
  }
}

export async function verifyBeaconRunCore(
  page: BrowserPage,
  origin: string,
  backend: SmokeBackend,
  options: CoreSuiteOptions = {}
): Promise<void> {
  const expectedName = RENDERER_NAMES[backend]
  const interval = options.waitIntervalMs
  page.clearErrors()
  await page.navigate(`${origin}/?mode=practice&renderer=${backend}`)
  await until(() => uiState(page, 'backend'), expectedName, `Beacon Run ${backend} initialized`, 160, interval)
  await until(() => uiState(page, 'connection'), 'Solo practice', `Beacon Run ${backend} practice loaded`, 160, interval)
  await assertGameViewport(page, { stage: 'stage', uiLayer: 'ui', noScroll: options.noScroll })
  const hasSprite = await page.evaluate(`(() => {
    const layer = document.querySelector('#sprites')
    if (!layer) return false
    const pixels = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
    return pixels.some((value, index) => index % 4 === 3 && value === 255)
  })()`)
  assert.equal(hasSprite, true, `Beacon Run ${backend} generated sprite pixels are visible`)
  await uiAct(page, 'pause')
  await until(() => uiState(page, 'screen'), 'pause', `Beacon Run ${backend} pause`, 160, interval)
  await uiAct(page, 'resume')
  await until(() => uiState(page, 'screen'), 'play', `Beacon Run ${backend} resume`, 160, interval)
  assert.deepEqual(page.errors, [], `Beacon Run (${backend}) console/JS errors`)
}

export async function verifySignalDriftCore(
  page: BrowserPage,
  origin: string,
  backend: SmokeBackend,
  options: CoreSuiteOptions & { checkGarageUpgrade?: boolean } = {}
): Promise<void> {
  const expectedName = RENDERER_NAMES[backend]
  const interval = options.waitIntervalMs
  await withStorageNamespace(page, options.storagePrefix, async () => {
    page.clearErrors()
    await page.navigate(`${origin}/racing?renderer=${backend}`)
    await until(() => uiState(page, 'backend'), expectedName, `Signal Drift ${backend} initialized`, 160, interval)

    if (options.checkGarageUpgrade) {
      await uiAct(page, 'race-events')
      await until(() => uiState(page, 'overlayTitle'), 'Events', `Signal Drift ${backend} championship schedule opens`, 160, interval)
      assert.deepEqual(await uiState(page, 'eventsLocked'), [false, true, true, true])
      await uiAct(page, 'race-garage')
      await until(() => uiState(page, 'screen'), 'garage', `Signal Drift ${backend} garage opens`, 160, interval)
      await uiAct(page, 'upgrade-armor')
      assert.equal(await uiState(page, 'garagePart'), 'Shield')
      assert.equal(await uiState(page, 'garageCredits'), '100', 'choosing a part leaves the balance alone')
      assert.match(await uiString(page, 'garageStats'), /100→120/)
      await uiAct(page, 'garage-install')
      assert.equal(await uiState(page, 'garageCredits'), '20')
      assert.equal(await uiState(page, 'garageTier'), 'Tier 1 of 3 fitted')
      assert.match(await uiString(page, 'garageStats'), /120→140/)
      await uiAct(page, 'garage-install')
      assert.equal(await uiState(page, 'garageCredits'), '20', 'an unaffordable tier does not deduct credits')
      await uiAct(page, 'garage-back')
      assert.equal(await uiState(page, 'overlayTitle'), 'Events', 'Back returns to the source screen')
      await page.reload()
      await until(() => page.evaluate(`(() => {
        const s = window.__ridgetopUi?.state?.()
        return Boolean(s && s.screen === 'home' && s.overlayTitle === 'Signal Drift' && s.purse === '20 credits')
      })()`), true, `Signal Drift ${backend} garage purchase saved after reload`, 160, interval)
    } else {
      await uiAct(page, 'race-garage')
      await until(() => uiState(page, 'screen'), 'garage', `Signal Drift ${backend} garage`, 160, interval)
      await uiAct(page, 'garage-back')
    }

    await uiAct(page, 'race-start')
    await until(() => uiState(page, 'screen'), 'racing', `Signal Drift ${backend} race started`, 160, interval)
    await assertGameViewport(page, { stage: 'race-stage', uiLayer: 'race-ui', noScroll: options.noScroll })
    assert.deepEqual(page.errors, [], `Signal Drift (${backend}) console/JS errors`)
  })
}

export async function verifyTidewatchCore(
  page: BrowserPage,
  origin: string,
  backend: SmokeBackend,
  options: CoreSuiteOptions = {}
): Promise<void> {
  const interval = options.waitIntervalMs
  await withStorageNamespace(page, options.storagePrefix, async () => {
    page.clearErrors()
    await page.navigate(`${origin}/lighthouse?renderer=${backend}`)
    await until(() => uiState(page, 'screen'), 'title', `Tidewatch ${backend} title`, 160, interval)
    await assertGameViewport(page, {
      stage: 'lh-stage',
      uiLayer: 'lh-ui',
      matchingPixels: false,
      noScroll: options.noScroll,
      label: `Tidewatch ${backend} title`
    })
    await uiAct(page, 'lh-play')
    await until(() => uiState(page, 'screen'), 'playing', `Tidewatch ${backend} playing`, 160, interval)
    await assertGameViewport(page, { stage: 'lh-stage', uiLayer: 'lh-ui', noScroll: options.noScroll })
    const playState = await uiStateRecord(page)
    for (const metric of ['day', 'coins', 'fuel', 'warmth', 'carry', 'shipsGuided']) {
      const value = playState[metric]
      assert.ok(typeof value === 'number' && Number.isFinite(value), `Tidewatch ${backend} ${metric} must be finite`)
    }
    assert.deepEqual(page.errors, [], `Tidewatch (${backend}) console/JS errors`)
  })
}

export async function verifyCrownshardCore(
  page: BrowserPage,
  origin: string,
  backend: SmokeBackend,
  options: CoreSuiteOptions = {}
): Promise<void> {
  const expectedName = RENDERER_NAMES[backend]
  const interval = options.waitIntervalMs
  await withStorageNamespace(page, options.storagePrefix, async () => {
    page.clearErrors()
    await page.navigate(`${origin}/crownshard?renderer=${backend}`)
    await until(() => uiState(page, 'backend'), expectedName, `Crownshard ${backend} initialized`, 160, interval)
    await until(() => uiState(page, 'screen'), 'title', `Crownshard ${backend} title`, 160, interval)
    await assertGameViewport(page, {
      stage: 'cs-stage',
      uiLayer: 'cs-ui',
      matchingPixels: false,
      noScroll: options.noScroll,
      label: `Crownshard ${backend} title`
    })

    // Enter World Map -> Vanguard Camp -> Armory tab -> back to World Map
    await uiAct(page, 'cs-play')
    await until(() => uiState(page, 'screen'), 'world', `Crownshard ${backend} world map`, 160, interval)
    await uiAct(page, 'cs-world-camp')
    await until(() => uiState(page, 'screen'), 'camp', `Crownshard ${backend} camp`, 160, interval)
    await uiAct(page, 'cs-tab-armory')
    await until(() => uiState(page, 'campTab'), 'armory', `Crownshard ${backend} armory tab`, 160, interval)
    await uiAct(page, 'cs-camp-battle')
    await until(() => uiState(page, 'screen'), 'world', `Crownshard ${backend} return to world map`, 160, interval)

    // Deploy into chapter briefing -> launch tactical battle
    await uiAct(page, 'cs-world-deploy')
    await until(() => uiState(page, 'screen'), 'story', `Crownshard ${backend} story briefing`, 160, interval)
    await uiAct(page, 'cs-story-go')
    await until(() => uiState(page, 'screen'), 'battle', `Crownshard ${backend} battle started`, 160, interval)
    await assertGameViewport(page, {
      stage: 'cs-stage',
      uiLayer: 'cs-ui',
      matchingPixels: false,
      noScroll: options.noScroll,
      label: `Crownshard ${backend} battle`
    })

    const deployState = await uiStateRecord(page)
    if (deployState.battlePhase === 'deploy') {
      assert.ok(typeof deployState.deployTilesCount === 'number' && deployState.deployTilesCount > 0, `Crownshard ${backend} deployTilesCount > 0`)
      await uiAct(page, 'cs-start-battle')
      await until(() => uiState(page, 'battlePhase'), 'player', `Crownshard ${backend} deploy confirmed to player phase`, 160, interval)
    }

    const battleState = await uiStateRecord(page)
    assert.equal(battleState.battlePhase, 'player', `Crownshard ${backend} enters player phase`)
    for (const metric of ['gold', 'battleCols', 'battleRows', 'battleTurn', 'battleAlliesAlive', 'battleEnemiesAlive']) {
      const value = battleState[metric]
      assert.ok(typeof value === 'number' && Number.isFinite(value), `Crownshard ${backend} ${metric} must be finite`)
    }
    assert.ok(typeof battleState.battleCols === 'number' && battleState.battleCols > 0, `Crownshard ${backend} battleCols > 0`)
    assert.ok(typeof battleState.battleRows === 'number' && battleState.battleRows > 0, `Crownshard ${backend} battleRows > 0`)
    assert.ok(typeof battleState.battleAlliesAlive === 'number' && battleState.battleAlliesAlive > 0, `Crownshard ${backend} allies alive > 0`)
    assert.ok(typeof battleState.battleEnemiesAlive === 'number' && battleState.battleEnemiesAlive > 0, `Crownshard ${backend} enemies alive > 0`)

    // Pause and resume battle
    await uiAct(page, 'cs-pause')
    await until(() => uiState(page, 'screen'), 'paused', `Crownshard ${backend} pause`, 160, interval)
    await uiAct(page, 'cs-resume')
    await until(() => uiState(page, 'screen'), 'battle', `Crownshard ${backend} resume`, 160, interval)
    assert.deepEqual(page.errors, [], `Crownshard (${backend}) console/JS errors`)
  })
}

export async function verifyStarterCore(
  page: BrowserPage,
  origin: string,
  backend: SmokeBackend,
  options: CoreSuiteOptions = {}
): Promise<void> {
  const interval = options.waitIntervalMs
  page.clearErrors()
  await page.navigate(`${origin}/starter/?renderer=${backend}`)
  await until(() => uiState(page, 'count'), '0 / 3', `Starter ${backend} initialized`, 160, interval)
  await until(
    () => page.evaluate(`(() => {
      const world = document.querySelector('#world')
      return Boolean(world && !world.hidden && world.width > 0 && world.height > 0)
    })()`),
    true,
    `Starter ${backend} 3D canvas active`,
    160,
    interval
  )
  await uiAct(page, 'hud-view-toggle', 'toggle')
  await until(
    () => page.evaluate(`(() => {
      const layer = document.querySelector('#sprites')
      if (!layer || layer.hidden) return false
      const pixels = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
      return pixels.some((v, i) => i % 4 === 3 && v > 0)
    })()`),
    true,
    `Starter ${backend} 2D sprite view rendered`,
    160,
    interval
  )
  assert.deepEqual(page.errors, [], `Starter (${backend}) console/JS errors`)
}

export async function verifyTestingModeCore(
  page: BrowserPage,
  origin: string,
  backend: SmokeBackend,
  options: CoreSuiteOptions = {}
): Promise<void> {
  const interval = options.waitIntervalMs
  page.clearErrors()
  await page.navigate(`${origin}/starter/?testing=1&renderer=${backend}`)
  await until(
    () => status(page, 'rt-pause-btn').then(v => v?.trim() ?? null),
    'Pause & Inspect (F9)',
    `Testing Mode studio mounted on /starter/?testing=1 (${backend})`,
    160,
    interval
  )
  await click(page, 'rt-pause-btn')
  await until(
    () => page.evaluate("Boolean(document.querySelector('#ridgetop-testing-drawer'))"),
    true,
    `Testing Mode drawer opened on pause (${backend})`,
    160,
    interval
  )
  assert.deepEqual(page.errors, [], `Testing Mode (${backend}) console/JS errors`)
}

export interface BenchmarkRunSpec {
  backend: SmokeBackend
  workload: 'static' | 'dynamic'
}

export interface BenchmarkRunOutcome {
  backend: SmokeBackend
  workload: 'static' | 'dynamic'
  line: string
  record?: BenchmarkRecord
}

export async function verifyBenchmarkCore(
  page: BrowserPage,
  origin: string,
  runs: readonly BenchmarkRunSpec[],
  options: {
    count?: number
    captureJson?: boolean
    checkDownloadBlob?: boolean
    waitIntervalMs?: number
  } = {}
): Promise<BenchmarkRunOutcome[]> {
  const count = options.count ?? 144
  const captureJson = options.captureJson ?? false
  const checkDownloadBlob = options.checkDownloadBlob ?? false
  const interval = options.waitIntervalMs

  const removePreload = captureJson
    ? await page.addPreloadScript(`(() => {
        const orig = URL.createObjectURL.bind(URL)
        window.__ridgetopLastBenchmarkJson = null
        URL.createObjectURL = (blob) => {
          if (blob && typeof blob.text === 'function') {
            blob.text().then(text => { window.__ridgetopLastBenchmarkJson = text })
          }
          return orig(blob)
        }
      })()`)
    : undefined

  try {
    page.clearErrors()
    await page.navigate(`${origin}/benchmark`)
    await until(() => page.evaluate("document.readyState === 'complete'"), true, 'Benchmark page loaded', 160, interval)

    const outcomes: BenchmarkRunOutcome[] = []
    for (const run of runs) {
      await page.evaluate(`(() => {
        window.__ridgetopLastBenchmarkJson = null
        document.querySelector('[name=backend]').value = ${JSON.stringify(run.backend)}
        document.querySelector('[name=count]').value = ${JSON.stringify(String(count))}
        document.querySelector('[name=workload]').value = ${JSON.stringify(run.workload)}
        document.querySelector('#run').click()
      })()`)
      const line = await until(
        () => status(page, 'result'),
        result => typeof result === 'string' && result.length > 0 && result !== 'Running…',
        `Benchmark ${run.backend} ${run.workload}`,
        300,
        interval
      )
      assert.ok(
        typeof line === 'string' && line.startsWith(RENDERER_NAMES[run.backend] + ' ·'),
        `Unexpected benchmark result: ${String(line)}`
      )

      const expectedDynamicBytes = count * 64
      if (run.backend !== 'canvas' && run.workload === 'static') {
        assert.match(line, /· 2 draws · 0 bytes uploaded per frame/)
      }
      if (run.backend !== 'canvas' && run.workload === 'dynamic') {
        assert.match(line, new RegExp(`2 draws · ${expectedDynamicBytes.toLocaleString('en-US')} bytes uploaded per frame`))
      }
      if (checkDownloadBlob) {
        assert.equal(await page.evaluate("document.querySelector('#download')?.href?.startsWith('blob:')"), true)
      }

      let record: BenchmarkRecord | undefined
      if (captureJson) {
        const rawJson = await until(
          () => page.evaluate('window.__ridgetopLastBenchmarkJson'),
          value => typeof value === 'string' && value.length > 0,
          `Benchmark JSON capture ${run.backend} ${run.workload}`,
          50,
          interval
        )
        assert.ok(typeof rawJson === 'string', 'Benchmark JSON payload is a string')
        record = parseBenchmarkRecord(JSON.parse(rawJson))
        if (run.backend !== 'canvas' && run.workload === 'static') {
          assert.equal(record.drawCalls, 2, `${run.backend} static drawCalls === 2`)
          assert.equal(record.uploadBytes, 0, `${run.backend} static uploadBytes === 0`)
        }
        if (run.backend !== 'canvas' && run.workload === 'dynamic') {
          assert.equal(record.drawCalls, 2, `${run.backend} dynamic drawCalls === 2`)
          assert.equal(record.uploadBytes, expectedDynamicBytes, `${run.backend} dynamic uploadBytes === count * 64`)
        }
      }

      outcomes.push({ backend: run.backend, workload: run.workload, line, record })
    }

    assert.deepEqual(page.errors, [], 'Benchmark page console/JS errors')
    return outcomes
  } finally {
    if (removePreload) await removePreload()
  }
}
