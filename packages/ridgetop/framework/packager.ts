import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { join as posixJoin } from 'node:path/posix'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ArtModel, ArtRecipe } from './art.ts'
import type { InstanceBatch } from './types.ts'
import { createArtKit, modelFromArtRecipe } from './art.ts'
import { exportGodotProject, loadGodotCompiler, resolveGodotCompilerPath } from './export-godot.ts'
import { multiply, orthographic, view } from './geometry.ts'
import { renderMeshPixels } from './low-poly.ts'
import { BLOCKED_STUDIO_DIRS, BLOCKED_STUDIO_FILES, lookupAssetMime } from './manifest.ts'
import type { BundleStandaloneHtmlOptions, EmbeddedAssetEntry, ShakeModuleGraphOptions } from './module-bundle.ts'
import {
  bundleStandaloneHtml,
  findLocalStylesheetPaths,
  findModuleEntryScript,
  getHtmlAttr,
  isExternalUrl,
  normalizeAssetPath,
  shakeModuleGraph
} from './module-bundle.ts'
import { encodePng } from './png.ts'
import { color } from './renderer.ts'
import { MOBILE_EXTRA_HEAD, emitMobileShell } from './target-mobile.ts'
import { emitSteamShell } from './target-steam.ts'

export { bundleStandaloneHtml, shakeModuleGraph }
export type { BundleStandaloneHtmlOptions, EmbeddedAssetEntry, ShakeModuleGraphOptions }

export type PackageTarget = 'web' | 'steam' | 'mobile' | 'godot' | 'player' | 'all'
export type PackageOrientation = 'landscape' | 'portrait' | 'any'

export interface RidgetopProjectConfig {
  /** Display name for desktop windows, installers, mobile app, and Godot project. */
  name?: string
  /** Optional default reverse-DNS bundle identifier. */
  appId?: string
  /** Relative path to the entry HTML file inside the project (default: `game/index.html` if present, else `index.html`). */
  html?: string
  /** Relative directory containing compiled browser JS modules (default: `dist` if present, else the HTML directory). */
  moduleRoot?: string
  /** Relative JS entry module path under `moduleRoot` (default: detected from `<script type="module" src="...">` in HTML). */
  entry?: string
  /** Explicit static directories to copy into the bundle (e.g. `['game/assets']` or `['art']`). */
  staticDirs?: readonly string[]
  /** Explicit static files to copy into the bundle (e.g. `['game-ui.css']`). */
  staticFiles?: readonly string[]
  /** Optional per-module literal string rewrites applied during bundling (e.g. rewriting root-relative asset URLs to `./`). */
  assetPathRewrites?: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Optional path to a compiled JS module exporting `resolvePackageAssets()` for custom icon/Godot models & audio. */
  assetsModule?: string
  /** Optional relative path to a project-owned GDScript host file written to Godot `scripts/main.gd`. */
  godotMain?: string
  /** Optional list of TypeScript/JS entry files (or bare `'ridgetop/*'` specifiers) compiled to GDScript for Godot exports. */
  godotEntries?: readonly string[]
  /** Optional relative path inside the web bundle to reset to `{}\n` (e.g. `art/overrides.json`). */
  overridesReset?: string
}

export interface PackageGameOptions {
  target: PackageTarget
  outDir: string
  /** Monorepo example game name (resolved to `<repoRoot>/examples/<game>`) when `projectDir` is omitted. */
  game?: string
  /** Path to any standalone Ridgetop game project directory (workspace package, external repo, or `ridgetop create` project). */
  projectDir?: string
  /** Optional workspace checkout root used to resolve `examples/<game>` when `game` is supplied. */
  repoRoot?: string
  /** Display name for the desktop window, installers, mobile app, and Godot project. */
  name?: string
  /** Reverse-DNS app identifier (e.g. `com.ridgetop.signaldrift`). */
  appId?: string
  /** Package version (defaults to `1.0.0` or the project's package.json version). */
  version?: string
  /** Steam App ID written to `steam_appid.txt` (defaults to `480` for local Steamworks dev testing). */
  steamAppId?: string
  /** Mobile orientation lock preference (`landscape`, `portrait`, or `any`). */
  orientation?: PackageOrientation
  /** Optional custom 3D batches for icon baking instead of the auto-detected game model. */
  iconBatches?: { batches: readonly InstanceBatch[]; span: number; centerY: number }
  /** Optional hex background color for app icons and splash screens. */
  backgroundColor?: string
}

export interface PackagedOutput {
  target: 'web' | 'steam' | 'mobile' | 'godot' | 'player'
  dir: string
  wwwDir?: string
  iconPath?: string
  playerPath?: string
  files: number
  totalBytes: number
}

export interface PackageResult {
  name: string
  slug: string
  appId: string
  outputs: PackagedOutput[]
}

