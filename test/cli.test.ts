import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const cliBin = join(repoRoot, 'packages', 'ridgetop', 'dist', 'tools', 'cli.js')
const ridgetopPkgPath = join(repoRoot, 'packages', 'ridgetop', 'package.json')
const starterRecipe = join(repoRoot, 'packages', 'ridgetop', 'templates', 'starter', 'art', 'rain-ranger.art.json')

interface CliResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

async function runNode(scriptPath: string, args: readonly string[], cwd = repoRoot): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
      cwd,
      timeout: 30_000
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string }
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? ''
    }
  }
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test('ridgetop CLI prints help, version, and rejects unknown commands', async () => {
  const pkg = JSON.parse(await readFile(ridgetopPkgPath, 'utf8')) as { version: string }

  for (const args of [[], ['--help'], ['-h']]) {
    const res = await runNode(cliBin, args)
    assert.equal(res.code, 0, `expected exit 0 for ${JSON.stringify(args)}`)
    assert.match(res.stdout, /Ridgetop CLI/)
    assert.match(res.stdout, /create <dir>/)
    assert.match(res.stdout, /package \[options\]/)
    assert.match(res.stdout, /compile-godot/)
    assert.match(res.stdout, /preview-art/)
    assert.match(res.stdout, /art-library/)
  }

  for (const flag of ['--version', '-v']) {
    const res = await runNode(cliBin, [flag])
    assert.equal(res.code, 0, `expected exit 0 for ${flag}`)
    assert.equal(res.stdout.trim(), pkg.version)
  }

  const unknown = await runNode(cliBin, ['does-not-exist'])
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /Unknown ridgetop command "does-not-exist"/)
})

test('ridgetop create scaffolds a standalone project and rejects existing directories', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-cli-create-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  const help = await runNode(cliBin, ['create', '--help'])
  assert.equal(help.code, 0)
  assert.match(help.stdout, /Usage: ridgetop create <new-directory>/)

  const missing = await runNode(cliBin, ['create'])
  assert.equal(missing.code, 1)
  assert.match(missing.stdout, /Usage: ridgetop create <new-directory>/)

  const projectDir = join(work, 'lantern-cli-demo')
  const created = await runNode(cliBin, ['create', projectDir])
  assert.equal(created.code, 0, created.stderr)
  assert.match(created.stdout, /Created /)

  const expectedFiles = [
    'package.json',
    'godot-main.gd',
    'game/index.html',
    'game/style.css',
    'game/game.js',
    'game/main.js',
    'game/serve.js',
    'game/preview-art.js',
    'game/art-library.js',
    'game/package.js',
    'game/art/rain-ranger.art.json',
    'game/art/overrides.json',
    'game/art/library/catalog.json',
    'framework/index.js',
    'framework/server.js',
    'framework/tooling.js',
    'templates/godot-runtime/ridgetop_runtime.gd',
    'templates/godot-runtime/ridgetop_ui.gd'
  ]
  for (const rel of expectedFiles) {
    await access(join(projectDir, rel))
  }

  // Scaffolded main.js should use the modernized createGamePage + ui.sync/exposeGlobal API
  const mainJs = await readFile(join(projectDir, 'game', 'main.js'), 'utf8')
  assert.match(mainJs, /createGamePage/)
  assert.match(mainJs, /exposeGlobal/)
  assert.ok(!mainJs.includes('../../framework/'), 'framework imports must be rewritten to ../framework/')

  // Re-running create against an existing directory fails cleanly
  const dup = await runNode(cliBin, ['create', projectDir])
  assert.equal(dup.code, 1)
  assert.match(dup.stderr, /destination already exists/i)
})

