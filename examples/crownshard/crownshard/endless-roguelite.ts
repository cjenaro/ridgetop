import { CHAPTERS, CHAPTER_BY_ID } from './data.ts'
import { defaultTerrainHeightLevel, terrainWalkable } from './types.ts'
import type {
  BattleState,
  BattleUnit,
  BiomeId,
  ChapterEnemySpawn,
  ChapterSpec,
  EndlessBlessingId,
  EndlessBlessingRarity,
  EndlessRunState,
  EnemyArchetypeId,
  GameState
} from './types.ts'

/**
 * Pure Roguelite Endless Mode simulation module:
 * - Deterministic biome & stage rotation across all 9 biomes (no back-to-back biome repeats)
 * - Wave-scaled biome-appropriate enemy rosters with periodic Boss Waves every 3rd wave
 * - 12 distinct tactical Run Blessings (1-of-3 draft between waves, cleared on defeat/abandon)
 * Zero browser globals so it compiles cleanly to Godot GDScript and runs identically on Node/Bun/Deno.
 */

export type EndlessBlessingIcon =
  | 'sword'
  | 'shield'
  | 'bolt'
  | 'gem'
  | 'heart'
  | 'boot'
  | 'crit'
  | 'sparkle'
  | 'target'
  | 'star'
  | 'crown'

export interface EndlessBlessingSpec {
  readonly id: EndlessBlessingId
  readonly name: string
  readonly shortLabel: string
  readonly rarity: EndlessBlessingRarity
  readonly icon: EndlessBlessingIcon
  readonly accentHex: string
  readonly desc: string
  readonly atkMul?: number
  readonly startShield?: number
  readonly speedBonus?: number
  readonly startCtBonus?: number
  readonly maxApBonus?: number
  readonly startApBonus?: number
  readonly lifestealBonus?: number
  readonly moveBonus?: number
  readonly jumpBonus?: number
  readonly critBonus?: number
  readonly defBonus?: number
  readonly turnStartRegen?: number
  readonly damageMul?: number
  readonly burnOnCrit?: boolean
  readonly vsSlowOrStunMul?: number
  readonly phoenixReviveRatio?: number
}

export interface EndlessBlessingModifiers {
  readonly atkMul: number
  readonly startShield: number
  readonly speedBonus: number
  readonly startCtBonus: number
  readonly maxApBonus: number
  readonly startApBonus: number
  readonly lifestealBonus: number
  readonly moveBonus: number
  readonly jumpBonus: number
  readonly critBonus: number
  readonly defBonus: number
  readonly turnStartRegen: number
  readonly damageMul: number
  readonly burnOnCrit: boolean
  readonly vsSlowOrStunMul: number
  readonly phoenixReviveRatio: number
}

export interface EndlessBiomePoolSpec {
  readonly id: BiomeId
  readonly label: string
  readonly accentHex: string
  readonly stageIds: readonly string[]
  readonly enemies: readonly EnemyArchetypeId[]
  readonly bossId: EnemyArchetypeId
  readonly eliteBossId?: EnemyArchetypeId
}

export interface EndlessWaveStageSelection {
  readonly wave: number
  readonly biome: BiomeId
  readonly biomeLabel: string
  readonly stageId: string
  readonly chapter: ChapterSpec
  readonly isBossWave: boolean
}

export const ENDLESS_BOSS_WAVE_INTERVAL = 3
export const ENDLESS_DRAFT_CHOICES = 3

export const ENDLESS_BIOME_ROTATION: readonly BiomeId[] = [
  'meadow',
  'river',
  'crypt',
  'frost',
  'volcano',
  'throne',
  'dunes',
  'aether',
  'expanse'
]

