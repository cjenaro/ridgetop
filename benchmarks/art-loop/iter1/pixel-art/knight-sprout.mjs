import { auditSpriteSheet, createSpriteSheet, hueShiftRamp } from '../../../../packages/ridgetop/dist/framework/index.js';

const INK = '#141c2c';
const leaf = hueShiftRamp('#4a9b60', { shadowHue: 215, highlightHue: 58 });
const cloak = hueShiftRamp('#d96638', { shadowHue: 342, highlightHue: 45 });
const wood = hueShiftRamp('#9e6840', { shadowHue: 350, highlightHue: 44 });
const eye = hueShiftRamp('#f2bf49', { shadowHue: 25, highlightHue: 54 });

const PALETTE = {
  k: INK,
  g: leaf.dark,
  G: leaf.mid,
  l: leaf.light,
  h: leaf.highlight,
  r: cloak.dark,
  R: cloak.mid,
  o: cloak.light,
  w: wood.dark,
  W: wood.mid,
  b: wood.light,
  y: eye.mid,
  Y: eye.highlight
};

// Curated palette-locked selout: softens top-left lit outline edges using dark shades already in PALETTE.
const LIT_SELOUT_MAP = new Map([
  [leaf.highlight, leaf.dark],
  [leaf.light, leaf.dark],
  [leaf.mid, leaf.dark],
  [cloak.light, cloak.dark],
  [cloak.mid, cloak.dark],
  [wood.light, wood.dark],
  [wood.mid, wood.dark]
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

const HELMET = [
  '....hlllG....',
  '..hhllllGGg..',
  '.hlllGGGGGGg.',
  '.lllGGGGGGggg',
  'lllGGgkkkkkk.',
  'llGGGkkYkkYk.',
  'lGGGGkkykkyk.',
  'GGGGGgkkkkkk.',
  '.GGGGgggkgg..'
];

const SPROUT_FRAMES = [
  // Frame 0: Contact (slight energetic lean back)
  {
    x: 12,
    y: 4,
    grid: [
      '..hl...hll',
      '.lGG..lGGl',
      '..gG.lGGg.',
      '...gGGGg..',
      '....gG....'
    ]
  },
  // Frame 1: Down/Squash (leaves sweep wide & low from impact)
  {
    x: 11,
    y: 5,
    grid: [
      '..........',
      '.hll..hll.',
      'lGGGlGGGl.',
      '..ggGGGg..',
      '....gG....'
    ]
  },
  // Frame 2: Passing (perky balanced bounce)
  {
    x: 12,
    y: 4,
    grid: [
      '..hll..hl.',
      '.lGGl.lGG.',
      '..gGG.lGg.',
      '...gGGGg..',
      '....gG....'
    ]
  },
  // Frame 3: Up/Stretch (sprout springs tall!)
  {
    x: 13,
    y: 3,
    grid: [
      '...h...hl.',
      '..lG..lGG.',
      '.lGG.lGGl.',
      '..gGGGGg..',
      '....gG....'
    ]
  }
];

// Graceful downward S-curve flowing cloak (never a stiff horizontal spike)
const CLOAK_FRAMES = [
  // Frame 0: Mid S-curve wave
  {
    x: 4,
    y: 18,
    grid: [
      '.......oooRRRR..',
      '......ooRRRRRr..',
      '.....oRRRRrRr...',
      '....oRRRr.rr....',
      '...oRRRr........',
      '..oRRRRr........',
      '..RRrrr.........',
      '...rr...........'
    ]
  },
  // Frame 1: Down/Squash — billowing downward with trailing tip lift
  {
    x: 3,
    y: 19,
    grid: [
      '........oooRRRR.',
      '.......ooRRRRRr.',
      '......oRRRRrRr..',
      '....ooRRRRr.r...',
      '..ooRRRRRr......',
      '..oRRRRrr.......',
      '...rrrr.........'
    ]
  },
  // Frame 2: Passing — opposite ripple crest
  {
    x: 4,
    y: 18,
    grid: [
      '.......oooRRRR..',
      '......ooRRRRRr..',
      '....ooRRRRrRr...',
      '...oRRRRr.rr....',
      '...oRRRr........',
      '..oRRRr.........',
      '..RRrr..........',
      '..rr............'
    ]
  },
  // Frame 3: Up/Stretch — sleek whip trailing downward-back
  {
    x: 3,
    y: 17,
    grid: [
      '........oooRRRR.',
      '.......ooRRRRRr.',
      '.....ooRRRRrRr..',
      '....oRRRRr.rr...',
      '...oRRRRr.......',
      '..oRRRr.........',
      '.oRRrr..........',
      '..rr............'
    ]
  }
];

const BUCKLER = [
  '..kbbW..',
  '.kbWWWW.',
  'kbWWYWWw',
  'kbWWyWWw',
  '.kWWWWWw',
  '.kWwwww.',
  '..kwww..'
];

const TUNIC = [
  '.gGGGg.',
  '.gGGGg.',
  '.ggGGg.',
  '.gwwwg.'
];

// Grounded 4-frame run cycle legs (contact -> down -> passing -> up, footDriftPx === 0)
const LEGS_FRAMES = [
  // Frame 0: Contact — wide stride (front boot extended forward y=29, back boot kicked back y=28)
  {
    x: 8,
    y: 23,
    grid: [
      '.....ggGGg.....',
      '....gg..GGg....',
      '...wW....wW....',
      '..wWW....WWb...',
      '.wWW.....WWWb..',
      '.www.....wwww..',
      '.........wwww..'
    ]
  },
  // Frame 1: Down/Squash — full flat boot planted under torso (y=29), back foot tucked behind
  {
    x: 8,
    y: 24,
    grid: [
      '....ggGGGg.....',
      '...wW..wWW.....',
      '..wWW..WWb.....',
      '..ww...WWWb....',
      '.......WWWWW...',
      '.......wwwww...'
    ]
  },
  // Frame 2: Passing — legs cross cleanly under body (standing boot y=29, swinging knee lifted forward)
  {
    x: 8,
    y: 23,
    grid: [
      '......gGGGg....',
      '......gGG.GG...',
      '......wW...WWb.',
      '......WWb..WWWb',
      '......WWb..www.',
      '......WWWb.....',
      '......wwww.....'
    ]
  },
  // Frame 3: Up/Stretch — back toe pushes off ground (y=29), front knee driven high forward
  {
    x: 8,
    y: 22,
    grid: [
      '.....ggGGg.....',
      '....gg...GG....',
      '...gg.....GGg..',
      '...wW.....WWb..',
      '..wWW.....WWWb.',
      '..wWW.....www..',
      '..wWW..........',
      '..www..........'
    ]
  }
];

export function build() {
  const sheet = createSpriteSheet(32, 32, 4, 1);
  const bodyDy = [0, 1, 0, -1];
  const shieldPos = [
    [16, 19],
    [17, 20],
    [18, 19],
    [17, 18]
  ];

  for (let i = 0; i < 4; i++) {
    const f = sheet.frame(i, 0);
    const dy = bodyDy[i];

    // 1. Flowing downward S-curve cloak behind body
    f.stamp(CLOAK_FRAMES[i].x, CLOAK_FRAMES[i].y, CLOAK_FRAMES[i].grid, PALETTE);

    // 2. Dynamic run-cycle legs & grounded boots
    f.stamp(LEGS_FRAMES[i].x, LEGS_FRAMES[i].y, LEGS_FRAMES[i].grid, PALETTE);

    // 3. Compact torso tunic
    f.stamp(13, 20 + dy, TUNIC, PALETTE);

    // 4. Twin-leaf sprout & round moss helmet
    f.stamp(SPROUT_FRAMES[i].x, SPROUT_FRAMES[i].y, SPROUT_FRAMES[i].grid, PALETTE);
    f.stamp(11, 9 + dy, HELMET, PALETTE);

    // 5. Warm scarf/cloak collar tucked cleanly below helmet chin
    f.stamp(11, 18 + dy, [
      '.oooRRRR.',
      '..oRRRRr.'
    ], PALETTE);

    // 6. Round wooden buckler shield with brass boss on front arm
    f.stamp(shieldPos[i][0], shieldPos[i][1], BUCKLER, PALETTE);

    // 7. Automatic 4-way outline with curated palette-locked selout on lit top-left edges
    applyCuratedSelout(f, 32, 32);
  }

  return sheet;
}
