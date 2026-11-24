import { nextRandom } from '../framework/index.ts'
import {
  COTTAGE_POS, LIGHTHOUSE_POS, OBSTACLES, PADS, PIER_POS, RESOURCE_BASE_VALUE, RESOURCE_FUEL_VALUE,
  UPGRADES, WINCH_POS, carryCapFor, coldFactorFor, fuelBurnMultFor, islandHeight, pickupRadiusFor,
  sellMultFor, shipBountyMultFor, speedFor, upgradeCost, wadeFactorFor, winchIntervalFor, winchPayoutFor
} from './types.ts'
import type {
  GameSave, GameState, MoveInput, PassingShip, ResourceKind, SoundEvent, TidePhase, UpgradeId, WeatherKind, ZonePad
} from './types.ts'

const TIDE_PERIOD = 58 // seconds per full low -> high -> low cycle
const SAVE_KEY = 'ridgetop.tidewatch.v1'

const WEATHER_ORDER: readonly WeatherKind[] = ['clear', 'fog', 'rain', 'storm']
const WEATHER_DURATION: Record<WeatherKind, number> = {
  clear: 34,
  fog: 28,
  rain: 30,
  storm: 26
}

/** Deterministic PRNG powered by Ridgetop's `nextRandom`. */
function nextRand(state: GameState): number {
  const step = nextRandom(state.rng)
  state.rng = step.seed
  return step.value
}

function pushSound(state: GameState, kind: SoundEvent['kind'], pitch?: number) {
  state.sounds.push(pitch === undefined ? { kind } : { kind, pitch })
}

function addPopup(state: GameState, x: number, y: number, z: number, text: string, color: string, duration = 1.35) {
  state.popups.push({ id: state.nextId++, x, y, z, text, color, age: 0, duration })
  if (state.popups.length > 24) state.popups.shift()
}

function setBanner(state: GameState, text: string, color: string, timer = 3.2) {
  state.banner = { text, color, timer }
}

export function createInitialState(seed = 1337, save?: Partial<GameSave>): GameState {
  const upgrades: Record<UpgradeId, number> = {
    boots: clampLevel(save?.upgrades?.boots, 1, 5),
    pack: clampLevel(save?.upgrades?.pack, 1, 5),
    cloak: clampLevel(save?.upgrades?.cloak, 1, 5),
    lens: clampLevel(save?.upgrades?.lens, 1, 5),
    winch: clampLevel(save?.upgrades?.winch, 0, 4),
    charter: clampLevel(save?.upgrades?.charter, 1, 5)
  }

  const startX = -0.2
  const startZ = 0.8
  const state: GameState = {
    time: 0,
    day: Math.max(1, Math.floor(save?.day ?? 1)),
    coins: Math.max(0, Math.floor(save?.coins ?? 20)),
    totalEarned: Math.max(0, Math.floor(save?.totalEarned ?? 20)),
    shipsGuided: Math.max(0, Math.floor(save?.shipsGuided ?? 0)),
    victory: Boolean(save?.victoryClaimed),
    victoryClaimed: Boolean(save?.victoryClaimed),

    player: {
      x: startX,
      z: startZ,
      y: islandHeight(startX, startZ),
      vx: 0,
      vz: 0,
      yaw: 0,
      stride: 0,
      inWater: false,
      waterDepth: 0,
      warmth: 100,
      carry: [],
      stepTimer: 0,
      transferTimer: 0,
      fullNoticeTimer: 0
    },

    fuel: typeof save?.fuel === 'number' && Number.isFinite(save.fuel) ? Math.max(15, Math.min(100, save.fuel)) : 82,
    beamYaw: 0,
    lampLit: true,

    // Start right as tide is low so player immediately sees juicy shoal loot!
    tideCycle: 0.04,
    tideLevel: -0.18,
    tidePhase: 'low',
    lastLowTideSpawn: -1,

    weather: 'clear',
    weatherTimer: 0,
    weatherDuration: WEATHER_DURATION.clear,
    weatherBlend: 0,
    windX: 0.15,
    windZ: 0.08,
    lightningFlash: 0,
    lightningCooldown: 4,

    upgrades,
    winchTimer: 0,
    winchAngle: 0,

    items: [],
    ships: [],
    shipSpawnTimer: 5,
    popups: [],
    nextId: 1,

    activePad: null,
    padEntered: null,
    banner: { text: 'LOW TIDE — GATHER DRIFTWOOD & SALVAGE!', color: '#ffe599', timer: 4.0 },
    sounds: [],
    vfx: [],
    rng: seed | 0
  }

  spawnCoastalResources(state, true)
  return state
}

