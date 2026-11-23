import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createArcadeDriver, createCircuit, STEP } from '../framework/index.ts'
import { boxNode, buttonPrimitive, column, overlay, resolveLayout, row, spacerNode, togglePrimitive } from '../framework/ui.ts'
import { ROUTE } from '../game/campaign.ts'
import { courses } from '../game/level.ts'
import { createPlayer, stepPlayer } from '../game/simulation.ts'
import { createRace, standings, stepRace } from '../racing/race.ts'
import { circuits } from '../racing/track.ts'
import { courseRoute } from '../tools/course-route.ts'
import { compileTsProjectToGodot } from '../tools/ts-to-gd.ts'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../', import.meta.url))

async function findGodot(): Promise<string | null> {
  const candidates = [
    process.env.RIDGETOP_GODOT,
    '/home/jenaro/Applications/Godot_v4.7.2-stable_linux.x86_64',
    'godot',
    'godot4'
  ].filter(Boolean) as string[]
  for (const bin of candidates) {
    try {
      if (bin.startsWith('/')) await access(bin)
      await execFileAsync(bin, ['--version'], { timeout: 5000 })
      return bin
    } catch {}
  }
  return null
}

async function runGodotHarness(godot: string, projectDir: string, scriptSource: string) {
  await writeFile(join(projectDir, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="RidgetopParity"\n')
  await writeFile(join(projectDir, 'verify.gd'), scriptSource)
  const { stdout, stderr } = await execFileAsync(
    godot,
    ['--headless', '--quit', '--path', projectDir, '--script', 'res://verify.gd'],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
  )
  const line = stdout.split('\n').find(l => l.startsWith('PARITY_JSON:'))
  assert.ok(line, `Godot harness failed to emit PARITY_JSON.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)
  return JSON.parse(line.slice('PARITY_JSON:'.length))
}

test('TS -> GDScript compiler compiles real Beacon Run simulation and matches Node across all 6 course replays in Godot 4', async t => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ridgetop-gd-beacon-'))
  t.after(() => rm(projectDir, { recursive: true, force: true }))

  const compiled = await compileTsProjectToGodot({
    entries: [join(repoRoot, 'game', 'simulation.ts')],
    rootDir: repoRoot,
    outDir: join(projectDir, 'scripts', 'compiled')
  })
  assert.ok(compiled.files.some(f => f.endsWith('framework/platformer.gd')))
  assert.ok(compiled.files.some(f => f.endsWith('game/level.gd')))
  assert.ok(compiled.files.some(f => f.endsWith('game/simulation.gd')))

  const godot = await findGodot()
  if (!godot) return

  // Build reference Node traces & expected final states for all 6 courses!
  const traces: Record<string, { actions: readonly { left: boolean; right: boolean; jump: number; frames: number }[] }> = {}
  const expected: Record<string, Record<string, unknown>> = {}
  for (const id of ROUTE) {
    const course = courses[id]
    const { actions } = courseRoute(course, { collectSignal: true })
    traces[id] = { actions }
    const player = createPlayer('solo', 0, course)
    for (const action of actions) {
      for (let f = 0; f < action.frames; f++) stepPlayer(player, action, STEP, course)
    }
    expected[id] = {
      finished: player.finished,
      crystals: player.crystals,
      signal: player.signal,
      falls: player.falls,
      checkpoint: player.checkpoint,
      ticks: player.ticks,
      x: player.x,
      y: player.y
    }
  }
  await writeFile(join(projectDir, 'traces.json'), JSON.stringify(traces))

  const gdResults = await runGodotHarness(godot, projectDir, `extends SceneTree
const RT = preload("res://scripts/compiled/rt.gd")
func _init() -> void:
\tvar sim = RT.mod("res://scripts/compiled/game/simulation.gd")
\tvar lvl = RT.mod("res://scripts/compiled/game/level.gd")
\tvar traces: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://traces.json"))
\tvar out: Dictionary = {}
\tfor id in traces.keys():
\t\tvar course = lvl.courses[id]
\t\tvar player = sim.createPlayer("solo", 0, course)
\t\tfor action in traces[id]["actions"]:
\t\t\tfor f in range(int(action["frames"])):
\t\t\t\tsim.stepPlayer(player, action, 1.0 / 60.0, course)
\t\tout[id] = {
\t\t\t"finished": player["finished"],
\t\t\t"crystals": int(player["crystals"]),
\t\t\t"signal": player["signal"],
\t\t\t"falls": int(player["falls"]),
\t\t\t"checkpoint": player["checkpoint"],
\t\t\t"ticks": int(player["ticks"]),
\t\t\t"x": float(player["x"]),
\t\t\t"y": float(player["y"])
\t\t}
\tprint("PARITY_JSON:" + JSON.stringify(out))
\tRT.clear_modules()
\tquit()
`)

  for (const id of ROUTE) {
    const exp = expected[id]
    const got = gdResults[id]
    assert.equal(got.finished, exp.finished, `${id} finished`)
    assert.equal(got.crystals, exp.crystals, `${id} crystals`)
    assert.equal(got.signal, exp.signal, `${id} signal`)
    assert.equal(got.falls, exp.falls, `${id} falls`)
    assert.equal(got.checkpoint, exp.checkpoint, `${id} checkpoint`)
    assert.equal(got.ticks, exp.ticks, `${id} ticks`)
    assert.ok(Math.abs(got.x - Number(exp.x)) < 0.01, `${id} x parity (${got.x} vs ${exp.x})`)
    assert.ok(Math.abs(got.y - Number(exp.y)) < 0.01, `${id} y parity (${got.y} vs ${exp.y})`)
  }
})

test('TS -> GDScript compiler compiles real Signal Drift vehicle + circuit math and matches Node in Godot 4', async t => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ridgetop-gd-vehicle-'))
  t.after(() => rm(projectDir, { recursive: true, force: true }))

  await compileTsProjectToGodot({
    entries: [join(repoRoot, 'framework', 'vehicle.ts')],
    rootDir: repoRoot,
    outDir: join(projectDir, 'scripts', 'compiled')
  })

  const godot = await findGodot()
  if (!godot) return

  const drive = createArcadeDriver({ acceleration: 22, maxSpeed: 26, turnRate: 2.6, grip: 6.4 })
  const body = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0 }
  for (let i = 0; i < 180; i++) {
    drive(body, { throttle: i < 140 ? 1 : -0.4, steer: i > 40 && i < 120 ? 0.8 : -0.3, drift: i > 60 && i < 100 }, STEP, i > 100 ? 0.7 : 1)
  }
  const circuit = createCircuit([[-10, -10], [10, -10], [10, 10], [-10, 10]], 6)
  const sample = circuit.sample(0.37)
  const near = circuit.nearest(4.2, -7.5)

  const gd = await runGodotHarness(godot, projectDir, `extends SceneTree
const RT = preload("res://scripts/compiled/rt.gd")
func _init() -> void:
\tvar veh = RT.mod("res://scripts/compiled/framework/vehicle.gd")
\tvar drive: Callable = veh.createArcadeDriver({ "acceleration": 22.0, "maxSpeed": 26.0, "turnRate": 2.6, "grip": 6.4 })
\tvar body := { "x": 0.0, "z": 0.0, "yaw": 0.0, "vx": 0.0, "vz": 0.0 }
\tfor i in range(180):
\t\tdrive.call(body, { "throttle": 1.0 if i < 140 else -0.4, "steer": 0.8 if (i > 40 and i < 120) else -0.3, "drift": i > 60 and i < 100 }, 1.0 / 60.0, 0.7 if i > 100 else 1.0)
\tvar circuit = veh.createCircuit([[-10.0, -10.0], [10.0, -10.0], [10.0, 10.0], [-10.0, 10.0]], 6)
\tvar sample = circuit["sample"].call(0.37)
\tvar near = circuit["nearest"].call(4.2, -7.5)
\tprint("PARITY_JSON:" + JSON.stringify({ "body": body, "sample": sample, "near": near }))
\tRT.clear_modules()
\tquit()
`)

  for (const key of ['x', 'z', 'yaw', 'vx', 'vz'] as const) {
    assert.ok(Math.abs(gd.body[key] - body[key]) < 0.005, `vehicle.${key}: ${gd.body[key]} vs ${body[key]}`)
  }
  assert.ok(Math.abs(gd.sample.x - sample.x) < 0.001)
  assert.ok(Math.abs(gd.sample.z - sample.z) < 0.001)
  assert.ok(Math.abs(gd.near.distance - near.distance) < 0.001)
  assert.ok(Math.abs(gd.near.progress - near.progress) < 0.001)
})

test('TS -> GDScript compiler compiles Ridgetop UI state machines & layout solver and matches Node in Godot 4', async t => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ridgetop-gd-ui-'))
  t.after(() => rm(projectDir, { recursive: true, force: true }))

  await compileTsProjectToGodot({
    entries: [
      join(repoRoot, 'framework', 'ui-layout.ts'),
      join(repoRoot, 'framework', 'ui-button.ts'),
      join(repoRoot, 'framework', 'ui-toggle.ts')
    ],
    rootDir: repoRoot,
    outDir: join(projectDir, 'scripts', 'compiled')
  })

  const godot = await findGodot()
  if (!godot) return

  const tree = overlay({ id: 'root', style: { anchor: 'fill' } }, [
    row({ id: 'bar', style: { anchor: 'top', width: 400, height: 50, inset: 10, gap: 10, padding: 5, respectSafeArea: true } }, [
      boxNode({ id: 'left', style: { width: 80, height: 40 } }),
      spacerNode(1),
      boxNode({ id: 'right', style: { width: 100, height: 40 } })
    ]),
    column({ id: 'modal', style: { anchor: 'center', width: 200, padding: 12, gap: 8 } }, [
      boxNode({ id: 'btn-a', style: { height: 40 } }),
      boxNode({ id: 'btn-b', style: { height: 40 } })
    ])
  ])
  const expectedRects = Object.fromEntries(resolveLayout(tree, { width: 800, height: 600 }, { top: 20, right: 16, bottom: 24, left: 16 }))

  const gd = await runGodotHarness(godot, projectDir, `extends SceneTree
const RT = preload("res://scripts/compiled/rt.gd")
func _init() -> void:
\tvar lay = RT.mod("res://scripts/compiled/framework/ui-layout.gd")
\tvar btn_mod = RT.mod("res://scripts/compiled/framework/ui-button.gd")
\tvar tog_mod = RT.mod("res://scripts/compiled/framework/ui-toggle.gd")
\tvar presses := [0]
\tvar btn = btn_mod.buttonPrimitive["create"].call({ "id": "play", "label": "Play", "onPress": func(): presses[0] += 1 })
\tbtn["api"]["setDisabled"].call(true)
\tvar blocked: bool = btn["act"].call("press")
\tbtn["api"]["setDisabled"].call(false)
\tvar allowed: bool = btn["act"].call("press")
\tvar tog = tog_mod.togglePrimitive["create"].call({ "id": "snd", "label": "Sound", "checked": true })
\ttog["act"].call("toggle")
\tvar tree = lay.overlay({ "id": "root", "style": { "anchor": "fill" } }, [
\t\tlay.row({ "id": "bar", "style": { "anchor": "top", "width": 400, "height": 50, "inset": 10, "gap": 10, "padding": 5, "respectSafeArea": true } }, [
\t\t\tlay.boxNode({ "id": "left", "style": { "width": 80, "height": 40 } }),
\t\t\tlay.spacerNode(1),
\t\t\tlay.boxNode({ "id": "right", "style": { "width": 100, "height": 40 } })
\t\t]),
\t\tlay.column({ "id": "modal", "style": { "anchor": "center", "width": 200, "padding": 12, "gap": 8 } }, [
\t\t\tlay.boxNode({ "id": "btn-a", "style": { "height": 40 } }),
\t\t\tlay.boxNode({ "id": "btn-b", "style": { "height": 40 } })
\t\t])
\t])
\tvar rects = lay.resolveLayout(tree, { "width": 800, "height": 600 }, { "top": 20, "right": 16, "bottom": 24, "left": 16 })
\tprint("PARITY_JSON:" + JSON.stringify({
\t\t"presses": presses[0], "blocked": blocked, "allowed": allowed,
\t\t"toggleChecked": tog["api"]["checked"].call(),
\t\t"rects": rects["__store"]
\t}))
\tRT.clear_modules()
\tquit()
`)

  assert.equal(gd.presses, 1)
  assert.equal(gd.blocked, false)
  assert.equal(gd.allowed, true)
  assert.equal(gd.toggleChecked, false)
  for (const id of ['bar', 'left', 'right', 'modal', 'btn-a', 'btn-b']) {
    assert.deepEqual(gd.rects[id], expectedRects[id], `layout rect parity for ${id}`)
  }
})

test('TS -> GDScript compiler compiles the full Signal Drift race engine (racing/race.ts) and matches Node in Godot 4', async t => {
  const projectDir = await mkdtemp(join(tmpdir(), 'ridgetop-gd-race-'))
  t.after(() => rm(projectDir, { recursive: true, force: true }))

  const compiled = await compileTsProjectToGodot({
    entries: [join(repoRoot, 'racing', 'race.ts')],
    rootDir: repoRoot,
    outDir: join(projectDir, 'scripts', 'compiled')
  })
  assert.ok(compiled.files.some(f => f.endsWith('racing/race.gd')))
  assert.ok(compiled.files.some(f => f.endsWith('racing/track.gd')))
  assert.ok(compiled.files.some(f => f.endsWith('racing/progression.gd')))
  assert.ok(compiled.files.some(f => f.endsWith('framework/vehicle.gd')))

  const godot = await findGodot()
  if (!godot) return

  const race = createRace(circuits[0])
  for (let i = 0; i < 300; i++) {
    stepRace(race, {
      throttle: 1,
      steer: Math.sin(i * 0.04) * 0.65,
      drift: i > 80 && i < 140,
      pulse: i === 60 || i === 180,
      snare: i === 120
    }, STEP)
  }
  const order = standings(race).map(d => d.name)

  const gd = await runGodotHarness(godot, projectDir, `extends SceneTree
const RT = preload("res://scripts/compiled/rt.gd")
func _init() -> void:
\tvar race_mod = RT.mod("res://scripts/compiled/racing/race.gd")
\tvar track_mod = RT.mod("res://scripts/compiled/racing/track.gd")
\tvar race = race_mod.createRace(track_mod.circuits[0])
\tfor i in range(300):
\t\trace_mod.stepRace(race, {
\t\t\t"throttle": 1.0,
\t\t\t"steer": sin(float(i) * 0.04) * 0.65,
\t\t\t"drift": i > 80 and i < 140,
\t\t\t"pulse": i == 60 or i == 180,
\t\t\t"snare": i == 120
\t\t}, 1.0 / 60.0)
\tvar ord: Array = []
\tfor d in race_mod.standings(race):
\t\tord.append(d["name"])
\tvar drivers_out: Array = []
\tfor d in race["drivers"]:
\t\tdrivers_out.append({
\t\t\t"name": d["name"], "x": d["x"], "z": d["z"], "yaw": d["yaw"],
\t\t\t"lap": d["lap"], "gate": d["gate"], "shield": d["shield"],
\t\t\t"pulses": d["pulses"], "snares": d["snares"]
\t\t})
\tprint("PARITY_JSON:" + JSON.stringify({ "order": ord, "drivers": drivers_out, "elapsed": race["elapsed"] }))
\tRT.clear_modules()
\tquit()
`)

  assert.deepEqual(gd.order, order)
  assert.ok(Math.abs(gd.elapsed - race.elapsed) < 0.001)
  for (let i = 0; i < 4; i++) {
    const exp = race.drivers[i]
    const got = gd.drivers[i]
    assert.equal(got.name, exp.name)
    assert.equal(got.lap, exp.lap, `driver ${exp.name} lap`)
    assert.equal(got.gate, exp.gate, `driver ${exp.name} gate`)
    assert.equal(got.pulses, exp.pulses, `driver ${exp.name} pulses`)
    assert.equal(got.snares, exp.snares, `driver ${exp.name} snares`)
    assert.equal(got.shield, exp.shield, `driver ${exp.name} shield`)
    assert.ok(Math.abs(got.x - exp.x) < 0.02, `driver ${exp.name} x (${got.x} vs ${exp.x})`)
    assert.ok(Math.abs(got.z - exp.z) < 0.02, `driver ${exp.name} z (${got.z} vs ${exp.z})`)
  }
})
