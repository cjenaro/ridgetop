import type { Vec3 } from 'ridgetop'
import { appendCombatLog, formatHazardLog, formatKoLog, formatStatusLog } from './combat-log.ts'
import { canTriggerPhoenixGrace } from './endless-roguelite.ts'
import {
  BARRICADE_DEFAULT_HP,
  COLLISION_IMPACT_DAMAGE,
  CURSED_ALTAR_HP_COST,
  FALL_DAMAGE_PER_LEVEL,
  FALL_MIN_DROP_LEVELS,
  KO_COUNTDOWN_TURNS,
  LAVA_GEYSER_DAMAGE,
  LEDGE_STOP_DAMAGE,
  cellHeightLevel,
  facingVector,
  gridToWorld,
  isUnitDowned,
  terrainDefBonus,
  terrainElevation
} from './types.ts'
import { classifyHazardElement, previewElementalCombo, triggerElementalCombo } from './elemental-combos.ts'
import { closestFootprintCell, getUnitFootprintSize, unitOccupiesCell } from './expansion-act2.ts'
import type {
  BattleState,
  BattleUnit,
  DisplacementCollisionKind,
  DisplacementKind,
  DisplacementPreview,
  DisplacementSpec,
  GameState,
  GridCell,
  GridCoord
} from './types.ts'

export interface DisplacementResult {
  readonly preview: DisplacementPreview
  readonly moved: boolean
  readonly targetDmgDealt: number
  readonly secondaryDmgDealt: number
  readonly barricadeDmgDealt: number
  readonly barricadeShattered: boolean
}

function inBounds(col: number, row: number, cols: number, rows: number): boolean {
  return col >= 0 && col < cols && row >= 0 && row < rows
}

function isIntactBarricadeCell(cell: GridCell | undefined): boolean {
  return Boolean(cell && cell.terrain === 'barricade' && !cell.walkable && (cell.barricadeHp ?? BARRICADE_DEFAULT_HP) > 0)
}

function computeGeyserImpactDmg(target: BattleUnit, cell: GridCell): number {
  const terrainDef = terrainDefBonus(cell.terrain)
  const effDef = Math.max(0, target.def * 0.5 + terrainDef)
  return Math.max(4, Math.round(LAVA_GEYSER_DAMAGE - effDef * 0.72))
}

function cardinalAxis(
  originCol: number,
  originRow: number,
  targetCol: number,
  targetRow: number,
  actor: BattleUnit | null
): readonly [number, number] {
  const dc = targetCol - originCol
  const dr = targetRow - originRow
  if (dc === 0 && dr === 0) {
    return actor ? facingVector(actor.facing) : [1, 0]
  }
  if (Math.abs(dc) >= Math.abs(dr)) {
    return [dc > 0 ? 1 : -1, 0]
  }
  return [0, dr > 0 ? 1 : -1]
}

function buildSummaryTag(
  kind: DisplacementKind,
  distance: number,
  moved: boolean,
  collidedWith: DisplacementCollisionKind,
  collisionDmg: number,
  fallDmg: number,
  hazardKind: 'none' | 'lava_geyser' | 'cursed_altar' | 'ice',
  iceSlid: boolean
): string {
  if (kind === 'swap') {
    return moved ? 'SWAP' : 'SWAP BLOCKED'
  }
  const verb = kind === 'pull' ? 'PULL' : 'PUSH'
  const base = `${verb} ${distance}`
  if (collidedWith === 'void' || collidedWith === 'water' || collidedWith === 'lava') {
    return `${base} → LEDGE +${collisionDmg}`
  }
  if (collidedWith !== 'none' && collisionDmg > 0) {
    return `${base} → COLLIDE +${collisionDmg}`
  }
  if (fallDmg > 0) {
    return `${base} → FALL +${fallDmg}`
  }
  if (hazardKind === 'lava_geyser') {
    return `${base} → GEYSER!`
  }
  if (hazardKind === 'cursed_altar') {
    return `${base} → ALTAR!`
  }
  if (iceSlid) {
    return `${base} +ICE`
  }
  return base
}

/**
 * Pure deterministic preview of forced movement (knockback, pull, swap) & terrain/hazard collisions.
 * Never mutates battle state; used by both CombatForecast and applyDisplacement.
 */
