import {
  createSpriteSheet,
  hueShiftRamp,
  auditSpriteSheet,
  createPixelRig,
  renderPixelRig,
  pixelClips,
} from '../../../../packages/ridgetop/dist/framework/index.js';

export function build() {
  const moss = hueShiftRamp('#509656');
  const cloak = hueShiftRamp('#d65b3a');
  const wood = hueShiftRamp('#9e673e');
  const slate = hueShiftRamp('#4c6078');

  // Tight 14-color hue-shifted palette shared across all 4 run frames
  const palette = {
    K: '#141c2c', // Shared deep cool ink & recessed dark visor
    g: moss.dark, // Deep teal-moss shadow (selout green edge)
    G: moss.mid, // Vibrant moss helmet & leaf body
    L: moss.light, // Sunlit upper-left moss dome & leaf edge
    H: moss.highlight, // Warm cream-leaf & specular catch-light
    r: cloak.dark, // Deep crimson-umber cloak shadow
    R: cloak.mid, // Warm vermilion cloak body
    O: cloak.light, // Sunlit terracotta cloak top ridge
    w: wood.dark, // Shaded oak buckler & belt
    W: wood.mid, // Warm oak buckler wood
    B: wood.light, // Sunlit buckler rim highlight
    d: slate.dark, // Dark slate boots & visor rim
    s: slate.mid, // Crisp steel boot highlight & shield boss
    E: '#fff29c', // Bright glowing visor eyes (postDraw)
  };

  // Back leg: lean ankle + grounded dark boot (darker value for clear depth)
  const backLegStamp = {
    offset: [-2, -3],
    rows: [
      '..dd..',
      '..dd..',
      '..dd..',
      '..sdd.',
      '.dddd.',
      '.dKKdd',
    ],
  };

  // Front leg: crisp steel boot cuff & forward toe
  const frontLegStamp = {
    offset: [-2, -3],
    rows: [
      '..sd..',
      '..sd..',
      '..sd..',
      '.ssdd.',
      '.sddd.',
      '.dddds',
    ],
  };

  // Compact mossy tunic with warm cloak collar & leather belt
  const torsoStamp = {
    offset: [-4, -3],
    rows: [
      '.ORRRRr.',
      'ORRRRRr.',
      '.LGGGgg.',
      '.GWWwwg.',
      '..Gggdg.',
      '...gg...',
    ],
  };

  // Iconic round moss-green knight helmet with projecting visor brow & deep dark visor
  const headStamp = {
    offset: [-6, -5],
    rows: [
      '...HLLGGg....',
      '..HLLLGGGg...',
      '.HLLGGGGGGg..',
      '.LLGGGGGGGGg.',
      '.LGGgKKKKKKK.',
      '.LGGdKKKKKKK.',
      '.GGGgKKKKKKd.',
      '.GGggKKKKKd..',
      '..gggddddd...',
      '....ggggg....',
    ],
  };

  // Bouncy twin-leaf sprout with crisp V-notch negative space & stretch/drag variants
  const crestVariants = {
    f0: {
      // Contact: trailing back slightly in the breeze
      offset: [-5, -5],
      rows: [
        '.HL.....LG..',
        'HLLG...GLLg.',
        '.GLGg..Ggg..',
        '...GGgGG....',
        '....gG......',
      ],
    },
    f1: {
      // Down/Squash: leaves flatten outward with downward inertia
      offset: [-5, -4],
      rows: [
        'HLL.....LLg.',
        '.GLGG..GGgg.',
        '...GGgGG....',
        '....gG......',
      ],
    },
    f2: {
      // Passing: perky twin-heart rebound with clear V-split
      offset: [-5, -5],
      rows: [
        '.HL...HL....',
        'HLLG.GLLg...',
        '.GLG.GGg....',
        '..GGgGG.....',
        '...gG.......',
      ],
    },
    f3: {
      // Up/Stretch: tall energetic spring with wide V-split
      offset: [-5, -5],
      rows: [
        '.HL....HL...',
        'HLLG..GLLg..',
        '.GLG..GGg...',
        '..GGg.GG....',
        '...gGg......',
        '....g.......',
      ],
    },
  };

  // Flowing downward S-curve cloak (every frame drapes downward & ripples — never a horizontal carrot!)
  const capeVariants = {
    f0: {
      // Contact: graceful S-curve sweeping down behind the hips
      offset: [-9, -1],
      rows: [
        '......OOR.',
        '....OORRR.',
        '...ORRRrR.',
        '..ORRRrrR.',
        '.ORRRr.rr.',
        '.RRRrr..r.',
        '..RRrr....',
        '...rr.....',
      ],
    },
    f1: {
      // Down/Squash: cloak bellies low with gravity
      offset: [-9, 0],
      rows: [
        '......OOR.',
        '.....ORRR.',
        '...OORRrR.',
        '..ORRRrrR.',
        '.ORRRr.rr.',
        '.RRRrr....',
        '..RRRrr...',
        '...rrr....',
      ],
    },
    f2: {
      // Passing: S-wave crest ripples downward toward tail
      offset: [-10, -1],
      rows: [
        '.......OOR.',
        '.....OORRR.',
        '....ORRRrR.',
        '..OORRRrrR.',
        '.ORRRrrr.r.',
        '.RRRrr.....',
        'RRrr.......',
        '.rr........',
      ],
    },
    f3: {
      // Up/Stretch: cloak billows gracefully down-and-back with upturned curl tip
      offset: [-10, -1],
      rows: [
        '.......OOR.',
        '.....OORRR.',
        '...OORRRrR.',
        '.OORRRrrRR.',
        '.RRRrr..rr.',
        '.RRrr......',
        '..rr.......',
      ],
    },
  };

  const frontArmStamp = {
    offset: [-1, -1],
    rows: [
      'Gg',
      'gw',
      'ww',
    ],
  };

  // Round wooden buckler shield with sunlit upper-left rim highlight & steel central boss
  const shieldStamp = {
    offset: [-3, -4],
    rows: [
      '..BBW..',
      '.BWWww.',
      'BWWsWww',
      'BWsHWww',
      'BWwwwdw',
      '.Bwwww.',
      '..www..',
    ],
  };

  const rig = createPixelRig([
    { id: 'cape', parent: 'torso', pivot: [-3, -2], z: 0, stamp: capeVariants.f0, variants: capeVariants },
    { id: 'backLeg', pivot: [0, 4], z: 1, stamp: backLegStamp },
    { id: 'frontLeg', pivot: [0, 4], z: 2, stamp: frontLegStamp },
    { id: 'torso', pivot: [0, 0], z: 3, stamp: torsoStamp },
    { id: 'head', parent: 'torso', pivot: [1, -7], z: 5, stamp: headStamp },
    { id: 'crest', parent: 'head', pivot: [0, -5], z: 6, stamp: crestVariants.f0, variants: crestVariants },
    { id: 'frontArm', parent: 'torso', pivot: [2, -1], z: 6, stamp: frontArmStamp },
    { id: 'shield', parent: 'torso', pivot: [5, 0], z: 7, stamp: shieldStamp },
  ]);

  const clip = pixelClips.bipedRun(4, { stride: 3, bob: 1 });
  const sheet = createSpriteSheet(32, 32, 4, 1);
  const root = [16, 21];

  for (let f = 0; f < 4; f++) {
    renderPixelRig(sheet.frame(f, 0), rig, root, clip[f], palette, {
      outline: 'selout',
      postDraw(frame, joints) {
        const hx = Math.round(joints.head.x);
        const hy = Math.round(joints.head.y);
        // Two crisp glowing visor eyes inside the deep recessed visor
        frame.pixel(hx + 1, hy, palette.E);
        frame.pixel(hx + 1, hy + 1, palette.E);
        frame.pixel(hx + 4, hy, palette.E);
        frame.pixel(hx + 4, hy + 1, palette.E);
      },
    });
  }

  return sheet;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = auditSpriteSheet(build(), { maxColors: 14, maxFillRatio: 0.56, maxFootDriftPx: 1 });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exit(1);
}
