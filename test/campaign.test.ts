import test from 'node:test'
import assert from 'node:assert/strict'
import { campaignSummary, loadCampaign, recordRelay, ROUTE, SAVE_KEY, saveCampaign } from '../game/campaign.ts'

test('progress unlocks the next course and survives reload, while improving records independently', () => {
  const store = new Map()
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) }
  const progress = loadCampaign(storage)
  assert.equal(campaignSummary(progress).next, ROUTE[0])
  recordRelay(progress, ROUTE[0], { finished: false })
  assert.equal(campaignSummary(progress).cleared, 0)
  for (const id of ROUTE) {
    recordRelay(progress, id, { finished: true, signal: false, ticks: 800, falls: 0 })
    recordRelay(progress, id, { finished: true, signal: true, ticks: 1000, falls: 1 })
  }
  progress.sound = false
  saveCampaign(storage, progress)
  const reloaded = loadCampaign(storage)
  assert.deepEqual(campaignSummary(reloaded), {
    cleared: 6, signals: 6, gold: 6, ticks: 4800, complete: true, next: undefined
  })
  assert.equal(reloaded.sound, false)
  storage.setItem(SAVE_KEY, '{"levels":{"ridge":{"ticks":-1,"medal":4}}}')
  assert.equal(campaignSummary(loadCampaign(storage)).cleared, 0)
  storage.setItem(SAVE_KEY, '{malformed')
  assert.equal(campaignSummary(loadCampaign(storage)).next, ROUTE[0])
})
