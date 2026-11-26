import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bakeMotifWav, encodeGlb } from './binary-encoders.ts'
import type { InstanceBatch } from './types.ts'

export { bakeMotifWav, encodeGlb, encodeWav } from './binary-encoders.ts'

export type GodotRuntimeTemplateName = 'ridgetop_ui.gd' | 'ridgetop_runtime.gd' | 'main.gd' | 'rt.gd'

export const MISSING_TYPESCRIPT_COMPILER_MESSAGE =
  'Godot TypeScript compilation requires the optional peer dependency "typescript". Install it with: npm install -D typescript'

export interface GodotCompileProjectOptions {
  /** Absolute paths (or bare `ridgetop/*` specifiers) to root TypeScript modules to compile. */
  entries: readonly string[]
  /** Project root used to compute relative output paths (e.g. `framework/platformer.ts` -> `outDir/framework/platformer.gd`). */
  rootDir: string
  /** Destination directory for compiled `.gd` files and `rt.gd`. */
  outDir: string
  /** Godot `res://` prefix corresponding to `outDir` (default: `res://scripts/compiled`). */
  resPrefix?: string
}

export interface GodotCompilerModule {
  compileTsToGd(sourceText: string, fileName?: string, options?: {
    rtResPath?: string
    resolveImport?(specifier: string, exportedName: string): { resPath: string; exportName: string }
  }): string
  compileTsProjectToGodot(options: GodotCompileProjectOptions): Promise<{ files: string[]; rtPath: string }>
  renderRtGd(): string
}

export interface LoadGodotCompilerOptions {
  /** Optional game project directory containing a local `tools/ts-to-gd.js` (e.g. `createGame()` projects). */
  projectDir?: string
  /** Optional explicit compiler module path override. */
  compilerPath?: string
}

const templateCache = new Map<GodotRuntimeTemplateName, string>()

/** Resolve the on-disk path of a bundled Godot 4 runtime `.gd` template across source, built dist, and `createGame()` layouts. */
export function resolveGodotRuntimeTemplatePath(name: GodotRuntimeTemplateName): string {
  const candidates = [
    fileURLToPath(new URL(`../templates/godot-runtime/${name}`, import.meta.url)),
    fileURLToPath(new URL(`../../templates/godot-runtime/${name}`, import.meta.url))
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `Missing Godot runtime template "${name}". Checked:\n  - ${candidates.join('\n  - ')}`
  )
}

/** Read a bundled Godot 4 runtime `.gd` template from disk (cached in-process). */
export function readGodotRuntimeTemplate(name: GodotRuntimeTemplateName): string {
  let cached = templateCache.get(name)
  if (cached === undefined) {
    cached = readFileSync(resolveGodotRuntimeTemplatePath(name), 'utf8')
    templateCache.set(name, cached)
  }
  return cached
}

/** Resolve the first available path to the `ts-to-gd` compiler across TS source, built dist, and standalone projects. */
export function resolveGodotCompilerPath(options: LoadGodotCompilerOptions = {}): string | null {
  if (options.compilerPath) {
    const explicit = resolve(options.compilerPath)
    return existsSync(explicit) ? explicit : null
  }

  const rawCandidates = import.meta.url.endsWith('.ts')
    ? [
        fileURLToPath(new URL('../tools/ts-to-gd.ts', import.meta.url)),
        fileURLToPath(new URL('../dist/tools/ts-to-gd.js', import.meta.url))
      ]
    : [
        fileURLToPath(new URL('../tools/ts-to-gd.js', import.meta.url)),
        fileURLToPath(new URL('../../tools/ts-to-gd.ts', import.meta.url)),
        fileURLToPath(new URL('../../dist/tools/ts-to-gd.js', import.meta.url))
      ]

  if (options.projectDir) {
    rawCandidates.push(join(resolve(options.projectDir), 'tools', 'ts-to-gd.js'))
  }

  const seen = new Set<string>()
  for (const candidate of rawCandidates) {
    const normalized = resolve(candidate)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    if (existsSync(normalized)) return normalized
  }
  return null
}

function isMissingTypescriptError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = 'code' in error ? error.code : undefined
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false
  const message = 'message' in error ? String(error.message) : ''
  return /['"]typescript['"]|\bpackage ['"]?typescript['"]?/i.test(message)
}

/** Dynamically load the Ridgetop TS -> GDScript compiler with consistent peer-dependency diagnostics. */
export async function loadGodotCompiler(options: LoadGodotCompilerOptions = {}): Promise<GodotCompilerModule> {
  const compilerPath = resolveGodotCompilerPath(options)
  if (!compilerPath) {
    throw new Error('Godot TypeScript compiler (ts-to-gd) not found.')
  }
  let mod: Partial<GodotCompilerModule>
  try {
    mod = await import(pathToFileURL(compilerPath).href)
  } catch (error) {
    if (isMissingTypescriptError(error)) {
      throw new Error(MISSING_TYPESCRIPT_COMPILER_MESSAGE, { cause: error })
    }
    throw error
  }
  if (
    typeof mod.compileTsProjectToGodot !== 'function' ||
    typeof mod.compileTsToGd !== 'function' ||
    typeof mod.renderRtGd !== 'function'
  ) {
    throw new Error(`Godot compiler module at ${compilerPath} does not export compileTsProjectToGodot().`)
  }
  return {
    compileTsToGd: mod.compileTsToGd,
    compileTsProjectToGodot: mod.compileTsProjectToGodot,
    renderRtGd: mod.renderRtGd
  }
}

function godotEscape(text: string): string {
  return text
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\t', '\\t')
}

function renderMainGd(name: string): string {
  return readGodotRuntimeTemplate('main.gd').replaceAll('__GAME_NAME__', () => godotEscape(name))
}

export interface GodotExportOptions {
  outDir: string
  name: string
  slug: string
  models: Record<string, readonly InstanceBatch[]>
  audio?: Record<string, { notes: readonly (readonly [number, number, number, number?])[]; waveform?: 'sine' | 'triangle' | 'square' | 'sawtooth' }>
  gameData: Record<string, unknown>
  /** Optional project-supplied GDScript source written to `scripts/main.gd` instead of the generic host. */
  mainScript?: string
  iconPng: Buffer
}

/** Emit a complete Godot 4 project (GLB 3D models, WAV SFX, JSON data, Canvas UI renderer, Keyboard+Switch/Gamepad input map). */
export async function exportGodotProject(options: GodotExportOptions) {
  const { outDir, name, slug, models, audio = {}, gameData, mainScript, iconPng } = options
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

  await writeFile(join(scriptsDir, 'ridgetop_ui.gd'), readGodotRuntimeTemplate('ridgetop_ui.gd'))
  await writeFile(join(scriptsDir, 'ridgetop_runtime.gd'), readGodotRuntimeTemplate('ridgetop_runtime.gd'))
  await writeFile(join(scriptsDir, 'main.gd'), mainScript ?? renderMainGd(name))
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
- **Canvas UI (\`scripts/ridgetop_ui.gd\`, \`scenes/ui.tscn\`):** Custom Godot 4 \`CanvasItem._draw()\` UI renderer matching Ridgetop's low-poly faceted panels, buttons, toggles, and HUD cards (zero default Godot widgets or HTML/CSS required).
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
