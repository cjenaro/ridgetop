import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  aabbContainsPoint,
  aabbFromCenter,
  aabbIntersects,
  capsuleIntersectsAabb,
  capsuleIntersectsSphere,
  createSpatialHash,
  raycastAabb,
  raycastSphere,
  raycastTriangle,
  resolveCircleGrid,
  resolveSphereAabb,
  slideSphere,
  sphereIntersectsAabb,
  sphereIntersectsSphere
} from '../framework/index.ts'
import type { Aabb, Vec3 } from '../framework/index.ts'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('../', import.meta.url))

function assertVec3Close(actual: Vec3, expected: Vec3, tol = 1e-5, label = 'vec3') {
  for (let i = 0; i < 3; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= tol,
      `${label}[${i}]: expected ${expected[i]}, got ${actual[i]}`
    )
  }
}

async function findGodot(): Promise<string | null> {
  const candidates = [
    process.env.RIDGETOP_GODOT,
    '/home/jenaro/Applications/Godot_v4.7.2-stable_linux.x86_64',
    'godot',
    'godot4'
  ].filter(Boolean) as string[]
  for (const bin of candidates) {
    try {
      if (bin.startsWith('/')) await access(bin)
      await execFileAsync(bin, ['--version'], { timeout: 5000 })
      return bin
    } catch {}
  }
  return null
}

test('shapes and bounds: AABB, sphere, and capsule intersections', () => {
  const box = aabbFromCenter([1, 2, 3], [2, 1, 0.5])
  assert.deepEqual(box, { min: [-1, 1, 2.5], max: [3, 3, 3.5] })
  assert.throws(() => aabbFromCenter([0, 0, 0], [-1, 1, 1]), RangeError)
  assert.throws(() => aabbFromCenter([NaN, 0, 0], [1, 1, 1]), RangeError)

  // Point containment (interior, boundary, exterior, invalid)
  assert.equal(aabbContainsPoint(box, [1, 2, 3]), true)
  assert.equal(aabbContainsPoint(box, [-1, 1, 2.5]), true)
  assert.equal(aabbContainsPoint(box, [3, 3, 3.5]), true)
  assert.equal(aabbContainsPoint(box, [3.001, 2, 3]), false)
  assert.equal(aabbContainsPoint(box, [NaN, 2, 3]), false)

  // AABB vs AABB
  assert.equal(aabbIntersects(box, { min: [3, 3, 3.5], max: [4, 4, 4] }), true) // touching corner
  assert.equal(aabbIntersects(box, { min: [3.01, 1, 2.5], max: [4, 3, 3.5] }), false)
  assert.equal(aabbIntersects({ min: [-5, -5, -5], max: [-2, -2, -2] }, { min: [-3, -3, -3], max: [-1, -1, -1] }), true)
  assert.equal(aabbIntersects({ min: [2, 0, 0], max: [1, 1, 1] }, box), false) // inverted AABB

  // Sphere vs AABB
  assert.equal(sphereIntersectsAabb({ center: [3.5, 2, 3], radius: 0.5 }, box), true) // tangent
  assert.equal(sphereIntersectsAabb({ center: [3.51, 2, 3], radius: 0.5 }, box), false)
  assert.equal(sphereIntersectsAabb({ center: [1, 2, 3], radius: 0.1 }, box), true) // inside
  assert.equal(sphereIntersectsAabb({ center: [1, 2, 3], radius: -1 }, box), false)

  // Sphere vs Sphere
  assert.equal(sphereIntersectsSphere({ center: [0, 0, 0], radius: 1 }, { center: [2, 0, 0], radius: 1 }), true)
  assert.equal(sphereIntersectsSphere({ center: [0, 0, 0], radius: 1 }, { center: [2.01, 0, 0], radius: 1 }), false)
  assert.equal(sphereIntersectsSphere({ center: [-3, -4, 0], radius: 2.5 }, { center: [0, 0, 0], radius: 2.5 }), true)

  // Capsule vs Sphere
  const cap = { a: [0, 0, 0] as Vec3, b: [0, 4, 0] as Vec3, radius: 0.5 }
  assert.equal(capsuleIntersectsSphere(cap, { center: [1, 2, 0], radius: 0.5 }), true)
  assert.equal(capsuleIntersectsSphere(cap, { center: [1.01, 2, 0], radius: 0.5 }), false)
  assert.equal(capsuleIntersectsSphere(cap, { center: [0, 5, 0], radius: 0.5 }), true) // end cap
  assert.equal(capsuleIntersectsSphere(cap, { center: [0, 5.01, 0], radius: 0.5 }), false)
  // Degenerate zero-length capsule acts like a sphere
  assert.equal(capsuleIntersectsSphere({ a: [1, 1, 1], b: [1, 1, 1], radius: 1 }, { center: [3, 1, 1], radius: 1 }), true)

  // Capsule vs AABB (diagonal grazing edge case where midpoint heuristics fail!)
  const unitBox: Aabb = { min: [0, 0, 0], max: [1, 1, 1] }
  // Segment from (-1, 0.5, 0.5) to (0.5, 2, 0.5): closest point is (-0.25, 1.25, 0.5) -> dist to (0,1,0.5) = sqrt(0.125) ~= 0.35355
  assert.equal(capsuleIntersectsAabb({ a: [-1, 0.5, 0.5], b: [0.5, 2, 0.5], radius: 0.36 }, unitBox), true)
  assert.equal(capsuleIntersectsAabb({ a: [-1, 0.5, 0.5], b: [0.5, 2, 0.5], radius: 0.35 }, unitBox), false)
  // Segment passing straight through box interior with tiny radius
  assert.equal(capsuleIntersectsAabb({ a: [-2, 0.5, 0.5], b: [3, 0.5, 0.5], radius: 0.01 }, unitBox), true)
  // Segment parallel to box face just outside
  assert.equal(capsuleIntersectsAabb({ a: [-1, 1.25, -1], b: [2, 1.25, 2], radius: 0.25 }, unitBox), true)
  assert.equal(capsuleIntersectsAabb({ a: [-1, 1.26, -1], b: [2, 1.26, 2], radius: 0.25 }, unitBox), false)
})

