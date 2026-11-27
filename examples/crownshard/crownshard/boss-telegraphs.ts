import type { EnemySpecialDecision } from './enemy-archetypes.ts'
import type {
  BattleState,
  BattleUnit,
  BossTelegraphElement,
  BossTelegraphZone,
  ElementKind,
  EnemyArchetypeId,
  GridCoord,
  StatusKind
} from './types.ts'

/**
 * Pure domain module for Boss 50% HP Phase Shifts and 1-turn-ahead AoE Telegraphs.
 * Zero browser globals, no non-const `as` casts, and Godot-compiler-compatible.
 */

export const BOSS_PHASE2_HP_RATIO = 0.5
export const BOSS_TELEGRAPH_AUTO_AVOID_PENALTY = 150

export type BossTelegraphPattern = 'cross' | 'area3' | 'cross2'

export interface BossPhaseShiftSpec {
  readonly phase: 2
  readonly subtitle: string
  readonly bannerText: string
  readonly element: BossTelegraphElement
  readonly shieldRatio: number
  readonly shieldCap: number
  readonly atkBonusRatio: number
  readonly empowerTurns: number
  readonly hasteTurns: number
}

export interface BossPhaseShiftResult {
  readonly triggered: boolean
  readonly newPhase: number
  readonly shieldGain: number
  readonly atkBonus: number
  readonly subtitle: string
  readonly bannerText: string
  readonly element: BossTelegraphElement
}

export interface BossTelegraphPlan {
  readonly moveId: string
  readonly label: string
  readonly element: BossTelegraphElement
  readonly pattern: BossTelegraphPattern
  readonly damageMul: number
  readonly flatDamage: number
  readonly status?: StatusKind
  readonly cooldownSlot: 0 | 2
  readonly cooldownTurns: number
  readonly phase: number
  readonly vfxMove: 'eclipse_nova' | 'frostwyrm_breath' | 'titan_slam'
}

export interface BossTelegraphHudSummary {
  readonly count: number
  readonly tileCount: number
  readonly text: string
  readonly element: BossTelegraphElement
  readonly urgent: boolean
}

const VALID_TELEGRAPH_ELEMENTS: readonly BossTelegraphElement[] = ['shadow', 'fire', 'frost', 'holy', 'arcane']
const VALID_STATUS_KINDS: readonly StatusKind[] = ['burn', 'slow', 'stun', 'empower', 'taunt', 'haste', 'poison']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isTelegraphElement(v: unknown): v is BossTelegraphElement {
  return typeof v === 'string' && VALID_TELEGRAPH_ELEMENTS.some(el => el === v)
}

function isStatusKind(v: unknown): v is StatusKind {
  return typeof v === 'string' && VALID_STATUS_KINDS.some(st => st === v)
}

/** Resolve the Phase II awakening title, element, and buff profile for any boss. */
export function getBossPhaseShiftSpec(
  unit: Pick<BattleUnit, 'name' | 'enemyId'>
): BossPhaseShiftSpec {
  const eid = unit.enemyId
  let subtitle = 'Enraged Awakening'
  let element: BossTelegraphElement = 'shadow'

  if (eid === 'eclipse_archon') {
    subtitle = 'Eclipse Unleashed'
    element = 'shadow'
  } else if (eid === 'frostwyrm_rimefang') {
    subtitle = 'Permafrost Fury'
    element = 'frost'
  } else if (eid === 'ignis_titan') {
    subtitle = 'Caldera Overdrive'
    element = 'fire'
  } else if (eid === 'lich_vaelen') {
    subtitle = 'Soul Harvest'
    element = 'shadow'
  } else if (eid === 'dune_sovereign_boss') {
    subtitle = 'Tempest of Sands'
    element = 'fire'
  } else if (eid === 'astral_warden_boss') {
    subtitle = 'Starfall Convergence'
    element = 'arcane'
  } else if (eid === 'briar_warlord') {
    subtitle = 'Thornborn Rampage'
    element = 'fire'
  } else if (eid === 'mire_matriarch') {
    subtitle = 'Blight Sovereign'
    element = 'shadow'
  } else if (eid === 'ash_inquisitor') {
    subtitle = 'Ashen Reckoning'
    element = 'fire'
  } else if (eid === 'frost_jarl') {
    subtitle = "Winter's Wrath"
    element = 'frost'
  } else if (eid === 'magma_warden') {
    subtitle = 'Molten Core'
    element = 'fire'
  } else if (eid === 'unbroken_crown_boss') {
    subtitle = 'Solar Eclipse Awakening'
    element = 'holy'
  }

  return {
    phase: 2,
    subtitle,
    bannerText: `${unit.name} enters Phase II — ${subtitle}!`,
    element,
    shieldRatio: 0.22,
    shieldCap: 55,
    atkBonusRatio: 0.15,
    empowerTurns: 2,
    hasteTurns: 2
  }
}

