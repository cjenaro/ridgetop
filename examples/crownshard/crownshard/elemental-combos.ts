import type { Vec3 } from 'ridgetop'
import { appendCombatLog, formatComboLog, formatKoLog } from './combat-log.ts'
import {
  KO_COUNTDOWN_TURNS,
  cellHeightLevel,
  gridToWorld,
  terrainElevation,
  terrainWalkable
} from './types.ts'
import type {
  BattleState,
  BattleUnit,
  ElementKind,
  ElementalComboId,
  ElementalComboPreview,
  GameState,
  GridCoord,
  StatusKind,
  TileTerrain
} from './types.ts'

export const SHATTER_MIN_DAMAGE = 12
export const SHATTER_HP_RATIO = 0.16
export const FREEZE_BONUS_DAMAGE = 8
export const WILDFIRE_DAMAGE = 10
export const WILDFIRE_MAX_TILES = 4
export const COMBUST_DAMAGE_PER_STACK = 7

export interface ElementalSpecLike {
  readonly vfx?: string
  readonly status?: StatusKind
}

export interface ElementalComboResult {
  readonly id: ElementalComboId
  readonly label: string
  readonly badgeText: string
  readonly bonusDamage: number
  readonly totalDamageDealt: number
  readonly defeatedUnitUids: readonly string[]
  readonly affectedTiles: readonly GridCoord[]
  readonly extraStatus?: StatusKind
  readonly consumesStatus?: StatusKind
}

export type UnitDefeatHandler = (state: GameState, unit: BattleUnit) => void

const ORTHO_DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]

function isInBounds(
  battle: Pick<BattleState, 'cols' | 'rows'>,
  col: number,
  row: number
): boolean {
  return col >= 0 && col < battle.cols && row >= 0 && row < battle.rows
}

function pushComboFloat(
  battle: BattleState,
  x: number,
  y: number,
  z: number,
  text: string,
  color: string
): void {
  battle.floatingNumbers.push({
    id: battle.nextFloatId++,
    x,
    y: y + 1.55,
    z,
    text,
    color,
    age: 0,
    duration: 1.15
  })
}

function defaultDefeatUnit(state: GameState, unit: BattleUnit): void {
  const battle = state.battle
  if (!battle) return
  unit.hp = 0
  unit.alive = false
  unit.shield = 0
  unit.path = []
  unit.moveProgress = 0
  unit.moved = false
  unit.acted = false
  unit.burnTurns = 0
  unit.slowTurns = 0
  unit.stunTurns = 0
  unit.empowerTurns = 0
  unit.tauntTurns = 0
  unit.hasteTurns = 0
  unit.poisonStacks = 0
  if (unit.team === 'ally') {
    unit.downed = true
    unit.koCountdown = KO_COUNTDOWN_TURNS
    unit.ct = 0
    pushComboFloat(battle, unit.x, unit.y + 0.35, unit.z, `DOWNED (${KO_COUNTDOWN_TURNS})`, '#ffb84d')
    appendCombatLog(battle, 'ko', formatKoLog({ unitName: unit.name, kind: 'downed', countdown: KO_COUNTDOWN_TURNS }))
    state.sounds.push({ kind: 'ko' })
    state.vfx.push({ kind: 'ko', at: [unit.x, unit.y + 0.6, unit.z], isBoss: false, downed: true })
  } else {
    unit.downed = false
    unit.koCountdown = 0
    appendCombatLog(battle, 'ko', formatKoLog({ unitName: unit.name, kind: 'ko', isBoss: unit.isBoss }))
    state.sounds.push({ kind: 'ko' })
    state.vfx.push({ kind: 'ko', at: [unit.x, unit.y + 0.6, unit.z], isBoss: unit.isBoss })
  }
}

/**
 * Derive an elemental affinity cleanly from a skill or tactic spec's VFX and status metadata.
 * Existing Fire/Frost/Poison/Holy/Arcane skills and tactic cards participate automatically.
 */
export function classifyElement(spec: ElementalSpecLike | null | undefined): ElementKind | null {
  if (!spec) return null
  if (spec.status === 'poison') return 'poison'
  if (spec.vfx === 'fire' || spec.status === 'burn') return 'fire'
  if (spec.vfx === 'frost' || spec.status === 'slow') return 'frost'
  if (spec.vfx === 'holy') return 'holy'
  if (spec.vfx === 'arcane') return 'arcane'
  return null
}

/**
 * Derive an elemental affinity for board terrain hazards (e.g., Lava Geysers, Ice).
 */
export function classifyHazardElement(terrain: TileTerrain): ElementKind | null {
  if (terrain === 'lava' || terrain === 'lava_geyser') return 'fire'
  if (terrain === 'ice' || terrain === 'snow') return 'frost'
  return null
}

