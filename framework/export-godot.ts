import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstanceBatch } from './types.ts'
import type { LayoutNode } from './ui-layout.ts'
import { rotateVec3 } from './geometry.ts'

function pad4(length: number) {
  return (4 - (length % 4)) % 4
}

function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** Encode one or more Ridgetop InstanceBatches into a valid binary glTF 2.0 (.glb) mesh with flat normals and linear vertex colors. */
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
      const r = srgbToLinear(iData[base + 12])
      const g = srgbToLinear(iData[base + 13])
      const b = srgbToLinear(iData[base + 14])
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
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunk.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)

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
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
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
      samples[start + i] += sampleWave(phase, waveform) * attack * release * volume
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

function anchorLines(node: LayoutNode): string[] {
  const anchor = node.style?.anchor
  if (!anchor) return []
  const w = node.style?.width ?? 340
  const h = node.style?.height ?? 240
  const inset = typeof node.style?.inset === 'number' ? node.style.inset : (node.style?.inset?.[0] ?? 16)
  if (anchor === 'fill') {
    return ['layout_mode = 1', 'anchors_preset = 15', 'anchor_right = 1.0', 'anchor_bottom = 1.0', 'grow_horizontal = 2', 'grow_vertical = 2']
  }
  if (anchor === 'center') {
    return [
      'layout_mode = 1',
      'anchors_preset = 8',
      'anchor_left = 0.5',
      'anchor_top = 0.5',
      'anchor_right = 0.5',
      'anchor_bottom = 0.5',
      `offset_left = ${-Math.round(w / 2)}.0`,
      `offset_top = ${-Math.round(h / 2)}.0`,
      `offset_right = ${Math.round(w / 2)}.0`,
      `offset_bottom = ${Math.round(h / 2)}.0`,
      'grow_horizontal = 2',
      'grow_vertical = 2'
    ]
  }
  if (anchor === 'top') {
    return [
      'layout_mode = 1',
      'anchors_preset = 5',
      'anchor_left = 0.5',
      'anchor_right = 0.5',
      `offset_left = ${-Math.round(w / 2)}.0`,
      `offset_top = ${inset}.0`,
      `offset_right = ${Math.round(w / 2)}.0`,
      `offset_bottom = ${inset + h}.0`,
      'grow_horizontal = 2'
    ]
  }
  if (anchor === 'top-right') {
    return [
      'layout_mode = 1',
      'anchors_preset = 1',
      'anchor_left = 1.0',
      'anchor_right = 1.0',
      `offset_left = ${-(inset + w)}.0`,
      `offset_top = ${inset}.0`,
      `offset_right = ${-inset}.0`,
      `offset_bottom = ${inset + h}.0`,
      'grow_horizontal = 0'
    ]
  }
  if (anchor === 'bottom-right') {
    return [
      'layout_mode = 1',
      'anchors_preset = 3',
      'anchor_left = 1.0',
      'anchor_top = 1.0',
      'anchor_right = 1.0',
      'anchor_bottom = 1.0',
      `offset_left = ${-(inset + w)}.0`,
      `offset_top = ${-(inset + h)}.0`,
      `offset_right = ${-inset}.0`,
      `offset_bottom = ${-inset}.0`,
      'grow_horizontal = 0',
      'grow_vertical = 0'
    ]
  }
  return ['layout_mode = 1', `offset_left = ${inset}.0`, `offset_top = ${inset}.0`]
}

