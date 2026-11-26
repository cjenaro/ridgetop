// Crownshard battle VFX choreography: bespoke low-poly 3D effects per hero skill, tactic card,
// enemy signature move, weapon-specific basic attack, and directional impact. Pure presentation:
// it reads VfxEvent payloads and writes instances into the scene's MeshPool / particle system.
//
// Every effect is a timed draw callback (delay -> life) so effects can be sequenced against the
// caster's clip impact time (CLIP_IMPACT) instead of all popping on the frame the sim resolves.
import { box, color, crescentMesh, cylinder, mesh, quaternionFromEuler, revolvedMesh, rotateVec3, tubeMesh } from 'ridgetop'
import type { Color, Mesh, MeshPool, Quaternion, Vec3, createParticles } from 'ridgetop'
import { crystalMesh, flatRing, roundPebble } from './art.ts'
import { TILE_SIZE } from './types.ts'

type Particles = ReturnType<typeof createParticles>
export type VfxStyle = 'slash' | 'arrow' | 'arcane' | 'fire' | 'frost' | 'holy' | 'shadow' | 'gold'

// ------------------------------------------------------------------ palette
export const VFX_COLORS = {
  fire: color('ff8f38'),
  fireTip: color('ffe980'),
  ember: color('ff5a1f'),
  frost: color('84e8ff'),
  ice: color('d8f8ff'),
  arcane: color('ad84ff'),
  holy: color('fff0a0'),
  gold: color('ffd45c'),
  shadow: color('cc64ff'),
  void: color('3a1458'),
  heal: color('68ffa8'),
  steel: color('a8c8ff'),
  wind: color('c8fff4'),
  lightning: color('e8f4ff'),
  arrow: color('f1dfb4'),
  blood: color('ff5470'),
  taunt: color('ff5944'),
  haste: color('42f5d4'),
  poison: color('8dff4f'),
  venom: color('b44cff'),
  white: color('ffffff')
} as const

export function styleColor(style: VfxStyle): Color {
  if (style === 'fire') return VFX_COLORS.fire
  if (style === 'frost') return VFX_COLORS.frost
  if (style === 'arcane') return VFX_COLORS.arcane
  if (style === 'holy' || style === 'gold') return VFX_COLORS.holy
  if (style === 'shadow') return VFX_COLORS.shadow
  return VFX_COLORS.fireTip
}

// ------------------------------------------------------------------ meshes
function doubleSided(build: (tri: (a: Vec3, b: Vec3, c: Vec3) => void) => void): Mesh {
  const pos: number[] = []
  const idx: number[] = []
  build((a, b, c) => {
    const n = pos.length / 3
    pos.push(...a, ...b, ...c, ...a, ...c, ...b)
    idx.push(n, n + 1, n + 2, n + 3, n + 4, n + 5)
  })
  return mesh(pos, idx)
}

/** Double-sided low-poly arrow pointing down +Z (length 1, centred on origin). */
export const arrowMesh = doubleSided(tri => {
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => { tri(a, b, c); tri(a, c, d) }
  const w = 0.035
  const z0 = -0.5, z1 = 0.24
  const corners: Vec3[] = [[-w, -w, 0], [w, -w, 0], [w, w, 0], [-w, w, 0]]
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4]
    quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1])
  }
  const h = 0.10
  const base: Vec3[] = [[-h, -h, z1], [h, -h, z1], [h, h, z1], [-h, h, z1]]
  for (let i = 0; i < 4; i++) tri(base[i], base[(i + 1) % 4], [0, 0, 0.5])
  quad(base[0], base[1], base[2], base[3])
  quad([-0.11, 0, -0.50], [0.11, 0, -0.50], [0.05, 0, -0.30], [-0.05, 0, -0.30])
  quad([0, -0.11, -0.50], [0, 0.11, -0.50], [0, 0.05, -0.30], [0, -0.05, -0.30])
})

const slashArc = crescentMesh(Math.PI * 0.95, 0.60, 1, 14)
const slashWide = crescentMesh(Math.PI * 1.35, 0.66, 1, 18)
const slashWhirl = crescentMesh(Math.PI * 1.85, 0.74, 1, 26)
const beamMesh = cylinder(10, 1, 1)
const spikeMesh = cylinder(5, 0, 1)
const shardMesh = cylinder(4, 0, 1)
const domeMesh = revolvedMesh([[1, 0], [0.96, 0.28], [0.84, 0.55], [0.62, 0.79], [0.33, 0.95], [0, 1]], 14)
/** Flat double-sided disc (scorch marks). */
const discMesh = doubleSided(tri => {
  const n = 14
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
    tri([0, 0, 0], [Math.cos(a0), 0, Math.sin(a0)], [Math.cos(a1), 0, Math.sin(a1)])
  }
})
const flagMesh = doubleSided(tri => {
  tri([0, 0, 0], [0, -0.55, 0], [0.62, -0.1, 0])
  tri([0, 0, 0], [0.62, -0.1, 0], [0.70, 0.02, 0])
})
/** Three pre-baked jagged lightning bolts (unit height, y 0 -> 1). */
const boltMeshes: Mesh[] = [0, 1, 2].map(seed => {
  const pts: Vec3[] = []
  let s = seed * 9301 + 49297
  const rnd = () => { s = (s * 233280 + 49297) % 233280; return s / 233280 - 0.5 }
  for (let i = 0; i <= 7; i++) {
    const t = i / 7
    const j = i === 0 || i === 7 ? 0 : 0.16
    pts.push([rnd() * j * 2, 1 - t, rnd() * j * 2])
  }
  return tubeMesh(pts, [0.03, 0.05, 0.045, 0.05, 0.04, 0.045, 0.035, 0.02], 4)
})

// ------------------------------------------------------------------ helpers
const easeOut = (u: number) => 1 - (1 - u) * (1 - u)
const easeIn = (u: number) => u * u
const pulse = (u: number) => Math.sin(Math.min(1, Math.max(0, u)) * Math.PI)
const pos = (n: number) => Math.max(0.012, n)

