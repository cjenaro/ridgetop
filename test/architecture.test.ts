import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import vm from 'node:vm'
import ts from 'typescript'
import {
  BLOCKED_STUDIO_FILES,
  HOSTED_BROWSER_MODULES,
  RIDGETOP_ALL_SPECIFIER_FILES,
  RIDGETOP_BROWSER_IMPORT_MAP,
  RIDGETOP_PACKAGE_EXPORTS,
  TESTING_RUNTIME_JS_NOOPS,
  TESTING_RUNTIME_NOOPS,
  renderTestingNoopGd,
  renderTestingNoopNamespaceJs
} from '../packages/ridgetop/framework/manifest.ts'
import { ridgetopBrowserSpecifiers } from '../packages/ridgetop/framework/server.ts'
import * as testingRuntime from '../packages/ridgetop/framework/testing-runtime.ts'

const execFileAsync = promisify(execFile)
const root = new URL('../', import.meta.url)
const ridgetopPkgRoot = new URL('packages/ridgetop/', root)
const ridgetopFrameworkRoot = new URL('framework/', ridgetopPkgRoot)

const ALLOWED_RIDGETOP_SPECIFIERS = new Set(Object.keys(RIDGETOP_ALL_SPECIFIER_FILES))

function imports(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\(\s*)['"]([^'"]+)['"]/g)]
    .map(match => match[1])
}

async function listTsFiles(dirUrl: URL, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dirUrl, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    if (entry.isDirectory()) {
      out.push(...await listTsFiles(new URL(entry.name + '/', dirUrl), prefix + entry.name + '/'))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(prefix + entry.name)
    }
  }
  return out
}

