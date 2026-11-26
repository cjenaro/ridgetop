import {
  applySpriteOutline, archMesh, bakeVertexAO, bevelBox, capsuleMesh, color, createMeshPool,
  cylinder, gableMesh, instances, mesh, multiply, orthographic,
  quaternionFromEuler, renderMeshPixels, renderRig, revolvedMesh, scallopedCone, smoothMesh,
  tubeMesh, view
} from 'ridgetop'
import type { Color, InstanceBatch, JointPose, LightingOptions, Rig, Vec3 } from 'ridgetop'
import {
  GRID_COLS, GRID_ROWS, HEIGHT_STEP, TILE_SIZE, cellHeightLevel, gridToWorld
} from './types.ts'
import type { BiomeId, EnemyArchetypeId, GridCell, HeroClassId, TileTerrain } from './types.ts'
import { ENEMY_RIGS, resolveHeroRig } from './characters.ts'
import type { HeroVisualLoadout } from './characters.ts'

export {
  ENEMY_CHARACTER_SPECS, ENEMY_RIGS, HERO_CHARACTER_SPECS, HERO_RIGS,
  crownshardCharacterBuilder, resolveHeroCharacterSpec, resolveHeroRig
} from './characters.ts'
export type { HeroVisualLoadout } from './characters.ts'
export { UNIT_CLIPS, stanceOffsetFor } from './animations.ts'
import { stanceOffsetFor } from './animations.ts'

// =========================================================================
// SCULPTED STYLIZED DIORAMA MESH LIBRARY (3D Bevels, Scalloped Foliage, Props)
// =========================================================================

export const tileCapMesh = bakeVertexAO(bevelBox(0.15), { strength: 0.16, verticalGradient: 0.12 })
export const tileBaseMesh = bakeVertexAO(bevelBox(0.11), { strength: 0.22, verticalGradient: 0.18 })
export const softBevel = bakeVertexAO(bevelBox(0.20), { strength: 0.16, verticalGradient: 0.10 })
export const crispBevel = bakeVertexAO(bevelBox(0.09), { strength: 0.18, verticalGradient: 0.10 })

export const chunkyPill = bakeVertexAO(capsuleMesh(0.38, 1.0, 8, 2), { strength: 0.15, verticalGradient: 0.11 })
export const roundPebble = bakeVertexAO(capsuleMesh(0.48, 0.96, 6, 2), { strength: 0.16, verticalGradient: 0.12 })
export const collarRing = bakeVertexAO(
  smoothMesh(
    revolvedMesh([
      [0.34, -0.48], [0.52, -0.20], [0.52, 0.22], [0.34, 0.48], [0.26, 0], [0.34, -0.48]
    ], 8),
    72
  ),
  { strength: 0.18, verticalGradient: 0.10 }
)

export const smoothCyl = bakeVertexAO(smoothMesh(cylinder(8, 1, 1), 54), { strength: 0.16, verticalGradient: 0.10 })
export const taperTrunk = bakeVertexAO(smoothMesh(cylinder(8, 0.64, 1.18), 58), { strength: 0.22, verticalGradient: 0.18 })
export const smoothCone = bakeVertexAO(smoothMesh(cylinder(8, 0, 1), 56), { strength: 0.18, verticalGradient: 0.14 })

export const foliageTier = bakeVertexAO(scallopedCone(6, 0.22, 0.15), { strength: 0.18, verticalGradient: 0.16 })
export const foliageTip = bakeVertexAO(scallopedCone(6, 0.20, 0), { strength: 0.16, verticalGradient: 0.14 })

export const crystalMesh = bakeVertexAO(
  revolvedMesh([[0, -0.50], [0.42, -0.10], [0.44, 0.12], [0, 0.50]], 6),
  { strength: 0.14, verticalGradient: 0.12 }
)

export const archProp = bakeVertexAO(smoothMesh(archMesh(), 42), { strength: 0.22, verticalGradient: 0.12 })
export const gableRoof = bakeVertexAO(gableMesh(), { strength: 0.18, verticalGradient: 0.12 })

export const lanternHookMesh = bakeVertexAO(
  smoothMesh(
    tubeMesh(
      [[0, 0, 0], [0, 0.42, 0], [0, 0.62, 0.14], [0, 0.66, 0.34], [0, 0.54, 0.46]],
      [0.058, 0.050, 0.044, 0.040, 0.036],
      7
    ),
    68
  ),
  { strength: 0.16, verticalGradient: 0.10 }
)

export const crownMesh = (() => {
  const pts: number[] = []
  const idx: number[] = []
  const segs = 10
  const r = 0.46
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    const topY = i % 2 === 0 ? 0.52 : 0.12
    pts.push(c * r, -0.30, s * r, c * r * 1.08, topY, s * r * 1.08)
    const cur = i * 2
    const nxt = ((i + 1) % segs) * 2
    idx.push(cur, nxt, nxt + 1, cur, nxt + 1, cur + 1)
    idx.push(cur, nxt + 1, nxt, cur, cur + 1, nxt + 1)
  }
  return mesh(pts, idx)
})()

export const flatRing = (() => {
  const segs = 24
  const inner = 0.78, outer = 1.0
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    pos.push(c * inner, 0, s * inner, c * outer, 0, s * outer)
    const cur = i * 2
    const nxt = ((i + 1) % segs) * 2
    idx.push(cur, nxt + 1, cur + 1, cur, nxt, nxt + 1)
  }
  return mesh(pos, idx)
})()

export const tileQuad = mesh(
  [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
  [0, 3, 2, 0, 2, 1]
)

// =========================================================================
// COZY MINIATURE DIORAMA PALETTE
// =========================================================================

const C_STEEL_DARK = color('48546b')
const C_GOLD = color('ebb649')
const C_GOLD_BRIGHT = color('ffe68a')
const C_WOOD = color('a8643c')
const C_WOOD_WARM = color('c47b4b')
const C_WOOD_DARK = color('73442a')
const C_LEATHER_LIGHT = color('ad7449')
const C_CRIMSON = color('d94848')
const C_FOREST = color('2d8759')
const C_FOREST_MID = color('3ea368')
const C_FOREST_LIGHT = color('58bf78')
const C_AUTUMN_DEEP = color('b8582e')
const C_AUTUMN_MID = color('d67438')
const C_AUTUMN_LIGHT = color('ee9648')
const C_VIOLET = color('8f57cf')
const C_CYAN = color('70efff')
const C_IVORY = color('f7f1e3')
const C_STONE_LIGHT = color('adb5c9')
const C_STONE_MID = color('8c95ab')
const C_STONE_DARK = color('656e85')
const C_ICE = color('a8e6ff')
const C_ICE_DEEP = color('478fc4')
const C_OBSIDIAN = color('2f2a40')
const C_EMBER = color('ff7338')
const C_SHADOW_GLOW = color('d45eff')
const C_LANTERN_GLOW = color('ffdf78')

// =========================================================================
// CRISP 96x96 3D-BAKED CHARACTER PORTRAIT GENERATOR
// =========================================================================

export interface PortraitPixels {
  readonly size: number
  readonly pixels: Uint8ClampedArray<ArrayBuffer>
}

const heroPortraitPixelCache = new Map<string, PortraitPixels>()

/** Canonical cache key for a loadout-aware hero bust portrait (matches base heroId when 1★ unequipped). */
export function heroPortraitKey(heroId: HeroClassId, loadout?: HeroVisualLoadout): string {
  const stars = loadout?.stars ?? 1
  const weaponId = loadout?.weaponId ?? ''
  const armorId = loadout?.armorId ?? ''
  const relicId = loadout?.relicId ?? ''
  if (stars === 1 && !weaponId && !armorId && !relicId) return heroId
  return `${heroId}:${stars}:${weaponId}:${armorId}:${relicId}`
}

/** Lazily bake & cache a DOM-free 3D bust portrait reflecting a hero's stars and equipped gear. */
export function getHeroPortraitPixels(heroId: HeroClassId, loadout?: HeroVisualLoadout, size = 96): PortraitPixels {
  const baseKey = heroPortraitKey(heroId, loadout)
  const cacheKey = size === 96 ? baseKey : `${baseKey}@${size}`
  const cached = heroPortraitPixelCache.get(cacheKey)
  if (cached) return cached
  const rig = resolveHeroRig(heroId, loadout)
  const baked = bakeRigPortrait(rig, stanceOffsetFor(heroId), size)
  heroPortraitPixelCache.set(cacheKey, baked)
  return baked
}

function pixelsToCanvas(portrait: PortraitPixels): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = portrait.size
  canvas.height = portrait.size
  const ctx = canvas.getContext('2d')
  if (ctx && typeof ImageData !== 'undefined') {
    ctx.putImageData(new ImageData(portrait.pixels, portrait.size, portrait.size), 0, 0)
  }
  return canvas
}

