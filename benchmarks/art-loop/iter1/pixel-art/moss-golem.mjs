import { auditSpriteSheet, createSpriteSheet, hueShiftRamp } from '../../../../packages/ridgetop/dist/framework/index.js';

const INK = '#141c2c';
const stone = hueShiftRamp('#7c8f9c', { shadowHue: 224, highlightHue: 44 });
const moss = hueShiftRamp('#4c9157', { shadowHue: 210, highlightHue: 64 });
const amber = hueShiftRamp('#f09a28', { shadowHue: 18, highlightHue: 52 });

const PALETTE = {
  k: INK,
  d: stone.dark,
  s: stone.shade,
  S: stone.mid,
  L: stone.light,
  H: stone.highlight,
  m: moss.dark,
  M: moss.mid,
  g: moss.light,
  y: moss.highlight,
  a: amber.shade,
  A: amber.light,
  F: amber.highlight
};

const LIT_SELOUT_MAP = new Map([
  [stone.highlight, stone.dark],
  [stone.light, stone.dark],
  [stone.mid, stone.dark],
  [moss.highlight, moss.dark],
  [moss.light, moss.dark],
  [moss.mid, moss.dark]
]);

function applyCuratedSelout(frame, fw, fh) {
  frame.outline(INK, '4-way');
  const changes = [];
  for (let py = 1; py < fh - 1; py++) {
    for (let px = 1; px < fw - 1; px++) {
      if (frame.getPixel(px, py) !== INK) continue;
      const left = frame.getPixel(px - 1, py);
      const up = frame.getPixel(px, py - 1);
      if (left !== null || up !== null) continue;
      const right = frame.getPixel(px + 1, py);
      const down = frame.getPixel(px, py + 1);
      const tint = (down && LIT_SELOUT_MAP.get(down)) || (right && LIT_SELOUT_MAP.get(right));
      if (tint) changes.push([px, py, tint]);
    }
  }
  for (const [px, py, tint] of changes) {
    frame.pixel(px, py, tint);
  }
}

// 1. PLANTED LEGS & GROUNDED STONE FEET (dy = 0 on both frames -> footDriftPx === 0!)
// Placed at (14, 26) -> clear transparent arch gap between legs & wide flank gaps to fists
const PLANTED_LEGS = [
  '..LSSSSssd..',
  '.LLSSSSssdd.',
  '.LSSSd..Ssd.',
  '.LSSd...SSd.',
  '.LSSd...SSd.',
  '.LSSd...SSd.',
  '.LSSd...SSd.',
  'LLSSd...LSSd',
  'LSSSd...LSSd',
  'SSSSd...SSdd',
  'sddd....dddd'
];

// 2. PLANTED LEFT FOREGROUND BOULDER FOREARM & FIST (dy = 0 on both frames!)
// Placed at (2, 22) -> spans x=2..9, y=22..36 (leaves wide transparent gap x=10..13 to waist/legs!)
const PLANTED_LEFT_FIST = [
  '..LLSS..',
  '.LLSSd..',
  '.LSSgMd.',
  '.LLmmSd.',
  'HLLSSSd.',
  'HLLSSSdd',
  'LLSSSSsd',
  'LLSSSSsd',
  'LSSSSSsd',
  'LSSSdSsd',
  'SSSkdSdd',
  'SSdkSddd',
  'SSdSSddd',
  'ssdddddd',
  '.dddddd.'
];

// 3. PLANTED RIGHT BACKGROUND BOULDER FOREARM & FIST (dy = 0 on both frames!)
// Placed at (29, 23) -> spans x=29..36, y=23..36 (leaves wide transparent gap x=26..28 to waist/legs!)
const PLANTED_RIGHT_FIST = [
  '..LSSd..',
  '.LLSSd..',
  '.LSSSd..',
  '.LSSSd..',
  'LLSSSd..',
  'LLSSSdd.',
  'LSSSSsd.',
  'LSSdSSsd',
  'SSdkSSsd',
  'SSdSSsdd',
  'SSdSSddd',
  'SSdSSddd',
  'ssdddddd',
  '.dddddd.'
];

// 4. ARTICULATED UPPER-ARM BRIDGES (heave -1px on inhale, staying locked to planted fists!)
const LEFT_UPPER_ARM = [
  '..HLLSd.',
  '.HLLSSd.',
  '.LLSSSd.',
  'LLSSSsd.',
  'LSSSsd..',
  'LSSsd...',
  '.LSsd...'
];

const RIGHT_UPPER_ARM = [
  'LLSSd...',
  'LSSSd...',
  '.LSSsd..',
  '.LSSsd..',
  '..LSsd..',
  '..LSsd..',
  '..LSsd..'
];

// 5. HEAVING STONE CHEST & TAPERED WAIST (heave 0 on Frame 0, -2 on Frame 1)
// Placed at (14, 16 + heave) -> spans x=14..25, tapering cleanly to waist x=16..23
const TORSO_CALM = [
  'HLLSSSSSSSsd',
  'LLSSSSSSSssd',
  'LLSSSkSSssdd',
  '.LSSkAkSssdd',
  '.LSkAaAkSsdd',
  '.LSSkAkSsdd.',
  '..LSSkSSsdd.',
  '..LSSSSSsdd.',
  '..LSSSSSdd..',
  '...LSSSsd...',
  '...LSSSd....',
  '...sddd.....'
];

