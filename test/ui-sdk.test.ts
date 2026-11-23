import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boxNode, buttonPrimitive, column, createCanvasUi, createMachine, createUiAgent, dialogPrimitive,
  menuPrimitive, overlay, resolveLayout, row, selectPrimitive, sliderPrimitive, spacerNode, togglePrimitive
} from '../framework/ui.ts'

test('createMachine enforces explicit transitions, guards, and actions', () => {
  const events: string[] = []
  const machine = createMachine<'idle' | 'active' | 'locked', { count: number }, { type: 'START' } | { type: 'LOCK' } | { type: 'RESET' }>({
    initial: 'idle',
    context: { count: 0 },
    states: {
      idle: {
        on: {
          START: { target: 'active', action: ctx => { ctx.count++ } },
          LOCK: { target: 'locked', guard: ctx => ctx.count > 0 }
        }
      },
      active: {
        enter: () => events.push('enter:active'),
        exit: () => events.push('exit:active'),
        on: {
          RESET: 'idle',
          LOCK: 'locked'
        }
      },
      locked: {}
    }
  })

  // Guard blocks locking before count > 0
  assert.equal(machine.send('LOCK'), 'idle')
  assert.equal(machine.send('START'), 'active')
  assert.equal(machine.context.count, 1)
  assert.equal(machine.send('RESET'), 'idle')
  assert.equal(machine.send('LOCK'), 'locked')
  // Locked has no transitions out
  assert.equal(machine.send('START'), 'locked')
  assert.deepEqual(events, ['enter:active', 'exit:active'])
})

test('opt-in headless UI primitives enforce state invariants and support agent snapshot/query/act', () => {
  let presses = 0
  let toggled: boolean | undefined
  let selected = ''
  let slid = 0
  let confirmed = ''
  let backed = 0

  const btn = buttonPrimitive.create({ id: 'play', label: 'Play', onPress: () => { presses++ } })
  const toggle = togglePrimitive.create({ id: 'sound', label: 'Sound', checked: true, onChange: v => { toggled = v } })
  const select = selectPrimitive.create({
    id: 'quality',
    label: 'Quality',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'med', label: 'Medium', disabled: true },
      { value: 'high', label: 'High' }
    ],
    value: 'low',
    onChange: v => { selected = v }
  })
  const slider = sliderPrimitive.create({ id: 'vol', label: 'Volume', min: 0, max: 100, step: 10, value: 50, onChange: v => { slid = v } })
  const menu = menuPrimitive.create({
    id: 'main-menu',
    items: [{ id: 'play' }, { id: 'locked', disabled: true }, { id: 'sound' }],
    onConfirm: id => { confirmed = id },
    onBack: () => { backed++ }
  })
  const dialog = dialogPrimitive.create({ id: 'pause-dialog' })

  const agent = createUiAgent(() => [btn, toggle, select, slider, menu, dialog])

  // Disabled button cannot fire onPress
  btn.api.setDisabled(true)
  assert.equal(agent.act('play', 'press'), false)
  assert.equal(presses, 0)
  btn.api.setDisabled(false)
  assert.equal(agent.act('play', 'press'), true)
  assert.equal(presses, 1)

  // Toggle transitions on -> off
  assert.equal(toggle.api.checked(), true)
  agent.act('sound', 'toggle')
  assert.equal(toggle.api.checked(), false)
  assert.equal(toggled, false)

  // Select skips disabled option 'med'
  agent.act('quality', 'next')
  assert.equal(select.api.value(), 'high')
  assert.equal(selected, 'high')

  // Slider clamps and snaps to step
  agent.act('vol', 'step', 2)
  assert.equal(slider.api.value(), 70)
  assert.equal(slid, 70)
  slider.api.set(140)
  assert.equal(slider.api.value(), 100)

  // Menu skips disabled items and recovers focus when active item disables
  assert.equal(menu.api.focusedId(), 'play')
  menu.api.move(1)
  assert.equal(menu.api.focusedId(), 'sound')
  menu.api.confirm()
  assert.equal(confirmed, 'sound')
  menu.api.setItems([{ id: 'play' }, { id: 'sound', disabled: true }])
  assert.equal(menu.api.focusedId(), 'play')
  menu.api.back()
  assert.equal(backed, 1)

  // Dialog open/close
  assert.equal(dialog.api.isOpen(), false)
  agent.act('pause-dialog', 'open')
  assert.equal(dialog.api.isOpen(), true)

  assert.equal(agent.query({ kind: 'dialog', state: 'open' }).length, 1)
  assert.equal(agent.snapshot().length, 6)
})

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
})

