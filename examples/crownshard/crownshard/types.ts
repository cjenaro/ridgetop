import type { Vec3 } from 'ridgetop'

export const GRID_COLS = 8
export const GRID_ROWS = 6
export const TILE_SIZE = 1.65

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export type HeroClassId =
  | 'knight'
  | 'archer'
  | 'mage'
  | 'cleric'
  | 'rogue'
  | 'paladin'
  | 'cryomancer'
  | 'champion'

export type EnemyArchetypeId =
  | 'goblin'
  | 'bone_archer'
  | 'orc_brute'
  | 'bog_shaman'
  | 'crypt_knight'
  | 'frost_golem'
  | 'eclipse_archon'

export type EquipSlot = 'weapon' | 'armor' | 'relic'

export type CardKind = 'hero' | 'weapon' | 'armor' | 'relic' | 'tactic'

export type PackId = 'recruit' | 'vanguard' | 'sovereign'

export type TileTerrain =
  | 'grass'
  | 'stone'
  | 'hill'
  | 'bridge'
  | 'water'
  | 'shrine'
  | 'pillar'
  | 'lava'
  | 'snow'
  | 'darkstone'

export type BiomeId = 'meadow' | 'river' | 'crypt' | 'frost' | 'volcano' | 'throne'

export type SkillTarget = 'enemy' | 'ally' | 'self' | 'tile' | 'empty_near_enemy'

export type SkillPattern = 'single' | 'cross' | 'area3' | 'line' | 'aura' | 'self'

export interface SkillSpec {
  readonly id: string
  readonly name: string
  readonly tier: 1 | 2 | 3
  readonly desc: string
  readonly range: number
  readonly cooldown: number
  readonly target: SkillTarget
  readonly pattern: SkillPattern
  readonly powerMul: number
  readonly flatBonus: number
  readonly healAmount: number
  readonly shieldAmount: number
  readonly ignoreArmor: number
  readonly status?: 'burn' | 'slow' | 'stun' | 'empower'
  readonly vfx: 'slash' | 'arrow' | 'arcane' | 'fire' | 'frost' | 'holy' | 'shadow'
}

export interface HeroSpec {
  readonly id: HeroClassId
  readonly name: string
  readonly title: string
  readonly rarity: Rarity
  readonly maxHp: number
  readonly atk: number
  readonly def: number
  readonly speed: number
  readonly move: number
  readonly range: number
  readonly crit: number
  readonly lore: string
  readonly skills: readonly [SkillSpec, SkillSpec, SkillSpec]
}

export interface EquipmentSpec {
  readonly id: string
  readonly name: string
  readonly slot: EquipSlot
  readonly rarity: Rarity
  readonly desc: string
  readonly atk: number
  readonly def: number
  readonly hp: number
  readonly speed: number
  readonly move: number
  readonly range: number
  readonly crit: number
  readonly lifesteal: number
  readonly shieldStart: number
  readonly accentHex: string
}

export interface TacticCardSpec {
  readonly id: string
  readonly name: string
  readonly rarity: Rarity
  readonly cost: number
  readonly target: 'enemy' | 'ally' | 'tile' | 'any'
  readonly pattern: 'single' | 'cross' | 'area3' | 'all_allies'
  readonly desc: string
  readonly damage: number
  readonly heal: number
  readonly shield: number
  readonly apGain: number
  readonly status?: 'burn' | 'slow' | 'stun' | 'empower'
  readonly refreshMove?: boolean
  readonly vfx: 'fire' | 'frost' | 'holy' | 'arcane' | 'slash' | 'shadow'
}

export type StageKind = 'story' | 'special' | 'treasure' | 'elite' | 'boss' | 'town'

export type LandmarkKind =
  | 'watchtower'
  | 'bridge'
  | 'shrine'
  | 'crypt'
  | 'vault'
  | 'pass'
  | 'citadel'
  | 'gate'
  | 'throne'
  | 'forest'
  | 'lake'
  | 'foundry'
  | 'town'
  | 'ruins'
  | 'peak'
  | 'arena'
  | 'atoll'
  | 'abyss'

export type WorldRegionId =
  | 'solis_vale'
  | 'silverfen'
  | 'ashen_catacombs'
  | 'frostspire'
  | 'emberwaste'
  | 'eclipse_dominion'
  | 'sunbleached_dunes'
  | 'aether_isles'
  | 'shattered_expanse'

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export type FacingDir = 'n' | 's' | 'e' | 'w'

