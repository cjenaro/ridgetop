import { CHAPTERS, CHAPTER_BY_ID, WORLD_REGIONS } from './data.ts'
import type { ChapterSpec, LandmarkKind, WorldRegionId } from './types.ts'

export type DioramaVec3 = [number, number, number]

export const DIORAMA_W = 28
export const DIORAMA_D = 18
export const DIORAMA_SEA_Y = 0
export const DIORAMA_WATER_SURFACE_Y = 0.08

export const DIORAMA_ZOOM_MIN = 0.72
export const DIORAMA_ZOOM_MAX = 2.35
export const DIORAMA_ZOOM_DEFAULT = 0.96

export const DIORAMA_YAW_MIN = -0.45
export const DIORAMA_YAW_MAX = 0.45
export const DIORAMA_PITCH_MIN = 0.56
export const DIORAMA_PITCH_MAX = 1.18
export const DIORAMA_PITCH_DEFAULT = 0.88
export const DIORAMA_FOV_DEFAULT = 0.68
export const DIORAMA_FOV_FLY_IN = 0.54
export const DIORAMA_FLY_IN_DURATION = 0.42

export interface DioramaFlyIn {
  active: boolean
  stageId: string
  fromPos: DioramaVec3
  toPos: DioramaVec3
  fromTarget: DioramaVec3
  toTarget: DioramaVec3
  elapsed: number
  duration: number
}

export interface WorldMap3DCamera {
  tx: number
  tz: number
  goalTx: number
  goalTz: number
  zoom: number
  goalZoom: number
  yaw: number
  goalYaw: number
  pitch: number
  goalPitch: number
  flyIn: DioramaFlyIn | null
}

export interface DioramaCameraVectors {
  readonly eye: DioramaVec3
  readonly target: DioramaVec3
  readonly fov: number
}

export type DioramaLandmarkArch =
  | 'watchtower'
  | 'windmill'
  | 'bridge'
  | 'shrine'
  | 'monastery'
  | 'crypt'
  | 'cathedral'
  | 'vault'
  | 'ruins'
  | 'pass'
  | 'citadel'
  | 'castle'
  | 'peak'
  | 'gate'
  | 'foundry'
  | 'colosseum'
  | 'throne'
  | 'town'
  | 'forest'
  | 'lake'
  | 'oasis'
  | 'obelisk'
  | 'pyramid'
  | 'floating_spire'
  | 'floating_bastion'
  | 'atoll'
  | 'abyss'
  | 'rift_gate'
  | 'sanctum'

export interface DioramaStageLandmark {
  readonly stageId: string
  readonly title: string
  readonly region: WorldRegionId
  readonly landmark: LandmarkKind
  readonly arch: DioramaLandmarkArch
  readonly mapX: number
  readonly mapY: number
  readonly position: DioramaVec3
  readonly yaw: number
  readonly scale: number
  readonly isBoss: boolean
  readonly primaryHex: string
  readonly accentHex: string
}

export type DioramaPropKind =
  | 'mountain_snow'
  | 'mountain_volcano'
  | 'mountain_hill'
  | 'tree_pine'
  | 'tree_oak'
  | 'tree_dead'
  | 'tree_palm'
  | 'bridge_stone'
  | 'river_segment'
  | 'lava_segment'
  | 'cloud_puff'
  | 'floating_crystal'
  | 'desert_dune'
  | 'obsidian_shard'

export interface DioramaPropPlacement {
  readonly kind: DioramaPropKind
  readonly region: WorldRegionId | 'ocean'
  readonly position: DioramaVec3
  readonly scale: DioramaVec3
  readonly yaw: number
  readonly colorHex: string
  readonly accentHex?: string
}

export interface DioramaTerrainTile {
  readonly col: number
  readonly row: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly region: WorldRegionId
  readonly topHex: string
  readonly sideHex: string
  readonly isFloating: boolean
}

export interface DioramaRegionLabelAnchor {
  readonly region: WorldRegionId
  readonly name: string
  readonly tierRange: string
  readonly mapX: number
  readonly mapY: number
  readonly position: DioramaVec3
  readonly accentHex: string
  readonly futureFrontier: boolean
}

export interface DioramaLandmarksData {
  readonly stages: readonly DioramaStageLandmark[]
  readonly props: readonly DioramaPropPlacement[]
  readonly terrainTiles: readonly DioramaTerrainTile[]
  readonly regions: readonly DioramaRegionLabelAnchor[]
}

export interface DioramaRoadStone {
  readonly position: DioramaVec3
  readonly yaw: number
  readonly scale: DioramaVec3
  readonly isSea: boolean
}

export interface DioramaRoadSegment {
  readonly fromStageId: string
  readonly toStageId: string
  readonly isSeaRoute: boolean
  readonly stones: readonly DioramaRoadStone[]
}

// =========================================================================
// SOLIS CONTINENT GEOGRAPHY POLYGONS (Normalized 0..1)
// =========================================================================

type NormPoly = readonly (readonly [number, number])[]

const SOLIS_MAINLAND: NormPoly = [
  [0.048, 0.34], [0.072, 0.24], [0.115, 0.18], [0.165, 0.13], [0.225, 0.11],
  [0.295, 0.12], [0.355, 0.16], [0.415, 0.13], [0.455, 0.08], [0.525, 0.07],
  [0.605, 0.08], [0.685, 0.08], [0.735, 0.13], [0.715, 0.21], [0.685, 0.28],
  [0.735, 0.35], [0.745, 0.43], [0.715, 0.50], [0.760, 0.57], [0.745, 0.66],
  [0.685, 0.70], [0.615, 0.72], [0.545, 0.75], [0.475, 0.79], [0.415, 0.81],
  [0.345, 0.77], [0.275, 0.75], [0.205, 0.77], [0.145, 0.74], [0.125, 0.66],
  [0.145, 0.59], [0.095, 0.54], [0.058, 0.46]
]

const SUNBLEACHED_DUNES_LAND: NormPoly = [
  [0.065, 0.83], [0.135, 0.80], [0.215, 0.82], [0.295, 0.83], [0.385, 0.85],
  [0.435, 0.89], [0.415, 0.95], [0.325, 0.96], [0.225, 0.96], [0.125, 0.94],
  [0.062, 0.90]
]

const AETHER_ISLES_MAIN: NormPoly = [
  [0.775, 0.23], [0.835, 0.14], [0.905, 0.10], [0.955, 0.15], [0.945, 0.23],
  [0.970, 0.30], [0.955, 0.39], [0.885, 0.40], [0.825, 0.36], [0.768, 0.31]
]

