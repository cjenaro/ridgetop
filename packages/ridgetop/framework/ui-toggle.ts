import { createMachine, definePrimitive } from './ui-machine.ts'
import type { UiPrimitiveInstance, UiSlotProps } from './ui-machine.ts'

export type ToggleState = 'off' | 'on' | 'disabled'
type ToggleEvent =
  | { type: 'TOGGLE' }
  | { type: 'SET'; value: boolean }
  | { type: 'FOCUS' }
  | { type: 'BLUR' }
  | { type: 'DISABLE' }
  | { type: 'ENABLE' }

export interface ToggleProps {
  id: string
  label: string
  checked?: boolean
  disabled?: boolean
  onChange?(checked: boolean): void
}

export type ToggleApi = {
  toggle(): void
  set(checked: boolean): void
  checked(): boolean
  focus(): void
  blur(): void
  setDisabled(disabled: boolean): void
}

/** Opt-in headless toggle/switch state machine. */
export const togglePrimitive = definePrimitive<ToggleProps, ToggleApi>({
  kind: 'toggle',
  create(props) {
    const machine = createMachine<ToggleState, { checked: boolean; focused: boolean }, ToggleEvent>({
      initial: props.disabled ? 'disabled' : props.checked ? 'on' : 'off',
      context: { checked: Boolean(props.checked), focused: false },
      states: {
        off: {
          on: {
            TOGGLE: { target: 'on', action: ctx => { ctx.checked = true; props.onChange?.(true) } },
            SET: { target: 'on', guard: (_ctx, e) => e.value, action: ctx => { ctx.checked = true; props.onChange?.(true) } },
            FOCUS: { action: ctx => { ctx.focused = true } },
            BLUR: { action: ctx => { ctx.focused = false } },
            DISABLE: 'disabled'
          }
        },
        on: {
          on: {
            TOGGLE: { target: 'off', action: ctx => { ctx.checked = false; props.onChange?.(false) } },
            SET: { target: 'off', guard: (_ctx, e) => !e.value, action: ctx => { ctx.checked = false; props.onChange?.(false) } },
            FOCUS: { action: ctx => { ctx.focused = true } },
            BLUR: { action: ctx => { ctx.focused = false } },
            DISABLE: 'disabled'
          }
        },
        disabled: {
          enter(ctx) { ctx.focused = false },
          on: {
            ENABLE: [
              { target: 'on', guard: ctx => ctx.checked },
              { target: 'off' }
            ]
          }
        }
      }
    })

    const api: ToggleApi = {
      toggle: () => { machine.send('TOGGLE') },
      set: value => { machine.send({ type: 'SET', value }) },
      checked: () => machine.context.checked,
      focus: () => { machine.send('FOCUS') },
      blur: () => { machine.send('BLUR') },
      setDisabled: disabled => { machine.send(disabled ? 'DISABLE' : 'ENABLE') }
    }

    function rootSlot(): UiSlotProps {
      return {
        role: 'switch',
        state: machine.state,
        label: props.label,
        checked: machine.context.checked,
        value: machine.context.checked,
        focused: machine.context.focused,
        disabled: machine.state === 'disabled'
      }
    }

    const instance: UiPrimitiveInstance<ToggleApi> = {
      id: props.id,
      kind: 'toggle',
      get state() { return machine.state },
      api,
      get slots() { return { root: rootSlot() } },
      snapshot() {
        return {
          id: props.id,
          kind: 'toggle',
          state: machine.state,
          label: props.label,
          disabled: machine.state === 'disabled',
          value: machine.context.checked,
          slots: { root: rootSlot() }
        }
      },
      act(action, payload) {
        if (machine.state === 'disabled') return false
        if (action === 'toggle' || action === 'press' || action === 'click') { api.toggle(); return true }
        if (action === 'set' && typeof payload === 'boolean') { api.set(payload); return true }
        return false
      },
      subscribe(listener) { return machine.subscribe(() => listener()) }
    }
    return instance
  }
})
