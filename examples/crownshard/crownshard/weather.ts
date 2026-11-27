import type { Color, Vec3 } from 'ridgetop'
import type {
  AttackArc,
  BattleAtmosphere,
  BattleWeatherId,
  BiomeId,
  ElementKind,
  TimeOfDayId
} from './types.ts'

/**
 * Pure Dynamic Weather & Time-of-Day domain module for Crownshard:
 * - Deterministic stage, biome, and Endless wave atmosphere assignment
 * - Tactical combat rule modifiers (Fire, Frost, Slow duration, Dusk ambush Crit)
 * - Pure 3D scene lighting shifts consumed identically across WebGPU, WebGL 2, and Canvas 2D
 *
 * Zero browser globals so it runs identically in Node/Bun/Deno and compiles cleanly to Godot.
 */

export const BATTLE_WEATHER_IDS: readonly BattleWeatherId[] = ['clear', 'rain', 'blizzard', 'dusk']

export const TIME_OF_DAY_IDS: readonly TimeOfDayId[] = ['day', 'dusk', 'night']

export interface WeatherSpec {
  readonly id: BattleWeatherId
  readonly name: string
  readonly shortLabel: string
  readonly ruleSummary: string
  readonly compactRule: string
  readonly detailDesc: string
  readonly accentHex: string
  readonly bgTopHex: string
  readonly bgBotHex: string
  readonly borderHex: string
  readonly fireDamageMul: number
  readonly frostDamageMul: number
  readonly allCritBonus: number
  readonly frostCritBonus: number
  readonly flankBackCritBonus: number
  readonly slowBonusTurns: number
}

export const WEATHER_SPECS: Readonly<Record<BattleWeatherId, WeatherSpec>> = {
  clear: {
    id: 'clear',
    name: 'Clear',
    shortLabel: 'Clear',
    ruleSummary: 'Balanced skies · Standard rules',
    compactRule: 'Standard rules',
    detailDesc: 'Clear skies over the battlefield. Fire, Frost, and Critical Hit rules operate at their balanced baseline.',
    accentHex: '#ffe17d',
    bgTopHex: '#25395e',
    bgBotHex: '#15223d',
    borderHex: '#ffd76b',
    fireDamageMul: 1,
    frostDamageMul: 1,
    allCritBonus: 0,
    frostCritBonus: 0,
    flankBackCritBonus: 0,
    slowBonusTurns: 0
  },
  rain: {
    id: 'rain',
    name: 'Rain',
    shortLabel: 'Rain',
    ruleSummary: '-15% Fire · +15% Frost · Slow +1t',
    compactRule: '-15% Fire / +15% Frost',
    detailDesc: 'Steady rain dampens Fire (-15% DMG), empowers Frost (+15% DMG), and extends Slow effects by +1 turn.',
    accentHex: '#69c9ff',
    bgTopHex: '#1b3454',
    bgBotHex: '#101f36',
    borderHex: '#5ec4ff',
    fireDamageMul: 0.85,
    frostDamageMul: 1.15,
    allCritBonus: 0,
    frostCritBonus: 0,
    flankBackCritBonus: 0,
    slowBonusTurns: 1
  },
  blizzard: {
    id: 'blizzard',
    name: 'Blizzard',
    shortLabel: 'Blizzard',
    ruleSummary: '+20% Frost · +10% Frost Crit · -15% Fire',
    compactRule: '+20% Frost / -15% Fire',
    detailDesc: 'Howling blizzard empowers Frost (+20% DMG, +10% Crit on Frost attacks) and chills Fire (-15% DMG).',
    accentHex: '#a8f0ff',
    bgTopHex: '#1d3c59',
    bgBotHex: '#11243b',
    borderHex: '#94ebff',
    fireDamageMul: 0.85,
    frostDamageMul: 1.2,
    allCritBonus: 0,
    frostCritBonus: 0.1,
    flankBackCritBonus: 0,
    slowBonusTurns: 0
  },
  dusk: {
    id: 'dusk',
    name: 'Dusk',
    shortLabel: 'Dusk',
    ruleSummary: '+10% Crit · +15% Flank/Back Crit',
    compactRule: '+10% Crit (+25% Flank)',
    detailDesc: 'Long twilight shadows sharpen ambushes: +10% Crit on all attacks and an extra +15% Crit on Flank or Backstab hits.',
    accentHex: '#ff9c63',
    bgTopHex: '#3d2447',
    bgBotHex: '#21132b',
    borderHex: '#ff9257',
    fireDamageMul: 1,
    frostDamageMul: 1,
    allCritBonus: 0.1,
    frostCritBonus: 0,
    flankBackCritBonus: 0.15,
    slowBonusTurns: 0
  }
}

