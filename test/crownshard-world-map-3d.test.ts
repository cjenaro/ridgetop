import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { worldToScreen } from '../packages/ridgetop/framework/index.ts'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import { CHAPTERS, CHAPTER_BY_ID, WORLD_REGIONS } from '../examples/crownshard/crownshard/data.ts'
import type { WorldRegionId } from '../examples/crownshard/crownshard/types.ts'
import {
  DIORAMA_D,
  DIORAMA_FLY_IN_DURATION,
  DIORAMA_FOV_DEFAULT,
  DIORAMA_FOV_FLY_IN,
  DIORAMA_SEA_Y,
  DIORAMA_W,
  DIORAMA_YAW_MAX,
  DIORAMA_YAW_MIN,
  DIORAMA_ZOOM_MAX,
  DIORAMA_ZOOM_MIN,
  buildDioramaLandmarks,
  buildDioramaRoadSegments,
  completeDioramaFlyIn,
  computeDioramaCameraVectors,
  createWorldMap3DCamera,
  dioramaElevationAt,
  dioramaNormToXZ,
  dioramaRegionAtNorm,
  focusDioramaOnStage,
  getDioramaFlyInProgress,
  panDioramaCamera,
  resetDioramaCamera,
  rotateDioramaCamera,
  startDioramaFlyIn,
  stepDioramaCamera,
  worldMapNormToDiorama,
  zoomDioramaCamera
} from '../examples/crownshard/crownshard/world-map-3d.ts'
import { computeWorldMapProjectionMatrix, projectWorldMapPoint } from '../examples/crownshard/crownshard/scene.ts'
import { drawWorldMapCanvas } from '../examples/crownshard/crownshard/ui-art.ts'

// =========================================================================
// 1. COORDINATE MAPPING & SCULPTED HEIGHTFIELD ACROSS ALL 33 STAGES & 9 REGIONS
// =========================================================================

test('worldMapNormToDiorama & dioramaElevationAt produce finite, distinct, bounded 3D coords for all 33 chapters', () => {
  assert.equal(CHAPTERS.length, 33)

  const seen = new Set<string>()
  const halfW = DIORAMA_W * 0.5
  const halfD = DIORAMA_D * 0.5

  for (const ch of CHAPTERS) {
    const [x, y, z] = worldMapNormToDiorama(ch.mapX, ch.mapY)
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `${ch.id} has non-finite diorama coords`)
    assert.ok(x >= -halfW && x <= halfW, `${ch.id} x=${x} out of bounds [-${halfW}, ${halfW}]`)
    assert.ok(z >= -halfD && z <= halfD, `${ch.id} z=${z} out of bounds [-${halfD}, ${halfD}]`)
    assert.ok(y > DIORAMA_SEA_Y && y <= 2.7, `${ch.id} y=${y} must rest above sea level and within height bounds`)

    // Distinct XZ positions for every stage
    const key = `${Math.round(x * 100)},${Math.round(z * 100)}`
    assert.equal(seen.has(key), false, `Duplicate diorama XZ coordinate for stage ${ch.id}`)
    seen.add(key)

    // Elevation query agrees identically with worldMapNormToDiorama
    assert.equal(dioramaElevationAt(x, z), y)
  }
})

test('sculpted heightfield respects regional geography (Aether Isles high, Silverfen river valley low, Frostspire alpine)', () => {
  const oceanPos = dioramaNormToXZ(0.01, 0.02)
  assert.equal(dioramaRegionAtNorm(0.01, 0.02), 'ocean')
  assert.equal(dioramaElevationAt(oceanPos[0], oceanPos[1]), DIORAMA_SEA_Y)

  const avgElevForRegion = (region: WorldRegionId): number => {
    const stages = CHAPTERS.filter(c => c.region === region)
    assert.ok(stages.length > 0, `Expected at least one chapter in ${region}`)
    let sum = 0
    for (const s of stages) sum += worldMapNormToDiorama(s.mapX, s.mapY)[1]
    return sum / stages.length
  }

  const solisAvg = avgElevForRegion('solis_vale')
  const silverfenAvg = avgElevForRegion('silverfen')
  const frostAvg = avgElevForRegion('frostspire')
  const aetherAvg = avgElevForRegion('aether_isles')
  const eclipseAvg = avgElevForRegion('eclipse_dominion')

  // Silverfen river valley is carved lower than Solis Vale meadow plateau
  const sunkenBridgeY = worldMapNormToDiorama(
    CHAPTER_BY_ID.sunken_bridge.mapX,
    CHAPTER_BY_ID.sunken_bridge.mapY
  )[1]
  const borderWatchY = worldMapNormToDiorama(
    CHAPTER_BY_ID.border_watch.mapX,
    CHAPTER_BY_ID.border_watch.mapY
  )[1]
  assert.ok(
    silverfenAvg < solisAvg && sunkenBridgeY < borderWatchY,
    `Expected Silverfen valley (${silverfenAvg.toFixed(2)}, bridge ${sunkenBridgeY.toFixed(2)}) lower than Solis meadow (${solisAvg.toFixed(2)}, watch ${borderWatchY.toFixed(2)})`
  )

  // Frostspire towers above Solis Vale and Silverfen
  assert.ok(
    frostAvg > solisAvg + 0.45,
    `Expected Frostspire (${frostAvg.toFixed(2)}) well above Solis Vale (${solisAvg.toFixed(2)})`
  )

  // Aether Isles float high above sea clouds and mainland plains
  assert.ok(
    aetherAvg > 1.85 && aetherAvg > solisAvg + 1.1 && aetherAvg > eclipseAvg + 0.4,
    `Expected Aether Isles (${aetherAvg.toFixed(2)}) to float high above mainland`
  )
})

