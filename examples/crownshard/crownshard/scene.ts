import {
  color, createAnimator, createMeshPool, createParticles, createShadowBatch,
  intersectRayPlane, mesh, multiply, perspective, quaternionFromEuler, renderRig, screenToRay,
  view, worldToScreen
} from 'ridgetop'
import type { Color, InstanceBatch, JointPose, LowPolyRenderer, Matrix, PointLight, RenderStats, Vec3 } from 'ridgetop'
import {
  BIOME_STYLES, ENEMY_RIGS,
  buildCampDioramaBatches, buildStaticBoardBatches, crownMesh, crystalMesh, flatRing, resolveHeroRig, roundPebble, tileQuad
} from './art.ts'
import {
  CAMP_FIDGETS, LEAP_TUCK, UNIT_CLIPS,
  aimClipFor, attackClipFor, castClipFor, celebrateClipFor, idleClipFor, idleRateFor, stanceOffsetFor, uidHash
} from './animations.ts'
import type { UnitClipName } from './animations.ts'
import { getEquipmentByUid, getHeroByUid, getPatternCells, getHeroSkill, getUnitByUid, getTacticByUid, unitAt } from './simulation.ts'
import { TACTIC_BY_ID } from './data.ts'
import { TILE_SIZE, facingToYaw, gridToWorld, worldToGrid } from './types.ts'
import type { BattleState, BattleUnit, CombatForecast, GameState, OwnedHeroCard } from './types.ts'

const C_MOVE_TILE: Color = [0.22, 0.80, 1.0, 0.34]
const C_MOVE_BORDER: Color = [0.84, 0.97, 1.0, 0.94]
const C_ATTACK_TILE: Color = [1.0, 0.32, 0.14, 0.42]
const C_ATTACK_MARK: Color = [1.0, 0.94, 0.80, 0.98]
const C_FREE_RANGE_TILE: Color = [0.76, 0.86, 1.0, 0.12]
const C_FREE_RANGE_MARK: Color = [0.86, 0.92, 1.0, 0.42]
const C_FRIENDLY_FIRE_TILE: Color = [0.98, 0.18, 0.58, 0.56]
const C_FRIENDLY_FIRE_MARK: Color = [1.0, 0.92, 0.97, 0.98]
const C_MOVE_ATTACK_TILE: Color = [1.0, 0.68, 0.10, 0.42]
const C_MOVE_ATTACK_MARK: Color = [1.0, 0.96, 0.72, 0.98]
const C_ALLY_TARGET: Color = [0.24, 0.92, 0.74, 0.38]
const C_ALLY_MARK: Color = [0.94, 1.0, 0.97, 0.98]
const C_AOE_PREVIEW: Color = [1.0, 0.84, 0.24, 0.42]
const C_AOE_MARK: Color = [1.0, 0.97, 0.78, 0.98]
const C_HOVER_TILE: Color = [1.0, 0.98, 0.90, 0.28]
const C_HOVER_BORDER: Color = [1.0, 1.0, 1.0, 0.98]
const C_APPROACH_RING: Color = [0.42, 0.95, 1.0, 0.96]
const C_TARGET_RETICLE: Color = [1.0, 0.32, 0.22, 0.96]
const C_EMPTY_RETICLE: Color = [0.76, 0.84, 0.98, 0.78]
const C_FORECAST_ARC: Color = [1.0, 0.80, 0.26, 0.94]
const C_FORECAST_ALLY_ARC: Color = [0.44, 0.98, 0.68, 0.94]
const C_FORECAST_FF_ARC: Color = [1.0, 0.34, 0.68, 0.96]
const C_FACING_ALLY: Color = [0.64, 0.95, 1.0, 0.96]
const C_FACING_ENEMY: Color = [1.0, 0.48, 0.22, 0.96]
const C_ACTIVE_RING: Color = [1.0, 0.85, 0.32, 0.96]
const C_SELECT_RING: Color = [0.70, 0.94, 1.0, 0.82]
const C_ENEMY_RING: Color = [0.98, 0.32, 0.30, 0.78]
const C_ALLY_RING: Color = [0.40, 0.82, 1.0, 0.62]
const C_STAR2_GOLD = color('f5c84c')
const C_STAR3_HALO: Color = [1.0, 0.88, 0.44, 0.86]
const C_FIRE_CORE = color('ff8f38')
const C_FIRE_TIP = color('ffe980')
const C_FROST = color('84e8ff')
const C_ARCANE = color('ad84ff')
const C_HOLY = color('fff0a0')
const C_SHADOW = color('cc64ff')
const C_HEAL = color('68ffa8')
const C_SHIELD: Color = [0.46, 0.86, 1.0, 0.38]
const C_HIT_FLASH = color('ffffff')
const C_CAMP_SKY = color('465a78')
const C_ARROW = color('f1dfb4')
const C_DUST: Color = [0.88, 0.82, 0.70, 0.55]
const C_ALLY_MOTE = color('ffe58a')
const C_ENEMY_MOTE = color('ff8a6e')
const C_ALLY_SOUL = color('9fe8ff')
const C_ENEMY_SOUL = color('d58cff')

/** Death timing: topple clip, then sink + shrink into a soul-mote burst. */
const DEATH_SINK_START = 1.0
const DEATH_SINK_TIME = 0.7
const DEATH_TOTAL = DEATH_SINK_START + DEATH_SINK_TIME
/** Grid movement in the simulation advances 5.2 tiles/s; the run clip has 2 footfalls per 0.44 s cycle. */
const RUN_RATE = (0.44 / 2) * 5.2

const ADD_JOINTS = ['body', 'head', 'armL', 'armR', 'legL', 'legR', 'cape'] as const

/** Double-sided low-poly arrow pointing down +Z (length 1, centred on origin). */
const arrowMesh = (() => {
  const pos: number[] = []
  const idx: number[] = []
  function tri(a: Vec3, b: Vec3, c: Vec3) {
    const n = pos.length / 3
    pos.push(...a, ...b, ...c, ...a, ...c, ...b)
    idx.push(n, n + 1, n + 2, n + 3, n + 4, n + 5)
  }
  function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
    tri(a, b, c)
    tri(a, c, d)
  }
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
  // Crossed fletching vanes
  quad([-0.11, 0, -0.50], [0.11, 0, -0.50], [0.05, 0, -0.30], [-0.05, 0, -0.30])
  quad([0, -0.11, -0.50], [0, 0.11, -0.50], [0, 0.05, -0.30], [0, -0.05, -0.30])
  return mesh(pos, idx)
})()

/** Flat ground-hugging directional facing chevron pointing down +Z outside the unit ring. */
const facingChevronMesh = (() => {
  const pos: number[] = []
  const idx: number[] = []
  function tri(a: Vec3, b: Vec3, c: Vec3) {
    const n = pos.length / 3
    pos.push(...a, ...b, ...c, ...a, ...c, ...b)
    idx.push(n, n + 1, n + 2, n + 3, n + 4, n + 5)
  }
  const y = 0.0
  // Crisp forward chevron arrowhead placed at z = 0.56..0.84
  tri([0, y, 0.86], [-0.20, y, 0.56], [0, y, 0.64])
  tri([0, y, 0.86], [0, y, 0.64], [0.20, y, 0.56])
  return mesh(pos, idx)
})()

/** Build a flat ground-plane mesh from a list of 2D XZ quads (double-sided, unit tile scale [-0.5..0.5]). */
function flatOverlayMesh(rects: readonly (readonly [number, number, number, number])[]) {
  const pos: number[] = []
  const idx: number[] = []
  function quadXZ(x0: number, z0: number, x1: number, z1: number) {
    const n = pos.length / 3
    pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1)
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2)
  }
  for (const [x0, z0, x1, z1] of rects) quadXZ(x0, z0, x1, z1)
  return mesh(pos, idx)
}

/** Build a flat ground-plane mesh from arbitrary 2D XZ line segments with given half-width. */
function flatSegmentsMesh(segs: readonly (readonly [number, number, number, number])[], halfW: number) {
  const pos: number[] = []
  const idx: number[] = []
  for (const [x0, z0, x1, z1] of segs) {
    const dx = x1 - x0
    const dz = z1 - z0
    const len = Math.hypot(dx, dz) || 1
    const nx = (-dz / len) * halfW
    const nz = (dx / len) * halfW
    const n = pos.length / 3
    pos.push(
      x0 - nx, 0, z0 - nz,
      x0 + nx, 0, z0 + nz,
      x1 + nx, 0, z1 + nz,
      x1 - nx, 0, z1 - nz
    )
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3, n, n + 2, n + 1, n, n + 3, n + 2)
  }
  return mesh(pos, idx)
}

