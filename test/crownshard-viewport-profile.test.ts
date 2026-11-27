import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeViewportProfile,
  createInputModalityTracker,
  detectInitialInputModality,
  readDomSafeAreaInsets,
  uiCopy
} from '../examples/crownshard/crownshard/viewport-profile.ts'
import {
  drawAutoBattlePill,
  drawCombatForecast,
  drawCombatLogToggleButton,
  drawDiscoveryTipCard,
  drawEndTurnButton,
  drawForecastAltChip,
  drawSkillTile
} from '../examples/crownshard/crownshard/ui-art.ts'
import type { CombatForecast, CombatForecastAlt } from '../examples/crownshard/crownshard/types.ts'
import type { DiscoveryTipSpec } from '../examples/crownshard/crownshard/discovery-tips.ts'

function createTextRecorderCtx() {
  const texts: string[] = []
  const gradient = { addColorStop() {} }
  const ctx = {
    font: '12px sans-serif',
    fillStyle: '#fff',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    rect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    clip() {},
    fillRect() {},
    strokeRect() {},
    translate() {},
    rotate() {},
    scale() {},
    setLineDash() {},
    createLinearGradient() {
      return gradient
    },
    createRadialGradient() {
      return gradient
    },
    measureText(text: string) {
      return { width: text.length * 7 }
    },
    fillText(text: string) {
      texts.push(String(text))
    },
    strokeText() {}
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts }
}

const IDLE_STATE = { hovered: false, pressed: false, focused: false, selected: false, disabled: false }

test('computeViewportProfile classifies portrait phone, landscape phone, tablet, and desktop accurately', () => {
  const portraitPhone = computeViewportProfile(390, 844)
  assert.equal(portraitPhone.deviceClass, 'portraitPhone')
  assert.equal(portraitPhone.orientation, 'portrait')
  assert.equal(portraitPhone.isPhone, true)
  assert.equal(portraitPhone.isPortraitPhone, true)
  assert.equal(portraitPhone.isLandscapePhone, false)
  assert.equal(portraitPhone.isTablet, false)
  assert.equal(portraitPhone.isCompact, true)
  assert.equal(portraitPhone.minTouchTarget, 44)

  const iphoneSE = computeViewportProfile(375, 667)
  assert.equal(iphoneSE.deviceClass, 'portraitPhone')
  assert.equal(iphoneSE.isPhone, true)
  assert.equal(iphoneSE.minTouchTarget, 44)

  for (const [w, h] of [
    [844, 390],
    [852, 393],
    [667, 375],
    [932, 430]
  ] as const) {
    const landscapePhone = computeViewportProfile(w, h)
    assert.equal(landscapePhone.deviceClass, 'landscapePhone', `${w}x${h} should be landscapePhone`)
    assert.equal(landscapePhone.orientation, 'landscape')
    assert.equal(landscapePhone.isPhone, true)
    assert.equal(landscapePhone.isLandscapePhone, true)
    assert.equal(landscapePhone.isPortraitPhone, false)
    assert.equal(landscapePhone.isCompact, true)
    assert.equal(landscapePhone.minTouchTarget, 44)
  }

  const tabletPortrait = computeViewportProfile(768, 1024)
  assert.equal(tabletPortrait.deviceClass, 'tablet')
  assert.equal(tabletPortrait.orientation, 'portrait')
  assert.equal(tabletPortrait.isTablet, true)
  assert.equal(tabletPortrait.isPhone, false)

  const tabletLandscape = computeViewportProfile(1024, 768)
  assert.equal(tabletLandscape.deviceClass, 'tablet')
  assert.equal(tabletLandscape.orientation, 'landscape')
  assert.equal(tabletLandscape.isTablet, true)
  assert.equal(tabletLandscape.isPhone, false)

  const desktop = computeViewportProfile(1440, 900)
  assert.equal(desktop.deviceClass, 'desktop')
  assert.equal(desktop.orientation, 'landscape')
  assert.equal(desktop.isPhone, false)
  assert.equal(desktop.isTablet, false)
  assert.equal(desktop.isCompact, false)
  assert.equal(desktop.minTouchTarget, 28)
})

test('computeViewportProfile clamps safe-area insets to at least minMargin while preserving notch values', () => {
  const portraitNotch = computeViewportProfile(390, 844, {
    safeArea: { top: 59, right: 0, bottom: 34, left: 0 }
  })
  assert.deepEqual(portraitNotch.safeArea, { top: 59, right: 8, bottom: 34, left: 8 })

  const landscapeNotch = computeViewportProfile(844, 390, {
    safeArea: { top: 0, right: 59, bottom: 21, left: 59 }
  })
  assert.deepEqual(landscapeNotch.safeArea, { top: 8, right: 59, bottom: 21, left: 59 })

  const fallback = computeViewportProfile(1440, 900)
  assert.deepEqual(fallback.safeArea, { top: 8, right: 8, bottom: 8, left: 8 })

  const customMin = computeViewportProfile(1440, 900, { minMargin: 12, safeArea: { top: 4, bottom: 20 } })
  assert.deepEqual(customMin.safeArea, { top: 12, right: 12, bottom: 20, left: 12 })
})

