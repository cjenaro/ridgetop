import { spawn } from 'node:child_process'

export type CliOutputMode = 'human' | 'agent' | 'json'

export interface CliUiOptions {
  readonly mode: CliOutputMode
  readonly color: boolean
  readonly verbose: boolean
}

export interface ParsedGlobalFlags {
  readonly ui: CliUiOptions
  readonly rest: readonly string[]
  readonly explicitJson: boolean
  readonly flagMode?: CliOutputMode
  readonly noColor: boolean
  readonly verbose: boolean
}

export interface HelpItem {
  readonly name: string
  readonly summary: string
}

export interface HelpGroup {
  readonly heading: string
  readonly items: readonly HelpItem[]
}

export interface HelpSpec {
  readonly title: string
  readonly version?: string
  readonly subtitle?: string
  readonly usage: string
  readonly groups: readonly HelpGroup[]
  readonly options: readonly HelpItem[]
  readonly examples?: readonly string[]
}

export interface StepResult {
  readonly name: string
  readonly ok: boolean
  readonly durationMs: number
  readonly exitCode: number
  readonly output?: string
}

export interface RunCommandOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly stream?: boolean
}

const AGENT_ENV_KEYS: readonly string[] = [
  'CI',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CODEX_CI',
  'CODEX_SANDBOX',
  'CURSOR_AGENT',
  'ANTIGRAVITY_AGENT',
  'ANTIGRAVITY_CLI',
  'AI_AGENT',
  'OPENCODE',
  'AIDER',
  'WINDSURF_AGENT'
]

const ESC = String.fromCharCode(0x1b)
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g')

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  const lower = value.trim().toLowerCase()
  return lower !== '' && lower !== '0' && lower !== 'false' && lower !== 'no'
}

export function detectOutputMode(opts: {
  readonly flagMode?: CliOutputMode
  readonly env?: NodeJS.ProcessEnv
  readonly isTTY?: boolean
} = {}): CliOutputMode {
  if (opts.flagMode) return opts.flagMode
  const env = opts.env ?? process.env
  const envMode = env.RIDGETOP_OUTPUT?.trim().toLowerCase()
  if (envMode === 'human' || envMode === 'agent' || envMode === 'json') {
    return envMode
  }
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY)
  if (!isTTY) return 'agent'
  if (env.TERM?.trim().toLowerCase() === 'dumb') return 'agent'
  for (const key of AGENT_ENV_KEYS) {
    if (isTruthyEnv(env[key])) return 'agent'
  }
  return 'human'
}

export function shouldUseColor(
  mode: CliOutputMode,
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
  noColorFlag = false
): boolean {
  if (mode !== 'human' || noColorFlag) return false
  if (env.NO_COLOR !== undefined) return false
  if (isTruthyEnv(env.FORCE_COLOR)) return true
  return isTTY
}

export function parseGlobalFlags(
  argv: readonly string[],
  opts: {
    readonly env?: NodeJS.ProcessEnv
    readonly isTTY?: boolean
    readonly stopAtFirstPositional?: boolean
  } = {}
): ParsedGlobalFlags {
  let flagMode: CliOutputMode | undefined
  let verbose = false
  let noColor = false
  let explicitJson = false
  const rest: string[] = []
  let seenPositional = false
  let passthrough = false

  for (const arg of argv) {
    if (passthrough) {
      rest.push(arg)
      continue
    }
    if (arg === '--') {
      passthrough = true
      rest.push(arg)
      continue
    }
    if (opts.stopAtFirstPositional && seenPositional) {
      rest.push(arg)
      continue
    }
    if (arg === '--human') {
      flagMode = 'human'
      continue
    }
    if (arg === '--agent') {
      flagMode = 'agent'
      continue
    }
    if (arg === '--json') {
      flagMode = 'json'
      explicitJson = true
      continue
    }
    if (arg === '--verbose') {
      verbose = true
      continue
    }
    if (arg === '--no-color') {
      noColor = true
      continue
    }
    if (!arg.startsWith('-')) {
      seenPositional = true
    }
    rest.push(arg)
  }

  const env = opts.env ?? process.env
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY)
  const mode = detectOutputMode({ flagMode, env, isTTY })
  const color = shouldUseColor(mode, env, isTTY, noColor)
  return {
    ui: { mode, color, verbose },
    rest,
    explicitJson,
    ...(flagMode ? { flagMode } : {}),
    noColor,
    verbose
  }
}

export function mergeCliFlags(
  base: ParsedGlobalFlags,
  extra: ParsedGlobalFlags,
  opts: { readonly env?: NodeJS.ProcessEnv; readonly isTTY?: boolean } = {}
): ParsedGlobalFlags {
  const env = opts.env ?? process.env
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY)
  const flagMode = extra.flagMode ?? base.flagMode
  const noColor = base.noColor || extra.noColor
  const verbose = base.verbose || extra.verbose
  const explicitJson = flagMode === 'json'
  const mode = detectOutputMode({ flagMode, env, isTTY })
  const color = shouldUseColor(mode, env, isTTY, noColor)
  return {
    ui: { mode, color, verbose },
    rest: extra.rest,
    explicitJson,
    ...(flagMode ? { flagMode } : {}),
    noColor,
    verbose
  }
}

