export type WeatherKind = 'clear' | 'fog' | 'rain' | 'storm'
export type TidePhase = 'low' | 'rising' | 'high' | 'ebbing'
export type ResourceKind = 'driftwood' | 'salvage' | 'amber'
export type UpgradeId = 'boots' | 'pack' | 'cloak' | 'lens' | 'winch' | 'charter'

export interface UpgradeSpec {
  readonly id: UpgradeId
  readonly name: string
  readonly short: string
  readonly maxLevel: number
  readonly baseCost: number
  readonly costScale: number
  readonly describe: (level: number) => string
}

export const UPGRADES: readonly UpgradeSpec[] = [
  {
    id: 'boots',
    name: 'Tide Waders',
    short: 'Run speed & wading',
    maxLevel: 5,
    baseCost: 30,
    costScale: 1.75,
    describe: lv => `Speed +${(lv - 1) * 14}% · Less tide drag`
  },
  {
    id: 'pack',
    name: 'Hauler Satchel',
    short: 'Carry cap & magnet',
    maxLevel: 5,
    baseCost: 35,
    costScale: 1.8,
    describe: lv => `Carry ${carryCapFor(lv)} · Magnet ${pickupRadiusFor(lv).toFixed(1)}m`
  },
  {
    id: 'cloak',
    name: 'Oilskin Cloak',
    short: 'Storm & cold resist',
    maxLevel: 5,
    baseCost: 40,
    costScale: 1.8,
    describe: lv => `Cold -${Math.round((1 - coldFactorFor(lv)) * 100)}% · Wind resist`
  },
  {
    id: 'lens',
    name: 'Fresnel Lens',
    short: 'Beam & ship bounty',
    maxLevel: 5,
    baseCost: 55,
    costScale: 1.9,
    describe: lv => `Bounty ×${shipBountyMultFor(lv).toFixed(2)} · Slow burn`
  },
  {
    id: 'winch',
    name: 'Pier Winch',
    short: 'Auto-salvage crane',
    maxLevel: 4,
    baseCost: 65,
    costScale: 2.0,
    describe: lv => lv === 0 ? 'Unlocks auto-salvage crane' : `+${winchPayoutFor(lv)}g every ${winchIntervalFor(lv).toFixed(1)}s`
  },
  {
    id: 'charter',
    name: 'Trade Charter',
    short: 'Higher sell prices',
    maxLevel: 5,
    baseCost: 45,
    costScale: 1.85,
    describe: lv => `Sell value ×${sellMultFor(lv).toFixed(2)}`
  }
]

export const RESOURCE_BASE_VALUE: Record<ResourceKind, number> = {
  driftwood: 8,
  salvage: 22,
  amber: 48
}

export const RESOURCE_FUEL_VALUE: Record<ResourceKind, number> = {
  driftwood: 22,
  salvage: 14,
  amber: 42
}

export function upgradeCost(spec: UpgradeSpec, currentLevel: number): number {
  const step = spec.id === 'winch' ? currentLevel : currentLevel - 1
  return Math.round(spec.baseCost * Math.pow(spec.costScale, Math.max(0, step)) / 5) * 5
}

export function carryCapFor(packLevel: number): number {
  return [0, 5, 8, 12, 17, 24][Math.max(1, Math.min(5, packLevel))]
}

export function pickupRadiusFor(packLevel: number): number {
  return 1.35 + (packLevel - 1) * 0.35
}

export function speedFor(bootsLevel: number): number {
  return 5.4 * (1 + (bootsLevel - 1) * 0.14)
}

export function wadeFactorFor(bootsLevel: number): number {
  return Math.min(0.95, 0.46 + (bootsLevel - 1) * 0.12)
}

export function coldFactorFor(cloakLevel: number): number {
  return Math.max(0.28, 1 - (cloakLevel - 1) * 0.17)
}

export function shipBountyMultFor(lensLevel: number): number {
  return 1 + (lensLevel - 1) * 0.38
}

