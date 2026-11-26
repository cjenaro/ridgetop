import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bakeZoneColors, bevelBox, box, capsuleMesh, chamferedPrism, cylinder, instances, intersectRayPlane, invertMatrix,
  mergeMeshes, mesh, multiply, octahedron, orthographic, perspective, quaternionFromEuler, scallopedCone,
  screenToRay, sculptLoft, smoothMesh, view, worldToScreen
} from '../packages/ridgetop/framework/index.ts'
import { frustum, visible } from '../packages/ridgetop/framework/instances.ts'

test('mesh primitives are made of flat-shaded, nondegenerate faces', () => {
  for (const primitive of [box, chamferedPrism(.19, 1.85, 1.45), cylinder(7), cylinder(5, 0), cylinder(6, 1, 0), octahedron]) {
    assert.equal(primitive.data.length, primitive.vertexCount * 6)
    assert.ok(primitive.radius > 0)
    for (let i = 0; i < primitive.data.length; i += 18) {
      const n = primitive.data.subarray(i + 3, i + 6)
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-6)
      assert.deepEqual(n, primitive.data.subarray(i + 9, i + 12))
      assert.deepEqual(n, primitive.data.subarray(i + 15, i + 18))
    }
  }
  assert.throws(() => mesh([0, 0, 0], [0, 0, 1]), /index/)
  assert.throws(() => mesh([0, 0, 0, 1, 1, 1, 2, 2, 2]), /nonzero/)
  assert.throws(() => cylinder(2), /dimensions/)
  assert.throws(() => chamferedPrism(.5), /dimensions/)
})

test('tapered chamfered prisms have outward-facing caps and sides', () => {
  const { data } = chamferedPrism(.17, .55, .73)
  for (let i = 0; i < data.length; i += 18) {
    const x = data[i] + data[i + 6] + data[i + 12]
    const y = data[i + 1] + data[i + 7] + data[i + 13]
    const z = data[i + 2] + data[i + 8] + data[i + 14]
    assert.ok(x * data[i + 3] + y * data[i + 4] + z * data[i + 5] > 0)
  }
})

test('persistent batches grow, clear, and cull against the WebGPU depth range', () => {
  const batch = instances(box, 1)
  const camera = multiply(perspective(Math.PI / 3, 1, 1, 30), view([0, 0, 0], [0, 0, -1]))
  const planes = frustum(camera)
  assert.equal(visible(batch, planes), false)
  batch.add([0, 0, -5])
  assert.equal(visible(batch, planes), true)
  batch.add([15, 0, -5], [2, 2, 2])
  assert.equal(batch.count, 2)
  assert.equal(batch.data.length, 32)
  assert.deepEqual(Array.from(batch.data.subarray(16, 19)), [15, 0, -5])
  const buffer = batch.data
  const revision = batch.revision
  batch.clear()
  assert.equal(batch.data, buffer)
  assert.ok(batch.revision > revision)
  for (const point of [[0, 0, 3], [0, 0, -32], [15, 0, -5]] as const) {
    batch.clear()
    batch.add(point)
    assert.equal(visible(batch, planes), false)
  }
})

test('invertMatrix, screenToRay, and intersectRayPlane round-trip worldToScreen for perspective and orthographic cameras', () => {
  const persp = multiply(perspective(Math.PI / 3, 16 / 9, 0.5, 100), view([6, 12, 14], [0, 0, 0]))
  const ortho = multiply(orthographic(20, 12, 0.5, 80), view([8, 12, 10], [0, 0, 0]))

  for (const cam of [persp, ortho]) {
    const inv = invertMatrix(cam)
    assert.ok(inv, 'Expected camera matrix to be invertible')
    const id = multiply(cam, inv)
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        assert.ok(Math.abs(id[c * 4 + r] - (r === c ? 1 : 0)) < 1e-4)
      }
    }

    for (const [wx, wy, wz] of [[0, 0, 0], [3.5, 0.4, -2.2], [-4.1, 0, 2.8]] as const) {
      const screen = worldToScreen(cam, wx, wy, wz, 960, 540)
      assert.ok(screen, 'Expected world point to project on screen')
      const ray = screenToRay(cam, screen.x, screen.y, 960, 540)
      assert.ok(ray, 'Expected valid ray from screen coordinates')
      const hit = intersectRayPlane(ray.origin, ray.direction, wy)
      assert.ok(hit, 'Expected ray to intersect horizontal plane')
      assert.ok(Math.abs(hit[0] - wx) < 1e-3, `Expected x=${wx}, got ${hit[0]}`)
      assert.ok(Math.abs(hit[1] - wy) < 1e-6)
      assert.ok(Math.abs(hit[2] - wz) < 1e-3, `Expected z=${wz}, got ${hit[2]}`)
    }
  }

  // Singular matrix returns null; parallel ray returns null
  assert.equal(invertMatrix(new Float32Array(16)), null)
  assert.equal(intersectRayPlane([0, 5, 0], [1, 0, 0], 0), null)
  assert.equal(intersectRayPlane([0, 5, 0], [0, 1, 0], 0), null)
})