/**
 * True when `(col, row)` is a wet, river-adjacent, bridge, or ice tile conducive to Flash Freeze.
 */
export function isWetOrIcyTile(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'biome'>,
  col: number,
  row: number
): boolean {
  if (!isInBounds(battle, col, row)) return false
  const terrain = battle.cells[row][col].terrain
  if (terrain === 'ice' || terrain === 'water' || terrain === 'bridge') return true
  for (const [dc, dr] of ORTHO_DIRS) {
    const nc = col + dc
    const nr = row + dr
    if (isInBounds(battle, nc, nr) && battle.cells[nr][nc].terrain === 'water') {
      return true
    }
  }
  return false
}

/**
 * Collect up to `maxTiles` orthogonally connected `'tall_grass'` cells starting from `(startCol, startRow)`.
 */
export function collectWildfirePatch(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  startCol: number,
  startRow: number,
  maxTiles = WILDFIRE_MAX_TILES
): GridCoord[] {
  if (!isInBounds(battle, startCol, startRow)) return []
  if (battle.cells[startRow][startCol].terrain !== 'tall_grass') return []
  const limit = Math.max(1, maxTiles)
  const visited = new Set<string>()
  const queue: GridCoord[] = [{ col: startCol, row: startRow }]
  const patch: GridCoord[] = []
  visited.add(`${startCol},${startRow}`)

  while (queue.length > 0 && patch.length < limit) {
    const cur = queue.shift()
    if (!cur) break
    patch.push(cur)
    for (const [dc, dr] of ORTHO_DIRS) {
      if (patch.length + queue.length >= limit * 2) continue
      const nc = cur.col + dc
      const nr = cur.row + dr
      if (!isInBounds(battle, nc, nr)) continue
      const key = `${nc},${nr}`
      if (visited.has(key)) continue
      if (battle.cells[nr][nc].terrain !== 'tall_grass') continue
      visited.add(key)
      queue.push({ col: nc, row: nr })
    }
  }
  return patch
}

export function computeShatterDamage(target: Pick<BattleUnit, 'maxHp'>): number {
  return Math.max(SHATTER_MIN_DAMAGE, Math.round(target.maxHp * SHATTER_HP_RATIO))
}

export function computeCombustDamage(target: Pick<BattleUnit, 'poisonStacks'>): number {
  return Math.max(0, target.poisonStacks) * COMBUST_DAMAGE_PER_STACK
}

/**
 * Pure deterministic preview of any reactive elemental combo that will trigger when `element`
 * hits `target` / `(targetCol, targetRow)`.
 */
export function previewElementalCombo(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'biome'>,
  element: ElementKind | null,
  target: BattleUnit | null,
  targetCol: number,
  targetRow: number
): ElementalComboPreview | null {
  if (!element) return null

  const livingTarget = target && target.alive ? target : null

  if (element === 'fire') {
    // 1. COMBUST: Fire hitting a Poisoned target detonates all poison stacks
    if (livingTarget && livingTarget.poisonStacks > 0) {
      const bonusDamage = computeCombustDamage(livingTarget)
      return {
        id: 'combust',
        label: 'COMBUST',
        badgeText: `☠ COMBUST +${bonusDamage}`,
        bonusDamage,
        consumesStatus: 'poison',
        affectedTiles: [{ col: livingTarget.col, row: livingTarget.row }]
      }
    }

    // 2. SHATTER: Fire hitting a Slowed/Chilled target triggers thermal-shock burst
    if (livingTarget && livingTarget.slowTurns > 0) {
      const bonusDamage = computeShatterDamage(livingTarget)
      return {
        id: 'shatter',
        label: 'SHATTER',
        badgeText: `⚡ SHATTER +${bonusDamage}`,
        bonusDamage,
        consumesStatus: 'slow',
        affectedTiles: [{ col: livingTarget.col, row: livingTarget.row }]
      }
    }

    // 3. WILDFIRE: Fire hitting a tall_grass tile ignites connected tall grass (up to 4 tiles)
    const originOnGrass = isInBounds(battle, targetCol, targetRow) && battle.cells[targetRow][targetCol].terrain === 'tall_grass'
    const targetOnGrass = Boolean(
      livingTarget &&
      isInBounds(battle, livingTarget.col, livingTarget.row) &&
      battle.cells[livingTarget.row][livingTarget.col].terrain === 'tall_grass'
    )
    const grassCol = originOnGrass ? targetCol : (targetOnGrass && livingTarget ? livingTarget.col : targetCol)
    const grassRow = originOnGrass ? targetRow : (targetOnGrass && livingTarget ? livingTarget.row : targetRow)
    const patch = collectWildfirePatch(battle, grassCol, grassRow, WILDFIRE_MAX_TILES)
    if (patch.length > 0) {
      const hitsTarget = Boolean(
        livingTarget && patch.some(p => p.col === livingTarget.col && p.row === livingTarget.row)
      )
      return {
        id: 'wildfire',
        label: 'WILDFIRE',
        badgeText: `🔥 WILDFIRE x${patch.length}`,
        bonusDamage: hitsTarget ? WILDFIRE_DAMAGE : 0,
        extraStatus: 'burn',
        affectedTiles: patch
      }
    }
    return null
  }

  if (element === 'frost') {
    if (!livingTarget) return null

    // 1. SHATTER (Thermal Shock): Frost hitting a Burning target consumes Burn for burst damage
    if (livingTarget.burnTurns > 0) {
      const bonusDamage = computeShatterDamage(livingTarget)
      return {
        id: 'shatter',
        label: 'SHATTER',
        badgeText: `⚡ SHATTER +${bonusDamage}`,
        bonusDamage,
        consumesStatus: 'burn',
        affectedTiles: [{ col: livingTarget.col, row: livingTarget.row }]
      }
    }

    // 2. FREEZE: Frost hitting a Slowed target or a unit on a wet/water-adjacent/bridge/ice tile
    if (livingTarget.slowTurns > 0 || isWetOrIcyTile(battle, livingTarget.col, livingTarget.row)) {
      return {
        id: 'freeze',
        label: 'FREEZE',
        badgeText: '❄ FREEZE (STUN)',
        bonusDamage: FREEZE_BONUS_DAMAGE,
        extraStatus: 'stun',
        affectedTiles: [{ col: livingTarget.col, row: livingTarget.row }]
      }
    }
    return null
  }

  return null
}