export function resolveDisplacementPreview(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows' | 'units'> & { readonly biome?: BattleState['biome'] },
  actor: BattleUnit | null,
  target: BattleUnit,
  displacement: DisplacementSpec,
  origin?: GridCoord
): DisplacementPreview {
  const fromCol = target.col
  const fromRow = target.row
  const actorOrigin = !origin && actor && getUnitFootprintSize(actor) > 1
    ? closestFootprintCell(fromCol, fromRow, actor)
    : null
  const originCol = origin ? origin.col : (actorOrigin ? actorOrigin.col : (actor ? actor.col : target.col))
  const originRow = origin ? origin.row : (actorOrigin ? actorOrigin.row : (actor ? actor.row : target.row))
  const distance = Math.max(0, Math.floor(displacement.distance))

  // Multi-tile 2x2 raid bosses are immovable against forced displacement (knockback, pull, swap)
  if (getUnitFootprintSize(target) > 1) {
    return {
      kind: displacement.kind,
      distance,
      fromCol,
      fromRow,
      toCol: fromCol,
      toRow: fromRow,
      path: [],
      moved: false,
      collidedWith: 'none',
      collisionDmg: 0,
      secondaryCollisionDmg: 0,
      barricadeDmg: 0,
      fallDrop: 0,
      fallDmg: 0,
      hazardKind: 'none',
      hazardDmg: 0,
      iceSlid: false,
      causesStun: false,
      causesSlow: false,
      causesBurn: false,
      totalBonusDmg: 0,
      summaryTag: displacement.kind === 'swap' ? 'SWAP BLOCKED' : 'IMMOVABLE'
    }
  }

  if (displacement.kind === 'swap') {
    const originCell = inBounds(originCol, originRow, battle.cols, battle.rows)
      ? battle.cells[originRow][originCol]
      : undefined
    const targetCell = inBounds(fromCol, fromRow, battle.cols, battle.rows)
      ? battle.cells[fromRow][fromCol]
      : undefined
    const canSwap = Boolean(
      actor &&
      actor.alive &&
      target.alive &&
      actor.uid !== target.uid &&
      originCell &&
      targetCell &&
      originCell.walkable &&
      originCell.terrain !== 'void' &&
      targetCell.walkable &&
      targetCell.terrain !== 'void' &&
      (originCol !== fromCol || originRow !== fromRow)
    )
    if (!canSwap || !originCell) {
      return {
        kind: 'swap',
        distance,
        fromCol,
        fromRow,
        toCol: fromCol,
        toRow: fromRow,
        path: [],
        moved: false,
        collidedWith: 'none',
        collisionDmg: 0,
        secondaryCollisionDmg: 0,
        barricadeDmg: 0,
        fallDrop: 0,
        fallDmg: 0,
        hazardKind: 'none',
        hazardDmg: 0,
        iceSlid: false,
        causesStun: false,
        causesSlow: false,
        causesBurn: false,
        totalBonusDmg: 0,
        summaryTag: 'SWAP BLOCKED'
      }
    }

    let hazardKind: 'none' | 'lava_geyser' | 'cursed_altar' | 'ice' = 'none'
    let hazardDmg = 0
    let causesBurn = false
    if (originCell.terrain === 'lava_geyser' && originCell.geyserActive) {
      hazardKind = 'lava_geyser'
      hazardDmg = computeGeyserImpactDmg(target, originCell)
      causesBurn = true
    } else if (originCell.terrain === 'cursed_altar' && !originCell.altarUsed) {
      hazardKind = 'cursed_altar'
      hazardDmg = Math.min(CURSED_ALTAR_HP_COST, Math.max(0, target.hp - 1))
    }

    return {
      kind: 'swap',
      distance,
      fromCol,
      fromRow,
      toCol: originCol,
      toRow: originRow,
      actorToCol: fromCol,
      actorToRow: fromRow,
      path: [{ col: originCol, row: originRow }],
      moved: true,
      collidedWith: 'none',
      collisionDmg: 0,
      secondaryCollisionDmg: 0,
      barricadeDmg: 0,
      fallDrop: 0,
      fallDmg: 0,
      hazardKind,
      hazardDmg,
      iceSlid: false,
      causesStun: false,
      causesSlow: false,
      causesBurn,
      totalBonusDmg: hazardDmg,
      summaryTag: 'SWAP'
    }
  }

  const [axisCol, axisRow] = cardinalAxis(originCol, originRow, fromCol, fromRow, actor)
  const dirCol = displacement.kind === 'pull' ? -axisCol : axisCol
  const dirRow = displacement.kind === 'pull' ? -axisRow : axisRow

  let curCol = fromCol
  let curRow = fromRow
  let remaining = distance
  const path: GridCoord[] = []
  let collidedWith: DisplacementCollisionKind = 'none'
  let collidedUnitUid: string | undefined
  let collidedUnitName: string | undefined
  let collidedCell: GridCoord | undefined
  let collisionDmg = 0
  let secondaryCollisionDmg = 0
  let barricadeDmg = 0
  let fallDrop = 0
  let fallDmg = 0
  let iceSlid = false
  let causesStun = false
  let causesSlow = false
  let causesBurn = false

  while (remaining > 0) {
    const nextCol = curCol + dirCol
    const nextRow = curRow + dirRow

    // Pull stops cleanly adjacent to caster (never slams into caster)
    if (displacement.kind === 'pull' && actor && nextCol === originCol && nextRow === originRow) {
      break
    }

    if (!inBounds(nextCol, nextRow, battle.cols, battle.rows)) {
      collidedWith = 'edge'
      collidedCell = { col: curCol, row: curRow }
      collisionDmg += COLLISION_IMPACT_DAMAGE
      causesStun = true
      break
    }

    const curCell = battle.cells[curRow][curCol]
    const nextCell = battle.cells[nextRow][nextCol]

    // Chasm ('void'), Water ('water'), or Lava ('lava') ledge stop: never strand a unit on unwalkable void/water/lava!
    if (nextCell.terrain === 'void' || nextCell.terrain === 'water' || nextCell.terrain === 'lava') {
      collidedWith = nextCell.terrain
      collidedCell = { col: nextCol, row: nextRow }
      collisionDmg += LEDGE_STOP_DAMAGE
      causesSlow = true
      if (nextCell.terrain === 'void') causesStun = true
      if (nextCell.terrain === 'lava') causesBurn = true
      break
    }

    if (nextCell.terrain === 'pillar') {
      collidedWith = 'pillar'
      collidedCell = { col: nextCol, row: nextRow }
      collisionDmg += COLLISION_IMPACT_DAMAGE
      causesStun = true
      break
    }

    if (isIntactBarricadeCell(nextCell)) {
      collidedWith = 'barricade'
      collidedCell = { col: nextCol, row: nextRow }
      collisionDmg += COLLISION_IMPACT_DAMAGE
      barricadeDmg = COLLISION_IMPACT_DAMAGE
      causesStun = true
      break
    }

    if (!nextCell.walkable) {
      collidedWith = 'wall'
      collidedCell = { col: nextCol, row: nextRow }
      collisionDmg += COLLISION_IMPACT_DAMAGE
      causesStun = true
      break
    }

    const fromH = cellHeightLevel(curCell)
    const toH = cellHeightLevel(nextCell)
    if (toH - fromH > target.jump) {
      collidedWith = 'cliff'
      collidedCell = { col: nextCol, row: nextRow }
      collisionDmg += COLLISION_IMPACT_DAMAGE
      causesStun = true
      break
    }

    const blocker = battle.units.find(u => {
      if (!(u.alive || isUnitDowned(u)) || u.uid === target.uid) return false
      if (actor && u.uid === actor.uid) {
        if (getUnitFootprintSize(u) > 1) return unitOccupiesCell(u, nextCol, nextRow)
        return originCol === nextCol && originRow === nextRow
      }
      return unitOccupiesCell(u, nextCol, nextRow)
    })
    if (blocker) {
      collidedWith = 'unit'
      collidedUnitUid = blocker.uid
      collidedUnitName = blocker.name
      collidedCell = { col: nextCol, row: nextRow }
      if (blocker.alive) {
        collisionDmg += COLLISION_IMPACT_DAMAGE
        secondaryCollisionDmg += COLLISION_IMPACT_DAMAGE
      }
      break
    }

    // Valid tile entry!
    const drop = fromH - toH
    if (drop >= FALL_MIN_DROP_LEVELS) {
      fallDrop += drop
      fallDmg += drop * FALL_DAMAGE_PER_LEVEL
    }

    curCol = nextCol
    curRow = nextRow
    path.push({ col: curCol, row: curRow })
    remaining -= 1

    // Ice Sheet momentum: sliding onto ice pushes 1 extra tile along the vector!
    if (nextCell.terrain === 'ice' && !iceSlid) {
      iceSlid = true
      remaining += 1
    }
  }

  const moved = curCol !== fromCol || curRow !== fromRow
  const finalCell = battle.cells[curRow][curCol]
  let hazardKind: 'none' | 'lava_geyser' | 'cursed_altar' | 'ice' = 'none'
  let hazardDmg = 0

  const comboBattle = { cells: battle.cells, cols: battle.cols, rows: battle.rows, biome: battle.biome ?? 'meadow' as const }
  if (finalCell.terrain === 'lava_geyser' && finalCell.geyserActive) {
    hazardKind = 'lava_geyser'
    hazardDmg = computeGeyserImpactDmg(target, finalCell)
    const geyserElem = classifyHazardElement('lava_geyser')
    const geyserCombo = geyserElem ? previewElementalCombo(comboBattle, geyserElem, target, curCol, curRow) : null
    if (geyserCombo && geyserCombo.bonusDamage > 0) hazardDmg += geyserCombo.bonusDamage
    causesBurn = true
  } else if (finalCell.terrain === 'cursed_altar' && !finalCell.altarUsed && moved) {
    hazardKind = 'cursed_altar'
    hazardDmg = Math.min(CURSED_ALTAR_HP_COST, Math.max(0, target.hp - 1))
  } else if (iceSlid) {
    hazardKind = 'ice'
  }
  if (collidedWith === 'lava' && causesBurn) {
    const lavaElem = classifyHazardElement('lava')
    const lavaCombo = lavaElem ? previewElementalCombo(comboBattle, lavaElem, target, curCol, curRow) : null
    if (lavaCombo && lavaCombo.bonusDamage > 0) hazardDmg += lavaCombo.bonusDamage
  }

  const totalBonusDmg = collisionDmg + fallDmg + hazardDmg
  const summaryTag = buildSummaryTag(
    displacement.kind,
    distance,
    moved,
    collidedWith,
    collisionDmg,
    fallDmg,
    hazardKind,
    iceSlid
  )

  return {
    kind: displacement.kind,
    distance,
    fromCol,
    fromRow,
    toCol: curCol,
    toRow: curRow,
    path,
    moved,
    collidedWith,
    ...(collidedUnitUid ? { collidedUnitUid } : {}),
    ...(collidedUnitName ? { collidedUnitName } : {}),
    ...(collidedCell ? { collidedCell } : {}),
    collisionDmg,
    secondaryCollisionDmg,
    barricadeDmg,
    fallDrop,
    fallDmg,
    hazardKind,
    hazardDmg,
    iceSlid,
    causesStun,
    causesSlow,
    causesBurn,
    totalBonusDmg,
    summaryTag
  }
}