export const TIME_OF_DAY_LABELS: Readonly<Record<TimeOfDayId, string>> = {
  day: 'Daylight',
  dusk: 'Twilight',
  night: 'Nightfall'
}

export function isBattleWeatherId(v: unknown): v is BattleWeatherId {
  return v === 'clear' || v === 'rain' || v === 'blizzard' || v === 'dusk'
}

export function isTimeOfDayId(v: unknown): v is TimeOfDayId {
  return v === 'day' || v === 'dusk' || v === 'night'
}

/**
 * Deterministic stage-level atmosphere assignments so players experience Clear, Rain, Blizzard,
 * and Dusk across the campaign while keeping Border Watch (the opening tutorial & baseline test stage)
 * on standard Clear Daylight.
 */
const STAGE_ATMOSPHERE_OVERRIDES: Readonly<Record<string, BattleAtmosphere>> = {
  // Solis Vale
  border_watch: { weather: 'clear', timeOfDay: 'day' },
  miller_ford: { weather: 'clear', timeOfDay: 'day' },
  oakhaven_market: { weather: 'clear', timeOfDay: 'day' },
  galewind_windmill: { weather: 'rain', timeOfDay: 'day' },

  // Silverfen
  sunken_bridge: { weather: 'rain', timeOfDay: 'day' },
  briar_hollow: { weather: 'dusk', timeOfDay: 'dusk' },
  sunwell_glade: { weather: 'clear', timeOfDay: 'day' },
  emerald_delta: { weather: 'rain', timeOfDay: 'day' },
  sunken_monastery: { weather: 'rain', timeOfDay: 'dusk' },

  // Ashen Catacombs
  lantern_crypt: { weather: 'dusk', timeOfDay: 'night' },
  whispering_barrow: { weather: 'dusk', timeOfDay: 'night' },
  cursed_vault: { weather: 'dusk', timeOfDay: 'night' },
  gloomwood_heart: { weather: 'rain', timeOfDay: 'night' },
  bone_cathedral: { weather: 'dusk', timeOfDay: 'night' },

  // Frostspire
  frostspire_pass: { weather: 'blizzard', timeOfDay: 'day' },
  frozen_lake: { weather: 'blizzard', timeOfDay: 'day' },
  glacial_citadel: { weather: 'blizzard', timeOfDay: 'dusk' },
  runeforge_peak: { weather: 'blizzard', timeOfDay: 'day' },
  wyrm_eyrie: { weather: 'blizzard', timeOfDay: 'night' },

  // Emberwaste
  obsidian_gate: { weather: 'dusk', timeOfDay: 'dusk' },
  ashfall_foundry: { weather: 'dusk', timeOfDay: 'dusk' },
  cinder_colosseum: { weather: 'dusk', timeOfDay: 'dusk' },
  molten_core: { weather: 'dusk', timeOfDay: 'night' },

  // Eclipse Dominion
  eclipse_throne: { weather: 'dusk', timeOfDay: 'night' },

  // Sunbleached Dunes
  mirage_oasis: { weather: 'clear', timeOfDay: 'day' },
  sunken_obelisk: { weather: 'clear', timeOfDay: 'dusk' },
  dune_sovereign: { weather: 'dusk', timeOfDay: 'dusk' },

  // Aether Isles
  starfall_atoll: { weather: 'dusk', timeOfDay: 'night' },
  tempest_spire: { weather: 'rain', timeOfDay: 'dusk' },
  skybreak_bastion: { weather: 'rain', timeOfDay: 'day' },

  // Shattered Expanse
  abyssal_deep: { weather: 'dusk', timeOfDay: 'night' },
  obsidian_rift: { weather: 'dusk', timeOfDay: 'night' },
  first_sun_sanctum: { weather: 'clear', timeOfDay: 'dusk' }
}

/** Default biome atmosphere when no explicit stage override is configured. */
export function defaultAtmosphereForBiome(biome: BiomeId): BattleAtmosphere {
  if (biome === 'river') return { weather: 'rain', timeOfDay: 'day' }
  if (biome === 'aether') return { weather: 'rain', timeOfDay: 'dusk' }
  if (biome === 'frost') return { weather: 'blizzard', timeOfDay: 'day' }
  if (biome === 'crypt' || biome === 'throne' || biome === 'expanse') {
    return { weather: 'dusk', timeOfDay: 'night' }
  }
  if (biome === 'volcano') return { weather: 'dusk', timeOfDay: 'dusk' }
  return { weather: 'clear', timeOfDay: 'day' }
}

