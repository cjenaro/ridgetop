# Ridgetop Bug & Performance Patterns

Distilled, repeatable failure modes and verification traps learned from prior bug hunts.
Keep entries concise and pattern-oriented (merge/prune on each run; do not turn this into a chronological changelog).

## 1. Game Framework

- **Backend parity & resource leaks**: WebGPU (`mesh-gpu.ts`), WebGL 2 (`mesh-gl.ts`), and Canvas 2D (`mesh-canvas.ts`) must agree on winding, depth, transforms, colors, and lights. Check `releaseMesh()` destroys *both* vertex buffers and associated instance buffers, enforce `device.limits.maxBufferSize`, and guard `createRenderer` `end()`/`dispose()` plus opaque Canvas 2D clear.
- **Hot-loop allocations**: Avoid per-vertex / per-instance temporary arrays, `subarray()` allocations, rest spreads (`Math.hypot(...q)`), repeated CSS `rgba(...)` string formatting, idle `getGamepads()` array allocations, or `structuredClone()` of already-cloned payloads inside render/simulation loops.
- **IEEE-754 boundary epsilons**: Fixed-step platformer landing/pad overlap checks need a tiny epsilon (`1e-9`) so `y + vy * dt` ULP drift does not bounce players off flat surfaces on the next tick.
- **Re-entrant lifecycle & state machines**: Update state (`current = next`) *before* invoking transition `action()` callbacks and guard `exit()` with an active-exiting `Set` so re-entrant `send()` calls neither recurse infinitely nor get clobbered; update gamepad edge flags (`padDown`/`padPauseDown`/`confirmDown`/`backDown`) *before* firing callbacks; guard `fixedLoop`, `bindMenuGamepad`, and Canvas UI rAF timers against `stop()`/`dispose()` called mid-callback.
- **Canvas UI & Input edge cases**:
  - `navigator.getGamepads()` returns a `GamepadList` (not a plain `Array`—never assume `.filter` exists directly).
  - Always guard `setPointerCapture` in `try/catch`; scope `interactiveHits()` above the topmost visible modal scrim so keyboard/gamepad/programmatic focus cannot pierce modals; track slider drags per-pointer (capturing `dragEnd` directly so unmounting/multi-touch never strands `'dragging'`); release multi-touch `onHold` only when the last pointer on that button lifts; check `disabled` *before* dispatching primitive `act()` so one-shot callbacks that self-disable still return `true`; skip disabled `<option>`s in `bindMenuGamepad`; reset `canvas.style.cursor` on `dispose()` and guard `iconSize > 0`.
- **Server, networking & multi-runtime**:
  - Never assume Node-only globals (`Buffer`, unimported `process`) in runtime-agnostic or strict-ESM modules—use `TextEncoder` and explicit `node:process` imports; guard error `.code` with optional chaining.
  - Check raw UTF-8 byte length (accumulate `Buffer[]`), not JS string `.length`, when enforcing HTTP body limits; run room tick intervals lazily only while `rooms.size > 0`; delay inserting empty rooms into `rooms` until a member is created; check `res.destroyed || res.writableEnded` on SSE `join()` and broadcast to prevent ghost members/timers.
  - Always rebase monotonic client counters (`jumpOffset`) when reconnecting with a new player ID, initialize `sentAt = -Infinity`, guard SSE callbacks against `closed`, require `interval > 0` for interpolation, use PID+UUID temp filenames for atomic writes, and emit `Content-Length` on `HEAD`.

## 2. Asset Building

- **Binary & rasterization hot paths**: Use `zlib.crc32` (with 256-entry table fallback) and single-allocation chunk assembly in `png.ts`; avoid `Math.min(...xs)` spread stack overflows on large polygons in `sprite-sheet.ts`; use packed `Uint32Array` fills and precomputed edge scanlines.
- **Recipe, builder & review store validation**: Reject JSON `null`/sparse arrays in numeric fields using indexed `for` loops (never `.every()`, which skips sparse holes) and `Number.isFinite`; handle non-object/malformed JSON payloads and corrupted `overrides.json` / review `.json` files with HTTP 400 (never 500); compare `Content-Type` case-insensitively; enforce loopback on `req.socket.remoteAddress` (`127.0.0.1`/`::1`/`::ffff:127.0.0.1`) alongside `Host`/`Origin`; never block read-only GETs behind the write mutex.
- **Headless picking, part names & offline HTML**: Keep `pickArtScene` headless (frustum + `[0, 1]` bounds, no DOM readback); disambiguate duplicate part names in `spritePartVisibility` using `Object.defineProperty` so `'__proto__'` cannot mutate prototypes or drop keys; mark `sprite-workshop` templates dirty on swatch edits so rapid template switches don't leave cached sheets stale; escape `</style` in inline offline bundles (`standalone-page.ts`) and assert template injection markers exist.

## 3. Example Games

- **Per-frame UI churn & re-entrant primitive sync**: Compare state keys before re-syncing UI primitives, and guard programmatic `selectPrimitive.setOptions()` / `togglePrimitive.set()` updates with a `syncing*` flag so `onChange` doesn't re-entrantly overwrite screen state (e.g., Beacon Run Main Menu) or double-bake/double-connect scenes and rooms.
- **Racing simulation & scene lifecycle**:
  - Checkpoints need a shoulder margin (`width * 0.85`), exact `toGate === 0` wrap checks, non-negative modulo in `standings()` for lap ≥ 3, and frozen `driver.progress` while briefly wider than `width * 0.85` so drifting wide across a checkpoint doesn't soft-lock the lap.
  - Guard weapon queueing (`pulse`/`snare`) during countdown; in `racing/scene.ts:dispose()`, only `releaseMesh()` circuit-owned procedural meshes—never shared/garage meshes.
