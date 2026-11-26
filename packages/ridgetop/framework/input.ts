import type { RoomInput } from './types.ts'
import { isTestingPaused, onTestingPause } from './testing-runtime.ts'

export type GamepadBinding =
  | { button: number; threshold?: number }
  | { axis: number; direction: -1 | 1; threshold?: number }

const defaultGamepadBindings: Record<string, readonly GamepadBinding[]> = {
  left: [{ button: 14 }, { axis: 0, direction: -1, threshold: .35 }],
  right: [{ button: 15 }, { axis: 0, direction: 1, threshold: .35 }],
  up: [{ button: 12 }, { axis: 1, direction: -1, threshold: .35 }],
  down: [{ button: 13 }, { axis: 1, direction: 1, threshold: .35 }],
  jump: [{ button: 0 }, { button: 12 }, { axis: 1, direction: -1, threshold: .55 }],
  throttle: [{ button: 7, threshold: .2 }, { button: 0 }, { button: 12 }],
  brake: [{ button: 6, threshold: .2 }, { button: 13 }],
  drift: [{ button: 4 }, { button: 1 }],
  pulse: [{ button: 5 }, { button: 2 }],
  snare: [{ button: 3 }],
  recover: [{ button: 8 }]
}

const EMPTY_PADS: readonly Gamepad[] = Object.freeze([])

/** Safely return all currently connected gamepads across browser and non-Array GamepadList implementations. */
export function readConnectedGamepads(): readonly Gamepad[] {
  const getGamepads = globalThis.navigator?.getGamepads
  if (typeof getGamepads !== 'function') return EMPTY_PADS
  try {
    const list = getGamepads.call(globalThis.navigator)
    if (!list || !list.length) return EMPTY_PADS
    let pads: Gamepad[] | undefined
    for (let i = 0; i < list.length; i++) {
      const pad = list[i]
      if (pad && pad.connected) {
        if (!pads) pads = []
        pads.push(pad)
      }
    }
    return pads ?? EMPTY_PADS
  } catch { return EMPTY_PADS }
}

function bindingActive(pad: Gamepad, binding: GamepadBinding) {
  if ('button' in binding) {
    const button = pad.buttons?.[binding.button]
    if (!button) return false
    return button.pressed || button.value >= (binding.threshold ?? .5)
  }
  const value = pad.axes?.[binding.axis] ?? 0
  const threshold = binding.threshold ?? .35
  return binding.direction < 0 ? value <= -threshold : value >= threshold
}

function isOwnKey<K extends string>(record: Partial<Record<K, unknown>>, key: string): key is K {
  return Object.hasOwn(record, key)
}

