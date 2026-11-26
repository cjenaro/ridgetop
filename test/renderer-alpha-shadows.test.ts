import assert from 'node:assert/strict'
import test from 'node:test'
import * as frameworkIndex from '../packages/ridgetop/framework/index.ts'
import {
  box, cameraDepth, color, computeShadowMatrix, createLowPolyRenderer, createShadowBatch, cylinder, instances, mesh, multiply,
  octahedron, orthographic, perspective, projectShadow, projectShadowMesh, renderMeshPixels,
  shadowDisc, view
} from '../packages/ridgetop/framework/index.ts'
import { createAlphaSorter } from '../packages/ridgetop/framework/geometry.ts'
import { INSTANCE_SIZE } from '../packages/ridgetop/framework/instances.ts'
import { packLighting } from '../packages/ridgetop/framework/low-poly.ts'
import { canvasMeshes } from '../packages/ridgetop/framework/mesh-canvas.ts'
import { glMeshes } from '../packages/ridgetop/framework/mesh-gl.ts'
import { gpuMeshes } from '../packages/ridgetop/framework/mesh-gpu.ts'
import type { Matrix } from '../packages/ridgetop/framework/types.ts'

function createMockWebGPU() {
  const pipelines: { entryPoint: string; depthStencil: Record<string, unknown> }[] = []
  const draws: { buffer: object; vertexCount: number; instanceCount: number; pipeline: string }[] = []
  const shadowPasses: { draws: { buffer: object; vertexCount: number; instanceCount: number; pipeline: string }[] }[] = []
  const writes: { buffer: object; dstOffset: number; data: Float32Array }[] = []
  const textures: { width: number; height: number; format: string; usage: number; destroyed: boolean }[] = []
  const samplers: Record<string, unknown>[] = []
  const shaders: string[] = []
  const fakeDevice = {
    lost: new Promise(() => {}),
    limits: { maxTextureDimension2D: 4096, maxBufferSize: 1024 * 1024 },
    createShaderModule: ({ code }: { code: string }) => { shaders.push(code); return {} },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createSampler: (desc: Record<string, unknown>) => { samplers.push(desc); return { id: Symbol('sampler') } },
    createRenderPipelineAsync: async (desc: {
      vertex?: { entryPoint: string }
      fragment?: { entryPoint: string }
      depthStencil: Record<string, unknown>
    }) => {
      const entryPoint = desc.fragment?.entryPoint ?? desc.vertex?.entryPoint ?? 'unknown'
      pipelines.push({ entryPoint, depthStencil: desc.depthStencil })
      return { name: entryPoint, getBindGroupLayout: () => ({}) }
    },
    createBuffer: ({ size }: { size: number }) => ({
      id: Symbol('gpuBuf'),
      size,
      getMappedRange: () => new ArrayBuffer(size),
      unmap() {},
      destroy() {}
    }),
    createBindGroup: () => ({}),
    createTexture: ({ size: [w, h], format = 'depth24plus', usage = 0 }: { size: [number, number]; format?: string; usage?: number }) => {
      const rec = { width: w, height: h, format, usage, destroyed: false }
      textures.push(rec)
      return { width: w, height: h, createView: () => ({}), destroy() { rec.destroyed = true } }
    },
    createCommandEncoder: () => ({
      beginRenderPass: (desc?: { colorAttachments?: unknown[] }) => {
        const isShadowPass = (desc?.colorAttachments?.length ?? 1) === 0
        const passDraws: { buffer: object; vertexCount: number; instanceCount: number; pipeline: string }[] = []
        if (isShadowPass) shadowPasses.push({ draws: passDraws })
        let activePipeline = ''
        let activeInstanceBuffer: object | null = null
        return {
          setPipeline(pipe: { name: string }) { activePipeline = pipe.name },
          setBindGroup() {},
          setVertexBuffer(slot: number, buf: object) {
            if (slot === 1) activeInstanceBuffer = buf
          },
          draw(vertexCount: number, instanceCount: number) {
            const rec = {
              buffer: activeInstanceBuffer!,
              vertexCount,
              instanceCount,
              pipeline: activePipeline
            }
            if (isShadowPass) passDraws.push(rec)
            else draws.push(rec)
          },
          end() {}
        }
      },
      finish: () => ({})
    }),
    queue: {
      writeBuffer(buffer: object, dstOffset: number, src: Float32Array, srcOffset = 0, size?: number) {
        if (src instanceof Float32Array) {
          const end = size !== undefined ? srcOffset + size : src.length
          writes.push({ buffer, dstOffset, data: new Float32Array(src.subarray(srcOffset, end)) })
        }
      },
      submit() {}
    },
    destroy() {}
  }
  return { fakeDevice, pipelines, draws, shadowPasses, writes, textures, samplers, shaders }
}

