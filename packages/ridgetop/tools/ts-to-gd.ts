import { existsSync } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { readGodotRuntimeTemplate } from '../framework/export-godot.ts'
import { RIDGETOP_ALL_SPECIFIER_FILES, renderTestingNoopGd } from '../framework/manifest.ts'
import { isMain } from '../framework/server.ts'
import { analyzeModule, bindingContainsName } from './gd-analysis.ts'
import type { ImportResolver, ModuleAnalysis } from './gd-analysis.ts'
import { emitModuleGd } from './gd-emit.ts'

export { analyzeModule, findBoxedVars } from './gd-analysis.ts'
export type { ExportAlias, ImportResolver, ModuleAnalysis, ModuleImportBinding } from './gd-analysis.ts'
export { createEmitContext, emitExpr, emitModuleGd, emitStmt } from './gd-emit.ts'
export type { GdEmitContext, HoistFrame } from './gd-emit.ts'

/** Godot 4 runtime helper providing exact JS semantics for compiled Ridgetop TypeScript modules. */
export function renderRtGd(): string {
  return readGodotRuntimeTemplate('rt.gd')
}

export interface CompileFileOptions {
  /** Absolute or project-relative path to `rt.gd` in Godot `res://` format. */
  rtResPath?: string
  /** Resolve an imported specifier + symbol name to a Godot `res://...gd` path. */
  resolveImport?: ImportResolver
}

/** Compile a TypeScript source file into idiomatic Godot 4 GDScript. */
export function compileTsToGd(sourceText: string, fileName = 'module.ts', options: CompileFileOptions = {}): string {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
  const rtResPath = options.rtResPath ?? 'res://scripts/compiled/rt.gd'
  const analysis: ModuleAnalysis = analyzeModule(sf, options.resolveImport)
  return emitModuleGd(sf, fileName, rtResPath, analysis)
}

export interface CompileProjectOptions {
  /** Absolute paths to root TypeScript modules to compile (all local imports are followed automatically). */
  entries: readonly string[]
  /** Project root used to compute relative output paths (e.g. `framework/platformer.ts` -> `outDir/framework/platformer.gd`). */
  rootDir: string
  /** Destination directory for compiled `.gd` files and `rt.gd`. */
  outDir: string
  /** Godot `res://` prefix corresponding to `outDir` (default: `res://scripts/compiled`). */
  resPrefix?: string
}

function resolveToolPackageRootDir(): string {
  if (import.meta.url.endsWith('.ts')) {
    return resolve(fileURLToPath(new URL('..', import.meta.url)))
  }
  const twoUp = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  if (existsSync(join(twoUp, 'dist', 'framework', 'index.js'))) return twoUp
  const oneUp = resolve(fileURLToPath(new URL('..', import.meta.url)))
  if (existsSync(join(oneUp, 'framework', 'index.js'))) return oneUp
  return twoUp
}

const packageRootDir = resolveToolPackageRootDir()
const packageFrameworkSrcDir = join(packageRootDir, 'framework')
const packageFrameworkDistDir = join(packageRootDir, 'dist', 'framework')

function isWithinDir(filePath: string, dirPath: string): boolean {
  return filePath === dirPath || filePath.startsWith(dirPath + sep)
}

function computeRelOutputPath(absFile: string, rootDir: string): string {
  const norm = resolve(absFile)
  if (isWithinDir(norm, packageFrameworkSrcDir)) {
    return 'framework/' + relative(packageFrameworkSrcDir, norm).replace(/\\/g, '/')
  }
  if (isWithinDir(norm, packageFrameworkDistDir)) {
    return 'framework/' + relative(packageFrameworkDistDir, norm).replace(/\\/g, '/')
  }
  const rel = relative(rootDir, norm).replace(/\\/g, '/')
  if (!rel || rel === '..' || rel.startsWith('../')) {
    throw new Error(`Compiled module escapes rootDir (${rootDir}): ${norm}`)
  }
  return rel
}

