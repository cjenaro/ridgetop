# Ridgetop Bug & Performance Patterns

Distilled, repeatable failure modes and verification traps learned from prior bug hunts.
Keep entries concise and pattern-oriented (merge/prune on each run; do not turn this into a chronological changelog).

## 1. Game Framework

- **Backend parity & resource leaks**: WebGPU (`mesh-gpu.ts`), WebGL 2 (`mesh-gl.ts`), and Canvas 2D (`mesh-canvas.ts`) must agree on winding, depth, transforms, colors, and lights. Check `releaseMesh()` destroys *both* vertex buffers and associated instance buffers, and enforce `device.limits.maxBufferSize`.
- **Hot-loop allocations**: Avoid per-vertex / per-instance temporary arrays, `subarray()` allocations, rest spreads (`Math.hypot(...q)`), repeated CSS `rgba(...)` string formatting, or `structuredClone()` of already-cloned payloads inside render/simulation loops.
- **IEEE-754 boundary epsilons**: Fixed-step platformer landing/pad overlap checks need a tiny epsilon (`1e-9`) so `y + vy * dt` ULP drift does not bounce players off flat surfaces on the next tick.
- **Re-entrant lifecycle & state machines**: Update state (`current = next`) *before* invoking transition `action()` callbacks so re-entrant transitions aren't overwritten; guard `fixedLoop` rAF callbacks and Canvas UI timers against `stop()` / `dispose()` called mid-callback.
- **Canvas UI & Input edge cases**:
  - `navigator.getGamepads()` returns a `GamepadList` (not a plain `Array`—never assume `.filter` exists directly).
  - Always guard `setPointerCapture` in `try/catch`; track `onHold` release even if the button hides while held; block hit-testing beneath modal scrims; skip keyboard shortcuts when modifiers (`Ctrl`/`Meta`/`Alt`) are held or form inputs are focused; avoid idle `getBoundingClientRect()` DOM reflows when no gamepad is active.
- **Server, networking & multi-runtime**:
  - Never assume Node-only globals (`Buffer`) in runtime-agnostic modules like `decision-api.ts`—use `TextEncoder`.
  - Check raw UTF-8 byte length (accumulate `Buffer[]`), not JS string `.length`, when enforcing HTTP body limits; run room tick intervals lazily only while `rooms.size > 0`.
  - Always rebase monotonic client counters (`jumpOffset`) when reconnecting with a new player ID; use PID+UUID temp filenames for atomic file writes; `HEAD` responses must still emit `Content-Length`.

## 2. Asset Building

- **Binary & rasterization hot paths**: Use `zlib.crc32` (with 256-entry table fallback) and single-allocation chunk assembly in `png.ts`; avoid `Math.min(...xs)` spread stack overflows on large polygons in `sprite-sheet.ts`; use packed `Uint32Array` fills and precomputed edge scanlines.
- **Recipe & review store validation**: Reject JSON `null`/sparse arrays in numeric fields (`Number.isFinite`, not `typeof` alone or `null` coercion); handle non-object JSON payloads and corrupted `overrides.json` with HTTP 400 (never unhandled 500); compare `Content-Type` case-insensitively; recognize `[::1]` as loopback; never block read-only GETs behind the write mutex.
- **Headless picking & offline HTML**: Keep `pickArtScene` headless (frustum + `[0, 1]` bounds, no DOM readback); disambiguate duplicate part names in `spritePartVisibility`; escape `</style` in inline offline bundles (`standalone-page.ts`) and assert template injection markers exist.

## 3. Example Games

- **Per-frame UI churn & stale transitions**: Compare state keys before re-syncing UI primitives (e.g., Beacon Run `character` key, `lastFinished` edge transitions) so 60 FPS loops don't rebuild menus or freeze Finish dialogs after "Play again".
- **Racing simulation & scene lifecycle**:
  - Checkpoints need a shoulder margin (`width * 0.85`), exact `toGate === 0` wrap checks, and non-negative modulo in `standings()` for lap ≥ 3.
  - Guard weapon queueing (`pulse`/`snare`) during countdown; in `racing/scene.ts:dispose()`, only `releaseMesh()` circuit-owned procedural meshes—never shared/garage meshes.
