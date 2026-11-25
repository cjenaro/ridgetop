import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import vm from 'node:vm'
import { createArtKit, box, instances } from '../packages/ridgetop/framework/index.ts'
import { boxNode, column, overlay } from '../packages/ridgetop/framework/ui-layout.ts'
import { bakeIconPng, bakeMotifWav, encodeGlb, encodeWav, layoutToGodotTscn, packageGame, parsePackageArgs } from '../packages/ridgetop/framework/server.ts'
import { createGame } from '../packages/ridgetop/tools/create-game.ts'

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
  assert.ok(json.materials.length >= 1)
  assert.equal(json.meshes[0].primitives[0].attributes.POSITION, 0)
  assert.equal(json.meshes[0].primitives[0].attributes.NORMAL, 1)
  assert.ok(json.accessors[0].count >= 12)
  assert.ok(binLength >= json.accessors[0].count * 24)

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
  await assert.rejects(access(join(webDir, 'framework', 'review-store.js')), 'review-store.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-runtime.js')), 'testing-runtime.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-boot.js')), 'testing-boot.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-studio.js')), 'testing-studio.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-overlay.css')), 'testing-overlay.css must be dropped')
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
  const mobilePkg = JSON.parse(await readFile(join(mobileDir, 'package.json'), 'utf8'))
  assert.match(mobilePkg.dependencies['@capacitor/core'], /^\^8\.6\./, 'Mobile package must require Capacitor >=8.6 for iOS UIScene lifecycle support')
  assert.match(mobilePkg.devDependencies['@capacitor/ios'], /^\^8\.6\./)
  assert.match(mobilePkg.devDependencies['@capacitor/cli'], /^\^8\.6\./)
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

  // 4. Godot 4 export (Switch / consoles pipeline — custom Canvas UI, zero default Godot buttons, playable circuits!)
  const godotDir = join(outDir, 'godot')
  const godotProject = await readFile(join(godotDir, 'project.godot'), 'utf8')
  assert.ok(godotProject.includes('config/name="Signal Drift"'))
  assert.ok(godotProject.includes('InputEventJoypadButton'))
  const carGlb = await readFile(join(godotDir, 'assets', 'models', 'car-0.glb'))
  assert.ok(parseGlb(carGlb).binLength > 0)
  const copperGlb = await readFile(join(godotDir, 'assets', 'models', 'circuit-copper.glb'))
  assert.ok(parseGlb(copperGlb).binLength > 0)
  const pulseWav = await readFile(join(godotDir, 'assets', 'audio', 'pulse.wav'))
  assert.equal(pulseWav.subarray(0, 4).toString('ascii'), 'RIFF')
  const uiTscn = await readFile(join(godotDir, 'scenes', 'ui.tscn'), 'utf8')
  assert.ok(uiTscn.includes('ridgetop_ui.gd'), 'Godot UI scene should render via custom Canvas UI script, not default Controls')
  await access(join(godotDir, 'scripts', 'ridgetop_ui.gd'))
  await access(join(godotDir, 'scripts', 'ridgetop_runtime.gd'))
  await access(join(godotDir, 'scripts', 'main.gd'))
  await access(join(godotDir, 'scripts', 'compiled', 'rt.gd'))
  await access(join(godotDir, 'scripts', 'compiled', 'racing', 'race.gd'))
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
  await assert.rejects(access(join(outDir, 'framework', 'testing-runtime.js')))
  await assert.rejects(access(join(outDir, 'framework', 'testing-boot.js')))
  await assert.rejects(access(join(outDir, 'framework', 'testing-studio.js')))
  await assert.rejects(access(join(outDir, 'framework', 'testing-overlay.css')))
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
  // Generated projects inherit framework Testing Mode (no starter-only testing files)
  await assert.rejects(access(join(projectDir, 'game', 'testing.js')))
  await assert.rejects(access(join(projectDir, 'game', 'testing-scene.js')))
  await assert.rejects(access(join(projectDir, 'game', 'testing.html')))
  await assert.rejects(access(join(projectDir, 'game', 'testing.css')))
  await access(join(projectDir, 'framework', 'testing-boot.js'))
  await access(join(projectDir, 'framework', 'testing-studio.js'))
  await access(join(projectDir, 'framework', 'testing-overlay.css'))

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
  await assert.rejects(access(join(webDir, 'framework', 'review-store.js')), 'review-store.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-runtime.js')), 'testing-runtime.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-boot.js')), 'testing-boot.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-studio.js')), 'testing-studio.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-overlay.css')), 'testing-overlay.css must be dropped')
  await assert.rejects(access(join(webDir, 'reviews')), 'studio reviews/ directory must be dropped')
  await assert.rejects(access(join(webDir, 'art', 'library')), 'studio art/library/ directory must be dropped')
  await assert.rejects(access(join(webDir, 'serve.js')))
  await assert.rejects(access(join(webDir, 'package.js')))
  // Packaged starter framework barrel imports cleanly with inlined testing no-ops
  const starterBarrel = await import(pathToFileURL(join(webDir, 'framework', 'index.js')).href)
  assert.equal(typeof starterBarrel.registerTestingHooks, 'function')
  const unregister = starterBarrel.registerTestingHooks({ snapshot: () => ({}) })
  assert.equal(typeof unregister, 'function')
  unregister()

  // Godot export includes baked 3D models from the starter game
  const godotDir = join(projectDir, 'dist', 'packages', 'godot')
  await access(join(godotDir, 'assets', 'models', 'ranger.glb'))
  await access(join(godotDir, 'assets', 'models', 'crystal.glb'))
  await access(join(godotDir, 'assets', 'models', 'flower.glb'))
  await access(join(godotDir, 'scenes', 'ui.tscn'))
})

