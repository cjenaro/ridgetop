import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = new URL('../', import.meta.url)
const ridgetopPkgRoot = new URL('packages/ridgetop/', root)
const ridgetopFrameworkRoot = new URL('framework/', ridgetopPkgRoot)

const ALLOWED_RIDGETOP_SPECIFIERS = new Set([
  'ridgetop',
  'ridgetop/server',
  'ridgetop/ui',
  'ridgetop/ui-layout',
  'ridgetop/ui-button',
  'ridgetop/ui-toggle',
  'ridgetop/ui-select',
  'ridgetop/ui-slider',
  'ridgetop/ui-menu',
  'ridgetop/ui-canvas',
  'ridgetop/ui-machine',
  'ridgetop/art-review',
  'ridgetop/art-review/server',
  'ridgetop/testing'
])

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

  // Every browser framework module reachable from framework/index.ts or framework/ui.ts
  // is registered in framework/host.ts browserModules so it never 404s in hosted builds.
  const hostSource = await readFile(new URL('host.ts', ridgetopFrameworkRoot), 'utf8')
  const hostedMatch = /const browserModules = \[([\s\S]*?)\]/.exec(hostSource)
  assert.ok(hostedMatch, 'Expected browserModules list in packages/ridgetop/framework/host.ts')
  const hosted = new Set([...hostedMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]))
  const visited = new Set<string>()
  const queue = ['index.ts', 'ui.ts']
  while (queue.length) {
    const cur = queue.pop()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const jsName = cur.replace(/\.ts$/, '.js')
    if (jsName !== 'types.js') {
      assert.ok(hosted.has(jsName), `${jsName} is imported by browser entry points but missing from host.ts browserModules`)
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
  assert.ok(paths.includes('package.json'))
  assert.ok(paths.includes('README.md'))
})
