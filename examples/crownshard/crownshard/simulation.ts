import { nextRandom } from 'ridgetop'
import type { Vec3 } from 'ridgetop'
import {
  CHAPTERS, CHAPTER_BY_ID, ENEMY_SPECS, EQUIPMENT_BY_ID, EQUIPMENT_LIST, HERO_LIST, HERO_SPECS,
  MERGE_COPIES_REQUIRED, PACK_BY_ID, PLAYABLE_CHAPTERS, RARITY_META, RARITY_ORDER, TACTIC_BY_ID, TACTIC_LIST
} from './data.ts'
import {
  GRID_COLS, GRID_ROWS, facingToYaw, facingVector, gridToWorld, terrainElevation, terrainWalkable, vectorToFacing
} from './types.ts'
import type {
  AttackArc, BattleReward, BattleState, BattleUnit, BiomeId, CampaignState, ChapterSpec, CombatForecast,
  CombatForecastAlt, DifficultyLevel, EquipSlot, EquipmentSpec, FacingDir, GameState, GridCell, HeroClassId,
  MoveAttackTile, OwnedEquipCard, OwnedHeroCard, OwnedTacticCard, PackId, PackRevealItem, Rarity, SaveData,
  SkillSpec, TacticCardSpec, TileTerrain, TurnPreviewEntry
} from './types.ts'

export const SAVE_KEY = 'ridgetop.crownshard.save.v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface ComputedHeroStats {
  readonly maxHp: number
  readonly atk: number
  readonly def: number
  readonly speed: number
  readonly move: number
  readonly range: number
  readonly crit: number
  readonly lifesteal: number
  readonly shieldStart: number
  readonly powerScore: number
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function manhattan(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2)
}

function randFloat(campaign: CampaignState): number {
  const step = nextRandom(campaign.seed)
  campaign.seed = step.seed
  return step.value
}

function allocUid(campaign: CampaignState, prefix: string): string {
  const id = `${prefix}_${campaign.nextUid}`
  campaign.nextUid += 1
  return id
}

function rarityRank(r: Rarity): number {
  return RARITY_ORDER.indexOf(r)
}

export function isStageCleared(campaign: CampaignState, stageId: string): boolean {
  return campaign.clearedStageIds.includes(stageId)
}

export function isStageUnlocked(campaign: CampaignState, stageOrId: string | ChapterSpec): boolean {
  const stage = typeof stageOrId === 'string' ? CHAPTER_BY_ID[stageOrId] : stageOrId
  if (!stage || stage.comingSoon) return false
  if (stage.requires.length === 0) return true
  if (stage.unlockMode === 'any') {
    return stage.requires.some(reqId => isStageCleared(campaign, reqId))
  }
  return stage.requires.every(reqId => isStageCleared(campaign, reqId))
}

export function isEndlessUnlocked(campaign: CampaignState): boolean {
  return PLAYABLE_CHAPTERS.some(ch => ch.unlocksEndless && isStageCleared(campaign, ch.id))
}

export function getStageUnlockHint(stage: ChapterSpec): string {
  if (stage.comingSoon) return stage.soonNote ?? 'Coming Soon...'
  if (stage.requires.length === 0) return 'Available'
  const names = stage.requires.map(id => CHAPTER_BY_ID[id]?.title ?? id)
  if (names.length === 1) return `Clear ${names[0]} to unlock`
  const joiner = stage.unlockMode === 'any' ? ' or ' : ' and '
  return `Clear ${names.join(joiner)} to unlock`
}

export function getNextRecommendedStage(campaign: CampaignState): ChapterSpec {
  const unlockedUnclear = PLAYABLE_CHAPTERS.filter(ch => isStageUnlocked(campaign, ch) && !isStageCleared(campaign, ch.id))
  const storyNext = unlockedUnclear.find(ch => ch.kind === 'story' || ch.kind === 'boss')
  if (storyNext) return storyNext
  if (unlockedUnclear.length > 0) return unlockedUnclear[0]
  return PLAYABLE_CHAPTERS[PLAYABLE_CHAPTERS.length - 1]
}

export function computeSquadPower(campaign: CampaignState): number {
  let total = 0
  for (const uid of campaign.squadUids) {
    const hero = getHeroByUid(campaign, uid)
    if (hero) total += computeHeroStats(campaign, hero).powerScore
  }
  return total
}

export function maxSquadSize(campaign: CampaignState): number {
  const slot4Cleared = CHAPTERS.some(ch => ch.unlocksSlot4 && isStageCleared(campaign, ch.id))
  return slot4Cleared || campaign.chaptersCleared >= 2 ? 4 : 3
}

export function getEquipmentByUid(campaign: CampaignState, uid: string | null): OwnedEquipCard | undefined {
  if (!uid) return undefined
  return campaign.equipment.find(e => e.uid === uid)
}

export function getHeroByUid(campaign: CampaignState, uid: string | null): OwnedHeroCard | undefined {
  if (!uid) return undefined
  return campaign.heroes.find(h => h.uid === uid)
}

export function getTacticByUid(campaign: CampaignState, uid: string | null): OwnedTacticCard | undefined {
  if (!uid) return undefined
  return campaign.tactics.find(t => t.uid === uid)
}

export function findEquipOwner(campaign: CampaignState, equipUid: string): OwnedHeroCard | undefined {
  return campaign.heroes.find(
    h => h.weaponUid === equipUid || h.armorUid === equipUid || h.relicUid === equipUid
  )
}

export function computeHeroStats(campaign: CampaignState, hero: OwnedHeroCard): ComputedHeroStats {
  const spec = HERO_SPECS[hero.heroId]
  const hpMul = hero.stars === 3 ? 2.05 : hero.stars === 2 ? 1.48 : 1.0
  const atkMul = hero.stars === 3 ? 1.85 : hero.stars === 2 ? 1.38 : 1.0
  const defBonus = hero.stars === 3 ? 5 : hero.stars === 2 ? 2 : 0

  let maxHp = Math.round(spec.maxHp * hpMul)
  let atk = Math.round(spec.atk * atkMul)
  let def = spec.def + defBonus
  let speed = spec.speed + (hero.stars - 1)
  let move = spec.move
  let range = spec.range
  let crit = spec.crit
  let lifesteal = 0
  let shieldStart = 0

  const slots = [hero.weaponUid, hero.armorUid, hero.relicUid]
  for (const uid of slots) {
    const owned = getEquipmentByUid(campaign, uid)
    if (!owned) continue
    const item = EQUIPMENT_BY_ID[owned.equipId]
    if (!item) continue
    maxHp += item.hp
    atk += item.atk
    def += item.def
    speed += item.speed
    move += item.move
    range += item.range
    crit += item.crit
    lifesteal += item.lifesteal
    shieldStart += item.shieldStart
  }

  crit = clamp(crit, 0, 0.85)
  lifesteal = clamp(lifesteal, 0, 0.75)
  speed = clamp(speed, 4, 24)
  move = clamp(move, 2, 6)
  range = clamp(range, 1, 6)
  const powerScore = Math.round(maxHp * 0.6 + atk * 3.2 + def * 2.5 + speed * 4 + move * 6 + range * 5 + crit * 40 + hero.stars * 25)
  return { maxHp, atk, def, speed, move, range, crit, lifesteal, shieldStart, powerScore }
}

export function computeCardValue(rarity: Rarity, stars: 1 | 2 | 3 = 1): number {
  const base = RARITY_META[rarity].value
  if (stars === 3) return Math.round(base * 4.5)
  if (stars === 2) return Math.round(base * 2.4)
  return base
}

export function computeDeckValue(campaign: CampaignState): number {
  let total = 0
  for (const h of campaign.heroes) {
    const spec = HERO_SPECS[h.heroId]
    total += computeCardValue(spec.rarity, h.stars)
  }
  for (const e of campaign.equipment) {
    const spec = EQUIPMENT_BY_ID[e.equipId]
    if (spec) total += computeCardValue(spec.rarity)
  }
  for (const t of campaign.tactics) {
    const spec = TACTIC_BY_ID[t.tacticId]
    if (spec) total += computeCardValue(spec.rarity)
  }
  return total
}

export function getMergeCandidates(campaign: CampaignState, heroUid: string): OwnedHeroCard[] {
  const target = getHeroByUid(campaign, heroUid)
  if (!target || target.stars >= 3) return []
  const matching = campaign.heroes.filter(
    h => h.heroId === target.heroId && h.stars === target.stars && h.uid !== target.uid
  )
  // Prefer sacrificing non-squad, unequipped copies first
  matching.sort((a, b) => {
    const aSquad = campaign.squadUids.includes(a.uid) ? 1 : 0
    const bSquad = campaign.squadUids.includes(b.uid) ? 1 : 0
    if (aSquad !== bSquad) return aSquad - bSquad
    const aGear = (a.weaponUid ? 1 : 0) + (a.armorUid ? 1 : 0) + (a.relicUid ? 1 : 0)
    const bGear = (b.weaponUid ? 1 : 0) + (b.armorUid ? 1 : 0) + (b.relicUid ? 1 : 0)
    return aGear - bGear
  })
  return [target, ...matching]
}

export function canMergeHero(campaign: CampaignState, heroUid: string): boolean {
  const target = getHeroByUid(campaign, heroUid)
  if (!target || target.stars === 3) return false
  const required = target.stars === 1 ? MERGE_COPIES_REQUIRED[1] : MERGE_COPIES_REQUIRED[2]
  return getMergeCandidates(campaign, heroUid).length >= required
}

export function mergeHero(state: GameState, heroUid: string): boolean {
  const { campaign } = state
  const target = getHeroByUid(campaign, heroUid)
  if (!target || target.stars === 3) return false
  const required = target.stars === 1 ? MERGE_COPIES_REQUIRED[1] : MERGE_COPIES_REQUIRED[2]
  const candidates = getMergeCandidates(campaign, heroUid)
  if (candidates.length < required) return false

  const sacrifices = candidates.slice(1, required)
  const sacrificeSet = new Set(sacrifices.map(s => s.uid))

  // Remove sacrificed copies (their equipment automatically stays in campaign.equipment, unequipped)
  campaign.heroes = campaign.heroes.filter(h => !sacrificeSet.has(h.uid))
  campaign.squadUids = campaign.squadUids.filter(uid => !sacrificeSet.has(uid))

  // Upgrade star tier (unlocking the next skill!)
  target.stars = target.stars === 1 ? 2 : 3
  if (!campaign.squadUids.includes(target.uid) && campaign.squadUids.length < maxSquadSize(campaign)) {
    campaign.squadUids.push(target.uid)
  }
  state.sounds.push({ kind: 'merge' })
  return true
}

export function equipItem(state: GameState, heroUid: string, equipUid: string): boolean {
  const { campaign } = state
  const hero = getHeroByUid(campaign, heroUid)
  const item = getEquipmentByUid(campaign, equipUid)
  if (!hero || !item) return false

  // Remove from previous owner if equipped elsewhere
  const prevOwner = findEquipOwner(campaign, equipUid)
  if (prevOwner) {
    if (prevOwner.weaponUid === equipUid) prevOwner.weaponUid = null
    if (prevOwner.armorUid === equipUid) prevOwner.armorUid = null
    if (prevOwner.relicUid === equipUid) prevOwner.relicUid = null
  }

  if (item.slot === 'weapon') hero.weaponUid = item.uid
  else if (item.slot === 'armor') hero.armorUid = item.uid
  else hero.relicUid = item.uid

  state.sounds.push({ kind: 'equip' })
  return true
}

export function unequipItem(state: GameState, heroUid: string, slot: EquipSlot): boolean {
  const hero = getHeroByUid(state.campaign, heroUid)
  if (!hero) return false
  if (slot === 'weapon' && hero.weaponUid) { hero.weaponUid = null; state.sounds.push({ kind: 'card' }); return true }
  if (slot === 'armor' && hero.armorUid) { hero.armorUid = null; state.sounds.push({ kind: 'card' }); return true }
  if (slot === 'relic' && hero.relicUid) { hero.relicUid = null; state.sounds.push({ kind: 'card' }); return true }
  return false
}

/** Archetype-aware equipment fit score used by Best Fit auto-equip. */
export function scoreEquipmentForHero(heroId: HeroClassId, spec: EquipmentSpec): number {
  const rankBonus = rarityRank(spec.rarity) * 0.5
  if (heroId === 'knight' || heroId === 'paladin' || heroId === 'champion') {
    return (
      spec.hp * 1.15 +
      spec.def * 4.5 +
      spec.shieldStart * 1.6 +
      spec.atk * 3.0 +
      spec.speed * 2.4 +
      spec.move * 18 +
      spec.range * 22 +
      spec.crit * 70 +
      spec.lifesteal * 160 +
      rankBonus
    )
  }
  if (heroId === 'archer' || heroId === 'rogue') {
    return (
      spec.atk * 4.2 +
      spec.crit * 140 +
      spec.speed * 3.6 +
      spec.move * 18 +
      spec.range * 24 +
      spec.hp * 0.65 +
      spec.def * 2.0 +
      spec.shieldStart * 0.9 +
      spec.lifesteal * 110 +
      rankBonus
    )
  }
  return (
    spec.atk * 4.0 +
    spec.speed * 3.4 +
    spec.shieldStart * 1.5 +
    spec.crit * 100 +
    spec.hp * 0.95 +
    spec.def * 2.5 +
    spec.move * 15 +
    spec.range * 24 +
    spec.lifesteal * 90 +
    rankBonus
  )
}

/**
 * Find the best unequipped equipment upgrades for `heroUid` across weapon, armor, and relic slots.
 * Strictly ignores items equipped by any other hero and never downgrades an already-equipped slot.
 */