function createMockWebGL2() {
  const draws: { vao: object; instanceCount: number; blendMode: number; polygonOffset: boolean }[] = []
  const shadowPasses: {
    viewport: [number, number, number, number]
    lightMatrix: Float32Array | null
    polygonOffset: [number, number] | null
    draws: { vao: object; instanceCount: number }[]
  }[] = []
  const uploads: { buffer: object; data: Float32Array }[] = []
  const polygonOffsetCalls: [number, number][] = []
  const shaderSources: string[] = []
  const shadowTextures: { width: number; height: number; internalFormat: number; params: Record<number, number>; destroyed: boolean }[] = []
  const mainUniforms: Record<string, Float32Array | number> = {}
  const vaoToInstanceBuffer = new Map<object, object>()
  let boundBuffer: object | null = null
  let boundVao: object | null = null
  let boundFbo: object | null = null
  let boundTex: { width: number; height: number; internalFormat: number; params: Record<number, number>; destroyed: boolean } | null = null
  let currentViewport: [number, number, number, number] = [0, 0, 0, 0]
  let currentPolygonOffset: [number, number] | null = null
  let activeShadowPass: (typeof shadowPasses)[number] | null = null
  let blendMode = 0
  let polygonOffsetEnabled = false

  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    DEPTH_TEST: 5,
    CULL_FACE: 6,
    MAX_RENDERBUFFER_SIZE: 7,
    BLEND: 8,
    COLOR_BUFFER_BIT: 9,
    DEPTH_BUFFER_BIT: 10,
    SRC_ALPHA: 11,
    ONE_MINUS_SRC_ALPHA: 12,
    ONE: 13,
    ARRAY_BUFFER: 14,
    STATIC_DRAW: 15,
    DYNAMIC_DRAW: 16,
    FLOAT: 17,
    TRIANGLES: 18,
    POLYGON_OFFSET_FILL: 19,
    TEXTURE0: 100,
    TEXTURE_2D: 101,
    DEPTH_COMPONENT24: 102,
    DEPTH_COMPONENT: 103,
    UNSIGNED_INT: 104,
    TEXTURE_MIN_FILTER: 105,
    TEXTURE_MAG_FILTER: 106,
    LINEAR: 107,
    TEXTURE_WRAP_S: 108,
    TEXTURE_WRAP_T: 109,
    CLAMP_TO_EDGE: 110,
    TEXTURE_COMPARE_MODE: 111,
    COMPARE_REF_TO_TEXTURE: 112,
    TEXTURE_COMPARE_FUNC: 113,
    LEQUAL: 114,
    FRAMEBUFFER: 115,
    DEPTH_ATTACHMENT: 116,
    NONE: 117,
    RENDERER: 118,
    createProgram: () => ({ id: Symbol('program') }),
    createShader: () => ({}),
    shaderSource(_shader: object, src: string) { shaderSources.push(src) },
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    attachShader() {},
    deleteShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    deleteProgram() {},
    useProgram() {},
    getExtension: () => null,
    createTexture: () => {
      const rec = { width: 0, height: 0, internalFormat: 0, params: {} as Record<number, number>, destroyed: false }
      shadowTextures.push(rec)
      return rec
    },
    deleteTexture(tex: { destroyed: boolean }) { tex.destroyed = true },
    activeTexture() {},
    bindTexture(_target: number, tex: (typeof shadowTextures)[number] | null) { boundTex = tex },
    texImage2D(_target: number, _level: number, internalFormat: number, width: number, height: number) {
      if (boundTex) {
        boundTex.internalFormat = internalFormat
        boundTex.width = width
        boundTex.height = height
      }
    },
    texParameteri(_target: number, pname: number, param: number) {
      if (boundTex) boundTex.params[pname] = param
    },
    createFramebuffer: () => ({ id: Symbol('fbo') }),
    deleteFramebuffer() {},
    bindFramebuffer(_target: number, fbo: object | null) {
      boundFbo = fbo
      if (!fbo) activeShadowPass = null
    },
    framebufferTexture2D() {},
    drawBuffers() {},
    readBuffer() {},
    enable(cap: number) { if (cap === 19) polygonOffsetEnabled = true },
    disable(cap: number) { if (cap === 19) { polygonOffsetEnabled = false; currentPolygonOffset = null } },
    polygonOffset(factor: number, units: number) {
      polygonOffsetCalls.push([factor, units])
      currentPolygonOffset = [factor, units]
      if (activeShadowPass) activeShadowPass.polygonOffset = [factor, units]
    },
    getUniformLocation: (_p: object, name: string) => name,
    uniform4fv(loc: string, val: Float32Array) { mainUniforms[loc] = new Float32Array(val) },
    uniformMatrix4fv(loc: string, _transpose: boolean, val: Float32Array) {
      const copy = new Float32Array(val)
      if (boundFbo && activeShadowPass) activeShadowPass.lightMatrix = copy
      else mainUniforms[loc] = copy
    },
    uniform1i(loc: string, val: number) {
      mainUniforms[loc] = val
      if (loc === 'blendMode') blendMode = val
    },
    getParameter: (pname: number) => pname === 118 ? 'Mock WebGL 2' : 4096,
    viewport(x: number, y: number, w: number, h: number) {
      currentViewport = [x, y, w, h]
      if (boundFbo) {
        activeShadowPass = { viewport: currentViewport, lightMatrix: null, polygonOffset: currentPolygonOffset, draws: [] }
        shadowPasses.push(activeShadowPass)
      }
    },
    depthMask() {},
    clearColor() {},
    clear() {},
    blendFunc() {},
    createVertexArray: () => ({ id: Symbol('vao') }),
    deleteVertexArray() {},
    bindVertexArray(vao: object | null) { boundVao = vao },
    createBuffer: () => ({ id: Symbol('glBuf') }),
    deleteBuffer() {},
    bindBuffer(_target: number, buf: object | null) { boundBuffer = buf },
    bufferData() {},
    bufferSubData(_target: number, _offset: number, src: Float32Array, srcOffset = 0, length?: number) {
      const end = length !== undefined ? srcOffset + length : src.length
      uploads.push({ buffer: boundBuffer!, data: new Float32Array(src.subarray(srcOffset, end)) })
    },
    enableVertexAttribArray() {},
    vertexAttribPointer(index: number) {
      if (index === 2 && boundVao && boundBuffer) vaoToInstanceBuffer.set(boundVao, boundBuffer)
    },
    vertexAttribDivisor() {},
    drawArraysInstanced(_mode: number, _first: number, _count: number, instanceCount: number) {
      if (boundFbo && activeShadowPass) {
        activeShadowPass.draws.push({ vao: boundVao!, instanceCount })
      } else {
        draws.push({ vao: boundVao!, instanceCount, blendMode, polygonOffset: polygonOffsetEnabled })
      }
    }
  }
  return { gl, draws, shadowPasses, uploads, polygonOffsetCalls, shaderSources, shadowTextures, mainUniforms, vaoToInstanceBuffer }
}

test('cameraDepth and AlphaSorter order batches and instances back-to-front for perspective and orthographic cameras', () => {
  const persp = multiply(perspective(Math.PI / 3, 1, 0.5, 100), view([0, 0, 10], [0, 0, 0]))
  const ortho = multiply(orthographic(20, 20, 0.5, 100), view([0, 0, 10], [0, 0, 0]))
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

  for (const [label, cam, nearZ, midZ, farZ] of [
    ['perspective', persp, 5, 0, -8],
    ['orthographic', ortho, 5, 0, -8],
    ['identity', identity, 0.1, 0.5, 0.9]
  ] as [string, Matrix, number, number, number][]) {
    assert.ok(cameraDepth(cam, 0, 0, farZ) > cameraDepth(cam, 0, 0, midZ), `${label}: far > mid`)
    assert.ok(cameraDepth(cam, 0, 0, midZ) > cameraDepth(cam, 0, 0, nearZ), `${label}: mid > near`)

    const sorter = createAlphaSorter(8)
    const bNear = instances(box, { capacity: 1, blend: 'alpha' })
    const bMid = instances(box, { capacity: 1, blend: 'alpha' })
    const bFar = instances(box, { capacity: 1, blend: 'alpha' })
    bNear.add([0, 0, nearZ])
    bMid.add([0, 0, midZ])
    bFar.add([0, 0, farZ])

    const sorted: typeof bNear[] = []
    sorter.sortBatches(cam, [bNear, bFar, bMid], sorted)
    assert.deepEqual(sorted, [bFar, bMid, bNear], `${label}: batch back-to-front order`)
  }

  // Exercise merge-sort (> 16 instances) + stability on equal depths without mutating batch.data
  const many = instances(box, { capacity: 40, blend: 'alpha' })
  const zOrder = [4, -10, 2, -10, 8, -3, 0, -10, 6, -5, 1, -7, 3, -2, 7, -1, 5, -6, 2, -8, 0, -4, 9, -9]
  for (let i = 0; i < zOrder.length; i++) {
    many.add([i, 0, zOrder[i]], [1, 1, 1], 0, [1, 1, 1, 0.5])
  }
  const snapshotBefore = new Float32Array(many.data)
  const sorter = createAlphaSorter(4)
  const { inOrder, indices } = sorter.sortInstanceIndices(persp, many.data, many.count)
  assert.equal(inOrder, false)
  const packed = sorter.packInstances(many.data, many.count)
  assert.deepEqual(many.data, snapshotBefore, 'sorting must never mutate source batch.data')

  // Verify monotonically non-increasing depths and stability for equal z = -10 (indices 1, 3, 7)
  let prevDepth = Infinity
  const tiedIds: number[] = []
  for (let k = 0; k < many.count; k++) {
    const x = packed[k * INSTANCE_SIZE]
    const z = packed[k * INSTANCE_SIZE + 2]
    const d = cameraDepth(persp, x, 0, z)
    assert.ok(d <= prevDepth + 1e-6)
    prevDepth = d
    if (z === -10) tiedIds.push(x)
    assert.equal(x, indices[k])
  }
  assert.deepEqual(tiedIds, [1, 3, 7], 'equal-depth instances must preserve submission order (stable sort)')
})

