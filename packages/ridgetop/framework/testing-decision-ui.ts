import { getDecisionAgents, onDecisionAgentsChanged } from './testing-runtime.ts'
import type {
  DecisionAgentAdapter,
  DecisionAgentEvidence,
  DecisionAgentObservation,
  DecisionAgentOption,
  DecisionAgentResult
} from './testing-runtime.ts'

export const DECISION_AGENT_CHANNEL = 'ridgetop-decision-agent'

export type AgentMode = 'auto' | 'ui' | 'adapter'

export interface RecentAgentAction {
  readonly step: number
  readonly screen: string
  readonly id: string
  readonly label: string
}

export interface DecisionAgentHostSnapshot {
  readonly connected: boolean
  readonly gamePath: string
  readonly viewport: string
  readonly source: 'adapter' | 'ui' | 'sandbox'
  readonly adapterName?: string
  readonly hasEnsurePlayable: boolean
  readonly observation: DecisionAgentObservation
}

export interface DecisionAgentActionOutcome {
  readonly executed: boolean
  readonly widgetId?: string
  readonly widgetAction?: string
  readonly beforeScreen: string
  readonly afterScreen: string
  readonly stateChanged: boolean | null
  readonly runtimeErrors: readonly string[]
  readonly screenshotDataUrl?: string
}

export interface DecisionAgentBridge {
  readonly isRemote: boolean
  getSnapshot(
    mode: AgentMode,
    goal: string,
    recentActions: readonly RecentAgentAction[],
    uiVisits: Readonly<Record<string, number>>
  ): Promise<DecisionAgentHostSnapshot>
  executeAction(payload: {
    source: 'adapter' | 'ui' | 'sandbox'
    optionId: string
    decision: DecisionAgentResult
    captureScreenshot: boolean
  }): Promise<DecisionAgentActionOutcome>
  ensurePlayable(): Promise<void>
  captureScreenshot(): Promise<string | undefined>
  dispose(): void
}

interface DecisionStatusResponse {
  readonly ok: boolean
  readonly defaultProvider: string
  readonly configuredProviders: Record<string, boolean>
  readonly defaultModels: Record<string, string>
  readonly session: {
    readonly requests: number
    readonly cacheHits: number
    readonly totalInputTokens: number
    readonly totalOutputTokens: number
  }
}

interface DecisionApiResponse {
  readonly ok: boolean
  readonly error?: string
  readonly provider?: string
  readonly model?: string
  readonly choice?: string
  readonly confidence?: number
  readonly probabilities?: Record<string, number>
  readonly evidence?: string[]
  readonly evidenceProbabilities?: Record<string, number>
  readonly bugProbability?: number
  readonly bugSuspected?: boolean
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
  readonly latencyMs?: number
  readonly cached?: boolean
  readonly session?: {
    readonly requests: number
    readonly cacheHits: number
    readonly totalInputTokens: number
    readonly totalOutputTokens: number
  }
}

interface ScreenshotUploadResponse {
  readonly ok: boolean
  readonly file?: string
  readonly url?: string
}

interface RidgetopUiWidgetLike {
  readonly id: string
  readonly kind?: string
  readonly role?: string
  readonly label?: string
  readonly subtitle?: string
  readonly value?: unknown
  readonly checked?: boolean
  readonly selected?: boolean
  readonly disabled?: boolean
  readonly actions?: readonly string[]
}

interface RidgetopUiGlobalLike {
  query?: (filter?: { disabled?: boolean }) => readonly RidgetopUiWidgetLike[]
  snapshot?: () => readonly RidgetopUiWidgetLike[]
  state?: () => Record<string, unknown>
  act?: (id: string, action?: string, payload?: unknown) => boolean
}

interface DecisionHistoryEntry {
  readonly step: number
  readonly timestamp: string
  readonly summary: string
  readonly executed: boolean
  readonly source: 'adapter' | 'ui' | 'sandbox'
  readonly screen: string
  readonly anomalies: readonly string[]
  readonly runtimeErrors: readonly string[]
  readonly stateChanged: boolean | null
  readonly screenshotUrl?: string
  readonly screenshotFile?: string
  readonly observation: DecisionAgentObservation
  readonly response: DecisionApiResponse
}

export interface DecisionAgentHostBridgeHandle {
  readonly hostId: string
  readonly dispose: () => void
}

export interface DecisionAgentUiHandle {
  readonly hostId?: string
  readonly refresh: () => void
  readonly stop: () => void
  readonly dispose: () => void
}

const GOAL_PRESETS: Readonly<Record<string, { readonly label: string; readonly prompt: string }>> = {
  explore_play: {
    label: 'Explore & play naturally',
    prompt: 'Navigate menus, begin the campaign or run, make smart gameplay choices, and progress naturally through the game. Avoid repeating the exact same button if it did not advance the screen.'
  },
  test_menus: {
    label: 'Test menus & UI screens',
    prompt: 'Systematically explore different menus, tabs, camp/armory/codex/forge/settings screens, and interactive controls to test UI flows. Prefer unvisited buttons and tabs over recently clicked ones.'
  },
  win_gameplay: {
    label: 'Focus on gameplay / battle',
    prompt: 'Get into active gameplay as quickly as possible and choose the strongest tactical or gameplay action to win.'
  },
  qa_hunt: {
    label: 'QA stress-test (unvisited first)',
    prompt: 'Act as a QA tester: prioritize unvisited controls, alternate tabs, toggles, and secondary flows to exercise as much of the game as possible without getting stuck in loops.'
  }
}

const SANDBOX_OBSERVATION: DecisionAgentObservation = {
  ready: true,
  status: 'Sandbox probe (no Canvas UI or adapter detected)',
  summary: 'Sample probe — works on any page even without __ridgetopUi',
  rubric: 'Pick the best action for a hero at 35% HP facing a weakened goblin at 12 HP while holding a healing potion.',
  state: { heroHp: 35, heroMaxHp: 100, enemyHp: 12, enemyThreat: 22, potions: 1 },
  options: [
    { id: 'finish_enemy', label: 'Finish Goblin', description: 'Attack the weakened goblin for 18 dmg (guaranteed KO, removes threat)', heuristicScore: 92 },
    { id: 'drink_potion', label: 'Drink Potion', description: 'Restore +50 HP to survive next enemy hit', heuristicScore: 64 },
    { id: 'defend', label: 'Guard & Wait', description: 'Raise defense by 40% and end turn', heuristicScore: 22 }
  ],
  evidence: [
    { id: 'can_ko_enemy', label: 'Can KO Enemy', value: true },
    { id: 'hero_low_hp', label: 'Hero Low HP (<40%)', value: true },
    { id: 'potion_available', label: 'Potion Available', value: true }
  ]
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  jev: 'JEV (Typesafe)',
  typesafe: 'Typesafe (JEV)',
  clef: 'Clef (Cloudflare)',
  openai: 'OpenAI Decisions',
  http: 'Custom HTTP',
  local: 'Local Heuristic (No Key)'
}

const MAX_PENDING_RUNTIME_ERRORS = 100
const MAX_DETECTED_BUGS = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === 'bigint') return val.toString()
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]'
        seen.add(val)
      }
      return val
    }, space) ?? 'undefined'
  } catch {
    return String(value)
  }
}

function generateHostId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function sanitizeNumberMap(raw: unknown): Record<string, number> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, number> = {}
  let hasAny = false
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v
      hasAny = true
    }
  }
  return hasAny ? out : undefined
}

function sanitizeDecisionResult(raw: unknown, fallbackChoice: string): DecisionAgentResult {
  if (!isRecord(raw)) return { choice: fallbackChoice }
  const choice = typeof raw.choice === 'string' && raw.choice ? raw.choice : fallbackChoice
  const probabilities = sanitizeNumberMap(raw.probabilities)
  const evidenceProbabilities = sanitizeNumberMap(raw.evidenceProbabilities)
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.filter((e): e is string => typeof e === 'string')
    : undefined
  let usage: { readonly inputTokens?: number; readonly outputTokens?: number } | undefined
  if (isRecord(raw.usage)) {
    const inputTokens = typeof raw.usage.inputTokens === 'number' && Number.isFinite(raw.usage.inputTokens) ? raw.usage.inputTokens : undefined
    const outputTokens = typeof raw.usage.outputTokens === 'number' && Number.isFinite(raw.usage.outputTokens) ? raw.usage.outputTokens : undefined
    if (inputTokens !== undefined || outputTokens !== undefined) {
      usage = {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {})
      }
    }
  }
  return {
    choice,
    ...(typeof raw.provider === 'string' ? { provider: raw.provider } : {}),
    ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
    ...(typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? { confidence: raw.confidence } : {}),
    ...(probabilities ? { probabilities } : {}),
    ...(evidence ? { evidence } : {}),
    ...(evidenceProbabilities ? { evidenceProbabilities } : {}),
    ...(typeof raw.bugProbability === 'number' && Number.isFinite(raw.bugProbability) ? { bugProbability: raw.bugProbability } : {}),
    ...(typeof raw.bugSuspected === 'boolean' ? { bugSuspected: raw.bugSuspected } : {}),
    ...(usage ? { usage } : {}),
    ...(typeof raw.latencyMs === 'number' && Number.isFinite(raw.latencyMs) ? { latencyMs: raw.latencyMs } : {}),
    ...(typeof raw.cached === 'boolean' ? { cached: raw.cached } : {})
  }
}

