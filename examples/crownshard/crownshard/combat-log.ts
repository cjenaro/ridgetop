import type {
  AttackArc,
  BattleState,
  CombatLogCategory,
  CombatLogEntry,
  ElementalComboId,
  StatusKind
} from './types.ts'

export type { CombatLogCategory, CombatLogEntry }

export const MAX_COMBAT_LOG_ENTRIES = 60

export const COMBAT_LOG_CATEGORIES: readonly CombatLogCategory[] = [
  'attack',
  'crit',
  'heal',
  'status',
  'combo',
  'reaction',
  'hazard',
  'ko',
  'system'
]

export const COMBAT_LOG_ACCENT: Readonly<Record<CombatLogCategory, string>> = {
  attack: '#ff8b78',
  crit: '#ffe16b',
  heal: '#5ef29b',
  status: '#c496ff',
  combo: '#6ef0ff',
  reaction: '#ffaa44',
  hazard: '#ff7a45',
  ko: '#ff5266',
  system: '#9cb5eb'
}

const CATEGORY_LOOKUP: ReadonlyMap<string, CombatLogCategory> = new Map(
  COMBAT_LOG_CATEGORIES.map(c => [c, c])
)

const STATUS_LABEL: Readonly<Record<StatusKind, string>> = {
  burn: 'Burn',
  poison: 'Poison',
  stun: 'Stun',
  slow: 'Slow',
  taunt: 'Taunt',
  haste: 'Haste',
  empower: 'Empower'
}

export interface AppendCombatLogOptions {
  readonly turn?: number
  readonly accentHex?: string
}

export interface DamageLogOptions {
  readonly attackerName?: string | null
  readonly targetName: string
  readonly hpDamage: number
  readonly absorbed?: number
  readonly isCrit?: boolean
  readonly attackArc?: AttackArc
  readonly skillName?: string | null
  readonly friendlyFire?: boolean
  readonly verb?: string
}

export interface HealLogOptions {
  readonly sourceName?: string | null
  readonly targetName: string
  readonly healAmount?: number
  readonly shieldAmount?: number
  readonly revived?: boolean
  readonly sourceLabel?: string | null
}

export interface StatusLogOptions {
  readonly targetName: string
  readonly status: StatusKind
  readonly phase: 'apply' | 'tick' | 'stun_skip'
  readonly damage?: number
  readonly absorbed?: number
  readonly stacks?: number
  readonly sourceName?: string | null
}

export interface ComboLogOptions {
  readonly actorName?: string | null
  readonly combo: ElementalComboId
  readonly targetName?: string | null
  readonly bonusDamage?: number
  readonly tileCount?: number
}

export interface ReactionLogOptions {
  readonly kind: 'counter' | 'pincer' | 'opportunity'
  readonly actorName: string
  readonly targetName: string
  readonly hpDamage: number
  readonly absorbed?: number
  readonly aegisBonus?: boolean
}

export interface HazardLogOptions {
  readonly kind:
    | 'lava_geyser'
    | 'cursed_altar'
    | 'barricade_hit'
    | 'barricade_smash'
    | 'shrine'
    | 'collision'
    | 'ledge'
    | 'fall'
    | 'ice_slide'
    | 'swap'
  readonly targetName?: string
  readonly actorName?: string | null
  readonly damage?: number
  readonly absorbed?: number
  readonly healAmount?: number
  readonly detail?: string
}

export interface KoLogOptions {
  readonly unitName: string
  readonly kind: 'ko' | 'downed' | 'countdown' | 'fallen'
  readonly countdown?: number
  readonly isBoss?: boolean
}

function isBeneficialStatusKind(status: StatusKind): boolean {
  return status === 'empower' || status === 'taunt' || status === 'haste'
}

/**
 * Append a structured entry to the battle's bounded combat log ring buffer (max 60 entries).
 */
export function appendCombatLog(
  battle: Pick<BattleState, 'combatLog' | 'nextLogId' | 'turn'>,
  category: CombatLogCategory,
  text: string,
  opts?: AppendCombatLogOptions
): CombatLogEntry {
  const cleanText = text.trim()
  const turn = Math.max(0, Math.floor(opts?.turn ?? battle.turn))
  const id = Math.max(1, Math.floor(battle.nextLogId || 1))
  battle.nextLogId = id + 1
  const accentHex = opts?.accentHex ?? COMBAT_LOG_ACCENT[category]
  const entry: CombatLogEntry = {
    id,
    turn,
    category,
    text: cleanText.length > 0 ? cleanText : '...',
    accentHex
  }
  battle.combatLog.push(entry)
  while (battle.combatLog.length > MAX_COMBAT_LOG_ENTRIES) {
    battle.combatLog.shift()
  }
  return entry
}

