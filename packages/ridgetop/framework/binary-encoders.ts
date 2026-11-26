import { Buffer } from 'node:buffer'
import type { InstanceBatch } from './types.ts'

function pad4(length: number) {
  return (4 - (length % 4)) % 4
}

function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Encode one or more Ridgetop InstanceBatches into a valid binary glTF 2.0 (.glb) mesh with flat normals and per-color PBR/emissive materials. */
export function encodeGlb(batches: readonly InstanceBatch[], name = 'RidgetopModel'): Buffer {
  // Group geometry by quantized (r, g, b, unlit) so every glTF viewer (Godot 4, Blender, Switch) renders exact colors & glow natively.
  type Bucket = {
    r: number; g: number; b: number; unlit: number; hasColors: boolean
    positions: number[]
    normals: number[]
    colors: number[]
  }
  const buckets = new Map<string, Bucket>()

  for (const batch of batches) {
    const vData = batch.mesh.data
    const vColors = batch.mesh.colors
    const hasColors = Boolean(vColors && vColors.length >= batch.mesh.vertexCount * 3)
    const vCount = batch.mesh.vertexCount
    const iData = batch.data
    for (let i = 0; i < batch.count; i++) {
      const base = i * 16
      const px = iData[base], py = iData[base + 1], pz = iData[base + 2]
      const sx = iData[base + 4], sy = iData[base + 5], sz = iData[base + 6]
      const invSx = sx !== 0 ? 1 / sx : 1
      const invSy = sy !== 0 ? 1 / sy : 1
      const invSz = sz !== 0 ? 1 / sz : 1
      const r = srgbToLinear(Math.max(0, Math.min(1, iData[base + 8])))
      const g = srgbToLinear(Math.max(0, Math.min(1, iData[base + 9])))
      const b = srgbToLinear(Math.max(0, Math.min(1, iData[base + 10])))
      const unlit = Math.max(0, Math.min(1, iData[base + 11]))
      const qx = iData[base + 12], qy = iData[base + 13], qz = iData[base + 14], qw = iData[base + 15]
      const m00 = 1 - 2 * (qy * qy + qz * qz)
      const m01 = 2 * (qx * qy - qz * qw)
      const m02 = 2 * (qx * qz + qy * qw)
      const m10 = 2 * (qx * qy + qz * qw)
      const m11 = 1 - 2 * (qx * qx + qz * qz)
      const m12 = 2 * (qy * qz - qx * qw)
      const m20 = 2 * (qx * qz - qy * qw)
      const m21 = 2 * (qy * qz + qx * qw)
      const m22 = 1 - 2 * (qx * qx + qy * qy)

      const key = `${Math.round(r * 1000)}:${Math.round(g * 1000)}:${Math.round(b * 1000)}:${Math.round(unlit * 100)}:${hasColors ? 1 : 0}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { r, g, b, unlit, hasColors, positions: [], normals: [], colors: [] }
        buckets.set(key, bucket)
      }

      const pos = bucket.positions
      const norm = bucket.normals
      const cols = bucket.colors
      for (let v = 0; v < vCount; v++) {
        const vb = v * 6
        const lx = vData[vb] * sx
        const ly = vData[vb + 1] * sy
        const lz = vData[vb + 2] * sz
        pos.push(
          px + m00 * lx + m01 * ly + m02 * lz,
          py + m10 * lx + m11 * ly + m12 * lz,
          pz + m20 * lx + m21 * ly + m22 * lz
        )
        const nlx = vData[vb + 3] * invSx
        const nly = vData[vb + 4] * invSy
        const nlz = vData[vb + 5] * invSz
        const nx = m00 * nlx + m01 * nly + m02 * nlz
        const ny = m10 * nlx + m11 * nly + m12 * nlz
        const nz = m20 * nlx + m21 * nly + m22 * nlz
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
        norm.push(nx / nLen, ny / nLen, nz / nLen)
        if (hasColors && vColors) {
          const cb = v * 3
          const vr = Number.isFinite(vColors[cb]) ? Math.max(0, Math.min(1, vColors[cb])) : 1
          const vg = Number.isFinite(vColors[cb + 1]) ? Math.max(0, Math.min(1, vColors[cb + 1])) : 1
          const vbCol = Number.isFinite(vColors[cb + 2]) ? Math.max(0, Math.min(1, vColors[cb + 2])) : 1
          cols.push(srgbToLinear(vr), srgbToLinear(vg), srgbToLinear(vbCol))
        }
      }
    }
  }

  if (!buckets.size) throw new RangeError('Cannot encode an empty glTF mesh')

  const chunks: Buffer[] = []
  const materials: Record<string, unknown>[] = []
  const primitives: Record<string, unknown>[] = []
  const bufferViews: Record<string, unknown>[] = []
  const accessors: Record<string, unknown>[] = []
  let byteOffset = 0

  for (const bucket of buckets.values()) {
    const vertCount = bucket.positions.length / 3
    const posArr = new Float32Array(bucket.positions)
    const normArr = new Float32Array(bucket.normals)
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (let i = 0; i < posArr.length; i += 3) {
      const x = posArr[i], y = posArr[i + 1], z = posArr[i + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    }
    const posBuf = Buffer.from(posArr.buffer, posArr.byteOffset, posArr.byteLength)
    const normBuf = Buffer.from(normArr.buffer, normArr.byteOffset, normArr.byteLength)

    const posView = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset, byteLength: posBuf.length, target: 34962 })
    byteOffset += posBuf.length
    chunks.push(posBuf)

    const normView = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset, byteLength: normBuf.length, target: 34962 })
    byteOffset += normBuf.length
    chunks.push(normBuf)

    const posAcc = accessors.length
    accessors.push({ bufferView: posView, componentType: 5126, count: vertCount, type: 'VEC3', min: [minX, minY, minZ], max: [maxX, maxY, maxZ] })
    const normAcc = accessors.length
    accessors.push({ bufferView: normView, componentType: 5126, count: vertCount, type: 'VEC3' })

    const attributes: Record<string, number> = { POSITION: posAcc, NORMAL: normAcc }
    if (bucket.hasColors && bucket.colors.length === vertCount * 3) {
      const colArr = new Float32Array(bucket.colors)
      const colBuf = Buffer.from(colArr.buffer, colArr.byteOffset, colArr.byteLength)
      const colView = bufferViews.length
      bufferViews.push({ buffer: 0, byteOffset, byteLength: colBuf.length, target: 34962 })
      byteOffset += colBuf.length
      chunks.push(colBuf)
      const colAcc = accessors.length
      accessors.push({ bufferView: colView, componentType: 5126, count: vertCount, type: 'VEC3' })
      attributes.COLOR_0 = colAcc
    }

    const matIndex = materials.length
    const litWeight = 1 - bucket.unlit
    const mat: Record<string, unknown> = {
      name: `Flat_${matIndex}`,
      pbrMetallicRoughness: {
        baseColorFactor: [bucket.r * litWeight, bucket.g * litWeight, bucket.b * litWeight, 1],
        metallicFactor: 0,
        roughnessFactor: 0.92
      }
    }
    if (bucket.unlit > 0.02) {
      mat.emissiveFactor = [bucket.r * bucket.unlit, bucket.g * bucket.unlit, bucket.b * bucket.unlit]
    }
    materials.push(mat)
    primitives.push({ attributes, material: matIndex })
  }

  const binPadLen = pad4(byteOffset)
  const binChunkLen = byteOffset + binPadLen
  const binPad = binPadLen ? Buffer.alloc(binPadLen, 0) : Buffer.alloc(0)

  const gltf = {
    asset: { version: '2.0', generator: 'Ridgetop' },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    materials,
    meshes: [{ name, primitives }],
    buffers: [{ byteLength: binChunkLen }],
    bufferViews,
    accessors
  }

  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8')
  const jsonPadLen = pad4(jsonRaw.length)
  const jsonChunkLen = jsonRaw.length + jsonPadLen
  const jsonPad = jsonPadLen ? Buffer.alloc(jsonPadLen, 0x20) : Buffer.alloc(0)

  const totalLength = 12 + 8 + jsonChunkLen + 8 + binChunkLen
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLength, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunkLen, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunkLen, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)

  return Buffer.concat([header, jsonHeader, jsonRaw, jsonPad, binHeader, ...chunks, binPad], totalLength)
}

/** Encode mono float32 PCM samples (-1..1) into a standard 16-bit WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = 44100): Buffer {
  const dataLength = samples.length * 2
  const buffer = Buffer.alloc(44 + dataLength)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataLength, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataLength, 40)
  for (let i = 0; i < samples.length; i++) {
    const raw = samples[i]
    const clamped = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }
  return buffer
}

function sampleWave(phase: number, waveform: 'sine' | 'triangle' | 'square' | 'sawtooth') {
  const t = phase - Math.floor(phase)
  if (waveform === 'square') return t < 0.5 ? 1 : -1
  if (waveform === 'sawtooth') return 2 * t - 1
  if (waveform === 'triangle') return 1 - 4 * Math.abs(t - 0.5)
  return Math.sin(phase * Math.PI * 2)
}

/** Bake a Ridgetop synth motif directly into a standalone 16-bit WAV for Godot / native engines. */
export function bakeMotifWav(
  notes: readonly (readonly [number, number, number, number?])[],
  { waveform = 'sine', volume = 0.28, sampleRate = 44100 }: {
    waveform?: 'sine' | 'triangle' | 'square' | 'sawtooth'
    volume?: number
    sampleRate?: number
  } = {}
): Buffer {
  let endTime = 0.05
  for (const [, duration, delay] of notes) {
    if (Number.isFinite(duration) && duration > 0 && Number.isFinite(delay)) {
      endTime = Math.max(endTime, Math.max(0, delay) + duration + 0.02)
    }
  }
  const samples = new Float32Array(Math.ceil(endTime * sampleRate))
  for (const [freq, duration, delay, endFreq] of notes) {
    if (!Number.isFinite(freq) || freq <= 0 || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(delay)) continue
    const start = Math.max(0, Math.floor(delay * sampleRate))
    const count = Math.max(1, Math.floor(duration * sampleRate))
    const glide = typeof endFreq === 'number' && Number.isFinite(endFreq) && endFreq > 0 ? endFreq / freq : 0
    let phase = 0
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const t = i / sampleRate
      const u = i / count
      const f = glide > 0 ? freq * Math.pow(glide, u) : freq
      phase += f / sampleRate
      const attack = Math.min(1, t / 0.015)
      const release = Math.pow(0.004, Math.max(0, (t - 0.015) / Math.max(0.001, duration - 0.015)))
      samples[start + i] += sampleWave(phase, waveform) * attack * release * volume
    }
  }
  return encodeWav(samples, sampleRate)
}
