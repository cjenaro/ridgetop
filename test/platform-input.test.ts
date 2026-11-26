import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bindActionControls, bindPlatformControls, bindVirtualStick, color, createGamePage, createPlatform,
  createPlatformer, createSynthAudio, fixedLoop, resolveStorage, setTestingPaused, STEP
} from '../packages/ridgetop/framework/index.ts'
import type { MediaQueryLike, RidgetopNativeBridge } from '../packages/ridgetop/framework/index.ts'

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

test('createPlatform and resolveStorage bridge native Electron/Capacitor APIs and fall back on web', async () => {
  await withGlobals({ __ridgetopPlatform: undefined }, async () => {
    const web = createPlatform()
    assert.equal(web.kind, 'web')
    assert.equal(web.isNative, false)
    assert.equal(web.canQuit, false)
    assert.equal(web.steam.available, false)
    assert.equal(await web.steam.unlockAchievement('TEST'), false)
  })

  const persisted: Record<string, string> = { existing: '1' }
  const calls: string[] = []
  let fullscreen = false
  let lifecycleHandlers: { pause?: () => void; resume?: () => void } | undefined

  const bridge: RidgetopNativeBridge = {
    platform: 'desktop',
    storage: {
      loadAll: () => ({ ...persisted }),
      set: (k, v) => { persisted[k] = v; calls.push('set:' + k) },
      remove: k => { delete persisted[k]; calls.push('remove:' + k) },
      clear: () => { for (const k of Object.keys(persisted)) delete persisted[k]; calls.push('clear') }
    },
    fullscreen: {
      isFullscreen: () => fullscreen,
      set: value => { fullscreen = value },
      toggle: () => { fullscreen = !fullscreen }
    },
    quit: () => { calls.push('quit') },
    haptics: { impact: style => { calls.push('haptic:' + style) } },
    lifecycle: {
      subscribe: handlers => {
        lifecycleHandlers = handlers
        return () => { calls.push('unsub') }
      }
    },
    steam: {
      available: () => true,
      unlockAchievement: id => { calls.push('ach:' + id); return true },
      setRichPresence: (k, v) => { calls.push('rp:' + k + '=' + v) },
      activateOverlay: d => { calls.push('overlay:' + d) }
    }
  }

  await withGlobals({ __ridgetopPlatform: bridge }, async () => {
    const storage = resolveStorage()
    assert.ok(storage)
    assert.equal(storage.getItem('existing'), '1')
    assert.equal(storage.length, 1)
    assert.equal(storage.key(0), 'existing')
    storage.setItem('score', '42')
    assert.equal(storage.getItem('score'), '42')
    assert.equal(persisted.score, '42')
    storage.removeItem('existing')
    assert.equal(storage.getItem('existing'), null)
    storage.clear()
    assert.equal(storage.length, 0)

    const platform = createPlatform()
    assert.equal(platform.kind, 'desktop')
    assert.equal(platform.isNative, true)
    assert.equal(platform.canQuit, true)
    assert.equal(platform.isFullscreen(), false)
    await platform.toggleFullscreen()
    assert.equal(platform.isFullscreen(), true)
    await platform.setFullscreen(false)
    assert.equal(platform.isFullscreen(), false)
    platform.haptic('heavy')
    await platform.quit()
    assert.equal(platform.steam.available, true)
    assert.equal(await platform.steam.unlockAchievement('WIN'), true)
    platform.steam.setRichPresence('status', 'Racing')
    platform.steam.activateOverlay('Friends')

    const stop = platform.onLifecycle({
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume')
    })
    lifecycleHandlers?.pause?.()
    lifecycleHandlers?.resume?.()
    stop()

    assert.deepEqual(calls, [
      'set:score', 'remove:existing', 'clear',
      'haptic:heavy', 'quit', 'ach:WIN', 'rp:status=Racing', 'overlay:Friends',
      'pause', 'resume', 'unsub'
    ])
  })
})

