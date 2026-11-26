import assert from 'node:assert/strict'
import type { FirefoxSession, HostedServer } from './browser-driver.ts'
import {
  isRecord,
  launchFirefoxSession,
  parseSmokeFilter,
  startHostedServer
} from './browser-driver.ts'
import type { BenchmarkRecord, BenchmarkRunSpec, SmokeSuiteEntry } from './smoke-suites.ts'
import {
  parseBackends,
  runFilteredSuites,
  verifyBeaconRunCore,
  verifyBenchmarkCore,
  verifyCrownshardCore,
  verifySignalDriftCore,
  verifyStarterCore,
  verifyTestingModeCore,
  verifyTidewatchCore
} from './smoke-suites.ts'

const filter = parseSmokeFilter()
const backends = parseBackends(process.env.RIDGETOP_FIREFOX_BACKENDS, ['webgl2', 'canvas'], ['webgl2', 'canvas'])
const benchmarkCount = Number(process.env.RIDGETOP_BENCHMARK_COUNT ?? '1024')
const runTag = 'ff-' + Date.now().toString(36)

let server: HostedServer | undefined
let firefox: FirefoxSession | undefined
const benchmarkResults: BenchmarkRecord[] = []

try {
  server = await startHostedServer({
    existingUrl: process.env.RIDGETOP_URL,
    testing: true,
    tempPrefix: 'ridgetop-ff-server-'
  })
  firefox = await launchFirefoxSession()
  const { page } = firefox
  const origin = server.origin

  // Inspect Firefox capabilities & GPU renderer info
  await page.navigate(`${origin}/benchmark`)
  const gpuInfo = await page.evaluate(`(() => {
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
  assert.ok(isRecord(gpuInfo) && gpuInfo.webgl2, 'Firefox WebGL 2 context available')

  const suites: SmokeSuiteEntry[] = [
    {
      name: 'beacon-run',
      aliases: ['beacon'],
      async run() {
        for (const backend of backends) {
          await verifyBeaconRunCore(page, origin, backend, { noScroll: false })
          console.log(`PASS Firefox ${backend}: Beacon Run (/)`)
        }
      }
    },
    {
      name: 'signal-drift',
      aliases: ['racing'],
      async run() {
        for (const backend of backends) {
          await verifySignalDriftCore(page, origin, backend, {
            noScroll: false,
            storagePrefix: `${runTag}.racing.${backend}.`,
            checkGarageUpgrade: true
          })
          console.log(`PASS Firefox ${backend}: Signal Drift (/racing)`)
        }
      }
    },
    {
      name: 'lighthouse',
      aliases: ['tidewatch'],
      async run() {
        for (const backend of backends) {
          await verifyTidewatchCore(page, origin, backend, {
            noScroll: false,
            storagePrefix: `${runTag}.lighthouse.${backend}.`
          })
          console.log(`PASS Firefox ${backend}: Tidewatch (/lighthouse)`)
        }
      }
    },
    {
      name: 'crownshard',
      async run() {
        for (const backend of backends) {
          await verifyCrownshardCore(page, origin, backend, {
            noScroll: false,
            storagePrefix: `${runTag}.crownshard.${backend}.`
          })
          console.log(`PASS Firefox ${backend}: Crownshard (/crownshard)`)
        }
      }
    },
    {
      name: 'starter',
      async run() {
        for (const backend of backends) {
          await verifyStarterCore(page, origin, backend)
          console.log(`PASS Firefox ${backend}: Starter (/starter/)`)
        }
      }
    },
    {
      name: 'testing',
      aliases: ['testing-mode'],
      async run() {
        await verifyTestingModeCore(page, origin, 'webgl2')
        console.log('PASS Firefox webgl2: Testing Mode (/starter/?testing=1)')
      }
    },
    {
      name: 'benchmark',
      async run() {
        const runs: BenchmarkRunSpec[] = backends.flatMap(backend => [
          { backend, workload: 'static' },
          { backend, workload: 'dynamic' }
        ])
        const outcomes = await verifyBenchmarkCore(page, origin, runs, {
          count: benchmarkCount,
          captureJson: true
        })
        for (const outcome of outcomes) {
          if (outcome.record) benchmarkResults.push(outcome.record)
          console.log(`BENCH Firefox ${outcome.backend} ${outcome.workload}: ${outcome.line}`)
        }
      }
    }
  ]

  await runFilteredSuites(filter, suites)

  if (benchmarkResults.length > 0) {
    console.log('FIREFOX_BENCHMARK_JSON=' + JSON.stringify(benchmarkResults, null, 2))
  }
  console.log('All Firefox headless smoke & benchmark checks passed.')
} finally {
  if (firefox) await firefox.stop()
  if (server) await server.stop()
}