// =========================================================================
// 2. STATIC LANDMARKS, PROPS & ROAD SEGMENTS LAYOUT
// =========================================================================

test('buildDioramaLandmarks covers all 33 stages, 9 regions, bridges, castles, rivers, mountains, and props with zero NaNs', () => {
  const data = buildDioramaLandmarks()
  assert.equal(data.stages.length, CHAPTERS.length)
  assert.equal(data.regions.length, Object.keys(WORLD_REGIONS).length)
  assert.ok(data.terrainTiles.length >= 100 && data.terrainTiles.length <= 260, `terrainTiles=${data.terrainTiles.length} should stay disciplined`)

  const stageIds = new Set(data.stages.map(s => s.stageId))
  for (const ch of CHAPTERS) {
    assert.ok(stageIds.has(ch.id), `Missing diorama landmark for stage ${ch.id}`)
  }

  for (const st of data.stages) {
    assert.ok(st.position.every(Number.isFinite), `Non-finite stage position on ${st.stageId}`)
    assert.ok(Number.isFinite(st.yaw) && Number.isFinite(st.scale) && st.scale > 0)
  }

  const regionIds = new Set(data.regions.map(r => r.region))
  for (const regId of Object.keys(WORLD_REGIONS) as WorldRegionId[]) {
    assert.ok(regionIds.has(regId), `Missing region label anchor for ${regId}`)
  }

  const propKinds = new Set(data.props.map(p => p.kind))
  for (const requiredKind of [
    'river_segment',
    'lava_segment',
    'bridge_stone',
    'mountain_snow',
    'mountain_volcano',
    'tree_oak',
    'tree_pine',
    'cloud_puff'
  ] as const) {
    assert.ok(propKinds.has(requiredKind), `Missing diorama prop kind "${requiredKind}"`)
  }
  for (const p of data.props) {
    assert.ok(p.position.every(Number.isFinite), `Non-finite prop position for ${p.kind}`)
    assert.ok(p.scale.every(v => Number.isFinite(v) && v > 0), `Invalid prop scale for ${p.kind}`)
    assert.ok(Number.isFinite(p.yaw), `Non-finite prop yaw for ${p.kind}`)
  }

  // Must include sculpted castle/citadel/windmill/pyramid/throne silhouettes
  const arches = new Set(data.stages.map(s => s.arch))
  for (const requiredArch of ['castle', 'watchtower', 'windmill', 'bridge', 'pyramid', 'throne', 'floating_bastion'] as const) {
    assert.ok(arches.has(requiredArch), `Expected landmark arch "${requiredArch}"`)
  }
})

test('buildDioramaRoadSegments connects every stage dependency edge cleanly', () => {
  const segments = buildDioramaRoadSegments()
  const expectedEdges = new Set<string>()
  for (const ch of CHAPTERS) {
    for (const req of ch.requires) {
      if (CHAPTER_BY_ID[req]) expectedEdges.add(`${req}->${ch.id}`)
    }
  }

  assert.equal(segments.length, expectedEdges.size, 'Road segments must match all stage dependency edges')

  const builtEdges = new Set<string>()
  for (const seg of segments) {
    builtEdges.add(`${seg.fromStageId}->${seg.toStageId}`)
    assert.ok(seg.stones.length >= 2, `Road ${seg.fromStageId}->${seg.toStageId} should have stepping stones`)
    for (const stone of seg.stones) {
      assert.ok(stone.position.every(Number.isFinite), 'Road stone position must be finite')
      assert.ok(stone.scale.every(v => Number.isFinite(v) && v > 0), 'Road stone scale must be positive finite')
      assert.ok(Number.isFinite(stone.yaw), 'Road stone yaw must be finite')
      assert.ok(stone.position[1] > DIORAMA_SEA_Y, 'Road stone must sit above ocean floor')
    }
  }
  for (const edge of expectedEdges) {
    assert.ok(builtEdges.has(edge), `Missing diorama road edge ${edge}`)
  }
})

