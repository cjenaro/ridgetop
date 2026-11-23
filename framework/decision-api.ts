import type { Decision, DecisionInput } from './types.ts'
import { selectDecisionProvider } from './decision-providers.ts'

const maxRequestBytes = 4096
const maxResponseBytes = 4096
const textEncoder = new TextEncoder()

// Limit bytes read after decompression as well as declared Content-Length.
async function readDecision(response: Response) {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error('Decision API returned HTTP ' + response.status)
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

export function createDecisionApi<I, E, L extends string>({ provider = 'http', endpoint, token, accountId, model,
  maxRequests = 3, labels, rubric }: {
  provider?: 'http' | 'openai' | 'clef' | 'jev'
  endpoint?: string | URL; token?: string; accountId?: string; model?: string; maxRequests?: number
  labels: readonly L[]; rubric: string
}) {
  const adapter = selectDecisionProvider(provider, { endpoint, model, accountId, labels })
  const url = new URL(adapter.endpoint)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) {
    throw new TypeError('Decision endpoint must use HTTPS or loopback HTTP and omit URL credentials')
  }
  if (provider !== 'http' && !token) throw new Error('Set RIDGETOP_DECISION_TOKEN for the selected provider')
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0) {
    throw new RangeError('Decision API request limit must be a nonnegative integer')
  }
  // Capture the rubric and labels for consistency during this run.
  const scope = structuredClone({ labels, rubric })
  const cache = new Map()
  const usage = { attempted: 0, reused: 0, overBudget: 0, requestBytes: 0 }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (token) headers.Authorization = 'Bearer ' + token

  return {
    provider,
    model: adapter.model,
    async decide({ input, evidence }: Omit<DecisionInput<I, E>, 'id'> & { id?: string }): Promise<Decision<L>> {
      // Case IDs and answer keys stay local. Equivalent observations share one request.
      const context = { ...scope, input, evidence }
      if (provider === 'clef' && evidence.length > 63) {
        throw new RangeError('Cloudflare Clef supports up to 63 evidence items per decision')
      }
      const body = JSON.stringify(adapter.encode(context))
      const bytes = textEncoder.encode(body).byteLength
      if (bytes > maxRequestBytes) throw new Error('Decision request exceeds ' + maxRequestBytes + ' bytes')
      if (cache.has(body)) {
        usage.reused++
        return structuredClone(await cache.get(body))
      }
      if (usage.attempted >= maxRequests) {
        usage.overBudget++
        throw new Error('Decision API request budget exhausted')
      }
      usage.attempted++
      usage.requestBytes += bytes
      const request = fetch(url, {
        method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(8_000)
      }).then(readDecision).then(response => adapter.decode(response, context))
      cache.set(body, request)
      try {
        return structuredClone(await request)
      } catch (error) {
        cache.delete(body)
        throw error
      }
    },
    report() { return { limit: maxRequests, ...usage } }
  }
}
