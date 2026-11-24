import { createMachine, definePrimitive } from './ui-machine.ts'
import type { UiPrimitiveInstance, UiSlotProps } from './ui-machine.ts'

export type ButtonState = 'idle' | 'hover' | 'focused' | 'pressed' | 'disabled'
type ButtonEvent =
  | { type: 'POINTER_ENTER' }
  | { type: 'POINTER_LEAVE' }
  | { type: 'POINTER_DOWN' }
  | { type: 'POINTER_UP' }
  | { type: 'FOCUS' }
  | { type: 'BLUR' }
  | { type: 'PRESS' }
  | { type: 'DISABLE' }
  | { type: 'ENABLE' }

export interface ButtonProps {
  id: string
  label: string
  disabled?: boolean
  onPress?(): void
}

export type ButtonApi = {
  press(): void
  focus(): void
  blur(): void
  pointerEnter(): void
  pointerLeave(): void
  pointerDown(): void
  pointerUp(): void
  setDisabled(disabled: boolean): void
}

/** Opt-in headless button state machine. */
export const buttonPrimitive = definePrimitive<ButtonProps, ButtonApi>({
  kind: 'button',
  create(props) {
    let label = props.label
    const machine = createMachine<ButtonState, { hovered: boolean; focused: boolean }, ButtonEvent>({
      initial: props.disabled ? 'disabled' : 'idle',
      context: { hovered: false, focused: false },
      states: {
        idle: {
          on: {
            POINTER_ENTER: { target: 'hover', action: ctx => { ctx.hovered = true } },
            FOCUS: { target: 'focused', action: ctx => { ctx.focused = true } },
            POINTER_DOWN: { target: 'pressed', action: ctx => { ctx.hovered = true } },
            PRESS: { action: () => props.onPress?.() },
            DISABLE: 'disabled'
          }
        },
        hover: {
          on: {
            POINTER_LEAVE: [
              { target: 'focused', guard: ctx => ctx.focused, action: ctx => { ctx.hovered = false } },
              { target: 'idle', action: ctx => { ctx.hovered = false } }
            ],
            FOCUS: { action: ctx => { ctx.focused = true } },
            BLUR: { action: ctx => { ctx.focused = false } },
            POINTER_DOWN: 'pressed',
            PRESS: { action: () => props.onPress?.() },
            DISABLE: 'disabled'
          }
        },
        focused: {
          on: {
            POINTER_ENTER: { target: 'hover', action: ctx => { ctx.hovered = true } },
            POINTER_DOWN: 'pressed',
            BLUR: { target: 'idle', action: ctx => { ctx.focused = false } },
            PRESS: { action: () => props.onPress?.() },
            DISABLE: 'disabled'
          }
        },
        pressed: {
          on: {
            POINTER_UP: [
              { target: 'hover', guard: ctx => ctx.hovered, action: () => props.onPress?.() },
              { target: 'focused', guard: ctx => ctx.focused, action: () => props.onPress?.() },
              { target: 'idle', action: () => props.onPress?.() }
            ],
            POINTER_LEAVE: [
              { target: 'focused', guard: ctx => ctx.focused, action: ctx => { ctx.hovered = false } },
              { target: 'idle', action: ctx => { ctx.hovered = false } }
            ],
            BLUR: { target: 'idle', action: ctx => { ctx.focused = false; ctx.hovered = false } },
            DISABLE: 'disabled'
          }
        },
        disabled: {
          enter(ctx) { ctx.hovered = false; ctx.focused = false },
          on: { ENABLE: 'idle' }
        }
      }
    })

    const api: ButtonApi = {
      press: () => { machine.send('PRESS') },
      focus: () => { machine.send('FOCUS') },
      blur: () => { machine.send('BLUR') },
      pointerEnter: () => { machine.send('POINTER_ENTER') },
      pointerLeave: () => { machine.send('POINTER_LEAVE') },
      pointerDown: () => { machine.send('POINTER_DOWN') },
      pointerUp: () => { machine.send('POINTER_UP') },
      setDisabled: disabled => { machine.send(disabled ? 'DISABLE' : 'ENABLE') }
    }

    function rootSlot(): UiSlotProps {
      return {
        role: 'button',
        state: machine.state,
        label,
        focused: machine.context.focused || machine.state === 'focused',
        disabled: machine.state === 'disabled',
        pressed: machine.state === 'pressed'
      }
    }

    const instance: UiPrimitiveInstance<ButtonApi> = {
      id: props.id,
      kind: 'button',
      get state() { return machine.state },
      api,
      get slots() { return { root: rootSlot() } },
      snapshot() {
        return { id: props.id, kind: 'button', state: machine.state, label, disabled: machine.state === 'disabled', slots: { root: rootSlot() } }
      },
      act(action) {
        if (machine.state === 'disabled') return false
        if (action === 'press' || action === 'click') { api.press(); return true }
        if (action === 'focus') { api.focus(); return true }
        if (action === 'blur') { api.blur(); return true }
        return false
      },
      subscribe(listener) { return machine.subscribe(() => listener()) }
    }
    return instance
  }
})