test('WebGPU backend sorts alpha batches and multi-instance alpha data back-to-front with zero static opaque upload regression', async t => {
  const prevGpu = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const prevUsage = globalThis.GPUBufferUsage
  const prevTexUsage = globalThis.GPUTextureUsage
  const prevStage = globalThis.GPUShaderStage
  const { fakeDevice, pipelines, draws, writes } = createMockWebGPU()

  Object.defineProperty(globalThis, 'GPUBufferUsage', { value: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 }, configurable: true })
  Object.defineProperty(globalThis, 'GPUTextureUsage', { value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 }, configurable: true })
  Object.defineProperty(globalThis, 'GPUShaderStage', { value: { VERTEX: 1, FRAGMENT: 2 }, configurable: true })
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
    Object.defineProperty(globalThis, 'GPUShaderStage', { value: prevStage, configurable: true })
  })

  const canvas = {
    width: 64, height: 64, clientWidth: 64, clientHeight: 64,
    getContext: () => ({ configure() {}, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) })
  } as unknown as HTMLCanvasElement
  const backend = await gpuMeshes(canvas, new Float32Array([0, 1, 0, 0.5]))
  assert.ok(backend)

  const alphaPipe = pipelines.find(p => p.entryPoint === 'fragmentAlpha')
  assert.ok(alphaPipe)
  assert.equal(alphaPipe.depthStencil.depthWriteEnabled, false)
  assert.equal(alphaPipe.depthStencil.depthBias, -1)
  assert.equal(alphaPipe.depthStencil.depthBiasSlopeScale, -1)

  const camFront = multiply(perspective(Math.PI / 3, 1, 0.5, 100), view([0, 0, 10], [0, 0, 0]))
  const camBack = multiply(perspective(Math.PI / 3, 1, 0.5, 100), view([0, 0, -10], [0, 0, 0]))

  const opaqueBatch = instances(box, { capacity: 2, blend: 'opaque' })
  opaqueBatch.add([0, 0, 0])
  const nearAlpha = instances(box, { capacity: 1, blend: 'alpha' })
  nearAlpha.add([1, 0, 4], [1, 1, 1], 0, [0, 0, 1, 0.5])
  const farAlpha = instances(box, { capacity: 1, blend: 'alpha' })
  farAlpha.add([2, 0, -4], [1, 1, 1], 0, [1, 0, 0, 0.5])
  const multiAlpha = instances(box, { capacity: 3, blend: 'alpha' })
  multiAlpha.add([10, 0, 3], [1, 1, 1], 0, [0, 0, 1, 0.5])
  multiAlpha.add([20, 0, -6], [1, 1, 1], 0, [1, 0, 0, 0.5])
  multiAlpha.add([30, 0, -1], [1, 1, 1], 0, [0, 1, 0, 0.5])

  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }
  writes.length = 0
  draws.length = 0

  // Frame 1: submitted nearAlpha before farAlpha; backend must draw farAlpha -> multiAlpha -> nearAlpha
  backend.draw(camFront, [0, 0, 0, 1], [opaqueBatch, nearAlpha, multiAlpha, farAlpha], stats)
  assert.equal(draws.length, 4)
  assert.equal(draws[0].pipeline, 'fragmentOpaque')
  assert.equal(draws[1].pipeline, 'fragmentAlpha')
  assert.equal(draws[2].pipeline, 'fragmentAlpha')
  assert.equal(draws[3].pipeline, 'fragmentAlpha')

  const bufferFirstX = new Map<object, number>()
  const bufferAllX = new Map<object, number[]>()
  for (const w of writes) {
    if (w.data.length >= INSTANCE_SIZE && w.data.length % INSTANCE_SIZE === 0) {
      const xs: number[] = []
      for (let i = 0; i < w.data.length; i += INSTANCE_SIZE) xs.push(w.data[i])
      bufferFirstX.set(w.buffer, xs[0])
      bufferAllX.set(w.buffer, xs)
    }
  }
  // Alpha draw order by X marker: farAlpha (x=2, z=-4), multiAlpha (center z=-1.5), nearAlpha (x=1, z=+4)
  assert.equal(bufferFirstX.get(draws[1].buffer), 2)
  assert.deepEqual(bufferAllX.get(draws[2].buffer), [20, 30, 10], 'multi-instance alpha sorted far(-6) -> mid(-1) -> near(+3)')
  assert.equal(bufferFirstX.get(draws[3].buffer), 1)

  // Frame 2: same camera & unchanged batches -> ZERO upload bytes!
  stats.uploadBytes = 0
  backend.draw(camFront, [0, 0, 0, 1], [opaqueBatch, nearAlpha, multiAlpha, farAlpha], stats)
  assert.equal(stats.uploadBytes, 0, 'warm static opaque + unchanged alpha batches upload 0 bytes')

  // Frame 3: slightly moved camera that preserves depth order -> STILL 0 upload bytes!
  const camFrontShifted = multiply(perspective(Math.PI / 3, 1, 0.5, 100), view([0.2, 0.1, 10.1], [0, 0, 0]))
  stats.uploadBytes = 0
  backend.draw(camFrontShifted, [0, 0, 0, 1], [opaqueBatch, nearAlpha, multiAlpha, farAlpha], stats)
  assert.equal(stats.uploadBytes, 0, 'unchanged depth order skips GPU upload even when camera moves')

  // Frame 4: static opaque ONLY with moving camera -> 0 upload bytes!
  stats.uploadBytes = 0
  backend.draw(camBack, [0, 0, 0, 1], [opaqueBatch], stats)
  assert.equal(stats.uploadBytes, 0, 'static opaque batch uploads 0 bytes after warm-up')

  // Frame 5: camera flipped to opposite side (-Z looking toward +Z) -> order reverses!
  writes.length = 0
  draws.length = 0
  stats.uploadBytes = 0
  backend.draw(camBack, [0, 0, 0, 1], [opaqueBatch, nearAlpha, multiAlpha, farAlpha], stats)
  const multiWrite = writes.find(w => w.data.length === 3 * INSTANCE_SIZE)
  assert.ok(multiWrite)
  assert.deepEqual(
    [multiWrite.data[0], multiWrite.data[INSTANCE_SIZE], multiWrite.data[2 * INSTANCE_SIZE]],
    [10, 30, 20],
    'flipped camera reverses multi-instance alpha upload order'
  )
  assert.equal(stats.uploadBytes, 3 * INSTANCE_SIZE * 4, 'only re-ordered multi-instance alpha batch uploaded')

  backend.dispose()
})

