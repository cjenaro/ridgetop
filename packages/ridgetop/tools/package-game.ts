import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { formatPackageSummary, isMain, packageGame, parsePackageArgs } from '../framework/server.ts'

function usage() {
  console.log([
    'Usage: ridgetop package [options]',
    '',
    'Options:',
    '  --target <web|steam|mobile|godot|player|all>  Target platform(s) (default: all)',
    '  --project <directory>              Package a Ridgetop game project directory (default: cwd when no --game)',
    '  --game <name>                      Monorepo example game under examples/<name> (e.g. signal-drift, beacon-run, starter, lighthouse)',
    '  --out <directory>                  Output directory (default: dist/packages/<name>)',
    '  --name <title>                     Override app display name',
    '  --app-id <com.example.game>        Reverse-DNS bundle / application ID',
    '  --steam-app-id <id>                Steam App ID written to steam_appid.txt (default: 480)',
    '  --orientation <landscape|portrait|any>  Mobile orientation lock (default: landscape)',
    '  --background <#rrggbb>             Background color for app icons and splash screen'
  ].join('\n'))
}

async function detectRepoRoot(cwd: string): Promise<string> {
  try {
    await access(join(cwd, 'examples'))
    return cwd
  } catch {
    return cwd
  }
}

export async function runPackageCli(argv: readonly string[], cwd = process.cwd()) {
  const parsed = parsePackageArgs(argv)
  if (parsed.help) {
    usage()
    return
  }
  let projectDir = parsed.projectDir ? resolve(cwd, parsed.projectDir) : undefined
  let game = parsed.projectDir ? undefined : parsed.game
  const repoRoot = await detectRepoRoot(cwd)

  if (!projectDir && !game) {
    // If run inside a standalone project directory (has index.html or game/index.html), package cwd.
    const hasLocalIndex = await access(join(cwd, 'index.html')).then(() => true, () => false)
      || await access(join(cwd, 'game', 'index.html')).then(() => true, () => false)
    if (hasLocalIndex) {
      projectDir = cwd
    } else {
      game = 'signal-drift'
    }
  }

  const label = projectDir ? 'project' : (game ?? 'game')
  const outDir = parsed.outDir
    ? resolve(cwd, parsed.outDir)
    : join(cwd, 'dist', 'packages', parsed.target === 'all' ? label : `${label}-${parsed.target}`)

  const result = await packageGame({
    target: parsed.target,
    game,
    projectDir,
    repoRoot,
    outDir,
    name: parsed.name,
    appId: parsed.appId,
    version: parsed.version,
    steamAppId: parsed.steamAppId,
    orientation: parsed.orientation,
    backgroundColor: parsed.backgroundColor
  })
  console.log(formatPackageSummary(result, cwd))
}

if (isMain(import.meta.url)) {
  try {
    await runPackageCli(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
