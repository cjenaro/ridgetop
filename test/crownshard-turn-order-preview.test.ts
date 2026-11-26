import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import type { CanvasWidgetDrawState } from '../packages/ridgetop/framework/ui.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  computeTurnActionCtCost, createInitialState, effectiveSpeed, endPlayerTurn,
  getUnitByUid, previewTurnOrderAfterAction, startChapterBattle, stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import type { BattleState, GameState, TurnActionKind } from '../examples/crownshard/crownshard/types.ts'
import {
  drawTimelineBg, drawTurnOrderCallout, drawTurnOrderPreviewBanner,
  drawTurnTimelinePreviewOverlay, drawTurnToken
} from '../examples/crownshard/crownshard/ui-art.ts'

function fakeRenderer() {
  let drawn = 0
  let lastInstances = 0
  const stats: RenderStats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      drawn++
      let n = 0
      for (const b of batches) n += b.count
      lastInstances = n
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get drawn() { return drawn },
    get lastInstances() { return lastInstances }
  }
}

function fakeCanvas2dContext() {
  let ops = 0
  const grad = { addColorStop() {} }
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    save() { ops++ },
    restore() { ops++ },
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    ellipse() {},
    rect() {},
    clip() {},
    fill() { ops++ },
    stroke() { ops++ },
    fillRect() { ops++ },
    strokeRect() {},
    fillText() { ops++ },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, get ops() { return ops } }
}

function cloneState(state: GameState): GameState {
  return structuredClone(state)
}

function advanceToFirstPlayerTurn(state: GameState): BattleState {
  const battle = state.battle!
  let guard = 0
  while (battle.phase === 'enemy' && guard++ < 200) {
    stepGame(state, 0.1)
  }
  assert.equal(battle.phase, 'player', 'Expected battle to reach a player turn')
  return battle
}

test('previewTurnOrderAfterAction does not mutate battle state across all action kinds', () => {
  const state = createInitialState(1337)
  startChapterBattle(state, 0)
  const battle = advanceToFirstPlayerTurn(state)

  const before = JSON.stringify(battle)
  const kinds: readonly TurnActionKind[] = ['wait', 'move_only', 'act', 'move_and_act']
  for (const kind of kinds) {
    const preview = previewTurnOrderAfterAction(battle, kind, 8)
    assert.ok(preview, `Expected non-null preview for ${kind}`)
    assert.equal(preview.projectedOrder.length, 8)
  }
  const after = JSON.stringify(battle)
  assert.equal(after, before, 'previewTurnOrderAfterAction must never mutate battle state')
})

test('previewTurnOrderAfterAction has exact parity with endPlayerTurn for wait, move-only, direct act, and full move+act', () => {
  for (const chapterIdx of [0, 1, 2]) {
    const baseState = createInitialState(2026 + chapterIdx)
    startChapterBattle(baseState, chapterIdx)
    advanceToFirstPlayerTurn(baseState)

    // 1. Fresh Wait (moved=false, acted=false -> 60 CT spent, +40 CT saved)
    {
      const s = cloneState(baseState)
      const battle = s.battle!
      const preview = previewTurnOrderAfterAction(battle, 'wait', 8)!
      assert.equal(preview.ctCost, 60)
      assert.equal(preview.ctSaved, 40)
      endPlayerTurn(s)
      assert.deepEqual(
        preview.projectedOrder,
        battle.turnOrder,
        `Chapter ${chapterIdx}: 'wait' preview must match real battle.turnOrder after endPlayerTurn`
      )
    }

    // 2. Move only (moved=true, acted=false -> 80 CT spent, +20 CT saved)
    {
      const s = cloneState(baseState)
      const battle = s.battle!
      const previewBeforeMove = previewTurnOrderAfterAction(battle, 'move_only', 8)!
      assert.equal(previewBeforeMove.ctCost, 80)
      assert.equal(previewBeforeMove.ctSaved, 20)

      const active = getUnitByUid(battle, battle.activeUnitUid)!
      active.moved = true
      const previewWaitAfterMove = previewTurnOrderAfterAction(battle, 'wait', 8)!
      assert.deepEqual(previewWaitAfterMove.projectedOrder, previewBeforeMove.projectedOrder)
      assert.equal(previewWaitAfterMove.ctCost, 80)

      endPlayerTurn(s)
      assert.deepEqual(
        previewBeforeMove.projectedOrder,
        battle.turnOrder,
        `Chapter ${chapterIdx}: 'move_only' preview must match real battle.turnOrder after endPlayerTurn`
      )
    }

    // 3. Direct act without moving (moved=false, acted=true -> 80 CT spent, +20 CT saved)
    {
      const s = cloneState(baseState)
      const battle = s.battle!
      const previewAct = previewTurnOrderAfterAction(battle, 'act', 8)!
      assert.equal(previewAct.ctCost, 80)
      assert.equal(previewAct.ctSaved, 20)

      const active = getUnitByUid(battle, battle.activeUnitUid)!
      active.acted = true
      endPlayerTurn(s)
      assert.deepEqual(
        previewAct.projectedOrder,
        battle.turnOrder,
        `Chapter ${chapterIdx}: direct 'act' preview must match real battle.turnOrder after endPlayerTurn`
      )
    }

    // 4. Full turn: Move + Act (moved=true, acted=true -> 100 CT spent, 0 CT saved)
    {
      const s = cloneState(baseState)
      const battle = s.battle!
      const previewFull = previewTurnOrderAfterAction(battle, 'move_and_act', 8)!
      assert.equal(previewFull.ctCost, 100)
      assert.equal(previewFull.ctSaved, 0)

      const active = getUnitByUid(battle, battle.activeUnitUid)!
      active.moved = true
      // Once moved, 'act' also represents a full 100 CT turn
      const previewActAfterMove = previewTurnOrderAfterAction(battle, 'act', 8)!
      assert.equal(previewActAfterMove.ctCost, 100)
      assert.deepEqual(previewActAfterMove.projectedOrder, previewFull.projectedOrder)

      active.acted = true
      endPlayerTurn(s)
      assert.deepEqual(
        previewFull.projectedOrder,
        battle.turnOrder,
        `Chapter ${chapterIdx}: full 'move_and_act' / 'act' preview must match real battle.turnOrder after endPlayerTurn`
      )
    }
  }
})

