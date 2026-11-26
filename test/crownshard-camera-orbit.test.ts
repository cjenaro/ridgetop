import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import {
  CAMERA_FULL_TURN,
  CAMERA_QUARTER_TURN,
  cameraCardinalHeading,
  cameraRelativePanDelta,
  createCrownshardScene,
  normalizeCameraYaw,
  shortestYawDelta,
  snapYawStep,
  stepCameraYaw
} from '../examples/crownshard/crownshard/scene.ts'
import { createInitialState, startChapterBattle, stepGame } from '../examples/crownshard/crownshard/simulation.ts'
import { gridToWorld } from '../examples/crownshard/crownshard/types.ts'
import type { GameState } from '../examples/crownshard/crownshard/types.ts'
import { drawCameraCompassButton } from '../examples/crownshard/crownshard/ui-art.ts'

const EPS = 1e-6

function approxEqual(a: number, b: number, eps = EPS, message?: string) {
  assert.ok(Math.abs(a - b) <= eps, message ?? `Expected ${a} to be within ${eps} of ${b}`)
}

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

function renderFrames(
  scene: ReturnType<typeof createCrownshardScene>,
  state: GameState,
  count: number,
  dt = 1 / 60
) {
  for (let i = 0; i < count; i++) {
    stepGame(state, dt)
    scene.render(state, dt, 1280, 720)
  }
}

test('normalizeCameraYaw and shortestYawDelta handle full 360+ angles and the +/-PI seam', () => {
  approxEqual(normalizeCameraYaw(0), 0)
  approxEqual(normalizeCameraYaw(CAMERA_FULL_TURN), 0)
  approxEqual(normalizeCameraYaw(-CAMERA_FULL_TURN), 0)
  approxEqual(normalizeCameraYaw(3 * Math.PI), -Math.PI)
  approxEqual(normalizeCameraYaw(-Math.PI), -Math.PI)
  approxEqual(normalizeCameraYaw(Math.PI), -Math.PI)
  approxEqual(normalizeCameraYaw(2.5 * Math.PI), CAMERA_QUARTER_TURN)
  approxEqual(normalizeCameraYaw(-2.5 * Math.PI), -CAMERA_QUARTER_TURN)
  assert.equal(normalizeCameraYaw(Number.NaN), 0)
  assert.equal(normalizeCameraYaw(Number.POSITIVE_INFINITY), 0)

  // Shortest arc across the +/-PI seam never spins the long way around
  const cwAcrossSeam = shortestYawDelta(3.0, -3.0)
  approxEqual(cwAcrossSeam, CAMERA_FULL_TURN - 6.0)
  assert.ok(cwAcrossSeam > 0 && cwAcrossSeam < 0.3, 'Crossing +PI -> -PI should take small positive arc')

  const ccwAcrossSeam = shortestYawDelta(-3.0, 3.0)
  approxEqual(ccwAcrossSeam, -(CAMERA_FULL_TURN - 6.0))
  assert.ok(ccwAcrossSeam < 0 && ccwAcrossSeam > -0.3, 'Crossing -PI -> +PI should take small negative arc')

  approxEqual(shortestYawDelta(0, CAMERA_QUARTER_TURN), CAMERA_QUARTER_TURN)
  approxEqual(shortestYawDelta(0, -CAMERA_QUARTER_TURN), -CAMERA_QUARTER_TURN)
})