function withAlpha(c: Color, a: number): Color {
  return [c[0], c[1], c[2], Math.max(0, Math.min(1, (c[3] ?? 1) * a))]
}
function rot(pitch: number, yaw: number, roll: number): Quaternion {
  return quaternionFromEuler(pitch, yaw, roll)
}
function lerp3(a: Vec3, b: Vec3, t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
export function yawBetween(from: Vec3, to: Vec3, fallback = 0): number {
  const dx = to[0] - from[0], dz = to[2] - from[2]
  return Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : fallback
}

interface Effect {
  delay: number
  t: number
  life: number
  draw: ((u: number, t: number) => void) | null
  fire: (() => void) | null
}

export interface SkillVfxInput {
  readonly skillId: string
  readonly style: VfxStyle
  readonly from: Vec3
  readonly at: Vec3
  readonly cells: readonly Vec3[]
}

export interface TacticVfxInput {
  readonly tacticId: string
  readonly style: VfxStyle
  readonly at: Vec3
  readonly cells: readonly Vec3[]
}

/** Shape of a basic-attack strike trail, keyed off the attacker's clip. */
export type StrikeShape = 'slash' | 'overhead' | 'diagonal' | 'thrust' | 'twin' | 'mace' | 'pound' | 'dark'

export function createBattleVfx(pool: MeshPool, particles: Particles, onShake: (amount: number) => void) {
  const effects: Effect[] = []

  function add(delay: number, life: number, draw: (u: number, t: number) => void) {
    effects.push({ delay: Math.max(0, delay), t: 0, life: Math.max(0.02, life), draw, fire: null })
  }
  function later(delay: number, fire: () => void) {
    effects.push({ delay: Math.max(0, delay), t: 0, life: 0, draw: null, fire })
  }

  // ---------------------------------------------------------------- primitives
  function sparks(at: Vec3, col: Color, count: number, speed: number, delay = 0, up = 1.4) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + at[0] * 1.7
      particles.spawn({
        mesh: crystalMesh,
        blend: 'additive',
        position: at,
        velocity: [Math.cos(a) * speed, up + (i % 3) * 0.5, Math.sin(a) * speed],
        gravity: 4.2,
        spin: 10,
        scale: [0.09, 0.13, 0.09],
        endScale: 0.1,
        color: col,
        unlit: 1,
        life: 0.38,
        delay
      })
    }
  }

  function motes(at: Vec3, col: Color, count: number, radius: number, rise: number, delay = 0, life = 0.9) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      particles.spawn({
        mesh: crystalMesh,
        blend: 'additive',
        position: [at[0] + Math.cos(a) * radius, at[1] + 0.1 + (i % 3) * 0.12, at[2] + Math.sin(a) * radius],
        velocity: [-Math.sin(a) * 0.3, rise + (i % 4) * 0.25, Math.cos(a) * 0.3],
        spin: 6,
        scale: [0.07, 0.11, 0.07],
        endScale: 0.15,
        color: col,
        unlit: 1,
        life,
        delay: delay + (i % 5) * 0.03
      })
    }
  }

  function dust(at: Vec3, count: number, strength: number, delay = 0) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + at[2]
      particles.spawn({
        mesh: roundPebble,
        blend: 'alpha',
        alphaFade: true,
        position: [at[0] + Math.cos(a) * 0.2, at[1] + 0.06, at[2] + Math.sin(a) * 0.2],
        velocity: [Math.cos(a) * 1.0 * strength, 0.4 + 0.3 * strength, Math.sin(a) * 1.0 * strength],
        gravity: 0.6,
        drag: 3,
        scale: [0.13, 0.09, 0.13],
        endScale: 2.2,
        color: [0.86, 0.80, 0.70, 0.55],
        unlit: 0.3,
        life: 0.5 + 0.15 * strength,
        delay
      })
    }
  }

  function embers(at: Vec3, count: number, spread: number, delay = 0, col: Color = VFX_COLORS.fire) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + i * 1.3
      const r = spread * (0.3 + ((i * 37) % 10) / 14)
      particles.spawn({
        mesh: crystalMesh,
        blend: 'additive',
        position: [at[0] + Math.cos(a) * r, at[1] + 0.1, at[2] + Math.sin(a) * r],
        velocity: [Math.cos(a) * 0.2, 1.2 + (i % 4) * 0.4, Math.sin(a) * 0.2],
        gravity: -0.4,
        spin: 8,
        scale: [0.06, 0.09, 0.06],
        endScale: 0.1,
        color: i % 3 === 0 ? VFX_COLORS.fireTip : col,
        unlit: 1,
        life: 0.7,
        delay: delay + (i % 6) * 0.04
      })
    }
  }

  /** Expanding flat ground ring (shockwave, rune circle, scorch outline). */
  function groundRing(at: Vec3, col: Color, delay: number, life: number, from: number, to: number, spin = 0, blend: 'additive' | 'alpha' = 'additive') {
    add(delay, life, (u, t) => {
      const r = from + (to - from) * easeOut(u)
      pool.add(flatRing, [at[0], at[1] + 0.07, at[2]], [pos(r), 1, pos(r)], spin * t, withAlpha(col, 1 - u), 1, blend)
    })
  }

  /** Crescent slash trail that sweeps open and fades; `at` is where the middle of the arc passes (the blow). */
  function slash(at: Vec3, yaw: number, col: Color, delay: number, opts: { radius?: number; roll?: number; pitch?: number; life?: number; mesh?: Mesh; sweep?: number } = {}) {
    const r = opts.radius ?? 0.9
    const life = opts.life ?? 0.26
    const m = opts.mesh ?? slashArc
    const sweep = opts.sweep ?? 0.9
    add(delay, life, u => {
      const open = easeOut(Math.min(1, u * 2.2))
      const s = r * (0.75 + 0.35 * open)
      const q = rot(opts.pitch ?? 0, yaw + (open - 0.5) * sweep, opts.roll ?? 0)
      const f = rotateVec3(q, [0, 0, s * 0.9])
      const o: Vec3 = [at[0] - f[0], at[1] - f[1], at[2] - f[2]]
      pool.add(m, o, [pos(s), 1, pos(s)], q, withAlpha(col, 1 - easeIn(u)), 1, 'additive')
      pool.add(m, o, [pos(s * 0.86), 1, pos(s * 0.86)], q, withAlpha(VFX_COLORS.white, 0.7 * (1 - u)), 1, 'additive')
    })
  }

  /** Light pillar that slams down from the sky, flares, and thins out. */
  function beam(at: Vec3, col: Color, delay: number, opts: { radius?: number; height?: number; life?: number } = {}) {
    const r = opts.radius ?? 0.36
    const h = opts.height ?? 5.5
    const life = opts.life ?? 0.7
    add(delay, life, u => {
      const drop = easeIn(Math.min(1, u * 5))
      const len = h * drop
      const thin = u < 0.25 ? 1 : 1 - (u - 0.25) / 0.75
      const y = at[1] + h - len / 2
      pool.add(beamMesh, [at[0], y, at[2]], [pos(r * thin), pos(len), pos(r * thin)], u * 3, withAlpha(col, 0.85 * thin), 1, 'additive')
      pool.add(beamMesh, [at[0], y, at[2]], [pos(r * 0.4 * thin), pos(len), pos(r * 0.4 * thin)], 0, withAlpha(VFX_COLORS.white, thin), 1, 'additive')
    })
    later(delay + life * 0.2, () => {
      groundRing(at, col, 0, 0.5, 0.2, r * 4.2)
      sparks([at[0], at[1] + 0.2, at[2]], col, 8, 1.4)
    })
  }

  /** Expanding translucent shield dome with a rotating rune ring at its base. */
  function dome(at: Vec3, col: Color, delay: number, radius: number, life = 1.0) {
    add(delay, life, (u, t) => {
      const grow = easeOut(Math.min(1, u * 3.2))
      const fade = u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1
      const r = radius * (0.4 + 0.6 * grow)
      pool.add(domeMesh, [at[0], at[1] + 0.02, at[2]], [pos(r), pos(r * 0.82), pos(r)], t * 0.8, withAlpha(col, 0.30 * fade), 0.9, 'alpha')
      pool.add(flatRing, [at[0], at[1] + 0.08, at[2]], [pos(r * 1.02), 1, pos(r * 1.02)], t * 1.6, withAlpha(col, 0.95 * fade), 1, 'additive')
      pool.add(flatRing, [at[0], at[1] + 0.09, at[2]], [pos(r * 0.7), 1, pos(r * 0.7)], -t * 2.4, withAlpha(VFX_COLORS.white, 0.7 * fade), 1, 'additive')
      for (let i = 0; i < 6; i++) {
        const a = t * 1.6 + (i / 6) * Math.PI * 2
        pool.add(crystalMesh, [at[0] + Math.cos(a) * r * 0.86, at[1] + 0.16, at[2] + Math.sin(a) * r * 0.86],
          [0.07, 0.13, 0.07], a, withAlpha(col, fade), 1, 'additive')
      }
    })
  }

  /** Jagged spires erupting from the ground in a ring (ice, holy shards, ground shatter). */
  function spires(at: Vec3, col: Color, delay: number, opts: { count?: number; radius?: number; height?: number; life?: number; tilt?: number; seed?: number } = {}) {
    const count = opts.count ?? 5
    const radius = opts.radius ?? 0.35
    const height = opts.height ?? 0.9
    const life = opts.life ?? 0.85
    const tilt = opts.tilt ?? 0.35
    const seed = opts.seed ?? (at[0] * 3.1 + at[2] * 1.7)
    add(delay, life, u => {
      const up = u < 0.18 ? easeOut(u / 0.18) : u > 0.75 ? 1 - easeIn((u - 0.75) / 0.25) : 1
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + seed
        const h = height * (0.6 + ((i * 53 + Math.floor(seed * 10)) % 7) / 14) * up
        const rr = radius * (i % 2 === 0 ? 1 : 0.6)
        pool.add(spikeMesh,
          [at[0] + Math.cos(a) * rr, at[1] + h * 0.5 - 0.05, at[2] + Math.sin(a) * rr],
          [pos(0.13 * (0.7 + up * 0.3)), pos(h), pos(0.13 * (0.7 + up * 0.3))],
          rot(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt), withAlpha(col, 0.92), 0.85, 'alpha')
      }
      if (count > 2) {
        pool.add(spikeMesh, [at[0], at[1] + height * 0.6 * up - 0.05, at[2]], [pos(0.18 * up), pos(height * 1.25 * up), pos(0.18 * up)], seed, withAlpha(col, 0.95), 0.85, 'alpha')
      }
    })
    later(delay, () => {
      sparks([at[0], at[1] + 0.25, at[2]], col, 6, 1.6)
      groundRing(at, col, 0, 0.45, 0.2, radius * 3.2)
    })
  }

  /** Sky-to-ground lightning strike with a white flash and ground scorch. */
  function bolt(at: Vec3, col: Color, delay: number, height = 6) {
    add(delay, 0.32, (u, t) => {
      const flick = (Math.floor(t * 40) % 2) === 0 ? 1 : 0.55
      const m = boltMeshes[Math.floor(t * 25) % boltMeshes.length]
      pool.add(m, [at[0], at[1], at[2]], [1.4, height, 1.4], t * 9, withAlpha(col, flick * (1 - u)), 1, 'additive')
      pool.add(m, [at[0], at[1], at[2]], [0.7, height, 0.7], -t * 7, withAlpha(VFX_COLORS.white, flick * (1 - u)), 1, 'additive')
    })
    later(delay, () => {
      onShake(0.12)
      sparks([at[0], at[1] + 0.15, at[2]], col, 9, 2.2)
      groundRing(at, VFX_COLORS.white, 0, 0.3, 0.1, 1.0)
      scorch(at, 1.2)
    })
  }

  /** Lingering dark scorch disc on the ground. */
  function scorch(at: Vec3, life: number, radius = 0.5) {
    add(0, life, u => {
      pool.add(discMesh, [at[0], at[1] + 0.05, at[2]], [radius, 1, radius], at[0], [0.08, 0.05, 0.04, 0.55 * (1 - u)], 0, 'alpha')
    })
  }

  /** Meteor plunging diagonally from the sky onto a tile. */
  function meteor(at: Vec3, col: Color, delay: number, life = 0.42, skew = 1) {
    const start: Vec3 = [at[0] - 2.2 * skew, at[1] + 6.5, at[2] - 1.4]
    add(delay, life, (u, t) => {
      const p = lerp3(start, [at[0], at[1] + 0.2, at[2]], easeIn(u))
      pool.add(crystalMesh, p, [0.32, 0.32, 0.32], t * 14, VFX_COLORS.fireTip, 1)
      pool.add(crystalMesh, p, [0.58, 0.58, 0.58], -t * 10, withAlpha(col, 0.8), 1, 'additive')
      particles.spawn({
        mesh: crystalMesh, blend: 'additive', position: p, velocity: [0.3, 0.6, 0.2], spin: 8,
        scale: [0.2, 0.2, 0.2], endScale: 0.05, color: col, unlit: 1, life: 0.3
      })
    })
    later(delay + life, () => {
      onShake(0.08)
      sparks([at[0], at[1] + 0.2, at[2]], VFX_COLORS.fireTip, 10, 2.4, 0, 2.0)
      groundRing(at, col, 0, 0.45, 0.2, 1.3)
      embers(at, 6, 0.4)
      scorch(at, 1.6, 0.55)
    })
  }

  /** Arrows plunging from the sky onto a tile (Volley Rain). */
  function arrowRain(at: Vec3, delay: number, count: number) {
    for (let i = 0; i < count; i++) {
      const a = i * 2.4 + at[0]
      const off: Vec3 = [Math.cos(a) * 0.32 * ((i % 3) / 2), 0, Math.sin(a) * 0.32 * ((i % 3) / 2)]
      const land: Vec3 = [at[0] + off[0], at[1] + 0.2, at[2] + off[2]]
      const start: Vec3 = [land[0] - 0.8, land[1] + 5, land[2] - 0.5]
      const d = delay + i * 0.06
      const pitch = -Math.atan2(5, Math.hypot(0.8, 0.5))
      const yaw = Math.atan2(0.8, 0.5)
      add(d, 0.24, u => {
        pool.add(arrowMesh, lerp3(start, land, easeIn(u)), [0.85, 0.85, 0.7], rot(-pitch, yaw, 0), VFX_COLORS.arrow, 0.4)
      })
      // stuck arrow lingers in the ground
      add(d + 0.24, 0.8, u => {
        pool.add(arrowMesh, [land[0], land[1] + 0.05, land[2]], [0.85, 0.85, 0.7], rot(-pitch, yaw, 0), withAlpha(VFX_COLORS.arrow, 1 - easeIn(u)), 0.4, u > 0.6 ? 'alpha' : 'opaque')
      })
      later(d + 0.24, () => dust(land, 2, 0.5))
    }
  }

  /** Smoke puff (shadow vanish / reappear). */
  function smoke(at: Vec3, delay: number, col: Color = [0.24, 0.12, 0.34, 0.75], count = 12) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      particles.spawn({
        mesh: roundPebble,
        blend: 'alpha',
        alphaFade: true,
        position: [at[0] + Math.cos(a) * 0.15, at[1] + 0.3 + (i % 3) * 0.3, at[2] + Math.sin(a) * 0.15],
        velocity: [Math.cos(a) * 1.3, 0.5 + (i % 4) * 0.25, Math.sin(a) * 1.3],
        drag: 4,
        gravity: -0.5,
        scale: [0.22, 0.2, 0.22],
        endScale: 2.6,
        color: col,
        unlit: 0.6,
        life: 0.6,
        delay
      })
    }
    sparks([at[0], at[1] + 0.7, at[2]], VFX_COLORS.shadow, 5, 1.2, delay)
  }

  /** Straight glowing streak between two points (sniper trail, thrust, conduit). */
  function streak(from: Vec3, to: Vec3, col: Color, delay: number, life: number, width = 0.06) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
    const len = Math.max(0.05, Math.hypot(dx, dy, dz))
    const yaw = Math.atan2(dx, dz)
    const pitch = -Math.atan2(dy, Math.hypot(dx, dz))
    const mid = lerp3(from, to, 0.5)
    const q = rot(pitch + Math.PI / 2, yaw, 0)
    add(delay, life, u => {
      const w = width * (1 - u)
      pool.add(beamMesh, mid, [pos(w), len, pos(w)], q, withAlpha(col, 1 - u), 1, 'additive')
      pool.add(beamMesh, mid, [pos(w * 0.4), len, pos(w * 0.4)], q, withAlpha(VFX_COLORS.white, 1 - u), 1, 'additive')
    })
  }

  /** Oriented projectile flying from -> to (arrow, ice lance, arcane lance, sun spear). */
  function lance(from: Vec3, to: Vec3, col: Color, delay: number, life: number, kind: 'arrow' | 'shard' | 'orb', size = 1, peak = 0.15) {
    add(delay, life, (u, t) => {
      const p = lerp3(from, to, u)
      p[1] += Math.sin(u * Math.PI) * peak
      const dx = to[0] - from[0], dz = to[2] - from[2]
      const vy = to[1] - from[1] + Math.cos(u * Math.PI) * Math.PI * peak
      const yaw = Math.atan2(dx, dz)
      const pitch = -Math.atan2(vy, Math.hypot(dx, dz))
      if (kind === 'arrow') {
        pool.add(arrowMesh, p, [1.1 * size, 1.1 * size, 1.0 * size], rot(pitch, yaw, 0), VFX_COLORS.arrow, 0.5)
        pool.add(arrowMesh, p, [1.6 * size, 1.6 * size, 1.3 * size], rot(pitch, yaw, 0), withAlpha(col, 0.55), 1, 'additive')
      } else if (kind === 'shard') {
        const q = rot(pitch + Math.PI / 2, yaw, 0)
        pool.add(shardMesh, p, [0.14 * size, 0.85 * size, 0.14 * size], q, withAlpha(col, 0.95), 0.9, 'alpha')
        pool.add(shardMesh, p, [0.22 * size, 1.05 * size, 0.22 * size], q, withAlpha(VFX_COLORS.white, 0.5), 1, 'additive')
      } else {
        const s = 0.24 * size + Math.sin(t * 40) * 0.03
        pool.add(crystalMesh, p, [s, s, s], t * 14, col, 1)
        pool.add(crystalMesh, p, [s * 1.8, s * 1.8, s * 1.8], -t * 9, withAlpha(col, 0.7), 1, 'additive')
      }
      particles.spawn({
        mesh: crystalMesh, blend: 'additive', position: p,
        velocity: [Math.sin(t * 31) * 0.3, 0.25, Math.cos(t * 29) * 0.3], spin: 8,
        scale: [0.13 * size, 0.13 * size, 0.13 * size], endScale: 0.05, color: col, unlit: 1, life: 0.24
      })
    })
  }

  /** Spinning shards flying radially outward (Fan of Blades, Ice burst). */
  function radialShards(at: Vec3, col: Color, delay: number, count: number, dist: number, life = 0.38) {
    add(delay, life, (u, t) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + t * 2
        const r = 0.3 + dist * easeOut(u)
        const p: Vec3 = [at[0] + Math.sin(a) * r, at[1] + 0.85, at[2] + Math.cos(a) * r]
        pool.add(shardMesh, p, [0.08, 0.42, 0.08], rot(Math.PI / 2 + t * 30, a, 0), withAlpha(col, 1 - u * 0.6), 1, 'additive')
        pool.add(shardMesh, p, [0.05, 0.34, 0.05], rot(Math.PI / 2 + t * 30, a, 0), VFX_COLORS.steel, 0.6)
      }
    })
  }

  /** Trail of fading echoes along a dash (afterimages / phoenix flame wake). */
  function dashTrail(from: Vec3, to: Vec3, col: Color, delay: number, steps: number, kind: 'shadow' | 'fire') {
    for (let i = 0; i < steps; i++) {
      const u = (i + 0.5) / steps
      const p = lerp3(from, to, u)
      const d = delay + u * 0.14
      if (kind === 'shadow') {
        add(d, 0.42, v => {
          const s = 1 - v * 0.5
          pool.add(crystalMesh, [p[0], p[1] + 0.8, p[2]], [pos(0.34 * s), pos(0.9 * s), pos(0.34 * s)], 0, withAlpha(col, 0.45 * (1 - v)), 0.9, 'additive')
          pool.add(roundPebble, [p[0], p[1] + 1.45, p[2]], [pos(0.26 * s), pos(0.26 * s), pos(0.26 * s)], 0, withAlpha(col, 0.35 * (1 - v)), 0.9, 'additive')
        })
      } else {
        embers(p, 4, 0.25, d)
        add(d, 0.4, v => {
          pool.add(crystalMesh, [p[0], p[1] + 0.35 + v * 0.6, p[2]], [pos(0.3 * (1 - v)), pos(0.55 * (1 - v)), pos(0.3 * (1 - v))], v * 6, withAlpha(col, 1 - v), 1, 'additive')
        })
      }
    }
  }

  /** Converging charge-up motes spiralling into a point (boss charge, channel). */
  function converge(at: Vec3, col: Color, duration: number, radius: number) {
    add(0, duration, (u, t) => {
      for (let i = 0; i < 8; i++) {
        const a = t * 5 + (i / 8) * Math.PI * 2
        const r = radius * (1 - easeIn(u))
        pool.add(crystalMesh, [at[0] + Math.cos(a) * r, at[1] + Math.sin(t * 7 + i) * 0.2 * (1 - u), at[2] + Math.sin(a) * r],
          [0.10, 0.15, 0.10], a, withAlpha(col, 0.4 + 0.6 * u), 1, 'additive')
      }
      const core = 0.12 + 0.4 * easeIn(u)
      pool.add(roundPebble, at, [core, core, core], t * 3, withAlpha(col, 0.9), 1, 'additive')
    })
  }

  // ---------------------------------------------------------------- basic attack strikes
  /** Weapon-specific strike trail at the target, oriented along the attack direction. */
  function strike(shape: StrikeShape, from: Vec3, at: Vec3, delay: number) {
    const yaw = yawBetween(from, at)
    const chest: Vec3 = [at[0], at[1] + 0.85, at[2]]
    const near: Vec3 = lerp3([from[0], from[1] + 0.85, from[2]], chest, 0.72)
    if (shape === 'slash') {
      slash(near, yaw, VFX_COLORS.fireTip, delay, { radius: 0.8, roll: 0.25 })
    } else if (shape === 'overhead') {
      slash(near, yaw, VFX_COLORS.holy, delay, { radius: 0.85, roll: Math.PI / 2, sweep: 0.3 })
    } else if (shape === 'diagonal') {
      slash(near, yaw, VFX_COLORS.fireTip, delay, { radius: 1.0, roll: 0.9, life: 0.32 })
      later(delay, () => onShake(0.08))
    } else if (shape === 'dark') {
      slash(near, yaw, VFX_COLORS.shadow, delay, { radius: 1.1, roll: -0.8, life: 0.38, mesh: slashWide })
      later(delay, () => { smoke(chest, 0, [0.2, 0.06, 0.28, 0.6], 6); onShake(0.08) })
    } else if (shape === 'thrust') {
      streak([from[0], from[1] + 0.9, from[2]], chest, VFX_COLORS.fireTip, delay, 0.16, 0.08)
      later(delay, () => groundRing(chest, VFX_COLORS.fireTip, 0, 0.22, 0.1, 0.45))
    } else if (shape === 'twin') {
      slash(near, yaw, VFX_COLORS.steel, delay, { radius: 0.6, roll: 0.7, life: 0.2 })
      slash(near, yaw, VFX_COLORS.steel, delay + 0.09, { radius: 0.6, roll: -0.7, life: 0.2 })
    } else if (shape === 'mace') {
      later(delay, () => {
        groundRing(chest, VFX_COLORS.holy, 0, 0.26, 0.15, 0.7)
        sparks(chest, VFX_COLORS.holy, 7, 1.6)
      })
    } else if (shape === 'pound') {
      later(delay, () => {
        onShake(0.28)
        groundRing(at, VFX_COLORS.ice, 0, 0.5, 0.3, 2.2, 0, 'alpha')
        groundRing(at, VFX_COLORS.white, 0.06, 0.4, 0.2, 1.5)
        dust(at, 10, 1.6)
        spires(at, VFX_COLORS.ice, 0.02, { count: 4, radius: 0.55, height: 0.5, life: 0.6 })
      })
    }
    if (shape !== 'pound' && shape !== 'mace') later(delay, () => sparks(chest, VFX_COLORS.fireTip, 4, 1.1))
  }

  // ---------------------------------------------------------------- hero skills
  function skill(ev: SkillVfxInput, d: number): number {
    const { from, at, cells } = ev
    const yaw = yawBetween(from, at)
    const hand: Vec3 = [from[0], from[1] + 1.05, from[2]]
    const chest: Vec3 = [at[0], at[1] + 0.85, at[2]]
    const front: Vec3 = [from[0] + Math.sin(yaw) * 0.9, from[1] + 0.85, from[2] + Math.cos(yaw) * 0.9]
    const C = VFX_COLORS
    switch (ev.skillId) {
      // ---------------- Sir Aldric (Knight)
      case 'shield_bash':
        later(d, () => {
          onShake(0.14)
          groundRing(chest, C.steel, 0, 0.3, 0.2, 1.0)
          sparks(chest, C.white, 9, 2.2)
        })
        slash(lerp3(hand, chest, 0.7), yaw, C.steel, d, { radius: 0.55, pitch: Math.PI / 2, sweep: 0.2, life: 0.2 })
        return d
      case 'bulwark_aura':
        dome(from, C.steel, d, TILE_SIZE * 1.3, 1.2)
        for (const c of cells) groundRing(c, C.frost, d + 0.1, 0.6, 0.2, 0.75, 2)
        later(d, () => { dust(from, 8, 1.2); onShake(0.1) })
        return d
      case 'solar_cleave':
        add(d - 0.06, 0.5, (u, t) => {
          const s = 1.2 + 0.4 * easeOut(u)
          pool.add(slashWhirl, [from[0], from[1] + 0.8, from[2]], [s, 1, s], yaw + t * 16, withAlpha(C.gold, 1 - easeIn(u)), 1, 'additive')
          pool.add(slashWhirl, [from[0], from[1] + 0.65, from[2]], [s * 0.85, 1, s * 0.85], yaw + t * 16 + 0.6, withAlpha(C.fire, 0.8 * (1 - u)), 1, 'additive')
        })
        groundRing(from, C.gold, d, 0.5, 0.4, 2.4, 1.5)
        later(d, () => { embers(from, 10, 1.2); onShake(0.16) })
        return d
      // ---------------- Lyra (Archer)
      case 'piercing_arrow': {
        const end: Vec3 = cells.length ? cells[cells.length - 1] : at
        lance(hand, [end[0], end[1] + 0.8, end[2]], C.gold, d, 0.2, 'arrow', 1.35, 0.05)
        streak(hand, [end[0], end[1] + 0.8, end[2]], C.gold, d + 0.05, 0.4, 0.07)
        cells.forEach((c, i) => later(d + 0.06 + i * 0.04, () => { sparks([c[0], c[1] + 0.8, c[2]], C.gold, 6, 1.8); groundRing([c[0], c[1] + 0.75, c[2]], C.gold, 0, 0.25, 0.1, 0.55) }))
        return d + 0.2
      }
      case 'volley_rain':
        for (let i = 0; i < 4; i++) {
          lance(hand, [from[0] + (i - 1.5) * 0.3, from[1] + 6, from[2] - 0.6], C.arrow, d + i * 0.04, 0.3, 'arrow', 0.9, 0)
        }
        cells.forEach((c, i) => arrowRain(c, d + 0.38 + i * 0.05, 4))
        return d + 0.6
      case 'hawks_snipe':
        lance(hand, chest, C.frost, d, 0.1, 'arrow', 1.2, 0)
        streak(hand, chest, C.ice, d, 0.6, 0.05)
        later(d + 0.1, () => {
          onShake(0.16)
          groundRing(chest, C.white, 0, 0.3, 0.1, 0.9)
          groundRing(at, C.frost, 0, 0.5, 0.2, 1.2)
          sparks(chest, C.white, 10, 2.6)
        })
        return d + 0.1
      // ---------------- Vesper (Mage)
      case 'arcane_bolt':
        lance(hand, chest, C.arcane, d, 0.26, 'shard', 1.6, 0.1)
        later(d + 0.26, () => {
          groundRing(chest, C.arcane, 0, 0.35, 0.2, 0.9)
          spires(at, C.arcane, 0, { count: 3, radius: 0.3, height: 0.6, life: 0.5 })
        })
        return d + 0.26
      case 'ember_nova':
        later(d, () => { onShake(0.16); embers(at, 14, 1.4) })
        groundRing(at, C.fire, d, 0.55, 0.3, TILE_SIZE * 1.9, 0, 'additive')
        groundRing(at, C.fireTip, d + 0.08, 0.45, 0.2, TILE_SIZE * 1.4)
        cells.forEach((c, i) => {
          add(d + 0.05 + i * 0.03, 0.55, (u, t) => {
            const h = 1.2 * pulse(u)
            pool.add(crystalMesh, [c[0], c[1] + h * 0.5, c[2]], [pos(0.35 * pulse(u)), pos(h), pos(0.35 * pulse(u))], t * 8, withAlpha(C.fire, 1), 1, 'additive')
          })
          scorch(c, 1.4, 0.6)
        })
        return d
      case 'starfall':
        cells.forEach((c, i) => meteor(c, C.fire, d + 0.12 + i * 0.09, 0.4, i % 2 === 0 ? 1 : -0.6))
        converge([from[0], from[1] + 2.6, from[2]], C.arcane, Math.max(0.05, d), 1.2)
        return d + 0.5
      // ---------------- Sera (Cleric)
      case 'sun_mend':
        beam(at, C.holy, d, { radius: 0.42 })
        motes(at, C.heal, 10, 0.45, 1.6, d + 0.15)
        return d + 0.12
      case 'sanctuary_wave':
        groundRing(from, C.heal, d, 0.7, 0.3, TILE_SIZE * 2.0, 1)
        groundRing(from, C.holy, d + 0.1, 0.6, 0.2, TILE_SIZE * 1.5, -1)
        dome(from, C.heal, d, TILE_SIZE * 1.2, 0.8)
        for (const c of cells) motes(c, C.heal, 5, 0.35, 1.4, d + 0.2)
        return d
      case 'dawns_judgment':
        cells.forEach((c, i) => beam(c, C.holy, d + i * 0.05, { radius: 0.5, life: 0.8 }))
        later(d, () => onShake(0.14))
        return d + 0.15
      // ---------------- Kael (Rogue)
      case 'shadowstep':
        smoke(front, 0)
        smoke(chest, d)
        slash(chest, yaw, C.shadow, d, { radius: 0.75, roll: 0.6, life: 0.24 })
        dashTrail(from, at, C.shadow, 0.02, 4, 'shadow')
        return d
      case 'fan_blades':
        radialShards(from, C.steel, d, 10, 2.2, 0.42)
        add(d - 0.08, 0.36, (u, t) => {
          pool.add(slashWhirl, [from[0], from[1] + 0.9, from[2]], [1.1, 1, 1.1], t * 20, withAlpha(C.steel, 1 - u), 1, 'additive')
        })
        return d + 0.1
      case 'phantom_exec':
        dashTrail(from, at, C.shadow, 0, 6, 'shadow')
        smoke(front, 0, undefined, 8)
        slash(chest, yaw, C.shadow, d - 0.12, { radius: 0.8, roll: 0.8, life: 0.22 })
        slash(chest, yaw, C.shadow, d - 0.04, { radius: 0.8, roll: -0.8, life: 0.22 })
        slash(chest, yaw, C.blood, d + 0.06, { radius: 1.0, roll: 0.1, life: 0.3, mesh: slashWide })
        later(d + 0.06, () => { onShake(0.2); sparks(chest, C.shadow, 10, 2.2) })
        return d + 0.06
      // ---------------- Dame Isolde (Paladin)
      case 'radiant_cleave':
        slash(lerp3(hand, chest, 0.75), yaw, C.holy, d, { radius: 1.05, roll: Math.PI / 2, sweep: 0.35, life: 0.3 })
        beam(at, C.gold, d, { radius: 0.22, height: 3.5, life: 0.45 })
        later(d, () => onShake(0.16))
        return d
      case 'aegis_vow':
        dome(from, C.gold, d, TILE_SIZE * 1.25, 1.3)
        motes(from, C.gold, 14, 0.6, 1.8, d)
        later(d, () => groundRing(from, C.white, 0, 0.4, 0.3, 1.6))
        return d
      case 'solar_verdict':
        slash(lerp3(hand, chest, 0.8), yaw, C.gold, d, { radius: 1.35, roll: Math.PI / 2, sweep: 0.3, life: 0.34, mesh: slashWide })
        later(d, () => {
          onShake(0.32)
          for (const c of cells) spires(c, C.gold, 0.02, { count: 6, radius: 0.45, height: 0.75, tilt: 0.55 })
          groundRing(at, C.gold, 0, 0.6, 0.4, TILE_SIZE * 2.0)
          dust(at, 12, 1.8)
        })
        beam(at, C.holy, d - 0.05, { radius: 0.6, life: 0.6 })
        return d
      // ---------------- Freya (Cryomancer)
      case 'frost_lance':
        lance(hand, chest, C.frost, d, 0.22, 'shard', 1.8, 0.05)
        spires(at, C.ice, d + 0.22, { count: 4, radius: 0.32, height: 0.85 })
        return d + 0.22
      case 'glacial_ring':
        groundRing(from, C.frost, d, 0.6, 0.3, TILE_SIZE * 1.9, 2)
        radialShards(from, C.ice, d, 8, 1.6, 0.35)
        cells.forEach((c, i) => spires(c, C.ice, d + 0.08 + i * 0.03, { count: 5, radius: 0.4, height: 0.8 }))
        return d + 0.1
      case 'absolute_zero':
        converge([from[0], from[1] + 1.2, from[2]], C.frost, Math.max(0.05, d), 1.4)
        later(d, () => onShake(0.24))
        cells.forEach((c, i) => {
          spires(c, C.ice, d + i * 0.04, { count: 7, radius: 0.5, height: 1.3, life: 1.2 })
          // frozen crystal shell around anything standing in the cell
          add(d + 0.1 + i * 0.04, 1.1, u => {
            const g = easeOut(Math.min(1, u * 4))
            const f = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1
            pool.add(crystalMesh, [c[0], c[1] + 0.85, c[2]], [pos(0.75 * g), pos(1.9 * g), pos(0.75 * g)], c[0], withAlpha(C.ice, 0.42 * f), 0.8, 'alpha')
          })
        })
        groundRing(at, C.white, d, 0.7, 0.4, TILE_SIZE * 2.2, 1)
        return d + 0.1
      // ---------------- Aurelius (Sunblade / Champion)
      case 'solar_slash':
        slash(front, yaw, C.gold, d, { radius: 1.5, roll: 0.15, life: 0.36, mesh: slashWide, sweep: 1.4 })
        slash(front, yaw, C.fire, d + 0.03, { radius: 1.25, roll: 0.15, life: 0.3, mesh: slashWide, sweep: 1.4 })
        later(d, () => { for (const c of cells) embers(c, 6, 0.4) })
        return d
      case 'phoenix_charge':
        dashTrail(from, at, C.fire, 0, 7, 'fire')
        // flame wings flare behind the charging hero
        add(0, Math.max(0.2, d + 0.15), (u, t) => {
          const p = lerp3(from, at, easeIn(Math.min(1, u * 1.1)))
          const s = 0.9 * pulse(Math.min(1, u * 1.4))
          for (const side of [-1, 1]) {
            pool.add(slashArc, [p[0], p[1] + 1.0, p[2]], [pos(s), 1, pos(s)], rot(0, yaw + Math.PI + side * 0.9, side * (1.2 + Math.sin(t * 22) * 0.2)), withAlpha(C.fire, 0.9), 1, 'additive')
          }
        })
        later(d, () => { onShake(0.2); sparks(chest, C.fireTip, 12, 2.4); groundRing(at, C.fire, 0, 0.45, 0.3, 1.5); embers(at, 10, 0.6) })
        return d
      case 'crownbreaker':
        slash(lerp3(hand, chest, 0.85), yaw, C.gold, d, { radius: 1.5, roll: Math.PI / 2, sweep: 0.3, life: 0.36, mesh: slashWide })
        later(d, () => {
          onShake(0.4)
          dust(at, 14, 2.0)
          groundRing(at, C.gold, 0, 0.7, 0.4, TILE_SIZE * 2.4)
          groundRing(at, C.fire, 0.05, 0.6, 0.3, TILE_SIZE * 1.8)
          for (const c of cells) spires(c, C.fire, 0.03, { count: 6, radius: 0.5, height: 0.95, tilt: 0.6 })
          embers(at, 14, 1.2)
          scorch(at, 1.8, 0.8)
        })
        return d
    }
    // Generic fallback by style
    const col = styleColor(ev.style)
    if (Math.hypot(at[0] - from[0], at[2] - from[2]) > TILE_SIZE * 1.2) lance(hand, chest, col, d, 0.3, 'orb')
    later(d + 0.3, () => { sparks(chest, col, 10, 2); groundRing(at, col, 0, 0.4, 0.2, 1.2) })
    return d + 0.3
  }

  // ---------------------------------------------------------------- tactic cards
  /** Play a tactic card's board animation; returns the delay at which its effect lands. */
  function tactic(ev: TacticVfxInput, d: number): number {
    const { at, cells } = ev
    const C = VFX_COLORS
    switch (ev.tacticId) {
      case 'rally_banner': {
        const top = at[1] + 4.5
        add(d, 1.7, (u, t) => {
          const fall = Math.min(1, t / 0.34)
          const y = top + (at[1] - top) * easeIn(fall)
          const fade = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1
          const sink = u > 0.8 ? (u - 0.8) * 2.5 : 0
          pool.add(beamMesh, [at[0], y + 0.9 - sink, at[2]], [0.035, 1.8, 0.035], 0, withAlpha(color('8a5a32'), fade), 0.2, fade < 1 ? 'alpha' : 'opaque')
          pool.add(crystalMesh, [at[0], y + 1.86 - sink, at[2]], [0.09, 0.12, 0.09], t * 2, withAlpha(C.gold, fade), 0.9, fade < 1 ? 'alpha' : 'opaque')
          const wave = Math.sin(t * 9) * 0.25
          pool.add(flagMesh, [at[0], y + 1.75 - sink, at[2]], [1.0, 1.0, 1.0], rot(0, t * 0.4 + wave, 0), withAlpha(color('c8323c'), fade), 0.4, fade < 1 ? 'alpha' : 'opaque')
          pool.add(flagMesh, [at[0], y + 1.62 - sink, at[2]], [0.7, 0.45, 0.7], rot(0, t * 0.4 + wave * 1.3, 0), withAlpha(C.gold, fade), 0.7, fade < 1 ? 'alpha' : 'opaque')
        })
        later(d + 0.34, () => {
          onShake(0.12)
          dust(at, 8, 1.2)
          groundRing(at, C.gold, 0, 0.6, 0.3, TILE_SIZE * 1.6)
          for (const c of cells) motes(c, C.gold, 6, 0.4, 1.5, 0.05)
        })
        return d + 0.34
      }
      case 'healing_draught': {
        const start: Vec3 = [at[0] - 0.6, at[1] + 3.6, at[2] - 0.4]
        add(d, 0.42, (u, t) => {
          const p = lerp3(start, [at[0], at[1] + 0.9, at[2]], easeIn(u))
          pool.add(roundPebble, p, [0.24, 0.28, 0.24], t * 9, withAlpha(C.heal, 0.85), 0.7, 'alpha')
          pool.add(beamMesh, [p[0], p[1] + 0.2, p[2]], [0.06, 0.16, 0.06], t * 9, color('d8c8a0'), 0.4)
        })
        later(d + 0.42, () => {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            particles.spawn({
              mesh: roundPebble, blend: 'alpha', position: [at[0], at[1] + 0.9, at[2]],
              velocity: [Math.cos(a) * 1.6, 1.4 + (i % 3) * 0.5, Math.sin(a) * 1.6], gravity: 6,
              scale: [0.08, 0.08, 0.08], endScale: 0.4, color: withAlpha(C.heal, 0.9), unlit: 0.8, life: 0.45
            })
          }
          groundRing(at, C.heal, 0, 0.5, 0.2, 1.3)
          motes(at, C.heal, 8, 0.4, 1.5, 0.05)
        })
        return d + 0.42
      }
      case 'phoenix_sigil': {
        for (const c of cells) {
          beam(c, C.gold, d, { radius: 0.44, height: 6.0, life: 0.85 })
          groundRing(c, C.fireTip, d + 0.08, 0.72, 0.22, 1.55, 2.2)
          groundRing(c, C.holy, d + 0.14, 0.62, 0.18, 1.15, -3.0)
          motes(c, C.gold, 12, 0.48, 2.1, d + 0.12)
          embers(c, 8, 0.42, d + 0.1, C.fireTip)
        }
        return d + 0.18
      }
      case 'iron_ward':
        for (const c of cells) {
          add(d, 1.3, (u, t) => {
            const rise = u < 0.2 ? easeOut(u / 0.2) : u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2 + Math.PI / 6
              const r = 0.62
              pool.add(box, [c[0] + Math.sin(a) * r, c[1] + 0.55 * rise, c[2] + Math.cos(a) * r],
                [0.66, pos(1.1 * rise), 0.04], a, withAlpha(C.steel, 0.34 + Math.sin(t * 8 + i) * 0.06), 0.8, 'alpha')
            }
            pool.add(flatRing, [c[0], c[1] + 0.08, c[2]], [0.78, 1, 0.78], t, withAlpha(C.steel, rise), 1, 'additive')
          })
          later(d, () => sparks([c[0], c[1] + 0.4, c[2]], C.steel, 8, 1.4))
        }
        return d + 0.15
      case 'flame_scroll':
        cells.forEach((c, i) => {
          add(d + i * 0.04, 1.0, (u, t) => {
            const h = 2.4 * pulse(Math.min(1, u * 1.3))
            for (let j = 0; j < 3; j++) {
              const fl = 1 + Math.sin(t * 30 + j * 2) * 0.12
              pool.add(crystalMesh, [c[0], c[1] + h * (0.25 + j * 0.25), c[2]], [pos(0.42 * (1 - j * 0.25) * fl), pos(h * 0.45), pos(0.42 * (1 - j * 0.25) * fl)], t * (6 + j * 3), j === 2 ? C.fireTip : C.fire, 1, 'additive')
            }
          })
          embers(c, 10, 0.45, d + i * 0.04)
          scorch(c, 1.8, 0.62)
        })
        later(d, () => onShake(0.12))
        return d + 0.1
      case 'wind_step':
        for (const c of cells) {
          add(d, 0.9, (u, t) => {
            for (let i = 0; i < 3; i++) {
              const h = 0.2 + i * 0.5 + u * 0.6
              const s = 0.55 + i * 0.12
              pool.add(slashArc, [c[0], c[1] + h, c[2]], [s, 1, s], t * 14 + i * 2.1, withAlpha(C.haste, (1 - u) * 0.85), 1, 'additive')
            }
          })
          dust(c, 8, 1.4, d)
        }
        return d + 0.1
      case 'taunt_banner':
        for (const c of cells) {
          groundRing(c, C.taunt, d, 0.65, 0.25, TILE_SIZE * 1.45, 2.2)
          groundRing(c, C.gold, d + 0.06, 0.55, 0.2, TILE_SIZE * 1.05, -2.6)
          spires(c, C.taunt, d + 0.04, { count: 4, radius: 0.55, height: 0.65, life: 0.7, tilt: 0.45 })
          later(d, () => {
            onShake(0.10)
            sparks([c[0], c[1] + 0.75, c[2]], C.gold, 8, 1.8)
          })
        }
        return d + 0.12
      case 'venom_vial': {
        const start: Vec3 = [at[0] - 0.55, at[1] + 3.4, at[2] - 0.35]
        add(d, 0.38, (u, t) => {
          const p = lerp3(start, [at[0], at[1] + 0.85, at[2]], easeIn(u))
          pool.add(roundPebble, p, [0.22, 0.26, 0.22], t * 10, withAlpha(C.poison, 0.9), 0.85, 'alpha')
          pool.add(crystalMesh, [p[0], p[1] + 0.18, p[2]], [0.08, 0.14, 0.08], -t * 8, C.venom, 0.9)
        })
        later(d + 0.38, () => {
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2
            particles.spawn({
              mesh: roundPebble, blend: 'alpha', alphaFade: true, position: [at[0], at[1] + 0.75, at[2]],
              velocity: [Math.cos(a) * 1.4, 1.2 + (i % 3) * 0.45, Math.sin(a) * 1.4], gravity: 4.2,
              scale: [0.10, 0.10, 0.10], endScale: 0.35, color: i % 3 === 0 ? withAlpha(C.venom, 0.9) : withAlpha(C.poison, 0.92), unlit: 0.95, life: 0.52
            })
          }
          groundRing(at, C.poison, 0, 0.55, 0.2, 1.35, 1.8)
          motes(at, C.venom, 6, 0.45, 1.3, 0.04)
        })
        return d + 0.38
      }
      case 'frost_nova_scroll':
        cells.forEach((c, i) => {
          add(d + i * 0.03, 1.1, (u, t) => {
            const f = 1 - easeIn(u)
            pool.add(flatRing, [c[0], c[1] + 0.08, c[2]], [0.72, 1, 0.72], t * 0.6, withAlpha(C.frost, f), 1, 'additive')
            for (let g = 0; g < 3; g++) {
              pool.add(slashArc, [c[0], c[1] + 0.09, c[2]], [0.48, 1, 0.48], -t * 1.2 + g * 2.09, withAlpha(C.ice, f), 1, 'additive')
            }
          })
          spires(c, C.ice, d + 0.15 + i * 0.03, { count: 5, radius: 0.36, height: 0.75 })
        })
        return d + 0.15
      case 'arcane_surge':
        bolt(at, C.arcane, d, 6.5)
        motes(at, C.arcane, 12, 0.5, 2.0, d + 0.1)
        add(d, 0.9, (u, t) => {
          pool.add(flatRing, [at[0], at[1] + 0.3 + u * 1.4, at[2]], [pos(0.6 * (1 - u * 0.5)), 1, pos(0.6 * (1 - u * 0.5))], t * 4, withAlpha(C.arcane, 1 - u), 1, 'additive')
        })
        return d
      case 'lightning_chain':
        cells.forEach((c, i) => bolt(c, C.lightning, d + i * 0.07))
        return d
      case 'solar_blessing': {
        let cx = 0, cz = 0, cy = 0
        for (const c of cells) { cx += c[0]; cy += c[1]; cz += c[2] }
        const n = Math.max(1, cells.length)
        const centre: Vec3 = [cx / n, cy / n, cz / n]
        let spread = TILE_SIZE * 1.6
        for (const c of cells) spread = Math.max(spread, Math.hypot(c[0] - centre[0], c[2] - centre[2]) + TILE_SIZE)
        dome(centre, C.gold, d, spread, 1.6)
        cells.forEach((c, i) => {
          beam(c, C.holy, d + 0.12 + i * 0.06, { radius: 0.38, life: 0.7 })
          motes(c, C.gold, 6, 0.4, 1.6, d + 0.3)
        })
        return d + 0.2
      }
    }
    // fallback
    const col = styleColor(ev.style)
    for (const c of cells) later(d, () => { sparks([c[0], c[1] + 0.6, c[2]], col, 8, 1.8); groundRing(c, col, 0, 0.4, 0.2, 1.0) })
    return d
  }

  // ---------------------------------------------------------------- enemy specials
  /** Enemy & raid-boss signature move VFX; returns the delay at which it lands. */
  function special(
    move: 'eclipse_nova' | 'shaman_mend' | 'lich_summon' | 'frostwyrm_breath' | 'titan_slam',
    from: Vec3,
    at: Vec3,
    cells: readonly Vec3[],
    d: number
  ): number {
    const C = VFX_COLORS
    if (move === 'eclipse_nova') {
      const crown: Vec3 = [from[0], from[1] + 2.5, from[2]]
      converge(crown, C.shadow, Math.max(0.1, d), 1.8)
      // dark sun swelling over the boss, then hurled at the target cross
      add(0, d + 0.25, (u, t) => {
        const s = 0.2 + 0.55 * easeIn(Math.min(1, u * 1.2))
        const p = u < 0.78 ? crown : lerp3(crown, [at[0], at[1] + 0.8, at[2]], easeIn((u - 0.78) / 0.22))
        pool.add(roundPebble, p, [s, s, s], t, C.void, 1)
        pool.add(roundPebble, p, [s * 1.45, s * 1.45, s * 1.45], -t, withAlpha(C.shadow, 0.6), 1, 'additive')
        pool.add(flatRing, p, [s * 2.2, 1, s * 2.2], rot(Math.PI / 2, t * 2, 0), withAlpha(C.holy, 0.8), 1, 'additive')
      })
      later(d + 0.25, () => {
        onShake(0.45)
        groundRing(at, C.shadow, 0, 0.8, 0.4, TILE_SIZE * 2.6)
        groundRing(at, C.void, 0.06, 0.8, 0.3, TILE_SIZE * 2.0, 0, 'alpha')
        groundRing(at, C.holy, 0.1, 0.5, 0.2, TILE_SIZE * 1.4)
        for (const c of cells) {
          spires(c, C.shadow, 0.04, { count: 5, radius: 0.42, height: 0.9, tilt: 0.5 })
          smoke(c, 0.02, [0.18, 0.04, 0.26, 0.7], 6)
          scorch(c, 2.0, 0.6)
        }
      })
      return d + 0.25
    }
    if (move === 'lich_summon') {
      // Necromantic telegraph: violet-teal summon circles pulse on target tiles, then bone spires + wisps erupt
      converge([from[0], from[1] + 1.9, from[2]], C.shadow, Math.max(0.1, d), 1.5)
      for (const c of cells) {
        add(0, d + 0.4, (u, t) => {
          const f = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1
          pool.add(flatRing, [c[0], c[1] + 0.08, c[2]], [0.76, 1, 0.76], t * 2.4, withAlpha(C.shadow, f), 1, 'additive')
          pool.add(flatRing, [c[0], c[1] + 0.09, c[2]], [0.50, 1, 0.50], -t * 3.2, withAlpha(C.heal, 0.7 * f), 1, 'additive')
        })
      }
      later(d, () => {
        onShake(0.22)
        for (const c of cells) {
          beam(c, C.shadow, 0, { radius: 0.32, height: 4.5, life: 0.55 })
          spires(c, color('d6d2c4'), 0.04, { count: 5, radius: 0.38, height: 0.85, tilt: 0.35 })
          motes(c, C.heal, 8, 0.45, 1.8, 0.05)
        }
      })
      return d
    }
    if (move === 'frostwyrm_breath') {
      // Deep frost inhale vortex at the mouth, then sweeping cone of frost lances & glacial spires
      const mouth: Vec3 = [from[0], from[1] + 1.35, from[2]]
      converge(mouth, C.ice, Math.max(0.1, d), 1.6)
      later(d, () => {
        onShake(0.28)
        cells.forEach((c, i) => {
          lance(mouth, [c[0], c[1] + 0.5, c[2]], C.frost, i * 0.04, 0.22, 'shard', 1.5, 0.08)
          spires(c, C.ice, 0.16 + i * 0.04, { count: 5, radius: 0.42, height: 0.95, life: 1.0 })
          groundRing(c, C.frost, 0.14 + i * 0.04, 0.65, 0.2, 1.1, 1.5)
        })
      })
      return d + 0.22
    }
    if (move === 'titan_slam') {
      // Molten telegraph under titan & target zone, then colossal magma slam + fissure spires + scorch
      converge([from[0], from[1] + 2.2, from[2]], C.fire, Math.max(0.1, d), 1.9)
      for (const c of cells) groundRing(c, C.ember, 0, d, 0.2, 0.85, 2)
      later(d, () => {
        onShake(0.50)
        groundRing(at, C.fire, 0, 0.75, 0.4, TILE_SIZE * 2.8)
        groundRing(at, C.fireTip, 0.06, 0.60, 0.3, TILE_SIZE * 2.0)
        dust(at, 14, 2.0)
        for (const c of cells) {
          spires(c, C.ember, 0.03, { count: 6, radius: 0.46, height: 1.1, tilt: 0.55 })
          embers(c, 10, 0.55)
          scorch(c, 2.2, 0.72)
        }
      })
      return d
    }
    // Bog Shaman totem chant: stacked green rune rings rising, a spectral totem, motes to the patient
    add(0, d + 0.6, (u, t) => {
      const f = u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1
      for (let i = 0; i < 3; i++) {
        const h = ((t * 0.9 + i / 3) % 1) * 1.8
        pool.add(flatRing, [from[0], from[1] + 0.1 + h, from[2]], [pos(0.7 - h * 0.2), 1, pos(0.7 - h * 0.2)], t * 3 + i, withAlpha(C.heal, f * (1 - h / 1.8)), 1, 'additive')
      }
      pool.add(spikeMesh, [from[0] + 0.55, from[1] + 0.6, from[2]], [0.14, pos(1.2 * easeOut(Math.min(1, u * 3))), 0.14], t, withAlpha(color('6a8a4a'), f), 0.5, 'alpha')
      pool.add(crystalMesh, [from[0] + 0.55, from[1] + 1.3, from[2]], [0.12, 0.16, 0.12], t * 4, withAlpha(C.heal, f), 1, 'additive')
    })
    later(d, () => {
      for (let i = 0; i < 6; i++) {
        particles.arc({
          mesh: crystalMesh, blend: 'additive', from: [from[0], from[1] + 1.3, from[2]], to: [at[0], at[1] + 0.9, at[2]],
          peak: 1.2 + i * 0.12, scale: [0.1, 0.14, 0.1], color: C.heal, unlit: 1, duration: 0.4 + i * 0.05
        })
      }
    })
    return d + 0.4
  }

  // ---------------------------------------------------------------- impacts
  /** Directional crit/backstab streak + block flash at the defender. */
  function impact(at: Vec3, attackYaw: number, kind: 'crit' | 'back' | 'flank' | 'block' | 'hit', delay: number) {
    const chest: Vec3 = [at[0], at[1] + 0.85, at[2]]
    const C = VFX_COLORS
    if (kind === 'block') {
      add(delay, 0.28, u => {
        const s = 0.55 + 0.25 * easeOut(u)
        pool.add(flatRing, [chest[0] - Math.sin(attackYaw) * 0.35, chest[1], chest[2] - Math.cos(attackYaw) * 0.35], [s, 1, s], rot(Math.PI / 2, attackYaw, 0), withAlpha(C.frost, 1 - u), 1, 'additive')
      })
      later(delay, () => sparks(chest, C.frost, 8, 1.8))
      return
    }
    if (kind === 'crit' || kind === 'back') {
      const col = kind === 'back' ? color('ff9cf0') : C.gold
      // long directional streak through the target, along the blow
      const len = 1.4
      const a: Vec3 = [chest[0] - Math.sin(attackYaw) * len * 0.5, chest[1] + 0.25, chest[2] - Math.cos(attackYaw) * len * 0.5]
      const b: Vec3 = [chest[0] + Math.sin(attackYaw) * len * 0.5, chest[1] - 0.2, chest[2] + Math.cos(attackYaw) * len * 0.5]
      streak(a, b, col, delay, 0.24, 0.11)
      slash(chest, attackYaw, col, delay, { radius: 0.7, roll: 1.1, life: 0.22 })
      later(delay, () => { sparks(chest, col, 12, 2.6); groundRing(chest, C.white, 0, 0.22, 0.1, 0.7) })
      return
    }
    if (kind === 'flank') later(delay, () => sparks(chest, color('ffd166'), 6, 1.8))
  }

  /**
   * Coordinated Pincer / Follow-Up VFX: golden/cyan energy tether connecting
   * attacker -> target <- assister, assister highlight ring, follow-up slash arc,
   * twin shockwaves, and strike sparks at the target.
   */
  function pincer(attackerPos: Vec3, assisterPos: Vec3, targetPos: Vec3, delay: number) {
    const C = VFX_COLORS
    const attChest: Vec3 = [attackerPos[0], attackerPos[1] + 0.88, attackerPos[2]]
    const assChest: Vec3 = [assisterPos[0], assisterPos[1] + 0.88, assisterPos[2]]
    const tgtChest: Vec3 = [targetPos[0], targetPos[1] + 0.85, targetPos[2]]
    const yawFromAssister = yawBetween(assisterPos, targetPos)

    // Glowing curved energy assist arcs connecting attacker -> target <- assister
    const arcDelay = Math.max(0, delay - 0.08)
    add(arcDelay, 0.42, (u, t) => {
      const fade = 1 - easeIn(u)
      const beads = 7
      for (const origin of [attChest, assChest]) {
        const isAssister = origin === assChest
        const col = isAssister ? C.gold : C.haste
        for (let i = 0; i < beads; i++) {
          const s = (i + 0.5) / beads
          const p = lerp3(origin, tgtChest, s)
          p[1] += Math.sin(s * Math.PI) * (isAssister ? 0.58 : 0.44)
          const sz = (0.09 + Math.sin(s * Math.PI) * 0.06) * (0.65 + 0.55 * fade)
          pool.add(crystalMesh, p, [pos(sz), pos(sz), pos(sz)], t * 8 + i, withAlpha(col, 0.96 * fade), 1, 'additive')
        }
      }
      // Pulsing golden clamp ring under assister
      const ar = 0.66 + 0.16 * easeOut(u)
      pool.add(flatRing, [assisterPos[0], assisterPos[1] + 0.08, assisterPos[2]], [pos(ar), 1, pos(ar)], t * 3.2, withAlpha(C.gold, 0.9 * fade), 1, 'additive')
    })

    // Crisp follow-up golden/cyan slash + strike streaks + sparks at target
    const near: Vec3 = lerp3(assChest, tgtChest, 0.72)
    slash(near, yawFromAssister, C.gold, delay, { radius: 0.95, roll: 0.35, life: 0.28, mesh: slashWide })
    slash(near, yawFromAssister, C.haste, delay + 0.03, { radius: 0.82, roll: -0.45, life: 0.24 })
    streak(assChest, tgtChest, C.gold, delay, 0.22, 0.08)
    streak(attChest, tgtChest, C.haste, delay, 0.20, 0.05)
    later(delay, () => {
      onShake(0.14)
      groundRing(targetPos, C.gold, 0, 0.38, 0.22, 1.35, 2.2)
      groundRing(targetPos, C.haste, 0.03, 0.34, 0.18, 1.05, -2.6)
      sparks(tgtChest, C.gold, 10, 2.3)
      sparks(tgtChest, C.haste, 6, 1.7)
    })
  }

  return {
    get active() { return effects.length },
    clear() { effects.length = 0 },
    update(dt: number) {
      for (let i = effects.length - 1; i >= 0; i--) {
        const e = effects[i]
        if (e.delay > 0) {
          e.delay -= dt
          if (e.delay > 0) continue
        }
        if (e.fire) {
          effects.splice(i, 1)
          e.fire()
          continue
        }
        e.t += dt
        if (e.t >= e.life) { effects.splice(i, 1); continue }
        e.draw?.(e.t / e.life, e.t)
      }
    },
    later,
    sparks,
    dust,
    embers,
    motes,
    beam,
    groundRing,
    strike,
    skill,
    tactic,
    special,
    impact,
    pincer,
    lance
  }
}

export type BattleVfx = ReturnType<typeof createBattleVfx>
