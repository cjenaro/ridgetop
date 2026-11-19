import type { RoomInput } from './types.ts'

export function bindActionControls<Action extends string>({
  keys, buttons, enabled, onPause = () => {}, onGesture = () => {}, onPress = () => {}
}: {
  keys: Readonly<Record<string, Action>>
  buttons: Iterable<HTMLElement>
  enabled(): boolean
  onPause?(): void
  onGesture?(): void
  onPress?(action: Action): void
}) {
  const down = new Map<string, Action>()
  const pointers = new Map<number, Action>()
  const controller = new AbortController()
  const listeners = { signal: controller.signal }

  function clear() {
    down.clear()
    pointers.clear()
  }

  window.addEventListener('keydown', event => {
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

  for (const button of buttons) {
    const action = button.dataset.control as Action
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !enabled()) return
      event.preventDefault()
      onGesture()
      button.setPointerCapture(event.pointerId)
      pointers.set(event.pointerId, action)
      onPress(action)
    }, listeners)
    button.addEventListener('click', event => {
      if (event.detail === 0 && enabled()) {
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
    active(action: Action) {
      for (const held of down.values()) if (held === action) return true
      for (const held of pointers.values()) if (held === action) return true
      return false
    },
    dispose() {
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
    onPress(action) { if (action === 'jump') jump++ }
  })
  return {
    clear: controls.clear,
    dispose: controls.dispose,
    read(): RoomInput {
      return { left: controls.active('left'), right: controls.active('right'), jump }
    }
  }
}