test('WebGL 2 backend sorts alpha batches/instances back-to-front, enables polygonOffset, and keeps static opaque at 0 upload bytes', () => {
  const { gl, draws, uploads, polygonOffsetCalls } = createMockWebGL2()
  const canvas = {
    width: 64, height: 64,
    getContext: () => gl,
    addEventListener() {},
    removeEventListener() {}
  } as unknown as HTMLCanvasElement
  const backend = glMeshes(canvas, new Float32Array([0, 1, 0, 0.5]))
  assert.ok(backend)

  const cam = multiply(orthographic(20, 20, 0.5, 100), view([0, 0, 10], [0, 0, 0]))
  const opaqueBatch = instances(box, { capacity: 1, blend: 'opaque' })
  opaqueBatch.add([0, 0, 0])
  const alphaNear = instances(box, { capacity: 1, blend: 'alpha' })
  alphaNear.add([1, 0, 5], [1, 1, 1], 0, [0, 0, 1, 0.5])
  const alphaFar = instances(box, { capacity: 1, blend: 'alpha' })
  alphaFar.add([2, 0, -5], [1, 1, 1], 0, [1, 0, 0, 0.5])
  const alphaMulti = instances(box, { capacity: 3, blend: 'alpha' })
  alphaMulti.add([10, 0, 2], [1, 1, 1], 0, [0, 0, 1, 0.5])
  alphaMulti.add([20, 0, -4], [1, 1, 1], 0, [1, 0, 0, 0.5])
  alphaMulti.add([30, 0, 0], [1, 1, 1], 0, [0, 1, 0, 0.5])
  const additiveBatch = instances(box, { capacity: 1, blend: 'additive' })
  additiveBatch.add([3, 0, 1], [1, 1, 1], 0, [1, 1, 0, 0.5])

  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }
  backend.draw(cam, [0, 0, 0, 1], [opaqueBatch, alphaNear, alphaMulti, alphaFar, additiveBatch], stats)

  assert.equal(draws.length, 5)
  assert.equal(draws[0].blendMode, 0)
  assert.equal(draws[0].polygonOffset, false)
  assert.equal(draws[1].blendMode, 1)
  assert.equal(draws[1].polygonOffset, true)
  assert.equal(draws[4].blendMode, 2)
  assert.equal(draws[4].polygonOffset, false)
  assert.deepEqual(polygonOffsetCalls[0], [-1, -1])

  // Check upload order: opaque (x=0), alphaFar (x=2), alphaMulti ([20, 30, 10]), alphaNear (x=1), additive (x=3)
  assert.equal(uploads[0].data[0], 0)
  assert.equal(uploads[1].data[0], 2)
  assert.deepEqual(
    [uploads[2].data[0], uploads[2].data[INSTANCE_SIZE], uploads[2].data[2 * INSTANCE_SIZE]],
    [20, 30, 10]
  )
  assert.equal(uploads[3].data[0], 1)
  assert.equal(uploads[4].data[0], 3)

  // Warm-up check: static opaque uploads 0 bytes even when camera moves
  const cam2 = multiply(orthographic(20, 20, 0.5, 100), view([1, 2, 10], [0, 0, 0]))
  stats.uploadBytes = 0
  backend.draw(cam2, [0, 0, 0, 1], [opaqueBatch, additiveBatch], stats)
  assert.equal(stats.uploadBytes, 0)

  backend.dispose()
})

test('Canvas 2D blends nearer translucent surfaces over farther ones regardless of submission order', () => {
  const quad = mesh([
    -1, -1, 0, 1, -1, 0, 1, 1, 0,
    -1, -1, 0, 1, 1, 0, -1, 1, 0
  ])
  const persp = multiply(perspective(Math.PI / 3, 1, 0.5, 50), view([0, 0, 6], [0, 0, 0]))
  const ortho = multiply(orthographic(4, 4, 0.5, 50), view([0, 0, 6], [0, 0, 0]))

  for (const [label, cam] of [['perspective', persp], ['orthographic', ortho]] as [string, Matrix][]) {
    const nearBlue = instances(quad, { capacity: 1, blend: 'alpha' })
    nearBlue.add([0, 0, 1], [2, 2, 1], 0, [0, 0, 1, 0.5], 1)
    const farRed = instances(quad, { capacity: 1, blend: 'alpha' })
    farRed.add([0, 0, -1], [2, 2, 1], 0, [1, 0, 0, 0.5], 1)

    const a = renderMeshPixels(cam, [nearBlue, farRed], 16, { ambient: 1 })
    const b = renderMeshPixels(cam, [farRed, nearBlue], 16, { ambient: 1 })
    const center = (8 * 16 + 8) * 4
    const pxA = Array.from(a.pixels.slice(center, center + 4))
    const pxB = Array.from(b.pixels.slice(center, center + 4))
    assert.deepEqual(pxA, pxB, `${label}: separate alpha batches must produce identical pixels in any order`)
    assert.ok(pxA[2] > pxA[0] + 40, `${label}: near blue (${pxA[2]}) must dominate far red (${pxA[0]})`)

    // Multi-instance single alpha batch submitted near-first
    const combined = instances(quad, { capacity: 2, blend: 'alpha' })
    combined.add([0, 0, 1], [2, 2, 1], 0, [0, 0, 1, 0.5], 1)
    combined.add([0, 0, -1], [2, 2, 1], 0, [1, 0, 0, 0.5], 1)
    const c = renderMeshPixels(cam, [combined], 16, { ambient: 1 })
    assert.deepEqual(Array.from(c.pixels.slice(center, center + 4)), pxA, `${label}: multi-instance alpha batch matches`)

    // Opaque blocker in front occludes translucent quad even if alpha batch is submitted first
    const opaqueGreen = instances(quad, { capacity: 1, blend: 'opaque' })
    opaqueGreen.add([0, 0, 2], [2, 2, 1], 0, [0, 1, 0], 1)
    const occ = renderMeshPixels(cam, [nearBlue, opaqueGreen], 16, { ambient: 1 })
    assert.deepEqual(Array.from(occ.pixels.slice(center, center + 4)), [0, 255, 0, 255], `${label}: opaque occludes behind alpha`)
  }
})