test('snapYawStep snaps to nearest 90-degree cardinal multiple +/- step across all 4 quadrants and wraps', () => {
  // Clean CW cycle: 0 -> 90 -> 180 -> 270 -> 360 (0 mod 2pi)
  let yaw = 0
  const expectedCw = [CAMERA_QUARTER_TURN, -Math.PI, -CAMERA_QUARTER_TURN, 0]
  for (const exp of expectedCw) {
    yaw = snapYawStep(yaw, 1)
    approxEqual(normalizeCameraYaw(yaw), exp)
  }

  // Clean CCW cycle: 0 -> -90 -> 180 -> 90 -> 0
  yaw = 0
  const expectedCcw = [-CAMERA_QUARTER_TURN, -Math.PI, CAMERA_QUARTER_TURN, 0]
  for (const exp of expectedCcw) {
    yaw = snapYawStep(yaw, -1)
    approxEqual(normalizeCameraYaw(yaw), exp)
  }

  // Snapping from off-cardinal free-orbited angles lands on exact cardinal multiples
  approxEqual(normalizeCameraYaw(snapYawStep(0.22, 1)), CAMERA_QUARTER_TURN)
  approxEqual(normalizeCameraYaw(snapYawStep(0.22, -1)), -CAMERA_QUARTER_TURN)
  approxEqual(normalizeCameraYaw(snapYawStep(1.3, 1)), -Math.PI)
  approxEqual(normalizeCameraYaw(snapYawStep(1.3, -1)), 0)
  approxEqual(normalizeCameraYaw(snapYawStep(-3.0, 1)), -CAMERA_QUARTER_TURN)
  approxEqual(normalizeCameraYaw(snapYawStep(3.0, -1)), CAMERA_QUARTER_TURN)

  // Rapid multi-step snaps preserve continuous direction
  const doubleCw = snapYawStep(snapYawStep(0, 1), 1)
  approxEqual(doubleCw, Math.PI)
  const doubleCcw = snapYawStep(snapYawStep(0, -1), -1)
  approxEqual(doubleCcw, -Math.PI)
})

test('stepCameraYaw eases smoothly and freezes when dt <= 0', () => {
  approxEqual(stepCameraYaw(0, CAMERA_QUARTER_TURN, 0), 0)
  approxEqual(stepCameraYaw(0, CAMERA_QUARTER_TURN, -0.05), 0)

  let y = 0
  for (let i = 0; i < 60; i++) {
    const next = stepCameraYaw(y, CAMERA_QUARTER_TURN, 1 / 60)
    assert.ok(next >= y && next <= CAMERA_QUARTER_TURN + EPS)
    y = next
  }
  approxEqual(y, CAMERA_QUARTER_TURN, 1e-3)
})

test('cameraRelativePanDelta and cameraCardinalHeading match all 4 quadrants', () => {
  // 0 deg (facing North -Z): right -> +X, down -> +Z
  assert.equal(cameraCardinalHeading(0), 'N')
  let [px, pz] = cameraRelativePanDelta(1, 0, 0)
  approxEqual(px, 1); approxEqual(pz, 0)
  ;[px, pz] = cameraRelativePanDelta(0, 1, 0)
  approxEqual(px, 0); approxEqual(pz, 1)

  // 90 deg (facing West -X): right -> -Z, down -> +X
  assert.equal(cameraCardinalHeading(CAMERA_QUARTER_TURN), 'W')
  ;[px, pz] = cameraRelativePanDelta(1, 0, CAMERA_QUARTER_TURN)
  approxEqual(px, 0); approxEqual(pz, -1)
  ;[px, pz] = cameraRelativePanDelta(0, 1, CAMERA_QUARTER_TURN)
  approxEqual(px, 1); approxEqual(pz, 0)

  // 180 deg (facing South +Z): right -> -X, down -> -Z
  assert.equal(cameraCardinalHeading(Math.PI), 'S')
  assert.equal(cameraCardinalHeading(-Math.PI), 'S')
  ;[px, pz] = cameraRelativePanDelta(1, 0, Math.PI)
  approxEqual(px, -1); approxEqual(pz, 0)
  ;[px, pz] = cameraRelativePanDelta(0, 1, Math.PI)
  approxEqual(px, 0); approxEqual(pz, -1)

  // 270 deg / -90 deg (facing East +X): right -> +Z, down -> -X
  assert.equal(cameraCardinalHeading(-CAMERA_QUARTER_TURN), 'E')
  assert.equal(cameraCardinalHeading(3 * CAMERA_QUARTER_TURN), 'E')
  ;[px, pz] = cameraRelativePanDelta(1, 0, -CAMERA_QUARTER_TURN)
  approxEqual(px, 0); approxEqual(pz, 1)
  ;[px, pz] = cameraRelativePanDelta(0, 1, -CAMERA_QUARTER_TURN)
  approxEqual(px, -1); approxEqual(pz, 0)
})