test('bindActionControls and bindPlatformControls poll standard gamepads with deadzones and edges', () => {
  const fakeWindow = new EventTarget()
  const fakeDocument = new EventTarget() as EventTarget & { hidden: boolean }
  fakeDocument.hidden = false

  function makePad(buttons: Record<number, number | boolean> = {}, axes: number[] = [0, 0, 0, 0]) {
    const list = Array.from({ length: 16 }, (_, i) => {
      const value = buttons[i]
      if (typeof value === 'number') return { pressed: value >= 0.5, value, touched: value > 0 }
      return { pressed: Boolean(value), value: value ? 1 : 0, touched: Boolean(value) }
    })
    return { connected: true, id: 'Steam Deck Virtual Pad', index: 0, mapping: 'standard', buttons: list, axes } as unknown as Gamepad
  }

  let currentPad: Gamepad | null = makePad()
  const fakeNavigator = { getGamepads: () => [currentPad] }

  withGlobals({ window: fakeWindow, document: fakeDocument, navigator: fakeNavigator }, () => {
    let enabled = true
    let pauses = 0
    let gestures = 0
    const pressed: string[] = []

    const platform = bindPlatformControls({
      enabled: () => enabled,
      onPause: () => { pauses++ },
      onGesture: () => { gestures++ }
    })

    // Below deadzone does not trigger movement
    currentPad = makePad({}, [0.2, 0, 0, 0])
    assert.deepEqual(platform.read(), { left: false, right: false, jump: 0 })

    // Left stick right + A jump edge
    currentPad = makePad({ 0: true }, [0.85, 0, 0, 0])
    assert.deepEqual(platform.read(), { left: false, right: true, jump: 1 })
    // Holding jump does not increment counter again
    assert.deepEqual(platform.read(), { left: false, right: true, jump: 1 })

    // Release jump and press again increments
    currentPad = makePad({ 0: false }, [-0.9, 0, 0, 0])
    assert.deepEqual(platform.read(), { left: true, right: false, jump: 1 })
    currentPad = makePad({ 0: true }, [-0.9, 0, 0, 0])
    assert.deepEqual(platform.read(), { left: true, right: false, jump: 2 })

    // Pause (Start / button 9) triggers even while gameplay is disabled
    enabled = false
    currentPad = makePad({ 9: true })
    platform.poll()
    assert.equal(pauses, 1)
    assert.ok(gestures >= 2)
    platform.dispose()

    // Action controls also respect analog triggers (RT = button 7) and tolerate re-entrant active() in onPress
    enabled = true
    let reentrantChecks = 0
    const racer = bindActionControls<'throttle' | 'brake' | 'pulse'>({
      keys: { KeyW: 'throttle', KeyS: 'brake', KeyJ: 'pulse' },
      enabled: () => enabled,
      onPress(action) {
        pressed.push(action)
        if (action === 'pulse') {
          reentrantChecks++
          racer.active('brake')
        }
      }
    })
    currentPad = makePad({ 7: 0.4, 2: true })
    assert.equal(racer.active('throttle'), true)
    assert.equal(racer.active('pulse'), true)
    assert.equal(racer.active('brake'), false)
    assert.deepEqual(pressed, ['throttle', 'pulse'])
    assert.equal(reentrantChecks, 1)
    racer.dispose()
  })
})

test('fixedLoop prevents negative alpha and zombie frames on re-entrant stop', () => {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextId = 0
  let now = 100
  const alphas: number[] = []
  let updates = 0
  withGlobals({
    performance: { now: () => now },
    requestAnimationFrame: (cb: FrameRequestCallback) => { const id = ++nextId; callbacks.set(id, cb); return id },
    cancelAnimationFrame: (id: number) => { callbacks.delete(id) }
  }, () => {
    let stop: () => void = () => {}
    stop = fixedLoop({
      update() {
        updates++
        if (updates === 1) stop()
      },
      render(alpha) { alphas.push(alpha) }
    })
    // Frame 1 with timestamp earlier than performance.now() must not yield negative alpha
    const first = Array.from(callbacks.values())[0]
    callbacks.clear()
    first(92)
    assert.equal(alphas[0], 0)
    assert.equal(callbacks.size, 1)
    // Frame 2 triggers update which calls stop(); no further frame may be scheduled
    const second = Array.from(callbacks.values())[0]
    callbacks.clear()
    second(120)
    assert.equal(updates, 1)
    assert.equal(callbacks.size, 0)
  })
})

