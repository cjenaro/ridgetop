import { INSTANCE_SIZE } from './instances.ts'

import type { MeshBackend } from './types.ts'

const shader = `
struct Camera { matrix: mat4x4f, light: vec4f }
@group(0) @binding(0) var<uniform> camera: Camera;
struct Output {
  @builtin(position) position: vec4f,
  @location(0) @interpolate(flat) color: vec3f
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
  let light = camera.light.w + (1 - camera.light.w) * max(0, dot(rotated, camera.light.xyz));
  return Output(camera.matrix * vec4f(world, 1), tint.rgb * mix(light, 1, tint.a));
}
@fragment fn fragment(input: Output) -> @location(0) vec4f {
  return vec4f(input.color, 1);
}
`

export async function gpuMeshes(canvas: HTMLCanvasElement, light: Float32Array<ArrayBuffer>): Promise<MeshBackend | null> {
  const adapter = await navigator.gpu?.requestAdapter()
  if (!adapter) return null
  const device = await adapter.requestDevice()
  try {
    const format = navigator.gpu.getPreferredCanvasFormat()
    const module = device.createShaderModule({ code: shader })
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module, entryPoint: 'vertex', buffers: [
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
      },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' }
    })
    const camera = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(camera, 64, light)
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: camera } }]
    })
    const context = canvas.getContext('webgpu')
    context.configure({ device, format, alphaMode: 'opaque' })
    const meshes = new Map()
    const buffers = new Map()
    let depth
    let depthView
    const lastCamera = new Float32Array(16)
    let hasCamera = false
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
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        let lastMesh
        for (const batch of visible) {
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
          if (entry.revision !== batch.revision) {
            device.queue.writeBuffer(entry.buffer, 0, batch.data, 0, batch.count * INSTANCE_SIZE)
            entry.revision = batch.revision
            stats.uploadBytes += size
          }
          if (lastMesh !== batch.mesh) {
            pass.setVertexBuffer(0, vertexBuffer(batch.mesh))
            lastMesh = batch.mesh
          }
          pass.setVertexBuffer(1, entry.buffer)
          pass.draw(batch.mesh.vertexCount, batch.count)
        }
        pass.end()
        device.queue.submit([encoder.finish()])
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