export const ENDLESS_BIOME_POOLS: Readonly<Record<BiomeId, EndlessBiomePoolSpec>> = {
  meadow: {
    id: 'meadow',
    label: 'Meadow',
    accentHex: '#7ad46c',
    stageIds: ['border_watch', 'miller_ford', 'briar_hollow', 'sunwell_glade', 'galewind_windmill'],
    enemies: ['goblin', 'bone_archer', 'orc_brute', 'river_troll'],
    bossId: 'briar_warlord'
  },
  river: {
    id: 'river',
    label: 'River',
    accentHex: '#5cc7b8',
    stageIds: ['sunken_bridge', 'emerald_delta', 'sunken_monastery'],
    enemies: ['river_troll', 'bog_shaman', 'goblin', 'bone_archer'],
    bossId: 'mire_matriarch'
  },
  crypt: {
    id: 'crypt',
    label: 'Crypt',
    accentHex: '#a584e8',
    stageIds: ['lantern_crypt', 'whispering_barrow', 'cursed_vault', 'gloomwood_heart', 'bone_cathedral'],
    enemies: ['crypt_knight', 'bone_necromancer', 'bone_archer', 'orc_brute'],
    bossId: 'ash_inquisitor',
    eliteBossId: 'lich_vaelen'
  },
  frost: {
    id: 'frost',
    label: 'Frost',
    accentHex: '#7adfff',
    stageIds: ['frostspire_pass', 'frozen_lake', 'glacial_citadel', 'runeforge_peak'],
    enemies: ['frost_golem', 'ice_wraith', 'crypt_knight', 'bone_archer'],
    bossId: 'frost_jarl'
  },
  volcano: {
    id: 'volcano',
    label: 'Volcano',
    accentHex: '#ff8a47',
    stageIds: ['obsidian_gate', 'ashfall_foundry', 'cinder_colosseum', 'molten_core'],
    enemies: ['ember_pyromancer', 'orc_brute', 'crypt_knight', 'abyssal_sentinel'],
    bossId: 'magma_warden',
    eliteBossId: 'ignis_titan'
  },
  throne: {
    id: 'throne',
    label: 'Throne',
    accentHex: '#df78e6',
    stageIds: ['eclipse_throne', 'starfall_atoll', 'abyssal_deep'],
    enemies: ['crypt_knight', 'ember_pyromancer', 'bone_necromancer', 'abyssal_sentinel'],
    bossId: 'eclipse_archon'
  },
  dunes: {
    id: 'dunes',
    label: 'Dunes',
    accentHex: '#f0b84f',
    stageIds: ['mirage_oasis', 'sunken_obelisk', 'dune_sovereign'],
    enemies: ['orc_brute', 'ember_pyromancer', 'bone_archer', 'abyssal_sentinel'],
    bossId: 'dune_sovereign_boss'
  },
  aether: {
    id: 'aether',
    label: 'Aether',
    accentHex: '#7cc8ff',
    stageIds: ['tempest_spire', 'skybreak_bastion'],
    enemies: ['ice_wraith', 'ember_pyromancer', 'abyssal_sentinel', 'bog_shaman'],
    bossId: 'astral_warden_boss'
  },
  expanse: {
    id: 'expanse',
    label: 'Expanse',
    accentHex: '#ff70b8',
    stageIds: ['obsidian_rift', 'first_sun_sanctum'],
    enemies: ['abyssal_sentinel', 'bone_necromancer', 'ember_pyromancer', 'crypt_knight'],
    bossId: 'unbroken_crown_boss'
  }
}

export const ENDLESS_BLESSING_IDS: readonly EndlessBlessingId[] = [
  'solar_zeal',
  'aegis_ward',
  'quicksilver_step',
  'arcane_font',
  'vampiric_edge',
  'windrunner_stride',
  'executioners_eye',
  'iron_bastion',
  'battle_mender',
  'ember_blade',
  'frost_heart',
  'phoenix_grace'
]