export function findBestFitUpgrades(campaign: CampaignState, heroUid: string): OwnedEquipCard[] {
  const hero = getHeroByUid(campaign, heroUid)
  if (!hero) return []

  const ownedByOther = new Set<string>()
  for (const h of campaign.heroes) {
    if (h.uid === hero.uid) continue
    if (h.weaponUid) ownedByOther.add(h.weaponUid)
    if (h.armorUid) ownedByOther.add(h.armorUid)
    if (h.relicUid) ownedByOther.add(h.relicUid)
  }

  const slots: readonly EquipSlot[] = ['weapon', 'armor', 'relic']
  const upgrades: OwnedEquipCard[] = []

  for (const slot of slots) {
    const currentUid = slot === 'weapon' ? hero.weaponUid : slot === 'armor' ? hero.armorUid : hero.relicUid
    const currentItem = getEquipmentByUid(campaign, currentUid)
    const currentSpec = currentItem ? EQUIPMENT_BY_ID[currentItem.equipId] : undefined
    const currentScore = currentSpec ? scoreEquipmentForHero(hero.heroId, currentSpec) : -1

    let bestItem: OwnedEquipCard | null = null
    let bestScore = currentScore
    for (const item of campaign.equipment) {
      if (item.slot !== slot) continue
      if (item.uid === currentUid || ownedByOther.has(item.uid)) continue
      const spec = EQUIPMENT_BY_ID[item.equipId]
      if (!spec) continue
      const score = scoreEquipmentForHero(hero.heroId, spec)
      if (score > bestScore) {
        bestScore = score
        bestItem = item
      }
    }
    if (bestItem) upgrades.push(bestItem)
  }

  return upgrades
}

/**
 * Auto-equip the best available unequipped gear onto `heroUid` without taking items from other heroes.
 * Returns the list of newly equipped items (empty if already wearing the best unequipped gear).
 */
export function autoEquipBestFit(state: GameState, heroUid: string): OwnedEquipCard[] {
  const hero = getHeroByUid(state.campaign, heroUid)
  if (!hero) return []
  const upgrades = findBestFitUpgrades(state.campaign, heroUid)
  if (upgrades.length === 0) return []

  for (const item of upgrades) {
    if (item.slot === 'weapon') hero.weaponUid = item.uid
    else if (item.slot === 'armor') hero.armorUid = item.uid
    else hero.relicUid = item.uid
  }
  state.sounds.push({ kind: 'equip' })
  return upgrades
}

export function toggleSquadMember(state: GameState, heroUid: string): boolean {
  const { campaign } = state
  const hero = getHeroByUid(campaign, heroUid)
  if (!hero) return false
  const idx = campaign.squadUids.indexOf(heroUid)
  if (idx >= 0) {
    if (campaign.squadUids.length <= 1) return false
    campaign.squadUids.splice(idx, 1)
    state.sounds.push({ kind: 'card' })
    return true
  }
  if (campaign.squadUids.length >= maxSquadSize(campaign)) return false
  campaign.squadUids.push(heroUid)
  state.sounds.push({ kind: 'equip' })
  return true
}

function rollRarity(campaign: CampaignState, weights: Record<Rarity, number>, minRarity: Rarity): Rarity {
  const minIdx = rarityRank(minRarity)
  let total = 0
  for (let i = minIdx; i < RARITY_ORDER.length; i++) {
    total += weights[RARITY_ORDER[i]]
  }
  let roll = randFloat(campaign) * total
  for (let i = minIdx; i < RARITY_ORDER.length; i++) {
    const r = RARITY_ORDER[i]
    roll -= weights[r]
    if (roll <= 0) return r
  }
  return RARITY_ORDER[minIdx]
}

function pickNearestByRarity<T extends { readonly rarity: Rarity }>(
  items: readonly T[],
  target: Rarity,
  campaign: CampaignState,
  minRarity?: Rarity
): T {
  const minRank = minRarity ? rarityRank(minRarity) : 0
  const eligible = items.filter(it => rarityRank(it.rarity) >= minRank)
  const pool = eligible.length ? eligible : items
  const exact = pool.filter(it => it.rarity === target)
  if (exact.length) {
    return exact[Math.floor(randFloat(campaign) * exact.length) % exact.length]
  }
  const tRank = rarityRank(target)
  let bestDist = 99
  let best: T[] = []
  for (const it of pool) {
    const d = Math.abs(rarityRank(it.rarity) - tRank)
    if (d < bestDist) { bestDist = d; best = [it] }
    else if (d === bestDist) best.push(it)
  }
  return best[Math.floor(randFloat(campaign) * best.length) % best.length]
}

export function canBuyPack(campaign: CampaignState, packId: PackId): boolean {
  return campaign.gold >= PACK_BY_ID[packId].cost
}

export function buyPack(state: GameState, packId: PackId): PackRevealItem[] | null {
  const { campaign } = state
  const pack = PACK_BY_ID[packId]
  if (campaign.gold < pack.cost) return null

  campaign.gold -= pack.cost
  campaign.packsOpened += 1

  const reveal: PackRevealItem[] = []
  let bestRarity: Rarity = 'common'

  for (let i = 0; i < pack.cardsPerPack; i++) {
    const floor: Rarity = i === 0 ? pack.guaranteedMinRarity : 'common'
    const rollWeights = i === 0 && pack.featuredWeights ? pack.featuredWeights : pack.weights
    const rarity = rollRarity(campaign, rollWeights, floor)
    if (rarityRank(rarity) > rarityRank(bestRarity)) bestRarity = rarity

    // Card 0 or ~48% Hero, ~32% Equipment, ~20% Tactic
    const kindRoll = randFloat(campaign)
    if (i === 1 || kindRoll < 0.48) {
      const heroSpec = pickNearestByRarity(HERO_LIST, rarity, campaign, floor)
      const isNew = !campaign.heroes.some(h => h.heroId === heroSpec.id)
      const card: OwnedHeroCard = {
        uid: allocUid(campaign, 'hero'),
        heroId: heroSpec.id,
        stars: 1,
        weaponUid: null,
        armorUid: null,
        relicUid: null
      }
      campaign.heroes.push(card)
      const copies = campaign.heroes.filter(h => h.heroId === heroSpec.id && h.stars === 1).length
      reveal.push({
        kind: 'hero',
        uid: card.uid,
        refId: heroSpec.id,
        name: `${heroSpec.name} (${heroSpec.title})`,
        rarity: heroSpec.rarity,
        detail: `Hero 1* · Copies: ${copies}/3`,
        value: computeCardValue(heroSpec.rarity, 1),
        isNew
      })
    } else if (kindRoll < 0.80) {
      const equipSpec: EquipmentSpec = pickNearestByRarity(EQUIPMENT_LIST, rarity, campaign, floor)
      const isNew = !campaign.equipment.some(e => e.equipId === equipSpec.id)
      const card: OwnedEquipCard = {
        uid: allocUid(campaign, 'eq'),
        equipId: equipSpec.id,
        slot: equipSpec.slot
      }
      campaign.equipment.push(card)
      reveal.push({
        kind: equipSpec.slot,
        uid: card.uid,
        refId: equipSpec.id,
        name: equipSpec.name,
        rarity: equipSpec.rarity,
        detail: `${equipSpec.slot.toUpperCase()} · ${equipSpec.desc}`,
        value: computeCardValue(equipSpec.rarity),
        isNew
      })
    } else {
      const tacticSpec: TacticCardSpec = pickNearestByRarity(TACTIC_LIST, rarity, campaign, floor)
      const isNew = !campaign.tactics.some(t => t.tacticId === tacticSpec.id)
      const card: OwnedTacticCard = {
        uid: allocUid(campaign, 'tac'),
        tacticId: tacticSpec.id
      }
      campaign.tactics.push(card)
      reveal.push({
        kind: 'tactic',
        uid: card.uid,
        refId: tacticSpec.id,
        name: tacticSpec.name,
        rarity: tacticSpec.rarity,
        detail: `TACTIC (${tacticSpec.cost} AP) · ${tacticSpec.desc}`,
        value: computeCardValue(tacticSpec.rarity),
        isNew
      })
    }
  }

  campaign.lastPackReveal = reveal
  state.sounds.push({ kind: 'pack', rarity: bestRarity })
  return reveal
}

export function salvageHeroCard(state: GameState, heroUid: string): number {
  const { campaign } = state
  const idx = campaign.heroes.findIndex(h => h.uid === heroUid)
  if (idx < 0 || campaign.heroes.length <= 1) return 0
  if (campaign.squadUids.includes(heroUid) && campaign.squadUids.length <= 1) return 0
  const hero = campaign.heroes[idx]
  const spec = HERO_SPECS[hero.heroId]
  const base = RARITY_META[spec.rarity].salvage
  const gold = hero.stars === 3 ? base * 4 : hero.stars === 2 ? base * 2 : base
  campaign.heroes.splice(idx, 1)
  campaign.squadUids = campaign.squadUids.filter(uid => uid !== heroUid)
  if (campaign.selectedCampHeroUid === heroUid) {
    campaign.selectedCampHeroUid = campaign.squadUids[0] ?? campaign.heroes[0]?.uid ?? null
  }
  campaign.gold += gold
  state.sounds.push({ kind: 'coin' })
  return gold
}

export function salvageEquipCard(state: GameState, equipUid: string): number {
  const { campaign } = state
  const idx = campaign.equipment.findIndex(e => e.uid === equipUid)
  if (idx < 0) return 0
  const item = campaign.equipment[idx]
  const spec = EQUIPMENT_BY_ID[item.equipId]
  if (!spec) return 0
  const owner = findEquipOwner(campaign, equipUid)
  if (owner) {
    if (owner.weaponUid === equipUid) owner.weaponUid = null
    if (owner.armorUid === equipUid) owner.armorUid = null
    if (owner.relicUid === equipUid) owner.relicUid = null
  }
  campaign.equipment.splice(idx, 1)
  const gold = RARITY_META[spec.rarity].salvage
  campaign.gold += gold
  state.sounds.push({ kind: 'coin' })
  return gold
}

export function createInitialCampaign(seed = 1337): CampaignState {
  const campaign: CampaignState = {
    seed: (seed >>> 0) || 1337,
    nextUid: 1,
    gold: 100,
    chaptersCleared: 0,
    clearedStageIds: [],
    selectedStageId: CHAPTERS[0].id,
    endlessBest: 0,
    battlesWon: 0,
    packsOpened: 0,
    heroes: [],
    equipment: [],
    tactics: [],
    squadUids: [],
    selectedCampHeroUid: null,
    lastPackReveal: []
  }

  const starterKnight: OwnedHeroCard = {
    uid: allocUid(campaign, 'hero'), heroId: 'knight', stars: 1,
    weaponUid: null, armorUid: null, relicUid: null
  }
  const starterArcher: OwnedHeroCard = {
    uid: allocUid(campaign, 'hero'), heroId: 'archer', stars: 1,
    weaponUid: null, armorUid: null, relicUid: null
  }
  const starterMage: OwnedHeroCard = {
    uid: allocUid(campaign, 'hero'), heroId: 'mage', stars: 1,
    weaponUid: null, armorUid: null, relicUid: null
  }
  campaign.heroes.push(starterKnight, starterArcher, starterMage)
  campaign.squadUids = [starterKnight.uid, starterArcher.uid, starterMage.uid]
  campaign.selectedCampHeroUid = starterKnight.uid

  const sword: OwnedEquipCard = { uid: allocUid(campaign, 'eq'), equipId: 'iron_sword', slot: 'weapon' }
  const bow: OwnedEquipCard = { uid: allocUid(campaign, 'eq'), equipId: 'hunter_bow', slot: 'weapon' }
  const leather: OwnedEquipCard = { uid: allocUid(campaign, 'eq'), equipId: 'leather_jerkin', slot: 'armor' }
  campaign.equipment.push(sword, bow, leather)
  starterKnight.weaponUid = sword.uid
  starterKnight.armorUid = leather.uid
  starterArcher.weaponUid = bow.uid

  const starterTactics = [
    'rally_banner', 'healing_draught', 'iron_ward',
    'flame_scroll', 'wind_step', 'healing_draught'
  ]
  for (const tid of starterTactics) {
    campaign.tactics.push({ uid: allocUid(campaign, 'tac'), tacticId: tid })
  }

  return campaign
}

export function createInitialState(seed = 1337, save?: SaveData | null): GameState {
  if (save && save.version === 1 && save.campaign && Array.isArray(save.campaign.heroes) && save.campaign.heroes.length > 0) {
    const c = save.campaign
    const rawCount = Number.isFinite(c.chaptersCleared) ? clamp(Math.floor(c.chaptersCleared), 0, PLAYABLE_CHAPTERS.length) : 0
    const clearedStageIds: string[] = Array.isArray(c.clearedStageIds)
      ? c.clearedStageIds.filter((id): id is string => typeof id === 'string' && Boolean(CHAPTER_BY_ID[id]) && !CHAPTER_BY_ID[id].comingSoon)
      : PLAYABLE_CHAPTERS.slice(0, rawCount).map(ch => ch.id)
    const dedupCleared = Array.from(new Set(clearedStageIds))
    const cloned: CampaignState = {
      seed: Number.isFinite(c.seed) ? (c.seed >>> 0) || 1337 : seed,
      nextUid: Number.isFinite(c.nextUid) && c.nextUid > 0 ? Math.floor(c.nextUid) : 100,
      gold: Number.isFinite(c.gold) && c.gold >= 0 ? Math.floor(c.gold) : 100,
      chaptersCleared: dedupCleared.length,
      clearedStageIds: dedupCleared,
      selectedStageId: typeof c.selectedStageId === 'string' && CHAPTER_BY_ID[c.selectedStageId]
        ? c.selectedStageId
        : CHAPTERS[0].id,
      endlessBest: Number.isFinite(c.endlessBest) ? Math.max(0, Math.floor(c.endlessBest)) : 0,
      battlesWon: Number.isFinite(c.battlesWon) ? Math.max(0, Math.floor(c.battlesWon)) : 0,
      packsOpened: Number.isFinite(c.packsOpened) ? Math.max(0, Math.floor(c.packsOpened)) : 0,
      heroes: c.heroes.map(h => ({ ...h })),
      equipment: Array.isArray(c.equipment) ? c.equipment.map(e => ({ ...e })) : [],
      tactics: Array.isArray(c.tactics) ? c.tactics.map(t => ({ ...t })) : [],
      squadUids: Array.isArray(c.squadUids) && c.squadUids.length ? c.squadUids.slice() : [c.heroes[0].uid],
      selectedCampHeroUid: c.selectedCampHeroUid ?? c.heroes[0].uid,
      lastPackReveal: []
    }
    if (!isStageUnlocked(cloned, cloned.selectedStageId)) {
      cloned.selectedStageId = getNextRecommendedStage(cloned).id
    }
    return { time: 0, campaign: cloned, battle: null, sounds: [], vfx: [] }
  }
  return {
    time: 0,
    campaign: createInitialCampaign(seed),
    battle: null,
    sounds: [],
    vfx: []
  }
}

