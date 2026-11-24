import {
  bindActionControls, bindVirtualStick, createGamePage, createHud, createLowPolyRenderer, fixedLoop
} from 'ridgetop'
import type { Backend, HudPainter } from 'ridgetop'
import { boxNode, column, overlay, row, spacerNode } from 'ridgetop/ui-layout'
import { buttonPrimitive } from 'ridgetop/ui-button'
import { createCanvasUi, createUiTheme } from 'ridgetop/ui-canvas'
import { isTestingPaused } from 'ridgetop/testing'
import { createLighthouseAudio } from './audio.ts'
import { createLighthouseScene } from './scene.ts'
import {
  buyUpgrade, canBuyUpgrade, clearSave, createInitialState, loadSave, persistSave, stepGame
} from './simulation.ts'
import {
  LIGHTHOUSE_POS, PADS, UPGRADES, carryCapFor, islandHeight, upgradeCost
} from './types.ts'
import type { GameState, MoveInput, UpgradeId } from './types.ts'

type Screen = 'title' | 'playing' | 'shop' | 'paused' | 'victory'
type Action = 'left' | 'right' | 'up' | 'down' | 'shop' | 'music'

const WEATHER_LABELS = {
  clear: { text: 'CLEAR SKIES', color: '#8de2f5' },
  fog: { text: 'COASTAL FOG', color: '#cfe3e6' },
  rain: { text: 'SQUALL RAIN', color: '#8cbef2' },
  storm: { text: 'GALE STORM', color: '#ff966b' }
} as const

const TIDE_LABELS = {
  low: { text: 'LOW TIDE', color: '#84f2d8' },
  rising: { text: 'TIDE RISING', color: '#78c9eb' },
  high: { text: 'HIGH TIDE', color: '#ffd980' },
  ebbing: { text: 'TIDE EBBING', color: '#9ed9c8' }
} as const