test('packages/ridgetop is completely isolated with zero example-game imports and zero external runtime deps', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', ridgetopPkgRoot), 'utf8'))
  assert.equal(pkg.name, 'ridgetop')
  assert.equal(pkg.private, undefined, 'packages/ridgetop must be publishable (not private)')
  assert.equal(pkg.dependencies, undefined, 'packages/ridgetop must have zero external runtime dependencies')
  assert.ok(pkg.bin?.ridgetop, 'packages/ridgetop must expose the ridgetop CLI bin')

  // Every framework TS module imports only node:* or other files inside packages/ridgetop/framework/
  for (const file of (await readdir(ridgetopFrameworkRoot)).filter(f => f.endsWith('.ts'))) {
    const url = new URL(file, ridgetopFrameworkRoot)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      assert.ok(
        specifier.startsWith('node:') ||
          (specifier.startsWith('.') && new URL(specifier, url).href.startsWith(ridgetopFrameworkRoot.href)),
        `packages/ridgetop/framework/${file} depends on a module outside Ridgetop framework: ${specifier}`
      )
    }
  }

  // Every TS file in packages/ridgetop (framework, tools, templates) has ZERO imports from examples/
  for (const rel of await listTsFiles(ridgetopPkgRoot)) {
    const url = new URL(rel, ridgetopPkgRoot)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      if (specifier.startsWith('node:') || specifier === 'typescript') continue
      assert.ok(specifier.startsWith('.'), `packages/ridgetop/${rel} imported unexpected bare specifier: ${specifier}`)
      const targetHref = new URL(specifier, url).href
      assert.ok(
        targetHref.startsWith(ridgetopPkgRoot.href),
        `packages/ridgetop/${rel} escapes package root to ${targetHref}`
      )
    }
  }

  // packages/ridgetop/package.json exports and ridgetopBrowserSpecifiers match the unified manifest
  assert.deepEqual(pkg.exports, RIDGETOP_PACKAGE_EXPORTS, 'packages/ridgetop/package.json exports must match framework/manifest.ts')
  assert.deepEqual(ridgetopBrowserSpecifiers, RIDGETOP_BROWSER_IMPORT_MAP, 'server.ts ridgetopBrowserSpecifiers must match framework/manifest.ts')

  // Pure runtime PRNG is hosted and NOT studio-blocked, while studio verification remains blocked
  const hosted = new Set(HOSTED_BROWSER_MODULES)
  assert.ok(hosted.has('rng.js'), 'rng.js must be in HOSTED_BROWSER_MODULES')
  assert.ok(!BLOCKED_STUDIO_FILES.has('rng.js'), 'rng.js must not be in BLOCKED_STUDIO_FILES')
  assert.ok(BLOCKED_STUDIO_FILES.has('verification.js'), 'verification.js must remain in BLOCKED_STUDIO_FILES')

  // export-godot.ts and templates/godot-runtime/*.gd must remain strictly game-agnostic with zero hardcoded example-game GDScript
  const godotRuntimeFiles = [
    ['framework/export-godot.ts', new URL('export-godot.ts', ridgetopFrameworkRoot)],
    ['templates/godot-runtime/ridgetop_ui.gd', new URL('templates/godot-runtime/ridgetop_ui.gd', ridgetopPkgRoot)],
    ['templates/godot-runtime/ridgetop_runtime.gd', new URL('templates/godot-runtime/ridgetop_runtime.gd', ridgetopPkgRoot)],
    ['templates/godot-runtime/main.gd', new URL('templates/godot-runtime/main.gd', ridgetopPkgRoot)],
    ['templates/godot-runtime/rt.gd', new URL('templates/godot-runtime/rt.gd', ridgetopPkgRoot)]
  ] as const
  for (const [label, fileUrl] of godotRuntimeFiles) {
    const content = await readFile(fileUrl, 'utf8')
    for (const forbiddenToken of ['signal-drift', 'racing/race.gd', 'racing/track.gd', 'Lantern Grove']) {
      assert.ok(
        !content.includes(forbiddenToken),
        `packages/ridgetop/${label} must not reference example-game logic (${forbiddenToken})`
      )
    }
  }

  // Every browser framework module reachable from framework/index.ts or framework/ui.ts
  // is registered in framework/manifest.ts HOSTED_BROWSER_MODULES so it never 404s in hosted builds.
  const visited = new Set<string>()
  const queue = ['index.ts', 'ui.ts']
  while (queue.length) {
    const cur = queue.pop()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const jsName = cur.replace(/\.ts$/, '.js')
    if (jsName !== 'types.js') {
      assert.ok(hosted.has(jsName), `${jsName} is imported by browser entry points but missing from manifest.ts HOSTED_BROWSER_MODULES`)
    }
    const url = new URL(cur, ridgetopFrameworkRoot)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      if (!specifier.startsWith('.')) continue
      const targetUrl = new URL(specifier, url)
      if (targetUrl.href.startsWith(ridgetopFrameworkRoot.href) && targetUrl.pathname.endsWith('.ts')) {
        queue.push(targetUrl.href.slice(ridgetopFrameworkRoot.href.length))
      }
    }
  }
})

