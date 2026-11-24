import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, createSaveBackup } from '../framework/index.ts'
import type { SaveBackupEnvelope, SaveBackupStorage } from '../framework/index.ts'
import { bakeMotifWav, packageGame, parsePackageArgs } from '../framework/server.ts'
import { createGame } from '../tools/create-game.ts'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

function createMemoryStorage(initial: Record<string, string> = {}): SaveBackupStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    getItem: key => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
    dump: () => Object.fromEntries(map.entries())
  }
}

function assertValidEscapedHtml(html: string) {
  assert.match(html, /^<!doctype html>/i, 'Expected valid HTML5 doctype')
  assert.ok(html.includes('<html') && html.includes('</html>'), 'Expected root <html> element')
  assert.ok(html.includes('<head>') && html.includes('</head>'), 'Expected <head> element')
  assert.ok(html.includes('<body') && html.includes('</body>'), 'Expected <body> element')

  const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  assert.ok(styleBlocks.length >= 1, 'Expected at least one inlined <style> block')
  for (const block of styleBlocks) {
    assert.ok(!/<\/style/i.test(block[1]), 'Inlined <style> body must not contain unescaped </style')
  }

  const scriptBlocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  assert.ok(scriptBlocks.length >= 2, 'Expected importmap and module <script> blocks')
  for (const block of scriptBlocks) {
    assert.ok(!/<\/script/i.test(block[2]), 'Inlined <script> body must not contain unescaped </script')
  }

  // Ensure balanced opening/closing script and style tags overall
  const openScripts = (html.match(/<script\b[^>]*>/gi) ?? []).length
  const closeScripts = (html.match(/<\/script>/gi) ?? []).length
  assert.equal(openScripts, closeScripts, 'Script tags must be balanced')

  const openStyles = (html.match(/<style\b[^>]*>/gi) ?? []).length
  const closeStyles = (html.match(/<\/style>/gi) ?? []).length
  assert.equal(openStyles, closeStyles, 'Style tags must be balanced')

  return { styleBlocks, scriptBlocks }
}

test('createSaveBackup exports, inspects, restores, and verifies SHA-256 integrity checksums', () => {
  const storage = createMemoryStorage({
    'game.progress': JSON.stringify({ level: 4, coins: 250 }),
    'game.settings': JSON.stringify({ volume: 0.8 }),
    'unrelated.key': 'leave-me-alone'
  })

  const manager = createSaveBackup({
    gameId: 'lantern-grove',
    version: '1.2.0',
    storage,
    keys: ['game.progress', 'game.settings', 'game.optional'],
    validate(data) {
      if (data['game.progress']) {
        const parsed = JSON.parse(data['game.progress'])
        if (typeof parsed.level !== 'number' || parsed.level < 1) return 'Progress level must be >= 1.'
      }
      return true
    },
    summary(data) {
      const progress = data['game.progress'] ? JSON.parse(data['game.progress']) : null
      return progress ? `Level ${progress.level} (${progress.coins} coins)` : 'No progress saved'
    }
  })

  const exported = manager.exportBackup()
  const envelope = JSON.parse(exported) as SaveBackupEnvelope
  assert.equal(envelope.format, BACKUP_FORMAT)
  assert.equal(envelope.version, BACKUP_SCHEMA_VERSION)
  assert.equal(envelope.gameId, 'lantern-grove')
  assert.equal(envelope.gameVersion, '1.2.0')
  assert.equal(typeof envelope.exportedAt, 'string')
  assert.ok(!Number.isNaN(Date.parse(envelope.exportedAt)))
  assert.deepEqual(envelope.data, {
    'game.progress': JSON.stringify({ level: 4, coins: 250 }),
    'game.settings': JSON.stringify({ volume: 0.8 })
  })
  assert.ok(!Object.hasOwn(envelope.data, 'game.optional'), 'Missing keys must not be serialized as null')
  assert.ok(!Object.hasOwn(envelope.data, 'unrelated.key'), 'Unconfigured keys must not be exported')

  // Verify pure-TS SHA-256 matches Node crypto SHA-256 exactly
  const canonical = JSON.stringify({
    format: envelope.format,
    version: envelope.version,
    gameId: envelope.gameId,
    gameVersion: envelope.gameVersion,
    exportedAt: envelope.exportedAt,
    data: {
      'game.progress': envelope.data['game.progress'],
      'game.settings': envelope.data['game.settings']
    }
  })
  const expectedSha = 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('hex')
  assert.equal(envelope.checksum, expectedSha)

  // Inspect before restoring
  const inspected = manager.inspectBackup(exported)
  assert.equal(inspected.ok, true)
  if (inspected.ok) {
    assert.equal(inspected.summary, 'Level 4 (250 coins)')
    assert.equal(inspected.exportedAt, envelope.exportedAt)
    assert.deepEqual(inspected.keys, ['game.progress', 'game.settings'])
  }

  // Mutate storage including an optional key not in backup, then restore
  storage.setItem('game.progress', JSON.stringify({ level: 1, coins: 0 }))
  storage.setItem('game.optional', 'stale-value')
  const restored = manager.restoreBackup(exported)
  assert.equal(restored.ok, true)
  if (restored.ok) {
    assert.equal(restored.summary, 'Level 4 (250 coins)')
    assert.deepEqual(restored.keys, ['game.progress', 'game.settings'])
  }
  assert.deepEqual(storage.dump(), {
    'game.progress': JSON.stringify({ level: 4, coins: 250 }),
    'game.settings': JSON.stringify({ volume: 0.8 }),
    'unrelated.key': 'leave-me-alone'
  })
})

