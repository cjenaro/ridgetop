import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { box, color, instances, octahedron } from '../packages/ridgetop/framework/index.ts'
import {
  MISSING_TYPESCRIPT_COMPILER_MESSAGE,
  bakeIconPng,
  exportGodotProject,
  loadGodotCompiler,
  readGodotRuntimeTemplate,
  resolveGodotRuntimeTemplatePath
} from '../packages/ridgetop/framework/server.ts'

async function findGodot(): Promise<string | null> {
  if (process.env.GODOT_BIN) return process.env.GODOT_BIN
  const which = spawnSync('which', ['godot4', 'godot'], { encoding: 'utf8' })
  const found = which.stdout?.trim().split('\n')[0]
  if (found) return found
  const appsDir = join(process.env.HOME ?? '', 'Applications')
  try {
    const entries = await readdir(appsDir)
    const match = entries.filter(name => /^Godot_v4\..*linux/i.test(name)).sort().at(-1)
    if (match) return join(appsDir, match)
  } catch {}
  return null
}

function makeTestAssets() {
  const beacon = instances(box, 2)
  beacon.add([0, 0.5, 0], [0.8, 1.0, 0.8], 0, color('f0b154'), 0.2)
  beacon.add([0, 1.2, 0], [0.4, 0.4, 0.4], 0, color('84f2d8'), 0.95)

  const gem = instances(octahedron, 1)
  gem.add([0, 0.5, 0], [0.45, 0.65, 0.45], 0, color('7fffe4'), 0.8)

  const iconPng = bakeIconPng({ batches: [beacon], span: 2.2, centerY: 0.6, size: 128 })
  return {
    models: { beacon: [beacon], gem: [gem] },
    audio: {
      chime: { notes: [[523.25, 0.12, 0], [783.99, 0.18, 0.08]] as const, waveform: 'triangle' as const },
      whoosh: { notes: [[280, 0.16, 0, 120]] as const, waveform: 'sine' as const }
    },
    iconPng
  }
}

