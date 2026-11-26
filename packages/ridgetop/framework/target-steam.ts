import type { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ASSET_MIME_TYPES } from './manifest.ts'

export interface SteamTargetOptions {
  dir: string
  name: string
  slug: string
  appId: string
  version: string
  steamAppId: string
  iconPng: Buffer
}

export function renderElectronMain(name: string, slug: string): string {
  const mimeJson = JSON.stringify(ASSET_MIME_TYPES, null, 2)
  return `'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const steam = require('./steam.cjs')

const APP_NAME = ${JSON.stringify(name)}
const SCHEME = 'ridgetop'
const WWW_ROOT = path.resolve(__dirname, '..', 'www')
const MIME = ${mimeJson}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

app.commandLine.appendSwitch('enable-unsafe-webgpu')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

const isSteamDeck = process.env.SteamDeck === '1' || process.env.SteamGamepadUI === '1' || process.env.GAMESCOPE_WAYLAND_DISPLAY !== undefined
const saveDir = process.env.RIDGETOP_SAVE_DIR || path.join(app.getPath('userData'), 'saves')
const saveFile = path.join(saveDir, ${JSON.stringify(slug + '-save.json')})

function loadSaves() {
  const out = Object.create(null)
  try {
    const parsed = JSON.parse(fs.readFileSync(saveFile, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype' && typeof v === 'string') {
          out[k] = v
        }
      }
    }
  } catch {}
  return out
}

let saveCache = null
let saveSeq = 0
function persistSaves(data) {
  let temp = ''
  try {
    fs.mkdirSync(saveDir, { recursive: true })
    temp = saveFile + '.tmp.' + process.pid + '.' + (++saveSeq)
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\\n', 'utf8')
    fs.renameSync(temp, saveFile)
  } catch {
    if (temp) { try { fs.unlinkSync(temp) } catch {} }
  }
}

function getSaves() {
  if (!saveCache) saveCache = loadSaves()
  return saveCache
}

function createWindow() {
  const win = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 400,
    fullscreen: isSteamDeck,
    autoHideMenuBar: true,
    backgroundColor: '#101b20',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  win.setMenuBarVisibility(false)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(SCHEME + '://app/')) event.preventDefault()
  })
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen())
    }
  })
  const sendLife = state => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('ridgetop:lifecycle', state)
    }
  }
  win.on('minimize', () => sendLife('pause'))
  win.on('restore', () => sendLife('resume'))
  win.on('blur', () => sendLife('pause'))
  win.on('focus', () => sendLife('resume'))

  void win.loadURL(SCHEME + '://app/index.html')
  return win
}

const singleLock = app.requestSingleInstanceLock()
if (!singleLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    steam.init(path.resolve(__dirname, '..'))

    protocol.handle(SCHEME, request => {
      let pathname
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname)
      } catch {
        return new Response('Bad Request', { status: 400 })
      }
      if (pathname.includes('\\0')) {
        return new Response('Bad Request', { status: 400 })
      }
      if (!pathname || pathname === '/') pathname = '/index.html'
      const target = path.resolve(WWW_ROOT, '.' + pathname)
      if (target !== WWW_ROOT && !target.startsWith(WWW_ROOT + path.sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        return new Response('Not found', { status: 404 })
      }
      const ext = path.extname(target).toLowerCase()
      return new Response(fs.readFileSync(target), {
        status: 200,
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' }
      })
    })

    ipcMain.on('ridgetop:storage-load', event => { event.returnValue = { ...getSaves() } })
    ipcMain.on('ridgetop:storage-set', (_event, key, value) => {
      const k = String(key)
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return
      const data = getSaves()
      data[k] = String(value)
      persistSaves(data)
    })
    ipcMain.on('ridgetop:storage-remove', (_event, key) => {
      const k = String(key)
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return
      const data = getSaves()
      delete data[k]
      persistSaves(data)
    })
    ipcMain.on('ridgetop:storage-clear', () => {
      saveCache = Object.create(null)
      persistSaves(saveCache)
    })

    ipcMain.on('ridgetop:fullscreen-get', event => {
      const win = BrowserWindow.fromWebContents(event.sender)
      event.returnValue = Boolean(win && win.isFullScreen())
    })
    ipcMain.handle('ridgetop:fullscreen-set', (event, enabled) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) win.setFullScreen(Boolean(enabled))
    })
    ipcMain.handle('ridgetop:fullscreen-toggle', event => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) win.setFullScreen(!win.isFullScreen())
    })
    ipcMain.handle('ridgetop:quit', () => { app.quit() })

    ipcMain.on('ridgetop:steam-available', event => { event.returnValue = steam.available() })
    ipcMain.handle('ridgetop:steam-achievement', (_event, id) => steam.unlockAchievement(String(id)))
    ipcMain.on('ridgetop:steam-presence', (_event, key, value) => steam.setRichPresence(String(key), String(value)))
    ipcMain.on('ridgetop:steam-overlay', (_event, dialog) => steam.activateOverlay(String(dialog || 'Achievements')))

    createWindow()
    app.on('second-instance', () => {
      const active = BrowserWindow.getAllWindows()[0]
      if (active && !active.isDestroyed()) {
        if (active.isMinimized()) active.restore()
        active.focus()
      }
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => { app.quit() })
}
`
}

