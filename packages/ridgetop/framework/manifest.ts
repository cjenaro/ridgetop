/**
 * Single authoritative manifest of Ridgetop public specifiers, hosted browser modules,
 * studio-stripping rules, and testing-runtime no-op stubs for JS and Godot 4 builds.
 */

export interface PackageExportEntry {
  readonly types: string
  readonly default: string
}

/** Public browser bare specifiers mapped to their compiled framework `.js` filename. */
export const RIDGETOP_BROWSER_SPECIFIER_FILES: Readonly<Record<string, string>> = Object.freeze({
  ridgetop: 'index.js',
  'ridgetop/ui': 'ui.js',
  'ridgetop/ui-layout': 'ui-layout.js',
  'ridgetop/ui-button': 'ui-button.js',
  'ridgetop/ui-toggle': 'ui-toggle.js',
  'ridgetop/ui-select': 'ui-select.js',
  'ridgetop/ui-slider': 'ui-slider.js',
  'ridgetop/ui-menu': 'ui-menu.js',
  'ridgetop/ui-canvas': 'ui-canvas.js',
  'ridgetop/ui-machine': 'ui-machine.js',
  'ridgetop/art-review': 'art-review.js',
  'ridgetop/testing': 'testing-runtime.js'
})

/** Public server/tooling bare specifiers mapped to their compiled framework `.js` filename. */
export const RIDGETOP_SERVER_SPECIFIER_FILES: Readonly<Record<string, string>> = Object.freeze({
  'ridgetop/server': 'server.js',
  'ridgetop/art-review/server': 'review-store.js'
})

/** All public bare specifiers (browser + server) mapped to their compiled framework `.js` filename. */
export const RIDGETOP_ALL_SPECIFIER_FILES: Readonly<Record<string, string>> = Object.freeze({
  ...RIDGETOP_BROWSER_SPECIFIER_FILES,
  ...RIDGETOP_SERVER_SPECIFIER_FILES
})

/** Browser import-map entries served by `createGameHost` (`specifier -> /framework/<file>`). */
export const RIDGETOP_BROWSER_IMPORT_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(RIDGETOP_BROWSER_SPECIFIER_FILES).map(([specifier, file]) => [specifier, '/framework/' + file])
  )
)

/** Expected `packages/ridgetop/package.json` `exports` map derived from the manifest. */
export const RIDGETOP_PACKAGE_EXPORTS: Readonly<Record<string, PackageExportEntry>> = Object.freeze(
  Object.fromEntries(
    Object.entries(RIDGETOP_ALL_SPECIFIER_FILES).map(([specifier, file]) => {
      const exportKey = specifier === 'ridgetop' ? '.' : './' + specifier.slice('ridgetop/'.length)
      const stem = file.replace(/\.js$/, '')
      return [
        exportKey,
        Object.freeze({
          types: `./dist/framework/${stem}.d.ts`,
          default: `./dist/framework/${stem}.js`
        })
      ]
    })
  )
)

/** Runtime framework modules served in browser hosts and eligible for release bundles. */
export const BROWSER_RUNTIME_MODULES: readonly string[] = Object.freeze([
  'index.js', 'rng.js', 'loop.js', 'renderer.js', 'room-client.js',
  'geometry.js', 'instances.js', 'low-poly.js', 'mesh-gpu.js', 'mesh-gl.js', 'mesh-canvas.js',
  'input.js', 'vehicle.js', 'page.js', 'platform.js', 'backup.js', 'audio.js', 'audio-assets.js', 'import-mesh.js',
  'hud.js', 'perf.js', 'sprites.js', 'sprite-sheet.js', 'pixel-rig.js',
  'art.js', 'art-recipe.js', 'art-builder.js', 'character-builder.js', 'platformer.js', 'animation.js', 'physics3d.js',
  'ui.js', 'ui-machine.js', 'ui-layout.js', 'ui-button.js', 'ui-toggle.js', 'ui-select.js', 'ui-slider.js', 'ui-menu.js', 'ui-canvas.js'
])

/** Browser-loadable studio/verification/testing modules served in dev hosts but stripped from release builds. */
export const BROWSER_STUDIO_MODULES: readonly string[] = Object.freeze([
  'verification.js',
  'art-review.js',
  'testing-protocol.js',
  'testing-recognition.js',
  'testing-runtime.js',
  'testing-session.js',
  'testing-studio.js'
])

/** Complete allowlist of framework JS modules hosted at `/framework/<file>` by `createGameHost`. */
export const HOSTED_BROWSER_MODULES: readonly string[] = Object.freeze([
  ...BROWSER_RUNTIME_MODULES,
  ...BROWSER_STUDIO_MODULES
])

/** Server/tooling-only framework modules that must never ship in browser/release bundles. */
export const SERVER_FRAMEWORK_MODULES: readonly string[] = Object.freeze([
  'manifest.js',
  'review-store.js',
  'decision-api.js',
  'decision-providers.js',
  'host.js',
  'room-server.js',
  'records.js',
  'server.js',
  'packager.js',
  'export-godot.js',
  'binary-encoders.js',
  'png.js'
])

/** Project-level studio/dev files excluded from packaged release builds. */
export const PROJECT_STUDIO_FILES: readonly string[] = Object.freeze([
  'serve.js',
  'testing.js',
  'testing-scene.js',
  'testing.html',
  'testing.css',
  'testing-overlay.css',
  'preview-art.js',
  'art-library.js',
  'package.js'
])

