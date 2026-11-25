import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstanceBatch } from './types.ts'
import type { LayoutNode } from './ui-layout.ts'

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
          const vb = Number.isFinite(vColors[cb + 2]) ? Math.max(0, Math.min(1, vColors[cb + 2])) : 1
          cols.push(srgbToLinear(vr), srgbToLinear(vg), srgbToLinear(vb))
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

function godotEscape(text: string) {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')
}

function fmtFloat(n: number) {
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

function godotNodeName(raw: string | undefined, fallback: string, used: Set<string>) {
  const cleaned = (raw || fallback).replace(/[^A-Za-z0-9_]/g, '_') || fallback
  const base = /^[A-Za-z_]/.test(cleaned) ? cleaned : '_' + cleaned
  let candidate = base
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
  const rawInset = node.style?.inset
  const insetX = typeof rawInset === 'number' ? rawInset : (rawInset?.[0] ?? 16)
  const insetY = typeof rawInset === 'number' ? rawInset : (rawInset?.[1] ?? insetX)
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
      `offset_left = ${fmtFloat(-Math.round(w / 2))}`,
      `offset_top = ${fmtFloat(insetY)}`,
      `offset_right = ${fmtFloat(Math.round(w / 2))}`,
      `offset_bottom = ${fmtFloat(insetY + h)}`,
      'grow_horizontal = 2'
    ]
  }
  if (anchor === 'top-right') {
    return [
      'layout_mode = 1',
      'anchors_preset = 1',
      'anchor_left = 1.0',
      'anchor_right = 1.0',
      `offset_left = ${fmtFloat(-(insetX + w))}`,
      `offset_top = ${fmtFloat(insetY)}`,
      `offset_right = ${fmtFloat(-insetX)}`,
      `offset_bottom = ${fmtFloat(insetY + h)}`,
      'grow_horizontal = 0'
    ]
  }
  if (anchor === 'bottom') {
    return [
      'layout_mode = 1',
      'anchors_preset = 7',
      'anchor_left = 0.5',
      'anchor_top = 1.0',
      'anchor_right = 0.5',
      'anchor_bottom = 1.0',
      `offset_left = ${fmtFloat(-Math.round(w / 2))}`,
      `offset_top = ${fmtFloat(-(insetY + h))}`,
      `offset_right = ${fmtFloat(Math.round(w / 2))}`,
      `offset_bottom = ${fmtFloat(-insetY)}`,
      'grow_horizontal = 2',
      'grow_vertical = 0'
    ]
  }
  if (anchor === 'bottom-left') {
    return [
      'layout_mode = 1',
      'anchors_preset = 2',
      'anchor_top = 1.0',
      'anchor_bottom = 1.0',
      `offset_left = ${fmtFloat(insetX)}`,
      `offset_top = ${fmtFloat(-(insetY + h))}`,
      `offset_right = ${fmtFloat(insetX + w)}`,
      `offset_bottom = ${fmtFloat(-insetY)}`,
      'grow_vertical = 0'
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
      `offset_left = ${fmtFloat(-(insetX + w))}`,
      `offset_top = ${fmtFloat(-(insetY + h))}`,
      `offset_right = ${fmtFloat(-insetX)}`,
      `offset_bottom = ${fmtFloat(-insetY)}`,
      'grow_horizontal = 0',
      'grow_vertical = 0'
    ]
  }
  return [
    'layout_mode = 1',
    'anchors_preset = 0',
    `offset_left = ${fmtFloat(insetX)}`,
    `offset_top = ${fmtFloat(insetY)}`,
    `offset_right = ${fmtFloat(insetX + w)}`,
    `offset_bottom = ${fmtFloat(insetY + h)}`
  ]
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
    const widget = node.widget
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
\tif hovered_id != "" and not _has_focusable(hovered_id):
\t\thovered_id = ""
\t\tmouse_default_cursor_shape = Control.CURSOR_ARROW
\tif pressed_id != "" and not _has_focusable(pressed_id):
\t\tpressed_id = ""
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
\tif rect.size.x <= 0.0 or rect.size.y <= 0.0:
\t\treturn
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

