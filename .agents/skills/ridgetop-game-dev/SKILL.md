---
name: ridgetop-game-dev
description: >-
  Guide and architectural checklist for building a new 2D or low-poly 3D game on the Ridgetop
  framework. Use whenever creating a new Ridgetop example game, prototyping gameplay on Ridgetop,
  authoring animated 3D rigs/assets/particles, wiring Canvas UI + HUD + audio, or verifying
  cross-backend (WebGPU, WebGL 2, Canvas 2D) and Godot compilation compatibility.
---

# Building a Game with Ridgetop

Follow this workflow whenever creating or upgrading a game on Ridgetop so the game stays
dependency-free, looks handcrafted, animates smoothly, and runs identically across WebGPU,
WebGL 2, Canvas 2D, and Godot exports.

## 1. Module Architecture & Public Boundary

Partition every game cleanly into DOM-free logic vs. browser presentation:

- `<game>/types.ts` — Data types, tuning constants, terrain/map queries, save schema.
- `<game>/simulation.ts` — **Pure, deterministic, DOM-free fixed-step (`STEP = 1/60`) rules.** Use Ridgetop's `nextRandom(seed)` / `createRng(seed)` (never `Math.random()` or `Date.now()` inside `step`), emit deterministic `sounds` and `vfx` event arrays per tick so it works with `verifyTrace`, `verifyBounded`, authoritative rooms, and `pnpm ridgetop compile-godot`.
- `<game>/art.ts` — Custom low-poly meshes (`mesh`, `revolvedMesh`, `archMesh`, `chamferedPrism`, `cylinder`, `octahedron`), articulated `createRig(...)` skeletons, `AnimationClip` tables, and static landmark builders.
- `<game>/scene.ts` — `createLowPolyRenderer` orchestration with strict **static vs. dynamic batch separation** (`staticBatches` built once; animated rigs and `createParticles()` emitted into a `createMeshPool()` cleared each frame). Use `blend: 'alpha' | 'additive'` for translucent water, volumetric light beams, fading smoke, and halos.
- `<game>/audio.ts` — Use `createSynthAudio` for simple motifs or `createSoundscape` (multi-bus `music`/`sfx`/`ambience`, looping filtered noise beds, noise bursts, and live music filter sweeps) for adaptive soundtracks and weather ambience.
- `<game>/main.ts` — `createGamePage`, `fixedLoop`, `bindActionControls`, `bindVirtualStick`, `worldToScreen`, `createHud`, `createCanvasUi` (including `bar` gauges and 2D arrow-key focus), save persistence, and `page.lifecycle(...)` cleanup.

**Public Import Rule:** Game modules must ONLY import from their own folder and Ridgetop's public entry points (`../framework/index.ts`, `../framework/ui.ts`, or `../framework/ui-*.ts`). Never import internal backend/shader files or external npm packages.

## 2. Low-Poly Art & 3D Animation Craft

Do not settle for stiff single-box characters or frozen scenery:

1. **Inspect `starter/art/library/preview.png` first** to match Ridgetop's silhouette & proportion bar (layered trims, flared coats, arched handles, tapered roofs, sculpted hulls/buoys).
2. **Use `framework/animation.ts` for anything that moves:**
   - Build characters, NPCs, wildlife, vehicles, cranes, and wind-swaying trees as hierarchical **`createRig(joints)`** skeletons so child joints (arms, hanging lanterns, wings, backpacks, tree crowns, flags) inherit parent motion automatically.
   - Drive characters with **`createAnimator(clips, 'idle')`** and cross-fade between `idle`, `run`, `carryRun`, `wade`, `celebrate`, etc., layering procedural offsets (squash-and-stretch hops, wind lean, look-at) via `animator.evaluate(additive)`.
   - Use **`createParticles()`** for tactile juice: parabolic `arc(...)` flying pickups/drop-offs/coins, chimney smoke, campfire embers, water splashes, wakes, and upgrade bursts.
3. **Dynamic Atmosphere & Blending:** Use **`renderer.setLighting({ direction, ambient, color, fogColor, fogNear, fogFar, points })`** for dynamic sun tint, distance fog, and up to 4 point lights without re-uploading static batches, and `blend: 'alpha' | 'additive'` with `color[3]` opacity for volumetric beams, water, and halos.
4. **Mesh & Cross-Backend Guardrails:**
   - Every custom `mesh(positions, indices)` MUST use **counterclockwise (CCW) outward-facing winding** (`cullMode: 'back'` hides flipped faces completely!).
   - Always pass **`canvasDepth: true`** to `createLowPolyRenderer` whenever large flat planes (ocean, roads, ground rings) intersect sloped terrain so Canvas 2D matches GPU Z-buffering pixel-for-pixel.
   - `createArtBuilder().solid(...)`, `attach(...)`, and `adjust(...)` all accept `unlit` (`0–1`) for glowing lanterns and crystals.

## 3. Canvas UI, HUD & Input Patterns

- Stack three canvases inside `<main class="game-viewport">` using `/game-ui.css`:
  1. `<canvas class="playfield">` (3D WebGPU/WebGL 2/Canvas 2D scene)
  2. `<canvas class="game-layer">` (`createHud` for custom gauges/bars, world-projected labels, floating popups, drag-stick overlay)
  3. `<canvas class="ui-layer">` (`createCanvasUi` + opt-in `buttonPrimitive`/`togglePrimitive`/etc. for menus, shops, and HUD action buttons)
- Stick to **ASCII-safe labels** in Canvas UI buttons (avoid exotic Unicode symbols like `♪` or `★` that render inconsistently across Linux/console fonts).
- If adding pointer/touch drag steering on the viewport, check `if (ui.hitTest(x, y)) return` before capturing the drag so UI clicks always win.
- Expose `globalThis.__ridgetopUi` (`snapshot`, `query`, `act`, `rects`, `state`) so headless browser tests and agents can drive every screen reliably.

## 4. Registering an In-Repo Example Game

When adding an example game directly inside the Ridgetop repository (not via `pnpm ridgetop create`), update all of:
1. `<game>.html` & `<game>/*.ts` (and `body.<game>-page` in `game-ui.css`)
2. `tsconfig.build.json` (`include`)
3. `server.ts` (add every compiled `<game>/*.js` and `<game>.html` to `files`, plus route in `aliases`)
4. `package.json` (`files` array for `npm pack`)
5. `test/architecture.test.ts` (include `<game>/` in public-boundary checks)
6. `test/<game>.test.ts` (deterministic simulation + `verifyTrace` invariant checks — note checks use `{ id, test }` and return `{ status: 'pass' }`)

*(If you also add a new browser module inside `framework/`, remember to list it in `browserModules` in `framework/host.ts`!)*

## 5. Mandatory Verification & Visual Inspection

Never call a game finished on unit tests alone:
1. Run `pnpm rt check && pnpm rt smoke runtimes`.
2. Test `pnpm ridgetop compile-godot <tmp-dir> <game>/simulation.ts` to ensure game logic compiles cleanly to GDScript 4.
3. Launch the built server + headless Chrome and verify **zero console/page errors** across `?renderer=webgpu`, `?renderer=webgl2`, and `?canvas=1`.
4. **Capture and visually inspect PNG screenshots** of title, active gameplay, modals, and Canvas 2D fallback to catch flipped normals, clipped rings, hidden NPCs, broken glyphs, or painter's-sort mismatches before handing off.
