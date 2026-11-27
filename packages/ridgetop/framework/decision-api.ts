import type { Decision, DecisionDetailed, DecisionInput } from './types.ts'
import type { DecisionProviderName } from './decision-providers.ts'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectDecisionProvider } from './decision-providers.ts'

const defaultMaxRequestBytes = 4096
const defaultMaxResponseBytes = 4096
const defaultTimeoutMs = 8_000
const textEncoder = new TextEncoder()

/**
 * Parse a simple `.env` file without external dependencies.
 * Supports `KEY=VALUE`, quoted values, `export KEY=VALUE`, and `#` comments.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const cleaned = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = cleaned.indexOf('=')
    if (eq <= 0) continue
    const key = cleaned.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = cleaned.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Load `.env` from the given root directory (or `process.cwd()`), returning parsed entries.
 * Never mutates `process.env` unless `populateProcessEnv` is true (and never overwrites existing vars).
 */
export function loadDotEnv(root?: URL | string, populateProcessEnv = false): Record<string, string> {
  const baseDir = root instanceof URL ? fileURLToPath(root) : root ?? process.cwd()
  const candidates = [resolve(baseDir, '.env')]
  const cwdEnv = resolve(process.cwd(), '.env')
  if (cwdEnv !== candidates[0]) candidates.push(cwdEnv)
  const merged: Record<string, string> = {}
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue
    try {
      const parsed = parseDotEnv(readFileSync(filePath, 'utf8'))
      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in merged)) merged[key] = value
        if (populateProcessEnv && process.env[key] === undefined) {
          process.env[key] = value
        }
      }
    } catch {
      // Ignore unreadable .env files.
    }
  }
  return merged
}

export interface ResolvedDecisionEnv {
  readonly provider: DecisionProviderName
  readonly token?: string
  readonly accountId?: string
  readonly endpoint?: string
  readonly model?: string
  readonly configuredProviders: Readonly<Record<DecisionProviderName, boolean>>
}

function parseProviderName(raw: string | undefined): DecisionProviderName | undefined {
  if (raw === 'http' || raw === 'openai' || raw === 'clef' || raw === 'jev' || raw === 'typesafe') {
    return raw
  }
  return undefined
}

/**
 * Resolve decision API credentials from `process.env` and optional `.env` file.
 * Supports `TYPESAFE_API_KEY` (for JEV/Typesafe), `RIDGETOP_DECISION_TOKEN`,
 * `OPENAI_API_KEY`, and `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.
 */
export function resolveDecisionEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  root?: URL | string,
  requestedProvider?: DecisionProviderName
): ResolvedDecisionEnv {
  const dot = loadDotEnv(root, false)
  const get = (key: string): string | undefined => {
    const val = env[key] ?? dot[key]
    return val && val.trim() ? val.trim() : undefined
  }
  const typesafeKey = get('TYPESAFE_API_KEY') ?? get('JEV_API_KEY')
  const openaiKey = get('OPENAI_API_KEY')
  const clefKey = get('CLOUDFLARE_API_TOKEN') ?? get('CF_API_TOKEN')
  const clefAccount = get('RIDGETOP_DECISION_ACCOUNT_ID') ?? get('CLOUDFLARE_ACCOUNT_ID') ?? get('CF_ACCOUNT_ID')
  const genericToken = get('RIDGETOP_DECISION_TOKEN')
  const genericUrl = get('RIDGETOP_DECISION_URL')
  const envProvider = parseProviderName(get('RIDGETOP_DECISION_PROVIDER'))

  const configuredProviders: Record<DecisionProviderName, boolean> = {
    jev: Boolean(typesafeKey || (envProvider === 'jev' && genericToken)),
    typesafe: Boolean(typesafeKey || (envProvider === 'typesafe' && genericToken)),
    clef: Boolean((clefKey || (envProvider === 'clef' && genericToken)) && clefAccount),
    openai: Boolean(openaiKey || (envProvider === 'openai' && genericToken)),
    http: Boolean(genericUrl)
  }

  let provider: DecisionProviderName = requestedProvider ?? envProvider ?? (
    configuredProviders.jev ? 'jev'
      : configuredProviders.clef ? 'clef'
      : configuredProviders.openai ? 'openai'
      : 'http'
  )
  if (!['http', 'openai', 'clef', 'jev', 'typesafe'].includes(provider)) {
    provider = 'http'
  }

  let token: string | undefined
  if (provider === 'jev' || provider === 'typesafe') {
    token = typesafeKey ?? genericToken
  } else if (provider === 'openai') {
    token = openaiKey ?? genericToken
  } else if (provider === 'clef') {
    token = clefKey ?? genericToken
  } else {
    token = genericToken
  }

  return {
    provider,
    token,
    accountId: clefAccount,
    endpoint: provider === 'http' ? genericUrl : undefined,
    model: get('RIDGETOP_DECISION_MODEL'),
    configuredProviders
  }
}