const ABYSSAL_ISLE: NormPoly = [
  [0.585, 0.82], [0.645, 0.79], [0.705, 0.82], [0.715, 0.90], [0.655, 0.94], [0.595, 0.91]
]

const SHATTERED_EXPANSE_LAND: NormPoly = [
  [0.765, 0.69], [0.835, 0.67], [0.895, 0.72], [0.955, 0.78], [0.965, 0.89],
  [0.915, 0.95], [0.835, 0.93], [0.785, 0.86], [0.755, 0.78]
]

const WEST_ISLET: NormPoly = [
  [0.032, 0.62], [0.068, 0.60], [0.084, 0.66], [0.062, 0.71], [0.028, 0.68]
]

const DIORAMA_ISLANDS: readonly NormPoly[] = [
  SOLIS_MAINLAND,
  SUNBLEACHED_DUNES_LAND,
  AETHER_ISLES_MAIN,
  ABYSSAL_ISLE,
  SHATTERED_EXPANSE_LAND,
  WEST_ISLET
]

interface RegionPolySpec {
  readonly id: WorldRegionId
  readonly pts: NormPoly
  readonly labelX: number
  readonly labelY: number
}

const REGION_POLY_SPECS: readonly RegionPolySpec[] = [
  { id: 'eclipse_dominion', pts: [[0.62, 0.30], [0.76, 0.30], [0.76, 0.51], [0.62, 0.49]], labelX: 0.69, labelY: 0.335 },
  { id: 'frostspire', pts: [[0.42, 0.05], [0.75, 0.05], [0.73, 0.34], [0.43, 0.37]], labelX: 0.57, labelY: 0.11 },
  { id: 'emberwaste', pts: [[0.49, 0.42], [0.77, 0.46], [0.77, 0.76], [0.48, 0.76]], labelX: 0.62, labelY: 0.56 },
  { id: 'ashen_catacombs', pts: [[0.12, 0.59], [0.49, 0.49], [0.51, 0.83], [0.12, 0.81]], labelX: 0.35, labelY: 0.65 },
  { id: 'silverfen', pts: [[0.23, 0.11], [0.43, 0.11], [0.42, 0.48], [0.20, 0.66], [0.21, 0.45]], labelX: 0.32, labelY: 0.36 },
  { id: 'solis_vale', pts: [[0.03, 0.11], [0.25, 0.09], [0.27, 0.34], [0.21, 0.60], [0.03, 0.60]], labelX: 0.13, labelY: 0.31 },
  { id: 'sunbleached_dunes', pts: [[0.05, 0.79], [0.45, 0.82], [0.45, 0.97], [0.05, 0.97]], labelX: 0.25, labelY: 0.855 },
  { id: 'aether_isles', pts: [[0.76, 0.09], [0.98, 0.09], [0.98, 0.42], [0.76, 0.40]], labelX: 0.87, labelY: 0.23 },
  { id: 'shattered_expanse', pts: [[0.57, 0.66], [0.98, 0.66], [0.98, 0.97], [0.57, 0.97]], labelX: 0.82, labelY: 0.83 }
]

const SILVERFEN_RIVER_NORM: NormPoly = [
  [0.536, 0.192], [0.48, 0.174], [0.42, 0.180], [0.365, 0.202], [0.316, 0.244],
  [0.282, 0.322], [0.262, 0.415], [0.248, 0.530], [0.240, 0.635], [0.224, 0.745]
]

const MILLERS_CREEK_NORM: NormPoly = [
  [0.105, 0.482], [0.138, 0.512], [0.172, 0.544], [0.210, 0.576], [0.244, 0.598]
]

const EMBERWASTE_LAVA_NORM: NormPoly = [
  [0.602, 0.625], [0.606, 0.668], [0.598, 0.706], [0.604, 0.745]
]

// =========================================================================
// MATH & HEIGHTFIELD HELPERS
// =========================================================================

function clampNum(v: number, lo: number, hi: number): number {
  if (v < lo) return lo
  if (v > hi) return hi
  return v
}

function pointInNormPoly(px: number, py: number, pts: NormPoly): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0]
    const yi = pts[i][1]
    const xj = pts[j][0]
    const yj = pts[j][1]
    const crosses = (yi > py) !== (yj > py)
    if (crosses && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function islandIndexAtNorm(nx: number, ny: number): number {
  for (let i = 0; i < DIORAMA_ISLANDS.length; i++) {
    if (pointInNormPoly(nx, ny, DIORAMA_ISLANDS[i])) return i
  }
  return -1
}

function distPointToSegSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq <= 1e-8) {
    const ex = px - ax
    const ey = py - ay
    return ex * ex + ey * ey
  }
  const t = clampNum(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1)
  const cx = ax + t * dx
  const cy = ay + t * dy
  const ex = px - cx
  const ey = py - cy
  return ex * ex + ey * ey
}

function distToPolylineNorm(px: number, py: number, pts: NormPoly): number {
  let bestSq = 999
  for (let i = 0; i < pts.length - 1; i++) {
    const dSq = distPointToSegSq(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
    if (dSq < bestSq) bestSq = dSq
  }
  return Math.sqrt(bestSq)
}

function detHash(a: number, b: number, seed: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7 + seed * 74.7) * 43758.5453
  return s - Math.floor(s)
}

function smoothNoise2D(x: number, z: number): number {
  return (
    Math.sin(x * 0.48 + z * 0.34) * 0.45 +
    Math.cos(x * 0.82 - z * 0.66) * 0.35 +
    Math.sin((x - z) * 1.15) * 0.20
  )
}

function radialBump(nx: number, ny: number, cx: number, cy: number, radius: number, amp: number): number {
  const dx = nx - cx
  const dy = ny - cy
  const d2 = dx * dx + dy * dy
  const r2 = radius * radius
  if (d2 >= r2) return 0
  const u = 1 - d2 / r2
  return amp * u * u
}

/** Convert normalized World Map coordinates (`mapX`, `mapY` in [0..1]) to tabletop XZ coordinates. */
export function dioramaNormToXZ(mapX: number, mapY: number): [number, number] {
  const nx = Number.isFinite(mapX) ? mapX : 0.5
  const ny = Number.isFinite(mapY) ? mapY : 0.5
  return [(nx - 0.5) * DIORAMA_W, (ny - 0.5) * DIORAMA_D]
}

/** Convert tabletop XZ coordinates back into normalized World Map coordinates [0..1]. */
export function dioramaXZToNorm(x: number, z: number): [number, number] {
  const sx = Number.isFinite(x) ? x : 0
  const sz = Number.isFinite(z) ? z : 0
  return [sx / DIORAMA_W + 0.5, sz / DIORAMA_D + 0.5]
}

