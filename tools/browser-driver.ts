import assert from 'node:assert/strict'
import { setTimeout as wait } from 'node:timers/promises'

function debugUrl() {
  return process.env.CHROMIUM_DEBUG ?? 'http://localhost:9222'
}

type DevToolsTarget = { id: string; webSocketDebuggerUrl: string }
type PendingCall = {
  resolve: (value: any) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
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
    const packet = JSON.parse(data)
    if (packet.id) {
      const action = pending.get(packet.id)
      if (!action) return
      clearTimeout(action.timeout)
      pending.delete(packet.id)
      if (packet.error) action.reject(new Error(packet.error.message))
      else action.resolve(packet.result)
    }
    if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.text)
    if (packet.method === 'Log.entryAdded' && packet.params.entry.level === 'error') {
      errors.push(packet.params.entry.text)
    }
  }
  const call = <T = any>(method: string, params?: object) => new Promise<T>((resolve, reject) => {
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
    async evaluate<T = any>(expression: string): Promise<T> {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result?.value as T
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
  const target = await fetch(debugUrl() + '/json/new?about:blank', { method: 'PUT' }).then(r => r.json()) as DevToolsTarget
  const tab = await attach(target, beforeLoad)
  await tab.call('Page.navigate', { url })
  await tab.call('Page.bringToFront')
  return tab
}

// Player release checks run in temporary profiles so downloads and saves stay isolated.
export async function openPlayerTab(downloadPath: string) {
  const info = await fetch(debugUrl() + '/json/version').then(r => r.json()) as { webSocketDebuggerUrl: string }
  const browser = await connect(info.webSocketDebuggerUrl)
  const { browserContextId } = await browser.call('Target.createBrowserContext', { disposeOnDetach: true })
  async function dispose() {
    try { await browser.call('Target.disposeBrowserContext', { browserContextId }) }
    finally { browser.close() }
  }
  try {
    await browser.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, browserContextId })
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank', browserContextId })
    const targets = await fetch(debugUrl() + '/json/list').then(r => r.json()) as DevToolsTarget[]
    const target = targets.find(entry => entry.id === targetId)
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
    if (typeof expected === 'function' ? (expected as (value: T) => unknown)(actual) : expected === actual) return actual
    await wait(100)
  }
  assert.fail(description + '. Last value: ' + actual)
}
export const status = (tab: BrowserTab, id: string) => tab.evaluate<string | null | undefined>(`document.querySelector('#${id}')?.textContent`)
export const click = (tab: BrowserTab, id: string) => tab.evaluate(`document.querySelector('#${id}').click()`)
export const key = (tab: BrowserTab, type: string, code: string, keyName: string) => tab.call('Input.dispatchKeyEvent', { type, key: keyName, code })
