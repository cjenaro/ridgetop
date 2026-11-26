import { Buffer } from 'node:buffer'
import { basename as posixBasename, dirname as posixDirname, join as posixJoin, normalize as posixNormalize } from 'node:path/posix'
import {
  ART_REVIEW_DEFAULT_JS_NOOP,
  ART_REVIEW_JS_NOOPS,
  BLOCKED_STUDIO_FILES,
  RIDGETOP_BROWSER_SPECIFIER_FILES,
  TESTING_RUNTIME_JS_NOOPS,
  renderArtReviewNoopNamespaceJs,
  renderTestingNoopNamespaceJs
} from './manifest.ts'

export interface ModuleStatement {
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

export interface EmbeddedAssetEntry {
  mime: string
  base64: string
}

export interface ShakeModuleGraphOptions {
  /** Entry module path relative to the bundle root (e.g. `'main.js'` or `'racing/main.js'`). */
  entry: string
  /** Read raw JS source for a normalized POSIX relative module path (e.g. `'framework/index.js'`). */
  readModule(relPath: string): Promise<string>
  /** Optional per-module source transform applied after bare-specifier rewriting and before import scanning. */
  rewriteSource?(relPath: string, code: string): string
  /**
   * Strip studio/testing/verification modules and inline manifest-defined no-op stubs for
   * `testing-runtime.js` and `art-review.js`. Defaults to `true`.
   */
  stripStudio?: boolean
  /** Barrel module paths eligible for symbol-level re-export pruning (default: `['framework/index.js', 'framework/ui.js']`). */
  barrels?: readonly string[]
}

export interface BundleStandaloneHtmlOptions {
  html: string
  readAsset(relPath: string): Promise<string>
  readModule(relPath: string): Promise<string>
  /** Optional per-module source transform applied during module graph shaking. */
  rewriteSource?(relPath: string, code: string): string
  embeddedAssets?: Readonly<Record<string, EmbeddedAssetEntry>>
  /**
   * Strip studio/testing/verification modules and inline manifest-defined no-op stubs.
   * Defaults to `true` for release players; pass `false` for studio tools (e.g. Sprite Workshop).
   */
  stripStudio?: boolean
  /** Barrel module paths eligible for symbol-level re-export pruning (default: `['framework/index.js', 'framework/ui.js']`). */
  barrels?: readonly string[]
}

const DEFAULT_BARRELS: readonly string[] = ['framework/index.js', 'framework/ui.js']

export function stripSourceMap(source: string): string {
  return source.replace(/^\/\/# sourceMappingURL=.*$/gm, '')
}

export function getHtmlAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + '`' + `]+))`, 'i')
  const match = re.exec(attrs)
  return match ? (match[1] ?? match[2] ?? match[3]) : undefined
}

export function isExternalUrl(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value.trim())
}

