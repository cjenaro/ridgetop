import { INSTANCE_SIZE } from './instances.ts'

import type { MeshBackend } from './types.ts'

const vertexSource = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec4 origin;
layout(location=3) in vec4 scale;
layout(location=4) in vec4 tint;
layout(location=5) in vec4 rotation;
uniform mat4 camera;
uniform vec4 lighting;
flat out vec3 color;
vec3 rotate(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}
void main() {
  vec3 world = origin.xyz + rotate(rotation, position * scale.xyz);
  vec3 rotated = normalize(rotate(rotation, normal / scale.xyz));
  float light = lighting.w + (1.0 - lighting.w) * max(0.0, dot(rotated, lighting.xyz));
  color = tint.rgb * mix(light, 1.0, tint.a);
  vec4 clip = camera * vec4(world, 1.0);
  gl_Position = vec4(clip.xy, clip.z * 2.0 - clip.w, clip.w);
}`
const fragmentSource = `#version 300 es
precision highp float;
flat in vec3 color;
out vec4 pixel;
void main() { pixel = vec4(color, 1.0); }`

export function glMeshes(canvas: HTMLCanvasElement, light: Float32Array<ArrayBuffer>): MeshBackend | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'high-performance' })
  if (!gl) return null
  const program = gl.createProgram()
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]] as const) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader)
      gl.deleteShader(shader)
      gl.deleteProgram(program)
      throw new Error(message)
    }
    gl.attachShader(program, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(message)
  }
  gl.useProgram(program)
  gl.enable(gl.DEPTH_TEST)
  gl.enable(gl.CULL_FACE)
  const camera = gl.getUniformLocation(program, 'camera')
  gl.uniform4fv(gl.getUniformLocation(program, 'lighting'), light)
  const meshes = new Map()
  const batches = new Map()
  const lastCamera = new Float32Array(16)
  let hasCamera = false
  let lastWidth = -1
  let lastHeight = -1
  let lostHandler
  const lost = new Promise<void>(resolve => {
    lostHandler = event => {
      event.preventDefault()
      resolve()
    }
    canvas.addEventListener('webglcontextlost', lostHandler, { once: true })
  })

  function release(batch) {
    const entry = batches.get(batch)
    if (!entry) return
    gl.deleteVertexArray(entry.vao)
    gl.deleteBuffer(entry.buffer)
    batches.delete(batch)
  }

  return {
    name: 'WebGL 2',
    lost,
    maxDimension: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    draw(matrix, clear, visible, stats) {
      if (canvas.width !== lastWidth || canvas.height !== lastHeight) {
        gl.viewport(0, 0, canvas.width, canvas.height)
        lastWidth = canvas.width
        lastHeight = canvas.height
      }
      gl.clearColor(clear[0], clear[1], clear[2], clear[3])
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      let cameraChanged = !hasCamera
      if (!cameraChanged) {
        for (let i = 0; i < 16; i++) {
          if (matrix[i] !== lastCamera[i]) { cameraChanged = true; break }
        }
      }
      if (cameraChanged) {
        gl.uniformMatrix4fv(camera, false, matrix)
        lastCamera.set(matrix)
        hasCamera = true
      }
      for (const batch of visible) {
        let entry = batches.get(batch)
        if (!entry) {
          entry = { vao: gl.createVertexArray(), buffer: gl.createBuffer(), revision: -1, capacity: 0 }
          gl.bindVertexArray(entry.vao)
          let vertices = meshes.get(batch.mesh)
          if (!vertices) {
            vertices = gl.createBuffer()
            gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
            gl.bufferData(gl.ARRAY_BUFFER, batch.mesh.data, gl.STATIC_DRAW)
            meshes.set(batch.mesh, vertices)
          } else gl.bindBuffer(gl.ARRAY_BUFFER, vertices)
          for (let i = 0; i < 2; i++) {
            gl.enableVertexAttribArray(i)
            gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 24, i * 12)
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer)
          for (let i = 0; i < 4; i++) {
            gl.enableVertexAttribArray(i + 2)
            gl.vertexAttribPointer(i + 2, 4, gl.FLOAT, false, INSTANCE_SIZE * 4, i * 16)
            gl.vertexAttribDivisor(i + 2, 1)
          }
          batches.set(batch, entry)
        } else gl.bindVertexArray(entry.vao)
        if (entry.revision !== batch.revision) {
          gl.bindBuffer(gl.ARRAY_BUFFER, entry.buffer)
          if (entry.capacity < batch.data.byteLength) {
            gl.bufferData(gl.ARRAY_BUFFER, batch.data.byteLength, gl.DYNAMIC_DRAW)
            entry.capacity = batch.data.byteLength
          }
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data, 0, batch.count * INSTANCE_SIZE)
          entry.revision = batch.revision
          stats.uploadBytes += batch.count * INSTANCE_SIZE * 4
        }
        gl.drawArraysInstanced(gl.TRIANGLES, 0, batch.mesh.vertexCount, batch.count)
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
      canvas.removeEventListener('webglcontextlost', lostHandler)
      for (const batch of batches.keys()) release(batch)
      for (const buffer of meshes.values()) gl.deleteBuffer(buffer)
      meshes.clear()
      gl.deleteProgram(program)
    }
  }
}