test('createSaveBackup rejects wrong gameId, tampered checksum, corrupted JSON, unexpected keys, and custom validate failures', () => {
  const storage = createMemoryStorage({
    'save.slot1': '{"score":42}'
  })
  const manager = createSaveBackup({
    gameId: 'signal-drift',
    version: 2,
    storage,
    keys: ['save.slot1'],
    validate(data) {
      const slot = data['save.slot1'] ? JSON.parse(data['save.slot1']) : null
      if (slot && slot.score < 0) return 'Score cannot be negative.'
    }
  })

  const validJson = manager.exportBackup()
  const validObj = JSON.parse(validJson) as SaveBackupEnvelope

  // 1. Corrupted JSON
  const badJson = manager.inspectBackup('{not valid json')
  assert.equal(badJson.ok, false)
  if (!badJson.ok) assert.match(badJson.error, /valid JSON/i)

  // 2. Wrong gameId (even if checksum were recomputed by another game's backup manager)
  const otherGameManager = createSaveBackup({
    gameId: 'other-game',
    version: 2,
    storage: createMemoryStorage({ 'save.slot1': '{"score":99}' }),
    keys: ['save.slot1']
  })
  const wrongGame = manager.inspectBackup(otherGameManager.exportBackup())
  assert.equal(wrongGame.ok, false)
  if (!wrongGame.ok) assert.match(wrongGame.error, /other-game.*signal-drift/)

  // 3. Tampered checksum
  const tamperedChecksum = JSON.stringify({
    ...validObj,
    checksum: validObj.checksum.slice(0, -1) + (validObj.checksum.endsWith('0') ? '1' : '0')
  })
  const badSum = manager.inspectBackup(tamperedChecksum)
  assert.equal(badSum.ok, false)
  if (!badSum.ok) assert.match(badSum.error, /checksum mismatch/i)

  // 4. Tampered data payload without updating checksum
  const tamperedData = JSON.stringify({
    ...validObj,
    data: { 'save.slot1': '{"score":999999}' }
  })
  const badData = manager.restoreBackup(tamperedData)
  assert.equal(badData.ok, false)
  if (!badData.ok) assert.match(badData.error, /checksum mismatch/i)
  assert.equal(storage.getItem('save.slot1'), '{"score":42}', 'Failed restore must not touch storage')

  // 5. Unexpected key outside configured keys
  const extraKeyManager = createSaveBackup({
    gameId: 'signal-drift',
    version: 2,
    storage: createMemoryStorage({ 'save.slot1': '{"score":10}', 'injected.key': 'evil' }),
    keys: ['save.slot1', 'injected.key']
  })
  const extraKeyRes = manager.inspectBackup(extraKeyManager.exportBackup())
  assert.equal(extraKeyRes.ok, false)
  if (!extraKeyRes.ok) assert.match(extraKeyRes.error, /unexpected storage key/i)

  // 6. Custom validate rejection
  const negStorage = createMemoryStorage({ 'save.slot1': '{"score":-5}' })
  const negBackup = createSaveBackup({ gameId: 'signal-drift', version: 2, storage: negStorage, keys: ['save.slot1'] }).exportBackup()
  const invalidSchema = manager.inspectBackup(negBackup)
  assert.equal(invalidSchema.ok, false)
  if (!invalidSchema.ok) assert.equal(invalidSchema.error, 'Score cannot be negative.')
})