/** Determine which Solis region (or `'ocean'`) owns a normalized map point. */
export function dioramaRegionAtNorm(mapX: number, mapY: number): WorldRegionId | 'ocean' {
  const islandIdx = islandIndexAtNorm(mapX, mapY)
  if (islandIdx < 0) return 'ocean'
  if (islandIdx === 1) return 'sunbleached_dunes'
  if (islandIdx === 2) return 'aether_isles'
  if (islandIdx === 3 || islandIdx === 4) return 'shattered_expanse'
  if (islandIdx === 5) return 'solis_vale'
  for (let i = 0; i < REGION_POLY_SPECS.length; i++) {
    const spec = REGION_POLY_SPECS[i]
    if (pointInNormPoly(mapX, mapY, spec.pts)) return spec.id
  }
  return 'solis_vale'
}

/**
 * Deterministic sculpted diorama heightfield across all 9 Solis regions:
 * - `solis_vale`: sunlit rolling meadow plateau (~0.52..0.74)
 * - `silverfen`: river valley & misty lowlands carved below Solis meadow (~0.16..0.34, channel ~0.10)
 * - `ashen_catacombs`: rocky highland ruins & barrows (~0.56..0.88)
 * - `frostspire`: towering alpine snow peaks (~1.05..2.02)
 * - `emberwaste`: volcanic ridge & caldera (~0.82..1.42)
 * - `eclipse_dominion`: dark obsidian spire plateau (~0.98..1.38)
 * - `sunbleached_dunes`: terraced desert mesas & pyramid mound (~0.52..0.96)
 * - `aether_isles`: elevated floating sky-islands above sea clouds (~1.95..2.48)
 * - `shattered_expanse`: fractured obsidian rift crags (~0.72..1.42)
 */
export function dioramaElevationAt(x: number, z: number): number {
  const [nx, ny] = dioramaXZToNorm(x, z)
  const region = dioramaRegionAtNorm(nx, ny)
  if (region === 'ocean') return DIORAMA_SEA_Y

  const wave = smoothNoise2D(x, z)
  let h = 0.52

  if (region === 'solis_vale') {
    h = 0.56 + wave * 0.09
    h += radialBump(nx, ny, 0.10, 0.39, 0.08, 0.14) // Border Watch knoll
    h += radialBump(nx, ny, 0.22, 0.17, 0.09, 0.16) // Galewind hill
    // Carve Millers' Creek gently through the southern meadow
    const creekDist = distToPolylineNorm(nx, ny, MILLERS_CREEK_NORM)
    if (creekDist < 0.042) {
      const k = 1 - creekDist / 0.042
      h -= k * k * 0.30
    }
  } else if (region === 'silverfen') {
    // River valley & misty lowlands sculpted below Solis Vale meadow height
    h = 0.30 + wave * 0.05
    h += radialBump(nx, ny, 0.40, 0.23, 0.08, 0.10) // Sunwell Glade knoll
    h -= radialBump(nx, ny, 0.25, 0.62, 0.09, 0.11) // Emerald Delta marsh basin
    const riverDist = distToPolylineNorm(nx, ny, SILVERFEN_RIVER_NORM)
    if (riverDist < 0.055) {
      const k = 1 - riverDist / 0.055
      h -= k * k * 0.19
    }
    const creekDist = distToPolylineNorm(nx, ny, MILLERS_CREEK_NORM)
    if (creekDist < 0.045) {
      const k = 1 - creekDist / 0.045
      h -= k * k * 0.14
    }
    h = Math.max(0.11, h)
  } else if (region === 'ashen_catacombs') {
    // Rocky terraced highland ruins
    h = 0.64 + wave * 0.11
    h += radialBump(nx, ny, 0.42, 0.77, 0.09, 0.20) // Bone Cathedral promontory
    h += radialBump(nx, ny, 0.31, 0.70, 0.08, 0.14) // Whispering Barrow ridge
    h += radialBump(nx, ny, 0.45, 0.64, 0.07, 0.14) // Cursed Vault terrace
  } else if (region === 'frostspire') {
    // Towering northern alpine snow massif
    h = 1.18 + wave * 0.14
    h += radialBump(nx, ny, 0.46, 0.14, 0.10, 0.56) // Runeforge Peak
    h += radialBump(nx, ny, 0.69, 0.13, 0.11, 0.68) // Wyrm Eyrie summit
    h += radialBump(nx, ny, 0.64, 0.24, 0.09, 0.38) // Glacial Citadel bastion
    h -= radialBump(nx, ny, 0.55, 0.19, 0.07, 0.34) // Frozen Lake basin
    h -= radialBump(nx, ny, 0.48, 0.31, 0.07, 0.20) // Frostspire Pass saddle
  } else if (region === 'emberwaste') {
    // Volcanic basalt ridge & sunken magma caldera
    h = 0.92 + wave * 0.12
    h += radialBump(nx, ny, 0.72, 0.59, 0.10, 0.46) // Molten Core caldera rim
    h += radialBump(nx, ny, 0.58, 0.49, 0.08, 0.22) // Obsidian Gate ridge
    h += radialBump(nx, ny, 0.65, 0.63, 0.08, 0.20) // Ashfall Foundry crag
    const lavaDist = distToPolylineNorm(nx, ny, EMBERWASTE_LAVA_NORM)
    if (lavaDist < 0.038) {
      const k = 1 - lavaDist / 0.038
      h -= k * k * 0.36
    }
  } else if (region === 'eclipse_dominion') {
    // Elevated dark obsidian headland & crown spire plateau
    h = 1.06 + wave * 0.10
    h += radialBump(nx, ny, 0.70, 0.40, 0.09, 0.34) // Eclipse Throne dais
  } else if (region === 'sunbleached_dunes') {
    // Terraced desert mesas & golden pyramid mound
    h = 0.58 + wave * 0.08
    h += radialBump(nx, ny, 0.37, 0.91, 0.09, 0.34) // Dune Sovereign pyramid mound
    h += radialBump(nx, ny, 0.25, 0.90, 0.08, 0.18) // Sunken Obelisk mesa
    h -= radialBump(nx, ny, 0.14, 0.86, 0.06, 0.16) // Mirage Oasis palm basin
  } else if (region === 'aether_isles') {
    // Elevated floating sky-islands suspended high above the sea clouds!
    h = 2.02 + wave * 0.12
    h += radialBump(nx, ny, 0.88, 0.16, 0.09, 0.38) // Tempest Spire peak
    h += radialBump(nx, ny, 0.93, 0.32, 0.09, 0.32) // Skybreak Bastion citadel
    h -= radialBump(nx, ny, 0.81, 0.28, 0.07, 0.16) // Starfall Atoll landing shelf
  } else if (region === 'shattered_expanse') {
    // Fractured obsidian rift crags & Abyssal crater
    h = 0.90 + wave * 0.14
    h += radialBump(nx, ny, 0.91, 0.86, 0.10, 0.48) // First Sun Sanctum peak
    h += radialBump(nx, ny, 0.81, 0.74, 0.08, 0.24) // Obsidian Rift ridge
    h -= radialBump(nx, ny, 0.65, 0.86, 0.07, 0.28) // Abyssal Deep chasm rim
  }

  return Math.round(clampNum(h, 0.10, 2.65) * 1000) / 1000
}