/**
 * Execute any reactive elemental combo for `element` hitting `target` at `(targetCol, targetRow)`.
 * Mutates battle state (HP, statuses, scorched tiles, floats, sounds, VFX) and delegates lethal KOs
 * to `onDefeat` (defaulting to standard Crownshard downed/KO handling).
 */
export function triggerElementalCombo(
  state: GameState,
  attacker: BattleUnit | null,
  element: ElementKind | null,
  target: BattleUnit | null,
  targetCol: number,
  targetRow: number,
  onDefeat: UnitDefeatHandler = defaultDefeatUnit
): ElementalComboResult | null {
  const battle = state.battle
  if (!battle || !element) return null

  const preview = previewElementalCombo(battle, element, target, targetCol, targetRow)
  if (!preview) return null

  const defeatedUnitUids: string[] = []
  let totalDamageDealt = 0

  if (preview.id === 'shatter') {
    if (!target || !target.alive) return null
    if (preview.consumesStatus === 'slow') target.slowTurns = 0
    else if (preview.consumesStatus === 'burn') target.burnTurns = 0

    const dmg = preview.bonusDamage
    target.hp = Math.max(0, target.hp - dmg)
    totalDamageDealt = dmg
    target.hitFlash = 0.34
    target.animState = 'hit'
    target.animTimer = 0.32
    battle.shake = Math.max(battle.shake, 0.34)

    pushComboFloat(battle, target.x, target.y + 0.72, target.z, `SHATTER! -${dmg}`, '#7ef0ff')
    appendCombatLog(
      battle,
      'combo',
      formatComboLog({ actorName: attacker?.name ?? null, combo: 'shatter', targetName: target.name, bonusDamage: dmg })
    )
    const at: Vec3 = [target.x, target.y, target.z]
    state.vfx.push({ kind: 'combo', combo: 'shatter', at, cells: [at], bonusDamage: dmg })
    state.sounds.push({ kind: 'crit', pitch: 1.18 })

    if (target.hp <= 0) {
      onDefeat(state, target)
      defeatedUnitUids.push(target.uid)
    }

    return {
      id: preview.id,
      label: preview.label,
      badgeText: preview.badgeText,
      bonusDamage: dmg,
      totalDamageDealt,
      defeatedUnitUids,
      affectedTiles: preview.affectedTiles,
      consumesStatus: preview.consumesStatus
    }
  }

  if (preview.id === 'freeze') {
    if (!target || !target.alive) return null
    const dmg = preview.bonusDamage
    target.stunTurns = Math.max(target.stunTurns, 1)
    target.hp = Math.max(0, target.hp - dmg)
    totalDamageDealt = dmg
    target.hitFlash = 0.30
    target.animState = 'hit'
    target.animTimer = 0.30
    battle.shake = Math.max(battle.shake, 0.26)

    pushComboFloat(battle, target.x, target.y + 0.72, target.z, `FROZEN! -${dmg}`, '#9ef2ff')
    appendCombatLog(
      battle,
      'combo',
      formatComboLog({ actorName: attacker?.name ?? null, combo: 'freeze', targetName: target.name, bonusDamage: dmg })
    )
    const at: Vec3 = [target.x, target.y, target.z]
    state.vfx.push({ kind: 'combo', combo: 'freeze', at, cells: [at], bonusDamage: dmg })
    state.sounds.push({ kind: 'magic', pitch: 1.35 })

    if (target.hp <= 0) {
      onDefeat(state, target)
      defeatedUnitUids.push(target.uid)
    }

    return {
      id: preview.id,
      label: preview.label,
      badgeText: preview.badgeText,
      bonusDamage: dmg,
      totalDamageDealt,
      defeatedUnitUids,
      affectedTiles: preview.affectedTiles,
      extraStatus: 'stun'
    }
  }

  if (preview.id === 'combust') {
    if (!target || !target.alive) return null
    const dmg = preview.bonusDamage
    target.poisonStacks = 0
    target.hp = Math.max(0, target.hp - dmg)
    totalDamageDealt = dmg
    target.hitFlash = 0.36
    target.animState = 'hit'
    target.animTimer = 0.34
    battle.shake = Math.max(battle.shake, 0.38)

    pushComboFloat(battle, target.x, target.y + 0.72, target.z, `COMBUST! -${dmg}`, '#b8ff52')
    appendCombatLog(
      battle,
      'combo',
      formatComboLog({ actorName: attacker?.name ?? null, combo: 'combust', targetName: target.name, bonusDamage: dmg })
    )
    const at: Vec3 = [target.x, target.y, target.z]
    state.vfx.push({ kind: 'combo', combo: 'combust', at, cells: [at], bonusDamage: dmg })
    state.sounds.push({ kind: 'crit', pitch: 0.92 })

    if (target.hp <= 0) {
      onDefeat(state, target)
      defeatedUnitUids.push(target.uid)
    }

    return {
      id: preview.id,
      label: preview.label,
      badgeText: preview.badgeText,
      bonusDamage: dmg,
      totalDamageDealt,
      defeatedUnitUids,
      affectedTiles: preview.affectedTiles,
      consumesStatus: 'poison'
    }
  }

  if (preview.id === 'wildfire') {
    const patch = preview.affectedTiles
    const patchCentres: Vec3[] = []
    for (const coord of patch) {
      const cell = battle.cells[coord.row][coord.col]
      const hLvl = cellHeightLevel(cell)
      cell.terrain = 'darkstone'
      cell.walkable = terrainWalkable('darkstone')
      cell.elevation = terrainElevation('darkstone', hLvl)
      patchCentres.push(gridToWorld(coord.col, coord.row, cell.elevation, battle.cols, battle.rows))
    }

    const origin = patchCentres[0]
    pushComboFloat(battle, origin[0], origin[1] + 0.65, origin[2], 'WILDFIRE!', '#ff8f38')

    for (const coord of patch) {
      const standing = battle.units.find(u => u.alive && u.col === coord.col && u.row === coord.row)
      if (!standing) continue
      standing.hp = Math.max(0, standing.hp - WILDFIRE_DAMAGE)
      totalDamageDealt += WILDFIRE_DAMAGE
      standing.hitFlash = 0.28
      standing.animState = 'hit'
      standing.animTimer = 0.28
      pushComboFloat(battle, standing.x, standing.y + 0.25, standing.z, `-${WILDFIRE_DAMAGE}`, '#ff8f38')
      if (standing.hp <= 0) {
        onDefeat(state, standing)
        defeatedUnitUids.push(standing.uid)
      } else {
        standing.burnTurns = Math.max(standing.burnTurns, 2)
        pushComboFloat(battle, standing.x, standing.y + 0.55, standing.z, 'BURN', '#ff9b42')
      }
    }

    appendCombatLog(
      battle,
      'combo',
      formatComboLog({
        actorName: attacker?.name ?? null,
        combo: 'wildfire',
        bonusDamage: totalDamageDealt,
        tileCount: patch.length
      })
    )
    battle.shake = Math.max(battle.shake, 0.30)
    state.vfx.push({ kind: 'combo', combo: 'wildfire', at: origin, cells: patchCentres, bonusDamage: WILDFIRE_DAMAGE })
    state.sounds.push({ kind: 'magic', pitch: 0.85 })

    return {
      id: preview.id,
      label: preview.label,
      badgeText: preview.badgeText,
      bonusDamage: preview.bonusDamage,
      totalDamageDealt,
      defeatedUnitUids,
      affectedTiles: patch,
      extraStatus: 'burn'
    }
  }

  return null
}