/**
 * True when a generic boss (any `isBoss` enemy other than `unbroken_crown_boss`,
 * which uses its bespoke frontier awakening) is alive, in Phase 1, and at <= 50% HP.
 */
export function shouldTriggerBossPhaseShift(
  unit: Pick<BattleUnit, 'alive' | 'isBoss' | 'enemyId' | 'hp' | 'maxHp' | 'bossPhase'>
): boolean {
  if (!unit.alive || !unit.isBoss) return false
  if (unit.enemyId === 'unbroken_crown_boss') return false
  const currentPhase = unit.bossPhase ?? 1
  if (currentPhase >= 2) return false
  const threshold = Math.floor(unit.maxHp * BOSS_PHASE2_HP_RATIO)
  return unit.hp <= threshold
}

/**
 * Apply the Phase 1 -> Phase 2 escalation directly to `unit`.
 * Idempotent: once `bossPhase >= 2`, returns `{ triggered: false, ... }`.
 */
export function applyBossPhaseShift(unit: BattleUnit): BossPhaseShiftResult {
  const spec = getBossPhaseShiftSpec(unit)
  if (!shouldTriggerBossPhaseShift(unit)) {
    return {
      triggered: false,
      newPhase: unit.bossPhase ?? 1,
      shieldGain: 0,
      atkBonus: 0,
      subtitle: '',
      bannerText: '',
      element: spec.element
    }
  }

  const shieldGain = Math.min(spec.shieldCap, Math.max(15, Math.round(unit.maxHp * spec.shieldRatio)))
  const atkBonus = Math.max(3, Math.round(unit.atk * spec.atkBonusRatio))

  unit.bossPhase = spec.phase
  unit.shield += shieldGain
  unit.atk += atkBonus
  unit.empowerTurns = Math.max(unit.empowerTurns, spec.empowerTurns)
  unit.hasteTurns = Math.max(unit.hasteTurns, spec.hasteTurns)
  unit.cooldowns[0] = 0
  unit.cooldowns[2] = 0

  return {
    triggered: true,
    newPhase: spec.phase,
    shieldGain,
    atkBonus,
    subtitle: spec.subtitle,
    bannerText: spec.bannerText,
    element: spec.element
  }
}

/** Map a boss archetype + move to a visual telegraph element palette. */
export function getBossTelegraphElement(
  enemyId?: EnemyArchetypeId,
  moveId?: string
): BossTelegraphElement {
  if (
    moveId === 'glacial_nova' ||
    moveId === 'frost_breath' ||
    enemyId === 'frostwyrm_rimefang' ||
    enemyId === 'frost_jarl'
  ) {
    return 'frost'
  }
  if (moveId === 'tempest_surge' || enemyId === 'astral_warden_boss') {
    return 'arcane'
  }
  if (moveId === 'solar_corona' || enemyId === 'unbroken_crown_boss') {
    return 'holy'
  }
  if (
    moveId === 'magma_slam' ||
    moveId === 'magma_eruption' ||
    moveId === 'cataclysm_slam' ||
    moveId === 'warlord_slam' ||
    moveId === 'sandstorm_vortex' ||
    moveId === 'ash_nova' ||
    enemyId === 'ignis_titan' ||
    enemyId === 'magma_warden' ||
    enemyId === 'briar_warlord' ||
    enemyId === 'dune_sovereign_boss' ||
    enemyId === 'ash_inquisitor'
  ) {
    return 'fire'
  }
  return 'shadow'
}