// Limit bytes read after decompression as well as declared Content-Length.
async function readDecision(response: Response, maxResponseBytes: number) {
  if (!response.ok) {
    let detail = ''
    try {
      const text = await response.text()
      detail = text ? ': ' + text.slice(0, 240) : ''
    } catch {
      await response.body?.cancel().catch(() => {})
    }
    throw new Error('Decision API returned HTTP ' + response.status + detail)
  }
  if (Number(response.headers.get('content-length')) > maxResponseBytes) {
    await response.body?.cancel()
    throw new Error('Decision response exceeds ' + maxResponseBytes + ' bytes')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Decision API returned an empty response')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let text = ''
  let bytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxResponseBytes) throw new Error('Decision response exceeds ' + maxResponseBytes + ' bytes')
      text += decoder.decode(value, { stream: true })
    }
    return JSON.parse(text + decoder.decode())
  } catch (error) {
    await reader.cancel().catch(() => {})
    if (error instanceof SyntaxError) throw new Error('Decision API returned invalid JSON')
    throw error
  } finally {
    reader.releaseLock()
  }
}

export function createDecisionApi<I, E, L extends string>({
  provider = 'http',
  endpoint,
  token,
  accountId,
  model,
  maxRequests = 3,
  maxRequestBytes = defaultMaxRequestBytes,
  maxResponseBytes = defaultMaxResponseBytes,
  timeoutMs = defaultTimeoutMs,
  labels,
  rubric,
  criteria,
  checkForBug,
  bugRubric
}: {
  provider?: DecisionProviderName
  endpoint?: string | URL
  token?: string
  accountId?: string
  model?: string
  maxRequests?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  timeoutMs?: number
  labels: readonly L[]
  rubric: string
  criteria?: Readonly<Record<string, string>>
  checkForBug?: boolean
  bugRubric?: string
}) {
  const adapter = selectDecisionProvider(provider, { endpoint, model, accountId, labels })
  const url = new URL(adapter.endpoint)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) {
    throw new TypeError('Decision endpoint must use HTTPS or loopback HTTP and omit URL credentials')
  }
  if (provider !== 'http' && !token) throw new Error('Set RIDGETOP_DECISION_TOKEN (or TYPESAFE_API_KEY) for the selected provider')
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0) {
    throw new RangeError('Decision API request limit must be a nonnegative integer')
  }
  // Capture the rubric, criteria, and labels for consistency during this run.
  const scope = structuredClone({
    labels,
    rubric,
    ...(criteria ? { criteria } : {}),
    ...(checkForBug ? { checkForBug } : {}),
    ...(bugRubric ? { bugRubric } : {})
  })
  const cache = new Map<string, Promise<Omit<DecisionDetailed<L>, 'cached'>>>()
  const usage = { attempted: 0, reused: 0, overBudget: 0, requestBytes: 0 }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token

  async function decideDetailed(
    { input, evidence }: Omit<DecisionInput<I, E>, 'id'> & { id?: string },
    options?: { useCache?: boolean }
  ): Promise<DecisionDetailed<L>> {
    // Case IDs and answer keys stay local. Equivalent observations share one request.
    const context = { ...scope, input, evidence }
    if (provider === 'clef' && evidence.length > 63) {
      throw new RangeError('Cloudflare Clef supports up to 63 evidence items per decision')
    }
    const body = JSON.stringify(adapter.encode(context))
    const bytes = textEncoder.encode(body).byteLength
    if (bytes > maxRequestBytes) throw new Error('Decision request exceeds ' + maxRequestBytes + ' bytes')
    const useCache = options?.useCache !== false
    const cachedEntry = useCache ? cache.get(body) : undefined
    if (cachedEntry) {
      usage.reused++
      const cachedResult = await cachedEntry
      return structuredClone({ ...cachedResult, cached: true })
    }
    if (usage.attempted >= maxRequests) {
      usage.overBudget++
      throw new Error('Decision API request budget exhausted')
    }
    usage.attempted++
    usage.requestBytes += bytes
    const startedAt = Date.now()
    const request = fetch(url, {
      method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(timeoutMs)
    })
      .then(res => readDecision(res, maxResponseBytes))
      .then(response => {
        const detailed = adapter.decodeDetailed(response, context)
        return { ...detailed, latencyMs: Math.max(0, Date.now() - startedAt) }
      })
    if (useCache) cache.set(body, request)
    try {
      const result = await request
      return structuredClone({ ...result, cached: false })
    } catch (error) {
      if (useCache) cache.delete(body)
      throw error
    }
  }

  return {
    provider,
    model: adapter.model,
    decideDetailed,
    async decide(observation: Omit<DecisionInput<I, E>, 'id'> & { id?: string }): Promise<Decision<L>> {
      const detailed = await decideDetailed(observation)
      return { label: detailed.label, evidence: detailed.evidence }
    },
    report() { return { limit: maxRequests, ...usage } }
  }
}