export interface ResolvedGameAssets {
  title?: string
  icon: { batches: readonly InstanceBatch[]; span: number; centerY: number; background: string; accent: string }
  models: Record<string, readonly InstanceBatch[]>
  audio: Record<string, { notes: readonly (readonly [number, number, number, number?])[]; waveform?: 'sine' | 'triangle' | 'square' | 'sawtooth' }>
  gameData: Record<string, unknown>
  /** Optional project-supplied GDScript source written to Godot `scripts/main.gd` instead of the generic host. */
  mainScript?: string
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ridgetop-game'
}

function defaultAppId(slug: string) {
  const clean = slug.replace(/[^a-z0-9]/g, '') || 'game'
  return 'com.ridgetop.' + (/^[a-z]/.test(clean) ? clean : 'game' + clean)
}

function parseHexRgb(hex: string): [number, number, number] {
  const [r, g, b] = color(hex)
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function escapeHtmlAttr(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function ensureMobileMeta(html: string, themeColor: string, extraHead = '') {
  let out = html
  if (/<meta name="viewport"[^>]*>/i.test(out)) {
    out = out.replace(/<meta name="viewport"[^>]*>/i,
      () => '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
  } else {
    out = out.replace(/<head>/i,
      () => '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
  }
  if (!/<meta name="theme-color"/i.test(out)) {
    const safeColor = escapeHtmlAttr(themeColor)
    out = out.replace(/<\/head>/i, () => `  <meta name="theme-color" content="${safeColor}">\n</head>`)
  }
  if (extraHead) {
    out = out.replace(/<\/head>/i, () => `${extraHead}\n</head>`)
  }
  return out
}

function resolveContained(baseDir: string, relPath: string, label: string): string {
  const base = resolve(baseDir)
  const target = resolve(base, relPath)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`${label} escapes project root: ${relPath}`)
  }
  return target
}

/** Bake a crisp PNG app icon or splash screen from a 3D Ridgetop model without external image tools. */
export function bakeIconPng({
  batches, span = 1.6, centerY = 0.5, size = 512,
  background = '#142431', accent = '#24414b', modelScale = 0.78, elevation = Math.PI / 7, azimuth = Math.PI / 4
}: {
  batches: readonly InstanceBatch[]
  span?: number
  centerY?: number
  size?: number
  background?: string
  accent?: string
  modelScale?: number
  elevation?: number
  azimuth?: number
}): Buffer {
  const [bgR, bgG, bgB] = parseHexRgb(background)
  const [acR, acG, acB] = parseHexRgb(accent)
  const pixels = new Uint8ClampedArray(size * size * 4)

  const half = (size - 1) / 2
  const maxDist = Math.hypot(half, half) || 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.min(1, Math.hypot(x - half, y - half) / maxDist)
      const glow = Math.pow(1 - dist, 1.8)
      const i = (y * size + x) * 4
      pixels[i] = Math.min(255, Math.round(bgR + (acR - bgR) * glow * 0.75))
      pixels[i + 1] = Math.min(255, Math.round(bgG + (acG - bgG) * glow * 0.75))
      pixels[i + 2] = Math.min(255, Math.round(bgB + (acB - bgB) * glow * 0.75))
      pixels[i + 3] = 255
    }
  }

  const renderSize = Math.max(32, Math.round(size * modelScale))
  const effectiveSpan = Math.max(0.2, span) * 1.15
  const projection = orthographic(effectiveSpan, effectiveSpan, effectiveSpan / 100, effectiveSpan * 8)
  const radius = effectiveSpan * 4
  const horizontal = radius * Math.cos(elevation)
  const camera = multiply(
    projection,
    view([horizontal * Math.sin(azimuth), centerY + radius * Math.sin(elevation), horizontal * Math.cos(azimuth)], [0, centerY, 0])
  )
  const sprite = renderMeshPixels(camera, batches, renderSize)
  const offsetX = Math.floor((size - renderSize) / 2)
  const offsetY = Math.floor((size - renderSize) / 2)

  for (let sy = 0; sy < renderSize; sy++) {
    const dy = offsetY + sy
    if (dy < 0 || dy >= size) continue
    for (let sx = 0; sx < renderSize; sx++) {
      const dx = offsetX + sx
      if (dx < 0 || dx >= size) continue
      const src = (sy * renderSize + sx) * 4
      if (!sprite.pixels[src + 3]) continue
      const shadowY = dy + Math.max(2, Math.round(size * 0.025))
      if (shadowY < size) {
        const sh = (shadowY * size + dx) * 4
        pixels[sh] = Math.round(pixels[sh] * 0.62)
        pixels[sh + 1] = Math.round(pixels[sh + 1] * 0.62)
        pixels[sh + 2] = Math.round(pixels[sh + 2] * 0.62)
      }
    }
  }
  for (let sy = 0; sy < renderSize; sy++) {
    const dy = offsetY + sy
    if (dy < 0 || dy >= size) continue
    for (let sx = 0; sx < renderSize; sx++) {
      const dx = offsetX + sx
      if (dx < 0 || dx >= size) continue
      const src = (sy * renderSize + sx) * 4
      const alpha = sprite.pixels[src + 3] / 255
      if (alpha <= 0) continue
      const dst = (dy * size + dx) * 4
      const inv = 1 - alpha
      pixels[dst] = Math.round(sprite.pixels[src] * alpha + pixels[dst] * inv)
      pixels[dst + 1] = Math.round(sprite.pixels[src + 1] * alpha + pixels[dst + 1] * inv)
      pixels[dst + 2] = Math.round(sprite.pixels[src + 2] * alpha + pixels[dst + 2] * inv)
      pixels[dst + 3] = 255
    }
  }
  return encodePng(size, size, pixels)
}