test('resolveSphereAabb returns exact MTV for faces, edges, corners, and inside-box centers', () => {
  const box: Aabb = { min: [0, 0, 0], max: [2, 2, 2] }

  // Miss
  const miss = resolveSphereAabb({ center: [3, 1, 1], radius: 0.5 }, box)
  assert.equal(miss.hit, false)
  assert.equal(miss.depth, 0)

  // Face penetration (+Y)
  const topHit = resolveSphereAabb({ center: [1, 2.3, 1], radius: 0.5 }, box)
  assert.equal(topHit.hit, true)
  assertVec3Close(topHit.normal, [0, 1, 0])
  assert.ok(Math.abs(topHit.depth - 0.2) < 1e-6)
  assertVec3Close(topHit.push, [0, 0.2, 0])

  // Edge penetration (+X, +Y)
  const edgeHit = resolveSphereAabb({ center: [2.3, 2.4, 1], radius: 1.0 }, box)
  assert.equal(edgeHit.hit, true)
  assertVec3Close(edgeHit.normal, [0.6, 0.8, 0])
  assert.ok(Math.abs(edgeHit.depth - 0.5) < 1e-6)
  assertVec3Close(edgeHit.push, [0.3, 0.4, 0])

  // Center strictly inside box near -X face
  const insideHit = resolveSphereAabb({ center: [0.2, 1, 1], radius: 0.5 }, box)
  assert.equal(insideHit.hit, true)
  assertVec3Close(insideHit.normal, [-1, 0, 0])
  assert.ok(Math.abs(insideHit.depth - 0.7) < 1e-6)
  assertVec3Close(insideHit.push, [-0.7, 0, 0])
})