/** All filenames dropped from packaged release bundles (web, Steam, mobile, portable player). */
export const BLOCKED_STUDIO_FILES: ReadonlySet<string> = new Set([
  ...BROWSER_STUDIO_MODULES,
  ...SERVER_FRAMEWORK_MODULES,
  ...PROJECT_STUDIO_FILES
])

/** Directory names skipped when copying static assets into packaged release bundles. */
export const BLOCKED_STUDIO_DIRS: ReadonlySet<string> = new Set([
  'library', 'reviews', 'benchmarks', 'test', 'tools', 'node_modules', 'dist'
])

export type TestingNoopKind =
  | 'false'
  | 'void'
  | 'unsubscribe'
  | 'undefined'
  | 'null'
  | 'emptyString'
  | 'emptyArray'

export interface TestingNoopSpec {
  readonly kind: TestingNoopKind
  /** Maximum positional parameter count accepted in GDScript (each defaulted to `null`). */
  readonly arity: number
}

/**
 * Authoritative no-op contract for EVERY exported function in `testing-runtime.ts`.
 * Both JS release stripping (`packager.ts`) and Godot 4 release stripping (`ts-to-gd.ts`)
 * are generated directly from this table.
 */
export const TESTING_RUNTIME_NOOPS: Readonly<Record<string, TestingNoopSpec>> = Object.freeze({
  isTestingActive: { kind: 'false', arity: 0 },
  setTestingActive: { kind: 'void', arity: 1 },
  isTestingPaused: { kind: 'false', arity: 0 },
  setTestingPaused: { kind: 'void', arity: 1 },
  onTestingPause: { kind: 'unsubscribe', arity: 1 },
  captureSourceSite: { kind: 'undefined', arity: 1 },
  registerKnownShapes: { kind: 'void', arity: 1 },
  getKnownShapeName: { kind: 'undefined', arity: 1 },
  recordMeshMeta: { kind: 'void', arity: 2 },
  getMeshMeta: { kind: 'undefined', arity: 1 },
  recordRigMeta: { kind: 'void', arity: 2 },
  getRigMeta: { kind: 'undefined', arity: 1 },
  nextTestingGroupId: { kind: 'emptyString', arity: 1 },
  nextSpriteAtlasId: { kind: 'emptyString', arity: 0 },
  registerArtKitRuntime: { kind: 'unsubscribe', arity: 1 },
  getRegisteredArtKits: { kind: 'emptyArray', arity: 0 },
  findRegisteredArtModel: { kind: 'undefined', arity: 1 },
  recordFrame: { kind: 'void', arity: 1 },
  getLastFrame: { kind: 'undefined', arity: 0 },
  recordSpriteBegin: { kind: 'void', arity: 1 },
  recordSpriteDraw: { kind: 'void', arity: 1 },
  getLastSpriteDraws: { kind: 'emptyArray', arity: 0 },
  registerHudRegion: { kind: 'unsubscribe', arity: 1 },
  recordCanvasUiRegions: { kind: 'void', arity: 2 },
  getHudRegions: { kind: 'emptyArray', arity: 0 },
  registerTestingHooks: { kind: 'unsubscribe', arity: 1 },
  onTestingHooksRegistered: { kind: 'unsubscribe', arity: 1 },
  getTestingHooks: { kind: 'emptyArray', arity: 0 },
  resetTestingRuntime: { kind: 'void', arity: 0 },
  recognizeAssetFromPick: { kind: 'null', arity: 3 }
})

const JS_NOOP_EXPR: Readonly<Record<TestingNoopKind, string>> = Object.freeze({
  false: '() => false',
  void: '() => {}',
  unsubscribe: '() => () => {}',
  undefined: '() => undefined',
  null: '() => null',
  emptyString: '() => ""',
  emptyArray: '() => []'
})

/** Inline JS arrow expressions for stripped `testing-runtime.js` imports and re-exports. */
export const TESTING_RUNTIME_JS_NOOPS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(TESTING_RUNTIME_NOOPS).map(([name, spec]) => [name, JS_NOOP_EXPR[spec.kind]])
  )
)

/** Render a frozen JS namespace object containing all stripped testing-runtime no-ops. */
export function renderTestingNoopNamespaceJs(): string {
  const entries = Object.entries(TESTING_RUNTIME_JS_NOOPS).map(([k, v]) => `${k}: ${v}`).join(', ')
  return `Object.freeze({ ${entries} })`
}

const GD_NOOP_RETURN: Readonly<Record<TestingNoopKind, { ret: string; body: string }>> = Object.freeze({
  false: { ret: 'bool', body: 'return false' },
  void: { ret: 'void', body: 'pass' },
  unsubscribe: { ret: 'Callable', body: 'return func(): pass' },
  undefined: { ret: 'Variant', body: 'return null' },
  null: { ret: 'Variant', body: 'return null' },
  emptyString: { ret: 'String', body: 'return ""' },
  emptyArray: { ret: 'Array', body: 'return []' }
})

/** Render the Godot 4 no-op `testing-runtime.gd` shim from `TESTING_RUNTIME_NOOPS`. */
export function renderTestingNoopGd(): string {
  const lines: string[] = [
    'extends RefCounted',
    '# No-op testing runtime shim for Godot 4 release builds (studio/testing tools stripped).',
    '',
    'func __init_module() -> void:',
    '\tpass'
  ]
  for (const [name, spec] of Object.entries(TESTING_RUNTIME_NOOPS)) {
    const params = Array.from({ length: spec.arity }, (_, idx) => `_a${idx} = null`).join(', ')
    const { ret, body } = GD_NOOP_RETURN[spec.kind]
    lines.push('', `func ${name}(${params}) -> ${ret}:`, `\t${body}`)
  }
  return lines.join('\n') + '\n'
}
