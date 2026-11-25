import type {
  Backend, Color, InstanceBatch, LightingOptions, LowPolyRenderer, Matrix, MeshBackend,
  ProjectedShadowOptions, ShadowBatch, ShadowBatchOptions, ShadowCasterOptions,
  ShadowProjection, Vec3
} from './types.ts'
import type { SpriteClip } from './sprites.ts'
import { createAlphaSorter, multiply, normalTiltQuaternion, orthographic, projectShadow, shadowDisc, view } from './geometry.ts'
import { canvasMeshes, meshViewPixels } from './mesh-canvas.ts'
import { glMeshes } from './mesh-gl.ts'
import { gpuMeshes } from './mesh-gpu.ts'
import { frustum, instances, visible } from './instances.ts'
import { isTestingActive, recordFrame } from './testing-runtime.ts'

export {
  mesh, box, cylinder, octahedron, shadowDisc, view, perspective, orthographic, multiply,
  cameraDepth, projectShadow, projectShadowMesh
} from './geometry.ts'
export { instances } from './instances.ts'
export { color } from './renderer.ts'

export const LIGHT_FLOATS = 72
const defaultClear: Color = [0.05, 0.08, 0.12, 1]

export function packLighting(
  options: LightingOptions = {},
  prev?: Float32Array<ArrayBuffer>,
  dest?: Float32Array<ArrayBuffer>
): Float32Array<ArrayBuffer> {
  const out = dest && dest.length >= LIGHT_FLOATS ? dest : new Float32Array(LIGHT_FLOATS)
  if (prev && prev !== out) {
    out.fill(0)
    if (prev.length >= 48) out.set(prev.subarray(0, Math.min(prev.length, LIGHT_FLOATS)))
    else {
      out[0] = -.48; out[1] = .8; out[2] = .36; out[3] = .52
      out[4] = 1; out[5] = 1; out[6] = 1; out[7] = 0
    }
  } else if (!prev) {
    out.fill(0)
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
    const prevNear = out[11]
    const near = options.fogNear ?? prevNear
    const far = options.fogFar ?? (out[12] > 0 ? prevNear + 1 / out[12] : near)
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
  if (options.skyColor || options.groundColor) {
    const hadHemi = out[51] > 0
    const sky = options.skyColor ?? (hadHemi ? [out[48], out[49], out[50]] : [0.72, 0.84, 0.98])
    const ground = options.groundColor ?? (hadHemi ? [out[52], out[53], out[54]] : [0.36, 0.30, 0.28])
    out[48] = sky[0]; out[49] = sky[1]; out[50] = sky[2]; out[51] = 1
    out[52] = ground[0]; out[53] = ground[1]; out[54] = ground[2]
  }
  if (options.toonSteps !== undefined) {
    out[55] = Number.isFinite(options.toonSteps) && options.toonSteps >= 2 ? Math.floor(options.toonSteps) : 0
  }
  if (options.rimColor !== undefined) {
    out[56] = options.rimColor[0]; out[57] = options.rimColor[1]; out[58] = options.rimColor[2]
  }
  if (options.rimStrength !== undefined) {
    out[59] = Number.isFinite(options.rimStrength) ? Math.max(0, Math.min(1, options.rimStrength)) : 0
    if (out[59] > 0 && out[56] === 0 && out[57] === 0 && out[58] === 0) {
      out[56] = 1; out[57] = 1; out[58] = 1
    }
  }
  if (options.shadows !== undefined) {
    const sh = options.shadows
    const hadShadow = out[67] > 0.5
    const enabled = sh.enabled !== undefined ? (sh.enabled ? 1 : 0) : out[64]
    const prevExt = out[63] > 0 ? out[63] : 24
    out[60] = sh.center ? sh.center[0] : out[60]
    out[61] = sh.center ? sh.center[1] : out[61]
    out[62] = sh.center ? sh.center[2] : out[62]
    out[63] = sh.extent !== undefined && Number.isFinite(sh.extent) && sh.extent > 1 ? sh.extent : prevExt
    out[64] = enabled
    out[65] = sh.bias !== undefined && Number.isFinite(sh.bias) ? Math.max(0.0001, sh.bias) : (hadShadow ? out[65] : 0.0028)
    out[66] = sh.strength !== undefined && Number.isFinite(sh.strength) ? Math.max(0, Math.min(1, sh.strength)) : (hadShadow ? out[66] : 0.46)
    out[67] = 1
    if (sh.color) {
      out[68] = sh.color[0]; out[69] = sh.color[1]; out[70] = sh.color[2]; out[71] = 0
    } else if (!hadShadow) {
      out[68] = 0.22; out[69] = 0.28; out[70] = 0.42; out[71] = 0
    }
  }
  return out
}

/** Build an orthographic directional sun view-projection matrix for shadow mapping. */
export function computeShadowMatrix(light: Float32Array): Matrix {
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

export async function createLowPolyRenderer(canvas: HTMLCanvasElement,
  { backend = 'auto', pixelRatio = 2, lighting, canvasDepth = false }:
  { backend?: Backend; pixelRatio?: number; lighting?: LightingOptions; canvasDepth?: boolean } = {}
): Promise<LowPolyRenderer> {
  if (!['auto', 'webgpu', 'webgl2', 'canvas'].includes(backend)) throw new RangeError('Unknown rendering backend')
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new RangeError('Invalid maximum pixel ratio')
  const light = packLighting(lighting)
  let initial: MeshBackend | null = null
  let disposed = false
  const selected: InstanceBatch[] = []
  const alphaBatches: InstanceBatch[] = []
  const additiveBatches: InstanceBatch[] = []
  const shadowCasters: InstanceBatch[] = []
  const alphaSorter = createAlphaSorter(16)
  const planes = new Float32Array(24)
  const lightPlanes = new Float32Array(24)
  let lightPlanesDirty = true
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }

  function replaceCanvas() {
    const next = canvas.cloneNode()
    if (!(next instanceof HTMLCanvasElement)) throw new Error('Could not clone canvas element')
    canvas.replaceWith(next)
    canvas = next
  }

  if (backend === 'auto' || backend === 'webgpu') {
    try { initial = await gpuMeshes(canvas, light, { allowFallback: backend === 'webgpu' }) }
    catch (error) {
      if (backend === 'webgpu') throw error
      console.warn('WebGPU initialization failed', error)
      replaceCanvas()
    }
    if (!initial && backend === 'webgpu') throw new Error('WebGPU is unavailable')
  }
  if (!initial && (backend === 'auto' || backend === 'webgl2')) {
    try { initial = glMeshes(canvas, light) }
    catch (error) {
      if (backend === 'webgl2') throw error
      replaceCanvas()
    }
    if (!initial && backend === 'webgl2') throw new Error('WebGL 2 is unavailable')
  }
  let active: MeshBackend = initial ?? canvasMeshes(canvas, light, { depthTest: canvasDepth })

  function watch(current: MeshBackend) {
    current.lost?.then(() => {
      if (disposed || active !== current) return
      current.dispose()
      replaceCanvas()
      let next: MeshBackend | null = null
      if (current.name === 'WebGPU') {
        try { next = glMeshes(canvas, light) }
        catch { replaceCanvas() }
      }
      active = next ?? canvasMeshes(canvas, light, { depthTest: canvasDepth })
      watch(active)
    })
  }
  watch(active)

  return {
    get name() { return active.name },
    get gpuInfo() { return active.gpuInfo ?? active.name },
    get canvas() { return canvas },
    render(matrix, batches, clear = defaultClear) {
      if (disposed) throw new Error('The renderer has been disposed')
      const w = Math.max(1, canvas.clientWidth)
      const h = Math.max(1, canvas.clientHeight)
      const effectivePixelRatio = active.name === 'Canvas 2D' && canvasDepth ? Math.min(pixelRatio, 1) : pixelRatio
      const ratio = Math.min(globalThis.devicePixelRatio || 1, effectivePixelRatio, active.maxDimension / Math.max(w, h))
      const width = Math.max(1, Math.round(w * ratio))
      const height = Math.max(1, Math.round(h * ratio))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      frustum(matrix, planes)
      const useShadows = light[64] > 0.5 && active.name !== 'Canvas 2D'
      if (useShadows && lightPlanesDirty) {
        frustum(computeShadowMatrix(light), lightPlanes)
        lightPlanesDirty = false
      }
      selected.length = 0
      alphaBatches.length = 0
      additiveBatches.length = 0
      shadowCasters.length = 0
      stats.triangles = stats.instances = stats.uploadBytes = stats.culledBatches = 0
      for (const batch of batches) {
        if (visible(batch, planes)) {
          if (batch.blend === 'opaque') selected.push(batch)
          else if (batch.blend === 'alpha') alphaBatches.push(batch)
          else additiveBatches.push(batch)
          stats.triangles += batch.mesh.vertexCount / 3 * batch.count
          stats.instances += batch.count
        } else if (batch.count) stats.culledBatches++
        if (useShadows && batch.blend === 'opaque' && visible(batch, lightPlanes)) {
          shadowCasters.push(batch)
        }
      }
      if (alphaBatches.length > 1) {
        alphaSorter.sortBatches(matrix, alphaBatches, selected)
      } else if (alphaBatches.length === 1) {
        selected.push(alphaBatches[0])
      }
      for (let i = 0; i < additiveBatches.length; i++) selected.push(additiveBatches[i])
      stats.drawCalls = selected.length
      active.draw(matrix, clear, selected, stats, useShadows ? shadowCasters : undefined)
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
      packLighting(next, light, light)
      lightPlanesDirty = true
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

const defaultShadowColor: Vec3 = [0.04, 0.06, 0.1]
const defaultShadowDirection: Vec3 = [-0.48, 0.8, 0.36]

function isVec3Direction(lighting: Pick<LightingOptions, 'direction'> | Vec3): lighting is Vec3 {
  return Array.isArray(lighting)
}

/**
 * Create a reusable alpha-blended shadow batch that projects contact/blob shadows or pre-projected
 * mesh shadows onto horizontal ground planes across WebGPU, WebGL 2, and Canvas 2D without Z-fighting.
 */
export function createShadowBatch(options: ShadowBatchOptions = {}): ShadowBatch {
  const shadowMesh = options.mesh ?? shadowDisc(options.sides ?? 12)
  const batch = instances(shadowMesh, { capacity: options.capacity ?? 32, blend: 'alpha' })
  const lightDir: [number, number, number] = [defaultShadowDirection[0], defaultShadowDirection[1], defaultShadowDirection[2]]
  const baseColor: [number, number, number] = options.color
    ? [options.color[0], options.color[1], options.color[2]]
    : [defaultShadowColor[0], defaultShadowColor[1], defaultShadowColor[2]]

  const defaultGroundY = options.groundY ?? 0
  const defaultRadius = options.radius ?? 0.5
  const defaultOpacity = options.opacity ?? 0.38
  const defaultMaxHeight = options.maxHeight ?? 12
  const defaultMinScale = options.minScale ?? 0.55
  const defaultMaxStretch = options.maxStretch ?? 2.5
  const defaultMinLightY = Math.max(1e-3, options.minLightY ?? 0.25)
  const defaultOffsetScale = options.offsetScale ?? 1
  const defaultBias = options.bias ?? 0.015
  const defaultPenumbra = Math.max(0, options.penumbra ?? 0)
  const heightAt = options.heightAt
  const normalAt = options.normalAt

  function setDirection(dir?: Vec3) {
    if (!dir) return
    const len = Math.hypot(dir[0], dir[1], dir[2])
    if (!len || !Number.isFinite(len)) {
      lightDir[0] = 0; lightDir[1] = 1; lightDir[2] = 0
      return
    }
    lightDir[0] = dir[0] / len
    lightDir[1] = dir[1] / len
    lightDir[2] = dir[2] / len
  }
  if (options.direction) setDirection(options.direction)

  // Reusable scratch buffers so per-frame shadow submission allocates nothing.
  const projOut: ShadowProjection = {
    position: [0, 0, 0],
    scale: [1, 1, 1],
    yaw: 0,
    opacity: 0,
    visible: false
  }
  const projOpts: {
    groundY: number
    radius: number
    radiusZ: number
    direction: Vec3
    opacity: number
    maxHeight: number
    minScale: number
    maxStretch: number
    minLightY: number
    offsetScale: number
    bias: number
  } = {
    groundY: defaultGroundY,
    radius: defaultRadius,
    radiusZ: defaultRadius,
    direction: lightDir,
    opacity: defaultOpacity,
    maxHeight: defaultMaxHeight,
    minScale: defaultMinScale,
    maxStretch: defaultMaxStretch,
    minLightY: defaultMinLightY,
    offsetScale: defaultOffsetScale,
    bias: defaultBias
  }
  const posScratch: [number, number, number] = [0, 0, 0]
  const scaleScratch: [number, number, number] = [1, 1, 1]
  const colorScratch: [number, number, number, number] = [0, 0, 0, 1]

  return {
    batch,
    clear() {
      batch.clear()
    },
    setLighting(lighting) {
      if (isVec3Direction(lighting)) setDirection(lighting)
      else if (lighting && 'direction' in lighting && lighting.direction) setDirection(lighting.direction)
    },
    add(position: Vec3, caster?: ShadowCasterOptions) {
      const radius = caster?.radius ?? defaultRadius
      projOpts.groundY = caster?.groundY ?? (heightAt ? heightAt(position[0], position[2]) : defaultGroundY)
      projOpts.radius = radius
      projOpts.radiusZ = caster?.radiusZ ?? radius
      projOpts.opacity = caster?.opacity ?? defaultOpacity
      projOpts.maxHeight = caster?.maxHeight ?? defaultMaxHeight
      projOpts.minScale = caster?.minScale ?? defaultMinScale
      projOpts.maxStretch = caster?.maxStretch ?? (caster?.yaw !== undefined ? 1 : defaultMaxStretch)
      projOpts.offsetScale = caster?.offsetScale ?? defaultOffsetScale
      projOpts.bias = caster?.bias ?? defaultBias

      projectShadow(position, projOpts, projOut)
      if (!projOut.visible) return

      // Re-sample ground height & slope normal at the projected shadow footprint so shadows hug hillsides cleanly!
      if (heightAt && caster?.groundY === undefined) {
        projOut.position[1] = heightAt(projOut.position[0], projOut.position[2]) + projOpts.bias
      }
      const slopeNormal = caster?.groundNormal ?? (normalAt ? normalAt(projOut.position[0], projOut.position[2]) : undefined)
      const shadowYaw = caster?.yaw ?? projOut.yaw
      const rot: number | readonly [number, number, number, number] = slopeNormal
        ? normalTiltQuaternion(slopeNormal, shadowYaw)
        : shadowYaw
      let nux = 0, nuy = 1, nuz = 0
      if (slopeNormal) {
        const b = projOpts.bias
        const nl = Math.hypot(slopeNormal[0], slopeNormal[1], slopeNormal[2]) || 1
        nux = slopeNormal[0] / nl
        nuy = slopeNormal[1] / nl
        nuz = slopeNormal[2] / nl
        projOut.position[0] += nux * b * 0.65
        projOut.position[1] += (nuy - 1) * b * 0.35
        projOut.position[2] += nuz * b * 0.65
      }

      const rgb = caster?.color ?? baseColor
      const penumbra = caster?.penumbra ?? defaultPenumbra
      colorScratch[0] = rgb[0]
      colorScratch[1] = rgb[1]
      colorScratch[2] = rgb[2]

      if (penumbra > 0) {
        const outerExpand = 1 + penumbra
        scaleScratch[0] = projOut.scale[0] * outerExpand
        scaleScratch[1] = projOut.scale[1]
        scaleScratch[2] = projOut.scale[2] * outerExpand
        colorScratch[3] = projOut.opacity * 0.42
        batch.add(projOut.position, scaleScratch, rot, colorScratch, 1)

        posScratch[0] = projOut.position[0] + nux * 0.002
        posScratch[1] = projOut.position[1] + nuy * 0.002
        posScratch[2] = projOut.position[2] + nuz * 0.002
        colorScratch[3] = projOut.opacity * 0.68
        batch.add(posScratch, projOut.scale, rot, colorScratch, 1)
      } else {
        colorScratch[3] = projOut.opacity
        batch.add(projOut.position, projOut.scale, rot, colorScratch, 1)
      }
    },
    addProjected(position: Vec3, caster?: ProjectedShadowOptions) {
      const groundY = caster?.groundY ?? (heightAt ? heightAt(position[0], position[2]) : defaultGroundY)
      const maxHeight = caster?.maxHeight ?? defaultMaxHeight
      const rawAlt = position[1] - groundY
      if (!Number.isFinite(rawAlt) || rawAlt < -1e-3 || !(maxHeight > 0)) return
      const altitude = rawAlt > 0 ? rawAlt : 0
      const fade = 1 - Math.min(1, altitude / maxHeight)
      const baseOpacity = caster?.opacity ?? defaultOpacity
      const opacity = Math.max(0, Math.min(1, baseOpacity * fade))
      if (opacity <= 0.004) return

      const horiz = Math.hypot(lightDir[0], lightDir[2])
      const effLy = Math.max(lightDir[1], defaultMinLightY)
      const offsetScale = caster?.offsetScale ?? defaultOffsetScale
      const lateralFactor = (altitude * offsetScale) / effLy
      const bias = caster?.bias ?? defaultBias

      posScratch[0] = position[0] + (horiz > 1e-6 ? -lightDir[0] * lateralFactor : 0)
      posScratch[2] = position[2] + (horiz > 1e-6 ? -lightDir[2] * lateralFactor : 0)
      posScratch[1] = (heightAt && caster?.groundY === undefined ? heightAt(posScratch[0], posScratch[2]) : groundY) + bias
      const slopeNormal = normalAt ? normalAt(posScratch[0], posScratch[2]) : undefined
      const rot = slopeNormal && (caster?.rotation === undefined || typeof caster.rotation === 'number')
        ? normalTiltQuaternion(slopeNormal, caster?.rotation ?? 0)
        : (caster?.rotation ?? 0)

      const s = caster?.scale
      if (s) {
        scaleScratch[0] = s[0]
        scaleScratch[1] = s[1]
        scaleScratch[2] = s[2]
      } else {
        scaleScratch[0] = 1
        scaleScratch[1] = 1
        scaleScratch[2] = 1
      }
      const rgb = caster?.color ?? baseColor
      colorScratch[0] = rgb[0]
      colorScratch[1] = rgb[1]
      colorScratch[2] = rgb[2]
      colorScratch[3] = opacity
      batch.add(posScratch, scaleScratch, rot, colorScratch, 1)
    }
  }
}

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

type SpriteCamera = { span: number; center?: Vec3; frameSize?: number; elevation?: number; lighting?: LightingOptions; outline?: string }

export function applySpriteOutline(pixels: Uint8ClampedArray, width: number, height: number, frameSize: number, outline: string) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 ||
      !Number.isInteger(frameSize) || frameSize <= 0 || pixels.length < width * height * 4) {
    throw new RangeError('applySpriteOutline requires positive integer dimensions matching the pixel buffer')
  }
  if (typeof outline !== 'string') throw new RangeError('Expected outline to be "selout" or a 6-digit hex color')
  const isSelout = outline === 'selout'
  let fr = 20, fg = 28, fb = 42
  if (!isSelout) {
    const raw = outline.charCodeAt(0) === 35 ? outline.slice(1) : outline
    if (!/^[0-9a-f]{6}$/i.test(raw)) throw new RangeError(`Invalid sprite outline color: ${outline}`)
    const n = Number.parseInt(raw, 16)
    fr = (n >>> 16) & 255; fg = (n >>> 8) & 255; fb = n & 255
  }
  const cols = Math.floor(width / frameSize), rows = Math.floor(height / frameSize)
  const snap = new Uint8ClampedArray(pixels)
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const
  for (let cr = 0; cr < rows; cr++) {
    for (let cc = 0; cc < cols; cc++) {
      const x0 = cc * frameSize, y0 = cr * frameSize
      for (let py = 0; py < frameSize; py++) {
        for (let px = 0; px < frameSize; px++) {
          const di = ((y0 + py) * width + (x0 + px)) * 4
          if (snap[di + 3] > 16) continue
          let nr = 0, ng = 0, nb = 0, hits = 0, topLeft = 0
          for (const [ox, oy] of dirs) {
            const nx = px + ox, ny = py + oy
            if (nx < 0 || nx >= frameSize || ny < 0 || ny >= frameSize) continue
            const ni = ((y0 + ny) * width + (x0 + nx)) * 4
            if (snap[ni + 3] > 128) {
              nr += snap[ni]; ng += snap[ni + 1]; nb += snap[ni + 2]; hits++
              if (ox > 0 || oy > 0) topLeft++
            }
          }
          if (!hits) continue
          if (isSelout) {
            const scale = topLeft > 0 ? 0.44 : 0.24
            pixels[di] = Math.round((nr / hits) * scale + 10)
            pixels[di + 1] = Math.round((ng / hits) * scale + 14)
            pixels[di + 2] = Math.round((nb / hits) * scale + 24)
            pixels[di + 3] = 255
          } else {
            pixels[di] = fr; pixels[di + 1] = fg; pixels[di + 2] = fb; pixels[di + 3] = 255
          }
        }
      }
    }
  }
}

/** Bake the same eight mesh views on the server or in the browser, without a canvas. */
export function bakeSpritePixels(batches: readonly InstanceBatch[], {
  span, center = [0, 0, 0], frameSize = 64, elevation = Math.PI / 6, lighting, outline
}: SpriteCamera) {
  if (!Number.isInteger(frameSize) || frameSize < 1 || frameSize > 1024) throw new RangeError('Frame size must be 1–1024 pixels')
  if (!(Number.isFinite(span) && span > 0 && center.length === 3 &&
      Number.isFinite(center[0]) && Number.isFinite(center[1]) && Number.isFinite(center[2]) &&
      Math.abs(elevation) < Math.PI / 2)) {
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
  const out = meshViewPixels(cameras, batches, frameSize, packLighting(lighting))
  if (outline) applySpriteOutline(out.pixels, out.width, out.height, frameSize, outline)
  return out
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
