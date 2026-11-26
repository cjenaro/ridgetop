import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createGameServer } from '../server.ts'
import { createGame } from '../packages/ridgetop/tools/create-game.ts'
import {
  bindActionControls, box, createArtKit, createArtRecipe, createMeshPool, createRig, createSpriteAtlas,
  fixedLoop, instances, isTestingPaused, modelFromArtRecipe, multiply, octahedron, orthographic,
  perspective, projectPoint, renderRig, setTestingActive, setTestingPaused, STEP, view
} from '../packages/ridgetop/framework/index.ts'
import {
  checkPin, checkReview, checkSpriteManifest, createArtRecipeEditor, createMemoryReviewStore,
  createTestingStudioSession, pickRenderedScene, pickSpriteDraws, resolveTestingUrlActivation
} from '../packages/ridgetop/framework/art-review.ts'
import { createGameHost } from '../packages/ridgetop/framework/server.ts'
import { shouldAutoMountTestingStudio } from '../packages/ridgetop/framework/testing-studio.ts'
import { boxNode, createCanvasUi } from '../packages/ridgetop/framework/ui.ts'
import {
  captureSourceSite, getLastSpriteDraws, recognizeAssetFromPick, recordFrame, recordSpriteDraw,
  registerHudRegion, registerTestingHooks, resetTestingRuntime
} from '../packages/ridgetop/framework/testing-runtime.ts'
import type { ArtRecipe } from '../packages/ridgetop/framework/index.ts'
import type { SpriteDrawRecord } from '../packages/ridgetop/framework/testing-runtime.ts'

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDLsAAAAASUVORK5CYII='

function withGlobals(overrides: Record<string, unknown>, run: () => void | Promise<void>) {
  const previous = new Map<string, PropertyDescriptor | undefined>()
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const restore = () => {
    for (const [key, desc] of previous) {
      if (desc) Object.defineProperty(globalThis, key, desc)
      else delete (globalThis as Record<string, unknown>)[key]
    }
  }
  try {
    const result = run()
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).finally(restore)
    }
    restore()
  } catch (error) {
    restore()
    throw error
  }
}

test('fixedLoop pauses simulation and prevents catch-up lag spikes while testing mode is paused', t => {
  t.after(() => {
    setTestingPaused(false)
    setTestingActive(false)
    resetTestingRuntime()
  })

  let now = 1000
  let nextId = 1
  const callbacks = new Map<number, (ts: number) => void>()

  withGlobals({
    performance: { now: () => now },
    requestAnimationFrame: (cb: (ts: number) => void) => {
      const id = nextId++
      callbacks.set(id, cb)
      return id
    },
    cancelAnimationFrame: (id: number) => { callbacks.delete(id) }
  }, () => {
    const step = (deltaMs: number) => {
      now += deltaMs
      const pending = Array.from(callbacks.entries())
      callbacks.clear()
      for (const [, cb] of pending) cb(now)
    }

    let updates = 0
    let renders = 0
    const stop = fixedLoop({
      update() { updates++ },
      render() { renders++ }
    })

    // Normal execution advances updates & renders
    step(STEP * 1000 * 2.1)
    assert.equal(updates, 2)
    assert.equal(renders, 1)

    // Pause via testing runtime -> updates & renders freeze even across a 600ms pause
    setTestingPaused(true)
    assert.equal(isTestingPaused(), true)
    step(300)
    step(300)
    assert.equal(updates, 2)
    assert.equal(renders, 1)

    // Resume -> next 1-step frame performs exactly 1 update (no accumulated lag spike)
    setTestingPaused(false)
    assert.equal(isTestingPaused(), false)
    step(STEP * 1000 * 1.05)
    assert.equal(updates, 3)
    assert.equal(renders, 2)

    stop()
  })
})

test('bindActionControls restarts gamepad polling after Testing Mode pause/resume', t => {
  t.after(() => {
    setTestingPaused(false)
    setTestingActive(false)
    resetTestingRuntime()
  })

  const winTarget = new EventTarget()
  const docTarget = new EventTarget()
  Object.defineProperty(docTarget, 'hidden', { value: false, configurable: true })
  let nextId = 1
  const rafMap = new Map<number, (ts: number) => void>()
  let startPressed = false
  const fakePad = {
    connected: true,
    buttons: Array.from({ length: 16 }, (_, idx) => ({
      get pressed() { return idx === 9 ? startPressed : false },
      get value() { return idx === 9 && startPressed ? 1 : 0 }
    })),
    axes: [0, 0, 0, 0]
  }
  let pauses = 0

  withGlobals({
    window: winTarget,
    document: docTarget,
    Element: class {},
    navigator: { getGamepads: () => [fakePad] },
    requestAnimationFrame: (cb: (ts: number) => void) => {
      const id = nextId++
      rafMap.set(id, cb)
      return id
    },
    cancelAnimationFrame: (id: number) => { rafMap.delete(id) }
  }, () => {
    const flushRaf = () => {
      const entries = Array.from(rafMap.entries())
      rafMap.clear()
      for (const [, cb] of entries) cb(0)
    }

    const controls = bindActionControls({
      keys: { KeyA: 'left' },
      enabled: () => false,
      onPause: () => { pauses++ }
    })
    // Initial loop is scheduled because pad is connected
    assert.equal(rafMap.size, 1)
    flushRaf()
    assert.equal(rafMap.size, 1)

    // Testing pause stops the pad loop
    setTestingPaused(true)
    flushRaf()
    assert.equal(rafMap.size, 0)

    // Resuming testing mode must restart the pad loop even while enabled() === false
    setTestingPaused(false)
    assert.equal(rafMap.size, 1)
    startPressed = true
    flushRaf()
    assert.equal(pauses, 1)
    controls.dispose()
  })
})

