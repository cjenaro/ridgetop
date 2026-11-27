#!/usr/bin/env node
import { chmod, copyFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CliStepRunner,
  type CliUiOptions,
  type HelpSpec,
  mergeCliFlags,
  parseGlobalFlags,
  renderError,
  renderHelp,
  resolveErrorUi,
  runChildProcess
} from '../packages/ridgetop/tools/cli-ui.ts'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const EXAMPLES: readonly string[] = ['beacon-run', 'signal-drift', 'lighthouse', 'crownshard', 'starter']
const BUNDLES: readonly (readonly [string, string])[] = [
  ['bundle:workshop', 'tools/build-workshop.ts'],
  ['bundle:player', 'tools/build-player.ts'],
  ['bundle:models', 'tools/build-models.ts']
]
const SMOKE_SUITES: Record<string, { readonly script: string; readonly summary: string }> = {
  browser: { script: 'tools/browser-smoke.ts', summary: 'Full Chromium WebGPU/WebGL 2/Canvas 2D smoke suite' },
  mobile: { script: 'tools/crownshard-mobile-smoke.ts', summary: 'Crownshard mobile viewport & touch smoke suite' },
  firefox: { script: 'tools/firefox-smoke.ts', summary: 'Firefox compatibility smoke suite' },
  review: { script: 'tools/art-review-smoke.ts', summary: 'In-game Testing Mode & art review smoke suite' },
  player: { script: 'tools/player-smoke.ts', summary: 'Offline downloadable Signal Drift player smoke suite' },
  runtimes: { script: 'tools/runtime-smoke.ts', summary: 'Node, Bun, and Deno server runtime smoke suite' }
}
const NODE_TEST_VALUE_FLAGS = new Set([
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-concurrency',
  '--test-timeout',
  '--test-shard',
  '--test-rerun-failures',
  '--test-global-setup',
  '--import',
  '--require',
  '-r'
])

function localBin(name: string): string {
  const ext = process.platform === 'win32' ? '.cmd' : ''
  return join(repoRoot, 'node_modules', '.bin', `${name}${ext}`)
}

function rootHelpSpec(): HelpSpec {
  return {
    title: 'Ridgetop Dev CLI (rt)',
    subtitle: 'Monorepo build, check, serve, smoke, and verification workflows.',
    usage: 'pnpm rt [options] <command> [args...]',
    groups: [
      {
        heading: 'Build & Quality',
        items: [
          { name: 'build [target]', summary: 'Build all, framework, examples, root, bundles, or one example' },
          { name: 'typecheck [target]', summary: 'Typecheck all, framework, examples, root, or one example' },
          { name: 'lint [args...]', summary: 'Run oxlint over production sources' },
          { name: 'test [files...]', summary: 'Run Node unit tests (default: test/*.test.ts)' },
          { name: 'check', summary: 'Run build, typecheck, lint, and unit tests in sequence' }
        ]
      },
      {
        heading: 'Servers & Smoke Suites',
        items: [
          { name: 'serve [options]', summary: 'Start server (--testing, --runtime node|bun|deno)' },
          { name: 'playtest', summary: 'Start starter Lantern Grove in Testing Mode' },
          { name: 'smoke <suite> [args...]', summary: 'Run browser, mobile, firefox, review, player, runtimes, or all' }
        ]
      },
      {
        heading: 'Verification & Tools',
        items: [
          { name: 'verify [args...]', summary: 'Run replay, bounded exploration, and decision evals' },
          { name: 'replay-decision [args...]', summary: 'Replay a recorded decision session trace' },
          { name: 'feel [args...]', summary: 'Run jump-timing / game-feel probe tuning' },
          { name: 'sprites', summary: 'Regenerate Beacon Run sprite atlas and JSON' }
        ]
      }
    ],
    options: [
      { name: '--human', summary: 'Force rich terminal output for human readers' },
      { name: '--agent', summary: 'Force compact, token-economical plain output (default in non-TTY/CI/agents)' },
      { name: '--json', summary: 'Emit structured JSON output' },
      { name: '--verbose', summary: 'Show passing step output' },
      { name: '--no-color', summary: 'Disable ANSI color escapes' },
      { name: '-h, --help', summary: 'Show help for rt or a subcommand' }
    ],
    examples: [
      'pnpm rt check',
      'pnpm rt build framework',
      'pnpm rt serve --testing',
      'pnpm rt smoke runtimes -- bun deno',
      'pnpm ridgetop package --target web --game signal-drift'
    ]
  }
}