test('exportGodotProject emits clean GDScript 4 scripts/ridgetop_runtime.gd and wires main.gd', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'ridgetop-godot-rt-syntax-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))

  const { models, audio, iconPng } = makeTestAssets()
  await exportGodotProject({
    outDir,
    name: 'Generic Harbor',
    slug: 'generic-harbor',
    models,
    audio,
    gameData: {
      game: 'generic-harbor',
      lighting: { direction: [-0.4, 0.85, 0.35], ambient: 0.45, fogNear: 12, fogFar: 60, fogColor: [0.55, 0.72, 0.78] }
    },
    iconPng
  })

  await access(join(outDir, 'scripts', 'ridgetop_runtime.gd'))
  await access(join(outDir, 'scripts', 'main.gd'))
  await access(join(outDir, 'scripts', 'ridgetop_ui.gd'))

  const rtGd = await readFile(join(outDir, 'scripts', 'ridgetop_runtime.gd'), 'utf8')
  const mainGd = await readFile(join(outDir, 'scripts', 'main.gd'), 'utf8')

  // Core runtime bridge APIs present
  for (const token of [
    'func set_lighting(',
    'fog_enabled',
    'fog_light_color',
    'fog_depth_begin',
    'fog_depth_end',
    'OmniLight3D',
    'MultiMeshInstance3D',
    'MeshInstance3D',
    'BLEND_MODE_ADD',
    'TRANSPARENCY_ALPHA',
    'TRANSPARENCY_DISABLED',
    'func create_batch(',
    'func create_mesh_pool(',
    'func create_rig(',
    'func apply_poses(',
    'func create_particles(',
    'AudioServer',
    '"Music"',
    '"SFX"',
    '"Ambience"',
    'func play_sfx(',
    'func register_ambient_bed(',
    'func set_ambient_bed(',
    'func load_compiled_module('
  ]) {
    assert.ok(rtGd.includes(token), `ridgetop_runtime.gd missing expected token: ${token}`)
  }

  assert.ok(mainGd.includes('preload("res://scripts/ridgetop_runtime.gd")'), 'main.gd should preload ridgetop_runtime.gd')
  assert.ok(mainGd.includes('_setup_generic_game'), 'main.gd should include generic game bootstrap')

  // GDScript 4 strictness checks on all 4 extracted runtime templates + emitted & host scripts
  const templateFiles = ['ridgetop_ui.gd', 'ridgetop_runtime.gd', 'main.gd', 'rt.gd'] as const
  const templateSources: Array<[string, string]> = []
  for (const tplName of templateFiles) {
    const tplPath = resolveGodotRuntimeTemplatePath(tplName)
    await access(tplPath)
    const diskSource = await readFile(tplPath, 'utf8')
    assert.equal(readGodotRuntimeTemplate(tplName), diskSource, `readGodotRuntimeTemplate(${tplName}) should match on-disk file`)
    assert.ok(!diskSource.includes('\\t'), `templates/godot-runtime/${tplName} should use real tabs, not escaped \\t`)
    templateSources.push([`templates/godot-runtime/${tplName}`, diskSource])
  }
  const mainTemplate = readGodotRuntimeTemplate('main.gd')
  assert.ok(mainTemplate.includes('"__GAME_NAME__"'), 'templates/godot-runtime/main.gd should contain __GAME_NAME__ placeholder')
  assert.ok(!mainGd.includes('__GAME_NAME__'), 'emitted main.gd should substitute __GAME_NAME__')
  assert.ok(mainGd.includes('"Generic Harbor"'), 'emitted main.gd should contain the escaped game name')

  const signalDriftHostGd = await readFile(new URL('../examples/signal-drift/racing/godot-main.gd', import.meta.url), 'utf8')
  const starterHostGd = await readFile(new URL('../packages/ridgetop/templates/starter/godot-main.gd', import.meta.url), 'utf8')
  for (const [label, src] of [
    ...templateSources,
    ['ridgetop_runtime.gd', rtGd],
    ['main.gd', mainGd],
    ['examples/signal-drift/racing/godot-main.gd', signalDriftHostGd],
    ['packages/ridgetop/templates/starter/godot-main.gd', starterHostGd]
  ] as const) {
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trimStart().startsWith('#')) continue
      assert.ok(
        !/(?<![.\d])\d+\s*\/\s*\d+(?![.\d])/.test(line.replace(/"[^"]*"/g, '')),
        `${label}:${i + 1} has potential int/int division: ${line}`
      )
      assert.ok(
        !/\bvar\s+[a-zA-Z_]\w*\s*:=\s*[a-zA-Z_]\w*\.get\(/.test(line),
        `${label}:${i + 1} has uncast Variant := from .get(): ${line}`
      )
      assert.ok(
        !/\bvar\s+[a-zA-Z_]\w*\s*:=\s*[a-zA-Z_]\w*\[[^\]]*\](?!\s+as\s+[A-Z])/.test(line),
        `${label}:${i + 1} has uncast Variant := from subscript: ${line}`
      )
    }
  }
  assert.ok(!rtGd.includes('.look_at('), 'ridgetop_runtime.gd should use safe Basis.looking_at instead of Node3D.look_at')
})

test('loadGodotCompiler resolves ts-to-gd and reports consistent diagnostics on missing compiler or typescript peer dep', async t => {
  const compiler = await loadGodotCompiler()
  assert.equal(typeof compiler.compileTsToGd, 'function')
  assert.equal(typeof compiler.compileTsProjectToGodot, 'function')
  assert.equal(typeof compiler.renderRtGd, 'function')
  assert.equal(compiler.renderRtGd(), readGodotRuntimeTemplate('rt.gd'))

  const work = await mkdtemp(join(tmpdir(), 'ridgetop-loader-test-'))
  t.after(() => rm(work, { recursive: true, force: true }))

  await assert.rejects(
    loadGodotCompiler({ compilerPath: join(work, 'missing-compiler.js') }),
    /Godot TypeScript compiler \(ts-to-gd\) not found/
  )

  const badExportPath = join(work, 'bad-compiler.mjs')
  await writeFile(badExportPath, 'export const notACompiler = true\n')
  await assert.rejects(
    loadGodotCompiler({ compilerPath: badExportPath }),
    /does not export compileTsProjectToGodot\(\)/
  )

  const missingTsStub = join(work, 'missing-ts.mjs')
  await writeFile(
    missingTsStub,
    `const err = new Error("Cannot find package 'typescript' imported from ts-to-gd.js"); err.code = 'ERR_MODULE_NOT_FOUND'; throw err;\n`
  )
  await assert.rejects(
    loadGodotCompiler({ compilerPath: missingTsStub }),
    error => error instanceof Error && error.message === MISSING_TYPESCRIPT_COMPILER_MESSAGE
  )
})