export interface PortraitStore {
  /** Pre-baked baseline portraits keyed by heroId / enemyId (empty when running headless without DOM). */
  readonly base: Record<string, HTMLCanvasElement>
  /** Retrieve a baseline portrait canvas by hero/enemy id. */
  getBase(id: string): HTMLCanvasElement | undefined
  /** Lazily bake & cache a loadout-aware 3D hero bust portrait canvas (returns undefined headless). */
  getHero(heroId: HeroClassId, loadout?: HeroVisualLoadout): HTMLCanvasElement | undefined
  /** Lazily bake & cache DOM-free portrait pixels for a hero loadout (works headless & in browser). */
  getHeroPixels(heroId: HeroClassId, loadout?: HeroVisualLoadout): PortraitPixels
  /** Canonical cache key for a hero loadout. */
  getKey(heroId: HeroClassId, loadout?: HeroVisualLoadout): string
  /** Number of cached canvas portraits. */
  readonly cacheSize: number
}

/** Create a lazy loadout-aware portrait store with clean headless fallback when no DOM canvas is available. */
export function createPortraitStore(size = 96): PortraitStore {
  const base = bakePortraitCanvases()
  const canvasCache = new Map<string, HTMLCanvasElement>()
  for (const [k, canvas] of Object.entries(base)) canvasCache.set(k, canvas)

  return {
    base,
    getBase(id: string) {
      return canvasCache.get(id) ?? base[id]
    },
    getHero(heroId: HeroClassId, loadout?: HeroVisualLoadout) {
      const key = heroPortraitKey(heroId, loadout)
      const hit = canvasCache.get(key)
      if (hit) return hit
      if (typeof document === 'undefined') return undefined
      const pixels = getHeroPortraitPixels(heroId, loadout, size)
      const canvas = pixelsToCanvas(pixels)
      if (canvas) canvasCache.set(key, canvas)
      return canvas ?? base[heroId]
    },
    getHeroPixels(heroId: HeroClassId, loadout?: HeroVisualLoadout) {
      return getHeroPortraitPixels(heroId, loadout, size)
    },
    getKey: heroPortraitKey,
    get cacheSize() {
      return canvasCache.size
    }
  }
}

/** Wrap DOM-free portrait pixels into canvases for the Canvas UI (empty outside the browser). */
export function bakePortraitCanvases(): Record<string, HTMLCanvasElement> {
  const out: Record<string, HTMLCanvasElement> = {}
  if (typeof document === 'undefined') return out
  for (const [key, portrait] of Object.entries(bakePortraitPixels())) {
    const canvas = pixelsToCanvas(portrait)
    if (canvas) out[key] = canvas
  }
  return out
}

const HERO_IDS: readonly HeroClassId[] = [
  'knight', 'archer', 'mage', 'cleric', 'rogue', 'paladin', 'cryomancer', 'champion'
]
const ENEMY_IDS: readonly EnemyArchetypeId[] = [
  'goblin', 'bone_archer', 'orc_brute', 'bog_shaman', 'crypt_knight', 'frost_golem', 'eclipse_archon'
]

/** DOM-free bust portraits for every hero and enemy rig (usable from Node tools, tests, and packagers). */
export function bakePortraitPixels(): Record<string, PortraitPixels> {
  const out: Record<string, PortraitPixels> = {}
  for (const id of HERO_IDS) {
    out[id] = getHeroPortraitPixels(id)
  }
  for (const id of ENEMY_IDS) {
    out[id] = bakeRigPortrait(ENEMY_RIGS[id], stanceOffsetFor(undefined, id))
  }
  return out
}

const PORTRAIT_LIGHTING: LightingOptions = {
  direction: [-0.46, 0.68, 0.58],
  ambient: 0.46,
  color: [1.0, 0.95, 0.86],
  skyColor: [0.74, 0.80, 0.96],
  groundColor: [0.36, 0.30, 0.38],
  rimColor: [1.0, 0.88, 0.64],
  rimStrength: 0.36
}

/**
 * Bake one auto-framed bust portrait. A low-res probe pass finds the silhouette top so plumes,
 * wizard hats, horns, and crowns stay in frame while every face lands at a consistent size,
 * regardless of body type (goblin, golem, broad humanoid) or equipped headgear.
 */
export function bakeRigPortrait(rig: Rig, pose: Readonly<Record<string, JointPose>> = {}, size = 96): PortraitPixels {
  const pool = createMeshPool(48)
  const joints = renderRig(rig, { position: [0, 0, 0], yaw: 0.28, scale: 1 }, pose, pool)
  const batches = pool.batches.filter(b => b.count > 0)
  const headY = joints.head?.position[1] ?? 1.0
  const camFor = (centerY: number, span: number) => multiply(
    orthographic(span, span, 0.1, 20),
    view([0.22, centerY + 0.36, 6.0], [0, centerY, 0])
  )

  // Probe: find the highest opaque row near the head column (ignores raised weapons off to the side).
  const probeSize = 64
  const probeSpan = 3.2
  const probeCenter = headY + 0.4
  const probe = renderMeshPixels(camFor(probeCenter, probeSpan), batches, probeSize)
  const colMin = Math.floor(probeSize * 0.32)
  const colMax = Math.ceil(probeSize * 0.68)
  let topRow = -1
  for (let y = 0; y < probeSize && topRow < 0; y++) {
    for (let x = colMin; x < colMax; x++) {
      if (probe.pixels[(y * probeSize + x) * 4 + 3] > 0) { topRow = y; break }
    }
  }
  const silhouetteTop = topRow < 0 ? headY + 0.7 : probeCenter + probeSpan / 2 - (topRow / probeSize) * probeSpan

  // Bust framing: chest to crown, capped so very tall hats crop gracefully instead of shrinking the face.
  const bottom = headY - 0.36
  const top = Math.min(silhouetteTop + 0.06, headY + 1.02)
  const span = Math.max(1.02, top - bottom)
  const rendered = renderMeshPixels(camFor(bottom + span / 2, span), batches, size, PORTRAIT_LIGHTING)
  applySpriteOutline(rendered.pixels, size, size, size, 'selout')
  return { size, pixels: rendered.pixels }
}

// =========================================================================
// COZY STYLIZED BIOME PALETTES & MULTI-LAYERED MINIATURE DIORAMA BUILDER
// =========================================================================

export interface BiomeStyle {
  readonly sky: Color
  readonly fog: [number, number, number]
  readonly lightDir: Vec3
  readonly lightColor: Vec3
  readonly ambient: number
  readonly skyBounce: Vec3
  readonly groundBounce: Vec3
  readonly shadowTint: Vec3
  readonly baseStone: Color
  readonly cliff: Color
  readonly tileEarth: Color
  readonly tiles: Record<TileTerrain, readonly [Color, Color]>
  readonly treeColor: Color
  readonly treeTiers: readonly [Color, Color, Color]
  readonly treeAccentTiers: readonly [Color, Color, Color]
  readonly propGlow: Color
}