function pushFloat(battle: BattleState, x: number, y: number, z: number, text: string, color: string): void {
  battle.floatingNumbers.push({
    id: battle.nextFloatId++,
    x,
    y: y + 1.55,
    z,
    text,
    color,
    age: 0,
    duration: 1.05
  })
}

function defeatDisplacedUnit(state: GameState, unit: BattleUnit): void {
  const battle = state.battle
  if (!battle) return
  if (canTriggerPhoenixGrace(battle, unit)) {
    battle.phoenixGraceUsed = true
    const revivedHp = Math.max(1, Math.round(unit.maxHp * 0.4))
    unit.hp = revivedHp
    unit.alive = true
    unit.downed = false
    unit.koCountdown = 0
    pushFloat(battle, unit.x, unit.y + 0.52, unit.z, `PHOENIX GRACE! +${revivedHp}`, '#ffda6b')
    state.vfx.push({ kind: 'burst', style: 'gold', at: [unit.x, unit.y + 0.7, unit.z], radius: 1.15 })
    state.sounds.push({ kind: 'heal', pitch: 1.25 })
    appendCombatLog(
      battle,
      'system',
      `Phoenix Grace revives ${unit.name} at ${revivedHp}/${unit.maxHp} HP!`,
      { accentHex: '#ffda6b' }
    )
    return
  }
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
    pushFloat(battle, unit.x, unit.y + 0.35, unit.z, `DOWNED (${KO_COUNTDOWN_TURNS})`, '#ffb84d')
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

interface ImpactDamageOutcome {
  readonly hpDamage: number
  readonly absorbed: number
}

function applyImpactDamage(
  state: GameState,
  unit: BattleUnit,
  amount: number,
  label: string,
  color: string,
  floatOffsetY = 0.25
): ImpactDamageOutcome {
  const battle = state.battle
  if (!battle || !unit.alive || amount <= 0) return { hpDamage: 0, absorbed: 0 }

  let dmg = Math.max(1, Math.round(amount))
  let absorbed = 0
  if (unit.shield > 0) {
    absorbed = Math.min(unit.shield, dmg)
    unit.shield -= absorbed
    dmg -= absorbed
  }
  unit.hp = Math.max(0, unit.hp - dmg)
  unit.hitFlash = 0.28
  unit.animState = 'hit'
  unit.animTimer = 0.30
  battle.shake = Math.max(battle.shake, 0.26)

  state.vfx.push({
    kind: 'impact',
    uid: unit.uid,
    attackerUid: null,
    arc: 'front',
    crit: false,
    blocked: dmg === 0 && absorbed > 0,
    absorbed,
    damage: dmg
  })

  if (dmg > 0) {
    pushFloat(battle, unit.x, unit.y + floatOffsetY, unit.z, label, color)
    state.sounds.push({ kind: 'hit', pitch: 0.85 })
  } else if (absorbed > 0) {
    pushFloat(battle, unit.x, unit.y + floatOffsetY, unit.z, `BLOCK ${absorbed}`, '#7ed9ff')
    state.sounds.push({ kind: 'shield' })
  }

  if (unit.hp <= 0) {
    defeatDisplacedUnit(state, unit)
  }
  return { hpDamage: dmg, absorbed }
}

function applyBarricadeCollision(
  state: GameState,
  col: number,
  row: number,
  damage: number
): { dealt: number; shattered: boolean } {
  const battle = state.battle
  if (!battle || !inBounds(col, row, battle.cols, battle.rows) || damage <= 0) {
    return { dealt: 0, shattered: false }
  }
  const cell = battle.cells[row][col]
  if (!isIntactBarricadeCell(cell)) {
    return { dealt: 0, shattered: false }
  }
  const hpBefore = cell.barricadeHp ?? BARRICADE_DEFAULT_HP
  const dmg = Math.max(4, Math.round(damage))
  const hpAfter = Math.max(0, hpBefore - dmg)
  cell.barricadeHp = hpAfter

  const [tx, ty, tz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  pushFloat(battle, tx, ty + 0.15, tz, `-${dmg}`, '#f5c678')
  state.vfx.push({ kind: 'burst', style: 'slash', at: [tx, ty + 0.55, tz], radius: 0.85 })
  state.sounds.push({ kind: 'hit', pitch: 0.78 })
  battle.shake = Math.max(battle.shake, 0.24)

  if (hpAfter <= 0) {
    const hLvl = cellHeightLevel(cell)
    cell.terrain = 'stone'
    cell.walkable = true
    cell.elevation = terrainElevation('stone', hLvl)
    cell.barricadeHp = 0
    cell.barricadeMaxHp = undefined
    pushFloat(battle, tx, ty + 0.58, tz, 'SHATTERED!', '#ffd980')
    state.vfx.push({ kind: 'burst', style: 'gold', at: [tx, ty + 0.5, tz], radius: 1.35 })
    state.sounds.push({ kind: 'ko', pitch: 1.15 })
    battle.shake = Math.max(battle.shake, 0.34)
    return { dealt: dmg, shattered: true }
  }
  return { dealt: dmg, shattered: false }
}

function triggerLandingHazard(
  state: GameState,
  unit: BattleUnit,
  cell: GridCell,
  moved: boolean
): number {
  const battle = state.battle
  if (!battle || !unit.alive) return 0

  if (cell.terrain === 'lava_geyser' && cell.geyserActive) {
    const [tx, ty, tz] = gridToWorld(cell.col, cell.row, cell.elevation, battle.cols, battle.rows)
    state.vfx.push({ kind: 'burst', style: 'fire', at: [tx, ty + 0.4, tz], radius: 0.95 })
    pushFloat(battle, unit.x, unit.y + 0.48, unit.z, 'GEYSER!', '#ff7a38')
    const geyserDmg = computeGeyserImpactDmg(unit, cell)
    const impact = applyImpactDamage(state, unit, geyserDmg, `-${geyserDmg}`, '#ff7a38', 0.1)
    appendCombatLog(
      battle,
      'hazard',
      formatHazardLog({ kind: 'lava_geyser', targetName: unit.name, damage: impact.hpDamage, absorbed: impact.absorbed })
    )
    let dealt = impact.hpDamage
    if (unit.alive) {
      const geyserElem = classifyHazardElement('lava_geyser')
      if (geyserElem) {
        const comboRes = triggerElementalCombo(state, null, geyserElem, unit, cell.col, cell.row, defeatDisplacedUnit)
        if (comboRes) dealt += comboRes.totalDamageDealt
      }
    }
    if (unit.alive) {
      unit.burnTurns = Math.max(unit.burnTurns, 2)
      pushFloat(battle, unit.x, unit.y + 0.82, unit.z, 'BURN!', '#ff7a38')
      appendCombatLog(battle, 'status', formatStatusLog({ targetName: unit.name, status: 'burn', phase: 'apply' }))
    }
    return dealt
  }

  if (cell.terrain === 'cursed_altar' && !cell.altarUsed && moved) {
    cell.altarUsed = true
    const hpDrain = Math.min(CURSED_ALTAR_HP_COST, Math.max(0, unit.hp - 1))
    if (hpDrain > 0) {
      unit.hp -= hpDrain
      pushFloat(battle, unit.x, unit.y, unit.z, `-${hpDrain} HP`, '#d45eff')
    }
    unit.empowerTurns += 2
    if (unit.team === 'ally') {
      battle.ap = Math.min(battle.maxAp, battle.ap + 1)
    }
    const [tx, ty, tz] = gridToWorld(cell.col, cell.row, cell.elevation, battle.cols, battle.rows)
    state.vfx.push({ kind: 'burst', style: 'shadow', at: [tx, ty + 0.65, tz], radius: 1.15 })
    state.sounds.push({ kind: 'magic', pitch: 0.78 })
    pushFloat(
      battle,
      unit.x,
      unit.y + 0.55,
      unit.z,
      unit.team === 'ally' ? 'DARK PACT! +EMPOWER +1 AP' : 'DARK PACT! +EMPOWER',
      '#e28cff'
    )
    appendCombatLog(
      battle,
      'hazard',
      formatHazardLog({
        kind: 'cursed_altar',
        targetName: unit.name,
        damage: hpDrain,
        detail: unit.team === 'ally' ? '+1 AP' : undefined
      })
    )
    battle.shake = Math.max(battle.shake, 0.22)
    return hpDrain
  }

  return 0
}

function relocateUnitToCell(battle: BattleState, unit: BattleUnit, col: number, row: number): Vec3 {
  const cell = battle.cells[row][col]
  const [nx, ny, nz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = nx
  unit.y = ny
  unit.z = nz
  unit.path = []
  unit.moveProgress = 0
  return [nx, ny, nz]
}

/**
 * Execute forced displacement (knockback, pull, swap), collisions, ledge drops, and landing hazards.
 * Mutates deterministic battle coordinates immediately and emits 'displace' VFX events for smooth 3D slides.
 */
export function applyDisplacement(
  state: GameState,
  actor: BattleUnit | null,
  target: BattleUnit,
  displacement: DisplacementSpec,
  origin?: GridCoord
): DisplacementResult {
  const battle = state.battle
  if (!battle || !target.alive) {
    const emptyPreview: DisplacementPreview = {
      kind: displacement.kind,
      distance: Math.max(0, Math.floor(displacement.distance)),
      fromCol: target.col,
      fromRow: target.row,
      toCol: target.col,
      toRow: target.row,
      path: [],
      moved: false,
      collidedWith: 'none',
      collisionDmg: 0,
      secondaryCollisionDmg: 0,
      barricadeDmg: 0,
      fallDrop: 0,
      fallDmg: 0,
      hazardKind: 'none',
      hazardDmg: 0,
      iceSlid: false,
      causesStun: false,
      causesSlow: false,
      causesBurn: false,
      totalBonusDmg: 0,
      summaryTag: ''
    }
    return {
      preview: emptyPreview,
      moved: false,
      targetDmgDealt: 0,
      secondaryDmgDealt: 0,
      barricadeDmgDealt: 0,
      barricadeShattered: false
    }
  }

  const preview = resolveDisplacementPreview(battle, actor, target, displacement, origin)
  let targetDmgDealt = 0
  let secondaryDmgDealt = 0
  let barricadeDmgDealt = 0
  let barricadeShattered = false

  // 1. SWAP: exchange caster & target tiles cleanly
  if (displacement.kind === 'swap') {
    if (
      preview.moved &&
      actor &&
      actor.alive &&
      preview.actorToCol !== undefined &&
      preview.actorToRow !== undefined
    ) {
      const targetFrom: Vec3 = [target.x, target.y, target.z]
      const actorFrom: Vec3 = [actor.x, actor.y, actor.z]
      const targetTo = relocateUnitToCell(battle, target, preview.toCol, preview.toRow)
      const actorTo = relocateUnitToCell(battle, actor, preview.actorToCol, preview.actorToRow)
      battle.moveUndo = null

      state.vfx.push({
        kind: 'displace',
        uid: target.uid,
        displacementKind: 'swap',
        from: targetFrom,
        to: targetTo
      })
      state.vfx.push({
        kind: 'displace',
        uid: actor.uid,
        displacementKind: 'swap',
        from: actorFrom,
        to: actorTo
      })
      state.sounds.push({ kind: 'card', pitch: 1.25 })
      pushFloat(battle, target.x, target.y + 0.55, target.z, 'SWAP!', '#d8a6ff')
      appendCombatLog(
        battle,
        'hazard',
        formatHazardLog({ kind: 'swap', actorName: actor.name, targetName: target.name })
      )

      // Trigger landing hazards on both swapped units
      targetDmgDealt += triggerLandingHazard(state, target, battle.cells[target.row][target.col], true)
      triggerLandingHazard(state, actor, battle.cells[actor.row][actor.col], true)
    }
    return {
      preview,
      moved: preview.moved,
      targetDmgDealt,
      secondaryDmgDealt,
      barricadeDmgDealt,
      barricadeShattered
    }
  }

  // 2. KNOCKBACK / PULL
  const fromPos: Vec3 = [target.x, target.y, target.z]
  let toPos: Vec3 = fromPos
  if (preview.moved) {
    toPos = relocateUnitToCell(battle, target, preview.toCol, preview.toRow)
    battle.moveUndo = null
  }

  if (preview.moved || preview.collidedWith !== 'none') {
    state.vfx.push({
      kind: 'displace',
      uid: target.uid,
      displacementKind: displacement.kind,
      from: fromPos,
      to: toPos,
      collided: preview.collidedWith,
      fallDrop: preview.fallDrop,
      iceSlid: preview.iceSlid
    })
  }

  if (preview.iceSlid) {
    state.vfx.push({ kind: 'burst', style: 'frost', at: [toPos[0], toPos[1] + 0.2, toPos[2]], radius: 0.75 })
    pushFloat(battle, target.x, target.y + 0.72, target.z, 'ICE SLIDE!', '#9eeeff')
    appendCombatLog(battle, 'hazard', formatHazardLog({ kind: 'ice_slide', targetName: target.name }))
  }

  // Ledge fall damage
  if (preview.fallDmg > 0 && target.alive) {
    const fallRes = applyImpactDamage(state, target, preview.fallDmg, `FALL -${preview.fallDmg}`, '#ffb057', 0.42)
    targetDmgDealt += fallRes.hpDamage
    appendCombatLog(
      battle,
      'hazard',
      formatHazardLog({
        kind: 'fall',
        targetName: target.name,
        damage: fallRes.hpDamage,
        absorbed: fallRes.absorbed,
        detail: `${preview.fallDrop} lvl`
      })
    )
    battle.shake = Math.max(battle.shake, 0.30)
  }

  // Obstacle / Ledge / Unit collision damage & secondary effects
  if (preview.collisionDmg > 0 && target.alive) {
    const isLedgeStop = preview.collidedWith === 'void' || preview.collidedWith === 'water' || preview.collidedWith === 'lava'
    const impactLabel = isLedgeStop
      ? `LEDGE -${preview.collisionDmg}`
      : preview.collidedWith === 'unit'
        ? `CRASH -${preview.collisionDmg}`
        : `COLLIDE -${preview.collisionDmg}`
    const impactColor = isLedgeStop ? '#ff8b52' : '#ffa24d'

    const colRes = applyImpactDamage(state, target, preview.collisionDmg, impactLabel, impactColor, 0.24)
    targetDmgDealt += colRes.hpDamage
    appendCombatLog(
      battle,
      'hazard',
      formatHazardLog({
        kind: isLedgeStop ? 'ledge' : 'collision',
        targetName: target.name,
        damage: colRes.hpDamage,
        absorbed: colRes.absorbed,
        detail: preview.collidedUnitName ?? preview.collidedWith
      })
    )
    state.vfx.push({ kind: 'burst', style: 'gold', at: [toPos[0], toPos[1] + 0.55, toPos[2]], radius: 0.9 })

    if (target.alive) {
      if (preview.causesStun) {
        target.stunTurns = Math.max(target.stunTurns, 1)
        pushFloat(battle, target.x, target.y + 0.68, target.z, 'STUN!', '#ffe88a')
        appendCombatLog(battle, 'status', formatStatusLog({ targetName: target.name, status: 'stun', phase: 'apply' }))
      }
      if (preview.causesSlow) {
        target.slowTurns = Math.max(target.slowTurns, 2)
        pushFloat(battle, target.x, target.y + 0.92, target.z, 'SLOW!', '#8ce8ff')
        appendCombatLog(battle, 'status', formatStatusLog({ targetName: target.name, status: 'slow', phase: 'apply' }))
      }
      if (preview.collidedWith === 'lava' && preview.causesBurn) {
        const lavaElem = classifyHazardElement('lava')
        if (lavaElem) {
          const comboRes = triggerElementalCombo(state, null, lavaElem, target, target.col, target.row, defeatDisplacedUnit)
          if (comboRes) targetDmgDealt += comboRes.totalDamageDealt
        }
        if (target.alive) {
          target.burnTurns = Math.max(target.burnTurns, 2)
          pushFloat(battle, target.x, target.y + 1.12, target.z, 'BURN!', '#ff7a38')
          appendCombatLog(battle, 'status', formatStatusLog({ targetName: target.name, status: 'burn', phase: 'apply' }))
        }
      }
    }

    if (preview.collidedWith === 'unit' && preview.collidedUnitUid && preview.secondaryCollisionDmg > 0) {
      const blocker = battle.units.find(u => u.uid === preview.collidedUnitUid && u.alive)
      if (blocker) {
        const secRes = applyImpactDamage(
          state,
          blocker,
          preview.secondaryCollisionDmg,
          `CRASH -${preview.secondaryCollisionDmg}`,
          '#ffa24d',
          0.24
        )
        secondaryDmgDealt += secRes.hpDamage
        appendCombatLog(
          battle,
          'hazard',
          formatHazardLog({
            kind: 'collision',
            targetName: blocker.name,
            damage: secRes.hpDamage,
            absorbed: secRes.absorbed,
            detail: target.name
          })
        )
      }
    } else if (preview.collidedWith === 'barricade' && preview.collidedCell && preview.barricadeDmg > 0) {
      const barRes = applyBarricadeCollision(state, preview.collidedCell.col, preview.collidedCell.row, preview.barricadeDmg)
      barricadeDmgDealt = barRes.dealt
      barricadeShattered = barRes.shattered
      if (barRes.dealt > 0) {
        appendCombatLog(
          battle,
          'hazard',
          formatHazardLog({
            kind: barRes.shattered ? 'barricade_smash' : 'barricade_hit',
            actorName: target.name,
            damage: barRes.dealt
          })
        )
      }
    }
  }

  // Landing tile hazard combo (erupting Lava Geyser / unused Cursed Altar)
  if (target.alive) {
    const landCell = battle.cells[target.row][target.col]
    targetDmgDealt += triggerLandingHazard(state, target, landCell, preview.moved)
  }

  return {
    preview,
    moved: preview.moved,
    targetDmgDealt,
    secondaryDmgDealt,
    barricadeDmgDealt,
    barricadeShattered
  }
}

/**
 * Deterministic ordering for multi-target AoE forced movement so pushed units clear tiles
 * for trailing units (farthest-first on knockback, closest-first on pull).
 */
export function orderDisplacementTargets(
  targets: readonly BattleUnit[],
  originCol: number,
  originRow: number,
  kind: DisplacementKind
): BattleUnit[] {
  const copy = [...targets]
  copy.sort((a, b) => {
    const da = Math.abs(a.col - originCol) + Math.abs(a.row - originRow)
    const db = Math.abs(b.col - originCol) + Math.abs(b.row - originRow)
    return kind === 'pull' ? da - db : db - da
  })
  return copy
}
