import type { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { OtaChannel } from './ota.ts'
import { normalizeOtaBaseUrl } from './ota.ts'
import { emitOtaCapacitorPlugin } from './ota-plugin.ts'

export type MobileOrientation = 'landscape' | 'portrait' | 'any'

export interface MobileOtaConfig {
  readonly baseUrl: string
  readonly channel: OtaChannel
  /** Optional base64-encoded raw 32-byte Ed25519 public key pinned in the native binary. */
  readonly publicKeyBase64?: string
  /** Whether runtime `setChannel('local', customBaseUrl)` overrides are allowed (default: `channel !== 'prod'`). */
  readonly allowCustomUrl?: boolean
}

export interface MobileTargetOptions {
  dir: string
  wwwDir: string
  name: string
  slug: string
  appId: string
  version: string
  themeColor: string
  orientation: MobileOrientation
  iconPng: Buffer
  splashPng: Buffer
  ota?: MobileOtaConfig
}

export const MOBILE_EXTRA_HEAD = [
  '  <meta name="apple-mobile-web-app-capable" content="yes">',
  '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '  <meta name="mobile-web-app-capable" content="yes">',
  '  <script src="./ridgetop-mobile-bridge.js"></script>'
].join('\n')

export function renderMobileBridgeJs(orientation: MobileOrientation, ota?: MobileOtaConfig): string {
  const defaultOtaUrl = ota?.baseUrl ? normalizeOtaBaseUrl(ota.baseUrl) : ''
  const defaultOtaChannel: OtaChannel = ota?.channel ?? 'prod'
  const allowCustomUrl = ota?.allowCustomUrl ?? (defaultOtaChannel !== 'prod')
  return `(function () {
  const cap = globalThis.Capacitor
  const plugins = cap && cap.Plugins ? cap.Plugins : {}
  const platform = typeof cap?.getPlatform === 'function' ? cap.getPlatform() : 'web'
  if (platform !== 'ios' && platform !== 'android') return

  const PREFIX = 'ridgetop.native.'
  const OTA_CHANNEL_KEY = 'ridgetop.ota.channel'
  const OTA_URL_KEY = 'ridgetop.ota.baseUrl'
  const DEFAULT_OTA_URL = ${JSON.stringify(defaultOtaUrl)}
  const DEFAULT_OTA_CHANNEL = ${JSON.stringify(defaultOtaChannel)}
  const ALLOW_CUSTOM_URL = ${JSON.stringify(allowCustomUrl)}

  const lifecycleListeners = new Set()
  const hydrateListeners = new Set()
  const otaReadyListeners = new Set()
  const mutatedKeys = new Set()
  let clearedAll = false
  let otaChannel = DEFAULT_OTA_CHANNEL
  let otaBaseUrl = DEFAULT_OTA_URL
  let otaCheckInFlight = null
  let bootErrorCount = 0
  let otaConfirmed = false
  let prefsOverridden = false

  globalThis.addEventListener('error', function () { bootErrorCount++ })
  globalThis.addEventListener('unhandledrejection', function () { bootErrorCount++ })

  function compareSemverCore(a, b) {
    const parse = function (v) {
      return String(v || '0').trim().replace(/^v/i, '').split(/[+-]/, 1)[0].split('.').map(function (p) {
        const n = Number.parseInt(p, 10)
        return Number.isFinite(n) ? n : 0
      })
    }
    const pa = parse(a)
    const pb = parse(b)
    const len = Math.max(pa.length, pb.length)
    for (let i = 0; i < len; i++) {
      const av = pa[i] || 0
      const bv = pb[i] || 0
      if (av < bv) return -1
      if (av > bv) return 1
    }
    return 0
  }

  function normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\\/+$/, '')
  }

  function resolveManifestUrl() {
    const base = normalizeBaseUrl(otaBaseUrl)
    if (!base) return ''
    if (base.endsWith('/manifest.json')) return base
    return base + '/' + otaChannel + '/manifest.json'
  }

  function resolveBundleUrl(manifestUrl, bundleUrl) {
    try {
      return new URL(bundleUrl, manifestUrl).href
    } catch {
      return bundleUrl
    }
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(function () { controller.abort() }, timeoutMs) : null
    try {
      const response = await fetch(url, controller ? { cache: 'no-store', signal: controller.signal } : { cache: 'no-store' })
      if (!response.ok) return { ok: false, status: response.status, json: null }
      const json = await response.json()
      return { ok: true, status: response.status, json: json }
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  async function loadOtaPrefs() {
    const prefs = plugins.Preferences
    if (!prefs || typeof prefs.get !== 'function') return
    try {
      const ch = await prefs.get({ key: OTA_CHANNEL_KEY })
      if (!prefsOverridden && ch && (ch.value === 'dev' || ch.value === 'prod' || (ALLOW_CUSTOM_URL && ch.value === 'local'))) {
        otaChannel = ch.value
      }
      if (!prefsOverridden && ALLOW_CUSTOM_URL) {
        const url = await prefs.get({ key: OTA_URL_KEY })
        if (!prefsOverridden && url && typeof url.value === 'string' && url.value.trim()) {
          otaBaseUrl = normalizeBaseUrl(url.value)
        }
      }
    } catch {}
  }

  const otaPrefsReady = loadOtaPrefs()

  async function confirmOtaReady() {
    if (otaConfirmed) return true
    const otaPlugin = plugins.RidgetopOta
    if (!otaPlugin || typeof otaPlugin.confirmReady !== 'function') return false
    try {
      const status = typeof otaPlugin.getStatus === 'function' ? await otaPlugin.getStatus() : null
      const res = await otaPlugin.confirmReady(status && status.activeVersion ? { version: status.activeVersion } : {})
      if (res && res.confirmed) otaConfirmed = true
      return Boolean(res && res.confirmed)
    } catch {
      return false
    }
  }

  async function runOtaCheck() {
    await otaPrefsReady
    const otaPlugin = plugins.RidgetopOta
    if (!otaPlugin || typeof otaPlugin.getStatus !== 'function') {
      return { available: false, staged: false, version: null, reason: 'plugin-unavailable' }
    }
    const manifestUrl = resolveManifestUrl()
    if (!manifestUrl) {
      return { available: false, staged: false, version: null, reason: 'unconfigured' }
    }
    if (otaCheckInFlight) return otaCheckInFlight
    otaCheckInFlight = (async function () {
      try {
        const status = await otaPlugin.getStatus()
        const fetched = await fetchJsonWithTimeout(manifestUrl, 15000)
        if (!fetched.ok) {
          return { available: false, staged: false, version: null, reason: 'http-' + fetched.status }
        }
        const manifest = fetched.json
        if (
          !manifest ||
          manifest.schemaVersion !== 1 ||
          typeof manifest.appId !== 'string' || !manifest.appId ||
          typeof manifest.channel !== 'string' || !manifest.channel ||
          typeof manifest.version !== 'string' || !manifest.version ||
          typeof manifest.bundleUrl !== 'string' || !manifest.bundleUrl ||
          typeof manifest.sha256 !== 'string' || manifest.sha256.length !== 64
        ) {
          return { available: false, staged: false, version: null, reason: 'invalid-manifest' }
        }
        if (status.appId && manifest.appId !== status.appId) {
          return { available: false, staged: false, version: manifest.version, reason: 'app-id-mismatch' }
        }
        if (manifest.channel !== otaChannel) {
          return { available: false, staged: false, version: manifest.version, reason: 'channel-mismatch' }
        }
        if (manifest.minNativeVersion && compareSemverCore(status.nativeVersion || '0.0.0', manifest.minNativeVersion) < 0) {
          return { available: false, staged: false, version: manifest.version, reason: 'native-update-required' }
        }
        if (otaChannel !== 'local') {
          if (compareSemverCore(manifest.version, status.nativeVersion || '0.0.0') < 0) {
            return { available: false, staged: false, version: manifest.version, reason: 'downgrade-blocked' }
          }
          if (status.activeVersion && compareSemverCore(manifest.version, status.activeVersion) < 0) {
            return { available: false, staged: false, version: manifest.version, reason: 'downgrade-blocked' }
          }
        }
        if (manifest.version === status.activeVersion || manifest.version === status.stagedVersion) {
          return { available: false, staged: manifest.version === status.stagedVersion, version: manifest.version, reason: 'up-to-date' }
        }
        if (manifest.version === status.failedVersion) {
          return { available: false, staged: false, version: manifest.version, reason: 'previously-failed' }
        }
        const bundleUrl = resolveBundleUrl(manifestUrl, manifest.bundleUrl)
        const result = await otaPlugin.downloadAndStage({
          url: bundleUrl,
          version: manifest.version,
          sha256: manifest.sha256,
          channel: otaChannel,
          minNativeVersion: manifest.minNativeVersion || '0.0.0',
          signature: typeof manifest.signature === 'string' ? manifest.signature : ''
        })
        if (result && result.staged) {
          for (const listener of otaReadyListeners) {
            try { listener({ version: manifest.version, channel: otaChannel }) } catch {}
          }
          return { available: true, staged: true, version: manifest.version }
        }
        return { available: false, staged: false, version: manifest.version, reason: 'stage-failed' }
      } catch (err) {
        return { available: false, staged: false, version: null, reason: err && err.message ? err.message : 'check-failed' }
      } finally {
        otaCheckInFlight = null
      }
    })()
    return otaCheckInFlight
  }

  if (plugins.App && typeof plugins.App.addListener === 'function') {
    plugins.App.addListener('appStateChange', function (state) {
      for (const handlers of lifecycleListeners) {
        if (state && state.isActive) handlers.resume && handlers.resume()
        else handlers.pause && handlers.pause()
      }
      if (state && state.isActive && plugins.RidgetopOta) {
        void runOtaCheck()
      }
    })
  }

  function mirrorToPreferences(action, key, value) {
    const prefs = plugins.Preferences
    if (!prefs) return
    try {
      if (action === 'set') void prefs.set({ key: PREFIX + key, value: String(value) })
      else if (action === 'remove') void prefs.remove({ key: PREFIX + key })
      else if (action === 'clear') {
        if (typeof prefs.keys === 'function' && typeof prefs.remove === 'function') {
          prefs.keys().then(function (result) {
            const keys = result && Array.isArray(result.keys) ? result.keys : []
            return Promise.all(keys.filter(function (k) { return k.startsWith(PREFIX) }).map(function (k) {
              return prefs.remove({ key: k })
            }))
          }).catch(function () {})
        }
      }
    } catch {}
  }

  if (plugins.Preferences && typeof plugins.Preferences.keys === 'function') {
    plugins.Preferences.keys().then(function (result) {
      if (clearedAll) return
      const keys = result && Array.isArray(result.keys) ? result.keys : []
      return Promise.all(keys.filter(function (k) { return k.startsWith(PREFIX) }).map(function (fullKey) {
        const bare = fullKey.slice(PREFIX.length)
        if (mutatedKeys.has(bare)) return
        return plugins.Preferences.get({ key: fullKey }).then(function (item) {
          if (clearedAll || mutatedKeys.has(bare)) return
          if (item && typeof item.value === 'string' && globalThis.localStorage?.getItem(bare) === null) {
            try { globalThis.localStorage.setItem(bare, item.value) } catch {}
            for (const fn of hydrateListeners) {
              try { fn(bare, item.value) } catch {}
            }
          }
        })
      }))
    }).catch(function () {})
  }

  const impactStyle = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' }
  globalThis.__ridgetopPlatform = {
    platform: platform,
    storage: {
      loadAll: function () {
        const out = {}
        try {
          for (let i = 0; i < globalThis.localStorage.length; i++) {
            const k = globalThis.localStorage.key(i)
            if (k !== null) {
              const v = globalThis.localStorage.getItem(k)
              if (v !== null) out[k] = v
            }
          }
        } catch {}
        return out
      },
      set: function (key, value) {
        mutatedKeys.add(String(key))
        try { globalThis.localStorage.setItem(key, String(value)) } catch {}
        mirrorToPreferences('set', key, value)
      },
      remove: function (key) {
        mutatedKeys.add(String(key))
        try { globalThis.localStorage.removeItem(key) } catch {}
        mirrorToPreferences('remove', key)
      },
      clear: function () {
        clearedAll = true
        mutatedKeys.clear()
        try { globalThis.localStorage.clear() } catch {}
        mirrorToPreferences('clear')
      },
      onHydrate: function (listener) {
        if (typeof listener !== 'function') return function () {}
        hydrateListeners.add(listener)
        return function () { hydrateListeners.delete(listener) }
      }
    },
    haptics: {
      impact: function (style) {
        if (plugins.Haptics && typeof plugins.Haptics.impact === 'function') {
          plugins.Haptics.impact({ style: impactStyle[style] || 'LIGHT' }).catch(function () {})
        }
      }
    },
    lifecycle: {
      subscribe: function (handlers) {
        lifecycleListeners.add(handlers)
        return function () { lifecycleListeners.delete(handlers) }
      }
    },
    ota: {
      available: function () {
        return Boolean(plugins.RidgetopOta)
      },
      getChannel: function () {
        return otaChannel
      },
      getBaseUrl: function () {
        return otaBaseUrl
      },
      getStatus: async function () {
        await otaPrefsReady
        const base = plugins.RidgetopOta && typeof plugins.RidgetopOta.getStatus === 'function'
          ? await plugins.RidgetopOta.getStatus()
          : { appId: '', nativeVersion: '0.0.0', nativeBuild: '0', activeVersion: null, stagedVersion: null, lastGoodVersion: null, failedVersion: null, isOtaActive: false, signatureRequired: false }
        return Object.assign({}, base, { channel: otaChannel, baseUrl: otaBaseUrl })
      },
      checkForUpdate: function () {
        return runOtaCheck()
      },
      applyUpdate: async function (options) {
        if (!plugins.RidgetopOta || typeof plugins.RidgetopOta.apply !== 'function') return false
        const res = await plugins.RidgetopOta.apply({ reload: options && options.reload === false ? false : true })
        return Boolean(res && res.applied)
      },
      confirmReady: function () {
        return confirmOtaReady()
      },
      setChannel: async function (channel, customBaseUrl) {
        await otaPrefsReady
        if (channel !== 'local' && channel !== 'dev' && channel !== 'prod') return
        if (channel === 'local' && !ALLOW_CUSTOM_URL) return
        prefsOverridden = true
        otaChannel = channel
        if (ALLOW_CUSTOM_URL && typeof customBaseUrl === 'string' && customBaseUrl.trim()) {
          otaBaseUrl = normalizeBaseUrl(customBaseUrl)
        } else if (channel !== 'local') {
          otaBaseUrl = DEFAULT_OTA_URL
        }
        const prefs = plugins.Preferences
        if (prefs && typeof prefs.set === 'function') {
          try {
            await prefs.set({ key: OTA_CHANNEL_KEY, value: otaChannel })
            if (ALLOW_CUSTOM_URL && otaBaseUrl && otaBaseUrl !== DEFAULT_OTA_URL) {
              await prefs.set({ key: OTA_URL_KEY, value: otaBaseUrl })
            } else if (typeof prefs.remove === 'function') {
              await prefs.remove({ key: OTA_URL_KEY })
            }
          } catch {}
        }
      },
      reset: async function () {
        await otaPrefsReady
        prefsOverridden = true
        otaChannel = DEFAULT_OTA_CHANNEL
        otaBaseUrl = DEFAULT_OTA_URL
        const prefs = plugins.Preferences
        if (prefs && typeof prefs.remove === 'function') {
          try {
            await prefs.remove({ key: OTA_CHANNEL_KEY })
            await prefs.remove({ key: OTA_URL_KEY })
          } catch {}
        }
        if (plugins.RidgetopOta && typeof plugins.RidgetopOta.reset === 'function') {
          await plugins.RidgetopOta.reset()
        }
      },
      onUpdateReady: function (listener) {
        if (typeof listener !== 'function') return function () {}
        otaReadyListeners.add(listener)
        return function () { otaReadyListeners.delete(listener) }
      }
    }
  }

  if (plugins.StatusBar && typeof plugins.StatusBar.hide === 'function') {
    plugins.StatusBar.hide().catch(function () {})
  }
  const orientation = ${JSON.stringify(orientation)}
  if (orientation !== 'any' && plugins.ScreenOrientation && typeof plugins.ScreenOrientation.lock === 'function') {
    plugins.ScreenOrientation.lock({ orientation: orientation }).catch(function () {})
  }
  globalThis.addEventListener('load', function () {
    if (plugins.SplashScreen && typeof plugins.SplashScreen.hide === 'function') {
      plugins.SplashScreen.hide().catch(function () {})
    }
    setTimeout(function () {
      if (bootErrorCount === 0 && !otaConfirmed) {
        void confirmOtaReady()
      }
    }, 3000)
    otaPrefsReady.then(function () {
      if (plugins.RidgetopOta && resolveManifestUrl()) {
        setTimeout(function () { void runOtaCheck() }, 1500)
      }
    }).catch(function () {})
  }, { once: true })
})()
`
}

export function renderMobileReadme(
  name: string,
  appId: string,
  orientation: MobileOrientation,
  ota?: MobileOtaConfig
): string {
  const otaSection = [
    '## Over-the-Air (OTA) Updates (Built-in `ridgetop-ota` plugin)',
    '',
    'This mobile shell includes Ridgetop\'s zero-dependency `ridgetop-ota` Capacitor plugin for both iOS and Android:',
    `- **Default channel:** \`${ota?.channel ?? 'prod'}\``,
    `- **Default OTA base URL:** ${ota?.baseUrl ? `\`${normalizeOtaBaseUrl(ota.baseUrl)}\`` : '_(not configured — pass `--ota-url` when packaging or call `platform.ota.setChannel(...)` at runtime)_'}`,
    '',
    '### Three-layer update workflow',
    '1. **Local computer testing (`local`):** Run `ridgetop ota-serve` on your machine, then point a `dev`/`local` build to `http://<your-lan-ip>:4321` via `platform.ota.setChannel(\'local\', \'http://<lan-ip>:4321\')`. On iOS, add `NSAppTransportSecurity -> NSAllowsLocalNetworking = YES` only in your **Debug** build configuration (never in App Store release builds).',
    '2. **Main branch (`dev`):** Push to `main` to publish `<otaBaseUrl>/dev/manifest.json`.',
    '3. **Production (`prod`):** Merge to `prod` to publish `<otaBaseUrl>/prod/manifest.json`.'
  ].join('\n')

  return `# ${name} — iOS & Android Build (Capacitor)

Generated by Ridgetop's multi-platform packager (studio/testing tools stripped).

## First-time setup

\`\`\`sh
npm install
npm run add:ios
npm run add:android
npm run icons
npm run sync
\`\`\`

## Open & build

\`\`\`sh
npm run open:ios
npm run open:android
\`\`\`

- **App ID:** \`${appId}\`
- **Orientation:** \`${orientation}\`

${otaSection}
`
}

