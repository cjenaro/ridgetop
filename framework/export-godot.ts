import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstanceBatch } from './types.ts'
import type { LayoutNode } from './ui-layout.ts'
import { rotateVec3 } from './geometry.ts'

function pad4(length: number) {
  return (4 - (length % 4)) % 4
}

/** Encode one or more Ridgetop InstanceBatches into a valid binary glTF 2.0 (.glb) mesh with flat normals and vertex colors. */
export function encodeGlb(batches: readonly InstanceBatch[], name = 'RidgetopModel'): Buffer {
  let totalVerts = 0
  for (const batch of batches) totalVerts += batch.count * batch.mesh.vertexCount
  if (!totalVerts) throw new RangeError('Cannot encode an empty glTF mesh')

  const positions = new Float32Array(totalVerts * 3)
  const normals = new Float32Array(totalVerts * 3)
  const colors = new Float32Array(totalVerts * 3)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]

  let cursor = 0
  for (const batch of batches) {
    const vData = batch.mesh.data
    const vCount = batch.mesh.vertexCount
    const iData = batch.data
    for (let i = 0; i < batch.count; i++) {
      const base = i * 16
      const px = iData[base], py = iData[base + 1], pz = iData[base + 2]
      const sx = iData[base + 4], sy = iData[base + 5], sz = iData[base + 6]
      const qx = iData[base + 8], qy = iData[base + 9], qz = iData[base + 10], qw = iData[base + 11]
      const r = iData[base + 12], g = iData[base + 13], b = iData[base + 14]
      const q: readonly [number, number, number, number] = [qx, qy, qz, qw]

      for (let v = 0; v < vCount; v++) {
        const vb = v * 6
        const [rx, ry, rz] = rotateVec3(q, [vData[vb] * sx, vData[vb + 1] * sy, vData[vb + 2] * sz])
        const wx = px + rx, wy = py + ry, wz = pz + rz
        const [nx, ny, nz] = rotateVec3(q, [vData[vb + 3] / sx, vData[vb + 4] / sy, vData[vb + 5] / sz])
        const nLen = Math.hypot(nx, ny, nz) || 1
        const out = cursor * 3
        positions[out] = wx; positions[out + 1] = wy; positions[out + 2] = wz
        normals[out] = nx / nLen; normals[out + 1] = ny / nLen; normals[out + 2] = nz / nLen
        colors[out] = r; colors[out + 1] = g; colors[out + 2] = b
        if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx
        if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy
        if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz
        cursor++
      }
    }
  }

  const posBytes = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength)
  const normBytes = Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength)
  const colBytes = Buffer.from(colors.buffer, colors.byteOffset, colors.byteLength)
  const binRaw = Buffer.concat([posBytes, normBytes, colBytes])
  const binPad = Buffer.alloc(pad4(binRaw.length), 0)
  const binChunk = Buffer.concat([binRaw, binPad])

  const gltf = {
    asset: { version: '2.0', generator: 'Ridgetop' },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    materials: [{
      name: 'RidgetopFlat',
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 1
      }
    }],
    meshes: [{
      name,
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
        material: 0
      }]
    }],
    buffers: [{ byteLength: binChunk.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length, byteLength: normBytes.length, target: 34962 },
      { buffer: 0, byteOffset: posBytes.length + normBytes.length, byteLength: colBytes.length, target: 34962 }
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: totalVerts, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: totalVerts, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: totalVerts, type: 'VEC3' }
    ]
  }

  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8')
  const jsonPad = Buffer.alloc(pad4(jsonRaw.length), 0x20)
  const jsonChunk = Buffer.concat([jsonRaw, jsonPad])

  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLength, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4) // JSON

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunk.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4) // BIN

  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk])
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
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataLength, 40)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
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
  for (const [, duration, delay] of notes) endTime = Math.max(endTime, delay + duration + 0.02)
  const samples = new Float32Array(Math.ceil(endTime * sampleRate))
  for (const [freq, duration, delay, endFreq] of notes) {
    const start = Math.floor(delay * sampleRate)
    const count = Math.max(1, Math.floor(duration * sampleRate))
    let phase = 0
    for (let i = 0; i < count && start + i < samples.length; i++) {
      const t = i / sampleRate
      const u = i / count
      const f = endFreq ? freq * Math.pow(endFreq / freq, u) : freq
      phase += f / sampleRate
      const attack = Math.min(1, t / 0.015)
      const release = Math.pow(0.004, Math.max(0, (t - 0.015) / Math.max(0.001, duration - 0.015)))
      const env = attack * release
      samples[start + i] += sampleWave(phase, waveform) * env * volume
    }
  }
  return encodeWav(samples, sampleRate)
}