test('bindActionControls clears held state and ignores keyboard input while testing mode is paused', t => {
  t.after(() => {
    setTestingPaused(false)
    setTestingActive(false)
    resetTestingRuntime()
  })

  const winTarget = new EventTarget()
  const docTarget = new EventTarget()
  Object.defineProperty(docTarget, 'hidden', { value: false, configurable: true })

  withGlobals({
    window: winTarget,
    document: docTarget,
    Element: class FakeElement {},
    navigator: {}
  }, () => {
    let presses = 0
    const controls = bindActionControls<'right'>({
      keys: { ArrowRight: 'right' },
      enabled: () => true,
      gamepad: false,
      onPress() { presses++ }
    })

    const makeKey = (type: string, code: string) => {
      const ev = new Event(type) as Event & { code: string; repeat: boolean; preventDefault(): void }
      ev.code = code
      ev.repeat = false
      ev.preventDefault = () => {}
      return ev
    }

    winTarget.dispatchEvent(makeKey('keydown', 'ArrowRight'))
    assert.equal(controls.active('right'), true)
    assert.equal(presses, 1)

    // Pausing testing mode immediately clears held keys and ignores new keydowns
    setTestingPaused(true)
    assert.equal(controls.active('right'), false)
    winTarget.dispatchEvent(makeKey('keydown', 'ArrowRight'))
    assert.equal(controls.active('right'), false)
    assert.equal(presses, 1)

    setTestingPaused(false)
    assert.equal(controls.active('right'), false)
    winTarget.dispatchEvent(makeKey('keydown', 'ArrowRight'))
    assert.equal(controls.active('right'), true)
    assert.equal(presses, 2)

    controls.dispose()
  })
})

test('createCanvasUi ignores pointer and keyboard interaction while testing mode is paused', t => {
  t.after(() => {
    setTestingPaused(false)
    setTestingActive(false)
    resetTestingRuntime()
  })

  const winTarget = new EventTarget()
  const docTarget = new EventTarget()
  Object.defineProperty(docTarget, 'hidden', { value: false, configurable: true })

  const canvasListeners = new Map<string, ((e: any) => void)[]>()
  const fakeCtx = {
    setTransform() {}, clearRect() {}, save() {}, restore() {}, clip() {},
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
    fillRect() {}, fillText() {}, drawImage() {}, measureText: () => ({ width: 20 })
  }
  const fakeCanvas = {
    width: 200,
    height: 100,
    clientWidth: 200,
    clientHeight: 100,
    style: { cursor: '' },
    getContext: () => fakeCtx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    addEventListener(type: string, fn: (e: any) => void) {
      const list = canvasListeners.get(type) ?? []
      list.push(fn)
      canvasListeners.set(type, list)
    }
  } as unknown as HTMLCanvasElement

  withGlobals({
    window: winTarget,
    document: docTarget,
    navigator: {},
    devicePixelRatio: 1
  }, () => {
    let clicks = 0
    const ui = createCanvasUi(fakeCanvas)
    ui.render(boxNode({
      id: 'play-btn',
      style: { width: 120, height: 40 },
      widget: { type: 'button', label: 'Play', onPress() { clicks++ } }
    }), { width: 200, height: 100 })

    const fire = (type: string, clientX: number, clientY: number) => {
      const ev = { button: 0, pointerType: 'mouse', pointerId: 1, clientX, clientY, preventDefault() {}, stopPropagation() {} }
      for (const fn of canvasListeners.get(type) ?? []) fn(ev)
    }

    fire('pointerdown', 20, 20)
    fire('pointerup', 20, 20)
    assert.equal(clicks, 1)

    setTestingPaused(true)
    fire('pointerdown', 20, 20)
    fire('pointerup', 20, 20)
    const keyEv = Object.assign(new Event('keydown'), { code: 'Enter', repeat: false, preventDefault() {} })
    winTarget.dispatchEvent(keyEv)
    assert.equal(clicks, 1)

    setTestingPaused(false)
    fire('pointerdown', 20, 20)
    fire('pointerup', 20, 20)
    assert.equal(clicks, 2)
    ui.dispose()
  })
})

test('pickRenderedScene picks frontmost instances accurately for both orthographic and perspective cameras', t => {
  t.after(() => {
    setTestingActive(false)
    resetTestingRuntime()
  })
  setTestingActive(true)

  // 1. Orthographic camera: front opaque box occludes back box; alpha box in front of another wins
  const orthoCam = multiply(orthographic(6, 6, 0.1, 30), view([0, 0, 10], [0, 0, 0]))
  const opaqueBatch = instances(box, { meta: { label: 'blocks' } })
  opaqueBatch.add([0, 0, -2], [1.2, 1.2, 1.2], 0, [0.2, 0.4, 0.8, 1], 0, { kind: 'mesh', asset: 'back-box', part: 'body' })
  opaqueBatch.add([0, 0, 1.5], [1.0, 1.0, 1.0], 0, [0.9, 0.5, 0.2, 1], 0, { kind: 'mesh', asset: 'front-box', part: 'body' })

  const alphaBatch = instances(octahedron, { blend: 'alpha', meta: { label: 'gems' } })
  alphaBatch.add([1.8, 0, 2], [0.6, 0.6, 0.6], 0, [0.3, 0.9, 0.8, 0.6], 0.5, { kind: 'mesh', asset: 'gem', part: 'crystal' })

  const centerHit = pickRenderedScene([opaqueBatch, alphaBatch], orthoCam, 200, 200, 0.5, 0.5)
  assert.ok(centerHit)
  assert.equal(centerHit.batchIndex, 0)
  assert.equal(centerHit.instanceIndex, 1)
  assert.equal(centerHit.tag?.asset, 'front-box')

  const gemNdc = projectPoint(orthoCam, 1.8, 0, 2)
  const gemHit = pickRenderedScene([opaqueBatch, alphaBatch], orthoCam, 200, 200, (gemNdc[0] + 1) / 2, (1 - gemNdc[1]) / 2)
  assert.ok(gemHit)
  assert.equal(gemHit.batchIndex, 1)
  assert.equal(gemHit.tag?.asset, 'gem')

  // Empty corner misses
  assert.equal(pickRenderedScene([opaqueBatch, alphaBatch], orthoCam, 200, 200, 0.02, 0.02), undefined)
  // Out of bounds returns undefined
  assert.equal(pickRenderedScene([opaqueBatch, alphaBatch], orthoCam, 200, 200, -0.1, 0.5), undefined)

  // 2. Perspective camera: depth-tested picking across off-center positions
  const perspCam = multiply(perspective(Math.PI / 3, 16 / 9, 0.1, 100), view([0, 2.5, 9], [0, 0, 0]))
  const perspBatch = instances(box)
  perspBatch.add([-2.2, 0, 0], [1, 1, 1], 0, [0.8, 0.2, 0.2, 1], 0, { kind: 'mesh', asset: 'left-pillar' })
  perspBatch.add([2.0, 0, -3], [1.2, 1.2, 1.2], 0, [0.2, 0.8, 0.3, 1], 0, { kind: 'mesh', asset: 'far-right' })
  perspBatch.add([2.0, 0, 2.5], [0.9, 0.9, 0.9], 0, [0.9, 0.9, 0.2, 1], 0, { kind: 'mesh', asset: 'near-right' })

  const leftNdc = projectPoint(perspCam, -2.2, 0, 0)
  const leftHit = pickRenderedScene([perspBatch], perspCam, 640, 360, (leftNdc[0] + 1) / 2, (1 - leftNdc[1]) / 2)
  assert.equal(leftHit?.tag?.asset, 'left-pillar')

  const nearNdc = projectPoint(perspCam, 2.0, 0, 2.5)
  const nearHit = pickRenderedScene([perspBatch], perspCam, 640, 360, (nearNdc[0] + 1) / 2, (1 - nearNdc[1]) / 2)
  assert.equal(nearHit?.tag?.asset, 'near-right')
})