export function bindActionControls<Action extends string>({
  keys, buttons, enabled, onPause = () => {}, onGesture = () => {}, onPress = () => {},
  gamepad, pauseButtons = [9]
}: {
  keys: Readonly<Record<string, Action>>
  buttons?: Iterable<HTMLElement>
  enabled(): boolean
  onPause?(): void
  onGesture?(): void
  onPress?(action: Action): void
  gamepad?: false | Partial<Record<Action, readonly GamepadBinding[]>>
  pauseButtons?: readonly number[]
}) {
  const down = new Map<string, Action>()
  const pointers = new Map<number, Action>()
  const holds = new Set<Action>()
  const padDown = new Set<Action>()
  let padPauseDown = false
  let padFrame: number | undefined
  let disposed = false
  const controller = new AbortController()
  const listeners = { signal: controller.signal }

  const actions: Action[] = Array.from(new Set(Object.values(keys)))
  const knownActions = new Map<string, Action>()
  for (const action of actions) knownActions.set(action, action)
  const pauseBindings: readonly GamepadBinding[] = pauseButtons.map(button => ({ button }))
  const padBindings = new Map<Action, readonly GamepadBinding[]>()
  if (gamepad !== false) {
    for (const action of actions) {
      const explicit = gamepad?.[action]
      const chosen = explicit ?? defaultGamepadBindings[action]
      if (chosen?.length) padBindings.set(action, chosen)
    }
    if (gamepad) {
      for (const key of Object.keys(gamepad)) {
        if (isOwnKey(gamepad, key)) {
          knownActions.set(key, key)
          const list = gamepad[key]
          if (list?.length) padBindings.set(key, list)
        }
      }
    }
  }

  function clearHolds() {
    holds.clear()
  }

  function setHold(action: Action, active: boolean) {
    if (!active) {
      holds.delete(action)
      return
    }
    if (disposed || isTestingPaused() || !enabled()) return
    const wasHeld = holds.has(action)
    holds.add(action)
    if (!wasHeld) {
      onGesture()
      onPress(action)
    }
  }

  function clear() {
    down.clear()
    pointers.clear()
    holds.clear()
    padDown.clear()
  }

  const unsubPause = onTestingPause(paused => {
    if (paused) {
      clear()
      padPauseDown = false
    } else {
      ensurePadLoop()
    }
  })

  function poll() {
    if (disposed || gamepad === false) return false
    if (isTestingPaused()) {
      padDown.clear()
      padPauseDown = false
      return false
    }
    const pads = readConnectedGamepads()
    if (!pads.length) {
      padDown.clear()
      padPauseDown = false
      return false
    }
    let pausePressed = false
    for (let i = 0; i < pads.length && !pausePressed; i++) {
      for (let j = 0; j < pauseBindings.length; j++) {
        if (bindingActive(pads[i], pauseBindings[j])) { pausePressed = true; break }
      }
    }
    const triggerPause = pausePressed && !padPauseDown
    padPauseDown = pausePressed
    if (triggerPause) {
      onGesture()
      onPause()
    }

    const allow = enabled()
    for (const [action, bindings] of padBindings) {
      let pressed = false
      if (allow) {
        for (let i = 0; i < pads.length && !pressed; i++) {
          for (let j = 0; j < bindings.length; j++) {
            if (bindingActive(pads[i], bindings[j])) { pressed = true; break }
          }
        }
      }
      const wasDown = padDown.has(action)
      if (pressed) padDown.add(action)
      else padDown.delete(action)
      if (pressed && !wasDown) {
        onGesture()
        onPress(action)
      }
    }
    return true
  }

  function stopPadLoop() {
    if (padFrame !== undefined) {
      globalThis.cancelAnimationFrame?.(padFrame)
      padFrame = undefined
    }
  }

  function ensurePadLoop() {
    if (disposed || gamepad === false || padFrame !== undefined || typeof globalThis.requestAnimationFrame !== 'function') return
    const step = () => {
      padFrame = undefined
      if (disposed) return
      if (poll() && !disposed) padFrame = globalThis.requestAnimationFrame(step)
    }
    padFrame = globalThis.requestAnimationFrame(step)
  }

  window.addEventListener('keydown', event => {
    if (isTestingPaused()) return
    if (event.code === 'Escape') {
      if (!event.repeat) onPause()
      return
    }
    const action = keys[event.code]
    if (!action || !enabled() || event.altKey || event.ctrlKey || event.metaKey ||
        (event.target instanceof Element && event.target.closest('select, input')) ||
        (event.code === 'Space' && event.target instanceof Element && event.target.closest('button'))) return
    event.preventDefault()
    onGesture()
    if (!event.repeat) onPress(action)
    down.set(event.code, action)
  }, listeners)
  window.addEventListener('keyup', event => down.delete(event.code), listeners)
  window.addEventListener('blur', clear, listeners)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear()
  }, listeners)
  if (gamepad !== false) {
    window.addEventListener('gamepadconnected', () => ensurePadLoop(), listeners)
    window.addEventListener('gamepaddisconnected', () => {
      if (!readConnectedGamepads().length) {
        padDown.clear()
        padPauseDown = false
        stopPadLoop()
      }
    }, listeners)
    if (readConnectedGamepads().length) ensurePadLoop()
  }

  if (buttons) {
    for (const button of buttons) {
      const control = button.dataset.control
      const action = control !== undefined ? knownActions.get(control) : undefined
      if (action === undefined) continue
      button.addEventListener('pointerdown', event => {
        if (isTestingPaused() || event.button !== 0 || !enabled()) return
        event.preventDefault()
        onGesture()
        try { button.setPointerCapture?.(event.pointerId) } catch { /* Synthetic or detached pointers cannot be captured. */ }
        pointers.set(event.pointerId, action)
        onPress(action)
      }, listeners)
      button.addEventListener('click', event => {
        if (!isTestingPaused() && event.detail === 0 && enabled()) {
          onGesture()
          onPress(action)
        }
      }, listeners)
      const releasePointer = (event: PointerEvent) => { pointers.delete(event.pointerId) }
      button.addEventListener('pointerup', releasePointer, listeners)
      button.addEventListener('pointercancel', releasePointer, listeners)
      button.addEventListener('lostpointercapture', releasePointer, listeners)
    }
  }

  return {
    clear,
    clearHolds,
    setHold,
    poll,
    active(action: Action) {
      if (isTestingPaused()) return false
      if (gamepad !== false && poll()) ensurePadLoop()
      for (const held of down.values()) if (held === action) return true
      for (const held of pointers.values()) if (held === action) return true
      return holds.has(action) || padDown.has(action)
    },
    dispose() {
      disposed = true
      unsubPause()
      stopPadLoop()
      controller.abort()
      clear()
    }
  }
}

