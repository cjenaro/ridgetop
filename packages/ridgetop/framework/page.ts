import { createPlatform, resolveStorage } from './platform.ts'

export function createGamePage() {
  const storage = resolveStorage()
  const platform = createPlatform()

  function element<T extends HTMLElement = HTMLElement>(id: string): T {
    const selector = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? '#' + CSS.escape(id)
      : `[id="${id.replace(/["\\]/g, '\\$&')}"]`
    const node = document.querySelector<T>(selector)
    if (!node) throw new Error('Game page is missing #' + id)
    return node
  }
  return {
    element,
    url: new URL(window.location.href),
    storage,
    platform,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)'),
    replaceUrl(url: URL) { window.history.replaceState(null, '', url) },
    roomCode() {
      return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)), value =>
        value.toString(36)).join('-')
    },
    async copy(text: string) { await navigator.clipboard.writeText(text) },
    async requestJson<T = unknown>(path: string, options?: RequestInit, errorMessage = 'Request failed'): Promise<T> {
      const response = await fetch(path, options)
      if (!response.ok) throw new Error(errorMessage)
      return response.json()
    }
  }
}
