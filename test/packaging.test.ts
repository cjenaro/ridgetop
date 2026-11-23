import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { createArtKit } from '../framework/index.ts'
import { boxNode, column, overlay } from '../framework/ui-layout.ts'
import { bakeIconPng, bakeMotifWav, encodeGlb, layoutToGodotTscn, packageGame, parsePackageArgs } from '../framework/server.ts'
import { createGame } from '../tools/create-game.ts'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)

function readPngDimensions(buffer: Buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Expected valid PNG signature')
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function parseGlb(buffer: Buffer) {
  assert.equal(buffer.subarray(0, 4).toString('ascii'), 'glTF')
  assert.equal(buffer.readUInt32LE(4), 2)
  assert.equal(buffer.readUInt32LE(8), buffer.length)
  const jsonLength = buffer.readUInt32LE(12)
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a)
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
  const binHeaderOffset = 20 + jsonLength
  const binLength = buffer.readUInt32LE(binHeaderOffset)
  assert.equal(buffer.readUInt32LE(binHeaderOffset + 4), 0x004e4942)
  assert.equal(binHeaderOffset + 8 + binLength, buffer.length)
  return { json, binLength }
}

test('bakeIconPng, encodeGlb, bakeMotifWav, and layoutToGodotTscn produce valid binary/scene assets', () => {
  const kit = createArtKit()
  const group = kit.group()
  group.add('crystal', [0, 0, 0])
  const model = kit.model('crystal')

  const png = bakeIconPng({ batches: group.batches, span: model.span, centerY: model.centerY, size: 128 })
  assert.deepEqual(readPngDimensions(png), { width: 128, height: 128 })
  assert.ok(png.length > 500)

  const glb = encodeGlb(group.batches, 'crystal')
  const { json, binLength } = parseGlb(glb)
  assert.equal(json.asset.version, '2.0')
  assert.equal(json.meshes[0].primitives[0].attributes.POSITION, 0)
  assert.equal(json.meshes[0].primitives[0].attributes.NORMAL, 1)
  assert.equal(json.meshes[0].primitives[0].attributes.COLOR_0, 2)
  assert.ok(json.accessors[0].count >= 24)
  assert.ok(binLength >= json.accessors[0].count * 36)

  const wav = bakeMotifWav([[440, 0.12, 0, 880]], { waveform: 'triangle' })
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE')
  assert.equal(wav.readUInt32LE(24), 44100)
  let peak = 0
  for (let i = 44; i + 1 < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)))
  assert.ok(peak > 1000, 'Baked WAV should contain audible synth signal')

  const tscn = layoutToGodotTscn(overlay({ id: 'root' }, [
    column({ id: 'card', style: { anchor: 'center', width: 320, gap: 10 }, widget: { type: 'panel' } }, [
      boxNode({ id: 'play', style: { width: 200, height: 42 }, widget: { type: 'button', label: 'Start' } }),
      boxNode({ id: 'mute', style: { width: 200, height: 40 }, widget: { type: 'toggle', label: 'Sound', checked: true } })
    ])
  ]))
  assert.ok(tscn.includes('[gd_scene load_steps=2 format=3]'))
  assert.ok(tscn.includes('StyleBoxFlat_panel'))
  assert.ok(tscn.includes('type="PanelContainer"'))
  assert.ok(tscn.includes('type="VBoxContainer" parent="card"'))
  assert.ok(tscn.includes('type="Button" parent="card/Content"'))
  assert.ok(tscn.includes('text = "Start"'))
  assert.ok(tscn.includes('type="CheckButton"'))
})

test('parsePackageArgs validates flags and supports web, steam, mobile, godot, and all', () => {
  const defaults = parsePackageArgs([])
  assert.equal(defaults.help, false)
  if (!defaults.help) {
    assert.equal(defaults.target, 'all')
    assert.equal(defaults.orientation, 'landscape')
  }
  for (const target of ['web', 'steam', 'mobile', 'godot', 'all']) {
    const parsed = parsePackageArgs(['--target', target])
    assert.equal(parsed.help, false)
    if (!parsed.help) assert.equal(parsed.target, target)
  }
  assert.equal(parsePackageArgs(['--help']).help, true)
  assert.throws(() => parsePackageArgs(['--target', 'switch']), /Unknown --target/)
})