function isSafeRelativeUrl(url: string | undefined): url is string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')
}

function getRidgetopUiGlobal(): RidgetopUiGlobalLike | null {
  const candidate: unknown = Reflect.get(globalThis, '__ridgetopUi')
  if (!isRecord(candidate)) return null
  const hasAct = typeof candidate.act === 'function'
  const hasQuery = typeof candidate.query === 'function' || typeof candidate.snapshot === 'function'
  if (!hasAct || !hasQuery) return null
  return candidate
}

function compactStateSnapshot(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {}
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [key, value] of Object.entries(raw)) {
    if (count >= 20) break
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value
      count++
    } else if (Array.isArray(value) && value.length <= 6 && value.every(v => typeof v === 'string' || typeof v === 'number')) {
      out[key] = value
      count++
    }
  }
  return out
}

function primaryWidgetAction(widget: RidgetopUiWidgetLike): string {
  const actions = widget.actions ?? []
  if (actions.includes('press')) return 'press'
  if (actions.includes('toggle')) return 'toggle'
  if (actions.includes('next')) return 'next'
  if (actions.includes('increment')) return 'increment'
  return 'press'
}

/**
 * Composite all visible game `<canvas>` layers (3D scene + Canvas UI HUD) onto an offscreen canvas
 * on the next animation frame so WebGL/WebGPU buffers are fresh, returning a compact JPEG dataUrl.
 */
export function captureGameCanvasScreenshot(maxDimension = 720): Promise<string | undefined> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return Promise.resolve(undefined)
  return new Promise(resolve => {
    window.requestAnimationFrame(() => {
      try {
        const testingRoot = document.getElementById('ridgetop-testing-root')
        const canvases = Array.from(document.querySelectorAll('canvas')).filter(c => {
          if (testingRoot && testingRoot.contains(c)) return false
          const rect = c.getBoundingClientRect()
          return rect.width > 16 && rect.height > 16 && c.width > 0 && c.height > 0
        })
        if (!canvases.length) {
          resolve(undefined)
          return
        }
        const vw = Math.max(1, window.innerWidth)
        const vh = Math.max(1, window.innerHeight)
        const scale = Math.min(1, maxDimension / Math.max(vw, vh))
        const out = document.createElement('canvas')
        out.width = Math.max(1, Math.round(vw * scale))
        out.height = Math.max(1, Math.round(vh * scale))
        const ctx = out.getContext('2d')
        if (!ctx) {
          resolve(undefined)
          return
        }
        ctx.fillStyle = '#0c1518'
        ctx.fillRect(0, 0, out.width, out.height)
        for (const c of canvases) {
          const r = c.getBoundingClientRect()
          try {
            ctx.drawImage(c, r.left * scale, r.top * scale, r.width * scale, r.height * scale)
          } catch {
            // Skip tainted or unavailable canvas layer.
          }
        }
        resolve(out.toDataURL('image/jpeg', 0.78))
      } catch {
        resolve(undefined)
      }
    })
  })
}

/**
 * Create a local in-page `DecisionAgentBridge` that directly inspects the current game tab,
 * executes actions via registered game adapters or `__ridgetopUi`, and captures runtime errors & screenshots.
 */
