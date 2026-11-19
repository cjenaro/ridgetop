import type { Backend, Color, InstanceBatch, LowPolyRenderer, MeshBackend, Vec3 } from './types.ts'

type Lighting = { direction?: Vec3; ambient?: number }
import { canvasMeshes } from './mesh-canvas.ts'
import { glMeshes } from './mesh-gl.ts'
import { gpuMeshes } from './mesh-gpu.ts'
import { frustum, visible } from './instances.ts'

export { mesh, box, cylinder, octahedron, view, perspective, orthographic, multiply } from './geometry.ts'
export { instances } from './instances.ts'
export { color } from './renderer.ts'

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
  { backend = 'auto', pixelRatio = 2, lighting }: { backend?: Backend; pixelRatio?: number; lighting?: Lighting } = {}
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
      if (!active) active = canvasMeshes(canvas, light)
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
  if (!active) active = canvasMeshes(canvas, light)
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
