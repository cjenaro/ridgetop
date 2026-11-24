import {
  box, color, createAnimator, createMeshPool, createParticles, multiply, octahedron, perspective,
  quaternionFromEuler, renderRig, view, worldToScreen
} from 'ridgetop'
import type { Color, JointPose, LowPolyRenderer, Matrix, RigPart, Vec3 } from 'ridgetop'
import {
  COASTAL_PINES, HARBOR_BUOYS, amberRig, beamMesh, buildStaticIslandBatches, buoyRig, coinMesh,
  driftwoodRig, drum, flatRing, gullRig, keeperClips, keeperRig, merchantRig, ovalMesh, pineRig,
  rockMesh, salvageRig, shipRig, softBox, winchRig
} from './art.ts'
import { COTTAGE_POS, LIGHTHOUSE_POS, PADS, PIER_POS, WINCH_POS, islandHeight } from './types.ts'
import type { GameState, ResourceKind, WeatherKind } from './types.ts'

const SKY_COLORS: Record<WeatherKind, Color> = {
  clear: color('5ca9c4'),
  fog: color('8fa6ab'),
  rain: color('385066'),
  storm: color('182636')
}

const OCEAN_COLORS: Record<WeatherKind, Color> = {
  clear: color('258da4'),
  fog: color('487a87'),
  rain: color('1f5b75'),
  storm: color('123a54')
}

const WEATHER_LIGHT: Record<WeatherKind, {
  dir: Vec3; ambient: number; color: Vec3; fogNear: number; fogFar: number
}> = {
  clear: { dir: [-0.45, 0.84, 0.36], ambient: 0.56, color: [1.0, 0.97, 0.90], fogNear: 34, fogFar: 112 },
  fog:   { dir: [-0.22, 0.92, 0.22], ambient: 0.62, color: [0.84, 0.91, 0.93], fogNear: 14, fogFar: 46 },
  rain:  { dir: [-0.55, 0.68, 0.26], ambient: 0.38, color: [0.70, 0.82, 0.95], fogNear: 18, fogFar: 62 },
  storm: { dir: [-0.72, 0.46, 0.20], ambient: 0.22, color: [0.54, 0.68, 0.90], fogNear: 16, fogFar: 52 }
}

const FOAM_COLOR: Color = [0.55, 0.85, 0.86, 0.62]
const CREST_COLOR: Color = [0.86, 0.96, 0.95, 0.78]
const BEAM_OUTER: Color = [1.0, 0.93, 0.64, 0.15]
const BEAM_INNER: Color = [1.0, 0.96, 0.78, 0.28]
const BEAM_HALO: Color = [1.0, 0.92, 0.65, 0.24]
const BEAM_SPOT: Color = [1.0, 0.94, 0.68, 0.24]
const LAMP_LIT = color('ffe79c')
const LAMP_DIM = color('48575e')
const FIRE_OUTER = color('ff7d3b')
const FIRE_INNER = color('ffe47d')
const FIRE_HALO: Color = [1.0, 0.56, 0.20, 0.22]
const RAIN_COLOR: Color = [0.74, 0.88, 0.98, 0.44]
const FOG_COLOR: Color = [0.84, 0.91, 0.93, 0.22]
const SMOKE_COLOR: Color = [0.88, 0.92, 0.94, 0.52]
const GOLD_COLOR = color('ffd966')

function withAlpha(c: Color, alpha: number): Color {
  return [c[0], c[1], c[2], alpha]
}

const PACK_COLORS = [color('9c6b43'), color('ab774a'), color('bf874f'), color('d49c54'), color('e8b85a')]
const CLOAK_COLORS = [color('ebb336'), color('eb9a36'), color('de7938'), color('c95343'), color('2c94ad')]
const BOOT_COLORS = [color('263844'), color('354d5c'), color('476673'), color('5a848c'), color('e6b856')]

function lerpColor(a: Color, b: Color, t: number): Color {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    1
  ]
}

function itemColor(kind: ResourceKind): Color {
  if (kind === 'amber') return color('7fffe4')
  if (kind === 'salvage') return color('e2864b')
  return color('a37148')
}

function itemMesh(kind: ResourceKind) {
  if (kind === 'amber') return octahedron
  if (kind === 'salvage') return softBox
  return drum
}