function godotEscape(text: string) {
  return text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function godotNodeName(raw: string | undefined, fallback: string, used: Set<string>) {
  const base = (raw || fallback).replace(/[^A-Za-z0-9_]/g, '_') || fallback
  let candidate = /^[A-Za-z_]/.test(base) ? base : '_' + base
  let n = 2
  while (used.has(candidate)) candidate = `${base}_${n++}`
  used.add(candidate)
  return candidate
}

/** Translate a Ridgetop pure-math LayoutNode UI tree into a Godot 4 `.tscn` Control scene. */
export function layoutToGodotTscn(root: LayoutNode, sceneName = 'GameUI'): string {
  const lines: string[] = [
    '[gd_scene format=3]',
    '',
    `[node name="${godotEscape(sceneName)}" type="Control"]`,
    'layout_mode = 3',
    'anchors_preset = 15',
    'anchor_right = 1.0',
    'anchor_bottom = 1.0',
    'grow_horizontal = 2',
    'grow_vertical = 2'
  ]

  function emit(node: LayoutNode, parentPath: string, siblingNames: Set<string>) {
    if (node.hidden) return
    const widget = node.widget as Record<string, unknown> | undefined
    const type = widget?.type === 'button' ? 'Button'
      : widget?.type === 'toggle' ? 'CheckButton'
      : widget?.type === 'select' ? 'OptionButton'
      : widget?.type === 'slider' ? 'HSlider'
      : widget?.type === 'text' ? 'Label'
      : widget?.type === 'panel' ? 'PanelContainer'
      : node.kind === 'column' ? 'VBoxContainer'
      : node.kind === 'row' ? 'HBoxContainer'
      : 'Control'
    const name = godotNodeName(node.id, type, siblingNames)
    const path = parentPath === '.' ? name : `${parentPath}/${name}`

    lines.push('')
    lines.push(`[node name="${name}" type="${type}" parent="${parentPath}"]`)
    lines.push('layout_mode = 2')
    if (node.style?.width && node.style?.height) {
      lines.push(`custom_minimum_size = Vector2(${node.style.width}, ${node.style.height})`)
    }
    if (node.style?.gap && (type === 'VBoxContainer' || type === 'HBoxContainer')) {
      lines.push(`theme_override_constants/separation = ${Math.round(node.style.gap)}`)
    }
    if ((type === 'Button' || type === 'CheckButton') && typeof widget?.label === 'string') {
      lines.push(`text = "${godotEscape(widget.label)}"`)
    } else if (type === 'Label' && typeof widget?.text === 'string') {
      lines.push(`text = "${godotEscape(widget.text)}"`)
    } else if (type === 'HSlider' && typeof widget?.ratio === 'number') {
      lines.push('min_value = 0.0', 'max_value = 1.0', `value = ${widget.ratio.toFixed(3)}`)
    }
    if (type === 'CheckButton' && typeof widget?.checked === 'boolean') {
      lines.push(`button_pressed = ${widget.checked}`)
    }

    const childNames = new Set<string>()
    for (const child of node.children ?? []) emit(child, path, childNames)
  }

  const topNames = new Set<string>()
  for (const child of root.children ?? []) emit(child, '.', topNames)
  return lines.join('\n') + '\n'
}

export interface GodotExportOptions {
  outDir: string
  name: string
  slug: string
  models: Record<string, readonly InstanceBatch[]>
  audio?: Record<string, { notes: readonly (readonly [number, number, number, number?])[]; waveform?: 'sine' | 'triangle' | 'square' | 'sawtooth' }>
  gameData: Record<string, unknown>
  uiTree?: LayoutNode
  iconPng: Buffer
}

/** Emit a complete Godot 4 project (GLB 3D models, WAV SFX, JSON data, Control UI scene, Switch/Gamepad input map). */
export async function exportGodotProject(options: GodotExportOptions) {
  const { outDir, name, slug, models, audio = {}, gameData, uiTree, iconPng } = options
  const modelsDir = join(outDir, 'assets', 'models')
  const audioDir = join(outDir, 'assets', 'audio')
  const dataDir = join(outDir, 'data')
  const scenesDir = join(outDir, 'scenes')
  const scriptsDir = join(outDir, 'scripts')
  await Promise.all([
    mkdir(modelsDir, { recursive: true }),
    mkdir(audioDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(scenesDir, { recursive: true }),
    mkdir(scriptsDir, { recursive: true })
  ])

  const exportedModels: string[] = []
  for (const [modelName, batches] of Object.entries(models)) {
    const safe = modelName.replace(/[^a-zA-Z0-9_-]+/g, '-')
    await writeFile(join(modelsDir, `${safe}.glb`), encodeGlb(batches, modelName))
    exportedModels.push(safe)
  }

  const exportedAudio: string[] = []
  for (const [clipName, spec] of Object.entries(audio)) {
    const safe = clipName.replace(/[^a-zA-Z0-9_-]+/g, '-')
    await writeFile(join(audioDir, `${safe}.wav`), bakeMotifWav(spec.notes, { waveform: spec.waveform }))
    exportedAudio.push(safe)
  }

  await writeFile(join(dataDir, 'game.json'), JSON.stringify({
    name, slug, models: exportedModels, audio: exportedAudio, ...gameData
  }, null, 2) + '\n')
  await writeFile(join(outDir, 'icon.png'), iconPng)

  if (uiTree) {
    await writeFile(join(scenesDir, 'ui.tscn'), layoutToGodotTscn(uiTree, 'GameUI'))
  }

  await writeFile(join(scriptsDir, 'main.gd'), `extends Node3D

# Auto-generated Ridgetop -> Godot 4 bootstrapper.
# Loads exported data/game.json and places exported assets/models/*.glb instances.

var game_data: Dictionary = {}

func _ready() -> void:
\tvar raw := FileAccess.get_file_as_string("res://data/game.json")
\tif raw != "":
\t\tvar parsed = JSON.parse_string(raw)
\t\tif typeof(parsed) == TYPE_DICTIONARY:
\t\t\tgame_data = parsed
\tprint("Loaded Ridgetop export: ", game_data.get("name", "${godotEscape(name)}"))
\t_spawn_preview_models()

func _spawn_preview_models() -> void:
\tvar names: Array = game_data.get("models", [])
\tfor i in range(names.size()):
\t\tvar path := "res://assets/models/%s.glb" % str(names[i])
\t\tif ResourceLoader.exists(path):
\t\t\tvar packed: PackedScene = load(path)
\t\t\tif packed:
\t\t\t\tvar node := packed.instantiate()
\t\t\t\tnode.position = Vector3((i - (names.size() - 1) * 0.5) * 2.2, 0.0, 0.0)
\t\t\t\tadd_child(node)
`)

  const uiExt = uiTree ? '[ext_resource type="PackedScene" path="res://scenes/ui.tscn" id="2_ui"]\n' : ''
  const uiNode = uiTree ? '\n[node name="UI" parent="." instance=ExtResource("2_ui")]\n' : ''
  await writeFile(join(scenesDir, 'main.tscn'), `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://scripts/main.gd" id="1_main"]
${uiExt}
[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.866025, 0.5, 0, -0.5, 0.866025, 0, 4.5, 7.5)
current = true

[node name="DirectionalLight3D" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.848, -0.355, 0.393, 0, 0.742, 0.67, -0.53, -0.568, 0.629, 0, 6, 4)
${uiNode}`)

  await writeFile(join(outDir, 'project.godot'), `; Engine configuration file generated by Ridgetop.
config_version=5

[application]

config/name="${godotEscape(name)}"
run/main_scene="res://scenes/main.tscn"
config/features=PackedStringArray("4.3", "GL Compatibility")
config/icon="res://icon.png"

[display]

window/size/viewport_width=1280
window/size/viewport_height=720
window/stretch/mode="canvas_items"
window/stretch/aspect="expand"

[input]

move_left={
"deadzone": 0.35,
"events": [Object(InputEventJoypadButton,"button_index":13,"pressed":true), Object(InputEventJoypadMotion,"axis":0,"axis_value":-1.0)]
}
move_right={
"deadzone": 0.35,
"events": [Object(InputEventJoypadButton,"button_index":14,"pressed":true), Object(InputEventJoypadMotion,"axis":0,"axis_value":1.0)]
}
move_up={
"deadzone": 0.35,
"events": [Object(InputEventJoypadButton,"button_index":11,"pressed":true), Object(InputEventJoypadMotion,"axis":1,"axis_value":-1.0)]
}
move_down={
"deadzone": 0.35,
"events": [Object(InputEventJoypadButton,"button_index":12,"pressed":true), Object(InputEventJoypadMotion,"axis":1,"axis_value":1.0)]
}
action_confirm={
"deadzone": 0.5,
"events": [Object(InputEventJoypadButton,"button_index":0,"pressed":true)]
}
action_cancel={
"deadzone": 0.5,
"events": [Object(InputEventJoypadButton,"button_index":1,"pressed":true)]
}
action_pause={
"deadzone": 0.5,
"events": [Object(InputEventJoypadButton,"button_index":6,"pressed":true)]
}

[rendering]

renderer/rendering_method="gl_compatibility"
`)

  await writeFile(join(outDir, 'README.md'), `# ${name} — Godot 4 Export (Nintendo Switch / Console Pipeline)

Generated directly from Ridgetop with zero external dependencies.

## What was exported

- **3D Models (\`assets/models/*.glb\`):** ${exportedModels.length} binary glTF 2.0 meshes with flat normals and vertex colors matching Ridgetop's low-poly renderer.
- **Audio (\`assets/audio/*.wav\`):** ${exportedAudio.length} baked 16-bit 44.1 kHz PCM sound effects synthesized from Ridgetop's Web Audio motifs.
- **Game Data (\`data/game.json\`):** Maps, palettes, and level metadata.
- **UI Scene (\`scenes/ui.tscn\`):** Godot \`Control\` hierarchy translated directly from Ridgetop's Layout SDK (no HTML/CSS required).
- **Controller Input (\`project.godot\`):** Standard Joy-Con / Pro Controller / Xbox / DualSense mappings pre-configured.

## Opening in Godot 4 & exporting to Nintendo Switch

1. Open \`project.godot\` in **Godot 4.3+**.
2. Translate your deterministic game simulation (\`game/simulation.ts\` or \`racing/race.ts\`) into \`scripts/\` (GDScript or C#) and connect it to the loaded \`data/game.json\` and \`assets/models/*.glb\`.
3. For **Nintendo Switch 1**, use your Nintendo Developer NX SDK access with Godot's console export middleware (e.g. W4 Consoles or a Switch export template) to build the NSP/NRO directly from this Godot project.
`)

  return { models: exportedModels, audio: exportedAudio }
}