function isExampleName(value: string): boolean {
  return EXAMPLES.includes(value)
}

async function runBuildSteps(runner: CliStepRunner, target: string): Promise<boolean> {
  const tsc = localBin('tsc')

  if (target === 'all' || target === 'framework') {
    if (!await runner.exec('build:framework', tsc, ['-p', 'packages/ridgetop/tsconfig.build.json'], { cwd: repoRoot })) {
      return false
    }
    const assetsOk = await runner.run('build:framework-assets', async () => {
      await copyFile(
        join(repoRoot, 'packages/ridgetop/framework/testing-overlay.css'),
        join(repoRoot, 'packages/ridgetop/dist/framework/testing-overlay.css')
      )
      await chmod(join(repoRoot, 'packages/ridgetop/dist/tools/cli.js'), 0o755)
    })
    if (!assetsOk) return false
  }

  if (target === 'all' || target === 'examples') {
    for (const example of EXAMPLES) {
      if (!await runner.exec(`build:${example}`, tsc, ['-p', `examples/${example}/tsconfig.build.json`], { cwd: repoRoot })) {
        return false
      }
    }
  } else if (isExampleName(target)) {
    if (!await runner.exec(`build:${target}`, tsc, ['-p', `examples/${target}/tsconfig.build.json`], { cwd: repoRoot })) {
      return false
    }
  }

  if (target === 'all' || target === 'root') {
    if (!await runner.exec('build:root', tsc, ['-p', 'tsconfig.build.json'], { cwd: repoRoot })) {
      return false
    }
  }

  if (target === 'all' || target === 'bundles') {
    for (const [label, script] of BUNDLES) {
      if (!await runner.exec(label, process.execPath, [script], { cwd: repoRoot })) {
        return false
      }
    }
  }

  return true
}

async function runTypecheckSteps(runner: CliStepRunner, target: string): Promise<boolean> {
  const tsc = localBin('tsc')

  if (target === 'all' || target === 'framework') {
    if (!await runner.exec('typecheck:framework', tsc, ['-p', 'packages/ridgetop/tsconfig.json'], { cwd: repoRoot })) {
      return false
    }
  }
  if (target === 'all' || target === 'examples') {
    for (const example of EXAMPLES) {
      if (!await runner.exec(`typecheck:${example}`, tsc, ['-p', `examples/${example}/tsconfig.json`], { cwd: repoRoot })) {
        return false
      }
    }
  } else if (isExampleName(target)) {
    if (!await runner.exec(`typecheck:${target}`, tsc, ['-p', `examples/${target}/tsconfig.json`], { cwd: repoRoot })) {
      return false
    }
  }
  if (target === 'all' || target === 'root') {
    if (!await runner.exec('typecheck:root', tsc, ['-p', 'tsconfig.json'], { cwd: repoRoot })) {
      return false
    }
  }
  return true
}

async function listUnitTests(): Promise<string[]> {
  const entries = await readdir(join(repoRoot, 'test'))
  return entries
    .filter(name => name.endsWith('.test.ts'))
    .sort()
    .map(name => join('test', name))
}

function hasExplicitTestPositionals(args: readonly string[]): boolean {
  let skipNext = false
  for (const arg of args) {
    if (skipNext) {
      skipNext = false
      continue
    }
    if (arg === '--') return true
    if (NODE_TEST_VALUE_FLAGS.has(arg)) {
      skipNext = true
      continue
    }
    if (arg.startsWith('-')) continue
    return true
  }
  return false
}