- **Starter Canvas UI + Testing Mode coexistence**:
  - Disable Canvas UI keyboard handling and `#ui` pointer-events while `testingPaused` is active; disable underlying HUD buttons when modals open and place `Play Again` first on Victory; cache in-flight sprite atlas promises and revert `viewToggle` on `setViewMode` errors.
  - Keep Testing Mode styles in an external CSP-safe stylesheet (`starter/testing.css`), registered in `serve.ts`, `create-game.ts`, and `packager.ts` `blockedStudioFiles`; pass an explicit `hudRect()` callback for offscreen Canvas HUD icons.

## 4. Compiler to Godot & Packager

- **TS → GDScript 4 compiler (`tools/ts-to-gd.ts`)**:
  - Short-circuit `&&`/`||`/`??` and logical assignments (`&&=`/`||=`/`??=`) must hoist into a single-evaluation temp / guarded branch; `prop_len(null)`/`prop_size(null)` must return `null` (not `0`) so `?.length ?? fallback` works.
  - Bind object-literal `this` to a hoisted `_obj` dictionary; support rest params/destructuring, `Set`/`Map`/`String` spread, optional chaining on built-in methods, `delete`, `try/finally`, custom dict methods, and `export { local as alias }` / destructured exports.
  - Guard `is_safe_int` with exact `int64` / float bounds (never `absf()`, which truncates via 32-bit `real_t` at `2^53 - 1` in standard Godot 4 builds!); normalize numeric keys on plain Dictionaries and auto-resize OOB Array writes; fix `continue` inside `switch` (via outer-continue flag) and `do..while` (via first-iteration flag); include getters & recursive `const` arrows in `findBoxedVars`; write `rt.gd` only after all entries compile.
  - Keep first-class built-in callbacks (`Callable(RT, ...)`), strict `Number.isInteger`/`isFinite`/`isNaN`, `RT.eq` reference identity (`is_same`), `Math.round(-0.5)`, `export *` barrels, grouped `switch` fallthrough, and avoid `:=` from `Variant` returns in Godot 4.7+.
- **Godot exporter (`framework/export-godot.ts`)**:
  - Compute glTF `accessor.min`/`max` from the actual `Float32Array` values and assemble GLB in a single `Buffer.concat`; attenuate `baseColorFactor` by `(1 - unlit)`.
  - In generated GDScript, always check `dict.has(k)` before `dict[k]` (never `typeof(dict.get(k, [])) == TYPE_ARRAY and dict[k]`); format non-integer `.tscn` offsets without literal `.0`; escape `\r`/`\n`/`\t` in `godotEscape`; avoid `int / int` division warnings; guard `_draw_faceted` on non-positive sizes.
  - Match Web Signal Drift steering sign (`Input.get_axis("move_left", "move_right")`) and speed-scaled car roll (`-steer * minf(0.19, speed * 0.011)`); pool FX `MeshInstance3D` nodes and memoize HUD rebuild keys.
- **Packager & scaffold (`framework/packager.ts`, `tools/create-game.ts`, `package.json`)**:
  - Use a comment/string/template/**RegExp**-aware ES module scanner for static import tracing and multi-line barrel pruning; re-prune barrels on transitive barrel imports.
  - Enforce bundle root containment *before* `readFile` in `loadModule`; rewrite `../framework/` imports proportionally to depth and skip unused `.js` files; escape HTML/YAML attributes and use replacer functions in `ensureMobileMeta`.
  - Scope Capacitor `clear()` strictly to `ridgetop.native.*`, guard async `Preferences` hydration against pre-hydration writes/removes, and push late-hydrated keys into live `createBridgeStorage` via `onHydrate`.
  - Lock Electron down (`sandbox: true`, `setWindowOpenHandler` deny, `will-navigate` origin guard, `\0` URL 400 check, `!win.isDestroyed() && !win.webContents.isDestroyed()` lifecycle sends, null-prototype non-array save loading, unpacked `steam_appid.txt`, `fileURLToPath`) and exclude `!dist/packages` in `package.json` `"files"`.

## Verification Environment Gotchas

- **Godot 4 silent script errors**: `godot --headless --path <dir> --quit-after 5` often exits with **code `0`** even when GDScript parse or runtime errors occur! Always assert `stderr.trim() === ''` across **all 3 games** (`signal-drift`, `beacon-run`, `starter`) via `scripts/godot-smoke.mjs`.
- **Headless Chrome WebGPU on Linux**: Plain `--enable-features=Vulkan` causes `SharedImageStub: Unable to create shared image` and WebGPU device loss fallback to WebGL 2. Always launch headless Chrome with:
  `--enable-unsafe-webgpu --enable-unsafe-swiftshader --use-gl=angle --use-angle=vulkan --use-vulkan=swiftshader --enable-features=Vulkan`.
- **Node 24 native TypeScript**: Run `.ts` files directly with `node` (never `npx tsx`, which prompts to install packages).