test('CrownshardScene unlocks full 360-degree orbit without +/-0.85 rad clamp and converges via shortest arc', () => {
  const state = createInitialState(42)
  startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  // Free orbit well past the legacy +/-0.85 rad clamp
  scene.rotateCamera(1.6)
  approxEqual(scene.getCameraYaw(), 1.6)
  assert.ok(Math.abs(scene.getCameraYaw()) > 0.85, 'Yaw must not be clamped to +/-0.85 rad')

  // Orbit past full 2*PI and verify clean wrap
  scene.rotateCamera(CAMERA_FULL_TURN + 0.4)
  approxEqual(scene.getCameraYaw(), normalizeCameraYaw(2.0))
  renderFrames(scene, state, 90)
  approxEqual(scene.getCameraYawActual(), normalizeCameraYaw(2.0), 1e-3)

  // Shortest-arc crossing over +/-PI seam (from +3.0 to -3.0 should travel +0.283 rad, never backwards through 0)
  scene.setCameraYaw(3.0, true)
  approxEqual(scene.getCameraYawActual(), 3.0)
  scene.setCameraYaw(-3.0)
  assert.equal(scene.isCameraAnimating(), true)

  let prevDist = Math.abs(shortestYawDelta(scene.getCameraYawActual(), -3.0))
  for (let i = 0; i < 60; i++) {
    renderFrames(scene, state, 1)
    const cur = scene.getCameraYawActual()
    const dist = Math.abs(shortestYawDelta(cur, -3.0))
    assert.ok(dist <= prevDist + 1e-6, `Expected shortest-arc distance to shrink monotonically (${dist} > ${prevDist})`)
    assert.ok(Math.abs(cur) > 2.9, `Camera must stay near +/-PI seam rather than spinning through 0 (got ${cur})`)
    prevDist = dist
  }
  approxEqual(scene.getCameraYawActual(), -3.0, 1e-3)
  assert.equal(scene.isCameraAnimating(), false)

  // Reset returns smoothly via shortest arc to 0
  scene.setCameraYaw(-Math.PI / 4, true)
  scene.resetCamera()
  renderFrames(scene, state, 90)
  approxEqual(scene.getCameraYawActual(), 0, 1e-3)
})

test('CrownshardScene 90-degree snap left/right completes full 360-degree cycles cleanly', () => {
  const state = createInitialState(99)
  startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)
  renderFrames(scene, state, 2)

  // 4 CW snaps (+1) return cleanly to 0
  const cwTargets = [CAMERA_QUARTER_TURN, -Math.PI, -CAMERA_QUARTER_TURN, 0]
  for (const expected of cwTargets) {
    const target = scene.snapCameraYaw(1)
    approxEqual(target, expected)
    assert.equal(scene.isCameraAnimating(), true)
    renderFrames(scene, state, 90)
    approxEqual(scene.getCameraYawActual(), expected, 1e-3)
  }
  assert.equal(scene.isCameraAnimating(), false)

  // 4 CCW snaps (-1) return cleanly to 0
  const ccwTargets = [-CAMERA_QUARTER_TURN, -Math.PI, CAMERA_QUARTER_TURN, 0]
  for (const expected of ccwTargets) {
    const target = scene.snapCameraYaw(-1)
    approxEqual(target, expected)
    renderFrames(scene, state, 90)
    approxEqual(scene.getCameraYawActual(), expected, 1e-3)
  }

  // Rapid double-tap E (CW twice without waiting) reaches 180 deg smoothly in the positive CW direction
  scene.snapCameraYaw(1)
  scene.snapCameraYaw(1)
  renderFrames(scene, state, 1)
  assert.ok(scene.getCameraYawActual() > 0, 'Double CW snap from 0 should begin turning in the +CW direction')
  renderFrames(scene, state, 120)
  approxEqual(Math.abs(scene.getCameraYawActual()), Math.PI, 1e-3)
})