test('platformer tolerates IEEE-754 ULP rounding on landings and pads', () => {
  const move = createPlatformer({ worldWidth: 100, bodyWidth: 1, bodyHeight: 1.1, speed: 5, gravity: 10, jumpSpeed: 5, boostSpeed: 10 })
  const world = { platforms: [{ x: 0, y: 0.1, w: 20 }], pads: [{ x: 0, y: 0.1, w: 20 }] }
  const player = { x: 2, y: -1.01, vx: 0, vy: 1, grounded: false, moving: false, facing: 1, coyote: 0, buffer: 0, jump: 0 }
  move(player, { left: false, right: false, jump: 0 }, STEP, world, { coyoteTicks: 4, bufferTicks: 4 })
  assert.equal(player.grounded, true)
  // Next tick: (0.1 - 1.1) + 1.1 === 0.10000000000000009 > 0.1; must stay grounded
  move(player, { left: false, right: false, jump: 0 }, STEP, world, { coyoteTicks: 4, bufferTicks: 4 })
  assert.equal(player.grounded, true)
  // Jumping from that pad must use boostSpeed (-10 + gravity*dt)
  move(player, { left: false, right: false, jump: 1 }, STEP, world, { coyoteTicks: 4, bufferTicks: 4 })
  assert.ok(player.vy < -9)
})

test('createSynthAudio recovers after close(), respects mute, and handles short notes', () => {
  let contexts = 0
  let oscillators = 0
  const ramps: number[] = []
  class FakeAudioContext {
    state = 'running'
    currentTime = 0
    destination = {}
    constructor() { contexts++ }
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime() {},
          exponentialRampToValueAtTime(_v: number, t: number) { ramps.push(t) }
        },
        connect() {},
        disconnect() {}
      }
    }
    createOscillator() {
      oscillators++
      return {
        type: 'sine',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
        onended: null as null | (() => void)
      }
    }
    resume() { this.state = 'running'; return Promise.resolve() }
    suspend() { this.state = 'suspended'; return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  withGlobals({ AudioContext: FakeAudioContext }, () => {
    const audio = createSynthAudio({ blip: [[440, 0.01, 0]] })
    audio.unlock()
    audio.mute(true)
    audio.play('blip')
    assert.equal(oscillators, 0)
    audio.mute(false)
    audio.play('blip')
    assert.equal(oscillators, 1)
    // Attack peak (0.005) must precede release end (0.01)
    assert.ok(ramps[0] < ramps[1])
    audio.close()
    audio.unlock()
    assert.equal(contexts, 2)
    audio.play('blip')
    assert.equal(oscillators, 2)
  })
})

test('resolveStorage shares cache per native bridge and color() validates hex formats', () => {
  const backing: Record<string, string> = {}
  const bridge: RidgetopNativeBridge = {
    platform: 'desktop',
    storage: {
      loadAll: () => ({ ...backing }),
      set: (k, v) => { backing[k] = v }
    }
  }
  withGlobals({ __ridgetopPlatform: bridge }, () => {
    const a = resolveStorage()!
    const b = resolveStorage()!
    a.setItem('shared', 'yes')
    assert.equal(b.getItem('shared'), 'yes')
  })

  assert.deepEqual(color('#ff0000ff'), [1, 0, 0, 1])
  assert.deepEqual(color('#0f8'), [0, 1, 0x88 / 255, 1])
  assert.deepEqual(color('112233'), [0x11 / 255, 0x22 / 255, 0x33 / 255, 1])
  assert.throws(() => color('not-a-color'), RangeError)
})

