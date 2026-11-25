import { auditSpriteSheet, createSpriteSheet, hueShiftRamp } from '../../../../packages/ridgetop/dist/framework/index.js';

const INK = '#141c2c';
const elixir = hueShiftRamp('#1ec494', { shadowHue: 215, highlightHue: 148 });
const glass = hueShiftRamp('#74add6', { shadowHue: 226, highlightHue: 198 });
const ribbon = hueShiftRamp('#dc4a30', { shadowHue: 344, highlightHue: 38 });
const cork = hueShiftRamp('#c69058', { shadowHue: 24, highlightHue: 46 });

const PALETTE = {
  k: INK,
  d: glass.dark,
  g: glass.mid,
  L: glass.light,
  W: glass.highlight,
  D: elixir.dark,
  e: elixir.mid,
  l: elixir.light,
  H: elixir.highlight,
  r: ribbon.dark,
  R: ribbon.mid,
  o: ribbon.light,
  c: cork.mid,
  C: cork.light
};

const LIT_SELOUT_MAP = new Map([
  [glass.highlight, glass.dark],
  [glass.light, glass.dark],
  [glass.mid, glass.dark],
  [cork.light, ribbon.dark],
  [cork.mid, ribbon.dark],
  [ribbon.light, ribbon.dark],
  [ribbon.mid, ribbon.dark],
  [elixir.light, elixir.dark],
  [elixir.highlight, elixir.dark]
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

// Base 20x19 faceted crystal flask placed at (2, 2) -> interior x=4..19, y=2..20 (outline x=3..20, y=1..21)
const BASE_FLASK = [
  '........CCcc........',
  '........CCcr........',
  '......LLgggggg......',
  '.......gddddg.......',
  '.......oRRRRr.......',
  '.......oRRRRro......',
  '.....gLLddddgrR.....',
  '....gLWddddddggr....',
  '...gLWddddddddgg....',
  '..gLWddddddddddgg...',
  '..gWddddddddddddg...',
  '..gLHHllllllllDDg...',
  '..gLllleeeeeeeDDg...',
  '..gLllleeeeeeeDDg...',
  '..gglleeeeeeeDDDg...',
  '...ggleeeeeeDDDg....',
  '...gggeeeeeDDDDg....',
  '....gggDDDDDDgg.....',
  '.....ggLLggggg......'
];

// 4-frame rising bubbles, subtle meniscus slosh, and sweeping diagonal crystal sheen
// Coordinates relative to flask origin (2, 2)
const SHIMMER_OVERLAYS = [
  // Frame 0: Sheen enters upper-left shoulder; bubble A low-left, bubble B mid-right
  [
    { x: 5, y: 7, grid: ['LW', 'WW', 'W.'] },
    { x: 4, y: 11, grid: ['HHlllHHlllDD'] },
    { x: 7, y: 15, grid: ['Hl', 'lH'] },
    { x: 13, y: 13, grid: ['lH', 'el'] }
  ],
  // Frame 1: Sheen sweeps diagonally across upper air chamber; bubbles rise & right bubble pops at meniscus
  [
    { x: 7, y: 7, grid: ['..LW', '.LWW', 'LWW.', 'WW..'] },
    { x: 4, y: 11, grid: ['llHHHHlllHHD'] },
    { x: 13, y: 10, grid: ['lH'] },
    { x: 7, y: 13, grid: ['Hl', 'lH'] },
    { x: 11, y: 15, grid: ['lH', 'el'] }
  ],
  // Frame 2: Sheen sweeps cleanly across lower-right emerald facets; bubble A hits meniscus, bubble C rises
  [
    { x: 4, y: 11, grid: ['lHHlllHHHllD'] },
    { x: 7, y: 10, grid: ['Hl'] },
    { x: 9, y: 12, grid: ['...LW', '..LWW', '.LWW.', 'LW...'] },
    { x: 6, y: 15, grid: ['Hl', 'lH'] },
    { x: 13, y: 15, grid: ['lH'] }
  ],
  // Frame 3: Crisp 3x3 cross crystal sparkle pops on upper-left facet; bubbles settle
  [
    { x: 6, y: 8, grid: ['.W.', 'WWW', '.W.'] },
    { x: 4, y: 11, grid: ['HHHllllHHllD'] },
    { x: 11, y: 13, grid: ['Hl', 'lH'] },
    { x: 6, y: 14, grid: ['lH', 'el'] }
  ]
];

export function build() {
  const sheet = createSpriteSheet(24, 24, 4, 1);

  for (let i = 0; i < 4; i++) {
    const f = sheet.frame(i, 0);

    // 1. Faceted crystal flask, cork stopper, crimson wax ribbon & glowing emerald elixir
    f.stamp(2, 2, BASE_FLASK, PALETTE);

    // 2. Animated rising bubbles, sloshing bright meniscus & sweeping crystal sheen
    for (const part of SHIMMER_OVERLAYS[i]) {
      f.stamp(2 + part.x, 2 + part.y, part.grid, PALETTE);
    }

    // 3. Clean 4-way outline with curated palette-locked selout on lit top-left edges
    applyCuratedSelout(f, 24, 24);
  }

  return sheet;
}
