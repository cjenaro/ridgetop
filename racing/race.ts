import { angleDelta, createArcadeDriver } from '../framework/index.ts'
import type { DriveInput, VehicleBody } from '../framework/index.ts'
import { circuits, offset } from './track.ts'
import type { Circuit } from './track.ts'
import { stock, vehicleStats } from './progression.ts'
import type { Build } from './progression.ts'

const spacing = .25
const names = ['You', 'Mica', 'Sprocket', 'Vega'] as const
export type RaceInput = DriveInput & { pulse?: boolean; snare?: boolean }
export type Driver = VehicleBody & {
  name: string; slot: number; lap: number; gate: number; progress: number
  offroad: boolean; drift: boolean; steer: number; throttle: number; finish: number | null
  shield: number; maxShield: number; pulses: number; maxPulses: number; snares: number
  pulseCooldown: number; snareCooldown: number; pulseInterval: number; snareInterval: number; offroadGrip: number
  stagger: number; disabled: number; guard: number
  drive: ReturnType<typeof createArcadeDriver>
}
export type Weapon = { kind: 'pulse' | 'snare'; owner: number; x: number; z: number; yaw: number; age: number }
export type Supply = { x: number; z: number; yaw: number; cooldown: number }
export type Hit = { x: number; z: number; age: number }
export interface Race {
  circuit: Circuit
  drivers: Driver[]
  elapsed: number
  weapons: Weapon[]
  supplies: Supply[]
  hits: Hit[]
}

function place(driver: Driver, circuit: Circuit, progress: number, lane: number) {
  const point = circuit.route.sample(progress)
  const [x, z] = offset(point, lane)
  Object.assign(driver, { x, z, yaw: point.yaw, progress, vx: 0, vz: 0 })
}

export function createRace(circuit: Circuit = circuits[0], build: Readonly<Build> = stock): Race {
  const drivers = names.map((name, slot) => {
    const tune = vehicleStats(slot === 0 ? build : stock)
    const { maxShield, maxPulses, pulseInterval, snareInterval, offroadGrip } = tune
    const driver: Driver = {
      name, slot, x: 0, z: 0, vx: 0, vz: 0, yaw: 0, lap: 0, gate: 1, progress: 0,
      offroad: false, drift: false, steer: 0, throttle: 0, finish: null,
      shield: maxShield, maxShield, pulses: maxPulses, maxPulses, snares: 2,
      pulseCooldown: 0, snareCooldown: 0, pulseInterval, snareInterval, offroadGrip,
      stagger: 0, guard: 0, disabled: 0,
      drive: createArcadeDriver(tune)
    }
    const row = slot < 2 ? .013 : .035
    place(driver, circuit, row, slot % 2 === 0 ? -1.85 : 1.85)
    return driver
  })
  const supplies = [ .13, .35, .62, .86 ].map((progress, index) => {
    const point = circuit.route.sample(progress)
    const [x, z] = offset(point, index % 2 ? 1.15 : -1.15)
    return { x, z, yaw: point.yaw, cooldown: 0 }
  })
  return { circuit, drivers, elapsed: 0, weapons: [], supplies, hits: [] }
}

export function recover(driver: Driver, circuit: Circuit = circuits[0]) {
  if (driver.finish !== null || driver.disabled > 0) return
  place(driver, circuit, (driver.gate - 1) * spacing + .009, 0)
  driver.offroad = false
  driver.stagger = 0
  driver.guard = .65
}

export function rivalInput(driver: Driver, circuit: Circuit = circuits[0]): DriveInput {
  const speed = Math.hypot(driver.vx, driver.vz)
  const point = circuit.route.sample(driver.progress + .011 + speed * .00065)
  const [x, z] = offset(point, (driver.slot - 1.5) * .82)
  const error = angleDelta(Math.atan2(x - driver.x, z - driver.z) - driver.yaw)
  const targetSpeed = circuit.pace + (3 - driver.slot) * .28 - Math.min(8, Math.abs(error) * 11)
  return {
    throttle: Math.max(-.72, Math.min(.95, (targetSpeed - speed) * .40 + .18)),
    steer: Math.max(-1, Math.min(1, error * 2.7)),
    drift: speed > 14 && Math.abs(error) > .55
  }
}