/** Render a single-line plain-text summary including turn tag (e.g. `T2 · Aldric hits Goblin for 24`). */
export function formatCombatLogLine(entry: Pick<CombatLogEntry, 'turn' | 'text'>): string {
  return `T${Math.max(0, Math.floor(entry.turn))} · ${entry.text}`
}

/** Format a basic attack, hero skill, enemy special, or tactic damage/block event. */
export function formatDamageLog(opts: DamageLogOptions): string {
  const hpDamage = Math.max(0, Math.round(opts.hpDamage))
  const absorbed = Math.max(0, Math.round(opts.absorbed ?? 0))
  const attacker = opts.attackerName?.trim() || null
  const skill = opts.skillName?.trim() || null

  if (hpDamage === 0 && absorbed > 0) {
    const tags: string[] = []
    if (skill) tags.push(skill)
    tags.push('Shield')
    return `${opts.targetName} blocks ${absorbed} (${tags.join(', ')})`
  }

  if (hpDamage === 0) {
    const label = skill ? ` (${skill})` : ''
    return attacker
      ? `${attacker} deals 0 to ${opts.targetName}${label}`
      : `${opts.targetName} takes 0 dmg${label}`
  }

  const tags: string[] = []
  if (skill) tags.push(skill)
  if (opts.attackArc === 'back') tags.push('Backstab')
  else if (opts.attackArc === 'flank') tags.push('Flank')
  if (opts.isCrit) tags.push('CRIT!')
  if (absorbed > 0) tags.push(`-${absorbed} Shd`)
  if (opts.friendlyFire) tags.push('Ally Hit')
  const suffix = tags.length > 0 ? ` (${tags.join(', ')})` : ''
  const verb = opts.verb ?? 'hits'

  if (attacker) {
    return `${attacker} ${verb} ${opts.targetName} for ${hpDamage}${suffix}`
  }
  return `${opts.targetName} takes ${hpDamage}${suffix}`
}

/** Format a heal, shield grant, lifesteal, or hero revive event. */
export function formatHealLog(opts: HealLogOptions): string {
  const heal = Math.max(0, Math.round(opts.healAmount ?? 0))
  const shield = Math.max(0, Math.round(opts.shieldAmount ?? 0))
  const source = opts.sourceName?.trim() || null
  const label = opts.sourceLabel?.trim() || null

  if (opts.revived) {
    const parts: string[] = [`+${heal} HP`]
    if (shield > 0) parts.push(`+${shield} Shd`)
    const actor = source ?? label ?? 'Tactic'
    return `${actor} revives ${opts.targetName} (${parts.join(', ')})`
  }

  const parts: string[] = []
  if (heal > 0) parts.push(`+${heal} HP`)
  if (shield > 0) parts.push(`+${shield} Shd`)
  const gainText = parts.length > 0 ? parts.join(', ') : '+0 HP'
  const labelSuffix = label ? ` · ${label}` : ''

  if (source && source === opts.targetName) {
    if (heal > 0 && shield === 0) {
      return `${opts.targetName} heals +${heal} HP${label ? ` (${label})` : ''}`
    }
    if (shield > 0 && heal === 0) {
      return `${opts.targetName} gains +${shield} Shd${label ? ` (${label})` : ''}`
    }
    return `${opts.targetName} restores ${gainText}${label ? ` (${label})` : ''}`
  }

  if (source) {
    const verb = heal > 0 ? 'heals' : 'shields'
    return `${source} ${verb} ${opts.targetName} (${gainText}${labelSuffix})`
  }

  return `${opts.targetName} gains ${gainText}${label ? ` (${label})` : ''}`
}

