import {
  createGamePage, createLowPolyRenderer, createPerfLogger, createPerfMonitor, fixedLoop
} from 'ridgetop'
import type { HudPainter } from 'ridgetop'
import { boxNode, column, createCanvasUi, createUiTheme, overlay, row, spacerNode } from 'ridgetop/ui'
import type { CanvasWidgetDrawState, LayoutNode, LayoutRect } from 'ridgetop/ui'
import { isTestingPaused } from 'ridgetop/testing'
import { createPortraitStore } from './art.ts'
import { createCrownshardAudio } from './audio.ts'
import {
  CHAPTERS, CHAPTER_BY_ID, DIFFICULTY_META, ENEMY_SPECS, EQUIPMENT_BY_ID, HERO_SPECS,
  MERGE_COPIES_REQUIRED, PACK_BY_ID, PACK_LIST, PLAYABLE_CHAPTERS, RARITY_META, RARITY_ORDER,
  TACTIC_BY_ID, WORLD_REGIONS
} from './data.ts'
import { cameraCardinalHeading, createCrownshardScene } from './scene.ts'
import {
  armSkill, armTacticCard, autoEquipBestFit, buyPack, canBuyPack, canMergeHero, clearSave,
  computeCombatForecast, computeDeckValue, computeHeroStats, computeSquadPower, createInitialState,
  effectiveSpeed, endPlayerTurn, equipItem, findBestFitUpgrades, findEquipOwner, getEquipmentByUid,
  getHeroByUid, getHeroSkill, getMergeCandidates, getNextRecommendedStage, getStageUnlockHint,
  getTacticByUid, getUnitByUid, isEndlessUnlocked, isStageCleared, isStageUnlocked, loadSave,
  maxSquadSize, mergeHero, persistSave, rotateActiveUnitFacing, salvageEquipCard, salvageHeroCard,
  selectHeroByUid, selectTile, startChapterBattle, stepGame,
  toggleSquadMember, unequipItem
} from './simulation.ts'
import { cellHeightLevel } from './types.ts'
import type {
  BattleUnit, ChapterSpec, CombatForecast, EnemyArchetypeId, GameState, OwnedEquipCard, OwnedHeroCard,
  PackId, PackRevealItem, Rarity
} from './types.ts'
import {
  COLOR, RADIUS, TIER_COLOR, TYPE, UI_THEME_PALETTE, WORLD_MAP_H, WORLD_MAP_W,
  drawAnimatedRevealCard, drawApMeter, drawBattleInfo, drawBoosterPack, drawButton, drawCameraCompassButton, drawCampHeader,
  drawChapterPicker, drawChip, drawCombatForecast, drawControlHints, drawDefeatBackdrop,
  drawDifficultyBadge, drawEmptyNote, drawEndTurnButton, drawEquipCard, drawForecastAltChip,
  drawHeroHeader, drawHeroRosterCard, drawHintPill, drawIconButton, drawLabel, drawLetterbox,
  drawLootRow, drawModal, drawOverline, drawPackCeremonyBackdrop, drawPanel, drawPortraitTile,
  drawResultHeadlineAnimated, drawRevealCard, drawRewardRowAnimated, drawSegmentTrack,
  drawSettingRow, drawSheet, drawSkillRow, drawSkillTile, drawSpeakerPortrait, drawStatStrip,
  drawStoryHeading, drawTab, drawTacticCard, drawText, drawTimelineBg, drawTitleCard,
  drawTitleLogo, drawToast, drawToolbarBg, drawTopFade, drawTurnToken, drawUnitCard,
  drawVictoryBackdrop, drawWell, drawWorldMapCanvas, drawWorldMapNode, worldMapScale, worldMapToScreen,
  FANFARE_DURATION, drawFanfare
} from './ui-art.ts'
import type { FanfareDrawOpts } from './ui-art.ts'
import type { IconName, WorldMapViewport } from './ui-art.ts'

type Screen = 'title' | 'world' | 'camp' | 'story' | 'battle' | 'victory' | 'defeat' | 'paused'
type CampTab = 'squad' | 'armory' | 'decks'
type ArmoryFilter = 'all' | 'weapon' | 'armor' | 'relic'

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

const TERRAIN_LABEL: Record<string, string> = {
  grass: 'Meadow',
  stone: 'Flagstone (+1 DEF)',
  hill: 'Ridge Terrace',
  bridge: 'Bridge (-1 DEF)',
  water: 'Deep Water (Blocked)',
  shrine: 'Sun Shrine (+14 HP, +1 DEF)',
  pillar: 'Stone Pillar (LoS · Cover)',
  lava: 'Molten Rift (Blocked)',
  snow: 'Deep Snow (2 Move)',
  darkstone: 'Obsidian Floor (+2 DEF)',
  stairs: 'Stone Stairs (Climb)',
  void: 'Chasm'
}