test('CrownshardScene renders frames and picks tiles accurately at 0, 90, 180, and 270 degrees', () => {
  const state = createInitialState(17)
  const battle = startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  // Find a flat walkable cell to verify project -> pickCellAt round-trip at every quadrant
  let flatCol = Math.floor(battle.cols / 2)
  let flatRow = Math.floor(battle.rows / 2)
  outer: for (let r = 1; r < battle.rows - 1; r++) {
    for (let c = 1; c < battle.cols - 1; c++) {
      if (battle.cells[r][c].elevation === 0) {
        flatCol = c
        flatRow = r
        break outer
      }
    }
  }
  const [wx, wy, wz] = gridToWorld(flatCol, flatRow, battle.cells[flatRow][flatCol].elevation, battle.cols, battle.rows)

  const quadrants = [0, CAMERA_QUARTER_TURN, Math.PI, -CAMERA_QUARTER_TURN]
  for (const yaw of quadrants) {
    scene.setCameraYaw(yaw, true)
    renderFrames(scene, state, 3)
    assert.ok(fake.lastInstances > 20, `Expected non-empty scene render at yaw=${yaw}`)

    const screenPt = scene.project(wx, wy, wz, 1280, 720)
    assert.ok(screenPt, `Expected tile (${flatCol},${flatRow}) to project on-screen at yaw=${yaw}`)
    const picked = scene.pickCellAt(battle, screenPt.x, screenPt.y, 1280, 720)
    assert.deepEqual(
      picked,
      { col: flatCol, row: flatRow },
      `Tile picking should round-trip cleanly at yaw=${yaw}`
    )
  }

  // Camera-relative pan shifts the projected board center left when panning right at all 4 quadrants
  scene.setCameraZoom(0.72)
  renderFrames(scene, state, 60)
  for (const yaw of quadrants) {
    scene.resetCamera()
    scene.setCameraZoom(0.72)
    scene.setCameraYaw(yaw, true)
    renderFrames(scene, state, 60)
    const before = scene.project(0, 0, 0, 1280, 720)
    assert.ok(before)
    scene.panCamera(1.0, 0)
    renderFrames(scene, state, 2)
    const after = scene.project(0, 0, 0, 1280, 720)
    assert.ok(after)
    assert.ok(
      after.x < before.x - 5,
      `Panning camera right at yaw=${yaw} should move board center left on screen (${before.x} -> ${after.x})`
    )
  }
})

test('drawCameraCompassButton renders cleanly at all 4 cardinal headings without throwing', () => {
  let ops = 0
  const grad = { addColorStop() {} }
  const ctx = {
    save() { ops++ },
    restore() { ops++ },
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    fill() { ops++ },
    stroke() { ops++ },
    fillText() { ops++ },
    strokeText() {},
    measureText(s: string) { return { width: s.length * 6 } },
    createLinearGradient() { return grad }
  } as unknown as CanvasRenderingContext2D

  const rect = { x: 10, y: 10, width: 34, height: 30 }
  const st = { hovered: false, pressed: false, focused: false, disabled: false, selected: false }
  for (const yaw of [0, CAMERA_QUARTER_TURN, Math.PI, -CAMERA_QUARTER_TURN]) {
    drawCameraCompassButton(ctx, rect, yaw, cameraCardinalHeading(yaw), st)
  }
  assert.ok(ops > 20)
})