/** Format a status application, periodic Burn/Poison tick, or Stun turn skip. */
export function formatStatusLog(opts: StatusLogOptions): string {
  const label = STATUS_LABEL[opts.status]
  if (opts.phase === 'stun_skip') {
    return `${opts.targetName} is Stunned — turn skipped`
  }
  if (opts.phase === 'tick') {
    const dmg = Math.max(0, Math.round(opts.damage ?? 0))
    const absorbed = Math.max(0, Math.round(opts.absorbed ?? 0))
    if (dmg === 0 && absorbed > 0) {
      return `${opts.targetName} blocks ${absorbed} ${label} (Shield)`
    }
    return `${opts.targetName} takes ${dmg} ${label} dmg`
  }
  const stackSuffix = opts.status === 'poison' && (opts.stacks ?? 0) > 0
    ? ` x${Math.round(opts.stacks ?? 1)}`
    : ''
  if (isBeneficialStatusKind(opts.status)) {
    return `${opts.targetName} gains ${label}${stackSuffix}`
  }
  if (opts.sourceName?.trim()) {
    return `${opts.sourceName.trim()} inflicts ${label}${stackSuffix} on ${opts.targetName}`
  }
  return `${opts.targetName} afflicted with ${label}${stackSuffix}`
}

/** Format an elemental reaction combo (`SHATTER`, `FREEZE`, `WILDFIRE`, `COMBUST`). */
export function formatComboLog(opts: ComboLogOptions): string {
  const actor = opts.actorName?.trim() || 'Hazard'
  const target = opts.targetName?.trim() || null
  const dmg = Math.max(0, Math.round(opts.bonusDamage ?? 0))

  if (opts.combo === 'shatter') {
    return `${actor} triggers SHATTER${target ? ` on ${target}` : ''} (+${dmg})`
  }
  if (opts.combo === 'freeze') {
    return `${actor} triggers FREEZE${target ? ` on ${target}` : ''} (+${dmg}, Stun)`
  }
  if (opts.combo === 'combust') {
    return `${actor} triggers COMBUST${target ? ` on ${target}` : ''} (+${dmg})`
  }
  const tiles = Math.max(1, Math.round(opts.tileCount ?? 1))
  return `${actor} ignites WILDFIRE (${tiles} tile${tiles === 1 ? '' : 's'}${dmg > 0 ? `, ${dmg} dmg` : ''})`
}

/** Format a Counter-Attack, Pincer Assist, or Opportunity Attack reaction. */
export function formatReactionLog(opts: ReactionLogOptions): string {
  const dmg = Math.max(0, Math.round(opts.hpDamage))
  const absorbed = Math.max(0, Math.round(opts.absorbed ?? 0))
  const shdNote = absorbed > 0 ? ` (-${absorbed} Shd)` : ''

  if (opts.kind === 'counter') {
    if (dmg === 0 && absorbed > 0) {
      return `${opts.targetName} blocks ${opts.actorName}'s counter (${absorbed} Shd)`
    }
    const verb = opts.aegisBonus ? 'aegis-counters' : 'counters'
    return `${opts.actorName} ${verb} ${opts.targetName} for ${dmg}${shdNote}`
  }

  if (opts.kind === 'pincer') {
    if (dmg === 0 && absorbed > 0) {
      return `${opts.targetName} blocks ${opts.actorName}'s pincer (${absorbed} Shd)`
    }
    return `${opts.actorName} pincer-strikes ${opts.targetName} for ${dmg}${shdNote}`
  }

  if (dmg === 0 && absorbed > 0) {
    return `${opts.targetName} blocks OA from ${opts.actorName} (${absorbed} Shd)`
  }
  return `${opts.targetName} OA-struck by ${opts.actorName} for ${dmg}${shdNote}`
}