export function renderElectronPreload(): string {
  return `'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const lifecycleListeners = new Set()
ipcRenderer.on('ridgetop:lifecycle', (_event, state) => {
  for (const handlers of lifecycleListeners) {
    if (state === 'pause') handlers.pause && handlers.pause()
    else if (state === 'resume') handlers.resume && handlers.resume()
  }
})

contextBridge.exposeInMainWorld('__ridgetopPlatform', {
  platform: 'desktop',
  storage: {
    loadAll: () => ipcRenderer.sendSync('ridgetop:storage-load'),
    set: (key, value) => ipcRenderer.send('ridgetop:storage-set', key, value),
    remove: key => ipcRenderer.send('ridgetop:storage-remove', key),
    clear: () => ipcRenderer.send('ridgetop:storage-clear')
  },
  fullscreen: {
    isFullscreen: () => ipcRenderer.sendSync('ridgetop:fullscreen-get'),
    set: enabled => ipcRenderer.invoke('ridgetop:fullscreen-set', enabled),
    toggle: () => ipcRenderer.invoke('ridgetop:fullscreen-toggle')
  },
  quit: () => ipcRenderer.invoke('ridgetop:quit'),
  lifecycle: {
    subscribe: handlers => {
      lifecycleListeners.add(handlers)
      return () => lifecycleListeners.delete(handlers)
    }
  },
  steam: {
    available: () => ipcRenderer.sendSync('ridgetop:steam-available'),
    unlockAchievement: id => ipcRenderer.invoke('ridgetop:steam-achievement', id),
    setRichPresence: (key, value) => ipcRenderer.send('ridgetop:steam-presence', key, value),
    activateOverlay: dialog => ipcRenderer.send('ridgetop:steam-overlay', dialog)
  }
})
`
}

export function renderElectronSteam(defaultSteamAppId: string): string {
  return `'use strict'
const fs = require('node:fs')
const path = require('node:path')

let client = null

function readAppId(rootDir) {
  try {
    const raw = fs.readFileSync(path.join(rootDir, 'steam_appid.txt'), 'utf8').trim()
    const parsed = Number.parseInt(raw, 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  } catch {}
  return Number.parseInt(${JSON.stringify(defaultSteamAppId)}, 10) || 480
}

function init(rootDir) {
  try {
    const steamworks = require('steamworks.js')
    const appId = readAppId(rootDir)
    client = steamworks.init(appId)
    if (typeof steamworks.electronEnableSteamOverlay === 'function') {
      steamworks.electronEnableSteamOverlay()
    }
  } catch {
    client = null
  }
}

module.exports = {
  init,
  available: () => Boolean(client),
  unlockAchievement(id) {
    if (!client) return false
    try { return Boolean(client.achievement.activate(id)) } catch { return false }
  },
  setRichPresence(key, value) {
    if (!client) return
    try { client.localplayer.setRichPresence(key, value) } catch {}
  },
  activateOverlay(dialog) {
    if (!client) return
    try { client.overlay.activateDialog(dialog || 'Achievements') } catch {}
  }
}
`
}