test('testing-runtime.ts exported functions match manifest JS and Godot no-op strip tables with safe return shapes', async () => {
  const runtimeFunctions = Object.entries(testingRuntime)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name)
    .sort()

  assert.ok(runtimeFunctions.length >= 30, `Expected at least 30 exported functions in testing-runtime.ts, got ${runtimeFunctions.length}`)
  assert.deepEqual(
    Object.keys(TESTING_RUNTIME_NOOPS).sort(),
    runtimeFunctions,
    'TESTING_RUNTIME_NOOPS must match every exported function in testing-runtime.ts (zero missing, zero stale)'
  )
  assert.deepEqual(
    Object.keys(TESTING_RUNTIME_JS_NOOPS).sort(),
    runtimeFunctions,
    'TESTING_RUNTIME_JS_NOOPS must match every exported function in testing-runtime.ts'
  )

  // Verify parameter arity matches testing-runtime.ts AST declarations so GDScript no-ops never fail arity checks
  const runtimeSource = await readFile(new URL('testing-runtime.ts', ridgetopFrameworkRoot), 'utf8')
  const sf = ts.createSourceFile('testing-runtime.ts', runtimeSource, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
  const astArities = new Map<string, number>()
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name) continue
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined
    if (mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      astArities.set(stmt.name.text, stmt.parameters.length)
    }
  }
  for (const fnName of runtimeFunctions) {
    assert.equal(
      TESTING_RUNTIME_NOOPS[fnName].arity,
      astArities.get(fnName),
      `TESTING_RUNTIME_NOOPS.${fnName}.arity must match testing-runtime.ts parameter count`
    )
  }

  // Evaluate rendered JS namespace no-ops and check return-shape safety
  const ns = vm.runInNewContext(`(${renderTestingNoopNamespaceJs()})`) as Record<string, (...args: unknown[]) => unknown>
  assert.ok(Object.isFrozen(ns))
  assert.deepEqual(Object.keys(ns).sort(), runtimeFunctions)
  assert.equal(ns.isTestingActive(), false)
  assert.equal(ns.isTestingPaused(), false)
  assert.equal(ns.recognizeAssetFromPick([], [], {}), null)
  assert.deepEqual(Array.from(ns.getTestingHooks() as unknown[]), [])
  for (const regFn of ['onTestingPause', 'onTestingHooksRegistered', 'registerArtKitRuntime', 'registerHudRegion', 'registerTestingHooks']) {
    const unsub = ns[regFn](() => {})
    assert.equal(typeof unsub, 'function', `Stripped ${regFn} must return a callable unsubscribe function`)
    ;(unsub as () => void)()
  }

  // Verify rendered GDScript no-op module declares every exported function with matching signature
  const gdSource = renderTestingNoopGd()
  for (const fnName of runtimeFunctions) {
    assert.match(
      gdSource,
      new RegExp(`^func ${fnName}\\(`, 'm'),
      `renderTestingNoopGd() missing Godot stub for ${fnName}`
    )
  }
  assert.ok(gdSource.includes('func onTestingHooksRegistered(_a0 = null) -> Callable:\n\treturn func(): pass'))
  assert.ok(gdSource.includes('func recognizeAssetFromPick(_a0 = null, _a1 = null, _a2 = null) -> Variant:\n\treturn null'))
})

test('every examples/* package depends ONLY on ridgetop and imports only local files or bare ridgetop specifiers', async () => {
  const examplesRoot = new URL('examples/', root)
  const exampleEntries = (await readdir(examplesRoot, { withFileTypes: true })).filter(e => e.isDirectory())
  const exampleNames = exampleEntries.map(e => e.name).sort()
  assert.deepEqual(exampleNames, ['beacon-run', 'crownshard', 'lighthouse', 'signal-drift', 'starter'])

  for (const name of exampleNames) {
    const exampleDir = new URL(name + '/', examplesRoot)
    const pkg = JSON.parse(await readFile(new URL('package.json', exampleDir), 'utf8'))
    assert.deepEqual(
      Object.keys(pkg.dependencies ?? {}),
      ['ridgetop'],
      `examples/${name}/package.json must depend ONLY on ridgetop`
    )
    assert.equal(pkg.dependencies.ridgetop, 'workspace:*')

    for (const rel of await listTsFiles(exampleDir)) {
      const url = new URL(rel, exampleDir)
      for (const specifier of imports(await readFile(url, 'utf8'))) {
        if (specifier.startsWith('node:')) continue
        if (specifier.startsWith('.')) {
          const targetHref = new URL(specifier, url).href
          assert.ok(
            targetHref.startsWith(exampleDir.href),
            `examples/${name}/${rel} escaped its own package via relative import ${specifier}`
          )
        } else {
          assert.ok(
            ALLOWED_RIDGETOP_SPECIFIERS.has(specifier),
            `examples/${name}/${rel} imported disallowed bare specifier "${specifier}"`
          )
        }
      }
    }
  }

  // Ensure studio/viewer tools have zero imports from examples/
  const studioToolFiles = [
    'sprite-workshop.ts', 'sprite-model-editor.ts',
    'models/main.ts', 'models/headland.ts',
    'tools/build-workshop.ts', 'tools/build-models.ts'
  ]
  for (const file of studioToolFiles) {
    const url = new URL(file, root)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      if (!specifier.startsWith('.')) continue
      const imported = new URL(specifier, url).href.slice(root.href.length)
      assert.ok(!imported.startsWith('examples/'), `${file} must not import example game module ${imported}`)
    }
  }
})

