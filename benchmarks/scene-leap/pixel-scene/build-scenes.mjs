import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditSpriteSheet,
  bakeAnimatedSpritePixels,
  createPixelRig,
  createSpriteSheet,
  hueShiftRamp,
  modelFromArtRecipe,
  pixelClips,
  renderPixelRig
} from '../../../packages/ridgetop/dist/framework/index.js'
import { encodePng } from '../../../packages/ridgetop/dist/framework/server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = __dirname
mkdirSync(OUT_DIR, { recursive: true })

const SCENE_W = 240
const SCENE_H = 135
const FRAMES = 4
const GROUND_Y = 96

// ---------------------------------------------------------------------------
// Pixel buffer helpers (nearest-neighbor blit, crop, upscale, crisp labels)
// ---------------------------------------------------------------------------
function cropFrame(sheet, col, row = 0) {
  const { frameWidth: fw, frameHeight: fh, width: sw, pixels } = sheet
  const out = new Uint8ClampedArray(fw * fh * 4)
  for (let y = 0; y < fh; y++) {
    const src = ((row * fh + y) * sw + col * fw) * 4
    out.set(pixels.subarray(src, src + fw * 4), y * fw * 4)
  }
  return { width: fw, height: fh, pixels: out }
}

function blitSheetFrame(dstFrame, sheet, col, row, dstX, dstY) {
  const { frameWidth: fw, frameHeight: fh, width: sw, pixels } = sheet
  const ix = Math.round(dstX)
  const iy = Math.round(dstY)
  for (let py = 0; py < fh; py++) {
    for (let px = 0; px < fw; px++) {
      const i = ((row * fh + py) * sw + col * fw + px) * 4
      const a = pixels[i + 3]
      if (a === 0) continue
      const r = pixels[i].toString(16).padStart(2, '0')
      const g = pixels[i + 1].toString(16).padStart(2, '0')
      const b = pixels[i + 2].toString(16).padStart(2, '0')
      const ah = a.toString(16).padStart(2, '0')
      dstFrame.pixel(ix + px, iy + py, a === 255 ? `#${r}${g}${b}` : `#${r}${g}${b}${ah}`)
    }
  }
}

function upscaleNearest(srcPixels, srcW, srcH, scale) {
  const dstW = srcW * scale
  const dstH = srcH * scale
  const dst = new Uint8ClampedArray(dstW * dstH * 4)
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const si = (y * srcW + x) * 4
      const r = srcPixels[si], g = srcPixels[si + 1], b = srcPixels[si + 2], a = srcPixels[si + 3]
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const di = ((y * scale + dy) * dstW + (x * scale + dx)) * 4
          dst[di] = r; dst[di + 1] = g; dst[di + 2] = b; dst[di + 3] = a
        }
      }
    }
  }
  return { width: dstW, height: dstH, pixels: dst }
}