test('previewTurnOrderAfterAction preserves exact parity when upcoming units are slowed, stunned, or burning', () => {
  const state = createInitialState(777)
  startChapterBattle(state, 0)
  const battle = advanceToFirstPlayerTurn(state)

  // Apply slow, stun, and fatal burn to other living units to exercise start-of-turn ticks
  const others = battle.units.filter(u => u.alive && u.uid !== battle.activeUnitUid)
  assert.ok(others.length >= 3)
  others[0].ct = 99
  others[0].stunTurns = 1
  others[1].ct = 98
  others[1].slowTurns = 1
  others[2].ct = 97
  others[2].hp = 6
  others[2].shield = 0
  others[2].burnTurns = 1

  for (const kind of ['wait', 'move_and_act'] as const) {
    const s = cloneState(state)
    const b = s.battle!
    const preview = previewTurnOrderAfterAction(b, kind, 8)!
    const active = getUnitByUid(b, b.activeUnitUid)!
    if (kind === 'move_and_act') {
      active.moved = true
      active.acted = true
    }
    endPlayerTurn(s)
    assert.deepEqual(
      preview.projectedOrder,
      b.turnOrder,
      `Status-effect parity failed for ${kind}`
    )
  }
})

test('Wait CT bonus visibly shifts the active hero earlier in the projected timeline vs full move+act', () => {
  const state = createInitialState(42)
  startChapterBattle(state, 0)
  const battle = advanceToFirstPlayerTurn(state)

  const waitPreview = previewTurnOrderAfterAction(battle, 'wait', 8)!
  const moveOnlyPreview = previewTurnOrderAfterAction(battle, 'move_only', 8)!
  const fullPreview = previewTurnOrderAfterAction(battle, 'move_and_act', 8)!

  assert.equal(computeTurnActionCtCost({ moved: false, acted: false }, 'wait'), 60)
  assert.equal(computeTurnActionCtCost({ moved: false, acted: false }, 'move_only'), 80)
  assert.equal(computeTurnActionCtCost({ moved: false, acted: false }, 'move_and_act'), 100)

  assert.ok(waitPreview.remainingCt > moveOnlyPreview.remainingCt, 'Wait should retain more CT than move-only')
  assert.ok(moveOnlyPreview.remainingCt > fullPreview.remainingCt, 'Move-only should retain more CT than full turn')
  assert.equal(waitPreview.remainingCt - fullPreview.remainingCt, 40)

  assert.ok(waitPreview.projectedIndex >= 0, 'Active hero must appear in projected timeline')
  assert.ok(fullPreview.projectedIndex >= 0, 'Active hero must appear in full-spend timeline')
  assert.equal(waitPreview.projectedOrder[waitPreview.projectedIndex].uid, waitPreview.activeUnitUid)
  assert.equal(fullPreview.projectedOrder[fullPreview.projectedIndex].uid, fullPreview.activeUnitUid)

  assert.ok(
    waitPreview.projectedIndex < fullPreview.projectedIndex,
    `Expected Wait (#${waitPreview.projectedIndex + 1}) to place hero strictly earlier than full Move+Act (#${fullPreview.projectedIndex + 1})`
  )
  assert.ok(waitPreview.slotsGained > 0, `Expected positive slotsGained from Wait, got ${waitPreview.slotsGained}`)
  assert.equal(fullPreview.slotsGained, 0, 'Full 100 CT spend has 0 slotsGained vs baseline')

  // Returns null outside player phase
  battle.phase = 'enemy'
  assert.equal(previewTurnOrderAfterAction(battle, 'wait', 8), null)
})