test('ridgetop art-library lists catalog, derives recipes with recursive mkdir, and handles -h/errors', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-cli-artlib-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  for (const flag of ['-h', '--help']) {
    const res = await runNode(cliBin, ['art-library', flag])
    assert.equal(res.code, 0)
    assert.match(res.stdout, /Usage: ridgetop art-library/)
  }

  const badAction = await runNode(cliBin, ['art-library', 'nope'])
  assert.equal(badAction.code, 1)
  assert.match(badAction.stdout, /Usage: ridgetop art-library/)

  const listed = await runNode(cliBin, ['art-library', 'list'])
  assert.equal(listed.code, 0, listed.stderr)
  assert.match(listed.stdout, /field-radio/)

  const filtered = await runNode(cliBin, ['art-library', 'list', 'radio'])
  assert.equal(filtered.code, 0, filtered.stderr)
  assert.match(filtered.stdout, /field-radio/)

  const nestedOut = join(work, 'nested', 'custom-art')
  const derived = await runNode(cliBin, ['art-library', 'start', 'field-radio', 'storm-radio', nestedOut])
  assert.equal(derived.code, 0, derived.stderr)
  assert.match(derived.stdout, /storm-radio\.art\.json/)
  assert.match(derived.stdout, /Parts:/)

  const recipeJson = JSON.parse(await readFile(join(nestedOut, 'storm-radio.art.json'), 'utf8')) as { name: string; parts: unknown[] }
  assert.equal(recipeJson.name, 'storm-radio')
  assert.ok(recipeJson.parts.length > 0)

  // Refuses to overwrite existing derived recipe (wx)
  const overwrite = await runNode(cliBin, ['art-library', 'start', 'field-radio', 'storm-radio', nestedOut])
  assert.equal(overwrite.code, 1)

  // Unknown reference fails cleanly
  const unknownRef = await runNode(cliBin, ['art-library', 'start', 'nonexistent-ref', 'my-asset', nestedOut])
  assert.equal(unknownRef.code, 1)
  assert.match(unknownRef.stderr, /Unknown reference nonexistent-ref/)

  // Monorepo examples/starter/dist/art-library.js also resolves bundled canonical library
  const exArtLib = join(repoRoot, 'examples', 'starter', 'dist', 'art-library.js')
  const exList = await runNode(exArtLib, ['list', 'radio'])
  assert.equal(exList.code, 0, exList.stderr)
  assert.match(exList.stdout, /field-radio/)
})

test('ridgetop preview-art renders sprite sheet PNG, 8-view PNG, and part visibility JSON', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-cli-preview-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  for (const flag of ['-h', '--help']) {
    const res = await runNode(cliBin, ['preview-art', flag])
    assert.equal(res.code, 0)
    assert.match(res.stdout, /Usage: ridgetop preview-art/)
  }

  const missing = await runNode(cliBin, ['preview-art'])
  assert.equal(missing.code, 1)
  assert.match(missing.stdout, /Usage: ridgetop preview-art/)

  const outDir = join(work, 'previews')
  const rendered = await runNode(cliBin, ['preview-art', starterRecipe, outDir])
  assert.equal(rendered.code, 0, rendered.stderr)
  assert.match(rendered.stdout, /px directional sprites:/)
  assert.match(rendered.stdout, /Eight larger mesh views:/)
  assert.match(rendered.stdout, /Visible pixels per named part:/)

  const spritesPng = await readFile(join(outDir, 'rain-ranger-sprites.png'))
  const viewsPng = await readFile(join(outDir, 'rain-ranger-views.png'))
  assert.deepEqual(spritesPng.subarray(0, 8), PNG_MAGIC, 'sprites PNG must have valid PNG header')
  assert.deepEqual(viewsPng.subarray(0, 8), PNG_MAGIC, 'views PNG must have valid PNG header')

  const visibility = JSON.parse(await readFile(join(outDir, 'rain-ranger-visibility.json'), 'utf8')) as {
    parts: Record<string, number[]>
  }
  const partNames = Object.keys(visibility.parts)
  assert.ok(partNames.length > 0, 'visibility JSON must report part pixel counts')
  for (const counts of Object.values(visibility.parts)) {
    assert.equal(counts.length, 8, 'each part should report visibility across 8 directions')
  }
})

test('ridgetop package packages a project cleanly and handles help/invalid flags', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-cli-pkg-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  for (const flag of ['-h', '--help']) {
    const res = await runNode(cliBin, ['package', flag])
    assert.equal(res.code, 0)
    assert.match(res.stdout, /Usage: ridgetop package \[options\]/)
  }

  const badTarget = await runNode(cliBin, ['package', '--target', 'invalid-platform'])
  assert.equal(badTarget.code, 1)
  assert.match(badTarget.stderr, /Unknown --target/)

  const projectDir = join(work, 'pkg-proj')
  const created = await runNode(cliBin, ['create', projectDir])
  assert.equal(created.code, 0, created.stderr)

  const outDir = join(work, 'pkg-out')
  const packaged = await runNode(cliBin, ['package', '--target', 'web', '--project', projectDir, '--out', outDir])
  assert.equal(packaged.code, 0, packaged.stderr)
  assert.match(packaged.stdout, /Packaged /)
  assert.match(packaged.stdout, /- web:/)

  await access(join(outDir, 'index.html'))
  await access(join(outDir, 'main.js'))
  await assert.rejects(access(join(outDir, 'framework', 'tooling.js')), 'tooling.js must be stripped from web build')
  await assert.rejects(access(join(outDir, 'art', 'library')), 'art/library must be stripped from web build')
})

