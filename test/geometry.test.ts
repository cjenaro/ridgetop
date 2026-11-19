import test from 'node:test'
import assert from 'node:assert/strict'
import { box, chamferedPrism, cylinder, instances, mesh, multiply, octahedron, perspective, view } from '../framework/index.ts'
import { frustum, visible } from '../framework/instances.ts'

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
