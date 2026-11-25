import { createSpriteSheet } from '../../../../packages/ridgetop/dist/framework/index.js'

const INK = '1b2836'
const CAVITY = '121a24'

const STONE_DEEP = '3b4c59'
const STONE_DARK = '586c78'
const STONE_MID = '7f929d'
const STONE_LIGHT = 'a6b7c0'
const STONE_HI = 'cfdce0'

const MOSS_DEEP = '1e473b'
const MOSS_MID = '35755e'
const MOSS_BRIGHT = '5f9c67'
const MOSS_LIGHT = '8db573'
const MOSS_HI = 'bedb88'

const RUNE_DEEP = 'a34824'
const RUNE_MID = 'e88848'
const RUNE_GOLD = 'ffc75e'
const RUNE_CORE = 'fff0c4'

function paintMossGolem(f, frameIndex) {
  const r = f.rect
  const p = f.polygon

  // 2-frame heavy breathing idle: 0 = settled exhale, 1 = deep heavy inhale heave
  const inhale = frameIndex === 1
  const dy = inhale ? -2 : 0
  const flare = inhale ? 1 : 0

  // 1. Sturdy ancient stone pillar legs (planted firmly at row y=38)
  // Left leg (foreground, heavier)
  p([
    [11, 29], [19, 29], [19, 38], [11, 38], [10, 34]
  ], INK)
  r(12, 30, 6, 7, STONE_DARK)
  r(12, 30, 3, 6, STONE_MID)
  r(12, 30, 2, 3, STONE_LIGHT)
  r(16, 31, 2, 6, STONE_DEEP)
  r(12, 36, 6, 1, STONE_DEEP)

  // Right leg (receding slightly in 3/4 view)
  p([
    [22, 30], [29, 30], [30, 37], [22, 37]
  ], INK)
  r(23, 31, 5, 5, STONE_DEEP)
  r(23, 31, 3, 4, STONE_DARK)
  r(23, 31, 2, 2, STONE_MID)

  // 2. Broad hunched stone shoulders & upper back silhouette
  p([
    [11 - flare, 5 + dy],
    [19, 4 + dy],
    [28 + flare, 5 + dy],
    [35 + flare, 10 + dy],
    [36 + flare, 18 + dy],
    [31, 23 + dy],
    [9, 23 + dy],
    [4 - flare, 18 + dy],
    [5 - flare, 10 + dy]
  ], INK)
  // Shoulder stone interior
  p([
    [12 - flare, 6 + dy],
    [19, 5 + dy],
    [27 + flare, 6 + dy],
    [34 + flare, 11 + dy],
    [35 + flare, 18 + dy],
    [30, 22 + dy],
    [10, 22 + dy],
    [5 - flare, 18 + dy],
    [6 - flare, 11 + dy]
  ], STONE_DARK)
  // Lit upper-left shoulder facets
  p([
    [12 - flare, 6 + dy],
    [20, 6 + dy],
    [22, 12 + dy],
    [14, 19 + dy],
    [6 - flare, 17 + dy],
    [7 - flare, 11 + dy]
  ], STONE_MID)
  r(7 - flare, 13 + dy, 4, 4, STONE_LIGHT)
  r(7 - flare, 13 + dy, 2, 2, STONE_HI)
  // Deep shadow on receding right shoulder
  r(28, 12 + dy, 6 + flare, 7, STONE_DEEP)
  r(26, 15 + dy, 5, 5, STONE_DARK)

  // 3. Massive chiseled stone torso (connects shoulders to hips)
  p([
    [10, 18 + dy],
    [30, 18 + dy],
    [29, 31 + Math.floor(dy / 2)],
    [26, 33 + Math.floor(dy / 2)],
    [14, 33 + Math.floor(dy / 2)],
    [11, 31 + Math.floor(dy / 2)]
  ], INK)
  p([
    [11, 19 + dy],
    [29, 19 + dy],
    [28, 30 + Math.floor(dy / 2)],
    [25, 32 + Math.floor(dy / 2)],
    [15, 32 + Math.floor(dy / 2)],
    [12, 30 + Math.floor(dy / 2)]
  ], STONE_DARK)
  // Lit chest slab (upper-left to center)
  r(12, 19 + dy, 12, 10, STONE_MID)
  r(12, 20 + dy, 5, 6, STONE_LIGHT)
  r(13, 20 + dy, 2, 3, STONE_HI)
  // Lower torso shadow & ancient crack seams
  r(24, 20 + dy, 5, 10, STONE_DEEP)
  r(13, 29 + Math.floor(dy / 2), 14, 2, STONE_DEEP)
  r(15, 27 + dy, 2, 2, STONE_DEEP)
  r(25, 23 + dy, 2, 1, INK)

  // 4. Carved chest rune (3/4 shifted slightly right-of-center, glowing amber-gold)
  const rx = 20
  const ry = 23 + dy
  // Carved dark stone recess
  r(rx - 2, ry - 1, 5, 7, STONE_DEEP)
  r(rx - 1, ry, 3, 5, CAVITY)
  r(rx - 2, ry + 1, 5, 3, CAVITY)
  // Glowing rune glyph inside carved groove (pulses brighter on inhale)
  const runeOuter = inhale ? RUNE_MID : RUNE_DEEP
  const runeInner = inhale ? RUNE_GOLD : RUNE_MID
  const runeTip = inhale ? RUNE_CORE : RUNE_GOLD
  // Vertical rune spine & diamond crossbars
  r(rx, ry, 1, 5, runeInner)
  r(rx - 2, ry + 2, 5, 1, runeOuter)
  r(rx - 1, ry + 1, 3, 3, runeInner)
  r(rx, ry + 1, 1, 3, runeTip)
  if (inhale) {
    r(rx - 1, ry + 2, 3, 1, RUNE_CORE)
  }
  // Subtle lower rune chevron
  r(rx - 1, ry + 5, 3, 1, STONE_DEEP)
  r(rx, ry + 5, 1, 1, runeOuter)

  // 5. Sunken dark face cavity with two glowing amber-gold rune eyes
  const fy = 11 + dy
  // Heavy stone brow overhang & cheek frame
  r(13, fy, 15, 2, INK)
  r(14, fy + 1, 13, 9, INK)
  r(14, fy, 13, 2, STONE_MID)
  r(14, fy, 6, 1, STONE_LIGHT)
  r(23, fy, 4, 2, STONE_DARK)
  // Deep sunken dark face cavity
  r(15, fy + 2, 11, 6, CAVITY)
  // Stone cheek/jaw ledges framing the cavity
  r(14, fy + 2, 1, 6, STONE_DARK)
  r(26, fy + 2, 1, 6, STONE_DEEP)
  r(15, fy + 8, 11, 2, STONE_DARK)
  r(16, fy + 8, 5, 1, STONE_MID)
  r(19, fy + 8, 2, 2, CAVITY) // weathered jaw cleft

  // Left glowing amber-gold rune eye (larger, closer in 3/4 view)
  r(16, fy + 4, 4, 2, RUNE_DEEP)
  r(17, fy + 4, 3, 2, RUNE_MID)
  r(17, fy + 4, 2, 2, RUNE_GOLD)
  r(18, fy + 4, 1, 1, RUNE_CORE)
  if (inhale) r(17, fy + 4, 2, 1, RUNE_CORE)

  // Right glowing amber-gold rune eye (slightly narrower in 3/4 perspective)
  r(22, fy + 4, 4, 2, RUNE_DEEP)
  r(23, fy + 4, 2, 2, RUNE_GOLD)
  r(23, fy + 4, 1, 1, RUNE_CORE)
  if (inhale) r(23, fy + 4, 2, 1, RUNE_CORE)

  // Warm eye-glow bounce on lower face rim
  r(17, fy + 7, 2, 1, RUNE_DEEP)
  r(23, fy + 7, 2, 1, RUNE_DEEP)

  // 6. Lush hanging moss carpets draped across hunched shoulders & brow
  // Upper crown & left shoulder moss carpet
  p([
    [10 - flare, 4 + dy],
    [20, 3 + dy],
    [29 + flare, 4 + dy],
    [34 + flare, 8 + dy],
    [34 + flare, 13 + dy],
    [27, 13 + dy],
    [24, 10 + dy],
    [16, 10 + dy],
    [13, 14 + dy],
    [6 - flare, 14 + dy],
    [5 - flare, 9 + dy]
  ], INK)
  // Deep moss base
  p([
    [11 - flare, 5 + dy],
    [20, 4 + dy],
    [28 + flare, 5 + dy],
    [33 + flare, 9 + dy],
    [33 + flare, 12 + dy],
    [27, 12 + dy],
    [24, 9 + dy],
    [16, 9 + dy],
    [13, 13 + dy],
    [7 - flare, 13 + dy],
    [6 - flare, 9 + dy]
  ], MOSS_DEEP)
  // Mid moss carpet
  p([
    [11 - flare, 5 + dy],
    [20, 4 + dy],
    [28 + flare, 5 + dy],
    [32 + flare, 8 + dy],
    [29, 10 + dy],
    [24, 8 + dy],
    [16, 8 + dy],
    [12, 11 + dy],
    [7 - flare, 11 + dy],
    [7 - flare, 8 + dy]
  ], MOSS_MID)
  // Sunlit upper moss crown & highlights
  r(11 - flare, 5 + dy, 16 + flare, 3, MOSS_BRIGHT)
  r(12 - flare, 5 + dy, 11, 2, MOSS_LIGHT)
  r(14 - flare, 5 + dy, 6, 1, MOSS_HI)
  r(7 - flare, 8 + dy, 5, 2, MOSS_BRIGHT)
  r(8 - flare, 8 + dy, 3, 1, MOSS_LIGHT)
  r(26, 7 + dy, 5 + flare, 2, MOSS_BRIGHT)
  r(27, 7 + dy, 3, 1, MOSS_LIGHT)

  // Hanging lush moss tendrils dripping over shoulders and brow
  const drip = inhale ? 1 : 0
  // Left shoulder hanging moss curtains
  r(6 - flare, 13 + dy, 3, 5 + drip, INK)
  r(7 - flare, 13 + dy, 2, 4 + drip, MOSS_MID)
  r(7 - flare, 13 + dy, 1, 2, MOSS_BRIGHT)
  r(10 - flare, 12 + dy, 4, 6, INK)
  r(11 - flare, 12 + dy, 2, 5, MOSS_MID)
  r(11 - flare, 12 + dy, 1, 3, MOSS_LIGHT)
  r(12 - flare, 15 + dy, 1, 2, MOSS_DEEP)
  // Brow moss tendril
  r(15, 9 + dy, 3, 4, INK)
  r(16, 9 + dy, 2, 3, MOSS_MID)
  r(16, 9 + dy, 1, 2, MOSS_LIGHT)
  // Right shoulder hanging moss curtains
  r(27, 11 + dy, 4, 6 + drip, INK)
  r(28, 11 + dy, 2, 5 + drip, MOSS_DEEP)
  r(28, 11 + dy, 2, 3, MOSS_MID)
  r(28, 11 + dy, 1, 2, MOSS_BRIGHT)
  r(31 + flare, 12 + dy, 3, 5, INK)
  r(32 + flare, 12 + dy, 1, 4, MOSS_DEEP)
  r(32 + flare, 12 + dy, 1, 2, MOSS_MID)

  // 7. Asymmetric heavy boulder fists resting near the ground
  // Left massive foreground boulder arm & fist (x = 2..13, grounded near y = 37)
  // Upper arm connecting hunched left shoulder down to giant fist
  p([
    [3 - flare, 17 + dy],
    [11, 18 + dy],
    [12, 26],
    [3, 26]
  ], INK)
  r(5 - flare, 18 + dy, 6, 8 - dy, STONE_MID)
  r(5 - flare, 18 + dy, 3, 5, STONE_LIGHT)
  r(9, 19 + dy, 2, 7 - dy, STONE_DARK)

  // Giant foreground left boulder fist (craggy octagonal stone mass, y = 25..37)
  p([
    [3, 25], [12, 25], [14, 28], [13, 35], [10, 37], [3, 37], [2, 33], [2, 28]
  ], INK)
  p([
    [4, 26], [11, 26], [13, 29], [12, 35], [10, 36], [4, 36], [3, 33], [3, 28]
  ], STONE_DARK)
  // Lit upper-left fist faces
  p([
    [4, 26], [10, 26], [11, 30], [9, 33], [4, 33], [3, 29]
  ], STONE_MID)
  r(4, 27, 5, 3, STONE_LIGHT)
  r(4, 27, 3, 1, STONE_HI)
  // Heavy boulder knuckle clefts, lower shadow & crisp right separation from leg
  r(4, 34, 7, 2, STONE_DEEP)
  r(6, 33, 1, 3, INK)
  r(9, 33, 1, 3, INK)
  r(11, 29, 1, 6, STONE_DEEP)
  r(12, 32, 1, 4, INK)
  // Small moss tuft draped on left forearm/wrist (with unbroken ink outline)
  r(3, 23, 6, 4, INK)
  r(4, 24, 4, 2, MOSS_MID)
  r(4, 24, 3, 1, MOSS_LIGHT)
  r(7, 25, 1, 1, MOSS_DEEP)

  // Right asymmetric heavy boulder arm & fist (slightly smaller, set slightly higher/back at y = 36)
  p([
    [29, 18 + dy],
    [36 + flare, 17 + dy],
    [37, 26],
    [28, 26]
  ], INK)
  r(29, 19 + dy, 6, 7 - dy, STONE_DARK)
  r(29, 19 + dy, 3, 5, STONE_MID)
  r(33, 19 + dy, 2, 7 - dy, STONE_DEEP)

  // Right heavy boulder fist (x = 27..37, y = 26..36)
  p([
    [28, 26], [36, 26], [37, 29], [37, 34], [35, 36], [28, 36], [27, 33], [27, 29]
  ], INK)
  p([
    [29, 27], [35, 27], [36, 29], [36, 34], [34, 35], [29, 35], [28, 33], [28, 29]
  ], STONE_DEEP)
  // Lit upper-inner edge of right fist
  r(29, 27, 5, 5, STONE_DARK)
  r(29, 27, 3, 3, STONE_MID)
  r(29, 27, 2, 1, STONE_LIGHT)
  // Knuckle clefts
  r(31, 33, 1, 2, INK)
  r(34, 33, 1, 2, INK)
  // Moss tuft on right outer elbow (with unbroken ink outline)
  r(32, 23, 5, 4, INK)
  r(33, 24, 3, 2, MOSS_MID)
  r(33, 24, 2, 1, MOSS_BRIGHT)
}

export function build() {
  const sheet = createSpriteSheet(40, 40, 2, 1)
  paintMossGolem(sheet.frame(0, 0), 0)
  paintMossGolem(sheet.frame(1, 0), 1)
  return sheet
}