function resolvePackageFrameworkDir(): string {
  if (import.meta.url.endsWith('.ts')) {
    return resolve(fileURLToPath(new URL('../dist/framework', import.meta.url)))
  }
  return resolve(fileURLToPath(new URL('.', import.meta.url)))
}

function resolvePackageRootDir(): string {
  if (import.meta.url.endsWith('.ts')) {
    return resolve(fileURLToPath(new URL('..', import.meta.url)))
  }
  const parentTwo = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  if (existsSync(join(parentTwo, 'package.json'))) return parentTwo
  return resolve(fileURLToPath(new URL('..', import.meta.url)))
}

async function measureDirectory(dir: string): Promise<{ files: number; totalBytes: number }> {
  let files = 0
  let totalBytes = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = await measureDirectory(full)
      files += sub.files
      totalBytes += sub.totalBytes
    } else if (entry.isFile()) {
      files++
      totalBytes += (await stat(full)).size
    }
  }
  return { files, totalBytes }
}

async function resolveTargetProjectDir(options: PackageGameOptions): Promise<string> {
  if (options.projectDir) return resolve(options.projectDir)
  if (!options.game) {
    throw new Error('Specify --project <directory> (or --game <example-name> inside a Ridgetop monorepo).')
  }
  const candidates: string[] = []
  if (options.repoRoot) candidates.push(join(resolve(options.repoRoot), 'examples', options.game))
  candidates.push(join(process.cwd(), 'examples', options.game))
  candidates.push(resolve(resolvePackageRootDir(), '..', '..', 'examples', options.game))
  for (const dir of candidates) {
    if (existsSync(dir)) return dir
  }
  throw new Error(`Could not locate example game "${options.game}" under examples/. Pass --project <directory> for external projects.`)
}

async function loadProjectConfig(projectDir: string): Promise<{ config: RidgetopProjectConfig; version?: string }> {
  let config: RidgetopProjectConfig = {}
  let version: string | undefined
  try {
    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'))
    if (pkg.version) version = String(pkg.version)
    if (pkg.ridgetop && typeof pkg.ridgetop === 'object') config = { ...pkg.ridgetop }
  } catch { /* Ignore missing or unreadable package.json. */ }
  try {
    const fileConfig = JSON.parse(await readFile(join(projectDir, 'ridgetop.package.json'), 'utf8'))
    if (fileConfig && typeof fileConfig === 'object') config = { ...config, ...fileConfig }
  } catch { /* Ignore missing or unreadable ridgetop.package.json. */ }
  return { config, version }
}

function detectProjectLayout(projectDir: string, config: RidgetopProjectConfig) {
  const htmlRel = config.html ?? (existsSync(join(projectDir, 'game', 'index.html')) ? 'game/index.html' : 'index.html')
  const htmlPath = join(projectDir, htmlRel)
  const htmlDir = dirname(htmlPath)
  const isCreateGameLayout = htmlRel === 'game/index.html'
  const moduleDir = config.moduleRoot
    ? join(projectDir, config.moduleRoot)
    : (!isCreateGameLayout && existsSync(join(projectDir, 'dist')) ? join(projectDir, 'dist') : htmlDir)
  return { htmlRel, htmlPath, htmlDir, isCreateGameLayout, moduleDir }
}

async function resolveGodotMainScript(projectDir: string, config: RidgetopProjectConfig): Promise<string | undefined> {
  if (config.godotMain) {
    const mainPath = resolveContained(projectDir, config.godotMain, 'godotMain')
    return await readFile(mainPath, 'utf8')
  }
  const defaultMain = join(projectDir, 'godot-main.gd')
  if (existsSync(defaultMain)) {
    return await readFile(defaultMain, 'utf8')
  }
  return undefined
}