/** Map normalized World Map coordinates (`mapX`, `mapY` in [0..1]) onto sculpted 3D tabletop coordinates `[x, y, z]`. */
export function worldMapNormToDiorama(mapX: number, mapY: number): DioramaVec3 {
  const [x, z] = dioramaNormToXZ(mapX, mapY)
  const y = dioramaElevationAt(x, z)
  return [x, y, z]
}

// =========================================================================
// DETERMINISTIC DIORAMA CAMERA & SMOOTH FLY-IN CONTROLLER
// =========================================================================

function clampDioramaTarget(cam: WorldMap3DCamera): void {
  cam.goalZoom = clampNum(cam.goalZoom, DIORAMA_ZOOM_MIN, DIORAMA_ZOOM_MAX)
  cam.zoom = clampNum(cam.zoom, DIORAMA_ZOOM_MIN, DIORAMA_ZOOM_MAX)
  cam.goalYaw = clampNum(cam.goalYaw, DIORAMA_YAW_MIN, DIORAMA_YAW_MAX)
  cam.yaw = clampNum(cam.yaw, DIORAMA_YAW_MIN, DIORAMA_YAW_MAX)
  cam.goalPitch = clampNum(cam.goalPitch, DIORAMA_PITCH_MIN, DIORAMA_PITCH_MAX)
  cam.pitch = clampNum(cam.pitch, DIORAMA_PITCH_MIN, DIORAMA_PITCH_MAX)

  // Allow panning freely across the tabletop without ever losing the continent
  const maxPanX = DIORAMA_W * 0.44
  const maxPanZ = DIORAMA_D * 0.44
  cam.goalTx = clampNum(cam.goalTx, -maxPanX, maxPanX)
  cam.goalTz = clampNum(cam.goalTz, -maxPanZ, maxPanZ)
  cam.tx = clampNum(cam.tx, -maxPanX, maxPanX)
  cam.tz = clampNum(cam.tz, -maxPanZ, maxPanZ)
}

export function createWorldMap3DCamera(): WorldMap3DCamera {
  return {
    tx: 0,
    tz: 0.25,
    goalTx: 0,
    goalTz: 0.25,
    zoom: DIORAMA_ZOOM_DEFAULT,
    goalZoom: DIORAMA_ZOOM_DEFAULT,
    yaw: 0,
    goalYaw: 0,
    pitch: DIORAMA_PITCH_DEFAULT,
    goalPitch: DIORAMA_PITCH_DEFAULT,
    flyIn: null
  }
}

export function resetDioramaCamera(cam: WorldMap3DCamera, instant = false): void {
  cam.flyIn = null
  cam.goalTx = 0
  cam.goalTz = 0.25
  cam.goalZoom = DIORAMA_ZOOM_DEFAULT
  cam.goalYaw = 0
  cam.goalPitch = DIORAMA_PITCH_DEFAULT
  clampDioramaTarget(cam)
  if (instant) {
    cam.tx = cam.goalTx
    cam.tz = cam.goalTz
    cam.zoom = cam.goalZoom
    cam.yaw = cam.goalYaw
    cam.pitch = cam.goalPitch
  }
}

export function focusDioramaOnStage(
  cam: WorldMap3DCamera,
  mapX: number,
  mapY: number,
  zoom?: number,
  instant = false
): void {
  const [x, z] = dioramaNormToXZ(mapX, mapY)
  cam.goalTx = x
  cam.goalTz = z
  if (zoom !== undefined && Number.isFinite(zoom)) {
    cam.goalZoom = zoom
  }
  clampDioramaTarget(cam)
  if (instant) {
    cam.tx = cam.goalTx
    cam.tz = cam.goalTz
    cam.zoom = cam.goalZoom
  }
}

export function panDioramaCamera(
  cam: WorldMap3DCamera,
  dxPx: number,
  dyPx: number,
  viewportW: number,
  viewportH: number
): void {
  if (cam.flyIn && cam.flyIn.active) return
  const safeW = Math.max(200, viewportW)
  const safeH = Math.max(200, viewportH)
  const worldScaleX = (DIORAMA_W * 1.05) / (safeW * cam.zoom)
  const worldScaleZ = (DIORAMA_D * 1.25) / (safeH * cam.zoom)
  const rx = -dxPx * worldScaleX
  const rz = -dyPx * worldScaleZ
  const c = Math.cos(cam.yaw)
  const s = Math.sin(cam.yaw)
  cam.goalTx += rx * c - rz * s
  cam.goalTz += rx * s + rz * c
  cam.tx = cam.goalTx
  cam.tz = cam.goalTz
  clampDioramaTarget(cam)
}

export function zoomDioramaCamera(cam: WorldMap3DCamera, factor: number): void {
  if (cam.flyIn && cam.flyIn.active) return
  if (!Number.isFinite(factor) || factor <= 0) return
  cam.goalZoom = clampNum(cam.goalZoom * factor, DIORAMA_ZOOM_MIN, DIORAMA_ZOOM_MAX)
  clampDioramaTarget(cam)
}

export function rotateDioramaCamera(cam: WorldMap3DCamera, deltaYaw: number, deltaPitch = 0): void {
  if (cam.flyIn && cam.flyIn.active) return
  if (Number.isFinite(deltaYaw)) {
    cam.goalYaw = clampNum(cam.goalYaw + deltaYaw, DIORAMA_YAW_MIN, DIORAMA_YAW_MAX)
  }
  if (Number.isFinite(deltaPitch) && deltaPitch !== 0) {
    cam.goalPitch = clampNum(cam.goalPitch + deltaPitch, DIORAMA_PITCH_MIN, DIORAMA_PITCH_MAX)
  }
  clampDioramaTarget(cam)
}