test('createMachine preserves re-entrant transitions and select/slider handle edge cases', () => {
  // Re-entrant setDisabled(true) inside button onPress must not be clobbered
  const btn = buttonPrimitive.create({
    id: 'once', label: 'Once',
    onPress() { btn.api.setDisabled(true) }
  })
  btn.api.pointerDown()
  btn.api.pointerUp()
  assert.equal(btn.state, 'disabled')

  // Dialog onOpenChange sees updated isOpen() state
  let sawOpen = false
  const dlg = dialogPrimitive.create({
    id: 'dlg',
    onOpenChange() { sawOpen = dlg.api.isOpen() }
  })
  dlg.api.open()
  assert.equal(sawOpen, true)

  // Select clears stale value when options become empty and does not skip index 0
  const sel = selectPrimitive.create({
    id: 's', label: 'S',
    options: [{ value: 'a', label: 'A', disabled: true }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }],
    value: 'a'
  })
  sel.api.next()
  assert.equal(sel.api.value(), 'b')
  sel.api.setOptions([])
  assert.equal(sel.api.value(), '')

  // Slider ignores NaN without firing onChange
  let sliderChanges = 0
  const sl = sliderPrimitive.create({
    id: 'sl', label: 'Vol', min: 0, max: 10, step: 1, value: 5,
    onChange() { sliderChanges++ }
  })
  sl.api.set(Number.NaN)
  sl.api.setRatio(Number.NaN)
  assert.equal(sl.api.value(), 5)
  assert.equal(sliderChanges, 0)

  // Re-entrant transition inside exit() must not be clobbered
  const exitMachine = createMachine<'a' | 'b' | 'c', Record<string, never>, { type: 'GO_B' } | { type: 'GO_C' }>({
    initial: 'a',
    context: {},
    states: {
      a: { exit: () => { exitMachine.send('GO_C') }, on: { GO_B: 'b', GO_C: 'c' } },
      b: {},
      c: {}
    }
  })
  assert.equal(exitMachine.send('GO_B'), 'c')

  // One-shot button act('press') returns true even when onPress disables it; disabled actions return false
  const oneShot = buttonPrimitive.create({ id: 'oneshot', label: 'Once', onPress() { oneShot.api.setDisabled(true) } })
  assert.equal(oneShot.act('press'), true)
  assert.equal(oneShot.state, 'disabled')
  assert.equal(oneShot.act('press'), false)
  assert.equal(oneShot.act('focus'), false)

  // selectPrimitive.setOptions fires onChange and closes dropdown when choosing empty-string value ''
  let emptySelected: string | undefined
  const emptySel = selectPrimitive.create({
    id: 'empty-sel', label: 'Empty',
    options: [{ value: 'x', label: 'X' }, { value: '', label: 'None' }],
    value: 'x',
    onChange(v) { emptySelected = v }
  })
  emptySel.api.open()
  emptySel.api.setOptions([{ value: 'x', label: 'X' }, { value: '', label: 'None' }], '')
  assert.equal(emptySelected, '')
  assert.equal(emptySel.state, 'closed')
  emptySel.api.select('')
  const disabledSel = selectPrimitive.create({ id: 'ds', label: 'D', options: [{ value: 'a', label: 'A' }], disabled: true })
  assert.equal(disabledSel.act('open'), false)
  assert.equal(disabledSel.act('close'), false)

  // menuPrimitive.act('focus', ...) returns false for disabled/missing items
  const m = menuPrimitive.create({ id: 'm', items: [{ id: 'ok' }, { id: 'no', disabled: true }] })
  assert.equal(m.act('focus', 'no'), false)
  assert.equal(m.act('focus', 'missing'), false)
  assert.equal(m.act('focus', 'ok'), true)
})

