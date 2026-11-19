import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const entryPoints = new Set(['framework/index.ts', 'framework/server.ts'])

function imports(source) {
  return [...source.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\(\s*)['"]([^'"]+)['"]/g)]
    .map(match => match[1])
}

test('Beacon Run depends only on its own modules and Ridgetop public entry points', async () => {
  const gameFiles = (await readdir(new URL('game/', root))).filter(file => file.endsWith('.ts'))
  const racingFiles = (await readdir(new URL('racing/', root))).filter(file => file.endsWith('.ts'))
  const files = ['main.ts', 'server.ts', ...gameFiles.map(file => 'game/' + file),
    ...racingFiles.map(file => 'racing/' + file)]
  for (const file of files) {
    const url = new URL(file, root)
    for (const specifier of imports(await readFile(url, 'utf8'))) {
      assert.ok(specifier.startsWith('.'), file + ' imported an external module: ' + specifier)
      const imported = new URL(specifier, url).href.slice(root.href.length)
      assert.ok(entryPoints.has(imported) || files.includes(imported),
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
})