export interface ResolveAtmosphereInput {
  readonly stageId?: string
  readonly biome: BiomeId
  readonly endlessWave?: number
  readonly seed?: number
  readonly chapterWeather?: BattleWeatherId
  readonly chapterTimeOfDay?: TimeOfDayId
  readonly overrideWeather?: BattleWeatherId
  readonly overrideTimeOfDay?: TimeOfDayId
}

/**
 * Deterministic atmosphere resolver for campaign stages, world events, Abyss floors, and Endless waves.
 */
export function resolveBattleAtmosphere(input: ResolveAtmosphereInput): BattleAtmosphere {
  let weather: BattleWeatherId
  let timeOfDay: TimeOfDayId

  const wave = input.endlessWave ?? 0
  if (wave > 0) {
    // Wave 1 opens in Clear Daylight as the calm before the storm; Wave 2+ rotates deterministically across all 4 weather types
    if (wave === 1) {
      weather = 'clear'
      timeOfDay = 'day'
    } else {
      const mix = (((input.seed ?? 1337) >>> 0) + wave * 3) >>> 0
      if (input.biome === 'frost') {
        weather = 'blizzard'
        timeOfDay = wave % 2 === 0 ? 'night' : 'day'
      } else if (input.biome === 'river' || input.biome === 'aether') {
        weather = 'rain'
        timeOfDay = wave % 2 === 0 ? 'dusk' : 'day'
      } else if (input.biome === 'crypt' || input.biome === 'throne' || input.biome === 'expanse') {
        weather = 'dusk'
        timeOfDay = 'night'
      } else {
        const cycle: readonly BattleWeatherId[] = ['clear', 'rain', 'dusk', 'blizzard']
        const picked = cycle[mix % cycle.length]
        // Keep volcanic/desert waves dramatic (dusk instead of snow) while preserving all 4 across runs
        weather = (input.biome === 'volcano' || input.biome === 'dunes') && picked === 'blizzard' ? 'dusk' : picked
        timeOfDay = weather === 'dusk'
          ? (wave % 2 === 0 ? 'night' : 'dusk')
          : weather === 'rain' && wave % 3 === 0
            ? 'dusk'
            : 'day'
      }
    }
  } else if (input.stageId && STAGE_ATMOSPHERE_OVERRIDES[input.stageId]) {
    const preset = STAGE_ATMOSPHERE_OVERRIDES[input.stageId]
    weather = preset.weather
    timeOfDay = preset.timeOfDay
  } else {
    const fallback = defaultAtmosphereForBiome(input.biome)
    weather = fallback.weather
    timeOfDay = fallback.timeOfDay
  }

  if (input.chapterWeather) weather = input.chapterWeather
  if (input.chapterTimeOfDay) timeOfDay = input.chapterTimeOfDay
  if (input.overrideWeather) weather = input.overrideWeather
  if (input.overrideTimeOfDay) timeOfDay = input.overrideTimeOfDay

  return { weather, timeOfDay }
}

export interface WeatherCombatModifiers {
  readonly damageMul: number
  readonly critBonus: number
  readonly note: string | null
}

/**
 * Compute deterministic damage multiplier, crit bonus, and concise forecast badge label
 * for a given battle weather, attack element, and directional arc.
 * Used identically by `previewDamageMath` (CombatForecast) and `applyDamageDetailed` (execution).
 */
export function computeWeatherCombatModifiers(
  weather: BattleWeatherId,
  element: ElementKind | null,
  attackArc: AttackArc = 'front'
): WeatherCombatModifiers {
  const spec = WEATHER_SPECS[weather]
  let damageMul = 1
  let critBonus = spec.allCritBonus

  if (element === 'fire') {
    damageMul *= spec.fireDamageMul
  } else if (element === 'frost') {
    damageMul *= spec.frostDamageMul
    critBonus += spec.frostCritBonus
  }

  if ((attackArc === 'flank' || attackArc === 'back') && spec.flankBackCritBonus > 0) {
    critBonus += spec.flankBackCritBonus
  }

  let note: string | null = null
  if (weather === 'rain') {
    if (element === 'fire') note = 'RAIN -15% FIRE'
    else if (element === 'frost') note = 'RAIN +15% FROST'
  } else if (weather === 'blizzard') {
    if (element === 'frost') note = 'BLIZZARD +20% FROST'
    else if (element === 'fire') note = 'BLIZZARD -15% FIRE'
  } else if (weather === 'dusk') {
    const pct = Math.round(critBonus * 100)
    note = pct > 0 ? `DUSK +${pct}% CRIT` : null
  }

  return { damageMul, critBonus, note }
}