test('CrownshardScene renders cleanly with spotlightUnitUid set for both ally and enemy units', () => {
  const state = createInitialState(99)
  startChapterBattle(state, 0)
  const battle = advanceToFirstPlayerTurn(state)

  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  // Baseline frame without spotlight
  scene.setSpotlightUnit(null)
  assert.equal(scene.getSpotlightUnit(), null)
  scene.render(state, 1 / 60, 1280, 720)
  const baseInstances = fake.lastInstances

  const ally = battle.units.find(u => u.alive && u.team === 'ally')!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  // Spotlight an ally unit
  scene.setSpotlightUnit(ally.uid)
  assert.equal(scene.getSpotlightUnit(), ally.uid)
  scene.render(state, 1 / 60, 1280, 720)
  const allySpotInstances = fake.lastInstances
  assert.ok(allySpotInstances > baseInstances, 'Ally spotlight should emit additional 3D beacon/ring instances')

  // Spotlight an enemy unit
  scene.setSpotlightUnit(enemy.uid)
  assert.equal(scene.getSpotlightUnit(), enemy.uid)
  scene.render(state, 1 / 60, 1280, 720)
  const enemySpotInstances = fake.lastInstances
  assert.ok(enemySpotInstances > baseInstances, 'Enemy spotlight should emit additional 3D beacon/ring instances')

  // Clear spotlight and ensure non-existent UID also renders safely
  scene.setSpotlightUnit('nonexistent_uid')
  scene.render(state, 1 / 60, 1280, 720)
  scene.setSpotlightUnit(null)
  scene.render(state, 1 / 60, 1280, 720)
  assert.equal(fake.drawn, 5)
})

test('Turn-order UI helpers render cleanly in normal, hovered spotlight, and CT shift ghost preview states', () => {
  const state = createInitialState(55)
  startChapterBattle(state, 0)
  const battle = advanceToFirstPlayerTurn(state)
  const active = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!

  const waitPreview = previewTurnOrderAfterAction(battle, 'wait', 7)!
  const actPreview = previewTurnOrderAfterAction(battle, 'move_and_act', 7)!

  const mock = fakeCanvas2dContext()
  const idleState: CanvasWidgetDrawState = { hovered: false, pressed: false, focused: false, disabled: false, selected: false }
  const hoverState: CanvasWidgetDrawState = { hovered: true, pressed: false, focused: false, disabled: false, selected: false }

  const barRect = { x: 420, y: 8, width: 398, height: 72 }
  drawTimelineBg(mock.ctx, barRect)

  // 1. Normal tokens
  battle.turnOrder.slice(0, 7).forEach((entry, idx) => {
    const r = { x: barRect.x + 9 + idx * 55, y: barRect.y + 6, width: 50, height: 60 }
    drawTurnToken(mock.ctx, r, entry, undefined, idleState)
  })

  // 2. Hovered spotlight token + callout (ally & enemy)
  drawTurnToken(mock.ctx, { x: barRect.x + 64, y: barRect.y + 6, width: 50, height: 60 }, battle.turnOrder[1], undefined, hoverState, {
    spotlighted: true
  })
  drawTurnToken(mock.ctx, { x: barRect.x + 119, y: barRect.y + 6, width: 50, height: 60 }, battle.turnOrder[2], undefined, idleState, {
    dimmed: true
  })
  drawTurnOrderCallout(mock.ctx, { x: 420, y: 84, width: 398, height: 26 }, {
    name: active.name,
    team: active.team,
    hp: active.hp,
    maxHp: active.maxHp,
    shield: 12,
    ct: active.ct,
    speed: effectiveSpeed(active),
    slotIndex: 0,
    isCurrent: true
  })
  drawTurnOrderCallout(mock.ctx, { x: 420, y: 84, width: 398, height: 26 }, {
    name: enemy.name,
    team: enemy.team,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    shield: 0,
    ct: enemy.ct,
    speed: effectiveSpeed(enemy),
    slotIndex: 2,
    isCurrent: false
  })

  // 3. CT shift ghost preview (Wait bonus + Act full-spend with comparison)
  drawTurnToken(mock.ctx, { x: barRect.x + 119, y: barRect.y + 6, width: 50, height: 60 }, battle.turnOrder[2], undefined, idleState, {
    projectedSlot: true,
    projectedBadge: `+${waitPreview.ctSaved} CT`,
    projectedAccent: '#5ce1ff'
  })
  drawTurnToken(mock.ctx, { x: barRect.x + 229, y: barRect.y + 6, width: 50, height: 60 }, battle.turnOrder[4], undefined, idleState, {
    wasBaselineSlot: true
  })
  drawTurnTimelinePreviewOverlay(mock.ctx, barRect, waitPreview, {
    slotCount: 7,
    tokenW: 50,
    gap: 5,
    padX: 9,
    time: 1.25
  })
  drawTurnOrderPreviewBanner(mock.ctx, { x: 420, y: 84, width: 398, height: 26 }, waitPreview)

  drawTurnTimelinePreviewOverlay(mock.ctx, barRect, actPreview, {
    slotCount: 7,
    tokenW: 50,
    gap: 5,
    padX: 9,
    time: 2.5
  })
  drawTurnOrderPreviewBanner(mock.ctx, { x: 420, y: 84, width: 398, height: 26 }, actPreview, waitPreview)

  assert.ok(mock.ops > 150, `Expected substantial canvas draw operations, got ${mock.ops}`)
})