export const ENDLESS_BLESSINGS: readonly EndlessBlessingSpec[] = [
  {
    id: 'solar_zeal',
    name: 'Solar Zeal',
    shortLabel: '+15% ATK',
    rarity: 'common',
    icon: 'sword',
    accentHex: '#ffba49',
    desc: 'Allies gain +15% ATK for the rest of the Endless run.',
    atkMul: 1.15
  },
  {
    id: 'aegis_ward',
    name: 'Aegis Ward',
    shortLabel: '+18 SHD',
    rarity: 'common',
    icon: 'shield',
    accentHex: '#69c2ff',
    desc: 'Allies begin each wave protected by +18 starting Shield.',
    startShield: 18
  },
  {
    id: 'quicksilver_step',
    name: 'Quicksilver Step',
    shortLabel: '+2 SPD · +15 CT',
    rarity: 'rare',
    icon: 'bolt',
    accentHex: '#70f0ff',
    desc: 'Allies gain +2 SPD and +15 starting CT every wave.',
    speedBonus: 2,
    startCtBonus: 15
  },
  {
    id: 'arcane_font',
    name: 'Arcane Font',
    shortLabel: '+1 AP / Max AP',
    rarity: 'rare',
    icon: 'gem',
    accentHex: '#a882ff',
    desc: 'Gain +1 Max AP and +1 starting AP at the start of every wave.',
    maxApBonus: 1,
    startApBonus: 1
  },
  {
    id: 'vampiric_edge',
    name: 'Vampiric Edge',
    shortLabel: '+12% Drain',
    rarity: 'rare',
    icon: 'heart',
    accentHex: '#ff5e78',
    desc: 'Allies gain +12% Lifesteal on attacks and skills.',
    lifestealBonus: 0.12
  },
  {
    id: 'windrunner_stride',
    name: 'Windrunner Stride',
    shortLabel: '+1 Mov · +1 Jmp',
    rarity: 'rare',
    icon: 'boot',
    accentHex: '#62f5a8',
    desc: 'Allies gain +1 Move and +1 Jump across elevated terrain.',
    moveBonus: 1,
    jumpBonus: 1
  },
  {
    id: 'executioners_eye',
    name: "Executioner's Eye",
    shortLabel: '+15% Crit',
    rarity: 'common',
    icon: 'crit',
    accentHex: '#ffdf59',
    desc: 'Allies gain +15% Critical Hit chance on all attacks.',
    critBonus: 0.15
  },
  {
    id: 'iron_bastion',
    name: 'Iron Bastion',
    shortLabel: '+3 DEF',
    rarity: 'common',
    icon: 'shield',
    accentHex: '#9eb6d4',
    desc: 'Allies fortify their guard with +3 DEF.',
    defBonus: 3
  },
  {
    id: 'battle_mender',
    name: 'Battle Mender',
    shortLabel: '+8 HP/Turn',
    rarity: 'epic',
    icon: 'sparkle',
    accentHex: '#5ef29b',
    desc: 'Allies regenerate +8 HP at the start of their turn.',
    turnStartRegen: 8
  },
  {
    id: 'ember_blade',
    name: 'Ember Blade',
    shortLabel: '+10% DMG · Burn',
    rarity: 'epic',
    icon: 'target',
    accentHex: '#ff8a47',
    desc: 'Allies deal +10% damage and inflict Burn on critical hits.',
    damageMul: 1.10,
    burnOnCrit: true
  },
  {
    id: 'frost_heart',
    name: 'Frost Heart',
    shortLabel: '+20% vs CC',
    rarity: 'epic',
    icon: 'star',
    accentHex: '#7adfff',
    desc: 'Allies deal +20% damage against Slowed or Stunned foes.',
    vsSlowOrStunMul: 1.20
  },
  {
    id: 'phoenix_grace',
    name: 'Phoenix Grace',
    shortLabel: 'Auto-Revive 40%',
    rarity: 'legendary',
    icon: 'crown',
    accentHex: '#ffcb57',
    desc: 'Once per wave, the first hero reaching 0 HP auto-revives at 40% HP.',
    phoenixReviveRatio: 0.40
  }
]

export const ENDLESS_BLESSING_BY_ID: Readonly<Record<EndlessBlessingId, EndlessBlessingSpec>> = {
  solar_zeal: ENDLESS_BLESSINGS[0],
  aegis_ward: ENDLESS_BLESSINGS[1],
  quicksilver_step: ENDLESS_BLESSINGS[2],
  arcane_font: ENDLESS_BLESSINGS[3],
  vampiric_edge: ENDLESS_BLESSINGS[4],
  windrunner_stride: ENDLESS_BLESSINGS[5],
  executioners_eye: ENDLESS_BLESSINGS[6],
  iron_bastion: ENDLESS_BLESSINGS[7],
  battle_mender: ENDLESS_BLESSINGS[8],
  ember_blade: ENDLESS_BLESSINGS[9],
  frost_heart: ENDLESS_BLESSINGS[10],
  phoenix_grace: ENDLESS_BLESSINGS[11]
}