/** Write the Capacitor mobile shell scaffolding alongside a populated `www/` bundle. */
export async function emitMobileShell({
  dir, wwwDir, name, slug, appId, version, themeColor, orientation, iconPng, splashPng, ota
}: MobileTargetOptions): Promise<{ iconPath: string }> {
  let allowedHost = ''
  if (ota?.baseUrl) {
    try {
      allowedHost = new URL(ota.baseUrl).hostname
    } catch {
      allowedHost = ''
    }
  }
  const allowLocal = ota?.allowCustomUrl ?? (ota?.channel !== undefined && ota.channel !== 'prod')
  await emitOtaCapacitorPlugin(join(dir, 'ridgetop-ota'), {
    publicKeyBase64: ota?.publicKeyBase64,
    allowedHost,
    allowLocal
  })
  await writeFile(join(wwwDir, 'ridgetop-mobile-bridge.js'), renderMobileBridgeJs(orientation, ota))
  await writeFile(join(dir, 'capacitor.config.json'), JSON.stringify({
    appId,
    appName: name,
    webDir: 'www',
    backgroundColor: themeColor,
    ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: true },
    android: { backgroundColor: themeColor },
    plugins: {
      SplashScreen: { launchAutoHide: false, backgroundColor: themeColor, showSpinner: false },
      StatusBar: { overlaysWebView: true, style: 'DARK' }
    }
  }, null, 2) + '\n')
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: slug + '-mobile',
    version,
    private: true,
    scripts: {
      'add:ios': 'cap add ios',
      'add:android': 'cap add android',
      sync: 'cap sync',
      icons: 'capacitor-assets generate',
      'open:ios': 'cap open ios',
      'open:android': 'cap open android'
    },
    dependencies: {
      '@capacitor/app': '^8.1.0',
      '@capacitor/core': '^8.6.0',
      '@capacitor/haptics': '^8.0.0',
      '@capacitor/preferences': '^8.0.0',
      '@capacitor/screen-orientation': '^8.0.0',
      '@capacitor/splash-screen': '^8.0.0',
      '@capacitor/status-bar': '^8.0.0',
      'ridgetop-ota': 'file:./ridgetop-ota'
    },
    devDependencies: {
      '@capacitor/android': '^8.6.0',
      '@capacitor/assets': '^4.0.0',
      '@capacitor/cli': '^8.6.0',
      '@capacitor/ios': '^8.6.0'
    }
  }, null, 2) + '\n')
  await writeFile(join(dir, 'README.md'), renderMobileReadme(name, appId, orientation, ota))

  const resourcesDir = join(dir, 'resources')
  await mkdir(resourcesDir, { recursive: true })
  const iconPath = join(resourcesDir, 'icon.png')
  await writeFile(iconPath, iconPng)
  await writeFile(join(resourcesDir, 'icon-only.png'), iconPng)
  await writeFile(join(resourcesDir, 'splash.png'), splashPng)
  await writeFile(join(resourcesDir, 'splash-dark.png'), splashPng)
  return { iconPath }
}
