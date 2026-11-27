import type { Vec3 } from 'ridgetop'

export const GRID_COLS = 8
export const GRID_ROWS = 6
export const TILE_SIZE = 1.65
export const HEIGHT_STEP = 0.45
export const MAX_HEIGHT_LEVEL = 4
export const MAX_POISON_STACKS = 5
export const TAUNT_RADIUS = 4
export const KO_COUNTDOWN_TURNS = 3

export type StatusKind = 'burn' | 'slow' | 'stun' | 'empower' | 'taunt' | 'haste' | 'poison'

export type ElementKind = 'fire' | 'frost' | 'poison' | 'holy' | 'arcane'

export type ElementalComboId = 'shatter' | 'freeze' | 'wildfire' | 'combust'

export interface ElementalComboPreview {
  readonly id: ElementalComboId
  readonly label: string
  readonly badgeText: string
  readonly bonusDamage: number
  readonly extraStatus?: StatusKind
  readonly consumesStatus?: StatusKind
  readonly affectedTiles: readonly GridCoord[]
}

export const BARRICADE_DEFAULT_HP = 25
export const LAVA_GEYSER_DAMAGE = 12
export const LAVA_GEYSER_PERIOD = 2
export const CURSED_ALTAR_HP_COST = 10
export const TALL_GRASS_RANGED_COVER = 3
export const TALL_GRASS_RANGED_CRIT_REDUCTION = 0.12
export const OPPORTUNITY_ATTACK_DAMAGE_MUL = 0.75
export const COLLISION_IMPACT_DAMAGE = 10
export const LEDGE_STOP_DAMAGE = 12
export const FALL_DAMAGE_PER_LEVEL = 7
export const FALL_MIN_DROP_LEVELS = 2

export type DisplacementKind = 'knockback' | 'pull' | 'swap'

export interface DisplacementSpec {
  readonly kind: DisplacementKind
  readonly distance: number
}

export type DisplacementCollisionKind =
  | 'none'
  | 'wall'
  | 'pillar'
  | 'barricade'
  | 'edge'
  | 'unit'
  | 'void'
  | 'water'
  | 'lava'
  | 'cliff'

export interface DisplacementPreview {
  readonly kind: DisplacementKind
  readonly distance: number
  readonly fromCol: number
  readonly fromRow: number
  readonly toCol: number
  readonly toRow: number
  readonly actorToCol?: number
  readonly actorToRow?: number
  readonly path: readonly GridCoord[]
  readonly moved: boolean
  readonly collidedWith: DisplacementCollisionKind
  readonly collidedUnitUid?: string
  readonly collidedUnitName?: string
  readonly collidedCell?: GridCoord
  readonly collisionDmg: number
  readonly secondaryCollisionDmg: number
  readonly barricadeDmg: number
  readonly fallDrop: number
  readonly fallDmg: number
  readonly hazardKind: 'none' | 'lava_geyser' | 'cursed_altar' | 'ice'
  readonly hazardDmg: number
  readonly iceSlid: boolean
  readonly causesStun: boolean
  readonly causesSlow: boolean
  readonly causesBurn: boolean
  readonly totalBonusDmg: number
  readonly summaryTag: string
}

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
  | 'stairs'
  | 'void'
  | 'lava_geyser'
  | 'ice'
  | 'cursed_altar'
  | 'tall_grass'
  | 'barricade'

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
  readonly canRevive?: boolean
  readonly reviveHpRatio?: number
  readonly status?: StatusKind
  readonly selfStatus?: StatusKind
  readonly statusStacks?: number
  readonly displacement?: DisplacementSpec
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
  readonly jump: number
  readonly range: number
  readonly crit: number
  /** Optional Zone of Control sentinel override (defaults to melee `range <= 1`). */
  readonly zoc?: boolean
  /** Optional skirmisher trait allowing the unit to slip past opposing Zones of Control without provoking OA. */
  readonly evadeZoc?: boolean
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
  readonly jump?: number
  readonly range: number
  readonly crit: number
  readonly lifesteal: number
  readonly shieldStart: number
  readonly startStatus?: StatusKind
  readonly onHitStatus?: StatusKind
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
  readonly canRevive?: boolean
  readonly reviveHpRatio?: number
  readonly status?: StatusKind
  readonly statusStacks?: number
  readonly refreshMove?: boolean
  readonly displacement?: DisplacementSpec
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

