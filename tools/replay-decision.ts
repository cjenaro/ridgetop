import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import {
  connectOrStartServer,
  isRecord,
  openTab,
  uiAct,
  uiStateRecord,
  until
} from './browser-driver.ts'

interface ReplayStep {
  readonly step: number
  readonly source: 'ui' | 'adapter' | 'sandbox'
  readonly widgetId?: string
  readonly widgetAction?: string
  readonly choiceLabel: string
  readonly beforeScreen?: string
  readonly afterScreen?: string
}

interface ReplayTrace {
  readonly sessionId: string
  readonly game: string
  readonly viewport: { readonly width: number; readonly height: number }
  readonly steps: readonly ReplayStep[]
}

function parseViewport(raw: string | undefined): { width: number; height: number } {
  if (raw) {
    const match = /^(\d+)[x×](\d+)$/i.exec(raw.trim())
    if (match) {
      return { width: Math.max(320, Number(match[1])), height: Math.max(240, Number(match[2])) }
    }
  }
  return { width: 844, height: 390 }
}

function parseArgs(argv: readonly string[]) {
  let session: string | undefined
  let file: string | undefined
  let untilStep: number | undefined
  let viewportRaw: string | undefined
  let outDir = 'data/decision-replays'
  let gameOverride: string | undefined
  let verifyJev = false
  let headed = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--session' && argv[i + 1]) session = argv[++i]
    else if (arg === '--file' && argv[i + 1]) file = argv[++i]
    else if (arg === '--until' && argv[i + 1]) untilStep = Number(argv[++i])
    else if (arg === '--viewport' && argv[i + 1]) viewportRaw = argv[++i]
    else if (arg === '--out' && argv[i + 1]) outDir = argv[++i]
    else if (arg === '--game' && argv[i + 1]) gameOverride = argv[++i]
    else if (arg === '--verify-jev') verifyJev = true
    else if (arg === '--headed') headed = true
  }
  return { session, file, untilStep, viewportRaw, outDir, gameOverride, verifyJev, headed }
}

async function freePort(): Promise<number> {
  const srv = createServer()
  await new Promise<void>(res => srv.listen(0, '127.0.0.1', () => res()))
  const addr = srv.address()
  const port = typeof addr === 'object' && addr ? addr.port : 9222
  await new Promise<void>(res => srv.close(() => res()))
  return port
}

function findChromeBinary(): string {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter((p): p is string => Boolean(p))
  for (const bin of candidates) {
    if (existsSync(bin)) return bin
  }
  throw new Error('Could not find Chrome/Chromium binary. Set CHROME_PATH or CHROMIUM_DEBUG.')
}

async function ensureChromium(headed: boolean): Promise<() => Promise<void>> {
  const existing = process.env.CHROMIUM_DEBUG ?? 'http://127.0.0.1:9222'
  try {
    const res = await fetch(existing + '/json/version', { signal: AbortSignal.timeout(800) })
    if (res.ok) return async () => {}
  } catch { /* Launch an isolated Chromium instance. */ }

  const port = await freePort()
  const profileDir = await mkdtemp(join(tmpdir(), 'ridgetop-replay-'))
  const bin = findChromeBinary()
  const flags = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    '--enable-unsafe-swiftshader',
    '--window-size=1024,768',
    ...(headed ? [] : ['--headless=new'])
  ]
  const child: ChildProcess = spawn(bin, flags, { stdio: 'ignore' })
  const debugOrigin = `http://127.0.0.1:${port}`
  process.env.CHROMIUM_DEBUG = debugOrigin
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(debugOrigin + '/json/version', { signal: AbortSignal.timeout(500) })
      if (res.ok) break
    } catch { /* Wait for DevTools socket. */ }
    await wait(150)
  }
  return async () => {
    child.kill('SIGTERM')
    await wait(200)
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function loadTrace(opts: ReturnType<typeof parseArgs>): Promise<ReplayTrace> {
  if (opts.file) {
    const parsed: unknown = JSON.parse(await readFile(opts.file, 'utf8'))
    if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
      throw new Error('Replay file must contain a JSON object with a steps array')
    }
    const vp = isRecord(parsed.viewport) && typeof parsed.viewport.width === 'number' && typeof parsed.viewport.height === 'number'
      ? { width: parsed.viewport.width, height: parsed.viewport.height }
      : parseViewport(opts.viewportRaw)
    return {
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : 'custom',
      game: opts.gameOverride ?? (typeof parsed.game === 'string' ? parsed.game : '/crownshard'),
      viewport: opts.viewportRaw ? parseViewport(opts.viewportRaw) : vp,
      steps: parsed.steps
    }
  }

  const logPath = resolve('data/decisions.ndjson')
  const raw = (await readFile(logPath, 'utf8')).trim()
  const lines = raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const outcomes = lines.filter(l => isRecord(l) && l.kind === 'outcome')
  const sessions = Array.from(new Set(outcomes.map(o => typeof o.sessionId === 'string' ? o.sessionId : '').filter(Boolean)))
  const targetSession = opts.session ?? sessions[sessions.length - 1]
  if (!targetSession) throw new Error('No recorded decision sessions found in data/decisions.ndjson')

  const sessionOutcomes = outcomes.filter(o => o.sessionId === targetSession)
  const game = opts.gameOverride ?? (typeof sessionOutcomes[0]?.game === 'string' ? sessionOutcomes[0].game : '/crownshard')
  const recordedVp = sessionOutcomes.find(o => typeof o.viewport === 'string')?.viewport
  const viewport = parseViewport(opts.viewportRaw ?? (typeof recordedVp === 'string' ? recordedVp : undefined))

  const steps: ReplayStep[] = sessionOutcomes
    .filter(o => typeof o.step === 'number' && (opts.untilStep === undefined || o.step <= opts.untilStep))
    .map(o => ({
      step: Number(o.step),
      source: o.source === 'adapter' || o.source === 'ui' ? o.source : 'sandbox',
      widgetId: typeof o.widgetId === 'string' ? o.widgetId : undefined,
      widgetAction: typeof o.widgetAction === 'string' ? o.widgetAction : undefined,
      choiceLabel: typeof o.choiceLabel === 'string' ? o.choiceLabel : String(o.choice ?? ''),
      beforeScreen: typeof o.beforeScreen === 'string' ? o.beforeScreen : undefined,
      afterScreen: typeof o.afterScreen === 'string' ? o.afterScreen : undefined
    }))

  return { sessionId: targetSession, game, viewport, steps }
}

