import {
  createGamePage, createLowPolyRenderer, createPerfLogger, createPerfMonitor, fixedLoop
} from 'ridgetop'
import type { HudPainter } from 'ridgetop'
import { boxNode, column, createCanvasUi, createUiTheme, overlay, row, spacerNode } from 'ridgetop/ui'
import type { CanvasWidgetDrawState, LayoutNode, LayoutRect } from 'ridgetop/ui'
import { isTestingPaused, registerDecisionAgent } from 'ridgetop/testing'
import { createCrownshardDecisionAgent } from './decision-agent.ts'
import { computeEquipmentStatDiff, formatCompactStatDelta } from './armory-diff.ts'
import type { EquipmentStatDiff } from './armory-diff.ts'
import { createPortraitStore } from './art.ts'
import { createCrownshardAudio } from './audio.ts'
import {
  CHAPTERS, CHAPTER_BY_ID, DIFFICULTY_META, ENEMY_SPECS, EQUIPMENT_BY_ID, HERO_SPECS,
  MERGE_COPIES_REQUIRED, PACK_BY_ID, PACK_LIST, PLAYABLE_CHAPTERS, RARITY_META, RARITY_ORDER,
  TACTIC_BY_ID, WORLD_REGIONS
} from './data.ts'
import {
  createGamepadNavTracker, createGridCursorState, cycleGridCursorTarget,
  pollGamepadActions, resolveGridCursorVisualMode, screenDirToFacing,
  stepGridCursorScreenDir, syncGridCursorToBattle
} from './grid-cursor.ts'
import type { GamepadSnapshot, GridCursorInputMode } from './grid-cursor.ts'
import { cameraCardinalHeading, createCrownshardScene, facingPickerAnchor } from './scene.ts'
import {
  buildDioramaLandmarks, completeDioramaFlyIn, createWorldMap3DCamera, focusDioramaOnStage,
  getDioramaFlyInProgress, panDioramaCamera, resetDioramaCamera, rotateDioramaCamera,
  startDioramaFlyIn, stepDioramaCamera, zoomDioramaCamera
} from './world-map-3d.ts'
import type { WorldMap3DCamera } from './world-map-3d.ts'
import {
  CROWNLESS_DEEP_MAX_FLOOR, ENDLESS_BLESSING_BY_ID, GEAR_SET_SPECS, MAX_EQUIP_UPGRADE, MAX_TACTIC_DECK, MIN_TACTIC_DECK, OAKHAVEN_STAGE_ID,
  STARFALL_ATOLL_FIRST_CLEAR_DUST, STARFALL_ATOLL_FIRST_CLEAR_SHARDS,
  STAGE_DIFFICULTY_TIERS, STAGE_MUTATOR_IDS, STAGE_MUTATOR_SPECS, STAGE_TIER_SPECS, WEATHER_SPECS,
  abandonBattle, abandonEndlessRun, areDiscoveryTipsEnabled, armSkill, armTacticCard, autoBuildTacticDeck, autoEquipBestFit, beginWaitFacingPicker,
  bulkSalvageCommonDupes, buyOakhavenDeal, buyPack, buyWorldEventOffer, canBuyPack, canClaimStageMasteryChest, canCraftEquipment, canCraftHero, canHeroEquipItem, canMergeHero, canUndoMove,
  cancelAutoBattle, cancelWaitFacingPicker, checkDiscoveryTipForBattle, claimMasteryMilestone, claimStageMasteryChest, clearSave, computeChallengeRewards,
  computeCombatForecast, computeDangerZone, computeDeckValue,
  computeEnemyThreat, computeHeroStats, computeSquadPower, computeTacticDeckCurve, computeUnitBondAssist, computeZocPerimeterTiles,
  confirmDeployment, confirmWaitFacingPicker, countBattleDestructibleCover, countUniqueTelegraphTiles, countUpgradedEquipment, craftEquipment, craftHero, createInitialState,
  createTurnBoundaryTracker, dismissDiscoveryTip, draftEndlessBlessing, effectiveSpeed, equipItem, evaluateAllFacingExposures, evaluateFacingExposure,
  findBestFitUpgrades, findEquipOwner, findGridPath, formatAbyssFloorLabel, formatBattleSpeedLabel, formatBossTelegraphHudSummary, formatCoverTooltip, formatEndlessBiomeLabel, formatEquipDisplayName, formatOpportunityWarning, formatWeatherHudLabel,
  getAct1StageMechanicStatus, getActiveDiscoveryTip, getActiveTacticDeckUids,
  getBestiaryEntries, getChapterObjectiveSummary, getClaimableMasteryMilestones, getCodexProgress, getCoverHp, getCraftableEquipment, getCraftableHeroes, getCrownlessDeepFloorSpec, getEffectiveHeroSkill, getEffectiveHeroTitle, getEquipCodexEntries, getEquipCompatibilityReason, getEquipCraftCost, getEquipEffect, getEquipFamily,
  getEquipShortLockLabel, getEquipUpgradePreview, getEquipmentByUid, getHeroActiveGearSetIds, getHeroByUid, getHeroCodexEntries, getHeroCraftCost, getHeroEquipFamily, getHeroEquipFamilyMeta, getHeroGearSetProgress, getHeroPassive, getHeroSalvageShards,
  getHeroSkill, getHeroSubSpecOptions, getHighestClearedStageTier, getMaxCombatLogScroll, getMaxLivingBossPhase, getMaxMasteryStars, getMaxSelectableCrownlessDeepFloor, getMergeCandidates, getNextMasteryMilestone, getNextRecommendedStage, getOakhavenExchangeOffers, getObjectiveProgressText, getPackPityStatus,
  getSelectedCrownlessDeepFloor, getSquadBondSummary, getStageMasteryChestReward, getStageMasteryObjectives, getStageMasteryRecord, getStageUnlockHint, getTacticByUid, getTelegraphsAtCell, getTotalBondRanks, getTotalMasteryStars, getUnitByUid, getUpgradedEquipSalvageYield, getWorldMapEventById, hasClaimedStageMasteryChest, hasMaxedHero, hasOakhavenPatronDiscount, heroLevelProgress, isChestClaimed,
  isCrownlessDeepStage, isDeployTile, isDestructibleCover, isEndlessBossWave, isEndlessUnlocked, isEnemyShrouded, isOakhavenExchangeUnlocked, isStageCleared, isStageUnlocked, loadSave, maxSquadSize, mergeHero,
  moveDeployUnit, needsSubSpecChoice, normalizeEquipUpgradeLevel, persistSave, previewBulkSalvageCommonDupes, previewPathOpportunityAttacks,
  previewTurnOrderAfterAction, previewWaitFacing, resetDiscoveryTips, resolveBattleAtmosphere, resolveStageChallenge, restoreBattleState, rotateDeployUnit, salvageEquipCard,
  salvageHeroCard, selectEndlessWaveStage, selectHeroByUid, selectHeroSubSpec, selectTile, serializeBattleState, setActionCameraEnabled, setAutoBattle, setBattleSpeed,
  setDiscoveryTipsEnabled, setSelectedCrownlessDeepFloor, shouldAutoSaveOnTurnBoundary, skipAllDiscoveryTips, startChapterBattle, startEndlessRun, startWorldEventBattle, stepGame,
  swapDeployUnit, syncTurnBoundaryTracker, toggleAutoBattle, toggleBattleSpeed, toggleEquipLock, toggleHeroLock,
  toggleSquadMember, toggleTacticInDeck, undoMove, unequipItem, unitAt, upgradeEquipWithDuplicate, upgradeEquipWithGold, isActionCameraEnabled
} from './simulation.ts'
import type { CodexTab, EquipUpgradePreview } from './simulation.ts'
import { FACING_DIRS, cellHeightLevel, gridToWorld, isUnitDowned } from './types.ts'
import type {
  BattleSaveSnapshot, BattleSpeedMultiplier, BattleUnit, ChapterSpec, CombatForecast, EndlessBlessingId, EnemyArchetypeId, FacingDir, GameState,
  HeroClassId, HeroSubSpecId, OwnedEquipCard, OwnedHeroCard, PackId, PackRevealItem, PathOpportunityPreview, Rarity,
  StageDifficultyTier, StageMutatorId, TurnActionKind, TurnOrderActionPreview, WorldMapEvent
} from './types.ts'
import {
  drawAnimatedRevealCard, drawApMeter, drawArmoryStatDiffPanel, drawArmoryTemperBar, drawAutoBattlePill, drawBattleBanterToast, drawBattleInfo, drawBoosterPack, drawBossTelegraphBanner, drawButton, drawCameraCompassButton, drawCampHeader,
  drawChallengeHudBadges, drawChapterPicker, drawChip, drawCodexEnemyDetail, drawCodexEntryCard, drawCodexEquipDetail, drawCodexHeader, drawCodexHeroDetail, drawCodexSilhouetteTile, drawCombatForecast, drawCombatLogPanel, drawCombatLogToggleButton, drawControlHints, drawDefeatBackdrop, drawDeployHeroChip,
  drawDifficultyBadge, drawDevVersionPill, drawDiscoveryTipCard, drawEmptyNote, drawEndTurnButton, drawEndlessBlessingCard, drawEndlessBlessingsHudPill, drawEquipCard, drawEquipFamilyPill, drawForecastAltChip,
  drawForgeBalanceBanner, drawForgeRecipeCard, drawGearSetBanner, drawHeroHeader, drawHeroRosterCard, drawHeroXpSummaryAnimated, drawHintPill, drawIconButton, drawLabel, drawLetterbox,
  drawLootRow, drawModal, drawMutatorChipButton, drawObjectiveBadge, drawOtaUpdateBanner, drawOverline, drawPackCeremonyBackdrop, drawPanel, drawPassiveBanner, drawPityBanner, drawPortraitTile,
  drawResultHeadlineAnimated, drawRevealCard, drawRewardRowAnimated, drawSegmentTrack,
  drawSettingRow, drawSheet, drawSkillRow, drawSkillTile, drawSpeakerPortrait, drawSquadBondsStrip, drawStageMasteryChecklist, drawStageTierSegment, drawStatStrip,
  drawStoryHeading, drawSubSpecCard, drawSubSpecHeader, drawTab, drawTacticCard, drawTacticDeckCard, drawTacticDeckHeader, drawText, drawTimelineBg, drawTitleCard,
  drawTitleLogo, drawToast, drawToolbarBg, drawTopFade, drawTurnOrderCallout,
  drawTurnOrderPreviewBanner, drawTurnTimelinePreviewOverlay, drawTurnToken, drawUnitCard,
  drawVictoryBackdrop, drawVictoryMasteryAnimated, drawWeatherDetailCard, drawWeatherHudPill, drawWeatherPreviewChip, drawWell, drawWorldMap3DOverlay, drawWorldMapEventNode, drawWorldMapNode,
  COLOR, RADIUS, TIER_COLOR, TYPE, UI_THEME_PALETTE,
  FANFARE_DURATION, drawFanfare
} from './ui-art.ts'
import type { CodexListEntry, FanfareDrawOpts, IconName, ProjectedRegionBanner, StatStripItem } from './ui-art.ts'
import {
  computeViewportProfile, createInputModalityTracker, detectInitialInputModality, readDomSafeAreaInsets, uiCopy
} from './viewport-profile.ts'
import type { ViewportProfile } from './viewport-profile.ts'
import {
  areAdvancedBattleToolsUnlocked, areMutatorsUnlockedForStage, areSecondaryCurrenciesVisible,
  getAllowedChallengeTiers, getUnlockedCampTabs, isBossRematchSkirmish, isBulkSalvageUnlocked,
  isCampTabUnlocked, isCampUnlocked, isCodexUnlocked, isGearTemperingUnlocked, isMasteryUnlocked,
  isSquadBondsUnlocked, isWorldMapRevealed, shouldLaunchDirectlyIntoBattle1
} from './progression-unlocks.ts'
import type { CampTabId } from './progression-unlocks.ts'
import {
  checkDiscoveryTipForCamp, checkDiscoveryTipForCodex, checkDiscoveryTipForWorldMap,
  dismissScreenDiscoveryTip, getActiveScreenDiscoveryTip, getDiscoveryTipBody, getDiscoveryTipHotkey
} from './discovery-tips.ts'
import type { DiscoveryTipScreen, DiscoveryTipSpec } from './discovery-tips.ts'
import {
  applyOtaStatus, applyOtaUpdateReady, createOtaBannerState, dismissOtaBanner,
  formatDevVersionLabel, formatShortOtaVersion, getVisibleOtaUpdate, reopenOtaBanner
} from './ota-ui.ts'
import type { OtaBannerState } from './ota-ui.ts'

type Screen = 'title' | 'world' | 'camp' | 'codex' | 'story' | 'battle' | 'victory' | 'defeat' | 'paused'
type CampTab = 'squad' | 'armory' | 'deck' | 'forge' | 'decks'
type WorldInspectorTab = 'overview' | 'challenge' | 'trade'
type ArmoryFilter = 'all' | 'weapon' | 'armor' | 'relic'
type ForgeCategory = 'heroes' | 'weapon' | 'armor' | 'relic'

interface PackAnimState {
  readonly packId: PackId
  readonly cards: readonly PackRevealItem[]
  readonly bestRarity: Rarity
  elapsed: number
  phase: 'spin' | 'reveal'
  flipStartTimes: number[]
  lastTickStep: number
  burstPlayed: boolean
}

const PACK_SPIN_DURATION = 1.35
const PACK_FLIP_DURATION = 0.42
const PACK_FLIP_STAGGER = 0.36

const ARMORY_FILTERS: readonly ArmoryFilter[] = ['all', 'weapon', 'armor', 'relic']
const FORGE_CATEGORIES: readonly ForgeCategory[] = ['heroes', 'weapon', 'armor', 'relic']

const TERRAIN_LABEL: Record<string, string> = {
  grass: 'Meadow',
  stone: 'Flagstone (+1 DEF)',
  hill: 'Ridge Terrace',
  bridge: 'Bridge (-1 DEF)',
  water: 'Deep Water (Blocked)',
  shrine: 'Sun Shrine (+14 HP, +1 DEF)',
  pillar: 'Stone Pillar (LoS · Cover)',
  cracked_pillar: 'Cracked Pillar (Destructible · Blocks LoS)',
  lava: 'Molten Rift (Blocked)',
  snow: 'Deep Snow (2 Move)',
  darkstone: 'Obsidian Floor (+2 DEF)',
  stairs: 'Stone Stairs (Climb)',
  void: 'Chasm',
  lava_geyser: 'Lava Geyser (12 Fire DMG + Burn)',
  ice: 'Ice Sheet (+1 Glide Move)',
  cursed_altar: 'Cursed Altar (-10 HP · +Empower & +1 AP)',
  tall_grass: 'Tall Grass (+3 Ranged Cover · -12% Crit)',
  barricade: 'Timber Barricade (Destructible · Blocks LoS)'
}

export const BIOME_NAME: Readonly<Record<string, string>> = {
  meadow: 'Solis Meadow',
  river: 'Silverfen River',
  crypt: 'Ashen Crypt',
  frost: 'Frostspire Highlands',
  volcano: 'Emberwaste Caldera',
  throne: 'Eclipse Throne',
  dunes: 'Sunbleached Dunes',
  aether: 'Aether Isles',
  expanse: 'Shattered Expanse'
}

const SPEAKER_PORTRAIT: Record<string, string> = {
  'Sir Aldric': 'knight',
  Lyra: 'archer',
  Vesper: 'mage',
  'Archon Malakor': 'eclipse_archon',
  'Grom, Briar Warlord': 'briar_warlord',
  'Vex, Mire Matriarch': 'mire_matriarch',
  'Vaelen, Ash Inquisitor': 'ash_inquisitor',
  'Jarl Skadi': 'frost_jarl',
  'Ignar, Magma Warden': 'magma_warden',
  'Dune Sovereign': 'dune_sovereign_boss',
  'Astral Warden': 'astral_warden_boss',
  'The Unbroken Crown': 'unbroken_crown_boss',
  'Lich Vaelen': 'lich_vaelen',
  'Rimefang, Glacial Frostwyrm': 'frostwyrm_rimefang',
  'Ignis Titan': 'ignis_titan',
  'Abyssal Sovereign': 'eclipse_archon'
}

const ACT_ID_ALIASES: Record<string, string> = {
  'cs-start': 'cs-play',
  'cs-story-deploy': 'cs-story-go',
  'cs-story-camp': 'cs-story-back',
  'cs-pack-recruit': 'cs-buy-recruit',
  'cs-pack-vanguard': 'cs-buy-vanguard',
  'cs-pack-sovereign': 'cs-buy-sovereign',
  'cs-merge': 'cs-merge-hero',
  'cs-hud-perf': 'cs-perf',
  'cs-act-basic': 'sk-basic',
  'cs-act-0': 'sk-0',
  'cs-act-1': 'sk-1',
  'cs-act-2': 'sk-2',
  'cs-tactic-0': 'hand-0',
  'cs-tactic-1': 'hand-1',
  'cs-tactic-2': 'hand-2',
  'cs-tactic-3': 'hand-3'
}

const TITLE_HINTS: readonly (readonly [string, string])[] = [
  ['Arrows / Click', 'Cursor / Move'],
  ['Enter / 1-4', 'Act / Skills'],
  ['Q / E', 'Snap 90°'],
  ['Space / F', 'Wait / Face']
]

const TITLE_HINTS_TOUCH: readonly (readonly [string, string])[] = [
  ['Tap Tile', 'Move / Strike'],
  ['Tap Skill', 'Cast / Inspect'],
  ['Pinch / Twist', 'Zoom / Orbit'],
  ['Tap Wait', 'Save CT / Face']
]

function toCampTabId(tab: CampTab): CampTabId {
  return tab === 'decks' ? 'packs' : tab
}

function fromCampTabId(tab: CampTabId): CampTab {
  return tab === 'packs' ? 'decks' : tab
}

function wrapAngleDelta(rad: number): number {
  let d = rad
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

async function start() {
  const page = createGamePage()
  const { element } = page
  const backend = page.requestedBackend()
  let showPerfPanel = page.url.searchParams.has('fps') || page.url.searchParams.has('perf')

  const stage = element<HTMLCanvasElement>('cs-stage')
  const uiCanvas = element<HTMLCanvasElement>('cs-ui')

  // Cap pixelRatio to 1.5 for crisp visuals without over-driving laptop GPU fans
  const renderer = await createLowPolyRenderer(stage, {
    backend,
    pixelRatio: 1.5,
    canvasDepth: true,
    lighting: { direction: [-0.55, 0.78, 0.42], ambient: 0.50 }
  })
  const scene = createCrownshardScene(renderer)
  const audio = createCrownshardAudio()
  const perf = createPerfMonitor(60)
  const portraitStore = createPortraitStore()
  const portraits = portraitStore.base

  const existingSave = loadSave(page.storage)
  let state: GameState = createInitialState(1337, existingSave)
  scene.setActionCameraEnabled(isActionCameraEnabled(state.campaign))
  let resumableBattle: BattleSaveSnapshot | null = state.battle
    ? serializeBattleState(state.battle, state.campaign.seed)
    : null
  // Keep Title / World / Camp on the 3D camp diorama until the player resumes or starts a battle
  if (state.battle) {
    state.battle = null
  }
  const turnSaveTracker = createTurnBoundaryTracker()

  function heroCardPortrait(hero: OwnedHeroCard | undefined): HTMLCanvasElement | undefined {
    if (!hero) return undefined
    return portraitStore.getHero(hero.heroId, {
      stars: hero.stars,
      weaponId: getEquipmentByUid(state.campaign, hero.weaponUid)?.equipId,
      armorId: getEquipmentByUid(state.campaign, hero.armorUid)?.equipId,
      relicId: getEquipmentByUid(state.campaign, hero.relicUid)?.equipId
    })
  }

  function battleUnitPortrait(unit: BattleUnit | undefined): HTMLCanvasElement | undefined {
    if (!unit) return undefined
    if (unit.team === 'ally' && unit.heroId) {
      return portraitStore.getHero(unit.heroId, {
        stars: unit.stars,
        weaponId: unit.weaponId,
        armorId: unit.armorId,
        relicId: unit.relicId
      })
    }
    return portraits[unit.enemyId ?? unit.heroId ?? 'knight']
  }
  let screen: Screen = 'title'
  let campTab: CampTab = 'squad'
  let worldInspectorTab: WorldInspectorTab = 'overview'
  let activeWorldInspectorTab: WorldInspectorTab | 'all' = 'all'
  let lastInspectedStageId: string | null = null
  let codexTab: CodexTab = 'enemies'
  let codexPage = 0
  let codexSelectedId: string | null = null
  let codexReturnScreen: 'world' | 'camp' = 'world'
  let pendingChapter = CHAPTER_BY_ID[state.campaign.selectedStageId]?.index ?? getNextRecommendedStage(state.campaign).index
  let pendingEndless = 0
  const DEFAULT_STAGE_CHALLENGE: { readonly tier: StageDifficultyTier; readonly mutators: readonly StageMutatorId[] } = {
    tier: 'normal',
    mutators: []
  }
  const stageChallengePrefs = new Map<string, { tier: StageDifficultyTier; mutators: StageMutatorId[] }>()

  function getStageChallenge(stageId: string): { tier: StageDifficultyTier; mutators: StageMutatorId[] } {
    const raw = stageChallengePrefs.get(stageId)
    const resolved = resolveStageChallenge(state.campaign, stageId, raw?.tier, raw?.mutators, 0)
    return { tier: resolved.tier, mutators: resolved.mutators.slice() }
  }

  function setStageTier(stageId: string, tier: StageDifficultyTier) {
    if (!isStageCleared(state.campaign, stageId)) return
    const cur = getStageChallenge(stageId)
    stageChallengePrefs.set(stageId, { tier, mutators: cur.mutators })
    state.sounds.push({ kind: 'card', pitch: tier === 'mythic' ? 1.28 : tier === 'veteran' ? 1.15 : 0.98 })
    uiDirty = true
  }

  function toggleStageMutator(stageId: string, mutatorId: StageMutatorId) {
    if (!isStageCleared(state.campaign, stageId)) return
    const cur = getStageChallenge(stageId)
    const exists = cur.mutators.includes(mutatorId)
    const nextMutators = exists
      ? cur.mutators.filter(m => m !== mutatorId)
      : [...cur.mutators, mutatorId]
    stageChallengePrefs.set(stageId, { tier: cur.tier, mutators: nextMutators })
    state.sounds.push({ kind: 'card', pitch: exists ? 0.92 : 1.22 })
    uiDirty = true
  }
  let armorySlotFilter: ArmoryFilter = 'all'
  let armoryCompatibleFilter: 'all' | 'compatible' = 'all'
  let forgeCategory: ForgeCategory = 'heroes'
  let rosterPage = 0
  let armoryPage = 0
  let deckPage = 0
  let forgePage = 0
  let campToast = ''
  let campToastTimer = 0
  let uiDirty = true
  let hudRev = 0
  let lastSimMs = 0
  let lockedForecastCell: { col: number; row: number } | null = null
  let dangerZoneOn = false
  let combatLogOpen = false
  let weatherInspectorOpen = false
  let combatLogScroll = 0
  let combatLogSeenId = 0
  let lastCombatLogId = 0
  let hoveredTurnUnitUid: string | null = null
  let hoveredTurnSlotIdx = -1
  let hoveredActionKind: TurnActionKind | null = null
  let hoveredArmoryEquipUid: string | null = null
  let inspectedArmoryEquipUid: string | null = null
  let lastPointerType = 'mouse'
  const gridCursor = createGridCursorState()
  const gamepadTracker = createGamepadNavTracker()
  let gamepadScreenGuardFrames = 0
  let suppressUiBackUntil = 0
  const armoryEquipIdByWidget = new Map<string, string>()
  let mobileHandOpen = false
  let mobileCampCollapsed = false
  let lastForecastSig = ''
  let forecastPulseTick = 0
  let resultAnimTime = 0
  let worldMapTime = 0
  const worldMap3DCam: WorldMap3DCamera = createWorldMap3DCamera()
  let pendingWorldFlyIn: (() => void) | null = null
  let worldMapDrag: { pointerId: number; lastX: number; lastY: number; dragged: boolean; mode: 'pan' | 'orbit' } | null = null
  const worldMapTouches = new Map<number, { x: number; y: number }>()
  let worldMapPinch: { dist: number; midX: number; midY: number; angle: number } | null = null
  let selectedWorldEventId: string | null = null
  let pendingWorldEventId: string | null = null
  let packAnim: PackAnimState | null = null
  /** Hero Ascension merge ceremony / Epic+ equip fanfare overlay (presentation only). */
  let fanfare: (Omit<FanfareDrawOpts, 'elapsed'> & { elapsed: number }) | null = null

  // Phase 1 UX state: live input modality, safe-area insets, Focus Mode, phone turn pill, touch inspection & 2-tap OA
  const modalityTracker = createInputModalityTracker(detectInitialInputModality())
  const detachModalityTracker = modalityTracker.attach(window)
  const unsubscribeModality = modalityTracker.subscribe(() => {
    uiDirty = true
    hudRev++
  })
  const isLocalWebHost = !page.platform.isNative && (
    page.url.hostname === 'localhost' ||
    page.url.hostname === '127.0.0.1' ||
    page.url.hostname === '[::1]'
  )
  let otaState: OtaBannerState = createOtaBannerState()
  if (page.platform.ota.available) {
    void page.platform.ota.getStatus().then(status => {
      otaState = applyOtaStatus(otaState, status)
      uiDirty = true
    }).catch(() => {})
    const unsubOtaReady = page.platform.ota.onUpdateReady(info => {
      otaState = applyOtaUpdateReady(otaState, info)
      uiDirty = true
    })
    page.onDispose(unsubOtaReady)
  }

  function triggerOtaRestart() {
    if (otaState.applying || !page.platform.ota.available) return
    saveNow()
    otaState = { ...otaState, applying: true }
    uiDirty = true
    void page.platform.ota.applyUpdate({ reload: true }).then(applied => {
      if (!applied) {
        otaState = { ...otaState, applying: false }
        uiDirty = true
        void page.platform.ota.getStatus().then(status => {
          otaState = applyOtaStatus(otaState, status)
          uiDirty = true
        }).catch(() => {})
      }
    }).catch(() => {
      otaState = { ...otaState, applying: false }
      uiDirty = true
      void page.platform.ota.getStatus().then(status => {
        otaState = applyOtaStatus(otaState, status)
        uiDirty = true
      }).catch(() => {})
    })
  }

  function onPressDevVersionPill() {
    if (otaState.pending) {
      otaState = reopenOtaBanner(otaState)
      uiDirty = true
      return
    }
    if (!page.platform.ota.available || otaState.checking) return
    otaState = { ...otaState, checking: true }
    uiDirty = true
    void page.platform.ota.checkForUpdate()
      .then(() => page.platform.ota.getStatus())
      .then(status => {
        otaState = applyOtaStatus(otaState, status)
        uiDirty = true
      })
      .catch(() => {
        otaState = { ...otaState, checking: false }
        uiDirty = true
      })
  }

  const liveSafeArea = { top: 8, right: 8, bottom: 8, left: 8 }
  function getViewportProfile(w: number, h: number): ViewportProfile {
    const vp = computeViewportProfile(w, h, {
      modality: modalityTracker.getModality(),
      safeArea: readDomSafeAreaInsets()
    })
    liveSafeArea.top = vp.safeArea.top
    liveSafeArea.right = vp.safeArea.right
    liveSafeArea.bottom = vp.safeArea.bottom
    liveSafeArea.left = vp.safeArea.left
    return vp
  }
  let focusMode = false
  let turnTimelineExpanded = false
  let pendingOaMoveCell: { col: number; row: number; preview: PathOpportunityPreview } | null = null
  let inspectedTileCell: { col: number; row: number } | null = null
  let battleTouchInfoText = ''
  let battleTouchInfoTimer = 0
  function showBattleTouchInfo(msg: string) {
    battleTouchInfoText = msg
    battleTouchInfoTimer = 3.6
    uiDirty = true
    hudRev++
  }

  function startAscensionFanfare(hero: OwnedHeroCard) {
    const spec = HERO_SPECS[hero.heroId]
    const unlocked = getEffectiveHeroSkill(hero.heroId, hero.stars - 1, hero.stars >= 3 ? hero.subSpecId : undefined) ?? spec.skills[hero.stars - 1]
    const subSpecPrompt = hero.stars >= 3 && needsSubSpecChoice(hero)
    fanfare = {
      kind: 'ascend',
      elapsed: 0,
      title: `Ascended ${'★'.repeat(hero.stars)}`,
      subtitle: subSpecPrompt
        ? `${spec.name} reached 3★ — Pick a Mastery Path in Camp!`
        : `${spec.name}, ${getEffectiveHeroTitle(hero.heroId, hero.stars, hero.subSpecId)} — Tier ${hero.stars}`,
      accent: TIER_COLOR[hero.stars],
      portrait: heroCardPortrait(hero),
      stars: hero.stars,
      skill: unlocked
        ? { tier: unlocked.tier, name: unlocked.name, desc: unlocked.desc, vfx: unlocked.vfx, skillId: unlocked.id }
        : undefined
    }
    if (subSpecPrompt) {
      showToast(`${spec.name} ascended to 3★! Pick a Mastery Path below.`)
    }
    uiDirty = true
  }

  function startEquipFanfare(hero: OwnedHeroCard, equipId: string) {
    const spec = EQUIPMENT_BY_ID[equipId]
    if (!spec || (spec.rarity !== 'epic' && spec.rarity !== 'legendary')) return
    const meta = RARITY_META[spec.rarity]
    fanfare = {
      kind: 'equip',
      elapsed: 0,
      title: `${meta.label} Equipped!`,
      subtitle: `${spec.name} → ${HERO_SPECS[hero.heroId].name}`,
      accent: meta.hex,
      item: { slot: spec.slot, equipId: spec.id, accentHex: spec.accentHex, rarityLabel: meta.label }
    }
    state.sounds.push({ kind: 'pack', rarity: spec.rarity })
    uiDirty = true
  }

  function dismissFanfare() {
    if (!fanfare) return
    // First tap fast-forwards to the settled pose; a second tap (or the timer) closes it
    if (fanfare.elapsed < 1.6) fanfare.elapsed = 1.6
    else fanfare = null
    uiDirty = true
  }

  function readWorldMapPinch(): { dist: number; midX: number; midY: number; angle: number } | null {
    const pts = Array.from(worldMapTouches.values())
    if (pts.length < 2) return null
    const a = pts[0]
    const b = pts[1]
    return {
      dist: Math.max(12, Math.hypot(b.x - a.x, b.y - a.y)),
      midX: (a.x + b.x) * 0.5,
      midY: (a.y + b.y) * 0.5,
      angle: Math.atan2(b.y - a.y, b.x - a.x)
    }
  }

  function defaultWorldMapZoom(): number {
    const vw = renderer.canvas.clientWidth || window.innerWidth
    const vh = renderer.canvas.clientHeight || window.innerHeight
    if (vw < 900 || vh < 520) return 1.48
    if (vw < 1200 || vh < 700) return 1.18
    return 0.96
  }

  function focusWorldMapOnPoint(mapX: number, mapY: number, instant = false, targetZoom?: number) {
    // Bias slightly right on desktop/landscape so the floating right-hand inspector never covers the selected 3D landmark
    const vw = renderer.canvas.clientWidth || window.innerWidth
    const mobile = vw < 780
    const z = Math.max(0.85, targetZoom ?? worldMap3DCam.goalZoom)
    const offsetX = mobile ? 0 : 0.11 / z
    const offsetY = mobile ? 0.07 / z : 0
    focusDioramaOnStage(worldMap3DCam, mapX + offsetX, mapY + offsetY, targetZoom, instant)
  }

  function focusWorldMapOn(stage: ChapterSpec, instant = false, targetZoom?: number) {
    focusWorldMapOnPoint(stage.mapX, stage.mapY, instant, targetZoom)
  }

  function resetWorldMapOverview(instant = false) {
    pendingWorldFlyIn = null
    resetDioramaCamera(worldMap3DCam, instant)
  }

  function cancelWorldDeployFlyIn() {
    if (!pendingWorldFlyIn && !worldMap3DCam.flyIn?.active) return
    pendingWorldFlyIn = null
    worldMap3DCam.flyIn = null
    uiDirty = true
  }

  function finishWorldDeployFlyInNow() {
    const action = pendingWorldFlyIn
    pendingWorldFlyIn = null
    completeDioramaFlyIn(worldMap3DCam)
    if (action) action()
  }

  function triggerWorldDeployFlyIn(stageId: string, mapX: number, mapY: number, onComplete: () => void) {
    audio.unlock()
    // Complete immediately if paused for testing or if player taps again mid-swoop
    if (isTestingPaused() || (worldMap3DCam.flyIn && worldMap3DCam.flyIn.active)) {
      pendingWorldFlyIn = null
      completeDioramaFlyIn(worldMap3DCam)
      onComplete()
      return
    }
    pendingWorldFlyIn = onComplete
    const cw = Math.max(1, renderer.canvas.clientWidth)
    const ch = Math.max(1, renderer.canvas.clientHeight)
    startDioramaFlyIn(worldMap3DCam, stageId, mapX, mapY, undefined, cw / ch)
    state.sounds.push({ kind: 'card', pitch: 1.24 })
    uiDirty = true
  }

  function getSelectedStage(): ChapterSpec {
    return CHAPTER_BY_ID[state.campaign.selectedStageId] ?? CHAPTERS[pendingChapter] ?? CHAPTERS[0]
  }

  function startPackCeremony(packId: PackId, cards: readonly PackRevealItem[]) {
    let bestRarity: Rarity = 'common'
    for (const c of cards) {
      if (RARITY_ORDER.indexOf(c.rarity) > RARITY_ORDER.indexOf(bestRarity)) bestRarity = c.rarity
    }
    packAnim = {
      packId,
      cards,
      bestRarity,
      elapsed: 0,
      phase: 'spin',
      flipStartTimes: cards.map(() => -1),
      lastTickStep: -1,
      burstPlayed: false
    }
    uiDirty = true
  }

  function skipPackCeremony() {
    if (!packAnim) return
    if (packAnim.phase === 'spin') {
      packAnim.phase = 'reveal'
      packAnim.elapsed = PACK_SPIN_DURATION + 0.05
      packAnim.burstPlayed = true
    }
    for (let i = 0; i < packAnim.flipStartTimes.length; i++) {
      if (packAnim.flipStartTimes[i] < 0) {
        packAnim.flipStartTimes[i] = packAnim.elapsed - PACK_FLIP_DURATION
      }
    }
    packAnim.elapsed = Math.max(packAnim.elapsed, PACK_SPIN_DURATION + PACK_FLIP_DURATION + 0.2)
    uiDirty = true
  }

  function isPackCeremonyComplete(): boolean {
    if (!packAnim || packAnim.phase !== 'reveal') return false
    for (const st of packAnim.flipStartTimes) {
      if (st < 0 || (packAnim.elapsed - st) < PACK_FLIP_DURATION) return false
    }
    return true
  }

  function resolveActiveForecast(): CombatForecast | null {
    if (screen !== 'battle' || !state.battle || state.battle.facingPicker) {
      lockedForecastCell = null
      return null
    }
    if (lockedForecastCell) {
      const fc = computeCombatForecast(state, lockedForecastCell.col, lockedForecastCell.row)
      if (fc) return fc
      lockedForecastCell = null
    }
    const hov = scene.getHoveredCell()
    if (!hov) return null
    return computeCombatForecast(state, hov.col, hov.row)
  }

  function resolveHoveredMoveOa(activeForecast: CombatForecast | null): PathOpportunityPreview | null {
    const battle = state.battle
    if (screen !== 'battle' || !battle || battle.phase !== 'player' || battle.facingPicker) return null
    if (battle.units.some(u => u.path.length > 0)) return null
    if (activeForecast?.opportunityAttacks && activeForecast.opportunityAttacks.triggers.length > 0) {
      return activeForecast.opportunityAttacks
    }
    const active = getUnitByUid(battle, battle.activeUnitUid)
    if (!active || active.team !== 'ally' || !active.alive || active.moved) return null
    const hov = scene.getHoveredCell()
    if (!hov || !battle.moveTiles.some(t => t.col === hov.col && t.row === hov.row)) return null
    const path = findGridPath(battle, active, hov.col, hov.row)
    if (path.length === 0) return null
    const preview = previewPathOpportunityAttacks(battle, active, path)
    return preview.triggers.length > 0 ? preview : null
  }

  function confirmLockedForecast(): boolean {
    if (!lockedForecastCell || screen !== 'battle' || !state.battle) return false
    const { col, row } = lockedForecastCell
    lockedForecastCell = null
    mobileHandOpen = false
    const ok = selectTile(state, col, row)
    uiDirty = true
    hudRev++
    return ok
  }

  const perfLogger = createPerfLogger(perf, {
    game: 'crownshard',
    getScreen: () => screen
  })

  function saveNow() {
    if (state.battle) {
      resumableBattle = serializeBattleState(state.battle, state.campaign.seed)
    }
    persistSave(page.storage, state, resumableBattle)
  }

  function formatResumableBattleLabel(snap: BattleSaveSnapshot, compact = false): string {
    const ch = CHAPTER_BY_ID[snap.stageId] ?? CHAPTERS[snap.chapterIndex] ?? CHAPTERS[0]
    const stageLabel = snap.activeWorldEventTitle
      ? snap.activeWorldEventTitle
      : snap.endlessWave > 0
        ? `Endless W${snap.endlessWave} · ${formatEndlessBiomeLabel(snap.biome)}`
        : snap.abyssFloor
          ? `${ch.title} F${snap.abyssFloor}/${CROWNLESS_DEEP_MAX_FLOOR}`
          : snap.gauntletMaxRounds
            ? `${ch.title} R${snap.gauntletRound ?? 1}/${snap.gauntletMaxRounds}`
            : ch.title
    return compact
      ? `Resume (T${snap.turn}) · ${stageLabel}`
      : `Resume Battle — ${stageLabel} (Turn ${snap.turn})`
  }

  function resumeSavedBattle(): boolean {
    if (!resumableBattle) return false
    audio.unlock()
    const ok = restoreBattleState(state, resumableBattle)
    if (!ok || !state.battle) {
      resumableBattle = null
      syncTurnBoundaryTracker(turnSaveTracker, null)
      saveNow()
      uiDirty = true
      return false
    }
    pendingChapter = state.battle.chapterIndex
    pendingEndless = state.battle.endlessWave
    pendingWorldEventId = state.battle.activeWorldEventId ?? null
    lastBattlePhase = state.battle.phase
    lastActiveUid = state.battle.activeUnitUid
    lastBattleTurn = state.battle.turn
    resetCombatLogUi()
    syncTurnBoundaryTracker(turnSaveTracker, state.battle)
    scene.resetCamera()
    scene.setCameraYaw(0, true)
    scene.setDangerZoneVisible(dangerZoneOn)
    scene.setInspectedEnemyUid(null)
    gridCursor.col = -1
    gridCursor.row = -1
    syncBattleGridCursor(true)
    setScreen('battle')
    renderer.canvas.focus()
    return true
  }

  function discardResumableBattle(toastMsg?: string) {
    abandonBattle(state)
    resumableBattle = null
    lastBattlePhase = null
    lastActiveUid = null
    lastBattleTurn = 0
    syncTurnBoundaryTracker(turnSaveTracker, null)
    saveNow()
    if (toastMsg) showToast(toastMsg)
    uiDirty = true
    hudRev++
  }

  function retreatFromBattle() {
    discardResumableBattle()
    openCamp('squad')
  }

  function runBestFit(heroUid: string): number {
    const hero = getHeroByUid(state.campaign, heroUid)
    if (!hero) return 0
    const heroName = HERO_SPECS[hero.heroId].name
    const equipped = autoEquipBestFit(state, heroUid)
    if (equipped.length > 0) {
      saveNow()
      const names = equipped.map(it => EQUIPMENT_BY_ID[it.equipId]?.name ?? it.equipId).join(', ')
      showToast(`Best Fit equipped ${names} on ${heroName}.`)
      const targetHero = getHeroByUid(state.campaign, heroUid)
      if (targetHero) {
        const lastSpec = EQUIPMENT_BY_ID[equipped[equipped.length - 1].equipId]
        scene.triggerCampEquipFlourish(targetHero.uid, lastSpec?.slot, lastSpec?.accentHex)
        let bestRare: OwnedEquipCard | null = null
        let bestRank = -1
        for (const it of equipped) {
          const sp = EQUIPMENT_BY_ID[it.equipId]
          if (!sp || (sp.rarity !== 'epic' && sp.rarity !== 'legendary')) continue
          const rank = RARITY_ORDER.indexOf(sp.rarity)
          if (rank > bestRank) { bestRank = rank; bestRare = it }
        }
        if (bestRare) startEquipFanfare(targetHero, bestRare.equipId)
      }
    } else {
      showToast(`${heroName} is already wearing the best unequipped gear.`)
    }
    return equipped.length
  }

  function showToast(msg: string) {
    campToast = msg
    campToastTimer = 3.2
    uiDirty = true
  }

  function clearArmoryHover(clearInspected = false) {
    hoveredArmoryEquipUid = null
    if (clearInspected) inspectedArmoryEquipUid = null
  }

  function setCampTab(next: CampTab) {
    campTab = next
    clearArmoryHover(true)
    if (screen === 'camp') {
      scene.setCampFraming(next === 'armory' ? 'armory' : 'camp')
    }
  }

  function clearBattleHoverFeedback() {
    if (hoveredTurnUnitUid !== null || hoveredTurnSlotIdx !== -1 || hoveredActionKind !== null) {
      hoveredTurnUnitUid = null
      hoveredTurnSlotIdx = -1
      hoveredActionKind = null
      scene.setSpotlightUnit(null)
    }
  }

  function resolveTurnActionPreviewKind(activeForecast: CombatForecast | null): TurnActionKind | null {
    const battle = state.battle
    if (screen !== 'battle' || !battle || battle.phase !== 'player') return null
    if (battle.units.some(u => u.path.length > 0)) return null
    const active = getUnitByUid(battle, battle.activeUnitUid)
    if (!active || active.team !== 'ally') return null

    if (hoveredActionKind) return hoveredActionKind
    if (battle.facingPicker) return 'wait'
    if (activeForecast && activeForecast.mode !== 'tactic') {
      return activeForecast.requiresMove || active.moved ? 'move_and_act' : 'act'
    }
    const hov = scene.getHoveredCell()
    if (hov && !active.moved && battle.moveTiles.some(t => t.col === hov.col && t.row === hov.row)) {
      return 'move_only'
    }
    return null
  }

  function setScreen(next: Screen) {
    screen = next
    focusMode = false
    turnTimelineExpanded = false
    pendingOaMoveCell = null
    inspectedTileCell = null
    battleTouchInfoText = ''
    battleTouchInfoTimer = 0
    if (next === 'paused' || next === 'victory' || next === 'defeat') {
      cancelAutoBattle(state)
    }
    gamepadScreenGuardFrames = 2
    lockedForecastCell = null
    mobileHandOpen = false
    if (next !== 'battle') {
      combatLogOpen = false
      weatherInspectorOpen = false
      combatLogScroll = 0
      scene.setGridCursor(null)
    } else if (state.battle) {
      syncBattleGridCursor(false)
    }
    clearBattleHoverFeedback()
    clearArmoryHover(true)
    if (next !== 'camp') { packAnim = null; fanfare = null }
    if (next !== 'world') {
      pendingWorldFlyIn = null
      worldMap3DCam.flyIn = null
      worldMapDrag = null
      worldMapTouches.clear()
      worldMapPinch = null
    }
    if (next === 'victory' || next === 'defeat') resultAnimTime = 0
    if (next === 'title' || next === 'camp' || next === 'codex' || next === 'story' || next === 'world') {
      scene.setCampFraming(next === 'camp' && campTab === 'armory' ? 'armory' : next === 'codex' ? 'camp' : next)
      scene.setForecast(null)
    }
    if (next === 'world') audio.setMusicMode('world')
    else if (next === 'battle' && state.battle) audio.setMusicMode('battle', state.battle.biome)
    else if (next === 'camp' || next === 'title' || next === 'story') audio.setMusicMode('camp')
    uiDirty = true
    hudRev++
  }

  function openCodex(tab?: CodexTab) {
    if (screen === 'world' || screen === 'camp') {
      codexReturnScreen = screen
    }
    if (tab) {
      codexTab = tab
      codexPage = 0
      codexSelectedId = null
    }
    state.sounds.push({ kind: 'card', pitch: 1.08 })
    setScreen('codex')
  }

  function closeCodex() {
    state.sounds.push({ kind: 'card', pitch: 0.92 })
    if (codexReturnScreen === 'camp') {
      openCamp(campTab)
    } else {
      openWorldMap()
    }
  }

  function selectCodexTab(tab: CodexTab) {
    if (codexTab === tab) return
    codexTab = tab
    codexPage = 0
    codexSelectedId = null
    state.sounds.push({ kind: 'card', pitch: 1.05 })
    uiDirty = true
  }

  function openWorldMap(selectStageId?: string) {
    state.battle = null
    packAnim = null
    selectedWorldEventId = null
    pendingWorldEventId = null
    if (selectStageId && CHAPTER_BY_ID[selectStageId]) {
      state.campaign.selectedStageId = selectStageId
      pendingChapter = CHAPTER_BY_ID[selectStageId].index
    } else if (!CHAPTER_BY_ID[state.campaign.selectedStageId]) {
      const rec = getNextRecommendedStage(state.campaign)
      state.campaign.selectedStageId = rec.id
      pendingChapter = rec.index
    } else {
      pendingChapter = CHAPTER_BY_ID[state.campaign.selectedStageId].index
    }
    pendingEndless = 0
    const targetZoom = defaultWorldMapZoom()
    const selectedStage = CHAPTER_BY_ID[state.campaign.selectedStageId] ?? CHAPTERS[0]
    if (targetZoom > 1.05 && selectedStage) {
      resetWorldMapOverview(true)
      focusWorldMapOn(selectedStage, true, targetZoom)
    } else {
      resetWorldMapOverview(true)
    }
    setScreen('world')
  }

  function openCamp(tab: CampTab = campTab) {
    state.battle = null
    const unlockedTabs = getUnlockedCampTabs(state.campaign)
    const fallbackTab: CampTab = fromCampTabId(unlockedTabs[0] ?? 'squad')
    campTab = unlockedTabs.length > 0 && !isCampTabUnlocked(state.campaign, toCampTabId(tab))
      ? fallbackTab
      : tab
    mobileCampCollapsed = false
    const sel = getSelectedStage()
    pendingChapter = sel.index
    pendingEndless = 0
    if (!getHeroByUid(state.campaign, state.campaign.selectedCampHeroUid)) {
      state.campaign.selectedCampHeroUid = state.campaign.squadUids[0] ?? state.campaign.heroes[0]?.uid ?? null
    }
    setScreen('camp')
  }

  function openStory(chapterIndex: number, endlessWave = 0) {
    state.battle = null
    pendingWorldEventId = null
    pendingChapter = Math.max(0, Math.min(CHAPTERS.length - 1, chapterIndex))
    state.campaign.selectedStageId = CHAPTERS[pendingChapter].id
    pendingEndless = endlessWave
    setScreen('story')
  }

  function launchWorldEventBattle(eventId: string) {
    audio.unlock()
    resumableBattle = null
    const battle = startWorldEventBattle(state, eventId, { deployPhase: true })
    if (!battle) {
      selectedWorldEventId = null
      pendingWorldEventId = null
      showToast('This road event is no longer active.')
      uiDirty = true
      return
    }
    pendingWorldEventId = eventId
    pendingChapter = battle.chapterIndex
    pendingEndless = 0
    lastBattlePhase = battle.phase
    lastActiveUid = battle.activeUnitUid
    lastBattleTurn = battle.turn
    resetCombatLogUi()
    syncTurnBoundaryTracker(turnSaveTracker, state.battle)
    scene.resetCamera()
    scene.setCameraYaw(0, true)
    scene.setDangerZoneVisible(dangerZoneOn)
    scene.setInspectedEnemyUid(null)
    gridCursor.col = -1
    gridCursor.row = -1
    syncBattleGridCursor(true)
    setScreen('battle')
    renderer.canvas.focus()
  }

  function launchBattle() {
    if (pendingWorldEventId && getWorldMapEventById(state.campaign, pendingWorldEventId)) {
      launchWorldEventBattle(pendingWorldEventId)
      return
    }
    pendingWorldEventId = null
    audio.unlock()
    resumableBattle = null
    const chapterId = CHAPTERS[pendingChapter]?.id ?? CHAPTERS[0].id
    const challenge = pendingEndless === 0 ? getStageChallenge(chapterId) : DEFAULT_STAGE_CHALLENGE
    const abyssFloor = pendingEndless === 0 && isCrownlessDeepStage(chapterId)
      ? getSelectedCrownlessDeepFloor(state.campaign)
      : undefined
    startChapterBattle(state, pendingChapter, pendingEndless, {
      deployPhase: true,
      tier: challenge.tier,
      mutators: challenge.mutators,
      ...(abyssFloor !== undefined ? { abyssFloor } : {})
    })
    lastBattlePhase = state.battle?.phase ?? null
    lastActiveUid = state.battle?.activeUnitUid ?? null
    lastBattleTurn = state.battle?.turn ?? 0
    resetCombatLogUi()
    syncTurnBoundaryTracker(turnSaveTracker, state.battle)
    scene.resetCamera()
    scene.setCameraYaw(0, true)
    scene.setDangerZoneVisible(dangerZoneOn)
    scene.setInspectedEnemyUid(null)
    gridCursor.col = -1
    gridCursor.row = -1
    syncBattleGridCursor(true)
    setScreen('battle')
    renderer.canvas.focus()
  }

  function confirmDeployAndStart(): boolean {
    audio.unlock()
    if (!state.battle || state.battle.phase !== 'deploy') return false
    if (!confirmDeployment(state)) return false
    pendingOaMoveCell = null
    inspectedTileCell = null
    lastBattlePhase = state.battle.phase
    lastActiveUid = state.battle.activeUnitUid
    lastBattleTurn = state.battle.turn
    syncBattleGridCursor(true)
    if (shouldAutoSaveOnTurnBoundary(turnSaveTracker, state.battle)) {
      saveNow()
    }
    uiDirty = true
    hudRev++
    return true
  }

  function rotateSelectedDeployUnit(): boolean {
    audio.unlock()
    if (!state.battle || state.battle.phase !== 'deploy') return false
    if (!rotateDeployUnit(state)) return false
    uiDirty = true
    hudRev++
    return true
  }

  function startCampaign(fresh = false) {
    audio.unlock()
    if (fresh) {
      resumableBattle = null
      syncTurnBoundaryTracker(turnSaveTracker, null)
      clearSave(page.storage)
      state = createInitialState((Date.now() & 0xffff) || 1337)
      scene.setActionCameraEnabled(isActionCameraEnabled(state.campaign))
      saveNow()
    }
    // P1: New players launch directly into Battle 1 (Border Watch); World Map reveals after Victory 1
    if (shouldLaunchDirectlyIntoBattle1(state.campaign)) {
      const firstStage = CHAPTER_BY_ID.border_watch ?? CHAPTERS[0]
      state.campaign.selectedStageId = firstStage.id
      pendingChapter = firstStage.index
      pendingEndless = 0
      launchBattle()
    } else {
      openWorldMap(fresh ? CHAPTERS[0].id : getNextRecommendedStage(state.campaign).id)
    }
  }

  function commitWaitFacing(dir?: FacingDir): boolean {
    if (!state.battle || state.battle.phase !== 'player' || !state.battle.facingPicker) return false
    if (!confirmWaitFacingPicker(state, dir)) return false
    lockedForecastCell = null
    mobileHandOpen = false
    clearBattleHoverFeedback()
    if (shouldAutoSaveOnTurnBoundary(turnSaveTracker, state.battle)) saveNow()
    uiDirty = true
    hudRev++
    return true
  }

  function endBattleTurn() {
    audio.unlock()
    if (state.battle?.phase === 'player') {
      lockedForecastCell = null
      pendingOaMoveCell = null
      inspectedTileCell = null
      mobileHandOpen = false
      if (state.battle.facingPicker) {
        commitWaitFacing()
      } else if (beginWaitFacingPicker(state)) {
        clearBattleHoverFeedback()
        scene.setGridCursor(null)
        scene.setHoveredCell(null)
        scene.setForecast(null)
        refreshBattleDiscoveryTips(false)
        uiDirty = true
        hudRev++
      }
    }
  }

  function performUndoMove(): boolean {
    if (!state.battle || !canUndoMove(state.battle)) return false
    audio.unlock()
    const uid = state.battle.activeUnitUid
    if (!undoMove(state)) return false
    lockedForecastCell = null
    pendingOaMoveCell = null
    inspectedTileCell = null
    mobileHandOpen = false
    const restored = uid ? getUnitByUid(state.battle, uid) : undefined
    if (restored) scene.snapUnit(restored)
    uiDirty = true
    hudRev++
    return true
  }

  function toggleDangerZone() {
    audio.unlock()
    dangerZoneOn = !dangerZoneOn
    scene.setDangerZoneVisible(dangerZoneOn)
    state.sounds.push({ kind: 'card', pitch: dangerZoneOn ? 1.18 : 0.92 })
    uiDirty = true
    hudRev++
  }

  function latestBattleLogId(): number {
    const log = state.battle?.combatLog
    return log && log.length > 0 ? log[log.length - 1].id : 0
  }

  function resetCombatLogUi() {
    const latest = latestBattleLogId()
    combatLogOpen = false
    weatherInspectorOpen = false
    combatLogScroll = 0
    combatLogSeenId = latest
    lastCombatLogId = latest
  }

  function toggleCombatLog() {
    audio.unlock()
    combatLogOpen = !combatLogOpen
    if (combatLogOpen) weatherInspectorOpen = false
    combatLogScroll = 0
    combatLogSeenId = latestBattleLogId()
    state.sounds.push({ kind: 'card', pitch: combatLogOpen ? 1.15 : 0.95 })
    uiDirty = true
    hudRev++
  }

  function scrollCombatLog(delta: number, visibleRows: number) {
    const total = state.battle?.combatLog.length ?? 0
    const maxScroll = getMaxCombatLogScroll(total, visibleRows)
    const next = Math.max(0, Math.min(maxScroll, combatLogScroll + delta))
    if (next === combatLogScroll) return
    combatLogScroll = next
    uiDirty = true
    hudRev++
  }

  function handleToggleBattleSpeed(): BattleSpeedMultiplier {
    audio.unlock()
    const next = toggleBattleSpeed(state)
    state.sounds.push({ kind: 'card', pitch: next === 2 ? 1.28 : 0.96 })
    saveNow()
    uiDirty = true
    hudRev++
    return next
  }

  function handleToggleAutoBattle(): boolean {
    audio.unlock()
    const next = toggleAutoBattle(state)
    if (next) {
      lockedForecastCell = null
      pendingOaMoveCell = null
      inspectedTileCell = null
      mobileHandOpen = false
      clearBattleHoverFeedback()
      scene.setForecast(null)
    }
    state.sounds.push({ kind: 'card', pitch: next ? 1.24 : 0.88 })
    uiDirty = true
    hudRev++
    return next
  }

  function togglePauseScreen() {
    audio.unlock()
    if (screen === 'battle') {
      cancelAutoBattle(state)
      setScreen('paused')
    } else if (screen === 'paused') setScreen('battle')
  }

  function toggleMusic() {
    audio.unlock()
    audio.setMusic(!audio.isMusicEnabled())
    uiDirty = true
  }

  function toggleMute() {
    audio.unlock()
    audio.setMuted(!audio.isMuted())
    uiDirty = true
  }

  function togglePerfOverlay() {
    showPerfPanel = !showPerfPanel
    uiDirty = true
    hudRev++
  }

  function refreshBattleDiscoveryTips(includeHover = true) {
    if (!state.battle) return
    const prev = state.battle.activeTipId
    const fc = includeHover ? resolveActiveForecast() : null
    const hoveredCell = includeHover ? scene.getHoveredCell() : null
    const pathOa = includeHover ? resolveHoveredMoveOa(fc) : null
    checkDiscoveryTipForBattle(state, { hoveredCell, forecast: fc, pathOa })
    if (state.battle.activeTipId !== prev) {
      uiDirty = true
      hudRev++
    }
  }

  function dismissCurrentDiscoveryTip(): boolean {
    const dismissed = dismissDiscoveryTip(state)
    if (!dismissed) return false
    state.sounds.push({ kind: 'card', pitch: 1.06 })
    saveNow()
    uiDirty = true
    hudRev++
    return true
  }

  function skipAllTipsNow() {
    skipAllDiscoveryTips(state)
    state.sounds.push({ kind: 'card', pitch: 0.9 })
    saveNow()
    uiDirty = true
    hudRev++
  }

  function toggleDiscoveryTipsSetting() {
    audio.unlock()
    const nextEnabled = !areDiscoveryTipsEnabled(state.campaign)
    setDiscoveryTipsEnabled(state, nextEnabled)
    if (nextEnabled && state.battle) {
      checkDiscoveryTipForBattle(state)
    }
    state.sounds.push({ kind: 'card', pitch: nextEnabled ? 1.12 : 0.92 })
    saveNow()
    uiDirty = true
    hudRev++
  }

  function toggleActionCameraSetting() {
    audio.unlock()
    const nextEnabled = !isActionCameraEnabled(state.campaign)
    setActionCameraEnabled(state, nextEnabled)
    scene.setActionCameraEnabled(nextEnabled)
    state.sounds.push({ kind: 'card', pitch: nextEnabled ? 1.12 : 0.92 })
    saveNow()
    uiDirty = true
    hudRev++
  }

  function resetDiscoveryTipsNow() {
    audio.unlock()
    resetDiscoveryTips(state)
    if (state.battle) {
      checkDiscoveryTipForBattle(state)
    }
    state.sounds.push({ kind: 'card', pitch: 1.18 })
    saveNow()
    uiDirty = true
    hudRev++
  }

  function openPendingEndlessDraft(): boolean {
    const run = state.campaign.endlessRun
    if (!run || run.pendingDraft.length === 0) return false
    audio.unlock()
    resultAnimTime = 1
    setScreen('victory')
    return true
  }

  function pickEndlessBlessingAndAdvance(blessingId: EndlessBlessingId) {
    audio.unlock()
    if (!draftEndlessBlessing(state, blessingId)) return
    saveNow()
    const run = state.campaign.endlessRun
    const nextWave = run ? run.currentWave : ((state.battle?.endlessWave ?? 0) + 1)
    const sel = run
      ? selectEndlessWaveStage(run.seed, nextWave, run.lastBiome)
      : selectEndlessWaveStage(state.campaign.seed, nextWave)
    pendingChapter = sel.chapter.index
    pendingEndless = nextWave
    launchBattle()
  }

  function retryAfterDefeat() {
    if ((state.battle?.endlessWave ?? 0) > 0) {
      const run = startEndlessRun(state, 1)
      saveNow()
      const sel = selectEndlessWaveStage(run.seed, 1)
      pendingChapter = sel.chapter.index
      pendingEndless = 1
    }
    launchBattle()
  }

  function advanceAfterVictory() {
    if (isEndlessUnlocked(state.campaign) && (state.battle?.endlessWave ?? 0) > 0) {
      const run = state.campaign.endlessRun ?? startEndlessRun(state, (state.battle?.endlessWave ?? 0) + 1)
      const nextWave = Math.max(run.currentWave, (state.battle?.endlessWave ?? 0) + 1)
      run.currentWave = nextWave
      run.pendingDraft = []
      saveNow()
      const sel = selectEndlessWaveStage(run.seed, nextWave, run.lastBiome)
      pendingChapter = sel.chapter.index
      pendingEndless = nextWave
      launchBattle()
    } else if (state.battle?.abyssFloor && state.battle.abyssFloor < CROWNLESS_DEEP_MAX_FLOOR) {
      setSelectedCrownlessDeepFloor(state.campaign, state.battle.abyssFloor + 1)
      openStory(CHAPTER_BY_ID.abyssal_deep.index, 0)
    } else {
      const nextStage = getNextRecommendedStage(state.campaign)
      openWorldMap(nextStage.id)
    }
  }

  // Modern dark glass + warm gold accent UI theme
  const ui = createCanvasUi(uiCanvas, {
    theme: createUiTheme(UI_THEME_PALETTE),
    safeArea: liveSafeArea,
    keyboardEnabled: () => screen !== 'battle',
    onBack: () => {
      if (performance.now() < suppressUiBackUntil) return
      if (focusMode) { focusMode = false; uiDirty = true; hudRev++; return }
      if (fanfare) dismissFanfare()
      else if (packAnim) {
        if (isPackCeremonyComplete()) { packAnim = null; uiDirty = true }
        else skipPackCeremony()
      } else if (screen === 'paused') setScreen('battle')
      else if (screen === 'codex') closeCodex()
      else if (screen === 'story') openWorldMap()
      else if (screen === 'camp') openWorldMap()
    }
  })

  function buildExitFocusPill(vp: ViewportProfile): LayoutNode {
    const pillH = Math.max(44, vp.minTouchTarget)
    const pillW = 132
    return boxNode({
      id: 'cs-exit-focus',
      style: {
        anchor: 'top-right',
        width: pillW,
        height: pillH,
        inset: [8, 8],
        respectSafeArea: true
      },
      widget: {
        type: 'button',
        label: 'Exit Focus',
        primary: true,
        onPress: () => {
          audio.unlock()
          focusMode = false
          state.sounds.push({ kind: 'card', pitch: 0.96 })
          uiDirty = true
          hudRev++
        },
        draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
          ctx,
          rect,
          uiCopy(vp.isTouchPrimary, 'Exit Focus (H)', 'Exit Focus'),
          st,
          { variant: 'primary', icon: 'close', size: 12 }
        )
      }
    })
  }

  function buildScreenDiscoveryTipNode(
    screenKey: DiscoveryTipScreen,
    tip: DiscoveryTipSpec,
    vp: ViewportProfile,
    opts: {
      anchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom'
      width: number
      inset: [number, number]
    }
  ): LayoutNode {
    const compact = vp.isPhone
    const tipBtnH = vp.isTouchPrimary || vp.isPhone ? 32 : 26
    const tipH = compact ? 120 : 126
    const localizedTip: DiscoveryTipSpec = {
      ...tip,
      body: getDiscoveryTipBody(tip, vp.isTouchPrimary),
      hotkeyHint: getDiscoveryTipHotkey(tip, vp.isTouchPrimary)
    }
    return column({
      id: 'discovery-tip-card',
      style: {
        anchor: opts.anchor,
        width: opts.width,
        height: tipH,
        inset: opts.inset,
        padding: compact ? [6, 10] : [6, 12],
        gap: 0,
        respectSafeArea: true
      },
      widget: {
        type: 'panel',
        blocksPointer: true,
        draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawDiscoveryTipCard(ctx, rect, localizedTip, {
          compact,
          queuedCount: state.campaign.screenTipQueue?.length ?? 0,
          isTouch: vp.isTouchPrimary
        })
      }
    }, [
      spacerNode(1),
      row({
        id: 'discovery-tip-actions',
        style: { height: tipBtnH, gap: 6, align: 'center' }
      }, [
        boxNode({
          id: 'cs-tip-skip-all',
          style: { width: compact ? 86 : 92, height: tipBtnH },
          widget: {
            type: 'button',
            label: 'Skip Tips',
            onPress: () => {
              audio.unlock()
              skipAllTipsNow()
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, 'Skip Tips', st, { variant: 'ghost', size: compact ? 10.5 : 11 }
            )
          }
        }),
        spacerNode(1),
        boxNode({
          id: 'cs-tip-dismiss',
          style: { width: compact ? 84 : 96, height: tipBtnH },
          widget: {
            type: 'button',
            label: 'Got it',
            primary: true,
            onPress: () => {
              audio.unlock()
              dismissScreenDiscoveryTip(state.campaign, screenKey)
              state.sounds.push({ kind: 'card', pitch: 1.06 })
              saveNow()
              uiDirty = true
              hudRev++
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx,
              rect,
              uiCopy(vp.isTouchPrimary, 'Got it (↵)', 'Got it'),
              st,
              { variant: 'primary', size: compact ? 10.5 : 11.5 }
            )
          }
        })
      ])
    ])
  }

  function syncBattleGridCursor(snapToAnchor = false) {
    const battle = state.battle
    if (!battle) {
      scene.setGridCursor(null)
      return
    }
    syncGridCursorToBattle(gridCursor, battle, snapToAnchor)
    if (gridCursor.active && !battle.facingPicker && (battle.phase === 'player' || battle.phase === 'deploy')) {
      scene.setHoveredCell({ col: gridCursor.col, row: gridCursor.row })
      scene.setGridCursor({
        col: gridCursor.col,
        row: gridCursor.row,
        active: true,
        mode: resolveGridCursorVisualMode(battle, gridCursor.col, gridCursor.row)
      })
    } else {
      scene.setGridCursor(null)
    }
  }

  function deactivateGridCursor() {
    if (!gridCursor.active && gridCursor.inputMode === 'pointer') return
    gridCursor.active = false
    gridCursor.inputMode = 'pointer'
    scene.setGridCursor(null)
  }

  function confirmBoardTile(col: number, row: number): boolean {
    if (screen !== 'battle' || !state.battle) return false
    const autoWasOn = state.battle.autoBattle
    lockedForecastCell = null
    mobileHandOpen = false
    const tileChanged = selectTile(state, col, row)
    if (tileChanged) refreshBattleDiscoveryTips(false)
    if (tileChanged || autoWasOn !== state.battle.autoBattle) {
      uiDirty = true
      hudRev++
    }
    syncBattleGridCursor(false)
    return tileChanged
  }

  function moveBattleGridCursor(dx: -1 | 0 | 1, dy: -1 | 0 | 1, mode: GridCursorInputMode) {
    const battle = state.battle
    if (screen !== 'battle' || !battle) return
    if (battle.facingPicker && battle.phase === 'player') {
      const dir = screenDirToFacing(dx, dy, scene.getCameraYawActual())
      if (previewWaitFacing(state, dir)) {
        uiDirty = true
        hudRev++
      }
      return
    }
    gridCursor.inputMode = mode
    if (!gridCursor.active) {
      syncGridCursorToBattle(gridCursor, battle, gridCursor.col < 0 || gridCursor.row < 0)
      gridCursor.active = true
    }
    stepGridCursorScreenDir(gridCursor, dx, dy, battle.cols, battle.rows, scene.getCameraYawActual())
    scene.setHoveredCell({ col: gridCursor.col, row: gridCursor.row })
    scene.setGridCursor({
      col: gridCursor.col,
      row: gridCursor.row,
      active: true,
      mode: resolveGridCursorVisualMode(battle, gridCursor.col, gridCursor.row)
    })
    refreshBattleDiscoveryTips(true)
    uiDirty = true
    hudRev++
  }

  function cycleBattleGridCursor(direction: 1 | -1, mode: GridCursorInputMode): boolean {
    const battle = state.battle
    if (screen !== 'battle' || !battle || battle.facingPicker) return false
    gridCursor.inputMode = mode
    const cycled = cycleGridCursorTarget(gridCursor, battle, direction)
    if (cycled) {
      scene.setHoveredCell({ col: gridCursor.col, row: gridCursor.row })
      scene.setGridCursor({
        col: gridCursor.col,
        row: gridCursor.row,
        active: true,
        mode: resolveGridCursorVisualMode(battle, gridCursor.col, gridCursor.row)
      })
      refreshBattleDiscoveryTips(true)
      uiDirty = true
      hudRev++
      return true
    }
    if (battle.activeUnitUid) {
      selectHeroByUid(state, battle.activeUnitUid)
      uiDirty = true
      hudRev++
    }
    return false
  }

  function snapCursorBackToAnchor(): boolean {
    const battle = state.battle
    if (!battle || !gridCursor.active) return false
    const prevCol = gridCursor.col
    const prevRow = gridCursor.row
    syncGridCursorToBattle(gridCursor, battle, true)
    if (gridCursor.col !== prevCol || gridCursor.row !== prevRow) {
      scene.setHoveredCell({ col: gridCursor.col, row: gridCursor.row })
      scene.setGridCursor({
        col: gridCursor.col,
        row: gridCursor.row,
        active: true,
        mode: resolveGridCursorVisualMode(battle, gridCursor.col, gridCursor.row)
      })
      refreshBattleDiscoveryTips(true)
      uiDirty = true
      hudRev++
      return true
    }
    return false
  }

  function handleBattleCancelAction(allowPause = true): boolean {
    const battle = state.battle
    if (screen !== 'battle' || !battle) return false
    if (focusMode) {
      focusMode = false
      state.sounds.push({ kind: 'card', pitch: 0.94 })
      uiDirty = true
      hudRev++
      return true
    }
    if (pendingOaMoveCell || inspectedTileCell) {
      pendingOaMoveCell = null
      inspectedTileCell = null
      uiDirty = true
      hudRev++
      return true
    }
    if (cancelAutoBattle(state)) {
      state.sounds.push({ kind: 'card', pitch: 0.88 })
      uiDirty = true
      hudRev++
      return true
    }
    if (battle.facingPicker) {
      if (cancelWaitFacingPicker(state)) {
        syncBattleGridCursor(false)
        uiDirty = true
        hudRev++
      }
      return true
    }
    if (lockedForecastCell || mobileHandOpen || combatLogOpen || weatherInspectorOpen) {
      lockedForecastCell = null
      mobileHandOpen = false
      combatLogOpen = false
      weatherInspectorOpen = false
      uiDirty = true
      hudRev++
      return true
    }
    if (battle.armedSkillIndex !== null || battle.armedTacticUid) {
      armSkill(state, null)
      armTacticCard(state, null)
      syncBattleGridCursor(false)
      uiDirty = true
      hudRev++
      return true
    }
    if (battle.phase === 'deploy' && battle.selectedUnitUid) {
      battle.selectedUnitUid = null
      state.sounds.push({ kind: 'card', pitch: 0.92 })
      uiDirty = true
      hudRev++
      return true
    }
    if (snapCursorBackToAnchor()) {
      return true
    }
    if (allowPause) {
      setScreen('paused')
      return true
    }
    return false
  }

  function cycleActiveHeroSkill(): boolean {
    const battle = state.battle
    if (!battle || battle.phase !== 'player') return false
    const active = getUnitByUid(battle, battle.activeUnitUid)
    if (!active || active.team !== 'ally' || active.acted || active.stunTurns > 0) return false
    const readySkills: number[] = []
    for (let i = 0; i < 3; i++) {
      const sk = getHeroSkill(active, i)
      if (sk && active.cooldowns[i] <= 0 && sk.target !== 'self') {
        readySkills.push(i)
      }
    }
    if (readySkills.length === 0) {
      if (battle.armedSkillIndex !== null) {
        armSkill(state, null)
        syncBattleGridCursor(false)
        uiDirty = true
        hudRev++
        return true
      }
      return false
    }
    const curIdx = battle.armedSkillIndex !== null ? readySkills.indexOf(battle.armedSkillIndex) : -1
    const nextSkill = curIdx === -1
      ? readySkills[0]
      : curIdx + 1 < readySkills.length
        ? readySkills[curIdx + 1]
        : null
    const ok = armSkill(state, nextSkill)
    if (ok) {
      syncBattleGridCursor(false)
      uiDirty = true
      hudRev++
    }
    return ok
  }

  function readPrimaryGamepadSnapshot(): GamepadSnapshot | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null
    let pads: (Gamepad | null)[] | null = null
    try {
      pads = navigator.getGamepads()
    } catch {
      return null
    }
    if (!pads) return null
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i]
      if (!p || !p.connected) continue
      const axes: number[] = []
      for (let a = 0; a < p.axes.length; a++) axes.push(p.axes[a] ?? 0)
      const buttons: boolean[] = []
      for (let b = 0; b < p.buttons.length; b++) {
        const btn = p.buttons[b]
        buttons.push(Boolean(btn && (btn.pressed || btn.value > 0.5)))
      }
      return { axes, buttons }
    }
    return null
  }

  function dispatchGamepadActions(dt: number) {
    if (isTestingPaused()) return
    const actions = pollGamepadActions(gamepadTracker, readPrimaryGamepadSnapshot(), dt)
    if (gamepadScreenGuardFrames > 0) {
      gamepadScreenGuardFrames--
      return
    }
    if (actions.length === 0) return

    for (let i = 0; i < actions.length; i++) {
      const act = actions[i]
      if (screen === 'battle' && state.battle) {
        if (act.kind === 'move') {
          moveBattleGridCursor(act.dx, act.dy, 'gamepad')
        } else if (act.kind === 'confirm') {
          audio.unlock()
          if (state.battle.facingPicker && state.battle.phase === 'player') {
            commitWaitFacing()
          } else if (getActiveDiscoveryTip(state)) {
            dismissCurrentDiscoveryTip()
          } else {
            gridCursor.inputMode = 'gamepad'
            if (!gridCursor.active) {
              syncGridCursorToBattle(gridCursor, state.battle, gridCursor.col < 0 || gridCursor.row < 0)
              gridCursor.active = true
            }
            confirmBoardTile(gridCursor.col, gridCursor.row)
          }
        } else if (act.kind === 'cancel') {
          const prevScreen = screen
          handleBattleCancelAction(true)
          if (screen !== prevScreen) {
            suppressUiBackUntil = performance.now() + 180
          }
        } else if (act.kind === 'actionX') {
          audio.unlock()
          if (state.battle.phase === 'deploy') {
            rotateSelectedDeployUnit()
          } else if (state.battle.phase === 'player') {
            cycleActiveHeroSkill()
          }
        } else if (act.kind === 'actionY') {
          audio.unlock()
          if (state.battle.phase === 'deploy') {
            confirmDeployAndStart()
          } else if (state.battle.phase === 'player') {
            endBattleTurn()
          }
        } else if (act.kind === 'prev') {
          cycleBattleGridCursor(-1, 'gamepad')
        } else if (act.kind === 'next') {
          cycleBattleGridCursor(1, 'gamepad')
        } else if (act.kind === 'camLeft') {
          scene.snapCameraYaw(-1)
          uiDirty = true
          hudRev++
        } else if (act.kind === 'camRight') {
          scene.snapCameraYaw(1)
          uiDirty = true
          hudRev++
        } else if (act.kind === 'pause') {
          const prevScreen = screen
          togglePauseScreen()
          if (screen !== prevScreen) {
            suppressUiBackUntil = performance.now() + 180
          }
        }
      } else if (act.kind === 'pause') {
        audio.unlock()
        if (screen === 'paused') {
          setScreen('battle')
        } else if (screen === 'title') {
          ui.act('cs-play', 'press')
        } else if (screen === 'story') {
          launchBattle()
        } else if (screen === 'victory') {
          const run = state.campaign.endlessRun
          if (!run || run.pendingDraft.length === 0) advanceAfterVictory()
        } else if (screen === 'defeat') {
          retryAfterDefeat()
        } else if (screen === 'world') {
          const sel = getSelectedStage()
          if (isStageUnlocked(state.campaign, sel.id)) {
            triggerWorldDeployFlyIn(sel.id, sel.mapX, sel.mapY, () => openStory(sel.index, 0))
          }
        }
      }
    }
  }

  // Direct 3D Battlefield Pointer Picking + Touch Drag-Orbit + Pinch-to-Zoom + Tap-to-Preview
  const inputAbort = new AbortController()
  const sig = { signal: inputAbort.signal }

  interface BoardDrag {
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    dragged: boolean
    pointerType: string
    button: number
  }
  interface PinchState {
    dist: number
    midX: number
    midY: number
    angle: number
  }
  let boardDrag: BoardDrag | null = null
  const activeTouches = new Map<number, { x: number; y: number }>()
  let pinchState: PinchState | null = null
  let suppressTouchTap = false

  function readTouchPinch(): PinchState | null {
    if (activeTouches.size < 2) return null
    const pts = Array.from(activeTouches.values())
    const a = pts[0]
    const b = pts[1]
    return {
      dist: Math.max(12, Math.hypot(b.x - a.x, b.y - a.y)),
      midX: (a.x + b.x) * 0.5,
      midY: (a.y + b.y) * 0.5,
      angle: Math.atan2(b.y - a.y, b.x - a.x)
    }
  }

  function pointerToCss(event: PointerEvent) {
    const box = uiCanvas.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top, w: box.width, h: box.height }
  }

  uiCanvas.addEventListener('pointermove', event => {
    if (isTestingPaused()) return
    lastPointerType = event.pointerType || 'mouse'
    const { x, y, w, h } = pointerToCss(event)
    if (screen === 'camp' && campTab === 'armory' && !packAnim) {
      if (event.pointerType !== 'touch') {
        const uiHit = ui.hitTest(x, y)
        const isDockHit = Boolean(
          uiHit && (
            uiHit.id.startsWith('arm-diff') ||
            uiHit.id.startsWith('arm-temper') ||
            uiHit.id === 'arm-confirm-equip' ||
            uiHit.id === 'arm-dismiss-diff' ||
            uiHit.id === 'arm-fuse-upgrade' ||
            uiHit.id === 'arm-gold-upgrade'
          )
        )
        if (!isDockHit) {
          const nextEquipUid = uiHit ? (armoryEquipIdByWidget.get(uiHit.id) ?? null) : null
          if (nextEquipUid !== hoveredArmoryEquipUid) {
            hoveredArmoryEquipUid = nextEquipUid
            uiDirty = true
          }
        }
      }
      scene.setHoveredCell(null)
      return
    }
    if (hoveredArmoryEquipUid !== null) {
      hoveredArmoryEquipUid = null
      uiDirty = true
    }
    if (screen === 'world') {
      if (event.pointerType === 'touch' && worldMapTouches.has(event.pointerId)) {
        worldMapTouches.set(event.pointerId, { x, y })
        if (worldMapTouches.size >= 2) {
          const nextPinch = readWorldMapPinch()
          if (nextPinch && worldMapPinch) {
            const factor = nextPinch.dist / worldMapPinch.dist
            if (Math.abs(factor - 1) > 0.002) {
              zoomDioramaCamera(worldMap3DCam, factor)
            }
            const dAngle = wrapAngleDelta(nextPinch.angle - worldMapPinch.angle)
            if (Math.abs(dAngle) > 0.004) {
              rotateDioramaCamera(worldMap3DCam, dAngle * 1.1, 0)
            }
            const dx = nextPinch.midX - worldMapPinch.midX
            const dy = nextPinch.midY - worldMapPinch.midY
            if (Math.hypot(dx, dy) > 0.5) {
              panDioramaCamera(worldMap3DCam, dx, dy, w, h)
            }
            uiDirty = true
          }
          worldMapPinch = nextPinch
          return
        }
      }
      if (worldMapDrag && worldMapDrag.pointerId === event.pointerId) {
        const dx = x - worldMapDrag.lastX
        const dy = y - worldMapDrag.lastY
        if (Math.hypot(dx, dy) > 2) worldMapDrag.dragged = true
        if (worldMapDrag.mode === 'orbit') {
          rotateDioramaCamera(worldMap3DCam, dx * 0.005, dy * 0.004)
        } else {
          panDioramaCamera(worldMap3DCam, dx, dy, w, h)
        }
        worldMapDrag.lastX = x
        worldMapDrag.lastY = y
        uiDirty = true
      }
      return
    }
    if (screen !== 'battle' || !state.battle) {
      scene.setHoveredCell(null)
      return
    }
    if (event.pointerType === 'touch' && activeTouches.has(event.pointerId)) {
      activeTouches.set(event.pointerId, { x, y })
      if (activeTouches.size >= 2) {
        const nextPinch = readTouchPinch()
        if (nextPinch && pinchState) {
          const factor = pinchState.dist / nextPinch.dist
          if (Math.abs(factor - 1) > 0.002) {
            scene.zoomCamera(factor)
            uiDirty = true
          }
          const dAngle = wrapAngleDelta(nextPinch.angle - pinchState.angle)
          if (Math.abs(dAngle) > 0.004) {
            scene.rotateCamera(dAngle * 1.15)
            uiDirty = true
          }
          const dx = nextPinch.midX - pinchState.midX
          const dy = nextPinch.midY - pinchState.midY
          if (Math.hypot(dx, dy) > 0.5) {
            scene.panCamera(-dx * 0.022, -dy * 0.022)
          }
          hudRev++
        }
        pinchState = nextPinch
        return
      }
    }
    if (boardDrag && boardDrag.pointerId === event.pointerId) {
      const dist = Math.hypot(x - boardDrag.startX, y - boardDrag.startY)
      if (!boardDrag.dragged && dist > (boardDrag.pointerType === 'mouse' ? 6 : 12)) {
        boardDrag.dragged = true
        scene.setHoveredCell(null)
      }
      if (boardDrag.dragged) {
        scene.rotateCamera((x - boardDrag.lastX) * 0.0055)
        scene.tiltCamera((y - boardDrag.lastY) * 0.0055)
        boardDrag.lastX = x
        boardDrag.lastY = y
        uiDirty = true
        hudRev++
        return
      }
    }
    if (event.pointerType === 'touch') return
    // Track turn-order hover spotlight & action-button CT shift preview from UI hit test
    const uiHit = ui.hitTest(x, y)
    let nextTurnUid: string | null = null
    let nextTurnSlot = -1
    let nextActionKind: TurnActionKind | null = null
    if (uiHit) {
      if (uiHit.id.startsWith('tl-')) {
        const idx = Number(uiHit.id.slice(3))
        const entry = Number.isInteger(idx) ? state.battle.turnOrder[idx] : undefined
        if (entry) {
          nextTurnUid = entry.uid
          nextTurnSlot = idx
        }
      } else if (state.battle.phase === 'player') {
        const active = getUnitByUid(state.battle, state.battle.activeUnitUid)
        if (active && active.team === 'ally') {
          if (uiHit.id === 'cs-end-turn') {
            nextActionKind = 'wait'
          } else if (uiHit.id === 'sk-basic' || uiHit.id.startsWith('sk-')) {
            nextActionKind = active.moved || (state.battle.targetTiles.length === 0 && state.battle.moveAttackTiles.length > 0)
              ? 'move_and_act'
              : 'act'
          } else if (uiHit.id === 'cs-confirm-attack') {
            const fc = resolveActiveForecast()
            if (fc && fc.mode !== 'tactic') {
              nextActionKind = fc.requiresMove || active.moved ? 'move_and_act' : 'act'
            }
          }
        }
      }
    }
    if (
      nextTurnUid !== hoveredTurnUnitUid ||
      nextTurnSlot !== hoveredTurnSlotIdx ||
      nextActionKind !== hoveredActionKind
    ) {
      hoveredTurnUnitUid = nextTurnUid
      hoveredTurnSlotIdx = nextTurnSlot
      hoveredActionKind = nextActionKind
      scene.setSpotlightUnit(hoveredTurnUnitUid)
      uiDirty = true
      hudRev++
    }
    if (ui.blocksPoint(x, y)) {
      if (scene.getHoveredCell()) {
        scene.setHoveredCell(null)
        uiDirty = true
        hudRev++
      }
      return
    }
    if (state.battle.facingPicker) {
      if (scene.getHoveredCell()) scene.setHoveredCell(null)
      const hit = scene.pickFacingPickerAt(state.battle, x, y, w, h)
      if (hit && hit !== 'confirm' && previewWaitFacing(state, hit)) {
        uiDirty = true
        hudRev++
      }
      return
    }
    const wasCursorActive = gridCursor.active
    if (wasCursorActive) deactivateGridCursor()
    const cell = scene.pickCellAt(state.battle, x, y, w, h)
    const prev = scene.getHoveredCell()
    if (wasCursorActive || prev?.col !== cell?.col || prev?.row !== cell?.row) {
      scene.setHoveredCell(cell)
      refreshBattleDiscoveryTips(true)
      uiDirty = true
      hudRev++
    }
  }, sig)

  uiCanvas.addEventListener('pointerleave', () => {
    if (
      hoveredTurnUnitUid !== null ||
      hoveredActionKind !== null ||
      hoveredArmoryEquipUid !== null ||
      scene.getHoveredCell() !== null
    ) {
      clearBattleHoverFeedback()
      clearArmoryHover(false)
      scene.setHoveredCell(null)
      uiDirty = true
      hudRev++
    }
  }, sig)

  uiCanvas.addEventListener('pointerdown', event => {
    if (isTestingPaused()) return
    lastPointerType = event.pointerType || 'mouse'
    const { x, y, w, h } = pointerToCss(event)
    if (screen === 'world') {
      if (ui.blocksPoint(x, y)) return
      if (worldMap3DCam.flyIn?.active && pendingWorldFlyIn) {
        finishWorldDeployFlyInNow()
        return
      }
      audio.unlock()
      if (event.pointerType === 'touch') {
        worldMapTouches.set(event.pointerId, { x, y })
        if (worldMapTouches.size >= 2) {
          worldMapDrag = null
          worldMapPinch = readWorldMapPinch()
          return
        }
        worldMapDrag = { pointerId: event.pointerId, lastX: x, lastY: y, dragged: false, mode: 'pan' }
        return
      }
      if (event.pointerType === 'mouse' && (event.button === 2 || event.button === 1)) {
        worldMapDrag = { pointerId: event.pointerId, lastX: x, lastY: y, dragged: false, mode: 'orbit' }
        return
      }
      if (event.button !== 0 && event.pointerType === 'mouse') return
      worldMapDrag = { pointerId: event.pointerId, lastX: x, lastY: y, dragged: false, mode: 'pan' }
      return
    }
    if (screen !== 'battle' || !state.battle) return
    if (ui.blocksPoint(x, y)) return
    audio.unlock()

    // Right-mouse or middle-mouse drag orbits horizontally & tilts camera angle up/down!
    // Quick right-click (without drag) still cancels locked forecast or armed skill/tactic on pointerup.
    if (event.pointerType === 'mouse' && (event.button === 2 || event.button === 1)) {
      boardDrag = {
        pointerId: event.pointerId,
        startX: x,
        startY: y,
        lastX: x,
        lastY: y,
        dragged: false,
        pointerType: event.pointerType,
        button: event.button
      }
      return
    }
    if (event.button !== 0 && event.pointerType === 'mouse') return

    // Touch supports 2-finger pinch-to-zoom/pan, 1-finger drag-to-orbit/tilt, and tap-to-preview
    if (event.pointerType === 'touch') {
      activeTouches.set(event.pointerId, { x, y })
      if (activeTouches.size >= 2) {
        boardDrag = null
        suppressTouchTap = true
        pinchState = readTouchPinch()
        scene.setHoveredCell(null)
        return
      }
      boardDrag = {
        pointerId: event.pointerId,
        startX: x,
        startY: y,
        lastX: x,
        lastY: y,
        dragged: false,
        pointerType: event.pointerType,
        button: 0
      }
      return
    }

    // Desktop mouse: if Wait-to-Face picker is active, clicking an arrow or center ring commits facing!
    if (state.battle.facingPicker) {
      const hit = scene.pickFacingPickerAt(state.battle, x, y, w, h)
      if (hit === 'confirm') {
        commitWaitFacing()
      } else if (hit) {
        commitWaitFacing(hit)
      }
      return
    }

    // Desktop mouse: instant Move+Attack / Strike / Move (forecast shown live on hover!)
    deactivateGridCursor()
    const cell = scene.pickCellAt(state.battle, x, y, w, h)
    if (!cell) {
      if (lockedForecastCell) {
        lockedForecastCell = null
        uiDirty = true
        hudRev++
      }
      return
    }
    confirmBoardTile(cell.col, cell.row)
  }, sig)

  uiCanvas.addEventListener('pointerup', event => {
    if (event.pointerType === 'touch' && worldMapTouches.has(event.pointerId)) {
      worldMapTouches.delete(event.pointerId)
      if (worldMapTouches.size < 2) worldMapPinch = null
    }
    if (worldMapDrag && worldMapDrag.pointerId === event.pointerId) {
      worldMapDrag = null
      return
    }
    if (event.pointerType === 'touch') {
      activeTouches.delete(event.pointerId)
      if (activeTouches.size < 2) pinchState = null
      if (suppressTouchTap) {
        if (activeTouches.size === 0) suppressTouchTap = false
        boardDrag = null
        return
      }
    }
    if (!boardDrag || boardDrag.pointerId !== event.pointerId) return
    const drag = boardDrag
    boardDrag = null
    if (drag.pointerType === 'mouse') {
      if (!drag.dragged && drag.button === 2 && screen === 'battle' && state.battle) {
        if (state.battle.facingPicker) {
          if (cancelWaitFacingPicker(state)) {
            uiDirty = true
            hudRev++
          }
        } else if (lockedForecastCell) {
          lockedForecastCell = null
          uiDirty = true
          hudRev++
        } else if (state.battle.armedSkillIndex !== null || state.battle.armedTacticUid) {
          armSkill(state, null)
          armTacticCard(state, null)
          uiDirty = true
          hudRev++
        }
      }
      return
    }
    if (drag.dragged || isTestingPaused() || screen !== 'battle' || !state.battle) return
    const { x, y, w, h } = pointerToCss(event)
    if (ui.blocksPoint(x, y)) return
    if (state.battle.facingPicker) {
      const hit = scene.pickFacingPickerAt(state.battle, x, y, w, h)
      if (hit === 'confirm') {
        commitWaitFacing()
      } else if (hit) {
        if (hit === state.battle.facingPicker.previewFacing) {
          commitWaitFacing(hit)
        } else if (previewWaitFacing(state, hit)) {
          uiDirty = true
          hudRev++
        }
      }
      return
    }
    const cell = scene.pickCellAt(state.battle, x, y, w, h)
    if (!cell) {
      if (lockedForecastCell || mobileHandOpen || pendingOaMoveCell || inspectedTileCell) {
        lockedForecastCell = null
        pendingOaMoveCell = null
        inspectedTileCell = null
        mobileHandOpen = false
        pendingOaMoveCell = null
        inspectedTileCell = null
        uiDirty = true
        hudRev++
      }
      return
    }
    // Touch tap on a valid combat/skill/Move+Attack/tactic target:
    // First tap locks Combat Forecast + 3D pre-attack wind-up; second tap on same target confirms!
    const touchAutoWasOn = cancelAutoBattle(state)
    const fc = computeCombatForecast(state, cell.col, cell.row)
    if (fc) {
      pendingOaMoveCell = null
      inspectedTileCell = null
      if (lockedForecastCell && lockedForecastCell.col === cell.col && lockedForecastCell.row === cell.row) {
        confirmLockedForecast()
      } else {
        lockedForecastCell = { col: cell.col, row: cell.row }
        mobileHandOpen = false
        state.sounds.push({ kind: 'card', pitch: 1.2 })
        uiDirty = true
        hudRev++
      }
      return
    }
    lockedForecastCell = null
    mobileHandOpen = false

    // 2-Tap Confirm for Move-Path Opportunity Attacks on Touch (ridgetop-5hr.8):
    // Safe moves stay 1-tap; OA-triggering moves warn on 1st tap and confirm on 2nd tap of the same tile.
    const battleNow = state.battle
    if (battleNow.phase === 'player' && battleNow.moveTiles.some(t => t.col === cell.col && t.row === cell.row)) {
      const activeUnit = getUnitByUid(battleNow, battleNow.activeUnitUid)
      if (activeUnit && activeUnit.team === 'ally' && activeUnit.alive && !activeUnit.moved) {
        const movePath = findGridPath(battleNow, activeUnit, cell.col, cell.row)
        const oaPreview = movePath.length > 0 ? previewPathOpportunityAttacks(battleNow, activeUnit, movePath) : null
        if (oaPreview && oaPreview.triggers.length > 0) {
          if (pendingOaMoveCell && pendingOaMoveCell.col === cell.col && pendingOaMoveCell.row === cell.row) {
            pendingOaMoveCell = null
          } else {
            pendingOaMoveCell = { col: cell.col, row: cell.row, preview: oaPreview }
            inspectedTileCell = null
            state.sounds.push({ kind: 'card', pitch: 0.78 })
            uiDirty = true
            hudRev++
            return
          }
        } else {
          pendingOaMoveCell = null
        }
      }
    } else {
      pendingOaMoveCell = null
    }

    const touchTileChanged = selectTile(state, cell.col, cell.row)
    if (touchTileChanged) {
      inspectedTileCell = null
      refreshBattleDiscoveryTips(false)
    } else {
      // Tap-to-inspect non-reachable / empty / cover / hazard / shrine tiles on touch!
      const tappedCell = battleNow.cells[cell.row]?.[cell.col]
      if (tappedCell && tappedCell.terrain !== 'void') {
        if (inspectedTileCell && inspectedTileCell.col === cell.col && inspectedTileCell.row === cell.row) {
          inspectedTileCell = null
        } else {
          inspectedTileCell = { col: cell.col, row: cell.row }
          state.sounds.push({ kind: 'card', pitch: 1.04 })
        }
        uiDirty = true
        hudRev++
        return
      } else if (inspectedTileCell) {
        inspectedTileCell = null
        uiDirty = true
        hudRev++
        return
      }
    }
    if (touchTileChanged || touchAutoWasOn) {
      uiDirty = true
      hudRev++
    }
  }, sig)

  uiCanvas.addEventListener('contextmenu', event => {
    if (screen === 'battle' || screen === 'world') event.preventDefault()
  }, sig)

  uiCanvas.addEventListener('pointercancel', event => {
    if (worldMapDrag && worldMapDrag.pointerId === event.pointerId) worldMapDrag = null
    worldMapTouches.delete(event.pointerId)
    if (worldMapTouches.size < 2) worldMapPinch = null
    activeTouches.delete(event.pointerId)
    if (activeTouches.size === 0) {
      pinchState = null
      suppressTouchTap = false
    }
    boardDrag = null
  }, sig)

  uiCanvas.addEventListener('wheel', event => {
    if (isTestingPaused()) return
    const box = uiCanvas.getBoundingClientRect()
    if (screen === 'world') {
      if (ui.blocksPoint(event.clientX - box.left, event.clientY - box.top)) return
      event.preventDefault()
      zoomDioramaCamera(worldMap3DCam, event.deltaY > 0 ? 1 / 1.12 : 1.12)
      uiDirty = true
      return
    }
    if (screen !== 'battle' || !state.battle) return
    if (ui.blocksPoint(event.clientX - box.left, event.clientY - box.top)) return
    event.preventDefault()
    scene.zoomCamera(event.deltaY > 0 ? 1.09 : 1 / 1.09)
    uiDirty = true
    hudRev++
  }, { signal: inputAbort.signal, passive: false })

  // iOS Safari & WKWebView require a touchstart/touchend/click user gesture (not just pointerdown)
  // to unlock or recover an interrupted AudioContext.
  const unlockAudioOnGesture = () => { audio.unlock() }
  window.addEventListener('touchstart', unlockAudioOnGesture, { capture: true, passive: true, signal: inputAbort.signal })
  window.addEventListener('touchend', unlockAudioOnGesture, { capture: true, passive: true, signal: inputAbort.signal })
  window.addEventListener('click', unlockAudioOnGesture, { capture: true, passive: true, signal: inputAbort.signal })

  // Battle & Debug Keyboard Shortcuts
  window.addEventListener('keydown', event => {
    if (isTestingPaused() || event.altKey || event.ctrlKey || event.metaKey || isEditableEventTarget(event.target)) return
    if (event.code === 'F3' && !event.repeat) {
      event.preventDefault()
      showPerfPanel = !showPerfPanel
      uiDirty = true
      hudRev++
      return
    }
    if (event.code === 'KeyM' && !event.repeat) {
      audio.unlock()
      audio.setMusic(!audio.isMusicEnabled())
      uiDirty = true
      return
    }
    if (screen === 'world') {
      if (event.code === 'KeyH' && !event.repeat) {
        event.preventDefault()
        focusMode = !focusMode
        state.sounds.push({ kind: 'card', pitch: focusMode ? 1.12 : 0.94 })
        uiDirty = true
        return
      }
      if (event.code === 'Escape' && !event.repeat && focusMode) {
        event.preventDefault()
        focusMode = false
        uiDirty = true
        return
      }
      if (event.code === 'Escape' && !event.repeat && (worldMap3DCam.flyIn?.active || pendingWorldFlyIn)) {
        event.preventDefault()
        cancelWorldDeployFlyIn()
        return
      }
      if (event.code === 'KeyQ') {
        event.preventDefault()
        rotateDioramaCamera(worldMap3DCam, -0.14)
        uiDirty = true
        return
      }
      if (event.code === 'KeyE') {
        event.preventDefault()
        rotateDioramaCamera(worldMap3DCam, 0.14)
        uiDirty = true
        return
      }
      if (event.code === 'KeyR' && !event.repeat) {
        event.preventDefault()
        resetWorldMapOverview()
        uiDirty = true
        return
      }
    }
    if (screen === 'battle' && state.battle) {
      if (event.code === 'KeyH' && !event.repeat) {
        event.preventDefault()
        focusMode = !focusMode
        state.sounds.push({ kind: 'card', pitch: focusMode ? 1.12 : 0.94 })
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'Escape' && !event.repeat) {
        event.preventDefault()
        handleBattleCancelAction(true)
        return
      }
      if (event.code === 'KeyX' && !event.repeat) {
        event.preventDefault()
        handleToggleBattleSpeed()
        return
      }
      if (event.code === 'KeyB' && !event.repeat && (state.battle.phase === 'player' || state.battle.phase === 'enemy')) {
        event.preventDefault()
        handleToggleAutoBattle()
        return
      }
      if (event.code === 'Enter' && !event.repeat) {
        if (state.battle.facingPicker && state.battle.phase === 'player') {
          event.preventDefault()
          audio.unlock()
          commitWaitFacing()
          return
        }
        if (lockedForecastCell) {
          event.preventDefault()
          confirmLockedForecast()
          return
        }
        if (getActiveDiscoveryTip(state)) {
          event.preventDefault()
          audio.unlock()
          dismissCurrentDiscoveryTip()
          return
        }
        if (gridCursor.active) {
          event.preventDefault()
          audio.unlock()
          confirmBoardTile(gridCursor.col, gridCursor.row)
          return
        }
        if (state.battle.phase === 'deploy') {
          event.preventDefault()
          confirmDeployAndStart()
          return
        }
      }
      if (event.code === 'KeyF' && !event.repeat && state.battle.phase === 'deploy') {
        event.preventDefault()
        rotateSelectedDeployUnit()
        return
      }
      if (event.code === 'KeyF' && !event.repeat && state.battle.phase === 'player') {
        audio.unlock()
        if (state.battle.facingPicker) {
          const cur = state.battle.facingPicker.previewFacing
          const next = FACING_DIRS[(FACING_DIRS.indexOf(cur) + 1) % FACING_DIRS.length]
          if (previewWaitFacing(state, next)) {
            uiDirty = true
            hudRev++
          }
        } else if (beginWaitFacingPicker(state)) {
          lockedForecastCell = null
          pendingOaMoveCell = null
          inspectedTileCell = null
          mobileHandOpen = false
          clearBattleHoverFeedback()
          scene.setHoveredCell(null)
          scene.setGridCursor(null)
          scene.setForecast(null)
          refreshBattleDiscoveryTips(false)
          uiDirty = true
          hudRev++
        }
        return
      }
      if (event.code === 'Backspace' && !event.repeat) {
        event.preventDefault()
        if (state.battle.facingPicker) {
          if (cancelWaitFacingPicker(state)) {
            syncBattleGridCursor(false)
            uiDirty = true
            hudRev++
          }
          return
        }
        if (state.battle.armedSkillIndex !== null || state.battle.armedTacticUid) {
          armSkill(state, null)
          armTacticCard(state, null)
          syncBattleGridCursor(false)
          uiDirty = true
          hudRev++
          return
        }
        if (state.battle.phase === 'player' && performUndoMove()) {
          return
        }
        if (state.battle.phase === 'deploy' && state.battle.selectedUnitUid) {
          state.battle.selectedUnitUid = null
          state.sounds.push({ kind: 'card', pitch: 0.92 })
          uiDirty = true
          hudRev++
          return
        }
        snapCursorBackToAnchor()
        return
      }
      if (event.code === 'KeyZ' && !event.repeat && state.battle.phase === 'player') {
        event.preventDefault()
        performUndoMove()
        return
      }
      if (event.code === 'KeyT' && !event.repeat) {
        event.preventDefault()
        toggleDangerZone()
        return
      }
      if (event.code === 'KeyL' && !event.repeat) {
        event.preventDefault()
        toggleCombatLog()
        return
      }
      if (event.code === 'Space' && !event.repeat && state.battle.phase === 'deploy') {
        event.preventDefault()
        confirmDeployAndStart()
        return
      }
      if (event.code === 'Space' && !event.repeat && state.battle.phase === 'player') {
        event.preventDefault()
        audio.unlock()
        if (state.battle.facingPicker) {
          commitWaitFacing()
          return
        }
        if (gridCursor.active) {
          confirmBoardTile(gridCursor.col, gridCursor.row)
          return
        }
        endBattleTurn()
        return
      }
      if (event.code === 'KeyQ' && !event.repeat) {
        event.preventDefault()
        scene.snapCameraYaw(-1)
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'KeyE' && !event.repeat) {
        event.preventDefault()
        scene.snapCameraYaw(1)
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'ArrowUp') {
        event.preventDefault()
        moveBattleGridCursor(0, -1, 'keyboard')
        return
      }
      if (event.code === 'ArrowDown') {
        event.preventDefault()
        moveBattleGridCursor(0, 1, 'keyboard')
        return
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        moveBattleGridCursor(-1, 0, 'keyboard')
        return
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        moveBattleGridCursor(1, 0, 'keyboard')
        return
      }
      if (state.battle.facingPicker && state.battle.phase === 'player') {
        if (event.code === 'KeyW') {
          event.preventDefault()
          moveBattleGridCursor(0, -1, 'keyboard')
          return
        }
        if (event.code === 'KeyS') {
          event.preventDefault()
          moveBattleGridCursor(0, 1, 'keyboard')
          return
        }
        if (event.code === 'KeyA') {
          event.preventDefault()
          moveBattleGridCursor(-1, 0, 'keyboard')
          return
        }
        if (event.code === 'KeyD') {
          event.preventDefault()
          moveBattleGridCursor(1, 0, 'keyboard')
          return
        }
      }
      if (event.code === 'KeyA') {
        scene.rotateCamera(-0.12)
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'KeyD') {
        scene.rotateCamera(0.12)
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'KeyW' || event.code === 'PageUp') {
        event.preventDefault()
        scene.tiltCamera(0.14)
        hudRev++
        return
      }
      if (event.code === 'KeyS' || event.code === 'PageDown') {
        event.preventDefault()
        scene.tiltCamera(-0.14)
        hudRev++
        return
      }
      if (event.code === 'Equal' || event.code === 'NumpadAdd') {
        scene.zoomCamera(1 / 1.12)
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'Minus' || event.code === 'NumpadSubtract') {
        scene.zoomCamera(1.12)
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'Digit0' && !event.repeat) {
        scene.resetCamera()
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'Digit1' && !event.repeat) { armSkill(state, null); syncBattleGridCursor(false); uiDirty = true; hudRev++; return }
      if (event.code === 'Digit2' && !event.repeat) { armSkill(state, 0); syncBattleGridCursor(false); uiDirty = true; hudRev++; return }
      if (event.code === 'Digit3' && !event.repeat) { armSkill(state, 1); syncBattleGridCursor(false); uiDirty = true; hudRev++; return }
      if (event.code === 'Digit4' && !event.repeat) { armSkill(state, 2); syncBattleGridCursor(false); uiDirty = true; hudRev++; return }
      if ((event.code === 'Digit5' || event.code === 'Digit6' || event.code === 'Digit7' || event.code === 'Digit8') && !event.repeat) {
        const handIdx = Number(event.code.slice(5)) - 5
        const tacticUid = state.battle.hand[handIdx]
        if (tacticUid) {
          armTacticCard(state, tacticUid)
          syncBattleGridCursor(false)
          uiDirty = true
          hudRev++
        }
        return
      }
      if (event.code === 'Tab' && !event.repeat) {
        event.preventDefault()
        audio.unlock()
        cycleBattleGridCursor(event.shiftKey ? -1 : 1, 'keyboard')
      }
    } else if (screen === 'paused' && event.code === 'Escape' && !event.repeat) {
      event.preventDefault()
      setScreen('battle')
    } else if ((screen === 'world' || screen === 'camp') && event.code === 'KeyC' && !event.repeat) {
      event.preventDefault()
      audio.unlock()
      openCodex()
    } else if (screen === 'codex' && (event.code === 'Escape' || event.code === 'KeyC') && !event.repeat) {
      event.preventDefault()
      closeCodex()
    }
  }, sig)

  window.addEventListener('ridgetop:testing-bar-change', () => {
    uiDirty = true
  }, sig)

  function getTestingBarTopRightClearance(w: number, topH: number): number {
    if (typeof document === 'undefined') return 0
    const bar = document.getElementById('ridgetop-testing-bar')
    if (!bar) return 0
    const rect = bar.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return 0
    if (rect.top >= topH + 16 || rect.right < w - 40) return 0
    const collapsed = bar.classList.contains('rt-bar-collapsed') || rect.width <= 160
    if (!collapsed) return 0
    return Math.max(0, Math.ceil(w - rect.left) + 6)
  }

  // =========================================================================
  // TITLE SCREEN
  // =========================================================================

  function buildTitleTree(w: number, h: number): LayoutNode {
    const vp = getViewportProfile(w, h)
    const mobile = vp.isPortraitPhone
    const shortH = vp.isLandscapePhone || h < 480
    const hasBattleSave = Boolean(resumableBattle)
    const hasSave = hasBattleSave || Boolean(existingSave && (existingSave.campaign.battlesWon > 0 || existingSave.campaign.packsOpened > 0))
    const playLabel = hasSave
      ? `Continue (${state.campaign.clearedStageIds.length}/${PLAYABLE_CHAPTERS.length})`
      : 'Begin Campaign'
    const resumeLabel = resumableBattle
      ? formatResumableBattleLabel(resumableBattle, mobile || shortH)
      : ''

    const logoH = shortH ? Math.min(104, Math.round(h * 0.28)) : Math.min(138, Math.round(h * 0.22))
    const cardW = Math.min(w - 28, shortH ? 460 : 520)
    const btnH = shortH ? 40 : 48
    const devVersionLabel = formatDevVersionLabel(otaState.status, {
      isLocalWeb: isLocalWebHost,
      checking: otaState.checking
    })

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({
        id: 'title-banner',
        style: { anchor: 'top', width: Math.min(w - 24, 580), height: logoH, inset: shortH ? 8 : mobile ? 18 : 22, respectSafeArea: true },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawTitleLogo(ctx, rect)
        }
      }),
      column({
        id: 'title-card',
        style: { anchor: 'bottom', width: cardW, inset: shortH ? 10 : mobile ? 14 : 20, padding: shortH ? [10, 14] : [16, 18], gap: shortH ? 7 : 12, respectSafeArea: true },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawTitleCard(ctx, rect)
        }
      }, [
        ...(shortH ? [] : [boxNode({
          id: 't-desc',
          style: { height: mobile ? 52 : 32 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
              ctx,
              rect,
              'Tactical grid combat meets deckbuilding. Collect relic gear, unseal card packs, and ascend heroes to Tier 3.',
              { size: 12.5, weight: 500, color: COLOR.muted, align: 'center', wrap: true, lineHeight: 16.5 }
            )
          }
        })]),
        ...(hasBattleSave ? [row({ id: 't-resume', style: { height: btnH, gap: 8 } }, [
          boxNode({
            id: 'cs-resume-battle', style: { grow: 2.5, height: btnH },
            widget: {
              type: 'button',
              label: resumeLabel,
              primary: true,
              onPress: () => resumeSavedBattle(),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, resumeLabel, st, { variant: 'primary', icon: 'sword', size: shortH || mobile ? 12.5 : 13.5 }
              )
            }
          }),
          boxNode({
            id: 'cs-abandon-battle', style: { grow: 1, height: btnH },
            widget: {
              type: 'button',
              label: 'Abandon',
              onPress: () => discardResumableBattle(),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Abandon', st, { variant: 'danger', icon: 'retreat', size: shortH || mobile ? 12 : 12.5 }
              )
            }
          })
        ])] : []),
        row({ id: 't-actions', style: { height: btnH, gap: 10 } }, [
          boxNode({
            id: 'cs-play', style: { grow: 1.5, height: btnH },
            widget: {
              type: 'button',
              label: playLabel,
              primary: !hasBattleSave,
              onPress: () => startCampaign(false),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, playLabel, st, { variant: hasBattleSave ? 'secondary' : 'primary', icon: hasBattleSave ? 'map' : 'play', size: shortH ? 14 : 15 }
              )
            }
          }),
          boxNode({
            id: 'cs-new', hidden: !hasSave, style: { grow: 1, height: btnH },
            widget: {
              type: 'button',
              label: 'New Campaign',
              onPress: () => startCampaign(true),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'New Run', st, { variant: 'secondary', size: 13 }
              )
            }
          })
        ]),
        ...(devVersionLabel ? [boxNode({
          id: 'cs-dev-version',
          style: { height: shortH ? 22 : 24 },
          widget: {
            type: 'button',
            label: devVersionLabel,
            onPress: onPressDevVersionPill,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawDevVersionPill(
              ctx, rect, devVersionLabel, st, { highlight: Boolean(otaState.pending) }
            )
          }
        })] : []),
        ...(mobile || shortH ? [] : [boxNode({
          id: 't-help',
          style: { height: 18 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawControlHints(ctx, rect, vp.isTouchPrimary ? TITLE_HINTS_TOUCH : TITLE_HINTS)
          }
        })])
      ])
    ])
  }

  // =========================================================================
  // WORLD MAP OVERWORLD (FULL-VIEWPORT PANNABLE CONTINENT + 26 LOCATIONS)
  // =========================================================================

  function buildWorldMapTree(w: number, h: number): LayoutNode {
    const vp = getViewportProfile(w, h)
    const camp = state.campaign
    const shortH = vp.isLandscapePhone || (h < 500 && w >= 560)
    const mobile = vp.isPortraitPhone || (!shortH && w < 780)
    const isCompact = vp.isCompact || mobile || shortH
    const selected = getSelectedStage()
    const selectedSoon = Boolean(selected.comingSoon)
    const selectedUnlocked = !selectedSoon && isStageUnlocked(camp, selected)
    const selectedCleared = isStageCleared(camp, selected.id)
    const endlessReady = isEndlessUnlocked(camp)
    const campUnlocked = isCampUnlocked(camp)
    const codexUnlocked = isCodexUnlocked(camp)
    const masteryUnlocked = isMasteryUnlocked(camp)
    const allowedTiers = getAllowedChallengeTiers(camp, selected)
    const mutatorsAllowed = areMutatorsUnlockedForStage(camp, selected)
    const isBossRematch = isBossRematchSkirmish(camp, selected)
    const squadPower = computeSquadPower(camp)
    const clearedSet = new Set(camp.clearedStageIds)
    const unlockedSet = new Set(CHAPTERS.filter(ch => isStageUnlocked(camp, ch)).map(ch => ch.id))
    const regionMeta = WORLD_REGIONS[selected.region]

    const outerPad = isCompact ? 8 : 12
    const topH = shortH ? 38 : 44

    const compactMap = mobile || shortH
    const nodeW = compactMap ? 78 : 118
    const nodeH = compactMap ? 58 : 86
    const pinCenterY = compactMap ? 19 : 25

    const selectedEvent: WorldMapEvent | null = selectedWorldEventId
      ? (getWorldMapEventById(camp, selectedWorldEventId) ?? null)
      : null
    if (!selectedEvent && selectedWorldEventId !== null) {
      selectedWorldEventId = null
    }

    // Project all 33 continent landmarks directly onto their live 3D banner pins!
    const mapNodeEntries: { readonly node: LayoutNode; readonly cx: number; readonly cy: number; readonly zOrder: number }[] = []
    for (const stage of CHAPTERS) {
      const pt = scene.projectWorldMapPoint(stage.mapX, stage.mapY, worldMap3DCam, w, h, 0.52)
      if (!pt) continue
      const left = Math.round(pt.x - nodeW / 2)
      const top = Math.round(pt.y - pinCenterY)
      if (left + nodeW < -20 || left > w + 20 || top + nodeH < -20 || top > h + 20) continue
      const unlocked = unlockedSet.has(stage.id)
      const cleared = clearedSet.has(stage.id)
      const isSel = !selectedEvent && selected.id === stage.id
      const nodeMastery = cleared ? getStageMasteryRecord(camp, stage.id) : null
      const nodeChestReady = cleared && canClaimStageMasteryChest(camp, stage.id)
      const z = worldMap3DCam.zoom
      const showLabel = isSel || (unlocked && !cleared) || (unlocked && z >= 1.12) || z >= 1.42
      const zOrder = isSel ? 3 : (unlocked && !cleared) ? 2 : unlocked ? 1 : 0
      mapNodeEntries.push({
        cx: pt.x,
        cy: pt.y,
        zOrder,
        node: boxNode({
        id: `map-node-${stage.id}`,
        style: { anchor: 'top-left', inset: [left, top], width: nodeW, height: nodeH },
        widget: {
          type: 'button',
          label: stage.title,
          selected: isSel,
          onPress: () => {
            audio.unlock()
            cancelWorldDeployFlyIn()
            selectedWorldEventId = null
            camp.selectedStageId = stage.id
            if (!stage.comingSoon) pendingChapter = stage.index
            pendingEndless = 0
            focusWorldMapOn(stage)
            state.sounds.push({ kind: 'card', pitch: stage.comingSoon ? 0.9 : unlocked ? 1.15 : 0.8 })
            uiDirty = true
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawWorldMapNode(
            ctx,
            rect,
            stage,
            {
              unlocked,
              cleared,
              clearedTier: cleared ? getHighestClearedStageTier(camp, stage.id) : null,
              masteryStars: nodeMastery ? nodeMastery.stars : 0,
              masteryChestReady: nodeChestReady,
              selected: isSel,
              time: worldMapTime,
              compact: compactMap,
              showLabel,
              zoom: z
            },
            st
          )
        }
      })
      })
    }
    mapNodeEntries.sort((a, b) => a.zOrder - b.zOrder)

    // Dynamic temporary World Map event medallions projected directly onto their 3D road beacons!
    const evNodeW = mobile ? 84 : 108
    const evNodeH = mobile ? 58 : 66
    const evPinCenterY = mobile ? 19 : 22
    for (const ev of camp.worldEvents) {
      const pt = scene.projectWorldMapPoint(ev.mapX, ev.mapY, worldMap3DCam, w, h, 0.56)
      if (!pt) continue
      const left = Math.round(pt.x - evNodeW / 2)
      const top = Math.round(pt.y - evPinCenterY)
      if (left + evNodeW < -20 || left > w + 20 || top + evNodeH < -20 || top > h + 20) continue
      const isEvSel = selectedEvent?.id === ev.id
      mapNodeEntries.push({
        cx: pt.x,
        cy: pt.y,
        zOrder: selectedEvent?.id === ev.id ? 4 : 2,
        node: boxNode({
        id: `map-event-${ev.id}`,
        style: { anchor: 'top-left', inset: [left, top], width: evNodeW, height: evNodeH },
        widget: {
          type: 'button',
          label: ev.title,
          selected: isEvSel,
          onPress: () => {
            audio.unlock()
            cancelWorldDeployFlyIn()
            selectedWorldEventId = ev.id
            focusWorldMapOnPoint(ev.mapX, ev.mapY)
            state.sounds.push({ kind: ev.kind === 'wandering_merchant' ? 'coin' : 'card', pitch: 1.15 })
            uiDirty = true
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawWorldMapEventNode(
            ctx,
            rect,
            ev,
            {
              selected: isEvSel,
              time: worldMapTime,
              compact: mobile
            },
            st
          )
        }
      })
      })
    }

    // Aggregate unique enemy roster for the selected stage (Crownless Deep reflects selected Abyss floor)
    const selectedIsAbyss = isCrownlessDeepStage(selected.id) && !selectedSoon
    const abyssMaxSelectable = getMaxSelectableCrownlessDeepFloor(camp)
    const abyssSelectedFloor = selectedIsAbyss ? getSelectedCrownlessDeepFloor(camp) : 1
    const abyssFloorSpec = selectedIsAbyss ? getCrownlessDeepFloorSpec(abyssSelectedFloor) : null
    const inspectEnemies = abyssFloorSpec ? abyssFloorSpec.enemies : selected.enemies
    const enemyCounts = new Map<EnemyArchetypeId, number>()
    for (const sp of inspectEnemies) {
      enemyCounts.set(sp.id, (enemyCounts.get(sp.id) ?? 0) + 1)
    }
    const enemyList = Array.from(enemyCounts.entries())
    const gridCols = (abyssFloorSpec ? abyssFloorSpec.grid[0]?.length : selected.grid[0]?.length) ?? 8
    const gridRows = abyssFloorSpec ? abyssFloorSpec.grid.length : selected.grid.length
    const inspectBiome = abyssFloorSpec ? abyssFloorSpec.biome : selected.biome
    const inspectDifficulty = abyssFloorSpec ? abyssFloorSpec.difficulty : selected.difficulty
    const biomeName = inspectBiome[0].toUpperCase() + inspectBiome.slice(1)
    const firstEq = selected.rewardEquipId ? EQUIPMENT_BY_ID[selected.rewardEquipId] : undefined
    const firstHero = selected.rewardHeroId ? HERO_SPECS[selected.rewardHeroId] : undefined

    const firstClearLoot: { icon: IconName; text: string; color?: string }[] = abyssFloorSpec
      ? [
          { icon: 'coin', text: `+${abyssFloorSpec.rewardGold}g`, color: abyssSelectedFloor <= camp.crownlessDeepFloor ? COLOR.faint : COLOR.accentHi },
          { icon: 'sparkle', text: `+${abyssFloorSpec.bonusDust} Dust · +${abyssFloorSpec.bonusShards} Shd`, color: '#a3f7d0' }
        ]
      : [
          { icon: 'coin', text: `+${selected.rewardGold}g`, color: selectedCleared ? COLOR.faint : COLOR.accentHi }
        ]
    if (abyssFloorSpec && abyssSelectedFloor === CROWNLESS_DEEP_MAX_FLOOR && firstEq) {
      firstClearLoot.push({
        icon: 'bag',
        text: firstEq.name,
        color: camp.crownlessDeepRewardClaimed ? COLOR.faint : RARITY_META[firstEq.rarity].hex
      })
    }
    if (abyssFloorSpec && abyssSelectedFloor === CROWNLESS_DEEP_MAX_FLOOR && firstHero) {
      firstClearLoot.push({
        icon: 'users',
        text: firstHero.name,
        color: camp.crownlessDeepRewardClaimed ? COLOR.faint : '#9ff0c4'
      })
    }
    if (!abyssFloorSpec && firstEq) {
      firstClearLoot.push({
        icon: 'bag',
        text: firstEq.name,
        color: selectedCleared ? COLOR.faint : RARITY_META[firstEq.rarity].hex
      })
    }
    if (!abyssFloorSpec && firstHero) {
      firstClearLoot.push({
        icon: 'users',
        text: firstHero.name,
        color: selectedCleared ? COLOR.faint : '#9ff0c4'
      })
    }
    if (!abyssFloorSpec && selected.id === 'starfall_atoll') {
      firstClearLoot.push({
        icon: 'sparkle',
        text: `+${STARFALL_ATOLL_FIRST_CLEAR_DUST} Dust · +${STARFALL_ATOLL_FIRST_CLEAR_SHARDS} Shd`,
        color: selectedCleared ? COLOR.faint : '#a3f7d0'
      })
    }
    if (selected.unlocksSlot4) {
      firstClearLoot.push({
        icon: 'star',
        text: '4th Slot',
        color: selectedCleared ? COLOR.faint : COLOR.ap
      })
    }

    const activeChallenge = selectedCleared && !selectedSoon
      ? getStageChallenge(selected.id)
      : DEFAULT_STAGE_CHALLENGE
    const activeTierSpec = STAGE_TIER_SPECS[activeChallenge.tier]
    const highestClearedTier = selectedCleared ? getHighestClearedStageTier(camp, selected.id) : null
    const challengeRewards = computeChallengeRewards(
      abyssFloorSpec ? abyssFloorSpec.replayGold : selected.replayGold,
      inspectDifficulty,
      activeChallenge.tier,
      activeChallenge.mutators
    )
    const effectiveRecPower = Math.round((abyssFloorSpec ? abyssFloorSpec.recommendedPower : selected.recommendedPower) * activeTierSpec.recommendedPowerMul)

    const replayLoot: { icon: IconName; text: string; color?: string }[] = [
      {
        icon: 'coin',
        text: challengeRewards.goldBonusPct > 0
          ? `+${challengeRewards.replayGold}g (+${challengeRewards.goldBonusPct}%)`
          : `+${challengeRewards.replayGold}g`,
        color: COLOR.accentHi
      },
      {
        icon: 'cards',
        text: challengeRewards.dropTierLabel,
        color: activeChallenge.tier === 'mythic' ? '#e5adff' : activeChallenge.tier === 'veteran' ? '#ffd285' : '#9fd3ff'
      }
    ]
    if (challengeRewards.bonusDust > 0 || challengeRewards.bonusShards > 0) {
      replayLoot.push({
        icon: 'sparkle',
        text: `+${challengeRewards.bonusDust} Dust · +${challengeRewards.bonusShards} Shd`,
        color: '#a3f7d0'
      })
    }

    const powerRatio = squadPower / Math.max(1, effectiveRecPower)
    const powerColor = powerRatio >= 1.0 ? COLOR.good : powerRatio >= 0.8 ? COLOR.accentHi : COLOR.danger
    const deployLabel = selectedSoon
      ? 'Coming Soon...'
      : !selectedUnlocked
        ? 'Locked'
        : selectedIsAbyss
          ? abyssSelectedFloor <= camp.crownlessDeepFloor
            ? `Replay Floor ${abyssSelectedFloor}`
            : `Descend Floor ${abyssSelectedFloor}`
          : selectedCleared
            ? activeChallenge.tier !== 'normal'
              ? `Deploy (${activeTierSpec.label})`
              : activeChallenge.mutators.length > 0
                ? `Deploy (${activeChallenge.mutators.length} Mut)`
                : 'Replay Battle'
            : 'Deploy to Battle'

    const showChallengeControls = selectedCleared && !selectedSoon && !selectedIsAbyss && allowedTiers.length > 1
    const showOakhavenExchange = selected.id === OAKHAVEN_STAGE_ID && !selectedSoon && isOakhavenExchangeUnlocked(camp)
    const oakhavenOffers = showOakhavenExchange ? getOakhavenExchangeOffers(camp) : []
    const oakhavenPatron = showOakhavenExchange && hasOakhavenPatronDiscount(camp)
    const showMasteryPanel = !selectedSoon && masteryUnlocked
    const selectedMastery = getStageMasteryRecord(camp, selected.id)
    const selectedMasteryObjectives = getStageMasteryObjectives(selected, selectedMastery)
    const selectedChestReward = getStageMasteryChestReward(selected)
    const selectedChestClaimable = masteryUnlocked && canClaimStageMasteryChest(camp, selected.id)
    const selectedChestClaimed = hasClaimedStageMasteryChest(camp, selected.id)
    const totalMasteryStars = getTotalMasteryStars(camp)
    const maxMasteryStars = getMaxMasteryStars()
    const claimableMilestones = masteryUnlocked ? getClaimableMasteryMilestones(camp) : []
    const nextReadyMilestone = claimableMilestones[0] ?? null
    const nextUpcomingMilestone = masteryUnlocked ? getNextMasteryMilestone(camp) : null

    if (selected.id !== lastInspectedStageId) {
      lastInspectedStageId = selected.id
      worldInspectorTab = 'overview'
    }

    const narrowPhone = w < 520
    const inspW = mobile ? Math.min(w - 16, 460) : shortH && w < 740 ? 296 : 348
    const extraPanels = (showChallengeControls ? 1 : 0) + (showOakhavenExchange ? 1 : 0)
    const abyssExtraH = selectedIsAbyss ? 42 : 0
    const mobileTopBannersBottom = outerPad + topH + 10
      + Math.max(
        (resumableBattle ? (isCompact ? 48 : 54) : 0) + (nextReadyMilestone ? (isCompact ? 40 : 44) : 0),
        narrowPhone ? 44 : 0
      )
    const inspTopInset = topH + outerPad + (shortH ? 8 : 10)
    const maxInspH = mobile
      ? Math.max(220, h - mobileTopBannersBottom - 16)
      : Math.max(220, h - inspTopInset - outerPad)

    const hideFoesForRoom = isCompact || extraPanels > 1 || (showChallengeControls && h < 700)
    const hideHintForRoom = isCompact && (extraPanels > 0 || selectedChestClaimable || selectedIsAbyss)

    const inspPadV = isCompact ? 16 : 22
    const inspGap = isCompact ? 5 : extraPanels > 0 ? 6 : 7
    const headH = shortH ? 36 : isCompact ? 40 : 52
    const metaH = shortH ? 38 : isCompact ? 42 : 48
    const foesH = hideFoesForRoom ? 0 : (showChallengeControls ? 60 : 68)
    const masteryListH = shortH ? 36 : isCompact ? 38 : 62
    const masteryBtnH = isCompact ? 24 : 26
    const masteryH = showMasteryPanel
      ? (selectedChestClaimable ? masteryListH + 4 + masteryBtnH : masteryListH)
      : 0
    const abyssBarH = selectedIsAbyss && abyssFloorSpec ? (shortH ? 30 : isCompact ? 32 : 36) : 0
    const challengeH = showChallengeControls ? (isCompact ? 114 : 124) : 0
    const exchangeH = showOakhavenExchange ? (isCompact ? 62 : 70) : 0
    const rewardsMinH = shortH ? 52 : isCompact ? 58 : 76
    const hintH = hideHintForRoom ? 0 : 20
    const deployH = shortH ? 34 : isCompact ? 36 : 42

    const stackedHeights = [
      headH,
      metaH,
      ...(foesH > 0 ? [foesH] : []),
      ...(masteryH > 0 ? [masteryH] : []),
      ...(abyssBarH > 0 ? [abyssBarH] : []),
      ...(challengeH > 0 ? [challengeH] : []),
      ...(exchangeH > 0 ? [exchangeH] : []),
      rewardsMinH,
      ...(hintH > 0 ? [hintH] : []),
      deployH
    ]
    const stackedMinH = inspPadV
      + stackedHeights.reduce((sum, val) => sum + val, 0)
      + Math.max(0, stackedHeights.length - 1) * inspGap

    const canUseInspectorTabs = showChallengeControls || showOakhavenExchange
    const useInspectorTabs = canUseInspectorTabs && (isCompact || stackedMinH > maxInspH)
    const effectiveInspTab: WorldInspectorTab =
      worldInspectorTab === 'challenge' && !showChallengeControls
        ? 'overview'
        : worldInspectorTab === 'trade' && !showOakhavenExchange
          ? 'overview'
          : worldInspectorTab
    activeWorldInspectorTab = useInspectorTabs ? effectiveInspTab : 'all'

    const inspTabsH = useInspectorTabs ? (isCompact ? 26 : 30) : 0
    const activeChallengeCount = (activeChallenge.tier !== 'normal' ? 1 : 0) + activeChallenge.mutators.length
    const availableDealsCount = oakhavenOffers.filter(o => !o.purchasedThisCycle).length

    const inspH = useInspectorTabs
      ? (mobile
          ? Math.min(maxInspH, Math.max(316, Math.min(356, Math.round(h * 0.50))))
          : shortH
            ? Math.min(maxInspH, 336)
            : Math.min(maxInspH, 440))
      : mobile
        ? Math.min(maxInspH, Math.max(stackedMinH + 16, Math.round(h * (selectedIsAbyss ? 0.50 : 0.45))))
        : shortH
          ? Math.min(maxInspH, Math.max(stackedMinH + 12, 264))
          : Math.min(maxInspH, Math.max(stackedMinH + 24, (extraPanels > 1 ? 664 : extraPanels > 0 ? 648 : 548) + abyssExtraH + (selectedChestClaimable ? 26 : 0)))

    const showOverviewBody = !useInspectorTabs || effectiveInspTab === 'overview'
    const showChallengeBody = showChallengeControls && (!useInspectorTabs || effectiveInspTab === 'challenge')
    const showTradeBody = showOakhavenExchange && (!useInspectorTabs || effectiveInspTab === 'trade')

    const inspectorTabBarNodes: LayoutNode[] = useInspectorTabs
      ? [row({ id: 'wm-insp-tabs', style: { height: inspTabsH, gap: 4 } }, [
          boxNode({
            id: 'wm-insp-tab-overview',
            style: { grow: 1.12, height: inspTabsH },
            widget: {
              type: 'button',
              label: 'Battle Tab',
              selected: effectiveInspTab === 'overview',
              onPress: () => {
                audio.unlock()
                worldInspectorTab = 'overview'
                state.sounds.push({ kind: 'card', pitch: 1.02 })
                uiDirty = true
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(
                ctx,
                rect,
                'Battle',
                st,
                { icon: 'sword', count: selectedChestClaimable ? '★' : undefined }
              )
            }
          }),
          ...(showChallengeControls ? [boxNode({
            id: 'wm-insp-tab-challenge',
            style: { grow: 1.2, height: inspTabsH },
            widget: {
              type: 'button',
              label: 'Challenge Tab',
              selected: effectiveInspTab === 'challenge',
              onPress: () => {
                audio.unlock()
                worldInspectorTab = 'challenge'
                state.sounds.push({ kind: 'card', pitch: 1.08 })
                uiDirty = true
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(
                ctx,
                rect,
                'Challenge',
                st,
                { icon: 'skull', count: activeChallengeCount > 0 ? String(activeChallengeCount) : undefined }
              )
            }
          })] : []),
          ...(showOakhavenExchange ? [boxNode({
            id: 'wm-insp-tab-trade',
            style: { grow: 1, height: inspTabsH },
            widget: {
              type: 'button',
              label: 'Trade Tab',
              selected: effectiveInspTab === 'trade',
              onPress: () => {
                audio.unlock()
                worldInspectorTab = 'trade'
                state.sounds.push({ kind: 'coin', pitch: 1.08 })
                uiDirty = true
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(
                ctx,
                rect,
                'Trade',
                st,
                { icon: 'coin', count: availableDealsCount > 0 ? String(availableDealsCount) : undefined }
              )
            }
          })] : [])
        ])]
      : []

    const oakhavenExchangeNodes: LayoutNode[] = !showTradeBody
      ? []
      : useInspectorTabs
        ? [column({
            id: 'wm-oakhaven-exchange',
            style: { grow: 1, minHeight: 120, padding: [6, 8], gap: 5 },
            widget: {
              type: 'panel',
              blocksPointer: true,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
                drawWell(ctx, rect, RADIUS.md)
                drawOverline(
                  ctx,
                  oakhavenPatron
                    ? 'Guild Exchange · Patron -20%'
                    : 'Guild Exchange (Clear for -20%)',
                  rect.x + 8,
                  rect.y + 11,
                  Math.max(40, rect.width - 92),
                  oakhavenPatron ? '#ffcb57' : '#8fd4ff'
                )
                drawChip(ctx, rect.x + rect.width - 8, rect.y + 3, `${camp.gold}g`, {
                  icon: 'coin',
                  h: 17,
                  size: 9,
                  color: COLOR.accentHi,
                  bg: '#161f38',
                  align: 'right'
                })
              }
            }
          }, [
            boxNode({ style: { height: isCompact ? 16 : 18 } }),
            ...oakhavenOffers.map(offer => boxNode({
              id: `wm-oakhaven-${offer.deal.id}`,
              style: { grow: 1, minHeight: 28, maxHeight: 46 },
              widget: {
                type: 'button',
                label: `${offer.deal.shortLabel} (${offer.purchasedThisCycle ? 'Sold' : `${offer.cost}g`})`,
                disabled: !offer.canBuy,
                onPress: () => {
                  audio.unlock()
                  const res = buyOakhavenDeal(state, offer.deal.id)
                  if (res.ok) {
                    const gain = res.equipCard
                      ? EQUIPMENT_BY_ID[res.equipCard.equipId]?.name ?? 'Relic Card'
                      : res.dustGained > 0
                        ? `+${res.dustGained} Arcane Dust`
                        : `+${res.shardsGained} Hero Shards`
                    showToast(`Oakhaven Trade: ${gain} (-${res.goldSpent}g)`)
                    saveNow()
                    uiDirty = true
                    hudRev++
                  } else if (res.reason) {
                    showToast(res.reason)
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => {
                  const hot = offer.canBuy && (st.hovered || st.focused)
                  drawPanel(ctx, rect, {
                    r: RADIUS.md,
                    lipH: 3,
                    fill: offer.purchasedThisCycle ? '#1a2033eb' : hot ? '#364978f2' : '#202d4ef0',
                    fillBot: offer.purchasedThisCycle ? '#111624f0' : '#141e38f5'
                  })
                  const pillW = isCompact ? 62 : 70
                  const pillH = Math.min(rect.height - 8, isCompact ? 22 : 26)
                  const pillX = rect.x + rect.width - pillW - 7
                  const pillY = rect.y + (rect.height - pillH - 2) * 0.5
                  const textMaxW = Math.max(60, pillX - rect.x - 16)
                  if (rect.height >= 38) {
                    drawText(ctx, offer.deal.name, rect.x + 9, rect.y + 13, {
                      size: 11,
                      weight: 900,
                      color: offer.purchasedThisCycle ? COLOR.faint : offer.deal.accentHex,
                      maxW: textMaxW,
                      display: true
                    })
                    drawText(
                      ctx,
                      offer.purchasedThisCycle ? 'Sold out until next victory' : offer.deal.shortLabel,
                      rect.x + 9,
                      rect.y + rect.height - 11,
                      {
                        size: 9,
                        weight: 700,
                        color: offer.purchasedThisCycle ? '#6e7c9e' : '#cbd8f7',
                        maxW: textMaxW
                      }
                    )
                  } else {
                    drawText(ctx, `${offer.deal.shortLabel} · ${offer.deal.name}`, rect.x + 9, rect.y + (rect.height - 2) * 0.5, {
                      size: 10.5,
                      weight: 800,
                      color: offer.purchasedThisCycle ? COLOR.faint : offer.deal.accentHex,
                      maxW: textMaxW,
                      display: true
                    })
                  }
                  drawButton(
                    ctx,
                    { x: pillX, y: pillY, width: pillW, height: pillH },
                    offer.purchasedThisCycle ? 'SOLD' : `${offer.cost}g`,
                    { ...st, disabled: !offer.canBuy },
                    {
                      variant: offer.purchasedThisCycle ? 'secondary' : offer.canBuy ? 'primary' : 'secondary',
                      icon: offer.purchasedThisCycle ? 'check' : 'coin',
                      size: 9.5
                    }
                  )
                }
              }
            }))
          ])]
        : [column({
            id: 'wm-oakhaven-exchange',
            style: { height: exchangeH, padding: [6, 8], gap: 4 },
            widget: {
              type: 'panel',
              blocksPointer: true,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
                drawWell(ctx, rect, RADIUS.md)
                drawOverline(
                  ctx,
                  oakhavenPatron
                    ? 'Oakhaven Guild Exchange · Patron -20%'
                    : 'Oakhaven Guild Exchange (Clear for -20%)',
                  rect.x + 8,
                  rect.y + 10,
                  rect.width - 16,
                  oakhavenPatron ? '#ffcb57' : '#8fd4ff'
                )
              }
            }
          }, [
            spacerNode(isCompact ? 9 : 11),
            row({ id: 'wm-oakhaven-deals', style: { height: isCompact ? 34 : 38, gap: 4 } }, oakhavenOffers.map(offer => boxNode({
              id: `wm-oakhaven-${offer.deal.id}`,
              style: { grow: 1, height: isCompact ? 34 : 38 },
              widget: {
                type: 'button',
                label: `${offer.deal.shortLabel} (${offer.purchasedThisCycle ? 'Sold' : `${offer.cost}g`})`,
                disabled: !offer.canBuy,
                onPress: () => {
                  audio.unlock()
                  const res = buyOakhavenDeal(state, offer.deal.id)
                  if (res.ok) {
                    const gain = res.equipCard
                      ? EQUIPMENT_BY_ID[res.equipCard.equipId]?.name ?? 'Relic Card'
                      : res.dustGained > 0
                        ? `+${res.dustGained} Arcane Dust`
                        : `+${res.shardsGained} Hero Shards`
                    showToast(`Oakhaven Trade: ${gain} (-${res.goldSpent}g)`)
                    saveNow()
                    uiDirty = true
                    hudRev++
                  } else if (res.reason) {
                    showToast(res.reason)
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx,
                  rect,
                  offer.purchasedThisCycle ? 'SOLD' : `${offer.deal.shortLabel} · ${offer.cost}g`,
                  st,
                  {
                    variant: offer.purchasedThisCycle ? 'secondary' : offer.canBuy ? 'primary' : 'secondary',
                    size: isCompact ? 9.5 : 10
                  }
                )
              }
            })))
          ])]

    const stageInspectorPanel = column({
      id: 'wm-inspector',
      style: mobile
        ? { anchor: 'bottom', width: inspW, height: inspH, inset: [8, 8], padding: [8, 10], gap: inspGap, respectSafeArea: true }
        : shortH
          ? { anchor: 'top-right', width: inspW, height: inspH, inset: [outerPad, inspTopInset], padding: [8, 10], gap: inspGap, respectSafeArea: true }
          : { anchor: 'top-right', width: inspW, height: inspH, inset: [outerPad, inspTopInset], padding: [11, 13], gap: inspGap, respectSafeArea: true },
      widget: {
        type: 'panel',
        blocksPointer: true,
        draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, {
          r: RADIUS.xl,
          lipH: 5,
          fill: selectedSoon ? '#332b29f2' : '#253354f0',
          fillBot: selectedSoon ? '#1c1718f5' : '#141d36f5'
        })
      }
    }, [
      // Header: Region + Special/Soon Badge + Stage Title
      boxNode({
        id: 'wm-st-head',
        style: { height: headH },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            const chipH = shortH ? 16 : 18
            const chipSize = shortH ? 8.5 : 9
            const tag = selectedSoon
              ? 'COMING SOON'
              : selectedIsAbyss
                ? formatAbyssFloorLabel(abyssSelectedFloor)
                : (selected.specialTag ?? regionMeta.name)
            const tagBg = selectedSoon ? '#6e3226'
              : selected.kind === 'boss' ? '#5e1a2a'
              : selected.kind === 'elite' ? '#4a2417'
              : selected.kind === 'treasure' ? '#4a3610'
              : selected.kind === 'special' ? '#1c4236'
              : '#1e2c4f'
            const tagCol = selectedSoon ? '#ffe6b8'
              : selected.kind === 'boss' ? '#ff9ea8'
              : selected.kind === 'elite' ? '#ffa266'
              : selected.kind === 'treasure' || selected.kind === 'special' ? COLOR.accentHi
              : COLOR.ally
            drawChip(ctx, rect.x, rect.y, tag.toUpperCase(), { h: chipH, size: chipSize, color: tagCol, bg: tagBg })
            if (selectedCleared) {
              drawChip(ctx, rect.x + rect.width, rect.y, 'CLEARED', {
                h: chipH, size: chipSize, color: '#072b16', bg: COLOR.good, icon: 'check', align: 'right'
              })
            } else if (!selectedSoon && !selectedUnlocked) {
              drawChip(ctx, rect.x + rect.width, rect.y, 'LOCKED', {
                h: chipH, size: chipSize, color: COLOR.muted, bg: '#222b42', icon: 'lock', align: 'right'
              })
            } else {
              drawChip(ctx, rect.x + rect.width, rect.y, regionMeta.name.toUpperCase(), {
                h: chipH, size: 8.5, color: '#d8e3ff', bg: '#161f38', align: 'right'
              })
            }
            drawText(ctx, selected.title, rect.x, rect.y + (shortH ? 28 : isCompact ? 31 : 38), {
              size: shortH ? 14.5 : isCompact ? 15.5 : 19,
              weight: 900,
              color: '#ffffff',
              maxW: rect.width,
              display: true,
              stroke: true,
              strokeWidth: 3
            })
          }
        }
      }),

      // Sub-tab bar when compact or stacked sections would overflow (keeps Battle / Challenge / Trade strictly inside viewport)
      ...inspectorTabBarNodes,

      // Difficulty + Arena Size + Recommended Power strip
      ...(showOverviewBody ? [boxNode({
        id: 'wm-st-meta',
        style: { height: metaH },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawWell(ctx, rect, RADIUS.md)
            const topY = rect.y + (shortH ? 4 : 6)
            const badgeH = shortH ? 18 : 20
            const bw = drawDifficultyBadge(ctx, rect.x + 8, topY, inspectDifficulty, { h: badgeH, showLabel: true })
            const biomeChipW = drawChip(ctx, rect.x + 14 + bw, topY, selectedSoon ? biomeName : `${gridCols}x${gridRows} ${biomeName}`, {
              h: badgeH, size: shortH ? 9 : 9.5, color: '#dce8ff', bg: '#1e2b4a'
            })
            if (!selectedSoon) {
              const stageAtm = resolveBattleAtmosphere({
                stageId: selected.id,
                biome: selectedIsAbyss && abyssFloorSpec ? abyssFloorSpec.biome : selected.biome,
                chapterWeather: selected.weather,
                chapterTimeOfDay: selected.timeOfDay
              })
              const wx = rect.x + 14 + bw + biomeChipW + 6
              const availW = rect.x + rect.width - 8 - wx
              if (availW >= 54) {
                drawWeatherPreviewChip(ctx, wx, topY, stageAtm.weather, stageAtm.timeOfDay, {
                  h: badgeH,
                  maxW: availW
                })
              }
            }
            drawText(
              ctx,
              selectedSoon
                ? `${selected.subtitle} · In Development`
                : selectedIsAbyss && abyssFloorSpec
                  ? `${formatAbyssFloorLabel(abyssSelectedFloor)} · ${abyssFloorSpec.title} (Cleared ${camp.crownlessDeepFloor}/10)`
                  : `Squad Power ${squadPower} / Rec ${effectiveRecPower}`,
              rect.x + 10,
              rect.y + rect.height - (shortH ? 8 : 11),
              { size: shortH ? 10 : 10.5, weight: 800, color: selectedSoon ? '#f0cf99' : powerColor, maxW: rect.width - 20, display: true }
            )
          }
        }
      })] : []),

      // Hostile Forces OR Expansion Feature Teaser
      ...(showOverviewBody && !hideFoesForRoom ? [boxNode({
        id: 'wm-st-foes',
        style: { height: foesH },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawWell(ctx, rect, RADIUS.md)
            if (selectedSoon) {
              drawOverline(ctx, 'Upcoming Expansion Preview', rect.x + 10, rect.y + 12, rect.width - 20, '#f5d193')
              drawLabel(
                ctx,
                { x: rect.x + 10, y: rect.y + 22, width: rect.width - 20, height: 42 },
                selected.soonNote ?? selected.introText,
                { size: 11.5, weight: 600, color: '#f2e6d0', wrap: true, lineHeight: 15 }
              )
              return
            }
            drawOverline(ctx, `Hostile Forces (${inspectEnemies.length})`, rect.x + 10, rect.y + 11, rect.width - 20)
            let ex = rect.x + 10
            const ps = showChallengeControls ? 34 : 38
            const ey = rect.y + 21
            for (const [eid, count] of enemyList) {
              if (ex + ps > rect.x + rect.width - 8) break
              const spec = ENEMY_SPECS[eid]
              drawPortraitTile(ctx, ex, ey, ps, portraits[eid], {
                ring: spec.isBoss ? COLOR.accent : COLOR.enemy,
                ringW: 2,
                bg: spec.isBoss ? '#59205e' : '#632535'
              })
              drawChip(ctx, ex + ps + 2, ey + ps - 13, `x${count}`, {
                h: 15, size: 8.5, color: '#ffffff', bg: '#151c33', align: 'right'
              })
              ex += ps + 10
            }
          }
        }
      })] : []),

      // 3-Star Stage Mastery Checklist + One-Click 3★ Mastery Chest Claim CTA
      ...(showOverviewBody && showMasteryPanel ? [column({
        id: 'wm-st-mastery',
        style: {
          height: masteryH,
          gap: 4
        }
      }, [
        boxNode({
          id: 'wm-st-mastery-list',
          style: { height: masteryListH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawStageMasteryChecklist(ctx, rect, {
              record: selectedMastery,
              objectives: selectedMasteryObjectives,
              chestReward: selectedChestReward,
              chestClaimable: selectedChestClaimable,
              chestClaimed: selectedChestClaimed,
              compact: isCompact
            })
          }
        }),
        ...(selectedChestClaimable ? [boxNode({
          id: 'cs-world-claim-mastery-chest',
          style: { height: masteryBtnH },
          widget: {
            type: 'button',
            label: `Claim 3★ Mastery Chest (+${selectedChestReward.gold}g, +${selectedChestReward.dust} Dust, +${selectedChestReward.shards} Shards)`,
            primary: true,
            onPress: () => {
              audio.unlock()
              const res = claimStageMasteryChest(state, selected.id)
              if (res.ok) {
                showToast(`3★ Mastery Chest: +${res.gold}g · +${res.dust} Dust · +${res.shards} Shards`)
                saveNow()
                uiDirty = true
                hudRev++
              } else if (res.reason) {
                showToast(res.reason)
              }
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx,
              rect,
              `Claim 3★ Chest (+${selectedChestReward.gold}g · +${selectedChestReward.dust}D · +${selectedChestReward.shards}S)`,
              st,
              { variant: 'primary', icon: 'chest', size: isCompact ? 9.5 : 10.5 }
            )
          }
        })] : [])
      ])] : []),

      // Crownless Deep 10-Floor Selector (push deeper or replay cleared floors)
      ...(showOverviewBody && selectedIsAbyss && abyssFloorSpec ? [row({
        id: 'wm-abyss-floor-bar',
        style: { height: abyssBarH, gap: 6 }
      }, [
        boxNode({
          id: 'wm-abyss-prev',
          style: { width: 34, height: abyssBarH },
          widget: {
            type: 'button',
            label: 'Previous Abyss Floor',
            disabled: abyssSelectedFloor <= 1,
            onPress: () => {
              setSelectedCrownlessDeepFloor(camp, abyssSelectedFloor - 1)
              saveNow()
              uiDirty = true
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, '<', st, { variant: 'secondary', size: 13 }
            )
          }
        }),
        boxNode({
          id: 'wm-abyss-floor-info',
          style: { grow: 1, height: abyssBarH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
              drawWell(ctx, rect, RADIUS.md)
              drawText(
                ctx,
                `${formatAbyssFloorLabel(abyssSelectedFloor)} · ${abyssFloorSpec.title}`,
                rect.x + rect.width * 0.5,
                rect.y + rect.height * 0.5 + 1,
                { size: isCompact ? 10 : 11, weight: 800, color: '#e5adff', align: 'center', maxW: rect.width - 12 }
              )
            }
          }
        }),
        boxNode({
          id: 'wm-abyss-next',
          style: { width: 34, height: abyssBarH },
          widget: {
            type: 'button',
            label: 'Next Abyss Floor',
            disabled: abyssSelectedFloor >= abyssMaxSelectable,
            onPress: () => {
              setSelectedCrownlessDeepFloor(camp, abyssSelectedFloor + 1)
              saveNow()
              uiDirty = true
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, '>', st, { variant: 'secondary', size: 13 }
            )
          }
        })
      ])] : []),

      // Cleared-Stage Heroic / Mythic Difficulty Tier & Tactical Mutator Selector
      ...(showChallengeBody ? [column({
        id: 'wm-st-challenge',
        style: { height: challengeH, padding: isCompact ? [5, 7] : [6, 8], gap: isCompact ? 4 : 5 },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawWell(ctx, rect, RADIUS.md)
            drawOverline(
              ctx,
              activeChallenge.mutators.length > 0
                ? `Challenge Tier · ${activeChallenge.mutators.length} Mutator${activeChallenge.mutators.length > 1 ? 's' : ''} (+${challengeRewards.goldBonusPct}%g)`
                : `Challenge Tier & Mutators (${challengeRewards.goldBonusPct > 0 ? `+${challengeRewards.goldBonusPct}%g` : 'Base'})`,
              rect.x + 8,
              rect.y + 10,
              rect.width - 16,
              activeChallenge.tier === 'mythic' ? '#e5adff' : activeChallenge.tier === 'veteran' ? '#ffd285' : '#8fd4ff'
            )
          }
        }
      }, [
        spacerNode(isCompact ? 9 : 11),
        row({ id: 'wm-tier-row', style: { height: isCompact ? 28 : 34, gap: 5 } }, allowedTiers.map(tierId => boxNode({
          id: `wm-tier-${tierId}`,
          style: { grow: 1, height: isCompact ? 28 : 34 },
          widget: {
            type: 'button',
            label: `${STAGE_TIER_SPECS[tierId].label} Difficulty`,
            selected: activeChallenge.tier === tierId,
            onPress: () => setStageTier(selected.id, tierId),
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawStageTierSegment(
              ctx,
              rect,
              tierId,
              { selected: activeChallenge.tier === tierId, clearedUpTo: highestClearedTier, compact: isCompact },
              st
            )
          }
        }))),
        ...(mutatorsAllowed ? [
          row({ id: 'wm-mut-row-1', style: { height: isCompact ? 24 : 25, gap: 4 } }, STAGE_MUTATOR_IDS.slice(0, 3).map(mutId => boxNode({
            id: `wm-mut-${mutId}`,
            style: { grow: 1, height: isCompact ? 24 : 25 },
            widget: {
              type: 'button',
              label: STAGE_MUTATOR_SPECS[mutId].label,
              selected: activeChallenge.mutators.includes(mutId),
              onPress: () => toggleStageMutator(selected.id, mutId),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawMutatorChipButton(
                ctx,
                rect,
                mutId,
                { active: activeChallenge.mutators.includes(mutId), compact: true },
                st
              )
            }
          }))),
          row({ id: 'wm-mut-row-2', style: { height: isCompact ? 24 : 25, gap: 4 } }, STAGE_MUTATOR_IDS.slice(3).map(mutId => boxNode({
            id: `wm-mut-${mutId}`,
            style: { grow: 1, height: isCompact ? 24 : 25 },
            widget: {
              type: 'button',
              label: STAGE_MUTATOR_SPECS[mutId].label,
              selected: activeChallenge.mutators.includes(mutId),
              onPress: () => toggleStageMutator(selected.id, mutId),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawMutatorChipButton(
                ctx,
                rect,
                mutId,
                { active: activeChallenge.mutators.includes(mutId), compact: isCompact },
                st
              )
            }
          })))
        ] : [])
      ])] : []),

      // Live Challenge Power + Bonus Replay Spoils preview inside Challenge sub-tab
      ...(useInspectorTabs && effectiveInspTab === 'challenge' ? [boxNode({
        id: 'wm-st-challenge-rewards',
        style: { grow: 1, minHeight: 50 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawWell(ctx, rect, RADIUS.md)
            ctx.save()
            ctx.beginPath()
            ctx.rect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2))
            ctx.clip()
            const px = rect.x + 9
            const pw = rect.width - 18
            drawText(
              ctx,
              `Squad Power ${squadPower} / Rec ${effectiveRecPower} (${activeTierSpec.label})`,
              px,
              rect.y + 12,
              { size: 10, weight: 800, color: powerColor, maxW: pw, display: true }
            )
            const chipH = shortH ? 18 : 20
            let rx = px
            let ry = rect.y + 24
            for (const item of replayLoot) {
              const estW = Math.min(pw, item.text.length * 6.5 + 34)
              if (rx > px && rx + estW > px + pw) {
                rx = px
                ry += chipH + 3
              }
              const cw = drawChip(ctx, rx, ry, item.text, {
                icon: item.icon,
                h: chipH,
                size: 9.5,
                color: item.color ?? COLOR.text,
                bg: '#1c2642',
                border: COLOR.outline
              })
              rx += cw + 5
            }
            ctx.restore()
          }
        }
      })] : []),

      // Oakhaven Guild Exchange (Free Trade Hub Supply Deals)
      ...oakhavenExchangeNodes,

      // Possible Rewards: One-Time First-Clear vs Replayable
      ...(showOverviewBody ? [boxNode({
        id: 'wm-st-rewards',
        style: { grow: 1, minHeight: rewardsMinH },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawWell(ctx, rect, RADIUS.md)
            ctx.save()
            ctx.beginPath()
            ctx.rect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2))
            ctx.clip()
            const px = rect.x + 10
            const pw = rect.width - 20
            const chipH = shortH ? 18 : isCompact && showChallengeControls ? 19 : 22
            const compactClaimed = isCompact && selectedCleared
            drawOverline(
              ctx,
              selectedSoon
                ? 'Planned First-Clear Spoils'
                : selectedCleared ? 'First-Clear Special (Claimed)' : 'First-Clear Special (One-Time)',
              px,
              rect.y + (shortH ? 10 : 12),
              pw,
              selectedCleared ? COLOR.faint : COLOR.accentHi
            )
            let cx = px
            let cy = rect.y + (shortH ? 19 : 22)
            if (compactClaimed) {
              drawText(ctx, firstClearLoot.map(i => i.text).join(' · '), px, cy + (shortH ? 3 : 5), {
                size: 9.5,
                weight: 700,
                color: COLOR.faint,
                maxW: pw
              })
              cy -= shortH ? 10 : 8
            } else {
              for (const item of firstClearLoot) {
                const estW = Math.min(pw, item.text.length * 6.8 + 38)
                if (cx > px && cx + estW > px + pw) {
                  cx = px
                  cy += chipH + 4
                }
                const cw = drawChip(ctx, cx, cy, item.text, {
                  icon: item.icon,
                  h: chipH,
                  size: isCompact ? 9.5 : 10.5,
                  color: item.color ?? COLOR.text,
                  bg: '#1c2642',
                  border: COLOR.outline
                })
                cx += cw + 5
              }
            }

            const repTop = Math.max(cy + chipH + (shortH ? 6 : 9), rect.y + rect.height * (compactClaimed ? 0.44 : 0.52))
            drawOverline(
              ctx,
              challengeRewards.goldBonusPct > 0
                ? `Replay Spoils (+${challengeRewards.goldBonusPct}% Gold)`
                : 'Replay Spoils (Repeatable)',
              px,
              repTop,
              pw,
              activeChallenge.tier === 'mythic' ? '#e5adff' : activeChallenge.tier === 'veteran' ? '#ffd285' : '#8fd4ff'
            )
            let rx = px
            let ry = repTop + (shortH ? 7 : 9)
            for (const item of replayLoot) {
              const estW = Math.min(pw, item.text.length * 6.5 + 34)
              if (rx > px && rx + estW > px + pw) {
                rx = px
                ry += chipH + 3
              }
              const cw = drawChip(ctx, rx, ry, item.text, {
                icon: item.icon,
                h: chipH,
                size: isCompact ? 9.5 : 10,
                color: item.color ?? COLOR.text,
                bg: '#1c2642',
                border: COLOR.outline
              })
              rx += cw + 5
            }
            ctx.restore()
          }
        }
      })] : []),

      // Boss-less rematch skirmish note (ridgetop-5hr.9) OR unlock hint / modifier blurb
      ...(showOverviewBody && (isBossRematch || !hideHintForRoom) ? [boxNode({
        id: 'wm-st-hint',
        style: { height: isBossRematch ? 22 : 20 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            if (isBossRematch) {
              drawChip(ctx, rect.x + rect.width * 0.5, rect.y + 1, 'Boss Defeated · Garrison Skirmish (60% Spoils)', {
                h: 20,
                size: isCompact ? 9 : 10,
                color: '#ffe0a3',
                bg: '#3d2816',
                border: '#c78c3a',
                align: 'center'
              })
              return
            }
            drawLabel(
              ctx,
              rect,
              selectedSoon
                ? `${regionMeta.name} · ${regionMeta.tierRange} · Planned Expansion`
                : !selectedUnlocked
                  ? getStageUnlockHint(selected)
                  : selected.modifierDesc ?? `${selected.subtitle} · ${selected.enemies.length} foes`,
              {
                size: 10.5,
                weight: 700,
                color: selectedSoon ? '#f0cf99' : !selectedUnlocked ? '#ff9ea8' : COLOR.muted,
                align: 'center'
              }
            )
          }
        }
      })] : []),

      // Deploy / Replay / Coming Soon CTA (always pinned inside viewport)
      boxNode({
        id: 'cs-world-deploy',
        style: { height: deployH },
        widget: {
          type: 'button',
          label: deployLabel,
          primary: selectedUnlocked,
          disabled: !selectedUnlocked,
          onPress: () => {
            if (!selectedUnlocked) return
            triggerWorldDeployFlyIn(selected.id, selected.mapX, selected.mapY, () => openStory(selected.index, 0))
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx,
            rect,
            deployLabel,
            st,
            {
              variant: !selectedUnlocked ? 'secondary' : selectedCleared ? 'success' : 'primary',
              icon: selectedSoon ? 'hourglass' : !selectedUnlocked ? 'lock' : 'sword',
              size: isCompact ? 13 : 14
            }
          )
        }
      })
    ])

    const buildEventInspectorPanel = (ev: WorldMapEvent): LayoutNode => {
      const evRegion = WORLD_REGIONS[ev.region]
      const evBiomeName = ev.biome[0].toUpperCase() + ev.biome.slice(1)
      const isMerchant = ev.kind === 'wandering_merchant'
      const evInspH = mobile
        ? Math.min(maxInspH, isMerchant ? (h < 680 ? 298 : 326) : (h < 680 ? 278 : 302))
        : Math.min(maxInspH, isMerchant ? 430 : 444)
      const tagLabel = isMerchant ? 'RELIC CARAVAN' : ev.kind === 'goblin_ambush' ? 'ROAD BOUNTY' : 'TIMED GAUNTLET'
      const tagBg = isMerchant ? '#4a3410' : ev.kind === 'goblin_ambush' ? '#571e18' : '#351b5c'
      const tagCol = isMerchant ? COLOR.accentHi : ev.kind === 'goblin_ambush' ? '#ff9e7d' : '#dfb3ff'
      const turnsChip = `${ev.expiresAfterBattles}t LEFT`
      const evPowerRatio = squadPower / Math.max(1, ev.recommendedPower)
      const evPowerColor = evPowerRatio >= 1.0 ? COLOR.good : evPowerRatio >= 0.8 ? COLOR.accentHi : COLOR.danger

      const evEnemyCounts = new Map<EnemyArchetypeId, number>()
      if (ev.enemies) {
        for (const sp of ev.enemies) {
          evEnemyCounts.set(sp.id, (evEnemyCounts.get(sp.id) ?? 0) + 1)
        }
      }
      const evEnemyList = Array.from(evEnemyCounts.entries())

      const merchantRows: LayoutNode[] = isMerchant
        ? (ev.offers ?? []).slice(0, 3).map((offer, idx) => {
            const canAfford = !offer.purchased && camp.gold >= offer.cost
            const rarMeta = RARITY_META[offer.rarity]
            return boxNode({
              id: `cs-event-buy-${idx}`,
              style: { height: isCompact ? 46 : 62 },
              widget: {
                type: 'button',
                label: offer.purchased ? `${offer.label} (Sold)` : `Buy ${offer.label} (${offer.cost}g)`,
                disabled: !canAfford,
                onPress: () => {
                  audio.unlock()
                  const res = buyWorldEventOffer(state, ev.id, idx)
                  if (res.ok) {
                    const gain = res.equipCard
                      ? EQUIPMENT_BY_ID[res.equipCard.equipId]?.name ?? offer.label
                      : res.tacticCard
                        ? TACTIC_BY_ID[res.tacticCard.tacticId]?.name ?? offer.label
                        : res.dustGained > 0
                          ? `+${res.dustGained} Arcane Dust`
                          : `+${res.shardsGained} Hero Shards`
                    showToast(
                      res.eventCleared
                        ? `Caravan Bargain: ${gain} (-${res.goldSpent}g) · Caravan departed!`
                        : `Caravan Bargain: ${gain} (-${res.goldSpent}g)`
                    )
                    if (res.eventCleared) selectedWorldEventId = null
                    saveNow()
                    uiDirty = true
                    hudRev++
                  } else if (res.reason) {
                    showToast(res.reason)
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => {
                  const hot = canAfford && (st.hovered || st.focused)
                  drawPanel(ctx, rect, {
                    r: RADIUS.md,
                    lipH: 3,
                    fill: offer.purchased ? '#1a2033eb' : hot ? '#364978f2' : '#202d4ef0',
                    fillBot: offer.purchased ? '#111624f0' : '#141e38f5'
                  })
                  const padX = 10
                  const pillW = isCompact ? 68 : 78
                  const pillH = isCompact ? 24 : 28
                  const pillX = rect.x + rect.width - pillW - 8
                  const pillY = rect.y + (rect.height - pillH - 2) * 0.5
                  const textMaxW = Math.max(80, pillX - rect.x - padX - 8)

                  drawText(ctx, offer.label, rect.x + padX, rect.y + (isCompact ? 15 : 21), {
                    size: isCompact ? 11.5 : 13,
                    weight: 900,
                    color: offer.purchased ? COLOR.faint : rarMeta.hex,
                    maxW: textMaxW,
                    display: true
                  })
                  drawText(
                    ctx,
                    offer.purchased
                      ? 'Purchased · Added to Camp'
                      : offer.originalCost > offer.cost
                        ? `Was ${offer.originalCost}g · ${offer.detail}`
                        : offer.detail,
                    rect.x + padX,
                    rect.y + (isCompact ? 31 : 41),
                    {
                      size: isCompact ? 9 : 10,
                      weight: 600,
                      color: offer.purchased ? '#6e7c9e' : '#c8d6f5',
                      maxW: textMaxW
                    }
                  )
                  drawButton(
                    ctx,
                    { x: pillX, y: pillY, width: pillW, height: pillH },
                    offer.purchased ? 'SOLD' : `${offer.cost}g`,
                    { ...st, disabled: !canAfford },
                    {
                      variant: offer.purchased ? 'secondary' : canAfford ? 'primary' : 'secondary',
                      icon: offer.purchased ? 'check' : 'coin',
                      size: isCompact ? 10 : 11
                    }
                  )
                }
              }
            })
          })
        : []

      const combatLoot: { icon: IconName; text: string; color: string }[] = []
      if (ev.rewardGold > 0) combatLoot.push({ icon: 'coin', text: `+${ev.rewardGold}g Bounty`, color: COLOR.accentHi })
      if (ev.rewardDust > 0) combatLoot.push({ icon: 'sparkle', text: `+${ev.rewardDust} Dust`, color: '#7ad4ff' })
      if (ev.rewardShards > 0) combatLoot.push({ icon: 'star', text: `+${ev.rewardShards} Shards`, color: '#dfb3ff' })
      if (ev.rewardEquipRarity) {
        combatLoot.push({
          icon: 'bag',
          text: `${RARITY_META[ev.rewardEquipRarity].label} Gear`,
          color: RARITY_META[ev.rewardEquipRarity].hex
        })
      } else if (ev.kind === 'goblin_ambush') {
        combatLoot.push({ icon: 'chest', text: '2 Supply Chests', color: '#ffe484' })
      }

      return column({
        id: 'wm-inspector',
        style: mobile
          ? { anchor: 'bottom', width: inspW, height: evInspH, inset: [8, 8], padding: [8, 10], gap: 5, respectSafeArea: true }
          : shortH
            ? { anchor: 'top-right', width: inspW, height: evInspH, inset: [outerPad, inspTopInset], padding: [8, 10], gap: 5, respectSafeArea: true }
            : { anchor: 'top-right', width: inspW, height: evInspH, inset: [outerPad, inspTopInset], padding: [13, 14], gap: 8, respectSafeArea: true },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, {
            r: RADIUS.xl,
            lipH: 5,
            fill: isMerchant ? '#362d4cf2' : '#2b244bf2',
            fillBot: '#141933f6'
          })
        }
      }, [
        // Event Header
        boxNode({
          id: 'wm-ev-head',
          style: { height: isCompact ? 40 : 50 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
              drawChip(ctx, rect.x, rect.y, tagLabel, { h: 18, size: 9, color: tagCol, bg: tagBg })
              drawChip(ctx, rect.x + rect.width, rect.y, turnsChip, {
                h: 18,
                size: 9,
                color: ev.expiresAfterBattles <= 1 ? '#ffffff' : COLOR.accentHi,
                bg: ev.expiresAfterBattles <= 1 ? '#a82235' : '#1b2647',
                icon: 'hourglass',
                align: 'right'
              })
              drawText(ctx, ev.title, rect.x, rect.y + (isCompact ? 31 : 37), {
                size: isCompact ? 15 : 18.5,
                weight: 900,
                color: '#ffffff',
                maxW: rect.width,
                display: true,
                stroke: true,
                strokeWidth: 3
              })
            }
          }
        }),

        // Event Meta Strip
        boxNode({
          id: 'wm-ev-meta',
          style: { height: isCompact ? (isMerchant ? 36 : 42) : 46 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
              drawWell(ctx, rect, RADIUS.md)
              if (isMerchant) {
                drawChip(ctx, rect.x + 8, rect.y + 6, evRegion.name, { h: 19, size: 9, color: '#fff0c2', bg: '#423015' })
                drawChip(ctx, rect.x + rect.width - 8, rect.y + 6, `Gold: ${camp.gold}g`, {
                  icon: 'coin', h: 19, size: 9.5, color: COLOR.accentHi, bg: '#18223d', align: 'right'
                })
                if (!isCompact) {
                  drawText(ctx, 'Limited-time caravan deals · Disappears when sold out or expired', rect.x + 10, rect.y + rect.height - 9, {
                    size: 9.5, weight: 700, color: '#cbd8f7', maxW: rect.width - 20
                  })
                }
              } else {
                const bw = drawDifficultyBadge(ctx, rect.x + 8, rect.y + 5, ev.difficulty, { h: 19, showLabel: true })
                drawChip(ctx, rect.x + 14 + bw, rect.y + 5, `8x6 ${evBiomeName}`, {
                  h: 19, size: 9, color: '#dce8ff', bg: '#1e2b4a'
                })
                drawText(
                  ctx,
                  `Squad Power ${squadPower} / Rec ${ev.recommendedPower} · ${evRegion.name}`,
                  rect.x + 10,
                  rect.y + rect.height - 9,
                  { size: 10, weight: 800, color: evPowerColor, maxW: rect.width - 20, display: true }
                )
              }
            }
          }
        }),

        // Merchant 3 rotating bargains OR Combat Enemy + Reward Preview
        ...(isMerchant
          ? merchantRows
          : [
              boxNode({
                id: 'wm-ev-foes',
                style: { height: isCompact ? 54 : 70 },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
                    drawWell(ctx, rect, RADIUS.md)
                    drawOverline(ctx, `Event Forces (${ev.enemies?.length ?? 0})`, rect.x + 10, rect.y + 11, rect.width - 20)
                    let ex = rect.x + 10
                    const ey = rect.y + (isCompact ? 18 : 22)
                    const ps = isCompact ? 30 : 38
                    for (const [eid, count] of evEnemyList) {
                      if (ex + ps > rect.x + rect.width - 8) break
                      const spec = ENEMY_SPECS[eid]
                      drawPortraitTile(ctx, ex, ey, ps, portraits[eid], {
                        ring: spec.isBoss ? COLOR.accent : COLOR.enemy,
                        ringW: 2,
                        bg: spec.isBoss ? '#59205e' : '#632535'
                      })
                      drawChip(ctx, ex + ps + 2, ey + ps - 13, `x${count}`, {
                        h: 14, size: 8, color: '#ffffff', bg: '#151c33', align: 'right'
                      })
                      ex += ps + 10
                    }
                  }
                }
              }),
              boxNode({
                id: 'wm-ev-rewards',
                style: { grow: 1, minHeight: isCompact ? 56 : 92 },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
                    drawWell(ctx, rect, RADIUS.md)
                    const px = rect.x + 10
                    const pw = rect.width - 20
                    const chipH = isCompact ? 20 : 22
                    drawOverline(
                      ctx,
                      `Bounty Spoils · Expires in ${ev.expiresAfterBattles} Battle${ev.expiresAfterBattles === 1 ? '' : 's'}`,
                      px,
                      rect.y + 12,
                      pw,
                      COLOR.accentHi
                    )
                    let cx = px
                    let cy = rect.y + 22
                    for (const item of combatLoot) {
                      const estW = Math.min(pw, item.text.length * 6.8 + 38)
                      if (cx > px && cx + estW > px + pw) {
                        cx = px
                        cy += chipH + 4
                      }
                      const cw = drawChip(ctx, cx, cy, item.text, {
                        icon: item.icon,
                        h: chipH,
                        size: isCompact ? 9.5 : 10.5,
                        color: item.color,
                        bg: '#1c2642',
                        border: COLOR.outline
                      })
                      cx += cw + 5
                    }
                  }
                }
              })
            ]),

        // Footer Actions: Back to Stage + Deploy to Event (for combat events)
        isMerchant
          ? boxNode({
              id: 'wm-event-close',
              style: { height: isCompact ? 30 : 34 },
              widget: {
                type: 'button',
                label: 'Back to Stage',
                onPress: () => {
                  selectedWorldEventId = null
                  uiDirty = true
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, 'Back to Stage', st, { variant: 'secondary', icon: 'map', size: isCompact ? 11.5 : 12.5 }
                )
              }
            })
          : row({ id: 'wm-event-cta-row', style: { height: isCompact ? 36 : 42, gap: 6 } }, [
              boxNode({
                id: 'wm-event-close',
                style: { width: isCompact ? 68 : 80, height: isCompact ? 36 : 42 },
                widget: {
                  type: 'button',
                  label: 'Stage',
                  onPress: () => {
                    selectedWorldEventId = null
                    uiDirty = true
                  },
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                    ctx, rect, 'Stage', st, { variant: 'secondary', size: isCompact ? 11.5 : 12.5 }
                  )
                }
              }),
              boxNode({
                id: 'cs-world-deploy-event',
                style: { grow: 1, height: isCompact ? 36 : 42 },
                widget: {
                  type: 'button',
                  label: 'Deploy to Event',
                  primary: true,
                  onPress: () => triggerWorldDeployFlyIn(ev.id, ev.mapX, ev.mapY, () => launchWorldEventBattle(ev.id)),
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                    ctx, rect, 'Deploy to Event', st, { variant: 'primary', icon: 'sword', size: isCompact ? 13 : 14 }
                  )
                }
              })
            ])
      ])
    }

    const inspectorPanel = selectedEvent ? buildEventInspectorPanel(selectedEvent) : stageInspectorPanel

    const soonCount = CHAPTERS.length - PLAYABLE_CHAPTERS.length
    const testingRightInset = getTestingBarTopRightClearance(w, topH)
    const topRightInset = Math.max(outerPad, testingRightInset)
    const tightTopBar = narrowPhone && testingRightInset > 0
    const compactTopBar = mobile || shortH || (w - topRightInset) < 780
    const focusBtnW = narrowPhone ? 36 : compactTopBar ? 38 : 42
    const zoomCtrlW = narrowPhone ? 88 : compactTopBar ? 84 : 138
    const codexBtnW = codexUnlocked ? (tightTopBar ? 54 : narrowPhone ? 68 : compactTopBar ? 80 : 108) : 0
    const campBtnW = campUnlocked
      ? (tightTopBar
          ? 54
          : narrowPhone
            ? 68
            : compactTopBar
              ? (w - topRightInset >= 760 ? 148 : 80)
              : 150)
      : 0
    const endlessBtnW = endlessReady
      ? (tightTopBar ? 48 : narrowPhone ? 60 : compactTopBar ? 74 : 124)
      : 0
    const topActionGap = tightTopBar ? 4 : narrowPhone ? 5 : compactTopBar ? 6 : 8
    const wmTopActionsW = (narrowPhone ? 0 : zoomCtrlW + topActionGap)
      + focusBtnW
      + (endlessReady ? endlessBtnW + topActionGap : 0)
      + (codexUnlocked ? codexBtnW + topActionGap : 0)
      + (campUnlocked ? campBtnW + topActionGap : 0)

    const regionBanners: ProjectedRegionBanner[] = []
    for (const reg of buildDioramaLandmarks().regions) {
      const rp = scene.projectWorldMapPoint(reg.mapX, reg.mapY, worldMap3DCam, w, h, 0.95)
      if (!rp) continue
      regionBanners.push({
        name: reg.name,
        tierRange: reg.tierRange,
        x: rp.x,
        y: rp.y,
        accentHex: reg.accentHex,
        futureFrontier: reg.futureFrontier
      })
    }

    // Focus Mode (ridgetop-5hr.10): unobstructed 3D continent + pins + single safe-area >=44pt Exit Focus pill
    if (focusMode) {
      return overlay({ id: 'root', style: { anchor: 'fill' } }, [
        boxNode({
          id: 'wm-canvas-bg',
          style: { anchor: 'fill' },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWorldMap3DOverlay(
              ctx,
              rect,
              {
                time: worldMapTime,
                zoom: worldMap3DCam.zoom,
                yaw: worldMap3DCam.yaw,
                flyInProgress: getDioramaFlyInProgress(worldMap3DCam),
                regionBanners,
                compact: mobile
              }
            )
          }
        }),
        ...mapNodeEntries.map(e => e.node),
        buildExitFocusPill(vp)
      ])
    }

    // World Map Discovery Tip (ridgetop-5hr.2 / 5hr.3)
    const wmTip = checkDiscoveryTipForWorldMap(camp, {
      selectedStageId: selected.id,
      selectedCleared,
      hasWorldEvent: camp.worldEvents.length > 0,
      oakhavenUnlocked: isOakhavenExchangeUnlocked(camp),
      masteryUnlocked,
      challengeUnlocked: allowedTiers.length > 1,
      isBossRematch,
      crownlessDeepUnlocked: unlockedSet.has('abyssal_deep'),
      endlessUnlocked: endlessReady
    }) ?? getActiveScreenDiscoveryTip(camp, 'world_map')
    const wmTipTopY = topH + outerPad + 10
      + (resumableBattle ? (isCompact ? 48 : 54) : 0)
      + (nextReadyMilestone ? (isCompact ? 40 : 44) : 0)
    const wmTipW = mobile
      ? Math.min(w - outerPad * 2 - (narrowPhone ? zoomCtrlW + 8 : 0), 312)
      : Math.min(326, Math.max(220, w - inspW - outerPad * 3))
    const activeInspH = selectedEvent
      ? (mobile ? Math.min(maxInspH, Math.round(h * 0.58)) : Math.min(maxInspH, 444))
      : inspH
    const wmTipFits = Boolean(wmTip) && (!mobile || wmTipTopY + 124 < h - activeInspH - 16)
    const wmTipNodes: LayoutNode[] = wmTip && wmTipFits
      ? [buildScreenDiscoveryTipNode('world_map', wmTip, vp, {
          anchor: 'top-left',
          width: wmTipW,
          inset: [outerPad, wmTipTopY]
        })]
      : []

    // Omit map pins occluded behind the floating Stage/Event Inspector so non-button inspector clicks never pass through
    const safePad = 8
    const inspRectX = mobile ? (w - inspW) * 0.5 : (w - safePad - outerPad - inspW)
    const inspRectY = mobile ? (h - safePad - 8 - activeInspH) : (safePad + inspTopInset)
    const mapNodes: LayoutNode[] = []
    for (const entry of mapNodeEntries) {
      const occludedByInspector = entry.cx >= inspRectX && entry.cx <= inspRectX + inspW
        && entry.cy >= inspRectY && entry.cy <= inspRectY + activeInspH
      if (!occludedByInspector) mapNodes.push(entry.node)
    }

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      // Translucent cartographic vignette & 3D-projected region banners (lets the live 3D tabletop diorama shine through!)
      boxNode({
        id: 'wm-canvas-bg',
        style: { anchor: 'fill' },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWorldMap3DOverlay(
            ctx,
            rect,
            {
              time: worldMapTime,
              zoom: worldMap3DCam.zoom,
              yaw: worldMap3DCam.yaw,
              flyInProgress: getDioramaFlyInProgress(worldMap3DCam),
              regionBanners,
              compact: mobile
            }
          )
        }
      }),

      // Interactive landmark medallions floating directly over the illustrated continent!
      ...mapNodes,

      // Floating Top-Left Realm Title + Continent Mastery Stars + Gold Pill
      ...(() => {
        const safeHoriz = vp.safeArea.left + vp.safeArea.right
        const wmHeaderW = Math.max(92, Math.min(mobile ? 250 : 450, w - safeHoriz - wmTopActionsW - outerPad - topRightInset - 8))
        return [boxNode({
          id: 'wm-header',
          style: {
            anchor: 'top-left',
            width: wmHeaderW,
            height: topH,
            inset: [outerPad, outerPad],
            respectSafeArea: true
          },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
              drawPanel(ctx, rect, { r: RADIUS.lg, lipH: 4, fill: '#263459eb', fillBot: '#151e38f0' })
              const cy = rect.y + (rect.height - 4) / 2
              const prog = `${camp.clearedStageIds.length}/${PLAYABLE_CHAPTERS.length}`
              let rightEdge = rect.x + rect.width - 8
              let usedRight = 16
              if (masteryUnlocked && rect.width >= 210) {
                const starText = `${totalMasteryStars}/${maxMasteryStars}`
                const starChipW = drawChip(ctx, rightEdge, cy - 10, starText, {
                  icon: 'star',
                  h: 21,
                  size: rect.width < 260 ? 9.5 : 10.5,
                  color: nextReadyMilestone ? COLOR.accentText : COLOR.accentHi,
                  bg: nextReadyMilestone ? COLOR.accent : '#2a2210',
                  border: nextReadyMilestone ? COLOR.accentHi : '#705820',
                  align: 'right'
                })
                rightEdge -= starChipW + 5
                usedRight += starChipW + 5
              }
              const chipText = rect.width < 170
                ? `${camp.gold}g`
                : rect.width < 320
                  ? `${camp.gold}g`
                  : `${camp.gold}g · ${prog}`
              const goldChipW = drawChip(ctx, rightEdge, cy - 10, chipText, {
                icon: 'coin',
                h: 21,
                size: rect.width < 170 ? 9.5 : 10.5,
                color: COLOR.accentHi,
                bg: COLOR.wellDeep,
                align: 'right'
              })
              usedRight += goldChipW + 8
              drawText(ctx, rect.width < 185 || mobile ? 'SOLIS' : rect.width < 330 ? 'SOLIS MAP' : 'REALM OF SOLIS', rect.x + 10, cy + 0.5, {
                size: isCompact || rect.width < 320 ? 12 : 15,
                weight: 900,
                color: COLOR.accentHi,
                maxW: Math.max(36, rect.width - usedRight - 10),
                display: true,
                stroke: true,
                strokeWidth: 2.6
              })
            }
          }
        })]
      })(),

      // Floating Top-Left Continent Mastery Milestone Chest Banner (when a star milestone is ready to claim!)
      ...(nextReadyMilestone ? (() => {
        const ms = nextReadyMilestone
        const msTopOffset = topH + outerPad + 10 + (resumableBattle ? (isCompact ? 48 : 54) : 0)
        const msW = narrowPhone && !resumableBattle
          ? Math.max(180, w - outerPad * 2 - zoomCtrlW - 8)
          : mobile ? Math.min(w - 16, 400) : 390
        const msLabel = narrowPhone && !resumableBattle
          ? `★${ms.threshold} Chest (+${ms.gold}g · +${ms.dust}D)`
          : mobile
            ? `Claim ★${ms.threshold} Chest (+${ms.gold}g · +${ms.dust}D · +${ms.shards}S)`
            : `Claim ${ms.threshold}★ ${ms.title} (+${ms.gold}g · +${ms.dust}D · +${ms.shards}S)`
        return [boxNode({
          id: 'cs-world-claim-milestone',
          style: {
            anchor: 'top-left',
            width: msW,
            height: isCompact ? 34 : 38,
            inset: [outerPad, msTopOffset],
            respectSafeArea: true
          },
          widget: {
            type: 'button',
            label: msLabel,
            primary: true,
            onPress: () => {
              audio.unlock()
              const res = claimMasteryMilestone(state, ms.threshold)
              if (res.ok) {
                showToast(`★ ${res.threshold}★ ${res.title}: +${res.gold}g · +${res.dust} Dust · +${res.shards} Shards`)
                saveNow()
                uiDirty = true
                hudRev++
              } else if (res.reason) {
                showToast(res.reason)
              }
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, msLabel, st, { variant: 'primary', icon: 'chest', size: isCompact ? 10.5 : 11.5 }
            )
          }
        })]
      })() : []),

      // Floating Top-Left Resume Battle Banner (when a mid-battle auto-save exists)
      ...(resumableBattle ? (() => {
        const resumeSnap = resumableBattle
        const wmResumeLabel = formatResumableBattleLabel(resumeSnap, isCompact)
        const resumeW = narrowPhone
          ? Math.max(180, w - outerPad * 2 - zoomCtrlW - 8)
          : mobile ? Math.min(w - 16, 420) : 410
        return [row({
          id: 'wm-resume-bar',
          style: {
            anchor: 'top-left',
            width: resumeW,
            height: isCompact ? 42 : 46,
            inset: [outerPad, topH + outerPad + 10],
            padding: [5, 6],
            gap: 6,
            align: 'center',
            respectSafeArea: true
          },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, {
              r: RADIUS.lg,
              lipH: 4,
              fill: '#2a3a64f2',
              fillBot: '#182342f5'
            })
          }
        }, [
          boxNode({
            id: 'cs-world-resume',
            style: { grow: 2.5, height: isCompact ? 32 : 34 },
            widget: {
              type: 'button',
              label: wmResumeLabel,
              primary: true,
              onPress: () => resumeSavedBattle(),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, wmResumeLabel, st, { variant: 'primary', icon: 'sword', size: isCompact ? 11.5 : 12.5 }
              )
            }
          }),
          boxNode({
            id: 'cs-world-abandon',
            style: { width: mobile ? 72 : 92, height: isCompact ? 32 : 34 },
            widget: {
              type: 'button',
              label: 'Abandon',
              onPress: () => discardResumableBattle('Saved battle abandoned.'),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Abandon', st, { variant: 'danger', icon: 'retreat', size: 11.5 }
              )
            }
          })
        ])]
      })() : []),

      // Compact Zoom Bar docked cleanly below top-right actions on narrow phones (< 520px)
      ...(narrowPhone ? [row({
        id: 'wm-zoom-bar',
        style: {
          anchor: 'top-right',
          width: zoomCtrlW,
          height: 44,
          inset: [outerPad, topH + outerPad + 10],
          padding: [3, 4],
          gap: 4,
          align: 'center',
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawToolbarBg(ctx, rect)
        }
      }, [
        boxNode({
          id: 'wm-zoom-out',
          style: { width: 38, height: 38 },
          widget: {
            type: 'button', label: 'Zoom Out',
            onPress: () => { zoomDioramaCamera(worldMap3DCam, 1 / 1.18); uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'minus', st)
          }
        }),
        boxNode({
          id: 'wm-zoom-in',
          style: { width: 38, height: 38 },
          widget: {
            type: 'button', label: 'Zoom In',
            onPress: () => { zoomDioramaCamera(worldMap3DCam, 1.18); uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'plus', st)
          }
        })
      ])] : []),

      // Floating Top-Right Toolbar: Zoom (- / Fit / +) + Focus + Endless + Codex + Vanguard Camp
      row({
        id: 'wm-top-actions',
        style: {
          anchor: 'top-right',
          width: wmTopActionsW,
          height: topH,
          inset: [topRightInset, outerPad],
          gap: topActionGap,
          align: 'center',
          respectSafeArea: true
        }
      }, [
        ...(narrowPhone ? [] : [row({
          id: 'wm-zoom-bar',
          style: { width: zoomCtrlW, height: topH, padding: shortH ? [3, 4] : [5, 6], gap: 5, align: 'center' },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawToolbarBg(ctx, rect)
          }
        }, [
          boxNode({
            id: 'wm-zoom-out',
            style: { width: shortH ? 34 : 28, height: shortH ? 32 : 30 },
            widget: {
              type: 'button', label: 'Zoom Out',
              onPress: () => { zoomDioramaCamera(worldMap3DCam, 1 / 1.18); uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'minus', st)
            }
          }),
          ...(compactTopBar ? [] : [boxNode({
            id: 'wm-zoom-fit',
            style: { grow: 1, height: 30 },
            widget: {
              type: 'button', label: 'Fit Map',
              onPress: () => { resetWorldMapOverview(); uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Fit', st, { variant: 'ghost', size: 11 })
            }
          })]),
          boxNode({
            id: 'wm-zoom-in',
            style: { width: shortH ? 34 : 28, height: shortH ? 32 : 30 },
            widget: {
              type: 'button', label: 'Zoom In',
              onPress: () => { zoomDioramaCamera(worldMap3DCam, 1.18); uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'plus', st)
            }
          })
        ])]),
        boxNode({
          id: 'cs-wm-focus-mode',
          style: { width: focusBtnW, height: topH },
          widget: {
            type: 'button',
            label: uiCopy(vp.isTouchPrimary, 'Focus Mode (H)', 'Focus Mode'),
            onPress: () => {
              audio.unlock()
              focusMode = true
              state.sounds.push({ kind: 'card', pitch: 1.12 })
              uiDirty = true
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'target', st, {
              label: vp.showKeycaps && !compactTopBar ? 'H' : undefined
            })
          }
        }),
        ...(endlessReady ? [boxNode({
          id: 'cs-world-endless',
          style: { width: endlessBtnW, height: topH },
          widget: {
            type: 'button',
            label: camp.endlessRun
              ? (camp.endlessRun.pendingDraft.length > 0
                  ? `Draft Endless Blessing (W${camp.endlessRun.currentWave + 1})`
                  : `Endless W${camp.endlessRun.currentWave}`)
              : camp.endlessBest > 0 ? `Endless (Best W${camp.endlessBest})` : 'Endless W1',
            onPress: () => {
              audio.unlock()
              if (state.campaign.endlessRun && state.campaign.endlessRun.pendingDraft.length > 0) {
                openPendingEndlessDraft()
                return
              }
              const run = state.campaign.endlessRun ?? startEndlessRun(state, 1)
              const wave = Math.max(1, run.currentWave)
              const sel = selectEndlessWaveStage(run.seed, wave, run.lastBiome && wave > 1 ? run.lastBiome : undefined)
              saveNow()
              openStory(sel.chapter.index, wave)
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => {
              const run = camp.endlessRun
              const hasDraft = Boolean(run && run.pendingDraft.length > 0)
              const btnLabel = hasDraft && run
                ? (narrowPhone ? 'Draft' : mobile ? `Draft W${run.currentWave + 1}` : `Draft W${run.currentWave + 1}`)
                : run
                  ? (narrowPhone ? `W${run.currentWave}` : mobile ? `Wave ${run.currentWave}` : `Endless W${run.currentWave}`)
                  : (narrowPhone ? `W${camp.endlessBest + 1}` : mobile ? 'Endless' : camp.endlessBest > 0 ? `Endless · B${camp.endlessBest}` : 'Endless W1')
              drawButton(ctx, rect, btnLabel, st, {
                variant: hasDraft ? 'primary' : 'danger',
                icon: hasDraft ? 'sparkle' : 'skull',
                size: narrowPhone ? 11 : 12
              })
            }
          }
        })] : []),
        ...(codexUnlocked ? [boxNode({
          id: 'cs-world-codex',
          style: { width: codexBtnW, height: topH },
          widget: {
            type: 'button',
            label: 'Codex',
            onPress: () => {
              audio.unlock()
              openCodex()
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, 'Codex', st, { variant: 'secondary', icon: 'scroll', trailing: !vp.showKeycaps || compactTopBar ? undefined : 'C', size: narrowPhone ? 10.5 : 12.5 }
            )
          }
        })] : []),
        ...(campUnlocked ? [boxNode({
          id: 'cs-world-camp',
          style: { width: campBtnW, height: topH },
          widget: {
            type: 'button',
            label: 'Vanguard Camp',
            onPress: () => {
              audio.unlock()
              openCamp('squad')
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, campBtnW < 132 ? 'Camp' : 'Vanguard Camp', st, { variant: 'secondary', icon: 'camp', size: narrowPhone ? 10.5 : 12.5 }
            )
          }
        })] : [])
      ]),

      // Bottom-left subtle cartography legend pill (wide desktop only so it never overlaps wm-inspector)
      ...(mobile || w < 920 ? [] : [boxNode({
        id: 'wm-legend',
        style: { anchor: 'bottom-left', width: 512, height: 28, inset: [outerPad, outerPad], respectSafeArea: true },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            const navHint = uiCopy(
              vp.isTouchPrimary,
              'Drag Pan · Right-Drag / Q·E Orbit · Scroll Zoom',
              'Drag Pan · Pinch Zoom · 2-Finger Orbit'
            )
            const masterySuffix = masteryUnlocked
              ? ` · ★ ${totalMasteryStars}/${maxMasteryStars}${nextUpcomingMilestone ? ` (${nextUpcomingMilestone.threshold}★)` : soonCount > 0 ? '' : ' · Grandmaster!'}`
              : ''
            drawHintPill(ctx, rect, `${navHint}${masterySuffix}`, COLOR.accentHi)
          }
        }
      })]),

      ...wmTipNodes,
      inspectorPanel
    ])
  }

  // =========================================================================
  // STORY BRIEFING (CINEMATIC LETTERBOX OVER LIVE 3D DIORAMA)
  // =========================================================================

  function buildStoryTree(w: number, h: number): LayoutNode {
    const mobile = w < 640
    const shortH = h < 480
    const ch = CHAPTERS[pendingChapter]
    const alreadyCleared = pendingEndless === 0 && isStageCleared(state.campaign, ch.id)
    const eq = ch.rewardEquipId ? EQUIPMENT_BY_ID[ch.rewardEquipId] : undefined
    const hero = ch.rewardHeroId ? HERO_SPECS[ch.rewardHeroId] : undefined
    const speakerIcon = portraits[SPEAKER_PORTRAIT[ch.introSpeaker] ?? 'knight']
    const gridCols = ch.grid[0]?.length ?? 8
    const gridRows = ch.grid.length
    const diffMeta = DIFFICULTY_META[ch.difficulty]
    const storyChallenge = alreadyCleared
      ? getStageChallenge(ch.id)
      : DEFAULT_STAGE_CHALLENGE
    const storyTierSpec = STAGE_TIER_SPECS[storyChallenge.tier]
    const storyRewards = alreadyCleared
      ? computeChallengeRewards(ch.replayGold, ch.difficulty, storyChallenge.tier, storyChallenge.mutators)
      : null
    const storyAbyssSpec = pendingEndless === 0 && isCrownlessDeepStage(ch.id)
      ? getCrownlessDeepFloorSpec(getSelectedCrownlessDeepFloor(state.campaign))
      : null
    const endlessBiomeLabel = formatEndlessBiomeLabel(ch.biome)
    const endlessBlessingCount = state.campaign.endlessRun?.activeBlessings.length ?? 0
    const header = pendingEndless > 0
      ? `Endless Wave ${pendingEndless} · ${endlessBiomeLabel}`
      : storyAbyssSpec
        ? `${ch.title} — ${formatAbyssFloorLabel(storyAbyssSpec.floor)}`
        : ch.title
    const challengeTag = alreadyCleared && (storyChallenge.tier !== 'normal' || storyChallenge.mutators.length > 0)
      ? ` · ${storyTierSpec.label.toUpperCase()}${storyChallenge.mutators.length > 0 ? ` +${storyChallenge.mutators.length} MUT` : ''}`
      : ''
    const kicker = pendingEndless > 0
      ? `${ch.title} · ${gridCols}x${gridRows}${isEndlessBossWave(pendingEndless) ? ' · BOSS WAVE' : ''}${endlessBlessingCount > 0 ? ` · ${endlessBlessingCount} Blessings` : ''}`
      : storyAbyssSpec
        ? `${storyAbyssSpec.title} · ${storyAbyssSpec.modifierSummary}`
        : `${ch.subtitle} · ${gridCols}x${gridRows} · Diff ${diffMeta.short}${challengeTag}`
    const desc = pendingEndless > 0
      ? (isEndlessBossWave(pendingEndless)
          ? `A ${endlessBiomeLabel} Boss commands this Endless wave! Vanquish the host to draft a temporary Run Blessing for Wave ${pendingEndless + 1}.`
          : `Rotating Roguelite Endless wave across the ${endlessBiomeLabel}. Clear the wave to draft 1 of 3 Run Blessings.`)
      : `"${ch.introText}"`

    const lootItems: { icon: IconName; text: string; color?: string }[] = []
    if (pendingEndless > 0) {
      lootItems.push(
        { icon: 'coin', text: `+${130 + pendingEndless * 35}g`, color: COLOR.accentHi },
        { icon: 'bag', text: 'Weighted Gear', color: '#9fd3ff' },
        { icon: 'users', text: 'Weighted Hero', color: '#9ff0c4' }
      )
    } else if (alreadyCleared && storyRewards) {
      lootItems.push(
        {
          icon: 'coin',
          text: storyRewards.goldBonusPct > 0
            ? `+${storyRewards.replayGold}g (+${storyRewards.goldBonusPct}%)`
            : `+${storyRewards.replayGold}g (Replay)`,
          color: COLOR.accentHi
        },
        {
          icon: 'cards',
          text: storyRewards.dropTierLabel,
          color: storyChallenge.tier === 'mythic' ? '#e5adff' : storyChallenge.tier === 'veteran' ? '#ffd285' : '#9fd3ff'
        }
      )
      if (storyRewards.bonusDust > 0 || storyRewards.bonusShards > 0) {
        lootItems.push({
          icon: 'sparkle',
          text: `+${storyRewards.bonusDust} Dust · +${storyRewards.bonusShards} Shd`,
          color: '#a3f7d0'
        })
      } else {
        lootItems.push({ icon: 'check', text: 'Specials Claimed', color: COLOR.muted })
      }
    } else {
      const objSum = getChapterObjectiveSummary(ch)
      const objIcon: IconName = objSum.kind === 'assassinate'
        ? 'target'
        : objSum.kind === 'defend'
          ? 'shield'
          : objSum.kind === 'seize'
            ? 'flag'
            : 'sword'
      const objColor = objSum.kind === 'assassinate'
        ? '#ff8590'
        : objSum.kind === 'defend'
          ? '#7cf0ff'
          : objSum.kind === 'seize'
            ? COLOR.accentHi
            : '#9ff0c4'
      lootItems.push({ icon: objIcon, text: objSum.short, color: objColor })
      lootItems.push({ icon: 'coin', text: `+${ch.rewardGold}g`, color: COLOR.accentHi })
      if (eq) lootItems.push({ icon: 'bag', text: `${eq.name} (1x)`, color: RARITY_META[eq.rarity].hex })
      if (hero) lootItems.push({ icon: 'users', text: `${hero.name} (1x)`, color: '#9ff0c4' })
    }

    const topBarH = shortH ? 62 : mobile ? 92 : 104
    const bottomBarH = shortH ? 176 : mobile ? 268 : 226
    const contentW = Math.min(w - 24, 760)
    const portraitS = shortH ? 52 : mobile ? 58 : 80
    const dialogH = shortH ? 58 : mobile ? 96 : 84
    const actH = shortH ? 38 : 46

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({
        id: 'story-letterbox',
        style: { anchor: 'fill' },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLetterbox(ctx, rect, topBarH + 20, bottomBarH + 28)
        }
      }),
      // Top chapter title in upper letterbox bar
      boxNode({
        id: 'st-head',
        style: { anchor: 'top', width: contentW, height: shortH ? 48 : 64, inset: shortH ? 6 : mobile ? 14 : 20, respectSafeArea: true },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawStoryHeading(ctx, rect, kicker, header)
        }
      }),
      // Bottom cinematic dialogue bar
      column({
        id: 'story-modal',
        style: { anchor: 'bottom', width: contentW, inset: shortH ? 8 : mobile ? 14 : 20, padding: shortH ? [10, 14] : [14, 18], gap: shortH ? 7 : 12, respectSafeArea: true },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSheet(ctx, rect)
        }
      }, [
        row({ id: 'st-dialog', style: { height: dialogH, gap: shortH ? 10 : 14, align: 'center' } }, [
          ...(speakerIcon ? [boxNode({
            id: 'st-portrait', style: { width: portraitS, height: portraitS },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSpeakerPortrait(ctx, rect, speakerIcon)
            }
          })] : []),
          column({ id: 'st-lines', style: { grow: 1, gap: shortH ? 2 : 4 } }, [
            boxNode({
              id: 'st-spk', style: { height: 16 },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                  ctx, rect, ch.introSpeaker, { size: shortH ? 11 : 12, weight: 800, color: COLOR.accent, upper: true, spacing: 1.4 }
                )
              }
            }),
            boxNode({
              id: 'st-text', style: { height: shortH ? 40 : mobile ? 72 : 58 },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                  ctx, rect, desc, { size: shortH ? 12 : mobile ? 12.5 : 14, weight: 500, color: COLOR.text, wrap: true, lineHeight: shortH ? 15.5 : mobile ? 17 : 19 }
                )
              }
            })
          ])
        ]),
        boxNode({
          id: 'st-loot', style: { height: shortH ? 22 : 26 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLootRow(ctx, rect, lootItems, mobile ? 'left' : 'center')
          }
        }),
        row({ id: 'st-actions', style: { height: actH, gap: 10 } }, [
          boxNode({
            id: 'cs-story-back', style: { grow: 1, height: actH },
            widget: {
              type: 'button',
              label: 'World Map',
              onPress: () => openWorldMap(),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, mobile ? 'Map' : 'World Map', st, { variant: 'secondary', icon: 'map', size: shortH ? 12 : 13 }
              )
            }
          }),
          boxNode({
            id: 'cs-story-go', style: { grow: 1.5, height: actH },
            widget: {
              type: 'button',
              label: 'Deploy Squad',
              primary: true,
              onPress: launchBattle,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, alreadyCleared ? 'Replay Battle' : 'Deploy Squad', st, { variant: 'primary', icon: 'sword', size: shortH ? 14 : 15 }
              )
            }
          })
        ])
      ])
    ])
  }

  // =========================================================================
  // BATTLE HUD (DESKTOP, TABLET, PHONE PORTRAIT, & PHONE LANDSCAPE)
  // =========================================================================

  function buildBattleTree(w: number, h: number): LayoutNode {
    const vp = getViewportProfile(w, h)
    const battle = state.battle
    if (!battle) return overlay({ id: 'root', style: { anchor: 'fill' } }, [])

    // Focus Mode (ridgetop-5hr.10): unobstructed 3D battlefield + single safe-area >=44pt Exit Focus pill
    if (focusMode) {
      return overlay({ id: 'root', style: { anchor: 'fill' } }, [buildExitFocusPill(vp)])
    }

    const mobilePortrait = vp.isPortraitPhone
    const mobileLandscape = vp.isLandscapePhone
    const isPhone = vp.isPhone
    const narrow = w < 1080
    const advToolsUnlocked = areAdvancedBattleToolsUnlocked(state.campaign)
    const ch = CHAPTERS[battle.chapterIndex]
    const active = getUnitByUid(battle, battle.activeUnitUid)
    const inspected = getUnitByUid(battle, battle.selectedUnitUid) ?? active
    const isDeployPhase = battle.phase === 'deploy'
    const isPlayerTurn = battle.phase === 'player' && Boolean(active && active.team === 'ally')
    const activeForecast = resolveActiveForecast()

    // 1. Top Turn-Order Token Strip (with Hover Spotlight + CT Shift Preview!)
    const maxSlots = mobilePortrait ? 5 : mobileLandscape ? 5 : w < 1380 ? 5 : 7
    const tokenW = mobilePortrait ? 42 : mobileLandscape ? 38 : 50
    const tokenH = mobilePortrait ? 46 : mobileLandscape ? 42 : 60
    const ctPreviewKind = !hoveredTurnUnitUid ? resolveTurnActionPreviewKind(activeForecast) : null
    const ctPreview: TurnOrderActionPreview | null = ctPreviewKind
      ? previewTurnOrderAfterAction(battle, ctPreviewKind, maxSlots)
      : null
    const waitComparison: TurnOrderActionPreview | null = ctPreview && ctPreview.ctSaved === 0
      ? previewTurnOrderAfterAction(battle, 'wait', maxSlots)
      : null
    const projectedBarSlot = ctPreview && ctPreview.projectedIndex >= 0
      ? Math.min(maxSlots - 1, 1 + ctPreview.projectedIndex)
      : -1
    const baselineBarSlot = ctPreview && ctPreview.slotsGained > 0 && ctPreview.baselineIndex >= 0
      ? 1 + ctPreview.baselineIndex
      : -1
    const timelineNodes: LayoutNode[] = battle.turnOrder.slice(0, maxSlots).map((entry, idx) => {
      const unit = getUnitByUid(battle, entry.uid)
      const pKey = entry.heroId ?? entry.enemyId ?? 'knight'
      const icon = unit ? battleUnitPortrait(unit) : portraits[pKey]
      const isProjectedLanding = Boolean(ctPreview && !entry.isCurrent && idx === projectedBarSlot)
      const tokenOpts = {
        spotlighted: Boolean(hoveredTurnUnitUid && entry.uid === hoveredTurnUnitUid),
        dimmed: Boolean(hoveredTurnUnitUid && entry.uid !== hoveredTurnUnitUid),
        projectedSlot: isProjectedLanding,
        projectedBadge: isProjectedLanding && ctPreview
          ? (ctPreview.ctSaved > 0 ? `+${ctPreview.ctSaved} CT` : `#${ctPreview.projectedIndex + 1}`)
          : undefined,
        projectedAccent: ctPreview ? (ctPreview.ctSaved > 0 ? COLOR.ap : '#ff9a44') : undefined,
        wasBaselineSlot: Boolean(ctPreview && ctPreview.slotsGained > 0 && idx === baselineBarSlot && idx < maxSlots)
      }
      return boxNode({
        id: `tl-${idx}`,
        style: { width: tokenW, height: tokenH },
        widget: {
          type: 'button',
          label: entry.name,
          selected: entry.isCurrent,
          onPress: () => {
            const clickedUnit = getUnitByUid(battle, entry.uid)
            if (clickedUnit && isEnemyShrouded(battle, clickedUnit)) return
            lockedForecastCell = null
            pendingOaMoveCell = null
            inspectedTileCell = null
            selectHeroByUid(state, entry.uid)
            if (vp.isTouchPrimary) {
              if (hoveredTurnUnitUid === entry.uid) {
                hoveredTurnUnitUid = null
                hoveredTurnSlotIdx = -1
              } else {
                hoveredTurnUnitUid = entry.uid
                hoveredTurnSlotIdx = idx
              }
              scene.setSpotlightUnit(hoveredTurnUnitUid)
            }
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTurnToken(ctx, rect, entry, icon, st, tokenOpts)
        }
      })
    })
    const timelineW = timelineNodes.length * tokenW + Math.max(0, timelineNodes.length - 1) * 5 + 18

    // 2. Active Hero Skills (1, 2, 3, 4)
    const buildSkillTiles = (tileH: number): LayoutNode[] => {
      if (!active || active.team !== 'ally' || !active.heroId) return []
      const spec = HERO_SPECS[active.heroId]
      const canAct = isPlayerTurn && !active.acted && active.stunTurns === 0
      const keycaps: readonly string[] = ['2', '3', '4']

      const basicNode = boxNode({
        id: 'sk-basic',
        style: { grow: 1, height: tileH },
        widget: {
          type: 'button',
          label: 'Strike',
          selected: battle.armedSkillIndex === null && !battle.armedTacticUid && canAct,
          disabled: !vp.isTouchPrimary && !canAct,
          onPress: () => {
            audio.unlock()
            mobileHandOpen = false
            if (!canAct) {
              const reason = !isPlayerTurn ? 'Wait for your turn' : active.stunTurns > 0 ? 'Stunned this turn' : 'Already acted this turn'
              showBattleTouchInfo(`Strike (ATK ${active.atk}) — ${reason}.`)
              return
            }
            armSkill(state, null)
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSkillTile(ctx, rect, {
            name: 'Strike',
            subtitle: `ATK ${active.atk}`,
            keycap: '1',
            hideKeycap: !vp.showKeycaps,
            vfx: 'strike',
            skillId: 'strike',
            unlocked: true,
            cooldown: 0
          }, { ...st, disabled: !canAct })
        }
      })

      const tiers: LayoutNode[] = []
      for (let i = 0; i < 3; i++) {
        const sk = getEffectiveHeroSkill(active.heroId, i, active.stars >= 3 ? active.subSpecId : undefined) ?? spec.skills[i]
        const unlocked = active.stars >= sk.tier
        const cd = active.cooldowns[i]
        const armed = battle.armedSkillIndex === i
        const skillDisabled = !canAct || !unlocked || cd > 0
        tiers.push(boxNode({
          id: `sk-${i}`,
          style: { grow: 1, height: tileH },
          widget: {
            type: 'button',
            label: sk.name,
            selected: armed,
            disabled: !vp.isTouchPrimary && skillDisabled,
            onPress: () => {
              audio.unlock()
              mobileHandOpen = false
              if (skillDisabled) {
                const reason = !unlocked
                  ? `Locked (requires ${sk.tier}★)`
                  : cd > 0
                    ? `Cooldown (${cd}t left)`
                    : active.stunTurns > 0
                      ? 'Stunned'
                      : !isPlayerTurn
                        ? 'Wait for your turn'
                        : 'Already acted'
                showBattleTouchInfo(`${sk.name} — ${reason}: ${sk.desc}`)
                return
              }
              armSkill(state, i)
              uiDirty = true
              hudRev++
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSkillTile(ctx, rect, {
              name: sk.name,
              subtitle: !unlocked ? `Tier ${sk.tier}` : cd > 0 ? `${cd}t` : `R${sk.range}`,
              keycap: keycaps[i] ?? '2',
              hideKeycap: !vp.showKeycaps,
              vfx: sk.vfx,
              skillId: sk.id,
              tier: sk.tier,
              unlocked,
              cooldown: cd
            }, { ...st, disabled: skillDisabled })
          }
        }))
      }
      return [basicNode, ...tiers]
    }

    // 3. Tactic Card Hand
    const buildHandNodes = (cardH: number): LayoutNode[] => {
      const nodes: LayoutNode[] = []
      for (let i = 0; i < battle.hand.length; i++) {
        const uid = battle.hand[i]
        const owned = getTacticByUid(state.campaign, uid)
        const spec = owned ? TACTIC_BY_ID[owned.tacticId] : undefined
        if (!spec) continue
        const affordable = isPlayerTurn && battle.ap >= spec.cost
        const armed = battle.armedTacticUid === uid
        nodes.push(boxNode({
          id: `hand-${i}`,
          style: { grow: 1, height: cardH },
          widget: {
            type: 'button',
            label: spec.name,
            selected: armed,
            disabled: !affordable,
            onPress: () => {
              audio.unlock()
              lockedForecastCell = null
              armTacticCard(state, uid)
              if (isPhone) mobileHandOpen = false
              refreshBattleDiscoveryTips(false)
              uiDirty = true
              hudRev++
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTacticCard(ctx, rect, spec, st)
          }
        }))
      }
      if (nodes.length === 0) {
        nodes.push(boxNode({
          id: 'hand-empty',
          style: { grow: 1, height: cardH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEmptyNote(ctx, rect, 'Hand refills next hero turn')
          }
        }))
      }
      return nodes
    }

    // 4. Context Hint & End-Turn CT Bonus
    const ctBonus = active && isPlayerTurn
      ? (active.moved && active.acted ? 0 : (active.moved || active.acted) ? 20 : 40)
      : 0
    const facingPickerState = isPlayerTurn && battle.facingPicker && active && battle.facingPicker.unitUid === active.uid
      ? battle.facingPicker
      : null
    const facingPickerExposure = facingPickerState && active
      ? evaluateFacingExposure(battle, active.uid, facingPickerState.previewFacing)
      : null
    const facingPickerButtonMeta = facingPickerState && facingPickerExposure
      ? { facing: facingPickerState.previewFacing, exposureLevel: facingPickerExposure.level }
      : null

    const undoAvailable = canUndoMove(battle)
    const hoveredMoveOa = resolveHoveredMoveOa(activeForecast)
    let statusLine = undoAvailable
      ? uiCopy(
          vp.isTouchPrimary,
          'Moved — strike/cast, Z Undo Move, T Danger Zone, or F Wait-to-Face.',
          'Moved — tap a foe to strike, Undo, or Wait to pick facing.'
        )
      : gridCursor.active
        ? uiCopy(
            vp.isTouchPrimary,
            'Arrows/D-Pad: Cursor · Enter: Act · Tab: Cycle · 1-4: Skills · F: Wait/Face',
            'Tap blue tiles to move · Tap foes to strike · Tap Wait to face'
          )
        : uiCopy(
            vp.isTouchPrimary,
            'Click or Arrows/D-Pad: Cursor · Enter: Act · 1-4: Skills · Space: Wait/Face',
            'Tap blue tiles to move · Tap foes to strike · Tap Wait to save CT'
          )
    let statusAccent: string = COLOR.accent
    let statusImportant = undoAvailable
    if (isDeployPhase) {
      const selHero = inspected && inspected.team === 'ally' ? inspected : null
      statusLine = selHero
        ? uiCopy(
            vp.isTouchPrimary,
            `DEPLOY ${selHero.name}: click or Arrows+Enter blue tile · Tab cycle · F Rotate (${selHero.facing.toUpperCase()}) · Space Start`,
            `DEPLOY ${selHero.name}: tap a blue tile to move/swap · Tap Rotate (${selHero.facing.toUpperCase()}) · Tap Start`
          )
        : uiCopy(
            vp.isTouchPrimary,
            'DEPLOY SQUAD: click or Arrows+Enter hero/tile · Tab cycle · F Rotate · Space Start Battle',
            'DEPLOY SQUAD: tap a hero & blue tile to reposition · Tap Rotate or Start Battle'
          )
      statusAccent = '#5eeeff'
      statusImportant = true
    } else if (battle.autoBattle) {
      statusLine = uiCopy(
        vp.isTouchPrimary,
        `AUTO-BATTLE ACTIVE (${formatBattleSpeedLabel(battle.battleSpeed)}) — click board, skill, or press B / Esc to resume manual control.`,
        `AUTO-BATTLE ACTIVE (${formatBattleSpeedLabel(battle.battleSpeed)}) — tap board or Auto pill to resume control.`
      )
      statusAccent = COLOR.good
      statusImportant = true
    } else if (!isPlayerTurn && active) {
      statusLine = `${active.name}'s turn - resolving maneuver...`
      statusAccent = COLOR.enemy
      statusImportant = true
    } else if (pendingOaMoveCell) {
      const oaNames = Array.from(new Set(pendingOaMoveCell.preview.triggers.map(t => t.attackerName))).join(' & ')
      statusLine = `⚠ Opportunity Attack (-${pendingOaMoveCell.preview.totalDamage} HP from ${oaNames}) · Tap tile again to confirm`
      statusAccent = pendingOaMoveCell.preview.lethal ? COLOR.danger : '#ff8c2b'
      statusImportant = true
    } else if (battleTouchInfoText && battleTouchInfoTimer > 0) {
      statusLine = battleTouchInfoText
      statusAccent = COLOR.accentHi
      statusImportant = true
    } else if (facingPickerState && facingPickerExposure) {
      const dirTxt = facingPickerState.previewFacing.toUpperCase()
      const hintKeys = uiCopy(vp.isTouchPrimary, 'WASD/Arrows · Space confirm · Esc cancel', 'Tap arrow or Confirm')
      if (facingPickerExposure.level === 'back') {
        statusLine = `FACE ${dirTxt} — ${facingPickerExposure.warningText}! ${hintKeys}`
        statusAccent = COLOR.danger
      } else if (facingPickerExposure.level === 'flank') {
        statusLine = `FACE ${dirTxt} — ${facingPickerExposure.warningText}. ${hintKeys}`
        statusAccent = '#ffaa2b'
      } else {
        statusLine = `FACE ${dirTxt} — Front Secured! ${hintKeys}`
        statusAccent = COLOR.good
      }
      statusImportant = true
    } else if (hoveredMoveOa && hoveredMoveOa.triggers.length > 0 && !activeForecast) {
      const names = Array.from(new Set(hoveredMoveOa.triggers.map(t => t.attackerName))).join(' & ')
      statusLine = `${formatOpportunityWarning(hoveredMoveOa)} from ${names} — leaves Zone of Control!`
      statusAccent = hoveredMoveOa.lethal ? COLOR.danger : '#ff8c2b'
      statusImportant = true
    } else if (battle.armedTacticUid) {
      const owned = getTacticByUid(state.campaign, battle.armedTacticUid)
      const sp = owned ? TACTIC_BY_ID[owned.tacticId] : undefined
      if (sp) {
        statusLine = `${sp.name} (${sp.cost} AP): ${sp.desc}`
        statusAccent = RARITY_META[sp.rarity].hex
        statusImportant = true
      }
    } else if (active && battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0) {
      const sk = getHeroSkill(active, battle.armedSkillIndex)
      if (sk) {
        statusLine = `${sk.name}: ${sk.desc}`
        statusAccent = TIER_COLOR[sk.tier]
        statusImportant = true
      }
    } else if (inspected && inspected.uid !== active?.uid) {
      const threatSuffix = inspected.team === 'enemy' ? ` · MOV ${inspected.move} · RNG ${inspected.range}` : ''
      statusLine = `Inspecting ${inspected.name} - HP ${inspected.hp}/${inspected.maxHp}, ATK ${inspected.atk}, DEF ${inspected.def}, SPD ${effectiveSpeed(inspected)}${threatSuffix}`
      statusAccent = inspected.team === 'ally' ? COLOR.ally : COLOR.enemy
      statusImportant = true
    }

    const activePortrait = battleUnitPortrait(inspected ?? undefined)
    const roleLabel = inspected
      ? (inspected.heroId
          ? getEffectiveHeroTitle(inspected.heroId, inspected.stars, inspected.subSpecId)
          : inspected.isBoss
            ? ((inspected.bossPhase ?? 1) >= 2 ? 'Boss · Phase II' : 'Boss')
            : 'Foe')
      : ''
    const inspectedOwned = inspected?.team === 'ally' ? getHeroByUid(state.campaign, inspected.uid) : undefined
    const inspectedXpProgress = inspectedOwned ? heroLevelProgress(inspectedOwned.level, inspectedOwned.xp) : undefined
    const inspectedBondAssist = inspected ? computeUnitBondAssist(battle, inspected) : undefined
    const fpsShort = `${Math.round(perf.snapshot().fps || 60)}`
    const chapterShort = battle.activeWorldEventTitle
      ? battle.activeWorldEventTitle
      : battle.endlessWave > 0
        ? (isPhone
            ? `W${battle.endlessWave} · ${formatEndlessBiomeLabel(battle.biome)}`
            : `Endless Wave ${battle.endlessWave} · ${formatEndlessBiomeLabel(battle.biome)}`)
        : battle.abyssFloor
          ? `${ch.title} · ${formatAbyssFloorLabel(battle.abyssFloor)}`
          : battle.gauntletMaxRounds
            ? `${ch.title} · R${battle.gauntletRound ?? 1}/${battle.gauntletMaxRounds}`
            : `${ch.title} · D${battle.difficulty}`

    // Top-right toolbar (compact on phone & narrow tablets so top-left bar never collides; H1: tools stay directly accessible)
    const tbIconS = isPhone ? 34 : 30
    const tinyPhone = mobilePortrait && w <= 395
    const compactDesktopTb = !isPhone && narrow
    const camYawActual = scene.getCameraYawActual()
    const camHeading = cameraCardinalHeading(camYawActual)
    const showUndoBtn = isPhone ? undoAvailable : (isPlayerTurn && Boolean(active && active.team === 'ally'))
    const isFastSpeed = battle.battleSpeed === 2
    const speedLabel = formatBattleSpeedLabel(battle.battleSpeed)
    const autoAvailable = battle.phase === 'player' || battle.phase === 'enemy'
    const autoOn = battle.autoBattle
    const toolbarItems: LayoutNode[] = [
      ...(showUndoBtn ? [
        boxNode({
          id: 'cs-undo-move', style: { width: tinyPhone ? 34 : isPhone ? 46 : compactDesktopTb ? 56 : 74, height: tbIconS },
          widget: {
            type: 'button',
            label: uiCopy(vp.isTouchPrimary, 'Undo Move (Z / Backspace)', 'Undo Move'),
            disabled: !undoAvailable,
            onPress: () => { performUndoMove() },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'retreat', st, {
              active: undoAvailable,
              label: tinyPhone ? undefined : !vp.showKeycaps || isPhone || compactDesktopTb ? 'Undo' : 'Undo Z',
              color: undoAvailable ? COLOR.accentText : undefined
            })
          }
        })
      ] : []),
      ...(advToolsUnlocked ? [
        boxNode({
          id: 'cs-speed-toggle', style: { width: tinyPhone ? 34 : isPhone ? 42 : compactDesktopTb ? 44 : 56, height: tbIconS },
          widget: {
            type: 'button',
            label: uiCopy(vp.isTouchPrimary, `Battle Speed ${speedLabel} (X)`, `Battle Speed ${speedLabel}`),
            selected: isFastSpeed,
            onPress: () => { handleToggleBattleSpeed() },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'fast-forward', st, {
              active: isFastSpeed,
              label: tinyPhone ? undefined : !vp.showKeycaps || isPhone || compactDesktopTb ? speedLabel : `${speedLabel} X`,
              color: isFastSpeed ? COLOR.accentText : '#d7e6ff'
            })
          }
        }),
        boxNode({
          id: 'cs-auto-battle', style: { width: tinyPhone ? 34 : isPhone ? 54 : compactDesktopTb ? 58 : 72, height: tbIconS },
          widget: {
            type: 'button',
            label: uiCopy(vp.isTouchPrimary, autoOn ? 'Stop Auto-Battle (B / Esc)' : 'Auto-Battle (B)', autoOn ? 'Stop Auto-Battle' : 'Auto-Battle'),
            selected: autoOn,
            disabled: !autoAvailable,
            onPress: () => { handleToggleAutoBattle() },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'auto', st, {
              active: autoOn,
              label: tinyPhone ? undefined : !vp.showKeycaps || isPhone || compactDesktopTb ? (autoOn ? 'ON' : 'Auto') : (autoOn ? 'Auto ON' : 'Auto B'),
              color: autoOn ? COLOR.accentText : '#9ef7d4'
            })
          }
        }),
        boxNode({
          id: 'cs-danger-zone', style: { width: tinyPhone ? 34 : isPhone ? 34 : compactDesktopTb ? 44 : 64, height: tbIconS },
          widget: {
            type: 'button',
            label: uiCopy(vp.isTouchPrimary, dangerZoneOn ? 'Hide Danger Zone (T)' : 'Show Danger Zone (T)', dangerZoneOn ? 'Hide Danger Zone' : 'Show Danger Zone'),
            selected: dangerZoneOn,
            onPress: toggleDangerZone,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'skull', st, {
              active: dangerZoneOn,
              label: !vp.showKeycaps || isPhone ? undefined : compactDesktopTb ? 'T' : 'Zone T',
              color: dangerZoneOn ? COLOR.dangerLip : '#ff9ca6'
            })
          }
        })
      ] : []),
      ...(isPhone ? [] : [
        ...(compactDesktopTb ? [] : [
          boxNode({
            id: 'tb-cam-up', style: { width: tbIconS, height: tbIconS },
            widget: {
              type: 'button', label: uiCopy(vp.isTouchPrimary, 'Tilt Camera Up (ArrowUp)', 'Tilt Camera Up'),
              onPress: () => { scene.tiltCamera(0.16); hudRev++ },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'chevron-up', st)
            }
          }),
          boxNode({
            id: 'tb-cam-dn', style: { width: tbIconS, height: tbIconS },
            widget: {
              type: 'button', label: uiCopy(vp.isTouchPrimary, 'Tilt Camera Down (ArrowDown)', 'Tilt Camera Down'),
              onPress: () => { scene.tiltCamera(-0.16); hudRev++ },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'chevron-down', st)
            }
          })
        ]),
        boxNode({
          id: 'tb-cam-l', style: { width: !vp.showKeycaps || compactDesktopTb ? tbIconS : 42, height: tbIconS },
          widget: {
            type: 'button', label: uiCopy(vp.isTouchPrimary, 'Rotate Camera Left 90° (Q)', 'Rotate Camera Left 90°'),
            onPress: () => { scene.snapCameraYaw(-1); uiDirty = true; hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-left', st, {
              label: !vp.showKeycaps || compactDesktopTb ? undefined : 'Q'
            })
          }
        }),
        boxNode({
          id: 'tb-cam-compass', style: { width: 32, height: tbIconS },
          widget: {
            type: 'button', label: uiCopy(vp.isTouchPrimary, `Camera Facing ${camHeading} — Reset North (0)`, `Camera Facing ${camHeading} — Reset North`),
            onPress: () => { scene.setCameraYaw(0); uiDirty = true; hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawCameraCompassButton(ctx, rect, camYawActual, camHeading, st)
          }
        }),
        boxNode({
          id: 'tb-cam-r', style: { width: !vp.showKeycaps || compactDesktopTb ? tbIconS : 42, height: tbIconS },
          widget: {
            type: 'button', label: uiCopy(vp.isTouchPrimary, 'Rotate Camera Right 90° (E)', 'Rotate Camera Right 90°'),
            onPress: () => { scene.snapCameraYaw(1); uiDirty = true; hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-right', st, {
              label: !vp.showKeycaps || compactDesktopTb ? undefined : 'E'
            })
          }
        }),
        ...(compactDesktopTb ? [] : [
          boxNode({
            id: 'cs-perf', style: { width: 52, height: tbIconS },
            widget: {
              type: 'button', label: `${fpsShort} FPS`, selected: showPerfPanel, onPress: togglePerfOverlay,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'gauge', st, {
                active: showPerfPanel,
                label: fpsShort,
                color: showPerfPanel ? COLOR.good : undefined
              })
            }
          })
        ])
      ]),
      boxNode({
        id: 'cs-focus-mode', style: { width: tbIconS, height: tbIconS },
        widget: {
          type: 'button',
          label: uiCopy(vp.isTouchPrimary, 'Focus Mode (H)', 'Focus Mode'),
          onPress: () => {
            audio.unlock()
            focusMode = true
            state.sounds.push({ kind: 'card', pitch: 1.12 })
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'target', st)
        }
      }),
      boxNode({
        id: 'cs-music', style: { width: tbIconS, height: tbIconS },
        widget: {
          type: 'button', label: audio.isMusicEnabled() ? 'Music On' : 'Music Off', onPress: toggleMusic,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'music', st, {
            active: audio.isMusicEnabled()
          })
        }
      }),
      boxNode({
        id: 'cs-pause', style: { width: tbIconS, height: tbIconS },
        widget: {
          type: 'button', label: 'Pause', onPress: togglePauseScreen,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'pause', st)
        }
      })
    ]
    const tbGap = isPhone ? 4 : 6
    const tbPadX = isPhone ? 5 : 7
    const toolbarW = toolbarItems.reduce((sum, n) => sum + (typeof n.style?.width === 'number' ? n.style.width : tbIconS), 0)
      + Math.max(0, toolbarItems.length - 1) * tbGap
      + tbPadX * 2
    const topBarH = 42

    // Mobile Tactic Hand Toggle Button (keeps battlefield spacious on phones!)
    const handCount = battle.hand.length
    const hasAffordableCard = isPlayerTurn && battle.hand.some(uid => {
      const owned = getTacticByUid(state.campaign, uid)
      const sp = owned ? TACTIC_BY_ID[owned.tacticId] : undefined
      return Boolean(sp && battle.ap >= sp.cost)
    })
    const buildCardsToggle = (btnW: number, btnH: number): LayoutNode => boxNode({
      id: 'cs-toggle-hand',
      style: { width: btnW, height: btnH },
      widget: {
        type: 'button',
        label: mobileHandOpen ? 'Hide Cards' : `Cards (${handCount})`,
        selected: mobileHandOpen || Boolean(battle.armedTacticUid),
        onPress: () => {
          audio.unlock()
          mobileHandOpen = !mobileHandOpen
          if (mobileHandOpen) lockedForecastCell = null
          uiDirty = true
          hudRev++
        },
        draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
          ctx,
          rect,
          mobileHandOpen ? 'Hide' : mobilePortrait ? `${handCount}` : `Cards ${handCount}`,
          st,
          {
            variant: mobileHandOpen || Boolean(battle.armedTacticUid) ? 'primary' : hasAffordableCard ? 'success' : 'secondary',
            icon: mobileHandOpen ? undefined : 'cards',
            size: mobilePortrait ? 13 : 12
          }
        )
      }
    })

    // Bottom Dock (Pre-Battle Deployment Bar OR Active Combat Dock)
    let dockNode: LayoutNode
    let dockH: number

    if (isDeployPhase) {
      const deployAllies = battle.units.filter(u => u.alive && u.team === 'ally')
      const chipH = isPhone ? 46 : 54
      const deployChips: LayoutNode[] = deployAllies.map((ally, idx) => boxNode({
        id: `deploy-hero-${idx}`,
        style: { grow: 1, height: chipH },
        widget: {
          type: 'button',
          label: ally.name,
          selected: battle.selectedUnitUid === ally.uid,
          onPress: () => {
            audio.unlock()
            battle.selectedUnitUid = ally.uid
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawDeployHeroChip(ctx, rect, {
            name: ally.name,
            facing: ally.facing,
            portrait: battleUnitPortrait(ally),
            selected: battle.selectedUnitUid === ally.uid,
            compact: isPhone
          }, st)
        }
      }))

      const rotateBtn = boxNode({
        id: 'cs-deploy-rotate',
        style: { width: mobilePortrait ? 92 : isPhone ? 96 : 124, height: chipH },
        widget: {
          type: 'button',
          label: uiCopy(vp.isTouchPrimary, 'Rotate Facing (F)', 'Rotate Facing'),
          onPress: () => { rotateSelectedDeployUnit() },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, uiCopy(vp.isTouchPrimary, isPhone ? 'Rotate' : 'Rotate (F)', 'Rotate'), st, { variant: 'secondary', icon: 'rotate-right', size: isPhone ? 12 : 13 }
          )
        }
      })

      const startBtn = boxNode({
        id: 'cs-start-battle',
        style: { width: mobilePortrait ? 132 : isPhone ? 132 : 176, height: chipH },
        widget: {
          type: 'button',
          label: 'Start Battle',
          primary: true,
          onPress: () => { confirmDeployAndStart() },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, isPhone ? 'Start Battle' : 'Start Battle', st, { variant: 'primary', icon: 'sword', size: isPhone ? 13 : 14 }
          )
        }
      })

      if (mobilePortrait) {
        dockH = chipH * 2 + 22
        dockNode = column({
          id: 'battle-dock',
          style: { anchor: 'bottom', width: w - 12, height: dockH, inset: 6, padding: 7, gap: 6, respectSafeArea: true },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.lg, lipH: 4 })
          }
        }, [
          row({ id: 'deploy-heroes-row', style: { height: chipH, gap: 6 } }, deployChips),
          row({ id: 'deploy-actions-row', style: { height: chipH, gap: 6 } }, [
            rotateBtn,
            boxNode({
              id: 'cs-start-battle',
              style: { grow: 1, height: chipH },
              widget: {
                type: 'button',
                label: 'Start Battle',
                primary: true,
                onPress: () => { confirmDeployAndStart() },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, 'Start Battle', st, { variant: 'primary', icon: 'sword', size: 13 }
                )
              }
            })
          ])
        ])
      } else {
        dockH = chipH + 18
        const safeHoriz = vp.safeArea.left + vp.safeArea.right
        const dockW = Math.min(w - Math.max(20, safeHoriz + 12), 960)
        dockNode = row({
          id: 'battle-dock',
          style: { anchor: 'bottom', width: dockW, height: dockH, inset: isPhone ? 6 : 10, padding: 8, gap: 8, align: 'center', respectSafeArea: true },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.xl, lipH: 5 })
          }
        }, [
          ...deployChips,
          rotateBtn,
          startBtn
        ])
      }
    } else if (mobilePortrait) {
      const topRowH = 54
      const skillRowH = 52
      dockH = topRowH + skillRowH + 20
      const skillTiles = buildSkillTiles(skillRowH)
      const skillRowContent: LayoutNode[] = skillTiles.length > 0
        ? skillTiles
        : [boxNode({
            id: 'sk-enemy-wait',
            style: { grow: 1, height: skillRowH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEmptyNote(ctx, rect, 'Enemy acting...', COLOR.enemy)
            }
          })]

      dockNode = column({
        id: 'battle-dock',
        style: { anchor: 'bottom', width: w - 12, height: dockH, inset: 6, padding: 7, gap: 6, respectSafeArea: true },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.lg, lipH: 4 })
        }
      }, [
        row({ id: 'dock-m-top', style: { height: topRowH, gap: 6 } }, [
          boxNode({
            id: 'dock-hero-plate', style: { grow: 1, height: topRowH },
            widget: {
              type: 'button',
              label: inspected ? `${inspected.name} Info` : 'Unit Info',
              onPress: () => {
                if (!inspected) return
                const stList: string[] = []
                if (inspected.shield > 0) stList.push(`Shield ${inspected.shield}`)
                if (inspected.tauntTurns > 0) stList.push(`Taunt ${inspected.tauntTurns}t`)
                if (inspected.hasteTurns > 0) stList.push(`Haste ${inspected.hasteTurns}t`)
                if (inspected.empowerTurns > 0) stList.push(`Empower ${inspected.empowerTurns}t`)
                if (inspected.burnTurns > 0) stList.push(`Burn ${inspected.burnTurns}t`)
                if (inspected.slowTurns > 0) stList.push(`Slow ${inspected.slowTurns}t`)
                if (inspected.stunTurns > 0) stList.push(`Stun ${inspected.stunTurns}t`)
                if (inspected.poisonStacks > 0) stList.push(`Poison x${inspected.poisonStacks}`)
                const passiveInfo = inspected.heroId ? getHeroPassive(inspected.heroId) : null
                const statusPart = stList.length > 0 ? ` · ${stList.join(', ')}` : ''
                const passivePart = passiveInfo ? ` · ${passiveInfo.name}` : ''
                showBattleTouchInfo(`${inspected.name}: HP ${inspected.hp}/${inspected.maxHp} · ATK ${inspected.atk} · DEF ${inspected.def} · SPD ${effectiveSpeed(inspected)}${statusPart}${passivePart}`)
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawUnitCard(
                ctx, rect, inspected, activePortrait, inspected ? effectiveSpeed(inspected) : 0, roleLabel, inspectedXpProgress, inspectedBondAssist
              )
            }
          }),
          boxNode({
            id: 'cs-end-turn', style: { width: 84, height: topRowH },
            widget: {
              type: 'button',
              label: !isPlayerTurn ? 'Enemy' : facingPickerButtonMeta ? `Confirm Face ${facingPickerButtonMeta.facing.toUpperCase()}` : ctBonus > 0 ? `Wait (+${ctBonus} CT)` : 'End Turn',
              primary: isPlayerTurn,
              disabled: !isPlayerTurn,
              onPress: endBattleTurn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEndTurnButton(ctx, rect, { isPlayerTurn, ctBonus, facingPicker: facingPickerButtonMeta, hideKeycap: !vp.showKeycaps, isTouch: vp.isTouchPrimary }, st)
            }
          })
        ]),
        row({ id: 'dock-m-skills', style: { height: skillRowH, gap: 5 } }, [
          boxNode({
            id: 'dock-ap', style: { width: 36, height: skillRowH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawApMeter(ctx, rect, battle.ap, battle.maxAp)
            }
          }),
          ...skillRowContent,
          buildCardsToggle(58, skillRowH)
        ])
      ])
    } else if (mobileLandscape) {
      dockH = 76
      const innerH = 62
      const skillTiles = buildSkillTiles(innerH)
      const skillRowContent: LayoutNode[] = skillTiles.length > 0
        ? skillTiles
        : [boxNode({
            id: 'sk-enemy-wait',
            style: { grow: 1, height: innerH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEmptyNote(ctx, rect, 'Enemy acting...', COLOR.enemy)
            }
          })]

      const safeHoriz = vp.safeArea.left + vp.safeArea.right
      dockNode = row({
        id: 'battle-dock',
        style: { anchor: 'bottom', width: Math.min(w - Math.max(14, safeHoriz + 12), 820), height: dockH, inset: 6, padding: 7, gap: 6, align: 'center', respectSafeArea: true },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.lg, lipH: 4 })
        }
      }, [
        boxNode({
          id: 'dock-hero-plate', style: { width: 174, height: innerH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawUnitCard(
              ctx, rect, inspected, activePortrait, inspected ? effectiveSpeed(inspected) : 0, roleLabel, inspectedXpProgress, inspectedBondAssist
            )
          }
        }),
        boxNode({
          id: 'dock-ap', style: { width: 38, height: innerH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawApMeter(ctx, rect, battle.ap, battle.maxAp)
          }
        }),
        row({ id: 'dock-ml-skills', style: { grow: 1, height: innerH, gap: 5 } }, skillRowContent),
        buildCardsToggle(88, innerH),
        boxNode({
          id: 'cs-end-turn', style: { width: 88, height: innerH },
          widget: {
            type: 'button',
            label: !isPlayerTurn ? 'Enemy' : facingPickerButtonMeta ? `Confirm Face ${facingPickerButtonMeta.facing.toUpperCase()}` : ctBonus > 0 ? `Wait (+${ctBonus} CT)` : 'End Turn',
            primary: isPlayerTurn,
            disabled: !isPlayerTurn,
            onPress: endBattleTurn,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEndTurnButton(ctx, rect, { isPlayerTurn, ctBonus, facingPicker: facingPickerButtonMeta, hideKeycap: !vp.showKeycaps, isTouch: vp.isTouchPrimary }, st)
          }
        })
      ])
    } else {
      dockH = h < 580 ? 136 : 150
      const innerH = dockH - 16
      const skillRowH = Math.floor((innerH - 6) * 0.5)
      const skillW = narrow ? 196 : 236
      const skillTiles = buildSkillTiles(skillRowH)
      const skillBlock: LayoutNode = skillTiles.length === 4
        ? column({ id: 'dock-skills', style: { width: skillW, height: innerH, gap: 6 } }, [
            row({ id: 'dock-sk-r1', style: { height: skillRowH, gap: 6 } }, [skillTiles[0], skillTiles[1]]),
            row({ id: 'dock-sk-r2', style: { height: skillRowH, gap: 6 } }, [skillTiles[2], skillTiles[3]])
          ])
        : boxNode({
            id: 'sk-enemy-wait',
            style: { width: skillW, height: innerH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEmptyNote(
                ctx,
                rect,
                inspected ? `${inspected.name} is moving...` : 'Enemy Vanguard is moving...',
                COLOR.enemy
              )
            }
          })

      const dockW = Math.min(w - 20, 1180)
      dockNode = row({
        id: 'battle-dock',
        style: { anchor: 'bottom', width: dockW, height: dockH, inset: 10, padding: 8, gap: 8, align: 'center', respectSafeArea: true },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.xl, lipH: 5 })
        }
      }, [
        boxNode({
          id: 'dock-hero-plate',
          style: { width: narrow ? 174 : 212, height: innerH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawUnitCard(
              ctx, rect, inspected, activePortrait, inspected ? effectiveSpeed(inspected) : 0, roleLabel, inspectedXpProgress, inspectedBondAssist
            )
          }
        }),
        boxNode({
          id: 'dock-ap',
          style: { width: narrow ? 42 : 48, height: innerH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawApMeter(ctx, rect, battle.ap, battle.maxAp)
          }
        }),
        skillBlock,
        row({ id: 'dock-hand', style: { grow: 1, height: innerH, gap: 8 } }, buildHandNodes(innerH)),
        boxNode({
          id: 'cs-end-turn',
          style: { width: narrow ? 96 : 112, height: innerH },
          widget: {
            type: 'button',
            label: !isPlayerTurn ? 'Enemy...' : facingPickerButtonMeta ? `Confirm Face ${facingPickerButtonMeta.facing.toUpperCase()}` : ctBonus > 0 ? `Wait (+${ctBonus} CT)` : 'End Turn',
            primary: isPlayerTurn,
            disabled: !isPlayerTurn,
            onPress: endBattleTurn,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEndTurnButton(ctx, rect, { isPlayerTurn, ctBonus, facingPicker: facingPickerButtonMeta, hideKeycap: !vp.showKeycaps, isTouch: vp.isTouchPrimary }, st)
          }
        })
      ])
    }

    // Floating Tactic Hand Drawer on Phones (shows full-size readable cards!)
    const phoneHandNodes: LayoutNode[] = []
    if (isPhone && mobileHandOpen) {
      const cardH = mobileLandscape ? 122 : 128
      const cards = buildHandNodes(cardH)
      const drawerW = mobilePortrait ? w - 12 : Math.min(w - 24, 560)
      const useTwoRows = mobilePortrait && cards.length >= 3
      const cardRows: LayoutNode[] = useTwoRows
        ? [
            row({ id: 'hand-r1', style: { height: cardH, gap: 8 } }, cards.slice(0, 2)),
            row({ id: 'hand-r2', style: { height: cardH, gap: 8 } }, cards.slice(2))
          ]
        : [row({ id: 'dock-hand', style: { height: cardH, gap: 8 } }, cards)]
      phoneHandNodes.push(
        column({
          id: 'mobile-hand-drawer',
          style: {
            anchor: 'bottom',
            width: drawerW,
            inset: [6, dockH + 12],
            padding: [10, 10],
            gap: 8,
            respectSafeArea: true
          },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSheet(ctx, rect)
          }
        }, [
          row({ id: 'mh-head', style: { height: 24, gap: 8, align: 'center' } }, [
            boxNode({
              id: 'mh-title', style: { grow: 1, height: 24 },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                  ctx, rect, `TACTIC HAND  -  ${battle.ap}/${battle.maxAp} AP`, { size: 11, weight: 900, color: COLOR.accentHi, display: true }
                )
              }
            }),
            boxNode({
              id: 'cs-close-hand', style: { width: 64, height: 24 },
              widget: {
                type: 'button',
                label: 'Close',
                onPress: () => { mobileHandOpen = false; uiDirty = true; hudRev++ },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Close', st, { variant: 'secondary', size: 11 })
              }
            })
          ]),
          ...cardRows
        ])
      )
    }

    // Floating Pre-Attack Combat Forecast Card ("X -> Y", dmg/crit/KO + Strike vs Skill comparison!)
    const forecastNodes: LayoutNode[] = []
    if (activeForecast && !mobileHandOpen) {
      const fc = activeForecast
      const isLocked = lockedForecastCell !== null
      const fcCompact = isPhone
      const fcW = mobilePortrait ? w - 12 : mobileLandscape ? 316 : 332
      const attUnit = fc.attackerUid ? getUnitByUid(battle, fc.attackerUid) : undefined
      const tgtUnit = fc.targetUid ? battle.units.find(u => u.uid === fc.targetUid) : undefined
      const attPortrait = attUnit
        ? battleUnitPortrait(attUnit)
        : (fc.attackerHeroId ? portraits[fc.attackerHeroId] : undefined)
      const tgtPortrait = fc.targetTeam === 'none'
        ? undefined
        : tgtUnit
          ? battleUnitPortrait(tgtUnit)
          : portraits[fc.targetHeroId ?? fc.targetEnemyId ?? 'goblin']
      const hasCounterStrip = !fc.emptyTileTarget && fc.isOffensive && (
        Boolean(fc.canCounter && (fc.counterDmg ?? 0) > 0) ||
        fc.counterAvoidReason === 'flank' ||
        fc.counterAvoidReason === 'backstab'
      )
      const mainH = (fcCompact ? 96 : 104) + (hasCounterStrip ? 22 : 0)

      const altRows: LayoutNode[] = []
      if (fc.alternatives.length > 1) {
        for (let i = 0; i < fc.alternatives.length; i += 2) {
          const slice = fc.alternatives.slice(i, i + 2)
          const rowItems: LayoutNode[] = slice.map((alt, j) => boxNode({
            id: `fc-alt-${i + j}`,
            style: { grow: 1, height: 28 },
            widget: {
              type: 'button',
              label: `${alt.name} ${alt.normalDmg}`,
              selected: alt.active,
              onPress: () => {
                audio.unlock()
                // Keep target locked so clicking a comparison chip switches live between Strike & Skill!
                lockedForecastCell = { col: fc.targetCol, row: fc.targetRow }
                armSkill(state, alt.skillIndex)
                uiDirty = true
                hudRev++
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawForecastAltChip(ctx, rect, alt, st, { hideKeycap: !vp.showKeycaps })
            }
          }))
          if (rowItems.length === 1) rowItems.push(spacerNode(1))
          altRows.push(row({ id: `fc-alt-row-${i}`, style: { height: 28, gap: 6 } }, rowItems))
        }
      }

      const isHelpful = fc.isRevive || (!fc.isOffensive && fc.targetTeam === 'ally')
      const confirmLabel = fc.friendlyFire
        ? 'Friendly Fire!'
        : fc.isRevive
          ? (fc.mode === 'tactic' ? 'Revive Hero!' : fc.requiresMove ? 'Move & Revive!' : 'Revive Hero!')
          : fc.emptyTileTarget
            ? 'Cast on Space'
            : isHelpful
              ? (fc.mode === 'tactic' ? 'Use Card' : 'Cast')
              : fc.requiresMove
                ? (fc.mode === 'skill' ? 'Move & Cast!' : 'Move & Strike!')
                : (fc.mode === 'skill' ? 'Cast Skill!' : fc.mode === 'tactic' ? 'Cast Card!' : 'Strike!')

      const fcChildren: LayoutNode[] = [
        boxNode({
          id: 'fc-main',
          style: { height: mainH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawCombatForecast(ctx, rect, fc, {
              attackerPortrait: attPortrait,
              targetPortrait: tgtPortrait,
              compact: fcCompact,
              locked: isLocked,
              isTouch: vp.isTouchPrimary
            })
          }
        }),
        ...altRows
      ]

      if (isLocked) {
        fcChildren.push(
          row({ id: 'fc-confirm-row', style: { height: 34, gap: 6 } }, [
            boxNode({
              id: 'cs-cancel-attack', style: { width: 82, height: 34 },
              widget: {
                type: 'button',
                label: 'Cancel',
                onPress: () => {
                  lockedForecastCell = null
                  uiDirty = true
                  hudRev++
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Cancel', st, { variant: 'secondary', size: 12 })
              }
            }),
            boxNode({
              id: 'cs-confirm-attack', style: { grow: 1, height: 34 },
              widget: {
                type: 'button',
                label: confirmLabel,
                primary: true,
                onPress: () => {
                  audio.unlock()
                  confirmLockedForecast()
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx,
                  rect,
                  confirmLabel,
                  st,
                  {
                    variant: fc.friendlyFire ? 'danger' : isHelpful ? 'success' : fc.lethalNormal ? 'danger' : 'primary',
                    icon: isHelpful ? 'heart' : fc.emptyTileTarget ? 'target' : 'sword',
                    size: 13
                  }
                )
              }
            })
          ])
        )
      }

      forecastNodes.push(
        column({
          id: 'combat-forecast',
          style: mobilePortrait
            ? { anchor: 'bottom', width: fcW, inset: [6, dockH + 12], padding: 6, gap: 6, respectSafeArea: true }
            : { anchor: 'top-right', width: fcW, inset: [8, topBarH + 14], padding: 6, gap: 6, respectSafeArea: true },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.lg, lipH: 4, fill: '#1f2b4a', fillBot: '#141c33' })
          }
        }, fcChildren)
      )
    }

    const topLeftW = mobilePortrait
      ? Math.max(82, w - toolbarW - 26)
      : mobileLandscape
        ? 200
        : Math.min(264, Math.max(176, w - toolbarW - 36))
    const phonePillW = Math.min(w - 16, mobilePortrait ? 186 : 172)
    const phonePillH = 34
    const usePhoneTurnPill = isPhone
    const singleTopRow = usePhoneTurnPill
      ? (mobileLandscape && topLeftW + phonePillW + toolbarW + 32 <= w)
      : (!mobilePortrait && topLeftW + timelineW + toolbarW + 48 <= w)
    const phonePillInset: [number, number] = singleTopRow
      ? [6, 8]
      : [6, topBarH + 10]
    const timelineInset: [number, number] = usePhoneTurnPill
      ? [6, phonePillInset[1] + phonePillH + 4]
      : singleTopRow
        ? [6, 8]
        : [8, topBarH + 12]
    const showFullTimeline = !usePhoneTurnPill || turnTimelineExpanded
    const showHintPill = !activeForecast && !mobileHandOpen && !inspectedTileCell && (!isPhone || statusImportant)

    const objText = getObjectiveProgressText(battle)
    const objUrgent = Boolean(
      battle.objective.protectBreached ||
      (battle.objective.turnLimit !== undefined && battle.objective.turnLimit - battle.objective.roundsElapsed <= 2)
    )
    const edgeX = isPhone ? 6 : 8
    const objBadgeH = isPhone ? 26 : 30
    const objBadgeW = mobilePortrait ? Math.min(w - 24, 240) : mobileLandscape ? 208 : 264
    const hasChallengeBadge = battle.difficultyTier !== 'normal' || battle.mutators.length > 0
    const challengeBadgeH = isPhone ? 24 : 27
    const activeEndlessBlessings = battle.endlessWave > 0 ? (battle.endlessBlessings ?? []) : []
    const hasEndlessBlessingsHud = activeEndlessBlessings.length > 0
    const endlessBlessingsH = isPhone ? 24 : 27
    const stageMechanicHud = getAct1StageMechanicStatus(battle)
    const stageMechanicH = isPhone ? 24 : 26
    const bossTelegraphHud = formatBossTelegraphHudSummary(battle.bossTelegraphs, isPhone)
    const bossTelegraphH = isPhone ? 26 : 30
    const bossTelegraphW = mobilePortrait
      ? Math.min(w - 16, 268)
      : mobileLandscape
        ? Math.min(w - 24, 248)
        : Math.min(w - 24, 336)
    const autoPillH = isPhone ? 24 : 26

    // Single unified top-left vertical stack cursor so Objective, Boss Telegraphs, Stage Mechanic, Challenge,
    // Blessings, Auto-Battle, Combat Log, and Discovery Tips NEVER overlap each other or the turn timeline!
    let leftStackY = usePhoneTurnPill
      ? (showFullTimeline
          ? timelineInset[1] + tokenH + 16
          : singleTopRow
            ? edgeX + topBarH + 6
            : phonePillInset[1] + phonePillH + 6)
      : singleTopRow
        ? edgeX + topBarH + 6
        : timelineInset[1] + tokenH + 20
    const objBadgeY = leftStackY
    leftStackY += objBadgeH + 6
    const bossTelegraphY = leftStackY
    if (bossTelegraphHud) leftStackY += bossTelegraphH + 6
    const stageMechanicY = leftStackY
    if (stageMechanicHud) leftStackY += stageMechanicH + 6
    const challengeBadgeY = leftStackY
    if (hasChallengeBadge) leftStackY += challengeBadgeH + 6
    const endlessBlessingsY = leftStackY
    if (hasEndlessBlessingsHud) leftStackY += endlessBlessingsH + 6
    const autoPillY = leftStackY
    if (battle.autoBattle) leftStackY += autoPillH + 6

    // Collapsible Combat Log toggle + translucent drawer (starts collapsed; hidden on Battle 1 via advToolsUnlocked)
    const combatLogEntries = battle.combatLog
    const latestLogId = combatLogEntries.length > 0 ? combatLogEntries[combatLogEntries.length - 1].id : 0
    if (combatLogOpen) {
      combatLogSeenId = latestLogId
    }
    const combatLogUnread = combatLogOpen
      ? 0
      : combatLogEntries.reduce((cnt, e) => (e.id > combatLogSeenId ? cnt + 1 : cnt), 0)
    const logEdgeX = edgeX
    const logToggleH = isPhone ? 30 : 28
    const logToggleW = advToolsUnlocked ? (isPhone ? 90 : 112) : 0
    const logToggleY = leftStackY
    const weatherPillX = advToolsUnlocked ? (logEdgeX + logToggleW + 6) : logEdgeX
    const weatherPillW = isPhone
      ? Math.min(126, Math.max(84, w - weatherPillX - 16))
      : Math.min(238, Math.max(122, w - weatherPillX - 352))
    const showWeatherDetail = weatherInspectorOpen && !combatLogOpen && !mobileHandOpen
    leftStackY += logToggleH + 6
    const weatherDetailY = leftStackY
    const weatherDetailH = isPhone ? 90 : 94
    const weatherDetailW = isPhone
      ? Math.min(w - 20, 268)
      : Math.min(w - 24, 304)
    if (showWeatherDetail) {
      leftStackY += weatherDetailH + 6
    }

    const combatLogPanelNodes: LayoutNode[] = []
    if (advToolsUnlocked && combatLogOpen && !mobileHandOpen) {
      const logPanelW = mobilePortrait
        ? Math.min(w - 16, 336)
        : mobileLandscape
          ? Math.min(w - 24, 320)
          : narrow
            ? Math.min(308, w - 24)
            : 344
      const logPanelY = leftStackY
      const bottomClearance = dockH + (isPhone ? 46 : 52)
      const maxPanelH = Math.max(mobileLandscape ? 76 : 114, h - bottomClearance - logPanelY)
      const logPanelH = Math.min(mobileLandscape ? 168 : isPhone ? 206 : 232, maxPanelH)
      leftStackY = logPanelY + logPanelH + 6
      const logHeaderH = isPhone ? 38 : 28
      const logRowH = isPhone ? 20 : 22
      const logVisibleRows = Math.max(mobileLandscape && logPanelH < 100 ? 2 : 3, Math.floor((logPanelH - logHeaderH - 14) / logRowH))
      const logMaxScroll = getMaxCombatLogScroll(combatLogEntries.length, logVisibleRows)
      if (combatLogScroll > logMaxScroll) combatLogScroll = logMaxScroll
      const logBtnS = isPhone ? 34 : 22

      combatLogPanelNodes.push(
        column({
          id: 'combat-log-panel',
          style: {
            anchor: 'top-left',
            width: logPanelW,
            height: logPanelH,
            inset: [logEdgeX, logPanelY],
            padding: [3, isPhone ? 6 : 8],
            gap: 0,
            respectSafeArea: true
          },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawCombatLogPanel(ctx, rect, combatLogEntries, {
              scrollOffset: combatLogScroll,
              visibleRows: logVisibleRows,
              compact: isPhone,
              headerControlsWidth: logBtnS * 3 + 12
            })
          }
        }, [
          row({ id: 'combat-log-header-bar', style: { height: logHeaderH - 4, gap: 4, align: 'center' } }, [
            spacerNode(1),
            boxNode({
              id: 'cs-log-up',
              style: { width: logBtnS, height: logBtnS },
              widget: {
                type: 'button',
                label: 'Scroll Combat Log Up',
                disabled: combatLogScroll >= logMaxScroll,
                onPress: () => scrollCombatLog(2, logVisibleRows),
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'chevron-up', st)
              }
            }),
            boxNode({
              id: 'cs-log-down',
              style: { width: logBtnS, height: logBtnS },
              widget: {
                type: 'button',
                label: 'Scroll Combat Log Down',
                disabled: combatLogScroll <= 0,
                onPress: () => scrollCombatLog(-2, logVisibleRows),
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'chevron-down', st)
              }
            }),
            boxNode({
              id: 'cs-log-close',
              style: { width: logBtnS, height: logBtnS },
              widget: {
                type: 'button',
                label: uiCopy(vp.isTouchPrimary, 'Close Combat Log (L)', 'Close Combat Log'),
                onPress: () => {
                  combatLogOpen = false
                  combatLogScroll = 0
                  uiDirty = true
                  hudRev++
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'close', st)
              }
            })
          ])
        ])
      )
    }

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      // Top-left chapter + gold capsule
      boxNode({
        id: 'top-left-bar',
        style: {
          anchor: 'top-left',
          width: topLeftW,
          height: topBarH,
          inset: isPhone ? 6 : 8,
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawBattleInfo(ctx, rect, chapterShort, state.campaign.gold)
        }
      }),

      // Mission Objective Tracker Badge right below top-left chapter bar (or below timeline when 2-row)
      boxNode({
        id: 'battle-objective-badge',
        style: {
          anchor: 'top-left',
          width: objBadgeW,
          height: objBadgeH,
          inset: [edgeX, objBadgeY],
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: false,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawObjectiveBadge(ctx, rect, {
            kind: battle.objective.kind,
            label: battle.objective.label,
            progressText: objText,
            urgent: objUrgent,
            compact: isPhone
          })
        }
      }),

      // Active Boss AoE Telegraph Warning Pill (glowing mobile-safe banner below objective badge)
      ...(bossTelegraphHud ? [boxNode({
        id: 'battle-boss-telegraph-badge',
        style: {
          anchor: 'top-left',
          width: bossTelegraphW,
          height: bossTelegraphH,
          inset: [edgeX, bossTelegraphY],
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: false,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawBossTelegraphBanner(ctx, rect, bossTelegraphHud, isPhone)
        }
      })] : []),

      // Active Solis Vale / Silverfen Stage Mechanic callout (Galewind Gust, Rising Tide, Monastery Waves)
      ...(stageMechanicHud ? [boxNode({
        id: 'battle-stage-mechanic-badge',
        style: {
          anchor: 'top-left',
          width: objBadgeW,
          height: stageMechanicH,
          inset: [edgeX, stageMechanicY],
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: false,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawPanel(ctx, rect, {
              r: RADIUS.md,
              lipH: 2,
              fill: stageMechanicHud.urgent ? '#2d2342eb' : '#192642eb',
              fillBot: stageMechanicHud.urgent ? '#1e1630f0' : '#111a30f0'
            })
            drawText(ctx, `${stageMechanicHud.label} · ${stageMechanicHud.detail}`, rect.x + 8, rect.y + rect.height * 0.5 + 3.5, {
              size: isPhone ? 9.5 : 10,
              weight: 800,
              color: stageMechanicHud.accentHex,
              maxW: rect.width - 16
            })
          }
        }
      })] : []),

      // Active Heroic/Mythic Tier & Mutator Badges right below objective badge
      ...(hasChallengeBadge ? [boxNode({
        id: 'battle-challenge-badge',
        style: {
          anchor: 'top-left',
          width: mobilePortrait ? Math.min(w - 64, 240) : Math.min(w - 16, Math.max(objBadgeW, isPhone ? 240 : 320)),
          height: challengeBadgeH,
          inset: [edgeX, challengeBadgeY],
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: false,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawChallengeHudBadges(
            ctx,
            rect,
            battle.difficultyTier,
            battle.mutators,
            isPhone
          )
        }
      })] : []),

      // Active Roguelite Endless Run Blessings summary pill
      ...(hasEndlessBlessingsHud ? [boxNode({
        id: 'battle-endless-blessings',
        style: {
          anchor: 'top-left',
          width: mobilePortrait ? Math.min(w - 64, 244) : Math.min(w - 16, Math.max(objBadgeW, isPhone ? 244 : 336)),
          height: endlessBlessingsH,
          inset: [edgeX, endlessBlessingsY],
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: false,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEndlessBlessingsHudPill(
            ctx,
            rect,
            activeEndlessBlessings,
            isPhone
          )
        }
      })] : []),

      // Glowing active Auto-Battle HUD pill right beneath the objective/challenge badges (click to stop)
      ...(battle.autoBattle ? [boxNode({
        id: 'cs-auto-pill',
        style: {
          anchor: 'top-left',
          width: isPhone ? Math.min(objBadgeW, 176) : Math.min(objBadgeW, 240),
          height: autoPillH,
          inset: [edgeX, autoPillY],
          respectSafeArea: true
        },
        widget: {
          type: 'button',
          label: uiCopy(vp.isTouchPrimary, 'Stop Auto-Battle (B / Esc)', 'Stop Auto-Battle'),
          selected: true,
          onPress: () => {
            if (cancelAutoBattle(state)) {
              state.sounds.push({ kind: 'card', pitch: 0.88 })
              uiDirty = true
              hudRev++
            }
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) =>
            drawAutoBattlePill(ctx, rect, battle.battleSpeed, st, isPhone, vp.isTouchPrimary)
        }
      })] : []),

      // Compact non-blocking First-Time Discovery Tip callout banner (clamped so it NEVER collides with dock/status ribbon!)
      ...(() => {
        const activeTip = getActiveDiscoveryTip(state)
        if (!activeTip || combatLogOpen || (isPhone && mobileHandOpen) || (isPhone && Boolean(activeForecast))) return []
        const tipBtnH = vp.isTouchPrimary || isPhone ? 30 : 26
        const tipH = isPhone ? 116 : 126
        const tipW = mobilePortrait
          ? Math.min(w - 16, 304)
          : mobileLandscape
            ? Math.min(w - 24, 296)
            : Math.min(w - 20, 326)
        const bottomReserve = dockH + (showHintPill ? 42 : 14) + vp.safeArea.bottom
        const maxTipY = Math.max(topBarH + 8, h - bottomReserve - tipH)
        const clampedTipY = Math.min(leftStackY, maxTipY)
        const tipInset: [number, number] = [edgeX, clampedTipY]
        const localizedTip: DiscoveryTipSpec = {
          ...activeTip,
          body: getDiscoveryTipBody(activeTip, vp.isTouchPrimary),
          hotkeyHint: getDiscoveryTipHotkey(activeTip, vp.isTouchPrimary)
        }
        return [
          column({
            id: 'discovery-tip-card',
            style: {
              anchor: 'top-left',
              width: tipW,
              height: tipH,
              inset: tipInset,
              padding: isPhone ? [6, 10] : [6, 12],
              gap: 0,
              respectSafeArea: true
            },
            widget: {
              type: 'panel',
              blocksPointer: true,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawDiscoveryTipCard(ctx, rect, localizedTip, {
                compact: isPhone,
                queuedCount: battle.tipQueue.length,
                isTouch: vp.isTouchPrimary
              })
            }
          }, [
            spacerNode(1),
            row({
              id: 'discovery-tip-actions',
              style: { height: tipBtnH, gap: 6, align: 'center' }
            }, [
              boxNode({
                id: 'cs-tip-skip-all',
                style: { width: isPhone ? 84 : 90, height: tipBtnH },
                widget: {
                  type: 'button',
                  label: 'Skip Tips',
                  onPress: () => {
                    audio.unlock()
                    skipAllTipsNow()
                  },
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                    ctx, rect, 'Skip Tips', st, { variant: 'ghost', size: isPhone ? 10.5 : 11 }
                  )
                }
              }),
              spacerNode(1),
              boxNode({
                id: 'cs-tip-dismiss',
                style: { width: isPhone ? 82 : 96, height: tipBtnH },
                widget: {
                  type: 'button',
                  label: 'Got it',
                  primary: true,
                  onPress: () => {
                    audio.unlock()
                    dismissCurrentDiscoveryTip()
                  },
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                    ctx, rect, uiCopy(vp.isTouchPrimary, isPhone ? 'Got it' : 'Got it (↵)', 'Got it'), st, { variant: 'primary', size: isPhone ? 10.5 : 11.5 }
                  )
                }
              })
            ])
          ])
        ]
      })(),
      // Top-right toolbar (aligned on top row for phone portrait & landscape too!)
      row({
        id: 'top-right-bar',
        style: {
          anchor: 'top-right',
          width: toolbarW,
          height: topBarH,
          inset: isPhone ? 6 : 8,
          gap: isPhone ? 4 : 6,
          padding: isPhone ? [4, 5] : [5, 7],
          align: 'center',
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawToolbarBg(ctx, rect)
        }
      }, toolbarItems),

      // Slim Next-3 Turn Pill on phones (H3: replaces colliding 5-unit turn-timeline by default; tap to expand!)
      ...(usePhoneTurnPill ? [boxNode({
        id: 'cs-turn-pill-toggle',
        style: {
          anchor: 'top',
          width: phonePillW,
          height: phonePillH,
          inset: phonePillInset,
          respectSafeArea: true
        },
        widget: {
          type: 'button',
          label: turnTimelineExpanded ? 'Collapse Turn Order' : 'Expand Turn Order',
          selected: turnTimelineExpanded,
          onPress: () => {
            audio.unlock()
            turnTimelineExpanded = !turnTimelineExpanded
            state.sounds.push({ kind: 'card', pitch: turnTimelineExpanded ? 1.12 : 0.94 })
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => {
            drawTimelineBg(ctx, rect)
            const nextThree = battle.turnOrder.slice(0, 3)
            const pSz = 24
            const gap = 5
            let px = rect.x + 8
            const py = rect.y + Math.floor((rect.height - pSz) * 0.5)
            for (let i = 0; i < nextThree.length; i++) {
              const entry = nextThree[i]
              const u = getUnitByUid(battle, entry.uid)
              const icon = u ? battleUnitPortrait(u) : portraits[entry.heroId ?? entry.enemyId ?? 'knight']
              const ring = entry.isCurrent ? COLOR.accentHi : entry.team === 'ally' ? COLOR.ally : COLOR.enemy
              drawPortraitTile(ctx, px, py, pSz, icon, {
                ring,
                ringW: entry.isCurrent ? 2.2 : 1.5,
                r: 6,
                bg: entry.team === 'ally' ? '#243a63' : '#4a2130'
              })
              px += pSz + gap
            }
            const labelX = px + 2
            const labelMaxW = Math.max(24, rect.x + rect.width - labelX - 8)
            drawText(ctx, turnTimelineExpanded ? 'Turns ▴' : 'Next ▾', labelX, rect.y + rect.height * 0.5 + 0.5, {
              size: 10.5,
              weight: 800,
              color: st.hovered || turnTimelineExpanded ? COLOR.accentHi : COLOR.muted,
              maxW: labelMaxW,
              display: true
            })
          }
        }
      })] : []),

      // Top-center turn-order token strip (always visible on desktop/tablet; expandable on phone!)
      ...(showFullTimeline ? [row({
        id: 'turn-timeline',
        style: {
          anchor: 'top',
          width: Math.min(w - 16, timelineW),
          height: tokenH + (isPhone ? 10 : 12),
          inset: timelineInset,
          gap: 5,
          padding: [5, 9],
          align: 'center',
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawTimelineBg(ctx, rect)
        }
      }, timelineNodes)] : []),

      // Dashed CT Shift Preview arc + ghost hero marker overlaid cleanly on top of the turn bar
      ...(showFullTimeline && ctPreview ? [boxNode({
        id: 'turn-timeline-preview',
        style: {
          anchor: 'top',
          width: Math.min(w - 16, timelineW),
          height: tokenH + (isPhone ? 10 : 12),
          inset: timelineInset,
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: false,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawTurnTimelinePreviewOverlay(ctx, rect, ctPreview, {
            activePortrait: battleUnitPortrait(active),
            slotCount: timelineNodes.length,
            tokenW,
            gap: 5,
            padX: 9,
            time: state.time
          })
        }
      })] : []),

      // Floating Turn-Order Hover/Tap Spotlight callout OR CT Shift Preview banner right beneath the turn bar
      ...(() => {
        const subY = showFullTimeline
          ? timelineInset[1] + tokenH + (isPhone ? 14 : 16)
          : phonePillInset[1] + phonePillH + 6
        if (hoveredTurnUnitUid) {
          const spotUnit = getUnitByUid(battle, hoveredTurnUnitUid)
          const spotEntry = hoveredTurnSlotIdx >= 0 ? battle.turnOrder[hoveredTurnSlotIdx] : battle.turnOrder.find(e => e.uid === hoveredTurnUnitUid)
          if (spotUnit && spotEntry) {
            return [boxNode({
              id: 'turn-spotlight-callout',
              style: {
                anchor: 'top',
                width: Math.min(w - 20, Math.max(timelineW, 340)),
                height: 26,
                inset: [8, subY],
                respectSafeArea: true
              },
              widget: {
                type: 'panel',
                blocksPointer: false,
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawTurnOrderCallout(ctx, rect, {
                  name: spotUnit.name,
                  team: spotUnit.team,
                  hp: spotUnit.hp,
                  maxHp: spotUnit.maxHp,
                  shield: spotUnit.shield,
                  ct: spotUnit.ct,
                  speed: effectiveSpeed(spotUnit),
                  slotIndex: Math.max(0, hoveredTurnSlotIdx),
                  isCurrent: spotEntry.isCurrent
                })
              }
            })]
          }
        }
        if (showFullTimeline && ctPreview && !isPhone) {
          return [boxNode({
            id: 'turn-ct-preview-banner',
            style: {
              anchor: 'top',
              width: Math.min(w - 20, Math.max(timelineW, 352)),
              height: 26,
              inset: [8, subY],
              respectSafeArea: true
            },
            widget: {
              type: 'panel',
              blocksPointer: false,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawTurnOrderPreviewBanner(ctx, rect, ctPreview, waitComparison)
            }
          })]
        }
        return []
      })(),

      // Touch Tile Inspector Card (ridgetop-5hr.8: tap any non-reachable/empty/cover/hazard/shrine tile on ALL widths including 390pt portrait)
      ...(() => {
        if (!inspectedTileCell || activeForecast || mobileHandOpen) return []
        const cell = battle.cells[inspectedTileCell.row]?.[inspectedTileCell.col]
        if (!cell || cell.terrain === 'void') return []
        const coverTip = formatCoverTooltip(cell, isPhone)
        const baseDesc = coverTip ?? (TERRAIN_LABEL[cell.terrain] ?? cell.terrain)
        const stateSuffix = coverTip
          ? ''
          : cell.terrain === 'lava_geyser'
            ? (cell.geyserActive ? ' · ERUPTING!' : ' · Dormant')
            : cell.terrain === 'cursed_altar'
              ? (cell.altarUsed ? ' · Spent' : ' · Active Pact')
              : cell.coverShattered
                ? ' · Rubble'
                : ''
        const hLvl = cellHeightLevel(cell)
        const enemyZoc = battle.phase === 'player' && computeZocPerimeterTiles(battle, 'enemy').some(z => z.col === inspectedTileCell!.col && z.row === inspectedTileCell!.row)
        const telegraphs = getTelegraphsAtCell(battle.bossTelegraphs, inspectedTileCell.col, inspectedTileCell.row)
        const extraTags: string[] = [`Elevation H${hLvl}`, `(${inspectedTileCell.col + 1},${inspectedTileCell.row + 1})`]
        if (enemyZoc) extraTags.push('⚠ Enemy ZoC')
        if (telegraphs.length > 0) extraTags.push(`⚠ ${telegraphs[0].label}`)
        const cardW = Math.min(w - 16, 420)
        const cardH = 54
        return [row({
          id: 'touch-tile-inspector',
          style: {
            anchor: 'bottom',
            width: cardW,
            height: cardH,
            inset: [8, dockH + 10],
            padding: [6, 10],
            gap: 8,
            align: 'center',
            respectSafeArea: true
          },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, {
              r: RADIUS.md,
              lipH: 3,
              fill: telegraphs.length > 0 ? '#4d152deb' : enemyZoc ? '#422015eb' : '#223054f0',
              fillBot: telegraphs.length > 0 ? '#2b0b1af2' : enemyZoc ? '#26120cf2' : '#141d36f4'
            })
          }
        }, [
          boxNode({
            id: 'touch-tile-inspector-body',
            style: { grow: 1, height: cardH - 12 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
                drawText(ctx, `${baseDesc}${stateSuffix}`, rect.x, rect.y + 12, {
                  size: 12,
                  weight: 900,
                  color: COLOR.text,
                  maxW: rect.width,
                  display: true
                })
                drawText(ctx, extraTags.join(' · '), rect.x, rect.y + 30, {
                  size: 10.5,
                  weight: 700,
                  color: telegraphs.length > 0 ? '#ff9ec8' : enemyZoc ? '#ffb26b' : COLOR.muted,
                  maxW: rect.width
                })
              }
            }
          }),
          boxNode({
            id: 'cs-tile-inspector-close',
            style: { width: 34, height: 34 },
            widget: {
              type: 'button',
              label: 'Dismiss Tile Inspector',
              onPress: () => {
                inspectedTileCell = null
                uiDirty = true
                hudRev++
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'close', st)
            }
          })
        ])]
      })(),

      // Context hint pill right above bottom dock (with one-click Cancel for Facing Picker or Pending Touch OA Move!)
      ...(showHintPill ? [facingPickerState
        ? row({
            id: 'dock-facing-ribbon',
            style: {
              anchor: 'bottom',
              width: Math.min(w - 16, 650),
              height: 30,
              inset: [8, dockH + 12],
              gap: 6,
              align: 'center',
              respectSafeArea: true
            }
          }, [
            boxNode({
              id: 'dock-status-ribbon',
              style: { grow: 1, height: 30 },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawHintPill(ctx, rect, statusLine, statusAccent)
              }
            }),
            boxNode({
              id: 'cs-cancel-facing',
              style: { width: vp.isTouchPrimary || isPhone ? 74 : 96, height: 30 },
              widget: {
                type: 'button',
                label: uiCopy(vp.isTouchPrimary, 'Cancel (Esc)', 'Cancel'),
                onPress: () => {
                  audio.unlock()
                  if (cancelWaitFacingPicker(state)) { uiDirty = true; hudRev++ }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, uiCopy(vp.isTouchPrimary, isPhone ? 'Cancel' : 'Cancel (Esc)', 'Cancel'), st, { variant: 'secondary', size: 11 }
                )
              }
            })
          ])
        : pendingOaMoveCell
          ? row({
              id: 'dock-oa-ribbon',
              style: {
                anchor: 'bottom',
                width: Math.min(w - 16, 650),
                height: 32,
                inset: [8, dockH + 12],
                gap: 6,
                align: 'center',
                respectSafeArea: true
              }
            }, [
              boxNode({
                id: 'dock-status-ribbon',
                style: { grow: 1, height: 32 },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawHintPill(ctx, rect, statusLine, statusAccent)
                }
              }),
              boxNode({
                id: 'cs-cancel-oa',
                style: { width: 74, height: 32 },
                widget: {
                  type: 'button',
                  label: 'Cancel',
                  onPress: () => {
                    pendingOaMoveCell = null
                    uiDirty = true
                    hudRev++
                  },
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                    ctx, rect, 'Cancel', st, { variant: 'secondary', size: 11 }
                  )
                }
              })
            ])
          : boxNode({
              id: 'dock-status-ribbon',
              style: {
                anchor: 'bottom',
                width: Math.min(w - 20, 580),
                height: 26,
                inset: [8, dockH + 12],
                respectSafeArea: true
              },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawHintPill(ctx, rect, statusLine, statusAccent)
              }
            })] : []),

      // Compact Collapsible Combat Log toggle button (hidden on Battle 1 via advToolsUnlocked)
      ...(advToolsUnlocked ? [boxNode({
        id: 'cs-combat-log-toggle',
        style: {
          anchor: 'top-left',
          width: logToggleW,
          height: logToggleH,
          inset: [logEdgeX, logToggleY],
          respectSafeArea: true
        },
        widget: {
          type: 'button',
          label: uiCopy(
            vp.isTouchPrimary,
            combatLogOpen ? 'Hide Combat Log (L)' : `Combat Log (${combatLogEntries.length}) (L)`,
            combatLogOpen ? 'Hide Combat Log' : `Combat Log (${combatLogEntries.length})`
          ),
          selected: combatLogOpen,
          onPress: () => {
            weatherInspectorOpen = false
            toggleCombatLog()
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawCombatLogToggleButton(ctx, rect, st, {
            open: combatLogOpen,
            unreadCount: combatLogUnread,
            totalCount: combatLogEntries.length,
            compact: isPhone,
            hideKeycap: !vp.showKeycaps,
            isTouch: vp.isTouchPrimary
          })
        }
      })] : []),

      // Sleek tappable Weather & Time-of-Day HUD pill beside Combat Log (never overlaps Turn Order, Pause, Objective, or Forecast)
      boxNode({
        id: 'cs-weather-pill',
        style: {
          anchor: 'top-left',
          width: weatherPillW,
          height: logToggleH,
          inset: [weatherPillX, logToggleY],
          respectSafeArea: true
        },
        widget: {
          type: 'button',
          label: `${formatWeatherHudLabel(battle.weather, battle.timeOfDay, false)} — ${WEATHER_SPECS[battle.weather].ruleSummary}`,
          selected: showWeatherDetail,
          onPress: () => {
            audio.unlock()
            weatherInspectorOpen = !weatherInspectorOpen
            if (weatherInspectorOpen) {
              combatLogOpen = false
            }
            state.sounds.push({ kind: 'card', pitch: weatherInspectorOpen ? 1.16 : 0.94 })
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawWeatherHudPill(
            ctx,
            rect,
            battle.weather,
            battle.timeOfDay,
            { compact: isPhone || weatherPillW < 170, expanded: showWeatherDetail },
            st
          )
        }
      }),

      // Compact tap-to-inspect Weather rules popover (auto-clamped inside viewport bounds)
      ...(showWeatherDetail ? [boxNode({
        id: 'cs-weather-detail',
        style: {
          anchor: 'top-left',
          width: weatherDetailW,
          height: weatherDetailH,
          inset: [logEdgeX, weatherDetailY],
          respectSafeArea: true
        },
        widget: {
          type: 'button',
          label: `Close ${WEATHER_SPECS[battle.weather].name} Weather Rules`,
          onPress: () => {
            weatherInspectorOpen = false
            state.sounds.push({ kind: 'card', pitch: 0.92 })
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWeatherDetailCard(
            ctx,
            rect,
            battle.weather,
            battle.timeOfDay,
            isPhone
          )
        }
      })] : []),

      // Non-blocking Battle Banter speech pill for bonded heroes (clamped & mobile-safe!)
      ...(() => {
        const banter = battle.activeBanter
        if (!banter || mobileHandOpen || (isPhone && Boolean(activeForecast))) return []
        const hasTurnSub = Boolean(hoveredTurnUnitUid || ctPreview)
        const subY = timelineInset[1] + tokenH + (isPhone ? 14 : 16)
        const banterH = mobileLandscape ? 42 : isPhone ? 44 : 46
        const speakerUnit = getUnitByUid(battle, banter.speakerUid)
        const banterPortrait = speakerUnit ? battleUnitPortrait(speakerUnit) : portraits[banter.speakerHeroId]
        // On phone viewports (portrait & landscape), float above dock+hint when no forecast is open
        // so the top Turn Order, Objective, Boss Telegraph banner, and Weather pill stay completely clear!
        if ((mobilePortrait || mobileLandscape) && !activeForecast) {
          const banterW = mobileLandscape ? Math.min(w - 160, 380) : Math.min(w - 16, 352)
          const bottomInsetY = dockH + (showHintPill ? (mobileLandscape ? 38 : 42) : 10)
          return [boxNode({
            id: 'battle-banter-toast',
            style: {
              anchor: 'bottom',
              width: banterW,
              height: banterH,
              inset: [8, bottomInsetY],
              respectSafeArea: true
            },
            widget: {
              type: 'panel',
              blocksPointer: false,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawBattleBanterToast(ctx, rect, banter, {
                portrait: banterPortrait,
                compact: true
              })
            }
          })]
        }
        const banterW = mobilePortrait
          ? Math.min(w - 16, 344)
          : mobileLandscape
            ? Math.min(w - 120, 360)
            : Math.min(w - 32, 420)
        const banterY = subY + (hasTurnSub ? 30 : 2)
        return [boxNode({
          id: 'battle-banter-toast',
          style: {
            anchor: 'top',
            width: banterW,
            height: banterH,
            inset: [8, banterY],
            respectSafeArea: true
          },
          widget: {
            type: 'panel',
            blocksPointer: false,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawBattleBanterToast(ctx, rect, banter, {
              portrait: banterPortrait,
              compact: isPhone
            })
          }
        })]
      })(),

      ...combatLogPanelNodes,
      ...forecastNodes,
      ...phoneHandNodes,
      dockNode
    ])
  }

  // =========================================================================
  // VANGUARD CAMP (BOTTOM GLASS SHEET KEEPING THE 3D DIORAMA OPEN ABOVE!)
  // =========================================================================

  function buildCampTree(w: number, h: number): LayoutNode {
    const vp = getViewportProfile(w, h)
    const camp = state.campaign
    const shortH = vp.isLandscapePhone || h < 480
    const mobile = vp.isPortraitPhone || (!shortH && w < 720)
    const isPhone = vp.isPhone || mobile || shortH
    const wide = w >= 980 && !shortH
    const deckValue = computeDeckValue(camp)

    // P2: Progressive Camp Disclosure
    const unlockedCampTabIds = getUnlockedCampTabs(camp)
    const effectiveUnlockedTabs: readonly CampTabId[] = unlockedCampTabIds.length > 0 ? unlockedCampTabIds : ['squad']
    if (!effectiveUnlockedTabs.includes(toCampTabId(campTab))) {
      campTab = fromCampTabId(effectiveUnlockedTabs[0] ?? 'squad')
    }
    const bondsUnlocked = isSquadBondsUnlocked(camp)
    const temperingUnlocked = isGearTemperingUnlocked(camp)
    const bulkSalvageUnlocked = isBulkSalvageUnlocked(camp)
    const showSecondaryCurrencies = areSecondaryCurrenciesVisible(camp)
    const codexUnlocked = isCodexUnlocked(camp)

    const safeHoriz = vp.safeArea.left + vp.safeArea.right
    const sheetW = Math.min(w - Math.max(isPhone ? 12 : 24, safeHoriz + 8), 1120)
    // Keep upper ~48% of viewport open on desktop so the live 3D campfire + squad shine!
    // On phone, allow collapsing the sheet down to the tab bar to inspect the 3D squad!
    const squadSelHero: OwnedHeroCard | undefined =
      campTab === 'squad' ? (getHeroByUid(camp, camp.selectedCampHeroUid) ?? camp.heroes[0]) : undefined
    const has3StarSquadHero = Boolean(squadSelHero && squadSelHero.stars >= 3)
    const collapsed = isPhone && mobileCampCollapsed
    let sheetH = collapsed
      ? 62
      : mobile
        ? (has3StarSquadHero ? Math.min(h - 112, 576) : Math.min(h - 118, 496))
        : shortH
          ? Math.min(h - 56, 326)
          : wide
            ? Math.min(Math.max(326, Math.round(h * 0.49)), 376)
            : (has3StarSquadHero ? Math.min(h - 90, Math.max(368, Math.round(h * 0.52))) : Math.min(Math.max(326, Math.round(h * 0.49)), 376))

    let bodyNode: LayoutNode
    let activeArmoryDiff: EquipmentStatDiff | null = null
    let activeArmoryUpgradePreview: EquipUpgradePreview | null = null
    let armorySelectedHero: OwnedHeroCard | undefined
    let confirmInspectedArmoryEquip: (() => void) | null = null
    if (campTab !== 'armory') {
      armoryEquipIdByWidget.clear()
    }

    if (campTab === 'squad') {
      const selHero: OwnedHeroCard | undefined =
        getHeroByUid(camp, camp.selectedCampHeroUid) ?? camp.heroes[0]
      const sortedHeroes = camp.heroes.slice().sort((a, b) => {
        const aIn = camp.squadUids.includes(a.uid) ? 0 : 1
        const bIn = camp.squadUids.includes(b.uid) ? 0 : 1
        if (aIn !== bIn) return aIn - bIn
        if (b.stars !== a.stars) return b.stars - a.stars
        return a.heroId.localeCompare(b.heroId)
      })
      const perPage = shortH ? 3 : mobile ? 5 : 4
      const maxPage = Math.max(0, Math.ceil(sortedHeroes.length / perPage) - 1)
      rosterPage = Math.min(rosterPage, maxPage)
      const visibleHeroes = sortedHeroes.slice(rosterPage * perPage, rosterPage * perPage + perPage)

      const rosterButtons: LayoutNode[] = visibleHeroes.map((hero, idx) => {
        const spec = HERO_SPECS[hero.heroId]
        const effectiveTitle = getEffectiveHeroTitle(hero.heroId, hero.stars, hero.subSpecId)
        const subSpecTitle = hero.stars >= 3 && hero.subSpecId ? effectiveTitle : undefined
        const needsSubSpec = needsSubSpecChoice(hero)
        const inSquad = camp.squadUids.includes(hero.uid)
        const copies = getMergeCandidates(camp, hero.uid).length
        const need = hero.stars === 1 ? MERGE_COPIES_REQUIRED[1] : hero.stars === 2 ? MERGE_COPIES_REQUIRED[2] : 0
        const readyMerge = hero.stars < 3 && copies >= need
        const portrait = heroCardPortrait(hero)
        return boxNode({
          id: `camp-hero-${idx}`,
          style: mobile ? { grow: 1, height: has3StarSquadHero ? 56 : 64 } : { height: 48 },
          widget: {
            type: 'button',
            label: `${spec.name} (${effectiveTitle})`,
            selected: selHero?.uid === hero.uid,
            onPress: () => {
              audio.unlock()
              camp.selectedCampHeroUid = hero.uid
              uiDirty = true
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawHeroRosterCard(ctx, rect, {
              hero, spec, portrait, inSquad, copies, need, readyMerge, token: mobile, subSpecTitle, needsSubSpec
            }, st)
          }
        })
      })

      const pagerNode = row({ id: 'cr-pager', hidden: maxPage === 0, style: { height: 26, gap: 6, align: 'center' } }, [
        boxNode({
          id: 'cr-prev', style: { grow: 1, height: 26 },
          widget: {
            type: 'button', label: 'Prev', disabled: rosterPage <= 0,
            onPress: () => { rosterPage--; uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Prev', st, { variant: 'ghost', size: 11 })
          }
        }),
        boxNode({
          id: 'cr-pg', style: { width: 46, height: 26 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(ctx, rect, `${rosterPage + 1}/${maxPage + 1}`, { size: 11, color: COLOR.muted, align: 'center' })
          }
        }),
        boxNode({
          id: 'cr-next', style: { grow: 1, height: 26 },
          widget: {
            type: 'button', label: 'Next', disabled: rosterPage >= maxPage,
            onPress: () => { rosterPage++; uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Next', st, { variant: 'ghost', size: 11 })
          }
        })
      ])

      if (selHero) {
        const spec = HERO_SPECS[selHero.heroId]
        const stats = computeHeroStats(camp, selHero)
        const inSquad = camp.squadUids.includes(selHero.uid)
        const copies = getMergeCandidates(camp, selHero.uid).length
        const need = selHero.stars === 1 ? MERGE_COPIES_REQUIRED[1] : selHero.stars === 2 ? MERGE_COPIES_REQUIRED[2] : 0
        const canMerge = canMergeHero(camp, selHero.uid)
        const weapon = getEquipmentByUid(camp, selHero.weaponUid)
        const armor = getEquipmentByUid(camp, selHero.armorUid)
        const relic = getEquipmentByUid(camp, selHero.relicUid)
        const wSpec = weapon ? EQUIPMENT_BY_ID[weapon.equipId] : undefined
        const aSpec = armor ? EQUIPMENT_BY_ID[armor.equipId] : undefined
        const rSpec = relic ? EQUIPMENT_BY_ID[relic.equipId] : undefined
        const salvageVal = RARITY_META[spec.rarity].salvage * (selHero.stars === 3 ? 4 : selHero.stars === 2 ? 2 : 1)
        const heroPortrait = heroCardPortrait(selHero)
        const heroGearSets = getHeroGearSetProgress(camp, selHero)

        const mergeLabel = selHero.stars >= 3
          ? 'Max Tier'
          : canMerge
            ? `Ascend (${copies}/${need})`
            : `Merge (${copies}/${need})`
        const squadLabel = inSquad ? 'Bench' : `Deploy (${camp.squadUids.length}/${maxSquadSize(camp)})`

        const statItems: { icon: IconName; label: string; value: string; color: string }[] = [
          { icon: 'heart', label: 'HP', value: `${stats.maxHp}`, color: COLOR.good },
          { icon: 'sword', label: 'ATK', value: `${stats.atk}`, color: '#ffb36b' },
          { icon: 'shield', label: 'DEF', value: `${stats.def}`, color: '#8fc8ff' },
          { icon: 'bolt', label: 'SPD', value: `${stats.speed}`, color: '#ffe27a' },
          { icon: 'boot', label: 'MOV', value: `${stats.move}`, color: '#c4b5ff' },
          { icon: 'crit', label: 'CRIT', value: `${Math.round(stats.crit * 100)}%`, color: '#ff8da1' }
        ]

        const is3Star = selHero.stars >= 3
        const heroTitle = getEffectiveHeroTitle(selHero.heroId, selHero.stars, selHero.subSpecId)
        const needsSubSpec = needsSubSpecChoice(selHero)
        const headerH = is3Star && shortH ? 38 : is3Star && mobile ? 44 : shortH ? 42 : 50
        const headerNode = boxNode({
          id: 'ins-head', style: { height: headerH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawHeroHeader(ctx, rect, {
              name: spec.name,
              title: heroTitle,
              stars: selHero.stars,
              level: selHero.level,
              xp: selHero.xp,
              rarity: spec.rarity,
              power: stats.powerScore,
              portrait: heroPortrait,
              inSquad,
              locked: Boolean(selHero.locked),
              equipFamily: getHeroEquipFamily(selHero.heroId),
              gearSets: heroGearSets,
              hasSubSpec: Boolean(is3Star && selHero.subSpecId),
              needsSubSpec
            })
          }
        })

        const statsH = is3Star && shortH ? 28 : is3Star && mobile ? 30 : shortH ? 30 : mobile ? 34 : 38
        const statsNode = boxNode({
          id: 'ins-stats', style: { height: statsH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawStatStrip(ctx, rect, statItems)
          }
        })

        const actRowH = is3Star && shortH ? 30 : is3Star && mobile ? 32 : shortH ? 32 : 36
        const actionsNode = row({ id: 'ins-actions', style: { height: actRowH, gap: 8 } }, [
          boxNode({
            id: 'cs-merge-hero', style: { grow: 1.4, height: actRowH },
            widget: {
              type: 'button',
              label: mergeLabel,
              primary: canMerge,
              disabled: !canMerge,
              onPress: () => {
                audio.unlock()
                if (mergeHero(state, selHero.uid)) {
                  saveNow()
                  scene.triggerCampEquipFlourish(selHero.uid, undefined, TIER_COLOR[selHero.stars])
                  startAscensionFanfare(selHero)
                }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, mergeLabel, st, { variant: canMerge ? 'success' : 'secondary', icon: 'up', size: 12 }
              )
            }
          }),
          boxNode({
            id: 'cs-toggle-squad', style: { grow: 1.1, height: actRowH },
            widget: {
              type: 'button',
              label: squadLabel,
              disabled: inSquad ? camp.squadUids.length <= 1 : camp.squadUids.length >= maxSquadSize(camp),
              onPress: () => {
                audio.unlock()
                if (toggleSquadMember(state, selHero.uid)) {
                  saveNow()
                  uiDirty = true
                }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, squadLabel, st, { variant: inSquad ? 'secondary' : 'primary', size: 12 }
              )
            }
          }),
          boxNode({
            id: 'cs-lock-hero', style: { width: mobile ? 36 : 40, height: actRowH },
            widget: {
              type: 'button',
              label: selHero.locked ? 'Unlock Hero' : 'Lock Hero',
              selected: Boolean(selHero.locked),
              onPress: () => {
                audio.unlock()
                if (toggleHeroLock(state, selHero.uid)) {
                  saveNow()
                  showToast(selHero.locked ? `Locked ${spec.name}.` : `Unlocked ${spec.name}.`)
                }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(
                ctx, rect, selHero.locked ? 'lock' : 'unlock', st, { active: Boolean(selHero.locked) }
              )
            }
          }),
          boxNode({
            id: 'cs-salvage-hero', style: { width: mobile ? 86 : 104, height: actRowH },
            widget: {
              type: 'button',
              label: selHero.locked
                ? 'Locked'
                : `+${salvageVal}g +${getHeroSalvageShards(HERO_SPECS[selHero.heroId].rarity, selHero.stars)} Shards`,
              disabled: Boolean(selHero.locked) || camp.heroes.length <= 1 || (inSquad && camp.squadUids.length <= 1),
              onPress: () => {
                audio.unlock()
                const heroSpec = HERO_SPECS[selHero.heroId]
                const shardsYield = getHeroSalvageShards(heroSpec.rarity, selHero.stars)
                const g = salvageHeroCard(state, selHero.uid)
                if (g > 0) {
                  saveNow()
                  showToast(`Salvaged ${heroSpec.name} for +${g}g & +${shardsYield} Hero Shards.`)
                }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, selHero.locked ? 'Locked' : `+${salvageVal}g`, st,
                selHero.locked
                  ? { variant: 'secondary', icon: 'lock', size: 10.5 }
                  : {
                      variant: 'danger',
                      icon: 'sell',
                      sub: `+${getHeroSalvageShards(HERO_SPECS[selHero.heroId].rarity, selHero.stars)} Shards`,
                      size: 10.5
                    }
              )
            }
          })
        ])

        const bestFitUpgrades = findBestFitUpgrades(camp, selHero.uid)
        const bestFitCount = bestFitUpgrades.length
        const bestFitLabel = bestFitCount > 0 ? `Best Fit (+${bestFitCount})` : 'Best Fit'
        const gearHeaderLabel = !wide && heroGearSets.length > 0
          ? heroGearSets[0].active
            ? `Equipped Gear · 2/2 ${heroGearSets[0].spec.tag}: ${heroGearSets[0].spec.perkName}`
            : `Equipped Gear · 1/2 ${heroGearSets[0].spec.tag}`
          : 'Equipped Gear'
        const gearHeaderH = 24
        const gearHeaderRow = row({ id: 'ins-eq-head', style: { height: gearHeaderH, gap: 8, align: 'center' } }, [
          boxNode({
            id: 'ins-eq-lbl', style: { grow: 1, height: gearHeaderH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawOverline(ctx, gearHeaderLabel, rect.x, rect.y + gearHeaderH * 0.5, rect.width)
            }
          }),
          boxNode({
            id: 'cs-auto-equip', style: { width: bestFitCount > 0 ? 114 : 88, height: gearHeaderH },
            widget: {
              type: 'button',
              label: bestFitLabel,
              disabled: bestFitCount === 0,
              onPress: () => {
                audio.unlock()
                runBestFit(selHero.uid)
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, bestFitLabel, st, { variant: bestFitCount > 0 ? 'success' : 'secondary', icon: 'sparkle', size: 10.5 }
              )
            }
          })
        ])

        const gearH = is3Star && shortH ? 36 : is3Star && mobile ? 40 : shortH ? 40 : mobile ? 44 : 48
        const gearRow = row({ id: 'ins-eq-row', style: { height: gearH, gap: 6 } }, [
          boxNode({
            id: 'eq-slot-weapon', style: { grow: 1, height: gearH },
            widget: {
              type: 'button',
              label: wSpec ? formatEquipDisplayName(wSpec, weapon?.upgradeLevel) : 'Empty Weapon',
              onPress: () => {
                if (wSpec) { unequipItem(state, selHero.uid, 'weapon'); saveNow(); uiDirty = true }
                else { setCampTab('armory'); armorySlotFilter = 'weapon'; uiDirty = true }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEquipCard(ctx, rect, { slot: 'weapon', spec: wSpec, upgradeLevel: weapon?.upgradeLevel, locked: Boolean(weapon?.locked) }, st)
            }
          }),
          boxNode({
            id: 'eq-slot-armor', style: { grow: 1, height: gearH },
            widget: {
              type: 'button',
              label: aSpec ? formatEquipDisplayName(aSpec, armor?.upgradeLevel) : 'Empty Armor',
              onPress: () => {
                if (aSpec) { unequipItem(state, selHero.uid, 'armor'); saveNow(); uiDirty = true }
                else { setCampTab('armory'); armorySlotFilter = 'armor'; uiDirty = true }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEquipCard(ctx, rect, { slot: 'armor', spec: aSpec, upgradeLevel: armor?.upgradeLevel, locked: Boolean(armor?.locked) }, st)
            }
          }),
          boxNode({
            id: 'eq-slot-relic', style: { grow: 1, height: gearH },
            widget: {
              type: 'button',
              label: rSpec ? formatEquipDisplayName(rSpec, relic?.upgradeLevel) : 'Empty Relic',
              onPress: () => {
                if (rSpec) { unequipItem(state, selHero.uid, 'relic'); saveNow(); uiDirty = true }
                else { setCampTab('armory'); armorySlotFilter = 'relic'; uiDirty = true }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEquipCard(ctx, rect, { slot: 'relic', spec: rSpec, upgradeLevel: relic?.upgradeLevel, locked: Boolean(relic?.locked) }, st)
            }
          })
        ])

        const passive = getHeroPassive(selHero.heroId)
        const passiveNode: LayoutNode | null = passive
          ? boxNode({
              id: 'ins-passive',
              style: { height: is3Star && wide ? 32 : wide ? 40 : is3Star && mobile ? 24 : shortH ? 24 : 28 },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPassiveBanner(ctx, rect, passive, !wide || is3Star)
              }
            })
          : null

        const subSpecOptions = is3Star ? getHeroSubSpecOptions(selHero.heroId) : null
        const subSpecHeaderH = 15
        const subSpecCardH = wide ? 68 : shortH ? 58 : mobile ? 66 : 62
        const subSpecPickerNode: LayoutNode | null = subSpecOptions
          ? column({ id: 'sq-subspec-wrap', style: { height: subSpecHeaderH + 3 + subSpecCardH, gap: 3 } }, [
              boxNode({
                id: 'sq-subspec-hdr',
                style: { height: subSpecHeaderH },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSubSpecHeader(ctx, rect, {
                    needsChoice: needsSubSpec,
                    activeTitle: selHero.subSpecId ? heroTitle : undefined,
                    animTime: state.time
                  })
                }
              }),
              row({ id: 'sq-subspec-row', style: { height: subSpecCardH, gap: 6 } }, subSpecOptions.map((opt, idx) => {
                const isActivePath = selHero.subSpecId === opt.id
                return boxNode({
                  id: `sq-subspec-${idx}`,
                  style: { grow: 1, height: subSpecCardH },
                  widget: {
                    type: 'button',
                    label: `${opt.title} (${opt.statSummary}) — ${opt.ultimate.name}`,
                    selected: isActivePath,
                    onPress: () => {
                      audio.unlock()
                      if (selectHeroSubSpec(state, selHero.uid, opt.id)) {
                        saveNow()
                        scene.triggerCampEquipFlourish(selHero.uid, undefined, opt.accentHex)
                        showToast(`${spec.name} mastered ${opt.title} (${opt.ultimate.name})!`)
                        uiDirty = true
                      }
                    },
                    draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSubSpecCard(
                      ctx,
                      rect,
                      opt,
                      st,
                      { active: isActivePath, needsChoice: needsSubSpec, animTime: state.time }
                    )
                  }
                })
              }))
            ])
          : null

        const skillRowH = is3Star && wide ? 34 : wide ? 42 : is3Star && mobile ? 24 : shortH ? 26 : mobile ? 28 : 34
        const skillNodes: LayoutNode[] = spec.skills.map((baseSkill, i) => {
          const sk = getEffectiveHeroSkill(selHero.heroId, i, is3Star ? selHero.subSpecId : undefined) ?? baseSkill
          const unlocked = selHero.stars >= sk.tier
          return boxNode({
            id: `ins-sk-${i}`, style: { height: skillRowH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSkillRow(ctx, rect, {
                tier: sk.tier,
                name: sk.name,
                desc: sk.desc,
                unlocked,
                vfx: sk.vfx,
                skillId: sk.id
              })
            }
          })
        })

        const squadBondPairs = bondsUnlocked ? getSquadBondSummary(camp) : []
        const squadBondsNodes: LayoutNode[] = bondsUnlocked
          ? [boxNode({
              id: 'camp-squad-bonds',
              style: { height: wide ? 26 : shortH ? 22 : 24 },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSquadBondsStrip(
                  ctx,
                  rect,
                  squadBondPairs,
                  !wide
                )
              }
            })]
          : []

        if (mobile) {
          const mobileSkills = is3Star ? skillNodes.slice(0, h >= 760 ? 3 : 2) : skillNodes
          bodyNode = column({ id: 'camp-squad-body', style: { grow: 1, gap: is3Star ? 4 : 5 } }, [
            row({ id: 'camp-roster-row', style: { height: has3StarSquadHero ? 56 : 64, gap: 6 } }, rosterButtons),
            pagerNode,
            ...squadBondsNodes,
            column({
              id: 'camp-inspector-col',
              style: { grow: 1, gap: is3Star ? 4 : 5, padding: is3Star ? 8 : 9 },
              widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWell(ctx, rect) }
            }, [
              headerNode,
              statsNode,
              ...(passiveNode ? [passiveNode] : []),
              actionsNode,
              gearHeaderRow,
              gearRow,
              ...(subSpecPickerNode ? [subSpecPickerNode] : []),
              ...mobileSkills
            ])
          ])
        } else if (wide) {
          // 3-column desktop sheet: compact height so the 3D camp diorama shines above!
          bodyNode = row({ id: 'camp-squad-body', style: { grow: 1, gap: 10 } }, [
            column({ id: 'camp-roster-col', style: { width: 228, gap: 6 } }, [
              boxNode({
                id: 'cr-title', style: { height: 14 },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawOverline(
                    ctx, `Roster ${camp.heroes.length}  -  Squad ${camp.squadUids.length}/${maxSquadSize(camp)}`, rect.x, rect.y + 7, rect.width
                  )
                }
              }),
              ...rosterButtons,
              spacerNode(1),
              pagerNode
            ]),
            column({
              id: 'camp-inspector-col',
              style: { grow: 1.25, gap: 6, padding: 10 },
              widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWell(ctx, rect) }
            }, [
              headerNode,
              statsNode,
              actionsNode,
              gearHeaderRow,
              gearRow,
              ...(heroGearSets.length > 0
                ? [boxNode({
                    id: 'ins-gear-sets',
                    style: { height: 24 },
                    widget: {
                      type: 'panel',
                      draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawGearSetBanner(ctx, rect, heroGearSets, false)
                    }
                  })]
                : []),
              ...squadBondsNodes
            ]),
            column({
              id: 'camp-skills-col',
              style: { grow: 0.95, gap: is3Star ? 4 : 5, padding: 10 },
              widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWell(ctx, rect) }
            }, [
              ...(passiveNode ? [passiveNode] : []),
              ...(subSpecPickerNode ? [subSpecPickerNode] : []),
              boxNode({
                id: 'ins-sk-lbl', style: { height: 13 },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawOverline(ctx, 'Skill Ascension', rect.x, rect.y + 6.5, rect.width)
                }
              }),
              ...skillNodes,
              ...(is3Star ? [] : [
                spacerNode(1),
                boxNode({
                  id: 'ins-sk-tip', style: { height: 15 },
                  widget: {
                    type: 'panel',
                    draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                      ctx, rect, 'Merge 3 copies for Tier 2, 2 copies for Tier 3', { size: 10, color: COLOR.faint }
                    )
                  }
                })
              ])
            ])
          ])
        } else {
          // Medium tablet / landscape phone: 2 columns
          bodyNode = row({ id: 'camp-squad-body', style: { grow: 1, gap: shortH && w < 740 ? 6 : 10 } }, [
            column({ id: 'camp-roster-col', style: { width: shortH && w < 740 ? 186 : 214, gap: 5 } }, [
              boxNode({
                id: 'cr-title', style: { height: 14 },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawOverline(
                    ctx, `Squad ${camp.squadUids.length}/${maxSquadSize(camp)}`, rect.x, rect.y + 7, rect.width
                  )
                }
              }),
              ...rosterButtons,
              spacerNode(1),
              ...squadBondsNodes,
              pagerNode
            ]),
            column({
              id: 'camp-inspector-col',
              style: { grow: 1, gap: 4, padding: shortH ? 7 : 9 },
              widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWell(ctx, rect) }
            }, [
              headerNode,
              statsNode,
              ...(passiveNode && !is3Star ? [passiveNode] : []),
              actionsNode,
              gearHeaderRow,
              gearRow,
              ...(subSpecPickerNode ? [subSpecPickerNode] : skillNodes.slice(0, shortH ? 1 : 2))
            ])
          ])
        }
      } else {
        bodyNode = boxNode({
          id: 'camp-empty', style: { grow: 1 },
          widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEmptyNote(ctx, rect, 'No heroes recruited yet.') }
        })
      }
    } else if (campTab === 'armory') {
      const selHero = getHeroByUid(camp, camp.selectedCampHeroUid) ?? camp.heroes[0]
      armorySelectedHero = selHero
      if (hoveredArmoryEquipUid && !getEquipmentByUid(camp, hoveredArmoryEquipUid)) {
        hoveredArmoryEquipUid = null
      }
      if (inspectedArmoryEquipUid && !getEquipmentByUid(camp, inspectedArmoryEquipUid)) {
        inspectedArmoryEquipUid = null
      }
      const previewArmoryEquipUid = hoveredArmoryEquipUid ?? inspectedArmoryEquipUid
      activeArmoryDiff = selHero && previewArmoryEquipUid
        ? computeEquipmentStatDiff(camp, selHero.uid, previewArmoryEquipUid)
        : null
      activeArmoryUpgradePreview = temperingUnlocked && previewArmoryEquipUid
        ? getEquipUpgradePreview(camp, previewArmoryEquipUid)
        : null

      const equipArmoryItem = (item: OwnedEquipCard) => {
        if (!selHero) return
        const spec = EQUIPMENT_BY_ID[item.equipId]
        const displayName = spec ? formatEquipDisplayName(spec, item.upgradeLevel) : item.equipId
        if (!canHeroEquipItem(selHero.heroId, item.equipId)) {
          const reason = getEquipCompatibilityReason(selHero.heroId, item.equipId)
          showToast(reason ?? `Cannot equip ${displayName} on ${HERO_SPECS[selHero.heroId].name}.`)
          return
        }
        const wasOnSel = findEquipOwner(camp, item.uid)?.uid === selHero.uid
        const setsBefore = getHeroActiveGearSetIds(camp, selHero)
        if (equipItem(state, selHero.uid, item.uid)) {
          inspectedArmoryEquipUid = item.uid
          saveNow()
          scene.triggerCampEquipFlourish(selHero.uid, item.slot, spec?.accentHex)
          const setsAfter = getHeroActiveGearSetIds(camp, selHero)
          const newSetId = setsAfter.find(id => !setsBefore.includes(id))
          const eqEff = spec ? getEquipEffect(spec.id) : null
          const baseMsg = eqEff
            ? `Equipped ${displayName} (${eqEff.name}: ${eqEff.shortLabel}) on ${HERO_SPECS[selHero.heroId].name}.`
            : `Equipped ${displayName} on ${HERO_SPECS[selHero.heroId].name}.`
          showToast(
            newSetId
              ? `${baseMsg} ★ 2pc ${GEAR_SET_SPECS[newSetId].shortName}: ${GEAR_SET_SPECS[newSetId].perkName}!`
              : baseMsg
          )
          if (!wasOnSel) startEquipFanfare(selHero, item.equipId)
        }
      }

      if (inspectedArmoryEquipUid && selHero) {
        const inspectedItem = getEquipmentByUid(camp, inspectedArmoryEquipUid)
        if (inspectedItem && canHeroEquipItem(selHero.heroId, inspectedItem.equipId)) {
          confirmInspectedArmoryEquip = () => {
            audio.unlock()
            equipArmoryItem(inspectedItem)
          }
        }
      }

      const squadHeroes = camp.squadUids
        .map(uid => getHeroByUid(camp, uid))
        .filter((hero): hero is OwnedHeroCard => Boolean(hero))
      const slotMatched: OwnedEquipCard[] = camp.equipment.filter(
        e => armorySlotFilter === 'all' || e.slot === armorySlotFilter
      )
      const compatibleCount = selHero
        ? slotMatched.filter(e => canHeroEquipItem(selHero.heroId, e.equipId)).length
        : slotMatched.length
      const filtered: OwnedEquipCard[] = (
        armoryCompatibleFilter === 'compatible' && selHero
          ? slotMatched.filter(e => canHeroEquipItem(selHero.heroId, e.equipId))
          : slotMatched.slice()
      ).sort((a, b) => {
        if (selHero) {
          const aCompat = canHeroEquipItem(selHero.heroId, a.equipId) ? 0 : 1
          const bCompat = canHeroEquipItem(selHero.heroId, b.equipId) ? 0 : 1
          if (aCompat !== bCompat) return aCompat - bCompat
          const aOn = findEquipOwner(camp, a.uid)?.uid === selHero.uid ? 0 : 1
          const bOn = findEquipOwner(camp, b.uid)?.uid === selHero.uid ? 0 : 1
          if (aOn !== bOn) return aOn - bOn
        }
        const aSpec = EQUIPMENT_BY_ID[a.equipId]
        const bSpec = EQUIPMENT_BY_ID[b.equipId]
        const aRank = aSpec ? RARITY_ORDER.indexOf(aSpec.rarity) : -1
        const bRank = bSpec ? RARITY_ORDER.indexOf(bSpec.rarity) : -1
        if (bRank !== aRank) return bRank - aRank
        return a.equipId.localeCompare(b.equipId)
      })
      const cols = mobile ? 1 : 2
      const rowsPerPage = mobile ? 3 : shortH ? 2 : 3
      const perPage = cols * rowsPerPage
      const maxPage = Math.max(0, Math.ceil(filtered.length / perPage) - 1)
      armoryPage = Math.min(armoryPage, maxPage)
      const shown = filtered.slice(armoryPage * perPage, armoryPage * perPage + perPage)

      armoryEquipIdByWidget.clear()
      const itemRows: LayoutNode[] = []
      const cardH = shortH ? (activeArmoryDiff ? 38 : 42) : mobile ? 46 : 44
      for (let i = 0; i < shown.length; i += cols) {
        const slice = shown.slice(i, i + cols)
        const cards: LayoutNode[] = slice.map((item, j) => {
          const widgetId = `arm-equip-${i + j}`
          armoryEquipIdByWidget.set(widgetId, item.uid)
          const spec = EQUIPMENT_BY_ID[item.equipId]
          const meta = spec ? RARITY_META[spec.rarity] : RARITY_META.common
          const displayName = spec ? formatEquipDisplayName(spec, item.upgradeLevel) : item.equipId
          const salvageYield = spec
            ? getUpgradedEquipSalvageYield(spec, item.upgradeLevel)
            : { gold: meta.salvage, dust: 0 }
          const owner = findEquipOwner(camp, item.uid)
          const equippedOnSel = owner?.uid === selHero?.uid
          const isInspected = inspectedArmoryEquipUid === item.uid
          const compatible = selHero ? canHeroEquipItem(selHero.heroId, item.equipId) : true
          const shortLockLabel = !compatible ? getEquipShortLockLabel(item.equipId) : undefined
          const ownerLabel = owner ? HERO_SPECS[owner.heroId].name : 'Bag'
          return row({ id: `arm-card-${i + j}`, style: { grow: 1, gap: mobile ? 5 : 6 } }, [
            boxNode({
              id: widgetId, style: { grow: 1, height: cardH },
              widget: {
                type: 'button',
                label: compatible
                  ? displayName
                  : `${displayName} (${shortLockLabel ?? 'Locked'})`,
                disabled: !compatible,
                selected: compatible && (equippedOnSel || isInspected),
                onPress: () => {
                  audio.unlock()
                  if (!selHero || !compatible) return
                  if (equippedOnSel) {
                    inspectedArmoryEquipUid = item.uid
                    uiDirty = true
                    return
                  }
                  if (lastPointerType === 'touch' && !isInspected) {
                    inspectedArmoryEquipUid = item.uid
                    uiDirty = true
                    return
                  }
                  equipArmoryItem(item)
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEquipCard(ctx, rect, {
                  slot: item.slot,
                  spec,
                  effect: spec ? getEquipEffect(spec.id) ?? undefined : undefined,
                  ownerText: equippedOnSel ? undefined : ownerLabel,
                  equippedOnSelected: equippedOnSel,
                  upgradeLevel: item.upgradeLevel,
                  locked: Boolean(item.locked),
                  incompatible: !compatible,
                  incompatibleLabel: shortLockLabel
                }, st)
              }
            }),
            boxNode({
              id: `arm-lock-${i + j}`, style: { width: mobile ? 36 : 40, height: cardH },
              widget: {
                type: 'button',
                label: item.locked ? `Unlock ${displayName}` : `Lock ${displayName}`,
                selected: Boolean(item.locked),
                onPress: () => {
                  audio.unlock()
                  if (toggleEquipLock(state, item.uid)) {
                    saveNow()
                    showToast(item.locked ? `Locked ${displayName}.` : `Unlocked ${displayName}.`)
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(
                  ctx, rect, item.locked ? 'lock' : 'unlock', st, { active: Boolean(item.locked) }
                )
              }
            }),
            boxNode({
              id: `arm-sell-${i + j}`, style: { width: mobile ? 58 : 74, height: cardH },
              widget: {
                type: 'button',
                label: item.locked
                  ? 'Locked'
                  : `Salvage +${salvageYield.gold}g +${salvageYield.dust} Dust`,
                disabled: Boolean(item.locked),
                onPress: () => {
                  audio.unlock()
                  const dustYield = salvageYield.dust
                  const g = salvageEquipCard(state, item.uid)
                  if (g > 0) {
                    if (hoveredArmoryEquipUid === item.uid) hoveredArmoryEquipUid = null
                    if (inspectedArmoryEquipUid === item.uid) inspectedArmoryEquipUid = null
                    saveNow()
                    showToast(`Salvaged ${displayName} for +${g}g & +${dustYield} Arcane Dust.`)
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, item.locked ? 'Locked' : `+${salvageYield.gold}g`, st,
                  item.locked
                    ? { variant: 'secondary', icon: 'lock', size: 10 }
                    : {
                        variant: 'danger',
                        sub: `+${salvageYield.dust} Dust`,
                        size: mobile ? 10 : 10.5
                      }
                )
              }
            })
          ])
        })
        while (cards.length < cols) cards.push(spacerNode(1))
        itemRows.push(row({ id: `arm-row-${i}`, style: { height: cardH, gap: 8 } }, cards))
      }

      if (itemRows.length === 0) {
        const emptyMsg = armoryCompatibleFilter === 'compatible' && selHero
          ? `No compatible ${getHeroEquipFamilyMeta(selHero.heroId).shortLabel} gear in this slot. Switch to All Gear or Forge.`
          : 'No equipment in this slot yet. Win battles or open Card Decks.'
        itemRows.push(boxNode({
          id: 'arm-empty', style: { height: 76 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEmptyNote(ctx, rect, emptyMsg)
          }
        }))
      }

      const armBestCount = selHero ? findBestFitUpgrades(camp, selHero.uid).length : 0
      const armBestLabel = armBestCount > 0 ? `Best Fit (+${armBestCount})` : 'Best Fit'
      const armPortrait = heroCardPortrait(selHero)
      const selHeroFamily = selHero ? getHeroEquipFamily(selHero.heroId) : 'universal'
      const armHeroPortraitNode = boxNode({
        id: 'arm-sel-portrait',
        style: { width: shortH ? 32 : 34, height: shortH ? 32 : 34 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPortraitTile(
            ctx, rect.x, rect.y, Math.min(rect.width, rect.height), armPortrait, {
              ring: selHero ? RARITY_META[HERO_SPECS[selHero.heroId].rarity].hex : COLOR.accent,
              ringW: 2,
              r: 8
            }
          )
        }
      })
      const armHeroStrip = row({
        id: 'arm-hero-strip',
        style: { grow: mobile ? 1 : 1.15, height: shortH ? 32 : 34, padding: 3, gap: 4 },
        widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSegmentTrack(ctx, rect) }
      }, squadHeroes.map((hero, idx) => {
        const label = HERO_SPECS[hero.heroId].name.split(' ').pop() ?? HERO_SPECS[hero.heroId].name
        return boxNode({
          id: `arm-h-${idx}`, style: { grow: 1, height: shortH ? 26 : 28 },
          widget: {
            type: 'button',
            label,
            selected: selHero?.uid === hero.uid,
            onPress: () => { camp.selectedCampHeroUid = hero.uid; armoryPage = 0; clearArmoryHover(true); uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, label, st)
          }
        })
      }))
      const narrowPhone = w < 430
      const shortSlotTabs = narrowPhone || shortH
      const armFilterStrip = row({
        id: 'arm-filters',
        style: { grow: 1, height: shortH ? 32 : mobile ? 32 : 34, padding: 3, gap: 4 },
        widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSegmentTrack(ctx, rect) }
      }, ARMORY_FILTERS.map(slot => {
        const label = slot === 'all'
          ? 'All'
          : shortSlotTabs
            ? (slot === 'weapon' ? 'Wep' : slot === 'armor' ? 'Arm' : 'Rel')
            : slot[0].toUpperCase() + slot.slice(1)
        return boxNode({
          id: `arm-f-${slot}`, style: { grow: 1, height: shortH || mobile ? 26 : 28 },
          widget: {
            type: 'button',
            label,
            selected: armorySlotFilter === slot,
            onPress: () => { armorySlotFilter = slot; armoryPage = 0; clearArmoryHover(true); uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, label, st)
          }
        })
      }))
      const compatActive = armoryCompatibleFilter === 'compatible'
      const compatLabel = compatActive ? 'Compatible' : (mobile || shortH ? 'All Gear' : 'All Gear')
      const compactLandscapeArmory = shortH && w < 780
      const armCompatToggleBtn = boxNode({
        id: 'arm-compat-toggle',
        style: { width: mobile ? 96 : compactLandscapeArmory ? 74 : shortH ? 84 : 96, height: shortH ? 32 : mobile ? 32 : 34 },
        widget: {
          type: 'button',
          label: compatLabel,
          selected: compatActive,
          onPress: () => {
            audio.unlock()
            armoryCompatibleFilter = compatActive ? 'all' : 'compatible'
            armoryPage = 0
            clearArmoryHover(true)
            uiDirty = true
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, compatLabel, st, { variant: compatActive ? 'primary' : 'secondary', size: mobile || shortH ? 10 : 10.5 }
          )
        }
      })
      const armHeroFamilyNode = boxNode({
        id: 'arm-hero-family',
        style: mobile
          ? { grow: 1, height: 28 }
          : { width: shortH ? 96 : 112, height: shortH ? 32 : 34 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEquipFamilyPill(ctx, rect, selHeroFamily, {
            prefix: mobile ? 'Gear: ' : undefined,
            countText: mobile ? `${compatibleCount}/${slotMatched.length}` : undefined,
            compact: isPhone
          })
        }
      })
      const armBestBtn = boxNode({
        id: 'cs-auto-equip', style: { width: mobile ? (armBestCount > 0 ? 94 : 74) : compactLandscapeArmory ? (armBestCount > 0 ? 84 : 68) : shortH ? (armBestCount > 0 ? 96 : 74) : (armBestCount > 0 ? 114 : 88), height: shortH ? 32 : 34 },
        widget: {
          type: 'button',
          label: armBestLabel,
          disabled: !selHero || armBestCount === 0,
          onPress: () => {
            audio.unlock()
            if (selHero) {
              clearArmoryHover(true)
              runBestFit(selHero.uid)
            }
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, armBestLabel, st, { variant: armBestCount > 0 ? 'success' : 'secondary', icon: 'sparkle', size: mobile || shortH ? 10 : 11 }
          )
        }
      })
      const bulkPreview = previewBulkSalvageCommonDupes(camp)
      const bulkLabel = bulkPreview.count > 0
        ? mobile || shortH
          ? `Salvage ${bulkPreview.count} (+${bulkPreview.totalGold}g)`
          : `Salvage ${bulkPreview.count} (+${bulkPreview.totalGold}g +${bulkPreview.totalDust} Dust)`
        : mobile || shortH
          ? 'Salvage Dupes'
          : 'Salvage Common Dupes'
      const armBulkSalvageBtn = boxNode({
        id: 'cs-bulk-salvage',
        style: {
          width: mobile
            ? (bulkPreview.count > 0 ? 148 : 114)
            : compactLandscapeArmory
              ? (bulkPreview.count > 0 ? 104 : 88)
              : shortH
                ? (bulkPreview.count > 0 ? 132 : 104)
                : wide
                  ? (bulkPreview.count > 0 ? 210 : 156)
                  : (bulkPreview.count > 0 ? 182 : 138),
          height: mobile ? 28 : shortH ? 32 : 34
        },
        widget: {
          type: 'button',
          label: bulkLabel,
          disabled: bulkPreview.count === 0,
          onPress: () => {
            audio.unlock()
            const res = bulkSalvageCommonDupes(state)
            if (res.salvagedCount > 0) {
              if (hoveredArmoryEquipUid && !getEquipmentByUid(state.campaign, hoveredArmoryEquipUid)) {
                hoveredArmoryEquipUid = null
              }
              if (inspectedArmoryEquipUid && !getEquipmentByUid(state.campaign, inspectedArmoryEquipUid)) {
                inspectedArmoryEquipUid = null
              }
              saveNow()
              showToast(
                res.totalDust > 0
                  ? `Salvaged ${res.salvagedCount} common ${res.salvagedCount === 1 ? 'dupe' : 'dupes'} for +${res.totalGold}g & +${res.totalDust} Arcane Dust.`
                  : `Salvaged ${res.salvagedCount} common ${res.salvagedCount === 1 ? 'dupe' : 'dupes'} for +${res.totalGold}g.`
              )
            }
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, bulkLabel, st, { variant: bulkPreview.count > 0 ? 'danger' : 'secondary', icon: 'sell', size: mobile || shortH ? 9.5 : 10.5 }
          )
        }
      })

      const armHeroStats = selHero ? computeHeroStats(camp, selHero) : null
      const liveDiff = activeArmoryDiff && activeArmoryDiff.compatible && !activeArmoryDiff.isAlreadyEquipped ? activeArmoryDiff : null
      const armStatItems: StatStripItem[] = armHeroStats
        ? [
            {
              icon: 'heart', label: 'HP', value: `${armHeroStats.maxHp}`, color: COLOR.good,
              delta: liveDiff?.stats.maxHp.delta,
              deltaText: liveDiff && liveDiff.stats.maxHp.delta !== 0 ? formatCompactStatDelta(liveDiff.stats.maxHp.delta) : undefined
            },
            {
              icon: 'sword', label: 'ATK', value: `${armHeroStats.atk}`, color: '#ffb36b',
              delta: liveDiff?.stats.atk.delta,
              deltaText: liveDiff && liveDiff.stats.atk.delta !== 0 ? formatCompactStatDelta(liveDiff.stats.atk.delta) : undefined
            },
            {
              icon: 'shield', label: 'DEF', value: `${armHeroStats.def}`, color: '#8fc8ff',
              delta: liveDiff?.stats.def.delta,
              deltaText: liveDiff && liveDiff.stats.def.delta !== 0 ? formatCompactStatDelta(liveDiff.stats.def.delta) : undefined
            },
            {
              icon: 'bolt', label: 'SPD', value: `${armHeroStats.speed}`, color: '#ffe27a',
              delta: liveDiff?.stats.speed.delta,
              deltaText: liveDiff && liveDiff.stats.speed.delta !== 0 ? formatCompactStatDelta(liveDiff.stats.speed.delta) : undefined
            },
            {
              icon: 'boot', label: 'MOV', value: `${armHeroStats.move}`, color: '#c4b5ff',
              delta: liveDiff?.stats.move.delta,
              deltaText: liveDiff && liveDiff.stats.move.delta !== 0 ? formatCompactStatDelta(liveDiff.stats.move.delta) : undefined
            },
            {
              icon: 'target', label: 'RNG', value: `${armHeroStats.range}`, color: '#6dd9ff',
              delta: liveDiff?.stats.range.delta,
              deltaText: liveDiff && liveDiff.stats.range.delta !== 0 ? formatCompactStatDelta(liveDiff.stats.range.delta) : undefined
            },
            {
              icon: 'crit', label: 'CRIT', value: `${Math.round(armHeroStats.crit * 100)}%`, color: '#ff8da1',
              delta: liveDiff?.stats.crit.delta,
              deltaText: liveDiff && liveDiff.stats.crit.delta !== 0 ? formatCompactStatDelta(liveDiff.stats.crit.delta, true) : undefined
            }
          ]
        : []
      const armHeroStatsNode = armStatItems.length > 0
        ? [boxNode({
            id: 'arm-hero-stats',
            style: { height: shortH ? 28 : mobile ? 30 : 34 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawStatStrip(ctx, rect, armStatItems)
            }
          })]
        : []

      const selHeroGearSets = selHero ? getHeroGearSetProgress(camp, selHero) : []
      const armGearSetNode = selHeroGearSets.length > 0
        ? [boxNode({
            id: 'arm-gear-sets',
            style: { height: shortH ? 20 : mobile ? 22 : 24 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawGearSetBanner(ctx, rect, selHeroGearSets, mobile || shortH)
            }
          })]
        : []

      const hideArmorySubBarsForShortDiff = Boolean(shortH && activeArmoryDiff)
      const bulkSalvageNodes: LayoutNode[] = bulkSalvageUnlocked ? [armBulkSalvageBtn] : []
      bodyNode = column({ id: 'camp-armory-body', style: { grow: 1, gap: shortH ? 4 : mobile ? 5 : 6 } }, [
        ...(mobile
          ? [
              row({ id: 'arm-top-m1', style: { height: 34, gap: 5, align: 'center' } }, [armHeroPortraitNode, armHeroStrip, armBestBtn]),
              row({ id: 'arm-top-m2', style: { height: 32, gap: 5, align: 'center' } }, [armFilterStrip, armCompatToggleBtn]),
              row({ id: 'arm-top-m3', style: { height: 28, gap: 5, align: 'center' } }, [armHeroFamilyNode, ...bulkSalvageNodes])
            ]
          : compactLandscapeArmory
            ? [
                row({ id: 'arm-top-controls', style: { height: 32, gap: 4, align: 'center' } }, [armHeroStrip, armFilterStrip, armCompatToggleBtn, armBestBtn, ...bulkSalvageNodes])
              ]
            : [
                row({ id: 'arm-top-controls', style: { height: shortH ? 32 : 34, gap: shortH ? 5 : 6, align: 'center' } }, [armHeroPortraitNode, armHeroStrip, armHeroFamilyNode, armFilterStrip, armCompatToggleBtn, armBestBtn, ...bulkSalvageNodes])
              ]),
        ...(hideArmorySubBarsForShortDiff ? [] : armHeroStatsNode),
        ...(hideArmorySubBarsForShortDiff ? [] : armGearSetNode),
        ...itemRows,
        spacerNode(1),
        row({ id: 'arm-pager', hidden: maxPage === 0, style: { height: 28, gap: 8, align: 'center' } }, [
          boxNode({
            id: 'arm-prev', style: { width: 88, height: 28 },
            widget: {
              type: 'button', label: 'Prev', disabled: armoryPage <= 0,
              onPress: () => { armoryPage--; clearArmoryHover(true); uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Prev', st, { variant: 'secondary', size: 11 })
            }
          }),
          boxNode({
            id: 'arm-pg', style: { width: 58, height: 28 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(ctx, rect, `${armoryPage + 1} / ${maxPage + 1}`, { size: 11, color: COLOR.muted, align: 'center' })
            }
          }),
          boxNode({
            id: 'arm-next', style: { width: 88, height: 28 },
            widget: {
              type: 'button', label: 'Next', disabled: armoryPage >= maxPage,
              onPress: () => { armoryPage++; clearArmoryHover(true); uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Next', st, { variant: 'secondary', size: 11 })
            }
          }),
          spacerNode(1),
          boxNode({
            id: 'arm-count', style: { width: 120, height: 28 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(ctx, rect, `${filtered.length} items`, { size: 11, color: COLOR.muted, align: 'right' })
            }
          })
        ])
      ])
    } else if (campTab === 'deck') {
      // Curated Tactic Deck Builder (6..12 active battle cards)
      const activeUids = getActiveTacticDeckUids(camp)
      const activeSet = new Set<string>(activeUids)
      const curve = computeTacticDeckCurve(camp)
      const sortedTactics = camp.tactics.slice().sort((a, b) => {
        const aIn = activeSet.has(a.uid) ? 0 : 1
        const bIn = activeSet.has(b.uid) ? 0 : 1
        if (aIn !== bIn) return aIn - bIn
        const sa = TACTIC_BY_ID[a.tacticId]
        const sb = TACTIC_BY_ID[b.tacticId]
        const ra = sa ? RARITY_ORDER.indexOf(sa.rarity) : 0
        const rb = sb ? RARITY_ORDER.indexOf(sb.rarity) : 0
        if (rb !== ra) return rb - ra
        const ca = sa?.cost ?? 1
        const cb = sb?.cost ?? 1
        if (ca !== cb) return ca - cb
        return a.tacticId.localeCompare(b.tacticId)
      })
      const cols = mobile ? 1 : 2
      const rowsPerPage = mobile ? 4 : shortH ? 2 : 3
      const perPage = cols * rowsPerPage
      const maxPage = Math.max(0, Math.ceil(sortedTactics.length / perPage) - 1)
      deckPage = Math.min(deckPage, maxPage)
      const shown = sortedTactics.slice(deckPage * perPage, deckPage * perPage + perPage)
      const cardH = shortH ? 46 : 52

      const deckRows: LayoutNode[] = []
      for (let i = 0; i < shown.length; i += cols) {
        const slice = shown.slice(i, i + cols)
        const cards: LayoutNode[] = slice.map((item, j) => {
          const spec = TACTIC_BY_ID[item.tacticId]
          const inDeck = activeSet.has(item.uid)
          return boxNode({
            id: `deck-card-${i + j}`,
            style: { grow: 1, height: cardH },
            widget: {
              type: 'button',
              label: spec ? `${spec.name} (${inDeck ? 'In Deck' : 'Bench'})` : item.tacticId,
              selected: inDeck,
              onPress: () => {
                audio.unlock()
                if (toggleTacticInDeck(state, item.uid)) {
                  saveNow()
                  const nowIn = getActiveTacticDeckUids(camp).includes(item.uid)
                  showToast(`${nowIn ? 'Added' : 'Benched'} ${spec?.name ?? 'tactic'} (${getActiveTacticDeckUids(camp).length}/${MAX_TACTIC_DECK}).`)
                  uiDirty = true
                } else if (inDeck) {
                  showToast(`Deck needs at least ${Math.min(MIN_TACTIC_DECK, camp.tactics.length)} tactic cards.`)
                } else {
                  showToast(`Battle deck is full (${MAX_TACTIC_DECK}/${MAX_TACTIC_DECK}). Bench a card first.`)
                }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => {
                if (spec) drawTacticDeckCard(ctx, rect, { spec, inDeck }, st)
              }
            }
          })
        })
        while (cards.length < cols) cards.push(spacerNode(1))
        deckRows.push(row({ id: `deck-row-${i}`, style: { height: cardH, gap: 8 } }, cards))
      }

      if (deckRows.length === 0) {
        deckRows.push(boxNode({
          id: 'deck-empty', style: { height: 76 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEmptyNote(ctx, rect, 'No tactic cards owned yet. Open Card Decks to collect tactics.')
          }
        }))
      }

      bodyNode = column({ id: 'camp-deck-body', style: { grow: 1, gap: 8 } }, [
        row({ id: 'deck-top-bar', style: { height: 34, gap: 8, align: 'center' } }, [
          boxNode({
            id: 'deck-header', style: { grow: 1, height: 34 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawTacticDeckHeader(ctx, rect, curve, camp.tactics.length)
            }
          }),
          boxNode({
            id: 'cs-deck-autobuild', style: { width: mobile ? 104 : 122, height: 34 },
            widget: {
              type: 'button',
              label: 'Auto-Build',
              disabled: camp.tactics.length === 0,
              onPress: () => {
                audio.unlock()
                const built = autoBuildTacticDeck(state)
                saveNow()
                showToast(`Auto-built balanced ${built.length}-card Tactic Deck!`)
                uiDirty = true
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Auto-Build', st, { variant: 'success', icon: 'sparkle', size: 11 }
              )
            }
          })
        ]),
        ...deckRows,
        spacerNode(1),
        row({ id: 'deck-pager', hidden: maxPage === 0, style: { height: 28, gap: 8, align: 'center' } }, [
          boxNode({
            id: 'deck-prev', style: { width: 88, height: 28 },
            widget: {
              type: 'button', label: 'Prev', disabled: deckPage <= 0,
              onPress: () => { deckPage--; uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Prev', st, { variant: 'secondary', size: 11 })
            }
          }),
          boxNode({
            id: 'deck-pg', style: { width: 58, height: 28 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(ctx, rect, `${deckPage + 1} / ${maxPage + 1}`, { size: 11, color: COLOR.muted, align: 'center' })
            }
          }),
          boxNode({
            id: 'deck-next', style: { width: 88, height: 28 },
            widget: {
              type: 'button', label: 'Next', disabled: deckPage >= maxPage,
              onPress: () => { deckPage++; uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Next', st, { variant: 'secondary', size: 11 })
            }
          }),
          spacerNode(1),
          boxNode({
            id: 'deck-hint', style: { width: mobile ? 140 : 240, height: 28 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                ctx,
                rect,
                uiCopy(vp.isTouchPrimary, 'Click cards to toggle In Deck / Bench (8–12 ideal)', 'Tap cards to toggle In Deck / Bench (8–12 ideal)'),
                { size: 10.5, color: COLOR.muted, align: 'right' }
              )
            }
          })
        ])
      ])
    } else if (campTab === 'forge') {
      // Armory Forge: craft targeted Heroes (Hero Shards) & Weapons / Armor / Relics (Arcane Dust)
      const cols = mobile ? 1 : 2
      const rowsPerPage = mobile ? 4 : shortH ? 2 : 3
      const perPage = cols * rowsPerPage
      const cardH = shortH ? 46 : 52

      const isHeroes = forgeCategory === 'heroes'
      const heroRecipes = isHeroes ? getCraftableHeroes() : []
      const equipRecipes = forgeCategory === 'heroes' ? [] : getCraftableEquipment(forgeCategory)
      const totalItems = isHeroes ? heroRecipes.length : equipRecipes.length
      const maxPage = Math.max(0, Math.ceil(totalItems / perPage) - 1)
      forgePage = Math.min(forgePage, maxPage)

      const recipeRows: LayoutNode[] = []
      if (isHeroes) {
        const shown = heroRecipes.slice(forgePage * perPage, forgePage * perPage + perPage)
        for (let i = 0; i < shown.length; i += cols) {
          const slice = shown.slice(i, i + cols)
          const cards: LayoutNode[] = slice.map((spec, j) => {
            const cost = getHeroCraftCost(spec.id)
            const affordable = canCraftHero(camp, spec.id)
            const ownedCount = camp.heroes.filter(h => h.heroId === spec.id).length
            const maxed = hasMaxedHero(camp, spec.id)
            return row({ id: `forge-h-row-${i + j}`, style: { grow: 1, gap: 6 } }, [
              boxNode({
                id: `forge-h-card-${i + j}`, style: { grow: 1, height: cardH },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawForgeRecipeCard(ctx, rect, {
                    kind: 'hero',
                    rarity: spec.rarity,
                    name: `${spec.name} (${spec.title})`,
                    subtitle: `HP ${spec.maxHp} · ATK ${spec.atk} · DEF ${spec.def} · SPD ${spec.speed}`,
                    refId: spec.id,
                    portrait: portraits[spec.id],
                    ownedCount,
                    maxed,
                    cost,
                    currency: 'shards',
                    affordable,
                    equipFamily: getHeroEquipFamily(spec.id)
                  })
                }
              }),
              boxNode({
                id: `cs-forge-hero-${spec.id}`, style: { width: 88, height: cardH },
                widget: {
                  type: 'button',
                  label: `Craft ${spec.name} (${cost} Shards)`,
                  disabled: !affordable,
                  onPress: () => {
                    audio.unlock()
                    const crafted = craftHero(state, spec.id)
                    if (crafted) {
                      saveNow()
                      showToast(`Forged ${spec.name} (${spec.title}) for ${cost} Hero Shards!`)
                      uiDirty = true
                    }
                  },
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                    ctx, rect, 'Craft', st, {
                      variant: affordable ? 'primary' : 'secondary',
                      icon: 'gem',
                      sub: `${cost} Shards`,
                      size: 11
                    }
                  )
                }
              })
            ])
          })
          while (cards.length < cols) cards.push(spacerNode(1))
          recipeRows.push(row({ id: `forge-row-${i}`, style: { height: cardH, gap: 8 } }, cards))
        }
      } else {
        const shown = equipRecipes.slice(forgePage * perPage, forgePage * perPage + perPage)
        for (let i = 0; i < shown.length; i += cols) {
          const slice = shown.slice(i, i + cols)
          const cards: LayoutNode[] = slice.map((spec, j) => {
            const cost = getEquipCraftCost(spec.id)
            const affordable = canCraftEquipment(camp, spec.id)
            const ownedCount = camp.equipment.filter(e => e.equipId === spec.id).length
            return row({ id: `forge-e-row-${i + j}`, style: { grow: 1, gap: 6 } }, [
              boxNode({
                id: `forge-e-card-${i + j}`, style: { grow: 1, height: cardH },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawForgeRecipeCard(ctx, rect, {
                    kind: spec.slot,
                    rarity: spec.rarity,
                    name: spec.name,
                    subtitle: spec.desc,
                    refId: spec.id,
                    accentHex: spec.accentHex,
                    ownedCount,
                    cost,
                    currency: 'dust',
                    affordable,
                    equipFamily: getEquipFamily(spec.id)
                  })
                }
              }),
              boxNode({
                id: `cs-forge-equip-${spec.id}`, style: { width: 88, height: cardH },
                widget: {
                  type: 'button',
                  label: `Craft ${spec.name} (${cost} Dust)`,
                  disabled: !affordable,
                  onPress: () => {
                    audio.unlock()
                    const crafted = craftEquipment(state, spec.id)
                    if (crafted) {
                      saveNow()
                      showToast(`Forged ${spec.name} for ${cost} Arcane Dust!`)
                      uiDirty = true
                    }
                  },
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                    ctx, rect, 'Craft', st, {
                      variant: affordable ? 'primary' : 'secondary',
                      icon: 'sparkle',
                      sub: `${cost} Dust`,
                      size: 11
                    }
                  )
                }
              })
            ])
          })
          while (cards.length < cols) cards.push(spacerNode(1))
          recipeRows.push(row({ id: `forge-row-${i}`, style: { height: cardH, gap: 8 } }, cards))
        }
      }

      const forgeBalanceNode = boxNode({
        id: 'forge-balances',
        style: mobile ? { height: 34 } : { grow: 1.15, height: 34 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawForgeBalanceBanner(ctx, rect, camp.dust, camp.shards, mobile)
        }
      })

      const forgeCatStrip = row({
        id: 'forge-cats',
        style: mobile ? { height: 34, padding: 3, gap: 4 } : { grow: 1, height: 34, padding: 3, gap: 4 },
        widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSegmentTrack(ctx, rect) }
      }, FORGE_CATEGORIES.map(cat => {
        const label = cat === 'heroes' ? 'Heroes' : cat === 'weapon' ? 'Weapons' : cat === 'armor' ? 'Armor' : 'Relics'
        return boxNode({
          id: `forge-cat-${cat}`, style: { grow: 1, height: 28 },
          widget: {
            type: 'button',
            label,
            selected: forgeCategory === cat,
            onPress: () => { forgeCategory = cat; forgePage = 0; uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, label, st)
          }
        })
      }))

      bodyNode = column({ id: 'camp-forge-body', style: { grow: 1, gap: 8 } }, [
        ...(mobile
          ? [forgeBalanceNode, forgeCatStrip]
          : [row({ id: 'forge-top-controls', style: { height: 34, gap: 8, align: 'center' } }, [forgeBalanceNode, forgeCatStrip])]),
        ...recipeRows,
        spacerNode(1),
        row({ id: 'forge-pager', hidden: maxPage === 0, style: { height: 28, gap: 8, align: 'center' } }, [
          boxNode({
            id: 'forge-prev', style: { width: 88, height: 28 },
            widget: {
              type: 'button', label: 'Prev', disabled: forgePage <= 0,
              onPress: () => { forgePage--; uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Prev', st, { variant: 'secondary', size: 11 })
            }
          }),
          boxNode({
            id: 'forge-pg', style: { width: 58, height: 28 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(ctx, rect, `${forgePage + 1} / ${maxPage + 1}`, { size: 11, color: COLOR.muted, align: 'center' })
            }
          }),
          boxNode({
            id: 'forge-next', style: { width: 88, height: 28 },
            widget: {
              type: 'button', label: 'Next', disabled: forgePage >= maxPage,
              onPress: () => { forgePage++; uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(ctx, rect, 'Next', st, { variant: 'secondary', size: 11 })
            }
          }),
          spacerNode(1),
          boxNode({
            id: 'forge-count', style: { width: 140, height: 28 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                ctx, rect, `${totalItems} recipes · ${isHeroes ? `${camp.shards} Shards` : `${camp.dust} Dust`}`,
                { size: 11, color: COLOR.muted, align: 'right' }
              )
            }
          })
        ])
      ])
    } else {
      // Booster Card Decks, Pity Counter & Pack Reveal
      const hasReveal = camp.lastPackReveal.length > 0 && !packAnim
      const pity = getPackPityStatus(camp)
      const pityH = hasReveal ? (shortH ? 32 : 38) : (shortH ? 36 : 42)
      const packH = hasReveal ? (shortH ? 48 : 56) : (shortH ? 116 : mobile ? 136 : 158)
      const packCards: LayoutNode[] = PACK_LIST.map(pack => {
        const affordable = canBuyPack(camp, pack.id)
        return boxNode({
          id: `cs-buy-${pack.id}`,
          style: { grow: 1, height: packH },
          widget: {
            type: 'button',
            label: `${pack.name} (${pack.cost}g)`,
            disabled: !affordable,
            onPress: () => {
              audio.unlock()
              const pulled = buyPack(state, pack.id)
              if (pulled) {
                saveNow()
                startPackCeremony(pack.id, pulled)
                const totalShards = pulled.reduce((acc, c) => acc + (c.convertedShards ?? 0), 0)
                const shardMsg = totalShards > 0 ? ` (+${totalShards} excess Shards)` : ''
                showToast(`Opened ${pack.name} - ${pulled.length} cards unsealed${shardMsg}.`)
                uiDirty = true
              }
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawBoosterPack(ctx, rect, pack, st, camp.gold)
          }
        })
      })

      const pityBannerNode = boxNode({
        id: 'cs-pity-banner',
        style: { height: pityH },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPityBanner(ctx, rect, pity, mobile)
        }
      })

      const revealH = shortH ? 124 : mobile ? 156 : 152
      const revealSection: LayoutNode[] = hasReveal
        ? [
            row({ id: 'rev-row', style: { height: revealH, gap: 10 } }, camp.lastPackReveal.map((card, idx) => {
              const cardPortrait = card.kind === 'hero' ? portraits[card.refId] : undefined
              const tacticSpec = card.kind === 'tactic' ? TACTIC_BY_ID[card.refId] : undefined
              const equipSpec = (card.kind === 'weapon' || card.kind === 'armor' || card.kind === 'relic')
                ? EQUIPMENT_BY_ID[card.refId]
                : undefined
              return boxNode({
                id: `rev-card-${idx}`,
                style: { grow: 1, height: revealH },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRevealCard(ctx, rect, {
                    rarity: card.rarity,
                    kind: card.kind,
                    refId: card.refId,
                    name: card.name,
                    detail: card.detail,
                    value: card.value,
                    isNew: card.isNew,
                    convertedShards: card.convertedShards,
                    pityTriggered: card.pityTriggered,
                    portrait: cardPortrait,
                    tacticSpec,
                    equipAccent: equipSpec?.accentHex
                  })
                }
              })
            }))
          ]
        : [
            boxNode({
              id: 'dk-odds', style: { height: 20 },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                  ctx,
                  rect,
                  `Duplicate Protection active · Unowned Rare+ prioritized · 3★ dupes → Hero Shards · Packs: ${camp.packsOpened}`,
                  { size: 10, color: COLOR.muted, align: 'center' }
                )
              }
            })
          ]

      bodyNode = column({ id: 'camp-decks-body', style: { grow: 1, gap: 8 } }, [
        pityBannerNode,
        row({ id: 'dk-packs', style: { height: packH, gap: 10 } }, packCards),
        ...revealSection
      ])
    }

    const selectedStage = getSelectedStage()
    const battleLabel = pendingEndless > 0
      ? `Endless Wave ${pendingEndless}`
      : selectedStage.title
    const chapterSub = pendingEndless > 0 ? 'Arena' : `Diff ${DIFFICULTY_META[selectedStage.difficulty].short} · ${selectedStage.subtitle}`
    const packOverlayNodes: LayoutNode[] = packAnim ? [buildPackCeremonyOverlay(w, h, packAnim)] : []
    const activeFanfare = fanfare
    if (activeFanfare) {
      packOverlayNodes.push(boxNode({
        id: 'cs-fanfare',
        style: { anchor: 'fill' },
        widget: {
          type: 'button',
          label: 'Continue',
          onPress: () => dismissFanfare(),
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawFanfare(ctx, rect, activeFanfare)
        }
      }))
    }

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      // Subtle top fade for crisp readability over the 3D sky
      boxNode({
        id: 'camp-top-fade',
        style: { anchor: 'top', width: w, height: 84 },
        widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawTopFade(ctx, rect, 0.58) }
      }),

      // Floating Top Bar (leaves the center 3D campfire diorama wide open!)
      row({
        id: 'camp-top',
        style: { anchor: 'top', width: sheetW, height: shortH ? 38 : 48, inset: shortH ? [6, 6] : [12, 10], gap: 8, align: 'center', respectSafeArea: true }
      }, [
        boxNode({
          id: 'cp-title',
          style: { grow: 1, height: shortH ? 36 : 42 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawCampHeader(
              ctx,
              rect,
              camp.gold,
              deckValue,
              isPhone,
              showSecondaryCurrencies ? { dust: camp.dust, shards: camp.shards } : undefined
            )
          }
        }),
        ...(codexUnlocked ? [boxNode({
          id: 'cs-camp-codex',
          style: { width: isPhone ? 66 : mobile ? 84 : 104, height: shortH ? 34 : 38 },
          widget: {
            type: 'button',
            label: 'Codex',
            onPress: () => { audio.unlock(); openCodex() },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, 'Codex', st, { variant: 'secondary', icon: 'scroll', trailing: !vp.showKeycaps || isPhone ? undefined : 'C', size: isPhone ? 11.5 : 12.5 }
            )
          }
        })] : []),
        // World Map + Quick Deploy bar
        row({
          id: 'cp-chapter-bar',
          style: { width: isPhone ? 142 : mobile ? 182 : 344, height: shortH ? 36 : 42, padding: [3, 5], gap: isPhone ? 4 : 6, align: 'center' },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.lg })
          }
        }, [
          ...(mobile ? [] : [boxNode({
            id: 'cp-ch-label', style: { grow: 1, height: 34 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawChapterPicker(ctx, rect, battleLabel, chapterSub)
            }
          })]),
          boxNode({
            id: 'cs-camp-battle', style: { width: isPhone ? 66 : mobile ? 94 : 118, height: 34 },
            widget: {
              type: 'button',
              label: 'World Map',
              primary: true,
              onPress: () => { audio.unlock(); openWorldMap() },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, mobile ? 'Map' : 'World Map', st, { variant: 'primary', icon: 'map', size: isPhone ? 11.5 : 13 }
              )
            }
          }),
          boxNode({
            id: 'cs-camp-quick-fight', style: { width: isPhone ? 60 : mobile ? 72 : 82, height: 34 },
            widget: {
              type: 'button',
              label: 'Fight',
              disabled: !isStageUnlocked(camp, selectedStage),
              onPress: () => {
                audio.unlock()
                openStory(selectedStage.index, pendingEndless)
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Fight', st, { variant: 'success', icon: 'sword', size: isPhone ? 11.5 : 12.5 }
              )
            }
          })
        ])
      ]),

      // Floating Armory Live Stat-Diff & Temper / Reforge Dock above the bottom sheet
      ...(() => {
        const diff = activeArmoryDiff
        const upPreview = activeArmoryUpgradePreview
        if (campTab !== 'armory' || !diff || collapsed || packAnim) return []
        const hasSetDelta = diff.compatible && (diff.activatedSets.length > 0 || diff.deactivatedSets.length > 0)
        const diffH = (shortH ? 42 : mobile ? 72 : 60) + (hasSetDelta ? (shortH ? 14 : 18) : 0)
        const temperGap = shortH ? 3 : 4
        const temperBtnH = shortH ? 26 : mobile ? 32 : 34
        const temperBlockH = upPreview ? (mobile ? 22 + 4 + temperBtnH : temperBtnH) : 0
        const totalDockH = diffH + (upPreview ? temperGap + temperBlockH : 0)
        if (mobile) {
          sheetH = Math.min(sheetH, Math.max(240, h - 78 - totalDockH - 16))
        } else if (shortH) {
          // Keep landscape phone (844x390) inventory sheet readable while docking diff/temper cleanly above it
          sheetH = Math.min(sheetH, Math.max(204, h - 58 - totalDockH))
        }
        const dockW = Math.min(sheetW, mobile ? sheetW : 820)
        const showTouchConfirm = Boolean(
          inspectedArmoryEquipUid && diff.compatible && !diff.isAlreadyEquipped && armorySelectedHero && confirmInspectedArmoryEquip
        )
        const confirmAction = confirmInspectedArmoryEquip
        const confirmLabel = diff.currentOwnerName ? 'Swap' : 'Equip'
        const dockInsetBottom = sheetH + (isPhone ? 10 : 16)

        const topRowNode: LayoutNode = showTouchConfirm && confirmAction
          ? row({ id: 'arm-diff-top', style: { height: diffH, gap: 6, align: 'stretch' } }, [
              boxNode({
                id: 'arm-diff-panel',
                style: { grow: 1, height: diffH },
                widget: {
                  type: 'panel',
                  blocksPointer: true,
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawArmoryStatDiffPanel(ctx, rect, diff)
                }
              }),
              column({ id: 'arm-diff-actions', style: { width: mobile ? 76 : 92, height: diffH, gap: shortH ? 2 : 4 } }, [
                boxNode({
                  id: 'arm-confirm-equip',
                  style: { grow: 1 },
                  widget: {
                    type: 'button',
                    label: confirmLabel,
                    primary: true,
                    onPress: () => confirmAction(),
                    draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                      ctx, rect, confirmLabel, st, { variant: 'success', icon: 'check', size: 11.5 }
                    )
                  }
                }),
                boxNode({
                  id: 'arm-dismiss-diff',
                  style: { height: 22 },
                  widget: {
                    type: 'button',
                    label: 'Cancel',
                    onPress: () => { clearArmoryHover(true); uiDirty = true },
                    draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                      ctx, rect, 'Cancel', st, { variant: 'secondary', size: 9.5 }
                    )
                  }
                })
              ])
            ])
          : boxNode({
              id: 'arm-diff-panel',
              style: { height: diffH },
              widget: {
                type: 'panel',
                blocksPointer: Boolean(upPreview),
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawArmoryStatDiffPanel(ctx, rect, diff)
              }
            })

        if (!upPreview) {
          return [
            column({
              id: 'arm-diff-dock',
              style: { anchor: 'bottom', width: dockW, height: totalDockH, inset: [isPhone ? 6 : 12, dockInsetBottom], gap: 0, respectSafeArea: true }
            }, [topRowNode])
          ]
        }

        const runTemperFeedback = (resName: string, methodLabel: string, goldSpent: number) => {
          inspectedArmoryEquipUid = upPreview.equipUid
          const eqOwner = findEquipOwner(state.campaign, upPreview.equipUid) ?? armorySelectedHero
          if (eqOwner) {
            scene.triggerCampEquipFlourish(eqOwner.uid, upPreview.spec.slot, COLOR.accent)
          }
          saveNow()
          showToast(`Tempered ${resName} (${methodLabel} -${goldSpent}g)!`)
        }

        const showFuseBtn = !upPreview.isMaxLevel && upPreview.eligibleDuplicateCount > 0
        const fuseShortText = mobile
          ? `Fuse +1 · ${upPreview.fuseGoldCost}g (${upPreview.eligibleDuplicateCount})`
          : shortH
            ? `Fuse +1 (${upPreview.fuseGoldCost}g · ${upPreview.eligibleDuplicateCount})`
            : `Fuse Dupe (+1) · ${upPreview.fuseGoldCost}g (${upPreview.eligibleDuplicateCount})`
        const fuseBtnNode = showFuseBtn
          ? [boxNode({
              id: 'arm-fuse-upgrade',
              style: mobile
                ? { grow: 1, height: temperBtnH }
                : { width: shortH && w < 740 ? 136 : shortH ? 156 : 196, height: temperBtnH },
              widget: {
                type: 'button',
                label: `Fuse Dupe (+1) · ${upPreview.fuseGoldCost}g (${upPreview.eligibleDuplicateCount} dupe${upPreview.eligibleDuplicateCount === 1 ? '' : 's'})`,
                disabled: !upPreview.canFuseDuplicate,
                onPress: () => {
                  audio.unlock()
                  const res = upgradeEquipWithDuplicate(state, upPreview.equipUid)
                  if (res) {
                    runTemperFeedback(res.displayName, 'Dupe Fuse', res.goldSpent)
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, fuseShortText, st, {
                    variant: upPreview.canFuseDuplicate ? 'success' : 'secondary',
                    icon: 'up',
                    size: mobile || shortH ? 9.5 : 10.5
                  }
                )
              }
            })]
          : []

        const goldLabel = upPreview.isMaxLevel
          ? `MAX +${MAX_EQUIP_UPGRADE}`
          : `Temper +${upPreview.nextLevel} (${upPreview.reforgeGoldCost}g)`
        const goldBtnNode = boxNode({
          id: 'arm-gold-upgrade',
          style: mobile
            ? { grow: 1, height: temperBtnH }
            : { width: shortH && w < 740 ? 124 : shortH ? 138 : 162, height: temperBtnH },
          widget: {
            type: 'button',
            label: goldLabel,
            primary: upPreview.canGoldReforge,
            disabled: upPreview.isMaxLevel || !upPreview.canGoldReforge,
            onPress: () => {
              audio.unlock()
              const res = upgradeEquipWithGold(state, upPreview.equipUid)
              if (res) {
                runTemperFeedback(res.displayName, 'Reforge', res.goldSpent)
              }
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, goldLabel, st, {
                variant: upPreview.isMaxLevel ? 'secondary' : upPreview.canGoldReforge ? 'primary' : 'secondary',
                icon: upPreview.isMaxLevel ? 'star' : 'sparkle',
                size: mobile || shortH ? 9.5 : 10.5
              }
            )
          }
        })

        const dismissBtnNodes = !showTouchConfirm && inspectedArmoryEquipUid
          ? [boxNode({
              id: 'arm-dismiss-diff',
              style: { width: mobile ? 32 : shortH ? 30 : 34, height: temperBtnH },
              widget: {
                type: 'button',
                label: 'Close',
                onPress: () => { clearArmoryHover(true); uiDirty = true },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, '×', st, { variant: 'secondary', size: 13 }
                )
              }
            })]
          : []

        const temperStripNode: LayoutNode = mobile
          ? column({ id: 'arm-temper-wrap', style: { height: temperBlockH, gap: 4 } }, [
              boxNode({
                id: 'arm-temper-panel',
                style: { height: 22 },
                widget: {
                  type: 'panel',
                  blocksPointer: true,
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawArmoryTemperBar(ctx, rect, upPreview, { compact: true })
                }
              }),
              row({ id: 'arm-temper-actions', style: { height: temperBtnH, gap: 6, align: 'center' } }, [
                ...fuseBtnNode,
                goldBtnNode,
                ...dismissBtnNodes
              ])
            ])
          : row({ id: 'arm-temper-row', style: { height: temperBtnH, gap: 6, align: 'center' } }, [
              boxNode({
                id: 'arm-temper-panel',
                style: { grow: 1, height: temperBtnH },
                widget: {
                  type: 'panel',
                  blocksPointer: true,
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawArmoryTemperBar(ctx, rect, upPreview, { compact: shortH })
                }
              }),
              ...fuseBtnNode,
              goldBtnNode,
              ...dismissBtnNodes
            ])

        return [
          column({
            id: 'arm-diff-dock',
            style: { anchor: 'bottom', width: dockW, height: totalDockH, inset: [isPhone ? 6 : 12, dockInsetBottom], gap: temperGap, respectSafeArea: true }
          }, [
            topRowNode,
            temperStripNode
          ])
        ]
      })(),

      // Floating Toast above the bottom sheet (and above Armory diff dock if visible),
      // clamped cleanly below the top Gold / Map / Fight bar on compact & phone viewports.
      ...(campToast ? (() => {
        const rawToastInsetBottom = sheetH + 18 + (campTab === 'armory' && activeArmoryDiff && !collapsed && !packAnim
          ? (shortH ? 92 : mobile ? 140 : 106) + (activeArmoryDiff.compatible && (activeArmoryDiff.activatedSets.length > 0 || activeArmoryDiff.deactivatedSets.length > 0) ? 18 : 0)
          : 0)
        const topBarBottom = (shortH ? 38 + 6 : 48 + 10) + (isPhone ? 16 : 0)
        const maxToastInsetBottom = Math.max(12, h - 32 - (topBarBottom + 6))
        const toastInsetBottom = Math.min(rawToastInsetBottom, maxToastInsetBottom)
        return [boxNode({
          id: 'camp-toast',
          style: {
            anchor: 'bottom',
            width: Math.min(sheetW - 24, 520),
            height: 32,
            inset: [8, toastInsetBottom],
            respectSafeArea: true
          },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawToast(ctx, rect, campToast)
          }
        })]
      })() : []),

      // Bottom Glass Sheet Drawer
      column({
        id: 'camp-modal',
        style: {
          anchor: 'bottom',
          width: sheetW,
          height: sheetH,
          inset: isPhone ? 6 : 12,
          padding: collapsed ? [10, 12] : shortH && campTab === 'armory' && activeArmoryDiff ? [6, 12, 6, 12] : shortH ? [10, 12, 8, 12] : [16, 14, 12, 14],
          gap: shortH && campTab === 'armory' && activeArmoryDiff ? 4 : shortH ? 6 : 10,
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSheet(ctx, rect)
        }
      }, [
        // Segmented control tab bar (+ 3D peek collapse button on phones; P2: filtered by unlocked tabs)
        row({ id: 'camp-tabs-row', style: { height: shortH ? 36 : isPhone ? 42 : 38, gap: 6, align: 'center' } }, [
          row({
            id: 'camp-tabs',
            style: { grow: 1, height: shortH ? 36 : isPhone ? 42 : 38, padding: 3, gap: 4 },
            widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSegmentTrack(ctx, rect) }
          }, [
            ...(effectiveUnlockedTabs.includes('squad') ? [boxNode({
              id: 'cs-tab-squad', style: { grow: 1, height: shortH ? 30 : isPhone ? 36 : 32 },
              widget: {
                type: 'button',
                label: 'Squad',
                selected: campTab === 'squad',
                onPress: () => { setCampTab('squad'); mobileCampCollapsed = false; uiDirty = true },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, 'Squad', st, {
                  icon: 'users',
                  count: mobile ? undefined : `${camp.heroes.length}`
                })
              }
            })] : []),
            ...(effectiveUnlockedTabs.includes('armory') ? [boxNode({
              id: 'cs-tab-armory', style: { grow: 1, height: shortH ? 30 : isPhone ? 36 : 32 },
              widget: {
                type: 'button',
                label: 'Armory',
                selected: campTab === 'armory',
                onPress: () => { setCampTab('armory'); mobileCampCollapsed = false; uiDirty = true },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, 'Armory', st, {
                  icon: 'bag',
                  count: mobile ? undefined : `${camp.equipment.length}`
                })
              }
            })] : []),
            ...(effectiveUnlockedTabs.includes('deck') ? [boxNode({
              id: 'cs-tab-deck', style: { grow: 1, height: shortH ? 30 : isPhone ? 36 : 32 },
              widget: {
                type: 'button',
                label: 'Tactic Deck',
                selected: campTab === 'deck',
                onPress: () => { setCampTab('deck'); mobileCampCollapsed = false; uiDirty = true },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, mobile ? 'Deck' : 'Tactic Deck', st, {
                  icon: 'cards',
                  count: mobile ? undefined : `${getActiveTacticDeckUids(camp).length}/${MAX_TACTIC_DECK}`
                })
              }
            })] : []),
            ...(effectiveUnlockedTabs.includes('forge') ? [boxNode({
              id: 'cs-tab-forge', style: { grow: 1, height: shortH ? 30 : isPhone ? 36 : 32 },
              widget: {
                type: 'button',
                label: 'Forge',
                selected: campTab === 'forge',
                onPress: () => { setCampTab('forge'); mobileCampCollapsed = false; uiDirty = true },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, 'Forge', st, {
                  icon: 'sparkle',
                  count: mobile ? undefined : `${camp.dust + camp.shards}`
                })
              }
            })] : []),
            ...(effectiveUnlockedTabs.includes('packs') ? [boxNode({
              id: 'cs-tab-decks', style: { grow: 1, height: shortH ? 30 : isPhone ? 36 : 32 },
              widget: {
                type: 'button',
                label: 'Card Decks',
                selected: campTab === 'decks',
                onPress: () => { setCampTab('decks'); mobileCampCollapsed = false; uiDirty = true },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, mobile ? 'Packs' : 'Card Decks', st, {
                  icon: 'sparkle',
                  count: mobile ? undefined : `${camp.gold}g`
                })
              }
            })] : [])
          ]),
          ...(isPhone ? [boxNode({
            id: 'cs-camp-toggle', style: { width: 54, height: shortH ? 36 : 42 },
            widget: {
              type: 'button',
              label: collapsed ? 'Open' : '3D',
              onPress: () => { mobileCampCollapsed = !mobileCampCollapsed; uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, collapsed ? 'Open' : '3D', st, { variant: collapsed ? 'primary' : 'secondary', size: 11 }
              )
            }
          })] : [])
        ]),
        ...(collapsed ? [] : [bodyNode])
      ]),
      // Camp Discovery Tip (ridgetop-5hr.2 / 5hr.3) — floats cleanly above bottom sheet without blocking primary CTAs
      ...(() => {
        if (collapsed || packAnim || activeFanfare || (campTab === 'armory' && Boolean(activeArmoryDiff))) return []
        const campTip = checkDiscoveryTipForCamp(camp, {
          activeTab: toCampTabId(campTab),
          has3StarHero: camp.heroes.some(hero => hero.stars >= 3),
          hasSetPiece: camp.equipment.some(eq => Boolean(EQUIPMENT_BY_ID[eq.equipId]?.setId)),
          bondsUnlocked,
          temperingUnlocked
        }) ?? getActiveScreenDiscoveryTip(camp, 'camp')
        if (!campTip) return []
        const tipTopY = (shortH ? 48 : 64)
        const availAboveSheet = h - sheetH - (isPhone ? 16 : 28) - tipTopY
        if (availAboveSheet < 104) return []
        const tipW = Math.min(w - (isPhone ? 16 : 24), isPhone ? 312 : 340)
        return [buildScreenDiscoveryTipNode('camp', campTip, vp, {
          anchor: 'top-left',
          width: tipW,
          inset: [isPhone ? 8 : 12, tipTopY]
        })]
      })(),
      ...packOverlayNodes
    ])
  }

  // =========================================================================
  // PACK OPENING LOTTERY CEREMONY OVERLAY
  // =========================================================================

  function buildPackCeremonyOverlay(w: number, h: number, anim: PackAnimState): LayoutNode {
    const mobile = w < 640
    const shortH = h < 480
    const pack = PACK_BY_ID[anim.packId]
    const allRevealed = isPackCeremonyComplete()
    const canBuyAgain = canBuyPack(state.campaign, anim.packId)
    const revealElapsed = Math.max(0, anim.elapsed - PACK_SPIN_DURATION)

    const stageW = Math.min(w - 24, 780)
    const cardH = shortH ? 170 : mobile ? 200 : 236
    const cardNodes: LayoutNode[] = anim.phase === 'reveal'
      ? anim.cards.map((card, idx) => {
          const cardPortrait = card.kind === 'hero' ? portraits[card.refId] : undefined
          const tacticSpec = card.kind === 'tactic' ? TACTIC_BY_ID[card.refId] : undefined
          const equipSpec = (card.kind === 'weapon' || card.kind === 'armor' || card.kind === 'relic')
            ? EQUIPMENT_BY_ID[card.refId]
            : undefined
          const enterT = Math.max(0, Math.min(1, (revealElapsed - idx * 0.08) / 0.36))
          const flipStart = anim.flipStartTimes[idx]
          const flipT = flipStart >= 0 ? Math.max(0, Math.min(1, (anim.elapsed - flipStart) / PACK_FLIP_DURATION)) : 0
          return boxNode({
            id: `pack-anim-card-${idx}`,
            style: { grow: 1, height: cardH },
            widget: {
              type: 'button',
              label: flipT >= 0.5 ? card.name : `Flip Card ${idx + 1}`,
              onPress: () => {
                if (anim.flipStartTimes[idx] < 0) {
                  anim.flipStartTimes[idx] = anim.elapsed
                  state.sounds.push({ kind: 'card', pitch: 1.05 + idx * 0.1 })
                  uiDirty = true
                }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawAnimatedRevealCard(
                ctx,
                rect,
                {
                  rarity: card.rarity,
                  kind: card.kind,
                  refId: card.refId,
                  name: card.name,
                  detail: card.detail,
                  value: card.value,
                  isNew: card.isNew,
                  convertedShards: card.convertedShards,
                  pityTriggered: card.pityTriggered,
                  portrait: cardPortrait,
                  tacticSpec,
                  equipAccent: equipSpec?.accentHex
                },
                { enterT, flipT, elapsed: anim.elapsed, hovered: st.hovered }
              )
            }
          })
        })
      : []

    const btnH = shortH ? 38 : 44
    return overlay({ id: 'pack-ceremony-root', style: { anchor: 'fill' } }, [
      boxNode({
        id: 'pack-ceremony-bg',
        style: { anchor: 'fill' },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPackCeremonyBackdrop(ctx, rect, {
            pack,
            bestRarity: anim.bestRarity,
            elapsed: anim.elapsed,
            phase: anim.phase,
            cards: anim.cards
          })
        }
      }),
      ...(anim.phase === 'reveal' ? [
        column({
          id: 'pack-ceremony-cards',
          style: { anchor: 'center', width: stageW, height: (shortH ? 34 : 44) + cardH + (shortH ? 10 : 18), gap: shortH ? 10 : 18 }
        }, [
          boxNode({
            id: 'pack-ceremony-title',
            style: { width: stageW, height: shortH ? 34 : 44 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawStoryHeading(
                ctx,
                rect,
                pack.name,
                allRevealed ? 'Cards Unsealed!' : 'Revealing Spoils...'
              )
            }
          }),
          row({ id: 'pack-ceremony-row', style: { width: stageW, height: cardH, gap: mobile ? 6 : 12 } }, cardNodes)
        ])
      ] : []),
      row({
        id: 'pack-ceremony-actions',
        style: { anchor: 'bottom', width: Math.min(w - 24, 420), height: btnH, inset: shortH ? 12 : 26, gap: 10, respectSafeArea: true }
      }, allRevealed
        ? [
            ...(canBuyAgain ? [boxNode({
              id: 'cs-pack-again',
              style: { grow: 1, height: btnH },
              widget: {
                type: 'button',
                label: `Open Another (${pack.cost}g)`,
                onPress: () => {
                  audio.unlock()
                  const pulled = buyPack(state, anim.packId)
                  if (pulled) {
                    saveNow()
                    startPackCeremony(anim.packId, pulled)
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, `Another (${pack.cost}g)`, st, { variant: 'secondary', icon: 'cards', size: 13 }
                )
              }
            })] : []),
            boxNode({
              id: 'cs-pack-collect',
              style: { grow: 1.2, height: btnH },
              widget: {
                type: 'button',
                label: 'Collect Cards',
                primary: true,
                onPress: () => {
                  packAnim = null
                  uiDirty = true
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, 'Collect Cards', st, { variant: 'primary', icon: 'check', size: 14 }
                )
              }
            })
          ]
        : [
            boxNode({
              id: 'cs-pack-skip',
              style: { grow: 1, height: btnH },
              widget: {
                type: 'button',
                label: 'Skip Animation',
                onPress: () => {
                  audio.unlock()
                  skipPackCeremony()
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, 'Reveal All', st, { variant: 'secondary', icon: 'sparkle', size: 13 }
                )
              }
            })
          ])
    ])
  }

  // =========================================================================
  // VICTORY & DEFEAT MODALS (ANIMATED CELEBRATION / GRIM ATMOSPHERE)
  // =========================================================================

  function buildResultTree(w: number, h: number, won: boolean): LayoutNode {
    const vp = getViewportProfile(w, h)
    const landscapePhone = vp.isLandscapePhone || (h < 500 && w >= 620)
    const shortH = landscapePhone || h < 660
    const battle = state.battle
    const reward = battle?.reward
    const ch = CHAPTERS[battle?.chapterIndex ?? 0]
    const eqSpec = reward?.equipCard ? EQUIPMENT_BY_ID[reward.equipCard.equipId] : undefined
    const heroSpec = reward?.heroCard ? HERO_SPECS[reward.heroCard.heroId] : undefined
    const tacSpec = reward?.tacticCard ? TACTIC_BY_ID[reward.tacticCard.tacticId] : undefined
    const copies = reward?.heroCard
      ? state.campaign.heroes.filter(h => h.heroId === reward.heroCard?.heroId && h.stars === 1).length
      : 0

    const pendingRun = state.campaign.endlessRun
    const isResumedPendingDraft = won && !battle && Boolean(pendingRun && pendingRun.pendingDraft.length > 0)
    const endlessWaveNum = battle?.endlessWave || (isResumedPendingDraft ? (pendingRun?.currentWave ?? 1) : 0)
    const isEndlessResult = endlessWaveNum > 0
    const endlessBiomeLabel = battle
      ? formatEndlessBiomeLabel(battle.biome)
      : formatEndlessBiomeLabel(pendingRun?.lastBiome ?? 'throne')
    const pendingEndlessDraft = won && isEndlessResult
      ? (pendingRun?.pendingDraft ?? [])
      : []
    const hasBlessingDraft = pendingEndlessDraft.length > 0
    const eventTitle = reward?.worldEventTitle ?? battle?.activeWorldEventTitle
    const title = won
      ? (reward?.campaignWon
          ? 'Sunstone Crown Reforged'
          : reward?.abyssCompleted
            ? 'Crownless Deep Conquered!'
            : eventTitle
              ? 'Event Cleared!'
              : isEndlessResult
                ? `Wave ${endlessWaveNum} Cleared!`
                : 'Victory!')
      : 'Vanguard Defeated'
    const rewardTier = reward?.difficultyTier ?? battle?.difficultyTier ?? 'normal'
    const rewardMutCount = (reward?.mutators ?? battle?.mutators ?? []).length
    const challengeSubTag = rewardTier !== 'normal' || rewardMutCount > 0
      ? ` · ${STAGE_TIER_SPECS[rewardTier].label}${rewardMutCount > 0 ? ` +${rewardMutCount} Mut` : ''}`
      : (reward && !reward.firstClear && !eventTitle && endlessWaveNum === 0 && !battle?.abyssFloor ? ' · Replay' : '')
    const abyssSubTag = battle?.abyssFloor ? ` · ${formatAbyssFloorLabel(battle.abyssFloor)}` : ''
    const gauntletSubTag = battle?.gauntletMaxRounds ? ` · All ${battle.gauntletMaxRounds} Rounds Cleared` : ''
    const sub = eventTitle
      ? (won ? `${eventTitle} · Road Event Bounty` : `${eventTitle} · Regroup & Adapt`)
      : isEndlessResult
        ? (won
            ? `Endless Wave ${endlessWaveNum} · ${endlessBiomeLabel}${isEndlessBossWave(endlessWaveNum) ? ' · Boss Cleared' : ''}`
            : `Endless Wave ${endlessWaveNum} · ${endlessBiomeLabel} · Best W${state.campaign.endlessBest}`)
        : won
          ? `${ch.title}${abyssSubTag}${gauntletSubTag}${challengeSubTag}`
          : `${ch.title}${abyssSubTag} · Regroup & Adapt`
    const quote = isEndlessResult
      ? (won
          ? `Draft 1 of ${pendingEndlessDraft.length || 3} Run Blessings to carry into Wave ${endlessWaveNum + 1}.`
          : 'Your temporary Run Blessings have faded, but your Endless Best record remains. Regroup and begin a fresh ascent!')
      : won
        ? eventTitle
          ? (reward?.worldEventKind === 'timed_gauntlet'
              ? 'Vanguard Herald: "A commanding display of tactics! Claim your gauntlet shards and forged war spoils."'
              : 'Caravan Scout: "The road is safe again! Take this bounty gold and Arcane Dust for your swift defense."')
          : `${ch.outroSpeaker}: "${ch.outroText}"`
        : 'Return to Vanguard Camp to equip stronger gear, open booster decks, or merge 3 identical heroes to unlock Tier 2 skills.'

    const useTwoColLoot = landscapePhone && !hasBlessingDraft
    const rowH = hasBlessingDraft
      ? (landscapePhone ? 32 : shortH ? 34 : 36)
      : (landscapePhone ? 36 : shortH ? 38 : 44)
    let masteryNode: LayoutNode | null = null
    let xpNode: LayoutNode | null = null
    const lootNodes: LayoutNode[] = []
    if (won && reward) {
      const goldRollU = Math.max(0, Math.min(1, (resultAnimTime - 0.22) / 0.6))
      const shownGold = Math.round(reward.gold * (1 - Math.pow(1 - goldRollU, 3)))
      const rowReveal = (idx: number) => Math.max(0, Math.min(1, (resultAnimTime - (0.28 + idx * 0.16)) / 0.34))

      let rIdx = 0
      if (reward.masteryEarned) {
        const mastery = reward.masteryEarned
        const mIdx = rIdx++
        masteryNode = boxNode({
          id: 'res-mastery',
          style: { height: landscapePhone ? 44 : shortH ? 48 : 58 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawVictoryMasteryAnimated(
              ctx, rect, mastery, rowReveal(mIdx)
            )
          }
        })
      }
      const goldIdx = rIdx++
      lootNodes.push(
        boxNode({
          id: 'res-gold', style: { grow: useTwoColLoot ? 1 : 0, height: rowH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRowAnimated(ctx, rect, {
              icon: 'coin',
              title: `+${shownGold} Gold`,
              detail: `Treasury total: ${state.campaign.gold}g`,
              color: COLOR.accentHi,
              badge: reward.worldEventId
                ? 'EVENT BOUNTY'
                : reward.firstClear
                  ? 'FIRST CLEAR'
                  : rewardTier !== 'normal'
                    ? STAGE_TIER_SPECS[rewardTier].label.toUpperCase()
                    : rewardMutCount > 0
                      ? 'MUTATED'
                      : 'REPLAY'
            }, rowReveal(goldIdx))
          }
        })
      )
      if ((reward.bonusDust ?? 0) > 0 || (reward.bonusShards ?? 0) > 0) {
        const bonusIdx = rIdx++
        const bDust = reward.bonusDust ?? 0
        const bShards = reward.bonusShards ?? 0
        lootNodes.push(
          boxNode({
            id: 'res-challenge-materials', style: { grow: useTwoColLoot ? 1 : 0, height: rowH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRowAnimated(ctx, rect, {
                icon: 'sparkle',
                title: `+${bDust} Dust · +${bShards} Shards`,
                detail: `Forge spoils · Dust ${state.campaign.dust} · Shards ${state.campaign.shards}`,
                color: rewardTier === 'mythic' ? '#e5adff' : '#a3f7d0',
                badge: reward.worldEventId
                  ? 'EVENT SPOILS'
                  : rewardTier === 'mythic' ? 'MYTHIC BONUS' : rewardTier === 'veteran' ? 'HEROIC BONUS' : 'MUTATOR BONUS'
              }, rowReveal(bonusIdx))
            }
          })
        )
      }
      if (reward.equipCard && eqSpec) {
        const eqIdx = rIdx++
        lootNodes.push(
          boxNode({
            id: 'res-eq', style: { grow: useTwoColLoot ? 1 : 0, height: rowH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRowAnimated(ctx, rect, {
                icon: 'bag',
                title: eqSpec.name,
                detail: eqSpec.desc,
                color: RARITY_META[eqSpec.rarity].hex,
                badge: reward.firstClear ? `1x ${RARITY_META[eqSpec.rarity].short}` : RARITY_META[eqSpec.rarity].label
              }, rowReveal(eqIdx))
            }
          })
        )
      }
      if (reward.heroCard && heroSpec) {
        const hIdx = rIdx++
        const heroId = reward.heroCard.heroId
        lootNodes.push(
          boxNode({
            id: 'res-hero', style: { grow: useTwoColLoot ? 1 : 0, height: rowH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRowAnimated(ctx, rect, {
                portrait: portraits[heroId],
                title: `${heroSpec.name} (${heroSpec.title})`,
                detail: `Copies: ${copies}/3`,
                color: '#9ff0c4',
                badge: copies >= 3 ? 'READY TO MERGE' : reward.firstClear ? 'ONE-TIME' : 'REPLAY DROP'
              }, rowReveal(hIdx))
            }
          })
        )
      }
      if (reward.tacticCard && tacSpec) {
        const tIdx = rIdx++
        lootNodes.push(
          boxNode({
            id: 'res-tac', style: { grow: useTwoColLoot ? 1 : 0, height: rowH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRowAnimated(ctx, rect, {
                icon: 'cards',
                title: tacSpec.name,
                detail: tacSpec.desc,
                color: RARITY_META[tacSpec.rarity].hex,
                badge: 'TACTIC'
              }, rowReveal(tIdx))
            }
          })
        )
      }
      if (reward.heroXpGains.length > 0) {
        const xpIdx = rIdx++
        const xpPortraits: Record<string, HTMLCanvasElement | undefined> = {}
        for (const g of reward.heroXpGains) {
          const ownedHero = getHeroByUid(state.campaign, g.uid)
          xpPortraits[g.uid] = ownedHero ? heroCardPortrait(ownedHero) : portraits[g.heroId]
        }
        xpNode = boxNode({
          id: 'res-xp', style: { height: landscapePhone ? 54 : shortH ? 58 : 70 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawHeroXpSummaryAnimated(
              ctx, rect, reward.heroXpGains, xpPortraits, rowReveal(xpIdx)
            )
          }
        })
      }
      if (reward.bondRankUps && reward.bondRankUps.length > 0) {
        const bIdx = rIdx++
        const firstBond = reward.bondRankUps[0]
        const bondTitle = reward.bondRankUps.length === 1
          ? `Bond R${firstBond.newRank}: ${firstBond.nameA} ♥ ${firstBond.nameB}`
          : `${reward.bondRankUps.length} Hero Bonds Forged!`
        const bondDetail = reward.bondRankUps.length === 1
          ? `${firstBond.rankTitle} · +5% Assist${firstBond.newRank >= 3 ? ', +10% Pincer' : firstBond.newRank >= 2 ? ', +5% Crit' : ''} & Banter`
          : reward.bondRankUps.slice(0, 3).map(b => `${b.nameA} ♥ ${b.nameB} R${b.newRank}`).join(' · ')
        lootNodes.push(boxNode({
          id: 'res-bonds', style: { grow: useTwoColLoot ? 1 : 0, height: rowH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRowAnimated(ctx, rect, {
              icon: 'heart',
              title: bondTitle,
              detail: bondDetail,
              color: firstBond.newRank >= 3 ? '#ffd978' : '#ff8ec4',
              badge: `♥ R${firstBond.newRank}`
            }, rowReveal(bIdx))
          }
        }))
      }
      if (reward.unlockedSlot4) {
        const sIdx = rIdx++
        lootNodes.push(boxNode({
          id: 'res-slot4', style: { grow: useTwoColLoot ? 1 : 0, height: rowH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRowAnimated(ctx, rect, {
              icon: 'users',
              title: '4th Squad Slot Unlocked',
              detail: 'Deploy four heroes together from Vanguard Camp.',
              color: COLOR.ap,
              badge: 'ONE-TIME'
            }, rowReveal(sIdx))
          }
        }))
      }
    }

    const rewardRows: LayoutNode[] = []
    if (masteryNode) rewardRows.push(masteryNode)
    if (useTwoColLoot && lootNodes.length >= 2) {
      for (let i = 0; i < lootNodes.length; i += 2) {
        const pair = lootNodes.slice(i, i + 2)
        if (pair.length === 2) {
          rewardRows.push(row({ id: `res-loot-row-${i}`, style: { height: rowH, gap: 6 } }, pair))
        } else {
          // Unpaired trailing row sits directly in the vertical column, so clear grow
          const solo = pair[0]
          rewardRows.push({ ...solo, style: { ...solo.style, grow: 0 } })
        }
      }
    } else {
      for (const node of lootNodes) {
        rewardRows.push(useTwoColLoot ? { ...node, style: { ...node.style, grow: 0 } } : node)
      }
    }
    if (xpNode) rewardRows.push(xpNode)

    const btnH = landscapePhone ? 40 : shortH ? 42 : 44
    const blessingCardH = landscapePhone ? 126 : shortH ? 132 : 164
    const blessingDraftNodes: LayoutNode[] = hasBlessingDraft
      ? [
          boxNode({
            id: 'res-blessing-header',
            style: { height: 18 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                ctx,
                rect,
                `DRAFT 1 OF ${pendingEndlessDraft.length} RUN BLESSINGS · WAVE ${endlessWaveNum + 1}`,
                { size: 10.5, weight: 900, color: COLOR.accentHi, align: 'center', display: true, spacing: 0.8 }
              )
            }
          }),
          row(
            { id: 'res-blessings', style: { height: blessingCardH, gap: shortH ? 6 : 8 } },
            pendingEndlessDraft.slice(0, 3).map((bId, idx) => {
              const spec = ENDLESS_BLESSING_BY_ID[bId]
              return boxNode({
                id: `cs-blessing-${idx}`,
                style: { grow: 1, height: blessingCardH },
                widget: {
                  type: 'button',
                  label: `${spec.name}: ${spec.desc}`,
                  onPress: () => pickEndlessBlessingAndAdvance(bId),
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) =>
                    drawEndlessBlessingCard(ctx, rect, spec, st, shortH || w < 560)
                }
              })
            })
          )
        ]
      : []

    const displayRewardRows = hasBlessingDraft ? rewardRows.slice(0, shortH ? 1 : h >= 680 ? 3 : 2) : rewardRows
    const safeHoriz = vp.safeArea.left + vp.safeArea.right
    const modalW = Math.min(
      w - Math.max(20, safeHoriz + 16),
      landscapePhone ? (hasBlessingDraft ? 680 : 720) : (hasBlessingDraft ? 592 : 512)
    )
    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({
        id: 'res-scrim',
        style: { anchor: 'fill' },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => won
            ? drawVictoryBackdrop(ctx, rect, resultAnimTime)
            : drawDefeatBackdrop(ctx, rect, resultAnimTime)
        }
      }),
      column({
        id: 'res-modal',
        style: {
          anchor: 'center',
          width: modalW,
          padding: landscapePhone ? [10, 14] : shortH ? 14 : hasBlessingDraft ? 18 : 24,
          gap: landscapePhone ? 5 : shortH ? 7 : hasBlessingDraft ? 9 : 12,
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawModal(ctx, rect, won ? COLOR.accent : COLOR.enemy)
        }
      }, [
        boxNode({
          id: 'res-title', style: { height: landscapePhone ? 46 : shortH ? 50 : 60 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawResultHeadlineAnimated(ctx, rect, title, sub, won, resultAnimTime)
          }
        }),
        ...((shortH && won) || hasBlessingDraft ? [] : [boxNode({
          id: 'res-story', style: { height: shortH ? 40 : 50 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
              ctx, rect, quote, { size: 12.5, weight: 500, color: COLOR.muted, align: 'center', wrap: true, lineHeight: 16.5 }
            )
          }
        })]),
        ...displayRewardRows,
        ...blessingDraftNodes,
        row({ id: 'res-btns', style: { height: btnH, gap: 8 } }, won ? (hasBlessingDraft ? [
          boxNode({
            id: 'cs-victory-camp', style: { grow: 1, height: btnH },
            widget: {
              type: 'button', label: 'Camp', onPress: () => openCamp('squad'),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Camp', st, { variant: 'secondary', icon: 'camp', size: 13 }
              )
            }
          }),
          boxNode({
            id: 'cs-victory-abandon-run', style: { grow: 1, height: btnH },
            widget: {
              type: 'button', label: 'End Run', onPress: () => {
                abandonEndlessRun(state)
                saveNow()
                openWorldMap()
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'End Run', st, { variant: 'secondary', icon: 'map', size: 13 }
              )
            }
          })
        ] : [
          boxNode({
            id: 'cs-victory-camp', style: { grow: 1, height: btnH },
            widget: {
              type: 'button', label: 'Camp', onPress: () => openCamp('squad'),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Camp', st, { variant: 'secondary', icon: 'camp', size: 13 }
              )
            }
          }),
          boxNode({
            id: 'cs-victory-next', style: { grow: 1.4, height: btnH },
            widget: {
              type: 'button',
              label: (state.battle?.endlessWave ?? 0) > 0
                ? 'Next Wave'
                : (state.battle?.abyssFloor && state.battle.abyssFloor < CROWNLESS_DEEP_MAX_FLOOR)
                  ? `Floor ${state.battle.abyssFloor + 1}`
                  : 'World Map',
              primary: true,
              onPress: advanceAfterVictory,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => {
                const nextBtnLabel = (state.battle?.endlessWave ?? 0) > 0
                  ? 'Next Wave'
                  : (state.battle?.abyssFloor && state.battle.abyssFloor < CROWNLESS_DEEP_MAX_FLOOR)
                    ? `Floor ${state.battle.abyssFloor + 1}`
                    : 'World Map'
                const nextBtnIcon = ((state.battle?.endlessWave ?? 0) > 0 || (state.battle?.abyssFloor && state.battle.abyssFloor < CROWNLESS_DEEP_MAX_FLOOR))
                  ? 'arrow-right'
                  : 'map'
                drawButton(ctx, rect, nextBtnLabel, st, { variant: 'primary', icon: nextBtnIcon, size: 14 })
              }
            }
          })
        ]) : [
          boxNode({
            id: 'cs-world-map', style: { grow: 1, height: btnH },
            widget: {
              type: 'button', label: 'World Map', onPress: () => openWorldMap(),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'World Map', st, { variant: 'secondary', icon: 'map', size: 12.5 }
              )
            }
          }),
          boxNode({
            id: 'cs-victory-camp', style: { grow: 1, height: btnH },
            widget: {
              type: 'button', label: 'Camp', onPress: () => openCamp('squad'),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Camp', st, { variant: 'secondary', icon: 'camp', size: 12.5 }
              )
            }
          }),
          boxNode({
            id: 'cs-defeat-retry', style: { grow: 1.2, height: btnH },
            widget: {
              type: 'button', label: isEndlessResult ? 'New Run' : 'Retry', primary: true, onPress: retryAfterDefeat,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, isEndlessResult ? 'New Run' : 'Retry', st, { variant: 'primary', icon: 'play', size: 13.5 }
              )
            }
          })
        ])
      ])
    ])
  }

  // =========================================================================
  // PAUSE MODAL
  // =========================================================================

  function buildPausedTree(w: number, h: number): LayoutNode {
    const vp = getViewportProfile(w, h)
    const ultraShortH = vp.isLandscapePhone || h < 420
    const shortH = vp.isPhone || h < 520
    const rowH = ultraShortH ? 32 : shortH ? 36 : 42
    const btnH = ultraShortH ? 38 : shortH ? 42 : 46
    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({ id: 'p-scrim', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'p-card',
        style: {
          anchor: 'center',
          width: Math.min(w - Math.max(24, vp.safeArea.left + vp.safeArea.right + 16), 360),
          padding: ultraShortH ? 12 : shortH ? 14 : 22,
          gap: ultraShortH ? 6 : shortH ? 7 : 10,
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawModal(ctx, rect, COLOR.accent)
        }
      }, [
        boxNode({
          id: 'p-title', style: { height: ultraShortH ? 24 : shortH ? 26 : 34 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
              ctx, rect, 'Battle Paused', { size: shortH ? 19 : TYPE.h2 - 2, weight: 850, align: 'center', display: true }
            )
          }
        }),
        boxNode({
          id: 'cs-resume', style: { height: btnH },
          widget: {
            type: 'button', label: 'Resume Battle', primary: true, onPress: () => setScreen('battle'),
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, 'Resume Battle', st, { variant: 'primary', icon: 'play', size: 14 }
            )
          }
        }),
        boxNode({
          id: 'cs-perf', style: { height: rowH },
          widget: {
            type: 'button', label: 'FPS Overlay', onPress: togglePerfOverlay,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSettingRow(
              ctx, rect, 'Performance Overlay', 'gauge', showPerfPanel, st
            )
          }
        }),
        boxNode({
          id: 'cs-music', style: { height: rowH },
          widget: {
            type: 'button', label: 'Music', onPress: toggleMusic,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSettingRow(
              ctx, rect, 'Background Music', 'music', audio.isMusicEnabled(), st
            )
          }
        }),
        boxNode({
          id: 'cs-mute', style: { height: rowH },
          widget: {
            type: 'button', label: 'Audio', onPress: toggleMute,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSettingRow(
              ctx, rect, 'Master Audio', audio.isMuted() ? 'mute' : 'volume', !audio.isMuted(), st
            )
          }
        }),
        boxNode({
          id: 'cs-setting-action-camera', style: { height: rowH },
          widget: {
            type: 'button', label: 'Action Camera', onPress: toggleActionCameraSetting,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSettingRow(
              ctx, rect, 'Action Camera', 'target', isActionCameraEnabled(state.campaign), st
            )
          }
        }),
        row({ id: 'p-tips-row', style: { height: rowH, gap: 6 } }, [
          boxNode({
            id: 'cs-tips-toggle', style: { grow: 1, height: rowH },
            widget: {
              type: 'button', label: 'Discovery Tips', onPress: toggleDiscoveryTipsSetting,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSettingRow(
                ctx, rect, 'Discovery Tips', 'sparkle', areDiscoveryTipsEnabled(state.campaign), st
              )
            }
          }),
          boxNode({
            id: 'cs-tips-reset', style: { width: 72, height: rowH },
            widget: {
              type: 'button', label: 'Reset Tips', onPress: resetDiscoveryTipsNow,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Reset', st, { variant: 'secondary', size: 11.5 }
              )
            }
          })
        ]),
        boxNode({
          id: 'cs-retreat', style: { height: rowH },
          widget: {
            type: 'button', label: 'Retreat to Camp', onPress: retreatFromBattle,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, 'Retreat to Camp', st, { variant: 'danger', icon: 'retreat', size: 13 }
            )
          }
        })
      ])
    ])
  }

  // =========================================================================
  // CODEX / BESTIARY MODAL
  // =========================================================================

  function buildCodexTree(w: number, h: number): LayoutNode {
    const vp = getViewportProfile(w, h)
    const camp = state.campaign
    const mobile = vp.isPhone
    const tablet = vp.isTablet
    const shortH = vp.isLandscapePhone || h < 660
    const progress = getCodexProgress(camp)

    const enemyEntries = getBestiaryEntries(camp)
    const heroEntries = getHeroCodexEntries(camp)
    const equipEntries = getEquipCodexEntries(camp)

    const listItems: CodexListEntry[] = codexTab === 'enemies'
      ? enemyEntries.map(data => ({ kind: 'enemy' as const, data }))
      : codexTab === 'heroes'
        ? heroEntries.map(data => ({ kind: 'hero' as const, data }))
        : equipEntries.map(data => ({ kind: 'gear' as const, data }))

    // Ensure a valid entry is selected for the active tab
    if (!codexSelectedId || !listItems.some(it => it.data.id === codexSelectedId)) {
      codexSelectedId = listItems[0]?.data.id ?? null
    }
    const selectedItem = listItems.find(it => it.data.id === codexSelectedId) ?? listItems[0]

    const safeHoriz = vp.safeArea.left + vp.safeArea.right
    const safeVert = vp.safeArea.top + vp.safeArea.bottom
    const modalW = mobile ? Math.max(300, w - Math.max(12, safeHoriz + 8)) : Math.min(1080, w - Math.max(32, safeHoriz + 16))
    const modalH = mobile ? Math.max(260, h - Math.max(12, safeVert + 8)) : Math.min(664, h - Math.max(28, safeVert + 12))
    const modalPad = mobile ? 6 : 14
    const headerH = mobile ? 34 : 48
    const tabsH = mobile ? 32 : 38
    const bodyH = Math.max(180, modalH - modalPad * 2 - headerH - tabsH - 18)

    const pageSize = vp.isPortraitPhone
      ? 4
      : vp.isLandscapePhone
        ? 3
        : Math.max(4, Math.min(8, Math.floor((bodyH - 38) / 56)))
    const totalPages = Math.max(1, Math.ceil(listItems.length / pageSize))
    if (codexPage >= totalPages) codexPage = totalPages - 1
    if (codexPage < 0) codexPage = 0
    const pageStart = codexPage * pageSize
    const visibleItems = listItems.slice(pageStart, pageStart + pageSize)

    const portraitForItem = (item: CodexListEntry): HTMLCanvasElement | undefined => {
      if (item.kind === 'enemy') {
        return item.data.discovered ? portraits[item.data.id] : undefined
      }
      if (item.kind === 'hero') {
        if (item.data.masked) return undefined
        const owned = camp.heroes
          .filter(h => h.heroId === item.data.id)
          .sort((a, b) => b.stars - a.stars)[0]
        return owned ? heroCardPortrait(owned) : portraits[item.data.id]
      }
      return undefined
    }

    const paginationBar = row({
      id: 'codex-pager',
      style: { height: mobile ? 26 : 30, gap: 6, align: 'center' }
    }, [
      boxNode({
        id: 'cs-codex-prev',
        style: { width: mobile ? 60 : 72, height: mobile ? 26 : 28 },
        widget: {
          type: 'button',
          label: 'Prev',
          disabled: codexPage <= 0,
          onPress: () => {
            if (codexPage > 0) {
              codexPage -= 1
              state.sounds.push({ kind: 'card', pitch: 0.96 })
              uiDirty = true
            }
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, 'Prev', st, { variant: 'secondary', icon: 'chevron-left', size: 11 }
          )
        }
      }),
      boxNode({
        id: 'codex-page-label',
        style: { grow: 1, height: mobile ? 26 : 28 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawText(
              ctx,
              `Page ${codexPage + 1} / ${totalPages} (${listItems.length})`,
              rect.x + rect.width * 0.5,
              rect.y + rect.height * 0.5 + 0.5,
              { size: 10.5, weight: 800, color: COLOR.muted, align: 'center' }
            )
          }
        }
      }),
      boxNode({
        id: 'cs-codex-next',
        style: { width: mobile ? 60 : 72, height: mobile ? 26 : 28 },
        widget: {
          type: 'button',
          label: 'Next',
          disabled: codexPage >= totalPages - 1,
          onPress: () => {
            if (codexPage < totalPages - 1) {
              codexPage += 1
              state.sounds.push({ kind: 'card', pitch: 1.06 })
              uiDirty = true
            }
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, 'Next', st, { variant: 'secondary', icon: 'chevron-right', size: 11 }
          )
        }
      })
    ])

    const drawMaskedCodexEntryCard = (
      ctx: CanvasRenderingContext2D,
      rect: LayoutRect,
      kind: 'hero' | 'gear',
      st: CanvasWidgetDrawState,
      compactCard: boolean
    ) => {
      const selected = Boolean(st.selected)
      const hovered = Boolean(st.hovered)
      drawPanel(ctx, rect, {
        r: RADIUS.md,
        lipH: selected ? 4 : 3,
        fill: selected ? '#384d82' : hovered ? '#2e3e69' : '#212d4d',
        fillBot: selected ? '#233259' : hovered ? '#1c2847' : '#151e36'
      })
      const pad = compactCard ? 5 : 7
      const tileSz = Math.max(26, Math.min(compactCard ? 32 : 42, rect.height - pad * 2 - 2))
      const tx = rect.x + pad
      const ty = rect.y + Math.floor((rect.height - 3 - tileSz) * 0.5)
      drawCodexSilhouetteTile(ctx, tx, ty, tileSz, '#5a6b92')
      const textX = tx + tileSz + (compactCard ? 6 : 9)
      const rightPad = compactCard ? 6 : 8
      const textMaxW = Math.max(36, rect.x + rect.width - textX - rightPad)
      const titleY = rect.y + rect.height * 0.35
      const subY = rect.y + rect.height * 0.68
      let badgeW = 0
      if (!compactCard || rect.width >= 155) {
        badgeW = drawChip(ctx, rect.x + rect.width - rightPad, titleY - 8, 'LOCKED', {
          h: 16,
          size: 8.5,
          color: COLOR.faint,
          bg: '#0e1529',
          align: 'right'
        }) + 6
      }
      drawText(ctx, '???', textX, titleY, {
        size: compactCard ? 11.5 : 13,
        weight: 900,
        color: '#96a8cc',
        maxW: Math.max(30, textMaxW - badgeW),
        display: true
      })
      drawText(ctx, kind === 'hero' ? 'Undiscovered Hero' : 'Undiscovered Relic', textX, subY, {
        size: compactCard ? 9.5 : 10.5,
        weight: 700,
        color: COLOR.faint,
        maxW: textMaxW
      })
    }

    const drawMaskedCodexDetail = (
      ctx: CanvasRenderingContext2D,
      rect: LayoutRect,
      item: Extract<CodexListEntry, { kind: 'hero' | 'gear' }>,
      compactPane: boolean
    ) => {
      drawPanel(ctx, rect, { r: RADIUS.lg, lipH: 4, fill: '#222f52f2', fillBot: '#141c34f5' })
      const pad = compactPane ? 10 : 14
      const innerX = rect.x + pad
      const innerW = Math.max(60, rect.width - pad * 2)
      const cy = rect.y + pad
      const pSize = compactPane ? 50 : 66
      drawCodexSilhouetteTile(ctx, innerX, cy, pSize, '#62749c')
      const infoX = innerX + pSize + (compactPane ? 10 : 14)
      const infoW = Math.max(60, innerX + innerW - infoX)
      drawText(ctx, '???', infoX, cy + (compactPane ? 13 : 16), {
        size: compactPane ? 15.5 : 20,
        weight: 900,
        color: '#9cb0d6',
        display: true,
        stroke: true,
        strokeWidth: 2.8,
        maxW: infoW
      })
      drawChip(ctx, infoX, cy + (compactPane ? 26 : 34), 'UNDISCOVERED', {
        h: 18,
        size: 9.5,
        color: COLOR.faint,
        bg: '#121a30'
      })
      const unlockHint = item.kind === 'hero'
        ? `Recruit this hero from Card Packs (${item.data.packSources.join(', ') || 'Any'}), campaign rewards, or the Forge to reveal their full stats, passive, and skills.`
        : `Acquire this ${item.data.spec.slot} from battle drops, Card Packs (${item.data.packSources.join(', ') || 'Any'}), or the Forge to reveal its stats and set bonuses.`
      drawLabel(
        ctx,
        { x: innerX, y: cy + pSize + 14, width: innerW, height: Math.max(40, rect.height - pSize - pad * 2 - 14) },
        unlockHint,
        { size: compactPane ? 11 : 12.5, weight: 600, color: COLOR.muted, wrap: true, lineHeight: compactPane ? 15 : 18 }
      )
    }

    const detailNode = boxNode({
      id: 'codex-detail-pane',
      style: { grow: 1 },
      widget: {
        type: 'panel',
        blocksPointer: true,
        draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
          if (!selectedItem) {
            drawEmptyNote(ctx, rect, 'Select an entry to inspect its dossier.')
            return
          }
          if (selectedItem.kind === 'enemy') {
            drawCodexEnemyDetail(ctx, rect, selectedItem.data, portraitForItem(selectedItem), mobile || shortH)
          } else if (selectedItem.kind === 'hero') {
            if (selectedItem.data.masked) {
              drawMaskedCodexDetail(ctx, rect, selectedItem, mobile || shortH)
            } else {
              drawCodexHeroDetail(ctx, rect, selectedItem.data, portraitForItem(selectedItem), mobile || shortH)
            }
          } else {
            if (selectedItem.data.masked) {
              drawMaskedCodexDetail(ctx, rect, selectedItem, mobile || shortH)
            } else {
              drawCodexEquipDetail(ctx, rect, selectedItem.data, mobile || shortH)
            }
          }
        }
      }
    })

    const makeEntryButton = (item: CodexListEntry, slotIdx: number, rowH: number, compactCard: boolean): LayoutNode => {
      const itemId = item.data.id
      const isSelected = itemId === codexSelectedId
      const isMaskedHeroOrGear = (item.kind === 'hero' || item.kind === 'gear') && item.data.masked
      const label = isMaskedHeroOrGear
        ? '???'
        : item.kind === 'enemy'
          ? item.data.displayName
          : item.data.spec.name
      return boxNode({
        id: `cs-codex-entry-${slotIdx}`,
        style: compactCard ? { grow: 1, height: rowH } : { height: rowH },
        widget: {
          type: 'button',
          label,
          selected: isSelected,
          onPress: () => {
            codexSelectedId = itemId
            state.sounds.push({ kind: 'card', pitch: 1.04 })
            uiDirty = true
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => {
            if (isMaskedHeroOrGear && (item.kind === 'hero' || item.kind === 'gear')) {
              drawMaskedCodexEntryCard(ctx, rect, item.kind, { ...st, selected: isSelected }, compactCard)
              return
            }
            drawCodexEntryCard(ctx, rect, item, { ...st, selected: isSelected }, portraitForItem(item), compactCard)
          }
        }
      })
    }

    let bodyNode: LayoutNode
    if (vp.isPortraitPhone) {
      const cardH = shortH ? 42 : 46
      const rowA = visibleItems.slice(0, 2)
      const rowB = visibleItems.slice(2, 4)
      const gridRows: LayoutNode[] = []
      if (rowA.length > 0) {
        gridRows.push(row({ id: 'codex-grid-r0', style: { height: cardH, gap: 5 } }, [
          makeEntryButton(rowA[0], 0, cardH, true),
          rowA[1] ? makeEntryButton(rowA[1], 1, cardH, true) : spacerNode()
        ]))
      }
      if (rowB.length > 0) {
        gridRows.push(row({ id: 'codex-grid-r1', style: { height: cardH, gap: 5 } }, [
          makeEntryButton(rowB[0], 2, cardH, true),
          rowB[1] ? makeEntryButton(rowB[1], 3, cardH, true) : spacerNode()
        ]))
      }
      const listSectionH = gridRows.length * cardH + Math.max(0, gridRows.length - 1) * 5 + 32
      bodyNode = column({ id: 'codex-mobile-body', style: { grow: 1, gap: 6 } }, [
        column({ id: 'codex-mobile-list', style: { height: listSectionH, gap: 5 } }, [
          ...gridRows,
          paginationBar
        ]),
        detailNode
      ])
    } else {
      const listW = vp.isLandscapePhone ? Math.round(modalW * 0.36) : tablet ? Math.round(modalW * 0.39) : 344
      const cardH = vp.isLandscapePhone
        ? Math.max(42, Math.min(48, Math.floor((bodyH - 34 - (pageSize - 1) * 4) / pageSize)))
        : Math.max(46, Math.min(54, Math.floor((bodyH - 36 - (pageSize - 1) * 5) / pageSize)))
      const entryNodes = visibleItems.map((it, idx) => makeEntryButton(it, idx, cardH, vp.isLandscapePhone))
      bodyNode = row({ id: 'codex-desktop-body', style: { grow: 1, gap: vp.isLandscapePhone ? 6 : 10, align: 'stretch' } }, [
        column({ id: 'codex-left-pane', style: { width: listW, gap: vp.isLandscapePhone ? 4 : 5 } }, [
          column({ id: 'codex-list-items', style: { grow: 1, gap: vp.isLandscapePhone ? 4 : 5 } }, entryNodes),
          paginationBar
        ]),
        detailNode
      ])
    }

    const codexTip = checkDiscoveryTipForCodex(camp) ?? getActiveScreenDiscoveryTip(camp, 'codex')
    const codexTipNodes: LayoutNode[] = codexTip
      ? [buildScreenDiscoveryTipNode('codex', codexTip, vp, {
          anchor: 'bottom-right',
          width: Math.min(w - 20, mobile ? 304 : 336),
          inset: [10, 10]
        })]
      : []

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({
        id: 'codex-scrim',
        style: { anchor: 'fill' },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            ctx.fillStyle = '#070b16d8'
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
          }
        }
      }),
      column({
        id: 'codex-modal',
        style: {
          anchor: 'center',
          width: modalW,
          height: modalH,
          padding: modalPad,
          gap: mobile ? 6 : 8,
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawModal(ctx, rect, COLOR.accent)
        }
      }, [
        // Top Header + Progress + Back button
        row({ id: 'codex-header-row', style: { height: headerH, gap: 8, align: 'center' } }, [
          boxNode({
            id: 'codex-header-info',
            style: { grow: 1, height: headerH },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawCodexHeader(ctx, rect, progress, mobile)
            }
          }),
          boxNode({
            id: 'cs-codex-close',
            style: { width: mobile ? 68 : shortH ? 84 : 108, height: mobile ? 32 : 36 },
            widget: {
              type: 'button',
              label: 'Back',
              onPress: () => closeCodex(),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Back', st, { variant: 'secondary', icon: 'close', trailing: !vp.showKeycaps || mobile || shortH ? undefined : 'Esc', size: mobile ? 11.5 : 12.5 }
              )
            }
          })
        ]),

        // 3 Tabs: Bestiary | Heroes | Gear & Drops
        row({
          id: 'codex-tab-bar',
          style: { height: tabsH, padding: [3, 4], gap: 4, align: 'center' },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSegmentTrack(ctx, rect)
          }
        }, [
          boxNode({
            id: 'cs-codex-tab-enemies',
            style: { grow: 1, height: tabsH - 6 },
            widget: {
              type: 'button',
              label: 'Bestiary',
              selected: codexTab === 'enemies',
              onPress: () => selectCodexTab('enemies'),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(
                ctx, rect, 'Bestiary', { ...st, selected: codexTab === 'enemies' },
                { icon: 'skull', count: `${progress.enemiesDiscovered}/${progress.enemiesTotal}` }
              )
            }
          }),
          boxNode({
            id: 'cs-codex-tab-heroes',
            style: { grow: 1, height: tabsH - 6 },
            widget: {
              type: 'button',
              label: 'Heroes',
              selected: codexTab === 'heroes',
              onPress: () => selectCodexTab('heroes'),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(
                ctx, rect, 'Heroes', { ...st, selected: codexTab === 'heroes' },
                { icon: 'users', count: `${progress.heroesOwned}/${progress.heroesTotal}` }
              )
            }
          }),
          boxNode({
            id: 'cs-codex-tab-gear',
            style: { grow: 1, height: tabsH - 6 },
            widget: {
              type: 'button',
              label: 'Gear & Drops',
              selected: codexTab === 'gear',
              onPress: () => selectCodexTab('gear'),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(
                ctx, rect, mobile ? 'Gear' : 'Gear & Drops', { ...st, selected: codexTab === 'gear' },
                { icon: 'bag', count: `${progress.equipmentOwned}/${progress.equipmentTotal}` }
              )
            }
          })
        ]),

        bodyNode
      ]),
      ...codexTipNodes
    ])
  }

  // =========================================================================
  // PERFORMANCE TELEMETRY OVERLAY
  // =========================================================================

  function buildPerfDebugNode(): LayoutNode {
    const snap = perf.snapshot()
    const fpsColor = snap.fps >= 55 ? COLOR.good : snap.fps >= 35 ? COLOR.accent : COLOR.danger
    const logStatus = perfLogger.serverConnected
      ? `Log: data/perf.ndjson (${perfLogger.entryCount})`
      : `Log: local (${perfLogger.entryCount})`
    return column({
      id: 'perf-debug-panel',
      hidden: !showPerfPanel,
      style: {
        anchor: screen === 'battle' ? 'top-right' : 'bottom-right',
        width: 264,
        inset: [10, screen === 'battle' ? 60 : 10],
        padding: [10, 12],
        gap: 2,
        respectSafeArea: true
      },
      widget: {
        type: 'panel',
        draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.md, lipH: 3 })
      }
    }, [
      boxNode({ id: 'pf-1', style: { height: 15 }, widget: { type: 'text', text: `FPS ${snap.fps.toFixed(1)} (min ${snap.minFps.toFixed(0)}) [${snap.backend}]`, size: 10, weight: 800, color: fpsColor, mono: true } }),
      boxNode({ id: 'pf-2', style: { height: 14 }, widget: { type: 'text', text: `Frame ${snap.frameMs.toFixed(1)}ms | p95 ${snap.p95Ms.toFixed(1)} | max ${snap.worstMs.toFixed(1)}`, size: 10, color: COLOR.text, mono: true } }),
      boxNode({ id: 'pf-3', style: { height: 14 }, widget: { type: 'text', text: `CPU sim ${snap.simMs.toFixed(2)} | 3D ${snap.renderMs.toFixed(2)} | 2D ${(snap.hudMs + snap.uiMs).toFixed(2)}ms`, size: 10, color: COLOR.muted, mono: true } }),
      boxNode({ id: 'pf-4', style: { height: 14 }, widget: { type: 'text', text: `${snap.width}x${snap.height} | DPR ${snap.dpr.toFixed(2)} | ${snap.drawCalls} draws`, size: 10, color: '#9fd3ff', mono: true } }),
      boxNode({ id: 'pf-5', style: { height: 14 }, widget: { type: 'text', text: `${Math.round(snap.triangles)} tris | ${snap.instances} inst | ${(snap.uploadBytes / 1024).toFixed(1)}KB/f`, size: 10, color: COLOR.accentHi, mono: true } }),
      ...(snap.gpu ? [boxNode({ id: 'pf-gpu', style: { height: 13 }, widget: { type: 'text', text: `GPU ${snap.gpu.slice(0, 34)}`, size: 9, color: COLOR.muted, mono: true } })] : []),
      boxNode({ id: 'pf-6', style: { height: 14 }, widget: { type: 'text', text: logStatus, size: 9.5, color: COLOR.good, mono: true } })
    ])
  }

  function buildOtaUpdateBannerNode(w: number, h: number): LayoutNode | null {
    const update = getVisibleOtaUpdate(otaState)
    if (!update) return null
    const vp = getViewportProfile(w, h)
    const bannerW = Math.min(w - Math.max(20, vp.safeArea.left + vp.safeArea.right + 16), 416)
    const bannerH = vp.isTouchPrimary ? 46 : 42
    const btnH = vp.isTouchPrimary ? 32 : 30
    const subtitle = update.channel === 'prod'
      ? 'Restart now to update'
      : `Restart to apply · ${formatShortOtaVersion(update.version)}`

    return row({
      id: 'cs-ota-banner',
      style: {
        anchor: 'top',
        width: bannerW,
        height: bannerH,
        inset: 6,
        padding: [Math.round((bannerH - btnH - 3) / 2), 8, Math.round((bannerH - btnH + 3) / 2), 8],
        gap: 6,
        respectSafeArea: true
      },
      widget: {
        type: 'panel',
        blocksPointer: true,
        draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawOtaUpdateBanner(ctx, rect, {
          title: 'Update Available',
          subtitle
        })
      }
    }, [
      spacerNode(1),
      boxNode({
        id: 'cs-ota-restart',
        style: { width: otaState.applying ? 96 : 84, height: btnH },
        widget: {
          type: 'button',
          label: otaState.applying ? 'Restarting' : 'Restart',
          primary: true,
          disabled: otaState.applying,
          onPress: triggerOtaRestart,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, otaState.applying ? 'Restarting...' : 'Restart', st, { variant: 'primary', size: 11.5 }
          )
        }
      }),
      boxNode({
        id: 'cs-ota-dismiss',
        style: { width: btnH, height: btnH },
        widget: {
          type: 'button',
          label: 'Dismiss update notification',
          onPress: () => {
            otaState = dismissOtaBanner(otaState)
            uiDirty = true
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(
            ctx, rect, 'close', st, { active: false }
          )
        }
      })
    ])
  }

  function buildUiTree(w: number, h: number): LayoutNode {
    getViewportProfile(w, h)
    const base = screen === 'title' ? buildTitleTree(w, h)
      : screen === 'world' ? buildWorldMapTree(w, h)
      : screen === 'story' ? buildStoryTree(w, h)
      : screen === 'battle' ? buildBattleTree(w, h)
      : screen === 'camp' ? buildCampTree(w, h)
      : screen === 'codex' ? buildCodexTree(w, h)
      : screen === 'victory' ? buildResultTree(w, h, true)
      : screen === 'defeat' ? buildResultTree(w, h, false)
      : buildPausedTree(w, h)
    const otaBanner = buildOtaUpdateBannerNode(w, h)
    if (!showPerfPanel && !otaBanner) return base
    const layers: LayoutNode[] = [base]
    if (otaBanner) layers.push(otaBanner)
    if (showPerfPanel) layers.push(buildPerfDebugNode())
    return overlay({ id: 'root-overlay', style: { anchor: 'fill' } }, layers)
  }

  // =========================================================================
  // WORLD-SPACE BATTLE HUD (HP BARS, FLOATING DAMAGE, TERRAIN PILL, BANNER)
  // =========================================================================

  function paintHud(g: HudPainter) {
    const battle = state.battle
    if (screen !== 'battle' || !battle) return

    const hovered = scene.getHoveredCell()
    const hoveredEnemy = hovered && hovered.row < battle.rows && hovered.col < battle.cols
      ? unitAt(battle, hovered.col, hovered.row)
      : undefined
    const selectedUnit = getUnitByUid(battle, battle.selectedUnitUid)
    const inspectedEnemy = hoveredEnemy?.team === 'enemy' && !isEnemyShrouded(battle, hoveredEnemy)
      ? hoveredEnemy
      : selectedUnit?.team === 'enemy' && !isEnemyShrouded(battle, selectedUnit)
        ? selectedUnit
        : undefined
    const dangerMap = dangerZoneOn ? computeDangerZone(battle) : null
    const allyFlankRisk = new Map<string, 'flank' | 'back'>()
    if (dangerMap) {
      for (const et of dangerMap.enemyThreats) {
        for (const ft of et.flankThreatTiles) {
          const prev = allyFlankRisk.get(ft.targetUid)
          if (!prev || ft.arc === 'back') allyFlankRisk.set(ft.targetUid, ft.arc)
        }
      }
    }
    if (inspectedEnemy) {
      const et = computeEnemyThreat(battle, inspectedEnemy.uid)
      for (const ft of et.flankThreatTiles) {
        const prev = allyFlankRisk.get(ft.targetUid)
        if (!prev || ft.arc === 'back') allyFlankRisk.set(ft.targetUid, ft.arc)
      }
    }

    const activeForOverlay = getUnitByUid(battle, battle.activeUnitUid)
    const armedSkillForOverlay = activeForOverlay && battle.armedSkillIndex !== null && battle.armedSkillIndex >= 0
      ? getHeroSkill(activeForOverlay, battle.armedSkillIndex)
      : null
    const armedTacticForOverlay = battle.armedTacticUid
      ? (() => {
          const owned = getTacticByUid(state.campaign, battle.armedTacticUid)
          return owned ? TACTIC_BY_ID[owned.tacticId] : null
        })()
      : null
    const canReviveArmedOverlay = Boolean(armedSkillForOverlay?.canRevive || armedTacticForOverlay?.canRevive)

    for (const u of battle.units) {
      if (isUnitDowned(u)) {
        const projected = scene.project(u.x, u.y + 1.38, u.z, g.width, g.height)
        if (!projected) continue
        const cd = Math.max(1, Math.min(3, u.koCountdown))
        const shortName = u.name.split(' ').pop() ?? u.name
        const badgeFill = cd === 1 ? '#5e1422e8' : cd === 2 ? '#59260ae8' : '#4a3109e8'
        const badgeStroke = cd === 1 ? '#ff4d63' : cd === 2 ? '#ff943b' : '#ffd24d'
        const badgeText = cd === 1 ? '#ffd0d6' : cd === 2 ? '#ffe0bd' : '#fff0b3'
        const koLabel = `☠ KO ${cd}`
        const pw = 66
        const ph = 22
        const px = Math.round(projected.x - pw / 2)
        const py = Math.round(projected.y - ph / 2)

        g.text(shortName, projected.x, py - 12.5, { fill: '#080c18', size: 10, weight: 900, align: 'center' })
        g.text(shortName, projected.x, py - 14, { fill: badgeText, size: 10, weight: 900, align: 'center' })

        g.panel(px, py, pw, ph, { fill: badgeFill, stroke: badgeStroke, radius: 10 })
        g.text(koLabel, projected.x, py + 4.5, { fill: badgeText, size: 11, weight: 900, align: 'center' })

        // 3 countdown pip dots under the pill
        const pipGap = 9
        const pipStartX = projected.x - pipGap
        for (let i = 0; i < 3; i++) {
          const lit = i < cd
          g.panel(Math.round(pipStartX + i * pipGap - 3), py + ph + 3, 6, 4, {
            fill: lit ? badgeStroke : '#1b243b',
            radius: 2
          })
        }
        if (canReviveArmedOverlay) {
          const rw = 54
          g.panel(Math.round(projected.x - rw / 2), py + ph + 10, rw, 15, {
            fill: '#144a38e8',
            stroke: '#ffe378',
            radius: 7
          })
          g.text('REVIVE', projected.x, py + ph + 12.5, { fill: '#ffe88a', size: 8.5, weight: 900, align: 'center' })
        }
        continue
      }
      if (!u.alive) continue
      if (isEnemyShrouded(battle, u)) continue
      const projected = scene.project(u.x, u.y + (u.isBoss ? 2.25 : 1.88), u.z, g.width, g.height)
      if (!projected) continue
      const isActive = u.uid === battle.activeUnitUid
      const isSpotlight = u.uid === hoveredTurnUnitUid
      const bw = u.isBoss ? 90 : 66
      const bx = Math.round(projected.x - bw / 2)
      const by = Math.round(projected.y - 16)
      const hpRatio = Math.max(0, Math.min(1, u.hp / Math.max(1, u.maxHp)))

      const shortName = u.team === 'ally' ? (u.name.split(' ').pop() ?? u.name) : u.name
      const isBossPhase2 = u.isBoss && (u.bossPhase ?? 1) >= 2
      const tag = u.team === 'ally' && u.stars > 1
        ? `${shortName} T${u.stars}`
        : isBossPhase2
          ? `${shortName} · P2`
          : shortName
      const spotRank = isSpotlight && hoveredTurnSlotIdx >= 0 ? (hoveredTurnSlotIdx === 0 ? ' · NOW' : ` · #${hoveredTurnSlotIdx + 1}`) : ''
      const fullTag = `${tag}${spotRank}`
      const nameW = Math.max(bw + 8, fullTag.length * 6.8 + 16)
      if (isSpotlight || isActive || isBossPhase2) {
        g.panel(Math.round(projected.x - nameW / 2), by - 21, Math.round(nameW), 17, {
          fill: isSpotlight ? (u.team === 'ally' ? '#1b4768' : '#572230') : isBossPhase2 ? '#5c1430' : '#2b3a63',
          stroke: isSpotlight ? (u.team === 'ally' ? '#7cf0ff' : '#ff9c6e') : COLOR.accent,
          radius: 8
        })
      }
      g.text(fullTag, projected.x, by - 16.5, {
        fill: '#080c18',
        size: isSpotlight || isActive || isBossPhase2 ? 11 : 10.5,
        weight: 900,
        align: 'center'
      })
      g.text(fullTag, projected.x, by - 18, {
        fill: isSpotlight ? '#ffffff' : isBossPhase2 ? '#ffe078' : isActive ? COLOR.accentHi : u.team === 'ally' ? '#ffffff' : '#ffd2d6',
        size: isSpotlight || isActive || isBossPhase2 ? 11 : 10.5,
        weight: 900,
        align: 'center'
      })

      // Chunky dark-outlined tactical HP + Shield + CT gauge
      g.panel(bx - 2, by - 2, bw + 4, 13, {
        fill: '#0b1020',
        stroke: isSpotlight ? (u.team === 'ally' ? '#7cf0ff' : '#ff9c6e') : isBossPhase2 ? COLOR.accent : isActive ? COLOR.accent : u.team === 'ally' ? '#5cb8ff' : '#ff5e6e',
        radius: 5
      })
      g.panel(bx, by, bw, 7, { fill: '#18213b', radius: 3 })
      const fillW = Math.round(bw * hpRatio)
      if (fillW > 0) {
        const hpFill = u.team === 'enemy' ? COLOR.enemy : hpRatio <= 0.3 ? COLOR.danger : hpRatio <= 0.6 ? '#ffba42' : COLOR.good
        g.panel(bx, by, fillW, 7, { fill: hpFill, radius: 3 })
        g.panel(bx + 1, by + 1, Math.max(2, fillW - 2), 2, { fill: '#ffffff44', radius: 1 })
      }
      if (u.shield > 0) {
        const shRatio = Math.min(1, u.shield / Math.max(1, u.maxHp))
        g.panel(bx, by + 4, Math.max(5, Math.round(bw * shRatio)), 3, { fill: COLOR.ap, radius: 1.5 })
      }
      const ctRatio = Math.max(0, Math.min(1, u.ct / 100))
      const ctW = Math.round(bw * ctRatio)
      if (ctW > 0) {
        g.panel(bx, by + 8, ctW, 2, { fill: COLOR.accentHi, radius: 1 })
      }

      const statuses: string[] = []
      if (u.tauntTurns > 0) statuses.push('TAUNT')
      if (u.hasteTurns > 0) statuses.push('HASTE')
      if (u.poisonStacks > 0) statuses.push(`PSN x${u.poisonStacks}`)
      if (u.burnTurns > 0) statuses.push('BURN')
      if (u.slowTurns > 0) statuses.push('SLOW')
      if (u.stunTurns > 0) statuses.push('STUN')
      if (u.empowerTurns > 0) statuses.push('BUFF')
      if (statuses.length) {
        const stText = statuses.join(' ')
        const sw = stText.length * 6.4 + 12
        g.panel(Math.round(projected.x - sw / 2), by + 13, Math.round(sw), 15, { fill: '#1a2442', stroke: COLOR.accent, radius: 7 })
        g.text(stText, projected.x, by + 15.5, { fill: COLOR.accentHi, size: 8.5, weight: 900, align: 'center' })
      }
      const flankRisk = u.team === 'ally' ? allyFlankRisk.get(u.uid) : undefined
      if (flankRisk) {
        const warnText = flankRisk === 'back' ? 'BACKSTAB!' : 'FLANK!'
        const ww = warnText.length * 6.4 + 14
        const wyOff = statuses.length ? 30 : 13
        g.panel(Math.round(projected.x - ww / 2), by + wyOff, Math.round(ww), 15, {
          fill: flankRisk === 'back' ? '#5e1438' : '#4a320c',
          stroke: flankRisk === 'back' ? '#ff5ca8' : '#ffd15c',
          radius: 7
        })
        g.text(warnText, projected.x, by + wyOff + 2.5, {
          fill: flankRisk === 'back' ? '#ffd6ec' : '#fff0b3',
          size: 8.5,
          weight: 900,
          align: 'center'
        })
      }
    }

    for (const fn of battle.floatingNumbers) {
      const p = scene.project(fn.x, fn.y, fn.z, g.width, g.height)
      if (!p) continue
      g.text(fn.text, p.x, p.y + 2, { fill: '#090d1a', size: 17, weight: 900, align: 'center' })
      g.text(fn.text, p.x, p.y, { fill: fn.color, size: 17, weight: 900, align: 'center' })
    }

    // World-space Wait-to-Face directional arrow badges & live exposure warnings
    if (battle.facingPicker && battle.phase === 'player') {
      const pickerUnit = getUnitByUid(battle, battle.facingPicker.unitUid)
      if (pickerUnit && pickerUnit.alive) {
        const exposures = evaluateAllFacingExposures(battle, pickerUnit.uid)
        for (const dir of FACING_DIRS) {
          const [ax, ay, az] = facingPickerAnchor(battle, pickerUnit, dir)
          const p = scene.project(ax, ay + 0.22, az, g.width, g.height)
          if (!p) continue
          const exp = exposures[dir]
          const isSel = battle.facingPicker.previewFacing === dir
          const dirChar = dir.toUpperCase()
          const tag = exp.level === 'back'
            ? `${dirChar} · BACK!`
            : exp.level === 'flank'
              ? `${dirChar} · FLANK`
              : isSel
                ? `${dirChar} · SAFE`
                : dirChar
          const pw = Math.max(isSel ? 54 : 26, Math.round(tag.length * 6.5 + 14))
          const ph = isSel ? 21 : 18
          const fill = exp.level === 'back'
            ? (isSel ? '#6e1622' : '#4a121de6')
            : exp.level === 'flank'
              ? (isSel ? '#66410c' : '#472f0de6')
              : (isSel ? '#124a3de6' : '#1b2848e0')
          const stroke = exp.level === 'back'
            ? COLOR.danger
            : exp.level === 'flank'
              ? '#ffaa2b'
              : isSel
                ? COLOR.good
                : COLOR.borderHi
          const textColor = exp.level === 'back'
            ? '#ffd0d4'
            : exp.level === 'flank'
              ? '#ffe2a6'
              : isSel
                ? '#c8ffe8'
                : '#e6f2ff'
          const bx = Math.round(p.x - pw / 2)
          const by = Math.round(p.y - ph / 2)
          g.panel(bx, by, pw, ph, { fill, stroke, radius: Math.round(ph / 2) })
          g.text(tag, p.x, by + (isSel ? 5 : 3.5), { fill: textColor, size: isSel ? 10 : 9.5, weight: 900, align: 'center' })
        }
        const centerP = scene.project(pickerUnit.x, pickerUnit.y + 0.14, pickerUnit.z, g.width, g.height)
        if (centerP) {
          const cTag = 'CONFIRM'
          const cw = 64
          const ch = 18
          g.panel(Math.round(centerP.x - cw / 2), Math.round(centerP.y + 6), cw, ch, {
            fill: '#2b3a63e8',
            stroke: COLOR.accent,
            radius: 9
          })
          g.text(cTag, centerP.x, Math.round(centerP.y + 10), { fill: COLOR.accentHi, size: 9, weight: 900, align: 'center' })
        }
      }
    }

    // World-space Objective Marker Labels (SEIZE, CHEST, DEFEND, TARGET)
    if (battle.phase === 'deploy' || battle.phase === 'player' || battle.phase === 'enemy') {
      const obj = battle.objective
      if (obj.kind === 'seize' && obj.goalTile) {
        const gCell = battle.cells[obj.goalTile.row]?.[obj.goalTile.col]
        if (gCell && gCell.terrain !== 'void') {
          const [gx, gy, gz] = gridToWorld(obj.goalTile.col, obj.goalTile.row, gCell.elevation, battle.cols, battle.rows)
          const p = scene.project(gx, gy + 1.95, gz, g.width, g.height)
          if (p) {
            const label = 'SEIZE'
            const pw = 54
            g.panel(Math.round(p.x - pw / 2), Math.round(p.y - 10), pw, 18, { fill: '#3d2f12e8', stroke: COLOR.accentHi, radius: 9 })
            g.text(label, p.x, Math.round(p.y - 5.5), { fill: COLOR.accentHi, size: 9.5, weight: 900, align: 'center' })
          }
        }
      }
      if (obj.kind === 'seize' && obj.chestTiles.length > 0) {
        for (const ct of obj.chestTiles) {
          if (isChestClaimed(obj, ct.col, ct.row)) continue
          const cCell = battle.cells[ct.row]?.[ct.col]
          if (!cCell || cCell.terrain === 'void') continue
          const [cx, cy, cz] = gridToWorld(ct.col, ct.row, cCell.elevation, battle.cols, battle.rows)
          const p = scene.project(cx, cy + 1.05, cz, g.width, g.height)
          if (p) {
            const pw = 52
            g.panel(Math.round(p.x - pw / 2), Math.round(p.y - 9), pw, 17, { fill: '#3d2a12e4', stroke: '#ffd44f', radius: 8 })
            g.text('CHEST', p.x, Math.round(p.y - 5), { fill: '#ffe585', size: 9, weight: 900, align: 'center' })
          }
        }
      }
      if (obj.kind === 'defend' && obj.protectTile) {
        const pCell = battle.cells[obj.protectTile.row]?.[obj.protectTile.col]
        if (pCell && pCell.terrain !== 'void') {
          const [px, py, pz] = gridToWorld(obj.protectTile.col, obj.protectTile.row, pCell.elevation, battle.cols, battle.rows)
          const p = scene.project(px, py + 1.85, pz, g.width, g.height)
          if (p) {
            const label = obj.protectBreached ? 'BREACHED!' : 'DEFEND'
            const pw = obj.protectBreached ? 72 : 62
            g.panel(Math.round(p.x - pw / 2), Math.round(p.y - 10), pw, 18, {
              fill: obj.protectBreached ? '#5c1420e8' : '#12394ae8',
              stroke: obj.protectBreached ? COLOR.danger : '#5eeeff',
              radius: 9
            })
            g.text(label, p.x, Math.round(p.y - 5.5), { fill: obj.protectBreached ? '#ffd6dc' : '#b8f8ff', size: 9.5, weight: 900, align: 'center' })
          }
        }
      }
      if (obj.kind === 'assassinate' && obj.targetEnemyUid) {
        const tUnit = getUnitByUid(battle, obj.targetEnemyUid)
        if (tUnit && tUnit.alive && !isEnemyShrouded(battle, tUnit)) {
          const p = scene.project(tUnit.x, tUnit.y + (tUnit.isBoss ? 2.95 : 2.45), tUnit.z, g.width, g.height)
          if (p) {
            const pw = 62
            g.panel(Math.round(p.x - pw / 2), Math.round(p.y - 10), pw, 18, { fill: '#571524e8', stroke: '#ff5266', radius: 9 })
            g.text('TARGET', p.x, Math.round(p.y - 5.5), { fill: '#ffd4da', size: 9.5, weight: 900, align: 'center' })
          }
        }
      }
    }

    // World-space subtle HP bar & shatter indicator for hovered, damaged, or AoE-targeted destructible cover
    if (battle.phase === 'deploy' || battle.phase === 'player' || battle.phase === 'enemy') {
      const fcForCover = resolveActiveForecast()
      const forecastCoverMap = new Map<string, { willShatter: boolean; hpAfter: number }>()
      if (fcForCover?.coverHits) {
        for (const ch of fcForCover.coverHits) {
          forecastCoverMap.set(`${ch.col},${ch.row}`, { willShatter: ch.willShatter, hpAfter: ch.hpAfter })
        }
      }
      for (let r = 0; r < battle.rows; r++) {
        for (let c = 0; c < battle.cols; c++) {
          const cell = battle.cells[r]?.[c]
          if (!cell || !isDestructibleCover(cell)) continue
          const hpInfo = getCoverHp(cell)
          if (!hpInfo) continue
          const isHov = Boolean(hovered && hovered.col === c && hovered.row === r)
          const fcHit = forecastCoverMap.get(`${c},${r}`)
          const isDamaged = hpInfo.hp < hpInfo.maxHp
          if (!isHov && !isDamaged && !fcHit) continue
          const [wx, wy, wz] = gridToWorld(c, r, cell.elevation, battle.cols, battle.rows)
          const barHeightOff = hpInfo.kind === 'cracked_pillar' ? 1.62 : 1.24
          const p = scene.project(wx, wy + barHeightOff, wz, g.width, g.height)
          if (!p) continue
          const bw = g.width < 480 ? 40 : 48
          const bx = Math.round(p.x - bw / 2)
          const by = Math.round(p.y - 6)
          const ratio = Math.max(0, Math.min(1, hpInfo.hp / Math.max(1, hpInfo.maxHp)))
          const willShatter = Boolean(fcHit?.willShatter)
          g.panel(bx - 2, by - 2, bw + 4, 10, {
            fill: '#0b1020e6',
            stroke: willShatter ? '#ff6b42' : hpInfo.kind === 'cracked_pillar' ? '#d4b888' : '#c9884a',
            radius: 4
          })
          g.panel(bx, by, bw, 6, { fill: '#1a2238', radius: 2 })
          const fw = Math.round(bw * ratio)
          if (fw > 0) {
            const fillCol = willShatter ? '#ff5c42' : ratio <= 0.5 ? '#ff9c38' : '#e0bd72'
            g.panel(bx, by, fw, 6, { fill: fillCol, radius: 2 })
          }
          if (fcHit) {
            const tag = willShatter ? 'SHATTER!' : `${hpInfo.hp}→${fcHit.hpAfter}`
            const tw = Math.max(46, Math.round(tag.length * 6.0 + 10))
            g.panel(Math.round(p.x - tw / 2), by - 16, tw, 13, {
              fill: willShatter ? '#6e1e12eb' : '#3d2c12e8',
              stroke: willShatter ? '#ff7a4a' : '#ffbf54',
              radius: 6
            })
            g.text(tag, p.x, by - 13.5, {
              fill: willShatter ? '#ffe0c4' : '#ffeaad',
              size: 8.5,
              weight: 900,
              align: 'center'
            })
          }
        }
      }
    }

    if (hovered && !battle.facingPicker && g.width >= 660) {
      const cell = battle.cells[hovered.row]?.[hovered.col]
      if (cell && cell.terrain !== 'void') {
        const coverTip = formatCoverTooltip(cell, g.width < 880)
        const baseDesc = coverTip ?? (TERRAIN_LABEL[cell.terrain] ?? cell.terrain)
        const stateSuffix = coverTip
          ? ''
          : cell.terrain === 'lava_geyser'
            ? (cell.geyserActive ? ' [ERUPTING!]' : ' [Dormant]')
            : cell.terrain === 'cursed_altar'
              ? (cell.altarUsed ? ' [Spent]' : ' [Active Pact]')
              : cell.coverShattered
                ? ' [Rubble]'
                : ''
        const desc = `${baseDesc}${stateSuffix}`
        const hLvl = cellHeightLevel(cell)
        const dzTile = dangerMap?.tiles.find(t => t.col === hovered.col && t.row === hovered.row)
        const deployTag = battle.phase === 'deploy' && isDeployTile(battle, hovered.col, hovered.row) ? ' · DEPLOY ZONE' : ''
        const activeForecastForTip = resolveActiveForecast()
        const hoveredOa = resolveHoveredMoveOa(activeForecastForTip)
        const enemyZocTiles = battle.phase === 'player' ? computeZocPerimeterTiles(battle, 'enemy') : []
        const inEnemyZoc = enemyZocTiles.some(z => z.col === hovered.col && z.row === hovered.row)
        const oaTag = hoveredOa && hoveredOa.triggers.length > 0
          ? ` · ${formatOpportunityWarning(hoveredOa)}`
          : inEnemyZoc
            ? ' · ENEMY ZoC'
            : ''
        const hoveredTelegraphs = getTelegraphsAtCell(battle.bossTelegraphs, hovered.col, hovered.row)
        const telegraphTag = hoveredTelegraphs.length > 0
          ? ` · ⚠ ${hoveredTelegraphs[0].label}!`
          : ''
        const threatTag = dzTile
          ? dzTile.hasBackstabRisk
            ? ` · Threat x${dzTile.threatCount} BACKSTAB!`
            : dzTile.hasFlankRisk
              ? ` · Threat x${dzTile.threatCount} FLANK!`
              : ` · Threat x${dzTile.threatCount}`
          : ''
        const text = `${desc} · H${hLvl} (${hovered.col + 1},${hovered.row + 1})${deployTag}${oaTag}${telegraphTag}${threatTag}`
        const maxTipW = Math.min(560, Math.max(180, g.width - 20))
        const pw = Math.min(maxTipW, Math.max(148, text.length * 6.6 + 24))
        const py = g.height < 480 ? g.height - 134 : g.height - 178
        const hasOaWarn = Boolean(hoveredOa && hoveredOa.triggers.length > 0)
        const hasTgWarn = hoveredTelegraphs.length > 0
        g.panel(10, py, pw, 28, {
          fill: hasTgWarn ? '#591432' : hasOaWarn ? '#4a1d14' : dzTile ? '#3d1e2e' : deployTag ? '#1b365e' : coverTip ? '#3b2e1e' : '#253357',
          stroke: hasTgWarn ? '#ff6ec7' : hasOaWarn ? '#ff7a2b' : dzTile ? '#ff7d6b' : deployTag ? '#68c8ff' : coverTip ? '#e6b86a' : COLOR.borderHi,
          radius: 10
        })
        g.text(text, 22, py + 8, { fill: hasTgWarn ? '#ffe0f2' : hasOaWarn ? '#ffe2b8' : coverTip ? '#fff2d1' : '#ffffff', size: 11.5, weight: 800, maxWidth: pw - 24 })
      }
    }

    if (battle.bannerTimer > 0 && battle.bannerText) {
      const isNarrowPhone = g.width < 430
      const isPhoneW = g.width < 660
      const isCompactH = g.height < 480
      const isBossBanner =
        battle.bannerText.includes('Phase II') ||
        battle.bannerText.includes('PHASE 2') ||
        battle.bannerText.includes('SOLAR ECLIPSE') ||
        battle.bannerText.startsWith('⚠')
      const bannerFont = isNarrowPhone ? 11.5 : isPhoneW || isCompactH ? 13 : 15
      const bh = isNarrowPhone ? 32 : isCompactH ? 32 : 38
      const bw = Math.min(g.width - 24, Math.max(isNarrowPhone ? 196 : 240, Math.round(battle.bannerText.length * (bannerFont * 0.66) + 36)))
      const bx = Math.max(12, Math.round((g.width - bw) / 2))
      const by = isPhoneW ? 176 : isCompactH ? 58 : 92
      const textY = by + Math.round((bh - bannerFont) * 0.5)
      g.panel(bx, by, bw, bh, {
        fill: isBossBanner ? '#4f142e' : '#283863',
        stroke: isBossBanner ? '#ff70a6' : COLOR.accent,
        radius: Math.min(14, Math.round(bh * 0.4))
      })
      g.text(battle.bannerText, g.width / 2, textY + 1.5, {
        fill: '#090d1a',
        size: bannerFont,
        weight: 900,
        align: 'center',
        maxWidth: bw - 20
      })
      g.text(battle.bannerText, g.width / 2, textY, {
        fill: isBossBanner ? '#ffe078' : COLOR.accentHi,
        size: bannerFont,
        weight: 900,
        align: 'center',
        maxWidth: bw - 20
      })
    }
  }

  let lastBattlePhase: string | null = null
  let lastActiveUid: string | null = null
  let lastBattleTurn = 0

  function syncUi(force = false) {
    const canvas = renderer.canvas
    const rendered = ui.sync(buildUiTree, {
      width: Math.max(1, canvas.clientWidth),
      height: Math.max(1, canvas.clientHeight),
      dirty: uiDirty,
      force
    })
    if (rendered) uiDirty = false
  }
  const renderUiNow = () => syncUi(true)

  ui.exposeGlobal({
    property: ['__ridgetopUi', '__CROWNSHARD__'],
    aliases: ACT_ID_ALIASES,
    onAct: () => {
      uiDirty = true
      hudRev++
    },
    renderNow: phase => {
      if (phase === 'before') syncUi(false)
      else if (uiDirty || ui.dirty) syncUi(true)
    },
    getState: () => ({
      screen,
      campTab,
      backend: renderer.name,
      showPerfPanel,
      fps: Math.round(perf.snapshot().fps),
      gold: state.campaign.gold,
      dust: state.campaign.dust,
      shards: state.campaign.shards,
      packsSinceEpic: state.campaign.packsSinceEpic,
      packsSinceLegendary: state.campaign.packsSinceLegendary,
      pity: getPackPityStatus(state.campaign),
      chaptersCleared: state.campaign.chaptersCleared,
      clearedStageIds: state.campaign.clearedStageIds.slice(),
      clearedStageTiers: { ...state.campaign.clearedStageTiers },
      selectedStageId: state.campaign.selectedStageId,
      worldInspectorTab: activeWorldInspectorTab,
      worldEventsCount: state.campaign.worldEvents.length,
      selectedWorldEventId,
      activeWorldEventId: state.battle?.activeWorldEventId ?? null,
      battleDifficultyTier: state.battle?.difficultyTier ?? null,
      battleMutators: state.battle ? state.battle.mutators.slice() : [],
      battleWeather: state.battle?.weather ?? null,
      battleTimeOfDay: state.battle?.timeOfDay ?? null,
      weatherInspectorOpen,
      packAnimPhase: packAnim?.phase ?? null,
      resultAnimTime: Math.round(resultAnimTime * 100) / 100,
      heroesCount: state.campaign.heroes.length,
      equipmentCount: state.campaign.equipment.length,
      tacticsCount: state.campaign.tactics.length,
      deckValue: computeDeckValue(state.campaign),
      battlePhase: state.battle?.phase ?? null,
      battleObjective: state.battle ? { kind: state.battle.objective.kind, label: state.battle.objective.label, progress: getObjectiveProgressText(state.battle) } : null,
      deployTilesCount: state.battle?.deployTiles.length ?? 0,
      battleCols: state.battle?.cols ?? 0,
      battleRows: state.battle?.rows ?? 0,
      battleTurn: state.battle?.turn ?? 0,
      battleAp: state.battle?.ap ?? 0,
      activeUnitUid: state.battle?.activeUnitUid ?? null,
      facingPicker: state.battle?.facingPicker ? { ...state.battle.facingPicker } : null,
      hoveredTurnUnitUid,
      hoveredArmoryEquipUid,
      inspectedArmoryEquipUid,
      selectedEquipUpgradeLevel: (() => {
        const uid = inspectedArmoryEquipUid ?? hoveredArmoryEquipUid
        const eq = getEquipmentByUid(state.campaign, uid)
        return eq ? normalizeEquipUpgradeLevel(eq.upgradeLevel) : null
      })(),
      upgradedEquipCount: countUpgradedEquipment(state.campaign),
      canUpgradeSelectedEquip: (() => {
        const uid = inspectedArmoryEquipUid ?? hoveredArmoryEquipUid
        const preview = uid ? getEquipUpgradePreview(state.campaign, uid) : null
        return Boolean(preview && (preview.canFuseDuplicate || preview.canGoldReforge))
      })(),
      selectedHeroEquipFamily: (() => {
        const h = getHeroByUid(state.campaign, state.campaign.selectedCampHeroUid) ?? state.campaign.heroes[0]
        return h ? getHeroEquipFamily(h.heroId) : null
      })(),
      selectedHeroActiveSets: (() => {
        const h = getHeroByUid(state.campaign, state.campaign.selectedCampHeroUid) ?? state.campaign.heroes[0]
        return h ? getHeroActiveGearSetIds(state.campaign, h) : []
      })(),
      selectedHeroSubSpecId: (() => {
        const h = getHeroByUid(state.campaign, state.campaign.selectedCampHeroUid) ?? state.campaign.heroes[0]
        return h?.subSpecId ?? null
      })(),
      selectedHeroNeedsSubSpec: (() => {
        const h = getHeroByUid(state.campaign, state.campaign.selectedCampHeroUid) ?? state.campaign.heroes[0]
        return h ? needsSubSpecChoice(h) : false
      })(),
      armoryCompatibleFilter,
      turnOrder: state.battle?.turnOrder.map(t => t.name) ?? [],
      battleAlliesAlive: state.battle ? state.battle.units.filter(u => u.alive && u.team === 'ally').length : 0,
      battleAlliesDowned: state.battle ? state.battle.units.filter(u => isUnitDowned(u)).length : 0,
      battleEnemiesAlive: state.battle ? state.battle.units.filter(u => u.alive && u.team === 'enemy').length : 0,
      destructibleCoverCount: countBattleDestructibleCover(state.battle).intactCount,
      shatteredCoverCount: countBattleDestructibleCover(state.battle).shatteredCount,
      activeTipId: getActiveDiscoveryTip(state)?.id ?? null,
      seenTips: state.campaign.seenTips.slice(),
      tipsDisabled: state.campaign.tipsDisabled === true,
      discoveredEnemies: state.campaign.discoveredEnemies.slice(),
      codexTab,
      codexProgress: getCodexProgress(state.campaign),
      hasResumableBattle: Boolean(resumableBattle),
      resumableBattleTurn: resumableBattle?.turn ?? 0,
      resumableBattleStageId: resumableBattle?.stageId ?? null,
      moveAttackTargets: state.battle ? state.battle.moveAttackTiles.map(t => ({ col: t.col, row: t.row, fromCol: t.fromCol, fromRow: t.fromRow })) : [],
      canUndoMove: canUndoMove(state.battle),
      dangerZoneOn,
      bossTelegraphCount: state.battle ? state.battle.bossTelegraphs.length : 0,
      bossTelegraphTilesCount: state.battle ? countUniqueTelegraphTiles(state.battle.bossTelegraphs) : 0,
      bossPhaseMax: state.battle ? getMaxLivingBossPhase(state.battle) : 0,
      battleSpeed: state.battle?.battleSpeed ?? state.campaign.battleSpeed,
      autoBattle: state.battle?.autoBattle ?? false,
      activeBondPairsCount: state.battle ? state.battle.bondPairsActive.length : getSquadBondSummary(state.campaign).length,
      totalBondRanks: getTotalBondRanks(state.campaign.heroBonds),
      activeBanterText: state.battle?.activeBanter?.text ?? null,
      mobileHandOpen,
      campCollapsed: mobileCampCollapsed,
      focusMode,
      turnTimelineExpanded,
      inputModality: modalityTracker.getModality(),
      worldMapRevealed: isWorldMapRevealed(state.campaign),
      cameraZoom: Math.round(scene.getCameraZoom() * 1000) / 1000,
      cameraYaw: Math.round(scene.getCameraYaw() * 1000) / 1000,
      gridCursor: {
        active: gridCursor.active,
        col: gridCursor.col,
        row: gridCursor.row,
        inputMode: gridCursor.inputMode
      }
    }),
    extra: {
      perf: () => perf.snapshot(),
      perfLog: () => perfLogger.getHistory(),
      openWorldMap: (stageId?: string) => {
        openWorldMap(stageId)
        renderUiNow()
      },
      setWorldMapView: (panX: number, panY: number, zoom: number) => {
        focusDioramaOnStage(worldMap3DCam, panX, panY, zoom, true)
        uiDirty = true
        renderUiNow()
      },
      openCamp: (tab: CampTab = 'squad') => {
        openCamp(tab)
        renderUiNow()
      },
      openCodex: (tab?: CodexTab) => {
        openCodex(tab)
        renderUiNow()
      },
      skipPackAnim: () => {
        skipPackCeremony()
        renderUiNow()
      },
      zoom: (z: number) => {
        scene.setCameraZoom(z)
        uiDirty = true
        hudRev++
        renderUiNow()
        return scene.getCameraZoom()
      },
      snapCameraYaw: (steps: number) => {
        const yaw = scene.snapCameraYaw(steps)
        uiDirty = true
        hudRev++
        renderUiNow()
        return yaw
      },
      setCameraYaw: (rad: number, instant = false) => {
        const yaw = scene.setCameraYaw(rad, instant)
        uiDirty = true
        hudRev++
        renderUiNow()
        return yaw
      },
      autoEquip: (heroUid?: string) => {
        const uid = heroUid ?? state.campaign.selectedCampHeroUid ?? state.campaign.heroes[0]?.uid
        if (!uid) return 0
        const count = runBestFit(uid)
        renderUiNow()
        return count
      },
      selectHeroSubSpec: (subSpecId: HeroSubSpecId, heroUid?: string) => {
        const uid = heroUid ?? state.campaign.selectedCampHeroUid ?? state.campaign.heroes[0]?.uid
        if (!uid) return false
        const ok = selectHeroSubSpec(state, uid, subSpecId)
        if (ok) { saveNow(); uiDirty = true; renderUiNow() }
        return ok
      },
      selectTile: (col: number, row: number) => {
        lockedForecastCell = null
        const ok = selectTile(state, col, row)
        if (ok) { uiDirty = true; hudRev++; renderUiNow() }
        return ok
      },
      confirmDeployment: () => {
        const ok = confirmDeployAndStart()
        if (ok) renderUiNow()
        return ok
      },
      moveDeployUnit: (unitUid: string, col: number, row: number) => {
        const ok = moveDeployUnit(state, unitUid, col, row)
        if (ok) { uiDirty = true; hudRev++; renderUiNow() }
        return ok
      },
      swapDeployUnit: (uidA: string, uidB: string) => {
        const ok = swapDeployUnit(state, uidA, uidB)
        if (ok) { uiDirty = true; hudRev++; renderUiNow() }
        return ok
      },
      rotateDeployUnit: (unitUid?: string, dir?: FacingDir) => {
        const ok = rotateDeployUnit(state, unitUid, dir)
        if (ok) { uiDirty = true; hudRev++; renderUiNow() }
        return ok
      },
      undoMove: () => {
        const ok = performUndoMove()
        if (ok) renderUiNow()
        return ok
      },
      toggleDangerZone: () => {
        toggleDangerZone()
        renderUiNow()
        return dangerZoneOn
      },
      toggleCombatLog: () => {
        toggleCombatLog()
        renderUiNow()
        return combatLogOpen
      },
      toggleBattleSpeed: () => {
        const next = handleToggleBattleSpeed()
        renderUiNow()
        return next
      },
      setBattleSpeed: (speed: BattleSpeedMultiplier) => {
        const next = setBattleSpeed(state, speed)
        saveNow()
        uiDirty = true
        hudRev++
        renderUiNow()
        return next
      },
      toggleAutoBattle: () => {
        const next = handleToggleAutoBattle()
        renderUiNow()
        return next
      },
      setAutoBattle: (enabled: boolean) => {
        const next = setAutoBattle(state, enabled)
        uiDirty = true
        hudRev++
        renderUiNow()
        return next
      },
      previewTile: (col: number, row: number) => {
        const fc = computeCombatForecast(state, col, row)
        if (!fc) {
          lockedForecastCell = null
          scene.setForecast(null)
          uiDirty = true
          hudRev++
          renderUiNow()
          return null
        }
        lockedForecastCell = { col, row }
        mobileHandOpen = false
        scene.setForecast(fc)
        uiDirty = true
        hudRev++
        renderUiNow()
        return fc
      },
      forecast: () => resolveActiveForecast(),
      buyPack: (id: PackId) => {
        const res = buyPack(state, id)
        if (res) {
          saveNow()
          startPackCeremony(id, res)
          uiDirty = true
          renderUiNow()
        }
        return Boolean(res)
      },
      craftHero: (heroId: HeroClassId) => {
        const card = craftHero(state, heroId)
        if (card) {
          saveNow()
          uiDirty = true
          renderUiNow()
        }
        return Boolean(card)
      },
      craftEquipment: (equipId: string) => {
        const card = craftEquipment(state, equipId)
        if (card) {
          saveNow()
          uiDirty = true
          renderUiNow()
        }
        return Boolean(card)
      },
      resumeBattle: () => {
        const ok = resumeSavedBattle()
        renderUiNow()
        return ok
      },
      abandonBattle: () => {
        discardResumableBattle()
        renderUiNow()
      },
      saveNow: () => {
        saveNow()
      },
      dismissTip: () => {
        const ok = dismissCurrentDiscoveryTip()
        renderUiNow()
        return ok
      },
      skipAllTips: () => {
        skipAllTipsNow()
        renderUiNow()
      },
      resetTips: () => {
        resetDiscoveryTipsNow()
        renderUiNow()
      }
    }
  })

  let lastRenderAt: number | undefined
  let perfUiTick = 0
  let lastCompassSig = 0
  let lastDownedCount = 0
  let lastBanterId = 0

  const stop = fixedLoop({
    update(dt) {
      const t0 = performance.now()
      stepGame(state, dt)
      const curBanterId = state.battle?.activeBanter?.id ?? 0
      if (curBanterId !== lastBanterId) {
        lastBanterId = curBanterId
        uiDirty = true
        hudRev++
      } else if (state.battle?.activeBanter) {
        const b = state.battle.activeBanter
        if (b.age < 0.28 || b.duration - b.age < 0.52) {
          uiDirty = true
        }
      }
      if (campToastTimer > 0) {
        campToastTimer = Math.max(0, campToastTimer - dt)
        if (campToastTimer === 0) { campToast = ''; uiDirty = true }
      }
      if (battleTouchInfoTimer > 0) {
        battleTouchInfoTimer = Math.max(0, battleTouchInfoTimer - dt)
        if (battleTouchInfoTimer === 0) { battleTouchInfoText = ''; uiDirty = true; hudRev++ }
      }
      if (shouldAutoSaveOnTurnBoundary(turnSaveTracker, state.battle)) {
        saveNow()
      }
      const bPhase = state.battle?.phase ?? null
      const activeUid = state.battle?.activeUnitUid ?? null
      const bTurn = state.battle?.turn ?? 0
      const downedCount = state.battle ? state.battle.units.filter(u => isUnitDowned(u)).length : 0
      const curLogId = latestBattleLogId()
      if (curLogId !== lastCombatLogId) {
        lastCombatLogId = curLogId
        if (combatLogOpen) combatLogSeenId = curLogId
        uiDirty = true
        hudRev++
      }
      if (bPhase !== lastBattlePhase || activeUid !== lastActiveUid || bTurn !== lastBattleTurn || downedCount !== lastDownedCount) {
        const turnOrUnitChanged = bPhase !== lastBattlePhase || activeUid !== lastActiveUid || bTurn !== lastBattleTurn
        lastBattlePhase = bPhase
        lastActiveUid = activeUid
        lastBattleTurn = bTurn
        lastDownedCount = downedCount
        lockedForecastCell = null
        pendingOaMoveCell = null
        inspectedTileCell = null
        mobileHandOpen = false
        clearBattleHoverFeedback()
        if (turnOrUnitChanged && state.battle && (bPhase === 'player' || bPhase === 'deploy')) {
          syncBattleGridCursor(true)
        }
        refreshBattleDiscoveryTips(false)
        uiDirty = true
        hudRev++
        if (bPhase === 'victory' && screen === 'battle') {
          resumableBattle = null
          syncTurnBoundaryTracker(turnSaveTracker, null)
          saveNow()
          setScreen('victory')
        } else if (bPhase === 'defeat' && screen === 'battle') {
          resumableBattle = null
          syncTurnBoundaryTracker(turnSaveTracker, null)
          saveNow()
          setScreen('defeat')
        }
      }
      lastSimMs = performance.now() - t0
    },
    render(_alpha, now) {
      const canvas = renderer.canvas
      const w = Math.max(1, canvas.clientWidth)
      const h = Math.max(1, canvas.clientHeight)
      const frameDeltaMs = lastRenderAt === undefined ? 16.67 : Math.max(0.1, now - lastRenderAt)
      const rawDt = Math.min(0.05, frameDeltaMs / 1000)
      lastRenderAt = now
      const renderDt = screen === 'paused' ? 0 : rawDt

      // Poll W3C gamepad (safe in headless / browsers without Gamepad API)
      dispatchGamepadActions(rawDt)
      if (screen === 'battle' && state.battle) {
        syncBattleGridCursor(false)
      }

      // Advance animated UI scenes (3D World Map diorama camera & fly-in, Victory/Defeat FX, Pack Lottery Ceremony)
      if (screen === 'world') {
        worldMapTime += renderDt
        const flyInFinished = stepDioramaCamera(worldMap3DCam, renderDt)
        if (flyInFinished && pendingWorldFlyIn) {
          const onDone = pendingWorldFlyIn
          pendingWorldFlyIn = null
          onDone()
        }
        uiDirty = true
      } else if (screen === 'victory' || screen === 'defeat') {
        resultAnimTime += renderDt
        uiDirty = true
      }
      if (fanfare) {
        fanfare.elapsed += renderDt
        if (fanfare.elapsed >= FANFARE_DURATION) fanfare = null
        uiDirty = true
      }
      if (packAnim) {
        packAnim.elapsed += renderDt
        if (packAnim.phase === 'spin') {
          const u = Math.min(1, packAnim.elapsed / PACK_SPIN_DURATION)
          const eased = 1 - Math.pow(1 - u, 3)
          const tickStep = Math.floor(eased * 22)
          if (tickStep > packAnim.lastTickStep) {
            packAnim.lastTickStep = tickStep
            state.sounds.push({ kind: 'card', pitch: 0.85 + Math.min(0.65, tickStep * 0.03) })
          }
          if (packAnim.elapsed >= PACK_SPIN_DURATION) {
            packAnim.phase = 'reveal'
            if (!packAnim.burstPlayed) {
              packAnim.burstPlayed = true
              state.sounds.push({ kind: 'pack', rarity: packAnim.bestRarity })
            }
          }
        } else {
          // Auto-flip each card sequentially for a dramatic staggered reveal!
          for (let i = 0; i < packAnim.flipStartTimes.length; i++) {
            const autoAt = PACK_SPIN_DURATION + 0.34 + i * PACK_FLIP_STAGGER
            if (packAnim.flipStartTimes[i] < 0 && packAnim.elapsed >= autoAt) {
              packAnim.flipStartTimes[i] = packAnim.elapsed
              const card = packAnim.cards[i]
              const rIdx = RARITY_ORDER.indexOf(card.rarity)
              state.sounds.push({ kind: rIdx >= 3 ? 'crit' : 'card', pitch: 0.95 + rIdx * 0.14 })
            }
          }
        }
        uiDirty = true
      }

      const activeForecast = resolveActiveForecast()
      scene.setForecast(activeForecast)
      const hovCell = scene.getHoveredCell()
      const hovMoveSig = hovCell && state.battle?.moveTiles.some(t => t.col === hovCell.col && t.row === hovCell.row)
        ? `m:${hovCell.col},${hovCell.row}`
        : ''
      const fcSig = activeForecast
        ? `${activeForecast.attackerUid}:${activeForecast.targetUid}:${activeForecast.mode}:${activeForecast.skillIndex}:${activeForecast.targetCol},${activeForecast.targetRow}:${activeForecast.pincerAssisterUid ?? ''}:${activeForecast.pincerDmg ?? 0}:${lockedForecastCell ? 1 : 0}`
        : hovMoveSig
      if (fcSig !== lastForecastSig) {
        lastForecastSig = fcSig
        uiDirty = true
      }
      if (activeForecast) {
        const pulseTick = Math.floor(now / 90)
        if (pulseTick !== forecastPulseTick) {
          forecastPulseTick = pulseTick
          uiDirty = true
        }
      }

      const r0 = performance.now()
      let stats
      if (screen === 'world' && !state.battle) {
        const clearedIds = new Set(state.campaign.clearedStageIds)
        const unlockedIds = new Set(CHAPTERS.filter(ch => isStageUnlocked(state.campaign, ch)).map(ch => ch.id))
        const mastered3StarIds = new Set<string>()
        for (const id of state.campaign.clearedStageIds) {
          const rec = getStageMasteryRecord(state.campaign, id)
          if (rec && rec.stars >= 3) mastered3StarIds.add(id)
        }
        stats = scene.renderWorldMap3D(state, worldMap3DCam, {
          dt: renderDt,
          width: w,
          height: h,
          time: worldMapTime,
          selectedStageId: state.campaign.selectedStageId,
          recommendedStageId: getNextRecommendedStage(state.campaign).id,
          clearedIds,
          unlockedIds,
          mastered3StarIds,
          selectedEventId: selectedWorldEventId,
          events: state.campaign.worldEvents
        })
      } else {
        stats = scene.render(state, renderDt, w, h)
      }
      const renderMs = performance.now() - r0
      audio.update(state, renderDt, screen === 'battle')

      const b = state.battle
      const cameraMoving = scene.isCameraAnimating()
      if (screen === 'battle') {
        const compassSig = Math.round(scene.getCameraYawActual() * 120)
        if (compassSig !== lastCompassSig) {
          lastCompassSig = compassSig
          uiDirty = true
        }
      }
      const animatingHud = Boolean(
        b && (cameraMoving || hoveredTurnUnitUid !== null || b.floatingNumbers.length > 0 || b.bannerTimer > 0 || b.shake > 0 || b.units.some(u => u.path.length > 0))
      )
      const hudKey = screen === 'battle'
        ? `b:${hudRev}:${hoveredTurnUnitUid ?? ''}:${animatingHud ? Math.floor(now / 33) : 0}:${scene.getHoveredCell()?.col ?? -1},${scene.getHoveredCell()?.row ?? -1}`
        : `s:${screen}`
      ui.setUnderlay(screen === 'battle' ? paintHud : null, hudKey)

      const uiPerfBucket = Math.floor(now / 1000)
      if ((screen === 'battle' || showPerfPanel) && uiPerfBucket !== perfUiTick) {
        perfUiTick = uiPerfBucket
        uiDirty = true
      }

      const u0 = performance.now()
      syncUi()
      const uiMs = performance.now() - u0

      const dpr = Math.round((canvas.width / Math.max(1, canvas.clientWidth)) * 100) / 100
      perf.record({
        now,
        simMs: lastSimMs,
        renderMs,
        hudMs: 0,
        uiMs,
        stats,
        backend: renderer.name,
        gpu: renderer.gpuInfo,
        width: canvas.width,
        height: canvas.height,
        dpr
      })
      perfLogger.tick(frameDeltaMs)
    }
  })

  const unregisterDecisionAgent = registerDecisionAgent(createCrownshardDecisionAgent({
    state,
    getScreen() {
      return screen
    },
    enterBattle() {
      launchBattle()
    },
    confirmDeployment() {
      return confirmDeployAndStart()
    },
    dismissOverlays() {
      if (getActiveDiscoveryTip(state)) {
        dismissDiscoveryTip(state)
      }
    },
    onActed() {
      uiDirty = true
      hudRev++
      renderUiNow()
    }
  }))

  const stopLifecycle = page.platform.onLifecycle({
    pause() {
      saveNow()
      audio.suspend()
    },
    resume() {
      audio.resume()
    },
    dispose() {
      saveNow()
      unregisterDecisionAgent()
      stop()
      stopLifecycle()
      page.dispose()
      perfLogger.dispose()
      inputAbort.abort()
      detachModalityTracker()
      unsubscribeModality()
      ui.dispose()
      scene.dispose()
      renderer.dispose()
      audio.close()
    }
  })
}

start().catch(err => {
  console.error('Failed to launch Crownshard', err)
})
