import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createArtKit } from './art.ts'
import { createArtBuilder } from './art-builder.ts'
import { modelFromArtRecipe } from './art-recipe.ts'
import type { ArtRecipe } from './art-recipe.ts'
import { spritePartVisibility } from './art-review.ts'
import { formatPackageSummary, packageGame, parsePackageArgs } from './packager.ts'
import { encodePng } from './png.ts'
import { bakeSpritePixels } from './low-poly.ts'

export interface PreviewArtCliOptions {
  /** Override game palette instead of auto-detecting sibling game module. */
  readonly palette?: Readonly<Record<string, string>>
  /** Custom usage line printed on `--help`/`-h` or invalid arguments. */
  readonly usage?: string
  /** Base directory for resolving relative CLI paths (default: `process.cwd()`). */
  readonly cwd?: string
}

export interface ArtLibraryCliOptions {
  /** Preferred directory containing `catalog.json` and reference `.art.json` files. */
  readonly libraryDir?: string
  /** Default output directory for `start` when `[out-dir]` is omitted. */
  readonly outputDir?: string
  /** Custom usage line printed on `--help`/`-h` or invalid arguments. */
  readonly usage?: string
  /** Base directory for resolving relative CLI paths (default: `process.cwd()`). */
  readonly cwd?: string
}

export interface PackageGameCliOptions {
  /** Fixed project directory (used by project-local `package.ts` / `game/package.js` delegates). */
  readonly projectDir?: string
  /** Working directory for resolving relative paths and summary output (default: `process.cwd()`). */
  readonly cwd?: string
  /** Command label shown in `--help` output (default: `'ridgetop package'`). */
  readonly command?: string
}

interface CatalogEntry {
  readonly id: string
  readonly title: string
  readonly tags: readonly string[]
}

const packageRoot = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? '../' : '../../', import.meta.url))
const bundledLibraryDir = join(packageRoot, 'templates', 'starter', 'art', 'library')

function extractPalette(mod: unknown): Record<string, string> | undefined {
  if (typeof mod !== 'object' || mod === null || !('game' in mod)) return undefined
  const game = mod.game
  if (typeof game !== 'object' || game === null || !('palette' in game)) return undefined
  const palette = game.palette
  if (typeof palette !== 'object' || palette === null || Array.isArray(palette)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(palette)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

async function detectPalette(recipeFile: string): Promise<Record<string, string>> {
  const dir = dirname(recipeFile)
  const candidates = [
    join(dir, 'game.js'),
    join(dir, '..', 'game.js'),
    join(dir, '..', 'dist', 'game.js'),
    join(dir, '..', 'game.ts')
  ]
  for (const candidate of candidates) {
    try {
      const mod: unknown = await import(pathToFileURL(candidate).href)
      const palette = extractPalette(mod)
      if (palette) return palette
    } catch { /* Ignore missing or unimportable candidate game module. */ }
  }
  return {}
}

/** Shared CLI entry point for rendering directional sprite sheet, 8-view grid PNGs, and part-visibility JSON. */
export async function runPreviewArtCli(
  argv: readonly string[],
  options: PreviewArtCliOptions = {}
): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const usageLine = options.usage ?? 'Usage: ridgetop preview-art <recipe.art.json> [output-directory]'
  const [file, outputDirectory, ...extra] = argv
  if (!file || extra.length || file === '--help' || file === '-h') {
    console.log(usageLine)
    process.exitCode = file === '--help' || file === '-h' ? 0 : 1
    return
  }
  const resolvedFile = resolve(cwd, file)
  const source: ArtRecipe = JSON.parse(await readFile(resolvedFile, 'utf8'))
  const model = modelFromArtRecipe(source)
  const palette = options.palette ? { ...options.palette } : await detectPalette(resolvedFile)
  const kit = createArtKit({ palette, models: { subject: model } })
  const group = kit.group()
  group.add('subject', [0, 0, 0])
  const camera = { span: model.span, center: [0, model.centerY, 0] as const }
  const native = bakeSpritePixels(group.batches, { ...camera, frameSize: model.frameSize })
  const size = 128
  const large = model.frameSize === size ? native : bakeSpritePixels(group.batches, { ...camera, frameSize: size })
  const width = 4 * size
  const grid = new Uint8ClampedArray(width * 2 * size * 4)
  for (let y = 0; y < size; y++) {
    const start = y * large.width * 4
    grid.set(large.pixels.subarray(start, start + width * 4), y * width * 4)
    grid.set(large.pixels.subarray(start + width * 4, start + large.width * 4), (size + y) * width * 4)
  }
  const directory = resolve(cwd, outputDirectory ?? join(dirname(resolvedFile), 'previews'))
  await mkdir(directory, { recursive: true })
  const sheetPath = join(directory, source.name + '-sprites.png')
  const viewsPath = join(directory, source.name + '-views.png')
  const visibilityPath = join(directory, source.name + '-visibility.json')
  await writeFile(sheetPath, encodePng(native.width, native.height, native.pixels))
  await writeFile(viewsPath, encodePng(width, 2 * size, grid))
  const visibility = spritePartVisibility(kit, 'subject', model.frameSize ?? native.height)
  await writeFile(visibilityPath, JSON.stringify(visibility, null, 2) + '\n')
  console.log(native.height + ' px directional sprites: ' + sheetPath + '\nEight larger mesh views: ' + viewsPath)
  const hidden = Object.entries(visibility.parts).filter(([, counts]) => counts.every(n => n === 0)).map(([name]) => name)
  if (hidden.length) console.log('Hidden in every direction: ' + hidden.join(', '))
  console.log('Visible pixels per named part: ' + visibilityPath)
}

async function resolveLibraryDir(preferredDir: string | undefined, cwd: string): Promise<string> {
  const candidates = [
    preferredDir,
    join(cwd, 'art', 'library'),
    join(cwd, 'game', 'art', 'library'),
    bundledLibraryDir
  ]
  for (const dir of candidates) {
    if (!dir) continue
    try {
      await access(join(dir, 'catalog.json'))
      return dir
    } catch { /* Catalog not present at candidate location; try next. */ }
  }
  return bundledLibraryDir
}

/** Shared CLI entry point for browsing and deriving starter recipes from the Ridgetop art reference library. */
export async function runArtLibraryCli(
  argv: readonly string[],
  options: ArtLibraryCliOptions = {}
): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const usageLine = options.usage ?? 'Usage: ridgetop art-library list [description] | start <reference-id> <new-asset-name> [out-dir]'
  const [action = 'list', ...args] = argv
  if (action === '--help' || action === '-h') {
    console.log(usageLine)
    process.exitCode = 0
    return
  }
  const libraryDir = await resolveLibraryDir(options.libraryDir, cwd)
  const catalog: readonly CatalogEntry[] = JSON.parse(await readFile(join(libraryDir, 'catalog.json'), 'utf8'))
  if (action === 'list') {
    const query = args.join(' ').trim()
    const terms = new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    const matches = query && !terms.size ? [] : catalog.map(ref => {
      const words = new Set([...ref.id.split('-'), ...ref.tags, ...ref.title.toLowerCase().split(' ')])
      return { ref, score: [...terms].filter(word => words.has(word)).length }
    }).filter(match => !terms.size || match.score).sort((a, b) => b.score - a.score || a.ref.id.localeCompare(b.ref.id))
    for (const { ref } of matches) console.log(ref.id + '  ' + ref.title + '  (' + ref.tags.join(', ') + ')')
    if (!matches.length) console.log('No matching references. Run art-library list to browse, or start with createArtBuilder.')
  } else if (action === 'start' && (args.length === 2 || args.length === 3)) {
    const [id, name, outDirArg] = args
    const entry = catalog.find(ref => ref.id === id)
    if (!entry) throw new Error('Unknown reference ' + id)
    const reference: ArtRecipe = JSON.parse(await readFile(join(libraryDir, entry.id + '.art.json'), 'utf8'))
    const recipe = createArtBuilder(name, { reference }).finish()
    const outDir = resolve(cwd, outDirArg ?? options.outputDir ?? join(cwd, 'art'))
    await mkdir(outDir, { recursive: true })
    const destination = join(outDir, recipe.name + '.art.json')
    await writeFile(destination, JSON.stringify(recipe, null, 2) + '\n', { flag: 'wx' })
    console.log(destination + '\nParts: ' + recipe.parts.map(part => part.name).join(', '))
  } else {
    console.log(usageLine)
    process.exitCode = 1
  }
}

