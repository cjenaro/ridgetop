---
name: ridgetop-low-poly-art
description: >-
  Craft rules, shape language, palette/material separation, rigging animation arcs, and
  automated audit constraints for authoring top-grade indie low-poly 3D assets in Ridgetop.
---

# Ridgetop Low-Poly 3D Art Craft

Use this skill whenever authoring `.art.json` recipes or `createArtBuilder` scripts for Ridgetop. Every asset must read instantly at native game size (32–64 px) *and* hold up cleanly from all 8 angles in live 3D.

> **Category Craft Guides (READ THE MATCHING GUIDE BEFORE AUTHORING!):**
> - **Characters / Critters / Bosses:** Read [references/character.md](./references/character.md)
> - **Tokens / Inventory Pickups / Hero Props:** Read [references/token-prop.md](./references/token-prop.md)
> - **Environments / Cottages / Architecture / Scenery:** Read [references/environment.md](./references/environment.md)

## 1. Framework Primitives & Capabilities (Use These!)

Import `createArtBuilder`, `modelFromArtRecipe`, `auditArtModel`, and `bakeAnimatedSpritePixels` from `ridgetop`.

- **Built-in shapes (`artShapes` + seamless `tube`):**
  - Architectural & hard-surface: `box`, `prism` (chamfered), `wedge` (sloped ramp/awning/eaves/snout), `gable` (true symmetric pitched roof/gable prism with ridge along Z — NEVER rotate a box 45° for a gable!), `cylinder`, `cone`, `arch`, `ring`.
  - Organic & expressive: `oval`, `dome`, `bowl`, `taper`, `teardrop` (pointed ears, flames, leaves, spires), `octahedron`, and **`art.tube(id, points, radii, tone, { sides, style })`** (one continuous smooth swept low-poly mesh with tapered radii — ZERO bend seams! Ideal for fox tails, arched lantern handles, bowed cage ribs, branches, and scarves!).
- **Automatic Crevice Depth (`art.bakeCreviceShade()`):**
  - Call `art.bakeCreviceShade(0.10–0.12)` right before `art.finish()` to softly darken non-glowing parts tucked beneath overhanging roofs, eaves, hat brims, scarves, and caps across all 3 backends + Godot!
- **3D Animation Skeletons & Clip Presets (`art.applyClipPreset`):**
  - Bind moving parts to standard joints (`root`, `body`, `head`, `left-arm`, `right-arm`, `left-leg`, `right-leg`, `tail`, `mailbag`, `cape`) and call `art.applyClipPreset('idle', 'biped-idle')`, `art.applyClipPreset('walk', 'biped-walk')`, `art.applyClipPreset('run', 'biped-run')`, `art.applyClipPreset('jump', 'biped-jump')`, or `art.applyClipPreset('celebrate', 'biped-celebrate')` for expressive grounded clips out of the box!
- **Curved multi-segment forms (`art.curve`):**
  - Use `art.curve(id, points, widths, tone, { shape, tipTone, style })` for arched tails, bowed iron lantern cage ribs, curved branches, scarves, and bent necks. Default `overlap: 0` keeps bend joints flush and smooth with zero protruding spikes!
- **Shape Triangle Budgets & Local Axes (Quick Reference):**
  - Cheap crisp solids: `box` (12 tris), `wedge` (8 tris — sloped ramp down toward `+Z`), `gable` (8 tris — pitched roof ridge along `Z`), `octahedron` (8 tris), `cone` (21 tris), `prism` (28 tris), `cylinder` (28 tris), `taper` (32 tris).
  - Higher-poly organic solids (use sparingly on hero silhouettes, NEVER inside dense multi-segment curves!): `teardrop` (96 tris), `dome` (100 tris), `oval` (120 tris).
  - **Euler order is `roll -> pitch -> yaw`** (`rotation: [pitch, yaw, roll]`). If you yaw a `wedge` by `±Math.PI/2` to face left/right (e.g., roof eaves), tilt its slope with `pitch` (not `roll`)!