function clampLevel(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

export function serializeSave(state: GameState): GameSave {
  return {
    version: 1,
    coins: Math.floor(state.coins),
    totalEarned: Math.floor(state.totalEarned),
    shipsGuided: state.shipsGuided,
    day: state.day,
    fuel: Math.round(state.fuel),
    upgrades: { ...state.upgrades },
    victoryClaimed: state.victoryClaimed
  }
}

export function loadSave(storage: Storage | null | undefined): Partial<GameSave> | undefined {
  if (!storage) return undefined
  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return undefined
    return parsed as Partial<GameSave>
  } catch {
    return undefined
  }
}

export function persistSave(storage: Storage | null | undefined, state: GameState): boolean {
  if (!storage) return false
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(serializeSave(state)))
    return true
  } catch {
    return false
  }
}

export function clearSave(storage: Storage | null | undefined): void {
  try { storage?.removeItem(SAVE_KEY) } catch { /* ignore */ }
}

export function sellValue(state: GameState, kind: ResourceKind): number {
  return Math.max(1, Math.round(RESOURCE_BASE_VALUE[kind] * sellMultFor(state.upgrades.charter)))
}

export function canBuyUpgrade(state: GameState, id: UpgradeId): boolean {
  const spec = UPGRADES.find(u => u.id === id)
  if (!spec) return false
  const level = state.upgrades[id]
  if (level >= spec.maxLevel) return false
  return state.coins >= upgradeCost(spec, level)
}

export function buyUpgrade(state: GameState, id: UpgradeId): boolean {
  const spec = UPGRADES.find(u => u.id === id)
  if (!spec) return false
  const level = state.upgrades[id]
  if (level >= spec.maxLevel) return false
  const cost = upgradeCost(spec, level)
  if (state.coins < cost) return false
  state.coins -= cost
  state.upgrades[id] = level + 1
  pushSound(state, 'upgrade')
  state.vfx.push({ kind: 'upgrade', at: [state.player.x, state.player.y + 1.2, state.player.z] })
  addPopup(state, state.player.x, state.player.y + 1.8, state.player.z, `${spec.name.toUpperCase()} LV ${level + 1}!`, '#ffd97a', 1.9)
  checkVictory(state)
  return true
}

function checkVictory(state: GameState) {
  if (state.victoryClaimed) return
  if (state.upgrades.lens >= 5 || (state.shipsGuided >= 8 && state.totalEarned >= 800)) {
    state.victory = true
    state.victoryClaimed = true
    pushSound(state, 'victory')
    setBanner(state, 'MASTER KEEPER! THE COAST IS SAFE!', '#ffe794', 5.0)
  }
}

function isSpotClear(state: GameState, x: number, z: number, minGap = 1.45): boolean {
  for (const obs of OBSTACLES) {
    if (Math.hypot(x - obs.x, z - obs.z) < obs.radius + 0.9) return false
  }
  for (const pad of PADS) {
    if (Math.hypot(x - pad.x, z - pad.z) < pad.radius + 0.5) return false
  }
  for (const item of state.items) {
    if (Math.hypot(x - item.x, z - item.z) < minGap) return false
  }
  return true
}

