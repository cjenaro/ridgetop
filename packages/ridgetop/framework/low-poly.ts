import type {
  Backend, Color, InstanceBatch, LightingOptions, LowPolyRenderer, Matrix, MeshBackend,
  ProjectedShadowOptions, ShadowBatch, ShadowBatchOptions, ShadowCasterOptions,
  ShadowProjection, Vec3
} from './types.ts'
import type { SpriteClip } from './sprites.ts'
import { createTurntableCameras, normalTiltQuaternion, projectShadow, shadowDisc } from './geometry.ts'
import { canvasMeshes, meshViewPixels } from './mesh-canvas.ts'
import { glMeshes } from './mesh-gl.ts'
import { gpuMeshes } from './mesh-gpu.ts'
import { instances } from './instances.ts'
import { createFramePreparer, createLightingState, prepareLighting } from './renderer.ts'
import { canvasFromRgbaPixels, outlinePixelRegion, parseHexRgba } from './sprite-sheet.ts'
import type { SpriteOutlineMode, SpriteOutlineOptions } from './sprite-sheet.ts'
import { isTestingActive, recordFrame } from './testing-runtime.ts'

export {
  mesh, box, cylinder, octahedron, shadowDisc, view, perspective, orthographic, multiply,
  cameraDepth, projectShadow, projectShadowMesh
} from './geometry.ts'
export { instances } from './instances.ts'
export { color, computeShadowMatrix, LIGHT_FLOATS, packLighting } from './renderer.ts'

const defaultClear: Color = [0.05, 0.08, 0.12, 1]

export async function createLowPolyRenderer(canvas: HTMLCanvasElement,
  { backend = 'auto', pixelRatio = 2, lighting, canvasDepth = false }:
  { backend?: Backend; pixelRatio?: number; lighting?: LightingOptions; canvasDepth?: boolean } = {}
): Promise<LowPolyRenderer> {
  if (!['auto', 'webgpu', 'webgl2', 'canvas'].includes(backend)) throw new RangeError('Unknown rendering backend')
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new RangeError('Invalid maximum pixel ratio')
  const lightingState = createLightingState(lighting)
  let initial: MeshBackend | null = null
  let disposed = false
  const framePreparer = createFramePreparer()
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }

  function replaceCanvas() {
    const next = canvas.cloneNode()
    if (!(next instanceof HTMLCanvasElement)) throw new Error('Could not clone canvas element')
    canvas.replaceWith(next)
    canvas = next
  }

  if (backend === 'auto' || backend === 'webgpu') {
    try { initial = await gpuMeshes(canvas, lightingState, { allowFallback: backend === 'webgpu' }) }
    catch (error) {
      if (backend === 'webgpu') throw error
      console.warn('WebGPU initialization failed', error)
      replaceCanvas()
    }
    if (!initial && backend === 'webgpu') throw new Error('WebGPU is unavailable')
  }
  if (!initial && (backend === 'auto' || backend === 'webgl2')) {
    try { initial = glMeshes(canvas, lightingState) }
    catch (error) {
      if (backend === 'webgl2') throw error
      replaceCanvas()
    }
    if (!initial && backend === 'webgl2') throw new Error('WebGL 2 is unavailable')
  }
  let active: MeshBackend = initial ?? canvasMeshes(canvas, lightingState, { depthTest: canvasDepth })

  function watch(current: MeshBackend) {
    current.lost?.then(() => {
      if (disposed || active !== current) return
      current.dispose()
      replaceCanvas()
      let next: MeshBackend | null = null
      if (current.name === 'WebGPU') {
        try { next = glMeshes(canvas, lightingState) }
        catch { replaceCanvas() }
      }
      active = next ?? canvasMeshes(canvas, lightingState, { depthTest: canvasDepth })
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
      const useShadows = lightingState.shadowsEnabled && active.name !== 'Canvas 2D'
      const frame = framePreparer.prepare(matrix, batches, lightingState, useShadows, stats)
      active.draw(matrix, clear, frame.visible, stats, frame.shadowCasters, true)
      if (isTestingActive()) {
        recordFrame({
          canvas,
          viewProjection: new Float32Array(matrix),
          batches: frame.visible.slice(),
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
      lightingState.update(next)
      active.setLighting?.(lightingState)
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
  const renderer = canvasMeshes(canvas, prepareLighting(lighting), { transparent: true, depthTest: true })
  try { renderer.draw(camera, defaultClear, batches, { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }) }
  finally { renderer.dispose() }
}

/** Render a single transparent, depth-tested RGBA frame without a DOM canvas. */
export function renderMeshPixels(camera: Matrix, batches: readonly InstanceBatch[], size: number, lighting?: LightingOptions) {
  if (!Number.isInteger(size) || size < 1 || size > 2048) throw new RangeError('Render size must be 1–2048 pixels')
  return meshViewPixels([camera], batches, size, prepareLighting(lighting))
}

const SPRITE_DIRECTION_ANGLES: readonly number[] = spriteDirections.map(
  (_, column) => (column * 2 * Math.PI) / spriteDirections.length
)

type SpriteCamera = { span: number; center?: Vec3; frameSize?: number; elevation?: number; lighting?: LightingOptions; outline?: string }

export function applySpriteOutline(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  frameSize: number,
  outline: string,
  modeOrOptions?: SpriteOutlineMode | SpriteOutlineOptions
) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0 ||
      !Number.isInteger(frameSize) || frameSize <= 0 || pixels.length < width * height * 4) {
    throw new RangeError('applySpriteOutline requires positive integer dimensions matching the pixel buffer')
  }
  if (typeof outline !== 'string' || !outline) {
    throw new RangeError('Expected outline to be "selout" or a 6- or 8-digit hex color')
  }
  const cols = Math.floor(width / frameSize), rows = Math.floor(height / frameSize)
  const opts: SpriteOutlineOptions = typeof modeOrOptions === 'object' && modeOrOptions !== null
    ? { emptyAlphaThreshold: 16, ...modeOrOptions }
    : { mode: modeOrOptions, emptyAlphaThreshold: 16 }
  if (!cols || !rows) {
    if (outline !== 'selout') parseHexRgba(outline)
    return
  }
  const scratch = new Uint8ClampedArray(frameSize * frameSize * 4)
  for (let cr = 0; cr < rows; cr++) {
    for (let cc = 0; cc < cols; cc++) {
      outlinePixelRegion(pixels, width, cc * frameSize, cr * frameSize, frameSize, frameSize, outline, opts, scratch)
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
  const cameras = createTurntableCameras(span, center, SPRITE_DIRECTION_ANGLES, elevation)
  const out = meshViewPixels(cameras, batches, frameSize, prepareLighting(lighting))
  if (outline) applySpriteOutline(out.pixels, out.width, out.height, frameSize, outline)
  return out
}

/** Bake eight camera views of a +Z-facing model into one transparent horizontal sprite sheet. */
export function bakeSpriteDirections(batches: readonly InstanceBatch[], { src = 'sprite.png', ...camera }: SpriteCamera & { src?: string }) {
  const { width, height: frameSize, pixels } = bakeSpritePixels(batches, camera)
  const image = canvasFromRgbaPixels(pixels, width, frameSize, 'Could not create the sprite sheet')
  const clips: Record<string, SpriteClip> = { turntable: { column: 0, frames: spriteDirections.length, frameMs: 150 } }
  spriteDirections.forEach((name, column) => { clips[name] = { column, frames: 1, frameMs: 150 } })
  return { image, manifest: { src, frameWidth: frameSize, frameHeight: frameSize, clips } }
}
