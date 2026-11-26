import type { CourseId } from './game/level.ts'
import type { CharacterView } from './game/expedition.ts'
import type { Player, PlayerSnapshot } from './game/simulation.ts'
import type { Backend } from 'ridgetop'
import {
  bindPlatformControls, connectRoom, createGamePage, createHud, createLowPolyRenderer, fixedLoop, STEP
} from 'ridgetop'
import { boxNode, column, createCanvasUi, createUiTheme, overlay, row, spacerNode } from 'ridgetop/ui'
import type { CanvasUiQuery } from 'ridgetop/ui'
import { courses } from './game/level.ts'
import { canEnterRegion, expeditionLoot, GUILD_WORLD } from './game/expedition.ts'
import { createPlayer, restartPlayer, stepPlayer } from './game/simulation.ts'
import { createCourseScene } from './game/scene.ts'
import { createSprites } from './game/sprites.ts'
import { createAudio } from './game/audio.ts'
import { campaignSummary, loadCampaign, medal, recordRelay, ROUTE, saveCampaign } from './game/campaign.ts'

const page = createGamePage()
const { element: $, url, storage, reducedMotion } = page
const requestedCourse = url.searchParams.get('course')
const roomCode = url.searchParams.get('room')
const requestedBackend = url.searchParams.has('canvas') ? 'canvas' : url.searchParams.get('renderer')
const progress = loadCampaign(storage)
const audio = createAudio()
const isHosted = document.body.dataset.hosted === '1' && !page.platform.isNative

function time(ticks: number) {
  const centiseconds = Math.floor(ticks * STEP * 100)
  const remainder = String(centiseconds % 6000).padStart(4, '0')
  return Math.floor(cs(ticks) / 6000) + ':' + remainder.slice(0, 2) + '.' + remainder.slice(2)
}
function cs(ticks: number) { return Math.floor(ticks * STEP * 100) }
function unlockSound() { if (progress.sound) audio.unlock() }
audio.mute(!progress.sound)

function parseBackend(value: string | null): Backend | undefined {
  if (value === 'webgpu' || value === 'webgl2' || value === 'canvas') return value
  return undefined
}
function isCourseId(value: string): value is CourseId {
  return Object.hasOwn(courses, value)
}

