import { createAlphaSorter } from './geometry.ts'
import { INSTANCE_SIZE } from './instances.ts'
import type { BlendMode, InstanceBatch, MeshBackend } from './types.ts'

const shader = `
struct Camera {
  matrix: mat4x4f,
  sunDir: vec4f,
  sunColor: vec4f,
  fog: vec4f,
  fogExtra: vec4f,
  pointPos: array<vec4f, 4>,
  pointCol: array<vec4f, 4>
}
@group(0) @binding(0) var<uniform> camera: Camera;
struct Output {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) color: vec4f,
  @location(1) @interpolate(flat) fogT: f32
}
fn rotate(q: vec4f, v: vec3f) -> vec3f {
  let t = 2 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
@vertex fn vertex(@location(0) position: vec3f, @location(1) normal: vec3f,
                  @location(2) origin: vec4f, @location(3) scale: vec4f,
                  @location(4) tint: vec4f, @location(5) rotation: vec4f) -> Output {
  let world = origin.xyz + rotate(rotation, position * scale.xyz);
  let rotated = normalize(rotate(rotation, normal / scale.xyz));
  let sunShade = camera.sunDir.w + (1 - camera.sunDir.w) * max(0.0, dot(rotated, camera.sunDir.xyz));
  var lit = camera.sunColor.rgb * sunShade;
  let count = u32(camera.sunColor.w + 0.5);
  for (var i = 0u; i < 4u; i = i + 1u) {
    if (i >= count) { break; }
    let toLight = camera.pointPos[i].xyz - world;
    let distSq = dot(toLight, toLight);
    let atten = max(0.0, 1.0 - distSq * camera.pointPos[i].w);
    if (atten > 0.0) {
      let ldir = toLight * inverseSqrt(max(distSq, 1e-5));
      let ndotl = max(0.25, dot(rotated, ldir));
      lit = lit + camera.pointCol[i].rgb * (camera.pointCol[i].w * atten * atten * ndotl);
    }
  }
  let shaded = min(vec3f(1.0), tint.rgb * mix(lit, vec3f(1.0), tint.a));
  let clip = camera.matrix * vec4f(world, 1.0);
  let fogT = select(0.0, clamp((clip.w - camera.fog.w) * camera.fogExtra.x, 0.0, 1.0), camera.fogExtra.x > 0.0);
  return Output(clip, vec4f(shaded, origin.w), fogT);
}
@fragment fn fragmentOpaque(input: Output) -> @location(0) vec4f {
  let rgb = mix(input.color.rgb, camera.fog.rgb, input.fogT);
  return vec4f(rgb, 1.0);
}
@fragment fn fragmentAlpha(input: Output) -> @location(0) vec4f {
  let rgb = mix(input.color.rgb, camera.fog.rgb, input.fogT);
  return vec4f(rgb, input.color.a);
}
@fragment fn fragmentAdditive(input: Output) -> @location(0) vec4f {
  let rgb = input.color.rgb * (1.0 - input.fogT * 0.65);
  return vec4f(rgb, input.color.a);
}
`

function expandLight(light: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  if (light.length >= 48) return light
  const full = new Float32Array(48)
  full.set(light)
  full[4] = 1; full[5] = 1; full[6] = 1
  return full
}

