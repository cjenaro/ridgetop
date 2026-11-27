import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DecisionDetailed, DecisionUsage } from './types.ts'
import type { DecisionProviderName } from './decision-providers.ts'
import { Buffer } from 'node:buffer'
import { appendFile, lstat, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createDecisionApi, resolveDecisionEnv } from './decision-api.ts'
import { ridgetopBrowserSpecifiers, sendJson, sendText } from './host.ts'

export type DecisionAgentProvider = DecisionProviderName | 'local'

interface DecisionAgentOptionPayload {
  readonly id: string
  readonly label?: string
  readonly description?: string
  readonly heuristicScore?: number
}

interface DecisionAgentEvidencePayload {
  readonly id: string
  readonly value: unknown
  readonly label?: string
}

export interface DecisionAgentServerResponse {
  readonly ok: boolean
  readonly error?: string
  readonly provider?: string
  readonly model?: string
  readonly choice?: string
  readonly confidence?: number
  readonly probabilities?: Readonly<Record<string, number>>
  readonly evidence?: readonly string[]
  readonly evidenceProbabilities?: Readonly<Record<string, number>>
  readonly bugProbability?: number
  readonly bugSuspected?: boolean
  readonly usage?: DecisionUsage
  readonly latencyMs?: number
  readonly cached?: boolean
  readonly session?: {
    readonly requests: number
    readonly cacheHits: number
    readonly totalInputTokens: number
    readonly totalOutputTokens: number
  }
}

const MAX_BODY_BYTES = 48_000
const MAX_SCREENSHOT_BODY_BYTES = 2_500_000
const MAX_CACHE_ENTRIES = 64
const MAX_LOG_LINES = 2000
const MAX_SESSION_SCREENSHOTS = 200
const DEFAULT_MAX_SESSION_REQUESTS = 500
const SHOT_SESSION_RE = /^[a-zA-Z0-9_-]{1,48}$/
const SHOT_FILENAME_RE = /^[a-zA-Z0-9_-]+\.(png|jpg)$/

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super('Decision request body exceeds ' + maxBytes + ' bytes')
    this.name = 'PayloadTooLargeError'
  }
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]' || lower === '::1'
}

function isAllowedOrigin(origin: string, hostHeader: string | undefined): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (!isLoopbackHost(parsed.hostname)) return false
  if (hostHeader) {
    if (parsed.host.toLowerCase() === hostHeader.toLowerCase()) return true
    try {
      const hostUrl = new URL('http://' + hostHeader)
      if (isLoopbackHost(hostUrl.hostname) && parsed.port === hostUrl.port) return true
    } catch {
      return false
    }
    return false
  }
  return true
}

function resolveMaxSessionRequests(): number {
  const raw = process.env.RIDGETOP_DECISION_MAX_SESSION_REQUESTS
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw)
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  }
  return DEFAULT_MAX_SESSION_REQUESTS
}

async function pruneSessionScreenshots(targetDir: string): Promise<void> {
  try {
    const entries = await readdir(targetDir)
    if (entries.length <= MAX_SESSION_SCREENSHOTS) return
    const stats = await Promise.all(
      entries.map(async name => {
        const full = resolve(targetDir, name)
        try {
          const info = await lstat(full)
          return info.isFile() ? { full, mtimeMs: info.mtimeMs } : null
        } catch {
          return null
        }
      })
    )
    const files = stats.filter((item): item is { full: string; mtimeMs: number } => item !== null)
    if (files.length <= MAX_SESSION_SCREENSHOTS) return
    files.sort((a, b) => a.mtimeMs - b.mtimeMs)
    const excess = files.length - MAX_SESSION_SCREENSHOTS
    for (let i = 0; i < excess; i++) {
      await unlink(files[i].full).catch(() => {})
    }
  } catch {
    // Best-effort pruning.
  }
}

function sanitizeSegment(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)
  return cleaned || fallback
}