export function serializeSave(state: GameState): SaveData {
  return {
    version: 1,
    campaign: {
      ...state.campaign,
      clearedStageIds: state.campaign.clearedStageIds.slice(),
      heroes: state.campaign.heroes.map(h => ({ ...h })),
      equipment: state.campaign.equipment.map(e => ({ ...e })),
      tactics: state.campaign.tactics.map(t => ({ ...t })),
      squadUids: state.campaign.squadUids.slice(),
      lastPackReveal: []
    }
  }
}

export function loadSave(storage: StorageLike | null | undefined): SaveData | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(SAVE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    if (!('version' in parsed) || parsed.version !== 1) return null
    if (!('campaign' in parsed) || typeof parsed.campaign !== 'object' || parsed.campaign === null) return null
    const camp = parsed.campaign
    if (!('heroes' in camp) || !Array.isArray(camp.heroes) || camp.heroes.length === 0) return null
    const chaptersCleared = 'chaptersCleared' in camp && typeof camp.chaptersCleared === 'number' ? camp.chaptersCleared : 0
    const clearedStageIds = 'clearedStageIds' in camp && Array.isArray(camp.clearedStageIds)
      ? camp.clearedStageIds.filter((id): id is string => typeof id === 'string' && Boolean(CHAPTER_BY_ID[id]) && !CHAPTER_BY_ID[id].comingSoon)
      : PLAYABLE_CHAPTERS.slice(0, clamp(Math.floor(chaptersCleared), 0, PLAYABLE_CHAPTERS.length)).map(ch => ch.id)
    const selectedStageId = 'selectedStageId' in camp && typeof camp.selectedStageId === 'string' && CHAPTER_BY_ID[camp.selectedStageId]
      ? camp.selectedStageId
      : CHAPTERS[0].id
    return {
      version: 1,
      campaign: {
        seed: 'seed' in camp && typeof camp.seed === 'number' ? camp.seed : 1337,
        nextUid: 'nextUid' in camp && typeof camp.nextUid === 'number' ? camp.nextUid : 100,
        gold: 'gold' in camp && typeof camp.gold === 'number' ? camp.gold : 100,
        chaptersCleared: clearedStageIds.length,
        clearedStageIds,
        selectedStageId,
        endlessBest: 'endlessBest' in camp && typeof camp.endlessBest === 'number' ? camp.endlessBest : 0,
        battlesWon: 'battlesWon' in camp && typeof camp.battlesWon === 'number' ? camp.battlesWon : 0,
        packsOpened: 'packsOpened' in camp && typeof camp.packsOpened === 'number' ? camp.packsOpened : 0,
        heroes: camp.heroes.filter((h): h is OwnedHeroCard => typeof h === 'object' && h !== null && 'uid' in h && 'heroId' in h),
        equipment: 'equipment' in camp && Array.isArray(camp.equipment)
          ? camp.equipment.filter((e): e is OwnedEquipCard => typeof e === 'object' && e !== null && 'uid' in e && 'equipId' in e)
          : [],
        tactics: 'tactics' in camp && Array.isArray(camp.tactics)
          ? camp.tactics.filter((t): t is OwnedTacticCard => typeof t === 'object' && t !== null && 'uid' in t && 'tacticId' in t)
          : [],
        squadUids: 'squadUids' in camp && Array.isArray(camp.squadUids)
          ? camp.squadUids.filter((u): u is string => typeof u === 'string')
          : [],
        selectedCampHeroUid: 'selectedCampHeroUid' in camp && typeof camp.selectedCampHeroUid === 'string'
          ? camp.selectedCampHeroUid
          : null,
        lastPackReveal: []
      }
    }
  } catch {
    return null
  }
}

export function persistSave(storage: StorageLike | null | undefined, state: GameState): void {
  if (!storage) return
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(serializeSave(state)))
  } catch { /* Quota or private mode */ }
}

export function clearSave(storage: StorageLike | null | undefined): void {
  if (!storage) return
  try {
    storage.removeItem?.(SAVE_KEY)
  } catch { /* Ignore */ }
}

// =========================================================================
// TACTICAL GRID BATTLE ENGINE
// =========================================================================

function buildCells(grid: readonly (readonly TileTerrain[])[]): GridCell[][] {
  const rows = grid.length
  const cols = grid[0]?.length ?? GRID_COLS
  const cells: GridCell[][] = []
  for (let row = 0; row < rows; row++) {
    const line: GridCell[] = []
    for (let col = 0; col < cols; col++) {
      const terrain = grid[row]?.[col] ?? 'grass'
      line.push({
        col,
        row,
        terrain,
        elevation: terrainElevation(terrain),
        walkable: terrainWalkable(terrain)
      })
    }
    cells.push(line)
  }
  return cells
}

export function unitAt(battle: BattleState, col: number, row: number): BattleUnit | undefined {
  return battle.units.find(u => u.alive && u.col === col && u.row === row)
}

export function getUnitByUid(battle: BattleState, uid: string | null): BattleUnit | undefined {
  if (!uid) return undefined
  return battle.units.find(u => u.uid === uid && u.alive)
}

export function isCellInBounds(col: number, row: number, cols = GRID_COLS, rows = GRID_ROWS): boolean {
  return col >= 0 && col < cols && row >= 0 && row < rows
}

function shuffleStrings(items: string[], campaign: CampaignState): string[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(randFloat(campaign) * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

function drawTacticCards(battle: BattleState, campaign: CampaignState, targetHandSize: number): void {
  while (battle.hand.length < targetHandSize) {
    if (battle.drawPile.length === 0) {
      if (battle.discardPile.length === 0) break
      battle.drawPile = shuffleStrings(battle.discardPile, campaign)
      battle.discardPile = []
    }
    const next = battle.drawPile.pop()
    if (!next) break
    battle.hand.push(next)
  }
}

export function startStageBattle(state: GameState, stageId: string, endlessWave = 0): BattleState {
  const stage = CHAPTER_BY_ID[stageId] ?? CHAPTERS[0]
  return startChapterBattle(state, stage.index, endlessWave)
}

export function startChapterBattle(state: GameState, chapterIndex: number, endlessWave = 0): BattleState {
  const { campaign } = state
  const safeIdx = clamp(chapterIndex, 0, CHAPTERS.length - 1)
  const chapter = CHAPTERS[safeIdx]
  campaign.selectedStageId = chapter.id
  const biome: BiomeId = chapter.biome
  const cells = buildCells(chapter.grid)
  const rows = cells.length
  const cols = cells[0]?.length ?? GRID_COLS

  const units: BattleUnit[] = []
  const squad = campaign.squadUids
    .map(uid => getHeroByUid(campaign, uid))
    .filter((h): h is OwnedHeroCard => Boolean(h))
    .slice(0, maxSquadSize(campaign))

  if (squad.length === 0 && campaign.heroes.length > 0) {
    squad.push(campaign.heroes[0])
    campaign.squadUids = [campaign.heroes[0].uid]
  }

  for (let i = 0; i < squad.length; i++) {
    const hero = squad[i]
    const spec = HERO_SPECS[hero.heroId]
    const stats = computeHeroStats(campaign, hero)
    const spawn = chapter.heroSpawns[i] ?? [0, Math.min(rows - 1, i + 1)]
    const cell = cells[spawn[1]][spawn[0]]
    const [wx, wy, wz] = gridToWorld(spawn[0], spawn[1], cell.elevation, cols, rows)
    const weaponOwned = getEquipmentByUid(campaign, hero.weaponUid)
    const armorOwned = getEquipmentByUid(campaign, hero.armorUid)
    const relicOwned = getEquipmentByUid(campaign, hero.relicUid)
    units.push({
      uid: hero.uid,
      team: 'ally',
      name: spec.name,
      heroId: hero.heroId,
      stars: hero.stars,
      isBoss: false,
      weaponHex: weaponOwned ? EQUIPMENT_BY_ID[weaponOwned.equipId]?.accentHex : undefined,
      armorHex: armorOwned ? EQUIPMENT_BY_ID[armorOwned.equipId]?.accentHex : undefined,
      weaponId: weaponOwned?.equipId,
      armorId: armorOwned?.equipId,
      relicId: relicOwned?.equipId,
      col: spawn[0],
      row: spawn[1],
      x: wx,
      y: wy,
      z: wz,
      yaw: facingToYaw('e'),
      facing: 'e',
      path: [],
      moveProgress: 0,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      shield: stats.shieldStart,
      atk: stats.atk,
      def: stats.def,
      speed: stats.speed,
      ct: stats.speed * 3,
      move: stats.move,
      range: stats.range,
      crit: stats.crit,
      lifesteal: stats.lifesteal,
      moved: false,
      acted: false,
      alive: true,
      burnTurns: 0,
      slowTurns: 0,
      stunTurns: 0,
      empowerTurns: 0,
      cooldowns: [0, 0, 0],
      animState: 'idle',
      animTimer: 0,
      hitFlash: 0,
      lungeX: 0,
      lungeZ: 0
    })
  }

  const waveScale = endlessWave > 0 ? 1 + endlessWave * 0.22 : 1
  for (let i = 0; i < chapter.enemies.length; i++) {
    const spawn = chapter.enemies[i]
    const spec = ENEMY_SPECS[spawn.id]
    const scale = (spawn.levelScale ?? 1) * waveScale
    const cell = cells[spawn.row][spawn.col]
    const [wx, wy, wz] = gridToWorld(spawn.col, spawn.row, cell.elevation, cols, rows)
    units.push({
      uid: `enemy_${i}_${spawn.id}`,
      team: 'enemy',
      name: spec.name,
      enemyId: spawn.id,
      stars: spec.isBoss ? 3 : 1,
      isBoss: Boolean(spec.isBoss),
      col: spawn.col,
      row: spawn.row,
      x: wx,
      y: wy,
      z: wz,
      yaw: facingToYaw('w'),
      facing: 'w',
      path: [],
      moveProgress: 0,
      hp: Math.round(spec.maxHp * scale),
      maxHp: Math.round(spec.maxHp * scale),
      shield: spec.isBoss ? 25 : 0,
      atk: Math.round(spec.atk * scale),
      def: Math.round(spec.def * (1 + (scale - 1) * 0.5)),
      speed: spec.speed,
      ct: spec.speed * 3,
      move: spec.move,
      range: spec.range,
      crit: 0.08,
      lifesteal: 0,
      moved: false,
      acted: false,
      alive: true,
      burnTurns: 0,
      slowTurns: 0,
      stunTurns: 0,
      empowerTurns: 0,
      cooldowns: [0, 0, 0],
      animState: 'idle',
      animTimer: 0,
      hitFlash: 0,
      lungeX: 0,
      lungeZ: 0
    })
  }

  const deckUids = shuffleStrings(campaign.tactics.map(t => t.uid), campaign)
  const battle: BattleState = {
    stageId: chapter.id,
    chapterIndex: safeIdx,
    endlessWave,
    difficulty: chapter.difficulty,
    cols,
    rows,
    biome,
    cells,
    units,
    turn: 0,
    phase: 'player',
    activeUnitUid: null,
    selectedUnitUid: null,
    turnOrder: [],
    armedSkillIndex: null,
    armedTacticUid: null,
    ap: 2,
    maxAp: 4,
    drawPile: deckUids,
    hand: [],
    discardPile: [],
    moveTiles: [],
    targetTiles: [],
    moveAttackTiles: [],
    pendingAction: null,
    enemyDelay: 0,
    enemyActedThisTurn: false,
    floatingNumbers: [],
    nextFloatId: 1,
    bannerText: endlessWave > 0 ? `Endless Wave ${endlessWave}` : chapter.title,
    bannerTimer: 2.1,
    shake: 0,
    reward: null
  }

  drawTacticCards(battle, campaign, 3)
  state.battle = battle
  advanceToNextUnitTurn(state, true)
  return battle
}

export function effectiveSpeed(unit: Pick<BattleUnit, 'speed' | 'slowTurns'>): number {
  return unit.slowTurns > 0 ? Math.max(3, Math.round(unit.speed * 0.6)) : unit.speed
}

/** Predict the next `count` turns using exact Speed / Charge Time (CT) initiative math. */
export function computeTurnOrderPreview(battle: BattleState, count = 8): TurnPreviewEntry[] {
  const alive = battle.units.filter(u => u.alive)
  if (!alive.length) return []

  const sim = alive.map((u, idx) => ({
    unit: u,
    idx,
    ct: u.ct,
    spd: effectiveSpeed(u)
  }))

  const out: TurnPreviewEntry[] = []
  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (active && (battle.phase === 'player' || battle.phase === 'enemy')) {
    out.push({
      uid: active.uid,
      team: active.team,
      name: active.name,
      heroId: active.heroId,
      enemyId: active.enemyId,
      stars: active.stars,
      speed: effectiveSpeed(active),
      isCurrent: true
    })
    const activeSim = sim.find(s => s.unit.uid === active.uid)
    if (activeSim) activeSim.ct = Math.max(0, activeSim.ct - 100)
  }

  let guard = 0
  while (out.length < count && guard++ < 400) {
    let bestIdx = -1
    for (let i = 0; i < sim.length; i++) {
      if (sim[i].ct < 100) continue
      if (bestIdx < 0) { bestIdx = i; continue }
      const a = sim[i], b = sim[bestIdx]
      if (a.ct > b.ct) bestIdx = i
      else if (a.ct === b.ct && a.spd > b.spd) bestIdx = i
      else if (a.ct === b.ct && a.spd === b.spd && a.unit.team === 'ally' && b.unit.team === 'enemy') bestIdx = i
    }
    if (bestIdx >= 0) {
      const winner = sim[bestIdx]
      out.push({
        uid: winner.unit.uid,
        team: winner.unit.team,
        name: winner.unit.name,
        heroId: winner.unit.heroId,
        enemyId: winner.unit.enemyId,
        stars: winner.unit.stars,
        speed: winner.spd,
        isCurrent: false
      })
      winner.ct -= 100
    } else {
      for (const s of sim) s.ct += s.spd
    }
  }
  return out
}

export function computeMoveTiles(battle: BattleState, unit: BattleUnit): { col: number; row: number }[] {
  if (!unit.alive || unit.moved || unit.stunTurns > 0) return []
  const maxMove = Math.max(1, unit.move - (unit.slowTurns > 0 ? 1 : 0))
  const visited = new Map<string, number>()
  const queue: { col: number; row: number; dist: number }[] = [{ col: unit.col, row: unit.row, dist: 0 }]
  visited.set(`${unit.col},${unit.row}`, 0)
  const result: { col: number; row: number }[] = []
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

  while (queue.length > 0) {
    const cur = queue.shift()
    if (!cur) break
    if (cur.dist > 0) {
      const occ = unitAt(battle, cur.col, cur.row)
      if (!occ) result.push({ col: cur.col, row: cur.row })
    }
    if (cur.dist >= maxMove) continue
    for (const [dc, dr] of dirs) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      if (!isCellInBounds(nc, nr, battle.cols, battle.rows)) continue
      const cell = battle.cells[nr][nc]
      if (!cell.walkable) continue
      const occ = unitAt(battle, nc, nr)
      if (occ && occ.team !== unit.team) continue
      const key = `${nc},${nr}`
      const nextDist = cur.dist + 1
      const prev = visited.get(key)
      if (prev === undefined || nextDist < prev) {
        visited.set(key, nextDist)
        queue.push({ col: nc, row: nr, dist: nextDist })
      }
    }
  }
  return result
}

export function findGridPath(
  battle: BattleState,
  unit: BattleUnit,
  goalCol: number,
  goalRow: number
): { col: number; row: number }[] {
  const maxMove = Math.max(1, unit.move - (unit.slowTurns > 0 ? 1 : 0))
  const startKey = `${unit.col},${unit.row}`
  const goalKey = `${goalCol},${goalRow}`
  const parent = new Map<string, { col: number; row: number } | null>()
  const distMap = new Map<string, number>()
  const queue: { col: number; row: number; dist: number }[] = [{ col: unit.col, row: unit.row, dist: 0 }]
  parent.set(startKey, null)
  distMap.set(startKey, 0)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

  while (queue.length > 0) {
    const cur = queue.shift()
    if (!cur) break
    if (cur.col === goalCol && cur.row === goalRow) break
    if (cur.dist >= maxMove) continue
    for (const [dc, dr] of dirs) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      if (!isCellInBounds(nc, nr, battle.cols, battle.rows)) continue
      const cell = battle.cells[nr][nc]
      if (!cell.walkable) continue
      const occ = unitAt(battle, nc, nr)
      if (occ && occ.team !== unit.team) continue
      const key = `${nc},${nr}`
      if (parent.has(key)) continue
      parent.set(key, { col: cur.col, row: cur.row })
      distMap.set(key, cur.dist + 1)
      queue.push({ col: nc, row: nr, dist: cur.dist + 1 })
    }
  }

  if (!parent.has(goalKey)) return []
  const path: { col: number; row: number }[] = []
  let curr: { col: number; row: number } | null = { col: goalCol, row: goalRow }
  while (curr) {
    if (curr.col === unit.col && curr.row === unit.row) break
    path.push(curr)
    curr = parent.get(`${curr.col},${curr.row}`) ?? null
  }
  path.reverse()
  return path
}

