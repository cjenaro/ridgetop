/**
 * Pure formatting and state-machine helpers for Crownshard's dev version badge
 * and dismissable OTA "Update Available" banner.
 *
 * Dependency-free so it runs identically in browser and Node unit tests.
 */

export type OtaChannelKind = 'local' | 'dev' | 'prod'

export interface OtaStatusSnapshot {
  readonly channel: OtaChannelKind
  readonly nativeVersion: string
  readonly nativeBuild: string
  readonly activeVersion: string | null
  readonly stagedVersion: string | null
  readonly isOtaActive: boolean
}

export interface PendingOtaUpdate {
  readonly version: string
  readonly channel: OtaChannelKind
}

export interface OtaBannerState {
  readonly status: OtaStatusSnapshot | null
  readonly pending: PendingOtaUpdate | null
  readonly dismissedVersion: string | null
  readonly applying: boolean
  readonly checking: boolean
}

export function createOtaBannerState(): OtaBannerState {
  return {
    status: null,
    pending: null,
    dismissedVersion: null,
    applying: false,
    checking: false
  }
}

/**
 * Format an OTA version string into a compact, scannable tag.
 * Examples:
 * - `1.0.0+dev.20261127154912.d903eb1` -> `v1.0.0 · d903eb1`
 * - `1.0.0+local.20261127154912.3` -> `v1.0.0 · #3`
 * - `1.2.3` -> `v1.2.3`
 */
export function formatShortOtaVersion(version: string): string {
  const trimmed = version.trim()
  if (!trimmed) return 'v0.0.0'
  const plusIdx = trimmed.indexOf('+')
  const core = (plusIdx >= 0 ? trimmed.slice(0, plusIdx) : trimmed).replace(/^v/i, '')
  const meta = plusIdx >= 0 ? trimmed.slice(plusIdx + 1) : ''
  if (!meta) return `v${core}`
  const parts = meta.split('.').filter(Boolean)
  // Typical CI format: dev.<YYYYMMDDHHMMSS>.<shortSha>
  // Typical local format: local.<YYYYMMDDHHMMSS>.<counter>
  if (parts.length >= 3) {
    const channel = parts[0]
    const tail = parts[parts.length - 1]
    if (channel === 'local' && /^\d+$/.test(tail)) {
      return `v${core} · #${tail}`
    }
    return `v${core} · ${tail}`
  }
  return `v${core} · ${meta}`
}

/**
 * Build the Home/Title screen version badge label for dev/local builds.
 * Returns `null` for production builds so the release title screen stays clean.
 */
export function formatDevVersionLabel(
  status: OtaStatusSnapshot | null,
  opts: { readonly isLocalWeb?: boolean; readonly checking?: boolean } = {}
): string | null {
  if (status) {
    if (status.channel === 'prod') return null
    const chTag = status.channel.toUpperCase()
    const base = status.activeVersion
      ? `${chTag} · ${formatShortOtaVersion(status.activeVersion)}`
      : `${chTag} · v${status.nativeVersion.replace(/^v/i, '')} (b${status.nativeBuild})`
    if (opts.checking) return `${base} · Checking...`
    if (status.stagedVersion && status.stagedVersion !== status.activeVersion) {
      return `${base} · Update Ready`
    }
    return base
  }
  if (opts.isLocalWeb) {
    return opts.checking ? 'DEV · Web · Checking...' : 'DEV · Web'
  }
  return null
}

/** Reconcile a freshly fetched native OTA status snapshot into banner state. */
export function applyOtaStatus(state: OtaBannerState, status: OtaStatusSnapshot): OtaBannerState {
  const staged = status.stagedVersion && status.stagedVersion !== status.activeVersion
    ? { version: status.stagedVersion, channel: status.channel }
    : state.pending && state.pending.version !== status.activeVersion
      ? state.pending
      : null
  return {
    ...state,
    status,
    pending: staged,
    checking: false
  }
}

/** Record a newly staged OTA update ready to apply on restart. */
export function applyOtaUpdateReady(state: OtaBannerState, info: PendingOtaUpdate): OtaBannerState {
  const nextDismissed = state.dismissedVersion === info.version ? state.dismissedVersion : null
  const nextStatus = state.status
    ? { ...state.status, stagedVersion: info.version, channel: info.channel }
    : state.status
  return {
    ...state,
    status: nextStatus,
    pending: info,
    dismissedVersion: nextDismissed,
    checking: false
  }
}

/** Dismiss the update banner for the currently staged version. */
export function dismissOtaBanner(state: OtaBannerState): OtaBannerState {
  if (!state.pending) return state
  return {
    ...state,
    dismissedVersion: state.pending.version
  }
}

/** Re-open a previously dismissed update banner (e.g. when tapping the dev version pill). */
export function reopenOtaBanner(state: OtaBannerState): OtaBannerState {
  if (!state.pending) return state
  return {
    ...state,
    dismissedVersion: null
  }
}

/** Return the pending update if the banner should currently be shown, else `null`. */
export function getVisibleOtaUpdate(state: OtaBannerState): PendingOtaUpdate | null {
  if (!state.pending) return null
  if (state.dismissedVersion === state.pending.version) return null
  return state.pending
}