export const ENDLESS_BLESSING_RARITY_META: Readonly<Record<EndlessBlessingRarity, {
  readonly label: string
  readonly hex: string
  readonly bgHex: string
  readonly glowHex: string
}>> = {
  common: { label: 'COMMON', hex: '#9fb4c2', bgHex: '#1b2836', glowHex: '#7a95a8' },
  rare: { label: 'RARE', hex: '#5ca8ff', bgHex: '#152742', glowHex: '#4f9eff' },
  epic: { label: 'EPIC', hex: '#c87dff', bgHex: '#291b3e', glowHex: '#c06bff' },
  legendary: { label: 'LEGENDARY', hex: '#ffcb57', bgHex: '#3a2a12', glowHex: '#ffba33' }
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function mixSeed32(seed: number, salt: number): number {
  let x = ((seed ^ salt) >>> 0) || 0x9e3779b9
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x === 0 ? 0x9e3779b9 : x
}

function nextUint32(state: number): number {
  let x = state >>> 0
  if (x === 0) x = 0x6d2b79f5
  x ^= (x << 13) >>> 0
  x ^= x >>> 17
  x ^= (x << 5) >>> 0
  return (x >>> 0) || 0x6d2b79f5
}

export function isEndlessBlessingId(raw: unknown): raw is EndlessBlessingId {
  return (
    raw === 'solar_zeal' ||
    raw === 'aegis_ward' ||
    raw === 'quicksilver_step' ||
    raw === 'arcane_font' ||
    raw === 'vampiric_edge' ||
    raw === 'windrunner_stride' ||
    raw === 'executioners_eye' ||
    raw === 'iron_bastion' ||
    raw === 'battle_mender' ||
    raw === 'ember_blade' ||
    raw === 'frost_heart' ||
    raw === 'phoenix_grace'
  )
}

export function isEndlessBiomeId(raw: unknown): raw is BiomeId {
  return (
    raw === 'meadow' ||
    raw === 'river' ||
    raw === 'crypt' ||
    raw === 'frost' ||
    raw === 'volcano' ||
    raw === 'throne' ||
    raw === 'dunes' ||
    raw === 'aether' ||
    raw === 'expanse'
  )
}

export function getEndlessBlessingSpec(id: EndlessBlessingId): EndlessBlessingSpec {
  return ENDLESS_BLESSING_BY_ID[id]
}

export function formatEndlessBiomeLabel(biome: BiomeId): string {
  return ENDLESS_BIOME_POOLS[biome]?.label ?? 'Throne'
}

export function isEndlessBossWave(wave: number): boolean {
  const safeWave = Math.max(1, Math.floor(wave))
  return safeWave >= ENDLESS_BOSS_WAVE_INTERVAL && safeWave % ENDLESS_BOSS_WAVE_INTERVAL === 0
}

export function normalizeEndlessBlessings(raw: readonly unknown[] | null | undefined): EndlessBlessingId[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const seen = new Set<EndlessBlessingId>()
  const out: EndlessBlessingId[] = []
  for (const item of raw) {
    if (isEndlessBlessingId(item) && !seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}

function isRecordObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function sanitizeEndlessRunState(raw: unknown): EndlessRunState | null {
  if (!isRecordObj(raw)) return null
  const seedRaw = typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? (raw.seed >>> 0) : 0
  if (seedRaw === 0) return null
  const waveRaw = typeof raw.currentWave === 'number' && Number.isFinite(raw.currentWave)
    ? Math.max(1, Math.floor(raw.currentWave))
    : 1
  const activeBlessings = normalizeEndlessBlessings(Array.isArray(raw.activeBlessings) ? raw.activeBlessings : [])
  const rawDraft = normalizeEndlessBlessings(Array.isArray(raw.pendingDraft) ? raw.pendingDraft : [])
  const pendingDraft: EndlessBlessingId[] = []
  for (const id of rawDraft) {
    if (!activeBlessings.includes(id)) {
      pendingDraft.push(id)
      if (pendingDraft.length >= ENDLESS_DRAFT_CHOICES) break
    }
  }
  const lastBiome = isEndlessBiomeId(raw.lastBiome) ? raw.lastBiome : undefined
  return {
    seed: seedRaw,
    currentWave: waveRaw,
    activeBlessings,
    pendingDraft,
    ...(lastBiome !== undefined ? { lastBiome } : {})
  }
}

export function cloneEndlessRunState(run: EndlessRunState | null | undefined): EndlessRunState | null {
  if (!run) return null
  return {
    seed: (run.seed >>> 0) || 1337,
    currentWave: Math.max(1, Math.floor(run.currentWave)),
    activeBlessings: normalizeEndlessBlessings(run.activeBlessings),
    pendingDraft: normalizeEndlessBlessings(run.pendingDraft),
    ...(run.lastBiome !== undefined ? { lastBiome: run.lastBiome } : {})
  }
}

function buildShuffledBiomeCycle(runSeed: number, cycleIndex: number): BiomeId[] {
  const arr: BiomeId[] = ENDLESS_BIOME_ROTATION.slice()
  let rng = mixSeed32(runSeed, Math.imul(cycleIndex + 1, 0x27d4eb2d) ^ 0x51f15e5)
  for (let i = arr.length - 1; i > 0; i--) {
    rng = nextUint32(rng)
    const j = rng % (i + 1)
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  if (cycleIndex > 0) {
    const prevCycle = buildShuffledBiomeCycle(runSeed, cycleIndex - 1)
    const prevLast = prevCycle[prevCycle.length - 1]
    if (arr[0] === prevLast) {
      rng = nextUint32(rng)
      const swapIdx = 1 + (rng % (arr.length - 1))
      const tmp = arr[0]
      arr[0] = arr[swapIdx]
      arr[swapIdx] = tmp
    }
  }
  return arr
}

/**
 * Deterministically selects a varied biome and stage layout for an Endless wave.
 * Guarantees no back-to-back biome repeats across consecutive waves and cycles
 * through all 9 biomes (Meadow, River, Crypt, Frost, Volcano, Throne, Dunes, Aether, Expanse).
 */
export function selectEndlessWaveStage(
  runSeed: number,
  wave: number,
  prevBiome?: BiomeId
): EndlessWaveStageSelection {
  const safeSeed = (runSeed >>> 0) || 1337
  const safeWave = Math.max(1, Math.floor(wave))
  const count = ENDLESS_BIOME_ROTATION.length
  const cycleIndex = Math.floor((safeWave - 1) / count)
  const slotInCycle = (safeWave - 1) % count
  const cycle = buildShuffledBiomeCycle(safeSeed, cycleIndex)
  let biome: BiomeId = cycle[slotInCycle]
  if (prevBiome !== undefined && biome === prevBiome) {
    biome = cycle[(slotInCycle + 1) % count]
  }

  const pool = ENDLESS_BIOME_POOLS[biome]
  const stageHash = mixSeed32(safeSeed, Math.imul(safeWave, 0x45d9f3b) ^ 0x1b873593)
  const validStages: ChapterSpec[] = []
  for (const sid of pool.stageIds) {
    const ch = CHAPTER_BY_ID[sid]
    if (ch && ch.kind !== 'town' && !ch.comingSoon) {
      validStages.push(ch)
    }
  }
  const chapter = validStages.length > 0
    ? validStages[stageHash % validStages.length]
    : (CHAPTER_BY_ID.eclipse_throne ?? CHAPTERS[0])

  return {
    wave: safeWave,
    biome: chapter.biome,
    biomeLabel: formatEndlessBiomeLabel(chapter.biome),
    stageId: chapter.id,
    chapter,
    isBossWave: isEndlessBossWave(safeWave)
  }
}

function getChapterHeightLevel(chapter: ChapterSpec, col: number, row: number): number {
  const terrain = chapter.grid[row][col]
  if (terrain === 'void') return -1
  const h = chapter.heights?.[row]?.[col]
  if (h !== undefined && Number.isFinite(h)) return Math.round(h)
  return defaultTerrainHeightLevel(terrain)
}

function collectJump1ReachableCoords(chapter: ChapterSpec): Set<string> {
  const rows = chapter.grid.length
  const cols = chapter.grid[0]?.length ?? 0
  const visited = new Set<string>()
  const queue: { col: number; row: number }[] = []

  for (const sp of chapter.heroSpawns) {
    const sc = sp[0]
    const sr = sp[1]
    if (sr < 0 || sr >= rows || sc < 0 || sc >= cols) continue
    if (!terrainWalkable(chapter.grid[sr][sc])) continue
    const key = `${sc},${sr}`
    if (!visited.has(key)) {
      visited.add(key)
      queue.push({ col: sc, row: sr })
    }
  }

  const dirs: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ]
  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    const curH = getChapterHeightLevel(chapter, cur.col, cur.row)
    for (const d of dirs) {
      const nc = cur.col + d[0]
      const nr = cur.row + d[1]
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
      const key = `${nc},${nr}`
      if (visited.has(key)) continue
      if (!terrainWalkable(chapter.grid[nr][nc])) continue
      const nextH = getChapterHeightLevel(chapter, nc, nr)
      if (Math.abs(nextH - curH) > 1) continue
      visited.add(key)
      queue.push({ col: nc, row: nr })
    }
  }
  return visited
}

/**
 * Generates wave-scaled, biome-appropriate enemy spawns for an Endless wave.
 * Guarantees every enemy spawns on a walkable, non-overlapping, jump-1 reachable tile
 * and inserts a regional/frontier Boss every 3rd wave!
 */
export function buildEndlessWaveEnemies(
  chapter: ChapterSpec,
  wave: number,
  runSeed: number
): ChapterEnemySpawn[] {
  const safeWave = Math.max(1, Math.floor(wave))
  const safeSeed = (runSeed >>> 0) || 1337
  const pool = ENDLESS_BIOME_POOLS[chapter.biome] ?? ENDLESS_BIOME_POOLS.throne
  const rows = chapter.grid.length
  const cols = chapter.grid[0]?.length ?? 0
  const reachable = collectJump1ReachableCoords(chapter)

  const blocked = new Set<string>()
  for (const sp of chapter.heroSpawns) {
    blocked.add(`${sp[0]},${sp[1]}`)
  }

  const targetCount = clampNum(3 + Math.floor((safeWave + 1) / 2), 4, 5)
  const slots: { col: number; row: number }[] = []

  // Prefer the chapter's authored enemy spawn tiles first (filtered for walkability & jump-1 reachability)
  for (const e of chapter.enemies) {
    if (e.row < 0 || e.row >= rows || e.col < 0 || e.col >= cols) continue
    const key = `${e.col},${e.row}`
    if (blocked.has(key) || !reachable.has(key)) continue
    if (!terrainWalkable(chapter.grid[e.row][e.col])) continue
    blocked.add(key)
    slots.push({ col: e.col, row: e.row })
    if (slots.length >= targetCount) break
  }

  // Fill any extra slots with reachable walkable tiles furthest from hero spawns
  if (slots.length < targetCount) {
    const candidates: { col: number; row: number; score: number }[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = `${c},${r}`
        if (blocked.has(key) || !reachable.has(key)) continue
        if (!terrainWalkable(chapter.grid[r][c])) continue
        let minHeroDist = 999
        for (const hs of chapter.heroSpawns) {
          const dist = Math.abs(c - hs[0]) + Math.abs(r - hs[1])
          if (dist < minHeroDist) minHeroDist = dist
        }
        if (minHeroDist < 2) continue
        candidates.push({ col: c, row: r, score: minHeroDist * 10 + c })
      }
    }
    candidates.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.row - b.row))
    for (const cand of candidates) {
      if (slots.length >= targetCount) break
      const key = `${cand.col},${cand.row}`
      if (blocked.has(key)) continue
      blocked.add(key)
      slots.push({ col: cand.col, row: cand.row })
    }
  }

  // Sort slots so the deepest backline slot can anchor a Boss on boss waves
  let bossSlotIdx = 0
  let bestBossScore = -1
  for (let i = 0; i < slots.length; i++) {
    const score = slots[i].col * 10 - Math.abs(slots[i].row - (rows - 1) * 0.5)
    if (score > bestBossScore) {
      bestBossScore = score
      bossSlotIdx = i
    }
  }

  const bossWave = isEndlessBossWave(safeWave)
  const bossId: EnemyArchetypeId = safeWave >= 6 && pool.eliteBossId ? pool.eliteBossId : pool.bossId
  let rng = mixSeed32(safeSeed, Math.imul(safeWave, 0x85ebca6b) ^ 0x3c6ef372)
  const spawns: ChapterEnemySpawn[] = []

  for (let i = 0; i < slots.length; i++) {
    const pos = slots[i]
    if (bossWave && i === bossSlotIdx) {
      spawns.push({
        id: bossId,
        col: pos.col,
        row: pos.row,
        levelScale: safeWave >= 6 ? 1.05 : 0.95
      })
    } else {
      rng = nextUint32(rng)
      const enemyId = pool.enemies[(rng + i) % pool.enemies.length]
      spawns.push({
        id: enemyId,
        col: pos.col,
        row: pos.row,
        levelScale: 1.0
      })
    }
  }

  return spawns
}