function spawnKindAtZone(state: GameState, kind: ResourceKind, count: number, minH: number, maxH: number) {
  let placed = 0
  for (let attempt = 0; attempt < count * 14 && placed < count; attempt++) {
    const x = -9.5 + nextRand(state) * 21.5
    const z = -6.0 + nextRand(state) * 16.5
    const y = islandHeight(x, z)
    if (y < minH || y > maxH) continue
    // Don't spawn right on top of the pier planks
    if (x >= -8.4 && x <= -3.6 && z >= 2.2 && z <= 6.8) continue
    if (!isSpotClear(state, x, z)) continue
    state.items.push({
      id: state.nextId++,
      kind,
      x,
      z,
      y,
      yaw: nextRand(state) * Math.PI * 2,
      age: 0,
      pulling: false,
      pullT: 0
    })
    placed++
  }
}

export function spawnCoastalResources(state: GameState, initial = false) {
  const maxItems = 24
  if (state.items.length >= maxItems) return
  const stormBonus = state.weather === 'storm' || state.weather === 'rain' ? 2 : 0
  // Driftwood along mid-beach & headland edge
  spawnKindAtZone(state, 'driftwood', initial ? 7 : 4, 0.34, 1.02)
  // Salvage crates along lower beach & shoals
  spawnKindAtZone(state, 'salvage', initial ? 5 : 4 + stormBonus, 0.02, 0.58)
  // Rare glowing sea amber out on the deep tidal flats / reef
  spawnKindAtZone(state, 'amber', initial ? 4 : 3 + stormBonus, -0.05, 0.25)
  if (state.items.length > maxItems) state.items.length = maxItems
}

function spawnShip(state: GameState) {
  const dir: 1 | -1 = nextRand(state) < 0.5 ? 1 : -1
  const laneZ = 12.2 + nextRand(state) * 3.4
  const startX = dir > 0 ? -24 : 24
  const weatherMult = state.weather === 'storm' ? 2.4 : state.weather === 'fog' ? 1.65 : state.weather === 'rain' ? 1.35 : 1.0
  const baseBounty = Math.round((28 + state.day * 5 + nextRand(state) * 12) * weatherMult * shipBountyMultFor(state.upgrades.lens))
  const ship: PassingShip = {
    id: state.nextId++,
    x: startX,
    z: laneZ,
    dir,
    speed: 2.5 + nextRand(state) * 1.1,
    laneZ,
    guided: false,
    missed: false,
    bounty: baseBounty,
    size: 0.9 + nextRand(state) * 0.45,
    bobPhase: nextRand(state) * Math.PI * 2
  }
  state.ships.push(ship)
}

function computeTidePhase(cycle: number): TidePhase {
  if (cycle < 0.20 || cycle >= 0.85) return 'low'
  if (cycle < 0.42) return 'rising'
  if (cycle < 0.66) return 'high'
  return 'ebbing'
}