const TORSO_FLARE = [
  'HLLSSSSSSSsd',
  'LLSSSSSSSssd',
  'LLSSkAkSssdd',
  '.LSkAFAkssdd',
  '.LkAFAAFkSdd',
  '.LSkAFAkSdd.',
  '..LSkAkSsdd.',
  '..LSSSSSsdd.',
  '..LSSSSSdd..',
  '...LSSSsd...',
  '...LSSSd....',
  '...sddd.....'
];

// 6. HEAVING HUNCHED ASYMMETRIC BOULDER SHOULDERS & SUNKEN DARK FACE CAVITY
// Placed at (6, 6 + heave) -> spans x=6..33, y=6..17
const SHOULDERS_HEAD_CALM = [
  '....yygg....................',
  '...ygMMMgm..................',
  '..ggMMgMMmm......ygg........',
  '.gMMMmmLSSmm...ygMMMm.......',
  '.mLLHLSSSSSSm.ggMMMMmm......',
  'HLLHLLSSSSSSLgMMmLSSmm......',
  'HLLHLLSSSSSkkkkkkLSSSsd.....',
  'LLHLLSSSSskkAkkkAkSSssdd....',
  'LLHLLSSSSskkakkkakSSsssdd...',
  '.LLSSSSSSskkkkkkkkSSsssdd...',
  '..LSSSSSSsdskkkkss.SSssdd...',
  '...dssssd...dddd....ssdd....'
];

const SHOULDERS_HEAD_FLARE = [
  '....yygg....................',
  '...ygMMMgm..................',
  '..ggMMgMMmm......ygg........',
  '.gMMMmmLSSmm...ygMMMm.......',
  '.mLLHLSSSSSSm.ggMMMMmm......',
  'HLLHLLSSSSSSLgMMmLSSmm......',
  'HLLHLLSSSSSkkkkkkLSSSsd.....',
  'LLHLLSSSSskAFkkAFkSSssdd....',
  'LLHLLSSSSskAAkkAAkSSsssdd...',
  '.LLSSSSSSskkkkkkkkSSsssdd...',
  '..LSSSSSSsdskkkkss.SSssdd...',
  '...dssssd...dddd....ssdd....'
];

// 7. HANGING MOSS TENDRILS (draped over shoulders/brow, sway 1px outward on Frame 1!)
const TENDRILS_FRAME_0 = [
  {
    x: 6,
    y: 11,
    grid: [
      'gM.',
      'Mm.',
      'm..'
    ]
  },
  {
    x: 12,
    y: 11,
    grid: [
      'gMgm',
      'MMm.',
      'Mm..',
      'm...'
    ]
  },
  {
    x: 26,
    y: 11,
    grid: [
      '.gM',
      'gMm',
      'Mm.',
      '.m.'
    ]
  }
];

const TENDRILS_FRAME_1 = [
  {
    x: 5,
    y: 9,
    grid: [
      '.gM',
      'gMm',
      'Mm.',
      'm..'
    ]
  },
  {
    x: 11,
    y: 9,
    grid: [
      '.gMgm',
      'gMMm.',
      'MMm..',
      'm....'
    ]
  },
  {
    x: 27,
    y: 9,
    grid: [
      'gM.',
      'MMm',
      '.Mm',
      '..m'
    ]
  }
];

export function build() {
  const sheet = createSpriteSheet(40, 40, 2, 1);

  for (let i = 0; i < 2; i++) {
    const f = sheet.frame(i, 0);
    const heave = i === 0 ? 0 : -2;
    const armHeave = i === 0 ? 0 : -1;

    // 1. Grounded legs & heavy boulder fists STAY PLANTED (footDriftPx === 0!)
    f.stamp(14, 26, PLANTED_LEGS, PALETTE);
    f.stamp(2, 22, PLANTED_LEFT_FIST, PALETTE);
    f.stamp(29, 23, PLANTED_RIGHT_FIST, PALETTE);

    // 2. Articulated upper arms stretch subtly between heaving shoulders and planted fists
    f.stamp(4, 16 + armHeave, LEFT_UPPER_ARM, PALETTE);
    f.stamp(28, 17 + armHeave, RIGHT_UPPER_ARM, PALETTE);

    // 3. Heaving stone chest & carved glowing rune (flares bright on inhale!)
    f.stamp(14, 16 + heave, i === 0 ? TORSO_CALM : TORSO_FLARE, PALETTE);

    // 4. Heaving hunched asymmetric boulder shoulders, dark face cavity & glowing amber eyes
    f.stamp(6, 6 + heave, i === 0 ? SHOULDERS_HEAD_CALM : SHOULDERS_HEAD_FLARE, PALETTE);

    // 5. Lush hanging moss tendrils swaying with secondary drag
    const tendrils = i === 0 ? TENDRILS_FRAME_0 : TENDRILS_FRAME_1;
    for (const t of tendrils) {
      f.stamp(t.x, t.y, t.grid, PALETTE);
    }

    // 6. Clean 4-way outline with curated palette-locked selout on lit top-left edges
    applyCuratedSelout(f, 40, 40);
  }

  return sheet;
}