test('shadowDisc, projectShadow, and projectShadowMesh handle light angles, altitude fade, and edge cases with zero NaN', () => {
  const disc = shadowDisc(12)
  assert.equal(disc.vertexCount, 36)
  assert.ok(Math.abs(disc.radius - 1) < 1e-6)
  for (let i = 0; i < disc.data.length; i += 6) {
    assert.equal(disc.data[i + 1], 0)
    assert.equal(disc.data[i + 3], 0)
    assert.equal(disc.data[i + 4], 1)
    assert.equal(disc.data[i + 5], 0)
  }
  assert.throws(() => shadowDisc(2), /side count/)

  // Light-direction offset: sun at (-0.48, 0.8, 0.36) pushes shadow toward (+X, -Z)
  const low = projectShadow([0, 2, 0], { groundY: 0, radius: 1, direction: [-0.48, 0.8, 0.36], bias: 0.02 })
  assert.equal(low.visible, true)
  assert.ok(Math.abs(low.position[0] - 1.2) < 1e-5, `expected +1.2 X offset, got ${low.position[0]}`)
  assert.ok(Math.abs(low.position[1] - 0.02) < 1e-6, `expected groundY + bias`)
  assert.ok(Math.abs(low.position[2] - (-0.9)) < 1e-5, `expected -0.9 Z offset, got ${low.position[2]}`)
  assert.ok(low.scale[2] > low.scale[0], 'shadow stretches along light direction')

  // Altitude fade & scale shrink
  const grounded = projectShadow([0, 0, 0], { groundY: 0, radius: 1, maxHeight: 10, opacity: 0.4 })
  const mid = projectShadow([0, 5, 0], { groundY: 0, radius: 1, maxHeight: 10, opacity: 0.4 })
  const tooHigh = projectShadow([0, 12, 0], { groundY: 0, radius: 1, maxHeight: 10, opacity: 0.4 })
  const below = projectShadow([0, -1, 0], { groundY: 0, radius: 1, maxHeight: 10, opacity: 0.4 })
  assert.ok(grounded.opacity > mid.opacity && mid.opacity > 0)
  assert.ok(grounded.scale[0] > mid.scale[0])
  assert.equal(tooHigh.visible, false)
  assert.equal(tooHigh.opacity, 0)
  assert.equal(below.visible, false)
  assert.equal(below.opacity, 0)

  // Edge cases: vertical, horizontal, negative-Y, zero, and unnormalized light vectors -> ZERO NaN
  for (const dir of [[0, 1, 0], [1, 0, 0], [0, -1, 0], [0, 0, 0], [10, 20, -5]] as const) {
    const p = projectShadow([3, 2, -1], { groundY: 0, radius: 0.8, direction: dir })
    assert.ok(p.position.every(Number.isFinite), `finite position for dir ${dir}`)
    assert.ok(p.scale.every(v => Number.isFinite(v) && v > 0), `positive finite scale for dir ${dir}`)
    assert.ok(Number.isFinite(p.yaw), `finite yaw for dir ${dir}`)
    assert.ok(Number.isFinite(p.opacity) && p.opacity >= 0 && p.opacity <= 1, `valid opacity for dir ${dir}`)
  }
  const vertical = projectShadow([3, 4, -1], { groundY: 1, radius: 0.8, direction: [0, 1, 0] })
  assert.equal(vertical.position[0], 3)
  assert.equal(vertical.position[2], -1)
  assert.ok(Math.abs(vertical.scale[0] - vertical.scale[2]) < 1e-6, 'vertical light produces circular shadow')

  // Planar projected shadow meshes for box, cylinder, octahedron
  const overheadBox = projectShadowMesh(box, { direction: [0, 1, 0] })
  assert.equal(overheadBox.vertexCount, 6, 'overhead box shadow is a clean non-overlapping 2-triangle quad')
  for (let i = 0; i < overheadBox.data.length; i += 6) {
    assert.equal(overheadBox.data[i + 1], 0)
    assert.equal(overheadBox.data[i + 4], 1)
  }

  for (const [m, dir] of [
    [box, [-0.48, 0.8, 0.36]],
    [box, [1, 0, 0]],
    [cylinder(8), [-0.5, 0.7, 0.5]],
    [octahedron, [0, 1, 0]]
  ] as const) {
    const projected = projectShadowMesh(m, { direction: dir, scale: [1.2, 2, 1.2] })
    assert.ok(projected.vertexCount >= 3 && projected.vertexCount % 3 === 0)
    assert.ok(Number.isFinite(projected.radius) && projected.radius > 0)
    for (let i = 0; i < projected.data.length; i += 6) {
      assert.ok(Number.isFinite(projected.data[i]) && Number.isFinite(projected.data[i + 2]))
      assert.equal(projected.data[i + 1], 0)
      assert.equal(projected.data[i + 4], 1)
    }
  }
})

test('createShadowBatch renders ground shadows cleanly on Canvas 2D (depthTest true and false) without Z-fighting', async () => {
  const groundQuad = mesh([
    -10, 0, -10, -10, 0, 10, 10, 0, 10,
    -10, 0, -10, 10, 0, 10, 10, 0, -10
  ])
  const ground = instances(groundQuad, { capacity: 1, blend: 'opaque' })
  ground.add([0, 0, 0], [1, 1, 1], 0, [0.85, 0.85, 0.85], 1)

  const sun: [number, number, number] = [-0.6, 0.8, 0]
  const shadows = createShadowBatch({ direction: sun, groundY: 0, radius: 1.4, opacity: 0.6, penumbra: 0.3 })
  assert.equal(shadows.batch.blend, 'alpha')
  shadows.add([0, 2, 0])
  assert.equal(shadows.batch.count, 2, 'penumbra adds outer + inner shadow rings')

  // Expected shadow X center = 0 - (-0.6) * (2 / 0.8) = +1.5
  const topDown = multiply(orthographic(10, 10, 0.5, 30), view([0, 10, 0.001], [0, 0, 0]))

  // 1) Depth-tested Canvas 2D (renderMeshPixels)
  const { pixels } = renderMeshPixels(topDown, [ground, shadows.batch], 64, { ambient: 1 })
  const sample = (worldX: number) => {
    const px = Math.round(((worldX / 5) * 0.5 + 0.5) * 64)
    const py = 32
    return pixels[(py * 64 + px) * 4]
  }
  const unshadowedR = sample(-3)
  const shadowedR = sample(1.5)
  assert.ok(unshadowedR > 200, `expected bright unshadowed ground, got ${unshadowedR}`)
  assert.ok(shadowedR < unshadowedR - 45, `expected darkened shadow footprint (${shadowedR} vs ${unshadowedR})`)

  // 2) Planar projected mesh shadow via addProjected
  const boxShadowMesh = projectShadowMesh(box, { direction: sun, scale: [1.5, 2, 1.5] })
  const projectedShadows = createShadowBatch({ mesh: boxShadowMesh, direction: sun, groundY: 0, opacity: 0.6 })
  projectedShadows.addProjected([0, 0, 0])
  const { pixels: projPixels } = renderMeshPixels(topDown, [ground, projectedShadows.batch], 64, { ambient: 1 })
  const projAt = (worldX: number) => projPixels[(32 * 64 + Math.round(((worldX / 5) * 0.5 + 0.5) * 64)) * 4]
  assert.ok(projAt(0.8) < projAt(-3) - 45, 'projected box shadow darkens ground along light direction')

  // 3) Painter's algorithm Canvas 2D (canvasDepth: false) draws ground then shadow cleanly
  const fills: { style: string; alpha: number }[] = []
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() { fills.push({ style: this.fillStyle, alpha: this.globalAlpha }) }
  }
  const canvas = {
    width: 64, height: 64, clientWidth: 64, clientHeight: 64,
    getContext: () => ctx
  } as unknown as HTMLCanvasElement
  const renderer = await createLowPolyRenderer(canvas, { backend: 'canvas', canvasDepth: false, lighting: { ambient: 1 } })
  renderer.render(topDown, [ground, shadows.batch])
  assert.ok(fills.length >= 4, 'drew ground + shadow polygons')
  assert.ok(fills[0].alpha === 1, 'opaque ground painted before translucent shadow')
  assert.ok(fills[fills.length - 1].alpha < 1, 'shadow painted on top of ground')
  renderer.dispose()

  // Verify clear() retains buffer capacity & setLighting() updates direction
  const bufBefore = shadows.batch.data
  shadows.clear()
  assert.equal(shadows.batch.count, 0)
  assert.equal(shadows.batch.data, bufBefore)
  shadows.setLighting({ direction: [0.6, 0.8, 0] })
  shadows.add([0, 2, 0], { penumbra: 0 })
  assert.equal(shadows.batch.count, 1)
  assert.ok(shadows.batch.data[0] < -1.0, 'flipped light shifts shadow to -X')
})

