import type { Backend, Color, InstanceBatch, LowPolyRenderer, Matrix, MeshBackend, Vec3 } from './types.ts'
import type { SpriteClip } from './sprites.ts'
import { multiply, orthographic, view } from './geometry.ts'
import { canvasMeshes } from './mesh-canvas.ts'
import { glMeshes } from './mesh-gl.ts'
import { gpuMeshes } from './mesh-gpu.ts'
import { frustum, visible } from './instances.ts'

export { mesh, box, cylinder, octahedron, view, perspective, orthographic, multiply } from './geometry.ts'
export { instances } from './instances.ts'
export { color } from './renderer.ts'

type Lighting = { direction?: Vec3; ambient?: number }

const defaultClear: Color = [0.05, 0.08, 0.12, 1]

function packLighting({ direction = [-.48, .8, .36], ambient = .52 }: Lighting = {}) {
  const [x, y, z] = direction
  const length = Math.hypot(x, y, z)
  if (!length || !Number.isFinite(length) || !(ambient >= 0 && ambient <= 1)) {
    throw new RangeError('Expected a nonzero light direction and ambient in the range 0–1')
  }
  return new Float32Array([x / length, y / length, z / length, ambient])
}

export async function createLowPolyRenderer(canvas: HTMLCanvasElement,
  { backend = 'auto', pixelRatio = 2, lighting, canvasDepth = false }:
  { backend?: Backend; pixelRatio?: number; lighting?: Lighting; canvasDepth?: boolean } = {}
): Promise<LowPolyRenderer> {
  if (!['auto', 'webgpu', 'webgl2', 'canvas'].includes(backend)) throw new RangeError('Unknown rendering backend')
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new RangeError('Invalid maximum pixel ratio')
  const light = packLighting(lighting)
  let active: MeshBackend
  let disposed = false
  const selected: InstanceBatch[] = []
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
      stats.triangles = stats.instances = stats.uploadBytes = stats.culledBatches = 0
      for (const batch of batches) {
        if (visible(batch, planes)) {
          selected.push(batch)
          stats.triangles += batch.mesh.vertexCount / 3 * batch.count
          stats.instances += batch.count
        } else if (batch.count) stats.culledBatches++
      }
      stats.drawCalls = selected.length
      active.draw(matrix, clear, selected, stats)
      return stats
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
export function renderMeshFrame(canvas: HTMLCanvasElement, camera: Matrix, batches: readonly InstanceBatch[], lighting?: Lighting) {
  const renderer = canvasMeshes(canvas, packLighting(lighting), { transparent: true, depthTest: true })
  try { renderer.draw(camera, defaultClear, batches, { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }) }
  finally { renderer.dispose() }
}

/** Bake eight camera views of a +Z-facing model into one transparent horizontal sprite sheet. */
export function bakeSpriteDirections(batches: readonly InstanceBatch[], {
  span, center = [0, 0, 0], frameSize = 64, elevation = Math.PI / 6, src = 'sprite.png', lighting
}: { span: number; center?: Vec3; frameSize?: number; elevation?: number; src?: string; lighting?: Lighting }) {
  if (!Number.isInteger(frameSize) || frameSize < 1 || frameSize > 1024) throw new RangeError('Frame size must be 1–1024 pixels')
  if (!(Number.isFinite(span) && span > 0 && center.every(Number.isFinite) && Math.abs(elevation) < Math.PI / 2)) {
    throw new RangeError('Invalid sprite camera framing')
  }
  const frame = document.createElement('canvas')
  frame.width = frame.height = frameSize
  const image = document.createElement('canvas')
  image.width = spriteDirections.length * frameSize
  image.height = frameSize
  const context = image.getContext('2d')
  if (!context) throw new Error('Could not create the sprite sheet')
  const renderer = canvasMeshes(frame, packLighting(lighting), { transparent: true, depthTest: true })
  const projection = orthographic(span, span, span / 100, span * 8)
  const radius = span * 4
  const horizontal = radius * Math.cos(elevation)
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }
  const clips: Record<string, SpriteClip> = { turntable: { column: 0, frames: spriteDirections.length, frameMs: 150 } }
  try {
    for (const [column, name] of spriteDirections.entries()) {
      const angle = column * 2 * Math.PI / spriteDirections.length
      const camera = view([center[0] + horizontal * Math.sin(angle), center[1] + radius * Math.sin(elevation),
        center[2] + horizontal * Math.cos(angle)], center)
      renderer.draw(multiply(projection, camera), defaultClear, batches, stats)
      context.drawImage(frame, frameSize * column, 0)
      clips[name] = { column, frames: 1, frameMs: 150 }
    }
  } finally { renderer.dispose() }
  return { image, manifest: { src, frameWidth: frameSize, frameHeight: frameSize, clips } }
}