test('ridgetop compile-godot handles help, invalid args, and compiles TypeScript to GDScript', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-cli-godot-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  for (const flag of ['-h', '--help']) {
    const res = await runNode(cliBin, ['compile-godot', flag])
    assert.equal(res.code, 0)
    assert.match(res.stdout, /Usage: ridgetop compile-godot/)
  }

  const missingEntries = await runNode(cliBin, ['compile-godot', join(work, 'out')])
  assert.equal(missingEntries.code, 1)
  assert.match(missingEntries.stdout, /Usage: ridgetop compile-godot/)

  const gdOut = join(work, 'compiled-gd')
  const compiled = await runNode(cliBin, ['compile-godot', gdOut, 'examples/starter/game.ts'])
  assert.equal(compiled.code, 0, compiled.stderr)
  assert.match(compiled.stdout, /Compiled \d+ TypeScript module\(s\) to GDScript/)

  const gameGd = await readFile(join(gdOut, 'examples', 'starter', 'game.gd'), 'utf8')
  assert.match(gameGd, /Lantern Grove/)
})

test('createGame() generated project delegate scripts stay in sync with ridgetop CLI', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-cli-delegates-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  const projectDir = join(work, 'generated-game')
  const created = await runNode(cliBin, ['create', projectDir])
  assert.equal(created.code, 0, created.stderr)

  // 1. game/art-library.js supports -h, list, and start with optional nested [out-dir] + mkdir
  const artHelp = await runNode(join(projectDir, 'game', 'art-library.js'), ['-h'], projectDir)
  assert.equal(artHelp.code, 0, artHelp.stderr)
  assert.match(artHelp.stdout, /Usage: npm run art-library/)

  const artList = await runNode(join(projectDir, 'game', 'art-library.js'), ['list'], projectDir)
  assert.equal(artList.code, 0, artList.stderr)
  assert.match(artList.stdout, /field-radio/)

  const customOut = join(projectDir, 'custom', 'derived-art')
  const artStart = await runNode(
    join(projectDir, 'game', 'art-library.js'),
    ['start', 'field-radio', 'camp-radio', customOut],
    projectDir
  )
  assert.equal(artStart.code, 0, artStart.stderr)
  await access(join(customOut, 'camp-radio.art.json'))

  // 2. game/preview-art.js supports -h and renders sprite/view PNGs + visibility JSON
  const previewHelp = await runNode(join(projectDir, 'game', 'preview-art.js'), ['-h'], projectDir)
  assert.equal(previewHelp.code, 0, previewHelp.stderr)
  assert.match(previewHelp.stdout, /Usage: npm run preview-art/)

  const previewOut = join(projectDir, 'tmp-previews')
  const previewRun = await runNode(
    join(projectDir, 'game', 'preview-art.js'),
    ['game/art/rain-ranger.art.json', previewOut],
    projectDir
  )
  assert.equal(previewRun.code, 0, previewRun.stderr)
  const previewPng = await readFile(join(previewOut, 'rain-ranger-sprites.png'))
  assert.deepEqual(previewPng.subarray(0, 8), PNG_MAGIC)
  await access(join(previewOut, 'rain-ranger-views.png'))
  await access(join(previewOut, 'rain-ranger-visibility.json'))

  // 3. game/package.js supports --help and packages cleanly for web
  const pkgHelp = await runNode(join(projectDir, 'game', 'package.js'), ['--help'], projectDir)
  assert.equal(pkgHelp.code, 0, pkgHelp.stderr)
  assert.match(pkgHelp.stdout, /Usage: npm run package -- \[options\]/)

  const pkgOut = join(projectDir, 'dist', 'web-test')
  const pkgRun = await runNode(
    join(projectDir, 'game', 'package.js'),
    ['--target', 'web', '--out', pkgOut],
    projectDir
  )
  assert.equal(pkgRun.code, 0, pkgRun.stderr)
  assert.match(pkgRun.stdout, /Packaged /)
  await access(join(pkgOut, 'index.html'))
  await assert.rejects(access(join(pkgOut, 'framework', 'tooling.js')), 'tooling.js must be stripped')
  await assert.rejects(access(join(pkgOut, 'art', 'library')), 'art/library must be stripped')
})
