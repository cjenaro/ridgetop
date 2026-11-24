import { bindActionControls, createGamePage, createHud, createLowPolyRenderer, createSynthAudio, fixedLoop } from 'ridgetop'
import type { Backend } from 'ridgetop'
import { boxNode, column, overlay, row } from 'ridgetop/ui-layout'
import { buttonPrimitive } from 'ridgetop/ui-button'
import { createCanvasUi, createUiTheme } from 'ridgetop/ui-canvas'
import { createRace, recover, standings, stepRace } from './race.ts'
import { createRaceScene } from './scene.ts'
import { circuits } from './track.ts'
import { leadingEvent, loadChampionship, recordResult, saveChampionship, unlocked } from './progression.ts'
import { createGarageState } from './garage.ts'
import { createGarageBay } from './garage-art.ts'
import { createSaveBackup } from './save-menu.ts'

const page = createGamePage()
const { element } = page
type Screen = 'home' | 'events' | 'garage' | 'saves' | 'racing' | 'paused' | 'results'
type Action = 'left' | 'right' | 'throttle' | 'brake' | 'drift' | 'recover' | 'pulse' | 'snare'
const resultLabel = ['', '1st', '2nd', '3rd', '4th']
const isHosted = document.body.dataset.hosted === '1' && !page.platform.isNative

function time(seconds: number) {
  const cs = Math.floor(seconds * 100)
  const tail = String(cs % 6000).padStart(4, '0')
  return Math.floor(cs / 6000) + ':' + tail.slice(0, 2) + '.' + tail.slice(2)
}

