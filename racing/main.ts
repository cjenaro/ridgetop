import { bindActionControls, createGamePage, createHud, createLowPolyRenderer, createSynthAudio, fixedLoop } from '../framework/index.ts'
import type { Backend } from '../framework/index.ts'
import { createRace, recover, standings, stepRace } from './race.ts'
import { createRaceScene } from './scene.ts'
import { circuits } from './track.ts'
import { leadingEvent, loadChampionship, recordResult, saveChampionship, unlocked } from './progression.ts'
import { createGaragePanel } from './garage.ts'
import { createGarageBay } from './garage-art.ts'

const page = createGamePage()
const { element, text, show } = page
type Screen = 'home' | 'events' | 'garage' | 'racing' | 'paused' | 'results'
type Action = 'left' | 'right' | 'throttle' | 'brake' | 'drift' | 'recover' | 'pulse' | 'snare'
const resultLabel = ['', '1st', '2nd', '3rd', '4th']

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
  const viewport = renderer.canvas.parentElement
  const hud = createHud(element<HTMLCanvasElement>('race-hud'))
  const touch = matchMedia('(any-pointer: coarse)')
  const audio = createSynthAudio({
    pulse: [[610, .12, 0, 240]], snare: [[300, .18, 0, 105]],
    hit: [[175, .2, 0, 68]], go: [[660, .15, 0], [880, .20, .10]],
    podium: [[392, .18, 0], [523, .17, .12], [660, .24, .26], [784, .38, .42]]
  }, { volume: .13, waveform: { pulse: 'triangle', hit: 'triangle' } })
  const progress = loadChampionship(page.storage)
  const bay = element('garage-bay')
  const garage = createGaragePanel(element('garage-screen'), progress, () => saveChampionship(page.storage, progress))
  const preview = createGarageBay(renderer)
  const overlay = element('race-overlay')
  const choices = element('race-choices')
  const startButton = element<HTMLButtonElement>('race-start')
  const recoverButton = element<HTMLButtonElement>('race-recover')
  let selected = Math.max(0, leadingEvent(progress))
  let race = createRace(circuits[selected], progress.build)
  let scene = createRaceScene(renderer, race.circuit)
  let screen: Screen = 'home'
  let garageReturn: 'home' | 'events' | 'results' = 'home'
  let result: { place: number; seconds: number; payout: number; qualified: boolean } | undefined
  let countdown = 0
  let queuedPulse = false
  let queuedSnare = false

  const controls = bindActionControls<Action>({
    keys: {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'throttle', KeyW: 'throttle', ArrowDown: 'brake', KeyS: 'brake',
      Space: 'drift', KeyR: 'recover', KeyJ: 'pulse', KeyK: 'snare'
    },
    buttons: page.controls(),
    enabled: () => screen === 'racing',
    onPause: togglePause,
    onGesture: audio.unlock,
    onPress(action) {
      if (action === 'recover' && !countdown) recover(race.drivers[0], race.circuit)
      else if (action === 'pulse') queuedPulse = true
      else if (action === 'snare') queuedSnare = true
    }
  })

  function setScreen(value: Screen) {
    const wasGarage = screen === 'garage'
    if (value === 'garage' && !wasGarage) {
      bay.prepend(renderer.canvas)
      renderer.canvas.setAttribute('aria-label', 'Rally hatch preview with fitted parts')
      preview.invalidate()
    } else if (wasGarage && value !== 'garage') {
      viewport.prepend(renderer.canvas)
      renderer.canvas.setAttribute('aria-label', 'Signal Drift isometric circuit')
      scene.invalidate()
    }
    screen = value
    controls.clear()
    queuedPulse = queuedSnare = false
    paintScreen()
    if (screen === 'garage') garage.open()
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
    startButton.focus()
  }

  function togglePause() {
    if (screen === 'racing') {
      setScreen('paused')
      startButton.focus()
    } else if (screen === 'paused') {
      setScreen('racing')
      element('race-stage').focus()
    } else if (screen === 'garage') leaveGarage()
    else if (screen === 'events' || screen === 'results') goHome()
  }

  function leaveGarage() {
    setScreen(garageReturn)
    element('race-garage').focus()
  }

  function addChoice(name: string, detail: string, action: string, enabled: boolean, invoke: () => void) {
    const row = document.createElement('li')
    const info = document.createElement('div')
    const heading = document.createElement('strong')
    heading.textContent = name
    const caption = document.createElement('small')
    caption.textContent = detail
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'quiet'
    button.textContent = action
    button.disabled = !enabled
    button.setAttribute('aria-label', action + ' ' + name)
    button.onclick = invoke
    info.append(heading, caption)
    row.append(info, button)
    choices.append(row)
    return button
  }

  function paintScreen() {
    const home = screen === 'home'
    const events = screen === 'events'
    const inGarage = screen === 'garage'
    const paused = screen === 'paused'
    const results = screen === 'results'
    const racing = screen === 'racing'
    const qualified = results && result?.qualified
    const circuit = circuits[selected]
    show('race-overlay', !racing && !inGarage)
    show('garage-screen', inGarage)
    show('race-readout', !inGarage)
    show('race-controls', racing)
    show('race-choices', events)
    show('race-purse', home || results)
    show('race-start', home || paused || results)
    show('race-next', qualified && selected < circuits.length - 1)
    show('race-events', home || results)
    show('race-garage', home || events || results)
    show('race-restart', paused)
    show('race-home', !home && !racing)
    show('race-beacon', home)
    show('race-guide', home || paused)
    overlay.classList.toggle('game-title', home)
    text('race-purse', progress.credits + ' credits')
    if (racing || inGarage) return
    const status = leadingEvent(progress)
    text('race-overlay-kicker', home ? (status < 0 ? 'Championship won' : 'Championship')
      : events ? 'Championship schedule' : circuit.name)
    if (home) {
      text('race-overlay-title', 'Signal Drift')
      text('race-overlay-description', status < 0 ? 'You won the Signal Drift Championship. Replay any event from the schedule.'
        : circuit.name + ' · ' + circuit.laps + ' laps. ' + circuit.description)
    } else if (events) {
      text('race-overlay-title', 'Events')
      text('race-overlay-description', 'Meet each event’s finish target to unlock the next circuit.')
    } else if (paused) {
      text('race-overlay-title', 'Race paused')
      text('race-overlay-description', circuit.name + ' · ' + circuit.laps + ' laps')
    } else if (result) {
      text('race-overlay-title', qualified && selected === circuits.length - 1 ? 'Champion' : 'Race complete')
      const next = qualified ? (selected < circuits.length - 1 ? circuits[selected + 1].name + ' unlocked.' : 'Championship won.')
        : 'Finish ' + resultLabel[circuit.qualify] + ' or better to qualify.'
      text('race-overlay-description', resultLabel[result.place] + ' place · ' + time(result.seconds) + ' · +' + result.payout + ' credits. ' + next)
    }
    text('race-start', home ? 'Race ' + circuit.name : paused ? 'Resume race' : 'Race again')
    if (!events) return
    choices.replaceChildren()
    for (const [index, event] of circuits.entries()) {
      const record = progress.records[event.id]
      const available = unlocked(progress, index)
      const detail = event.laps + ' laps · Target ' + resultLabel[event.qualify] + ' or better' +
        (record ? ' · Best ' + resultLabel[record.place] + ' (' + time(record.seconds) + ')' : '')
      const button = addChoice(event.name, detail, available ? 'Race' : 'Locked', available, () => startRace(index))
      button.dataset.event = event.id
    }
  }

  startButton.onclick = () => screen === 'paused' ? togglePause() : startRace()
  element('race-home').onclick = goHome
  element('race-pause').onclick = togglePause
  element('race-restart').onclick = () => startRace()
  element('race-next').onclick = () => startRace(selected + 1)
  element('race-events').onclick = () => {
    setScreen('events')
    choices.querySelector<HTMLButtonElement>('button:enabled')?.focus()
  }
  element('race-garage').onclick = () => {
    if (screen === 'home' || screen === 'events' || screen === 'results') {
      garageReturn = screen
      setScreen('garage')
    }
  }
  element('garage-back').onclick = leaveGarage
  recoverButton.onclick = () => {
    if (!countdown) recover(race.drivers[0], race.circuit)
    element('race-stage').focus()
  }
  startButton.disabled = false
  paintScreen()
  text('race-backend', renderer.name)

  const stop = fixedLoop({
    update(dt) {
      if (screen !== 'racing') return
      if (countdown > 0) {
        countdown = Math.max(0, countdown - dt)
        if (!countdown) audio.play('go')
        return
      }
      const player = race.drivers[0]
      const previous = { pulses: player.pulses, snares: player.snares, shield: player.shield }
      stepRace(race, {
        throttle: Number(controls.active('throttle')) - Number(controls.active('brake')),
        steer: Number(controls.active('right')) - Number(controls.active('left')),
        drift: controls.active('drift'),
        pulse: queuedPulse || controls.active('pulse'),
        snare: queuedSnare || controls.active('snare')
      }, dt)
      queuedPulse = queuedSnare = false
      if (player.pulses < previous.pulses) audio.play('pulse')
      if (player.snares < previous.snares) audio.play('snare')
      if (player.shield < previous.shield) audio.play('hit')
      if (player.finish !== null) {
        const place = standings(race).indexOf(player) + 1
        const qualified = place <= race.circuit.qualify
        const payout = recordResult(progress, race.circuit, place, player.finish)
        result = { place, seconds: player.finish, qualified, payout }
        saveChampionship(page.storage, progress)
        if (qualified) audio.play('podium')
        setScreen('results')
        element(qualified && selected < circuits.length - 1 ? 'race-next' : 'race-start').focus()
      }
    },
    render() {
      if (screen === 'garage') {
        preview.render(garage.part, progress.build)
        hud.render(renderer.canvas, 'garage', () => {})
        text('race-backend', renderer.name)
        return
      }
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
      text('race-lap', lap)
      text('race-position', position)
      text('race-speed', speed + ' km/h')
      text('race-time', elapsed)
      text('race-surface', surface)
      text('race-shield', 'Shield ' + shield)
      text('race-ammo', ammo)
      text('race-backend', renderer.name)
      const racing = screen === 'racing'
      const count = Math.ceil(countdown)
      const key = racing ? [circuit.id, lap, position, speed, elapsed, surface, shield, ammo, count, touch.matches].join('|') : 'overlay'
      hud.render(renderer.canvas, key, ui => {
        if (!racing) return
        const inset = Math.max(10, Math.min(24, ui.width * .02))
        const width = ui.width <= 520 ? 156 : 191
        const left = inset + 12
        const right = inset + width - 12
        const label = { size: 11, mono: true, fill: '#f3bd88' }
        const number = { size: 25, weight: 800, mono: true, fill: '#fff0dc' }
        const panel = { fill: '#251b18ee', stroke: '#f6b57c6b', radius: 7 }
        ui.panel(inset, inset, width, 88, panel)
        ui.text('POSITION', left, inset + 10, label)
        ui.text(lap.toUpperCase(), right, inset + 10, { ...label, align: 'right' })
        ui.text(position, left, inset + 26, number)
        ui.text(elapsed, right, inset + 32, { ...label, align: 'right', fill: '#fff0dc' })
        ui.text(circuit.name.toUpperCase(), left, inset + 63, label)
        const bottom = touch.matches || ui.width <= 520 ? inset + 96 : ui.height - inset - 107
        ui.panel(inset, bottom, width, 107, panel)
        ui.text(speed, left, bottom + 8, { ...number, size: 30 })
        ui.text('KM/H', right, bottom + 21, { ...label, align: 'right' })
        ui.text(surface.toUpperCase(), left, bottom + 44, { ...label, fill: player.offroad || player.disabled ? '#ff957c' : label.fill })
        ui.text('SHIELD ' + shield, left, bottom + 60, label)
        ui.panel(left, bottom + 75, width - 24, 3, { fill: '#68473c', radius: 1 })
        if (player.shield) {
          ui.panel(left, bottom + 75, (width - 24) * player.shield / player.maxShield, 3, { fill: '#96ebd4', radius: 1 })
        }
        ui.text(ammo.toUpperCase(), left, bottom + 86, { ...label, fill: '#fff0dc' })
        if (count) {
          ui.panel(ui.width / 2 - 38, ui.height * .30 - 30, 76, 60, panel)
          ui.text(String(count), ui.width / 2, ui.height * .30 - 24,
            { ...number, size: 42, align: 'center' })
        }
      })
    }
  })
  page.lifecycle({
    hide(persisted) {
      controls.clear()
      if (!persisted) {
        stop()
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

start().catch(error => text('race-message', error.message))