export function fuelBurnMultFor(lensLevel: number): number {
  return Math.max(0.45, 1 - (lensLevel - 1) * 0.13)
}

export function sellMultFor(charterLevel: number): number {
  return 1 + (charterLevel - 1) * 0.28
}

export function winchPayoutFor(winchLevel: number): number {
  return winchLevel <= 0 ? 0 : 12 + (winchLevel - 1) * 14
}

export function winchIntervalFor(winchLevel: number): number {
  return Math.max(2.6, 6.2 - winchLevel * 0.85)
}

export interface ZonePad {
  readonly id: 'fuel' | 'sell' | 'shop' | 'brazier'
  readonly label: string
  readonly x: number
  readonly z: number
  readonly radius: number
}

export const LIGHTHOUSE_POS = { x: 2.2, z: -3.2 } as const
export const COTTAGE_POS = { x: -3.8, z: -2.4 } as const
export const PIER_POS = { x: -5.8, z: 4.8 } as const
export const WINCH_POS = { x: -7.4, z: 5.7 } as const

export const PADS: readonly ZonePad[] = [
  { id: 'fuel', label: 'LIGHTHOUSE FUEL', x: 2.2, z: -0.6, radius: 1.75 },
  { id: 'sell', label: 'TRADING PIER', x: -5.2, z: 4.2, radius: 1.95 },
  { id: 'shop', label: 'WORKSHOP GEAR', x: -3.6, z: 0.3, radius: 1.75 },
  { id: 'brazier', label: 'WARMTH FIRE', x: -1.3, z: -2.1, radius: 1.6 }
]

export interface Obstacle {
  readonly x: number
  readonly z: number
  readonly radius: number
}

export const OBSTACLES: readonly Obstacle[] = [
  { x: LIGHTHOUSE_POS.x, z: LIGHTHOUSE_POS.z, radius: 1.65 },
  { x: COTTAGE_POS.x, z: COTTAGE_POS.z, radius: 1.85 },
  { x: -1.3, z: -2.1, radius: 0.48 }, // brazier stand
  { x: 6.4, z: -4.2, radius: 0.9 },
  { x: -7.2, z: -4.4, radius: 0.9 },
  { x: 7.8, z: 1.4, radius: 0.85 }
]

/**
 * Deterministic island elevation heightmap in world units.
 * - Upper headland around (-1, -2.5): Y ≈ 1.35 (dry in all tides)
 * - Mid beach & causeway: Y ≈ 0.55..0.95 (dry in normal tide)
 * - Outer tidal flats / shoals (east & south): Y ≈ -0.02..0.28 (submerged at high tide!)
 * - Wooden trading pier deck near (-5.8, 4.8): Y = 0.68
 */