async function start() {
  const requested = page.url.searchParams.has('canvas') ? 'canvas' : page.url.searchParams.get('renderer')
  const backend: Backend = requested === 'webgpu' || requested === 'webgl2' || requested === 'canvas' ? requested : 'auto'
  const stage = element<HTMLCanvasElement>('race-stage')
  const renderer = await createLowPolyRenderer(stage, { backend })
  const hud = createHud(element<HTMLCanvasElement>('race-hud'))
  const uiCanvas = element<HTMLCanvasElement>('race-ui')
  const touch = matchMedia('(any-pointer: coarse)')
  touch.addEventListener('change', () => { uiDirty = true })
  const audio = createSynthAudio({
    pulse: [[610, .12, 0, 240]], snare: [[300, .18, 0, 105]],
    hit: [[175, .2, 0, 68]], go: [[660, .15, 0], [880, .20, .10]],
    podium: [[392, .18, 0], [523, .17, .12], [660, .24, .26], [784, .38, .42]]
  }, { volume: .13, waveform: { pulse: 'triangle', hit: 'triangle' } })

  const progress = loadChampionship(page.storage)
  let saveFailed = !page.storage
  let uiDirty = true
  const garage = createGarageState(progress, () => { persist(); uiDirty = true })
  const saves = createSaveBackup(
    element<HTMLInputElement>('race-save-file'),
    progress,
    next => {
      Object.assign(progress, next)
      prepare(Math.max(0, leadingEvent(progress)))
      const saved = persist()
      uiDirty = true
      return saved
    },
    () => { uiDirty = true }
  )
  const preview = createGarageBay(renderer)
  let selected = Math.max(0, leadingEvent(progress))
  let race = createRace(circuits[selected], progress.build)
  let scene = createRaceScene(renderer, race.circuit)
  let screen: Screen = 'home'
  let garageReturn: 'home' | 'events' | 'results' = 'home'
  let result: { place: number; seconds: number; payout: number; qualified: boolean } | undefined
  let countdown = 0
  let queuedPulse = false
  let queuedSnare = false
  const touchHeld: Record<Action, boolean> = {
    left: false, right: false, throttle: false, brake: false, drift: false, recover: false, pulse: false, snare: false
  }

  function persist() {
    saveFailed = !saveChampionship(page.storage, progress)
    return !saveFailed
  }

  function clearTouch() {
    for (const k of Object.keys(touchHeld) as Action[]) touchHeld[k] = false
    ui.clearHolds()
  }

  const controls = bindActionControls<Action>({
    keys: {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'throttle', KeyW: 'throttle', ArrowDown: 'brake', KeyS: 'brake',
      Space: 'drift', KeyR: 'recover', KeyJ: 'pulse', KeyK: 'snare'
    },
    gamepad: {
      left: [{ button: 14 }, { axis: 0, direction: -1, threshold: .3 }],
      right: [{ button: 15 }, { axis: 0, direction: 1, threshold: .3 }],
      throttle: [{ button: 7, threshold: .2 }, { button: 0 }],
      brake: [{ button: 6, threshold: .2 }, { button: 13 }],
      drift: [{ button: 4 }, { button: 1 }],
      pulse: [{ button: 5 }, { button: 2 }],
      snare: [{ button: 3 }],
      recover: [{ button: 8 }]
    },
    buttons: [],
    enabled: () => screen === 'racing',
    onPause: togglePause,
    onGesture: audio.unlock,
    onPress(action) {
      if (countdown) return
      if (action === 'recover') recover(race.drivers[0], race.circuit)
      else if (action === 'pulse') queuedPulse = true
      else if (action === 'snare') queuedSnare = true
    }
  })

  function active(action: Action) {
    return controls.active(action) || touchHeld[action]
  }

  function setScreen(value: Screen) {
    const wasGarage = screen === 'garage'
    if (value === 'garage' && !wasGarage) preview.invalidate()
    else if (wasGarage && value !== 'garage') scene.invalidate()
    screen = value
    controls.clear()
    clearTouch()
    queuedPulse = queuedSnare = false
    if (screen === 'garage') garage.open()
    if (screen !== 'saves') saves.clear()
    uiDirty = true
  }

  function prepare(index: number) {
    selected = index
    const circuit = circuits[index]
    if (race.circuit !== circuit) {
      scene.dispose()
      scene = createRaceScene(renderer, circuit)
    }
    race = createRace(circuit, progress.build)
    result = undefined
  }

  function startRace(index = selected) {
    if (!unlocked(progress, index)) return
    audio.unlock()
    prepare(index)
    countdown = 2.5
    setScreen('racing')
    element('race-stage').focus()
  }

  function goHome() {
    const next = leadingEvent(progress)
    prepare(next === -1 ? selected : next)
    setScreen('home')
  }

  function leaveGarage() {
    setScreen(garageReturn)
  }

  function togglePause() {
    if (screen === 'racing') setScreen('paused')
    else if (screen === 'paused') { setScreen('racing'); element('race-stage').focus() }
    else if (screen === 'garage') leaveGarage()
    else if (screen === 'events' || screen === 'results' || screen === 'saves') goHome()
  }

  // Opt-in UI primitives (zero HTML/CSS menus).
  const startBtn = buttonPrimitive.create({ id: 'race-start', label: 'Start race', onPress: () => screen === 'paused' ? togglePause() : startRace() })
  const nextBtn = buttonPrimitive.create({ id: 'race-next', label: 'Next event', onPress: () => startRace(selected + 1) })
  const eventsBtn = buttonPrimitive.create({ id: 'race-events', label: 'Events', onPress: () => setScreen('events') })
  const garageBtn = buttonPrimitive.create({
    id: 'race-garage',
    label: 'Garage',
    onPress: () => {
      if (screen === 'home' || screen === 'events' || screen === 'results') {
        garageReturn = screen
        setScreen('garage')
      }
    }
  })
  const savesBtn = buttonPrimitive.create({ id: 'race-saves', label: 'Save backup', onPress: () => setScreen('saves') })
  const restartBtn = buttonPrimitive.create({ id: 'race-restart', label: 'Restart race', onPress: () => startRace() })
  const homeBtn = buttonPrimitive.create({ id: 'race-home', label: 'Main menu', onPress: goHome })
  const garageBackBtn = buttonPrimitive.create({ id: 'garage-back', label: 'Back', onPress: leaveGarage })
  const garageInstallBtn = buttonPrimitive.create({ id: 'garage-install', label: 'Install', onPress: () => { garage.install(); uiDirty = true } })
  const recoverBtn = buttonPrimitive.create({ id: 'race-recover', label: 'Recover', onPress: () => { if (!countdown) recover(race.drivers[0], race.circuit) } })
  const pauseBtn = buttonPrimitive.create({ id: 'race-pause', label: 'Pause', onPress: togglePause })
  const saveExportBtn = buttonPrimitive.create({ id: 'race-save-export', label: 'Download backup', onPress: () => saves.exportBackup() })
  const saveImportBtn = buttonPrimitive.create({ id: 'race-save-import', label: 'Choose backup…', onPress: () => saves.chooseFile() })
  const saveRestoreBtn = buttonPrimitive.create({ id: 'race-save-restore', label: 'Replace current progress', onPress: () => saves.applyRestore() })
  const quitBtn = buttonPrimitive.create({ id: 'race-quit', label: 'Quit', onPress: () => { void page.platform.quit() } })

  const ui = createCanvasUi(uiCanvas, {
    theme: createUiTheme({
      uiSurface: '#221a19ee',
      uiSurfaceAlt: '#382924f4',
      uiTop: '#6b473b88',
      uiBorder: '#e2a77380',
      accent: '#f8aa4e',
      accentText: '#1e1410',
      light: '#fff2e2',
      muted: '#d8beaa',
      scrim: '#120e0ec4'
    }),
    safeArea: { top: 12, right: 12, bottom: 12, left: 12 },
    keyboardEnabled: () => screen !== 'racing',
    onBack: togglePause
  })

  function overlayTitleText() {
    if (screen === 'home') return 'Signal Drift'
    if (screen === 'events') return 'Events'
    if (screen === 'paused') return 'Race paused'
    if (screen === 'saves') return 'Save backup'
    if (screen === 'results' && result) {
      return result.qualified && selected === circuits.length - 1 ? 'Champion' : 'Race complete'
    }
    return 'Signal Drift'
  }

  function buildUiTree(w: number, h: number) {
    const compact = w < 620
    const circuit = circuits[selected]
    const status = leadingEvent(progress)
    const racing = screen === 'racing'
    const inGarage = screen === 'garage'
    const inSaves = screen === 'saves'
    const home = screen === 'home'
    const events = screen === 'events'
    const paused = screen === 'paused'
    const results = screen === 'results'
    const qualified = Boolean(results && result?.qualified)
    const showOverlay = home || events || paused || results
    const showTouch = racing && touch.matches
    const g = garage.view()

    const overlayKicker = home ? (status < 0 ? 'CHAMPIONSHIP WON' : 'CHAMPIONSHIP')
      : events ? 'CHAMPIONSHIP SCHEDULE'
      : circuit.name.toUpperCase()
    const overlayDesc = home
      ? (status < 0 ? 'You won the Signal Drift Championship. Replay any event from the schedule.' : `${circuit.name} · ${circuit.laps} laps. ${circuit.description}`)
      : events ? 'Meet each event’s finish target to unlock the next circuit.'
      : paused ? `${circuit.name} · ${circuit.laps} laps`
      : result
        ? `${resultLabel[result.place]} place · ${time(result.seconds)} · +${result.payout} credits. ` +
          (qualified ? (selected < circuits.length - 1 ? `${circuits[selected + 1].name} unlocked.` : 'Championship won.') : `Finish ${resultLabel[circuit.qualify]} or better to qualify.`)
        : ''

    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      // In-race top-right controls
      row({ id: 'race-actions', hidden: !racing, style: { anchor: 'top-right', inset: 14, gap: 8, respectSafeArea: true } }, [
        boxNode({ id: 'race-recover', style: { width: 88, height: 40 }, widget: { type: 'button', label: 'Recover', primitive: recoverBtn } }),
        boxNode({ id: 'race-pause', style: { width: 78, height: 40 }, widget: { type: 'button', label: 'Pause', primitive: pauseBtn } })
      ]),

      // Multi-touch driving controls (only on touch devices during racing)
      column({ id: 'touch-left-deck', hidden: !showTouch, style: { anchor: 'bottom-left', inset: 12, gap: 8, respectSafeArea: true } }, [
        row({ id: 'touch-weapons', style: { gap: 8 } }, [
          boxNode({ id: 'touch-pulse', style: { width: 66, height: 46 }, widget: { type: 'button', label: 'Pulse', onHold: (on: boolean) => { touchHeld.pulse = on; if (on) { audio.unlock(); if (!countdown) queuedPulse = true } } } }),
          boxNode({ id: 'touch-snare', style: { width: 66, height: 46 }, widget: { type: 'button', label: 'Snare', onHold: (on: boolean) => { touchHeld.snare = on; if (on) { audio.unlock(); if (!countdown) queuedSnare = true } } } })
        ]),
        row({ id: 'touch-steer', style: { gap: 8 } }, [
          boxNode({ id: 'touch-left', style: { width: 66, height: 54 }, widget: { type: 'button', label: '←', onHold: (on: boolean) => { touchHeld.left = on; if (on) audio.unlock() } } }),
          boxNode({ id: 'touch-right', style: { width: 66, height: 54 }, widget: { type: 'button', label: '→', onHold: (on: boolean) => { touchHeld.right = on; if (on) audio.unlock() } } })
        ])
      ]),
      row({ id: 'touch-right-deck', hidden: !showTouch, style: { anchor: 'bottom-right', inset: 12, gap: 8, respectSafeArea: true } }, [
        boxNode({ id: 'touch-drift', style: { width: 62, height: 54 }, widget: { type: 'button', label: 'Drift', onHold: (on: boolean) => { touchHeld.drift = on; if (on) audio.unlock() } } }),
        boxNode({ id: 'touch-brake', style: { width: 62, height: 54 }, widget: { type: 'button', label: 'Brake', onHold: (on: boolean) => { touchHeld.brake = on; if (on) audio.unlock() } } }),
        boxNode({ id: 'touch-throttle', style: { width: 66, height: 54 }, widget: { type: 'button', label: 'Go', primary: true, onHold: (on: boolean) => { touchHeld.throttle = on; if (on) audio.unlock() } } })
      ]),

      // Home / Events / Paused / Results overlay
      boxNode({ id: 'overlay-scrim', hidden: !showOverlay, style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true, fill: home ? '#140f12b8' : '#120e0ec4' } }),
      column({
        id: 'race-overlay-card',
        hidden: !showOverlay,
        style: {
          anchor: home && !compact ? 'top-left' : 'center',
          width: Math.min(w - 32, events ? 520 : 440),
          inset: home && !compact ? 48 : 16,
          padding: 24,
          gap: 10,
          respectSafeArea: true
        },
        widget: { type: 'panel' }
      }, [
        boxNode({ id: 'race-overlay-kicker', style: { height: 18 }, widget: { type: 'text', text: overlayKicker, size: 12, weight: 800, color: ui.theme.accent, mono: true } }),
        boxNode({ id: 'race-overlay-title', style: { height: 46 }, widget: { type: 'text', text: overlayTitleText().toUpperCase(), size: compact ? 30 : 38, weight: 900 } }),
        boxNode({ id: 'race-overlay-description', style: { height: 44 }, widget: { type: 'text', text: overlayDesc, size: 13, color: ui.theme.muted, wrap: true } }),
        boxNode({ id: 'race-purse', hidden: !(home || results), style: { height: 20 }, widget: { type: 'text', text: `${progress.credits} CREDITS`, size: 13, weight: 800, color: '#8df5d5', mono: true } }),

        ...(events ? circuits.map((ev, index) => {
          const rec = progress.records[ev.id]
          const open = unlocked(progress, index)
          const sub = `${ev.laps} laps · Top ${ev.qualify}` + (rec ? ` · Best ${resultLabel[rec.place]} (${time(rec.seconds)})` : '')
          return boxNode({
            id: 'event-' + ev.id,
            style: { height: 50 },
            widget: {
              type: 'button',
              label: open ? `${ev.name} — Race` : `${ev.name} (Locked)`,
              subtitle: sub,
              disabled: !open,
              onPress: () => startRace(index)
            }
          })
        }) : []),

        boxNode({
          id: 'race-next',
          hidden: !(qualified && selected < circuits.length - 1),
          style: { height: 44 },
          widget: { type: 'button', label: 'Next event', primary: true, primitive: nextBtn }
        }),
        boxNode({
          id: 'race-start',
          hidden: !(home || paused || results),
          style: { height: 44 },
          widget: {
            type: 'button',
            label: home ? `Race ${circuit.name}` : paused ? 'Resume race' : 'Race again',
            primary: !(qualified && selected < circuits.length - 1),
            primitive: startBtn
          }
        }),
        row({ id: 'race-nav-row', style: { gap: 8 } }, [
          boxNode({ id: 'race-events', hidden: !(home || results), style: { grow: 1, height: 40 }, widget: { type: 'button', label: 'Events', primitive: eventsBtn } }),
          boxNode({ id: 'race-garage', hidden: !(home || events || results), style: { grow: 1, height: 40 }, widget: { type: 'button', label: 'Garage', primitive: garageBtn } }),
          boxNode({ id: 'race-restart', hidden: !paused, style: { grow: 1, height: 40 }, widget: { type: 'button', label: 'Restart race', primitive: restartBtn } }),
          boxNode({ id: 'race-home', hidden: !(!home && !racing), style: { grow: 1, height: 40 }, widget: { type: 'button', label: 'Main menu', primitive: homeBtn } })
        ]),
        row({ id: 'race-home-footer', hidden: !home, style: { gap: 8 } }, [
          boxNode({ id: 'race-saves', style: { grow: 1, height: 38 }, widget: { type: 'button', label: 'Save backup', primitive: savesBtn } }),
          boxNode({ id: 'race-beacon', hidden: !isHosted, style: { grow: 1, height: 38 }, widget: { type: 'button', label: 'Play Beacon Run', onPress: () => { location.href = '/' } } }),
          boxNode({ id: 'race-quit', hidden: !page.platform.canQuit, style: { width: 88, height: 38 }, widget: { type: 'button', label: 'Quit', primitive: quitBtn } })
        ]),
        boxNode({
          id: 'race-save-warning',
          hidden: !(home && saveFailed),
          style: { height: 22 },
          widget: { type: 'text', text: 'Automatic saving is unavailable. Use Save backup to keep progress.', size: 12, color: '#ff957c' }
        }),
        boxNode({
          id: 'race-guide',
          hidden: !(home || paused),
          style: { height: 20 },
          widget: { type: 'text', text: 'W/RT Gas · A/D Steer · S/LT Brake · Space/LB Drift · J/RB Pulse · K/Y Snare', size: 11, color: ui.theme.muted, mono: true }
        })
      ]),

      // Save backup modal
      boxNode({ id: 'saves-scrim', hidden: !inSaves, style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      column({
        id: 'saves-card',
        hidden: !inSaves,
        style: { anchor: 'center', width: Math.min(w - 32, 430), padding: 24, gap: 10 },
        widget: { type: 'panel' }
      }, [
        boxNode({ id: 'saves-kicker', style: { height: 18 }, widget: { type: 'text', text: 'PORTABLE CHAMPIONSHIP', size: 11, weight: 800, color: ui.theme.accent, mono: true } }),
        boxNode({ id: 'saves-title', style: { height: 34 }, widget: { type: 'text', text: 'Save backup', size: 26, weight: 800 } }),
        row({ id: 'saves-buttons', style: { gap: 8 } }, [
          boxNode({ id: 'race-save-export', style: { grow: 1, height: 42 }, widget: { type: 'button', label: 'Download backup', primitive: saveExportBtn } }),
          boxNode({ id: 'race-save-import', style: { grow: 1, height: 42 }, widget: { type: 'button', label: 'Choose backup…', primitive: saveImportBtn } })
        ]),
        boxNode({ id: 'race-save-status', hidden: !saves.status, style: { height: 38 }, widget: { type: 'text', text: saves.status, size: 13, color: '#8df5d5', wrap: true } }),
        boxNode({ id: 'race-save-restore', hidden: !saves.hasCandidate, style: { height: 44 }, widget: { type: 'button', label: 'Replace current progress', primary: true, primitive: saveRestoreBtn } }),
        boxNode({ id: 'saves-back', style: { height: 40 }, widget: { type: 'button', label: 'Back', primitive: homeBtn } })
      ]),

      // Live 3D Garage overlay (3D rally car renders directly on #race-stage behind!)
      row({
        id: 'garage-header',
        hidden: !inGarage,
        style: { anchor: 'top', width: Math.min(w - 24, 960), height: 54, inset: 14, padding: [6, 14], gap: 12, align: 'center', respectSafeArea: true },
        widget: { type: 'panel' }
      }, [
        boxNode({ id: 'garage-heading', style: { grow: 1, height: 28 }, widget: { type: 'text', text: 'SIGNAL DRIFT · GARAGE', size: 18, weight: 900 } }),
        boxNode({ id: 'garage-credits', style: { width: 130, height: 24 }, widget: { type: 'text', text: `${g.creditsText} CR`, size: 16, weight: 800, color: '#8df5d5', mono: true, align: 'right' } }),
        boxNode({ id: 'garage-back', style: { width: 82, height: 38 }, widget: { type: 'button', label: 'Back', primitive: garageBackBtn } })
      ]),
      column({
        id: 'garage-parts',
        hidden: !inGarage,
        style: { anchor: compact ? 'bottom-left' : 'bottom-left', width: compact ? Math.floor((w - 30) / 2) : 250, inset: 14, gap: 8, respectSafeArea: true }
      }, g.tiles.map(tile => boxNode({
        id: 'upgrade-' + tile.id,
        style: { height: h < 540 ? 48 : 56 },
        widget: {
          type: 'button',
          label: tile.name,
          subtitle: tile.costLabel,
          icon: tile.icon,
          selected: tile.selected,
          pips: { filled: tile.fitted, total: tile.total },
          onPress: () => { garage.select(tile.id); uiDirty = true }
        }
      }))),
      column({
        id: 'garage-inspector',
        hidden: !inGarage,
        style: { anchor: 'bottom-right', width: compact ? Math.floor((w - 30) / 2) : 320, inset: 14, padding: 16, gap: 8, respectSafeArea: true },
        widget: { type: 'panel' }
      }, [
        boxNode({ id: 'garage-tier', style: { height: 18 }, widget: { type: 'text', text: g.tierText.toUpperCase(), size: 11, weight: 800, color: ui.theme.accent, mono: true } }),
        boxNode({ id: 'garage-part-name', style: { height: 28 }, widget: { type: 'text', text: g.partName, size: 22, weight: 800 } }),
        ...g.statLines.map((line, i) => boxNode({
          id: 'garage-stat-' + i,
          style: { height: 20 },
          widget: { type: 'text', text: line, size: 12, color: ui.theme.text, mono: true }
        })),
        boxNode({
          id: 'garage-install',
          style: { height: 42 },
          widget: { type: 'button', label: g.installLabel, primary: g.canInstall, disabled: !g.canInstall, primitive: garageInstallBtn }
        }),
        boxNode({ id: 'garage-feedback', hidden: !g.feedback, style: { height: 28 }, widget: { type: 'text', text: g.feedback, size: 11, color: '#8df5d5', wrap: true } })
      ])
    ])
  }

  function renderUiNow() {
    const w = Math.max(1, uiCanvas.clientWidth), h = Math.max(1, uiCanvas.clientHeight)
    const ratio = Math.min(devicePixelRatio || 1, 2)
    lastW = w; lastH = h; lastRatio = ratio
    ui.render(buildUiTree(w, h), { width: w, height: h, pixelRatio: ratio })
    uiDirty = false
  }
  let lastW = 0, lastH = 0, lastRatio = 0

  ;(globalThis as { __ridgetopUi?: unknown }).__ridgetopUi = {
    snapshot: () => ui.snapshot(),
    query: (filter?: { id?: string; kind?: string; state?: string; label?: string }) => ui.query(filter),
    act: (id: string, action: string, payload?: unknown) => {
      if (uiDirty) renderUiNow()
      const ok = ui.act(id, action, payload)
      renderUiNow()
      return ok
    },
    rects: () => Object.fromEntries(ui.rects),
    state: () => {
      const player = race.drivers[0]
      const g = garage.view()
      return {
        screen,
        backend: renderer.name,
        hosted: isHosted,
        overlayTitle: overlayTitleText(),
        purse: `${progress.credits} credits`,
        speed: `${Math.round(Math.hypot(player.vx, player.vz) * 3.6)} km/h`,
        shield: `Shield ${player.shield} / ${player.maxShield}`,
        ammo: `Pulse ${player.pulses}  ·  Snare ${player.snares}`,
        eventsLocked: circuits.map((_, i) => !unlocked(progress, i)),
        garageCredits: g.creditsText,
        garagePart: g.partName,
        garageTier: g.tierText,
        garageStats: g.statLines.join(' | '),
        saveStatus: saves.status,
        hasSaveCandidate: saves.hasCandidate
      }
    }
  }

  const stopPlatformLifecycle = page.platform.onLifecycle({
    pause() {
      if (screen === 'racing') setScreen('paused')
      audio.suspend()
    },
    resume() { audio.resume() }
  })

  renderUiNow()
  const stop = fixedLoop({
    update(dt) {
      if (screen !== 'racing') return
      if (countdown > 0) {
        countdown = Math.max(0, countdown - dt)
        if (!countdown) {
          queuedPulse = queuedSnare = false
          audio.play('go')
        }
        return
      }
      const player = race.drivers[0]
      const previous = { pulses: player.pulses, snares: player.snares, shield: player.shield }
      stepRace(race, {
        throttle: Number(active('throttle')) - Number(active('brake')),
        steer: Number(active('right')) - Number(active('left')),
        drift: active('drift'),
        pulse: queuedPulse || active('pulse'),
        snare: queuedSnare || active('snare')
      }, dt)
      queuedPulse = queuedSnare = false
      if (player.pulses < previous.pulses) { audio.play('pulse'); page.platform.haptic('light') }
      if (player.snares < previous.snares) { audio.play('snare'); page.platform.haptic('light') }
      if (player.shield < previous.shield) { audio.play('hit'); page.platform.haptic('heavy') }
      if (player.finish !== null) {
        const place = standings(race).indexOf(player) + 1
        const qualified = place <= race.circuit.qualify
        const payout = recordResult(progress, race.circuit, place, player.finish)
        result = { place, seconds: player.finish, qualified, payout }
        persist()
        if (qualified) {
          audio.play('podium')
          page.platform.haptic('medium')
          if (selected === circuits.length - 1) void page.platform.steam.unlockAchievement('SIGNAL_DRIFT_CHAMPION')
        }
        setScreen('results')
      }
    },
    render() {
      if (screen === 'garage') {
        preview.render(garage.part, progress.build)
        hud.render(renderer.canvas, 'garage', () => {})
      } else {
        const player = race.drivers[0]
        const circuit = race.circuit
        scene.render(race, page.reducedMotion.matches, screen === 'racing' || screen === 'paused' || screen === 'results')
        const lap = 'Lap ' + Math.min(circuit.laps, player.lap + 1) + ' / ' + circuit.laps
        const position = (standings(race).indexOf(player) + 1) + ' / ' + race.drivers.length
        const speed = String(Math.round(Math.hypot(player.vx, player.vz) * 3.6))
        const elapsed = time(race.elapsed)
        const surface = player.disabled ? 'Rebooting' : player.offroad ? 'Off track' : player.drift ? 'Drifting' : 'On track'
        const shield = player.shield + ' / ' + player.maxShield
        const ammo = 'Pulse ' + player.pulses + '  ·  Snare ' + player.snares
        const racing = screen === 'racing'
        const count = Math.ceil(countdown)
        const key = racing ? [circuit.id, lap, position, speed, elapsed, surface, shield, ammo, count, touch.matches].join('|') : 'overlay'
        hud.render(renderer.canvas, key, painter => {
          if (!racing) return
          const inset = Math.max(10, Math.min(24, painter.width * .02))
          const width = painter.width <= 520 ? 156 : 191
          const left = inset + 12
          const right = inset + width - 12
          const label = { size: 11, mono: true, fill: '#f3bd88' }
          const number = { size: 25, weight: 800, mono: true, fill: '#fff0dc' }
          const panel = { fill: '#251b18ee', stroke: '#f6b57c6b', radius: 7 }
          painter.panel(inset, inset, width, 88, panel)
          painter.text('POSITION', left, inset + 10, label)
          painter.text(lap.toUpperCase(), right, inset + 10, { ...label, align: 'right' })
          painter.text(position, left, inset + 26, number)
          painter.text(elapsed, right, inset + 32, { ...label, align: 'right', fill: '#fff0dc' })
          painter.text(circuit.name.toUpperCase(), left, inset + 63, label)
          const bottom = touch.matches || painter.width <= 520 ? inset + 96 : painter.height - inset - 107
          painter.panel(inset, bottom, width, 107, panel)
          painter.text(speed, left, bottom + 8, { ...number, size: 30 })
          painter.text('KM/H', right, bottom + 21, { ...label, align: 'right' })
          painter.text(surface.toUpperCase(), left, bottom + 44, { ...label, fill: player.offroad || player.disabled ? '#ff957c' : label.fill })
          painter.text('SHIELD ' + shield, left, bottom + 60, label)
          painter.panel(left, bottom + 75, width - 24, 3, { fill: '#68473c', radius: 1 })
          if (player.shield) {
            painter.panel(left, bottom + 75, (width - 24) * player.shield / player.maxShield, 3, { fill: '#96ebd4', radius: 1 })
          }
          painter.text(ammo.toUpperCase(), left, bottom + 86, { ...label, fill: '#fff0dc' })
          if (count) {
            painter.panel(painter.width / 2 - 38, painter.height * .30 - 30, 76, 60, panel)
            painter.text(String(count), painter.width / 2, painter.height * .30 - 24, { ...number, size: 42, align: 'center' })
          }
        })
      }

      const w = Math.max(1, uiCanvas.clientWidth), h = Math.max(1, uiCanvas.clientHeight)
      const ratio = Math.min(devicePixelRatio || 1, 2)
      if (uiDirty || ui.dirty || w !== lastW || h !== lastH || ratio !== lastRatio) renderUiNow()
    }
  })

  page.lifecycle({
    hide(persisted) {
      controls.clear()
      clearTouch()
      if (!persisted) {
        stop()
        stopPlatformLifecycle()
        ui.dispose()
        controls.dispose()
        preview.dispose()
        scene.dispose()
        renderer.dispose()
        audio.close()
      }
    },
    restore() {}
  })
}

start().catch(error => console.error(error))