export type AttackArc = 'front' | 'flank' | 'back'

export interface PackSpec {
  readonly id: PackId
  readonly name: string
  readonly subtitle: string
  readonly cost: number
  readonly cardsPerPack: number
  readonly guaranteedMinRarity: Rarity
  readonly weights: Record<Rarity, number>
  readonly featuredWeights?: Record<Rarity, number>
  readonly accentHex: string
}

export interface EnemySpec {
  readonly id: EnemyArchetypeId
  readonly name: string
  readonly maxHp: number
  readonly atk: number
  readonly def: number
  readonly speed: number
  readonly move: number
  readonly range: number
  readonly ai: 'melee' | 'ranged' | 'support' | 'boss'
  readonly isBoss?: boolean
}

export interface ChapterEnemySpawn {
  readonly id: EnemyArchetypeId
  readonly col: number
  readonly row: number
  readonly levelScale?: number
}

export interface ChapterSpec {
  readonly id: string
  readonly index: number
  readonly region: WorldRegionId
  readonly landmark: LandmarkKind
  readonly kind: StageKind
  readonly difficulty: DifficultyLevel
  readonly recommendedPower: number
  readonly mapX: number
  readonly mapY: number
  readonly requires: readonly string[]
  readonly unlockMode?: 'all' | 'any'
  readonly seaRoute?: boolean
  readonly comingSoon?: boolean
  readonly soonNote?: string
  readonly specialTag?: string
  readonly modifierDesc?: string
  readonly unlocksSlot4?: boolean
  readonly unlocksEndless?: boolean
  readonly title: string
  readonly subtitle: string
  readonly biome: BiomeId
  readonly introSpeaker: string
  readonly introText: string
  readonly outroSpeaker: string
  readonly outroText: string
  readonly rewardGold: number
  readonly replayGold: number
  readonly rewardEquipId: string | null
  readonly rewardHeroId: HeroClassId | null
  readonly grid: readonly (readonly TileTerrain[])[]
  readonly heroSpawns: readonly (readonly [number, number])[]
  readonly enemies: readonly ChapterEnemySpawn[]
}

export interface OwnedHeroCard {
  readonly uid: string
  readonly heroId: HeroClassId
  stars: 1 | 2 | 3
  weaponUid: string | null
  armorUid: string | null
  relicUid: string | null
}

export interface OwnedEquipCard {
  readonly uid: string
  readonly equipId: string
  readonly slot: EquipSlot
}

export interface OwnedTacticCard {
  readonly uid: string
  readonly tacticId: string
}

export interface PackRevealItem {
  readonly kind: CardKind
  readonly uid: string
  readonly refId: string
  readonly name: string
  readonly rarity: Rarity
  readonly detail: string
  readonly value: number
  readonly isNew: boolean
}

export interface GridCell {
  readonly col: number
  readonly row: number
  readonly terrain: TileTerrain
  readonly elevation: number
  readonly walkable: boolean
}

export interface BattleUnit {
  readonly uid: string
  readonly team: 'ally' | 'enemy'
  readonly name: string
  readonly heroId?: HeroClassId
  readonly enemyId?: EnemyArchetypeId
  readonly stars: 1 | 2 | 3
  readonly isBoss: boolean
  readonly weaponHex?: string
  readonly armorHex?: string
  readonly weaponId?: string
  readonly armorId?: string
  readonly relicId?: string
  col: number
  row: number
  x: number
  z: number
  y: number
  yaw: number
  facing: FacingDir
  path: { col: number; row: number }[]
  moveProgress: number
  hp: number
  maxHp: number
  shield: number
  atk: number
  def: number
  speed: number
  ct: number
  move: number
  range: number
  crit: number
  lifesteal: number
  moved: boolean
  acted: boolean
  alive: boolean
  burnTurns: number
  slowTurns: number
  stunTurns: number
  empowerTurns: number
  cooldowns: [number, number, number]
  animState: 'idle' | 'run' | 'attack' | 'hit' | 'cast' | 'celebrate'
  animTimer: number
  hitFlash: number
  lungeX: number
  lungeZ: number
}