test('export-godot fixes Float32 accessor bounds, unlit PBR attenuation, WAV safety, layout anchors, and racing runtime', () => {
  const batch = instances(box, 2)
  batch.add([0.123456789, 1.987654321, -0.333333333], [1, 2, 0.5], [0, 0, 0, 1], [1, 0.5, 0.25], 1)
  batch.add([2, 0, 1], [1, 1, 1], [0, 0, 0, 1], [0.2, 0.4, 0.8], 0)
  const glb = encodeGlb([batch], 'bounds-test')
  const { json } = parseGlb(glb)
  const jsonLen = glb.readUInt32LE(12)
  const binStart = 20 + jsonLen + 8
  for (const acc of json.accessors) {
    if (!acc.min) continue
    const bv = json.bufferViews[acc.bufferView]
    const f32 = new Float32Array(glb.buffer, glb.byteOffset + binStart + (bv.byteOffset || 0), acc.count * 3)
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < acc.count; i++) {
      for (let k = 0; k < 3; k++) {
        const v = f32[i * 3 + k]
        if (v < lo[k]) lo[k] = v
        if (v > hi[k]) hi[k] = v
      }
    }
    assert.deepEqual(acc.min, lo)
    assert.deepEqual(acc.max, hi)
  }
  const unlitMat = json.materials.find((m: { emissiveFactor?: number[] }) => Array.isArray(m.emissiveFactor))
  assert.ok(unlitMat, 'expected emissive material for unlit=1 instance')
  assert.deepEqual(unlitMat.pbrMetallicRoughness.baseColorFactor, [0, 0, 0, 1])

  // WAV NaN/Infinity and non-positive frequency safety
  const safeWav = encodeWav(new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, -2, 0.5]))
  assert.equal(safeWav.readInt16LE(44), 0)
  assert.equal(safeWav.readInt16LE(46), 0)
  assert.equal(safeWav.readInt16LE(48), -32767)
  const motifWav = bakeMotifWav([[0, 0.1, 0], [-100, 0.1, 0], [440, 0.1, 0, -5]])
  assert.equal(motifWav.subarray(0, 4).toString('ascii'), 'RIFF')

  // Layout anchors (bottom, bottom-left, tuple inset, fractional offsets), newline escaping, and digit-prefixed deduplicated node names
  const tscn = layoutToGodotTscn(overlay({ id: 'root' }, [
    boxNode({ id: '1st', style: { anchor: 'bottom', width: 200, height: 40, inset: [12, 24] }, widget: { type: 'text', text: 'Line 1\nLine 2' } }),
    boxNode({ id: '1st', style: { anchor: 'bottom-left', width: 100.5, height: 30, inset: [10.5, 30] }, widget: { type: 'text', text: 'B' } })
  ]))
  assert.ok(tscn.includes('name="_1st"'))
  assert.ok(tscn.includes('name="_1st_2"'))
  assert.ok(tscn.includes('anchors_preset = 7'))
  assert.ok(tscn.includes('offset_bottom = -24.0'))
  assert.ok(tscn.includes('text = "Line 1\\nLine 2"'))
  assert.ok(tscn.includes('anchors_preset = 2'))
  assert.ok(tscn.includes('offset_left = 10.5'))
  assert.ok(!tscn.includes('10.5.0'))
  assert.ok(tscn.includes('offset_bottom = -30.0'))
})

