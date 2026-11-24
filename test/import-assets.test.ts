import type { AddressInfo } from 'node:net'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import {
  box,
  createArtKit,
  createAudioBank,
  instances,
  loadMesh,
  octahedron,
  parseGlb,
  parseObj,
  parseWav,
  quaternionFromEuler
} from '../packages/ridgetop/framework/index.ts'
import { bakeMotifWav, createGameHost, encodeGlb, encodeWav } from '../packages/ridgetop/framework/server.ts'

function approx(actual: number, expected: number, eps = 1e-4, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${label ? label + ': ' : ''}expected ${actual} to be within ${eps} of ${expected}`
  )
}

function buildCustomGlb(gltf: Record<string, unknown>, binData?: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf))
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4
  const jsonChunkLen = jsonBytes.byteLength + jsonPad

  const binLen = binData?.byteLength ?? 0
  const binPad = binData ? (4 - (binLen % 4)) % 4 : 0
  const binChunkLen = binData ? binLen + binPad : 0

  const totalLength = 12 + 8 + jsonChunkLen + (binData ? 8 + binChunkLen : 0)
  const out = new Uint8Array(totalLength)
  const dv = new DataView(out.buffer)

  // Header
  out.set([0x67, 0x6c, 0x54, 0x46], 0) // 'glTF'
  dv.setUint32(4, 2, true)
  dv.setUint32(8, totalLength, true)

  // JSON chunk
  dv.setUint32(12, jsonChunkLen, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(jsonBytes, 20)
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonChunkLen)

  // Optional BIN chunk
  if (binData) {
    const binHeaderAt = 20 + jsonChunkLen
    dv.setUint32(binHeaderAt, binChunkLen, true)
    dv.setUint32(binHeaderAt + 4, 0x004e4942, true)
    out.set(binData, binHeaderAt + 8)
  }

  return out
}

function writeStereoFloatWav(left: readonly number[], right: readonly number[], sampleRate = 48000): Uint8Array {
  const frames = left.length
  const dataBytes = frames * 2 * 4
  // Include a JUNK chunk (odd size 5 -> padded to 6) before fmt to verify RIFF chunk traversal & alignment
  const junkSize = 5
  const junkPadded = 6
  const totalPayload = 4 + (8 + junkPadded) + (8 + 16) + (8 + dataBytes)
  const buf = new Uint8Array(8 + totalPayload)
  const dv = new DataView(buf.buffer)
  const writeAscii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) buf[at + i] = text.charCodeAt(i)
  }

  writeAscii(0, 'RIFF')
  dv.setUint32(4, totalPayload, true)
  writeAscii(8, 'WAVE')

  let off = 12
  writeAscii(off, 'JUNK')
  dv.setUint32(off + 4, junkSize, true)
  off += 8 + junkPadded

  writeAscii(off, 'fmt ')
  dv.setUint32(off + 4, 16, true)
  dv.setUint16(off + 8, 3, true) // IEEE float
  dv.setUint16(off + 10, 2, true) // stereo
  dv.setUint32(off + 12, sampleRate, true)
  dv.setUint32(off + 16, sampleRate * 8, true)
  dv.setUint16(off + 20, 8, true)
  dv.setUint16(off + 22, 32, true)
  off += 24

  writeAscii(off, 'data')
  dv.setUint32(off + 4, dataBytes, true)
  off += 8
  for (let i = 0; i < frames; i++) {
    dv.setFloat32(off + i * 8, left[i], true)
    dv.setFloat32(off + i * 8 + 4, right[i], true)
  }
  return buf
}

test('parseObj parses triangles, quads, n-gons, v/vt/vn formats, negative indices, and groups', () => {
  const obj = [
    '# Simple multi-group OBJ with CRLF and formats',
    'mtllib test.mtl',
    'o Tower',
    'usemtl Stone',
    'v 0 0 0',
    'v 1 0 0',
    'v 1 1 0',
    'v 0 1 0',
    'vt 0 0',
    'vt 1 0',
    'vt 1 1',
    'vt 0 1',
    'vn 0 0 1',
    's off',
    '# Quad using v/vt/vn',
    'f 1/1/1 2/2/1 3/3/1 4/4/1',
    '',
    'g Roof',
    'usemtl Copper',
    '# Pentagon using v//vn, v/vt, and negative indices relative to vertices so far',
    'v 0 1 0',
    'v 1 1 0',
    'v 1.5 1.5 0',
    'v 0.5 2 0',
    'v -0.5 1.5 0',
    'f -5//1 -4/2 -3 -2/4/1 \\',
    '  -1//1'
  ].join('\r\n')

  const parts = parseObj(obj)
  assert.equal(parts.length, 2)

  assert.equal(parts[0].name, 'Tower')
  assert.equal(parts[0].material, 'Stone')
  assert.equal(parts[0].mesh.vertexCount, 6) // quad -> 2 triangles
  assert.deepEqual(parts[0].color, [1, 1, 1, 1])
  assert.equal(parts[0].unlit, 0)
  // Flat normal should point along +Z
  approx(parts[0].mesh.data[3], 0, 1e-5, 'quad nx')
  approx(parts[0].mesh.data[4], 0, 1e-5, 'quad ny')
  approx(parts[0].mesh.data[5], 1, 1e-5, 'quad nz')

  assert.equal(parts[1].name, 'Roof')
  assert.equal(parts[1].material, 'Copper')
  assert.equal(parts[1].mesh.vertexCount, 9) // pentagon -> 3 triangles (fan)
  approx(parts[1].mesh.data[3], 0, 1e-5, 'pentagon nx')
  approx(parts[1].mesh.data[4], 0, 1e-5, 'pentagon ny')
  approx(parts[1].mesh.data[5], 1, 1e-5, 'pentagon nz')

  // Drops cleanly into Ridgetop instance batches
  const batch = instances(parts[0].mesh)
  batch.add([2, 0, -1], [1, 1, 1], 0, parts[0].color, parts[0].unlit)
  assert.equal(batch.count, 1)
})

test('parseObj rejects empty and malformed inputs cleanly', () => {
  assert.throws(() => parseObj(''), /empty/i)
  assert.throws(() => parseObj('   \n# comment only\n'), /no valid faces/i)
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\n'), /no valid faces/i)
  assert.throws(() => parseObj('v 1 2\nf 1 2 3'), /expected 3 coordinates/i)
  assert.throws(() => parseObj('v 1 nope 3\nf 1 2 3'), /coordinates/i)
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nf 1 2'), /at least 3 vertices/i)
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2'), /Invalid OBJ face vertex index/i)
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 abc 3'), /Invalid OBJ face vertex index/i)
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9'), /out of range/i)
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -9 1 2'), /out of range/i)
  assert.throws(() => parseObj('v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3'), /non-degenerate/i)
})

test('parseGlb round-trips meshes, linear->sRGB colors, and unlit values from encodeGlb', () => {
  const litBatch = instances(box)
  const litColor = [0.82, 0.36, 0.18] as const
  litBatch.add([1.5, 0.5, -2], [2, 1, 0.5], quaternionFromEuler(0, Math.PI / 4, 0), litColor, 0)

  const partialGlowBatch = instances(octahedron)
  const partialColor = [0.95, 0.78, 0.22] as const
  partialGlowBatch.add([-2, 1, 0], [0.8, 1.2, 0.8], 0.3, partialColor, 0.45)

  const fullGlowBatch = instances(box)
  const fullColor = [0.25, 0.92, 0.85] as const
  fullGlowBatch.add([0, 3, 1], [0.4, 0.4, 0.4], 0, fullColor, 1)

  const glb = encodeGlb([litBatch, partialGlowBatch, fullGlowBatch], 'BeaconProp')

  // Test both Buffer (Uint8Array) and sliced ArrayBuffer with non-zero byteOffset
  const padded = new Uint8Array(glb.byteLength + 16)
  padded.set(glb, 7)
  const parts = parseGlb(padded.subarray(7, 7 + glb.byteLength))
  assert.equal(parts.length, 3)

  // Verify lit part
  assert.equal(parts[0].mesh.vertexCount, box.vertexCount)
  approx(parts[0].color[0], litColor[0], 0.01, 'lit r')
  approx(parts[0].color[1], litColor[1], 0.01, 'lit g')
  approx(parts[0].color[2], litColor[2], 0.01, 'lit b')
  approx(parts[0].color[3], 1, 1e-5, 'lit a')
  approx(parts[0].unlit, 0, 0.01, 'lit unlit')

  // Verify partially unlit part
  assert.equal(parts[1].mesh.vertexCount, octahedron.vertexCount)
  approx(parts[1].color[0], partialColor[0], 0.01, 'partial r')
  approx(parts[1].color[1], partialColor[1], 0.01, 'partial g')
  approx(parts[1].color[2], partialColor[2], 0.01, 'partial b')
  approx(parts[1].unlit, 0.45, 0.02, 'partial unlit')

  // Verify fully unlit part
  assert.equal(parts[2].mesh.vertexCount, box.vertexCount)
  approx(parts[2].color[0], fullColor[0], 0.01, 'full r')
  approx(parts[2].color[1], fullColor[1], 0.01, 'full g')
  approx(parts[2].color[2], fullColor[2], 0.01, 'full b')
  approx(parts[2].unlit, 1, 0.01, 'full unlit')

  // Verify art-kit model round-trips and drops directly into instances()
  const kit = createArtKit()
  const group = kit.group()
  group.add('crystal', [0, 0, 0])
  const crystalGlb = encodeGlb(group.batches, 'crystal')
  const crystalParts = parseGlb(Uint8Array.from(crystalGlb).buffer)
  assert.ok(crystalParts.length >= 1)
  for (const part of crystalParts) {
    const batch = instances(part.mesh)
    batch.add([0, 0, 0], [1, 1, 1], 0, part.color, part.unlit)
    assert.equal(batch.count, 1)
    assert.ok(part.mesh.vertexCount >= 3)
  }
})

test('parseGlb supports indexed accessors (U8/U16/U32), byteOffset/byteStride, node TRS/matrix hierarchies, and mirroring', () => {
  // Build binary chunk containing:
  // 0..15: 16 bytes of dummy padding
  // 16..111: 4 interleaved vertices (stride 24: 4 bytes pad + 12 bytes FLOAT VEC3 + 8 bytes trailing UV)
  // 112..117: 6 UNSIGNED_BYTE indices (quad -> 2 triangles)
  // 120..131: 6 UNSIGNED_SHORT indices
  // 132..155: 6 UNSIGNED_INT indices
  const bin = new Uint8Array(160)
  const dv = new DataView(bin.buffer)
  const verts = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0]
  ]
  for (let i = 0; i < verts.length; i++) {
    const off = 16 + i * 24 + 4 // bufferView.byteOffset=16, accessor.byteOffset=4, byteStride=24
    dv.setFloat32(off, verts[i][0], true)
    dv.setFloat32(off + 4, verts[i][1], true)
    dv.setFloat32(off + 8, verts[i][2], true)
  }
  const triIdx = [0, 1, 2, 0, 2, 3]
  for (let i = 0; i < 6; i++) bin[112 + i] = triIdx[i]
  for (let i = 0; i < 6; i++) dv.setUint16(120 + i * 2, triIdx[i], true)
  for (let i = 0; i < 6; i++) dv.setUint32(132 + i * 4, triIdx[i], true)

  const rotY90 = quaternionFromEuler(0, Math.PI / 2, 0)
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 2, 3] }],
    nodes: [
      // Parent with TRS: translate (10, 0, 0), rotate +90deg around Y, scale (2, 2, 2)
      { name: 'Parent', translation: [10, 0, 0], rotation: [...rotY90], scale: [2, 2, 2], children: [1] },
      // Child with column-major matrix: translate (0, 5, 0)
      { name: 'ChildU8', mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1] },
      // Mirrored node (negative X scale) with U16 indices -> winding must flip to preserve outward normal
      { name: 'MirroredU16', mesh: 1, scale: [-1, 1, 1] },
      // U32 indices + KHR_materials_unlit
      { name: 'UnlitU32', mesh: 2 }
    ],
    meshes: [
      { name: 'QuadU8', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] },
      { name: 'QuadU16', primitives: [{ attributes: { POSITION: 0 }, indices: 2, material: 0 }] },
      { name: 'QuadU32', primitives: [{ attributes: { POSITION: 0 }, indices: 3, material: 1 }] }
    ],
    materials: [
      { name: 'Tint', pbrMetallicRoughness: { baseColorFactor: [0.214041, 0.214041, 0.214041, 0.6] } },
      {
        name: 'GlowCard',
        pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] },
        extensions: { KHR_materials_unlit: {} }
      }
    ],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 16, byteLength: 96, byteStride: 24 },
      { buffer: 0, byteOffset: 112, byteLength: 6 },
      { buffer: 0, byteOffset: 120, byteLength: 12 },
      { buffer: 0, byteOffset: 132, byteLength: 24 }
    ],
    accessors: [
      { bufferView: 0, byteOffset: 4, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: 6, type: 'SCALAR' },
      { bufferView: 2, componentType: 5123, count: 6, type: 'SCALAR' },
      { bufferView: 3, componentType: 5125, count: 6, type: 'SCALAR' }
    ]
  }

  const parts = parseGlb(buildCustomGlb(gltf, bin))
  assert.equal(parts.length, 3)

  // Node 1 (ChildU8): local (0,0,0) -> child (0,5,0) -> parent scale (0,10,0) -> rotY90 (0,10,0) -> +T (10,10,0)
  // Local (1,0,0) -> child (1,5,0) -> scale (2,10,0) -> rotY90 (0,10,-2) -> +T (10,10,-2)
  const child = parts[0]
  assert.equal(child.name, 'ChildU8')
  assert.equal(child.mesh.vertexCount, 6)
  approx(child.mesh.data[0], 10, 1e-4, 'v0.x')
  approx(child.mesh.data[1], 10, 1e-4, 'v0.y')
  approx(child.mesh.data[2], 0, 1e-4, 'v0.z')
  approx(child.mesh.data[6], 10, 1e-4, 'v1.x')
  approx(child.mesh.data[7], 10, 1e-4, 'v1.y')
  approx(child.mesh.data[8], -2, 1e-4, 'v1.z')
  // Original normal +Z rotated +90 deg about Y becomes +X
  approx(child.mesh.data[3], 1, 1e-4, 'child nx')
  approx(child.mesh.data[4], 0, 1e-4, 'child ny')
  approx(child.mesh.data[5], 0, 1e-4, 'child nz')
  // Linear 0.214041 -> sRGB ~0.5, alpha 0.6
  approx(child.color[0], 0.5, 1e-3, 'sRGB r')
  approx(child.color[3], 0.6, 1e-5, 'alpha')

  // Node 2 (MirroredU16): mirrored X flips winding, so normal remains +Z (not inverted -Z)
  const mirrored = parts[1]
  assert.equal(mirrored.name, 'MirroredU16')
  assert.equal(mirrored.mesh.vertexCount, 6)
  approx(mirrored.mesh.data[3], 0, 1e-4, 'mirrored nx')
  approx(mirrored.mesh.data[4], 0, 1e-4, 'mirrored ny')
  approx(mirrored.mesh.data[5], 1, 1e-4, 'mirrored nz')

  // Node 3 (UnlitU32): KHR_materials_unlit forces unlit=1
  const unlitPart = parts[2]
  assert.equal(unlitPart.name, 'UnlitU32')
  assert.equal(unlitPart.mesh.vertexCount, 6)
  assert.equal(unlitPart.unlit, 1)
  approx(unlitPart.color[0], 1, 1e-4)
  approx(unlitPart.color[1], 0, 1e-4)
  approx(unlitPart.color[2], 0, 1e-4)
})

test('parseGlb rejects corrupted headers, bad chunks, cyclic hierarchies, and out-of-bounds accessors', () => {
  assert.throws(() => parseGlb(new Uint8Array(8)), /too short/i)

  const badMagic = new Uint8Array(24)
  badMagic.set([0x4e, 0x4f, 0x50, 0x45], 0)
  assert.throws(() => parseGlb(badMagic), /magic/i)

  const valid = encodeGlb([(() => { const b = instances(box); b.add(); return b })()])

  const badVersion = new Uint8Array(valid)
  new DataView(badVersion.buffer).setUint32(4, 1, true)
  assert.throws(() => parseGlb(badVersion), /version/i)

  const truncated = valid.subarray(0, valid.byteLength - 4)
  assert.throws(() => parseGlb(truncated), /total length/i)

  const badJsonType = new Uint8Array(valid)
  new DataView(badJsonType.buffer).setUint32(16, 0x004e4942, true)
  assert.throws(() => parseGlb(badJsonType), /First GLB chunk must be JSON/i)

  // Cyclic node graph
  const cyclic = buildCustomGlb({
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: [{ children: [1] }, { children: [0] }]
  })
  assert.throws(() => parseGlb(cyclic), /Cyclic/i)

  // Out-of-bounds accessor
  const oobBin = new Uint8Array(12)
  const oob = buildCustomGlb({
    asset: { version: '2.0' },
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 12 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
  }, oobBin)
  assert.throws(() => parseGlb(oob), /exceeds bufferView bounds/i)
})

test('parseWav round-trips encodeWav and bakeMotifWav and parses stereo float32 WAVs', () => {
  const input = new Float32Array([0, 0.25, -0.5, 0.75, -1, 1, 0.125])
  const wav = encodeWav(input, 22050)
  const parsed = parseWav(wav)

  assert.equal(parsed.sampleRate, 22050)
  assert.equal(parsed.channels, 1)
  assert.equal(parsed.bitsPerSample, 16)
  assert.equal(parsed.format, 'pcm')
  assert.equal(parsed.samples.length, input.length)
  assert.equal(parsed.channelData.length, 1)
  assert.equal(parsed.samples, parsed.channelData[0])
  approx(parsed.duration, input.length / 22050, 1e-6)
  for (let i = 0; i < input.length; i++) {
    approx(parsed.samples[i], input[i], 1e-4, `sample[${i}]`)
  }

  // Round-trip bakeMotifWav
  const motifWav = bakeMotifWav([[440, 0.12, 0, 880]], { waveform: 'triangle', sampleRate: 44100 })
  const parsedMotif = parseWav(Uint8Array.from(motifWav).buffer)
  assert.equal(parsedMotif.sampleRate, 44100)
  assert.equal(parsedMotif.channels, 1)
  assert.ok(parsedMotif.duration >= 0.12)
  let peak = 0
  for (let i = 0; i < parsedMotif.samples.length; i++) peak = Math.max(peak, Math.abs(parsedMotif.samples[i]))
  assert.ok(peak > 0.1, 'Expected audible motif signal after parseWav')

  // Stereo 32-bit IEEE float WAV with preceding odd-length JUNK chunk
  const left = [0.25, -0.5, 0.75, -0.25]
  const right = [-0.25, 0.5, 0.25, -0.75]
  const stereoWav = writeStereoFloatWav(left, right, 48000)
  const parsedStereo = parseWav(stereoWav)
  assert.equal(parsedStereo.sampleRate, 48000)
  assert.equal(parsedStereo.channels, 2)
  assert.equal(parsedStereo.bitsPerSample, 32)
  assert.equal(parsedStereo.format, 'float')
  for (let i = 0; i < left.length; i++) {
    approx(parsedStereo.channelData[0][i], left[i], 1e-6)
    approx(parsedStereo.channelData[1][i], right[i], 1e-6)
    approx(parsedStereo.samples[i], (left[i] + right[i]) / 2, 1e-6)
  }

  // Malformed WAV rejection
  assert.throws(() => parseWav(new Uint8Array(8)), /too short/i)
  assert.throws(() => parseWav(new Uint8Array(44)), /RIFF\/WAVE/i)
})

test('createAudioBank loads, decodes, caches, routes, loops, stops, and disposes safely with mocked AudioContext', async () => {
  interface MockSource {
    buffer: unknown
    loop: boolean
    playbackRate: { value: number }
    detune: { value: number }
    started: unknown[][]
    stopped: number
    disconnected: number
    connectedTo: unknown[]
    onended: (() => void) | null
    connect(node: unknown): void
    disconnect(): void
    start(...args: unknown[]): void
    stop(): void
  }

  interface MockGain {
    gain: { value: number }
    connectedTo: unknown[]
    disconnected: number
    connect(node: unknown): void
    disconnect(): void
  }

  const createdSources: MockSource[] = []
  const createdGains: MockGain[] = []
  let decodeCalls = 0
  let closeCalls = 0
  let resumeCalls = 0

  const destinationNode = { kind: 'destination', connect() {} }
  const sfxBusNode = { kind: 'sfxBus', connect() {} }

  const mockCtx = {
    state: 'suspended',
    destination: destinationNode,
    async resume() {
      resumeCalls++
      this.state = 'running'
    },
    async close() {
      closeCalls++
      this.state = 'closed'
    },
    async decodeAudioData(arrayBuffer: ArrayBuffer) {
      decodeCalls++
      const parsed = parseWav(arrayBuffer)
      return {
        duration: parsed.duration,
        sampleRate: parsed.sampleRate,
        numberOfChannels: parsed.channels,
        length: parsed.samples.length
      }
    },
    createGain(): MockGain {
      const node: MockGain = {
        gain: { value: 1 },
        connectedTo: [],
        disconnected: 0,
        connect(target) { this.connectedTo.push(target) },
        disconnect() { this.disconnected++ }
      }
      createdGains.push(node)
      return node
    },
    createBufferSource(): MockSource {
      const node: MockSource = {
        buffer: null,
        loop: false,
        playbackRate: { value: 1 },
        detune: { value: 0 },
        started: [],
        stopped: 0,
        disconnected: 0,
        connectedTo: [],
        onended: null,
        connect(target) { this.connectedTo.push(target) },
        disconnect() { this.disconnected++ },
        start(...args) { this.started.push(args) },
        stop() { this.stopped++ }
      }
      createdSources.push(node)
      return node
    }
  }

  const jumpWav = encodeWav(new Float32Array([0, 0.5, -0.5, 0]), 22050)
  const musicWav = encodeWav(new Float32Array([0.1, 0.2, 0.3, 0.4]), 22050)
  let fetchCalls = 0

  const bank = createAudioBank({
    context: mockCtx as unknown as AudioContext,
    buses: { sfx: sfxBusNode as unknown as AudioNode },
    fetch: (async (input: string | URL | Request) => {
      fetchCalls++
      const url = String(input)
      if (url.endsWith('missing.ogg')) return new Response('nope', { status: 404 })
      const body = url.endsWith('music.ogg') ? musicWav : jumpWav
      return new Response(new Uint8Array(body), { status: 200 })
    }) as typeof globalThis.fetch
  })

  // Concurrent load of same key only fetches & decodes once
  const [ok1, ok2] = await Promise.all([
    bank.load('jump', '/audio/jump.wav'),
    bank.load('jump', '/audio/jump.wav')
  ])
  assert.equal(ok1, true)
  assert.equal(ok2, true)
  assert.equal(fetchCalls, 1)
  assert.equal(decodeCalls, 1)
  assert.equal(bank.has('jump'), true)

  // Cached hit does not re-fetch or re-decode
  assert.equal(await bank.load('jump', '/audio/jump.wav'), true)
  assert.equal(fetchCalls, 1)
  assert.equal(decodeCalls, 1)

  // loadAll supports mixed URLs, Uint8Array slices, and gracefully reports 404 failures
  const sliceBacking = new Uint8Array(jumpWav.byteLength + 10)
  sliceBacking.set(jumpWav, 5)
  const byteSlice = sliceBacking.subarray(5, 5 + jumpWav.byteLength)

  const loaded = await bank.loadAll({
    music: '/audio/music.ogg',
    raw: byteSlice,
    missing: '/audio/missing.ogg'
  })
  assert.deepEqual(loaded, { music: true, raw: true, missing: false })
  assert.equal(bank.has('music'), true)
  assert.equal(bank.has('raw'), true)
  assert.equal(bank.has('missing'), false)
  // Caller's Uint8Array buffer was not detached
  assert.equal(byteSlice.byteLength, jumpWav.byteLength)

  // Play with options + named bus
  const sfxHandle = bank.play('jump', { volume: 0.6, rate: 1.25, detune: -100, bus: 'sfx' })
  assert.equal(sfxHandle.playing, true)
  assert.equal(resumeCalls, 1)
  const sfxSrc = createdSources[0]
  assert.equal(sfxSrc.loop, false)
  assert.equal(sfxSrc.playbackRate.value, 1.25)
  assert.equal(sfxSrc.detune.value, -100)
  const sfxGain = sfxSrc.connectedTo[0] as MockGain
  assert.equal(sfxGain.gain.value, 0.6)
  assert.equal(sfxGain.connectedTo[0], sfxBusNode)

  // Play looping music on default master bus
  const musicHandle = bank.play('music', { loop: true, volume: 0.4 })
  assert.equal(musicHandle.playing, true)
  const musicSrc = createdSources[1]
  assert.equal(musicSrc.loop, true)

  // Stopping one handle marks it inactive and disconnects
  sfxHandle.stop()
  assert.equal(sfxHandle.playing, false)
  assert.equal(sfxSrc.stopped, 1)
  assert.equal(sfxSrc.disconnected, 1)
  // Idempotent second stop
  sfxHandle.stop()
  assert.equal(sfxSrc.stopped, 1)

  // stopAll stops remaining active handles
  bank.stopAll()
  assert.equal(musicHandle.playing, false)
  assert.equal(musicSrc.stopped, 1)

  // Natural onended cleans up playing state
  const rawHandle = bank.play('raw')
  assert.equal(rawHandle.playing, true)
  createdSources[2].onended?.()
  assert.equal(rawHandle.playing, false)

  // Master volume and mute controls
  bank.setVolume(0.5)
  assert.equal(createdGains[0].gain.value, 0.5)
  bank.setMuted(true)
  assert.equal(createdGains[0].gain.value, 0)
  bank.setMuted(false)
  assert.equal(createdGains[0].gain.value, 0.5)

  // If source.start() throws, play() must clean up and disconnect nodes without leaking active handles
  const origCreateBufferSource = mockCtx.createBufferSource
  mockCtx.createBufferSource = () => {
    const src = origCreateBufferSource()
    src.start = () => { throw new RangeError('offset exceeds buffer duration') }
    return src
  }
  const failedHandle = bank.play('jump', { offset: 999 })
  assert.equal(failedHandle.playing, false)
  const failedSrc = createdSources[createdSources.length - 1]
  assert.equal(failedSrc.disconnected, 1)
  mockCtx.createBufferSource = origCreateBufferSource

  // dispose clears cache and does NOT close caller-supplied AudioContext
  const activeBeforeDispose = bank.play('music', { loop: true })
  bank.dispose()
  assert.equal(activeBeforeDispose.playing, false)
  assert.equal(bank.has('jump'), false)
  assert.equal(closeCalls, 0)
  assert.equal(bank.play('jump').playing, false)
})

test('createAudioBank is completely safe in headless environments without Web Audio', async () => {
  const prevAudio = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  Object.defineProperty(globalThis, 'AudioContext', { value: undefined, configurable: true })
  try {
    const bank = createAudioBank()
    assert.equal(await bank.load('beep', encodeWav(new Float32Array([0, 0.5, 0]))), false)
    assert.deepEqual(await bank.loadAll({ a: '/a.wav', b: '/b.mp3' }), { a: false, b: false })
    assert.equal(bank.has('beep'), false)
    const handle = bank.play('beep', { volume: 0.5, loop: true })
    assert.equal(handle.playing, false)
    handle.stop()
    bank.setVolume(0.2)
    bank.setMuted(true)
    bank.stopAll()
    bank.dispose()
  } finally {
    if (prevAudio) Object.defineProperty(globalThis, 'AudioContext', prevAudio)
    else delete (globalThis as Record<string, unknown>).AudioContext
  }
})

test('createGameHost serves .glb, .obj, .wav, .ogg, .mp3 from artDirectories and loadMesh fetches both formats', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-assets-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const art = join(folder, 'art')
  await mkdir(art)

  const b = instances(box)
  b.add([0, 0, 0], [1, 1, 1], 0, [0.4, 0.7, 0.9], 0)
  const glbBytes = encodeGlb([b], 'Crate')
  const objText = 'o Tri\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'
  const wavBytes = encodeWav(new Float32Array([0, 0.5, -0.5, 0]), 22050)

  await writeFile(join(art, 'crate.glb'), glbBytes)
  await writeFile(join(art, 'tri.obj'), objText)
  await writeFile(join(art, 'ping.wav'), wavBytes)
  await writeFile(join(art, 'bgm.ogg'), new Uint8Array([0x4f, 0x67, 0x67, 0x53]))
  await writeFile(join(art, 'fx.mp3'), new Uint8Array([0x49, 0x44, 0x33]))

  const app = createGameHost({ root: pathToFileURL(folder + '/'), files: [], artDirectories: ['art'] })
  t.after(() => app.close())
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port + '/art/'

  // Check MIME headers for all newly allowed extensions
  const glbRes = await fetch(base + 'crate.glb')
  assert.equal(glbRes.status, 200)
  assert.equal(glbRes.headers.get('content-type'), 'model/gltf-binary')

  const objRes = await fetch(base + 'tri.obj')
  assert.equal(objRes.status, 200)
  assert.equal(objRes.headers.get('content-type'), 'text/plain; charset=utf-8')

  const wavRes = await fetch(base + 'ping.wav')
  assert.equal(wavRes.status, 200)
  assert.equal(wavRes.headers.get('content-type'), 'audio/wav')

  const oggRes = await fetch(base + 'bgm.ogg')
  assert.equal(oggRes.status, 200)
  assert.equal(oggRes.headers.get('content-type'), 'audio/ogg')

  const mp3Res = await fetch(base + 'fx.mp3')
  assert.equal(mp3Res.status, 200)
  assert.equal(mp3Res.headers.get('content-type'), 'audio/mpeg')

  // Verify loadMesh fetches and parses both .glb and .obj over HTTP
  const loadedGlb = await loadMesh(base + 'crate.glb?v=1')
  assert.equal(loadedGlb.length, 1)
  assert.equal(loadedGlb[0].mesh.vertexCount, box.vertexCount)
  approx(loadedGlb[0].color[0], 0.4, 0.01)
  approx(loadedGlb[0].color[1], 0.7, 0.01)
  approx(loadedGlb[0].color[2], 0.9, 0.01)

  const loadedObj = await loadMesh(new URL('tri.obj', base))
  assert.equal(loadedObj.length, 1)
  assert.equal(loadedObj[0].name, 'Tri')
  assert.equal(loadedObj[0].mesh.vertexCount, 3)

  await assert.rejects(() => loadMesh(base + 'missing.glb'), /HTTP 404/)
})