function formatPackageUsage(command: string, fixedProject: boolean): string {
  const lines = [
    `Usage: ${command} [options]`,
    '',
    'Options:',
    '  --target <web|steam|mobile|godot|player|all>  Target platform(s) (default: all)'
  ]
  if (!fixedProject) {
    lines.push(
      '  --project <directory>              Package a Ridgetop game project directory (default: cwd when no --game)',
      '  --game <name>                      Monorepo example game under examples/<name> (e.g. signal-drift, beacon-run, starter, lighthouse)',
      '  --out <directory>                  Output directory (default: dist/packages/<name>)'
    )
  } else {
    lines.push(
      '  --out <directory>                  Output directory (default: dist/<target>)'
    )
  }
  lines.push(
    '  --name <title>                     Override app display name',
    '  --app-id <com.example.game>        Reverse-DNS bundle / application ID',
    '  --steam-app-id <id>                Steam App ID written to steam_appid.txt (default: 480)',
    '  --orientation <landscape|portrait|any>  Mobile orientation lock (default: landscape)',
    '  --background <#rrggbb>             Background color for app icons and splash screen'
  )
  return lines.join('\n')
}

/** Shared CLI entry point for packaging a Ridgetop game project for web, Steam, mobile, Godot, or player. */
export async function runPackageGameCli(
  argv: readonly string[],
  options: PackageGameCliOptions = {}
): Promise<void> {
  const cwd = options.cwd ?? process.cwd()
  const fixedProject = Boolean(options.projectDir)
  const command = options.command ?? 'ridgetop package'
  const parsed = parsePackageArgs(argv)
  if (parsed.help) {
    console.log(formatPackageUsage(command, fixedProject))
    return
  }

  let projectDir: string | undefined
  let game: string | undefined
  let outDir: string

  if (options.projectDir) {
    projectDir = parsed.projectDir ? resolve(cwd, parsed.projectDir) : resolve(options.projectDir)
    outDir = parsed.outDir
      ? resolve(cwd, parsed.outDir)
      : join(projectDir, 'dist', parsed.target === 'all' ? 'packages' : parsed.target)
  } else {
    projectDir = parsed.projectDir ? resolve(cwd, parsed.projectDir) : undefined
    game = parsed.projectDir ? undefined : parsed.game
    if (!projectDir && !game) {
      const hasLocalIndex = await access(join(cwd, 'index.html')).then(() => true, () => false)
        || await access(join(cwd, 'game', 'index.html')).then(() => true, () => false)
      if (hasLocalIndex) {
        projectDir = cwd
      } else {
        game = 'signal-drift'
      }
    }
    const label = projectDir ? 'project' : (game ?? 'game')
    outDir = parsed.outDir
      ? resolve(cwd, parsed.outDir)
      : join(cwd, 'dist', 'packages', parsed.target === 'all' ? label : `${label}-${parsed.target}`)
  }

  const result = await packageGame({
    target: parsed.target,
    game,
    projectDir,
    repoRoot: cwd,
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
