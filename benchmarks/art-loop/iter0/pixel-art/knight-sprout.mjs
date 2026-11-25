import { createSpriteSheet } from '../../../../packages/ridgetop/dist/framework/index.js'

const INK = '1c2936'
const VISOR = '111924'
const BOOT_DARK = '273847'
const BOOT_MID = '445c6e'
const BOOT_HI = '6c8496'

const MOSS_DEEP = '234d40'
const MOSS_MID = '35755e'
const MOSS_BRIGHT = '5ba06b'
const MOSS_RIM = '8db573'
const SPROUT_HI = 'c8e697'

const CLOAK_DEEP = '7e332a'
const CLOAK_MID = 'c25434'
const CLOAK_BRIGHT = 'e88848'
const CLOAK_RIM = 'ffbe78'

const WOOD_DEEP = '633c26'
const WOOD_MID = '9a6644'
const WOOD_BRIGHT = 'c99260'
const IRON_DARK = '566975'
const IRON_MID = '7f929d'
const IRON_HI = 'c9d8e0'

const EYE_GLOW = '7ef2d4'
const EYE_CORE = 'fff0c4'

function drawBoot(f, x, y, front) {
  const r = f.rect
  const body = front ? BOOT_MID : BOOT_DARK
  const toe = front ? BOOT_HI : BOOT_MID
  // Crisp pixel-art boot silhouette with continuous 1px ink outline
  r(x, y - 4, 5, 5, INK)
  r(x + 1, y - 2, 6, 3, INK)
  // Boot interior
  r(x + 1, y - 3, 3, 2, body)
  r(x + 1, y - 1, 5, 1, body)
  r(x + 4, y - 1, 2, 1, toe)
  if (!front) {
    r(x + 1, y - 1, 2, 1, INK)
  }
}

function drawBuckler(f, cx, cy) {
  const r = f.rect
  // Circular 9x9 wooden buckler with iron rim and central boss stud
  r(cx - 2, cy - 4, 5, 9, INK)
  r(cx - 3, cy - 3, 7, 7, INK)
  r(cx - 4, cy - 2, 9, 5, INK)

  // Iron rim
  r(cx - 2, cy - 3, 5, 7, IRON_DARK)
  r(cx - 3, cy - 2, 7, 5, IRON_DARK)
  r(cx - 2, cy - 3, 4, 1, IRON_MID)
  r(cx - 3, cy - 2, 1, 3, IRON_MID)
  r(cx - 2, cy - 2, 1, 1, IRON_HI)

  // Wooden plank interior (5x5 rounded)
  r(cx - 1, cy - 2, 3, 5, WOOD_MID)
  r(cx - 2, cy - 1, 5, 3, WOOD_MID)
  // Top-left plank highlight
  r(cx - 1, cy - 2, 2, 1, WOOD_BRIGHT)
  r(cx - 2, cy - 1, 2, 1, WOOD_BRIGHT)
  // Plank grain seam & lower-right shadow
  r(cx - 2, cy, 5, 1, WOOD_DEEP)
  r(cx, cy + 1, 2, 1, WOOD_DEEP)
  r(cx - 1, cy + 2, 3, 1, WOOD_DEEP)

  // Central metal boss stud
  r(cx - 1, cy - 1, 2, 2, IRON_MID)
  r(cx - 1, cy - 1, 1, 1, EYE_CORE)
}

function drawSprout(f, cx, baseY, dx, tilt) {
  const r = f.rect
  const sx = cx + dx

  // Stem outline + center stalk
  r(sx - 1, baseY - 3, 3, 4, INK)
  r(sx, baseY - 2, 1, 3, MOSS_MID)
  r(sx, baseY - 2, 1, 1, MOSS_RIM)

  // Left arched leaf (crisp unbroken ink outline)
  const ly = baseY - 4 + (tilt < 0 ? 1 : 0)
  r(sx - 5, ly - 1, 5, 4, INK)
  r(sx - 6, ly, 2, 2, INK)
  r(sx - 4, ly - 2, 3, 1, INK)
  // Left leaf fill + highlight
  r(sx - 4, ly, 3, 2, MOSS_MID)
  r(sx - 5, ly, 2, 1, MOSS_BRIGHT)
  r(sx - 4, ly - 1, 3, 1, MOSS_RIM)
  r(sx - 4, ly - 1, 2, 1, SPROUT_HI)
  r(sx - 2, ly + 1, 2, 1, MOSS_BRIGHT)

  // Right arched leaf (slightly taller, perky bounce, unbroken ink outline)
  const ry = baseY - 3 + (tilt > 0 ? 1 : 0)
  r(sx, ry - 2, 6, 4, INK)
  r(sx + 5, ry - 1, 2, 2, INK)
  r(sx + 2, ry - 3, 3, 1, INK)
  // Right leaf fill + highlight
  r(sx + 1, ry - 1, 4, 2, MOSS_MID)
  r(sx + 2, ry - 2, 3, 1, MOSS_RIM)
  r(sx + 3, ry - 2, 2, 1, SPROUT_HI)
  r(sx + 4, ry - 1, 2, 1, MOSS_BRIGHT)
  r(sx + 1, ry, 2, 1, MOSS_BRIGHT)
}