export function normalizeAssetPath(raw: string): string {
  const clean = raw.split(/[?#]/, 1)[0].replace(/\\/g, '/').replace(/^\/+/, '')
  return posixNormalize(clean).replace(/^\.\//, '')
}

function assertSafeBundlePath(relPath: string, label = 'Module path'): string {
  const norm = normalizeAssetPath(relPath)
  if (!norm || norm === '.' || norm === '..' || norm.startsWith('../')) {
    throw new Error(`${label} escapes bundle root: ${relPath}`)
  }
  return norm
}

export function findModuleEntryScript(html: string): string {
  for (const tag of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = tag[1]
    if (!/\btype\s*=\s*["']module["']/i.test(attrs)) continue
    const src = /\bsrc\s*=\s*["']\.?\/?([^"']+)["']/i.exec(attrs)
    if (src) return src[1]
  }
  return 'main.js'
}

export function findLocalStylesheetPaths(html: string): Set<string> {
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

/** Zero-dependency scanner for top-level static ES import/export-from statements, skipping comments, strings, regexes, and templates. */
export function scanStaticModuleStatements(code: string): ModuleStatement[] {
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

  function readIdent(): string {
    const start = i
    while (i < len) {
      const c = code.charCodeAt(i)
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 36) i++
      else break
    }
    return code.slice(start, i)
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

export function rewriteBareRidgetopSpecifiers(relPath: string, code: string): string {
  const stmts = scanStaticModuleStatements(code).filter(s => Object.hasOwn(RIDGETOP_BROWSER_SPECIFIER_FILES, s.specifier))
  if (!stmts.length) return code
  const depth = relPath.split('/').length - 1
  const prefix = (depth === 0 ? './' : '../'.repeat(depth)) + 'framework/'
  let out = code
  for (const stmt of [...stmts].sort((a, b) => b.specifierStart - a.specifierStart)) {
    const file = RIDGETOP_BROWSER_SPECIFIER_FILES[stmt.specifier]
    const quote = out[stmt.specifierStart] === '"' ? '"' : "'"
    out = out.slice(0, stmt.specifierStart) + quote + prefix + file + quote + out.slice(stmt.specifierEnd)
  }
  return out
}

interface StudioNoopContract {
  readonly noops: Readonly<Record<string, string>>
  readonly fallback: string
  renderNamespace(): string
}

const STUDIO_NOOP_CONTRACTS: Readonly<Record<string, StudioNoopContract>> = {
  'testing-runtime.js': {
    noops: TESTING_RUNTIME_JS_NOOPS,
    fallback: '() => {}',
    renderNamespace: renderTestingNoopNamespaceJs
  },
  'art-review.js': {
    noops: ART_REVIEW_JS_NOOPS,
    fallback: ART_REVIEW_DEFAULT_JS_NOOP,
    renderNamespace: renderArtReviewNoopNamespaceJs
  }
}

function getStudioNoopContract(specifier: string): StudioNoopContract | undefined {
  const file = posixBasename(specifier)
  return Object.hasOwn(STUDIO_NOOP_CONTRACTS, file) ? STUDIO_NOOP_CONTRACTS[file] : undefined
}

function renderNoopExpr(contract: StudioNoopContract, orig: string): string {
  return Object.hasOwn(contract.noops, orig) ? contract.noops[orig] : contract.fallback
}

function stripStudioModuleImports(code: string): string {
  const stmts = scanStaticModuleStatements(code).filter(s => getStudioNoopContract(s.specifier) !== undefined)
  if (!stmts.length) return code
  let out = ''
  let cursor = 0
  for (const stmt of stmts) {
    const contract = getStudioNoopContract(stmt.specifier)
    if (!contract) continue
    out += code.slice(cursor, stmt.start)
    cursor = stmt.end
    if (stmt.kind === 'import') {
      if (stmt.pairs?.length) {
        const decls = stmt.pairs.map(([orig, local]) => `${local} = ${renderNoopExpr(contract, orig)}`)
        out += `const ${decls.join(', ')};`
      } else if (stmt.namespace) {
        out += `const ${stmt.namespace} = ${contract.renderNamespace()};`
      }
    } else if (stmt.kind === 'export') {
      if (stmt.pairs?.length) {
        for (const [orig, exported] of stmt.pairs) {
          out += `export const ${exported} = ${renderNoopExpr(contract, orig)};\n`
        }
      } else if (stmt.namespace) {
        out += `export const ${stmt.namespace} = ${contract.renderNamespace()};\n`
      } else if (stmt.names === '*') {
        for (const [orig, body] of Object.entries(contract.noops)) {
          out += `export const ${orig} = ${body};\n`
        }
      }
    }
  }
  out += code.slice(cursor)
  return out
}

function pruneBarrelSource(code: string, usedNames: Set<string> | '*', stripStudio: boolean): string {
  const stmts = scanStaticModuleStatements(code).filter(s => s.kind === 'export')
  if (!stmts.length) return code
  let out = ''
  let cursor = 0
  for (const stmt of stmts) {
    out += code.slice(cursor, stmt.start)
    cursor = stmt.end
    const targetFile = posixBasename(stmt.specifier)
    if (stripStudio && BLOCKED_STUDIO_FILES.has(targetFile)) {
      const contract = getStudioNoopContract(targetFile)
      if (contract) {
        if (stmt.pairs?.length) {
          for (const [orig, exported] of stmt.pairs) {
            if (usedNames === '*' || usedNames.has(exported)) {
              out += `export const ${exported} = ${renderNoopExpr(contract, orig)};\n`
            }
          }
        } else if (stmt.namespace && (usedNames === '*' || usedNames.has(stmt.namespace))) {
          out += `export const ${stmt.namespace} = ${contract.renderNamespace()};\n`
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

function parseRelativeStaticImports(code: string) {
  return scanStaticModuleStatements(code)
    .filter(s => s.specifier.startsWith('.'))
    .map(s => ({ specifier: s.specifier, names: s.names }))
}

function resolveRelativeModule(fromRel: string, specifier: string): string {
  const dir = posixDirname(fromRel)
  const joined = dir === '.' ? specifier : posixJoin(dir, specifier)
  const norm = posixNormalize(joined).replace(/^\.\//, '')
  if (!norm || norm === '.' || norm === '..' || norm.startsWith('../')) {
    throw new Error('Module path escapes bundle root: ' + specifier)
  }
  return norm
}

/**
 * Pure in-memory ES module graph tracer, specifier rewriter, barrel pruner, and studio stripper.
 * Returns a `Map<relPath, jsSource>` containing only statically reachable modules.
 */
export async function shakeModuleGraph({
  entry,
  readModule,
  rewriteSource,
  stripStudio = true,
  barrels = DEFAULT_BARRELS
}: ShakeModuleGraphOptions): Promise<Map<string, string>> {
  const normEntry = assertSafeBundlePath(entry)
  const barrelSet = new Set(barrels.map(b => normalizeAssetPath(b)))
  const barrelNames = new Map<string, Set<string> | '*'>()
  const rawSources = new Map<string, string>()

  function isBarrel(relPath: string): boolean {
    return barrelSet.has(relPath)
  }

  function isBlocked(relPath: string): boolean {
    return stripStudio && BLOCKED_STUDIO_FILES.has(posixBasename(relPath))
  }

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

  async function loadModule(relPath: string): Promise<string> {
    const safeRel = assertSafeBundlePath(relPath)
    const cached = rawSources.get(safeRel)
    if (cached !== undefined) return cached
    let code = stripSourceMap(await readModule(safeRel))
    code = rewriteBareRidgetopSpecifiers(safeRel, code)
    if (rewriteSource) code = rewriteSource(safeRel, code)
    if (stripStudio && !isBarrel(safeRel)) code = stripStudioModuleImports(code)
    rawSources.set(safeRel, code)
    return code
  }

  // Pass 1: discover non-barrel modules and record exact symbols imported from barrels.
  const visitedNonBarrel = new Set<string>()
  async function scan(relPath: string) {
    if (isBlocked(relPath)) return
    if (isBarrel(relPath)) return
    if (visitedNonBarrel.has(relPath)) return
    visitedNonBarrel.add(relPath)
    const code = await loadModule(relPath)
    for (const imp of parseRelativeStaticImports(code)) {
      const nextRel = resolveRelativeModule(relPath, imp.specifier)
      if (isBlocked(nextRel)) continue
      if (isBarrel(nextRel)) recordBarrelUsage(nextRel, imp.names)
      else await scan(nextRel)
    }
  }

  if (isBarrel(normEntry)) {
    recordBarrelUsage(normEntry, '*')
  } else {
    await scan(normEntry)
  }

  // Pass 2: prune any reached barrels to ONLY imported symbols, then trace their surviving re-exports (including transitive barrels).
  const finalSources = new Map<string, string>()
  for (const relPath of visitedNonBarrel) {
    const src = rawSources.get(relPath)
    if (src !== undefined) finalSources.set(relPath, src)
  }

  async function traceFinal(relPath: string) {
    if (finalSources.has(relPath) && !isBarrel(relPath)) return
    if (isBlocked(relPath)) return
    let code = await loadModule(relPath)
    if (isBarrel(relPath)) {
      code = pruneBarrelSource(code, barrelNames.get(relPath) ?? new Set(), stripStudio)
    }
    finalSources.set(relPath, code)
    for (const imp of parseRelativeStaticImports(code)) {
      const nextRel = resolveRelativeModule(relPath, imp.specifier)
      if (isBlocked(nextRel)) continue
      if (isBarrel(nextRel)) {
        const changed = recordBarrelUsage(nextRel, imp.names)
        if (!finalSources.has(nextRel) || changed) await traceFinal(nextRel)
      } else if (!finalSources.has(nextRel)) {
        await traceFinal(nextRel)
      }
    }
  }

  for (const barrelRel of Array.from(barrelNames.keys())) await traceFinal(barrelRel)

  return finalSources
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
 * Bundle an HTML page's local stylesheets, tree-shaken ES module graph, and optional local assets into a
 * single self-contained offline HTML document that runs directly from `file://` without external dependencies.
 * Uses `shakeModuleGraph` in-memory with barrel pruning and optional studio stripping (`stripStudio`, default `true`).
 */
export async function bundleStandaloneHtml({
  html,
  readAsset,
  readModule,
  rewriteSource,
  embeddedAssets = {},
  stripStudio = true,
  barrels = DEFAULT_BARRELS
}: BundleStandaloneHtmlOptions): Promise<string> {
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
    const normHref = assertSafeBundlePath(href, 'Linked asset')
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

  // Locate the single local ES module entry point
  const moduleEntries: { tag: string; entry: string }[] = []
  for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1]
    const typeAttr = (getHtmlAttr(attrs, 'type') ?? '').toLowerCase()
    const srcAttr = getHtmlAttr(attrs, 'src')
    if (typeAttr !== 'module' || !srcAttr || isExternalUrl(srcAttr)) continue
    moduleEntries.push({ tag: match[0], entry: assertSafeBundlePath(srcAttr) })
  }
  if (moduleEntries.length !== 1) {
    throw new Error('Expected one local ES module entry point in the player page')
  }
  const [{ tag, entry }] = moduleEntries

  // Shake, prune barrels, and optionally strip studio modules in-memory
  const modules = await shakeModuleGraph({
    entry,
    readModule,
    rewriteSource,
    stripStudio,
    barrels
  })

  const moduleName = (rel: string) => 'ridgetop-offline/' + rel
  const imports: Record<string, string> = {}
  for (const [relPath, rawCode] of modules) {
    const stmts = scanStaticModuleStatements(rawCode)
    let source = rawCode
    for (const stmt of [...stmts].sort((a, b) => b.specifierStart - a.specifierStart)) {
      if (!stmt.specifier.startsWith('.')) {
        throw new Error('Expected a local module in ' + relPath + ', got ' + stmt.specifier)
      }
      const child = resolveRelativeModule(relPath, stmt.specifier)
      if (!modules.has(child)) {
        throw new Error(`Resolved module missing from graph: ${child} (imported by ${relPath})`)
      }
      source = source.slice(0, stmt.specifierStart) + JSON.stringify(moduleName(child)) + source.slice(stmt.specifierEnd)
    }
    imports[moduleName(relPath)] = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64')
  }

  const scriptParts: string[] = []
  if (Object.keys(embeddedAssets).length > 0) {
    scriptParts.push('<script>\n' + renderOfflineAssetShim(embeddedAssets) + '\n</script>')
  }
  scriptParts.push('<script type="importmap">' + JSON.stringify({ imports }).replaceAll('<', '\\u003c') + '</script>')
  const entryLiteral = JSON.stringify(moduleName(entry)).replaceAll('<', '\\u003c')
  scriptParts.push(`<script type="module">import ${entryLiteral}</script>`)
  return page.replace(tag, () => scriptParts.join('\n'))
}
