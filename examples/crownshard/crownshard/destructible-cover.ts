import {
  BARRICADE_DEFAULT_HP,
  CRACKED_PILLAR_DEFAULT_HP,
  cellHeightLevel,
  terrainElevation
} from './types.ts'
import type {
  BattleState,
  CoverHitPreview,
  DestructibleCoverKind,
  GridCell,
  GridCoord,
  TileTerrain
} from './types.ts'

export { BARRICADE_DEFAULT_HP, CRACKED_PILLAR_DEFAULT_HP }
export type { CoverHitPreview, DestructibleCoverKind }

/** Skills/attacks with powerMul >= 1.4 deal heavy structural bonus damage to destructible cover. */
export const COVER_HEAVY_POWER_MUL = 1.4
/** Attacks with scaled raw damage >= 22 deal heavy structural bonus damage to destructible cover. */
export const COVER_HEAVY_RAW_THRESHOLD = 22
/** Heavy hits (crits, powerMul >= 1.4, or raw >= 22) deal 1.5x structural damage to cover. */
export const COVER_HEAVY_DAMAGE_MUL = 1.5

export interface CoverDamageOptions {
  readonly empowered?: boolean
  readonly powerMul?: number
  readonly isCrit?: boolean
}

export interface CoverDamageCalc {
  readonly damage: number
  readonly isHeavyHit: boolean
}

export interface CoverDamageOutcome {
  readonly applied: boolean
  readonly kind: DestructibleCoverKind
  readonly label: string
  readonly hpBefore: number
  readonly maxHp: number
  readonly hpAfter: number
  readonly damage: number
  readonly isHeavyHit: boolean
  readonly shattered: boolean
  readonly heightLevel: number
}

export interface CoverForecastSummary {
  readonly targets: readonly CoverHitPreview[]
  readonly coverDamage: number
  readonly willShatterCover: boolean
  readonly shatteredCoverCount: number
  readonly damagedCoverCount: number
  readonly isHeavyHit: boolean
}

export interface BattleCoverCounts {
  readonly intactCount: number
  readonly shatteredCount: number
  readonly barricadeCount: number
  readonly crackedPillarCount: number
}

/** True when `cell` is an intact wooden barricade blocking movement & LoS. */
export function isBarricadeCell(cell: GridCell | undefined): boolean {
  return Boolean(
    cell &&
    cell.terrain === 'barricade' &&
    (cell.barricadeHp ?? BARRICADE_DEFAULT_HP) > 0
  )
}

/** True when `cell` is an intact cracked stone pillar blocking movement & LoS. */
export function isCrackedPillarCell(cell: GridCell | undefined): boolean {
  return Boolean(
    cell &&
    cell.terrain === 'cracked_pillar' &&
    (cell.pillarHp ?? CRACKED_PILLAR_DEFAULT_HP) > 0
  )
}

/** True when `cell` is any intact destructible cover obstacle (wooden barricade or cracked stone pillar). */
export function isDestructibleCover(cell: GridCell | undefined): boolean {
  return isBarricadeCell(cell) || isCrackedPillarCell(cell)
}

/** Return the destructible cover kind if `cell` is intact destructible cover, else null. */
export function getDestructibleCoverKind(cell: GridCell | undefined): DestructibleCoverKind | null {
  if (isCrackedPillarCell(cell)) return 'cracked_pillar'
  if (isBarricadeCell(cell)) return 'barricade'
  return null
}

/** Human-readable display name for a destructible cover obstacle. */
export function getCoverLabel(kind: DestructibleCoverKind): string {
  return kind === 'cracked_pillar' ? 'Cracked Pillar' : 'Timber Barricade'
}

/** Default max HP for a destructible cover kind. */
export function getDefaultCoverMaxHp(kind: DestructibleCoverKind): number {
  return kind === 'cracked_pillar' ? CRACKED_PILLAR_DEFAULT_HP : BARRICADE_DEFAULT_HP
}