async function runBuild(args: readonly string[], ui: CliUiOptions): Promise<number> {
  const target = args[0] ?? 'all'
  if (target === '-h' || target === '--help') {
    console.log(renderHelp({
      title: 'rt build',
      usage: 'pnpm rt build [all|framework|examples|root|bundles|<example>]',
      groups: [{
        heading: 'Targets',
        items: [
          { name: 'all', summary: 'Build framework, all examples, root server/tools, and standalone HTML bundles' },
          { name: 'framework', summary: 'Build packages/ridgetop + copy CSS & chmod CLI binary' },
          { name: 'examples', summary: `Build all examples (${EXAMPLES.join(', ')})` },
          { name: 'root', summary: 'Build root tsconfig.build.json' },
          { name: 'bundles', summary: 'Build offline workshop, Signal Drift player, and low-poly model viewer' },
          { name: '<example>', summary: `Build a single example (${EXAMPLES.join(' | ')})` }
        ]
      }],
      options: []
    }, ui))
    return 0
  }

  const validTargets = new Set<string>(['all', 'framework', 'examples', 'root', 'bundles', ...EXAMPLES])
  if (!validTargets.has(target)) {
    console.error(renderError(`Unknown build target "${target}".`, ui, `Valid targets: all, framework, examples, root, bundles, ${EXAMPLES.join(', ')}`))
    return 1
  }

  const runner = new CliStepRunner(ui, `build ${target}`)
  await runBuildSteps(runner, target)
  return runner.finish()
}

async function runTypecheck(args: readonly string[], ui: CliUiOptions): Promise<number> {
  const target = args[0] ?? 'all'
  if (target === '-h' || target === '--help') {
    console.log(renderHelp({
      title: 'rt typecheck',
      usage: 'pnpm rt typecheck [all|framework|examples|root|<example>]',
      groups: [{
        heading: 'Targets',
        items: [
          { name: 'all', summary: 'Typecheck framework, all examples, and root (default)' },
          { name: 'framework', summary: 'Typecheck packages/ridgetop' },
          { name: 'examples', summary: `Typecheck all examples (${EXAMPLES.join(', ')})` },
          { name: 'root', summary: 'Typecheck root tsconfig.json' },
          { name: '<example>', summary: `Typecheck a single example (${EXAMPLES.join(' | ')})` }
        ]
      }],
      options: []
    }, ui))
    return 0
  }

  const validTargets = new Set<string>(['all', 'framework', 'examples', 'root', ...EXAMPLES])
  if (!validTargets.has(target)) {
    console.error(renderError(`Unknown typecheck target "${target}".`, ui, `Valid targets: all, framework, examples, root, ${EXAMPLES.join(', ')}`))
    return 1
  }

  const runner = new CliStepRunner(ui, `typecheck ${target}`)
  await runTypecheckSteps(runner, target)
  return runner.finish()
}

async function runLint(args: readonly string[], ui: CliUiOptions): Promise<number> {
  if (args[0] === '-h' || args[0] === '--help') {
    console.log(renderHelp({
      title: 'rt lint',
      usage: 'pnpm rt lint [oxlint-args...]',
      groups: [],
      options: []
    }, ui))
    return 0
  }
  const runner = new CliStepRunner(ui, 'lint')
  await runner.exec('lint', localBin('oxlint'), ['-c', '.oxlintrc.json', ...args], { cwd: repoRoot })
  return runner.finish()
}

async function runUnitTests(args: readonly string[], ui: CliUiOptions): Promise<number> {
  if (args[0] === '-h' || args[0] === '--help') {
    console.log(renderHelp({
      title: 'rt test',
      usage: 'pnpm rt test [test-files-or-node-test-flags...]',
      groups: [],
      options: []
    }, ui))
    return 0
  }
  const testArgs = hasExplicitTestPositionals(args)
    ? ['--test', ...args]
    : ['--test', ...args, ...await listUnitTests()]
  const runner = new CliStepRunner(ui, 'test')
  await runner.exec('unit tests', process.execPath, testArgs, { cwd: repoRoot })
  return runner.finish()
}

