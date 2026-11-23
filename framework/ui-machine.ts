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

/** Tiny finite state machine for deterministic, zero-dependency UI widgets. */
export function createMachine<S extends string, C extends Record<string, unknown>, E extends { type: string }>(
  config: MachineConfig<S, C, E>
): StateMachine<S, C, E> {
  let current: S = config.initial
  const context: C = { ...config.context }
  const listeners = new Set<(state: S, context: Readonly<C>) => void>()
  config.states[current]?.enter?.(context)

  function notify() {
    for (const listener of listeners) listener(current, context)
  }

  function applyTransition(candidate: S | MachineTransition<S, C, E>, event: E) {
    if (typeof candidate === 'string') {
      const prev = current
      if (prev !== candidate) config.states[prev]?.exit?.(context, event)
      current = candidate
      if (prev !== candidate) config.states[current]?.enter?.(context, event)
      return true
    }
    if (candidate.guard && !candidate.guard(context, event)) return false
    const next = candidate.target ?? current
    const changed = next !== current
    if (changed) config.states[current]?.exit?.(context, event)
    candidate.action?.(context, event)
    current = next
    if (changed) config.states[current]?.enter?.(context, event)
    return true
  }

  return {
    get state() { return current },
    get context() { return context },
    matches(state) { return current === state },
    send(raw) {
      const event = (typeof raw === 'string' ? { type: raw } : raw) as E
      const spec = config.states[current]?.on?.[event.type as E['type']]
      if (!spec) return current
      const list = Array.isArray(spec) ? spec : [spec]
      for (const candidate of list) {
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

export interface UiPrimitiveInstance<Api extends Record<string, (...args: any[]) => unknown> = Record<string, (...args: any[]) => unknown>> {
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

export interface PrimitiveDefinition<Props, Api extends Record<string, (...args: any[]) => unknown>> {
  readonly kind: string
  create(props: Props): UiPrimitiveInstance<Api>
}

/** Define a standalone, composable headless UI primitive (`state` + `api` + `slots` + agent actions). */
export function definePrimitive<Props, Api extends Record<string, (...args: any[]) => unknown>>(
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
