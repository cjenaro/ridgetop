import { nextRandom } from 'ridgetop'
import type { Vec3 } from 'ridgetop'
import {
  CHAPTERS, CHAPTER_BY_ID, ENEMY_SPECS, EQUIPMENT_BY_ID, EQUIPMENT_LIST, HERO_LIST, HERO_SPECS,
  MERGE_COPIES_REQUIRED, PACK_BY_ID, PLAYABLE_CHAPTERS, RARITY_META, RARITY_ORDER, TACTIC_BY_ID, TACTIC_LIST
} from './data.ts'
import {
  EPIC_PITY_THRESHOLD, EQUIP_CRAFT_COST, EQUIP_SALVAGE_DUST, HERO_CRAFT_COST, HERO_SALVAGE_SHARDS,
  LEGENDARY_PITY_THRESHOLD, MAX_HERO_OVERFLOW_SHARDS, canCraftEquipment, canCraftHero, craftEquipment,
  craftHero, getCraftableEquipment, getCraftableHeroes, getDuplicateMaxHeroShards, getEquipCraftCost,
  getEquipSalvageDust, getHeroCraftCost, getHeroSalvageShards, getPackPityStatus, hasMaxedHero,
  resolvePackPityFloor, selectProtectedEquipment, selectProtectedHero, updatePackPityCounters
} from './forge.ts'
export {
  EPIC_PITY_THRESHOLD, EQUIP_CRAFT_COST, EQUIP_SALVAGE_DUST, HERO_CRAFT_COST, HERO_SALVAGE_SHARDS,
  LEGENDARY_PITY_THRESHOLD, MAX_HERO_OVERFLOW_SHARDS, canCraftEquipment, canCraftHero, craftEquipment,
  craftHero, getCraftableEquipment, getCraftableHeroes, getDuplicateMaxHeroShards, getEquipCraftCost,
  getEquipSalvageDust, getHeroCraftCost, getHeroSalvageShards, getPackPityStatus, hasMaxedHero,
  resolvePackPityFloor, selectProtectedEquipment, selectProtectedHero, updatePackPityCounters
}
import {
  ALL_ENEMY_IDS, ENEMY_CODEX_META, HERO_CODEX_META, backfillDiscoveredEnemiesFromStages,
  discoverBattleEnemiesInCodex, discoverEnemyInCodex, getBestiaryEntries, getBestiaryEntry,
  getCodexProgress, getEnemyEncounterStages, getEquipCodexEntries, getEquipCodexEntry,
  getEquipmentDropStages, getHeroCodexEntries, getHeroCodexEntry, getHeroRecruitmentStages,
  getPackSourcesForRarity, isEnemyDiscovered, isValidEnemyArchetypeId, normalizeDiscoveredEnemies
} from './codex.ts'
export {
  ALL_ENEMY_IDS, ENEMY_CODEX_META, HERO_CODEX_META, backfillDiscoveredEnemiesFromStages,
  discoverBattleEnemiesInCodex, discoverEnemyInCodex, getBestiaryEntries, getBestiaryEntry,
  getCodexProgress, getEnemyEncounterStages, getEquipCodexEntries, getEquipCodexEntry,
  getEquipmentDropStages, getHeroCodexEntries, getHeroCodexEntry, getHeroRecruitmentStages,
  getPackSourcesForRarity, isEnemyDiscovered, isValidEnemyArchetypeId, normalizeDiscoveredEnemies
}
export type {
  CodexProgress, CodexStageRef, CodexTab, EnemyCodexCategory, EnemyCodexEntry, EnemyCodexMeta,
  EquipCodexEntry, HeroCodexEntry, HeroCodexMeta
} from './codex.ts'
import {
  COMBAT_LOG_ACCENT, COMBAT_LOG_CATEGORIES, MAX_COMBAT_LOG_ENTRIES, appendCombatLog,
  formatCombatLogLine, formatComboLog, formatDamageLog, formatHazardLog, formatHealLog,
  formatKoLog, formatReactionLog, formatStatusLog, getMaxCombatLogScroll, getRecentCombatLog,
  sanitizeCombatLogEntries
} from './combat-log.ts'
export {
  COMBAT_LOG_ACCENT, COMBAT_LOG_CATEGORIES, MAX_COMBAT_LOG_ENTRIES, appendCombatLog,
  formatCombatLogLine, formatComboLog, formatDamageLog, formatHazardLog, formatHealLog,
  formatKoLog, formatReactionLog, formatStatusLog, getMaxCombatLogScroll, getRecentCombatLog,
  sanitizeCombatLogEntries
}
export type {
  AppendCombatLogOptions, CombatLogCategory, CombatLogEntry, ComboLogOptions, DamageLogOptions,
  HazardLogOptions, HealLogOptions, KoLogOptions, ReactionLogOptions, StatusLogOptions
} from './combat-log.ts'
import { computePincerAssistDamage, findPincerAssisters, isPincerMeleeSkill } from './pincer.ts'
export { computePincerAssistDamage, findPincerAssisters, isPincerMeleeSkill } from './pincer.ts'
import {
  COUNTER_DAMAGE_MULTIPLIER, COUNTER_MIN_DAMAGE, canCounterAttack, computeCounterDamage,
  getCounterAvoidReason, isMeleeSkillEligibleForCounter
} from './counter-attack.ts'
export {
  COUNTER_DAMAGE_MULTIPLIER, COUNTER_MIN_DAMAGE, canCounterAttack, computeCounterDamage,
  getCounterAvoidReason, isMeleeSkillEligibleForCounter
}
export type { CounterDamageOptions, CounterDamageResult, CounterEligibilityOptions } from './counter-attack.ts'
import {
  applyDisplacement, orderDisplacementTargets, resolveDisplacementPreview
} from './forced-movement.ts'
import {
  BARRICADE_DEFAULT_HP, CURSED_ALTAR_HP_COST, FACING_DIRS, GRID_COLS, GRID_ROWS, KO_COUNTDOWN_TURNS,
  LAVA_GEYSER_DAMAGE, LAVA_GEYSER_PERIOD, MAX_HEIGHT_LEVEL, MAX_POISON_STACKS,
  OPPORTUNITY_ATTACK_DAMAGE_MUL,
  TALL_GRASS_RANGED_COVER, TALL_GRASS_RANGED_CRIT_REDUCTION, TAUNT_RADIUS,
  cellHeightAt, cellHeightLevel, defaultTerrainHeightLevel,
  facingToYaw, facingVector, gridToWorld, isUnitActive, isUnitDowned, terrainDefBonus,
  terrainElevation, terrainWalkable, vectorToFacing
} from './types.ts'
import {
  canEvadeZoneOfControl, computeAiOpportunityPenalty, findStepOpportunityAttackers,
  getOpposingZocSentinelsAt, previewPathOpportunityAttacks
} from './zoc.ts'
export {
  canEvadeZoneOfControl, computeOpportunityAttackDamage, computeZocPerimeterTiles,
  formatOpportunityWarning, hasZoneOfControl, previewPathOpportunityAttacks
} from './zoc.ts'
import {
  ARCANE_CONDUIT_SPLASH_RATIO, CHAMPION_KO_CT_SURGE, EQUIP_EFFECTS, HERO_PASSIVES,
  MAX_TACTIC_DECK, MIN_TACTIC_DECK, RECOMMENDED_MIN_TACTIC_DECK, SHIELD_WALL_DEF_BONUS,
  adjustCoverBonusForAttacker, autoBuildTacticDeck, computeAttackerDamageMultiplier,
  computeBackstabPassiveCritBonus, computeBonusIgnoreArmor, computeDefenderIncomingDamageMultiplier,
  computeKoHealAmount, computeOverhealShield, computePaladinCounterBonus, computePassiveRangeBonus,
  computeShieldWallDefBonus, computeTacticDeckCurve, computeTurnStartGearEffects,
  getActiveTacticDeckUids, getEquipEffect, getEquipmentJumpBonus, getHeroPassive,
  ignoresSnowMoveCost, shouldApplyBurnOnCrit, shouldChillMeleeAttacker, toggleTacticInDeck,
  unitHasEquip, unitTerrainMoveCost
} from './passives.ts'
export {
  ARCANE_CONDUIT_SPLASH_RATIO, CHAMPION_KO_CT_SURGE, EQUIP_EFFECTS, HERO_PASSIVES,
  MAX_TACTIC_DECK, MIN_TACTIC_DECK, RECOMMENDED_MIN_TACTIC_DECK, SHIELD_WALL_DEF_BONUS,
  autoBuildTacticDeck, computeShieldWallDefBonus, computeTacticDeckCurve,
  getActiveTacticDeckUids, getEquipEffect, getHeroPassive, ignoresSnowMoveCost,
  toggleTacticInDeck, unitTerrainMoveCost
}
export type { EquipEffectSpec, HeroPassiveSpec, TacticDeckCurve } from './passives.ts'
import {
  classifyElement, classifyHazardElement, collectWildfirePatch,
  previewElementalCombo, triggerElementalCombo
} from './elemental-combos.ts'
import {
  BATTLE_WEATHER_IDS, TIME_OF_DAY_IDS, TIME_OF_DAY_LABELS, WEATHER_SPECS,
  computeWeatherCombatModifiers, computeWeatherLighting, defaultAtmosphereForBiome,
  formatWeatherHudLabel, isBattleWeatherId, isTimeOfDayId, resolveBattleAtmosphere,
  weatherSlowDurationBonus
} from './weather.ts'
export {
  BATTLE_WEATHER_IDS, TIME_OF_DAY_IDS, TIME_OF_DAY_LABELS, WEATHER_SPECS,
  computeWeatherCombatModifiers, computeWeatherLighting, defaultAtmosphereForBiome,
  formatWeatherHudLabel, isBattleWeatherId, isTimeOfDayId, resolveBattleAtmosphere,
  weatherSlowDurationBonus
}
export type {
  BaseLightingStyle, ResolveAtmosphereInput, ShiftedBattleLighting, WeatherCombatModifiers, WeatherSpec
} from './weather.ts'
import {
  MAX_HERO_LEVEL, XP_ACTION_BOSS_KO, XP_ACTION_DAMAGE, XP_ACTION_KO, XP_ACTION_REVIVE, XP_ACTION_SUPPORT,
  XP_MERGE_TRANSFER_RATIO, XP_VICTORY_BASE, XP_VICTORY_PER_DIFFICULTY, XP_VICTORY_SURVIVAL_BONUS,
  grantHeroXp, heroLevelProgress, levelStatBonuses, normalizeHeroLevel, normalizeHeroXp,
  totalXpForLevel, victoryXpBonus, xpRequiredForLevel
} from './leveling.ts'
export {
  MAX_HERO_LEVEL, XP_ACTION_BOSS_KO, XP_ACTION_DAMAGE, XP_ACTION_KO, XP_ACTION_REVIVE, XP_ACTION_SUPPORT,
  XP_MERGE_TRANSFER_RATIO, XP_VICTORY_BASE, XP_VICTORY_PER_DIFFICULTY, XP_VICTORY_SURVIVAL_BONUS,
  grantHeroXp, heroLevelProgress, levelStatBonuses, normalizeHeroLevel, normalizeHeroXp,
  totalXpForLevel, victoryXpBonus, xpRequiredForLevel
}
export type { GrantHeroXpResult, HeroLevelProgress, LevelStatBonuses } from './leveling.ts'
import {
  BIOME_ENEMY_ARCHETYPES, ICE_WRAITH_CHILLED_BONUS_MUL, MINIBOSS_SPECIAL_COOLDOWN,
  NECROMANCER_SUMMON_CAP, NECROMANCER_SUMMON_COOLDOWN, PYROMANCER_NOVA_COOLDOWN,
  REGIONAL_MINIBOSS_ARCHETYPES, RIVER_TROLL_REGEN_AMOUNT, RIVER_TROLL_SLAM_COOLDOWN,
  canSummonerRaiseMinion, chooseEnemySpecialMove, computeEnemyArchetypeDamageMul,
  countActiveSummonsFor, createSummonedEnemyUnit, evaluateTurnStartRegeneration,
  findBestSummonTile, generateSummonUid, getEnemyAttackElement, getEnemyBasicAttackStatus,
  getEnemyBiomeAffinity, getEnemyProjectileStyle, isRegeneratingArchetype,
  isRegionalMiniBoss, isSummonerArchetype
} from './enemy-archetypes.ts'
export {
  BIOME_ENEMY_ARCHETYPES, ICE_WRAITH_CHILLED_BONUS_MUL, MINIBOSS_SPECIAL_COOLDOWN,
  NECROMANCER_SUMMON_CAP, NECROMANCER_SUMMON_COOLDOWN, PYROMANCER_NOVA_COOLDOWN,
  REGIONAL_MINIBOSS_ARCHETYPES, RIVER_TROLL_REGEN_AMOUNT, RIVER_TROLL_SLAM_COOLDOWN,
  canSummonerRaiseMinion, chooseEnemySpecialMove, computeEnemyArchetypeDamageMul,
  countActiveSummonsFor, createSummonedEnemyUnit, evaluateTurnStartRegeneration,
  findBestSummonTile, generateSummonUid, getEnemyAttackElement, getEnemyBasicAttackStatus,
  getEnemyBiomeAffinity, getEnemyProjectileStyle, isRegeneratingArchetype,
  isRegionalMiniBoss, isSummonerArchetype
}
export type {
  EnemyBasicStatusEffect, EnemySpecialDecision, EnemySpecialMoveKind, TurnStartRegenResult
} from './enemy-archetypes.ts'
import {
  ASTRAL_RIFT_DAMAGE, ASTRAL_RIFT_PERIOD, FRONTIER_BIOMES, FRONTIER_BOSS_IDS, FRONTIER_STAGE_IDS,
  LIGHTNING_CONDUIT_DAMAGE, LIGHTNING_CONDUIT_PERIOD, SANDSTORM_GUST_DAMAGE, SANDSTORM_GUST_PERIOD,
  UNBROKEN_CROWN_PHASE2_ATK_BONUS, UNBROKEN_CROWN_PHASE2_BANNER, UNBROKEN_CROWN_PHASE2_EMPOWER_TURNS,
  UNBROKEN_CROWN_PHASE2_HASTE_TURNS, UNBROKEN_CROWN_PHASE2_HP_RATIO, UNBROKEN_CROWN_PHASE2_SHIELD,
  UNBROKEN_CROWN_PHASE2_SUMMON_COUNT,
  applyFrontierBossPhaseTransition, computeAstralRiftStrikes, computeLightningConduitStrikes,
  computeSandstormGustStrikes, evaluateFrontierRoundHazard, findFrontierSummonTiles,
  getFrontierHazardKind, getUnbrokenCrownPhase2Config, isFrontierBiome, isFrontierBoss,
  shouldTriggerUnbrokenCrownPhase2
} from './expansion-frontier.ts'
export {
  ASTRAL_RIFT_DAMAGE, ASTRAL_RIFT_PERIOD, FRONTIER_BIOMES, FRONTIER_BOSS_IDS, FRONTIER_STAGE_IDS,
  LIGHTNING_CONDUIT_DAMAGE, LIGHTNING_CONDUIT_PERIOD, SANDSTORM_GUST_DAMAGE, SANDSTORM_GUST_PERIOD,
  UNBROKEN_CROWN_PHASE2_ATK_BONUS, UNBROKEN_CROWN_PHASE2_BANNER, UNBROKEN_CROWN_PHASE2_EMPOWER_TURNS,
  UNBROKEN_CROWN_PHASE2_HASTE_TURNS, UNBROKEN_CROWN_PHASE2_HP_RATIO, UNBROKEN_CROWN_PHASE2_SHIELD,
  UNBROKEN_CROWN_PHASE2_SUMMON_COUNT,
  applyFrontierBossPhaseTransition, computeAstralRiftStrikes, computeLightningConduitStrikes,
  computeSandstormGustStrikes, evaluateFrontierRoundHazard, findFrontierSummonTiles,
  getFrontierHazardKind, getUnbrokenCrownPhase2Config, isFrontierBiome, isFrontierBoss,
  shouldTriggerUnbrokenCrownPhase2
}
export type {
  FrontierBossPhaseConfig, FrontierBossPhaseResult, FrontierHazardKind,
  FrontierHazardStrike, FrontierRoundHazardResult
} from './expansion-frontier.ts'
import {
  ACT2_EXPANSION_STAGE_IDS, FROSTWYRM_BREATH_COOLDOWN, FROSTWYRM_BREATH_RANGE,
  FROSTWYRM_WING_BUFFET_COOLDOWN, FROSTWYRM_WING_BUFFET_KNOCKBACK, LICH_VAELEN_SOUL_NOVA_COOLDOWN,
  LICH_VAELEN_SUMMON_CAP, LICH_VAELEN_SUMMON_COOLDOWN,
  chooseFrostwyrmSpecial, chooseLichVaelenSoulNova, closestFootprintCell,
  computeFootprintMoveTiles, computeFootprintWorldCenter, computeGlacialBreathCells,
  distanceBetweenUnits, distanceToUnitFootprint, findFootprintPath,
  getFootprintCellsAt, getInnateStageMutators, getUnitFootprintCells, getUnitFootprintSize,
  getUnitPerimeterCells, isCellAdjacentToUnit, isFrostwyrmArchetype, isLichVaelenArchetype,
  isValidFootprintAnchor, mergeInnateStageMutators, unitOccupiesCell
} from './expansion-act2.ts'
export {
  ACT2_EXPANSION_STAGE_IDS, FROSTWYRM_BREATH_COOLDOWN, FROSTWYRM_BREATH_RANGE,
  FROSTWYRM_WING_BUFFET_COOLDOWN, FROSTWYRM_WING_BUFFET_KNOCKBACK, LICH_VAELEN_SOUL_NOVA_COOLDOWN,
  LICH_VAELEN_SUMMON_CAP, LICH_VAELEN_SUMMON_COOLDOWN,
  chooseFrostwyrmSpecial, chooseLichVaelenSoulNova, closestFootprintCell,
  computeFootprintMoveTiles, computeFootprintWorldCenter, computeGlacialBreathCells,
  distanceBetweenUnits, distanceToUnitFootprint, findFootprintPath,
  getFootprintCellsAt, getInnateStageMutators, getUnitFootprintCells, getUnitFootprintSize,
  getUnitPerimeterCells, isCellAdjacentToUnit, isFrostwyrmArchetype, isLichVaelenArchetype,
  isValidFootprintAnchor, mergeInnateStageMutators, unitOccupiesCell
}
export type { FrostwyrmSpecialPlan, LichSoulNovaSpec } from './expansion-act2.ts'
import {
  BRIMSTONE_MAW_STAGE_ID, CINDER_ARENA_INTER_ROUND_AP_BONUS, CINDER_ARENA_INTER_ROUND_HEAL_RATIO,
  CINDER_ARENA_MAX_ROUNDS, CINDER_ARENA_STAGE_ID, CINDER_ARENA_WAVES,
  CROWNLESS_DEEP_FLOOR10_BONUS_DUST, CROWNLESS_DEEP_FLOOR10_BONUS_SHARDS,
  CROWNLESS_DEEP_FLOOR10_LEGEND_EQUIP, CROWNLESS_DEEP_FLOOR10_LEGEND_HERO,
  CROWNLESS_DEEP_FLOORS, CROWNLESS_DEEP_MAX_FLOOR, CROWNLESS_DEEP_STAGE_ID,
  IGNIS_TITAN_GEYSER_IGNITE_RADIUS, STARFALL_ATOLL_FIRST_CLEAR_DUST,
  STARFALL_ATOLL_FIRST_CLEAR_SHARDS, STARFALL_ATOLL_STAGE_ID,
  applyGauntletInterRoundRecovery, canAdvanceGauntletRound, createGauntletWaveUnits,
  findOpenGauntletSpawnTile, formatAbyssFloorLabel, getCrownlessDeepFloorSpec,
  getGauntletMaxRounds, getGauntletWaveSpec, getMaxSelectableCrownlessDeepFloor,
  getNextCrownlessDeepFloor, getSelectedCrownlessDeepFloor, getStarfallFirstClearBonus,
  igniteNearbyLavaGeysers, isCrownlessDeepStage, isGauntletStage,
  normalizeCrownlessDeepFloorCleared, resolveCrownlessDeepVictoryRewards,
  setSelectedCrownlessDeepFloor
} from './expansion-endgame.ts'
export {
  BRIMSTONE_MAW_STAGE_ID, CINDER_ARENA_INTER_ROUND_AP_BONUS, CINDER_ARENA_INTER_ROUND_HEAL_RATIO,
  CINDER_ARENA_MAX_ROUNDS, CINDER_ARENA_STAGE_ID, CINDER_ARENA_WAVES,
  CROWNLESS_DEEP_FLOOR10_BONUS_DUST, CROWNLESS_DEEP_FLOOR10_BONUS_SHARDS,
  CROWNLESS_DEEP_FLOOR10_LEGEND_EQUIP, CROWNLESS_DEEP_FLOOR10_LEGEND_HERO,
  CROWNLESS_DEEP_FLOORS, CROWNLESS_DEEP_MAX_FLOOR, CROWNLESS_DEEP_STAGE_ID,
  IGNIS_TITAN_GEYSER_IGNITE_RADIUS, STARFALL_ATOLL_FIRST_CLEAR_DUST,
  STARFALL_ATOLL_FIRST_CLEAR_SHARDS, STARFALL_ATOLL_STAGE_ID,
  applyGauntletInterRoundRecovery, canAdvanceGauntletRound, createGauntletWaveUnits,
  findOpenGauntletSpawnTile, formatAbyssFloorLabel, getCrownlessDeepFloorSpec,
  getGauntletMaxRounds, getGauntletWaveSpec, getMaxSelectableCrownlessDeepFloor,
  getNextCrownlessDeepFloor, getSelectedCrownlessDeepFloor, getStarfallFirstClearBonus,
  igniteNearbyLavaGeysers, isCrownlessDeepStage, isGauntletStage,
  normalizeCrownlessDeepFloorCleared, resolveCrownlessDeepVictoryRewards,
  setSelectedCrownlessDeepFloor
}
export type {
  CrownlessDeepFloorSpec, CrownlessDeepRewardPlan, GauntletRecoveryResult, GauntletWaveSpec
} from './expansion-endgame.ts'
import { executeBulkSalvageCommonDupes } from './inventory-ops.ts'
export {
  findBulkSalvageableCommonDupes, isEquipLocked, isHeroLocked,
  previewBulkSalvageCommonDupes, toggleEquipLock, toggleHeroLock
} from './inventory-ops.ts'
export type { BulkSalvagePreview, BulkSalvageResult } from './inventory-ops.ts'
import type { BulkSalvageResult } from './inventory-ops.ts'
import {
  DISCOVERY_TIPS, DISCOVERY_TIP_BY_ID, DISCOVERY_TIP_IDS,
  areDiscoveryTipsEnabled, checkDiscoveryTipForBattle, detectBattleDiscoveryTips,
  dismissDiscoveryTip, enqueueDiscoveryTip, getActiveDiscoveryTip, getDiscoveryTipSpec,
  hasSeenDiscoveryTip, isDiscoveryTipId, normalizeSeenTips, resetDiscoveryTips,
  setDiscoveryTipsEnabled, skipAllDiscoveryTips, triggerDiscoveryTip
} from './discovery-tips.ts'
export {
  DISCOVERY_TIPS, DISCOVERY_TIP_BY_ID, DISCOVERY_TIP_IDS,
  areDiscoveryTipsEnabled, checkDiscoveryTipForBattle, detectBattleDiscoveryTips,
  dismissDiscoveryTip, enqueueDiscoveryTip, getActiveDiscoveryTip, getDiscoveryTipSpec,
  hasSeenDiscoveryTip, isDiscoveryTipId, normalizeSeenTips, resetDiscoveryTips,
  setDiscoveryTipsEnabled, skipAllDiscoveryTips, triggerDiscoveryTip
}
export type {
  DiscoveryTipCategory, DiscoveryTipIcon, DiscoveryTipSpec, DiscoveryTipTriggerContext
} from './discovery-tips.ts'
export {
  ACTION_CAMERA_2X_RATE, ACTION_CAMERA_CUES, ACTION_CAMERA_EPS,
  ACTION_CAMERA_MAX_FOCUS_X, ACTION_CAMERA_MAX_FOCUS_Y, ACTION_CAMERA_MAX_FOCUS_Z,
  cancelActionCamera, createActionCameraState, isActionCameraActive,
  isActionCameraEnabled, setActionCameraEnabled, stepActionCamera, triggerActionCameraCue
} from './action-camera.ts'
export type { ActionCameraCueConfig, ActionCameraCueKind, ActionCameraState } from './action-camera.ts'
import {
  AUTO_BATTLE_POST_ACT_DELAY, AUTO_BATTLE_THINK_DELAY, DEFAULT_BATTLE_SPEED,
  chooseBestTurnEndFacing, findAutoBattleProvokingTaunters, formatBattleSpeedLabel,
  nextBattleSpeed, normalizeBattleSpeed, planAutoBattleAction, scaleBattleDt
} from './auto-battle.ts'
export {
  AUTO_BATTLE_POST_ACT_DELAY, AUTO_BATTLE_THINK_DELAY, DEFAULT_BATTLE_SPEED,
  chooseBestTurnEndFacing, findAutoBattleProvokingTaunters, formatBattleSpeedLabel,
  nextBattleSpeed, normalizeBattleSpeed, planAutoBattleAction, scaleBattleDt
}
export type { AutoBattleActionKind, AutoBattleActionPlan } from './auto-battle.ts'
import {
  ARCANE_SURGE_EXTRA_CD_TICK, ARCANE_SURGE_MAX_AP_BONUS, ARCANE_SURGE_START_AP_BONUS,
  BLOOD_MOON_DAMAGE_MUL, BLOOD_MOON_MELEE_DRAIN, FOG_OF_WAR_VISION_RADIUS,
  IRON_VANGUARD_DEF_BONUS, IRON_VANGUARD_SHIELD_RATIO, STAGE_DIFFICULTY_TIERS,
  STAGE_MUTATOR_IDS, STAGE_MUTATOR_SPECS, STAGE_TIER_SPECS, VENOM_MIST_POISON_STACKS,
  arcaneSurgeApBonuses, baseReplayWeightsForDifficulty, computeChallengeRewards,
  computeIronVanguardShield, computeScaledEnemyStats, cooldownTickStep,
  getHighestClearedStageTier, getStageMutatorSpec, getStageTierSpec, hasMutator,
  isEnemyShrouded, isStageDifficultyTier, isStageMutatorId, isTileRevealedInFog,
  isUnitVisibleToPlayer, mutatorDamageMultiplier, mutatorMeleeDrainBonus,
  normalizeStageDifficultyTier, normalizeStageMutators, recordClearedStageTier,
  resolveStageChallenge, sanitizeClearedStageTiers, stageTierRank
} from './mutators.ts'
export {
  ARCANE_SURGE_EXTRA_CD_TICK, ARCANE_SURGE_MAX_AP_BONUS, ARCANE_SURGE_START_AP_BONUS,
  BLOOD_MOON_DAMAGE_MUL, BLOOD_MOON_MELEE_DRAIN, FOG_OF_WAR_VISION_RADIUS,
  IRON_VANGUARD_DEF_BONUS, IRON_VANGUARD_SHIELD_RATIO, STAGE_DIFFICULTY_TIERS,
  STAGE_MUTATOR_IDS, STAGE_MUTATOR_SPECS, STAGE_TIER_SPECS, VENOM_MIST_POISON_STACKS,
  arcaneSurgeApBonuses, baseReplayWeightsForDifficulty, computeChallengeRewards,
  computeIronVanguardShield, computeScaledEnemyStats, cooldownTickStep,
  getHighestClearedStageTier, getStageMutatorSpec, getStageTierSpec, hasMutator,
  isEnemyShrouded, isStageDifficultyTier, isStageMutatorId, isTileRevealedInFog,
  isUnitVisibleToPlayer, mutatorDamageMultiplier, mutatorMeleeDrainBonus,
  normalizeStageDifficultyTier, normalizeStageMutators, recordClearedStageTier,
  resolveStageChallenge, sanitizeClearedStageTiers, stageTierRank
}
export type {
  ChallengeRewardSummary, ResolvedStageChallenge, ScaledEnemyStats,
  StageMutatorSpec, StageTierSpec
} from './mutators.ts'
import {
  EMERALD_DELTA_STAGE_ID, EMERALD_TIDE_FORD_TILES, EMERALD_TIDE_PERIOD, EMERALD_TIDE_SPLASH_DAMAGE,
  GALEWIND_GUST_PERIOD, GALEWIND_MIN_HEIGHT, GALEWIND_PUSH_DIR, GALEWIND_STAGE_ID,
  MONASTERY_MAX_ALIVE_ENEMIES, MONASTERY_REINFORCEMENT_ROUNDS, MONASTERY_WAVE_SPECS,
  OAKHAVEN_EXCHANGE_DEALS, OAKHAVEN_PATRON_DISCOUNT_PCT, OAKHAVEN_STAGE_ID, SOLIS_MONASTERY_STAGE_ID,
  applyAct1StageRoundBoundary, applyEmeraldDeltaTide, applyGalewindGust, buyOakhavenDeal,
  canBuyOakhavenDeal, cloneStageMechanicState, createInitialStageMechanicState,
  findNearestDryShoreTile, getAct1StageMechanicStatus, getMonasteryPendingWaveRound,
  getOakhavenDealCost, getOakhavenExchangeCycle, getOakhavenExchangeDeal,
  getOakhavenExchangeOffer, getOakhavenExchangeOffers, hasOakhavenPatronDiscount,
  isEmeraldDeltaFordTile, isEmeraldTideHighOnRound, isGalewindGustImminent,
  isOakhavenExchangeUnlocked, normalizeOakhavenExchange, shouldTriggerGalewindGust,
  spawnMonasteryReinforcements, validateStageMechanicSnapshot
} from './expansion-act1.ts'
export {
  EMERALD_DELTA_STAGE_ID, EMERALD_TIDE_FORD_TILES, EMERALD_TIDE_PERIOD, EMERALD_TIDE_SPLASH_DAMAGE,
  GALEWIND_GUST_PERIOD, GALEWIND_MIN_HEIGHT, GALEWIND_PUSH_DIR, GALEWIND_STAGE_ID,
  MONASTERY_MAX_ALIVE_ENEMIES, MONASTERY_REINFORCEMENT_ROUNDS, MONASTERY_WAVE_SPECS,
  OAKHAVEN_EXCHANGE_DEALS, OAKHAVEN_PATRON_DISCOUNT_PCT, OAKHAVEN_STAGE_ID, SOLIS_MONASTERY_STAGE_ID,
  applyAct1StageRoundBoundary, applyEmeraldDeltaTide, applyGalewindGust, buyOakhavenDeal,
  canBuyOakhavenDeal, cloneStageMechanicState, createInitialStageMechanicState,
  findNearestDryShoreTile, getAct1StageMechanicStatus, getMonasteryPendingWaveRound,
  getOakhavenDealCost, getOakhavenExchangeCycle, getOakhavenExchangeDeal,
  getOakhavenExchangeOffer, getOakhavenExchangeOffers, hasOakhavenPatronDiscount,
  isEmeraldDeltaFordTile, isEmeraldTideHighOnRound, isGalewindGustImminent,
  isOakhavenExchangeUnlocked, normalizeOakhavenExchange, shouldTriggerGalewindGust,
  spawnMonasteryReinforcements, validateStageMechanicSnapshot
}
export type {
  Act1RoundBoundarySummary, Act1StageMechanicHudStatus, EmeraldTideResult, GalewindGustResult,
  MonasteryReinforcementSpawnSpec, MonasteryWaveResult, MonasteryWaveSpec,
  OakhavenExchangeDealSpec, OakhavenExchangeOffer, OakhavenPurchaseResult
} from './expansion-act1.ts'
import {
  MASTERY_MILESTONES, MAX_STAGE_MASTERY_STARS,
  canClaimMasteryMilestone, canClaimStageMasteryChest,
  claimMasteryMilestone, claimStageMasteryChest, createEmptyStageMasteryRecord,
  didFinishWithZeroHeroKos, evaluateAndRecordBattleMastery,
  getBattleHeroKoCount, getBattleTurnsTaken, getClaimableMasteryMilestones,
  getMasteryMilestoneSpec, getMaxMasteryStars, getNextMasteryMilestone,
  getStageMasteryChestReward, getStageMasteryObjectives, getStageMasteryRecord,
  getStageMasteryTurnLimit, getThreeStarStageCount, getTotalMasteryStars,
  hasClaimedMasteryMilestone, hasClaimedStageMasteryChest,
  sanitizeClaimedMasteryMilestones, sanitizeClaimedStageMasteryChests, sanitizeStageMastery
} from './mastery.ts'
export {
  MASTERY_MILESTONES, MAX_STAGE_MASTERY_STARS,
  canClaimMasteryMilestone, canClaimStageMasteryChest,
  claimMasteryMilestone, claimStageMasteryChest, createEmptyStageMasteryRecord,
  didFinishWithZeroHeroKos, evaluateAndRecordBattleMastery,
  getBattleHeroKoCount, getBattleTurnsTaken, getClaimableMasteryMilestones,
  getMasteryMilestoneSpec, getMaxMasteryStars, getNextMasteryMilestone,
  getStageMasteryChestReward, getStageMasteryObjectives, getStageMasteryRecord,
  getStageMasteryTurnLimit, getThreeStarStageCount, getTotalMasteryStars,
  hasClaimedMasteryMilestone, hasClaimedStageMasteryChest,
  sanitizeClaimedMasteryMilestones, sanitizeClaimedStageMasteryChests, sanitizeStageMastery
}
export type { MasteryMilestoneClaimResult, StageMasteryChestClaimResult } from './mastery.ts'
export type {
  BattleMasteryEvaluation, MasteryMilestoneSpec, StageMasteryChestReward,
  StageMasteryObjectiveId, StageMasteryObjectiveSpec, StageMasteryRecord, StageMasteryStars
} from './types.ts'
import {
  ENDLESS_BIOME_POOLS, ENDLESS_BIOME_ROTATION, ENDLESS_BLESSINGS, ENDLESS_BLESSING_BY_ID,
  ENDLESS_BLESSING_IDS, ENDLESS_BLESSING_RARITY_META, ENDLESS_BOSS_WAVE_INTERVAL,
  ENDLESS_DRAFT_CHOICES,
  abandonEndlessRun, applyEndlessBlessingsToUnit, buildEndlessWaveEnemies,
  canTriggerPhoenixGrace, cloneEndlessRunState, computeEndlessAttackerDamageMultiplier,
  computeEndlessBlessingModifiers, computeEndlessTurnStartRegen, draftEndlessBlessing,
  formatEndlessBiomeLabel, generateEndlessBlessingDraft, getEndlessBlessingSpec,
  isEndlessBiomeId, isEndlessBlessingId, isEndlessBossWave, normalizeEndlessBlessings,
  prepareEndlessVictoryDraft, sanitizeEndlessRunState, selectEndlessWaveStage,
  shouldEndlessApplyBurnOnCrit, startEndlessRun
} from './endless-roguelite.ts'
export {
  ENDLESS_BIOME_POOLS, ENDLESS_BIOME_ROTATION, ENDLESS_BLESSINGS, ENDLESS_BLESSING_BY_ID,
  ENDLESS_BLESSING_IDS, ENDLESS_BLESSING_RARITY_META, ENDLESS_BOSS_WAVE_INTERVAL,
  ENDLESS_DRAFT_CHOICES,
  abandonEndlessRun, applyEndlessBlessingsToUnit, buildEndlessWaveEnemies,
  canTriggerPhoenixGrace, cloneEndlessRunState, computeEndlessAttackerDamageMultiplier,
  computeEndlessBlessingModifiers, computeEndlessTurnStartRegen, draftEndlessBlessing,
  formatEndlessBiomeLabel, generateEndlessBlessingDraft, getEndlessBlessingSpec,
  isEndlessBiomeId, isEndlessBlessingId, isEndlessBossWave, normalizeEndlessBlessings,
  prepareEndlessVictoryDraft, sanitizeEndlessRunState, selectEndlessWaveStage,
  shouldEndlessApplyBurnOnCrit, startEndlessRun
}
export type {
  EndlessBiomePoolSpec, EndlessBlessingIcon, EndlessBlessingModifiers,
  EndlessBlessingSpec, EndlessWaveStageSelection
} from './endless-roguelite.ts'
import {
  MAX_WORLD_EVENTS, WORLD_EVENT_AMBUSH_DURATION, WORLD_EVENT_GAUNTLET_DURATION,
  WORLD_EVENT_KINDS, WORLD_EVENT_MERCHANT_DURATION, buildWorldEventChapterSpec,
  buyWorldEventOffer, cloneWorldMapEvent, getEligibleWorldEventRoads, getWorldMapEventById,
  isWorldEventKind, removeWorldMapEvent, resolveWorldEventVictoryReward, sanitizeWorldMapEvents,
  tickWorldMapEvents
} from './world-events.ts'
export {
  MAX_WORLD_EVENTS, WORLD_EVENT_AMBUSH_DURATION, WORLD_EVENT_GAUNTLET_DURATION,
  WORLD_EVENT_KINDS, WORLD_EVENT_MERCHANT_DURATION, buildWorldEventChapterSpec,
  buyWorldEventOffer, cloneWorldMapEvent, getEligibleWorldEventRoads, getWorldMapEventById,
  isWorldEventKind, removeWorldMapEvent, resolveWorldEventVictoryReward, sanitizeWorldMapEvents,
  tickWorldMapEvents
}
export type {
  WorldEventPurchaseResult, WorldEventRoadCandidate, WorldEventTickResult,
  WorldEventVictoryRewardPlan
} from './world-events.ts'
import type {
  AttackArc, BattleAtmosphere, BattleCellSnapshot, BattleHeroXpGain, BattleObjectiveEvaluation, BattleObjectiveKind,
  EndlessBlessingId,
  BattleObjectiveSnapshot, BattleObjectiveState, BattleReward, BattleSaveSnapshot, BattleSpeedMultiplier,
  BattleState, BattleUnit, BattleUnitSnapshot, BattleWeatherId, BiomeId, CampaignState, ChapterSpec, CombatForecast,
  CombatForecastAlt, CounterAvoidReason, DangerZoneMap, DangerZoneTile, DifficultyLevel, DisplacementPreview,
  ElementKind, ElementalComboPreview, EnemyArchetypeId, EnemyThreatMap, EquipSlot,
  EquipmentSpec, FacingDir, FacingExposureLevel, FacingExposureReport, FacingThreatEntry,
  FlankThreatTile, GameState, GridCell, GridCoord, HeroClassId, MoveAttackTile, OwnedEquipCard,
  OwnedHeroCard, OwnedTacticCard, PackId, PackRevealItem, Rarity, SaveData, SavedCampaignState, SkillSpec,
  StageDifficultyTier, StageMutatorId, StatusKind,
  TacticCardSpec, TileTerrain, TimeOfDayId, TurnActionKind, TurnOrderActionPreview, TurnPreviewEntry,
  WorldEventKind, WorldMapEvent
} from './types.ts'

export type { BattleSpeedMultiplier, PackPityStatus } from './types.ts'
export { applyDisplacement, resolveDisplacementPreview } from './forced-movement.ts'
export {
  classifyElement, classifyHazardElement, collectWildfirePatch,
  previewElementalCombo, triggerElementalCombo
}

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
  readonly jump: number
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
  const lvlBonus = levelStatBonuses(hero.heroId, hero.level ?? 1)

  let maxHp = Math.round(spec.maxHp * hpMul) + lvlBonus.hp
  let atk = Math.round(spec.atk * atkMul) + lvlBonus.atk
  let def = spec.def + defBonus + lvlBonus.def
  let speed = spec.speed + (hero.stars - 1) + lvlBonus.speed
  let move = spec.move
  let jump = spec.jump
  let range = spec.range
  let crit = spec.crit + lvlBonus.crit
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
    jump += (item.jump ?? 0) + getEquipmentJumpBonus(item.id)
    range += item.range
    crit += item.crit
    lifesteal += item.lifesteal
    shieldStart += item.shieldStart
  }

  crit = clamp(crit, 0, 0.85)
  lifesteal = clamp(lifesteal, 0, 0.75)
  speed = clamp(speed, 4, 24)
  move = clamp(move, 2, 6)
  jump = clamp(jump, 1, 4)
  range = clamp(range, 1, 6)
  const powerScore = Math.round(maxHp * 0.6 + atk * 3.2 + def * 2.5 + speed * 4 + move * 6 + range * 5 + crit * 40 + hero.stars * 25)
  return { maxHp, atk, def, speed, move, jump, range, crit, lifesteal, shieldStart, powerScore }
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
  // Locked copies cannot be consumed as fodder, while a locked target hero can still ascend.
  const matching = campaign.heroes.filter(
    h => h.heroId === target.heroId && h.stars === target.stars && h.uid !== target.uid && !h.locked
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

  // Preserve the highest level & XP across all merged copies, plus +25% bonus XP from consumed copies
  const allMerged = [target, ...sacrifices]
  let bestCopy = target
  let bestTotalXp = totalXpForLevel(target.level, target.xp)
  for (const copy of sacrifices) {
    const copyTotal = totalXpForLevel(copy.level, copy.xp)
    if (copyTotal > bestTotalXp) {
      bestTotalXp = copyTotal
      bestCopy = copy
    }
  }
  const baseLevel = normalizeHeroLevel(bestCopy.level)
  const baseXp = normalizeHeroXp(baseLevel, bestCopy.xp)
  let consumedXp = 0
  for (const copy of allMerged) {
    if (copy === bestCopy) continue
    consumedXp += totalXpForLevel(copy.level, copy.xp)
  }
  const mergeBonusXp = Math.floor(consumedXp * XP_MERGE_TRANSFER_RATIO)
  target.level = baseLevel
  target.xp = baseXp
  if (mergeBonusXp > 0) {
    grantHeroXp(target, mergeBonusXp)
  }

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

function getNearestByRarityPool<T extends { readonly rarity: Rarity }>(
  items: readonly T[],
  target: Rarity,
  minRarity?: Rarity
): T[] {
  const minRank = minRarity ? rarityRank(minRarity) : 0
  const eligible = items.filter(it => rarityRank(it.rarity) >= minRank)
  const pool = eligible.length ? eligible : items
  const exact = pool.filter(it => it.rarity === target)
  if (exact.length) return exact
  const tRank = rarityRank(target)
  let bestDist = 99
  let best: T[] = []
  for (const it of pool) {
    const d = Math.abs(rarityRank(it.rarity) - tRank)
    if (d < bestDist) { bestDist = d; best = [it] }
    else if (d === bestDist) best.push(it)
  }
  return best
}

function pickNearestByRarity<T extends { readonly rarity: Rarity }>(
  items: readonly T[],
  target: Rarity,
  campaign: CampaignState,
  minRarity?: Rarity
): T {
  const pool = getNearestByRarityPool(items, target, minRarity)
  return pool[Math.floor(randFloat(campaign) * pool.length) % pool.length]
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

  const nextSinceEpic = Math.max(0, campaign.packsSinceEpic) + 1
  const nextSinceLegendary = Math.max(0, campaign.packsSinceLegendary) + 1
  campaign.packsSinceEpic = nextSinceEpic
  campaign.packsSinceLegendary = nextSinceLegendary
  const pityGuarantee = resolvePackPityFloor(nextSinceEpic, nextSinceLegendary)

  const reveal: PackRevealItem[] = []
  let bestRarity: Rarity = 'common'

  for (let i = 0; i < pack.cardsPerPack; i++) {
    let floor: Rarity = i === 0 ? pack.guaranteedMinRarity : 'common'
    let pityTriggered: 'epic' | 'legendary' | undefined
    if (i === 0 && pityGuarantee) {
      if (rarityRank(pityGuarantee) > rarityRank(floor)) {
        floor = pityGuarantee
      }
      pityTriggered = pityGuarantee
    }
    const rollWeights = i === 0 && pack.featuredWeights ? pack.featuredWeights : pack.weights
    const rarity = rollRarity(campaign, rollWeights, floor)

    // Card 1 or ~48% Hero, ~32% Equipment, ~20% Tactic
    const kindRoll = randFloat(campaign)
    if (i === 1 || kindRoll < 0.48) {
      const heroPool = getNearestByRarityPool(HERO_LIST, rarity, floor)
      const heroSpec = selectProtectedHero(heroPool, campaign, randFloat(campaign))
      if (rarityRank(heroSpec.rarity) > rarityRank(bestRarity)) bestRarity = heroSpec.rarity

      if (hasMaxedHero(campaign, heroSpec.id)) {
        const bonusShards = getDuplicateMaxHeroShards(heroSpec.rarity)
        campaign.shards += bonusShards
        reveal.push({
          kind: 'hero',
          uid: allocUid(campaign, 'shard'),
          refId: heroSpec.id,
          name: `${heroSpec.name} (${heroSpec.title})`,
          rarity: heroSpec.rarity,
          detail: `MAX ★ → +${bonusShards} SHARDS`,
          value: computeCardValue(heroSpec.rarity, 1),
          isNew: false,
          convertedShards: bonusShards,
          ...(pityTriggered ? { pityTriggered } : {})
        })
      } else {
        const isNew = !campaign.heroes.some(h => h.heroId === heroSpec.id)
        const card: OwnedHeroCard = {
          uid: allocUid(campaign, 'hero'),
          heroId: heroSpec.id,
          stars: 1,
          level: 1,
          xp: 0,
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
          isNew,
          ...(pityTriggered ? { pityTriggered } : {})
        })
      }
    } else if (kindRoll < 0.80) {
      const equipPool = getNearestByRarityPool(EQUIPMENT_LIST, rarity, floor)
      const equipSpec: EquipmentSpec = selectProtectedEquipment(equipPool, campaign, randFloat(campaign))
      if (rarityRank(equipSpec.rarity) > rarityRank(bestRarity)) bestRarity = equipSpec.rarity
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
        isNew,
        ...(pityTriggered ? { pityTriggered } : {})
      })
    } else {
      const tacticSpec: TacticCardSpec = pickNearestByRarity(TACTIC_LIST, rarity, campaign, floor)
      if (rarityRank(tacticSpec.rarity) > rarityRank(bestRarity)) bestRarity = tacticSpec.rarity
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
        isNew,
        ...(pityTriggered ? { pityTriggered } : {})
      })
    }
  }

  updatePackPityCounters(campaign, bestRarity)
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
  if (hero.locked) return 0
  const spec = HERO_SPECS[hero.heroId]
  const base = RARITY_META[spec.rarity].salvage
  const gold = hero.stars === 3 ? base * 4 : hero.stars === 2 ? base * 2 : base
  const shards = getHeroSalvageShards(spec.rarity, hero.stars)
  campaign.heroes.splice(idx, 1)
  campaign.squadUids = campaign.squadUids.filter(uid => uid !== heroUid)
  if (campaign.selectedCampHeroUid === heroUid) {
    campaign.selectedCampHeroUid = campaign.squadUids[0] ?? campaign.heroes[0]?.uid ?? null
  }
  campaign.gold += gold
  campaign.shards += shards
  state.sounds.push({ kind: 'coin' })
  return gold
}

export function salvageEquipCard(state: GameState, equipUid: string): number {
  const { campaign } = state
  const idx = campaign.equipment.findIndex(e => e.uid === equipUid)
  if (idx < 0) return 0
  const item = campaign.equipment[idx]
  if (item.locked) return 0
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
  const dust = getEquipSalvageDust(spec.rarity)
  campaign.gold += gold
  campaign.dust += dust
  state.sounds.push({ kind: 'coin' })
  return gold
}

export function bulkSalvageCommonDupes(state: GameState): BulkSalvageResult {
  return executeBulkSalvageCommonDupes(state, salvageEquipCard)
}

export function createInitialCampaign(seed = 1337): CampaignState {
  const campaign: CampaignState = {
    seed: (seed >>> 0) || 1337,
    nextUid: 1,
    gold: 100,
    dust: 0,
    shards: 0,
    chaptersCleared: 0,
    clearedStageIds: [],
    clearedStageTiers: {},
    stageMastery: {},
    claimedStageMasteryChests: [],
    claimedMasteryMilestones: [],
    selectedStageId: CHAPTERS[0].id,
    endlessBest: 0,
    endlessRun: null,
    crownlessDeepFloor: 0,
    battlesWon: 0,
    packsOpened: 0,
    packsSinceEpic: 0,
    packsSinceLegendary: 0,
    heroes: [],
    equipment: [],
    tactics: [],
    squadUids: [],
    selectedCampHeroUid: null,
    lastPackReveal: [],
    seenTips: [],
    tipsDisabled: false,
    actionCameraEnabled: true,
    discoveredEnemies: [],
    battleSpeed: DEFAULT_BATTLE_SPEED,
    oakhavenExchange: { cycle: 0, boughtIds: [] },
    worldEvents: []
  }

  const starterKnight: OwnedHeroCard = {
    uid: allocUid(campaign, 'hero'), heroId: 'knight', stars: 1, level: 1, xp: 0,
    weaponUid: null, armorUid: null, relicUid: null
  }
  const starterArcher: OwnedHeroCard = {
    uid: allocUid(campaign, 'hero'), heroId: 'archer', stars: 1, level: 1, xp: 0,
    weaponUid: null, armorUid: null, relicUid: null
  }
  const starterMage: OwnedHeroCard = {
    uid: allocUid(campaign, 'hero'), heroId: 'mage', stars: 1, level: 1, xp: 0,
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

const TERRAIN_LOOKUP: ReadonlyMap<string, TileTerrain> = new Map<string, TileTerrain>([
  ['grass', 'grass'],
  ['stone', 'stone'],
  ['hill', 'hill'],
  ['bridge', 'bridge'],
  ['water', 'water'],
  ['shrine', 'shrine'],
  ['pillar', 'pillar'],
  ['lava', 'lava'],
  ['snow', 'snow'],
  ['darkstone', 'darkstone'],
  ['stairs', 'stairs'],
  ['void', 'void'],
  ['lava_geyser', 'lava_geyser'],
  ['ice', 'ice'],
  ['cursed_altar', 'cursed_altar'],
  ['tall_grass', 'tall_grass'],
  ['barricade', 'barricade']
])

const BIOME_LOOKUP: ReadonlyMap<string, BiomeId> = new Map<string, BiomeId>([
  ['meadow', 'meadow'],
  ['river', 'river'],
  ['crypt', 'crypt'],
  ['frost', 'frost'],
  ['volcano', 'volcano'],
  ['throne', 'throne'],
  ['dunes', 'dunes'],
  ['aether', 'aether'],
  ['expanse', 'expanse']
])

const FACING_LOOKUP: ReadonlyMap<string, FacingDir> = new Map<string, FacingDir>([
  ['n', 'n'],
  ['s', 's'],
  ['e', 'e'],
  ['w', 'w']
])

const HERO_ID_LOOKUP: ReadonlyMap<string, HeroClassId> = new Map<string, HeroClassId>(
  HERO_LIST.map(h => [h.id, h.id])
)

const ENEMY_ID_LOOKUP: ReadonlyMap<string, EnemyArchetypeId> = new Map<string, EnemyArchetypeId>([
  ['goblin', 'goblin'],
  ['bone_archer', 'bone_archer'],
  ['orc_brute', 'orc_brute'],
  ['bog_shaman', 'bog_shaman'],
  ['crypt_knight', 'crypt_knight'],
  ['frost_golem', 'frost_golem'],
  ['eclipse_archon', 'eclipse_archon'],
  ['ember_pyromancer', 'ember_pyromancer'],
  ['ice_wraith', 'ice_wraith'],
  ['bone_necromancer', 'bone_necromancer'],
  ['bone_thrall', 'bone_thrall'],
  ['river_troll', 'river_troll'],
  ['briar_warlord', 'briar_warlord'],
  ['mire_matriarch', 'mire_matriarch'],
  ['ash_inquisitor', 'ash_inquisitor'],
  ['frost_jarl', 'frost_jarl'],
  ['magma_warden', 'magma_warden'],
  ['dune_sovereign_boss', 'dune_sovereign_boss'],
  ['astral_warden_boss', 'astral_warden_boss'],
  ['unbroken_crown_boss', 'unbroken_crown_boss'],
  ['lich_vaelen', 'lich_vaelen'],
  ['frostwyrm_rimefang', 'frostwyrm_rimefang'],
  ['ignis_titan', 'ignis_titan'],
  ['abyssal_sentinel', 'abyssal_sentinel']
])

function toDifficultyLevel(raw: number): DifficultyLevel {
  const n = clamp(Math.floor(raw), 1, 8)
  if (n === 1) return 1
  if (n === 2) return 2
  if (n === 3) return 3
  if (n === 4) return 4
  if (n === 5) return 5
  if (n === 6) return 6
  if (n === 7) return 7
  return 8
}

function toStarTier(raw: number): 1 | 2 | 3 {
  const s = clamp(Math.round(raw), 1, 3)
  if (s === 1) return 1
  if (s === 2) return 2
  return 3
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function cloneCampaignFromSave(c: SavedCampaignState, fallbackSeed: number): CampaignState {
  const rawCount = Number.isFinite(c.chaptersCleared) ? clamp(Math.floor(c.chaptersCleared), 0, PLAYABLE_CHAPTERS.length) : 0
  const clearedStageIds: string[] = Array.isArray(c.clearedStageIds)
    ? c.clearedStageIds.filter((id): id is string => typeof id === 'string' && Boolean(CHAPTER_BY_ID[id]) && !CHAPTER_BY_ID[id].comingSoon)
    : PLAYABLE_CHAPTERS.slice(0, rawCount).map(ch => ch.id)
  const dedupCleared = Array.from(new Set(clearedStageIds))
  const cloned: CampaignState = {
    seed: Number.isFinite(c.seed) ? (c.seed >>> 0) || 1337 : fallbackSeed,
    nextUid: Number.isFinite(c.nextUid) && c.nextUid > 0 ? Math.floor(c.nextUid) : 100,
    gold: Number.isFinite(c.gold) && c.gold >= 0 ? Math.floor(c.gold) : 100,
    dust: isFiniteNum(c.dust) && c.dust >= 0 ? Math.floor(c.dust) : 0,
    shards: isFiniteNum(c.shards) && c.shards >= 0 ? Math.floor(c.shards) : 0,
    chaptersCleared: dedupCleared.length,
    clearedStageIds: dedupCleared,
    clearedStageTiers: sanitizeClearedStageTiers(c.clearedStageTiers, dedupCleared),
    stageMastery: sanitizeStageMastery(c.stageMastery, dedupCleared),
    claimedStageMasteryChests: sanitizeClaimedStageMasteryChests(c.claimedStageMasteryChests),
    claimedMasteryMilestones: sanitizeClaimedMasteryMilestones(c.claimedMasteryMilestones),
    selectedStageId: typeof c.selectedStageId === 'string' && CHAPTER_BY_ID[c.selectedStageId]
      ? c.selectedStageId
      : CHAPTERS[0].id,
    endlessBest: Number.isFinite(c.endlessBest) ? Math.max(0, Math.floor(c.endlessBest)) : 0,
    endlessRun: sanitizeEndlessRunState(c.endlessRun),
    crownlessDeepFloor: normalizeCrownlessDeepFloorCleared(c.crownlessDeepFloor),
    ...(isFiniteNum(c.crownlessDeepSelectedFloor)
      ? {
          crownlessDeepSelectedFloor: clamp(
            Math.floor(c.crownlessDeepSelectedFloor),
            1,
            Math.min(CROWNLESS_DEEP_MAX_FLOOR, normalizeCrownlessDeepFloorCleared(c.crownlessDeepFloor) + 1)
          )
        }
      : {}),
    ...(c.crownlessDeepRewardClaimed === true ? { crownlessDeepRewardClaimed: true } : {}),
    battlesWon: Number.isFinite(c.battlesWon) ? Math.max(0, Math.floor(c.battlesWon)) : 0,
    packsOpened: Number.isFinite(c.packsOpened) ? Math.max(0, Math.floor(c.packsOpened)) : 0,
    packsSinceEpic: isFiniteNum(c.packsSinceEpic) ? Math.max(0, Math.floor(c.packsSinceEpic)) : 0,
    packsSinceLegendary: isFiniteNum(c.packsSinceLegendary) ? Math.max(0, Math.floor(c.packsSinceLegendary)) : 0,
    heroes: c.heroes.map(h => {
      const level = normalizeHeroLevel(h.level)
      const xp = normalizeHeroXp(level, h.xp)
      return { ...h, level, xp, locked: h.locked === true }
    }),
    equipment: Array.isArray(c.equipment) ? c.equipment.map(e => ({ ...e, locked: e.locked === true })) : [],
    tactics: Array.isArray(c.tactics) ? c.tactics.map(t => ({ ...t })) : [],
    ...(Array.isArray(c.activeTacticDeckUids)
      ? { activeTacticDeckUids: c.activeTacticDeckUids.filter((u): u is string => typeof u === 'string') }
      : {}),
    squadUids: Array.isArray(c.squadUids) && c.squadUids.length ? c.squadUids.slice() : [c.heroes[0].uid],
    selectedCampHeroUid: c.selectedCampHeroUid ?? c.heroes[0].uid,
    lastPackReveal: [],
    seenTips: normalizeSeenTips(c.seenTips),
    tipsDisabled: c.tipsDisabled === true,
    actionCameraEnabled: c.actionCameraEnabled !== false,
    discoveredEnemies: normalizeDiscoveredEnemies(c.discoveredEnemies, dedupCleared),
    battleSpeed: normalizeBattleSpeed(c.battleSpeed),
    oakhavenExchange: normalizeOakhavenExchange(
      c.oakhavenExchange,
      Number.isFinite(c.battlesWon) ? Math.max(0, Math.floor(c.battlesWon)) : 0
    ),
    worldEvents: sanitizeWorldMapEvents(c.worldEvents)
  }
  if (!isStageUnlocked(cloned, cloned.selectedStageId)) {
    cloned.selectedStageId = getNextRecommendedStage(cloned).id
  }
  return cloned
}

const OBJECTIVE_KIND_LOOKUP: ReadonlyMap<string, BattleObjectiveKind> = new Map<string, BattleObjectiveKind>([
  ['rout', 'rout'],
  ['assassinate', 'assassinate'],
  ['defend', 'defend'],
  ['seize', 'seize']
])

function serializeObjective(obj: BattleObjectiveState): BattleObjectiveSnapshot {
  return {
    kind: obj.kind,
    label: obj.label,
    description: obj.description,
    ...(obj.targetEnemyUid !== undefined ? { targetEnemyUid: obj.targetEnemyUid } : {}),
    ...(obj.targetName !== undefined ? { targetName: obj.targetName } : {}),
    ...(obj.targetTurns !== undefined ? { targetTurns: obj.targetTurns } : {}),
    ...(obj.protectTile !== undefined ? { protectTile: { col: obj.protectTile.col, row: obj.protectTile.row } } : {}),
    ...(obj.protectLabel !== undefined ? { protectLabel: obj.protectLabel } : {}),
    ...(obj.protectBreached ? { protectBreached: true } : {}),
    ...(obj.goalTile !== undefined ? { goalTile: { col: obj.goalTile.col, row: obj.goalTile.row } } : {}),
    ...(obj.goalLabel !== undefined ? { goalLabel: obj.goalLabel } : {}),
    ...(obj.seized ? { seized: true } : {}),
    ...(obj.chestTiles.length > 0 ? { chestTiles: obj.chestTiles.map(c => ({ col: c.col, row: c.row })) } : {}),
    ...(obj.claimedChests.length > 0 ? { claimedChests: obj.claimedChests.map(c => ({ col: c.col, row: c.row })) } : {}),
    ...(obj.requiredChests > 0 ? { requiredChests: obj.requiredChests } : {}),
    ...(obj.turnLimit !== undefined ? { turnLimit: obj.turnLimit } : {}),
    roundsElapsed: obj.roundsElapsed
  }
}

function validateCoord(raw: unknown, cols: number, rows: number): GridCoord | null {
  if (!isRecord(raw) || !isFiniteNum(raw.col) || !isFiniteNum(raw.row)) return null
  const col = Math.floor(raw.col)
  const row = Math.floor(raw.row)
  if (!isCellInBounds(col, row, cols, rows)) return null
  return { col, row }
}

function validateObjectiveSnapshot(
  raw: unknown,
  cols: number,
  rows: number
): BattleObjectiveSnapshot | null {
  if (!isRecord(raw)) return null
  const kind = typeof raw.kind === 'string' ? OBJECTIVE_KIND_LOOKUP.get(raw.kind) : undefined
  if (!kind) return null
  if (typeof raw.label !== 'string' || typeof raw.description !== 'string') return null
  if (!isFiniteNum(raw.roundsElapsed) || raw.roundsElapsed < 0) return null

  const targetEnemyUid = typeof raw.targetEnemyUid === 'string' && raw.targetEnemyUid.length > 0 ? raw.targetEnemyUid : undefined
  const targetName = typeof raw.targetName === 'string' && raw.targetName.length > 0 ? raw.targetName : undefined
  const targetTurns = isFiniteNum(raw.targetTurns) && raw.targetTurns > 0 ? Math.floor(raw.targetTurns) : undefined
  const protectTile = raw.protectTile !== undefined ? validateCoord(raw.protectTile, cols, rows) ?? undefined : undefined
  const protectLabel = typeof raw.protectLabel === 'string' && raw.protectLabel.length > 0 ? raw.protectLabel : undefined
  const protectBreached = raw.protectBreached === true
  const goalTile = raw.goalTile !== undefined ? validateCoord(raw.goalTile, cols, rows) ?? undefined : undefined
  const goalLabel = typeof raw.goalLabel === 'string' && raw.goalLabel.length > 0 ? raw.goalLabel : undefined
  const seized = raw.seized === true

  const chestTiles: GridCoord[] = []
  if (Array.isArray(raw.chestTiles)) {
    for (const item of raw.chestTiles) {
      const c = validateCoord(item, cols, rows)
      if (c) chestTiles.push(c)
    }
  }
  const claimedChests: GridCoord[] = []
  if (Array.isArray(raw.claimedChests)) {
    for (const item of raw.claimedChests) {
      const c = validateCoord(item, cols, rows)
      if (c) claimedChests.push(c)
    }
  }
  const requiredChests = isFiniteNum(raw.requiredChests) && raw.requiredChests >= 0 ? Math.floor(raw.requiredChests) : 0
  const turnLimit = isFiniteNum(raw.turnLimit) && raw.turnLimit > 0 ? Math.floor(raw.turnLimit) : undefined

  return {
    kind,
    label: raw.label,
    description: raw.description,
    ...(targetEnemyUid !== undefined ? { targetEnemyUid } : {}),
    ...(targetName !== undefined ? { targetName } : {}),
    ...(targetTurns !== undefined ? { targetTurns } : {}),
    ...(protectTile !== undefined ? { protectTile } : {}),
    ...(protectLabel !== undefined ? { protectLabel } : {}),
    ...(protectBreached ? { protectBreached: true } : {}),
    ...(goalTile !== undefined ? { goalTile } : {}),
    ...(goalLabel !== undefined ? { goalLabel } : {}),
    ...(seized ? { seized: true } : {}),
    ...(chestTiles.length > 0 ? { chestTiles } : {}),
    ...(claimedChests.length > 0 ? { claimedChests } : {}),
    ...(requiredChests > 0 ? { requiredChests } : {}),
    ...(turnLimit !== undefined ? { turnLimit } : {}),
    roundsElapsed: Math.floor(raw.roundsElapsed)
  }
}

export function serializeBattleState(
  battle: BattleState | null,
  rngSeed?: number
): BattleSaveSnapshot | null {
  if (!battle) return null
  if (battle.phase !== 'player' && battle.phase !== 'enemy') return null
  const hasAliveAlly = battle.units.some(u => u.alive && u.team === 'ally')
  const hasAliveEnemy = battle.units.some(u => u.alive && u.team === 'enemy')
  if (!hasAliveAlly || !hasAliveEnemy) return null

  const occupied = new Set<string>()
  for (const u of battle.units) {
    if ((u.alive || isUnitDowned(u)) && u.path.length === 0) {
      for (const fc of getUnitFootprintCells(u)) {
        occupied.add(`${fc.col},${fc.row}`)
      }
    }
  }

  let enemyMidMoveReset = false
  const units: BattleUnitSnapshot[] = battle.units.map(u => {
    const fpSize = getUnitFootprintSize(u)
    let col = u.col
    let row = u.row
    if (u.alive && u.path.length > 0) {
      const dest = u.path[u.path.length - 1]
      const destCells = getFootprintCellsAt(dest.col, dest.row, fpSize)
      const destValid = destCells.every(
        fc => isCellInBounds(fc.col, fc.row, battle.cols, battle.rows) && !occupied.has(`${fc.col},${fc.row}`)
      )
      if (destValid) {
        col = dest.col
        row = dest.row
        for (const fc of destCells) occupied.add(`${fc.col},${fc.row}`)
      } else {
        for (const fc of getFootprintCellsAt(col, row, fpSize)) occupied.add(`${fc.col},${fc.row}`)
      }
      if (battle.phase === 'enemy' && u.uid === battle.activeUnitUid && !u.acted) {
        enemyMidMoveReset = true
      }
    }
    const snap: BattleUnitSnapshot = {
      uid: u.uid,
      team: u.team,
      name: u.name,
      ...(u.heroId !== undefined ? { heroId: u.heroId } : {}),
      ...(u.enemyId !== undefined ? { enemyId: u.enemyId } : {}),
      stars: u.stars,
      level: normalizeHeroLevel(u.level),
      isBoss: u.isBoss,
      ...(u.bossPhase !== undefined ? { bossPhase: u.bossPhase } : {}),
      ...(fpSize > 1 ? { footprintSize: fpSize } : {}),
      ...(u.summonerUid !== undefined ? { summonerUid: u.summonerUid } : {}),
      ...(u.weaponId !== undefined ? { weaponId: u.weaponId } : {}),
      ...(u.armorId !== undefined ? { armorId: u.armorId } : {}),
      ...(u.relicId !== undefined ? { relicId: u.relicId } : {}),
      col,
      row,
      facing: battle.facingPicker?.unitUid === u.uid ? battle.facingPicker.originalFacing : u.facing,
      hp: u.hp,
      maxHp: u.maxHp,
      shield: u.shield,
      atk: u.atk,
      def: u.def,
      speed: u.speed,
      ct: u.ct,
      move: u.move,
      jump: u.jump,
      range: u.range,
      crit: u.crit,
      lifesteal: u.lifesteal,
      moved: u.moved,
      acted: u.acted,
      alive: u.alive,
      downed: isUnitDowned(u),
      koCountdown: isUnitDowned(u) ? u.koCountdown : 0,
      burnTurns: u.burnTurns,
      slowTurns: u.slowTurns,
      stunTurns: u.stunTurns,
      empowerTurns: u.empowerTurns,
      tauntTurns: u.tauntTurns,
      hasteTurns: u.hasteTurns,
      poisonStacks: u.poisonStacks,
      cooldowns: [u.cooldowns[0], u.cooldowns[1], u.cooldowns[2]],
      ...(u.crownbladeKoUsed ? { crownbladeKoUsed: true } : {})
    }
    return snap
  })

  const cells: BattleCellSnapshot[][] = battle.cells.map(row =>
    row.map(cell => ({
      terrain: cell.terrain,
      heightLevel: cellHeightLevel(cell),
      ...(cell.shrineUsed ? { shrineUsed: true } : {}),
      ...(cell.barricadeHp !== undefined ? { barricadeHp: cell.barricadeHp } : {}),
      ...(cell.barricadeMaxHp !== undefined ? { barricadeMaxHp: cell.barricadeMaxHp } : {}),
      ...(cell.geyserActive !== undefined ? { geyserActive: cell.geyserActive } : {}),
      ...(cell.altarUsed !== undefined ? { altarUsed: cell.altarUsed } : {})
    }))
  )

  return {
    version: 1,
    stageId: battle.stageId,
    chapterIndex: battle.chapterIndex,
    endlessWave: battle.endlessWave,
    ...(battle.endlessBlessings && battle.endlessBlessings.length > 0
      ? { endlessBlessings: battle.endlessBlessings.slice() }
      : {}),
    ...(battle.phoenixGraceUsed ? { phoenixGraceUsed: true } : {}),
    ...(battle.activeWorldEventId !== undefined ? { activeWorldEventId: battle.activeWorldEventId } : {}),
    ...(battle.activeWorldEventKind !== undefined ? { activeWorldEventKind: battle.activeWorldEventKind } : {}),
    ...(battle.activeWorldEventTitle !== undefined ? { activeWorldEventTitle: battle.activeWorldEventTitle } : {}),
    ...(battle.gauntletRound !== undefined ? { gauntletRound: battle.gauntletRound } : {}),
    ...(battle.gauntletMaxRounds !== undefined ? { gauntletMaxRounds: battle.gauntletMaxRounds } : {}),
    ...(battle.abyssFloor !== undefined ? { abyssFloor: battle.abyssFloor } : {}),
    difficulty: battle.difficulty,
    difficultyTier: battle.difficultyTier,
    mutators: battle.mutators.slice(),
    cols: battle.cols,
    rows: battle.rows,
    biome: battle.biome,
    weather: battle.weather,
    timeOfDay: battle.timeOfDay,
    cells,
    units,
    turn: battle.turn,
    phase: battle.phase,
    activeUnitUid: battle.activeUnitUid,
    selectedUnitUid: battle.selectedUnitUid,
    ap: battle.ap,
    maxAp: battle.maxAp,
    drawPile: battle.drawPile.slice(),
    hand: battle.hand.slice(),
    discardPile: battle.discardPile.slice(),
    tacticsPlayed: battle.tacticsPlayed,
    enemyDelay: battle.enemyDelay,
    enemyActedThisTurn: enemyMidMoveReset ? false : battle.enemyActedThisTurn,
    battleSpeed: normalizeBattleSpeed(battle.battleSpeed),
    ...(rngSeed !== undefined && Number.isFinite(rngSeed) ? { rngSeed: (rngSeed >>> 0) || 1337 } : {}),
    objective: serializeObjective(battle.objective),
    ...(battle.stageMechanic ? { stageMechanic: cloneStageMechanicState(battle.stageMechanic) } : {}),
    xpEarnedByHero: { ...battle.xpEarnedByHero },
    heroStartLevelByUid: { ...battle.heroStartLevelByUid },
    ...(battle.heroKoCount > 0 ? { heroKoCount: Math.floor(battle.heroKoCount) } : {}),
    ...(battle.anyHeroFallen ? { anyHeroFallen: true } : {}),
    combatLog: battle.combatLog.slice(-MAX_COMBAT_LOG_ENTRIES).map(e => ({ ...e })),
    nextLogId: Math.max(1, Math.floor(battle.nextLogId || 1))
  }
}

export function validateBattleSnapshot(raw: unknown): BattleSaveSnapshot | null {
  if (!isRecord(raw)) return null
  if (raw.version !== 1) return null

  const stageId = typeof raw.stageId === 'string' ? raw.stageId : ''
  const chapter = CHAPTER_BY_ID[stageId]
  if (!chapter) return null

  if (!isFiniteNum(raw.chapterIndex) || raw.chapterIndex < 0 || raw.chapterIndex >= CHAPTERS.length) return null
  const chapterIndex = chapter.index

  if (!isFiniteNum(raw.endlessWave) || raw.endlessWave < 0) return null
  const endlessWave = Math.floor(raw.endlessWave)

  let endlessBlessings: EndlessBlessingId[] | undefined
  if (raw.endlessBlessings !== undefined) {
    if (!Array.isArray(raw.endlessBlessings)) return null
    for (const item of raw.endlessBlessings) {
      if (!isEndlessBlessingId(item)) return null
    }
    const normBlessings = normalizeEndlessBlessings(raw.endlessBlessings)
    if (normBlessings.length > 0) endlessBlessings = normBlessings
  }
  if (raw.phoenixGraceUsed !== undefined && typeof raw.phoenixGraceUsed !== 'boolean') return null
  const phoenixGraceUsed = raw.phoenixGraceUsed === true ? true : undefined
  let activeWorldEventId: string | undefined
  if (raw.activeWorldEventId !== undefined) {
    if (typeof raw.activeWorldEventId !== 'string' || raw.activeWorldEventId.length === 0) return null
    activeWorldEventId = raw.activeWorldEventId
  }
  let activeWorldEventKind: WorldEventKind | undefined
  if (raw.activeWorldEventKind !== undefined) {
    if (!isWorldEventKind(raw.activeWorldEventKind)) return null
    activeWorldEventKind = raw.activeWorldEventKind
  }
  let activeWorldEventTitle: string | undefined
  if (raw.activeWorldEventTitle !== undefined) {
    if (typeof raw.activeWorldEventTitle !== 'string' || raw.activeWorldEventTitle.length === 0) return null
    activeWorldEventTitle = raw.activeWorldEventTitle
  }

  let gauntletRound: number | undefined
  let gauntletMaxRounds: number | undefined
  if (raw.gauntletMaxRounds !== undefined) {
    if (!isFiniteNum(raw.gauntletMaxRounds) || raw.gauntletMaxRounds < 1) return null
    gauntletMaxRounds = clamp(Math.floor(raw.gauntletMaxRounds), 1, 10)
  }
  if (raw.gauntletRound !== undefined) {
    if (!isFiniteNum(raw.gauntletRound) || raw.gauntletRound < 1) return null
    const maxR = gauntletMaxRounds ?? Math.max(1, getGauntletMaxRounds(stageId))
    gauntletRound = clamp(Math.floor(raw.gauntletRound), 1, maxR)
    if (gauntletMaxRounds === undefined && maxR > 1) gauntletMaxRounds = maxR
  }
  let abyssFloor: number | undefined
  if (raw.abyssFloor !== undefined) {
    if (!isFiniteNum(raw.abyssFloor) || raw.abyssFloor < 1) return null
    abyssFloor = clamp(Math.floor(raw.abyssFloor), 1, CROWNLESS_DEEP_MAX_FLOOR)
  }

  const rawDiff = isFiniteNum(raw.difficulty) ? raw.difficulty : chapter.difficulty
  const difficulty: DifficultyLevel = toDifficultyLevel(rawDiff)

  let difficultyTier: StageDifficultyTier = 'normal'
  if (raw.difficultyTier !== undefined) {
    if (!isStageDifficultyTier(raw.difficultyTier)) return null
    difficultyTier = raw.difficultyTier
  }
  let mutators: StageMutatorId[] = []
  if (raw.mutators !== undefined) {
    if (!Array.isArray(raw.mutators)) return null
    for (const item of raw.mutators) {
      if (!isStageMutatorId(item)) return null
    }
    mutators = normalizeStageMutators(raw.mutators)
  }

  const biome = typeof raw.biome === 'string' ? BIOME_LOOKUP.get(raw.biome) : undefined
  if (!biome) return null

  let weather: BattleWeatherId | undefined
  if (raw.weather !== undefined) {
    if (!isBattleWeatherId(raw.weather)) return null
    weather = raw.weather
  }
  let timeOfDay: TimeOfDayId | undefined
  if (raw.timeOfDay !== undefined) {
    if (!isTimeOfDayId(raw.timeOfDay)) return null
    timeOfDay = raw.timeOfDay
  }

  if (!isFiniteNum(raw.cols) || !isFiniteNum(raw.rows)) return null
  const cols = Math.floor(raw.cols)
  const rows = Math.floor(raw.rows)
  if (cols < 2 || cols > 32 || rows < 2 || rows > 32) return null

  if (!Array.isArray(raw.cells) || raw.cells.length !== rows) return null
  const cells: BattleCellSnapshot[][] = []
  for (let r = 0; r < rows; r++) {
    const rawRow = raw.cells[r]
    if (!Array.isArray(rawRow) || rawRow.length !== cols) return null
    const line: BattleCellSnapshot[] = []
    for (let c = 0; c < cols; c++) {
      const rawCell = rawRow[c]
      if (!isRecord(rawCell) || typeof rawCell.terrain !== 'string') return null
      const terrain = TERRAIN_LOOKUP.get(rawCell.terrain)
      if (!terrain) return null
      const rawH = rawCell.heightLevel
      if (rawH !== undefined && !isFiniteNum(rawH)) return null
      const heightLevel = terrain === 'void'
        ? -1
        : rawH !== undefined
          ? clamp(Math.round(rawH), 0, MAX_HEIGHT_LEVEL)
          : defaultTerrainHeightLevel(terrain)
      const barricadeMaxHp = isFiniteNum(rawCell.barricadeMaxHp) && rawCell.barricadeMaxHp > 0
        ? Math.max(1, Math.round(rawCell.barricadeMaxHp))
        : (terrain === 'barricade' ? BARRICADE_DEFAULT_HP : undefined)
      const barricadeHp = isFiniteNum(rawCell.barricadeHp)
        ? clamp(Math.round(rawCell.barricadeHp), 0, barricadeMaxHp ?? BARRICADE_DEFAULT_HP)
        : (terrain === 'barricade' ? BARRICADE_DEFAULT_HP : undefined)
      const geyserActive = typeof rawCell.geyserActive === 'boolean'
        ? rawCell.geyserActive
        : (terrain === 'lava_geyser' ? false : undefined)
      const altarUsed = typeof rawCell.altarUsed === 'boolean'
        ? rawCell.altarUsed
        : (terrain === 'cursed_altar' ? false : undefined)
      line.push({
        terrain,
        heightLevel,
        ...(rawCell.shrineUsed === true ? { shrineUsed: true } : {}),
        ...(barricadeHp !== undefined ? { barricadeHp } : {}),
        ...(barricadeMaxHp !== undefined ? { barricadeMaxHp } : {}),
        ...(geyserActive !== undefined ? { geyserActive } : {}),
        ...(altarUsed !== undefined ? { altarUsed } : {})
      })
    }
    cells.push(line)
  }

  if (raw.phase !== 'player' && raw.phase !== 'enemy') return null
  const phase = raw.phase

  if (!isFiniteNum(raw.turn) || raw.turn < 1) return null
  const turn = Math.floor(raw.turn)

  if (!isFiniteNum(raw.maxAp) || !isFiniteNum(raw.ap)) return null
  const maxAp = clamp(Math.floor(raw.maxAp), 1, 12)
  const ap = clamp(Math.floor(raw.ap), 0, maxAp)

  if (!Array.isArray(raw.units) || raw.units.length === 0) return null
  const seenUids = new Set<string>()
  const occupied = new Set<string>()
  const units: BattleUnitSnapshot[] = []
  let aliveAllies = 0
  let aliveEnemies = 0

  for (const item of raw.units) {
    if (!isRecord(item)) return null
    if (typeof item.uid !== 'string' || item.uid.length === 0 || seenUids.has(item.uid)) return null
    seenUids.add(item.uid)

    if (item.team !== 'ally' && item.team !== 'enemy') return null
    const team = item.team

    if (typeof item.name !== 'string' || item.name.length === 0) return null

    let heroId: HeroClassId | undefined
    let enemyId: EnemyArchetypeId | undefined
    if (team === 'ally') {
      const parsedHero = typeof item.heroId === 'string' ? HERO_ID_LOOKUP.get(item.heroId) : undefined
      if (!parsedHero) return null
      heroId = parsedHero
    } else {
      const parsedEnemy = typeof item.enemyId === 'string' ? ENEMY_ID_LOOKUP.get(item.enemyId) : undefined
      if (!parsedEnemy) return null
      enemyId = parsedEnemy
    }

    if (!isFiniteNum(item.stars)) return null
    const stars = toStarTier(item.stars)
    if (item.level !== undefined && !isFiniteNum(item.level)) return null
    const unitLevel = item.level !== undefined ? normalizeHeroLevel(item.level) : 1
    const isBoss = Boolean(item.isBoss)
    if (item.bossPhase !== undefined && !isFiniteNum(item.bossPhase)) return null
    const bossPhase = item.bossPhase !== undefined ? clamp(Math.floor(item.bossPhase), 1, 4) : undefined

    if (!isFiniteNum(item.col) || !isFiniteNum(item.row)) return null
    const col = Math.floor(item.col)
    const row = Math.floor(item.row)
    if (!isCellInBounds(col, row, cols, rows)) return null

    const facing = typeof item.facing === 'string' ? FACING_LOOKUP.get(item.facing) : undefined
    if (!facing) return null

    if (
      !isFiniteNum(item.maxHp) || item.maxHp < 1 ||
      !isFiniteNum(item.hp) ||
      !isFiniteNum(item.shield) ||
      !isFiniteNum(item.atk) ||
      !isFiniteNum(item.def) ||
      !isFiniteNum(item.speed) ||
      !isFiniteNum(item.ct) ||
      !isFiniteNum(item.move) ||
      !isFiniteNum(item.jump) ||
      !isFiniteNum(item.range) ||
      !isFiniteNum(item.crit) ||
      !isFiniteNum(item.lifesteal) ||
      !isFiniteNum(item.burnTurns) ||
      !isFiniteNum(item.slowTurns) ||
      !isFiniteNum(item.stunTurns) ||
      !isFiniteNum(item.empowerTurns) ||
      (item.tauntTurns !== undefined && !isFiniteNum(item.tauntTurns)) ||
      (item.hasteTurns !== undefined && !isFiniteNum(item.hasteTurns)) ||
      (item.poisonStacks !== undefined && !isFiniteNum(item.poisonStacks))
    ) {
      return null
    }
    if (typeof item.alive !== 'boolean' || typeof item.moved !== 'boolean' || typeof item.acted !== 'boolean') {
      return null
    }
    if (item.downed !== undefined && typeof item.downed !== 'boolean') return null
    if (item.koCountdown !== undefined && !isFiniteNum(item.koCountdown)) return null
    if (!Array.isArray(item.cooldowns) || item.cooldowns.length !== 3) return null
    const cd0 = item.cooldowns[0]
    const cd1 = item.cooldowns[1]
    const cd2 = item.cooldowns[2]
    if (!isFiniteNum(cd0) || !isFiniteNum(cd1) || !isFiniteNum(cd2)) return null

    const maxHp = Math.max(1, Math.round(item.maxHp))
    const alive = item.alive && item.hp > 0
    const hp = alive ? clamp(Math.round(item.hp), 1, maxHp) : 0
    const rawCountdown = isFiniteNum(item.koCountdown) ? clamp(Math.floor(item.koCountdown), 0, KO_COUNTDOWN_TURNS) : 0
    const downed = !alive && team === 'ally' && item.downed === true && rawCountdown > 0
    const koCountdown = downed ? rawCountdown : 0

    const rawFp = item.footprintSize
    if (rawFp !== undefined && rawFp !== 1 && rawFp !== 2) return null
    const footprintSize: 1 | 2 = rawFp === 2
      ? 2
      : rawFp === 1
        ? 1
        : (enemyId && ENEMY_SPECS[enemyId]?.footprintSize === 2 ? 2 : 1)

    if (alive || downed) {
      const fpCells = getFootprintCellsAt(col, row, footprintSize)
      for (const fc of fpCells) {
        if (!isCellInBounds(fc.col, fc.row, cols, rows)) return null
        if (cells[fc.row][fc.col].terrain === 'void') return null
        const posKey = `${fc.col},${fc.row}`
        if (occupied.has(posKey)) return null
        occupied.add(posKey)
      }
    }
    if (alive) {
      if (team === 'ally') aliveAllies++
      else aliveEnemies++
    }

    const weaponId = typeof item.weaponId === 'string' && EQUIPMENT_BY_ID[item.weaponId] ? item.weaponId : undefined
    const armorId = typeof item.armorId === 'string' && EQUIPMENT_BY_ID[item.armorId] ? item.armorId : undefined
    const relicId = typeof item.relicId === 'string' && EQUIPMENT_BY_ID[item.relicId] ? item.relicId : undefined
    const summonerUid = typeof item.summonerUid === 'string' && item.summonerUid.length > 0 ? item.summonerUid : undefined

    units.push({
      uid: item.uid,
      team,
      name: item.name,
      ...(heroId !== undefined ? { heroId } : {}),
      ...(enemyId !== undefined ? { enemyId } : {}),
      stars,
      level: unitLevel,
      isBoss,
      ...(bossPhase !== undefined ? { bossPhase } : {}),
      ...(footprintSize > 1 ? { footprintSize } : {}),
      ...(summonerUid !== undefined ? { summonerUid } : {}),
      ...(weaponId !== undefined ? { weaponId } : {}),
      ...(armorId !== undefined ? { armorId } : {}),
      ...(relicId !== undefined ? { relicId } : {}),
      col,
      row,
      facing,
      hp,
      maxHp,
      shield: Math.max(0, Math.round(item.shield)),
      atk: Math.max(1, Math.round(item.atk)),
      def: Math.max(0, Math.round(item.def)),
      speed: clamp(Math.round(item.speed), 1, 50),
      ct: clamp(item.ct, 0, 1000),
      move: clamp(Math.round(item.move), 1, 12),
      jump: clamp(Math.round(item.jump), 0, 8),
      range: clamp(Math.round(item.range), 1, 12),
      crit: clamp(item.crit, 0, 1),
      lifesteal: clamp(item.lifesteal, 0, 1),
      moved: item.moved,
      acted: item.acted,
      alive,
      downed,
      koCountdown,
      burnTurns: Math.max(0, Math.floor(item.burnTurns)),
      slowTurns: Math.max(0, Math.floor(item.slowTurns)),
      stunTurns: Math.max(0, Math.floor(item.stunTurns)),
      empowerTurns: Math.max(0, Math.floor(item.empowerTurns)),
      tauntTurns: item.tauntTurns !== undefined ? Math.max(0, Math.floor(item.tauntTurns)) : 0,
      hasteTurns: item.hasteTurns !== undefined ? Math.max(0, Math.floor(item.hasteTurns)) : 0,
      poisonStacks: item.poisonStacks !== undefined ? clamp(Math.floor(item.poisonStacks), 0, MAX_POISON_STACKS) : 0,
      cooldowns: [
        Math.max(0, Math.floor(cd0)),
        Math.max(0, Math.floor(cd1)),
        Math.max(0, Math.floor(cd2))
      ],
      ...(item.crownbladeKoUsed === true ? { crownbladeKoUsed: true } : {})
    })
  }

  if (aliveAllies === 0 || aliveEnemies === 0) return null

  const activeUnitUid = typeof raw.activeUnitUid === 'string' ? raw.activeUnitUid : null
  const activeUnit = activeUnitUid ? units.find(u => u.uid === activeUnitUid && u.alive) : undefined
  if (!activeUnit) return null
  if (phase === 'player' && activeUnit.team !== 'ally') return null
  if (phase === 'enemy' && activeUnit.team !== 'enemy') return null

  const rawSelectedUid = typeof raw.selectedUnitUid === 'string' ? raw.selectedUnitUid : null
  const selectedUnitUid = rawSelectedUid && units.some(u => u.uid === rawSelectedUid && u.alive)
    ? rawSelectedUid
    : activeUnitUid

  if (!Array.isArray(raw.drawPile) || !Array.isArray(raw.hand) || !Array.isArray(raw.discardPile)) return null
  const drawPile = raw.drawPile.filter((s): s is string => typeof s === 'string' && s.length > 0)
  const hand = raw.hand.filter((s): s is string => typeof s === 'string' && s.length > 0)
  const discardPile = raw.discardPile.filter((s): s is string => typeof s === 'string' && s.length > 0)

  const tacticsPlayed = isFiniteNum(raw.tacticsPlayed) ? Math.max(0, Math.floor(raw.tacticsPlayed)) : 0
  const enemyDelay = isFiniteNum(raw.enemyDelay) ? clamp(raw.enemyDelay, 0, 2) : 0.34
  const enemyActedThisTurn = typeof raw.enemyActedThisTurn === 'boolean' ? raw.enemyActedThisTurn : false
  const battleSpeed = raw.battleSpeed !== undefined ? normalizeBattleSpeed(raw.battleSpeed) : undefined
  const rngSeed = isFiniteNum(raw.rngSeed) ? ((raw.rngSeed >>> 0) || 1337) : undefined
  const objective = raw.objective !== undefined ? validateObjectiveSnapshot(raw.objective, cols, rows) ?? undefined : undefined
  const stageMechanic = validateStageMechanicSnapshot(raw.stageMechanic)
  let xpEarnedByHero: Record<string, number> | undefined
  if (isRecord(raw.xpEarnedByHero)) {
    xpEarnedByHero = {}
    for (const [k, v] of Object.entries(raw.xpEarnedByHero)) {
      if (isFiniteNum(v) && v >= 0) xpEarnedByHero[k] = Math.floor(v)
    }
  }
  let heroStartLevelByUid: Record<string, number> | undefined
  if (isRecord(raw.heroStartLevelByUid)) {
    heroStartLevelByUid = {}
    for (const [k, v] of Object.entries(raw.heroStartLevelByUid)) {
      if (isFiniteNum(v)) heroStartLevelByUid[k] = normalizeHeroLevel(v)
    }
  }
  const combatLog = raw.combatLog !== undefined ? sanitizeCombatLogEntries(raw.combatLog) : undefined
  const heroKoCount = isFiniteNum(raw.heroKoCount) && raw.heroKoCount >= 0 ? Math.floor(raw.heroKoCount) : undefined
  const anyHeroFallen = raw.anyHeroFallen === true ? true : undefined
  const maxLogId = combatLog ? combatLog.reduce((m, e) => (e.id > m ? e.id : m), 0) : 0
  const nextLogId = isFiniteNum(raw.nextLogId) && raw.nextLogId >= 1
    ? Math.max(Math.floor(raw.nextLogId), maxLogId + 1)
    : (combatLog !== undefined ? Math.max(1, maxLogId + 1) : undefined)

  return {
    version: 1,
    stageId,
    chapterIndex,
    endlessWave,
    ...(endlessBlessings !== undefined ? { endlessBlessings } : {}),
    ...(phoenixGraceUsed ? { phoenixGraceUsed: true } : {}),
    ...(activeWorldEventId !== undefined ? { activeWorldEventId } : {}),
    ...(activeWorldEventKind !== undefined ? { activeWorldEventKind } : {}),
    ...(activeWorldEventTitle !== undefined ? { activeWorldEventTitle } : {}),
    ...(gauntletRound !== undefined ? { gauntletRound } : {}),
    ...(gauntletMaxRounds !== undefined ? { gauntletMaxRounds } : {}),
    ...(abyssFloor !== undefined ? { abyssFloor } : {}),
    difficulty,
    difficultyTier,
    mutators,
    cols,
    rows,
    biome,
    ...(weather !== undefined ? { weather } : {}),
    ...(timeOfDay !== undefined ? { timeOfDay } : {}),
    cells,
    units,
    turn,
    phase,
    activeUnitUid,
    selectedUnitUid,
    ap,
    maxAp,
    drawPile,
    hand,
    discardPile,
    tacticsPlayed,
    enemyDelay,
    enemyActedThisTurn,
    ...(battleSpeed !== undefined ? { battleSpeed } : {}),
    ...(rngSeed !== undefined ? { rngSeed } : {}),
    ...(objective !== undefined ? { objective } : {}),
    ...(stageMechanic !== undefined ? { stageMechanic } : {}),
    ...(xpEarnedByHero !== undefined ? { xpEarnedByHero } : {}),
    ...(heroStartLevelByUid !== undefined ? { heroStartLevelByUid } : {}),
    ...(heroKoCount !== undefined ? { heroKoCount } : {}),
    ...(anyHeroFallen !== undefined ? { anyHeroFallen } : {}),
    ...(combatLog !== undefined ? { combatLog } : {}),
    ...(nextLogId !== undefined ? { nextLogId } : {})
  }
}

export function restoreBattleState(state: GameState, snapshot: unknown): boolean {
  const valid = validateBattleSnapshot(snapshot)
  if (!valid) return false

  if (valid.rngSeed !== undefined) {
    state.campaign.seed = (valid.rngSeed >>> 0) || 1337
  }
  state.campaign.selectedStageId = valid.stageId

  const cells: GridCell[][] = valid.cells.map((rowCells, row) =>
    rowCells.map((c, col) => ({
      col,
      row,
      terrain: c.terrain,
      elevation: terrainElevation(c.terrain, c.heightLevel),
      walkable: terrainWalkable(c.terrain),
      heightLevel: c.heightLevel,
      ...(c.shrineUsed ? { shrineUsed: true } : {}),
      ...(c.barricadeHp !== undefined ? { barricadeHp: c.barricadeHp } : c.terrain === 'barricade' ? { barricadeHp: BARRICADE_DEFAULT_HP } : {}),
      ...(c.barricadeMaxHp !== undefined ? { barricadeMaxHp: c.barricadeMaxHp } : c.terrain === 'barricade' ? { barricadeMaxHp: BARRICADE_DEFAULT_HP } : {}),
      ...(c.geyserActive !== undefined ? { geyserActive: c.geyserActive } : c.terrain === 'lava_geyser' ? { geyserActive: isGeyserEruptingOnTurn(valid.turn) } : {}),
      ...(c.altarUsed !== undefined ? { altarUsed: c.altarUsed } : c.terrain === 'cursed_altar' ? { altarUsed: false } : {})
    }))
  )

  const units: BattleUnit[] = valid.units.map(u => {
    const fpSize: 1 | 2 = u.footprintSize === 2 || (u.enemyId && ENEMY_SPECS[u.enemyId]?.footprintSize === 2) ? 2 : 1
    const [wx, wy, wz] = computeFootprintWorldCenter(
      { cells, cols: valid.cols, rows: valid.rows },
      u.col,
      u.row,
      fpSize
    )
    return {
      uid: u.uid,
      team: u.team,
      name: u.name,
      ...(u.heroId !== undefined ? { heroId: u.heroId } : {}),
      ...(u.enemyId !== undefined ? { enemyId: u.enemyId } : {}),
      stars: u.stars,
      level: normalizeHeroLevel(u.level),
      isBoss: u.isBoss,
      ...(u.bossPhase !== undefined ? { bossPhase: u.bossPhase } : {}),
      ...(fpSize > 1 ? { footprintSize: fpSize } : {}),
      ...(u.summonerUid !== undefined ? { summonerUid: u.summonerUid } : {}),
      ...(u.weaponId !== undefined ? { weaponId: u.weaponId } : {}),
      ...(u.armorId !== undefined ? { armorId: u.armorId } : {}),
      ...(u.relicId !== undefined ? { relicId: u.relicId } : {}),
      col: u.col,
      row: u.row,
      x: wx,
      y: wy,
      z: wz,
      yaw: facingToYaw(u.facing),
      facing: u.facing,
      path: [],
      moveProgress: 0,
      hp: u.hp,
      maxHp: u.maxHp,
      shield: u.shield,
      atk: u.atk,
      def: u.def,
      speed: u.speed,
      ct: u.ct,
      move: u.move,
      jump: u.jump,
      range: u.range,
      crit: u.crit,
      lifesteal: u.lifesteal,
      moved: u.moved,
      acted: u.acted,
      alive: u.alive,
      downed: Boolean(!u.alive && u.downed && (u.koCountdown ?? 0) > 0),
      koCountdown: !u.alive && u.downed ? Math.max(0, u.koCountdown ?? 0) : 0,
      burnTurns: u.burnTurns,
      slowTurns: u.slowTurns,
      stunTurns: u.stunTurns,
      empowerTurns: u.empowerTurns,
      tauntTurns: u.tauntTurns ?? 0,
      hasteTurns: u.hasteTurns ?? 0,
      poisonStacks: u.poisonStacks ?? 0,
      cooldowns: [u.cooldowns[0], u.cooldowns[1], u.cooldowns[2]],
      animState: 'idle',
      animTimer: 0,
      hitFlash: 0,
      lungeX: 0,
      lungeZ: 0,
      ...(u.crownbladeKoUsed ? { crownbladeKoUsed: true } : {})
    }
  })

  // Keep only tactic card UIDs that exist in campaign.tactics, deduplicated across piles
  const ownedTactics = new Set(state.campaign.tactics.map(t => t.uid))
  const usedTactics = new Set<string>()
  const filterPile = (pile: readonly string[]): string[] => {
    const out: string[] = []
    for (const uid of pile) {
      if (!ownedTactics.has(uid) || usedTactics.has(uid)) continue
      usedTactics.add(uid)
      out.push(uid)
    }
    return out
  }
  const hand = filterPile(valid.hand)
  const drawPile = filterPile(valid.drawPile)
  const discardPile = filterPile(valid.discardPile)

  const chapter = CHAPTER_BY_ID[valid.stageId] ?? CHAPTERS[valid.chapterIndex] ?? CHAPTERS[0]
  const restoredObjective: BattleObjectiveState = valid.objective
    ? {
        kind: valid.objective.kind,
        label: valid.objective.label,
        description: valid.objective.description,
        ...(valid.objective.targetEnemyUid !== undefined ? { targetEnemyUid: valid.objective.targetEnemyUid } : {}),
        ...(valid.objective.targetName !== undefined ? { targetName: valid.objective.targetName } : {}),
        ...(valid.objective.targetTurns !== undefined ? { targetTurns: valid.objective.targetTurns } : {}),
        ...(valid.objective.protectTile !== undefined ? { protectTile: { ...valid.objective.protectTile } } : {}),
        ...(valid.objective.protectLabel !== undefined ? { protectLabel: valid.objective.protectLabel } : {}),
        protectBreached: Boolean(valid.objective.protectBreached),
        ...(valid.objective.goalTile !== undefined ? { goalTile: { ...valid.objective.goalTile } } : {}),
        ...(valid.objective.goalLabel !== undefined ? { goalLabel: valid.objective.goalLabel } : {}),
        seized: Boolean(valid.objective.seized),
        chestTiles: (valid.objective.chestTiles ?? []).map(c => ({ col: c.col, row: c.row })),
        claimedChests: (valid.objective.claimedChests ?? []).map(c => ({ col: c.col, row: c.row })),
        requiredChests: valid.objective.requiredChests ?? 0,
        ...(valid.objective.turnLimit !== undefined ? { turnLimit: valid.objective.turnLimit } : {}),
        roundsElapsed: valid.objective.roundsElapsed
      }
    : buildBattleObjective(chapter, units, valid.endlessWave)
  const deployTiles = computeDeployTiles(chapter, cells, restoredObjective)
  const fallbackAtmosphere: BattleAtmosphere = resolveBattleAtmosphere({
    stageId: valid.stageId,
    biome: valid.biome,
    endlessWave: valid.endlessWave,
    seed: state.campaign.seed,
    chapterWeather: chapter.weather,
    chapterTimeOfDay: chapter.timeOfDay
  })
  const restoredWeather: BattleWeatherId = valid.weather ?? fallbackAtmosphere.weather
  const restoredTimeOfDay: TimeOfDayId = valid.timeOfDay ?? fallbackAtmosphere.timeOfDay

  const battle: BattleState = {
    stageId: valid.stageId,
    chapterIndex: valid.chapterIndex,
    endlessWave: valid.endlessWave,
    ...(valid.endlessBlessings && valid.endlessBlessings.length > 0
      ? { endlessBlessings: valid.endlessBlessings.slice() }
      : {}),
    ...(valid.phoenixGraceUsed ? { phoenixGraceUsed: true } : {}),
    ...(valid.activeWorldEventId !== undefined ? { activeWorldEventId: valid.activeWorldEventId } : {}),
    ...(valid.activeWorldEventKind !== undefined ? { activeWorldEventKind: valid.activeWorldEventKind } : {}),
    ...(valid.activeWorldEventTitle !== undefined ? { activeWorldEventTitle: valid.activeWorldEventTitle } : {}),
    ...(valid.gauntletRound !== undefined ? { gauntletRound: valid.gauntletRound } : {}),
    ...(valid.gauntletMaxRounds !== undefined ? { gauntletMaxRounds: valid.gauntletMaxRounds } : {}),
    ...(valid.abyssFloor !== undefined ? { abyssFloor: valid.abyssFloor } : {}),
    difficulty: valid.difficulty,
    difficultyTier: valid.difficultyTier ?? 'normal',
    mutators: valid.mutators ? valid.mutators.slice() : [],
    cols: valid.cols,
    rows: valid.rows,
    biome: valid.biome,
    weather: restoredWeather,
    timeOfDay: restoredTimeOfDay,
    cells,
    units,
    deployTiles,
    objective: restoredObjective,
    ...(valid.stageMechanic !== undefined
      ? { stageMechanic: cloneStageMechanicState(valid.stageMechanic) }
      : valid.activeWorldEventId === undefined && createInitialStageMechanicState(valid.stageId) !== undefined
        ? { stageMechanic: createInitialStageMechanicState(valid.stageId) }
        : {}),
    turn: valid.turn,
    phase: valid.phase,
    activeUnitUid: valid.activeUnitUid,
    selectedUnitUid: valid.selectedUnitUid,
    turnOrder: [],
    armedSkillIndex: null,
    armedTacticUid: null,
    ap: valid.ap,
    maxAp: valid.maxAp,
    drawPile,
    hand,
    discardPile,
    tacticsPlayed: valid.tacticsPlayed,
    moveTiles: [],
    targetTiles: [],
    moveAttackTiles: [],
    moveUndo: null,
    oaTriggeredUids: [],
    facingPicker: null,
    pendingAction: null,
    enemyDelay: valid.phase === 'enemy' ? Math.max(0.25, valid.enemyDelay) : 0,
    enemyActedThisTurn: valid.enemyActedThisTurn,
    battleSpeed: valid.battleSpeed !== undefined
      ? normalizeBattleSpeed(valid.battleSpeed)
      : normalizeBattleSpeed(state.campaign.battleSpeed),
    autoBattle: false,
    autoBattleDelay: 0,
    floatingNumbers: [],
    nextFloatId: 1,
    combatLog: valid.combatLog ? valid.combatLog.slice(-MAX_COMBAT_LOG_ENTRIES).map(e => ({ ...e })) : [],
    nextLogId: Math.max(
      valid.nextLogId ?? 1,
      (valid.combatLog ? valid.combatLog.reduce((m, e) => (e.id > m ? e.id : m), 0) : 0) + 1,
      1
    ),
    bannerText: '',
    bannerTimer: 0,
    shake: 0,
    xpEarnedByHero: valid.xpEarnedByHero ? { ...valid.xpEarnedByHero } : {},
    heroStartLevelByUid: valid.heroStartLevelByUid
      ? { ...valid.heroStartLevelByUid }
      : Object.fromEntries(units.filter(u => u.team === 'ally').map(u => [u.uid, normalizeHeroLevel(u.level)])),
    heroKoCount: Math.max(
      valid.heroKoCount ?? 0,
      units.filter(u => u.team === 'ally' && !u.alive && !isUnitDowned(u)).length
    ),
    anyHeroFallen: Boolean(
      valid.anyHeroFallen ||
      (valid.heroKoCount ?? 0) > 0 ||
      units.some(u => u.team === 'ally' && !u.alive && !isUnitDowned(u))
    ),
    reward: null,
    activeTipId: null,
    tipQueue: []
  }

  state.battle = battle
  state.sounds = []
  state.vfx = []
  discoverBattleEnemiesInCodex(state.campaign, units)
  refreshHighlights(battle, state.campaign)
  checkDiscoveryTipForBattle(state)
  return true
}

export function abandonBattle(state: GameState): boolean {
  if (!state.battle) return false
  if (state.battle.endlessWave > 0) {
    abandonEndlessRun(state)
  }
  state.battle = null
  return true
}

export interface BattleTurnBoundaryTracker {
  lastKey: string | null
}

export function createTurnBoundaryTracker(): BattleTurnBoundaryTracker {
  return { lastKey: null }
}

export function battleTurnBoundaryKey(battle: BattleState | null): string | null {
  if (!battle) return null
  if (battle.phase !== 'player' && battle.phase !== 'enemy') return null
  return `${battle.stageId}:${battle.activeWorldEventId ?? ''}:${battle.endlessWave}:${battle.gauntletRound ?? 0}:${battle.abyssFloor ?? 0}:${battle.turn}:${battle.phase}:${battle.activeUnitUid ?? ''}`
}

export function syncTurnBoundaryTracker(
  tracker: BattleTurnBoundaryTracker,
  battle: BattleState | null
): void {
  tracker.lastKey = battleTurnBoundaryKey(battle)
}

/**
 * Pure turn-boundary detector for mid-battle auto-save.
 * Fires once per turn boundary (battle start, player turn start, enemy turn start)
 * and never fires on idle frames within the same turn.
 */
export function shouldAutoSaveOnTurnBoundary(
  tracker: BattleTurnBoundaryTracker,
  battle: BattleState | null
): boolean {
  const key = battleTurnBoundaryKey(battle)
  if (key === null) {
    tracker.lastKey = null
    return false
  }
  if (key === tracker.lastKey) return false
  tracker.lastKey = key
  return true
}

export function hydrateSave(state: GameState, save: SaveData | null | undefined, fallbackSeed = 1337): boolean {
  if (!save || save.version !== 1 || !save.campaign || !Array.isArray(save.campaign.heroes) || save.campaign.heroes.length === 0) {
    return false
  }
  state.campaign = cloneCampaignFromSave(save.campaign, fallbackSeed)
  state.battle = null
  state.sounds = []
  state.vfx = []
  if (save.activeBattle) {
    restoreBattleState(state, save.activeBattle)
  }
  return true
}

export function createInitialState(seed = 1337, save?: SaveData | null): GameState {
  const state: GameState = {
    time: 0,
    campaign: createInitialCampaign(seed),
    battle: null,
    sounds: [],
    vfx: []
  }
  if (save) {
    hydrateSave(state, save, seed)
  }
  return state
}

export function serializeSave(state: GameState): SaveData {
  const activeBattle = serializeBattleState(state.battle, state.campaign.seed)
  return {
    version: 1,
    campaign: {
      ...state.campaign,
      endlessRun: cloneEndlessRunState(state.campaign.endlessRun),
      clearedStageIds: state.campaign.clearedStageIds.slice(),
      clearedStageTiers: sanitizeClearedStageTiers(state.campaign.clearedStageTiers, state.campaign.clearedStageIds),
      stageMastery: sanitizeStageMastery(state.campaign.stageMastery, state.campaign.clearedStageIds),
      claimedStageMasteryChests: sanitizeClaimedStageMasteryChests(state.campaign.claimedStageMasteryChests),
      claimedMasteryMilestones: sanitizeClaimedMasteryMilestones(state.campaign.claimedMasteryMilestones),
      heroes: state.campaign.heroes.map(h => {
        const level = normalizeHeroLevel(h.level)
        const xp = normalizeHeroXp(level, h.xp)
        return h.locked
          ? {
              uid: h.uid,
              heroId: h.heroId,
              stars: h.stars,
              level,
              xp,
              weaponUid: h.weaponUid,
              armorUid: h.armorUid,
              relicUid: h.relicUid,
              locked: true
            }
          : {
              uid: h.uid,
              heroId: h.heroId,
              stars: h.stars,
              level,
              xp,
              weaponUid: h.weaponUid,
              armorUid: h.armorUid,
              relicUid: h.relicUid
            }
      }),
      equipment: state.campaign.equipment.map(e => (e.locked ? { ...e, locked: true } : {
        uid: e.uid,
        equipId: e.equipId,
        slot: e.slot
      })),
      tactics: state.campaign.tactics.map(t => ({ ...t })),
      ...(Array.isArray(state.campaign.activeTacticDeckUids)
        ? { activeTacticDeckUids: state.campaign.activeTacticDeckUids.slice() }
        : {}),
      squadUids: state.campaign.squadUids.slice(),
      lastPackReveal: [],
      seenTips: normalizeSeenTips(state.campaign.seenTips),
      tipsDisabled: state.campaign.tipsDisabled === true,
      actionCameraEnabled: state.campaign.actionCameraEnabled !== false,
      discoveredEnemies: normalizeDiscoveredEnemies(state.campaign.discoveredEnemies),
      battleSpeed: normalizeBattleSpeed(state.campaign.battleSpeed),
      oakhavenExchange: normalizeOakhavenExchange(state.campaign.oakhavenExchange, state.campaign.battlesWon),
      worldEvents: (state.campaign.worldEvents ?? []).map(cloneWorldMapEvent)
    },
    activeBattle
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
    const activeBattle = 'activeBattle' in parsed ? validateBattleSnapshot(parsed.activeBattle) : null
    return {
      version: 1,
      campaign: {
        seed: 'seed' in camp && typeof camp.seed === 'number' ? camp.seed : 1337,
        nextUid: 'nextUid' in camp && typeof camp.nextUid === 'number' ? camp.nextUid : 100,
        gold: 'gold' in camp && typeof camp.gold === 'number' ? camp.gold : 100,
        dust: 'dust' in camp && isFiniteNum(camp.dust) && camp.dust >= 0 ? Math.floor(camp.dust) : 0,
        shards: 'shards' in camp && isFiniteNum(camp.shards) && camp.shards >= 0 ? Math.floor(camp.shards) : 0,
        chaptersCleared: clearedStageIds.length,
        clearedStageIds,
        clearedStageTiers: sanitizeClearedStageTiers(
          'clearedStageTiers' in camp ? camp.clearedStageTiers : undefined,
          clearedStageIds
        ),
        stageMastery: sanitizeStageMastery(
          'stageMastery' in camp ? camp.stageMastery : undefined,
          clearedStageIds
        ),
        claimedStageMasteryChests: sanitizeClaimedStageMasteryChests(
          'claimedStageMasteryChests' in camp ? camp.claimedStageMasteryChests : undefined
        ),
        claimedMasteryMilestones: sanitizeClaimedMasteryMilestones(
          'claimedMasteryMilestones' in camp ? camp.claimedMasteryMilestones : undefined
        ),
        selectedStageId,
        endlessBest: 'endlessBest' in camp && typeof camp.endlessBest === 'number' ? camp.endlessBest : 0,
        endlessRun: 'endlessRun' in camp ? sanitizeEndlessRunState(camp.endlessRun) : null,
        crownlessDeepFloor: 'crownlessDeepFloor' in camp ? normalizeCrownlessDeepFloorCleared(camp.crownlessDeepFloor) : 0,
        ...('crownlessDeepSelectedFloor' in camp && isFiniteNum(camp.crownlessDeepSelectedFloor)
          ? {
              crownlessDeepSelectedFloor: clamp(
                Math.floor(camp.crownlessDeepSelectedFloor),
                1,
                Math.min(
                  CROWNLESS_DEEP_MAX_FLOOR,
                  ('crownlessDeepFloor' in camp ? normalizeCrownlessDeepFloorCleared(camp.crownlessDeepFloor) : 0) + 1
                )
              )
            }
          : {}),
        ...('crownlessDeepRewardClaimed' in camp && camp.crownlessDeepRewardClaimed === true
          ? { crownlessDeepRewardClaimed: true }
          : {}),
        battlesWon: 'battlesWon' in camp && typeof camp.battlesWon === 'number' ? camp.battlesWon : 0,
        packsOpened: 'packsOpened' in camp && typeof camp.packsOpened === 'number' ? camp.packsOpened : 0,
        packsSinceEpic: 'packsSinceEpic' in camp && isFiniteNum(camp.packsSinceEpic) && camp.packsSinceEpic >= 0 ? Math.floor(camp.packsSinceEpic) : 0,
        packsSinceLegendary: 'packsSinceLegendary' in camp && isFiniteNum(camp.packsSinceLegendary) && camp.packsSinceLegendary >= 0 ? Math.floor(camp.packsSinceLegendary) : 0,
        heroes: camp.heroes
          .filter((h): h is OwnedHeroCard => typeof h === 'object' && h !== null && 'uid' in h && 'heroId' in h)
          .map(h => {
            const level = normalizeHeroLevel(h.level)
            const xp = normalizeHeroXp(level, h.xp)
            return { ...h, level, xp, locked: h.locked === true }
          }),
        equipment: 'equipment' in camp && Array.isArray(camp.equipment)
          ? camp.equipment
            .filter((e): e is OwnedEquipCard => typeof e === 'object' && e !== null && 'uid' in e && 'equipId' in e)
            .map(e => ({ ...e, locked: e.locked === true }))
          : [],
        tactics: 'tactics' in camp && Array.isArray(camp.tactics)
          ? camp.tactics.filter((t): t is OwnedTacticCard => typeof t === 'object' && t !== null && 'uid' in t && 'tacticId' in t)
          : [],
        ...('activeTacticDeckUids' in camp && Array.isArray(camp.activeTacticDeckUids)
          ? { activeTacticDeckUids: camp.activeTacticDeckUids.filter((u): u is string => typeof u === 'string') }
          : {}),
        squadUids: 'squadUids' in camp && Array.isArray(camp.squadUids)
          ? camp.squadUids.filter((u): u is string => typeof u === 'string')
          : [],
        selectedCampHeroUid: 'selectedCampHeroUid' in camp && typeof camp.selectedCampHeroUid === 'string'
          ? camp.selectedCampHeroUid
          : null,
        lastPackReveal: [],
        seenTips: 'seenTips' in camp ? normalizeSeenTips(camp.seenTips) : [],
        tipsDisabled: 'tipsDisabled' in camp ? camp.tipsDisabled === true : false,
        actionCameraEnabled: 'actionCameraEnabled' in camp ? camp.actionCameraEnabled !== false : true,
        discoveredEnemies: 'discoveredEnemies' in camp
          ? normalizeDiscoveredEnemies(camp.discoveredEnemies, clearedStageIds)
          : backfillDiscoveredEnemiesFromStages(clearedStageIds),
        battleSpeed: 'battleSpeed' in camp ? normalizeBattleSpeed(camp.battleSpeed) : DEFAULT_BATTLE_SPEED,
        oakhavenExchange: normalizeOakhavenExchange(
          'oakhavenExchange' in camp ? camp.oakhavenExchange : undefined,
          'battlesWon' in camp && typeof camp.battlesWon === 'number' ? camp.battlesWon : 0
        ),
        worldEvents: 'worldEvents' in camp ? sanitizeWorldMapEvents(camp.worldEvents) : []
      },
      activeBattle
    }
  } catch {
    return null
  }
}

export function persistSave(
  storage: StorageLike | null | undefined,
  state: GameState,
  fallbackActiveBattle?: BattleSaveSnapshot | null
): void {
  if (!storage) return
  try {
    const data = serializeSave(state)
    if (!state.battle && !data.activeBattle && fallbackActiveBattle) {
      data.activeBattle = fallbackActiveBattle
    }
    storage.setItem(SAVE_KEY, JSON.stringify(data))
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

export function isIntactBarricade(cell: GridCell | undefined): boolean {
  return Boolean(cell && cell.terrain === 'barricade' && (cell.barricadeHp ?? BARRICADE_DEFAULT_HP) > 0)
}

export function isGeyserEruptingOnTurn(turn: number): boolean {
  return turn > 0 && turn % LAVA_GEYSER_PERIOD === 0
}

export function syncLavaGeysers(battle: BattleState): void {
  const active = isGeyserEruptingOnTurn(battle.turn)
  for (let row = 0; row < battle.rows; row++) {
    for (let col = 0; col < battle.cols; col++) {
      const cell = battle.cells[row][col]
      if (cell.terrain === 'lava_geyser') {
        cell.geyserActive = active
      }
    }
  }
}

function buildCells(
  grid: readonly (readonly TileTerrain[])[],
  heights?: readonly (readonly number[])[]
): GridCell[][] {
  const rows = grid.length
  const cols = grid[0]?.length ?? GRID_COLS
  const cells: GridCell[][] = []
  for (let row = 0; row < rows; row++) {
    const line: GridCell[] = []
    for (let col = 0; col < cols; col++) {
      const terrain = grid[row]?.[col] ?? 'grass'
      const rawHeight = heights?.[row]?.[col]
      const heightLevel = terrain === 'void'
        ? -1
        : rawHeight !== undefined
          ? clamp(Math.round(rawHeight), 0, 4)
          : defaultTerrainHeightLevel(terrain)
      line.push({
        col,
        row,
        terrain,
        elevation: terrainElevation(terrain, heightLevel),
        walkable: terrainWalkable(terrain),
        heightLevel,
        ...(terrain === 'barricade' ? { barricadeHp: BARRICADE_DEFAULT_HP, barricadeMaxHp: BARRICADE_DEFAULT_HP } : {}),
        ...(terrain === 'lava_geyser' ? { geyserActive: false } : {}),
        ...(terrain === 'cursed_altar' ? { altarUsed: false } : {})
      })
    }
    cells.push(line)
  }
  return cells
}

export { KO_COUNTDOWN_TURNS, isUnitActive, isUnitDowned }

export function unitAt(battle: BattleState, col: number, row: number): BattleUnit | undefined {
  return battle.units.find(u => u.alive && unitOccupiesCell(u, col, row))
}

export function downedHeroAt(battle: BattleState, col: number, row: number): BattleUnit | undefined {
  return battle.units.find(u => isUnitDowned(u) && u.col === col && u.row === row)
}

export function unitOrDownedAt(battle: BattleState, col: number, row: number): BattleUnit | undefined {
  return battle.units.find(u => (u.alive || isUnitDowned(u)) && unitOccupiesCell(u, col, row))
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

export interface StartBattleOptions {
  readonly deployPhase?: boolean
  readonly tier?: StageDifficultyTier
  readonly mutators?: readonly StageMutatorId[]
  readonly abyssFloor?: number
  readonly weather?: BattleWeatherId
  readonly timeOfDay?: TimeOfDayId
}

export function isChestClaimed(
  objective: Pick<BattleObjectiveState, 'claimedChests'>,
  col: number,
  row: number
): boolean {
  return objective.claimedChests.some(c => c.col === col && c.row === row)
}

export function computeDeployTiles(
  chapter: ChapterSpec,
  cells: readonly (readonly GridCell[])[],
  objective?: Pick<BattleObjectiveState, 'goalTile' | 'chestTiles'> | null
): GridCoord[] {
  const rows = cells.length
  const cols = cells[0]?.length ?? GRID_COLS
  const blocked = new Set<string>()
  for (const e of chapter.enemies) blocked.add(`${e.col},${e.row}`)
  if (objective?.goalTile) blocked.add(`${objective.goalTile.col},${objective.goalTile.row}`)
  if (objective?.chestTiles) {
    for (const c of objective.chestTiles) blocked.add(`${c.col},${c.row}`)
  }

  const seen = new Set<string>()
  const out: GridCoord[] = []
  const addTile = (col: number, row: number): boolean => {
    if (!isCellInBounds(col, row, cols, rows)) return false
    const cell = cells[row]?.[col]
    if (!cell || !cell.walkable) return false
    const key = `${col},${row}`
    if (seen.has(key) || blocked.has(key)) return false
    seen.add(key)
    out.push({ col, row })
    return true
  }

  // Always include all hero spawn coordinates first
  for (const [col, row] of chapter.heroSpawns) {
    addTile(col, row)
  }

  // Include explicit chapter deployTiles if authored
  if (chapter.deployTiles && chapter.deployTiles.length > 0) {
    for (const [col, row] of chapter.deployTiles) {
      addTile(col, row)
    }
    return out
  }

  // Expand blue spawn zone with 2-4 adjacent valid walkable tiles near the spawn flank
  const extraTarget = Math.min(4, Math.max(2, Math.floor(cols * 0.45)))
  let centroidCol = 0
  let centroidRow = 0
  for (const t of out) {
    centroidCol += t.col
    centroidRow += t.row
  }
  if (out.length > 0) {
    centroidCol /= out.length
    centroidRow /= out.length
  }

  const candidates: GridCoord[] = []
  const candSeen = new Set<string>(seen)
  const dirs = [[0, -1], [0, 1], [1, 0], [-1, 0]] as const
  for (const base of out) {
    for (const [dc, dr] of dirs) {
      const nc = base.col + dc
      const nr = base.row + dr
      if (!isCellInBounds(nc, nr, cols, rows)) continue
      const key = `${nc},${nr}`
      if (candSeen.has(key) || blocked.has(key)) continue
      const cell = cells[nr]?.[nc]
      if (!cell || !cell.walkable) continue
      candSeen.add(key)
      candidates.push({ col: nc, row: nr })
    }
  }

  candidates.sort((a, b) => {
    if (a.col !== b.col) return a.col - b.col
    const da = Math.abs(a.col - centroidCol) + Math.abs(a.row - centroidRow)
    const db = Math.abs(b.col - centroidCol) + Math.abs(b.row - centroidRow)
    if (da !== db) return da - db
    return a.row - b.row
  })

  for (let i = 0; i < candidates.length && i < extraTarget; i++) {
    addTile(candidates[i].col, candidates[i].row)
  }

  return out
}

export function buildBattleObjective(
  chapter: ChapterSpec,
  units: readonly BattleUnit[],
  endlessWave = 0
): BattleObjectiveState {
  if (endlessWave > 0) {
    const biomeLabel = formatEndlessBiomeLabel(chapter.biome)
    const bossTag = isEndlessBossWave(endlessWave) ? ' · Boss' : ''
    return {
      kind: 'rout',
      label: `Endless W${endlessWave} · ${biomeLabel}${bossTag}`,
      description: isEndlessBossWave(endlessWave)
        ? `Defeat the ${biomeLabel} Boss and all foes to draft a Run Blessing.`
        : `Defeat all enemies across the ${biomeLabel} to draft a Run Blessing.`,
      protectBreached: false,
      seized: false,
      chestTiles: [],
      claimedChests: [],
      requiredChests: 0,
      roundsElapsed: 0
    }
  }

  const spec = chapter.objective
  const kind: BattleObjectiveKind = spec?.kind ?? 'rout'

  if (kind === 'assassinate') {
    const enemies = units.filter(u => u.team === 'enemy')
    let target: BattleUnit | undefined
    if (spec?.targetEnemyIndex !== undefined && spec.targetEnemyIndex >= 0 && spec.targetEnemyIndex < enemies.length) {
      target = enemies[spec.targetEnemyIndex]
    }
    if (!target && spec?.targetEnemyId) {
      target = enemies.find(u => u.enemyId === spec.targetEnemyId)
    }
    if (!target) {
      target = enemies.find(u => u.isBoss) ?? enemies[0]
    }
    const targetName = spec?.targetName ?? target?.name ?? 'Commander'
    return {
      kind: 'assassinate',
      label: spec?.label ?? `Slay ${targetName}`,
      description: spec?.description ?? `Defeat ${targetName} to win immediately.`,
      targetEnemyUid: target?.uid,
      targetName,
      protectBreached: false,
      seized: false,
      chestTiles: [],
      claimedChests: [],
      requiredChests: 0,
      ...(spec?.turnLimit !== undefined ? { turnLimit: spec.turnLimit } : {}),
      roundsElapsed: 0
    }
  }

  if (kind === 'defend') {
    const targetTurns = spec?.targetTurns ?? 6
    const protectTile = spec?.protectTile ? { col: spec.protectTile.col, row: spec.protectTile.row } : undefined
    const protectLabel = spec?.protectLabel ?? 'Relic Altar'
    return {
      kind: 'defend',
      label: spec?.label ?? `Defend ${protectLabel}`,
      description: spec?.description ?? `Survive ${targetTurns} turns and keep enemies off ${protectLabel}.`,
      targetTurns,
      ...(protectTile ? { protectTile, protectLabel } : {}),
      protectBreached: false,
      seized: false,
      chestTiles: [],
      claimedChests: [],
      requiredChests: 0,
      roundsElapsed: 0
    }
  }

  if (kind === 'seize') {
    const goalTile = spec?.goalTile ? { col: spec.goalTile.col, row: spec.goalTile.row } : undefined
    const goalLabel = spec?.goalLabel ?? 'Objective'
    const chestTiles = (spec?.chestTiles ?? []).map(c => ({ col: c.col, row: c.row }))
    const requiredChests = spec?.requiredChests !== undefined
      ? clamp(Math.floor(spec.requiredChests), 0, chestTiles.length)
      : goalTile ? 0 : chestTiles.length
    const defaultLabel = goalTile ? `Seize ${goalLabel}` : `Claim ${requiredChests} Chests`
    return {
      kind: 'seize',
      label: spec?.label ?? defaultLabel,
      description: spec?.description ?? (goalTile ? `Move a hero onto ${goalLabel} to win.` : `Claim ${requiredChests} battlefield chests to win.`),
      protectBreached: false,
      ...(goalTile ? { goalTile, goalLabel } : {}),
      seized: false,
      chestTiles,
      claimedChests: [],
      requiredChests,
      ...(spec?.turnLimit !== undefined ? { turnLimit: spec.turnLimit } : {}),
      roundsElapsed: 0
    }
  }

  return {
    kind: 'rout',
    label: spec?.label ?? 'Rout All Enemies',
    description: spec?.description ?? 'Defeat all enemies on the battlefield.',
    protectBreached: false,
    seized: false,
    chestTiles: [],
    claimedChests: [],
    requiredChests: 0,
    ...(spec?.turnLimit !== undefined ? { turnLimit: spec.turnLimit } : {}),
    roundsElapsed: 0
  }
}

/** Pure evaluation of the battle's mission objective (used by victory/defeat checks and tests). */
export function evaluateBattleObjective(battle: BattleState): BattleObjectiveEvaluation {
  const alliesAlive = battle.units.some(u => u.alive && u.team === 'ally')
  if (!alliesAlive) {
    return { status: 'defeat', reason: 'Vanguard Defeated' }
  }

  const obj = battle.objective

  // 1. Defend breach check -> immediate Defeat
  if (obj.kind === 'defend') {
    if (obj.protectBreached) {
      return { status: 'defeat', reason: `${obj.protectLabel ?? 'Relic Altar'} Breached!` }
    }
    if (obj.protectTile) {
      const occ = unitAt(battle, obj.protectTile.col, obj.protectTile.row)
      if (occ && occ.team === 'enemy') {
        return { status: 'defeat', reason: `${obj.protectLabel ?? 'Relic Altar'} Breached!` }
      }
    }
  }

  // 2. Objective-specific Victory checks (can trigger even while enemies remain alive!)
  if (obj.kind === 'assassinate') {
    const target = obj.targetEnemyUid
      ? battle.units.find(u => u.uid === obj.targetEnemyUid)
      : battle.units.find(u => u.team === 'enemy' && u.isBoss)
    if (target && !target.alive) {
      return { status: 'victory', reason: `${obj.targetName ?? target.name} Defeated!` }
    }
  } else if (obj.kind === 'defend') {
    if (obj.targetTurns !== undefined && obj.roundsElapsed >= obj.targetTurns) {
      return { status: 'victory', reason: `Held for ${obj.targetTurns} Turns!` }
    }
  } else if (obj.kind === 'seize') {
    const chestsMet = obj.claimedChests.length >= obj.requiredChests
    if (obj.seized && chestsMet) {
      return { status: 'victory', reason: `${obj.goalLabel ?? 'Objective'} Seized!` }
    }
    if (obj.goalTile && chestsMet) {
      const occ = unitAt(battle, obj.goalTile.col, obj.goalTile.row)
      if (occ && occ.team === 'ally') {
        return { status: 'victory', reason: `${obj.goalLabel ?? 'Objective'} Seized!` }
      }
    }
    if (!obj.goalTile && obj.requiredChests > 0 && chestsMet) {
      return { status: 'victory', reason: 'All Supply Chests Claimed!' }
    }
  }

  // 3. Clearing every enemy on the board secures Victory (unless another Gladiator Gauntlet wave remains)
  const enemiesAlive = battle.units.some(u => u.alive && u.team === 'enemy')
  if (!enemiesAlive) {
    if (canAdvanceGauntletRound(battle)) {
      return { status: 'ongoing', reason: null }
    }
    return { status: 'victory', reason: battle.gauntletMaxRounds ? `All ${battle.gauntletMaxRounds} Rounds Cleared!` : 'All Enemies Routed!' }
  }

  // 4. Turn limit check (for timed Seize or timed missions)
  if (obj.turnLimit !== undefined && obj.roundsElapsed >= obj.turnLimit) {
    return { status: 'defeat', reason: 'Turn Limit Expired!' }
  }

  return { status: 'ongoing', reason: null }
}

/** Concise live HUD progress string for the active battle objective. */
export function getObjectiveProgressText(battle: BattleState): string {
  const obj = battle.objective
  const abyssPrefix = battle.abyssFloor ? `${formatAbyssFloorLabel(battle.abyssFloor)} · ` : ''
  if (battle.gauntletMaxRounds && battle.gauntletMaxRounds > 1) {
    const aliveEnemies = battle.units.filter(u => u.alive && u.team === 'enemy').length
    return `Round ${battle.gauntletRound ?? 1}/${battle.gauntletMaxRounds} · ${aliveEnemies} Foe${aliveEnemies === 1 ? '' : 's'} Left`
  }
  if (obj.kind === 'assassinate') {
    const target = obj.targetEnemyUid
      ? battle.units.find(u => u.uid === obj.targetEnemyUid)
      : battle.units.find(u => u.team === 'enemy' && u.isBoss)
    const name = obj.targetName ?? target?.name ?? 'Boss'
    if (!target || !target.alive) return `${abyssPrefix}${name} Slain!`
    return `${abyssPrefix}Slay ${name} (${target.hp}/${target.maxHp} HP)`
  }
  if (obj.kind === 'defend') {
    const turnsTotal = obj.targetTurns ?? 6
    const turnsDone = Math.min(turnsTotal, obj.roundsElapsed)
    if (obj.protectTile) {
      return `${abyssPrefix}Hold ${obj.protectLabel ?? 'Altar'} · ${turnsDone}/${turnsTotal}T`
    }
    return `${abyssPrefix}Survive · ${turnsDone}/${turnsTotal} Turns`
  }
  if (obj.kind === 'seize') {
    const parts: string[] = []
    if (obj.goalTile) {
      parts.push(`Seize ${obj.goalLabel ?? 'Goal'}`)
    }
    if (obj.chestTiles.length > 0) {
      const targetCount = obj.requiredChests > 0 ? obj.requiredChests : obj.chestTiles.length
      parts.push(`Chests ${obj.claimedChests.length}/${targetCount}`)
    }
    if (obj.turnLimit !== undefined) {
      const left = Math.max(0, obj.turnLimit - obj.roundsElapsed)
      parts.push(`${left}T Left`)
    }
    return `${abyssPrefix}${parts.join(' · ') || obj.label}`
  }
  const totalEnemies = battle.units.filter(u => u.team === 'enemy').length
  const aliveEnemies = battle.units.filter(u => u.alive && u.team === 'enemy').length
  const defeated = totalEnemies - aliveEnemies
  return `${abyssPrefix}Rout Enemies · ${defeated}/${totalEnemies}`
}

/** Short summary of a chapter's mission objective for Story Briefing / World Map. */
export function getChapterObjectiveSummary(chapter: ChapterSpec): {
  readonly kind: BattleObjectiveKind
  readonly label: string
  readonly short: string
} {
  const spec = chapter.objective
  const kind: BattleObjectiveKind = spec?.kind ?? 'rout'
  if (kind === 'assassinate') {
    const name = spec?.targetName ?? 'Commander'
    return { kind, label: spec?.label ?? `Slay ${name}`, short: `Assassinate: ${name}` }
  }
  if (kind === 'defend') {
    const turns = spec?.targetTurns ?? 6
    return { kind, label: spec?.label ?? `Defend (${turns}T)`, short: `Defend ${turns}T` }
  }
  if (kind === 'seize') {
    const limit = spec?.turnLimit ? ` (${spec.turnLimit}T)` : ''
    return { kind, label: spec?.label ?? 'Seize Objective', short: `Seize${limit}` }
  }
  return { kind: 'rout', label: spec?.label ?? 'Rout All Enemies', short: 'Rout All' }
}

export function isDeployTile(battle: BattleState, col: number, row: number): boolean {
  return battle.deployTiles.some(t => t.col === col && t.row === row)
}

/** Move a hero to an open deployment tile, or swap positions if another hero occupies it. */
export function moveDeployUnit(state: GameState, unitUid: string, col: number, row: number): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'deploy') return false
  if (!isCellInBounds(col, row, battle.cols, battle.rows)) return false
  if (!isDeployTile(battle, col, row)) return false

  const unit = getUnitByUid(battle, unitUid)
  if (!unit || unit.team !== 'ally') return false
  if (unit.col === col && unit.row === row) {
    battle.selectedUnitUid = unit.uid
    return true
  }

  const occupant = unitAt(battle, col, row)
  if (occupant) {
    if (occupant.team !== 'ally') return false
    return swapDeployUnit(state, unit.uid, occupant.uid)
  }

  const cell = battle.cells[row][col]
  const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = wx
  unit.y = wy
  unit.z = wz
  battle.selectedUnitUid = unit.uid
  state.sounds.push({ kind: 'step', pitch: 1.05 })
  return true
}

/** Swap the deployment positions of two ally heroes during the pre-battle deploy phase. */
export function swapDeployUnit(state: GameState, uidA: string, uidB: string): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'deploy' || uidA === uidB) return false
  const a = getUnitByUid(battle, uidA)
  const b = getUnitByUid(battle, uidB)
  if (!a || !b || a.team !== 'ally' || b.team !== 'ally') return false
  if (!isDeployTile(battle, a.col, a.row) || !isDeployTile(battle, b.col, b.row)) return false

  const tmpCol = a.col
  const tmpRow = a.row
  const tmpX = a.x
  const tmpY = a.y
  const tmpZ = a.z

  a.col = b.col
  a.row = b.row
  a.x = b.x
  a.y = b.y
  a.z = b.z

  b.col = tmpCol
  b.row = tmpRow
  b.x = tmpX
  b.y = tmpY
  b.z = tmpZ

  battle.selectedUnitUid = null
  state.sounds.push({ kind: 'step', pitch: 1.15 })
  return true
}

/** Rotate a hero's initial facing direction (N/E/S/W) during pre-battle deployment. */
export function rotateDeployUnit(state: GameState, unitUid?: string, dir?: FacingDir): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'deploy') return false
  const targetUid = unitUid ?? battle.selectedUnitUid
  let unit = targetUid ? getUnitByUid(battle, targetUid) : undefined
  if (!unit || unit.team !== 'ally') {
    unit = battle.units.find(u => u.alive && u.team === 'ally')
  }
  if (!unit) return false
  const nextDir = dir ?? FACING_DIRS[(FACING_DIRS.indexOf(unit.facing) + 1) % FACING_DIRS.length]
  setUnitFacing(unit, nextDir)
  battle.selectedUnitUid = unit.uid
  state.sounds.push({ kind: 'card', pitch: 1.12 })
  return true
}

/** Lock in pre-battle hero placements and launch Turn 1 preserving exact positions & facings. */
export function confirmDeployment(state: GameState): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'deploy') return false
  battle.selectedUnitUid = null
  battle.bannerText = 'BATTLE START!'
  battle.bannerTimer = 1.4
  const ch = CHAPTERS[battle.chapterIndex]
  const stageTitle = battle.activeWorldEventTitle
    ? battle.activeWorldEventTitle
    : battle.endlessWave > 0
      ? `Endless Wave ${battle.endlessWave} · ${formatEndlessBiomeLabel(battle.biome)}`
      : (ch?.title ?? battle.stageId)
  appendCombatLog(battle, 'system', `Battle started — ${stageTitle} (${battle.objective.label})`, { turn: 1 })
  advanceToNextUnitTurn(state, true)
  checkDiscoveryTipForBattle(state)
  return true
}

export const beginBattleFromDeploy = confirmDeployment

export function startWorldEventBattle(
  state: GameState,
  eventId: string,
  options?: StartBattleOptions
): BattleState | null {
  const ev = getWorldMapEventById(state.campaign, eventId)
  if (!ev || ev.kind === 'wandering_merchant') return null
  const anchor = CHAPTER_BY_ID[ev.fromStageId] ?? CHAPTERS[0]
  return launchBattleInternal(state, anchor.index, 0, options, ev)
}

export function startStageBattle(
  state: GameState,
  stageId: string,
  endlessWaveOrOptions: number | StartBattleOptions = 0,
  options?: StartBattleOptions
): BattleState {
  const stage = CHAPTER_BY_ID[stageId] ?? CHAPTERS[0]
  return startChapterBattle(state, stage.index, endlessWaveOrOptions, options)
}

export function startChapterBattle(
  state: GameState,
  chapterIndex: number,
  endlessWaveOrOptions: number | StartBattleOptions = 0,
  options?: StartBattleOptions
): BattleState {
  const endlessWave = typeof endlessWaveOrOptions === 'number' ? endlessWaveOrOptions : 0
  const resolvedOpts: StartBattleOptions | undefined = typeof endlessWaveOrOptions === 'object' && endlessWaveOrOptions !== null
    ? endlessWaveOrOptions
    : options
  return launchBattleInternal(state, chapterIndex, endlessWave, resolvedOpts, undefined)
}

function launchBattleInternal(
  state: GameState,
  chapterIndex: number,
  endlessWave: number,
  resolvedOpts: StartBattleOptions | undefined,
  worldEvent: WorldMapEvent | undefined
): BattleState {
  const { campaign } = state
  const safeIdx = clamp(chapterIndex, 0, CHAPTERS.length - 1)
  const baseChapter = CHAPTERS[safeIdx]
  if (!worldEvent) {
    campaign.selectedStageId = baseChapter.id
  }

  // Roguelite Endless Mode rotates biomes/maps each wave and scales biome-appropriate enemies + periodic bosses
  let endlessSelection = null
  let endlessBlessings: EndlessBlessingId[] = []
  if (endlessWave > 0) {
    const run = campaign.endlessRun ?? startEndlessRun(state, endlessWave)
    const prevBiomeGuard = run.lastBiome && run.currentWave !== endlessWave ? run.lastBiome : undefined
    endlessSelection = selectEndlessWaveStage(run.seed, endlessWave, prevBiomeGuard)
    run.currentWave = endlessWave
    run.lastBiome = endlessSelection.biome
    endlessBlessings = normalizeEndlessBlessings(run.activeBlessings)
  }

  // Crownless Deep 10-Floor Secret Abyss resolves per-floor layout, enemies, biome, and modifiers
  const isAbyss = !worldEvent && endlessWave === 0 && isCrownlessDeepStage(baseChapter.id)
  const resolvedAbyssFloor = isAbyss
    ? (resolvedOpts?.abyssFloor !== undefined
        ? clamp(Math.floor(resolvedOpts.abyssFloor), 1, CROWNLESS_DEEP_MAX_FLOOR)
        : getSelectedCrownlessDeepFloor(campaign))
    : undefined
  const abyssSpec = resolvedAbyssFloor !== undefined ? getCrownlessDeepFloorSpec(resolvedAbyssFloor) : null
  const chapter: ChapterSpec = worldEvent
    ? buildWorldEventChapterSpec(worldEvent)
    : endlessSelection
      ? {
          ...endlessSelection.chapter,
          enemies: buildEndlessWaveEnemies(endlessSelection.chapter, endlessWave, campaign.endlessRun?.seed ?? campaign.seed)
        }
    : abyssSpec
      ? {
          ...baseChapter,
          difficulty: abyssSpec.difficulty,
          recommendedPower: abyssSpec.recommendedPower,
          biome: abyssSpec.biome,
          grid: abyssSpec.grid,
          heights: abyssSpec.heights,
          heroSpawns: abyssSpec.heroSpawns,
          objective: abyssSpec.objective,
          enemies: abyssSpec.enemies
        }
      : baseChapter
  const resolvedChapterIndex = worldEvent ? safeIdx : chapter.index

  const challenge: { readonly tier: StageDifficultyTier; readonly mutators: readonly StageMutatorId[] } = worldEvent
    ? { tier: 'normal', mutators: [] }
    : resolveStageChallenge(
        campaign,
        chapter.id,
        resolvedOpts?.tier,
        resolvedOpts?.mutators,
        endlessWave
      )
  const difficultyTier = challenge.tier
  const mutators = worldEvent
    ? []
    : abyssSpec
      ? normalizeStageMutators([...abyssSpec.mutators, ...challenge.mutators])
      : endlessWave === 0
        ? mergeInnateStageMutators(chapter.id, challenge.mutators)
        : challenge.mutators.slice()
  const biome: BiomeId = chapter.biome
  const atmosphere = resolveBattleAtmosphere({
    stageId: worldEvent ? undefined : chapter.id,
    biome,
    endlessWave,
    seed: endlessWave > 0 ? (campaign.endlessRun?.seed ?? campaign.seed) : campaign.seed,
    chapterWeather: chapter.weather,
    chapterTimeOfDay: chapter.timeOfDay,
    overrideWeather: resolvedOpts?.weather,
    overrideTimeOfDay: resolvedOpts?.timeOfDay
  })
  const cells = buildCells(chapter.grid, chapter.heights)
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
    let startEmpower = 0
    let startTaunt = 0
    let startHaste = 0
    for (const eqId of [weaponOwned?.equipId, armorOwned?.equipId, relicOwned?.equipId]) {
      const st = eqId ? EQUIPMENT_BY_ID[eqId]?.startStatus : undefined
      if (st === 'empower') startEmpower = Math.max(startEmpower, 2)
      else if (st === 'taunt') startTaunt = Math.max(startTaunt, 2)
      else if (st === 'haste') startHaste = Math.max(startHaste, 2)
    }
    const allyUnit: BattleUnit = {
      uid: hero.uid,
      team: 'ally',
      name: spec.name,
      heroId: hero.heroId,
      stars: hero.stars,
      level: normalizeHeroLevel(hero.level),
      isBoss: false,
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
      jump: stats.jump,
      range: stats.range,
      crit: stats.crit,
      lifesteal: stats.lifesteal,
      moved: false,
      acted: false,
      alive: true,
      downed: false,
      koCountdown: 0,
      burnTurns: 0,
      slowTurns: 0,
      stunTurns: 0,
      empowerTurns: startEmpower,
      tauntTurns: startTaunt,
      hasteTurns: startHaste,
      poisonStacks: 0,
      cooldowns: [0, 0, 0],
      animState: 'idle',
      animTimer: 0,
      hitFlash: 0,
      lungeX: 0,
      lungeZ: 0
    }
    if (endlessBlessings.length > 0) {
      applyEndlessBlessingsToUnit(allyUnit, endlessBlessings)
    }
    units.push(allyUnit)
  }

  const waveScale = endlessWave > 0 ? 1 + endlessWave * 0.22 : 1
  for (let i = 0; i < chapter.enemies.length; i++) {
    const spawn = chapter.enemies[i]
    const spec = ENEMY_SPECS[spawn.id]
    const scale = (spawn.levelScale ?? 1) * waveScale
    const scaled = computeScaledEnemyStats(
      {
        maxHp: Math.round(spec.maxHp * scale),
        atk: Math.round(spec.atk * scale),
        def: Math.round(spec.def * (1 + (scale - 1) * 0.5)),
        speed: spec.speed,
        baseShield: spec.isBoss ? 25 : 0
      },
      difficultyTier,
      mutators
    )
    const fpSize: 1 | 2 = spec.footprintSize === 2 ? 2 : 1
    const [wx, wy, wz] = computeFootprintWorldCenter(
      { cells, cols, rows },
      spawn.col,
      spawn.row,
      fpSize
    )
    units.push({
      uid: `enemy_${i}_${spawn.id}`,
      team: 'enemy',
      name: spawn.name ?? spec.name,
      enemyId: spawn.id,
      stars: spec.isBoss ? 3 : 1,
      level: normalizeHeroLevel(Math.round(chapter.difficulty * 2 - 1 + (endlessWave > 0 ? endlessWave : 0) + (spec.isBoss ? 2 : 0))),
      isBoss: Boolean(spec.isBoss),
      ...(spawn.id === 'unbroken_crown_boss' ? { bossPhase: 1 } : {}),
      ...(fpSize > 1 ? { footprintSize: fpSize } : {}),
      col: spawn.col,
      row: spawn.row,
      x: wx,
      y: wy,
      z: wz,
      yaw: facingToYaw('w'),
      facing: 'w',
      path: [],
      moveProgress: 0,
      hp: scaled.maxHp,
      maxHp: scaled.maxHp,
      shield: scaled.shield,
      atk: scaled.atk,
      def: scaled.def,
      speed: scaled.speed,
      ct: scaled.speed * 3,
      move: spec.move,
      jump: spec.jump,
      range: spec.range,
      crit: 0.08,
      lifesteal: 0,
      moved: false,
      acted: false,
      alive: true,
      downed: false,
      koCountdown: 0,
      burnTurns: 0,
      slowTurns: 0,
      stunTurns: 0,
      empowerTurns: 0,
      tauntTurns: 0,
      hasteTurns: 0,
      poisonStacks: 0,
      cooldowns: [0, 0, 0],
      animState: 'idle',
      animTimer: 0,
      hitFlash: 0,
      lungeX: 0,
      lungeZ: 0
    })
  }

  const objective = buildBattleObjective(chapter, units, endlessWave)
  const deployTiles = computeDeployTiles(chapter, cells, objective)
  const useDeploy = Boolean(resolvedOpts?.deployPhase)
  const apBonus = arcaneSurgeApBonuses(mutators)
  const blessingMods = computeEndlessBlessingModifiers(endlessBlessings)
  const deckUids = shuffleStrings(getActiveTacticDeckUids(campaign), campaign)
  const gauntletMax = !worldEvent && endlessWave === 0 ? getGauntletMaxRounds(chapter.id) : 0
  const stageBannerTitle = worldEvent
    ? worldEvent.title
    : endlessWave > 0
      ? `Endless Wave ${endlessWave} · ${formatEndlessBiomeLabel(biome)}${isEndlessBossWave(endlessWave) ? ' · BOSS' : ''}`
      : abyssSpec
        ? `${chapter.title} · ${formatAbyssFloorLabel(abyssSpec.floor)}`
        : gauntletMax > 1
          ? `${chapter.title} · Round 1/${gauntletMax}`
          : chapter.title
  const battle: BattleState = {
    stageId: chapter.id,
    chapterIndex: resolvedChapterIndex,
    endlessWave,
    ...(endlessBlessings.length > 0 ? { endlessBlessings: endlessBlessings.slice() } : {}),
    ...(worldEvent
      ? {
          activeWorldEventId: worldEvent.id,
          activeWorldEventKind: worldEvent.kind,
          activeWorldEventTitle: worldEvent.title
        }
      : {}),
    ...(gauntletMax > 1 ? { gauntletRound: 1, gauntletMaxRounds: gauntletMax } : {}),
    ...(resolvedAbyssFloor !== undefined ? { abyssFloor: resolvedAbyssFloor } : {}),
    difficulty: chapter.difficulty,
    difficultyTier,
    mutators,
    cols,
    rows,
    biome,
    weather: atmosphere.weather,
    timeOfDay: atmosphere.timeOfDay,
    cells,
    units,
    deployTiles,
    objective,
    ...(!worldEvent && endlessWave === 0 && createInitialStageMechanicState(chapter.id) !== undefined
      ? { stageMechanic: createInitialStageMechanicState(chapter.id) }
      : {}),
    turn: 0,
    phase: useDeploy ? 'deploy' : 'player',
    activeUnitUid: null,
    selectedUnitUid: null,
    turnOrder: [],
    armedSkillIndex: null,
    armedTacticUid: null,
    ap: 2 + apBonus.startApBonus + blessingMods.startApBonus,
    maxAp: 4 + apBonus.maxApBonus + blessingMods.maxApBonus,
    drawPile: deckUids,
    hand: [],
    discardPile: [],
    tacticsPlayed: 0,
    moveTiles: [],
    targetTiles: [],
    moveAttackTiles: [],
    moveUndo: null,
    oaTriggeredUids: [],
    pendingAction: null,
    facingPicker: null,
    enemyDelay: 0,
    enemyActedThisTurn: false,
    battleSpeed: normalizeBattleSpeed(campaign.battleSpeed),
    autoBattle: false,
    autoBattleDelay: 0,
    floatingNumbers: [],
    nextFloatId: 1,
    combatLog: [],
    nextLogId: 1,
    bannerText: useDeploy ? 'DEPLOY SQUAD' : stageBannerTitle,
    bannerTimer: 2.1,
    shake: 0,
    xpEarnedByHero: {},
    heroStartLevelByUid: Object.fromEntries(
      squad.map(h => [h.uid, normalizeHeroLevel(h.level)])
    ),
    heroKoCount: 0,
    anyHeroFallen: false,
    reward: null,
    activeTipId: null,
    tipQueue: []
  }

  drawTacticCards(battle, campaign, 3)
  state.battle = battle
  discoverBattleEnemiesInCodex(campaign, units)
  if (useDeploy) {
    battle.turnOrder = computeTurnOrderPreview(battle, 8)
  } else {
    appendCombatLog(battle, 'system', `Battle started — ${stageBannerTitle} (${objective.label})`, { turn: 1 })
    advanceToNextUnitTurn(state, true)
  }
  checkDiscoveryTipForBattle(state)
  return battle
}

export function effectiveSpeed(
  unit: Pick<BattleUnit, 'speed' | 'slowTurns'> & { readonly hasteTurns?: number }
): number {
  let mul = 1
  if (unit.slowTurns > 0) mul *= 0.6
  if ((unit.hasteTurns ?? 0) > 0) mul *= 1.4
  if (mul === 1) return unit.speed
  return Math.max(3, Math.round(unit.speed * mul))
}

/** True HP damage dealt by Poison at the start of the poisoned unit's turn (pierces Shield). */
export function computePoisonDamage(unit: Pick<BattleUnit, 'maxHp' | 'poisonStacks'>): number {
  if (unit.poisonStacks <= 0) return 0
  return Math.max(3, Math.round(unit.maxHp * 0.05 * unit.poisonStacks))
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

/** Exact CT spent when ending a player turn under Crownshard's Wait/Move/Act rules. */
export function computeTurnActionCtCost(
  unit: Pick<BattleUnit, 'moved' | 'acted'>,
  actionKind: TurnActionKind
): number {
  if (actionKind === 'move_and_act') return 100
  if (actionKind === 'wait') {
    return unit.moved && unit.acted ? 100 : (unit.moved || unit.acted) ? 80 : 60
  }
  if (actionKind === 'move_only') {
    return unit.acted ? 100 : 80
  }
  return unit.moved ? 100 : 80
}

interface TurnOrderSimUnit {
  readonly unit: BattleUnit
  ct: number
  hp: number
  shield: number
  alive: boolean
  burnTurns: number
  slowTurns: number
  stunTurns: number
  hasteTurns: number
  poisonStacks: number
}

/**
 * Pure simulation of `endPlayerTurn` + `advanceToNextUnitTurn` + `computeTurnOrderPreview`
 * without mutating `battle` or any `BattleUnit`.
 */
function simulateNextTurnOrder(
  battle: BattleState,
  activeUid: string,
  ctCost: number,
  count: number
): TurnPreviewEntry[] {
  const sim: TurnOrderSimUnit[] = []
  for (const u of battle.units) {
    if (!u.alive) continue
    sim.push({
      unit: u,
      ct: u.uid === activeUid ? Math.max(0, u.ct - ctCost) : u.ct,
      hp: u.hp,
      shield: u.shield,
      alive: true,
      burnTurns: u.burnTurns,
      slowTurns: u.slowTurns,
      stunTurns: u.stunTurns,
      hasteTurns: u.hasteTurns,
      poisonStacks: u.poisonStacks
    })
  }
  if (!sim.length) return []

  let nextActive: TurnOrderSimUnit | null = null
  let guard = 0
  while (guard++ < 300) {
    const aliveAllies = sim.some(s => s.alive && s.unit.team === 'ally')
    const aliveEnemies = sim.some(s => s.alive && s.unit.team === 'enemy')
    if (!aliveAllies || !aliveEnemies) break

    let best: TurnOrderSimUnit | null = null
    for (const s of sim) {
      if (!s.alive || s.ct < 100) continue
      if (!best) { best = s; continue }
      const sSpd = effectiveSpeed({ speed: s.unit.speed, slowTurns: s.slowTurns, hasteTurns: s.hasteTurns })
      const bSpd = effectiveSpeed({ speed: best.unit.speed, slowTurns: best.slowTurns, hasteTurns: best.hasteTurns })
      if (s.ct > best.ct) best = s
      else if (s.ct === best.ct && sSpd > bSpd) best = s
      else if (s.ct === best.ct && sSpd === bSpd && s.unit.team === 'ally' && best.unit.team === 'enemy') best = s
    }

    if (!best) {
      for (const s of sim) {
        if (s.alive) s.ct += effectiveSpeed({ speed: s.unit.speed, slowTurns: s.slowTurns, hasteTurns: s.hasteTurns })
      }
      continue
    }

    // Mirror exact start-of-unit-turn ticks from advanceToNextUnitTurn
    if (best.burnTurns > 0) {
      best.burnTurns -= 1
      const absorbed = Math.min(best.shield, 8)
      best.shield -= absorbed
      best.hp = Math.max(0, best.hp - (8 - absorbed))
      if (best.hp <= 0) {
        best.alive = false
        continue
      }
    }
    if (best.poisonStacks > 0) {
      const poisonDmg = computePoisonDamage({ maxHp: best.unit.maxHp, poisonStacks: best.poisonStacks })
      best.poisonStacks = Math.max(0, best.poisonStacks - 1)
      best.hp = Math.max(0, best.hp - poisonDmg)
      if (best.hp <= 0) {
        best.alive = false
        continue
      }
    }
    if (best.slowTurns > 0) best.slowTurns -= 1
    if (best.hasteTurns > 0) best.hasteTurns -= 1
    if (best.stunTurns > 0) {
      best.stunTurns -= 1
      best.ct = Math.max(0, best.ct - 100)
      continue
    }

    nextActive = best
    break
  }

  const aliveSim = sim
    .filter(s => s.alive)
    .map(s => ({
      unit: s.unit,
      ct: s.ct,
      spd: effectiveSpeed({ speed: s.unit.speed, slowTurns: s.slowTurns, hasteTurns: s.hasteTurns })
    }))
  if (!aliveSim.length) return []

  const out: TurnPreviewEntry[] = []
  if (nextActive) {
    const nextSpd = effectiveSpeed({
      speed: nextActive.unit.speed,
      slowTurns: nextActive.slowTurns,
      hasteTurns: nextActive.hasteTurns
    })
    out.push({
      uid: nextActive.unit.uid,
      team: nextActive.unit.team,
      name: nextActive.unit.name,
      heroId: nextActive.unit.heroId,
      enemyId: nextActive.unit.enemyId,
      stars: nextActive.unit.stars,
      speed: nextSpd,
      isCurrent: true
    })
    const activeEntry = aliveSim.find(s => s.unit.uid === nextActive.unit.uid)
    if (activeEntry) activeEntry.ct = Math.max(0, activeEntry.ct - 100)
  }

  let previewGuard = 0
  while (out.length < count && previewGuard++ < 400) {
    let bestIdx = -1
    for (let i = 0; i < aliveSim.length; i++) {
      if (aliveSim[i].ct < 100) continue
      if (bestIdx < 0) { bestIdx = i; continue }
      const a = aliveSim[i], b = aliveSim[bestIdx]
      if (a.ct > b.ct) bestIdx = i
      else if (a.ct === b.ct && a.spd > b.spd) bestIdx = i
      else if (a.ct === b.ct && a.spd === b.spd && a.unit.team === 'ally' && b.unit.team === 'enemy') bestIdx = i
    }
    if (bestIdx >= 0) {
      const winner = aliveSim[bestIdx]
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
      for (const s of aliveSim) s.ct += s.spd
    }
  }
  return out
}

/**
 * Pure non-mutating projection of the CT turn timeline after the active hero waits, moves, or acts.
 * Matches the exact `battle.turnOrder` produced after `endPlayerTurn(state)`.
 */
export function previewTurnOrderAfterAction(
  battle: BattleState,
  actionKind: TurnActionKind,
  count = 8
): TurnOrderActionPreview | null {
  if (battle.phase !== 'player') return null
  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (!active || active.team !== 'ally') return null

  const safeCount = Math.max(1, Math.floor(count))
  const searchDepth = Math.max(safeCount, 24)
  const ctCost = computeTurnActionCtCost(active, actionKind)
  const ctSaved = Math.max(0, 100 - ctCost)
  const remainingCt = Math.max(0, active.ct - ctCost)

  const deepProjected = simulateNextTurnOrder(battle, active.uid, ctCost, searchDepth)
  const projectedOrder = deepProjected.slice(0, safeCount)
  const projectedIndex = projectedOrder.findIndex(e => e.uid === active.uid)
  const deepProjectedIndex = deepProjected.findIndex(e => e.uid === active.uid)

  const deepBaseline = ctCost === 100
    ? deepProjected
    : simulateNextTurnOrder(battle, active.uid, 100, searchDepth)
  const baselineIndex = deepBaseline.findIndex(e => e.uid === active.uid)
  const slotsGained = deepProjectedIndex >= 0 && baselineIndex >= 0
    ? Math.max(0, baselineIndex - deepProjectedIndex)
    : 0

  return {
    actionKind,
    activeUnitUid: active.uid,
    activeUnitName: active.name,
    ctCost,
    ctSaved,
    remainingCt,
    projectedOrder,
    projectedIndex,
    baselineIndex,
    slotsGained
  }
}

export function canTraverseStep(fromCell: GridCell, toCell: GridCell, jump: number): boolean {
  if (!toCell.walkable) return false
  const hFrom = cellHeightLevel(fromCell)
  const hTo = cellHeightLevel(toCell)
  const diff = Math.abs(hTo - hFrom)
  const isRamp = fromCell.terrain === 'stairs' || toCell.terrain === 'stairs'
  const limit = isRamp ? jump + 1 : jump
  return diff <= limit
}

export function elevationDamageMultiplier(attackerLevel: number, defenderLevel: number): number {
  const diff = attackerLevel - defenderLevel
  if (diff >= 3) return 1.35
  if (diff === 2) return 1.28
  if (diff === 1) return 1.2
  if (diff === -1) return 0.92
  if (diff <= -2) return 0.85
  return 1.0
}

export function effectiveAttackRange(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  baseRange: number,
  attacker?: Partial<Pick<BattleUnit, 'heroId'>> | null
): number {
  if (baseRange <= 1) return baseRange
  const attackerLvl = cellHeightAt(battle, fromCol, fromRow)
  const diff = attackerLvl - cellHeightAt(battle, toCol, toRow)
  let eff = baseRange
  if (diff >= 1) eff += 1
  else if (diff <= -2) eff = Math.max(1, eff - 1)
  eff += computePassiveRangeBonus(attacker, attackerLvl, baseRange)
  return eff
}

export function isIndirectSkill(skill: SkillSpec | null): boolean {
  if (!skill) return false
  if (skill.target === 'self' || skill.target === 'ally') return true
  if (skill.pattern === 'area3' || skill.pattern === 'cross' || skill.pattern === 'aura' || skill.pattern === 'self') return true
  if (skill.id === 'shadowstep' || skill.id === 'phantom_exec') return true
  return false
}

export function hasLineOfSight(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  indirect = false
): boolean {
  if (indirect) return true
  const dx = toCol - fromCol
  const dy = toRow - fromRow
  if (Math.abs(dx) + Math.abs(dy) <= 1) return true

  const eyeH = cellHeightAt(battle, fromCol, fromRow) + 1.0
  const targetH = cellHeightAt(battle, toCol, toRow) + 0.8

  const cellBlocks = (col: number, row: number, t: number): boolean => {
    if (!isCellInBounds(col, row, battle.cols, battle.rows)) return false
    const cell = battle.cells[row][col]
    if (!cell || cell.terrain === 'void') return false
    const sightH = eyeH * (1 - t) + targetH * t
    const lvl = cellHeightLevel(cell)
    if (cell.terrain === 'pillar') return lvl + 2.5 > sightH
    if (isIntactBarricade(cell)) return lvl + 1.8 > sightH
    if (lvl > sightH + 0.05) return true
    return false
  }

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity
  let tMaxX = dx !== 0 ? 0.5 * tDeltaX : Infinity
  let tMaxY = dy !== 0 ? 0.5 * tDeltaY : Infinity
  let cx = fromCol
  let cy = fromRow
  let tPrev = 0
  let guard = 0

  while ((cx !== toCol || cy !== toRow) && guard++ < 64) {
    if (Math.abs(tMaxX - tMaxY) < 1e-6) {
      const tCorner = Math.min(1, tMaxX)
      if (cellBlocks(cx + stepX, cy, tCorner) && cellBlocks(cx, cy + stepY, tCorner)) {
        return false
      }
      tPrev = tCorner
      cx += stepX
      cy += stepY
      tMaxX += tDeltaX
      tMaxY += tDeltaY
    } else if (tMaxX < tMaxY) {
      tPrev = Math.min(1, tMaxX)
      cx += stepX
      tMaxX += tDeltaX
    } else {
      tPrev = Math.min(1, tMaxY)
      cy += stepY
      tMaxY += tDeltaY
    }
    if (cx === toCol && cy === toRow) break
    const tNext = Math.min(tMaxX, tMaxY, 1)
    const tMid = (tPrev + tNext) * 0.5
    if (cellBlocks(cx, cy, tMid)) return false
  }
  return true
}

export function computeCoverBonus(
  battle: Pick<BattleState, 'cells' | 'cols' | 'rows'>,
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
  attacker?: Partial<Pick<BattleUnit, 'heroId' | 'weaponId' | 'armorId' | 'relicId'>> | null
): number {
  const dist = manhattan(fromCol, fromRow, toCol, toRow)
  if (dist < 2) return 0
  const ac = fromCol - toCol
  const ar = fromRow - toRow
  const defCell = isCellInBounds(toCol, toRow, battle.cols, battle.rows) ? battle.cells[toRow][toCol] : undefined
  const defLvl = cellHeightAt(battle, toCol, toRow)
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  let best = defCell?.terrain === 'tall_grass' ? TALL_GRASS_RANGED_COVER : 0
  for (const [dc, dr] of dirs) {
    const nc = toCol + dc
    const nr = toRow + dr
    if (!isCellInBounds(nc, nr, battle.cols, battle.rows)) continue
    const neighbor = battle.cells[nr][nc]
    if (!neighbor || neighbor.terrain === 'void') continue
    const isCoverWall = neighbor.terrain === 'pillar' || isIntactBarricade(neighbor)
    const isCliffWall = !isCoverWall && cellHeightLevel(neighbor) >= defLvl + 2
    if (!isCoverWall && !isCliffWall) continue
    const facingAttacker = ac * dc + ar * dr > 0
    if (facingAttacker) {
      best = Math.max(best, 4)
    } else if (isCoverWall) {
      best = Math.max(best, 2)
    }
  }
  return adjustCoverBonusForAttacker(best, attacker, cellHeightAt(battle, fromCol, fromRow))
}

function computeReachableMoveTiles(
  battle: BattleState,
  unit: BattleUnit,
  ignoreMoved: boolean
): GridCoord[] {
  if (!unit.alive || (!ignoreMoved && unit.moved) || unit.stunTurns > 0) return []
  if (getUnitFootprintSize(unit) > 1) {
    return computeFootprintMoveTiles(battle, unit, ignoreMoved)
  }
  const maxMove = Math.max(1, unit.move - (unit.slowTurns > 0 ? 1 : 0))
  // State includes whether the unit has already spent its +1 Ice Sheet slick-glide momentum step
  const visited = new Map<string, number>()
  const queue: { col: number; row: number; dist: number; steps: number; glided: 0 | 1 }[] = [
    { col: unit.col, row: unit.row, dist: 0, steps: 0, glided: 0 }
  ]
  visited.set(`${unit.col},${unit.row},0`, 0)
  const reached = new Set<string>()
  const result: GridCoord[] = []
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const

  while (queue.length > 0) {
    let bestIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (
        queue[i].dist < queue[bestIdx].dist ||
        (queue[i].dist === queue[bestIdx].dist && queue[i].steps < queue[bestIdx].steps)
      ) {
        bestIdx = i
      }
    }
    const cur = queue.splice(bestIdx, 1)[0]
    if (!cur) break
    const curBest = visited.get(`${cur.col},${cur.row},${cur.glided}`)
    if (curBest !== undefined && cur.dist > curBest) continue
    if (cur.steps > 0) {
      const posKey = `${cur.col},${cur.row}`
      if (!reached.has(posKey)) {
        reached.add(posKey)
        const occ = unitOrDownedAt(battle, cur.col, cur.row)
        if (!occ) result.push({ col: cur.col, row: cur.row })
      }
    }
    const fromCell = battle.cells[cur.row][cur.col]
    for (const [dc, dr] of dirs) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      if (!isCellInBounds(nc, nr, battle.cols, battle.rows)) continue
      const cell = battle.cells[nr][nc]
      if (!canTraverseStep(fromCell, cell, unit.jump)) continue
      const occ = unitOrDownedAt(battle, nc, nr)
      if (occ && occ.team !== unit.team) continue
      const baseCost = unitTerrainMoveCost(unit, cell.terrain)
      const canGlide = cur.glided === 0 && (cell.terrain === 'ice' || fromCell.terrain === 'ice')
      const stepCost = canGlide ? Math.max(0, baseCost - 1) : baseCost
      const nextGlided: 0 | 1 = canGlide ? 1 : cur.glided
      const nextDist = cur.dist + stepCost
      if (nextDist > maxMove) continue
      const key = `${nc},${nr},${nextGlided}`
      const prev = visited.get(key)
      if (prev === undefined || nextDist < prev) {
        visited.set(key, nextDist)
        queue.push({ col: nc, row: nr, dist: nextDist, steps: cur.steps + 1, glided: nextGlided })
      }
    }
  }
  return result
}

export function computeMoveTiles(battle: BattleState, unit: BattleUnit): { col: number; row: number }[] {
  return computeReachableMoveTiles(battle, unit, false)
}

function arcSeverity(arc: AttackArc): number {
  return arc === 'back' ? 2 : arc === 'flank' ? 1 : 0
}

/**
 * Pure simulation helper: compute a single enemy's reachable movement tiles, elevation/LoS-aware attack reach,
 * and tiles where that enemy can land a Flank or Backstab against currently alive allies.
 */
export function computeEnemyThreat(battle: BattleState, enemyUid: string): EnemyThreatMap {
  const enemy = getUnitByUid(battle, enemyUid)
  if (!enemy || enemy.team !== 'enemy' || enemy.stunTurns > 0) {
    return {
      enemyUid,
      moveTiles: [],
      attackTiles: [],
      flankThreatTiles: [],
      flankOriginTiles: []
    }
  }

  const moveTiles = computeReachableMoveTiles(battle, enemy, true)
  const stagingTiles: GridCoord[] = [{ col: enemy.col, row: enemy.row }, ...moveTiles]
  const allyByKey = new Map<string, BattleUnit>()
  for (const unit of battle.units) {
    if (unit.alive && unit.team === 'ally') {
      allyByKey.set(`${unit.col},${unit.row}`, unit)
    }
  }

  const attackSeen = new Set<string>()
  const attackTiles: GridCoord[] = []
  const flankByTargetKey = new Map<string, FlankThreatTile>()
  const flankByOriginKey = new Map<string, FlankThreatTile>()
  const indirect = enemy.isBoss
  const maxSpan = enemy.range > 1 ? enemy.range + 1 : enemy.range

  const fpSize = getUnitFootprintSize(enemy)
  for (const stage of stagingTiles) {
    const fpCells = getFootprintCellsAt(stage.col, stage.row, fpSize)
    const fpKeySet = fpSize > 1 ? new Set(fpCells.map(fc => `${fc.col},${fc.row}`)) : null
    for (const origin of fpCells) {
      const rMin = Math.max(0, origin.row - maxSpan)
      const rMax = Math.min(battle.rows - 1, origin.row + maxSpan)
      const cMin = Math.max(0, origin.col - maxSpan)
      const cMax = Math.min(battle.cols - 1, origin.col + maxSpan)

      for (let row = rMin; row <= rMax; row++) {
        for (let col = cMin; col <= cMax; col++) {
          const d = manhattan(origin.col, origin.row, col, row)
          if (d < 1 || d > maxSpan) continue
          const key = `${col},${row}`
          if (fpKeySet && fpKeySet.has(key)) continue
          const cell = battle.cells[row]?.[col]
          if (!cell || !cell.walkable) continue
          const effRange = effectiveAttackRange(battle, origin.col, origin.row, col, row, enemy.range)
          if (d > effRange) continue
          if (!hasLineOfSight(battle, origin.col, origin.row, col, row, indirect)) continue

          if (!attackSeen.has(key)) {
            attackSeen.add(key)
            attackTiles.push({ col, row })
          }

          const ally = allyByKey.get(key)
          if (ally) {
            const arc = computeAttackArc(origin.col, origin.row, ally.col, ally.row, ally.facing)
            if (arc === 'flank' || arc === 'back') {
              const prevTgt = flankByTargetKey.get(key)
              if (!prevTgt || arcSeverity(arc) > arcSeverity(prevTgt.arc)) {
                flankByTargetKey.set(key, {
                  col: ally.col,
                  row: ally.row,
                  targetUid: ally.uid,
                  arc,
                  fromCol: origin.col,
                  fromRow: origin.row
                })
              }
              const originKey = `${origin.col},${origin.row}`
              const prevOrg = flankByOriginKey.get(originKey)
              if (!prevOrg || arcSeverity(arc) > arcSeverity(prevOrg.arc)) {
                flankByOriginKey.set(originKey, {
                  col: origin.col,
                  row: origin.row,
                  targetUid: ally.uid,
                  arc,
                  fromCol: ally.col,
                  fromRow: ally.row
                })
              }
            }
          }
        }
      }
    }
  }

  return {
    enemyUid: enemy.uid,
    moveTiles,
    attackTiles,
    flankThreatTiles: Array.from(flankByTargetKey.values()),
    flankOriginTiles: Array.from(flankByOriginKey.values())
  }
}

/**
 * Pure simulation helper: compute the union of all alive, non-stunned enemies' attack reaches across
 * the board, along with per-tile threat counts and flank/backstab risk flags against current heroes.
 */
export function computeDangerZone(battle: BattleState): DangerZoneMap {
  const enemyThreats: EnemyThreatMap[] = []
  const byKey = new Map<string, {
    col: number
    row: number
    enemyUids: string[]
    highestArc: AttackArc
    hasFlankRisk: boolean
    hasBackstabRisk: boolean
  }>()

  for (const unit of battle.units) {
    if (!unit.alive || unit.team !== 'enemy' || unit.stunTurns > 0 || isEnemyShrouded(battle, unit)) continue
    const threat = computeEnemyThreat(battle, unit.uid)
    enemyThreats.push(threat)

    const flankMap = new Map<string, FlankThreatTile>()
    for (const ft of threat.flankThreatTiles) {
      flankMap.set(`${ft.col},${ft.row}`, ft)
    }

    for (const tile of threat.attackTiles) {
      const key = `${tile.col},${tile.row}`
      let entry = byKey.get(key)
      if (!entry) {
        entry = {
          col: tile.col,
          row: tile.row,
          enemyUids: [],
          highestArc: 'front',
          hasFlankRisk: false,
          hasBackstabRisk: false
        }
        byKey.set(key, entry)
      }
      entry.enemyUids.push(unit.uid)
      const ft = flankMap.get(key)
      if (ft) {
        entry.hasFlankRisk = true
        if (ft.arc === 'back') {
          entry.hasBackstabRisk = true
          entry.highestArc = 'back'
        } else if (entry.highestArc === 'front') {
          entry.highestArc = 'flank'
        }
      }
    }
  }

  const tiles: DangerZoneTile[] = Array.from(byKey.values()).map(e => ({
    col: e.col,
    row: e.row,
    threatCount: e.enemyUids.length,
    enemyUids: e.enemyUids,
    highestArc: e.highestArc,
    hasFlankRisk: e.hasFlankRisk,
    hasBackstabRisk: e.hasBackstabRisk
  }))

  return { tiles, enemyThreats }
}

export function findGridPath(
  battle: BattleState,
  unit: BattleUnit,
  goalCol: number,
  goalRow: number
): { col: number; row: number }[] {
  if (getUnitFootprintSize(unit) > 1) {
    return findFootprintPath(battle, unit, goalCol, goalRow)
  }
  const maxMove = Math.max(1, unit.move - (unit.slowTurns > 0 ? 1 : 0))
  const ignoreZoc = canEvadeZoneOfControl(unit)
  const startStateKey = `${unit.col},${unit.row},0`
  const parent = new Map<string, { col: number; row: number; prevKey: string } | null>()
  const distMap = new Map<string, { dist: number; steps: number; oaRisk: number }>()
  const queue: { col: number; row: number; dist: number; steps: number; oaRisk: number; glided: 0 | 1 }[] = [
    { col: unit.col, row: unit.row, dist: 0, steps: 0, oaRisk: 0, glided: 0 }
  ]
  parent.set(startStateKey, null)
  distMap.set(startStateKey, { dist: 0, steps: 0, oaRisk: 0 })
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  let goalStateKey: string | null = null

  const isBetterCost = (
    aDist: number,
    aSteps: number,
    aRisk: number,
    bDist: number,
    bSteps: number,
    bRisk: number
  ): boolean => {
    if (aDist !== bDist) return aDist < bDist
    if (aSteps !== bSteps) return aSteps < bSteps
    return aRisk < bRisk
  }

  while (queue.length > 0) {
    let bestIdx = 0
    for (let i = 1; i < queue.length; i++) {
      if (
        isBetterCost(
          queue[i].dist, queue[i].steps, queue[i].oaRisk,
          queue[bestIdx].dist, queue[bestIdx].steps, queue[bestIdx].oaRisk
        )
      ) {
        bestIdx = i
      }
    }
    const cur = queue.splice(bestIdx, 1)[0]
    if (!cur) break
    const curKey = `${cur.col},${cur.row},${cur.glided}`
    const curBest = distMap.get(curKey)
    if (curBest && isBetterCost(curBest.dist, curBest.steps, curBest.oaRisk, cur.dist, cur.steps, cur.oaRisk)) continue
    if (cur.col === goalCol && cur.row === goalRow) {
      goalStateKey = curKey
      break
    }
    const fromCell = battle.cells[cur.row][cur.col]
    const leavingOaRisk = ignoreZoc ? 0 : getOpposingZocSentinelsAt(battle, unit.team, cur.col, cur.row).length
    for (const [dc, dr] of dirs) {
      const nc = cur.col + dc
      const nr = cur.row + dr
      if (!isCellInBounds(nc, nr, battle.cols, battle.rows)) continue
      const cell = battle.cells[nr][nc]
      if (!canTraverseStep(fromCell, cell, unit.jump)) continue
      const occ = unitOrDownedAt(battle, nc, nr)
      if (occ && occ.team !== unit.team) continue
      const baseCost = unitTerrainMoveCost(unit, cell.terrain)
      const canGlide = cur.glided === 0 && (cell.terrain === 'ice' || fromCell.terrain === 'ice')
      const stepCost = canGlide ? Math.max(0, baseCost - 1) : baseCost
      const nextGlided: 0 | 1 = canGlide ? 1 : cur.glided
      const nextDist = cur.dist + stepCost
      const nextSteps = cur.steps + 1
      const nextOaRisk = cur.oaRisk + leavingOaRisk
      if (nextDist > maxMove) continue
      const key = `${nc},${nr},${nextGlided}`
      const prev = distMap.get(key)
      if (!prev || isBetterCost(nextDist, nextSteps, nextOaRisk, prev.dist, prev.steps, prev.oaRisk)) {
        parent.set(key, { col: cur.col, row: cur.row, prevKey: curKey })
        distMap.set(key, { dist: nextDist, steps: nextSteps, oaRisk: nextOaRisk })
        queue.push({ col: nc, row: nr, dist: nextDist, steps: nextSteps, oaRisk: nextOaRisk, glided: nextGlided })
      }
    }
  }

  if (!goalStateKey) return []
  const path: { col: number; row: number }[] = []
  let currKey: string | null = goalStateKey
  let currCol = goalCol
  let currRow = goalRow
  while (currKey) {
    if (currCol === unit.col && currRow === unit.row) break
    path.push({ col: currCol, row: currRow })
    const p: { col: number; row: number; prevKey: string } | null = parent.get(currKey) ?? null
    if (!p) break
    currCol = p.col
    currRow = p.row
    currKey = p.prevKey
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
  if (battle.autoBattle) battle.autoBattle = false
  const nextDir = dir ?? FACING_DIRS[(FACING_DIRS.indexOf(active.facing) + 1) % FACING_DIRS.length]
  setUnitFacing(active, nextDir)
  if (battle.facingPicker && battle.facingPicker.unitUid === active.uid) {
    battle.facingPicker.previewFacing = nextDir
  }
  state.sounds.push({ kind: 'card', pitch: 1.12 })
  return true
}

function computeReachableTilesForThreat(battle: BattleState, unit: BattleUnit): { col: number; row: number }[] {
  return computeReachableMoveTiles(battle, unit, true)
}

function opponentThreatStatus(
  battle: BattleState,
  opp: BattleUnit,
  target: BattleUnit
): { inRangeNow: boolean; canReachNextTurn: boolean; distance: number } {
  const distance = manhattan(opp.col, opp.row, target.col, target.row)
  if (opp.stunTurns > 0) {
    return { inRangeNow: false, canReachNextTurn: false, distance }
  }
  const effRangeNow = effectiveAttackRange(battle, opp.col, opp.row, target.col, target.row, opp.range)
  const hasLoSNow = opp.isBoss || hasLineOfSight(battle, opp.col, opp.row, target.col, target.row, false)
  const inRangeNow = distance <= effRangeNow && hasLoSNow
  if (inRangeNow) {
    return { inRangeNow: true, canReachNextTurn: true, distance }
  }
  // Quick lower-bound reject before running BFS
  const maxMove = Math.max(1, opp.move - (opp.slowTurns > 0 ? 1 : 0))
  if (distance > maxMove + opp.range + 2) {
    return { inRangeNow: false, canReachNextTurn: false, distance }
  }
  const tiles = computeReachableTilesForThreat(battle, opp)
  for (const t of tiles) {
    const d = manhattan(t.col, t.row, target.col, target.row)
    const effR = effectiveAttackRange(battle, t.col, t.row, target.col, target.row, opp.range)
    if (d <= effR && (opp.isBoss || hasLineOfSight(battle, t.col, t.row, target.col, target.row, false))) {
      return { inRangeNow: false, canReachNextTurn: true, distance }
    }
  }
  return { inRangeNow: false, canReachNextTurn: false, distance }
}

function buildFacingExposureFromThreats(
  unit: BattleUnit,
  facing: FacingDir,
  activeThreats: readonly { opp: BattleUnit; inRangeNow: boolean; canReachNextTurn: boolean; distance: number }[]
): FacingExposureReport {
  const threats: FacingThreatEntry[] = []
  let backstabCount = 0
  let flankCount = 0
  const backNames: string[] = []
  const flankNames: string[] = []

  for (const item of activeThreats) {
    const arc = computeAttackArc(item.opp.col, item.opp.row, unit.col, unit.row, facing)
    threats.push({
      enemyUid: item.opp.uid,
      enemyName: item.opp.name,
      arc,
      inRangeNow: item.inRangeNow,
      canReachNextTurn: item.canReachNextTurn,
      distance: item.distance
    })
    if (arc === 'back') {
      backstabCount += 1
      backNames.push(item.opp.name)
    } else if (arc === 'flank') {
      flankCount += 1
      flankNames.push(item.opp.name)
    }
  }

  const level: FacingExposureLevel = backstabCount > 0 ? 'back' : flankCount > 0 ? 'flank' : 'safe'
  const worstArc: AttackArc = backstabCount > 0 ? 'back' : flankCount > 0 ? 'flank' : 'front'
  let warningText: string | null = null
  if (backstabCount > 0) {
    warningText = backstabCount === 1
      ? `BACKSTAB RISK (${backNames[0]})`
      : `BACKSTAB RISK (${backstabCount} foes)`
  } else if (flankCount > 0) {
    warningText = flankCount === 1
      ? `FLANK EXPOSED (${flankNames[0]})`
      : `FLANK EXPOSED (${flankCount} foes)`
  }

  return {
    facing,
    level,
    worstArc,
    backstabCount,
    flankCount,
    threats,
    warningText
  }
}

/**
 * Evaluates whether any opposing unit in threat range (currently in attack range or able to reach
 * and strike on its next turn) gains a Backstab or Flank arc against `unitUid` when facing `facing`.
 */
export function evaluateFacingExposure(
  battle: BattleState,
  unitUid: string,
  facing: FacingDir
): FacingExposureReport {
  const unit = getUnitByUid(battle, unitUid)
  if (!unit || !unit.alive) {
    return {
      facing,
      level: 'safe',
      worstArc: 'front',
      backstabCount: 0,
      flankCount: 0,
      threats: [],
      warningText: null
    }
  }
  const activeThreats: { opp: BattleUnit; inRangeNow: boolean; canReachNextTurn: boolean; distance: number }[] = []
  for (const opp of battle.units) {
    if (!opp.alive || opp.team === unit.team) continue
    const st = opponentThreatStatus(battle, opp, unit)
    if (st.inRangeNow || st.canReachNextTurn) {
      activeThreats.push({ opp, ...st })
    }
  }
  return buildFacingExposureFromThreats(unit, facing, activeThreats)
}

/** Evaluates facing exposure across all 4 cardinal facings in one pass. */
export function evaluateAllFacingExposures(
  battle: BattleState,
  unitUid: string
): Record<FacingDir, FacingExposureReport> {
  const unit = getUnitByUid(battle, unitUid)
  if (!unit || !unit.alive) {
    return {
      n: evaluateFacingExposure(battle, unitUid, 'n'),
      e: evaluateFacingExposure(battle, unitUid, 'e'),
      s: evaluateFacingExposure(battle, unitUid, 's'),
      w: evaluateFacingExposure(battle, unitUid, 'w')
    }
  }
  const activeThreats: { opp: BattleUnit; inRangeNow: boolean; canReachNextTurn: boolean; distance: number }[] = []
  for (const opp of battle.units) {
    if (!opp.alive || opp.team === unit.team) continue
    const st = opponentThreatStatus(battle, opp, unit)
    if (st.inRangeNow || st.canReachNextTurn) {
      activeThreats.push({ opp, ...st })
    }
  }
  return {
    n: buildFacingExposureFromThreats(unit, 'n', activeThreats),
    e: buildFacingExposureFromThreats(unit, 'e', activeThreats),
    s: buildFacingExposureFromThreats(unit, 's', activeThreats),
    w: buildFacingExposureFromThreats(unit, 'w', activeThreats)
  }
}

/**
 * Evaluates all 4 cardinal facings against all alive opposing units (weighted by distance, attack reach,
 * and ATK/threat) and returns the facing that minimizes backstab/flank exposure while facing the
 * nearest/highest-threat opponent.
 */
export function chooseOptimalTurnEndFacing(battle: BattleState, unit: BattleUnit): FacingDir {
  if (!unit.alive) return unit.facing
  const opponents = battle.units.filter(u => u.alive && u.team !== unit.team)
  if (opponents.length === 0) return unit.facing

  const weighted = opponents.map(opp => {
    const st = opponentThreatStatus(battle, opp, unit)
    const dist = Math.max(1, st.distance)
    const atkPower = opp.atk * (opp.empowerTurns > 0 ? 1.25 : 1.0) * (1 + opp.crit * 0.5)
    const reachMul = st.inRangeNow ? 3.2 : st.canReachNextTurn ? 1.8 : 0.65
    const stunMul = opp.stunTurns > 0 ? 0.35 : 1.0
    const weight = (atkPower * reachMul * stunMul) / (dist + 0.5)
    const vc = opp.col - unit.col
    const vr = opp.row - unit.row
    const norm = Math.hypot(vc, vr) || 1
    return { opp, weight, nx: vc / norm, nz: vr / norm }
  })

  let bestDir: FacingDir = unit.facing
  let bestScore = -Infinity
  for (const dir of FACING_DIRS) {
    const [fc, fr] = facingVector(dir)
    let score = dir === unit.facing ? 0.01 : 0
    for (const item of weighted) {
      const arc = computeAttackArc(item.opp.col, item.opp.row, unit.col, unit.row, dir)
      if (arc === 'back') score -= 100 * item.weight
      else if (arc === 'flank') score -= 35 * item.weight
      else score += 15 * item.weight
      const align = item.nx * fc + item.nz * fr
      score += align * 12 * item.weight
    }
    if (score > bestScore) {
      bestScore = score
      bestDir = dir
    }
  }
  return bestDir
}

/** Enter the on-board 4-way Wait-to-Face directional picker for the active hero. */
export function beginWaitFacingPicker(state: GameState): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'player') return false
  if (battle.units.some(u => u.path.length > 0)) return false
  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (!active || !active.alive || active.team !== 'ally') return false
  if (battle.autoBattle) battle.autoBattle = false
  if (battle.facingPicker && battle.facingPicker.unitUid === active.uid) return true

  battle.selectedUnitUid = active.uid
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  battle.pendingAction = null
  battle.moveTiles = []
  battle.targetTiles = []
  battle.moveAttackTiles = []
  battle.facingPicker = {
    unitUid: active.uid,
    originalFacing: active.facing,
    previewFacing: active.facing
  }
  state.sounds.push({ kind: 'card', pitch: 1.15 })
  return true
}

/** Live-preview a candidate facing direction while the Wait-to-Face picker is open. */
export function previewWaitFacing(state: GameState, dir: FacingDir): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'player' || !battle.facingPicker) return false
  const active = getUnitByUid(battle, battle.facingPicker.unitUid)
  if (!active || !active.alive || active.team !== 'ally') {
    battle.facingPicker = null
    return false
  }
  if (battle.facingPicker.previewFacing === dir && active.facing === dir) return false
  battle.facingPicker.previewFacing = dir
  setUnitFacing(active, dir)
  state.sounds.push({ kind: 'card', pitch: 1.08 })
  return true
}

/** Cancel the Wait-to-Face picker, restoring the active hero's pre-picker facing without ending the turn. */
export function cancelWaitFacingPicker(state: GameState): boolean {
  const battle = state.battle
  if (!battle || !battle.facingPicker) return false
  const picker = battle.facingPicker
  const active = getUnitByUid(battle, picker.unitUid)
  if (active && active.alive) {
    setUnitFacing(active, picker.originalFacing)
  }
  battle.facingPicker = null
  if (battle.phase === 'player') {
    refreshHighlights(battle, state.campaign)
  }
  state.sounds.push({ kind: 'card', pitch: 0.92 })
  return true
}

/** Commit the chosen (or currently previewed) facing and end the player's turn with Wait CT bonus intact. */
export function confirmWaitFacingPicker(state: GameState, dir?: FacingDir): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'player' || !battle.facingPicker) return false
  const picker = battle.facingPicker
  const active = getUnitByUid(battle, picker.unitUid)
  if (!active || !active.alive || active.team !== 'ally') {
    battle.facingPicker = null
    return false
  }
  const chosen = dir ?? picker.previewFacing
  setUnitFacing(active, chosen)
  battle.facingPicker = null
  endPlayerTurn(state)
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
    // Basic attack targets all visible enemies (including every in-range cell of a 2x2 raid boss!) & intact barricades
    for (const other of battle.units) {
      if (!other.alive || other.team === unit.team) continue
      if (unit.team === 'ally' && isEnemyShrouded(battle, other)) continue
      for (const fc of getUnitFootprintCells(other)) {
        const effRange = effectiveAttackRange(battle, unit.col, unit.row, fc.col, fc.row, unit.range, unit)
        if (
          manhattan(unit.col, unit.row, fc.col, fc.row) <= effRange &&
          hasLineOfSight(battle, unit.col, unit.row, fc.col, fc.row, false)
        ) {
          targets.push({ col: fc.col, row: fc.row })
        }
      }
    }
    for (let row = 0; row < battle.rows; row++) {
      for (let col = 0; col < battle.cols; col++) {
        if (!isIntactBarricade(battle.cells[row][col])) continue
        const d = manhattan(unit.col, unit.row, col, row)
        const effRange = effectiveAttackRange(battle, unit.col, unit.row, col, row, unit.range, unit)
        if (d >= 1 && d <= effRange && hasLineOfSight(battle, unit.col, unit.row, col, row, false)) {
          targets.push({ col, row })
        }
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
  // Any non-pillar, non-void tile within elevation-adjusted skill range & LoS can be targeted.
  // Offensive skills start at distance 1 so clicking your own tile doesn't accidentally self-hit.
  const minDist = skill.target === 'ally' ? 0 : 1
  const indirect = isIndirectSkill(skill)
  for (let row = 0; row < battle.rows; row++) {
    for (let col = 0; col < battle.cols; col++) {
      const terrain = battle.cells[row][col].terrain
      if (terrain === 'pillar' || terrain === 'void') continue
      if (unit.team === 'ally') {
        const occ = unitAt(battle, col, row)
        if (occ && isEnemyShrouded(battle, occ)) continue
      }
      const d = manhattan(unit.col, unit.row, col, row)
      const effRange = effectiveAttackRange(battle, unit.col, unit.row, col, row, skill.range, unit)
      if (d >= minDist && d <= effRange && hasLineOfSight(battle, unit.col, unit.row, col, row, indirect)) {
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
    for (const u of battle.units) {
      if (u.team === 'ally' && (u.alive || (Boolean(spec.canRevive) && isUnitDowned(u)))) {
        out.push({ col: u.col, row: u.row })
      }
    }
    return out
  }
  if (spec.target === 'ally') {
    for (const u of battle.units) {
      if (u.team === 'ally' && (u.alive || (Boolean(spec.canRevive) && isUnitDowned(u)))) {
        out.push({ col: u.col, row: u.row })
      }
    }
    return out
  }
  if (spec.target === 'enemy') {
    for (const u of battle.units) {
      if (u.alive && u.team === 'enemy' && !isEnemyShrouded(battle, u)) {
        for (const fc of getUnitFootprintCells(u)) {
          out.push({ col: fc.col, row: fc.row })
        }
      }
    }
    if (spec.damage > 0) {
      for (let row = 0; row < battle.rows; row++) {
        for (let col = 0; col < battle.cols; col++) {
          if (isIntactBarricade(battle.cells[row][col])) out.push({ col, row })
        }
      }
    }
    return out
  }
  for (let row = 0; row < battle.rows; row++) {
    for (let col = 0; col < battle.cols; col++) {
      const terrain = battle.cells[row][col].terrain
      if (terrain !== 'pillar' && terrain !== 'void') out.push({ col, row })
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
  range: number,
  indirect = false
): { col: number; row: number } | null {
  const targetLvl = cellHeightAt(battle, targetCol, targetRow)
  const targetUnit = unitAt(battle, targetCol, targetRow)
  const offensive = Boolean(targetUnit && targetUnit.team !== unit.team)
  let best: { col: number; row: number } | null = null
  let bestScore = -1e9
  for (const m of moveTiles) {
    const d = manhattan(m.col, m.row, targetCol, targetRow)
    const effRange = effectiveAttackRange(battle, m.col, m.row, targetCol, targetRow, range, unit)
    if (d < 1 || d > effRange) continue
    if (!hasLineOfSight(battle, m.col, m.row, targetCol, targetRow, indirect)) continue
    const cell = battle.cells[m.row][m.col]
    const elevDiff = cellHeightLevel(cell) - targetLvl
    let score = elevDiff * 480
    if (elevDiff > 0) score += 600
    if (cell.terrain === 'shrine') score += 250
    if (cell.terrain === 'tall_grass') score += 45
    if (cell.terrain === 'lava_geyser' && cell.geyserActive) score -= 500
    score += terrainDefBonus(cell.terrain) * 60
    if (offensive && targetUnit) {
      const arc = computeAttackArc(m.col, m.row, targetCol, targetRow, targetUnit.facing)
      if (arc === 'back') score += 850
      else if (arc === 'flank') score += 420
      if (d === 1 && range <= 1 && findPincerAssisters(battle, unit, m.col, m.row, targetUnit).length > 0) {
        score += 500
      }
      score -= computeCoverBonus(battle, m.col, m.row, targetCol, targetRow, unit) * 45
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
  let indirect = false
  let canRevive = false
  if (skillIndex >= 0) {
    const skill = getHeroSkill(unit, skillIndex)
    if (!skill || unit.cooldowns[skillIndex] > 0) return []
    if (skill.target === 'self') return []
    range = skill.range
    targetKind = skill.target
    indirect = isIndirectSkill(skill)
    canRevive = Boolean(skill.canRevive)
  }

  const out: MoveAttackTile[] = []
  for (const u of battle.units) {
    const downedAlly = canRevive && targetKind === 'ally' && u.team === unit.team && isUnitDowned(u)
    if (!u.alive && !downedAlly) continue
    if (targetKind === 'ally' && u.team !== unit.team) continue
    if ((targetKind === 'enemy' || targetKind === 'tile') && u.team === unit.team) continue
    if (unit.team === 'ally' && isEnemyShrouded(battle, u)) continue
    for (const fc of getUnitFootprintCells(u)) {
      if (directTargets.some(t => t.col === fc.col && t.row === fc.row)) continue
      const approach = pickBestApproachTile(battle, unit, moveTiles, fc.col, fc.row, range, indirect)
      if (approach) {
        out.push({ col: fc.col, row: fc.row, fromCol: approach.col, fromRow: approach.row })
      }
    }
  }
  if (targetKind === 'enemy' || targetKind === 'tile') {
    for (let row = 0; row < battle.rows; row++) {
      for (let col = 0; col < battle.cols; col++) {
        if (!isIntactBarricade(battle.cells[row][col])) continue
        if (directTargets.some(t => t.col === col && t.row === row)) continue
        const approach = pickBestApproachTile(battle, unit, moveTiles, col, row, range, indirect)
        if (approach) {
          out.push({ col, row, fromCol: approach.col, fromRow: approach.row })
        }
      }
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

function inferBasicAttackElement(attacker: BattleUnit | null): ElementKind | null {
  if (!attacker) return null
  if (attacker.team === 'enemy') return getEnemyAttackElement(attacker.enemyId)
  if (attacker.heroId === 'cryomancer') return 'frost'
  if (attacker.heroId === 'cleric') return 'holy'
  if (attacker.heroId === 'mage') return 'arcane'
  return null
}

function previewDamageMath(
  battle: BattleState,
  attacker: BattleUnit | null,
  defender: BattleUnit,
  fromCol: number,
  fromRow: number,
  rawDamage: number,
  ignoreArmor: number,
  canCrit: boolean,
  isSkillDamage = false,
  element: ElementKind | null = null
): {
  normalDmg: number
  critDmg: number
  critChance: number
  highGround: boolean
  elevationDiff: number
  coverBonus: number
  terrainDef: number
  empowered: boolean
  attackArc: AttackArc
  weatherNote: string | null
  weatherDamageMul: number
  weatherCritBonus: number
  hpAfterNormal: number
  hpAfterCrit: number
} {
  let dmg = rawDamage
  let highGround = false
  let elevationDiff = 0
  let coverBonus = 0
  let empowered = false
  let attackArc: AttackArc = 'front'
  let arcCritBonus = 0
  const hitCell = attacker ? closestFootprintCell(fromCol, fromRow, defender) : { col: defender.col, row: defender.row }
  const terrainDef = terrainDefBonus(battle.cells[hitCell.row][hitCell.col].terrain)
  if (attacker) {
    const aLvl = cellHeightAt(battle, fromCol, fromRow)
    const dLvl = cellHeightAt(battle, hitCell.col, hitCell.row)
    elevationDiff = aLvl - dLvl
    dmg *= elevationDamageMultiplier(aLvl, dLvl)
    highGround = elevationDiff > 0
    coverBonus = computeCoverBonus(battle, fromCol, fromRow, hitCell.col, hitCell.row, attacker)
    attackArc = computeAttackArc(fromCol, fromRow, hitCell.col, hitCell.row, defender.facing)
    const arcMod = attackArcModifiers(attackArc)
    dmg *= arcMod.dmgMul
    arcCritBonus = arcMod.critBonus + computeBackstabPassiveCritBonus(attacker, attackArc)
    if (attacker.empowerTurns > 0) {
      dmg *= 1.35
      empowered = true
    }
    dmg *= computeAttackerDamageMultiplier(attacker, defender)
    dmg *= mutatorDamageMultiplier(battle)
    dmg *= computeEndlessAttackerDamageMultiplier(battle.endlessBlessings, attacker, defender)
  }
  const weatherMod = computeWeatherCombatModifiers(battle.weather, element, attackArc)
  dmg *= weatherMod.damageMul
  dmg *= computeDefenderIncomingDamageMultiplier(defender, isSkillDamage)
  const totalIgnoreArmor = clamp(ignoreArmor + computeBonusIgnoreArmor(attacker, defender.def), 0, 1)
  const shieldWallDef = computeShieldWallDefBonus(battle, defender)
  const effDef = Math.max(0, (defender.def + shieldWallDef) * (1 - totalIgnoreArmor) + terrainDef + coverBonus)
  const baseDmg = Math.max(4, Math.round(dmg - effDef * 0.72))
  const rangedTallGrass = attacker !== null &&
    manhattan(fromCol, fromRow, hitCell.col, hitCell.row) >= 2 &&
    battle.cells[hitCell.row][hitCell.col].terrain === 'tall_grass'
  const grassCritPenalty = rangedTallGrass ? TALL_GRASS_RANGED_CRIT_REDUCTION : 0
  const effectiveWeatherCrit = canCrit && attacker ? weatherMod.critBonus : 0
  const critChance = canCrit && attacker
    ? clamp(attacker.crit + arcCritBonus + effectiveWeatherCrit - grassCritPenalty, 0, 0.95)
    : 0
  const critRaw = critChance > 0 ? Math.round(baseDmg * 1.55) : baseDmg
  const normalAfterShield = Math.max(0, baseDmg - defender.shield)
  const critAfterShield = Math.max(0, critRaw - defender.shield)
  return {
    normalDmg: baseDmg,
    critDmg: critRaw,
    critChance,
    highGround,
    elevationDiff,
    coverBonus,
    terrainDef,
    empowered,
    attackArc,
    weatherNote: (weatherMod.damageMul !== 1 || effectiveWeatherCrit > 0) ? weatherMod.note : null,
    weatherDamageMul: weatherMod.damageMul,
    weatherCritBonus: effectiveWeatherCrit,
    hpAfterNormal: Math.max(0, defender.hp - normalAfterShield),
    hpAfterCrit: Math.max(0, defender.hp - critAfterShield)
  }
}

export function computeReviveHp(
  target: Pick<BattleUnit, 'maxHp'>,
  reviveHpRatio?: number
): number {
  const ratio = reviveHpRatio ?? 0.5
  return clamp(Math.max(1, Math.round(target.maxHp * ratio)), 1, target.maxHp)
}

/**
 * Pure deterministic Combat Forecast for hovering or tapping a target tile.
 * Computes projected damage/crit/heal/shield/revive/KO, flanking/backstab arcs, friendly fire warnings,
 * empty-tile skill casts, and compares Strike vs every usable Skill.
 */
export function computeCombatForecast(state: GameState, col: number, row: number): CombatForecast | null {
  const battle = state.battle
  if (!battle || battle.phase !== 'player' || !isCellInBounds(col, row, battle.cols, battle.rows)) return null
  if (battle.units.some(u => u.path.length > 0)) return null
  const hoveredOcc = unitAt(battle, col, row)
  if (hoveredOcc && isEnemyShrouded(battle, hoveredOcc)) return null

  const active = getUnitByUid(battle, battle.activeUnitUid)

  // 1. Tactic Card forecast
  if (battle.armedTacticUid) {
    if (!battle.targetTiles.some(t => t.col === col && t.row === row)) return null
    const owned = getTacticByUid(state.campaign, battle.armedTacticUid)
    const spec = owned ? TACTIC_BY_ID[owned.tacticId] : undefined
    if (!spec) return null
    const affected = getPatternCells(col, row, spec.pattern, battle.cols, battle.rows)
    const lookup = (c: number, r: number): BattleUnit | undefined => {
      const live = unitAt(battle, c, r)
      if (live) return live
      return spec.canRevive ? downedHeroAt(battle, c, r) : undefined
    }
    const primary = lookup(col, row) ?? affected.map(c => lookup(c.col, c.row)).find((u): u is BattleUnit => Boolean(u))
    if (!primary) {
      const barCell = battle.cells[row][col]
      if (spec.damage > 0 && isIntactBarricade(barCell)) {
        const hpBefore = barCell.barricadeHp ?? BARRICADE_DEFAULT_HP
        const maxHp = barCell.barricadeMaxHp ?? BARRICADE_DEFAULT_HP
        const barDmg = Math.max(4, Math.round(spec.damage))
        const hpAfter = Math.max(0, hpBefore - barDmg)
        return {
          mode: 'tactic',
          actionName: spec.name,
          skillIndex: null,
          attackerUid: active?.uid ?? null,
          attackerName: active?.name ?? 'Tactic Card',
          attackerHeroId: active?.heroId,
          attackerStars: active?.stars ?? 1,
          targetUid: null,
          targetName: 'Timber Barricade',
          targetTeam: 'enemy',
          targetCol: col,
          targetRow: row,
          approachCol: active?.col ?? col,
          approachRow: active?.row ?? row,
          requiresMove: false,
          path: [],
          normalDmg: barDmg,
          critDmg: barDmg,
          critChance: 0,
          healAmount: 0,
          shieldAmount: 0,
          selfShield: 0,
          status: spec.status,
          highGround: false,
          elevationDiff: 0,
          coverBonus: 0,
          terrainDefBonus: 0,
          empowered: false,
          attackArc: 'front',
          isOffensive: true,
          isRevive: false,
          friendlyFire: false,
          friendlyFireCount: 0,
          emptyTileTarget: false,
          ignoreArmor: 1,
          aoeTargets: 1,
          targetHpBefore: hpBefore,
          targetMaxHp: maxHp,
          targetShieldBefore: 0,
          targetHpAfterNormal: hpAfter,
          targetHpAfterCrit: hpAfter,
          lethalNormal: hpAfter <= 0,
          lethalCrit: hpAfter <= 0,
          alternatives: []
        }
      }
      return null
    }
    const aoeSeenUids = new Set<string>()
    for (const c of affected) {
      const u = lookup(c.col, c.row)
      if (!u || aoeSeenUids.has(u.uid)) continue
      if (spec.damage > 0 ? u.team === 'enemy' : u.team === 'ally') {
        aoeSeenUids.add(u.uid)
      }
    }
    const aoeTargets = aoeSeenUids.size

    let normalDmg = 0
    let healAmount = primary.team === 'ally' ? spec.heal : 0
    let hpAfterNormal = primary.hp
    let elementalCombo: ElementalComboPreview | undefined
    let tacticWeatherNote: string | undefined
    let tacticWeatherDamageMul: number | undefined
    const isRevive = Boolean(spec.canRevive && primary.team === 'ally' && isUnitDowned(primary))
    if (isRevive) {
      healAmount = computeReviveHp(primary, spec.reviveHpRatio)
      hpAfterNormal = healAmount
    } else if (spec.damage > 0 && primary.team === 'enemy') {
      const tacticElement = classifyElement(spec)
      const m = previewDamageMath(battle, null, primary, col, row, spec.damage, 0.6, false, true, tacticElement)
      normalDmg = m.normalDmg
      hpAfterNormal = m.hpAfterNormal
      if (m.weatherNote) tacticWeatherNote = m.weatherNote
      if (m.weatherDamageMul !== 1) tacticWeatherDamageMul = m.weatherDamageMul
      if (tacticElement) {
        const combo = previewElementalCombo(battle, tacticElement, primary, col, row)
        if (combo) {
          elementalCombo = combo
          hpAfterNormal = Math.max(0, hpAfterNormal - combo.bonusDamage)
        }
      }
    } else if (spec.heal > 0 && primary.team === 'ally') {
      hpAfterNormal = Math.min(primary.maxHp, primary.hp + spec.heal)
    }

    let displacementPreview: DisplacementPreview | undefined
    if (spec.displacement && primary.alive && primary.team === 'enemy') {
      displacementPreview = resolveDisplacementPreview(battle, active ?? null, primary, spec.displacement)
      if (hpAfterNormal > 0 && displacementPreview.totalBonusDmg > 0) {
        const shieldAfterPrimary = Math.max(0, primary.shield - normalDmg)
        const bonusHpDmg = Math.max(0, displacementPreview.totalBonusDmg - shieldAfterPrimary)
        hpAfterNormal = Math.max(0, hpAfterNormal - bonusHpDmg)
      }
    }
    const tacticOffensive = spec.damage > 0 || Boolean(spec.displacement && primary.team === 'enemy')
    const tacticTotalDmg = normalDmg + (displacementPreview?.totalBonusDmg ?? 0) + (elementalCombo?.bonusDamage ?? 0)
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
      healAmount,
      shieldAmount: primary.team === 'ally' ? spec.shield : 0,
      selfShield: 0,
      status: spec.status,
      targetTaunting: primary.tauntTurns > 0,
      highGround: false,
      elevationDiff: 0,
      coverBonus: 0,
      terrainDefBonus: primary.team === 'enemy' ? terrainDefBonus(battle.cells[primary.row][primary.col].terrain) : 0,
      empowered: false,
      attackArc: 'front',
      isOffensive: tacticOffensive,
      isRevive,
      ...(isRevive ? { reviveKoCountdown: primary.koCountdown } : {}),
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
      lethalNormal: tacticTotalDmg > 0 && hpAfterNormal <= 0,
      lethalCrit: tacticTotalDmg > 0 && hpAfterNormal <= 0,
      ...(displacementPreview ? { displacementPreview } : {}),
      ...(elementalCombo ? { elementalCombo } : {}),
      ...(tacticWeatherNote ? { weatherNote: tacticWeatherNote } : {}),
      ...(tacticWeatherDamageMul !== undefined ? { weatherDamageMul: tacticWeatherDamageMul } : {}),
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
  const pathOaPreview = requiresMove && path.length > 0
    ? previewPathOpportunityAttacks(battle, active, path)
    : undefined
  const armedIdx = battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0 ? battle.armedSkillIndex : null
  const armedSkill = armedIdx !== null ? getHeroSkill(active, armedIdx) : null
  const canSkillRevive = Boolean(armedSkill?.canRevive)

  const affected = armedSkill ? getPatternCells(col, row, armedSkill.pattern, battle.cols, battle.rows) : [{ col, row }]
  const directLive = unitAt(battle, col, row)
  const directDowned = !directLive && canSkillRevive ? downedHeroAt(battle, col, row) : undefined
  const directUnit = directLive ?? (directDowned && directDowned.team === active.team ? directDowned : undefined)
  const isOffensive = armedSkill ? armedSkill.powerMul > 0 : true
  const isSupportOnly = Boolean(armedSkill && armedSkill.powerMul === 0)
  const isDawnsJudgmentSafe = Boolean(
    armedSkill && armedSkill.id === 'dawns_judgment' && (!directUnit || directUnit.team !== active.team || isUnitDowned(directUnit))
  )

  const affectedUnits: BattleUnit[] = []
  for (const c of affected) {
    const live = unitAt(battle, c.col, c.row)
    const u = live ?? (canSkillRevive ? downedHeroAt(battle, c.col, c.row) : undefined)
    if (!u) continue
    if (isUnitDowned(u) && u.team !== active.team) continue
    if (isOffensive && u.uid === active.uid && !(col === active.col && row === active.row)) continue
    affectedUnits.push(u)
  }

  const friendlyFireUnits = isOffensive && !isDawnsJudgmentSafe
    ? affectedUnits.filter(u => u.team === active.team && u.alive)
    : []
  const friendlyFireCount = friendlyFireUnits.length
  const friendlyFire = friendlyFireCount > 0

  // Prefer the directly clicked unit; otherwise first affected enemy (or ally if friendly fire / support)
  const primary = directUnit
    ?? affectedUnits.find(u => (isSupportOnly ? u.team === active.team : u.team !== active.team))
    ?? affectedUnits[0]
    ?? null

  // If targeting an intact Barricade or hovering an empty ground space:
  if (!primary) {
    const targetCell = battle.cells[row][col]
    if (isOffensive && isIntactBarricade(targetCell)) {
      const hpBefore = targetCell.barricadeHp ?? BARRICADE_DEFAULT_HP
      const maxHp = targetCell.barricadeMaxHp ?? BARRICADE_DEFAULT_HP
      const raw = armedSkill ? active.atk * armedSkill.powerMul + armedSkill.flatBonus : active.atk
      const empowered = active.empowerTurns > 0
      const barDmg = Math.max(4, Math.round(raw * (empowered ? 1.35 : 1)))
      const hpAfter = Math.max(0, hpBefore - barDmg)
      return {
        mode: armedSkill ? 'skill' : 'strike',
        actionName: armedSkill ? armedSkill.name : 'Strike',
        skillIndex: armedIdx,
        attackerUid: active.uid,
        attackerName: active.name,
        attackerHeroId: active.heroId,
        attackerStars: active.stars,
        targetUid: null,
        targetName: 'Timber Barricade',
        targetTeam: 'enemy',
        targetCol: col,
        targetRow: row,
        approachCol,
        approachRow,
        requiresMove,
        path,
        normalDmg: barDmg,
        critDmg: barDmg,
        critChance: 0,
        healAmount: 0,
        shieldAmount: 0,
        selfShield: armedSkill && armedSkill.shieldAmount > 0 && armedSkill.pattern !== 'aura' ? armedSkill.shieldAmount : 0,
        status: armedSkill?.status,
        selfStatus: armedSkill?.selfStatus,
        highGround: false,
        elevationDiff: 0,
        coverBonus: 0,
        terrainDefBonus: 0,
        empowered,
        attackArc: 'front',
        isOffensive: true,
        isRevive: false,
        friendlyFire: false,
        friendlyFireCount: 0,
        emptyTileTarget: false,
        ignoreArmor: 1,
        aoeTargets: 1,
        targetHpBefore: hpBefore,
        targetMaxHp: maxHp,
        targetShieldBefore: 0,
        targetHpAfterNormal: hpAfter,
        targetHpAfterCrit: hpAfter,
        lethalNormal: hpAfter <= 0,
        lethalCrit: hpAfter <= 0,
        ...(pathOaPreview ? { opportunityAttacks: pathOaPreview } : {}),
        alternatives: []
      }
    }
    if (!armedSkill) return null
    const emptySkillElement = isOffensive ? classifyElement(armedSkill) : null
    const emptyCombo = emptySkillElement ? previewElementalCombo(battle, emptySkillElement, null, col, row) : null
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
      selfStatus: armedSkill.selfStatus,
      highGround: false,
      elevationDiff: 0,
      coverBonus: 0,
      terrainDefBonus: 0,
      empowered: active.empowerTurns > 0,
      attackArc: 'front',
      isOffensive,
      isRevive: false,
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
      ...(emptyCombo ? { elementalCombo: emptyCombo } : {}),
      alternatives: []
    }
  }

  // Compute primary preview
  let normalDmg = 0
  let critDmg = 0
  let critChance = 0
  let highGround = false
  let elevationDiff = 0
  let coverBonus = 0
  let terrainDef = 0
  let empowered = false
  let attackArc: AttackArc = 'front'
  let ignoreArmor = 0
  let healAmount = 0
  let shieldAmount = 0
  let selfShield = 0
  let status: StatusKind | undefined
  let selfStatus: StatusKind | undefined
  let hpAfterNormal = primary.hp
  let hpAfterCrit = primary.hp
  let elementalCombo: ElementalComboPreview | undefined
  let weatherNote: string | undefined
  let weatherDamageMul: number | undefined
  let weatherCritBonus: number | undefined
  const primaryDowned = isUnitDowned(primary)
  const isRevive = Boolean(armedSkill?.canRevive && primaryDowned && primary.team === active.team)
  const effectiveIsOffensive = isRevive ? false : isOffensive

  if (armedSkill) {
    ignoreArmor = armedSkill.ignoreArmor
    status = armedSkill.status
    selfStatus = armedSkill.selfStatus
    if (isRevive) {
      healAmount = computeReviveHp(primary, armedSkill.reviveHpRatio)
      shieldAmount = armedSkill.shieldAmount
      hpAfterNormal = healAmount
      hpAfterCrit = healAmount
    } else if (armedSkill.target === 'ally' || armedSkill.target === 'self') {
      healAmount = armedSkill.healAmount
      shieldAmount = armedSkill.shieldAmount + computeOverhealShield(active, primary, healAmount, armedSkill.shieldAmount)
      hpAfterNormal = Math.min(primary.maxHp, primary.hp + healAmount)
      hpAfterCrit = hpAfterNormal
    } else {
      selfShield = armedSkill.shieldAmount
      const healsAlly = isDawnsJudgmentSafe && primary.team === active.team
      if (healsAlly) {
        healAmount = armedSkill.healAmount
        shieldAmount = armedSkill.shieldAmount + computeOverhealShield(active, primary, healAmount, armedSkill.shieldAmount)
        hpAfterNormal = Math.min(primary.maxHp, primary.hp + healAmount)
        hpAfterCrit = hpAfterNormal
      } else if (armedSkill.powerMul > 0) {
        ignoreArmor = clamp(armedSkill.ignoreArmor + computeBonusIgnoreArmor(active, primary.def), 0, 1)
        const raw = active.atk * armedSkill.powerMul + armedSkill.flatBonus
        const skillElement = classifyElement(armedSkill)
        const m = previewDamageMath(battle, active, primary, approachCol, approachRow, raw, armedSkill.ignoreArmor, true, true, skillElement)
        normalDmg = m.normalDmg
        critDmg = m.critDmg
        critChance = m.critChance
        highGround = m.highGround
        elevationDiff = m.elevationDiff
        coverBonus = m.coverBonus
        terrainDef = m.terrainDef
        empowered = m.empowered
        attackArc = m.attackArc
        if (m.weatherNote) weatherNote = m.weatherNote
        if (m.weatherDamageMul !== 1) weatherDamageMul = m.weatherDamageMul
        if (m.weatherCritBonus > 0) weatherCritBonus = m.weatherCritBonus
        hpAfterNormal = m.hpAfterNormal
        hpAfterCrit = m.hpAfterCrit
        if (skillElement) {
          const combo = previewElementalCombo(battle, skillElement, primary, col, row)
          if (combo) {
            elementalCombo = combo
            hpAfterNormal = Math.max(0, hpAfterNormal - combo.bonusDamage)
            hpAfterCrit = Math.max(0, hpAfterCrit - combo.bonusDamage)
          }
        }
      }
    }
  } else if (primary.team !== active.team) {
    ignoreArmor = clamp(computeBonusIgnoreArmor(active, primary.def), 0, 1)
    const strikeElement = inferBasicAttackElement(active)
    const m = previewDamageMath(battle, active, primary, approachCol, approachRow, active.atk, 0, true, false, strikeElement)
    normalDmg = m.normalDmg
    critDmg = m.critDmg
    critChance = m.critChance
    highGround = m.highGround
    elevationDiff = m.elevationDiff
    coverBonus = m.coverBonus
    terrainDef = m.terrainDef
    empowered = m.empowered
    attackArc = m.attackArc
    if (m.weatherNote) weatherNote = m.weatherNote
    if (m.weatherDamageMul !== 1) weatherDamageMul = m.weatherDamageMul
    if (m.weatherCritBonus > 0) weatherCritBonus = m.weatherCritBonus
    hpAfterNormal = m.hpAfterNormal
    hpAfterCrit = m.hpAfterCrit
  }

  // Pincer / Follow-Up assist preview for adjacent melee strikes & single-target melee skills
  let pincerAssister: BattleUnit | null = null
  let pincerDmg = 0
  if (
    primary.alive &&
    primary.team !== active.team &&
    (!armedSkill || isPincerMeleeSkill(armedSkill))
  ) {
    const assisters = findPincerAssisters(battle, active, approachCol, approachRow, primary)
    if (assisters.length > 0) {
      pincerAssister = assisters[0]
      pincerDmg = computePincerAssistDamage(battle, pincerAssister, primary)
      const normalTotalAfterShield = Math.max(0, normalDmg + pincerDmg - primary.shield) + (elementalCombo?.bonusDamage ?? 0)
      const critTotalAfterShield = Math.max(0, critDmg + pincerDmg - primary.shield) + (elementalCombo?.bonusDamage ?? 0)
      hpAfterNormal = Math.max(0, primary.hp - normalTotalAfterShield)
      hpAfterCrit = Math.max(0, primary.hp - critTotalAfterShield)
    }
  }

  const aoeTargets = affectedUnits.filter(u => {
    if (isSupportOnly || isRevive) return u.team === active.team
    if (isDawnsJudgmentSafe) return u.team !== active.team
    return true
  }).length

  let displacementPreview: DisplacementPreview | undefined
  if (armedSkill?.displacement && primary.alive && !primaryDowned && effectiveIsOffensive) {
    displacementPreview = resolveDisplacementPreview(
      battle,
      active,
      primary,
      armedSkill.displacement,
      { col: approachCol, row: approachRow }
    )
    if (displacementPreview.totalBonusDmg > 0) {
      if (hpAfterNormal > 0) {
        const shieldAfterNormal = Math.max(0, primary.shield - normalDmg - pincerDmg)
        const bonusHpNormal = Math.max(0, displacementPreview.totalBonusDmg - shieldAfterNormal)
        hpAfterNormal = Math.max(0, hpAfterNormal - bonusHpNormal)
      }
      if (hpAfterCrit > 0) {
        const shieldAfterCrit = Math.max(0, primary.shield - critDmg - pincerDmg)
        const bonusHpCrit = Math.max(0, displacementPreview.totalBonusDmg - shieldAfterCrit)
        hpAfterCrit = Math.max(0, hpAfterCrit - bonusHpCrit)
      }
    }
  }

  // Build Strike vs Skill comparison alternatives against this same target
  const alternatives: CombatForecastAlt[] = []
  const keycaps: readonly string[] = ['2', '3', '4']
  const distNow = manhattan(active.col, active.row, primary.col, primary.row)
  const equipInflictsStun = [active.weaponId, active.armorId, active.relicId].some(
    eqId => Boolean(eqId && EQUIPMENT_BY_ID[eqId]?.onHitStatus === 'stun')
  )

  // Basic Strike option (for living enemy targets)
  if (!primaryDowned && primary.team !== active.team) {
    const strikeEffRange = effectiveAttackRange(battle, active.col, active.row, primary.col, primary.row, active.range, active)
    const strikeDirect = distNow >= 1 && distNow <= strikeEffRange && hasLineOfSight(battle, active.col, active.row, primary.col, primary.row, false)
    const strikeApproach = strikeDirect
      ? { col: active.col, row: active.row }
      : (!active.moved ? pickBestApproachTile(battle, active, battle.moveTiles, primary.col, primary.row, active.range, false) : null)
    if (strikeApproach) {
      const m = previewDamageMath(battle, active, primary, strikeApproach.col, strikeApproach.row, active.atk, 0, true, false, inferBasicAttackElement(active))
      const strikeAssisters = findPincerAssisters(battle, active, strikeApproach.col, strikeApproach.row, primary)
      const strikePincerDmg = strikeAssisters.length > 0
        ? computePincerAssistDamage(battle, strikeAssisters[0], primary)
        : 0
      const strikeHpAfter = Math.max(0, primary.hp - Math.max(0, m.normalDmg + strikePincerDmg - primary.shield))
      const strikeDist = manhattan(strikeApproach.col, strikeApproach.row, primary.col, primary.row)
      const strikeRanged = active.range > 1 || strikeDist !== 1
      const strikeLethal = strikeHpAfter <= 0
      const altCanCounter = canCounterAttack(battle, active, primary, m.attackArc, strikeRanged, {
        attackerCol: strikeApproach.col,
        attackerRow: strikeApproach.row,
        incomingLethal: strikeLethal,
        incomingStun: equipInflictsStun
      })
      const strikeHitHp = Math.max(0, m.normalDmg - primary.shield)
      const strikeDrain = active.lifesteal + mutatorMeleeDrainBonus(battle, !strikeRanged)
      const strikeLifesteal = strikeDrain > 0 && strikeHitHp > 0 ? Math.max(2, Math.round(strikeHitHp * strikeDrain)) : 0
      const strikePalBonus = computePaladinCounterBonus(primary, m.attackArc, Math.min(primary.shield, m.normalDmg))
      const altCounter = altCanCounter
        ? computeCounterDamage(battle, primary, active, {
          attackerCol: strikeApproach.col,
          attackerRow: strikeApproach.row,
          attackerHp: Math.min(active.maxHp, active.hp + strikeLifesteal),
          attackerShield: active.shield,
          counterMul: strikePalBonus.counterMul
        })
        : null
      alternatives.push({
        skillIndex: null,
        keycap: '1',
        name: 'Strike',
        normalDmg: m.normalDmg,
        critDmg: m.critDmg,
        critChance: m.critChance,
        healAmount: 0,
        selfShield: 0,
        ...(strikePincerDmg > 0 ? { pincerDmg: strikePincerDmg } : {}),
        lethalNormal: strikeLethal,
        requiresMove: !strikeDirect,
        attackArc: m.attackArc,
        canCounter: altCanCounter,
        counterDmg: altCounter ? altCounter.normalDmg : 0,
        counterLethal: altCounter ? altCounter.lethalToAttacker : false,
        active: armedIdx === null
      })
    }
  }

  // Unlocked, off-cooldown skills that can target this unit (only suggest aligned skills so we don't encourage friendly fire!)
  for (let i = 0; i < 3; i++) {
    const sk = getHeroSkill(active, i)
    if (!sk || active.cooldowns[i] > 0 || sk.target === 'self') continue
    if (primaryDowned) {
      if (!sk.canRevive || primary.team !== active.team) continue
    } else {
      if (sk.target === 'ally' && primary.team !== active.team) continue
      if ((sk.target === 'enemy' || sk.target === 'tile') && primary.team === active.team) continue
    }
    const skIndirect = isIndirectSkill(sk)
    const skEffRange = effectiveAttackRange(battle, active.col, active.row, primary.col, primary.row, sk.range, active)
    const skDirect = distNow >= 1 && distNow <= skEffRange && hasLineOfSight(battle, active.col, active.row, primary.col, primary.row, skIndirect)
    const skApproach = skDirect
      ? { col: active.col, row: active.row }
      : (!active.moved ? pickBestApproachTile(battle, active, battle.moveTiles, primary.col, primary.row, sk.range, skIndirect) : null)
    if (!skApproach) continue
    if (primaryDowned && sk.canRevive) {
      alternatives.push({
        skillIndex: i,
        keycap: keycaps[i] ?? '2',
        name: sk.name,
        normalDmg: 0,
        critDmg: 0,
        critChance: 0,
        healAmount: computeReviveHp(primary, sk.reviveHpRatio),
        selfShield: sk.shieldAmount,
        isRevive: true,
        status: sk.status,
        lethalNormal: false,
        requiresMove: !skDirect,
        attackArc: 'front',
        canCounter: false,
        counterDmg: 0,
        counterLethal: false,
        active: armedIdx === i
      })
    } else if (sk.target === 'ally') {
      alternatives.push({
        skillIndex: i,
        keycap: keycaps[i] ?? '2',
        name: sk.name,
        normalDmg: 0,
        critDmg: 0,
        critChance: 0,
        healAmount: sk.healAmount,
        selfShield: sk.shieldAmount + computeOverhealShield(active, primary, sk.healAmount, sk.shieldAmount),
        status: sk.status,
        selfStatus: sk.selfStatus,
        lethalNormal: false,
        requiresMove: !skDirect,
        attackArc: 'front',
        canCounter: false,
        counterDmg: 0,
        counterLethal: false,
        active: armedIdx === i
      })
    } else {
      const raw = active.atk * sk.powerMul + sk.flatBonus
      const skElement = classifyElement(sk)
      const m = previewDamageMath(battle, active, primary, skApproach.col, skApproach.row, raw, sk.ignoreArmor, true, true, skElement)
      const skAssisters = isPincerMeleeSkill(sk)
        ? findPincerAssisters(battle, active, skApproach.col, skApproach.row, primary)
        : []
      const skPincerDmg = skAssisters.length > 0
        ? computePincerAssistDamage(battle, skAssisters[0], primary)
        : 0
      const skCombo = skElement ? previewElementalCombo(battle, skElement, primary, primary.col, primary.row) : null
      const skDispPreview = sk.displacement
        ? resolveDisplacementPreview(battle, active, primary, sk.displacement, { col: skApproach.col, row: skApproach.row })
        : undefined
      const skHpAfter = Math.max(0, primary.hp - Math.max(0, m.normalDmg + skPincerDmg + (skDispPreview?.totalBonusDmg ?? 0) - primary.shield) - (skCombo?.bonusDamage ?? 0))
      const skLethal = skHpAfter <= 0
      const skPushedOutOfMelee = Boolean(
        skDispPreview && skDispPreview.kind !== 'swap' &&
        manhattan(skApproach.col, skApproach.row, skDispPreview.toCol, skDispPreview.toRow) > 1
      )
      const skRangedOrNonMelee = !isMeleeSkillEligibleForCounter(sk) || skPushedOutOfMelee
      const skCanCounter = canCounterAttack(battle, active, primary, m.attackArc, skRangedOrNonMelee, {
        attackerCol: skApproach.col,
        attackerRow: skApproach.row,
        incomingLethal: skLethal,
        incomingStun: sk.status === 'stun' || skCombo?.extraStatus === 'stun' || Boolean(skDispPreview?.causesStun) || equipInflictsStun
      })
      const skHitHp = Math.max(0, m.normalDmg - primary.shield)
      const skIsMelee = sk.range <= 1 && manhattan(skApproach.col, skApproach.row, primary.col, primary.row) === 1
      const skDrain = active.lifesteal + mutatorMeleeDrainBonus(battle, skIsMelee)
      const skLifesteal = skDrain > 0 && skHitHp > 0 ? Math.max(2, Math.round(skHitHp * skDrain)) : 0
      const skSelfHeal = sk.healAmount > 0 && sk.pattern === 'single' ? sk.healAmount : 0
      const skSelfShield = sk.shieldAmount > 0 && sk.pattern !== 'aura' ? sk.shieldAmount : 0
      const skPalBonus = computePaladinCounterBonus(primary, m.attackArc, Math.min(primary.shield, m.normalDmg))
      const skCounter = skCanCounter
        ? computeCounterDamage(battle, primary, active, {
          attackerCol: skApproach.col,
          attackerRow: skApproach.row,
          attackerHp: Math.min(active.maxHp, active.hp + skSelfHeal + skLifesteal),
          attackerShield: active.shield + skSelfShield,
          counterMul: skPalBonus.counterMul
        })
        : null
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
        selfStatus: sk.selfStatus,
        ...(skPincerDmg > 0 ? { pincerDmg: skPincerDmg } : {}),
        lethalNormal: skLethal,
        requiresMove: !skDirect,
        attackArc: m.attackArc,
        canCounter: skCanCounter,
        counterDmg: skCounter ? skCounter.normalDmg : 0,
        counterLethal: skCounter ? skCounter.lethalToAttacker : false,
        active: armedIdx === i
      })
    }
  }

  const comboBonusDmg = elementalCombo?.bonusDamage ?? 0
  // Primary frontal melee counter-attack forecast
  const primaryLethalNormal = (normalDmg + pincerDmg + (displacementPreview?.totalBonusDmg ?? 0) + comboBonusDmg) > 0 && hpAfterNormal <= 0
  let canCounter = false
  let counterDmg = 0
  let counterLethal = false
  let counterAvoidReason: CounterAvoidReason = null
  if (effectiveIsOffensive && primary.team !== active.team && primary.alive) {
    const primaryDist = manhattan(approachCol, approachRow, primary.col, primary.row)
    const pushedOutOfMelee = Boolean(
      displacementPreview && displacementPreview.kind !== 'swap' &&
      manhattan(approachCol, approachRow, displacementPreview.toCol, displacementPreview.toRow) > 1
    )
    const isRangedOrSkill = armedSkill
      ? (!isMeleeSkillEligibleForCounter(armedSkill) || pushedOutOfMelee)
      : (active.range > 1 || primaryDist !== 1)
    const incomingStun = armedSkill?.status === 'stun' || elementalCombo?.extraStatus === 'stun' || Boolean(displacementPreview?.causesStun) || equipInflictsStun
    const counterOpts = {
      attackerCol: approachCol,
      attackerRow: approachRow,
      incomingLethal: primaryLethalNormal,
      incomingStun
    }
    canCounter = canCounterAttack(battle, active, primary, attackArc, isRangedOrSkill, counterOpts)
    counterAvoidReason = getCounterAvoidReason(battle, active, primary, attackArc, isRangedOrSkill, counterOpts)
    if (canCounter) {
      const primaryHitHp = Math.max(0, normalDmg - primary.shield)
      const primaryIsMelee = armedSkill
        ? (armedSkill.range <= 1 && primaryDist === 1)
        : (active.range <= 1 && primaryDist === 1)
      const primaryDrain = active.lifesteal + mutatorMeleeDrainBonus(battle, primaryIsMelee)
      const primaryLifesteal = primaryDrain > 0 && primaryHitHp > 0
        ? Math.max(2, Math.round(primaryHitHp * primaryDrain))
        : 0
      const primarySelfHeal = armedSkill && armedSkill.healAmount > 0 && armedSkill.pattern === 'single'
        && armedSkill.target !== 'ally' && armedSkill.target !== 'self'
        ? armedSkill.healAmount
        : 0
      const primaryPalBonus = computePaladinCounterBonus(primary, attackArc, Math.min(primary.shield, normalDmg))
      const cCalc = computeCounterDamage(battle, primary, active, {
        attackerCol: approachCol,
        attackerRow: approachRow,
        attackerHp: Math.min(active.maxHp, active.hp + primarySelfHeal + primaryLifesteal),
        attackerShield: active.shield + selfShield,
        counterMul: primaryPalBonus.counterMul
      })
      counterDmg = cCalc.normalDmg
      counterLethal = cCalc.lethalToAttacker
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
    selfStatus,
    targetTaunting: primary.tauntTurns > 0,
    highGround,
    elevationDiff,
    coverBonus,
    terrainDefBonus: terrainDef,
    empowered,
    attackArc,
    isOffensive: effectiveIsOffensive,
    isRevive,
    ...(isRevive ? { reviveKoCountdown: primary.koCountdown } : {}),
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
    lethalNormal: primaryLethalNormal,
    lethalCrit: (critDmg + pincerDmg + (displacementPreview?.totalBonusDmg ?? 0) + comboBonusDmg) > 0 && hpAfterCrit <= 0,
    ...(pincerAssister ? {
      pincerAssisterUid: pincerAssister.uid,
      pincerAssisterName: pincerAssister.name,
      pincerDmg,
      pincerFromCol: pincerAssister.col,
      pincerFromRow: pincerAssister.row
    } : {}),
    canCounter,
    counterDmg,
    counterLethal,
    counterAvoidReason,
    ...(pathOaPreview ? { opportunityAttacks: pathOaPreview } : {}),
    ...(displacementPreview ? { displacementPreview } : {}),
    ...(elementalCombo ? { elementalCombo } : {}),
    ...(weatherNote ? { weatherNote } : {}),
    ...(weatherDamageMul !== undefined ? { weatherDamageMul } : {}),
    ...(weatherCritBonus !== undefined ? { weatherCritBonus } : {}),
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

function awardHeroBattleXp(
  state: GameState,
  heroUnit: BattleUnit,
  amount: number
): void {
  const battle = state.battle
  if (!battle || heroUnit.team !== 'ally' || amount <= 0) return
  const owned = getHeroByUid(state.campaign, heroUnit.uid)
  if (!owned) return

  const res = grantHeroXp(owned, amount)
  if (res.xpGained <= 0) return

  battle.xpEarnedByHero[heroUnit.uid] = (battle.xpEarnedByHero[heroUnit.uid] ?? 0) + res.xpGained
  addFloat(battle, heroUnit.x, heroUnit.y + 0.72, heroUnit.z, `+${res.xpGained} XP`, '#7ef0ff')

  if (res.levelsGained > 0) {
    const oldBonus = levelStatBonuses(owned.heroId, res.oldLevel)
    const newBonus = levelStatBonuses(owned.heroId, res.newLevel)
    const hpGain = Math.max(0, newBonus.hp - oldBonus.hp)
    heroUnit.level = res.newLevel
    heroUnit.maxHp += hpGain
    if (heroUnit.alive && hpGain > 0) {
      heroUnit.hp = Math.min(heroUnit.maxHp, heroUnit.hp + hpGain)
    }
    heroUnit.atk += newBonus.atk - oldBonus.atk
    heroUnit.def += newBonus.def - oldBonus.def
    heroUnit.speed = clamp(heroUnit.speed + (newBonus.speed - oldBonus.speed), 4, 24)
    heroUnit.crit = clamp(heroUnit.crit + (newBonus.crit - oldBonus.crit), 0, 0.85)
    addFloat(battle, heroUnit.x, heroUnit.y + 1.08, heroUnit.z, `LEVEL UP! LV ${res.newLevel}`, '#ffe16b')
    state.vfx.push({ kind: 'levelup', at: [heroUnit.x, heroUnit.y + 0.5, heroUnit.z] })
  }
}

interface DamageResult {
  readonly hpDamage: number
  readonly absorbed: number
  readonly rolledDamage: number
  readonly isCrit: boolean
}

function triggerOnKoEffects(
  state: GameState,
  attacker: BattleUnit | null,
  defeated: BattleUnit,
  opts: { readonly isSkillKill: boolean; readonly rawHitDamage: number }
): void {
  const battle = state.battle
  if (!battle || !attacker || !attacker.alive || attacker.team === defeated.team) return

  // Champion Innate Passive — Relentless Momentum: KO grants Empower & +25 CT
  if (attacker.heroId === 'champion') {
    attacker.empowerTurns = Math.max(attacker.empowerTurns, 1)
    attacker.ct += CHAMPION_KO_CT_SURGE
    addFloat(battle, attacker.x, attacker.y + 0.62, attacker.z, `MOMENTUM! +${CHAMPION_KO_CT_SURGE} CT`, '#ff9c66')
    appendCombatLog(battle, 'status', formatStatusLog({ targetName: attacker.name, status: 'empower', phase: 'apply' }))
  }

  // Crimson Pendant (`blood_amulet`): Heal +14 HP on KO
  const koHeal = computeKoHealAmount(attacker)
  if (koHeal > 0) {
    applyHealAndShield(state, attacker, koHeal, 0, attacker, { sourceLabel: 'Crimson Pendant' })
  }

  // Solis Crownblade (`solis_crownblade`): +1 AP on first KO
  if (attacker.team === 'ally' && !attacker.crownbladeKoUsed && unitHasEquip(attacker, 'solis_crownblade')) {
    attacker.crownbladeKoUsed = true
    battle.ap = Math.min(battle.maxAp, battle.ap + 1)
    addFloat(battle, attacker.x, attacker.y + 0.85, attacker.z, 'CROWNBLADE +1 AP', '#ffe066')
  }

  // Mage Innate Passive — Arcane Conduit: skill KO refunds +1 AP & 20% splash magic DMG to 1 adjacent enemy
  if (opts.isSkillKill && attacker.heroId === 'mage') {
    if (attacker.team === 'ally') {
      battle.ap = Math.min(battle.maxAp, battle.ap + 1)
      addFloat(battle, attacker.x, attacker.y + 0.62, attacker.z, 'CONDUIT +1 AP', '#7ef2ff')
    }
    const adjacentFoes = battle.units
      .filter(u =>
        u.alive &&
        u.team === defeated.team &&
        u.uid !== defeated.uid &&
        manhattan(u.col, u.row, defeated.col, defeated.row) === 1
      )
      .sort((a, b) => (a.hp !== b.hp ? a.hp - b.hp : a.uid.localeCompare(b.uid)))
    const splashTarget = adjacentFoes[0]
    if (splashTarget) {
      const splashDmg = Math.max(4, Math.round(opts.rawHitDamage * ARCANE_CONDUIT_SPLASH_RATIO))
      let rem = splashDmg
      let absorbed = 0
      if (splashTarget.shield > 0) {
        absorbed = Math.min(splashTarget.shield, rem)
        splashTarget.shield -= absorbed
        rem -= absorbed
      }
      splashTarget.hp = Math.max(0, splashTarget.hp - rem)
      splashTarget.hitFlash = 0.24
      splashTarget.animState = 'hit'
      splashTarget.animTimer = 0.26
      state.vfx.push({ kind: 'burst', style: 'arcane', at: [splashTarget.x, splashTarget.y + 0.65, splashTarget.z], radius: 0.9, uid: attacker.uid })
      state.vfx.push({
        kind: 'impact',
        uid: splashTarget.uid,
        attackerUid: attacker.uid,
        arc: 'front',
        crit: false,
        blocked: rem === 0 && absorbed > 0,
        absorbed,
        damage: rem
      })
      addFloat(battle, splashTarget.x, splashTarget.y + 0.35, splashTarget.z, rem > 0 ? `CONDUIT -${rem}` : `BLOCK ${absorbed}`, '#a5b8ff')
      appendCombatLog(
        battle,
        'attack',
        formatDamageLog({
          attackerName: attacker.name,
          targetName: splashTarget.name,
          hpDamage: rem,
          absorbed,
          skillName: 'Arcane Conduit'
        })
      )
      if (splashTarget.hp <= 0) {
        handleUnitDefeat(state, splashTarget)
        if (attacker.team === 'ally' && splashTarget.team === 'enemy') {
          awardHeroBattleXp(state, attacker, XP_ACTION_DAMAGE + (splashTarget.isBoss ? XP_ACTION_BOSS_KO : XP_ACTION_KO))
        }
      } else {
        triggerFrontierBossPhaseIfReady(state, splashTarget)
      }
    }
  }
}

interface ApplyDamageLogOpts {
  readonly skillName?: string | null
  readonly suppressLog?: boolean
}

function applyDamageDetailed(
  state: GameState,
  attacker: BattleUnit | null,
  defender: BattleUnit,
  rawDamage: number,
  ignoreArmor: number,
  canCrit: boolean,
  isSkillDamage = false,
  logOpts?: ApplyDamageLogOpts,
  isMeleeAttack?: boolean,
  element: ElementKind | null = null
): DamageResult {
  const battle = state.battle
  if (!battle || !defender.alive) {
    return { hpDamage: 0, absorbed: 0, rolledDamage: 0, isCrit: false }
  }

  let dmg = rawDamage
  let attackArc: AttackArc = 'front'
  let arcCritBonus = 0
  let coverBonus = 0
  const hitCell = attacker ? closestFootprintCell(attacker.col, attacker.row, defender) : { col: defender.col, row: defender.row }
  const terrainDef = terrainDefBonus(battle.cells[hitCell.row][hitCell.col].terrain)
  if (attacker) {
    const aLvl = cellHeightAt(battle, attacker.col, attacker.row)
    const dLvl = cellHeightAt(battle, hitCell.col, hitCell.row)
    dmg *= elevationDamageMultiplier(aLvl, dLvl)
    coverBonus = computeCoverBonus(battle, attacker.col, attacker.row, hitCell.col, hitCell.row, attacker)
    attackArc = computeAttackArc(attacker.col, attacker.row, hitCell.col, hitCell.row, defender.facing)
    const arcMod = attackArcModifiers(attackArc)
    dmg *= arcMod.dmgMul
    arcCritBonus = arcMod.critBonus + computeBackstabPassiveCritBonus(attacker, attackArc)
    if (attacker.empowerTurns > 0) dmg *= 1.35
    dmg *= computeAttackerDamageMultiplier(attacker, defender)
    dmg *= mutatorDamageMultiplier(battle)
    dmg *= computeEndlessAttackerDamageMultiplier(battle.endlessBlessings, attacker, defender)
  }
  const weatherMod = computeWeatherCombatModifiers(battle.weather, element, attackArc)
  dmg *= weatherMod.damageMul
  dmg *= computeDefenderIncomingDamageMultiplier(defender, isSkillDamage)

  const totalIgnoreArmor = clamp(ignoreArmor + computeBonusIgnoreArmor(attacker, defender.def), 0, 1)
  const shieldWallDef = computeShieldWallDefBonus(battle, defender)
  const effDef = Math.max(0, (defender.def + shieldWallDef) * (1 - totalIgnoreArmor) + terrainDef + coverBonus)
  let finalDmg = Math.max(4, Math.round(dmg - effDef * 0.72))

  let isCrit = false
  const rangedTallGrass = attacker !== null &&
    manhattan(attacker.col, attacker.row, hitCell.col, hitCell.row) >= 2 &&
    battle.cells[hitCell.row][hitCell.col].terrain === 'tall_grass'
  const grassCritPenalty = rangedTallGrass ? TALL_GRASS_RANGED_CRIT_REDUCTION : 0
  if (canCrit && attacker && randFloat(state.campaign) < clamp(attacker.crit + arcCritBonus + weatherMod.critBonus - grassCritPenalty, 0, 0.95)) {
    isCrit = true
    finalDmg = Math.round(finalDmg * 1.55)
  }
  const rolledDamage = finalDmg

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
  if (isCrit) {
    state.vfx.push({
      kind: 'camera_cue',
      cue: 'crit',
      at: [defender.x, defender.y, defender.z]
    })
  }
  defender.hitFlash = 0.28
  defender.animState = 'hit'
  defender.animTimer = 0.30
  battle.shake = Math.max(battle.shake, isCrit || attackArc === 'back' ? 0.36 : 0.18)

  const friendlyFire = Boolean(attacker && attacker.team === defender.team)
  if (!logOpts?.suppressLog) {
    const logCat = isCrit && finalDmg > 0 ? 'crit' : 'attack'
    const blockAccent = finalDmg === 0 && absorbed > 0 ? '#7ed9ff' : undefined
    appendCombatLog(
      battle,
      logCat,
      formatDamageLog({
        attackerName: attacker?.name ?? null,
        targetName: defender.name,
        hpDamage: finalDmg,
        absorbed,
        isCrit,
        attackArc,
        skillName: logOpts?.skillName ?? null,
        friendlyFire
      }),
      blockAccent ? { accentHex: blockAccent } : undefined
    )
  }

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
    if (friendlyFire) {
      addFloat(battle, defender.x, defender.y + 0.76, defender.z, 'ALLY HIT!', '#ff66a8')
    }
    state.sounds.push({ kind: isCrit ? 'crit' : 'hit' })
  } else if (absorbed > 0) {
    addFloat(battle, defender.x, defender.y, defender.z, `BLOCK ${absorbed}`, '#7ed9ff')
    state.sounds.push({ kind: 'shield' })
  }

  const resolvedMelee = isMeleeAttack !== undefined
    ? isMeleeAttack
    : Boolean(attacker && attacker.range <= 1 && manhattan(attacker.col, attacker.row, defender.col, defender.row) === 1)
  const effectiveLifesteal = attacker
    ? attacker.lifesteal + mutatorMeleeDrainBonus(battle, resolvedMelee)
    : 0
  if (attacker && effectiveLifesteal > 0 && finalDmg > 0 && attacker.alive) {
    const heal = Math.max(2, Math.round(finalDmg * effectiveLifesteal))
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal)
    addFloat(battle, attacker.x, attacker.y, attacker.z, `+${heal}`, '#6effa8')
    appendCombatLog(
      battle,
      'heal',
      formatHealLog({ sourceName: attacker.name, targetName: attacker.name, healAmount: heal, sourceLabel: 'Lifesteal' })
    )
  }

  if (defender.hp <= 0) {
    handleUnitDefeat(state, defender)
    if (!defender.alive) {
      triggerOnKoEffects(state, attacker, defender, { isSkillKill: isSkillDamage, rawHitDamage: rolledDamage })
    }
  } else {
    if (
      isCrit &&
      attacker &&
      attacker.team !== defender.team &&
      (shouldApplyBurnOnCrit(attacker) || shouldEndlessApplyBurnOnCrit(battle.endlessBlessings, attacker))
    ) {
      applyStatus(battle, defender, 'burn')
    }
    triggerFrontierBossPhaseIfReady(state, defender)
  }
  if (attacker && attacker.team === 'ally' && defender.team === 'enemy' && (finalDmg > 0 || absorbed > 0)) {
    const koBonus = defender.hp <= 0 ? (defender.isBoss ? XP_ACTION_BOSS_KO : XP_ACTION_KO) : 0
    awardHeroBattleXp(state, attacker, XP_ACTION_DAMAGE + koBonus)
  }

  return { hpDamage: finalDmg, absorbed, rolledDamage, isCrit }
}

function applyDamage(
  state: GameState,
  attacker: BattleUnit | null,
  defender: BattleUnit,
  rawDamage: number,
  ignoreArmor: number,
  canCrit: boolean,
  isSkillDamage = false,
  logOpts?: ApplyDamageLogOpts,
  isMeleeAttack?: boolean,
  element: ElementKind | null = null
): number {
  return applyDamageDetailed(state, attacker, defender, rawDamage, ignoreArmor, canCrit, isSkillDamage, logOpts, isMeleeAttack, element).hpDamage
}

function handleUnitDefeat(state: GameState, unit: BattleUnit): void {
  const battle = state.battle
  if (!battle) return
  if (unit.team === 'ally' && canTriggerPhoenixGrace(battle, unit)) {
    const ratio = computeEndlessBlessingModifiers(battle.endlessBlessings).phoenixReviveRatio
    battle.phoenixGraceUsed = true
    unit.alive = true
    unit.downed = false
    unit.koCountdown = 0
    unit.hp = computeReviveHp(unit, ratio)
    unit.shield = 0
    unit.path = []
    unit.moveProgress = 0
    unit.burnTurns = 0
    unit.slowTurns = 0
    unit.stunTurns = 0
    unit.poisonStacks = 0
    unit.animState = 'idle'
    unit.animTimer = 0
    addFloat(battle, unit.x, unit.y + 0.55, unit.z, 'PHOENIX GRACE!', '#ffcb57')
    addFloat(battle, unit.x, unit.y + 0.12, unit.z, `+${unit.hp} HP`, '#6effa8')
    appendCombatLog(
      battle,
      'heal',
      `Phoenix Grace revives ${unit.name} with ${unit.hp} HP!`,
      { accentHex: '#ffcb57' }
    )
    state.sounds.push({ kind: 'heal', pitch: 1.15 })
    state.vfx.push({ kind: 'revive', at: [unit.x, unit.y + 0.55, unit.z], uid: unit.uid })
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
    addFloat(battle, unit.x, unit.y + 0.35, unit.z, `DOWNED (${KO_COUNTDOWN_TURNS})`, '#ffb84d')
    appendCombatLog(battle, 'ko', formatKoLog({ unitName: unit.name, kind: 'downed', countdown: KO_COUNTDOWN_TURNS }))
    state.sounds.push({ kind: 'ko' })
    state.vfx.push({ kind: 'ko', at: [unit.x, unit.y + 0.6, unit.z], isBoss: false, downed: true })
  } else {
    unit.downed = false
    unit.koCountdown = 0
    discoverEnemyInCodex(state.campaign, unit.enemyId)
    appendCombatLog(battle, 'ko', formatKoLog({ unitName: unit.name, kind: 'ko', isBoss: unit.isBoss }))
    state.sounds.push({ kind: 'ko' })
    state.vfx.push({ kind: 'ko', at: [unit.x, unit.y + 0.6, unit.z], isBoss: unit.isBoss })
  }
}

function reviveHero(
  state: GameState,
  target: BattleUnit,
  reviveHp: number,
  shieldAmount = 0,
  reviverName?: string | null,
  sourceLabel?: string | null
): boolean {
  const battle = state.battle
  if (!battle || !isUnitDowned(target)) return false
  target.alive = true
  target.downed = false
  target.koCountdown = 0
  target.hp = clamp(Math.max(1, Math.round(reviveHp)), 1, target.maxHp)
  target.shield = Math.max(0, shieldAmount)
  target.ct = 0
  target.moved = false
  target.acted = false
  target.burnTurns = 0
  target.slowTurns = 0
  target.stunTurns = 0
  target.empowerTurns = 0
  target.tauntTurns = 0
  target.hasteTurns = 0
  target.poisonStacks = 0
  target.animState = 'idle'
  target.animTimer = 0
  addFloat(battle, target.x, target.y + 0.45, target.z, 'REVIVED!', '#ffe378')
  addFloat(battle, target.x, target.y, target.z, `+${target.hp} HP`, '#6effa8')
  if (shieldAmount > 0) {
    addFloat(battle, target.x, target.y + 0.22, target.z, `+${shieldAmount} SHD`, '#7ed9ff')
  }
  appendCombatLog(
    battle,
    'heal',
    formatHealLog({
      sourceName: reviverName ?? null,
      targetName: target.name,
      healAmount: target.hp,
      shieldAmount,
      revived: true,
      sourceLabel: sourceLabel ?? null
    })
  )
  state.vfx.push({ kind: 'revive', at: [target.x, target.y, target.z], uid: target.uid })
  state.vfx.push({ kind: 'heal', at: [target.x, target.y + 0.5, target.z] })
  state.sounds.push({ kind: 'heal', pitch: 1.2 })
  return true
}

function applyHealAndShield(
  state: GameState,
  target: BattleUnit,
  healAmount: number,
  shieldAmount: number,
  healer?: BattleUnit | null,
  opts?: { readonly sourceLabel?: string | null; readonly suppressLog?: boolean }
): void {
  const battle = state.battle
  if (!battle || !target.alive) return
  const overhealShield = computeOverhealShield(healer, target, healAmount, shieldAmount)
  let gained = 0
  if (healAmount > 0) {
    const before = target.hp
    target.hp = Math.min(target.maxHp, target.hp + healAmount)
    gained = target.hp - before
    addFloat(battle, target.x, target.y, target.z, `+${gained > 0 ? gained : healAmount} HP`, '#6effa8')
    state.vfx.push({ kind: 'heal', at: [target.x, target.y + 0.5, target.z] })
    state.sounds.push({ kind: 'heal' })
  }
  const totalShield = shieldAmount + overhealShield
  if (totalShield > 0) {
    target.shield += totalShield
    addFloat(
      battle,
      target.x,
      target.y + 0.35,
      target.z,
      overhealShield > 0 && shieldAmount === 0 ? `GRACE +${overhealShield} SHD` : `+${totalShield} SHD`,
      '#7ed9ff'
    )
    state.vfx.push({ kind: 'shield', at: [target.x, target.y + 0.5, target.z] })
    state.sounds.push({ kind: 'shield' })
  }
  if (!opts?.suppressLog && (healAmount > 0 || totalShield > 0)) {
    appendCombatLog(
      battle,
      'heal',
      formatHealLog({
        sourceName: healer?.name ?? null,
        targetName: target.name,
        healAmount: healAmount > 0 ? (gained > 0 ? gained : healAmount) : 0,
        shieldAmount: totalShield,
        sourceLabel: opts?.sourceLabel ?? null
      })
    )
  }
}

function isBeneficialStatus(status: StatusKind): boolean {
  return status === 'empower' || status === 'taunt' || status === 'haste'
}

function applyPoisonTick(state: GameState, unit: BattleUnit, dmg: number): void {
  const battle = state.battle
  if (!battle || !unit.alive || dmg <= 0) return
  unit.hp = Math.max(0, unit.hp - dmg)
  state.vfx.push({
    kind: 'impact',
    uid: unit.uid,
    attackerUid: null,
    arc: 'front',
    crit: false,
    blocked: false,
    absorbed: 0,
    damage: dmg
  })
  unit.hitFlash = 0.24
  unit.animState = 'hit'
  unit.animTimer = 0.28
  addFloat(battle, unit.x, unit.y, unit.z, `POISON -${dmg}`, '#8dff4f')
  appendCombatLog(battle, 'status', formatStatusLog({ targetName: unit.name, status: 'poison', phase: 'tick', damage: dmg }))
  state.sounds.push({ kind: 'hit', pitch: 0.85 })
  if (unit.hp <= 0) {
    handleUnitDefeat(state, unit)
  } else {
    triggerFrontierBossPhaseIfReady(state, unit)
  }
}

function applyEquipmentOnHitStatus(battle: BattleState, attacker: BattleUnit, target: BattleUnit): void {
  if (!target.alive || attacker.team === target.team) return
  for (const eqId of [attacker.weaponId, attacker.armorId, attacker.relicId]) {
    const st = eqId ? EQUIPMENT_BY_ID[eqId]?.onHitStatus : undefined
    if (st && !isBeneficialStatus(st)) {
      applyStatus(battle, target, st, 1)
    }
  }
}

export function applyStatus(
  battle: BattleState,
  target: BattleUnit,
  status: StatusKind,
  stacks = 2
): void {
  if (!target.alive) return
  if (status === 'burn') {
    target.burnTurns = Math.max(target.burnTurns, 2)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'BURN', '#ff9b42')
  } else if (status === 'slow') {
    const slowDuration = 2 + weatherSlowDurationBonus(battle.weather)
    target.slowTurns = Math.max(target.slowTurns, slowDuration)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'SLOW', '#7fdfff')
  } else if (status === 'stun') {
    target.stunTurns = Math.max(target.stunTurns, 1)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'STUN!', '#ffdf59')
  } else if (status === 'empower') {
    target.empowerTurns = Math.max(target.empowerTurns, 2)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'EMPOWER', '#ffd86b')
  } else if (status === 'taunt') {
    target.tauntTurns = Math.max(target.tauntTurns, 2)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'TAUNT!', '#ff6652')
  } else if (status === 'haste') {
    target.hasteTurns = Math.max(target.hasteTurns, 2)
    addFloat(battle, target.x, target.y + 0.55, target.z, 'HASTE!', '#5cf2d6')
  } else if (status === 'poison') {
    const add = Math.max(1, Math.round(stacks))
    target.poisonStacks = Math.min(MAX_POISON_STACKS, target.poisonStacks + add)
    addFloat(battle, target.x, target.y + 0.55, target.z, `POISON x${target.poisonStacks}`, '#8dff4f')
  }
  appendCombatLog(
    battle,
    'status',
    formatStatusLog({
      targetName: target.name,
      status,
      phase: 'apply',
      stacks: status === 'poison' ? target.poisonStacks : undefined
    })
  )
}

function faceToward(unit: BattleUnit, tx: number, tz: number): void {
  const dx = tx - unit.x
  const dz = tz - unit.z
  if (Math.hypot(dx, dz) > 0.05) {
    unit.yaw = Math.atan2(dx, dz)
    unit.facing = vectorToFacing(dx, dz, unit.facing)
  }
}

function checkTileObjectiveInteractions(state: GameState, unit: BattleUnit): void {
  const battle = state.battle
  if (!battle || !unit.alive || battle.phase === 'deploy' || battle.phase === 'victory' || battle.phase === 'defeat') return
  const obj = battle.objective

  if (unit.team === 'ally' && obj.kind === 'seize') {
    const chest = obj.chestTiles.find(c => c.col === unit.col && c.row === unit.row)
    if (chest && !isChestClaimed(obj, chest.col, chest.row)) {
      obj.claimedChests.push({ col: chest.col, row: chest.row })
      battle.moveUndo = null
      const bonusGold = 25
      state.campaign.gold += bonusGold
      addFloat(battle, unit.x, unit.y + 0.5, unit.z, `CHEST +${bonusGold}g!`, '#ffe16b')
      state.sounds.push({ kind: 'coin', pitch: 1.15 })
      state.vfx.push({ kind: 'burst', style: 'gold', at: [unit.x, unit.y + 0.6, unit.z], radius: 1.1 })
      checkBattleOutcome(state)
      if (isBattleEnded(battle)) return
    }
    if (obj.goalTile && obj.goalTile.col === unit.col && obj.goalTile.row === unit.row) {
      if (obj.claimedChests.length >= obj.requiredChests) {
        obj.seized = true
        battle.moveUndo = null
        addFloat(battle, unit.x, unit.y + 0.65, unit.z, 'SEIZED!', '#ffe16b')
        state.vfx.push({ kind: 'burst', style: 'gold', at: [unit.x, unit.y + 0.7, unit.z], radius: 1.5 })
        checkBattleOutcome(state)
      } else {
        const rem = obj.requiredChests - obj.claimedChests.length
        addFloat(battle, unit.x, unit.y + 0.55, unit.z, `NEED ${rem} CHEST${rem > 1 ? 'S' : ''}`, '#ffcb57')
      }
    }
  } else if (unit.team === 'enemy' && obj.kind === 'defend' && obj.protectTile) {
    if (obj.protectTile.col === unit.col && obj.protectTile.row === unit.row) {
      obj.protectBreached = true
      addFloat(battle, unit.x, unit.y + 0.65, unit.z, 'BREACHED!', '#ff5266')
      state.vfx.push({ kind: 'burst', style: 'shadow', at: [unit.x, unit.y + 0.7, unit.z], radius: 1.4 })
      checkBattleOutcome(state)
    }
  }
}

function advanceGauntletWave(state: GameState): boolean {
  const battle = state.battle
  if (!battle || !canAdvanceGauntletRound(battle)) return false
  const nextRound = (battle.gauntletRound ?? 1) + 1
  const wave = getGauntletWaveSpec(battle.stageId, nextRound)
  if (!wave) return false

  battle.gauntletRound = nextRound

  // Inter-round vanguard recovery (+25% max HP to living allies & +1 AP)
  const hpBefore = new Map<string, number>()
  for (const u of battle.units) {
    if (u.alive && u.team === 'ally') hpBefore.set(u.uid, u.hp)
  }
  const recovery = applyGauntletInterRoundRecovery(battle)
  for (const u of battle.units) {
    if (!u.alive || u.team !== 'ally') continue
    const gained = u.hp - (hpBefore.get(u.uid) ?? u.hp)
    if (gained > 0) {
      addFloat(battle, u.x, u.y + 0.45, u.z, `+${gained} HP`, '#5ef29b')
      state.vfx.push({ kind: 'heal', at: [u.x, u.y + 0.5, u.z] })
    }
  }

  // Deploy the incoming gladiator wave onto open arena tiles
  const newFoes = createGauntletWaveUnits(battle, nextRound)
  for (const foe of newFoes) {
    battle.units.push(foe)
    discoverEnemyInCodex(state.campaign, foe.enemyId)
    state.vfx.push({ kind: 'burst', style: 'fire', at: [foe.x, foe.y + 0.5, foe.z], radius: 1.0, uid: foe.uid })
  }

  battle.bannerText = wave.bannerText
  battle.bannerTimer = 2.6
  battle.shake = Math.max(battle.shake, 0.28)
  state.sounds.push({ kind: 'turn', team: 'enemy' })
  if (recovery.totalHealed > 0) state.sounds.push({ kind: 'heal', pitch: 1.08 })
  appendCombatLog(
    battle,
    'system',
    `Round ${nextRound}/${battle.gauntletMaxRounds ?? CINDER_ARENA_MAX_ROUNDS} — ${wave.title} enters the pit! Heroes recover +25% HP${recovery.apGained > 0 ? ` & +${recovery.apGained} AP` : ''}.`,
    { accentHex: '#ffba52' }
  )
  battle.turnOrder = computeTurnOrderPreview(battle, 8)
  refreshHighlights(battle, state.campaign)
  return true
}

function checkFrontierBossPhases(state: GameState): void {
  const battle = state.battle
  if (!battle) return
  for (const u of battle.units) {
    if (u.alive && u.team === 'enemy' && shouldTriggerUnbrokenCrownPhase2(u)) {
      triggerFrontierBossPhaseIfReady(state, u)
    }
  }
}

function checkBattleOutcome(state: GameState): void {
  const battle = state.battle
  if (!battle || battle.phase === 'deploy' || battle.phase === 'victory' || battle.phase === 'defeat') return
  checkFrontierBossPhases(state)
  if (canAdvanceGauntletRound(battle) && advanceGauntletWave(state)) return
  const outcome = evaluateBattleObjective(battle)

  if (outcome.status === 'victory') {
    battle.phase = 'victory'
    battle.autoBattle = false
    battle.objective.outcomeReason = outcome.reason ?? undefined
    battle.moveTiles = []
    battle.targetTiles = []
    battle.moveAttackTiles = []
    battle.moveUndo = null
    battle.oaTriggeredUids = []
    battle.pendingAction = null
    battle.facingPicker = null
    battle.armedSkillIndex = null
    battle.armedTacticUid = null
    for (const u of battle.units) {
      if (u.alive && u.team === 'ally') {
        u.animState = 'celebrate'
        u.animTimer = 2.0
      }
    }
    awardBattleVictory(state)
    if (outcome.reason) {
      battle.bannerText = `VICTORY — ${outcome.reason}`
    }
    appendCombatLog(
      battle,
      'system',
      outcome.reason ? `Victory! ${outcome.reason}` : 'Victory! All enemies defeated.',
      { accentHex: '#5ef29b' }
    )
    state.sounds.push({ kind: 'victory' })
  } else if (outcome.status === 'defeat') {
    battle.phase = 'defeat'
    battle.autoBattle = false
    battle.objective.outcomeReason = outcome.reason ?? undefined
    battle.moveTiles = []
    battle.targetTiles = []
    battle.moveAttackTiles = []
    battle.moveUndo = null
    battle.oaTriggeredUids = []
    battle.pendingAction = null
    battle.facingPicker = null
    battle.armedSkillIndex = null
    battle.armedTacticUid = null
    battle.bannerText = outcome.reason ?? 'Vanguard Defeated'
    battle.bannerTimer = 3.0
    if (battle.endlessWave > 0) {
      abandonEndlessRun(state)
    }
    appendCombatLog(
      battle,
      'system',
      outcome.reason ? `Defeat — ${outcome.reason}` : 'Defeat — Vanguard defeated.',
      { accentHex: '#ff5266' }
    )
    state.sounds.push({ kind: 'defeat' })
  }
}

function replayWeightsForDifficulty(diff: DifficultyLevel): Record<Rarity, number> {
  return baseReplayWeightsForDifficulty(diff)
}

function awardBattleVictory(state: GameState): void {
  const battle = state.battle
  if (!battle) return
  const { campaign } = state
  const chapter = CHAPTERS[battle.chapterIndex]
  const activeWorldEventId = battle.activeWorldEventId
  const isWorldEvent = activeWorldEventId !== undefined
  const activeWorldEvent = activeWorldEventId !== undefined
    ? getWorldMapEventById(campaign, activeWorldEventId)
    : undefined
  const worldEventPlan = activeWorldEventId !== undefined
    ? activeWorldEvent
      ? resolveWorldEventVictoryReward(campaign, activeWorldEvent)
      : {
          eventId: activeWorldEventId,
          kind: battle.activeWorldEventKind ?? 'goblin_ambush',
          title: battle.activeWorldEventTitle ?? 'Road Event',
          gold: 125 + battle.difficulty * 35,
          bonusDust: 30 + battle.difficulty * 12,
          bonusShards: battle.activeWorldEventKind === 'timed_gauntlet' ? 55 + battle.difficulty * 18 : 0,
          equipSpec: battle.activeWorldEventKind === 'timed_gauntlet'
            ? selectProtectedEquipment(
                EQUIPMENT_LIST.filter(e => e.rarity === (battle.difficulty >= 4 ? 'epic' : 'rare')),
                campaign,
                0.25
              )
            : null
        }
    : null
  const isAbyss = !isWorldEvent && battle.endlessWave === 0 && battle.abyssFloor !== undefined && isCrownlessDeepStage(chapter.id)
  const abyssPlan = isAbyss && battle.abyssFloor !== undefined
    ? resolveCrownlessDeepVictoryRewards(campaign, battle.abyssFloor)
    : null
  const firstClear = !isWorldEvent && battle.endlessWave === 0 && (
    abyssPlan ? abyssPlan.firstFloorClear : !isStageCleared(campaign, chapter.id)
  )
  const challengeRewards = !isWorldEvent && battle.endlessWave === 0 && !firstClear && !abyssPlan
    ? computeChallengeRewards(chapter.replayGold, chapter.difficulty, battle.difficultyTier, battle.mutators)
    : null
  const starfallBonus = !isWorldEvent && battle.endlessWave === 0
    ? getStarfallFirstClearBonus(chapter.id, firstClear)
    : { bonusDust: 0, bonusShards: 0 }
  const gold = worldEventPlan
    ? worldEventPlan.gold
    : battle.endlessWave > 0
      ? 130 + battle.endlessWave * 35
      : abyssPlan
        ? abyssPlan.gold
        : firstClear
          ? chapter.rewardGold
          : (challengeRewards?.replayGold ?? chapter.replayGold)
  const bonusDust = worldEventPlan
    ? worldEventPlan.bonusDust
    : (abyssPlan?.bonusDust ?? 0) + (challengeRewards?.bonusDust ?? 0) + starfallBonus.bonusDust
  const bonusShards = worldEventPlan
    ? worldEventPlan.bonusShards
    : (abyssPlan?.bonusShards ?? 0) + (challengeRewards?.bonusShards ?? 0) + starfallBonus.bonusShards

  campaign.gold += gold
  if (bonusDust > 0) campaign.dust += bonusDust
  if (bonusShards > 0) campaign.shards += bonusShards
  campaign.battlesWon += 1

  const masteryEarned = !isWorldEvent && battle.endlessWave === 0
    ? evaluateAndRecordBattleMastery(campaign, battle, chapter)
    : undefined

  let unlockedSlot4 = false
  let campaignWon = false
  let abyssCompleted = false
  if (isWorldEvent && battle.activeWorldEventId) {
    removeWorldMapEvent(campaign, battle.activeWorldEventId)
  } else if (battle.endlessWave > 0) {
    if (battle.endlessWave > campaign.endlessBest) campaign.endlessBest = battle.endlessWave
    prepareEndlessVictoryDraft(state, battle.endlessWave, battle.biome)
  } else if (abyssPlan) {
    if (abyssPlan.floor > campaign.crownlessDeepFloor) {
      campaign.crownlessDeepFloor = abyssPlan.floor
    }
    campaign.crownlessDeepSelectedFloor = Math.min(CROWNLESS_DEEP_MAX_FLOOR, abyssPlan.floor + 1)
    if (abyssPlan.isFloor10FirstClear) {
      campaign.crownlessDeepRewardClaimed = true
      abyssCompleted = true
    }
    if (!isStageCleared(campaign, chapter.id)) {
      campaign.clearedStageIds.push(chapter.id)
      campaign.chaptersCleared = campaign.clearedStageIds.length
    }
    recordClearedStageTier(campaign, chapter.id, battle.difficultyTier)
  } else if (firstClear) {
    const prevSlots = maxSquadSize(campaign)
    campaign.clearedStageIds.push(chapter.id)
    campaign.chaptersCleared = campaign.clearedStageIds.length
    recordClearedStageTier(campaign, chapter.id, 'normal')
    if (maxSquadSize(campaign) > prevSlots) unlockedSlot4 = true
    if (chapter.unlocksEndless) campaignWon = true
  } else {
    recordClearedStageTier(campaign, chapter.id, battle.difficultyTier)
  }

  let equipCard: OwnedEquipCard | null = null
  let heroCard: OwnedHeroCard | null = null
  let tacticCard: OwnedTacticCard | null = null
  let specialRewardsClaimed = false

  if (worldEventPlan) {
    specialRewardsClaimed = true
    if (worldEventPlan.equipSpec) {
      equipCard = {
        uid: allocUid(campaign, 'eq'),
        equipId: worldEventPlan.equipSpec.id,
        slot: worldEventPlan.equipSpec.slot
      }
      campaign.equipment.push(equipCard)
    }
  } else if (battle.endlessWave > 0) {
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
      level: 1,
      xp: 0,
      weaponUid: null,
      armorUid: null,
      relicUid: null
    }
    campaign.heroes.push(heroCard)
  } else if (abyssPlan) {
    if (abyssPlan.isFloor10FirstClear) {
      // Pinnacle Floor 10 one-time legendary completion spoils!
      specialRewardsClaimed = true
      if (abyssPlan.legendEquipId) {
        const eqSpec = EQUIPMENT_BY_ID[abyssPlan.legendEquipId] ?? EQUIPMENT_LIST[0]
        equipCard = { uid: allocUid(campaign, 'eq'), equipId: eqSpec.id, slot: eqSpec.slot }
        campaign.equipment.push(equipCard)
      }
      if (abyssPlan.legendHeroId) {
        heroCard = {
          uid: allocUid(campaign, 'hero'),
          heroId: abyssPlan.legendHeroId,
          stars: 1,
          level: 1,
          xp: 0,
          weaponUid: null,
          armorUid: null,
          relicUid: null
        }
        campaign.heroes.push(heroCard)
      }
    } else {
      // Escalating Abyss floor drop (rare+ guarantee on Floors 5+)
      const abyssWeights = replayWeightsForDifficulty(battle.difficulty)
      const minDropRarity: Rarity = abyssPlan.floor >= 5 ? 'rare' : 'uncommon'
      const rarity = rollRarity(campaign, abyssWeights, minDropRarity)
      const kindRoll = randFloat(campaign)
      if (kindRoll < 0.50) {
        const eqSpec = pickNearestByRarity(EQUIPMENT_LIST, rarity, campaign)
        equipCard = { uid: allocUid(campaign, 'eq'), equipId: eqSpec.id, slot: eqSpec.slot }
        campaign.equipment.push(equipCard)
      } else if (kindRoll < 0.85) {
        const hSpec = pickNearestByRarity(HERO_LIST, rarity, campaign)
        heroCard = {
          uid: allocUid(campaign, 'hero'),
          heroId: hSpec.id,
          stars: 1,
          level: 1,
          xp: 0,
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
        level: 1,
        xp: 0,
        weaponUid: null,
        armorUid: null,
        relicUid: null
      }
      campaign.heroes.push(heroCard)
    }
  } else {
    // Replaying an already-cleared stage: awards replay gold + repeatable drop scaled by difficulty tier & mutators
    const repWeights = challengeRewards?.dropWeights ?? replayWeightsForDifficulty(chapter.difficulty)
    const minDropRarity = challengeRewards?.minDropRarity ?? 'common'
    const rarity = rollRarity(campaign, repWeights, minDropRarity)
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
        level: 1,
        xp: 0,
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

  const heroXpGains: BattleHeroXpGain[] = []
  for (const u of battle.units) {
    if (u.team !== 'ally' || !u.heroId) continue
    const survived = u.alive
    const bonusXp = victoryXpBonus(battle.difficulty, battle.endlessWave, survived)
    awardHeroBattleXp(state, u, bonusXp)
    const owned = getHeroByUid(campaign, u.uid)
    const oldLevel = battle.heroStartLevelByUid[u.uid] ?? normalizeHeroLevel(owned?.level ?? u.level)
    const progress = heroLevelProgress(owned?.level ?? u.level, owned?.xp)
    heroXpGains.push({
      uid: u.uid,
      heroId: u.heroId,
      name: u.name,
      xpGained: battle.xpEarnedByHero[u.uid] ?? 0,
      oldLevel,
      newLevel: progress.level,
      levelsGained: Math.max(0, progress.level - oldLevel),
      currentXp: progress.xp,
      xpForNext: progress.xpForNext,
      isMaxLevel: progress.isMaxLevel,
      survived
    })
  }

  tickWorldMapEvents(campaign)

  const reward: BattleReward = {
    gold,
    bonusDust,
    bonusShards,
    difficultyTier: battle.difficultyTier,
    mutators: battle.mutators.slice(),
    equipCard,
    heroCard,
    tacticCard,
    stageId: chapter.id,
    chapterCleared: battle.chapterIndex,
    firstClear,
    specialRewardsClaimed,
    unlockedSlot4,
    campaignWon,
    ...(battle.abyssFloor !== undefined ? { abyssFloor: battle.abyssFloor } : {}),
    ...(abyssCompleted ? { abyssCompleted: true } : {}),
    ...(battle.gauntletMaxRounds ? { gauntletRoundsCleared: battle.gauntletMaxRounds } : {}),
    ...(worldEventPlan
      ? {
          worldEventId: worldEventPlan.eventId,
          worldEventKind: worldEventPlan.kind,
          worldEventTitle: worldEventPlan.title
        }
      : {}),
    heroXpGains,
    ...(masteryEarned !== undefined ? { masteryEarned } : {})
  }
  battle.reward = reward
  battle.bannerText = worldEventPlan
    ? `${worldEventPlan.title.toUpperCase()} CLEARED!`
    : abyssPlan
      ? (abyssCompleted ? 'CROWNLESS DEEP CONQUERED!' : `${formatAbyssFloorLabel(abyssPlan.floor).toUpperCase()} CLEARED!`)
      : 'VICTORY!'
  battle.bannerTimer = 3.0
}

/** World-space ground centres of grid cells (presentation hints for VFX events). */
function cellCentres(battle: BattleState, cells: readonly { col: number; row: number }[]): Vec3[] {
  const out: Vec3[] = []
  for (const c of cells) {
    const cell = battle.cells[c.row]?.[c.col]
    if (!cell || cell.terrain === 'void') continue
    out.push(gridToWorld(c.col, c.row, cell.elevation, battle.cols, battle.rows))
  }
  return out
}

/** The ally whose turn it is plays the 'command' gesture when a tactic card resolves. */
function tacticCasterUid(battle: BattleState): string | null {
  const active = getUnitByUid(battle, battle.activeUnitUid)
  return active && active.alive && active.team === 'ally' ? active.uid : null
}

function damageBarricade(
  state: GameState,
  attacker: BattleUnit | null,
  col: number,
  row: number,
  rawDamage: number
): number {
  const battle = state.battle
  if (!battle || !isCellInBounds(col, row, battle.cols, battle.rows)) return 0
  const cell = battle.cells[row][col]
  if (!isIntactBarricade(cell)) return 0

  const empoweredMul = attacker && attacker.empowerTurns > 0 ? 1.35 : 1
  const dmg = Math.max(4, Math.round(rawDamage * empoweredMul))
  const hpBefore = cell.barricadeHp ?? BARRICADE_DEFAULT_HP
  const hpAfter = Math.max(0, hpBefore - dmg)
  cell.barricadeHp = hpAfter

  const [tx, ty, tz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  addFloat(battle, tx, ty + 0.15, tz, `-${dmg}`, '#f5c678')
  state.vfx.push({ kind: 'burst', style: 'slash', at: [tx, ty + 0.55, tz], radius: 0.85 })
  state.sounds.push({ kind: 'hit', pitch: 0.78 })
  battle.shake = Math.max(battle.shake, 0.2)

  if (hpAfter <= 0) {
    const hLvl = cellHeightLevel(cell)
    cell.terrain = 'stone'
    cell.walkable = true
    cell.elevation = terrainElevation('stone', hLvl)
    cell.barricadeHp = 0
    cell.barricadeMaxHp = undefined
    addFloat(battle, tx, ty + 0.58, tz, 'SHATTERED!', '#ffd980')
    state.vfx.push({ kind: 'burst', style: 'gold', at: [tx, ty + 0.5, tz], radius: 1.35 })
    state.sounds.push({ kind: 'ko', pitch: 1.15 })
    battle.shake = Math.max(battle.shake, 0.34)
    appendCombatLog(
      battle,
      'hazard',
      formatHazardLog({ kind: 'barricade_smash', actorName: attacker?.name ?? null, damage: dmg })
    )
  } else {
    appendCombatLog(
      battle,
      'hazard',
      formatHazardLog({ kind: 'barricade_hit', actorName: attacker?.name ?? null, damage: dmg })
    )
  }
  return dmg
}

function executeBasicAttackOnBarricade(state: GameState, attacker: BattleUnit, col: number, row: number): void {
  const battle = state.battle
  if (!battle || !isCellInBounds(col, row, battle.cols, battle.rows)) return
  const cell = battle.cells[row][col]
  if (!isIntactBarricade(cell)) return

  battle.moveUndo = null
  const [tx, ty, tz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  faceToward(attacker, tx, tz)
  attacker.animState = 'attack'
  attacker.animTimer = 0.36
  attacker.acted = true

  const dx = tx - attacker.x
  const dz = tz - attacker.z
  const dist = Math.hypot(dx, dz) || 1
  if (attacker.range <= 1) {
    attacker.lungeX = (dx / dist) * 0.44
    attacker.lungeZ = (dz / dist) * 0.44
    state.sounds.push({ kind: 'slash' })
    state.vfx.push({ kind: 'burst', style: 'slash', at: [tx, ty + 0.65, tz], uid: attacker.uid })
  } else {
    const style = attacker.team === 'enemy'
      ? getEnemyProjectileStyle(attacker.enemyId)
      : attacker.heroId === 'archer' ? 'arrow'
      : attacker.heroId === 'cryomancer' ? 'frost'
      : attacker.heroId === 'cleric' ? 'holy'
      : 'arcane'
    state.sounds.push({ kind: style === 'arrow' ? 'arrow' : 'magic' })
    state.vfx.push({
      kind: 'projectile',
      style,
      from: [attacker.x, attacker.y + 0.95, attacker.z],
      to: [tx, ty + 0.65, tz],
      uid: attacker.uid
    })
  }

  damageBarricade(state, attacker, col, row, attacker.atk)
}

function executePincerFollowUp(state: GameState, attacker: BattleUnit, target: BattleUnit): number {
  const battle = state.battle
  if (!battle || !attacker.alive || !target.alive) return 0
  const assisters = findPincerAssisters(battle, attacker, attacker.col, attacker.row, target)
  if (assisters.length === 0) return 0

  let totalDealt = 0
  for (const assister of assisters) {
    if (!target.alive) break
    const rawDmg = computePincerAssistDamage(battle, assister, target)
    faceToward(assister, target.x, target.z)
    assister.animState = 'attack'
    assister.animTimer = 0.34
    const dx = target.x - assister.x
    const dz = target.z - assister.z
    const dist = Math.hypot(dx, dz) || 1
    assister.lungeX = (dx / dist) * 0.42
    assister.lungeZ = (dz / dist) * 0.42

    let finalDmg = rawDmg
    let absorbed = 0
    if (target.shield > 0) {
      absorbed = Math.min(target.shield, finalDmg)
      target.shield -= absorbed
      finalDmg -= absorbed
    }
    target.hp = Math.max(0, target.hp - finalDmg)
    target.hitFlash = 0.28
    target.animState = 'hit'
    target.animTimer = 0.30
    battle.shake = Math.max(battle.shake, 0.26)
    totalDealt += finalDmg

    addFloat(battle, target.x, target.y + 0.64, target.z, 'PINCER!', '#5ce1ff')
    appendCombatLog(
      battle,
      'reaction',
      formatReactionLog({
        kind: 'pincer',
        actorName: assister.name,
        targetName: target.name,
        hpDamage: finalDmg,
        absorbed
      })
    )
    if (finalDmg > 0) {
      addFloat(battle, target.x, target.y + 0.26, target.z, `-${finalDmg}`, '#ffe16b')
      state.sounds.push({ kind: 'slash', pitch: 1.25 })
      state.sounds.push({ kind: 'hit', pitch: 1.15 })
    } else if (absorbed > 0) {
      addFloat(battle, target.x, target.y + 0.26, target.z, `BLOCK ${absorbed}`, '#7ed9ff')
      state.sounds.push({ kind: 'shield' })
    }

    state.vfx.push({
      kind: 'pincer',
      attackerUid: attacker.uid,
      assisterUid: assister.uid,
      targetUid: target.uid,
      attackerPos: [attacker.x, attacker.y, attacker.z],
      assisterPos: [assister.x, assister.y, assister.z],
      targetPos: [target.x, target.y, target.z],
      damage: rawDmg
    })

    if (target.hp <= 0) {
      handleUnitDefeat(state, target)
      if (!target.alive) {
        triggerOnKoEffects(state, assister, target, { isSkillKill: false, rawHitDamage: rawDmg })
      }
    } else {
      triggerFrontierBossPhaseIfReady(state, target)
    }
    if (assister.team === 'ally' && target.team === 'enemy' && (finalDmg > 0 || absorbed > 0)) {
      const koBonus = !target.alive ? (target.isBoss ? XP_ACTION_BOSS_KO : XP_ACTION_KO) : 0
      awardHeroBattleXp(state, assister, XP_ACTION_DAMAGE + koBonus)
    }
  }
  return totalDealt
}

function executeCounterAttack(
  state: GameState,
  defender: BattleUnit,
  attacker: BattleUnit,
  paladinBonus?: { readonly counterMul: number; readonly shieldGain: number }
): number {
  const battle = state.battle
  if (!battle || !defender.alive || !attacker.alive) return 0

  faceToward(defender, attacker.x, attacker.z)
  defender.animState = 'attack'
  defender.animTimer = 0.34

  const dx = attacker.x - defender.x
  const dz = attacker.z - defender.z
  const dist = Math.hypot(dx, dz) || 1
  defender.lungeX = (dx / dist) * 0.42
  defender.lungeZ = (dz / dist) * 0.42

  state.sounds.push({ kind: 'slash', pitch: 1.12 })
  state.vfx.push({
    kind: 'burst',
    style: 'slash',
    at: [attacker.x, attacker.y + 0.75, attacker.z],
    uid: defender.uid
  })

  if (paladinBonus && paladinBonus.shieldGain > 0) {
    defender.shield += paladinBonus.shieldGain
    addFloat(battle, defender.x, defender.y + 0.68, defender.z, `AEGIS +${paladinBonus.shieldGain} SHD`, '#ffd15c')
    state.vfx.push({ kind: 'shield', at: [defender.x, defender.y + 0.5, defender.z] })
  }

  const calc = computeCounterDamage(battle, defender, attacker, {
    counterMul: paladinBonus?.counterMul
  })
  const absorbed = calc.shieldAbsorbed
  const hpDmg = calc.hpDamage
  attacker.shield = Math.max(0, attacker.shield - absorbed)
  attacker.hp = calc.attackerHpAfter

  state.vfx.push({
    kind: 'impact',
    uid: attacker.uid,
    attackerUid: defender.uid,
    arc: 'front',
    crit: false,
    blocked: hpDmg === 0 && absorbed > 0,
    absorbed,
    damage: hpDmg
  })
  attacker.hitFlash = 0.28
  attacker.animState = 'hit'
  attacker.animTimer = 0.30
  battle.shake = Math.max(battle.shake, 0.22)

  addFloat(battle, defender.x, defender.y + 0.46, defender.z, paladinBonus && paladinBonus.counterMul > 1 ? 'AEGIS COUNTER!' : 'COUNTER!', '#ff9f43')
  appendCombatLog(
    battle,
    'reaction',
    formatReactionLog({
      kind: 'counter',
      actorName: defender.name,
      targetName: attacker.name,
      hpDamage: hpDmg,
      absorbed,
      aegisBonus: Boolean(paladinBonus && paladinBonus.counterMul > 1)
    })
  )
  if (hpDmg > 0) {
    addFloat(battle, attacker.x, attacker.y + 0.12, attacker.z, `-${hpDmg}`, '#ff6b7a')
    state.sounds.push({ kind: 'hit', pitch: 1.06 })
    const counterDrain = defender.lifesteal + mutatorMeleeDrainBonus(battle, true)
    if (counterDrain > 0 && defender.alive) {
      const heal = Math.max(2, Math.round(hpDmg * counterDrain))
      defender.hp = Math.min(defender.maxHp, defender.hp + heal)
      addFloat(battle, defender.x, defender.y, defender.z, `+${heal}`, '#6effa8')
      appendCombatLog(
        battle,
        'heal',
        formatHealLog({ sourceName: defender.name, targetName: defender.name, healAmount: heal, sourceLabel: 'Lifesteal' })
      )
    }
  } else if (absorbed > 0) {
    addFloat(battle, attacker.x, attacker.y + 0.12, attacker.z, `BLOCK ${absorbed}`, '#7ed9ff')
    state.sounds.push({ kind: 'shield' })
  }

  if (attacker.hp <= 0) {
    handleUnitDefeat(state, attacker)
    if (!attacker.alive) {
      triggerOnKoEffects(state, defender, attacker, { isSkillKill: false, rawHitDamage: calc.normalDmg })
    }
  } else {
    triggerFrontierBossPhaseIfReady(state, attacker)
  }
  if (defender.team === 'ally' && attacker.team === 'enemy' && (hpDmg > 0 || absorbed > 0)) {
    const koBonus = !attacker.alive ? (attacker.isBoss ? XP_ACTION_BOSS_KO : XP_ACTION_KO) : 0
    awardHeroBattleXp(state, defender, XP_ACTION_DAMAGE + koBonus)
  }
  checkBattleOutcome(state)

  if (!isBattleEnded(battle) && !attacker.alive && attacker.uid === battle.activeUnitUid && battle.phase === 'player') {
    battle.pendingAction = null
    battle.armedSkillIndex = null
    battle.armedTacticUid = null
    battle.moveUndo = null
    battle.facingPicker = null
    battle.objective.roundsElapsed += 1
    applyRoundBoundaryMutators(state)
    if (isBattleEnded(battle)) return calc.normalDmg
    advanceToNextUnitTurn(state)
  }

  return calc.normalDmg
}

function executeBasicAttack(state: GameState, attacker: BattleUnit, target: BattleUnit): void {
  const battle = state.battle
  if (!battle) return
  battle.moveUndo = null
  const hitCell = closestFootprintCell(attacker.col, attacker.row, target)
  const attackArc = computeAttackArc(attacker.col, attacker.row, hitCell.col, hitCell.row, target.facing)
  const isRanged = attacker.range > 1 || distanceBetweenUnits(attacker, target) !== 1
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
    const style = attacker.team === 'enemy'
      ? getEnemyProjectileStyle(attacker.enemyId)
      : attacker.heroId === 'archer' ? 'arrow'
      : attacker.heroId === 'cryomancer' ? 'frost'
      : attacker.heroId === 'cleric' ? 'holy'
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

  const archMul = attacker.team === 'enemy' ? computeEnemyArchetypeDamageMul(attacker, target) : 1
  if (archMul > 1) {
    addFloat(battle, target.x, target.y + 0.62, target.z, 'FROSTBITE!', '#80e8ff')
  }
  const basicElement = inferBasicAttackElement(attacker)
  const dmgRes = applyDamageDetailed(state, attacker, target, attacker.atk * archMul, 0, true, false, undefined, !isRanged, basicElement)
  // Frostguard Plate (`frostguard_plate`): chills adjacent melee attackers with slowTurns = 1
  if (!isRanged && attacker.alive && attacker.team !== target.team && shouldChillMeleeAttacker(target)) {
    attacker.slowTurns = Math.max(attacker.slowTurns, 1)
    addFloat(battle, attacker.x, attacker.y + 0.55, attacker.z, 'CHILLED!', '#7fdfff')
    appendCombatLog(
      battle,
      'status',
      formatStatusLog({ targetName: attacker.name, status: 'slow', phase: 'apply', sourceName: target.name })
    )
    state.vfx.push({ kind: 'burst', style: 'frost', at: [attacker.x, attacker.y + 0.65, attacker.z], radius: 0.75 })
  }
  if (attacker.team === 'enemy') {
    const atkElement = getEnemyAttackElement(attacker.enemyId)
    if (atkElement) {
      triggerElementalCombo(state, attacker, atkElement, target.alive ? target : null, target.col, target.row, handleUnitDefeat)
    }
  }
  if (target.alive) {
    if (attacker.team === 'ally') {
      applyEquipmentOnHitStatus(battle, attacker, target)
    } else {
      const enemyStatus = getEnemyBasicAttackStatus(attacker.enemyId)
      if (enemyStatus) {
        applyStatus(battle, target, enemyStatus.status, enemyStatus.stacks)
      }
    }
    executePincerFollowUp(state, attacker, target)
  }
  if (canCounterAttack(battle, attacker, target, attackArc, isRanged)) {
    const palBonus = computePaladinCounterBonus(target, attackArc, dmgRes.absorbed)
    executeCounterAttack(state, target, attacker, palBonus)
  }
  checkBattleOutcome(state)
  advanceTurnIfActiveHeroDowned(state)
}

function advanceTurnIfActiveHeroDowned(state: GameState): void {
  const battle = state.battle
  if (!battle || isBattleEnded(battle) || battle.phase !== 'player') return
  const curActive = battle.units.find(u => u.uid === battle.activeUnitUid)
  if (!curActive || !curActive.alive) {
    battle.pendingAction = null
    battle.armedSkillIndex = null
    battle.armedTacticUid = null
    battle.moveUndo = null
    battle.oaTriggeredUids = []
    battle.facingPicker = null
    battle.objective.roundsElapsed += 1
    applyRoundBoundaryMutators(state)
    advanceToNextUnitTurn(state)
  }
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
  battle.moveUndo = null

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
  if (caster.team === 'ally' && (skillIndex === 2 || skill.tier === 3)) {
    state.vfx.push({
      kind: 'camera_cue',
      cue: 'ultimate',
      at: [(caster.x + tx) * 0.5, (caster.y + ty) * 0.5, (caster.z + tz) * 0.5]
    })
  }
  let hitAny = false
  let supportXp = 0

  if (skill.target === 'self') {
    for (const c of affected) {
      const downed = skill.canRevive ? downedHeroAt(battle, c.col, c.row) : undefined
      if (downed && downed.team === caster.team) {
        if (reviveHero(state, downed, computeReviveHp(downed, skill.reviveHpRatio), skill.shieldAmount, caster.name, skill.name)) {
          supportXp += XP_ACTION_REVIVE
        }
        if (skill.status && isBeneficialStatus(skill.status)) applyStatus(battle, downed, skill.status, skill.statusStacks)
        hitAny = true
        continue
      }
      const ally = unitAt(battle, c.col, c.row)
      if (!ally || ally.team !== caster.team) continue
      applyHealAndShield(state, ally, skill.healAmount, skill.shieldAmount, caster, { sourceLabel: skill.name })
      if (skill.healAmount > 0 || skill.shieldAmount > 0) supportXp += XP_ACTION_SUPPORT
      if (skill.status && isBeneficialStatus(skill.status)) applyStatus(battle, ally, skill.status, skill.statusStacks)
      hitAny = true
    }
    if (skill.selfStatus) applyStatus(battle, caster, skill.selfStatus, skill.statusStacks)
  } else if (skill.target === 'ally') {
    // Support skill can be cast on any tile in range (revives downed allies if capable, heals/shields living units, or whiffs on empty space!)
    for (const c of affected) {
      const downed = skill.canRevive ? downedHeroAt(battle, c.col, c.row) : undefined
      if (downed && downed.team === caster.team) {
        if (reviveHero(state, downed, computeReviveHp(downed, skill.reviveHpRatio), skill.shieldAmount, caster.name, skill.name)) {
          supportXp += XP_ACTION_REVIVE
        }
        if (skill.status && isBeneficialStatus(skill.status)) applyStatus(battle, downed, skill.status, skill.statusStacks)
        hitAny = true
        continue
      }
      const unit = unitAt(battle, c.col, c.row)
      if (!unit) continue
      applyHealAndShield(state, unit, skill.healAmount, skill.shieldAmount, caster, { sourceLabel: skill.name })
      if (unit.team === caster.team && (skill.healAmount > 0 || skill.shieldAmount > 0)) supportXp += XP_ACTION_SUPPORT
      if (skill.status && isBeneficialStatus(skill.status)) applyStatus(battle, unit, skill.status, skill.statusStacks)
      hitAny = true
    }
    if (skill.selfStatus) applyStatus(battle, caster, skill.selfStatus, skill.statusStacks)
  } else {
    // Offensive skill: can target empty spaces AND allies (friendly fire!)
    const directTarget = skill.canRevive ? unitOrDownedAt(battle, col, row) : unitAt(battle, col, row)
    const isDawnsJudgmentSafe = skill.id === 'dawns_judgment' && (!directTarget || directTarget.team !== caster.team || isUnitDowned(directTarget))
    const skillAllowsCounter = isMeleeSkillEligibleForCounter(skill)
    let counterCandidate: { target: BattleUnit; arc: AttackArc; absorbed: number } | null = null
    if (skill.shieldAmount > 0 && skill.pattern !== 'aura') {
      applyHealAndShield(state, caster, 0, skill.shieldAmount, caster, { sourceLabel: skill.name })
    }
    if (skill.healAmount > 0 && skill.pattern === 'single') {
      applyHealAndShield(state, caster, skill.healAmount, 0, caster, { sourceLabel: skill.name })
    }
    const displaceTargets: BattleUnit[] = []
    const hitTargetUids = new Set<string>()
    const skillElement = skill.powerMul > 0 ? classifyElement(skill) : null
    for (const c of affected) {
      if (isDawnsJudgmentSafe && skill.canRevive) {
        const downed = downedHeroAt(battle, c.col, c.row)
        if (downed && downed.team === caster.team) {
          if (reviveHero(state, downed, computeReviveHp(downed, skill.reviveHpRatio), skill.shieldAmount, caster.name, skill.name)) {
            supportXp += XP_ACTION_REVIVE
          }
          hitAny = true
          continue
        }
      }
      const target = unitAt(battle, c.col, c.row)
      if (!target) {
        if (skill.powerMul > 0 && isIntactBarricade(battle.cells[c.row][c.col])) {
          const raw = caster.atk * skill.powerMul + skill.flatBonus
          damageBarricade(state, caster, c.col, c.row, raw)
          hitAny = true
        } else if (skillElement) {
          const terrainCombo = triggerElementalCombo(state, caster, skillElement, null, c.col, c.row, handleUnitDefeat)
          if (terrainCombo) hitAny = true
        }
        continue
      }
      // Deduplicate multi-tile raid bosses so overlapping AoE cells hit each unit at most once per cast
      if (hitTargetUids.has(target.uid)) continue
      hitTargetUids.add(target.uid)
      // Don't self-hit from splash around an adjacent tile unless caster directly targeted own space
      if (target.uid === caster.uid && !(col === caster.col && row === caster.row)) continue
      if (isDawnsJudgmentSafe && target.team === caster.team) {
        applyHealAndShield(state, target, skill.healAmount, skill.shieldAmount, caster, { sourceLabel: skill.name })
        if (skill.healAmount > 0 || skill.shieldAmount > 0) supportXp += XP_ACTION_SUPPORT
        hitAny = true
        continue
      }
      if (skill.powerMul > 0) {
        const hitArc = computeAttackArc(caster.col, caster.row, c.col, c.row, target.facing)
        const raw = caster.atk * skill.powerMul + skill.flatBonus
        const skillIsMelee = skill.range <= 1 && distanceBetweenUnits(caster, target) === 1
        const dmgRes = applyDamageDetailed(state, caster, target, raw, skill.ignoreArmor, true, true, { skillName: skill.name }, skillIsMelee, skillElement)
        // Frostguard Plate chills adjacent melee skill attackers
        if (
          skillIsMelee &&
          caster.alive &&
          caster.team !== target.team &&
          shouldChillMeleeAttacker(target)
        ) {
          caster.slowTurns = Math.max(caster.slowTurns, 1)
          addFloat(battle, caster.x, caster.y + 0.55, caster.z, 'CHILLED!', '#7fdfff')
          appendCombatLog(
            battle,
            'status',
            formatStatusLog({ targetName: caster.name, status: 'slow', phase: 'apply', sourceName: target.name })
          )
          state.vfx.push({ kind: 'burst', style: 'frost', at: [caster.x, caster.y + 0.65, caster.z], radius: 0.75 })
        }
        const aliveAfterDirect = target.alive
        if (skillElement) {
          triggerElementalCombo(state, caster, skillElement, target.alive ? target : null, c.col, c.row, handleUnitDefeat)
          if (aliveAfterDirect && !target.alive) {
            triggerOnKoEffects(state, caster, target, { isSkillKill: true, rawHitDamage: dmgRes.rolledDamage })
          }
        }
        if (target.alive) {
          if (skill.status && !isBeneficialStatus(skill.status)) {
            applyStatus(battle, target, skill.status, skill.statusStacks)
          }
          if (caster.team === 'ally') {
            applyEquipmentOnHitStatus(battle, caster, target)
          }
          if (target.team !== caster.team && isPincerMeleeSkill(skill)) {
            executePincerFollowUp(state, caster, target)
          }
          if (target.alive && skill.displacement && target.uid !== caster.uid) {
            if (skill.displacement.kind !== 'swap' || (c.col === col && c.row === row)) {
              displaceTargets.push(target)
            }
          }
          if (target.alive && skillAllowsCounter && target.team !== caster.team && !counterCandidate) {
            counterCandidate = { target, arc: hitArc, absorbed: dmgRes.absorbed }
          }
        }
        hitAny = true
      }
    }
    if (skill.displacement && displaceTargets.length > 0) {
      const ordered = orderDisplacementTargets(displaceTargets, caster.col, caster.row, skill.displacement.kind)
      for (const dt of ordered) {
        if (!dt.alive) continue
        applyDisplacement(state, caster, dt, skill.displacement)
        if (dt.alive) checkTileObjectiveInteractions(state, dt)
        if (skill.displacement.kind === 'swap') {
          if (caster.alive) checkTileObjectiveInteractions(state, caster)
          break
        }
      }
    }
    if (skill.status && isBeneficialStatus(skill.status)) applyStatus(battle, caster, skill.status, skill.statusStacks)
    if (skill.selfStatus) applyStatus(battle, caster, skill.selfStatus, skill.statusStacks)
    if (
      counterCandidate &&
      canCounterAttack(battle, caster, counterCandidate.target, counterCandidate.arc, false)
    ) {
      const palBonus = computePaladinCounterBonus(counterCandidate.target, counterCandidate.arc, counterCandidate.absorbed)
      executeCounterAttack(state, counterCandidate.target, caster, palBonus)
    }
  }

  if (supportXp > 0 && caster.team === 'ally') {
    awardHeroBattleXp(state, caster, supportXp)
  }

  if (!hitAny) {
    addFloat(battle, tx, ty + 0.1, tz, 'NO TARGET', '#b8c7e6')
    appendCombatLog(battle, 'attack', `${caster.name} casts ${skill.name} — no target`)
  }

  checkBattleOutcome(state)
  advanceTurnIfActiveHeroDowned(state)
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
  battle.tacticsPlayed += 1
  battle.armedTacticUid = null
  battle.moveUndo = null
  state.sounds.push({ kind: 'card' })

  const tacticActor = getUnitByUid(battle, battle.activeUnitUid) ?? null
  appendCombatLog(
    battle,
    'system',
    `${tacticActor ? `${tacticActor.name} plays` : 'Played'} Tactic: ${spec.name} (${spec.cost} AP${spec.apGain > 0 ? `, +${spec.apGain} AP` : ''})`
  )

  const cell = battle.cells[row][col]
  const [tx, ty, tz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)

  if (spec.pattern === 'all_allies') {
    for (const u of battle.units) {
      if (u.team !== 'ally') continue
      if (spec.canRevive && isUnitDowned(u)) {
        reviveHero(state, u, computeReviveHp(u, spec.reviveHpRatio), spec.shield, tacticActor?.name ?? null, spec.name)
        if (spec.status && isBeneficialStatus(spec.status)) applyStatus(battle, u, spec.status, spec.statusStacks)
        continue
      }
      if (!u.alive) continue
      applyHealAndShield(state, u, spec.heal, spec.shield, null, { sourceLabel: spec.name })
      if (spec.status) applyStatus(battle, u, spec.status, spec.statusStacks)
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
    const displaceTargets: BattleUnit[] = []
    const hitTargetUids = new Set<string>()
    const tacticElement = spec.damage > 0 ? classifyElement(spec) : null
    for (const c of cells) {
      if (spec.canRevive) {
        const downed = downedHeroAt(battle, c.col, c.row)
        if (downed && downed.team === 'ally') {
          reviveHero(state, downed, computeReviveHp(downed, spec.reviveHpRatio), spec.shield, tacticActor?.name ?? null, spec.name)
          if (spec.status && isBeneficialStatus(spec.status)) applyStatus(battle, downed, spec.status, spec.statusStacks)
          continue
        }
      }
      const target = unitAt(battle, c.col, c.row)
      if (!target) {
        if (spec.damage > 0 && isIntactBarricade(battle.cells[c.row][c.col])) {
          damageBarricade(state, null, c.col, c.row, spec.damage)
        } else if (tacticElement) {
          triggerElementalCombo(state, tacticActor, tacticElement, null, c.col, c.row, handleUnitDefeat)
        }
        continue
      }
      if (hitTargetUids.has(target.uid)) continue
      hitTargetUids.add(target.uid)
      if (target.team === 'enemy') {
        if (spec.damage > 0) {
          applyDamage(state, null, target, spec.damage, 0.6, false, true, { skillName: spec.name }, undefined, tacticElement)
        }
        if (tacticElement) {
          triggerElementalCombo(state, tacticActor, tacticElement, target.alive ? target : null, c.col, c.row, handleUnitDefeat)
        }
        if (spec.status && !isBeneficialStatus(spec.status) && target.alive) {
          applyStatus(battle, target, spec.status, spec.statusStacks)
        }
        if (spec.displacement && target.alive) {
          displaceTargets.push(target)
        }
      }
      if (target.team === 'ally') {
        if (spec.heal > 0 || spec.shield > 0) applyHealAndShield(state, target, spec.heal, spec.shield, null, { sourceLabel: spec.name })
        if (spec.status && isBeneficialStatus(spec.status)) applyStatus(battle, target, spec.status, spec.statusStacks)
        if (spec.refreshMove) {
          target.moved = false
          addFloat(battle, target.x, target.y + 0.55, target.z, 'MOVE +1', '#8ef5ff')
        }
      }
    }
    if (spec.displacement && displaceTargets.length > 0) {
      const originC = tacticActor ? tacticActor.col : col
      const originR = tacticActor ? tacticActor.row : row
      const ordered = orderDisplacementTargets(displaceTargets, originC, originR, spec.displacement.kind)
      for (const dt of ordered) {
        if (!dt.alive) continue
        applyDisplacement(state, tacticActor, dt, spec.displacement)
        if (dt.alive) checkTileObjectiveInteractions(state, dt)
        if (spec.displacement.kind === 'swap') {
          if (tacticActor && tacticActor.alive) checkTileObjectiveInteractions(state, tacticActor)
          break
        }
      }
    }
  }

  checkBattleOutcome(state)
  advanceTurnIfActiveHeroDowned(state)
  refreshHighlights(battle, state.campaign)
  return true
}

export function selectHeroByUid(state: GameState, uid: string): boolean {
  const battle = state.battle
  if (!battle) return false
  const unit = getUnitByUid(battle, uid)
  if (!unit) return false
  if (battle.facingPicker) cancelWaitFacingPicker(state)
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
  if (battle.autoBattle) battle.autoBattle = false
  if (battle.facingPicker) cancelWaitFacingPicker(state)
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
  if (battle.autoBattle) battle.autoBattle = false
  if (battle.facingPicker) cancelWaitFacingPicker(state)
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
  if (!battle || !isCellInBounds(col, row, battle.cols, battle.rows)) return false

  // Pre-Battle Deployment Phase: select ally, move to open blue deploy tile, or swap with another ally!
  if (battle.phase === 'deploy') {
    const clicked = unitAt(battle, col, row)
    const selected = getUnitByUid(battle, battle.selectedUnitUid)
    const selectedAlly = selected && selected.team === 'ally' ? selected : null

    if (isDeployTile(battle, col, row)) {
      if (selectedAlly) {
        if (clicked && clicked.uid === selectedAlly.uid) {
          battle.selectedUnitUid = null
          state.sounds.push({ kind: 'card', pitch: 0.95 })
          return true
        }
        if (clicked && clicked.team === 'ally') {
          const swapped = swapDeployUnit(state, selectedAlly.uid, clicked.uid)
          if (swapped) battle.selectedUnitUid = null
          return swapped
        }
        if (!clicked) {
          return moveDeployUnit(state, selectedAlly.uid, col, row)
        }
      }
      if (clicked && clicked.team === 'ally') {
        battle.selectedUnitUid = clicked.uid
        state.sounds.push({ kind: 'card', pitch: 1.15 })
        return true
      }
      return false
    }

    // Allow inspecting visible enemies on the board during deployment without allowing placement outside deployTiles
    if (clicked && clicked.team === 'enemy' && !isEnemyShrouded(battle, clicked)) {
      battle.selectedUnitUid = clicked.uid
      state.sounds.push({ kind: 'card', pitch: 1.05 })
      return true
    }
    return false
  }

  if (battle.phase !== 'player') {
    if (battle.phase === 'enemy' && battle.autoBattle) {
      battle.autoBattle = false
    }
    return false
  }
  if (battle.autoBattle) battle.autoBattle = false
  if (battle.facingPicker) return false

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
        battle.moveUndo = null
        battle.oaTriggeredUids = []
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

  // 3. Click on a highlighted target enemy or intact barricade -> Basic Attack or Move+Attack by active hero!
  const clickedUnit = unitAt(battle, col, row)
  const clickedBarricade = !clickedUnit && isIntactBarricade(battle.cells[row][col])
  if (active && ((clickedUnit && clickedUnit.team === 'enemy') || clickedBarricade)) {
    const inRange = battle.targetTiles.some(t => t.col === col && t.row === row)
    if (inRange) {
      if (clickedUnit) executeBasicAttack(state, active, clickedUnit)
      else executeBasicAttackOnBarricade(state, active, col, row)
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
        battle.moveUndo = null
        battle.oaTriggeredUids = []
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
        battle.moveUndo = {
          uid: active.uid,
          col: active.col,
          row: active.row,
          x: active.x,
          y: active.y,
          z: active.z,
          facing: active.facing,
          yaw: active.yaw
        }
        active.path = path
        active.moveProgress = 0
        active.moved = true
        active.animState = 'run'
        battle.selectedUnitUid = active.uid
        battle.oaTriggeredUids = []
        battle.pendingAction = null
        battle.moveTiles = []
        battle.targetTiles = []
        battle.moveAttackTiles = []
        state.sounds.push({ kind: 'step' })
        return true
      }
    }
  }

  // 5. Click any visible unit to inspect them on the HUD without losing the active hero's turn
  if (clickedUnit && !isEnemyShrouded(battle, clickedUnit)) {
    return selectHeroByUid(state, clickedUnit.uid)
  }

  return false
}

/** Lock out Undo Move (e.g., when a trap/reveal/shrine or irreversible combat action occurs). */
export function lockMoveUndo(battle: BattleState | null | undefined): void {
  if (battle) battle.moveUndo = null
}

/** True when the active player hero has moved this turn and can still snap back cleanly. */
export function canUndoMove(battle: BattleState | null | undefined): boolean {
  if (!battle || battle.phase !== 'player') return false
  const undo = battle.moveUndo
  if (!undo || battle.pendingAction !== null) return false
  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (!active || active.team !== 'ally' || !active.alive) return false
  if (active.uid !== undo.uid || !active.moved || active.acted) return false
  const occ = unitOrDownedAt(battle, undo.col, undo.row)
  if (occ && occ.uid !== active.uid) return false
  const standingCell = battle.cells[active.row]?.[active.col]
  if (
    (active.col !== undo.col || active.row !== undo.row) &&
    standingCell &&
    (
      standingCell.terrain === 'shrine' ||
      (standingCell.terrain === 'lava_geyser' && standingCell.geyserActive) ||
      (standingCell.terrain === 'cursed_altar' && standingCell.altarUsed)
    )
  ) {
    return false
  }
  return true
}

/**
 * Snap the active hero back to their turn-start tile & facing, refunding movement and
 * recomputing full moveTiles & targetTiles while clearing any pending walk animation.
 */
export function undoMove(state: GameState): boolean {
  const battle = state.battle
  if (!battle || !canUndoMove(battle)) return false
  if (battle.autoBattle) battle.autoBattle = false
  const undo = battle.moveUndo
  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (!undo || !active) return false

  active.col = undo.col
  active.row = undo.row
  active.x = undo.x
  active.y = undo.y
  active.z = undo.z
  active.facing = undo.facing
  active.yaw = undo.yaw
  active.path = []
  active.moveProgress = 0
  active.moved = false
  active.animState = 'idle'
  active.animTimer = 0
  active.lungeX = 0
  active.lungeZ = 0

  battle.moveUndo = null
  battle.oaTriggeredUids = []
  battle.facingPicker = null
  battle.pendingAction = null
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  battle.selectedUnitUid = active.uid
  refreshHighlights(battle, state.campaign)
  state.sounds.push({ kind: 'card', pitch: 0.92 })
  return true
}

function isBattleEnded(battle: BattleState): boolean {
  return battle.phase === 'victory' || battle.phase === 'defeat'
}

/**
 * Trigger Opportunity Attacks from any opposing ZoC sentinels adjacent to `(mover.col, mover.row)`
 * right as `mover` begins leaving that tile toward `(nextCol, nextRow)`.
 * Each sentinel triggers at most once per movement action. Locks Undo Move on player triggers.
 */
function triggerLeavingZocOpportunityAttacks(
  state: GameState,
  mover: BattleUnit,
  nextCol: number,
  nextRow: number
): void {
  const battle = state.battle
  if (!battle || !mover.alive) return
  const already = new Set<string>(battle.oaTriggeredUids)
  const sentinels = findStepOpportunityAttackers(battle, mover, mover.col, mover.row, already)
  if (sentinels.length === 0) return

  for (const sentinel of sentinels) {
    if (!mover.alive || isBattleEnded(battle)) break
    battle.oaTriggeredUids.push(sentinel.uid)
    if (mover.team === 'ally' && battle.phase === 'player') {
      battle.moveUndo = null
    }

    faceToward(sentinel, mover.x, mover.z)
    sentinel.animState = 'attack'
    sentinel.animTimer = 0.34
    const dx = mover.x - sentinel.x
    const dz = mover.z - sentinel.z
    const dist = Math.hypot(dx, dz) || 1
    sentinel.lungeX = (dx / dist) * 0.42
    sentinel.lungeZ = (dz / dist) * 0.42

    state.sounds.push({ kind: 'slash', pitch: 1.16 })
    state.vfx.push({ kind: 'burst', style: 'slash', at: [mover.x, mover.y + 0.75, mover.z], uid: sentinel.uid })
    addFloat(battle, mover.x, mover.y + 0.72, mover.z, 'OPPORTUNITY!', '#ffaa33')

    const oaRes = applyDamageDetailed(state, sentinel, mover, sentinel.atk * OPPORTUNITY_ATTACK_DAMAGE_MUL, 0, false, false, { suppressLog: true })
    appendCombatLog(
      battle,
      'reaction',
      formatReactionLog({
        kind: 'opportunity',
        actorName: sentinel.name,
        targetName: mover.name,
        hpDamage: oaRes.hpDamage,
        absorbed: oaRes.absorbed
      })
    )
    if (!mover.alive) {
      // If mover was stepping through an ally's tile when downed, avoid stacking two units on one cell
      const stacked = battle.units.some(
        o => o.uid !== mover.uid && (o.alive || isUnitDowned(o)) && o.col === mover.col && o.row === mover.row
      )
      if (stacked && isCellInBounds(nextCol, nextRow, battle.cols, battle.rows) && !unitOrDownedAt(battle, nextCol, nextRow)) {
        const nextCell = battle.cells[nextRow][nextCol]
        const [nx, ny, nz] = gridToWorld(nextCol, nextRow, nextCell.elevation, battle.cols, battle.rows)
        mover.col = nextCol
        mover.row = nextRow
        mover.x = nx
        mover.y = ny
        mover.z = nz
      }
      mover.path = []
      battle.pendingAction = null
      checkBattleOutcome(state)
      break
    }
  }
}

function applyLavaGeyserHazard(state: GameState, unit: BattleUnit, cell: GridCell): void {
  const battle = state.battle
  if (!battle || !unit.alive || cell.terrain !== 'lava_geyser' || !cell.geyserActive) return
  if (unit.team === 'ally' && battle.phase === 'player') {
    battle.moveUndo = null
  }
  const [tx, ty, tz] = gridToWorld(cell.col, cell.row, cell.elevation, battle.cols, battle.rows)
  state.vfx.push({ kind: 'burst', style: 'fire', at: [tx, ty + 0.4, tz], radius: 0.95 })
  addFloat(battle, unit.x, unit.y + 0.45, unit.z, 'GEYSER!', '#ff7a38')
  const geyserRes = applyDamageDetailed(state, null, unit, LAVA_GEYSER_DAMAGE, 0.5, false, false, { suppressLog: true })
  appendCombatLog(
    battle,
    'hazard',
    formatHazardLog({ kind: 'lava_geyser', targetName: unit.name, damage: geyserRes.hpDamage, absorbed: geyserRes.absorbed })
  )
  if (unit.alive) {
    triggerElementalCombo(state, null, classifyHazardElement(cell.terrain), unit, cell.col, cell.row, handleUnitDefeat)
  }
  if (unit.alive) {
    applyStatus(battle, unit, 'burn')
  } else {
    unit.path = []
    battle.pendingAction = null
    checkBattleOutcome(state)
  }
}

function triggerStepOnHazard(state: GameState, unit: BattleUnit, cell: GridCell): void {
  const battle = state.battle
  if (!battle || !unit.alive) return
  if (unit.team === 'ally' && battle.phase === 'player' && cell.terrain === 'shrine') {
    battle.moveUndo = null
  }
  if (cell.terrain === 'lava_geyser' && cell.geyserActive) {
    applyLavaGeyserHazard(state, unit, cell)
    return
  }
  if (cell.terrain === 'cursed_altar' && !cell.altarUsed) {
    cell.altarUsed = true
    if (unit.team === 'ally' && battle.phase === 'player') {
      battle.moveUndo = null
    }
    const hpDrain = Math.min(CURSED_ALTAR_HP_COST, Math.max(0, unit.hp - 1))
    if (hpDrain > 0) {
      unit.hp -= hpDrain
      addFloat(battle, unit.x, unit.y, unit.z, `-${hpDrain} HP`, '#d45eff')
    }
    unit.empowerTurns += 2
    if (unit.team === 'ally') {
      battle.ap = Math.min(battle.maxAp, battle.ap + 1)
    }
    const [tx, ty, tz] = gridToWorld(cell.col, cell.row, cell.elevation, battle.cols, battle.rows)
    state.vfx.push({ kind: 'burst', style: 'shadow', at: [tx, ty + 0.65, tz], radius: 1.15 })
    state.sounds.push({ kind: 'magic', pitch: 0.78 })
    addFloat(
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
    return
  }
  if (cell.terrain === 'ice') {
    const [tx, ty, tz] = gridToWorld(cell.col, cell.row, cell.elevation, battle.cols, battle.rows)
    state.vfx.push({ kind: 'burst', style: 'frost', at: [tx, ty + 0.16, tz], radius: 0.45 })
  }
}

/** Trigger multi-phase raid boss awakening (e.g. Unbroken Crown Phase 1 -> Phase 2 at <= 50% HP). */
function triggerFrontierBossPhaseIfReady(state: GameState, boss: BattleUnit): void {
  const battle = state.battle
  if (!battle || !shouldTriggerUnbrokenCrownPhase2(boss)) return
  const result = applyFrontierBossPhaseTransition(boss)
  if (!result.triggered) return

  const cfg = getUnbrokenCrownPhase2Config()
  battle.bannerText = result.bannerText
  battle.bannerTimer = 2.0
  battle.shake = Math.max(battle.shake, 0.55)
  state.sounds.push({ kind: 'magic', pitch: 0.68 })
  addFloat(battle, boss.x, boss.y + 0.72, boss.z, 'PHASE 2: SOLAR ECLIPSE!', '#ffe078')
  addFloat(battle, boss.x, boss.y + 0.35, boss.z, `+${result.shieldGain} SHIELD`, '#7ed9ff')
  state.vfx.push({
    kind: 'special',
    uid: boss.uid,
    move: 'eclipse_nova',
    at: [boss.x, boss.y, boss.z],
    cells: [[boss.x, boss.y, boss.z]]
  })
  state.vfx.push({
    kind: 'camera_cue',
    cue: 'boss_special',
    at: [boss.x, boss.y, boss.z]
  })
  appendCombatLog(
    battle,
    'system',
    `${boss.name} enters Phase 2 (${result.bannerText}) — +${result.shieldGain} Shield, cleansed, Empowered!`,
    { accentHex: '#ffd166' }
  )

  const summonTiles = findFrontierSummonTiles(battle, boss, cfg.summonCount)
  for (const tile of summonTiles) {
    const guard = createSummonedEnemyUnit(battle, boss, cfg.summonArchetype, tile.col, tile.row)
    battle.units.push(guard)
    discoverEnemyInCodex(state.campaign, guard.enemyId)
    state.vfx.push({ kind: 'burst', style: 'gold', at: [guard.x, guard.y + 0.55, guard.z], radius: 0.85, uid: boss.uid })
    addFloat(battle, guard.x, guard.y + 0.4, guard.z, 'SOLAR VANGUARD!', '#ffd166')
  }
  battle.turnOrder = computeTurnOrderPreview(battle, 8)
}

/** Apply round-boundary frontier biome hazards (Sandstorm Gusts, Lightning Conduits, Astral Rift Pulses). */
function applyRoundBoundaryFrontierHazards(state: GameState): void {
  const battle = state.battle
  if (!battle || isBattleEnded(battle)) return
  if (!isFrontierBiome(battle.biome)) return

  const evalResult = evaluateFrontierRoundHazard(battle, battle.objective.roundsElapsed)
  if (!evalResult.triggered || evalResult.strikes.length === 0) return

  battle.bannerText = evalResult.bannerText
  battle.bannerTimer = 1.45
  battle.shake = Math.max(battle.shake, 0.24)
  state.sounds.push({ kind: evalResult.kind === 'lightning_conduit' ? 'magic' : 'hit', pitch: 0.92 })

  for (const strike of evalResult.strikes) {
    const target = getUnitByUid(battle, strike.unitUid)
    if (!target || !target.alive) continue
    const cell = battle.cells[target.row]?.[target.col]
    const [cx, cy, cz] = gridToWorld(target.col, target.row, cell?.elevation ?? target.y, battle.cols, battle.rows)
    state.vfx.push({ kind: 'burst', style: strike.vfxStyle, at: [cx, cy + 0.55, cz], radius: 0.78 })
    addFloat(battle, target.x, target.y + 0.52, target.z, strike.label, '#ffd166')
    applyDamageDetailed(state, null, target, strike.damage, 1, false, false, {
      skillName: evalResult.label
    })
    if (target.alive && strike.status) {
      applyStatus(battle, target, strike.status)
    }
  }
  checkBattleOutcome(state)
}

/** Apply round-boundary stage mechanics, frontier hazards & tactical mutator effects. */
function applyRoundBoundaryMutators(state: GameState): void {
  const battle = state.battle
  if (!battle || isBattleEnded(battle)) return
  applyAct1StageRoundBoundary(state)
  checkBattleOutcome(state)
  if (isBattleEnded(battle)) return
  applyRoundBoundaryFrontierHazards(state)
  if (isBattleEnded(battle) || battle.mutators.length === 0) return

  if (hasMutator(battle, 'arcane_surge')) {
    for (const u of battle.units) {
      if (!u.alive || u.team !== 'enemy') continue
      for (let i = 0; i < 3; i++) {
        if (u.cooldowns[i] > 0) {
          u.cooldowns[i] = Math.max(0, u.cooldowns[i] - ARCANE_SURGE_EXTRA_CD_TICK)
        }
      }
    }
  }

  if (hasMutator(battle, 'venom_mist')) {
    for (const u of battle.units) {
      if (!u.alive) continue
      const cell = battle.cells[u.row]?.[u.col]
      if (cell && cell.terrain === 'shrine') continue
      applyStatus(battle, u, 'poison', VENOM_MIST_POISON_STACKS)
    }
  }
}

function advanceToNextUnitTurn(state: GameState, initial = false): void {
  const battle = state.battle
  if (!battle || isBattleEnded(battle)) return

  let guard = 0
  while (guard++ < 400) {
    checkBattleOutcome(state)
    if (isBattleEnded(battle)) return

    const clockUnits = battle.units.filter(u => u.alive || isUnitDowned(u))
    if (!clockUnits.some(u => u.alive)) return

    // Classic FFT KO countdown: whenever a downed hero's CT reaches 100, tick 3 -> 2 -> 1 -> 0 (fade out)
    const readyDowned = clockUnits.find(u => isUnitDowned(u) && u.ct >= 100)
    if (readyDowned) {
      readyDowned.ct = Math.max(0, readyDowned.ct - 100)
      readyDowned.koCountdown = Math.max(0, readyDowned.koCountdown - 1)
      if (readyDowned.koCountdown > 0) {
        addFloat(
          battle,
          readyDowned.x,
          readyDowned.y + 0.35,
          readyDowned.z,
          `KO IN ${readyDowned.koCountdown}...`,
          readyDowned.koCountdown === 1 ? '#ff5768' : '#ff9f43'
        )
        appendCombatLog(
          battle,
          'ko',
          formatKoLog({ unitName: readyDowned.name, kind: 'countdown', countdown: readyDowned.koCountdown })
        )
      } else {
        readyDowned.downed = false
        battle.heroKoCount += 1
        battle.anyHeroFallen = true
        addFloat(battle, readyDowned.x, readyDowned.y + 0.35, readyDowned.z, 'FALLEN!', '#ff5768')
        appendCombatLog(battle, 'ko', formatKoLog({ unitName: readyDowned.name, kind: 'fallen' }))
        state.sounds.push({ kind: 'ko', pitch: 0.78 })
        state.vfx.push({ kind: 'ko', at: [readyDowned.x, readyDowned.y + 0.6, readyDowned.z], isBoss: false, downed: false })
      }
      continue
    }

    let next: BattleUnit | null = null
    for (const u of clockUnits) {
      if (!u.alive || u.ct < 100) continue
      if (!next) { next = u; continue }
      const uSpd = effectiveSpeed(u)
      const nSpd = effectiveSpeed(next)
      if (u.ct > next.ct) next = u
      else if (u.ct === next.ct && uSpd > nSpd) next = u
      else if (u.ct === next.ct && uSpd === nSpd && u.team === 'ally' && next.team === 'enemy') next = u
    }

    if (!next) {
      for (const u of clockUnits) u.ct += effectiveSpeed(u)
      continue
    }

    battle.turn += 1
    syncLavaGeysers(battle)
    battle.activeUnitUid = next.uid
    battle.selectedUnitUid = next.uid
    battle.armedSkillIndex = null
    battle.armedTacticUid = null
    battle.moveUndo = null
    battle.oaTriggeredUids = []
    battle.pendingAction = null
    battle.facingPicker = null
    next.moved = false
    next.acted = false

    // Start-of-unit-turn ticks (cooldowns, burn, poison, active lava geyser, slow, haste, empower, taunt, shrine heal)
    const cdTick = next.team === 'ally' ? cooldownTickStep(battle) : 1
    for (let i = 0; i < 3; i++) {
      if (next.cooldowns[i] > 0) next.cooldowns[i] = Math.max(0, next.cooldowns[i] - cdTick)
    }
    const hadBurnAtTurnStart = next.burnTurns > 0
    const hadPoisonAtTurnStart = next.poisonStacks > 0
    if (next.burnTurns > 0) {
      next.burnTurns -= 1
      const burnRes = applyDamageDetailed(state, null, next, 8, 1, false, false, { suppressLog: true })
      appendCombatLog(
        battle,
        'status',
        formatStatusLog({
          targetName: next.name,
          status: 'burn',
          phase: 'tick',
          damage: burnRes.hpDamage,
          absorbed: burnRes.absorbed
        })
      )
      if (!next.alive) {
        checkBattleOutcome(state)
        continue
      }
    }
    if (next.poisonStacks > 0) {
      const poisonDmg = computePoisonDamage(next)
      next.poisonStacks = Math.max(0, next.poisonStacks - 1)
      applyPoisonTick(state, next, poisonDmg)
      if (!next.alive) {
        checkBattleOutcome(state)
        continue
      }
    }
    const startCell = battle.cells[next.row][next.col]
    if (startCell.terrain === 'lava_geyser' && startCell.geyserActive) {
      applyLavaGeyserHazard(state, next, startCell)
      if (!next.alive) {
        continue
      }
    }
    if (next.team === 'enemy' && next.alive) {
      const regen = evaluateTurnStartRegeneration({
        alive: next.alive,
        enemyId: next.enemyId,
        hp: next.hp,
        maxHp: next.maxHp,
        burnTurns: hadBurnAtTurnStart ? 1 : 0,
        poisonStacks: hadPoisonAtTurnStart ? 1 : 0
      })
      if (regen.amount > 0) {
        applyHealAndShield(state, next, regen.amount, 0, next, { sourceLabel: 'Regeneration' })
        addFloat(battle, next.x, next.y + 0.45, next.z, `REGEN +${regen.amount}`, '#62f58e')
      } else if (regen.suppressedBy !== 'none' && next.hp < next.maxHp) {
        addFloat(battle, next.x, next.y + 0.45, next.z, 'REGEN BLOCKED', '#ff8e47')
        appendCombatLog(
          battle,
          'status',
          `${next.name}'s Regeneration blocked by ${regen.suppressedBy === 'burn' ? 'Burn' : 'Poison'}`,
          { accentHex: '#ff8e47' }
        )
      }
    }
    if (next.slowTurns > 0) next.slowTurns -= 1
    if (next.hasteTurns > 0) next.hasteTurns -= 1
    if (next.empowerTurns > 0) next.empowerTurns -= 1
    if (next.tauntTurns > 0) next.tauntTurns -= 1
    if (next.team === 'ally' && startCell.terrain === 'shrine' && next.hp < next.maxHp) {
      const hpBefore = next.hp
      applyHealAndShield(state, next, 14, 0, null, { suppressLog: true })
      const gained = Math.max(0, next.hp - hpBefore)
      appendCombatLog(
        battle,
        'hazard',
        formatHazardLog({ kind: 'shrine', targetName: next.name, healAmount: gained > 0 ? gained : 14 }),
        { accentHex: '#5ef29b' }
      )
    }
    const turnStartGear = computeTurnStartGearEffects(next)
    if (turnStartGear.hpRegen > 0 || turnStartGear.shieldGain > 0) {
      applyHealAndShield(state, next, turnStartGear.hpRegen, turnStartGear.shieldGain, null, { sourceLabel: 'Gear' })
    }
    const blessingRegen = computeEndlessTurnStartRegen(battle.endlessBlessings, next)
    if (blessingRegen > 0) {
      applyHealAndShield(state, next, blessingRegen, 0, null, { sourceLabel: 'Battle Mender' })
    }

    if (next.stunTurns > 0) {
      next.stunTurns -= 1
      next.ct = Math.max(0, next.ct - 100)
      if (next.team === 'ally') {
        battle.objective.roundsElapsed += 1
        applyRoundBoundaryMutators(state)
      }
      addFloat(battle, next.x, next.y, next.z, 'STUNNED', '#ffdf59')
      appendCombatLog(battle, 'status', formatStatusLog({ targetName: next.name, status: 'stun', phase: 'stun_skip' }))
      continue
    }

    if (next.team === 'ally') {
      battle.phase = 'player'
      battle.autoBattleDelay = AUTO_BATTLE_THINK_DELAY
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
  battle.moveUndo = null
  battle.pendingAction = null
  battle.facingPicker = null
  const active = getUnitByUid(battle, battle.activeUnitUid)
  if (active) {
    // Classic Tactics CT Wait Bonus: waiting or only moving recovers CT faster!
    const ctCost = active.moved && active.acted ? 100 : (active.moved || active.acted) ? 80 : 60
    active.ct = Math.max(0, active.ct - ctCost)
    if (ctCost < 100) {
      addFloat(battle, active.x, active.y, active.z, `WAIT +${100 - ctCost} CT`, '#8ce8ff')
    }
  }
  battle.objective.roundsElapsed += 1
  applyRoundBoundaryMutators(state)
  advanceToNextUnitTurn(state)
}

/** Alive allies whose Taunt forces `enemy` to prioritize targeting them. */
export function findProvokingTaunters(
  battle: BattleState,
  enemy: BattleUnit,
  allies?: readonly BattleUnit[]
): BattleUnit[] {
  const pool = allies ?? battle.units.filter(u => u.alive && u.team === 'ally')
  const moveBudget = Math.max(1, enemy.move - (enemy.slowTurns > 0 ? 1 : 0))
  const reachRadius = Math.max(TAUNT_RADIUS, moveBudget + enemy.range)
  return pool.filter(a => a.alive && a.tauntTurns > 0 && manhattan(enemy.col, enemy.row, a.col, a.row) <= reachRadius)
}

function chooseEnemyTarget(
  battle: BattleState,
  enemy: BattleUnit,
  allies: readonly BattleUnit[],
  ai: 'melee' | 'ranged' | 'support' | 'boss',
  requireInRangeNow = false
): { target: BattleUnit | null; provoked: boolean } {
  const taunters = findProvokingTaunters(battle, enemy, allies)
  const canHitNow = (u: BattleUnit): boolean => {
    const origin = closestFootprintCell(u.col, u.row, enemy)
    const d = manhattan(origin.col, origin.row, u.col, u.row)
    const effR = effectiveAttackRange(battle, origin.col, origin.row, u.col, u.row, enemy.range)
    if (d > effR) return false
    return enemy.isBoss || hasLineOfSight(battle, origin.col, origin.row, u.col, u.row, false)
  }

  if (taunters.length > 0) {
    const inRangeTaunters = taunters.filter(canHitNow)
    const candidates = requireInRangeNow
      ? inRangeTaunters
      : (inRangeTaunters.length > 0 ? inRangeTaunters : taunters)
    if (candidates.length === 0) return { target: null, provoked: true }
    const picked = candidates.slice().sort((a, b) => {
      const da = distanceBetweenUnits(enemy, a)
      const db = distanceBetweenUnits(enemy, b)
      if (da !== db) return da - db
      return a.hp - b.hp
    })[0]
    return { target: picked ?? null, provoked: true }
  }

  const pool = requireInRangeNow ? allies.filter(canHitNow) : allies.slice()
  if (pool.length === 0) return { target: null, provoked: false }
  const exploitsChill = enemy.enemyId === 'ice_wraith' || enemy.enemyId === 'frost_jarl'
  const picked = pool.sort((a, b) => {
    const da = distanceBetweenUnits(enemy, a)
    const db = distanceBetweenUnits(enemy, b)
    if (exploitsChill && da <= enemy.range && db <= enemy.range) {
      const aSlow = a.slowTurns > 0 ? 1 : 0
      const bSlow = b.slowTurns > 0 ? 1 : 0
      if (aSlow !== bSlow) return bSlow - aSlow
    }
    if (ai === 'ranged' && da <= enemy.range && db <= enemy.range) return a.hp - b.hp
    return da - db
  })[0]
  return { target: picked ?? null, provoked: false }
}

function executeEnemyUnitTurn(state: GameState, enemy: BattleUnit): void {
  const battle = state.battle
  if (!battle || !enemy.alive) return
  if (enemy.stunTurns > 0) {
    enemy.stunTurns -= 1
    addFloat(battle, enemy.x, enemy.y, enemy.z, 'STUNNED', '#ffdf59')
    appendCombatLog(battle, 'status', formatStatusLog({ targetName: enemy.name, status: 'stun', phase: 'stun_skip' }))
    return
  }

  const allies = battle.units.filter(u => u.alive && u.team === 'ally')
  if (!allies.length) return

  const spec = enemy.enemyId ? ENEMY_SPECS[enemy.enemyId] : ENEMY_SPECS.goblin
  const { target, provoked } = chooseEnemyTarget(battle, enemy, allies, spec.ai, false)

  // Crypt summoners (Bone Necromancer, Ash Inquisitor) raise a Bone Thrall onto an adjacent open tile
  if (!provoked && canSummonerRaiseMinion(battle, enemy)) {
    const summonTile = findBestSummonTile(battle, enemy, target)
    if (summonTile) {
      const summoned = createSummonedEnemyUnit(battle, enemy, 'bone_thrall', summonTile.col, summonTile.row)
      battle.units.push(summoned)
      discoverEnemyInCodex(state.campaign, summoned.enemyId)
      enemy.cooldowns[0] = NECROMANCER_SUMMON_COOLDOWN
      enemy.acted = true
      faceToward(enemy, summoned.x, summoned.z)
      enemy.animState = 'cast'
      enemy.animTimer = 0.50
      state.sounds.push({ kind: 'magic', pitch: 0.78 })
      state.vfx.push({
        kind: 'special',
        uid: enemy.uid,
        move: 'lich_summon',
        at: [summoned.x, summoned.y, summoned.z],
        cells: [[summoned.x, summoned.y, summoned.z]]
      })
      if (enemy.isBoss) {
        state.vfx.push({
          kind: 'camera_cue',
          cue: 'boss_special',
          at: [(enemy.x + summoned.x) * 0.5, (enemy.y + summoned.y) * 0.5, (enemy.z + summoned.z) * 0.5]
        })
      }
      addFloat(battle, summoned.x, summoned.y + 0.4, summoned.z, 'RAISE SKELETON!', '#68ffaa')
      appendCombatLog(battle, 'system', `${enemy.name} raises ${summoned.name}`, { accentHex: '#68ffaa' })
      battle.turnOrder = computeTurnOrderPreview(battle, 8)
      return
    }
  }

  // Support shaman / Mire Matriarch heals injured comrade if NOT provoked by a nearby Taunting tank
  if ((spec.ai === 'support' || enemy.enemyId === 'mire_matriarch') && !isSummonerArchetype(enemy.enemyId) && !provoked) {
    const hurt = battle.units
      .filter(u => u.alive && u.team === 'enemy' && u.hp < u.maxHp * 0.8)
      .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0]
    if (hurt && manhattan(enemy.col, enemy.row, hurt.col, hurt.row) <= enemy.range) {
      faceToward(enemy, hurt.x, hurt.z)
      enemy.animState = 'cast'
      enemy.animTimer = 0.42
      enemy.acted = true
      state.vfx.push({ kind: 'special', uid: enemy.uid, move: 'shaman_mend', at: [hurt.x, hurt.y, hurt.z], cells: [[hurt.x, hurt.y, hurt.z]] })
      applyHealAndShield(state, hurt, 22, 6, enemy, { sourceLabel: 'Totem Mend' })
      return
    }
  }

  if (!target) return

  // Multi-tile Frostwyrm raid boss executes Glacial Breath or Wing Buffet immediately when heroes are in reach
  if (isFrostwyrmArchetype(enemy.enemyId) && chooseFrostwyrmSpecial(battle, enemy, allies)) {
    performEnemyAttack(state, enemy, target)
    return
  }

  // Move if not already in ideal range or LoS is blocked (or if an unprovoked melee foe can breach a Defend objective!)
  const defendTile = !provoked && battle.objective.kind === 'defend' ? battle.objective.protectTile : undefined
  const originNow = closestFootprintCell(target.col, target.row, enemy)
  const distNow = manhattan(originNow.col, originNow.row, target.col, target.row)
  const effRangeNow = effectiveAttackRange(battle, originNow.col, originNow.row, target.col, target.row, enemy.range)
  const hasLoSNow = enemy.isBoss || hasLineOfSight(battle, originNow.col, originNow.row, target.col, target.row, false)
  const wantMove = distNow > effRangeNow || !hasLoSNow || (spec.ai === 'ranged' && distNow === 1) ||
    Boolean(defendTile && spec.ai === 'melee' && !unitAt(battle, defendTile.col, defendTile.row))
  if (wantMove) {
    const moveOptions = computeMoveTiles(battle, enemy)
    let bestTile: { col: number; row: number } | null = null
    let bestPath: { col: number; row: number }[] = []
    let bestOaLethal = false
    let bestScore = -9999
    for (const tile of moveOptions) {
      const d = manhattan(tile.col, tile.row, target.col, target.row)
      const elev = cellHeightAt(battle, tile.col, tile.row)
      const tileEffRange = effectiveAttackRange(battle, tile.col, tile.row, target.col, target.row, enemy.range)
      const tileLoS = hasLineOfSight(battle, tile.col, tile.row, target.col, target.row, false)
      const canHit = d <= tileEffRange && tileLoS
      const tileCell = battle.cells[tile.row][tile.col]
      let score = -d * 10 + elev * 5 + terrainDefBonus(tileCell.terrain) * 3
      if (tileCell.terrain === 'tall_grass') score += 4
      if (tileCell.terrain === 'lava_geyser' && tileCell.geyserActive) score -= 28
      if (canHit) {
        score += 14
        const arc = computeAttackArc(tile.col, tile.row, target.col, target.row, target.facing)
        if (arc === 'back') score += 18
        else if (arc === 'flank') score += 9
      }
      const isObjectiveBreach = Boolean(defendTile && spec.ai === 'melee' && tile.col === defendTile.col && tile.row === defendTile.row)
      if (defendTile && spec.ai === 'melee') {
        if (isObjectiveBreach) {
          score += 240
        } else {
          score -= manhattan(tile.col, tile.row, defendTile.col, defendTile.row) * 4
        }
      }
      if (spec.ai === 'ranged') {
        score = canHit && d >= 2 ? 50 - d * 2 + elev * 10 : -Math.abs(d - enemy.range) * 10 + elev * 4
      }
      const candidatePath = findGridPath(battle, enemy, tile.col, tile.row)
      const oaPreview = previewPathOpportunityAttacks(battle, enemy, candidatePath)
      if (oaPreview.triggers.length > 0) {
        const estDmg = Math.max(4, Math.round(enemy.atk * 1.15 - target.def * 0.72))
        const isLethalTarget = canHit && target.hp + target.shield <= estDmg
        score -= computeAiOpportunityPenalty(oaPreview, isLethalTarget, isObjectiveBreach)
      }
      if (score > bestScore) {
        bestScore = score
        bestTile = tile
        bestPath = candidatePath
        bestOaLethal = oaPreview.lethal
      }
    }
    const safeRangedRetreat = spec.ai === 'ranged' && distNow === 1 && !(hasLoSNow && bestOaLethal)
    const shouldTakeTile = bestTile && (
      distNow > effRangeNow || !hasLoSNow || safeRangedRetreat ||
      Boolean(defendTile && bestTile.col === defendTile.col && bestTile.row === defendTile.row)
    )
    if (shouldTakeTile && bestTile) {
      const path = bestPath.length > 0 ? bestPath : findGridPath(battle, enemy, bestTile.col, bestTile.row)
      if (path.length > 0) {
        battle.oaTriggeredUids = []
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

  // Multi-tile Raid Boss: Rimefang's signature Glacial Breath (wide frost cone/cross) & Wing Buffet (adjacent knockback 2)
  if (isFrostwyrmArchetype(enemy.enemyId)) {
    const livingAllies = battle.units.filter(u => u.alive && u.team === 'ally')
    const wyrmPlan = chooseFrostwyrmSpecial(battle, enemy, livingAllies)
    if (wyrmPlan) {
      const targetCell = battle.cells[wyrmPlan.targetRow]?.[wyrmPlan.targetCol]
      const [tx, ty, tz] = targetCell
        ? gridToWorld(wyrmPlan.targetCol, wyrmPlan.targetRow, targetCell.elevation, battle.cols, battle.rows)
        : [target.x, target.y, target.z]
      faceToward(enemy, tx, tz)
      enemy.animState = 'cast'
      enemy.animTimer = 0.56
      enemy.acted = true
      enemy.cooldowns[wyrmPlan.cooldownSlot] = wyrmPlan.cooldownTurns
      state.sounds.push({ kind: wyrmPlan.knockbackDistance ? 'slash' : 'magic', pitch: 0.72 })
      addFloat(battle, enemy.x, enemy.y + 0.65, enemy.z, wyrmPlan.label, wyrmPlan.move === 'glacial_breath' ? '#8ce8ff' : '#ffd166')
      state.vfx.push({
        kind: 'special',
        uid: enemy.uid,
        move: wyrmPlan.vfxMove,
        at: [tx, ty, tz],
        cells: cellCentres(battle, wyrmPlan.cells)
      })
      state.vfx.push({
        kind: 'camera_cue',
        cue: 'boss_special',
        at: [(enemy.x + tx) * 0.5, (enemy.y + ty) * 0.5, (enemy.z + tz) * 0.5]
      })
      const hitUids = new Set<string>()
      const kbTargets: BattleUnit[] = []
      for (const c of wyrmPlan.cells) {
        const victim = unitAt(battle, c.col, c.row)
        if (!victim) {
          if (wyrmPlan.element) {
            triggerElementalCombo(state, enemy, wyrmPlan.element, null, c.col, c.row, handleUnitDefeat)
          }
          continue
        }
        if (victim.team !== 'ally' || hitUids.has(victim.uid)) continue
        hitUids.add(victim.uid)
        const archMul = computeEnemyArchetypeDamageMul(enemy, victim)
        applyDamage(
          state,
          enemy,
          victim,
          enemy.atk * wyrmPlan.powerMul * archMul,
          wyrmPlan.ignoreArmor,
          false,
          true,
          { skillName: wyrmPlan.label },
          false,
          wyrmPlan.element ?? null
        )
        if (wyrmPlan.element) {
          triggerElementalCombo(state, enemy, wyrmPlan.element, victim.alive ? victim : null, c.col, c.row, handleUnitDefeat)
        }
        if (victim.alive && wyrmPlan.status) {
          applyStatus(battle, victim, wyrmPlan.status)
        }
        if (victim.alive && wyrmPlan.knockbackDistance && wyrmPlan.knockbackDistance > 0) {
          kbTargets.push(victim)
        }
      }
      if (wyrmPlan.knockbackDistance && wyrmPlan.knockbackDistance > 0 && kbTargets.length > 0) {
        const ordered = orderDisplacementTargets(kbTargets, enemy.col, enemy.row, 'knockback')
        for (const victim of ordered) {
          if (!victim.alive) continue
          applyDisplacement(state, enemy, victim, { kind: 'knockback', distance: wyrmPlan.knockbackDistance })
          if (victim.alive) checkTileObjectiveInteractions(state, victim)
        }
      }
      checkBattleOutcome(state)
      return
    }
  }

  const originCell = closestFootprintCell(target.col, target.row, enemy)
  const effRange = effectiveAttackRange(battle, originCell.col, originCell.row, target.col, target.row, enemy.range)
  if (manhattan(originCell.col, originCell.row, target.col, target.row) > effRange) return
  if (!enemy.isBoss && !hasLineOfSight(battle, originCell.col, originCell.row, target.col, target.row, false)) return

  // Lich Vaelen signature Cursed-Soul Nova (uses cooldown slot 1 independently of Raise Skeleton on slot 0)
  const lichNova = chooseLichVaelenSoulNova(enemy)
  if (lichNova) {
    faceToward(enemy, target.x, target.z)
    enemy.animState = 'cast'
    enemy.animTimer = 0.52
    enemy.acted = true
    enemy.cooldowns[lichNova.cooldownSlot] = lichNova.cooldownTurns
    state.sounds.push({ kind: 'magic', pitch: 0.76 })
    addFloat(battle, enemy.x, enemy.y + 0.56, enemy.z, lichNova.label, '#7cffb8')
    const affectedCells = getPatternCells(target.col, target.row, lichNova.pattern, battle.cols, battle.rows)
    state.vfx.push({
      kind: 'special',
      uid: enemy.uid,
      move: lichNova.vfxMove,
      at: [target.x, target.y, target.z],
      cells: cellCentres(battle, affectedCells)
    })
    state.vfx.push({
      kind: 'camera_cue',
      cue: 'boss_special',
      at: [(enemy.x + target.x) * 0.5, (enemy.y + target.y) * 0.5, (enemy.z + target.z) * 0.5]
    })
    for (const c of affectedCells) {
      const victim = unitAt(battle, c.col, c.row)
      if (!victim) {
        triggerElementalCombo(state, enemy, lichNova.element, null, c.col, c.row, handleUnitDefeat)
        continue
      }
      if (victim.team === 'ally') {
        applyDamage(
          state,
          enemy,
          victim,
          enemy.atk * lichNova.powerMul,
          lichNova.ignoreArmor,
          false,
          true,
          { skillName: lichNova.label },
          false,
          lichNova.element ?? null
        )
        triggerElementalCombo(state, enemy, lichNova.element, victim.alive ? victim : null, c.col, c.row, handleUnitDefeat)
        if (victim.alive) {
          applyStatus(battle, victim, lichNova.status, lichNova.statusStacks)
        }
      }
    }
    checkBattleOutcome(state)
    return
  }

  const arcaneBossReady = hasMutator(battle, 'arcane_surge') && enemy.isBoss && enemy.cooldowns[0] === 0
  let special = chooseEnemySpecialMove(battle, enemy)
  if (!special && arcaneBossReady) {
    special = {
      move: 'eclipse_nova',
      vfxMove: 'eclipse_nova',
      cooldownTurns: 2,
      pattern: 'cross',
      powerMul: 1.15,
      ignoreArmor: 0.35,
      status: 'burn',
      element: 'fire',
      label: 'ECLIPSE NOVA!'
    }
  }
  if (special) {
    faceToward(enemy, target.x, target.z)
    enemy.animState = 'cast'
    enemy.animTimer = 0.50
    enemy.acted = true
    if (special.cooldownTurns > 0) {
      enemy.cooldowns[0] = special.cooldownTurns
    } else if (hasMutator(battle, 'arcane_surge') && enemy.isBoss) {
      enemy.cooldowns[0] = 2
    }
    state.sounds.push({ kind: special.knockbackDistance ? 'slash' : 'magic', pitch: 0.78 })
    addFloat(battle, enemy.x, enemy.y + 0.52, enemy.z, special.label, '#ffd166')
    const affectedCells = getPatternCells(target.col, target.row, special.pattern, battle.cols, battle.rows)
    if (special.vfxMove === 'fire_nova') {
      state.vfx.push({
        kind: 'projectile',
        style: 'fire',
        from: [enemy.x, enemy.y + 0.95, enemy.z],
        to: [target.x, target.y + 0.75, target.z],
        uid: enemy.uid
      })
      for (const c of affectedCells) {
        const cell = battle.cells[c.row]?.[c.col]
        if (!cell) continue
        const [cx, cy, cz] = gridToWorld(c.col, c.row, cell.elevation, battle.cols, battle.rows)
        state.vfx.push({ kind: 'burst', style: 'fire', at: [cx, cy + 0.55, cz], radius: 0.95, uid: enemy.uid })
      }
    } else {
      state.vfx.push({
        kind: 'special',
        uid: enemy.uid,
        move: special.vfxMove,
        at: [target.x, target.y, target.z],
        cells: cellCentres(battle, affectedCells)
      })
    }
    if (enemy.isBoss) {
      state.vfx.push({
        kind: 'camera_cue',
        cue: 'boss_special',
        at: [(enemy.x + target.x) * 0.5, (enemy.y + target.y) * 0.5, (enemy.z + target.z) * 0.5]
      })
    }

    const targetsHit: BattleUnit[] = []
    for (const c of affectedCells) {
      const victim = unitAt(battle, c.col, c.row)
      if (!victim) {
        if (special.element) {
          triggerElementalCombo(state, enemy, special.element, null, c.col, c.row, handleUnitDefeat)
        }
        continue
      }
      if (victim.team === 'ally') {
        const archMul = computeEnemyArchetypeDamageMul(enemy, victim)
        applyDamage(state, enemy, victim, enemy.atk * special.powerMul * archMul, special.ignoreArmor, false, true, { skillName: special.label }, false, special.element ?? null)
        if (special.element) {
          triggerElementalCombo(state, enemy, special.element, victim.alive ? victim : null, c.col, c.row, handleUnitDefeat)
        }
        if (victim.alive && special.status) {
          applyStatus(battle, victim, special.status, special.statusStacks)
        }
        if (victim.alive && special.knockbackDistance && special.knockbackDistance > 0) {
          targetsHit.push(victim)
        }
      }
    }

    if (special.ignitesGeysers) {
      const ignited = igniteNearbyLavaGeysers(battle, target.col, target.row, IGNIS_TITAN_GEYSER_IGNITE_RADIUS)
      if (ignited.length > 0) {
        for (const g of ignited) {
          const gCell = battle.cells[g.row]?.[g.col]
          if (!gCell) continue
          const [gx, gy, gz] = gridToWorld(g.col, g.row, gCell.elevation, battle.cols, battle.rows)
          state.vfx.push({ kind: 'burst', style: 'fire', at: [gx, gy + 0.55, gz], radius: 0.9, uid: enemy.uid })
        }
        appendCombatLog(
          battle,
          'hazard',
          `${enemy.name}'s Cataclysm Slam ignites ${ignited.length} magma geyser${ignited.length === 1 ? '' : 's'}!`,
          { accentHex: '#ff7b3b' }
        )
      }
    }

    if (special.knockbackDistance && special.knockbackDistance > 0 && targetsHit.length > 0) {
      const ordered = orderDisplacementTargets(targetsHit, enemy.col, enemy.row, 'knockback')
      for (const victim of ordered) {
        if (!victim.alive) continue
        applyDisplacement(
          state,
          enemy,
          victim,
          { kind: 'knockback', distance: special.knockbackDistance }
        )
        if (victim.alive) checkTileObjectiveInteractions(state, victim)
      }
    }

    checkBattleOutcome(state)
    return
  }

  executeBasicAttack(state, enemy, target)
}

/** Set the 1x / 2x battle animation & pacing speed multiplier (persisted on campaign & active battle). */
export function setBattleSpeed(state: GameState, speed: BattleSpeedMultiplier): BattleSpeedMultiplier {
  const normalized = normalizeBattleSpeed(speed)
  state.campaign.battleSpeed = normalized
  if (state.battle) {
    state.battle.battleSpeed = normalized
  }
  return normalized
}

/** Toggle battle animation & pacing speed between 1x and 2x. */
export function toggleBattleSpeed(state: GameState): BattleSpeedMultiplier {
  const current = state.battle
    ? normalizeBattleSpeed(state.battle.battleSpeed)
    : normalizeBattleSpeed(state.campaign.battleSpeed)
  return setBattleSpeed(state, nextBattleSpeed(current))
}

/** Enable or disable tactical Auto-Battle during an active battle (always off during deploy/victory/defeat). */
export function setAutoBattle(state: GameState, enabled: boolean): boolean {
  const battle = state.battle
  if (!battle) return false
  if (!enabled) {
    battle.autoBattle = false
    return false
  }
  if (battle.phase !== 'player' && battle.phase !== 'enemy') {
    battle.autoBattle = false
    return false
  }
  if (battle.facingPicker) cancelWaitFacingPicker(state)
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  battle.autoBattle = true
  battle.autoBattleDelay = AUTO_BATTLE_THINK_DELAY
  if (battle.phase === 'player') {
    refreshHighlights(battle, state.campaign)
  }
  return true
}

/** Toggle Auto-Battle on/off during active combat. */
export function toggleAutoBattle(state: GameState): boolean {
  const battle = state.battle
  if (!battle) return false
  return setAutoBattle(state, !battle.autoBattle)
}

/** Cleanly stop Auto-Battle (e.g., on manual override, Escape, or Pause). Returns true if it was active. */
export function cancelAutoBattle(state: GameState): boolean {
  const battle = state.battle
  if (!battle || !battle.autoBattle) return false
  battle.autoBattle = false
  return true
}

/**
 * Execute one planned Auto-Battle action for the active player hero using the exact same
 * combat, movement, skill, tactic, and turn-end facing rules as manual play.
 */
export function executeAutoBattleStep(state: GameState): boolean {
  const battle = state.battle
  if (!battle || battle.phase !== 'player' || !battle.autoBattle) return false
  if (battle.units.some(u => u.path.length > 0)) return false

  const actor = getUnitByUid(battle, battle.activeUnitUid)
  if (!actor || !actor.alive || actor.team !== 'ally') {
    endPlayerTurn(state)
    return true
  }

  const plan = planAutoBattleAction(state)
  if (!plan) return false

  if (plan.kind === 'tactic' && plan.tacticUid && plan.targetCol !== undefined && plan.targetRow !== undefined) {
    battle.armedSkillIndex = null
    battle.armedTacticUid = plan.tacticUid
    refreshHighlights(battle, state.campaign)
    const fired = executeTacticCard(state, plan.tacticUid, plan.targetCol, plan.targetRow)
    if (fired) {
      battle.autoBattleDelay = AUTO_BATTLE_THINK_DELAY
      return true
    }
    battle.armedTacticUid = null
    refreshHighlights(battle, state.campaign)
  }

  if (plan.kind === 'skill' && plan.skillIndex !== undefined && plan.targetCol !== undefined && plan.targetRow !== undefined) {
    const skillTarget = unitAt(battle, plan.targetCol, plan.targetRow)
    if (!skillTarget || skillTarget.team !== 'enemy' || !isEnemyShrouded(battle, skillTarget)) {
      executeHeroSkill(state, actor, plan.skillIndex, plan.targetCol, plan.targetRow)
      battle.armedSkillIndex = null
      if (battle.phase === 'player') {
        refreshHighlights(battle, state.campaign)
      }
      battle.autoBattleDelay = AUTO_BATTLE_POST_ACT_DELAY
      return true
    }
  }

  if (plan.kind === 'attack' && plan.targetCol !== undefined && plan.targetRow !== undefined) {
    const target = unitAt(battle, plan.targetCol, plan.targetRow)
    if (target && target.team === 'enemy' && !isEnemyShrouded(battle, target)) {
      executeBasicAttack(state, actor, target)
      if (battle.phase === 'player') refreshHighlights(battle, state.campaign)
      battle.autoBattleDelay = AUTO_BATTLE_POST_ACT_DELAY
      return true
    }
    if (!target && isIntactBarricade(battle.cells[plan.targetRow]?.[plan.targetCol])) {
      executeBasicAttackOnBarricade(state, actor, plan.targetCol, plan.targetRow)
      if (battle.phase === 'player') refreshHighlights(battle, state.campaign)
      battle.autoBattleDelay = AUTO_BATTLE_POST_ACT_DELAY
      return true
    }
  }

  if (
    (plan.kind === 'move_and_skill' || plan.kind === 'move_and_attack') &&
    plan.moveTo &&
    plan.targetCol !== undefined &&
    plan.targetRow !== undefined
  ) {
    const path = findGridPath(battle, actor, plan.moveTo.col, plan.moveTo.row)
    if (path.length > 0) {
      actor.path = path
      actor.moveProgress = 0
      actor.moved = true
      actor.animState = 'run'
      battle.selectedUnitUid = actor.uid
      battle.moveUndo = null
      battle.oaTriggeredUids = []
      battle.pendingAction = {
        col: plan.targetCol,
        row: plan.targetRow,
        skillIndex: plan.kind === 'move_and_skill' && plan.skillIndex !== undefined ? plan.skillIndex : null
      }
      battle.moveTiles = []
      battle.targetTiles = []
      battle.moveAttackTiles = []
      battle.autoBattleDelay = AUTO_BATTLE_POST_ACT_DELAY
      state.sounds.push({ kind: 'step' })
      return true
    }
  }

  if (plan.kind === 'move' && plan.moveTo) {
    const path = findGridPath(battle, actor, plan.moveTo.col, plan.moveTo.row)
    if (path.length > 0) {
      actor.path = path
      actor.moveProgress = 0
      actor.moved = true
      actor.animState = 'run'
      battle.selectedUnitUid = actor.uid
      battle.moveUndo = null
      battle.oaTriggeredUids = []
      battle.pendingAction = null
      battle.moveTiles = []
      battle.targetTiles = []
      battle.moveAttackTiles = []
      battle.autoBattleDelay = AUTO_BATTLE_POST_ACT_DELAY
      state.sounds.push({ kind: 'step' })
      return true
    }
  }

  // End turn with optimal facing toward the nearest / highest-threat enemy
  if (actor.alive && actor.stunTurns === 0) {
    setUnitFacing(actor, plan.facing ?? chooseBestTurnEndFacing(battle, actor))
  }
  endPlayerTurn(state)
  return true
}

export function stepGame(state: GameState, dt: number): void {
  const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0
  state.time += safeDt
  const battle = state.battle
  if (!battle) return

  const speed = normalizeBattleSpeed(battle.battleSpeed)
  const battleDt = scaleBattleDt(safeDt, speed)

  if (battle.bannerTimer > 0) battle.bannerTimer = Math.max(0, battle.bannerTimer - battleDt)
  if (battle.shake > 0) battle.shake = Math.max(0, battle.shake - battleDt * 1.8)

  // Floating combat numbers
  for (let i = battle.floatingNumbers.length - 1; i >= 0; i--) {
    const fn = battle.floatingNumbers[i]
    fn.age += battleDt
    fn.y += battleDt * 0.95
    if (fn.age >= fn.duration) battle.floatingNumbers.splice(i, 1)
  }

  // Unit smooth grid movement, lunges, and animation timers
  let anyMoving = false
  for (const u of battle.units) {
    if (!u.alive) continue
    if (u.hitFlash > 0) u.hitFlash = Math.max(0, u.hitFlash - battleDt)
    u.lungeX *= Math.pow(0.001, battleDt)
    u.lungeZ *= Math.pow(0.001, battleDt)

    if (u.path.length > 0) {
      anyMoving = true
      const next = u.path[0]
      const fpSize = getUnitFootprintSize(u)
      const toCell = battle.cells[next.row][next.col]
      const [fx, fy, fz] = computeFootprintWorldCenter(battle, u.col, u.row, fpSize)
      const [tx, ty, tz] = computeFootprintWorldCenter(battle, next.col, next.row, fpSize)
      faceToward(u, tx, tz)

      if (battleDt > 0 && u.moveProgress === 0) {
        triggerLeavingZocOpportunityAttacks(state, u, next.col, next.row)
        if (isBattleEnded(battle)) {
          u.path = []
          break
        }
        if (!u.alive) {
          u.path = []
          if (u.uid === battle.activeUnitUid) {
            battle.pendingAction = null
            battle.armedSkillIndex = null
            battle.armedTacticUid = null
            battle.moveUndo = null
            battle.oaTriggeredUids = []
            battle.facingPicker = null
            if (battle.phase === 'player') {
              battle.objective.roundsElapsed += 1
              applyRoundBoundaryMutators(state)
            }
            advanceToNextUnitTurn(state)
            break
          }
          continue
        }
      }

      u.moveProgress += battleDt * 5.2
      if (u.moveProgress >= 1) {
        u.col = next.col
        u.row = next.row
        u.x = tx
        u.y = ty
        u.z = tz
        u.path.shift()
        u.moveProgress = 0
        triggerStepOnHazard(state, u, toCell)
        if (isBattleEnded(battle)) {
          u.path = []
          break
        }
        if (!u.alive) {
          u.path = []
          if (u.uid === battle.activeUnitUid) {
            battle.pendingAction = null
            battle.armedSkillIndex = null
            battle.armedTacticUid = null
            battle.moveUndo = null
            battle.facingPicker = null
            if (battle.phase === 'player') {
              battle.objective.roundsElapsed += 1
              applyRoundBoundaryMutators(state)
            }
            advanceToNextUnitTurn(state)
            break
          }
          continue
        }
        checkTileObjectiveInteractions(state, u)
        if (isBattleEnded(battle)) {
          u.path = []
          u.animState = u.team === 'ally' && battle.phase === 'victory' ? 'celebrate' : 'idle'
          break
        }
        if (u.path.length === 0) {
          battle.oaTriggeredUids = []
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
                const effRange = effectiveAttackRange(battle, u.col, u.row, pending.col, pending.row, u.range, u)
                const distToPending = manhattan(u.col, u.row, pending.col, pending.row)
                const clearLoS = hasLineOfSight(battle, u.col, u.row, pending.col, pending.row, false)
                if (target && target.team === 'enemy' && distToPending <= effRange && clearLoS) {
                  executeBasicAttack(state, u, target)
                } else if (!target && isIntactBarricade(battle.cells[pending.row]?.[pending.col]) && distToPending <= effRange && clearLoS) {
                  executeBasicAttackOnBarricade(state, u, pending.col, pending.row)
                }
              }
            }
            if (battle.phase === 'player') {
              refreshHighlights(battle, state.campaign)
            }
          } else if (u.team === 'enemy' && battle.phase === 'enemy' && !u.acted) {
            const allies = battle.units.filter(a => a.alive && a.team === 'ally')
            const spec = u.enemyId ? ENEMY_SPECS[u.enemyId] : ENEMY_SPECS.goblin
            const { target: chosen } = chooseEnemyTarget(battle, u, allies, spec.ai, true)
            if (chosen) {
              faceToward(u, chosen.x, chosen.z)
              performEnemyAttack(state, u, chosen)
            }
          }
        }
      } else {
        const t = u.moveProgress
        const hop = Math.sin(t * Math.PI) * (0.28 + Math.abs(ty - fy) * 0.35)
        u.x = fx + (tx - fx) * t
        u.z = fz + (tz - fz) * t
        u.y = fy + (ty - fy) * t + hop
      }
    } else if (u.animTimer > 0) {
      u.animTimer = Math.max(0, u.animTimer - battleDt)
      if (u.animTimer === 0 && u.animState !== 'celebrate') {
        u.animState = 'idle'
      }
    }
  }

  // Single active Enemy AI Unit Turn on the Speed/CT timeline
  if (battle.phase === 'enemy' && !anyMoving) {
    battle.enemyDelay -= battleDt
    if (battle.enemyDelay <= 0) {
      const enemy = getUnitByUid(battle, battle.activeUnitUid)
      if (!enemy || !enemy.alive) {
        advanceToNextUnitTurn(state)
      } else if (!battle.enemyActedThisTurn) {
        battle.enemyActedThisTurn = true
        executeEnemyUnitTurn(state, enemy)
        battle.enemyDelay = 0.42
      } else {
        if (enemy.stunTurns === 0) {
          setUnitFacing(enemy, chooseOptimalTurnEndFacing(battle, enemy))
        }
        enemy.ct = Math.max(0, enemy.ct - 100)
        advanceToNextUnitTurn(state)
      }
    }
  }

  // Optional Tactical Auto-Battle Turn Execution for Active Player Hero
  if (battle.phase === 'player' && battle.autoBattle && !anyMoving && !battle.facingPicker) {
    battle.autoBattleDelay -= battleDt
    if (battle.autoBattleDelay <= 0) {
      executeAutoBattleStep(state)
    }
  }
}