/**
 * Generates up to 3 deterministic, non-duplicate blessing offers excluding already-active run blessings.
 */
export function generateEndlessBlessingDraft(
  runSeed: number,
  wave: number,
  activeBlessings: readonly EndlessBlessingId[] = []
): EndlessBlessingId[] {
  const owned = new Set<EndlessBlessingId>(normalizeEndlessBlessings(activeBlessings))
  const remaining: EndlessBlessingSpec[] = []
  for (const spec of ENDLESS_BLESSINGS) {
    if (!owned.has(spec.id)) {
      remaining.push(spec)
    }
  }
  if (remaining.length <= ENDLESS_DRAFT_CHOICES) {
    return remaining.map(b => b.id)
  }

  const safeWave = Math.max(1, Math.floor(wave))
  let rng = mixSeed32((runSeed >>> 0) || 1337, Math.imul(safeWave, 0x9e3779b1) ^ 0x7f4a7c15)
  const picks: EndlessBlessingId[] = []
  const pool = remaining.slice()

  while (picks.length < ENDLESS_DRAFT_CHOICES && pool.length > 0) {
    let totalWeight = 0
    const weights: number[] = []
    for (const spec of pool) {
      let w = 40
      if (spec.rarity === 'common') w = Math.max(18, 42 - safeWave * 2)
      else if (spec.rarity === 'rare') w = 34
      else if (spec.rarity === 'epic') w = 18 + Math.min(18, safeWave * 2)
      else if (spec.rarity === 'legendary') w = 8 + Math.min(16, safeWave * 2)
      weights.push(w)
      totalWeight += w
    }
    rng = nextUint32(rng)
    let roll = rng % Math.max(1, totalWeight)
    let chosenIdx = 0
    for (let i = 0; i < pool.length; i++) {
      if (roll < weights[i]) {
        chosenIdx = i
        break
      }
      roll -= weights[i]
    }
    picks.push(pool[chosenIdx].id)
    pool.splice(chosenIdx, 1)
  }

  return picks
}

