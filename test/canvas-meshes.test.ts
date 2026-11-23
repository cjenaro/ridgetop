import assert from 'node:assert/strict'
import test from 'node:test'
import { box, instances, mesh } from '../framework/index.ts'
import { canvasMeshes } from '../framework/mesh-canvas.ts'
import { gpuMeshes } from '../framework/mesh-gpu.ts'

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

test('WebGPU releaseMesh destroys associated instance buffers and enforces maxBufferSize', async t => {
  const prevGpu = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const prevUsage = globalThis.GPUBufferUsage
  const prevTexUsage = globalThis.GPUTextureUsage
  const created: { size: number; destroyed: boolean }[] = []
  const fakeDevice = {
    lost: new Promise(() => {}),
    limits: { maxTextureDimension2D: 4096, maxBufferSize: 128 },
    createShaderModule: () => ({}),
    createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: ({ size }: { size: number }) => {
      const rec = { size, destroyed: false }
      created.push(rec)
      return {
        size,
        getMappedRange: () => new ArrayBuffer(size),
        unmap() {},
        destroy() { rec.destroyed = true }
      }
    },
    createBindGroup: () => ({}),
    createTexture: ({ size: [w, h] }: { size: [number, number] }) => ({ width: w, height: h, createView: () => ({}), destroy() {} }),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, draw() {}, end() {} }),
      finish: () => ({})
    }),
    queue: { writeBuffer() {}, submit() {} },
    destroy() {}
  }
  Object.defineProperty(globalThis, 'GPUBufferUsage', { value: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 }, configurable: true })
  Object.defineProperty(globalThis, 'GPUTextureUsage', { value: { RENDER_ATTACHMENT: 1 }, configurable: true })
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      gpu: {
        requestAdapter: async () => ({ requestDevice: async () => fakeDevice }),
        getPreferredCanvasFormat: () => 'bgra8unorm'
      }
    },
    configurable: true
  })
  t.after(() => {
    if (prevGpu) Object.defineProperty(globalThis, 'navigator', prevGpu)
    Object.defineProperty(globalThis, 'GPUBufferUsage', { value: prevUsage, configurable: true })
    Object.defineProperty(globalThis, 'GPUTextureUsage', { value: prevTexUsage, configurable: true })
  })

  const canvas = {
    width: 64, height: 64,
    getContext: () => ({ configure() {}, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) })
  } as unknown as HTMLCanvasElement
  const backend = await gpuMeshes(canvas, new Float32Array([0, 0, 1, .5]))
  assert.ok(backend)
  const custom = mesh([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const batch = instances(custom, 1)
  batch.add([0, 0, 0])
  const cam = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }
  backend.draw(cam, [0, 0, 0, 1], [batch], stats)
  // created: [camera uniform, instance buffer, vertex buffer]
  assert.equal(created.length, 3)
  backend.releaseMesh(custom)
  assert.equal(created[1].destroyed, true, 'instance buffer destroyed by releaseMesh')
  assert.equal(created[2].destroyed, true, 'vertex buffer destroyed by releaseMesh')

  const oversized = instances(box, 3)
  oversized.add([0, 0, 0])
  oversized.add([1, 0, 0])
  oversized.add([2, 0, 0]) // 3 * 64 = 192 > maxBufferSize (128)
  assert.throws(() => backend.draw(cam, [0, 0, 0, 1], [oversized], stats), /maxBufferSize/)
  backend.dispose()
})