async function start() {
  const page = createGamePage()
  const { element } = page
  const requested = page.url.searchParams.has('canvas') ? 'canvas' : page.url.searchParams.get('renderer')
  const backend: Backend = requested === 'webgpu' || requested === 'webgl2' || requested === 'canvas' ? requested : 'auto'

  const stage = element<HTMLCanvasElement>('lh-stage')
  const hudCanvas = element<HTMLCanvasElement>('lh-hud')
  const uiCanvas = element<HTMLCanvasElement>('lh-ui')

  const renderer = await createLowPolyRenderer(stage, {
    backend,
    canvasDepth: true,
    lighting: { direction: [-0.45, 0.82, 0.36], ambient: 0.50 }
  })
  const hud = createHud(hudCanvas)
  const scene = createLighthouseScene(renderer)
  const audio = createLighthouseAudio()

  const existingSave = loadSave(page.storage)
  let state: GameState = createInitialState(1337, existingSave)
  let screen: Screen = 'title'
  let uiDirty = true
  let hudRev = 0
  let saveTimer = 0
  let victoryShown = state.victoryClaimed

  function hasAffordableUpgrade(): boolean {
    return UPGRADES.some(spec => canBuyUpgrade(state, spec.id))
  }

  function setScreen(next: Screen) {
    screen = next
    controls.clear()
    stick.clear()
    uiDirty = true
    hudRev++
  }

  function startWatch(fresh = false) {
    audio.unlock()
    if (fresh) {
      clearSave(page.storage)
      state = createInitialState((Date.now() & 0xffff) || 1337)
      victoryShown = false
      persistSave(page.storage, state)
    }
    setScreen('playing')
    renderer.canvas.focus()
  }

  function togglePause() {
    if (screen === 'playing') setScreen('paused')
    else if (screen === 'paused' || screen === 'shop' || screen === 'victory') {
      setScreen('playing')
      renderer.canvas.focus()
    }
  }

  const controls = bindActionControls<Action>({
    keys: {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      KeyE: 'shop',
      KeyM: 'music'
    },
    gamepad: {
      left: [{ button: 14 }, { axis: 0, direction: -1, threshold: 0.25 }],
      right: [{ button: 15 }, { axis: 0, direction: 1, threshold: 0.25 }],
      up: [{ button: 12 }, { axis: 1, direction: -1, threshold: 0.25 }],
      down: [{ button: 13 }, { axis: 1, direction: 1, threshold: 0.25 }],
      shop: [{ button: 2 }, { button: 3 }]
    },
    buttons: [],
    enabled: () => screen === 'playing',
    onPause: togglePause,
    onGesture: audio.unlock,
    onPress(action) {
      if (action === 'shop') {
        if (screen === 'playing') setScreen('shop')
      } else if (action === 'music') {
        audio.setMusic(!audio.isMusicEnabled())
        uiDirty = true
      }
    }
  })

  const shopKeyController = new AbortController()
  window.addEventListener('keydown', event => {
    if (isTestingPaused() || event.repeat || screen !== 'shop') return
    if (event.code === 'KeyE' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      setScreen('playing')
      renderer.canvas.focus()
    }
  }, { signal: shopKeyController.signal })

  // UI Primitives (opt-in Ridgetop Canvas UI SDK)
  const playBtn = buttonPrimitive.create({ id: 'lh-play', label: 'Start Watch', onPress: () => startWatch(false) })
  const newGameBtn = buttonPrimitive.create({ id: 'lh-new', label: 'New Watch', onPress: () => startWatch(true) })
  const shopBtn = buttonPrimitive.create({
    id: 'lh-shop',
    label: 'Shop (E)',
    onPress: () => {
      audio.unlock()
      if (screen === 'playing') setScreen('shop')
      else if (screen === 'shop') setScreen('playing')
    }
  })
  const musicBtn = buttonPrimitive.create({
    id: 'lh-music',
    label: 'Music',
    onPress: () => {
      audio.unlock()
      audio.setMusic(!audio.isMusicEnabled())
      uiDirty = true
    }
  })
  const menuBtn = buttonPrimitive.create({
    id: 'lh-menu',
    label: 'Menu',
    onPress: () => { audio.unlock(); togglePause() }
  })
  const resumeBtn = buttonPrimitive.create({ id: 'lh-resume', label: 'Resume Watch', onPress: () => setScreen('playing') })
  const muteBtn = buttonPrimitive.create({
    id: 'lh-mute',
    label: 'Mute Audio',
    onPress: () => {
      audio.unlock()
      audio.setMuted(!audio.isMuted())
      uiDirty = true
    }
  })
  const closeShopBtn = buttonPrimitive.create({ id: 'lh-shop-close', label: 'Back to Island (E)', onPress: () => setScreen('playing') })
  const continueVictoryBtn = buttonPrimitive.create({ id: 'lh-continue', label: 'Keep Watching (Endless)', onPress: () => setScreen('playing') })

  function makeUpgradeButton(id: UpgradeId) {
    const spec = UPGRADES.find(u => u.id === id)
    return buttonPrimitive.create({
      id: `lh-upg-${id}`,
      label: spec?.name ?? id,
      onPress: () => {
        audio.unlock()
        if (buyUpgrade(state, id)) {
          persistSave(page.storage, state)
          hudRev++
          uiDirty = true
          if (state.victory && !victoryShown) {
            victoryShown = true
            setScreen('victory')
          }
        }
      }
    })
  }

  const upgradeButtons: Record<UpgradeId, ReturnType<typeof buttonPrimitive.create>> = {
    boots: makeUpgradeButton('boots'),
    pack: makeUpgradeButton('pack'),
    cloak: makeUpgradeButton('cloak'),
    lens: makeUpgradeButton('lens'),
    winch: makeUpgradeButton('winch'),
    charter: makeUpgradeButton('charter')
  }

  const ui = createCanvasUi(uiCanvas, {
    theme: createUiTheme({
      uiSurface: '#13252ee8',
      uiSurfaceAlt: '#1e3945f4',
      uiTop: '#3a627088',
      uiBorder: '#6ea3a699',
      accent: '#f0b154',
      accentText: '#142026',
      light: '#f5f2e1',
      muted: '#b5d0d1',
      scrim: '#09141cc4'
    }),
    safeArea: { top: 10, right: 10, bottom: 10, left: 10 },
    keyboardEnabled: () => screen !== 'playing',
    onBack: () => {
      if (screen === 'shop' || screen === 'paused' || screen === 'victory') setScreen('playing')
    }
  })

  // Drag / virtual stick steering powered by Ridgetop's `bindVirtualStick`
  const stick = bindVirtualStick(uiCanvas, {
    enabled: () => screen === 'playing',
    isBlocked: (x, y) => Boolean(ui.hitTest(x, y)),
    onGesture: audio.unlock,
    cameraYaw: 0.42
  })

  function readMoveInput(): MoveInput {
    let x = 0, z = 0
    if (controls.active('left')) x -= 1
    if (controls.active('right')) x += 1
    if (controls.active('up')) z -= 1
    if (controls.active('down')) z += 1
    if (x === 0 && z === 0) {
      const sv = stick.vector()
      if (sv.x !== 0 || sv.z !== 0) return sv
    }
    return { x, z }
  }

  function buildUiTree(w: number) {
    const compact = w < 640
    const canBuy = hasAffordableUpgrade()

    if (screen === 'title') {
      const hasSave = Boolean(existingSave && (existingSave.totalEarned ?? 0) > 25)
      return overlay({ id: 'root', style: { anchor: 'fill' } }, [
        column({
          id: 'title-card',
          style: { anchor: 'center', width: Math.min(w - 32, 400), padding: 24, gap: 10 },
          widget: { type: 'panel' }
        }, [
          boxNode({ id: 't-kicker', style: { height: 18 }, widget: { type: 'text', text: 'RIDGETOP EXAMPLE GAME', size: 11, weight: 700, color: '#84f2d8', align: 'center', mono: true } }),
          boxNode({ id: 't-title', style: { height: 38 }, widget: { type: 'text', text: 'TIDEWATCH', size: 30, weight: 800, align: 'center' } }),
          boxNode({
            id: 't-desc',
            style: { height: 54 },
            widget: {
              type: 'text',
              text: 'Gather coastal salvage at low tide, keep the lighthouse lit through fog and gales, guide passing ships, and upgrade your gear.',
              size: 13,
              color: ui.theme.muted,
              align: 'center',
              wrap: true
            }
          }),
          spacerNode(4),
          boxNode({
            id: 'lh-play',
            style: { height: 46 },
            widget: { type: 'button', label: hasSave ? `Continue Watch (Day ${state.day} · ${state.coins}g)` : 'Begin Watch', primary: true, primitive: playBtn }
          }),
          boxNode({
            id: 'lh-new',
            hidden: !hasSave,
            style: { height: 40 },
            widget: { type: 'button', label: 'Start Fresh Watch', primitive: newGameBtn }
          }),
          boxNode({
            id: 't-controls',
            style: { height: 34 },
            widget: { type: 'text', text: 'WASD / Arrows or Click-Drag to Run · E for Workshop · M for Music', size: 11, color: ui.theme.muted, align: 'center', wrap: true, mono: true }
          })
        ])
      ])
    }

    if (screen === 'shop') {
      const cardW = Math.min(w - 28, 620)
      const rows = []
      for (let i = 0; i < UPGRADES.length; i += 2) {
        const pair = UPGRADES.slice(i, i + 2)
        rows.push(row({ id: `shop-row-${i}`, style: { gap: 10 } }, pair.map(spec => {
          const lv = state.upgrades[spec.id]
          const maxed = lv >= spec.maxLevel
          const cost = upgradeCost(spec, lv)
          const affordable = !maxed && state.coins >= cost
          return boxNode({
            id: `lh-upg-${spec.id}`,
            style: { grow: 1, height: 66 },
            widget: {
              type: 'button',
              label: `${spec.name} ${maxed ? 'MAX' : `Lv${lv}→${lv + 1}`}`,
              subtitle: maxed ? spec.describe(lv) : `${cost}g · ${spec.short}`,
              pips: { filled: lv, total: spec.maxLevel },
              primary: affordable,
              disabled: !affordable,
              primitive: upgradeButtons[spec.id]
            }
          })
        })))
      }

      return overlay({ id: 'root', style: { anchor: 'fill' } }, [
        boxNode({ id: 'shop-scrim', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
        column({
          id: 'shop-modal',
          style: { anchor: 'center', width: cardW, padding: 20, gap: 10 },
          widget: { type: 'panel' }
        }, [
          row({ id: 'shop-head', style: { height: 32, align: 'center', gap: 10 } }, [
            boxNode({ id: 'shop-title', style: { grow: 1, height: 28 }, widget: { type: 'text', text: 'KEEPER WORKSHOP & GEAR', size: 19, weight: 800 } }),
            boxNode({ id: 'shop-coins', style: { width: 120, height: 28 }, widget: { type: 'text', text: `${state.coins}g`, size: 18, weight: 800, color: '#ffe17a', align: 'right', mono: true } })
          ]),
          boxNode({
            id: 'shop-sub',
            style: { height: 20 },
            widget: { type: 'text', text: `Goal: Upgrade Fresnel Lens to Lv 5 or guide 8 ships (Guided: ${state.shipsGuided}/8)`, size: 12, color: ui.theme.muted }
          }),
          ...rows,
          spacerNode(2),
          boxNode({
            id: 'lh-shop-close',
            style: { height: 42 },
            widget: { type: 'button', label: 'Back to Island (E)', primitive: closeShopBtn }
          })
        ])
      ])
    }

    if (screen === 'paused' || screen === 'victory') {
      const isWin = screen === 'victory'
      return overlay({ id: 'root', style: { anchor: 'fill' } }, [
        boxNode({ id: 'pause-scrim', style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
        column({
          id: 'pause-card',
          style: { anchor: 'center', width: Math.min(w - 32, 370), padding: 22, gap: 10 },
          widget: { type: 'panel' }
        }, [
          boxNode({ id: 'p-head', style: { height: 32 }, widget: { type: 'text', text: isWin ? 'MASTER KEEPER!' : 'WATCH PAUSED', size: 22, weight: 800, align: 'center', color: isWin ? '#ffe588' : ui.theme.text } }),
          boxNode({
            id: 'p-stats',
            style: { height: 42 },
            widget: {
              type: 'text',
              text: isWin
                ? `You guided ${state.shipsGuided} ships and earned ${state.totalEarned}g across ${state.day} tides!`
                : `Day ${state.day} · Gold: ${state.coins}g · Ships Guided: ${state.shipsGuided}`,
              size: 13,
              color: ui.theme.muted,
              align: 'center',
              wrap: true
            }
          }),
          boxNode({
            id: isWin ? 'lh-continue' : 'lh-resume',
            style: { height: 44 },
            widget: { type: 'button', label: isWin ? 'Keep Watching (Endless)' : 'Resume Watch', primary: true, primitive: isWin ? continueVictoryBtn : resumeBtn }
          }),
          boxNode({
            id: 'lh-mute',
            style: { height: 40 },
            widget: { type: 'button', label: audio.isMuted() ? 'Audio: MUTED' : 'Audio: ON', primitive: muteBtn }
          }),
          boxNode({
            id: 'lh-music',
            style: { height: 40 },
            widget: { type: 'button', label: audio.isMusicEnabled() ? 'Music: ON' : 'Music: OFF', primitive: musicBtn }
          }),
          boxNode({
            id: 'lh-new',
            style: { height: 40 },
            widget: { type: 'button', label: 'Reset & New Watch', primitive: newGameBtn }
          })
        ])
      ])
    }

    // Playing HUD buttons (top-right corner — gauges & world popups live on #lh-hud)
    const btnH = compact ? 38 : 42
    return overlay({ id: 'root', style: { anchor: 'fill' } }, [
      row({
        id: 'top-actions',
        style: { anchor: 'top-right', inset: 12, gap: 8, align: 'center', respectSafeArea: true }
      }, [
        boxNode({
          id: 'lh-shop',
          style: { width: compact ? 88 : 118, height: btnH },
          widget: { type: 'button', label: canBuy ? 'Gear * (E)' : 'Gear (E)', primary: canBuy || state.activePad === 'shop', primitive: shopBtn }
        }),
        boxNode({
          id: 'lh-music',
          style: { width: compact ? 76 : 96, height: btnH },
          widget: { type: 'button', label: audio.isMusicEnabled() ? 'Music ON' : 'Music OFF', primitive: musicBtn }
        }),
        boxNode({
          id: 'lh-menu',
          style: { width: compact ? 62 : 74, height: btnH },
          widget: { type: 'button', label: 'Menu', primitive: menuBtn }
        })
      ])
    ])
  }

  function paintGauge(p: HudPainter, x: number, y: number, w: number, h: number, ratio: number, fill: string, label: string) {
    const clamped = Math.max(0, Math.min(1, ratio))
    p.panel(x, y, w, h, { fill: '#0c1b23cc', stroke: '#5a889088', radius: 5 })
    if (clamped > 0.01) {
      p.panel(x + 2, y + 2, Math.max(4, (w - 4) * clamped), h - 4, { fill, radius: 3 })
    }
    p.text(label, x + 7, y + 3, { fill: '#f7f5e8', size: 11, weight: 700, mono: true })
  }

  function paintHud(p: HudPainter) {
    if (screen === 'title') return
    const w = p.width
    const h = p.height
    const compact = w < 640

    // 1. Diegetic world-space pad labels & floating popups (projected via `worldToScreen`!)
    if (screen === 'playing') {
      for (const pad of PADS) {
        const lift = pad.id === 'brazier' ? 1.55 : pad.id === 'fuel' ? 1.15 : 0.95
        const py = islandHeight(pad.x, pad.z) + lift
        const pt = scene.projectScreen(pad.x, py, pad.z, w, h)
        if (!pt) continue
        const label = pad.id === 'shop' && state.activePad === 'shop' ? '[E] OPEN GEAR' : pad.label
        const tw = Math.max(66, label.length * 7.2 + 12)
        p.panel(pt.x - tw / 2, pt.y - 11, tw, 20, { fill: '#0f2029b8', stroke: '#7eb2b366', radius: 4 })
        p.text(label, pt.x, pt.y - 6, { fill: '#eef5e6', size: 10, weight: 700, align: 'center', mono: true })
      }

      // Low fuel alert floating near lighthouse top
      if (state.fuel < 28) {
        const pt = scene.projectScreen(LIGHTHOUSE_POS.x, 7.6, LIGHTHOUSE_POS.z, w, h)
        if (pt) {
          const flash = Math.sin(state.time * 8) > 0
          p.panel(pt.x - 56, pt.y - 12, 112, 22, { fill: flash ? '#c93f32e0' : '#4a1d1ae0', stroke: '#ffaa88', radius: 5 })
          p.text(state.lampLit ? 'LOW FUEL!' : 'BEACON DARK!', pt.x, pt.y - 6, { fill: '#fff5e4', size: 11, weight: 800, align: 'center', mono: true })
        }
      }

      // Floating resource/coin popups
      for (const pop of state.popups) {
        const pt = scene.projectScreen(pop.x, pop.y, pop.z, w, h)
        if (!pt) continue
        p.text(pop.text, pt.x + 1, pt.y + 1, { fill: '#09131acc', size: 13, weight: 800, align: 'center', mono: true })
        p.text(pop.text, pt.x, pt.y, { fill: pop.color, size: 13, weight: 800, align: 'center', mono: true })
      }
    }

    // 2. Top-left Keeper Status Card (Coins, Pack, Fuel, Warmth)
    const cardW = compact ? Math.min(w - 24, 240) : 335
    p.panel(12, 12, cardW, compact ? 92 : 76, { fill: '#11232ce0', stroke: '#6ea3a688', radius: 7 })
    const cap = carryCapFor(state.upgrades.pack)
    p.text(`GOLD ${state.coins}g`, 22, 20, { fill: '#ffe17a', size: 15, weight: 800, mono: true })
    p.text(`PACK ${state.player.carry.length}/${cap}`, compact ? 132 : 148, 20, {
      fill: state.player.carry.length >= cap ? '#ff937d' : '#9cf2dc', size: 14, weight: 800, mono: true
    })
    if (!compact) {
      p.text(`SHIPS ${state.shipsGuided}/8`, 246, 21, { fill: '#d2e5e3', size: 12, weight: 700, mono: true })
    }

    const barW = compact ? 102 : 150
    const fuelColor = state.fuel < 25 ? '#e85d4a' : '#f2bb52'
    paintGauge(p, 22, 46, barW, 20, state.fuel / 100, fuelColor, `LAMP ${Math.round(state.fuel)}%`)

    const warmColor = state.player.warmth < 30 ? '#6bb7f5' : '#f0894a'
    paintGauge(p, 22 + barW + 10, 46, barW, 20, state.player.warmth / 100, warmColor, `WARM ${Math.round(state.player.warmth)}%`)

    // 3. Bottom-left Tide & Weather Telemetry Card
    const weatherMeta = WEATHER_LABELS[state.weather]
    const tideMeta = TIDE_LABELS[state.tidePhase]
    const tideNorm = Math.max(0, Math.min(1, (state.tideLevel + 0.22) / 0.72))
    const envW = compact ? 204 : 246
    p.panel(12, h - 78, envW, 66, { fill: '#11232ce0', stroke: '#6ea3a688', radius: 7 })
    p.text(`DAY ${state.day} · ${weatherMeta.text}`, 22, h - 69, { fill: weatherMeta.color, size: 12, weight: 800, mono: true })
    paintGauge(p, 22, h - 46, envW - 20, 22, tideNorm, tideMeta.color, `${tideMeta.text}`)

    // 4. Centered Event Banner
    if (state.banner && screen === 'playing') {
      const bw = Math.min(w - 40, Math.max(260, state.banner.text.length * 8.4 + 30))
      const bx = (w - bw) / 2
      const by = compact ? 114 : 96
      p.panel(bx, by, bw, 30, { fill: '#10212be6', stroke: state.banner.color, radius: 6 })
      p.text(state.banner.text, w / 2, by + 8, { fill: state.banner.color, size: 12, weight: 800, align: 'center', mono: true, maxWidth: bw - 16 })
    }

    // 5. Virtual Drag Joystick indicator (when pointer-dragging)
    const drag = stick.state()
    if (drag.active && screen === 'playing') {
      p.panel(drag.originX - 30, drag.originY - 30, 60, 60, { fill: '#162d3855', stroke: '#9cf2dc99', radius: 30 })
      const dx = drag.currentX - drag.originX
      const dy = drag.currentY - drag.originY
      const d = Math.hypot(dx, dy)
      const clamp = Math.min(28, d)
      const kx = drag.originX + (d > 1 ? (dx / d) * clamp : 0)
      const ky = drag.originY + (d > 1 ? (dy / d) * clamp : 0)
      p.panel(kx - 14, ky - 14, 28, 28, { fill: '#f0b154cc', stroke: '#fff2cc', radius: 14 })
    }
  }

  let lastUiCoins = -1
  let lastUiPad: string | null = null
  let lastW = 0, lastH = 0
  let hudTick = 0
  let lastRenderAt: number | undefined

  function renderUiNow() {
    const canvas = renderer.canvas
    const w = Math.max(1, canvas.clientWidth || canvas.width || 960)
    const h = Math.max(1, canvas.clientHeight || canvas.height || 540)
    lastW = w
    lastH = h
    ui.render(buildUiTree(w), { width: w, height: h, pixelRatio: Math.min(devicePixelRatio || 1, 2) })
    uiDirty = false
  }

  renderUiNow()

  Object.defineProperty(globalThis, '__ridgetopUi', {
    configurable: true,
    writable: true,
    value: {
      snapshot: () => ui.snapshot(),
      query: (filter?: { id?: string; kind?: string; state?: string; label?: string }) => ui.query(filter),
      act: (id: string, action: string, payload?: unknown) => {
        renderUiNow()
        const ok = ui.act(id, action, payload)
        uiDirty = true
        renderUiNow()
        return ok
      },
      rects: () => Object.fromEntries(ui.rects),
      state: () => ({
        screen,
        day: state.day,
        coins: state.coins,
        fuel: Math.round(state.fuel),
        warmth: Math.round(state.player.warmth),
        carry: state.player.carry.length,
        weather: state.weather,
        tidePhase: state.tidePhase,
        shipsGuided: state.shipsGuided,
        upgrades: state.upgrades
      })
    }
  })

  const stop = fixedLoop({
    update(dt) {
      if (screen === 'title') {
        // Animate gentle world preview behind title card
        state.time += dt
        state.beamYaw = (state.beamYaw + dt * 1.1) % (Math.PI * 2)
        audio.update(state, dt, false)
        return
      }
      if (screen !== 'playing') {
        audio.update(state, dt, false)
        return
      }

      stepGame(state, readMoveInput(), dt)
      scene.consumeVfx(state)
      audio.update(state, dt, true)

      if (state.victory && !victoryShown) {
        victoryShown = true
        persistSave(page.storage, state)
        setScreen('victory')
        return
      }

      saveTimer += dt
      if (saveTimer >= 6) {
        saveTimer = 0
        persistSave(page.storage, state)
      }

      if (state.coins !== lastUiCoins || state.activePad !== lastUiPad) {
        lastUiCoins = state.coins
        lastUiPad = state.activePad
        uiDirty = true
      }
    },
    render(_alpha, now) {
      const canvas = renderer.canvas
      const w = Math.max(1, canvas.clientWidth)
      const h = Math.max(1, canvas.clientHeight)
      const rawDt = lastRenderAt === undefined ? 1 / 60 : Math.min(0.05, Math.max(0, (now - lastRenderAt) / 1000))
      lastRenderAt = now
      const renderDt = screen === 'paused' ? 0 : rawDt
      scene.render(state, renderDt, screen === 'title')

      if (screen === 'playing') hudTick++
      const hudKey = screen === 'title'
        ? 'title'
        : screen === 'playing'
          ? `playing:${hudRev}:${hudTick >> 1}`
          : `${screen}:${hudRev}`
      hud.render(canvas, hudKey, paintHud)

      if (uiDirty || ui.dirty || w !== lastW || h !== lastH) {
        renderUiNow()
      }
    }
  })

  page.lifecycle({
    hide(persisted) {
      persistSave(page.storage, state)
      audio.suspend()
      if (persisted) return
      shopKeyController.abort()
      stop()
      ui.dispose()
      stick.dispose()
      controls.dispose()
      scene.dispose()
      renderer.dispose()
      audio.close()
    },
    restore() {
      audio.resume()
    }
  })
}

start().catch(error => console.error(error))