test('zero-tag recognition auto-groups co-located meshes, attributes source sites, and recognizes ArtKit + Rig assemblies', t => {
  t.after(() => {
    setTestingActive(false)
    resetTestingRuntime()
  })

  // Inactive testing mode has zero source-attribution overhead
  setTestingActive(false)
  assert.equal(captureSourceSite(), undefined)
  const inactiveBatch = instances(box)
  assert.equal(inactiveBatch.meta, undefined)

  // Activate testing mode -> creation-site attribution and auto-tagging work automatically
  setTestingActive(true)
  const cam = multiply(perspective(Math.PI / 3, 1, 0.1, 60), view([0, 3, 10], [0, 0.5, 0]))

  // Untagged multi-part code prop (base + tower + crystal cap) + giant floor slab + far prop
  const boxBatch = instances(box)
  const capBatch = instances(octahedron)
  const floorBatch = instances(box)
  // Large floor slab
  floorBatch.add([0, -0.5, 0], [30, 0.5, 30], 0, [0.2, 0.3, 0.25, 1])
  // Co-located prop at x = 0
  boxBatch.add([0, 0.4, 0], [1, 0.8, 1], 0, [0.7, 0.5, 0.3, 1])
  boxBatch.add([0, 1.1, 0], [0.7, 0.7, 0.7], 0, [0.8, 0.6, 0.4, 1])
  capBatch.add([0, 1.75, 0], [0.35, 0.45, 0.35], 0, [0.3, 0.9, 0.8, 1], 0.5)
  // Separate distant prop at x = 4
  boxBatch.add([4, 0.5, 0], [1, 1, 1], 0, [0.9, 0.2, 0.2, 1])

  const allBatches = [floorBatch, boxBatch, capBatch]
  const targetNdc = projectPoint(cam, 0, 0.4, 0)
  const hit = pickRenderedScene(allBatches, cam, 300, 300, (targetNdc[0] + 1) / 2, (1 - targetNdc[1]) / 2)
  assert.ok(hit)
  assert.equal(hit.tag, undefined)

  const recognized = recognizeAssetFromPick(allBatches, cam, hit)
  assert.equal(recognized.kind, 'mesh')
  assert.equal(recognized.stats.instanceCount, 3, 'groups the 3 touching prop parts while excluding distant prop and floor')
  assert.equal(recognized.stats.batchCount, 2)
  assert.equal(recognized.stats.triangleCount, 12 + 12 + 8)
  assert.ok(recognized.colors.length === 3)
  assert.ok(recognized.screenBounds !== null)
  assert.match(recognized.sourceSite, /testing-studio\.test\.ts:\d+/)
  assert.ok(recognized.members.some(m => m.shape === 'box'))
  assert.ok(recognized.members.some(m => m.shape === 'octahedron'))

  // ArtKit auto-tagging
  const kit = createArtKit()
  const group = kit.group()
  group.add('ranger', [0, 0, 0])
  const rangerNdc = projectPoint(cam, 0, 0.5, 0)
  const rangerHit = pickRenderedScene(group.batches, cam, 300, 300, (rangerNdc[0] + 1) / 2, (1 - rangerNdc[1]) / 2)
  assert.ok(rangerHit)
  const recRanger = recognizeAssetFromPick(group.batches, cam, rangerHit)
  assert.equal(recRanger.kind, 'model')
  assert.equal(recRanger.asset, 'ranger')
  assert.equal(recRanger.stats.instanceCount, kit.model('ranger').parts.length)

  // Rig auto-tagging
  const rig = createRig([
    { id: 'torso', parts: [{ name: 'chest', mesh: box, scale: [0.8, 0.9, 0.5], color: [0.2, 0.6, 0.8, 1] }] },
    { id: 'head', parent: 'torso', pivot: [0, 0.7, 0], parts: [{ name: 'helm', mesh: octahedron, scale: [0.4, 0.4, 0.4], color: [0.9, 0.8, 0.3, 1] }] }
  ], 'hero-rig')
  const pool = createMeshPool()
  renderRig(rig, { position: [0, 0.5, 0] }, {}, pool)
  const rigNdc = projectPoint(cam, 0, 0.5, 0)
  const rigHit = pickRenderedScene(pool.batches, cam, 300, 300, (rigNdc[0] + 1) / 2, (1 - rigNdc[1]) / 2)
  assert.ok(rigHit)
  const recRig = recognizeAssetFromPick(pool.batches, cam, rigHit)
  assert.equal(recRig.kind, 'rig')
  assert.equal(recRig.asset, 'hero-rig')
  assert.equal(recRig.stats.instanceCount, 2)
  assert.ok(recRig.members.some(m => m.joint === 'torso' && m.part === 'chest'))
  assert.ok(recRig.members.some(m => m.joint === 'head' && m.part === 'helm'))
  assert.match(recRig.sourceSite, /testing-studio\.test\.ts:\d+/)
})

