import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatPackageSummary, isMain, packageGame, parsePackageArgs } from '../framework/server.ts'
import { compileTsProjectToGodot } from './ts-to-gd.ts'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

function godotEntriesFor(game: string | undefined, projectDir: string | undefined): { rootDir: string; entries: string[] } | null {
  if (projectDir) {
    return {
      rootDir: resolve(projectDir),
      entries: [join(resolve(projectDir), 'game', 'game.js')]
    }
  }
  if (game === 'signal-drift') {
    return {
      rootDir: repoRoot,
      entries: [
        join(repoRoot, 'racing', 'race.ts'),
        join(repoRoot, 'racing', 'progression.ts'),
        join(repoRoot, 'framework', 'ui-layout.ts'),
        join(repoRoot, 'framework', 'ui-button.ts'),
        join(repoRoot, 'framework', 'ui-toggle.ts')
      ]
    }
  }
  if (game === 'beacon-run') {
    return {
      rootDir: repoRoot,
      entries: [
        join(repoRoot, 'game', 'simulation.ts'),
        join(repoRoot, 'game', 'campaign.ts'),
        join(repoRoot, 'framework', 'ui-layout.ts'),
        join(repoRoot, 'framework', 'ui-button.ts'),
        join(repoRoot, 'framework', 'ui-toggle.ts')
      ]
    }
  }
  if (game === 'starter') {
    return {
      rootDir: repoRoot,
      entries: [
        join(repoRoot, 'starter', 'game.ts'),
        join(repoRoot, 'framework', 'ui-layout.ts')
      ]
    }
  }
  return null
}

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
      for (const output of result.outputs) {
        if (output.target !== 'godot') continue
        const spec = godotEntriesFor(game, parsed.projectDir)
        if (!spec) continue
        const compiled = await compileTsProjectToGodot({
          entries: spec.entries,
          rootDir: spec.rootDir,
          outDir: join(output.dir, 'scripts', 'compiled')
        })
        console.log(`Compiled ${compiled.files.length} TypeScript module(s) -> ${join(output.dir, 'scripts', 'compiled')}`)
      }
      console.log(formatPackageSummary(result))
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