export function createLocalDecisionAgentBridge(): DecisionAgentBridge {
  const latestUiWidgets = new Map<string, RidgetopUiWidgetLike>()
  const pendingRuntimeErrors: { readonly seq: number; readonly message: string }[] = []
  let runtimeErrorSeq = 0
  const pushRuntimeError = (message: string) => {
    pendingRuntimeErrors.push({ seq: ++runtimeErrorSeq, message })
    if (pendingRuntimeErrors.length > MAX_PENDING_RUNTIME_ERRORS) {
      pendingRuntimeErrors.splice(0, pendingRuntimeErrors.length - MAX_PENDING_RUNTIME_ERRORS)
    }
  }
  const onWindowError = (event: ErrorEvent) => {
    const msg = event.message || (event.error instanceof Error ? event.error.message : String(event.error ?? 'Unknown error'))
    pushRuntimeError(`Error: ${msg}`)
  }
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'Unhandled rejection')
    pushRuntimeError(`UnhandledRejection: ${reason}`)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
  }

  function activeAdapter(): DecisionAgentAdapter | undefined {
    const agents = getDecisionAgents()
    return agents[agents.length - 1]
  }

  function captureFingerprint(): { screen: string; fingerprint: string } {
    const ui = getRidgetopUiGlobal()
    const rawState = ui?.state ? compactStateSnapshot(ui.state()) : {}
    const screen = typeof rawState.screen === 'string'
      ? rawState.screen
      : typeof rawState.mode === 'string'
        ? rawState.mode
        : 'unknown'
    const widgetIds = ui?.query
      ? ui.query({ disabled: false }).map(w => `${w.id}:${w.selected ? 1 : 0}:${w.checked ? 1 : 0}`).slice(0, 24)
      : []
    return { screen, fingerprint: safeStringify({ rawState, widgetIds }) }
  }

  function observeUniversalUi(
    goal: string,
    recentActions: readonly RecentAgentAction[],
    uiVisits: Readonly<Record<string, number>>
  ): DecisionAgentObservation | null {
    const ui = getRidgetopUiGlobal()
    if (!ui) return null
    const rawWidgets = ui.query ? ui.query({ disabled: false }) : (ui.snapshot ? ui.snapshot().filter(w => !w.disabled) : [])
    const enabled = rawWidgets.filter(w => w && typeof w.id === 'string' && w.id && !w.disabled)
    if (!enabled.length) return null

    const rawState = ui.state ? ui.state() : {}
    const compactState = compactStateSnapshot(rawState)
    const screenName = typeof compactState.screen === 'string'
      ? compactState.screen
      : typeof compactState.mode === 'string'
        ? compactState.mode
        : 'screen'

    const ranked = enabled.slice().sort((a, b) => {
      const va = uiVisits[a.id] ?? 0
      const vb = uiVisits[b.id] ?? 0
      const selA = a.selected ? 1 : 0
      const selB = b.selected ? 1 : 0
      if (va !== vb) return va - vb
      if (selA !== selB) return selA - selB
      return 0
    }).slice(0, 12)

    latestUiWidgets.clear()
    const options: DecisionAgentOption[] = ranked.map((widget, idx) => {
      const optId = `ui:${widget.id}`
      latestUiWidgets.set(optId, widget)
      const labelText = (widget.label || widget.id).trim()
      const kind = widget.kind || widget.role || 'control'
      const visits = uiVisits[widget.id] ?? 0
      const tags: string[] = [kind]
      if (widget.subtitle) tags.push(widget.subtitle)
      if (widget.selected) tags.push('currently selected')
      if (typeof widget.checked === 'boolean') tags.push(widget.checked ? 'checked' : 'unchecked')
      if (widget.value !== undefined && widget.value !== '') tags.push(`value=${String(widget.value)}`)
      if (visits > 0) tags.push(`clicked ${visits}x`)
      const heuristic = Math.max(5, 80 - visits * 25 - (widget.selected ? 30 : 0) - idx * 3)
      return {
        id: optId,
        label: labelText,
        description: `${labelText} (${tags.join(' · ')})`,
        category: kind,
        heuristicScore: heuristic
      }
    })

    const unvisitedCount = ranked.filter(w => (uiVisits[w.id] ?? 0) === 0).length
    const lastTwo = recentActions.slice(-2)
    const repeatedScreen = lastTwo.length === 2 && lastTwo.every(a => a.screen === screenName)
    const isMenuScreen = screenName !== 'battle' && screenName !== 'playing' && screenName !== 'race'

    const evidence: DecisionAgentEvidence[] = [
      { id: 'on_menu_or_hub', label: `On Menu/Hub (${screenName})`, value: isMenuScreen },
      { id: 'unvisited_controls', label: 'Unvisited Controls Available', value: unvisitedCount > 0 },
      { id: 'repeated_screen', label: 'Same Screen 2+ Steps', value: repeatedScreen },
      { id: 'multiple_choices', label: `${options.length} Interactive Controls`, value: options.length > 1 }
    ]

    const userGoal = goal.trim() || GOAL_PRESETS.explore_play.prompt
    return {
      ready: true,
      status: `UI: ${screenName} (${options.length} controls)`,
      summary: `Universal UI · Screen: ${screenName} · ${options.length} interactive controls (${unvisitedCount} unvisited)`,
      rubric: `${userGoal} Choose the best visible UI control to activate on the current "${screenName}" screen.`,
      state: {
        screen: screenName,
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : undefined,
        ...compactState,
        recentActions: recentActions.slice(-5).map(a => `${a.screen}:${a.label}`)
      },
      options,
      evidence
    }
  }

  return {
    isRemote: false,
    async getSnapshot(mode, goal, recentActions, uiVisits): Promise<DecisionAgentHostSnapshot> {
      const adapter = activeAdapter()
      const gamePath = typeof location !== 'undefined' ? location.pathname : '/'
      const viewport = typeof window !== 'undefined' ? `${window.innerWidth}×${window.innerHeight}` : '—'

      if (adapter && mode !== 'ui') {
        const adapterObs = adapter.observe()
        if (adapterObs && adapterObs.ready && adapterObs.options.length > 0) {
          const mergedRubric = goal.trim() ? `${goal.trim()}\n${adapterObs.rubric}` : adapterObs.rubric
          return {
            connected: true,
            gamePath,
            viewport,
            source: 'adapter',
            adapterName: adapter.name,
            hasEnsurePlayable: Boolean(adapter.ensurePlayable),
            observation: { ...adapterObs, rubric: mergedRubric }
          }
        }
        if (mode === 'adapter') {
          return {
            connected: true,
            gamePath,
            viewport,
            source: 'adapter',
            adapterName: adapter.name,
            hasEnsurePlayable: Boolean(adapter.ensurePlayable),
            observation: adapterObs ?? {
              ready: false,
              status: 'Waiting for game adapter',
              rubric: '',
              state: null,
              options: [],
              evidence: []
            }
          }
        }
      }

      const uiObs = observeUniversalUi(goal, recentActions, uiVisits)
      if (uiObs) {
        return {
          connected: true,
          gamePath,
          viewport,
          source: 'ui',
          adapterName: adapter?.name,
          hasEnsurePlayable: Boolean(adapter?.ensurePlayable),
          observation: uiObs
        }
      }

      if (adapter) {
        const adapterObs = adapter.observe()
        if (adapterObs) {
          return {
            connected: true,
            gamePath,
            viewport,
            source: 'adapter',
            adapterName: adapter.name,
            hasEnsurePlayable: Boolean(adapter.ensurePlayable),
            observation: adapterObs
          }
        }
      }

      return {
        connected: true,
        gamePath,
        viewport,
        source: 'sandbox',
        hasEnsurePlayable: false,
        observation: SANDBOX_OBSERVATION
      }
    },
    async executeAction({ source, optionId, decision, captureScreenshot }): Promise<DecisionAgentActionOutcome> {
      const beforeSnap = captureFingerprint()
      const errStartSeq = runtimeErrorSeq
      let executed = false
      let widgetId: string | undefined
      let widgetAction: string | undefined
      const adapter = activeAdapter()
      if (source === 'adapter' && adapter) {
        const acted = await adapter.act(optionId, decision)
        executed = acted !== false
      } else if (source === 'ui') {
        const ui = getRidgetopUiGlobal()
        const targetId = optionId.startsWith('ui:') ? optionId.slice(3) : latestUiWidgets.get(optionId)?.id
        if (ui?.act && targetId) {
          const liveWidgets = ui.query ? ui.query({ disabled: false }) : (ui.snapshot ? ui.snapshot() : [])
          const liveWidget = liveWidgets.find(w => w.id === targetId && !w.disabled) ?? latestUiWidgets.get(optionId)
          widgetId = targetId
          widgetAction = liveWidget ? primaryWidgetAction(liveWidget) : 'press'
          executed = Boolean(ui.act(widgetId, widgetAction))
        }
      }
      if (source !== 'sandbox') {
        await new Promise(resolve => window.setTimeout(resolve, 120))
      }
      const afterSnap = captureFingerprint()
      const stepErrors = pendingRuntimeErrors
        .filter(entry => entry.seq > errStartSeq)
        .map(entry => entry.message)
      const stateChanged = source !== 'sandbox'
        ? (beforeSnap.fingerprint !== afterSnap.fingerprint || beforeSnap.screen !== afterSnap.screen)
        : null
      const screenChanged = beforeSnap.screen !== afterSnap.screen
      const shouldSnap = captureScreenshot || screenChanged || stepErrors.length > 0 || !executed || (source === 'ui' && stateChanged === false)
      const screenshotDataUrl = shouldSnap ? await captureGameCanvasScreenshot() : undefined
      return {
        executed,
        ...(widgetId ? { widgetId, widgetAction } : {}),
        beforeScreen: beforeSnap.screen,
        afterScreen: afterSnap.screen,
        stateChanged,
        runtimeErrors: stepErrors,
        screenshotDataUrl
      }
    },
    async ensurePlayable() {
      const adapter = activeAdapter()
      if (adapter?.ensurePlayable) await adapter.ensurePlayable()
    },
    captureScreenshot() {
      return captureGameCanvasScreenshot()
    },
    dispose() {
      if (typeof window !== 'undefined') {
        window.removeEventListener('error', onWindowError)
        window.removeEventListener('unhandledrejection', onUnhandledRejection)
      }
    }
  }
}

/**
 * Listen on `BroadcastChannel('ridgetop-decision-agent')` inside a game tab so a Pop-Out
 * Companion Window (`/__testing/agent`) can observe, drive, and screenshot this tab remotely.
 */
