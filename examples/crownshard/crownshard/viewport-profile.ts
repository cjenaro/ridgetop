/**
 * Crownshard unified ViewportProfile, live iOS safe-area inset reader,
 * input-modality detection & live tracker (touch vs keyboard/mouse), and
 * modality-aware UI copy helper.
 *
 * Pure and dependency-free so it runs identically in browser and Node tests.
 */

export interface SafeAreaInsets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export type DeviceClass = 'portraitPhone' | 'landscapePhone' | 'tablet' | 'desktop'

export type InputModality = 'touch' | 'keyboard_mouse'

export interface ViewportProfile {
  readonly width: number
  readonly height: number
  readonly orientation: 'portrait' | 'landscape'
  readonly deviceClass: DeviceClass
  readonly isPhone: boolean
  readonly isPortraitPhone: boolean
  readonly isLandscapePhone: boolean
  readonly isTablet: boolean
  readonly isCompact: boolean
  readonly isTouchPrimary: boolean
  readonly showKeycaps: boolean
  /** 44px on touch-primary or phone viewports (Apple HIG / WCAG target), else 28px. */
  readonly minTouchTarget: number
  readonly safeArea: SafeAreaInsets
}

export interface ViewportProfileOptions {
  readonly modality?: InputModality
  readonly safeArea?: Partial<SafeAreaInsets>
  readonly minMargin?: number
}

const DEFAULT_MIN_MARGIN = 8
const EMULATED_MOUSE_GUARD_MS = 800

const MODIFIER_ONLY_KEYS = new Set([
  '',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'AltGraph',
  'OS',
  'Fn',
  'FnLock',
  'Process',
  'Unidentified'
])

function clampSafeInset(raw: number | undefined, minMargin: number): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0
  return Math.max(minMargin, value)
}

/**
 * Pure computation of Crownshard's unified viewport profile.
 *
 * Breakpoints are calibrated for:
 * - Portrait phones: iPhone SE (375x667), iPhone 14/15/16 (390x844, 393x852), Pro Max (430x932)
 * - Landscape phones: 667x375, 844x390, 852x393, 932x430 (height < 500 && width < 960)
 * - Tablets: iPad portrait/landscape (768x1024, 1024x768) and small windows (width < 1100 || height < 720)
 * - Desktop: >= 1100x720
 */
export function computeViewportProfile(
  width: number,
  height: number,
  opts: ViewportProfileOptions = {}
): ViewportProfile {
  const safeW = Number.isFinite(width) && width > 0 ? width : 1280
  const safeH = Number.isFinite(height) && height > 0 ? height : 720
  const orientation: 'portrait' | 'landscape' = safeH > safeW ? 'portrait' : 'landscape'

  const isPortraitPhone = (safeW < 660 && safeH >= safeW) || safeW < 600
  const isLandscapePhone = !isPortraitPhone && safeH < 500 && safeW < 960
  const isTablet = !isPortraitPhone && !isLandscapePhone && (safeW < 1100 || safeH < 720)
  const deviceClass: DeviceClass = isPortraitPhone
    ? 'portraitPhone'
    : isLandscapePhone
      ? 'landscapePhone'
      : isTablet
        ? 'tablet'
        : 'desktop'

  const isPhone = isPortraitPhone || isLandscapePhone
  const isCompact = isPhone || safeW < 900 || safeH < 600

  const modality: InputModality = opts.modality ?? 'keyboard_mouse'
  const isTouchPrimary = modality === 'touch'
  const showKeycaps = !isTouchPrimary
  const minTouchTarget = isTouchPrimary || isPhone ? 44 : 28

  const minMargin =
    typeof opts.minMargin === 'number' && Number.isFinite(opts.minMargin) && opts.minMargin >= 0
      ? opts.minMargin
      : DEFAULT_MIN_MARGIN

  const safeArea: SafeAreaInsets = {
    top: clampSafeInset(opts.safeArea?.top, minMargin),
    right: clampSafeInset(opts.safeArea?.right, minMargin),
    bottom: clampSafeInset(opts.safeArea?.bottom, minMargin),
    left: clampSafeInset(opts.safeArea?.left, minMargin)
  }

  return {
    width: safeW,
    height: safeH,
    orientation,
    deviceClass,
    isPhone,
    isPortraitPhone,
    isLandscapePhone,
    isTablet,
    isCompact,
    isTouchPrimary,
    showKeycaps,
    minTouchTarget,
    safeArea
  }
}