const SPEAKER_PORTRAIT: Record<string, string> = {
  'Sir Aldric': 'knight',
  Lyra: 'archer',
  Vesper: 'mage',
  'Archon Malakor': 'eclipse_archon'
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
  ['Click', 'Move / Strike'],
  ['1-4', 'Skills'],
  ['Q / E', 'Snap 90°'],
  ['Space', 'End Turn']
]

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
  let pendingChapter = CHAPTER_BY_ID[state.campaign.selectedStageId]?.index ?? getNextRecommendedStage(state.campaign).index
  let pendingEndless = 0
  let armorySlotFilter: ArmoryFilter = 'all'
  let rosterPage = 0
  let armoryPage = 0
  let campToast = ''
  let campToastTimer = 0
  let uiDirty = true
  let hudRev = 0
  let lastSimMs = 0
  let lockedForecastCell: { col: number; row: number } | null = null
  let mobileHandOpen = false
  let mobileCampCollapsed = false
  let lastForecastSig = ''
  let forecastPulseTick = 0
  let resultAnimTime = 0
  let worldMapTime = 0
  let worldMapPanX = 0.44
  let worldMapPanY = 0.50
  let worldMapZoom = 0.98
  let worldMapTargetPanX = 0.44
  let worldMapTargetPanY = 0.50
  let worldMapTargetZoom = 0.98
  let worldMapDrag: { pointerId: number; lastX: number; lastY: number; dragged: boolean } | null = null
  let packAnim: PackAnimState | null = null
  /** Hero Ascension merge ceremony / Epic+ equip fanfare overlay (presentation only). */
  let fanfare: (Omit<FanfareDrawOpts, 'elapsed'> & { elapsed: number }) | null = null

  function startAscensionFanfare(hero: OwnedHeroCard) {
    const spec = HERO_SPECS[hero.heroId]
    const unlocked = spec.skills[hero.stars - 1]
    fanfare = {
      kind: 'ascend',
      elapsed: 0,
      title: `Ascended ${'★'.repeat(hero.stars)}`,
      subtitle: `${spec.name}, ${spec.title} — Tier ${hero.stars}`,
      accent: TIER_COLOR[hero.stars],
      portrait: heroCardPortrait(hero),
      stars: hero.stars,
      skill: unlocked
        ? { tier: unlocked.tier, name: unlocked.name, desc: unlocked.desc, vfx: unlocked.vfx, skillId: unlocked.id }
        : undefined
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

  function clampWorldMapView() {
    worldMapTargetZoom = Math.max(0.62, Math.min(1.75, worldMapTargetZoom))
    worldMapZoom = Math.max(0.62, Math.min(1.75, worldMapZoom))
    const padX = Math.max(0.08, 0.36 / worldMapTargetZoom)
    const padY = Math.max(0.10, 0.36 / worldMapTargetZoom)
    const minX = Math.min(0.5, padX * 0.45)
    const maxX = Math.max(0.5, 1 - padX * 0.45)
    const minY = Math.min(0.5, padY * 0.45)
    const maxY = Math.max(0.5, 1 - padY * 0.45)
    worldMapTargetPanX = Math.max(minX, Math.min(maxX, worldMapTargetPanX))
    worldMapTargetPanY = Math.max(minY, Math.min(maxY, worldMapTargetPanY))
    worldMapPanX = Math.max(minX, Math.min(maxX, worldMapPanX))
    worldMapPanY = Math.max(minY, Math.min(maxY, worldMapPanY))
  }

  function focusWorldMapOn(stage: ChapterSpec, instant = false) {
    // Bias slightly right so the floating right-hand inspector never covers the selected landmark!
    const mobile = renderer.canvas.clientWidth < 780
    worldMapTargetPanX = stage.mapX + (mobile ? 0 : 0.11 / worldMapTargetZoom)
    worldMapTargetPanY = stage.mapY + (mobile ? 0.10 / worldMapTargetZoom : 0)
    clampWorldMapView()
    if (instant) {
      worldMapPanX = worldMapTargetPanX
      worldMapPanY = worldMapTargetPanY
      worldMapZoom = worldMapTargetZoom
    }
  }

  function resetWorldMapOverview(instant = false) {
    // Frame the full 9-region atlas cleanly to the left of the floating stage inspector!
    const mobile = renderer.canvas.clientWidth < 780
    worldMapTargetPanX = mobile ? 0.50 : 0.66
    worldMapTargetPanY = 0.51
    worldMapTargetZoom = mobile ? 0.70 : 0.70
    clampWorldMapView()
    if (instant) {
      worldMapPanX = worldMapTargetPanX
      worldMapPanY = worldMapTargetPanY
      worldMapZoom = worldMapTargetZoom
    }
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
    if (screen !== 'battle' || !state.battle) {
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
    persistSave(page.storage, state)
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

  function setCampTab(next: CampTab) {
    campTab = next
    if (screen === 'camp') {
      scene.setCampFraming(next === 'armory' ? 'armory' : 'camp')
    }
  }

  function setScreen(next: Screen) {
    screen = next
    lockedForecastCell = null
    mobileHandOpen = false
    if (next !== 'camp') { packAnim = null; fanfare = null }
    if (next === 'victory' || next === 'defeat') resultAnimTime = 0
    if (next === 'title' || next === 'camp' || next === 'story' || next === 'world') {
      scene.setCampFraming(next === 'camp' && campTab === 'armory' ? 'armory' : next)
      scene.setForecast(null)
    }
    uiDirty = true
    hudRev++
  }

  function openWorldMap(selectStageId?: string) {
    state.battle = null
    packAnim = null
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
    resetWorldMapOverview(true)
    setScreen('world')
  }

  function openCamp(tab: CampTab = campTab) {
    state.battle = null
    campTab = tab
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
    pendingChapter = Math.max(0, Math.min(CHAPTERS.length - 1, chapterIndex))
    state.campaign.selectedStageId = CHAPTERS[pendingChapter].id
    pendingEndless = endlessWave
    setScreen('story')
  }

  function launchBattle() {
    audio.unlock()
    startChapterBattle(state, pendingChapter, pendingEndless)
    scene.resetCamera()
    scene.setCameraYaw(0, true)
    setScreen('battle')
    renderer.canvas.focus()
  }

  function startCampaign(fresh = false) {
    audio.unlock()
    if (fresh) {
      clearSave(page.storage)
      state = createInitialState((Date.now() & 0xffff) || 1337)
      saveNow()
      openWorldMap(CHAPTERS[0].id)
    } else {
      openWorldMap(getNextRecommendedStage(state.campaign).id)
    }
  }

  function endBattleTurn() {
    audio.unlock()
    if (state.battle?.phase === 'player') {
      lockedForecastCell = null
      mobileHandOpen = false
      endPlayerTurn(state)
      uiDirty = true
      hudRev++
    }
  }

  function togglePauseScreen() {
    audio.unlock()
    if (screen === 'battle') setScreen('paused')
    else if (screen === 'paused') setScreen('battle')
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

  function advanceAfterVictory() {
    if (isEndlessUnlocked(state.campaign) && (state.battle?.endlessWave ?? 0) > 0) {
      openStory(CHAPTER_BY_ID.eclipse_throne.index, (state.battle?.endlessWave ?? 0) + 1)
    } else {
      const nextStage = getNextRecommendedStage(state.campaign)
      openWorldMap(nextStage.id)
    }
  }

  // Modern dark glass + warm gold accent UI theme
  const ui = createCanvasUi(uiCanvas, {
    theme: createUiTheme(UI_THEME_PALETTE),
    safeArea: { top: 8, right: 8, bottom: 8, left: 8 },
    keyboardEnabled: () => screen !== 'battle',
    onBack: () => {
      if (fanfare) dismissFanfare()
      else if (packAnim) {
        if (isPackCeremonyComplete()) { packAnim = null; uiDirty = true }
        else skipPackCeremony()
      } else if (screen === 'paused') setScreen('battle')
      else if (screen === 'story') openWorldMap()
      else if (screen === 'camp') openWorldMap()
    }
  })

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
      midY: (a.y + b.y) * 0.5
    }
  }

  function pointerToCss(event: PointerEvent) {
    const box = uiCanvas.getBoundingClientRect()
    return { x: event.clientX - box.left, y: event.clientY - box.top, w: box.width, h: box.height }
  }

  uiCanvas.addEventListener('pointermove', event => {
    if (isTestingPaused()) return
    const { x, y, w, h } = pointerToCss(event)
    if (screen === 'world') {
      if (worldMapDrag && worldMapDrag.pointerId === event.pointerId) {
        const dx = x - worldMapDrag.lastX
        const dy = y - worldMapDrag.lastY
        if (Math.hypot(dx, dy) > 2) worldMapDrag.dragged = true
        const scale = worldMapScale({ x: 0, y: 0, width: w, height: h }, worldMapZoom)
        worldMapTargetPanX -= dx / (WORLD_MAP_W * scale)
        worldMapTargetPanY -= dy / (WORLD_MAP_H * scale)
        worldMapPanX = worldMapTargetPanX
        worldMapPanY = worldMapTargetPanY
        clampWorldMapView()
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
    if (ui.blocksPoint(x, y)) {
      if (scene.getHoveredCell()) {
        scene.setHoveredCell(null)
        uiDirty = true
        hudRev++
      }
      return
    }
    const cell = scene.pickCellAt(state.battle, x, y, w, h)
    const prev = scene.getHoveredCell()
    if (prev?.col !== cell?.col || prev?.row !== cell?.row) {
      scene.setHoveredCell(cell)
      uiDirty = true
      hudRev++
    }
  }, sig)

  uiCanvas.addEventListener('pointerdown', event => {
    if (isTestingPaused()) return
    const { x, y, w, h } = pointerToCss(event)
    if (screen === 'world') {
      if (event.button !== 0 && event.pointerType === 'mouse') return
      if (ui.blocksPoint(x, y)) return
      audio.unlock()
      worldMapDrag = { pointerId: event.pointerId, lastX: x, lastY: y, dragged: false }
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

    // Desktop mouse: instant Move+Attack / Strike / Move (forecast shown live on hover!)
    const cell = scene.pickCellAt(state.battle, x, y, w, h)
    if (!cell) {
      if (lockedForecastCell) {
        lockedForecastCell = null
        uiDirty = true
        hudRev++
      }
      return
    }
    lockedForecastCell = null
    mobileHandOpen = false
    if (selectTile(state, cell.col, cell.row)) {
      uiDirty = true
      hudRev++
    }
  }, sig)

  uiCanvas.addEventListener('pointerup', event => {
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
        if (lockedForecastCell) {
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
    const cell = scene.pickCellAt(state.battle, x, y, w, h)
    if (!cell) {
      if (lockedForecastCell || mobileHandOpen) {
        lockedForecastCell = null
        mobileHandOpen = false
        uiDirty = true
        hudRev++
      }
      return
    }
    // Touch tap on a valid combat/skill/Move+Attack/tactic target:
    // First tap locks Combat Forecast + 3D pre-attack wind-up; second tap on same target confirms!
    const fc = computeCombatForecast(state, cell.col, cell.row)
    if (fc) {
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
    if (selectTile(state, cell.col, cell.row)) {
      uiDirty = true
      hudRev++
    }
  }, sig)

  uiCanvas.addEventListener('contextmenu', event => {
    if (screen === 'battle') event.preventDefault()
  }, sig)

  uiCanvas.addEventListener('pointercancel', event => {
    if (worldMapDrag && worldMapDrag.pointerId === event.pointerId) worldMapDrag = null
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
      worldMapTargetZoom *= event.deltaY > 0 ? 1 / 1.12 : 1.12
      clampWorldMapView()
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
    if (screen === 'battle' && state.battle) {
      if (event.code === 'Escape' && !event.repeat) {
        event.preventDefault()
        if (lockedForecastCell || mobileHandOpen) {
          lockedForecastCell = null
          mobileHandOpen = false
          uiDirty = true
          hudRev++
          return
        }
        setScreen('paused')
        return
      }
      if (event.code === 'Enter' && !event.repeat && lockedForecastCell) {
        event.preventDefault()
        confirmLockedForecast()
        return
      }
      if (event.code === 'KeyF' && !event.repeat && state.battle.phase === 'player') {
        audio.unlock()
        if (rotateActiveUnitFacing(state)) {
          uiDirty = true
          hudRev++
        }
        return
      }
      if (event.code === 'Space' && !event.repeat && state.battle.phase === 'player') {
        event.preventDefault()
        audio.unlock()
        lockedForecastCell = null
        mobileHandOpen = false
        endPlayerTurn(state)
        uiDirty = true
        hudRev++
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
      if (event.code === 'KeyA' || event.code === 'ArrowLeft') {
        scene.rotateCamera(-0.12)
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'KeyD' || event.code === 'ArrowRight') {
        scene.rotateCamera(0.12)
        uiDirty = true
        hudRev++
        return
      }
      if (event.code === 'ArrowUp' || event.code === 'PageUp') {
        event.preventDefault()
        scene.tiltCamera(0.14)
        hudRev++
        return
      }
      if (event.code === 'ArrowDown' || event.code === 'PageDown') {
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
      if (event.code === 'Digit1' && !event.repeat) { armSkill(state, null); uiDirty = true; hudRev++; return }
      if (event.code === 'Digit2' && !event.repeat) { armSkill(state, 0); uiDirty = true; hudRev++; return }
      if (event.code === 'Digit3' && !event.repeat) { armSkill(state, 1); uiDirty = true; hudRev++; return }
      if (event.code === 'Digit4' && !event.repeat) { armSkill(state, 2); uiDirty = true; hudRev++; return }
      if (event.code === 'Tab' && !event.repeat && state.battle.activeUnitUid) {
        event.preventDefault()
        selectHeroByUid(state, state.battle.activeUnitUid)
        uiDirty = true
        hudRev++
      }
    } else if (screen === 'paused' && event.code === 'Escape' && !event.repeat) {
      event.preventDefault()
      setScreen('battle')
    }
  }, sig)

  // =========================================================================
  // TITLE SCREEN
  // =========================================================================

  function buildTitleTree(w: number, h: number): LayoutNode {
    const mobile = w < 600
    const shortH = h < 480
    const hasSave = Boolean(existingSave && (existingSave.campaign.battlesWon > 0 || existingSave.campaign.packsOpened > 0))
    const playLabel = hasSave
      ? `Continue (${state.campaign.clearedStageIds.length}/${PLAYABLE_CHAPTERS.length})`
      : 'Begin Campaign'

    const logoH = shortH ? Math.min(108, Math.round(h * 0.30)) : Math.min(138, Math.round(h * 0.22))
    const cardW = Math.min(w - 28, shortH ? 420 : 480)
    const btnH = shortH ? 40 : 48

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
        style: { anchor: 'bottom', width: cardW, inset: shortH ? 10 : mobile ? 14 : 20, padding: shortH ? [10, 14] : [16, 18], gap: shortH ? 8 : 12, respectSafeArea: true },
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
        row({ id: 't-actions', style: { height: btnH, gap: 10 } }, [
          boxNode({
            id: 'cs-play', style: { grow: 1.5, height: btnH },
            widget: {
              type: 'button',
              label: playLabel,
              primary: true,
              onPress: () => startCampaign(false),
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, playLabel, st, { variant: 'primary', icon: 'play', size: shortH ? 14 : 15 }
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
        ...(mobile || shortH ? [] : [boxNode({
          id: 't-help',
          style: { height: 18 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawControlHints(ctx, rect, TITLE_HINTS)
          }
        })])
      ])
    ])
  }

  // =========================================================================
  // WORLD MAP OVERWORLD (FULL-VIEWPORT PANNABLE CONTINENT + 26 LOCATIONS)
  // =========================================================================

  function buildWorldMapTree(w: number, h: number): LayoutNode {
    const camp = state.campaign
    const mobile = w < 780
    const shortH = !mobile && h < 500
    const isCompact = mobile || shortH
    const selected = getSelectedStage()
    const selectedSoon = Boolean(selected.comingSoon)
    const selectedUnlocked = !selectedSoon && isStageUnlocked(camp, selected)
    const selectedCleared = isStageCleared(camp, selected.id)
    const endlessReady = isEndlessUnlocked(camp)
    const squadPower = computeSquadPower(camp)
    const clearedSet = new Set(camp.clearedStageIds)
    const unlockedSet = new Set(CHAPTERS.filter(ch => isStageUnlocked(camp, ch)).map(ch => ch.id))
    const regionMeta = WORLD_REGIONS[selected.region]

    const outerPad = isCompact ? 8 : 12
    const topH = shortH ? 38 : 44
    const vp: WorldMapViewport = { panX: worldMapPanX, panY: worldMapPanY, zoom: worldMapZoom }
    const mapRect: LayoutRect = { x: 0, y: 0, width: w, height: h }

    const nodeW = mobile ? 88 : 118
    const nodeH = mobile ? 64 : 72
    const pinCenterY = mobile ? 21 : 25

    // Position all visible continent landmarks directly onto the full-viewport map canvas!
    const mapNodes: LayoutNode[] = []
    for (const stage of CHAPTERS) {
      const pt = worldMapToScreen(stage.mapX, stage.mapY, mapRect, vp)
      const left = Math.round(pt.x - nodeW / 2)
      const top = Math.round(pt.y - pinCenterY)
      if (left + nodeW < -20 || left > w + 20 || top + nodeH < -20 || top > h + 20) continue
      const unlocked = unlockedSet.has(stage.id)
      const cleared = clearedSet.has(stage.id)
      const isSel = selected.id === stage.id
      mapNodes.push(boxNode({
        id: `map-node-${stage.id}`,
        style: { anchor: 'top-left', inset: [left, top], width: nodeW, height: nodeH },
        widget: {
          type: 'button',
          label: stage.title,
          selected: isSel,
          onPress: () => {
            audio.unlock()
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
            { unlocked, cleared, selected: isSel, time: worldMapTime, compact: mobile },
            st
          )
        }
      }))
    }

    // Aggregate unique enemy roster for the selected stage
    const enemyCounts = new Map<EnemyArchetypeId, number>()
    for (const sp of selected.enemies) {
      enemyCounts.set(sp.id, (enemyCounts.get(sp.id) ?? 0) + 1)
    }
    const enemyList = Array.from(enemyCounts.entries())
    const gridCols = selected.grid[0]?.length ?? 8
    const gridRows = selected.grid.length
    const biomeName = selected.biome[0].toUpperCase() + selected.biome.slice(1)
    const firstEq = selected.rewardEquipId ? EQUIPMENT_BY_ID[selected.rewardEquipId] : undefined
    const firstHero = selected.rewardHeroId ? HERO_SPECS[selected.rewardHeroId] : undefined

    const firstClearLoot: { icon: IconName; text: string; color?: string }[] = [
      { icon: 'coin', text: `+${selected.rewardGold}g`, color: selectedCleared ? COLOR.faint : COLOR.accentHi }
    ]
    if (firstEq) {
      firstClearLoot.push({
        icon: 'bag',
        text: firstEq.name,
        color: selectedCleared ? COLOR.faint : RARITY_META[firstEq.rarity].hex
      })
    }
    if (firstHero) {
      firstClearLoot.push({
        icon: 'users',
        text: firstHero.name,
        color: selectedCleared ? COLOR.faint : '#9ff0c4'
      })
    }
    if (selected.unlocksSlot4) {
      firstClearLoot.push({
        icon: 'star',
        text: '4th Slot',
        color: selectedCleared ? COLOR.faint : COLOR.ap
      })
    }

    const replayTierText = selected.difficulty <= 2
      ? 'Com/Unc Drop'
      : selected.difficulty === 3 ? 'Up to Rare'
      : 'Rare/Slim Epic'
    const replayLoot: { icon: IconName; text: string; color?: string }[] = [
      { icon: 'coin', text: `+${selected.replayGold}g`, color: COLOR.accentHi },
      { icon: 'cards', text: replayTierText, color: '#9fd3ff' }
    ]

    const powerRatio = squadPower / Math.max(1, selected.recommendedPower)
    const powerColor = powerRatio >= 1.0 ? COLOR.good : powerRatio >= 0.8 ? COLOR.accentHi : COLOR.danger
    const deployLabel = selectedSoon
      ? 'Coming Soon...'
      : !selectedUnlocked
        ? 'Locked'
        : selectedCleared ? 'Replay Battle' : 'Deploy to Battle'

    const inspW = mobile ? Math.min(w - 16, 460) : 332
    const inspH = mobile ? Math.min(Math.round(h * 0.42), 258) : Math.min(h - topH - outerPad * 3 - 8, 512)

    const inspectorPanel = column({
      id: 'wm-inspector',
      style: mobile
        ? { anchor: 'bottom', width: inspW, height: inspH, inset: [8, 8], padding: [10, 12], gap: 6, respectSafeArea: true }
        : { anchor: 'top-right', width: inspW, height: inspH, inset: [outerPad, topH + outerPad + 10], padding: [13, 14], gap: 8, respectSafeArea: true },
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
        style: { height: isCompact ? 42 : 52 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            const tag = selectedSoon ? 'COMING SOON' : (selected.specialTag ?? regionMeta.name)
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
            drawChip(ctx, rect.x, rect.y, tag.toUpperCase(), { h: 18, size: 9, color: tagCol, bg: tagBg })
            if (selectedCleared) {
              drawChip(ctx, rect.x + rect.width, rect.y, 'CLEARED', {
                h: 18, size: 9, color: '#072b16', bg: COLOR.good, icon: 'check', align: 'right'
              })
            } else if (!selectedSoon && !selectedUnlocked) {
              drawChip(ctx, rect.x + rect.width, rect.y, 'LOCKED', {
                h: 18, size: 9, color: COLOR.muted, bg: '#222b42', icon: 'lock', align: 'right'
              })
            } else {
              drawChip(ctx, rect.x + rect.width, rect.y, regionMeta.name.toUpperCase(), {
                h: 18, size: 8.5, color: '#d8e3ff', bg: '#161f38', align: 'right'
              })
            }
            drawText(ctx, selected.title, rect.x, rect.y + (isCompact ? 32 : 38), {
              size: isCompact ? 15.5 : 19,
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

      // Difficulty + Arena Size + Recommended Power strip
      boxNode({
        id: 'wm-st-meta',
        style: { height: isCompact ? 42 : 50 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawWell(ctx, rect, RADIUS.md)
            const bw = drawDifficultyBadge(ctx, rect.x + 8, rect.y + 6, selected.difficulty, { h: 20, showLabel: true })
            drawChip(ctx, rect.x + 14 + bw, rect.y + 6, selectedSoon ? biomeName : `${gridCols}x${gridRows} ${biomeName}`, {
              h: 20, size: 9.5, color: '#dce8ff', bg: '#1e2b4a'
            })
            drawText(
              ctx,
              selectedSoon
                ? `${selected.subtitle} · In Development`
                : `Squad Power ${squadPower} / Rec ${selected.recommendedPower}`,
              rect.x + 10,
              rect.y + rect.height - 11,
              { size: 10.5, weight: 800, color: selectedSoon ? '#f0cf99' : powerColor, maxW: rect.width - 20, display: true }
            )
          }
        }
      }),

      // Hostile Forces OR Expansion Feature Teaser
      ...(isCompact ? [] : [boxNode({
        id: 'wm-st-foes',
        style: { height: 72 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawWell(ctx, rect, RADIUS.md)
            if (selectedSoon) {
              drawOverline(ctx, 'Upcoming Expansion Preview', rect.x + 10, rect.y + 12, rect.width - 20, '#f5d193')
              drawLabel(
                ctx,
                { x: rect.x + 10, y: rect.y + 22, width: rect.width - 20, height: 44 },
                selected.soonNote ?? selected.introText,
                { size: 11.5, weight: 600, color: '#f2e6d0', wrap: true, lineHeight: 15 }
              )
              return
            }
            drawOverline(ctx, `Hostile Forces (${selected.enemies.length})`, rect.x + 10, rect.y + 12, rect.width - 20)
            let ex = rect.x + 10
            const ey = rect.y + 23
            const ps = 40
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
      })]),

      // Possible Rewards: One-Time First-Clear vs Replayable
      boxNode({
        id: 'wm-st-rewards',
        style: { grow: 1, minHeight: isCompact ? 70 : 108 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => {
            drawWell(ctx, rect, RADIUS.md)
            const px = rect.x + 10
            const pw = rect.width - 20
            drawOverline(
              ctx,
              selectedSoon
                ? 'Planned First-Clear Spoils'
                : selectedCleared ? 'First-Clear Special (Claimed)' : 'First-Clear Special (One-Time)',
              px,
              rect.y + 13,
              pw,
              selectedCleared ? COLOR.faint : COLOR.accentHi
            )
            let cx = px
            let cy = rect.y + 24
            const chipH = 22
            for (const item of firstClearLoot) {
              const estW = Math.min(pw, item.text.length * 6.8 + 38)
              if (cx > px && cx + estW > px + pw) {
                cx = px
                cy += chipH + 5
              }
              const cw = drawChip(ctx, cx, cy, item.text, {
                icon: item.icon,
                h: chipH,
                size: 10.5,
                color: item.color ?? COLOR.text,
                bg: '#1c2642',
                border: COLOR.outline
              })
              cx += cw + 6
            }

            const repTop = Math.max(cy + chipH + 11, rect.y + rect.height * 0.56)
            drawOverline(ctx, 'Replay Spoils (Repeatable)', px, repTop, pw, '#8fd4ff')
            let rx = px
            const ry = repTop + 10
            for (const item of replayLoot) {
              const cw = drawChip(ctx, rx, ry, item.text, {
                icon: item.icon,
                h: chipH,
                size: 10.5,
                color: item.color ?? COLOR.text,
                bg: '#1c2642',
                border: COLOR.outline
              })
              rx += cw + 6
            }
          }
        }
      }),

      // Unlock hint or modifier blurb
      boxNode({
        id: 'wm-st-hint',
        style: { height: 20 },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
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
      }),

      // Deploy / Replay / Coming Soon CTA
      boxNode({
        id: 'cs-world-deploy',
        style: { height: isCompact ? 36 : 42 },
        widget: {
          type: 'button',
          label: deployLabel,
          primary: selectedUnlocked,
          disabled: !selectedUnlocked,
          onPress: () => {
            if (!selectedUnlocked) return
            audio.unlock()
            openStory(selected.index, 0)
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

    const soonCount = CHAPTERS.length - PLAYABLE_CHAPTERS.length
    const zoomCtrlW = mobile ? 96 : 138

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      // Full-viewport illustrated continent canvas (does NOT block pointer so drag-to-pan works anywhere!)
      boxNode({
        id: 'wm-canvas-bg',
        style: { anchor: 'fill' },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWorldMapCanvas(
            ctx, rect, vp, worldMapTime, CHAPTERS, clearedSet, unlockedSet
          )
        }
      }),

      // Interactive landmark medallions floating directly over the illustrated continent!
      ...mapNodes,

      // Floating Top-Left Realm Title + Progress + Gold Pill
      boxNode({
        id: 'wm-header',
        style: {
          anchor: 'top-left',
          width: mobile ? Math.min(w - 118, 250) : 410,
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
            drawText(ctx, mobile ? 'SOLIS MAP' : 'REALM OF SOLIS', rect.x + 14, cy + 0.5, {
              size: isCompact ? 13 : 15.5,
              weight: 900,
              color: COLOR.accentHi,
              display: true,
              stroke: true,
              strokeWidth: 2.6
            })
            const prog = `${camp.clearedStageIds.length}/${PLAYABLE_CHAPTERS.length}`
            drawChip(ctx, rect.x + rect.width - 10, cy - 10, `${camp.gold}g · ${prog}`, {
              icon: 'coin',
              h: 21,
              size: 10.5,
              color: COLOR.accentHi,
              bg: COLOR.wellDeep,
              align: 'right'
            })
          }
        }
      }),

      // Floating Top-Right Toolbar: Zoom (- / Fit / +) + Endless + Vanguard Camp
      row({
        id: 'wm-top-actions',
        style: {
          anchor: 'top-right',
          width: (mobile ? 92 : 164) + zoomCtrlW + (endlessReady ? (mobile ? 88 : 134) : 0) + (endlessReady ? 16 : 8),
          height: topH,
          inset: [outerPad, outerPad],
          gap: 8,
          align: 'center',
          respectSafeArea: true
        }
      }, [
        row({
          id: 'wm-zoom-bar',
          style: { width: zoomCtrlW, height: topH, padding: [5, 6], gap: 5, align: 'center' },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawToolbarBg(ctx, rect)
          }
        }, [
          boxNode({
            id: 'wm-zoom-out',
            style: { width: 28, height: 30 },
            widget: {
              type: 'button', label: 'Zoom Out',
              onPress: () => { worldMapTargetZoom /= 1.18; clampWorldMapView(); uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'minus', st)
            }
          }),
          ...(mobile ? [] : [boxNode({
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
            style: { width: 28, height: 30 },
            widget: {
              type: 'button', label: 'Zoom In',
              onPress: () => { worldMapTargetZoom *= 1.18; clampWorldMapView(); uiDirty = true },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'plus', st)
            }
          })
        ]),
        ...(endlessReady ? [boxNode({
          id: 'cs-world-endless',
          style: { width: mobile ? 88 : 134, height: topH },
          widget: {
            type: 'button',
            label: `Endless W${camp.endlessBest + 1}`,
            onPress: () => {
              audio.unlock()
              openStory(CHAPTER_BY_ID.eclipse_throne.index, camp.endlessBest + 1)
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, mobile ? `Wave ${camp.endlessBest + 1}` : `Endless W${camp.endlessBest + 1}`, st, { variant: 'danger', icon: 'skull', size: 12 }
            )
          }
        })] : []),
        boxNode({
          id: 'cs-world-camp',
          style: { width: mobile ? 92 : 164, height: topH },
          widget: {
            type: 'button',
            label: 'Vanguard Camp',
            onPress: () => {
              audio.unlock()
              openCamp('squad')
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, mobile ? 'Camp' : 'Vanguard Camp', st, { variant: 'secondary', icon: 'camp', size: 13 }
            )
          }
        })
      ]),

      // Bottom-left subtle cartography legend pill (desktop)
      ...(mobile ? [] : [boxNode({
        id: 'wm-legend',
        style: { anchor: 'bottom-left', width: 512, height: 28, inset: [outerPad, outerPad], respectSafeArea: true },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawHintPill(
            ctx,
            rect,
            `Drag to Pan · Scroll to Zoom · 9 Regions · ${PLAYABLE_CHAPTERS.length} Playable · ${soonCount} Future (Tier VI–VIII)`,
            COLOR.accentHi
          )
        }
      })]),

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
    const header = pendingEndless > 0 ? `Endless Arena - Wave ${pendingEndless}` : ch.title
    const kicker = pendingEndless > 0
      ? `${ch.subtitle} · ${gridCols}x${gridRows}`
      : `${ch.subtitle} · ${gridCols}x${gridRows} · Diff ${diffMeta.short}`
    const desc = pendingEndless > 0
      ? `Eclipse remnants surge back into ${ch.subtitle}. Every wave scales foes and awards richer gold and weighted loot.`
      : `"${ch.introText}"`

    const lootItems: { icon: IconName; text: string; color?: string }[] = []
    if (pendingEndless > 0) {
      lootItems.push(
        { icon: 'coin', text: `+${130 + pendingEndless * 35}g`, color: COLOR.accentHi },
        { icon: 'bag', text: 'Weighted Gear', color: '#9fd3ff' },
        { icon: 'users', text: 'Weighted Hero', color: '#9ff0c4' }
      )
    } else if (alreadyCleared) {
      lootItems.push(
        { icon: 'coin', text: `+${ch.replayGold}g (Replay)`, color: COLOR.accentHi },
        { icon: 'cards', text: 'Repeatable Drop', color: '#9fd3ff' },
        { icon: 'check', text: 'Specials Claimed', color: COLOR.muted }
      )
    } else {
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
    const battle = state.battle
    if (!battle) return overlay({ id: 'root', style: { anchor: 'fill' } }, [])

    const mobilePortrait = w < 660
    const mobileLandscape = !mobilePortrait && h < 480
    const isPhone = mobilePortrait || mobileLandscape
    const narrow = w < 1080
    const ch = CHAPTERS[battle.chapterIndex]
    const active = getUnitByUid(battle, battle.activeUnitUid)
    const inspected = getUnitByUid(battle, battle.selectedUnitUid) ?? active
    const isPlayerTurn = battle.phase === 'player' && Boolean(active && active.team === 'ally')
    const activeForecast = resolveActiveForecast()

    // 1. Top Turn-Order Token Strip
    const maxSlots = mobilePortrait ? 5 : mobileLandscape ? 5 : narrow ? 6 : 7
    const tokenW = mobilePortrait ? 42 : mobileLandscape ? 38 : 50
    const tokenH = mobilePortrait ? 46 : mobileLandscape ? 42 : 60
    const timelineNodes: LayoutNode[] = battle.turnOrder.slice(0, maxSlots).map((entry, idx) => {
      const unit = getUnitByUid(battle, entry.uid)
      const pKey = entry.heroId ?? entry.enemyId ?? 'knight'
      const icon = unit ? battleUnitPortrait(unit) : portraits[pKey]
      return boxNode({
        id: `tl-${idx}`,
        style: { width: tokenW, height: tokenH },
        widget: {
          type: 'button',
          label: entry.name,
          selected: entry.isCurrent,
          onPress: () => {
            lockedForecastCell = null
            selectHeroByUid(state, entry.uid)
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTurnToken(ctx, rect, entry, icon, st)
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
          disabled: !canAct,
          onPress: () => {
            audio.unlock()
            mobileHandOpen = false
            armSkill(state, null)
            uiDirty = true
            hudRev++
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSkillTile(ctx, rect, {
            name: 'Strike',
            subtitle: `ATK ${active.atk}`,
            keycap: '1',
            vfx: 'strike',
            skillId: 'strike',
            unlocked: true,
            cooldown: 0
          }, st)
        }
      })

      const tiers: LayoutNode[] = []
      for (let i = 0; i < 3; i++) {
        const sk = spec.skills[i]
        const unlocked = active.stars >= sk.tier
        const cd = active.cooldowns[i]
        const armed = battle.armedSkillIndex === i
        tiers.push(boxNode({
          id: `sk-${i}`,
          style: { grow: 1, height: tileH },
          widget: {
            type: 'button',
            label: sk.name,
            selected: armed,
            disabled: !canAct || !unlocked || cd > 0,
            onPress: () => {
              audio.unlock()
              mobileHandOpen = false
              armSkill(state, i)
              uiDirty = true
              hudRev++
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSkillTile(ctx, rect, {
              name: sk.name,
              subtitle: !unlocked ? `Tier ${sk.tier}` : cd > 0 ? `${cd}t` : `R${sk.range}`,
              keycap: keycaps[i] ?? '2',
              vfx: sk.vfx,
              skillId: sk.id,
              tier: sk.tier,
              unlocked,
              cooldown: cd
            }, st)
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

    let statusLine = 'Click [.] frame to move, [X] crosshair to strike, or arm a skill (1-4). Q/E snap 90°, right-drag 360° orbit.'
    let statusAccent: string = COLOR.accent
    let statusImportant = false
    if (!isPlayerTurn && active) {
      statusLine = `${active.name}'s turn - resolving maneuver...`
      statusAccent = COLOR.enemy
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
      statusLine = `Inspecting ${inspected.name} - HP ${inspected.hp}/${inspected.maxHp}, ATK ${inspected.atk}, DEF ${inspected.def}, SPD ${effectiveSpeed(inspected)}`
      statusAccent = inspected.team === 'ally' ? COLOR.ally : COLOR.enemy
      statusImportant = true
    }

    const activePortrait = battleUnitPortrait(inspected ?? undefined)
    const roleLabel = inspected
      ? (inspected.heroId ? HERO_SPECS[inspected.heroId].title : inspected.isBoss ? 'Boss' : 'Foe')
      : ''
    const fpsShort = `${Math.round(perf.snapshot().fps || 60)}`
    const chapterShort = battle.endlessWave > 0 ? `Endless Wave ${battle.endlessWave}` : `${ch.title} · D${battle.difficulty}`

    // Top-right toolbar (compact on phone: Music + Pause only, touch drags to orbit + side pill snaps 90°!)
    const tbIconS = isPhone ? 28 : 30
    const facingLabel = active ? active.facing.toUpperCase() : 'E'
    const camYawActual = scene.getCameraYawActual()
    const camHeading = cameraCardinalHeading(camYawActual)
    const toolbarItems: LayoutNode[] = [
      ...(isPlayerTurn && active && active.team === 'ally' ? [
        boxNode({
          id: 'tb-face-turn', style: { width: isPhone ? 46 : 56, height: tbIconS },
          widget: {
            type: 'button', label: `Face ${facingLabel} (F)`,
            onPress: () => {
              audio.unlock()
              if (rotateActiveUnitFacing(state)) { uiDirty = true; hudRev++ }
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-right', st, {
              label: facingLabel,
              color: COLOR.accentHi
            })
          }
        })
      ] : []),
      ...(isPhone ? [] : [
        boxNode({
          id: 'tb-cam-up', style: { width: tbIconS, height: tbIconS },
          widget: {
            type: 'button', label: 'Tilt Camera Up (ArrowUp)',
            onPress: () => { scene.tiltCamera(0.16); hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'chevron-up', st)
          }
        }),
        boxNode({
          id: 'tb-cam-dn', style: { width: tbIconS, height: tbIconS },
          widget: {
            type: 'button', label: 'Tilt Camera Down (ArrowDown)',
            onPress: () => { scene.tiltCamera(-0.16); hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'chevron-down', st)
          }
        }),
        boxNode({
          id: 'tb-cam-l', style: { width: 42, height: tbIconS },
          widget: {
            type: 'button', label: 'Rotate Camera Left 90° (Q)',
            onPress: () => { scene.snapCameraYaw(-1); uiDirty = true; hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-left', st, {
              label: 'Q'
            })
          }
        }),
        boxNode({
          id: 'tb-cam-compass', style: { width: 34, height: tbIconS },
          widget: {
            type: 'button', label: `Camera Facing ${camHeading} — Reset North (0)`,
            onPress: () => { scene.setCameraYaw(0); uiDirty = true; hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawCameraCompassButton(ctx, rect, camYawActual, camHeading, st)
          }
        }),
        boxNode({
          id: 'tb-cam-r', style: { width: 42, height: tbIconS },
          widget: {
            type: 'button', label: 'Rotate Camera Right 90° (E)',
            onPress: () => { scene.snapCameraYaw(1); uiDirty = true; hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-right', st, {
              label: 'E'
            })
          }
        }),
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
      ]),
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
    const hasFaceBtn = isPlayerTurn && active && active.team === 'ally'
    const toolbarW = (isPhone ? 74 : 346) + (hasFaceBtn ? (isPhone ? 52 : 62) : 0)
    const topBarH = isPhone ? 36 : 42

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

    // Bottom Dock (Desktop / Phone Portrait / Phone Landscape)
    let dockNode: LayoutNode
    let dockH: number

    if (mobilePortrait) {
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
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawUnitCard(
                ctx, rect, inspected, activePortrait, inspected ? effectiveSpeed(inspected) : 0, roleLabel
              )
            }
          }),
          boxNode({
            id: 'cs-end-turn', style: { width: 84, height: topRowH },
            widget: {
              type: 'button',
              label: !isPlayerTurn ? 'Enemy' : ctBonus > 0 ? `Wait (+${ctBonus} CT)` : 'End Turn',
              primary: isPlayerTurn,
              disabled: !isPlayerTurn,
              onPress: endBattleTurn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEndTurnButton(ctx, rect, { isPlayerTurn, ctBonus }, st)
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

      dockNode = row({
        id: 'battle-dock',
        style: { anchor: 'bottom', width: Math.min(w - 14, 820), height: dockH, inset: 6, padding: 7, gap: 6, align: 'center', respectSafeArea: true },
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
              ctx, rect, inspected, activePortrait, inspected ? effectiveSpeed(inspected) : 0, roleLabel
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
            label: !isPlayerTurn ? 'Enemy' : ctBonus > 0 ? `Wait (+${ctBonus} CT)` : 'End Turn',
            primary: isPlayerTurn,
            disabled: !isPlayerTurn,
            onPress: endBattleTurn,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEndTurnButton(ctx, rect, { isPlayerTurn, ctBonus }, st)
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
              ctx, rect, inspected, activePortrait, inspected ? effectiveSpeed(inspected) : 0, roleLabel
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
            label: !isPlayerTurn ? 'Enemy...' : ctBonus > 0 ? `Wait (+${ctBonus} CT)` : 'End Turn',
            primary: isPlayerTurn,
            disabled: !isPlayerTurn,
            onPress: endBattleTurn,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEndTurnButton(ctx, rect, { isPlayerTurn, ctBonus }, st)
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
      const tgtUnit = fc.targetUid ? getUnitByUid(battle, fc.targetUid) : undefined
      const attPortrait = attUnit
        ? battleUnitPortrait(attUnit)
        : (fc.attackerHeroId ? portraits[fc.attackerHeroId] : undefined)
      const tgtPortrait = fc.targetTeam === 'none'
        ? undefined
        : tgtUnit
          ? battleUnitPortrait(tgtUnit)
          : portraits[fc.targetHeroId ?? fc.targetEnemyId ?? 'goblin']
      const mainH = fcCompact ? 96 : 104

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
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawForecastAltChip(ctx, rect, alt, st)
            }
          }))
          if (rowItems.length === 1) rowItems.push(spacerNode(1))
          altRows.push(row({ id: `fc-alt-row-${i}`, style: { height: 28, gap: 6 } }, rowItems))
        }
      }

      const isHelpful = !fc.isOffensive && fc.targetTeam === 'ally'
      const confirmLabel = fc.friendlyFire
        ? 'Friendly Fire!'
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
              locked: isLocked
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

    const singleTopRow = mobileLandscape || (!mobilePortrait && w >= 1160)
    const timelineInset: [number, number] = singleTopRow
      ? [6, mobileLandscape ? 6 : 8]
      : [8, topBarH + 12]
    const showHintPill = !activeForecast && !mobileHandOpen && (!isPhone || statusImportant)
    const zoomNow = scene.getCameraZoom()
    const zoomBounds = scene.getCameraZoomBounds()
    const showPhoneZoom = isPhone && !mobileHandOpen && !(mobileLandscape && activeForecast)

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      // Top-left chapter + gold capsule
      boxNode({
        id: 'top-left-bar',
        style: {
          anchor: 'top-left',
          width: mobilePortrait ? w - toolbarW - 22 : mobileLandscape ? 208 : 264,
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

      // Top-right toolbar (aligned on top row for phone portrait & landscape too!)
      row({
        id: 'top-right-bar',
        style: {
          anchor: 'top-right',
          width: toolbarW,
          height: topBarH,
          inset: isPhone ? 6 : 8,
          gap: isPhone ? 4 : 6,
          padding: isPhone ? [4, 6] : [5, 7],
          align: 'center',
          respectSafeArea: true
        },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawToolbarBg(ctx, rect)
        }
      }, toolbarItems),

      // Compact one-thumb Camera Snap & Zoom pill on phones (supplements 2-finger pinch & drag-orbit)
      ...(showPhoneZoom ? [column({
        id: 'mobile-zoom-bar',
        style: {
          anchor: 'top-right',
          width: 38,
          height: 142,
          inset: [6, mobilePortrait ? 114 : 48],
          padding: [5, 5],
          gap: 6,
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
          id: 'tb-cam-l',
          style: { width: 28, height: 28 },
          widget: {
            type: 'button',
            label: 'Rotate Camera Left 90° (Q)',
            onPress: () => {
              scene.snapCameraYaw(-1)
              uiDirty = true
              hudRev++
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-left', st)
          }
        }),
        boxNode({
          id: 'tb-cam-r',
          style: { width: 28, height: 28 },
          widget: {
            type: 'button',
            label: 'Rotate Camera Right 90° (E)',
            onPress: () => {
              scene.snapCameraYaw(1)
              uiDirty = true
              hudRev++
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-right', st)
          }
        }),
        boxNode({
          id: 'cs-zoom-in',
          style: { width: 28, height: 28 },
          widget: {
            type: 'button',
            label: 'Zoom In',
            disabled: zoomNow <= zoomBounds.min + 0.01,
            onPress: () => {
              scene.zoomCamera(1 / 1.18)
              uiDirty = true
              hudRev++
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'plus', st)
          }
        }),
        boxNode({
          id: 'cs-zoom-out',
          style: { width: 28, height: 28 },
          widget: {
            type: 'button',
            label: 'Zoom Out',
            disabled: zoomNow >= zoomBounds.max - 0.01,
            onPress: () => {
              scene.zoomCamera(1.18)
              uiDirty = true
              hudRev++
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'minus', st)
          }
        })
      ])] : []),

      // Top-center turn-order token strip
      row({
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
      }, timelineNodes),

      // Context hint pill right above bottom dock (hidden on phone when idle or when forecast/hand open)
      ...(showHintPill ? [boxNode({
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

      ...forecastNodes,
      ...phoneHandNodes,
      dockNode
    ])
  }

  // =========================================================================
  // VANGUARD CAMP (BOTTOM GLASS SHEET KEEPING THE 3D DIORAMA OPEN ABOVE!)
  // =========================================================================

  function buildCampTree(w: number, h: number): LayoutNode {
    const camp = state.campaign
    const mobile = w < 720
    const shortH = !mobile && h < 480
    const isPhone = mobile || shortH
    const wide = w >= 980 && !shortH
    const deckValue = computeDeckValue(camp)

    const sheetW = Math.min(w - (isPhone ? 12 : 24), 1120)
    // Keep upper ~48% of viewport open on desktop so the live 3D campfire + squad shine!
    // On phone, allow collapsing the sheet down to the tab bar to inspect the 3D squad!
    const collapsed = isPhone && mobileCampCollapsed
    const sheetH = collapsed
      ? 62
      : mobile
        ? Math.min(h - 118, 496)
        : shortH
          ? Math.min(h - 56, 326)
          : Math.min(Math.max(326, Math.round(h * 0.49)), 376)

    let bodyNode: LayoutNode

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
      const perPage = mobile ? 5 : 4
      const maxPage = Math.max(0, Math.ceil(sortedHeroes.length / perPage) - 1)
      rosterPage = Math.min(rosterPage, maxPage)
      const visibleHeroes = sortedHeroes.slice(rosterPage * perPage, rosterPage * perPage + perPage)

      const rosterButtons: LayoutNode[] = visibleHeroes.map((hero, idx) => {
        const spec = HERO_SPECS[hero.heroId]
        const inSquad = camp.squadUids.includes(hero.uid)
        const copies = getMergeCandidates(camp, hero.uid).length
        const need = hero.stars === 1 ? MERGE_COPIES_REQUIRED[1] : hero.stars === 2 ? MERGE_COPIES_REQUIRED[2] : 0
        const readyMerge = hero.stars < 3 && copies >= need
        const portrait = heroCardPortrait(hero)
        return boxNode({
          id: `camp-hero-${idx}`,
          style: mobile ? { grow: 1, height: 64 } : { height: 48 },
          widget: {
            type: 'button',
            label: `${spec.name} (${spec.title})`,
            selected: selHero?.uid === hero.uid,
            onPress: () => {
              audio.unlock()
              camp.selectedCampHeroUid = hero.uid
              uiDirty = true
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawHeroRosterCard(ctx, rect, {
              hero, spec, portrait, inSquad, copies, need, readyMerge, token: mobile
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

        const headerNode = boxNode({
          id: 'ins-head', style: { height: shortH ? 42 : 50 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawHeroHeader(ctx, rect, {
              name: spec.name,
              title: spec.title,
              stars: selHero.stars,
              rarity: spec.rarity,
              power: stats.powerScore,
              portrait: heroPortrait,
              inSquad
            })
          }
        })

        const statsNode = boxNode({
          id: 'ins-stats', style: { height: shortH ? 30 : mobile ? 34 : 38 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawStatStrip(ctx, rect, statItems)
          }
        })

        const actRowH = shortH ? 32 : 36
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
            id: 'cs-salvage-hero', style: { width: mobile ? 84 : 96, height: actRowH },
            widget: {
              type: 'button',
              label: `+${salvageVal}g`,
              disabled: camp.heroes.length <= 1 || (inSquad && camp.squadUids.length <= 1),
              onPress: () => {
                audio.unlock()
                const g = salvageHeroCard(state, selHero.uid)
                if (g > 0) {
                  saveNow()
                  showToast(`Salvaged hero card for +${g}g.`)
                }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, `+${salvageVal}g`, st, { variant: 'danger', icon: 'sell', size: 11 }
              )
            }
          })
        ])

        const bestFitUpgrades = findBestFitUpgrades(camp, selHero.uid)
        const bestFitCount = bestFitUpgrades.length
        const bestFitLabel = bestFitCount > 0 ? `Best Fit (+${bestFitCount})` : 'Best Fit'
        const gearHeaderRow = row({ id: 'ins-eq-head', style: { height: 24, gap: 8, align: 'center' } }, [
          boxNode({
            id: 'ins-eq-lbl', style: { grow: 1, height: 24 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawOverline(ctx, 'Equipped Gear', rect.x, rect.y + 12, rect.width)
            }
          }),
          boxNode({
            id: 'cs-auto-equip', style: { width: bestFitCount > 0 ? 114 : 88, height: 24 },
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

        const gearH = shortH ? 40 : mobile ? 44 : 48
        const gearRow = row({ id: 'ins-eq-row', style: { height: gearH, gap: 6 } }, [
          boxNode({
            id: 'eq-slot-weapon', style: { grow: 1, height: gearH },
            widget: {
              type: 'button',
              label: wSpec ? wSpec.name : 'Empty Weapon',
              onPress: () => {
                if (wSpec) { unequipItem(state, selHero.uid, 'weapon'); saveNow(); uiDirty = true }
                else { setCampTab('armory'); armorySlotFilter = 'weapon'; uiDirty = true }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEquipCard(ctx, rect, { slot: 'weapon', spec: wSpec }, st)
            }
          }),
          boxNode({
            id: 'eq-slot-armor', style: { grow: 1, height: gearH },
            widget: {
              type: 'button',
              label: aSpec ? aSpec.name : 'Empty Armor',
              onPress: () => {
                if (aSpec) { unequipItem(state, selHero.uid, 'armor'); saveNow(); uiDirty = true }
                else { setCampTab('armory'); armorySlotFilter = 'armor'; uiDirty = true }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEquipCard(ctx, rect, { slot: 'armor', spec: aSpec }, st)
            }
          }),
          boxNode({
            id: 'eq-slot-relic', style: { grow: 1, height: gearH },
            widget: {
              type: 'button',
              label: rSpec ? rSpec.name : 'Empty Relic',
              onPress: () => {
                if (rSpec) { unequipItem(state, selHero.uid, 'relic'); saveNow(); uiDirty = true }
                else { setCampTab('armory'); armorySlotFilter = 'relic'; uiDirty = true }
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEquipCard(ctx, rect, { slot: 'relic', spec: rSpec }, st)
            }
          })
        ])

        const skillRowH = wide ? 52 : shortH ? 28 : mobile ? 30 : 36
        const skillNodes: LayoutNode[] = spec.skills.map((sk, i) => {
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

        if (mobile) {
          bodyNode = column({ id: 'camp-squad-body', style: { grow: 1, gap: 6 } }, [
            row({ id: 'camp-roster-row', style: { height: 60, gap: 6 } }, rosterButtons),
            pagerNode,
            column({
              id: 'camp-inspector-col',
              style: { grow: 1, gap: 6, padding: 9 },
              widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWell(ctx, rect) }
            }, [
              headerNode,
              statsNode,
              actionsNode,
              gearHeaderRow,
              gearRow,
              ...skillNodes
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
              style: { grow: 1.25, gap: 7, padding: 11 },
              widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWell(ctx, rect) }
            }, [
              headerNode,
              statsNode,
              actionsNode,
              gearHeaderRow,
              gearRow
            ]),
            column({
              id: 'camp-skills-col',
              style: { grow: 0.9, gap: 7, padding: 12 },
              widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWell(ctx, rect) }
            }, [
              boxNode({
                id: 'ins-sk-lbl', style: { height: 14 },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawOverline(ctx, 'Skill Ascension', rect.x, rect.y + 7, rect.width)
                }
              }),
              ...skillNodes,
              spacerNode(1),
              boxNode({
                id: 'ins-sk-tip', style: { height: 16 },
                widget: {
                  type: 'panel',
                  draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                    ctx, rect, 'Merge 3 copies for Tier 2, 2 copies for Tier 3', { size: 10.5, color: COLOR.faint }
                  )
                }
              })
            ])
          ])
        } else {
          // Medium tablet / landscape phone: 2 columns
          bodyNode = row({ id: 'camp-squad-body', style: { grow: 1, gap: 10 } }, [
            column({ id: 'camp-roster-col', style: { width: 214, gap: 6 } }, [
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
              pagerNode
            ]),
            column({
              id: 'camp-inspector-col',
              style: { grow: 1, gap: 5, padding: shortH ? 7 : 10 },
              widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawWell(ctx, rect) }
            }, [
              headerNode,
              statsNode,
              actionsNode,
              gearHeaderRow,
              gearRow,
              ...skillNodes.slice(0, shortH ? 1 : 2)
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
      const squadHeroes = camp.squadUids
        .map(uid => getHeroByUid(camp, uid))
        .filter((hero): hero is OwnedHeroCard => Boolean(hero))
      const filtered: OwnedEquipCard[] = camp.equipment.filter(
        e => armorySlotFilter === 'all' || e.slot === armorySlotFilter
      )
      const cols = mobile ? 1 : 2
      const rowsPerPage = mobile ? 4 : shortH ? 2 : 3
      const perPage = cols * rowsPerPage
      const maxPage = Math.max(0, Math.ceil(filtered.length / perPage) - 1)
      armoryPage = Math.min(armoryPage, maxPage)
      const shown = filtered.slice(armoryPage * perPage, armoryPage * perPage + perPage)

      const itemRows: LayoutNode[] = []
      const cardH = shortH ? 46 : 52
      for (let i = 0; i < shown.length; i += cols) {
        const slice = shown.slice(i, i + cols)
        const cards: LayoutNode[] = slice.map((item, j) => {
          const spec = EQUIPMENT_BY_ID[item.equipId]
          const meta = spec ? RARITY_META[spec.rarity] : RARITY_META.common
          const owner = findEquipOwner(camp, item.uid)
          const equippedOnSel = owner?.uid === selHero?.uid
          const ownerLabel = owner ? HERO_SPECS[owner.heroId].name : 'Bag'
          return row({ id: `arm-card-${i + j}`, style: { grow: 1, gap: 6 } }, [
            boxNode({
              id: `arm-equip-${i + j}`, style: { grow: 1, height: cardH },
              widget: {
                type: 'button',
                label: spec?.name ?? item.equipId,
                selected: equippedOnSel,
                onPress: () => {
                  audio.unlock()
                  if (selHero) {
                    const wasOnSel = findEquipOwner(camp, item.uid)?.uid === selHero.uid
                    if (equipItem(state, selHero.uid, item.uid)) {
                      saveNow()
                      scene.triggerCampEquipFlourish(selHero.uid, item.slot, spec?.accentHex)
                      showToast(`Equipped ${spec?.name ?? 'item'} on ${HERO_SPECS[selHero.heroId].name}.`)
                      if (!wasOnSel) startEquipFanfare(selHero, item.equipId)
                    }
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawEquipCard(ctx, rect, {
                  slot: item.slot,
                  spec,
                  ownerText: equippedOnSel ? undefined : ownerLabel,
                  equippedOnSelected: equippedOnSel
                }, st)
              }
            }),
            boxNode({
              id: `arm-sell-${i + j}`, style: { width: 64, height: cardH },
              widget: {
                type: 'button',
                label: `Sell +${meta.salvage}g`,
                onPress: () => {
                  audio.unlock()
                  const g = salvageEquipCard(state, item.uid)
                  if (g > 0) {
                    saveNow()
                    showToast(`Sold ${spec?.name ?? 'item'} for +${g}g.`)
                  }
                },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                  ctx, rect, `+${meta.salvage}g`, st, { variant: 'danger', sub: 'Sell', size: 11 }
                )
              }
            })
          ])
        })
        while (cards.length < cols) cards.push(spacerNode(1))
        itemRows.push(row({ id: `arm-row-${i}`, style: { height: cardH, gap: 8 } }, cards))
      }

      if (itemRows.length === 0) {
        itemRows.push(boxNode({
          id: 'arm-empty', style: { height: 76 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawEmptyNote(ctx, rect, 'No equipment in this slot yet. Win battles or open Card Decks.')
          }
        }))
      }

      const armBestCount = selHero ? findBestFitUpgrades(camp, selHero.uid).length : 0
      const armBestLabel = armBestCount > 0 ? `Best Fit (+${armBestCount})` : 'Best Fit'
      const armPortrait = heroCardPortrait(selHero)
      const armHeroPortraitNode = boxNode({
        id: 'arm-sel-portrait',
        style: { width: 34, height: 34 },
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
        style: { grow: 1.2, height: 34, padding: 3, gap: 4 },
        widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSegmentTrack(ctx, rect) }
      }, squadHeroes.map((hero, idx) => {
        const label = HERO_SPECS[hero.heroId].name.split(' ').pop() ?? HERO_SPECS[hero.heroId].name
        return boxNode({
          id: `arm-h-${idx}`, style: { grow: 1, height: 28 },
          widget: {
            type: 'button',
            label,
            selected: selHero?.uid === hero.uid,
            onPress: () => { camp.selectedCampHeroUid = hero.uid; uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, label, st)
          }
        })
      }))
      const armFilterStrip = row({
        id: 'arm-filters',
        style: mobile ? { height: 34, padding: 3, gap: 4 } : { grow: 1, height: 34, padding: 3, gap: 4 },
        widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSegmentTrack(ctx, rect) }
      }, ARMORY_FILTERS.map(slot => {
        const label = slot === 'all' ? 'All' : slot[0].toUpperCase() + slot.slice(1)
        return boxNode({
          id: `arm-f-${slot}`, style: { grow: 1, height: 28 },
          widget: {
            type: 'button',
            label,
            selected: armorySlotFilter === slot,
            onPress: () => { armorySlotFilter = slot; armoryPage = 0; uiDirty = true },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, label, st)
          }
        })
      }))
      const armBestBtn = boxNode({
        id: 'cs-auto-equip', style: { width: armBestCount > 0 ? 114 : 88, height: 34 },
        widget: {
          type: 'button',
          label: armBestLabel,
          disabled: !selHero || armBestCount === 0,
          onPress: () => {
            audio.unlock()
            if (selHero) runBestFit(selHero.uid)
          },
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
            ctx, rect, armBestLabel, st, { variant: armBestCount > 0 ? 'success' : 'secondary', icon: 'sparkle', size: 11 }
          )
        }
      })

      bodyNode = column({ id: 'camp-armory-body', style: { grow: 1, gap: 8 } }, [
        ...(mobile
          ? [
              row({ id: 'arm-top-m1', style: { height: 34, gap: 6, align: 'center' } }, [armHeroPortraitNode, armHeroStrip, armBestBtn]),
              armFilterStrip
            ]
          : [
              row({ id: 'arm-top-controls', style: { height: 34, gap: 8, align: 'center' } }, [armHeroPortraitNode, armHeroStrip, armFilterStrip, armBestBtn])
            ]),
        ...itemRows,
        spacerNode(1),
        row({ id: 'arm-pager', hidden: maxPage === 0, style: { height: 28, gap: 8, align: 'center' } }, [
          boxNode({
            id: 'arm-prev', style: { width: 88, height: 28 },
            widget: {
              type: 'button', label: 'Prev', disabled: armoryPage <= 0,
              onPress: () => { armoryPage--; uiDirty = true },
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
              onPress: () => { armoryPage++; uiDirty = true },
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
    } else {
      // Booster Card Decks & Pack Reveal
      const hasReveal = camp.lastPackReveal.length > 0 && !packAnim
      const packH = hasReveal ? (shortH ? 52 : 64) : (shortH ? 148 : mobile ? 156 : 196)
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
                showToast(`Opened ${pack.name} - ${pulled.length} cards added to collection.`)
                uiDirty = true
              }
            },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawBoosterPack(ctx, rect, pack, st, camp.gold)
          }
        })
      })

      const revealH = shortH ? 148 : mobile ? 176 : 168
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
              id: 'dk-odds', style: { height: 22 },
              widget: {
                type: 'panel',
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
                  ctx,
                  rect,
                  `Odds: Recruit (0.45% Epic / 0.05% Leg) · Vanguard (1.5% / 0.15%) · Sovereign (5.2% / 0.8%) · Packs: ${camp.packsOpened}`,
                  { size: 10.5, color: COLOR.muted, align: 'center' }
                )
              }
            })
          ]

      bodyNode = column({ id: 'camp-decks-body', style: { grow: 1, gap: 10 } }, [
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
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawCampHeader(ctx, rect, camp.gold, deckValue, isPhone)
          }
        }),
        // World Map + Quick Deploy bar
        row({
          id: 'cp-chapter-bar',
          style: { width: mobile ? 196 : 368, height: shortH ? 36 : 42, padding: [3, 5], gap: 6, align: 'center' },
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
            id: 'cs-camp-battle', style: { width: mobile ? 106 : 126, height: 34 },
            widget: {
              type: 'button',
              label: 'World Map',
              primary: true,
              onPress: () => { audio.unlock(); openWorldMap() },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, mobile ? 'Map' : 'World Map', st, { variant: 'primary', icon: 'map', size: 13 }
              )
            }
          }),
          boxNode({
            id: 'cs-camp-quick-fight', style: { width: mobile ? 76 : 86, height: 34 },
            widget: {
              type: 'button',
              label: 'Fight',
              disabled: !isStageUnlocked(camp, selectedStage),
              onPress: () => {
                audio.unlock()
                openStory(selectedStage.index, pendingEndless)
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Fight', st, { variant: 'success', icon: 'sword', size: 12.5 }
              )
            }
          })
        ])
      ]),

      // Floating Toast above the bottom sheet
      ...(campToast ? [boxNode({
        id: 'camp-toast',
        style: { anchor: 'bottom', width: Math.min(sheetW - 24, 520), height: 32, inset: [8, sheetH + 18], respectSafeArea: true },
        widget: {
          type: 'panel',
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawToast(ctx, rect, campToast)
        }
      })] : []),

      // Bottom Glass Sheet Drawer
      column({
        id: 'camp-modal',
        style: { anchor: 'bottom', width: sheetW, height: sheetH, inset: isPhone ? 6 : 12, padding: collapsed ? [10, 12] : shortH ? [10, 12, 8, 12] : [16, 14, 12, 14], gap: shortH ? 6 : 10, respectSafeArea: true },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSheet(ctx, rect)
        }
      }, [
        // Segmented control tab bar (+ 3D peek collapse button on phones!)
        row({ id: 'camp-tabs-row', style: { height: shortH ? 34 : 38, gap: 6, align: 'center' } }, [
          row({
            id: 'camp-tabs',
            style: { grow: 1, height: shortH ? 34 : 38, padding: 3, gap: 4 },
            widget: { type: 'panel', draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawSegmentTrack(ctx, rect) }
          }, [
            boxNode({
              id: 'cs-tab-squad', style: { grow: 1, height: shortH ? 28 : 32 },
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
            }),
            boxNode({
              id: 'cs-tab-armory', style: { grow: 1, height: shortH ? 28 : 32 },
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
            }),
            boxNode({
              id: 'cs-tab-decks', style: { grow: 1, height: shortH ? 28 : 32 },
              widget: {
                type: 'button',
                label: 'Card Decks',
                selected: campTab === 'decks',
                onPress: () => { setCampTab('decks'); mobileCampCollapsed = false; uiDirty = true },
                draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawTab(ctx, rect, mobile ? 'Decks' : 'Card Decks', st, {
                  icon: 'cards',
                  count: mobile ? undefined : `${camp.gold}g`
                })
              }
            })
          ]),
          ...(isPhone ? [boxNode({
            id: 'cs-camp-toggle', style: { width: 54, height: shortH ? 34 : 38 },
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
    const shortH = h < 480
    const battle = state.battle
    const reward = battle?.reward
    const ch = CHAPTERS[battle?.chapterIndex ?? 0]
    const eqSpec = reward?.equipCard ? EQUIPMENT_BY_ID[reward.equipCard.equipId] : undefined
    const heroSpec = reward?.heroCard ? HERO_SPECS[reward.heroCard.heroId] : undefined
    const tacSpec = reward?.tacticCard ? TACTIC_BY_ID[reward.tacticCard.tacticId] : undefined
    const copies = reward?.heroCard
      ? state.campaign.heroes.filter(h => h.heroId === reward.heroCard?.heroId && h.stars === 1).length
      : 0

    const title = won ? (reward?.campaignWon ? 'Sunstone Crown Reforged' : 'Victory!') : 'Vanguard Defeated'
    const sub = won
      ? `${ch.title}${reward && !reward.firstClear && (battle?.endlessWave ?? 0) === 0 ? ' · Replay' : ''}`
      : `${ch.title} · Regroup & Adapt`
    const quote = won
      ? `${ch.outroSpeaker}: "${ch.outroText}"`
      : 'Return to Vanguard Camp to equip stronger gear, open booster decks, or merge 3 identical heroes to unlock Tier 2 skills.'

    const rowH = shortH ? 38 : 48
    const rewardRows: LayoutNode[] = []
    if (won && reward) {
      const goldRollU = Math.max(0, Math.min(1, (resultAnimTime - 0.22) / 0.6))
      const shownGold = Math.round(reward.gold * (1 - Math.pow(1 - goldRollU, 3)))
      const rowReveal = (idx: number) => Math.max(0, Math.min(1, (resultAnimTime - (0.28 + idx * 0.16)) / 0.34))

      let rIdx = 0
      const goldIdx = rIdx++
      rewardRows.push(
        boxNode({
          id: 'res-gold', style: { height: rowH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRowAnimated(ctx, rect, {
              icon: 'coin',
              title: `+${shownGold} Gold`,
              detail: `Treasury total: ${state.campaign.gold}g`,
              color: COLOR.accentHi,
              badge: reward.firstClear ? 'FIRST CLEAR' : 'REPLAY'
            }, rowReveal(goldIdx))
          }
        })
      )
      if (reward.equipCard && eqSpec) {
        const eqIdx = rIdx++
        rewardRows.push(
          boxNode({
            id: 'res-eq', style: { height: rowH },
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
        rewardRows.push(
          boxNode({
            id: 'res-hero', style: { height: rowH },
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
        rewardRows.push(
          boxNode({
            id: 'res-tac', style: { height: rowH },
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
      if (reward.unlockedSlot4) {
        const sIdx = rIdx++
        rewardRows.push(boxNode({
          id: 'res-slot4', style: { height: shortH ? 36 : 44 },
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

    const btnH = shortH ? 38 : 44
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
        style: { anchor: 'center', width: Math.min(w - 24, 512), padding: shortH ? 14 : 24, gap: shortH ? 7 : 12 },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawModal(ctx, rect, won ? COLOR.accent : COLOR.enemy)
        }
      }, [
        boxNode({
          id: 'res-title', style: { height: shortH ? 48 : 62 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawResultHeadlineAnimated(ctx, rect, title, sub, won, resultAnimTime)
          }
        }),
        ...(shortH && won ? [] : [boxNode({
          id: 'res-story', style: { height: shortH ? 40 : 50 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
              ctx, rect, quote, { size: 12.5, weight: 500, color: COLOR.muted, align: 'center', wrap: true, lineHeight: 16.5 }
            )
          }
        })]),
        ...rewardRows,
        row({ id: 'res-btns', style: { height: btnH, gap: 8 } }, won ? [
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
              label: (state.battle?.endlessWave ?? 0) > 0 ? 'Next Wave' : 'World Map',
              primary: true,
              onPress: advanceAfterVictory,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx,
                rect,
                (state.battle?.endlessWave ?? 0) > 0 ? 'Next Wave' : 'World Map',
                st,
                { variant: 'primary', icon: (state.battle?.endlessWave ?? 0) > 0 ? 'arrow-right' : 'map', size: 14 }
              )
            }
          })
        ] : [
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
              type: 'button', label: 'Retry', primary: true, onPress: launchBattle,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Retry', st, { variant: 'primary', icon: 'play', size: 13.5 }
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
    const shortH = h < 480
    const rowH = shortH ? 34 : 42
    const btnH = shortH ? 38 : 46
    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({ id: 'p-scrim', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'p-card',
        style: { anchor: 'center', width: Math.min(w - 24, 360), padding: shortH ? 14 : 22, gap: shortH ? 7 : 10 },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawModal(ctx, rect, COLOR.accent)
        }
      }, [
        boxNode({
          id: 'p-title', style: { height: shortH ? 26 : 34 },
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
          id: 'cs-retreat', style: { height: rowH },
          widget: {
            type: 'button', label: 'Retreat to Camp', onPress: () => openCamp('squad'),
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, 'Retreat to Camp', st, { variant: 'danger', icon: 'retreat', size: 13 }
            )
          }
        })
      ])
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

  function buildUiTree(w: number, h: number): LayoutNode {
    const base = screen === 'title' ? buildTitleTree(w, h)
      : screen === 'world' ? buildWorldMapTree(w, h)
      : screen === 'story' ? buildStoryTree(w, h)
      : screen === 'battle' ? buildBattleTree(w, h)
      : screen === 'camp' ? buildCampTree(w, h)
      : screen === 'victory' ? buildResultTree(w, h, true)
      : screen === 'defeat' ? buildResultTree(w, h, false)
      : buildPausedTree(w, h)
    if (!showPerfPanel) return base
    return overlay({ id: 'root-perf', style: { anchor: 'fill' } }, [base, buildPerfDebugNode()])
  }

  // =========================================================================
  // WORLD-SPACE BATTLE HUD (HP BARS, FLOATING DAMAGE, TERRAIN PILL, BANNER)
  // =========================================================================

  function paintHud(g: HudPainter) {
    const battle = state.battle
    if (screen !== 'battle' || !battle) return

    for (const u of battle.units) {
      if (!u.alive) continue
      const projected = scene.project(u.x, u.y + (u.isBoss ? 2.25 : 1.88), u.z, g.width, g.height)
      if (!projected) continue
      const isActive = u.uid === battle.activeUnitUid
      const bw = u.isBoss ? 90 : 66
      const bx = Math.round(projected.x - bw / 2)
      const by = Math.round(projected.y - 16)
      const hpRatio = Math.max(0, Math.min(1, u.hp / Math.max(1, u.maxHp)))

      const shortName = u.team === 'ally' ? (u.name.split(' ').pop() ?? u.name) : u.name
      const tag = u.team === 'ally' && u.stars > 1 ? `${shortName} T${u.stars}` : shortName
      const nameW = Math.max(bw + 8, tag.length * 6.8 + 16)
      if (isActive) {
        g.panel(Math.round(projected.x - nameW / 2), by - 21, Math.round(nameW), 17, {
          fill: '#2b3a63',
          stroke: COLOR.accent,
          radius: 8
        })
      }
      g.text(tag, projected.x, by - 16.5, {
        fill: '#080c18',
        size: isActive ? 11 : 10.5,
        weight: 900,
        align: 'center'
      })
      g.text(tag, projected.x, by - 18, {
        fill: isActive ? COLOR.accentHi : u.team === 'ally' ? '#ffffff' : '#ffd2d6',
        size: isActive ? 11 : 10.5,
        weight: 900,
        align: 'center'
      })

      // Chunky dark-outlined tactical HP + Shield + CT gauge
      g.panel(bx - 2, by - 2, bw + 4, 13, {
        fill: '#0b1020',
        stroke: isActive ? COLOR.accent : u.team === 'ally' ? '#5cb8ff' : '#ff5e6e',
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
    }

    for (const fn of battle.floatingNumbers) {
      const p = scene.project(fn.x, fn.y, fn.z, g.width, g.height)
      if (!p) continue
      g.text(fn.text, p.x, p.y + 2, { fill: '#090d1a', size: 17, weight: 900, align: 'center' })
      g.text(fn.text, p.x, p.y, { fill: fn.color, size: 17, weight: 900, align: 'center' })
    }

    const hovered = scene.getHoveredCell()
    if (hovered && g.width >= 660) {
      const cell = battle.cells[hovered.row]?.[hovered.col]
      if (cell && cell.terrain !== 'void') {
        const desc = TERRAIN_LABEL[cell.terrain] ?? cell.terrain
        const hLvl = cellHeightLevel(cell)
        const text = `${desc} · H${hLvl} (${hovered.col + 1},${hovered.row + 1})`
        const pw = Math.min(284, Math.max(148, text.length * 7 + 24))
        const py = g.height < 480 ? 48 : 58
        g.panel(10, py, pw, 28, { fill: '#253357', stroke: COLOR.borderHi, radius: 10 })
        g.text(text, 22, py + 8, { fill: '#ffffff', size: 11.5, weight: 800 })
      }
    }

    if (battle.bannerTimer > 0 && battle.bannerText) {
      const bw = Math.min(g.width - 32, Math.max(248, battle.bannerText.length * 10 + 48))
      const by = g.width < 660 ? 114 : g.height < 480 ? 64 : 92
      g.panel(Math.round((g.width - bw) / 2), by, bw, 38, { fill: '#283863', stroke: COLOR.accent, radius: 14 })
      g.text(battle.bannerText, g.width / 2, by + 13, { fill: '#090d1a', size: 15, weight: 900, align: 'center' })
      g.text(battle.bannerText, g.width / 2, by + 11.5, { fill: COLOR.accentHi, size: 15, weight: 900, align: 'center' })
    }
  }

  let lastBattlePhase: string | null = null
  let lastActiveUid: string | null = null

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
      chaptersCleared: state.campaign.chaptersCleared,
      clearedStageIds: state.campaign.clearedStageIds.slice(),
      selectedStageId: state.campaign.selectedStageId,
      packAnimPhase: packAnim?.phase ?? null,
      resultAnimTime: Math.round(resultAnimTime * 100) / 100,
      heroesCount: state.campaign.heroes.length,
      equipmentCount: state.campaign.equipment.length,
      tacticsCount: state.campaign.tactics.length,
      deckValue: computeDeckValue(state.campaign),
      battlePhase: state.battle?.phase ?? null,
      battleCols: state.battle?.cols ?? 0,
      battleRows: state.battle?.rows ?? 0,
      battleTurn: state.battle?.turn ?? 0,
      battleAp: state.battle?.ap ?? 0,
      activeUnitUid: state.battle?.activeUnitUid ?? null,
      turnOrder: state.battle?.turnOrder.map(t => t.name) ?? [],
      battleAlliesAlive: state.battle ? state.battle.units.filter(u => u.alive && u.team === 'ally').length : 0,
      battleEnemiesAlive: state.battle ? state.battle.units.filter(u => u.alive && u.team === 'enemy').length : 0,
      moveAttackTargets: state.battle ? state.battle.moveAttackTiles.map(t => ({ col: t.col, row: t.row, fromCol: t.fromCol, fromRow: t.fromRow })) : [],
      mobileHandOpen,
      campCollapsed: mobileCampCollapsed,
      cameraZoom: Math.round(scene.getCameraZoom() * 1000) / 1000,
      cameraYaw: Math.round(scene.getCameraYaw() * 1000) / 1000
    }),
    extra: {
      perf: () => perf.snapshot(),
      perfLog: () => perfLogger.getHistory(),
      openWorldMap: (stageId?: string) => {
        openWorldMap(stageId)
        renderUiNow()
      },
      setWorldMapView: (panX: number, panY: number, zoom: number) => {
        worldMapTargetPanX = panX
        worldMapTargetPanY = panY
        worldMapTargetZoom = zoom
        clampWorldMapView()
        worldMapPanX = worldMapTargetPanX
        worldMapPanY = worldMapTargetPanY
        worldMapZoom = worldMapTargetZoom
        uiDirty = true
        renderUiNow()
      },
      openCamp: (tab: CampTab = 'squad') => {
        openCamp(tab)
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
      selectTile: (col: number, row: number) => {
        lockedForecastCell = null
        const ok = selectTile(state, col, row)
        if (ok) { uiDirty = true; hudRev++; renderUiNow() }
        return ok
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
      }
    }
  })

  let lastRenderAt: number | undefined
  let perfUiTick = 0
  let lastCompassSig = 0

  const stop = fixedLoop({
    update(dt) {
      const t0 = performance.now()
      stepGame(state, dt)
      if (campToastTimer > 0) {
        campToastTimer = Math.max(0, campToastTimer - dt)
        if (campToastTimer === 0) { campToast = ''; uiDirty = true }
      }
      const bPhase = state.battle?.phase ?? null
      const activeUid = state.battle?.activeUnitUid ?? null
      if (bPhase !== lastBattlePhase || activeUid !== lastActiveUid) {
        lastBattlePhase = bPhase
        lastActiveUid = activeUid
        lockedForecastCell = null
        mobileHandOpen = false
        uiDirty = true
        hudRev++
        if (bPhase === 'victory' && screen === 'battle') {
          saveNow()
          setScreen('victory')
        } else if (bPhase === 'defeat' && screen === 'battle') {
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

      // Advance animated UI scenes (World Map pan/zoom/trails, Victory/Defeat FX, Pack Lottery Ceremony)
      if (screen === 'world') {
        worldMapTime += renderDt
        const smooth = Math.min(1, renderDt * 10)
        worldMapPanX += (worldMapTargetPanX - worldMapPanX) * smooth
        worldMapPanY += (worldMapTargetPanY - worldMapPanY) * smooth
        worldMapZoom += (worldMapTargetZoom - worldMapZoom) * smooth
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
      const fcSig = activeForecast
        ? `${activeForecast.attackerUid}:${activeForecast.targetUid}:${activeForecast.mode}:${activeForecast.skillIndex}:${activeForecast.targetCol},${activeForecast.targetRow}:${lockedForecastCell ? 1 : 0}`
        : ''
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
      const stats = scene.render(state, renderDt, w, h)
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
        b && (cameraMoving || b.floatingNumbers.length > 0 || b.bannerTimer > 0 || b.shake > 0 || b.units.some(u => u.path.length > 0))
      )
      const hudKey = screen === 'battle'
        ? `b:${hudRev}:${animatingHud ? Math.floor(now / 33) : 0}:${scene.getHoveredCell()?.col ?? -1},${scene.getHoveredCell()?.row ?? -1}`
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
      stop()
      stopLifecycle()
      page.dispose()
      perfLogger.dispose()
      inputAbort.abort()
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