test('platform.onLifecycle unifies visibilitychange, persisted pagehide/pageshow, non-persisted dispose, and native bridge', () => {
  const fakeWindow = new EventTarget()
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false })
  const events: string[] = []
  let nativeHandlers: { pause?: () => void; resume?: () => void } | undefined
  let nativeUnsubs = 0

  const bridge: RidgetopNativeBridge = {
    platform: 'desktop',
    lifecycle: {
      subscribe(handlers) {
        nativeHandlers = handlers
        return () => { nativeUnsubs++ }
      }
    }
  }

  withGlobals({ window: fakeWindow, document: fakeDocument, __ridgetopPlatform: bridge }, () => {
    const platform = createPlatform()
    const stop = platform.onLifecycle({
      pause: reason => events.push('pause:' + reason),
      resume: reason => events.push('resume:' + reason),
      dispose: () => events.push('dispose')
    })

    // Transient visibility changes
    fakeDocument.hidden = true
    fakeDocument.dispatchEvent(new Event('visibilitychange'))
    fakeDocument.hidden = false
    fakeDocument.dispatchEvent(new Event('visibilitychange'))

    // Persisted pagehide/pageshow (bfcache) triggers pause/resume, NOT dispose
    fakeWindow.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }))
    fakeWindow.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    fakeWindow.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))

    // Native bridge pause/resume
    nativeHandlers?.pause?.()
    nativeHandlers?.resume?.()

    // Non-persisted pagehide triggers dispose ONCE and cleans up all listeners + native subscription
    fakeWindow.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }))
    fakeWindow.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }))
    fakeDocument.hidden = true
    fakeDocument.dispatchEvent(new Event('visibilitychange'))
    nativeHandlers?.pause?.()
    stop() // Idempotent after dispose

    assert.deepEqual(events, [
      'pause:visibility',
      'resume:visibility',
      'pause:page',
      'resume:page',
      'pause:native',
      'resume:native',
      'dispose'
    ])
    assert.equal(nativeUnsubs, 1)

    // Backward compatibility: omitting dispose still routes non-persisted pagehide to pause('page')
    const pauseOnlyEvents: string[] = []
    const stopPauseOnly = platform.onLifecycle({
      pause: reason => pauseOnlyEvents.push('pause:' + reason)
    })
    fakeWindow.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }))
    stopPauseOnly()
    assert.deepEqual(pauseOnlyEvents, ['pause:page'])
  })
})

test('bindActionControls and bindPlatformControls support programmatic virtual touch holds', () => {
  const fakeWindow = new EventTarget()
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false })

  withGlobals({ window: fakeWindow, document: fakeDocument, navigator: {} }, () => {
    let enabled = true
    let gestures = 0
    const pressed: string[] = []

    const controls = bindActionControls<'left' | 'right' | 'pulse'>({
      keys: { KeyA: 'left', KeyD: 'right', KeyJ: 'pulse' },
      enabled: () => enabled,
      gamepad: false,
      onGesture: () => { gestures++ },
      onPress: action => { pressed.push(action) }
    })

    // Edge-triggered setHold fires gesture & press once while held
    controls.setHold('left', true)
    controls.setHold('left', true)
    assert.equal(controls.active('left'), true)
    assert.deepEqual(pressed, ['left'])
    assert.equal(gestures, 1)

    // Releasing works even after enabled() becomes false (holds never stick)
    enabled = false
    controls.setHold('pulse', true)
    assert.equal(controls.active('pulse'), false, 'setHold(true) ignored while disabled')
    controls.setHold('left', false)
    assert.equal(controls.active('left'), false)

    // clearHolds releases all active virtual holds
    enabled = true
    controls.setHold('right', true)
    controls.setHold('pulse', true)
    assert.equal(controls.active('right'), true)
    assert.equal(controls.active('pulse'), true)
    controls.clearHolds()
    assert.equal(controls.active('right'), false)
    assert.equal(controls.active('pulse'), false)
    controls.dispose()

    // bindPlatformControls merges virtual holds with jump edge counter
    let platformGestures = 0
    const platform = bindPlatformControls({
      enabled: () => true,
      onPause() {},
      onGesture: () => { platformGestures++ }
    })
    platform.setHold('right', true)
    platform.setHold('jump', true)
    platform.setHold('jump', true)
    assert.deepEqual(platform.read(), { left: false, right: true, jump: 1 })
    platform.setHold('jump', false)
    platform.setHold('jump', true)
    assert.deepEqual(platform.read(), { left: false, right: true, jump: 2 })
    platform.clear()
    assert.deepEqual(platform.read(), { left: false, right: false, jump: 2 })
    assert.equal(platformGestures, 3)
    platform.dispose()
  })
})

