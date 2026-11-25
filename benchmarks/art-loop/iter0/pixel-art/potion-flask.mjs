import { createSpriteSheet } from '../../../../packages/ridgetop/dist/framework/index.js'

const INK = '1b2938'

const CORK_DARK = '6b4229'
const CORK_MID = '9a6644'
const CORK_HI = 'cfa072'

const WAX_DEEP = '8c272c'
const WAX_MID = 'd14536'
const WAX_BRIGHT = 'e88848'
const WAX_HI = 'ffbe78'

const GLASS_DEEP = '2a4559'
const GLASS_MID = '486f87'
const GLASS_LIGHT = '7eaec4'
const GLASS_RIM = 'bce3f0'

const ELIXIR_DEEP = '135c59'
const ELIXIR_MID = '1f9180'
const ELIXIR_BRIGHT = '45d1b4'
const ELIXIR_GLOW = '7ef2d4'
const ELIXIR_FOAM = 'c9fff0'

const SPEC = 'fff0c4'

function drawCrossGlint(f, cx, cy, big) {
  const r = f.rect
  if (big) {
    r(cx - 1, cy, 3, 1, ELIXIR_FOAM)
    r(cx, cy - 1, 1, 3, ELIXIR_FOAM)
    r(cx, cy, 1, 1, SPEC)
  } else {
    r(cx, cy, 2, 1, SPEC)
    r(cx, cy - 1, 1, 2, ELIXIR_FOAM)
  }
}