test('2D sprite draw capture and reverse-order alpha hit-testing handle overlap, transparency, and horizontal flip', async t => {
  t.after(() => {
    setTestingActive(false)
    resetTestingRuntime()
  })
  setTestingActive(true)

  // Construct a 4x4 RGBA sprite buffer where only the LEFT half (x = 0,1) is opaque
  const makeHalfOpaque = () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 2; x++) {
        const off = (y * 4 + x) * 4
        pixels[off] = 255; pixels[off + 1] = 200; pixels[off + 2] = 100; pixels[off + 3] = 255
      }
    }
    return pixels
  }
  const fullOpaque = new Uint8ClampedArray(4 * 4 * 4).fill(255)

  const fakeCanvas = { width: 100, height: 100 } as unknown as HTMLCanvasElement
  const backDraw: SpriteDrawRecord = {
    canvas: fakeCanvas,
    atlas: {
      id: 'back-atlas',
      src: 'back.png',
      frameWidth: 4,
      frameHeight: 4,
      rows: 1,
      columns: 1,
      clips: { idle: { column: 0, frames: 1, frameMs: 120 } },
      pixels: fullOpaque,
      imageWidth: 4,
      imageHeight: 4
    },
    clip: 'idle',
    frame: 0,
    column: 0,
    row: 0,
    flip: false,
    rect: { x: 20, y: 20, width: 40, height: 40 },
    canvasWidth: 100,
    canvasHeight: 100
  }
  // Front sprite overlaps the same rect, with flip: true -> opaque half moves to RIGHT half (x in [40..60])!
  const frontDraw: SpriteDrawRecord = {
    canvas: fakeCanvas,
    atlas: {
      id: 'front-atlas',
      src: 'front.png',
      frameWidth: 4,
      frameHeight: 4,
      rows: 1,
      columns: 1,
      clips: { run: { column: 0, frames: 1, frameMs: 100 } },
      pixels: makeHalfOpaque(),
      imageWidth: 4,
      imageHeight: 4
    },
    clip: 'run',
    frame: 0,
    column: 0,
    row: 0,
    flip: true,
    rect: { x: 20, y: 20, width: 40, height: 40 },
    canvasWidth: 100,
    canvasHeight: 100
  }

  const draws = [backDraw, frontDraw]
  // Right side of overlap (u = 0.55 -> x = 55) hits flipped front sprite's opaque half
  const hitFront = pickSpriteDraws(draws, 0.55, 0.4)
  assert.equal(hitFront?.draw.atlas.id, 'front-atlas')
  assert.equal(hitFront?.index, 1)

  // Left side of overlap (u = 0.25 -> x = 25) is transparent on flipped front sprite -> falls through to back sprite!
  const hitBack = pickSpriteDraws(draws, 0.25, 0.4)
  assert.equal(hitBack?.draw.atlas.id, 'back-atlas')
  assert.equal(hitBack?.index, 0)

  // Outside both sprites misses
  assert.equal(pickSpriteDraws(draws, 0.9, 0.9), undefined)

  // Verify createSpriteAtlas records draws and clears on begin() when testing mode is active
  const stubCtx = {
    imageSmoothingEnabled: true,
    clearRect() {},
    save() {},
    translate() {},
    scale() {},
    restore() {},
    drawImage() {}
  }
  const layerCanvas = {
    width: 200,
    height: 100,
    getContext: () => stubCtx
  } as unknown as HTMLCanvasElement
  const sheetImage = { width: 64, height: 32 } as unknown as HTMLCanvasElement
  const atlas = await createSpriteAtlas(layerCanvas, {
    image: sheetImage,
    manifest: { src: 'hero.png', frameWidth: 32, frameHeight: 32, clips: { run: { column: 0, frames: 2, frameMs: 100 } } }
  })
  atlas.begin(layerCanvas)
  assert.equal(getLastSpriteDraws().length, 0)
  atlas.drawClip('run', 120, [0, 0], { height: 0.4 })
  const recorded = getLastSpriteDraws()
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].clip, 'run')
  assert.equal(recorded[0].frame, 1)
  assert.equal(recorded[0].column, 1)
  assert.equal(recorded[0].atlas.src, 'hero.png')
  assert.match(recorded[0].atlas.sourceSite ?? '', /testing-studio\.test\.ts:\d+/)
  atlas.begin(layerCanvas)
  assert.equal(getLastSpriteDraws().length, 0)
})

