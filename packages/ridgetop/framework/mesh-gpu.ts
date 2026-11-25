import { createAlphaSorter, multiply, orthographic, view } from './geometry.ts'
import { INSTANCE_SIZE } from './instances.ts'
import type { BlendMode, InstanceBatch, Matrix, Mesh, MeshBackend, Vec3 } from './types.ts'

const SHADOW_SIZE = 1024

const shader = `
struct Camera {
  matrix: mat4x4f,
  sunDir: vec4f,
  sunColor: vec4f,
  fog: vec4f,
  fogExtra: vec4f,
  pointPos: array<vec4f, 4>,
  pointCol: array<vec4f, 4>,
  skyHemi: vec4f,
  groundToon: vec4f,
  rimLight: vec4f,
  shadowCenter: vec4f,
  shadowParams: vec4f,
  shadowColor: vec4f,
  lightMatrix: mat4x4f
}
@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;

struct Output {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) fogT: f32,
  @location(2) worldPos: vec3f,
  @location(3) @interpolate(flat) shadowRecv: f32
}

fn rotate(q: vec4f, v: vec3f) -> vec3f {
  let t = 2 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

@vertex fn shadowVertex(@location(0) position: vec3f, @location(1) normal: vec3f, @location(6) vtxColor: vec3f,
                        @location(2) origin: vec4f, @location(3) scale: vec4f,
                        @location(4) tint: vec4f, @location(5) rotation: vec4f) -> @builtin(position) vec4f {
  if (tint.a > 0.65) {
    return vec4f(2.0, 2.0, 2.0, 1.0);
  }
  let world = origin.xyz + rotate(rotation, position * scale.xyz);
  return camera.lightMatrix * vec4f(world, 1.0);
}

@vertex fn vertex(@location(0) position: vec3f, @location(1) normal: vec3f, @location(6) vtxColor: vec3f,
                  @location(2) origin: vec4f, @location(3) scale: vec4f,
                  @location(4) tint: vec4f, @location(5) rotation: vec4f) -> Output {
  let world = origin.xyz + rotate(rotation, position * scale.xyz);
  let rotated = normalize(rotate(rotation, normal / scale.xyz));
  let rawNdotL = dot(rotated, camera.sunDir.xyz);
  var diff = max(0.0, rawNdotL);
  if (camera.groundToon.w >= 2.0) {
    let steps = camera.groundToon.w;
    diff = floor(diff * steps + 0.5) / steps;
  }
  var lit: vec3f;
  if (camera.skyHemi.w > 0.5) {
    let hemi = mix(camera.groundToon.rgb, camera.skyHemi.rgb, rotated.y * 0.5 + 0.5);
    lit = hemi * (camera.sunDir.w * 1.25) + camera.sunColor.rgb * ((1.0 - camera.sunDir.w * 0.85) * diff);
  } else {
    let sunShade = camera.sunDir.w + (1.0 - camera.sunDir.w) * diff;
    lit = camera.sunColor.rgb * sunShade;
  }
  if (camera.rimLight.w > 0.0) {
    let viewAxis = normalize(vec3f(camera.matrix[0][2], camera.matrix[1][2], camera.matrix[2][2]));
    let fres = 1.0 - abs(dot(rotated, viewAxis));
    let upMask = 0.45 + 0.55 * max(0.0, rotated.y);
    lit = lit + camera.rimLight.rgb * (camera.rimLight.w * fres * fres * upMask);
  }
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
  let albedo = tint.rgb * vtxColor;
  let shaded = min(vec3f(1.0), albedo * mix(lit, vec3f(1.0), tint.a));
  let clip = camera.matrix * vec4f(world, 1.0);
  let fogT = select(0.0, clamp((clip.w - camera.fog.w) * camera.fogExtra.x, 0.0, 1.0), camera.fogExtra.x > 0.0);
  let recv = select(0.0, max(0.0, 1.0 - tint.a) * smoothstep(0.02, 0.22, rawNdotL), camera.shadowParams.x > 0.5);
  return Output(clip, vec4f(shaded, origin.w), fogT, world, recv);
}

fn sampleShadow(worldPos: vec3f) -> f32 {
  let sc = camera.lightMatrix * vec4f(worldPos, 1.0);
  let uv = vec2f(sc.x * 0.5 + 0.5, 0.5 - sc.y * 0.5);
  let depth = clamp(sc.z - camera.shadowParams.y, 0.0, 1.0);
  let texel = 1.25 / ${SHADOW_SIZE}.0;
  let s0 = textureSampleCompare(shadowMap, shadowSampler, clamp(uv + vec2f(-texel, -texel), vec2f(0.001), vec2f(0.999)), depth);
  let s1 = textureSampleCompare(shadowMap, shadowSampler, clamp(uv + vec2f( texel, -texel), vec2f(0.001), vec2f(0.999)), depth);
  let s2 = textureSampleCompare(shadowMap, shadowSampler, clamp(uv + vec2f(-texel,  texel), vec2f(0.001), vec2f(0.999)), depth);
  let s3 = textureSampleCompare(shadowMap, shadowSampler, clamp(uv + vec2f( texel,  texel), vec2f(0.001), vec2f(0.999)), depth);
  let litFactor = (s0 + s1 + s2 + s3) * 0.25;
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let fade = smoothstep(0.0, 0.06, edge);
  let inBounds = edge > 0.0 && sc.z > 0.0 && sc.z < 1.0;
  return select(0.0, (1.0 - litFactor) * fade, inBounds);
}

@fragment fn fragmentOpaque(input: Output) -> @location(0) vec4f {
  let sh = sampleShadow(input.worldPos) * input.shadowRecv * camera.shadowParams.z;
  let baseRgb = mix(input.color.rgb, input.color.rgb * camera.shadowColor.rgb, sh);
  let rgb = mix(baseRgb, camera.fog.rgb, input.fogT);
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

function computeLightMatrix(light: Float32Array): Matrix {
  const lx = light[0], ly = Math.max(0.22, light[1]), lz = light[2]
  const len = Math.hypot(lx, ly, lz) || 1
  const dx = lx / len, dy = ly / len, dz = lz / len
  const cx = light[60] || 0, cy = light[61] || 0, cz = light[62] || 0
  const extent = light[63] > 1 ? light[63] : 24
  const dist = extent * 2.2
  const eye: Vec3 = [cx + dx * dist, cy + dy * dist, cz + dz * dist]
  const up: Vec3 = Math.abs(dy) > 0.96 ? [0, 0, 1] : [0, 1, 0]
  return multiply(orthographic(extent * 2, extent * 2, 0.5, extent * 4.6), view(eye, [cx, cy, cz], up))
}

function packGpuLighting(
  light: Float32Array<ArrayBuffer>,
  full: Float32Array<ArrayBuffer>,
  allowShadows: boolean
): Float32Array<ArrayBuffer> {
  full.fill(0, 0, 72)
  full.set(light.subarray(0, Math.min(light.length, 72)))
  if (light.length < 48) { full[4] = 1; full[5] = 1; full[6] = 1 }
  if (!allowShadows) full[64] = 0
  if (full[64] > 0.5) full.set(computeLightMatrix(full), 72)
  return full
}

function packMeshVertices(mesh: Mesh): Float32Array<ArrayBuffer> {
  const count = mesh.vertexCount
  const out = new Float32Array(count * 9)
  const src = mesh.data
  const cols = mesh.colors && mesh.colors.length >= count * 3 ? mesh.colors : undefined
  for (let i = 0; i < count; i++) {
    const s = i * 6, d = i * 9
    out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]
    out[d + 3] = src[s + 3]; out[d + 4] = src[s + 4]; out[d + 5] = src[s + 5]
    if (cols) {
      const c = i * 3
      out[d + 6] = cols[c]; out[d + 7] = cols[c + 1]; out[d + 8] = cols[c + 2]
    } else {
      out[d + 6] = 1; out[d + 7] = 1; out[d + 8] = 1
    }
  }
  return out
}

const SOFTWARE_GPU_RE = /swiftshader|llvmpipe|lavapipe|software|basic render|warp|cpu/i

function describeGpuAdapter(adapter: GPUAdapter): { label: string; isSoftware: boolean } {
  const isFallback = 'isFallbackAdapter' in adapter && Boolean(Reflect.get(adapter, 'isFallbackAdapter'))
  const info: unknown = 'info' in adapter ? Reflect.get(adapter, 'info') : undefined
  const parts: string[] = []
  if (typeof info === 'object' && info !== null) {
    for (const key of ['vendor', 'architecture', 'device', 'description']) {
      const val = Reflect.get(info, key)
      if (typeof val === 'string' && val.trim()) parts.push(val.trim())
    }
  }
  const label = parts.length > 0 ? parts.join(' ').slice(0, 80) : (isFallback ? 'WebGPU Fallback' : 'WebGPU')
  const isSoftware = isFallback || SOFTWARE_GPU_RE.test(label)
  return { label, isSoftware }
}

export async function gpuMeshes(
  canvas: HTMLCanvasElement,
  light: Float32Array<ArrayBuffer>,
  options: { allowFallback?: boolean } = {}
): Promise<MeshBackend | null> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) return null
  const { label: gpuInfo, isSoftware } = describeGpuAdapter(adapter)
  if (isSoftware && !options.allowFallback) return null
  const device = await adapter.requestDevice()
  try {
    const format = navigator.gpu.getPreferredCanvasFormat()
    const module = device.createShaderModule({ code: shader })
    const vertexBuffers: GPUVertexBufferLayout[] = [
      { arrayStride: 36, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 6, offset: 24, format: 'float32x3' }
      ] },
      { arrayStride: INSTANCE_SIZE * 4, stepMode: 'instance', attributes: [
        { shaderLocation: 2, offset: 0, format: 'float32x4' },
        { shaderLocation: 3, offset: 16, format: 'float32x4' },
        { shaderLocation: 4, offset: 32, format: 'float32x4' },
        { shaderLocation: 5, offset: 48, format: 'float32x4' }
      ] }
    ]
    const hasShadowSupport = typeof device.createSampler === 'function'
    const hasExplicitLayout = hasShadowSupport && typeof device.createBindGroupLayout === 'function' &&
      typeof device.createPipelineLayout === 'function' && typeof GPUShaderStage !== 'undefined'
    const bindLayout = hasExplicitLayout
      ? device.createBindGroupLayout({
          entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } }
          ]
        })
      : undefined
    const shadowBindLayout = hasExplicitLayout
      ? device.createBindGroupLayout({
          entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }]
        })
      : undefined
    const layout: GPUPipelineLayout | 'auto' = bindLayout
      ? device.createPipelineLayout({ bindGroupLayouts: [bindLayout] })
      : 'auto'
    const shadowLayout: GPUPipelineLayout | 'auto' = shadowBindLayout
      ? device.createPipelineLayout({ bindGroupLayouts: [shadowBindLayout] })
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

    const shadowPipePromise = hasShadowSupport
      ? device.createRenderPipelineAsync({
          layout: shadowLayout,
          vertex: { module, entryPoint: 'shadowVertex', buffers: vertexBuffers },
          primitive: { topology: 'triangle-list', cullMode: 'back' },
          depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
            depthBias: 2,
            depthBiasSlopeScale: 2
          }
        })
      : Promise.resolve(null)

    const [opaquePipe, alphaPipe, additivePipe, shadowPipe] = await Promise.all([
      makePipeline('fragmentOpaque', undefined, true),
      makePipeline('fragmentAlpha', {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
      }, false, -1, -1),
      makePipeline('fragmentAdditive', {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }
      }, false),
      shadowPipePromise
    ])
    const pipelines: Record<BlendMode, GPURenderPipeline> = {
      opaque: opaquePipe,
      alpha: alphaPipe,
      additive: additivePipe
    }

    const camera = device.createBuffer({ size: 416, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const gpuLightBuf = new Float32Array(88)
    let shadowsEnabled = hasShadowSupport && light.length >= 65 && light[64] > 0.5
    device.queue.writeBuffer(camera, 64, packGpuLighting(light, gpuLightBuf, hasShadowSupport))

    // Shadow depth texture (lazy-sized or 1x1 dummy when disabled) + comparison sampler
    let shadowTex: GPUTexture | undefined
    let shadowView: GPUTextureView | undefined
    let shadowSampler: GPUSampler | undefined
    let bindGroup: GPUBindGroup
    let shadowBindGroup: GPUBindGroup | undefined
    let shadowSizeActive = 0

    function rebuildBindGroups(size: number) {
      if (!hasShadowSupport) {
        bindGroup = device.createBindGroup({
          layout: bindLayout ?? opaquePipe.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: camera } }]
        })
        return
      }
      shadowTex?.destroy()
      shadowTex = device.createTexture({
        size: [size, size],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
      })
      shadowView = shadowTex.createView()
      shadowSizeActive = size
      shadowSampler ??= device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' })
      bindGroup = device.createBindGroup({
        layout: bindLayout ?? opaquePipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: camera } },
          { binding: 1, resource: shadowView },
          { binding: 2, resource: shadowSampler }
        ]
      })
      if (shadowPipe) {
        shadowBindGroup = device.createBindGroup({
          layout: shadowBindLayout ?? shadowPipe.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: camera } }]
        })
      }
    }
    rebuildBindGroups(shadowsEnabled ? SHADOW_SIZE : 1)

    const rawContext = canvas.getContext('webgpu')
    if (!rawContext) throw new Error('Could not acquire WebGPU canvas context')
    const context: GPUCanvasContext = rawContext
    context.configure({ device, format, alphaMode: 'opaque' })
    const meshes = new Map<Mesh, GPUBuffer>()
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
    let depth: GPUTexture | undefined
    let depthView: GPUTextureView | undefined
    const lastCamera = new Float32Array(16)
    let hasCamera = false
    let cameraRevision = 0
    let shadowDirty = true
    const lastShadowBatches: InstanceBatch[] = []
    const lastShadowRevs: number[] = []
    function vertexBuffer(mesh: Mesh): GPUBuffer {
      let buffer = meshes.get(mesh)
      if (!buffer) {
        const packed = packMeshVertices(mesh)
        buffer = device.createBuffer({
          size: packed.byteLength, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true
        })
        new Float32Array(buffer.getMappedRange()).set(packed)
        buffer.unmap()
        meshes.set(mesh, buffer)
      }
      return buffer
    }
    return {
      name: 'WebGPU',
      gpuInfo,
      lost: device.lost,
      maxDimension: device.limits.maxTextureDimension2D,
      draw(matrix, clear, visible, stats, shadowCasters) {
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
        if (!depth || !depthView || depth.width !== canvas.width || depth.height !== canvas.height) {
          depth?.destroy()
          depth = device.createTexture({
            size: [canvas.width, canvas.height], format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT
          })
          depthView = depth.createView()
        }
        if (shadowsEnabled && hasShadowSupport && shadowSizeActive < SHADOW_SIZE) {
          rebuildBindGroups(SHADOW_SIZE)
        }

        const ensureInstanceBuffer = (batch: InstanceBatch, blend: BlendMode) => {
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
          return entry
        }

        const encoder = device.createCommandEncoder()

        // Tier 2 Directional Shadow Pass (only when enabled & casters or light changed)
        if (shadowsEnabled && shadowPipe && shadowView && shadowBindGroup) {
          const casters = shadowCasters ?? visible
          let needShadow = shadowDirty || casters.length !== lastShadowBatches.length
          if (!needShadow) {
            for (let i = 0; i < casters.length; i++) {
              if (casters[i] !== lastShadowBatches[i] || casters[i].revision !== lastShadowRevs[i]) {
                needShadow = true
                break
              }
            }
          }
          if (needShadow) {
            const spass = encoder.beginRenderPass({
              colorAttachments: [],
              depthStencilAttachment: {
                view: shadowView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store'
              }
            })
            spass.setPipeline(shadowPipe)
            spass.setBindGroup(0, shadowBindGroup)
            let sLastMesh: Mesh | undefined
            lastShadowBatches.length = casters.length
            lastShadowRevs.length = casters.length
            for (let i = 0; i < casters.length; i++) {
              const batch = casters[i]
              lastShadowBatches[i] = batch
              lastShadowRevs[i] = batch.revision
              if ((batch.blend ?? 'opaque') !== 'opaque' || !batch.count) continue
              const entry = ensureInstanceBuffer(batch, 'opaque')
              if (sLastMesh !== batch.mesh) {
                spass.setVertexBuffer(0, vertexBuffer(batch.mesh))
                sLastMesh = batch.mesh
              }
              spass.setVertexBuffer(1, entry.buffer)
              spass.draw(batch.mesh.vertexCount, batch.count)
            }
            spass.end()
            shadowDirty = false
          }
        }

        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(), clearValue: clear, loadOp: 'clear', storeOp: 'store'
          }],
          depthStencilAttachment: {
            view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard'
          }
        })
        pass.setBindGroup(0, bindGroup)
        let lastMesh: Mesh | undefined
        let lastBlend: BlendMode | undefined
        const drawBatch = (batch: InstanceBatch) => {
          const blend: BlendMode = batch.blend ?? 'opaque'
          if (blend !== lastBlend) {
            pass.setPipeline(pipelines[blend])
            lastBlend = blend
          }
          const entry = ensureInstanceBuffer(batch, blend)
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
        shadowsEnabled = hasShadowSupport && next.length >= 65 && next[64] > 0.5
        shadowDirty = true
        device.queue.writeBuffer(camera, 64, packGpuLighting(next, gpuLightBuf, hasShadowSupport))
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
        for (const entry of buffers.values()) entry.buffer.destroy()
        for (const buf of meshes.values()) buf.destroy()
        meshes.clear()
        buffers.clear()
        camera.destroy()
        depth?.destroy()
        shadowTex?.destroy()
        shadowTex = undefined
        shadowView = undefined
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