function renderPopoutAgentHtml(): string {
  const importMap = JSON.stringify({ imports: ridgetopBrowserSpecifiers })
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ridgetop Decision Agent</title>
  <script type="importmap">${importMap}</script>
  <link rel="stylesheet" href="/framework/testing-overlay.css" />
</head>
<body class="rt-popout-body">
  <div id="rt-popout-root" class="rt-popout-root"></div>
  <script type="module" src="/framework/testing-agent-popout.js"></script>
</body>
</html>
`
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket?.remoteAddress ?? ''
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.byteLength
    if (total > maxBytes) throw new PayloadTooLargeError(maxBytes)
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function parseDecisionProviderName(raw: string | undefined): DecisionProviderName | undefined {
  if (raw === 'http' || raw === 'openai' || raw === 'clef' || raw === 'jev' || raw === 'typesafe') {
    return raw
  }
  return undefined
}

function decideWithLocalHeuristic(
  options: readonly DecisionAgentOptionPayload[],
  evidence: readonly DecisionAgentEvidencePayload[],
  state?: unknown
): DecisionDetailed<string> {
  const scores = options.map(opt => (typeof opt.heuristicScore === 'number' && Number.isFinite(opt.heuristicScore) ? opt.heuristicScore : 0))
  let maxScore = -Infinity
  let minScore = Infinity
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > maxScore) maxScore = scores[i]
    if (scores[i] < minScore) minScore = scores[i]
  }
  const rawSpread = maxScore - minScore
  const spread = Number.isFinite(rawSpread) ? Math.max(25, rawSpread) : 25
  const temp = spread / 3
  const exps = scores.map(s => {
    const v = Math.exp((s - maxScore) / temp)
    return Number.isFinite(v) ? v : 0
  })
  const sum = exps.reduce((acc, v) => acc + v, 0) || 1
  const probabilities: Record<string, number> = {}
  let bestIdx = 0
  let bestProb = -1
  for (let i = 0; i < options.length; i++) {
    const p = Math.round((exps[i] / sum) * 1000) / 1000
    probabilities[options[i].id] = p
    if (p > bestProb) {
      bestProb = p
      bestIdx = i
    }
  }
  const evidenceProbabilities: Record<string, number> = {}
  const cited: string[] = []
  for (const item of evidence) {
    const prob = typeof item.value === 'boolean'
      ? (item.value ? 0.85 : 0.15)
      : typeof item.value === 'number'
        ? (item.value > 0 ? 0.78 : 0.22)
        : (item.value ? 0.65 : 0.2)
    evidenceProbabilities[item.id] = prob
    if (prob > 0.5) cited.push(item.id)
  }
  const stateObj = isRecord(state) ? state : undefined
  const lastOutcome = stateObj && isRecord(stateObj.lastOutcome) ? stateObj.lastOutcome : undefined
  const hadAnomaly = Boolean(
    lastOutcome &&
    ((Array.isArray(lastOutcome.anomalies) && lastOutcome.anomalies.length > 0) ||
      (Array.isArray(lastOutcome.runtimeErrors) && lastOutcome.runtimeErrors.length > 0))
  )
  const bugProbability = hadAnomaly ? 0.85 : 0.06
  return {
    label: options[bestIdx].id,
    evidence: cited,
    confidence: Math.round(bestProb * 100) / 100,
    probabilities,
    evidenceProbabilities,
    bugProbability,
    bugSuspected: bugProbability > 0.5,
    model: 'local-heuristic-softmax',
    latencyMs: 1,
    cached: false
  }
}

/**
 * Mount loopback-only `/__testing/decision/*` endpoints for the Ridgetop Decision Agent UI.
 * Keeps API keys on the server (loaded from `process.env` or `.env`) and supports
 * Typesafe JEV, Cloudflare Clef, OpenAI Decisions, custom HTTP, and local heuristic fallback.
 */
export function createDecisionAgentHandler(root: URL) {
  const session = { requests: 0, cacheHits: 0, totalInputTokens: 0, totalOutputTokens: 0 }
  const cache = new Map<string, { provider: string; model?: string; promise: Promise<DecisionDetailed<string>> }>()
  const logPath = fileURLToPath(new URL('data/decisions.ndjson', root))
  const shotsRoot = resolve(fileURLToPath(new URL('data/decision-shots', root)))
  let logWriteCount = 0
  let logQueue: Promise<void> = Promise.resolve()

  function appendDecisionLog(entry: Record<string, unknown>): Promise<void> {
    const run = async () => {
      try {
        await mkdir(dirname(logPath), { recursive: true })
        const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
        await appendFile(logPath, line, 'utf8')
        logWriteCount++
        if (logWriteCount % 100 === 0) {
          const all = (await readFile(logPath, 'utf8')).trim().split('\n')
          if (all.length > MAX_LOG_LINES) {
            await writeFile(logPath, all.slice(-MAX_LOG_LINES).join('\n') + '\n', 'utf8')
          }
        }
      } catch {
        // Never break live gameplay decisions if disk logging fails.
      }
    }
    logQueue = logQueue.then(run, run)
    return logQueue
  }

  async function readDecisionLog(limit = 200): Promise<Record<string, unknown>[]> {
    try {
      const raw = (await readFile(logPath, 'utf8')).trim()
      if (!raw) return []
      const lines = raw.split('\n')
      const slice = lines.slice(-Math.max(1, Math.min(limit, MAX_LOG_LINES)))
      const out: Record<string, unknown>[] = []
      for (const line of slice) {
        try {
          const parsed: unknown = JSON.parse(line)
          if (isRecord(parsed)) out.push(parsed)
        } catch { /* Skip malformed line. */ }
      }
      return out
    } catch {
      return []
    }
  }

  return async function handleDecisionAgent(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string
  ): Promise<boolean> {
    if (!pathname.startsWith('/__testing/decision/') && pathname !== '/__testing/agent') return false
    if (!isLoopback(req)) {
      sendText(res, 403, 'Decision Agent endpoints are restricted to loopback connections')
      return true
    }

    if (pathname.startsWith('/__testing/decision/')) {
      const secFetchSite = typeof req.headers['sec-fetch-site'] === 'string'
        ? req.headers['sec-fetch-site'].trim().toLowerCase()
        : ''
      if (secFetchSite === 'cross-site') {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'Cross-site requests are forbidden' }))
        return true
      }
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : ''
      if (origin && !isAllowedOrigin(origin, typeof req.headers.host === 'string' ? req.headers.host : undefined)) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'Cross-origin requests are forbidden' }))
        return true
      }
      if (req.method === 'POST') {
        const contentType = typeof req.headers['content-type'] === 'string'
          ? req.headers['content-type'].trim().toLowerCase()
          : ''
        if (!contentType.startsWith('application/json')) {
          res.writeHead(415, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: false, error: 'Content-Type must be application/json' }))
          return true
        }
      }
    }

    if (pathname === '/__testing/agent' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        .end(renderPopoutAgentHtml())
      return true
    }

    if (pathname === '/__testing/decision/screenshot' && req.method === 'POST') {
      try {
        const parsed = await readJsonBody(req, MAX_SCREENSHOT_BODY_BYTES)
        if (!isRecord(parsed) || typeof parsed.dataUrl !== 'string') {
          throw new Error('Expected JSON with dataUrl')
        }
        const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(parsed.dataUrl)
        if (!match) throw new Error('Expected base64 JPEG or PNG dataUrl')
        const ext = match[1] === 'png' ? 'png' : 'jpg'
        const bytes = Buffer.from(match[2], 'base64')
        const sessionDir = sanitizeSegment(parsed.sessionId, 'session')
        const stepNum = typeof parsed.step === 'number' && Number.isFinite(parsed.step)
          ? String(Math.max(0, Math.floor(parsed.step))).padStart(3, '0')
          : String(Date.now())
        const screenTag = sanitizeSegment(parsed.screen, 'screen')
        const filename = `step-${stepNum}-${screenTag}.${ext}`
        const targetDir = resolve(shotsRoot, sessionDir)
        const targetPath = resolve(targetDir, filename)
        if (!targetPath.startsWith(shotsRoot + sep)) throw new Error('Invalid screenshot path')
        await mkdir(targetDir, { recursive: true })
        await writeFile(targetPath, bytes)
        await pruneSessionScreenshots(targetDir)
        sendJson(res, {
          ok: true,
          file: `data/decision-shots/${sessionDir}/${filename}`,
          url: `/__testing/decision/shot/${sessionDir}/${filename}`,
          bytes: bytes.byteLength
        })
      } catch (error) {
        const status = error instanceof PayloadTooLargeError ? 413 : 400
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
      return true
    }

    if (pathname.startsWith('/__testing/decision/shot/') && req.method === 'GET') {
      const rel = pathname.slice('/__testing/decision/shot/'.length)
      const parts = rel.split('/')
      if (parts.length !== 2 || !SHOT_SESSION_RE.test(parts[0]) || !SHOT_FILENAME_RE.test(parts[1])) {
        sendText(res, 400, 'Invalid screenshot path')
        return true
      }
      const sessionPath = resolve(shotsRoot, parts[0])
      const targetPath = resolve(sessionPath, parts[1])
      if (!sessionPath.startsWith(shotsRoot + sep) || !targetPath.startsWith(sessionPath + sep)) {
        sendText(res, 403, 'Forbidden')
        return true
      }
      try {
        const dirInfo = await lstat(sessionPath)
        const fileInfo = await lstat(targetPath)
        if (!dirInfo.isDirectory() || !fileInfo.isFile()) {
          sendText(res, 403, 'Forbidden')
          return true
        }
        const bytes = await readFile(targetPath)
        const mime = parts[1].endsWith('.png') ? 'image/png' : 'image/jpeg'
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }).end(bytes)
      } catch {
        sendText(res, 404, 'Screenshot not found')
      }
      return true
    }

    if (pathname === '/__testing/decision/log' && req.method === 'GET') {
      const entries = await readDecisionLog(500)
      const decisions = entries.filter(e => e.kind === 'decision')
      const outcomes = entries.filter(e => e.kind === 'outcome')
      const anomalies = entries.filter(e =>
        e.kind === 'anomaly' ||
        e.bugSuspected === true ||
        (Array.isArray(e.anomalies) && e.anomalies.length > 0)
      )
      const jevSuspicions = decisions.filter(d => d.bugSuspected === true)
      const screens = new Set<string>()
      const choices = new Set<string>()
      for (const d of decisions) {
        if (typeof d.screen === 'string' && d.screen) screens.add(d.screen)
        if (typeof d.choiceLabel === 'string' && d.choiceLabel) choices.add(d.choiceLabel)
      }
      sendJson(res, {
        ok: true,
        logPath: 'data/decisions.ndjson',
        summary: {
          totalDecisions: decisions.length,
          totalOutcomes: outcomes.length,
          uniqueScreens: Array.from(screens),
          uniqueActionsCount: choices.size,
          anomalyCount: anomalies.length,
          jevBugSuspicions: jevSuspicions.length
        },
        flaggedForVerification: anomalies.slice(-50),
        entries
      })
      return true
    }

    if (pathname === '/__testing/decision/outcome' && req.method === 'POST') {
      try {
        const parsed = await readJsonBody(req)
        if (!isRecord(parsed)) throw new Error('Expected JSON object')
        await appendDecisionLog({ kind: 'outcome', ...parsed })
        sendJson(res, { ok: true })
      } catch (error) {
        const status = error instanceof PayloadTooLargeError ? 413 : 400
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      }
      return true
    }

    if (pathname === '/__testing/decision/status' && req.method === 'GET') {
      const resolved = resolveDecisionEnv(process.env, root)
      const hasAnyRemote = Object.values(resolved.configuredProviders).some(Boolean)
      sendJson(res, {
        ok: true,
        defaultProvider: hasAnyRemote ? resolved.provider : 'local',
        configuredProviders: { ...resolved.configuredProviders, local: true },
        defaultModels: {
          jev: resolved.provider === 'jev' && resolved.model ? resolved.model : 'jev-latest',
          typesafe: resolved.provider === 'typesafe' && resolved.model ? resolved.model : 'jev-latest',
          clef: resolved.provider === 'clef' && resolved.model ? resolved.model : 'clef-flash',
          openai: resolved.provider === 'openai' && resolved.model ? resolved.model : 'gpt-6-luna',
          http: resolved.provider === 'http' && resolved.model ? resolved.model : '',
          local: 'local-heuristic-softmax'
        },
        session: { ...session }
      })
      return true
    }

    if (pathname === '/__testing/decision/decide' && req.method === 'POST') {
      let body: Record<string, unknown>
      try {
        const parsed = await readJsonBody(req)
        if (!isRecord(parsed)) throw new Error('Expected JSON object')
        body = parsed
      } catch (error) {
        const status = error instanceof PayloadTooLargeError ? 413 : 400
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
        return true
      }

      const rawOptions = Array.isArray(body.options) ? body.options : []
      const options: DecisionAgentOptionPayload[] = []
      const seenOptionIds = new Set<string>()
      for (const item of rawOptions) {
        if (!isRecord(item) || typeof item.id !== 'string' || !item.id || seenOptionIds.has(item.id)) continue
        seenOptionIds.add(item.id)
        options.push({
          id: item.id,
          label: typeof item.label === 'string' ? item.label : undefined,
          description: typeof item.description === 'string' ? item.description : undefined,
          heuristicScore: typeof item.heuristicScore === 'number' ? item.heuristicScore : undefined
        })
      }
      if (!options.length) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: false, error: 'At least one candidate option is required' }))
        return true
      }
      const rawEvidence = Array.isArray(body.evidence) ? body.evidence : []
      const evidence: DecisionAgentEvidencePayload[] = []
      for (const item of rawEvidence) {
        if (!isRecord(item) || typeof item.id !== 'string' || !item.id) continue
        evidence.push({ id: item.id, value: item.value })
      }
      const rubric = typeof body.rubric === 'string' && body.rubric.trim()
        ? body.rubric.trim()
        : 'Select the best action for the current game state.'

      const metaSessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      const metaScreen = typeof body.screen === 'string' ? body.screen : undefined
      const metaSource = typeof body.source === 'string' ? body.source : undefined
      const metaGame = typeof body.game === 'string' ? body.game : undefined
      const labelFor = (id: string) => options.find(o => o.id === id)?.label ?? id

      // Single legal option: short-circuit cleanly without spending an API call.
      if (options.length === 1) {
        const only = options[0]
        const payload: DecisionAgentServerResponse = {
          ok: true,
          provider: 'single-option',
          model: 'deterministic',
          choice: only.id,
          confidence: 1,
          probabilities: { [only.id]: 1 },
          evidence: [],
          evidenceProbabilities: {},
          latencyMs: 0,
          cached: false,
          session: { ...session }
        }
        await appendDecisionLog({
          kind: 'decision', sessionId: metaSessionId, game: metaGame, screen: metaScreen, source: metaSource,
          provider: payload.provider, model: payload.model, choice: only.id, choiceLabel: labelFor(only.id),
          confidence: 1, probabilities: payload.probabilities, optionsCount: 1, latencyMs: 0, cached: false
        })
        sendJson(res, payload)
        return true
      }

      const requestedRaw = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : undefined
      const requestedRemote = parseDecisionProviderName(requestedRaw)
      if (requestedRaw && requestedRaw !== 'local' && !requestedRemote) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({
          ok: false,
          error: `Unknown decision provider "${requestedRaw}". Choose local, http, openai, clef, jev, or typesafe`
        }))
        return true
      }
      const defaultResolved = resolveDecisionEnv(process.env, root)
      const resolved = requestedRemote ? resolveDecisionEnv(process.env, root, requestedRemote) : defaultResolved
      const provider: DecisionAgentProvider = requestedRaw === 'local'
        ? 'local'
        : requestedRemote ?? (
            Object.values(resolved.configuredProviders).some(Boolean) ? resolved.provider : 'local'
          )

      if (provider === 'local') {
        const result = decideWithLocalHeuristic(options, evidence, body.state)
        const payload: DecisionAgentServerResponse = {
          ok: true,
          provider: 'local',
          model: result.model,
          choice: result.label,
          confidence: result.confidence,
          probabilities: result.probabilities,
          evidence: result.evidence,
          evidenceProbabilities: result.evidenceProbabilities,
          bugProbability: result.bugProbability,
          bugSuspected: result.bugSuspected,
          latencyMs: result.latencyMs,
          cached: false,
          session: { ...session }
        }
        await appendDecisionLog({
          kind: 'decision', sessionId: metaSessionId, game: metaGame, screen: metaScreen, source: metaSource,
          provider: 'local', model: result.model, choice: result.label, choiceLabel: labelFor(result.label),
          confidence: result.confidence, probabilities: result.probabilities,
          evidence: result.evidence, evidenceProbabilities: result.evidenceProbabilities,
          bugProbability: result.bugProbability, bugSuspected: result.bugSuspected,
          optionsCount: options.length, latencyMs: result.latencyMs, cached: false
        })
        sendJson(res, payload)
        return true
      }

      const clientToken = typeof body.token === 'string' && body.token.trim() ? body.token.trim() : undefined
      const clientEndpoint = typeof body.endpoint === 'string' && body.endpoint.trim() ? body.endpoint.trim() : undefined
      let endpoint: string | undefined = resolved.endpoint
      if (clientEndpoint) {
        if (provider === 'http' && clientToken) {
          endpoint = clientEndpoint
        } else if (provider === 'http' && resolved.endpoint && clientEndpoint === resolved.endpoint) {
          endpoint = resolved.endpoint
        } else {
          res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({
            ok: false,
            provider,
            error: 'Custom endpoint override is not permitted with server-managed credentials'
          } satisfies DecisionAgentServerResponse))
          return true
        }
      }

      const token = clientToken ?? resolved.token
      const accountId = (typeof body.accountId === 'string' && body.accountId.trim()) ? body.accountId.trim() : resolved.accountId
      const resolvedModel = provider === defaultResolved.provider ? defaultResolved.model : undefined
      const model = (typeof body.model === 'string' && body.model.trim()) ? body.model.trim() : resolvedModel
      const labels = options.map(o => o.id)
      const criteria = Object.fromEntries(options.map(o => [o.id, o.description || o.label || o.id]))

      const checkForBug = body.checkForBug !== false
      const bugRubric = typeof body.bugRubric === 'string' && body.bugRubric.trim() ? body.bugRubric.trim() : undefined
      const useCache = body.useCache !== false
      const cacheKey = JSON.stringify({
        provider,
        endpoint: endpoint ?? null,
        accountId: accountId ?? null,
        model: model ?? null,
        rubric,
        criteria,
        checkForBug,
        bugRubric: bugRubric ?? null,
        state: body.state ?? null,
        evidence
      })
      const hit = useCache ? cache.get(cacheKey) : undefined
      if (hit) {
        try {
          const result = await hit.promise
          session.cacheHits++
          await appendDecisionLog({
            kind: 'decision', sessionId: metaSessionId, game: metaGame, screen: metaScreen, source: metaSource,
            provider: hit.provider, model: result.model ?? hit.model ?? model, choice: result.label,
            choiceLabel: labelFor(result.label), confidence: result.confidence,
            probabilities: result.probabilities, evidence: result.evidence,
            evidenceProbabilities: result.evidenceProbabilities,
            bugProbability: result.bugProbability, bugSuspected: result.bugSuspected,
            optionsCount: options.length, latencyMs: 0, cached: true
          })
          sendJson(res, {
            ok: true,
            provider: hit.provider,
            model: result.model ?? hit.model ?? model,
            choice: result.label,
            confidence: result.confidence,
            probabilities: result.probabilities,
            evidence: result.evidence,
            evidenceProbabilities: result.evidenceProbabilities,
            bugProbability: result.bugProbability,
            bugSuspected: result.bugSuspected,
            usage: result.usage,
            latencyMs: 0,
            cached: true,
            session: { ...session }
          } satisfies DecisionAgentServerResponse)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ ok: false, provider: hit.provider, error: message, session: { ...session } } satisfies DecisionAgentServerResponse))
        }
        return true
      }

      const maxSessionRequests = resolveMaxSessionRequests()
      if (session.requests >= maxSessionRequests) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({
          ok: false,
          provider,
          error: `Decision session request limit (${maxSessionRequests}) exceeded`,
          session: { ...session }
        } satisfies DecisionAgentServerResponse))
        return true
      }

      session.requests++
      let pending: Promise<DecisionDetailed<string>> | undefined
      try {
        const api = createDecisionApi({
          provider,
          endpoint,
          token,
          accountId,
          model,
          labels,
          rubric,
          criteria,
          checkForBug,
          bugRubric,
          maxRequests: 1,
          maxRequestBytes: 32_768,
          maxResponseBytes: 32_768,
          timeoutMs: 15_000
        })
        pending = api.decideDetailed({ input: body.state ?? null, evidence }, { useCache: false })
        if (useCache) {
          if (cache.size >= MAX_CACHE_ENTRIES) {
            const oldestKey = cache.keys().next().value
            if (oldestKey !== undefined) cache.delete(oldestKey)
          }
          cache.set(cacheKey, { provider, model: api.model, promise: pending })
        }
        const result = await pending
        session.totalInputTokens += result.usage?.inputTokens ?? 0
        session.totalOutputTokens += result.usage?.outputTokens ?? 0
        await appendDecisionLog({
          kind: 'decision', sessionId: metaSessionId, game: metaGame, screen: metaScreen, source: metaSource,
          provider, model: result.model ?? api.model, choice: result.label, choiceLabel: labelFor(result.label),
          confidence: result.confidence, probabilities: result.probabilities,
          evidence: result.evidence, evidenceProbabilities: result.evidenceProbabilities,
          bugProbability: result.bugProbability, bugSuspected: result.bugSuspected,
          usage: result.usage, optionsCount: options.length, latencyMs: result.latencyMs, cached: false
        })
        sendJson(res, {
          ok: true,
          provider,
          model: result.model ?? api.model,
          choice: result.label,
          confidence: result.confidence,
          probabilities: result.probabilities,
          evidence: result.evidence,
          evidenceProbabilities: result.evidenceProbabilities,
          bugProbability: result.bugProbability,
          bugSuspected: result.bugSuspected,
          usage: result.usage,
          latencyMs: result.latencyMs,
          cached: false,
          session: { ...session }
        } satisfies DecisionAgentServerResponse)
      } catch (error) {
        if (useCache && pending && cache.get(cacheKey)?.promise === pending) {
          cache.delete(cacheKey)
        }
        const message = error instanceof Error ? error.message : String(error)
        await appendDecisionLog({
          kind: 'anomaly', sessionId: metaSessionId, game: metaGame, screen: metaScreen, source: metaSource,
          provider, error: message, anomalies: ['api_error']
        })
        res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ ok: false, provider, error: message, session: { ...session } } satisfies DecisionAgentServerResponse))
      }
      return true
    }

    sendText(res, 404, 'Unknown Decision Agent endpoint')
    return true
  }
}