/** Extra duration turns added to Slow statuses applied under active weather (Rain: +1 turn). */
export function weatherSlowDurationBonus(weather: BattleWeatherId): number {
  return WEATHER_SPECS[weather].slowBonusTurns
}

/** Human-readable HUD pill label for the active battle weather & time of day. */
export function formatWeatherHudLabel(
  weather: BattleWeatherId,
  timeOfDay: TimeOfDayId,
  compact = false
): string {
  const spec = WEATHER_SPECS[weather]
  if (compact) return spec.shortLabel
  if (weather === 'clear') {
    return `${spec.name} · ${TIME_OF_DAY_LABELS[timeOfDay]}`
  }
  return `${spec.name} · ${spec.compactRule}`
}

export interface BaseLightingStyle {
  readonly sky: Color
  readonly fog: readonly [number, number, number]
  readonly lightDir: Vec3
  readonly lightColor: Vec3
  readonly ambient: number
  readonly skyBounce: Vec3
  readonly groundBounce: Vec3
  readonly shadowTint: Vec3
}

export interface ShiftedBattleLighting {
  readonly sky: Color
  readonly fog: [number, number, number]
  readonly fogNear: number
  readonly fogFar: number
  readonly lightDir: Vec3
  readonly lightColor: Vec3
  readonly ambient: number
  readonly skyBounce: Vec3
  readonly groundBounce: Vec3
  readonly shadowTint: Vec3
  readonly shadowStrength: number
  readonly rimStrength: number
  readonly pointIntensityMul: number
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpVec3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number
): [number, number, number] {
  return [
    clamp01(lerp(a[0], b[0], t)),
    clamp01(lerp(a[1], b[1], t)),
    clamp01(lerp(a[2], b[2], t))
  ]
}

function normalizeDir(d: readonly [number, number, number]): Vec3 {
  const len = Math.hypot(d[0], d[1], d[2])
  if (!Number.isFinite(len) || len < 1e-4) return [-0.5, 0.8, 0.4]
  return [d[0] / len, d[1] / len, d[2] / len]
}

/**
 * Pure 3D scene lighting transform that shifts directional sun angle, directional color,
 * ambient fill, sky/ground hemisphere bounce, fog density/color, shadow tint, and point-light
 * prominence according to `weather` and `timeOfDay`.
 */
