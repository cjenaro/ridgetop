import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boxNode, column, createCanvasUi, createUiTheme, overlay, resolveLayout, row, spacerNode
} from '../packages/ridgetop/framework/ui.ts'
import type { LayoutNode } from '../packages/ridgetop/framework/ui.ts'

function createFakeDomEnv(gamepads: unknown = { length: 0 }) {
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const prevWin = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const prevDoc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const prevRaf = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  const prevCancelRaf = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')

  const fakeWin = new EventTarget()
  const fakeDoc = Object.assign(new EventTarget(), { hidden: false })
  let currentPads = gamepads
  const rafQueue = new Map<number, FrameRequestCallback>()
  let nextRafId = 1

  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => currentPads },
    configurable: true
  })
  Object.defineProperty(globalThis, 'window', { value: fakeWin, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: (cb: FrameRequestCallback) => {
      const id = nextRafId++
      rafQueue.set(id, cb)
      return id
    },
    configurable: true
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: (id: number) => { rafQueue.delete(id) },
    configurable: true
  })

  function flushRaf(now: number) {
    const entries = Array.from(rafQueue.entries())
    rafQueue.clear()
    for (const [, cb] of entries) cb(now)
  }

  function createCanvas(cssWidth = 400, cssHeight = 200) {
    const target = new EventTarget()
    const noop = () => {}
    const ctx = {
      save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
      rect: noop, roundRect: noop,
      fill: noop, stroke: noop, clip: noop, fillRect: noop, clearRect: noop, fillText: noop,
      drawImage: noop, setTransform: noop, measureText: () => ({ width: 10 }),
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left',
      textBaseline: 'middle', globalAlpha: 1, imageSmoothingEnabled: true
    }
    return Object.assign(target, {
      clientWidth: cssWidth,
      clientHeight: cssHeight,
      width: cssWidth,
      height: cssHeight,
      style: { cursor: '' },
      getContext: () => ctx,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: cssWidth, height: cssHeight }),
      setPointerCapture() { throw new Error('synthetic pointer') }
    }) as unknown as HTMLCanvasElement
  }

  return {
    fakeWin,
    fakeDoc,
    createCanvas,
    setGamepads(next: unknown) { currentPads = next },
    flushRaf,
    restore() {
      if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav)
      if (prevWin) Object.defineProperty(globalThis, 'window', prevWin)
      else delete (globalThis as Record<string, unknown>).window
      if (prevDoc) Object.defineProperty(globalThis, 'document', prevDoc)
      else delete (globalThis as Record<string, unknown>).document
      if (prevRaf) Object.defineProperty(globalThis, 'requestAnimationFrame', prevRaf)
      else delete (globalThis as Record<string, unknown>).requestAnimationFrame
      if (prevCancelRaf) Object.defineProperty(globalThis, 'cancelAnimationFrame', prevCancelRaf)
      else delete (globalThis as Record<string, unknown>).cancelAnimationFrame
    }
  }
}