export function stepGame(state: GameState, input: MoveInput, dt: number): void {
  state.sounds.length = 0
  state.vfx.length = 0
  state.padEntered = null
  state.time += dt

  // 1. Tide cycle (cosine wave: 0 = low tide, 0.5 = high tide)
  const prevPhase = state.tidePhase
  state.tideCycle = (state.tideCycle + dt / TIDE_PERIOD) % 1
  if (state.tideCycle < dt / TIDE_PERIOD) {
    state.day++
  }
  const tideWave = 0.5 - 0.5 * Math.cos(state.tideCycle * Math.PI * 2) // 0 at low, 1 at high
  const stormSurge = state.weather === 'storm' ? 0.16 : state.weather === 'rain' ? 0.06 : 0
  state.tideLevel = -0.22 + tideWave * 0.58 + stormSurge // -0.22 (low) up to +0.52 (storm high)
  state.tidePhase = computeTidePhase(state.tideCycle)

  if (prevPhase !== state.tidePhase) {
    if (state.tidePhase === 'low') {
      spawnCoastalResources(state, false)
      pushSound(state, 'tideLow')
      setBanner(state, 'LOW TIDE — SHOALS EXPOSED! COLLECT AMBER & SALVAGE!', '#93f2dc', 3.4)
    } else if (state.tidePhase === 'high') {
      pushSound(state, 'tideHigh')
      setBanner(state, 'HIGH TIDE — KEEP THE BEACON LIT FOR PASSING SHIPS!', '#ffd485', 3.4)
    }
  }

  // 2. Weather cycle
  state.weatherTimer += dt
  if (state.weatherTimer >= state.weatherDuration) {
    state.weatherTimer = 0
    const idx = WEATHER_ORDER.indexOf(state.weather)
    const next = WEATHER_ORDER[(idx + 1) % WEATHER_ORDER.length]
    state.weather = next
    state.weatherDuration = WEATHER_DURATION[next]
    if (next === 'clear') setBanner(state, 'SKIES CLEARING — CALM SEAS AHEAD', '#ffe99f', 2.8)
    else if (next === 'fog') setBanner(state, 'COASTAL FOG ROLLING IN — SHIPS NEED THE LIGHT!', '#cbe3e6', 3.4)
    else if (next === 'rain') setBanner(state, 'SQUALL APPROACHING — WATCH YOUR WARMTH!', '#9fc8ee', 3.2)
    else if (next === 'storm') {
      setBanner(state, 'GALE STORM! DOUBLE SHIP BOUNTIES & STORM WRECKAGE!', '#ffaa75', 3.8)
      spawnCoastalResources(state, false)
    }
  }

  // Wind & lightning
  const windTargetX = state.weather === 'storm' ? 1.55 : state.weather === 'rain' ? 0.65 : state.weather === 'fog' ? 0.22 : 0.15
  const windTargetZ = state.weather === 'storm' ? 0.72 : state.weather === 'rain' ? 0.30 : 0.08
  state.windX += (windTargetX - state.windX) * Math.min(1, dt * 1.6)
  state.windZ += (windTargetZ - state.windZ) * Math.min(1, dt * 1.6)

  if (state.lightningFlash > 0) state.lightningFlash = Math.max(0, state.lightningFlash - dt * 2.4)
  if (state.weather === 'storm') {
    state.lightningCooldown -= dt
    if (state.lightningCooldown <= 0) {
      state.lightningFlash = 1
      state.lightningCooldown = 5.5 + nextRand(state) * 6.5
      pushSound(state, 'thunder')
    }
  }

  // 3. Lighthouse fuel & rotating beam
  const weatherBurn = state.weather === 'storm' ? 1.85 : state.weather === 'rain' ? 1.35 : state.weather === 'fog' ? 1.15 : 0.85
  const burnRate = 1.15 * weatherBurn * fuelBurnMultFor(state.upgrades.lens)
  state.fuel = Math.max(0, state.fuel - burnRate * dt)
  state.lampLit = state.fuel > 0.5
  if (state.lampLit) {
    state.beamYaw = (state.beamYaw + dt * (1.25 + state.upgrades.lens * 0.14)) % (Math.PI * 2)
  }

  // 4. Player movement, wading, wind push, and collision
  const p = state.player
  const inLen = Math.hypot(input.x, input.z)
  const dirX = inLen > 1 ? input.x / inLen : input.x
  const dirZ = inLen > 1 ? input.z / inLen : input.z

  const groundY = islandHeight(p.x, p.z)
  const depth = Math.max(0, state.tideLevel - groundY)
  p.waterDepth = depth
  p.inWater = depth > 0.03

  let moveSpeed = speedFor(state.upgrades.boots)
  if (p.inWater) {
    const depthSlow = Math.max(0.32, 1 - depth * (1.4 - wadeFactorFor(state.upgrades.boots)))
    moveSpeed *= depthSlow
  }
  if (p.warmth < 25) moveSpeed *= 0.72

  // Gale wind push (resisted by Oilskin Cloak)
  const windPush = state.weather === 'storm' ? 0.95 * coldFactorFor(state.upgrades.cloak) : 0
  const targetVx = dirX * moveSpeed + (windPush > 0 ? state.windX * windPush : 0)
  const targetVz = dirZ * moveSpeed + (windPush > 0 ? state.windZ * windPush : 0)

  const accel = Math.min(1, dt * 13)
  p.vx += (targetVx - p.vx) * accel
  p.vz += (targetVz - p.vz) * accel

  let nextX = p.x + p.vx * dt
  let nextZ = p.z + p.vz * dt

  // Prevent walking into un-wadeable deep ocean (> 0.44m water depth)
  const nextGround = islandHeight(nextX, nextZ)
  if (state.tideLevel - nextGround > 0.44 && nextGround < groundY) {
    // Slide along shoreline by testing axes independently
    const tryX = islandHeight(nextX, p.z)
    const tryZ = islandHeight(p.x, nextZ)
    if (state.tideLevel - tryX <= 0.44 || tryX >= groundY) nextZ = p.z
    else if (state.tideLevel - tryZ <= 0.44 || tryZ >= groundY) nextX = p.x
    else {
      // Gently push back toward headland center
      const toCenterX = -p.x
      const toCenterZ = -2 - p.z
      const d = Math.hypot(toCenterX, toCenterZ) || 1
      nextX = p.x + (toCenterX / d) * 1.4 * dt
      nextZ = p.z + (toCenterZ / d) * 1.4 * dt
    }
  }

  // Clamp to world bounds
  nextX = Math.max(-13.5, Math.min(14.5, nextX))
  nextZ = Math.max(-8.2, Math.min(12.2, nextZ))

  // Circle obstacle collisions (lighthouse, cottage, rocks, brazier)
  const playerR = 0.44
  for (const obs of OBSTACLES) {
    const dx = nextX - obs.x
    const dz = nextZ - obs.z
    const dist = Math.hypot(dx, dz)
    const minDist = obs.radius + playerR
    if (dist < minDist && dist > 1e-4) {
      const push = (minDist - dist) / dist
      nextX += dx * push
      nextZ += dz * push
    }
  }

  p.x = nextX
  p.z = nextZ
  p.y = islandHeight(p.x, p.z)

  const speed = Math.hypot(p.vx, p.vz)
  if (inLen > 0.08) {
    const desiredYaw = Math.atan2(dirX, dirZ)
    let delta = desiredYaw - p.yaw
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    p.yaw += delta * Math.min(1, dt * 14)
  }

  if (speed > 0.65) {
    p.stride += dt * speed * 2.4
    p.stepTimer -= dt
    if (p.stepTimer <= 0) {
      p.stepTimer = Math.max(0.20, 0.34 - (state.upgrades.boots - 1) * 0.025)
      pushSound(state, p.inWater ? 'splash' : 'step', 0.92 + nextRand(state) * 0.16)
      if (p.inWater) state.vfx.push({ kind: 'splash', at: [p.x, state.tideLevel + 0.04, p.z] })
    }
  } else {
    p.stepTimer = Math.min(p.stepTimer, 0.08)
  }

  // 5. Warmth system (cold in fog/rain/storm/water, reheated by Cottage Brazier or Clear skies)
  const brazier = PADS.find(pad => pad.id === 'brazier')!
  const nearFire = Math.hypot(p.x - brazier.x, p.z - brazier.z) <= brazier.radius + 0.75
  const nearCottage = Math.hypot(p.x - COTTAGE_POS.x, p.z - COTTAGE_POS.z) <= 3.1
  if (nearFire || nearCottage) {
    p.warmth = Math.min(100, p.warmth + 34 * dt)
  } else {
    const weatherChill = state.weather === 'storm' ? 6.8 : state.weather === 'rain' ? 3.5 : state.weather === 'fog' ? 1.5 : -7.5
    const waterChill = p.inWater ? 4.2 + p.waterDepth * 6 : 0
    const netDrain = (weatherChill > 0 ? weatherChill * coldFactorFor(state.upgrades.cloak) : weatherChill) +
      waterChill * coldFactorFor(state.upgrades.cloak)
    p.warmth = Math.max(8, Math.min(100, p.warmth - netDrain * dt))
  }

  // 6. Resource magnet pickup & carry stack
  const cap = carryCapFor(state.upgrades.pack)
  const radius = pickupRadiusFor(state.upgrades.pack)
  p.fullNoticeTimer = Math.max(0, p.fullNoticeTimer - dt)

  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i]
    item.age += dt
    const dx = p.x - item.x
    const dz = p.z - item.z
    const dist = Math.hypot(dx, dz)

    if (item.pulling) {
      item.pullT += dt * 7.5
      const blend = Math.min(1, dt * 15)
      item.x += (p.x - item.x) * blend
      item.z += (p.z - item.z) * blend
      item.y += (p.y + 0.9 - item.y) * blend
      if (dist < 0.55 || item.pullT >= 1) {
        if (p.carry.length < cap) {
          p.carry.push(item.kind)
          const pitch = 0.9 + Math.min(0.65, p.carry.length * 0.06)
          pushSound(state, 'pickup', pitch)
          state.vfx.push({ kind: 'pickup', itemKind: item.kind, from: [item.x, item.y + 0.35, item.z] })
          const label = item.kind === 'amber' ? '+AMBER' : item.kind === 'salvage' ? '+SALVAGE' : '+WOOD'
          const col = item.kind === 'amber' ? '#8fffe6' : item.kind === 'salvage' ? '#ffc478' : '#e6d3a7'
          addPopup(state, p.x, p.y + 1.5, p.z, label, col, 0.9)
        }
        state.items.splice(i, 1)
      }
      continue
    }

    if (dist <= radius) {
      if (p.carry.length < cap) {
        item.pulling = true
        item.pullT = 0
      } else if (p.fullNoticeTimer <= 0 && dist < 1.15) {
        p.fullNoticeTimer = 2.0
        pushSound(state, 'full')
        addPopup(state, p.x, p.y + 1.65, p.z, 'PACK FULL!', '#ff8b7b', 1.1)
      }
    }
  }

  // Gentle trickle respawn if island gets too empty
  if (state.items.length < 7 && Math.floor(state.time) % 8 === 0 && Math.floor((state.time - dt)) % 8 !== 0) {
    spawnCoastalResources(state, false)
  }

  // 7. Interactive Pads (Whiteout Survival rapid auto-transfer!)
  let currentPad: ZonePad['id'] | null = null
  for (const pad of PADS) {
    if (Math.hypot(p.x - pad.x, p.z - pad.z) <= pad.radius) {
      currentPad = pad.id
      break
    }
  }
  if (currentPad && currentPad !== state.activePad) {
    state.padEntered = currentPad
  }
  state.activePad = currentPad

  p.transferTimer = Math.max(0, p.transferTimer - dt)
  if (currentPad === 'sell' && p.carry.length > 0 && p.transferTimer <= 0) {
    const kind = p.carry.pop()!
    const value = sellValue(state, kind)
    state.coins += value
    state.totalEarned += value
    p.transferTimer = 0.11
    pushSound(state, 'sell', 0.95 + (1 - p.carry.length / Math.max(1, cap)) * 0.4)
    state.vfx.push({
      kind: 'sell',
      itemKind: kind,
      from: [p.x, p.y + 1.15, p.z],
      to: [PIER_POS.x - 1.2, 1.55, PIER_POS.z - 0.35]
    })
    addPopup(state, PIER_POS.x + 0.5, 1.8, PIER_POS.z - 0.3, `+${value}g`, '#ffe17a', 1.1)
    checkVictory(state)
  } else if (currentPad === 'fuel' && p.carry.length > 0 && state.fuel < 99.5 && p.transferTimer <= 0) {
    // Prefer driftwood first, then amber, then salvage
    let idx = p.carry.lastIndexOf('driftwood')
    if (idx < 0) idx = p.carry.lastIndexOf('amber')
    if (idx < 0) idx = p.carry.length - 1
    const [kind] = p.carry.splice(idx, 1)
    const gain = RESOURCE_FUEL_VALUE[kind]
    state.fuel = Math.min(100, state.fuel + gain)
    // Small keeper stipend for tending the beacon!
    const stipend = kind === 'amber' ? 14 : 4
    state.coins += stipend
    state.totalEarned += stipend
    p.transferTimer = 0.13
    pushSound(state, 'fuel', 0.92 + (state.fuel / 100) * 0.35)
    state.vfx.push({
      kind: 'fuel',
      itemKind: kind,
      from: [p.x, p.y + 1.15, p.z],
      to: [LIGHTHOUSE_POS.x + 1.35, islandHeight(LIGHTHOUSE_POS.x, LIGHTHOUSE_POS.z) + 0.9, LIGHTHOUSE_POS.z + 1.1]
    })
    addPopup(state, LIGHTHOUSE_POS.x, 2.5, LIGHTHOUSE_POS.z + 1.4, `+${gain}% FUEL (+${stipend}g)`, '#9af5d8', 1.15)
  }

  // 8. Unlockable Pier Winch (passive auto-salvage)
  if (state.upgrades.winch > 0) {
    state.winchAngle = (state.winchAngle + dt * (0.9 + state.upgrades.winch * 0.25)) % (Math.PI * 2)
    state.winchTimer += dt
    const interval = winchIntervalFor(state.upgrades.winch)
    if (state.winchTimer >= interval) {
      state.winchTimer -= interval
      const payout = Math.round(winchPayoutFor(state.upgrades.winch) * sellMultFor(state.upgrades.charter))
      state.coins += payout
      state.totalEarned += payout
      pushSound(state, 'sell', 1.25)
      state.vfx.push({ kind: 'winchPayout', at: [WINCH_POS.x, 2.1, WINCH_POS.z] })
      addPopup(state, WINCH_POS.x, 2.1, WINCH_POS.z, `WINCH +${payout}g`, '#ffd984', 1.2)
      checkVictory(state)
    }
  }

  // 9. Passing Ships (more frequent at high tide & fog/storm!)
  state.shipSpawnTimer -= dt * (state.tidePhase === 'high' ? 1.55 : state.tidePhase === 'rising' ? 1.15 : 0.65)
  if (state.shipSpawnTimer <= 0 && state.ships.length < 3) {
    spawnShip(state)
    state.shipSpawnTimer = Math.max(9.5, 16 - state.upgrades.charter * 1.1)
  }

  for (let i = state.ships.length - 1; i >= 0; i--) {
    const ship = state.ships[i]
    ship.x += ship.dir * ship.speed * dt
    ship.bobPhase += dt * (state.weather === 'storm' ? 3.8 : 1.9)

    // When passing near the headland meridian, check if lighthouse is lit!
    if (!ship.guided && !ship.missed && Math.abs(ship.x - LIGHTHOUSE_POS.x) < 4.5) {
      if (state.lampLit) {
        ship.guided = true
        state.shipsGuided++
        state.coins += ship.bounty
        state.totalEarned += ship.bounty
        pushSound(state, 'foghorn')
        state.vfx.push({ kind: 'shipGuided', at: [ship.x, state.tideLevel + 1.4, ship.z] })
        addPopup(state, ship.x, 2.8, ship.z - 1.5, `SHIP GUIDED +${ship.bounty}g!`, '#ffe588', 2.0)
        checkVictory(state)
      } else {
        ship.missed = true
        addPopup(state, ship.x, 2.6, ship.z - 1.5, 'BEACON DARK — SHIP LOST!', '#ff8370', 2.0)
      }
    }

    if (Math.abs(ship.x) > 27) state.ships.splice(i, 1)
  }

  // 10. Popups & Banner timers
  for (let i = state.popups.length - 1; i >= 0; i--) {
    const pop = state.popups[i]
    pop.age += dt
    pop.y += dt * 1.05
    if (pop.age >= pop.duration) state.popups.splice(i, 1)
  }
  if (state.banner) {
    state.banner.timer -= dt
    if (state.banner.timer <= 0) state.banner = null
  }
}