function deploy(race: Race, driver: Driver, control: RaceInput) {
  const fx = Math.sin(driver.yaw), fz = Math.cos(driver.yaw)
  if (control.pulse && driver.pulses && !driver.pulseCooldown) {
    driver.pulses--
    driver.pulseCooldown = driver.pulseInterval
    race.weapons.push({ kind: 'pulse', owner: driver.slot,
      x: driver.x + fx * 1.35, z: driver.z + fz * 1.35, yaw: driver.yaw, age: 0 })
  }
  if (control.snare && driver.snares && !driver.snareCooldown) {
    driver.snares--
    driver.snareCooldown = driver.snareInterval
    race.weapons.push({ kind: 'snare', owner: driver.slot,
      x: driver.x - fx * 1.65, z: driver.z - fz * 1.65, yaw: driver.yaw, age: 0 })
  }
}

function rivalWeapons(race: Race, driver: Driver, control: RaceInput) {
  if (race.elapsed < 4 + driver.slot * 1.35 || driver.offroad) return
  const fx = Math.sin(driver.yaw), fz = Math.cos(driver.yaw)
  for (const target of race.drivers) {
    if (target === driver || target.finish !== null || target.disabled || target.guard) continue
    const dx = target.x - driver.x, dz = target.z - driver.z
    const forward = dx * fx + dz * fz
    const sideways = Math.abs(dx * fz - dz * fx)
    if (forward >= 3.7 && forward <= 10 && sideways < .84) control.pulse = true
    if (forward >= -7 && forward <= -3.3 && sideways < .90) control.snare = true
  }
}

function contacts(race: Race) {
  for (const [index, a] of race.drivers.entries()) {
    for (let i = index + 1; i < race.drivers.length; i++) {
      const b = race.drivers[i]
      if (a.finish !== null || b.finish !== null || a.disabled || b.disabled) continue
      const dx = b.x - a.x, dz = b.z - a.z
      const distance = Math.hypot(dx, dz)
      const sx = distance ? dx / distance : 1, sz = distance ? dz / distance : 0
      const clearance = 2.35 + .42 * Math.abs(sx * Math.sin(a.yaw) + sz * Math.cos(a.yaw))
      if (distance >= clearance) continue
      const push = (clearance - distance) / 2
      a.x -= sx * push
      a.z -= sz * push
      b.x += sx * push
      b.z += sz * push
      const impact = Math.max(0, ((a.vx - b.vx) * sx + (a.vz - b.vz) * sz) * .43)
      a.vx -= sx * impact
      a.vz -= sz * impact
      b.vx += sx * impact
      b.vz += sz * impact
    }
  }
}

function stepWeapons(race: Race, dt: number) {
  for (const hit of race.hits) hit.age += dt
  race.hits = race.hits.filter(hit => hit.age < .35)
  race.weapons = race.weapons.filter(weapon => {
    weapon.age += dt
    const pulse = weapon.kind === 'pulse'
    if (weapon.age >= (pulse ? .58 : 7)) return false
    if (pulse) {
      weapon.x += Math.sin(weapon.yaw) * 36 * dt
      weapon.z += Math.cos(weapon.yaw) * 36 * dt
    } else if (weapon.age < .24) return true
    const target = race.drivers.find(driver =>
      driver.slot !== weapon.owner && driver.finish === null && !driver.disabled && !driver.guard &&
      Math.hypot(driver.x - weapon.x, driver.z - weapon.z) < (pulse ? 1.37 : 1.9))
    if (!target) return true
    target.shield = Math.max(0, target.shield - (pulse ? 27 : 38))
    target.stagger = pulse ? .62 : 1.10
    target.guard = .30
    target.vx *= pulse ? .66 : .34
    target.vz *= pulse ? .66 : .34
    if (!target.shield) {
      target.disabled = 1.85
      target.vx = target.vz = 0
    }
    race.hits.push({ x: target.x, z: target.z, age: 0 })
    return false
  })
}