function renderRuntimeGd() {
  return `extends Node3D

# Generic Ridgetop -> Godot 4 Runtime Bridge.
# Mirrors Ridgetop's core browser abstractions in native Godot 4:
#   - Low-Poly Renderer Bridge: Camera3D, DirectionalLight3D, WorldEnvironment (sky/ambient/distance fog),
#     up to 4 dynamic OmniLight3D point lights, and instanced MultiMeshInstance3D / pooled MeshInstance3D
#     batches supporting opaque, alpha, and additive blend modes.
#   - Rig & Animation Bridge: Hierarchical Node3D joint trees matching framework/animation.ts (createRig + JointPose).
#   - Particle Bridge: Pooled 3D velocity & parabolic-arc emitter matching createParticles().
#   - Soundscape & Audio Bridge: Multi-bus AudioServer mixer (Master, Music, SFX, Ambience) with WAV SFX
#     playback and ambient bed volume/filter control.
#   - Generic Asset, Compiled Module, and Persistent Save Storage helpers.

class GodotStorage extends RefCounted:
\tvar path: String = "user://ridgetop_save.json"
\tvar data: Dictionary = {}

\tfunc _init(save_path: String = "user://ridgetop_save.json") -> void:
\t\tpath = save_path
\t\tif FileAccess.file_exists(path):
\t\t\tvar raw := FileAccess.get_file_as_string(path)
\t\t\tvar parsed = JSON.parse_string(raw)
\t\t\tif typeof(parsed) == TYPE_DICTIONARY:
\t\t\t\tdata = parsed

\tfunc getItem(key: String) -> Variant:
\t\treturn data[key] if data.has(key) else null

\tfunc setItem(key: String, value: String) -> void:
\t\tdata[key] = value
\t\t_persist()

\tfunc removeItem(key: String) -> void:
\t\tdata.erase(key)
\t\t_persist()

\tfunc clear() -> void:
\t\tdata.clear()
\t\t_persist()

\tfunc _persist() -> void:
\t\tvar f := FileAccess.open(path, FileAccess.WRITE)
\t\tif f:
\t\t\tf.store_string(JSON.stringify(data))


class InstancedBatch extends RefCounted:
\tvar node: MultiMeshInstance3D
\tvar multimesh: MultiMesh
\tvar material: StandardMaterial3D
\tvar blend_mode: String = "opaque"
\tvar unlit: bool = false
\tvar count: int = 0
\tvar capacity: int = 0
\tvar _transforms: Array[Transform3D] = []
\tvar _colors: Array[Color] = []

\tfunc _init(mesh_res: Mesh, mat: StandardMaterial3D, blend: String, is_unlit: bool, initial_cap: int, parent_node: Node) -> void:
\t\tblend_mode = blend
\t\tunlit = is_unlit
\t\tmaterial = mat
\t\tcapacity = maxi(4, initial_cap)
\t\tmultimesh = MultiMesh.new()
\t\tmultimesh.transform_format = MultiMesh.TRANSFORM_3D
\t\tmultimesh.use_colors = true
\t\tmultimesh.mesh = mesh_res
\t\tmultimesh.instance_count = capacity
\t\tmultimesh.visible_instance_count = 0
\t\tnode = MultiMeshInstance3D.new()
\t\tnode.multimesh = multimesh
\t\tnode.material_override = material
\t\tif parent_node:
\t\t\tparent_node.add_child(node)

\tfunc clear() -> void:
\t\tcount = 0
\t\t_transforms.clear()
\t\t_colors.clear()
\t\tif multimesh:
\t\t\tmultimesh.visible_instance_count = 0

\tfunc _ensure_capacity(needed: int) -> void:
\t\tif needed <= capacity:
\t\t\treturn
\t\tvar next_cap := maxi(capacity * 2, needed)
\t\tcapacity = next_cap
\t\tmultimesh.instance_count = capacity
\t\tfor i in range(count):
\t\t\tmultimesh.set_instance_transform(i, _transforms[i])
\t\t\tmultimesh.set_instance_color(i, _colors[i])

\tfunc add(pos: Vector3, scl: Vector3 = Vector3.ONE, rot: Variant = 0.0, col: Color = Color.WHITE, _unlit_override: float = 0.0) -> void:
\t\t_ensure_capacity(count + 1)
\t\tvar q := _coerce_quat(rot)
\t\tvar safe_scl := Vector3(maxf(0.0001, scl.x), maxf(0.0001, scl.y), maxf(0.0001, scl.z))
\t\tvar xf := Transform3D(Basis(q).scaled_local(safe_scl), pos)
\t\t_transforms.append(xf)
\t\t_colors.append(col)
\t\tmultimesh.set_instance_transform(count, xf)
\t\tmultimesh.set_instance_color(count, col)
\t\tcount += 1
\t\tmultimesh.visible_instance_count = count

\tfunc flush() -> void:
\t\tif multimesh:
\t\t\tmultimesh.visible_instance_count = count

\tfunc get_count() -> int:
\t\treturn count

\tfunc get_blend_mode() -> String:
\t\treturn blend_mode

\tfunc dispose() -> void:
\t\tclear()
\t\tif node and is_instance_valid(node):
\t\t\tnode.queue_free()
\t\tnode = null

\tstatic func _coerce_quat(rot: Variant) -> Quaternion:
\t\tif rot is Quaternion:
\t\t\treturn rot as Quaternion
\t\tif rot is float or rot is int:
\t\t\treturn Quaternion(Vector3.UP, float(rot))
\t\tif rot is Vector3:
\t\t\tvar v := rot as Vector3
\t\t\treturn _euler_to_quat(v.x, v.y, v.z)
\t\tif rot is Array:
\t\t\tvar a := rot as Array
\t\t\tif a.size() >= 4:
\t\t\t\treturn Quaternion(float(a[0]), float(a[1]), float(a[2]), float(a[3])).normalized()
\t\t\tif a.size() >= 3:
\t\t\t\treturn _euler_to_quat(float(a[0]), float(a[1]), float(a[2]))
\t\treturn Quaternion.IDENTITY

\tstatic func _euler_to_quat(pitch: float, yaw: float, roll: float) -> Quaternion:
\t\tvar sx := sin(pitch * 0.5)
\t\tvar cx := cos(pitch * 0.5)
\t\tvar sy := sin(yaw * 0.5)
\t\tvar cy := cos(yaw * 0.5)
\t\tvar sz := sin(roll * 0.5)
\t\tvar cz := cos(roll * 0.5)
\t\treturn Quaternion(
\t\t\tcy * sx * cz + sy * cx * sz,
\t\t\tsy * cx * cz - cy * sx * sz,
\t\t\tcy * cx * sz - sy * sx * cz,
\t\t\tcy * cx * cz + sy * sx * sz
\t\t)


class MeshInstancePool extends RefCounted:
\tvar mesh: Mesh
\tvar base_material: StandardMaterial3D
\tvar blend_mode: String = "opaque"
\tvar unlit: float = 0.0
\tvar parent_node: Node
\tvar pool: Array[MeshInstance3D] = []
\tvar cursor: int = 0

\tfunc _init(mesh_res: Mesh, mat: StandardMaterial3D, blend: String, unlit_val: float, parent: Node) -> void:
\t\tmesh = mesh_res
\t\tbase_material = mat
\t\tblend_mode = blend
\t\tunlit = unlit_val
\t\tparent_node = parent

\tfunc begin_frame() -> void:
\t\tcursor = 0

\tfunc acquire(pos: Vector3 = Vector3.ZERO, scl: Vector3 = Vector3.ONE, rot: Variant = 0.0, col: Variant = null) -> MeshInstance3D:
\t\twhile pool.size() <= cursor:
\t\t\tvar mi := MeshInstance3D.new()
\t\t\tmi.mesh = mesh
\t\t\tmi.material_override = base_material.duplicate() as StandardMaterial3D
\t\t\tif parent_node:
\t\t\t\tparent_node.add_child(mi)
\t\t\tpool.append(mi)
\t\tvar node: MeshInstance3D = pool[cursor]
\t\tcursor += 1
\t\tnode.visible = true
\t\tnode.position = pos
\t\tnode.scale = Vector3(maxf(0.0001, scl.x), maxf(0.0001, scl.y), maxf(0.0001, scl.z))
\t\tnode.quaternion = InstancedBatch._coerce_quat(rot)
\t\tif col is Color:
\t\t\tvar mat := node.material_override as StandardMaterial3D
\t\t\tif mat:
\t\t\t\tvar c := col as Color
\t\t\t\tmat.albedo_color = c
\t\t\t\tif unlit > 0.02 and mat.shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED:
\t\t\t\t\tmat.emission_enabled = true
\t\t\t\t\tmat.emission = Color(c.r, c.g, c.b, 1.0)
\t\t\t\t\tmat.emission_energy_multiplier = unlit
\t\treturn node

\tfunc end_frame() -> void:
\t\tfor i in range(cursor, pool.size()):
\t\t\tif is_instance_valid(pool[i]):
\t\t\t\tpool[i].visible = false

\tfunc get_active_count() -> int:
\t\treturn cursor

\tfunc get_pool_size() -> int:
\t\treturn pool.size()

\tfunc dispose() -> void:
\t\tfor mi in pool:
\t\t\tif is_instance_valid(mi):
\t\t\t\tmi.queue_free()
\t\tpool.clear()
\t\tcursor = 0


class RigInstance extends RefCounted:
\tvar root: Node3D
\tvar joints: Dictionary = {}
\tvar pivots: Dictionary = {}
\tvar parent_ids: Dictionary = {}
\tvar order: Array[String] = []
\tvar world_transforms: Dictionary = {}

\tfunc _init(parent_node: Node) -> void:
\t\troot = Node3D.new()
\t\troot.name = "RigRoot"
\t\tif parent_node:
\t\t\tparent_node.add_child(root)

\tfunc get_joint(joint_id: String) -> Node3D:
\t\tif joints.has(joint_id):
\t\t\treturn joints[joint_id] as Node3D
\t\treturn null

\tfunc get_joint_world_position(joint_id: String) -> Vector3:
\t\tif world_transforms.has(joint_id):
\t\t\tvar xf: Dictionary = world_transforms[joint_id]
\t\t\treturn xf.get("position", Vector3.ZERO) as Vector3
\t\treturn Vector3.ZERO

\tfunc apply_poses(poses: Dictionary, root_pose: Dictionary = {}) -> Dictionary:
\t\tvar root_pos := root.position
\t\tif root_pose.has("position"):
\t\t\troot_pos = _vec3_from(root_pose["position"], root_pos)
\t\tvar root_rot := root.quaternion
\t\tif root_pose.has("rotation"):
\t\t\troot_rot = InstancedBatch._coerce_quat(root_pose["rotation"])
\t\telif root_pose.has("yaw"):
\t\t\troot_rot = Quaternion(Vector3.UP, float(root_pose["yaw"]))
\t\tvar root_scl := root.scale
\t\tif root_pose.has("scale"):
\t\t\tvar sv = root_pose["scale"]
\t\t\tif sv is float or sv is int:
\t\t\t\tvar sf := maxf(0.0001, float(sv))
\t\t\t\troot_scl = Vector3(sf, sf, sf)
\t\t\telse:
\t\t\t\troot_scl = _vec3_from(sv, Vector3.ONE)
\t\t\t\troot_scl = Vector3(maxf(0.0001, root_scl.x), maxf(0.0001, root_scl.y), maxf(0.0001, root_scl.z))
\t\troot.position = root_pos
\t\troot.quaternion = root_rot
\t\troot.scale = root_scl

\t\tfor jid in order:
\t\t\tvar pose: Dictionary = {}
\t\t\tif poses.has(jid) and poses[jid] is Dictionary:
\t\t\t\tpose = poses[jid] as Dictionary
\t\t\tvar pid := str(parent_ids.get(jid, ""))
\t\t\tvar p_pos := root_pos
\t\t\tvar p_rot := root_rot
\t\t\tvar p_scl := root_scl
\t\t\tif pid != "" and world_transforms.has(pid):
\t\t\t\tvar pxf: Dictionary = world_transforms[pid]
\t\t\t\tp_pos = pxf["position"] as Vector3
\t\t\t\tp_rot = pxf["quaternion"] as Quaternion
\t\t\t\tp_scl = pxf["scale"] as Vector3

\t\t\tvar piv: Vector3 = pivots.get(jid, Vector3.ZERO) as Vector3
\t\t\tvar off := _vec3_from(pose.get("position", Vector3.ZERO), Vector3.ZERO) if pose.has("position") else Vector3.ZERO
\t\t\tvar local_pos := piv + off
\t\t\tvar local_rot := InstancedBatch._coerce_quat(pose["rotation"]) if pose.has("rotation") else Quaternion.IDENTITY
\t\t\tvar raw_scl := Vector3.ONE
\t\t\tif pose.has("scale"):
\t\t\t\tvar jsv = pose["scale"]
\t\t\t\tif jsv is float or jsv is int:
\t\t\t\t\tvar jsf := float(jsv)
\t\t\t\t\traw_scl = Vector3(jsf, jsf, jsf)
\t\t\t\telse:
\t\t\t\t\traw_scl = _vec3_from(jsv, Vector3.ONE)
\t\t\tvar local_scl := Vector3(maxf(0.0001, raw_scl.x), maxf(0.0001, raw_scl.y), maxf(0.0001, raw_scl.z))

\t\t\tvar jnode: Node3D = joints[jid] as Node3D
\t\t\tif jnode and is_instance_valid(jnode):
\t\t\t\tjnode.position = local_pos
\t\t\t\tjnode.quaternion = local_rot
\t\t\t\tjnode.scale = local_scl

\t\t\tvar scaled_local := Vector3(local_pos.x * p_scl.x, local_pos.y * p_scl.y, local_pos.z * p_scl.z)
\t\t\tvar w_pos := p_pos + (p_rot * scaled_local)
\t\t\tvar w_rot := (p_rot * local_rot).normalized()
\t\t\tvar w_scl := Vector3(p_scl.x * local_scl.x, p_scl.y * local_scl.y, p_scl.z * local_scl.z)
\t\t\tworld_transforms[jid] = {
\t\t\t\t"position": w_pos,
\t\t\t\t"quaternion": w_rot,
\t\t\t\t"scale": w_scl,
\t\t\t\t"node": jnode
\t\t\t}
\t\treturn world_transforms

\tfunc dispose() -> void:
\t\tif root and is_instance_valid(root):
\t\t\troot.queue_free()
\t\troot = null
\t\tjoints.clear()
\t\tpivots.clear()
\t\tparent_ids.clear()
\t\torder.clear()
\t\tworld_transforms.clear()

\tstatic func _vec3_from(v: Variant, fallback: Vector3) -> Vector3:
\t\tif v is Vector3:
\t\t\treturn v as Vector3
\t\tif v is Array and (v as Array).size() >= 3:
\t\t\tvar a := v as Array
\t\t\treturn Vector3(float(a[0]), float(a[1]), float(a[2]))
\t\tif v is Dictionary:
\t\t\tvar d := v as Dictionary
\t\t\treturn Vector3(float(d.get("x", fallback.x)), float(d.get("y", fallback.y)), float(d.get("z", fallback.z)))
\t\treturn fallback


class ParticleSystem extends RefCounted:
\tvar max_particles: int = 240
\tvar particles: Array[Dictionary] = []
\tvar batches: Dictionary = {}
\tvar root: Node3D
\tvar _runtime: Node

\tfunc _init(rt: Node, limit: int, parent_node: Node) -> void:
\t\t_runtime = rt
\t\tmax_particles = maxi(1, limit)
\t\troot = Node3D.new()
\t\troot.name = "ParticlesRoot"
\t\tif parent_node:
\t\t\tparent_node.add_child(root)

\tfunc get_count() -> int:
\t\treturn particles.size()

\tfunc clear() -> void:
\t\tparticles.clear()
\t\tfor b in batches.values():
\t\t\t(b as InstancedBatch).clear()

\tfunc _push(p: Dictionary) -> void:
\t\tif particles.size() >= max_particles:
\t\t\tparticles.pop_front()
\t\tparticles.append(p)

\tfunc spawn(opts: Dictionary) -> void:
\t\tvar pos: Vector3 = _runtime._to_vec3(opts.get("position", Vector3.ZERO), Vector3.ZERO)
\t\tvar vel: Vector3 = _runtime._to_vec3(opts.get("velocity", Vector3.ZERO), Vector3.ZERO)
\t\tvar scl: Vector3 = _runtime._to_scale_vec3(opts.get("scale", Vector3.ONE), Vector3.ONE)
\t\tvar col: Color = _runtime._to_color(opts.get("color", Color.WHITE), Color.WHITE)
\t\tvar end_scale := float(opts.get("endScale", opts.get("end_scale", 0.05)))
\t\tvar alpha_fade := bool(opts.get("alphaFade", opts.get("alpha_fade", false)))
\t\tvar blend := str(opts.get("blend", "opaque"))
\t\tif alpha_fade and blend == "opaque":
\t\t\tblend = "alpha"
\t\t_push({
\t\t\t"mode": "vel",
\t\t\t"mesh": opts.get("mesh", "box"),
\t\t\t"blend": blend,
\t\t\t"alpha_fade": alpha_fade,
\t\t\t"pos": pos,
\t\t\t"vel": vel,
\t\t\t"from": pos,
\t\t\t"to": pos,
\t\t\t"peak": 0.0,
\t\t\t"gravity": float(opts.get("gravity", 0.0)),
\t\t\t"drag": float(opts.get("drag", 0.0)),
\t\t\t"scale": scl,
\t\t\t"end_scale": end_scale,
\t\t\t"yaw": float(opts.get("yaw", 0.0)),
\t\t\t"spin": float(opts.get("spin", 0.0)),
\t\t\t"color": col,
\t\t\t"unlit": float(opts.get("unlit", 0.0)),
\t\t\t"age": 0.0,
\t\t\t"life": maxf(0.05, float(opts.get("life", 0.5)))
\t\t})

\tfunc arc(opts: Dictionary) -> void:
\t\tvar from_pos: Vector3 = _runtime._to_vec3(opts.get("from", Vector3.ZERO), Vector3.ZERO)
\t\tvar to_pos: Vector3 = _runtime._to_vec3(opts.get("to", Vector3.ZERO), Vector3.ZERO)
\t\tvar scl: Vector3 = _runtime._to_scale_vec3(opts.get("scale", Vector3.ONE), Vector3.ONE)
\t\tvar col: Color = _runtime._to_color(opts.get("color", Color.WHITE), Color.WHITE)
\t\tvar end_scale := float(opts.get("endScale", opts.get("end_scale", 0.65)))
\t\t_push({
\t\t\t"mode": "arc",
\t\t\t"mesh": opts.get("mesh", "box"),
\t\t\t"blend": str(opts.get("blend", "opaque")),
\t\t\t"alpha_fade": false,
\t\t\t"pos": from_pos,
\t\t\t"vel": Vector3.ZERO,
\t\t\t"from": from_pos,
\t\t\t"to": to_pos,
\t\t\t"peak": float(opts.get("peak", 1.6)),
\t\t\t"gravity": 0.0,
\t\t\t"drag": 0.0,
\t\t\t"scale": scl,
\t\t\t"end_scale": end_scale,
\t\t\t"yaw": 0.0,
\t\t\t"spin": float(opts.get("spin", 6.0)),
\t\t\t"color": col,
\t\t\t"unlit": float(opts.get("unlit", 0.25)),
\t\t\t"age": 0.0,
\t\t\t"life": maxf(0.08, float(opts.get("duration", 0.4)))
\t\t})

\tfunc step(dt: float) -> void:
\t\tvar i := particles.size() - 1
\t\twhile i >= 0:
\t\t\tvar p: Dictionary = particles[i]
\t\t\tvar age := float(p["age"]) + dt
\t\t\tvar life := float(p["life"])
\t\t\tif age >= life:
\t\t\t\tparticles.remove_at(i)
\t\t\t\ti -= 1
\t\t\t\tcontinue
\t\t\tp["age"] = age
\t\t\tp["yaw"] = float(p["yaw"]) + float(p["spin"]) * dt
\t\t\tif str(p["mode"]) == "vel":
\t\t\t\tvar v: Vector3 = p["vel"] as Vector3
\t\t\t\tv.y -= float(p["gravity"]) * dt
\t\t\t\tvar drag := float(p["drag"])
\t\t\t\tif drag > 0.0:
\t\t\t\t\tvar damp := maxf(0.0, 1.0 - drag * dt)
\t\t\t\t\tv *= damp
\t\t\t\tp["vel"] = v
\t\t\t\tp["pos"] = (p["pos"] as Vector3) + v * dt
\t\t\telse:
\t\t\t\tvar u := age / life
\t\t\t\tvar fpos: Vector3 = p["from"] as Vector3
\t\t\t\tvar tpos: Vector3 = p["to"] as Vector3
\t\t\t\tvar interp := fpos.lerp(tpos, u)
\t\t\t\tinterp.y += sin(u * PI) * float(p["peak"])
\t\t\t\tp["pos"] = interp
\t\t\ti -= 1
\t\temit_batches()

\tfunc emit_batches() -> void:
\t\tfor b in batches.values():
\t\t\t(b as InstancedBatch).clear()
\t\tfor p in particles:
\t\t\tvar u := clampf(float(p["age"]) / maxf(0.0001, float(p["life"])), 0.0, 1.0)
\t\t\tvar end_s := float(p["end_scale"])
\t\t\tvar factor := (1.0 + sin(u * PI) * 0.22 - (1.0 - end_s) * u * 0.5) if str(p["mode"]) == "arc" else maxf(0.02, 1.0 + (end_s - 1.0) * u)
\t\t\tvar base_scl: Vector3 = p["scale"] as Vector3
\t\t\tvar scl := Vector3(maxf(0.01, base_scl.x * factor), maxf(0.01, base_scl.y * factor), maxf(0.01, base_scl.z * factor))
\t\t\tvar col: Color = p["color"] as Color
\t\t\tif bool(p["alpha_fade"]):
\t\t\t\tcol = Color(col.r, col.g, col.b, col.a * (1.0 - u))
\t\t\tvar blend := str(p["blend"])
\t\t\tvar is_unlit := float(p["unlit"]) > 0.35 or blend == "additive"
\t\t\tvar mesh_spec = p["mesh"]
\t\t\tvar mesh_key := str(mesh_spec) if mesh_spec is String else str(mesh_spec.get_instance_id())
\t\t\tvar batch_key := "%s|%s|%d" % [mesh_key, blend, 1 if is_unlit else 0]
\t\t\tvar batch: InstancedBatch
\t\t\tif batches.has(batch_key):
\t\t\t\tbatch = batches[batch_key] as InstancedBatch
\t\t\telse:
\t\t\t\tbatch = _runtime.create_batch(mesh_spec, blend, 32, is_unlit, root)
\t\t\t\tbatches[batch_key] = batch
\t\t\tbatch.add(p["pos"] as Vector3, scl, float(p["yaw"]), col, float(p["unlit"]))

\tfunc dispose() -> void:
\t\tparticles.clear()
\t\tfor b in batches.values():
\t\t\t(b as InstancedBatch).dispose()
\t\tbatches.clear()
\t\tif root and is_instance_valid(root):
\t\t\troot.queue_free()
\t\troot = null
\t\t_runtime = null


const MAX_POINT_LIGHTS: int = 4

var host_root: Node3D = null
var camera: Camera3D = null
var directional_light: DirectionalLight3D = null
var world_env: WorldEnvironment = null
var ui: Control = null
var point_lights: Array[OmniLight3D] = []
var lighting_state: Dictionary = {
\t"direction": Vector3(-0.48, 0.8, 0.36).normalized(),
\t"ambient": 0.52,
\t"color": Color(1.0, 1.0, 1.0, 1.0),
\t"fog_color": Color(0.129, 0.224, 0.243, 1.0),
\t"fog_near": 0.0,
\t"fog_far": 0.0,
\t"fog_enabled": false,
\t"active_points": 0
}

var sound_enabled: bool = true
var music_enabled: bool = true
var master_volume: float = 0.72
var music_volume: float = 0.16
var sfx_volume: float = 0.28
var ambience_volume: float = 1.0
var sfx_players: Array[AudioStreamPlayer] = []
var _sfx_cursor: int = 0
var ambient_beds: Dictionary = {}
var audio_cache: Dictionary = {}
var _pink_noise_stream: AudioStreamWAV = null
var _music_filter: AudioEffectLowPassFilter = null
var _ambience_filter: AudioEffectLowPassFilter = null

var models_cache: Dictionary = {}
var mesh_cache: Dictionary = {}
var rt_script: GDScript = null
var storage: GodotStorage = null
var _batches: Array = []
var _pools: Array = []
var _rigs: Array = []
var _particle_systems: Array = []
var _initialized: bool = false

func setup(root_node: Node3D, cam: Camera3D = null, dir_light: DirectionalLight3D = null, env: WorldEnvironment = null, ui_node: Control = null) -> void:
\tif _initialized:
\t\treturn
\t_initialized = true
\thost_root = root_node if root_node != null else self
\tcamera = cam if cam != null else (host_root.get_node_or_null("Camera3D") as Camera3D)
\tif camera == null:
\t\tcamera = Camera3D.new()
\t\tcamera.name = "Camera3D"
\t\tcamera.current = true
\t\thost_root.add_child(camera)

\tdirectional_light = dir_light if dir_light != null else (host_root.get_node_or_null("DirectionalLight3D") as DirectionalLight3D)
\tif directional_light == null:
\t\tdirectional_light = DirectionalLight3D.new()
\t\tdirectional_light.name = "DirectionalLight3D"
\t\tdirectional_light.light_energy = 1.15
\t\thost_root.add_child(directional_light)

\tworld_env = env if env != null else (host_root.get_node_or_null("WorldEnvironment") as WorldEnvironment)
\tif world_env == null:
\t\tworld_env = WorldEnvironment.new()
\t\tworld_env.name = "WorldEnvironment"
\t\thost_root.add_child(world_env)
\tif world_env.environment == null:
\t\tvar e := Environment.new()
\t\te.background_mode = Environment.BG_COLOR
\t\te.background_color = Color(0.129, 0.224, 0.243, 1.0)
\t\te.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
\t\te.ambient_light_color = Color(0.86, 0.93, 0.94, 1.0)
\t\te.ambient_light_energy = 0.62
\t\tworld_env.environment = e

\tui = ui_node if ui_node != null else (host_root.get_node_or_null("UI") as Control)

\tpoint_lights.clear()
\tfor i in range(MAX_POINT_LIGHTS):
\t\tvar pl := OmniLight3D.new()
\t\tpl.name = "PointLight%d" % i
\t\tpl.visible = false
\t\tpl.omni_attenuation = 1.5
\t\tadd_child(pl)
\t\tpoint_lights.append(pl)

\tensure_audio_buses()
\tsfx_players.clear()
\tfor _i in range(8):
\t\tvar p := AudioStreamPlayer.new()
\t\tp.bus = "SFX"
\t\tadd_child(p)
\t\tsfx_players.append(p)

\tstorage = GodotStorage.new()
\tif ResourceLoader.exists("res://scripts/compiled/rt.gd"):
\t\trt_script = load("res://scripts/compiled/rt.gd")

func _exit_tree() -> void:
\tcleanup()

func cleanup() -> void:
\tfor p in sfx_players:
\t\tif is_instance_valid(p):
\t\t\tp.stop()
\t\t\tp.stream = null
\tfor bed_val in ambient_beds.values():
\t\tvar bed: Dictionary = bed_val as Dictionary
\t\tvar bp = bed.get("player", null)
\t\tif bp is AudioStreamPlayer and is_instance_valid(bp):
\t\t\t(bp as AudioStreamPlayer).stop()
\t\t\t(bp as AudioStreamPlayer).stream = null
\t\t\t(bp as AudioStreamPlayer).queue_free()
\tambient_beds.clear()
\tfor b in _batches:
\t\tif b != null:
\t\t\t(b as InstancedBatch).dispose()
\t_batches.clear()
\tfor pool in _pools:
\t\tif pool != null:
\t\t\t(pool as MeshInstancePool).dispose()
\t_pools.clear()
\tfor rig in _rigs:
\t\tif rig != null:
\t\t\t(rig as RigInstance).dispose()
\t_rigs.clear()
\tfor ps in _particle_systems:
\t\tif ps != null:
\t\t\t(ps as ParticleSystem).dispose()
\t_particle_systems.clear()
\tfor val in models_cache.values():
\t\tif val is Node and is_instance_valid(val):
\t\t\t(val as Node).free()
\tmodels_cache.clear()
\tmesh_cache.clear()
\taudio_cache.clear()
\t_pink_noise_stream = null
\tif rt_script:
\t\trt_script.clear_modules()

# ==============================================================================
# CONVERSION & MATH HELPERS
# ==============================================================================

static func quat_from_euler(pitch: float = 0.0, yaw: float = 0.0, roll: float = 0.0) -> Quaternion:
\treturn InstancedBatch._euler_to_quat(pitch, yaw, roll)

func _to_vec3(v: Variant, fallback: Vector3 = Vector3.ZERO) -> Vector3:
\tif v is Vector3:
\t\treturn v as Vector3
\tif v is Array and (v as Array).size() >= 3:
\t\tvar a := v as Array
\t\treturn Vector3(float(a[0]), float(a[1]), float(a[2]))
\tif v is Dictionary:
\t\tvar d := v as Dictionary
\t\treturn Vector3(float(d.get("x", fallback.x)), float(d.get("y", fallback.y)), float(d.get("z", fallback.z)))
\treturn fallback

func _to_scale_vec3(v: Variant, fallback: Vector3 = Vector3.ONE) -> Vector3:
\tif v is float or v is int:
\t\tvar s := maxf(0.0001, float(v))
\t\treturn Vector3(s, s, s)
\tvar vec := _to_vec3(v, fallback)
\treturn Vector3(maxf(0.0001, vec.x), maxf(0.0001, vec.y), maxf(0.0001, vec.z))

func _to_color(v: Variant, fallback: Color = Color.WHITE) -> Color:
\tif v is Color:
\t\treturn v as Color
\tif v is String:
\t\tvar s := (v as String).strip_edges()
\t\tif s != "":
\t\t\treturn Color(s)
\t\treturn fallback
\tif v is Array:
\t\tvar a := v as Array
\t\tif a.size() >= 4:
\t\t\treturn Color(float(a[0]), float(a[1]), float(a[2]), float(a[3]))
\t\tif a.size() >= 3:
\t\t\treturn Color(float(a[0]), float(a[1]), float(a[2]), 1.0)
\tif v is Dictionary:
\t\tvar d := v as Dictionary
\t\treturn Color(float(d.get("r", fallback.r)), float(d.get("g", fallback.g)), float(d.get("b", fallback.b)), float(d.get("a", fallback.a)))
\treturn fallback

static func _safe_looking_at(forward: Vector3, up_hint: Vector3 = Vector3.UP) -> Basis:
\tvar f := forward
\tif f.length_squared() < 1e-8:
\t\tf = Vector3.FORWARD
\telse:
\t\tf = f.normalized()
\tvar up := up_hint.normalized() if up_hint.length_squared() > 1e-8 else Vector3.UP
\tif absf(f.dot(up)) > 0.995:
\t\tup = Vector3.BACK if absf(f.y) > 0.5 else Vector3.UP
\treturn Basis.looking_at(f, up)

# ==============================================================================
# SCENE, CAMERA & LOW-POLY LIGHTING BRIDGE (matches renderer.setLighting)
# ==============================================================================

func set_clear_color(col_val: Variant) -> void:
\tif world_env and world_env.environment:
\t\tvar c := _to_color(col_val, Color(0.129, 0.224, 0.243, 1.0))
\t\tworld_env.environment.background_mode = Environment.BG_COLOR
\t\tworld_env.environment.background_color = Color(c.r, c.g, c.b, 1.0)

func set_camera(opts: Dictionary) -> void:
\tif camera == null:
\t\treturn
\tvar proj := str(opts.get("projection", "perspective")).to_lower()
\tif proj == "orthographic" or proj == "ortho":
\t\tcamera.projection = Camera3D.PROJECTION_ORTHOGONAL
\t\tif opts.has("size"):
\t\t\tcamera.size = maxf(0.1, float(opts["size"]))
\telse:
\t\tcamera.projection = Camera3D.PROJECTION_PERSPECTIVE
\t\tif opts.has("fov"):
\t\t\tcamera.fov = clampf(float(opts["fov"]), 5.0, 170.0)
\t\telif opts.has("fovRad"):
\t\t\tcamera.fov = clampf(rad_to_deg(float(opts["fovRad"])), 5.0, 170.0)
\tif opts.has("near"):
\t\tcamera.near = maxf(0.01, float(opts["near"]))
\tif opts.has("far"):
\t\tcamera.far = maxf(camera.near + 0.1, float(opts["far"]))
\tvar eye := _to_vec3(opts.get("position", opts.get("eye", camera.position)), camera.position)
\tif opts.has("target"):
\t\tvar tgt := _to_vec3(opts["target"], Vector3.ZERO)
\t\tvar up := _to_vec3(opts.get("up", Vector3.UP), Vector3.UP)
\t\tcamera.transform = Transform3D(_safe_looking_at(tgt - eye, up), eye)
\telse:
\t\tcamera.position = eye

func set_lighting(opts: Dictionary) -> void:
\tif opts.has("clear") or opts.has("clearColor") or opts.has("skyColor"):
\t\tset_clear_color(opts.get("clear", opts.get("clearColor", opts.get("skyColor"))))

\tif opts.has("direction"):
\t\tvar dir := _to_vec3(opts["direction"], Vector3(-0.48, 0.8, 0.36))
\t\tif dir.length_squared() > 1e-8:
\t\t\tvar dir_n := dir.normalized()
\t\t\tlighting_state["direction"] = dir_n
\t\t\tif directional_light:
\t\t\t\tdirectional_light.basis = _safe_looking_at(-dir_n, Vector3.UP)

\tif opts.has("ambient"):
\t\tvar amb := clampf(float(opts["ambient"]), 0.0, 1.0)
\t\tlighting_state["ambient"] = amb
\t\tif world_env and world_env.environment:
\t\t\tworld_env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
\t\t\tworld_env.environment.ambient_light_energy = amb
\t\tif directional_light and not opts.has("energy"):
\t\t\tdirectional_light.light_energy = maxf(0.15, 1.25 - amb * 0.35)

\tif opts.has("energy") and directional_light:
\t\tdirectional_light.light_energy = maxf(0.0, float(opts["energy"]))

\tif opts.has("color"):
\t\tvar lc := _to_color(opts["color"], Color.WHITE)
\t\tlighting_state["color"] = lc
\t\tif directional_light:
\t\t\tdirectional_light.light_color = Color(lc.r, lc.g, lc.b, 1.0)
\t\tif world_env and world_env.environment and not opts.has("ambientColor"):
\t\t\tworld_env.environment.ambient_light_color = Color(lc.r, lc.g, lc.b, 1.0)

\tif opts.has("ambientColor") and world_env and world_env.environment:
\t\tvar ac := _to_color(opts["ambientColor"], Color.WHITE)
\t\tworld_env.environment.ambient_light_color = Color(ac.r, ac.g, ac.b, 1.0)

\tif opts.has("fogColor") or opts.has("fog_color"):
\t\tvar fc := _to_color(opts.get("fogColor", opts.get("fog_color")), Color(0.5, 0.6, 0.7, 1.0))
\t\tlighting_state["fog_color"] = fc
\t\tif world_env and world_env.environment:
\t\t\tworld_env.environment.fog_light_color = Color(fc.r, fc.g, fc.b, 1.0)

\tif opts.has("fogNear") or opts.has("fog_near") or opts.has("fogFar") or opts.has("fog_far"):
\t\tvar fnear := float(opts.get("fogNear", opts.get("fog_near", lighting_state.get("fog_near", 0.0))))
\t\tvar ffar := float(opts.get("fogFar", opts.get("fog_far", lighting_state.get("fog_far", 0.0))))
\t\tvar enabled := ffar > fnear and ffar > 0.0
\t\tlighting_state["fog_near"] = fnear
\t\tlighting_state["fog_far"] = ffar
\t\tlighting_state["fog_enabled"] = enabled
\t\tif world_env and world_env.environment:
\t\t\tvar env := world_env.environment
\t\t\tenv.fog_enabled = enabled
\t\t\tif enabled:
\t\t\t\tenv.fog_mode = Environment.FOG_MODE_DEPTH
\t\t\t\tenv.fog_density = 1.0
\t\t\t\tenv.fog_depth_curve = 1.0
\t\t\t\tenv.fog_depth_begin = maxf(0.0, fnear)
\t\t\t\tenv.fog_depth_end = maxf(env.fog_depth_begin + 0.01, ffar)
\t\t\t\tenv.fog_light_color = lighting_state["fog_color"] as Color
\t\t\t\tenv.fog_light_energy = 1.0

\tif opts.has("points") and opts["points"] is Array:
\t\tvar pts: Array = opts["points"] as Array
\t\tvar count := mini(MAX_POINT_LIGHTS, pts.size())
\t\tlighting_state["active_points"] = count
\t\tfor i in range(point_lights.size()):
\t\t\tvar pl: OmniLight3D = point_lights[i]
\t\t\tif i < count and pts[i] is Dictionary:
\t\t\t\tvar pt: Dictionary = pts[i] as Dictionary
\t\t\t\tpl.visible = true
\t\t\t\tpl.position = _to_vec3(pt.get("position", Vector3.ZERO), Vector3.ZERO)
\t\t\t\tvar pc := _to_color(pt.get("color", Color.WHITE), Color.WHITE)
\t\t\t\tpl.light_color = Color(pc.r, pc.g, pc.b, 1.0)
\t\t\t\tpl.omni_range = maxf(0.05, float(pt.get("radius", 4.0)))
\t\t\t\tpl.light_energy = maxf(0.0, float(pt.get("intensity", 1.0)))
\t\t\telse:
\t\t\t\tpl.visible = false

# ==============================================================================
# PRIMITIVE MESHES, MATERIALS & INSTANCED / POOLED BATCHES
# ==============================================================================

func get_primitive_mesh(kind: String) -> Mesh:
\tvar key := kind.to_lower()
\tif mesh_cache.has(key):
\t\treturn mesh_cache[key] as Mesh
\tvar m: Mesh
\tif key == "sphere":
\t\tvar sm := SphereMesh.new()
\t\tsm.radius = 0.5
\t\tsm.height = 1.0
\t\tsm.radial_segments = 12
\t\tsm.rings = 6
\t\tm = sm
\telif key == "cylinder" or key == "drum":
\t\tvar cm := CylinderMesh.new()
\t\tcm.top_radius = 0.5
\t\tcm.bottom_radius = 0.5
\t\tcm.height = 1.0
\t\tcm.radial_segments = 10
\t\tm = cm
\telif key == "cone":
\t\tvar cone := CylinderMesh.new()
\t\tcone.top_radius = 0.0
\t\tcone.bottom_radius = 0.5
\t\tcone.height = 1.0
\t\tcone.radial_segments = 10
\t\tm = cone
\telif key == "octahedron":
\t\tm = _build_octahedron_mesh()
\telif key == "disc" or key == "shadow_disc":
\t\tm = _build_disc_mesh(12)
\telif key == "prism":
\t\tvar pm := PrismMesh.new()
\t\tpm.size = Vector3.ONE
\t\tm = pm
\telse:
\t\tvar bm := BoxMesh.new()
\t\tbm.size = Vector3.ONE
\t\tm = bm
\tmesh_cache[key] = m
\treturn m

func _build_octahedron_mesh() -> ArrayMesh:
\tvar st := SurfaceTool.new()
\tst.begin(Mesh.PRIMITIVE_TRIANGLES)
\tvar verts := [
\t\tVector3(0.0, 1.0, 0.0), Vector3(1.0, 0.0, 0.0), Vector3(0.0, 0.0, 1.0),
\t\tVector3(-1.0, 0.0, 0.0), Vector3(0.0, 0.0, -1.0), Vector3(0.0, -1.0, 0.0)
\t]
\tvar faces := [
\t\t[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1],
\t\t[5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]
\t]
\tfor f in faces:
\t\tvar a: Vector3 = verts[int(f[0])]
\t\tvar b: Vector3 = verts[int(f[1])]
\t\tvar c: Vector3 = verts[int(f[2])]
\t\tvar n := (c - a).cross(b - a).normalized()
\t\tst.set_normal(n)
\t\tst.add_vertex(a)
\t\tst.set_normal(n)
\t\tst.add_vertex(b)
\t\tst.set_normal(n)
\t\tst.add_vertex(c)
\treturn st.commit()

func _build_disc_mesh(sides: int = 12) -> ArrayMesh:
\tvar st := SurfaceTool.new()
\tst.begin(Mesh.PRIMITIVE_TRIANGLES)
\tvar segs := maxi(3, sides)
\tfor i in range(segs):
\t\tvar a0 := TAU * float(i) / float(segs)
\t\tvar a1 := TAU * float((i + 1) % segs) / float(segs)
\t\tvar p0 := Vector3.ZERO
\t\tvar p1 := Vector3(cos(a0), 0.0, sin(a0))
\t\tvar p2 := Vector3(cos(a1), 0.0, sin(a1))
\t\tst.set_normal(Vector3.UP)
\t\tst.add_vertex(p0)
\t\tst.set_normal(Vector3.UP)
\t\tst.add_vertex(p1)
\t\tst.set_normal(Vector3.UP)
\t\tst.add_vertex(p2)
\treturn st.commit()

func resolve_mesh(mesh_spec: Variant) -> Mesh:
\tif mesh_spec is Mesh:
\t\treturn mesh_spec as Mesh
\treturn get_primitive_mesh(str(mesh_spec))

func create_material(blend: String = "opaque", col: Color = Color.WHITE, unlit: float = 0.0, use_vertex_color: bool = false) -> StandardMaterial3D:
\tvar mat := StandardMaterial3D.new()
\tmat.roughness = 0.92
\tmat.metallic = 0.0
\tmat.vertex_color_use_as_albedo = use_vertex_color
\tmat.albedo_color = Color.WHITE if use_vertex_color else col
\tvar mode := blend.to_lower()
\tif mode == "additive":
\t\tmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
\t\tmat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
\t\tmat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
\t\tmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
\t\tmat.cull_mode = BaseMaterial3D.CULL_DISABLED
\telif mode == "alpha":
\t\tmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
\t\tmat.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
\t\tmat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
\t\tif unlit >= 0.85:
\t\t\tmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
\telse:
\t\tmat.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
\t\tmat.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
\t\tif unlit >= 0.85:
\t\t\tmat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
\tif unlit > 0.02 and mat.shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED and not use_vertex_color:
\t\tmat.emission_enabled = true
\t\tmat.emission = Color(col.r, col.g, col.b, 1.0)
\t\tmat.emission_energy_multiplier = unlit
\treturn mat

func create_batch(mesh_spec: Variant, blend: String = "opaque", capacity: int = 64, is_unlit: bool = false, parent_node: Node = null) -> InstancedBatch:
\tvar m := resolve_mesh(mesh_spec)
\tvar mat := create_material(blend, Color.WHITE, 1.0 if is_unlit else 0.0, true)
\tvar target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
\tvar batch := InstancedBatch.new(m, mat, blend.to_lower(), is_unlit, capacity, target_parent)
\t_batches.append(batch)
\treturn batch

func create_mesh_pool(mesh_spec: Variant, blend: String = "opaque", unlit_val: float = 0.0, parent_node: Node = null) -> MeshInstancePool:
\tvar m := resolve_mesh(mesh_spec)
\tvar mat := create_material(blend, Color.WHITE, unlit_val, false)
\tvar target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
\tvar pool := MeshInstancePool.new(m, mat, blend.to_lower(), unlit_val, target_parent)
\t_pools.append(pool)
\treturn pool

# ==============================================================================
# HIERARCHICAL RIG & ANIMATION BRIDGE (matches framework/animation.ts createRig)
# ==============================================================================

func create_rig(joint_defs: Array, parent_node: Node = null) -> RigInstance:
\tvar target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
\tvar rig := RigInstance.new(target_parent)
\tvar by_id: Dictionary = {}
\tfor jd_val in joint_defs:
\t\tif jd_val is Dictionary:
\t\t\tvar jd: Dictionary = jd_val as Dictionary
\t\t\tvar jid := str(jd.get("id", ""))
\t\t\tif jid != "" and not by_id.has(jid):
\t\t\t\tby_id[jid] = jd

\tvar visited: Dictionary = {}
\tvar topo: Array[String] = []
\tfor jid_key in by_id.keys():
\t\t_visit_rig_joint(str(jid_key), by_id, visited, topo)

\tfor jid in topo:
\t\tvar jd: Dictionary = by_id[jid] as Dictionary
\t\tvar pid := str(jd.get("parent", ""))
\t\tvar jnode := Node3D.new()
\t\tjnode.name = sanitize_asset_name(jid)
\t\tvar piv := _to_vec3(jd.get("pivot", Vector3.ZERO), Vector3.ZERO)
\t\tjnode.position = piv
\t\tif pid != "" and rig.joints.has(pid):
\t\t\t(rig.joints[pid] as Node3D).add_child(jnode)
\t\telse:
\t\t\trig.root.add_child(jnode)
\t\t\tpid = ""
\t\trig.joints[jid] = jnode
\t\trig.pivots[jid] = piv
\t\trig.parent_ids[jid] = pid
\t\trig.order.append(jid)

\t\tvar parts_val = jd.get("parts", [])
\t\tif parts_val is Array:
\t\t\tfor part_val in parts_val as Array:
\t\t\t\tif not (part_val is Dictionary):
\t\t\t\t\tcontinue
\t\t\t\tvar part: Dictionary = part_val as Dictionary
\t\t\t\tvar part_pos := _to_vec3(part.get("position", Vector3.ZERO), Vector3.ZERO)
\t\t\t\tvar part_scl := _to_scale_vec3(part.get("scale", Vector3.ONE), Vector3.ONE)
\t\t\t\tvar part_rot := InstancedBatch._coerce_quat(part.get("rotation", Quaternion.IDENTITY))
\t\t\t\tif part.has("model"):
\t\t\t\t\tvar spawned := spawn_model(str(part["model"]), part_pos, jnode)
\t\t\t\t\tif spawned:
\t\t\t\t\t\tspawned.quaternion = part_rot
\t\t\t\t\t\tspawned.scale = part_scl
\t\t\t\telse:
\t\t\t\t\tvar mi := MeshInstance3D.new()
\t\t\t\t\tmi.mesh = resolve_mesh(part.get("mesh", "box"))
\t\t\t\t\tvar col := _to_color(part.get("color", Color.WHITE), Color.WHITE)
\t\t\t\t\tvar blend := str(part.get("blend", "opaque"))
\t\t\t\t\tvar unlit_v := float(part.get("unlit", 0.0))
\t\t\t\t\tmi.material_override = create_material(blend, col, unlit_v, false)
\t\t\t\t\tmi.position = part_pos
\t\t\t\t\tmi.quaternion = part_rot
\t\t\t\t\tmi.scale = part_scl
\t\t\t\t\tjnode.add_child(mi)

\trig.apply_poses({})
\t_rigs.append(rig)
\treturn rig

func _visit_rig_joint(jid: String, by_id: Dictionary, visited: Dictionary, topo: Array[String]) -> void:
\tvar state := int(visited.get(jid, 0))
\tif state == 2 or state == 1:
\t\treturn
\tvisited[jid] = 1
\tvar jd: Dictionary = by_id[jid] as Dictionary
\tvar pid := str(jd.get("parent", ""))
\tif pid != "" and by_id.has(pid):
\t\t_visit_rig_joint(pid, by_id, visited, topo)
\tvisited[jid] = 2
\ttopo.append(jid)

# ==============================================================================
# POOLED 3D PARTICLE BRIDGE (matches framework/animation.ts createParticles)
# ==============================================================================

func create_particles(max_particles: int = 240, parent_node: Node = null) -> ParticleSystem:
\tvar target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
\tvar ps := ParticleSystem.new(self, max_particles, target_parent)
\t_particle_systems.append(ps)
\treturn ps

# ==============================================================================
# MULTI-BUS SOUNDSCAPE & AUDIO BRIDGE (Master, Music, SFX, Ambience)
# ==============================================================================

func ensure_audio_buses() -> void:
\tfor bus_name in ["Music", "SFX", "Ambience"]:
\t\tif AudioServer.get_bus_index(bus_name) < 0:
\t\t\tvar idx := AudioServer.bus_count
\t\t\tAudioServer.add_bus(idx)
\t\t\tAudioServer.set_bus_name(idx, bus_name)
\t\t\tAudioServer.set_bus_send(idx, "Master")

\tvar music_idx := AudioServer.get_bus_index("Music")
\tif music_idx >= 0:
\t\tif AudioServer.get_bus_effect_count(music_idx) == 0:
\t\t\t_music_filter = AudioEffectLowPassFilter.new()
\t\t\t_music_filter.cutoff_hz = 1800.0
\t\t\tAudioServer.add_bus_effect(music_idx, _music_filter)
\t\telif AudioServer.get_bus_effect(music_idx, 0) is AudioEffectLowPassFilter:
\t\t\t_music_filter = AudioServer.get_bus_effect(music_idx, 0) as AudioEffectLowPassFilter

\tvar amb_idx := AudioServer.get_bus_index("Ambience")
\tif amb_idx >= 0:
\t\tif AudioServer.get_bus_effect_count(amb_idx) == 0:
\t\t\t_ambience_filter = AudioEffectLowPassFilter.new()
\t\t\t_ambience_filter.cutoff_hz = 2400.0
\t\t\tAudioServer.add_bus_effect(amb_idx, _ambience_filter)
\t\telif AudioServer.get_bus_effect(amb_idx, 0) is AudioEffectLowPassFilter:
\t\t\t_ambience_filter = AudioServer.get_bus_effect(amb_idx, 0) as AudioEffectLowPassFilter

\tset_bus_volume("Master", master_volume if sound_enabled else 0.0)
\tset_bus_volume("Music", music_volume if (sound_enabled and music_enabled) else 0.0)
\tset_bus_volume("SFX", sfx_volume)
\tset_bus_volume("Ambience", ambience_volume)

func set_bus_volume(bus_name: String, linear: float) -> void:
\tvar idx := AudioServer.get_bus_index(bus_name)
\tif idx < 0:
\t\treturn
\tvar v := clampf(linear, 0.0, 2.0)
\tif v <= 0.0005:
\t\tAudioServer.set_bus_mute(idx, true)
\t\tAudioServer.set_bus_volume_db(idx, -80.0)
\telse:
\t\tAudioServer.set_bus_mute(idx, false)
\t\tAudioServer.set_bus_volume_db(idx, linear_to_db(v))

func set_muted(muted: bool) -> void:
\tsound_enabled = not muted
\tvar master_idx := AudioServer.get_bus_index("Master")
\tif master_idx >= 0:
\t\tAudioServer.set_bus_mute(master_idx, muted)
\t\tif not muted:
\t\t\tAudioServer.set_bus_volume_db(master_idx, linear_to_db(maxf(0.001, master_volume)))

func is_muted() -> bool:
\treturn not sound_enabled

func set_music_enabled(enabled: bool) -> void:
\tmusic_enabled = enabled
\tset_bus_volume("Music", music_volume if (sound_enabled and music_enabled) else 0.0)

func is_music_enabled() -> bool:
\treturn music_enabled

func set_music_volume(linear: float) -> void:
\tmusic_volume = maxf(0.0, linear)
\tset_bus_volume("Music", music_volume if (sound_enabled and music_enabled) else 0.0)

func set_music_filter(cutoff_hz: float) -> void:
\tif _music_filter:
\t\t_music_filter.cutoff_hz = clampf(cutoff_hz, 40.0, 20000.0)

func set_ambience_volume(linear: float) -> void:
\tambience_volume = maxf(0.0, linear)
\tset_bus_volume("Ambience", ambience_volume)

func set_ambience_filter(cutoff_hz: float) -> void:
\tif _ambience_filter:
\t\t_ambience_filter.cutoff_hz = clampf(cutoff_hz, 40.0, 20000.0)

func _get_pink_noise_stream() -> AudioStreamWAV:
\tif _pink_noise_stream != null:
\t\treturn _pink_noise_stream
\tvar sample_rate := 22050
\tvar count := 11025
\tvar bytes := PackedByteArray()
\tbytes.resize(count * 2)
\tvar b0 := 0.0
\tvar b1 := 0.0
\tvar b2 := 0.0
\tvar rng := RandomNumberGenerator.new()
\trng.seed = 4201337
\tfor i in range(count):
\t\tvar white := rng.randf_range(-1.0, 1.0)
\t\tb0 = 0.997 * b0 + white * 0.029
\t\tb1 = 0.985 * b1 + white * 0.032
\t\tb2 = 0.950 * b2 + white * 0.048
\t\tvar sample := clampf((b0 + b1 + b2 + white * 0.18) * 0.55, -1.0, 1.0)
\t\tbytes.encode_s16(i * 2, int(round(sample * 32767.0)))
\tvar wav := AudioStreamWAV.new()
\twav.format = AudioStreamWAV.FORMAT_16_BITS
\twav.mix_rate = sample_rate
\twav.stereo = false
\twav.loop_mode = AudioStreamWAV.LOOP_FORWARD
\twav.loop_begin = 0
\twav.loop_end = count
\twav.data = bytes
\t_pink_noise_stream = wav
\treturn wav

func register_ambient_bed(bed_id: String, opts: Dictionary = {}) -> void:
\tvar safe_id := sanitize_asset_name(bed_id)
\tif safe_id == "":
\t\treturn
\tvar bus_name := "AmbBed_" + safe_id
\tvar filter_type := str(opts.get("type", "lowpass")).to_lower()
\tvar freq := clampf(float(opts.get("frequency", 420.0)), 20.0, 20000.0)
\tvar q_val := clampf(float(opts.get("q", 0.7)), 0.1, 4.0)
\tvar gain := clampf(float(opts.get("gain", 0.0)), 0.0, 2.0)

\tvar bus_idx := AudioServer.get_bus_index(bus_name)
\tif bus_idx < 0:
\t\tbus_idx = AudioServer.bus_count
\t\tAudioServer.add_bus(bus_idx)
\t\tAudioServer.set_bus_name(bus_idx, bus_name)
\t\tAudioServer.set_bus_send(bus_idx, "Ambience")

\tvar filter_fx: AudioEffectFilter = null
\tif AudioServer.get_bus_effect_count(bus_idx) > 0 and AudioServer.get_bus_effect(bus_idx, 0) is AudioEffectFilter:
\t\tfilter_fx = AudioServer.get_bus_effect(bus_idx, 0) as AudioEffectFilter
\telse:
\t\tif filter_type == "bandpass":
\t\t\tfilter_fx = AudioEffectBandPassFilter.new()
\t\telif filter_type == "highpass":
\t\t\tfilter_fx = AudioEffectHighPassFilter.new()
\t\telse:
\t\t\tfilter_fx = AudioEffectLowPassFilter.new()
\t\tAudioServer.add_bus_effect(bus_idx, filter_fx)
\tfilter_fx.cutoff_hz = freq
\tfilter_fx.resonance = q_val

\tvar player: AudioStreamPlayer
\tif ambient_beds.has(bed_id):
\t\tvar existing: Dictionary = ambient_beds[bed_id] as Dictionary
\t\tplayer = existing["player"] as AudioStreamPlayer
\telse:
\t\tplayer = AudioStreamPlayer.new()
\t\tplayer.name = "AmbBedPlayer_" + safe_id
\t\tplayer.bus = bus_name
\t\tadd_child(player)

\tvar stream: AudioStream = null
\tif opts.has("clip"):
\t\tstream = load_audio(str(opts["clip"]))
\tif stream == null:
\t\tstream = _get_pink_noise_stream()
\tplayer.stream = stream

\tambient_beds[bed_id] = {
\t\t"player": player,
\t\t"bus": bus_name,
\t\t"filter": filter_fx,
\t\t"type": filter_type,
\t\t"frequency": freq,
\t\t"gain": gain
\t}
\tset_ambient_bed(bed_id, { "gain": gain, "frequency": freq })

func _audio_output_active() -> bool:
\t# Godot's headless Dummy audio driver never runs mix_step() to reap stopped AudioStreamPlaybacks,
\t# which causes leaked AudioStreamPlaybackWAV warnings on exit. Route/decode/configure everything
\t# normally, and start actual stream playback only on live mixing audio drivers.
\treturn AudioServer.get_driver_name() != "Dummy"

func set_ambient_bed(bed_id: String, opts: Dictionary) -> void:
\tif not ambient_beds.has(bed_id):
\t\tregister_ambient_bed(bed_id, opts)
\t\treturn
\tvar bed: Dictionary = ambient_beds[bed_id] as Dictionary
\tvar player: AudioStreamPlayer = bed["player"] as AudioStreamPlayer
\tvar filter_fx: AudioEffectFilter = bed["filter"] as AudioEffectFilter
\tif opts.has("frequency"):
\t\tvar f := clampf(float(opts["frequency"]), 20.0, 20000.0)
\t\tbed["frequency"] = f
\t\tif filter_fx:
\t\t\tfilter_fx.cutoff_hz = f
\tif opts.has("gain"):
\t\tvar g := clampf(float(opts["gain"]), 0.0, 2.0)
\t\tbed["gain"] = g
\t\tbed["active"] = g > 0.0005
\t\tif player and is_instance_valid(player):
\t\t\tif g <= 0.0005:
\t\t\t\tplayer.volume_db = -80.0
\t\t\t\tif player.playing:
\t\t\t\t\tplayer.stop()
\t\t\telse:
\t\t\t\tplayer.volume_db = linear_to_db(g)
\t\t\t\tif _audio_output_active() and not player.playing and player.stream != null:
\t\t\t\t\tplayer.play()

func get_ambient_bed(bed_id: String) -> Dictionary:
\tif ambient_beds.has(bed_id):
\t\treturn ambient_beds[bed_id] as Dictionary
\treturn {}

func load_audio(clip_name: String) -> AudioStream:
\tvar safe := sanitize_asset_name(clip_name)
\tif audio_cache.has(safe):
\t\treturn audio_cache[safe] as AudioStream
\tvar path := "res://assets/audio/%s.wav" % safe
\tif ResourceLoader.exists(path):
\t\tvar stream = load(path)
\t\tif stream is AudioStream:
\t\t\taudio_cache[safe] = stream
\t\t\treturn stream as AudioStream
\tif FileAccess.file_exists(path):
\t\tvar bytes := FileAccess.get_file_as_bytes(path)
\t\tif bytes.size() > 44:
\t\t\tvar wav := AudioStreamWAV.new()
\t\t\twav.format = AudioStreamWAV.FORMAT_16_BITS
\t\t\twav.mix_rate = bytes.decode_u32(24)
\t\t\twav.stereo = bytes.decode_u16(22) == 2
\t\t\twav.data = bytes.slice(44)
\t\t\taudio_cache[safe] = wav
\t\t\treturn wav
\treturn null

func play_sfx(clip_name: String, volume: float = 1.0, pitch: float = 1.0, bus_name: String = "SFX") -> bool:
\tif not sound_enabled or sfx_players.is_empty():
\t\treturn false
\tvar stream := load_audio(clip_name)
\tif stream == null:
\t\treturn false
\tvar player: AudioStreamPlayer = null
\tfor p in sfx_players:
\t\tif not p.playing:
\t\t\tplayer = p
\t\t\tbreak
\tif player == null:
\t\tplayer = sfx_players[_sfx_cursor % sfx_players.size()]
\t\t_sfx_cursor += 1
\tplayer.bus = bus_name if AudioServer.get_bus_index(bus_name) >= 0 else "Master"
\tplayer.stream = stream
\tplayer.volume_db = linear_to_db(maxf(0.0005, volume))
\tplayer.pitch_scale = clampf(pitch, 0.1, 4.0)
\tif _audio_output_active():
\t\tplayer.play()
\treturn true

# ==============================================================================
# MODEL & COMPILED SCRIPT LOADING HELPERS
# ==============================================================================

func sanitize_asset_name(raw_name: String) -> String:
\tvar out := ""
\tvar prev_dash := false
\tfor i in range(raw_name.length()):
\t\tvar code := raw_name.unicode_at(i)
\t\tvar ok := (code >= 48 and code <= 57) or (code >= 65 and code <= 90) or (code >= 97 and code <= 122) or code == 45 or code == 95
\t\tif ok:
\t\t\tout += raw_name.substr(i, 1)
\t\t\tprev_dash = false
\t\telif not prev_dash:
\t\t\tout += "-"
\t\t\tprev_dash = true
\treturn out

func _enable_vertex_colors(node: Node) -> void:
\tif node is MeshInstance3D:
\t\tvar mi := node as MeshInstance3D
\t\tif mi.mesh is ArrayMesh:
\t\t\tvar am := mi.mesh as ArrayMesh
\t\t\tfor s in range(am.get_surface_count()):
\t\t\t\tif (am.surface_get_format(s) & Mesh.ARRAY_FORMAT_COLOR) != 0:
\t\t\t\t\tvar mat = mi.get_active_material(s)
\t\t\t\t\tif mat is StandardMaterial3D:
\t\t\t\t\t\t(mat as StandardMaterial3D).vertex_color_use_as_albedo = true
\tfor child in node.get_children():
\t\t_enable_vertex_colors(child)

func load_model_template(model_name: String) -> Variant:
\tvar safe := sanitize_asset_name(model_name)
\tif models_cache.has(safe):
\t\treturn models_cache[safe]
\tvar path := "res://assets/models/%s.glb" % safe
\tif ResourceLoader.exists(path):
\t\tvar packed = load(path)
\t\tif packed is PackedScene:
\t\t\tmodels_cache[safe] = packed
\t\t\treturn packed
\t# Runtime GLTF loader fallback so fresh exports work immediately without Godot editor --import.
\tif FileAccess.file_exists(path):
\t\tvar bytes := FileAccess.get_file_as_bytes(path)
\t\tif bytes.size() > 0:
\t\t\tvar doc := GLTFDocument.new()
\t\t\tvar state := GLTFState.new()
\t\t\tif doc.append_from_buffer(bytes, "", state) == OK:
\t\t\t\tvar scene := doc.generate_scene(state)
\t\t\t\tif scene is Node3D:
\t\t\t\t\t_enable_vertex_colors(scene)
\t\t\t\t\tmodels_cache[safe] = scene
\t\t\t\t\treturn scene
\treturn null

func spawn_model(model_name: String, pos: Vector3 = Vector3.ZERO, parent_node: Node = null) -> Node3D:
\tvar tpl = load_model_template(model_name)
\tif tpl == null:
\t\treturn null
\tvar node: Node3D = null
\tif tpl is PackedScene:
\t\tnode = (tpl as PackedScene).instantiate() as Node3D
\telif tpl is Node3D:
\t\tnode = (tpl as Node3D).duplicate() as Node3D
\tif node:
\t\tnode.position = pos
\t\tvar target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
\t\ttarget_parent.add_child(node)
\treturn node

func load_compiled_module(mod_path: String) -> Object:
\tvar res_path := mod_path if mod_path.begins_with("res://") else ("res://scripts/compiled/" + mod_path.trim_prefix("/"))
\tif not ResourceLoader.exists(res_path):
\t\treturn null
\tif rt_script != null:
\t\treturn rt_script.mod(res_path)
\tvar script = load(res_path)
\tif script is GDScript:
\t\tvar inst = (script as GDScript).new()
\t\tif inst != null and inst.has_method("__init_module"):
\t\t\tinst.__init_module()
\t\treturn inst
\treturn null

func list_compiled_modules() -> Array[String]:
\tvar out: Array[String] = []
\t_scan_compiled_dir("res://scripts/compiled", out)
\treturn out

func _scan_compiled_dir(dir_path: String, out: Array[String]) -> void:
\tvar dir := DirAccess.open(dir_path)
\tif dir == null:
\t\treturn
\tdir.list_dir_begin()
\tvar entry := dir.get_next()
\twhile entry != "":
\t\tif not entry.begins_with("."):
\t\t\tvar full := dir_path + "/" + entry
\t\t\tif dir.current_is_dir():
\t\t\t\t_scan_compiled_dir(full, out)
\t\t\telif entry.ends_with(".gd") and full != "res://scripts/compiled/rt.gd":
\t\t\t\tout.append(full)
\t\tentry = dir.get_next()
\tdir.list_dir_end()
`
}

