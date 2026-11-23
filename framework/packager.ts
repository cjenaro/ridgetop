import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ArtModel, ArtRecipe } from './art.ts'
import type { InstanceBatch } from './types.ts'
import type { LayoutNode } from './ui-layout.ts'
import { createArtKit, modelFromArtRecipe } from './art.ts'
import { exportGodotProject } from './export-godot.ts'
import { multiply, orthographic, view } from './geometry.ts'
import { renderMeshPixels } from './low-poly.ts'
import { encodePng } from './png.ts'
import { color } from './renderer.ts'
import { boxNode, column, overlay, row } from './ui-layout.ts'

export type PackageTarget = 'web' | 'steam' | 'mobile' | 'godot' | 'all'
export type PackageOrientation = 'landscape' | 'portrait' | 'any'

export interface PackageGameOptions {
  target: PackageTarget
  outDir: string
  /** Built-in Ridgetop game (`signal-drift`, `beacon-run`, `starter`) or omitted when `projectDir` is supplied. */
  game?: 'signal-drift' | 'beacon-run' | 'starter'
  /** Path to a generated Ridgetop game project directory (created with `create-game`). */
  projectDir?: string
  /** Path to the Ridgetop checkout root (required when packaging built-in games). */
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
  target: 'web' | 'steam' | 'mobile' | 'godot'
  dir: string
  wwwDir?: string
  iconPath?: string
  files: number
  totalBytes: number
}

export interface PackageResult {
  name: string
  slug: string
  appId: string
  outputs: PackagedOutput[]
}

const blockedStudioFiles = new Set([
  'serve.js', 'testing.js', 'testing-scene.js', 'testing.html', 'testing.css',
  'preview-art.js', 'art-library.js', 'package.js',
  'art-review.js', 'review-store.js', 'verification.js',
  'decision-api.js', 'decision-providers.js',
  'host.js', 'room-server.js', 'records.js', 'server.js', 'packager.js', 'export-godot.js'
])

const blockedStudioDirs = new Set(['library', 'reviews', 'benchmarks', 'test', 'tools', 'node_modules', 'dist'])

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