async function runCheck(ui: CliUiOptions): Promise<number> {
  const runner = new CliStepRunner(ui, 'check')
  if (!await runBuildSteps(runner, 'all')) return runner.finish()
  if (!await runTypecheckSteps(runner, 'all')) return runner.finish()
  if (!await runner.exec('lint', localBin('oxlint'), ['-c', '.oxlintrc.json'], { cwd: repoRoot })) {
    return runner.finish()
  }
  const testFiles = await listUnitTests()
  await runner.exec('test', process.execPath, ['--test', ...testFiles], { cwd: repoRoot })
  return runner.finish()
}

async function runServe(args: readonly string[], ui: CliUiOptions): Promise<number> {
  let runtime = 'node'
  let testing = false
  const extra: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-h' || arg === '--help') {
      console.log(renderHelp({
        title: 'rt serve',
        usage: 'pnpm rt serve [--testing] [--runtime node|bun|deno] [server-args...]',
        groups: [],
        options: [
          { name: '--testing', summary: 'Enable Testing Mode overlay & In-Game Asset Studio' },
          { name: '--runtime <name>', summary: 'Server runtime: node (default), bun, or deno' }
        ]
      }, ui))
      return 0
    }
    if (arg === '--testing') {
      testing = true
      continue
    }
    if (arg === '--runtime') {
      const next = args[i + 1]
      if (!next) {
        console.error(renderError('Missing value for --runtime.', ui, 'Use node, bun, or deno.'))
        return 1
      }
      runtime = next
      i++
      continue
    }
    if (arg.startsWith('--runtime=')) {
      runtime = arg.slice('--runtime='.length)
      continue
    }
    extra.push(arg)
  }

  const serverArgs = [...(testing ? ['--testing'] : []), ...extra]
  if (runtime === 'node') {
    const res = await runChildProcess(process.execPath, ['dist/server.js', ...serverArgs], { cwd: repoRoot, stream: true })
    return res.exitCode
  }
  if (runtime === 'bun') {
    const res = await runChildProcess('bun', ['dist/server.js', ...serverArgs], { cwd: repoRoot, stream: true })
    return res.exitCode
  }
  if (runtime === 'deno') {
    const res = await runChildProcess(
      'deno',
      ['run', '--allow-read', '--allow-write', '--allow-net', '--allow-env', 'dist/server.js', ...serverArgs],
      { cwd: repoRoot, stream: true }
    )
    return res.exitCode
  }
  console.error(renderError(`Unknown runtime "${runtime}".`, ui, 'Use node, bun, or deno.'))
  return 1
}

async function runPlaytest(args: readonly string[], ui: CliUiOptions): Promise<number> {
  if (args[0] === '-h' || args[0] === '--help') {
    console.log(renderHelp({
      title: 'rt playtest',
      usage: 'pnpm rt playtest [server-args...]',
      groups: [],
      options: []
    }, ui))
    return 0
  }
  const res = await runChildProcess(
    process.execPath,
    ['examples/starter/dist/serve.js', '--testing', ...args],
    { cwd: repoRoot, stream: true }
  )
  return res.exitCode
}