/** Colorblind-safe tile shape overlays (distinct silhouettes readable even in pure grayscale!). */
// 1. Hollow Square Frame + small center dot -> MOVE tile / Hover cursor
const tileFrameMesh = flatOverlayMesh([
  [-0.47, -0.47, 0.47, -0.39],
  [-0.47, 0.39, 0.47, 0.47],
  [-0.47, -0.39, -0.39, 0.39],
  [0.39, -0.39, 0.47, 0.39]
])
const tileDotMesh = flatOverlayMesh([[-0.08, -0.08, 0.08, 0.08]])
// 2. Bold Diagonal X Crosshair -> DIRECT ATTACK / FRIENDLY FIRE target
const tileCrossMesh = flatSegmentsMesh([
  [-0.30, -0.30, 0.30, 0.30],
  [0.30, -0.30, -0.30, 0.30]
], 0.055)
// 3. Four Corner L-Brackets [ ] -> Attack lock-on / Free skill range footprint
const tileCornersMesh = flatOverlayMesh([
  [-0.46, -0.46, -0.22, -0.39], [-0.46, -0.46, -0.39, -0.22],
  [0.22, -0.46, 0.46, -0.39], [0.39, -0.46, 0.46, -0.22],
  [-0.46, 0.39, -0.22, 0.46], [-0.46, 0.22, -0.39, 0.46],
  [0.22, 0.39, 0.46, 0.46], [0.39, 0.22, 0.46, 0.46]
])
// 4. Bold Medical/Support Plus (+) -> ALLY HEAL / SHIELD target
const tilePlusMesh = flatOverlayMesh([
  [-0.075, -0.28, 0.075, 0.28],
  [-0.28, -0.075, 0.28, 0.075]
])
// 5. Bold Hollow Diamond -> MOVE+ATTACK / AoE Blast Preview / Enemy Ground Ring!
const tileDiamondMesh = flatSegmentsMesh([
  [0, -0.42, 0.42, 0],
  [0.42, 0, 0, 0.42],
  [0, 0.42, -0.42, 0],
  [-0.42, 0, 0, -0.42]
], 0.045)

function vfxColor(style: 'slash' | 'arrow' | 'arcane' | 'fire' | 'frost' | 'holy' | 'shadow' | 'gold'): Color {
  if (style === 'fire') return C_FIRE_CORE
  if (style === 'frost') return C_FROST
  if (style === 'arcane') return C_ARCANE
  if (style === 'holy' || style === 'gold') return C_HOLY
  if (style === 'shadow') return C_SHADOW
  return C_FIRE_TIP
}

function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2))
}

type Animator = ReturnType<typeof createAnimator<UnitClipName>>

/** Presentation-only per-unit animation state (never read by the simulation). */
interface UnitFx {
  readonly anim: Animator
  readonly seed: number
  readonly seed2: number
  yaw: number
  lastState: string
  lastTimer: number
  action: UnitClipName | null
  actionT: number
  actionDur: number
  wasAlive: boolean
  deathT: number
  kbX: number
  kbZ: number
  lastCol: number
  lastRow: number
  lastElev: number
  landT: number
  landAmp: number
  pendingReady: boolean
  celebrateDelay: number
  stanceW: number
  fidgetTimer: number
  fidgetCount: number
  readonly pos: [number, number, number]
  readonly scl: [number, number, number]
  readonly additive: Record<string, { rotation: [number, number, number] }>
}

interface Shot {
  style: 'arrow' | 'arcane' | 'fire' | 'frost' | 'holy' | 'shadow'
  from: Vec3
  to: Vec3
  peak: number
  age: number
  life: number
  trail: number
}

