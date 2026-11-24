import assert from 'node:assert/strict'
import test from 'node:test'
import { instances, box, quaternionFromEuler, rotateVec3, STEP } from '../packages/ridgetop/framework/index.ts'
import { createRace, recover, rivalInput, standings, stepRace } from '../examples/signal-drift/racing/race.ts'
import { circuits, route, roadMesh, trackWidth } from '../examples/signal-drift/racing/track.ts'
import type { Championship } from '../examples/signal-drift/racing/progression.ts'
import { buyUpgrade, championshipBackup, leadingEvent, loadChampionship, readChampionshipBackup,
  recordResult, saveChampionship, unlocked } from '../examples/signal-drift/racing/progression.ts'

test('portable backups round-trip existing garage saves and reject damaged or incompatible files', () => {
  const legacy = { credits: 134, build: { motor: 1, tires: 2, armor: 0, capacitor: 0 },
    records: { copper: { place: 2, seconds: 49.4 } } }
  const progress = loadChampionship({ getItem: () => JSON.stringify(legacy) })
  const text = championshipBackup(progress)
  assert.deepEqual(readChampionshipBackup(text), legacy)
  assert.throws(() => readChampionshipBackup(text.replace('"version": 1', '"version": 2')), /version/)
  assert.throws(() => readChampionshipBackup(text.replace('signal-drift', 'another-game')), /Signal Drift/)
  const invalidPatches: Partial<Championship>[] = [
    { credits: -10 },
    { build: { ...legacy.build, motor: 8 } },
    { records: { copper: { place: 0, seconds: 12 } } },
    { records: { unknown: legacy.records.copper } }
  ]
  for (const patch of invalidPatches) {
    assert.throws(() => readChampionshipBackup(championshipBackup({ ...progress, ...patch })), /invalid/)
  }
  assert.throws(() => readChampionshipBackup('{'), /JSON/)
  assert.equal(saveChampionship(undefined, progress), false)
  assert.equal(saveChampionship({ setItem() { throw new Error('Storage full') } }, progress), false)
  assert.deepEqual(progress, legacy)
})

test('full-axis rotations preserve length and pack a unit quaternion into the batch', () => {
  const rotation = quaternionFromEuler(Math.PI / 2, 0, 0)
  const [x, y, z] = rotateVec3(rotation, [0, 1, 0])
  assert.ok(Math.abs(x) + Math.abs(y) + Math.abs(z - 1) < 1e-10)
  const batch = instances(box)
  batch.add([0, 0, 0], [1, 1, 1], [rotation[0] * 2, 0, 0, rotation[3] * 2])
  assert.ok(Math.abs(Math.hypot(...batch.data.subarray(12, 16)) - 1) < 1e-6)
  batch.clear()
  batch.add([0, 0, 0], [1, 1, 1], Math.PI / 2)
  const q = Array.from(batch.data.subarray(12, 16)) as [number, number, number, number]
  const forward = rotateVec3(q, [0, 0, 1])
  assert.ok(Math.abs(forward[0] - 1) + Math.abs(forward[2]) < 1e-6)
})

test('all four championship circuits can be qualified for in order and have upward-facing roads', () => {
  const progress = loadChampionship()
  assert.equal(unlocked(progress, 1), false)
  assert.equal(buyUpgrade(progress, 'motor'), true)
  assert.equal(buyUpgrade(progress, 'armor'), false)
  for (const [index, circuit] of circuits.entries()) {
    assert.equal(leadingEvent(progress), index)
    assert.ok(roadMesh(circuit.width, .045, 0, circuit.route).data[4] > .99)
    const race = createRace(circuit, progress.build)
    const player = race.drivers[0]
    for (let tick = 0; tick < 60 * 100 && player.finish === null; tick++) {
      const input = rivalInput(player, circuit)
      stepRace(race, {
        throttle: input.throttle > .09 ? 1 : input.throttle < -.32 ? -1 : 0,
        steer: Math.abs(input.steer) > .23 ? Math.sign(input.steer) : 0,
        drift: input.drift
      }, STEP)
    }
    assert.equal(player.lap, circuit.laps, circuit.name)
    assert.ok(player.finish !== null && player.finish > 0, circuit.name)
    const place = standings(race).indexOf(player) + 1
    assert.ok(place <= circuit.qualify, circuit.name)
    const before = progress.credits
    const payout = recordResult(progress, circuit, place, player.finish)
    assert.equal(progress.credits, before + payout)
    if (index === 0) assert.equal(buyUpgrade(progress, 'armor'), true)
  }
  assert.equal(leadingEvent(progress), -1)
  assert.equal(progress.records.night.place, 1)
  let saved: string
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value } }
  saveChampionship(storage, progress)
  assert.deepEqual(loadChampionship(storage), progress)
})

test('crossing the finish without the previous checkpoints earns no lap', () => {
  const race = createRace()
  const player = race.drivers[0]
  const start = route.sample(.998)
  Object.assign(player, { ...start, progress: .998, vx: Math.sin(start.yaw) * 20, vz: Math.cos(start.yaw) * 20 })
  for (let tick = 0; tick < 8; tick++) stepRace(race, { throttle: 1, steer: 0, drift: false }, STEP)
  assert.ok(player.progress < .1)
  assert.equal(player.lap, 0)
  assert.equal(player.gate, 1)
  recover(player)
  assert.ok(player.progress < .1)
  assert.equal(player.vx, 0)
})