export function getHeroSkill(unit: BattleUnit, skillIndex: number): SkillSpec | null {
  if (!unit.heroId || skillIndex < 0 || skillIndex > 2) return null
  const spec = HERO_SPECS[unit.heroId]
  const skill = spec.skills[skillIndex]
  if (!skill || skill.tier > unit.stars) return null
  return skill
}

export function computeAttackArc(
  fromCol: number,
  fromRow: number,
  targetCol: number,
  targetRow: number,
  targetFacing: FacingDir
): AttackArc {
  const vc = fromCol - targetCol
  const vr = fromRow - targetRow
  if (vc === 0 && vr === 0) return 'front'
  const [fc, fr] = facingVector(targetFacing)
  const dot = vc * fc + vr * fr
  const cross = Math.abs(vc * fr - vr * fc)
  if (dot > 0 && dot >= cross) return 'front'
  if (dot < 0 && -dot >= cross) return 'back'
  return 'flank'
}

export function attackArcModifiers(arc: AttackArc): { readonly dmgMul: number; readonly critBonus: number } {
  if (arc === 'back') return { dmgMul: 1.30, critBonus: 0.20 }
  if (arc === 'flank') return { dmgMul: 1.15, critBonus: 0.10 }
  return { dmgMul: 1.0, critBonus: 0 }
}

export function setUnitFacing(unit: BattleUnit, dir: FacingDir): void {
  unit.facing = dir
  unit.yaw = facingToYaw(dir)
}

export function rotateActiveUnitFacing(state: GameState, dir?: FacingDir): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'player') return false
  if (battle.units.some(u => u.path.length > 0)) return false
  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (!active || active.team !== 'ally') return false
  const order: readonly FacingDir[] = ['n', 'e', 's', 'w']
  const nextDir = dir ?? order[(order.indexOf(active.facing) + 1) % order.length]
  setUnitFacing(active, nextDir)
  state.sounds.push({ kind: 'card', pitch: 1.12 })
  return true
}

export function computeTargetTiles(
  battle: BattleState,
  unit: BattleUnit,
  skillIndex: number | null
): { col: number; row: number }[] {
  if (!unit.alive || unit.acted || unit.stunTurns > 0) return []
  const targets: { col: number; row: number }[] = []

  if (skillIndex === null || skillIndex === -1) {
    // Basic attack targets all enemies within unit.range
    for (const other of battle.units) {
      if (!other.alive || other.team === unit.team) continue
      if (manhattan(unit.col, unit.row, other.col, other.row) <= unit.range) {
        targets.push({ col: other.col, row: other.row })
      }
    }
    return targets
  }

  const skill = getHeroSkill(unit, skillIndex)
  if (!skill || unit.cooldowns[skillIndex] > 0) return []

  if (skill.target === 'self') {
    return [{ col: unit.col, row: unit.row }]
  }

  // Free-tile & friendly-fire skill targeting:
  // Any non-pillar tile within skill.range can be targeted (empty spaces, enemies, or allies!).
  // Offensive skills start at distance 1 so clicking your own tile doesn't accidentally self-hit.
  const minDist = skill.target === 'ally' ? 0 : 1
  for (let row = 0; row < battle.rows; row++) {
    for (let col = 0; col < battle.cols; col++) {
      const d = manhattan(unit.col, unit.row, col, row)
      if (d >= minDist && d <= skill.range && battle.cells[row][col].terrain !== 'pillar') {
        targets.push({ col, row })
      }
    }
  }
  return targets
}

export function computeTacticTargetTiles(
  battle: BattleState,
  campaign: CampaignState,
  tacticUid: string
): { col: number; row: number }[] {
  const owned = getTacticByUid(campaign, tacticUid)
  if (!owned) return []
  const spec = TACTIC_BY_ID[owned.tacticId]
  if (!spec || battle.ap < spec.cost) return []
  const out: { col: number; row: number }[] = []

  if (spec.target === 'any') {
    for (const u of battle.units) if (u.alive && u.team === 'ally') out.push({ col: u.col, row: u.row })
    return out
  }
  if (spec.target === 'ally') {
    for (const u of battle.units) if (u.alive && u.team === 'ally') out.push({ col: u.col, row: u.row })
    return out
  }
  if (spec.target === 'enemy') {
    for (const u of battle.units) if (u.alive && u.team === 'enemy') out.push({ col: u.col, row: u.row })
    return out
  }
  for (let row = 0; row < battle.rows; row++) {
    for (let col = 0; col < battle.cols; col++) {
      if (battle.cells[row][col].terrain !== 'pillar') out.push({ col, row })
    }
  }
  return out
}

export function getPatternCells(
  centerCol: number,
  centerRow: number,
  pattern: SkillSpec['pattern'] | TacticCardSpec['pattern'],
  cols = GRID_COLS,
  rows = GRID_ROWS
): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = []
  const pushIf = (c: number, r: number) => {
    if (isCellInBounds(c, r, cols, rows)) out.push({ col: c, row: r })
  }
  if (pattern === 'single' || pattern === 'self') {
    pushIf(centerCol, centerRow)
  } else if (pattern === 'cross' || pattern === 'aura') {
    pushIf(centerCol, centerRow)
    pushIf(centerCol + 1, centerRow)
    pushIf(centerCol - 1, centerRow)
    pushIf(centerCol, centerRow + 1)
    pushIf(centerCol, centerRow - 1)
  } else if (pattern === 'area3') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        pushIf(centerCol + dc, centerRow + dr)
      }
    }
  } else {
    pushIf(centerCol, centerRow)
  }
  return out
}

function pickBestApproachTile(
  battle: BattleState,
  unit: BattleUnit,
  moveTiles: readonly { col: number; row: number }[],
  targetCol: number,
  targetRow: number,
  range: number
): { col: number; row: number } | null {
  const targetElev = battle.cells[targetRow][targetCol].elevation
  const targetUnit = unitAt(battle, targetCol, targetRow)
  const offensive = Boolean(targetUnit && targetUnit.team !== unit.team)
  let best: { col: number; row: number } | null = null
  let bestScore = -1e9
  for (const m of moveTiles) {
    const d = manhattan(m.col, m.row, targetCol, targetRow)
    if (d < 1 || d > range) continue
    const cell = battle.cells[m.row][m.col]
    let score = 0
    if (cell.elevation > targetElev + 0.1) score += 1000
    if (cell.terrain === 'shrine') score += 250
    if (offensive && targetUnit) {
      const arc = computeAttackArc(m.col, m.row, targetCol, targetRow, targetUnit.facing)
      if (arc === 'back') score += 850
      else if (arc === 'flank') score += 420
    }
    const walkDist = manhattan(unit.col, unit.row, m.col, m.row)
    // Ranged heroes prefer staying at max safe distance; melee prefers shortest approach
    score += range > 1 ? d * 25 - walkDist * 6 : -walkDist * 20
    if (score > bestScore) {
      bestScore = score
      best = m
    }
  }
  return best
}

/**
 * Compute enemy targets reachable by moving to a blue tile first and then attacking or casting.
 * Keeps direct in-range targets out of this list so Move+Attack stays visually distinct.
 */
export function computeMoveAttackTiles(
  battle: BattleState,
  unit: BattleUnit,
  skillIndex: number,
  moveTiles: readonly { col: number; row: number }[],
  directTargets: readonly { col: number; row: number }[]
): MoveAttackTile[] {
  if (!unit.alive || unit.moved || unit.acted || unit.stunTurns > 0 || moveTiles.length === 0) return []
  let range = unit.range
  let targetKind: SkillSpec['target'] = 'enemy'
  if (skillIndex >= 0) {
    const skill = getHeroSkill(unit, skillIndex)
    if (!skill || unit.cooldowns[skillIndex] > 0) return []
    if (skill.target === 'self') return []
    range = skill.range
    targetKind = skill.target
  }

  const out: MoveAttackTile[] = []
  for (const u of battle.units) {
    if (!u.alive) continue
    if (targetKind === 'ally' && u.team !== unit.team) continue
    if ((targetKind === 'enemy' || targetKind === 'tile') && u.team === unit.team) continue
    if (directTargets.some(t => t.col === u.col && t.row === u.row)) continue
    const approach = pickBestApproachTile(battle, unit, moveTiles, u.col, u.row, range)
    if (approach) {
      out.push({ col: u.col, row: u.row, fromCol: approach.col, fromRow: approach.row })
    }
  }
  return out
}

export function refreshHighlights(battle: BattleState, campaign: CampaignState): void {
  battle.moveTiles = []
  battle.targetTiles = []
  battle.moveAttackTiles = []
  battle.turnOrder = computeTurnOrderPreview(battle, 8)
  if (battle.phase !== 'player') return

  if (battle.armedTacticUid) {
    battle.targetTiles = computeTacticTargetTiles(battle, campaign, battle.armedTacticUid)
    return
  }

  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (!active || active.team !== 'ally') return
  const moveTiles = computeMoveTiles(battle, active)
  battle.moveTiles = moveTiles
  if (battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0) {
    battle.targetTiles = computeTargetTiles(battle, active, battle.armedSkillIndex)
    battle.moveAttackTiles = computeMoveAttackTiles(battle, active, battle.armedSkillIndex, moveTiles, battle.targetTiles)
    return
  }
  battle.targetTiles = computeTargetTiles(battle, active, -1)
  battle.moveAttackTiles = computeMoveAttackTiles(battle, active, -1, moveTiles, battle.targetTiles)
}