/** Convert a telegraph element to a reactive combo ElementKind (when applicable). */
export function telegraphElementToComboElement(element: BossTelegraphElement): ElementKind | null {
  if (element === 'fire') return 'fire'
  if (element === 'frost') return 'frost'
  if (element === 'holy') return 'holy'
  if (element === 'arcane') return 'arcane'
  return null
}

/**
 * Compute playable danger cells for a boss AoE telegraph centered on `(centerCol, centerRow)`.
 * Excludes out-of-bounds cells, `'void'`, and `'pillar'` tiles.
 */
export function computeBossTelegraphCells(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  centerCol: number,
  centerRow: number,
  pattern: BossTelegraphPattern
): GridCoord[] {
  const raw: GridCoord[] = []
  if (pattern === 'area3') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        raw.push({ col: centerCol + dc, row: centerRow + dr })
      }
    }
  } else if (pattern === 'cross2') {
    raw.push({ col: centerCol, row: centerRow })
    for (let step = 1; step <= 2; step++) {
      raw.push({ col: centerCol + step, row: centerRow })
      raw.push({ col: centerCol - step, row: centerRow })
      raw.push({ col: centerCol, row: centerRow + step })
      raw.push({ col: centerCol, row: centerRow - step })
    }
  } else {
    raw.push(
      { col: centerCol, row: centerRow },
      { col: centerCol + 1, row: centerRow },
      { col: centerCol - 1, row: centerRow },
      { col: centerCol, row: centerRow + 1 },
      { col: centerCol, row: centerRow - 1 }
    )
  }

  const out: GridCoord[] = []
  const seen = new Set<string>()
  for (const c of raw) {
    if (c.col < 0 || c.col >= battle.cols || c.row < 0 || c.row >= battle.rows) continue
    const key = `${c.col},${c.row}`
    if (seen.has(key)) continue
    seen.add(key)
    const cell = battle.cells[c.row]?.[c.col]
    if (!cell || cell.terrain === 'void' || cell.terrain === 'pillar') continue
    out.push({ col: c.col, row: c.row })
  }
  return out
}

/** True when `casterUid` already has an active pending telegraph zone on the board. */
export function hasPendingBossTelegraph(
  battle: Pick<BattleState, 'bossTelegraphs'>,
  casterUid: string
): boolean {
  for (const tg of battle.bossTelegraphs) {
    if (tg.casterUid === casterUid) return true
  }
  return false
}

/**
 * True for bosses whose primary slot-0/slot-1 special resolves immediately (preserved for
 * Frostwyrm Breath, Ignis Cataclysm Slam, Lich Soul Nova), while still telegraphing their
 * secondary AoE catastrophe on alternating turns and in Phase 2.
 */
export function usesSecondaryTelegraphCadence(enemyId?: EnemyArchetypeId): boolean {
  return enemyId === 'frostwyrm_rimefang' || enemyId === 'ignis_titan' || enemyId === 'lich_vaelen'
}

/**
 * Choose a 1-turn-ahead telegraphed AoE plan for a boss when its signature AoE is ready.
 * Returns `null` if the boss already has a pending telegraph or should take a normal action.
 */