async function resolveRidgetopSpecifier(specifier: string): Promise<string | null> {
  if (!Object.hasOwn(RIDGETOP_ALL_SPECIFIER_FILES, specifier)) return null
  const stem = RIDGETOP_ALL_SPECIFIER_FILES[specifier].replace(/\.js$/, '')
  for (const candidate of [
    join(packageFrameworkSrcDir, stem + '.ts'),
    join(packageFrameworkDistDir, stem + '.js'),
    join(packageFrameworkSrcDir, stem + '.js')
  ]) {
    try { await access(candidate); return candidate } catch { /* Candidate missing; try next. */ }
  }
  return null
}

async function resolveLocalModulePath(fromFile: string, specifier: string): Promise<string | null> {
  if (!specifier.startsWith('.')) {
    return resolveRidgetopSpecifier(specifier)
  }
  const raw = resolve(dirname(fromFile), specifier)
  if (raw.endsWith('.js')) {
    const asTs = raw.replace(/\.js$/, '.ts')
    try { await access(asTs); return asTs } catch { /* No sibling .ts source; keep .js path. */ }
  }
  return raw
}

function fileDirectlyExports(sf: ts.SourceFile, symbol: string): boolean {
  for (const stmt of sf.statements) {
    const modifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined
    const isExported = Boolean(modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
    if (isExported) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === symbol) return true
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (bindingContainsName(d.name, symbol)) return true
        }
      }
    }
    if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      if (stmt.exportClause.elements.some(el => !el.isTypeOnly && el.name.text === symbol)) return true
    }
  }
  return false
}

/** Resolve re-export barrels (including `export * from '...'` like `framework/index.ts`) to the actual defining `.ts`/`.js` file. */
async function resolveThroughBarrel(
  filePath: string,
  symbol: string,
  cache: Map<string, ts.SourceFile>,
  depth = 0,
  seen = new Set<string>()
): Promise<{ file: string; symbol: string }> {
  if (depth >= 8) return { file: filePath, symbol }
  const key = `${filePath}::${symbol}`
  if (seen.has(key)) return { file: filePath, symbol }
  seen.add(key)

  let sf = cache.get(filePath)
  if (!sf) {
    sf = ts.createSourceFile(filePath, await readFile(filePath, 'utf8'), ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
    cache.set(filePath, sf)
  }
  if (fileDirectlyExports(sf, symbol)) return { file: filePath, symbol }

  const starTargets: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt) || stmt.isTypeOnly || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const spec = stmt.moduleSpecifier.text
    const target = await resolveLocalModulePath(filePath, spec)
    if (!target) continue
    if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        if (el.isTypeOnly) continue
        if (el.name.text === symbol) {
          const nextSym = (el.propertyName ?? el.name).text
          return resolveThroughBarrel(target, nextSym, cache, depth + 1, seen)
        }
      }
    } else if (!stmt.exportClause) {
      starTargets.push(target)
    }
  }

  for (const target of starTargets) {
    const resolved = await resolveThroughBarrel(target, symbol, cache, depth + 1, seen)
    let targetSf = cache.get(resolved.file)
    if (!targetSf) {
      targetSf = ts.createSourceFile(resolved.file, await readFile(resolved.file, 'utf8'), ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
      cache.set(resolved.file, targetSf)
    }
    if (fileDirectlyExports(targetSf, resolved.symbol)) return resolved
  }

  return { file: filePath, symbol }
}

const GODOT_TESTING_NOOP_GD = renderTestingNoopGd()