export const BIOME_STYLES: Record<BiomeId, BiomeStyle> = {
  meadow: {
    sky: color('5c7394'),
    fog: [0.38, 0.47, 0.60],
    lightDir: [-0.52, 0.80, 0.44],
    lightColor: [1.0, 0.95, 0.84],
    ambient: 0.48,
    skyBounce: [0.68, 0.78, 0.96],
    groundBounce: [0.46, 0.40, 0.30],
    shadowTint: [0.22, 0.25, 0.40],
    baseStone: color('8991a8'),
    cliff: color('5c647a'),
    tileEarth: color('7c6654'),
    tiles: {
      grass: [color('6eb05c'), color('62a352')],
      stone: [color('a7afc4'), color('98a0b5')],
      hill: [color('82c26b'), color('74b35f')],
      bridge: [color('b5794a'), color('a36a3f')],
      water: [color('3b89ab'), color('327b9c')],
      shrine: [color('b3e6d0'), color('9fd6be')],
      pillar: [color('9da5ba'), color('8c94aa')],
      lava: [color('eb632d'), color('d65322')],
      snow: [color('e0edf7'), color('d0e1f0')],
      darkstone: [color('5b6278'), color('50576b')],
      stairs: [color('c2b7a3'), color('b0a591')],
      void: [color('1c202e'), color('161a26')]
    },
    treeColor: C_FOREST_MID,
    treeTiers: [C_FOREST, C_FOREST_MID, C_FOREST_LIGHT],
    treeAccentTiers: [C_AUTUMN_DEEP, C_AUTUMN_MID, C_AUTUMN_LIGHT],
    propGlow: C_LANTERN_GLOW
  },
  river: {
    sky: color('546c80'),
    fog: [0.35, 0.45, 0.54],
    lightDir: [-0.48, 0.82, 0.40],
    lightColor: [0.98, 0.94, 0.86],
    ambient: 0.50,
    skyBounce: [0.68, 0.78, 0.92],
    groundBounce: [0.40, 0.40, 0.36],
    shadowTint: [0.20, 0.26, 0.38],
    baseStone: color('7b8799'),
    cliff: color('505c6e'),
    tileEarth: color('756252'),
    tiles: {
      grass: [color('5e9c68'), color('528f5d')],
      stone: [color('9ca7b8'), color('8d98aa')],
      hill: [color('75b074'), color('68a167')],
      bridge: [color('ba7c4c'), color('a66d40')],
      water: [color('317d9e'), color('296e8c')],
      shrine: [color('a3e8d8'), color('8fd9c8')],
      pillar: [color('8f9bad'), color('808c9e')],
      lava: [color('eb632d'), color('d65322')],
      snow: [color('e0edf7'), color('d0e1f0')],
      darkstone: [color('535f73'), color('485366')],
      stairs: [color('b5ad9c'), color('a39b8a')],
      void: [color('18232e'), color('131c26')]
    },
    treeColor: C_AUTUMN_MID,
    treeTiers: [C_AUTUMN_DEEP, C_AUTUMN_MID, C_AUTUMN_LIGHT],
    treeAccentTiers: [C_FOREST, C_FOREST_MID, C_FOREST_LIGHT],
    propGlow: C_LANTERN_GLOW
  },
  crypt: {
    sky: color('292e42'),
    fog: [0.16, 0.18, 0.27],
    lightDir: [-0.42, 0.82, 0.40],
    lightColor: [0.84, 0.88, 1.0],
    ambient: 0.42,
    skyBounce: [0.44, 0.50, 0.76],
    groundBounce: [0.22, 0.20, 0.30],
    shadowTint: [0.14, 0.16, 0.30],
    baseStone: color('666e85'),
    cliff: color('444a5e'),
    tileEarth: color('4d5266'),
    tiles: {
      grass: [color('54666e'), color('4a5b63')],
      stone: [color('828a9e'), color('747c91')],
      hill: [color('949cb0'), color('858da3')],
      bridge: [color('8a634d'), color('7a5642')],
      water: [color('2c627a'), color('245469')],
      shrine: [color('78e0cf'), color('65cfbd')],
      pillar: [color('7a8296'), color('6c7487')],
      lava: [color('eb632d'), color('d65322')],
      snow: [color('a8bed1'), color('98afc2')],
      darkstone: [color('555c70'), color('4b5163')],
      stairs: [color('8d94a8'), color('7b8296')],
      void: [color('131624'), color('0f121e')]
    },
    treeColor: color('3b5c5e'),
    treeTiers: [color('2e4a52'), color('3c6166'), color('4f7a7a')],
    treeAccentTiers: [color('874e38'), color('a66242'), color('c47a4f')],
    propGlow: C_CYAN
  },
  frost: {
    sky: color('7896b8'),
    fog: [0.48, 0.60, 0.74],
    lightDir: [-0.52, 0.78, 0.44],
    lightColor: [0.98, 0.96, 0.94],
    ambient: 0.54,
    skyBounce: [0.74, 0.84, 0.98],
    groundBounce: [0.48, 0.54, 0.68],
    shadowTint: [0.26, 0.34, 0.52],
    baseStone: color('7e92ad'),
    cliff: color('5c6f8a'),
    tileEarth: color('6e8099'),
    tiles: {
      grass: [color('c8dfed'), color('b9d3e3')],
      stone: [color('8d9fb5'), color('7f91a8')],
      hill: [color('ebf4fc'), color('ddeaf5')],
      bridge: [color('9e7252'), color('8c6345')],
      water: [color('3b8fba'), color('327fa8')],
      shrine: [color('94f2ea'), color('80e0d8')],
      pillar: [color('78add4'), color('689cc4')],
      lava: [color('eb632d'), color('d65322')],
      snow: [color('e3eff7'), color('d4e4f0')],
      darkstone: [color('62738a'), color('56667c')],
      stairs: [color('a3bdd4'), color('91acc4')],
      void: [color('1c2838'), color('16202e')]
    },
    treeColor: color('3d787a'),
    treeTiers: [color('306369'), color('478287'), color('d8eaf5')],
    treeAccentTiers: [color('366b6e'), color('528c8e'), color('e3f1fa')],
    propGlow: C_ICE
  },
  volcano: {
    sky: color('30222e'),
    fog: [0.21, 0.14, 0.19],
    lightDir: [-0.54, 0.72, 0.38],
    lightColor: [1.0, 0.82, 0.66],
    ambient: 0.42,
    skyBounce: [0.56, 0.38, 0.44],
    groundBounce: [0.46, 0.24, 0.18],
    shadowTint: [0.20, 0.14, 0.24],
    baseStone: color('564b5c'),
    cliff: color('3b3240'),
    tileEarth: color('4a3d4a'),
    tiles: {
      grass: [color('5e525c'), color('524750')],
      stone: [color('736773'), color('665b66')],
      hill: [color('827078'), color('75646b')],
      bridge: [color('8f654d'), color('7d5742')],
      water: [color('f0682e'), color('db5822')],
      shrine: [color('ffd478'), color('ebc063')],
      pillar: [color('5e505e'), color('524552')],
      lava: [color('ff702e'), color('eb5c20')],
      snow: [color('9c8f99'), color('8a7d87')],
      darkstone: [color('4d424f'), color('423845')],
      stairs: [color('856f6c'), color('735f5c')],
      void: [color('1a1118'), color('140d13')]
    },
    treeColor: color('664642'),
    treeTiers: [color('573d3d'), color('754b42'), color('9e5a44')],
    treeAccentTiers: [color('4d3a3d'), color('6b4844'), color('8c5443')],
    propGlow: C_EMBER
  },
  throne: {
    sky: color('241c38'),
    fog: [0.15, 0.12, 0.24],
    lightDir: [-0.46, 0.80, 0.40],
    lightColor: [0.96, 0.86, 1.0],
    ambient: 0.42,
    skyBounce: [0.50, 0.38, 0.72],
    groundBounce: [0.32, 0.20, 0.30],
    shadowTint: [0.16, 0.12, 0.28],
    baseStone: color('54476e'),
    cliff: color('382e4d'),
    tileEarth: color('45395c'),
    tiles: {
      grass: [color('584a70'), color('4d4063')],
      stone: [color('72648a'), color('64577a')],
      hill: [color('8573a1'), color('776691')],
      bridge: [color('856178'), color('755469')],
      water: [color('422a69'), color('372259')],
      shrine: [color('ffda7a'), color('ebc565')],
      pillar: [color('62527d'), color('54466e')],
      lava: [color('eb4c3d'), color('d43e31')],
      snow: [color('9482ad'), color('83729c')],
      darkstone: [color('473a5e'), color('3d3152')],
      stairs: [color('8f7ab0'), color('7c689c')],
      void: [color('140e24'), color('100b1d')]
    },
    treeColor: color('543c70'),
    treeTiers: [color('3e2d59'), color('563e78'), color('76589e')],
    treeAccentTiers: [color('946d34'), color('bd8d3e'), color('e0b152')],
    propGlow: C_SHADOW_GLOW
  }
}

function hash2(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return n - Math.floor(n)
}

function addLayeredTree(
  trunks: InstanceBatch,
  tiers: InstanceBatch,
  tips: InstanceBatch,
  x: number,
  y: number,
  z: number,
  scale: number,
  palette: readonly [Color, Color, Color],
  trunkColor: Color,
  yaw: number,
  tall = false
) {
  trunks.add([x, y + 0.26 * scale, z], [0.17 * scale, 0.62 * scale, 0.17 * scale], yaw, trunkColor)
  tiers.add([x, y + 0.72 * scale, z], [0.96 * scale, 0.54 * scale, 0.96 * scale], yaw, palette[0])
  tiers.add([x, y + 1.08 * scale, z], [0.78 * scale, 0.50 * scale, 0.78 * scale], yaw + 0.52, palette[1])
  if (tall) {
    tiers.add([x, y + 1.40 * scale, z], [0.58 * scale, 0.44 * scale, 0.58 * scale], yaw + 1.04, palette[1])
    tips.add([x, y + 1.72 * scale, z], [0.42 * scale, 0.52 * scale, 0.42 * scale], yaw + 1.56, palette[2])
  } else {
    tips.add([x, y + 1.44 * scale, z], [0.52 * scale, 0.56 * scale, 0.52 * scale], yaw + 1.04, palette[2])
  }
}