test('slideSphere slides smoothly across tiled seams, walls, and corners without bouncing or snagging', () => {
  // Two adjacent floor tiles meeting at x = 4
  const floor: Aabb[] = [
    { min: [0, -1, -2], max: [4, 0, 2] },
    { min: [4, -1, -2], max: [8, 0, 2] }
  ]

  // Roll across the seam at x = 4 under downward gravity; should not snag or lose horizontal speed!
  let pos: Vec3 = [3.2, 0.5, 0]
  let vel: Vec3 = [4, -2, 0]
  for (let i = 0; i < 30; i++) {
    const res = slideSphere(pos, [vel[0], -2, vel[2]], 0.5, floor, 1 / 60)
    assert.equal(res.grounded, true)
    assert.ok(Math.abs(res.velocity[0] - 4) < 1e-4, `snagged at step ${i}: vx=${res.velocity[0]}`)
    assert.ok(Math.abs(res.velocity[1]) < 1e-4, `bounced at step ${i}: vy=${res.velocity[1]}`)
    assert.ok(Math.abs(res.position[1] - 0.5) < 1e-3)
    pos = res.position
    vel = res.velocity
  }
  assert.ok(pos[0] > 5.0, `expected smooth crossing past x=4, got ${pos[0]}`)

  // Diagonal slide into an angled corner of two walls (x >= 5 wall and z >= 5 wall)
  const cornerWalls: Aabb[] = [
    { min: [5, -1, -10], max: [6, 4, 6] },
    { min: [-10, -1, 5], max: [6, 4, 6] }
  ]
  const wallSlide = slideSphere([4.4, 1, 0], [3, 0, 4], 0.5, cornerWalls, 0.1)
  assert.equal(wallSlide.hit, true)
  assert.ok(wallSlide.position[0] <= 4.5 + 1e-4)
  assert.ok(Math.abs(wallSlide.velocity[0]) < 1e-5)
  assert.ok(Math.abs(wallSlide.velocity[2] - 4) < 1e-5)

  // Driving directly into the 90-degree corner stops cleanly in both axes
  let cPos: Vec3 = [4.4, 1, 4.4]
  let cVel: Vec3 = [5, 0, 5]
  for (let i = 0; i < 10; i++) {
    const res = slideSphere(cPos, cVel, 0.5, cornerWalls, 0.05)
    cPos = res.position
    cVel = res.velocity
  }
  assert.ok(cPos[0] <= 4.5 + 1e-3 && cPos[2] <= 4.5 + 1e-3)
  assert.ok(Math.hypot(cVel[0], cVel[2]) < 1e-4)

  // High-speed sphere does not tunnel through a thin wall
  const thinWall: Aabb[] = [{ min: [2, -2, -2], max: [2.2, 2, 2] }]
  const fast = slideSphere([0, 0, 0], [20, 0, 0], 0.5, thinWall, 0.25)
  assert.equal(fast.hit, true)
  assert.ok(fast.position[0] <= 1.5 + 1e-3, `tunneled through thin wall: x=${fast.position[0]}`)
})

test('resolveCircleGrid resolves walls and negative grid coordinates smoothly', () => {
  // Solid wall along cx = -2 for all cz
  const isSolid = (cx: number, cz: number) => cx === -2 || cz === 1
  const res = resolveCircleGrid(-1.6, 0.5, 0.5, 2, isSolid, -4, 2, 0.2)
  assert.equal(res.hit, true)
  // Cell cx = -2 spans x in [-4, -2], so circle radius 0.5 must stay at x >= -1.5
  assert.ok(res.x >= -1.5 - 1e-4, `expected x >= -1.5, got ${res.x}`)
  assert.ok(Math.abs(res.vx) < 1e-5)
  assert.ok(Math.abs(res.vz - 2) < 1e-5)
  assert.throws(() => resolveCircleGrid(0, 0, 0.5, 0, isSolid), RangeError)
})

test('raycastAabb handles hits, misses, inside-box, parallel rays, grazing edges, and maxDist', () => {
  const box: Aabb = { min: [0, 0, 0], max: [2, 2, 2] }

  // Direct hit (including unnormalized direction)
  const hit = raycastAabb([-3, 1, 1], [5, 0, 0], box)
  assert.ok(hit)
  assert.equal(hit.hit, true)
  assert.ok(Math.abs(hit.distance - 3) < 1e-6)
  assertVec3Close(hit.point, [0, 1, 1])
  assertVec3Close(hit.normal, [-1, 0, 0])

  // Miss pointing away
  assert.equal(raycastAabb([-3, 1, 1], [-1, 0, 0], box), null)

  // maxDist cutoff
  assert.equal(raycastAabb([-3, 1, 1], [1, 0, 0], box, 2.99), null)
  assert.ok(raycastAabb([-3, 1, 1], [1, 0, 0], box, 3.01))

  // Inside-box ray origin
  const inside = raycastAabb([1, 1, 1], [0, 1, 0], box)
  assert.ok(inside)
  assert.equal(inside.distance, 0)
  assertVec3Close(inside.point, [1, 1, 1])
  assertVec3Close(inside.normal, [0, -1, 0])

  // Parallel ray inside Y/Z slabs vs outside slab
  assert.ok(raycastAabb([-1, 0, 2], [1, 0, 0], box)) // grazing top-back edge
  assert.equal(raycastAabb([-1, 2.001, 1], [1, 0, 0], box), null) // parallel miss

  // Invalid inputs
  assert.equal(raycastAabb([0, 0, 0], [0, 0, 0], box), null)
  assert.equal(raycastAabb([NaN, 0, 0], [1, 0, 0], box), null)
})

