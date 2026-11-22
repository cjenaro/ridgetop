import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { click, key, openPlayerTab, status, until } from './browser-driver.ts'

const temp = await mkdtemp(join(tmpdir(), 'ridgetop-player-'))
const source = new URL('../dist/signal-drift.html', import.meta.url)
const backup = join(temp, 'signal-drift-save.json')
const backend = process.env.RIDGETOP_BACKENDS?.split(',')[0] ?? 'auto'

async function launch(folder: string) {
  await mkdir(folder)
  const file = join(folder, 'Signal Drift.html')
  await copyFile(source, file)
  const tab = await openPlayerTab(temp)
  try {
    const url = pathToFileURL(file)
    url.searchParams.set('renderer', backend)
    const navigation = await tab.call('Page.navigate', { url: url.href })
    if (navigation.errorText) throw new Error('Chromium could not open the local player file: ' + navigation.errorText)
    await until(() => tab.evaluate("document.querySelector('#race-start')?.disabled"), false, 'offline player started')
    assert.equal(await tab.evaluate("document.querySelector('#race-beacon')"), null)
    return tab
  } catch (error) { await tab.close(); throw error }
}

async function chooseFile(tab, file: string) {
  const { root } = await tab.call('DOM.getDocument')
  const { nodeId } = await tab.call('DOM.querySelector', { nodeId: root.nodeId, selector: '#race-save-file' })
  await tab.call('DOM.setFileInputFiles', { nodeId, files: [file] })
}
async function checkOffline(tab) {
  assert.equal(await tab.evaluate("performance.getEntriesByType('resource').some(r => /^https?:/.test(r.name))"), false)
  assert.deepEqual(tab.errors, [])
}

try {
  const first = await launch(join(temp, 'first download'))
  try {
    await click(first, 'race-garage')
    await first.evaluate("document.querySelector('[data-upgrade=armor]').click()")
    await click(first, 'garage-install')
    assert.equal(await status(first, 'garage-credits'), '20')
    await click(first, 'garage-back')
    await first.evaluate("document.querySelector('#race-saves summary').click()")
    await click(first, 'race-save-export')
    await until(async () => {
      try { return JSON.parse(await readFile(backup, 'utf8')).progress?.build?.armor } catch { return }
    }, 1, 'downloaded the fitted shield in a real save file')
    await click(first, 'race-start')
    await key(first, 'keyDown', 'KeyW', 'w')
    await until(() => status(first, 'race-speed'), n => Number.parseInt(n) >= 12, 'offline race accepted throttle')
    await key(first, 'keyUp', 'KeyW', 'w')
    await click(first, 'race-pause')
    assert.equal(await status(first, 'race-overlay-title'), 'Race paused')
    await checkOffline(first)
  } finally { await first.close() }

  const update = await launch(join(temp, 'fresh install'))
  try {
    assert.equal(await status(update, 'race-purse'), '100 credits')
    await update.evaluate("document.querySelector('#race-saves summary').click()")
    const damaged = join(temp, 'incomplete.json')
    await writeFile(damaged, '{"game":"signal-drift","version":1}')
    await chooseFile(update, damaged)
    await until(() => status(update, 'race-save-status'), s => s?.includes('invalid'), 'damaged backup explained')
    assert.equal(await update.evaluate("document.querySelector('#race-save-restore').hidden"), true)
    await chooseFile(update, backup)
    await until(() => update.evaluate("document.querySelector('#race-save-restore').hidden"), false, 'backup preview')
    assert.equal(await status(update, 'race-purse'), '100 credits')
    await click(update, 'race-save-restore')
    assert.equal(await status(update, 'race-purse'), '20 credits')
    await update.call('Page.reload')
    await until(() => status(update, 'race-purse'), '20 credits', 'restored progress survived reload')
    await click(update, 'race-garage')
    await update.evaluate("document.querySelector('[data-upgrade=armor]').click()")
    assert.match(await status(update, 'garage-tier'), /Tier 1/)
    await checkOffline(update)
  } finally { await update.close() }
  console.log('Offline player launched, drove, paused, exported a backup, and restored the garage in a second clean browser profile.')
} finally { await rm(temp, { recursive: true, force: true }) }