export type StageDifficultyTier = 'normal' | 'veteran' | 'mythic'

export type StageMutatorId =
  | 'blood_moon'
  | 'arcane_surge'
  | 'fog_of_war'
  | 'iron_vanguard'
  | 'venom_mist'

export type FacingDir = 'n' | 's' | 'e' | 'w'

export const FACING_DIRS: readonly FacingDir[] = ['n', 'e', 's', 'w']

export type AttackArc = 'front' | 'flank' | 'back'

export type CounterAvoidReason = 'flank' | 'backstab' | 'ranged' | 'stunned' | 'lethal' | null

export type FacingExposureLevel = 'safe' | 'flank' | 'back'

export interface FacingThreatEntry {
  readonly enemyUid: string
  readonly enemyName: string
  readonly arc: AttackArc
  readonly inRangeNow: boolean
  readonly canReachNextTurn: boolean
  readonly distance: number
}

export interface FacingExposureReport {
  readonly facing: FacingDir
  readonly level: FacingExposureLevel
  readonly worstArc: AttackArc
  readonly backstabCount: number
  readonly flankCount: number
  readonly threats: readonly FacingThreatEntry[]
  readonly warningText: string | null
}

export interface FacingPickerState {
  readonly unitUid: string
  readonly originalFacing: FacingDir
  previewFacing: FacingDir
}

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
  readonly jump: number
  readonly range: number
  readonly ai: 'melee' | 'ranged' | 'support' | 'boss'
  readonly isBoss?: boolean
  /** Optional Zone of Control sentinel override (defaults to melee `range <= 1`). */
  readonly zoc?: boolean
  /** Optional skirmisher trait allowing the unit to evade opposing Zones of Control. */
  readonly evadeZoc?: boolean
}

export interface ChapterEnemySpawn {
  readonly id: EnemyArchetypeId
  readonly col: number
  readonly row: number
  readonly levelScale?: number
  readonly name?: string
}

export type BattlePhase = 'deploy' | 'player' | 'enemy' | 'victory' | 'defeat'

export type BattleObjectiveKind = 'rout' | 'assassinate' | 'defend' | 'seize'

export interface BattleObjectiveSpec {
  readonly kind: BattleObjectiveKind
  readonly label?: string
  readonly description?: string
  /** For 'assassinate': specific index in chapter.enemies or archetype ID (defaults to boss / index 0). */
  readonly targetEnemyIndex?: number
  readonly targetEnemyId?: EnemyArchetypeId
  readonly targetName?: string
  /** For 'defend': survive N player turns (or rout all enemies). */
  readonly targetTurns?: number
  /** For 'defend': sacred tile to protect; if an enemy steps onto it, Defeat. */
  readonly protectTile?: GridCoord
  readonly protectLabel?: string
  /** For 'seize': golden goal tile an ally must reach to win. */
  readonly goalTile?: GridCoord
  readonly goalLabel?: string
  /** For 'seize': battlefield treasure chests allies can claim by stepping onto them. */
  readonly chestTiles?: readonly GridCoord[]
  /** Number of chests required for victory (defaults to chestTiles.length when no goalTile, else 0). */
  readonly requiredChests?: number
  /** Optional turn limit (exceeding causes Defeat). */
  readonly turnLimit?: number
}

