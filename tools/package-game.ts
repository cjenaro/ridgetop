import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatPackageSummary, isMain, packageGame, parsePackageArgs } from '../framework/server.ts'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

function usage() {
  console.log([
    'Usage: npm run package -- [options]',
    '',
    'Options:',
    '  --target <web|steam|mobile|godot|all>  Target platform(s) (default: all)',
    '  --game <signal-drift|beacon-run|starter>  Built-in Ridgetop game (default: signal-drift)',
    '  --project <directory>              Package a generated Ridgetop game project instead of a built-in game',
    '  --out <directory>                  Output directory (default: dist/packages/<game>)',
    '  --name <title>                     Override app display name',
    '  --app-id <com.example.game>        Reverse-DNS bundle / application ID',
    '  --steam-app-id <id>                Steam App ID written to steam_appid.txt (default: 480)',
    '  --orientation <landscape|portrait|any>  Mobile orientation lock (default: landscape)',
    '  --background <#rrggbb>             Background color for app icons and splash screen'
  ].join('\n'))
}

if (isMain(import.meta.url)) {
  try {
    const parsed = parsePackageArgs(process.argv.slice(2))
    if (parsed.help) {
      usage()
    } else {
      const game = parsed.projectDir ? undefined : (parsed.game ?? 'signal-drift')
      if (game && !['signal-drift', 'beacon-run', 'starter'].includes(game)) {
        throw new Error('Unknown --game "' + game + '". Choose signal-drift, beacon-run, or starter.')
      }
      const label = parsed.projectDir ? 'custom' : game
      const outDir = parsed.outDir
        ? resolve(parsed.outDir)
        : join(repoRoot, 'dist', 'packages', parsed.target === 'all' ? label : `${label}-${parsed.target}`)
      const result = await packageGame({
        target: parsed.target,
        game,
        projectDir: parsed.projectDir,
        repoRoot,
        outDir,
        name: parsed.name,
        appId: parsed.appId,
        version: parsed.version,
        steamAppId: parsed.steamAppId,
        orientation: parsed.orientation,
        backgroundColor: parsed.backgroundColor
      })
      console.log(formatPackageSummary(result))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