test('raycastSphere handles hits, misses, tangent rays, inside-sphere, and maxDist', () => {
  const sphere = { center: [0, 0, 5] as Vec3, radius: 2 }

  const hit = raycastSphere([0, 0, 0], [0, 0, 1], sphere)
  assert.ok(hit)
  assert.ok(Math.abs(hit.distance - 3) < 1e-6)
  assertVec3Close(hit.point, [0, 0, 3])
  assertVec3Close(hit.normal, [0, 0, -1])

  // Tangent ray
  const tangent = raycastSphere([2, 0, 0], [0, 0, 1], sphere)
  assert.ok(tangent)
  assert.ok(Math.abs(tangent.distance - 5) < 1e-6)
  assertVec3Close(tangent.point, [2, 0, 5])
  assertVec3Close(tangent.normal, [1, 0, 0])

  // Miss just outside tangent
  assert.equal(raycastSphere([2.001, 0, 0], [0, 0, 1], sphere), null)

  // Inside sphere
  const inside = raycastSphere([0, 0, 5], [1, 0, 0], sphere)
  assert.ok(inside)
  assert.equal(inside.distance, 0)
  assertVec3Close(inside.normal, [-1, 0, 0])

  // maxDist cutoff
  assert.equal(raycastSphere([0, 0, 0], [0, 0, 1], sphere, 2.5), null)
})

test('raycastTriangle (Moller-Trumbore) handles hits, misses, parallel rays, grazing edges, and winding', () => {
  const a: Vec3 = [0, 0, 0]
  const b: Vec3 = [2, 0, 0]
  const c: Vec3 = [0, 2, 0]
  // CCW normal = cross(b-a, c-a) = [0, 0, +1]

  // Front-face hit
  const front = raycastTriangle([0.5, 0.5, 3], [0, 0, -1], a, b, c)
  assert.ok(front)
  assert.ok(Math.abs(front.distance - 3) < 1e-6)
  assertVec3Close(front.point, [0.5, 0.5, 0])
  assertVec3Close(front.normal, [0, 0, 1])

  // Back-face hit (double-sided default flips normal toward ray)
  const backDouble = raycastTriangle([0.5, 0.5, -3], [0, 0, 1], a, b, c)
  assert.ok(backDouble)
  assert.ok(Math.abs(backDouble.distance - 3) < 1e-6)
  assertVec3Close(backDouble.normal, [0, 0, -1])

  // Winding / backface culling: CW winding from +Z or ray from -Z is culled when cullBackface=true
  assert.equal(raycastTriangle([0.5, 0.5, -3], [0, 0, 1], a, b, c, Infinity, true), null)
  assert.equal(raycastTriangle([0.5, 0.5, 3], [0, 0, -1], a, c, b, Infinity, true), null)
  assert.ok(raycastTriangle([0.5, 0.5, 3], [0, 0, -1], a, b, c, Infinity, true))

  // Grazing edge and vertex hits
  const edge = raycastTriangle([1, 0, 2], [0, 0, -1], a, b, c)
  assert.ok(edge)
  assertVec3Close(edge.point, [1, 0, 0])
  const vertex = raycastTriangle([0, 0, 2], [0, 0, -1], a, b, c)
  assert.ok(vertex)
  assertVec3Close(vertex.point, [0, 0, 0])

  // Parallel ray in plane -> miss
  assert.equal(raycastTriangle([-1, 0.5, 0], [1, 0, 0], a, b, c), null)
  // Behind ray -> miss
  assert.equal(raycastTriangle([0.5, 0.5, -3], [0, 0, -1], a, b, c), null)
  // Outside triangle -> miss
  assert.equal(raycastTriangle([1.5, 1.5, 3], [0, 0, -1], a, b, c), null)
  // Degenerate zero-area triangle -> miss
  assert.equal(raycastTriangle([0, 0, 2], [0, 0, -1], [0, 0, 0], [1, 0, 0], [2, 0, 0]), null)
})