test('createGameHost({ testing: true }) injects boot script, serves studio assets, and mounts loopback-only /__testing/*', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-testing-host-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const html = '<!doctype html><html><body><canvas id="world"></canvas></body></html>'
  await writeFile(join(folder, 'index.html'), html)
  const root = pathToFileURL(folder + '/')

  // 1. Testing enabled host
  const testingApp = createGameHost({
    root,
    files: ['index.html'],
    aliases: { '/': 'index.html' },
    testing: true
  })
  t.after(() => testingApp.close())
  await new Promise<void>(resolve => testingApp.server.listen(0, '127.0.0.1', resolve))
  const addr = testingApp.server.address()
  assert.ok(addr && typeof addr === 'object')
  const origin = `http://127.0.0.1:${addr.port}`

  const pageRes = await fetch(origin + '/')
  assert.equal(pageRes.status, 200)
  const pageText = await pageRes.text()
  assert.ok(pageText.includes('<script type="module" src="/framework/testing-studio.js"></script>'))
  assert.ok(pageText.indexOf('/framework/testing-studio.js') < pageText.indexOf('</body>'))
  const headRes = await fetch(origin + '/', { method: 'HEAD' })
  assert.equal(headRes.status, 200)
  assert.equal(Number(headRes.headers.get('content-length')), Buffer.byteLength(pageText, 'utf8'))

  for (const [assetPath, expectedType] of [
    ['/framework/testing-protocol.js', 'text/javascript'],
    ['/framework/testing-recognition.js', 'text/javascript'],
    ['/framework/testing-session.js', 'text/javascript'],
    ['/framework/testing-studio.js', 'text/javascript'],
    ['/framework/testing-runtime.js', 'text/javascript'],
    ['/framework/testing-overlay.css', 'text/css']
  ] as const) {
    const res = await fetch(origin + assetPath)
    assert.equal(res.status, 200, assetPath + ' should return 200')
    assert.ok(res.headers.get('content-type')?.startsWith(expectedType), assetPath + ' content-type')
  }

  // Loopback /__testing/reviews works and accepts generalized surfaces (mesh, rig)
  const listRes = await fetch(origin + '/__testing/reviews')
  assert.equal(listRes.status, 200)
  assert.deepEqual(await listRes.json(), { entries: [], errors: [] })

  const rigReviewId = randomUUID()
  const postRes = await fetch(origin + '/__testing/reviews', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: rigReviewId,
      comment: 'Check rig shoulder silhouette.',
      png: PNG_1X1,
      scene: { url: '/?testing=1' },
      target: {
        scope: 'asset',
        part: 'chest',
        editSource: 'game/hero.ts:42',
        region: [0.2, 0.2, 0.8, 0.8],
        view: {
          surface: 'rig',
          asset: 'hero-rig',
          instance: 'rig-1',
          source: 'game/hero.ts:42',
          position: [0, 0.5, 0],
          yaw: 0.5,
          elevation: 0.4,
          span: 2,
          centerY: 0.5,
          width: 200,
          height: 200
        }
      }
    })
  })
  assert.equal(postRes.status, 200)
  const created = await postRes.json() as { note: { id: string; target: { view: { surface: string } } } }
  assert.equal(created.note.id, rigReviewId)
  assert.equal(created.note.target.view.surface, 'rig')

  // DELETE /__testing/reviews/:id deletes the review and returns 404 on second delete
  const delRes = await fetch(origin + '/__testing/reviews/' + rigReviewId, {
    method: 'DELETE',
    headers: { Origin: origin }
  })
  assert.equal(delRes.status, 200)
  assert.deepEqual(await delRes.json(), { deleted: true, id: rigReviewId })
  assert.equal((await fetch(origin + '/__testing/reviews/' + rigReviewId, {
    method: 'DELETE',
    headers: { Origin: origin }
  })).status, 404)
  assert.deepEqual(await (await fetch(origin + '/__testing/reviews')).json(), { entries: [], errors: [] })

  // Rejects mismatched scope/surface (3D mesh with sprite scope)
  const badScopeRes = await fetch(origin + '/__testing/reviews', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: randomUUID(),
      comment: 'Bad scope.',
      png: PNG_1X1,
      scene: {},
      target: {
        scope: 'sprite',
        region: [0.5, 0.5, 0.5, 0.5],
        view: {
          surface: 'mesh',
          asset: 'rock',
          instance: 'b0-0',
          source: 'game/scene.ts:10',
          position: [0, 0, 0],
          yaw: 0,
          elevation: 0,
          span: 1,
          centerY: 0,
          width: 64,
          height: 64
        }
      }
    })
  })
  assert.equal(badScopeRes.status, 400)

  // Rejects non-local Origin on write (loopback-only protection)
  const crossOriginRes = await fetch(origin + '/__testing/reviews', {
    method: 'POST',
    headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  assert.equal(crossOriginRes.status, 403)

  // 2. Normal host (testing: false) never injects script and never exposes /__testing/*
  const normalApp = createGameHost({
    root,
    files: ['index.html'],
    aliases: { '/': 'index.html' },
    testing: false
  })
  t.after(() => normalApp.close())
  await new Promise<void>(resolve => normalApp.server.listen(0, '127.0.0.1', resolve))
  const normalAddr = normalApp.server.address()
  assert.ok(normalAddr && typeof normalAddr === 'object')
  const normalOrigin = `http://127.0.0.1:${normalAddr.port}`

  const normalHtml = await (await fetch(normalOrigin + '/')).text()
  assert.equal(normalHtml, html)
  assert.equal((await fetch(normalOrigin + '/__testing/reviews')).status, 404)
  assert.equal((await fetch(normalOrigin + '/__testing/reviews', { method: 'POST', body: '{}' })).status, 405)
})

test('createGameServer({ testing: true }) enables Testing Mode on all 4 games and generated starter playtest serves overlay CSS', async t => {
  const testingServer = createGameServer({ testing: true })
  t.after(() => testingServer.close())
  await new Promise<void>(resolve => testingServer.server.listen(0, '127.0.0.1', resolve))
  const addr = testingServer.server.address()
  assert.ok(addr && typeof addr === 'object')
  const origin = `http://127.0.0.1:${addr.port}`

  for (const route of ['/', '/racing', '/lighthouse', '/crownshard', '/starter/']) {
    const res = await fetch(origin + route)
    assert.equal(res.status, 200, `${route} should return 200`)
    const html = await res.text()
    assert.ok(html.includes('<script type="module" src="/framework/testing-studio.js"></script>'),
      `${route} should inject testing-studio.js when testing is enabled`)
  }
  const overlayRes = await fetch(origin + '/framework/testing-overlay.css')
  assert.equal(overlayRes.status, 200)
  assert.ok(overlayRes.headers.get('content-type')?.startsWith('text/css'))
  assert.equal((await fetch(origin + '/__testing/reviews')).status, 200)

  const normalServer = createGameServer({ testing: false })
  t.after(() => normalServer.close())
  await new Promise<void>(resolve => normalServer.server.listen(0, '127.0.0.1', resolve))
  const normalAddr = normalServer.server.address()
  assert.ok(normalAddr && typeof normalAddr === 'object')
  const normalOrigin = `http://127.0.0.1:${normalAddr.port}`

  for (const route of ['/', '/racing', '/lighthouse', '/crownshard', '/starter/']) {
    const html = await (await fetch(normalOrigin + route)).text()
    assert.ok(!html.includes('/framework/testing-studio.js'), `${route} must not inject testing-studio.js in normal mode`)
  }
  assert.equal((await fetch(normalOrigin + '/__testing/reviews')).status, 404)

  // Verify a generated create-game project inherits framework Testing Mode via `node game/serve.js --testing`
  const work = await mkdtemp(join(tmpdir(), 'ridgetop-starter-testing-'))
  t.after(() => rm(work, { recursive: true, force: true }))
  const project = await createGame(join(work, 'demo'))
  const child = spawn(process.execPath, ['game/serve.js', '--testing'], {
    cwd: project,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
  })
  let childOrigin = ''
  for await (const line of createInterface({ input: child.stdout })) {
    const m = /listening on port (\d+)/.exec(line)
    if (m) { childOrigin = `http://127.0.0.1:${m[1]}`; break }
  }
  assert.ok(childOrigin, 'generated game playtest server should start')
  const starterHtml = await (await fetch(childOrigin + '/')).text()
  assert.ok(starterHtml.includes('<script type="module" src="/framework/testing-studio.js"></script>'))
  const cssRes = await fetch(childOrigin + '/framework/testing-overlay.css')
  assert.equal(cssRes.status, 200)
  assert.ok(cssRes.headers.get('content-type')?.startsWith('text/css'))
  assert.equal((await fetch(childOrigin + '/framework/testing-studio.js')).status, 200)
  assert.equal((await fetch(childOrigin + '/__testing/reviews')).status, 200)
})

