import { existsSync } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { dirname as posixDirname, join as posixJoin, normalize as posixNormalize } from 'node:path/posix'
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

const blockedStudioFiles = new Set([
  'serve.js', 'testing.js', 'testing-scene.js', 'testing.html', 'testing.css',
  'testing-runtime.js', 'testing-boot.js', 'testing-studio.js', 'testing-overlay.css',
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
  specifierStart: number
  specifierEnd: number
  names: Set<string> | '*'
  exportedNames?: string[]
  pairs?: readonly (readonly [string, string])[]
  namespace?: string
}

function resolveContained(baseDir: string, relPath: string, label: string): string {
  const base = resolve(baseDir)
  const target = resolve(base, relPath)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`${label} escapes project root: ${relPath}`)
  }
  return target
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

  const regexPrevKeywords = new Set([
    'return', 'case', 'throw', 'typeof', 'void', 'delete', 'in', 'instanceof', 'of', 'new', 'yield', 'await', 'else', 'do'
  ])
  const regexPrevPunct = new Set([
    '', '(', '[', '{', ',', ';', ':', '?', '!', '=', '&', '|', '^', '~', '+', '-', '*', '%', '<', '>', '/'
  ])
  function canStartRegex(prev: string) {
    return regexPrevPunct.has(prev) || regexPrevKeywords.has(prev)
  }

  function skipRegExp() {
    i++ // opening '/'
    let inClass = false
    while (i < len) {
      const c = code.charCodeAt(i++)
      if (c === 92 && i < len) { i++; continue }
      if (c === 91) { inClass = true; continue }
      if (c === 93) { inClass = false; continue }
      if (c === 47 && !inClass) break
      if (c === 10 || c === 13) break
    }
    while (i < len) {
      const c = code.charCodeAt(i)
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) i++
      else break
    }
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
        let tplPrev = '{'
        while (i < len && depth > 0) {
          skipWsAndComments()
          if (i >= len) break
          const ch = code.charCodeAt(i)
          if (ch === 39 || ch === 34) { readString(); tplPrev = 'str'; continue }
          if (ch === 96) { skipTemplate(); tplPrev = 'tpl'; continue }
          if (ch === 47 && canStartRegex(tplPrev)) { skipRegExp(); tplPrev = 'regex'; continue }
          if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === 95 || ch === 36) {
            tplPrev = readIdent()
            continue
          }
          if (ch === 123) depth++
          else if (ch === 125) depth--
          if ((ch === 43 || ch === 45) && code.charCodeAt(i + 1) === ch) {
            tplPrev = ch === 43 ? '++' : '--'
            i += 2
            continue
          }
          tplPrev = code[i++]
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

  function parseNamedList(): { localOrOrig: Set<string>; exported: string[]; pairs: [string, string][] } | null {
    if (code.charCodeAt(i) !== 123) return null
    i++ // '{'
    const localOrOrig = new Set<string>()
    const exported: string[] = []
    const pairs: [string, string][] = []
    while (i < len) {
      skipWsAndComments()
      if (i >= len) return null
      if (code.charCodeAt(i) === 125) { i++; return { localOrOrig, exported, pairs } }
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
      pairs.push([first, second])
      skipWsAndComments()
      if (code.charCodeAt(i) === 44) i++
      else if (code.charCodeAt(i) === 125) { i++; return { localOrOrig, exported, pairs } }
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
    if (ch === 47 && canStartRegex(prevToken)) { skipRegExp(); prevToken = 'regex'; continue }
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
          const specifierStart = i
          const spec = readString()
          const specifierEnd = i
          if (spec !== null) {
            skipWsAndComments()
            if (code.charCodeAt(i) === 59) i++
            results.push({ kind: 'import', start, end: i, specifier: spec, specifierStart, specifierEnd, names: '*' })
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
        let pairs: [string, string][] | undefined
        let namespace: string | undefined
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
            namespace = readIdent() || undefined
          }
          names = '*'
        } else if (code.charCodeAt(i) === 123) {
          const list = parseNamedList()
          if (!list) valid = false
          else {
            hasClause = true
            names = list.localOrOrig
            exportedNames = list.exported
            pairs = list.pairs
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
                  namespace = readIdent() || undefined
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
            const specifierStart = i
            const spec = readString()
            const specifierEnd = i
            if (spec !== null) {
              skipWsAndComments()
              if (code.charCodeAt(i) === 59) i++
              results.push({ kind: word, start, end: i, specifier: spec, specifierStart, specifierEnd, names, exportedNames, pairs, namespace })
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
    if ((ch === 43 || ch === 45) && code.charCodeAt(i + 1) === ch) {
      prevToken = ch === 43 ? '++' : '--'
      i += 2
      continue
    }
    prevToken = code[i++]
  }
  return results
}

const RIDGETOP_SPECIFIER_FILES: Readonly<Record<string, string>> = {
  ridgetop: 'index.js',
  'ridgetop/ui': 'ui.js',
  'ridgetop/ui-layout': 'ui-layout.js',
  'ridgetop/ui-button': 'ui-button.js',
  'ridgetop/ui-toggle': 'ui-toggle.js',
  'ridgetop/ui-select': 'ui-select.js',
  'ridgetop/ui-slider': 'ui-slider.js',
  'ridgetop/ui-menu': 'ui-menu.js',
  'ridgetop/ui-canvas': 'ui-canvas.js',
  'ridgetop/ui-machine': 'ui-machine.js',
  'ridgetop/art-review': 'art-review.js',
  'ridgetop/testing': 'testing-runtime.js'
}

function resolvePackageFrameworkDir(): string {
  if (import.meta.url.endsWith('.ts')) {
    return resolve(fileURLToPath(new URL('../dist/framework', import.meta.url)))
  }
  return resolve(fileURLToPath(new URL('.', import.meta.url)))
}

function rewriteBareRidgetopSpecifiers(relPath: string, code: string): string {
  const stmts = scanStaticModuleStatements(code).filter(s => Object.hasOwn(RIDGETOP_SPECIFIER_FILES, s.specifier))
  if (!stmts.length) return code
  const depth = relPath.split('/').length - 1
  const prefix = (depth === 0 ? './' : '../'.repeat(depth)) + 'framework/'
  let out = code
  for (const stmt of [...stmts].sort((a, b) => b.specifierStart - a.specifierStart)) {
    const file = RIDGETOP_SPECIFIER_FILES[stmt.specifier]
    const quote = out[stmt.specifierStart] === '"' ? '"' : "'"
    out = out.slice(0, stmt.specifierStart) + quote + prefix + file + quote + out.slice(stmt.specifierEnd)
  }
  return out
}

function parseStaticImports(code: string) {
  return scanStaticModuleStatements(code)
    .filter(s => s.specifier.startsWith('.'))
    .map(s => ({ specifier: s.specifier, names: s.names }))
}

const INLINE_RUNTIME_RNG = {
  nextRandom: `export function nextRandom(seed) {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}`,
  createRng: `export function createRng(initialSeed = 1337) {
  let state = initialSeed | 0;
  return {
    get seed() { return state; },
    next() {
      const step = nextRandom(state);
      state = step.seed;
      return step.value;
    }
  };
}`
}

const INLINE_TESTING_NOOPS: Record<string, string> = {
  isTestingActive: '() => false',
  isTestingPaused: '() => false',
  setTestingActive: '() => {}',
  setTestingPaused: '() => {}',
  onTestingPause: '() => () => {}',
  captureSourceSite: '() => undefined',
  registerKnownShapes: '() => {}',
  getKnownShapeName: '() => undefined',
  recordMeshMeta: '() => {}',
  getMeshMeta: '() => undefined',
  recordRigMeta: '() => {}',
  getRigMeta: '() => undefined',
  nextTestingGroupId: '() => ""',
  nextSpriteAtlasId: '() => ""',
  registerArtKitRuntime: '() => () => {}',
  getRegisteredArtKits: '() => []',
  findRegisteredArtModel: '() => undefined',
  recordFrame: '() => {}',
  getLastFrame: '() => undefined',
  recordSpriteBegin: '() => {}',
  recordSpriteDraw: '() => {}',
  getLastSpriteDraws: '() => []',
  registerHudRegion: '() => () => {}',
  recordCanvasUiRegions: '() => {}',
  getHudRegions: '() => []',
  registerTestingHooks: '() => () => {}',
  getTestingHooks: '() => []',
  resetTestingRuntime: '() => {}'
}

function renderTestingNoopNamespaceObject(): string {
  const entries = Object.entries(INLINE_TESTING_NOOPS).map(([k, v]) => `${k}: ${v}`).join(', ')
  return `Object.freeze({ ${entries} })`
}

function stripTestingRuntimeImports(code: string) {
  const stmts = scanStaticModuleStatements(code).filter(
    s => basename(s.specifier) === 'testing-runtime.js'
  )
  if (!stmts.length) return code
  let out = ''
  let cursor = 0
  for (const stmt of stmts) {
    out += code.slice(cursor, stmt.start)
    cursor = stmt.end
    if (stmt.kind === 'import') {
      if (stmt.pairs?.length) {
        const decls = stmt.pairs.map(([orig, local]) => `${local} = ${INLINE_TESTING_NOOPS[orig] ?? '() => {}'}`)
        out += `const ${decls.join(', ')};`
      } else if (stmt.namespace) {
        out += `const ${stmt.namespace} = ${renderTestingNoopNamespaceObject()};`
      }
    } else if (stmt.kind === 'export') {
      if (stmt.pairs?.length) {
        for (const [orig, exported] of stmt.pairs) {
          out += `export const ${exported} = ${INLINE_TESTING_NOOPS[orig] ?? '() => {}'};\n`
        }
      } else if (stmt.namespace) {
        out += `export const ${stmt.namespace} = ${renderTestingNoopNamespaceObject()};\n`
      } else if (stmt.names === '*') {
        for (const [orig, body] of Object.entries(INLINE_TESTING_NOOPS)) {
          out += `export const ${orig} = ${body};\n`
        }
      }
    }
  }
  out += code.slice(cursor)
  return out
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
    if (blockedStudioFiles.has(targetFile)) {
      if (targetFile === 'verification.js') {
        const needCreateRng = usedNames === '*' || usedNames.has('createRng')
        const needNextRandom = usedNames === '*' || usedNames.has('nextRandom') || needCreateRng
        if (needNextRandom) out += INLINE_RUNTIME_RNG.nextRandom + '\n'
        if (needCreateRng) out += INLINE_RUNTIME_RNG.createRng + '\n'
      } else if (targetFile === 'testing-runtime.js' && stmt.pairs?.length) {
        for (const [orig, exported] of stmt.pairs) {
          if (usedNames === '*' || usedNames.has(exported)) {
            out += `export const ${exported} = ${INLINE_TESTING_NOOPS[orig] ?? '() => {}'};\n`
          }
        }
      }
      continue
    }
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

  const resolvedRoot = resolve(wwwDir)
  function assertWithinRoot(relPath: string) {
    const dst = resolve(resolvedRoot, relPath)
    if (dst !== resolvedRoot && !dst.startsWith(resolvedRoot + sep)) {
      throw new Error('Module path escapes bundle root: ' + relPath)
    }
    return dst
  }

  async function loadModule(relPath: string): Promise<string> {
    assertWithinRoot(relPath)
    const cached = rawSources.get(relPath)
    if (cached !== undefined) return cached
    let code = stripSourceMap(await readFile(resolveSource(relPath), 'utf8'))
    code = rewriteBareRidgetopSpecifiers(relPath, code)
    if (rewriteSource) code = rewriteSource(relPath, code)
    if (!isBarrel(relPath)) code = stripTestingRuntimeImports(code)
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
  for (const relPath of visitedNonBarrel) {
    const src = rawSources.get(relPath)
    if (src !== undefined) finalSources.set(relPath, src)
  }

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

  for (const [relPath, code] of finalSources) {
    const dst = assertWithinRoot(relPath)
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

export interface ResolvedGameAssets {
  title?: string
  icon: { batches: readonly InstanceBatch[]; span: number; centerY: number; background: string; accent: string }
  models: Record<string, readonly InstanceBatch[]>
  audio: Record<string, { notes: readonly (readonly [number, number, number, number?])[]; waveform?: 'sine' | 'triangle' | 'square' | 'sawtooth' }>
  gameData: Record<string, unknown>
  uiTree: LayoutNode
}

export function defaultMenuLayout(title: string, actions: readonly string[], anchor: 'center' | 'top-left' = 'center'): LayoutNode {
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

function resolvePackageRootDir(): string {
  if (import.meta.url.endsWith('.ts')) {
    return resolve(fileURLToPath(new URL('..', import.meta.url)))
  }
  const parentTwo = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  if (existsSync(join(parentTwo, 'package.json'))) return parentTwo
  return resolve(fileURLToPath(new URL('..', import.meta.url)))
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

async function resolveProjectAssets(projectDir: string, config: RidgetopProjectConfig): Promise<ResolvedGameAssets> {
  if (config.assetsModule) {
    const modPath = resolve(projectDir, config.assetsModule)
    try {
      const mod = await import(pathToFileURL(modPath).href)
      if (typeof mod.resolvePackageAssets === 'function') {
        return await mod.resolvePackageAssets({ projectDir, defaultMenuLayout })
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
    uiTree: defaultMenuLayout(title ?? 'Ridgetop Game', ['Resume', 'Restart', 'Quit'])
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

async function assembleWebBundle(
  projectDir: string,
  config: RidgetopProjectConfig,
  wwwDir: string,
  { themeColor, extraHead = '' }: { themeColor: string; extraHead?: string }
): Promise<{ detectedName?: string }> {
  await rm(wwwDir, { recursive: true, force: true })
  await mkdir(wwwDir, { recursive: true })

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
  await writeFile(join(wwwDir, 'index.html'), ensureMobileMeta(normalizedHtml, themeColor, extraHead))

  const copiedFiles = new Set<string>()
  if (config.staticFiles?.length || config.staticDirs?.length) {
    for (const relFile of config.staticFiles ?? []) {
      const src = resolveContained(projectDir, relFile, 'staticFile')
      const dst = resolveContained(wwwDir, relFile, 'staticFile')
      await mkdir(dirname(dst), { recursive: true })
      await cp(src, dst)
      copiedFiles.add(relFile)
    }
    for (const relDir of config.staticDirs ?? []) {
      const srcDir = resolveContained(projectDir, relDir, 'staticDir')
      const dstDir = resolveContained(wwwDir, relDir, 'staticDir')
      await copyDirFiltered(srcDir, dstDir)
    }
    // Also copy any local stylesheet or icon linked from index.html if not already copied.
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
      if (copiedFiles.has(normHref)) continue
      const src = resolveContained(layout.htmlDir, normHref, 'linked asset')
      if (existsSync(src)) {
        const dst = resolveContained(wwwDir, normHref, 'linked asset')
        await mkdir(dirname(dst), { recursive: true })
        await cp(src, dst)
        copiedFiles.add(normHref)
      }
    }
  } else {
    for (const entry of await readdir(layout.htmlDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (blockedStudioDirs.has(entry.name) || entry.name === 'framework') continue
        await copyDirFiltered(join(layout.htmlDir, entry.name), join(wwwDir, entry.name), { skipJs: true })
      } else if (
        entry.isFile() &&
        !entry.name.endsWith('.js') &&
        !entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.map') &&
        !skippedProjectRootFiles.has(entry.name) &&
        !blockedStudioFiles.has(entry.name)
      ) {
        await cp(join(layout.htmlDir, entry.name), join(wwwDir, entry.name))
      }
    }
  }

  if (config.overridesReset) {
    const resetPath = resolveContained(wwwDir, config.overridesReset, 'overridesReset')
    await mkdir(dirname(resetPath), { recursive: true })
    await writeFile(resetPath, '{}\n')
  }

  const entryRel = config.entry ?? findModuleEntryScript(normalizedHtml)
  await emitShakenModules({
    entryRelPath: entryRel,
    wwwDir,
    resolveSource(relPath) {
      if (relPath.startsWith('framework/')) return join(frameworkDir, relPath.slice('framework/'.length))
      return join(layout.moduleDir, relPath)
    },
    rewriteSource(relPath, code) {
      let out = layout.isCreateGameLayout ? rewriteFrameworkImports(relPath, code) : code
      const rewrites = config.assetPathRewrites?.[relPath]
      if (rewrites) {
        for (const [from, to] of Object.entries(rewrites)) {
          out = out.replaceAll(from, to)
        }
      }
      return out
    }
  })

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
  return { detectedName }
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
  const out = Object.create(null)
  try {
    const parsed = JSON.parse(fs.readFileSync(saveFile, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && typeof v === 'string') {
          out[k] = v
        }
      }
    }
  } catch {}
  return out
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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(SCHEME + '://app/')) event.preventDefault()
  })
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen())
    }
  })
  const sendLife = state => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('ridgetop:lifecycle', state)
    }
  }
  win.on('minimize', () => sendLife('pause'))
  win.on('restore', () => sendLife('resume'))
  win.on('blur', () => sendLife('pause'))
  win.on('focus', () => sendLife('resume'))

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
      if (pathname.includes('\\0')) {
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

    ipcMain.on('ridgetop:storage-load', event => { event.returnValue = { ...getSaves() } })
    ipcMain.on('ridgetop:storage-set', (_event, key, value) => {
      const k = String(key)
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return
      const data = getSaves()
      data[k] = String(value)
      persistSaves(data)
    })
    ipcMain.on('ridgetop:storage-remove', (_event, key) => {
      const k = String(key)
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return
      const data = getSaves()
      delete data[k]
      persistSaves(data)
    })
    ipcMain.on('ridgetop:storage-clear', () => {
      saveCache = Object.create(null)
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
  return `appId: ${JSON.stringify(appId)}
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
  executableName: ${JSON.stringify(slug)}
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
  const hydrateListeners = new Set()
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
            for (const fn of hydrateListeners) {
              try { fn(bare, item.value) } catch {}
            }
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
      },
      onHydrate: function (listener) {
        if (typeof listener !== 'function') return function () {}
        hydrateListeners.add(listener)
        return function () { hydrateListeners.delete(listener) }
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

const GODOT_RUNTIME_RNG_GD = `extends RefCounted
# Pure deterministic Mulberry32 PRNG runtime shim for Godot 4 (studio verification code stripped).

static func _i32(v: int) -> int:
\tv = v & 0xFFFFFFFF
\treturn v - 0x100000000 if v >= 0x80000000 else v

static func _u32(v: int) -> int:
\treturn v & 0xFFFFFFFF

static func _imul(a: int, b: int) -> int:
\treturn _i32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF))

func nextRandom(seed_val = 0) -> Dictionary:
\tvar next_seed := _i32(int(seed_val) + 0x6d2b79f5)
\tvar t := _imul(next_seed ^ (_u32(next_seed) >> 15), 1 | next_seed)
\tt = _i32(t + _imul(t ^ (_u32(t) >> 7), 61 | t)) ^ t
\treturn { "value": float(_u32(t ^ (_u32(t) >> 14))) / 4294967296.0, "seed": next_seed }

func createRng(initial_seed = 1337) -> Dictionary:
\tvar box := [_i32(int(initial_seed))]
\treturn {
\t\t"seed": { "__rt_getter": func(): return box[0] },
\t\t"next": func():
\t\t\tvar step := nextRandom(box[0])
\t\t\tbox[0] = int(step["seed"])
\t\t\treturn step["value"]
\t}

func __init_module() -> void:
\tpass
`

async function tryCompileGodotScripts(projectDir: string, config: RidgetopProjectConfig, godotDir: string): Promise<number> {
  const pkgRoot = resolvePackageRootDir()
  const candidates = [
    join(pkgRoot, 'tools', 'ts-to-gd.ts'),
    join(pkgRoot, 'dist', 'tools', 'ts-to-gd.js'),
    join(projectDir, 'tools', 'ts-to-gd.js')
  ]
  let compilerPath: string | null = null
  for (const candidate of candidates) {
    try { await access(candidate); compilerPath = candidate; break } catch { /* Candidate compiler path not present; try next. */ }
  }
  if (!compilerPath) return 0

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
    const mod = await import(pathToFileURL(compilerPath).href)
    if (typeof mod.compileTsProjectToGodot !== 'function') return 0
    const compiled = await mod.compileTsProjectToGodot({
      entries,
      rootDir: projectDir,
      outDir: compiledDir
    })
    // Strip studio verification helpers if pulled transitively for pure runtime PRNG (nextRandom/createRng).
    const verificationGd = join(compiledDir, 'framework', 'verification.gd')
    if (await access(verificationGd).then(() => true, () => false)) {
      await writeFile(verificationGd, GODOT_RUNTIME_RNG_GD)
    }
    return Array.isArray(compiled?.files) ? compiled.files.length : 0
  } catch {
    await rm(compiledDir, { recursive: true, force: true }).catch(() => {})
    return 0
  }
}

const EMBEDDED_ASSET_MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.obj': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
}

export interface EmbeddedAssetEntry {
  mime: string
  base64: string
}

function getHtmlAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`, 'i')
  const match = re.exec(attrs)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

function isExternalUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value.trim())
}