test('packager handles nested game subdirs, comment/template imports, scoped mobile clear, Electron hardening, and slug trimming', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-pkg-edge-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  // Leading/trailing punctuation in directory name produces a clean npm package name
  const projectDir = await createGame(join(work, '---My Game!---'))
  const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'my-game')

  // Add nested subdir module with ../../framework/ import, regex literals with quotes/braces/slashes, comments/templates with fake imports, and an unused sibling JS file
  await mkdir(join(projectDir, 'game', 'sub'), { recursive: true })
  await writeFile(join(projectDir, 'game', 'sub', 'helper.js'), `
// import { fake } from './does-not-exist.js'
export function note(s) {
  const re = /['"{(/*]/g
  return re.test(s) ? \`import { nope } from './nope.js'\` : ''
}
import { color } from '../../framework/index.js'
export const accent = color('#efac62')
`)
  await writeFile(join(projectDir, 'game', 'sub', 'unused.js'), `export const dead = 1\n`)
  const origMain = await readFile(join(projectDir, 'game', 'main.js'), 'utf8')
  await writeFile(join(projectDir, 'game', 'main.js'), `import { accent } from './sub/helper.js'\nvoid accent\n` + origMain)
  const origHtml = await readFile(join(projectDir, 'game', 'index.html'), 'utf8')
  await writeFile(join(projectDir, 'game', 'index.html'), origHtml.replace('<script type="module" src="./main.js">', '<script defer src="./main.js" type="module">'))

  const outDir = join(work, 'out')
  await packageGame({ target: 'all', projectDir, outDir })

  const helperOut = await readFile(join(outDir, 'web', 'sub', 'helper.js'), 'utf8')
  assert.ok(helperOut.includes("'../framework/index.js'"), 'nested game subdir should rewrite ../../framework/ -> ../framework/')
  await assert.rejects(access(join(outDir, 'web', 'sub', 'unused.js')), 'unused nested JS should not be copied')

  const electronMain = await readFile(join(outDir, 'steam', 'electron', 'main.cjs'), 'utf8')
  assert.ok(electronMain.includes('sandbox: true'))
  assert.ok(electronMain.includes('isDestroyed()'))
  assert.ok(electronMain.includes('setWindowOpenHandler'))
  assert.ok(electronMain.includes('will-navigate'))
  assert.ok(electronMain.includes("pathname.includes('\\0')"))
  assert.ok(electronMain.includes('!Array.isArray(parsed)'))
  const builderYml = await readFile(join(outDir, 'steam', 'electron-builder.yml'), 'utf8')
  assert.ok(builderYml.includes('steam_appid.txt'))
  assert.ok(builderYml.includes('appId: "'))
  assert.ok(builderYml.includes('executableName: "'))

  // Mobile bridge clear() only removes ridgetop.native.* keys, respects pre-hydration writes, and notifies onHydrate listeners
  const bridgeCode = await readFile(join(outDir, 'mobile', 'www', 'ridgetop-mobile-bridge.js'), 'utf8')
  const prefStore = new Map<string, string>([
    ['ridgetop.native.save', 'old'],
    ['ridgetop.native.recovered', 'from-prefs'],
    ['other.plugin.token', 'keep-me']
  ])
  let releaseKeys!: () => void
  const keysGate = new Promise<void>(r => { releaseKeys = r })
  const local = new Map<string, string>()
  const sandbox: Record<string, unknown> = {
    Capacitor: {
      getPlatform: () => 'android',
      Plugins: {
        Preferences: {
          keys: async () => { await keysGate; return { keys: Array.from(prefStore.keys()) } },
          get: async ({ key }: { key: string }) => ({ value: prefStore.get(key) ?? null }),
          set: async ({ key, value }: { key: string; value: string }) => { prefStore.set(key, value) },
          remove: async ({ key }: { key: string }) => { prefStore.delete(key) },
          clear: async () => { throw new Error('must not call global Preferences.clear()') }
        }
      }
    },
    localStorage: {
      get length() { return local.size },
      key: (i: number) => Array.from(local.keys())[i] ?? null,
      getItem: (k: string) => local.get(k) ?? null,
      setItem: (k: string, v: string) => { local.set(k, v) },
      removeItem: (k: string) => { local.delete(k) },
      clear: () => { local.clear() }
    },
    addEventListener: () => {}
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(bridgeCode, sandbox)
  const bridge = sandbox.__ridgetopPlatform as {
    storage: {
      remove(k: string): void
      clear(): void
      onHydrate(fn: (k: string, v: string) => void): () => void
    }
  }
  const hydrated: [string, string][] = []
  bridge.storage.onHydrate((k, v) => hydrated.push([k, v]))
  bridge.storage.remove('save')
  releaseKeys()
  await new Promise(r => setTimeout(r, 15))
  assert.equal(local.get('save'), undefined, 'hydration must not restore a key removed before hydration finished')
  assert.equal(local.get('recovered'), 'from-prefs')
  assert.deepEqual(hydrated, [['recovered', 'from-prefs']], 'late-hydrated keys must notify live storage subscribers')
  prefStore.set('ridgetop.native.extra', 'v')
  bridge.storage.clear()
  await new Promise(r => setTimeout(r, 15))
  assert.equal(prefStore.get('other.plugin.token'), 'keep-me', 'clear() must not wipe non-ridgetop Preferences keys')
  assert.equal(prefStore.has('ridgetop.native.extra'), false)
})