test('bevelBox, capsuleMesh, scallopedCone, and smoothMesh produce outward-facing unit normals', () => {
  for (const m of [bevelBox(0.14), capsuleMesh(0.35, 1.0, 12, 4), scallopedCone(6, 0.22, 0.12), smoothMesh(cylinder(10), 50)]) {
    assert.equal(m.data.length, m.vertexCount * 6)
    assert.ok(m.vertexCount >= 24)
    assert.ok(m.radius > 0 && Number.isFinite(m.radius))
    for (let i = 0; i < m.data.length; i += 6) {
      const len = Math.hypot(m.data[i + 3], m.data[i + 4], m.data[i + 5])
      assert.ok(Math.abs(len - 1) < 1e-4, `Expected unit normal, got ${len}`)
    }
  }

  // Verify bevelBox has outward winding on every face, bevel strip, and corner
  const bb = bevelBox(0.15)
  for (let i = 0; i < bb.data.length; i += 18) {
    const cx = (bb.data[i] + bb.data[i + 6] + bb.data[i + 12]) / 3
    const cy = (bb.data[i + 1] + bb.data[i + 7] + bb.data[i + 13]) / 3
    const cz = (bb.data[i + 2] + bb.data[i + 8] + bb.data[i + 14]) / 3
    const nx = bb.data[i + 3], ny = bb.data[i + 4], nz = bb.data[i + 5]
    assert.ok(cx * nx + cy * ny + cz * nz > 0, 'bevelBox normal must face outward')
  }

  // Verify smoothMesh actually blends normals across smooth curved sides
  const rawCyl = cylinder(12)
  const smoothCyl = smoothMesh(rawCyl, 60)
  let differed = 0
  for (let i = 0; i < rawCyl.data.length; i += 6) {
    const dx = Math.abs(rawCyl.data[i + 3] - smoothCyl.data[i + 3])
    const dz = Math.abs(rawCyl.data[i + 5] - smoothCyl.data[i + 5])
    if (dx + dz > 1e-3) differed++
  }
  assert.ok(differed > 0, 'Expected smoothMesh to blend normals on cylinder sides')
})

test('crescentMesh builds a tapered double-sided arc centred on +Z', async () => {
  const { crescentMesh } = await import('../packages/ridgetop/framework/geometry.ts')
  const arc = crescentMesh(Math.PI, 0.6, 1, 8)
  const p = arc.data // interleaved XYZ + flat normal
  let maxZ = -Infinity, maxY = 0
  assert.ok(arc.vertexCount > 0)
  for (let i = 0; i < p.length; i += 6) {
    maxZ = Math.max(maxZ, p[i + 2])
    maxY = Math.max(maxY, Math.abs(p[i + 1]))
    const r = Math.hypot(p[i], p[i + 2])
    assert.ok(r >= 0.6 - 1e-6 && r <= 1 + 1e-6)
  }
  assert.ok(Math.abs(maxZ - 1) < 1e-6, 'outer edge reaches radius 1 at the arc centre')
  assert.equal(maxY, 0, 'flat in the XZ plane')
  assert.throws(() => crescentMesh(0))
  assert.throws(() => crescentMesh(Math.PI, 1, 0.5))
})

test('mergeMeshes combines transformed meshes, bakes colors, and preserves outward winding under mirrored scale', () => {
  assert.throws(() => mergeMeshes([]), RangeError)

  const untinted = mergeMeshes([
    { mesh: box, position: [-1, 0, 0] },
    { mesh: box, position: [1, 0, 0], rotation: quaternionFromEuler(0, Math.PI / 4, 0) }
  ])
  assert.equal(untinted.vertexCount, box.vertexCount * 2)
  assert.equal(untinted.colors, undefined)
  assert.ok(untinted.radius > 1.5)

  const loft = bakeZoneColors(
    sculptLoft([{ y: -0.5, rx: 0.4, rz: 0.4 }, { y: 0.5, rx: 0.3, rz: 0.3 }], { sides: 6 }),
    () => [0.5, 0.5, 0.5, 1]
  )
  const merged = mergeMeshes([
    { mesh: loft, position: [0, 1, 0], color: [1, 0.5, 0.25, 1] },
    { mesh: box, position: [0, 0, 0], scale: [-1, 1, 1], rotation: [0, Math.PI / 2, 0], color: [0.2, 0.4, 0.8, 1] }
  ])
  assert.equal(merged.vertexCount, loft.vertexCount + box.vertexCount)
  assert.ok(merged.colors && merged.colors.length === merged.vertexCount * 3)
  assert.ok(Math.abs(merged.colors[0] - 0.5) < 1e-5)
  assert.ok(Math.abs(merged.colors[1] - 0.25) < 1e-5)

  // Verify the mirrored box still has outward CCW triangle winding (geometric normal matches vertex normal)
  const start = loft.vertexCount
  for (let i = start; i < merged.vertexCount; i += 3) {
    const o0 = i * 6, o1 = (i + 1) * 6, o2 = (i + 2) * 6
    const e1x = merged.data[o1] - merged.data[o0], e1y = merged.data[o1 + 1] - merged.data[o0 + 1], e1z = merged.data[o1 + 2] - merged.data[o0 + 2]
    const e2x = merged.data[o2] - merged.data[o0], e2y = merged.data[o2 + 1] - merged.data[o0 + 1], e2z = merged.data[o2 + 2] - merged.data[o0 + 2]
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x
    assert.ok(cx * merged.data[o0 + 3] + cy * merged.data[o0 + 4] + cz * merged.data[o0 + 5] > 0)
  }
})
