# Low-Poly 3D Character Craft Guide

Use this guide when authoring playable heroes, NPCs, companions, critters, or bosses.

## 1. Stylized Indie Proportions & Readability
- **Chunky readable hero proportions:** Head should be ~30–36% of total height (big enough that eyes, ears, snout, hat, or visor read unmistakably at 48 px!).
- **Tri-band value anchoring:**
  - **Bottom (boots/feet):** Deep grounded tone (`ink` or dark slate) topped with a **contrasting light ankle cuff/trim** so feet never dissolve into dark floors.
  - **Mid (torso/coat/scarf/satchel):** Luminous midtone body color broken up by a **high-contrast neck scarf/collar**, belt/buckle, and an **asymmetric side prop** (courier satchel with peeking letter, lantern, quiver) for instant silhouette recognition from all 8 angles.
  - **Top (head/ears/eyes):** Expressive tapered snout or face plate, **small `unlit: 0.95` eye catchlights** (keeps eyes alive even in shadow!), and oversized pointed ears/crests/hats.

## 2. Seamless Organic Forms (`art.tube`)
- **Use `art.tube(id, points, radii, tone, { sides: 7, style })`** for tails, scarves, bent necks, horns, and tentacles!
  - Unlike segmented `curve()` cylinders, `art.tube()` creates **one seamless continuous mesh** with smooth tapered `radii` (e.g. `[0.09, 0.16, 0.21, 0.18, 0.05]`) and zero bend notches — and uses fewer triangles!
  - For a two-tone pale-tipped tail (like a fox), either seat a smooth `teardrop` tip seamlessly over the last tube segment OR split into base + tip tubes sharing the exact handoff point and radius!

## 3. Articulated Skeleton & Expressive Animation Clips
- Always build a clean joint hierarchy (`root` → `body` → `head`, `left-arm`, `right-arm`, `tail`, `mailbag`/`cape`; `root` → `left-leg`, `right-leg`) and pass `{ joint }` directly when placing parts.
- **Use `art.applyClipPreset(...)`** as your expressive baseline (or customize on top of it):
  - `art.applyClipPreset('idle', 'biped-idle')`
  - `art.applyClipPreset('walk', 'biped-walk', { stride: 0.54 })`
  - Optional bonus clips: `art.applyClipPreset('run', 'biped-run')`, `art.applyClipPreset('jump', 'biped-jump')`, `art.applyClipPreset('celebrate', 'biped-celebrate')`
- **Every grounded locomotion clip MUST keep `footDriftPx <= 2`** (`{ autoGround: true }`) and produce **>= 350 px** frame-to-frame motion delta on 64px walk strips so movement pops with real indie charm!
- Finish with `art.bakeCreviceShade(0.10)` to add subtle contact darkening under scarves, hat brims, and collars.