/** Current and maximum HP for an intact destructible cover cell, or null if not intact cover. */
export function getCoverHp(cell: GridCell | undefined): { readonly hp: number; readonly maxHp: number; readonly kind: DestructibleCoverKind } | null {
  if (!cell) return null
  if (isCrackedPillarCell(cell)) {
    const maxHp = Math.max(1, Math.round(cell.pillarMaxHp ?? CRACKED_PILLAR_DEFAULT_HP))
    const hp = Math.max(0, Math.min(maxHp, Math.round(cell.pillarHp ?? maxHp)))
    return { hp, maxHp, kind: 'cracked_pillar' }
  }
  if (isBarricadeCell(cell)) {
    const maxHp = Math.max(1, Math.round(cell.barricadeMaxHp ?? BARRICADE_DEFAULT_HP))
    const hp = Math.max(0, Math.min(maxHp, Math.round(cell.barricadeHp ?? maxHp)))
    return { hp, maxHp, kind: 'barricade' }
  }
  return null
}

/** Damage fraction in [0..1] for visual wear & stress cracks (0 = pristine, 1 = broken). */
export function getCoverDamageRatio(cell: GridCell | undefined): number {
  const info = getCoverHp(cell)
  if (!info) return 1
  return Math.max(0, Math.min(1, 1 - info.hp / Math.max(1, info.maxHp)))
}

/** True when an attack qualifies as a heavy hit against destructible cover. */
export function isHeavyCoverHit(rawDamage: number, opts?: CoverDamageOptions): boolean {
  const empoweredMul = opts?.empowered ? 1.35 : 1
  const scaled = Math.max(0, rawDamage) * empoweredMul
  return Boolean(
    opts?.isCrit ||
    (opts?.powerMul ?? 1) >= COVER_HEAVY_POWER_MUL ||
    scaled >= COVER_HEAVY_RAW_THRESHOLD
  )
}

/**
 * Pure deterministic structural damage calculation against wooden barricades & cracked pillars.
 * Heavy hits (crits, powerMul >= 1.4, or raw damage >= 22) deal 1.5x structural damage.
 */
export function computeCoverDamage(rawDamage: number, opts?: CoverDamageOptions): CoverDamageCalc {
  const empoweredMul = opts?.empowered ? 1.35 : 1
  const scaled = Math.max(0, rawDamage) * empoweredMul
  const heavy = isHeavyCoverHit(rawDamage, opts)
  const structuralMul = heavy ? COVER_HEAVY_DAMAGE_MUL : 1
  const damage = Math.max(4, Math.round(scaled * structuralMul))
  return { damage, isHeavyHit: heavy }
}

/** Terrain left behind when destructible cover shatters (walkable flagstone rubble). */
export function getShatteredReplacementTerrain(): TileTerrain {
  return 'stone'
}

/**
 * Apply structural damage to a destructible cover cell in place.
 * If HP reaches 0, converts the tile cleanly to walkable `'stone'` rubble with recalculated elevation
 * and sets `coverShattered` so 3D rendering replaces the obstacle with low scattered rubble.
 */
export function applyCoverCellDamage(
  cell: GridCell | undefined,
  rawDamage: number,
  opts?: CoverDamageOptions
): CoverDamageOutcome | null {
  const info = getCoverHp(cell)
  if (!cell || !info || rawDamage <= 0) return null

  const { damage, isHeavyHit } = computeCoverDamage(rawDamage, opts)
  const hpBefore = info.hp
  const maxHp = info.maxHp
  const hpAfter = Math.max(0, hpBefore - damage)
  const hLvl = cellHeightLevel(cell)
  const label = getCoverLabel(info.kind)

  if (info.kind === 'cracked_pillar') {
    cell.pillarHp = hpAfter
  } else {
    cell.barricadeHp = hpAfter
  }

  let shattered = false
  if (hpAfter <= 0) {
    shattered = true
    const nextTerrain = getShatteredReplacementTerrain()
    cell.terrain = nextTerrain
    cell.walkable = true
    cell.elevation = terrainElevation(nextTerrain, hLvl)
    if (info.kind === 'cracked_pillar') {
      cell.pillarHp = 0
      cell.pillarMaxHp = undefined
      cell.coverShattered = 'pillar'
    } else {
      cell.barricadeHp = 0
      cell.barricadeMaxHp = undefined
      cell.coverShattered = 'barricade'
    }
  }

  return {
    applied: true,
    kind: info.kind,
    label,
    hpBefore,
    maxHp,
    hpAfter,
    damage,
    isHeavyHit,
    shattered,
    heightLevel: hLvl
  }
}

/**
 * Pure forecast preview for every destructible cover cell inside a target or AoE pattern.
 */