async function resolveProjectAssets(projectDir: string, config: RidgetopProjectConfig): Promise<ResolvedGameAssets> {
  if (config.assetsModule) {
    const modPath = resolve(projectDir, config.assetsModule)
    try {
      const mod = await import(pathToFileURL(modPath).href)
      if (typeof mod.resolvePackageAssets === 'function') {
        const resolved: ResolvedGameAssets = await mod.resolvePackageAssets({ projectDir })
        if (!resolved.mainScript && config.godotMain) {
          return { ...resolved, mainScript: await resolveGodotMainScript(projectDir, config) }
        }
        return resolved
      }
      throw new Error(`Expected resolvePackageAssets() export in ${config.assetsModule}`)
    } catch (error) {
      throw new Error(`Failed to load project assets from ${config.assetsModule}. Build the project first: ` + (error instanceof Error ? error.message : String(error)))
    }
  }

  const layout = detectProjectLayout(projectDir, config)
  const gameModuleCandidates = [
    join(layout.moduleDir, 'game.js'),
    join(layout.htmlDir, 'game.js'),
    join(projectDir, 'game', 'game.js')
  ]
  const artBaseDir = layout.isCreateGameLayout ? layout.htmlDir : projectDir

  let title: string | undefined = config.name
  let palette: Record<string, string> = {}
  let customModels: Record<string, ArtModel> = {}
  let modelFiles: Record<string, string> = {}
  let gameConfig: Record<string, unknown> = {}
  let iconRole = 'ranger'
  const roles = new Set<string>(['ranger', 'tile', 'crystal', 'lantern', 'pine', 'rock', 'crate'])

  for (const candidate of gameModuleCandidates) {
    if (!existsSync(candidate)) continue
    try {
      const mod = await import(pathToFileURL(candidate).href + '?t=' + Date.now())
      if (mod.game && typeof mod.game === 'object') {
        gameConfig = { ...mod.game }
        if (mod.game.title) title = String(mod.game.title)
        if (mod.game.palette) palette = { ...mod.game.palette }
        iconRole = mod.game.player ?? mod.game.pickup ?? 'ranger'
        roles.clear()
        for (const r of [mod.game.player, mod.game.ground, mod.game.pickup, mod.game.goal, mod.game.effect, ...Object.values(mod.game.scenery ?? {})]) {
          if (typeof r === 'string') roles.add(r)
        }
      }
      if (mod.models) customModels = { ...mod.models }
      if (mod.modelFiles) modelFiles = { ...mod.modelFiles }
      break
    } catch { /* Fall back to default art kit. */ }
  }

  let overrides: Record<string, ArtRecipe> = {}
  try { overrides = JSON.parse(await readFile(join(artBaseDir, 'art', 'overrides.json'), 'utf8')) } catch { /* No art overrides file present. */ }

  const loadedModels: Record<string, ArtModel> = {}
  for (const [name, relPath] of Object.entries(modelFiles)) {
    try { loadedModels[name] = modelFromArtRecipe(JSON.parse(await readFile(join(artBaseDir, relPath), 'utf8'))) } catch { /* Skip unreadable or invalid art recipe file. */ }
  }
  const edited: Record<string, ArtModel> = {}
  for (const [name, recipe] of Object.entries(overrides)) {
    try { edited[name] = modelFromArtRecipe(recipe) } catch { /* Skip invalid override art recipe. */ }
  }

  const kit = createArtKit<string>({ palette, models: { ...edited, ...customModels, ...loadedModels } })
  const models: Record<string, readonly InstanceBatch[]> = {}
  for (const role of roles) {
    if (!kit.model(role)) continue
    const group = kit.group()
    group.add(role, [0, 0, 0])
    models[role] = group.batches
  }
  const chosen = kit.model(iconRole) ? iconRole : 'ranger'
  const model = kit.model(chosen)
  const iconGroup = kit.group()
  iconGroup.add(chosen, [0, 0, 0])

  return {
    title,
    icon: {
      batches: iconGroup.batches,
      span: model.span,
      centerY: model.centerY,
      background: '#142629',
      accent: palette.leaf ?? palette.glow ?? '#2f5e57'
    },
    models,
    audio: {
      pickup: { notes: [[660, .12, 0], [880, .16, .08]], waveform: 'sine' },
      victory: { notes: [[392, .16, 0], [523.25, .16, .11], [659.25, .24, .22]], waveform: 'triangle' }
    },
    gameData: gameConfig,
    mainScript: await resolveGodotMainScript(projectDir, config)
  }
}

function rewriteFrameworkImports(relPath: string, code: string) {
  if (relPath.startsWith('framework/')) return code
  const depth = relPath.split('/').length - 1
  const expectedPrefix = '../'.repeat(depth + 1) + 'framework/'
  const targetPrefix = (depth === 0 ? './' : '../'.repeat(depth)) + 'framework/'
  return code
    .replaceAll(`'${expectedPrefix}`, `'${targetPrefix}`)
    .replaceAll(`"${expectedPrefix}`, `"${targetPrefix}`)
}

const skippedProjectRootFiles = new Set([
  'index.html', 'package.json', 'package-lock.json', 'pnpm-lock.yaml',
  'tsconfig.json', 'tsconfig.build.json', 'ridgetop.package.json',
  'README.md', 'AGENTS.md', 'ART.md'
])