test('packages/ridgetop packed tarball contains ZERO example-game files', async () => {
  const pkgDir = fileURLToPath(ridgetopPkgRoot)
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: pkgDir,
    timeout: 20_000
  })
  const parsed = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>
  const paths = parsed[0]?.files.map(f => f.path) ?? []
  assert.ok(paths.length > 20, 'Expected packed tarball file list')

  const forbidden = [
    /^examples\//,
    /beacon-run/i,
    /signal-drift/i,
    /^lighthouse\//,
    /examples\/lighthouse/i,
    /lighthouse\.html$/i,
    /^crownshard\//,
    /examples\/crownshard/i,
    /crownshard\.html$/i,
    /^game\//,
    /^racing\//,
    /^models\//,
    /^server\.(ts|js)$/,
    /sprite-workshop/,
    /benchmark/
  ]
  for (const p of paths) {
    for (const rx of forbidden) {
      assert.ok(!rx.test(p), `Packed ridgetop tarball must not contain example/studio file: ${p}`)
    }
  }
  assert.ok(paths.includes('dist/framework/index.js'), 'Tarball must include dist/framework/index.js')
  assert.ok(paths.includes('dist/framework/server.js'), 'Tarball must include dist/framework/server.js')
  assert.ok(paths.includes('dist/framework/testing-overlay.css'), 'Tarball must include dist/framework/testing-overlay.css')
  assert.ok(paths.includes('dist/tools/cli.js'), 'Tarball must include dist/tools/cli.js')
  assert.ok(paths.includes('dist/tools/ts-to-gd.js'), 'Tarball must include dist/tools/ts-to-gd.js')
  assert.ok(paths.includes('dist/tools/gd-analysis.js'), 'Tarball must include dist/tools/gd-analysis.js')
  assert.ok(paths.includes('dist/tools/gd-emit.js'), 'Tarball must include dist/tools/gd-emit.js')
  assert.ok(paths.includes('templates/godot-runtime/ridgetop_ui.gd'), 'Tarball must include templates/godot-runtime/ridgetop_ui.gd')
  assert.ok(paths.includes('templates/godot-runtime/ridgetop_runtime.gd'), 'Tarball must include templates/godot-runtime/ridgetop_runtime.gd')
  assert.ok(paths.includes('templates/godot-runtime/main.gd'), 'Tarball must include templates/godot-runtime/main.gd')
  assert.ok(paths.includes('templates/godot-runtime/rt.gd'), 'Tarball must include templates/godot-runtime/rt.gd')
  assert.ok(paths.includes('package.json'))
  assert.ok(paths.includes('README.md'))
})