test('resolveLayout computes exact flex, overlay, anchor, and safe-area rectangles without a DOM', () => {
  const tree = overlay({ id: 'root', style: { anchor: 'fill' } }, [
    row({ id: 'bar', style: { anchor: 'top', width: 400, height: 50, inset: 10, gap: 10, padding: 5, respectSafeArea: true } }, [
      boxNode({ id: 'left', style: { width: 80, height: 40 } }),
      spacerNode(1),
      boxNode({ id: 'right', style: { width: 100, height: 40 } })
    ]),
    column({ id: 'modal', style: { anchor: 'center', width: 200, padding: 12, gap: 8 } }, [
      boxNode({ id: 'btn-a', style: { height: 40 } }),
      boxNode({ id: 'hidden-btn', hidden: true, style: { height: 40 } }),
      boxNode({ id: 'btn-b', style: { height: 40 } })
    ]),
    boxNode({ id: 'corner', style: { anchor: 'bottom-right', width: 60, height: 60, inset: 12, respectSafeArea: true } })
  ])

  const rects = resolveLayout(tree, { width: 800, height: 600 }, { top: 20, right: 16, bottom: 24, left: 16 })

  // Top bar respects safeArea.top (20) + inset (10) = 30
  assert.deepEqual(rects.get('bar'), { x: 200, y: 30, width: 400, height: 50 })
  assert.deepEqual(rects.get('left'), { x: 205, y: 35, width: 80, height: 40 })
  assert.deepEqual(rects.get('right'), { x: 495, y: 35, width: 100, height: 40 })

  // Modal hides hidden-btn, so total height = 12 + 40 + 8 + 40 + 12 = 112, centered at y = (600-112)/2 = 244
  assert.deepEqual(rects.get('modal'), { x: 300, y: 244, width: 200, height: 112 })
  assert.deepEqual(rects.get('btn-a'), { x: 312, y: 256, width: 176, height: 40 })
  assert.equal(rects.has('hidden-btn'), false)
  assert.deepEqual(rects.get('btn-b'), { x: 312, y: 304, width: 176, height: 40 })

  // Bottom-right corner respects safeArea.right (16) + inset (12) and safeArea.bottom (24) + inset (12)
  assert.deepEqual(rects.get('corner'), { x: 800 - 16 - 12 - 60, y: 600 - 24 - 12 - 60, width: 60, height: 60 })

  // Explicit width/height still respect minWidth/maxWidth/minHeight/maxHeight
  const clamped = resolveLayout(row({ id: 'r', style: { width: 800, height: 100 } }, [
    boxNode({ id: 'c', style: { width: 500, maxWidth: 200, height: 90, maxHeight: 50 } })
  ]), { width: 800, height: 100 })
  assert.deepEqual(clamped.get('c'), { x: 0, y: 0, width: 200, height: 50 })

  // Single-edge anchored overlay children must not subtract anchored inset twice
  const toastTree = overlay({ id: 'root', style: { anchor: 'fill' } }, [
    boxNode({ id: 'toast', style: { anchor: 'bottom', width: 320, height: 32, inset: [8, 380], respectSafeArea: true } })
  ])
  const toastRects = resolveLayout(toastTree, { width: 1280, height: 720 }, { top: 8, right: 8, bottom: 8, left: 8 })
  assert.deepEqual(toastRects.get('toast'), { x: 480, y: 720 - 8 - 380 - 32, width: 320, height: 32 })
})

