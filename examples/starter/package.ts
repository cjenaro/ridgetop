import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatPackageSummary, isMain, packageGame, parsePackageArgs } from 'ridgetop/server'

const source = import.meta.url.endsWith('.ts')
const projectDir = fileURLToPath(new URL(source ? '.' : '../', import.meta.url))

function usage() {
  console.log([
    'Usage: npm run package -- [options]',
    '',
    'Options:',
    '  --target <web|steam|mobile|godot|player|all>  Target platform(s) (default: all)',
    '  --out <directory>                  Output directory (default: dist/<target>)',
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
      const outDir = parsed.outDir
        ? resolve(parsed.outDir)
        : join(projectDir, 'dist', parsed.target === 'all' ? 'packages' : parsed.target)
      const result = await packageGame({
        target: parsed.target,
        projectDir,
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
