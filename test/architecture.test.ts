import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const entryPoints = new Set(['framework/index.ts', 'framework/server.ts', 'framework/ui.ts'])
const isPublicUiModule = (file: string) => /^framework\/ui-[a-z]+\.ts$/.test(file)

function imports(source) {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\(\s*)['"]([^'"]+)['"]/g)]
    .map(match => match[1])
}

test('Beacon Run depends only on its own modules and Ridgetop public entry points', async () => {
  const gameFiles = (await readdir(new URL('game/', root))).filter(file => file.endsWith('.ts'))
  const racingFiles = (await readdir(new URL('racing/', root))).filter(file => file.endsWith('.ts'))
  const lighthouseFiles = (await readdir(new URL('lighthouse/', root))).filter(file => file.endsWith('.ts'))
  const files = ['main.ts', 'server.ts', ...gameFiles.map(file => 'game/' + file),
    ...racingFiles.map(file => 'racing/' + file), ...lighthouseFiles.map(file => 'lighthouse/' + file)]
  for (const file of files) {
    const url = new URL(file, root)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      assert.ok(specifier.startsWith('.'), file + ' imported an external module: ' + specifier)
      const imported = new URL(specifier, url).href.slice(root.href.length)
      assert.ok(entryPoints.has(imported) || isPublicUiModule(imported) || files.includes(imported),
        file + ' imported a module outside the game or framework API: ' + imported)
    }
  }

  for (const file of (await readdir(new URL('framework/', root))).filter(file => file.endsWith('.ts'))) {
    const url = new URL('framework/' + file, root)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      assert.ok(specifier.startsWith('node:') ||
        (specifier.startsWith('.') && new URL(specifier, url).href.startsWith(new URL('framework/', root).href)),
        file + ' depends on a module outside Ridgetop: ' + specifier)
    }
  }

  // Ensure studio/viewer tools and framework modules have zero imports from example games.
  const exampleDirs = ['game/', 'racing/', 'lighthouse/', 'starter/']
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
      assert.ok(!exampleDirs.some(dir => imported.startsWith(dir)),
        `${file} must not import example game module ${imported}`)
    }
  }

  // Ensure starter runtime modules stay strictly on starter/ + public Ridgetop entry points (no starter-only testing glue).
  for (const file of ['starter/main.ts', 'starter/serve.ts', 'starter/game.ts']) {
    const url = new URL(file, root)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      if (specifier.startsWith('node:')) continue
      assert.ok(specifier.startsWith('.'), file + ' imported an external module: ' + specifier)
      const imported = new URL(specifier, url).href.slice(root.href.length)
      assert.ok(entryPoints.has(imported) || isPublicUiModule(imported) || imported.startsWith('starter/'),
        `${file} imported a module outside starter or public framework API: ${imported}`)
    }
  }

  // Ensure every browser framework module reachable from framework/index.ts or framework/ui.ts
  // is registered in framework/host.ts browserModules so it never 404s in hosted builds.
  const hostSource = await readFile(new URL('framework/host.ts', root), 'utf8')
  const hostedMatch = /const browserModules = \[([\s\S]*?)\]/.exec(hostSource)
  assert.ok(hostedMatch, 'Expected browserModules list in framework/host.ts')
  const hosted = new Set([...hostedMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]))
  const visited = new Set<string>()
  const queue = ['framework/index.ts', 'framework/ui.ts']
  while (queue.length) {
    const cur = queue.pop()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const jsName = cur.replace(/^framework\//, '').replace(/\.ts$/, '.js')
    if (jsName !== 'types.js') {
      assert.ok(hosted.has(jsName), `${jsName} is imported by browser entry points but missing from framework/host.ts browserModules`)
    }
    const url = new URL(cur, root)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      if (!specifier.startsWith('.')) continue
      const next = new URL(specifier, url).href.slice(root.href.length)
      if (next.startsWith('framework/') && next.endsWith('.ts')) queue.push(next)
    }
  }
})
