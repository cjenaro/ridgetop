import type { Backend, Color, InstanceBatch, LightingOptions, LowPolyRenderer, Matrix, MeshBackend, Vec3 } from './types.ts'
import type { SpriteClip } from './sprites.ts'
import { multiply, orthographic, view } from './geometry.ts'
import { canvasMeshes, meshViewPixels } from './mesh-canvas.ts'
import { glMeshes } from './mesh-gl.ts'
import { gpuMeshes } from './mesh-gpu.ts'
import { frustum, visible } from './instances.ts'
import { isTestingActive, recordFrame } from './testing-runtime.ts'

export { mesh, box, cylinder, octahedron, view, perspective, orthographic, multiply } from './geometry.ts'
export { instances } from './instances.ts'
export { color } from './renderer.ts'

export const LIGHT_FLOATS = 48
const defaultClear: Color = [0.05, 0.08, 0.12, 1]

function packLighting(options: LightingOptions = {}, prev?: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const out = new Float32Array(LIGHT_FLOATS)
  if (prev && prev.length >= LIGHT_FLOATS) out.set(prev)
  else {
    out[0] = -.48; out[1] = .8; out[2] = .36; out[3] = .52
    out[4] = 1; out[5] = 1; out[6] = 1; out[7] = 0
  }
  const direction = options.direction ?? [out[0], out[1], out[2]]
  const ambient = options.ambient ?? out[3]
  const [x, y, z] = direction
  const length = Math.hypot(x, y, z)
  if (!length || !Number.isFinite(length) || !(ambient >= 0 && ambient <= 1)) {
    throw new RangeError('Expected a nonzero light direction and ambient in the range 0–1')
  }
  out[0] = x / length
  out[1] = y / length
  out[2] = z / length
  out[3] = ambient

  if (options.color) {
    out[4] = options.color[0]
    out[5] = options.color[1]
    out[6] = options.color[2]
  }
  if (options.fogColor) {
    out[8] = options.fogColor[0]
    out[9] = options.fogColor[1]
    out[10] = options.fogColor[2]
  }
  if (options.fogNear !== undefined || options.fogFar !== undefined) {
    const near = options.fogNear ?? out[11]
    const far = options.fogFar ?? (out[12] > 0 ? near + 1 / out[12] : near)
    out[11] = Number.isFinite(near) ? near : 0
    out[12] = Number.isFinite(far) && far > near ? 1 / (far - near) : 0
  }
  if (options.points !== undefined) {
    const count = Math.min(4, options.points.length)
    out[7] = count
    for (let i = 0; i < 4; i++) {
      const pBase = 16 + i * 4
      const cBase = 32 + i * 4
      if (i < count) {
        const pt = options.points[i]
        const rad = Math.max(0.05, pt.radius)
        out[pBase] = pt.position[0]
        out[pBase + 1] = pt.position[1]
        out[pBase + 2] = pt.position[2]
        out[pBase + 3] = 1 / (rad * rad)
        out[cBase] = pt.color[0]
        out[cBase + 1] = pt.color[1]
        out[cBase + 2] = pt.color[2]
        out[cBase + 3] = pt.intensity ?? 1
      } else {
        out[pBase] = out[pBase + 1] = out[pBase + 2] = out[pBase + 3] = 0
        out[cBase] = out[cBase + 1] = out[cBase + 2] = out[cBase + 3] = 0
      }
    }
  }
  return out
}