export interface BattleObjectiveState {
  readonly kind: BattleObjectiveKind
  readonly label: string
  readonly description: string
  readonly targetEnemyUid?: string
  readonly targetName?: string
  readonly targetTurns?: number
  readonly protectTile?: GridCoord
  readonly protectLabel?: string
  protectBreached: boolean
  readonly goalTile?: GridCoord
  readonly goalLabel?: string
  seized: boolean
  readonly chestTiles: readonly GridCoord[]
  claimedChests: GridCoord[]
  readonly requiredChests: number
  readonly turnLimit?: number
  roundsElapsed: number
  outcomeReason?: string
}

export interface BattleObjectiveEvaluation {
  readonly status: 'ongoing' | 'victory' | 'defeat'
  readonly reason: string | null
}

export interface BattleObjectiveSnapshot {
  readonly kind: BattleObjectiveKind
  readonly label: string
  readonly description: string
  readonly targetEnemyUid?: string
  readonly targetName?: string
  readonly targetTurns?: number
  readonly protectTile?: GridCoord
  readonly protectLabel?: string
  readonly protectBreached?: boolean
  readonly goalTile?: GridCoord
  readonly goalLabel?: string
  readonly seized?: boolean
  readonly chestTiles?: readonly GridCoord[]
  readonly claimedChests?: readonly GridCoord[]
  readonly requiredChests?: number
  readonly turnLimit?: number
  readonly roundsElapsed: number
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
  readonly heights?: readonly (readonly number[])[]
  readonly heroSpawns: readonly (readonly [number, number])[]
  readonly deployTiles?: readonly (readonly [number, number])[]
  readonly objective?: BattleObjectiveSpec
  readonly enemies: readonly ChapterEnemySpawn[]
}

export interface OwnedHeroCard {
  readonly uid: string
  readonly heroId: HeroClassId
  stars: 1 | 2 | 3
  level?: number
  xp?: number
  weaponUid: string | null
  armorUid: string | null
  relicUid: string | null
  locked?: boolean
}

export interface OwnedEquipCard {
  readonly uid: string
  readonly equipId: string
  readonly slot: EquipSlot
  locked?: boolean
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
  readonly convertedShards?: number
  readonly pityTriggered?: 'epic' | 'legendary'
}

export interface PackPityStatus {
  readonly packsSinceEpic: number
  readonly epicIn: number
  readonly packsSinceLegendary: number
  readonly legendaryIn: number
}

export interface GridCell {
  readonly col: number
  readonly row: number
  terrain: TileTerrain
  elevation: number
  walkable: boolean
  readonly heightLevel?: number
  shrineUsed?: boolean
  barricadeHp?: number
  barricadeMaxHp?: number
  geyserActive?: boolean
  altarUsed?: boolean
}