function renderMainGd(name: string) {
  return `extends Node3D

# Auto-generated Ridgetop -> Godot 4 runtime host.
# Delegates scene/lighting/batches/rigs/particles/audio/assets to RidgetopRuntime
# (res://scripts/ridgetop_runtime.gd), executes compiled TypeScript modules from
# res://scripts/compiled/, and renders custom low-poly CanvasItem UI (res://scripts/ridgetop_ui.gd).

const RidgetopRuntime = preload("res://scripts/ridgetop_runtime.gd")

var runtime: RidgetopRuntime = null
var game_data: Dictionary = {}
var ui: Control = null
var world_env: WorldEnvironment = null
var camera: Camera3D = null
var directional_light: DirectionalLight3D = null
var _last_ui_key: String = ""

var race_mod: Object = null
var track_mod: Object = null
var prog_mod: Object = null
var generic_mod: Object = null
var compiled_modules: Array[String] = []

var mode: String = "generic" # "racing" | "grid" | "generic"

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

# --- Signal Drift racing state (driven by compiled res://scripts/compiled/racing/race.gd) ---
var circuits: Array = []
var circuit_index: int = 0
var race_screen: String = "home" # "home" | "events" | "racing" | "paused" | "results"
var track_root: Node3D
var fx_root: Node3D
var car_nodes: Array = []
var race_state: Dictionary = {}
var championship: Dictionary = {}
var race_countdown: float = 0.0
var race_accum: float = 0.0
var race_result: Dictionary = {}
var queued_pulse: bool = false
var queued_snare: bool = false
var _pulse_mesh: SphereMesh
var _snare_mesh: CylinderMesh
var _supply_mesh: BoxMesh
var _pulse_mat: StandardMaterial3D
var _snare_mat: StandardMaterial3D
var _supply_mat: StandardMaterial3D
var _hit_mat: StandardMaterial3D
var _supply_pool: Array[MeshInstance3D] = []
var _pulse_pool: Array[MeshInstance3D] = []
var _snare_pool: Array[MeshInstance3D] = []
var _hit_pool: Array[MeshInstance3D] = []

# --- Generic Ridgetop runtime state (lighthouse, beacon-run, custom & third-party games) ---
var generic_root: Node3D = null
var generic_rigs: Array = []
var generic_menu_open: bool = true
var generic_spin_stage: bool = true

func _ready() -> void:
\tworld_env = get_node_or_null("WorldEnvironment") as WorldEnvironment
\tcamera = get_node_or_null("Camera3D") as Camera3D
\tdirectional_light = get_node_or_null("DirectionalLight3D") as DirectionalLight3D
\tui = get_node_or_null("UI") as Control

\truntime = RidgetopRuntime.new()
\truntime.name = "RidgetopRuntime"
\tadd_child(runtime)
\truntime.setup(self, camera, directional_light, world_env, ui)
\tcamera = runtime.camera
\tworld_env = runtime.world_env
\tdirectional_light = runtime.directional_light

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

\tif game_data.has("clear") or game_data.has("clearColor"):
\t\truntime.set_clear_color(game_data.get("clear", game_data.get("clearColor")))
\tif game_data.has("lighting") and game_data["lighting"] is Dictionary:
\t\truntime.set_lighting(game_data["lighting"] as Dictionary)
\tif game_data.has("ambience") and game_data["ambience"] is Dictionary:
\t\tvar beds_cfg: Dictionary = game_data["ambience"] as Dictionary
\t\tfor bed_id in beds_cfg.keys():
\t\t\tif beds_cfg[bed_id] is Dictionary:
\t\t\t\truntime.register_ambient_bed(str(bed_id), beds_cfg[bed_id] as Dictionary)

\tget_viewport().size_changed.connect(_on_viewport_resized)
\tcompiled_modules = runtime.list_compiled_modules()

\tif str(game_data.get("game", "")) == "signal-drift" and game_data.has("circuits") and typeof(game_data["circuits"]) == TYPE_ARRAY and (game_data["circuits"] as Array).size() > 0:
\t\tmode = "racing"
\t\tcircuits = game_data["circuits"]
\t\t_init_fx_meshes()
\t\tif runtime.rt_script and ResourceLoader.exists("res://scripts/compiled/racing/race.gd"):
\t\t\trace_mod = runtime.load_compiled_module("racing/race.gd")
\t\t\ttrack_mod = runtime.load_compiled_module("racing/track.gd")
\t\t\tprog_mod = runtime.load_compiled_module("racing/progression.gd")
\t\t\tchampionship = prog_mod.loadChampionship(runtime.storage)
\t\t_load_circuit(0)
\telif game_data.has("map") and typeof(game_data["map"]) == TYPE_ARRAY and (game_data["map"] as Array).size() > 0:
\t\tmode = "grid"
\t\t_setup_grid_game(game_data["map"])
\telse:
\t\tmode = "generic"
\t\t_setup_generic_game()
\t_rebuild_ui()

func _on_viewport_resized() -> void:
\t_last_ui_key = ""
\t_rebuild_ui()

func _exit_tree() -> void:
\tif runtime and is_instance_valid(runtime):
\t\truntime.cleanup()

func _init_fx_meshes() -> void:
\t_pulse_mesh = SphereMesh.new()
\t_pulse_mesh.radius = 0.42
\t_pulse_mesh.height = 0.84
\t_snare_mesh = CylinderMesh.new()
\t_snare_mesh.top_radius = 0.65
\t_snare_mesh.bottom_radius = 0.78
\t_snare_mesh.height = 0.35
\t_supply_mesh = BoxMesh.new()
\t_supply_mesh.size = Vector3(0.95, 0.95, 0.95)
\t_pulse_mat = StandardMaterial3D.new()
\t_pulse_mat.albedo_color = Color("#7bf9e8")
\t_pulse_mat.emission_enabled = true
\t_pulse_mat.emission = Color("#7bf9e8")
\t_pulse_mat.emission_energy_multiplier = 1.4
\t_snare_mat = StandardMaterial3D.new()
\t_snare_mat.albedo_color = Color("#ffaf68")
\t_snare_mat.emission_enabled = true
\t_snare_mat.emission = Color("#ffaf68")
\t_supply_mat = StandardMaterial3D.new()
\t_supply_mat.albedo_color = Color("#8df5d5")
\t_supply_mat.emission_enabled = true
\t_supply_mat.emission = Color("#56bfae")
\t_hit_mat = StandardMaterial3D.new()
\t_hit_mat.albedo_color = Color("#ffdcaa")
\t_hit_mat.emission_enabled = true
\t_hit_mat.emission = Color("#ffdcaa")
\t_hit_mat.emission_energy_multiplier = 1.8

func _spawn_model(model_name: String, pos: Vector3, parent: Node = self) -> Node3D:
\treturn runtime.spawn_model(model_name, pos, parent)

func _play_sfx(clip_name: String, volume: float = 1.0, pitch: float = 1.0) -> void:
\truntime.play_sfx(clip_name, volume, pitch)

func _input(event: InputEvent) -> void:
\tif event.is_action_pressed("action_pause"):
\t\t_toggle_pause()
\t\tget_viewport().set_input_as_handled()
\t\treturn
\tif mode == "racing" and race_screen == "racing":
\t\tif event is InputEventKey and event.pressed and not event.echo:
\t\t\tvar ke := event as InputEventKey
\t\t\tif ke.physical_keycode == KEY_J and race_countdown <= 0.0:
\t\t\t\tqueued_pulse = true
\t\t\telif ke.physical_keycode == KEY_K and race_countdown <= 0.0:
\t\t\t\tqueued_snare = true
\t\t\telif ke.physical_keycode == KEY_R:
\t\t\t\t_recover_player()
\t\telif event is InputEventJoypadButton and event.pressed:
\t\t\tvar jb := event as InputEventJoypadButton
\t\t\tif (jb.button_index == JOY_BUTTON_RIGHT_SHOULDER or jb.button_index == JOY_BUTTON_X) and race_countdown <= 0.0:
\t\t\t\tqueued_pulse = true
\t\t\telif jb.button_index == JOY_BUTTON_Y and race_countdown <= 0.0:
\t\t\t\tqueued_snare = true
\t\t\telif jb.button_index == JOY_BUTTON_BACK:
\t\t\t\t_recover_player()
\t\treturn
\tif ui and _menu_is_active():
\t\tif ui.handle_menu_input(event):
\t\t\tget_viewport().set_input_as_handled()

func _menu_is_active() -> bool:
\tif mode == "racing":
\t\treturn race_screen != "racing"
\tif mode == "grid":
\t\treturn grid_paused or grid_won
\treturn generic_menu_open

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
\t\tgeneric_menu_open = not generic_menu_open
\t_rebuild_ui()

func _on_ui_back() -> void:
\t_toggle_pause()

func _on_ui_action(id: String) -> void:
\tif id == "sound":
\t\truntime.set_muted(not runtime.is_muted())
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
\t\t\t_recover_player()
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

\tif generic_mod != null:
\t\tif generic_mod.has_method("on_action"):
\t\t\tgeneric_mod.on_action(id, runtime)
\t\telif generic_mod.has_method("onAction"):
\t\t\tgeneric_mod.onAction(id, runtime)

\tif id == "close-menu":
\t\tgeneric_menu_open = false
\telif id == "open-menu":
\t\tgeneric_menu_open = true
\telif id == "test-sfx":
\t\tvar clips: Array = game_data.get("audio", [])
\t\tif clips.size() > 0:
\t\t\t_play_sfx(str(clips[0]))
\telse:
\t\tvar clips: Array = game_data.get("audio", [])
\t\tif clips.size() > 0:
\t\t\t_play_sfx(str(clips[0]))
\t_rebuild_ui()

# ==============================================================================
# SIGNAL DRIFT — THIN VIEW HOST OVER COMPILED racing/race.ts (ZERO DUPLICATED PHYSICS)
# ==============================================================================

func _load_circuit(index: int) -> void:
\tcircuit_index = clampi(index, 0, circuits.size() - 1)
\tif track_root and is_instance_valid(track_root):
\t\ttrack_root.queue_free()
\t_supply_pool.clear()
\t_pulse_pool.clear()
\t_snare_pool.clear()
\t_hit_pool.clear()
\ttrack_root = Node3D.new()
\ttrack_root.name = "CircuitRoot"
\tadd_child(track_root)
\tfx_root = Node3D.new()
\tfx_root.name = "FxRoot"
\ttrack_root.add_child(fx_root)

\tvar c: Dictionary = circuits[circuit_index]
\t_spawn_model("circuit-%s" % str(c["id"]), Vector3.ZERO, track_root)
\tif c.has("clear"):
\t\truntime.set_clear_color(c["clear"])

\tcar_nodes.clear()
\tqueued_pulse = false
\tqueued_snare = false
\trace_accum = 0.0
\tif race_mod and track_mod:
\t\tvar ts_circuit = track_mod.circuits[circuit_index]
\t\tvar build = championship.get("build", prog_mod.stock) if prog_mod else null
\t\trace_state = race_mod.createRace(ts_circuit, build)
\t\tvar ts_drivers: Array = race_state["drivers"]
\t\tfor slot in range(ts_drivers.size()):
\t\t\tvar d: Dictionary = ts_drivers[slot]
\t\t\tvar car := _spawn_model("car-%d" % slot, Vector3(float(d["x"]), 0.0, float(d["z"])), track_root)
\t\t\tif car:
\t\t\t\tcar.rotation.y = float(d["yaw"])
\t\t\t\tif slot == 0:
\t\t\t\t\tvar beacon := MeshInstance3D.new()
\t\t\t\t\tbeacon.mesh = _pulse_mesh
\t\t\t\t\tbeacon.material_override = _hit_mat
\t\t\t\t\tbeacon.scale = Vector3(0.55, 0.45, 0.55)
\t\t\t\t\tbeacon.position = Vector3(0.0, 1.85, 0.0)
\t\t\t\t\tcar.add_child(beacon)
\t\t\tcar_nodes.append(car)
\t\t_sync_race_fx()
\t_update_race_camera(false)

func _start_race(index: int) -> void:
\t_load_circuit(index)
\trace_countdown = 2.4
\trace_result = {}
\trace_screen = "racing"
\t_rebuild_ui()

func _recover_player() -> void:
\tif race_mod and not race_state.is_empty() and race_countdown <= 0.0:
\t\trace_mod.recover(race_state["drivers"][0], race_state["circuit"])

func _driver_place(slot: int) -> int:
\tif race_mod == null or race_state.is_empty():
\t\treturn 1
\tvar order: Array = race_mod.standings(race_state)
\tfor i in range(order.size()):
\t\tif int(order[i]["slot"]) == slot:
\t\t\treturn i + 1
\treturn 1

func _acquire_fx(pool: Array[MeshInstance3D], index: int, mesh: Mesh, mat: Material) -> MeshInstance3D:
\twhile pool.size() <= index:
\t\tvar m := MeshInstance3D.new()
\t\tm.mesh = mesh
\t\tm.material_override = mat
\t\tfx_root.add_child(m)
\t\tpool.append(m)
\tvar node: MeshInstance3D = pool[index]
\tnode.visible = true
\treturn node

func _hide_unused_fx(pool: Array[MeshInstance3D], used: int) -> void:
\tfor i in range(used, pool.size()):
\t\tpool[i].visible = false

func _sync_race_fx() -> void:
\tif fx_root == null or race_state.is_empty():
\t\treturn
\tvar supply_used := 0
\tfor sup in race_state["supplies"]:
\t\tif float(sup["cooldown"]) > 0.0:
\t\t\tcontinue
\t\tvar m := _acquire_fx(_supply_pool, supply_used, _supply_mesh, _supply_mat)
\t\tm.position = Vector3(float(sup["x"]), 0.55, float(sup["z"]))
\t\tm.rotation.y = float(sup["yaw"]) + float(race_state["elapsed"]) * 1.4
\t\tsupply_used += 1
\t_hide_unused_fx(_supply_pool, supply_used)

\tvar pulse_used := 0
\tvar snare_used := 0
\tfor w in race_state["weapons"]:
\t\tif str(w["kind"]) == "pulse":
\t\t\tvar m := _acquire_fx(_pulse_pool, pulse_used, _pulse_mesh, _pulse_mat)
\t\t\tm.position = Vector3(float(w["x"]), 0.65, float(w["z"]))
\t\t\tpulse_used += 1
\t\telse:
\t\t\tvar m := _acquire_fx(_snare_pool, snare_used, _snare_mesh, _snare_mat)
\t\t\tm.position = Vector3(float(w["x"]), 0.2, float(w["z"]))
\t\t\tsnare_used += 1
\t_hide_unused_fx(_pulse_pool, pulse_used)
\t_hide_unused_fx(_snare_pool, snare_used)

\tvar hit_used := 0
\tfor h in race_state["hits"]:
\t\tvar m := _acquire_fx(_hit_pool, hit_used, _pulse_mesh, _hit_mat)
\t\tvar s := 1.0 + float(h["age"]) * 5.0
\t\tm.scale = Vector3(s, s, s)
\t\tm.position = Vector3(float(h["x"]), 0.8, float(h["z"]))
\t\thit_used += 1
\t_hide_unused_fx(_hit_pool, hit_used)

func _step_racing(delta: float) -> void:
\tif race_screen != "racing" or race_mod == null or race_state.is_empty():
\t\t_update_race_camera(false)
\t\treturn
\tif race_countdown > 0.0:
\t\tvar prev_c := ceili(race_countdown)
\t\trace_countdown = maxf(0.0, race_countdown - delta)
\t\tif race_countdown == 0.0 or ceili(race_countdown) != prev_c:
\t\t\tif race_countdown == 0.0:
\t\t\t\tqueued_pulse = false
\t\t\t\tqueued_snare = false
\t\t\t\t_play_sfx("go")
\t\t\t_rebuild_ui()
\t\t_update_race_camera(true)
\t\treturn

\tvar step_dt := 1.0 / 60.0
\trace_accum = minf(race_accum + delta, 0.1)
\tvar player: Dictionary = race_state["drivers"][0]
\tvar prev_pulses := int(player["pulses"])
\tvar prev_snares := int(player["snares"])
\tvar prev_shield := int(player["shield"])

\tvar gas := 1.0 if (Input.is_action_pressed("move_up") or Input.is_joy_button_pressed(0, JOY_BUTTON_A) or Input.get_joy_axis(0, JOY_AXIS_TRIGGER_RIGHT) > 0.2) else 0.0
\tvar brake := 1.0 if (Input.is_action_pressed("move_down") or Input.get_joy_axis(0, JOY_AXIS_TRIGGER_LEFT) > 0.2) else 0.0
\tvar throttle := gas - brake
\tvar steer := Input.get_axis("move_left", "move_right")
\tvar drift := Input.is_key_pressed(KEY_SPACE) or Input.is_joy_button_pressed(0, JOY_BUTTON_B) or Input.is_joy_button_pressed(0, JOY_BUTTON_LEFT_SHOULDER)
\tvar pulse_held := Input.is_key_pressed(KEY_J) or Input.is_joy_button_pressed(0, JOY_BUTTON_RIGHT_SHOULDER) or Input.is_joy_button_pressed(0, JOY_BUTTON_X)
\tvar snare_held := Input.is_key_pressed(KEY_K) or Input.is_joy_button_pressed(0, JOY_BUTTON_Y)

\twhile race_accum >= step_dt:
\t\trace_accum -= step_dt
\t\tvar control := {
\t\t\t"throttle": throttle,
\t\t\t"steer": steer,
\t\t\t"drift": drift,
\t\t\t"pulse": queued_pulse or pulse_held,
\t\t\t"snare": queued_snare or snare_held
\t\t}
\t\tqueued_pulse = false
\t\tqueued_snare = false
\t\trace_mod.stepRace(race_state, control, step_dt)

\tif int(player["pulses"]) < prev_pulses:
\t\t_play_sfx("pulse")
\tif int(player["snares"]) < prev_snares:
\t\t_play_sfx("snare")
\tif int(player["shield"]) < prev_shield:
\t\t_play_sfx("hit")

\tvar ts_drivers: Array = race_state["drivers"]
\tfor i in range(mini(car_nodes.size(), ts_drivers.size())):
\t\tvar d: Dictionary = ts_drivers[i]
\t\tvar car: Node3D = car_nodes[i]
\t\tif car:
\t\t\tcar.position = Vector3(float(d["x"]), 0.0, float(d["z"]))
\t\t\tcar.rotation.y = float(d["yaw"])
\t\t\tvar speed := Vector2(float(d["vx"]), float(d["vz"])).length()
\t\t\tvar target_roll := -float(d["steer"]) * minf(0.19, speed * 0.011)
\t\t\tcar.rotation.z = lerpf(car.rotation.z, target_roll, clampf(delta * 10.0, 0.0, 1.0))

\t_sync_race_fx()

\tif player["finish"] != null:
\t\tvar place := _driver_place(0)
\t\tvar ts_circuit: Dictionary = race_state["circuit"]
\t\tvar qual := place <= int(ts_circuit["qualify"])
\t\tvar payout := int(prog_mod.recordResult(championship, ts_circuit, place, float(player["finish"]))) if prog_mod else 0
\t\tif prog_mod:
\t\t\tprog_mod.saveChampionship(runtime.storage, championship)
\t\trace_result = { "place": place, "seconds": float(player["finish"]), "qualified": qual, "payout": payout }
\t\tif qual:
\t\t\t_play_sfx("podium")
\t\trace_screen = "results"

\t_update_race_camera(true)
\t_rebuild_ui()

func _update_race_camera(follow: bool) -> void:
\tif camera == null or race_state.is_empty():
\t\treturn
\tif follow:
\t\tvar p: Dictionary = race_state["drivers"][0]
\t\tvar target := Vector3(float(p["x"]), 0.0, float(p["z"]))
\t\truntime.set_camera({ "projection": "orthographic", "size": 38.0, "position": target + Vector3(58.0, 58.0, 58.0), "target": target })
\telse:
\t\truntime.set_camera({ "projection": "orthographic", "size": 64.0, "position": Vector3(68.0, 68.0, 68.0), "target": Vector3.ZERO })

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

\tvar cx := float(map_w - 1) * 0.5
\tvar cz := float(map_h - 1) * 0.5
\tvar dist := maxf(float(map_w), float(map_h)) * 2.0 + 8.0
\truntime.set_camera({
\t\t"projection": "orthographic",
\t\t"size": maxf(float(map_h) * 0.5 + 3.8, (float(map_w) + 2.0) * 0.62),
\t\t"position": Vector3(cx, 0.5 + dist * 0.5, cz + dist * cos(PI / 6.0)),
\t\t"target": Vector3(cx, 0.5, cz)
\t})

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
\t\tplayer_node.rotation.y = atan2(float(dir.x), float(dir.y))
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

# ==============================================================================
# GENERIC RIDGETOP RUNTIME BOOTSTRAP (Tidewatch / Beacon Run / Custom Games)
# ==============================================================================

func _setup_generic_game() -> void:
\tgeneric_root = Node3D.new()
\tgeneric_root.name = "GenericSceneRoot"
\tadd_child(generic_root)

\tvar entry_path := str(game_data.get("entry", game_data.get("runtimeModule", "")))
\tif entry_path != "":
\t\tgeneric_mod = runtime.load_compiled_module(entry_path)

\tif game_data.has("scene") and game_data["scene"] is Array:
\t\tgeneric_spin_stage = false
\t\tfor ent_val in game_data["scene"] as Array:
\t\t\tif not (ent_val is Dictionary):
\t\t\t\tcontinue
\t\t\tvar ent: Dictionary = ent_val as Dictionary
\t\t\tvar pos := runtime._to_vec3(ent.get("position", Vector3.ZERO), Vector3.ZERO)
\t\t\tvar node := _spawn_model(str(ent.get("model", "")), pos, generic_root)
\t\t\tif node:
\t\t\t\tif ent.has("rotation"):
\t\t\t\t\tnode.quaternion = RidgetopRuntime.InstancedBatch._coerce_quat(ent["rotation"])
\t\t\t\telif ent.has("yaw"):
\t\t\t\t\tnode.rotation.y = float(ent["yaw"])
\t\t\t\tif ent.has("scale"):
\t\t\t\t\tnode.scale = runtime._to_scale_vec3(ent["scale"], Vector3.ONE)
\telse:
\t\tvar names: Array = game_data.get("models", [])
\t\tfor i in range(names.size()):
\t\t\tvar x_off := (float(i) - float(names.size() - 1) * 0.5) * 2.4
\t\t\t_spawn_model(str(names[i]), Vector3(x_off, 0.0, 0.0), generic_root)

\tif game_data.has("rigs") and game_data["rigs"] is Array:
\t\tfor rig_val in game_data["rigs"] as Array:
\t\t\tif not (rig_val is Dictionary):
\t\t\t\tcontinue
\t\t\tvar rig_cfg: Dictionary = rig_val as Dictionary
\t\t\tvar joints_val = rig_cfg.get("joints", [])
\t\t\tif joints_val is Array:
\t\t\t\tvar rig := runtime.create_rig(joints_val as Array, generic_root)
\t\t\t\tvar poses: Dictionary = rig_cfg.get("poses", {}) if rig_cfg.get("poses", null) is Dictionary else {}
\t\t\t\trig.apply_poses(poses, rig_cfg)
\t\t\t\tgeneric_rigs.append(rig)

\tif game_data.has("camera") and game_data["camera"] is Dictionary:
\t\truntime.set_camera(game_data["camera"] as Dictionary)
\telse:
\t\truntime.set_camera({
\t\t\t"projection": "perspective",
\t\t\t"position": Vector3(-1.0, 2.4, 5.2),
\t\t\t"target": Vector3(-0.3, 0.5, 0.0)
\t\t})

\tif generic_mod != null:
\t\tgeneric_spin_stage = false
\t\tif generic_mod.has_method("init_game"):
\t\t\tgeneric_mod.init_game(runtime, game_data)
\t\telif generic_mod.has_method("initGame"):
\t\t\tgeneric_mod.initGame(runtime, game_data)

func _sample_generic_input() -> Dictionary:
\treturn {
\t\t"x": Input.get_axis("move_left", "move_right"),
\t\t"z": Input.get_axis("move_up", "move_down"),
\t\t"confirm": Input.is_action_pressed("action_confirm"),
\t\t"cancel": Input.is_action_pressed("action_cancel")
\t}

func _step_generic(delta: float) -> void:
\tif generic_mod != null:
\t\tvar inp := _sample_generic_input()
\t\tif generic_mod.has_method("step_game"):
\t\t\tgeneric_mod.step_game(delta, inp, runtime)
\t\telif generic_mod.has_method("stepGame"):
\t\t\tgeneric_mod.stepGame(delta, inp, runtime)
\t\t_rebuild_ui()
\telif generic_root and generic_spin_stage:
\t\tgeneric_root.rotate_y(delta * 0.55)

func _process(delta: float) -> void:
\tif mode == "racing":
\t\t_step_racing(delta)
\telif mode == "grid":
\t\t_step_grid(delta)
\telse:
\t\t_step_generic(delta)

# ==============================================================================
# CUSTOM LOW-POLY CANVAS UI LAYOUT (Ridgetop Aesthetic — Zero Default Controls)
# ==============================================================================

func _fmt_time(sec: float) -> String:
\tvar cs := int(floor(sec * 100.0))
\tvar rem := str(cs % 6000).pad_zeros(4)
\treturn "%d:%s.%s" % [int(floor(float(cs) / 6000.0)), rem.substr(0, 2), rem.substr(2, 2)]

func _rebuild_ui() -> void:
\tif ui == null:
\t\treturn
\tvar vp := get_viewport().get_visible_rect().size
\tvar w := vp.x
\tvar h := vp.y
\tvar items: Array = []
\tvar sound_on := not runtime.is_muted()

\tif mode == "racing":
\t\tvar c: Dictionary = circuits[circuit_index]
\t\tif race_screen == "racing" and not race_state.is_empty():
\t\t\tvar p: Dictionary = race_state["drivers"][0]
\t\t\tvar pos := "%d / %d" % [_driver_place(0), (race_state["drivers"] as Array).size()]
\t\t\tvar lap_txt := "LAP %d / %d" % [mini(int(c["laps"]), int(p["lap"]) + 1), int(c["laps"])]
\t\t\tvar kmh := "%d" % roundi(Vector2(float(p["vx"]), float(p["vz"])).length() * 3.6)
\t\t\tvar surf := "REBOOTING" if float(p["disabled"]) > 0.0 else ("OFF TRACK" if bool(p["offroad"]) else ("DRIFTING" if bool(p["drift"]) else "ON TRACK"))
\t\t\tvar time_txt := _fmt_time(float(race_state["elapsed"]))
\t\t\tvar ui_key := "r|%d|%d|%d|%s|%s|%s|%s|%s|%d|%d|%d|%d" % [int(w), int(h), ceili(race_countdown), pos, lap_txt, kmh, surf, time_txt, int(p["shield"]), int(p["maxShield"]), int(p["pulses"]), int(p["snares"])]
\t\t\tif ui_key == _last_ui_key:
\t\t\t\treturn
\t\t\t_last_ui_key = ui_key
\t\t\titems.append({ "type": "panel", "rect": Rect2(18, 18, 210, 90) })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, 26, 90, 16), "text": "POSITION", "size": 11, "color": Color("#f3bd88") })
\t\t\titems.append({ "type": "text", "rect": Rect2(118, 26, 98, 16), "text": lap_txt, "size": 11, "align": "right", "color": Color("#f3bd88") })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, 44, 100, 32), "text": pos, "size": 26 })
\t\t\titems.append({ "type": "text", "rect": Rect2(118, 52, 98, 20), "text": time_txt, "size": 13, "align": "right" })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, 82, 186, 18), "text": str(c["name"]).to_upper(), "size": 11, "color": Color("#f3bd88") })

\t\t\titems.append({ "type": "panel", "rect": Rect2(18, h - 126, 210, 108) })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, h - 118, 110, 34), "text": kmh, "size": 30 })
\t\t\titems.append({ "type": "text", "rect": Rect2(138, h - 106, 78, 18), "text": "KM/H", "size": 12, "align": "right", "color": Color("#f3bd88") })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, h - 78, 186, 16), "text": surf, "size": 11, "color": Color("#ff957c") if bool(p["offroad"]) else Color("#f3bd88") })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, h - 60, 186, 16), "text": "SHIELD %d / %d" % [int(p["shield"]), int(p["maxShield"])], "size": 11, "color": Color("#f3bd88") })
\t\t\titems.append({ "type": "bar", "rect": Rect2(30, h - 42, 186, 5), "ratio": float(p["shield"]) / maxf(1.0, float(p["maxShield"])) })
\t\t\titems.append({ "type": "text", "rect": Rect2(30, h - 32, 186, 16), "text": "PULSE %d  ·  SNARE %d" % [int(p["pulses"]), int(p["snares"])], "size": 11 })

\t\t\titems.append({ "type": "button", "id": "race-recover", "rect": Rect2(w - 190, 18, 86, 38), "label": "Recover" })
\t\t\titems.append({ "type": "button", "id": "race-pause", "rect": Rect2(w - 96, 18, 78, 38), "label": "Pause" })
\t\t\tif race_countdown > 0.0:
\t\t\t\titems.append({ "type": "panel", "rect": Rect2(w * 0.5 - 42, h * 0.28 - 32, 84, 64) })
\t\t\t\titems.append({ "type": "text", "rect": Rect2(w * 0.5 - 42, h * 0.28 - 32, 84, 64), "text": str(ceili(race_countdown)), "size": 42, "align": "center" })
\t\telse:
\t\t\t_last_ui_key = ""
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
\t\t\t\t\titems.append({ "type": "toggle", "id": "sound", "rect": Rect2(cx + 32 + half, y, half, 40), "label": "Sound", "checked": sound_on })
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
\t\t\titems.append({ "type": "toggle", "id": "sound", "rect": Rect2(mx + 24, y, cw - 48, 40), "label": "Sound", "checked": sound_on })
\t\t\ty += 48.0
\t\t\titems.append({ "type": "button", "id": "quit", "rect": Rect2(mx + 24, y, cw - 48, 38), "label": "Quit" })
\telse:
\t\tvar custom_items: Variant = null
\t\tif generic_mod != null:
\t\t\tif generic_mod.has_method("build_ui"):
\t\t\t\tcustom_items = generic_mod.build_ui(vp, runtime)
\t\t\telif generic_mod.has_method("buildUi"):
\t\t\t\tcustom_items = generic_mod.buildUi(vp, runtime)
\t\tif custom_items is Array:
\t\t\titems = custom_items as Array
\t\telif generic_menu_open:
\t\t\tvar clips: Array = game_data.get("audio", [])
\t\t\tvar has_audio := clips.size() > 0
\t\t\tvar panel_h := 288.0 if has_audio else 240.0
\t\t\titems.append({ "type": "panel", "rect": Rect2(36, 36, 320, panel_h) })
\t\t\titems.append({ "type": "text", "rect": Rect2(56, 56, 280, 34), "text": str(game_data.get("name", "${godotEscape(name)}")).to_upper(), "size": 24, "align": "center" })
\t\t\tvar gy := 104.0
\t\t\titems.append({ "type": "button", "id": "close-menu", "rect": Rect2(56, gy, 280, 42), "label": "Inspect 3D Scene", "primary": true })
\t\t\tgy += 50.0
\t\t\tif has_audio:
\t\t\t\titems.append({ "type": "button", "id": "test-sfx", "rect": Rect2(56, gy, 280, 40), "label": "Test Audio" })
\t\t\t\tgy += 48.0
\t\t\titems.append({ "type": "toggle", "id": "sound", "rect": Rect2(56, gy, 280, 40), "label": "Sound", "checked": sound_on })
\t\t\tgy += 48.0
\t\t\titems.append({ "type": "button", "id": "quit", "rect": Rect2(56, gy, 280, 40), "label": "Quit" })
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
  const { outDir, name, slug, models, audio = {}, gameData, iconPng } = options
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
  await writeFile(join(scriptsDir, 'ridgetop_runtime.gd'), renderRuntimeGd())
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
- **Runtime Bridge (\`scripts/ridgetop_runtime.gd\`):** Generic Godot 4 runtime providing dynamic lighting/fog/point lights, opaque/alpha/additive instanced & pooled batches, hierarchical rigs, 3D particles, and a multi-bus \`AudioServer\` mixer.
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