function paintPotionFlask(f, frameIndex) {
  const r = f.rect

  // 1. Cork stopper (y = 2..5)
  r(9, 2, 6, 4, INK)
  r(10, 3, 4, 2, CORK_MID)
  r(10, 3, 2, 2, CORK_HI)
  r(13, 3, 1, 2, CORK_DARK)
  r(10, 4, 1, 1, CORK_MID)

  // 2. Flared crystal bottle lip & narrow neck (y = 5..9)
  r(8, 5, 8, 2, INK)
  r(9, 5, 6, 1, GLASS_LIGHT)
  r(9, 5, 3, 1, GLASS_RIM)
  r(13, 5, 2, 1, GLASS_MID)
  // Narrow neck
  r(9, 6, 6, 4, INK)
  r(10, 6, 4, 4, GLASS_MID)
  r(10, 6, 2, 4, GLASS_LIGHT)
  r(13, 6, 1, 4, GLASS_DEEP)

  // 3. Bulbous faceted crystal flask silhouette (y = 10..22)
  // Ink outer perimeter (octagonal faceted crystal bulb)
  r(7, 9, 10, 1, INK)
  r(6, 10, 12, 1, INK)
  r(5, 11, 14, 1, INK)
  r(4, 12, 16, 2, INK)
  r(3, 14, 18, 5, INK)
  r(4, 19, 16, 1, INK)
  r(5, 20, 14, 1, INK)
  r(6, 21, 12, 1, INK)
  r(7, 22, 10, 1, INK)

  // 4. Hollow upper crystal glass interior with faceted shading (y = 9..14)
  // Open crystal throat connecting neck cleanly into the bulb
  r(10, 9, 4, 1, GLASS_MID)
  r(10, 9, 2, 1, GLASS_LIGHT)
  r(13, 9, 1, 1, GLASS_DEEP)
  r(7, 10, 10, 1, GLASS_MID)
  r(6, 11, 12, 1, GLASS_MID)
  r(5, 12, 14, 2, GLASS_MID)
  r(4, 14, 16, 5, GLASS_DEEP)
  r(5, 19, 14, 1, GLASS_DEEP)
  r(6, 20, 12, 1, GLASS_DEEP)
  r(7, 21, 10, 1, GLASS_DEEP)

  // Faceted crystal planes (left bright facet, center glass, right shaded facet)
  r(7, 10, 3, 1, GLASS_LIGHT)
  r(6, 11, 3, 1, GLASS_LIGHT)
  r(5, 12, 3, 2, GLASS_LIGHT)
  // Crisp crystal facet ridges at x=9 and x=14
  r(9, 10, 1, 4, GLASS_RIM)
  r(14, 10, 1, 4, GLASS_DEEP)
  r(15, 11, 3, 1, GLASS_DEEP)
  r(16, 12, 3, 2, GLASS_DEEP)

  // 5. Glowing teal-emerald elixir filling the lower half (y = 14..20)
  const pulse = frameIndex === 1 || frameIndex === 2
  const waveShift = [0, 1, 0, -1][frameIndex]

  // Main liquid fill
  r(4, 14, 16, 5, ELIXIR_MID)
  r(5, 19, 14, 1, ELIXIR_DEEP)
  r(6, 20, 12, 1, ELIXIR_DEEP)

  // Right-side depth shadow inside elixir (preserves crystal facet shading)
  r(16, 15, 4, 4, ELIXIR_DEEP)
  r(15, 18, 4, 2, ELIXIR_DEEP)

  // Luminous glowing teal-emerald core in center-left of liquid
  r(6, 15, 9, 4, ELIXIR_BRIGHT)
  r(7, 15, 6, 3, pulse ? ELIXIR_GLOW : ELIXIR_BRIGHT)
  r(8, 16, 4, 2, ELIXIR_GLOW)
  // Faceted bright liquid edge along left crystal bevel
  r(5, 15, 2, 4, ELIXIR_BRIGHT)
  r(6, 19, 5, 1, ELIXIR_MID)
  r(7, 20, 5, 1, ELIXIR_MID)
  // Crisp bottom crystal glass reflection lip
  r(7, 21, 6, 1, GLASS_LIGHT)
  r(8, 21, 3, 1, GLASS_RIM)
  r(13, 21, 4, 1, GLASS_MID)

  // Animated meniscus surface at y = 14 (ripples across 4 frames)
  r(4, 14, 16, 1, ELIXIR_GLOW)
  r(5, 14, 11, 1, ELIXIR_FOAM)
  r(16, 14, 4, 1, ELIXIR_BRIGHT)
  // Gentle ripple crest shifting across meniscus
  const crestX = 8 + waveShift * 2
  r(crestX, 13, 3, 1, ELIXIR_GLOW)
  r(crestX + 1, 13, 2, 1, ELIXIR_FOAM)

  // 6. Rising elixir bubbles (4-frame loop, 2px clusters -> crisp, zero orphans)
  const b1Y = [19, 17, 15, 14][frameIndex]
  const b2Y = [16, 14, 19, 17][frameIndex]
  const b3Y = [18, 16, 15, 18][frameIndex]
  // Bubble 1 (left-center rising)
  r(9, b1Y, 2, 1, ELIXIR_FOAM)
  if (b1Y > 14) r(9, b1Y - 1, 1, 1, SPEC)
  // Bubble 2 (right-center rising)
  r(13, b2Y, 2, 1, ELIXIR_FOAM)
  if (b2Y > 14) r(14, b2Y - 1, 1, 1, ELIXIR_GLOW)
  // Bubble 3 (small lower-center bubble)
  r(11, b3Y, 1, 2, frameIndex === 2 ? SPEC : ELIXIR_FOAM)

  // 7. Crisp glass specular highlight on upper-left curve
  r(6, 11, 2, 1, SPEC)
  r(5, 12, 2, 2, SPEC)
  r(5, 14, 1, 2, SPEC)
  r(6, 12, 1, 1, GLASS_RIM)
  // Secondary lower-left curve catchlight
  r(5, 17, 1, 2, ELIXIR_FOAM)
  // Upper-right subtle crystal rim sheen
  r(17, 12, 1, 2, GLASS_LIGHT)

  // 8. Crimson-orange wax ribbon tied around the narrow neck + trailing seal tail
  // Ribbon band around neck (y = 7..8)
  r(8, 7, 8, 2, INK)
  r(9, 7, 6, 2, WAX_MID)
  r(9, 7, 4, 1, WAX_BRIGHT)
  r(10, 7, 2, 1, WAX_HI)
  r(13, 8, 2, 1, WAX_DEEP)

  // Wax knot & fluttering ribbon tail on right side of neck (y = 7..12)
  r(15, 7, 3, 3, INK)
  r(16, 8, 3, 3, INK)
  r(17, 10, 3, 3, INK)
  // Inner crimson-orange wax knot & ribbon tail
  r(15, 8, 2, 1, WAX_BRIGHT)
  r(16, 8, 1, 1, WAX_HI)
  r(16, 9, 2, 1, WAX_MID)
  r(17, 10, 2, 1, WAX_MID)
  r(18, 11, 1, 1, WAX_DEEP)
  // Subtle shimmer on ribbon tip
  r(17, 10, 1, 1, WAX_BRIGHT)

  // 9. 4-frame glint shimmer animation (crisp cross sparkle, zero orphan pixels)
  if (frameIndex === 0) {
    drawCrossGlint(f, 5, 11, false)
  } else if (frameIndex === 1) {
    drawCrossGlint(f, 5, 11, true)
  } else if (frameIndex === 2) {
    drawCrossGlint(f, 18, 15, false)
  } else {
    drawCrossGlint(f, 18, 15, true)
  }
}

export function build() {
  const sheet = createSpriteSheet(24, 24, 4, 1)
  for (let i = 0; i < 4; i++) {
    paintPotionFlask(sheet.frame(i, 0), i)
  }
  return sheet
}