async function start() {
  const backend = parseBackend(requestedBackend)
  const config = backend ? { backend } : {}
  const [renderer, sprites] = await Promise.all([
    createLowPolyRenderer($<HTMLCanvasElement>('stage'), config),
    createSprites($<HTMLCanvasElement>('sprites'), reducedMotion)
  ])
  const hud = createHud($<HTMLCanvasElement>('beacon-hud'))
  const uiCanvas = $<HTMLCanvasElement>('ui')
  const touch = matchMedia('(any-pointer: coarse)')
  touch.addEventListener('change', () => { uiDirty = true })
  const portrait = new Image()
  portrait.src = './game/assets/scout.png'
  let portraitReady = false
  portrait.onload = () => { portraitReady = true; uiDirty = true }

  let courseId: CourseId = requestedCourse && isCourseId(requestedCourse) ? requestedCourse : ROUTE[0]
  let code = /^[a-z0-9-]{1,32}$/.test(roomCode ?? '') ? roomCode : null
  const requestedMode = url.searchParams.get('mode')
  let mode = requestedMode === 'expedition' ? 'expedition' :
    code ? 'online' : requestedCourse || requestedMode === 'practice' ? 'practice' : 'campaign'
  if (mode === 'expedition') code ??= GUILD_WORLD
  let screen = code || mode === 'practice' ? 'play' : 'title'
  let scene: ReturnType<typeof createCourseScene>
  let room: ReturnType<typeof connectRoom<PlayerSnapshot>> | undefined
  let player: Player
  let latest: PlayerSnapshot | undefined
  let finishRun: string | undefined
  let character: CharacterView | undefined
  let connectionLabel = 'Loading'
  let connectionOnline = false
  let bestText = 'Best —'
  let toastMessage = ''
  let finishTimeText = ''
  let finishMedalText = ''
  let standingsLines: string[] = []
  let expeditionLoading = false
  let lastFinished = false
  let lastCharacterKey = ''
  let uiDirty = true

  // Multi-touch Canvas hold state merged cleanly with keyboard & gamepad controls.
  let touchLeft = false
  let touchRight = false
  let touchJump = 0

  const controls = bindPlatformControls({
    buttons: [],
    enabled: () => screen === 'play' && !latest?.finished,
    onPause: togglePause,
    onGesture: unlockSound
  })
  const clearInput = () => {
    controls.clear()
    touchLeft = touchRight = false
    ui.clearHolds()
  }
  const readInput = () => {
    const base = controls.read()
    return {
      left: base.left || touchLeft,
      right: base.right || touchRight,
      jump: base.jump + touchJump
    }
  }

  async function loadCharacter() {
    character = await page.requestJson<CharacterView>('/expeditions/character', { method: 'POST' }, 'Could not load your guild character.')
  }

  function nextRegion(): CourseId {
    const cleared = character?.cleared ?? []
    return ROUTE.find(id => !cleared.includes(id) && canEnterRegion(cleared, id)) ?? ROUTE[0]
  }

  if (mode === 'expedition') {
    try {
      await loadCharacter()
      if (character && !canEnterRegion(character.cleared, courseId)) {
        toastMessage = 'Restore the earlier relays to unlock ' + courses[courseId].name + '.'
        courseId = nextRegion()
      }
    } catch (error) {
      toastMessage = error.message
      mode = 'campaign'
      code = null
      screen = 'title'
    }
  }

  function shared() { return mode === 'online' || mode === 'expedition' }
  let knownFalls = 0, knownCrystals = 0, knownSignal = false, wasGrounded = false, knownRevision = -1

  function setSound(checked: boolean) {
    progress.sound = checked
    unlockSound()
    audio.mute(!checked)
    saveCampaign(storage, progress)
    uiDirty = true
  }

  function courseOptions() {
    const nextCourse = campaignSummary(progress).next
    const unlocked = nextCourse ? ROUTE.indexOf(nextCourse) : -1
    return ROUTE.map((id, i) => ({
      value: id,
      label: courses[id].name,
      disabled: mode === 'expedition'
        ? Boolean(character && !canEnterRegion(character.cleared, id))
        : mode === 'campaign' && unlocked >= 0 && i > unlocked
    }))
  }

  const ui = createCanvasUi(uiCanvas, {
    theme: createUiTheme({
      uiSurface: '#13242beb',
      uiSurfaceAlt: '#213c44f2',
      uiTop: '#3a626688',
      uiBorder: '#6e9a8799',
      accent: '#c0ed9d',
      accentText: '#14241e',
      light: '#f1f9ef',
      muted: '#b7cec4',
      scrim: '#09141bc8'
    }),
    safeArea: { top: 12, right: 12, bottom: 12, left: 12 },
    keyboardEnabled: () => screen !== 'play' || Boolean(latest?.finished),
    onBack: togglePause
  })

  function setScreen(value: string) {
    screen = value
    clearInput()
    uiDirty = true
  }

  function syncUrl() {
    if (mode !== 'campaign' && courseId !== ROUTE[0]) url.searchParams.set('course', courseId)
    else url.searchParams.delete('course')
    if (mode === 'expedition') url.searchParams.set('mode', 'expedition')
    else if (mode === 'practice' && screen !== 'title') url.searchParams.set('mode', 'practice')
    else url.searchParams.delete('mode')
    if (code && (mode !== 'expedition' || code !== GUILD_WORLD)) url.searchParams.set('room', code)
    else url.searchParams.delete('room')
    page.replaceUrl(url)
  }

  function recordTime(ticks?: number) {
    const key = 'ridgetop.best.' + courseId
    let best: number | undefined
    try {
      const saved = Number(storage?.getItem(key))
      if (Number.isSafeInteger(saved) && saved > 0) best = saved
      if (ticks && (!best || ticks < best)) storage?.setItem(key, String(ticks))
    } catch { /* Ignore unavailable storage when recording best time. */ }
    const candidate = Math.min(ticks ?? Infinity, best ?? Infinity, progress.levels[courseId]?.ticks ?? Infinity)
    bestText = 'Best ' + (candidate === Infinity ? '—' : time(candidate))
  }

  function join() {
    room?.close()
    room = undefined
    if (!code) {
      connectionLabel = mode === 'campaign' ? 'Campaign' : 'Solo practice'
      connectionOnline = false
      uiDirty = true
      return
    }
    connectionLabel = 'Joining room…'
    connectionOnline = false
    uiDirty = true
    room = connectRoom<PlayerSnapshot>({
      endpoint: (mode === 'expedition' ? '/expeditions/' : '/rooms/') + courseId + '/' + code,
      readInput,
      onStatus(status) {
        const labels = {
          connected: mode === 'expedition' ? 'Expedition online' : 'Room online',
          reconnecting: 'Reconnecting…',
          unavailable: 'Room unavailable'
        }
        connectionLabel = labels[status]
        connectionOnline = status === 'connected'
        if (status === 'unavailable') {
          toastMessage = mode === 'expedition'
            ? 'This expedition instance is unavailable. Return to the main menu to rejoin.'
            : 'This room is unavailable. Select Solo practice to keep playing.'
        }
        uiDirty = true
      }
    })
  }

  function setupCourse(preserveToast = false) {
    scene?.dispose()
    scene = createCourseScene(renderer, courses[courseId], reducedMotion, sprites)
    player = createPlayer('solo', 0, courses[courseId])
    player.jump = readInput().jump
    latest = undefined
    lastFinished = false
    finishRun = undefined
    knownRevision = -1
    standingsLines = []
    if (!preserveToast) toastMessage = ''
    syncUrl()
    join()
    recordTime()
    uiDirty = true
  }

  function enter(nextMode: string, nextCourse: CourseId = courseId) {
    mode = nextMode
    courseId = nextCourse
    if (mode === 'expedition') code ??= GUILD_WORLD
    else if (mode !== 'online') code = null
    setScreen('play')
    setupCourse()
    $('stage').focus()
  }

  function showTitle() {
    code = null
    mode = 'campaign'
    courseId = ROUTE[0]
    setScreen('title')
    setupCourse()
  }

  function showEnding() {
    if (!campaignSummary(progress).complete) return
    setScreen('ending')
    audio.play('ending')
  }

  function togglePause() {
    if (screen === 'play') {
      if (latest?.finished) return
      setScreen('pause')
    } else if (screen === 'pause' || screen === 'journal') {
      setScreen('play')
      $('stage').focus()
    }
  }

  async function joinExpedition() {
    if (expeditionLoading) return
    expeditionLoading = true
    uiDirty = true
    unlockSound()
    try {
      await loadCharacter()
      if (screen === 'title') enter('expedition', nextRegion())
    } catch (error) {
      if (screen === 'title') toastMessage = error.message
    } finally {
      expeditionLoading = false
      uiDirty = true
    }
  }

  async function copyInvite() {
    unlockSound()
    if (!code) {
      code = page.roomCode()
      enter('online')
    }
    const share = new URL(url)
    share.searchParams.delete('canvas')
    share.searchParams.delete('renderer')
    try {
      await page.copy(share.href)
      toastMessage = 'Room link copied.'
    } catch {
      toastMessage = share.href
    }
    uiDirty = true
  }

  function restartRun() {
    setScreen('play')
    if (room) room.restart()
    else player = restartPlayer(player, readInput(), courses[courseId])
    $('stage').focus()
  }

  function advanceNext() {
    const after = ROUTE[ROUTE.indexOf(courseId) + 1]
    if (mode === 'expedition') {
      if (after && character && canEnterRegion(character.cleared, after)) enter(mode, after)
      else showTitle()
    } else if (mode === 'campaign' && !after && campaignSummary(progress).complete) showEnding()
    else enter(mode, after ?? ROUTE[0])
  }

  setupCourse(true)

  function paintRun(local: PlayerSnapshot | undefined) {
    const course = courses[courseId]
    const crystalBits = local?.crystals ?? 0
    const collected = course.crystals.filter((_, i) => crystalBits & (1 << i)).length
    const falls = (local?.falls ?? 0) + ((local?.falls ?? 0) === 1 ? ' fall' : ' falls')
    const elapsed = time(local?.ticks ?? 0)
    const chip = local?.signal ? '◆ Chip found' : '◇ Signal chip'
    const status = mode === 'expedition' ? connectionLabel : elapsed + '  ·  ' + falls
    const best = mode === 'expedition' ? '' : bestText
    const checkpoint = local?.checkpoint ? 'Checkpoint saved' : ''
    const chapter = 'Relay ' + (ROUTE.indexOf(courseId) + 1) + ' of ' + ROUTE.length
    const key = local?.finished ? 'overlay' : [courseId, mode, collected, chip, status, best, checkpoint].join('|')
    hud.render(renderer.canvas, key, painter => {
      if (local?.finished) return
      const inset = Math.max(10, Math.min(24, painter.width * .02))
      const width = Math.min(230, Math.max(150, painter.width * .46))
      const x = inset + 12
      const label = { size: 11, fill: '#b8d8c7', mono: true, maxWidth: width - 24 }
      painter.panel(inset, inset, width, 108 + (best ? 16 : 0) + (checkpoint ? 16 : 0), {
        fill: '#11242beb', stroke: '#a5e3bf66', radius: 8
      })
      painter.text(chapter.toUpperCase(), x, inset + 10, { ...label, fill: '#a9efb4' })
      painter.text(course.name, x, inset + 26, { fill: '#f1f9ef', size: 22, weight: 800, maxWidth: width - 24 })
      for (let i = 0; i < course.crystals.length; i++) {
        const found = Boolean(crystalBits & (1 << i))
        painter.text(found ? '◆' : '◇', x + i * 19, inset + 53, { size: 16, fill: found ? '#a6ffee' : '#9bb9b0' })
      }
      painter.text(chip, x, inset + 73, { ...label, fill: local?.signal ? '#f8d782' : label.fill })
      painter.text(status, x, inset + 90, label)
      if (best) painter.text(best, x, inset + 106, label)
      if (checkpoint) painter.text(checkpoint, x, inset + (best ? 122 : 106), { ...label, fill: '#a9efb4' })
    })
    if (!local) return

    if (local.revision === knownRevision) {
      if (local.falls > knownFalls) { audio.play('hit'); page.platform.haptic('medium') }
      else if (local.signal && !knownSignal) { audio.play('signal'); page.platform.haptic('light') }
      else if (local.crystals !== knownCrystals) { audio.play('crystal'); page.platform.haptic('light') }
      else if (wasGrounded && !local.grounded && local.vy < -250) audio.play('jump')
    }
    knownRevision = local.revision
    knownFalls = local.falls
    knownCrystals = local.crystals
    knownSignal = local.signal
    wasGrounded = local.grounded
    if (!local.finished || finishRun === local.id + '/' + local.revision) return

    finishRun = local.id + '/' + local.revision
    audio.play('finish')
    page.platform.haptic('medium')
    const medalText = ['', 'Bronze', 'Silver', 'Gold'][medal(courses[courseId], local)]
    finishTimeText = mode === 'expedition'
      ? courses[courseId].name + ' · ' + expeditionLoot[courseId]
      : courses[courseId].name + ' · ' + time(local.ticks)
    finishMedalText = medalText + (local.signal ? ' · Signal chip recovered' : '')
    if (mode === 'campaign') {
      recordRelay(progress, courseId, local)
      saveCampaign(storage, progress)
      if (campaignSummary(progress).complete) void page.platform.steam.unlockAchievement('BEACON_CAMPAIGN_COMPLETE')
    }
    recordTime(local.ticks)
    uiDirty = true
  }

  function updateStandings(players: readonly PlayerSnapshot[], local: PlayerSnapshot | undefined) {
    const lines = [...players].sort((a, b) =>
      mode === 'expedition' ? a.slot - b.slot : Number(b.finished) - Number(a.finished) ||
        (a.finished && b.finished ? a.ticks - b.ticks : a.slot - b.slot))
      .map(item => (item.character ? item.character.name + ' · Lv ' + item.character.level +
        (item.id === local?.id ? ' (you)' : '') : item.id === local?.id ? 'You' : 'Scout ' + (item.slot + 1)) +
        ' · ' + (mode === 'expedition' ? (item.finished ? 'At the relay' : 'Exploring') :
          item.finished ? time(item.ticks) : 'On course'))
    if (lines.join('|') !== standingsLines.join('|')) {
      standingsLines = lines
      if (screen === 'journal') uiDirty = true
    }
  }

  function buildUiTree(w: number) {
    const summary = campaignSummary(progress)
    const compact = w < 560
    const playing = screen === 'play'
    const finished = playing && Boolean(latest?.finished)
    const showControls = playing && !finished
    const showTouch = showControls && touch.matches
    const campaignLabel = summary.complete ? 'Replay campaign' : summary.cleared ? 'Continue campaign' : 'Start campaign'
    const campaignProgress = `${summary.cleared} / ${ROUTE.length} relays online`
    const endingStats = `${summary.signals} / ${ROUTE.length} signal chips · ${summary.gold} / ${ROUTE.length} gold · best combined ${time(summary.ticks)}`
    const nextLabel = courseId === ROUTE.at(-1)
      ? (mode === 'campaign' ? 'View ending' : mode === 'expedition' ? 'Main menu' : 'Next course')
      : mode === 'expedition' ? 'Next zone' : 'Next course'
    const guildClear = Boolean(character?.guild.includes(courseId))
    const zoneClear = Boolean(character?.cleared.includes(courseId))

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      // Top-right play actions
      row({ id: 'play-actions', hidden: !showControls, style: { anchor: 'top-right', inset: 14, gap: 8, respectSafeArea: true } }, [
        boxNode({ id: 'journal-open', hidden: !shared(), style: { width: 88, height: 40 }, widget: { type: 'button', label: 'Journal', onPress: () => setScreen('journal') } }),
        boxNode({ id: 'pause', style: { width: 78, height: 40 }, widget: { type: 'button', label: 'Menu', onPress: togglePause } })
      ]),

      // Multi-touch platformer deck (only on coarse-pointer touch screens)
      row({ id: 'touch-left-group', hidden: !showTouch, style: { anchor: 'bottom-left', inset: 14, gap: 8, respectSafeArea: true } }, [
        boxNode({
          id: 'touch-left',
          style: { width: 58, height: 54 },
          widget: { type: 'button', label: '←', onHold: (active: boolean) => { touchLeft = active; if (active) unlockSound() } }
        }),
        boxNode({
          id: 'touch-right',
          style: { width: 58, height: 54 },
          widget: { type: 'button', label: '→', onHold: (active: boolean) => { touchRight = active; if (active) unlockSound() } }
        })
      ]),
      boxNode({
        id: 'touch-jump',
        hidden: !showTouch,
        style: { anchor: 'bottom-right', width: 92, height: 54, inset: 14, respectSafeArea: true },
        widget: { type: 'button', label: 'Jump', primary: true, onHold: (active: boolean) => { if (active) { unlockSound(); touchJump++ } } }
      }),

      // Title screen
      boxNode({ id: 'title-scrim', hidden: screen !== 'title', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true, fill: '#0b161fcc' } }),
      column({
        id: 'title-card',
        hidden: screen !== 'title',
        style: { anchor: compact ? 'center' : 'top-left', width: Math.min(w - 32, 430), inset: compact ? 16 : 48, padding: 24, gap: 12, respectSafeArea: true },
        widget: { type: 'panel' }
      }, [
        row({ id: 'hero-mark', style: { height: 44, gap: 10, align: 'center' } }, [
          ...(portraitReady ? [boxNode({ id: 'hero-portrait', style: { width: 38, height: 44 }, widget: { type: 'icon', image: portrait, pixelated: true } })] : []),
          boxNode({ id: 'hero-kicker', style: { grow: 1, height: 22 }, widget: { type: 'text', text: "WAYFARERS' GUILD", size: 12, weight: 800, color: ui.theme.accent, mono: true } })
        ]),
        boxNode({ id: 'hero-title', style: { height: 50 }, widget: { type: 'text', text: 'BEACON RUN', size: compact ? 36 : 44, weight: 900 } }),
        boxNode({ id: 'hero-desc', style: { height: 42 }, widget: { type: 'text', text: 'Join the Wayfarers’ Guild and bring six island beacons back online.', size: 14, color: ui.theme.muted, wrap: true } }),
        boxNode({ id: 'campaign-progress', style: { height: 20 }, widget: { type: 'text', text: campaignProgress.toUpperCase(), size: 12, weight: 700, color: ui.theme.accent, mono: true } }),
        boxNode({ id: 'expedition', style: { height: 44 }, widget: { type: 'button', label: expeditionLoading ? 'Joining…' : 'Join expedition', primary: true, disabled: expeditionLoading, onPress: () => { void joinExpedition() } } }),
        row({ id: 'title-row-2', style: { gap: 8 } }, [
          boxNode({ id: 'campaign', style: { grow: 1, height: 42 }, widget: { type: 'button', label: campaignLabel, onPress: () => { unlockSound(); enter('campaign', campaignSummary(progress).next ?? ROUTE[0]) } } }),
          boxNode({ id: 'practice', style: { width: 112, height: 42 }, widget: { type: 'button', label: 'Practice', onPress: () => { unlockSound(); enter('practice', ROUTE[0]) } } })
        ]),
        boxNode({ id: 'view-ending', hidden: !summary.complete, style: { height: 40 }, widget: { type: 'button', label: 'View ending', onPress: () => { unlockSound(); showEnding() } } }),
        row({ id: 'title-footer', style: { gap: 8 } }, [
          boxNode({ id: 'sound', style: { grow: 1, height: 38 }, widget: { type: 'toggle', label: 'Sound', checked: progress.sound, onToggle: setSound } }),
          boxNode({ id: 'play-racing', hidden: !isHosted, style: { grow: 1, height: 38 }, widget: { type: 'button', label: 'Play Signal Drift', onPress: () => { location.href = '/racing' } } }),
          boxNode({ id: 'quit', hidden: !page.platform.canQuit, style: { width: 88, height: 38 }, widget: { type: 'button', label: 'Quit', onPress: () => { void page.platform.quit() } } })
        ])
      ]),

      // Pause / Room menu
      boxNode({ id: 'pause-scrim', hidden: screen !== 'pause', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'pause-card',
        hidden: screen !== 'pause',
        style: { anchor: 'center', width: Math.min(w - 32, 420), padding: 22, gap: 10 },
        widget: { type: 'panel' }
      }, [
        boxNode({ id: 'menu-status', style: { height: 18 }, widget: { type: 'text', text: (mode === 'expedition' ? 'Expedition menu' : shared() ? 'Room menu' : 'Paused').toUpperCase(), size: 11, weight: 800, color: ui.theme.accent, mono: true } }),
        boxNode({ id: 'course-heading', style: { height: 34 }, widget: { type: 'text', text: courses[courseId].name, size: 26, weight: 800 } }),
        boxNode({ id: 'briefing', style: { height: 38 }, widget: { type: 'text', text: courses[courseId].description, size: 13, color: ui.theme.muted, wrap: true } }),
        boxNode({
          id: 'course',
          style: { height: 42 },
          widget: {
            type: 'select',
            label: 'Course',
            value: courseId,
            valueLabel: courses[courseId].name,
            options: courseOptions(),
            onSelect: (value: string) => { if (value !== courseId && isCourseId(value)) enter(mode, value) }
          }
        }),
        row({ id: 'pause-row-1', style: { gap: 8 } }, [
          boxNode({ id: 'resume', style: { grow: 1, height: 42 }, widget: { type: 'button', label: 'Resume', primary: true, onPress: togglePause } }),
          boxNode({ id: 'reset', style: { grow: 1, height: 42 }, widget: { type: 'button', label: 'Restart', onPress: restartRun } })
        ]),
        row({ id: 'pause-row-2', style: { gap: 8 } }, [
          boxNode({ id: 'invite', style: { grow: 1, height: 40 }, widget: { type: 'button', label: code ? 'Copy room link' : 'Invite players', onPress: () => { void copyInvite() } } }),
          boxNode({ id: 'pause-sound', style: { grow: 1, height: 40 }, widget: { type: 'toggle', label: 'Sound', checked: progress.sound, onToggle: setSound } })
        ]),
        row({ id: 'pause-row-3', style: { gap: 8 } }, [
          boxNode({ id: 'mode', hidden: !shared(), style: { grow: 1, height: 40 }, widget: { type: 'button', label: mode === 'expedition' ? 'Main menu' : 'Solo practice', onPress: () => { if (mode === 'expedition') showTitle(); else enter('practice') } } }),
          boxNode({ id: 'pause-menu', hidden: mode === 'expedition', style: { grow: 1, height: 40 }, widget: { type: 'button', label: 'Main menu', onPress: showTitle } })
        ]),
        boxNode({ id: 'pause-guide', style: { height: 18 }, widget: { type: 'text', text: 'Move: A/D or Stick · Jump: Space or A · Menu: Esc or Start', size: 11, color: ui.theme.muted, mono: true, align: 'center' } })
      ]),

      // Journal & Room Standings
      boxNode({ id: 'journal-scrim', hidden: screen !== 'journal', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'journal-card',
        hidden: screen !== 'journal',
        style: { anchor: 'center', width: Math.min(w - 32, 460), padding: 22, gap: 10 },
        widget: { type: 'panel' }
      }, [
        row({ id: 'journal-head', style: { height: 38, align: 'center' } }, [
          boxNode({ id: 'journal-title', style: { grow: 1, height: 32 }, widget: { type: 'text', text: mode === 'expedition' ? 'Journal' : 'Room standings', size: 24, weight: 800 } }),
          boxNode({ id: 'journal-close', style: { width: 82, height: 36 }, widget: { type: 'button', label: 'Close', onPress: togglePause } })
        ]),
        ...(mode === 'expedition' && character ? [
          row({ id: 'char-row', style: { height: 46, gap: 10, align: 'center' } }, [
            ...(portraitReady ? [boxNode({ id: 'char-icon', style: { width: 38, height: 44 }, widget: { type: 'icon', image: portrait, pixelated: true } })] : []),
            column({ id: 'char-info', style: { grow: 1, gap: 2 } }, [
              boxNode({ id: 'character-name', style: { height: 22 }, widget: { type: 'text', text: character.name, size: 16, weight: 800 } }),
              boxNode({ id: 'character-rank', style: { height: 18 }, widget: { type: 'text', text: `Level ${character.level} · ${character.xp} XP`, size: 12, color: ui.theme.accent, mono: true } })
            ])
          ]),
          boxNode({ id: 'zone-quest', style: { height: 34 }, widget: { type: 'text', text: zoneClear ? `Relay restored · ${expeditionLoot[courseId]} earned` : 'Gather five crystals and reach the relay for 100 XP and a relic.', size: 13, color: ui.theme.muted, wrap: true } }),
          boxNode({ id: 'guild-quest', style: { height: 34 }, widget: { type: 'text', text: guildClear ? 'Guild contract complete · +60 XP' : 'Guild contract · Reach the relay with another wayfarer.', size: 13, color: ui.theme.muted, wrap: true } }),
          boxNode({ id: 'relics', style: { height: 22 }, widget: { type: 'text', text: character.cleared.map(id => expeditionLoot[id]).join(' · ') || 'No relics yet', size: 12, color: ui.theme.accent, mono: true } })
        ] : []),
        boxNode({ id: 'roster-heading', style: { height: 20 }, widget: { type: 'text', text: (mode === 'expedition' ? 'Nearby wayfarers' : 'Room standings').toUpperCase(), size: 11, weight: 800, color: ui.theme.accent, mono: true } }),
        ...standingsLines.slice(0, 6).map((line, i) =>
          boxNode({ id: 'standing-' + i, style: { height: 22 }, widget: { type: 'text', text: `${i + 1}. ${line}`, size: 13, mono: true } })
        )
      ]),

      // Finish dialog
      boxNode({ id: 'finish-scrim', hidden: !finished, style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'finish-card',
        hidden: !finished,
        style: { anchor: 'center', width: Math.min(w - 32, 410), padding: 24, gap: 10 },
        widget: { type: 'panel' }
      }, [
        boxNode({ id: 'finish-kicker', style: { height: 18 }, widget: { type: 'text', text: 'RELAY RESTORED', size: 12, weight: 800, color: ui.theme.accent, mono: true, align: 'center' } }),
        boxNode({ id: 'finish-time', style: { height: 34 }, widget: { type: 'text', text: finishTimeText, size: 22, weight: 800, align: 'center' } }),
        boxNode({ id: 'finish-medal', style: { height: 24 }, widget: { type: 'text', text: mode === 'expedition' && character ? (guildClear ? 'Guild contract complete' : 'Stay at the relay for a second wayfarer to finish.') : finishMedalText, size: 14, color: ui.theme.muted, align: 'center' } }),
        spacerNode(0),
        row({ id: 'finish-actions', style: { gap: 8 } }, [
          boxNode({ id: 'again', style: { grow: 1, height: 42 }, widget: { type: 'button', label: 'Play again', onPress: restartRun } }),
          boxNode({ id: 'next', style: { grow: 1, height: 42 }, widget: { type: 'button', label: nextLabel, primary: true, onPress: advanceNext } })
        ])
      ]),

      // Campaign ending
      boxNode({ id: 'ending-scrim', hidden: screen !== 'ending', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'ending-card',
        hidden: screen !== 'ending',
        style: { anchor: 'center', width: Math.min(w - 32, 430), padding: 26, gap: 12, align: 'center' },
        widget: { type: 'panel' }
      }, [
        ...(portraitReady ? [boxNode({ id: 'ending-portrait', style: { width: 48, height: 60 }, widget: { type: 'icon', image: portrait, pixelated: true } })] : []),
        boxNode({ id: 'ending-title', style: { height: 36, width: Math.min(w - 84, 360) }, widget: { type: 'text', text: 'Signal restored', size: 28, weight: 900, align: 'center' } }),
        boxNode({ id: 'ending-desc', style: { height: 40, width: Math.min(w - 84, 360) }, widget: { type: 'text', text: 'All six relays are lit. The valley can see its way home.', size: 14, color: ui.theme.muted, align: 'center', wrap: true } }),
        boxNode({ id: 'ending-stats', style: { height: 22, width: Math.min(w - 84, 380) }, widget: { type: 'text', text: endingStats, size: 12, color: ui.theme.accent, mono: true, align: 'center' } }),
        boxNode({ id: 'ending-menu', style: { width: 180, height: 44 }, widget: { type: 'button', label: 'Main menu', primary: true, onPress: showTitle } })
      ]),

      // Toast notice
      row({ id: 'toast-box', hidden: !toastMessage, style: { anchor: 'bottom', width: Math.min(w - 24, 460), height: 40, inset: 20, padding: [0, 14], align: 'center', respectSafeArea: true }, widget: { type: 'panel' } }, [
        boxNode({ id: 'message', style: { grow: 1, height: 24 }, widget: { type: 'text', text: toastMessage, size: 13, align: 'center' } })
      ])
    ])
  }

  Object.defineProperty(globalThis, '__ridgetopUi', {
    configurable: true,
    writable: true,
    value: {
      snapshot: () => ui.snapshot(),
      query: (filter?: CanvasUiQuery) => ui.query(filter),
      act: (id: string, action: string, payload?: unknown) => {
        if (uiDirty) renderUiNow()
        const ok = ui.act(id, action, payload)
        renderUiNow()
        return ok
      },
      rects: () => Object.fromEntries(ui.rects),
      state: () => {
        const summary = campaignSummary(progress)
        return {
          screen,
          mode,
          courseId,
          courseName: courses[courseId].name,
          backend: renderer.name,
          connection: connectionLabel,
          online: connectionOnline,
          falls: (latest?.falls ?? 0) + ((latest?.falls ?? 0) === 1 ? ' fall' : ' falls'),
          finished: Boolean(latest?.finished),
          finishMedal: finishMedalText,
          campaignProgress: `${summary.cleared} / ${ROUTE.length} relays online`,
          endingStats: `${summary.signals} / ${ROUTE.length} signal chips · ${summary.gold} / ${ROUTE.length} gold · best combined ${time(summary.ticks)}`,
          sound: progress.sound ? 'Sound on' : 'Sound off',
          standings: [...standingsLines],
          character: character ? { ...character } : null,
          message: toastMessage,
          courseDisabled: Object.fromEntries(ROUTE.map(id => {
            const unlocked = summary.next ? ROUTE.indexOf(summary.next) : -1
            const disabled = mode === 'expedition'
              ? Boolean(character && !canEnterRegion(character.cleared, id))
              : mode === 'campaign' && unlocked >= 0 && ROUTE.indexOf(id) > unlocked
            return [id, disabled]
          }))
        }
      }
    }
  })

  const stopPlatformLifecycle = page.platform.onLifecycle({
    pause() { audio.suspend() },
    resume() { audio.resume() }
  })

  function renderUiNow() {
    const w = Math.max(1, uiCanvas.clientWidth), h = Math.max(1, uiCanvas.clientHeight)
    const ratio = Math.min(devicePixelRatio || 1, 2)
    lastW = w; lastH = h; lastRatio = ratio
    ui.render(buildUiTree(w), { width: w, height: h, pixelRatio: ratio })
    uiDirty = false
  }
  let lastW = 0, lastH = 0, lastRatio = 0
  renderUiNow()
  const stop = fixedLoop({
    update(dt) {
      if (screen === 'play' && !room) stepPlayer(player, readInput(), dt, courses[courseId])
    },
    render(_alpha, now) {
      const activeRoom = room
      activeRoom?.flush(now)
      const players = activeRoom ? activeRoom.sample(now) : [player]
      const local = activeRoom ? players.find(candidate => candidate.id === activeRoom.id) : player
      latest = local
      const nowFinished = Boolean(local?.finished)
      if (nowFinished !== lastFinished) {
        lastFinished = nowFinished
        uiDirty = true
      }
      scene.render(players, local, now)
      if (screen === 'play') paintRun(local)
      else hud.render(renderer.canvas, 'overlay', () => {})
      if (room) updateStandings(players, local)
      if (mode === 'expedition' && local && 'character' in local && local.character) {
        const nextChar = local.character
        const charKey = `${nextChar.name}|${nextChar.level}|${nextChar.xp}|${nextChar.cleared.join(',')}|${nextChar.guild.join(',')}`
        if (charKey !== lastCharacterKey) {
          lastCharacterKey = charKey
          character = nextChar
          uiDirty = true
        }
      }
      const w = Math.max(1, uiCanvas.clientWidth), h = Math.max(1, uiCanvas.clientHeight)
      const ratio = Math.min(devicePixelRatio || 1, 2)
      if (uiDirty || ui.dirty || w !== lastW || h !== lastH || ratio !== lastRatio) renderUiNow()
    }
  })

  page.lifecycle({
    hide(persisted) {
      room?.close()
      clearInput()
      if (!persisted) {
        stop()
        stopPlatformLifecycle()
        ui.dispose()
        controls.dispose()
        scene.dispose()
        renderer.dispose()
        audio.close()
      }
    },
    restore: join
  })
}

start().catch(error => console.error(error))