test('createSpatialHash handles insert, update, remove, clear, negative coords, deduplication, and 3D DDA raycast', () => {
  assert.throws(() => createSpatialHash(0), RangeError)
  assert.throws(() => createSpatialHash(-2), RangeError)
  assert.throws(() => createSpatialHash(NaN), RangeError)
  assert.throws(() => createSpatialHash(Infinity), RangeError)

  interface Prop { name: string; bounds: Aabb }
  const hash = createSpatialHash<Prop>(2)

  // Large multi-cell item spanning negative and positive coordinates
  const bigBounds: Aabb = { min: [-3.5, -1.5, -2.5], max: [3.5, 1.5, 2.5] }
  const big: Prop = { name: 'big', bounds: bigBounds }
  const neg: Prop = { name: 'neg', bounds: { min: [-8, -6, -4], max: [-6.5, -4.5, -2.5] } }
  const far: Prop = { name: 'far', bounds: { min: [10, 0, 0], max: [12, 2, 2] } }

  assert.equal(hash.insert('big', big.bounds, big), true)
  assert.equal(hash.insert('neg', neg.bounds, neg), true)
  assert.equal(hash.insert('far', far.bounds, far), true)
  // Invalid bounds are ignored gracefully
  assert.equal(hash.insert('bad', { min: [NaN, 0, 0], max: [1, 1, 1] }, far), false)
  assert.equal(hash.size, 3)

  // Deduplication across many cells
  const allNearOrigin = hash.queryAabb({ min: [-4, -2, -3], max: [4, 2, 3] })
  assert.deepEqual(allNearOrigin.map(p => p.name), ['big'])

  // Negative coordinate query
  const negQuery = hash.queryAabb({ min: [-7, -5, -3], max: [-6, -4, -2] })
  assert.deepEqual(negQuery.map(p => p.name), ['neg'])

  // queryRadius & reusable output buffer
  const reusable: Prop[] = [far]
  const radHits = hash.queryRadius([-5.5, -4, -2], 1.5, reusable)
  assert.equal(radHits, reusable)
  assert.deepEqual(radHits.map(p => p.name), ['neg'])

  // Update moves item out of old cells and into new cells
  const movedBounds: Aabb = { min: [20, 0, 0], max: [22, 2, 2] }
  far.bounds = movedBounds
  assert.equal(hash.update('far', movedBounds, far), true)
  assert.equal(hash.queryAabb({ min: [10, 0, 0], max: [12, 2, 2] }).length, 0)
  assert.deepEqual(hash.queryAabb({ min: [20, 0, 0], max: [22, 2, 2] }).map(p => p.name), ['far'])

  // 3D DDA raycast finds nearest hit even when a multi-cell object is encountered earlier
  const blocker: Prop = { name: 'blocker', bounds: { min: [15, 0, 0], max: [16, 2, 2] } }
  const spanning: Prop = { name: 'spanning', bounds: { min: [13, 0, 0], max: [19, 2, 2] } }
  // Make 'spanning' only cover z in [0, 2] with a custom hit distance farther than 'blocker'
  hash.insert('blocker', blocker.bounds, blocker)
  hash.insert('spanning', spanning.bounds, spanning)

  let testedIds: (string | number)[] = []
  const hit = hash.raycast([12, 1, 1], [1, 0, 0], 50, (item, id, bounds, bestDist) => {
    testedIds.push(id)
    if (id === 'spanning') {
      // Simulate narrow mesh inside spanning AABB located at x=18 (further than blocker at x=15)
      return raycastAabb([12, 1, 1], [1, 0, 0], { min: [18, 0, 0], max: [19, 2, 2] }, bestDist)
    }
    return raycastAabb([12, 1, 1], [1, 0, 0], bounds, bestDist)
  })
  assert.ok(hit)
  assert.equal(hit.id, 'blocker')
  assert.equal(hit.item.name, 'blocker')
  assert.ok(Math.abs(hit.distance - 3) < 1e-6)
  // 'far' at x=20 should NOT even have been tested thanks to DDA early exit, and 'spanning' only tested once!
  assert.equal(testedIds.filter(id => id === 'spanning').length, 1)
  assert.equal(testedIds.includes('far'), false)

  // Raycast with negative direction and Infinity maxDist terminates and hits negative-coord object
  const negHit = hash.raycast([0, -5, -3], [-1, 0, 0], Infinity, (_item, _id, bounds, bestDist) =>
    raycastAabb([0, -5, -3], [-1, 0, 0], bounds, bestDist)
  )
  assert.ok(negHit)
  assert.equal(negHit.id, 'neg')
  assert.ok(Math.abs(negHit.distance - 6.5) < 1e-6)

  // Remove and clear
  assert.equal(hash.remove('blocker'), true)
  assert.equal(hash.remove('blocker'), false)
  assert.equal(hash.has('blocker'), false)
  hash.clear()
  assert.equal(hash.size, 0)
  assert.equal(hash.queryAabb({ min: [-100, -100, -100], max: [100, 100, 100] }).length, 0)
  assert.equal(hash.raycast([0, 0, 0], [1, 0, 0], 100), null)
})