test('live Godot 4 headless exercises RidgetopRuntime lighting/fog/point lights, batches, rigs, particles, audio, and Canvas UI with zero stderr', async t => {
  const godot = await findGodot()
  if (!godot) {
    t.skip('Godot 4 binary not found in PATH or ~/Applications')
    return
  }

  const outDir = await mkdtemp(join(tmpdir(), 'ridgetop-godot-rt-live-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))

  const { models, audio, iconPng } = makeTestAssets()
  await exportGodotProject({
    outDir,
    name: 'Runtime Bridge Probe',
    slug: 'runtime-bridge-probe',
    models,
    audio,
    gameData: {
      game: 'custom-probe',
      entry: 'custom/runtime_probe.gd',
      theme: { accent: '#f0b154', glow: '#84f2d8' },
      lighting: {
        direction: [-0.45, 0.84, 0.36],
        ambient: 0.5,
        color: [1.0, 0.96, 0.88],
        fogColor: [0.58, 0.72, 0.78],
        fogNear: 14.0,
        fogFar: 56.0,
        points: [
          { position: [2.0, 1.5, 0.0], color: [1.0, 0.75, 0.3], radius: 8.0, intensity: 1.8 },
          { position: [-2.0, 1.0, 1.0], color: [0.4, 0.95, 0.85], radius: 6.0, intensity: 1.2 }
        ]
      },
      ambience: {
        ocean: { type: 'lowpass', frequency: 380.0, q: 0.7, gain: 0.08 },
        wind: { type: 'bandpass', frequency: 520.0, q: 1.8, gain: 0.03 }
      },
      scene: [
        { model: 'beacon', position: [0.0, 0.0, 0.0], yaw: 0.4, scale: [1.0, 1.0, 1.0] },
        { model: 'gem', position: [2.5, 0.2, -1.0], scale: 1.15 }
      ],
      rigs: [
        {
          position: [-2.0, 0.0, 0.0],
          joints: [
            { id: 'base', pivot: [0.0, 0.0, 0.0], parts: [{ mesh: 'box', scale: [0.6, 0.4, 0.6], color: '#5c7a82' }] },
            { id: 'top', parent: 'base', pivot: [0.0, 0.6, 0.0], parts: [{ mesh: 'octahedron', scale: [0.3, 0.3, 0.3], color: '#84f2d8', unlit: 0.9 }] }
          ]
        }
      ],
      camera: {
        projection: 'perspective',
        position: [0.0, 5.0, 9.0],
        target: [0.0, 0.8, 0.0],
        fov: 48.0
      }
    },
    iconPng
  })

  const compiledCustomDir = join(outDir, 'scripts', 'compiled', 'custom')
  await mkdir(compiledCustomDir, { recursive: true })
  await writeFile(join(compiledCustomDir, 'runtime_probe.gd'), `extends RefCounted

var _reported: bool = false
var _frame: int = 0
var _results: Dictionary = {}
var _rig = null
var _particles = null
var _pool = null
var _opaque_batch = null
var _alpha_batch = null
var _add_batch = null

func init_game(rt: Node3D, _data: Dictionary) -> void:
\t# 1. Verify initial bootstrap lighting + fog + 2 point lights, then update to 4 point lights and back to 2 + toggle fog
\tvar env: Environment = rt.world_env.environment
\tvar init_fog_ok: bool = env.fog_enabled and absf(env.fog_depth_begin - 14.0) < 0.05 and absf(env.fog_depth_end - 56.0) < 0.05
\tvar init_pts := _count_visible_lights(rt)

\trt.set_lighting({
\t\t"direction": [-0.6, 0.7, 0.3],
\t\t"ambient": 0.32,
\t\t"color": [0.82, 0.9, 1.0],
\t\t"fogColor": [0.35, 0.45, 0.55],
\t\t"fogNear": 10.0,
\t\t"fogFar": 42.0,
\t\t"points": [
\t\t\t{ "position": [1, 2, 0], "color": [1, 0.6, 0.2], "radius": 9.0, "intensity": 2.0 },
\t\t\t{ "position": [-1, 2, 0], "color": [0.2, 0.9, 1], "radius": 7.0, "intensity": 1.5 },
\t\t\t{ "position": [0, 3, 2], "color": [0.9, 0.4, 0.9], "radius": 5.0, "intensity": 1.1 },
\t\t\t{ "position": [0, 3, -2], "color": [0.8, 1, 0.5], "radius": 6.0, "intensity": 1.3 },
\t\t\t{ "position": [9, 9, 9], "color": [1, 1, 1], "radius": 4.0, "intensity": 1.0 }
\t\t]
\t})
\tvar four_pts := _count_visible_lights(rt)
\tvar fog_updated := env.fog_enabled and absf(env.fog_depth_begin - 10.0) < 0.05 and absf(env.fog_depth_end - 42.0) < 0.05
\tvar color_updated := absf(rt.directional_light.light_color.r - 0.82) < 0.02 and absf(env.ambient_light_energy - 0.32) < 0.02

\trt.set_lighting({ "fogNear": 0.0, "fogFar": 0.0, "points": [{ "position": [0, 1, 0], "color": "#ffdd88", "radius": 5.0, "intensity": 1.0 }] })
\tvar fog_disabled := not env.fog_enabled
\tvar reduced_pts := _count_visible_lights(rt)

\t_results["lighting_ok"] = init_fog_ok and init_pts == 2 and four_pts == 4 and fog_updated and color_updated and fog_disabled and reduced_pts == 1

\t# 2. Instanced MultiMeshInstance3D batches (opaque, alpha, additive) + capacity growth + MeshInstance3D pool
\t_opaque_batch = rt.create_batch("octahedron", "opaque", 4, false)
\t_alpha_batch = rt.create_batch("box", "alpha", 4, false)
\t_add_batch = rt.create_batch("sphere", "additive", 4, true)
\tfor i in range(6):
\t\t_opaque_batch.add(Vector3(float(i), 0.5, 0.0), Vector3(0.4, 0.4, 0.4), float(i) * 0.5, Color(0.8, 0.5, 0.3, 1.0))
\t_alpha_batch.add(Vector3(0.0, 1.0, 0.0), Vector3(1.0, 1.0, 1.0), 0.0, Color(0.4, 0.8, 0.9, 0.45))
\t_add_batch.add(Vector3(0.0, 2.0, 0.0), Vector3(0.8, 0.8, 0.8), 0.0, Color(1.0, 0.9, 0.5, 0.35))
\tvar batches_ok: bool = (
\t\t_opaque_batch.get_count() == 6
\t\tand _opaque_batch.capacity >= 6
\t\tand _opaque_batch.material.transparency == BaseMaterial3D.TRANSPARENCY_DISABLED
\t\tand _alpha_batch.get_count() == 1
\t\tand _alpha_batch.material.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA
\t\tand _alpha_batch.material.blend_mode == BaseMaterial3D.BLEND_MODE_MIX
\t\tand _add_batch.get_count() == 1
\t\tand _add_batch.material.blend_mode == BaseMaterial3D.BLEND_MODE_ADD
\t\tand _add_batch.material.shading_mode == BaseMaterial3D.SHADING_MODE_UNSHADED
\t)
\t_opaque_batch.clear()
\tbatches_ok = batches_ok and _opaque_batch.get_count() == 0 and _opaque_batch.multimesh.visible_instance_count == 0

\t_pool = rt.create_mesh_pool("box", "alpha", 0.4)
\t_pool.begin_frame()
\t_pool.acquire(Vector3(0, 0, 0), Vector3.ONE, 0.0, Color(1, 1, 1, 0.5))
\t_pool.acquire(Vector3(1, 0, 0), Vector3.ONE, 0.0, Color(1, 0.8, 0.4, 0.5))
\t_pool.acquire(Vector3(2, 0, 0), Vector3.ONE, 0.0, Color(0.4, 0.9, 1, 0.5))
\t_pool.end_frame()
\tvar pool_ok: bool = _pool.get_active_count() == 3 and _pool.get_pool_size() == 3
\t_pool.begin_frame()
\t_pool.acquire(Vector3(0, 0, 0), Vector3.ONE, 0.0, Color(1, 1, 1, 0.5))
\t_pool.end_frame()
\tpool_ok = pool_ok and _pool.get_active_count() == 1 and not _pool.pool[1].visible and not _pool.pool[2].visible
\t_results["batches_ok"] = batches_ok and pool_ok

\t# 3. Hierarchical Rig & JointPose transforms
\t_rig = rt.create_rig([
\t\t{ "id": "hips", "pivot": [0.0, 1.0, 0.0], "parts": [{ "mesh": "box", "scale": [0.5, 0.5, 0.5], "color": "#ebb336" }] },
\t\t{ "id": "arm", "parent": "hips", "pivot": [0.0, 1.0, 0.0], "parts": [{ "mesh": "cylinder", "position": [0.0, 0.5, 0.0], "scale": [0.2, 1.0, 0.2], "color": "#2c94ad" }] },
\t\t{ "id": "hand", "parent": "arm", "pivot": [0.0, 1.0, 0.0], "parts": [{ "mesh": "octahedron", "scale": [0.25, 0.25, 0.25], "color": "#ffe79c", "unlit": 0.95 }] }
\t])
\tvar world_xf: Dictionary = _rig.apply_poses(
\t\t{
\t\t\t"hips": { "position": [0.0, 0.5, 0.0], "rotation": [0.0, PI * 0.5, 0.0] },
\t\t\t"arm": { "rotation": [PI * 0.5, 0.0, 0.0] }
\t\t},
\t\t{ "position": [10.0, 0.0, 0.0], "scale": 1.0 }
\t)
\t# hips world = (10, 1.5, 0), yaw +90 deg; arm pivot=(0,1,0) -> (10, 2.5, 0), pitched +90 deg around local X -> local +Y maps to local +Z, rotated by yaw +90 deg -> +X!
\t# So hand at arm pivot + (0, 1, 0) lands at (11.0, 2.5, 0.0)!
\tvar hand_pos: Vector3 = _rig.get_joint_world_position("hand")
\t_results["rig_ok"] = (
\t\tworld_xf.has("hand")
\t\tand _rig.get_joint("hand").get_parent() == _rig.get_joint("arm")
\t\tand _rig.get_joint("arm").get_parent() == _rig.get_joint("hips")
\t\tand hand_pos.distance_to(Vector3(11.0, 2.5, 0.0)) < 0.02
\t)

\t# 4. Pooled 3D Particles (velocity + gravity + drag + alphaFade + additive + parabolic arc)
\t_particles = rt.create_particles(32)
\t_particles.spawn({
\t\t"mesh": "octahedron",
\t\t"blend": "alpha",
\t\t"alphaFade": true,
\t\t"position": [0.0, 1.0, 0.0],
\t\t"velocity": [2.0, 4.0, 0.0],
\t\t"gravity": 5.0,
\t\t"drag": 0.5,
\t\t"scale": [0.2, 0.2, 0.2],
\t\t"endScale": 0.05,
\t\t"color": [0.8, 0.9, 1.0, 0.8],
\t\t"life": 0.5
\t})
\t_particles.spawn({
\t\t"mesh": "sphere",
\t\t"blend": "additive",
\t\t"position": [0.0, 0.5, 0.0],
\t\t"velocity": [0.0, 1.0, 0.0],
\t\t"scale": 0.3,
\t\t"color": "#ffdd88",
\t\t"unlit": 1.0,
\t\t"life": 0.4
\t})
\t_particles.arc({
\t\t"mesh": "box",
\t\t"from": [0.0, 0.0, 0.0],
\t\t"to": [4.0, 0.0, 0.0],
\t\t"peak": 2.0,
\t\t"scale": [0.25, 0.25, 0.25],
\t\t"color": "#ffd966",
\t\t"duration": 0.4
\t})
\t_particles.step(0.2)
\tvar mid_count: int = _particles.get_count()
\tvar arc_pos: Vector3 = _particles.particles[2]["pos"] as Vector3
\tvar arc_mid_ok: bool = absf(arc_pos.x - 2.0) < 0.02 and absf(arc_pos.y - 2.0) < 0.02
\t_particles.step(0.4)
\tvar end_count: int = _particles.get_count()
\t_results["particles_ok"] = mid_count == 3 and arc_mid_ok and end_count == 0

\t# 5. Multi-bus AudioServer mixer (Master, Music, SFX, Ambience) + WAV SFX + ambient beds
\tvar buses_ok: bool = (
\t\tAudioServer.get_bus_index("Master") >= 0
\t\tand AudioServer.get_bus_index("Music") >= 0
\t\tand AudioServer.get_bus_index("SFX") >= 0
\t\tand AudioServer.get_bus_index("Ambience") >= 0
\t)
\tvar played: bool = rt.play_sfx("chime", 0.75, 1.25)
\trt.set_music_filter(950.0)
\trt.set_music_volume(0.22)
\trt.set_ambience_filter(1450.0)
\trt.set_ambient_bed("ocean", { "gain": 0.14, "frequency": 340.0 })
\tvar ocean_bed: Dictionary = rt.get_ambient_bed("ocean")
\tvar bed_ok: bool = not ocean_bed.is_empty() and absf(float(ocean_bed.get("gain", 0.0)) - 0.14) < 0.001 and absf(float(ocean_bed.get("frequency", 0.0)) - 340.0) < 0.1
\trt.set_muted(true)
\tvar muted_ok: bool = rt.is_muted() and AudioServer.is_bus_mute(AudioServer.get_bus_index("Master"))
\trt.set_muted(false)
\tvar unmuted_ok: bool = not rt.is_muted() and not AudioServer.is_bus_mute(AudioServer.get_bus_index("Master"))
\t_results["audio_ok"] = buses_ok and played and bed_ok and muted_ok and unmuted_ok

func step_game(delta: float, _inp: Dictionary, rt: Node3D) -> void:
\t_frame += 1
\tif _particles != null:
\t\t_particles.step(delta)
\tif not _reported and _frame >= 2:
\t\t_reported = true
\t\t_results["ui_ok"] = rt.ui != null and rt.ui.items.size() >= 3
\t\tprint("RIDGETOP_RUNTIME_PROBE_OK:" + JSON.stringify(_results))

func build_ui(vp: Vector2, _rt: Node3D) -> Array:
\treturn [
\t\t{ "type": "panel", "rect": Rect2(16, 16, 260, 72) },
\t\t{ "type": "text", "rect": Rect2(28, 28, 236, 24), "text": "RUNTIME PROBE", "size": 18 },
\t\t{ "type": "button", "id": "test-sfx", "rect": Rect2(vp.x - 140, 16, 120, 40), "label": "Chime", "primary": true }
\t]

func _count_visible_lights(rt: Node3D) -> int:
\tvar n := 0
\tfor pl in rt.point_lights:
\t\tif pl.visible:
\t\t\tn += 1
\treturn n
`)

  const res = spawnSync(godot, ['--headless', '--path', outDir, '--quit-after', '5'], { encoding: 'utf8' })
  assert.equal(res.status, 0, `Godot exited with status ${res.status}:\nSTDOUT:\n${res.stdout}\nSTDERR:\n${res.stderr}`)
  assert.equal(res.stderr.trim(), '', `Godot emitted stderr warnings/errors:\n${res.stderr}`)

  const marker = res.stdout.split('\n').find(line => line.includes('RIDGETOP_RUNTIME_PROBE_OK:'))
  assert.ok(marker, `Expected RIDGETOP_RUNTIME_PROBE_OK line in Godot stdout, got:\n${res.stdout}`)
  const payload = JSON.parse(marker.slice(marker.indexOf('RIDGETOP_RUNTIME_PROBE_OK:') + 'RIDGETOP_RUNTIME_PROBE_OK:'.length))
  assert.deepEqual(payload, {
    lighting_ok: true,
    batches_ok: true,
    rig_ok: true,
    particles_ok: true,
    audio_ok: true,
    ui_ok: true
  })
})

test('live Godot 4 headless boots a zero-entry custom generic game cleanly with zero stderr', async t => {
  const godot = await findGodot()
  if (!godot) {
    t.skip('Godot 4 binary not found in PATH or ~/Applications')
    return
  }

  const outDir = await mkdtemp(join(tmpdir(), 'ridgetop-godot-rt-generic-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))

  const { models, audio, iconPng } = makeTestAssets()
  await exportGodotProject({
    outDir,
    name: 'Cobalt Outpost',
    slug: 'cobalt-outpost',
    models,
    audio,
    gameData: {
      game: 'cobalt-outpost',
      clear: [0.09, 0.14, 0.2],
      lighting: {
        direction: [-0.5, 0.8, 0.3],
        ambient: 0.48,
        fogColor: [0.18, 0.25, 0.34],
        fogNear: 10,
        fogFar: 45,
        points: [{ position: [0, 1.8, 0], color: [0.4, 0.95, 0.85], radius: 7, intensity: 1.5 }]
      },
      palette: { accent: '#62d4ef', glow: '#84f2d8' }
    },
    iconPng
  })

  const res = spawnSync(godot, ['--headless', '--path', outDir, '--quit-after', '5'], { encoding: 'utf8' })
  assert.equal(res.status, 0, `Generic game exited with status ${res.status}:\n${res.stderr}`)
  assert.equal(res.stderr.trim(), '', `Generic game emitted stderr:\n${res.stderr}`)
})