// =========================================================================
// 3. CAMERA CONTROLS, CONVERGENCE & SMOOTH FLY-IN LIFECYCLE
// =========================================================================

test('WorldMap3DCamera supports pan, zoom clamping, orbit, focus convergence, reset, and smooth fly-in', () => {
  const cam = createWorldMap3DCamera()
  const initVec = computeDioramaCameraVectors(cam)
  assert.ok(initVec.eye.every(Number.isFinite) && initVec.target.every(Number.isFinite))
  assert.equal(initVec.fov, DIORAMA_FOV_DEFAULT)

  // Zoom clamping
  zoomDioramaCamera(cam, 100)
  assert.equal(cam.goalZoom, DIORAMA_ZOOM_MAX)
  zoomDioramaCamera(cam, 0.01)
  assert.equal(cam.goalZoom, DIORAMA_ZOOM_MIN)

  // Subtle yaw orbit clamping
  rotateDioramaCamera(cam, 10)
  assert.equal(cam.goalYaw, DIORAMA_YAW_MAX)
  rotateDioramaCamera(cam, -10)
  assert.equal(cam.goalYaw, DIORAMA_YAW_MIN)

  // Panning moves target within bounded tabletop limits
  resetDioramaCamera(cam, true)
  const beforeTx = cam.tx
  panDioramaCamera(cam, -120, -60, 1280, 720)
  assert.ok(cam.tx > beforeTx, 'Dragging left should pan camera target east (+X)')
  panDioramaCamera(cam, -50000, -50000, 1280, 720)
  assert.ok(Math.abs(cam.tx) <= DIORAMA_W * 0.45 && Math.abs(cam.tz) <= DIORAMA_D * 0.45)

  // Focus-on-stage smooth convergence
  resetDioramaCamera(cam, true)
  const targetStage = CHAPTER_BY_ID.glacial_citadel
  const [goalX, , goalZ] = worldMapNormToDiorama(targetStage.mapX, targetStage.mapY)
  focusDioramaOnStage(cam, targetStage.mapX, targetStage.mapY, 1.45)
  assert.ok(Math.abs(cam.goalTx - goalX) < 1e-6)
  assert.ok(Math.abs(cam.goalTz - goalZ) < 1e-6)
  for (let i = 0; i < 60; i++) stepDioramaCamera(cam, 1 / 60)
  assert.ok(Math.abs(cam.tx - goalX) < 0.05 && Math.abs(cam.tz - goalZ) < 0.05)
  assert.ok(Math.abs(cam.zoom - 1.45) < 0.02)

  // Reset returns smoothly to overview
  resetDioramaCamera(cam, true)
  assert.equal(cam.tx, 0)
  assert.equal(cam.yaw, 0)

  // Smooth camera fly-in swoop lifecycle
  const deployStage = CHAPTER_BY_ID.eclipse_throne
  startDioramaFlyIn(cam, deployStage.id, deployStage.mapX, deployStage.mapY, DIORAMA_FLY_IN_DURATION)
  assert.ok(cam.flyIn && cam.flyIn.active)
  assert.equal(cam.flyIn.stageId, deployStage.id)
  assert.equal(getDioramaFlyInProgress(cam), 0)

  const midFinished = stepDioramaCamera(cam, DIORAMA_FLY_IN_DURATION * 0.5)
  assert.equal(midFinished, false)
  assert.ok(getDioramaFlyInProgress(cam) > 0.45 && getDioramaFlyInProgress(cam) < 0.55)
  const midVec = computeDioramaCameraVectors(cam)
  assert.ok(midVec.fov < DIORAMA_FOV_DEFAULT && midVec.fov > DIORAMA_FOV_FLY_IN)
  assert.ok(midVec.eye[1] < initVec.eye[1], 'Camera should swoop downward toward the sculpted landmark')

  const done = stepDioramaCamera(cam, DIORAMA_FLY_IN_DURATION * 0.6)
  assert.equal(done, true)
  assert.equal(cam.flyIn.active, false)
  assert.equal(getDioramaFlyInProgress(cam), 0)

  // Immediate completion helper (used when user double-taps or in testing mode)
  startDioramaFlyIn(cam, deployStage.id, deployStage.mapX, deployStage.mapY)
  assert.equal(cam.flyIn?.active, true)
  completeDioramaFlyIn(cam)
  assert.equal(cam.flyIn?.active, false)

  // Portrait/tablet fly-in preserves the live viewport aspect starting eye position with zero frame-1 jump
  resetDioramaCamera(cam, true)
  const portraitAspect = 390 / 844
  const portraitBase = computeDioramaCameraVectors(cam, portraitAspect)
  startDioramaFlyIn(cam, deployStage.id, deployStage.mapX, deployStage.mapY, DIORAMA_FLY_IN_DURATION, portraitAspect)
  const flyStart = computeDioramaCameraVectors(cam, portraitAspect)
  assert.ok(
    Math.abs(flyStart.eye[0] - portraitBase.eye[0]) < 1e-5
      && Math.abs(flyStart.eye[1] - portraitBase.eye[1]) < 1e-5
      && Math.abs(flyStart.eye[2] - portraitBase.eye[2]) < 1e-5,
    'Portrait fly-in must start from the exact portrait overview eye position without snapping'
  )
  completeDioramaFlyIn(cam)
})