function computeBaseCameraVectors(cam: WorldMap3DCamera, aspect: number): DioramaCameraVectors {
  const safeAspect = clampNum(Number.isFinite(aspect) ? aspect : 16 / 9, 0.36, 3.0)
  // Auto-pull back on narrow/portrait viewports so all 33 stage pins stay framed on overview
  const aspectPull = safeAspect < 1.56 ? 1.56 / Math.max(0.42, safeAspect) : 1.0
  const dist = (26.5 / clampNum(cam.zoom, DIORAMA_ZOOM_MIN, DIORAMA_ZOOM_MAX)) * aspectPull
  const pitch = clampNum(cam.pitch, DIORAMA_PITCH_MIN, DIORAMA_PITCH_MAX)
  const yaw = clampNum(cam.yaw, DIORAMA_YAW_MIN, DIORAMA_YAW_MAX)
  const horiz = Math.cos(pitch) * dist
  const eyeY = Math.sin(pitch) * dist + 0.85
  const eyeX = cam.tx + Math.sin(yaw) * horiz
  const eyeZ = cam.tz + Math.cos(yaw) * horiz
  return {
    eye: [eyeX, eyeY, eyeZ],
    target: [cam.tx, 0.45, cam.tz],
    fov: DIORAMA_FOV_DEFAULT
  }
}

export function startDioramaFlyIn(
  cam: WorldMap3DCamera,
  stageId: string,
  mapX: number,
  mapY: number,
  duration = DIORAMA_FLY_IN_DURATION,
  aspect = 16 / 9
): void {
  const current = computeBaseCameraVectors(cam, aspect)
  const dest = worldMapNormToDiorama(mapX, mapY)
  const safeDur = Math.max(0.05, Number.isFinite(duration) ? duration : DIORAMA_FLY_IN_DURATION)
  const endEye: DioramaVec3 = [
    dest[0] + Math.sin(cam.yaw) * 3.1,
    dest[1] + 3.4,
    dest[2] + Math.cos(cam.yaw) * 3.8
  ]
  const endTarget: DioramaVec3 = [dest[0], dest[1] + 0.35, dest[2]]
  cam.goalTx = dest[0]
  cam.goalTz = dest[2]
  cam.flyIn = {
    active: true,
    stageId,
    fromPos: [current.eye[0], current.eye[1], current.eye[2]],
    toPos: endEye,
    fromTarget: [current.target[0], current.target[1], current.target[2]],
    toTarget: endTarget,
    elapsed: 0,
    duration: safeDur
  }
}

export function completeDioramaFlyIn(cam: WorldMap3DCamera): void {
  if (!cam.flyIn) return
  cam.flyIn.elapsed = cam.flyIn.duration
  cam.flyIn.active = false
}

export function getDioramaFlyInProgress(cam: WorldMap3DCamera): number {
  if (!cam.flyIn || !cam.flyIn.active) return 0
  return clampNum(cam.flyIn.elapsed / Math.max(0.001, cam.flyIn.duration), 0, 1)
}

/**
 * Advance camera spring smoothing and active fly-in transition by `dt` seconds.
 * Returns `true` on the tick when an active fly-in finishes.
 */
export function stepDioramaCamera(cam: WorldMap3DCamera, dt: number): boolean {
  if (!Number.isFinite(dt) || dt <= 0) return false
  if (cam.flyIn && cam.flyIn.active) {
    cam.flyIn.elapsed += dt
    if (cam.flyIn.elapsed >= cam.flyIn.duration) {
      cam.flyIn.elapsed = cam.flyIn.duration
      cam.flyIn.active = false
      return true
    }
    return false
  }
  const alpha = 1 - Math.exp(-10 * dt)
  cam.tx += (cam.goalTx - cam.tx) * alpha
  cam.tz += (cam.goalTz - cam.tz) * alpha
  cam.zoom += (cam.goalZoom - cam.zoom) * alpha
  cam.yaw += (cam.goalYaw - cam.yaw) * alpha
  cam.pitch += (cam.goalPitch - cam.pitch) * alpha
  if (Math.abs(cam.goalTx - cam.tx) < 1e-4) cam.tx = cam.goalTx
  if (Math.abs(cam.goalTz - cam.tz) < 1e-4) cam.tz = cam.goalTz
  if (Math.abs(cam.goalZoom - cam.zoom) < 1e-4) cam.zoom = cam.goalZoom
  if (Math.abs(cam.goalYaw - cam.yaw) < 1e-4) cam.yaw = cam.goalYaw
  if (Math.abs(cam.goalPitch - cam.pitch) < 1e-4) cam.pitch = cam.goalPitch
  return false
}

function easeInOutCubic(t: number): number {
  const u = clampNum(t, 0, 1)
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2
}

export function computeDioramaCameraVectors(cam: WorldMap3DCamera, aspect = 16 / 9): DioramaCameraVectors {
  if (cam.flyIn && cam.flyIn.active) {
    const u = easeInOutCubic(cam.flyIn.elapsed / Math.max(0.001, cam.flyIn.duration))
    const fp = cam.flyIn.fromPos
    const tp = cam.flyIn.toPos
    const ft = cam.flyIn.fromTarget
    const tt = cam.flyIn.toTarget
    // Gentle swoop arc dipping gracefully toward the miniature landmark
    const arcLift = Math.sin(u * Math.PI) * 1.4
    return {
      eye: [
        fp[0] + (tp[0] - fp[0]) * u,
        fp[1] + (tp[1] - fp[1]) * u + arcLift,
        fp[2] + (tp[2] - fp[2]) * u
      ],
      target: [
        ft[0] + (tt[0] - ft[0]) * u,
        ft[1] + (tt[1] - ft[1]) * u,
        ft[2] + (tt[2] - ft[2]) * u
      ],
      fov: DIORAMA_FOV_DEFAULT + (DIORAMA_FOV_FLY_IN - DIORAMA_FOV_DEFAULT) * u
    }
  }
  return computeBaseCameraVectors(cam, aspect)
}

// =========================================================================
// DETERMINISTIC DIORAMA STATIC LANDMARKS, PROPS, TERRAIN & ROADS
// =========================================================================

interface RegionPalette {
  readonly topLo: string
  readonly topHi: string
  readonly side: string
  readonly building: string
  readonly accent: string
}

