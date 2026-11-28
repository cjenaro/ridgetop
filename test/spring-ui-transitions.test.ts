import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SPRING_PRESETS, createSpring, stepSpring
} from '../packages/ridgetop/framework/animation.ts'
import { isTestingActive, setTestingActive } from '../packages/ridgetop/framework/testing-runtime.ts'
import { boxNode, createCanvasUi, overlay } from '../packages/ridgetop/framework/ui.ts'
import type { LayoutNode } from '../packages/ridgetop/framework/ui.ts'

test('stepSpring converges accurately for underdamped, critically damped, and overdamped configs', () => {
  // Underdamped (bouncy) should overshoot target=1 before settling
  const bouncy = createSpring(0, 'bouncy')
  bouncy.setTarget(1)
  let maxVal = 0
  for (let i = 0; i < 180; i++) {
    bouncy.step(1 / 60)
    if (bouncy.value > maxVal) maxVal = bouncy.value
  }
  assert.ok(maxVal > 1.02, `expected bouncy spring to overshoot > 1.02, got ${maxVal}`)
  assert.equal(bouncy.settled, true)
  assert.equal(bouncy.value, 1)

  // Critically damped (damping = 2 * sqrt(k * m)) should not overshoot
  const critical = createSpring(0, { stiffness: 400, damping: 40, mass: 1 })
  critical.setTarget(1)
  let critMax = 0
  for (let i = 0; i < 180; i++) {
    critical.step(1 / 60)
    if (critical.value > critMax) critMax = critical.value
  }
  assert.ok(critMax <= 1 + 1e-4, `expected critically damped spring not to overshoot, got ${critMax}`)
  assert.equal(critical.settled, true)
  assert.equal(critical.value, 1)

  // Overdamped should converge monotonically without overshoot
  const over = createSpring(0, { stiffness: 100, damping: 30, mass: 1 })
  over.setTarget(1)
  let prev = 0
  for (let i = 0; i < 240; i++) {
    over.step(1 / 60)
    assert.ok(over.value >= prev - 1e-6)
    assert.ok(over.value <= 1 + 1e-6)
    prev = over.value
  }
  assert.equal(over.settled, true)
  assert.equal(over.value, 1)

  // Unconditional stability on huge dt spikes
  const spike = { value: 0, velocity: 0 }
  const settled = stepSpring(spike, 1, 5.0, SPRING_PRESETS.snappy)
  assert.equal(settled, true)
  assert.equal(spike.value, 1)
  assert.equal(spike.velocity, 0)

  // Impulse & snap
  bouncy.impulse(12)
  assert.equal(bouncy.settled, false)
  bouncy.step(1 / 60)
  assert.ok(bouncy.value > 1)
  bouncy.snap(0.5)
  assert.equal(bouncy.settled, true)
  assert.equal(bouncy.value, 0.5)
  assert.equal(bouncy.velocity, 0)
})

function createMockCanvas(width = 400, height = 240) {
  const target = new EventTarget()
  const noop = () => {}
  const ops: string[] = []
  let alpha = 1
  const ctx = {
    save: () => ops.push('save'),
    restore: () => { ops.push('restore'); alpha = 1 },
    translate: (x: number, y: number) => ops.push(`translate:${Math.round(x)},${Math.round(y)}`),
    scale: (x: number, y: number) => ops.push(`scale:${x.toFixed(2)},${y.toFixed(2)}`),
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop,
    rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop, fillRect: noop, clearRect: noop, fillText: noop,
    drawImage: noop, setTransform: noop, measureText: () => ({ width: 10 }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: 'left',
    textBaseline: 'middle', imageSmoothingEnabled: true,
    get globalAlpha() { return alpha },
    set globalAlpha(v: number) { alpha = v; ops.push(`alpha:${v.toFixed(2)}`) }
  }
  const canvas = Object.assign(target, {
    clientWidth: width,
    clientHeight: height,
    width,
    height,
    style: { cursor: '' },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    setPointerCapture() { throw new Error('synthetic pointer') }
  }) as unknown as HTMLCanvasElement
  return { canvas, ops }
}

test('createCanvasUi animates keyed nodes entering and exiting with springs and paints overlays on top', () => {
  const { canvas, ops } = createMockCanvas()
  const prevTesting = isTestingActive()
  setTestingActive(false)
  try {
    const ui = createCanvasUi(canvas)
    let showModal = true
    const buildTree = (): LayoutNode => overlay({ id: 'root', style: { anchor: 'fill' } }, [
      ...(showModal ? [boxNode({
        id: 'test-modal',
        transition: { preset: 'pop', spring: 'snappy', exitSpring: 'stiff', scale: 0.9 },
        style: { anchor: 'center', width: 200, height: 100 },
        widget: { type: 'button', label: 'Confirm', onPress: () => {} }
      })] : [])
    ])

    let overlayDraws = 0
    ui.setOverlay(() => { overlayDraws++ }, 'ov:1')

    // First frame starts entering
    ui.sync(buildTree, { width: 400, height: 240, force: true })
    assert.equal(ui.animating, true)
    assert.equal(overlayDraws, 1)
    assert.ok(ops.some(op => op.startsWith('scale:')), 'expected pop transition to apply scale transform')

    // Step until enter settles
    for (let i = 0; i < 120 && ui.animating; i++) {
      ui.render(buildTree(), { width: 400, height: 240, dt: 1 / 60 })
    }
    assert.equal(ui.animating, false)
    assert.equal(ui.snapshot().length, 1)

    // Remove node -> begins exiting as non-interactive ghost
    showModal = false
    ui.sync(buildTree, { width: 400, height: 240, dirty: true, dt: 1 / 60 })
    assert.equal(ui.animating, true)
    assert.equal(ui.snapshot().length, 0, 'exiting ghost must not be interactive')

    // Re-add mid-exit -> seamlessly interrupts back to entering
    showModal = true
    ui.sync(buildTree, { width: 400, height: 240, dirty: true, dt: 1 / 60 })
    assert.equal(ui.animating, true)
    assert.equal(ui.snapshot().length, 1)

    // Step exit all the way to completion
    showModal = false
    ui.sync(buildTree, { width: 400, height: 240, dirty: true, dt: 1 / 60 })
    for (let i = 0; i < 120 && ui.animating; i++) {
      ui.render(buildTree(), { width: 400, height: 240, dt: 1 / 60 })
    }
    assert.equal(ui.animating, false)

    // Testing mode snaps transitions immediately
    setTestingActive(true)
    showModal = true
    ui.render(buildTree(), { width: 400, height: 240, dt: 1 / 60 })
    assert.equal(ui.animating, false)

    ui.dispose()
  } finally {
    setTestingActive(prevTesting)
  }
})