/** Compile a TypeScript module graph into a self-contained set of Godot 4 `.gd` files + `rt.gd`. */
export async function compileTsProjectToGodot(options: CompileProjectOptions): Promise<{ files: string[]; rtPath: string }> {
  const rootDir = resolve(options.rootDir)
  const outDir = resolve(options.outDir)
  const resPrefix = (options.resPrefix ?? 'res://scripts/compiled').replace(/\/$/, '')
  const rtResPath = `${resPrefix}/rt.gd`

  await mkdir(outDir, { recursive: true })
  const rtPath = join(outDir, 'rt.gd')

  const astCache = new Map<string, ts.SourceFile>()
  const visited = new Set<string>()
  const emitted: string[] = []

  async function compileOne(absFile: string) {
    const normalized = resolve(absFile)
    if (visited.has(normalized)) return
    visited.add(normalized)

    const relDisplay = computeRelOutputPath(normalized, rootDir)
    if (relDisplay === 'framework/testing-runtime.ts' || relDisplay === 'framework/testing-runtime.js') {
      const outFile = join(outDir, 'framework', 'testing-runtime.gd')
      await mkdir(dirname(outFile), { recursive: true })
      await writeFile(outFile, GODOT_TESTING_NOOP_GD)
      emitted.push(outFile)
      return
    }

    const source = await readFile(normalized, 'utf8')
    let sf = astCache.get(normalized)
    if (!sf) {
      sf = ts.createSourceFile(normalized, source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
      astCache.set(normalized, sf)
    }

    // Pre-resolve every runtime import and re-export specifier + symbol through barrels so all dependencies are compiled too.
    const importMap = new Map<string, { resPath: string; exportName: string; absTarget: string }>()
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt)) {
        if (stmt.importClause?.isTypeOnly || !ts.isStringLiteral(stmt.moduleSpecifier)) continue
        const spec = stmt.moduleSpecifier.text
        const direct = await resolveLocalModulePath(normalized, spec)
        if (!direct) continue
        const bindings = stmt.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if (el.isTypeOnly) continue
            const imported = (el.propertyName ?? el.name).text
            const resolved = await resolveThroughBarrel(direct, imported, astCache)
            const relOut = computeRelOutputPath(resolved.file, rootDir).replace(/\.(?:ts|js)$/, '.gd')
            importMap.set(`${spec}::${imported}`, {
              resPath: `${resPrefix}/${relOut}`,
              exportName: resolved.symbol,
              absTarget: resolved.file
            })
          }
        }
      } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const spec = stmt.moduleSpecifier.text
        const direct = await resolveLocalModulePath(normalized, spec)
        if (!direct) continue
        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          for (const el of stmt.exportClause.elements) {
            if (el.isTypeOnly) continue
            const imported = (el.propertyName ?? el.name).text
            const resolved = await resolveThroughBarrel(direct, imported, astCache)
            const relOut = computeRelOutputPath(resolved.file, rootDir).replace(/\.(?:ts|js)$/, '.gd')
            importMap.set(`${spec}::${imported}`, {
              resPath: `${resPrefix}/${relOut}`,
              exportName: resolved.symbol,
              absTarget: resolved.file
            })
          }
        }
      }
    }

    for (const dep of importMap.values()) await compileOne(dep.absTarget)

    const gd = compileTsToGd(source, relDisplay, {
      rtResPath,
      resolveImport(specifier, exportedName) {
        const hit = importMap.get(`${specifier}::${exportedName}`)
        if (hit) return { resPath: hit.resPath, exportName: hit.exportName }
        const fallback = computeRelOutputPath(resolve(dirname(normalized), specifier.replace(/\.js$/, '.ts')), rootDir)
          .replace(/\.(?:ts|js)$/, '.gd')
        return { resPath: `${resPrefix}/${fallback}`, exportName: exportedName }
      }
    })

    const outFile = join(outDir, relDisplay.replace(/\.(?:ts|js)$/, '.gd'))
    await mkdir(dirname(outFile), { recursive: true })
    await writeFile(outFile, gd)
    emitted.push(outFile)
  }

  for (const entry of options.entries) {
    const bare = await resolveRidgetopSpecifier(entry)
    await compileOne(bare ?? entry)
  }
  await writeFile(rtPath, renderRtGd())
  return { files: emitted, rtPath }
}

if (isMain(import.meta.url)) {
  const [, , outDir, ...entries] = process.argv
  if (!outDir || !entries.length || outDir === '--help') {
    console.log('Usage: node tools/ts-to-gd.ts <out-dir> <entry1.ts> [entry2.ts ...]')
    process.exitCode = outDir === '--help' ? 0 : 1
  } else {
    const result = await compileTsProjectToGodot({
      entries: entries.map(e => (e === 'ridgetop' || e.startsWith('ridgetop/') ? e : resolve(e))),
      rootDir: process.cwd(),
      outDir: resolve(outDir)
    })
    console.log(`Compiled ${result.files.length} TypeScript module(s) to GDScript in ${outDir}`)
  }
}
