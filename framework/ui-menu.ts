import { createMachine, definePrimitive } from './ui-machine.ts'
import type { UiPrimitiveInstance, UiSlotProps } from './ui-machine.ts'

export interface MenuItem {
  readonly id: string
  readonly disabled?: boolean
}

export interface MenuProps {
  id: string
  items: readonly MenuItem[]
  initialFocused?: string
  loop?: boolean
  onConfirm?(id: string): void
  onBack?(): void
}

export type MenuApi = {
  focusedId(): string | null
  move(delta: 1 | -1): string | null
  focus(id: string): void
  confirm(): void
  back(): void
  setItems(items: readonly MenuItem[]): void
}

/** Opt-in roving-focus menu state machine with automatic focus recovery. */
export const menuPrimitive = definePrimitive<MenuProps, MenuApi>({
  kind: 'menu',
  create(props) {
    let items = [...props.items]
    const loop = props.loop ?? true
    const listeners = new Set<() => void>()

    function enabledItems() {
      return items.filter(item => !item.disabled)
    }

    let focused: string | null =
      props.initialFocused && items.some(item => item.id === props.initialFocused && !item.disabled)
        ? props.initialFocused
        : enabledItems()[0]?.id ?? null

    function notify() {
      for (const listener of listeners) listener()
    }

    function recoverFocus() {
      const enabled = enabledItems()
      if (!enabled.length) focused = null
      else if (!focused || !enabled.some(item => item.id === focused)) focused = enabled[0].id
    }

    const api: MenuApi = {
      focusedId: () => focused,
      move(delta) {
        const enabled = enabledItems()
        if (!enabled.length) {
          focused = null
          notify()
          return null
        }
        const index = focused ? enabled.findIndex(item => item.id === focused) : -1
        let nextIndex = index < 0 ? (delta > 0 ? 0 : enabled.length - 1) : index + delta
        if (loop) nextIndex = (nextIndex + enabled.length) % enabled.length
        else nextIndex = Math.max(0, Math.min(enabled.length - 1, nextIndex))
        focused = enabled[nextIndex].id
        notify()
        return focused
      },
      focus(id) {
        if (items.some(item => item.id === id && !item.disabled)) {
          focused = id
          notify()
        }
      },
      confirm() {
        recoverFocus()
        if (focused) props.onConfirm?.(focused)
      },
      back() {
        props.onBack?.()
      },
      setItems(next) {
        items = [...next]
        recoverFocus()
        notify()
      }
    }

    function rootSlot(): UiSlotProps {
      return { role: 'menu', state: focused ? 'active' : 'empty', value: focused ?? '' }
    }

    const instance: UiPrimitiveInstance<MenuApi> = {
      id: props.id,
      kind: 'menu',
      get state() { return focused ? 'active' : 'empty' },
      api,
      get slots() { return { root: rootSlot() } },
      snapshot() {
        return { id: props.id, kind: 'menu', state: focused ? 'active' : 'empty', value: focused ?? '', slots: { root: rootSlot() } }
      },
      act(action, payload) {
        if (action === 'next') { api.move(1); return true }
        if (action === 'prev') { api.move(-1); return true }
        if (action === 'focus' && typeof payload === 'string') { api.focus(payload); return true }
        if (action === 'confirm') { api.confirm(); return Boolean(focused) }
        if (action === 'back') { api.back(); return true }
        return false
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }
    return instance
  }
})

export type DialogState = 'closed' | 'open'
type DialogEvent = { type: 'OPEN' } | { type: 'CLOSE' } | { type: 'TOGGLE' }

export interface DialogProps {
  id: string
  open?: boolean
  onOpenChange?(open: boolean): void
}

export type DialogApi = {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
}

/** Opt-in modal dialog state machine (handles open/close transitions cleanly). */
export const dialogPrimitive = definePrimitive<DialogProps, DialogApi>({
  kind: 'dialog',
  create(props) {
    const machine = createMachine<DialogState, Record<string, never>, DialogEvent>({
      initial: props.open ? 'open' : 'closed',
      context: {},
      states: {
        closed: {
          on: {
            OPEN: { target: 'open', action: () => props.onOpenChange?.(true) },
            TOGGLE: { target: 'open', action: () => props.onOpenChange?.(true) }
          }
        },
        open: {
          on: {
            CLOSE: { target: 'closed', action: () => props.onOpenChange?.(false) },
            TOGGLE: { target: 'closed', action: () => props.onOpenChange?.(false) }
          }
        }
      }
    })

    const api: DialogApi = {
      open: () => { machine.send('OPEN') },
      close: () => { machine.send('CLOSE') },
      toggle: () => { machine.send('TOGGLE') },
      isOpen: () => machine.state === 'open'
    }

    function rootSlot(): UiSlotProps {
      return { role: 'dialog', state: machine.state, expanded: machine.state === 'open' }
    }

    const instance: UiPrimitiveInstance<DialogApi> = {
      id: props.id,
      kind: 'dialog',
      get state() { return machine.state },
      api,
      get slots() { return { root: rootSlot() } },
      snapshot() {
        return { id: props.id, kind: 'dialog', state: machine.state, slots: { root: rootSlot() } }
      },
      act(action) {
        if (action === 'open') { api.open(); return true }
        if (action === 'close') { api.close(); return true }
        if (action === 'toggle') { api.toggle(); return true }
        return false
      },
      subscribe(listener) { return machine.subscribe(() => listener()) }
    }
    return instance
  }
})