function parseCssPx(raw: string | null | undefined): number {
  if (!raw) return 0
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Reads live iOS/browser safe-area insets from `:root` custom properties
 * (`--sat`, `--sar`, `--sab`, `--sal`) defined in `game-ui.css`.
 * Safe in SSR/Node where `document` or `getComputedStyle` are absent.
 */
export function readDomSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function' || !document.documentElement) {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
  try {
    const style = getComputedStyle(document.documentElement)
    return {
      top: parseCssPx(style.getPropertyValue('--sat')),
      right: parseCssPx(style.getPropertyValue('--sar')),
      bottom: parseCssPx(style.getPropertyValue('--sab')),
      left: parseCssPx(style.getPropertyValue('--sal'))
    }
  } catch {
    return { top: 0, right: 0, bottom: 0, left: 0 }
  }
}

/**
 * Detects initial input modality from browser pointer/hover media queries and touch capabilities.
 * Safely defaults to `'keyboard_mouse'` in Node/SSR environments.
 */
export function detectInitialInputModality(): InputModality {
  if (typeof window === 'undefined') return 'keyboard_mouse'
  try {
    const coarse = Boolean(window.matchMedia?.('(pointer: coarse)')?.matches)
    const noHover = Boolean(window.matchMedia?.('(hover: none)')?.matches)
    const touchCapableCompact =
      typeof navigator !== 'undefined' &&
      typeof navigator.maxTouchPoints === 'number' &&
      navigator.maxTouchPoints > 0 &&
      window.innerWidth < 1100
    return coarse || noHover || touchCapableCompact ? 'touch' : 'keyboard_mouse'
  } catch {
    return 'keyboard_mouse'
  }
}

export interface PointerLikeEvent {
  readonly pointerType?: string
}

export interface KeyLikeEvent {
  readonly key?: string
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly metaKey?: boolean
  readonly shiftKey?: boolean
}

export interface InputModalityTracker {
  readonly modality: InputModality
  getModality(): InputModality
  onPointerEvent(e: PointerLikeEvent, nowMs?: number): boolean
  onKeyDown(e: KeyLikeEvent, nowMs?: number): boolean
  setModality(next: InputModality): boolean
  subscribe(listener: (modality: InputModality) => void): () => void
  attach(target?: EventTarget): () => void
}

/**
 * Tracks live input modality transitions between `'touch'` and `'keyboard_mouse'`.
 *
 * - Switches to `'touch'` on `pointerType === 'touch'`.
 * - Switches to `'keyboard_mouse'` on non-modifier physical `keydown` or `pointerType === 'mouse'`.
 * - Guards against synthetic/emulated mouse events fired shortly after touch input.
 */