function normalizeAssetPath(raw: string): string {
  const clean = raw.split(/[?#]/, 1)[0].replace(/\\/g, '/').replace(/^\/+/, '')
  return posixNormalize(clean).replace(/^\.\//, '')
}

function rewriteCssAssetUrls(css: string, cssRelPath: string, embeddedAssets: Readonly<Record<string, EmbeddedAssetEntry>>): string {
  const cssDir = posixDirname(cssRelPath)
  return css.replace(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/gi, (full, dq, sq, bare) => {
    const raw = dq ?? sq ?? bare ?? ''
    if (!raw || isExternalUrl(raw)) return full
    const target = normalizeAssetPath(raw.startsWith('/') ? raw : posixJoin(cssDir, raw))
    const entry = Object.hasOwn(embeddedAssets, target) ? embeddedAssets[target] : undefined
    if (!entry) return full
    return `url("data:${entry.mime};base64,${entry.base64}")`
  })
}

function renderOfflineAssetShim(embeddedAssets: Readonly<Record<string, EmbeddedAssetEntry>>): string {
  const compact: Record<string, readonly [string, string]> = {}
  for (const [key, entry] of Object.entries(embeddedAssets)) {
    compact[key] = [entry.mime, entry.base64]
  }
  const serialized = JSON.stringify(compact).replaceAll('<', '\\u003c')
  return `(function () {
  var ASSETS = ${serialized};
  globalThis.__ridgetopOfflineAssets = ASSETS;
  var baseHref = 'https://ridgetop.local/';
  try {
    if (typeof location !== 'undefined' && location && location.href) {
      baseHref = new URL('./', location.href).href;
    }
  } catch {}
  function hasAsset(key) {
    return Object.prototype.hasOwnProperty.call(ASSETS, key);
  }
  function resolveAssetKey(raw) {
    if (typeof raw !== 'string' || !raw || raw.startsWith('data:') || raw.startsWith('blob:')) return null;
    var cleanRaw = raw.split(/[?#]/, 1)[0];
    var direct = cleanRaw.replace(/^\\.?\\//, '').replace(/\\\\/g, '/');
    if (hasAsset(direct)) return direct;
    try {
      var decodedDirect = decodeURIComponent(direct);
      if (hasAsset(decodedDirect)) return decodedDirect;
    } catch {}
    try {
      var resolved = new URL(raw, baseHref).href.split(/[?#]/, 1)[0];
      if (resolved.startsWith(baseHref)) {
        var rel = resolved.slice(baseHref.length);
        if (hasAsset(rel)) return rel;
        try {
          var decodedRel = decodeURIComponent(rel);
          if (hasAsset(decodedRel)) return decodedRel;
        } catch {}
      }
    } catch {}
    return null;
  }
  function decodeBase64(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function dataUriFor(key) {
    var entry = ASSETS[key];
    return 'data:' + entry[0] + ';base64,' + entry[1];
  }
  var origFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  globalThis.fetch = function (input, init) {
    var rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input && typeof input === 'object' && 'url' in input
          ? String(input.url)
          : '';
    var key = resolveAssetKey(rawUrl);
    if (key) {
      var entry = ASSETS[key];
      var bytes = decodeBase64(entry[1]);
      var method = ((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
      var res = new Response(method === 'HEAD' ? null : bytes, {
        status: 200,
        statusText: 'OK',
        headers: {
          'Content-Type': entry[0],
          'Content-Length': String(bytes.byteLength)
        }
      });
      try {
        Object.defineProperty(res, 'url', { value: new URL(key, baseHref).href, configurable: true });
      } catch {}
      return Promise.resolve(res);
    }
    if (!origFetch) return Promise.reject(new TypeError('Offline asset not found: ' + rawUrl));
    return origFetch(input, init);
  };
  function patchSrcSetter(ctor) {
    if (typeof ctor === 'undefined' || !ctor.prototype) return;
    var desc = Object.getOwnPropertyDescriptor(ctor.prototype, 'src');
    if (!desc || !desc.set) return;
    Object.defineProperty(ctor.prototype, 'src', {
      configurable: true,
      enumerable: desc.enumerable,
      get: desc.get,
      set: function (value) {
        var key = resolveAssetKey(String(value));
        desc.set.call(this, key ? dataUriFor(key) : value);
      }
    });
  }
  patchSrcSetter(globalThis.HTMLImageElement);
  patchSrcSetter(globalThis.HTMLMediaElement);
  if (typeof Element !== 'undefined' && Element.prototype && typeof Element.prototype.setAttribute === 'function') {
    var origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === 'src' && (this.tagName === 'IMG' || this.tagName === 'AUDIO' || this.tagName === 'VIDEO')) {
        var key = resolveAssetKey(String(value));
        if (key) return origSetAttribute.call(this, name, dataUriFor(key));
      }
      return origSetAttribute.call(this, name, value);
    };
  }
})();`
}

/**
 * Bundle an HTML page's local stylesheets, static ES module graph, and optional local assets into a
 * single self-contained offline HTML document that runs directly from `file://` without external dependencies.
 */
export async function bundleStandaloneHtml({
  html,
  readAsset,
  readModule,
  embeddedAssets = {}
}: {
  html: string
  readAsset(relPath: string): Promise<string>
  readModule(relPath: string): Promise<string>
  embeddedAssets?: Readonly<Record<string, EmbeddedAssetEntry>>
}): Promise<string> {
  const imports: Record<string, string> = {}
  const moduleName = (rel: string) => 'ridgetop-offline/' + rel
  const visited = new Set<string>()

  async function includeModule(relPath: string) {
    const norm = normalizeAssetPath(relPath)
    if (norm.startsWith('../') || norm === '..') {
      throw new Error('Module path escapes bundle root: ' + relPath)
    }
    if (visited.has(norm)) return
    visited.add(norm)
    let source = stripSourceMap(await readModule(norm))
    const stmts = scanStaticModuleStatements(source)
    const children: string[] = []
    for (const stmt of [...stmts].sort((a, b) => b.specifierStart - a.specifierStart)) {
      let child: string
      if (stmt.specifier.startsWith('.')) {
        child = normalizeAssetPath(posixJoin(posixDirname(norm), stmt.specifier))
      } else if (Object.hasOwn(RIDGETOP_SPECIFIER_FILES, stmt.specifier)) {
        child = 'framework/' + RIDGETOP_SPECIFIER_FILES[stmt.specifier]
      } else {
        throw new Error('Expected a local module in ' + norm + ', got ' + stmt.specifier)
      }
      if (child.startsWith('../') || child === '..') {
        throw new Error('Module path escapes bundle root: ' + stmt.specifier)
      }
      children.push(child)
      source = source.slice(0, stmt.specifierStart) + JSON.stringify(moduleName(child)) + source.slice(stmt.specifierEnd)
    }
    imports[moduleName(norm)] = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64')
    for (const child of children) await includeModule(child)
  }

  let page = html

  // Inline local stylesheets and inline icon links matching embedded assets
  const linkMatches = [...page.matchAll(/<link\b([^>]*)>/gi)]
  for (const match of linkMatches) {
    const tag = match[0]
    const attrs = match[1]
    const rel = (getHtmlAttr(attrs, 'rel') ?? '').toLowerCase()
    const href = getHtmlAttr(attrs, 'href')
    if (!href || isExternalUrl(href)) continue
    const relTokens = rel.split(/\s+/).filter(Boolean)
    const normHref = normalizeAssetPath(href)
    if (!normHref || normHref === '..' || normHref.startsWith('../')) {
      throw new Error(`Linked asset escapes bundle root: ${href}`)
    }
    if (relTokens.includes('stylesheet')) {
      const rawCss = await readAsset(normHref)
      const rewrittenCss = rewriteCssAssetUrls(rawCss, normHref, embeddedAssets)
      const safeCss = rewrittenCss.replace(/<\/style/gi, '<\\/style')
      page = page.replace(tag, () => '<style>\n' + safeCss + '\n</style>')
    } else if (relTokens.includes('icon') || relTokens.includes('apple-touch-icon')) {
      const asset = Object.hasOwn(embeddedAssets, normHref) ? embeddedAssets[normHref] : undefined
      if (asset) {
        const dataUri = `data:${asset.mime};base64,${asset.base64}`
        const updatedTag = tag.replace(/\bhref\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+)/i, () => `href="${dataUri}"`)
        page = page.replace(tag, () => updatedTag)
      }
    }
  }

  // Inline the single local ES module entry point using an importmap + base64 data URIs
  const moduleEntries: { tag: string; entry: string }[] = []
  for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1]
    const typeAttr = (getHtmlAttr(attrs, 'type') ?? '').toLowerCase()
    const srcAttr = getHtmlAttr(attrs, 'src')
    if (typeAttr !== 'module' || !srcAttr || isExternalUrl(srcAttr)) continue
    moduleEntries.push({ tag: match[0], entry: normalizeAssetPath(srcAttr) })
  }
  if (moduleEntries.length !== 1) {
    throw new Error('Expected one local ES module entry point in the player page')
  }
  const [{ tag, entry }] = moduleEntries
  await includeModule(entry)

  const scriptParts: string[] = []
  if (Object.keys(embeddedAssets).length > 0) {
    scriptParts.push('<script>\n' + renderOfflineAssetShim(embeddedAssets) + '\n</script>')
  }
  scriptParts.push('<script type="importmap">' + JSON.stringify({ imports }).replaceAll('<', '\\u003c') + '</script>')
  const entryLiteral = JSON.stringify(moduleName(entry)).replaceAll('<', '\\u003c')
  scriptParts.push(`<script type="module">import ${entryLiteral}</script>`)
  return page.replace(tag, () => scriptParts.join('\n'))
}