function stripSourceMap(source: string) {
  return source.replace(/^\/\/# sourceMappingURL=.*$/gm, '')
}

function ensureMobileMeta(html: string, themeColor: string, extraHead = '') {
  let out = html
  if (/<meta name="viewport"[^>]*>/i.test(out)) {
    out = out.replace(/<meta name="viewport"[^>]*>/i,
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
  } else {
    out = out.replace(/<head>/i,
      '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
  }
  if (!/<meta name="theme-color"/i.test(out)) {
    out = out.replace(/<\/head>/i, `  <meta name="theme-color" content="${themeColor}">\n</head>`)
  }
  if (extraHead) {
    out = out.replace(/<\/head>/i, `${extraHead}\n</head>`)
  }
  return out
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

interface ModuleStatement {
  kind: 'import' | 'export'
  start: number
  end: number
  specifier: string
  names: Set<string> | '*'
  exportedNames?: string[]
}

/** Zero-dependency scanner for top-level static ES import/export-from statements, skipping comments, strings, and templates. */
function scanStaticModuleStatements(code: string): ModuleStatement[] {
  const results: ModuleStatement[] = []
  const len = code.length
  let i = 0
  let braceDepth = 0
  let parenDepth = 0
  let prevToken = ''

  function skipWsAndComments() {
    while (i < len) {
      const c = code.charCodeAt(i)
      if (c === 32 || c === 9 || c === 10 || c === 13) { i++; continue }
      if (c === 47 && code.charCodeAt(i + 1) === 47) {
        i += 2
        while (i < len && code.charCodeAt(i) !== 10) i++
        continue
      }
      if (c === 47 && code.charCodeAt(i + 1) === 42) {
        i += 2
        while (i + 1 < len && !(code.charCodeAt(i) === 42 && code.charCodeAt(i + 1) === 47)) i++
        i = Math.min(len, i + 2)
        continue
      }
      break
    }
  }

  function readString(): string | null {
    const quote = code.charCodeAt(i)
    if (quote !== 39 && quote !== 34) return null
    i++
    let out = ''
    while (i < len) {
      const c = code.charCodeAt(i++)
      if (c === 92 && i < len) { out += code[i++]; continue }
      if (c === quote) return out
      out += String.fromCharCode(c)
    }
    return out
  }

  function skipTemplate() {
    i++ // opening `
    while (i < len) {
      const c = code.charCodeAt(i++)
      if (c === 92) { i++; continue }
      if (c === 96) return
      if (c === 36 && code.charCodeAt(i) === 123) {
        i++
        let depth = 1
        while (i < len && depth > 0) {
          skipWsAndComments()
          if (i >= len) break
          const ch = code.charCodeAt(i)
          if (ch === 39 || ch === 34) { readString(); continue }
          if (ch === 96) { skipTemplate(); continue }
          if (ch === 123) depth++
          else if (ch === 125) depth--
          i++
        }
      }
    }
  }

  function readIdent(): string {
    const start = i
    while (i < len) {
      const c = code.charCodeAt(i)
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 36) i++
      else break
    }
    return code.slice(start, i)
  }

  function parseNamedList(): { localOrOrig: Set<string>; exported: string[] } | null {
    if (code.charCodeAt(i) !== 123) return null
    i++ // '{'
    const localOrOrig = new Set<string>()
    const exported: string[] = []
    while (i < len) {
      skipWsAndComments()
      if (i >= len) return null
      if (code.charCodeAt(i) === 125) { i++; return { localOrOrig, exported } }
      const first = readString() ?? readIdent()
      if (!first) return null
      skipWsAndComments()
      let second = first
      if (code.startsWith('as', i) && !/[A-Za-z0-9_$]/.test(code[i + 2] ?? '')) {
        i += 2
        skipWsAndComments()
        second = readString() ?? readIdent()
      }
      localOrOrig.add(first)
      exported.push(second)
      skipWsAndComments()
      if (code.charCodeAt(i) === 44) i++
      else if (code.charCodeAt(i) === 125) { i++; return { localOrOrig, exported } }
      else return null
    }
    return null
  }

  while (i < len) {
    skipWsAndComments()
    if (i >= len) break
    const ch = code.charCodeAt(i)
    if (ch === 39 || ch === 34) { readString(); prevToken = 'str'; continue }
    if (ch === 96) { skipTemplate(); prevToken = 'tpl'; continue }
    if (ch === 123) { braceDepth++; i++; prevToken = '{'; continue }
    if (ch === 125) { braceDepth = Math.max(0, braceDepth - 1); i++; prevToken = '}'; continue }
    if (ch === 40) { parenDepth++; i++; prevToken = '('; continue }
    if (ch === 41) { parenDepth = Math.max(0, parenDepth - 1); i++; prevToken = ')'; continue }
    if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 36) {
      const start = i
      const word = readIdent()
      if ((word === 'import' || word === 'export') && braceDepth === 0 && parenDepth === 0 && prevToken !== '.') {
        const saved = i
        skipWsAndComments()
        // Side-effect import: import './foo.js'
        if (word === 'import' && (code.charCodeAt(i) === 39 || code.charCodeAt(i) === 34)) {
          const spec = readString()
          if (spec !== null) {
            skipWsAndComments()
            if (code.charCodeAt(i) === 59) i++
            results.push({ kind: 'import', start, end: i, specifier: spec, names: '*' })
            prevToken = ';'
            continue
          }
        }
        // Skip dynamic import(...) or import.meta
        if (word === 'import' && (code.charCodeAt(i) === 40 || code.charCodeAt(i) === 46)) {
          i = saved
          prevToken = word
          continue
        }
        // Parse import/export clause up to `from`
        let names: Set<string> | '*' = '*'
        let exportedNames: string[] | undefined
        let hasClause = false
        let valid = true
        if (code.charCodeAt(i) === 42) {
          // * [as ns]
          hasClause = true
          i++
          skipWsAndComments()
          if (code.startsWith('as', i) && !/[A-Za-z0-9_$]/.test(code[i + 2] ?? '')) {
            i += 2
            skipWsAndComments()
            readIdent()
          }
          names = '*'
        } else if (code.charCodeAt(i) === 123) {
          const list = parseNamedList()
          if (!list) valid = false
          else {
            hasClause = true
            names = list.localOrOrig
            exportedNames = list.exported
          }
        } else if (word === 'import') {
          const defName = readIdent()
          if (defName) {
            hasClause = true
            names = '*'
            skipWsAndComments()
            if (code.charCodeAt(i) === 44) {
              i++
              skipWsAndComments()
              if (code.charCodeAt(i) === 42) {
                i++
                skipWsAndComments()
                if (code.startsWith('as', i) && !/[A-Za-z0-9_$]/.test(code[i + 2] ?? '')) {
                  i += 2
                  skipWsAndComments()
                  readIdent()
                }
              } else if (code.charCodeAt(i) === 123) {
                if (!parseNamedList()) valid = false
              }
            }
          }
        }
        if (valid && hasClause) {
          skipWsAndComments()
          if (code.startsWith('from', i) && !/[A-Za-z0-9_$]/.test(code[i + 4] ?? '')) {
            i += 4
            skipWsAndComments()
            const spec = readString()
            if (spec !== null) {
              skipWsAndComments()
              if (code.charCodeAt(i) === 59) i++
              results.push({ kind: word, start, end: i, specifier: spec, names, exportedNames })
              prevToken = ';'
              continue
            }
          }
        }
        i = saved
      }
      prevToken = word
      continue
    }
    prevToken = code[i++]
  }
  return results
}

function parseStaticImports(code: string) {
  return scanStaticModuleStatements(code)
    .filter(s => s.specifier.startsWith('.'))
    .map(s => ({ specifier: s.specifier, names: s.names }))
}

function pruneBarrelSource(code: string, usedNames: Set<string> | '*') {
  const stmts = scanStaticModuleStatements(code).filter(s => s.kind === 'export')
  if (!stmts.length) return code
  let out = ''
  let cursor = 0
  for (const stmt of stmts) {
    out += code.slice(cursor, stmt.start)
    cursor = stmt.end
    const targetFile = basename(stmt.specifier)
    if (blockedStudioFiles.has(targetFile)) continue
    if (stmt.names === '*' || usedNames === '*') {
      out += code.slice(stmt.start, stmt.end)
      continue
    }
    if (stmt.exportedNames?.some(name => usedNames.has(name))) {
      out += code.slice(stmt.start, stmt.end)
    }
  }
  out += code.slice(cursor)
  return out.replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Trace only statically reachable runtime ES modules, pruning unused barrel exports and dropping all studio/testing files. */
async function emitShakenModules({
  entryRelPath,
  resolveSource,
  rewriteSource,
  wwwDir
}: {
  entryRelPath: string
  resolveSource(relPath: string): string
  rewriteSource?(relPath: string, code: string): string
  wwwDir: string
}) {
  const barrelNames = new Map<string, Set<string> | '*'>()
  const rawSources = new Map<string, string>()

  function recordBarrelUsage(targetRel: string, names: Set<string> | '*'): boolean {
    const existing = barrelNames.get(targetRel)
    if (existing === '*') return false
    if (names === '*') {
      barrelNames.set(targetRel, '*')
      return true
    }
    const set = existing ?? new Set<string>()
    let changed = !existing
    for (const name of names) {
      if (!set.has(name)) {
        set.add(name)
        changed = true
      }
    }
    barrelNames.set(targetRel, set)
    return changed
  }

  function isBarrel(relPath: string) {
    return relPath === 'framework/index.js' || relPath === 'framework/ui.js'
  }

  function normalizeRel(fromRel: string, specifier: string) {
    return join(dirname(fromRel), specifier).replace(/\\/g, '/')
  }

  async function loadModule(relPath: string): Promise<string> {
    if (rawSources.has(relPath)) return rawSources.get(relPath)
    let code = stripSourceMap(await readFile(resolveSource(relPath), 'utf8'))
    if (rewriteSource) code = rewriteSource(relPath, code)
    rawSources.set(relPath, code)
    return code
  }

  // Pass 1: discover non-barrel modules and record exact symbols imported from barrels.
  const visitedNonBarrel = new Set<string>()
  async function scan(relPath: string) {
    if (blockedStudioFiles.has(basename(relPath))) return
    if (isBarrel(relPath)) return
    if (visitedNonBarrel.has(relPath)) return
    visitedNonBarrel.add(relPath)
    const code = await loadModule(relPath)
    for (const imp of parseStaticImports(code)) {
      const nextRel = normalizeRel(relPath, imp.specifier)
      if (blockedStudioFiles.has(basename(nextRel))) continue
      if (isBarrel(nextRel)) recordBarrelUsage(nextRel, imp.names)
      else await scan(nextRel)
    }
  }

  await scan(entryRelPath)

  // Pass 2: prune any reached barrels to ONLY imported symbols, then trace their surviving re-exports (including transitive barrels).
  const finalSources = new Map<string, string>()
  for (const relPath of visitedNonBarrel) finalSources.set(relPath, rawSources.get(relPath))

  async function traceFinal(relPath: string) {
    if (finalSources.has(relPath) && !isBarrel(relPath)) return
    if (blockedStudioFiles.has(basename(relPath))) return
    let code = await loadModule(relPath)
    if (isBarrel(relPath)) {
      code = pruneBarrelSource(code, barrelNames.get(relPath) ?? new Set())
    }
    finalSources.set(relPath, code)
    for (const imp of parseStaticImports(code)) {
      const nextRel = normalizeRel(relPath, imp.specifier)
      if (blockedStudioFiles.has(basename(nextRel))) continue
      if (isBarrel(nextRel)) {
        const changed = recordBarrelUsage(nextRel, imp.names)
        if (!finalSources.has(nextRel) || changed) await traceFinal(nextRel)
      } else if (!finalSources.has(nextRel)) {
        await traceFinal(nextRel)
      }
    }
  }

  for (const barrelRel of Array.from(barrelNames.keys())) await traceFinal(barrelRel)

  const resolvedRoot = resolve(wwwDir)
  for (const [relPath, code] of finalSources) {
    const dst = resolve(resolvedRoot, relPath)
    if (dst !== resolvedRoot && !dst.startsWith(resolvedRoot + sep)) {
      throw new Error('Module path escapes bundle root: ' + relPath)
    }
    await mkdir(dirname(dst), { recursive: true })
    await writeFile(dst, code)
  }
}

async function copyDirFiltered(src: string, dst: string, { skipJs = false } = {}) {
  await mkdir(dst, { recursive: true })
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (blockedStudioDirs.has(entry.name)) continue
      await copyDirFiltered(join(src, entry.name), join(dst, entry.name), { skipJs })
    } else if (entry.isFile()) {
      if (blockedStudioFiles.has(entry.name)) continue
      if (skipJs && entry.name.endsWith('.js')) continue
      await cp(join(src, entry.name), join(dst, entry.name))
    }
  }
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

interface ResolvedGameAssets {
  title?: string
  icon: { batches: readonly InstanceBatch[]; span: number; centerY: number; background: string; accent: string }
  models: Record<string, readonly InstanceBatch[]>
  audio: Record<string, { notes: readonly (readonly [number, number, number, number?])[]; waveform?: 'sine' | 'triangle' | 'square' | 'sawtooth' }>
  gameData: Record<string, unknown>
  uiTree: LayoutNode
}

function defaultMenuLayout(title: string, actions: readonly string[], anchor: 'center' | 'top-left' = 'center'): LayoutNode {
  return overlay({ id: 'root', style: { anchor: 'fill' } }, [
    column({ id: 'menu-card', style: { anchor, width: 320, inset: anchor === 'top-left' ? 40 : 16, padding: 20, gap: 10 }, widget: { type: 'panel' } }, [
      boxNode({ id: 'menu-title', style: { height: 34 }, widget: { type: 'text', text: title, size: 24, weight: 800, align: 'center' } }),
      ...actions.map((label, index) => boxNode({
        id: 'action-' + slugify(label),
        style: { height: 42 },
        widget: { type: 'button', label, primary: index === 0 }
      })),
      row({ id: 'settings-row', style: { gap: 8 } }, [
        boxNode({ id: 'sound-toggle', style: { height: 38, grow: 1 }, widget: { type: 'toggle', label: 'Sound', checked: true } })
      ])
    ])
  ])
}

async function resolveProjectAssets(projectGameDir: string): Promise<ResolvedGameAssets> {
  let title: string | undefined
  let palette: Record<string, string> = {}
  let customModels: Record<string, ArtModel> = {}
  let modelFiles: Record<string, string> = {}
  let gameConfig: Record<string, unknown> = {}
  let iconRole = 'ranger'
  const roles = new Set<string>(['ranger', 'tile', 'crystal', 'lantern', 'pine', 'rock', 'crate'])

  try {
    const mod = await import(pathToFileURL(join(projectGameDir, 'game.js')).href + '?t=' + Date.now())
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
  } catch { /* Fall back to default art kit. */ }

  let overrides: Record<string, ArtRecipe> = {}
  try { overrides = JSON.parse(await readFile(join(projectGameDir, 'art', 'overrides.json'), 'utf8')) } catch {}

  const loadedModels: Record<string, ArtModel> = {}
  for (const [name, relPath] of Object.entries(modelFiles)) {
    try { loadedModels[name] = modelFromArtRecipe(JSON.parse(await readFile(join(projectGameDir, relPath), 'utf8'))) } catch {}
  }
  const edited: Record<string, ArtModel> = {}
  for (const [name, recipe] of Object.entries(overrides)) {
    try { edited[name] = modelFromArtRecipe(recipe) } catch {}
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
    uiTree: defaultMenuLayout(title ?? 'Ridgetop Game', ['Resume', 'Restart', 'Quit'])
  }
}

async function resolveBuiltInAssets(kind: 'signal-drift' | 'beacon-run' | 'starter', repoRoot: string): Promise<ResolvedGameAssets> {
  if (kind === 'starter') return resolveProjectAssets(join(repoRoot, 'dist', 'starter'))

  if (kind === 'signal-drift') {
    const models: Record<string, readonly InstanceBatch[]> = {}
    let iconBatches: readonly InstanceBatch[] | undefined
    const exportedCircuits: Record<string, unknown>[] = []
    try {
      const [carMod, trackMod, sceneMod] = await Promise.all([
        import(pathToFileURL(join(repoRoot, 'dist', 'racing', 'car-art.js')).href),
        import(pathToFileURL(join(repoRoot, 'dist', 'racing', 'track.js')).href),
        import(pathToFileURL(join(repoRoot, 'dist', 'racing', 'scene.js')).href)
      ])
      if (typeof carMod.createCarModels === 'function') {
        for (let slot = 0; slot < 4; slot++) {
          const cars = carMod.createCarModels()
          cars.add({ x: 0, z: 0, yaw: 0, slot }, 0, 0, false, slot === 0 ? { motor: 1, tires: 1, armor: 1, capacitor: 1 } : undefined)
          models[`car-${slot}`] = cars.full
          if (slot === 0) {
            models['rally-car'] = cars.full
            iconBatches = cars.full
          }
        }
      }
      if (Array.isArray(trackMod.circuits) && typeof sceneMod.buildCircuitBatches === 'function') {
        for (const c of trackMod.circuits) {
          const built = sceneMod.buildCircuitBatches(c)
          models[`circuit-${c.id}`] = built.staticBatches
          const samples: number[][] = []
          const count = 96
          for (let i = 0; i < count; i++) {
            const p = c.route.sample(i / count)
            samples.push([Number(p.x.toFixed(3)), Number(p.z.toFixed(3)), Number(p.yaw.toFixed(4))])
          }
          exportedCircuits.push({
            id: c.id,
            name: c.name,
            description: c.description,
            width: c.width,
            laps: c.laps,
            qualify: c.qualify,
            purse: c.purse,
            pace: c.pace,
            grip: c.grip,
            clear: built.clear,
            samples
          })
        }
      }
    } catch (error) {
      throw new Error('Failed to load built Signal Drift assets from dist/. Run npm run build first: ' + (error instanceof Error ? error.message : String(error)))
    }
    const kit = createArtKit({ palette: { accent: '#f8aa4e', glow: '#8df5d5', leaf: '#56bfae' } })
    if (!iconBatches) {
      const g = kit.group(); g.add('crystal', [0, 0, 0])
      models.crystal = g.batches
      iconBatches = g.batches
    }
    return {
      title: 'Signal Drift',
      icon: { batches: iconBatches, span: 3.6, centerY: 0.55, background: '#191b24', accent: '#623a2c' },
      models,
      audio: {
        pulse: { notes: [[610, .12, 0, 240]], waveform: 'triangle' },
        snare: { notes: [[300, .18, 0, 105]], waveform: 'sine' },
        hit: { notes: [[175, .2, 0, 68]], waveform: 'triangle' },
        go: { notes: [[660, .15, 0], [880, .20, .10]], waveform: 'sine' },
        podium: { notes: [[392, .18, 0], [523, .17, .12], [660, .24, .26], [784, .38, .42]], waveform: 'sine' }
      },
      gameData: {
        game: 'signal-drift',
        theme: { surface: '#221a19ee', surfaceAlt: '#382924f4', top: '#6b473b88', border: '#e2a77399', accent: '#f8aa4e', accentText: '#1e1410', text: '#fff2e2', muted: '#d8beaa', glow: '#8df5d5' },
        circuits: exportedCircuits
      },
      uiTree: defaultMenuLayout('Signal Drift', ['Start Race', 'Events', 'Quit'], 'top-left')
    }
  }

  const kit = createArtKit({ palette: { accent: '#efac62', glow: '#83f0d6', leaf: '#387a65' } })
  const models: Record<string, readonly InstanceBatch[]> = {}
  for (const role of ['lantern', 'crystal', 'pine', 'rock'] as const) {
    const g = kit.group(); g.add(role, [0, 0, 0])
    models[role] = g.batches
  }
  const lantern = kit.model('lantern')
  return {
    title: 'Beacon Run',
    icon: { batches: models.lantern, span: lantern.span, centerY: lantern.centerY, background: '#142431', accent: '#2a5652' },
    models,
    audio: {
      jump: { notes: [[310, .10, 0, 495]], waveform: 'sine' },
      crystal: { notes: [[660, .12, 0], [990, .13, .07]], waveform: 'sine' },
      signal: { notes: [[420, .12, 0], [630, .14, .09], [840, .16, .18]], waveform: 'sine' },
      hit: { notes: [[195, .23, 0, 70]], waveform: 'triangle' },
      finish: { notes: [[392, .16, 0], [493.9, .17, .13], [587.3, .18, .26], [784, .38, .39]], waveform: 'sine' }
    },
    gameData: { game: 'beacon-run', courses: ['ridge', 'ruins', 'summit', 'storm', 'foundry', 'beacon'] },
    uiTree: defaultMenuLayout('Beacon Run', ['Start Campaign', 'Practice'])
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

function findModuleEntryScript(html: string): string {
  for (const tag of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = tag[1]
    if (!/\btype\s*=\s*["']module["']/i.test(attrs)) continue
    const src = /\bsrc\s*=\s*["']\.?\/?([^"']+)["']/i.exec(attrs)
    if (src) return src[1]
  }
  return 'main.js'
}

async function assembleWebBundle(options: PackageGameOptions, wwwDir: string, {
  themeColor, extraHead = ''
}: { themeColor: string; extraHead?: string }): Promise<{ detectedName: string }> {
  await rm(wwwDir, { recursive: true, force: true })
  await mkdir(wwwDir, { recursive: true })

  if (options.projectDir) {
    const project = resolve(options.projectDir)
    const gameDir = join(project, 'game')
    const fwDir = join(project, 'framework')
    await access(join(gameDir, 'index.html')).catch(() => {
      throw new Error('Expected game/index.html inside project directory: ' + project)
    })

    const rawHtml = await readFile(join(gameDir, 'index.html'), 'utf8')
    await writeFile(join(wwwDir, 'index.html'), ensureMobileMeta(rawHtml, themeColor, extraHead))
    for (const entry of await readdir(gameDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (blockedStudioDirs.has(entry.name)) continue
        await copyDirFiltered(join(gameDir, entry.name), join(wwwDir, entry.name), { skipJs: true })
      } else if (entry.isFile() && !entry.name.endsWith('.js') && entry.name !== 'index.html' && !blockedStudioFiles.has(entry.name)) {
        await cp(join(gameDir, entry.name), join(wwwDir, entry.name))
      }
    }

    const entryRel = findModuleEntryScript(rawHtml)
    await emitShakenModules({
      entryRelPath: entryRel,
      wwwDir,
      resolveSource(relPath) {
        if (relPath.startsWith('framework/')) return join(fwDir, relPath.slice('framework/'.length))
        return join(gameDir, relPath)
      },
      rewriteSource: rewriteFrameworkImports
    })

    let detectedName = basename(project)
    try {
      const mod = await import(pathToFileURL(join(gameDir, 'game.js')).href + '?n=' + Date.now())
      if (mod.game?.title) detectedName = String(mod.game.title)
    } catch {}
    return { detectedName }
  }

  const repoRoot = resolve(options.repoRoot ?? fileURLToPath(new URL('..', import.meta.url)))
  const distDir = join(repoRoot, 'dist')
  await access(join(distDir, 'framework', 'index.js')).catch(() => {
    throw new Error('Build the repository with npm run build before packaging built-in games.')
  })

  const game = options.game ?? 'signal-drift'
  if (game === 'signal-drift') {
    let html = await readFile(join(repoRoot, 'racing.html'), 'utf8')
    html = html
      .replace(/\s+data-hosted="1"/g, '')
      .replaceAll('href="/', 'href="./')
      .replaceAll('src="/', 'src="./')
    await writeFile(join(wwwDir, 'index.html'), ensureMobileMeta(html, themeColor, extraHead))
    await cp(join(repoRoot, 'game-ui.css'), join(wwwDir, 'game-ui.css'))
    await emitShakenModules({
      entryRelPath: 'racing/main.js',
      wwwDir,
      resolveSource: relPath => join(distDir, relPath)
    })
    return { detectedName: 'Signal Drift' }
  }

  if (game === 'beacon-run') {
    let html = await readFile(join(repoRoot, 'index.html'), 'utf8')
    html = html
      .replace(/\s+data-hosted="1"/g, '')
      .replaceAll('href="/', 'href="./')
      .replaceAll('src="/', 'src="./')
    await writeFile(join(wwwDir, 'index.html'), ensureMobileMeta(html, themeColor, extraHead))
    await cp(join(repoRoot, 'game-ui.css'), join(wwwDir, 'game-ui.css'))
    await emitShakenModules({
      entryRelPath: 'main.js',
      wwwDir,
      resolveSource: relPath => join(distDir, relPath),
      rewriteSource: (relPath, code) => relPath === 'game/sprites.js'
        ? code.replaceAll("'/game/assets/", "'./game/assets/").replaceAll('"/game/assets/', '"./game/assets/')
        : code
    })
    await copyDirFiltered(join(repoRoot, 'game', 'assets'), join(wwwDir, 'game', 'assets'))
    return { detectedName: 'Beacon Run' }
  }

  // Built-in starter (Lantern Grove)
  await copyDirFiltered(join(repoRoot, 'starter', 'art'), join(wwwDir, 'art'))
  await writeFile(join(wwwDir, 'art', 'overrides.json'), '{}\n')
  const html = ensureMobileMeta(await readFile(join(repoRoot, 'starter', 'index.html'), 'utf8'), themeColor, extraHead)
  await writeFile(join(wwwDir, 'index.html'), html)
  await cp(join(repoRoot, 'starter', 'style.css'), join(wwwDir, 'style.css'))
  await emitShakenModules({
    entryRelPath: 'main.js',
    wwwDir,
    resolveSource(relPath) {
      if (relPath.startsWith('framework/')) return join(distDir, relPath)
      return join(distDir, 'starter', relPath)
    },
    rewriteSource: rewriteFrameworkImports
  })
  return { detectedName: 'Lantern Grove' }
}

function renderElectronMain(name: string, slug: string) {
  return `'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const steam = require('./steam.cjs')

const APP_NAME = ${JSON.stringify(name)}
const SCHEME = 'ridgetop'
const WWW_ROOT = path.resolve(__dirname, '..', 'www')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const isSteamDeck = process.env.SteamDeck === '1' || process.env.SteamGamepadUI === '1' || process.env.GAMESCOPE_WAYLAND_DISPLAY !== undefined
const saveDir = process.env.RIDGETOP_SAVE_DIR || path.join(app.getPath('userData'), 'saves')
const saveFile = path.join(saveDir, ${JSON.stringify(slug + '-save.json')})

function loadSaves() {
  try {
    const parsed = JSON.parse(fs.readFileSync(saveFile, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

let saveCache = null
let saveSeq = 0
function persistSaves(data) {
  let temp = ''
  try {
    fs.mkdirSync(saveDir, { recursive: true })
    temp = saveFile + '.tmp.' + process.pid + '.' + (++saveSeq)
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\\n', 'utf8')
    fs.renameSync(temp, saveFile)
  } catch {
    if (temp) { try { fs.unlinkSync(temp) } catch {} }
  }
}

function getSaves() {
  if (!saveCache) saveCache = loadSaves()
  return saveCache
}

function createWindow() {
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    fullscreen: isSteamDeck,
    autoHideMenuBar: true,
    backgroundColor: '#101b20',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  win.setMenuBarVisibility(false)
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen())
    }
  })
  win.on('minimize', () => win.webContents.send('ridgetop:lifecycle', 'pause'))
  win.on('restore', () => win.webContents.send('ridgetop:lifecycle', 'resume'))
  win.on('blur', () => win.webContents.send('ridgetop:lifecycle', 'pause'))
  win.on('focus', () => win.webContents.send('ridgetop:lifecycle', 'resume'))

  void win.loadURL(SCHEME + '://app/index.html')
  return win
}

const singleLock = app.requestSingleInstanceLock()
if (!singleLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    steam.init(path.resolve(__dirname, '..'))

    protocol.handle(SCHEME, request => {
      let pathname
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname)
      } catch {
        return new Response('Bad Request', { status: 400 })
      }
      if (!pathname || pathname === '/') pathname = '/index.html'
      const target = path.resolve(WWW_ROOT, '.' + pathname)
      if (target !== WWW_ROOT && !target.startsWith(WWW_ROOT + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return new Response('Not found', { status: 404 })
      }
      const ext = path.extname(target).toLowerCase()
      return new Response(fs.readFileSync(target), {
        status: 200,
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' }
      })
    })

    ipcMain.on('ridgetop:storage-load', event => { event.returnValue = getSaves() })
    ipcMain.on('ridgetop:storage-set', (_event, key, value) => {
      const data = getSaves()
      data[String(key)] = String(value)
      persistSaves(data)
    })
    ipcMain.on('ridgetop:storage-remove', (_event, key) => {
      const data = getSaves()
      delete data[String(key)]
      persistSaves(data)
    })
    ipcMain.on('ridgetop:storage-clear', () => {
      saveCache = {}
      persistSaves(saveCache)
    })

    ipcMain.on('ridgetop:fullscreen-get', event => {
      const win = BrowserWindow.fromWebContents(event.sender)
      event.returnValue = Boolean(win && win.isFullScreen())
    })
    ipcMain.handle('ridgetop:fullscreen-set', (event, enabled) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) win.setFullScreen(Boolean(enabled))
    })
    ipcMain.handle('ridgetop:fullscreen-toggle', event => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) win.setFullScreen(!win.isFullScreen())
    })
    ipcMain.handle('ridgetop:quit', () => { app.quit() })

    ipcMain.on('ridgetop:steam-available', event => { event.returnValue = steam.available() })
    ipcMain.handle('ridgetop:steam-achievement', (_event, id) => steam.unlockAchievement(String(id)))
    ipcMain.on('ridgetop:steam-presence', (_event, key, value) => steam.setRichPresence(String(key), String(value)))
    ipcMain.on('ridgetop:steam-overlay', (_event, dialog) => steam.activateOverlay(String(dialog || 'Achievements')))

    createWindow()
    app.on('second-instance', () => {
      const active = BrowserWindow.getAllWindows()[0]
      if (active && !active.isDestroyed()) {
        if (active.isMinimized()) active.restore()
        active.focus()
      }
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => { app.quit() })
}
`
}

function renderElectronPreload() {
  return `'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const lifecycleListeners = new Set()
ipcRenderer.on('ridgetop:lifecycle', (_event, state) => {
  for (const handlers of lifecycleListeners) {
    if (state === 'pause') handlers.pause && handlers.pause()
    else if (state === 'resume') handlers.resume && handlers.resume()
  }
})

contextBridge.exposeInMainWorld('__ridgetopPlatform', {
  platform: 'desktop',
  storage: {
    loadAll: () => ipcRenderer.sendSync('ridgetop:storage-load'),
    set: (key, value) => ipcRenderer.send('ridgetop:storage-set', key, value),
    remove: key => ipcRenderer.send('ridgetop:storage-remove', key),
    clear: () => ipcRenderer.send('ridgetop:storage-clear')
  },
  fullscreen: {
    isFullscreen: () => ipcRenderer.sendSync('ridgetop:fullscreen-get'),
    set: enabled => ipcRenderer.invoke('ridgetop:fullscreen-set', enabled),
    toggle: () => ipcRenderer.invoke('ridgetop:fullscreen-toggle')
  },
  quit: () => ipcRenderer.invoke('ridgetop:quit'),
  lifecycle: {
    subscribe: handlers => {
      lifecycleListeners.add(handlers)
      return () => lifecycleListeners.delete(handlers)
    }
  },
  steam: {
    available: () => ipcRenderer.sendSync('ridgetop:steam-available'),
    unlockAchievement: id => ipcRenderer.invoke('ridgetop:steam-achievement', id),
    setRichPresence: (key, value) => ipcRenderer.send('ridgetop:steam-presence', key, value),
    activateOverlay: dialog => ipcRenderer.send('ridgetop:steam-overlay', dialog)
  }
})
`
}

function renderElectronSteam(defaultSteamAppId: string) {
  return `'use strict'
const fs = require('node:fs')
const path = require('node:path')

let client = null

function readAppId(rootDir) {
  try {
    const raw = fs.readFileSync(path.join(rootDir, 'steam_appid.txt'), 'utf8').trim()
    const parsed = Number.parseInt(raw, 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  } catch {}
  return Number.parseInt(${JSON.stringify(defaultSteamAppId)}, 10) || 480
}

function init(rootDir) {
  try {
    const steamworks = require('steamworks.js')
    const appId = readAppId(rootDir)
    client = steamworks.init(appId)
    if (typeof steamworks.electronEnableSteamOverlay === 'function') {
      steamworks.electronEnableSteamOverlay()
    }
  } catch {
    client = null
  }
}

module.exports = {
  init,
  available: () => Boolean(client),
  unlockAchievement(id) {
    if (!client) return false
    try { return Boolean(client.achievement.activate(id)) } catch { return false }
  },
  setRichPresence(key, value) {
    if (!client) return
    try { client.localplayer.setRichPresence(key, value) } catch {}
  },
  activateOverlay(dialog) {
    if (!client) return
    try { client.overlay.activateDialog(dialog || 'Achievements') } catch {}
  }
}
`
}

function renderElectronBuilderConfig(name: string, slug: string, appId: string) {
  return `appId: ${appId}
productName: ${JSON.stringify(name)}
directories:
  buildResources: build
  output: release
files:
  - electron/**/*
  - www/**/*
  - steam_appid.txt
  - package.json
asar: true
asarUnpack:
  - "**/node_modules/steamworks.js/**"
  - "steam_appid.txt"
extraFiles:
  - from: steam_appid.txt
    to: steam_appid.txt
win:
  icon: build/icon.png
  target:
    - nsis
    - zip
mac:
  icon: build/icon.png
  category: public.app-category.games
  target:
    - dmg
    - zip
linux:
  icon: build/icon.png
  category: Game
  executableName: ${slug}
  target:
    - AppImage
    - tar.gz
`
}

function renderSteamReadme(name: string, slug: string, appId: string, steamAppId: string) {
  return `# ${name} — Steam & Desktop Build

Generated by Ridgetop's multi-platform packager (studio/testing tools stripped).

## Run locally

\`\`\`sh
npm install
npm start
\`\`\`

## Build distributables

\`\`\`sh
npm run dist:linux   # AppImage + tar.gz (Steam Deck ready)
npm run dist:win     # Windows installer + portable zip
npm run dist:mac     # macOS DMG + zip
\`\`\`

## Steamworks & Steam Cloud setup

1. Replace \`steam_appid.txt\` (currently \`${steamAppId}\`) with your assigned Steam App ID.
2. Install optional Steamworks native bindings: \`npm install steamworks.js\`.
3. Map Steam Cloud Auto-Cloud to \`${slug}/saves/${slug}-save.json\` under the platform user-data root.
4. Package ID: \`${appId}\`
`
}

function renderMobileBridgeJs(orientation: PackageOrientation) {
  return `(function () {
  const cap = globalThis.Capacitor
  const plugins = cap && cap.Plugins ? cap.Plugins : {}
  const platform = typeof cap?.getPlatform === 'function' ? cap.getPlatform() : 'web'
  if (platform !== 'ios' && platform !== 'android') return

  const PREFIX = 'ridgetop.native.'
  const lifecycleListeners = new Set()
  const mutatedKeys = new Set()
  let clearedAll = false

  if (plugins.App && typeof plugins.App.addListener === 'function') {
    plugins.App.addListener('appStateChange', function (state) {
      for (const handlers of lifecycleListeners) {
        if (state && state.isActive) handlers.resume && handlers.resume()
        else handlers.pause && handlers.pause()
      }
    })
  }

  function mirrorToPreferences(action, key, value) {
    const prefs = plugins.Preferences
    if (!prefs) return
    try {
      if (action === 'set') void prefs.set({ key: PREFIX + key, value: String(value) })
      else if (action === 'remove') void prefs.remove({ key: PREFIX + key })
      else if (action === 'clear') {
        if (typeof prefs.keys === 'function' && typeof prefs.remove === 'function') {
          prefs.keys().then(function (result) {
            const keys = result && Array.isArray(result.keys) ? result.keys : []
            return Promise.all(keys.filter(function (k) { return k.startsWith(PREFIX) }).map(function (k) {
              return prefs.remove({ key: k })
            }))
          }).catch(function () {})
        }
      }
    } catch {}
  }

  if (plugins.Preferences && typeof plugins.Preferences.keys === 'function') {
    plugins.Preferences.keys().then(function (result) {
      if (clearedAll) return
      const keys = result && Array.isArray(result.keys) ? result.keys : []
      return Promise.all(keys.filter(function (k) { return k.startsWith(PREFIX) }).map(function (fullKey) {
        const bare = fullKey.slice(PREFIX.length)
        if (mutatedKeys.has(bare)) return
        return plugins.Preferences.get({ key: fullKey }).then(function (item) {
          if (clearedAll || mutatedKeys.has(bare)) return
          if (item && typeof item.value === 'string' && globalThis.localStorage?.getItem(bare) === null) {
            try { globalThis.localStorage.setItem(bare, item.value) } catch {}
          }
        })
      }))
    }).catch(function () {})
  }

  const impactStyle = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' }
  globalThis.__ridgetopPlatform = {
    platform: platform,
    storage: {
      loadAll: function () {
        const out = {}
        try {
          for (let i = 0; i < globalThis.localStorage.length; i++) {
            const k = globalThis.localStorage.key(i)
            if (k !== null) {
              const v = globalThis.localStorage.getItem(k)
              if (v !== null) out[k] = v
            }
          }
        } catch {}
        return out
      },
      set: function (key, value) {
        mutatedKeys.add(String(key))
        try { globalThis.localStorage.setItem(key, String(value)) } catch {}
        mirrorToPreferences('set', key, value)
      },
      remove: function (key) {
        mutatedKeys.add(String(key))
        try { globalThis.localStorage.removeItem(key) } catch {}
        mirrorToPreferences('remove', key)
      },
      clear: function () {
        clearedAll = true
        mutatedKeys.clear()
        try { globalThis.localStorage.clear() } catch {}
        mirrorToPreferences('clear')
      }
    },
    haptics: {
      impact: function (style) {
        if (plugins.Haptics && typeof plugins.Haptics.impact === 'function') {
          plugins.Haptics.impact({ style: impactStyle[style] || 'LIGHT' }).catch(function () {})
        }
      }
    },
    lifecycle: {
      subscribe: function (handlers) {
        lifecycleListeners.add(handlers)
        return function () { lifecycleListeners.delete(handlers) }
      }
    }
  }

  if (plugins.StatusBar && typeof plugins.StatusBar.hide === 'function') {
    plugins.StatusBar.hide().catch(function () {})
  }
  const orientation = ${JSON.stringify(orientation)}
  if (orientation !== 'any' && plugins.ScreenOrientation && typeof plugins.ScreenOrientation.lock === 'function') {
    plugins.ScreenOrientation.lock({ orientation: orientation }).catch(function () {})
  }
  globalThis.addEventListener('load', function () {
    if (plugins.SplashScreen && typeof plugins.SplashScreen.hide === 'function') {
      plugins.SplashScreen.hide().catch(function () {})
    }
  }, { once: true })
})()
`
}

function renderMobileReadme(name: string, appId: string, orientation: PackageOrientation) {
  return `# ${name} — iOS & Android Build (Capacitor)

Generated by Ridgetop's multi-platform packager (studio/testing tools stripped).

## First-time setup

\`\`\`sh
npm install
npm run add:ios
npm run add:android
npm run icons
npm run sync
\`\`\`

## Open & build

\`\`\`sh
npm run open:ios
npm run open:android
\`\`\`

- **App ID:** \`${appId}\`
- **Orientation:** \`${orientation}\`
`
}

async function tryCompileGodotScripts(options: PackageGameOptions, repoRoot: string, godotDir: string): Promise<number> {
  const candidates = [
    join(repoRoot, 'tools', 'ts-to-gd.ts'),
    join(repoRoot, 'dist', 'tools', 'ts-to-gd.js')
  ]
  let compilerPath: string | null = null
  for (const candidate of candidates) {
    try { await access(candidate); compilerPath = candidate; break } catch {}
  }
  if (!compilerPath) return 0

  let spec: { rootDir: string; entries: string[] } | null = null
  if (options.projectDir) {
    const project = resolve(options.projectDir)
    spec = { rootDir: project, entries: [join(project, 'game', 'game.js')] }
  } else {
    const game = options.game ?? 'signal-drift'
    if (game === 'signal-drift') {
      spec = {
        rootDir: repoRoot,
        entries: [
          join(repoRoot, 'racing', 'race.ts'),
          join(repoRoot, 'racing', 'progression.ts'),
          join(repoRoot, 'framework', 'ui-layout.ts'),
          join(repoRoot, 'framework', 'ui-button.ts'),
          join(repoRoot, 'framework', 'ui-toggle.ts')
        ]
      }
    } else if (game === 'beacon-run') {
      spec = {
        rootDir: repoRoot,
        entries: [
          join(repoRoot, 'game', 'simulation.ts'),
          join(repoRoot, 'game', 'campaign.ts'),
          join(repoRoot, 'framework', 'ui-layout.ts'),
          join(repoRoot, 'framework', 'ui-button.ts'),
          join(repoRoot, 'framework', 'ui-toggle.ts')
        ]
      }
    } else if (game === 'starter') {
      spec = {
        rootDir: repoRoot,
        entries: [
          join(repoRoot, 'starter', 'game.ts'),
          join(repoRoot, 'framework', 'ui-layout.ts')
        ]
      }
    }
  }
  if (!spec) return 0
  try {
    const mod = await import(pathToFileURL(compilerPath).href)
    if (typeof mod.compileTsProjectToGodot !== 'function') return 0
    const compiled = await mod.compileTsProjectToGodot({
      entries: spec.entries,
      rootDir: spec.rootDir,
      outDir: join(godotDir, 'scripts', 'compiled')
    })
    return Array.isArray(compiled?.files) ? compiled.files.length : 0
  } catch {
    return 0
  }
}

export async function packageGame(options: PackageGameOptions): Promise<PackageResult> {
  const targets: ('web' | 'steam' | 'mobile' | 'godot')[] = options.target === 'all'
    ? ['web', 'steam', 'mobile', 'godot']
    : [options.target]
  const outRoot = resolve(options.outDir)
  const repoRoot = options.repoRoot ? resolve(options.repoRoot) : resolve(fileURLToPath(new URL('..', import.meta.url)))

  let projectVersion = options.version ?? '1.0.0'
  if (options.projectDir && !options.version) {
    try {
      const pkg = JSON.parse(await readFile(join(resolve(options.projectDir), 'package.json'), 'utf8'))
      if (pkg.version) projectVersion = String(pkg.version)
    } catch {}
  }

  const assets = options.projectDir
    ? await resolveProjectAssets(join(resolve(options.projectDir), 'game'))
    : await resolveBuiltInAssets(options.game ?? 'signal-drift', repoRoot)

  const iconSource = options.iconBatches
    ? { ...options.iconBatches, background: options.backgroundColor ?? '#142431', accent: '#2a5652' }
    : assets.icon
  const themeColor = options.backgroundColor ?? iconSource.background
  const steamAppId = options.steamAppId ?? '480'
  const orientation = options.orientation ?? 'landscape'
  const outputs: PackagedOutput[] = []
  const fallbackName = options.projectDir ? basename(resolve(options.projectDir)) : 'Ridgetop Game'
  let resolvedName = options.name ?? assets.title ?? fallbackName
  let resolvedSlug = slugify(resolvedName)
  let resolvedAppId = options.appId ?? defaultAppId(resolvedSlug)

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

  for (const target of targets) {
    const dir = options.target === 'all' ? join(outRoot, target) : outRoot
    await mkdir(dir, { recursive: true })

    if (target === 'web') {
      const { detectedName } = await assembleWebBundle({ ...options, repoRoot }, dir, { themeColor })
      resolvedName = options.name ?? detectedName
      resolvedSlug = slugify(resolvedName)
      resolvedAppId = options.appId ?? defaultAppId(resolvedSlug)
      const stats = await measureDirectory(dir)
      outputs.push({ target, dir, wwwDir: dir, ...stats })
    } else if (target === 'steam') {
      const wwwDir = join(dir, 'www')
      const { detectedName } = await assembleWebBundle({ ...options, repoRoot }, wwwDir, { themeColor })
      resolvedName = options.name ?? detectedName
      resolvedSlug = slugify(resolvedName)
      resolvedAppId = options.appId ?? defaultAppId(resolvedSlug)

      await mkdir(join(dir, 'electron'), { recursive: true })
      await mkdir(join(dir, 'build'), { recursive: true })
      await writeFile(join(dir, 'electron', 'main.cjs'), renderElectronMain(resolvedName, resolvedSlug))
      await writeFile(join(dir, 'electron', 'preload.cjs'), renderElectronPreload())
      await writeFile(join(dir, 'electron', 'steam.cjs'), renderElectronSteam(steamAppId))
      await writeFile(join(dir, 'steam_appid.txt'), steamAppId + '\n')
      await writeFile(join(dir, 'electron-builder.yml'), renderElectronBuilderConfig(resolvedName, resolvedSlug, resolvedAppId))
      await writeFile(join(dir, 'README.md'), renderSteamReadme(resolvedName, resolvedSlug, resolvedAppId, steamAppId))
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        name: resolvedSlug,
        productName: resolvedName,
        version: projectVersion,
        private: true,
        main: 'electron/main.cjs',
        scripts: {
          start: 'electron .',
          dist: 'electron-builder',
          'dist:win': 'electron-builder --win',
          'dist:mac': 'electron-builder --mac',
          'dist:linux': 'electron-builder --linux'
        },
        devDependencies: {
          electron: '^35.0.0',
          'electron-builder': '^26.0.0'
        },
        optionalDependencies: {
          'steamworks.js': '^0.3.1'
        }
      }, null, 2) + '\n')

      const iconPath = join(dir, 'build', 'icon.png')
      await writeFile(iconPath, getIconPng(512))
      const stats = await measureDirectory(wwwDir)
      outputs.push({ target, dir, wwwDir, iconPath, ...stats })
    } else if (target === 'mobile') {
      const wwwDir = join(dir, 'www')
      const mobileMeta = [
        '  <meta name="apple-mobile-web-app-capable" content="yes">',
        '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
        '  <meta name="mobile-web-app-capable" content="yes">',
        '  <script src="./ridgetop-mobile-bridge.js"></script>'
      ].join('\n')
      const { detectedName } = await assembleWebBundle({ ...options, repoRoot }, wwwDir, { themeColor, extraHead: mobileMeta })
      resolvedName = options.name ?? detectedName
      resolvedSlug = slugify(resolvedName)
      resolvedAppId = options.appId ?? defaultAppId(resolvedSlug)

      await writeFile(join(wwwDir, 'ridgetop-mobile-bridge.js'), renderMobileBridgeJs(orientation))
      await writeFile(join(dir, 'capacitor.config.json'), JSON.stringify({
        appId: resolvedAppId,
        appName: resolvedName,
        webDir: 'www',
        backgroundColor: themeColor,
        ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: true },
        android: { backgroundColor: themeColor },
        plugins: {
          SplashScreen: { launchAutoHide: false, backgroundColor: themeColor, showSpinner: false },
          StatusBar: { overlaysWebView: true, style: 'DARK' }
        }
      }, null, 2) + '\n')
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        name: resolvedSlug + '-mobile',
        version: projectVersion,
        private: true,
        scripts: {
          'add:ios': 'cap add ios',
          'add:android': 'cap add android',
          sync: 'cap sync',
          icons: 'capacitor-assets generate',
          'open:ios': 'cap open ios',
          'open:android': 'cap open android'
        },
        dependencies: {
          '@capacitor/app': '^7.0.0',
          '@capacitor/core': '^7.0.0',
          '@capacitor/haptics': '^7.0.0',
          '@capacitor/preferences': '^7.0.0',
          '@capacitor/screen-orientation': '^7.0.0',
          '@capacitor/splash-screen': '^7.0.0',
          '@capacitor/status-bar': '^7.0.0'
        },
        devDependencies: {
          '@capacitor/android': '^7.0.0',
          '@capacitor/assets': '^3.0.5',
          '@capacitor/cli': '^7.0.0',
          '@capacitor/ios': '^7.0.0'
        }
      }, null, 2) + '\n')
      await writeFile(join(dir, 'README.md'), renderMobileReadme(resolvedName, resolvedAppId, orientation))

      const resourcesDir = join(dir, 'resources')
      await mkdir(resourcesDir, { recursive: true })
      const iconPng = getIconPng(1024)
      const splashPng = getIconPng(1024, 0.44)
      const iconPath = join(resourcesDir, 'icon.png')
      await writeFile(iconPath, iconPng)
      await writeFile(join(resourcesDir, 'icon-only.png'), iconPng)
      await writeFile(join(resourcesDir, 'splash.png'), splashPng)
      await writeFile(join(resourcesDir, 'splash-dark.png'), splashPng)
      const stats = await measureDirectory(wwwDir)
      outputs.push({ target, dir, wwwDir, iconPath, ...stats })
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
        uiTree: assets.uiTree,
        iconPng
      })
      await tryCompileGodotScripts(options, repoRoot, dir)
      const stats = await measureDirectory(dir)
      outputs.push({ target, dir, iconPath: join(dir, 'icon.png'), ...stats })
    }
  }

  return { name: resolvedName, slug: resolvedSlug, appId: resolvedAppId, outputs }
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
  const target = (values.target ?? 'all') as PackageTarget
  if (!['web', 'steam', 'mobile', 'godot', 'all'].includes(target)) {
    throw new Error('Unknown --target "' + target + '". Choose web, steam, mobile, godot, or all.')
  }
  const orientation = (values.orientation ?? 'landscape') as PackageOrientation
  if (!['landscape', 'portrait', 'any'].includes(orientation)) {
    throw new Error('Unknown --orientation "' + orientation + '". Choose landscape, portrait, or any.')
  }
  return {
    help: false as const,
    target,
    game: values.game as PackageGameOptions['game'] | undefined,
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