test('framework/physics3d.ts compiles cleanly to Godot 4 GDScript and matches Node results', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'ridgetop-gd-physics3d-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))

  await execFileAsync(
    process.execPath,
    [join(repoRoot, 'tools', 'ts-to-gd.ts'), join(outDir, 'scripts', 'compiled'), 'framework/physics3d.ts'],
    { cwd: repoRoot, timeout: 20_000 }
  )

  const gdSource = await readFile(join(outDir, 'scripts', 'compiled', 'framework', 'physics3d.gd'), 'utf8')
  assert.ok(gdSource.includes('func resolveSphereAabb('))
  assert.ok(gdSource.includes('func slideSphere('))
  assert.ok(gdSource.includes('func raycastTriangle('))
  assert.ok(gdSource.includes('func createSpatialHash('))

  const godot = await findGodot()
  if (!godot) return

  // Verify runtime execution parity in headless Godot 4
  const expectedBox = aabbFromCenter([0, 0, 0], [1, 1, 1])
  const expectedMtv = resolveSphereAabb({ center: [1.3, 0, 0], radius: 0.5 }, expectedBox)
  const expectedSlide = slideSphere([0, 0.5, 0], [4, -2, 0], 0.5, [{ min: [-2, -1, -2], max: [6, 0, 2] }], 1 / 60)
  const expectedRay = raycastTriangle([0.5, 0.5, 3], [0, 0, -1], [0, 0, 0], [2, 0, 0], [0, 2, 0])

  await writeFile(join(outDir, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="Physics3DParity"\n')
  await writeFile(join(outDir, 'verify.gd'), `extends SceneTree
const RT = preload("res://scripts/compiled/rt.gd")
func _init() -> void:
\tvar p3d = RT.mod("res://scripts/compiled/framework/physics3d.gd")
\tvar box = p3d.aabbFromCenter([0.0, 0.0, 0.0], [1.0, 1.0, 1.0])
\tvar mtv = p3d.resolveSphereAabb({ "center": [1.3, 0.0, 0.0], "radius": 0.5 }, box)
\tvar slide = p3d.slideSphere([0.0, 0.5, 0.0], [4.0, -2.0, 0.0], 0.5, [{ "min": [-2.0, -1.0, -2.0], "max": [6.0, 0.0, 2.0] }], 1.0 / 60.0)
\tvar tri = p3d.raycastTriangle([0.5, 0.5, 3.0], [0.0, 0.0, -1.0], [0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [0.0, 2.0, 0.0])
\tvar sh = p3d.createSpatialHash(2.0)
\tsh["insert"].call("neg", { "min": [-5.0, -2.0, -2.0], "max": [-3.0, 2.0, 2.0] }, "hit_neg")
\tvar q = sh["queryAabb"].call({ "min": [-4.0, -1.0, -1.0], "max": [-2.0, 1.0, 1.0] })
\tvar r = sh["raycast"].call([0.0, 0.0, 0.0], [-1.0, 0.0, 0.0], 20.0)
\tprint("PARITY_JSON:" + JSON.stringify({
\t\t"mtv": mtv,
\t\t"slide": slide,
\t\t"tri": tri,
\t\t"q": q,
\t\t"r": r
\t}))
\tRT.clear_modules()
\tquit()
`)

  const { stdout, stderr } = await execFileAsync(
    godot,
    ['--headless', '--quit', '--path', outDir, '--script', 'res://verify.gd'],
    { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }
  )
  const line = stdout.split('\n').find(l => l.startsWith('PARITY_JSON:'))
  assert.ok(line, `Godot parity check failed.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)
  const gd = JSON.parse(line.slice('PARITY_JSON:'.length))
  assert.equal(gd.mtv.hit, expectedMtv.hit)
  assert.ok(Math.abs(gd.mtv.depth - expectedMtv.depth) < 1e-5)
  assert.equal(gd.slide.grounded, expectedSlide.grounded)
  assert.ok(Math.abs(gd.slide.position[0] - expectedSlide.position[0]) < 1e-5)
  assert.ok(Math.abs(gd.tri.distance - expectedRay!.distance) < 1e-5)
  assert.deepEqual(gd.q, ['hit_neg'])
  assert.equal(gd.r.item, 'hit_neg')
  assert.ok(Math.abs(gd.r.distance - 3) < 1e-5)
})