const REGION_PALETTE: Record<WorldRegionId, RegionPalette> = {
  solis_vale: { topLo: '#6aa454', topHi: '#8bc368', side: '#594a3d', building: '#d9d0be', accent: '#c95342' },
  silverfen: { topLo: '#4a8f7c', topHi: '#6cb096', side: '#3d504a', building: '#b9c8c2', accent: '#44b8a8' },
  ashen_catacombs: { topLo: '#6a627d', topHi: '#857c9c', side: '#3d374c', building: '#928aa6', accent: '#986ee8' },
  frostspire: { topLo: '#bfd9ea', topHi: '#e6f4fc', side: '#6c859e', building: '#d4e8f5', accent: '#5cc4f5' },
  emberwaste: { topLo: '#68453d', topHi: '#8c5342', side: '#3b2421', building: '#4c3e45', accent: '#ff7438' },
  eclipse_dominion: { topLo: '#4c365c', topHi: '#6b4782', side: '#281c36', building: '#352a45', accent: '#d95eff' },
  sunbleached_dunes: { topLo: '#d6ac65', topHi: '#edc77e', side: '#997240', building: '#e8cfa0', accent: '#f5b840' },
  aether_isles: { topLo: '#8dbce8', topHi: '#c8e6ff', side: '#5b7aa8', building: '#eef4ff', accent: '#6ce8ff' },
  shattered_expanse: { topLo: '#472c48', topHi: '#6b3e68', side: '#241428', building: '#32223b', accent: '#ff69b4' }
}

function resolveStageArch(ch: ChapterSpec): DioramaLandmarkArch {
  if (ch.id === 'galewind_windmill') return 'windmill'
  if (ch.id === 'sunken_monastery') return 'monastery'
  if (ch.id === 'bone_cathedral') return 'cathedral'
  if (ch.id === 'cinder_colosseum') return 'colosseum'
  if (ch.id === 'mirage_oasis') return 'oasis'
  if (ch.id === 'sunken_obelisk') return 'obelisk'
  if (ch.id === 'dune_sovereign') return 'pyramid'
  if (ch.id === 'tempest_spire') return 'floating_spire'
  if (ch.id === 'skybreak_bastion') return 'floating_bastion'
  if (ch.id === 'starfall_atoll') return 'atoll'
  if (ch.id === 'obsidian_rift') return 'rift_gate'
  if (ch.id === 'first_sun_sanctum') return 'sanctum'
  if (ch.id === 'glacial_citadel') return 'castle'

  const lm = ch.landmark
  if (lm === 'watchtower') return 'watchtower'
  if (lm === 'bridge') return 'bridge'
  if (lm === 'shrine') return 'shrine'
  if (lm === 'crypt') return 'crypt'
  if (lm === 'vault') return 'vault'
  if (lm === 'pass') return 'pass'
  if (lm === 'citadel') return 'citadel'
  if (lm === 'gate') return 'gate'
  if (lm === 'throne') return 'throne'
  if (lm === 'forest') return 'forest'
  if (lm === 'lake') return 'lake'
  if (lm === 'foundry') return 'foundry'
  if (lm === 'town') return 'town'
  if (lm === 'ruins') return 'ruins'
  if (lm === 'peak') return 'peak'
  if (lm === 'arena') return 'colosseum'
  if (lm === 'atoll') return 'atoll'
  return 'abyss'
}

function buildTerrainTiles(): DioramaTerrainTile[] {
  const cols = 22
  const rows = 14
  const cellW = DIORAMA_W / cols
  const cellD = DIORAMA_D / rows
  const tiles: DioramaTerrainTile[] = []

  for (let r = 0; r < rows; r++) {
    const ny = (r + 0.5) / rows
    for (let c = 0; c < cols; c++) {
      const nx = (c + 0.5) / cols
      const region = dioramaRegionAtNorm(nx, ny)
      if (region === 'ocean') continue
      const [x, z] = dioramaNormToXZ(nx, ny)
      const elev = dioramaElevationAt(x, z)
      const pal = REGION_PALETTE[region]
      const hiBias = detHash(c, r, 11) > 0.45 || elev > 1.05
      const isFloating = region === 'aether_isles'
      const h = isFloating ? 0.52 : Math.max(0.24, elev + 0.20)
      tiles.push({
        col: c,
        row: r,
        x,
        y: elev,
        z,
        width: cellW * 1.04,
        height: h,
        depth: cellD * 1.04,
        region,
        topHex: hiBias ? pal.topHi : pal.topLo,
        sideHex: pal.side,
        isFloating
      })
    }
  }
  return tiles
}

function addChannelSegments(
  out: DioramaPropPlacement[],
  pts: NormPoly,
  kind: 'river_segment' | 'lava_segment',
  region: WorldRegionId,
  colorHex: string,
  widthBase: number
): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = dioramaNormToXZ(pts[i][0], pts[i][1])
    const [bx, bz] = dioramaNormToXZ(pts[i + 1][0], pts[i + 1][1])
    const mx = (ax + bx) * 0.5
    const mz = (az + bz) * 0.5
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    if (len < 0.05) continue
    const yaw = Math.atan2(dx, dz)
    const elev = dioramaElevationAt(mx, mz)
    const t = i / Math.max(1, pts.length - 1)
    const w = widthBase * (0.78 + t * 0.52)
    out.push({
      kind,
      region,
      position: [mx, Math.max(DIORAMA_WATER_SURFACE_Y + 0.04, elev + 0.03), mz],
      scale: [w, 0.08, len * 1.08],
      yaw,
      colorHex
    })
  }
}