async function collectEmbeddedAssets(wwwDir: string, inlinedStylesheets: ReadonlySet<string>): Promise<Record<string, EmbeddedAssetEntry>> {
  const assets: Record<string, EmbeddedAssetEntry> = {}
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const rel = relative(wwwDir, full).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        if (blockedStudioDirs.has(entry.name)) continue
        await walk(full)
      } else if (entry.isFile()) {
        if (blockedStudioFiles.has(entry.name)) continue
        if (rel === 'index.html' || inlinedStylesheets.has(rel)) continue
        const ext = extname(entry.name).toLowerCase()
        if (ext === '.js' || ext === '.mjs' || ext === '.map') continue
        const bytes = await readFile(full)
        assets[rel] = {
          mime: EMBEDDED_ASSET_MIME[ext] ?? 'application/octet-stream',
          base64: bytes.toString('base64')
        }
      }
    }
  }
  await walk(wwwDir)
  return assets
}

function findLocalStylesheetPaths(html: string): Set<string> {
  const paths = new Set<string>()
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = match[1]
    const rel = (getHtmlAttr(attrs, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    const href = getHtmlAttr(attrs, 'href')
    if (rel.includes('stylesheet') && href && !isExternalUrl(href)) {
      paths.add(normalizeAssetPath(href))
    }
  }
  return paths
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

  for (const target of targets) {
    const dir = options.target === 'all' ? join(outRoot, target) : outRoot
    await mkdir(dir, { recursive: true })

    if (target === 'web') {
      const { detectedName } = await assembleWebBundle(projectDir, config, dir, { themeColor })
      resolvedName = options.name ?? config.name ?? detectedName ?? assets.title ?? fallbackName
      resolvedSlug = slugify(resolvedName)
      resolvedAppId = options.appId ?? config.appId ?? defaultAppId(resolvedSlug)
      const stats = await measureDirectory(dir)
      outputs.push({ target, dir, wwwDir: dir, ...stats })
    } else if (target === 'steam') {
      const wwwDir = join(dir, 'www')
      const { detectedName } = await assembleWebBundle(projectDir, config, wwwDir, { themeColor })
      resolvedName = options.name ?? config.name ?? detectedName ?? assets.title ?? fallbackName
      resolvedSlug = slugify(resolvedName)
      resolvedAppId = options.appId ?? config.appId ?? defaultAppId(resolvedSlug)

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
      const { detectedName } = await assembleWebBundle(projectDir, config, wwwDir, { themeColor, extraHead: mobileMeta })
      resolvedName = options.name ?? config.name ?? detectedName ?? assets.title ?? fallbackName
      resolvedSlug = slugify(resolvedName)
      resolvedAppId = options.appId ?? config.appId ?? defaultAppId(resolvedSlug)

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
    } else if (target === 'player') {
      const stageDir = await mkdtemp(join(tmpdir(), 'ridgetop-player-stage-'))
      try {
        const { detectedName } = await assembleWebBundle(projectDir, config, stageDir, { themeColor })
        resolvedName = options.name ?? config.name ?? detectedName ?? assets.title ?? fallbackName
        resolvedSlug = slugify(resolvedName)
        resolvedAppId = options.appId ?? config.appId ?? defaultAppId(resolvedSlug)

        const stageHtml = await readFile(join(stageDir, 'index.html'), 'utf8')
        const linkedStyles = findLocalStylesheetPaths(stageHtml)
        const embeddedAssets = await collectEmbeddedAssets(stageDir, linkedStyles)
        const playerHtml = await bundleStandaloneHtml({
          html: stageHtml,
          readAsset: relPath => readFile(resolveContained(stageDir, relPath, 'asset'), 'utf8'),
          readModule: relPath => readFile(resolveContained(stageDir, relPath, 'module'), 'utf8'),
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
      } finally {
        await rm(stageDir, { recursive: true, force: true })
      }
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
