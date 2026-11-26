import { createAlphaSorter } from './geometry.ts'
import { INSTANCE_SIZE } from './instances.ts'
import {
  createCameraTracker, createShadowCasterTracker, forEachOrderedBatch, glShadowParams,
  normalizeLighting, packMeshVertices, resolveBatchUpload, SHADOW_MAP_SIZE
} from './renderer.ts'
import type { BatchUploadState } from './renderer.ts'
import type { BlendMode, InstanceBatch, LightingInput, Matrix, Mesh, MeshBackend } from './types.ts'

const shadowVertexSource = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=6) in vec3 vtxColor;
layout(location=2) in vec4 origin;
layout(location=3) in vec4 scale;
layout(location=4) in vec4 tint;
layout(location=5) in vec4 rotation;
uniform mat4 lightMatrix;
vec3 rotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
void main() {
  if (tint.a > 0.65) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 world = origin.xyz + rotate(rotation, position * scale.xyz);
  vec4 clip = lightMatrix * vec4(world, 1.0);
  gl_Position = vec4(clip.xy, clip.z * 2.0 - clip.w, clip.w);
}`

const shadowFragmentSource = `#version 300 es
precision highp float;
void main() {}`

const vertexSource = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=6) in vec3 vtxColor;
layout(location=2) in vec4 origin;
layout(location=3) in vec4 scale;
layout(location=4) in vec4 tint;
layout(location=5) in vec4 rotation;
uniform mat4 camera;
uniform vec4 sunDir;
uniform vec4 sunColor;
uniform vec4 fog;
uniform vec4 fogExtra;
uniform vec4 pointPos[4];
uniform vec4 pointCol[4];
uniform vec4 skyHemi;
uniform vec4 groundToon;
uniform vec4 rimLight;
uniform vec4 shadowParams;
out vec4 vColor;
out float vFogT;
out vec3 vWorldPos;
flat out float vShadowRecv;
vec3 rotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
void main() {
  vec3 world = origin.xyz + rotate(rotation, position * scale.xyz);
  vec3 rotated = normalize(rotate(rotation, normal / scale.xyz));
  float rawNdotL = dot(rotated, sunDir.xyz);
  float diff = max(0.0, rawNdotL);
  if (groundToon.w >= 2.0) {
    float steps = groundToon.w;
    diff = floor(diff * steps + 0.5) / steps;
  }
  vec3 lit;
  if (skyHemi.w > 0.5) {
    vec3 hemi = mix(groundToon.rgb, skyHemi.rgb, rotated.y * 0.5 + 0.5);
    lit = hemi * (sunDir.w * 1.25) + sunColor.rgb * ((1.0 - sunDir.w * 0.85) * diff);
  } else {
    float sunShade = sunDir.w + (1.0 - sunDir.w) * diff;
    lit = sunColor.rgb * sunShade;
  }
  if (rimLight.w > 0.0) {
    vec3 viewAxis = normalize(vec3(camera[0][2], camera[1][2], camera[2][2]));
    float fres = 1.0 - abs(dot(rotated, viewAxis));
    float upMask = 0.45 + 0.55 * max(0.0, rotated.y);
    lit += rimLight.rgb * (rimLight.w * fres * fres * upMask);
  }
  int count = int(sunColor.w + 0.5);
  for (int i = 0; i < 4; i++) {
    if (i >= count) break;
    vec3 toLight = pointPos[i].xyz - world;
    float distSq = dot(toLight, toLight);
    float atten = max(0.0, 1.0 - distSq * pointPos[i].w);
    if (atten > 0.0) {
      vec3 ldir = toLight * inversesqrt(max(distSq, 1e-5));
      float ndotl = max(0.25, dot(rotated, ldir));
      lit += pointCol[i].rgb * (pointCol[i].w * atten * atten * ndotl);
    }
  }
  vec3 albedo = tint.rgb * vtxColor;
  vec3 shaded = min(vec3(1.0), albedo * mix(lit, vec3(1.0), tint.a));
  vec4 clip = camera * vec4(world, 1.0);
  vColor = vec4(shaded, origin.w);
  vFogT = fogExtra.x > 0.0 ? clamp((clip.w - fog.w) * fogExtra.x, 0.0, 1.0) : 0.0;
  vWorldPos = world;
  vShadowRecv = shadowParams.x > 0.5 ? max(0.0, 1.0 - tint.a) * smoothstep(0.02, 0.22, rawNdotL) : 0.0;
  gl_Position = vec4(clip.xy, clip.z * 2.0 - clip.w, clip.w);
}`