function previewDamageMath(
  battle: BattleState,
  attacker: BattleUnit | null,
  defender: BattleUnit,
  fromCol: number,
  fromRow: number,
  rawDamage: number,
  ignoreArmor: number,
  canCrit: boolean
): {
  normalDmg: number
  critDmg: number
  critChance: number
  highGround: boolean
  empowered: boolean
  attackArc: AttackArc
  hpAfterNormal: number
  hpAfterCrit: number
} {
  let dmg = rawDamage
  let highGround = false
  let empowered = false
  let attackArc: AttackArc = 'front'
  let arcCritBonus = 0
  if (attacker) {
    const aElev = battle.cells[fromRow][fromCol].elevation
    const dElev = battle.cells[defender.row][defender.col].elevation
    if (aElev > dElev + 0.1) {
      dmg *= 1.2
      highGround = true
    }
    attackArc = computeAttackArc(fromCol, fromRow, defender.col, defender.row, defender.facing)
    const arcMod = attackArcModifiers(attackArc)
    dmg *= arcMod.dmgMul
    arcCritBonus = arcMod.critBonus
    if (attacker.empowerTurns > 0) {
      dmg *= 1.35
      empowered = true
    }
  }
  const effDef = Math.max(0, defender.def * (1 - clamp(ignoreArmor, 0, 1)))
  const baseDmg = Math.max(4, Math.round(dmg - effDef * 0.72))
  const critChance = canCrit && attacker ? clamp(attacker.crit + arcCritBonus, 0, 0.95) : 0
  const critRaw = critChance > 0 ? Math.round(baseDmg * 1.55) : baseDmg
  const normalAfterShield = Math.max(0, baseDmg - defender.shield)
  const critAfterShield = Math.max(0, critRaw - defender.shield)
  return {
    normalDmg: baseDmg,
    critDmg: critRaw,
    critChance,
    highGround,
    empowered,
    attackArc,
    hpAfterNormal: Math.max(0, defender.hp - normalAfterShield),
    hpAfterCrit: Math.max(0, defender.hp - critAfterShield)
  }
}

/**
 * Pure deterministic Combat Forecast for hovering or tapping a target tile.
 * Computes projected damage/crit/heal/shield/KO, flanking/backstab arcs, friendly fire warnings,
 * empty-tile skill casts, and compares Strike vs every usable Skill.
 */
export function computeCombatForecast(state: GameState, col: number, row: number): CombatForecast | null {
  const battle = state.battle
  if (!battle || battle.phase !== 'player' || !isCellInBounds(col, row, battle.cols, battle.rows)) return null
  if (battle.units.some(u => u.path.length > 0)) return null

  const active = getUnitByUid(battle, battle.activeUnitUid)

  // 1. Tactic Card forecast
  if (battle.armedTacticUid) {
    if (!battle.targetTiles.some(t => t.col === col && t.row === row)) return null
    const owned = getTacticByUid(state.campaign, battle.armedTacticUid)
    const spec = owned ? TACTIC_BY_ID[owned.tacticId] : undefined
    if (!spec) return null
    const affected = getPatternCells(col, row, spec.pattern, battle.cols, battle.rows)
    const primary = unitAt(battle, col, row) ?? affected.map(c => unitAt(battle, c.col, c.row)).find((u): u is BattleUnit => Boolean(u))
    if (!primary) return null
    const aoeTargets = affected.filter(c => {
      const u = unitAt(battle, c.col, c.row)
      if (!u) return false
      return spec.damage > 0 ? u.team === 'enemy' : u.team === 'ally'
    }).length

    let normalDmg = 0
    let hpAfterNormal = primary.hp
    if (spec.damage > 0 && primary.team === 'enemy') {
      const m = previewDamageMath(battle, null, primary, col, row, spec.damage, 0.6, false)
      normalDmg = m.normalDmg
      hpAfterNormal = m.hpAfterNormal
    } else if (spec.heal > 0 && primary.team === 'ally') {
      hpAfterNormal = Math.min(primary.maxHp, primary.hp + spec.heal)
    }

    return {
      mode: 'tactic',
      actionName: spec.name,
      skillIndex: null,
      attackerUid: active?.uid ?? null,
      attackerName: active?.name ?? 'Tactic Card',
      attackerHeroId: active?.heroId,
      attackerStars: active?.stars ?? 1,
      targetUid: primary.uid,
      targetName: primary.name,
      targetTeam: primary.team,
      targetHeroId: primary.heroId,
      targetEnemyId: primary.enemyId,
      targetCol: col,
      targetRow: row,
      approachCol: active?.col ?? col,
      approachRow: active?.row ?? row,
      requiresMove: false,
      path: [],
      normalDmg,
      critDmg: normalDmg,
      critChance: 0,
      healAmount: primary.team === 'ally' ? spec.heal : 0,
      shieldAmount: primary.team === 'ally' ? spec.shield : 0,
      selfShield: 0,
      status: spec.status,
      highGround: false,
      empowered: false,
      attackArc: 'front',
      isOffensive: spec.damage > 0,
      friendlyFire: false,
      friendlyFireCount: 0,
      emptyTileTarget: false,
      ignoreArmor: spec.damage > 0 ? 0.6 : 0,
      aoeTargets: Math.max(1, aoeTargets),
      targetHpBefore: primary.hp,
      targetMaxHp: primary.maxHp,
      targetShieldBefore: primary.shield,
      targetHpAfterNormal: hpAfterNormal,
      targetHpAfterCrit: hpAfterNormal,
      lethalNormal: normalDmg > 0 && hpAfterNormal <= 0,
      lethalCrit: normalDmg > 0 && hpAfterNormal <= 0,
      alternatives: []
    }
  }

  if (!active || active.team !== 'ally' || active.acted || active.stunTurns > 0) return null

  const isDirect = battle.targetTiles.some(t => t.col === col && t.row === row)
  const moveEntry = isDirect ? undefined : battle.moveAttackTiles.find(t => t.col === col && t.row === row)
  if (!isDirect && !moveEntry) return null

  const approachCol = moveEntry ? moveEntry.fromCol : active.col
  const approachRow = moveEntry ? moveEntry.fromRow : active.row
  const requiresMove = Boolean(moveEntry)
  const path = requiresMove ? findGridPath(battle, active, approachCol, approachRow) : []
  const armedIdx = battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0 ? battle.armedSkillIndex : null
  const armedSkill = armedIdx !== null ? getHeroSkill(active, armedIdx) : null

  const affected = armedSkill ? getPatternCells(col, row, armedSkill.pattern, battle.cols, battle.rows) : [{ col, row }]
  const directUnit = unitAt(battle, col, row)
  const isOffensive = armedSkill ? armedSkill.powerMul > 0 : true
  const isSupportOnly = Boolean(armedSkill && armedSkill.powerMul === 0)
  const isDawnsJudgmentSafe = Boolean(
    armedSkill && armedSkill.id === 'dawns_judgment' && (!directUnit || directUnit.team !== active.team)
  )

  const affectedUnits: BattleUnit[] = []
  for (const c of affected) {
    const u = unitAt(battle, c.col, c.row)
    if (!u) continue
    if (isOffensive && u.uid === active.uid && !(col === active.col && row === active.row)) continue
    affectedUnits.push(u)
  }

  const friendlyFireUnits = isOffensive && !isDawnsJudgmentSafe
    ? affectedUnits.filter(u => u.team === active.team)
    : []
  const friendlyFireCount = friendlyFireUnits.length
  const friendlyFire = friendlyFireCount > 0

  // Prefer the directly clicked unit; otherwise first affected enemy (or ally if friendly fire / support)
  const primary = directUnit
    ?? affectedUnits.find(u => (isSupportOnly ? u.team === active.team : u.team !== active.team))
    ?? affectedUnits[0]
    ?? null

  // If hovering an empty ground space with an armed skill and no units in the pattern:
  if (!primary) {
    if (!armedSkill) return null
    return {
      mode: 'skill',
      actionName: armedSkill.name,
      skillIndex: armedIdx,
      attackerUid: active.uid,
      attackerName: active.name,
      attackerHeroId: active.heroId,
      attackerStars: active.stars,
      targetUid: null,
      targetName: 'Empty Space',
      targetTeam: 'none',
      targetCol: col,
      targetRow: row,
      approachCol,
      approachRow,
      requiresMove: false,
      path: [],
      normalDmg: 0,
      critDmg: 0,
      critChance: 0,
      healAmount: 0,
      shieldAmount: 0,
      selfShield: armedSkill.shieldAmount > 0 && armedSkill.pattern !== 'aura' ? armedSkill.shieldAmount : 0,
      status: armedSkill.status,
      highGround: false,
      empowered: active.empowerTurns > 0,
      attackArc: 'front',
      isOffensive,
      friendlyFire: false,
      friendlyFireCount: 0,
      emptyTileTarget: true,
      ignoreArmor: armedSkill.ignoreArmor,
      aoeTargets: 0,
      targetHpBefore: 0,
      targetMaxHp: 1,
      targetShieldBefore: 0,
      targetHpAfterNormal: 0,
      targetHpAfterCrit: 0,
      lethalNormal: false,
      lethalCrit: false,
      alternatives: []
    }
  }

  // Compute primary preview
  let normalDmg = 0
  let critDmg = 0
  let critChance = 0
  let highGround = false
  let empowered = false
  let attackArc: AttackArc = 'front'
  let ignoreArmor = 0
  let healAmount = 0
  let shieldAmount = 0
  let selfShield = 0
  let status: 'burn' | 'slow' | 'stun' | 'empower' | undefined
  let hpAfterNormal = primary.hp
  let hpAfterCrit = primary.hp

  if (armedSkill) {
    ignoreArmor = armedSkill.ignoreArmor
    status = armedSkill.status
    if (armedSkill.target === 'ally' || armedSkill.target === 'self') {
      healAmount = armedSkill.healAmount
      shieldAmount = armedSkill.shieldAmount
      hpAfterNormal = Math.min(primary.maxHp, primary.hp + healAmount)
      hpAfterCrit = hpAfterNormal
    } else {
      selfShield = armedSkill.shieldAmount
      const healsAlly = isDawnsJudgmentSafe && primary.team === active.team
      if (healsAlly) {
        healAmount = armedSkill.healAmount
        shieldAmount = armedSkill.shieldAmount
        hpAfterNormal = Math.min(primary.maxHp, primary.hp + healAmount)
        hpAfterCrit = hpAfterNormal
      } else if (armedSkill.powerMul > 0) {
        const raw = active.atk * armedSkill.powerMul + armedSkill.flatBonus
        const m = previewDamageMath(battle, active, primary, approachCol, approachRow, raw, armedSkill.ignoreArmor, true)
        normalDmg = m.normalDmg
        critDmg = m.critDmg
        critChance = m.critChance
        highGround = m.highGround
        empowered = m.empowered
        attackArc = m.attackArc
        hpAfterNormal = m.hpAfterNormal
        hpAfterCrit = m.hpAfterCrit
      }
    }
  } else if (primary.team !== active.team) {
    const m = previewDamageMath(battle, active, primary, approachCol, approachRow, active.atk, 0, true)
    normalDmg = m.normalDmg
    critDmg = m.critDmg
    critChance = m.critChance
    highGround = m.highGround
    empowered = m.empowered
    attackArc = m.attackArc
    hpAfterNormal = m.hpAfterNormal
    hpAfterCrit = m.hpAfterCrit
  }

  const aoeTargets = affectedUnits.filter(u => {
    if (isSupportOnly) return true
    if (isDawnsJudgmentSafe) return u.team !== active.team
    return true
  }).length

  // Build Strike vs Skill comparison alternatives against this same target
  const alternatives: CombatForecastAlt[] = []
  const keycaps: readonly string[] = ['2', '3', '4']
  const distNow = manhattan(active.col, active.row, primary.col, primary.row)

  // Basic Strike option (for enemy targets)
  if (primary.team !== active.team) {
    const strikeDirect = distNow >= 1 && distNow <= active.range
    const strikeApproach = strikeDirect
      ? { col: active.col, row: active.row }
      : (!active.moved ? pickBestApproachTile(battle, active, battle.moveTiles, primary.col, primary.row, active.range) : null)
    if (strikeApproach) {
      const m = previewDamageMath(battle, active, primary, strikeApproach.col, strikeApproach.row, active.atk, 0, true)
      alternatives.push({
        skillIndex: null,
        keycap: '1',
        name: 'Strike',
        normalDmg: m.normalDmg,
        critDmg: m.critDmg,
        critChance: m.critChance,
        healAmount: 0,
        selfShield: 0,
        lethalNormal: m.hpAfterNormal <= 0,
        requiresMove: !strikeDirect,
        attackArc: m.attackArc,
        active: armedIdx === null
      })
    }
  }

  // Unlocked, off-cooldown skills that can target this unit (only suggest aligned skills so we don't encourage friendly fire!)
  for (let i = 0; i < 3; i++) {
    const sk = getHeroSkill(active, i)
    if (!sk || active.cooldowns[i] > 0 || sk.target === 'self') continue
    if (sk.target === 'ally' && primary.team !== active.team) continue
    if ((sk.target === 'enemy' || sk.target === 'tile') && primary.team === active.team) continue
    const skDirect = distNow >= 1 && distNow <= sk.range
    const skApproach = skDirect
      ? { col: active.col, row: active.row }
      : (!active.moved ? pickBestApproachTile(battle, active, battle.moveTiles, primary.col, primary.row, sk.range) : null)
    if (!skApproach) continue
    if (sk.target === 'ally') {
      alternatives.push({
        skillIndex: i,
        keycap: keycaps[i] ?? '2',
        name: sk.name,
        normalDmg: 0,
        critDmg: 0,
        critChance: 0,
        healAmount: sk.healAmount,
        selfShield: sk.shieldAmount,
        status: sk.status,
        lethalNormal: false,
        requiresMove: !skDirect,
        attackArc: 'front',
        active: armedIdx === i
      })
    } else {
      const raw = active.atk * sk.powerMul + sk.flatBonus
      const m = previewDamageMath(battle, active, primary, skApproach.col, skApproach.row, raw, sk.ignoreArmor, true)
      alternatives.push({
        skillIndex: i,
        keycap: keycaps[i] ?? '2',
        name: sk.name,
        normalDmg: m.normalDmg,
        critDmg: m.critDmg,
        critChance: m.critChance,
        healAmount: 0,
        selfShield: sk.shieldAmount,
        status: sk.status,
        lethalNormal: m.hpAfterNormal <= 0,
        requiresMove: !skDirect,
        attackArc: m.attackArc,
        active: armedIdx === i
      })
    }
  }

  return {
    mode: armedSkill ? 'skill' : 'strike',
    actionName: armedSkill ? armedSkill.name : 'Strike',
    skillIndex: armedIdx,
    attackerUid: active.uid,
    attackerName: active.name,
    attackerHeroId: active.heroId,
    attackerStars: active.stars,
    targetUid: primary.uid,
    targetName: primary.name,
    targetTeam: primary.team,
    targetHeroId: primary.heroId,
    targetEnemyId: primary.enemyId,
    targetCol: col,
    targetRow: row,
    approachCol,
    approachRow,
    requiresMove,
    path,
    normalDmg,
    critDmg,
    critChance,
    healAmount,
    shieldAmount,
    selfShield,
    status,
    highGround,
    empowered,
    attackArc,
    isOffensive,
    friendlyFire,
    friendlyFireCount,
    emptyTileTarget: false,
    ignoreArmor,
    aoeTargets: Math.max(1, aoeTargets),
    targetHpBefore: primary.hp,
    targetMaxHp: primary.maxHp,
    targetShieldBefore: primary.shield,
    targetHpAfterNormal: hpAfterNormal,
    targetHpAfterCrit: hpAfterCrit,
    lethalNormal: normalDmg > 0 && hpAfterNormal <= 0,
    lethalCrit: critDmg > 0 && hpAfterCrit <= 0,
    alternatives
  }
}