function paintKnightSprout(f, pose) {
  const r = f.rect
  const p = f.polygon

  // 4-frame run cycle: 0=contactA, 1=passA(high), 2=contactB, 3=passB(high)
  const dy = [0, -2, 0, -2][pose]
  const sproutDx = [-1, 0, 1, 0][pose]
  const sproutDy = [0, 0, 1, 0][pose]
  const leafTilt = [-1, 1, 0, -1][pose]
  const cloakWave = [0, -1, 1, -2][pose]
  const cloakTailY = [23, 21, 24, 20][pose]
  const shieldDx = [0, -1, 1, 0][pose]
  const shieldDy = [0, 0, 0, -1][pose]

  // 1. Fluttering warm cloak behind hero
  const cTop = 18 + dy
  const cTail = cloakTailY + dy
  p([
    [15, cTop],
    [9, cTop + 1 + cloakWave],
    [4, cTail - 2],
    [3, cTail + 1],
    [6, cTail + 3],
    [12, cTop + 8],
    [16, cTop + 7]
  ], INK)
  p([
    [15, cTop + 1],
    [9, cTop + 2 + cloakWave],
    [5, cTail - 1],
    [4, cTail + 1],
    [7, cTail + 2],
    [12, cTop + 7],
    [15, cTop + 6]
  ], CLOAK_DEEP)
  p([
    [15, cTop + 1],
    [9, cTop + 2 + cloakWave],
    [5, cTail - 1],
    [6, cTail + 1],
    [11, cTop + 5],
    [15, cTop + 4]
  ], CLOAK_MID)
  p([
    [14, cTop + 2],
    [9, cTop + 2 + cloakWave],
    [6, cTail - 1],
    [10, cTop + 4],
    [14, cTop + 3]
  ], CLOAK_BRIGHT)
  r(10, cTop + 3 + cloakWave, 3, 1, CLOAK_RIM)

  // 2. Back leg / boot (drawn behind torso)
  if (pose === 0) {
    drawBoot(f, 9, 29, false)
  } else if (pose === 1) {
    drawBoot(f, 11, 28, false)
  } else if (pose === 2) {
    drawBoot(f, 8, 29, false)
  } else {
    drawBoot(f, 19, 28, false)
  }

  // 3. Torso / moss tunic & belt
  const ty = 19 + dy
  r(13, ty, 11, 8, INK)
  r(14, ty + 1, 9, 6, MOSS_DEEP)
  r(15, ty + 1, 7, 4, MOSS_MID)
  r(15, ty + 1, 4, 2, MOSS_BRIGHT)
  // Leather belt & warm gold buckle
  r(14, ty + 4, 9, 2, WOOD_DEEP)
  r(18, ty + 4, 3, 2, CLOAK_BRIGHT)
  r(19, ty + 4, 1, 1, EYE_CORE)

  // 4. Front grounded boot (firmly grounded at row y=30 on every frame)
  if (pose === 0) {
    drawBoot(f, 19, 30, true)
  } else if (pose === 1) {
    drawBoot(f, 14, 30, true)
  } else if (pose === 2) {
    drawBoot(f, 20, 30, true)
  } else {
    drawBoot(f, 14, 30, true)
  }

  // 5. Round moss-green helmet (chunky chibi dome, crisp stepped silhouette)
  const hy = 9 + dy
  // Outer ink dome
  r(15, hy, 9, 1, INK)
  r(13, hy + 1, 13, 1, INK)
  r(12, hy + 2, 15, 2, INK)
  r(11, hy + 4, 17, 5, INK)
  r(12, hy + 9, 15, 2, INK)
  r(13, hy + 11, 13, 1, INK)

  // Deep moss base fill (strictly inside ink border)
  r(15, hy + 1, 9, 1, MOSS_MID)
  r(13, hy + 2, 13, 2, MOSS_MID)
  r(12, hy + 4, 15, 5, MOSS_DEEP)
  r(13, hy + 9, 13, 2, MOSS_DEEP)

  // Lit upper-left helmet dome
  r(15, hy + 1, 8, 1, MOSS_BRIGHT)
  r(13, hy + 2, 11, 2, MOSS_BRIGHT)
  r(12, hy + 4, 12, 3, MOSS_MID)
  r(13, hy + 4, 6, 3, MOSS_BRIGHT)
  r(13, hy + 7, 5, 2, MOSS_MID)

  // Crisp top-left specular rim on dome
  r(15, hy + 1, 5, 1, MOSS_RIM)
  r(13, hy + 2, 4, 1, MOSS_RIM)
  r(13, hy + 3, 2, 1, SPROUT_HI)

  // Lower helmet cheek rim bevel (stays inside x=13..25 ink border)
  r(13, hy + 9, 4, 1, MOSS_MID)

  // 6. Dark visor cavity + two bright glowing visor eyes
  r(18, hy + 4, 9, 5, INK)
  r(19, hy + 5, 8, 3, VISOR)
  r(18, hy + 4, 8, 1, MOSS_DEEP)
  // Left glowing eye (2x3 glow + 2x2 warm core)
  r(20, hy + 5, 2, 3, EYE_GLOW)
  r(20, hy + 5, 2, 2, EYE_CORE)
  // Right glowing eye
  r(24, hy + 5, 2, 3, EYE_GLOW)
  r(24, hy + 5, 2, 2, EYE_CORE)
  // Cheekguard lip under visor
  r(18, hy + 9, 8, 1, MOSS_MID)
  r(19, hy + 10, 6, 1, MOSS_DEEP)

  // 7. Bouncy twin-leaf sprout on crown of helmet
  drawSprout(f, 19, hy + sproutDy, sproutDx, leafTilt)

  // 8. Wooden round buckler shield on front arm
  drawBuckler(f, 22 + shieldDx, 23 + dy + shieldDy)
}

export function build() {
  const sheet = createSpriteSheet(32, 32, 4, 1)
  for (let pose = 0; pose < 4; pose++) {
    paintKnightSprout(sheet.frame(pose, 0), pose)
  }
  return sheet
}