const fragmentSource = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
uniform vec4 fog;
uniform int blendMode;
uniform mat4 lightMatrix;
uniform vec4 shadowParams;
uniform vec4 shadowColor;
uniform sampler2DShadow shadowMap;
in vec4 vColor;
in float vFogT;
in vec3 vWorldPos;
flat in float vShadowRecv;
out vec4 pixel;
void main() {
  if (blendMode == 2) {
    pixel = vec4(vColor.rgb * (1.0 - vFogT * 0.65), vColor.a);
  } else {
    vec3 baseRgb = vColor.rgb;
    if (blendMode == 0 && vShadowRecv > 0.001) {
      vec4 sc = lightMatrix * vec4(vWorldPos, 1.0);
      vec2 uv = sc.xy * 0.5 + 0.5;
      float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      if (edge > 0.0 && sc.z > 0.0 && sc.z < 1.0) {
        float depth = clamp(sc.z - shadowParams.y, 0.0, 1.0);
        float texel = 1.25 / ${SHADOW_MAP_SIZE}.0;
        float s0 = texture(shadowMap, vec3(clamp(uv + vec2(-texel, -texel), vec2(0.001), vec2(0.999)), depth));
        float s1 = texture(shadowMap, vec3(clamp(uv + vec2( texel, -texel), vec2(0.001), vec2(0.999)), depth));
        float s2 = texture(shadowMap, vec3(clamp(uv + vec2(-texel,  texel), vec2(0.001), vec2(0.999)), depth));
        float s3 = texture(shadowMap, vec3(clamp(uv + vec2( texel,  texel), vec2(0.001), vec2(0.999)), depth));
        float fade = smoothstep(0.0, 0.06, edge);
        float sh = (1.0 - (s0 + s1 + s2 + s3) * 0.25) * fade * vShadowRecv * shadowParams.z;
        baseRgb = mix(baseRgb, baseRgb * shadowColor.rgb, sh);
      }
    }
    vec3 rgb = mix(baseRgb, fog.rgb, vFogT);
    pixel = vec4(rgb, blendMode == 0 ? 1.0 : vColor.a);
  }
}`

function compileProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const program = gl.createProgram()
  if (!program) throw new Error('Could not create WebGL program')
  for (const [type, source] of [[gl.VERTEX_SHADER, vsSrc], [gl.FRAGMENT_SHADER, fsSrc]] as const) {
    const shader = gl.createShader(type)
    if (!shader) {
      gl.deleteProgram(program)
      throw new Error('Could not create WebGL shader')
    }
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) ?? 'WebGL shader compilation failed'
      gl.deleteShader(shader)
      gl.deleteProgram(program)
      throw new Error(message)
    }
    gl.attachShader(program, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? 'WebGL program link failed'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

export function glMeshes(canvas: HTMLCanvasElement, initialLight: LightingInput): MeshBackend | null {
  const rawGl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
  if (!rawGl) return null
  const gl: WebGL2RenderingContext = rawGl
  const program = compileProgram(gl, vertexSource, fragmentSource)
  const hasShadowApi = typeof gl.createFramebuffer === 'function' && typeof gl.createTexture === 'function' &&
    gl.DEPTH_COMPONENT24 !== undefined && gl.TEXTURE_COMPARE_MODE !== undefined
  const shadowProgram = hasShadowApi ? compileProgram(gl, shadowVertexSource, shadowFragmentSource) : null

  gl.useProgram(program)
  gl.enable(gl.DEPTH_TEST)
  gl.enable(gl.CULL_FACE)
  const camera = gl.getUniformLocation(program, 'camera')
  const sunDirLoc = gl.getUniformLocation(program, 'sunDir')
  const sunColorLoc = gl.getUniformLocation(program, 'sunColor')
  const fogLoc = gl.getUniformLocation(program, 'fog')
  const fogExtraLoc = gl.getUniformLocation(program, 'fogExtra')
  const pointPosLoc = gl.getUniformLocation(program, 'pointPos')
  const pointColLoc = gl.getUniformLocation(program, 'pointCol')
  const skyHemiLoc = gl.getUniformLocation(program, 'skyHemi')
  const groundToonLoc = gl.getUniformLocation(program, 'groundToon')
  const rimLightLoc = gl.getUniformLocation(program, 'rimLight')
  const shadowParamsLoc = gl.getUniformLocation(program, 'shadowParams')
  const shadowColorLoc = gl.getUniformLocation(program, 'shadowColor')
  const lightMatrixLoc = gl.getUniformLocation(program, 'lightMatrix')
  const shadowMapLoc = gl.getUniformLocation(program, 'shadowMap')
  const blendModeLoc = gl.getUniformLocation(program, 'blendMode')
  const shadowPassLightLoc = shadowProgram ? gl.getUniformLocation(shadowProgram, 'lightMatrix') : null

  let shadowFbo: WebGLFramebuffer | null = null
  let shadowTex: WebGLTexture | null = null
  let shadowTexSize = 0
  let shadowsEnabled = false
  const shadowParamsScratch = new Float32Array(4)
  let lighting = normalizeLighting(initialLight)
  const shadowTracker = createShadowCasterTracker()

  function ensureShadowResources(size: number) {
    if (!hasShadowApi || shadowTexSize >= size) return
    if (shadowTex) gl.deleteTexture(shadowTex)
    if (shadowFbo) gl.deleteFramebuffer(shadowFbo)
    shadowTex = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, shadowTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL)
    shadowFbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0)
    gl.drawBuffers([gl.NONE])
    gl.readBuffer(gl.NONE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    shadowTexSize = size
    gl.useProgram(program)
    if (shadowMapLoc) gl.uniform1i(shadowMapLoc, 0)
  }

  function uploadLighting(next: LightingInput) {
    lighting = normalizeLighting(next)
    shadowsEnabled = hasShadowApi && lighting.shadowsEnabled
    shadowTracker.markDirty()
    if (shadowsEnabled) {
      ensureShadowResources(SHADOW_MAP_SIZE)
    } else if (hasShadowApi && shadowTexSize === 0) {
      ensureShadowResources(1)
    }
    gl.useProgram(program)
    const v = lighting.views
    gl.uniform4fv(sunDirLoc, v.sunDir)
    gl.uniform4fv(sunColorLoc, v.sunColor)
    gl.uniform4fv(fogLoc, v.fog)
    gl.uniform4fv(fogExtraLoc, v.fogExtra)
    gl.uniform4fv(pointPosLoc, v.pointPos)
    gl.uniform4fv(pointColLoc, v.pointCol)
    gl.uniform4fv(skyHemiLoc, v.skyHemi)
    gl.uniform4fv(groundToonLoc, v.groundToon)
    gl.uniform4fv(rimLightLoc, v.rimLight)
    gl.uniform4fv(shadowParamsLoc, glShadowParams(lighting, hasShadowApi, shadowParamsScratch))
    gl.uniform4fv(shadowColorLoc, v.shadowColor)
    gl.uniformMatrix4fv(lightMatrixLoc, false, lighting.lightMatrix)
  }
  uploadLighting(lighting)

  const meshes = new Map<Mesh, WebGLBuffer>()
  const batches = new Map<InstanceBatch, BatchUploadState & {
    vao: WebGLVertexArrayObject
    buffer: WebGLBuffer
    capacity: number
  }>()
  let batchSorter: ReturnType<typeof createAlphaSorter> | undefined
  const getBatchSorter = () => (batchSorter ??= createAlphaSorter(16))
  const instanceSorter = createAlphaSorter(32)
  const hasPolygonOffset = typeof gl.polygonOffset === 'function' && gl.POLYGON_OFFSET_FILL !== undefined
  const cameraTracker = createCameraTracker()
  let lastWidth = -1
  let lastHeight = -1
  let lostHandler: ((event: Event) => void) | undefined
  const lost = new Promise<void>(resolve => {
    lostHandler = (event: Event) => {
      event.preventDefault()
      resolve()
    }
    canvas.addEventListener('webglcontextlost', lostHandler, { once: true })
  })

  function release(batch: InstanceBatch) {
    const entry = batches.get(batch)
    if (!entry) return
    gl.deleteVertexArray(entry.vao)
    gl.deleteBuffer(entry.buffer)
    batches.delete(batch)
  }

  function prepareBatch(batch: InstanceBatch, matrix: Matrix, blend: BlendMode, stats: { uploadBytes: number }) {
    let entry = batches.get(batch)
    if (!entry) {
      entry = { vao: gl.createVertexArray(), buffer: gl.createBuffer(), revision: -1, capacity: 0 }
      gl.bindVertexArray(entry.vao)
      let vertices = meshes.get(batch.mesh)
      if (!vertices) {
        vertices = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
        gl.bufferData(gl.ARRAY_BUFFER, packMeshVertices(batch.mesh), gl.STATIC_DRAW)
        meshes.set(batch.mesh, vertices)
      } else gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0)
      gl.enableVertexAttribArray(1)
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12)
      gl.enableVertexAttribArray(6)
      gl.vertexAttribPointer(6, 3, gl.FLOAT, false, 36, 24)
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer)
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(i + 2)
        gl.vertexAttribPointer(i + 2, 4, gl.FLOAT, false, INSTANCE_SIZE * 4, i * 16)
        gl.vertexAttribDivisor(i + 2, 1)
      }
      batches.set(batch, entry)
    } else gl.bindVertexArray(entry.vao)

    const uploadData = resolveBatchUpload(entry, batch, blend, matrix, cameraTracker.revision, instanceSorter)
    if (uploadData) {
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer)
      if (entry.capacity < batch.data.byteLength) {
        gl.bufferData(gl.ARRAY_BUFFER, batch.data.byteLength, gl.DYNAMIC_DRAW)
        entry.capacity = batch.data.byteLength
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, uploadData, 0, batch.count * INSTANCE_SIZE)
      stats.uploadBytes += batch.count * INSTANCE_SIZE * 4
    }
    return entry
  }

  let gpuInfo = 'WebGL 2'
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const rawRenderer: unknown = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER)
    if (typeof rawRenderer === 'string' && rawRenderer.trim()) {
      gpuInfo = rawRenderer.trim().slice(0, 80)
    }
  } catch {
    // Ignore restricted renderer queries
  }

  return {
    name: 'WebGL 2',
    gpuInfo,
    lost,
    maxDimension: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    setLighting: uploadLighting,
    draw(matrix, clear, visible, stats, shadowCasters, alphaBatchesSorted) {
      const cameraChanged = cameraTracker.update(matrix)

      // Tier 2 Directional Shadow Pass (cached until light or caster batch revisions change)
      if (shadowsEnabled && shadowProgram && shadowFbo) {
        const casters = shadowCasters ?? visible
        if (shadowTracker.needsUpdate(casters)) {
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, null)
          gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo)
          gl.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
          gl.depthMask(true)
          gl.disable(gl.BLEND)
          if (hasPolygonOffset) {
            gl.enable(gl.POLYGON_OFFSET_FILL)
            gl.polygonOffset(2, 2)
          }
          gl.clear(gl.DEPTH_BUFFER_BIT)
          gl.useProgram(shadowProgram)
          gl.uniformMatrix4fv(shadowPassLightLoc, false, lighting.lightMatrix)
          for (let i = 0; i < casters.length; i++) {
            const batch = casters[i]
            if ((batch.blend ?? 'opaque') !== 'opaque' || !batch.count) continue
            prepareBatch(batch, matrix, 'opaque', stats)
            gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.mesh.vertexCount, batch.count)
          }
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          if (hasPolygonOffset) gl.disable(gl.POLYGON_OFFSET_FILL)
          gl.useProgram(program)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, shadowTex)
          lastWidth = -1
          shadowTracker.commit(casters)
        }
      }

      if (canvas.width !== lastWidth || canvas.height !== lastHeight) {
        gl.viewport(0, 0, canvas.width, canvas.height)
        lastWidth = canvas.width
        lastHeight = canvas.height
      }
      gl.depthMask(true)
      gl.disable(gl.BLEND)
      if (hasPolygonOffset) gl.disable(gl.POLYGON_OFFSET_FILL)
      gl.clearColor(clear[0], clear[1], clear[2], clear[3])
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      if (cameraChanged) {
        gl.uniformMatrix4fv(camera, false, matrix)
      }
      let activeBlend: BlendMode = 'opaque'
      gl.uniform1i(blendModeLoc, 0)
      const drawBatch = (batch: InstanceBatch) => {
        const blend: BlendMode = batch.blend ?? 'opaque'
        if (blend !== activeBlend) {
          activeBlend = blend
          if (blend === 'opaque') {
            gl.disable(gl.BLEND)
            if (hasPolygonOffset) gl.disable(gl.POLYGON_OFFSET_FILL)
            gl.depthMask(true)
            gl.uniform1i(blendModeLoc, 0)
          } else if (blend === 'alpha') {
            gl.enable(gl.BLEND)
            if (hasPolygonOffset) {
              gl.enable(gl.POLYGON_OFFSET_FILL)
              gl.polygonOffset(-1, -1)
            }
            gl.depthMask(false)
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
            gl.uniform1i(blendModeLoc, 1)
          } else {
            gl.enable(gl.BLEND)
            if (hasPolygonOffset) gl.disable(gl.POLYGON_OFFSET_FILL)
            gl.depthMask(false)
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
            gl.uniform1i(blendModeLoc, 2)
          }
        }
        prepareBatch(batch, matrix, blend, stats)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.mesh.vertexCount, batch.count)
      }
      forEachOrderedBatch(matrix, visible, alphaBatchesSorted === true, getBatchSorter, drawBatch)
      if (activeBlend !== 'opaque') {
        gl.disable(gl.BLEND)
        if (hasPolygonOffset) gl.disable(gl.POLYGON_OFFSET_FILL)
        gl.depthMask(true)
      }
      gl.bindVertexArray(null)
    },
    release,
    releaseMesh(mesh) {
      for (const batch of batches.keys()) if (batch.mesh === mesh) release(batch)
      const buffer = meshes.get(mesh)
      if (buffer) gl.deleteBuffer(buffer)
      meshes.delete(mesh)
    },
    dispose() {
      if (lostHandler) canvas.removeEventListener('webglcontextlost', lostHandler)
      for (const batch of batches.keys()) release(batch)
      for (const buffer of meshes.values()) gl.deleteBuffer(buffer)
      meshes.clear()
      if (shadowTex) gl.deleteTexture(shadowTex)
      if (shadowFbo) gl.deleteFramebuffer(shadowFbo)
      if (shadowProgram) gl.deleteProgram(shadowProgram)
      gl.deleteProgram(program)
    }
  }
}