export function attachDecisionAgentHostBridge(
  localBridge: DecisionAgentBridge,
  hostId: string = generateHostId()
): DecisionAgentHostBridgeHandle {
  if (typeof BroadcastChannel === 'undefined') return { hostId, dispose: () => {} }
  const channel = new BroadcastChannel(DECISION_AGENT_CHANNEL)
  channel.onmessage = async (event: MessageEvent) => {
    const msg: unknown = event.data
    if (!isRecord(msg) || msg.role !== 'popout' || typeof msg.reqId !== 'string') return
    if (typeof msg.hostId === 'string' && msg.hostId.length > 0 && msg.hostId !== hostId) return
    const reqId = msg.reqId
    try {
      if (msg.type === 'snapshot') {
        const mode: AgentMode = msg.mode === 'ui' || msg.mode === 'adapter' ? msg.mode : 'auto'
        const goal = typeof msg.goal === 'string' ? msg.goal : ''
        const recent: RecentAgentAction[] = Array.isArray(msg.recentActions) ? msg.recentActions : []
        const visits: Record<string, number> = isRecord(msg.uiVisits) ? Object.fromEntries(
          Object.entries(msg.uiVisits).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        ) : {}
        const snap = await localBridge.getSnapshot(mode, goal, recent, visits)
        channel.postMessage({ role: 'host', hostId, reqId, ok: true, result: snap })
      } else if (msg.type === 'act' && isRecord(msg.payload)) {
        const p = msg.payload
        const source = p.source === 'adapter' || p.source === 'ui' ? p.source : 'sandbox'
        const optionId = typeof p.optionId === 'string' ? p.optionId : ''
        const captureScreenshot = Boolean(p.captureScreenshot)
        const decisionObj = sanitizeDecisionResult(p.decision, optionId)
        const outcome = await localBridge.executeAction({ source, optionId, decision: decisionObj, captureScreenshot })
        channel.postMessage({ role: 'host', hostId, reqId, ok: true, result: outcome })
      } else if (msg.type === 'ensurePlayable') {
        await localBridge.ensurePlayable()
        channel.postMessage({ role: 'host', hostId, reqId, ok: true })
      } else if (msg.type === 'screenshot') {
        const dataUrl = await localBridge.captureScreenshot()
        channel.postMessage({ role: 'host', hostId, reqId, ok: true, result: dataUrl })
      }
    } catch (error) {
      channel.postMessage({ role: 'host', hostId, reqId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return {
    hostId,
    dispose: () => { channel.close() }
  }
}

/**
 * Create a remote `DecisionAgentBridge` for the Pop-Out Companion Window (`/__testing/agent`).
 */
export function createRemoteDecisionAgentBridge(targetHostId?: string): DecisionAgentBridge {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(DECISION_AGENT_CHANNEL) : null
  let seq = 0
  let boundHostId: string | undefined = targetHostId?.trim() || undefined
  if (!boundHostId && typeof window !== 'undefined' && typeof window.location?.search === 'string') {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('host')?.trim()
      if (fromUrl) boundHostId = fromUrl
    } catch { /* Ignore invalid location search. */ }
  }
  const pending = new Map<string, { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: number }>()

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const msg: unknown = event.data
      if (!isRecord(msg) || msg.role !== 'host' || typeof msg.reqId !== 'string') return
      const msgHostId = typeof msg.hostId === 'string' && msg.hostId.length > 0 ? msg.hostId : undefined
      if (boundHostId !== undefined && msgHostId !== boundHostId) return
      if (boundHostId === undefined && msgHostId !== undefined) boundHostId = msgHostId
      const entry = pending.get(msg.reqId)
      if (!entry) return
      pending.delete(msg.reqId)
      clearTimeout(entry.timer)
      if (msg.ok) entry.resolve(msg.result)
      else entry.reject(new Error(typeof msg.error === 'string' ? msg.error : 'Remote game tab error'))
    }
  }

  function request(type: string, extra: Record<string, unknown> = {}, timeoutMs = 4000): Promise<unknown> {
    if (!channel) return Promise.reject(new Error('BroadcastChannel is not supported in this browser'))
    const reqId = `req_${++seq}_${Date.now()}`
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(reqId)
        reject(new Error('No game tab responded (open any Ridgetop game tab on this server)'))
      }, timeoutMs)
      pending.set(reqId, { resolve, reject, timer })
      channel.postMessage({
        role: 'popout',
        reqId,
        type,
        ...(boundHostId ? { hostId: boundHostId } : {}),
        ...extra
      })
    })
  }

  return {
    isRemote: true,
    async getSnapshot(mode, goal, recentActions, uiVisits): Promise<DecisionAgentHostSnapshot> {
      try {
        const raw = await request('snapshot', { mode, goal, recentActions, uiVisits }, 1200)
        if (isRecord(raw) && typeof raw.connected === 'boolean' && isRecord(raw.observation)) {
          const obs = raw.observation
          return {
            connected: raw.connected,
            gamePath: typeof raw.gamePath === 'string' ? raw.gamePath : '/',
            viewport: typeof raw.viewport === 'string' ? raw.viewport : '—',
            source: raw.source === 'adapter' || raw.source === 'ui' ? raw.source : 'sandbox',
            adapterName: typeof raw.adapterName === 'string' ? raw.adapterName : undefined,
            hasEnsurePlayable: Boolean(raw.hasEnsurePlayable),
            observation: {
              ready: Boolean(obs.ready),
              status: typeof obs.status === 'string' ? obs.status : '',
              summary: typeof obs.summary === 'string' ? obs.summary : undefined,
              rubric: typeof obs.rubric === 'string' ? obs.rubric : '',
              state: obs.state,
              options: Array.isArray(obs.options) ? obs.options : [],
              evidence: Array.isArray(obs.evidence) ? obs.evidence : []
            }
          }
        }
      } catch {
        // Fall through to disconnected state.
      }
      return {
        connected: false,
        gamePath: '—',
        viewport: '—',
        source: 'sandbox',
        hasEnsurePlayable: false,
        observation: {
          ready: false,
          status: 'Waiting for game tab…',
          summary: 'Open any Ridgetop game tab (e.g. /crownshard) on this server to connect.',
          rubric: '',
          state: null,
          options: [],
          evidence: []
        }
      }
    },
    async executeAction(payload): Promise<DecisionAgentActionOutcome> {
      const raw = await request('act', { payload }, 8000)
      if (!isRecord(raw)) throw new Error('Invalid action outcome from game tab')
      return {
        executed: Boolean(raw.executed),
        widgetId: typeof raw.widgetId === 'string' ? raw.widgetId : undefined,
        widgetAction: typeof raw.widgetAction === 'string' ? raw.widgetAction : undefined,
        beforeScreen: typeof raw.beforeScreen === 'string' ? raw.beforeScreen : 'unknown',
        afterScreen: typeof raw.afterScreen === 'string' ? raw.afterScreen : 'unknown',
        stateChanged: typeof raw.stateChanged === 'boolean' ? raw.stateChanged : null,
        runtimeErrors: Array.isArray(raw.runtimeErrors) ? raw.runtimeErrors.filter((e): e is string => typeof e === 'string') : [],
        screenshotDataUrl: typeof raw.screenshotDataUrl === 'string' ? raw.screenshotDataUrl : undefined
      }
    },
    async ensurePlayable() {
      await request('ensurePlayable', {}, 4000)
    },
    async captureScreenshot() {
      const raw = await request('screenshot', {}, 4000)
      return typeof raw === 'string' ? raw : undefined
    },
    dispose() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer)
        entry.reject(new Error('Bridge disposed'))
      }
      pending.clear()
      channel?.close()
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: { className?: string; text?: string; type?: string; title?: string; id?: string; placeholder?: string },
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs?.className) node.className = attrs.className
  if (attrs?.text !== undefined) node.textContent = attrs.text
  if (attrs?.id) node.id = attrs.id
  if (attrs?.title) node.title = attrs.title
  if (attrs?.placeholder && (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
    node.placeholder = attrs.placeholder
  }
  if (attrs?.type) {
    if (node instanceof HTMLInputElement) node.type = attrs.type
    else if (node instanceof HTMLButtonElement && (attrs.type === 'button' || attrs.type === 'submit' || attrs.type === 'reset')) {
      node.type = attrs.type
    }
  }
  if (children.length) node.append(...children)
  return node
}