test('createCanvasUi derives snapshot, query, and act directly from 100% of interactive layout nodes', () => {
  const env = createFakeDomEnv()
  try {
    const canvas = env.createCanvas(800, 600)
    const ui = createCanvasUi(canvas, { theme: createUiTheme({ accent: '#efac62' }) })

    let presses = 0
    let playDisabled = false
    let soundOn = true
    let quality = 'low'
    let volume = 0.5
    let cardClicks = 0
    let cardSelected = true
    const holds: boolean[] = []
    const qualityOptions = [
      { value: 'low', label: 'Low' },
      { value: 'med', label: 'Medium', disabled: true },
      { value: 'high', label: 'High' }
    ] as const

    function buildTree(): LayoutNode {
      const currentQuality = qualityOptions.find(o => o.value === quality) ?? qualityOptions[0]
      return overlay({ id: 'root', style: { anchor: 'fill' } }, [
        column({ id: 'menu', style: { anchor: 'center', width: 320, padding: 16, gap: 8 }, widget: { type: 'panel' } }, [
          boxNode({ id: 'heading', style: { height: 24 }, widget: { type: 'text', text: 'Settings' } }),
          boxNode({
            id: 'play', style: { height: 40 },
            widget: { type: 'button', label: 'Play', primary: true, disabled: playDisabled, onPress: () => { presses++ } }
          }),
          boxNode({
            id: 'sound', style: { height: 40 },
            widget: { type: 'toggle', label: 'Sound', checked: soundOn, onToggle: (next: boolean) => { soundOn = next } }
          }),
          boxNode({
            id: 'quality', style: { height: 40 },
            widget: {
              type: 'select',
              label: 'Quality',
              value: quality,
              valueLabel: currentQuality.label,
              options: qualityOptions,
              onSelect: (next: string) => { quality = next }
            }
          }),
          boxNode({
            id: 'vol', style: { height: 36 },
            widget: { type: 'slider', label: 'Volume', ratio: volume, step: 0.1, onChange: (r: number) => { volume = Math.round(r * 100) / 100 } }
          }),
          boxNode({
            id: 'spell-card', style: { height: 56 },
            widget: {
              type: 'button',
              label: 'Fireball',
              subtitle: 'AOE 14 DMG',
              selected: cardSelected,
              draw: () => {},
              onPress: () => { cardClicks++; cardSelected = !cardSelected }
            }
          }),
          boxNode({
            id: 'boost-hold', style: { height: 40 },
            widget: { type: 'button', label: 'Boost', onHold: (active: boolean) => holds.push(active) }
          }),
          boxNode({
            id: 'hidden-btn', hidden: true, style: { height: 40 },
            widget: { type: 'button', label: 'Hidden', onPress: () => { presses += 100 } }
          })
        ])
      ])
    }

    const render = () => ui.render(buildTree(), { width: 800, height: 600, pixelRatio: 1 })
    render()

    // Every non-hidden interactive widget is visible in snapshot() without any external primitive registration
    const snap = ui.snapshot()
    assert.deepEqual(snap.map(s => s.id), ['play', 'sound', 'quality', 'vol', 'spell-card', 'boost-hold'])

    const playSnap = ui.query({ id: 'play' })[0]
    assert.equal(playSnap.kind, 'button')
    assert.equal(playSnap.role, 'button')
    assert.equal(playSnap.label, 'Play')
    assert.equal(playSnap.state, 'idle')
    assert.equal(playSnap.disabled, false)
    assert.ok(playSnap.bounds.width === 288 && playSnap.bounds.height === 40)
    assert.deepEqual(playSnap.actions, ['press', 'focus'])

    const cardSnap = ui.query({ label: 'Fireball' })[0]
    assert.equal(cardSnap.id, 'spell-card')
    assert.equal(cardSnap.subtitle, 'AOE 14 DMG')
    assert.equal(cardSnap.selected, true)
    assert.equal(cardSnap.state, 'selected')

    // Button press + disabled blocking
    playDisabled = true
    render()
    assert.equal(ui.query({ id: 'play' })[0].state, 'disabled')
    assert.deepEqual(ui.query({ id: 'play' })[0].actions, [])
    assert.equal(ui.act('play', 'press'), false)
    assert.equal(ui.act('play', 'focus'), false)
    assert.equal(presses, 0)

    playDisabled = false
    render()
    assert.equal(ui.act('play', 'press'), true)
    assert.equal(presses, 1)

    // Custom drawn card press
    assert.equal(ui.act('spell-card', 'press'), true)
    assert.equal(cardClicks, 1)
    render()
    assert.equal(ui.query({ id: 'spell-card' })[0].state, 'idle')

    // Hold button actions
    assert.equal(ui.act('boost-hold', 'hold', true), true)
    assert.equal(ui.act('boost-hold', 'hold', false), true)
    assert.deepEqual(holds, [true, false])
    assert.equal(ui.act('boost-hold', 'hold', 'invalid'), false)

    // Toggle actions: toggle + set(boolean) + invalid payload rejection
    assert.equal(ui.query({ kind: 'toggle' })[0].checked, true)
    assert.equal(ui.query({ kind: 'toggle' })[0].state, 'checked')
    assert.equal(ui.act('sound', 'toggle'), true)
    render()
    assert.equal(soundOn, false)
    assert.equal(ui.query({ id: 'sound' })[0].state, 'unchecked')
    assert.equal(ui.act('sound', 'set', true), true)
    assert.equal(soundOn, true)
    assert.equal(ui.act('sound', 'set', 'yes'), false)

    // Select actions: next/prev skip disabled option 'med'; direct select validates disabled/missing options
    assert.equal(ui.query({ id: 'quality' })[0].value, 'low')
    assert.equal(ui.act('quality', 'next'), true)
    render()
    assert.equal(quality, 'high')
    assert.equal(ui.query({ id: 'quality' })[0].value, 'high')
    assert.equal(ui.act('quality', 'prev'), true)
    render()
    assert.equal(quality, 'low')
    assert.equal(ui.act('quality', 'select', 'med'), false, 'disabled option must be rejected')
    assert.equal(ui.act('quality', 'select', 'ultra'), false, 'unknown option must be rejected')
    assert.equal(ui.act('quality', 'select', 'high'), true)
    render()
    assert.equal(quality, 'high')

    // Slider actions: set, increment, decrement, step, clamping, NaN rejection
    assert.equal(ui.act('vol', 'increment'), true)
    assert.equal(volume, 0.6)
    render()
    assert.equal(ui.act('vol', 'decrement', 2), true)
    assert.equal(volume, 0.4)
    render()
    assert.equal(ui.act('vol', 'set', 1.5), true)
    assert.equal(volume, 1)
    render()
    assert.equal(ui.act('vol', 'set', Number.NaN), false)
    assert.equal(volume, 1)
    assert.equal(ui.act('vol', 'step', -3), true)
    assert.equal(volume, 0.7)

    // Focus/blur reflected in snapshot state and query filter
    assert.equal(ui.act('play', 'focus'), true)
    assert.equal(ui.query({ state: 'focused' })[0]?.id, 'play')
    assert.equal(ui.act('play', 'blur'), true)
    assert.equal(ui.query({ state: 'focused' }).length, 0)

    // Hidden node cannot be queried or acted upon
    assert.equal(ui.query({ id: 'hidden-btn' }).length, 0)
    assert.equal(ui.act('hidden-btn', 'press'), false)

    ui.dispose()
  } finally {
    env.restore()
  }
})