test('packageGame builds tree-shaken Web, Steam, Mobile, and Godot outputs for Tidewatch (lighthouse)', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'ridgetop-pkg-lighthouse-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))

  const result = await packageGame({
    target: 'all',
    game: 'lighthouse',
    repoRoot,
    outDir,
    steamAppId: '480',
    appId: 'com.ridgetop.tidewatch'
  })

  assert.equal(result.name, 'Tidewatch')
  assert.deepEqual(result.outputs.map(o => o.target), ['web', 'steam', 'mobile', 'godot'])

  // 1. Web build traces lighthouse/main.js cleanly, bundles CSS/HTML, drops studio/testing & unused modules
  const webDir = join(outDir, 'web')
  const webHtml = await readFile(join(webDir, 'index.html'), 'utf8')
  assert.ok(!webHtml.includes('<button'), 'Tidewatch should have zero HTML menu buttons')
  assert.ok(!webHtml.includes('data-hosted="1"'), 'Standalone build should strip hosted flag')
  assert.ok(webHtml.includes('href="./game-ui.css"'))
  assert.ok(webHtml.includes('src="./lighthouse/main.js"'))
  await access(join(webDir, 'game-ui.css'))
  for (const mod of ['main.js', 'simulation.js', 'types.js', 'art.js', 'scene.js', 'audio.js']) {
    await access(join(webDir, 'lighthouse', mod))
  }
  await access(join(webDir, 'framework', 'index.js'))
  await access(join(webDir, 'framework', 'animation.js'))
  await access(join(webDir, 'framework', 'ui-layout.js'))
  await access(join(webDir, 'framework', 'ui-button.js'))
  await access(join(webDir, 'framework', 'ui-canvas.js'))
  await assert.rejects(access(join(webDir, 'framework', 'verification.js')), 'verification.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'art-review.js')), 'art-review.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'review-store.js')), 'review-store.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-runtime.js')), 'testing-runtime.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-boot.js')), 'testing-boot.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-studio.js')), 'testing-studio.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'testing-overlay.css')), 'testing-overlay.css must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'art-builder.js')), 'art-builder.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'ui-slider.js')), 'unused ui-slider.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'ui-select.js')), 'unused ui-select.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'ui-toggle.js')), 'unused ui-toggle.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'ui-menu.js')), 'unused ui-menu.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'vehicle.js')), 'unused vehicle.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'platformer.js')), 'unused platformer.js must be dropped')
  await assert.rejects(access(join(webDir, 'framework', 'room-client.js')), 'unused room-client.js must be dropped')
  await assert.rejects(access(join(webDir, 'electron')), 'web target must not include Electron')

  // Verify the packaged simulation & art modules import and execute cleanly against the pruned framework/index.js
  const packagedSim = await import(pathToFileURL(join(webDir, 'lighthouse', 'simulation.js')).href)
  const simState = packagedSim.createInitialState(1337)
  packagedSim.stepGame(simState, { x: 1, z: 0 }, 1 / 60)
  assert.ok(simState.items.length > 0, 'packaged simulation should spawn coastal resources using pruned nextRandom')
  const packagedArt = await import(pathToFileURL(join(webDir, 'lighthouse', 'art.js')).href)
  assert.ok(packagedArt.buildStaticIslandBatches().length > 0)

  // 2. Steam (Electron) target
  const steamDir = join(outDir, 'steam')
  const steamPkg = JSON.parse(await readFile(join(steamDir, 'package.json'), 'utf8'))
  assert.equal(steamPkg.main, 'electron/main.cjs')
  assert.equal((await readFile(join(steamDir, 'steam_appid.txt'), 'utf8')).trim(), '480')
  const steamHtml = await readFile(join(steamDir, 'www', 'index.html'), 'utf8')
  assert.ok(steamHtml.includes('viewport-fit=cover'))
  assert.ok(!steamHtml.includes('data-hosted="1"'))
  assert.deepEqual(readPngDimensions(await readFile(join(steamDir, 'build', 'icon.png'))), { width: 512, height: 512 })

  // 3. Mobile (Capacitor) target
  const mobileDir = join(outDir, 'mobile')
  const capConfig = JSON.parse(await readFile(join(mobileDir, 'capacitor.config.json'), 'utf8'))
  assert.equal(capConfig.appId, 'com.ridgetop.tidewatch')
  await access(join(mobileDir, 'www', 'ridgetop-mobile-bridge.js'))
  assert.deepEqual(readPngDimensions(await readFile(join(mobileDir, 'resources', 'icon.png'))), { width: 1024, height: 1024 })

  // 4. Godot 4 target (representative GLB meshes, WAV SFX, compiled GDScript)
  const godotDir = join(outDir, 'godot')
  const godotProject = await readFile(join(godotDir, 'project.godot'), 'utf8')
  assert.ok(godotProject.includes('config/name="Tidewatch"'))
  assert.ok(godotProject.includes('InputEventJoypadButton'))
  for (const modelName of ['island', 'keeper', 'lighthouse', 'ship', 'buoy', 'salvage', 'amber']) {
    const glb = await readFile(join(godotDir, 'assets', 'models', `${modelName}.glb`))
    assert.ok(parseGlb(glb).binLength > 0, `expected valid GLB for ${modelName}`)
  }
  for (const clip of ['pickup', 'sell', 'fuel', 'upgrade', 'foghorn', 'victory']) {
    const wav = await readFile(join(godotDir, 'assets', 'audio', `${clip}.wav`))
    assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF', `expected valid WAV for ${clip}`)
  }
  const uiTscn = await readFile(join(godotDir, 'scenes', 'ui.tscn'), 'utf8')
  assert.ok(uiTscn.includes('ridgetop_ui.gd'))
  await access(join(godotDir, 'scripts', 'ridgetop_runtime.gd'))
  await access(join(godotDir, 'scripts', 'compiled', 'rt.gd'))
  await access(join(godotDir, 'scripts', 'compiled', 'lighthouse', 'simulation.gd'))
  await access(join(godotDir, 'scripts', 'compiled', 'lighthouse', 'types.gd'))
  await access(join(godotDir, 'scripts', 'compiled', 'framework', 'ui-layout.gd'))
  await access(join(godotDir, 'scripts', 'compiled', 'framework', 'ui-button.gd'))
})