test('canvasMeshes(depthTest: true) sorts alpha faces regardless of submission order', () => {
  const width = 16, height = 16
  let frame: Uint8ClampedArray = new Uint8ClampedArray(width * height * 4)
  const canvas = {
    width, height,
    getContext: () => ({
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (img: { data: Uint8ClampedArray }) => { frame = img.data }
    })
  } as unknown as HTMLCanvasElement
  const backend = canvasMeshes(canvas, new Float32Array([0, 0, 1, 1]), { depthTest: true })
  const cam = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const near = instances(mesh([-1, -1, 0.2, 1, -1, 0.2, 0, 1, 0.2]), { capacity: 1, blend: 'alpha' })
  near.add([0, 0, 0], [1, 1, 1], 0, [0, 0, 1, 0.5], 1)
  const far = instances(mesh([-1, -1, 0.8, 1, -1, 0.8, 0, 1, 0.8]), { capacity: 1, blend: 'alpha' })
  far.add([0, 0, 0], [1, 1, 1], 0, [1, 0, 0, 0.5], 1)
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }

  backend.draw(cam, [0, 0, 0, 1], [near, far], stats)
  const center = (10 * width + 8) * 4
  const pxNearFirst = Array.from(frame.slice(center, center + 4))

  backend.draw(cam, [0, 0, 0, 1], [far, near], stats)
  const pxFarFirst = Array.from(frame.slice(center, center + 4))

  assert.deepEqual(pxNearFirst, pxFarFirst)
  assert.ok(pxNearFirst[2] > pxNearFirst[0], 'near blue blends over far red')
  backend.dispose()
})

test('createLowPolyRenderer orders opaque -> back-to-front alpha -> additive and keeps static opaque uploadBytes at 0', async t => {
  const prevGpu = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const prevUsage = globalThis.GPUBufferUsage
  const prevTexUsage = globalThis.GPUTextureUsage
  const prevStage = globalThis.GPUShaderStage
  const { fakeDevice, draws, writes } = createMockWebGPU()

  Object.defineProperty(globalThis, 'GPUBufferUsage', { value: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 }, configurable: true })
  Object.defineProperty(globalThis, 'GPUTextureUsage', { value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 }, configurable: true })
  Object.defineProperty(globalThis, 'GPUShaderStage', { value: { VERTEX: 1, FRAGMENT: 2 }, configurable: true })
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
    Object.defineProperty(globalThis, 'GPUShaderStage', { value: prevStage, configurable: true })
  })

  const canvas = {
    width: 64, height: 64, clientWidth: 64, clientHeight: 64,
    getContext: () => ({ configure() {}, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) })
  } as unknown as HTMLCanvasElement
  const renderer = await createLowPolyRenderer(canvas, { backend: 'webgpu' })
  const cam = multiply(perspective(Math.PI / 3, 1, 0.5, 100), view([0, 0, 12], [0, 0, 0]))

  const opaque = instances(box, { capacity: 1, blend: 'opaque' })
  opaque.add([0, 0, 0])
  const additive = instances(box, { capacity: 1, blend: 'additive' })
  additive.add([5, 0, 2], [1, 1, 1], 0, [1, 1, 0, 0.6])
  const alphaNear = instances(box, { capacity: 1, blend: 'alpha' })
  alphaNear.add([1, 0, 4], [1, 1, 1], 0, [0, 0, 1, 0.5])
  const alphaFar = instances(box, { capacity: 1, blend: 'alpha' })
  alphaFar.add([2, 0, -4], [1, 1, 1], 0, [1, 0, 0, 0.5])

  writes.length = 0
  draws.length = 0
  // Submit in scrambled order: additive, near alpha, opaque, far alpha
  renderer.render(cam, [additive, alphaNear, opaque, alphaFar])
  assert.deepEqual(
    draws.map(d => d.pipeline),
    ['fragmentOpaque', 'fragmentAlpha', 'fragmentAlpha', 'fragmentAdditive']
  )
  const bufToX = new Map<object, number>()
  for (const w of writes) {
    if (w.data.length === INSTANCE_SIZE) bufToX.set(w.buffer, w.data[0])
  }
  assert.equal(bufToX.get(draws[1].buffer), 2, 'far alpha drawn before near alpha')
  assert.equal(bufToX.get(draws[2].buffer), 1, 'near alpha drawn after far alpha')

  // Subsequent frame with only static opaque -> 0 uploadBytes
  const s2 = renderer.render(cam, [opaque])
  assert.equal(s2.uploadBytes, 0)
  renderer.dispose()
})

