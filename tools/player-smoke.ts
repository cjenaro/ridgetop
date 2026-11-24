import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserTab } from './browser-driver.ts'
import { key, openPlayerTab, until } from './browser-driver.ts'

const temp = await mkdtemp(join(tmpdir(), 'ridgetop-player-'))
const source = new URL('../dist/signal-drift.html', import.meta.url)
const backup = join(temp, 'signal-drift-save.json')
const backend = process.env.RIDGETOP_BACKENDS?.split(',')[0] ?? 'auto'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const uiState = (tab: BrowserTab, field: string) => tab.evaluate(`window.__ridgetopUi?.state?.()?.[${JSON.stringify(field)}]`)
const uiAct = (tab: BrowserTab, id: string, action = 'press') => tab.evaluate(`window.__ridgetopUi?.act(${JSON.stringify(id)}, ${JSON.stringify(action)})`)

async function launch(folder: string) {
  await mkdir(folder)
  const file = join(folder, 'Signal Drift.html')
  await copyFile(source, file)
  const tab = await openPlayerTab(temp)
  try {
    const url = pathToFileURL(file)
    url.searchParams.set('renderer', backend)
    const navigation = await tab.call('Page.navigate', { url: url.href })
    if (typeof navigation.errorText === 'string' && navigation.errorText) {
      throw new Error('Chromium could not open the local player file: ' + navigation.errorText)
    }
    await until(() => uiState(tab, 'screen'), 'home', 'offline player started')
    assert.equal(await uiState(tab, 'hosted'), false)
    return tab
  } catch (error) { await tab.close(); throw error }
}

async function chooseFile(tab: BrowserTab, file: string) {
  const { root } = await tab.call('DOM.getDocument')
  if (!isRecord(root) || typeof root.nodeId !== 'number') throw new Error('Missing DOM root node')
  const { nodeId } = await tab.call('DOM.querySelector', { nodeId: root.nodeId, selector: '#race-save-file' })
  if (typeof nodeId !== 'number') throw new Error('Missing #race-save-file input')
  await tab.call('DOM.setFileInputFiles', { nodeId, files: [file] })
}
async function checkOffline(tab: BrowserTab) {
  assert.equal(await tab.evaluate("performance.getEntriesByType('resource').some(r => /^https?:/.test(r.name))"), false)
  assert.deepEqual(tab.errors, [])
}

try {
  const first = await launch(join(temp, 'first download'))
  try {
    await uiAct(first, 'race-garage')
    await uiAct(first, 'upgrade-armor')
    await uiAct(first, 'garage-install')
    assert.equal(await uiState(first, 'garageCredits'), '20')
    await uiAct(first, 'garage-back')
    await uiAct(first, 'race-saves')
    await uiAct(first, 'race-save-export')
    await until(async () => {
      try { return JSON.parse(await readFile(backup, 'utf8')).progress?.build?.armor } catch { return }
    }, 1, 'downloaded the fitted shield in a real save file')
    await uiAct(first, 'saves-back')
    await uiAct(first, 'race-start')
    await key(first, 'keyDown', 'KeyW', 'w')
    await until(() => uiState(first, 'speed'), n => typeof n === 'string' && Number.parseInt(n) >= 12, 'offline race accepted throttle')
    await key(first, 'keyUp', 'KeyW', 'w')
    await uiAct(first, 'race-pause')
    assert.equal(await uiState(first, 'overlayTitle'), 'Race paused')
    await checkOffline(first)
  } finally { await first.close() }

  const update = await launch(join(temp, 'fresh install'))
  try {
    assert.equal(await uiState(update, 'purse'), '100 credits')
    await uiAct(update, 'race-saves')
    const damaged = join(temp, 'incomplete.json')
    await writeFile(damaged, '{"game":"signal-drift","version":1}')
    await chooseFile(update, damaged)
    await until(() => uiState(update, 'saveStatus'), s => typeof s === 'string' && s.includes('invalid'), 'damaged backup explained')
    assert.equal(await uiState(update, 'hasSaveCandidate'), false)
    await chooseFile(update, backup)
    await until(() => uiState(update, 'hasSaveCandidate'), true, 'backup preview')
    assert.equal(await uiState(update, 'purse'), '100 credits')
    await uiAct(update, 'race-save-restore')
    assert.equal(await uiState(update, 'purse'), '20 credits')
    await update.call('Page.reload')
    await until(() => uiState(update, 'purse'), '20 credits', 'restored progress survived reload')
    await uiAct(update, 'race-garage')
    await uiAct(update, 'upgrade-armor')
    const tier = await uiState(update, 'garageTier')
    assert.ok(typeof tier === 'string')
    assert.match(tier, /Tier 1/)
    await checkOffline(update)
  } finally { await update.close() }
  console.log('Offline player launched, drove, paused, exported a backup, and restored the garage in a second clean browser profile.')
} finally { await rm(temp, { recursive: true, force: true }) }
