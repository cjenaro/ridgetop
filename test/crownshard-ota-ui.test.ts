import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOtaStatus,
  applyOtaUpdateReady,
  createOtaBannerState,
  dismissOtaBanner,
  formatDevVersionLabel,
  formatShortOtaVersion,
  getVisibleOtaUpdate,
  reopenOtaBanner
} from '../examples/crownshard/crownshard/ota-ui.ts'
import type { OtaStatusSnapshot } from '../examples/crownshard/crownshard/ota-ui.ts'

test('formatShortOtaVersion compacts CI dev, local, and plain semver versions', () => {
  assert.equal(formatShortOtaVersion('1.0.0+dev.20261127154912.d903eb1'), 'v1.0.0 · d903eb1')
  assert.equal(formatShortOtaVersion('1.2.0+local.20261127154912.4'), 'v1.2.0 · #4')
  assert.equal(formatShortOtaVersion('1.0.0'), 'v1.0.0')
  assert.equal(formatShortOtaVersion('v2.3.4'), 'v2.3.4')
  assert.equal(formatShortOtaVersion(''), 'v0.0.0')
})

test('formatDevVersionLabel hides prod and formats dev/local/web labels', () => {
  const prodStatus: OtaStatusSnapshot = {
    channel: 'prod',
    nativeVersion: '1.0.0',
    nativeBuild: '1',
    activeVersion: '1.0.0+prod.20261127154912.abc1234',
    stagedVersion: null,
    isOtaActive: true
  }
  assert.equal(formatDevVersionLabel(prodStatus), null)
  assert.equal(formatDevVersionLabel(null, { isLocalWeb: false }), null)
  assert.equal(formatDevVersionLabel(null, { isLocalWeb: true }), 'DEV · Web')
  assert.equal(formatDevVersionLabel(null, { isLocalWeb: true, checking: true }), 'DEV · Web · Checking...')

  const devNative: OtaStatusSnapshot = {
    channel: 'dev',
    nativeVersion: '1.0.0',
    nativeBuild: '7',
    activeVersion: null,
    stagedVersion: null,
    isOtaActive: false
  }
  assert.equal(formatDevVersionLabel(devNative), 'DEV · v1.0.0 (b7)')
  assert.equal(formatDevVersionLabel(devNative, { checking: true }), 'DEV · v1.0.0 (b7) · Checking...')

  const devOta: OtaStatusSnapshot = {
    channel: 'dev',
    nativeVersion: '1.0.0',
    nativeBuild: '7',
    activeVersion: '1.0.0+dev.20261127154912.d903eb1',
    stagedVersion: '1.0.0+dev.20261127160000.beef999',
    isOtaActive: true
  }
  assert.equal(formatDevVersionLabel(devOta), 'DEV · v1.0.0 · d903eb1 · Update Ready')

  const localOta: OtaStatusSnapshot = {
    channel: 'local',
    nativeVersion: '1.0.0',
    nativeBuild: '1',
    activeVersion: '1.0.0+local.20261127154912.2',
    stagedVersion: null,
    isOtaActive: true
  }
  assert.equal(formatDevVersionLabel(localOta), 'LOCAL · v1.0.0 · #2')
})

test('OTA banner state supports staged detection, dismiss, newer-version reappear, and reopen', () => {
  let state = createOtaBannerState()
  assert.equal(getVisibleOtaUpdate(state), null)

  // Startup status with an already-staged update surfaces immediately
  state = applyOtaStatus(state, {
    channel: 'dev',
    nativeVersion: '1.0.0',
    nativeBuild: '1',
    activeVersion: '1.0.0+dev.20261127150000.aaa1111',
    stagedVersion: '1.0.0+dev.20261127160000.bbb2222',
    isOtaActive: true
  })
  assert.deepEqual(getVisibleOtaUpdate(state), {
    version: '1.0.0+dev.20261127160000.bbb2222',
    channel: 'dev'
  })

  // Dismissing hides the banner for that version
  state = dismissOtaBanner(state)
  assert.equal(getVisibleOtaUpdate(state), null)

  // Re-firing the same version keeps it dismissed
  state = applyOtaUpdateReady(state, {
    version: '1.0.0+dev.20261127160000.bbb2222',
    channel: 'dev'
  })
  assert.equal(getVisibleOtaUpdate(state), null)

  // Tapping the dev version pill can re-open the dismissed banner
  state = reopenOtaBanner(state)
  assert.deepEqual(getVisibleOtaUpdate(state), {
    version: '1.0.0+dev.20261127160000.bbb2222',
    channel: 'dev'
  })

  // Dismiss again, then a newer version arrives -> banner re-appears automatically
  state = dismissOtaBanner(state)
  assert.equal(getVisibleOtaUpdate(state), null)
  state = applyOtaUpdateReady(state, {
    version: '1.0.0+dev.20261127170000.ccc3333',
    channel: 'dev'
  })
  assert.deepEqual(getVisibleOtaUpdate(state), {
    version: '1.0.0+dev.20261127170000.ccc3333',
    channel: 'dev'
  })
})