test('headless Testing Studio session picks HUD, 2D sprites, and 3D models with dirty guards and ReviewStorePort CRUD', async t => {
  t.after(() => {
    setTestingPaused(false)
    setTestingActive(false)
    resetTestingRuntime()
  })
  setTestingActive(true)

  const store = createMemoryReviewStore()
  const hudCanvas = { width: 400, height: 300, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) } as unknown as HTMLCanvasElement
  const spriteCanvas = { width: 400, height: 300, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) } as unknown as HTMLCanvasElement
  const worldCanvas = { width: 400, height: 300, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) } as unknown as HTMLCanvasElement

  // Register a giant background HUD container (must be skipped) and a real leaf HUD badge
  registerHudRegion({
    id: 'fullscreen-panel',
    label: 'Root Overlay',
    canvas: hudCanvas,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    viewportWidth: 400,
    viewportHeight: 300
  })
  registerHudRegion({
    id: 'health-badge',
    label: 'Health Badge',
    asset: 'hud-health',
    source: 'game/hud.ts:18',
    canvas: hudCanvas,
    rect: { x: 10, y: 10, width: 80, height: 30 },
    viewportWidth: 400,
    viewportHeight: 300
  })

  // Record a 2D sprite on the right side (2-column 8x4 RGBA sheet)
  const opaque8x4 = new Uint8ClampedArray(8 * 4 * 4).fill(255)
  recordSpriteDraw({
    canvas: spriteCanvas,
    atlas: {
      id: 'scout-atlas',
      src: 'art/scout.png',
      manifestUrl: 'art/scout.json',
      frameWidth: 4,
      frameHeight: 4,
      rows: 1,
      columns: 2,
      clips: {
        idle: { column: 0, frames: 1, frameMs: 120 },
        run: { column: 0, frames: 2, frameMs: 90 }
      },
      pixels: opaque8x4,
      imageWidth: 8,
      imageHeight: 4
    },
    clip: 'run',
    frame: 1,
    column: 1,
    row: 0,
    flip: false,
    rect: { x: 300, y: 100, width: 60, height: 60 },
    canvasWidth: 400,
    canvasHeight: 300
  })

  // Record a 3D frame with an ArtKit ranger centered in the viewport
  const kit = createArtKit()
  const grp = kit.group()
  grp.add('ranger', [0, 0, 0])
  const cam = multiply(orthographic(4, 3, 0.1, 30), view([0, 0.7, 8], [0, 0.7, 0]))
  recordFrame({
    canvas: worldCanvas,
    viewProjection: cam,
    batches: grp.batches,
    clear: [0, 0, 0, 1],
    width: 400,
    height: 300,
    clientWidth: 400,
    clientHeight: 300,
    timestamp: 1
  })

  const restoredScenes: unknown[] = []
  const savedRecipes: Array<{ asset: string; parts: number }> = []
  registerTestingHooks({
    snapshot: () => ({ mode: '3d', turn: 5 }),
    restore: scene => { restoredScenes.push(scene) },
    onRecipeSaved: (asset, recipe) => { savedRecipes.push({ asset, parts: recipe.parts.length }) }
  })

  const session = createTestingStudioSession({
    store,
    env: { getViewportSize: () => ({ width: 400, height: 300 }), getLocationUrl: () => '/?testing=1' }
  })
  t.after(() => session.dispose())

  // Picking while live is blocked
  assert.equal(session.pickAt(200, 150).picked, false)

  // Pause & pick HUD leaf badge
  assert.equal(session.setPaused(true).ok, true)
  const hudPick = session.pickAt(30, 20)
  assert.equal(hudPick.picked, true)
  assert.equal(hudPick.selection.surface, 'hud')
  assert.equal(hudPick.selection.asset, 'hud-health')
  assert.equal(hudPick.selection.scope, 'hud')

  // Pick 2D sprite, scrub frames, adjust timing, and save sprite through ReviewStorePort
  const spritePick = session.pickAt(330, 130)
  assert.equal(spritePick.picked, true)
  assert.equal(spritePick.selection.surface, 'sprite')
  assert.equal(spritePick.selection.asset, 'scout')
  session.setSpriteFrameMs(75)
  const savedSprite = await session.saveSprite(PNG_1X1)
  assert.deepEqual(savedSprite.files, ['art/scout.png', 'art/scout.json'])
  assert.equal(store.getSavedSprite('art/scout')?.manifest?.clips?.run.frameMs, 75)

  // Pick 3D ArtKit ranger through the full-screen HUD container
  const rangerNdc = projectPoint(cam, 0, 0.7, 0)
  const rx = ((rangerNdc[0] + 1) / 2) * 400
  const ry = ((1 - rangerNdc[1]) / 2) * 300
  const modelPick = session.pickAt(rx, ry)
  assert.equal(modelPick.picked, true)
  assert.equal(modelPick.selection.surface, 'model')
  assert.equal(modelPick.selection.asset, 'ranger')
  const editor = session.getRecipeEditor()
  assert.ok(editor)

  // Dirty guard blocks picking, resuming, and opening reviews while unsaved recipe edits exist
  editor.addPart({ name: 'cape', shape: 'wedge', position: [0, 0.5, -0.35], scale: [0.4, 0.5, 0.1], tone: 'accent' })
  assert.equal(session.isDirty(), true)
  const blockedPick = session.pickAt(30, 20)
  assert.equal(blockedPick.picked, false)
  assert.equal(blockedPick.blocked, 'dirty')
  assert.equal(session.setPaused(false).ok, false)

  // Save recipe clears dirty, persists to store, and notifies testing hooks
  const saveRes = await session.saveRecipe()
  assert.equal(saveRes.file, 'art/overrides.json')
  assert.equal(session.isDirty(), false)
  assert.equal(savedRecipes.length, 1)
  assert.equal(savedRecipes[0].asset, 'ranger')
  assert.ok(store.getSavedRecipe('art/overrides.json#ranger')?.parts.some(p => p.name === 'cape'))

  // Review lifecycle: create, list, external conflict, refresh, reply, resolve/reopen, reload-compare, delete
  const created = await session.createReview('Widen the helmet visor.', PNG_1X1)
  assert.equal(created.note.status, 'open')
  assert.equal(created.note.target.view.surface, 'model')
  assert.equal(store.getBeforePng(created.note.id), PNG_1X1)
  assert.equal(session.listReviews().length, 1)

  // Simulate an agent replying out-of-band on disk -> stale revision rejected with 409
  store.mutateReviewExternally(created.note.id, note => {
    note.status = 'ready'
    note.replies.push({ text: 'Adjusted visor width.', date: '2026-11-26T00:00:00.000Z' })
  })
  await assert.rejects(() => session.replyToReview('Stale reply'), /changed on disk/i)

  // Refresh picks up new revision -> reply & resolve succeed
  await session.refreshReviews()
  assert.equal(session.getActiveReview()?.note.status, 'ready')
  const replied = await session.replyToReview('Looks sharper now.')
  assert.equal(replied.note.replies.length, 2)
  const resolved = await session.toggleResolveReview('Approved!')
  assert.equal(resolved.note.status, 'resolved')
  assert.equal(resolved.note.replies.length, 3)

  // Reload & compare state restores review & scene snapshot in a fresh session
  const reloadState = session.prepareReloadCompareState()
  assert.equal(reloadState.ridgetopStudio.reviewId, created.note.id)
  const reloadedSession = createTestingStudioSession({ store })
  t.after(() => reloadedSession.dispose())
  await reloadedSession.refreshReviews()
  const resumed = await reloadedSession.resumeFromNavigation({ historyState: reloadState, search: '' })
  assert.equal(resumed.openedReview?.note.id, created.note.id)
  assert.equal(resumed.clearHistoryState, true)
  assert.deepEqual(restoredScenes.at(-1), { mode: '3d', turn: 5 })

  // Deep-link ?review=<id> opens saved review and runs deferred restore once hooks register
  const lateRestored: unknown[] = []
  resetTestingRuntime()
  const deepLinkSession = createTestingStudioSession({ store })
  t.after(() => deepLinkSession.dispose())
  await deepLinkSession.refreshReviews()
  const deepResumed = await deepLinkSession.resumeFromNavigation({ search: '?review=' + created.note.id })
  assert.equal(deepResumed.openedReview?.note.id, created.note.id)
  assert.equal(deepResumed.clearHistoryState, false)
  assert.equal(lateRestored.length, 0)
  registerTestingHooks({ restore: scene => { lateRestored.push(scene) } })
  await Promise.resolve()
  assert.deepEqual(lateRestored, [{ mode: '3d', turn: 5 }])

  // Delete review removes it from store and session list
  await deepLinkSession.deleteReview()
  assert.equal(deepLinkSession.listReviews().length, 0)
  assert.equal(deepLinkSession.getActiveReview(), undefined)
})