test('a nonqualifying finish pays credits and a later podium unlocks the next event', () => {
  const progress = loadChampionship()
  assert.equal(recordResult(progress, circuits[0], 4, 33), 95)
  assert.equal(unlocked(progress, 1), false)
  recordResult(progress, circuits[0], 3, 38)
  assert.equal(unlocked(progress, 1), true)
  recordResult(progress, circuits[0], 4, 29)
  assert.deepEqual(progress.records.copper, { place: 3, seconds: 38 })
})

test('pulse, snare, supply and shield rules use finite charges and respawn after knockout', () => {
  const progress = loadChampionship()
  progress.build.armor = 1
  progress.build.capacitor = 1
  const race = createRace(circuits[0], progress.build)
  const [player, rival, ...others] = race.drivers
  for (const driver of others) driver.finish = 1
  const idle = { throttle: 0, steer: 0, drift: false }
  const start = route.sample(.05)
  Object.assign(player, start, { vx: 0, vz: 0, progress: .05 })
  Object.assign(rival, { x: start.x + Math.sin(start.yaw) * 5, z: start.z + Math.cos(start.yaw) * 5,
    vx: 0, vz: 0, guard: 0, shield: 27, disabled: 0 })
  const pulse = { ...idle, pulse: true }
  for (let i = 0; i < 14; i++) stepRace(race, pulse, STEP)
  assert.equal(player.pulses, 4)
  assert.ok(rival.disabled > 0)
  assert.equal(rival.shield, 0)
  assert.equal(player.shield, 120)
  for (let i = 0; i < 130; i++) stepRace(race, idle, STEP)
  assert.equal(rival.disabled, 0)
  assert.equal(rival.shield, 65)
  assert.equal(rival.gate, 1)

  rival.finish = 1
  stepRace(race, { ...idle, snare: true }, STEP)
  assert.equal(player.snares, 1)
  assert.ok(race.weapons.some(weapon => weapon.kind === 'snare' && weapon.owner === 0))
  const supply = race.supplies[0]
  Object.assign(player, { x: supply.x, z: supply.z, shield: 86 })
  stepRace(race, idle, STEP)
  assert.equal(player.shield, 109)
  assert.equal(player.pulses, 5)
  assert.equal(player.snares, 2)
  assert.ok(supply.cooldown > 0)
})

test('checkpoints tolerate curb/apex shoulder margin, exact boundary crossings, and lap >= 3 standings wrap-around', () => {
  const circuit = circuits[0]
  const race = createRace(circuit)
  const player = race.drivers[0]
  // Crossing gate 1 (0.25) slightly past road edge (distance ~5.2 vs width*0.5 = 4.5, within width*0.85 = 7.65)
  const before = circuit.route.sample(.248)
  const nx = Math.cos(before.yaw), nz = -Math.sin(before.yaw)
  Object.assign(player, {
    x: before.x + nx * 5.2, z: before.z + nz * 5.2, yaw: before.yaw,
    progress: .248, gate: 1, vx: Math.sin(before.yaw) * 18, vz: Math.cos(before.yaw) * 18
  })
  for (let i = 0; i < 6; i++) stepRace(race, { throttle: 1, steer: 0, drift: false }, STEP)
  assert.equal(player.gate, 2, 'shoulder margin crossing must still advance checkpoint gate')

  // Crossing gate 2 starting from exact boundary progress === 0.50 must still advance gate
  const exact = circuit.route.sample(.5)
  Object.assign(player, {
    x: exact.x, z: exact.z, yaw: exact.yaw,
    progress: .5, gate: 2, vx: Math.sin(exact.yaw) * 18, vz: Math.cos(exact.yaw) * 18
  })
  stepRace(race, { throttle: 1, steer: 0, drift: false }, STEP)
  assert.equal(player.gate, 3, 'exact boundary progress must advance gate')

  // Drifting briefly wider than width*0.85 across a checkpoint and rejoining must not soft-lock the lap
  const wideRace = createRace(circuit)
  const widePlayer = wideRace.drivers[0]
  const preWide = circuit.route.sample(.245)
  Object.assign(widePlayer, { x: preWide.x, z: preWide.z, yaw: preWide.yaw, progress: .245, gate: 1, vx: 0, vz: 0 })
  const pastWide = circuit.route.sample(.255)
  const pnx = Math.cos(pastWide.yaw), pnz = -Math.sin(pastWide.yaw)
  // Step once while outside width*0.85 (~8.5m > 7.65m), then rejoin road at .260
  Object.assign(widePlayer, { x: pastWide.x + pnx * 8.5, z: pastWide.z + pnz * 8.5, yaw: pastWide.yaw, vx: 0, vz: 0 })
  stepRace(wideRace, { throttle: 0, steer: 0, drift: false }, STEP)
  assert.equal(widePlayer.gate, 1)
  const rejoin = circuit.route.sample(.26)
  Object.assign(widePlayer, { x: rejoin.x, z: rejoin.z, yaw: rejoin.yaw, vx: 0, vz: 0 })
  stepRace(wideRace, { throttle: 0, steer: 0, drift: false }, STEP)
  assert.equal(widePlayer.gate, 2, 'rejoining road after brief wide drift across checkpoint must advance gate')

  // Standings on lap 2+ gate 4 across wrap-around: driver at progress 0.05 must rank ahead of progress 0.90
  const [a, b] = race.drivers
  Object.assign(a, { lap: 2, gate: 4, progress: .05, finish: null })
  Object.assign(b, { lap: 2, gate: 4, progress: .90, finish: null })
  const order = standings(race)
  assert.ok(order.indexOf(a) < order.indexOf(b), 'lap 3 wrap-around driver must stay ahead in standings')
})
