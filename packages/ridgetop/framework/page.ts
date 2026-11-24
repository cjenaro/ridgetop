import { createPlatform, resolveStorage } from './platform.ts'

export function createGamePage() {
  const storage = resolveStorage()
  const platform = createPlatform()

  function element<T extends HTMLElement = HTMLElement>(id: string): T {
    const node = document.getElementById(id)
    if (!node) throw new Error('Game page is missing #' + id)
    return node as T
  }
  return {
    element,
    url: new URL(window.location.href),
    storage,
    platform,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)'),
    text(id: string, value: string) {
      const node = element(id)
      if (node.textContent !== value) node.textContent = value
    },
    show(id: string, visible: boolean) { element(id).hidden = !visible },
    options(id: string, choices: readonly { label: string; value: string; selected?: boolean; disabled?: boolean }[]) {
      element(id).replaceChildren(...choices.map(({ label, value, selected, disabled }) => {
        const option = new Option(label, value, false, selected)
        option.disabled = Boolean(disabled)
        return option
      }))
    },
    list(id: string, labels: readonly string[]) {
      element(id).replaceChildren(...labels.map(label => {
        const item = document.createElement('li')
        item.textContent = label
        return item
      }))
    },
    controls() { return document.querySelectorAll<HTMLElement>('[data-control]') },
    replaceUrl(url: URL) { window.history.replaceState(null, '', url) },
    roomCode() {
      return Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)), value =>
        value.toString(36)).join('-')
    },
    async copy(text: string) { await navigator.clipboard.writeText(text) },
    async requestJson<T = unknown>(path: string, options?: RequestInit, errorMessage = 'Request failed') {
      const response = await fetch(path, options)
      if (!response.ok) throw new Error(errorMessage)
      return response.json() as Promise<T>
    },
    lifecycle({ hide, restore }: { hide(persisted: boolean): void; restore(): void }) {
      window.addEventListener('pagehide', event => hide(event.persisted))
      window.addEventListener('pageshow', event => { if (event.persisted) restore() })
    }
  }
}
