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

/** Encode one or more Ridgetop InstanceBatches into a valid binary glTF 2.0 (.glb) mesh with flat normals and per-color PBR/emissive materials. */
export function encodeGlb(batches: readonly InstanceBatch[], name = 'RidgetopModel'): Buffer {
  // Group geometry by quantized (r, g, b, unlit) so every glTF viewer (Godot 4, Blender, Switch) renders exact colors & glow natively.
  type Bucket = {
    r: number; g: number; b: number; unlit: number
    positions: number[]
    normals: number[]
    min: [number, number, number]
    max: [number, number, number]
  }
  const buckets = new Map<string, Bucket>()

  for (const batch of batches) {
    const vData = batch.mesh.data
    const vCount = batch.mesh.vertexCount
    const iData = batch.data
    for (let i = 0; i < batch.count; i++) {
      const base = i * 16
      const px = iData[base], py = iData[base + 1], pz = iData[base + 2]
      const sx = iData[base + 4], sy = iData[base + 5], sz = iData[base + 6]
      const r = srgbToLinear(Math.max(0, Math.min(1, iData[base + 8])))
      const g = srgbToLinear(Math.max(0, Math.min(1, iData[base + 9])))
      const b = srgbToLinear(Math.max(0, Math.min(1, iData[base + 10])))
      const unlit = Math.max(0, Math.min(1, iData[base + 11]))
      const qx = iData[base + 12], qy = iData[base + 13], qz = iData[base + 14], qw = iData[base + 15]
      const q: readonly [number, number, number, number] = [qx, qy, qz, qw]

      const key = `${Math.round(r * 1000)}:${Math.round(g * 1000)}:${Math.round(b * 1000)}:${Math.round(unlit * 100)}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { r, g, b, unlit, positions: [], normals: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
        buckets.set(key, bucket)
      }

      for (let v = 0; v < vCount; v++) {
        const vb = v * 6
        const [rx, ry, rz] = rotateVec3(q, [vData[vb] * sx, vData[vb + 1] * sy, vData[vb + 2] * sz])
        const wx = px + rx, wy = py + ry, wz = pz + rz
        const [nx, ny, nz] = rotateVec3(q, [vData[vb + 3] / sx, vData[vb + 4] / sy, vData[vb + 5] / sz])
        const nLen = Math.hypot(nx, ny, nz) || 1
        bucket.positions.push(wx, wy, wz)
        bucket.normals.push(nx / nLen, ny / nLen, nz / nLen)
        if (wx < bucket.min[0]) bucket.min[0] = wx; if (wx > bucket.max[0]) bucket.max[0] = wx
        if (wy < bucket.min[1]) bucket.min[1] = wy; if (wy > bucket.max[1]) bucket.max[1] = wy
        if (wz < bucket.min[2]) bucket.min[2] = wz; if (wz > bucket.max[2]) bucket.max[2] = wz
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
    accessors.push({ bufferView: posView, componentType: 5126, count: vertCount, type: 'VEC3', min: bucket.min, max: bucket.max })
    const normAcc = accessors.length
    accessors.push({ bufferView: normView, componentType: 5126, count: vertCount, type: 'VEC3' })

    const matIndex = materials.length
    const mat: Record<string, unknown> = {
      name: `Flat_${matIndex}`,
      pbrMetallicRoughness: {
        baseColorFactor: [bucket.r, bucket.g, bucket.b, 1],
        metallicFactor: 0,
        roughnessFactor: 0.92
      }
    }
    if (bucket.unlit > 0.02) {
      mat.emissiveFactor = [bucket.r * bucket.unlit, bucket.g * bucket.unlit, bucket.b * bucket.unlit]
    }
    materials.push(mat)
    primitives.push({ attributes: { POSITION: posAcc, NORMAL: normAcc }, material: matIndex })
  }

  const binRaw = Buffer.concat(chunks)
  const binPad = Buffer.alloc(pad4(binRaw.length), 0)
  const binChunk = Buffer.concat([binRaw, binPad])

  const gltf = {
    asset: { version: '2.0', generator: 'Ridgetop' },
    scene: 0,
    scenes: [{ name, nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    materials,
    meshes: [{ name, primitives }],
    buffers: [{ byteLength: binChunk.length }],
    bufferViews,
    accessors
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
  return ['layout_mode = 1', `offset_left = ${inset}.0`, `offset_top = ${Math.max(56, inset)}.0`]
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

function renderCanvasUiGd() {
  return `extends Control

# Custom Ridgetop Canvas UI renderer for Godot 4 (zero default Godot widgets).
# Draws the same low-poly chamfered faceted panels, accent buttons, toggles, and HUD cards
# as framework/ui-canvas.ts directly inside CanvasItem._draw().

signal action_triggered(id: String)
signal back_pressed()

var items: Array = []
var theme_cfg: Dictionary = {
\t"surface": Color("#16282ceb"),
\t"surfaceAlt": Color("#213a3ff2"),
\t"top": Color("#35575c88"),
\t"border": Color("#63867f99"),
\t"accent": Color("#efac62"),
\t"accentText": Color("#162326"),
\t"text": Color("#f3f6e4"),
\t"muted": Color("#bcd2c8"),
\t"glow": Color("#83f0d6"),
\t"scrim": Color("#0b161bc4")
}

var hovered_id: String = ""
var focused_id: String = ""
var pressed_id: String = ""
var _nav_cooldown: float = 0.0
var _font: Font

func _ready() -> void:
\tset_anchors_preset(Control.PRESET_FULL_RECT)
\tmouse_filter = Control.MOUSE_FILTER_PASS
\t_font = ThemeDB.fallback_font

func apply_theme(cfg: Dictionary) -> void:
\tfor key in cfg.keys():
\t\tvar val = cfg[key]
\t\tif val is String:
\t\t\ttheme_cfg[key] = Color(val)
\t\telif val is Color:
\t\t\ttheme_cfg[key] = val
\tqueue_redraw()

func set_items(next_items: Array) -> void:
\titems = next_items
\tvar focusables := _focusable_items()
\tif focusables.is_empty():
\t\tfocused_id = ""
\telif not _has_focusable(focused_id):
\t\tfocused_id = str(focusables[0].get("id", ""))
\tqueue_redraw()

func _focusable_items() -> Array:
\tvar out: Array = []
\tfor item in items:
\t\tvar t := str(item.get("type", ""))
\t\tif (t == "button" or t == "toggle") and not bool(item.get("disabled", false)):
\t\t\tout.append(item)
\treturn out

func _has_focusable(id: String) -> bool:
\tif id == "":
\t\treturn false
\tfor item in _focusable_items():
\t\tif str(item.get("id", "")) == id:
\t\t\treturn true
\treturn false

func _hit_test(pos: Vector2) -> Dictionary:
\tfor i in range(items.size() - 1, -1, -1):
\t\tvar item: Dictionary = items[i]
\t\tvar t := str(item.get("type", ""))
\t\tif (t == "button" or t == "toggle") and not bool(item.get("disabled", false)):
\t\t\tvar r: Rect2 = item.get("rect", Rect2())
\t\t\tif r.has_point(pos):
\t\t\t\treturn item
\treturn {}

func _gui_input(event: InputEvent) -> void:
\tif event is InputEventMouseMotion:
\t\tvar hit := _hit_test(event.position)
\t\tvar next_hover := str(hit.get("id", ""))
\t\tif next_hover != hovered_id:
\t\t\thovered_id = next_hover
\t\t\tmouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if hovered_id != "" else Control.CURSOR_ARROW
\t\t\tqueue_redraw()
\telif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
\t\tvar hit := _hit_test(event.position)
\t\tif event.pressed:
\t\t\tif not hit.is_empty():
\t\t\t\tpressed_id = str(hit.get("id", ""))
\t\t\t\tfocused_id = pressed_id
\t\t\t\taccept_event()
\t\t\t\tqueue_redraw()
\t\telse:
\t\t\tif pressed_id != "":
\t\t\t\tvar target := pressed_id
\t\t\t\tpressed_id = ""
\t\t\t\tif not hit.is_empty() and str(hit.get("id", "")) == target:
\t\t\t\t\taction_triggered.emit(target)
\t\t\t\taccept_event()
\t\t\t\tqueue_redraw()

func _process(delta: float) -> void:
\t_nav_cooldown = maxf(0.0, _nav_cooldown - delta)

func handle_menu_input(event: InputEvent) -> bool:
\tvar focusables := _focusable_items()
\tif focusables.is_empty():
\t\treturn false
\tif event.is_action_pressed("action_cancel"):
\t\tback_pressed.emit()
\t\treturn true
\tif event.is_action_pressed("move_down") or event.is_action_pressed("move_right"):
\t\t_move_focus(1)
\t\treturn true
\tif event.is_action_pressed("move_up") or event.is_action_pressed("move_left"):
\t\t_move_focus(-1)
\t\treturn true
\tif event.is_action_pressed("action_confirm"):
\t\tvar id := focused_id if _has_focusable(focused_id) else str(focusables[0].get("id", ""))
\t\tif id != "":
\t\t\taction_triggered.emit(id)
\t\t\treturn true
\treturn false

func _move_focus(delta: int) -> void:
\tvar focusables := _focusable_items()
\tif focusables.is_empty():
\t\treturn
\tvar idx := -1
\tfor i in range(focusables.size()):
\t\tif str(focusables[i].get("id", "")) == focused_id:
\t\t\tidx = i
\t\t\tbreak
\tvar next_idx := (idx + delta + focusables.size()) % focusables.size() if idx >= 0 else (0 if delta > 0 else focusables.size() - 1)
\tfocused_id = str(focusables[next_idx].get("id", ""))
\tqueue_redraw()

func _chamfer_points(rect: Rect2, bevel: float) -> PackedVector2Array:
\tvar b := minf(bevel, minf(rect.size.x / 3.0, rect.size.y / 3.0))
\tvar x := rect.position.x
\tvar y := rect.position.y
\tvar w := rect.size.x
\tvar h := rect.size.y
\treturn PackedVector2Array([
\t\tVector2(x + b, y), Vector2(x + w - b, y),
\t\tVector2(x + w, y + b), Vector2(x + w, y + h - b),
\t\tVector2(x + w - b, y + h), Vector2(x + b, y + h),
\t\tVector2(x, y + h - b), Vector2(x, y + b)
\t])

func _draw_faceted(rect: Rect2, fill: Color, stroke: Color, highlight: Color, bevel: float = 7.0) -> void:
\tvar pts := _chamfer_points(rect, bevel)
\tdraw_colored_polygon(pts, fill)
\tif highlight.a > 0.01 and rect.size.y >= 16.0:
\t\tvar b := minf(bevel, rect.size.x / 3.0)
\t\tvar top_h := maxf(2.0, rect.size.y * 0.14)
\t\tdraw_rect(Rect2(rect.position.x + b * 0.7, rect.position.y + 1.0, maxf(1.0, rect.size.x - b * 1.4), top_h), highlight)
\tvar outline := pts.duplicate()
\toutline.append(pts[0])
\tdraw_polyline(outline, stroke, 1.5, true)

func _draw() -> void:
\tvar surface: Color = theme_cfg["surface"]
\tvar surface_alt: Color = theme_cfg["surfaceAlt"]
\tvar top_hi: Color = theme_cfg["top"]
\tvar border: Color = theme_cfg["border"]
\tvar accent: Color = theme_cfg["accent"]
\tvar accent_text: Color = theme_cfg["accentText"]
\tvar text_col: Color = theme_cfg["text"]
\tvar muted_col: Color = theme_cfg["muted"]
\tvar scrim_col: Color = theme_cfg["scrim"]

\tfor item in items:
\t\tvar t := str(item.get("type", ""))
\t\tvar rect: Rect2 = item.get("rect", Rect2())
\t\tif t == "scrim":
\t\t\tdraw_rect(rect, item.get("fill", scrim_col))
\t\telif t == "panel":
\t\t\t_draw_faceted(rect, item.get("fill", surface), item.get("stroke", border), top_hi, float(item.get("bevel", 7.0)))
\t\telif t == "bar":
\t\t\tvar ratio := clampf(float(item.get("ratio", 0.0)), 0.0, 1.0)
\t\t\tdraw_rect(rect, item.get("bg", Color("#4a342c")))
\t\t\tif ratio > 0.0:
\t\t\t\tdraw_rect(Rect2(rect.position, Vector2(rect.size.x * ratio, rect.size.y)), item.get("fill", theme_cfg["glow"]))
\t\telif t == "text":
\t\t\tvar txt := str(item.get("text", ""))
\t\t\tvar fsize := int(item.get("size", 15))
\t\t\tvar col: Color = item.get("color", text_col)
\t\t\tvar align := str(item.get("align", "left"))
\t\t\tvar ha := HORIZONTAL_ALIGNMENT_CENTER if align == "center" else (HORIZONTAL_ALIGNMENT_RIGHT if align == "right" else HORIZONTAL_ALIGNMENT_LEFT)
\t\t\tvar baseline_y := rect.position.y + rect.size.y * 0.5 + fsize * 0.34
\t\t\tdraw_string(_font, Vector2(rect.position.x, baseline_y), txt, ha, rect.size.x, fsize, col)
\t\telif t == "button" or t == "toggle":
\t\t\tvar id := str(item.get("id", ""))
\t\t\tvar disabled := bool(item.get("disabled", false))
\t\t\tvar is_hover := (not disabled) and hovered_id == id
\t\t\tvar is_focus := (not disabled) and focused_id == id
\t\t\tvar is_press := (not disabled) and pressed_id == id
\t\t\tvar primary := bool(item.get("primary", false)) if t == "button" else bool(item.get("checked", false))
\t\t\tvar fill := Color("#161d20aa") if disabled else (accent if primary else (top_hi if is_press else (surface_alt if is_hover else surface)))
\t\t\tvar stroke := Color("#404d5055") if disabled else (accent if (is_focus or is_hover) else border)
\t\t\tvar hi := Color(1, 1, 1, 0.20) if primary else top_hi
\t\t\tvar draw_rect_box := Rect2(rect.position + Vector2(0, 1.5 if is_press else 0.0), rect.size)
\t\t\t_draw_faceted(draw_rect_box, fill, stroke, hi, 7.0)
\t\t\tvar label := str(item.get("label", ""))
\t\t\tif t == "toggle":
\t\t\t\tlabel = "%s: %s" % [label, "ON" if bool(item.get("checked", false)) else "OFF"]
\t\t\tvar subtitle := str(item.get("subtitle", ""))
\t\t\tvar label_col := accent_text if primary else (muted_col if disabled else text_col)
\t\t\tif subtitle != "":
\t\t\t\tdraw_string(_font, Vector2(draw_rect_box.position.x + 14.0, draw_rect_box.position.y + draw_rect_box.size.y * 0.42), label, HORIZONTAL_ALIGNMENT_LEFT, draw_rect_box.size.x - 28.0, 15, label_col)
\t\t\t\tdraw_string(_font, Vector2(draw_rect_box.position.x + 14.0, draw_rect_box.position.y + draw_rect_box.size.y * 0.78), subtitle, HORIZONTAL_ALIGNMENT_LEFT, draw_rect_box.size.x - 28.0, 11, accent_text if primary else muted_col)
\t\t\telse:
\t\t\t\tvar fsize := int(item.get("size", 15))
\t\t\t\tdraw_string(_font, Vector2(draw_rect_box.position.x, draw_rect_box.position.y + draw_rect_box.size.y * 0.5 + fsize * 0.34), label, HORIZONTAL_ALIGNMENT_CENTER, draw_rect_box.size.x, fsize, label_col)
`
}

function renderMainGd(name: string) {
  return `extends Node3D

# Auto-generated Ridgetop -> Godot 4 playable runtime.
# Uses custom CanvasItem UI (scripts/ridgetop_ui.gd) — zero ugly default Godot widgets!
# Supports:
#   1. Playable Signal Drift 3D arcade racer (all 4 circuits, AI rivals, drift, Pulse/Snare, HUD & menus)
#   2. Playable Lantern Grove / starter grid games (full tile map, movement, pickups, audio & menus)
#   3. Interactive 3D showcase fallback for other exports

var game_data: Dictionary = {}
var models_cache: Dictionary = {}
var sound_enabled: bool = true
var sfx_player: AudioStreamPlayer
var ui: Control
var world_env: WorldEnvironment
var camera: Camera3D

var mode: String = "showcase" # "racing" | "grid" | "showcase"

# --- Grid game state (Lantern Grove / create-game projects) ---
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
var grid_won: bool = false
var grid_paused: bool = false

# --- Signal Drift racing state ---
var circuits: Array = []
var circuit_index: int = 0
var race_screen: String = "home" # "home" | "events" | "racing" | "paused" | "results"
var track_root: Node3D
var car_nodes: Array = []
var drivers: Array = []
var race_countdown: float = 0.0
var race_elapsed: float = 0.0
var race_result: Dictionary = {}
var snares: Array = []

# --- Showcase state ---
var showcase_root: Node3D
var showcase_menu_open: bool = true

func _ready() -> void:
\tsfx_player = AudioStreamPlayer.new()
\tadd_child(sfx_player)
\tworld_env = get_node_or_null("WorldEnvironment") as WorldEnvironment
\tcamera = get_node_or_null("Camera3D") as Camera3D
\tui = get_node_or_null("UI") as Control
\tif ui:
\t\tui.action_triggered.connect(_on_ui_action)
\t\tui.back_pressed.connect(_on_ui_back)

\tvar raw := FileAccess.get_file_as_string("res://data/game.json")
\tif raw != "":
\t\tvar parsed = JSON.parse_string(raw)
\t\tif typeof(parsed) == TYPE_DICTIONARY:
\t\t\tgame_data = parsed

\tif ui and game_data.has("theme") and typeof(game_data["theme"]) == TYPE_DICTIONARY:
\t\tui.apply_theme(game_data["theme"])
\telif ui and game_data.has("palette") and typeof(game_data["palette"]) == TYPE_DICTIONARY:
\t\tvar pal: Dictionary = game_data["palette"]
\t\tif pal.has("accent"):
\t\t\tui.apply_theme({ "accent": str(pal["accent"]), "glow": str(pal.get("glow", "#83f0d6")) })

\tget_viewport().size_changed.connect(_rebuild_ui)

\tif str(game_data.get("game", "")) == "signal-drift" and typeof(game_data.get("circuits", [])) == TYPE_ARRAY and (game_data["circuits"] as Array).size() > 0:
\t\tmode = "racing"
\t\tcircuits = game_data["circuits"]
\t\t_load_circuit(0)
\telif typeof(game_data.get("map", [])) == TYPE_ARRAY and (game_data["map"] as Array).size() > 0:
\t\tmode = "grid"
\t\t_setup_grid_game(game_data["map"])
\telse:
\t\tmode = "showcase"
\t\t_setup_showcase()
\t_rebuild_ui()

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

func _input(event: InputEvent) -> void:
\tif event.is_action_pressed("action_pause"):
\t\t_toggle_pause()
\t\tget_viewport().set_input_as_handled()
\t\treturn
\tif mode == "racing" and race_screen == "racing":
\t\tif event is InputEventKey and event.pressed and not event.echo:
\t\t\tvar ke := event as InputEventKey
\t\t\tif ke.physical_keycode == KEY_J:
\t\t\t\t_fire_pulse(0)
\t\t\telif ke.physical_keycode == KEY_K:
\t\t\t\t_drop_snare(0)
\t\t\telif ke.physical_keycode == KEY_R:
\t\t\t\t_recover_driver(0)
\t\treturn
\tif ui and _menu_is_active():
\t\tif ui.handle_menu_input(event):
\t\t\tget_viewport().set_input_as_handled()

func _menu_is_active() -> bool:
\tif mode == "racing":
\t\treturn race_screen != "racing"
\tif mode == "grid":
\t\treturn grid_paused or grid_won
\treturn showcase_menu_open

func _toggle_pause() -> void:
\tif mode == "racing":
\t\tif race_screen == "racing":
\t\t\trace_screen = "paused"
\t\telif race_screen == "paused":
\t\t\trace_screen = "racing"
\t\telif race_screen == "events" or race_screen == "results":
\t\t\trace_screen = "home"
\telif mode == "grid":
\t\tif not grid_won:
\t\t\tgrid_paused = not grid_paused
\telse:
\t\tshowcase_menu_open = not showcase_menu_open
\t_rebuild_ui()

func _on_ui_back() -> void:
\t_toggle_pause()

func _on_ui_action(id: String) -> void:
\tif id == "sound":
\t\tsound_enabled = not sound_enabled
\t\t_rebuild_ui()
\t\treturn
\tif id == "quit":
\t\tget_tree().quit()
\t\treturn

\tif mode == "racing":
\t\tif id == "race-start":
\t\t\tif race_screen == "paused":
\t\t\t\trace_screen = "racing"
\t\t\telse:
\t\t\t\t_start_race(circuit_index)
\t\telif id == "race-events":
\t\t\trace_screen = "events"
\t\telif id == "race-restart":
\t\t\t_start_race(circuit_index)
\t\telif id == "race-home":
\t\t\trace_screen = "home"
\t\telif id == "race-pause":
\t\t\trace_screen = "paused"
\t\telif id == "race-recover":
\t\t\t_recover_driver(0)
\t\telif id == "race-next":
\t\t\t_start_race((circuit_index + 1) % circuits.size())
\t\telif id.begins_with("event-"):
\t\t\tvar idx := int(id.trim_prefix("event-"))
\t\t\t_start_race(idx)
\t\t_rebuild_ui()
\t\treturn

\tif mode == "grid":
\t\tif id == "menu":
\t\t\tgrid_paused = not grid_paused
\t\telif id == "resume":
\t\t\tgrid_paused = false
\t\telif id == "restart":
\t\t\tgrid_paused = false
\t\t\t_restart_grid()
\t\t_rebuild_ui()
\t\treturn

\tif id == "close-menu":
\t\tshowcase_menu_open = false
\telif id == "open-menu":
\t\tshowcase_menu_open = true
\telse:
\t\tvar clips: Array = game_data.get("audio", [])
\t\tif clips.size() > 0:
\t\t\t_play_sfx(str(clips[0]))
\t_rebuild_ui()

# ==============================================================================
# SIGNAL DRIFT — PLAYABLE 3D ARCADE RACER
# ==============================================================================

func _load_circuit(index: int) -> void:
\tcircuit_index = clampi(index, 0, circuits.size() - 1)
\tif track_root and is_instance_valid(track_root):
\t\ttrack_root.queue_free()
\ttrack_root = Node3D.new()
\ttrack_root.name = "CircuitRoot"
\tadd_child(track_root)

\tvar c: Dictionary = circuits[circuit_index]
\t_spawn_model("circuit-%s" % str(c["id"]), Vector3.ZERO, track_root)
\tif world_env and world_env.environment and c.has("clear"):
\t\tvar cl: Array = c["clear"]
\t\tworld_env.environment.background_color = Color(float(cl[0]), float(cl[1]), float(cl[2]), 1.0)

\tcar_nodes.clear()
\tdrivers.clear()
\tsnares.clear()
\tvar samples: Array = c["samples"]
\tvar n := samples.size()
\tfor slot in range(4):
\t\tvar si := (n - 2 - slot * 2) % n
\t\tvar pt: Array = samples[si]
\t\tvar px := float(pt[0])
\t\tvar pz := float(pt[1])
\t\tvar yaw := float(pt[2])
\t\tvar lat := -1.8 if (slot % 2 == 0) else 1.8
\t\tpx += cos(yaw) * lat
\t\tpz -= sin(yaw) * lat
\t\tvar car := _spawn_model("car-%d" % slot, Vector3(px, 0.0, pz), track_root)
\t\tif car:
\t\t\tcar.rotation.y = yaw
\t\tcar_nodes.append(car)
\t\tdrivers.append({
\t\t\t"slot": slot, "x": px, "z": pz, "vx": 0.0, "vz": 0.0, "yaw": yaw,
\t\t\t"speed": 0.0, "lap": 0, "checkpoint": 0, "progress": 0.0, "total": -float(slot) * 0.02,
\t\t\t"shield": 100, "max_shield": 100, "pulses": 4, "snares": 2, "disabled": 0.0,
\t\t\t"drift": false, "offroad": false, "finish": -1.0, "ai_lane": lat, "ai_pace": float(c.get("pace", 16.5)) * (0.95 + slot * 0.03)
\t\t})
\t_update_race_camera(false)

func _start_race(index: int) -> void:
\t_load_circuit(index)
\trace_countdown = 2.4
\trace_elapsed = 0.0
\trace_result = {}
\trace_screen = "racing"
\t_rebuild_ui()

func _nearest_sample(samples: Array, x: float, z: float) -> Dictionary:
\tvar best_i := 0
\tvar best_d := 1e9
\tfor i in range(samples.size()):
\t\tvar pt: Array = samples[i]
\t\tvar dx := x - float(pt[0])
\t\tvar dz := z - float(pt[1])
\t\tvar d := dx * dx + dz * dz
\t\tif d < best_d:
\t\t\tbest_d = d
\t\t\tbest_i = i
\tvar bp: Array = samples[best_i]
\treturn { "index": best_i, "distance": sqrt(best_d), "x": float(bp[0]), "z": float(bp[1]), "yaw": float(bp[2]), "t": float(best_i) / float(samples.size()) }

func _recover_driver(slot: int) -> void:
\tif slot < 0 or slot >= drivers.size():
\t\treturn
\tvar c: Dictionary = circuits[circuit_index]
\tvar samples: Array = c["samples"]
\tvar d: Dictionary = drivers[slot]
\tvar near := _nearest_sample(samples, float(d["x"]), float(d["z"]))
\td["x"] = near["x"]
\td["z"] = near["z"]
\td["yaw"] = near["yaw"]
\td["vx"] = 0.0
\td["vz"] = 0.0
\td["speed"] = 0.0

func _fire_pulse(slot: int) -> void:
\tif race_countdown > 0.0 or slot >= drivers.size():
\t\treturn
\tvar d: Dictionary = drivers[slot]
\tif int(d["pulses"]) <= 0 or float(d["disabled"]) > 0.0:
\t\treturn
\td["pulses"] = int(d["pulses"]) - 1
\t_play_sfx("pulse")
\tvar fx := sin(float(d["yaw"]))
\tvar fz := cos(float(d["yaw"]))
\tfor other in drivers:
\t\tif int(other["slot"]) == slot:
\t\t\tcontinue
\t\tvar dx := float(other["x"]) - float(d["x"])
\t\tvar dz := float(other["z"]) - float(d["z"])
\t\tvar dist := sqrt(dx * dx + dz * dz)
\t\tif dist < 16.0 and dist > 0.1 and (dx * fx + dz * fz) / dist > 0.82:
\t\t\tother["shield"] = maxi(0, int(other["shield"]) - 35)
\t\t\tother["speed"] = float(other["speed"]) * 0.45
\t\t\t_play_sfx("hit")
\t\t\tif int(other["shield"]) <= 0:
\t\t\t\tother["shield"] = int(other["max_shield"])
\t\t\t\tother["disabled"] = 1.2
\t\t\t\t_recover_driver(int(other["slot"]))

func _drop_snare(slot: int) -> void:
\tif race_countdown > 0.0 or slot >= drivers.size():
\t\treturn
\tvar d: Dictionary = drivers[slot]
\tif int(d["snares"]) <= 0 or float(d["disabled"]) > 0.0:
\t\treturn
\td["snares"] = int(d["snares"]) - 1
\tsnares.append({ "owner": slot, "x": float(d["x"]) - sin(float(d["yaw"])) * 2.4, "z": float(d["z"]) - cos(float(d["yaw"])) * 2.4, "ttl": 14.0 })
\t_play_sfx("snare")

func _step_racing(delta: float) -> void:
\tif race_screen != "racing":
\t\t_update_race_camera(false)
\t\treturn
\tif race_countdown > 0.0:
\t\tvar prev_c := ceili(race_countdown)
\t\trace_countdown = maxf(0.0, race_countdown - delta)
\t\tif race_countdown == 0.0 or ceili(race_countdown) != prev_c:
\t\t\tif race_countdown == 0.0:
\t\t\t\t_play_sfx("go")
\t\t_update_race_camera(true)
\t\t_rebuild_ui()
\t\treturn

\trace_elapsed += delta
\tvar c: Dictionary = circuits[circuit_index]
\tvar samples: Array = c["samples"]
\tvar n := samples.size()
\tvar half_w := float(c["width"]) * 0.5
\tvar laps := int(c["laps"])
\tvar grip := float(c.get("grip", 1.0))

\tfor i in range(snares.size() - 1, -1, -1):
\t\tsnares[i]["ttl"] = float(snares[i]["ttl"]) - delta
\t\tif float(snares[i]["ttl"]) <= 0.0:
\t\t\tsnares.remove_at(i)

\tfor i in range(drivers.size()):
\t\tvar d: Dictionary = drivers[i]
\t\tif float(d["disabled"]) > 0.0:
\t\t\td["disabled"] = maxf(0.0, float(d["disabled"]) - delta)
\t\t\tcontinue
\t\tvar near := _nearest_sample(samples, float(d["x"]), float(d["z"]))
\t\tvar offroad := float(near["distance"]) > half_w + 0.5
\t\td["offroad"] = offroad

\t\tvar throttle := 0.0
\t\tvar steer := 0.0
\t\tvar drift := false
\t\tif i == 0:
\t\t\tthrottle = (1.0 if (Input.is_action_pressed("move_up") or Input.is_action_pressed("action_confirm")) else 0.0) - (1.0 if Input.is_action_pressed("move_down") else 0.0)
\t\t\tsteer = (1.0 if Input.is_action_pressed("move_right") else 0.0) - (1.0 if Input.is_action_pressed("move_left") else 0.0)
\t\t\tdrift = Input.is_key_pressed(KEY_SPACE) or Input.is_action_pressed("action_cancel")
\t\telse:
\t\t\tvar look_idx := (int(near["index"]) + 4) % n
\t\t\tvar target_pt: Array = samples[look_idx]
\t\t\tvar tx := float(target_pt[0]) + cos(float(target_pt[2])) * float(d["ai_lane"])
\t\t\tvar tz := float(target_pt[1]) - sin(float(target_pt[2])) * float(d["ai_lane"])
\t\t\tvar desired := atan2(tx - float(d["x"]), tz - float(d["z"]))
\t\t\tvar diff := wrapf(desired - float(d["yaw"]), -PI, PI)
\t\t\tsteer = clampf(-diff * 2.4, -1.0, 1.0)
\t\t\tthrottle = 1.0 if absf(diff) < 0.7 else 0.45

\t\td["drift"] = drift and absf(float(d["speed"])) > 8.0
\t\tvar max_spd := (24.5 if i == 0 else float(d["ai_pace"])) * (0.64 if offroad else 1.0)
\t\tvar accel := 22.0 if throttle > 0.0 else (26.0 if throttle < 0.0 else 0.0)
\t\tvar spd := float(d["speed"])
\t\tspd += throttle * accel * delta
\t\tspd = move_toward(spd, 0.0, (9.5 if offroad else 5.2) * delta)
\t\tspd = clampf(spd, -7.0, max_spd)
\t\tvar turn_rate := (2.95 if bool(d["drift"]) else 2.25) * grip
\t\tvar turn_factor := clampf(absf(spd) / 6.0, 0.0, 1.0) * (-1.0 if spd < 0.0 else 1.0)
\t\tvar yaw := float(d["yaw"]) - steer * turn_rate * turn_factor * delta
\t\tvar fx := sin(yaw)
\t\tvar fz := cos(yaw)
\t\tvar lat_grip := (2.6 if bool(d["drift"]) else 7.2) * (0.55 if offroad else grip)
\t\tvar vx := lerpf(float(d["vx"]), fx * spd, clampf(lat_grip * delta, 0.0, 1.0))
\t\tvar vz := lerpf(float(d["vz"]), fz * spd, clampf(lat_grip * delta, 0.0, 1.0))
\t\td["x"] = float(d["x"]) + vx * delta
\t\td["z"] = float(d["z"]) + vz * delta
\t\td["vx"] = vx
\t\td["vz"] = vz
\t\td["yaw"] = yaw
\t\td["speed"] = spd

\t\t# Snare collision check
\t\tfor si in range(snares.size() - 1, -1, -1):
\t\t\tvar sn: Dictionary = snares[si]
\t\t\tif int(sn["owner"]) == i:
\t\t\t\tcontinue
\t\t\tif Vector2(float(d["x"]) - float(sn["x"]), float(d["z"]) - float(sn["z"])).length() < 2.2:
\t\t\t\td["speed"] = float(d["speed"]) * 0.35
\t\t\t\td["shield"] = maxi(0, int(d["shield"]) - 30)
\t\t\t\tsnares.remove_at(si)
\t\t\t\t_play_sfx("hit")

\t\t# Checkpoint & lap progression
\t\tvar prog := float(near["t"])
\t\tvar cp := int(d["checkpoint"])
\t\tif cp == 0 and prog > 0.2 and prog < 0.45:
\t\t\td["checkpoint"] = 1
\t\telif cp == 1 and prog > 0.45 and prog < 0.72:
\t\t\td["checkpoint"] = 2
\t\telif cp == 2 and prog > 0.72:
\t\t\td["checkpoint"] = 3
\t\telif cp == 3 and prog < 0.18:
\t\t\td["checkpoint"] = 0
\t\t\td["lap"] = int(d["lap"]) + 1
\t\t\tif i == 0 and int(d["lap"]) >= laps and float(d["finish"]) < 0.0:
\t\t\t\td["finish"] = race_elapsed
\t\t\t\tvar place := _driver_place(0)
\t\t\t\tvar qual := place <= int(c["qualify"])
\t\t\t\trace_result = { "place": place, "seconds": race_elapsed, "qualified": qual }
\t\t\t\tif qual:
\t\t\t\t\t_play_sfx("podium")
\t\t\t\trace_screen = "results"
\t\td["progress"] = prog
\t\td["total"] = float(d["lap"]) + prog

\t\tvar car: Node3D = car_nodes[i]
\t\tif car:
\t\t\tcar.position = Vector3(float(d["x"]), 0.0, float(d["z"]))
\t\t\tcar.rotation.y = yaw
\t\t\tcar.rotation.z = lerpf(car.rotation.z, steer * (0.12 if bool(d["drift"]) else 0.06), clampf(delta * 10.0, 0.0, 1.0))

\t_update_race_camera(true)
\t_rebuild_ui()

func _driver_place(slot: int) -> int:
\tvar target_total := float(drivers[slot]["total"])
\tvar rank := 1
\tfor d in drivers:
\t\tif int(d["slot"]) != slot and float(d["total"]) > target_total:
\t\t\trank += 1
\treturn rank

func _update_race_camera(follow: bool) -> void:
\tif camera == null or drivers.is_empty():
\t\treturn
\tcamera.projection = Camera3D.PROJECTION_ORTHOGONAL
\tif follow:
\t\tvar p: Dictionary = drivers[0]
\t\tvar target := Vector3(float(p["x"]), 0.0, float(p["z"]))
\t\tcamera.size = 38.0
\t\tcamera.position = target + Vector3(58.0, 58.0, 58.0)
\t\tcamera.look_at(target, Vector3.UP)
\telse:
\t\tcamera.size = 64.0
\t\tcamera.position = Vector3(68.0, 68.0, 68.0)
\t\tcamera.look_at(Vector3(0.0, 0.0, 0.0), Vector3.UP)

# ==============================================================================
# LANTERN GROVE / STARTER GRID GAME
# ==============================================================================

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
\tif camera:
\t\tcamera.projection = Camera3D.PROJECTION_ORTHOGONAL
\t\tcamera.size = maxf(map_h * 0.5 + 3.8, (map_w + 2.0) * 0.62)
\t\tcamera.position = Vector3(cx, 0.5 + dist * 0.5, cz + dist * cos(PI / 6.0))
\t\tcamera.look_at(Vector3(cx, 0.5, cz), Vector3.UP)

\tplayer_node = _spawn_model(str(game_data.get("player", "ranger")), Vector3.ZERO)
\t_restart_grid()

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
\tgrid_won = false
\tif player_node:
\t\tplayer_node.position = from_world
\t_rebuild_ui()

func _step_grid(delta: float) -> void:
\tif grid_paused or grid_won:
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
\t\t_rebuild_ui()
\tif pickup_nodes.is_empty() and player_pos == goal_pos:
\t\tgrid_won = true
\t\t_play_sfx("victory")
\t\t_rebuild_ui()

func _setup_showcase() -> void:
\tshowcase_root = Node3D.new()
\tadd_child(showcase_root)
\tvar names: Array = game_data.get("models", [])
\tfor i in range(names.size()):
\t\t_spawn_model(str(names[i]), Vector3((i - (names.size() - 1) * 0.5) * 2.4, 0.0, 0.0), showcase_root)
\tif camera:
\t\tcamera.position = Vector3(-1.0, 2.4, 5.2)
\t\tcamera.look_at(Vector3(-0.3, 0.5, 0.0), Vector3.UP)

func _process(delta: float) -> void:
\tif mode == "racing":
\t\t_step_racing(delta)
\telif mode == "grid":
\t\t_step_grid(delta)
\telif showcase_root:
\t\tshowcase_root.rotate_y(delta * 0.55)

# ==============================================================================
# CUSTOM LOW-POLY CANVAS UI LAYOUT (Ridgetop Aesthetic — Zero Default Controls)
# ==============================================================================

func _fmt_time(sec: float) -> String:
\tvar cs := int(floor(sec * 100.0))
\tvar rem := str(cs % 6000).pad_zeros(4)
\treturn "%d:%s.%s" % [cs / 6000, rem.substr(0, 2), rem.substr(2, 2)]

func _rebuild_ui() -> void:
\tif ui == null:
\t\treturn
\tvar vp := get_viewport().get_visible_rect().size
\tvar w := vp.x
\tvar h := vp.y
\tvar items: Array = []

\tif mode == "racing":
\t\tvar c: Dictionary = circuits[circuit_index]
\t\tif race_screen == "racing":
\t\t\tvar p: Dictionary = drivers[0]
\t\t\tvar pos := "%d / 4" % _driver_place(0)
\t\t\tvar lap_txt := "LAP %d / %d" % [mini(int(c["laps"]), int(p["lap"]) + 1), int(c["laps"])]
\t\t\tvar kmh := "%d" % roundi(Vector2(float(p["vx"]), float(p["vz"])).length() * 3.6)
\t\t\tvar surf := "REBOOTING" if float(p["disabled"]) > 0.0 else ("OFF TRACK" if bool(p["offroad"]) else ("DRIFTING" if bool(p["drift"]) else "ON TRACK"))
\t\t\titems.append({ "type": "panel", "rect": Rect2(18, 18, 210, 90) })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, 26, 90, 16), "text": "POSITION", "size": 11, "color": Color("#f3bd88") })
\t\t\titems.append({ "type": "text", "rect": Rect2(118, 26, 98, 16), "text": lap_txt, "size": 11, "align": "right", "color": Color("#f3bd88") })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, 44, 100, 32), "text": pos, "size": 26 })
\t\t\titems.append({ "type": "text", "rect": Rect2(118, 52, 98, 20), "text": _fmt_time(race_elapsed), "size": 13, "align": "right" })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, 82, 186, 18), "text": str(c["name"]).to_upper(), "size": 11, "color": Color("#f3bd88") })