test('showKeycaps and minTouchTarget respond to input modality', () => {
  const touchDesktop = computeViewportProfile(1440, 900, { modality: 'touch' })
  assert.equal(touchDesktop.isTouchPrimary, true)
  assert.equal(touchDesktop.showKeycaps, false)
  assert.equal(touchDesktop.minTouchTarget, 44)

  const kbDesktop = computeViewportProfile(1440, 900, { modality: 'keyboard_mouse' })
  assert.equal(kbDesktop.isTouchPrimary, false)
  assert.equal(kbDesktop.showKeycaps, true)
  assert.equal(kbDesktop.minTouchTarget, 28)

  const touchPhone = computeViewportProfile(390, 844, { modality: 'touch' })
  assert.equal(touchPhone.showKeycaps, false)
  assert.equal(touchPhone.minTouchTarget, 44)
})

test('SSR/Node safe helpers return clean defaults', () => {
  assert.deepEqual(readDomSafeAreaInsets(), { top: 0, right: 0, bottom: 0, left: 0 })
  assert.equal(detectInitialInputModality(), 'keyboard_mouse')
  assert.equal(uiCopy(false, 'Click to move', 'Tap to move'), 'Click to move')
  assert.equal(uiCopy(true, 'Click to move', 'Tap to move'), 'Tap to move')
})

test('createInputModalityTracker transitions cleanly between touch and keyboard/mouse with emulated-mouse guard', () => {
  const tracker = createInputModalityTracker('keyboard_mouse')
  const history: string[] = []
  const unsub = tracker.subscribe((m) => history.push(m))

  assert.equal(tracker.modality, 'keyboard_mouse')

  // Touch switches immediately to 'touch'
  assert.equal(tracker.onPointerEvent({ pointerType: 'touch' }, 1000), true)
  assert.equal(tracker.modality, 'touch')

  // Synthetic/emulated mouse event shortly after touch is ignored
  assert.equal(tracker.onPointerEvent({ pointerType: 'mouse' }, 1250), false)
  assert.equal(tracker.modality, 'touch')

  // Modifier-only keydown does not switch modality
  assert.equal(tracker.onKeyDown({ key: 'Shift' }, 1300), false)
  assert.equal(tracker.onKeyDown({ key: 'Control' }, 1310), false)
  assert.equal(tracker.modality, 'touch')

  // Real physical non-modifier key switches to 'keyboard_mouse'
  assert.equal(tracker.onKeyDown({ key: '1' }, 1350), true)
  assert.equal(tracker.modality, 'keyboard_mouse')

  // Back to touch, then real mouse after guard window expires
  assert.equal(tracker.onPointerEvent({ pointerType: 'touch' }, 2000), true)
  assert.equal(tracker.modality, 'touch')
  assert.equal(tracker.onPointerEvent({ pointerType: 'mouse' }, 3000), true)
  assert.equal(tracker.modality, 'keyboard_mouse')

  unsub()
  assert.equal(tracker.onPointerEvent({ pointerType: 'touch' }, 4000), true)
  assert.deepEqual(history, ['touch', 'keyboard_mouse', 'touch', 'keyboard_mouse'])
})

