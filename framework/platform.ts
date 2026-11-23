export type PlatformKind = 'web' | 'desktop' | 'ios' | 'android'

export interface RidgetopNativeBridge {
  platform?: PlatformKind
  storage?: {
    loadAll?(): Record<string, string>
    set?(key: string, value: string): void
    remove?(key: string): void
    clear?(): void
  }
  fullscreen?: {
    isFullscreen?(): boolean
    set?(enabled: boolean): void | Promise<void>
    toggle?(): void | Promise<void>
  }
  quit?(): void | Promise<void>
  haptics?: {
    impact?(style?: 'light' | 'medium' | 'heavy'): void
  }
  lifecycle?: {
    subscribe?(handlers: { pause?: () => void; resume?: () => void }): (() => void) | void
  }
  steam?: {
    available?(): boolean
    unlockAchievement?(id: string): boolean | Promise<boolean>
    setRichPresence?(key: string, value: string): void
    activateOverlay?(dialog?: string): void
  }
}

export interface RidgetopPlatform {
  readonly kind: PlatformKind
  readonly isNative: boolean
  readonly canQuit: boolean
  quit(): Promise<void>
  isFullscreen(): boolean
  setFullscreen(enabled: boolean): Promise<void>
  toggleFullscreen(): Promise<void>
  haptic(style?: 'light' | 'medium' | 'heavy'): void
  onLifecycle(handlers: { pause?: () => void; resume?: () => void }): () => void
  readonly steam: {
    readonly available: boolean
    unlockAchievement(id: string): Promise<boolean>
    setRichPresence(key: string, value: string): void
    activateOverlay(dialog?: string): void
  }
}

function getBridge(): RidgetopNativeBridge | undefined {
  return (globalThis as { __ridgetopPlatform?: RidgetopNativeBridge }).__ridgetopPlatform
}

function createBridgeStorage(native: NonNullable<RidgetopNativeBridge['storage']>): Storage {
  const entries = new Map<string, string>()
  try {
    const initial = native.loadAll?.()
    if (initial && typeof initial === 'object') {
      for (const [key, value] of Object.entries(initial)) {
        if (typeof value === 'string') entries.set(key, value)
      }
    }
  } catch { /* Start with an empty in-memory cache if native loading fails. */ }

  return {
    get length() { return entries.size },
    key(index: number) {
      if (index < 0 || index >= entries.size) return null
      return Array.from(entries.keys())[index] ?? null
    },
    getItem(key: string) {
      return entries.has(key) ? entries.get(key) : null
    },
    setItem(key: string, value: string) {
      const text = String(value)
      entries.set(key, text)
      try { native.set?.(key, text) } catch { /* Keep the in-memory copy if persistence fails. */ }
    },
    removeItem(key: string) {
      entries.delete(key)
      try { native.remove?.(key) } catch { /* Ignore native removal errors. */ }
    },
    clear() {
      entries.clear()
      try { native.clear?.() } catch { /* Ignore native clear errors. */ }
    }
  }
}

/** Return the native host save store when packaged, or browser localStorage on the web. */
export function resolveStorage(): Storage | undefined {
  const native = getBridge()?.storage
  if (native) return createBridgeStorage(native)
  try { return globalThis.localStorage } catch { return undefined }
}

/** Expose native desktop/mobile capabilities with safe browser fallbacks. */
export function createPlatform(): RidgetopPlatform {
  const bridge = getBridge()
  const kind: PlatformKind = bridge?.platform ?? 'web'
  const vibrateMs = { light: 12, medium: 24, heavy: 42 } as const

  return {
    kind,
    isNative: kind !== 'web',
    canQuit: typeof bridge?.quit === 'function',
    async quit() {
      await bridge?.quit?.()
    },
    isFullscreen() {
      if (bridge?.fullscreen?.isFullscreen) return Boolean(bridge.fullscreen.isFullscreen())
      return Boolean(globalThis.document?.fullscreenElement)
    },
    async setFullscreen(enabled: boolean) {
      if (bridge?.fullscreen?.set) {
        await bridge.fullscreen.set(enabled)
        return
      }
      const doc = globalThis.document
      if (!doc) return
      try {
        if (enabled && !doc.fullscreenElement) await doc.documentElement?.requestFullscreen?.()
        else if (!enabled && doc.fullscreenElement) await doc.exitFullscreen?.()
      } catch { /* Fullscreen requests require a gesture or host permission. */ }
    },
    async toggleFullscreen() {
      if (bridge?.fullscreen?.toggle) {
        await bridge.fullscreen.toggle()
        return
      }
      await this.setFullscreen(!this.isFullscreen())
    },
    haptic(style = 'light') {
      if (bridge?.haptics?.impact) {
        try { bridge.haptics.impact(style) } catch { /* Haptics are optional. */ }
        return
      }
      try {
        if (globalThis.navigator?.userActivation?.hasBeenActive) {
          globalThis.navigator.vibrate?.(vibrateMs[style])
        }
      } catch { /* Ignore unsupported vibration. */ }
    },
    onLifecycle({ pause, resume }: { pause?: () => void; resume?: () => void }) {
      const controller = new AbortController()
      const options = { signal: controller.signal }
      if (globalThis.document) {
        globalThis.document.addEventListener('visibilitychange', () => {
          if (globalThis.document.hidden) pause?.()
          else resume?.()
        }, options)
      }
      if (globalThis.window) {
        globalThis.window.addEventListener('pagehide', () => pause?.(), options)
        globalThis.window.addEventListener('pageshow', () => resume?.(), options)
      }
      const unsubscribeNative = bridge?.lifecycle?.subscribe?.({ pause, resume })
      return () => {
        controller.abort()
        if (typeof unsubscribeNative === 'function') unsubscribeNative()
      }
    },
    steam: {
      get available() {
        return Boolean(bridge?.steam?.available?.())
      },
      async unlockAchievement(id: string) {
        if (!bridge?.steam?.unlockAchievement) return false
        try { return Boolean(await bridge.steam.unlockAchievement(id)) } catch { return false }
      },
      setRichPresence(key: string, value: string) {
        try { bridge?.steam?.setRichPresence?.(key, value) } catch { /* Optional Steam presence. */ }
      },
      activateOverlay(dialog = 'Achievements') {
        try { bridge?.steam?.activateOverlay?.(dialog) } catch { /* Optional Steam overlay. */ }
      }
    }
  }
}
