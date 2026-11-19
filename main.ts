import type { CharacterView } from './game/expedition.ts'
import type { Player, PlayerSnapshot } from './game/simulation.ts'
import type { Backend } from './framework/index.ts'
import {
  bindPlatformControls, connectRoom, createGamePage, createHud, createLowPolyRenderer, fixedLoop, STEP
} from './framework/index.ts'
import { courses } from './game/level.ts'
import { canEnterRegion, expeditionLoot, GUILD_WORLD } from './game/expedition.ts'
import { createPlayer, restartPlayer, stepPlayer } from './game/simulation.ts'
import { createCourseScene } from './game/scene.ts'
import { createSprites } from './game/sprites.ts'
import { createAudio } from './game/audio.ts'
import { campaignSummary, loadCampaign, medal, recordRelay, ROUTE, saveCampaign } from './game/campaign.ts'

const page = createGamePage()
const { element: $, url, storage, reducedMotion, text, show } = page
const requestedCourse = url.searchParams.get('course')
const roomCode = url.searchParams.get('room')
const requestedBackend = url.searchParams.has('canvas') ? 'canvas' : url.searchParams.get('renderer')
const progress = loadCampaign(storage)
const audio = createAudio()

function time(ticks: number) {
  const centiseconds = Math.floor(ticks * STEP * 100)
  const remainder = String(centiseconds % 6000).padStart(4, '0')
  return Math.floor(centiseconds / 6000) + ':' + remainder.slice(0, 2) + '.' + remainder.slice(2)
}
function unlockSound() {
  if (progress.sound) audio.unlock()
}
function paintSound() {
  text('sound', progress.sound ? 'Sound on' : 'Sound off')
  $('sound').setAttribute('aria-pressed', String(progress.sound))
  audio.mute(!progress.sound)
}
$('sound').onclick = () => {
  progress.sound = !progress.sound
  unlockSound()
  paintSound()
  saveCampaign(storage, progress)
}
paintSound()