/** Aggregates all live stat and combat modifiers granted by active Endless Run Blessings. */
export function computeEndlessBlessingModifiers(
  blessings: readonly EndlessBlessingId[] | null | undefined
): EndlessBlessingModifiers {
  const list = normalizeEndlessBlessings(blessings)
  let atkMul = 1.0
  let startShield = 0
  let speedBonus = 0
  let startCtBonus = 0
  let maxApBonus = 0
  let startApBonus = 0
  let lifestealBonus = 0
  let moveBonus = 0
  let jumpBonus = 0
  let critBonus = 0
  let defBonus = 0
  let turnStartRegen = 0
  let damageMul = 1.0
  let burnOnCrit = false
  let vsSlowOrStunMul = 1.0
  let phoenixReviveRatio = 0

  for (const id of list) {
    const spec = ENDLESS_BLESSING_BY_ID[id]
    if (!spec) continue
    if (spec.atkMul !== undefined) atkMul *= spec.atkMul
    if (spec.startShield !== undefined) startShield += spec.startShield
    if (spec.speedBonus !== undefined) speedBonus += spec.speedBonus
    if (spec.startCtBonus !== undefined) startCtBonus += spec.startCtBonus
    if (spec.maxApBonus !== undefined) maxApBonus += spec.maxApBonus
    if (spec.startApBonus !== undefined) startApBonus += spec.startApBonus
    if (spec.lifestealBonus !== undefined) lifestealBonus += spec.lifestealBonus
    if (spec.moveBonus !== undefined) moveBonus += spec.moveBonus
    if (spec.jumpBonus !== undefined) jumpBonus += spec.jumpBonus
    if (spec.critBonus !== undefined) critBonus += spec.critBonus
    if (spec.defBonus !== undefined) defBonus += spec.defBonus
    if (spec.turnStartRegen !== undefined) turnStartRegen += spec.turnStartRegen
    if (spec.damageMul !== undefined) damageMul *= spec.damageMul
    if (spec.burnOnCrit) burnOnCrit = true
    if (spec.vsSlowOrStunMul !== undefined) vsSlowOrStunMul *= spec.vsSlowOrStunMul
    if (spec.phoenixReviveRatio !== undefined && spec.phoenixReviveRatio > phoenixReviveRatio) {
      phoenixReviveRatio = spec.phoenixReviveRatio
    }
  }

  return {
    atkMul,
    startShield,
    speedBonus,
    startCtBonus,
    maxApBonus,
    startApBonus,
    lifestealBonus,
    moveBonus,
    jumpBonus,
    critBonus,
    defBonus,
    turnStartRegen,
    damageMul,
    burnOnCrit,
    vsSlowOrStunMul,
    phoenixReviveRatio
  }
}