export function chooseBossTelegraphPlan(
  battle: Pick<BattleState, 'turn' | 'bossTelegraphs'>,
  boss: Pick<BattleUnit, 'uid' | 'isBoss' | 'enemyId' | 'bossPhase' | 'cooldowns'>,
  special: EnemySpecialDecision | null
): BossTelegraphPlan | null {
  if (!boss.isBoss) return null
  if (hasPendingBossTelegraph(battle, boss.uid)) return null

  const phase = (boss.bossPhase ?? 1) >= 2 ? 2 : 1
  const eid = boss.enemyId

  // Archon Malakor: replace old un-telegraphed Eclipse Nova with 1-turn-ahead telegraph!
  if (eid === 'eclipse_archon') {
    if (boss.cooldowns[2] > 0) return null
    return {
      moveId: phase >= 2 ? 'eclipse_cataclysm' : 'eclipse_nova',
      label: phase >= 2 ? 'Eclipse Cataclysm' : 'Eclipse Nova',
      element: 'shadow',
      pattern: phase >= 2 ? 'area3' : 'cross',
      damageMul: phase >= 2 ? 1.45 : 1.25,
      flatDamage: phase >= 2 ? 8 : 4,
      status: 'burn',
      cooldownSlot: 2,
      cooldownTurns: 2,
      phase,
      vfxMove: 'eclipse_nova'
    }
  }

  // Secondary-cadence raid bosses (Frostwyrm, Ignis Titan, Lich Vaelen): telegraph their
  // catastrophic AoE on alternating turns when their immediate special is on cooldown!
  if (usesSecondaryTelegraphCadence(eid)) {
    if (special !== null || boss.cooldowns[2] > 0) return null
    if (eid === 'frostwyrm_rimefang') {
      return {
        moveId: 'glacial_nova',
        label: phase >= 2 ? 'Permafrost Cataclysm' : 'Glacial Nova',
        element: 'frost',
        pattern: phase >= 2 ? 'area3' : 'cross',
        damageMul: phase >= 2 ? 1.40 : 1.22,
        flatDamage: phase >= 2 ? 8 : 4,
        status: 'slow',
        cooldownSlot: 2,
        cooldownTurns: phase >= 2 ? 2 : 3,
        phase,
        vfxMove: 'frostwyrm_breath'
      }
    }
    if (eid === 'ignis_titan') {
      return {
        moveId: 'magma_eruption',
        label: phase >= 2 ? 'Caldera Apocalypse' : 'Magma Eruption',
        element: 'fire',
        pattern: phase >= 2 ? 'area3' : 'cross',
        damageMul: phase >= 2 ? 1.45 : 1.25,
        flatDamage: phase >= 2 ? 8 : 4,
        status: 'burn',
        cooldownSlot: 2,
        cooldownTurns: phase >= 2 ? 2 : 3,
        phase,
        vfxMove: 'titan_slam'
      }
    }
    if (eid === 'lich_vaelen') {
      return {
        moveId: 'soul_rift',
        label: phase >= 2 ? 'Necrotic Maelstrom' : 'Soul Rift',
        element: 'shadow',
        pattern: phase >= 2 ? 'area3' : 'cross',
        damageMul: phase >= 2 ? 1.38 : 1.20,
        flatDamage: phase >= 2 ? 7 : 4,
        status: 'poison',
        cooldownSlot: 2,
        cooldownTurns: phase >= 2 ? 2 : 3,
        phase,
        vfxMove: 'eclipse_nova'
      }
    }
    return null
  }

  // All regional mini-bosses & Outer Frontier bosses telegraph their signature AoE 1 turn ahead!
  if (!special) return null
  const cleanLabel = special.label.replace(/!+$/, '')
  const titledLabel = cleanLabel
    .toLowerCase()
    .replace(/\b[a-z]/g, ch => ch.toUpperCase())
  const vfxMove: 'eclipse_nova' | 'frostwyrm_breath' | 'titan_slam' =
    special.vfxMove === 'frostwyrm_breath'
      ? 'frostwyrm_breath'
      : special.vfxMove === 'titan_slam'
        ? 'titan_slam'
        : 'eclipse_nova'
  const element = getBossTelegraphElement(eid, special.move)

  return {
    moveId: special.move,
    label: titledLabel,
    element,
    pattern: phase >= 2 ? 'area3' : 'cross',
    damageMul: special.powerMul + (phase >= 2 ? 0.18 : 0.05),
    flatDamage: phase >= 2 ? 7 : 3,
    status: special.status,
    cooldownSlot: 0,
    cooldownTurns: Math.max(2, special.cooldownTurns > 0 ? special.cooldownTurns : 2),
    phase,
    vfxMove
  }
}