export async function createLowPolyRenderer(canvas: HTMLCanvasElement,
  { backend = 'auto', pixelRatio = 2, lighting, canvasDepth = false }:
  { backend?: Backend; pixelRatio?: number; lighting?: LightingOptions; canvasDepth?: boolean } = {}
): Promise<LowPolyRenderer> {
  if (!['auto', 'webgpu', 'webgl2', 'canvas'].includes(backend)) throw new RangeError('Unknown rendering backend')
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new RangeError('Invalid maximum pixel ratio')
  const light = packLighting(lighting)
  let active: MeshBackend
  let disposed = false
  const selected: InstanceBatch[] = []
  const translucent: InstanceBatch[] = []
  const planes = new Float32Array(24)
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }

  function replaceCanvas() {
    const next = canvas.cloneNode() as HTMLCanvasElement
    canvas.replaceWith(next)
    canvas = next
  }

  function watch(current: MeshBackend) {
    current.lost?.then(() => {
      if (disposed || active !== current) return
      current.dispose()
      replaceCanvas()
      if (current.name === 'WebGPU') {
        try { active = glMeshes(canvas, light) }
        catch { replaceCanvas(); active = null }
      } else active = null
      if (!active) active = canvasMeshes(canvas, light, { depthTest: canvasDepth })
      watch(active)
    })
  }

  if (backend === 'auto' || backend === 'webgpu') {
    try { active = await gpuMeshes(canvas, light) }
    catch (error) {
      if (backend === 'webgpu') throw error
      console.warn('WebGPU initialization failed', error)
      replaceCanvas()
    }
    if (!active && backend === 'webgpu') throw new Error('WebGPU is unavailable')
  }
  if (!active && (backend === 'auto' || backend === 'webgl2')) {
    try { active = glMeshes(canvas, light) }
    catch (error) {
      if (backend === 'webgl2') throw error
      replaceCanvas()
    }
    if (!active && backend === 'webgl2') throw new Error('WebGL 2 is unavailable')
  }
  if (!active) active = canvasMeshes(canvas, light, { depthTest: canvasDepth })
  watch(active)

  return {
    get name() { return active.name },
    get canvas() { return canvas },
    render(matrix, batches, clear = defaultClear) {
      if (disposed) throw new Error('The renderer has been disposed')
      const w = Math.max(1, canvas.clientWidth)
      const h = Math.max(1, canvas.clientHeight)
      const ratio = Math.min(globalThis.devicePixelRatio || 1, pixelRatio, active.maxDimension / Math.max(w, h))
      const width = Math.max(1, Math.round(w * ratio))
      const height = Math.max(1, Math.round(h * ratio))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      frustum(matrix, planes)
      selected.length = 0
      translucent.length = 0
      stats.triangles = stats.instances = stats.uploadBytes = stats.culledBatches = 0
      for (const batch of batches) {
        if (visible(batch, planes)) {
          if (batch.blend === 'opaque') selected.push(batch)
          else translucent.push(batch)
          stats.triangles += batch.mesh.vertexCount / 3 * batch.count
          stats.instances += batch.count
        } else if (batch.count) stats.culledBatches++
      }
      for (let i = 0; i < translucent.length; i++) selected.push(translucent[i])
      stats.drawCalls = selected.length
      active.draw(matrix, clear, selected, stats)
      if (isTestingActive()) {
        recordFrame({
          canvas,
          viewProjection: new Float32Array(matrix),
          batches: selected.slice(),
          clear,
          width,
          height,
          clientWidth: w,
          clientHeight: h,
          timestamp: performance.now()
        })
      }
      return stats
    },
    setLighting(next: LightingOptions) {
      if (disposed) return
      const packed = packLighting(next, light)
      light.set(packed)
      active.setLighting?.(light)
    },
    release(batch) { active.release(batch) },
    releaseMesh(mesh) { active.releaseMesh(mesh) },
    dispose() {
      if (disposed) return
      disposed = true
      active.dispose()
    }
  }
}

export const spriteDirections = ['front', 'front-right', 'right', 'back-right', 'back', 'back-left', 'left', 'front-left'] as const

/** Draw a transparent, depth-tested still at the supplied camera, including offscreen authoring passes. */
export function renderMeshFrame(canvas: HTMLCanvasElement, camera: Matrix, batches: readonly InstanceBatch[], lighting?: LightingOptions) {
  const renderer = canvasMeshes(canvas, packLighting(lighting), { transparent: true, depthTest: true })
  try { renderer.draw(camera, defaultClear, batches, { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }) }
  finally { renderer.dispose() }
}

/** Render a single transparent, depth-tested RGBA frame without a DOM canvas. */
export function renderMeshPixels(camera: Matrix, batches: readonly InstanceBatch[], size: number, lighting?: LightingOptions) {
  if (!Number.isInteger(size) || size < 1 || size > 2048) throw new RangeError('Render size must be 1–2048 pixels')
  return meshViewPixels([camera], batches, size, packLighting(lighting))
}

type SpriteCamera = { span: number; center?: Vec3; frameSize?: number; elevation?: number; lighting?: LightingOptions }

/** Bake the same eight mesh views on the server or in the browser, without a canvas. */
export function bakeSpritePixels(batches: readonly InstanceBatch[], {
  span, center = [0, 0, 0], frameSize = 64, elevation = Math.PI / 6, lighting
}: SpriteCamera) {
  if (!Number.isInteger(frameSize) || frameSize < 1 || frameSize > 1024) throw new RangeError('Frame size must be 1–1024 pixels')
  if (!(Number.isFinite(span) && span > 0 && center.every(Number.isFinite) && Math.abs(elevation) < Math.PI / 2)) {
    throw new RangeError('Invalid sprite camera framing')
  }
  const projection = orthographic(span, span, span / 100, span * 8)
  const radius = span * 4
  const horizontal = radius * Math.cos(elevation)
  const cameras = spriteDirections.map((_, column) => {
    const angle = column * 2 * Math.PI / spriteDirections.length
    return multiply(projection, view([center[0] + horizontal * Math.sin(angle), center[1] + radius * Math.sin(elevation),
      center[2] + horizontal * Math.cos(angle)], center))
  })
  return meshViewPixels(cameras, batches, frameSize, packLighting(lighting))
}

/** Bake eight camera views of a +Z-facing model into one transparent horizontal sprite sheet. */
export function bakeSpriteDirections(batches: readonly InstanceBatch[], { src = 'sprite.png', ...camera }: SpriteCamera & { src?: string }) {
  const { width, height: frameSize, pixels } = bakeSpritePixels(batches, camera)
  const image = document.createElement('canvas')
  image.width = width
  image.height = frameSize
  const context = image.getContext('2d')
  if (!context) throw new Error('Could not create the sprite sheet')
  context.putImageData(new ImageData(pixels, width, frameSize), 0, 0)
  const clips: Record<string, SpriteClip> = { turntable: { column: 0, frames: spriteDirections.length, frameMs: 150 } }
  spriteDirections.forEach((name, column) => { clips[name] = { column, frames: 1, frameMs: 150 } })
  return { image, manifest: { src, frameWidth: frameSize, frameHeight: frameSize, clips } }
}
