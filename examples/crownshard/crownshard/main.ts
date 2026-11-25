import {
  createGamePage, createHud, createLowPolyRenderer, createPerfLogger, createPerfMonitor, fixedLoop
} from 'ridgetop'
import type { Backend, HudPainter } from 'ridgetop'
import { boxNode, column, overlay, row, spacerNode } from 'ridgetop/ui-layout'
import type { LayoutNode, LayoutRect } from 'ridgetop/ui-layout'
import { buttonPrimitive } from 'ridgetop/ui-button'
import { createCanvasUi, createUiTheme } from 'ridgetop/ui-canvas'
import type { CanvasWidgetDrawState } from 'ridgetop/ui-canvas'
import { isTestingPaused } from 'ridgetop/testing'
import { bakePortraitCanvases } from './art.ts'
import { createCrownshardAudio } from './audio.ts'
import {
  CHAPTERS, EQUIPMENT_BY_ID, HERO_SPECS, MERGE_COPIES_REQUIRED, PACK_LIST,
  RARITY_META, TACTIC_BY_ID
} from './data.ts'
import { createCrownshardScene } from './scene.ts'
import {
  armSkill, armTacticCard, autoEquipBestFit, buyPack, canBuyPack, canMergeHero, clearSave,
  computeCombatForecast, computeDeckValue, computeHeroStats, createInitialState, effectiveSpeed,
  endPlayerTurn, equipItem, findBestFitUpgrades, findEquipOwner, getEquipmentByUid, getHeroByUid,
  getHeroSkill, getMergeCandidates, getTacticByUid, getUnitByUid, loadSave,
  maxSquadSize, mergeHero, persistSave, salvageEquipCard, salvageHeroCard,
  selectHeroByUid, selectTile, startChapterBattle, stepGame,
  toggleSquadMember, unequipItem
} from './simulation.ts'
import type { CombatForecast, GameState, OwnedEquipCard, OwnedHeroCard, PackId } from './types.ts'
import {
  COLOR, RADIUS, TIER_COLOR, TYPE, UI_THEME_PALETTE,
  drawApMeter, drawBattleInfo, drawBoosterPack, drawButton, drawCampHeader,
  drawChapterPicker, drawCombatForecast, drawControlHints, drawEmptyNote, drawEndTurnButton,
  drawEquipCard, drawForecastAltChip, drawHeroHeader, drawHeroRosterCard, drawHintPill,
  drawIconButton, drawLabel, drawLetterbox, drawLootRow, drawModal,
  drawOverline, drawPanel, drawResultHeadline, drawRevealCard, drawRewardRow,
  drawSegmentTrack, drawSettingRow, drawSheet, drawSkillRow, drawSkillTile,
  drawSpeakerPortrait, drawStatStrip, drawStoryHeading, drawTab, drawTacticCard,
  drawTimelineBg, drawTitleCard, drawTitleLogo, drawToast, drawToolbarBg,
  drawTopFade, drawTurnToken, drawUnitCard, drawWell
} from './ui-art.ts'
import type { IconName } from './ui-art.ts'

type Screen = 'title' | 'camp' | 'story' | 'battle' | 'victory' | 'defeat' | 'paused'
type CampTab = 'squad' | 'armory' | 'decks'
type ArmoryFilter = 'all' | 'weapon' | 'armor' | 'relic'

const ARMORY_FILTERS: readonly ArmoryFilter[] = ['all', 'weapon', 'armor', 'relic']

const TERRAIN_LABEL: Record<string, string> = {
  grass: 'Meadow',
  stone: 'Flagstone',
  hill: 'High Ground (+20% DMG)',
  bridge: 'Bridge',
  water: 'Deep Water (Blocked)',
  shrine: 'Sun Shrine (+14 HP/Turn)',
  pillar: 'Stone Pillar (Cover)',
  lava: 'Molten Rift (Blocked)',
  snow: 'Alpine Snow',
  darkstone: 'Obsidian Floor'
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
  ['1 Q W E', 'Skills'],
  ['Space', 'End Turn'],
  ['A / D', 'Orbit']
]