function buildDioramaProps(): DioramaPropPlacement[] {
  const props: DioramaPropPlacement[] = []

  // Carved shimmering Silverfen river + Millers' Creek + Emberwaste lava river
  addChannelSegments(props, SILVERFEN_RIVER_NORM, 'river_segment', 'silverfen', '#3fa9d6', 0.44)
  addChannelSegments(props, MILLERS_CREEK_NORM, 'river_segment', 'solis_vale', '#4db8e0', 0.30)
  addChannelSegments(props, EMBERWASTE_LAVA_NORM, 'lava_segment', 'emberwaste', '#ff6424', 0.36)

  // Sculpted stone arch bridges across the Silverfen & Millers' Creek
  const bridgeCoords: readonly (readonly [number, number, number, WorldRegionId])[] = [
    [0.262, 0.415, 1.38, 'silverfen'], // Sunken Bridge
    [0.170, 0.542, 0.84, 'solis_vale'], // Millers' Ford
    [0.244, 0.618, 1.48, 'silverfen'], // Emerald Delta crossing
    [0.312, 0.268, 1.02, 'silverfen']  // Upper Silverfen arch
  ]
  for (let i = 0; i < bridgeCoords.length; i++) {
    const [bx, by, yaw, reg] = bridgeCoords[i]
    const pos = worldMapNormToDiorama(bx, by)
    props.push({
      kind: 'bridge_stone',
      region: reg,
      position: [pos[0], Math.max(0.24, pos[1] + 0.12), pos[2]],
      scale: [0.92, 0.52, 0.42],
      yaw,
      colorHex: '#b4bccb',
      accentHex: '#7d879b'
    })
  }

  // Towering mountain peaks, volcanoes & foothills
  const mountainSpecs: readonly (readonly [number, number, number, 'mountain_snow' | 'mountain_volcano' | 'mountain_hill'])[] = [
    // Frostspire alpine massif
    [0.43, 0.12, 1.05, 'mountain_snow'],
    [0.50, 0.10, 1.25, 'mountain_snow'],
    [0.58, 0.11, 1.32, 'mountain_snow'],
    [0.64, 0.14, 1.18, 'mountain_snow'],
    [0.71, 0.18, 1.08, 'mountain_snow'],
    [0.59, 0.25, 0.88, 'mountain_snow'],
    // Emberwaste volcanic ridges & caldera cones
    [0.54, 0.45, 0.96, 'mountain_volcano'],
    [0.64, 0.51, 1.12, 'mountain_volcano'],
    [0.71, 0.55, 1.18, 'mountain_volcano'],
    [0.60, 0.66, 0.94, 'mountain_volcano'],
    [0.69, 0.66, 0.98, 'mountain_volcano'],
    // Solis & Catacombs foothills
    [0.08, 0.30, 0.74, 'mountain_hill'],
    [0.19, 0.22, 0.68, 'mountain_hill'],
    [0.28, 0.17, 0.72, 'mountain_hill'],
    [0.43, 0.50, 0.76, 'mountain_hill'],
    [0.48, 0.57, 0.80, 'mountain_hill'],
    // Sunbleached Dunes sandstone mesas
    [0.19, 0.87, 0.74, 'mountain_hill'],
    [0.31, 0.92, 0.82, 'mountain_hill'],
    // Aether Isles floating crystal peaks
    [0.84, 0.18, 0.92, 'mountain_snow'],
    [0.92, 0.22, 0.96, 'mountain_snow'],
    // Shattered Expanse volcanic obsidian spires
    [0.84, 0.76, 1.05, 'mountain_volcano'],
    [0.91, 0.81, 1.14, 'mountain_volcano']
  ]
  for (let i = 0; i < mountainSpecs.length; i++) {
    const [mx, my, sc, kind] = mountainSpecs[i]
    const pos = worldMapNormToDiorama(mx, my)
    const reg = dioramaRegionAtNorm(mx, my)
    const colorHex = kind === 'mountain_snow'
      ? '#dcecf8'
      : kind === 'mountain_volcano'
        ? '#4d3a42'
        : reg === 'sunbleached_dunes'
          ? '#cc9c58'
          : '#7f8c74'
    const accentHex = kind === 'mountain_snow'
      ? '#85a6c4'
      : kind === 'mountain_volcano'
        ? '#ff6b2e'
        : '#5a6354'
    props.push({
      kind,
      region: reg,
      position: pos,
      scale: [0.95 * sc, 1.25 * sc, 0.95 * sc],
      yaw: detHash(i, 3, 19) * Math.PI * 2,
      colorHex,
      accentHex
    })
  }

  // Stylized miniature forest groves (oak, pine, haunted deadwood, oasis palms)
  const treeSpecs: readonly (readonly [number, number, 'tree_oak' | 'tree_pine' | 'tree_dead' | 'tree_palm'])[] = [
    [0.09, 0.44, 'tree_oak'], [0.13, 0.34, 'tree_oak'], [0.18, 0.28, 'tree_oak'], [0.14, 0.47, 'tree_oak'],
    [0.21, 0.45, 'tree_oak'], [0.18, 0.19, 'tree_oak'], [0.27, 0.33, 'tree_pine'], [0.33, 0.23, 'tree_pine'],
    [0.37, 0.29, 'tree_oak'], [0.30, 0.46, 'tree_pine'], [0.34, 0.37, 'tree_oak'], [0.23, 0.67, 'tree_pine'],
    [0.18, 0.69, 'tree_dead'], [0.25, 0.72, 'tree_dead'], [0.34, 0.63, 'tree_dead'], [0.39, 0.72, 'tree_dead'],
    [0.44, 0.71, 'tree_dead'], [0.46, 0.26, 'tree_pine'], [0.52, 0.26, 'tree_pine'], [0.60, 0.19, 'tree_pine'],
    [0.67, 0.20, 'tree_pine'], [0.12, 0.87, 'tree_palm'], [0.16, 0.85, 'tree_palm'], [0.21, 0.89, 'tree_palm']
  ]
  for (let i = 0; i < treeSpecs.length; i++) {
    const [tx, ty, kind] = treeSpecs[i]
    const pos = worldMapNormToDiorama(tx, ty)
    const reg = dioramaRegionAtNorm(tx, ty)
    const sc = 0.72 + detHash(i, 7, 31) * 0.36
    const colorHex = kind === 'tree_oak'
      ? (i % 3 === 0 ? '#5ab568' : '#3d9957')
      : kind === 'tree_pine'
        ? (reg === 'frostspire' ? '#6ca3a8' : '#2d7a59')
        : kind === 'tree_palm'
          ? '#5ab85c'
          : '#6c5a78'
    props.push({
      kind,
      region: reg,
      position: pos,
      scale: [0.46 * sc, 0.72 * sc, 0.46 * sc],
      yaw: detHash(i, 5, 43) * Math.PI * 2,
      colorHex,
      accentHex: '#7d5030'
    })
  }

  // Sea cloud puffs cradling the floating Aether Isles above the ocean
  const cloudSpots: readonly (readonly [number, number, number])[] = [
    [0.80, 0.26, 1.15],
    [0.86, 0.20, 1.35],
    [0.92, 0.26, 1.25],
    [0.88, 0.35, 1.10],
    [0.83, 0.33, 1.00]
  ]
  for (let i = 0; i < cloudSpots.length; i++) {
    const [cx, cy, sc] = cloudSpots[i]
    const [wx, wz] = dioramaNormToXZ(cx, cy)
    props.push({
      kind: 'cloud_puff',
      region: 'aether_isles',
      position: [wx, 0.85 + (i % 2) * 0.16, wz],
      scale: [1.35 * sc, 0.36, 0.95 * sc],
      yaw: i * 0.7,
      colorHex: '#d8ecff'
    })
  }

  // Desert dunes & Shattered Expanse obsidian rift shards
  const duneSpots: readonly (readonly [number, number])[] = [
    [0.11, 0.90], [0.29, 0.87], [0.35, 0.94]
  ]
  for (let i = 0; i < duneSpots.length; i++) {
    const pos = worldMapNormToDiorama(duneSpots[i][0], duneSpots[i][1])
    props.push({
      kind: 'desert_dune',
      region: 'sunbleached_dunes',
      position: pos,
      scale: [1.05, 0.34, 0.62],
      yaw: 0.25 + i * 0.4,
      colorHex: '#e6be70'
    })
  }

  const shardSpots: readonly (readonly [number, number])[] = [
    [0.62, 0.84], [0.68, 0.89], [0.78, 0.79], [0.87, 0.89]
  ]
  for (let i = 0; i < shardSpots.length; i++) {
    const pos = worldMapNormToDiorama(shardSpots[i][0], shardSpots[i][1])
    props.push({
      kind: 'obsidian_shard',
      region: 'shattered_expanse',
      position: pos,
      scale: [0.34, 0.95 + (i % 2) * 0.28, 0.34],
      yaw: i * 1.1,
      colorHex: '#352445',
      accentHex: '#ff69b4'
    })
  }

  return props
}