export function resolveErrorUi(
  argv: readonly string[],
  opts: { readonly env?: NodeJS.ProcessEnv; readonly isTTY?: boolean } = {}
): CliUiOptions {
  return parseGlobalFlags(argv, { ...opts, stopAtFirstPositional: false }).ui
}

export function style(ui: CliUiOptions) {
  const wrap = (code: string) => (text: string) => (ui.color ? `${ESC}[${code}m${text}${ESC}[0m` : text)
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    cyan: wrap('36'),
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
    boldCyan: wrap('1;36'),
    boldGreen: wrap('1;32'),
    boldRed: wrap('1;31')
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s`
}

export function trimErrorOutput(text: string, maxLines = 35): string {
  const cleaned = stripAnsi(text).replace(/\r\n/g, '\n').trim()
  if (!cleaned) return ''
  const lines = cleaned.split('\n')
  if (lines.length <= maxLines) return cleaned
  const omitted = lines.length - maxLines
  return `... (${omitted} earlier lines omitted)\n${lines.slice(-maxLines).join('\n')}`
}

export function renderHelp(spec: HelpSpec, ui: CliUiOptions): string {
  if (ui.mode === 'json') {
    return JSON.stringify(
      {
        title: spec.title,
        ...(spec.version ? { version: spec.version } : {}),
        ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
        usage: spec.usage,
        groups: spec.groups,
        options: spec.options,
        ...(spec.examples?.length ? { examples: spec.examples } : {})
      },
      null,
      2
    )
  }

  if (ui.mode === 'agent') {
    const lines: string[] = [
      spec.version ? `${spec.title} v${spec.version}` : spec.title,
      `Usage: ${spec.usage}`
    ]
    for (const group of spec.groups) {
      lines.push(`${group.heading}:`)
      for (const item of group.items) {
        lines.push(`  ${item.name} - ${item.summary}`)
      }
    }
    if (spec.options.length) {
      lines.push('Options:')
      for (const opt of spec.options) {
        lines.push(`  ${opt.name} - ${opt.summary}`)
      }
    }
    return lines.join('\n')
  }

  const s = style(ui)
  let maxName = 0
  for (const group of spec.groups) {
    for (const item of group.items) {
      if (item.name.length > maxName) maxName = item.name.length
    }
  }
  for (const opt of spec.options) {
    if (opt.name.length > maxName) maxName = opt.name.length
  }
  const pad = Math.min(Math.max(maxName + 2, 22), 40)

  const lines: string[] = []
  const header = spec.version
    ? `${s.boldCyan(spec.title)} ${s.dim(`v${spec.version}`)}`
    : s.boldCyan(spec.title)
  lines.push(header)
  if (spec.subtitle) lines.push(s.dim(spec.subtitle))
  lines.push('')
  lines.push(`${s.bold('Usage:')} ${spec.usage}`)

  for (const group of spec.groups) {
    lines.push('')
    lines.push(s.bold(`${group.heading}:`))
    for (const item of group.items) {
      lines.push(`  ${s.cyan(item.name.padEnd(pad))}${item.summary}`)
    }
  }

  if (spec.options.length) {
    lines.push('')
    lines.push(s.bold('Options:'))
    for (const opt of spec.options) {
      lines.push(`  ${s.dim(opt.name.padEnd(pad))}${opt.summary}`)
    }
  }

  if (spec.examples?.length) {
    lines.push('')
    lines.push(s.bold('Examples:'))
    for (const example of spec.examples) {
      lines.push(`  ${s.dim('$')} ${example}`)
    }
  }

  return lines.join('\n')
}

export function renderError(message: string, ui: CliUiOptions, hint?: string): string {
  if (ui.mode === 'json') {
    return JSON.stringify({ ok: false, error: message, ...(hint ? { hint } : {}) })
  }
  if (ui.mode === 'agent') {
    return hint ? `ERROR: ${message} (${hint})` : `ERROR: ${message}`
  }
  const s = style(ui)
  const out = `${s.boldRed('✗')} ${s.red(message)}`
  return hint ? `${out}\n  ${s.dim(hint)}` : out
}

export function renderSuccess(
  message: string,
  ui: CliUiOptions,
  opts: { readonly detail?: string; readonly json?: Record<string, unknown> } = {}
): string {
  if (ui.mode === 'json') {
    return JSON.stringify({ ok: true, ...(opts.json ?? { message }) })
  }
  if (ui.mode === 'agent') {
    return message
  }
  const s = style(ui)
  const out = `${s.boldGreen('✓')} ${message}`
  return opts.detail ? `${out}\n  ${s.dim(opts.detail)}` : out
}

export function runChildProcess(
  command: string,
  args: readonly string[],
  opts: RunCommandOptions = {}
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      cwd: opts.cwd ?? process.cwd(),
      env: opts.env ?? process.env,
      stdio: opts.stream ? 'inherit' : ['ignore', 'pipe', 'pipe']
    })

    if (opts.stream) {
      child.on('error', rejectPromise)
      child.on('close', code => {
        resolvePromise({ exitCode: code ?? 1, stdout: '', stderr: '' })
      })
      return
    }

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    child.stdout?.on('data', chunk => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.stderr?.on('data', chunk => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    child.on('error', rejectPromise)
    child.on('close', code => {
      resolvePromise({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      })
    })
  })
}

export class CliStepRunner {
  readonly ui: CliUiOptions
  readonly command: string
  readonly startedAt: number
  readonly steps: StepResult[] = []

  constructor(ui: CliUiOptions, command: string) {
    this.ui = ui
    this.command = command
    this.startedAt = performance.now()
    if (ui.mode === 'human') {
      const s = style(ui)
      console.log(`${s.boldCyan('◈')} ${s.bold(command)}`)
    }
  }

  async run(
    name: string,
    fn: () => Promise<{ readonly exitCode: number; readonly output?: string } | void>
  ): Promise<boolean> {
    const t0 = performance.now()
    const s = style(this.ui)
    try {
      const res = await fn()
      const exitCode = res ? res.exitCode : 0
      const ok = exitCode === 0
      const durationMs = Math.round(performance.now() - t0)
      const output = res?.output
      this.steps.push({ name, ok, durationMs, exitCode, ...(output ? { output } : {}) })

      if (this.ui.mode === 'human') {
        const mark = ok ? s.boldGreen('✓') : s.boldRed('✗')
        console.log(`  ${mark} ${name} ${s.dim(formatDuration(durationMs))}`)
        if ((!ok || this.ui.verbose) && output) {
          console.log(trimErrorOutput(output, ok ? 20 : 40))
        }
      } else if (this.ui.mode === 'agent' && this.ui.verbose && ok) {
        console.log(`ok ${name} ${formatDuration(durationMs)}`)
      }
      return ok
    } catch (error) {
      const durationMs = Math.round(performance.now() - t0)
      const message = error instanceof Error ? error.message : String(error)
      this.steps.push({ name, ok: false, durationMs, exitCode: 1, output: message })
      if (this.ui.mode === 'human') {
        console.log(`  ${s.boldRed('✗')} ${name} ${s.dim(formatDuration(durationMs))}`)
        console.log(trimErrorOutput(message, 40))
      }
      return false
    }
  }

  async exec(
    name: string,
    command: string,
    args: readonly string[],
    opts: RunCommandOptions = {}
  ): Promise<boolean> {
    return this.run(name, async () => {
      const res = await runChildProcess(command, args, opts)
      const combined = [res.stderr.trim(), res.stdout.trim()].filter(Boolean).join('\n')
      return {
        exitCode: res.exitCode,
        output: combined || undefined
      }
    })
  }

  finish(): number {
    const totalMs = Math.round(performance.now() - this.startedAt)
    const failed = this.steps.find(step => !step.ok)
    const ok = !failed

    if (this.ui.mode === 'json') {
      console.log(
        JSON.stringify(
          {
            ok,
            command: this.command,
            durationMs: totalMs,
            steps: this.steps.map(step => ({
              name: step.name,
              ok: step.ok,
              durationMs: step.durationMs,
              exitCode: step.exitCode,
              ...(!step.ok && step.output ? { output: trimErrorOutput(step.output, 40) } : {})
            }))
          },
          null,
          2
        )
      )
      return ok ? 0 : failed.exitCode || 1
    }

    if (this.ui.mode === 'agent') {
      if (ok) {
        const names = this.steps.map(step => step.name).join(', ')
        console.log(`OK ${this.command} ${formatDuration(totalMs)}${names ? ` (${names})` : ''}`)
        return 0
      }
      console.error(`FAIL ${this.command} at "${failed.name}" (exit ${failed.exitCode}, ${formatDuration(totalMs)})`)
      if (failed.output) {
        console.error(trimErrorOutput(failed.output, 40))
      }
      return failed.exitCode || 1
    }

    const s = style(this.ui)
    if (ok) {
      console.log(`${s.boldGreen('Done')} ${s.dim(`in ${formatDuration(totalMs)}`)}`)
      return 0
    }
    console.error(`${s.boldRed('Failed')} at ${s.bold(failed.name)} ${s.dim(`(${formatDuration(totalMs)})`)}`)
    return failed.exitCode || 1
  }
}