function normalizeStandaloneHtmlPaths(html: string): string {
  return html
    .replace(/\s+data-hosted="1"/g, '')
    .replace(/\b(href|src)=(")\/(?!\/)/g, '$1=$2./')
    .replace(/\b(href|src)=(')\/(?!\/)/g, '$1=$2./')
}

type StaticFileSource =
  | { readonly kind: 'file'; readonly srcPath: string }
  | { readonly kind: 'buffer'; readonly data: Buffer }

interface PreparedWebProject {
  layout: ReturnType<typeof detectProjectLayout>
  html: string
  entry: string
  staticFiles: Map<string, StaticFileSource>
  detectedName?: string
  readModule(relPath: string): Promise<string>
  rewriteSource(relPath: string, code: string): string
}

async function collectFilteredDir(
  srcDir: string,
  relBase: string,
  out: Map<string, StaticFileSource>,
  { skipJs = false } = {}
) {
  for (const entry of await readdir(srcDir, { withFileTypes: true })) {
    const full = join(srcDir, entry.name)
    const rel = relBase ? posixJoin(relBase, entry.name) : entry.name
    if (entry.isDirectory()) {
      if (BLOCKED_STUDIO_DIRS.has(entry.name)) continue
      await collectFilteredDir(full, rel, out, { skipJs })
    } else if (entry.isFile()) {
      if (BLOCKED_STUDIO_FILES.has(entry.name)) continue
      if (skipJs && entry.name.endsWith('.js')) continue
      out.set(normalizeAssetPath(rel), { kind: 'file', srcPath: full })
    }
  }
}

async function prepareWebProject(
  projectDir: string,
  config: RidgetopProjectConfig,
  { themeColor, extraHead = '' }: { themeColor: string; extraHead?: string }
): Promise<PreparedWebProject> {
  const layout = detectProjectLayout(projectDir, config)
  await access(layout.htmlPath).catch(() => {
    throw new Error(`Expected ${layout.htmlRel} inside project directory: ${projectDir}`)
  })

  const localFrameworkDir = join(projectDir, 'framework')
  const frameworkDir = existsSync(join(localFrameworkDir, 'index.js'))
    ? localFrameworkDir
    : resolvePackageFrameworkDir()
  await access(join(frameworkDir, 'index.js')).catch(() => {
    throw new Error('Built Ridgetop framework modules were not found. Run pnpm run build first.')
  })

  const rawHtml = await readFile(layout.htmlPath, 'utf8')
  const normalizedHtml = normalizeStandaloneHtmlPaths(rawHtml)
  const html = ensureMobileMeta(normalizedHtml, themeColor, extraHead)

  const staticFiles = new Map<string, StaticFileSource>()
  if (config.staticFiles?.length || config.staticDirs?.length) {
    for (const relFile of config.staticFiles ?? []) {
      const src = resolveContained(projectDir, relFile, 'staticFile')
      const norm = normalizeAssetPath(relFile)
      if (!norm || norm === '..' || norm.startsWith('../')) {
        throw new Error(`staticFile escapes project root: ${relFile}`)
      }
      staticFiles.set(norm, { kind: 'file', srcPath: src })
    }
    for (const relDir of config.staticDirs ?? []) {
      const srcDir = resolveContained(projectDir, relDir, 'staticDir')
      const normDir = normalizeAssetPath(relDir)
      if (!normDir || normDir === '..' || normDir.startsWith('../')) {
        throw new Error(`staticDir escapes project root: ${relDir}`)
      }
      await collectFilteredDir(srcDir, normDir, staticFiles)
    }
    // Also include any local stylesheet or icon linked from index.html if not already listed.
    for (const match of normalizedHtml.matchAll(/<link\b([^>]*)>/gi)) {
      const attrs = match[1]
      const rel = (getHtmlAttr(attrs, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const href = getHtmlAttr(attrs, 'href')
      if (!href || isExternalUrl(href)) continue
      if (!rel.includes('stylesheet') && !rel.includes('icon') && !rel.includes('apple-touch-icon')) continue
      const normHref = normalizeAssetPath(href)
      if (!normHref || normHref === '..' || normHref.startsWith('../')) {
        throw new Error(`Linked asset escapes project root: ${href}`)
      }
      if (staticFiles.has(normHref)) continue
      const src = resolveContained(layout.htmlDir, normHref, 'linked asset')
      if (existsSync(src)) {
        staticFiles.set(normHref, { kind: 'file', srcPath: src })
      }
    }
  } else {
    for (const entry of await readdir(layout.htmlDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (BLOCKED_STUDIO_DIRS.has(entry.name) || entry.name === 'framework') continue
        await collectFilteredDir(join(layout.htmlDir, entry.name), entry.name, staticFiles, { skipJs: true })
      } else if (
        entry.isFile() &&
        !entry.name.endsWith('.js') &&
        !entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.map') &&
        !skippedProjectRootFiles.has(entry.name) &&
        !BLOCKED_STUDIO_FILES.has(entry.name)
      ) {
        staticFiles.set(normalizeAssetPath(entry.name), { kind: 'file', srcPath: join(layout.htmlDir, entry.name) })
      }
    }
  }

  if (config.overridesReset) {
    resolveContained(projectDir, config.overridesReset, 'overridesReset')
    const normReset = normalizeAssetPath(config.overridesReset)
    if (!normReset || normReset === '..' || normReset.startsWith('../')) {
      throw new Error(`overridesReset escapes project root: ${config.overridesReset}`)
    }
    staticFiles.set(normReset, { kind: 'buffer', data: Buffer.from('{}\n', 'utf8') })
  }

  let detectedName: string | undefined = config.name
  if (!detectedName) {
    for (const candidate of [join(layout.moduleDir, 'game.js'), join(layout.htmlDir, 'game.js')]) {
      if (!existsSync(candidate)) continue
      try {
        const mod = await import(pathToFileURL(candidate).href + '?n=' + Date.now())
        if (mod.game?.title) { detectedName = String(mod.game.title); break }
      } catch { /* Ignore unimportable candidate game module. */ }
    }
  }

  const entry = config.entry ?? findModuleEntryScript(normalizedHtml)
  const readModule = (relPath: string) => {
    const filePath = relPath.startsWith('framework/')
      ? resolveContained(frameworkDir, relPath.slice('framework/'.length), 'framework module')
      : resolveContained(layout.moduleDir, relPath, 'module')
    return readFile(filePath, 'utf8')
  }
  const rewriteSource = (relPath: string, code: string) => {
    let out = layout.isCreateGameLayout ? rewriteFrameworkImports(relPath, code) : code
    const rewrites = config.assetPathRewrites?.[relPath]
    if (rewrites) {
      for (const [from, to] of Object.entries(rewrites)) {
        out = out.replaceAll(from, to)
      }
    }
    return out
  }

  return { layout, html, entry, staticFiles, detectedName, readModule, rewriteSource }
}

async function assembleWebBundle(
  projectDir: string,
  config: RidgetopProjectConfig,
  wwwDir: string,
  { themeColor, extraHead = '' }: { themeColor: string; extraHead?: string }
): Promise<{ detectedName?: string }> {
  const prepared = await prepareWebProject(projectDir, config, { themeColor, extraHead })

  await rm(wwwDir, { recursive: true, force: true })
  await mkdir(wwwDir, { recursive: true })
  await writeFile(join(wwwDir, 'index.html'), prepared.html)

  for (const [relPath, source] of prepared.staticFiles) {
    const dst = resolveContained(wwwDir, relPath, 'static asset')
    await mkdir(dirname(dst), { recursive: true })
    if (source.kind === 'buffer') {
      await writeFile(dst, source.data)
    } else {
      await cp(source.srcPath, dst)
    }
  }

  const modules = await shakeModuleGraph({
    entry: prepared.entry,
    readModule: prepared.readModule,
    rewriteSource: prepared.rewriteSource,
    stripStudio: true
  })

  for (const [relPath, code] of modules) {
    const dst = resolveContained(wwwDir, relPath, 'module')
    await mkdir(dirname(dst), { recursive: true })
    await writeFile(dst, code)
  }

  return { detectedName: prepared.detectedName }
}

async function tryCompileGodotScripts(projectDir: string, config: RidgetopProjectConfig, godotDir: string): Promise<number> {
  const hasExplicitEntries = Boolean(config.godotEntries?.length)
  if (!hasExplicitEntries && !resolveGodotCompilerPath({ projectDir })) return 0

  let entries: string[] = []
  if (config.godotEntries?.length) {
    entries = config.godotEntries.map(entry =>
      entry === 'ridgetop' || entry.startsWith('ridgetop/') ? entry : join(projectDir, entry)
    )
  } else {
    for (const candidate of [join(projectDir, 'game', 'game.js'), join(projectDir, 'game.ts'), join(projectDir, 'game.js')]) {
      if (existsSync(candidate)) { entries = [candidate]; break }
    }
  }
  if (!entries.length) return 0

  const compiledDir = join(godotDir, 'scripts', 'compiled')
  try {
    const { compileTsProjectToGodot } = await loadGodotCompiler({ projectDir })
    const compiled = await compileTsProjectToGodot({
      entries,
      rootDir: projectDir,
      outDir: compiledDir
    })
    return Array.isArray(compiled?.files) ? compiled.files.length : 0
  } catch (error) {
    await rm(compiledDir, { recursive: true, force: true }).catch(() => { /* Ignore cleanup error. */ })
    const message = error instanceof Error ? error.message : String(error)
    if (hasExplicitEntries) {
      throw new Error(`Failed to compile configured godotEntries: ${message}`, { cause: error })
    }
    console.warn(`[ridgetop/packager] Skipping optional auto-detected Godot script compilation: ${message}`)
    return 0
  }
}

export async function packageGame(options: PackageGameOptions): Promise<PackageResult> {
  const targets: ('web' | 'steam' | 'mobile' | 'godot' | 'player')[] = options.target === 'all'
    ? ['web', 'steam', 'mobile', 'godot']
    : [options.target]
  const outRoot = resolve(options.outDir)
  const projectDir = await resolveTargetProjectDir(options)
  const { config, version: detectedVersion } = await loadProjectConfig(projectDir)
  const projectVersion = options.version ?? detectedVersion ?? '1.0.0'

  const assets = await resolveProjectAssets(projectDir, config)

  const iconSource = options.iconBatches
    ? { ...options.iconBatches, background: options.backgroundColor ?? '#142431', accent: '#2a5652' }
    : assets.icon
  const themeColor = options.backgroundColor ?? iconSource.background
  const steamAppId = options.steamAppId ?? '480'
  const orientation = options.orientation ?? 'landscape'
  const outputs: PackagedOutput[] = []
  const fallbackName = basename(projectDir)
  let resolvedName = options.name ?? config.name ?? assets.title ?? fallbackName
  let resolvedSlug = slugify(resolvedName)
  let resolvedAppId = options.appId ?? config.appId ?? defaultAppId(resolvedSlug)

  const iconCache = new Map<string, Buffer>()
  function getIconPng(size: number, modelScale = 0.78) {
    const key = `${size}:${modelScale}`
    let png = iconCache.get(key)
    if (!png) {
      png = bakeIconPng({
        batches: iconSource.batches,
        span: iconSource.span,
        centerY: iconSource.centerY,
        size,
        background: themeColor,
        accent: iconSource.accent,
        modelScale
      })
      iconCache.set(key, png)
    }
    return png
  }

  let baseWebBundleDir: string | null = null
  let baseDetectedName: string | undefined
  async function populateWebBundle(destDir: string, extraHead = ''): Promise<{ detectedName?: string }> {
    if (!baseWebBundleDir) {
      const result = await assembleWebBundle(projectDir, config, destDir, { themeColor, extraHead })
      if (!extraHead) {
        baseWebBundleDir = destDir
        baseDetectedName = result.detectedName
      }
      return result
    }
    await rm(destDir, { recursive: true, force: true })
    await cp(baseWebBundleDir, destDir, { recursive: true })
    if (extraHead) {
      const htmlPath = join(destDir, 'index.html')
      const baseHtml = await readFile(htmlPath, 'utf8')
      await writeFile(htmlPath, ensureMobileMeta(baseHtml, themeColor, extraHead))
    }
    return { detectedName: baseDetectedName }
  }

  function applyResolvedIdentity(detectedName: string | undefined) {
    resolvedName = options.name ?? config.name ?? detectedName ?? assets.title ?? fallbackName
    resolvedSlug = slugify(resolvedName)
    resolvedAppId = options.appId ?? config.appId ?? defaultAppId(resolvedSlug)
  }

  for (const target of targets) {
    const dir = options.target === 'all' ? join(outRoot, target) : outRoot
    await mkdir(dir, { recursive: true })

    if (target === 'web') {
      const { detectedName } = await populateWebBundle(dir)
      applyResolvedIdentity(detectedName)
      const stats = await measureDirectory(dir)
      outputs.push({ target, dir, wwwDir: dir, ...stats })
    } else if (target === 'steam') {
      const wwwDir = join(dir, 'www')
      const { detectedName } = await populateWebBundle(wwwDir)
      applyResolvedIdentity(detectedName)
      const { iconPath } = await emitSteamShell({
        dir,
        name: resolvedName,
        slug: resolvedSlug,
        appId: resolvedAppId,
        version: projectVersion,
        steamAppId,
        iconPng: getIconPng(512)
      })
      const stats = await measureDirectory(wwwDir)
      outputs.push({ target, dir, wwwDir, iconPath, ...stats })
    } else if (target === 'mobile') {
      const wwwDir = join(dir, 'www')
      const { detectedName } = await populateWebBundle(wwwDir, MOBILE_EXTRA_HEAD)
      applyResolvedIdentity(detectedName)
      const { iconPath } = await emitMobileShell({
        dir,
        wwwDir,
        name: resolvedName,
        slug: resolvedSlug,
        appId: resolvedAppId,
        version: projectVersion,
        themeColor,
        orientation,
        iconPng: getIconPng(1024),
        splashPng: getIconPng(1024, 0.44)
      })
      const stats = await measureDirectory(wwwDir)
      outputs.push({ target, dir, wwwDir, iconPath, ...stats })
    } else if (target === 'player') {
      // Pure in-memory standalone bundling — zero temp-directory staging round-trip!
      const prepared = await prepareWebProject(projectDir, config, { themeColor })
      applyResolvedIdentity(prepared.detectedName)

      const linkedStyles = findLocalStylesheetPaths(prepared.html)
      const embeddedAssets: Record<string, EmbeddedAssetEntry> = {}
      for (const [rel, source] of prepared.staticFiles) {
        if (rel === 'index.html' || linkedStyles.has(rel)) continue
        const ext = extname(rel).toLowerCase()
        if (ext === '.js' || ext === '.mjs' || ext === '.map') continue
        const bytes = source.kind === 'buffer' ? source.data : await readFile(source.srcPath)
        embeddedAssets[rel] = {
          mime: lookupAssetMime(ext),
          base64: bytes.toString('base64')
        }
      }

      const playerHtml = await bundleStandaloneHtml({
        html: prepared.html,
        stripStudio: true,
        readAsset: async relPath => {
          const norm = normalizeAssetPath(relPath)
          const staged = prepared.staticFiles.get(norm)
          if (staged) {
            return staged.kind === 'buffer' ? staged.data.toString('utf8') : await readFile(staged.srcPath, 'utf8')
          }
          return readFile(resolveContained(prepared.layout.htmlDir, norm, 'asset'), 'utf8')
        },
        readModule: prepared.readModule,
        rewriteSource: prepared.rewriteSource,
        embeddedAssets
      })

      const playerDir = basename(outRoot) === 'player' ? outRoot : join(outRoot, 'player')
      await rm(playerDir, { recursive: true, force: true })
      await mkdir(playerDir, { recursive: true })
      const playerPath = join(playerDir, `${resolvedSlug}-player.html`)
      await writeFile(playerPath, playerHtml, 'utf8')
      outputs.push({
        target,
        dir: playerDir,
        playerPath,
        files: 1,
        totalBytes: Buffer.byteLength(playerHtml, 'utf8')
      })
    } else {
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
      const iconPng = getIconPng(512)
      await exportGodotProject({
        outDir: dir,
        name: resolvedName,
        slug: resolvedSlug,
        models: assets.models,
        audio: assets.audio,
        gameData: assets.gameData,
        mainScript: assets.mainScript,
        iconPng
      })
      await tryCompileGodotScripts(projectDir, config, dir)
      const stats = await measureDirectory(dir)
      outputs.push({ target, dir, iconPath: join(dir, 'icon.png'), ...stats })
    }
  }

  return { name: resolvedName, slug: resolvedSlug, appId: resolvedAppId, outputs }
}

function parsePackageTarget(value: string): PackageTarget | null {
  switch (value) {
    case 'web':
    case 'steam':
    case 'mobile':
    case 'godot':
    case 'player':
    case 'all':
      return value
    default:
      return null
  }
}

function parsePackageOrientation(value: string): PackageOrientation | null {
  switch (value) {
    case 'landscape':
    case 'portrait':
    case 'any':
      return value
    default:
      return null
  }
}

/** Parse standard CLI arguments shared by `tools/package-game.ts` and generated project `game/package.js`. */
export function parsePackageArgs(argv: readonly string[]) {
  const values: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--help' || token === '-h') return { help: true as const }
    if (!token.startsWith('--')) throw new Error('Unexpected argument: ' + token)
    const eq = token.indexOf('=')
    if (eq > 0) values[token.slice(2, eq)] = token.slice(eq + 1)
    else {
      const next = argv[++i]
      if (!next || next.startsWith('--')) throw new Error('Missing value for ' + token)
      values[token.slice(2)] = next
    }
  }
  const rawTarget = values.target ?? 'all'
  const target = parsePackageTarget(rawTarget)
  if (!target) {
    throw new Error('Unknown --target "' + rawTarget + '". Choose web, steam, mobile, godot, player, or all.')
  }
  const rawOrientation = values.orientation ?? 'landscape'
  const orientation = parsePackageOrientation(rawOrientation)
  if (!orientation) {
    throw new Error('Unknown --orientation "' + rawOrientation + '". Choose landscape, portrait, or any.')
  }
  return {
    help: false as const,
    target,
    game: values.game,
    projectDir: values.project,
    outDir: values.out,
    name: values.name,
    appId: values['app-id'],
    version: values.version,
    steamAppId: values['steam-app-id'],
    orientation,
    backgroundColor: values.background
  }
}

export function formatPackageSummary(result: PackageResult, cwd = process.cwd()) {
  const lines = [`Packaged ${result.name} (${result.appId}):`]
  for (const output of result.outputs) {
    const rel = relative(cwd, output.dir) || '.'
    const kb = (output.totalBytes / 1024).toFixed(1)
    lines.push(`  - ${output.target}: ${rel} (${output.files} files, ${kb} KB)`)
  }
  return lines.join('\n')
}