function addOrnateLantern(
  bases: InstanceBatch,
  poles: InstanceBatch,
  hooks: InstanceBatch,
  lanternGlass: InstanceBatch,
  caps: InstanceBatch,
  x: number,
  y: number,
  z: number,
  yaw: number,
  stoneColor: Color,
  glowColor: Color
) {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const hx = x + sin * 0.44
  const hz = z + cos * 0.44

  bases.add([x, y + 0.14, z], [0.50, 0.28, 0.50], yaw, stoneColor)
  poles.add([x, y + 0.76, z], [0.068, 1.06, 0.068], yaw, C_STEEL_DARK)
  hooks.add([x, y + 1.24, z], [1.0, 1.0, 1.0], yaw, C_STEEL_DARK)
  caps.add([hx, y + 1.66, hz], [0.26, 0.09, 0.26], yaw, C_STEEL_DARK)
  lanternGlass.add([hx, y + 1.48, hz], [0.22, 0.30, 0.22], yaw, glowColor, 0.96)
  caps.add([hx, y + 1.32, hz], [0.22, 0.07, 0.22], yaw, C_STEEL_DARK)
}

function addRockCluster(
  rocks: InstanceBatch,
  pebbles: InstanceBatch,
  x: number,
  y: number,
  z: number,
  scale: number,
  rockCol: Color,
  accentCol: Color,
  seed: number
) {
  rocks.add([x, y + 0.14 * scale, z], [0.46 * scale, 0.34 * scale, 0.40 * scale], quaternionFromEuler(0.15, seed * 2.1, 0.10), rockCol)
  pebbles.add([x + 0.24 * scale, y + 0.09 * scale, z + 0.14 * scale], [0.28 * scale, 0.22 * scale, 0.26 * scale], seed, accentCol)
  pebbles.add([x - 0.20 * scale, y + 0.07 * scale, z + 0.18 * scale], [0.22 * scale, 0.16 * scale, 0.20 * scale], seed + 1.2, rockCol)
}

function addTerracedColumn(
  tileBases: InstanceBatch,
  copings: InstanceBatch,
  wx: number,
  topY: number,
  wz: number,
  heightLevel: number,
  underCol: Color,
  cliffCol: Color,
  copingCol: Color
) {
  const bottomY = -1.42
  const totalH = Math.max(0.28, topY - 0.08 - bottomY)
  // Upper earth/masonry collar + deep terraced bedrock skirt down to plinth base
  if (heightLevel >= 1) {
    const upperH = Math.min(totalH * 0.48, 0.42 + heightLevel * 0.14)
    const lowerH = Math.max(0.22, totalH - upperH)
    tileBases.add([wx, topY - 0.08 - upperH * 0.5, wz], [TILE_SIZE * 0.96, upperH, TILE_SIZE * 0.96], 0, underCol)
    tileBases.add([wx, bottomY + lowerH * 0.5, wz], [TILE_SIZE * 0.92, lowerH, TILE_SIZE * 0.92], 0, cliffCol)
    // Crisp stone coping lip at terrace crest & strata ledge every 2 height levels
    copings.add([wx, topY - 0.13, wz], [TILE_SIZE * 0.99, 0.08, TILE_SIZE * 0.99], 0, copingCol)
    for (let lvl = 1; lvl < heightLevel; lvl++) {
      const bandY = lvl * HEIGHT_STEP - 0.12
      copings.add([wx, bandY, wz], [TILE_SIZE * 0.97, 0.06, TILE_SIZE * 0.97], 0, underCol)
    }
  } else {
    const upperH = Math.min(0.32, totalH * 0.35)
    const lowerH = Math.max(0.24, totalH - upperH)
    tileBases.add([wx, topY - 0.08 - upperH * 0.5, wz], [TILE_SIZE * 0.95, upperH, TILE_SIZE * 0.95], 0, underCol)
    tileBases.add([wx, bottomY + lowerH * 0.5, wz], [TILE_SIZE * 0.91, lowerH, TILE_SIZE * 0.91], 0, cliffCol)
  }
}

function addSculptedStairs(
  tileBases: InstanceBatch,
  tileCaps: InstanceBatch,
  copings: InstanceBatch,
  cells: GridCell[][],
  col: number,
  row: number,
  wx: number,
  wy: number,
  wz: number,
  hLvl: number,
  style: BiomeStyle,
  tint: Color
) {
  const rows = cells.length
  const cols = cells[0]?.length ?? GRID_COLS
  // Orient stairs ascending toward the highest adjacent walkable neighbor
  const dirs: readonly (readonly [number, number, number])[] = [
    [1, 0, Math.PI * 0.5],
    [-1, 0, -Math.PI * 0.5],
    [0, -1, Math.PI],
    [0, 1, 0]
  ]
  let bestYaw = 0
  let bestHigh = hLvl
  let lowestAdj = hLvl
  for (const [dc, dr, yaw] of dirs) {
    const nc = col + dc
    const nr = row + dr
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
    const nCell = cells[nr][nc]
    if (!nCell || nCell.terrain === 'void') continue
    const nh = cellHeightLevel(nCell)
    if (nh > bestHigh) {
      bestHigh = nh
      bestYaw = yaw
    }
    if (nh < lowestAdj) lowestAdj = nh
  }

  addTerracedColumn(tileBases, copings, wx, wy, wz, hLvl, style.baseStone, style.cliff, C_STONE_LIGHT)

  const lowY = Math.max(0, lowestAdj) * HEIGHT_STEP
  const highY = Math.max(wy + 0.02, bestHigh > hLvl ? (hLvl + 0.65) * HEIGHT_STEP : wy + 0.06)
  const rise = Math.max(0.18, highY - lowY)
  const steps = 4
  const cos = Math.cos(bestYaw)
  const sin = Math.sin(bestYaw)
  const stepDepth = (TILE_SIZE * 0.88) / steps

  for (let i = 0; i < steps; i++) {
    const frac = (i + 0.5) / steps - 0.5
    const forward = frac * TILE_SIZE * 0.88
    const sx = wx + sin * forward
    const sz = wz + cos * forward
    const stepTop = lowY + ((i + 1) / steps) * rise
    const stepH = Math.max(0.08, stepTop - (lowY - 0.06))
    const stepCol = i % 2 === 0 ? tint : C_STONE_LIGHT
    tileCaps.add(
      [sx, stepTop - stepH * 0.5, sz],
      [TILE_SIZE * 0.78, stepH, stepDepth * 1.04],
      bestYaw,
      stepCol
    )
  }

  // Carved stone side stringers / cheek-walls
  const sideOffset = TILE_SIZE * 0.42
  for (const side of [-1, 1]) {
    const rx = wx + cos * sideOffset * side
    const rz = wz - sin * sideOffset * side
    copings.add([rx, lowY + rise * 0.52, rz], [0.14, Math.max(0.18, rise + 0.14), TILE_SIZE * 0.90], bestYaw, style.baseStone)
  }
}