function addFloat(battle: BattleState, x: number, y: number, z: number, text: string, color: string): void {
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

function applyDamage(
  state: GameState,
  attacker: BattleUnit | null,
  defender: BattleUnit,
  rawDamage: number,
  ignoreArmor: number,
  canCrit: boolean
): number {
  const battle = state.battle
  if (!battle || !defender.alive) return 0

  let dmg = rawDamage
  let attackArc: AttackArc = 'front'
  let arcCritBonus = 0
  if (attacker) {
    const aElev = battle.cells[attacker.row][attacker.col].elevation
    const dElev = battle.cells[defender.row][defender.col].elevation
    if (aElev > dElev + 0.1) dmg *= 1.2 // High ground advantage!
    attackArc = computeAttackArc(attacker.col, attacker.row, defender.col, defender.row, defender.facing)
    const arcMod = attackArcModifiers(attackArc)
    dmg *= arcMod.dmgMul
    arcCritBonus = arcMod.critBonus
    if (attacker.empowerTurns > 0) dmg *= 1.35
  }

  const effDef = Math.max(0, defender.def * (1 - clamp(ignoreArmor, 0, 1)))
  let finalDmg = Math.max(4, Math.round(dmg - effDef * 0.72))

  let isCrit = false
  if (canCrit && attacker && randFloat(state.campaign) < clamp(attacker.crit + arcCritBonus, 0, 0.95)) {
    isCrit = true
    finalDmg = Math.round(finalDmg * 1.55)
  }

  let absorbed = 0
  if (defender.shield > 0) {
    absorbed = Math.min(defender.shield, finalDmg)
    defender.shield -= absorbed
    finalDmg -= absorbed
  }

  defender.hp = Math.max(0, defender.hp - finalDmg)
  state.vfx.push({
    kind: 'impact',
    uid: defender.uid,
    attackerUid: attacker ? attacker.uid : null,
    arc: attackArc,
    crit: isCrit,
    blocked: finalDmg === 0 && absorbed > 0,
    absorbed,
    damage: finalDmg
  })
  defender.hitFlash = 0.28
  defender.animState = 'hit'
  defender.animTimer = 0.30
  battle.shake = Math.max(battle.shake, isCrit || attackArc === 'back' ? 0.36 : 0.18)

  if (finalDmg > 0) {
    addFloat(
      battle,
      defender.x,
      defender.y,
      defender.z,
      isCrit ? `CRIT -${finalDmg}!` : `-${finalDmg}`,
      isCrit ? '#ffe16b' : '#ff7b6b'
    )
    if (attackArc === 'back') {
      addFloat(battle, defender.x, defender.y + 0.42, defender.z, 'BACKSTAB +30%!', '#ff9cf0')
    } else if (attackArc === 'flank') {
      addFloat(battle, defender.x, defender.y + 0.42, defender.z, 'FLANK +15%', '#ffd166')
    }
    if (attacker && attacker.team === defender.team) {
      addFloat(battle, defender.x, defender.y + 0.76, defender.z, 'ALLY HIT!', '#ff66a8')
    }
    state.sounds.push({ kind: isCrit ? 'crit' : 'hit' })
  } else if (absorbed > 0) {
    addFloat(battle, defender.x, defender.y, defender.z, `BLOCK ${absorbed}`, '#7ed9ff')
    state.sounds.push({ kind: 'shield' })
  }

  if (attacker && attacker.lifesteal > 0 && finalDmg > 0 && attacker.alive) {
    const heal = Math.max(2, Math.round(finalDmg * attacker.lifesteal))
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal)
    addFloat(battle, attacker.x, attacker.y, attacker.z, `+${heal}`, '#6effa8')
  }

  if (defender.hp <= 0) {
    defender.alive = false
    state.sounds.push({ kind: 'ko' })
    state.vfx.push({ kind: 'ko', at: [defender.x, defender.y + 0.6, defender.z], isBoss: defender.isBoss })
  }
  return finalDmg
}

function applyHealAndShield(
  state: GameState,
  target: BattleUnit,
  healAmount: number,
  shieldAmount: number
): void {
  const battle = state.battle
  if (!battle || !target.alive) return
  if (healAmount > 0) {
    const before = target.hp
    target.hp = Math.min(target.maxHp, target.hp + healAmount)
    const gained = target.hp - before
    addFloat(battle, target.x, target.y, target.z, `+${gained > 0 ? gained : healAmount} HP`, '#6effa8')
    state.vfx.push({ kind: 'heal', at: [target.x, target.y + 0.5, target.z] })
    state.sounds.push({ kind: 'heal' })
  }
  if (shieldAmount > 0) {
    target.shield += shieldAmount
    addFloat(battle, target.x, target.y + 0.35, target.z, `+${shieldAmount} SHD`, '#7ed9ff')
    state.vfx.push({ kind: 'shield', at: [target.x, target.y + 0.5, target.z] })
    state.sounds.push({ kind: 'shield' })
  }
}

function applyStatus(
  battle: BattleState,
  target: BattleUnit,
  status: 'burn' | 'slow' | 'stun' | 'empower'
): void {
  if (!target.alive) return
  if (status === 'burn') {
    target.burnTurns = Math.max(target.burnTurns, 2)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'BURN', '#ff9b42')
  } else if (status === 'slow') {
    target.slowTurns = Math.max(target.slowTurns, 2)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'SLOW', '#7fdfff')
  } else if (status === 'stun') {
    target.stunTurns = Math.max(target.stunTurns, 1)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'STUN!', '#ffdf59')
  } else if (status === 'empower') {
    target.empowerTurns = Math.max(target.empowerTurns, 2)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'EMPOWER', '#ffd86b')
  }
}

function faceToward(unit: BattleUnit, tx: number, tz: number): void {
  const dx = tx - unit.x
  const dz = tz - unit.z
  if (Math.hypot(dx, dz) > 0.05) {
    unit.yaw = Math.atan2(dx, dz)
    unit.facing = vectorToFacing(dx, dz, unit.facing)
  }
}

function checkBattleOutcome(state: GameState): void {
  const battle = state.battle
  if (!battle || battle.phase === 'victory' || battle.phase === 'defeat') return
  const alliesAlive = battle.units.some(u => u.alive && u.team === 'ally')
  const enemiesAlive = battle.units.some(u => u.alive && u.team === 'enemy')

  if (!enemiesAlive) {
    battle.phase = 'victory'
    battle.moveTiles = []
    battle.targetTiles = []
    battle.moveAttackTiles = []
    battle.pendingAction = null
    battle.armedSkillIndex = null
    battle.armedTacticUid = null
    for (const u of battle.units) {
      if (u.alive && u.team === 'ally') {
        u.animState = 'celebrate'
        u.animTimer = 2.0
      }
    }
    awardBattleVictory(state)
    state.sounds.push({ kind: 'victory' })
  } else if (!alliesAlive) {
    battle.phase = 'defeat'
    battle.moveTiles = []
    battle.targetTiles = []
    battle.moveAttackTiles = []
    battle.pendingAction = null
    battle.bannerText = 'Vanguard Defeated'
    battle.bannerTimer = 3.0
    state.sounds.push({ kind: 'defeat' })
  }
}

function replayWeightsForDifficulty(diff: DifficultyLevel): Record<Rarity, number> {
  if (diff === 1) return { common: 84, uncommon: 15, rare: 1, epic: 0, legendary: 0 }
  if (diff === 2) return { common: 72, uncommon: 24, rare: 4, epic: 0, legendary: 0 }
  if (diff === 3) return { common: 58, uncommon: 32, rare: 9.5, epic: 0.5, legendary: 0 }
  if (diff === 4) return { common: 46, uncommon: 36, rare: 16.5, epic: 1.5, legendary: 0 }
  return { common: 36, uncommon: 38, rare: 22.5, epic: 3.2, legendary: 0.3 }
}

function awardBattleVictory(state: GameState): void {
  const battle = state.battle
  if (!battle) return
  const { campaign } = state
  const chapter = CHAPTERS[battle.chapterIndex]
  const firstClear = battle.endlessWave === 0 && !isStageCleared(campaign, chapter.id)
  const gold = battle.endlessWave > 0
    ? 130 + battle.endlessWave * 35
    : firstClear ? chapter.rewardGold : chapter.replayGold

  campaign.gold += gold
  campaign.battlesWon += 1

  let unlockedSlot4 = false
  let campaignWon = false
  if (battle.endlessWave > 0) {
    if (battle.endlessWave > campaign.endlessBest) campaign.endlessBest = battle.endlessWave
  } else if (firstClear) {
    const prevSlots = maxSquadSize(campaign)
    campaign.clearedStageIds.push(chapter.id)
    campaign.chaptersCleared = campaign.clearedStageIds.length
    if (maxSquadSize(campaign) > prevSlots) unlockedSlot4 = true
    if (chapter.unlocksEndless) campaignWon = true
  }

  let equipCard: OwnedEquipCard | null = null
  let heroCard: OwnedHeroCard | null = null
  let tacticCard: OwnedTacticCard | null = null
  let specialRewardsClaimed = false

  if (battle.endlessWave > 0) {
    // Weighted rarity drop scaling gently with endless wave (never uniform Legendary farm)
    const wBonus = Math.min(battle.endlessWave * 0.4, 4)
    const endlessWeights: Record<Rarity, number> = {
      common: 44,
      uncommon: 34,
      rare: 18 + wBonus,
      epic: 3.5 + wBonus * 0.6,
      legendary: 0.5 + wBonus * 0.15
    }
    const eqRarity = rollRarity(campaign, endlessWeights, 'common')
    const eqSpec = pickNearestByRarity(EQUIPMENT_LIST, eqRarity, campaign)
    equipCard = { uid: allocUid(campaign, 'eq'), equipId: eqSpec.id, slot: eqSpec.slot }
    campaign.equipment.push(equipCard)

    const heroRarity = rollRarity(campaign, endlessWeights, 'common')
    const hSpec = pickNearestByRarity(HERO_LIST, heroRarity, campaign)
    heroCard = {
      uid: allocUid(campaign, 'hero'),
      heroId: hSpec.id,
      stars: 1,
      weaponUid: null,
      armorUid: null,
      relicUid: null
    }
    campaign.heroes.push(heroCard)
  } else if (firstClear) {
    // First-clear ONE-TIME special rewards!
    specialRewardsClaimed = Boolean(chapter.rewardEquipId || chapter.rewardHeroId || unlockedSlot4 || campaignWon)
    if (chapter.rewardEquipId) {
      const eqSpec = EQUIPMENT_BY_ID[chapter.rewardEquipId] ?? EQUIPMENT_LIST[0]
      equipCard = { uid: allocUid(campaign, 'eq'), equipId: eqSpec.id, slot: eqSpec.slot }
      campaign.equipment.push(equipCard)
    }
    if (chapter.rewardHeroId) {
      heroCard = {
        uid: allocUid(campaign, 'hero'),
        heroId: chapter.rewardHeroId,
        stars: 1,
        weaponUid: null,
        armorUid: null,
        relicUid: null
      }
      campaign.heroes.push(heroCard)
    }
  } else {
    // Replaying an already-cleared stage: awards replay gold + one modest repeatable drop (never one-time uniques!)
    const repWeights = replayWeightsForDifficulty(chapter.difficulty)
    const rarity = rollRarity(campaign, repWeights, 'common')
    const kindRoll = randFloat(campaign)
    if (kindRoll < 0.45) {
      const eqSpec = pickNearestByRarity(EQUIPMENT_LIST, rarity, campaign)
      equipCard = { uid: allocUid(campaign, 'eq'), equipId: eqSpec.id, slot: eqSpec.slot }
      campaign.equipment.push(equipCard)
    } else if (kindRoll < 0.80) {
      const hSpec = pickNearestByRarity(HERO_LIST, rarity, campaign)
      heroCard = {
        uid: allocUid(campaign, 'hero'),
        heroId: hSpec.id,
        stars: 1,
        weaponUid: null,
        armorUid: null,
        relicUid: null
      }
      campaign.heroes.push(heroCard)
    } else {
      const tSpec = pickNearestByRarity(TACTIC_LIST, rarity, campaign)
      tacticCard = { uid: allocUid(campaign, 'tac'), tacticId: tSpec.id }
      campaign.tactics.push(tacticCard)
    }
  }

  const reward: BattleReward = {
    gold,
    equipCard,
    heroCard,
    tacticCard,
    stageId: chapter.id,
    chapterCleared: battle.chapterIndex,
    firstClear,
    specialRewardsClaimed,
    unlockedSlot4,
    campaignWon
  }
  battle.reward = reward
  battle.bannerText = 'VICTORY!'
  battle.bannerTimer = 3.0
}