/** Translate a Ridgetop pure-math LayoutNode UI tree into a styled Godot 4 `.tscn` Control scene. */
export function layoutToGodotTscn(root: LayoutNode, sceneName = 'GameUI'): string {
  const lines: string[] = [
    '[gd_scene load_steps=2 format=3]',
    '',
    '[sub_resource type="StyleBoxFlat" id="StyleBoxFlat_panel"]',
    'content_margin_left = 18.0',
    'content_margin_top = 16.0',
    'content_margin_right = 18.0',
    'content_margin_bottom = 16.0',
    'bg_color = Color(0.086, 0.157, 0.173, 0.92)',
    'border_width_left = 2',
    'border_width_top = 2',
    'border_width_right = 2',
    'border_width_bottom = 2',
    'border_color = Color(0.39, 0.53, 0.50, 0.65)',
    'corner_radius_top_left = 6',
    'corner_radius_top_right = 6',
    'corner_radius_bottom_right = 6',
    'corner_radius_bottom_left = 6',
    '',
    `[node name="${godotEscape(sceneName)}" type="Control"]`,
    'layout_mode = 3',
    'anchors_preset = 15',
    'anchor_right = 1.0',
    'anchor_bottom = 1.0',
    'grow_horizontal = 2',
    'grow_vertical = 2',
    'mouse_filter = 2'
  ]

  function emit(node: LayoutNode, parentPath: string, siblingNames: Set<string>, inContainer: boolean) {
    if (node.hidden) return
    const widget = node.widget as Record<string, unknown> | undefined
    const isPanelContainer = widget?.type === 'panel' && (node.kind === 'column' || node.kind === 'row')
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
    if (!inContainer && node.style?.anchor) {
      lines.push(...anchorLines(node))
    } else {
      lines.push('layout_mode = 2')
    }
    if (node.style?.grow && inContainer) {
      lines.push('size_flags_horizontal = 3')
    }
    if (node.style?.width || node.style?.height) {
      lines.push(`custom_minimum_size = Vector2(${node.style.width ?? 0}, ${node.style.height ?? 0})`)
    }
    if (type === 'PanelContainer') {
      lines.push('theme_override_styles/panel = SubResource("StyleBoxFlat_panel")')
    }
    if (node.style?.gap && (type === 'VBoxContainer' || type === 'HBoxContainer')) {
      lines.push(`theme_override_constants/separation = ${Math.round(node.style.gap)}`)
    }
    if ((type === 'Button' || type === 'CheckButton') && typeof widget?.label === 'string') {
      lines.push(`text = "${godotEscape(widget.label)}"`)
    } else if (type === 'Label' && typeof widget?.text === 'string') {
      lines.push(`text = "${godotEscape(widget.text)}"`)
      if (widget.align === 'center') lines.push('horizontal_alignment = 1')
      else if (widget.align === 'right') lines.push('horizontal_alignment = 2')
      if (typeof widget.size === 'number') lines.push(`theme_override_font_sizes/font_size = ${Math.round(widget.size)}`)
    } else if (type === 'HSlider' && typeof widget?.ratio === 'number') {
      lines.push('min_value = 0.0', 'max_value = 1.0', `value = ${widget.ratio.toFixed(3)}`)
    }
    if (type === 'CheckButton' && typeof widget?.checked === 'boolean') {
      lines.push(`button_pressed = ${widget.checked}`)
    }

    // PanelContainer in Godot overlays multiple direct children, so wrap column/row children in an inner VBox/HBoxContainer.
    let childParent = path
    if (isPanelContainer && (node.children?.length ?? 0) > 0) {
      const boxType = node.kind === 'row' ? 'HBoxContainer' : 'VBoxContainer'
      const boxName = 'Content'
      childParent = `${path}/${boxName}`
      lines.push('')
      lines.push(`[node name="${boxName}" type="${boxType}" parent="${path}"]`)
      lines.push('layout_mode = 2')
      if (node.style?.gap) lines.push(`theme_override_constants/separation = ${Math.round(node.style.gap)}`)
    }

    const childNames = new Set<string>()
    const nextInContainer = isPanelContainer || type === 'VBoxContainer' || type === 'HBoxContainer' || type === 'PanelContainer'
    for (const child of node.children ?? []) emit(child, childParent, childNames, nextInContainer)
  }

  const topNames = new Set<string>()
  for (const child of root.children ?? []) emit(child, '.', topNames, false)
  return lines.join('\n') + '\n'
}