- **Material & Color Separation:**
  - Keep the 8 inheritable base tones (`ground`, `leaf`, `wood`, `stone`, `ink`, `accent`, `light`, `glow`) for theme cohesion, AND use **`art.palette(role, hex)`** for key hero material accents (e.g. `brass`, `glass`, `fur`, `slate`, `ember`). Keep main fur/wood/roof midtones **luminous & cozy** (avoid overly dark muddy bases that disappear against dark backdrops; use bright trim collars/cuffs/plinths to frame dark lower parts!).
  - Use per-part **`shade`** (`-0.35` to `+0.35`) to cleanly separate touching layers of the same material (e.g., roof ridge vs roof slope, porch posts vs timber wall, inner ear vs outer ear, darker boots vs fur!).
  - Use **`alpha` + `blend: 'alpha'`** for translucent glass chambers, water, and window panes — layer an opaque `unlit: 0.95` glowing ember core *inside* a closed `alpha: 0.30, blend: 'alpha'` outer glass cylinder/dome (`auditArtModel` automatically verifies inner visibility through translucent glass!).
  - Pass style options directly on `solid`, `attach`, `between`, `handle`, `disc`, `curve`, and `adjust`: `{ unlit, alpha, blend, shade, joint }`.

## 2. Indie Low-Poly Craft Rules

1. **Silhouette & Negative Space First:**
   - Exaggerate the 2–3 iconic features so the black silhouette alone identifies the object (e.g., fox's big pointed ears + sweeping arched tail; lantern's tall open arched handle + bowed cage ribs; cottage's wide overhanging eaves + pitched gable + crooked chimney + porch overhang).
   - Protect **negative space**: leave clear daylight inside handles, between cage ribs, between character arms/legs and torso, and under overhanging eaves/awnings.
2. **Faceted Economy (Clean Low-Poly, Not Bloat):**
   - Target **15–36 named parts** and **<= 1,350 triangles** per asset. Prefer crisp `prism`, `wedge`, `gable`, `taper`, and `teardrop` shapes over stacking dozens of tiny overlapping spheres.
   - Break flat boxes with **architectural trim**: stone plinths, corner timber posts, overhanging roof fascia/eaves (pair a recessed `gable` attic wall with overhanging pitched `box` roof slopes + flared `wedge` eaves so front/back gable walls and attic windows remain crisp and recessed!), recessed window frames, and collars/belts/cuffs on characters.
   - Remember that the 8-direction sprite baker views from a **30° downward elevation**, so tiny trim collars tucked deep under wide overhangs/caps can be occluded — seat decorative rims outward enough to catch light cleanly.
3. **3-Value Hierarchy & Focal Pop:**
   - Anchor the bottom with darker grounded tones (`ink`, darkened `stone`, or `shade: -0.25`).
   - Reserve highest brightness + `unlit: 0.85–0.98` for **one focal point** (lantern ember core, cottage porthole window, character eyes/badge).
   - Never let dark lower parts blend into dark backgrounds: add a contrasting trim band (cuff, collar, brass rim, stone plinth) to break up dark masses.
4. **Expressive Rigged Animation (Readable at 48 px!):**
   - Bind every moving part cleanly via `joint(id, parent, pivot)` + `bind(part, joint)` (or pass `{ joint }` directly on `solid`/`between`/`curve`).
   - **Exaggerate motion for indie scale:**
     - `walk`: strong leg stride (`±0.48` to `±0.58` rad), opposite arm swing (`±0.45` rad), crisp torso forward lean (`+0.10` rad) + side twist (`±0.10` rad) + double-frequency bounce, counter-stabilized head, AND lively secondary motion on tail (`±0.32` rad wag + lift) and props/satchel (`±0.18` rad swing).
     - `idle`: clear breathing chest rise + gentle head glance + subtle tail sway.
   - **Always pass `{ autoGround: true }`** to `art.clip(name, def, { autoGround: true })` so `finish()` keeps the lowest vertex grounded at `y = 0` on every keyframe (zero floating/sinking feet!).

## 3. Mandatory Verification Gate

Before accepting any generated `.art.json`:
1. Validate with `modelFromArtRecipe(recipe)` (and `rigFromArtRecipe(recipe)` if rigged).
2. Run `auditArtModel(model, { palette, frameSize })` and **fix ALL warnings**:
   - `hiddenParts.length === 0`
   - `detachedParts.length === 0` (every part firmly seated/connected)
   - `edgeTouches === 0` across all 8 views
   - `triangles <= 1500`
   - `lumRange >= 90`
3. If rigged, bake a 4-frame `walk` preview via `bakeAnimatedSpritePixels` and confirm `footDriftPx <= 2` and strong readable frame-to-frame motion.