// =========================================================================
// 4. VIEWPORT PROJECTION OF ALL 33 STAGE PINS ACROSS DESKTOP / TABLET / MOBILE
// =========================================================================

test('projectWorldMapPoint & worldToScreen keep all 33 stage pins inside the viewport on default overview (1280x720, 768x720, 390x844)', () => {
  const cam = createWorldMap3DCamera()
  const viewports: readonly (readonly [number, number])[] = [
    [1280, 720],
    [768, 720],
    [390, 844]
  ]

  for (const [w, h] of viewports) {
    const mat = computeWorldMapProjectionMatrix(cam, w, h)
    for (const ch of CHAPTERS) {
      const pt = projectWorldMapPoint(ch.mapX, ch.mapY, cam, w, h)
      assert.ok(pt !== null, `Stage ${ch.id} failed to project on ${w}x${h}`)
      assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y), `Stage ${ch.id} non-finite screen coords on ${w}x${h}`)
      assert.ok(
        pt.x >= 0 && pt.x <= w && pt.y >= 0 && pt.y <= h,
        `Stage ${ch.id} projected outside ${w}x${h} viewport: (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`
      )

      // Direct worldToScreen agreement check
      const [wx, wy, wz] = worldMapNormToDiorama(ch.mapX, ch.mapY)
      const direct = worldToScreen(mat, wx, Math.max(0.22, wy) + 0.52, wz, w, h, 0.12)
      assert.ok(direct !== null)
      assert.ok(Math.abs(direct.x - pt.x) < 1e-6 && Math.abs(direct.y - pt.y) < 1e-6)
    }
  }
})

// =========================================================================
// 5. GODOT COMPILER COMPATIBILITY, PACKAGE REGISTRATION & BACKWARDS COMPAT
// =========================================================================

test('world-map-3d.ts is browser-global-free, registered in godotEntries, compiles cleanly via compileTsToGd, and drawWorldMapCanvas stays exported', () => {
  assert.equal(typeof drawWorldMapCanvas, 'function', 'drawWorldMapCanvas must remain exported from ui-art.ts')

  const modPath = resolve('examples/crownshard/crownshard/world-map-3d.ts')
  const source = readFileSync(modPath, 'utf8')

  for (const forbidden of ['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'HTMLElement', 'performance']) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`).test(source),
      false,
      `world-map-3d.ts must not reference browser global "${forbidden}"`
    )
  }

  const pkg = JSON.parse(readFileSync(resolve('examples/crownshard/package.json'), 'utf8')) as {
    ridgetop?: { godotEntries?: string[] }
  }
  assert.ok(
    pkg.ridgetop?.godotEntries?.includes('crownshard/world-map-3d.ts'),
    'examples/crownshard/package.json ridgetop.godotEntries must include "crownshard/world-map-3d.ts"'
  )

  const gd = compileTsToGd(source, 'world-map-3d.ts')
  assert.ok(gd.length > 400, 'compileTsToGd must emit non-trivial GDScript for world-map-3d.ts')
  assert.ok(gd.includes('func worldMapNormToDiorama'), 'GDScript output must contain worldMapNormToDiorama')
  assert.ok(gd.includes('func dioramaElevationAt'), 'GDScript output must contain dioramaElevationAt')
  assert.ok(gd.includes('func createWorldMap3DCamera'), 'GDScript output must contain createWorldMap3DCamera')
  assert.ok(gd.includes('func stepDioramaCamera'), 'GDScript output must contain stepDioramaCamera')
  assert.ok(gd.includes('func buildDioramaLandmarks'), 'GDScript output must contain buildDioramaLandmarks')
  assert.ok(gd.includes('func buildDioramaRoadSegments'), 'GDScript output must contain buildDioramaRoadSegments')
})