export function createInputModalityTracker(initial?: InputModality): InputModalityTracker {
  let current: InputModality = initial ?? detectInitialInputModality()
  let lastTouchAtMs = current === 'touch' ? 0 : -Infinity
  const listeners = new Set<(modality: InputModality) => void>()

  function setModality(next: InputModality): boolean {
    if (next === current) return false
    current = next
    for (const listener of listeners) {
      listener(current)
    }
    return true
  }

  function onPointerEvent(e: PointerLikeEvent, nowMs = Date.now()): boolean {
    const pt = e?.pointerType
    if (pt === 'touch') {
      lastTouchAtMs = nowMs
      return setModality('touch')
    }
    if (pt === 'mouse') {
      if (nowMs - lastTouchAtMs < EMULATED_MOUSE_GUARD_MS) {
        return false
      }
      return setModality('keyboard_mouse')
    }
    return false
  }

  function onKeyDown(e: KeyLikeEvent, _nowMs = Date.now()): boolean {
    const key = typeof e?.key === 'string' ? e.key : ''
    if (MODIFIER_ONLY_KEYS.has(key)) return false
    return setModality('keyboard_mouse')
  }

  function subscribe(listener: (modality: InputModality) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function attach(target?: EventTarget): () => void {
    const host = target ?? (typeof window !== 'undefined' ? window : undefined)
    if (!host || typeof host.addEventListener !== 'function') {
      return () => {}
    }
    const handlePointer = (ev: Event) => {
      onPointerEvent(ev as unknown as PointerLikeEvent)
    }
    const handleKeyDown = (ev: Event) => {
      onKeyDown(ev as unknown as KeyLikeEvent)
    }
    host.addEventListener('pointerdown', handlePointer, { passive: true, capture: true })
    host.addEventListener('keydown', handleKeyDown, { passive: true, capture: true })
    return () => {
      host.removeEventListener('pointerdown', handlePointer, true)
      host.removeEventListener('keydown', handleKeyDown, true)
    }
  }

  return {
    get modality() {
      return current
    },
    getModality() {
      return current
    },
    onPointerEvent,
    onKeyDown,
    setModality,
    subscribe,
    attach
  }
}

/** Picks modality-appropriate UI copy (touch vs desktop). */
export function uiCopy(isTouch: boolean, desktopText: string, touchText: string): string {
  return isTouch ? touchText : desktopText
}

export interface NotchBezelSpec {
  readonly mode: 'none' | 'landscape-wings' | 'portrait-top'
  readonly leftInset: number
  readonly rightInset: number
  readonly topInset: number
  readonly bottomInset: number
}

/**
 * Pure check for whether the app is running on iOS (native Capacitor iOS or iOS Safari).
 * Android, desktop, and non-iOS browsers strictly return `false`.
 */
export function isIosRuntime(
  platformKind: string,
  userAgent = '',
  maxTouchPoints = 0
): boolean {
  if (platformKind === 'ios') return true
  if (platformKind === 'android' || platformKind === 'desktop') return false
  if (/iPhone|iPod|iPad/i.test(userAgent)) return true
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return true
  return false
}

/**
 * Pure computation of whether an iOS device exposes a hardware notch /
 * Dynamic Island cutout (`>= 24px` raw safe-area inset) or home-indicator bar
 * (`>= 14px` bottom inset), so Crownshard can frame it seamlessly into the UI.
 * Strictly gated to iOS (`isIos === true`) so Android/desktop devices never render iOS bezels.
 */
export function computeNotchBezelSpec(
  width: number,
  height: number,
  rawSafeArea: SafeAreaInsets,
  isIos: boolean
): NotchBezelSpec {
  const left = Math.max(0, Number.isFinite(rawSafeArea.left) ? rawSafeArea.left : 0)
  const right = Math.max(0, Number.isFinite(rawSafeArea.right) ? rawSafeArea.right : 0)
  const top = Math.max(0, Number.isFinite(rawSafeArea.top) ? rawSafeArea.top : 0)
  const bottom = Math.max(0, Number.isFinite(rawSafeArea.bottom) ? rawSafeArea.bottom : 0)

  if (!isIos) {
    return {
      mode: 'none',
      leftInset: left,
      rightInset: right,
      topInset: top,
      bottomInset: bottom
    }
  }

  const isLandscape = width > height
  if (isLandscape && (left >= 24 || right >= 24)) {
    return {
      mode: 'landscape-wings',
      leftInset: left,
      rightInset: right,
      topInset: top,
      bottomInset: bottom
    }
  }
  if (!isLandscape && top >= 24) {
    return {
      mode: 'portrait-top',
      leftInset: left,
      rightInset: right,
      topInset: top,
      bottomInset: bottom
    }
  }
  return {
    mode: 'none',
    leftInset: left,
    rightInset: right,
    topInset: top,
    bottomInset: bottom
  }
}
