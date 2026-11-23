import { createMachine, definePrimitive } from './ui-machine.ts'
import type { UiPrimitiveInstance, UiSlotProps } from './ui-machine.ts'

export interface SelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export type SelectState = 'closed' | 'open' | 'disabled'
type SelectEvent =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'TOGGLE' }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'SELECT'; value: string }
  | { type: 'SYNC'; value: string }
  | { type: 'FOCUS' }
  | { type: 'BLUR' }
  | { type: 'DISABLE' }
  | { type: 'ENABLE' }

export interface SelectProps {
  id: string
  label: string
  options: readonly SelectOption[]
  value?: string
  disabled?: boolean
  onChange?(value: string, option: SelectOption): void
}

export type SelectApi = {
  open(): void
  close(): void
  toggle(): void
  next(): void
  prev(): void
  select(value: string): void
  value(): string
  option(): SelectOption | undefined
  setOptions(options: readonly SelectOption[], value?: string): void
}

/** Opt-in headless selector/cycler state machine (supports both dropdown open and controller L/R cycling). */
export const selectPrimitive = definePrimitive<SelectProps, SelectApi>({
  kind: 'select',
  create(props) {
    let options = [...props.options]
    const initialValue = props.value ?? options.find(o => !o.disabled)?.value ?? options[0]?.value ?? ''

    function stepIndex(current: string, delta: 1 | -1) {
      if (!options.length) return current
      const enabled = options.filter(o => !o.disabled)
      if (!enabled.length) return current
      const index = enabled.findIndex(o => o.value === current)
      if (index < 0) return delta > 0 ? enabled[0].value : enabled[enabled.length - 1].value
      return enabled[(index + delta + enabled.length) % enabled.length].value
    }

    function commit(ctx: { value: string }, nextValue: string) {
      const found = options.find(o => o.value === nextValue && !o.disabled)
      if (!found || found.value === ctx.value) return
      ctx.value = found.value
      props.onChange?.(found.value, found)
    }

    const machine = createMachine<SelectState, { value: string; focused: boolean }, SelectEvent>({
      initial: props.disabled ? 'disabled' : 'closed',
      context: { value: initialValue, focused: false },
      states: {
        closed: {
          on: {
            OPEN: 'open',
            TOGGLE: 'open',
            NEXT: { action: ctx => commit(ctx, stepIndex(ctx.value, 1)) },
            PREV: { action: ctx => commit(ctx, stepIndex(ctx.value, -1)) },
            SELECT: { action: (ctx, e) => commit(ctx, e.value) },
            SYNC: { action: (ctx, e) => { ctx.value = e.value } },
            FOCUS: { action: ctx => { ctx.focused = true } },
            BLUR: { action: ctx => { ctx.focused = false } },
            DISABLE: 'disabled'
          }
        },
        open: {
          on: {
            CLOSE: 'closed',
            TOGGLE: 'closed',
            BLUR: { target: 'closed', action: ctx => { ctx.focused = false } },
            NEXT: { action: ctx => commit(ctx, stepIndex(ctx.value, 1)) },
            PREV: { action: ctx => commit(ctx, stepIndex(ctx.value, -1)) },
            SELECT: { target: 'closed', action: (ctx, e) => commit(ctx, e.value) },
            SYNC: { action: (ctx, e) => { ctx.value = e.value } },
            DISABLE: 'disabled'
          }
        },
        disabled: {
          enter(ctx) { ctx.focused = false },
          on: {
            ENABLE: 'closed',
            SYNC: { action: (ctx, e) => { ctx.value = e.value } }
          }
        }
      }
    })

    const api: SelectApi = {
      open: () => { machine.send('OPEN') },
      close: () => { machine.send('CLOSE') },
      toggle: () => { machine.send('TOGGLE') },
      next: () => { machine.send('NEXT') },
      prev: () => { machine.send('PREV') },
      select: value => { machine.send({ type: 'SELECT', value }) },
      value: () => machine.context.value,
      option: () => options.find(o => o.value === machine.context.value),
      setOptions(nextOptions, value) {
        options = [...nextOptions]
        const fallback = options.find(o => !o.disabled)?.value ?? ''
        const chosen = value !== undefined
          ? (options.some(o => o.value === value && !o.disabled) ? value : fallback)
          : (options.some(o => o.value === machine.context.value && !o.disabled) ? machine.context.value : fallback)
        if (machine.state !== 'disabled' && chosen && chosen !== machine.context.value) {
          machine.send({ type: 'SELECT', value: chosen })
        } else if (chosen !== machine.context.value) {
          machine.send({ type: 'SYNC', value: chosen })
        }
      }
    }

    function rootSlot(): UiSlotProps {
      return {
        role: 'combobox',
        state: machine.state,
        label: props.label,
        value: machine.context.value,
        expanded: machine.state === 'open',
        focused: machine.context.focused,
        disabled: machine.state === 'disabled'
      }
    }

    const instance: UiPrimitiveInstance<SelectApi> = {
      id: props.id,
      kind: 'select',
      get state() { return machine.state },
      api,
      get slots() { return { root: rootSlot() } },
      snapshot() {
        return {
          id: props.id,
          kind: 'select',
          state: machine.state,
          label: props.label,
          disabled: machine.state === 'disabled',
          value: machine.context.value,
          slots: { root: rootSlot() }
        }
      },
      act(action, payload) {
        if (action === 'next' || action === 'press' || action === 'click') { api.next(); return machine.state !== 'disabled' }
        if (action === 'prev') { api.prev(); return machine.state !== 'disabled' }
        if (action === 'select' && typeof payload === 'string') { api.select(payload); return machine.state !== 'disabled' }
        if (action === 'open') { api.open(); return true }
        if (action === 'close') { api.close(); return true }
        return false
      },
      subscribe(listener) { return machine.subscribe(() => listener()) }
    }
    return instance
  }
})