export function islandHeight(x: number, z: number): number {
  // Wooden pier deck on the southwest cove (always above normal tide)
  if (x >= -8.4 && x <= -3.6 && z >= 2.2 && z <= 6.8) {
    return 0.68
  }
  // Upper headland terrace (lighthouse + cottage)
  const hx = (x + 0.6) / 6.2
  const hz = (z + 2.6) / 4.2
  const headDist = Math.hypot(hx, hz)

  // Main beach island body
  const bx = (x - 0.5) / 10.6
  const bz = (z - 0.8) / 8.8
  const beachDist = Math.hypot(bx, bz)

  // Extended southeastern tidal shoal bar (exposed at low tide!)
  const sx = (x - 6.8) / 6.8
  const sz = (z - 5.2) / 5.4
  const shoalDist = Math.hypot(sx, sz)

  // Southern sandspit reef (exposed at low tide!)
  const rx = (x + 0.8) / 5.6
  const rz = (z - 7.8) / 4.2
  const reefDist = Math.hypot(rx, rz)

  // Smoothstep helper
  const smooth = (edge0: number, edge1: number, v: number) => {
    const t = Math.max(0, Math.min(1, (v - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }

  let h = -0.75
  // Shoal & reef shelf
  const shoal = 1 - smooth(0.55, 1.15, Math.min(shoalDist, reefDist))
  h = Math.max(h, -0.75 + shoal * 0.96)

  // Mid beach
  const beach = 1 - smooth(0.55, 1.08, beachDist)
  h = Math.max(h, -0.65 + beach * 1.32)

  // Upper headland plateau
  const head = 1 - smooth(0.68, 1.08, headDist)
  h = Math.max(h, -0.75 + head * 2.12)

  // Gentle organic coastal undulation away from pier
  const ripple = Math.sin(x * 0.48 + 0.7) * Math.cos(z * 0.52 - 0.4) * 0.055
  return h + ripple
}

export interface ResourceItem {
  id: number
  kind: ResourceKind
  x: number
  z: number
  y: number
  yaw: number
  age: number
  pulling: boolean
  pullT: number
}

export interface PassingShip {
  id: number
  x: number
  z: number
  dir: 1 | -1
  speed: number
  laneZ: number
  guided: boolean
  missed: boolean
  bounty: number
  size: number
  bobPhase: number
}

export interface WorldPopup {
  id: number
  x: number
  y: number
  z: number
  text: string
  color: string
  age: number
  duration: number
}

export interface SoundEvent {
  readonly kind:
    | 'pickup'
    | 'sell'
    | 'fuel'
    | 'upgrade'
    | 'foghorn'
    | 'thunder'
    | 'tideLow'
    | 'tideHigh'
    | 'step'
    | 'splash'
    | 'victory'
    | 'full'
  readonly pitch?: number
}

export type VfxEvent =
  | { readonly kind: 'pickup'; readonly itemKind: ResourceKind; readonly from: readonly [number, number, number] }
  | { readonly kind: 'sell'; readonly itemKind: ResourceKind; readonly from: readonly [number, number, number]; readonly to: readonly [number, number, number] }
  | { readonly kind: 'fuel'; readonly itemKind: ResourceKind; readonly from: readonly [number, number, number]; readonly to: readonly [number, number, number] }
  | { readonly kind: 'upgrade'; readonly at: readonly [number, number, number] }
  | { readonly kind: 'shipGuided'; readonly at: readonly [number, number, number] }
  | { readonly kind: 'winchPayout'; readonly at: readonly [number, number, number] }
  | { readonly kind: 'splash'; readonly at: readonly [number, number, number] }

export interface MoveInput {
  readonly x: number
  readonly z: number
}

export interface GameSave {
  readonly version: 1
  readonly coins: number
  readonly totalEarned: number
  readonly shipsGuided: number
  readonly day: number
  readonly fuel: number
  readonly upgrades: Record<UpgradeId, number>
  readonly victoryClaimed: boolean
}

export interface GameState {
  time: number
  day: number
  coins: number
  totalEarned: number
  shipsGuided: number
  victory: boolean
  victoryClaimed: boolean

  player: {
    x: number
    z: number
    y: number
    vx: number
    vz: number
    yaw: number
    stride: number
    inWater: boolean
    waterDepth: number
    warmth: number
    carry: ResourceKind[]
    stepTimer: number
    transferTimer: number
    fullNoticeTimer: number
  }

  fuel: number // 0..100
  beamYaw: number
  lampLit: boolean

  tideCycle: number // 0..1
  tideLevel: number // world Y of water surface
  tidePhase: TidePhase
  lastLowTideSpawn: number

  weather: WeatherKind
  weatherTimer: number
  weatherDuration: number
  weatherBlend: number
  windX: number
  windZ: number
  lightningFlash: number
  lightningCooldown: number

  upgrades: Record<UpgradeId, number>
  winchTimer: number
  winchAngle: number

  items: ResourceItem[]
  ships: PassingShip[]
  shipSpawnTimer: number
  popups: WorldPopup[]
  nextId: number

  activePad: ZonePad['id'] | null
  padEntered: ZonePad['id'] | null
  banner: { text: string; color: string; timer: number } | null
  sounds: SoundEvent[]
  vfx: VfxEvent[]
  rng: number
}