test('shared ArtRecipeEditor supports v1/v2 edits, tube preservation, palette edits, fitArtRecipe grounding, undo, and discard', () => {
  const baseRecipe: ArtRecipe = {
    format: 'ridgetop-art',
    version: 2,
    name: 'staff',
    span: 2.2,
    centerY: 0.8,
    frameSize: 64,
    palette: { wood: '#96694e', crystal: '#5ad6ff', accent: '#eaa555' },
    parts: [
      {
        name: 'shaft',
        shape: 'tube',
        points: [[0, 0.2, 0], [0, 1.0, 0], [0.15, 1.5, 0]],
        radii: [0.06, 0.05, 0.04],
        sides: 6,
        position: [0, 0, 0],
        scale: [1, 1, 1],
        tone: 'wood'
      },
      {
        name: 'orb',
        shape: 'octahedron',
        position: [0.15, 1.65, 0],
        scale: [0.22, 0.28, 0.22],
        tone: 'crystal',
        unlit: 0.6,
        alpha: 0.75,
        blend: 'alpha',
        shade: 0.15
      }
    ]
  }

  const editor = createArtRecipeEditor(baseRecipe, 'shaft')
  assert.equal(editor.isDirty(), false)
  assert.equal(editor.getSelectedPart().name, 'shaft')
  assert.ok(editor.getAvailableShapes().includes('tube'))
  assert.ok(editor.getAvailableTones().includes('crystal'))

  // Tube part rejects changing shape away from 'tube' but allows editing tube points/radii/sides & transforms
  assert.throws(() => editor.updatePart({ shape: 'box' }), /Cannot change shape of a tube/i)
  const updatedTube = editor.updatePart({
    position: [0, 0.1, 0],
    radii: [0.08, 0.06, 0.05],
    sides: 8
  })
  assert.equal(updatedTube.shape, 'tube')
  assert.equal(updatedTube.sides, 8)
  assert.deepEqual(updatedTube.radii, [0.08, 0.06, 0.05])
  assert.equal(editor.isDirty(), true)

  // Duplicating a tube preserves all tube fields with unique name & offset
  const dup = editor.duplicatePart(0)
  assert.equal(dup.part.name, 'shaft-copy')
  assert.equal(dup.part.shape, 'tube')
  assert.equal(dup.part.sides, 8)
  assert.equal(editor.getRecipe().parts.length, 3)

  // Edit v2 style fields (alpha, blend, shade, rotationDeg) on orb
  editor.selectPart('orb')
  const updatedOrb = editor.updatePart({
    rotationDeg: [15, 45, 0],
    alpha: 0.5,
    blend: 'additive',
    shade: -0.2
  })
  assert.equal(updatedOrb.blend, 'additive')
  assert.equal(updatedOrb.alpha, 0.5)
  assert.equal(updatedOrb.shade, -0.2)
  assert.ok(Math.abs((updatedOrb.yaw ?? 0) - Math.PI / 4) < 1e-6)

  // Palette color edit & frameSize edit
  editor.setPaletteColor('crystal', '#88ffee')
  assert.equal(editor.getPaletteColor('crystal'), '#88ffee')
  editor.setFrameSize(96)
  assert.equal(editor.getRecipe().frameSize, 96)

  // Fit & ground grounds model cleanly and validates through modelFromArtRecipe
  const fitted = editor.fitAndGround()
  assert.ok(fitted.span > 0)
  assert.doesNotThrow(() => modelFromArtRecipe(fitted))

  // Delete parts down to minimum 1, then refusing to delete the last part
  editor.deletePart(1)
  assert.equal(editor.getRecipe().parts.length, 2)
  editor.deletePart(0)
  assert.equal(editor.getRecipe().parts.length, 1)
  assert.throws(() => editor.deletePart(0), /at least one part/i)

  // Undo restores deleted part; discard restores original cleanly
  assert.equal(editor.undo(), true)
  assert.equal(editor.getRecipe().parts.length, 2)
  editor.discard()
  assert.equal(editor.isDirty(), false)
  assert.equal(editor.canUndo(), false)
  assert.deepEqual(editor.getRecipe(), baseRecipe)
})

