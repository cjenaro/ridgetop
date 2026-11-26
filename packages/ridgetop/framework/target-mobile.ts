import type { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type MobileOrientation = 'landscape' | 'portrait' | 'any'

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
}

export const MOBILE_EXTRA_HEAD = [
  '  <meta name="apple-mobile-web-app-capable" content="yes">',
  '  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '  <meta name="mobile-web-app-capable" content="yes">',
  '  <script src="./ridgetop-mobile-bridge.js"></script>'
].join('\n')

export function renderMobileBridgeJs(orientation: MobileOrientation): string {
  return `(function () {
  const cap = globalThis.Capacitor
  const plugins = cap && cap.Plugins ? cap.Plugins : {}
  const platform = typeof cap?.getPlatform === 'function' ? cap.getPlatform() : 'web'
  if (platform !== 'ios' && platform !== 'android') return

  const PREFIX = 'ridgetop.native.'
  const lifecycleListeners = new Set()
  const hydrateListeners = new Set()
  const mutatedKeys = new Set()
  let clearedAll = false

  if (plugins.App && typeof plugins.App.addListener === 'function') {
    plugins.App.addListener('appStateChange', function (state) {
      for (const handlers of lifecycleListeners) {
        if (state && state.isActive) handlers.resume && handlers.resume()
        else handlers.pause && handlers.pause()
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
  }, { once: true })
})()
`
}

export function renderMobileReadme(name: string, appId: string, orientation: MobileOrientation): string {
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
`
}

/** Write the Capacitor mobile shell scaffolding alongside a populated `www/` bundle. */
export async function emitMobileShell({
  dir, wwwDir, name, slug, appId, version, themeColor, orientation, iconPng, splashPng
}: MobileTargetOptions): Promise<{ iconPath: string }> {
  await writeFile(join(wwwDir, 'ridgetop-mobile-bridge.js'), renderMobileBridgeJs(orientation))
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
      '@capacitor/status-bar': '^8.0.0'
    },
    devDependencies: {
      '@capacitor/android': '^8.6.0',
      '@capacitor/assets': '^4.0.0',
      '@capacitor/cli': '^8.6.0',
      '@capacitor/ios': '^8.6.0'
    }
  }, null, 2) + '\n')
  await writeFile(join(dir, 'README.md'), renderMobileReadme(name, appId, orientation))

  const resourcesDir = join(dir, 'resources')
  await mkdir(resourcesDir, { recursive: true })
  const iconPath = join(resourcesDir, 'icon.png')
  await writeFile(iconPath, iconPng)
  await writeFile(join(resourcesDir, 'icon-only.png'), iconPng)
  await writeFile(join(resourcesDir, 'splash.png'), splashPng)
  await writeFile(join(resourcesDir, 'splash-dark.png'), splashPng)
  return { iconPath }
}