test('createGamePage parses backend/query params, supports injectable adapters, touch listeners, and LIFO disposal', async () => {
  function makeMediaQuery(initial: boolean, media: string) {
    let matches = initial
    const listeners = new Set<(event: { readonly matches: boolean }) => void>()
    const mql: MediaQueryLike & { emit(next: boolean): void; listenerCount(): number } = {
      get matches() { return matches },
      media,
      addEventListener(_type, listener) { listeners.add(listener) },
      removeEventListener(_type, listener) { listeners.delete(listener) },
      emit(next: boolean) {
        matches = next
        for (const listener of Array.from(listeners)) listener({ matches: next })
      },
      listenerCount: () => listeners.size
    }
    return mql
  }

  // requestedBackend() parsing matrix
  const backendCases: Array<[string, string, string?]> = [
    ['https://example.test/', 'auto'],
    ['https://example.test/?canvas=1', 'canvas'],
    ['https://example.test/?canvas', 'canvas'],
    ['https://example.test/?canvas=true', 'canvas'],
    ['https://example.test/?canvas=0', 'auto'],
    ['https://example.test/?canvas=false&renderer=webgl2', 'webgl2'],
    ['https://example.test/?canvas=1&renderer=webgl2', 'canvas'],
    ['https://example.test/?renderer=webgpu', 'webgpu'],
    ['https://example.test/?renderer=WEBGL2', 'webgl2'],
    ['https://example.test/?renderer=canvas', 'canvas'],
    ['https://example.test/?renderer=auto', 'auto'],
    ['https://example.test/?renderer=invalid', 'webgl2', 'webgl2']
  ]
  for (const [href, expected, fallback] of backendCases) {
    const page = createGamePage({ location: { href }, storage: undefined })
    assert.equal(
      page.requestedBackend(fallback as 'auto' | 'webgpu' | 'webgl2' | 'canvas' | undefined),
      expected,
      `requestedBackend for ${href}`
    )
    assert.equal(page.storage, undefined)
  }

  // Full injectable DOM/history/matchMedia/clipboard/fetch/crypto/storage/platform test
  const stageNode = { id: 'stage' } as unknown as HTMLElement
  const replacedUrls: string[] = []
  const copied: string[] = []
  const reducedMql = makeMediaQuery(true, '(prefers-reduced-motion: reduce)')
  const touchMql = makeMediaQuery(false, '(any-pointer: coarse)')
  const mem = new Map<string, string>()
  const fakeStorage = {
    get length() { return mem.size },
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() }
  }
  const customPlatform = createPlatform()

  const page = createGamePage({
    location: { href: 'https://ridgetop.test/play?course=ridge&mode=practice&renderer=webgpu' },
    document: {
      querySelector<T extends Element>(selector: string): T | null {
        return selector.includes('stage') ? (stageNode as unknown as T) : null
      }
    },
    history: {
      replaceState(_data, _unused, nextUrl) { replacedUrls.push(String(nextUrl)) }
    },
    matchMedia: q => q.includes('coarse') ? touchMql : reducedMql,
    storage: fakeStorage,
    platform: customPlatform,
    clipboard: { async writeText(text: string) { copied.push(text) } },
    crypto: {
      getRandomValues<T extends ArrayBufferView | null>(arr: T): T {
        if (arr instanceof Uint32Array) {
          arr[0] = 46656 // '1000' in base36
          arr[1] = 1295  // 'zz' in base36
        }
        return arr
      }
    },
    fetch: (async (input: string | URL | Request) => {
      const path = String(input)
      if (path === '/ok') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      return new Response('nope', { status: 500 })
    }) as typeof globalThis.fetch
  })

  assert.equal(page.element('stage'), stageNode)
  assert.throws(() => page.element('missing'), /missing #missing/)
  assert.equal(page.query('course'), 'ridge')
  assert.equal(page.query('mode'), 'practice')
  assert.equal(page.query('absent'), null)
  assert.equal(page.requestedBackend(), 'webgpu')
  assert.equal(page.reducedMotion.matches, true)
  assert.equal(page.touch.matches, false)
  assert.equal(page.storage, fakeStorage)
  assert.equal(page.platform, customPlatform)
  assert.equal(page.roomCode(), '1000-zz')

  page.replaceUrl(new URL('https://ridgetop.test/play?course=harbor'))
  assert.deepEqual(replacedUrls, ['https://ridgetop.test/play?course=harbor'])

  await page.copy('invite-link')
  assert.deepEqual(copied, ['invite-link'])

  assert.deepEqual(await page.requestJson('/ok'), { ok: true })
  await assert.rejects(() => page.requestJson('/fail', undefined, 'Custom boom'), /Custom boom/)

  // Touch change listener & unsubscribe & auto-cleanup on page.dispose()
  const touchEvents: boolean[] = []
  const unsub1 = page.onTouchChange(isTouch => touchEvents.push(isTouch))
  const touchEvents2: boolean[] = []
  page.onTouchChange(isTouch => touchEvents2.push(isTouch))
  assert.equal(touchMql.listenerCount(), 2)

  touchMql.emit(true)
  assert.deepEqual(touchEvents, [true])
  assert.deepEqual(touchEvents2, [true])

  unsub1()
  unsub1() // Idempotent
  assert.equal(touchMql.listenerCount(), 1)
  touchMql.emit(false)
  assert.deepEqual(touchEvents, [true])
  assert.deepEqual(touchEvents2, [true, false])

  // LIFO disposal order, cancellation, idempotency, and late registration
  const order: string[] = []
  page.onDispose(() => order.push('first'))
  const cancelMid = page.onDispose(() => order.push('cancelled'))
  page.onDispose(() => order.push('second'))
  cancelMid()
  page.dispose()
  assert.deepEqual(order, ['second', 'first'])
  assert.equal(touchMql.listenerCount(), 0, 'dispose() must clean up remaining touch listeners')

  // Second dispose() is a no-op; late onDispose() invokes immediately
  page.dispose()
  assert.deepEqual(order, ['second', 'first'])
  page.onDispose(() => order.push('late'))
  assert.deepEqual(order, ['second', 'first', 'late'])

  // Missing clipboard rejects cleanly
  const noClipPage = createGamePage({ location: { href: 'https://ridgetop.test/' }, clipboard: undefined })
  await assert.rejects(() => noClipPage.copy('x'), /Clipboard is unavailable/)
})

