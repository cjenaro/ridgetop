import { createAlphaSorter, multiply, orthographic, view } from './geometry.ts'
import { INSTANCE_SIZE } from './instances.ts'
import type { BlendMode, InstanceBatch, Matrix, Mesh, MeshBackend, Vec3 } from './types.ts'

const SHADOW_SIZE = 1024

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
      float depth = sc.z - shadowParams.y;
      float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      if (edge > 0.0 && depth > 0.0 && depth < 1.0) {
        float texel = 1.25 / ${SHADOW_SIZE}.0;
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

function expandLightInto(light: Float32Array<ArrayBuffer>, out: Float32Array<ArrayBuffer>, allowShadows: boolean) {
  out.fill(0)
  out.set(light.subarray(0, Math.min(light.length, 72)))
  if (light.length < 48) { out[4] = 1; out[5] = 1; out[6] = 1 }
  if (!allowShadows) out[64] = 0
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

export function glMeshes(canvas: HTMLCanvasElement, light: Float32Array<ArrayBuffer>): MeshBackend | null {
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
  const glLightBuf = new Float32Array(72)
  const vSunDir = glLightBuf.subarray(0, 4)
  const vSunColor = glLightBuf.subarray(4, 8)
  const vFog = glLightBuf.subarray(8, 12)
  const vFogExtra = glLightBuf.subarray(12, 16)
  const vPointPos = glLightBuf.subarray(16, 32)
  const vPointCol = glLightBuf.subarray(32, 48)
  const vSkyHemi = glLightBuf.subarray(48, 52)
  const vGroundToon = glLightBuf.subarray(52, 56)
  const vRimLight = glLightBuf.subarray(56, 60)
  const vShadowParams = glLightBuf.subarray(64, 68)
  const vShadowColor = glLightBuf.subarray(68, 72)
  let activeLightMatrix: Matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  let shadowDirty = true
  const lastShadowBatches: InstanceBatch[] = []
  const lastShadowRevs: number[] = []

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

  function uploadLighting(raw: Float32Array<ArrayBuffer>) {
    expandLightInto(raw, glLightBuf, hasShadowApi)
    shadowsEnabled = hasShadowApi && glLightBuf[64] > 0.5
    shadowDirty = true
    if (shadowsEnabled) {
      activeLightMatrix = computeLightMatrix(glLightBuf)
      ensureShadowResources(SHADOW_SIZE)
    } else if (hasShadowApi && shadowTexSize === 0) {
      ensureShadowResources(1)
    }
    gl.useProgram(program)
    gl.uniform4fv(sunDirLoc, vSunDir)
    gl.uniform4fv(sunColorLoc, vSunColor)
    gl.uniform4fv(fogLoc, vFog)
    gl.uniform4fv(fogExtraLoc, vFogExtra)
    gl.uniform4fv(pointPosLoc, vPointPos)
    gl.uniform4fv(pointColLoc, vPointCol)
    gl.uniform4fv(skyHemiLoc, vSkyHemi)
    gl.uniform4fv(groundToonLoc, vGroundToon)
    gl.uniform4fv(rimLightLoc, vRimLight)
    gl.uniform4fv(shadowParamsLoc, vShadowParams)
    gl.uniform4fv(shadowColorLoc, vShadowColor)
    gl.uniformMatrix4fv(lightMatrixLoc, false, activeLightMatrix)
  }
  uploadLighting(light)

  const meshes = new Map<Mesh, WebGLBuffer>()
  const batches = new Map<InstanceBatch, {
    vao: WebGLVertexArrayObject
    buffer: WebGLBuffer
    revision: number
    capacity: number
    cameraRevision?: number
    lastOrder?: Int32Array
    lastCount?: number
    sorted?: boolean
  }>()
  const batchSorter = createAlphaSorter(16)
  const instanceSorter = createAlphaSorter(32)
  const hasPolygonOffset = typeof gl.polygonOffset === 'function' && gl.POLYGON_OFFSET_FILL !== undefined
  const lastCamera = new Float32Array(16)
  let hasCamera = false
  let cameraRevision = 0
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
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer)
          if (entry.capacity < batch.data.byteLength) {
            gl.bufferData(gl.ARRAY_BUFFER, batch.data.byteLength, gl.DYNAMIC_DRAW)
            entry.capacity = batch.data.byteLength
          }
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, uploadData, 0, count * INSTANCE_SIZE)
          if (!entry.lastOrder || entry.lastOrder.length < count) {
            entry.lastOrder = new Int32Array(Math.max(count, entry.lastOrder ? entry.lastOrder.length * 2 : 16))
          }
          for (let k = 0; k < count; k++) entry.lastOrder[k] = indices[k]
          entry.lastCount = count
          entry.revision = batch.revision
          entry.sorted = true
          stats.uploadBytes += count * INSTANCE_SIZE * 4
        }
        entry.cameraRevision = cameraRevision
      }
    } else if (entry.revision !== batch.revision) {
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer)
      if (entry.capacity < batch.data.byteLength) {
        gl.bufferData(gl.ARRAY_BUFFER, batch.data.byteLength, gl.DYNAMIC_DRAW)
        entry.capacity = batch.data.byteLength
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.count * INSTANCE_SIZE)
      entry.revision = batch.revision
      entry.sorted = false
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
    draw(matrix, clear, visible, stats, shadowCasters) {
      let cameraChanged = !hasCamera
      if (!cameraChanged) {
        for (let i = 0; i < 16; i++) {
          if (matrix[i] !== lastCamera[i]) { cameraChanged = true; break }
        }
      }

      // Tier 2 Directional Shadow Pass (cached until light or caster batch revisions change)
      if (shadowsEnabled && shadowProgram && shadowFbo) {
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
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, null)
          gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo)
          gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE)
          gl.depthMask(true)
          gl.disable(gl.BLEND)
          if (hasPolygonOffset) {
            gl.enable(gl.POLYGON_OFFSET_FILL)
            gl.polygonOffset(2, 2)
          }
          gl.clear(gl.DEPTH_BUFFER_BIT)
          gl.useProgram(shadowProgram)
          gl.uniformMatrix4fv(shadowPassLightLoc, false, activeLightMatrix)
          lastShadowBatches.length = casters.length
          lastShadowRevs.length = casters.length
          for (let i = 0; i < casters.length; i++) {
            const batch = casters[i]
            lastShadowBatches[i] = batch
            lastShadowRevs[i] = batch.revision
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
          shadowDirty = false
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
        lastCamera.set(matrix)
        hasCamera = true
        cameraRevision++
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
