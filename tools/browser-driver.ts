import assert from 'node:assert/strict'
import { setTimeout as wait } from 'node:timers/promises'

function debugUrl() {
  return process.env.CHROMIUM_DEBUG ?? 'http://localhost:9222'
}

type DevToolsTarget = { id: string; webSocketDebuggerUrl: string }
type PendingCall = {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDevToolsTarget(value: unknown): value is DevToolsTarget {
  return isRecord(value) && typeof value.id === 'string' && typeof value.webSocketDebuggerUrl === 'string'
}

function isPredicate<T>(expected: T | ((value: T) => unknown)): expected is (value: T) => unknown {
  return typeof expected === 'function'
}

async function connect(url: string) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map<number, PendingCall>()
  const errors: string[] = []
  let message = 0
  socket.onmessage = ({ data }) => {
    const packet: unknown = JSON.parse(String(data))
    if (!isRecord(packet)) return
    if (typeof packet.id === 'number') {
      const action = pending.get(packet.id)
      if (!action) return
      clearTimeout(action.timeout)
      pending.delete(packet.id)
      if (isRecord(packet.error) && typeof packet.error.message === 'string') {
        action.reject(new Error(packet.error.message))
      } else {
        action.resolve(isRecord(packet.result) ? packet.result : {})
      }
    }
    if (packet.method === 'Runtime.exceptionThrown' && isRecord(packet.params) &&
        isRecord(packet.params.exceptionDetails) && typeof packet.params.exceptionDetails.text === 'string') {
      errors.push(packet.params.exceptionDetails.text)
    }
    if (packet.method === 'Log.entryAdded' && isRecord(packet.params) &&
        isRecord(packet.params.entry) && packet.params.entry.level === 'error' &&
        typeof packet.params.entry.text === 'string') {
      errors.push(packet.params.entry.text)
    }
  }
  const call = (method: string, params?: object) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = ++message
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Timed out calling ' + method))
    }, 45_000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { call, errors, close: () => socket.close() }
}

async function attach(target: DevToolsTarget, beforeLoad?: string) {
  const { call, errors, close } = await connect(target.webSocketDebuggerUrl)
  const tab = {
    call, errors,
    async evaluate(expression: string): Promise<unknown> {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return isRecord(result.result) ? result.result.value : undefined
    },
    async close() {
      close()
      await fetch(debugUrl() + '/json/close/' + target.id)
    }
  }
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Log.enable')
  if (beforeLoad) await call('Page.addScriptToEvaluateOnNewDocument', { source: beforeLoad })
  return tab
}

export type BrowserTab = Awaited<ReturnType<typeof attach>>

export async function openTab(url: string, beforeLoad?: string) {
  const target: unknown = await fetch(debugUrl() + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json())
  if (!isDevToolsTarget(target)) throw new Error('Unexpected DevTools target response')
  const tab = await attach(target, beforeLoad)
  await tab.call('Page.navigate', { url })
  await tab.call('Page.bringToFront')
  return tab
}

// Player release checks run in temporary profiles so downloads and saves stay isolated.
export async function openPlayerTab(downloadPath: string) {
  const info: unknown = await fetch(debugUrl() + '/json/version').then(r => r.json())
  if (!isRecord(info) || typeof info.webSocketDebuggerUrl !== 'string') {
    throw new Error('Unexpected DevTools version response')
  }
  const browser = await connect(info.webSocketDebuggerUrl)
  const { browserContextId } = await browser.call('Target.createBrowserContext', { disposeOnDetach: true })
  if (typeof browserContextId !== 'string') {
    browser.close()
    throw new Error('Missing browserContextId from DevTools')
  }
  async function dispose() {
    try { await browser.call('Target.disposeBrowserContext', { browserContextId }) }
    finally { browser.close() }
  }
  try {
    await browser.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, browserContextId })
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank', browserContextId })
    if (typeof targetId !== 'string') throw new Error('Missing targetId from DevTools')
    const targets: unknown = await fetch(debugUrl() + '/json/list').then(r => r.json())
    if (!Array.isArray(targets)) throw new Error('Unexpected DevTools target list')
    const target = targets.filter(isDevToolsTarget).find(entry => entry.id === targetId)
    if (!target) throw new Error('Browser target not found: ' + targetId)
    const tab = await attach(target)
    await tab.call('Network.enable')
    await tab.call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
    await tab.call('Page.bringToFront')
    return { ...tab, async close() { try { await tab.close() } finally { await dispose() } } }
  } catch (error) { await dispose(); throw error }
}

export async function until<T>(
  read: () => Promise<T> | T,
  expected: T | ((value: T) => unknown),
  description: string,
  limit = 160
): Promise<T> {
  let actual: T | undefined
  for (let i = 0; i < limit; i++) {
    actual = await read()
    if (isPredicate(expected) ? expected(actual) : expected === actual) return actual
    await wait(100)
  }
  assert.fail(description + '. Last value: ' + actual)
}
export async function status(tab: BrowserTab, id: string): Promise<string | null | undefined> {
  const value = await tab.evaluate(`document.querySelector('#${id}')?.textContent`)
  return typeof value === 'string' ? value : value === null ? null : undefined
}
export const click = (tab: BrowserTab, id: string) => tab.evaluate(`document.querySelector('#${id}').click()`)
export const key = (tab: BrowserTab, type: string, code: string, keyName: string) => tab.call('Input.dispatchKeyEvent', { type, key: keyName, code })