test('bindVirtualStick handles drag deadzone, clamping, cameraYaw, blocking, multi-touch isolation, and Testing Mode pause', () => {
  const fakeWindow = new EventTarget()
  const fakeDocument = Object.assign(new EventTarget(), { hidden: false })
  const element = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 400, height: 300 }),
    setPointerCapture() { throw new Error('synthetic pointer') }
  }) as unknown as HTMLElement

  function pointerEvent(type: string, props: Record<string, unknown>) {
    return Object.assign(new Event(type), { button: 0, pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0, ...props })
  }

  withGlobals({ window: fakeWindow, document: fakeDocument }, () => {
    let enabled = true
    let blocked = false
    let gestures = 0
    const yaw = Math.PI / 2 // 90 deg: cos=0, sin=1 -> vecX = sy, vecZ = -sx

    const stick = bindVirtualStick(element, {
      enabled: () => enabled,
      isBlocked: () => blocked,
      onGesture: () => { gestures++ },
      cameraYaw: yaw,
      deadzone: 10,
      maxRadius: 50
    })

    // Right-click mouse event ignored (onGesture still called before button check)
    element.dispatchEvent(pointerEvent('pointerdown', { button: 2, pointerType: 'mouse', pointerId: 1, clientX: 200, clientY: 150 }))
    assert.equal(stick.active(), false)
    assert.equal(gestures, 1)

    // Blocked UI point ignored
    blocked = true
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 150 }))
    assert.equal(stick.active(), false)
    blocked = false

    // Disabled stick ignored
    enabled = false
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 150 }))
    assert.equal(stick.active(), false)
    enabled = true

    // Start valid drag at local (100, 100) => client (200, 150)
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 150 }))
    assert.equal(stick.active(), true)
    assert.deepEqual(stick.state(), { active: true, originX: 100, originY: 100, currentX: 100, currentY: 100, x: 0, z: 0 })

    // Move inside deadzone (dx = 6, dy = 0 <= 10) keeps zero vector
    element.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 206, clientY: 150 }))
    assert.deepEqual(stick.vector(), { x: 0, z: 0 })

    // Move halfway to maxRadius along +X (dx = 25, dy = 0 -> sx = 0.5, sy = 0 -> with yaw=pi/2: vecX ~= 0, vecZ ~= -0.5)
    element.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 225, clientY: 150 }))
    assert.ok(Math.abs(stick.vector().x) < 1e-6)
    assert.ok(Math.abs(stick.vector().z - -0.5) < 1e-6)

    // Move beyond maxRadius along +Y (dx = 0, dy = 200 -> clamped mag = 1 -> with yaw=pi/2: vecX ~= 1, vecZ ~= 0)
    element.dispatchEvent(pointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 350 }))
    assert.ok(Math.abs(stick.vector().x - 1) < 1e-6)
    assert.ok(Math.abs(stick.vector().z) < 1e-6)

    // Multi-touch isolation: pointer 2 moving or releasing must not affect pointer 1
    element.dispatchEvent(pointerEvent('pointermove', { pointerId: 2, clientX: 100, clientY: 50 }))
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 2, clientX: 100, clientY: 50 }))
    assert.equal(stick.active(), true)
    assert.ok(Math.abs(stick.vector().x - 1) < 1e-6)

    // Pointer 1 release resets stick
    element.dispatchEvent(pointerEvent('pointerup', { pointerId: 1, clientX: 200, clientY: 350 }))
    assert.equal(stick.active(), false)
    assert.deepEqual(stick.vector(), { x: 0, z: 0 })

    // pointercancel clears active drag
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5, clientX: 200, clientY: 150 }))
    element.dispatchEvent(pointerEvent('pointermove', { pointerId: 5, clientX: 200, clientY: 200 }))
    assert.equal(stick.active(), true)
    element.dispatchEvent(pointerEvent('pointercancel', { pointerId: 5 }))
    assert.equal(stick.active(), false)

    // window blur & document visibilitychange clear active drag
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 6, clientX: 200, clientY: 150 }))
    fakeWindow.dispatchEvent(new Event('blur'))
    assert.equal(stick.active(), false)

    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 200, clientY: 150 }))
    fakeDocument.hidden = true
    fakeDocument.dispatchEvent(new Event('visibilitychange'))
    assert.equal(stick.active(), false)
    fakeDocument.hidden = false

    // Testing Mode pause clears active drag and blocks new drags until resumed
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 8, clientX: 200, clientY: 150 }))
    element.dispatchEvent(pointerEvent('pointermove', { pointerId: 8, clientX: 200, clientY: 200 }))
    assert.equal(stick.active(), true)
    try {
      setTestingPaused(true)
      assert.equal(stick.active(), false)
      assert.deepEqual(stick.vector(), { x: 0, z: 0 })
      element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9, clientX: 200, clientY: 150 }))
      assert.equal(stick.active(), false)
    } finally {
      setTestingPaused(false)
    }

    // Works again after Testing Mode resumes, and dispose() detaches listeners
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 10, clientX: 200, clientY: 150 }))
    assert.equal(stick.active(), true)
    stick.dispose()
    assert.equal(stick.active(), false)
    element.dispatchEvent(pointerEvent('pointerdown', { pointerId: 11, clientX: 200, clientY: 150 }))
    assert.equal(stick.active(), false)
  })
})