function stepTrack(race: Race, driver: Driver) {
  const { circuit } = race
  const track = circuit.route.nearest(driver.x, driver.z)
  driver.offroad = track.distance > circuit.width * .5
  if (track.distance > 18) {
    driver.progress = track.progress
    recover(driver, circuit)
    return
  }
  if (track.distance > circuit.width * .85) return
  const previous = driver.progress
  driver.progress = track.progress
  const delta = (track.progress - previous + 1.5) % 1 - .5
  const toGate = (driver.gate * spacing - previous + 1) % 1
  if (delta > 0 && delta < .075 && (toGate === 0 || delta + 1e-9 >= toGate)) {
    if (driver.gate === 4) {
      driver.lap++
      driver.gate = 1
    } else driver.gate++
  }
  if (driver.lap >= circuit.laps) driver.finish = race.elapsed
}

export function stepRace(race: Race, control: RaceInput, dt: number) {
  if (race.drivers[0].finish !== null) return
  race.elapsed += dt
  for (const driver of race.drivers) {
    if (driver.finish !== null) continue
    driver.guard = Math.max(0, driver.guard - dt)
    driver.stagger = Math.max(0, driver.stagger - dt)
    driver.pulseCooldown = Math.max(0, driver.pulseCooldown - dt)
    driver.snareCooldown = Math.max(0, driver.snareCooldown - dt)
    if (driver.disabled > 0) {
      driver.disabled = Math.max(0, driver.disabled - dt)
      if (!driver.disabled) {
        recover(driver, race.circuit)
        driver.shield = Math.round(driver.maxShield * .65)
      }
      continue
    }
    const input: RaceInput = driver.slot === 0 ? control : rivalInput(driver, race.circuit)
    if (driver.slot !== 0) rivalWeapons(race, driver, input)
    const grip = race.circuit.grip * (driver.offroad ? driver.offroadGrip : 1)
    const effort = driver.stagger ? { ...input, throttle: input.throttle * .51 } : input
    driver.drive(driver, effort, dt, grip)
    driver.drift = effort.drift
    driver.steer = effort.steer
    driver.throttle = effort.throttle
    deploy(race, driver, input)
  }
  contacts(race)
  for (const driver of race.drivers) {
    if (driver.finish === null && !driver.disabled) stepTrack(race, driver)
  }
  stepWeapons(race, dt)
  for (const supply of race.supplies) {
    supply.cooldown = Math.max(0, supply.cooldown - dt)
    if (supply.cooldown) continue
    const receiver = race.drivers.find(driver => driver.finish === null && !driver.disabled &&
      (driver.shield < driver.maxShield || driver.pulses < driver.maxPulses || driver.snares < 2) &&
      Math.hypot(driver.x - supply.x, driver.z - supply.z) < 1.65)
    if (!receiver) continue
    receiver.pulses = Math.min(receiver.maxPulses, receiver.pulses + 2)
    receiver.snares = Math.min(2, receiver.snares + 1)
    receiver.shield = Math.min(receiver.maxShield, receiver.shield + 23)
    supply.cooldown = 6.25
  }
}

export function standings(race: Race) {
  function progress(driver: Driver) {
    const gateBase = (driver.gate - 1) * spacing
    const cleared = driver.lap + gateBase
    const travel = Math.max(0, Math.min(spacing, (driver.progress - gateBase + 1.5) % 1 - .5))
    return cleared + travel
  }
  return [...race.drivers].sort((a, b) => {
    if (a.finish !== null || b.finish !== null) return (a.finish ?? Infinity) - (b.finish ?? Infinity)
    return progress(b) - progress(a)
  })
}