export function previewCoverDamageOnCells(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  cells: readonly GridCoord[],
  rawDamage: number,
  opts?: CoverDamageOptions
): CoverForecastSummary {
  if (rawDamage <= 0 || cells.length === 0) {
    return {
      targets: [],
      coverDamage: 0,
      willShatterCover: false,
      shatteredCoverCount: 0,
      damagedCoverCount: 0,
      isHeavyHit: false
    }
  }

  const seen = new Set<string>()
  const targets: CoverHitPreview[] = []
  const { damage, isHeavyHit } = computeCoverDamage(rawDamage, opts)
  let shatteredCoverCount = 0

  for (const coord of cells) {
    if (coord.row < 0 || coord.row >= battle.rows || coord.col < 0 || coord.col >= battle.cols) continue
    const key = `${coord.col},${coord.row}`
    if (seen.has(key)) continue
    seen.add(key)

    const cell = battle.cells[coord.row]?.[coord.col]
    const info = getCoverHp(cell)
    if (!info) continue

    const hpAfter = Math.max(0, info.hp - damage)
    const willShatter = hpAfter <= 0
    if (willShatter) shatteredCoverCount += 1

    targets.push({
      col: coord.col,
      row: coord.row,
      kind: info.kind,
      label: getCoverLabel(info.kind),
      hpBefore: info.hp,
      maxHp: info.maxHp,
      damage,
      hpAfter,
      willShatter,
      isHeavyHit
    })
  }

  return {
    targets,
    coverDamage: targets.length > 0 ? damage : 0,
    willShatterCover: shatteredCoverCount > 0,
    shatteredCoverCount,
    damagedCoverCount: targets.length,
    isHeavyHit: targets.length > 0 && isHeavyHit
  }
}

/** Count intact and shattered destructible cover tiles on the current battle board. */
export function countBattleDestructibleCover(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'> | null | undefined
): BattleCoverCounts {
  if (!battle) {
    return { intactCount: 0, shatteredCount: 0, barricadeCount: 0, crackedPillarCount: 0 }
  }
  let barricadeCount = 0
  let crackedPillarCount = 0
  let shatteredCount = 0
  for (let r = 0; r < battle.rows; r++) {
    const row = battle.cells[r]
    if (!row) continue
    for (let c = 0; c < battle.cols; c++) {
      const cell = row[c]
      if (!cell) continue
      if (isCrackedPillarCell(cell)) {
        crackedPillarCount += 1
      } else if (isBarricadeCell(cell)) {
        barricadeCount += 1
      } else if (cell.coverShattered) {
        shatteredCount += 1
      }
    }
  }
  return {
    intactCount: barricadeCount + crackedPillarCount,
    shatteredCount,
    barricadeCount,
    crackedPillarCount
  }
}

/** Format a concise tile tooltip for destructible cover (compact variant fits narrow mobile HUDs). */
export function formatCoverTooltip(cell: GridCell | undefined, compact = false): string | null {
  const info = getCoverHp(cell)
  if (!info) return null
  const label = getCoverLabel(info.kind)
  if (compact) {
    return `${label} · ${info.hp}/${info.maxHp} HP`
  }
  return `${label} · ${info.hp}/${info.maxHp} HP · Shatters to open LoS`
}

/** Format a compact CombatForecast badge when an attack/AoE cracks or shatters cover. */
export function formatCoverForecastBadge(
  opts: {
    readonly coverDamage?: number
    readonly willShatterCover?: boolean
    readonly shatteredCoverCount?: number
    readonly damagedCoverCount?: number
    readonly coverHeavyHit?: boolean
  },
  compact = false
): string | null {
  const count = opts.damagedCoverCount ?? 0
  const shattered = opts.shatteredCoverCount ?? (opts.willShatterCover ? 1 : 0)
  const dmg = opts.coverDamage ?? 0
  if (count <= 0 && shattered <= 0 && dmg <= 0) return null

  if (shattered > 1) {
    return compact ? `SHATTER x${shattered}` : `SHATTER COVER x${shattered}`
  }
  if (opts.willShatterCover || shattered === 1) {
    return compact ? 'SHATTER COVER' : 'SHATTERS COVER!'
  }
  if (dmg > 0) {
    if (count > 1) return `COVER x${count} -${dmg}`
    return opts.coverHeavyHit && !compact ? `HEAVY COVER -${dmg}` : `COVER -${dmg}`
  }
  return null
}