const args = parseArgs(process.argv.slice(2))
const trace = await loadTrace(args)
const stopChromium = await ensureChromium(args.headed)
const server = await connectOrStartServer({
  existingUrl: process.env.RIDGETOP_URL,
  defaultOrigin: 'http://127.0.0.1:3000',
  testing: true
})

let tab: Awaited<ReturnType<typeof openTab>> | undefined
try {
  const url = `${server.origin}${trace.game}${trace.game.includes('?') ? '&' : '?'}testing=0`
  const page = await openTab(url)
  tab = page
  await page.setViewport(trace.viewport.width, trace.viewport.height, trace.viewport.width <= 900)
  await until(
    async () => Boolean(await page.evaluate('Boolean(globalThis.__ridgetopUi?.query)')),
    true,
    'Expected __ridgetopUi to mount',
    120,
    100
  )

  const outFolder = resolve(args.outDir, trace.sessionId)
  await mkdir(outFolder, { recursive: true })

  const results: {
    step: number
    choiceLabel: string
    widgetId?: string
    ok: boolean
    screenBefore: string
    screenAfter: string
    screenshot?: string
  }[] = []
  let failures = 0

  for (const step of trace.steps) {
    const beforeState = await uiStateRecord(tab)
    const screenBefore = typeof beforeState.screen === 'string' ? beforeState.screen : 'unknown'
    let ok = false

    if (step.source === 'ui') {
      const deadline = Date.now() + 1500
      while (!ok && Date.now() < deadline) {
        if (step.widgetId) {
          ok = Boolean(await uiAct(tab, step.widgetId, step.widgetAction ?? 'press'))
        }
        if (!ok && step.choiceLabel) {
          // Fallback match by visible widget label for older logs without widgetId
          const matched = await tab.evaluate(`(() => {
            const ui = globalThis.__ridgetopUi;
            if (!ui?.query || !ui?.act) return false;
            const hit = ui.query({ disabled: false }).find(w => (w.label || '').trim() === ${JSON.stringify(step.choiceLabel)});
            return hit ? Boolean(ui.act(hit.id, (hit.actions && hit.actions[0]) || 'press')) : false;
          })()`)
          ok = Boolean(matched)
        }
        if (!ok) await wait(120)
      }
    } else {
      // Tactical step fallback: wait for player turn or let game advance cleanly
      ok = true
    }

    await wait(160)
    const afterState = await uiStateRecord(tab)
    const screenAfter = typeof afterState.screen === 'string' ? afterState.screen : 'unknown'
    if (!ok) failures++

    const isLast = step === trace.steps[trace.steps.length - 1]
    let screenshotPath: string | undefined
    if (isLast || !ok || screenBefore !== screenAfter) {
      const b64 = await tab.capturePngBase64()
      const fileName = `step-${String(step.step).padStart(3, '0')}-${screenAfter}.png`
      screenshotPath = resolve(outFolder, fileName)
      await writeFile(screenshotPath, Buffer.from(b64, 'base64'))
    }

    results.push({ step: step.step, choiceLabel: step.choiceLabel, widgetId: step.widgetId, ok, screenBefore, screenAfter, screenshot: screenshotPath })
  }

  let jevCheck: unknown = undefined
  if (args.verifyJev) {
    const finalState = await uiStateRecord(tab)
    const widgets = await tab.evaluate(`globalThis.__ridgetopUi?.query?.({ disabled: false })?.slice(0, 6).map((w, i) => ({ id: 'opt_' + i, label: w.label || w.id, description: w.label || w.id })) ?? []`)
    if (Array.isArray(widgets) && widgets.length >= 2) {
      const res = await fetch(`${server.origin}/__testing/decision/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: `replay-${trace.sessionId}`,
          game: trace.game,
          screen: typeof finalState.screen === 'string' ? finalState.screen : 'unknown',
          source: 'ui',
          rubric: 'Verify whether the current game screen looks healthy after replaying steps.',
          state: { ...finalState, lastOutcome: { anomalies: failures ? ['action_failed'] : [], runtimeErrors: tab.errors } },
          options: widgets,
          evidence: [{ id: 'replay_clean', value: failures === 0 && tab.errors.length === 0 }],
          checkForBug: true
        })
      })
      jevCheck = await res.json()
    }
  }

  const summary = {
    sessionId: trace.sessionId,
    game: trace.game,
    viewport: trace.viewport,
    replayedSteps: results.length,
    failures,
    runtimeErrors: tab.errors.slice(),
    ...(jevCheck ? { jevCheck } : {}),
    results
  }
  console.log(JSON.stringify(summary, null, 2))
  if (failures > 0 || tab.errors.length > 0) process.exitCode = 1
} finally {
  await tab?.close().catch(() => {})
  await server.stop().catch(() => {})
  await stopChromium().catch(() => {})
}