function renderMainGd(name: string) {
  return `extends Node3D

# Auto-generated Ridgetop -> Godot 4 runtime.
# Plays grid/collection games directly from data/game.json, or runs an interactive 3D showcase
# for custom games with baked .glb models, .wav synth SFX, and Control UI.

var game_data: Dictionary = {}
var models_cache: Dictionary = {}
var sound_enabled: bool = true
var sfx_player: AudioStreamPlayer

# Grid game state (active when data/game.json includes a starter map)
var is_grid_game: bool = false
var map_rows: Array = []
var map_w: int = 0
var map_h: int = 0
var solid_cells: Dictionary = {}
var pickup_nodes: Dictionary = {}
var player_node: Node3D
var player_pos := Vector2i.ZERO
var from_world := Vector3.ZERO
var to_world := Vector3.ZERO
var spawn_pos := Vector2i.ZERO
var goal_pos := Vector2i.ZERO
var total_pickups: int = 0
var step_seconds: float = 0.16
var travel: float = 0.0
var won: bool = false
var paused: bool = false
var showcase_root: Node3D

var hud_label: Label
var menu_panel: Control

func _ready() -> void:
\tsfx_player = AudioStreamPlayer.new()
\tadd_child(sfx_player)
\tvar raw := FileAccess.get_file_as_string("res://data/game.json")
\tif raw != "":
\t\tvar parsed = JSON.parse_string(raw)
\t\tif typeof(parsed) == TYPE_DICTIONARY:
\t\t\tgame_data = parsed

\t_bind_ui()
\tvar map_data = game_data.get("map", [])
\tif typeof(map_data) == TYPE_ARRAY and map_data.size() > 0:
\t\tis_grid_game = true
\t\t_setup_grid_game(map_data)
\telse:
\t\t_setup_showcase()

func _load_model(model_name: String) -> PackedScene:
\tif models_cache.has(model_name):
\t\treturn models_cache[model_name]
\tvar path := "res://assets/models/%s.glb" % model_name
\tif ResourceLoader.exists(path):
\t\tvar packed = load(path)
\t\tif packed is PackedScene:
\t\t\tmodels_cache[model_name] = packed
\t\t\treturn packed
\treturn null

func _spawn_model(model_name: String, pos: Vector3, parent: Node = self) -> Node3D:
\tvar packed := _load_model(model_name)
\tif packed == null:
\t\treturn null
\tvar node := packed.instantiate() as Node3D
\tif node:
\t\tnode.position = pos
\t\tparent.add_child(node)
\treturn node

func _play_sfx(clip_name: String) -> void:
\tif not sound_enabled:
\t\treturn
\tvar path := "res://assets/audio/%s.wav" % clip_name
\tif ResourceLoader.exists(path):
\t\tvar stream = load(path)
\t\tif stream is AudioStream:
\t\t\tsfx_player.stream = stream
\t\t\tsfx_player.play()

func _bind_ui() -> void:
\tvar ui := get_node_or_null("UI")
\tif ui == null:
\t\treturn
\t# Create a compact HUD banner at top-left for live status.
\thud_label = Label.new()
\thud_label.position = Vector2(20, 16)
\thud_label.add_theme_font_size_override("font_size", 18)
\tui.add_child(hud_label)

\tmenu_panel = ui.get_node_or_null("menu_card")
\t_wire_buttons(ui)

func _wire_buttons(node: Node) -> void:
\tif node is CheckButton:
\t\tnode.toggled.connect(func(pressed: bool): sound_enabled = pressed)
\telif node is Button:
\t\tvar text_lower := node.text.to_lower()
\t\tnode.pressed.connect(func(): _on_ui_button(text_lower))
\tfor child in node.get_children():
\t\t_wire_buttons(child)

func _on_ui_button(label: String) -> void:
\tvar clips: Array = game_data.get("audio", [])
\tif clips.size() > 0:
\t\t_play_sfx(str(clips[0]))
\tif "resume" in label or "start" in label:
\t\tpaused = false
\t\tif menu_panel:
\t\t\tmenu_panel.visible = false
\telif "restart" in label or "again" in label:
\t\tif is_grid_game:
\t\t\t_restart_grid()
\t\tpaused = false
\t\tif menu_panel:
\t\t\tmenu_panel.visible = false
\telif "quit" in label:
\t\tget_tree().quit()

func _setup_grid_game(rows: Array) -> void:
\tmap_rows = rows
\tmap_h = rows.size()
\tmap_w = str(rows[0]).length()
\tstep_seconds = float(game_data.get("stepSeconds", 0.16))
\tvar ground_role := str(game_data.get("ground", "tile"))
\tvar goal_role := str(game_data.get("goal", "lantern"))
\tvar scenery: Dictionary = game_data.get("scenery", {})

\tvar world := Node3D.new()
\tworld.name = "World"
\tadd_child(world)

\tfor z in range(map_h):
\t\tvar line := str(rows[z])
\t\tfor x in range(map_w):
\t\t\tvar ch := line.substr(x, 1)
\t\t\t_spawn_model(ground_role, Vector3(x, 0, z), world)
\t\t\tif ch == "@":
\t\t\t\tspawn_pos = Vector2i(x, z)
\t\t\telif ch == "L":
\t\t\t\tgoal_pos = Vector2i(x, z)
\t\t\t\t_spawn_model(goal_role, Vector3(x, 0, z), world)
\t\t\telif scenery.has(ch):
\t\t\t\tsolid_cells[Vector2i(x, z)] = true
\t\t\t\t_spawn_model(str(scenery[ch]), Vector3(x, 0, z), world)

\tvar cx := (map_w - 1) * 0.5
\tvar cz := (map_h - 1) * 0.5
\tvar dist := maxf(map_w, map_h) * 2.0 + 8.0
\tvar cam := get_node_or_null("Camera3D") as Camera3D
\tif cam:
\t\tcam.projection = Camera3D.PROJECTION_ORTHOGONAL
\t\tcam.size = maxf(map_h * 0.5 + 3.8, (map_w + 2.0) * 0.62)
\t\tcam.position = Vector3(cx, 0.5 + dist * 0.5, cz + dist * cos(PI / 6.0))
\t\tcam.look_at(Vector3(cx, 0.5, cz), Vector3.UP)

\tplayer_node = _spawn_model(str(game_data.get("player", "ranger")), Vector3.ZERO)
\t_restart_grid()
\tif menu_panel:
\t\tmenu_panel.visible = false

func _restart_grid() -> void:
\tfor node in pickup_nodes.values():
\t\tif is_instance_valid(node):
\t\t\tnode.queue_free()
\tpickup_nodes.clear()
\tvar pickup_role := str(game_data.get("pickup", "crystal"))
\tfor z in range(map_h):
\t\tvar line := str(map_rows[z])
\t\tfor x in range(map_w):
\t\t\tif line.substr(x, 1) == "*":
\t\t\t\tvar p := _spawn_model(pickup_role, Vector3(x, 0, z))
\t\t\t\tif p:
\t\t\t\t\tpickup_nodes[Vector2i(x, z)] = p
\ttotal_pickups = pickup_nodes.size()
\tplayer_pos = spawn_pos
\tfrom_world = Vector3(player_pos.x, 0, player_pos.y)
\tto_world = from_world
\ttravel = 0.0
\twon = false
\tif player_node:
\t\tplayer_node.position = from_world
\t_update_hud()

func _update_hud() -> void:
\tif hud_label == null:
\t\treturn
\tif is_grid_game:
\t\tvar found := total_pickups - pickup_nodes.size()
\t\tvar msg := str(game_data.get("victory", "Complete!")) if won else (str(game_data.get("objective", "Collect all pickups.")) if pickup_nodes.size() > 0 else str(game_data.get("returnToGoal", "Reach the goal.")))
\t\thud_label.text = "%s  ·  %d / %d  ·  %s  (Esc / Start: Menu)" % [str(game_data.get("name", "${godotEscape(name)}")), found, total_pickups, msg]
\telse:
\t\thud_label.text = "%s  ·  Godot 4 Export  (Esc / Start: Menu)" % str(game_data.get("name", "${godotEscape(name)}"))

func _setup_showcase() -> void:
\tshowcase_root = Node3D.new()
\tadd_child(showcase_root)
\tvar names: Array = game_data.get("models", [])
\tfor i in range(names.size()):
\t\t_spawn_model(str(names[i]), Vector3((i - (names.size() - 1) * 0.5) * 2.4, 0.0, 0.0), showcase_root)
\t_update_hud()

func _unhandled_input(event: InputEvent) -> void:
\tif event.is_action_pressed("action_pause"):
\t\tpaused = not paused
\t\tif menu_panel:
\t\t\tmenu_panel.visible = paused

func _process(delta: float) -> void:
\tif not is_grid_game:
\t\tif showcase_root:
\t\t\tshowcase_root.rotate_y(delta * 0.55)
\t\treturn
\tif paused or won:
\t\treturn
\tif travel > 0.0:
\t\ttravel = maxf(0.0, travel - delta)
\t\tvar u := 1.0 - (travel / maxf(0.001, step_seconds))
\t\tif player_node:
\t\t\tvar pos := from_world.lerp(to_world, u)
\t\t\tpos.y = 0.08 * sin(PI * u)
\t\t\tplayer_node.position = pos
\t\tif travel == 0.0:
\t\t\t_arrive_cell()
\t\treturn

\tvar dir := Vector2i.ZERO
\tif Input.is_action_pressed("move_left"):
\t\tdir = Vector2i(-1, 0)
\telif Input.is_action_pressed("move_right"):
\t\tdir = Vector2i(1, 0)
\telif Input.is_action_pressed("move_up"):
\t\tdir = Vector2i(0, -1)
\telif Input.is_action_pressed("move_down"):
\t\tdir = Vector2i(0, 1)
\tif dir == Vector2i.ZERO:
\t\treturn

\tif player_node:
\t\tplayer_node.rotation.y = atan2(dir.x, dir.y)
\tvar next_cell := player_pos + dir
\tif next_cell.x < 0 or next_cell.x >= map_w or next_cell.y < 0 or next_cell.y >= map_h or solid_cells.has(next_cell):
\t\treturn
\tfrom_world = Vector3(player_pos.x, 0, player_pos.y)
\tplayer_pos = next_cell
\tto_world = Vector3(player_pos.x, 0, player_pos.y)
\ttravel = step_seconds

func _arrive_cell() -> void:
\tif pickup_nodes.has(player_pos):
\t\tvar node = pickup_nodes[player_pos]
\t\tif is_instance_valid(node):
\t\t\tnode.queue_free()
\t\tpickup_nodes.erase(player_pos)
\t\t_play_sfx("pickup")
\t\t_update_hud()
\tif pickup_nodes.is_empty() and player_pos == goal_pos:
\t\twon = true
\t\t_play_sfx("victory")
\t\t_update_hud()
\t\tif menu_panel:
\t\t\tmenu_panel.visible = true
`
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

/** Emit a complete Godot 4 project (GLB 3D models, WAV SFX, JSON data, Control UI scene, Keyboard+Switch/Gamepad input map). */
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

  await writeFile(join(scriptsDir, 'main.gd'), renderMainGd(name))

  const uiExt = uiTree ? '[ext_resource type="PackedScene" path="res://scenes/ui.tscn" id="2_ui"]\n' : ''
  const uiNode = uiTree ? '\n[node name="UI" parent="." instance=ExtResource("2_ui")]\n' : ''
  const loadSteps = uiTree ? 4 : 3
  await writeFile(join(scenesDir, 'main.tscn'), `[gd_scene load_steps=${loadSteps} format=3]

[ext_resource type="Script" path="res://scripts/main.gd" id="1_main"]
${uiExt}
[sub_resource type="Environment" id="Environment_ridgetop"]
background_mode = 1
background_color = Color(0.129, 0.224, 0.243, 1)
ambient_light_source = 2
ambient_light_color = Color(0.86, 0.93, 0.94, 1)
ambient_light_energy = 0.62

[node name="Main" type="Node3D"]
script = ExtResource("1_main")

[node name="WorldEnvironment" type="WorldEnvironment" parent="."]
environment = SubResource("Environment_ridgetop")

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 0.866025, 0.5, 0, -0.5, 0.866025, 0, 4.2, 7.2)
current = true

[node name="DirectionalLight3D" type="DirectionalLight3D" parent="."]
transform = Transform3D(0.848, -0.355, 0.393, 0, 0.742, 0.67, -0.53, -0.568, 0.629, 0, 6, 4)
light_energy = 1.15
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
"events": [Object(InputEventKey,"physical_keycode":65), Object(InputEventKey,"physical_keycode":4194319), Object(InputEventJoypadButton,"button_index":13,"pressed":true), Object(InputEventJoypadMotion,"axis":0,"axis_value":-1.0)]
}
move_right={
"deadzone": 0.35,
"events": [Object(InputEventKey,"physical_keycode":68), Object(InputEventKey,"physical_keycode":4194321), Object(InputEventJoypadButton,"button_index":14,"pressed":true), Object(InputEventJoypadMotion,"axis":0,"axis_value":1.0)]
}
move_up={
"deadzone": 0.35,
"events": [Object(InputEventKey,"physical_keycode":87), Object(InputEventKey,"physical_keycode":4194320), Object(InputEventJoypadButton,"button_index":11,"pressed":true), Object(InputEventJoypadMotion,"axis":1,"axis_value":-1.0)]
}
move_down={
"deadzone": 0.35,
"events": [Object(InputEventKey,"physical_keycode":83), Object(InputEventKey,"physical_keycode":4194322), Object(InputEventJoypadButton,"button_index":12,"pressed":true), Object(InputEventJoypadMotion,"axis":1,"axis_value":1.0)]
}
action_confirm={
"deadzone": 0.5,
"events": [Object(InputEventKey,"physical_keycode":32), Object(InputEventKey,"physical_keycode":4194309), Object(InputEventJoypadButton,"button_index":0,"pressed":true)]
}
action_cancel={
"deadzone": 0.5,
"events": [Object(InputEventKey,"physical_keycode":4194305), Object(InputEventJoypadButton,"button_index":1,"pressed":true)]
}
action_pause={
"deadzone": 0.5,
"events": [Object(InputEventKey,"physical_keycode":4194305), Object(InputEventJoypadButton,"button_index":6,"pressed":true)]
}

[rendering]

renderer/rendering_method="gl_compatibility"
`)

  await writeFile(join(outDir, 'README.md'), `# ${name} — Godot 4 Export (Nintendo Switch / Console Pipeline)

Generated directly from Ridgetop with zero external dependencies.

## What was exported

- **3D Models (\`assets/models/*.glb\`):** ${exportedModels.length} binary glTF 2.0 meshes with flat normals and linear vertex colors matching Ridgetop's low-poly renderer.
- **Audio (\`assets/audio/*.wav\`):** ${exportedAudio.length} baked 16-bit 44.1 kHz PCM sound effects synthesized from Ridgetop's Web Audio motifs.
- **Game Data (\`data/game.json\`):** Maps, palettes, rules metadata, and asset bindings.
- **UI Scene (\`scenes/ui.tscn\`):** Styled Godot \`Control\` hierarchy translated directly from Ridgetop's Layout SDK (no HTML/CSS required).
- **Controls (\`project.godot\`):** Keyboard (WASD / Arrows / Space / Esc) + Joy-Con / Pro Controller / Xbox / DualSense mappings pre-configured.

## Run in Godot 4

\`\`\`sh
godot --path .                    # run directly
godot --path . --editor           # open in Godot 4 editor
godot --headless --path . --import --quit   # headless agent/CI import validation
\`\`\`
`)

  return { models: exportedModels, audio: exportedAudio }
}