export function renderElectronBuilderConfig(name: string, slug: string, appId: string): string {
  return `appId: ${JSON.stringify(appId)}
productName: ${JSON.stringify(name)}
directories:
  buildResources: build
  output: release
files:
  - electron/**/*
  - www/**/*
  - steam_appid.txt
  - package.json
asar: true
asarUnpack:
  - "**/node_modules/steamworks.js/**"
  - "steam_appid.txt"
extraFiles:
  - from: steam_appid.txt
    to: steam_appid.txt
win:
  icon: build/icon.png
  target:
    - nsis
    - zip
mac:
  icon: build/icon.png
  category: public.app-category.games
  target:
    - dmg
    - zip
linux:
  icon: build/icon.png
  category: Game
  executableName: ${JSON.stringify(slug)}
  target:
    - AppImage
    - tar.gz
`
}

export function renderSteamReadme(name: string, slug: string, appId: string, steamAppId: string): string {
  return `# ${name} — Steam & Desktop Build

Generated by Ridgetop's multi-platform packager (studio/testing tools stripped).

## Run locally

\`\`\`sh
npm install
npm start
\`\`\`

## Build distributables

\`\`\`sh
npm run dist:linux   # AppImage + tar.gz (Steam Deck ready)
npm run dist:win     # Windows installer + portable zip
npm run dist:mac     # macOS DMG + zip
\`\`\`

## Steamworks & Steam Cloud setup

1. Replace \`steam_appid.txt\` (currently \`${steamAppId}\`) with your assigned Steam App ID.
2. Install optional Steamworks native bindings: \`npm install steamworks.js\`.
3. Map Steam Cloud Auto-Cloud to \`${slug}/saves/${slug}-save.json\` under the platform user-data root.
4. Package ID: \`${appId}\`
`
}

/** Write the Electron + Steamworks desktop shell scaffolding alongside a populated `www/` bundle. */
export async function emitSteamShell({
  dir, name, slug, appId, version, steamAppId, iconPng
}: SteamTargetOptions): Promise<{ iconPath: string }> {
  await mkdir(join(dir, 'electron'), { recursive: true })
  await mkdir(join(dir, 'build'), { recursive: true })
  await writeFile(join(dir, 'electron', 'main.cjs'), renderElectronMain(name, slug))
  await writeFile(join(dir, 'electron', 'preload.cjs'), renderElectronPreload())
  await writeFile(join(dir, 'electron', 'steam.cjs'), renderElectronSteam(steamAppId))
  await writeFile(join(dir, 'steam_appid.txt'), steamAppId + '\n')
  await writeFile(join(dir, 'electron-builder.yml'), renderElectronBuilderConfig(name, slug, appId))
  await writeFile(join(dir, 'README.md'), renderSteamReadme(name, slug, appId, steamAppId))
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: slug,
    productName: name,
    version,
    private: true,
    main: 'electron/main.cjs',
    scripts: {
      start: 'electron .',
      dist: 'electron-builder',
      'dist:win': 'electron-builder --win',
      'dist:mac': 'electron-builder --mac',
      'dist:linux': 'electron-builder --linux'
    },
    devDependencies: {
      electron: '^35.0.0',
      'electron-builder': '^26.0.0'
    },
    optionalDependencies: {
      'steamworks.js': '^0.3.1'
    }
  }, null, 2) + '\n')

  const iconPath = join(dir, 'build', 'icon.png')
  await writeFile(iconPath, iconPng)
  return { iconPath }
}