/** Construct a deterministic `BossTelegraphZone` with `turnsRemaining = 1`. */
export function createBossTelegraphZone(
  battle: Pick<BattleState, 'turn' | 'bossTelegraphs'>,
  boss: Pick<BattleUnit, 'uid' | 'name'>,
  plan: BossTelegraphPlan,
  cells: readonly GridCoord[]
): BossTelegraphZone {
  const baseId = `tg_${boss.uid}_${battle.turn}_${plan.moveId}`
  let id = baseId
  let suffix = 2
  while (battle.bossTelegraphs.some(z => z.id === id)) {
    id = `${baseId}_${suffix}`
    suffix += 1
  }

  return {
    id,
    casterUid: boss.uid,
    casterName: boss.name,
    moveId: plan.moveId,
    label: plan.label,
    element: plan.element,
    cells: cells.map(c => ({ col: c.col, row: c.row })),
    damageMul: plan.damageMul,
    flatDamage: plan.flatDamage,
    ...(plan.status !== undefined ? { status: plan.status } : {}),
    turnsRemaining: 1,
    phase: plan.phase
  }
}

/** Immediately remove all pending telegraphs owned by `casterUid` (e.g. on KO or Stun interrupt). */
export function clearBossTelegraphsForCaster(
  battle: Pick<BattleState, 'bossTelegraphs'>,
  casterUid: string
): BossTelegraphZone[] {
  const removed: BossTelegraphZone[] = []
  for (let i = battle.bossTelegraphs.length - 1; i >= 0; i--) {
    const z = battle.bossTelegraphs[i]
    if (z.casterUid === casterUid) {
      removed.push(z)
      battle.bossTelegraphs.splice(i, 1)
    }
  }
  removed.reverse()
  return removed
}

/**
 * Tick all pending telegraphs for `casterUid` at the start of its turn.
 * Decrements `turnsRemaining` by 1 and removes + returns all zones whose countdown reached `<= 0`.
 */
export function collectDueBossTelegraphs(
  battle: Pick<BattleState, 'bossTelegraphs'>,
  casterUid: string
): BossTelegraphZone[] {
  const due: BossTelegraphZone[] = []
  for (let i = battle.bossTelegraphs.length - 1; i >= 0; i--) {
    const z = battle.bossTelegraphs[i]
    if (z.casterUid !== casterUid) continue
    z.turnsRemaining -= 1
    if (z.turnsRemaining <= 0) {
      due.push(z)
      battle.bossTelegraphs.splice(i, 1)
    }
  }
  due.reverse()
  return due
}

/** Return all active boss telegraph zones covering tile `(col, row)`. */
export function getTelegraphsAtCell(
  telegraphs: readonly BossTelegraphZone[],
  col: number,
  row: number
): BossTelegraphZone[] {
  const out: BossTelegraphZone[] = []
  for (const z of telegraphs) {
    for (const c of z.cells) {
      if (c.col === col && c.row === row) {
        out.push(z)
        break
      }
    }
  }
  return out
}

/** Count unique grid cells covered by active boss telegraph zones. */
export function countUniqueTelegraphTiles(telegraphs: readonly BossTelegraphZone[]): number {
  const seen = new Set<string>()
  for (const z of telegraphs) {
    for (const c of z.cells) {
      seen.add(`${c.col},${c.row}`)
    }
  }
  return seen.size
}

/** Highest `bossPhase` (1 or 2) among currently living bosses, or 0 if no living boss is present. */
export function getMaxLivingBossPhase(
  battle: Pick<BattleState, 'units'>
): number {
  let maxPhase = 0
  for (const u of battle.units) {
    if (!u.alive || !u.isBoss) continue
    const p = u.bossPhase ?? 1
    if (p > maxPhase) maxPhase = p
  }
  return maxPhase
}