test('packageGame builds tree-shaken Web, Steam, Mobile, and Godot outputs for Signal Drift', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'ridgetop-pkg-drift-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))

  const result = await packageGame({
    target: 'all',
    game: 'signal-drift',
    repoRoot,
    outDir,
    steamAppId: '987654',
    appId: 'com.ridgetop.signaldrift'
  })

  assert.equal(result.name, 'Signal Drift')
  assert.deepEqual(result.outputs.map(o => o.target), ['web', 'steam', 'mobile', 'godot'])

  // 1. Web opt-in build is minimal, uses pure Canvas UI (zero HTML menus), and drops unused UI widgets & studio tools
  const webDir = join(outDir, 'web')
  const webHtml = await readFile(join(webDir, 'index.html'), 'utf8')
  assert.ok(!webHtml.includes('<button'), 'Signal Drift should have zero HTML menu buttons')
  assert.ok(!webHtml.includes('data-hosted="1"'), 'Standalone build should strip hosted cross-game flag')
  await access(join(webDir, 'framework', 'vehicle.js'))
  await access(join(webDir, 'framework', 'platform.js'))
  await access(join(webDir, 'framework', 'ui-canvas.js'))
  await access(join(webDir, 'framework', 'ui-button.js'))
  await access(join(webDir, 'framework', 'ui-layout.js'))
  await assert.rejects(access(join(webDir, 'framework', 'ui-slider.js')), 'unused ui-slider.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'ui-select.js')), 'unused ui-select.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'ui-toggle.js')), 'unused ui-toggle.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'ui-menu.js')), 'unused ui-menu.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'verification.js')), 'verification.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'art-review.js')), 'art-review.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'art-builder.js')), 'art-builder.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'platformer.js')), 'unused platformer.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'room-client.js')), 'unused room-client.js must be dropped')
  await assert.rejects(access(join(webDir, 'electron')), 'web target must not include Electron')

  // 2. Steam (Electron) package
  const steamDir = join(outDir, 'steam')
  const steamPkg = JSON.parse(await readFile(join(steamDir, 'package.json'), 'utf8'))
  assert.equal(steamPkg.main, 'electron/main.cjs')
  assert.equal((await readFile(join(steamDir, 'steam_appid.txt'), 'utf8')).trim(), '987654')
  const steamHtml = await readFile(join(steamDir, 'www', 'index.html'), 'utf8')
  assert.ok(steamHtml.includes('viewport-fit=cover'))
  assert.ok(!steamHtml.includes('data-hosted="1"'))

  for (const script of ['electron/main.cjs', 'electron/preload.cjs', 'electron/steam.cjs']) {
    new vm.Script(await readFile(join(steamDir, script), 'utf8'), { filename: script })
  }
  const steamBridge = require(join(steamDir, 'electron', 'steam.cjs'))
  steamBridge.init(steamDir)
  assert.equal(steamBridge.available(), false)
  assert.deepEqual(readPngDimensions(await readFile(join(steamDir, 'build', 'icon.png'))), { width: 512, height: 512 })

  // 3. Mobile (Capacitor) package
  const mobileDir = join(outDir, 'mobile')
  const capConfig = JSON.parse(await readFile(join(mobileDir, 'capacitor.config.json'), 'utf8'))
  assert.equal(capConfig.appId, 'com.ridgetop.signaldrift')
  const bridgeCode = await readFile(join(mobileDir, 'www', 'ridgetop-mobile-bridge.js'), 'utf8')
  const prefWrites: string[] = []
  const store = new Map<string, string>()
  const sandbox: Record<string, unknown> = {
    Capacitor: {
      getPlatform: () => 'ios',
      Plugins: {
        Preferences: { keys: async () => ({ keys: [] }), set: async ({ key, value }: { key: string; value: string }) => { prefWrites.push(`${key}=${value}`) } },
        Haptics: { impact: async () => {} },
        StatusBar: { hide: async () => {} },
        ScreenOrientation: { lock: async () => {} },
        SplashScreen: { hide: async () => {} },
        App: { addListener: () => {} }
      }
    },
    localStorage: {
      get length() { return store.size },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => { store.clear() }
    },
    addEventListener: () => {}
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(bridgeCode, sandbox)
  const nativeBridge = sandbox.__ridgetopPlatform as { platform: string; storage: { set(k: string, v: string): void } }
  assert.equal(nativeBridge.platform, 'ios')
  nativeBridge.storage.set('ridgetop.save', '{"credits":100}')
  assert.deepEqual(prefWrites, ['ridgetop.native.ridgetop.save={"credits":100}'])
  assert.deepEqual(readPngDimensions(await readFile(join(mobileDir, 'resources', 'icon.png'))), { width: 1024, height: 1024 })

  // 4. Godot 4 export (Switch / consoles pipeline)
  const godotDir = join(outDir, 'godot')
  const godotProject = await readFile(join(godotDir, 'project.godot'), 'utf8')
  assert.ok(godotProject.includes('config/name="Signal Drift"'))
  assert.ok(godotProject.includes('InputEventJoypadButton'))
  const carGlb = await readFile(join(godotDir, 'assets', 'models', 'rally-car.glb'))
  assert.ok(parseGlb(carGlb).binLength > 0)
  const pulseWav = await readFile(join(godotDir, 'assets', 'audio', 'pulse.wav'))
  assert.equal(pulseWav.subarray(0, 4).toString('ascii'), 'RIFF')
  const uiTscn = await readFile(join(godotDir, 'scenes', 'ui.tscn'), 'utf8')
  assert.ok(uiTscn.includes('text = "Start Race"'))
  await access(join(godotDir, 'scripts', 'main.gd'))
})