async function runSmoke(args: readonly string[], ui: CliUiOptions): Promise<number> {
  const [suite, ...rest] = args
  if (!suite || suite === '-h' || suite === '--help') {
    console.log(renderHelp({
      title: 'rt smoke',
      usage: 'pnpm rt smoke <suite> [suite-args...]',
      groups: [{
        heading: 'Suites',
        items: [
          ...Object.entries(SMOKE_SUITES).map(([name, info]) => ({ name, summary: info.summary })),
          { name: 'all', summary: 'Run all smoke suites in sequence' }
        ]
      }],
      options: []
    }, ui))
    return suite ? 0 : 1
  }

  const forward = rest[0] === '--' ? rest.slice(1) : rest
  if (suite === 'all') {
    const runner = new CliStepRunner(ui, 'smoke all')
    for (const [name, info] of Object.entries(SMOKE_SUITES)) {
      if (!await runner.exec(`smoke:${name}`, process.execPath, [info.script, ...forward], { cwd: repoRoot })) {
        return runner.finish()
      }
    }
    return runner.finish()
  }

  const entry = SMOKE_SUITES[suite]
  if (!entry) {
    console.error(renderError(`Unknown smoke suite "${suite}".`, ui, `Valid suites: ${Object.keys(SMOKE_SUITES).join(', ')}, all`))
    return 1
  }

  const runner = new CliStepRunner(ui, `smoke ${suite}`)
  await runner.exec(`smoke:${suite}`, process.execPath, [entry.script, ...forward], { cwd: repoRoot })
  return runner.finish()
}

async function runDirectScript(
  label: string,
  script: string,
  args: readonly string[],
  ui: CliUiOptions,
  opts: { readonly passthroughJson?: boolean; readonly explicitJson?: boolean } = {}
): Promise<number> {
  const forward = args[0] === '--' ? args.slice(1) : [...args]
  if ((opts.passthroughJson && opts.explicitJson) || forward.includes('--json')) {
    const childArgs = forward.includes('--json') ? forward : ['--json', ...forward]
    const res = await runChildProcess(process.execPath, [script, ...childArgs], { cwd: repoRoot, stream: true })
    return res.exitCode
  }
  const runner = new CliStepRunner(ui, label)
  await runner.exec(label, process.execPath, [script, ...forward], { cwd: repoRoot })
  return runner.finish()
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseGlobalFlags(argv, { stopAtFirstPositional: true })
  const [command, ...rest] = parsed.rest

  if (!command || command === '-h' || command === '--help') {
    console.log(renderHelp(rootHelpSpec(), parsed.ui))
    return 0
  }

  const merged = mergeCliFlags(parsed, parseGlobalFlags(rest, { stopAtFirstPositional: false }))
  const effectiveUi = merged.ui
  const effectiveArgs = merged.rest

  if (command === 'build') return runBuild(effectiveArgs, effectiveUi)
  if (command === 'typecheck') return runTypecheck(effectiveArgs, effectiveUi)
  if (command === 'lint') return runLint(effectiveArgs, effectiveUi)
  if (command === 'test') return runUnitTests(effectiveArgs, effectiveUi)
  if (command === 'check') return runCheck(effectiveUi)
  if (command === 'serve') return runServe(effectiveArgs, effectiveUi)
  if (command === 'playtest') return runPlaytest(effectiveArgs, effectiveUi)
  if (command === 'smoke') return runSmoke(effectiveArgs, effectiveUi)
  if (command === 'verify') {
    return runDirectScript('verify', 'tools/verify-game.ts', effectiveArgs, effectiveUi, {
      passthroughJson: true,
      explicitJson: merged.explicitJson
    })
  }
  if (command === 'replay-decision') return runDirectScript('replay-decision', 'tools/replay-decision.ts', effectiveArgs, effectiveUi)
  if (command === 'feel') return runDirectScript('feel', 'tools/tune-jumps.ts', effectiveArgs, effectiveUi)
  if (command === 'sprites') return runDirectScript('sprites', 'tools/generate-sprites.ts', effectiveArgs, effectiveUi)

  console.error(renderError(`Unknown rt command "${command}".`, effectiveUi, 'Run "pnpm rt --help" for usage.'))
  return 1
}

main(process.argv.slice(2))
  .then(code => {
    process.exitCode = code
  })
  .catch(error => {
    const ui = resolveErrorUi(process.argv.slice(2))
    const message = error instanceof Error ? error.message : String(error)
    console.error(renderError(message, ui))
    process.exitCode = 1
  })