/** Format a compact, mobile-friendly HUD warning banner summary for active boss telegraphs. */
export function formatBossTelegraphHudSummary(
  telegraphs: readonly BossTelegraphZone[],
  compact = false
): BossTelegraphHudSummary | null {
  if (telegraphs.length === 0) return null
  const totalTiles = countUniqueTelegraphTiles(telegraphs)
  const first = telegraphs[0]
  const urgent = telegraphs.some(z => z.turnsRemaining <= 1)

  if (telegraphs.length === 1) {
    const turnTag = first.turnsRemaining <= 1
      ? (compact ? 'Next Turn' : 'Next Boss Turn')
      : `${first.turnsRemaining}T`
    const tileTag = compact ? `${first.cells.length}T` : `${first.cells.length} tile${first.cells.length === 1 ? '' : 's'}`
    return {
      count: 1,
      tileCount: totalTiles,
      text: `⚠ ${first.label} · ${tileTag} · ${turnTag}`,
      element: first.element,
      urgent
    }
  }

  return {
    count: telegraphs.length,
    tileCount: totalTiles,
    text: compact
      ? `⚠ ${telegraphs.length} Boss AoEs · ${totalTiles}T · Dodge!`
      : `⚠ ${telegraphs.length} Boss Telegraphs · ${totalTiles} tiles · Dodge!`,
    element: first.element,
    urgent
  }
}

/** Deep-clone `BossTelegraphZone[]` for save snapshots and state restoration. */
export function cloneBossTelegraphs(
  telegraphs: readonly BossTelegraphZone[]
): BossTelegraphZone[] {
  return telegraphs.map(z => ({
    id: z.id,
    casterUid: z.casterUid,
    casterName: z.casterName,
    moveId: z.moveId,
    label: z.label,
    element: z.element,
    cells: z.cells.map(c => ({ col: c.col, row: c.row })),
    damageMul: z.damageMul,
    flatDamage: z.flatDamage,
    ...(z.status !== undefined ? { status: z.status } : {}),
    turnsRemaining: z.turnsRemaining,
    phase: z.phase
  }))
}

/**
 * Validate and sanitize optional `bossTelegraphs` from a serialized `BattleSaveSnapshot`.
 * Returns `undefined` when omitted (legacy save compatibility) and ignores malformed entries safely.
 */
export function validateBossTelegraphs(
  raw: unknown,
  cols: number,
  rows: number
): BossTelegraphZone[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return []

  const out: BossTelegraphZone[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || !item.id) continue
    if (typeof item.casterUid !== 'string' || !item.casterUid) continue
    if (typeof item.casterName !== 'string' || !item.casterName) continue
    if (typeof item.moveId !== 'string' || !item.moveId) continue
    if (typeof item.label !== 'string' || !item.label) continue
    if (!isTelegraphElement(item.element)) continue
    if (!Array.isArray(item.cells) || item.cells.length === 0) continue
    if (!isFiniteNum(item.damageMul) || item.damageMul <= 0) continue
    if (!isFiniteNum(item.flatDamage) || item.flatDamage < 0) continue
    if (!isFiniteNum(item.turnsRemaining) || item.turnsRemaining < 1) continue
    if (!isFiniteNum(item.phase) || item.phase < 1) continue
    if (item.status !== undefined && !isStatusKind(item.status)) continue

    const cells: GridCoord[] = []
    const seen = new Set<string>()
    for (const c of item.cells) {
      if (!isRecord(c) || !isFiniteNum(c.col) || !isFiniteNum(c.row)) continue
      const col = Math.floor(c.col)
      const row = Math.floor(c.row)
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue
      const key = `${col},${row}`
      if (seen.has(key)) continue
      seen.add(key)
      cells.push({ col, row })
    }
    if (cells.length === 0) continue

    out.push({
      id: item.id,
      casterUid: item.casterUid,
      casterName: item.casterName,
      moveId: item.moveId,
      label: item.label,
      element: item.element,
      cells,
      damageMul: Math.min(5, item.damageMul),
      flatDamage: Math.min(200, Math.floor(item.flatDamage)),
      ...(item.status !== undefined ? { status: item.status } : {}),
      turnsRemaining: Math.min(10, Math.floor(item.turnsRemaining)),
      phase: Math.min(4, Math.floor(item.phase))
    })
  }
  return out
}