/** Applies active Endless Run Blessing stat bonuses onto a spawned ally unit. */
export function applyEndlessBlessingsToUnit(
  unit: BattleUnit,
  blessings: readonly EndlessBlessingId[] | null | undefined
): void {
  if (unit.team !== 'ally') return
  const mods = computeEndlessBlessingModifiers(blessings)
  if (mods.atkMul !== 1.0) {
    unit.atk = Math.max(1, Math.round(unit.atk * mods.atkMul))
  }
  if (mods.startShield > 0) {
    unit.shield += mods.startShield
  }
  if (mods.speedBonus > 0) {
    unit.speed = clampNum(unit.speed + mods.speedBonus, 1, 50)
  }
  if (mods.startCtBonus > 0) {
    unit.ct += mods.startCtBonus
  }
  if (mods.lifestealBonus > 0) {
    unit.lifesteal = clampNum(unit.lifesteal + mods.lifestealBonus, 0, 0.9)
  }
  if (mods.moveBonus > 0) {
    unit.move = clampNum(unit.move + mods.moveBonus, 1, 12)
  }
  if (mods.jumpBonus > 0) {
    unit.jump = clampNum(unit.jump + mods.jumpBonus, 0, 8)
  }
  if (mods.critBonus > 0) {
    unit.crit = clampNum(unit.crit + mods.critBonus, 0, 0.95)
  }
  if (mods.defBonus > 0) {
    unit.def = Math.max(0, unit.def + mods.defBonus)
  }
}

/**
 * Live attacker damage multiplier from active Endless Run Blessings
 * (`ember_blade` +10% DMG, `frost_heart` +20% DMG vs Slowed/Stunned).
 * Shared by both `previewDamageMath` (`CombatForecast`) and `applyDamageDetailed`.
 */
