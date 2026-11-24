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

const EMPTY_PADS: readonly Gamepad[] = []

function readPads(): readonly Gamepad[] {
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

export function bindActionControls<Action extends string>({
  keys, buttons, enabled, onPause = () => {}, onGesture = () => {}, onPress = () => {},
  gamepad, pauseButtons = [9]
}: {
  keys: Readonly<Record<string, Action>>
  buttons: Iterable<HTMLElement>
  enabled(): boolean
  onPause?(): void
  onGesture?(): void
  onPress?(action: Action): void
  gamepad?: false | Partial<Record<Action, readonly GamepadBinding[]>>
  pauseButtons?: readonly number[]
}) {
  const down = new Map<string, Action>()
  const pointers = new Map<number, Action>()
  const padDown = new Set<Action>()
  let padPauseDown = false
  let padFrame: number | undefined
  let disposed = false
  const controller = new AbortController()
  const listeners = { signal: controller.signal }

  const actions = Array.from(new Set(Object.values(keys))) as Action[]
  const pauseBindings: readonly GamepadBinding[] = pauseButtons.map(button => ({ button }))
  const padBindings = new Map<Action, readonly GamepadBinding[]>()
  if (gamepad !== false) {
    for (const action of actions) {
      const explicit = gamepad?.[action]
      const chosen = explicit ?? defaultGamepadBindings[action]
      if (chosen?.length) padBindings.set(action, chosen)
    }
    if (gamepad) {
      for (const [action, list] of Object.entries(gamepad) as [Action, readonly GamepadBinding[] | undefined][]) {
        if (list?.length) padBindings.set(action, list)
      }
    }
  }

  function clear() {
    down.clear()
    pointers.clear()
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
    const pads = readPads()
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
      if (!readPads().length) {
        padDown.clear()
        padPauseDown = false
        stopPadLoop()
      }
    }, listeners)
    if (readPads().length) ensurePadLoop()
  }

  for (const button of buttons) {
    const action = button.dataset.control as Action
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
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => pointers.delete((event as PointerEvent).pointerId), listeners)
    }
  }

  return {
    clear,
    poll,
    active(action: Action) {
      if (isTestingPaused()) return false
      if (gamepad !== false && poll()) ensurePadLoop()
      for (const held of down.values()) if (held === action) return true
      for (const held of pointers.values()) if (held === action) return true
      return padDown.has(action)
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
  buttons: Iterable<HTMLElement>
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
    poll: controls.poll,
    dispose: controls.dispose,
    read(): RoomInput {
      return { left: controls.active('left'), right: controls.active('right'), jump }
    }
  }
}

function visibleFocusables(root: ParentNode): HTMLElement[] {
  const selector = 'button:not([disabled]), a[href], select:not([disabled]), summary, input:not([type="hidden"]):not([disabled])'
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(el => {
    if (el.hidden || el.closest('[hidden]')) return false
    const style = globalThis.getComputedStyle?.(el)
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false
    return true
  })
}

const menuPrevBindings: readonly GamepadBinding[] = [
  { button: 12 }, { button: 14 },
  { axis: 1, direction: -1, threshold: .5 }, { axis: 0, direction: -1, threshold: .5 }
]
const menuNextBindings: readonly GamepadBinding[] = [
  { button: 13 }, { button: 15 },
  { axis: 1, direction: 1, threshold: .5 }, { axis: 0, direction: 1, threshold: .5 }
]
const menuConfirmBinding: GamepadBinding = { button: 0 }
const menuBackBinding: GamepadBinding = { button: 1 }

/** Enable D-pad / Left Stick menu navigation and A/B confirm/back on gamepads and Steam Deck. */
export function bindMenuGamepad({
  enabled, container = () => document, onBack
}: {
  enabled(): boolean
  container?(): ParentNode | null
  onBack?(): void
}) {
  let disposed = false
  let frame: number | undefined
  let lastDir = 0
  let lastMoveAt = 0
  let confirmDown = false
  let backDown = false
  const controller = new AbortController()
  const listeners = { signal: controller.signal }

  function step(now = performance.now()) {
    if (disposed || isTestingPaused()) return
    const pads = readPads()
    if (!pads.length) {
      lastDir = 0
      confirmDown = false
      backDown = false
      return
    }
    const confirm = pads.some(p => bindingActive(p, menuConfirmBinding))
    const back = pads.some(p => bindingActive(p, menuBackBinding))
    if (!enabled()) {
      lastDir = 0
      confirmDown = confirm
      backDown = back
      return
    }
    const prev = pads.some(p => menuPrevBindings.some(b => bindingActive(p, b)))
    const next = pads.some(p => menuNextBindings.some(b => bindingActive(p, b)))
    const dir = next ? 1 : prev ? -1 : 0
    const shouldMove = dir !== 0 && (dir !== lastDir || now - lastMoveAt >= 200)
    const shouldConfirm = confirm && !confirmDown
    const shouldBack = back && !backDown
    lastDir = dir
    confirmDown = confirm
    backDown = back
    if (shouldMove || shouldConfirm) {
      const root = container()
      const items = root ? visibleFocusables(root) : []
      if (shouldMove && items.length) {
        const current = document.activeElement instanceof HTMLElement ? items.indexOf(document.activeElement) : -1
        const index = current < 0 ? (dir > 0 ? 0 : items.length - 1) : (current + dir + items.length) % items.length
        items[index]?.focus()
        lastMoveAt = now
      }
      if (shouldConfirm) {
        const active = document.activeElement instanceof HTMLElement && items.includes(document.activeElement)
          ? document.activeElement : items[0]
        if (active) {
          active.focus()
          if (active instanceof HTMLSelectElement) {
            const count = active.options.length
            if (count > 0) {
              const start = active.selectedIndex >= 0 ? active.selectedIndex : -1
              for (let offset = 1; offset <= count; offset++) {
                const candidate = (start + offset) % count
                if (!active.options[candidate]?.disabled) {
                  active.selectedIndex = candidate
                  active.dispatchEvent(new Event('change', { bubbles: true }))
                  break
                }
              }
            }
          } else {
            active.click()
          }
        }
      }
    }

    if (shouldBack) onBack?.()
  }

  function ensureLoop() {
    if (disposed || frame !== undefined || typeof globalThis.requestAnimationFrame !== 'function') return
    const tick = (now: number) => {
      frame = undefined
      if (disposed) return
      step(now)
      if (!disposed && readPads().length) frame = globalThis.requestAnimationFrame(tick)
    }
    frame = globalThis.requestAnimationFrame(tick)
  }

  window.addEventListener('gamepadconnected', () => ensureLoop(), listeners)
  if (readPads().length) ensureLoop()

  return {
    poll: step,
    dispose() {
      disposed = true
      if (frame !== undefined) {
        globalThis.cancelAnimationFrame?.(frame)
        frame = undefined
      }
      controller.abort()
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

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    element.addEventListener(type, event => {
      if ((event as PointerEvent).pointerId === pointerId) clear()
    }, signal)
  }
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
