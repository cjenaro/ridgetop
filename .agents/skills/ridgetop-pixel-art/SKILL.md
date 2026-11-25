---
name: ridgetop-pixel-art
description: >-
  Craft rules, hue-shifted palette discipline, pixel-cluster stamping, selective outlines,
  silhouette negative space, expressive indie animation arcs, and automated audit gates
  for authoring top-grade pixel art in Ridgetop.
---

# Ridgetop Indie Pixel Art Craft

Use this skill whenever authoring pixel-art sprites or sprite sheets with Ridgetop's `createSpriteSheet`. Target the crisp, iconic polish of top 2D indies (*Celeste*, *Shovel Knight*, *Eastward*, *A Short Hike* icons, *Hollow Knight* readability) — never muddy polygons or noisy 1px confetti.

> **Category Craft Guides (READ THE MATCHING GUIDE BEFORE AUTHORING!):**
> - **Characters / Heroes / Creatures / Bosses:** Read [references/character.md](./references/character.md) (**uses `createPixelRig` 2D skeletons!**)
> - **Tokens / Inventory Icons / Pickups:** Read [references/token-icon.md](./references/token-icon.md)
> - **Environments / Tiles / Scenery / Props:** Read [references/environment.md](./references/environment.md)

## 1. Framework Primitives (Use These!)

Import `createSpriteSheet`, `hueShiftRamp`, `auditSpriteSheet`, `createPixelRig`, `renderPixelRig`, and `pixelClips` from `ridgetop`:

- **2D Pixel Animation Skeletons (`createPixelRig` + `renderPixelRig` + `pixelClips`):**
  - For ANY animated character or creature, build a hierarchical 2D skeleton (`joints` with `id`, `parent`, `pivot`, `z`, `stamp`, and optional per-frame `variants`) and render each frame via `renderPixelRig(frame, rig, root, pose, palette, { outline: 'selout', postDraw })`!
  - Preserves exact character volume across frames, applies one seamless palette-locked selective outline around the whole assembled silhouette, and ships with `pixelClips.bipedRun(...)` and `pixelClips.heavyBreathe(...)`!

- **Palette Ramps (`hueShiftRamp`):**
  - Generate harmonious 6-step ramps (`ink`, `dark`, `shade`, `mid`, `light`, `highlight`) where shadows shift cool (toward indigo/blue) and highlights shift warm (toward cream/gold).
  - Reuse a shared deep cool `ink` (`#141c2c`) and warm highlight across materials so the whole sprite feels lit by one unified world!
- **Pixel-Precision Drawing (`SpriteFrame`):**
  - **`frame.stamp(x, y, rows, palette)`**: YOUR PRIMARY TOOL for 16×16–48×48 indie pixel art! Author crisp, intentional pixel clusters using readable ASCII grids (`.` or `' '` = transparent; clips cleanly on animated bounces without crashing!).
  - **`frame.pixel(x, y, color)`**, **`frame.line(...)`**, **`frame.circle(...)`**, **`frame.ellipse(...)`**: clip cleanly to cell bounds, support `#rrggbbaa` translucent glow/glass pixels, and `null` to erase pixels cleanly.
  - **`frame.mirrorX()`** & **`frame.copyFrom(col, row, dx, dy)`**: clean symmetry and frame reuse.
  - **`frame.outline('selout', { palette })`** or **`frame.outline('#16202e', '4-way')`**: ALWAYS finish the exterior silhouette with an automatic outline pass instead of hand-tracing ink polygons!
    - **ALWAYS pass `{ palette }` when using `'selout'`** (e.g., `frame.outline('selout', { palette })`): snaps selective top-left lit outlines and bottom-right cool-ink outlines directly onto your existing dark palette shades — zero palette bloat (`<= 14 colors` guaranteed)! Use `'4-way'` (never blocky `'8-way'` corners on small sprites).
  - **`hueShiftRamp(baseHex)`** automatically picks perceptually natural cool shadows (rich crimson-umber for warm oranges/browns; deep teal-indigo for greens/yellows; slate-violet for blues/grays) and warm cream-gold highlights. For cool glass or magical emerald/cyan liquids, pass an explicit cool `highlightHue` (e.g., `{ highlightHue: 156 }` for emerald elixir, `{ highlightHue: 198 }` for crystal glass) to keep highlights crystalline instead of lime-shifted.
  - **Floating magic sparkles / glints:** Draw airy luminous star glints *after* `frame.outline('selout', { palette })` so sparkles stay crisp and bright without dark ink rings.

