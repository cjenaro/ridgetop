import {
  createSpriteSheet,
  hueShiftRamp,
  auditSpriteSheet,
} from '../../../../packages/ridgetop/dist/framework/index.js';

export function build() {
  // Cool highlightHue keeps crystal glass & emerald elixir crisp and jewel-like
  const glass = hueShiftRamp('#78b4cc', { highlightHue: 198 });
  const elixir = hueShiftRamp('#1da888', { highlightHue: 156 });
  const cork = hueShiftRamp('#b58250');
  const wax = hueShiftRamp('#d94b34');

  // Strict 14-color palette (palette-locked selout adds 0 extra colors)
  const palette = {
    K: '#141c2c', // Deep cool ink & hollow glass interior shadow
    d: glass.dark, // Dark refractive inner glass rim
    g: glass.mid, // Crystal glass facet midtone & thick base
    i: glass.light, // Cool ice-blue glass bevel & star glint arms
    W: '#f2fdff', // Pure ice-white specular arc & glint core
    e: elixir.dark, // Deep bottom-right emerald shadow
    E: elixir.mid, // Rich glowing emerald-teal elixir
    M: elixir.light, // Bright luminous turquoise-mint meniscus
    H: elixir.highlight, // Sparkling pale mint bubble & shimmer highlight
    c: cork.dark, // Shaded cork umber
    C: cork.mid, // Warm cork stopper body
    L: cork.light, // Sunlit cork top-left & wax specular catch-light
    r: wax.dark, // Deep crimson wax shadow
    R: wax.mid, // Vivid crimson-orange wax ribbon & knot
  };

  // Base crystal flask silhouette (x: 4..19, y: 2..21; outlined x: 3..20, y: 1..22)
  const baseFlask = [
    '......LCCc......', // y=2  cork top
    '......CCCc......', // y=3  cork body
    '......Cccc......', // y=4  cork tucked into lip
    '....iigggggd....', // y=5  flared crystal lip
    '......igdd......', // y=6  crisp pinched narrow neck
    '.....LRRRRr.....', // y=7  crimson-orange wax ribbon collar
    '.....RrrrrRR....', // y=8  wax ribbon + tied knot & tail
    '....igddKddRr...', // y=9  narrow neck flare + trailing ribbon tip
    '..iWddKKKKddg...', // y=10 bold angular faceted crystal shoulders
    '.iWddKKKKKKddg..', // y=11 upper hollow chamber + curved specular
    '.iWdKKKKKKKKdg..', // y=12 dark refractive rim + hollow air chamber
    '.iWMMHHHHMMMed..', // y=13 luminous liquid meniscus
    '.iWMMMEEEEEEed..', // y=14 upper bulbous elixir + specular arc
    '.iWMEEEEEEEEed..', // y=15 mid bulbous elixir
    '.igMEEEEEEEeed..', // y=16 lower bulbous elixir
    '.igEEEEEEEEeed..', // y=17 crystal lower facet
    '..igEEEEEEeed...', // y=18 tapered crystal wall
    '...idEEEEeed....', // y=19 deep saturated elixir bottom
    '....iigggdd.....', // y=20 thick crystal base bevel
    '.....iigdd......', // y=21 flat grounded base
  ];

  // 4 synchronized shimmer frames: meniscus slosh + rising 2x2 bubble + diagonal glass sheen + airy post-outline stars
  const meniscusRows = [
    { y12: 'KKKKKKKK', y13: 'MMHHHHMM' },
    { y12: 'KKKMMKKK', y13: 'MHHMMMEE' },
    { y12: 'KKKKKMMK', y13: 'EMMHHHMM' },
    { y12: 'KMMKKKKK', y13: 'HHMMMEEM' },
  ];

  const bubbles = [
    { x: 9, y: 17, pop: false },
    { x: 10, y: 15, pop: false },
    { x: 12, y: 14, pop: false },
    { x: 13, y: 12, pop: true },
  ];

  // Diagonal x+y sheen sweep bands cleanly across the glass facets
  const sheenDiags = [20, 24, 27, 30];

  // Post-outline airy 3x3 star glints (all 4-way connected crosses -> 0 orphans, >=2px gap from flask)
  const starsPerFrame = [
    [
      { x: 4, y: 6, core: palette.W, arm: palette.i },
      { x: 20, y: 20, core: palette.H, arm: palette.M },
    ],
    [
      { x: 4, y: 6, core: palette.i, arm: palette.g },
      { x: 19, y: 4, core: palette.W, arm: palette.H },
    ],
    [
      { x: 19, y: 4, core: palette.W, arm: palette.i },
      { x: 3, y: 20, core: palette.H, arm: palette.M },
    ],
    [
      { x: 4, y: 6, core: palette.H, arm: palette.i },
      { x: 19, y: 4, core: palette.i, arm: palette.g },
      { x: 20, y: 20, core: palette.W, arm: palette.H },
    ],
  ];

  function drawStar(frame, cx, cy, core, arm) {
    frame.pixel(cx, cy, core);
    frame.pixel(cx - 1, cy, arm);
    frame.pixel(cx + 1, cy, arm);
    frame.pixel(cx, cy - 1, arm);
    frame.pixel(cx, cy + 1, arm);
  }

  const sheet = createSpriteSheet(24, 24, 4, 1);

  for (let f = 0; f < 4; f++) {
    const frame = sheet.frame(f, 0);
    frame.stamp(4, 2, baseFlask, palette);

    // 1. Subtle 1px liquid meniscus slosh
    const m = meniscusRows[f];
    frame.stamp(8, 12, [m.y12, m.y13], palette);

    // 2. Soft crystal diagonal sheen sweeping cleanly across the interior facets
    const diag = sheenDiags[f];
    for (let py = 10; py <= 19; py++) {
      for (let px = 6; px <= 17; px++) {
        const d = px + py;
        if (d !== diag && d !== diag + 1) continue;
        const cur = frame.getPixel(px, py);
        if (!cur) continue;
        if (cur === palette.K || cur === palette.d) {
          frame.pixel(px, py, d === diag ? palette.g : palette.d);
        } else if (cur === palette.E || cur === palette.e) {
          frame.pixel(px, py, d === diag ? palette.H : palette.M);
        } else if (cur === palette.M) {
          frame.pixel(px, py, d === diag ? palette.W : palette.H);
        }
      }
    }

    // 3. Rising 2x2 glowing bubble inside the emerald elixir (+ pop ripple on frame 3)
    const b = bubbles[f];
    if (b.pop) {
      frame.stamp(b.x, b.y, ['WH', 'HM'], palette);
      frame.stamp(9, 18, ['HM', 'ME'], palette);
      // Warm wax knot glint on beat 3
      frame.pixel(15, 8, palette.L);
    } else {
      frame.stamp(b.x, b.y, ['WH', 'HM'], palette);
    }

    // 4. Preserve crisp curved upper-left glass specular highlight
    frame.pixel(6, 10, palette.W);
    frame.pixel(5, 11, palette.i);
    frame.pixel(6, 11, palette.W);
    frame.pixel(6, 12, palette.W);
    frame.pixel(6, 13, palette.W);
    frame.pixel(6, 14, palette.W);

    // 5. Palette-locked selective exterior outline
    frame.outline('selout', { palette });

    // 6. Airy post-outline 3x3 star glints (zero dark ink rings!)
    for (const s of starsPerFrame[f]) {
      drawStar(frame, s.x, s.y, s.core, s.arm);
    }
  }

  return sheet;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = auditSpriteSheet(build(), { maxColors: 14, maxFillRatio: 0.54, maxFootDriftPx: 1 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exit(1);
}
