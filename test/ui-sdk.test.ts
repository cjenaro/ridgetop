import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boxNode, buttonPrimitive, column, createMachine, createUiAgent, dialogPrimitive,
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
})