## 2. Top-Grade Pixel Art Craft Rules

1. **Strict Palette Discipline (`<= 14 colors` across the ENTIRE sheet!):**
   - `auditSpriteSheet` checks total unique colors, max `fillRatio`, min `lumRange`, and min `frameDeltaPx` across **every frame**.
   - Pick 1 primary material ramp (3–4 shades), 1 secondary accent ramp (2–3 shades), 1 focal glow/highlight (2 shades), and 1 shared deep cool ink (`#141c2c`).
2. **Iconic Silhouette, Surface Detail & Carved Negative Space:**
   - Test the sprite as a solid black silhouette: it must be 100% recognizable with zero interior detail!
   - **Carve negative space (`fillRatio` between `0.28` and `0.54`):**
     - NEVER make a chunky solid brick/toaster silhouette (`fillRatio > 0.56`)! Separate heavy creature arms from the torso with a clear 1–2px transparent armpit gap, taper the waist/legs, and give shoulders/heads distinct contour breaks.
     - **Enrich large stone/armor surfaces with crisp bevel planes & organic overhang:** on chunky creatures (like golems), break up broad stone chests and shoulders with angular lit upper-left bevel facets, dark recessed cracks, lush overhanging mossy brows/drapes with varied tendril lengths, and warm bounce light around glowing runes!
     - **Flowing cloth/capes:** A cape drapes *downward* and trails in an **S-curve wave** behind the body — NEVER a stiff horizontal carrot sticking straight backward!
     - **Glass flasks/icons:** Give a crisp narrow neck with a flared lip, bold angular/faceted crystal shoulders, dark refractive glass rim around the liquid, bright upper-left specular arc, and a flat grounded base.
3. **Big-Medium-Small Clusters (Zero Pillow Shading, Zero Noise):**
   - Light comes consistently from **top-left**. Place the brightest cluster near the upper-left third, a clean midtone body, a crescent shadow on the lower-right, and an occasional subtle cool bounce light on the far bottom edge.
   - **No pillow shading** (never ring the whole edge with dark and put a bullseye bright dot in the center).
   - **No orphan 1px confetti** (except intentional crisp 1px eye glints or floating magic sparkles attached to a 3px cross glint).
   - **Glass & Liquid craft:** Show a thin bright liquid **meniscus** line across the surface, darker saturated liquid at the bottom-right, a crisp curved white/ice-blue specular highlight along the upper-left glass wall, and translucent/dark interior air above the liquid.
4. **Alive Indie Animation (Never "Elevator Bounce"!):**
   - **4-frame Run Cycle (`contact → down → passing → up`):**
     - Frame 0 (Contact): wide asymmetric leg stride (front foot forward, back foot kicked back), arms/shield swung opposite, cape streaming mid-wave.
     - Frame 1 (Down/Squash): body drops 1px, knees bend under torso, sprout/crest bends back with drag, cape dips.
     - Frame 2 (Passing/Opposite Contact): opposite wide leg stride, front shield shifts 1–2px forward/back, cape crest ripples.
     - Frame 3 (Up/Stretch): body lifts 1px with airborne/toe-push stride, sprout bounces tall, cape whips upward.
     - Keep grounded lowest boot pixel steady (`footDriftPx <= 1`).
   - **2-frame Heavy Creature Idle (NO rigid whole-sprite shift!):**
     - Heavy fists and feet **STAY PLANTED** on the ground (`footDriftPx === 0`)!
     - On inhale (Frame 1): ONLY the upper chest, hunched shoulders, head/moss canopy lift 1–2px, hanging moss tendrils sway 1px, and glowing rune eyes/chest rune flare brighter!
   - **4-frame Pickup/Potion Shimmer:**
     - Animate a rising bubble inside the liquid, subtle 1px meniscus slosh, AND a crisp diagonal white sheen/glint sweeping cleanly across the glass facets (never colliding harshly with the outer edge).

## 3. Mandatory Verification Gate

Every generator module MUST run `auditSpriteSheet(sheet, { maxColors: 14, maxFillRatio: 0.56 })` during self-check and achieve **zero warnings**:
- `uniqueColors <= 14` (tight, cohesive hue-shifted palette)
- `orphans === 0`
- `edgeTouches === 0` (at least 1px transparent border around every frame)
- `fillRatio <= 0.56` (clear negative space in silhouette)
- `lumRange >= 110` (crisp figure/value pop)
- `footDriftPx <= 1` on grounded characters/creatures
- Strong, readable `frameDeltaPx` between frames (real animation, not 1px flicker or rigid brick shift)
