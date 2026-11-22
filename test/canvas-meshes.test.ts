import assert from 'node:assert/strict'
import test from 'node:test'
import { instances, mesh } from '../framework/index.ts'
import { canvasMeshes } from '../framework/mesh-canvas.ts'

test('Canvas preserves crossing triangles and rejects triangles outside each clip plane', () => {
  const camera = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const path: number[][] = []
  const context = {
    fillRect() {}, beginPath() { path.length = 0 }, closePath() {}, fill() {},
    moveTo(x: number, y: number) { path.push([x, y]) },
    lineTo(x: number, y: number) { path.push([x, y]) }
  }
  const canvas = { width: 100, height: 100, getContext: () => context } as unknown as HTMLCanvasElement
  const renderer = canvasMeshes(canvas, new Float32Array([0, 0, 1, .5]))
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }
  function draw(points: number[][]) {
    const batch = instances(mesh(points.flat()))
    batch.add()
    renderer.draw(camera, [0, 0, 0, 1], [batch], stats)
    return stats.drawCalls
  }
  const triangle = [[-.5, -.5, .5], [.5, -.5, .5], [0, .5, .5]]
  for (const [axis, shift, vertex] of [[0, -3, 0], [0, 3, 1], [1, -3, 0], [1, 3, 2], [2, -3, 0], [2, 3, 2]]) {
    const outside = triangle.map(point => point.map((v, i) => i === axis ? v + shift : v))
    assert.equal(draw(outside), 0)
    assert.equal(draw(triangle.map((point, i) => i === vertex ? outside[i] : point)), 1)
    assert.equal(path.length, 4)
    assert.ok(path.flat().every(value => value >= 0 && value <= 100))
  }
  assert.equal(draw(triangle), 1)
  assert.equal(draw(triangle.toReversed()), 0)
  renderer.dispose()
})

test('depth-tested Canvas keeps the closest pixel where two sprite parts cross', () => {
  const width = 16, height = 16
  let frame: Uint8ClampedArray
  const canvas = { width, height, getContext: () => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: image => { frame = image.data }
  }) } as unknown as HTMLCanvasElement
  const renderer = canvasMeshes(canvas, new Float32Array([0, 0, 1, 1]), { transparent: true, depthTest: true })
  const camera = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const nearLeft = instances(mesh([-1, -1, .1, 1, -1, .9, 0, 1, .5]))
  const nearRight = instances(mesh([-1, -1, .9, 1, -1, .1, 0, 1, .5]))
  nearLeft.add([0, 0, 0], [1, 1, 1], 0, [1, 0, 0])
  nearRight.add([0, 0, 0], [1, 1, 1], 0, [0, 1, 0])
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }
  const rgba = (x: number, y: number) => Array.from(frame.slice((y * width + x) * 4, (y * width + x + 1) * 4))
  for (const layers of [[nearLeft, nearRight], [nearRight, nearLeft]]) {
    renderer.draw(camera, [0, 0, 0, 1], layers, stats)
    assert.deepEqual(rgba(4, 12), [255, 0, 0, 255])
    assert.deepEqual(rgba(11, 12), [0, 255, 0, 255])
    assert.deepEqual(rgba(0, 0), [0, 0, 0, 0])
  }
  renderer.draw(camera, [0, 0, 0, 1], [], stats)
  assert.deepEqual(rgba(4, 12), [0, 0, 0, 0])
  renderer.dispose()
})