test('createSaveBackup rolls back storage atomically when a write throws mid-restore and supports browser download helper', () => {
  const backing = new Map<string, string>([
    ['k1', 'orig-1'],
    ['k2', 'orig-2'],
    ['k3', 'orig-3']
  ])
  let failOnSecondWrite = false
  let writes = 0
  const flakyStorage: SaveBackupStorage = {
    getItem: key => (backing.has(key) ? backing.get(key)! : null),
    setItem(key, value) {
      writes++
      if (failOnSecondWrite && writes === 2) {
        throw new Error('QuotaExceededError')
      }
      backing.set(key, String(value))
    },
    removeItem(key) {
      backing.delete(key)
    }
  }

  // Create backup where k1 & k2 change and k3 is absent (so restore would remove k3 if it reached k3)
  const sourceStorage = createMemoryStorage({ k1: 'new-1', k2: 'new-2' })
  const sourceBackup = createSaveBackup({
    gameId: 'rollback-test',
    storage: sourceStorage,
    keys: ['k1', 'k2', 'k3']
  }).exportBackup()

  const targetManager = createSaveBackup({
    gameId: 'rollback-test',
    storage: flakyStorage,
    keys: ['k1', 'k2', 'k3']
  })

  failOnSecondWrite = true
  const res = targetManager.restoreBackup(sourceBackup)
  assert.equal(res.ok, false)
  if (!res.ok) assert.match(res.error, /QuotaExceededError/)

  // Verify k1 was rolled back from 'new-1' to 'orig-1', and k2/k3 remain intact
  assert.deepEqual(Object.fromEntries(backing.entries()), {
    k1: 'orig-1',
    k2: 'orig-2',
    k3: 'orig-3'
  })

  // Without DOM in Node, downloadBackup returns false gracefully
  assert.equal(targetManager.downloadBackup(), false)

  // With mocked browser DOM APIs, downloadBackup creates a Blob + <a download> and clicks it
  let clicked = false
  let removed = false
  let createdAnchor: { href: string; download: string; click(): void; remove(): void } | undefined
  const prevDocument = globalThis.document
  const prevCreateObjectURL = URL.createObjectURL
  const prevRevokeObjectURL = URL.revokeObjectURL
  let revokedUrl = ''
  try {
    ;(globalThis as { document?: unknown }).document = {
      body: { append() {} },
      createElement(tag: string) {
        assert.equal(tag, 'a')
        createdAnchor = {
          href: '',
          download: '',
          click() { clicked = true },
          remove() { removed = true }
        }
        return createdAnchor
      }
    }
    URL.createObjectURL = () => 'blob:ridgetop-test-save'
    URL.revokeObjectURL = (url: string) => { revokedUrl = url }

    assert.equal(targetManager.downloadBackup(), true)
    assert.equal(clicked, true)
    assert.equal(removed, true)
    assert.equal(createdAnchor?.href, 'blob:ridgetop-test-save')
    assert.equal(createdAnchor?.download, 'rollback-test.ridgetop-save.json')
    void revokedUrl
  } finally {
    ;(globalThis as { document?: unknown }).document = prevDocument
    URL.createObjectURL = prevCreateObjectURL
    URL.revokeObjectURL = prevRevokeObjectURL
  }
})

