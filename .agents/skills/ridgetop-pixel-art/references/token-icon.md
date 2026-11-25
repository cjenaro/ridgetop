# Pixel-Art 2D Token, Icon & Pickup Craft Guide

Use this guide whenever authoring 16×16–32×32 RPG inventory icons, potions, relics, coins, keys, gems, or UI tokens.

## 1. Bold Iconic Silhouette (Readable on Dark & Light Slots)
- Fill **36%–50%** of the cell with a crisp, unmistakable silhouette (e.g., pinched neck + flared lip + angular crystal shoulders + flat grounded base for flasks).
- Always leave **>= 1px transparent margin** around every frame (`edgeTouches === 0`) so icons breathe cleanly inside HUD slots.

## 2. Jewel-Grade Material & Glass Rendering
- **Cool highlights for glass & magic:** Pass explicit cool `highlightHue` to `hueShiftRamp` (e.g. `{ highlightHue: 156 }` for emerald elixir, `{ highlightHue: 198 }` for crystal glass) so highlights look crystalline instead of lime-shifted!
- **Glass Flask Formula:**
  1. Dark hollow upper air chamber + crisp 1px **dark refractive rim** hugging the inside of the glass wall.
  2. Bright luminous **liquid meniscus** line across the fluid surface + saturated midtone body + cool deep bottom-right shadow.
  3. Crisp curved **upper-left white/ice-blue specular arc** (2–4 connected pixels, never noisy dots!).
  4. Warm contrasting focal accent (crimson wax neck ribbon + cork stopper) to create rich complementary color pop against cool teal/emerald liquid.

## 3. Crisp Rhythmic Shimmer Animation
- Pair **3 subtle synchronized beats** across 4 frames:
  1. 1px liquid meniscus slosh + rising 2×2 bubble inside the fluid.
  2. Diagonal bright sheen sweeping cleanly across the glass facet.
  3. **Airy floating 3×3 star glints drawn AFTER `frame.outline('selout', { palette })`** so sparkles stay bright and airy without dark ink rings!
- Validate with `auditSpriteSheet(sheet, { maxColors: 14, maxFillRatio: 0.54 })` (zero warnings, `lumRange >= 150`).