test('packageGame rewrites Beacon Run asset paths for offline native bundles', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'ridgetop-pkg-beacon-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))

  const result = await packageGame({ target: 'web', game: 'beacon-run', repoRoot, outDir })
  assert.equal(result.name, 'Beacon Run')
  const html = await readFile(join(outDir, 'index.html'), 'utf8')
  assert.ok(!html.includes('<button'), 'Beacon Run should have zero HTML menu buttons')
  const spritesJs = await readFile(join(outDir, 'game', 'sprites.js'), 'utf8')
  assert.ok(spritesJs.includes('./game/assets/sprites.json'))
  await access(join(outDir, 'game', 'assets', 'sprites.png'))
  await access(join(outDir, 'framework', 'ui-button.js'))
  await access(join(outDir, 'framework', 'ui-toggle.js'))
  await access(join(outDir, 'framework', 'ui-select.js'))
  await assert.rejects(access(join(outDir, 'framework', 'ui-slider.js')))
  await assert.rejects(access(join(outDir, 'framework', 'vehicle.js')))
  await assert.rejects(access(join(outDir, 'framework', 'verification.js')))
})

test('generated create-game projects use pure Canvas UI, drop studio reviews/tools, and shake unused UI widgets', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-created-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  const projectDir = await createGame(join(work, 'lantern-quest'))
  // Simulate studio playtest review artifacts that MUST be dropped from release builds
  await mkdir(join(projectDir, 'game', 'reviews'), { recursive: true })
  await writeFile(join(projectDir, 'game', 'reviews', 'thread-1.json'), '{"status":"open"}')

  const indexHtml = await readFile(join(projectDir, 'game', 'index.html'), 'utf8')
  assert.ok(!indexHtml.includes('<button'), 'Starter index.html should have zero HTML menu buttons')
  assert.ok(!indexHtml.includes('<select'), 'Starter index.html should have zero HTML select menus')
  assert.ok(indexHtml.includes('id="ui"'), 'Starter should render its UI on the Canvas UI layer')

  const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts['package:web'], 'node game/package.js --target web')
  assert.equal(pkg.scripts['package:godot'], 'node game/package.js --target godot')

  const { stdout } = await execFileAsync(process.execPath, ['game/package.js', '--target', 'all'], { cwd: projectDir })
  assert.match(stdout, /Packaged Lantern Grove/)

  const webDir = join(projectDir, 'dist', 'packages', 'web')
  // Used Canvas UI primitives ARE included
  await access(join(webDir, 'framework', 'ui-layout.js'))
  await access(join(webDir, 'framework', 'ui-button.js'))
  await access(join(webDir, 'framework', 'ui-toggle.js'))
  await access(join(webDir, 'framework', 'ui-menu.js'))
  await access(join(webDir, 'framework', 'ui-canvas.js'))
  // Unused UI primitives & studio/testing files are DROPPED
  await assert.rejects(access(join(webDir, 'framework', 'ui-slider.js')), 'unused ui-slider.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'ui-select.js')), 'unused ui-select.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'verification.js')), 'verification.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'art-review.js')), 'art-review.js must be dropped')
  await assert.rejects(access(join(webDir, 'reviews')), 'studio reviews/ directory must be dropped')
  await assert.rejects(access(join(webDir, 'art', 'library')), 'studio art/library/ directory must be dropped')
  await assert.rejects(access(join(webDir, 'serve.js')))
  await assert.rejects(access(join(webDir, 'testing.js')))
  await assert.rejects(access(join(webDir, 'package.js')))

  // Godot export includes baked 3D models from the starter game
  const godotDir = join(projectDir, 'dist', 'packages', 'godot')
  await access(join(godotDir, 'assets', 'models', 'ranger.glb'))
  await access(join(godotDir, 'assets', 'models', 'crystal.glb'))
  await access(join(godotDir, 'assets', 'models', 'flower.glb'))
  await access(join(godotDir, 'scenes', 'ui.tscn'))
})