\t\t\titems.append({ "type": "panel", "rect": Rect2(18, h - 126, 210, 108) })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, h - 118, 110, 34), "text": kmh, "size": 30 })
\t\t\titems.append({ "type": "text", "rect": Rect2(138, h - 106, 78, 18), "text": "KM/H", "size": 12, "align": "right", "color": Color("#f3bd88") })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, h - 78, 186, 16), "text": surf, "size": 11, "color": Color("#ff957c") if bool(p["offroad"]) else Color("#f3bd88") })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, h - 60, 186, 16), "text": "SHIELD %d / %d" % [int(p["shield"]), int(p["max_shield"])], "size": 11, "color": Color("#f3bd88") })
\t\t\titems.append({ "type": "bar", "rect": Rect2(30, h - 42, 186, 5), "ratio": float(p["shield"]) / maxf(1.0, float(p["max_shield"])) })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, h - 32, 186, 16), "text": "PULSE %d  ·  SNARE %d" % [int(p["pulses"]), int(p["snares"])], "size": 11 })

\t\t\titems.append({ "type": "button", "id": "race-recover", "rect": Rect2(w - 190, 18, 86, 38), "label": "Recover" })
\t\t\titems.append({ "type": "button", "id": "race-pause", "rect": Rect2(w - 96, 18, 78, 38), "label": "Pause" })
\t\t\tif race_countdown > 0.0:
\t\t\t\titems.append({ "type": "panel", "rect": Rect2(w * 0.5 - 42, h * 0.28 - 32, 84, 64) })
\t\t\t\titems.append({ "type": "text", "rect": Rect2(w * 0.5 - 42, h * 0.28 - 32, 84, 64), "text": str(ceili(race_countdown)), "size": 42, "align": "center" })
\t\telse:
\t\t\titems.append({ "type": "scrim", "rect": Rect2(0, 0, w, h), "fill": Color("#140f1296") if race_screen == "home" else Color("#120e0ec2") })
\t\t\tvar card_w := minf(w - 40.0, 480.0 if race_screen == "events" else 410.0)
\t\t\tvar card_h := 390.0 if race_screen == "events" else 318.0
\t\t\tvar cx := 48.0 if race_screen == "home" else (w - card_w) * 0.5
\t\t\tvar cy := (h - card_h) * 0.5
\t\t\titems.append({ "type": "panel", "rect": Rect2(cx, cy, card_w, card_h) })
\t\t\tvar title := "SIGNAL DRIFT" if race_screen == "home" else ("EVENTS" if race_screen == "events" else ("RACE PAUSED" if race_screen == "paused" else "RACE COMPLETE"))
\t\t\tvar kicker := "CHAMPIONSHIP" if race_screen == "home" else str(c["name"]).to_upper()
\t\t\titems.append({ "type": "text", "rect": Rect2(cx + 24, cy + 20, card_w - 48, 18), "text": kicker, "size": 12, "color": Color("#f8aa4e") })
\t\t\titems.append({ "type": "text", "rect": Rect2(cx + 24, cy + 44, card_w - 48, 40), "text": title, "size": 32 })
\t\t\tvar y := cy + 96.0
\t\t\tif race_screen == "events":
\t\t\t\tfor idx in range(circuits.size()):
\t\t\t\t\tvar ev: Dictionary = circuits[idx]
\t\t\t\t\titems.append({ "type": "button", "id": "event-%d" % idx, "rect": Rect2(cx + 24, y, card_w - 48, 50), "label": str(ev["name"]), "subtitle": "%d laps · Top %d · %s" % [int(ev["laps"]), int(ev["qualify"]), str(ev["description"])], "primary": idx == circuit_index })
\t\t\t\t\ty += 58.0
\t\t\t\titems.append({ "type": "button", "id": "race-home", "rect": Rect2(cx + 24, y + 6, card_w - 48, 40), "label": "Back" })
\t\t\telse:
\t\t\t\tvar desc := "%s · %d laps" % [str(c["name"]), int(c["laps"])]
\t\t\t\tif race_screen == "results" and not race_result.is_empty():
\t\t\t\t\tdesc = "Finished #%d · %s" % [int(race_result["place"]), _fmt_time(float(race_result["seconds"]))]
\t\t\t\titems.append({ "type": "text", "rect": Rect2(cx + 24, y, card_w - 48, 22), "text": desc, "size": 14, "color": Color("#d8beaa") })
\t\t\t\ty += 36.0
\t\t\t\titems.append({ "type": "button", "id": "race-start", "rect": Rect2(cx + 24, y, card_w - 48, 44), "label": ("Race " + str(c["name"])) if race_screen == "home" else ("Resume race" if race_screen == "paused" else "Race again"), "primary": true })
\t\t\t\ty += 52.0
\t\t\t\tvar half := (card_w - 56.0) * 0.5
\t\t\t\tif race_screen == "home":
\t\t\t\t\titems.append({ "type": "button", "id": "race-events", "rect": Rect2(cx + 24, y, half, 40), "label": "Events" })
\t\t\t\t\titems.append({ "type": "toggle", "id": "sound", "rect": Rect2(cx + 32 + half, y, half, 40), "label": "Sound", "checked": sound_enabled })
\t\t\t\t\ty += 48.0
\t\t\t\t\titems.append({ "type": "button", "id": "quit", "rect": Rect2(cx + 24, y, card_w - 48, 38), "label": "Quit" })
\t\t\t\telif race_screen == "paused":
\t\t\t\t\titems.append({ "type": "button", "id": "race-restart", "rect": Rect2(cx + 24, y, half, 40), "label": "Restart" })
\t\t\t\t\titems.append({ "type": "button", "id": "race-home", "rect": Rect2(cx + 32 + half, y, half, 40), "label": "Main menu" })
\t\t\t\telse:
\t\t\t\t\titems.append({ "type": "button", "id": "race-next", "rect": Rect2(cx + 24, y, half, 40), "label": "Next circuit" })
\t\t\t\t\titems.append({ "type": "button", "id": "race-home", "rect": Rect2(cx + 32 + half, y, half, 40), "label": "Main menu" })
\t\t\t\titems.append({ "type": "text", "rect": Rect2(cx + 24, cy + card_h - 30, card_w - 48, 18), "text": "WASD/Arrows Drive · Space Drift · J Pulse · K Snare · R Recover", "size": 11, "color": Color("#d8beaa"), "align": "center" })