export interface BattleUnit {
  readonly uid: string
  readonly team: 'ally' | 'enemy'
  readonly name: string
  readonly heroId?: HeroClassId
  readonly enemyId?: EnemyArchetypeId
  readonly stars: 1 | 2 | 3
  level: number
  readonly isBoss: boolean
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
  jump: number
  range: number
  crit: number
  lifesteal: number
  moved: boolean
  acted: boolean
  alive: boolean
  downed: boolean
  koCountdown: number
  burnTurns: number
  slowTurns: number
  stunTurns: number
  empowerTurns: number
  tauntTurns: number
  hasteTurns: number
  poisonStacks: number
  cooldowns: [number, number, number]
  animState: 'idle' | 'run' | 'attack' | 'hit' | 'cast' | 'celebrate'
  animTimer: number
  hitFlash: number
  lungeX: number
  lungeZ: number
  crownbladeKoUsed?: boolean
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
  | { kind: 'projectile'; style: 'arrow' | 'arcane' | 'fire' | 'frost' | 'holy' | 'shadow'; from: Vec3; to: Vec3; uid?: string }
  | { kind: 'burst'; style: 'slash' | 'fire' | 'frost' | 'holy' | 'arcane' | 'shadow' | 'gold'; at: Vec3; radius?: number; uid?: string }
  /** Hero skill cast: the scene choreographs a bespoke rig clip + VFX keyed by skillId (cells = affected tile centres). */
  | { kind: 'skill'; uid: string; skillId: string; style: SkillSpec['vfx']; from: Vec3; at: Vec3; cells: Vec3[] }
  /** Tactic card resolved on the board (cells = affected tile centres, or every ally for all_allies cards). */
  | { kind: 'tactic'; tacticId: string; style: TacticCardSpec['vfx']; at: Vec3; cells: Vec3[]; casterUid: string | null }
  /** Damage landed on a unit: directional arc, crit, and whether a shield absorbed it entirely. */
  | { kind: 'impact'; uid: string; attackerUid: string | null; arc: AttackArc; crit: boolean; blocked: boolean; absorbed: number; damage: number }
  /** Coordinated Pincer / Follow-Up strike connecting attacker -> target <- assister. */
  | {
      kind: 'pincer'
      attackerUid: string
      assisterUid: string
      targetUid: string
      attackerPos: Vec3
      assisterPos: Vec3
      targetPos: Vec3
      damage: number
    }
  /** Enemy signature move (Archon Eclipse Nova, Bog Shaman totem mend, and raid-boss telegraphs). */
  | { kind: 'special'; uid: string; move: 'eclipse_nova' | 'shaman_mend' | 'lich_summon' | 'frostwyrm_breath' | 'titan_slam'; at: Vec3; cells: Vec3[] }
  /** Reactive elemental status combo detonation (Shatter, Freeze, Wildfire spread, Combust). */
  | { kind: 'combo'; combo: ElementalComboId; at: Vec3; cells: Vec3[]; bonusDamage: number }
  | { kind: 'heal'; at: Vec3 }
  | { kind: 'revive'; at: Vec3; uid?: string }
  | { kind: 'shield'; at: Vec3 }
  | { kind: 'ko'; at: Vec3; isBoss?: boolean; downed?: boolean }
  | { kind: 'levelup'; at: Vec3 }
  | {
      kind: 'displace'
      uid: string
      displacementKind: DisplacementKind
      from: Vec3
      to: Vec3
      collided?: DisplacementCollisionKind
      fallDrop?: number
      iceSlid?: boolean
    }

export interface BattleHeroXpGain {
  readonly uid: string
  readonly heroId: HeroClassId
  readonly name: string
  readonly xpGained: number
  readonly oldLevel: number
  readonly newLevel: number
  readonly levelsGained: number
  readonly currentXp: number
  readonly xpForNext: number
  readonly isMaxLevel: boolean
  readonly survived: boolean
}

export interface BattleReward {
  readonly gold: number
  readonly bonusDust?: number
  readonly bonusShards?: number
  readonly difficultyTier?: StageDifficultyTier
  readonly mutators?: readonly StageMutatorId[]
  readonly equipCard: OwnedEquipCard | null
  readonly heroCard: OwnedHeroCard | null
  readonly tacticCard: OwnedTacticCard | null
  readonly stageId: string
  readonly chapterCleared: number
  readonly firstClear: boolean
  readonly specialRewardsClaimed: boolean
  readonly unlockedSlot4: boolean
  readonly campaignWon: boolean
  readonly heroXpGains: readonly BattleHeroXpGain[]
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

export type TurnActionKind = 'wait' | 'act' | 'move_only' | 'move_and_act'

export interface TurnOrderActionPreview {
  readonly actionKind: TurnActionKind
  readonly activeUnitUid: string
  readonly activeUnitName: string
  readonly ctCost: number
  readonly ctSaved: number
  readonly remainingCt: number
  /** Projected next-turn timeline starting with the unit that acts next (matches battle.turnOrder after endPlayerTurn). */
  readonly projectedOrder: readonly TurnPreviewEntry[]
  /** 0-based index in `projectedOrder` where the active hero acts next (-1 if beyond `count`). */
  readonly projectedIndex: number
  /** 0-based index in a full-spend (100 CT) timeline where the active hero would act next (-1 if beyond search depth). */
  readonly baselineIndex: number
  /** Number of turn-order slots gained earlier compared to spending a full 100 CT turn. */
  readonly slotsGained: number
}

export interface MoveAttackTile {
  readonly col: number
  readonly row: number
  readonly fromCol: number
  readonly fromRow: number
}

export interface GridCoord {
  readonly col: number
  readonly row: number
}

export interface MoveUndoRecord {
  readonly uid: string
  readonly col: number
  readonly row: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly facing: FacingDir
  readonly yaw: number
}

export interface FlankThreatTile {
  readonly col: number
  readonly row: number
  readonly targetUid: string
  readonly arc: 'flank' | 'back'
  readonly fromCol: number
  readonly fromRow: number
}

export interface EnemyThreatMap {
  readonly enemyUid: string
  readonly moveTiles: readonly GridCoord[]
  readonly attackTiles: readonly GridCoord[]
  readonly flankThreatTiles: readonly FlankThreatTile[]
  readonly flankOriginTiles: readonly FlankThreatTile[]
}

export interface DangerZoneTile {
  readonly col: number
  readonly row: number
  readonly threatCount: number
  readonly enemyUids: readonly string[]
  readonly highestArc: AttackArc
  readonly hasFlankRisk: boolean
  readonly hasBackstabRisk: boolean
}

export interface DangerZoneMap {
  readonly tiles: readonly DangerZoneTile[]
  readonly enemyThreats: readonly EnemyThreatMap[]
}

export interface OpportunityAttackTrigger {
  readonly stepIndex: number
  readonly fromCol: number
  readonly fromRow: number
  readonly toCol: number
  readonly toRow: number
  readonly attackerUid: string
  readonly attackerName: string
  readonly attackerCol: number
  readonly attackerRow: number
  readonly projectedDamage: number
  readonly projectedHpLoss: number
  readonly attackArc: AttackArc
  readonly lethal: boolean
}

export interface PathOpportunityPreview {
  readonly triggers: readonly OpportunityAttackTrigger[]
  readonly totalDamage: number
  readonly totalHpLoss: number
  readonly lethal: boolean
}

export interface ZocTileInfo {
  readonly col: number
  readonly row: number
  readonly controllerUids: readonly string[]
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
  readonly isRevive?: boolean
  readonly status?: StatusKind
  readonly selfStatus?: StatusKind
  readonly pincerDmg?: number
  readonly lethalNormal: boolean
  readonly requiresMove: boolean
  readonly attackArc: AttackArc
  readonly canCounter?: boolean
  readonly counterDmg?: number
  readonly counterLethal?: boolean
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
  readonly status?: StatusKind
  readonly selfStatus?: StatusKind
  readonly targetTaunting?: boolean
  readonly highGround: boolean
  readonly elevationDiff: number
  readonly coverBonus: number
  readonly terrainDefBonus: number
  readonly empowered: boolean
  readonly attackArc: AttackArc
  readonly isOffensive: boolean
  readonly isRevive: boolean
  readonly reviveKoCountdown?: number
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
  readonly pincerAssisterUid?: string
  readonly pincerAssisterName?: string
  readonly pincerDmg?: number
  readonly pincerFromCol?: number
  readonly pincerFromRow?: number
  readonly canCounter?: boolean
  readonly counterDmg?: number
  readonly counterLethal?: boolean
  readonly counterAvoidReason?: CounterAvoidReason
  readonly opportunityAttacks?: PathOpportunityPreview
  readonly displacementPreview?: DisplacementPreview
  readonly elementalCombo?: ElementalComboPreview
  readonly alternatives: readonly CombatForecastAlt[]
}

export interface BattleState {
  readonly stageId: string
  readonly chapterIndex: number
  readonly endlessWave: number
  readonly difficulty: DifficultyLevel
  readonly difficultyTier: StageDifficultyTier
  readonly mutators: readonly StageMutatorId[]
  readonly cols: number
  readonly rows: number
  readonly biome: BiomeId
  readonly cells: GridCell[][]
  readonly units: BattleUnit[]
  readonly deployTiles: readonly GridCoord[]
  readonly objective: BattleObjectiveState
  turn: number
  phase: BattlePhase
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
  tacticsPlayed: number
  moveTiles: { col: number; row: number }[]
  targetTiles: { col: number; row: number }[]
  moveAttackTiles: MoveAttackTile[]
  moveUndo: MoveUndoRecord | null
  /** Sentinel UIDs that already triggered an Opportunity Attack during the active unit's current move. */
  oaTriggeredUids: string[]
  pendingAction: PendingUnitAction | null
  facingPicker: FacingPickerState | null
  enemyDelay: number
  enemyActedThisTurn: boolean
  floatingNumbers: FloatingNumber[]
  nextFloatId: number
  bannerText: string
  bannerTimer: number
  shake: number
  xpEarnedByHero: Record<string, number>
  heroStartLevelByUid: Record<string, number>
  reward: BattleReward | null
}

export interface BattleCellSnapshot {
  readonly terrain: TileTerrain
  readonly heightLevel: number
  readonly shrineUsed?: boolean
  readonly barricadeHp?: number
  readonly barricadeMaxHp?: number
  readonly geyserActive?: boolean
  readonly altarUsed?: boolean
}

export interface BattleUnitSnapshot {
  readonly uid: string
  readonly team: 'ally' | 'enemy'
  readonly name: string
  readonly heroId?: HeroClassId
  readonly enemyId?: EnemyArchetypeId
  readonly stars: 1 | 2 | 3
  readonly level?: number
  readonly isBoss: boolean
  readonly weaponId?: string
  readonly armorId?: string
  readonly relicId?: string
  readonly col: number
  readonly row: number
  readonly facing: FacingDir
  readonly hp: number
  readonly maxHp: number
  readonly shield: number
  readonly atk: number
  readonly def: number
  readonly speed: number
  readonly ct: number
  readonly move: number
  readonly jump: number
  readonly range: number
  readonly crit: number
  readonly lifesteal: number
  readonly moved: boolean
  readonly acted: boolean
  readonly alive: boolean
  readonly downed?: boolean
  readonly koCountdown?: number
  readonly burnTurns: number
  readonly slowTurns: number
  readonly stunTurns: number
  readonly empowerTurns: number
  readonly tauntTurns?: number
  readonly hasteTurns?: number
  readonly poisonStacks?: number
  readonly cooldowns: readonly [number, number, number]
  readonly crownbladeKoUsed?: boolean
}

export interface BattleSaveSnapshot {
  readonly version: 1
  readonly stageId: string
  readonly chapterIndex: number
  readonly endlessWave: number
  readonly difficulty: DifficultyLevel
  readonly difficultyTier?: StageDifficultyTier
  readonly mutators?: readonly StageMutatorId[]
  readonly cols: number
  readonly rows: number
  readonly biome: BiomeId
  readonly cells: readonly (readonly BattleCellSnapshot[])[]
  readonly units: readonly BattleUnitSnapshot[]
  readonly turn: number
  readonly phase: 'player' | 'enemy'
  readonly activeUnitUid: string | null
  readonly selectedUnitUid: string | null
  readonly ap: number
  readonly maxAp: number
  readonly drawPile: readonly string[]
  readonly hand: readonly string[]
  readonly discardPile: readonly string[]
  readonly tacticsPlayed: number
  readonly enemyDelay: number
  readonly enemyActedThisTurn: boolean
  readonly rngSeed?: number
  readonly objective?: BattleObjectiveSnapshot
  readonly xpEarnedByHero?: Record<string, number>
  readonly heroStartLevelByUid?: Record<string, number>
}

export interface CampaignState {
  seed: number
  nextUid: number
  gold: number
  dust: number
  shards: number
  chaptersCleared: number
  clearedStageIds: string[]
  clearedStageTiers?: Record<string, StageDifficultyTier>
  selectedStageId: string
  endlessBest: number
  battlesWon: number
  packsOpened: number
  packsSinceEpic: number
  packsSinceLegendary: number
  heroes: OwnedHeroCard[]
  equipment: OwnedEquipCard[]
  tactics: OwnedTacticCard[]
  activeTacticDeckUids?: string[]
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

export type SavedCampaignState = Omit<
  CampaignState,
  'dust' | 'shards' | 'packsSinceEpic' | 'packsSinceLegendary'
> & {
  dust?: number
  shards?: number
  packsSinceEpic?: number
  packsSinceLegendary?: number
}

export interface SaveData {
  version: 1
  campaign: SavedCampaignState
  activeBattle?: BattleSaveSnapshot | null
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

export function defaultTerrainHeightLevel(t: TileTerrain): number {
  if (t === 'void') return -1
  if (t === 'hill') return 1
  return 0
}

export function terrainElevation(t: TileTerrain, heightLevel?: number): number {
  if (t === 'void') return -1.2
  const level = heightLevel !== undefined
    ? Math.max(0, Math.min(MAX_HEIGHT_LEVEL, Math.round(heightLevel)))
    : defaultTerrainHeightLevel(t)
  const base = level * HEIGHT_STEP
  if (t === 'pillar') return base + 1.15
  if (t === 'water' || t === 'lava') return base - 0.22
  if (t === 'bridge') return base + 0.08
  if (t === 'shrine') return base + 0.16
  if (t === 'cursed_altar') return base + 0.12
  return base
}

export function terrainWalkable(t: TileTerrain): boolean {
  return t !== 'water' && t !== 'lava' && t !== 'pillar' && t !== 'void' && t !== 'barricade'
}

export function terrainMoveCost(t: TileTerrain): number {
  if (!terrainWalkable(t)) return 99
  if (t === 'snow') return 2
  return 1
}

export function terrainDefBonus(t: TileTerrain): number {
  if (t === 'darkstone') return 2
  if (t === 'stone' || t === 'shrine') return 1
  if (t === 'bridge') return -1
  return 0
}

export function cellHeightLevel(cell: Pick<GridCell, 'terrain' | 'elevation' | 'heightLevel'>): number {
  if (cell.heightLevel !== undefined) return cell.heightLevel
  if (cell.terrain === 'void') return -1
  if (cell.terrain === 'water' || cell.terrain === 'lava') {
    return Math.max(0, Math.round((cell.elevation + 0.22) / HEIGHT_STEP))
  }
  if (cell.terrain === 'pillar') {
    return Math.max(0, Math.round((cell.elevation - 1.15) / HEIGHT_STEP))
  }
  if (cell.terrain === 'bridge') {
    return Math.max(0, Math.round((cell.elevation - 0.08) / HEIGHT_STEP))
  }
  if (cell.terrain === 'shrine') {
    return Math.max(0, Math.round((cell.elevation - 0.16) / HEIGHT_STEP))
  }
  if (cell.terrain === 'cursed_altar') {
    return Math.max(0, Math.round((cell.elevation - 0.12) / HEIGHT_STEP))
  }
  return Math.max(0, Math.round(cell.elevation / HEIGHT_STEP))
}

export function cellElevation(
  state: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  col: number,
  row: number
): number {
  if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) return 0
  return state.cells[row]?.[col]?.elevation ?? 0
}

export function cellHeightAt(
  state: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  col: number,
  row: number
): number {
  if (row < 0 || row >= state.rows || col < 0 || col >= state.cols) return 0
  const cell = state.cells[row]?.[col]
  return cell ? cellHeightLevel(cell) : 0
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

export function isUnitDowned(unit: Pick<BattleUnit, 'alive' | 'downed' | 'koCountdown'>): boolean {
  return !unit.alive && unit.downed && unit.koCountdown > 0
}

export function isUnitActive(unit: Pick<BattleUnit, 'alive'>): boolean {
  return unit.alive
}