export function computeEndlessAttackerDamageMultiplier(
  blessings: readonly EndlessBlessingId[] | null | undefined,
  attacker: Pick<BattleUnit, 'team'> | null | undefined,
  defender: Pick<BattleUnit, 'slowTurns' | 'stunTurns'>
): number {
  if (!attacker || attacker.team !== 'ally') return 1.0
  const mods = computeEndlessBlessingModifiers(blessings)
  let mul = mods.damageMul
  if (mods.vsSlowOrStunMul !== 1.0 && (defender.slowTurns > 0 || defender.stunTurns > 0)) {
    mul *= mods.vsSlowOrStunMul
  }
  return mul
}

/** True when `ember_blade` should inflict Burn on an ally's critical hit. */
export function shouldEndlessApplyBurnOnCrit(
  blessings: readonly EndlessBlessingId[] | null | undefined,
  attacker: Pick<BattleUnit, 'team'> | null | undefined
): boolean {
  if (!attacker || attacker.team !== 'ally') return false
  return computeEndlessBlessingModifiers(blessings).burnOnCrit
}

/** Turn-start HP regeneration from `battle_mender` (+8 HP for injured living allies). */
export function computeEndlessTurnStartRegen(
  blessings: readonly EndlessBlessingId[] | null | undefined,
  unit: Pick<BattleUnit, 'team' | 'alive' | 'hp' | 'maxHp'>
): number {
  if (unit.team !== 'ally' || !unit.alive || unit.hp >= unit.maxHp) return 0
  return computeEndlessBlessingModifiers(blessings).turnStartRegen
}

/** True if `phoenix_grace` is active, unused this wave, and can auto-revive a hero reaching 0 HP. */
export function canTriggerPhoenixGrace(
  battle: Partial<Pick<BattleState, 'endlessBlessings' | 'phoenixGraceUsed'>> | null | undefined,
  unit: Pick<BattleUnit, 'team'>
): boolean {
  if (!battle || unit.team !== 'ally' || battle.phoenixGraceUsed) return false
  return computeEndlessBlessingModifiers(battle.endlessBlessings).phoenixReviveRatio > 0
}

/**
 * Starts a fresh Roguelite Endless Run on `state.campaign.endlessRun` with a deterministic run seed.
 */
export function startEndlessRun(state: GameState, startWave = 1): EndlessRunState {
  const { campaign } = state
  const safeWave = Math.max(1, Math.floor(startWave))
  const salt = Math.imul(campaign.battlesWon + 1, 0x9e3779b1) ^ Math.imul(campaign.endlessBest + 1, 0x85ebca6b)
  const runSeed = mixSeed32(campaign.seed, salt)
  // Nudge campaign seed deterministically so starting a second fresh run rolls a distinct biome order
  campaign.seed = nextUint32(campaign.seed ^ runSeed)
  const run: EndlessRunState = {
    seed: runSeed,
    currentWave: safeWave,
    activeBlessings: [],
    pendingDraft: []
  }
  campaign.endlessRun = run
  return run
}

/**
 * Populates the 1-of-3 Run Blessing draft after winning an Endless wave.
 */
export function prepareEndlessVictoryDraft(
  state: GameState,
  clearedWave: number,
  clearedBiome: BiomeId
): EndlessBlessingId[] {
  const { campaign } = state
  const safeWave = Math.max(1, Math.floor(clearedWave))
  if (!campaign.endlessRun) {
    const inherited = state.battle ? normalizeEndlessBlessings(state.battle.endlessBlessings) : []
    campaign.endlessRun = {
      seed: mixSeed32(campaign.seed, Math.imul(safeWave, 0x27d4eb2d)),
      currentWave: safeWave,
      activeBlessings: inherited,
      pendingDraft: [],
      lastBiome: clearedBiome
    }
  }
  const run = campaign.endlessRun
  run.currentWave = safeWave
  run.lastBiome = clearedBiome
  run.pendingDraft = generateEndlessBlessingDraft(run.seed, safeWave, run.activeBlessings)
  return run.pendingDraft.slice()
}

/**
 * Claims one of the pending Run Blessing offers after an Endless victory and advances `currentWave`.
 */
export function draftEndlessBlessing(state: GameState, blessingId: EndlessBlessingId): boolean {
  const run = state.campaign.endlessRun
  if (!run) return false
  if (!isEndlessBlessingId(blessingId)) return false
  if (!run.pendingDraft.includes(blessingId)) return false
  if (run.activeBlessings.includes(blessingId)) return false

  run.activeBlessings.push(blessingId)
  run.pendingDraft = []
  run.currentWave = Math.max(1, Math.floor(run.currentWave)) + 1
  state.sounds.push({ kind: 'equip' })
  return true
}

/**
 * Abandons the current Roguelite Endless Run, clearing temporary blessings while preserving `endlessBest`.
 */
export function abandonEndlessRun(state: GameState): boolean {
  const hadRun = state.campaign.endlessRun !== null
  state.campaign.endlessRun = null
  return hadRun
}