test('parsePackageArgs accepts --target player', () => {
  const spaceForm = parsePackageArgs(['--target', 'player'])
  assert.equal(spaceForm.help, false)
  if (!spaceForm.help) assert.equal(spaceForm.target, 'player')

  const eqForm = parsePackageArgs(['--target=player', '--game', 'starter'])
  assert.equal(eqForm.help, false)
  if (!eqForm.help) {
    assert.equal(eqForm.target, 'player')
    assert.equal(eqForm.game, 'starter')
  }
})

test('packageGame(--target player) builds a self-contained offline HTML player for a custom create-game project with custom assets', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-player-custom-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  const projectDir = await createGame(join(work, 'my-lantern-game'))

  // Add studio artifacts that MUST NOT leak into the portable player HTML
  await mkdir(join(projectDir, 'game', 'reviews'), { recursive: true })
  await writeFile(join(projectDir, 'game', 'reviews', 'thread-secret.json'), '{"secret":"studio-review-leak"}')

  // Add custom imported assets (.art.json with closing-tag strings, .png, and .wav)
  const customRecipe = {
    name: 'custom-totem',
    note: 'safe closing tags </script></style> inside json',
    palette: { body: '#d98a4e', glow: '#8df5d5' },
    parts: [{ shape: 'box', pos: [0, 0.5, 0], size: [0.8, 1, 0.8], color: 'body' }]
  }
  await writeFile(join(projectDir, 'game', 'art', 'custom-totem.art.json'), JSON.stringify(customRecipe, null, 2))

  // Minimal valid 1x1 PNG
  const samplePng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf000002050102a729c3a50000000049454e44ae426082',
    'hex'
  )
  await writeFile(join(projectDir, 'game', 'art', 'hero-sprite.png'), samplePng)

  // Real RIFF/WAVE audio file
  const sampleWav = bakeMotifWav([[523.25, 0.08, 0]], { waveform: 'sine' })
  await writeFile(join(projectDir, 'game', 'art', 'pickup.wav'), sampleWav)

  // Add a closing </style> inside a CSS comment to verify escaping
  const origCss = await readFile(join(projectDir, 'game', 'style.css'), 'utf8')
  await writeFile(join(projectDir, 'game', 'style.css'), origCss + '\n/* trick </style> comment */\n')

  const outDir = join(work, 'out')
  const result = await packageGame({
    projectDir,
    target: 'player',
    outDir
  })

  assert.equal(result.name, 'Lantern Grove')
  assert.equal(result.slug, 'lantern-grove')
  assert.equal(result.outputs.length, 1)
  const output = result.outputs[0]
  assert.equal(output.target, 'player')
  assert.equal(output.files, 1)
  assert.equal(output.dir, join(outDir, 'player'))
  assert.equal(output.playerPath, join(outDir, 'player', 'lantern-grove-player.html'))

  // Ensure ONLY the single player HTML file exists inside <outDir>/player/
  const entries = await readdir(output.dir)
  assert.deepEqual(entries, ['lantern-grove-player.html'])

  const html = await readFile(output.playerPath!, 'utf8')
  assert.equal(output.totalBytes, Buffer.byteLength(html, 'utf8'))

  // Valid HTML with escaped </style and </script inside inline blocks
  const { scriptBlocks } = assertValidEscapedHtml(html)

  // Zero external stylesheet or module script references left
  assert.ok(!/<link\b[^>]*rel=["']stylesheet["']/i.test(html), 'Stylesheet links should be inlined')
  assert.ok(!/<script\b[^>]*type=["']module["'][^>]*\bsrc=/i.test(html), 'External module src tags should be inlined')

  // Zero studio/testing leaks
  assert.ok(!html.includes('testing-studio'), 'testing-studio must not leak into player HTML')
  assert.ok(!html.includes('testing-boot'), 'testing-boot must not leak into player HTML')
  assert.ok(!html.includes('testing-overlay.css'), 'testing-overlay.css must not leak into player HTML')
  assert.ok(!html.includes('studio-review-leak'), 'reviews/ studio files must not leak into player HTML')
  assert.ok(!html.includes('thread-secret.json'), 'reviews/ filenames must not leak into player HTML')
  assert.ok(!html.includes('art/library/'), 'art/library/ studio files must not leak into player HTML')

  // Verify importmap is valid JSON and decodes cleanly to JS modules with rewritten specifiers
  const importMapBlock = scriptBlocks.find(b => /type=["']importmap["']/i.test(b[1]))
  assert.ok(importMapBlock, 'Expected <script type="importmap"> block')
  const importMap = JSON.parse(importMapBlock[2]) as { imports: Record<string, string> }
  assert.ok(importMap.imports['ridgetop-offline/main.js']?.startsWith('data:text/javascript;base64,'))
  assert.ok(importMap.imports['ridgetop-offline/game.js']?.startsWith('data:text/javascript;base64,'))
  assert.ok(importMap.imports['ridgetop-offline/framework/index.js']?.startsWith('data:text/javascript;base64,'))
  assert.equal(importMap.imports['ridgetop-offline/framework/testing-studio.js'], undefined)
  assert.equal(importMap.imports['ridgetop-offline/framework/ui-slider.js'], undefined)

  const mainJs = Buffer.from(importMap.imports['ridgetop-offline/main.js'].split(',')[1], 'base64').toString('utf8')
  assert.ok(mainJs.includes('"ridgetop-offline/game.js"'), 'Relative imports should be rewritten to ridgetop-offline/ specifiers')
  assert.ok(mainJs.includes('"ridgetop-offline/framework/index.js"'))

  // Execute the embedded offline asset shim in a file:// VM sandbox and verify offline fetch & Image.src work
  const shimBlock = scriptBlocks.find(b => !b[1].trim() && b[2].includes('__ridgetopOfflineAssets'))
  assert.ok(shimBlock, 'Expected embedded offline virtual asset shim script')

  class FakeImage {
    private _src = ''
    get src() { return this._src }
    set src(value: string) { this._src = value }
  }
  const sandbox: Record<string, unknown> = {
    location: { href: 'file:///Users/player/Downloads/lantern-grove-player.html' },
    URL,
    Response,
    Headers,
    Uint8Array,
    atob,
    HTMLImageElement: FakeImage,
    fetch: () => Promise.reject(new Error('network fetch must not be called for embedded assets'))
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(shimBlock[2], sandbox)

  const offlineFetch = sandbox.fetch as typeof fetch
  const overrideRes = await offlineFetch('art/overrides.json')
  assert.equal(overrideRes.ok, true)
  assert.deepEqual(await overrideRes.json(), {})

  const recipeRes = await offlineFetch('./art/custom-totem.art.json')
  assert.equal(recipeRes.ok, true)
  assert.equal(recipeRes.url, 'file:///Users/player/Downloads/art/custom-totem.art.json')
  assert.deepEqual(await recipeRes.json(), customRecipe)

  const wavRes = await offlineFetch('art/pickup.wav')
  assert.equal(wavRes.ok, true)
  assert.equal(wavRes.headers.get('content-type'), 'audio/wav')
  assert.deepEqual(Buffer.from(await wavRes.arrayBuffer()), sampleWav)

  const pngRes = await offlineFetch('/art/hero-sprite.png?v=1')
  assert.equal(pngRes.ok, true)
  assert.equal(pngRes.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await pngRes.arrayBuffer()), samplePng)

  // Image.src resolves relative and file:// URLs against embedded PNG data URI
  const img = new FakeImage()
  img.src = new URL('hero-sprite.png', recipeRes.url).href
  assert.equal(img.src, 'data:image/png;base64,' + samplePng.toString('base64'))
})

test('packageGame(--target player) works for built-in games (beacon-run, signal-drift, lighthouse) and host serves testing-overlay.css + backup.js', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-player-builtin-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  // 1. Beacon Run: embeds sprites.json + sprites.png + inlines favicon data URI
  const beaconResult = await packageGame({
    target: 'player',
    game: 'beacon-run',
    repoRoot,
    outDir: join(work, 'beacon')
  })
  assert.equal(beaconResult.outputs.length, 1)
  const beaconHtml = await readFile(beaconResult.outputs[0].playerPath!, 'utf8')
  assertValidEscapedHtml(beaconHtml)
  assert.ok(!beaconHtml.includes('data-hosted="1"'))
  assert.ok(beaconHtml.includes('href="data:image/png;base64,'), 'Beacon Run favicon should be inlined as a data URI')
  assert.ok(beaconHtml.includes('game/assets/sprites.json'), 'Beacon Run sprite manifest should be embedded')
  assert.ok(beaconHtml.includes('game/assets/sprites.png'), 'Beacon Run sprite sheet PNG should be embedded')

  // 2. Signal Drift: clean offline player with zero hosted flags or studio files
  const driftResult = await packageGame({
    target: 'player',
    game: 'signal-drift',
    repoRoot,
    outDir: join(work, 'drift')
  })
  const driftHtml = await readFile(driftResult.outputs[0].playerPath!, 'utf8')
  assertValidEscapedHtml(driftHtml)
  assert.ok(!driftHtml.includes('data-hosted="1"'))
  assert.ok(!driftHtml.includes('testing-studio'))

  // 3. Tidewatch (lighthouse): clean offline player
  const lhResult = await packageGame({
    target: 'player',
    game: 'lighthouse',
    repoRoot,
    outDir: join(work, 'lh')
  })
  const lhHtml = await readFile(lhResult.outputs[0].playerPath!, 'utf8')
  assertValidEscapedHtml(lhHtml)
  assert.ok(!lhHtml.includes('data-hosted="1"'))
  assert.ok(!lhHtml.includes('testing-studio'))

  // 4. Generated standalone project's createGameHost serves /framework/testing-overlay.css and /framework/backup.js
  const projectDir = await createGame(join(work, 'host-check-game'))
  const hostMod = await import(pathToFileURL(join(projectDir, 'framework', 'host.js')).href)
  const app = hostMod.createGameHost({
    root: pathToFileURL(join(projectDir, 'game') + '/'),
    files: ['index.html', 'style.css', 'main.js', 'game.js'],
    testing: true
  })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  t.after(() => app.close())
  const addr = app.server.address() as { port: number }
  const base = `http://127.0.0.1:${addr.port}`

  const cssRes = await fetch(base + '/framework/testing-overlay.css')
  assert.equal(cssRes.status, 200, 'Generated game host should serve /framework/testing-overlay.css from frameworkRoot')
  assert.match(cssRes.headers.get('content-type') ?? '', /text\/css/)
  assert.ok((await cssRes.text()).length > 100)

  const backupRes = await fetch(base + '/framework/backup.js')
  assert.equal(backupRes.status, 200, 'Generated game host should serve /framework/backup.js')
  assert.match(backupRes.headers.get('content-type') ?? '', /text\/javascript/)
  assert.ok((await backupRes.text()).includes('createSaveBackup'))
})