export function createCrownshardScene(renderer: LowPolyRenderer) {
  const campBatches = buildCampDioramaBatches()
  let cachedBoardKey = ''
  let appliedLightingKey = ''
  let boardBatches: InstanceBatch[] = []
  let boardBraziers: Vec3[] = []

  const pool = createMeshPool(128)
  const particles = createParticles(320)
  const unitFx = new Map<string, UnitFx>()
  const shots: Shot[] = []
  const shadows = createShadowBatch({
    capacity: 64,
    color: [0.14, 0.17, 0.30],
    opacity: 0.28,
    penumbra: 0.28,
    offsetScale: 0.12,
    bias: 0.025
  })

  let lastMatrix: Matrix = multiply(perspective(Math.PI / 3.6, 16 / 9, 0.5, 120), view([0, 12, 13], [0, 0, 0]))
  let hoveredCell: { col: number; row: number } | null = null
  let activeForecast: CombatForecast | null = null
  let cameraYawOffset = 0
  const DEFAULT_CAMERA_PITCH = 0.72
  const MIN_CAMERA_PITCH = 0.28
  const MAX_CAMERA_PITCH = 1.38
  let cameraPitch = DEFAULT_CAMERA_PITCH
  let cameraPitchActual = DEFAULT_CAMERA_PITCH
  let cameraZoom = 1.0
  let cameraZoomActual = 1.0
  let cameraPanX = 0
  let cameraPanZ = 0
  const MIN_CAMERA_ZOOM = 0.58
  const MAX_CAMERA_ZOOM = 1.38
  let campFraming: 'title' | 'camp' | 'story' | 'world' = 'title'
  let campShift = 0
  let fireTimer = 0
  let lastBattle: BattleState | null = null
  let lastFloatId = -1
  let lastActiveUid: string | null = null
  let hitStop = 0
  let moteTimer = 0

  function getFx(key: string, unit?: BattleUnit): UnitFx {
    let fx = unitFx.get(key)
    if (!fx) {
      const seed = uidHash(key)
      const anim = createAnimator(UNIT_CLIPS, 'idle')
      anim.step(seed * 2.4) // desync breathing across the squad
      const additive: Record<string, { rotation: [number, number, number] }> = {}
      for (const j of ADD_JOINTS) additive[j] = { rotation: [0, 0, 0] }
      fx = {
        anim,
        seed,
        seed2: uidHash(key + '#'),
        yaw: unit?.yaw ?? 0,
        lastState: unit?.animState ?? 'idle',
        lastTimer: unit?.animTimer ?? 0,
        action: null,
        actionT: 0,
        actionDur: 0,
        wasAlive: unit?.alive ?? true,
        deathT: -1,
        kbX: 0,
        kbZ: 0,
        lastCol: unit?.col ?? 0,
        lastRow: unit?.row ?? 0,
        lastElev: unit?.y ?? 0,
        landT: 1,
        landAmp: 0,
        pendingReady: false,
        celebrateDelay: -1,
        stanceW: 1,
        fidgetTimer: 3 + seed * 6,
        fidgetCount: 0,
        pos: [0, 0, 0],
        scl: [1, 1, 1],
        additive
      }
      unitFx.set(key, fx)
    }
    return fx
  }

  function startAction(fx: UnitFx, clip: UnitClipName, fade: number) {
    fx.action = clip
    fx.actionT = 0
    fx.actionDur = UNIT_CLIPS[clip].duration
    fx.anim.trigger(clip, fade)
  }

  /** Blend archetype stance (idle family only) and the elevation-hop tuck into one reusable additive pose. */
  function fillAdditive(fx: UnitFx, stance: Readonly<Record<string, JointPose>>, stanceW: number, leapK: number) {
    for (const j of ADD_JOINTS) {
      const r = fx.additive[j].rotation
      const s = stance[j]?.rotation
      const l = LEAP_TUCK[j]
      r[0] = (s ? s[0] * stanceW : 0) + (l ? l[0] * leapK : 0)
      r[1] = (s ? s[1] * stanceW : 0) + (l ? l[1] * leapK : 0)
      r[2] = (s ? s[2] * stanceW : 0) + (l ? l[2] * leapK : 0)
    }
    return fx.additive
  }

  function ensureBoard(battle: BattleState) {
    const key = `${battle.stageId}:${battle.biome}:${battle.cols}x${battle.rows}:${battle.endlessWave}`
    if (key === cachedBoardKey) return
    for (const b of boardBatches) renderer.release(b)
    const built = buildStaticBoardBatches(battle.biome, battle.cells)
    boardBatches = built.batches
    boardBraziers = built.brazierPositions
    cachedBoardKey = key
    appliedLightingKey = ''
  }

  function applyBattleLightingOnce(battle: BattleState) {
    const key = `battle:${battle.biome}:${cachedBoardKey}`
    if (key === appliedLightingKey) return
    appliedLightingKey = key

    const style = BIOME_STYLES[battle.biome]
    const points: PointLight[] = []
    for (let i = 0; i < Math.min(4, boardBraziers.length); i++) {
      points.push({
        position: boardBraziers[i],
        color: [style.propGlow[0], style.propGlow[1], style.propGlow[2]],
        radius: 7.2,
        intensity: battle.biome === 'crypt' || battle.biome === 'volcano' || battle.biome === 'throne' ? 1.18 : 0.72
      })
    }

    const shadowScale = Math.max(1, battle.cols / 8, battle.rows / 6)
    renderer.setLighting({
      direction: style.lightDir,
      ambient: style.ambient,
      color: style.lightColor,
      skyColor: style.skyBounce,
      groundColor: style.groundBounce,
      rimColor: [style.propGlow[0], style.propGlow[1], style.propGlow[2]],
      rimStrength: 0.28,
      fogColor: style.fog,
      fogNear: 28,
      fogFar: 88,
      points,
      shadows: {
        enabled: true,
        center: [0, 0, 0],
        extent: 12.5 * shadowScale,
        strength: 0.38,
        color: style.shadowTint
      }
    })
    shadows.setLighting(style.lightDir)
  }

  function applyCampLightingOnce() {
    if (appliedLightingKey === 'camp') return
    appliedLightingKey = 'camp'

    const style = BIOME_STYLES.meadow
    renderer.setLighting({
      direction: [-0.52, 0.76, 0.46],
      ambient: 0.46,
      color: [1.0, 0.93, 0.80],
      skyColor: [0.64, 0.74, 0.94],
      groundColor: [0.46, 0.38, 0.30],
      rimColor: [1.0, 0.86, 0.56],
      rimStrength: 0.30,
      fogColor: [0.28, 0.36, 0.48],
      fogNear: 22,
      fogFar: 64,
      points: [
        { position: [0, 0.85, 2.0], color: [1.0, 0.64, 0.28], radius: 8.2, intensity: 1.35 },
        { position: [0, 1.55, -2.55], color: [1.0, 0.88, 0.48], radius: 6.8, intensity: 0.95 },
        { position: [-3.3, 1.5, -1.4], color: [1.0, 0.84, 0.44], radius: 5.5, intensity: 0.78 },
        { position: [3.3, 1.5, -1.4], color: [1.0, 0.84, 0.44], radius: 5.5, intensity: 0.78 }
      ],
      shadows: {
        enabled: true,
        center: [0, 0, 0],
        extent: 10.5,
        strength: 0.40,
        color: [0.18, 0.22, 0.38]
      }
    })
    shadows.setLighting(style.lightDir)
  }

  function spawnDust(x: number, y: number, z: number, count: number, strength: number) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + x * 3.1 + z * 1.7
      const c = Math.cos(a), s = Math.sin(a)
      particles.spawn({
        mesh: roundPebble,
        blend: 'alpha',
        alphaFade: true,
        position: [x + c * 0.16, y + 0.05, z + s * 0.16],
        velocity: [c * 0.7 * strength, 0.35 + 0.25 * strength, s * 0.7 * strength],
        gravity: 0.5,
        drag: 3.2,
        scale: [0.11, 0.08, 0.11],
        endScale: 2.1,
        color: C_DUST,
        unlit: 0.35,
        life: 0.42 + 0.12 * strength
      })
    }
  }

  function spawnSparks(at: Vec3, col: Color, count: number, speed: number) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      particles.spawn({
        mesh: crystalMesh,
        blend: 'additive',
        position: at,
        velocity: [Math.cos(a) * speed, 1.2 + (i % 3) * 0.5, Math.sin(a) * speed],
        gravity: 4.0,
        spin: 10,
        scale: [0.10, 0.14, 0.10],
        endScale: 0.1,
        color: col,
        unlit: 1,
        life: 0.32
      })
    }
  }

  function consumeVfx(state: GameState) {
    for (const ev of state.vfx) {
      if (ev.kind === 'projectile') {
        const arrow = ev.style === 'arrow'
        shots.push({
          style: ev.style,
          from: ev.from,
          to: ev.to,
          peak: arrow ? 0.9 : 0.55,
          age: 0,
          life: arrow ? 0.28 : 0.34,
          trail: 0
        })
      } else if (ev.kind === 'burst') {
        const col = vfxColor(ev.style)
        const rad = ev.radius ?? 0.9
        const count = rad > 1.4 ? 16 : 9
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2
          const spd = (1.6 + (i % 3) * 0.7) * rad
          particles.spawn({
            mesh: crystalMesh,
            position: ev.at,
            velocity: [Math.cos(a) * spd, 1.8 + (i % 4) * 0.65, Math.sin(a) * spd],
            gravity: 5.2,
            spin: 9,
            scale: [0.18, 0.22, 0.18],
            color: col,
            unlit: 0.96,
            life: 0.48
          })
        }
      } else if (ev.kind === 'heal') {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          particles.spawn({
            mesh: crystalMesh,
            position: [ev.at[0] + Math.cos(a) * 0.4, ev.at[1], ev.at[2] + Math.sin(a) * 0.4],
            velocity: [0, 1.8 + (i % 3) * 0.3, 0],
            gravity: 0.4,
            spin: 6,
            scale: [0.14, 0.18, 0.14],
            color: C_HEAL,
            unlit: 0.96,
            life: 0.65
          })
        }
      } else if (ev.kind === 'shield') {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          particles.spawn({
            mesh: crystalMesh,
            position: [ev.at[0] + Math.cos(a) * 0.45, ev.at[1] + 0.2, ev.at[2] + Math.sin(a) * 0.45],
            velocity: [Math.cos(a) * 0.5, 0.8, Math.sin(a) * 0.5],
            gravity: 0.2,
            scale: [0.14, 0.16, 0.14],
            color: C_FROST,
            unlit: 0.95,
            life: 0.52
          })
        }
      } else if (ev.kind === 'ko') {
        hitStop = Math.max(hitStop, ev.isBoss ? 0.22 : 0.12)
        const count = ev.isBoss ? 22 : 12
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2
          particles.spawn({
            mesh: crystalMesh,
            position: ev.at,
            velocity: [Math.cos(a) * 2.6, 2.8 + (i % 4) * 0.8, Math.sin(a) * 2.6],
            gravity: 6.4,
            spin: 11,
            scale: [0.20, 0.24, 0.20],
            color: ev.isBoss ? C_SHADOW : C_FIRE_TIP,
            unlit: 0.95,
            life: 0.72
          })
        }
      } else if (ev.kind === 'levelup') {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2
          particles.spawn({
            mesh: crystalMesh,
            position: ev.at,
            velocity: [Math.cos(a) * 2.1, 3.2 + (i % 3) * 0.7, Math.sin(a) * 2.1],
            gravity: 4.5,
            spin: 10,
            scale: [0.18, 0.24, 0.18],
            color: C_HOLY,
            unlit: 0.98,
            life: 0.80
          })
        }
      }
    }
    state.vfx.length = 0
  }

  /** Advance and draw in-flight projectiles: oriented arrows, glowing spell orbs with particle trails. */
  function updateShots(dt: number, time: number) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i]
      s.age += dt
      const u = Math.min(1, s.age / s.life)
      const dx = s.to[0] - s.from[0], dy = s.to[1] - s.from[1], dz = s.to[2] - s.from[2]
      const x = s.from[0] + dx * u
      const y = s.from[1] + dy * u + Math.sin(u * Math.PI) * s.peak
      const z = s.from[2] + dz * u
      const col = vfxColor(s.style)
      if (u >= 1) {
        spawnSparks(s.to, s.style === 'arrow' ? C_ARROW : col, s.style === 'arrow' ? 5 : 8, s.style === 'arrow' ? 1.2 : 1.8)
        shots.splice(i, 1)
        continue
      }
      if (s.style === 'arrow') {
        const vy = dy + Math.cos(u * Math.PI) * Math.PI * s.peak
        const yaw = Math.atan2(dx, dz)
        const pitch = -Math.atan2(vy, Math.hypot(dx, dz))
        pool.add(arrowMesh, [x, y, z], [0.9, 0.9, 0.62], quaternionFromEuler(pitch, yaw, 0), C_ARROW, 0.35)
      } else {
        const pulse = 0.24 + Math.sin(time * 40) * 0.03
        pool.add(crystalMesh, [x, y, z], [pulse, pulse, pulse], time * 14, col, 1)
        pool.add(crystalMesh, [x, y, z], [pulse * 1.8, pulse * 1.8, pulse * 1.8], -time * 9, col, 1, 'additive')
        s.trail += dt
        while (s.trail >= 0.016) {
          s.trail -= 0.016
          particles.spawn({
            mesh: crystalMesh,
            blend: 'additive',
            position: [x, y, z],
            velocity: [Math.sin(time * 31 + i) * 0.4, 0.3, Math.cos(time * 29 + i) * 0.4],
            spin: 8,
            scale: [0.16, 0.16, 0.16],
            endScale: 0.05,
            color: col,
            unlit: 1,
            life: 0.28
          })
        }
      }
    }
  }

  function renderUnit(
    battle: BattleState,
    unit: BattleUnit,
    dt: number,
    realDt: number,
    isActive: boolean,
    isSelected: boolean,
    time: number
  ) {
    const fx = getFx(unit.uid, unit)
    const anim = fx.anim
    const rig = unit.team === 'ally' && unit.heroId
      ? resolveHeroRig(unit.heroId, {
          stars: unit.stars,
          weaponId: unit.weaponId,
          armorId: unit.armorId,
          relicId: unit.relicId
        })
      : ENEMY_RIGS[unit.enemyId ?? 'goblin']

    const scale = unit.isBoss ? 1.38
      : unit.enemyId === 'frost_golem' ? 1.24
      : unit.enemyId === 'goblin' ? 0.92
      : unit.stars === 3 ? 1.12
      : unit.stars === 2 ? 1.05
      : 1.0

    // ---------------------------------------------------------------- death: topple, sink, soul burst
    if (!unit.alive) {
      if (fx.wasAlive) {
        fx.wasAlive = false
        fx.deathT = 0
        fx.action = null
        anim.trigger('death', 0.04)
        const killer = getUnitByUid(battle, battle.activeUnitUid)
        if (killer && killer !== unit) {
          const kdx = killer.x - unit.x, kdz = killer.z - unit.z
          // Face the killer so the backward topple flies away from the blow
          if (Math.hypot(kdx, kdz) > 0.05) fx.yaw = Math.atan2(kdx, kdz)
        }
      }
      if (fx.deathT < 0 || fx.deathT > DEATH_TOTAL) return
      const before = fx.deathT
      fx.deathT += dt
      if (before < DEATH_SINK_START && fx.deathT >= DEATH_SINK_START) {
        spawnDust(unit.x, unit.y, unit.z, 8, 1.4)
        const soul = unit.team === 'ally' ? C_ALLY_SOUL : C_ENEMY_SOUL
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2
          particles.spawn({
            mesh: crystalMesh,
            blend: 'additive',
            position: [unit.x + Math.cos(a) * 0.3, unit.y + 0.25, unit.z + Math.sin(a) * 0.3],
            velocity: [Math.cos(a) * 0.4, 1.6 + (i % 3) * 0.5, Math.sin(a) * 0.4],
            gravity: -0.6,
            spin: 7,
            scale: [0.10, 0.16, 0.10],
            endScale: 0.1,
            color: soul,
            unlit: 1,
            life: 0.9
          })
        }
      }
      anim.step(dt)
      const pose = anim.evaluate()
      const sink = fx.deathT > DEATH_SINK_START ? Math.min(1, (fx.deathT - DEATH_SINK_START) / DEATH_SINK_TIME) : 0
      const ds = scale * (1 - sink * sink * 0.6)
      fx.pos[0] = unit.x
      fx.pos[1] = unit.y - sink * 0.45
      fx.pos[2] = unit.z
      const flash = fx.deathT < 0.12
      renderRig(rig, { position: fx.pos, yaw: fx.yaw, scale: ds }, pose, pool, (_jointId, part) => {
        if (flash) return C_HIT_FLASH
        if (part.name === 'weapon' && unit.weaponHex) return color(unit.weaponHex)
        return part.color
      })
      shadows.add([unit.x, unit.y + 0.02, unit.z], { groundY: unit.y, radius: 0.62 * ds, opacity: 0.30 * (1 - sink) })
      return
    }
    fx.wasAlive = true
    fx.deathT = -1

    // ---------------------------------------------------------------- action triggers (edge-detected from sim state)
    const st = unit.animState
    const retrigger = st !== fx.lastState || unit.animTimer > fx.lastTimer + 1e-3
    if (retrigger && (st === 'attack' || st === 'cast' || st === 'hit')) {
      const clip: UnitClipName = st === 'attack' ? attackClipFor(unit.heroId, unit.enemyId)
        : st === 'cast' ? castClipFor(unit.heroId, unit.enemyId)
        : 'hit'
      startAction(fx, clip, st === 'hit' ? 0.03 : 0.05)
      if (st === 'hit') {
        const attacker = getUnitByUid(battle, battle.activeUnitUid)
        if (attacker && attacker !== unit) {
          const kdx = unit.x - attacker.x, kdz = unit.z - attacker.z
          const d = Math.hypot(kdx, kdz) || 1
          fx.kbX = (kdx / d) * 0.24
          fx.kbZ = (kdz / d) * 0.24
        }
      }
    }
    fx.lastState = st
    fx.lastTimer = unit.animTimer

    if (fx.pendingReady && st === 'idle' && !fx.action && unit.path.length === 0) {
      fx.pendingReady = false
      startAction(fx, 'ready', 0.06)
    }

    // ---------------------------------------------------------------- clip selection
    const isForecastAttacker = Boolean(
      activeForecast &&
      battle.phase === 'player' &&
      activeForecast.attackerUid === unit.uid &&
      unit.path.length === 0 &&
      st !== 'run' &&
      !fx.action
    )
    if (st === 'run') {
      fx.action = null
      fx.pendingReady = false
      anim.play('run', 0.08, RUN_RATE)
    } else if (fx.action) {
      fx.actionT += dt
      if (fx.actionT >= fx.actionDur) fx.action = null
    }
    if (!fx.action && st !== 'run') {
      const victory = battle.phase === 'victory' && unit.team === 'ally'
      const gloat = battle.phase === 'defeat' && unit.team === 'enemy'
      if (victory || gloat || st === 'celebrate') {
        if (fx.celebrateDelay < 0) fx.celebrateDelay = fx.seed * 0.45
        fx.celebrateDelay = Math.max(0, fx.celebrateDelay - dt)
      } else {
        fx.celebrateDelay = -1
      }
      if (fx.celebrateDelay === 0) {
        anim.play(gloat ? 'taunt' : celebrateClipFor(fx.seed2), 0.12)
      } else if (isForecastAttacker && activeForecast) {
        anim.play(aimClipFor(unit.heroId, unit.enemyId, activeForecast.mode !== 'strike'), 0.12)
      } else {
        anim.play(idleClipFor(unit.team, unit.hp / Math.max(1, unit.maxHp), unit.stunTurns > 0), 0.18, idleRateFor(unit.enemyId, fx.seed2))
      }
    }
    anim.step(dt)

    // ---------------------------------------------------------------- smooth facing, knockback, hops, footfalls
    let desiredYaw = unit.yaw
    if (isForecastAttacker && activeForecast) {
      const tCell = battle.cells[activeForecast.targetRow]?.[activeForecast.targetCol]
      if (tCell) {
        const [tx, , tz] = gridToWorld(activeForecast.targetCol, activeForecast.targetRow, tCell.elevation, battle.cols, battle.rows)
        if (Math.hypot(tx - unit.x, tz - unit.z) > 0.05) {
          desiredYaw = Math.atan2(tx - unit.x, tz - unit.z)
        }
      }
    }
    fx.yaw += wrapAngle(desiredYaw - fx.yaw) * Math.min(1, realDt * 14)
    const kbDecay = Math.pow(0.002, dt)
    fx.kbX *= kbDecay
    fx.kbZ *= kbDecay

    let extraY = 0
    let leapK = 0
    if (unit.path.length > 0) {
      const next = unit.path[0]
      const e0 = battle.cells[unit.row][unit.col].elevation
      const e1 = battle.cells[next.row][next.col].elevation
      const de = Math.abs(e1 - e0)
      if (de > 0.1) {
        const s = Math.sin(Math.min(1, unit.moveProgress) * Math.PI)
        extraY = s * (0.22 + de * 0.45)
        leapK = s
      }
    }
    if (unit.col !== fx.lastCol || unit.row !== fx.lastRow) {
      const elev = battle.cells[unit.row][unit.col].elevation
      const jumped = Math.abs(elev - fx.lastElev) > 0.1
      spawnDust(unit.x, unit.y, unit.z, jumped ? 7 : 3, jumped ? 1.3 : 0.7)
      fx.landT = 0
      fx.landAmp = jumped ? 0.18 : 0.07
      fx.lastCol = unit.col
      fx.lastRow = unit.row
      fx.lastElev = elev
    }
    fx.landT += dt
    const squash = fx.landT < 0.2 ? Math.sin((fx.landT / 0.2) * Math.PI) * fx.landAmp : 0

    const clip = anim.clip
    const idleFamily = clip === 'idle' || clip === 'idle_enemy'
    fx.stanceW += ((idleFamily ? 1 : 0) - fx.stanceW) * Math.min(1, dt * 8)
    const additive = fillAdditive(fx, stanceOffsetFor(unit.heroId, unit.enemyId), fx.stanceW, leapK)
    const pose = anim.evaluate(additive)

    const px = unit.x + unit.lungeX + fx.kbX
    const pz = unit.z + unit.lungeZ + fx.kbZ
    const py = unit.y + extraY
    const flash = unit.hitFlash > 0
    fx.pos[0] = px
    fx.pos[1] = py
    fx.pos[2] = pz
    fx.scl[0] = scale * (1 + squash * 0.6)
    fx.scl[1] = scale * (1 - squash)
    fx.scl[2] = scale * (1 + squash * 0.6)

    renderRig(rig, { position: fx.pos, yaw: fx.yaw, scale: fx.scl }, pose, pool, (_jointId, part) => {
      if (flash) return C_HIT_FLASH
      if (part.name === 'weapon' && unit.weaponHex) return color(unit.weaponHex)
      return part.color
    })

    const groundY = unit.y
    shadows.add([px, groundY + 0.02, pz], { groundY, radius: 0.58 * scale * (1 - Math.min(0.35, extraY * 0.5)), opacity: 0.30 })

    // Colorblind-safe unit rings: Allies use smooth Circle ring, Enemies use Diamond ring + directional facing chevron!
    const ringColor = isActive ? C_ACTIVE_RING : isSelected ? C_SELECT_RING : unit.team === 'ally' ? C_ALLY_RING : C_ENEMY_RING
    const ringScale = (isActive ? 0.68 + Math.sin(time * 6) * 0.045 : 0.54) * scale
    if (unit.team === 'enemy') {
      pool.add(tileDiamondMesh, [px, groundY + 0.040, pz], [ringScale * 2.5, 1, ringScale * 2.5], 0, ringColor, 0.96, 'alpha')
    } else {
      pool.add(flatRing, [px, groundY + 0.038, pz], [ringScale, 1, ringScale], time * (isActive ? 1.1 : 0), ringColor, 0.95, 'alpha')
    }
    const facingCol = isActive ? C_ACTIVE_RING : unit.team === 'ally' ? C_FACING_ALLY : C_FACING_ENEMY
    const chevronS = (isActive ? 1.16 : 0.96) * scale
    pool.add(facingChevronMesh, [px, groundY + 0.046, pz], [chevronS, 1, chevronS], facingToYaw(unit.facing), facingCol, 0.98, 'alpha')

    if (unit.team === 'ally' && unit.stars >= 2) {
      const crownY = py + (1.72 + Math.sin(time * 3.4) * 0.05) * scale
      pool.add(crownMesh, [px, crownY, pz], [0.28, 0.22, 0.28], time * 1.1, C_STAR2_GOLD, 0.78)
    }
    if (unit.team === 'ally' && unit.stars >= 3) {
      pool.add(flatRing, [px, groundY + 0.056, pz], [0.76 * scale, 1, 0.76 * scale], -time * 1.4, C_STAR3_HALO, 0.95, 'additive')
    }
    if (unit.shield > 0) {
      pool.add(flatRing, [px, py + 0.56 * scale, pz], [0.58 * scale, 1, 0.58 * scale], time * 1.8, C_SHIELD, 0.9, 'additive')
    }
    if (unit.stunTurns > 0) {
      for (let i = 0; i < 3; i++) {
        const a = time * 4 + (i / 3) * Math.PI * 2
        pool.add(crystalMesh, [px + Math.cos(a) * 0.3, py + 1.7 * scale, pz + Math.sin(a) * 0.3], [0.08, 0.10, 0.08], a, C_FIRE_TIP, 1)
      }
    }
    if (unit.isBoss) {
      for (let i = 0; i < 3; i++) {
        const a = time * 1.6 + (i / 3) * Math.PI * 2
        pool.add(
          crystalMesh,
          [px + Math.cos(a) * 0.94, py + 1.18 + Math.sin(time * 3 + i) * 0.14, pz + Math.sin(a) * 0.94],
          [0.20, 0.30, 0.20],
          a,
          C_SHADOW,
          0.95
        )
      }
    }
  }

  /** Detect battle swaps, new active units (ready bounce), and fresh crits (hit-stop) from sim state. */
  function trackBattleEvents(battle: BattleState) {
    if (battle !== lastBattle) {
      lastBattle = battle
      unitFx.clear()
      shots.length = 0
      particles.clear()
      lastFloatId = -1
      lastActiveUid = null
      hitStop = 0
      cameraZoom = 1.0
      cameraZoomActual = 1.0
      cameraPitch = DEFAULT_CAMERA_PITCH
      cameraPitchActual = DEFAULT_CAMERA_PITCH
      cameraPanX = 0
      cameraPanZ = 0
      for (const fn of battle.floatingNumbers) lastFloatId = Math.max(lastFloatId, fn.id)
    }
    for (const fn of battle.floatingNumbers) {
      if (fn.id <= lastFloatId) continue
      lastFloatId = fn.id
      if (fn.text.startsWith('CRIT')) hitStop = Math.max(hitStop, 0.1)
    }
    if (battle.activeUnitUid !== lastActiveUid) {
      lastActiveUid = battle.activeUnitUid
      const active = getUnitByUid(battle, battle.activeUnitUid)
      if (active && active.alive && (battle.phase === 'player' || battle.phase === 'enemy')) {
        getFx(active.uid, active).pendingReady = true
      }
    }
  }

  function renderBattle(state: GameState, dt: number, w: number, h: number): Readonly<RenderStats> {
    const battle = state.battle
    if (!battle) return renderer.render(lastMatrix, campBatches)

    ensureBoard(battle)
    applyBattleLightingOnce(battle)
    trackBattleEvents(battle)
    consumeVfx(state)
    // Hit-stop: briefly freeze character animation on crits and knockouts for weight
    const animDt = hitStop > 0 ? dt * 0.06 : dt
    hitStop = Math.max(0, hitStop - dt)
    particles.step(dt)
    pool.clear()
    shadows.clear()

    const style = BIOME_STYLES[battle.biome]
    const shakeX = battle.shake > 0 ? Math.sin(state.time * 48) * battle.shake * 0.18 : 0
    const shakeY = battle.shake > 0 ? Math.cos(state.time * 54) * battle.shake * 0.12 : 0

    cameraZoomActual += (cameraZoom - cameraZoomActual) * Math.min(1, dt * 14)
    cameraPitchActual += (cameraPitch - cameraPitchActual) * Math.min(1, dt * 14)
    const maxPan = Math.max(0, (1.02 - cameraZoomActual) * 8.0)
    cameraPanX = Math.max(-maxPan, Math.min(maxPan, cameraPanX))
    cameraPanZ = Math.max(-maxPan, Math.min(maxPan, cameraPanZ))

    const aspect = Math.max(0.32, w / Math.max(1, h))
    const isPhonePortrait = aspect < 0.85
    const isPhoneLandscape = !isPhonePortrait && h < 480
    const boardScale = Math.max(0.86, Math.max(battle.cols / 8, battle.rows / 6))
    const baseDist = (isPhonePortrait
      ? 14.4 / Math.max(0.40, aspect)
      : isPhoneLandscape ? 15.0
      : aspect < 1.15 ? 16.5 : 14.2) * boardScale
    const baseEyeY = (isPhonePortrait ? baseDist * 0.78 : (isPhoneLandscape ? 12.2 : 11.8) * boardScale)
    const baseHoriz = baseDist * 0.92 + (isPhonePortrait ? 2.0 : 1.2)
    const orbitRadius = Math.hypot(baseHoriz, baseEyeY) * cameraZoomActual
    const horizDist = Math.cos(cameraPitchActual) * orbitRadius
    const eyeY = Math.sin(cameraPitchActual) * orbitRadius
    const camYaw = cameraYawOffset
    const baseTargetZ = isPhonePortrait ? 0.9 : isPhoneLandscape ? 0.72 : 0.35
    const eye: Vec3 = [
      cameraPanX + Math.sin(camYaw) * horizDist * 0.88 + shakeX,
      eyeY + shakeY,
      cameraPanZ + Math.cos(camYaw) * horizDist + baseTargetZ
    ]
    const target: Vec3 = [cameraPanX, -0.2, cameraPanZ + baseTargetZ]
    lastMatrix = multiply(perspective(Math.PI / 3.9, aspect, 0.5, 220), view(eye, target))

    // 1. Move tiles: Hollow Square Frame + center dot (unmistakable vs Attack [X] even in grayscale!)
    for (const tile of battle.moveTiles) {
      const cell = battle.cells[tile.row][tile.col]
      const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
      pool.add(tileQuad, [wx, wy + 0.024, wz], [TILE_SIZE * 0.84, 1, TILE_SIZE * 0.84], 0, C_MOVE_TILE, 0.92, 'alpha')
      pool.add(tileFrameMesh, [wx, wy + 0.032, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_MOVE_BORDER, 0.96, 'alpha')
      pool.add(tileDotMesh, [wx, wy + 0.034, wz], [TILE_SIZE * 0.84, 1, TILE_SIZE * 0.84], 0, C_MOVE_BORDER, 0.96, 'alpha')
    }

    const activeUnit = getUnitByUid(battle, battle.activeUnitUid)
    const armedSkill = activeUnit && battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0
      ? getHeroSkill(activeUnit, battle.armedSkillIndex)
      : null
    const armedTactic = battle.armedTacticUid
      ? (() => {
          const owned = getTacticByUid(state.campaign, battle.armedTacticUid)
          return owned ? TACTIC_BY_ID[owned.tacticId] : null
        })()
      : null
    const isAllyTarget = Boolean(
      (armedSkill && (armedSkill.target === 'ally' || armedSkill.target === 'self')) ||
      (armedTactic && (armedTactic.target === 'ally' || armedTactic.target === 'any'))
    )

    // 2. Direct target tiles: distinct geometric icons (+ for Support/Heal, bold X + brackets for Attack, faint corners for free space)
    const bracketPulse = 1 + Math.sin(state.time * 6.0) * 0.045
    for (const tile of battle.targetTiles) {
      const cell = battle.cells[tile.row][tile.col]
      const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
      const occupant = unitAt(battle, tile.col, tile.row)
      if (armedSkill) {
        const recommended = isAllyTarget
          ? Boolean(occupant && occupant.team === 'ally')
          : Boolean(occupant && occupant.team === 'enemy')
        if (!recommended) {
          // Quiet free-space skill range footprint (subtle corner ticks so we never encourage clicking empty air or allies)
          pool.add(tileQuad, [wx, wy + 0.028, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_FREE_RANGE_TILE, 0.92, 'alpha')
          pool.add(tileCornersMesh, [wx, wy + 0.036, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_FREE_RANGE_MARK, 0.95, 'alpha')
          continue
        }
      }
      if (isAllyTarget) {
        pool.add(tileQuad, [wx, wy + 0.032, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_ALLY_TARGET, 0.95, 'alpha')
        pool.add(tilePlusMesh, [wx, wy + 0.042, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_ALLY_MARK, 0.98, 'alpha')
        pool.add(tileCornersMesh, [wx, wy + 0.040, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_ALLY_MARK, 0.96, 'alpha')
      } else {
        pool.add(tileQuad, [wx, wy + 0.032, wz], [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86], 0, C_ATTACK_TILE, 0.95, 'alpha')
        pool.add(tileCrossMesh, [wx, wy + 0.044, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_ATTACK_MARK, 0.98, 'alpha')
        pool.add(tileCornersMesh, [wx, wy + 0.042, wz], [TILE_SIZE * 0.90 * bracketPulse, 1, TILE_SIZE * 0.90 * bracketPulse], 0, C_ATTACK_MARK, 0.98, 'alpha')
      }
    }

    // 3. Move+Attack reachable targets: distinct bold Diamond + Corner Brackets + rotating ring!
    for (const tile of battle.moveAttackTiles) {
      const cell = battle.cells[tile.row][tile.col]
      const [wx, wy, wz] = gridToWorld(tile.col, tile.row, cell.elevation, battle.cols, battle.rows)
      pool.add(
        tileQuad,
        [wx, wy + 0.030, wz],
        [TILE_SIZE * 0.84, 1, TILE_SIZE * 0.84],
        0,
        isAllyTarget ? C_ALLY_TARGET : C_MOVE_ATTACK_TILE,
        0.95,
        'alpha'
      )
      pool.add(
        isAllyTarget ? tilePlusMesh : tileDiamondMesh,
        [wx, wy + 0.042, wz],
        [TILE_SIZE * 0.86, 1, TILE_SIZE * 0.86],
        0,
        isAllyTarget ? C_ALLY_MARK : C_MOVE_ATTACK_MARK,
        0.98,
        'alpha'
      )
      pool.add(tileCornersMesh, [wx, wy + 0.040, wz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, isAllyTarget ? C_ALLY_MARK : C_MOVE_ATTACK_MARK, 0.96, 'alpha')
      const pulse = 0.60 + Math.sin(state.time * 5.5) * 0.05
      pool.add(flatRing, [wx, wy + 0.044, wz], [pulse, 1, pulse], state.time * 1.4, C_FORECAST_ARC, 0.96, 'alpha')
    }

    const previewCell = activeForecast
      ? { col: activeForecast.targetCol, row: activeForecast.targetRow }
      : hoveredCell

    if (previewCell && battle.phase === 'player' && previewCell.row < battle.rows && previewCell.col < battle.cols) {
      const hCell = battle.cells[previewCell.row][previewCell.col]
      const [hx, hy, hz] = gridToWorld(previewCell.col, previewCell.row, hCell.elevation, battle.cols, battle.rows)
      pool.add(tileQuad, [hx, hy + 0.042, hz], [TILE_SIZE * 0.90, 1, TILE_SIZE * 0.90], 0, C_HOVER_TILE, 0.95, 'alpha')
      pool.add(tileFrameMesh, [hx, hy + 0.054, hz], [TILE_SIZE * 0.94, 1, TILE_SIZE * 0.94], 0, C_HOVER_BORDER, 0.98, 'alpha')

      const isValidPreviewTarget =
        battle.targetTiles.some(t => t.col === previewCell.col && t.row === previewCell.row) ||
        battle.moveAttackTiles.some(t => t.col === previewCell.col && t.row === previewCell.row)
      if (isValidPreviewTarget && (armedSkill || armedTactic)) {
        const pattern = armedSkill ? armedSkill.pattern : armedTactic ? armedTactic.pattern : 'single'
        const previewCells = (pattern === 'cross' || pattern === 'area3' || pattern === 'aura')
          ? getPatternCells(previewCell.col, previewCell.row, pattern, battle.cols, battle.rows)
          : [previewCell]
        const isOffensiveSkill = Boolean(armedSkill && armedSkill.powerMul > 0)
        for (const pc of previewCells) {
          const c = battle.cells[pc.row][pc.col]
          const [px, py, pz] = gridToWorld(pc.col, pc.row, c.elevation, battle.cols, battle.rows)
          const occ = unitAt(battle, pc.col, pc.row)
          const isFriendlyHit = isOffensiveSkill && Boolean(
            occ && occ.team === 'ally' &&
            !(activeUnit && occ.uid === activeUnit.uid && !(previewCell.col === activeUnit.col && previewCell.row === activeUnit.row))
          )
          if (isFriendlyHit) {
            pool.add(tileQuad, [px, py + 0.052, pz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_FRIENDLY_FIRE_TILE, 0.98, 'alpha')
            pool.add(tileCrossMesh, [px, py + 0.058, pz], [TILE_SIZE * 0.92, 1, TILE_SIZE * 0.92], 0, C_FRIENDLY_FIRE_MARK, 0.98, 'alpha')
            pool.add(tileFrameMesh, [px, py + 0.056, pz], [TILE_SIZE * 0.92, 1, TILE_SIZE * 0.92], 0, C_FRIENDLY_FIRE_MARK, 0.98, 'alpha')
          } else if (pattern === 'cross' || pattern === 'area3' || pattern === 'aura') {
            pool.add(tileQuad, [px, py + 0.046, pz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_AOE_PREVIEW, 0.96, 'alpha')
            pool.add(tileDiamondMesh, [px, py + 0.052, pz], [TILE_SIZE * 0.88, 1, TILE_SIZE * 0.88], 0, C_AOE_MARK, 0.98, 'alpha')
          }
        }
      }
    }

    // Pre-attack 3D tactical preview: Move+Attack path, landing ring, pulsing lock-on reticle & targeting arc
    if (activeForecast && battle.phase === 'player' && !battle.units.some(u => u.path.length > 0)) {
      const fc = activeForecast
      const isHelpful = !fc.isOffensive && fc.targetTeam === 'ally'
      const arcCol = fc.friendlyFire ? C_FORECAST_FF_ARC : isHelpful ? C_FORECAST_ALLY_ARC : fc.emptyTileTarget ? C_EMPTY_RETICLE : C_FORECAST_ARC
      const reticleCol = fc.friendlyFire ? C_FRIENDLY_FIRE_TILE : isHelpful ? C_ALLY_TARGET : fc.emptyTileTarget ? C_EMPTY_RETICLE : C_TARGET_RETICLE
      const tCell = battle.cells[fc.targetRow][fc.targetCol]
      const [tx, ty, tz] = gridToWorld(fc.targetCol, fc.targetRow, tCell.elevation, battle.cols, battle.rows)

      // Pulsing lock-on reticle & hovering diamond above target
      const rPulse = 0.72 + Math.sin(state.time * 7.5) * 0.08
      pool.add(flatRing, [tx, ty + 0.056, tz], [rPulse, 1, rPulse], -state.time * 2.4, reticleCol, 0.98, 'additive')
      pool.add(
        crystalMesh,
        [tx, ty + 2.05 + Math.sin(state.time * 6.5) * 0.12, tz],
        [0.16, 0.26, 0.16],
        state.time * 3.4,
        reticleCol,
        1.0
      )

      // Move+Attack approach path breadcrumbs + landing ring
      if (fc.requiresMove && fc.path.length > 0) {
        const aCell = battle.cells[fc.approachRow][fc.approachCol]
        const [ax, ay, az] = gridToWorld(fc.approachCol, fc.approachRow, aCell.elevation, battle.cols, battle.rows)
        const landPulse = 0.62 + Math.sin(state.time * 6.0) * 0.06
        pool.add(flatRing, [ax, ay + 0.052, az], [landPulse, 1, landPulse], state.time * 1.8, C_APPROACH_RING, 0.98, 'additive')
        for (let i = 0; i < fc.path.length; i++) {
          const step = fc.path[i]
          const sc = battle.cells[step.row][step.col]
          const [sx, sy, sz] = gridToWorld(step.col, step.row, sc.elevation, battle.cols, battle.rows)
          const bob = Math.sin(state.time * 6 - i * 0.9) * 0.05
          pool.add(crystalMesh, [sx, sy + 0.24 + bob, sz], [0.12, 0.12, 0.12], state.time * 2.5 + i, C_APPROACH_RING, 0.98, 'additive')
        }
      }

      // Animated parabolic targeting arc from approach (or current) position to target
      const fromCell = battle.cells[fc.approachRow][fc.approachCol]
      const [fx, fy, fz] = gridToWorld(fc.approachCol, fc.approachRow, fromCell.elevation, battle.cols, battle.rows)
      const dx = tx - fx
      const dz = tz - fz
      const dist = Math.hypot(dx, dz)
      if (dist > 0.2) {
        const peak = Math.min(1.85, 0.55 + dist * 0.24)
        const beadCount = 8
        const flow = (state.time * 1.35) % 1
        for (let i = 0; i < beadCount; i++) {
          const u = ((i + flow) / beadCount)
          if (u < 0.06 || u > 0.96) continue
          const bx = fx + dx * u
          const bz = fz + dz * u
          const by = (fy + 0.92) + ((ty + 0.85) - (fy + 0.92)) * u + Math.sin(u * Math.PI) * peak
          const sz = 0.09 + Math.sin(u * Math.PI) * 0.06
          pool.add(crystalMesh, [bx, by, bz], [sz, sz, sz], state.time * 4 + i, arcCol, 1.0, 'additive')
        }
      }
    }

    // Floating turn motes spiral up around the active unit
    if (activeUnit && activeUnit.alive && activeUnit.path.length === 0 && (battle.phase === 'player' || battle.phase === 'enemy')) {
      moteTimer += dt
      while (moteTimer >= 0.11) {
        moteTimer -= 0.11
        const a = state.time * 5.3
        particles.spawn({
          mesh: crystalMesh,
          blend: 'additive',
          position: [activeUnit.x + Math.cos(a) * 0.48, activeUnit.y + 0.1, activeUnit.z + Math.sin(a) * 0.48],
          velocity: [-Math.sin(a) * 0.35, 0.9, Math.cos(a) * 0.35],
          spin: 6,
          scale: [0.06, 0.09, 0.06],
          endScale: 0.2,
          color: activeUnit.team === 'ally' ? C_ALLY_MOTE : C_ENEMY_MOTE,
          unlit: 1,
          life: 0.95
        })
      }
    }

    for (const unit of battle.units) {
      renderUnit(battle, unit, animDt, dt, unit.uid === battle.activeUnitUid, unit.uid === battle.selectedUnitUid, state.time)
    }

    updateShots(dt, state.time)
    particles.emit(pool)

    const batches: InstanceBatch[] = [...boardBatches]
    if (shadows.batch.count > 0) batches.push(shadows.batch)
    for (const b of pool.batches) {
      if (b.count > 0) batches.push(b)
    }
    return renderer.render(lastMatrix, batches, style.sky)
  }

  function renderCamp(state: GameState, dt: number, w: number, h: number): Readonly<RenderStats> {
    applyCampLightingOnce()
    if (lastBattle) {
      lastBattle = null
      shots.length = 0
      particles.clear()
    }
    particles.step(dt)
    pool.clear()
    shadows.clear()

    fireTimer += dt
    if (fireTimer >= 0.14) {
      fireTimer = 0
      const a = (state.time * 4.7) % (Math.PI * 2)
      particles.spawn({
        mesh: crystalMesh,
        position: [Math.cos(a) * 0.16, 0.24, 2.0 + Math.sin(a) * 0.16],
        velocity: [Math.cos(a) * 0.32, 1.38, Math.sin(a) * 0.32],
        gravity: -0.2,
        scale: [0.12, 0.16, 0.12],
        color: C_FIRE_TIP,
        unlit: 0.98,
        life: 0.62
      })
    }

    // Layered warm stylized flames dancing in the stone-ring campfire
    const flameScale = 0.34 + Math.sin(state.time * 10) * 0.045
    pool.add(crystalMesh, [0, 0.32, 2.0], [flameScale, flameScale * 1.48, flameScale], state.time * 2.2, C_FIRE_CORE, 0.98)
    pool.add(crystalMesh, [0, 0.42, 2.0], [flameScale * 0.58, flameScale * 0.95, flameScale * 0.58], -state.time * 2.6, C_FIRE_TIP, 0.98)

    const aspect = Math.max(0.32, w / Math.max(1, h))
    const orbit = Math.sin(state.time * 0.20) * 0.22
    const campShiftTarget = campFraming === 'camp' ? 1 : 0
    campShift += (campShiftTarget - campShift) * Math.min(1, dt * 6)
    const dist = aspect < 0.85
      ? 6.1 / Math.max(0.45, aspect)
      : (h < 480 ? 9.4 : 8.4) + campShift * 0.6
    const eyeY = (aspect < 0.85 ? 5.2 : 4.3) + campShift * 0.55
    const targetY = 0.46 - campShift * (aspect < 0.85 ? 1.85 : h < 480 ? 0.6 : 1.15)
    const targetZ = -0.35 + campShift * 0.65
    const eye: Vec3 = [Math.sin(orbit) * dist, eyeY, Math.cos(orbit) * dist + 1.3]
    const target: Vec3 = [0, targetY, targetZ]
    lastMatrix = multiply(perspective(Math.PI / 3.9, aspect, 0.5, 90), view(eye, target))

    const squad: OwnedHeroCard[] = state.campaign.squadUids
      .map(uid => getHeroByUid(state.campaign, uid))
      .filter((hero): hero is OwnedHeroCard => Boolean(hero))
    const count = squad.length
    for (let i = 0; i < count; i++) {
      const hero = squad[i]
      const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2
      const hx = offset * 2.35
      const hz = -0.35 + Math.abs(offset) * 0.55
      const yaw = Math.atan2(-hx, 2.2 - hz)
      const isSelected = hero.uid === state.campaign.selectedCampHeroUid
      const scale = hero.stars === 3 ? 1.16 : hero.stars === 2 ? 1.07 : 1.0
      const fx = getFx('camp_' + hero.uid)
      const anim = fx.anim

      // Occasional idle fidgets: look around, weapon flourish, stretch
      if (fx.action) {
        fx.actionT += dt
        if (fx.actionT >= fx.actionDur) fx.action = null
      } else {
        fx.fidgetTimer -= dt
        if (fx.fidgetTimer <= 0) {
          fx.fidgetCount++
          const pick = (fx.seed * 7.31 + fx.fidgetCount * 0.618) % 1
          startAction(fx, CAMP_FIDGETS[Math.floor(pick * CAMP_FIDGETS.length)], 0.3)
          fx.fidgetTimer = 4 + ((fx.seed2 * 3.7 + fx.fidgetCount * 0.414) % 1) * 6
        } else {
          anim.play('idle', 0.3, 0.9 + fx.seed2 * 0.2)
        }
      }
      anim.step(dt)
      fx.stanceW += ((anim.clip === 'idle' ? 1 : 0) - fx.stanceW) * Math.min(1, dt * 5)
      const pose = anim.evaluate(fillAdditive(fx, stanceOffsetFor(hero.heroId), fx.stanceW, 0))
      const campRig = resolveHeroRig(hero.heroId, {
        stars: hero.stars,
        weaponId: getEquipmentByUid(state.campaign, hero.weaponUid)?.equipId,
        armorId: getEquipmentByUid(state.campaign, hero.armorUid)?.equipId,
        relicId: getEquipmentByUid(state.campaign, hero.relicUid)?.equipId
      })
      renderRig(campRig, { position: [hx, 0.04, hz], yaw, scale }, pose, pool)
      shadows.add([hx, 0.06, hz], { groundY: 0.04, radius: 0.58 * scale, opacity: 0.30 })
      if (isSelected) {
        pool.add(flatRing, [hx, 0.065, hz], [0.72 * scale, 1, 0.72 * scale], state.time * 1.0, C_ACTIVE_RING, 0.95, 'alpha')
      }
      if (hero.stars >= 2) {
        pool.add(crownMesh, [hx, (1.72 + Math.sin(state.time * 3 + i) * 0.05) * scale, hz], [0.28, 0.22, 0.28], state.time, C_STAR2_GOLD, 0.8)
      }
      if (hero.stars >= 3) {
        pool.add(flatRing, [hx, 0.08, hz], [0.80 * scale, 1, 0.80 * scale], -state.time * 1.3, C_STAR3_HALO, 0.95, 'additive')
      }
    }

    particles.emit(pool)

    const batches: InstanceBatch[] = [...campBatches]
    if (shadows.batch.count > 0) batches.push(shadows.batch)
    for (const b of pool.batches) if (b.count > 0) batches.push(b)
    return renderer.render(lastMatrix, batches, C_CAMP_SKY)
  }

  function pickCellAt(
    battle: BattleState | null,
    cssX: number,
    cssY: number,
    width: number,
    height: number
  ): { col: number; row: number } | null {
    if (!battle) return null
    const ray = screenToRay(lastMatrix, cssX, cssY, width, height)
    if (!ray) return null
    const highHit = intersectRayPlane(ray.origin, ray.direction, 0.45)
    if (highHit) {
      const cell = worldToGrid(highHit[0], highHit[2], battle.cols, battle.rows)
      if (cell && battle.cells[cell.row][cell.col].elevation >= 0.35) return cell
    }
    const baseHit = intersectRayPlane(ray.origin, ray.direction, 0.0)
    if (!baseHit) return null
    return worldToGrid(baseHit[0], baseHit[2], battle.cols, battle.rows)
  }

  function project(x: number, y: number, z: number, width: number, height: number) {
    return worldToScreen(lastMatrix, x, y, z, width, height)
  }

  return {
    render(state: GameState, dt: number, width: number, height: number): Readonly<RenderStats> {
      if (state.battle) return renderBattle(state, dt, width, height)
      return renderCamp(state, dt, width, height)
    },
    setCampFraming(mode: 'title' | 'camp' | 'story' | 'world') {
      campFraming = mode
    },
    pickCellAt,
    setHoveredCell(cell: { col: number; row: number } | null) {
      hoveredCell = cell
    },
    getHoveredCell() {
      return hoveredCell
    },
    setForecast(forecast: CombatForecast | null) {
      activeForecast = forecast
    },
    rotateCamera(delta: number) {
      cameraYawOffset = Math.max(-0.85, Math.min(0.85, cameraYawOffset + delta))
    },
    tiltCamera(delta: number) {
      cameraPitch = Math.max(MIN_CAMERA_PITCH, Math.min(MAX_CAMERA_PITCH, cameraPitch + delta))
    },
    setCameraPitch(p: number) {
      cameraPitch = Math.max(MIN_CAMERA_PITCH, Math.min(MAX_CAMERA_PITCH, p))
    },
    getCameraPitch() {
      return cameraPitch
    },
    getCameraPitchBounds() {
      return { min: MIN_CAMERA_PITCH, max: MAX_CAMERA_PITCH }
    },
    zoomCamera(factor: number) {
      cameraZoom = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, cameraZoom * factor))
    },
    setCameraZoom(z: number) {
      cameraZoom = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, z))
    },
    getCameraZoom() {
      return cameraZoom
    },
    getCameraZoomBounds() {
      return { min: MIN_CAMERA_ZOOM, max: MAX_CAMERA_ZOOM }
    },
    panCamera(dx: number, dz: number) {
      const maxPan = Math.max(0, (1.02 - cameraZoom) * 8.0)
      if (maxPan <= 0) {
        cameraPanX = 0
        cameraPanZ = 0
        return
      }
      const c = Math.cos(cameraYawOffset)
      const s = Math.sin(cameraYawOffset)
      cameraPanX = Math.max(-maxPan, Math.min(maxPan, cameraPanX + dx * c + dz * s))
      cameraPanZ = Math.max(-maxPan, Math.min(maxPan, cameraPanZ - dx * s + dz * c))
    },
    resetCamera() {
      cameraYawOffset = 0
      cameraPitch = DEFAULT_CAMERA_PITCH
      cameraZoom = 1.0
      cameraPanX = 0
      cameraPanZ = 0
    },
    project,
    dispose() {
      for (const b of campBatches) renderer.release(b)
      for (const b of boardBatches) renderer.release(b)
      renderer.release(shadows.batch)
      for (const b of pool.batches) renderer.release(b)
    }
  }
}