- **Starter Canvas UI + Testing Mode coexistence**:
  - Disable Canvas UI keyboard handling and `#ui` pointer-events while `testingPaused` is active so Testing Mode form inputs and board clicks aren't hijacked.
  - Serialize async `setViewMode()` switches to prevent leaking duplicate `LowPolyRenderer` instances.
  - Keep Testing Mode styles in an external CSP-safe stylesheet (`starter/testing.css`), registered in `serve.ts`, `create-game.ts`, and `packager.ts` `blockedStudioFiles`.
  - Pass an explicit `hudRect()` callback for Canvas-painted HUD icons (offscreen canvases have `0x0` `getBoundingClientRect()`).

## 4. Compiler to Godot & Packager

- **TS → GDScript 4 compiler (`tools/ts-to-gd.ts`)**:
  - Short-circuit `&&`/`||`/`??` must hoist into a single-evaluation temp variable—naïve ternary emission causes both double-evaluation bugs and $O(2^N)$ code blowup.
  - Lower first-class built-in callbacks in `PropertyAccessExpression` & `Identifier` (`Number.isFinite`, `Number.isInteger`, `Number.isSafeInteger`, `Number.isNaN`, `Array.isArray`, `Boolean`, `Number`, `String` → `Callable(RT, ...)`).
  - Support TypedArray `.set()`/`.subarray()` and `Array.flatMap()`; never coerce non-numeric keys via `int(key)` in `RT.get_prop` on `Array` (`int("set") == 0` silently returns element 0!).
  - Keep strict `Number.isInteger`/`isFinite`/`isNaN` non-coercion, `RT.eq` reference identity (`is_same`), `Math.round(-0.5)` semantics, `export *` barrel resolution, grouped `switch` fallthrough, two-pass closure boxing, and avoid `:=` type inference from `Variant` returns in Godot 4.7+.
- **Godot exporter (`framework/export-godot.ts`)**:
  - Compute glTF `accessor.min`/`max` from the actual `Float32Array` values (Float64 vs Float32 rounding causes `ACCESSOR_MIN/MAX_MISMATCH`); attenuate `baseColorFactor` by `(1 - unlit)` to prevent double-lighting emissive geometry.
  - Match Web Signal Drift steering sign (`Input.get_axis("move_left", "move_right")`) and speed-scaled car roll (`-steer * minf(0.19, speed * 0.011)`); pool FX `MeshInstance3D` nodes and memoize HUD rebuild keys.
- **Packager & scaffold (`framework/packager.ts`, `tools/create-game.ts`, `package.json`)**:
  - Use a comment/string/template-aware ES module scanner (never a cross-statement regex) for both static import tracing and multi-line barrel pruning; re-prune barrels when Pass 2 discovers transitive barrel imports.
  - Guard bundle output paths against traversal; rewrite `../framework/` imports proportionally to subdirectory depth and skip unused `.js` files in `copyDirFiltered`.
  - Scope Capacitor `clear()` strictly to `ridgetop.native.*` keys and guard async `Preferences` hydration against pre-hydration writes/removes.
  - Keep Electron `sandbox: true`, check `!win.isDestroyed()` in `second-instance`, unpack `steam_appid.txt`, use `fileURLToPath`, and exclude `!dist/packages` in `package.json` `"files"`.

## Verification Environment Gotchas

- **Godot 4 silent script errors**: `godot --headless --path <dir> --quit-after 5` often exits with **code `0`** even when GDScript parse or runtime errors occur! Always assert `stderr.trim() === ''` (handled by `scripts/godot-smoke.mjs`).
- **Headless Chrome WebGPU on Linux**: Plain `--enable-features=Vulkan` causes `SharedImageStub: Unable to create shared image` and WebGPU device loss fallback to WebGL 2. Always launch headless Chrome with:
  `--enable-unsafe-webgpu --enable-unsafe-swiftshader --use-gl=angle --use-angle=vulkan --use-vulkan=swiftshader --enable-features=Vulkan`.
- **Node 24 native TypeScript**: Run `.ts` files directly with `node` (never `npx tsx`, which prompts to install packages).