/** Format a terrain hazard, barricade smash, shrine heal, fall, or displacement collision event. */
export function formatHazardLog(opts: HazardLogOptions): string {
  const dmg = Math.max(0, Math.round(opts.damage ?? 0))
  const absorbed = Math.max(0, Math.round(opts.absorbed ?? 0))
  const target = opts.targetName?.trim() || 'Unit'
  const actor = opts.actorName?.trim() || null
  const detail = opts.detail?.trim() || null

  switch (opts.kind) {
    case 'lava_geyser':
      if (dmg === 0 && absorbed > 0) {
        return `${target} blocks Lava Geyser (${absorbed} Shd)`
      }
      return `${target} scorched by Lava Geyser for ${dmg}`
    case 'cursed_altar':
      return `${target} claims Cursed Altar (-${dmg} HP, +Empower${detail ? `, ${detail}` : ''})`
    case 'barricade_hit':
      return `${actor ? `${actor} hits` : 'Impact hits'} Barricade (-${dmg} HP)`
    case 'barricade_smash':
      return `${actor ? `${actor} smashes` : 'Impact smashes'} Barricade!`
    case 'shrine': {
      const heal = Math.max(0, Math.round(opts.healAmount ?? 0))
      return `${target} blessed by Sun Shrine (+${heal} HP)`
    }
    case 'collision':
      if (dmg === 0 && absorbed > 0) {
        return `${target} blocks ${detail ?? 'collision'} impact (${absorbed} Shd)`
      }
      return `${target} crashes into ${detail ?? 'obstacle'} for ${dmg}`
    case 'ledge':
      if (dmg === 0 && absorbed > 0) {
        return `${target} blocks ${detail ?? 'ledge'} slam (${absorbed} Shd)`
      }
      return `${target} slammed against ${detail ?? 'ledge'} for ${dmg}`
    case 'fall':
      if (dmg === 0 && absorbed > 0) {
        return `${target} blocks fall damage (${absorbed} Shd)`
      }
      return `${target} takes ${dmg} fall dmg${detail ? ` (${detail})` : ''}`
    case 'ice_slide':
      return `${target} slides across Ice Sheet`
    case 'swap':
      return `${actor ?? 'Caster'} swaps positions with ${target}`
  }
}

/** Format a KO, ally downed state, KO countdown tick, or permanent fallen event. */
export function formatKoLog(opts: KoLogOptions): string {
  if (opts.kind === 'downed') {
    return `${opts.unitName} downed! (KO in ${Math.max(1, Math.round(opts.countdown ?? 3))})`
  }
  if (opts.kind === 'countdown') {
    return `${opts.unitName} KO countdown: ${Math.max(1, Math.round(opts.countdown ?? 1))}...`
  }
  if (opts.kind === 'fallen') {
    return `${opts.unitName} has fallen!`
  }
  return `${opts.unitName}${opts.isBoss ? ' (Boss)' : ''} defeated!`
}

/** Compute the maximum valid scroll-up offset for a log of `totalEntries` with `visibleRows`. */
export function getMaxCombatLogScroll(totalEntries: number, visibleRows: number): number {
  const safeRows = Math.max(1, Math.floor(visibleRows))
  return Math.max(0, Math.max(0, Math.floor(totalEntries)) - safeRows)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Return up to `limit` entries from the combat log.
 * `scrollOffset = 0` pins to the most recent entries; higher offsets scroll upward into older history.
 */
export function getRecentCombatLog(
  source: Pick<BattleState, 'combatLog'> | readonly CombatLogEntry[],
  limit = 8,
  scrollOffset = 0
): CombatLogEntry[] {
  const entries = 'combatLog' in source ? source.combatLog : source
  const safeLimit = Math.max(1, Math.floor(limit))
  if (entries.length === 0) return []
  const maxScroll = getMaxCombatLogScroll(entries.length, safeLimit)
  const clampedScroll = Math.max(0, Math.min(maxScroll, Math.floor(scrollOffset)))
  const end = entries.length - clampedScroll
  const start = Math.max(0, end - safeLimit)
  return entries.slice(start, end)
}

/** Validate and sanitize persisted combat log entries from a battle save snapshot. */
export function sanitizeCombatLogEntries(raw: unknown): CombatLogEntry[] {
  if (!Array.isArray(raw)) return []
  const out: CombatLogEntry[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const category = typeof item.category === 'string' ? CATEGORY_LOOKUP.get(item.category) : undefined
    if (!category) continue
    if (typeof item.id !== 'number' || !Number.isFinite(item.id) || item.id < 1) continue
    if (typeof item.turn !== 'number' || !Number.isFinite(item.turn) || item.turn < 0) continue
    if (typeof item.text !== 'string' || item.text.trim().length === 0) continue
    const accentHex = typeof item.accentHex === 'string' && item.accentHex.trim().length > 0
      ? item.accentHex.trim()
      : COMBAT_LOG_ACCENT[category]
    out.push({
      id: Math.floor(item.id),
      turn: Math.floor(item.turn),
      category,
      text: item.text.trim(),
      accentHex
    })
  }
  if (out.length > MAX_COMBAT_LOG_ENTRIES) {
    return out.slice(out.length - MAX_COMBAT_LOG_ENTRIES)
  }
  return out
}