function compositeRgba(dst, dstW, dstH, src, srcW, srcH, ox, oy) {
  for (let y = 0; y < srcH; y++) {
    const ty = oy + y
    if (ty < 0 || ty >= dstH) continue
    for (let x = 0; x < srcW; x++) {
      const tx = ox + x
      if (tx < 0 || tx >= dstW) continue
      const si = (y * srcW + x) * 4
      const sa = src[si + 3]
      if (sa === 0) continue
      const di = (ty * dstW + tx) * 4
      if (sa === 255) {
        dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255
      } else {
        const a = sa / 255
        dst[di] = Math.round(src[si] * a + dst[di] * (1 - a))
        dst[di + 1] = Math.round(src[si + 1] * a + dst[di + 1] * (1 - a))
        dst[di + 2] = Math.round(src[si + 2] * a + dst[di + 2] * (1 - a))
        dst[di + 3] = 255
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 1. BEFORE / ITER 0 SCENE (naive rect/polygon, flat unshifted colors)
// ---------------------------------------------------------------------------
function buildBeforeScene() {
  const sheet = createSpriteSheet(SCENE_W, SCENE_H, FRAMES)

  for (let f = 0; f < FRAMES; f++) {
    const frame = sheet.frame(f)

    // Flat cyan sky & flat yellow sun box
    frame.rect(0, 0, SCENE_W, GROUND_Y, '#52c8f5')
    frame.rect(18, 14, 16, 16, '#fff240')

    // Flat bright green grass strip + flat brown dirt bar (zero texture, zero parallax)
    frame.rect(0, GROUND_Y, SCENE_W, 8, '#3cc43c')
    frame.rect(0, GROUND_Y + 8, SCENE_W, SCENE_H - GROUND_Y - 8, '#7a502c')

    // Stiff "carrot-cape" knight sliding horizontally with static legs
    const kx = 54 + f * 5
    const ky = GROUND_Y - 26
    frame.polygon([
      [kx + 2, ky + 10],
      [kx - 14, ky + 13],
      [kx + 2, ky + 16]
    ], '#e03c28')
    frame.rect(kx + 3, ky + 19, 4, 7, '#303040')
    frame.rect(kx + 9, ky + 19, 4, 7, '#303040')
    frame.rect(kx + 2, ky + 9, 12, 11, '#3478c6')
    frame.rect(kx + 11, ky + 11, 5, 8, '#a06c38')
    frame.rect(kx + 3, ky + 1, 10, 9, '#b8bcc4')
    frame.rect(kx + 8, ky + 4, 5, 3, '#202028')
    frame.polygon([
      [kx + 6, ky + 1],
      [kx + 8, ky - 5],
      [kx + 10, ky + 1]
    ], '#4cd84c')

    // Crude potion bottle in center on a plain gray rectangle
    const px = 116
    frame.rect(px - 2, GROUND_Y - 12, 16, 12, '#8a8a8a')
    frame.rect(px + 2, GROUND_Y - 24, 8, 12, '#d83030')
    frame.rect(px + 4, GROUND_Y - 28, 4, 4, '#c0c8d0')
    frame.rect(px + 4, GROUND_Y - 30, 4, 2, '#9a6a38')

    // Boxy stone golem on right (flat gray boxes, rigid 1px elevator shift)
    const gx = 172
    const gy = GROUND_Y - 36 - (f % 2)
    frame.rect(gx + 6, gy + 26, 7, 10, '#787878')
    frame.rect(gx + 19, gy + 26, 7, 10, '#787878')
    frame.rect(gx + 4, gy + 6, 24, 22, '#929292')
    frame.rect(gx - 2, gy + 10, 7, 18, '#808080')
    frame.rect(gx + 27, gy + 10, 7, 18, '#808080')
    frame.rect(gx + 4, gy + 3, 24, 4, '#45a845')
    frame.rect(gx + 9, gy + 12, 4, 4, '#30f0ff')
    frame.rect(gx + 19, gy + 12, 4, 4, '#30f0ff')
  }

  return sheet
}

// ---------------------------------------------------------------------------
// 2. AFTER SCENE — INDIE PIXEL-ART CRAFT SHOWCASE
// ---------------------------------------------------------------------------

// Unified deep twilight ink shared across all foreground materials
const INK = '#14192b'

// ---- Hero: Sprout Knight (40x40 x 4 frames, pixelClips.bipedRun) ----
function buildSproutKnightSheet() {
  const cloak = hueShiftRamp('#267686', { shadowHue: 230, highlightHue: 174 })
  const cream = hueShiftRamp('#ebe2c8', { shadowHue: 234, highlightHue: 48 })
  const leaf = hueShiftRamp('#88cc40', { shadowHue: 196, highlightHue: 58 })
  const boot = hueShiftRamp('#985c36', { shadowHue: 342, highlightHue: 44 })

  // Disciplined 13-color palette (shared INK + 4 cohesive hue-shifted ramps)
  const palette = {
    K: INK,
    c: cloak.dark,
    C: cloak.mid,
    L: cloak.light,
    t: cream.shade,
    T: cream.mid,
    W: cream.highlight,
    g: leaf.shade,
    G: leaf.mid,
    Y: leaf.highlight,
    b: boot.dark,
    B: boot.mid,
    O: boot.light
  }

  // frontLeg & backLeg parented to 'root' so grounded boots stay locked on the ground (footDriftPx <= 1)
  const rig = createPixelRig([
    { id: 'root', pivot: [0, 0] },

    // Flowing downward S-curve teal cloak (4 lush wave variants — zero horizontal carrot!)
    {
      id: 'cape',
      parent: 'torso',
      pivot: [-4, 1],
      z: -3,
      variants: {
        f0: {
          offset: [-10, -1],
          rows: [
            '........LC',
            '......LLCC',
            '....LLCCCc',
            '...LCCCcc.',
            '..LCCCc...',
            '.CCCc.....',
            'Ccc.......',
            '.c........'
          ]
        },
        f1: {
          offset: [-9, 0],
          rows: [
            '.......LCC',
            '.....LLCCc',
            '...LLCCCc.',
            '..LCCCcc..',
            '..CCCc....',
            '.CCcc.....',
            '.ccc......'
          ]
        },
        f2: {
          offset: [-11, -1],
          rows: [
            '.........LC',
            '.......LLCC',
            '.....LLCCCc',
            '...LLCCCcc.',
            '..LCCCcc...',
            '.CCCc......',
            'Ccc........'
          ]
        },
        f3: {
          offset: [-10, -2],
          rows: [
            '........LC',
            '......LLCC',
            '....LLCCCc',
            '...LCCCc..',
            '..LCCCc...',
            '.CCcc.....',
            'cc........'
          ]
        }
      }
    },

    // Back leg (deeply shaded so front/back leg crossover reads effortlessly!)
    {
      id: 'backLeg',
      parent: 'root',
      pivot: [0, 6],
      z: -2,
      variants: {
        f0: { // Extended forward heel-strike
          offset: [-2, 0],
          rows: [
            'cc....',
            '.cc...',
            '..bb..',
            '..bbb.',
            '...bbb'
          ]
        },
        f1: { // Bent knee pushing off / planted
          offset: [-2, 0],
          rows: [
            '.cc..',
            '..cc.',
            '.bb..',
            'bbb..',
            '.bbb.'
          ]
        },
        f2: { // Kicked back with bent shin & lifted heel
          offset: [-3, 0],
          rows: [
            '...cc',
            '..cc.',
            'bbb..',
            'bb...'
          ]
        },
        f3: { // Knee driving forward-up on passing
          offset: [-2, 0],
          rows: [
            '.cc..',
            '..cc.',
            '..bb.',
            '.bbb.'
          ]
        }
      }
    },

    // Cream tunic + dark belt + teal cloak shoulders
    {
      id: 'torso',
      parent: 'root',
      pivot: [0, -1],
      z: 0,
      stamp: {
        offset: [-4, -1],
        rows: [
          '.LLCCCL.',
          'LWTTTCc.',
          'WTTTTCc.',
          'WTTTTtc.',
          '.bObbcb.',
          '.WTWWtc.',
          '..ttcc..'
        ]
      }
    },

    // Front leg (lit warm brown boot + bright teal thigh) — 4 unmistakable athletic run poses!
    {
      id: 'frontLeg',
      parent: 'root',
      pivot: [0, 6],
      z: 1,
      variants: {
        f0: { // Contact: wide forward stride reaching to land on heel
          offset: [-2, 0],
          rows: [
            'CC....',
            '.CC...',
            '..OB..',
            '..OBb.',
            '...OBb'
          ]
        },
        f1: { // Down/Squash: bent knee planted directly under center of mass
          offset: [-2, 0],
          rows: [
            '.CC..',
            '..CC.',
            '.OB..',
            '.OBb.',
            '.OBbb'
          ]
        },
        f2: { // Passing: front leg kicked sharply behind with lifted boot
          offset: [-3, 0],
          rows: [
            '...CC',
            '..CC.',
            'OBb..',
            'OB...'
          ]
        },
        f3: { // Up/Stretch: high forward knee-drive with lifted toe!
          offset: [-1, 0],
          rows: [
            'CC...',
            '.CCC.',
            '..OBb',
            '..OB.'
          ]
        }
      }
    },

    // Oversized expressive indie knight hood-helm with dark visor recess
    {
      id: 'head',
      parent: 'torso',
      pivot: [0, -6],
      z: 2,
      stamp: {
        offset: [-5, -5],
        rows: [
          '..WWWWW...',
          '.WWTTTTt..',
          'WTTtKKKKt.',
          'WTtKKKKKK.',
          'WTtKKKKKK.',
          'WTTtKKKKt.',
          '.ttTTTTt..',
          '..LLCCc...'
        ]
      }
    },

    // Sprouting twin gold-green leaves atop the helm (4 distinct squash/drag/bounce variants!)
    {
      id: 'crest',
      parent: 'head',
      pivot: [-1, -5],
      z: 3,
      variants: {
        f0: { // Contact: swept slightly back
          offset: [-5, -5],
          rows: [
            'YY........',
            '.YYG..YY..',
            '..GGgYGg..',
            '....ggG...',
            '.....g....'
          ]
        },
        f1: { // Squash: compressed low & wide
          offset: [-5, -4],
          rows: [
            'YYG...YY..',
            '.GGg.YGg..',
            '...ggGg...',
            '....gg....'
          ]
        },
        f2: { // Passing: upright perked leaves
          offset: [-4, -6],
          rows: [
            '..YY..Y...',
            '.YGG.YG...',
            '..GGgGg...',
            '...ggG....',
            '....g.....'
          ]
        },
        f3: { // Stretch: tall lively bounce!
          offset: [-4, -7],
          rows: [
            '.YY...YY..',
            '.YGG.YGG..',
            '..GGgGGg..',
            '...gGGg...',
            '....gg....',
            '....g.....'
          ]
        }
      }
    },

    // Front swinging arm (4 distinct counter-swing poses)
    {
      id: 'frontArm',
      parent: 'torso',
      pivot: [1, 2],
      z: 4,
      variants: {
        f0: {
          offset: [-4, -1],
          rows: [
            '..LC',
            '.LCc',
            'OBc.'
          ]
        },
        f1: {
          offset: [-2, -1],
          rows: [
            'LC.',
            'LCc',
            'OB.'
          ]
        },
        f2: {
          offset: [-1, -1],
          rows: [
            'LC..',
            '.LCc',
            '..OB'
          ]
        },
        f3: {
          offset: [-3, -2],
          rows: [
            '..LC',
            '.LCc',
            'OB..'
          ]
        }
      }
    },

    // Round wooden & brass-rimmed buckler shield
    {
      id: 'shield',
      parent: 'frontArm',
      pivot: [3, 1],
      z: 5,
      stamp: {
        offset: [-2, -3],
        rows: [
          '.OYO.',
          'OOBBb',
          'OBOBb',
          'OBBBb',
          '.bBb.'
        ]
      }
    }
  ])

  const sheet = createSpriteSheet(40, 40, FRAMES)
  const poses = pixelClips.bipedRun(4, { stride: 3, bob: 1 })

  for (let f = 0; f < FRAMES; f++) {
    const frame = sheet.frame(f)
    renderPixelRig(frame, rig, [21, 25], poses[f], palette, {
      outline: 'selout',
      postDraw: (fr, joints) => {
        // Crisp glowing amber-cream eyes inside the recessed dark visor
        const hx = Math.round(joints.head.x)
        const hy = Math.round(joints.head.y)
        fr.pixel(hx + 1, hy - 2, leaf.highlight)
        fr.pixel(hx + 1, hy - 1, cream.highlight)
        fr.pixel(hx + 4, hy - 2, leaf.highlight)
        fr.pixel(hx + 4, hy - 1, cream.highlight)
      }
    })
  }

  return sheet
}

// ---- Collectible: Shimmering Ruby-Amber Potion Flask (24x24 x 4 frames) ----
function buildPotionSheet() {
  const glass = hueShiftRamp('#88b6d6', { shadowHue: 232, highlightHue: 198 })
  const ruby = hueShiftRamp('#e03e4b', { shadowHue: 332, highlightHue: 44 })
  const cork = hueShiftRamp('#a87042', { shadowHue: 342, highlightHue: 46 })

  const palette = {
    K: INK,
    k: cork.dark,
    C: cork.mid,
    c: cork.light,
    g: glass.dark,
    G: glass.mid,
    I: glass.highlight,
    d: ruby.dark,
    s: ruby.shade,
    R: ruby.mid,
    A: ruby.light,
    Y: ruby.highlight,
    W: '#fff9ea'
  }

  const baseFlask = [
    '....cC....',
    '....Ck....',
    '...IGGg...',
    '....Gg....',
    '...gGGg...',
    '..gIggGg..',
    '.gIAYYAgg.',
    '.gIRRRRsG.',
    'gIARRRRsdg',
    'gIRRRRRsdg',
    'gIRRRRssdg',
    '.gRRRRsdg.',
    '..gsssddg.',
    '...ggggg..'
  ]

  const sheet = createSpriteSheet(24, 24, FRAMES)
  for (let f = 0; f < FRAMES; f++) {
    const frame = sheet.frame(f)
    frame.stamp(7, 6, baseFlask, palette)

    if (f === 0) {
      frame.pixel(10, 12, palette.W)
      frame.pixel(11, 12, palette.Y)
      frame.pixel(12, 16, palette.A)
      frame.pixel(13, 16, palette.Y)
      frame.pixel(12, 17, palette.A)
    } else if (f === 1) {
      frame.pixel(11, 12, palette.W)
      frame.pixel(12, 12, palette.W)
      frame.pixel(11, 15, palette.Y)
      frame.pixel(12, 15, palette.W)
      frame.pixel(11, 14, palette.A)
      frame.pixel(9, 13, palette.W)
      frame.pixel(10, 12, palette.W)
    } else if (f === 2) {
      frame.pixel(12, 12, palette.W)
      frame.pixel(13, 12, palette.Y)
      frame.pixel(12, 13, palette.W)
      frame.pixel(13, 13, palette.Y)
      frame.pixel(10, 14, palette.W)
      frame.pixel(11, 13, palette.Y)
    } else {
      frame.pixel(10, 12, palette.Y)
      frame.pixel(11, 12, palette.W)
      frame.pixel(9, 15, palette.W)
      frame.pixel(10, 16, palette.Y)
      frame.pixel(13, 17, palette.A)
    }

    frame.outline('selout', { palette })

    // Floating cross-sparkles drawn AFTER selout (clean, bright, no dark ink rings!)
    if (f === 0) {
      frame.glint(5, 9, palette.W, palette.Y, 3)
      frame.glint(19, 15, palette.Y, palette.A, 3)
    } else if (f === 1) {
      frame.glint(5, 9, palette.W, palette.I, 5)
      frame.glint(18, 8, palette.W, palette.Y, 3)
    } else if (f === 2) {
      frame.glint(18, 8, palette.W, palette.Y, 5)
      frame.glint(5, 16, palette.Y, palette.A, 3)
    } else {
      frame.glint(19, 14, palette.W, palette.I, 5)
      frame.glint(6, 8, palette.Y, palette.I, 3)
    }
  }

  return sheet
}

// ---- Foe: Ancient Moss Golem (48x48 x 4 frames, pixelClips.heavyBreathe) ----
function buildMossGolemSheet() {
  const stone = hueShiftRamp('#687690', { shadowHue: 236, highlightHue: 44 })
  const moss = hueShiftRamp('#5fa849', { shadowHue: 204, highlightHue: 66 })
  const rune = hueShiftRamp('#3be4f2', { shadowHue: 214, highlightHue: 184 })

  // 13 colors total (strict <= 14 palette)
  const palette = {
    K: INK,
    d: stone.dark,
    s: stone.shade,
    S: stone.mid,
    L: stone.light,
    H: stone.highlight,
    m: moss.dark,
    M: moss.mid,
    G: moss.light,
    Y: moss.highlight,
    c: rune.shade,
    C: rune.mid,
    W: rune.highlight
  }

  // Grounded stone legs/feet AND heavy boulder fists stay 100% PLANTED on root (footDriftPx === 0!)
  // while the broad hunched stone shoulders & torso connect cleanly into both hips and upper arms
  // with crisp 2-3px carved armpit negative space — ZERO floating detached limbs!
  const rig = createPixelRig([
    { id: 'root', pivot: [0, 0] },

    // Grounded chunky stone legs & planted feet (extend up into pelvis so 0..2px heave never gaps!)
    {
      id: 'feet',
      parent: 'root',
      pivot: [0, 6],
      z: -1,
      stamp: {
        offset: [-9, 0],
        rows: [
          '..LSSsd....LSSsd..',
          '..LSSsd....LSSsd..',
          '.LLSSsd....LSSsdd.',
          '.LLSSsdd...LSSsdd.',
          '.LSSSsd....LSSsdd.',
          '.LSSSsd....LSSsdd.',
          'LLSSSsd...LLSSssdd',
          'HLLSSsdd..HLLSSsdd',
          'LLSSSssd..LLSSSssd',
          'sSSSSssd..sSSSSssd',
          '.ssssdd....ssssdd.'
        ]
      }
    },

    // Massive hunched weathered slate torso & broad shoulder pauldrons connecting cleanly to planted arms,
    // tapering cleanly at waist to preserve bold armpit negative space!
    {
      id: 'torso',
      parent: 'root',
      pivot: [0, 0],
      z: 0,
      stamp: {
        offset: [-14, -12],
        rows: [
          '......HLLLLLLSSSSd..........',
          '....HLLLLLSSSSSSSSsd........',
          '..HLLLLLSSSSKSSSSSSssd......',
          '.HLLLLSSSdSSKSSSSSSssdd.....',
          'HLLLSSd.LSSSSSSSSssKssdd....',
          'HLLSSd..LSSSSSSSSssKssddd...',
          'LLSSd...LSSSSSSSSssssd.sdd..',
          'LSSd.....LLSSSSSSsssd...sdd.',
          'LSS.......LSSSSSSssd.....sd.',
          '..........LSSSSSSsd.........',
          '..........LSSKSSssd.........',
          '..........LSSKSSsdd.........',
          '..........LLSSSSsdd.........',
          '...........LSSssdd..........',
          '...........LSSssdd..........',
          '...........sSSsddd..........',
          '...........ssd.sdd..........',
          '...........ssd.sdd..........'
        ]
      }
    },

    // Heavy planted LEFT boulder arm & knuckle-fist anchored right on the ground!
    // Top of forearm overlaps seamlessly inside torso's left shoulder across 0..-2px heave.
    {
      id: 'leftArm',
      parent: 'root',
      pivot: [-13, -6],
      z: 2,
      stamp: {
        offset: [-4, 0],
        rows: [
          '..HLLSd.',
          '.HLLSSd.',
          '.LLSSsd.',
          '.LSSssd.',
          'LLSSssd.',
          'LSSKssd.',
          'LSSssdd.',
          'LSSssdd.',
          'HLLSSsdd',
          'HLLSSsdd',
          'LLSSssdd',
          'LLSSssdd',
          'LSSKssdd',
          'LSSSssdd',
          'LSSSssdd',
          'sSSSssdd',
          'sSSSssdd',
          'sSSsssdd',
          '.ssssdd.'
        ]
      }
    },

    // Heavy planted RIGHT boulder arm & knuckle-fist anchored solidly on the ground!
    {
      id: 'rightArm',
      parent: 'root',
      pivot: [13, -7],
      z: 2,
      stamp: {
        offset: [-4, 0],
        rows: [
          'LLSSd...',
          'LLSSsd..',
          '.LLSSd..',
          '.LSSsd..',
          '.LSSssd.',
          '..SSssd.',
          '..SSKsd.',
          '..SSsdd.',
          '.LSSsdd.',
          '.LSSsdd.',
          'LLSSssdd',
          'LLSSssdd',
          'LSSKssdd',
          'LSSSssdd',
          'LSSSssdd',
          'sSSSssdd',
          'sSSSssdd',
          'sSSsssdd',
          'sssssdd.',
          '.ssssd..'
        ]
      }
    },

    // Recessed weathered stone brow & glowing cyan rune eyes (dim -> mid -> bright)
    {
      id: 'head',
      parent: 'torso',
      pivot: [-1, -10],
      z: 4,
      variants: {
        dim: {
          offset: [-6, -4],
          rows: [
            '..HLLLSSd...',
            '.HLLSSSSsd..',
            '.LLKKKKKKd..',
            '.LKcCKKcCK..',
            '.LLKKKKKKd..',
            '..LSSSSsd...'
          ]
        },
        mid: {
          offset: [-6, -4],
          rows: [
            '..HLLLSSd...',
            '.HLLSSSSsd..',
            '.LLKKKKKKd..',
            '.LKCWKKCWK..',
            '.LLKKKKKKd..',
            '..LSSSSsd...'
          ]
        },
        bright: {
          offset: [-6, -4],
          rows: [
            '..HLLLSSd...',
            '.HLLSSSSsd..',
            '.LLKcKKcKd..',
            '.LKWWKKWWK..',
            '.LLKcKKcKd..',
            '..LSSSSsd...'
          ]
        }
      }
    },

    // Lush sunlit moss mantle draping over brow & both hunched shoulders (framing both glowing eyes cleanly!)
    {
      id: 'moss',
      parent: 'torso',
      pivot: [-1, -14],
      z: 5,
      variants: {
        f0: {
          offset: [-14, -4],
          rows: [
            '.......YYYGGMM..............',
            '.....YYGGGGMMMm.............',
            '...YYGGMMMMMMMmmm.YYGM......',
            '..YGGMMm......mMMYGGMMm.....',
            '.YGGMm..........mMGGMMMm....',
            '.GGMm............mMMm.mm....',
            '.GMm..............mm........',
            '.Gm.........................',
            '.m..........................'
          ]
        },
        f1: {
          offset: [-14, -4],
          rows: [
            '.......YYYGGMM..............',
            '.....YYGGGGMMMm.............',
            '...YYGGMMMMMMMmmm.YYGM......',
            '..YGGMMm......mMMYGGMMm.....',
            '.YGGMm..........mMGGMMMm....',
            '..GGMm...........mMMm.mm....',
            '..GMm.............mm........',
            '..Gm........................',
            '..m.........................'
          ]
        },
        f2: {
          offset: [-14, -4],
          rows: [
            '......YYYYGGMM..............',
            '.....YYGGGGMMMm.............',
            '...YYGGMMMMMMMmm.YYYGM......',
            '..YGGMMm......mMMYGGMMm.....',
            '.YGGMm..........mMGGMMMm....',
            '..GGMm..........mMMm..mm....',
            '...GMm...........mm.........',
            '...Gm.......................',
            '...m........................'
          ]
        }
      }
    },

    // Ancient carved cyan chest rune pulsing with inhale heave
    {
      id: 'rune',
      parent: 'torso',
      pivot: [-1, -2],
      z: 3,
      variants: {
        dim: {
          offset: [-3, -3],
          rows: [
            '..c..',
            '.cCc.',
            '..C..',
            '.cCc.',
            '..c..'
          ]
        },
        mid: {
          offset: [-3, -3],
          rows: [
            '..C..',
            '.CWC.',
            '..W..',
            '.CWC.',
            '..C..'
          ]
        },
        bright: {
          offset: [-3, -3],
          rows: [
            '.cCc.',
            'cCWCc',
            '.CWC.',
            'cCWCc',
            '.cCc.'
          ]
        }
      }
    }
  ])

  const sheet = createSpriteSheet(48, 48, FRAMES)
  const poses = pixelClips.heavyBreathe(4, { heave: 2 })

  for (let f = 0; f < FRAMES; f++) {
    const frame = sheet.frame(f)
    renderPixelRig(frame, rig, [25, 29], poses[f], palette, {
      outline: 'selout',
      postDraw: (fr, joints) => {
        if (f === 2) {
          const rx = Math.round(joints.rune.x) - 1
          const ry = Math.round(joints.rune.y) - 1
          fr.pixel(rx, ry, rune.highlight)
        }
      }
    })
  }

  return sheet
}

// ---- Ordered Bayer 4x4 dithering helper (used ONLY on narrow band seams, never harsh full-screen noise) ----
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
]

function drawTwilightSky(frame, skyColors) {
  // Clean indie pixel-art sky bands (Celeste / Hyper Light Drifter style):
  // mostly solid luminous bands with gentle 6px dither transitions at band seams!
  const stops = [0, 16, 34, 52, 68, 82, GROUND_Y]
  const seam = 6
  for (let y = 0; y < GROUND_Y; y++) {
    let bi = 0
    while (bi < stops.length - 2 && y >= stops[bi + 1]) bi++
    const yEnd = stops[bi + 1]
    const colA = skyColors[bi]
    const colB = skyColors[Math.min(bi + 1, skyColors.length - 1)]
    const distToSeam = yEnd - y
    if (bi < skyColors.length - 1 && distToSeam <= seam) {
      const t = (seam - distToSeam + 0.5) / seam
      for (let x = 0; x < SCENE_W; x++) {
        // Gentle 2x2 / 4x4 Bayer only in the narrow seam strip
        const th = (BAYER4[y & 3][x & 3] + 0.5) / 16
        frame.pixel(x, y, t > th ? colB : colA)
      }
    } else {
      for (let x = 0; x < SCENE_W; x++) {
        frame.pixel(x, y, colA)
      }
    }
  }
}

function drawTwilightMoonAndClouds(frame, f) {
  // Crisp crescent moon — pixel-masked so the real sky shows cleanly through the crescent cutout!
  const mx = 34, my = 18
  // Soft warm atmospheric halo around moon
  frame.circle(mx, my, 9.5, '#fae2b814')
  frame.circle(mx, my, 6.8, '#fae2b822')
  for (let py = my - 6; py <= my + 6; py++) {
    for (let px = mx - 6; px <= mx + 6; px++) {
      const dMain = Math.hypot(px - mx, py - my)
      const dCut = Math.hypot(px - (mx + 2.3), py - (my - 1.0))
      if (dMain <= 4.8 && dCut > 4.2) {
        frame.pixel(px, py, dMain > 3.6 && px < mx ? '#fff7dc' : '#f2d39c')
      }
    }
  }

  // Handcrafted multi-lobe dusk clouds (warm peach sunlit underbelly, dusky violet shadow top)
  const drift = f
  const cloudStamps = [
    {
      x: 68 - drift, y: 24,
      rows: [
        '.....ddddd...........',
        '...ddmmmmmddd..ddd...',
        '.ddmmmmmmmmmmddmmmdd.',
        'mmmmmmmmmmmmmmmmmmmmm',
        '.ppppppppppppppppppp.',
        '...pppppp...pppppp...'
      ]
    },
    {
      x: 152 - drift, y: 17,
      rows: [
        '.......dddddd........',
        '....dddmmmmmmddd.....',
        '..ddmmmmmmmmmmmmdd...',
        '.mmmmmmmmmmmmmmmmmm..',
        '..pppppppppppppppp...'
      ]
    },
    {
      x: 198 - drift, y: 36,
      rows: [
        '....ddddd.....',
        '..ddmmmmmddd..',
        '.mmmmmmmmmmmm.',
        '..pppppppppp..'
      ]
    }
  ]
  const cloudPal = {
    d: '#433b6688',
    m: '#624d78aa',
    p: '#ba7e7c99'
  }
  for (const c of cloudStamps) {
    frame.stamp(c.x, c.y, c.rows, cloudPal)
  }

  // Gentle twinkling stars high in the indigo zenith
  const stars = [
    [12, 8], [58, 10], [92, 6], [118, 14], [142, 7], [174, 9], [208, 12], [228, 18]
  ]
  for (let i = 0; i < stars.length; i++) {
    const [sx, sy] = stars[i]
    const bright = (i + f) % 4 === 0
    frame.pixel(sx, sy, bright ? '#fff0c8dd' : '#c6c2e288')
    if (bright) {
      frame.pixel(sx - 1, sy, '#fff0c83a')
      frame.pixel(sx + 1, sy, '#fff0c83a')
    }
  }
}

function drawParallaxRidgesAndForest(frame, f) {
  // Layer 1: Distant twilight mountain ridge silhouettes (muted low-contrast lavender-slate)
  const shift1 = Math.floor(f * 0.5)
  for (let x = 0; x < SCENE_W; x++) {
    const wx = x + shift1
    const ridgeH =
      Math.sin(wx * 0.024) * 11 +
      Math.sin(wx * 0.062 + 1.4) * 4.5 +
      Math.cos(wx * 0.015 + 0.5) * 6.5
    const topY = Math.round(62 - ridgeH)
    for (let y = topY; y < GROUND_Y; y++) {
      if (y === topY) {
        frame.pixel(x, y, '#7c648a')
      } else if (y < topY + 3) {
        frame.pixel(x, y, '#534972')
      } else {
        frame.pixel(x, y, '#3f3b62')
      }
    }
  }

  // Layer 2: Mid-distance pine forest treeline + weathered distant stone archway
  const shift2 = f
  for (let x = 0; x < SCENE_W; x++) {
    const wx = x + shift2
    const base = Math.round(79 + Math.sin(wx * 0.045) * 3 + Math.cos(wx * 0.09) * 2)
    for (let y = base; y < GROUND_Y; y++) {
      frame.pixel(x, y, '#2b3354')
    }
  }

  // Varied organic pine silhouettes (opening up behind the glade centerpiece so horizon glows through!)
  const pines = [
    { x: 6, h: 25, w: 9 }, { x: 19, h: 31, w: 11 }, { x: 34, h: 22, w: 9 },
    { x: 47, h: 26, w: 10 }, { x: 76, h: 19, w: 8 }, { x: 90, h: 23, w: 9 },
    { x: 148, h: 22, w: 9 }, { x: 163, h: 28, w: 11 }, { x: 177, h: 20, w: 8 },
    { x: 204, h: 27, w: 10 }, { x: 220, h: 32, w: 12 }, { x: 235, h: 24, w: 9 }
  ]
  for (const p of pines) {
    const px = p.x - shift2
    const baseY = 86
    const tipY = baseY - p.h
    for (let row = 0; row < p.h; row++) {
      const y = tipY + row
      const tier = row % 6
      const progress = row / p.h
      const halfW = Math.max(0, Math.round(progress * (p.w * 0.65) + (tier >= 4 ? 1 : 0) - (tier === 0 ? 1 : 0)))
      for (let dx = -halfW; dx <= halfW; dx++) {
        const col = dx <= -halfW + 1 && row > 2 ? '#414c72' : '#262e4d'
        frame.pixel(px + dx, y, col)
      }
    }
  }

  // Handcrafted weathered distant ruin archway in the clearing (left of potion pedestal)
  const archX = 91 - shift2
  const archStamp = [
    '..LLLLssssss....',
    '.LLLssssssssd...',
    'LLssssssssdd....',
    '.LLssdd..dd.....',
    '.Lssdd..........',
    '.Lssdd....LLss..',
    '.Lssdd...LLsssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    '.Lssdd...Lssssd.',
    'LLssddd.LLssssdd',
    'Lsssddd.Lsssssdd'
  ]
  frame.stamp(archX, GROUND_Y - 22, archStamp, {
    L: '#626288',
    s: '#3b4166',
    d: '#282d4a'
  })

  // Layer 3: Clean, silky translucent glade mist band (ZERO noisy dot grid!)
  // Softly lifts the background luminance behind the characters' feet & silhouettes.
  for (let y = 78; y < GROUND_Y; y++) {
    const t = (y - 78) / (GROUND_Y - 78)
    const aHex = Math.round(t * 48).toString(16).padStart(2, '0')
    for (let x = 0; x < SCENE_W; x++) {
      frame.pixel(x, y, `#d8a89c${aHex}`)
    }
  }
  // 3 gentle horizontal drifting mist ribbons right above the mossy floor
  const ribbons = [
    { x: 18 + f * 2, y: 89, w: 46 },
    { x: 96 + f * 2, y: 86, w: 54 },
    { x: 168 + f * 2, y: 90, w: 50 }
  ]
  for (const r of ribbons) {
    for (let dx = 0; dx < r.w; dx++) {
      const edge = Math.min(dx, r.w - 1 - dx)
      const alpha = edge < 5 ? '18' : '2c'
      frame.pixel(r.x + dx, r.y, `#f2c8b4${alpha}`)
      if (edge > 6) frame.pixel(r.x + dx, r.y + 1, `#e4b2a61e`)
    }
  }
}

function drawBackgroundRuinProps(frame) {
  const st = hueShiftRamp('#525b74', { shadowHue: 236, highlightHue: 40 })
  const ms = hueShiftRamp('#4d8048', { shadowHue: 206, highlightHue: 64 })
  const propPal = {
    L: st.light,
    S: st.mid,
    s: st.shade,
    d: st.dark,
    g: ms.light,
    G: ms.mid,
    M: ms.shade,
    m: ms.dark
  }

  // Weathered mossy ruin pillar on left (grounded cleanly at GROUND_Y)
  const leftPillar = [
    '..LLSSS...',
    '.LLSSSSd..',
    '.gGMMSSd..',
    '.GMmSSsd..',
    '.gM.SSsd..',
    '.LLSSSSd..',
    '.LSSdSsd..',
    '.LSSdSsd..',
    '.LSSSSsd..',
    '.LLSSssd..',
    '.LSSdssd..',
    '.LSSSSsd..',
    '.LLSSssd..',
    '.LSSSSsd..',
    'LLSSSSsdd.',
    'LSSSSssdd.'
  ]
  frame.ellipse(20, GROUND_Y, 8, 2, '#14192b55')
  frame.stamp(14, GROUND_Y - 16, leftPillar, propPal)

  // Ancient mossy obelisk on far right behind golem
  const rightObelisk = [
    '...LS....',
    '..LSSd...',
    '..gGsd...',
    '.LLSSsd..',
    '.gGMssd..',
    '.LMmssd..',
    '.LSSssd..',
    '.LSSdssd.',
    '.LSSdssd.',
    '.LSSSssd.',
    '.LSSSssd.',
    '.LLSSssd.',
    '.LSSSssd.',
    '.LSSSssd.',
    'LLSSSSsdd',
    'LSSSSssdd'
  ]
  frame.ellipse(224, GROUND_Y, 7, 2, '#14192b55')
  frame.stamp(219, GROUND_Y - 16, rightObelisk, propPal)
}

function drawMossyPedestal(frame, cx) {
  const st = hueShiftRamp('#636d86', { shadowHue: 236, highlightHue: 44 })
  const ms = hueShiftRamp('#5d994a', { shadowHue: 204, highlightHue: 66 })
  const pal = {
    K: INK,
    H: st.highlight,
    L: st.light,
    S: st.mid,
    s: st.shade,
    d: st.dark,
    Y: ms.highlight,
    G: ms.light,
    M: ms.mid,
    m: ms.dark
  }
  const pedestal = [
    '.HLLLLLLLLSSSd..',
    'HLLYGMMSSSSssdd.',
    '.KddMmSSSSssddK.',
    '...KLSSSSssdK...',
    '...KLSSdSssdK...',
    '...KLSdSSssdK...',
    '...KLSSSSssdK...',
    '...KLSSdSssdK...',
    '..KLLSSSSssddK..',
    '.KLLLSSSSsssddK.',
    'KLLLLSSSSssssddK'
  ]
  frame.ellipse(cx, GROUND_Y, 11, 2, '#14192b88')
  frame.stamp(cx - 8, GROUND_Y - 11, pedestal, pal)
}

function drawMossyStoneGround(frame) {
  const moss = hueShiftRamp('#5c9648', { shadowHue: 208, highlightHue: 66 })
  const stone = hueShiftRamp('#58627a', { shadowHue: 236, highlightHue: 42 })
  const earth = hueShiftRamp('#2f3048', { shadowHue: 244, highlightHue: 34 })

  frame.rect(0, GROUND_Y, SCENE_W, SCENE_H - GROUND_Y, earth.dark)

  // Staggered beveled cobblestone courses spanning the FULL 240px width cleanly!
  const courses = [
    { y: GROUND_Y + 4, h: 8, offset: 0, widths: [18, 14, 20, 16, 15, 19, 14, 18] },
    { y: GROUND_Y + 12, h: 8, offset: -9, widths: [16, 20, 15, 18, 17, 14, 21, 15] },
    { y: GROUND_Y + 20, h: 8, offset: -4, widths: [19, 15, 17, 20, 14, 18, 16, 20] }
  ]

  courses.forEach((course, ci) => {
    let x = course.offset
    let bi = 0
    while (x < SCENE_W) {
      const w = course.widths[bi % course.widths.length]
      const x0 = x
      const x1 = x + w - 1
      const y0 = course.y
      const y1 = course.y + course.h - 1
      const hi = ci === 0 ? stone.light : ci === 1 ? stone.mid : stone.shade
      const mid = ci === 0 ? stone.mid : ci === 1 ? stone.shade : stone.dark
      const sh = ci === 0 ? stone.shade : ci === 1 ? stone.dark : earth.dark
      const mortar = ci === 2 ? INK : stone.ink

      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          if (px < 0 || px >= SCENE_W || py >= SCENE_H) continue
          const isMortar = px === x1 || py === y1 || (px === x0 && py === y0)
          if (isMortar) {
            frame.pixel(px, py, mortar)
          } else if (py === y0 || (px === x0 && py < y1 - 1)) {
            frame.pixel(px, py, hi)
          } else if (py === y1 - 1 || px === x1 - 1) {
            frame.pixel(px, py, sh)
          } else {
            frame.pixel(px, py, mid)
          }
        }
      }
      // Weathered stone cracks & tiny moss specks tucked into crevices
      if ((bi + ci) % 3 === 1 && x0 + 5 >= 0 && x0 + 7 < SCENE_W) {
        frame.pixel(x0 + 5, y0 + 2, sh)
        frame.pixel(x0 + 6, y0 + 3, mortar)
        frame.pixel(x0 + 7, y0 + 3, sh)
      }
      if (ci === 1 && bi % 4 === 2 && x0 + 1 >= 0 && x0 + 2 < SCENE_W) {
        frame.pixel(x0 + 1, y0, moss.shade)
        frame.pixel(x0 + 2, y0, moss.dark)
      }
      x += w
      bi++
    }
  })

  // Clean deep subterranean twilight soil at bottom (y = GROUND_Y + 28 .. SCENE_H - 1)
  frame.rect(0, GROUND_Y + 28, SCENE_W, 4, earth.dark)
  frame.rect(0, GROUND_Y + 32, SCENE_W, SCENE_H - (GROUND_Y + 32), INK)
  // Soft 2px transition seam
  for (let x = 0; x < SCENE_W; x++) {
    if (x % 2 === 0) frame.pixel(x, GROUND_Y + 31, INK)
    if (x % 4 === 1) frame.pixel(x, GROUND_Y + 28, stone.ink)
  }

  // Lush overhanging mossy grass top lip (y = GROUND_Y .. GROUND_Y + 7)
  for (let x = 0; x < SCENE_W; x++) {
    const tuft = Math.floor(Math.sin(x * 0.37) * 1.4 + Math.cos(x * 0.83) * 1.1 + 2.2)
    const crest = (x % 7 === 1 || x % 7 === 2 || x % 11 === 4)
    frame.pixel(x, GROUND_Y, crest ? moss.highlight : moss.light)
    frame.pixel(x, GROUND_Y + 1, crest ? moss.light : moss.mid)
    frame.pixel(x, GROUND_Y + 2, moss.mid)
    frame.pixel(x, GROUND_Y + 3, moss.shade)

    for (let d = 0; d < tuft; d++) {
      const py = GROUND_Y + 4 + d
      frame.pixel(x, py, d === tuft - 1 ? moss.dark : moss.shade)
    }
    frame.pixel(x, GROUND_Y + 4 + tuft, INK)
  }

  // Sunlit grass tufts along open patches of the glade floor
  for (let x = 4; x < SCENE_W - 4; x += 9) {
    if ((x > 50 && x < 84) || (x > 112 && x < 134) || (x > 164 && x < 208)) continue
    frame.pixel(x, GROUND_Y - 1, moss.light)
    if (x % 2 === 0) frame.pixel(x + 1, GROUND_Y - 1, moss.mid)
    if (x % 3 === 0) frame.pixel(x, GROUND_Y - 2, moss.highlight)
  }
}

function drawDustPuffs(frame, knightX, f) {
  const puffLight = '#f4e8d2cc'
  const puffMid = '#cbb6aa88'
  const puffFaint = '#a4909855'

  // Lead puff kicking right behind back boot
  const px1 = knightX - 9 - (f % 2) * 2
  const py1 = GROUND_Y - 2 - (f % 2)
  frame.ellipse(px1, py1, 2.5, 1.8, puffLight)
  frame.pixel(px1 - 1, py1 + 1, puffMid)

  // Secondary puff rising and trailing back
  const px2 = knightX - 15 - f * 1.5
  const py2 = GROUND_Y - 4 - (f % 3)
  frame.ellipse(px2, py2, 2.0, 1.4, puffMid)

  // Soft fading wisp farthest behind
  const px3 = knightX - 21 - f
  const py3 = GROUND_Y - 6 - ((f + 1) % 3)
  frame.pixel(px3, py3, puffFaint)
  frame.pixel(px3 + 1, py3, puffFaint)
}

function drawFirefliesAndForeground(frame, f) {
  const fireflies = [
    { x: 34, y: 52, dx: 2, dy: -1, bigPhase: 0 },
    { x: 86, y: 44, dx: -1, dy: -2, bigPhase: 2 },
    { x: 108, y: 36, dx: 1, dy: 1, bigPhase: 1 },
    { x: 148, y: 48, dx: -2, dy: -1, bigPhase: 3 },
    { x: 164, y: 30, dx: 1, dy: 1, bigPhase: 0 },
    { x: 212, y: 56, dx: -1, dy: -1, bigPhase: 2 },
    { x: 46, y: 74, dx: 2, dy: 0, bigPhase: 1 },
    { x: 142, y: 76, dx: -1, dy: -1, bigPhase: 3 }
  ]

  for (let i = 0; i < fireflies.length; i++) {
    const ff = fireflies[i]
    const angle = (f / FRAMES) * Math.PI * 2 + i * 1.1
    const fx = Math.round(ff.x + Math.cos(angle) * 3 + ff.dx * (f - 1.5) * 0.4)
    const fy = Math.round(ff.y + Math.sin(angle) * 2.5)
    const isBig = f === ff.bigPhase
    frame.circle(fx, fy, isBig ? 3.2 : 2.0, '#ffd87a24')
    frame.glint(fx, fy, '#fffbe0', isBig ? '#f5b942bb' : '#f5b94288', isBig ? 5 : 3)
  }

  // Foreground grass blades framing bottom-left & bottom-right corners
  const fgDark = '#182538'
  const fgMid = '#2b5248'
  const fgLit = '#64a34c'

  const leftBlades = [
    [2, 10], [5, 13], [8, 8], [12, 11], [16, 7], [21, 9], [25, 6]
  ]
  for (const [bx, h] of leftBlades) {
    for (let i = 0; i < h; i++) {
      const lean = Math.floor((i * i) / (h * 2.6))
      const y = GROUND_Y + 4 - i
      frame.pixel(bx + lean, y, i >= h - 2 ? fgLit : i >= h - 5 ? fgMid : fgDark)
      if (i < h - 3) frame.pixel(bx + lean + 1, y, fgDark)
    }
  }

  const rightBlades = [
    [237, 11], [234, 14], [230, 9], [226, 12], [222, 8], [217, 10], [213, 6]
  ]
  for (const [bx, h] of rightBlades) {
    for (let i = 0; i < h; i++) {
      const lean = -Math.floor((i * i) / (h * 2.6))
      const y = GROUND_Y + 4 - i
      frame.pixel(bx + lean, y, i >= h - 2 ? fgLit : i >= h - 5 ? fgMid : fgDark)
      if (i < h - 3) frame.pixel(bx + lean - 1, y, fgDark)
    }
  }
}

function buildAfterScene() {
  const knightSheet = buildSproutKnightSheet()
  const potionSheet = buildPotionSheet()
  const golemSheet = buildMossGolemSheet()

  const knightAudit = auditSpriteSheet(knightSheet, { maxColors: 14, maxFillRatio: 0.56, maxFootDriftPx: 1 })
  const potionAudit = auditSpriteSheet(potionSheet, { maxColors: 14, maxFillRatio: 0.56 })
  const golemAudit = auditSpriteSheet(golemSheet, { maxColors: 14, maxFillRatio: 0.56, maxFootDriftPx: 0 })

  console.log('Sprite Audits:')
  console.log('  Sprout Knight:', JSON.stringify(knightAudit))
  console.log('  Potion Flask :', JSON.stringify(potionAudit))
  console.log('  Moss Golem   :', JSON.stringify(golemAudit))

  // Cohesive twilight-glade sky ramp built from hueShiftRamp
  const skyIndigo = hueShiftRamp('#28325c', { shadowHue: 244, highlightHue: 32 })
  const skyDusk = hueShiftRamp('#68507d', { shadowHue: 252, highlightHue: 22 })
  const horizonGlow = hueShiftRamp('#df966d', { shadowHue: 340, highlightHue: 46 })
  const skyColors = [
    skyIndigo.shade,    // deep twilight indigo zenith
    skyIndigo.mid,      // upper indigo
    skyDusk.shade,      // dusk violet
    skyDusk.mid,        // muted plum
    '#b1747b',          // warm dusk rose
    horizonGlow.light   // warm peach-amber horizon glow
  ]

  const scene = createSpriteSheet(SCENE_W, SCENE_H, FRAMES)

  for (let f = 0; f < FRAMES; f++) {
    const frame = scene.frame(f)

    // 1. Twilight sky + crisp crescent moon + multi-lobe dusk clouds + twinkling stars
    drawTwilightSky(frame, skyColors)
    drawTwilightMoonAndClouds(frame, f)

    // 2. 3 parallax layers (distant ridges, mid pines + weathered arch, silky mist band)
    drawParallaxRidgesAndForest(frame, f)

    // 3. Foreground mossy-stone ground tiles
    drawMossyStoneGround(frame)

    // 4. Environmental mossy ruins & center pedestal
    drawBackgroundRuinProps(frame)
    const pedestalX = 122
    drawMossyPedestal(frame, pedestalX)

    // 5. Collectible: Shimmering Potion Flask with warm radial halo & 1px bob
    const potionBob = [0, -1, 0, 1][f]
    const potionX = pedestalX - 12
    const potionY = GROUND_Y - 32 + potionBob
    const hcx = pedestalX
    const hcy = GROUND_Y - 19 + potionBob
    frame.circle(hcx, hcy, 11.5, '#e8686a18')
    frame.circle(hcx, hcy, 7.5, '#ff9f6a28')
    frame.circle(hcx, hcy, 4.5, '#ffd08826')
    blitSheetFrame(frame, potionSheet, f, 0, potionX, potionY)

    // 6. Hero: Sprout Knight (dynamic 4-frame stride + underfoot shadow + animated dust puffs)
    const knightX = 58 + f * 3
    const knightDstX = knightX - 21
    const knightDstY = GROUND_Y - 36
    frame.ellipse(knightX, GROUND_Y + 1, 9, 2.2, '#14192b99')
    frame.ellipse(knightX, GROUND_Y + 1, 11, 2.6, '#14192b44')
    drawDustPuffs(frame, knightX, f)
    blitSheetFrame(frame, knightSheet, f, 0, knightDstX, knightDstY)

    // 7. Foe: Ancient Moss Golem (100% grounded planted feet & boulder fists, heaving torso & glowing runes)
    const golemCenterX = 186
    // Lowest pixel of planted feet & fists in 48x48 cell is py = 46 -> align cleanly to GROUND_Y
    const golemDstX = golemCenterX - 25
    const golemDstY = GROUND_Y - 46
    frame.ellipse(golemCenterX, GROUND_Y + 1, 19, 3.0, '#14192baa')
    frame.ellipse(golemCenterX, GROUND_Y + 1, 22, 3.6, '#14192b44')
    if (f === 2) {
      frame.circle(golemCenterX - 2, GROUND_Y - 21, 7, '#3be4f222')
    }
    blitSheetFrame(frame, golemSheet, f, 0, golemDstX, golemDstY)

    // 8. Drifting golden fireflies & framing foreground grass blades
    drawFirefliesAndForeground(frame, f)
  }

  return { scene, audits: { knight: knightAudit, potion: potionAudit, golem: golemAudit } }
}

// ---------------------------------------------------------------------------
// 3. 3D-TO-PIXEL HYBRID SHOWCASE (Fox Courier walk @ 48x48, front-right)
// ---------------------------------------------------------------------------
function buildFox3DToPixel() {
  const recipePath = resolve(__dirname, '../../art-loop/iter2/low-poly/fox-courier.art.json')
  const recipe = JSON.parse(readFileSync(recipePath, 'utf8'))
  const model = modelFromArtRecipe(recipe)
  const clipName = recipe.clips?.run ? 'run' : 'walk'

  const lighting = {
    skyColor: [0.76, 0.88, 1.0],
    groundColor: [0.46, 0.36, 0.32],
    rimStrength: 0.28,
    toonSteps: 4
  }

  // Omit `directions` so bakeAnimatedSpritePixels uses the 8-direction bakeSpritePixels path
  // which applies Ridgetop's built-in `outline: 'selout'`, then extract row 1 ('front-right').
  const frameSize = 48
  const fullRaw = bakeAnimatedSpritePixels(model, {
    clip: clipName,
    frames: FRAMES,
    frameSize,
    elevation: Math.PI / 8,
    lighting
  })
  const fullSelout = bakeAnimatedSpritePixels(model, {
    clip: clipName,
    frames: FRAMES,
    frameSize,
    elevation: Math.PI / 8,
    lighting,
    outline: 'selout'
  })

  const dirRow = 1 // 'front-right' in spriteDirections
  const stripW = FRAMES * frameSize
  const stripH = frameSize
  const rowBytes = stripW * stripH * 4
  const start = dirRow * rowBytes

  const rawPixels = new Uint8ClampedArray(fullRaw.pixels.subarray(start, start + rowBytes))
  const seloutPixels = new Uint8ClampedArray(fullSelout.pixels.subarray(start, start + rowBytes))

  return {
    clipName,
    width: stripW,
    height: stripH,
    frameSize,
    frames: FRAMES,
    rawPixels,
    seloutPixels
  }
}

// ---------------------------------------------------------------------------
// 4. PREVIEW-COMPARE STACKED SHEET (2x Before, 2x After, 4x Fox Raw vs Selout)
// ---------------------------------------------------------------------------
const MINI_FONT = {
  A: ['0110', '1001', '1111', '1001', '1001'],
  B: ['1110', '1001', '1110', '1001', '1110'],
  C: ['0111', '1000', '1000', '1000', '0111'],
  D: ['1110', '1001', '1001', '1001', '1110'],
  E: ['1111', '1000', '1110', '1000', '1111'],
  F: ['1111', '1000', '1110', '1000', '1000'],
  G: ['0111', '1000', '1011', '1001', '0111'],
  H: ['1001', '1001', '1111', '1001', '1001'],
  I: ['111', '010', '010', '010', '111'],
  K: ['1001', '1010', '1100', '1010', '1001'],
  L: ['1000', '1000', '1000', '1000', '1111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  O: ['0110', '1001', '1001', '1001', '0110'],
  P: ['1110', '1001', '1110', '1000', '1000'],
  R: ['1110', '1001', '1110', '1010', '1001'],
  S: ['0111', '1000', '0110', '0001', '1110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['1001', '1001', '1001', '1001', '0110'],
  V: ['1001', '1001', '1001', '0110', '0110'],
  W: ['10001', '10001', '10101', '11011', '10001'],
  X: ['1001', '0110', '0110', '1001', '1001'],
  Y: ['101', '101', '010', '010', '010'],
  '0': ['0110', '1001', '1001', '1001', '0110'],
  '2': ['1110', '0001', '0110', '1000', '1111'],
  '3': ['1110', '0001', '0110', '0001', '1110'],
  '4': ['1001', '1001', '1111', '0001', '0001'],
  '-': ['000', '000', '111', '000', '000'],
  '(': ['01', '10', '10', '10', '01'],
  ')': ['10', '01', '01', '01', '10'],
  ' ': ['000', '000', '000', '000', '000']
}

function drawTextRgba(dst, W, H, text, x, y, rgb, scale = 2) {
  let cx = x
  for (const ch of text.toUpperCase()) {
    const g = MINI_FONT[ch] ?? MINI_FONT[' ']
    const gw = g[0].length
    for (let gy = 0; gy < g.length; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (g[gy][gx] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cx + gx * scale + sx
            const py = y + gy * scale + sy
            if (px < 0 || px >= W || py < 0 || py >= H) continue
            const i = (py * W + px) * 4
            dst[i] = rgb[0]; dst[i + 1] = rgb[1]; dst[i + 2] = rgb[2]; dst[i + 3] = 255
          }
        }
      }
    }
    cx += (gw + 1) * scale
  }
}

function fillRectRgba(dst, W, H, x, y, w, h, rgb) {
  for (let py = y; py < y + h; py++) {
    if (py < 0 || py >= H) continue
    for (let px = x; px < x + w; px++) {
      if (px < 0 || px >= W) continue
      const i = (py * W + px) * 4
      dst[i] = rgb[0]; dst[i + 1] = rgb[1]; dst[i + 2] = rgb[2]; dst[i + 3] = 255
    }
  }
}

function buildPreviewCompare(before0, after0, fox) {
  const b2 = upscaleNearest(before0.pixels, before0.width, before0.height, 2)
  const a2 = upscaleNearest(after0.pixels, after0.width, after0.height, 2)
  const fRaw4 = upscaleNearest(fox.rawPixels, fox.width, fox.height, 4)
  const fSel4 = upscaleNearest(fox.seloutPixels, fox.width, fox.height, 4)

  const W = 808
  const pad = 20
  const labelH = 18
  const gap = 18
  const H =
    pad +
    labelH + b2.height + gap +
    labelH + a2.height + gap +
    labelH + fRaw4.height + gap +
    labelH + fSel4.height + pad

  const pixels = new Uint8ClampedArray(W * H * 4)
  fillRectRgba(pixels, W, H, 0, 0, W, H, [17, 21, 34])

  const drawCard = (label, img, y, checkerboard = false) => {
    const ox = Math.floor((W - img.width) / 2)
    drawTextRgba(pixels, W, H, label, ox, y, [230, 224, 210], 2)
    const iy = y + labelH
    fillRectRgba(pixels, W, H, ox - 1, iy - 1, img.width + 2, img.height + 2, [58, 66, 94])
    if (checkerboard) {
      for (let py = 0; py < img.height; py++) {
        for (let px = 0; px < img.width; px++) {
          const odd = ((px >> 4) + (py >> 4)) & 1
          const di = ((iy + py) * W + (ox + px)) * 4
          const c = odd ? [38, 45, 68] : [32, 38, 58]
          pixels[di] = c[0]; pixels[di + 1] = c[1]; pixels[di + 2] = c[2]; pixels[di + 3] = 255
        }
      }
    }
    compositeRgba(pixels, W, H, img.pixels, img.width, img.height, ox, iy)
    return iy + img.height + gap
  }

  let y = pad
  y = drawCard('BEFORE - ITER 0 (2X)', b2, y, false)
  y = drawCard('AFTER - TWILIGHT GLADE PIXEL SCENE (2X)', a2, y, false)
  y = drawCard('3D-TO-PIXEL FOX WALK - RAW (4X)', fRaw4, y, true)
  drawCard('3D-TO-PIXEL FOX WALK - SELOUT (4X)', fSel4, y, true)

  return { width: W, height: H, pixels }
}

// ---------------------------------------------------------------------------
// Main execution & PNG export
// ---------------------------------------------------------------------------
const beforeSheet = buildBeforeScene()
const before0 = cropFrame(beforeSheet, 0)

const { scene: afterSheet, audits } = buildAfterScene()
const after0 = cropFrame(afterSheet, 0)

const fox = buildFox3DToPixel()
const preview = buildPreviewCompare(before0, after0, fox)

function savePng(name, width, height, pixels) {
  const fullPath = resolve(OUT_DIR, name)
  writeFileSync(fullPath, encodePng(width, height, pixels))
  console.log(`Wrote ${name} (${width}x${height})`)
}

savePng('before-scene.png', beforeSheet.width, beforeSheet.height, beforeSheet.pixels)
savePng('before-frame0.png', before0.width, before0.height, before0.pixels)
savePng('after-scene.png', afterSheet.width, afterSheet.height, afterSheet.pixels)
savePng('after-frame0.png', after0.width, after0.height, after0.pixels)
savePng('fox-3d-to-pixel-raw.png', fox.width, fox.height, fox.rawPixels)
savePng('fox-3d-to-pixel-selout.png', fox.width, fox.height, fox.seloutPixels)
savePng('preview-compare.png', preview.width, preview.height, preview.pixels)

const meta = {
  track: 'Track 2: Full-Scene 2D Pixel Art Leap + 3D-to-Pixel Hybrid Showcase',
  files: {
    'before-scene.png': { width: beforeSheet.width, height: beforeSheet.height, frameWidth: SCENE_W, frameHeight: SCENE_H, frames: FRAMES },
    'before-frame0.png': { width: before0.width, height: before0.height, frames: 1 },
    'after-scene.png': { width: afterSheet.width, height: afterSheet.height, frameWidth: SCENE_W, frameHeight: SCENE_H, frames: FRAMES },
    'after-frame0.png': { width: after0.width, height: after0.height, frames: 1 },
    'fox-3d-to-pixel-raw.png': { width: fox.width, height: fox.height, frameWidth: fox.frameSize, frameHeight: fox.frameSize, frames: fox.frames, clip: fox.clipName, direction: 'front-right', outline: false },
    'fox-3d-to-pixel-selout.png': { width: fox.width, height: fox.height, frameWidth: fox.frameSize, frameHeight: fox.frameSize, frames: fox.frames, clip: fox.clipName, direction: 'front-right', outline: 'selout' },
    'preview-compare.png': { width: preview.width, height: preview.height }
  },
  spriteAudits: audits
}

writeFileSync(resolve(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n')
console.log('Wrote meta.json')
