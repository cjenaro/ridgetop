import assert from 'node:assert/strict'
import test from 'node:test'
import { bindActionControls, bindPlatformControls, createPlatform, resolveStorage } from '../framework/index.ts'
import type { RidgetopNativeBridge } from '../framework/index.ts'

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
      buttons: [],
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

    // Action controls also respect analog triggers (RT = button 7)
    enabled = true
    const racer = bindActionControls<'throttle' | 'brake' | 'pulse'>({
      keys: { KeyW: 'throttle', KeyS: 'brake', KeyJ: 'pulse' },
      buttons: [],
      enabled: () => enabled,
      onPress: action => pressed.push(action)
    })
    currentPad = makePad({ 7: 0.4, 2: true })
    assert.equal(racer.active('throttle'), true)
    assert.equal(racer.active('pulse'), true)
    assert.equal(racer.active('brake'), false)
    assert.deepEqual(pressed, ['throttle', 'pulse'])
    racer.dispose()
  })
})
