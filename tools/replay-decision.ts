import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  connectOrStartServer,
  isRecord,
  openTab,
  uiAct,
  uiStateRecord,
  until
} from './browser-driver.ts'

export interface ReplayStep {
  readonly step: number
  readonly source: 'ui' | 'adapter' | 'sandbox'
  readonly choice?: string
  readonly widgetId?: string
  readonly widgetAction?: string
  readonly choiceLabel: string
  readonly beforeScreen?: string
  readonly afterScreen?: string
}

export interface ReplayTrace {
  readonly sessionId: string
  readonly game: string
  readonly viewport: { readonly width: number; readonly height: number }
  readonly steps: readonly ReplayStep[]
}

export interface ReplayArgs {
  readonly session?: string
  readonly file?: string
  readonly untilStep?: number
  readonly viewportRaw?: string
  readonly outDir: string
  readonly gameOverride?: string
  readonly verifyJev: boolean
  readonly headed: boolean
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

export function parseReplayArgs(argv: readonly string[]): ReplayArgs {
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
    else if (arg === '--until') {
      const raw = argv[++i]
      if (raw === undefined || raw.trim() === '') {
        throw new Error('Invalid --until value: expected a positive integer')
      }
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid --until value "${raw}": expected a positive integer`)
      }
      untilStep = parsed
    }
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
  const cleanup = async () => {
    child.kill('SIGTERM')
    await wait(200)
    await rm(profileDir, { recursive: true, force: true }).catch(() => {})
  }
  let ready = false
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(debugOrigin + '/json/version', { signal: AbortSignal.timeout(500) })
      if (res.ok) {
        ready = true
        break
      }
    } catch { /* Wait for DevTools socket. */ }
    await wait(150)
  }
  if (!ready) {
    await cleanup()
    throw new Error(`Timed out waiting for Chromium DevTools readiness at ${debugOrigin}`)
  }
  return cleanup
}

function normalizeStep(raw: Record<string, unknown>, fallbackStep: number): ReplayStep {
  return {
    step: typeof raw.step === 'number' ? raw.step : fallbackStep,
    source: raw.source === 'adapter' || raw.source === 'ui' ? raw.source : 'sandbox',
    choice: typeof raw.choice === 'string' ? raw.choice : undefined,
    widgetId: typeof raw.widgetId === 'string' ? raw.widgetId : undefined,
    widgetAction: typeof raw.widgetAction === 'string' ? raw.widgetAction : undefined,
    choiceLabel: typeof raw.choiceLabel === 'string' ? raw.choiceLabel : String(raw.choice ?? ''),
    beforeScreen: typeof raw.beforeScreen === 'string' ? raw.beforeScreen : undefined,
    afterScreen: typeof raw.afterScreen === 'string' ? raw.afterScreen : undefined
  }
}

export async function loadTrace(
  opts: ReplayArgs,
  logPath: string = resolve('data/decisions.ndjson')
): Promise<ReplayTrace> {
  if (opts.file) {
    const parsed: unknown = JSON.parse(await readFile(opts.file, 'utf8'))
    if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
      throw new Error('Replay file must contain a JSON object with a steps array')
    }
    const vp = isRecord(parsed.viewport) && typeof parsed.viewport.width === 'number' && typeof parsed.viewport.height === 'number'
      ? { width: parsed.viewport.width, height: parsed.viewport.height }
      : parseViewport(opts.viewportRaw)
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : 'custom'
    const allSteps = parsed.steps
      .filter((entry): entry is Record<string, unknown> => isRecord(entry))
      .map((entry, idx) => normalizeStep(entry, idx + 1))
    const steps = opts.untilStep === undefined
      ? allSteps
      : allSteps.filter(step => step.step <= opts.untilStep!)
    if (steps.length === 0) {
      throw new Error(`Replay file "${opts.file}" has 0 matching steps`)
    }
    return {
      sessionId,
      game: opts.gameOverride ?? (typeof parsed.game === 'string' ? parsed.game : '/crownshard'),
      viewport: opts.viewportRaw ? parseViewport(opts.viewportRaw) : vp,
      steps
    }
  }

  const raw = (await readFile(logPath, 'utf8')).trim()
  const lines: Record<string, unknown>[] = []
  for (const [index, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed)) lines.push(parsed)
    } catch {
      console.warn(`Skipping malformed NDJSON line ${index + 1} in ${logPath}`)
    }
  }
  const outcomes = lines.filter(l => l.kind === 'outcome')
  const sessions = Array.from(new Set(outcomes.map(o => typeof o.sessionId === 'string' ? o.sessionId : '').filter(Boolean)))
  const targetSession = opts.session ?? sessions[sessions.length - 1]
  if (!targetSession) throw new Error('No recorded decision sessions found in data/decisions.ndjson')

  const sessionOutcomes = outcomes.filter(o => o.sessionId === targetSession)
  if (sessionOutcomes.length === 0) {
    throw new Error(`No recorded steps found for session "${targetSession}"`)
  }
  const game = opts.gameOverride ?? (typeof sessionOutcomes[0]?.game === 'string' ? sessionOutcomes[0].game : '/crownshard')
  const recordedVp = sessionOutcomes.find(o => typeof o.viewport === 'string')?.viewport
  const viewport = parseViewport(opts.viewportRaw ?? (typeof recordedVp === 'string' ? recordedVp : undefined))

  const steps: ReplayStep[] = sessionOutcomes
    .filter(o => typeof o.step === 'number' && (opts.untilStep === undefined || o.step <= opts.untilStep))
    .map(o => normalizeStep(o, Number(o.step)))

  if (steps.length === 0) {
    throw new Error(`Session "${targetSession}" has 0 steps matching filter`)
  }

  return { sessionId: targetSession, game, viewport, steps }
}

async function main(): Promise<void> {
  const args = parseReplayArgs(process.argv.slice(2))
  const trace = await loadTrace(args)

  let stopChromium: (() => Promise<void>) | undefined
  let server: Awaited<ReturnType<typeof connectOrStartServer>> | undefined
  let tab: Awaited<ReturnType<typeof openTab>> | undefined

  try {
    stopChromium = await ensureChromium(args.headed)
    server = await connectOrStartServer({
      existingUrl: process.env.RIDGETOP_URL,
      defaultOrigin: 'http://127.0.0.1:3000',
      testing: true
    })

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
      expectedAfterScreen?: string
      error?: string
      screenshot?: string
    }[] = []
    let failures = 0

    for (const step of trace.steps) {
      const beforeState = await uiStateRecord(tab)
      const screenBefore = typeof beforeState.screen === 'string' ? beforeState.screen : 'unknown'
      let ok = false
      let stepError: string | undefined

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
        if (!ok) {
          stepError = `UI action failed for "${step.widgetId ?? step.choiceLabel}"`
        }
      } else {
        const deadline = Date.now() + 1500
        let lastReason = 'adapter_failed'
        while (!ok && Date.now() < deadline) {
          const outcome = await tab.evaluate(`(async () => {
            const testing = globalThis.__ridgetopTesting;
            const runtimeState = globalThis[Symbol.for('ridgetop.testing.runtime')];
            const agents = typeof testing?.getDecisionAgents === 'function'
              ? testing.getDecisionAgents()
              : Array.from(runtimeState?.decisionAgents ?? []);
            const agent = agents[agents.length - 1];
            if (!agent || typeof agent.observe !== 'function' || typeof agent.act !== 'function') {
              return { ok: false, reason: 'no_decision_agent_registered' };
            }
            const obs = agent.observe();
            if (!obs || !obs.ready) {
              return { ok: false, reason: 'decision_agent_not_ready' };
            }
            let optionId = ${JSON.stringify(step.choice ?? '')};
            if (!optionId && ${JSON.stringify(step.choiceLabel)}) {
              const targetLabel = ${JSON.stringify(step.choiceLabel.trim())};
              const matched = Array.isArray(obs.options)
                ? obs.options.find(o => o && typeof o.label === 'string' && o.label.trim() === targetLabel)
                : undefined;
              if (matched && typeof matched.id === 'string') optionId = matched.id;
            }
            if (!optionId) {
              return { ok: false, reason: 'missing_adapter_choice' };
            }
            const acted = await agent.act(optionId);
            return { ok: Boolean(acted), reason: acted ? '' : 'agent_act_returned_falsy' };
          })()`)
          if (isRecord(outcome) && outcome.ok === true) {
            ok = true
          } else {
            lastReason = isRecord(outcome) && typeof outcome.reason === 'string' && outcome.reason
              ? outcome.reason
              : 'adapter_failed'
            await wait(120)
          }
        }
        if (!ok) {
          stepError = `Decision agent replay failed (${lastReason}) for choice "${step.choice ?? step.choiceLabel}"`
          console.error(`Step ${step.step}: ${stepError}`)
        }
      }

      await wait(160)
      const afterState = await uiStateRecord(tab)
      const screenAfter = typeof afterState.screen === 'string' ? afterState.screen : 'unknown'

      if (step.afterScreen && screenAfter !== step.afterScreen) {
        ok = false
        const mismatchMsg = `Screen mismatch: expected "${step.afterScreen}", got "${screenAfter}"`
        stepError = stepError ? `${stepError}; ${mismatchMsg}` : mismatchMsg
        console.error(`Step ${step.step}: ${mismatchMsg}`)
      }

      if (!ok) failures++

      const isLast = step === trace.steps[trace.steps.length - 1]
      let screenshotPath: string | undefined
      if (isLast || !ok || screenBefore !== screenAfter) {
        const b64 = await tab.capturePngBase64()
        const fileName = `step-${String(step.step).padStart(3, '0')}-${screenAfter}.png`
        screenshotPath = resolve(outFolder, fileName)
        await writeFile(screenshotPath, Buffer.from(b64, 'base64'))
      }

      results.push({
        step: step.step,
        choiceLabel: step.choiceLabel,
        widgetId: step.widgetId,
        ok,
        screenBefore,
        screenAfter,
        ...(step.afterScreen ? { expectedAfterScreen: step.afterScreen } : {}),
        ...(stepError ? { error: stepError } : {}),
        screenshot: screenshotPath
      })
    }

    let jevCheck: unknown = undefined
    let jevFailed = false
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
        if (!res.ok) {
          jevFailed = true
          const bodyText = await res.text().catch(() => '')
          jevCheck = { ok: false, status: res.status, error: bodyText || res.statusText }
          console.error(`--verify-jev request failed with HTTP ${res.status}: ${bodyText || res.statusText}`)
        } else {
          jevCheck = await res.json()
          if (isRecord(jevCheck) && jevCheck.bugSuspected === true) {
            jevFailed = true
          }
        }
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
    if (failures > 0 || tab.errors.length > 0 || jevFailed) process.exitCode = 1
  } finally {
    await tab?.close().catch(() => {})
    await server?.stop().catch(() => {})
    await stopChromium?.().catch(() => {})
  }
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  await main()
}