test('createCanvasUi handles pointer, multi-touch hold release, slider drag isolation, scrim blocking, and viewport scaling', () => {
  const env = createFakeDomEnv({ length: 1, 0: { connected: false } })
  try {
    const canvas = env.createCanvas(400, 200)
    const ui = createCanvasUi(canvas)
    const holdStates: boolean[] = []
    let sliderRatio = 0
    let dragEnds = 0
    let modalClicks = 0

    // Scrim blocks hits to underlying controls; custom viewport (800x400) scales clicks from 400x200 CSS box
    const buildTree = (hideHold: boolean, withScrim: boolean): LayoutNode => overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({
        id: 'hold-btn', hidden: hideHold, style: { anchor: 'top-left', width: 200, height: 100 },
        widget: { type: 'button', label: 'Gas', onHold: (active: boolean) => holdStates.push(active) }
      }),
      boxNode({
        id: 'vol', style: { anchor: 'bottom-left', width: 400, height: 60 },
        widget: {
          type: 'slider',
          label: 'Vol',
          ratio: sliderRatio,
          onChange: (r: number) => { sliderRatio = Math.round(r * 100) / 100 },
          onDragEnd: () => { dragEnds++ }
        }
      }),
      boxNode({ id: 'scrim', hidden: !withScrim, style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } }),
      boxNode({
        id: 'modal-ok', hidden: !withScrim, style: { anchor: 'center', width: 160, height: 50 },
        widget: { type: 'button', label: 'OK', onPress: () => { modalClicks++ } }
      })
    ])

    ui.render(buildTree(false, true), { width: 800, height: 400, pixelRatio: 1 })
    assert.equal(ui.hitTest(50, 50), undefined, 'scrim must block hits to controls underneath')
    assert.equal(ui.activate('vol'), false, 'scrim must block programmatic/keyboard activation underneath')
    assert.equal(ui.act('vol', 'set', 0.5), false, 'scrim must block act() underneath')
    assert.deepEqual(ui.snapshot().map(s => s.id), ['modal-ok'], 'snapshot() should only expose active layer above scrim')
    assert.equal(ui.act('modal-ok', 'press'), true)
    assert.equal(modalClicks, 1)

    ui.render(buildTree(false, false), { width: 800, height: 400, pixelRatio: 1 })
    // Multi-touch onHold: lifting one of two fingers must not fire onHold(false) early
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'touch', pointerId: 7, clientX: 50, clientY: 25 }))
    assert.equal(ui.query({ id: 'hold-btn' })[0].pressed, true)
    assert.equal(ui.query({ id: 'hold-btn' })[0].state, 'pressed')
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'touch', pointerId: 8, clientX: 55, clientY: 25 }))
    assert.deepEqual(holdStates, [true])
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 8, clientX: 55, clientY: 25 }))
    assert.deepEqual(holdStates, [true], 'second finger lifting must keep hold active')
    // Hide the hold button while held, then release last pointer -> onHold(false) must still fire
    ui.render(buildTree(true, false), { width: 800, height: 400, pixelRatio: 1 })
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 7, clientX: 50, clientY: 25 }))
    assert.deepEqual(holdStates, [true, false])

    // Drag slider with pointer 1; pointer 2 must not hijack it
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 185 }))
    assert.equal(sliderRatio, 0.5) // CSS x=100 -> virtual x=200 of 400
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 2, clientX: 0, clientY: 185 }))
    assert.equal(sliderRatio, 0.5, 'second pointer must not hijack active slider drag')
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, clientX: 160, clientY: 185 }))
    assert.equal(sliderRatio, 0.8) // CSS x=160 -> virtual x=320 of 400
    // Even if a scrim opens mid-drag, releasing pointer 1 must still invoke onDragEnd()
    ui.render(buildTree(true, true), { width: 800, height: 400, pixelRatio: 1 })
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, clientX: 160, clientY: 185 }))
    assert.equal(dragEnds, 1)

    // Hover sets cursor style; re-render hiding hovered widget clears hover & cursor
    ui.render(buildTree(false, false), { width: 800, height: 400, pixelRatio: 1 })
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 9, clientX: 50, clientY: 25 }))
    assert.equal(canvas.style.cursor, 'pointer')
    assert.equal(ui.query({ id: 'hold-btn' })[0].hovered, true)
    ui.render(buildTree(true, false), { width: 800, height: 400, pixelRatio: 1 })
    assert.equal(canvas.style.cursor, '')

    // blocksPoint detects interactive widgets and blocksPointer panels, while allowing clicks on open viewport
    const trayTree = overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({
        id: 'tray', style: { anchor: 'bottom', width: 400, height: 80 },
        widget: { type: 'panel', blocksPointer: true }
      }, [
        boxNode({
          id: 'card', style: { width: 120, height: 60 },
          widget: {
            type: 'button', label: 'Fireball', subtitle: 'AOE 14 DMG',
            accent: '#5ca8ff', badge: { text: '2 AP', fill: '#5ca8ff', color: '#0c1622' }
          }
        })
      ]),
      boxNode({
        id: 'story', style: { anchor: 'top', width: 300, height: 80 },
        widget: { type: 'text', text: 'Line one\nLine two', wrap: true }
      })
    ])
    ui.render(trayTree, { width: 800, height: 400, pixelRatio: 1 })
    assert.equal(ui.blocksPoint(400, 360), true, 'blocksPointer panel should block world clicks')
    assert.equal(ui.blocksPoint(100, 100), false, 'open viewport should not block world clicks')

    ui.dispose()
    assert.equal(canvas.style.cursor, '')
  } finally {
    env.restore()
  }
})