test('starter template and examples/starter stay in parity and CLI scripts delegate to framework/tooling.ts', async () => {
  const templateStarter = new URL('templates/starter/', ridgetopPkgRoot)
  const exampleStarter = new URL('examples/starter/', root)

  // Shared non-TS files must stay byte-for-byte identical between template and example starter
  const exactSharedFiles = [
    'index.html',
    'style.css',
    'godot-main.gd',
    'README.md',
    'AGENTS.md',
    'ART.md',
    'art/rain-ranger.art.json',
    'art/overrides.json'
  ]
  for (const rel of exactSharedFiles) {
    const [tpl, ex] = await Promise.all([
      readFile(new URL(rel, templateStarter)),
      readFile(new URL(rel, exampleStarter))
    ])
    assert.ok(tpl.equals(ex), `Starter file drifted between templates/starter/${rel} and examples/starter/${rel}`)
  }

  // Shared TS source files must match once template relative framework imports are normalized to bare ridgetop specifiers
  const normalizeTemplateImports = (source: string) =>
    source
      .replaceAll("'../../framework/index.ts'", "'ridgetop'")
      .replaceAll("'../../framework/ui.ts'", "'ridgetop/ui'")
      .replaceAll("'../../framework/server.ts'", "'ridgetop/server'")

  for (const rel of ['game.ts', 'main.ts', 'preview-art.ts']) {
    const [tpl, ex] = await Promise.all([
      readFile(new URL(rel, templateStarter), 'utf8'),
      readFile(new URL(rel, exampleStarter), 'utf8')
    ])
    assert.equal(
      normalizeTemplateImports(tpl),
      ex,
      `Starter TS module drifted between templates/starter/${rel} and examples/starter/${rel}`
    )
  }

  // Both starter serve.ts modules must export createStarterServer and guard direct execution with isMain
  for (const [label, url] of [
    ['templates/starter/serve.ts', new URL('serve.ts', templateStarter)],
    ['examples/starter/serve.ts', new URL('serve.ts', exampleStarter)]
  ] as const) {
    const src = await readFile(url, 'utf8')
    assert.match(src, /export function createStarterServer\(/, `${label} must export createStarterServer`)
    assert.match(src, /if \(isMain\(import\.meta\.url\)\)/, `${label} must guard startup with isMain`)
  }

  // All CLI wrapper scripts across tools/, templates/starter/, and examples/starter/ must be thin delegates
  const thinDelegates = [
    ['packages/ridgetop/tools/preview-art.ts', new URL('tools/preview-art.ts', ridgetopPkgRoot), 'runPreviewArtCli'],
    ['packages/ridgetop/tools/art-library.ts', new URL('tools/art-library.ts', ridgetopPkgRoot), 'runArtLibraryCli'],
    ['packages/ridgetop/tools/package-game.ts', new URL('tools/package-game.ts', ridgetopPkgRoot), 'runPackageGameCli'],
    ['packages/ridgetop/templates/starter/preview-art.ts', new URL('preview-art.ts', templateStarter), 'runPreviewArtCli'],
    ['packages/ridgetop/templates/starter/art-library.ts', new URL('art-library.ts', templateStarter), 'runArtLibraryCli'],
    ['packages/ridgetop/templates/starter/package.ts', new URL('package.ts', templateStarter), 'runPackageGameCli'],
    ['examples/starter/preview-art.ts', new URL('preview-art.ts', exampleStarter), 'runPreviewArtCli'],
    ['examples/starter/art-library.ts', new URL('art-library.ts', exampleStarter), 'runArtLibraryCli'],
    ['examples/starter/package.ts', new URL('package.ts', exampleStarter), 'runPackageGameCli']
  ] as const
  for (const [label, url, fnName] of thinDelegates) {
    const src = await readFile(url, 'utf8')
    const lineCount = src.trim().split('\n').length
    assert.ok(src.includes(fnName), `${label} must delegate to ${fnName}`)
    assert.ok(lineCount <= 20, `${label} should remain a thin delegate (got ${lineCount} lines)`)
  }

  // Canonical art library lives only in packages/ridgetop/templates/starter/art/library (no duplicated copy in examples/starter)
  const canonicalCatalog = JSON.parse(await readFile(new URL('art/library/catalog.json', templateStarter), 'utf8')) as unknown[]
  assert.ok(canonicalCatalog.length >= 10, 'canonical art library catalog must exist in templates/starter/art/library/')
  await assert.rejects(
    access(new URL('art/library', exampleStarter)),
    'examples/starter/art/library must not duplicate packages/ridgetop/templates/starter/art/library'
  )

  // Server-only tooling module must be blocked from release bundles
  assert.ok(BLOCKED_STUDIO_FILES.has('tooling.js'), 'tooling.js must be in BLOCKED_STUDIO_FILES')
})