function pct(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`
}

export function mountDecisionAgentPane(
  container: HTMLElement,
  options: {
    onStatus?: (msg: string) => void
    onPopout?: () => void
    bridge?: DecisionAgentBridge
  } = {}
): DecisionAgentUiHandle {
  const ownsBridge = !options.bridge
  const bridge = options.bridge ?? createLocalDecisionAgentBridge()
  const hostBridge = bridge.isRemote ? null : attachDecisionAgentHostBridge(bridge)
  const abortController = new AbortController()

  let disposed = false
  let running = false
  let busy = false
  let runGen = 0
  let snapshotSeq = 0
  let snapshotInFlight = false
  let loopTimer: number | undefined
  let statusPollTimer: number | undefined
  let stepCounter = 0
  let selectedHistoryIndex = 0
  let intervalMs = 800
  let useCache = false
  let captureEveryStep = false
  let agentMode: AgentMode = 'auto'
  let serverStatus: DecisionStatusResponse | null = null
  let latestSnap: DecisionAgentHostSnapshot | null = null
  const sessionId = `da-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const history: DecisionHistoryEntry[] = []
  const uiVisitCounts: Record<string, number> = {}
  const visitedScreens = new Set<string>()
  const exercisedActions = new Set<string>()
  const detectedBugs: { step: number; screen: string; action: string; anomalies: readonly string[]; errors: readonly string[]; bugProbability?: number; screenshot?: string }[] = []
  const recentActions: RecentAgentAction[] = []
  let lastOutcomeForApi: Record<string, unknown> | null = null

  const root = el('div', { className: 'rt-da-root' })
  container.replaceChildren(root)

  // --- Provider & Key Config Card ---
  const configSection = el('div', { className: 'rt-section rt-da-card' })
  const configHeader = el('div', { className: 'rt-da-row-between' })
  configHeader.append(el('div', { className: 'rt-section-title', text: 'Decision API Provider' }))
  const headerRight = el('div', { className: 'rt-da-actions' })
  const keyBadge = el('span', { className: 'rt-da-pill', id: 'rt-da-key-badge', text: 'Checking .env…' })
  headerRight.append(keyBadge)
  if (!bridge.isRemote && options.onPopout) {
    const popBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-da-popout-btn', text: 'Pop Out ↗', title: 'Move Decision Agent to a separate window so the game viewport stays unobstructed' })
    popBtn.onclick = () => {
      stopAutoPlay()
      options.onPopout?.()
    }
    headerRight.append(popBtn)
  }
  configHeader.append(headerRight)

  const providerRow = el('div', { className: 'rt-da-grid-2' })
  const providerSelect = el('select', { className: 'rt-select', id: 'rt-da-provider' })
  for (const key of ['jev', 'clef', 'openai', 'http', 'local']) {
    providerSelect.append(new Option(PROVIDER_LABELS[key] ?? key, key))
  }
  const modelInput = el('input', { className: 'rt-input', id: 'rt-da-model', placeholder: 'Model (e.g. jev-latest)' })
  providerRow.append(providerSelect, modelInput)

  const keyDetails = el('details', { className: 'rt-da-details' })
  keyDetails.append(el('summary', { text: 'Custom API Key / Endpoint Override (optional)' }))
  const keyBody = el('div', { className: 'rt-da-stack' })
  const tokenInput = el('input', {
    className: 'rt-input',
    id: 'rt-da-token',
    type: 'password',
    placeholder: 'Leave blank to use server .env (TYPESAFE_API_KEY, etc.)'
  })
  const accountInput = el('input', {
    className: 'rt-input',
    id: 'rt-da-account',
    placeholder: 'Cloudflare Account ID (for Clef only)'
  })
  const endpointInput = el('input', {
    className: 'rt-input',
    id: 'rt-da-endpoint',
    placeholder: 'Custom HTTP endpoint URL (for http provider only)'
  })
  keyBody.append(tokenInput, accountInput, endpointInput)
  keyDetails.append(keyBody)
  configSection.append(configHeader, providerRow, keyDetails)

  // --- Test Goal & Mode Card ---
  const goalSection = el('div', { className: 'rt-section rt-da-card' })
  const goalHeader = el('div', { className: 'rt-da-row-between' })
  goalHeader.append(el('div', { className: 'rt-section-title', text: 'Test Goal & Scope' }))
  const modeSelect = el('select', { className: 'rt-select rt-da-compact-select', id: 'rt-da-mode' })
  modeSelect.append(
    new Option('Auto (Game + UI)', 'auto'),
    new Option('Universal UI Only', 'ui'),
    new Option('Game Adapter Only', 'adapter')
  )
  modeSelect.onchange = () => {
    const v = modeSelect.value
    agentMode = v === 'ui' || v === 'adapter' ? v : 'auto'
    void refreshSnapshot()
  }
  goalHeader.append(modeSelect)

  const presetSelect = el('select', { className: 'rt-select', id: 'rt-da-preset' })
  for (const [id, preset] of Object.entries(GOAL_PRESETS)) {
    presetSelect.append(new Option(preset.label, id))
  }
  const goalInput = el('textarea', {
    className: 'rt-textarea rt-da-goal',
    id: 'rt-da-goal',
    placeholder: 'Describe what you want the Decision API to test or do…'
  })
  goalInput.rows = 2
  goalInput.value = GOAL_PRESETS.explore_play.prompt
  presetSelect.onchange = () => {
    const chosen = GOAL_PRESETS[presetSelect.value]
    if (chosen) goalInput.value = chosen.prompt
  }
  goalSection.append(goalHeader, presetSelect, goalInput)

  // --- Adapter & Controls Card ---
  const controlSection = el('div', { className: 'rt-section rt-da-card' })
  const adapterHeader = el('div', { className: 'rt-da-row-between' })
  const adapterNameEl = el('div', { className: 'rt-section-title', id: 'rt-da-adapter-name', text: 'Game Agent' })
  const adapterStateBadge = el('span', { className: 'rt-da-pill', id: 'rt-da-state-badge', text: 'Idle' })
  adapterHeader.append(adapterNameEl, adapterStateBadge)

  const adapterSummaryEl = el('div', { className: 'rt-muted', id: 'rt-da-summary', text: '' })

  const btnRow = el('div', { className: 'rt-da-actions' })
  const playBtn = el('button', { className: 'rt-btn rt-btn-primary', type: 'button', id: 'rt-da-play-btn', text: '▶ Auto-Play' })
  const stepBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-da-step-btn', text: 'Step Once' })
  const thinkBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-da-think-btn', text: 'Think Only' })
  const enterBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-da-enter-btn', text: 'Jump to Gameplay' })
  enterBtn.hidden = true
  btnRow.append(playBtn, stepBtn, thinkBtn, enterBtn)

  const tuningRow = el('div', { className: 'rt-da-row-between rt-da-tuning' })
  const speedWrap = el('label', { className: 'rt-da-inline-label' })
  const speedText = el('span', { text: `Pace: ${intervalMs}ms` })
  const speedSlider = el('input', { type: 'range' })
  speedSlider.min = '300'
  speedSlider.max = '2500'
  speedSlider.step = '100'
  speedSlider.value = String(intervalMs)
  speedSlider.oninput = () => {
    intervalMs = Number(speedSlider.value)
    speedText.textContent = `Pace: ${intervalMs}ms`
  }
  speedWrap.append(speedText, speedSlider)

  const shotLabel = el('label', { className: 'rt-da-inline-label', title: 'Screenshots always capture on screen changes & anomalies; check to capture every single step' })
  const shotBox = el('input', { type: 'checkbox' })
  shotBox.checked = captureEveryStep
  shotBox.onchange = () => { captureEveryStep = shotBox.checked }
  shotLabel.append(shotBox, el('span', { text: 'Shot every step' }))

  const cacheLabel = el('label', { className: 'rt-da-inline-label' })
  const cacheBox = el('input', { type: 'checkbox' })
  cacheBox.checked = useCache
  cacheBox.onchange = () => { useCache = cacheBox.checked }
  cacheLabel.append(cacheBox, el('span', { text: 'Cache' }))
  tuningRow.append(speedWrap, shotLabel, cacheLabel)

  controlSection.append(adapterHeader, adapterSummaryEl, btnRow, tuningRow)

  // --- Error Banner ---
  const errorBanner = el('div', { className: 'rt-da-error', id: 'rt-da-error' })
  errorBanner.hidden = true

  // --- Live Decision & Probabilities Card ---
  const resultSection = el('div', { className: 'rt-section rt-da-card', id: 'rt-da-result-card' })
  const resultHeader = el('div', { className: 'rt-da-row-between' })
  resultHeader.append(el('div', { className: 'rt-section-title', text: 'Decision & Probabilities' }))
  const confidencePill = el('span', { className: 'rt-da-pill rt-da-pill-accent', id: 'rt-da-confidence', text: '—' })
  resultHeader.append(confidencePill)

  const chosenBanner = el('div', { className: 'rt-da-chosen', id: 'rt-da-chosen', text: 'Click "Step Once" or "Auto-Play" to watch the Decision API test menus, UI, and gameplay.' })
  const bugMeterWrap = el('div', { className: 'rt-da-bug-wrap', id: 'rt-da-bug-meter' })
  bugMeterWrap.hidden = true
  const shotPreviewWrap = el('div', { className: 'rt-da-shot-wrap', id: 'rt-da-shot-wrap' })
  shotPreviewWrap.hidden = true
  const metaStrip = el('div', { className: 'rt-da-meta-strip', id: 'rt-da-meta' })
  const probList = el('div', { className: 'rt-da-bars', id: 'rt-da-probs' })
  const evidenceTitle = el('div', { className: 'rt-da-subhead', text: 'Evidence Relevance (noul / p > 50% cited)' })
  const evidenceList = el('div', { className: 'rt-da-bars', id: 'rt-da-evidence' })
  const payloadDetails = el('details', { className: 'rt-da-details' })
  payloadDetails.append(el('summary', { text: 'Inspect State & Rubric Sent to API' }))
  const payloadPre = el('pre', { className: 'rt-da-pre', id: 'rt-da-payload', text: '{}' })
  payloadDetails.append(payloadPre)

  resultSection.append(resultHeader, chosenBanner, bugMeterWrap, shotPreviewWrap, metaStrip, probList, evidenceTitle, evidenceList, payloadDetails)

  // --- History & QA Summary Card ---
  const historySection = el('div', { className: 'rt-section rt-da-card' })
  const historyHeader = el('div', { className: 'rt-da-row-between' })
  historyHeader.append(el('div', { className: 'rt-section-title', text: 'QA Coverage & Timeline' }))
  const histBtns = el('div', { className: 'rt-da-actions' })
  const exportBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Export QA Log' })
  exportBtn.onclick = () => {
    const report = {
      sessionId,
      game: latestSnap?.gamePath ?? '/',
      viewport: latestSnap?.viewport ?? '—',
      exportedAt: new Date().toISOString(),
      coverage: {
        totalSteps: history.length,
        uniqueScreens: Array.from(visitedScreens),
        uniqueActions: Array.from(exercisedActions),
        bugCount: detectedBugs.length
      },
      bugs: detectedBugs,
      timeline: history
    }
    const blob = new Blob([safeStringify(report, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ridgetop-qa-${sessionId}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const clearBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Clear' })
  clearBtn.onclick = () => {
    if (busy) return
    history.length = 0
    for (const k of Object.keys(uiVisitCounts)) delete uiVisitCounts[k]
    visitedScreens.clear()
    exercisedActions.clear()
    detectedBugs.length = 0
    recentActions.length = 0
    lastOutcomeForApi = null
    stepCounter = 0
    selectedHistoryIndex = 0
    renderHistory()
  }
  histBtns.append(exportBtn, clearBtn)
  historyHeader.append(histBtns)
  const qaStrip = el('div', { className: 'rt-da-qa-strip', id: 'rt-da-qa-strip', text: 'Screens: 0 · Actions: 0 · Anomalies: 0' })
  const historyList = el('div', { className: 'rt-da-history', id: 'rt-da-history' })
  historySection.append(historyHeader, qaStrip, historyList)

  root.append(configSection, goalSection, controlSection, errorBanner, resultSection, historySection)

  function postOutcome(gamePath: string, payload: Record<string, unknown>) {
    void fetch('/__testing/decision/outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: safeStringify({ sessionId, game: gamePath, ...payload }),
      signal: abortController.signal
    }).catch(() => { /* Ignore telemetry failure. */ })
  }

  async function uploadScreenshot(step: number, screen: string, dataUrl: string): Promise<ScreenshotUploadResponse | null> {
    try {
      const res = await fetch('/__testing/decision/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: safeStringify({ sessionId, step, screen, dataUrl }),
        signal: abortController.signal
      })
      if (disposed || !res.ok) return null
      const json: unknown = await res.json()
      if (disposed || !isRecord(json) || json.ok !== true) return null
      return {
        ok: true,
        file: typeof json.file === 'string' ? json.file : undefined,
        url: typeof json.url === 'string' ? json.url : undefined
      }
    } catch {
      return null
    }
  }

  function updateKeyBadge() {
    const provider = providerSelect.value
    const hasOverride = tokenInput.value.trim().length > 0
    const serverHasKey = Boolean(serverStatus?.configuredProviders?.[provider])
    if (provider === 'local') {
      keyBadge.textContent = 'Local heuristic'
      keyBadge.className = 'rt-da-pill rt-da-pill-ok'
    } else if (hasOverride) {
      keyBadge.textContent = 'Using UI key override'
      keyBadge.className = 'rt-da-pill rt-da-pill-ok'
    } else if (serverHasKey) {
      keyBadge.textContent = provider === 'jev' || provider === 'typesafe'
        ? 'TYPESAFE_API_KEY ready'
        : 'Server key ready'
      keyBadge.className = 'rt-da-pill rt-da-pill-ok'
    } else {
      keyBadge.textContent = 'Key required (.env or override)'
      keyBadge.className = 'rt-da-pill rt-da-pill-warn'
    }
    accountInput.hidden = provider !== 'clef'
    endpointInput.hidden = provider !== 'http'
  }

  providerSelect.onchange = () => {
    const provider = providerSelect.value
    modelInput.value = serverStatus?.defaultModels?.[provider] ?? ''
    updateKeyBadge()
  }
  tokenInput.oninput = () => updateKeyBadge()

  function renderAdapterStatus(snap: DecisionAgentHostSnapshot | null = latestSnap) {
    if (!snap || !snap.connected) {
      adapterNameEl.textContent = bridge.isRemote ? 'Disconnected' : 'Game Agent'
      adapterSummaryEl.textContent = snap?.observation.summary ?? 'Waiting for game tab…'
      adapterStateBadge.textContent = 'Offline'
      adapterStateBadge.className = 'rt-da-pill rt-da-pill-warn'
      enterBtn.hidden = true
      return
    }
    const { source, adapterName, observation, gamePath, viewport, hasEnsurePlayable } = snap
    const titlePrefix = bridge.isRemote ? `${gamePath} (${viewport}) · ` : ''
    if (source === 'adapter' && adapterName) {
      adapterNameEl.textContent = titlePrefix + adapterName
    } else if (source === 'ui') {
      adapterNameEl.textContent = titlePrefix + (adapterName ? `${adapterName} · UI` : 'Universal UI Agent')
    } else {
      adapterNameEl.textContent = titlePrefix + 'Sandbox Mode'
    }
    adapterSummaryEl.textContent = observation.summary || observation.status
    enterBtn.hidden = !hasEnsurePlayable || source === 'adapter'
    if (busy) {
      adapterStateBadge.textContent = 'Thinking…'
      adapterStateBadge.className = 'rt-da-pill rt-da-pill-accent'
    } else if (running) {
      adapterStateBadge.textContent = observation.ready ? 'Auto-Playing' : 'Waiting…'
      adapterStateBadge.className = 'rt-da-pill rt-da-pill-ok'
    } else {
      adapterStateBadge.textContent = observation.ready ? `${observation.options.length} choices ready` : observation.status
      adapterStateBadge.className = observation.ready ? 'rt-da-pill rt-da-pill-ok' : 'rt-da-pill'
    }
    playBtn.textContent = running ? '■ Stop Auto-Play' : '▶ Auto-Play'
    playBtn.classList.toggle('rt-btn-danger', running)
    playBtn.classList.toggle('rt-btn-primary', !running)
    stepBtn.disabled = busy
    thinkBtn.disabled = busy
  }

  function isPaneVisible(): boolean {
    if (bridge.isRemote) return true
    if (container.offsetParent === null) return false
    if (container.closest('[hidden]') !== null) return false
    return true
  }

  async function refreshSnapshot(): Promise<DecisionAgentHostSnapshot> {
    const seq = ++snapshotSeq
    snapshotInFlight = true
    try {
      const snap = await bridge.getSnapshot(agentMode, goalInput.value, recentActions, uiVisitCounts)
      if (!disposed && seq === snapshotSeq) {
        latestSnap = snap
        renderAdapterStatus(snap)
      }
      return snap
    } finally {
      if (seq === snapshotSeq) snapshotInFlight = false
    }
  }

  function renderDecisionEntry(entry: DecisionHistoryEntry | undefined) {
    if (!entry) {
      confidencePill.textContent = '—'
      chosenBanner.textContent = 'Click "Step Once" or "▶ Auto-Play" to watch the Decision API test menus, UI, and gameplay.'
      bugMeterWrap.hidden = true
      bugMeterWrap.replaceChildren()
      shotPreviewWrap.hidden = true
      shotPreviewWrap.replaceChildren()
      metaStrip.replaceChildren()
      probList.replaceChildren()
      evidenceList.replaceChildren()
      payloadPre.textContent = '{}'
      return
    }

    const { observation, response } = entry
    const chosenOpt = observation.options.find(o => o.id === response.choice)
    confidencePill.textContent = response.confidence !== undefined
      ? `Confidence ${pct(response.confidence)}`
      : 'Decision Ready'

    chosenBanner.replaceChildren()
    const chosenHead = el('div', { className: 'rt-da-chosen-title' })
    const tagText = entry.executed
      ? (entry.source === 'ui' ? 'UI CLICK' : 'EXECUTED')
      : 'PREVIEW'
    chosenHead.append(
      el('span', { className: 'rt-da-chosen-badge', text: tagText }),
      el('strong', { text: chosenOpt?.label ?? response.choice ?? '—' })
    )
    chosenBanner.append(chosenHead)
    if (chosenOpt?.description && chosenOpt.description !== chosenOpt.label) {
      chosenBanner.append(el('div', { className: 'rt-muted', text: chosenOpt.description }))
    }

    if (typeof response.bugProbability === 'number') {
      const suspected = response.bugSuspected === true || response.bugProbability >= 0.5
      bugMeterWrap.hidden = false
      bugMeterWrap.className = 'rt-da-bar-row rt-da-bug-wrap' + (suspected ? ' rt-da-bug-flagged' : '')
      const bugTop = el('div', { className: 'rt-da-bar-head' })
      const bugLabel = el('span', { className: 'rt-da-bar-label' })
      bugLabel.append(
        el('span', { text: 'JEV Bug Suspicion' }),
        ...(suspected ? [el('span', { className: 'rt-da-bug-tag', text: 'FLAGGED FOR VERIFICATION' })] : [])
      )
      bugTop.append(bugLabel, el('span', { className: 'rt-da-bar-val', text: pct(response.bugProbability) }))
      const bugTrack = el('div', { className: 'rt-da-bar-track rt-da-ev-track' })
      const bugFill = el('div', { className: 'rt-da-bar-fill' })
      bugFill.style.width = `${Math.round(Math.max(0, Math.min(1, response.bugProbability)) * 100)}%`
      const bugMarker = el('div', { className: 'rt-da-threshold', title: '50% bug flag threshold' })
      bugTrack.append(bugFill, bugMarker)
      bugMeterWrap.replaceChildren(bugTop, bugTrack)
    } else {
      bugMeterWrap.hidden = true
      bugMeterWrap.replaceChildren()
    }

    if (isSafeRelativeUrl(entry.screenshotUrl)) {
      shotPreviewWrap.hidden = false
      const link = document.createElement('a')
      link.href = entry.screenshotUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.title = entry.screenshotFile ?? 'Open captured screenshot'
      const img = document.createElement('img')
      img.src = entry.screenshotUrl
      img.alt = `Step ${entry.step} screenshot`
      img.className = 'rt-da-shot-img'
      link.append(img)
      shotPreviewWrap.replaceChildren(link, el('div', { className: 'rt-muted', text: entry.screenshotFile ?? '' }))
    } else {
      shotPreviewWrap.hidden = true
      shotPreviewWrap.replaceChildren()
    }

    metaStrip.replaceChildren(
      el('span', { text: `Provider: ${response.provider ?? '—'}` }),
      el('span', { text: `Model: ${response.model ?? '—'}` }),
      el('span', { text: `Latency: ${response.latencyMs ?? 0}ms${response.cached ? ' (cached)' : ''}` }),
      ...(response.usage
        ? [el('span', { text: `Tokens: ${response.usage.inputTokens ?? 0} in / ${response.usage.outputTokens ?? 0} out` })]
        : [])
    )

    const probs = response.probabilities ?? {}
    const sortedOptions: { opt: DecisionAgentOption; prob: number | undefined }[] = observation.options.map(opt => ({
      opt,
      prob: typeof probs[opt.id] === 'number' ? probs[opt.id] : (opt.id === response.choice ? 1 : undefined)
    }))
    sortedOptions.sort((a, b) => (b.prob ?? -1) - (a.prob ?? -1))

    probList.replaceChildren()
    for (const { opt, prob } of sortedOptions) {
      const isWinner = opt.id === response.choice
      const row = el('div', { className: 'rt-da-bar-row' + (isWinner ? ' rt-da-bar-winner' : '') })
      const top = el('div', { className: 'rt-da-bar-head' })
      top.append(
        el('span', { className: 'rt-da-bar-label', text: opt.label }),
        el('span', { className: 'rt-da-bar-val', text: pct(prob) })
      )
      const track = el('div', { className: 'rt-da-bar-track' })
      const fill = el('div', { className: 'rt-da-bar-fill' })
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, prob ?? 0)) * 100)}%`
      track.append(fill)
      row.append(top, track, el('div', { className: 'rt-da-bar-desc', text: opt.description }))
      probList.append(row)
    }

    const evProbs = response.evidenceProbabilities ?? {}
    const citedSet = new Set(response.evidence ?? [])
    evidenceList.replaceChildren()
    if (!observation.evidence.length) {
      evidenceList.append(el('div', { className: 'rt-muted', text: 'No evidence items supplied for this step.' }))
    } else {
      const sortedEv: { ev: DecisionAgentEvidence; prob: number | undefined }[] = observation.evidence.map(ev => ({
        ev,
        prob: typeof evProbs[ev.id] === 'number' ? evProbs[ev.id] : undefined
      }))
      sortedEv.sort((a, b) => (b.prob ?? -1) - (a.prob ?? -1))
      for (const { ev, prob } of sortedEv) {
        const cited = citedSet.has(ev.id)
        const row = el('div', { className: 'rt-da-bar-row rt-da-ev-row' + (cited ? ' rt-da-ev-cited' : '') })
        const top = el('div', { className: 'rt-da-bar-head' })
        const nameWrap = el('span', { className: 'rt-da-bar-label' })
        nameWrap.append(
          el('span', { text: `${ev.label ?? ev.id} = ${safeStringify(ev.value)}` }),
          ...(cited ? [el('span', { className: 'rt-da-cited-tag', text: 'CITED' })] : [])
        )
        top.append(nameWrap, el('span', { className: 'rt-da-bar-val', text: pct(prob) }))
        const track = el('div', { className: 'rt-da-bar-track rt-da-ev-track' })
        const fill = el('div', { className: 'rt-da-bar-fill' })
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, prob ?? 0)) * 100)}%`
        track.append(fill, el('div', { className: 'rt-da-threshold', title: '50% citation threshold' }))
        row.append(top, track)
        evidenceList.append(row)
      }
    }

    payloadPre.textContent = safeStringify({
      rubric: observation.rubric,
      state: observation.state,
      options: observation.options,
      evidence: observation.evidence
    }, 2)
  }

  function renderHistory() {
    qaStrip.textContent = `Screens: ${visitedScreens.size} · Actions: ${exercisedActions.size} · Anomalies: ${detectedBugs.length} · Log: data/decisions.ndjson`
    qaStrip.classList.toggle('rt-da-qa-alert', detectedBugs.length > 0)
    historyList.replaceChildren()
    if (!history.length) {
      historyList.append(el('div', { className: 'rt-muted', text: 'No decisions recorded yet.' }))
      renderDecisionEntry(undefined)
      return
    }
    const clamped = Math.max(0, Math.min(selectedHistoryIndex, history.length - 1))
    selectedHistoryIndex = clamped
    renderDecisionEntry(history[clamped])

    history.forEach((entry, idx) => {
      const chosenOpt = entry.observation.options.find(o => o.id === entry.response.choice)
      const hasIssue = entry.anomalies.length > 0 || entry.runtimeErrors.length > 0
      const item = el('button', {
        type: 'button',
        className: 'rt-da-hist-item' + (idx === clamped ? ' rt-da-hist-active' : '') + (hasIssue ? ' rt-da-hist-anomaly' : '')
      })
      const top = el('div', { className: 'rt-da-row-between' })
      const prefix = (hasIssue ? '⚠ ' : '') + (entry.screenshotUrl ? '📷 ' : '')
      top.append(
        el('strong', { text: `${prefix}#${entry.step} · ${chosenOpt?.label ?? entry.response.choice ?? '—'}` }),
        el('span', { className: 'rt-muted', text: `${pct(entry.response.confidence)} · ${entry.response.latencyMs ?? 0}ms` })
      )
      const subText = hasIssue
        ? `${entry.anomalies.join(', ')}${entry.runtimeErrors.length ? ' · ' + entry.runtimeErrors[0] : ''}`
        : entry.summary
      item.append(top, el('div', { className: 'rt-muted', text: subText }))
      item.onclick = () => {
        selectedHistoryIndex = idx
        renderHistory()
      }
      historyList.append(item)
    })
  }

  function showError(msg: string | null) {
    if (!msg) {
      errorBanner.hidden = true
      errorBanner.textContent = ''
      return
    }
    errorBanner.hidden = false
    errorBanner.textContent = msg
  }

  async function runSingleDecision(executeAction: boolean): Promise<boolean> {
    if (busy || disposed) return false
    busy = true
    showError(null)
    renderAdapterStatus()
    try {
      const snap = await refreshSnapshot()
      if (disposed) return false
      const { source, observation, gamePath } = snap
      if (!snap.connected || !observation.ready || !observation.options.length) {
        return false
      }
      renderAdapterStatus(snap)
      const stateObj = isRecord(observation.state) ? observation.state : {}
      const beforeScreen = typeof stateObj.screen === 'string' ? stateObj.screen : (source === 'adapter' ? 'gameplay' : 'ui')
      const enrichedState = lastOutcomeForApi
        ? { ...stateObj, lastOutcome: lastOutcomeForApi }
        : observation.state
      const res = await fetch('/__testing/decision/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: safeStringify({
          sessionId,
          game: gamePath,
          screen: beforeScreen,
          source,
          provider: providerSelect.value,
          model: modelInput.value.trim() || undefined,
          token: tokenInput.value.trim() || undefined,
          accountId: accountInput.value.trim() || undefined,
          endpoint: endpointInput.value.trim() || undefined,
          rubric: observation.rubric,
          state: enrichedState,
          options: observation.options,
          evidence: observation.evidence,
          checkForBug: true,
          useCache
        })
      })
      if (disposed) return false
      let data: DecisionApiResponse | null = null
      try {
        const parsed: unknown = await res.json()
        if (isRecord(parsed)) data = parsed as unknown as DecisionApiResponse
      } catch {
        data = null
      }
      if (disposed) return false
      if (!res.ok || !data?.ok || !data.choice) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }

      const chosenLabel = observation.options.find(o => o.id === data.choice)?.label ?? data.choice
      let executed = false
      let widgetId: string | undefined
      let widgetAction: string | undefined
      let afterScreen = beforeScreen
      let stateChanged: boolean | null = null
      let stepErrors: readonly string[] = []
      let screenshotDataUrl: string | undefined

      const wantShot = captureEveryStep || stepCounter === 0 || data.bugSuspected === true

      if (executeAction) {
        const resultObj: DecisionAgentResult = {
          choice: data.choice,
          provider: data.provider,
          model: data.model,
          confidence: data.confidence,
          probabilities: data.probabilities,
          evidence: data.evidence,
          evidenceProbabilities: data.evidenceProbabilities,
          bugProbability: data.bugProbability,
          bugSuspected: data.bugSuspected,
          usage: data.usage,
          latencyMs: data.latencyMs,
          cached: data.cached
        }
        const outcome = await bridge.executeAction({
          source,
          optionId: data.choice,
          decision: resultObj,
          captureScreenshot: wantShot
        })
        if (disposed) return false
        executed = outcome.executed
        widgetId = outcome.widgetId
        widgetAction = outcome.widgetAction
        afterScreen = outcome.afterScreen !== 'unknown' ? outcome.afterScreen : beforeScreen
        stateChanged = outcome.stateChanged
        stepErrors = outcome.runtimeErrors
        screenshotDataUrl = outcome.screenshotDataUrl
        if (source === 'ui') {
          const visitKey = widgetId ?? data.choice
          uiVisitCounts[visitKey] = (uiVisitCounts[visitKey] ?? 0) + 1
        }
      } else if (wantShot) {
        screenshotDataUrl = await bridge.captureScreenshot()
        if (disposed) return false
      }

      stepCounter++
      const screenLabel = beforeScreen
      visitedScreens.add(screenLabel)
      if (afterScreen && afterScreen !== 'unknown') visitedScreens.add(afterScreen)
      exercisedActions.add(`${screenLabel}:${chosenLabel}`)

      // Keep deterministic anomalies strictly separate from JEV's own bug suspicion so we never create a feedback loop.
      const deterministicAnomalies: string[] = []
      if (stepErrors.length > 0) deterministicAnomalies.push('runtime_error')
      if (executeAction && source !== 'sandbox' && !executed) deterministicAnomalies.push('action_failed')
      if (executeAction && source === 'ui' && executed && stateChanged === false) deterministicAnomalies.push('no_state_change')

      const lastTwo = recentActions.slice(-2)
      if (
        executeAction &&
        lastTwo.length === 2 &&
        lastTwo.every(a => a.screen === screenLabel && a.label === chosenLabel) &&
        stateChanged === false
      ) {
        deterministicAnomalies.push('stuck_loop')
      }

      const displayAnomalies = data.bugSuspected === true
        ? [...deterministicAnomalies, `jev_bug_suspected(${pct(data.bugProbability)})`]
        : deterministicAnomalies

      let screenshotFile: string | undefined
      let screenshotUrl: string | undefined
      if (screenshotDataUrl) {
        const uploaded = await uploadScreenshot(stepCounter, afterScreen || screenLabel, screenshotDataUrl)
        if (disposed) return false
        if (uploaded) {
          screenshotFile = uploaded.file
          screenshotUrl = uploaded.url
        }
      }

      recentActions.push({ step: stepCounter, screen: screenLabel, id: data.choice, label: chosenLabel })
      if (recentActions.length > 20) recentActions.shift()

      // Only pass deterministic signals to JEV on the next turn (never feed JEV's own prior suspicion back to it).
      lastOutcomeForApi = {
        step: stepCounter,
        action: chosenLabel,
        beforeScreen: screenLabel,
        afterScreen,
        executed,
        stateChanged,
        anomalies: deterministicAnomalies,
        runtimeErrors: stepErrors
      }

      if (displayAnomalies.length > 0) {
        detectedBugs.push({
          step: stepCounter,
          screen: screenLabel,
          action: chosenLabel,
          anomalies: displayAnomalies,
          errors: stepErrors,
          bugProbability: data.bugProbability,
          screenshot: screenshotFile
        })
        if (detectedBugs.length > MAX_DETECTED_BUGS) {
          detectedBugs.splice(0, detectedBugs.length - MAX_DETECTED_BUGS)
        }
      }

      if (executeAction) {
        postOutcome(gamePath, {
          step: stepCounter,
          viewport: snap.viewport,
          source,
          choice: data.choice,
          choiceLabel: chosenLabel,
          ...(widgetId ? { widgetId, widgetAction } : {}),
          executed,
          beforeScreen: screenLabel,
          afterScreen,
          stateChanged,
          anomalies: displayAnomalies,
          deterministicAnomalies,
          runtimeErrors: stepErrors,
          ...(screenshotFile ? { screenshot: screenshotFile } : {})
        })
      }

      history.unshift({
        step: stepCounter,
        timestamp: new Date().toLocaleTimeString(),
        summary: observation.summary || observation.status,
        executed,
        source,
        screen: screenLabel,
        anomalies: displayAnomalies,
        runtimeErrors: stepErrors,
        stateChanged,
        screenshotUrl,
        screenshotFile,
        observation,
        response: data
      })
      if (history.length > 40) history.length = 40
      selectedHistoryIndex = 0
      renderHistory()
      options.onStatus?.(`Decision #${stepCounter}: ${chosenLabel} (${pct(data.confidence)})`)
      return true
    } catch (error) {
      if (disposed || (error instanceof DOMException && error.name === 'AbortError')) {
        return false
      }
      const msg = error instanceof Error ? error.message : String(error)
      showError(msg)
      options.onStatus?.('Decision error: ' + msg)
      if (running) stopAutoPlay()
      return false
    } finally {
      busy = false
      if (!disposed) {
        renderAdapterStatus()
        void refreshSnapshot()
      }
    }
  }

  function scheduleNextTick(immediate = false, gen = runGen) {
    if (!running || disposed || gen !== runGen) return
    if (loopTimer !== undefined) {
      clearTimeout(loopTimer)
      loopTimer = undefined
    }
    const delay = immediate ? 100 : Math.max(250, intervalMs)
    loopTimer = window.setTimeout(async () => {
      loopTimer = undefined
      if (!running || disposed || gen !== runGen) return
      const snap = await refreshSnapshot()
      if (!running || disposed || gen !== runGen) return
      if (snap.connected && snap.observation.ready && snap.observation.options.length) {
        await runSingleDecision(true)
      }
      if (running && !disposed && gen === runGen) scheduleNextTick(false, gen)
    }, delay)
  }

  function startAutoPlay() {
    if (running || disposed) return
    running = true
    const gen = ++runGen
    showError(null)
    renderAdapterStatus()
    scheduleNextTick(true, gen)
  }

  function stopAutoPlay() {
    running = false
    runGen++
    if (loopTimer !== undefined) {
      clearTimeout(loopTimer)
      loopTimer = undefined
    }
    renderAdapterStatus()
  }

  playBtn.onclick = () => {
    if (running) stopAutoPlay()
    else startAutoPlay()
  }
  stepBtn.onclick = () => { void runSingleDecision(true) }
  thinkBtn.onclick = () => { void runSingleDecision(false) }
  enterBtn.onclick = async () => {
    try {
      await bridge.ensurePlayable()
      if (disposed) return
      await refreshSnapshot()
    } catch (error) {
      if (disposed) return
      showError(error instanceof Error ? error.message : String(error))
    }
  }

  async function loadServerStatus() {
    try {
      const res = await fetch('/__testing/decision/status', { signal: abortController.signal })
      if (disposed || !res.ok) return
      const data: DecisionStatusResponse = await res.json()
      if (disposed) return
      serverStatus = data
      if (data.defaultProvider && Array.from(providerSelect.options).some(o => o.value === data.defaultProvider)) {
        providerSelect.value = data.defaultProvider
      }
      modelInput.value = data.defaultModels?.[providerSelect.value] ?? ''
      updateKeyBadge()
    } catch {
      if (!disposed) keyBadge.textContent = 'Server status unavailable'
    }
  }

  const unsubAgents = bridge.isRemote ? () => {} : onDecisionAgentsChanged(() => {
    if (!disposed) void refreshSnapshot()
  })

  statusPollTimer = window.setInterval(() => {
    if (!disposed && !busy && !snapshotInFlight && isPaneVisible()) void refreshSnapshot()
  }, 600)

  renderHistory()
  void refreshSnapshot()
  void loadServerStatus()

  return {
    hostId: hostBridge?.hostId,
    refresh() {
      void refreshSnapshot()
      void loadServerStatus()
    },
    stop: stopAutoPlay,
    dispose() {
      disposed = true
      abortController.abort()
      stopAutoPlay()
      if (statusPollTimer !== undefined) {
        clearInterval(statusPollTimer)
        statusPollTimer = undefined
      }
      unsubAgents()
      hostBridge?.dispose()
      if (ownsBridge) bridge.dispose()
    }
  }
}
