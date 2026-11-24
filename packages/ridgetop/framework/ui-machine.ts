export interface MachineTransition<S extends string, C, E extends { type: string }> {
  target?: S
  guard?(context: Readonly<C>, event: E): boolean
  action?(context: C, event: E): void
}

export interface MachineStateConfig<S extends string, C, E extends { type: string }> {
  on?: {
    [K in E['type']]?: S
      | MachineTransition<S, C, Extract<E, { type: K }>>
      | readonly MachineTransition<S, C, Extract<E, { type: K }>>[]
  }
  enter?(context: C, event?: E): void
  exit?(context: C, event?: E): void
}

export interface MachineConfig<S extends string, C, E extends { type: string }> {
  initial: S
  context: C
  states: Record<S, MachineStateConfig<S, C, E>>
}

export interface StateMachine<S extends string, C, E extends { type: string }> {
  readonly state: S
  readonly context: Readonly<C>
  matches(state: S): boolean
  send(event: E | E['type']): S
  subscribe(listener: (state: S, context: Readonly<C>) => void): () => void
}

type AnyTransition<S extends string, C> = {
  target?: S
  guard?(context: Readonly<C>, event: never): boolean
  action?(context: C, event: never): void
}

function isTransitionList<S extends string, C>(
  spec: S | AnyTransition<S, C> | readonly AnyTransition<S, C>[]
): spec is readonly AnyTransition<S, C>[] {
  return Array.isArray(spec)
}

function toTransitionList<S extends string, C>(
  spec: S | AnyTransition<S, C> | readonly AnyTransition<S, C>[]
): readonly (S | AnyTransition<S, C>)[] {
  return isTransitionList(spec) ? spec : [spec]
}

/** Tiny finite state machine for deterministic, zero-dependency UI widgets. */
export function createMachine<S extends string, C extends Record<string, unknown>, E extends { type: string }>(
  config: MachineConfig<S, C, E>
): StateMachine<S, C, E> {
  let current: S = config.initial
  const context: C = { ...config.context }
  const listeners = new Set<(state: S, context: Readonly<C>) => void>()
  const exiting = new Set<S>()
  config.states[current]?.enter?.(context)

  function notify() {
    for (const listener of listeners) listener(current, context)
  }

  function runEnter(next: S, event: E | { readonly type: E['type'] }) {
    const state = config.states[next]
    if (state?.enter) Reflect.apply(state.enter, state, [context, event])
  }

  function runExit(prev: S, event: E | { readonly type: E['type'] }) {
    if (exiting.has(prev)) return false
    exiting.add(prev)
    try {
      const state = config.states[prev]
      if (state?.exit) Reflect.apply(state.exit, state, [context, event])
    }
    finally { exiting.delete(prev) }
    return current !== prev
  }

  function applyTransition(candidate: S | AnyTransition<S, C>, event: E | { readonly type: E['type'] }) {
    if (typeof candidate === 'string') {
      const prev = current
      if (prev !== candidate && runExit(prev, event)) return true
      current = candidate
      if (prev !== candidate) runEnter(current, event)
      return true
    }
    if (candidate.guard && !Reflect.apply(candidate.guard, candidate, [context, event])) return false
    const prev = current
    const next = candidate.target ?? prev
    const changed = next !== prev
    if (changed && runExit(prev, event)) return true
    current = next
    if (candidate.action) Reflect.apply(candidate.action, candidate, [context, event])
    if (changed && current === next) runEnter(next, event)
    return true
  }

  return {
    get state() { return current },
    get context() { return context },
    matches(state) { return current === state },
    send(raw) {
      const eventType: E['type'] = typeof raw === 'string' ? raw : raw.type
      const event: E | { readonly type: E['type'] } = typeof raw === 'string' ? { type: raw } : raw
      const spec = config.states[current]?.on?.[eventType]
      if (!spec) return current
      for (const candidate of toTransitionList(spec)) {
        if (applyTransition(candidate, event)) {
          notify()
          break
        }
      }
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export interface UiSlotProps {
  readonly role: string
  readonly state: string
  readonly focused?: boolean
  readonly disabled?: boolean
  readonly pressed?: boolean
  readonly checked?: boolean
  readonly expanded?: boolean
  readonly value?: string | number | boolean
  readonly label?: string
}

export interface UiPrimitiveInstance<Api extends Record<string, (...args: never[]) => unknown> = Record<string, (...args: never[]) => unknown>> {
  readonly id: string
  readonly kind: string
  readonly state: string
  readonly api: Api
  readonly slots: Record<string, UiSlotProps>
  snapshot(): UiPrimitiveSnapshot
  act(action: string, payload?: unknown): boolean
  subscribe(listener: () => void): () => void
}

export interface UiPrimitiveSnapshot {
  readonly id: string
  readonly kind: string
  readonly state: string
  readonly label?: string
  readonly disabled?: boolean
  readonly value?: string | number | boolean
  readonly slots: Record<string, UiSlotProps>
}

export interface PrimitiveDefinition<Props, Api extends Record<string, (...args: never[]) => unknown>> {
  readonly kind: string
  create(props: Props): UiPrimitiveInstance<Api>
}

/** Define a standalone, composable headless UI primitive (`state` + `api` + `slots` + agent actions). */
export function definePrimitive<Props, Api extends Record<string, (...args: never[]) => unknown>>(
  definition: PrimitiveDefinition<Props, Api>
): PrimitiveDefinition<Props, Api> {
  return definition
}

/** Programmatic runtime bridge (`snapshot`, `query`, `act`) so tests and coding agents can inspect and drive Canvas UI. */
export function createUiAgent(getPrimitives: () => Iterable<UiPrimitiveInstance>) {
  return {
    snapshot(): UiPrimitiveSnapshot[] {
      return Array.from(getPrimitives(), item => item.snapshot())
    },
    query(filter: { id?: string; kind?: string; state?: string; label?: string } = {}): UiPrimitiveSnapshot[] {
      return this.snapshot().filter(item =>
        (filter.id === undefined || item.id === filter.id) &&
        (filter.kind === undefined || item.kind === filter.kind) &&
        (filter.state === undefined || item.state === filter.state) &&
        (filter.label === undefined || item.label === filter.label)
      )
    },
    act(id: string, action: string, payload?: unknown): boolean {
      for (const item of getPrimitives()) {
        if (item.id === id) return item.act(action, payload)
      }
      return false
    }
  }
}