export function buildStaticBoardBatches(biome: BiomeId, cells: GridCell[][]): {
  batches: InstanceBatch[]
  brazierPositions: Vec3[]
} {
  const rows = cells.length || GRID_ROWS
  const cols = cells[0]?.length ?? GRID_COLS
  const style = BIOME_STYLES[biome]
  const tileCaps = instances(tileCapMesh, 384)
  const tileBases = instances(tileBaseMesh, 448)
  const bevelProps = instances(softBevel, 320)
  const copings = instances(crispBevel, 288)
  const trunks = instances(taperTrunk, 48)
  const foliageTiers = instances(foliageTier, 96)
  const foliageTips = instances(foliageTip, 40)
  const cyls = instances(smoothCyl, 144)
  const hooks = instances(lanternHookMesh, 16)
  const pills = instances(chunkyPill, 96)
  const pebbles = instances(roundPebble, 160)
  const rings = instances(collarRing, 48)
  const cones = instances(smoothCone, 64)
  const crystals = instances(crystalMesh, 96)
  const arches = instances(archProp, 40)
  const gables = instances(gableRoof, 24)
  const crowns = instances(crownMesh, 8)
  const brazierPositions: Vec3[] = []

  // Build per-cell terraced diorama tiles (void cells emit ZERO geometry for irregular silhouettes!)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = cells[row][col]
      if (cell.terrain === 'void') continue
      const hLvl = cellHeightLevel(cell)
      const baseY = hLvl * HEIGHT_STEP
      const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, cols, rows)
      const checker = (col + row) % 2
      const tint = style.tiles[cell.terrain][checker]
      const isLava = cell.terrain === 'lava'
      const isWater = cell.terrain === 'water'
      const h = hash2(col + 3.1, row + 7.4)

      if (cell.terrain === 'pillar') {
        addTerracedColumn(tileBases, copings, wx, baseY, wz, hLvl, style.baseStone, style.cliff, C_STONE_LIGHT)
        tileCaps.add([wx, baseY - 0.02, wz], [TILE_SIZE * 0.91, 0.14, TILE_SIZE * 0.91], 0, style.tiles.stone[checker])
        bevelProps.add([wx, baseY + 0.17, wz], [1.06, 0.26, 1.06], 0, style.baseStone)
        if (biome === 'frost') {
          cones.add([wx, baseY + 0.86, wz], [0.54, 1.24, 0.54], h * 1.2, C_ICE)
          cones.add([wx + 0.24, baseY + 0.54, wz + 0.18], [0.24, 0.62, 0.24], 0.4, C_ICE_DEEP)
          crystals.add([wx, baseY + 1.56, wz], [0.24, 0.36, 0.24], 0, C_CYAN, 0.85)
        } else {
          cyls.add([wx, baseY + 0.78, wz], [0.38, 1.02, 0.38], 0, tint)
          rings.add([wx, baseY + 0.78, wz], [0.46, 0.14, 0.46], 0, style.baseStone)
          tileCaps.add([wx, baseY + 1.36, wz], [0.96, 0.20, 0.96], 0, C_STONE_LIGHT)
          if (biome === 'crypt' || biome === 'throne') {
            crystals.add([wx, baseY + 1.62, wz], [0.18, 0.28, 0.18], h, style.propGlow, 0.85)
          }
        }
      } else if (cell.terrain === 'bridge') {
        // Check if neighboring cells are void (chasm sky-bridge) vs water/lava
        const adjVoid =
          cells[row - 1]?.[col]?.terrain === 'void' ||
          cells[row + 1]?.[col]?.terrain === 'void' ||
          cells[row]?.[col - 1]?.terrain === 'void' ||
          cells[row]?.[col + 1]?.terrain === 'void'
        if (!adjVoid) {
          const underTint = biome === 'volcano' ? style.tiles.lava[0] : style.tiles.water[0]
          tileBases.add([wx, -0.96, wz], [TILE_SIZE * 0.94, 0.92, TILE_SIZE * 0.94], 0, style.cliff)
          tileCaps.add([wx, -0.32, wz], [TILE_SIZE * 0.97, 0.18, TILE_SIZE * 0.97], 0, underTint, biome === 'volcano' ? 0.82 : 0.12)
        }
        // Sturdy bridge support piers down into the chasm or river
        const pierBottom = -1.42
        const pierH = Math.max(0.32, wy - 0.14 - pierBottom)
        for (const pxOff of [-TILE_SIZE * 0.34, TILE_SIZE * 0.34]) {
          bevelProps.add([wx + pxOff, pierBottom + pierH * 0.5, wz], [0.24, pierH, TILE_SIZE * 0.74], 0, style.baseStone)
        }
        tileCaps.add([wx, wy - 0.08, wz], [TILE_SIZE * 0.95, 0.18, TILE_SIZE * 0.86], 0, tint)
        bevelProps.add([wx, wy + 0.11, wz - TILE_SIZE * 0.39], [TILE_SIZE * 0.90, 0.11, 0.11], 0, C_WOOD_WARM)
        bevelProps.add([wx, wy + 0.11, wz + TILE_SIZE * 0.39], [TILE_SIZE * 0.90, 0.11, 0.11], 0, C_WOOD_WARM)
        bevelProps.add([wx - TILE_SIZE * 0.38, wy + 0.14, wz - TILE_SIZE * 0.39], [0.15, 0.26, 0.15], 0, C_WOOD_DARK)
        bevelProps.add([wx + TILE_SIZE * 0.38, wy + 0.14, wz - TILE_SIZE * 0.39], [0.15, 0.26, 0.15], 0, C_WOOD_DARK)
        bevelProps.add([wx - TILE_SIZE * 0.38, wy + 0.14, wz + TILE_SIZE * 0.39], [0.15, 0.26, 0.15], 0, C_WOOD_DARK)
        bevelProps.add([wx + TILE_SIZE * 0.38, wy + 0.14, wz + TILE_SIZE * 0.39], [0.15, 0.26, 0.15], 0, C_WOOD_DARK)
      } else if (cell.terrain === 'stairs') {
        addSculptedStairs(tileBases, tileCaps, copings, cells, col, row, wx, wy, wz, hLvl, style, tint)
      } else if (cell.terrain === 'shrine') {
        addTerracedColumn(tileBases, copings, wx, wy, wz, hLvl, style.baseStone, style.cliff, C_GOLD)
        tileCaps.add([wx, wy - 0.05, wz], [TILE_SIZE * 0.91, 0.14, TILE_SIZE * 0.91], 0, style.tiles.stone[0])
        cyls.add([wx, wy + 0.05, wz], [0.58, 0.09, 0.58], 0, tint, 0.38)
        bevelProps.add([wx, wy + 0.16, wz - 0.54], [1.10, 0.22, 0.38], 0, C_STONE_LIGHT)
        arches.add([wx, wy + 0.72, wz - 0.54], [0.94, 1.02, 0.24], 0, C_IVORY)
        gables.add([wx, wy + 1.32, wz - 0.54], [1.08, 0.28, 0.34], 0, C_STONE_LIGHT)
        crystals.add([wx, wy + 0.86, wz - 0.54], [0.20, 0.32, 0.20], 0, style.propGlow, 0.96)
        brazierPositions.push([wx, wy + 1.05, wz - 0.50])
      } else if (isWater || isLava) {
        const bedH = Math.max(0.32, wy - 0.06 - (-1.42))
        tileBases.add([wx, -1.42 + bedH * 0.5, wz], [TILE_SIZE * 0.95, bedH, TILE_SIZE * 0.95], 0, style.cliff)
        tileCaps.add([wx, wy - 0.06, wz], [TILE_SIZE * 0.93, 0.14, TILE_SIZE * 0.93], 0, tint, isLava ? 0.88 : 0.14)
        if (h > 0.62) {
          pebbles.add(
            [wx + (h - 0.75) * 0.7, wy + 0.02, wz + (hash2(row, col) - 0.5) * 0.6],
            [0.26, 0.12, 0.22],
            h * 3,
            isLava ? C_OBSIDIAN : C_STONE_MID
          )
        }
      } else {
        const isSoftSoil = cell.terrain === 'grass' || cell.terrain === 'snow' || cell.terrain === 'hill'
        const underCol = isSoftSoil ? style.tileEarth : style.baseStone
        const copingCol = cell.terrain === 'darkstone' ? style.baseStone : C_STONE_LIGHT
        addTerracedColumn(tileBases, copings, wx, wy, wz, hLvl, underCol, style.cliff, copingCol)
        tileCaps.add([wx, wy - 0.06, wz], [TILE_SIZE * 0.92, 0.15, TILE_SIZE * 0.92], 0, tint)
        if (cell.terrain === 'darkstone') {
          copings.add([wx, wy + 0.01, wz], [TILE_SIZE * 0.76, 0.04, TILE_SIZE * 0.76], 0, style.baseStone)
        } else if (cell.terrain === 'snow' && h > 0.52) {
          pebbles.add([wx + (h - 0.72) * 0.5, wy + 0.03, wz + (hash2(row, col) - 0.5) * 0.45], [0.34, 0.10, 0.28], h * 2.5, C_IVORY)
        } else if ((row === 0 || row === rows - 1 || col === 0 || col === cols - 1) && h > 0.72) {
          const ox = col === 0 ? -0.54 : 0.54
          const oz = row === 0 ? -0.54 : 0.54
          pebbles.add([wx + ox, wy + 0.04, wz + oz], [0.18, 0.10, 0.16], h * 4, C_STONE_LIGHT)
        }
      }
    }
  }

  // =========================================================================
  // BIOME-SPECIFIC PERIMETER ARCHITECTURE & SIGNATURE LANDMARKS
  // =========================================================================
  const halfW = (cols * 0.5) * TILE_SIZE
  const halfD = (rows * 0.5) * TILE_SIZE
  const backZ = -(halfD + 1.05)
  const sideX = halfW + 1.05

  if (biome === 'meadow') {
    // Signature Watchtower on the northwest ridge
    const twX = -(halfW + 0.75)
    const twZ = -(halfD + 0.72)
    tileBases.add([twX, -0.62, twZ], [2.05, 1.60, 2.05], 0, style.baseStone)
    copings.add([twX, 0.22, twZ], [2.16, 0.12, 2.16], 0, C_STONE_LIGHT)
    for (const [px, pz] of [[-0.68, -0.68], [0.68, -0.68], [-0.68, 0.68], [0.68, 0.68]] as const) {
      cyls.add([twX + px, 1.15, twZ + pz], [0.12, 1.85, 0.12], 0, C_WOOD_DARK)
    }
    bevelProps.add([twX, 1.85, twZ], [1.82, 0.18, 1.82], 0, C_WOOD_WARM)
    bevelProps.add([twX, 2.16, twZ - 0.78], [1.72, 0.44, 0.14], 0, C_WOOD)
    bevelProps.add([twX, 2.16, twZ + 0.78], [1.72, 0.44, 0.14], 0, C_WOOD)
    bevelProps.add([twX - 0.78, 2.16, twZ], [0.14, 0.44, 1.56], 0, C_WOOD)
    bevelProps.add([twX + 0.78, 2.16, twZ], [0.14, 0.44, 1.56], 0, C_WOOD)
    gables.add([twX, 2.88, twZ], [2.20, 0.74, 2.20], 0, C_AUTUMN_DEEP)
    crystals.add([twX, 2.28, twZ + 0.94], [0.18, 0.28, 0.18], 0, C_LANTERN_GLOW, 0.96)
    brazierPositions.push([twX, 2.28, twZ + 0.94])

    // Timber Palisade fence along northern perimeter
    const stakes = Math.max(8, cols * 2)
    for (let i = 0; i < stakes; i++) {
      const u = i / Math.max(1, stakes - 1) - 0.5
      const sx = u * (cols * TILE_SIZE - 0.4)
      if (sx < twX + 1.35) continue
      const stakeH = 0.92 + (i % 3) * 0.14
      trunks.add([sx, -0.35 + stakeH * 0.5, backZ + 0.12], [0.14, stakeH, 0.14], i * 0.5, i % 2 === 0 ? C_WOOD : C_WOOD_DARK)
    }
    bevelProps.add([0.75, 0.16, backZ + 0.14], [cols * TILE_SIZE - 1.8, 0.12, 0.10], 0, C_WOOD_WARM)
    addOrnateLantern(bevelProps, cyls, hooks, pills, copings, halfW + 0.55, -0.24, -(halfD + 0.42), -0.78, style.baseStone, C_LANTERN_GLOW)
    brazierPositions.push([halfW + 0.55, 1.35, -(halfD + 0.42)])

    // Sunlit oak & autumn treeline behind the palisade
    const spots: readonly [number, number, number, boolean, boolean][] = [
      [-halfW * 0.42, backZ - 0.55, 1.18, true, false],
      [0.15, backZ - 0.62, 1.26, true, true],
      [halfW * 0.52, backZ - 0.48, 1.12, false, false],
      [halfW + 0.95, -0.5 * TILE_SIZE, 1.05, true, true],
      [-sideX, 0.35 * TILE_SIZE, 0.96, false, false]
    ]
    for (let i = 0; i < spots.length; i++) {
      const [tx, tz, sc, tall, accent] = spots[i]
      addLayeredTree(trunks, foliageTiers, foliageTips, tx, -0.28, tz, sc, accent ? style.treeAccentTiers : style.treeTiers, C_WOOD, i * 0.8, tall)
      addRockCluster(pills, pebbles, tx + 0.55 * sc, -0.28, tz + 0.42, 0.72, C_STONE_MID, C_STONE_LIGHT, i + 1.4)
    }
  } else if (biome === 'river') {
    // Twin Stone River Piers, Aqueduct Arches & Cascading Waterfalls
    const pierXs = [-halfW * 0.56, halfW * 0.56]
    for (let i = 0; i < pierXs.length; i++) {
      const px = pierXs[i]
      tileBases.add([px, -0.58, backZ - 0.18], [2.15, 1.72, 1.55], 0, style.baseStone)
      copings.add([px, 0.32, backZ - 0.18], [2.26, 0.14, 1.66], 0, C_STONE_LIGHT)
      arches.add([px, 1.02, backZ - 0.18], [1.75, 1.35, 0.42], 0, C_STONE_LIGHT)
      copings.add([px, 1.74, backZ - 0.18], [2.05, 0.16, 0.52], 0, style.baseStone)
      // Cascading waterfall chute spilling down the pier face
      bevelProps.add([px, 0.04, backZ + 0.48], [0.78, 1.85, 0.24], 0, style.tiles.water[0], 0.32)
      bevelProps.add([px, -0.05, backZ + 0.54], [0.46, 1.78, 0.14], 0, C_CYAN, 0.52)
      for (let m = 0; m < 4; m++) {
        pebbles.add([px + (m - 1.5) * 0.28, -0.82, backZ + 0.72 + (m % 2) * 0.18], [0.28, 0.18, 0.26], m * 1.1, C_IVORY, 0.45)
      }
      addOrnateLantern(bevelProps, cyls, hooks, pills, copings, px + (i === 0 ? -0.92 : 0.92), 0.36, backZ + 0.45, i === 0 ? 0.5 : -0.5, style.baseStone, C_LANTERN_GLOW)
      brazierPositions.push([px + (i === 0 ? -0.92 : 0.92), 1.88, backZ + 0.45])
    }
    // Center aqueduct bridge span & riverside willow/autumn trees
    arches.add([0, 0.85, backZ - 0.28], [2.4, 1.4, 0.38], 0, style.baseStone)
    copings.add([0, 1.60, backZ - 0.28], [2.7, 0.16, 0.48], 0, C_STONE_LIGHT)
    const bankTrees: readonly [number, number, number, boolean][] = [
      [-sideX, -halfD * 0.4, 1.15, false],
      [sideX, -halfD * 0.35, 1.18, true],
      [-sideX, halfD * 0.45, 0.94, true],
      [sideX, halfD * 0.5, 0.98, false]
    ]
    for (let i = 0; i < bankTrees.length; i++) {
      const [tx, tz, sc, accent] = bankTrees[i]
      addLayeredTree(trunks, foliageTiers, foliageTips, tx, -0.32, tz, sc, accent ? style.treeAccentTiers : style.treeTiers, C_WOOD_DARK, i * 0.9, true)
    }
  } else if (biome === 'crypt') {
    // Vaulted Gothic Crypt Alcoves & Spectral Cyan Bone Braziers
    const alcoveCount = Math.max(3, Math.floor(cols / 2))
    const span = (cols - 1.2) * TILE_SIZE
    for (let i = 0; i < alcoveCount; i++) {
      const u = alcoveCount <= 1 ? 0 : i / (alcoveCount - 1) - 0.5
      const ax = u * span
      tileBases.add([ax, -0.45, backZ - 0.20], [2.10, 1.95, 1.10], 0, style.cliff)
      bevelProps.add([ax, 0.45, backZ - 0.48], [1.90, 1.45, 0.34], 0, C_OBSIDIAN)
      arches.add([ax, 1.18, backZ - 0.04], [1.82, 1.62, 0.36], 0, style.baseStone)
      gables.add([ax, 2.18, backZ - 0.10], [2.12, 0.48, 0.58], 0, C_STONE_MID)
      crystals.add([ax, 1.15, backZ - 0.18], [0.22, 0.44, 0.22], i * 0.7, C_CYAN, 0.95)
    }
    // Bone Braziers flanking the catacombs
    const brazierSpots: readonly [number, number][] = [
      [-(halfW + 0.55), -(halfD + 0.35)],
      [halfW + 0.55, -(halfD + 0.35)],
      [-(halfW + 0.65), halfD * 0.42],
      [halfW + 0.65, halfD * 0.42]
    ]
    for (let i = 0; i < brazierSpots.length; i++) {
      const [bx, bz] = brazierSpots[i]
      bevelProps.add([bx, -0.22, bz], [0.76, 0.68, 0.76], 0, C_OBSIDIAN)
      cyls.add([bx, 0.42, bz], [0.24, 0.68, 0.24], 0, C_IVORY)
      rings.add([bx, 0.80, bz], [0.46, 0.18, 0.46], 0, C_STONE_DARK)
      crystals.add([bx, 1.06, bz], [0.24, 0.38, 0.24], i * 0.8, C_CYAN, 0.98)
      brazierPositions.push([bx, 1.15, bz])
    }
    // Twisted crypt cypresses on flanks
    addLayeredTree(trunks, foliageTiers, foliageTips, -sideX - 0.2, -0.30, -0.6, 1.12, style.treeTiers, C_OBSIDIAN, 0.4, true)
    addLayeredTree(trunks, foliageTiers, foliageTips, sideX + 0.2, -0.30, -0.4, 1.16, style.treeTiers, C_OBSIDIAN, 1.6, true)
  } else if (biome === 'frost') {
    // Towering Icy Crystal Spires & Stacked Stone Rune Cairns
    const spireXs = [-halfW * 0.82, -halfW * 0.28, halfW * 0.28, halfW * 0.82]
    for (let i = 0; i < spireXs.length; i++) {
      const sx = spireXs[i]
      const tall = i === 1 || i === 2 ? 2.85 : 2.15
      tileBases.add([sx, -0.68, backZ - 0.22], [1.65, 1.45, 1.45], 0, style.cliff)
      cones.add([sx, 0.15 + tall * 0.5, backZ - 0.22], [0.82, tall, 0.82], i * 0.7, C_ICE)
      cones.add([sx + 0.46, 0.05 + tall * 0.32, backZ + 0.10], [0.44, tall * 0.64, 0.44], i * 1.1, C_ICE_DEEP)
      crystals.add([sx, 0.22 + tall, backZ - 0.22], [0.28, 0.52, 0.28], i, C_CYAN, 0.90)
    }
    // Stacked Rune Cairns flanking the pass
    const cairnSpots: readonly [number, number][] = [
      [-(halfW + 0.60), -(halfD * 0.55)],
      [halfW + 0.60, -(halfD * 0.55)],
      [-(halfW + 0.65), halfD * 0.45],
      [halfW + 0.65, halfD * 0.45]
    ]
    for (let i = 0; i < cairnSpots.length; i++) {
      const [cx, cz] = cairnSpots[i]
      pebbles.add([cx, -0.18, cz], [0.76, 0.38, 0.72], i * 0.5, C_STONE_DARK)
      pebbles.add([cx, 0.18, cz], [0.56, 0.32, 0.54], i * 1.1, C_STONE_MID)
      pebbles.add([cx, 0.48, cz], [0.38, 0.24, 0.36], i * 1.7, C_STONE_LIGHT)
      crystals.add([cx, 0.84, cz], [0.22, 0.44, 0.22], i * 0.4, C_ICE, 0.96)
      brazierPositions.push([cx, 0.95, cz])
    }
    addLayeredTree(trunks, foliageTiers, foliageTips, -halfW * 0.55, -0.25, backZ - 0.65, 1.20, style.treeTiers, C_WOOD_DARK, 0.6, true)
    addLayeredTree(trunks, foliageTiers, foliageTips, halfW * 0.55, -0.25, backZ - 0.65, 1.16, style.treeAccentTiers, C_WOOD_DARK, 2.1, true)
  } else if (biome === 'volcano') {
    // Iron-Banded Forge Crucibles & Pouring Molten Lava Falls
    const crucibleXs = [-halfW * 0.62, 0, halfW * 0.62]
    for (let i = 0; i < crucibleXs.length; i++) {
      const fx = crucibleXs[i]
      const fz = backZ - 0.16
      tileBases.add([fx, -0.42, fz], [1.95, 2.05, 1.55], 0, style.cliff)
      cyls.add([fx, 0.92, fz], [0.68, 0.92, 0.68], 0, C_OBSIDIAN)
      rings.add([fx, 0.78, fz], [0.78, 0.14, 0.78], 0, C_STEEL_DARK)
      rings.add([fx, 1.18, fz], [0.78, 0.14, 0.78], 0, C_STEEL_DARK)
      // Glowing molten vat top & pouring lava fall down the cliff face
      cyls.add([fx, 1.38, fz], [0.58, 0.14, 0.58], 0, C_EMBER, 0.96)
      bevelProps.add([fx, 0.22, fz + 0.68], [0.54, 2.15, 0.20], 0, C_EMBER, 0.94)
      bevelProps.add([fx, 0.14, fz + 0.74], [0.28, 2.05, 0.12], 0, C_GOLD_BRIGHT, 0.98)
      pebbles.add([fx, -0.82, fz + 0.85], [0.78, 0.16, 0.56], i, C_EMBER, 0.92)
      brazierPositions.push([fx, 1.55, fz])
    }
    // Jagged basalt crags along the flanks
    const crags: readonly [number, number, number][] = [
      [-sideX - 0.15, -halfD * 0.55, 1.35],
      [sideX + 0.15, -halfD * 0.50, 1.42],
      [-sideX - 0.10, halfD * 0.35, 1.05],
      [sideX + 0.10, halfD * 0.40, 1.10]
    ]
    for (let i = 0; i < crags.length; i++) {
      const [cx, cz, sc] = crags[i]
      bevelProps.add([cx, 0.28 * sc, cz], [0.85 * sc, 1.65 * sc, 0.78 * sc], i * 0.45, style.cliff)
      crystals.add([cx, 1.25 * sc, cz], [0.24, 0.44, 0.24], i, C_EMBER, 0.96)
    }
  } else {
    // THRONE: Grand Obsidian Throne Dais, Gothic Spires, Floating Eclipse Crown & Royal Banners
    const daisZ = backZ - 0.28
    tileBases.add([0, -0.25, daisZ], [5.4, 2.35, 2.4], 0, C_OBSIDIAN)
    copings.add([0, 0.94, daisZ], [5.55, 0.14, 2.52], 0, C_VIOLET)
    tileBases.add([0, 1.16, daisZ - 0.18], [3.2, 0.42, 1.7], 0, style.baseStone)
    copings.add([0, 1.40, daisZ - 0.18], [3.35, 0.10, 1.82], 0, C_GOLD)
    // Towering gothic throne backdrop & spires
    arches.add([0, 2.55, daisZ - 0.55], [2.75, 2.35, 0.48], 0, C_OBSIDIAN)
    for (const sx of [-1.55, 1.55]) {
      cyls.add([sx, 2.25, daisZ - 0.45], [0.28, 2.55, 0.28], 0, C_OBSIDIAN)
      cones.add([sx, 3.85, daisZ - 0.45], [0.36, 0.85, 0.36], 0, C_VIOLET)
      crystals.add([sx, 4.42, daisZ - 0.45], [0.20, 0.36, 0.20], 0, C_SHADOW_GLOW, 0.96)
    }
    // Throne seat & hovering Sovereign Eclipse Crown
    bevelProps.add([0, 1.88, daisZ - 0.38], [1.18, 0.96, 0.72], 0, C_OBSIDIAN)
    bevelProps.add([0, 2.38, daisZ - 0.62], [1.12, 1.24, 0.22], 0, C_VIOLET)
    crowns.add([0, 3.22, daisZ - 0.35], [0.78, 0.62, 0.78], 0, C_GOLD_BRIGHT, 0.94)
    crystals.add([0, 3.68, daisZ - 0.35], [0.24, 0.42, 0.24], 0, C_SHADOW_GLOW, 0.98)
    brazierPositions.push([0, 3.55, daisZ - 0.20])

    // Flanking Royal Banners & Obsidian Obelisk Braziers
    const bannerSpots: readonly [number, number][] = [
      [-(halfW + 0.55), -(halfD * 0.52)],
      [halfW + 0.55, -(halfD * 0.52)],
      [-(halfW + 0.55), halfD * 0.42],
      [halfW + 0.55, halfD * 0.42]
    ]
    for (let i = 0; i < bannerSpots.length; i++) {
      const [bx, bz] = bannerSpots[i]
      bevelProps.add([bx, -0.18, bz], [0.78, 0.84, 0.78], 0, C_OBSIDIAN)
      cyls.add([bx, 1.28, bz], [0.09, 2.45, 0.09], 0, C_GOLD)
      bevelProps.add([bx, 1.72, bz + 0.14], [0.68, 1.18, 0.08], 0, i % 2 === 0 ? C_CRIMSON : C_VIOLET)
      copings.add([bx, 2.36, bz + 0.12], [0.84, 0.10, 0.14], 0, C_GOLD_BRIGHT)
      crystals.add([bx, 2.68, bz], [0.20, 0.34, 0.20], i, C_SHADOW_GLOW, 0.96)
      brazierPositions.push([bx, 2.65, bz])
    }
  }

  return {
    batches: [
      tileCaps, tileBases, bevelProps, copings, trunks, foliageTiers, foliageTips,
      cyls, hooks, pills, pebbles, rings, cones, crystals, arches, gables, crowns
    ].filter(b => b.count > 0),
    brazierPositions
  }
}