export interface FloatingNumber {
  id: number
  x: number
  y: number
  z: number
  text: string
  color: string
  age: number
  duration: number
}

export type SoundEvent =
  | { kind: 'step'; pitch?: number }
  | { kind: 'slash'; pitch?: number }
  | { kind: 'arrow'; pitch?: number }
  | { kind: 'magic'; pitch?: number }
  | { kind: 'heal'; pitch?: number }
  | { kind: 'shield'; pitch?: number }
  | { kind: 'hit'; pitch?: number }
  | { kind: 'crit'; pitch?: number }
  | { kind: 'ko'; pitch?: number }
  | { kind: 'card'; pitch?: number }
  | { kind: 'coin'; pitch?: number }
  | { kind: 'pack'; rarity: Rarity }
  | { kind: 'merge' }
  | { kind: 'equip' }
  | { kind: 'turn'; team: 'ally' | 'enemy' }
  | { kind: 'victory' }
  | { kind: 'defeat' }

export type VfxEvent =
  | { kind: 'projectile'; style: 'arrow' | 'arcane' | 'fire' | 'frost' | 'holy' | 'shadow'; from: Vec3; to: Vec3 }
  | { kind: 'burst'; style: 'slash' | 'fire' | 'frost' | 'holy' | 'arcane' | 'shadow' | 'gold'; at: Vec3; radius?: number }
  | { kind: 'heal'; at: Vec3 }
  | { kind: 'shield'; at: Vec3 }
  | { kind: 'ko'; at: Vec3; isBoss?: boolean }
  | { kind: 'levelup'; at: Vec3 }

export interface BattleReward {
  readonly gold: number
  readonly equipCard: OwnedEquipCard | null
  readonly heroCard: OwnedHeroCard | null
  readonly tacticCard: OwnedTacticCard | null
  readonly stageId: string
  readonly chapterCleared: number
  readonly firstClear: boolean
  readonly specialRewardsClaimed: boolean
  readonly unlockedSlot4: boolean
  readonly campaignWon: boolean
}

export interface TurnPreviewEntry {
  readonly uid: string
  readonly team: 'ally' | 'enemy'
  readonly name: string
  readonly heroId?: HeroClassId
  readonly enemyId?: EnemyArchetypeId
  readonly stars: 1 | 2 | 3
  readonly speed: number
  readonly isCurrent: boolean
}

export interface MoveAttackTile {
  readonly col: number
  readonly row: number
  readonly fromCol: number
  readonly fromRow: number
}

export interface PendingUnitAction {
  readonly col: number
  readonly row: number
  readonly skillIndex: number | null
}

export interface CombatForecastAlt {
  readonly skillIndex: number | null
  readonly keycap: string
  readonly name: string
  readonly normalDmg: number
  readonly critDmg: number
  readonly critChance: number
  readonly healAmount: number
  readonly selfShield: number
  readonly status?: 'burn' | 'slow' | 'stun' | 'empower'
  readonly lethalNormal: boolean
  readonly requiresMove: boolean
  readonly attackArc: AttackArc
  readonly active: boolean
}

export interface CombatForecast {
  readonly mode: 'strike' | 'skill' | 'tactic'
  readonly actionName: string
  readonly skillIndex: number | null
  readonly attackerUid: string | null
  readonly attackerName: string
  readonly attackerHeroId?: HeroClassId
  readonly attackerStars: 1 | 2 | 3
  readonly targetUid: string | null
  readonly targetName: string
  readonly targetTeam: 'ally' | 'enemy' | 'none'
  readonly targetHeroId?: HeroClassId
  readonly targetEnemyId?: EnemyArchetypeId
  readonly targetCol: number
  readonly targetRow: number
  readonly approachCol: number
  readonly approachRow: number
  readonly requiresMove: boolean
  readonly path: readonly { readonly col: number; readonly row: number }[]
  readonly normalDmg: number
  readonly critDmg: number
  readonly critChance: number
  readonly healAmount: number
  readonly shieldAmount: number
  readonly selfShield: number
  readonly status?: 'burn' | 'slow' | 'stun' | 'empower'
  readonly highGround: boolean
  readonly empowered: boolean
  readonly attackArc: AttackArc
  readonly isOffensive: boolean
  readonly friendlyFire: boolean
  readonly friendlyFireCount: number
  readonly emptyTileTarget: boolean
  readonly ignoreArmor: number
  readonly aoeTargets: number
  readonly targetHpBefore: number
  readonly targetMaxHp: number
  readonly targetShieldBefore: number
  readonly targetHpAfterNormal: number
  readonly targetHpAfterCrit: number
  readonly lethalNormal: boolean
  readonly lethalCrit: boolean
  readonly alternatives: readonly CombatForecastAlt[]
}