export function createLighthouseScene(renderer: LowPolyRenderer) {
  const staticBatches = buildStaticIslandBatches()
  const pool = createMeshPool(64)
  const particles = createParticles(260)
  const keeperAnim = createAnimator(keeperClips, 'idle')

  let currentSky: Color = [...SKY_COLORS.clear]
  let currentOcean: Color = [...OCEAN_COLORS.clear]
  let curAmbient = WEATHER_LIGHT.clear.ambient
  let curLightDir: [number, number, number] = [...WEATHER_LIGHT.clear.dir]
  let curLightColor: [number, number, number] = [...WEATHER_LIGHT.clear.color]
  let curFogNear = WEATHER_LIGHT.clear.fogNear
  let curFogFar = WEATHER_LIGHT.clear.fogFar
  let lanternWorldPos: Vec3 = [0, 1.5, 0]
  let camX = 0, camZ = 1.5
  let celebrateTimer = 0
  let merchantCheerTimer = 0
  let hopPulse = 0
  let smokeTimer = 0
  let emberTimer = 0
  let wakeTimer = 0
  let lastMatrix: Matrix = multiply(perspective(Math.PI / 3.4, 16 / 9, 0.5, 160), view([0, 18, 22], [0, 0, 0]))

  const lhY = islandHeight(LIGHTHOUSE_POS.x, LIGHTHOUSE_POS.z) - 0.12

  function spawnVfx(state: GameState) {
    const p = state.player
    for (const ev of state.vfx) {
      if (ev.kind === 'pickup') {
        hopPulse = 1
        particles.arc({
          mesh: itemMesh(ev.itemKind),
          from: ev.from,
          to: [p.x, p.y + 1.05, p.z],
          peak: 1.15,
          scale: [0.24, 0.24, 0.24],
          color: itemColor(ev.itemKind),
          unlit: ev.itemKind === 'amber' ? 0.85 : 0.25,
          duration: 0.24
        })
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2
          particles.spawn({
            mesh: octahedron,
            position: ev.from,
            velocity: [Math.cos(a) * 1.8, 1.9 + (i % 2) * 0.7, Math.sin(a) * 1.8],
            gravity: 5.5,
            scale: [0.11, 0.11, 0.11],
            color: ev.itemKind === 'amber' ? color('8fffe8') : GOLD_COLOR,
            unlit: 0.95,
            life: 0.42
          })
        }
      } else if (ev.kind === 'sell') {
        merchantCheerTimer = 1.1
        particles.arc({
          mesh: itemMesh(ev.itemKind),
          from: ev.from,
          to: ev.to,
          peak: 1.65,
          scale: [0.28, 0.26, 0.28],
          color: itemColor(ev.itemKind),
          unlit: 0.3,
          duration: 0.34
        })
        // Golden coins fly back from stall to keeper!
        for (let i = 0; i < 3; i++) {
          particles.arc({
            mesh: coinMesh,
            from: [ev.to[0] + (i - 1) * 0.25, ev.to[1] + 0.2, ev.to[2]],
            to: [p.x, p.y + 1.1, p.z],
            peak: 1.4 + i * 0.25,
            scale: [0.14, 0.05, 0.14],
            spin: 12,
            color: GOLD_COLOR,
            unlit: 0.9,
            duration: 0.38 + i * 0.07
          })
        }
      } else if (ev.kind === 'fuel') {
        particles.arc({
          mesh: itemMesh(ev.itemKind),
          from: ev.from,
          to: ev.to,
          peak: 1.55,
          scale: [0.26, 0.24, 0.26],
          color: itemColor(ev.itemKind),
          unlit: 0.35,
          duration: 0.32
        })
        for (let i = 0; i < 5; i++) {
          particles.spawn({
            mesh: octahedron,
            position: ev.to,
            velocity: [(i - 2) * 0.5, 2.4 + (i % 3) * 0.6, ((i % 2) - 0.5) * 0.6],
            gravity: 1.5,
            scale: [0.12, 0.15, 0.12],
            color: FIRE_INNER,
            unlit: 1,
            life: 0.55
          })
        }
      } else if (ev.kind === 'upgrade') {
        celebrateTimer = 0.74
        keeperAnim.trigger('celebrate', 0.06, 1)
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2
          particles.spawn({
            mesh: octahedron,
            position: ev.at,
            velocity: [Math.cos(a) * 2.8, 3.2 + (i % 3) * 0.9, Math.sin(a) * 2.8],
            gravity: 6.2,
            spin: 9,
            scale: [0.14, 0.18, 0.14],
            color: i % 2 === 0 ? GOLD_COLOR : color('8fffe6'),
            unlit: 0.95,
            life: 0.78
          })
        }
      } else if (ev.kind === 'shipGuided') {
        for (let i = 0; i < 5; i++) {
          particles.arc({
            mesh: coinMesh,
            from: [ev.at[0] + (i - 2) * 0.4, ev.at[1], ev.at[2]],
            to: [p.x, p.y + 1.2, p.z],
            peak: 3.4 + i * 0.35,
            scale: [0.18, 0.06, 0.18],
            spin: 14,
            color: GOLD_COLOR,
            unlit: 0.95,
            duration: 0.85 + i * 0.09
          })
        }
      } else if (ev.kind === 'winchPayout') {
        for (let i = 0; i < 4; i++) {
          particles.arc({
            mesh: coinMesh,
            from: ev.at,
            to: [p.x, p.y + 1.1, p.z],
            peak: 2.0 + i * 0.25,
            scale: [0.15, 0.05, 0.15],
            spin: 12,
            color: GOLD_COLOR,
            unlit: 0.95,
            duration: 0.55 + i * 0.08
          })
        }
      } else if (ev.kind === 'splash') {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + state.time
          particles.spawn({
            mesh: ovalMesh,
            position: ev.at,
            velocity: [Math.cos(a) * 1.4, 1.65, Math.sin(a) * 1.4],
            gravity: 6.8,
            scale: [0.12, 0.12, 0.12],
            color: CREST_COLOR,
            unlit: 0.5,
            life: 0.38
          })
        }
      }
    }
  }

  function updateAmbientParticles(state: GameState, dt: number) {
    // 1. Cottage chimney smoke puffs drifting downwind
    smokeTimer += dt
    if (smokeTimer >= 0.42) {
      smokeTimer = 0
      const hx = COTTAGE_POS.x - 0.72, hz = COTTAGE_POS.z - 0.26
      const hy = islandHeight(COTTAGE_POS.x, COTTAGE_POS.z) + 2.86
      particles.spawn({
        mesh: ovalMesh,
        blend: 'alpha',
        alphaFade: true,
        position: [hx, hy, hz],
        velocity: [state.windX * 0.85 + 0.15, 1.05, state.windZ * 0.75],
        drag: 0.25,
        scale: [0.22, 0.20, 0.22],
        endScale: 2.6,
        spin: 0.8,
        color: SMOKE_COLOR,
        unlit: 0.55,
        life: 2.5
      })
    }

    // 2. Rising glowing embers from the Warmth Brazier
    emberTimer += dt
    if (emberTimer >= 0.18) {
      emberTimer = 0
      const bx = -1.3, bz = -2.1
      const by = islandHeight(bx, bz) + 0.85
      const wobble = Math.sin(state.time * 7.3) * 0.22
      particles.spawn({
        mesh: octahedron,
        position: [bx + wobble, by, bz + Math.cos(state.time * 5.9) * 0.18],
        velocity: [state.windX * 0.45, 1.55, state.windZ * 0.45],
        scale: [0.09, 0.12, 0.09],
        endScale: 0.05,
        spin: 6,
        color: FIRE_INNER,
        unlit: 1.0,
        life: 0.85
      })
    }

    // 3. Ship wake foam behind passing vessels
    wakeTimer += dt
    if (wakeTimer >= 0.22) {
      wakeTimer = 0
      for (const ship of state.ships) {
        particles.spawn({
          mesh: ovalMesh,
          blend: 'alpha',
          alphaFade: true,
          position: [ship.x - ship.dir * 2.1 * ship.size, state.tideLevel + 0.04, ship.z],
          velocity: [-ship.dir * 0.35, 0, (Math.sin(state.time * 4 + ship.id) * 0.25)],
          scale: [0.34 * ship.size, 0.06, 0.48 * ship.size],
          endScale: 2.1,
          color: CREST_COLOR,
          unlit: 0.6,
          life: 1.25
        })
      }
    }

    particles.step(dt)
  }

  function render(state: GameState, dt: number, titleMode: boolean) {
    spawnVfx(state)
    updateAmbientParticles(state, dt)

    // Smoothly transition sky, ocean, sun tint, distance fog, and dynamic point lights!
    const blend = Math.min(1, dt * 1.6)
    currentSky = lerpColor(currentSky, SKY_COLORS[state.weather], blend)
    currentOcean = lerpColor(currentOcean, OCEAN_COLORS[state.weather], blend)
    const targetLight = WEATHER_LIGHT[state.weather]
    curAmbient += (targetLight.ambient - curAmbient) * blend
    curLightDir[0] += (targetLight.dir[0] - curLightDir[0]) * blend
    curLightDir[1] += (targetLight.dir[1] - curLightDir[1]) * blend
    curLightDir[2] += (targetLight.dir[2] - curLightDir[2]) * blend
    curLightColor[0] += (targetLight.color[0] - curLightColor[0]) * blend
    curLightColor[1] += (targetLight.color[1] - curLightColor[1]) * blend
    curLightColor[2] += (targetLight.color[2] - curLightColor[2]) * blend
    curFogNear += (targetLight.fogNear - curFogNear) * blend
    curFogFar += (targetLight.fogFar - curFogFar) * blend

    const flashAmbient = state.lightningFlash > 0.02 ? Math.min(0.96, curAmbient + state.lightningFlash * 0.72) : curAmbient
    const sky = state.lightningFlash > 0.02
      ? lerpColor(currentSky, [0.88, 0.94, 1.0, 1], state.lightningFlash * 0.65)
      : currentSky

    const waterY = state.tideLevel
    const fireX = -1.3, fireZ = -2.1
    const fireY = islandHeight(fireX, fireZ) + 0.72
    const flick = 0.88 + Math.sin(state.time * 13) * 0.18
    const beamLen = 10.5 + state.upgrades.lens * 2.2
    const spotDist = beamLen * 1.08
    const spotX = LIGHTHOUSE_POS.x + Math.sin(state.beamYaw) * spotDist
    const spotZ = LIGHTHOUSE_POS.z + Math.cos(state.beamYaw) * spotDist
    const spotY = Math.max(waterY, islandHeight(spotX, spotZ)) + 0.4

    const stormBoost = state.weather === 'storm' ? 1.55 : state.weather === 'rain' ? 1.25 : state.weather === 'fog' ? 1.10 : 0.45
    renderer.setLighting({
      direction: curLightDir,
      ambient: flashAmbient,
      color: state.lightningFlash > 0.02 ? [0.95, 0.98, 1.0] : curLightColor,
      fogColor: sky,
      fogNear: curFogNear,
      fogFar: curFogFar,
      points: [
        // 1. Warmth Brazier campfire light
        { position: [fireX, fireY + 0.5, fireZ], color: [1.0, 0.56, 0.22], radius: 6.5, intensity: (0.95 + flick * 0.25) * stormBoost },
        // 2. Keeper's swinging handheld lantern light
        {
          position: [lanternWorldPos[0], lanternWorldPos[1] + 0.2, lanternWorldPos[2]],
          color: state.weather === 'clear' ? [1.0, 0.86, 0.52] : [0.46, 0.96, 0.88],
          radius: 5.2,
          intensity: 0.72 * stormBoost
        },
        // 3. Sweeping Lighthouse searchlight pool (when lit)
        ...(state.lampLit ? [{
          position: [spotX, spotY + 1.0, spotZ] as Vec3,
          color: [1.0, 0.92, 0.62] as Vec3,
          radius: 8.0 + state.upgrades.lens * 0.8,
          intensity: 1.25 * Math.max(0.75, stormBoost)
        }] : []),
        // 4. Trading Pier market lantern
        { position: [PIER_POS.x - 0.72, 2.26, PIER_POS.z + 0.53], color: [1.0, 0.84, 0.48], radius: 5.8, intensity: 0.78 * stormBoost }
      ]
    })

    pool.clear()

    // 1. Semi-Transparent Dynamic Ocean (reveals submerged shoals & sunken amber beneath rising tide!)
    const waveAmp = state.weather === 'storm' ? 0.16 : state.weather === 'rain' ? 0.09 : 0.045
    const waveSpeed = state.weather === 'storm' ? 3.2 : 1.7
    const oceanTint = state.lightningFlash > 0.02
      ? lerpColor(currentOcean, [0.55, 0.78, 0.90, 1], state.lightningFlash * 0.4)
      : currentOcean

    // Deep opaque seabed base matching outer terrain edge + translucent upper sea surface
    pool.add(box, [0, -1.75, 4], [260, 0.40, 240], 0, color('264e5e'), 0.12)
    pool.add(box, [0, waterY - 0.04, 4], [260, 0.08, 240], 0, withAlpha(oceanTint, 0.80), 0.26, 'alpha')

    // Lapping shoreline surf hugging the live waterline contour (tracks rising & falling tide!)
    const surfPulse = 0.5 + 0.5 * Math.sin(state.time * 1.9)
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + 0.14
      const dirX = Math.cos(a), dirZ = Math.sin(a)
      let lo = 3.5, hi = 15.5
      for (let step = 0; step < 6; step++) {
        const mid = (lo + hi) * 0.5
        if (islandHeight(dirX * mid, 0.6 + dirZ * mid) > waterY) lo = mid
        else hi = mid
      }
      const r = hi + 0.35 + surfPulse * 0.35
      const rx = dirX * r
      const rz = 0.6 + dirZ * r
      if (rx >= -8.8 && rx <= -3.4 && rz >= 2.0 && rz <= 7.0) continue
      pool.add(ovalMesh, [rx, waterY + 0.02, rz], [0.92 + surfPulse * 0.25, 0.03, 0.28], -a + Math.PI / 2, i % 2 === 0 ? CREST_COLOR : FOAM_COLOR, 0.65, 'alpha')
    }

    // Staggered organic translucent sea ripples
    for (let i = 0; i < 28; i++) {
      const h1 = Math.sin(i * 12.9898) * 43758.5453
      const r1 = h1 - Math.floor(h1)
      const h2 = Math.sin(i * 78.233) * 43758.5453
      const r2 = h2 - Math.floor(h2)
      const drift = ((r1 * 56 + state.time * (state.weather === 'storm' ? 2.4 : 0.85)) % 56) - 28
      const wz = -14 + r2 * 34
      if (Math.hypot(drift * 0.8, wz + 0.5) < 10.2) continue
      const crest = Math.sin(state.time * waveSpeed + drift * 0.35 + wz * 0.25) * waveAmp
      pool.add(ovalMesh, [drift, waterY + 0.025 + crest * 0.35, wz], [1.1 + (i % 3) * 0.45, 0.04, 0.22], 0.12 * Math.sin(i), i % 3 === 0 ? CREST_COLOR : FOAM_COLOR, 0.55, 'alpha')
    }

    // 2. Animated Lighthouse Interior Fresnel Prism + Volumetric Additive Light Beams & Halo!
    const lanternY = lhY + 6.02
    pool.add(
      octahedron,
      [LIGHTHOUSE_POS.x, lanternY, LIGHTHOUSE_POS.z],
      [0.44, 0.58, 0.44],
      state.beamYaw * 2,
      state.lampLit ? LAMP_LIT : LAMP_DIM,
      state.lampLit ? 0.98 : 0.1
    )
    if (state.lampLit) {
      // Soft glowing volumetric halo around the lantern room
      pool.add(ovalMesh, [LIGHTHOUSE_POS.x, lanternY, LIGHTHOUSE_POS.z], [2.4, 2.2, 2.4], 0, BEAM_HALO, 1.0, 'additive')
      const beamRadius = 2.0 + state.upgrades.lens * 0.28
      const q1 = quaternionFromEuler(0.32, state.beamYaw, 0)
      // Outer soft volumetric cone + inner bright core cone (both additive!)
      pool.add(beamMesh, [LIGHTHOUSE_POS.x, lanternY, LIGHTHOUSE_POS.z], [beamRadius * 1.45, beamRadius * 0.92, beamLen * 1.15], q1, BEAM_OUTER, 1.0, 'additive')
      pool.add(beamMesh, [LIGHTHOUSE_POS.x, lanternY, LIGHTHOUSE_POS.z], [beamRadius * 0.72, beamRadius * 0.46, beamLen * 0.98], q1, BEAM_INNER, 1.0, 'additive')
      // Soft glowing additive light pool sweeping across the sea/island
      pool.add(drum, [spotX, spotY - 0.34, spotZ], [2.8, 0.04, 2.8], state.beamYaw, BEAM_SPOT, 1.0, 'additive')
      pool.add(drum, [spotX, spotY - 0.32, spotZ], [1.5, 0.04, 1.5], state.beamYaw, BEAM_INNER, 1.0, 'additive')
      if (state.upgrades.lens >= 2) {
        const q2 = quaternionFromEuler(0.32, state.beamYaw + Math.PI, 0)
        pool.add(beamMesh, [LIGHTHOUSE_POS.x, lanternY, LIGHTHOUSE_POS.z], [beamRadius * 1.25, beamRadius * 0.78, beamLen * 0.98], q2, BEAM_OUTER, 1.0, 'additive')
        pool.add(beamMesh, [LIGHTHOUSE_POS.x, lanternY, LIGHTHOUSE_POS.z], [beamRadius * 0.62, beamRadius * 0.40, beamLen * 0.84], q2, BEAM_INNER, 1.0, 'additive')
      }
    }

    // 3. Interactive Ground Pads (translucent glowing rings + soft additive interior disc)
    for (const pad of PADS) {
      let maxGround = islandHeight(pad.x, pad.z)
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2
        maxGround = Math.max(maxGround, islandHeight(pad.x + Math.cos(ang) * pad.radius * 0.85, pad.z + Math.sin(ang) * pad.radius * 0.85))
      }
      const py = maxGround + 0.06
      const active = state.activePad === pad.id
      const pulse = 1 + Math.sin(state.time * 4.2 + pad.x) * (active ? 0.07 : 0.03)
      const padColor = pad.id === 'fuel'
        ? (state.fuel < 30 ? color('ff7d5c') : color('ffe388'))
        : pad.id === 'sell' ? color('7bf0d5')
        : pad.id === 'shop' ? color('f5ad5b')
        : color('ff9a52')
      pool.add(flatRing, [pad.x, py, pad.z], [pad.radius * 0.92 * pulse, 1, pad.radius * 0.92 * pulse], state.time * 0.4, withAlpha(padColor, active ? 0.92 : 0.74), 0.95, 'alpha')
      pool.add(drum, [pad.x, py - 0.01, pad.z], [pad.radius * 0.80 * pulse, 0.03, pad.radius * 0.80 * pulse], 0, withAlpha(padColor, active ? 0.24 : 0.12), 1.0, 'additive')
    }

    // 4. Flickering Warmth Brazier Flame + Warm Additive Firelight Halo
    pool.add(octahedron, [fireX, fireY + 0.18 * flick, fireZ], [0.34, 0.56 * flick, 0.34], state.time * 2.4, FIRE_OUTER, 0.98)
    pool.add(octahedron, [fireX + 0.04, fireY + 0.28 * flick, fireZ - 0.03], [0.20, 0.38 * flick, 0.20], -state.time * 3.4, FIRE_INNER, 1.0)
    pool.add(ovalMesh, [fireX, fireY + 0.24, fireZ], [1.45 * flick, 1.35 * flick, 1.45 * flick], 0, FIRE_HALO, 1.0, 'additive')

    // 5. Wind-Swaying Articulated Coastal Pines (bending with wind speed & gusts!)
    const windStrength = state.weather === 'storm' ? 0.24 : state.weather === 'rain' ? 0.11 : 0.045
    for (const [px, pz, scale, phase] of COASTAL_PINES) {
      const gust = Math.sin(state.time * (state.weather === 'storm' ? 4.2 : 1.7) + phase) * windStrength
      const lean = windStrength * 0.65 + gust
      renderRig(pineRig, { position: [px, islandHeight(px, pz) - 0.05, pz], yaw: phase, scale }, {
        lower: { rotation: [lean * 0.35, 0, -lean * 0.45] },
        mid: { rotation: [lean * 0.55, 0, -lean * 0.70] },
        crown: { rotation: [lean * 0.75, 0, -lean * 0.95] }
      }, pool)
    }

    // 6. Bobbing Offshore Signal Buoys (flashing marine beacon!)
    for (const [bx, bz, phase] of HARBOR_BUOYS) {
      const bob = Math.sin(state.time * 2.1 + phase) * (state.weather === 'storm' ? 0.16 : 0.07)
      const tiltX = Math.sin(state.time * 1.7 + phase) * (state.weather === 'storm' ? 0.24 : 0.09)
      const tiltZ = Math.cos(state.time * 1.5 + phase) * (state.weather === 'storm' ? 0.22 : 0.08)
      const blink = Math.sin(state.time * 3.2 + phase) > 0.25
      renderRig(buoyRig, { position: [bx, waterY + bob, bz], yaw: phase }, {
        float: { rotation: [tiltX, 0, tiltZ] }
      }, pool, (_j, part) => (part.name === 'beacon-lamp' && !blink ? color('365661') : part.color))
    }

    // 7. Animated Harbor Merchant NPC standing beside the Trading Pier Counter
    if (merchantCheerTimer > 0) merchantCheerTimer = Math.max(0, merchantCheerTimer - dt)
    const merchX = PIER_POS.x - 0.58, merchZ = PIER_POS.z - 1.32
    const toKeeperYaw = Math.atan2(state.player.x - merchX, state.player.z - merchZ)
    const cheering = merchantCheerTimer > 0
    const wave = cheering ? Math.sin(state.time * 18) * 0.55 : Math.sin(state.time * 2.3) * 0.14
    const merchBounce = cheering ? Math.abs(Math.sin(state.time * 12)) * 0.20 : Math.sin(state.time * 2.2) * 0.03
    renderRig(merchantRig, { position: [merchX, 0.68 + merchBounce, merchZ], yaw: toKeeperYaw }, {
      torso: { rotation: [0, 0, cheering ? wave * 0.15 : 0] },
      head: { rotation: [cheering ? -0.14 : 0, Math.sin(state.time * 1.4) * 0.16, 0] },
      'left-arm': { rotation: [cheering ? -2.2 + wave : -0.15, 0, cheering ? -0.35 : -0.08] },
      'right-arm': { rotation: [cheering ? -2.2 - wave : -0.35 + wave, 0, cheering ? 0.35 : 0.12] }
    }, pool)

    // 8. Articulated Pier Auto-Salvage Winch Crane
    if (state.upgrades.winch > 0) {
      const cableDrop = Math.sin(state.winchAngle * 2) * 0.35
      const crateSway = Math.cos(state.winchAngle * 2) * 0.18
      renderRig(winchRig, { position: [WINCH_POS.x, 0.68, WINCH_POS.z], yaw: 0 }, {
        turret: { rotation: [0, state.winchAngle, 0] },
        cable: { position: [0, cableDrop, 0], rotation: [crateSway, 0, crateSway * 0.6] }
      }, pool)
    }

    // 9. Collectible Coastal Resources (bobbing, pulsing, and gentle spawn pop-in!)
    for (const item of state.items) {
      const spawnScale = Math.min(1, item.age * 3.5)
      const popScale = spawnScale < 1 ? spawnScale * (1.22 - 0.22 * spawnScale) : 1
      const bob = Math.sin(state.time * 2.8 + item.id) * 0.055
      const floatY = Math.max(item.y, waterY - 0.04) + (item.y < waterY ? bob : bob * 0.35)
      const scale = (item.pulling ? Math.max(0.42, 1 - item.pullT * 0.45) : 0.96) * popScale
      const yaw = item.kind === 'amber' ? item.yaw + state.time * 0.85 : item.yaw + (item.y < waterY ? Math.sin(state.time + item.id) * 0.18 : 0)
      const rig = item.kind === 'amber' ? amberRig : item.kind === 'salvage' ? salvageRig : driftwoodRig
      renderRig(rig, { position: [item.x, floatY, item.z], yaw, scale }, {
        root: { rotation: [item.y < waterY ? Math.sin(state.time * 2.2 + item.id) * 0.14 : 0, 0, 0] }
      }, pool)
    }

    // 10. Articulated Offshore Passing Ships (rocking hull + billowing sail + fluttering pennant!)
    for (const ship of state.ships) {
      const bobY = waterY + 0.18 + Math.sin(ship.bobPhase) * (state.weather === 'storm' ? 0.22 : 0.08)
      const roll = Math.sin(ship.bobPhase * 1.1) * (state.weather === 'storm' ? 0.18 : 0.06)
      const pitch = Math.cos(ship.bobPhase * 0.9) * (state.weather === 'storm' ? 0.12 : 0.04)
      const facing = ship.dir > 0 ? 0 : Math.PI
      const puff = 1 + Math.sin(state.time * 3.6 + ship.id) * (state.weather === 'storm' ? 0.14 : 0.05)
      const flutter = Math.sin(state.time * 12 + ship.id) * (state.weather === 'storm' ? 0.42 : 0.18)
      renderRig(shipRig, { position: [ship.x, bobY, ship.z], yaw: facing, scale: ship.size }, {
        hull: { rotation: [pitch, 0, roll] },
        sail: { scale: [puff, 1, 1] },
        flag: { rotation: [0, flutter, 0] }
      }, pool, (_j, part) => (part.name === 'ship-lantern' && ship.guided ? color('84ffdf') : part.color))
    }

    // 11. Flapping & Gliding Seagulls
    for (let i = 0; i < 4; i++) {
      const a = state.time * (0.48 + i * 0.07) + i * 1.6
      const r = 6.0 + i * 2.5
      const gx = LIGHTHOUSE_POS.x + Math.cos(a) * r
      const gz = LIGHTHOUSE_POS.z + Math.sin(a) * r * 0.85
      const flapCycle = Math.sin(state.time * 0.7 + i * 1.3) > -0.25 // alternate flapping & soaring
      const flap = flapCycle ? Math.sin(state.time * 11 + i * 2) * 0.68 : 0.12
      const gy = 6.2 + i * 0.75 + Math.sin(state.time * 2.5 + i) * 0.35 - (flapCycle ? Math.sin(state.time * 11 + i * 2) * 0.08 : 0)
      renderRig(gullRig, { position: [gx, gy, gz], yaw: -a, scale: 0.78 }, {
        body: { rotation: [0, 0, 0.24] }, // bank smoothly into the turn
        'left-wing': { rotation: [0, 0, flap] },
        'right-wing': { rotation: [0, 0, -flap] }
      }, pool)
    }

    // 12. Articulated Animated Lighthouse Keeper (blended clips + procedural lantern physics + loot stack!)
    drawAnimatedKeeper(state, dt)

    // 13. Emit all 3D particles & parabolic arcs!
    particles.emit(pool)

    // 14. Weather 3D Effects (Translucent Rain streaks & Ethereal Drifting Fog Banks)
    if (state.weather === 'rain' || state.weather === 'storm') {
      const drops = state.weather === 'storm' ? 95 : 54
      const slant = quaternionFromEuler(0.15, 0, state.weather === 'storm' ? -0.34 : -0.18)
      for (let i = 0; i < drops; i++) {
        const seed = i * 37.13
        const rx = ((seed * 1.7 + state.time * (state.weather === 'storm' ? 9.5 : 4.2)) % 34) - 16
        const rz = ((seed * 2.3 + state.time * 2.5) % 24) - 9
        const ry = 11 - ((seed * 3.1 + state.time * 16.5) % 12)
        pool.add(box, [rx, ry, rz], [0.035, 0.90, 0.035], slant, RAIN_COLOR, 0.85, 'alpha')
      }
    }
    if (state.weather === 'fog') {
      for (let i = 0; i < 16; i++) {
        const fx = (((i * 7.3 + state.time * 0.65) % 34) - 17)
        const fz = -6 + (i % 5) * 4.4
        const fy = 0.85 + (i % 3) * 0.75 + Math.sin(state.time * 0.7 + i) * 0.18
        pool.add(ovalMesh, [fx, fy, fz], [3.6 + (i % 3) * 1.2, 0.65, 2.5 + (i % 2) * 1.0], i * 0.6, FOG_COLOR, 0.85, 'alpha')
      }
    }

    // Camera: smooth follow chase cam (or scenic orbit on title screen)
    const canvas = renderer.canvas
    const aspect = Math.max(0.5, canvas.clientWidth / Math.max(1, canvas.clientHeight))
    let eyePos: Vec3
    let lookTarget: Vec3

    if (titleMode) {
      const orbit = state.time * 0.22 + 0.55
      eyePos = [Math.sin(orbit) * 19.5, 12.2, Math.cos(orbit) * 19.5 + 1.2]
      lookTarget = [0.2, 2.2, -1.0]
    } else {
      const targetX = state.player.x * 0.68
      const targetZ = state.player.z * 0.62 + 0.6
      const follow = Math.min(1, dt * 5.5)
      camX += (targetX - camX) * follow
      camZ += (targetZ - camZ) * follow
      const dist = aspect < 0.9 ? 17.5 : 14.2
      eyePos = [camX + dist * 0.42, dist * 0.90, camZ + dist * 0.92]
      lookTarget = [camX, 1.15, camZ - 0.5]
    }

    lastMatrix = multiply(perspective(Math.PI / 3.4, aspect, 0.4, 150), view(eyePos, lookTarget))
    return renderer.render(lastMatrix, [...staticBatches, ...pool.batches], sky)
  }

  function drawAnimatedKeeper(state: GameState, dt: number) {
    const p = state.player
    const speed = Math.hypot(p.vx, p.vz)
    if (celebrateTimer > 0) celebrateTimer = Math.max(0, celebrateTimer - dt)
    if (hopPulse > 0) hopPulse = Math.max(0, hopPulse - dt * 4.5)

    if (celebrateTimer <= 0) {
      if (speed < 0.35) keeperAnim.play('idle', 0.16, 1)
      else if (p.inWater) keeperAnim.play('wade', 0.14, Math.max(0.85, speed / 4.2))
      else if (p.carry.length >= 3) keeperAnim.play('carryRun', 0.12, Math.max(0.9, speed / 5.0))
      else keeperAnim.play('run', 0.12, Math.max(0.9, speed / 5.2))
    }
    keeperAnim.step(dt)

    // Procedural additive squash-and-stretch on pickup + pack upgrade scale + storm wind lean
    const squash = hopPulse > 0 ? Math.sin(hopPulse * Math.PI) : 0
    const packScale = 1 + (state.upgrades.pack - 1) * 0.10
    const stormLean = state.weather === 'storm' ? 0.14 : 0
    const additive: Record<string, JointPose> = {
      hips: {
        position: [0, squash * 0.18, 0],
        scale: [1 - squash * 0.08, 1 + squash * 0.14, 1 - squash * 0.08]
      },
      torso: { rotation: [stormLean, 0, 0] },
      pack: { scale: [packScale, packScale, packScale] }
    }

    const bootTint = BOOT_COLORS[Math.min(4, state.upgrades.boots - 1)]
    const cloakTint = CLOAK_COLORS[Math.min(4, state.upgrades.cloak - 1)]
    const packTint = PACK_COLORS[Math.min(4, state.upgrades.pack - 1)]

    const colorOverride = (jointId: string, part: RigPart): Color => {
      if (part.name === 'coat-body' || part.name === 'coat-hem' || part.name === 'sleeve') return cloakTint
      if (part.name === 'boot') return bootTint
      if (part.name === 'pack-main') return packTint
      if (jointId === 'lantern' && part.name === 'glow') {
        return state.weather === 'clear' ? LAMP_LIT : color('84ffdf')
      }
      return part.color
    }

    const y = Math.max(p.y, state.tideLevel - 0.28)
    const worldJoints = renderRig(
      keeperRig,
      { position: [p.x, y, p.z], yaw: p.yaw, scale: 1.04 },
      keeperAnim.evaluate(additive),
      pool,
      colorOverride
    )

    // Track the swinging handheld lantern bone for our dynamic point light + soft additive glow halo!
    const lb = worldJoints.lantern
    lanternWorldPos = [lb.position[0], lb.position[1] - 0.24, lb.position[2]]
    const lanternHaloCol: Color = state.weather === 'clear' ? [1.0, 0.90, 0.58, 0.18] : [0.50, 0.98, 0.88, 0.24]
    pool.add(ovalMesh, lanternWorldPos, [0.72, 0.72, 0.72], 0, lanternHaloCol, 1.0, 'additive')

    // Attach visible swaying loot stack directly onto the evaluated `pack` bone!
    const packBone = worldJoints.pack
    const visibleCarry = Math.min(10, p.carry.length)
    const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw)
    for (let i = 0; i < visibleCarry; i++) {
      const kind = p.carry[i]
      const sway = Math.sin(state.time * 7 + i * 0.6) * (speed * 0.008) * (i + 1)
      const backOff = -0.26 - (i % 2) * 0.04
      const sx = packBone.position[0] + (sway * cos + backOff * sin)
      const sy = packBone.position[1] + 0.16 + i * 0.21
      const sz = packBone.position[2] + (backOff * cos - sway * sin)
      if (kind === 'driftwood') {
        pool.add(drum, [sx, sy, sz], [0.11, 0.56, 0.11], quaternionFromEuler(0, p.yaw, Math.PI / 2), color('a37148'))
      } else if (kind === 'salvage') {
        pool.add(softBox, [sx, sy, sz], [0.38, 0.22, 0.30], p.yaw, color('df7c45'))
      } else {
        pool.add(octahedron, [sx, sy, sz], [0.20, 0.22, 0.20], p.yaw + i, color('7fffe4'), 0.80)
      }
    }
  }

  function projectScreen(x: number, y: number, z: number, width: number, height: number) {
    return worldToScreen(lastMatrix, x, y, z, width, height)
  }

  function dispose() {
    for (const batch of staticBatches) renderer.release(batch)
    pool.release(renderer)
  }

  return { render, projectScreen, dispose }
}