test('external standalone project outside repo with bare ridgetop imports works in host Import Map & packager (all + player)', async t => {
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-ext-repo-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  const projectDir = join(work, 'external-quest')
  await mkdir(join(projectDir, 'src'), { recursive: true })
  await writeFile(join(projectDir, 'package.json'), JSON.stringify({
    name: 'external-quest',
    version: '1.2.3',
    private: true,
    type: 'module',
    ridgetop: {
      name: 'External Quest',
      appId: 'com.example.externalquest',
      godotEntries: ['src/sim.ts', 'ridgetop/ui-layout']
    }
  }, null, 2))
  await writeFile(join(projectDir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>External Quest</title>
  <link rel="stylesheet" href="./style.css">
  <script type="module" src="./main.js"></script>
</head>
<body><canvas id="stage"></canvas></body>
</html>
`)
  await writeFile(join(projectDir, 'style.css'), 'body { margin: 0; background: #102028; }\n')
  await writeFile(join(projectDir, 'src', 'sim.ts'), `import { createPlatformer } from 'ridgetop'
export const sim = createPlatformer()
export function ping(x: number) { return x + 1 }
`)
  await writeFile(join(projectDir, 'main.js'), `import { color, registerTestingHooks } from 'ridgetop'
import { boxNode, overlay } from 'ridgetop/ui-layout'
import { buttonPrimitive } from 'ridgetop/ui-button'
export const theme = color('#efac62')
export const rootNode = overlay({ id: 'root' }, [boxNode({ id: 'go', style: { width: 120, height: 40 } })])
export const btn = buttonPrimitive.create({ id: 'go', label: 'Go' })
registerTestingHooks({ snapshot: () => ({ ok: true }) })
`)

  // 1. Verify createGameHost serves Import Map + matching SHA-256 CSP header and /framework/*.js
  const { createGameHost } = await import('../packages/ridgetop/framework/server.ts')
  const app = createGameHost({
    root: pathToFileURL(projectDir + '/'),
    files: ['index.html', 'style.css', 'main.js'],
    aliases: { '/': 'index.html' }
  })
  t.after(() => app.close())
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const port = (app.server.address() as { port: number }).port
  const htmlRes = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(htmlRes.status, 200)
  const csp = htmlRes.headers.get('content-security-policy') ?? ''
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/, 'CSP must permit exact SHA-256 hash of importmap without unsafe-inline')
  assert.ok(!csp.includes('unsafe-inline'), 'CSP must never include unsafe-inline')
  const servedHtml = await htmlRes.text()
  assert.ok(servedHtml.includes('<script type="importmap">'), 'Host must inject importmap for bare ridgetop specifiers')
  assert.ok(servedHtml.includes('"ridgetop":"/framework/index.js"'))
  assert.ok(servedHtml.includes('"ridgetop/ui-layout":"/framework/ui-layout.js"'))
  assert.equal((await fetch(`http://127.0.0.1:${port}/framework/index.js`)).status, 200)

  // 2. Verify packageGame(all + player) resolves bare specifiers, tree-shakes, compiles Godot GDScript, and leaves ZERO bare specifiers
  const outDir = join(work, 'out')
  const result = await packageGame({ target: 'all', projectDir, outDir })
  assert.equal(result.name, 'External Quest')
  assert.equal(result.appId, 'com.example.externalquest')

  const webMain = await readFile(join(outDir, 'web', 'main.js'), 'utf8')
  assert.ok(!webMain.includes("'ridgetop'"), 'Bundled main.js must rewrite bare ridgetop import')
  assert.ok(!webMain.includes("'ridgetop/ui-layout'"), 'Bundled main.js must rewrite bare ridgetop/ui-layout import')
  assert.ok(webMain.includes("'./framework/index.js'"))
  assert.ok(webMain.includes("'./framework/ui-layout.js'"))
  assert.ok(webMain.includes("'./framework/ui-button.js'"))
  await assert.rejects(access(join(outDir, 'web', 'framework', 'ui-slider.js')), 'unused ui-slider.js must be dropped')
  await assert.rejects(access(join(outDir, 'web', 'framework', 'testing-runtime.js')), 'testing-runtime.js must be dropped')

  // Verify bundled main.js actually executes cleanly in Node!
  const bundled = await import(pathToFileURL(join(outDir, 'web', 'main.js')).href)
  assert.equal(bundled.rootNode.id, 'root')
  assert.equal(bundled.btn.id, 'go')

  // Verify Godot target compiled TS using bundled packages/ridgetop/tools/ts-to-gd!
  await access(join(outDir, 'godot', 'scripts', 'compiled', 'rt.gd'))
  await access(join(outDir, 'godot', 'scripts', 'compiled', 'src', 'sim.gd'))
  await access(join(outDir, 'godot', 'scripts', 'compiled', 'framework', 'platformer.gd'))
  await access(join(outDir, 'godot', 'scripts', 'compiled', 'framework', 'ui-layout.gd'))

  // Verify portable player HTML target also works cleanly
  const playerRes = await packageGame({ target: 'player', projectDir, outDir: join(work, 'out-player') })
  assert.equal(playerRes.outputs[0].files, 1)
  const playerHtml = await readFile(playerRes.outputs[0].playerPath!, 'utf8')
  assert.ok(playerHtml.includes('ridgetop-offline/framework/index.js'))
})