let cachedLandmarksData: DioramaLandmarksData | null = null

/**
 * Build deterministic static placement specs for the entire Solis 3D tabletop diorama:
 * all 33 sculpted stage landmarks, biome terrain blocks, rivers, bridges, mountains, trees,
 * floating Aether clouds, desert mesas, and 9 region label anchors.
 */
export function buildDioramaLandmarks(): DioramaLandmarksData {
  if (cachedLandmarksData) return cachedLandmarksData

  const stages: DioramaStageLandmark[] = []
  for (let i = 0; i < CHAPTERS.length; i++) {
    const ch = CHAPTERS[i]
    const pos = worldMapNormToDiorama(ch.mapX, ch.mapY)
    // Ensure every stage rests cleanly above sea level even near coastlines
    const safeY = Math.max(0.22, pos[1])
    const pal = REGION_PALETTE[ch.region]
    const isBoss = ch.kind === 'boss'
    stages.push({
      stageId: ch.id,
      title: ch.title,
      region: ch.region,
      landmark: ch.landmark,
      arch: resolveStageArch(ch),
      mapX: ch.mapX,
      mapY: ch.mapY,
      position: [pos[0], safeY, pos[2]],
      yaw: (detHash(i, ch.index, 7) - 0.5) * 0.65,
      scale: isBoss ? 1.18 : ch.kind === 'elite' ? 1.06 : 0.95,
      isBoss,
      primaryHex: pal.building,
      accentHex: pal.accent
    })
  }

  const regions: DioramaRegionLabelAnchor[] = []
  for (let i = 0; i < REGION_POLY_SPECS.length; i++) {
    const spec = REGION_POLY_SPECS[i]
    const meta = WORLD_REGIONS[spec.id]
    const pos = worldMapNormToDiorama(spec.labelX, spec.labelY)
    regions.push({
      region: spec.id,
      name: meta.name,
      tierRange: meta.tierRange,
      mapX: spec.labelX,
      mapY: spec.labelY,
      position: [pos[0], Math.max(0.45, pos[1] + 0.62), pos[2]],
      accentHex: meta.accentHex,
      futureFrontier: Boolean(meta.futureFrontier)
    })
  }

  cachedLandmarksData = {
    stages,
    props: buildDioramaProps(),
    terrainTiles: buildTerrainTiles(),
    regions
  }
  return cachedLandmarksData
}

let cachedRoadSegments: readonly DioramaRoadSegment[] | null = null

/**
 * Build curved/elevated road cobblestone stepping stones connecting every stage dependency
 * in `CHAPTERS` (`requires` graph).
 */
export function buildDioramaRoadSegments(): readonly DioramaRoadSegment[] {
  if (cachedRoadSegments) return cachedRoadSegments

  const segments: DioramaRoadSegment[] = []
  for (let i = 0; i < CHAPTERS.length; i++) {
    const to = CHAPTERS[i]
    for (let r = 0; r < to.requires.length; r++) {
      const from = CHAPTER_BY_ID[to.requires[r]]
      if (!from) continue

      const p0 = dioramaNormToXZ(from.mapX, from.mapY)
      const p1 = dioramaNormToXZ(to.mapX, to.mapY)
      const dx = p1[0] - p0[0]
      const dz = p1[1] - p0[1]
      const dist = Math.hypot(dx, dz)
      if (dist < 0.05) continue

      // Gentle deterministic lateral curve so parallel trails never collide
      const curveSign = detHash(from.index, to.index, 29) > 0.5 ? 1 : -1
      const curveAmp = Math.min(0.85, dist * 0.16) * curveSign
      const nx = -dz / dist
      const nz = dx / dist
      const cx = (p0[0] + p1[0]) * 0.5 + nx * curveAmp
      const cz = (p0[1] + p1[1]) * 0.5 + nz * curveAmp

      const fromIsland = islandIndexAtNorm(from.mapX, from.mapY)
      const toIsland = islandIndexAtNorm(to.mapX, to.mapY)
      const isSeaRoute = fromIsland !== toIsland

      // Compact disciplined stepping-stone count (2..4 stones per edge) to keep batch counts light
      const stoneCount = clampNum(Math.round(dist * 0.72), 2, 4)
      const stones: DioramaRoadStone[] = []
      for (let s = 1; s <= stoneCount; s++) {
        const t = s / (stoneCount + 1)
        const it = 1 - t
        const sx = it * it * p0[0] + 2 * it * t * cx + t * t * p1[0]
        const sz = it * it * p0[1] + 2 * it * t * cz + t * t * p1[1]
        const tx = 2 * it * (cx - p0[0]) + 2 * t * (p1[0] - cx)
        const tz = 2 * it * (cz - p0[1]) + 2 * t * (p1[1] - cz)
        const yaw = Math.atan2(tx, tz)
        const [normX, normY] = dioramaXZToNorm(sx, sz)
        const onOcean = dioramaRegionAtNorm(normX, normY) === 'ocean'
        const elev = onOcean ? DIORAMA_WATER_SURFACE_Y + 0.04 : dioramaElevationAt(sx, sz) + 0.05
        stones.push({
          position: [sx, elev, sz],
          yaw,
          scale: onOcean ? [0.22, 0.08, 0.34] : [0.28, 0.07, 0.38],
          isSea: onOcean || isSeaRoute
        })
      }

      segments.push({
        fromStageId: from.id,
        toStageId: to.id,
        isSeaRoute,
        stones
      })
    }
  }

  cachedRoadSegments = segments
  return cachedRoadSegments
}