/** World-space ground centres of grid cells (presentation hints for VFX events). */
function cellCentres(battle: BattleState, cells: readonly { col: number; row: number }[]): Vec3[] {
  const out: Vec3[] = []
  for (const c of cells) {
    out.push(gridToWorld(c.col, c.row, battle.cells[c.row][c.col].elevation, battle.cols, battle.rows))
  }
  return out
}

/** The ally whose turn it is plays the 'command' gesture when a tactic card resolves. */
function tacticCasterUid(battle: BattleState): string | null {
  const active = getUnitByUid(battle, battle.activeUnitUid)
  return active && active.alive && active.team === 'ally' ? active.uid : null
}

function executeBasicAttack(state: GameState, attacker: BattleUnit, target: BattleUnit): void {
  const battle = state.battle
  if (!battle) return
  faceToward(attacker, target.x, target.z)
  attacker.animState = 'attack'
  attacker.animTimer = 0.36
  attacker.acted = true

  const dx = target.x - attacker.x
  const dz = target.z - attacker.z
  const dist = Math.hypot(dx, dz) || 1
  if (attacker.range <= 1) {
    attacker.lungeX = (dx / dist) * 0.48
    attacker.lungeZ = (dz / dist) * 0.48
    state.sounds.push({ kind: 'slash' })
    state.vfx.push({ kind: 'burst', style: 'slash', at: [target.x, target.y + 0.75, target.z], uid: attacker.uid })
  } else {
    const style = attacker.heroId === 'archer' || attacker.enemyId === 'bone_archer'
      ? 'arrow'
      : attacker.heroId === 'cryomancer' ? 'frost'
      : attacker.heroId === 'cleric' ? 'holy'
      : attacker.enemyId === 'eclipse_archon' || attacker.enemyId === 'bog_shaman' ? 'shadow'
      : 'arcane'
    state.sounds.push({ kind: style === 'arrow' ? 'arrow' : 'magic' })
    state.vfx.push({
      kind: 'projectile',
      style,
      from: [attacker.x, attacker.y + 0.95, attacker.z],
      to: [target.x, target.y + 0.75, target.z],
      uid: attacker.uid
    })
  }

  applyDamage(state, attacker, target, attacker.atk, 0, true)
  checkBattleOutcome(state)
}

function executeHeroSkill(
  state: GameState,
  caster: BattleUnit,
  skillIndex: number,
  col: number,
  row: number
): void {
  const battle = state.battle
  if (!battle) return
  const skill = getHeroSkill(caster, skillIndex)
  if (!skill) return

  const cell = battle.cells[row][col]
  const [tx, ty, tz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  faceToward(caster, tx, tz)
  caster.animState = skill.vfx === 'slash' ? 'attack' : 'cast'
  caster.animTimer = 0.42
  caster.acted = true
  caster.cooldowns[skillIndex] = skill.cooldown

  if (skill.vfx === 'arrow') state.sounds.push({ kind: 'arrow', pitch: 1.1 })
  else if (skill.vfx === 'slash') state.sounds.push({ kind: 'slash', pitch: 1.15 })
  else if (skill.vfx === 'holy' && skill.powerMul === 0) state.sounds.push({ kind: 'heal' })
  else state.sounds.push({ kind: 'magic', pitch: 1.05 })

  const affected = getPatternCells(col, row, skill.pattern, battle.cols, battle.rows)
  state.vfx.push({
    kind: 'skill',
    uid: caster.uid,
    skillId: skill.id,
    style: skill.vfx,
    from: [caster.x, caster.y, caster.z],
    at: [tx, ty, tz],
    cells: cellCentres(battle, affected)
  })
  let hitAny = false

  if (skill.target === 'self') {
    for (const c of affected) {
      const ally = unitAt(battle, c.col, c.row)
      if (!ally || ally.team !== caster.team) continue
      applyHealAndShield(state, ally, skill.healAmount, skill.shieldAmount)
      if (skill.status === 'empower') applyStatus(battle, ally, 'empower')
      hitAny = true
    }
  } else if (skill.target === 'ally') {
    // Support skill can be cast on any tile in range (heals/shields whoever sits there, or whiffs on empty space!)
    for (const c of affected) {
      const unit = unitAt(battle, c.col, c.row)
      if (!unit) continue
      applyHealAndShield(state, unit, skill.healAmount, skill.shieldAmount)
      if (skill.status === 'empower') applyStatus(battle, unit, 'empower')
      hitAny = true
    }
  } else {
    // Offensive skill: can target empty spaces AND allies (friendly fire!)
    const directTarget = unitAt(battle, col, row)
    const isDawnsJudgmentSafe = skill.id === 'dawns_judgment' && (!directTarget || directTarget.team !== caster.team)
    if (skill.shieldAmount > 0 && skill.pattern !== 'aura') {
      applyHealAndShield(state, caster, 0, skill.shieldAmount)
    }
    if (skill.healAmount > 0 && skill.pattern === 'single') {
      applyHealAndShield(state, caster, skill.healAmount, 0)
    }
    for (const c of affected) {
      const target = unitAt(battle, c.col, c.row)
      if (!target) continue
      // Don't self-hit from splash around an adjacent tile unless caster directly targeted own space
      if (target.uid === caster.uid && !(col === caster.col && row === caster.row)) continue
      if (isDawnsJudgmentSafe && target.team === caster.team) {
        applyHealAndShield(state, target, skill.healAmount, skill.shieldAmount)
        hitAny = true
        continue
      }
      if (skill.powerMul > 0) {
        const raw = caster.atk * skill.powerMul + skill.flatBonus
        applyDamage(state, caster, target, raw, skill.ignoreArmor, true)
        if (skill.status && skill.status !== 'empower' && target.alive) {
          applyStatus(battle, target, skill.status)
        }
        hitAny = true
      }
    }
    if (skill.status === 'empower') applyStatus(battle, caster, 'empower')
  }

  if (!hitAny) {
    addFloat(battle, tx, ty + 0.1, tz, 'NO TARGET', '#b8c7e6')
  }

  checkBattleOutcome(state)
}

function executeTacticCard(state: GameState, tacticUid: string, col: number, row: number): boolean {
  const battle = state.battle
  if (!battle) return false
  const handIdx = battle.hand.indexOf(tacticUid)
  if (handIdx < 0) return false
  const owned = getTacticByUid(state.campaign, tacticUid)
  if (!owned) return false
  const spec = TACTIC_BY_ID[owned.tacticId]
  if (!spec || battle.ap < spec.cost) return false

  const valid = battle.targetTiles.some(t => t.col === col && t.row === row)
  if (!valid) return false

  battle.ap -= spec.cost
  if (spec.apGain > 0) battle.ap += spec.apGain
  battle.hand.splice(handIdx, 1)
  battle.discardPile.push(tacticUid)
  battle.armedTacticUid = null
  state.sounds.push({ kind: 'card' })

  const cell = battle.cells[row][col]
  const [tx, ty, tz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)

  if (spec.pattern === 'all_allies') {
    for (const u of battle.units) {
      if (!u.alive || u.team !== 'ally') continue
      applyHealAndShield(state, u, spec.heal, spec.shield)
      if (spec.status) applyStatus(battle, u, spec.status)
    }
    const allyCells: Vec3[] = []
    for (const u of battle.units) {
      if (u.alive && u.team === 'ally') allyCells.push([u.x, u.y, u.z])
    }
    state.vfx.push({ kind: 'tactic', tacticId: spec.id, style: spec.vfx, at: [tx, ty, tz], cells: allyCells, casterUid: tacticCasterUid(battle) })
  } else {
    const cells = getPatternCells(col, row, spec.pattern, battle.cols, battle.rows)
    state.vfx.push({
      kind: 'tactic',
      tacticId: spec.id,
      style: spec.vfx,
      at: [tx, ty, tz],
      cells: cellCentres(battle, cells),
      casterUid: tacticCasterUid(battle)
    })
    for (const c of cells) {
      const target = unitAt(battle, c.col, c.row)
      if (!target) continue
      if (spec.damage > 0 && target.team === 'enemy') {
        applyDamage(state, null, target, spec.damage, 0.6, false)
        if (spec.status && spec.status !== 'empower' && target.alive) {
          applyStatus(battle, target, spec.status)
        }
      }
      if (target.team === 'ally') {
        if (spec.heal > 0 || spec.shield > 0) applyHealAndShield(state, target, spec.heal, spec.shield)
        if (spec.status === 'empower') applyStatus(battle, target, 'empower')
        if (spec.refreshMove) {
          target.moved = false
          addFloat(battle, target.x, target.y + 0.55, target.z, 'MOVE +1', '#8ef5ff')
        }
      }
    }
  }

  checkBattleOutcome(state)
  refreshHighlights(battle, state.campaign)
  return true
}

export function selectHeroByUid(state: GameState, uid: string): boolean {
  const battle = state.battle
  if (!battle) return false
  const unit = getUnitByUid(battle, uid)
  if (!unit) return false
  battle.selectedUnitUid = unit.uid
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  battle.pendingAction = null
  refreshHighlights(battle, state.campaign)
  state.sounds.push({ kind: 'card', pitch: 1.1 })
  return true
}

export function armSkill(state: GameState, skillIndex: number | null): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'player') return false
  const unit = getUnitByUid(battle, battle.activeUnitUid)
  if (!unit || unit.team !== 'ally' || unit.acted || unit.stunTurns > 0) return false

  battle.selectedUnitUid = unit.uid
  battle.armedTacticUid = null
  battle.pendingAction = null
  if (skillIndex === null || battle.armedSkillIndex === skillIndex) {
    battle.armedSkillIndex = null
    refreshHighlights(battle, state.campaign)
    return true
  }

  const skill = getHeroSkill(unit, skillIndex)
  if (!skill || unit.cooldowns[skillIndex] > 0) return false
  if (skill.target === 'self') {
    executeHeroSkill(state, unit, skillIndex, unit.col, unit.row)
    battle.armedSkillIndex = null
    refreshHighlights(battle, state.campaign)
    return true
  }
  battle.armedSkillIndex = skillIndex
  refreshHighlights(battle, state.campaign)
  state.sounds.push({ kind: 'card', pitch: 1.25 })
  return true
}

export function armTacticCard(state: GameState, tacticUid: string | null): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'player') return false
  battle.pendingAction = null
  if (tacticUid === null || battle.armedTacticUid === tacticUid) {
    battle.armedTacticUid = null
    refreshHighlights(battle, state.campaign)
    return true
  }
  const owned = getTacticByUid(state.campaign, tacticUid)
  if (!owned) return false
  const spec = TACTIC_BY_ID[owned.tacticId]
  if (!spec || battle.ap < spec.cost) return false

  // All-allies blessing fires immediately upon clicking the card!
  if (spec.pattern === 'all_allies') {
    battle.armedTacticUid = tacticUid
    refreshHighlights(battle, state.campaign)
    const first = battle.targetTiles[0]
    if (first) return executeTacticCard(state, tacticUid, first.col, first.row)
    return false
  }

  battle.armedSkillIndex = null
  battle.armedTacticUid = tacticUid
  refreshHighlights(battle, state.campaign)
  state.sounds.push({ kind: 'card', pitch: 1.18 })
  return true
}

export function selectTile(state: GameState, col: number, row: number): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'player' || !isCellInBounds(col, row, battle.cols, battle.rows)) return false

  // Wait if a unit is currently mid-stride along a path
  if (battle.units.some(u => u.path.length > 0)) return false

  // 1. Tactic Card armed?
  if (battle.armedTacticUid) {
    if (executeTacticCard(state, battle.armedTacticUid, col, row)) return true
    battle.armedTacticUid = null
    refreshHighlights(battle, state.campaign)
    return false
  }

  const active = getUnitByUid(battle, battle.activeUnitUid)

  // 2. Hero Skill armed?
  if (active && battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0) {
    const valid = battle.targetTiles.some(t => t.col === col && t.row === row)
    if (valid) {
      executeHeroSkill(state, active, battle.armedSkillIndex, col, row)
      battle.armedSkillIndex = null
      refreshHighlights(battle, state.campaign)
      return true
    }
    const moveSkill = !active.moved
      ? battle.moveAttackTiles.find(t => t.col === col && t.row === row)
      : undefined
    if (moveSkill) {
      const path = findGridPath(battle, active, moveSkill.fromCol, moveSkill.fromRow)
      if (path.length > 0) {
        active.path = path
        active.moveProgress = 0
        active.moved = true
        active.animState = 'run'
        battle.selectedUnitUid = active.uid
        battle.pendingAction = { col, row, skillIndex: battle.armedSkillIndex }
        battle.moveTiles = []
        battle.targetTiles = []
        battle.moveAttackTiles = []
        state.sounds.push({ kind: 'step' })
        return true
      }
    }
    battle.armedSkillIndex = null
    refreshHighlights(battle, state.campaign)
  }

  // 3. Click on a highlighted target enemy -> Basic Attack or Move+Attack by active hero!
  const clickedUnit = unitAt(battle, col, row)
  if (active && clickedUnit && clickedUnit.team === 'enemy') {
    const inRange = battle.targetTiles.some(t => t.col === col && t.row === row)
    if (inRange) {
      executeBasicAttack(state, active, clickedUnit)
      refreshHighlights(battle, state.campaign)
      return true
    }
    const moveStrike = !active.moved && !active.acted
      ? battle.moveAttackTiles.find(t => t.col === col && t.row === row)
      : undefined
    if (moveStrike) {
      const path = findGridPath(battle, active, moveStrike.fromCol, moveStrike.fromRow)
      if (path.length > 0) {
        active.path = path
        active.moveProgress = 0
        active.moved = true
        active.animState = 'run'
        battle.selectedUnitUid = active.uid
        battle.pendingAction = { col, row, skillIndex: null }
        battle.moveTiles = []
        battle.targetTiles = []
        battle.moveAttackTiles = []
        state.sounds.push({ kind: 'step' })
        return true
      }
    }
  }

  // 4. Click on a blue reachable move tile -> move active hero along grid path!
  if (active && !active.moved) {
    const canMove = battle.moveTiles.some(t => t.col === col && t.row === row)
    if (canMove) {
      const path = findGridPath(battle, active, col, row)
      if (path.length > 0) {
        active.path = path
        active.moveProgress = 0
        active.moved = true
        active.animState = 'run'
        battle.selectedUnitUid = active.uid
        battle.pendingAction = null
        battle.moveTiles = []
        battle.targetTiles = []
        battle.moveAttackTiles = []
        state.sounds.push({ kind: 'step' })
        return true
      }
    }
  }

  // 5. Click any unit to inspect them on the HUD without losing the active hero's turn
  if (clickedUnit) {
    return selectHeroByUid(state, clickedUnit.uid)
  }

  return false
}