\telif mode == "grid":
\t\tvar found := total_pickups - pickup_nodes.size()
\t\tvar msg := str(game_data.get("victory", "Complete!")) if grid_won else (str(game_data.get("objective", "Collect all pickups.")) if pickup_nodes.size() > 0 else str(game_data.get("returnToGoal", "Reach the goal.")))
\t\tvar bar_w := minf(w - 32.0, 920.0)
\t\tvar bx := (w - bar_w) * 0.5
\t\titems.append({ "type": "panel", "rect": Rect2(bx, 16, 92, 44) })
\t\titems.append({ "type": "text", "rect": Rect2(bx, 16, 92, 44), "text": "%d / %d" % [found, total_pickups], "size": 16, "align": "center", "color": Color("#83f0d6") })
\t\titems.append({ "type": "panel", "rect": Rect2(bx + 102, 16, bar_w - 196, 44) })
\t\titems.append({ "type": "text", "rect": Rect2(bx + 116, 16, bar_w - 224, 44), "text": "%s  —  %s" % [str(game_data.get("name", "${godotEscape(name)}")), msg], "size": 14 })
\t\titems.append({ "type": "button", "id": "menu", "rect": Rect2(bx + bar_w - 84, 16, 84, 44), "label": "Menu" })

\t\tif grid_paused or grid_won:
\t\t\titems.append({ "type": "scrim", "rect": Rect2(0, 0, w, h) })
\t\t\tvar cw := 340.0
\t\t\tvar ch := 280.0
\t\t\tvar mx := (w - cw) * 0.5
\t\t\tvar my := (h - ch) * 0.5
\t\t\titems.append({ "type": "panel", "rect": Rect2(mx, my, cw, ch) })
\t\t\titems.append({ "type": "text", "rect": Rect2(mx + 20, my + 20, cw - 40, 32), "text": msg if grid_won else str(game_data.get("name", "${godotEscape(name)}")), "size": 22, "align": "center" })
\t\t\tvar y := my + 72.0
\t\t\tif not grid_won:
\t\t\t\titems.append({ "type": "button", "id": "resume", "rect": Rect2(mx + 24, y, cw - 48, 42), "label": "Resume", "primary": true })
\t\t\t\ty += 50.0
\t\t\titems.append({ "type": "button", "id": "restart", "rect": Rect2(mx + 24, y, cw - 48, 42), "label": "Play Again" if grid_won else "Restart", "primary": grid_won })
\t\t\ty += 50.0
\t\t\titems.append({ "type": "toggle", "id": "sound", "rect": Rect2(mx + 24, y, cw - 48, 40), "label": "Sound", "checked": sound_enabled })
\t\t\ty += 48.0
\t\t\titems.append({ "type": "button", "id": "quit", "rect": Rect2(mx + 24, y, cw - 48, 38), "label": "Quit" })
\telse:
\t\tif showcase_menu_open:
\t\t\titems.append({ "type": "panel", "rect": Rect2(36, 36, 320, 240) })
\t\t\titems.append({ "type": "text", "rect": Rect2(56, 56, 280, 34), "text": str(game_data.get("name", "${godotEscape(name)}")).to_upper(), "size": 24, "align": "center" })
\t\t\titems.append({ "type": "button", "id": "close-menu", "rect": Rect2(56, 104, 280, 42), "label": "Inspect 3D Scene", "primary": true })
\t\t\titems.append({ "type": "toggle", "id": "sound", "rect": Rect2(56, 154, 280, 40), "label": "Sound", "checked": sound_enabled })
\t\t\titems.append({ "type": "button", "id": "quit", "rect": Rect2(56, 202, 280, 40), "label": "Quit" })
\t\telse:
\t\t\titems.append({ "type": "button", "id": "open-menu", "rect": Rect2(w - 102, 18, 84, 40), "label": "Menu" })

\tui.set_items(items)
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

  await writeFile(join(scriptsDir, 'ridgetop_ui.gd'), renderCanvasUiGd())
  await writeFile(join(scriptsDir, 'main.gd'), renderMainGd(name))
  await writeFile(join(scenesDir, 'ui.tscn'), `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/ridgetop_ui.gd" id="1_ui"]

[node name="GameUI" type="Control"]
layout_mode = 3
anchors_preset = 15
anchor_right = 1.0
anchor_bottom = 1.0
grow_horizontal = 2
grow_vertical = 2
script = ExtResource("1_ui")
`)

  await writeFile(join(scenesDir, 'main.tscn'), `[gd_scene load_steps=4 format=3]

[ext_resource type="Script" path="res://scripts/main.gd" id="1_main"]
[ext_resource type="PackedScene" path="res://scenes/ui.tscn" id="2_ui"]

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

[node name="UI" parent="." instance=ExtResource("2_ui")]
`)

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