export function buildCampDioramaBatches(): InstanceBatch[] {
  const terrainCaps = instances(tileCapMesh, 32)
  const terrainBases = instances(tileBaseMesh, 24)
  const bevelProps = instances(softBevel, 64)
  const copings = instances(crispBevel, 24)
  const trunks = instances(taperTrunk, 16)
  const foliageTiers = instances(foliageTier, 36)
  const foliageTips = instances(foliageTip, 14)
  const cyls = instances(smoothCyl, 32)
  const hooks = instances(lanternHookMesh, 6)
  const pills = instances(chunkyPill, 28)
  const pebbles = instances(roundPebble, 48)
  const rings = instances(collarRing, 12)
  const arches = instances(archProp, 8)
  const gables = instances(gableRoof, 6)
  const gold = instances(crownMesh, 4)

  terrainBases.add([0, -0.78, 0], [14.2, 1.02, 10.2], 0, color('6f6052'))
  terrainBases.add([0, -1.56, 0], [12.4, 0.92, 8.6], 0, color('596275'))
  terrainCaps.add([0, -0.18, 0], [13.8, 0.24, 9.8], 0, color('66a856'))
  terrainBases.add([0, -0.06, 0.25], [8.2, 0.18, 5.2], 0, C_STONE_DARK)
  terrainCaps.add([0, -0.01, 0.25], [7.8, 0.12, 4.8], 0, C_STONE_LIGHT)

  const flagSpots: [number, number, number, number][] = [
    [-2.5, 1.6, 0.92, 0.72], [2.5, 1.6, 0.92, 0.72], [-1.3, 2.35, 0.76, 0.56], [1.3, 2.35, 0.76, 0.56],
    [-3.6, -0.3, 0.78, 0.66], [3.6, -0.3, 0.78, 0.66]
  ]
  for (let i = 0; i < flagSpots.length; i++) {
    const [fx, fz, fw, fd] = flagSpots[i]
    terrainCaps.add([fx, 0.02, fz], [fw, 0.08, fd], (i % 3 - 1) * 0.14, C_STONE_MID)
  }

  bevelProps.add([0, 0.22, -2.55], [2.9, 0.44, 1.45], 0, C_STONE_MID)
  copings.add([0, 0.46, -2.55], [3.05, 0.10, 1.56], 0, C_STONE_LIGHT)
  for (const sx of [-1.22, 1.22]) {
    bevelProps.add([sx, 0.62, -2.55], [0.56, 0.28, 0.56], 0, C_STONE_LIGHT)
    cyls.add([sx, 1.38, -2.55], [0.22, 1.30, 0.22], 0, C_STONE_LIGHT)
    rings.add([sx, 1.38, -2.55], [0.28, 0.12, 0.28], 0, C_GOLD)
    bevelProps.add([sx, 2.10, -2.55], [0.60, 0.22, 0.60], 0, C_IVORY)
  }
  arches.add([0, 1.50, -2.55], [2.25, 2.15, 0.48], 0, C_STONE_LIGHT)
  gables.add([0, 2.74, -2.55], [3.10, 0.58, 0.86], 0, C_STONE_MID)
  bevelProps.add([0, 0.66, -2.55], [1.18, 0.40, 0.92], 0, C_STONE_DARK)
  gold.add([0, 1.34, -2.55], [0.76, 0.64, 0.76], 0, C_GOLD_BRIGHT, 0.88)

  for (const side of [-1, 1]) {
    bevelProps.add([side * 2.85, 0.16, -2.35], [1.95, 0.46, 0.36], side * -0.18, C_STONE_MID)
    copings.add([side * 2.85, 0.43, -2.35], [2.04, 0.12, 0.42], side * -0.18, C_STONE_LIGHT)
    copings.add([side * 2.85, 0.16, -2.18], [1.52, 0.20, 0.06], side * -0.18, C_CRIMSON)
  }

  addOrnateLantern(bevelProps, cyls, hooks, pills, copings, -3.55, 0.04, -1.65, 0.62, C_STONE_MID, C_LANTERN_GLOW)
  addOrnateLantern(bevelProps, cyls, hooks, pills, copings, 3.55, 0.04, -1.65, -0.62, C_STONE_MID, C_LANTERN_GLOW)

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const r = 0.58 + (i % 2) * 0.05
    pebbles.add([Math.cos(a) * r, 0.09, 2.0 + Math.sin(a) * r], [0.25, 0.17, 0.23], a, i % 2 === 0 ? C_STONE_LIGHT : C_STONE_MID)
  }
  cyls.add([-0.14, 0.10, 2.0], [0.075, 0.64, 0.075], quaternionFromEuler(1.18, 0.35, 0.55), C_WOOD_WARM)
  cyls.add([0.14, 0.10, 2.0], [0.075, 0.64, 0.075], quaternionFromEuler(1.18, -0.35, -0.55), C_WOOD)
  cyls.add([0, 0.11, 1.94], [0.070, 0.58, 0.070], quaternionFromEuler(0.32, 0.12, 1.22), C_WOOD_DARK)
  pebbles.add([0, 0.06, 2.0], [0.42, 0.10, 0.42], 0, C_EMBER, 0.92)

  const addBench = (bx: number, bz: number, yaw: number) => {
    bevelProps.add([bx, 0.28, bz], [1.15, 0.12, 0.42], yaw, C_WOOD_WARM)
    bevelProps.add([bx, 0.50, bz - 0.14 * Math.cos(yaw)], [1.15, 0.16, 0.10], yaw, C_WOOD)
    bevelProps.add([bx - 0.42 * Math.cos(yaw), 0.14, bz + 0.42 * Math.sin(yaw)], [0.14, 0.28, 0.36], yaw, C_WOOD_DARK)
    bevelProps.add([bx + 0.42 * Math.cos(yaw), 0.14, bz - 0.42 * Math.sin(yaw)], [0.14, 0.28, 0.36], yaw, C_WOOD_DARK)
  }
  addBench(-2.95, 1.45, 0.55)
  addBench(2.95, 1.45, -0.55)

  pills.add([-3.85, 0.14, 2.15], [0.30, 0.72, 0.30], quaternionFromEuler(Math.PI / 2, 0.42, 0), C_LEATHER_LIGHT)
  bevelProps.add([3.85, 0.24, 2.10], [0.54, 0.48, 0.54], 0.28, C_WOOD_WARM)
  copings.add([3.85, 0.24, 2.10], [0.58, 0.10, 0.58], 0.28, C_STEEL_DARK)

  const emeraldPal: readonly [Color, Color, Color] = [C_FOREST, C_FOREST_MID, C_FOREST_LIGHT]
  const autumnPal: readonly [Color, Color, Color] = [C_AUTUMN_DEEP, C_AUTUMN_MID, C_AUTUMN_LIGHT]
  const treeSpots: [number, number, number, boolean, boolean][] = [
    [-5.0, -2.8, 1.24, true, false],
    [-5.6, -0.5, 1.02, false, true],
    [-4.8, 1.4, 0.92, false, false],
    [5.0, -2.7, 1.26, true, true],
    [5.5, -0.3, 1.04, false, false],
    [4.9, 1.5, 0.90, false, true],
    [-3.3, -3.5, 1.10, true, true],
    [3.4, -3.4, 1.12, true, false]
  ]
  for (let i = 0; i < treeSpots.length; i++) {
    const [tx, tz, sc, tall, autumn] = treeSpots[i]
    addLayeredTree(trunks, foliageTiers, foliageTips, tx, -0.06, tz, sc, autumn ? autumnPal : emeraldPal, C_WOOD, i * 0.65, tall)
  }

  addRockCluster(pills, pebbles, -4.4, -0.04, -1.5, 0.95, C_STONE_MID, C_STONE_LIGHT, 1.2)
  addRockCluster(pills, pebbles, 4.4, -0.04, -1.4, 0.90, C_STONE_MID, C_STONE_LIGHT, 2.8)
  addRockCluster(pills, pebbles, -2.0, -0.04, 3.3, 0.72, C_STONE_LIGHT, C_STONE_MID, 4.1)
  addRockCluster(pills, pebbles, 2.2, -0.04, 3.2, 0.78, C_STONE_MID, C_STONE_LIGHT, 5.5)

  return [
    terrainCaps, terrainBases, bevelProps, copings, trunks, foliageTiers, foliageTips,
    cyls, hooks, pills, pebbles, rings, arches, gables, gold
  ].filter(b => b.count > 0)
}
