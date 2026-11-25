# Pixel-Art 2D Character & Boss Craft Guide

Use this guide whenever authoring animated 2D heroes, NPCs, companions, enemies, or bosses.

## 1. Use Ridgetop's 2D Pixel Animation Skeleton (`createPixelRig`)!
Import `createPixelRig`, `renderPixelRig`, and `pixelClips` from `ridgetop`.
- **Why skeletons beat redrawing whole frames:** Splitting a character into modular pixel-cluster parts (`torso`, `head`, `crest`, `cape`, `frontArm`, `shield`, `frontLeg`, `backLeg` — or for bosses: `torso`, `leftArm`, `rightArm`, `head`, `moss`, `rune`) guarantees **100% consistent character volume**, eliminates melting limbs, and lets you generate silky 4- or 6-frame animations cleanly!
- **Unified Exterior Outline:** Render all bare color parts first via `renderPixelRig(frame, rig, root, pose, palette, { outline: 'selout', postDraw })` so Ridgetop draws ONE seamless palette-locked selective outline around the combined silhouette (zero ugly black seams between torso and arm!) and then runs `postDraw` for crisp glowing eyes, sparkles, or rune flares!
- **Use `variants` for Secondary Cloth/Foliage Motion:** Attach 2–4 compact stamp variants (`f0`..`f3`) to flowing parts (`cape`, `crest`, `moss`, `rune`) so cloth ripples in an S-curve wave and sprouts stretch/drag while rigid armor/helmet parts stay rock-solid!

## 2. Character Silhouette & Proportions
- **Heroes (24×24–32×32):** Expressive oversized head (~40–45% of height), recessed dark visor/face with high-contrast glowing eyes, flowing downward S-curve cloak (NEVER a stiff horizontal carrot!), and distinct swinging front prop/shield.
- **Heavy Creatures / Bosses (36×36–48×48):** Carve **transparent negative-space armpit gaps** between heavy arms and a tapered waist (`fillRatio <= 0.55` — NEVER a solid rectangular brick!), give asymmetric hunched shoulders, angular lit top-left stone/armor bevel facets + dark cracks, and lush overhanging details (moss brows, vines, horns).

## 3. Grounded Living Motion (`maxFootDriftPx: 1`)
- **Run Cycles (`pixelClips.bipedRun`):** Clear *contact → squash/down → passing → stretch/up* arcs with wide asymmetric leg strides, opposite shield/arm counter-swing, and grounded feet (`footDriftPx <= 1`).
- **Heavy Idles (`pixelClips.heavyBreathe`):** Grounded boulder fists and feet **STAY 100% PLANTED (`footDriftPx === 0`)** while ONLY the torso, hunched shoulders, head, hanging moss, and glowing runes heave and flare!
- Validate with `auditSpriteSheet(sheet, { maxColors: 14, maxFillRatio: 0.56, maxFootDriftPx: 1 })`.