test('packLighting preserves fogFar on fogNear-only update, canvasMeshes.setLighting applies next light, and createAlphaSorter(0) is safe', () => {
  const light = packLighting({ fogNear: 10, fogFar: 50 })
  assert.equal(light[11], 10)
  assert.ok(Math.abs(1 / light[12] - 40) < 1e-5)

  const updated = packLighting({ fogNear: 20 }, light)
  assert.equal(updated[11], 20)
  // Span must now be 50 - 20 = 30 (not shifted to 60 - 20 = 40)
  assert.ok(Math.abs(1 / updated[12] - 30) < 1e-5, `Expected fog span 30, got ${1 / updated[12]}`)

  // canvasMeshes.setLighting(next) must update the active lighting buffer
  const fills: string[] = []
  const fakeCanvas = {
    width: 64, height: 64,
    getContext: () => ({
      set fillStyle(v: string) { fills.push(v) },
      get fillStyle() { return fills[fills.length - 1] ?? '' },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}
    })
  } as unknown as HTMLCanvasElement
  const darkLight = packLighting({ ambient: 0.1, color: [0.1, 0.1, 0.1] })
  const brightLight = packLighting({ ambient: 1.0, color: [1.0, 1.0, 1.0] })
  const backend = canvasMeshes(fakeCanvas, darkLight)
  const batch = instances(box, 1)
  batch.add([0, 0, 0], [1, 1, 1], 0, [1, 1, 1, 1])
  const cam = multiply(orthographic(6, 6, 0.1, 100), view([0, 0, 10], [0, 0, 0]))
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }
  backend.draw(cam, [0, 0, 0, 1], [batch], stats)
  const darkFill = fills[fills.length - 1]
  fills.length = 0
  backend.setLighting?.(brightLight)
  backend.draw(cam, [0, 0, 0, 1], [batch], stats)
  const brightFill = fills[fills.length - 1]
  assert.notEqual(brightFill, darkFill, 'canvasMeshes.setLighting(next) must apply the new lighting buffer')
  assert.equal(brightFill, 'rgb(255,255,255)')
  backend.dispose()

  // createAlphaSorter(0) must not infinite-loop
  const sorter = createAlphaSorter(0)
  const b1 = instances(box, { capacity: 1, blend: 'alpha' })
  b1.add([0, 0, 0])
  const out: typeof b1[] = []
  sorter.sortBatches(cam, [b1], out)
  assert.equal(out.length, 1)
  const sorted = sorter.sortInstanceIndices(cam, b1.data, 1)
  assert.equal(sorted.inOrder, true)
  const packed = sorter.packInstances(b1.data, 1)
  assert.ok(packed.length >= INSTANCE_SIZE)
})