test('createCanvasUi handles non-Array GamepadList, hidden hold release, scrim blocking, slider primitive drag, and viewport scaling', () => {
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const prevWin = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const prevDoc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const fakeWin = new EventTarget()
  const fakeDoc = Object.assign(new EventTarget(), { hidden: false })
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => ({ length: 1, 0: { connected: false } }) },
    configurable: true
  })
  Object.defineProperty(globalThis, 'window', { value: fakeWin, configurable: true })
  Object.defineProperty(globalThis, 'document', { value: fakeDoc, configurable: true })
  try {
    const target = new EventTarget()
    const noop = () => {}
    const ctx = {
      save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
      fill: noop, stroke: noop, clip: noop, fillRect: noop, clearRect: noop, fillText: noop,
      drawImage: noop, setTransform: noop, measureText: () => ({ width: 10 }),
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left', textBaseline: 'middle', globalAlpha: 1
    }
    const canvas = Object.assign(target, {
      clientWidth: 400, clientHeight: 200, width: 400, height: 200, style: { cursor: '' },
      getContext: () => ctx,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
      setPointerCapture() { throw new Error('synthetic pointer') }
    }) as unknown as HTMLCanvasElement

    const ui = createCanvasUi(canvas)
    const holdStates: boolean[] = []
    const sl = sliderPrimitive.create({ id: 'vol', label: 'Vol', min: 0, max: 100, step: 10, value: 0 })

    // Scrim blocks hits to underlying controls; custom viewport (800x400) scales clicks from 400x200 CSS box
    const buildTree = (hideHold: boolean, withScrim: boolean) => overlay({ id: 'root', style: { anchor: 'fill' } }, [
      boxNode({
        id: 'hold-btn', hidden: hideHold, style: { anchor: 'top-left', width: 200, height: 100 },
        widget: { type: 'button', label: 'Gas', onHold: active => holdStates.push(active) }
      }),
      boxNode({
        id: 'vol', style: { anchor: 'bottom-left', width: 400, height: 60 },
        widget: { type: 'slider', label: 'Vol', ratio: sl.api.ratio(), primitive: sl }
      }),
      boxNode({ id: 'scrim', hidden: !withScrim, style: { anchor: 'fill' }, widget: { type: 'panel', scrim: true } })
    ])

    ui.render(buildTree(false, true), { width: 800, height: 400, pixelRatio: 1 })
    assert.equal(ui.hitTest(50, 50), undefined, 'scrim must block hits to controls underneath')
    assert.equal(ui.activate('vol'), false, 'scrim must block programmatic/keyboard activation underneath')

    ui.render(buildTree(false, false), { width: 800, height: 400, pixelRatio: 1 })
    // Multi-touch onHold: lifting one of two fingers must not fire onHold(false) early
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'touch', pointerId: 7, clientX: 50, clientY: 25 }))
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'touch', pointerId: 8, clientX: 55, clientY: 25 }))
    assert.deepEqual(holdStates, [true])
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 8, clientX: 55, clientY: 25 }))
    assert.deepEqual(holdStates, [true], 'second finger lifting must keep hold active')
    // Hide the hold button while held, then release last pointer -> onHold(false) must still fire
    ui.render(buildTree(true, false), { width: 800, height: 400, pixelRatio: 1 })
    const up = Object.assign(new Event('pointerup'), { pointerId: 7, clientX: 50, clientY: 25 })
    canvas.dispatchEvent(up)
    assert.deepEqual(holdStates, [true, false])

    // Drag slider backed by sliderPrimitive with pointer 1; pointer 2 must not hijack it
    const slDown = Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 185 })
    canvas.dispatchEvent(slDown) // CSS x=100 -> virtual x=200 of 400 = 50% -> 50
    assert.equal(sl.api.value(), 50)
    const otherMove = Object.assign(new Event('pointermove'), { pointerId: 2, clientX: 0, clientY: 185 })
    canvas.dispatchEvent(otherMove)
    assert.equal(sl.api.value(), 50, 'second pointer must not hijack active slider drag')
    const slMove = Object.assign(new Event('pointermove'), { pointerId: 1, clientX: 160, clientY: 185 })
    canvas.dispatchEvent(slMove) // CSS x=160 -> virtual x=320 of 400 = 80% -> 80
    assert.equal(sl.api.value(), 80)
    // Even if a scrim opens mid-drag (hiding the slider), releasing pointer 1 must still call dragEnd()
    ui.render(buildTree(true, true), { width: 800, height: 400, pixelRatio: 1 })
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, clientX: 160, clientY: 185 }))
    assert.equal(sl.state, 'focused')

    // Dispose resets cursor style
    ui.render(buildTree(false, false), { width: 800, height: 400, pixelRatio: 1 })
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 9, clientX: 50, clientY: 25 }))
    assert.equal(canvas.style.cursor, 'pointer')
    ui.dispose()
    assert.equal(canvas.style.cursor, '')
  } finally {
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav)
    if (prevWin) Object.defineProperty(globalThis, 'window', prevWin)
    else delete (globalThis as Record<string, unknown>).window
    if (prevDoc) Object.defineProperty(globalThis, 'document', prevDoc)
    else delete (globalThis as Record<string, unknown>).document
  }
})