export interface BattleState {
  readonly stageId: string
  readonly chapterIndex: number
  readonly endlessWave: number
  readonly difficulty: DifficultyLevel
  readonly cols: number
  readonly rows: number
  readonly biome: BiomeId
  readonly cells: GridCell[][]
  readonly units: BattleUnit[]
  turn: number
  phase: 'player' | 'enemy' | 'victory' | 'defeat'
  activeUnitUid: string | null
  selectedUnitUid: string | null
  turnOrder: TurnPreviewEntry[]
  armedSkillIndex: number | null // -1 = basic attack, 0..2 = unlocked hero skill
  armedTacticUid: string | null
  ap: number
  maxAp: number
  drawPile: string[]
  hand: string[]
  discardPile: string[]
  moveTiles: { col: number; row: number }[]
  targetTiles: { col: number; row: number }[]
  moveAttackTiles: MoveAttackTile[]
  pendingAction: PendingUnitAction | null
  enemyDelay: number
  enemyActedThisTurn: boolean
  floatingNumbers: FloatingNumber[]
  nextFloatId: number
  bannerText: string
  bannerTimer: number
  shake: number
  reward: BattleReward | null
}

export interface CampaignState {
  seed: number
  nextUid: number
  gold: number
  chaptersCleared: number
  clearedStageIds: string[]
  selectedStageId: string
  endlessBest: number
  battlesWon: number
  packsOpened: number
  heroes: OwnedHeroCard[]
  equipment: OwnedEquipCard[]
  tactics: OwnedTacticCard[]
  squadUids: string[]
  selectedCampHeroUid: string | null
  lastPackReveal: PackRevealItem[]
}

export interface GameState {
  time: number
  campaign: CampaignState
  battle: BattleState | null
  sounds: SoundEvent[]
  vfx: VfxEvent[]
}

export interface SaveData {
  version: 1
  campaign: CampaignState
}

export function gridToWorld(
  col: number,
  row: number,
  elevation = 0,
  cols = GRID_COLS,
  rows = GRID_ROWS
): [number, number, number] {
  const x = (col - (cols - 1) * 0.5) * TILE_SIZE
  const z = (row - (rows - 1) * 0.5) * TILE_SIZE
  return [x, elevation, z]
}

export function worldToGrid(
  x: number,
  z: number,
  cols = GRID_COLS,
  rows = GRID_ROWS
): { col: number; row: number } | null {
  const col = Math.round(x / TILE_SIZE + (cols - 1) * 0.5)
  const row = Math.round(z / TILE_SIZE + (rows - 1) * 0.5)
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null
  return { col, row }
}

export function terrainElevation(t: TileTerrain): number {
  if (t === 'hill') return 0.45
  if (t === 'pillar') return 1.15
  if (t === 'water' || t === 'lava') return -0.22
  if (t === 'bridge') return 0.08
  if (t === 'shrine') return 0.16
  return 0
}

export function terrainWalkable(t: TileTerrain): boolean {
  return t !== 'water' && t !== 'lava' && t !== 'pillar'
}

export function facingVector(dir: FacingDir): readonly [number, number] {
  if (dir === 'e') return [1, 0]
  if (dir === 'w') return [-1, 0]
  if (dir === 's') return [0, 1]
  return [0, -1]
}

export function facingToYaw(dir: FacingDir): number {
  if (dir === 'e') return Math.PI / 2
  if (dir === 'w') return -Math.PI / 2
  if (dir === 's') return 0
  return Math.PI
}

export function vectorToFacing(dc: number, dr: number, fallback: FacingDir = 'e'): FacingDir {
  if (dc === 0 && dr === 0) return fallback
  if (Math.abs(dc) >= Math.abs(dr)) return dc > 0 ? 'e' : 'w'
  return dr > 0 ? 's' : 'n'
}
