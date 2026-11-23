import { createMachine, definePrimitive } from './ui-machine.ts'
import type { UiPrimitiveInstance, UiSlotProps } from './ui-machine.ts'

export type SliderState = 'idle' | 'focused' | 'dragging' | 'disabled'
type SliderEvent =
  | { type: 'FOCUS' }
  | { type: 'BLUR' }
  | { type: 'DRAG_START'; ratio?: number }
  | { type: 'DRAG_MOVE'; ratio: number }
  | { type: 'DRAG_END' }
  | { type: 'STEP'; delta: number }
  | { type: 'SET'; value: number }
  | { type: 'DISABLE' }
  | { type: 'ENABLE' }

export interface SliderProps {
  id: string
  label: string
  min?: number
  max?: number
  step?: number
  value?: number
  disabled?: boolean
  onChange?(value: number): void
}

export type SliderApi = {
  value(): number
  ratio(): number
  set(value: number): void
  setRatio(ratio: number): void
  step(delta: number): void
  dragStart(ratio?: number): void
  dragMove(ratio: number): void
  dragEnd(): void
}

/** Opt-in headless range slider state machine. */
export const sliderPrimitive = definePrimitive<SliderProps, SliderApi>({
  kind: 'slider',
  create(props) {
    const min = props.min ?? 0
    const max = props.max ?? 1
    const stepSize = props.step ?? 0.05

    function quantize(raw: number) {
      if (!Number.isFinite(raw)) return min
      const clamped = Math.max(min, Math.min(max, raw))
      if (!(stepSize > 0)) return clamped
      const snapped = min + Math.round((clamped - min) / stepSize) * stepSize
      return Number(Math.max(min, Math.min(max, snapped)).toFixed(6))
    }

    function assign(ctx: { value: number }, next: number) {
      if (!Number.isFinite(next)) return
      const value = quantize(next)
      if (value === ctx.value) return
      ctx.value = value
      props.onChange?.(value)
    }

    const machine = createMachine<SliderState, { value: number }, SliderEvent>({
      initial: props.disabled ? 'disabled' : 'idle',
      context: { value: quantize(props.value ?? min) },
      states: {
        idle: {
          on: {
            FOCUS: 'focused',
            DRAG_START: { target: 'dragging', action: (ctx, e) => { if (e.ratio !== undefined) assign(ctx, min + (max - min) * e.ratio) } },
            SET: { action: (ctx, e) => assign(ctx, e.value) },
            STEP: { action: (ctx, e) => assign(ctx, ctx.value + e.delta * stepSize) },
            DISABLE: 'disabled'
          }
        },
        focused: {
          on: {
            BLUR: 'idle',
            DRAG_START: { target: 'dragging', action: (ctx, e) => { if (e.ratio !== undefined) assign(ctx, min + (max - min) * e.ratio) } },
            SET: { action: (ctx, e) => assign(ctx, e.value) },
            STEP: { action: (ctx, e) => assign(ctx, ctx.value + e.delta * stepSize) },
            DISABLE: 'disabled'
          }
        },
        dragging: {
          on: {
            DRAG_MOVE: { action: (ctx, e) => assign(ctx, min + (max - min) * e.ratio) },
            DRAG_END: 'focused',
            BLUR: 'idle',
            DISABLE: 'disabled'
          }
        },
        disabled: {
          on: { ENABLE: 'idle' }
        }
      }
    })

    const api: SliderApi = {
      value: () => machine.context.value,
      ratio: () => (max === min ? 0 : (machine.context.value - min) / (max - min)),
      set: value => { machine.send({ type: 'SET', value }) },
      setRatio: ratio => { machine.send({ type: 'SET', value: min + (max - min) * ratio }) },
      step: delta => { machine.send({ type: 'STEP', delta }) },
      dragStart: ratio => { machine.send({ type: 'DRAG_START', ratio }) },
      dragMove: ratio => { machine.send({ type: 'DRAG_MOVE', ratio }) },
      dragEnd: () => { machine.send('DRAG_END') }
    }

    function rootSlot(): UiSlotProps {
      return {
        role: 'slider',
        state: machine.state,
        label: props.label,
        value: machine.context.value,
        focused: machine.state === 'focused' || machine.state === 'dragging',
        disabled: machine.state === 'disabled'
      }
    }

    const instance: UiPrimitiveInstance<SliderApi> = {
      id: props.id,
      kind: 'slider',
      get state() { return machine.state },
      api,
      get slots() { return { root: rootSlot() } },
      snapshot() {
        return {
          id: props.id,
          kind: 'slider',
          state: machine.state,
          label: props.label,
          disabled: machine.state === 'disabled',
          value: machine.context.value,
          slots: { root: rootSlot() }
        }
      },
      act(action, payload) {
        if (machine.state === 'disabled') return false
        if (action === 'set' && typeof payload === 'number') { api.set(payload); return true }
        if (action === 'step' && typeof payload === 'number') { api.step(payload); return true }
        return false
      },
      subscribe(listener) { return machine.subscribe(() => listener()) }
    }
    return instance
  }
})