test('ui-art draw helpers hide keycaps and swap mouse copy when touch/hideKeycap is active', () => {
  // 1. drawSkillTile
  const tileDesktop = createTextRecorderCtx()
  drawSkillTile(
    tileDesktop.ctx,
    { x: 0, y: 0, width: 84, height: 72 },
    { name: 'Slash', subtitle: 'DMG', keycap: '1', vfx: 'strike', skillId: 'strike', unlocked: true, cooldown: 0 },
    IDLE_STATE
  )
  assert.ok(tileDesktop.texts.includes('1'))

  const tileTouch = createTextRecorderCtx()
  drawSkillTile(
    tileTouch.ctx,
    { x: 0, y: 0, width: 84, height: 72 },
    { name: 'Slash', subtitle: 'DMG', keycap: '1', hideKeycap: true, vfx: 'strike', skillId: 'strike', unlocked: true, cooldown: 0 },
    IDLE_STATE
  )
  assert.ok(!tileTouch.texts.includes('1'))

  // 2. drawForecastAltChip
  const alt: CombatForecastAlt = {
    skillIndex: 1,
    keycap: '2',
    name: 'Firebolt',
    normalDmg: 24,
    critDmg: 36,
    critChance: 0.15,
    healAmount: 0,
    selfShield: 0,
    lethalNormal: false,
    requiresMove: false,
    attackArc: 'front',
    active: true
  }
  const altDesktop = createTextRecorderCtx()
  drawForecastAltChip(altDesktop.ctx, { x: 0, y: 0, width: 140, height: 28 }, alt, IDLE_STATE)
  assert.ok(altDesktop.texts.includes('2'))

  const altTouch = createTextRecorderCtx()
  drawForecastAltChip(altTouch.ctx, { x: 0, y: 0, width: 140, height: 28 }, alt, IDLE_STATE, { hideKeycap: true })
  assert.ok(!altTouch.texts.includes('2'))

  // 3. drawCombatForecast empty-ground copy
  const emptyForecast: CombatForecast = {
    mode: 'skill',
    skillIndex: 1,
    attackerUid: 'u1',
    attackerName: 'Lyra',
    attackerStars: 1,
    targetUid: null,
    targetName: 'Empty Ground',
    targetTeam: 'none',
    targetCol: 3,
    targetRow: 2,
    approachCol: 2,
    approachRow: 2,
    requiresMove: false,
    path: [],
    actionName: 'Fireball',
    isOffensive: true,
    isRevive: false,
    emptyTileTarget: true,
    normalDmg: 0,
    critDmg: 0,
    critChance: 0,
    healAmount: 0,
    shieldAmount: 0,
    selfShield: 0,
    targetHpBefore: 0,
    targetMaxHp: 1,
    targetShieldBefore: 0,
    targetHpAfterNormal: 0,
    targetHpAfterCrit: 0,
    lethalNormal: false,
    lethalCrit: false,
    highGround: false,
    elevationDiff: 0,
    coverBonus: 0,
    terrainDefBonus: 0,
    empowered: false,
    attackArc: 'front',
    friendlyFire: false,
    friendlyFireCount: 0,
    ignoreArmor: 0,
    aoeTargets: 0,
    alternatives: []
  }
  const fcDesktop = createTextRecorderCtx()
  drawCombatForecast(fcDesktop.ctx, { x: 0, y: 0, width: 320, height: 110 }, emptyForecast, { isTouch: false })
  assert.ok(fcDesktop.texts.some((t) => t.startsWith('Click to cast on empty ground anyway')))

  const fcTouch = createTextRecorderCtx()
  drawCombatForecast(fcTouch.ctx, { x: 0, y: 0, width: 320, height: 110 }, emptyForecast, { isTouch: true })
  assert.ok(fcTouch.texts.some((t) => t.startsWith('Tap to cast on empty ground anyway')))

  // 4. drawDiscoveryTipCard hotkey pill
  const tip: DiscoveryTipSpec = {
    id: 'high_ground',
    screen: 'battle',
    category: 'terrain',
    icon: 'up',
    accentHex: '#ffc83b',
    title: 'High Ground',
    body: 'Attack from above for bonus damage.',
    touchBody: 'Attack from above for bonus damage.',
    hotkeyHint: 'Q / E'
  }
  const tipDesktop = createTextRecorderCtx()
  drawDiscoveryTipCard(tipDesktop.ctx, { x: 0, y: 0, width: 320, height: 110 }, tip, { isTouch: false })
  assert.ok(tipDesktop.texts.includes('Q / E'))

  const tipTouch = createTextRecorderCtx()
  drawDiscoveryTipCard(tipTouch.ctx, { x: 0, y: 0, width: 320, height: 110 }, tip, { isTouch: true })
  assert.ok(!tipTouch.texts.includes('Q / E'))

  // 5. drawEndTurnButton
  const endDesktop = createTextRecorderCtx()
  drawEndTurnButton(endDesktop.ctx, { x: 0, y: 0, width: 120, height: 96 }, { isPlayerTurn: true, ctBonus: 20 }, IDLE_STATE)
  assert.ok(endDesktop.texts.includes('Space'))

  const endTouch = createTextRecorderCtx()
  drawEndTurnButton(
    endTouch.ctx,
    { x: 0, y: 0, width: 120, height: 96 },
    { isPlayerTurn: true, ctBonus: 20, isTouch: true },
    IDLE_STATE
  )
  assert.ok(!endTouch.texts.includes('Space'))

  // 6. drawCombatLogToggleButton
  const logDesktop = createTextRecorderCtx()
  drawCombatLogToggleButton(logDesktop.ctx, { x: 0, y: 0, width: 100, height: 34 }, IDLE_STATE, {
    open: false,
    unreadCount: 0,
    totalCount: 5
  })
  assert.ok(logDesktop.texts.includes('Log L'))

  const logTouch = createTextRecorderCtx()
  drawCombatLogToggleButton(logTouch.ctx, { x: 0, y: 0, width: 100, height: 34 }, IDLE_STATE, {
    open: false,
    unreadCount: 0,
    totalCount: 5,
    isTouch: true
  })
  assert.ok(logTouch.texts.includes('Log'))
  assert.ok(!logTouch.texts.includes('Log L'))

  // 7. drawAutoBattlePill
  const autoDesktop = createTextRecorderCtx()
  drawAutoBattlePill(autoDesktop.ctx, { x: 0, y: 0, width: 260, height: 32 }, 2, IDLE_STATE, false, false)
  assert.ok(autoDesktop.texts.includes('AUTO-BATTLE 2x · B / ESC STOP'))

  const autoTouch = createTextRecorderCtx()
  drawAutoBattlePill(autoTouch.ctx, { x: 0, y: 0, width: 260, height: 32 }, 2, IDLE_STATE, false, true)
  assert.ok(autoTouch.texts.includes('AUTO-BATTLE 2x · TAP TO STOP'))
})