async function start() {
  const config = ['webgpu', 'webgl2', 'canvas'].includes(requestedBackend) ? { backend: requestedBackend as Backend } : {}
  const [renderer, sprites] = await Promise.all([
    createLowPolyRenderer($<HTMLCanvasElement>('stage'), config),
    createSprites($<HTMLCanvasElement>('sprites'), reducedMotion)
  ])
  const hud = createHud($<HTMLCanvasElement>('beacon-hud'))
  const selector = $<HTMLSelectElement>('course')
  const campaignButton = $<HTMLButtonElement>('campaign')
  let courseId = ROUTE.includes(requestedCourse) ? requestedCourse : ROUTE[0]
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
  let standingsKey = ''
  let character: CharacterView
  let unlockedKey = ''
  let initialMessage = ''
  const expeditionButton = $<HTMLButtonElement>('expedition')
  const controls = bindPlatformControls({
    buttons: page.controls(),
    enabled: () => screen === 'play' && !latest?.finished,
    onPause: togglePause,
    onGesture: unlockSound
  })
  const { read: readInput, clear: clearInput } = controls

  async function loadCharacter() {
    character = await page.requestJson<CharacterView>('/expeditions/character', { method: 'POST' }, 'Could not load your guild character.')
  }

  function nextRegion() {
    return ROUTE.find(id => !character.cleared.includes(id) && canEnterRegion(character.cleared, id)) ?? ROUTE[0]
  }

  if (mode === 'expedition') {
    try {
      await loadCharacter()
      if (!canEnterRegion(character.cleared, courseId)) {
        initialMessage = 'Restore the earlier relays to unlock ' + courses[courseId].name + '.'
        courseId = nextRegion()
      }
    } catch (error) {
      initialMessage = error.message
      mode = 'campaign'
      code = null
      screen = 'title'
    }
  }

  function shared() { return mode === 'online' || mode === 'expedition' }
  let knownFalls = 0
  let knownCrystals = 0
  let knownSignal = false
  let wasGrounded = false
  let knownRevision = -1

  function paintCampaign() {
    const summary = campaignSummary(progress)
    text('campaign', summary.complete ? 'Replay campaign' : summary.cleared ? 'Continue campaign' : 'Start campaign')
    text('campaign-progress', summary.cleared + ' / ' + ROUTE.length + ' relays online')
    show('view-ending', summary.complete)
    text('ending-stats', summary.signals + ' / ' + ROUTE.length + ' signal chips · ' +
      summary.gold + ' / ' + ROUTE.length + ' gold · best combined ' + time(summary.ticks))
  }
  function paintScreen() {
    const playing = screen === 'play'
    const onCourse = playing || screen === 'pause' || screen === 'journal'
    show('hud', playing)
    show('best', onCourse && mode !== 'expedition')
    show('time', mode !== 'expedition')
    show('controls', playing)
    show('title-screen', screen === 'title')
    show('pause-screen', screen === 'pause')
    show('journal-screen', screen === 'journal')
    show('ending', screen === 'ending')
    show('journal-open', shared())
    show('results', onCourse && shared())
    show('journal', onCourse && mode === 'expedition')
    show('mode', shared())
    show('pause-menu', mode !== 'expedition')
    text('mode', mode === 'expedition' ? 'Main menu' : 'Solo practice')
    text('menu-status', mode === 'expedition' ? 'Expedition menu' : shared() ? 'Room menu' : 'Paused')
    text('roster-heading', mode === 'expedition' ? 'Nearby wayfarers' : 'Room standings')
    if (!playing) show('finish', false)
  }
  function setScreen(value: string) {
    screen = value
    clearInput()
    paintScreen()
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
  function syncSelector() {
    const unlocked = ROUTE.indexOf(campaignSummary(progress).next)
    page.options('course', ROUTE.map((id, i) => ({
      label: courses[id].name, value: id, selected: id === courseId,
      disabled: mode === 'expedition' ? !canEnterRegion(character.cleared, id)
        : mode === 'campaign' && unlocked >= 0 && i > unlocked
    })))
  }
  function recordTime(ticks?: number) {
    const key = 'ridgetop.best.' + courseId
    let best
    try {
      const saved = Number(storage?.getItem(key))
      if (Number.isSafeInteger(saved) && saved > 0) best = saved
      if (ticks && (!best || ticks < best)) storage?.setItem(key, String(ticks))
    } catch { /* Progress has its own in-memory record. */ }
    const candidate = Math.min(ticks ?? Infinity, best ?? Infinity, progress.levels[courseId]?.ticks ?? Infinity)
    text('best', 'Best ' + (candidate === Infinity ? '—' : time(candidate)))
  }
  function join() {
    room?.close()
    room = undefined
    if (!code) {
      text('connection', mode === 'campaign' ? 'Campaign' : 'Solo practice')
      $('connection').dataset.online = 'false'
      return
    }
    text('connection', 'Joining room…')
    room = connectRoom<PlayerSnapshot>({
      endpoint: (mode === 'expedition' ? '/expeditions/' : '/rooms/') + courseId + '/' + code,
      readInput,
      onStatus(status) {
        const labels = { connected: mode === 'expedition' ? 'Expedition online' : 'Room online', reconnecting: 'Reconnecting…', unavailable: 'Room unavailable' }
        text('connection', labels[status])
        $('connection').dataset.online = String(status === 'connected')
        if (status === 'unavailable') text('message', mode === 'expedition'
          ? 'This expedition instance is unavailable. Return to the main menu to rejoin.'
          : 'This room is unavailable. Select Solo practice to keep playing.')
      }
    })
  }
  function setupCourse() {
    scene?.dispose()
    scene = createCourseScene(renderer, courses[courseId], reducedMotion, sprites)
    player = createPlayer('solo', 0, courses[courseId])
    player.jump = readInput().jump
    latest = undefined
    finishRun = undefined
    knownRevision = -1
    standingsKey = unlockedKey = ''
    page.list('standings', [])
    show('finish', false)
    syncSelector()
    paintScreen()
    syncUrl()
    join()
    recordTime()
    text('chapter', 'Relay ' + (ROUTE.indexOf(courseId) + 1) + ' of ' + ROUTE.length)
    text('course-heading', courses[courseId].name)
    text('briefing', courses[courseId].description)
    text('invite', code ? 'Copy room link' : 'Invite players')
    text('message', '')
    if (mode === 'expedition') paintJournal()
  }
  function enter(nextMode, nextCourse = courseId) {
    mode = nextMode
    courseId = nextCourse
    if (mode === 'expedition') code ??= GUILD_WORLD
    else if (mode !== 'online') code = null
    setScreen('play')
    setupCourse()
    $('stage').focus()
  }
  $('stage').tabIndex = -1
  function showTitle() {
    code = null
    mode = 'campaign'
    courseId = ROUTE[0]
    setScreen('title')
    setupCourse()
    paintCampaign()
    campaignButton.focus()
  }
  function showEnding() {
    if (!campaignSummary(progress).complete) return
    paintCampaign()
    setScreen('ending')
    audio.play('ending')
    $('ending-menu').focus()
  }
  function togglePause() {
    if (screen === 'play') {
      if (latest?.finished) return
      setScreen('pause')
      $('resume').focus()
    } else if (screen === 'pause' || screen === 'journal') {
      setScreen('play')
      $('stage').focus()
    }
  }

  campaignButton.onclick = () => {
    unlockSound()
    enter('campaign', campaignSummary(progress).next ?? ROUTE[0])
  }
  $<HTMLButtonElement>('practice').onclick = () => { unlockSound(); enter('practice', ROUTE[0]) }
  expeditionButton.onclick = async () => {
    expeditionButton.disabled = true
    unlockSound()
    try {
      await loadCharacter()
      if (screen === 'title') enter('expedition', nextRegion())
    } catch (error) {
      text('message', error.message)
    } finally {
      expeditionButton.disabled = false
    }
  }
  $('mode').onclick = () => mode === 'expedition' ? showTitle() : enter('practice')
  $('pause').onclick = $('resume').onclick = $('journal-close').onclick = togglePause
  $('journal-open').onclick = () => {
    setScreen('journal')
    $('journal-close').focus()
  }
  $('pause-menu').onclick = $('ending-menu').onclick = showTitle
  $('view-ending').onclick = () => { unlockSound(); showEnding() }
  selector.onchange = () => {
    if (!selector.selectedOptions[0]?.disabled) enter(mode, selector.value)
  }
  $('invite').onclick = async () => {
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
      text('message', 'Room link copied.')
    } catch {
      text('message', share.href)
    }
  }
  $('reset').onclick = $('again').onclick = () => {
    setScreen('play')
    if (room) room.restart()
    else player = restartPlayer(player, readInput(), courses[courseId])
    $('stage').focus()
  }
  $('next').onclick = () => {
    const after = ROUTE[ROUTE.indexOf(courseId) + 1]
    if (mode === 'expedition') {
      if (after && canEnterRegion(character.cleared, after)) enter(mode, after)
      else showTitle()
    } else if (mode === 'campaign' && !after && campaignSummary(progress).complete) showEnding()
    else enter(mode, after ?? ROUTE[0])
  }
  setupCourse()
  text('message', initialMessage)
  paintCampaign()
  campaignButton.disabled = $<HTMLButtonElement>('practice').disabled = expeditionButton.disabled = false

  function paintRun(local: PlayerSnapshot | undefined) {
    const course = courses[courseId]
    const collected = course.crystals.filter((_, i) => local?.crystals & (1 << i)).length
    const falls = (local?.falls ?? 0) + ((local?.falls ?? 0) === 1 ? ' fall' : ' falls')
    const elapsed = time(local?.ticks ?? 0)
    const chip = local?.signal ? '◆ Chip found' : '◇ Signal chip'
    text('crystals', collected + ' / ' + course.crystals.length)
    text('falls', falls)
    text('time', elapsed)
    text('chip', chip)
    show('checkpoint', local?.checkpoint)
    show('finish', local?.finished)
    show('controls', !local?.finished)
    const status = mode === 'expedition' ? $('connection').textContent : elapsed + '  ·  ' + falls
    const best = mode === 'expedition' ? '' : $('best').textContent
    const checkpoint = local?.checkpoint ? 'Checkpoint saved' : ''
    const key = local?.finished ? 'overlay' : [courseId, mode, collected, chip, status, best, checkpoint].join('|')
    hud.render(renderer.canvas, key, ui => {
      if (local?.finished) return
      const inset = Math.max(10, Math.min(24, ui.width * .02))
      const width = Math.min(230, Math.max(150, ui.width * .46))
      const x = inset + 12
      const label = { size: 11, fill: '#b8d8c7', mono: true, maxWidth: width - 24 }
      ui.panel(inset, inset, width, 108 + (best ? 16 : 0) + (checkpoint ? 16 : 0), {
        fill: '#11242beb', stroke: '#a5e3bf66', radius: 8
      })
      ui.text($('chapter').textContent.toUpperCase(), x, inset + 10, { ...label, fill: '#a9efb4' })
      ui.text(course.name, x, inset + 26, { fill: '#f1f9ef', size: 22, weight: 800, maxWidth: width - 24 })
      for (let i = 0; i < course.crystals.length; i++) {
        const found = Boolean(local?.crystals & (1 << i))
        ui.text(found ? '◆' : '◇', x + i * 19, inset + 53, { size: 16, fill: found ? '#a6ffee' : '#9bb9b0' })
      }
      ui.text(chip, x, inset + 73, { ...label, fill: local?.signal ? '#f8d782' : label.fill })
      ui.text(status, x, inset + 90, label)
      if (best) ui.text(best, x, inset + 106, label)
      if (checkpoint) ui.text(checkpoint, x, inset + (best ? 122 : 106), { ...label, fill: '#a9efb4' })
    })
    if (!local) return

    if (local.revision === knownRevision) {
      if (local.falls > knownFalls) audio.play('hit')
      else if (local.signal && !knownSignal) audio.play('signal')
      else if (local.crystals !== knownCrystals) audio.play('crystal')
      else if (wasGrounded && !local.grounded && local.vy < -250) audio.play('jump')
    }
    knownRevision = local.revision
    knownFalls = local.falls
    knownCrystals = local.crystals
    knownSignal = local.signal
    wasGrounded = local.grounded
    if (!local.finished || finishRun === local.id + "/" + local.revision) return

    finishRun = local.id + "/" + local.revision
    audio.play('finish')
    const medalText = ['', 'Bronze', 'Silver', 'Gold'][medal(courses[courseId], local)]
    text('finish-time', mode === 'expedition'
      ? courses[courseId].name + ' · ' + expeditionLoot[courseId]
      : courses[courseId].name + ' · ' + time(local.ticks))
    text('finish-medal', medalText + (local.signal ? ' · Signal chip recovered' : ''))
    text('next', courseId === ROUTE.at(-1) ?
      (mode === 'campaign' ? 'View ending' : mode === 'expedition' ? 'Main menu' : 'Next course') :
      mode === 'expedition' ? 'Next zone' : 'Next course')
    if (mode === 'campaign') {
      recordRelay(progress, courseId, local)
      saveCampaign(storage, progress)
      paintCampaign()
      syncSelector()
    }
    recordTime(local.ticks)
    $('next').focus()
  }
  function paintStandings(players: readonly PlayerSnapshot[], local: PlayerSnapshot | undefined) {
    const lines = [...players].sort((a, b) =>
      mode === 'expedition' ? a.slot - b.slot : Number(b.finished) - Number(a.finished) ||
        (a.finished && b.finished ? a.ticks - b.ticks : a.slot - b.slot))
      .map(item => (item.character ? item.character.name + ' · Lv ' + item.character.level +
        (item.id === local?.id ? ' (you)' : '') : item.id === local?.id ? 'You' : 'Scout ' + (item.slot + 1)) +
        ' · ' + (mode === 'expedition' ? (item.finished ? 'At the relay' : 'Exploring') :
          item.finished ? time(item.ticks) : 'On course'))
    const key = lines.join('|')
    if (key !== standingsKey) {
      standingsKey = key
      page.list('standings', lines)
    }
  }
  function paintJournal(local?: PlayerSnapshot) {
    character = local?.character ?? character
    const key = character.cleared.join(',')
    if (key !== unlockedKey) {
      unlockedKey = key
      syncSelector()
    }
    const cleared = character.cleared.includes(courseId)
    const guildClear = character.guild.includes(courseId)
    text('character-name', character.name)
    text('character-rank', 'Level ' + character.level + ' · ' + character.xp + ' XP')
    text('zone-quest', cleared ? 'Relay restored · ' + expeditionLoot[courseId] + ' earned'
      : 'Gather five crystals and reach the relay for 100 XP and a relic.')
    text('guild-quest', guildClear ? 'Guild contract complete · +60 XP'
      : 'Guild contract · Reach the relay with another wayfarer.')
    text('relics', character.cleared.map(id => expeditionLoot[id]).join(' · ') || 'Restore a relay to earn your first relic.')
    if (local?.finished) {
      text('finish-medal', guildClear ? 'Guild contract complete' : 'Stay at the relay for a second wayfarer to finish.')
    }
  }
  const stop = fixedLoop({
    update(dt) {
      if (screen === 'play' && !room) stepPlayer(player, readInput(), dt, courses[courseId])
    },
    render(_alpha, now) {
      room?.flush(now)
      const players = room ? room.sample(now) : [player]
      const local = room ? players.find(candidate => candidate.id === room.id) : player
      latest = local
      scene.render(players, local, now)
      text('backend', renderer.name)
      if (screen === 'play') paintRun(local)
      else hud.render(renderer.canvas, 'overlay', () => {})
      if (room) paintStandings(players, local)
      if (mode === 'expedition') paintJournal(local)
    }
  })
  page.lifecycle({
    hide(persisted) {
      room?.close()
      clearInput()
      if (!persisted) {
        stop()
        controls.dispose()
        scene.dispose()
        renderer.dispose()
        audio.close()
      }
    },
    restore: join
  })
}

start().catch(error => {
  text('connection', 'Startup failed')
  text('message', error.message)
  console.error(error)
})