async function start() {
  const page = createGamePage()
  const { element } = page
  const requested = page.url.searchParams.has('canvas') ? 'canvas' : page.url.searchParams.get('renderer')
  const backend: Backend = requested === 'webgpu' || requested === 'webgl2' || requested === 'canvas' ? requested : 'auto'
  let showPerfPanel = page.url.searchParams.has('fps') || page.url.searchParams.has('perf')

  const stage = element<HTMLCanvasElement>('cs-stage')
  const hudCanvas = element<HTMLCanvasElement>('cs-hud')
  const uiCanvas = element<HTMLCanvasElement>('cs-ui')

  // Cap pixelRatio to 1.5 for crisp visuals without over-driving laptop GPU fans
  const renderer = await createLowPolyRenderer(stage, {
    backend,
    pixelRatio: 1.5,
    canvasDepth: true,
    lighting: { direction: [-0.55, 0.78, 0.42], ambient: 0.50 }
  })
  const hud = createHud(hudCanvas)
  const scene = createCrownshardScene(renderer)
  const audio = createCrownshardAudio()
  const perf = createPerfMonitor(60)
  const portraits = bakePortraitCanvases()

  const existingSave = loadSave(page.storage)
  let state: GameState = createInitialState(1337, existingSave)
  let screen: Screen = 'title'
  let campTab: CampTab = 'squad'
  let pendingChapter = Math.min(state.campaign.chaptersCleared, CHAPTERS.length - 1)
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

  function setScreen(next: Screen) {
    screen = next
    lockedForecastCell = null
    mobileHandOpen = false
    if (next === 'title' || next === 'camp' || next === 'story') {
      scene.setCampFraming(next)
      scene.setForecast(null)
    }
    uiDirty = true
    hudRev++
  }

  function openCamp(tab: CampTab = campTab) {
    state.battle = null
    campTab = tab
    mobileCampCollapsed = false
    pendingChapter = Math.min(state.campaign.chaptersCleared, CHAPTERS.length - 1)
    pendingEndless = 0
    if (!getHeroByUid(state.campaign, state.campaign.selectedCampHeroUid)) {
      state.campaign.selectedCampHeroUid = state.campaign.squadUids[0] ?? state.campaign.heroes[0]?.uid ?? null
    }
    setScreen('camp')
  }

  function openStory(chapterIndex: number, endlessWave = 0) {
    pendingChapter = Math.max(0, Math.min(CHAPTERS.length - 1, chapterIndex))
    pendingEndless = endlessWave
    setScreen('story')
  }

  function launchBattle() {
    audio.unlock()
    startChapterBattle(state, pendingChapter, pendingEndless)
    setScreen('battle')
    renderer.canvas.focus()
  }

  function startCampaign(fresh = false) {
    audio.unlock()
    if (fresh) {
      clearSave(page.storage)
      state = createInitialState((Date.now() & 0xffff) || 1337)
      saveNow()
      openStory(0, 0)
    } else if (state.campaign.battlesWon === 0) {
      openStory(0, 0)
    } else {
      openCamp('squad')
    }
  }

  // Headless-accessible UI primitives for top-level actions
  const playBtn = buttonPrimitive.create({ id: 'cs-play', label: 'Begin Campaign', onPress: () => startCampaign(false) })
  const newBtn = buttonPrimitive.create({ id: 'cs-new', label: 'New Campaign', onPress: () => startCampaign(true) })
  const storyGoBtn = buttonPrimitive.create({ id: 'cs-story-go', label: 'Deploy to Battle', onPress: launchBattle })
  const storyBackBtn = buttonPrimitive.create({ id: 'cs-story-back', label: 'Vanguard Camp', onPress: () => openCamp('squad') })
  const endTurnBtn = buttonPrimitive.create({
    id: 'cs-end-turn',
    label: 'End Turn',
    onPress: () => {
      audio.unlock()
      if (state.battle?.phase === 'player') {
        lockedForecastCell = null
        mobileHandOpen = false
        endPlayerTurn(state)
        uiDirty = true
        hudRev++
      }
    }
  })
  const pauseBtn = buttonPrimitive.create({
    id: 'cs-pause',
    label: 'Menu',
    onPress: () => {
      audio.unlock()
      if (screen === 'battle') setScreen('paused')
      else if (screen === 'paused') setScreen('battle')
    }
  })
  const resumeBtn = buttonPrimitive.create({ id: 'cs-resume', label: 'Resume Battle', onPress: () => setScreen('battle') })
  const retreatBtn = buttonPrimitive.create({ id: 'cs-retreat', label: 'Retreat to Camp', onPress: () => openCamp('squad') })
  const musicBtn = buttonPrimitive.create({
    id: 'cs-music',
    label: 'Music',
    onPress: () => {
      audio.unlock()
      audio.setMusic(!audio.isMusicEnabled())
      uiDirty = true
    }
  })
  const muteBtn = buttonPrimitive.create({
    id: 'cs-mute',
    label: 'Mute',
    onPress: () => {
      audio.unlock()
      audio.setMuted(!audio.isMuted())
      uiDirty = true
    }
  })
  const perfBtn = buttonPrimitive.create({
    id: 'cs-perf',
    label: 'FPS',
    onPress: () => {
      showPerfPanel = !showPerfPanel
      uiDirty = true
      hudRev++
    }
  })
  const victoryCampBtn = buttonPrimitive.create({ id: 'cs-victory-camp', label: 'Vanguard Camp', onPress: () => openCamp('squad') })
  const victoryNextBtn = buttonPrimitive.create({
    id: 'cs-victory-next',
    label: 'Next Chapter',
    onPress: () => {
      const nextCh = Math.min(state.campaign.chaptersCleared, CHAPTERS.length - 1)
      if (state.campaign.chaptersCleared >= CHAPTERS.length) {
        openStory(CHAPTERS.length - 1, Math.max(1, (state.battle?.endlessWave ?? 0) + 1))
      } else {
        openStory(nextCh, 0)
      }
    }
  })
  const defeatRetryBtn = buttonPrimitive.create({ id: 'cs-defeat-retry', label: 'Retry Battle', onPress: launchBattle })
  const campBattleBtn = buttonPrimitive.create({
    id: 'cs-camp-battle',
    label: 'March to Battle',
    onPress: () => {
      audio.unlock()
      openStory(pendingChapter, pendingEndless)
    }
  })

  // Modern dark glass + warm gold accent UI theme
  const ui = createCanvasUi(uiCanvas, {
    theme: createUiTheme(UI_THEME_PALETTE),
    safeArea: { top: 8, right: 8, bottom: 8, left: 8 },
    keyboardEnabled: () => screen !== 'battle',
    onBack: () => {
      if (screen === 'paused') setScreen('battle')
      else if (screen === 'story') openCamp('squad')
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
    dragged: boolean
    pointerType: string
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
    if (isTestingPaused() || screen !== 'battle' || !state.battle) {
      scene.setHoveredCell(null)
      return
    }
    const { x, y, w, h } = pointerToCss(event)
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
      if (!boardDrag.dragged && dist > 12) {
        boardDrag.dragged = true
        scene.setHoveredCell(null)
      }
      if (boardDrag.dragged) {
        scene.rotateCamera((x - boardDrag.lastX) * 0.0055)
        boardDrag.lastX = x
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
    if (isTestingPaused() || screen !== 'battle' || !state.battle) return
    const { x, y, w, h } = pointerToCss(event)
    if (ui.blocksPoint(x, y)) return
    audio.unlock()

    // Right-click cancels locked forecast or armed skill/tactic
    if (event.pointerType === 'mouse' && event.button === 2) {
      if (lockedForecastCell) {
        lockedForecastCell = null
        uiDirty = true
        hudRev++
      }
      return
    }
    if (event.button !== 0 && event.pointerType === 'mouse') return

    // Touch supports 2-finger pinch-to-zoom/pan, 1-finger drag-to-orbit, and tap-to-preview
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
        dragged: false,
        pointerType: event.pointerType
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

  uiCanvas.addEventListener('pointercancel', event => {
    activeTouches.delete(event.pointerId)
    if (activeTouches.size === 0) {
      pinchState = null
      suppressTouchTap = false
    }
    boardDrag = null
  }, sig)

  uiCanvas.addEventListener('wheel', event => {
    if (isTestingPaused() || screen !== 'battle' || !state.battle) return
    const box = uiCanvas.getBoundingClientRect()
    if (ui.blocksPoint(event.clientX - box.left, event.clientY - box.top)) return
    event.preventDefault()
    scene.zoomCamera(event.deltaY > 0 ? 1.09 : 1 / 1.09)
    uiDirty = true
    hudRev++
  }, { signal: inputAbort.signal, passive: false })

  // Battle & Debug Keyboard Shortcuts
  window.addEventListener('keydown', event => {
    if (isTestingPaused() || event.altKey || event.ctrlKey || event.metaKey) return
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
      if (event.code === 'KeyA' || event.code === 'ArrowLeft') {
        scene.rotateCamera(-0.12)
        hudRev++
        return
      }
      if (event.code === 'KeyD' || event.code === 'ArrowRight') {
        scene.rotateCamera(0.12)
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
      if (event.code === 'KeyQ' && !event.repeat) { armSkill(state, 0); uiDirty = true; hudRev++; return }
      if (event.code === 'KeyW' && !event.repeat) { armSkill(state, 1); uiDirty = true; hudRev++; return }
      if (event.code === 'KeyE' && !event.repeat) { armSkill(state, 2); uiDirty = true; hudRev++; return }
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
      ? `Continue - Ch ${Math.min(state.campaign.chaptersCleared + 1, CHAPTERS.length)}`
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
              primitive: playBtn,
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
              primitive: newBtn,
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
  // STORY BRIEFING (CINEMATIC LETTERBOX OVER LIVE 3D DIORAMA)
  // =========================================================================

  function buildStoryTree(w: number, h: number): LayoutNode {
    const mobile = w < 640
    const shortH = h < 480
    const ch = CHAPTERS[pendingChapter]
    const eq = EQUIPMENT_BY_ID[ch.rewardEquipId]
    const hero = HERO_SPECS[ch.rewardHeroId]
    const speakerIcon = portraits[SPEAKER_PORTRAIT[ch.introSpeaker] ?? 'knight']
    const header = pendingEndless > 0 ? `Endless Arena - Wave ${pendingEndless}` : ch.title
    const desc = pendingEndless > 0
      ? `Eclipse remnants surge back into ${ch.subtitle}. Every wave scales foes and awards richer gold and rare loot.`
      : `"${ch.introText}"`

    const lootItems: { icon: IconName; text: string; color?: string }[] = pendingEndless > 0
      ? [
          { icon: 'coin', text: `+${140 + pendingEndless * 45}g`, color: COLOR.accentHi },
          { icon: 'bag', text: 'Random Gear', color: '#9fd3ff' },
          { icon: 'users', text: 'Random Hero', color: '#9ff0c4' }
        ]
      : [
          { icon: 'coin', text: `+${ch.rewardGold}g`, color: COLOR.accentHi },
          { icon: 'bag', text: eq?.name ?? 'Gear', color: eq ? RARITY_META[eq.rarity].hex : COLOR.text },
          { icon: 'users', text: `${hero.name} Card`, color: '#9ff0c4' }
        ]

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
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawStoryHeading(ctx, rect, ch.subtitle, header)
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
              label: 'Vanguard Camp',
              primitive: storyBackBtn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, mobile ? 'Camp' : 'Vanguard Camp', st, { variant: 'secondary', icon: 'camp', size: shortH ? 12 : 13 }
              )
            }
          }),
          boxNode({
            id: 'cs-story-go', style: { grow: 1.5, height: actH },
            widget: {
              type: 'button',
              label: 'Deploy Squad',
              primary: true,
              primitive: storyGoBtn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Deploy Squad', st, { variant: 'primary', icon: 'sword', size: shortH ? 14 : 15 }
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
      const pKey = entry.heroId ?? entry.enemyId ?? 'knight'
      const icon = portraits[pKey]
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

    // 2. Active Hero Skills (1, Q, W, E)
    const buildSkillTiles = (tileH: number): LayoutNode[] => {
      if (!active || active.team !== 'ally' || !active.heroId) return []
      const spec = HERO_SPECS[active.heroId]
      const canAct = isPlayerTurn && !active.acted && active.stunTurns === 0
      const keycaps: readonly string[] = ['Q', 'W', 'E']

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
              keycap: keycaps[i] ?? 'Q',
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

    let statusLine = 'Select a blue tile to move, a red/amber enemy to strike, or arm a tactic card.'
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

    const activePortrait = inspected ? portraits[inspected.heroId ?? inspected.enemyId ?? 'knight'] : undefined
    const roleLabel = inspected
      ? (inspected.heroId ? HERO_SPECS[inspected.heroId].title : inspected.isBoss ? 'Boss' : 'Foe')
      : ''
    const fpsShort = `${Math.round(perf.snapshot().fps || 60)}`
    const chapterShort = battle.endlessWave > 0 ? `Endless Wave ${battle.endlessWave}` : ch.title.replace('Chapter ', 'Ch ')

    // Top-right toolbar (compact on phone: Music + Pause only, touch drags to orbit!)
    const tbIconS = isPhone ? 28 : 32
    const toolbarItems: LayoutNode[] = [
      ...(isPhone ? [] : [
        boxNode({
          id: 'tb-cam-l', style: { width: tbIconS, height: tbIconS },
          widget: {
            type: 'button', label: 'Orbit Left',
            onPress: () => { scene.rotateCamera(-0.18); hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-left', st)
          }
        }),
        boxNode({
          id: 'tb-cam-r', style: { width: tbIconS, height: tbIconS },
          widget: {
            type: 'button', label: 'Orbit Right',
            onPress: () => { scene.rotateCamera(0.18); hudRev++ },
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'rotate-right', st)
          }
        }),
        boxNode({
          id: 'cs-perf', style: { width: 54, height: tbIconS },
          widget: {
            type: 'button', label: `${fpsShort} FPS`, selected: showPerfPanel, primitive: perfBtn,
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
          type: 'button', label: audio.isMusicEnabled() ? 'Music On' : 'Music Off', primitive: musicBtn,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'music', st, {
            active: audio.isMusicEnabled()
          })
        }
      }),
      boxNode({
        id: 'cs-pause', style: { width: tbIconS, height: tbIconS },
        widget: {
          type: 'button', label: 'Pause', primitive: pauseBtn,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'pause', st)
        }
      })
    ]
    const toolbarW = isPhone ? 74 : 212
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
              primitive: endTurnBtn,
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
            primitive: endTurnBtn,
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
            primitive: endTurnBtn,
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
      const attPortrait = fc.attackerHeroId ? portraits[fc.attackerHeroId] : undefined
      const tgtPortrait = portraits[fc.targetHeroId ?? fc.targetEnemyId ?? 'goblin']
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

      const confirmLabel = fc.targetTeam === 'ally'
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
                    variant: fc.targetTeam === 'ally' ? 'success' : fc.lethalNormal ? 'danger' : 'primary',
                    icon: fc.targetTeam === 'ally' ? 'heart' : 'sword',
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

    const singleTopRow = mobileLandscape || (!mobilePortrait && w >= 1040)
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

      // Compact one-thumb Zoom In / Out pill on phones (supplements 2-finger pinch-to-zoom)
      ...(showPhoneZoom ? [column({
        id: 'mobile-zoom-bar',
        style: {
          anchor: 'top-right',
          width: 38,
          height: 74,
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
    const nextCh = CHAPTERS[pendingChapter]
    const allCleared = camp.chaptersCleared >= CHAPTERS.length

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
        const portrait = portraits[hero.heroId]
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
        const heroPortrait = portraits[selHero.heroId]

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
                  const unlocked = spec.skills[selHero.stars - 1]
                  showToast(`${spec.name} ascended to Tier ${selHero.stars}! Unlocked ${unlocked.name}.`)
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
                else { campTab = 'armory'; armorySlotFilter = 'weapon'; uiDirty = true }
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
                else { campTab = 'armory'; armorySlotFilter = 'armor'; uiDirty = true }
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
                else { campTab = 'armory'; armorySlotFilter = 'relic'; uiDirty = true }
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
                    equipItem(state, selHero.uid, item.uid)
                    saveNow()
                    showToast(`Equipped ${spec?.name ?? 'item'} on ${HERO_SPECS[selHero.heroId].name}.`)
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
              row({ id: 'arm-top-m1', style: { height: 34, gap: 6, align: 'center' } }, [armHeroStrip, armBestBtn]),
              armFilterStrip
            ]
          : [
              row({ id: 'arm-top-controls', style: { height: 34, gap: 8, align: 'center' } }, [armHeroStrip, armFilterStrip, armBestBtn])
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
      const hasReveal = camp.lastPackReveal.length > 0
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
                  `Tactic Deck: ${camp.tactics.length} cards  -  Packs Opened: ${camp.packsOpened}  -  Merge 3 duplicate heroes to ascend`,
                  { size: 11, color: COLOR.muted, align: 'center' }
                )
              }
            })
          ]

      bodyNode = column({ id: 'camp-decks-body', style: { grow: 1, gap: 10 } }, [
        row({ id: 'dk-packs', style: { height: packH, gap: 10 } }, packCards),
        ...revealSection
      ])
    }

    const battleLabel = pendingEndless > 0
      ? `Endless Wave ${pendingEndless}`
      : nextCh.title.replace('Chapter ', 'Ch ')
    const battleShort = pendingEndless > 0
      ? `Wave ${pendingEndless}`
      : nextCh.title.split(':')[0]?.replace('Chapter ', 'Ch ') ?? 'Battle'
    const chapterSub = pendingEndless > 0 ? 'Arena' : nextCh.subtitle

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
        // Chapter selector pill + March to Battle CTA
        row({
          id: 'cp-chapter-bar',
          style: { width: mobile ? 196 : 332, height: shortH ? 36 : 42, padding: [3, 5], gap: 4, align: 'center' },
          widget: {
            type: 'panel',
            blocksPointer: true,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawPanel(ctx, rect, { r: RADIUS.lg })
          }
        }, [
          boxNode({
            id: 'cp-ch-prev', style: { width: 30, height: 34 },
            widget: {
              type: 'button', label: 'Previous Chapter',
              disabled: pendingChapter <= 0 && pendingEndless === 0,
              onPress: () => {
                if (pendingEndless > 0) pendingEndless = 0
                else if (pendingChapter > 0) pendingChapter--
                uiDirty = true
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'chevron-left', st)
            }
          }),
          ...(mobile ? [] : [boxNode({
            id: 'cp-ch-label', style: { grow: 1, height: 34 },
            widget: {
              type: 'panel',
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawChapterPicker(ctx, rect, battleLabel, chapterSub)
            }
          })]),
          boxNode({
            id: 'cp-ch-next', style: { width: 30, height: 34 },
            widget: {
              type: 'button', label: 'Next Chapter',
              disabled: !allCleared && pendingChapter >= camp.chaptersCleared,
              onPress: () => {
                if (pendingChapter < Math.min(camp.chaptersCleared, CHAPTERS.length - 1)) {
                  pendingChapter++
                } else if (allCleared) {
                  pendingEndless = Math.max(1, pendingEndless + 1)
                }
                uiDirty = true
              },
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawIconButton(ctx, rect, 'chevron-right', st)
            }
          }),
          boxNode({
            id: 'cs-camp-battle', style: { width: mobile ? 106 : 114, height: 34 },
            widget: {
              type: 'button',
              label: mobile ? battleShort : 'Battle',
              primary: true,
              primitive: campBattleBtn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, mobile ? battleShort : 'Battle', st, { variant: 'primary', icon: 'sword', size: 13 }
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
                onPress: () => { campTab = 'squad'; mobileCampCollapsed = false; uiDirty = true },
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
                onPress: () => { campTab = 'armory'; mobileCampCollapsed = false; uiDirty = true },
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
                onPress: () => { campTab = 'decks'; mobileCampCollapsed = false; uiDirty = true },
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
      ])
    ])
  }

  // =========================================================================
  // VICTORY & DEFEAT MODALS
  // =========================================================================

  function buildResultTree(w: number, h: number, won: boolean): LayoutNode {
    const shortH = h < 480
    const battle = state.battle
    const reward = battle?.reward
    const ch = CHAPTERS[battle?.chapterIndex ?? 0]
    const eqSpec = reward ? EQUIPMENT_BY_ID[reward.equipCard.equipId] : undefined
    const heroSpec = reward ? HERO_SPECS[reward.heroCard.heroId] : undefined
    const copies = reward
      ? state.campaign.heroes.filter(h => h.heroId === reward.heroCard.heroId && h.stars === 1).length
      : 0

    const title = won ? (reward?.campaignWon ? 'Sunstone Crown Reforged' : 'Victory') : 'Vanguard Defeated'
    const sub = won ? ch.title : 'Regroup and Adapt'
    const quote = won
      ? `${ch.outroSpeaker}: "${ch.outroText}"`
      : 'Return to Vanguard Camp to equip stronger gear, open booster decks, or merge 3 identical heroes to unlock Tier 2 skills.'

    const rowH = shortH ? 40 : 50
    const rewardRows: LayoutNode[] = []
    if (won && reward) {
      rewardRows.push(
        boxNode({
          id: 'res-gold', style: { height: rowH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRow(ctx, rect, {
              icon: 'coin',
              title: `+${reward.gold} Gold`,
              detail: `Treasury total: ${state.campaign.gold}g`,
              color: COLOR.accentHi
            })
          }
        }),
        boxNode({
          id: 'res-eq', style: { height: rowH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRow(ctx, rect, {
              icon: 'bag',
              title: eqSpec?.name ?? 'Equipment',
              detail: eqSpec?.desc ?? '',
              color: eqSpec ? RARITY_META[eqSpec.rarity].hex : COLOR.text,
              badge: eqSpec ? RARITY_META[eqSpec.rarity].label : undefined
            })
          }
        }),
        boxNode({
          id: 'res-hero', style: { height: rowH },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRow(ctx, rect, {
              portrait: portraits[reward.heroCard.heroId],
              title: `${heroSpec?.name ?? 'Hero'} (${heroSpec?.title ?? ''})`,
              detail: `Copies: ${copies}/3`,
              color: '#9ff0c4',
              badge: copies >= 3 ? 'READY TO MERGE' : undefined
            })
          }
        })
      )
      if (reward.unlockedSlot4) {
        rewardRows.push(boxNode({
          id: 'res-slot4', style: { height: shortH ? 36 : 46 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawRewardRow(ctx, rect, {
              icon: 'users',
              title: '4th Squad Slot Unlocked',
              detail: 'Deploy four heroes together from Vanguard Camp.',
              color: COLOR.ap
            })
          }
        }))
      }
    }

    const btnH = shortH ? 38 : 46
    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({ id: 'res-scrim', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'res-modal',
        style: { anchor: 'center', width: Math.min(w - 24, 496), padding: shortH ? 14 : 24, gap: shortH ? 7 : 12 },
        widget: {
          type: 'panel',
          blocksPointer: true,
          draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawModal(ctx, rect, won ? COLOR.accent : COLOR.enemy)
        }
      }, [
        boxNode({
          id: 'res-title', style: { height: shortH ? 46 : 60 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawResultHeadline(ctx, rect, title, sub, won)
          }
        }),
        ...(shortH && won ? [] : [boxNode({
          id: 'res-story', style: { height: shortH ? 40 : 52 },
          widget: {
            type: 'panel',
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect) => drawLabel(
              ctx, rect, quote, { size: 12.5, weight: 500, color: COLOR.muted, align: 'center', wrap: true, lineHeight: 17 }
            )
          }
        })]),
        ...rewardRows,
        row({ id: 'res-btns', style: { height: btnH, gap: 10 } }, won ? [
          boxNode({
            id: 'cs-victory-camp', style: { grow: 1, height: btnH },
            widget: {
              type: 'button', label: 'Vanguard Camp', primitive: victoryCampBtn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Vanguard Camp', st, { variant: 'secondary', icon: 'camp', size: 13 }
              )
            }
          }),
          boxNode({
            id: 'cs-victory-next', style: { grow: 1.2, height: btnH },
            widget: {
              type: 'button',
              label: state.campaign.chaptersCleared >= CHAPTERS.length ? 'Endless Arena' : 'Next Chapter',
              primary: true,
              primitive: victoryNextBtn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx,
                rect,
                state.campaign.chaptersCleared >= CHAPTERS.length ? 'Endless Arena' : 'Next Chapter',
                st,
                { variant: 'primary', icon: 'arrow-right', size: 14 }
              )
            }
          })
        ] : [
          boxNode({
            id: 'cs-victory-camp', style: { grow: 1, height: btnH },
            widget: {
              type: 'button', label: 'Vanguard Camp', primitive: victoryCampBtn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Vanguard Camp', st, { variant: 'secondary', icon: 'camp', size: 13 }
              )
            }
          }),
          boxNode({
            id: 'cs-defeat-retry', style: { grow: 1.2, height: btnH },
            widget: {
              type: 'button', label: 'Retry Battle', primary: true, primitive: defeatRetryBtn,
              draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
                ctx, rect, 'Retry Battle', st, { variant: 'primary', icon: 'play', size: 14 }
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
            type: 'button', label: 'Resume Battle', primary: true, primitive: resumeBtn,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawButton(
              ctx, rect, 'Resume Battle', st, { variant: 'primary', icon: 'play', size: 14 }
            )
          }
        }),
        boxNode({
          id: 'cs-perf', style: { height: rowH },
          widget: {
            type: 'button', label: 'FPS Overlay', primitive: perfBtn,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSettingRow(
              ctx, rect, 'Performance Overlay', 'gauge', showPerfPanel, st
            )
          }
        }),
        boxNode({
          id: 'cs-music', style: { height: rowH },
          widget: {
            type: 'button', label: 'Music', primitive: musicBtn,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSettingRow(
              ctx, rect, 'Background Music', 'music', audio.isMusicEnabled(), st
            )
          }
        }),
        boxNode({
          id: 'cs-mute', style: { height: rowH },
          widget: {
            type: 'button', label: 'Audio', primitive: muteBtn,
            draw: (ctx: CanvasRenderingContext2D, rect: LayoutRect, st: CanvasWidgetDrawState) => drawSettingRow(
              ctx, rect, 'Master Audio', audio.isMuted() ? 'mute' : 'volume', !audio.isMuted(), st
            )
          }
        }),
        boxNode({
          id: 'cs-retreat', style: { height: rowH },
          widget: {
            type: 'button', label: 'Retreat to Camp', primitive: retreatBtn,
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
      const cell = battle.cells[hovered.row][hovered.col]
      const desc = TERRAIN_LABEL[cell.terrain] ?? cell.terrain
      const text = `${desc} (${hovered.col + 1},${hovered.row + 1})`
      const pw = Math.min(256, Math.max(136, text.length * 7 + 24))
      const py = g.height < 480 ? 48 : 58
      g.panel(10, py, pw, 28, { fill: '#253357', stroke: COLOR.borderHi, radius: 10 })
      g.text(text, 22, py + 8, { fill: '#ffffff', size: 11.5, weight: 800 })
    }

    if (battle.bannerTimer > 0 && battle.bannerText) {
      const bw = Math.min(g.width - 32, Math.max(248, battle.bannerText.length * 10 + 48))
      const by = g.width < 660 ? 114 : g.height < 480 ? 64 : 92
      g.panel(Math.round((g.width - bw) / 2), by, bw, 38, { fill: '#283863', stroke: COLOR.accent, radius: 14 })
      g.text(battle.bannerText, g.width / 2, by + 13, { fill: '#090d1a', size: 15, weight: 900, align: 'center' })
      g.text(battle.bannerText, g.width / 2, by + 11.5, { fill: COLOR.accentHi, size: 15, weight: 900, align: 'center' })
    }
  }

  let prevW = 0
  let prevH = 0
  let lastBattlePhase: string | null = null
  let lastActiveUid: string | null = null

  function renderUiNow() {
    const canvas = renderer.canvas
    const w = Math.max(1, canvas.clientWidth)
    const h = Math.max(1, canvas.clientHeight)
    prevW = w
    prevH = h
    ui.render(buildUiTree(w, h), { width: w, height: h })
    uiDirty = false
  }

  const globalUi = {
    snapshot: () => ui.snapshot(),
    query: (filter?: { id?: string; kind?: string; state?: string; label?: string }) => ui.query(filter),
    act: (id: string, action = 'press', payload?: unknown) => {
      if (uiDirty) renderUiNow()
      const resolvedId = ACT_ID_ALIASES[id] ?? id
      const ok = ui.act(resolvedId, action, payload) || (resolvedId !== id && ui.act(id, action, payload))
      if (ok) {
        uiDirty = true
        hudRev++
        renderUiNow()
      }
      return ok
    },
    rects: () => Object.fromEntries(ui.rects),
    perf: () => perf.snapshot(),
    perfLog: () => perfLogger.getHistory(),
    state: () => ({
      screen,
      campTab,
      backend: renderer.name,
      showPerfPanel,
      fps: Math.round(perf.snapshot().fps),
      gold: state.campaign.gold,
      chaptersCleared: state.campaign.chaptersCleared,
      heroesCount: state.campaign.heroes.length,
      equipmentCount: state.campaign.equipment.length,
      tacticsCount: state.campaign.tactics.length,
      deckValue: computeDeckValue(state.campaign),
      battlePhase: state.battle?.phase ?? null,
      battleTurn: state.battle?.turn ?? 0,
      battleAp: state.battle?.ap ?? 0,
      activeUnitUid: state.battle?.activeUnitUid ?? null,
      turnOrder: state.battle?.turnOrder.map(t => t.name) ?? [],
      battleAlliesAlive: state.battle ? state.battle.units.filter(u => u.alive && u.team === 'ally').length : 0,
      battleEnemiesAlive: state.battle ? state.battle.units.filter(u => u.alive && u.team === 'enemy').length : 0,
      moveAttackTargets: state.battle ? state.battle.moveAttackTiles.map(t => ({ col: t.col, row: t.row, fromCol: t.fromCol, fromRow: t.fromRow })) : [],
      mobileHandOpen,
      campCollapsed: mobileCampCollapsed,
      cameraZoom: Math.round(scene.getCameraZoom() * 1000) / 1000
    }),
    zoom: (z: number) => {
      scene.setCameraZoom(z)
      uiDirty = true
      hudRev++
      renderUiNow()
      return scene.getCameraZoom()
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
      if (res) { saveNow(); uiDirty = true; renderUiNow() }
      return Boolean(res)
    }
  }
  Object.defineProperty(globalThis, '__ridgetopUi', { value: globalUi, configurable: true, writable: true })
  Object.defineProperty(globalThis, '__CROWNSHARD__', { value: globalUi, configurable: true, writable: true })

  let lastRenderAt: number | undefined
  let perfUiTick = 0

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
      const animatingHud = Boolean(
        b && (b.floatingNumbers.length > 0 || b.bannerTimer > 0 || b.shake > 0 || b.units.some(u => u.path.length > 0))
      )
      const hudKey = screen === 'battle'
        ? `b:${hudRev}:${animatingHud ? Math.floor(now / 33) : 0}:${scene.getHoveredCell()?.col ?? -1},${scene.getHoveredCell()?.row ?? -1}`
        : `s:${screen}`

      const h0 = performance.now()
      hud.render(canvas, hudKey, paintHud)
      const hudMs = performance.now() - h0

      const uiPerfBucket = Math.floor(now / 1000)
      if ((screen === 'battle' || showPerfPanel) && uiPerfBucket !== perfUiTick) {
        perfUiTick = uiPerfBucket
        uiDirty = true
      }

      const u0 = performance.now()
      if (uiDirty || ui.dirty || w !== prevW || h !== prevH) {
        renderUiNow()
      }
      const uiMs = performance.now() - u0

      const dpr = Math.round((canvas.width / Math.max(1, canvas.clientWidth)) * 100) / 100
      perf.record({
        now,
        simMs: lastSimMs,
        renderMs,
        hudMs,
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

  page.lifecycle({
    hide(persisted) {
      saveNow()
      audio.suspend()
      if (persisted) return
      stop()
      perfLogger.dispose()
      inputAbort.abort()
      ui.dispose()
      scene.dispose()
      renderer.dispose()
      audio.close()
    },
    restore() {
      audio.resume()
    }
  })
}

start().catch(err => {
  console.error('Failed to launch Crownshard', err)
})