function isBattleEnded(battle: BattleState): boolean {
  return battle.phase === 'victory' || battle.phase === 'defeat'
}

function advanceToNextUnitTurn(state: GameState, initial = false): void {
  const battle = state.battle
  if (!battle || isBattleEnded(battle)) return

  let guard = 0
  while (guard++ < 300) {
    checkBattleOutcome(state)
    if (isBattleEnded(battle)) return

    const alive = battle.units.filter(u => u.alive)
    if (!alive.length) return

    let next: BattleUnit | null = null
    for (const u of alive) {
      if (u.ct < 100) continue
      if (!next) { next = u; continue }
      const uSpd = effectiveSpeed(u)
      const nSpd = effectiveSpeed(next)
      if (u.ct > next.ct) next = u
      else if (u.ct === next.ct && uSpd > nSpd) next = u
      else if (u.ct === next.ct && uSpd === nSpd && u.team === 'ally' && next.team === 'enemy') next = u
    }

    if (!next) {
      for (const u of alive) u.ct += effectiveSpeed(u)
      continue
    }

    battle.turn += 1
    battle.activeUnitUid = next.uid
    battle.selectedUnitUid = next.uid
    battle.armedSkillIndex = null
    battle.armedTacticUid = null
    battle.pendingAction = null
    next.moved = false
    next.acted = false

    // Start-of-unit-turn ticks (cooldowns, burn, slow, empower, shrine heal)
    for (let i = 0; i < 3; i++) {
      if (next.cooldowns[i] > 0) next.cooldowns[i] -= 1
    }
    if (next.burnTurns > 0) {
      next.burnTurns -= 1
      applyDamage(state, null, next, 8, 1, false)
      if (!next.alive) {
        checkBattleOutcome(state)
        continue
      }
    }
    if (next.slowTurns > 0) next.slowTurns -= 1
    if (next.empowerTurns > 0) next.empowerTurns -= 1
    if (next.team === 'ally' && battle.cells[next.row][next.col].terrain === 'shrine' && next.hp < next.maxHp) {
      applyHealAndShield(state, next, 14, 0)
    }

    if (next.stunTurns > 0) {
      next.stunTurns -= 1
      next.ct = Math.max(0, next.ct - 100)
      addFloat(battle, next.x, next.y, next.z, 'STUNNED', '#ffdf59')
      continue
    }

    if (next.team === 'ally') {
      battle.phase = 'player'
      battle.ap = Math.min(battle.maxAp, battle.ap + (initial ? 1 : 2))
      drawTacticCards(battle, state.campaign, 4)
      if (!initial) {
        battle.bannerText = `${next.name.toUpperCase()}'S TURN`
        battle.bannerTimer = 1.05
      }
      state.sounds.push({ kind: 'turn', team: 'ally' })
      refreshHighlights(battle, state.campaign)
      return
    }

    battle.phase = 'enemy'
    battle.moveTiles = []
    battle.targetTiles = []
    battle.moveAttackTiles = []
    battle.pendingAction = null
    battle.enemyDelay = 0.34
    battle.enemyActedThisTurn = false
    battle.bannerText = `${next.name.toUpperCase()} ACTS`
    battle.bannerTimer = 0.95
    battle.turnOrder = computeTurnOrderPreview(battle, 8)
    state.sounds.push({ kind: 'turn', team: 'enemy' })
    return
  }
}

export function endPlayerTurn(state: GameState): void {
  const battle = state.battle
  if (!battle || battle.phase !== 'player') return
  battle.pendingAction = null
  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (active) {
    // Classic Tactics CT Wait Bonus: waiting or only moving recovers CT faster!
    const ctCost = active.moved && active.acted ? 100 : (active.moved || active.acted) ? 80 : 60
    active.ct = Math.max(0, active.ct - ctCost)
    if (ctCost < 100) {
      addFloat(battle, active.x, active.y, active.z, `WAIT +${100 - ctCost} CT`, '#8ce8ff')
    }
  }
  advanceToNextUnitTurn(state)
}

function executeEnemyUnitTurn(state: GameState, enemy: BattleUnit): void {
  const battle = state.battle
  if (!battle || !enemy.alive) return
  if (enemy.stunTurns > 0) {
    enemy.stunTurns -= 1
    addFloat(battle, enemy.x, enemy.y, enemy.z, 'STUNNED', '#ffdf59')
    return
  }

  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  if (!allies.length) return

  const spec = enemy.enemyId ? ENEMY_SPECS[enemy.enemyId] : ENEMY_SPECS.goblin

  // Support shaman heals injured comrade if possible
  if (spec.ai === 'support') {
    const hurt = battle.units
      .filter(u => u.alive && u.team === 'enemy' && u.hp < u.maxHp * 0.8)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0]
    if (hurt && manhattan(enemy.col, enemy.row, hurt.col, hurt.row) <= enemy.range) {
      faceToward(enemy, hurt.x, hurt.z)
      enemy.animState = 'cast'
      enemy.animTimer = 0.42
      state.vfx.push({ kind: 'special', uid: enemy.uid, move: 'shaman_mend', at: [hurt.x, hurt.y, hurt.z], cells: [[hurt.x, hurt.y, hurt.z]] })
      applyHealAndShield(state, hurt, 22, 6)
      return
    }
  }

  // Pick nearest/best hero target
  const target = allies
    .slice()
    .sort((a, b) => {
      const da = manhattan(enemy.col, enemy.row, a.col, a.row)
      const db = manhattan(enemy.col, enemy.row, b.col, b.row)
      if (spec.ai === 'ranged' && da <= enemy.range && db <= enemy.range) return a.hp - b.hp
      return da - db
    })[0]
  if (!target) return

  // Move if not already in ideal range
  const distNow = manhattan(enemy.col, enemy.row, target.col, target.row)
  if (distNow > enemy.range || (spec.ai === 'ranged' && distNow === 1)) {
    const moveOptions = computeMoveTiles(battle, enemy)
    let bestTile: { col: number; row: number } | null = null
    let bestScore = -9999
    for (const tile of moveOptions) {
      const d = manhattan(tile.col, tile.row, target.col, target.row)
      const elev = battle.cells[tile.row][tile.col].elevation
      let score = -d * 10 + elev * 4
      if (d <= enemy.range) {
        const arc = computeAttackArc(tile.col, tile.row, target.col, target.row, target.facing)
        if (arc === 'back') score += 18
        else if (arc === 'flank') score += 9
      }
      if (spec.ai === 'ranged') {
        score = d <= enemy.range && d >= 2 ? 40 - d * 2 + elev * 8 : -Math.abs(d - enemy.range) * 10
      }
      if (score > bestScore) {
        bestScore = score
        bestTile = tile
      }
    }
    if (bestTile) {
      const path = findGridPath(battle, enemy, bestTile.col, bestTile.row)
      if (path.length > 0) {
        enemy.path = path
        enemy.moveProgress = 0
        enemy.moved = true
        enemy.animState = 'run'
        state.sounds.push({ kind: 'step', pitch: 0.8 })
        return // Will attack once movement finishes in stepGame!
      }
    }
  }

  performEnemyAttack(state, enemy, target)
}

function performEnemyAttack(state: GameState, enemy: BattleUnit, target: BattleUnit): void {
  const battle = state.battle
  if (!battle || !enemy.alive || !target.alive) return
  if (manhattan(enemy.col, enemy.row, target.col, target.row) > enemy.range) return

  // Boss special every odd/even turn: Eclipse Nova cross AoE!
  if (enemy.isBoss && battle.turn % 2 === 0) {
    faceToward(enemy, target.x, target.z)
    enemy.animState = 'cast'
    enemy.animTimer = 0.50
    enemy.acted = true
    state.sounds.push({ kind: 'magic', pitch: 0.72 })
    const novaCells = getPatternCells(target.col, target.row, 'cross', battle.cols, battle.rows)
    state.vfx.push({
      kind: 'special',
      uid: enemy.uid,
      move: 'eclipse_nova',
      at: [target.x, target.y, target.z],
      cells: cellCentres(battle, novaCells)
    })
    for (const c of novaCells) {
      const victim = unitAt(battle, c.col, c.row)
      if (victim && victim.team === 'ally') {
        applyDamage(state, enemy, victim, enemy.atk * 1.15, 0.35, false)
        if (victim.alive) applyStatus(battle, victim, 'burn')
      }
    }
    checkBattleOutcome(state)
    return
  }

  executeBasicAttack(state, enemy, target)
}

export function stepGame(state: GameState, dt: number): void {
  const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0
  state.time += safeDt
  const battle = state.battle
  if (!battle) return

  if (battle.bannerTimer > 0) battle.bannerTimer = Math.max(0, battle.bannerTimer - safeDt)
  if (battle.shake > 0) battle.shake = Math.max(0, battle.shake - safeDt * 1.8)

  // Floating combat numbers
  for (let i = battle.floatingNumbers.length - 1; i >= 0; i--) {
    const fn = battle.floatingNumbers[i]
    fn.age += safeDt
    fn.y += safeDt * 0.95
    if (fn.age >= fn.duration) battle.floatingNumbers.splice(i, 1)
  }

  // Unit smooth grid movement, lunges, and animation timers
  let anyMoving = false
  for (const u of battle.units) {
    if (!u.alive) continue
    if (u.hitFlash > 0) u.hitFlash = Math.max(0, u.hitFlash - safeDt)
    u.lungeX *= Math.pow(0.001, safeDt)
    u.lungeZ *= Math.pow(0.001, safeDt)

    if (u.path.length > 0) {
      anyMoving = true
      const next = u.path[0]
      const fromCell = battle.cells[u.row][u.col]
      const toCell = battle.cells[next.row][next.col]
      const [fx, fy, fz] = gridToWorld(u.col, u.row, fromCell.elevation, battle.cols, battle.rows)
      const [tx, ty, tz] = gridToWorld(next.col, next.row, toCell.elevation, battle.cols, battle.rows)
      faceToward(u, tx, tz)

      u.moveProgress += safeDt * 5.2
      if (u.moveProgress >= 1) {
        u.col = next.col
        u.row = next.row
        u.x = tx
        u.y = ty
        u.z = tz
        u.path.shift()
        u.moveProgress = 0
        if (u.path.length === 0) {
          u.animState = 'idle'
          if (u.team === 'ally' && battle.phase === 'player') {
            const pending = battle.pendingAction
            battle.pendingAction = null
            if (pending && u.uid === battle.activeUnitUid && !u.acted) {
              if (pending.skillIndex !== null && pending.skillIndex >= 0) {
                executeHeroSkill(state, u, pending.skillIndex, pending.col, pending.row)
                battle.armedSkillIndex = null
              } else {
                const target = unitAt(battle, pending.col, pending.row)
                if (target && target.team === 'enemy' && manhattan(u.col, u.row, target.col, target.row) <= u.range) {
                  executeBasicAttack(state, u, target)
                }
              }
            }
            if (battle.phase === 'player') {
              refreshHighlights(battle, state.campaign)
            }
          } else if (u.team === 'enemy' && battle.phase === 'enemy' && !u.acted) {
            const allies = battle.units.filter(a => a.alive && a.team === 'ally')
            const nearest = allies.sort(
              (a, b) => manhattan(u.col, u.row, a.col, a.row) - manhattan(u.col, u.row, b.col, b.row)
            )[0]
            if (nearest) {
              faceToward(u, nearest.x, nearest.z)
              performEnemyAttack(state, u, nearest)
            }
          }
        }
      } else {
        const t = u.moveProgress
        const hop = Math.sin(t * Math.PI) * 0.28
        u.x = fx + (tx - fx) * t
        u.z = fz + (tz - fz) * t
        u.y = fy + (ty - fy) * t + hop
      }
    } else if (u.animTimer > 0) {
      u.animTimer = Math.max(0, u.animTimer - safeDt)
      if (u.animTimer === 0 && u.animState !== 'celebrate') {
        u.animState = 'idle'
      }
    }
  }

  // Single active Enemy AI Unit Turn on the Speed/CT timeline
  if (battle.phase === 'enemy' && !anyMoving) {
    battle.enemyDelay -= safeDt
    if (battle.enemyDelay <= 0) {
      const enemy = getUnitByUid(battle, battle.activeUnitUid)
      if (!enemy || !enemy.alive) {
        advanceToNextUnitTurn(state)
      } else if (!battle.enemyActedThisTurn) {
        battle.enemyActedThisTurn = true
        executeEnemyUnitTurn(state, enemy)
        battle.enemyDelay = 0.42
      } else {
        enemy.ct = Math.max(0, enemy.ct - 100)
        advanceToNextUnitTurn(state)
      }
    }
  }
}
