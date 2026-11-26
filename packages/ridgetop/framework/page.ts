import { createPlatform, resolveStorage } from './platform.ts'
import type { RidgetopPlatform } from './platform.ts'
import type { Backend } from './types.ts'

export interface MediaQueryLike {
  readonly matches: boolean
  readonly media?: string
  addEventListener?(type: 'change', listener: (event: { readonly matches: boolean }) => void): void
  removeEventListener?(type: 'change', listener: (event: { readonly matches: boolean }) => void): void
}

export interface GamePageOptions {
  document?: Pick<Document, 'querySelector'>
  location?: { readonly href: string }
  history?: Pick<History, 'replaceState'>
  matchMedia?(query: string): MediaQueryLike
  storage?: Storage | undefined
  platform?: RidgetopPlatform
  clipboard?: { writeText(text: string): Promise<void> }
  fetch?: typeof globalThis.fetch
  crypto?: Pick<Crypto, 'getRandomValues'>
}

function isMediaQueryList(value: MediaQueryLike): value is MediaQueryList {
  return 'onchange' in value && 'dispatchEvent' in value && typeof value.dispatchEvent === 'function'
}

function toMediaQueryList(query: string, source?: MediaQueryLike): MediaQueryList {
  if (source && isMediaQueryList(source)) return source
  const target = new EventTarget()
  const wrapped = new WeakMap<EventListenerOrEventListenerObject, (event: { readonly matches: boolean }) => void>()
  const mql: MediaQueryList = {
    get matches() { return Boolean(source?.matches) },
    get media() { return source?.media ?? query },
    onchange: null,
    addListener(callback) {
      if (!callback) return
      mql.addEventListener('change', callback)
    },
    removeListener(callback) {
      if (!callback) return
      mql.removeEventListener('change', callback)
    },
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions
    ) {
      if (type === 'change' && listener && source?.addEventListener) {
        let handler = wrapped.get(listener)
        if (!handler) {
          handler = event => {
            const mqlEvent = Object.assign(new Event('change'), { matches: event.matches, media: mql.media })
            if (typeof listener === 'function') listener.call(mql, mqlEvent)
            else listener.handleEvent(mqlEvent)
          }
          wrapped.set(listener, handler)
        }
        source.addEventListener('change', handler)
        return
      }
      target.addEventListener(type, listener, options)
    },
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions
    ) {
      if (type === 'change' && listener && source?.removeEventListener) {
        const handler = wrapped.get(listener)
        if (handler) {
          source.removeEventListener('change', handler)
          wrapped.delete(listener)
        }
        return
      }
      target.removeEventListener(type, listener, options)
    },
    dispatchEvent(event) {
      return target.dispatchEvent(event)
    }
  }
  return mql
}

export function createGamePage(options: GamePageOptions = {}) {
  const doc = options.document ?? globalThis.document
  const href = options.location?.href ?? globalThis.window?.location?.href ?? globalThis.location?.href ?? 'http://localhost/'
  const url = new URL(href)
  const hist = options.history ?? globalThis.window?.history
  const matchMediaFn: (query: string) => MediaQueryLike | undefined =
    options.matchMedia ?? (query => globalThis.window?.matchMedia?.(query))
  const storage = 'storage' in options ? options.storage : resolveStorage()
  const platform = options.platform ?? createPlatform()
  const clipboard = options.clipboard ?? globalThis.navigator?.clipboard
  const fetchFn = options.fetch ?? globalThis.fetch
  const cryptoObj = options.crypto ?? globalThis.crypto

  const reducedMotion = toMediaQueryList('(prefers-reduced-motion: reduce)', matchMediaFn('(prefers-reduced-motion: reduce)'))
  const touchSource = matchMediaFn('(any-pointer: coarse)')
  const touch = toMediaQueryList('(any-pointer: coarse)', touchSource)
  const disposers = new Set<() => void>()
  let disposed = false

  function onDispose(fn: () => void): () => void {
    if (disposed) {
      fn()
      return () => {}
    }
    disposers.add(fn)
    return () => { disposers.delete(fn) }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    const list = Array.from(disposers).reverse()
    disposers.clear()
    let firstError: unknown
    for (const fn of list) {
      try {
        fn()
      } catch (error) {
        if (firstError === undefined) firstError = error
      }
    }
    if (firstError !== undefined) throw firstError
  }

  function element<T extends HTMLElement = HTMLElement>(id: string): T {
    const selector = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? '#' + CSS.escape(id)
      : `[id="${id.replace(/["\\]/g, '\\$&')}"]`
    const node = doc?.querySelector<T>(selector)
    if (!node) throw new Error('Game page is missing #' + id)
    return node
  }

  function query(name: string): string | null {
    return url.searchParams.get(name)
  }

  function requestedBackend(fallback: Backend = 'auto'): Backend {
    const canvasParam = url.searchParams.get('canvas')
    if (canvasParam !== null && canvasParam !== '0' && canvasParam.toLowerCase() !== 'false') {
      return 'canvas'
    }
    const renderer = url.searchParams.get('renderer')?.toLowerCase()
    if (renderer === 'webgpu' || renderer === 'webgl2' || renderer === 'canvas' || renderer === 'auto') {
      return renderer
    }
    return fallback
  }

  function onTouchChange(listener: (isTouch: boolean) => void): () => void {
    const handler = (event: { readonly matches: boolean }) => {
      listener(Boolean(event?.matches ?? touch.matches))
    }
    if (touchSource?.addEventListener) touchSource.addEventListener('change', handler)
    let active = true
    const unsubscribe = () => {
      if (!active) return
      active = false
      if (touchSource?.removeEventListener) touchSource.removeEventListener('change', handler)
      disposers.delete(unsubscribe)
    }
    onDispose(unsubscribe)
    return unsubscribe
  }

  return {
    element,
    url,
    query,
    requestedBackend,
    storage,
    platform,
    reducedMotion,
    touch,
    onTouchChange,
    onDispose,
    dispose,
    replaceUrl(nextUrl: URL) { hist?.replaceState(null, '', nextUrl) },
    roomCode() {
      return Array.from(cryptoObj.getRandomValues(new Uint32Array(2)), value =>
        value.toString(36)).join('-')
    },
    async copy(text: string) {
      if (!clipboard?.writeText) throw new Error('Clipboard is unavailable')
      await clipboard.writeText(text)
    },
    async requestJson<T = unknown>(path: string, init?: RequestInit, errorMessage = 'Request failed'): Promise<T> {
      const response = await fetchFn(path, init)
      if (!response.ok) throw new Error(errorMessage)
      return response.json()
    }
  }
}

export type GamePage = ReturnType<typeof createGamePage>