export async function gpuMeshes(canvas: HTMLCanvasElement, light: Float32Array<ArrayBuffer>): Promise<MeshBackend | null> {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) return null
  const device = await adapter.requestDevice()
  try {
    const format = navigator.gpu.getPreferredCanvasFormat()
    const module = device.createShaderModule({ code: shader })
    const vertexBuffers: GPUVertexBufferLayout[] = [
      { arrayStride: 24, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' }
      ] },
      { arrayStride: INSTANCE_SIZE * 4, stepMode: 'instance', attributes: [
        { shaderLocation: 2, offset: 0, format: 'float32x4' },
        { shaderLocation: 3, offset: 16, format: 'float32x4' },
        { shaderLocation: 4, offset: 32, format: 'float32x4' },
        { shaderLocation: 5, offset: 48, format: 'float32x4' }
      ] }
    ]
    const hasExplicitLayout = typeof device.createBindGroupLayout === 'function' &&
      typeof device.createPipelineLayout === 'function' && typeof GPUShaderStage !== 'undefined'
    const bindLayout = hasExplicitLayout
      ? device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }]
        })
      : undefined
    const layout: GPUPipelineLayout | 'auto' = bindLayout
      ? device.createPipelineLayout({ bindGroupLayouts: [bindLayout] })
      : 'auto'

    const makePipeline = (
      entryPoint: string,
      blend?: GPUBlendState,
      depthWriteEnabled = true,
      depthBias = 0,
      depthBiasSlopeScale = 0
    ) =>
      device.createRenderPipelineAsync({
        layout,
        vertex: { module, entryPoint: 'vertex', buffers: vertexBuffers },
        fragment: { module, entryPoint, targets: [{ format, ...(blend ? { blend } : {}) }] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
          format: 'depth24plus',
          depthWriteEnabled,
          depthCompare: 'less',
          ...(depthBias || depthBiasSlopeScale ? { depthBias, depthBiasSlopeScale } : {})
        }
      })

    const [opaquePipe, alphaPipe, additivePipe] = await Promise.all([
      makePipeline('fragmentOpaque', undefined, true),
      makePipeline('fragmentAlpha', {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
      }, false, -1, -1),
      makePipeline('fragmentAdditive', {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
      }, false)
    ])
    const pipelines: Record<BlendMode, GPURenderPipeline> = {
      opaque: opaquePipe,
      alpha: alphaPipe,
      additive: additivePipe
    }

    const camera = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(camera, 64, expandLight(light))
    const bindGroup = device.createBindGroup({
      layout: bindLayout ?? opaquePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: camera } }]
    })
    const context = canvas.getContext('webgpu')
    context.configure({ device, format, alphaMode: 'opaque' })
    const meshes = new Map()
    const buffers = new Map<InstanceBatch, {
      buffer: GPUBuffer
      revision: number
      cameraRevision?: number
      lastOrder?: Int32Array
      lastCount?: number
      sorted?: boolean
    }>()
    const batchSorter = createAlphaSorter(16)
    const instanceSorter = createAlphaSorter(32)
    let depth
    let depthView
    const lastCamera = new Float32Array(16)
    let hasCamera = false
    let cameraRevision = 0
    function vertexBuffer(mesh) {
      if (!meshes.has(mesh)) {
        const buffer = device.createBuffer({
          size: mesh.data.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true
        })
        new Float32Array(buffer.getMappedRange()).set(mesh.data)
        buffer.unmap()
        meshes.set(mesh, buffer)
      }
      return meshes.get(mesh)
    }
    return {
      name: 'WebGPU',
      lost: device.lost,
      maxDimension: device.limits.maxTextureDimension2D,
      draw(matrix, clear, visible, stats) {
        let cameraChanged = !hasCamera
        if (!cameraChanged) {
          for (let i = 0; i < 16; i++) {
            if (matrix[i] !== lastCamera[i]) { cameraChanged = true; break }
          }
        }
        if (cameraChanged) {
          device.queue.writeBuffer(camera, 0, matrix)
          lastCamera.set(matrix)
          hasCamera = true
          cameraRevision++
        }
        if (!depth || depth.width !== canvas.width || depth.height !== canvas.height) {
          depth?.destroy()
          depth = device.createTexture({
            size: [canvas.width, canvas.height], format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
          })
          depthView = depth.createView()
        }
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(), clearValue: clear, loadOp: 'clear', storeOp: 'store'
          }],
          depthStencilAttachment: {
            view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard'
          }
        })
        pass.setBindGroup(0, bindGroup)
        let lastMesh
        let lastBlend: BlendMode | undefined
        const drawBatch = (batch: InstanceBatch) => {
          const blend: BlendMode = batch.blend ?? 'opaque'
          if (blend !== lastBlend) {
            pass.setPipeline(pipelines[blend])
            lastBlend = blend
          }
          let entry = buffers.get(batch)
          const size = batch.count * INSTANCE_SIZE * 4
          if (size > device.limits.maxBufferSize) {
            throw new RangeError('Instance batch exceeds WebGPU maxBufferSize')
          }
          if (!entry || entry.buffer.size < size) {
            entry?.buffer.destroy()
            const capacity = Math.min(device.limits.maxBufferSize, Math.max(batch.data.byteLength, size))
            entry = {
              buffer: device.createBuffer({ size: capacity, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
              revision: -1
            }
            buffers.set(batch, entry)
          }
          if (blend === 'alpha' && batch.count > 1) {
            const revisionChanged = entry.revision !== batch.revision
            if (revisionChanged || entry.cameraRevision !== cameraRevision || !entry.sorted) {
              const count = batch.count
              const { inOrder, indices } = instanceSorter.sortInstanceIndices(matrix, batch.data, count)
              let orderChanged = revisionChanged || !entry.sorted || entry.lastCount !== count
              if (!orderChanged && entry.lastOrder) {
                for (let k = 0; k < count; k++) {
                  if (entry.lastOrder[k] !== indices[k]) { orderChanged = true; break }
                }
              }
              if (orderChanged) {
                const uploadData = inOrder ? batch.data : instanceSorter.packInstances(batch.data, count)
                device.queue.writeBuffer(entry.buffer, 0, uploadData, 0, count * INSTANCE_SIZE)
                if (!entry.lastOrder || entry.lastOrder.length < count) {
                  entry.lastOrder = new Int32Array(Math.max(count, entry.lastOrder ? entry.lastOrder.length * 2 : 16))
                }
                for (let k = 0; k < count; k++) entry.lastOrder[k] = indices[k]
                entry.lastCount = count
                entry.revision = batch.revision
                entry.sorted = true
                stats.uploadBytes += size
              }
              entry.cameraRevision = cameraRevision
            }
          } else if (entry.revision !== batch.revision) {
            device.queue.writeBuffer(entry.buffer, 0, batch.data, 0, batch.count * INSTANCE_SIZE)
            entry.revision = batch.revision
            entry.sorted = false
            stats.uploadBytes += size
          }
          if (lastMesh !== batch.mesh) {
            pass.setVertexBuffer(0, vertexBuffer(batch.mesh))
            lastMesh = batch.mesh
          }
          pass.setVertexBuffer(1, entry.buffer)
          pass.draw(batch.mesh.vertexCount, batch.count)
        }
        for (let i = 0; i < visible.length; i++) {
          const batch = visible[i]
          if ((batch.blend ?? 'opaque') === 'alpha') {
            let j = i + 1
            while (j < visible.length && (visible[j].blend ?? 'opaque') === 'alpha') j++
            const runLen = j - i
            if (runLen > 1) {
              const { inOrder, indices } = batchSorter.sortBatchIndices(matrix, visible, i, runLen)
              if (inOrder) {
                for (let k = i; k < j; k++) drawBatch(visible[k])
              } else {
                for (let k = 0; k < runLen; k++) drawBatch(visible[i + indices[k]])
              }
              i = j - 1
              continue
            }
          }
          drawBatch(batch)
        }
        pass.end()
        device.queue.submit([encoder.finish()])
      },
      setLighting(next) {
        device.queue.writeBuffer(camera, 64, expandLight(next))
      },
      release(batch) {
        buffers.get(batch)?.buffer.destroy()
        buffers.delete(batch)
      },
      releaseMesh(mesh) {
        for (const [batch, entry] of buffers) {
          if (batch.mesh === mesh) {
            entry.buffer.destroy()
            buffers.delete(batch)
          }
        }
        meshes.get(mesh)?.destroy()
        meshes.delete(mesh)
      },
      dispose() {
        meshes.clear()
        buffers.clear()
        depth = undefined
        depthView = undefined
        context.unconfigure()
        device.destroy()
      }
    }
  } catch (error) {
    device.destroy()
    throw error
  }
}