export function bindPlatformControls(options: {
  buttons?: Iterable<HTMLElement>
  enabled(): boolean
  onPause(): void
  onGesture(): void
}) {
  let jump = 0
  const controls = bindActionControls<'left' | 'right' | 'jump'>({
    ...options,
    keys: {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      Space: 'jump', ArrowUp: 'jump', KeyW: 'jump'
    },
    gamepad: {
      left: [{ button: 14 }, { axis: 0, direction: -1, threshold: .35 }],
      right: [{ button: 15 }, { axis: 0, direction: 1, threshold: .35 }],
      jump: [{ button: 0 }, { button: 12 }, { axis: 1, direction: -1, threshold: .55 }]
    },
    onPress(action) { if (action === 'jump') jump++ }
  })
  return {
    clear: controls.clear,
    clearHolds: controls.clearHolds,
    setHold: controls.setHold,
    poll: controls.poll,
    dispose: controls.dispose,
    read(): RoomInput {
      return { left: controls.active('left'), right: controls.active('right'), jump }
    }
  }
}

export interface VirtualStickState {
  readonly active: boolean
  readonly originX: number
  readonly originY: number
  readonly currentX: number
  readonly currentY: number
  readonly x: number
  readonly z: number
}

/**
 * Pointer/touch drag virtual thumbstick for top-down and isometric movement.
 * Respects `isBlocked(x, y)` (e.g., `Boolean(ui.hitTest(x, y))`) so UI buttons always take priority.
 */
export function bindVirtualStick(
  element: HTMLElement,
  {
    enabled = () => true,
    isBlocked = () => false,
    onGesture = () => {},
    cameraYaw = 0,
    deadzone = 8,
    maxRadius = 56
  }: {
    enabled?(): boolean
    isBlocked?(x: number, y: number): boolean
    onGesture?(): void
    cameraYaw?: number
    deadzone?: number
    maxRadius?: number
  } = {}
) {
  const controller = new AbortController()
  const signal = { signal: controller.signal }
  let pointerId: number | null = null
  let originX = 0, originY = 0, currentX = 0, currentY = 0
  let vecX = 0, vecZ = 0
  const cos = Math.cos(cameraYaw), sin = Math.sin(cameraYaw)

  function clear() {
    pointerId = null
    vecX = 0
    vecZ = 0
  }

  const unsubPause = onTestingPause(paused => { if (paused) clear() })

  function localPoint(event: PointerEvent) {
    const rect = element.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  element.addEventListener('pointerdown', event => {
    if (isTestingPaused()) return
    onGesture()
    if (!enabled()) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const { x, y } = localPoint(event)
    if (isBlocked(x, y)) return
    pointerId = event.pointerId
    originX = currentX = x
    originY = currentY = y
    vecX = vecZ = 0
    try { element.setPointerCapture?.(event.pointerId) } catch { /* Synthetic events cannot be captured. */ }
  }, signal)

  element.addEventListener('pointermove', event => {
    if (pointerId !== event.pointerId) return
    if (isTestingPaused() || !enabled()) { clear(); return }
    const { x, y } = localPoint(event)
    currentX = x
    currentY = y
    const dx = currentX - originX
    const dy = currentY - originY
    const dist = Math.hypot(dx, dy)
    if (dist > deadzone) {
      const mag = Math.min(1, dist / Math.max(1, maxRadius))
      const sx = (dx / dist) * mag
      const sy = (dy / dist) * mag
      vecX = sx * cos + sy * sin
      vecZ = -sx * sin + sy * cos
    } else {
      vecX = vecZ = 0
    }
  }, signal)

  const releasePointer = (event: PointerEvent) => {
    if (event.pointerId === pointerId) clear()
  }
  element.addEventListener('pointerup', releasePointer, signal)
  element.addEventListener('pointercancel', releasePointer, signal)
  element.addEventListener('lostpointercapture', releasePointer, signal)
  globalThis.window?.addEventListener('blur', clear, signal)
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (globalThis.document.hidden) clear()
  }, signal)

  return {
    active: () => pointerId !== null,
    vector: () => ({ x: vecX, z: vecZ }),
    state: (): VirtualStickState => ({ active: pointerId !== null, originX, originY, currentX, currentY, x: vecX, z: vecZ }),
    clear,
    dispose() {
      unsubPause()
      clear()
      controller.abort()
    }
  }
}