test('Tier 2 GPU directional shadow pass works with parity on WebGPU and WebGL 2 through createLowPolyRenderer', async t => {
  const prevGpu = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const prevUsage = globalThis.GPUBufferUsage
  const prevTexUsage = globalThis.GPUTextureUsage
  const prevStage = globalThis.GPUShaderStage

  const gpuMock = createMockWebGPU()
  const glMock = createMockWebGL2()

  Object.defineProperty(globalThis, 'GPUBufferUsage', { value: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 }, configurable: true })
  Object.defineProperty(globalThis, 'GPUTextureUsage', { value: { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 }, configurable: true })
  Object.defineProperty(globalThis, 'GPUShaderStage', { value: { VERTEX: 1, FRAGMENT: 2 }, configurable: true })
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      gpu: {
        requestAdapter: async () => ({ requestDevice: async () => gpuMock.fakeDevice }),
        getPreferredCanvasFormat: () => 'bgra8unorm'
      }
    },
    configurable: true
  })
  t.after(() => {
    if (prevGpu) Object.defineProperty(globalThis, 'navigator', prevGpu)
    Object.defineProperty(globalThis, 'GPUBufferUsage', { value: prevUsage, configurable: true })
    Object.defineProperty(globalThis, 'GPUTextureUsage', { value: prevTexUsage, configurable: true })
    Object.defineProperty(globalThis, 'GPUShaderStage', { value: prevStage, configurable: true })
  })

  const initialLighting = {
    direction: [-0.4, 0.85, 0.3] as const,
    ambient: 0.45,
    shadows: { enabled: true, center: [0, 0, 0] as const, extent: 10, bias: 0.003, strength: 0.5, color: [0.2, 0.25, 0.4] as const }
  }
  const expectedLightMatrix1 = computeShadowMatrix(packLighting(initialLighting))

  const gpuCanvas = {
    width: 64, height: 64, clientWidth: 64, clientHeight: 64,
    getContext: () => ({ configure() {}, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) })
  } as unknown as HTMLCanvasElement
  const glCanvas = {
    width: 64, height: 64, clientWidth: 64, clientHeight: 64,
    getContext: () => glMock.gl,
    addEventListener() {},
    removeEventListener() {}
  } as unknown as HTMLCanvasElement

  const gpuRenderer = await createLowPolyRenderer(gpuCanvas, { backend: 'webgpu', lighting: initialLighting })
  const glRenderer = await createLowPolyRenderer(glCanvas, { backend: 'webgl2', lighting: initialLighting })

  // Verify shadow pipelines, textures, and samplers/compare modes
  const shadowPipe = gpuMock.pipelines.find(p => p.entryPoint === 'shadowVertex')
  assert.ok(shadowPipe, 'WebGPU created shadowVertex pipeline')
  assert.equal(shadowPipe.depthStencil.depthBias, 2)
  assert.equal(shadowPipe.depthStencil.depthBiasSlopeScale, 2)
  assert.ok(gpuMock.samplers.some(s => s.compare === 'less'), 'WebGPU created comparison shadow sampler')
  assert.ok(gpuMock.textures.some(tex => tex.width === 1024 && tex.height === 1024 && tex.format === 'depth24plus'), 'WebGPU allocated 1024x1024 shadow depth texture')

  const glShadowTex = glMock.shadowTextures.find(tex => tex.width === 1024 && tex.height === 1024)
  assert.ok(glShadowTex, 'WebGL 2 allocated 1024x1024 shadow depth texture')
  assert.equal(glShadowTex.internalFormat, glMock.gl.DEPTH_COMPONENT24)
  assert.equal(glShadowTex.params[glMock.gl.TEXTURE_COMPARE_MODE], glMock.gl.COMPARE_REF_TO_TEXTURE)
  assert.equal(glShadowTex.params[glMock.gl.TEXTURE_COMPARE_FUNC], glMock.gl.LEQUAL)

  // Verify WebGPU & WebGL 2 fragment shaders agree on shadow depth clamping and bounds
  const wgsl = gpuMock.shaders.join('\n')
  const glsl = glMock.shaderSources.join('\n')
  assert.match(wgsl, /clamp\(sc\.z - camera\.shadowParams\.y, 0\.0, 1\.0\)/)
  assert.match(wgsl, /edge > 0\.0 && sc\.z > 0\.0 && sc\.z < 1\.0/)
  assert.match(glsl, /clamp\(sc\.z - shadowParams\.y, 0\.0, 1\.0\)/)
  assert.match(glsl, /edge > 0\.0 && sc\.z > 0\.0 && sc\.z < 1\.0/)

  // Verify initial uploaded lightMatrix matches computeShadowMatrix identically on both backends
  const gpuInitLightWrite = gpuMock.writes.find(w => w.dstOffset === 64 && w.data.length === 88)
  assert.ok(gpuInitLightWrite, 'WebGPU uploaded 88-float lighting+lightMatrix uniform block')
  const gpuLightMatrix1 = gpuInitLightWrite.data.subarray(72, 88)
  const glLightMatrix1 = glMock.mainUniforms.lightMatrix
  assert.ok(glLightMatrix1 instanceof Float32Array)
  assert.deepEqual(Array.from(gpuLightMatrix1), Array.from(expectedLightMatrix1))
  assert.deepEqual(Array.from(glLightMatrix1), Array.from(expectedLightMatrix1))

  // Camera sits at z=5 looking toward -Z; offscreenCaster at z=8 is BEHIND camera but INSIDE shadow frustum (extent=10).
  const cam1 = multiply(perspective(Math.PI / 3, 1, 0.5, 50), view([0, 0, 5], [0, 0, -5]))
  const cam2 = multiply(perspective(Math.PI / 3, 1, 0.5, 50), view([1, 0.5, 5.2], [0, 0, -5]))

  const inCaster = instances(box, { capacity: 1, blend: 'opaque' })
  inCaster.add([0, 0, 0])

  const offscreenCaster = instances(box, { capacity: 1, blend: 'opaque' })
  offscreenCaster.add([0, 0, 8]) // Behind camera (culled from main pass), inside shadow extent=10!

  const farOpaque = instances(box, { capacity: 1, blend: 'opaque' })
  farOpaque.add([200, 0, 0]) // Outside both camera and shadow frustums

  const alphaBatch = instances(box, { capacity: 1, blend: 'alpha' })
  alphaBatch.add([0, 0, -1], [1, 1, 1], 0, [0, 0.5, 1, 0.5]) // Inside both, excluded from shadows

  const scene = [inCaster, offscreenCaster, farOpaque, alphaBatch]

  // Frame 1: shadow pass runs once on both backends with [inCaster, offscreenCaster] only
  gpuMock.draws.length = 0
  glMock.draws.length = 0
  gpuRenderer.render(cam1, scene)
  glRenderer.render(cam1, scene)

  assert.equal(gpuMock.shadowPasses.length, 1, 'WebGPU ran 1 shadow pass on frame 1')
  assert.equal(gpuMock.shadowPasses[0].draws.length, 2, 'WebGPU shadow pass drew inCaster + offscreenCaster only')
  assert.equal(gpuMock.draws.length, 2, 'WebGPU main pass drew inCaster + alphaBatch only')

  assert.equal(glMock.shadowPasses.length, 1, 'WebGL 2 ran 1 shadow pass on frame 1')
  assert.deepEqual(glMock.shadowPasses[0].viewport, [0, 0, 1024, 1024])
  assert.deepEqual(glMock.shadowPasses[0].polygonOffset, [2, 2])
  assert.deepEqual(Array.from(glMock.shadowPasses[0].lightMatrix!), Array.from(expectedLightMatrix1))
  assert.equal(glMock.shadowPasses[0].draws.length, 2, 'WebGL 2 shadow pass drew inCaster + offscreenCaster only')
  assert.equal(glMock.draws.length, 2, 'WebGL 2 main pass drew inCaster + alphaBatch only')

  // Frame 2: camera moves while casters stay static -> shadow dirty skip on BOTH backends!
  gpuRenderer.render(cam2, scene)
  glRenderer.render(cam2, scene)
  assert.equal(gpuMock.shadowPasses.length, 1, 'WebGPU skipped shadow pass when static casters unchanged')
  assert.equal(glMock.shadowPasses.length, 1, 'WebGL 2 skipped shadow pass when static casters unchanged')

  // Frame 3: mutating an opaque caster bumps its revision -> triggers shadow pass re-render!
  inCaster.clear()
  inCaster.add([0.5, 0, 0])
  gpuRenderer.render(cam2, scene)
  glRenderer.render(cam2, scene)
  assert.equal(gpuMock.shadowPasses.length, 2, 'WebGPU re-rendered shadow pass after caster revision changed')
  assert.equal(glMock.shadowPasses.length, 2, 'WebGL 2 re-rendered shadow pass after caster revision changed')

  // Frame 4: updating shadow center via setLighting marks shadow dirty and uploads matching lightMatrix
  const movedLighting = packLighting({ shadows: { center: [2, 0, 0] } }, packLighting(initialLighting))
  const expectedLightMatrix2 = computeShadowMatrix(movedLighting)
  gpuMock.writes.length = 0
  gpuRenderer.setLighting({ shadows: { center: [2, 0, 0] } })
  glRenderer.setLighting({ shadows: { center: [2, 0, 0] } })
  gpuRenderer.render(cam2, scene)
  glRenderer.render(cam2, scene)

  assert.equal(gpuMock.shadowPasses.length, 3, 'WebGPU re-rendered shadow pass after setLighting')
  assert.equal(glMock.shadowPasses.length, 3, 'WebGL 2 re-rendered shadow pass after setLighting')
  const gpuUpdatedLightWrite = gpuMock.writes.find(w => w.dstOffset === 64 && w.data.length === 88)
  assert.ok(gpuUpdatedLightWrite)
  assert.deepEqual(Array.from(gpuUpdatedLightWrite.data.subarray(72, 88)), Array.from(expectedLightMatrix2))
  assert.deepEqual(Array.from(glMock.shadowPasses[2].lightMatrix!), Array.from(expectedLightMatrix2))

  // Frame 5: disabling shadows stops shadow passes on both backends
  gpuRenderer.setLighting({ shadows: { enabled: false } })
  glRenderer.setLighting({ shadows: { enabled: false } })
  gpuRenderer.render(cam2, scene)
  glRenderer.render(cam2, scene)
  assert.equal(gpuMock.shadowPasses.length, 3, 'WebGPU skipped shadow pass once shadows disabled')
  assert.equal(glMock.shadowPasses.length, 3, 'WebGL 2 skipped shadow pass once shadows disabled')

  gpuRenderer.dispose()
  glRenderer.dispose()
})

test('Canvas 2D skips GPU shadows cleanly and dead createRenderer is retired while color() stays exported', async () => {
  assert.equal('createRenderer' in frameworkIndex, false, 'dead createRenderer must not be exported from framework/index.ts')
  assert.deepEqual(color('#ff8000').map(v => Math.round(v * 255)), [255, 128, 0, 255])

  const canvas = {
    width: 32, height: 32, clientWidth: 32, clientHeight: 32,
    getContext: () => ({
      fillStyle: '',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}
    })
  } as unknown as HTMLCanvasElement
  const renderer = await createLowPolyRenderer(canvas, {
    backend: 'canvas',
    lighting: { shadows: { enabled: true, center: [0, 0, 0], extent: 10 } }
  })
  const b = instances(box, 1)
  b.add([0, 0, 0])
  const cam = multiply(orthographic(6, 6, 0.5, 50), view([0, 0, 10], [0, 0, 0]))
  const stats = renderer.render(cam, [b])
  assert.ok(stats.drawCalls > 0)
  renderer.dispose()
})