test('createCanvasUi supports keyboard and gamepad navigation across buttons, toggles, selects, and sliders', () => {
  const env = createFakeDomEnv()
  try {
    const canvas = env.createCanvas(640, 360)
    let navEnabled = true
    let backCount = 0
    let resumeCount = 0
    let sound = false
    let modeIdx = 0
    const modes = ['Solo', 'Co-op', 'Versus'] as const
    let ratio = 0.5

    const ui = createCanvasUi(canvas, {
      keyboardEnabled: () => navEnabled,
      onBack: () => { backCount++ }
    })

    const render = () => ui.render(overlay({ id: 'root', style: { anchor: 'fill' } }, [
      column({ id: 'menu', style: { anchor: 'center', width: 280, gap: 8 } }, [
        boxNode({ id: 'resume', style: { height: 40 }, widget: { type: 'button', label: 'Resume', onPress: () => { resumeCount++ } } }),
        boxNode({ id: 'locked', style: { height: 40 }, widget: { type: 'button', label: 'Locked', disabled: true } }),
        boxNode({ id: 'hold', style: { height: 40 }, widget: { type: 'button', label: 'Hold', onHold: () => {} } }),
        boxNode({ id: 'sound', style: { height: 40 }, widget: { type: 'toggle', label: 'Sound', checked: sound, onToggle: (v: boolean) => { sound = v } } }),
        boxNode({
          id: 'mode', style: { height: 40 },
          widget: {
            type: 'select',
            label: 'Mode',
            valueLabel: modes[modeIdx],
            onNext: () => { modeIdx = (modeIdx + 1) % modes.length },
            onPrev: () => { modeIdx = (modeIdx - 1 + modes.length) % modes.length }
          }
        }),
        boxNode({ id: 'vol', style: { height: 36 }, widget: { type: 'slider', label: 'Vol', ratio, step: 0.25, onChange: (r: number) => { ratio = r } } })
      ])
    ]), { width: 640, height: 360, pixelRatio: 1 })
    render()

    const pressKey = (code: string, extra: Record<string, unknown> = {}) => {
      env.fakeWin.dispatchEvent(Object.assign(new Event('keydown'), {
        code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...extra
      }))
    }

    // ArrowDown focuses 'resume', skipping disabled 'locked' and hold button 'hold' on next step
    pressKey('ArrowDown')
    assert.equal(ui.query({ state: 'focused' })[0]?.id, 'resume')
    pressKey('Enter')
    assert.equal(resumeCount, 1)

    pressKey('ArrowDown')
    assert.equal(ui.query({ state: 'focused' })[0]?.id, 'sound')
    pressKey('Space')
    assert.equal(sound, true)
    render()

    pressKey('Tab')
    assert.equal(ui.query({ state: 'focused' })[0]?.id, 'mode')
    pressKey('ArrowRight')
    assert.equal(modeIdx, 1)
    pressKey('ArrowLeft')
    assert.equal(modeIdx, 0)

    pressKey('ArrowDown')
    assert.equal(ui.query({ state: 'focused' })[0]?.id, 'vol')
    pressKey('ArrowRight')
    assert.equal(ratio, 0.75)
    render()

    // keyboardEnabled() = false suppresses keyboard events
    navEnabled = false
    pressKey('ArrowLeft')
    assert.equal(ratio, 0.75)
    navEnabled = true

    // Gamepad navigation & back callback (with non-Array GamepadList)
    const pad = {
      connected: true,
      axes: [0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false }))
    }
    env.setGamepads({ length: 1, 0: pad })
    env.fakeWin.dispatchEvent(new Event('gamepadconnected'))

    // Press D-pad left on focused slider -> steps down
    pad.buttons[14].pressed = true
    env.flushRaf(100)
    assert.equal(ratio, 0.5)
    pad.buttons[14].pressed = false
    env.flushRaf(120)

    // Press D-pad down (wraps to 'resume') and A button (button 0) to confirm, B button (button 1) for onBack
    pad.buttons[13].pressed = true
    env.flushRaf(400)
    assert.equal(ui.query({ state: 'focused' })[0]?.id, 'resume')
    pad.buttons[13].pressed = false
    pad.buttons[0].pressed = true
    pad.buttons[1].pressed = true
    env.flushRaf(450)
    assert.equal(resumeCount, 2)
    assert.equal(backCount, 1)

    ui.dispose()
  } finally {
    env.restore()
  }
})