test('shared testing-protocol rejects invalid pins/reviews/manifests and unifies ?testing= URL activation & stack roots', () => {
  const valid3dPin = {
    scope: 'asset' as const,
    region: [0.1, 0.2, 0.8, 0.9] as [number, number, number, number],
    view: {
      surface: 'model' as const,
      asset: 'ranger',
      instance: 'r1',
      source: 'art/overrides.json#ranger',
      position: [0, 0, 0],
      yaw: 0.4,
      elevation: 0.3,
      span: 1.8,
      centerY: 0.7,
      width: 128,
      height: 128
    }
  }
  assert.doesNotThrow(() => checkPin(valid3dPin))

  // Mismatched scope/surface
  assert.throws(() => checkPin({ ...valid3dPin, scope: 'hud' }), /Invalid art review target/)
  assert.throws(() => checkPin({ ...valid3dPin, scope: 'sprite' }), /Invalid art review target/)
  // Elevation out of (-pi/2, pi/2)
  assert.throws(() => checkPin({ ...valid3dPin, view: { ...valid3dPin.view, elevation: Math.PI / 2 } }), /Invalid art review target/)
  // Inverted or out-of-unit region
  assert.throws(() => checkPin({ ...valid3dPin, region: [0.8, 0.2, 0.1, 0.9] }), /Invalid art review target/)
  assert.throws(() => checkPin({ ...valid3dPin, region: [-0.1, 0.2, 0.5, 0.5] }), /Invalid art review target/)
  // Missing clip on 2D sprite surface
  assert.throws(() => checkPin({
    scope: 'sprite',
    region: [0.5, 0.5, 0.5, 0.5],
    view: { ...valid3dPin.view, surface: 'sprite' }
  }), /Invalid art review target/)
  // Review validation checks id, version, status, replies
  const id = randomUUID()
  assert.throws(() => checkReview({ version: 2, id, status: 'open', created: '', comment: 'x', replies: [], target: valid3dPin }, id), /Invalid review file/)
  assert.throws(() => checkReview({ version: 1, id, status: 'invalid', created: '', comment: 'x', replies: [], target: valid3dPin }, id), /Invalid review file/)
  // Sprite manifest validation rejects traversal & bad sizes
  assert.throws(() => checkSpriteManifest({ src: '../bad.png', frameWidth: 16, frameHeight: 16 }), /Invalid sprite manifest/)
  assert.throws(() => checkSpriteManifest({ src: 'ok.png', frameWidth: 0, frameHeight: 16 }), /Invalid sprite manifest/)

  // Unified ?testing= URL activation semantics
  assert.equal(resolveTestingUrlActivation('', false), false)
  assert.equal(resolveTestingUrlActivation('', true), true)
  assert.equal(resolveTestingUrlActivation('?testing=1', false), true)
  assert.equal(resolveTestingUrlActivation('?testing=true', false), true)
  assert.equal(resolveTestingUrlActivation('?testing=0', true), false)
  assert.equal(resolveTestingUrlActivation('?testing=false', true), false)
  assert.equal(resolveTestingUrlActivation('?review=' + id, false), true)
  assert.equal(resolveTestingUrlActivation('?testing=0&review=' + id, true), false)
  assert.equal(shouldAutoMountTestingStudio(''), true)
  assert.equal(shouldAutoMountTestingStudio('?testing=0'), false)
  assert.equal(shouldAutoMountTestingStudio('?testing=false'), false)
  assert.equal(shouldAutoMountTestingStudio('?testing=1'), true)

  // normalizeStackLocation preserves /examples/ and /crownshard/ paths cleanly
  assert.equal(
    captureSourceSite('Error\n    at buildHero (file:///repo/examples/crownshard/scene.ts:42:10)'),
    'examples/crownshard/scene.ts:42'
  )
  assert.equal(
    captureSourceSite('Error\n    at buildUnit (http://127.0.0.1:3000/crownshard/characters.js:88:4)'),
    'crownshard/characters.js:88'
  )
})