export function computeWeatherLighting(
  base: BaseLightingStyle,
  weather: BattleWeatherId,
  timeOfDay: TimeOfDayId
): ShiftedBattleLighting {
  let skyRgb: Vec3 = [base.sky[0], base.sky[1], base.sky[2]]
  let fog: [number, number, number] = [base.fog[0], base.fog[1], base.fog[2]]
  let fogNear = 28
  let fogFar = 88
  let lightDir: Vec3 = [base.lightDir[0], base.lightDir[1], base.lightDir[2]]
  let lightColor: Vec3 = [base.lightColor[0], base.lightColor[1], base.lightColor[2]]
  let ambient = base.ambient
  let skyBounce: Vec3 = [base.skyBounce[0], base.skyBounce[1], base.skyBounce[2]]
  let groundBounce: Vec3 = [base.groundBounce[0], base.groundBounce[1], base.groundBounce[2]]
  let shadowTint: Vec3 = [base.shadowTint[0], base.shadowTint[1], base.shadowTint[2]]
  let shadowStrength = 0.38
  let rimStrength = 0.28
  let pointIntensityMul = 1.0

  if (weather === 'rain') {
    skyRgb = lerpVec3(skyRgb, [0.22, 0.31, 0.44], 0.52)
    fog = lerpVec3(fog, [0.24, 0.34, 0.46], 0.52)
    fogNear = 21
    fogFar = 68
    lightDir = normalizeDir([lightDir[0] * 0.9, Math.max(0.55, lightDir[1] * 0.92), lightDir[2] * 0.9])
    lightColor = lerpVec3(lightColor, [0.70, 0.84, 1.0], 0.46)
    ambient = clamp01(ambient * 0.88)
    skyBounce = lerpVec3(skyBounce, [0.46, 0.60, 0.80], 0.48)
    groundBounce = lerpVec3(groundBounce, [0.24, 0.30, 0.38], 0.42)
    shadowTint = lerpVec3(shadowTint, [0.14, 0.22, 0.36], 0.5)
    shadowStrength = 0.29
    rimStrength = 0.32
    pointIntensityMul = 1.18
  } else if (weather === 'blizzard') {
    skyRgb = lerpVec3(skyRgb, [0.58, 0.75, 0.90], 0.56)
    fog = lerpVec3(fog, [0.60, 0.77, 0.92], 0.58)
    fogNear = 18
    fogFar = 58
    lightDir = normalizeDir([lightDir[0] * 1.05, Math.max(0.52, lightDir[1] * 0.86), lightDir[2] * 0.92])
    lightColor = lerpVec3(lightColor, [0.80, 0.94, 1.0], 0.55)
    ambient = clamp01(lerp(ambient, 0.58, 0.45))
    skyBounce = lerpVec3(skyBounce, [0.76, 0.90, 1.0], 0.55)
    groundBounce = lerpVec3(groundBounce, [0.58, 0.72, 0.88], 0.52)
    shadowTint = lerpVec3(shadowTint, [0.20, 0.34, 0.56], 0.54)
    shadowStrength = 0.31
    rimStrength = 0.36
    pointIntensityMul = 1.12
  } else if (weather === 'dusk') {
    // Dramatic low-angle amber-crimson sunset light casting long shadows across the board
    skyRgb = lerpVec3(skyRgb, [0.36, 0.19, 0.34], 0.58)
    fog = lerpVec3(fog, [0.42, 0.23, 0.31], 0.55)
    fogNear = 23
    fogFar = 74
    lightDir = normalizeDir([-0.82, 0.34, 0.46])
    lightColor = lerpVec3(lightColor, [1.0, 0.64, 0.40], 0.64)
    ambient = clamp01(ambient * 0.84)
    skyBounce = lerpVec3(skyBounce, [0.68, 0.42, 0.58], 0.54)
    groundBounce = lerpVec3(groundBounce, [0.42, 0.24, 0.22], 0.5)
    shadowTint = lerpVec3(shadowTint, [0.18, 0.12, 0.32], 0.6)
    shadowStrength = 0.46
    rimStrength = 0.40
    pointIntensityMul = 1.32
  }

  // Secondary Time-of-Day refinement (allows Rain at Dusk, Blizzard at Night, Clear at Dusk, etc.)
  if (timeOfDay === 'dusk' && weather !== 'dusk') {
    skyRgb = lerpVec3(skyRgb, [0.34, 0.21, 0.36], 0.34)
    fog = lerpVec3(fog, [0.38, 0.24, 0.34], 0.34)
    lightDir = normalizeDir([lightDir[0] * 1.15, Math.max(0.32, lightDir[1] * 0.62), lightDir[2] * 1.05])
    lightColor = lerpVec3(lightColor, [1.0, 0.72, 0.48], 0.36)
    ambient = clamp01(ambient * 0.90)
    shadowTint = lerpVec3(shadowTint, [0.20, 0.14, 0.34], 0.35)
    pointIntensityMul *= 1.18
  } else if (timeOfDay === 'night') {
    skyRgb = lerpVec3(skyRgb, [0.09, 0.12, 0.24], weather === 'dusk' ? 0.52 : 0.64)
    fog = lerpVec3(fog, [0.10, 0.13, 0.26], weather === 'dusk' ? 0.48 : 0.62)
    fogNear = Math.min(fogNear, 22)
    fogFar = Math.min(fogFar, 70)
    lightDir = normalizeDir([lightDir[0], Math.max(0.36, lightDir[1] * 0.78), lightDir[2]])
    lightColor = lerpVec3(lightColor, [0.62, 0.72, 0.98], weather === 'dusk' ? 0.36 : 0.54)
    ambient = clamp01(ambient * 0.78)
    skyBounce = lerpVec3(skyBounce, [0.28, 0.36, 0.64], 0.46)
    groundBounce = lerpVec3(groundBounce, [0.14, 0.16, 0.28], 0.46)
    shadowTint = lerpVec3(shadowTint, [0.08, 0.10, 0.24], 0.55)
    shadowStrength = Math.max(shadowStrength, 0.44)
    rimStrength = Math.max(rimStrength, 0.36)
    pointIntensityMul *= 1.38
  }

  return {
    sky: [skyRgb[0], skyRgb[1], skyRgb[2], 1],
    fog,
    fogNear,
    fogFar,
    lightDir,
    lightColor,
    ambient,
    skyBounce,
    groundBounce,
    shadowTint,
    shadowStrength,
    rimStrength,
    pointIntensityMul
  }
}