test('createCanvasUi paints HUD underlay before widgets with key memoization and state isolation', () => {
  const env = createFakeDomEnv()
  try {
    const ops: string[] = []
    const target = new EventTarget()
    const ctx = {
      save: () => ops.push('save'),
      restore: () => ops.push('restore'),
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      rect: () => {},
      roundRect: () => ops.push('hud:roundRect'),
      fill: () => {},
      stroke: () => {},
      clip: () => {},
      fillRect: () => {},
      clearRect: () => ops.push('clear'),
      fillText: (text: string) => ops.push('text:' + text),
      drawImage: () => {},
      setTransform: () => {},
      measureText: () => ({ width: 10 }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'middle',
      globalAlpha: 1,
      imageSmoothingEnabled: true
    }
    const canvas = Object.assign(target, {
      clientWidth: 800,
      clientHeight: 450,
      width: 800,
      height: 450,
      style: { cursor: '' },
      getContext: () => ctx,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }),
      setPointerCapture() { throw new Error('synthetic pointer') }
    }) as unknown as HTMLCanvasElement

    const ui = createCanvasUi(canvas)
    const tree: LayoutNode = overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({ id: 'menu', style: { anchor: 'top-right', width: 80, height: 36 }, widget: { type: 'button', label: 'Menu' } })
    ])

    let measuredW = 0
    let measuredH = 0
    assert.equal(ui.setUnderlay(p => {
      measuredW = p.width
      measuredH = p.height
      p.panel(12, 12, 160, 64, { fill: '#112233', radius: 6 })
      p.text('SPEED 99', 20, 20, { fill: '#ffffff', size: 14 })
    }, 'hud:1'), true)
    assert.equal(ui.dirty, true)

    ui.render(tree, { width: 800, height: 450, pixelRatio: 1 })
    assert.equal(ui.dirty, false)
    assert.equal(measuredW, 800)
    assert.equal(measuredH, 450)
    const clearIdx = ops.indexOf('clear')
    const hudTextIdx = ops.indexOf('text:SPEED 99')
    const menuTextIdx = ops.indexOf('text:Menu')
    assert.ok(clearIdx >= 0 && hudTextIdx > clearIdx && menuTextIdx > hudTextIdx,
      `Expected clear -> HUD underlay -> UI widget order, got ${ops.join(', ')}`)

    // Same key keeps dirty=false (no redundant redraw) while refreshing closure for future UI repaints
    assert.equal(ui.setUnderlay(p => {
      p.text('SPEED 99B', 20, 20, { fill: '#ffffff', size: 14 })
    }, 'hud:1'), false)
    assert.equal(ui.dirty, false)

    // Changing key marks dirty=true and repaints updated HUD
    ops.length = 0
    assert.equal(ui.setUnderlay(p => {
      p.text('SPEED 120', 20, 20, { fill: '#ffffff', size: 14 })
    }, 'hud:2'), true)
    assert.equal(ui.dirty, true)
    ui.render(tree, { width: 800, height: 450, pixelRatio: 1 })
    assert.ok(ops.includes('text:SPEED 120'))

    // Per-render viewport.underlay override works cleanly
    ops.length = 0
    ui.render(tree, {
      width: 800,
      height: 450,
      pixelRatio: 1,
      underlay: p => p.text('OVERRIDE', 10, 10, { fill: '#fff', size: 12 })
    })
    assert.ok(ops.includes('text:OVERRIDE'))
    assert.ok(!ops.includes('text:SPEED 120'))

    // Clearing underlay via null removes HUD painting
    ops.length = 0
    assert.equal(ui.setUnderlay(null, 'overlay'), true)
    ui.render(tree, { width: 800, height: 450, pixelRatio: 1 })
    assert.ok(!ops.includes('text:SPEED 120'))
    assert.ok(ops.includes('text:Menu'))

    ui.dispose()
  } finally {
    env.restore()
  }
})
