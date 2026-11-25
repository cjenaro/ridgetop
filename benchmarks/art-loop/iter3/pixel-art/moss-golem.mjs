import {
  createSpriteSheet,
  hueShiftRamp,
  auditSpriteSheet,
  createPixelRig,
  renderPixelRig,
  pixelClips,
} from '../../../../packages/ridgetop/dist/framework/index.js';

export function build() {
  const stone = hueShiftRamp('#7a8d9c');
  const moss = hueShiftRamp('#4a9152');
  const amber = hueShiftRamp('#f09a2e');

  // Cohesive 13-color hue-shifted palette shared across both idle frames
  const palette = {
    K: '#141c2c', // Deep cool ink, sunken dark face cavity & carved cracks
    s: stone.dark, // Deep cool slate shadow (selout stone edge)
    S: stone.shade, // Cool mid-shadow stone planes
    M: stone.mid, // Weathered ancient stone body
    L: stone.light, // Sunlit upper-left angular stone bevels
    H: stone.highlight, // Bright top-left stone bevel catch-light
    g: moss.dark, // Deep forest-teal moss underside (selout moss edge)
    G: moss.mid, // Lush moss carpet body
    y: moss.light, // Sunlit warm yellow-green moss crown
    b: amber.dark, // Warm amber bounce light on stone around rune/eyes
    A: amber.mid, // Glowing amber-orange rune & dim eyes
    Y: amber.light, // Bright golden-yellow rune flare
    W: amber.highlight, // Incandescent cream-gold peak eye & rune core
  };

  // 100% PLANTED sturdy ancient stone stump legs with flat grounded feet & wide 4px bare gap
  const legsStamp = {
    offset: [-6, -2],
    rows: [
      '.LMMMSSssSs.',
      '.LMMMSsSSss.',
      'LMMS....MMss',
      'LMMs....MSss',
      'MMMs....SSss',
      'MMSs....SSss',
      'LMss....MSss',
      'MMss....SSss',
      'MMss....SSss',
    ],
  };

  // 100% PLANTED massive boulder fist (viewer's left — sunlit angular knuckles planted flat!)
  const leftArmStamp = {
    offset: [-4, -10],
    rows: [
      '.....HLLMS',
      '....HLLMMs',
      '...HLMMMss',
      '...LLgGMs.',
      '..HLLgGMs.',
      '..LLMMSS..',
      '..LMMMSs..',
      '..LMMSSs..',
      '..MMSSs...',
      '..MMSSs...',
      '.HLMMSs...',
      'HLLMMMSs..',
      'HLLMMMSs..',
      'LLMMMSSs..',
      'LLMMSSss..',
      'LMMsSSss..',
      'LMMsMMss..',
      'LMMSMSss..',
      'MMSSsSss..',
      'MMSSSSss..',
      '.MMSSss...',
    ],
  };

  // 100% PLANTED asymmetric boulder fist (viewer's right — shaded 3/4 view, flat grounded knuckles)
  const rightArmStamp = {
    offset: [-4, -10],
    rows: [
      'LMMSs.....',
      'LMMSSss...',
      '.MMSSss...',
      '..gGMSSs..',
      '..gMMSss..',
      '...LMSSs..',
      '...MMSSs..',
      '...MSSss..',
      '...MSSss..',
      '...MSSss..',
      '..LMMSss..',
      '..LMMSSss.',
      '..MMMSSss.',
      '..MMSSsss.',
      '..MMsSsss.',
      '..MMsMsss.',
      '..MSSSsss.',
      '..MSSsSss.',
      '..MSSSSss.',
      '...MSSss..',
    ],
  };

  // Heaving asymmetric hunched stone torso with angular lit bevel planes, cracks & tapered V-waist
  const torsoStamp = {
    offset: [-11, -12],
    rows: [
      '..HLLMMM..............',
      '.HLLMMMMMS............',
      'HLLMMMMMMMS.....LMMS..',
      'LLMMMMMMMMMS...LMMSSs.',
      'LLMMMKKMMMMMS.LMMMSSs.',
      'LMMMMMKMMMMMMMMMMMSSs.',
      'LMMMMMMMMMMMMMMMMMSSs.',
      '.LMMMMKMMMMMMMMMMMSSs.',
      '..LLMMMKMMMMMMMMMMSS..',
      '...LLMMMMMMMMMKKMMSS..',
      '....LMMMMMMMMMKMMSS...',
      '.....LMMMMMMMMMMSS....',
      '.....LMMMMMMKMMMSS....',
      '......LMMMMMMMMSS.....',
      '......LMMMMMMMSS......',
      '......LMMKMMMMSS......',
      '.......MMMKMMSS.......',
      '.......MMMMMSS........',
      '........MMSSs.........',
    ],
  };

  // Sunken dark face cavity framed by stone brow & lower jaw rim (amber bounce light on inhale!)
  const headVariants = {
    dim: {
      offset: [-6, -4],
      rows: [
        '..HLLMMMMS..',
        '.HLLMMMMSSs.',
        '.LMKKKKKKMs.',
        '.MKKKKKKKKs.',
        '.MKKKKKKKKs.',
        '.MKKKKKKKKs.',
        '..MKKKKKKs..',
        '..LMMMSSss..',
        '...MMSSss...',
      ],
    },
    bright: {
      offset: [-6, -4],
      rows: [
        '..HLLMMMMS..',
        '.HLLMMMMSSs.',
        '.LMKKKKKKMs.',
        '.MKKKKKKKKs.',
        '.MKKKKKKKKs.',
        '.MKKKKKKKKs.',
        '..bKKKKKKb..',
        '..LbbMSbss..',
        '...MMSSss...',
      ],
    },
  };

  // Lush overhanging moss carpets draped asymmetrically over hunched shoulders & brow edges
  // Varied organic hanging tendrils sway 1px on inhale while keeping the sunken eyes clear!
  const mossVariants = {
    f0: {
      offset: [-11, -4],
      rows: [
        '..yyyGGg..............',
        '.yyGGGGGGg............',
        'yyGGGGGGGGGg....yyGGg.',
        'yGGggGGGGGGGg..yGGGGgg',
        'GGg..gGGyyGGGGGGGGGGgg',
        'Gg....gGGg..gGGGGg..gg',
        'Gg.....gG....gGGg....g',
        'g......g......gG......',
        'g.............g.......',
      ],
    },
    f1: {
      offset: [-11, -4],
      rows: [
        '...yyGGg..............',
        '.yyyGGGGGg............',
        'yyGGGGGGGGGg....yGGGg.',
        'yGGggGGGGGGGg..yyGGGgg',
        'GGg..gGyyGGGGGGGGGGggg',
        'Gg....gGGg..gGGGGg..gg',
        'g......gG....gGGg...gg',
        'g......g......gG.....g',
        '...............g......',
      ],
    },
  };

  // Carved glowing chest diamond rune + warm amber bounce light on surrounding stone bevels
  const runeVariants = {
    dim: {
      offset: [-4, -3],
      rows: [
        '...bKb...',
        '..bKAKb..',
        '.bKAYAKb.',
        '..bKAKb..',
        '...bKb...',
      ],
    },
    bright: {
      offset: [-4, -3],
      rows: [
        '...bAb...',
        '..bAYAb..',
        '.bAYWYAb.',
        '..bAYAb..',
        '...bAb...',
      ],
    },
  };

  const rig = createPixelRig([
    { id: 'legs', pivot: [0, 6], z: 1, stamp: legsStamp },
    { id: 'torso', pivot: [0, 0], z: 2, stamp: torsoStamp },
    { id: 'leftArm', pivot: [-14, 2], z: 3, stamp: leftArmStamp },
    { id: 'rightArm', pivot: [12, 3], z: 3, stamp: rightArmStamp },
    { id: 'head', parent: 'torso', pivot: [1, -8], z: 4, stamp: headVariants.dim, variants: headVariants },
    { id: 'moss', parent: 'torso', pivot: [0, -12], z: 5, stamp: mossVariants.f0, variants: mossVariants },
    { id: 'rune', parent: 'torso', pivot: [0, 0], z: 6, stamp: runeVariants.dim, variants: runeVariants },
  ]);

  const clip = pixelClips.heavyBreathe(2, { heave: 2 });
  const sheet = createSpriteSheet(40, 40, 2, 1);
  const root = [20, 23];

  for (let f = 0; f < 2; f++) {
    const bright = f === 1;
    renderPixelRig(sheet.frame(f, 0), rig, root, clip[f], palette, {
      outline: 'selout',
      postDraw(frame, joints) {
        const hx = Math.round(joints.head.x);
        const hy = Math.round(joints.head.y);
        // Two glowing amber-gold rune eyes inside the deep sunken dark cavity
        const core = bright ? palette.W : palette.Y;
        const glow = bright ? palette.Y : palette.A;
        // Left eye (viewer's left)
        frame.pixel(hx - 3, hy, core);
        frame.pixel(hx - 2, hy, glow);
        frame.pixel(hx - 3, hy + 1, glow);
        frame.pixel(hx - 2, hy + 1, bright ? palette.A : palette.b);
        // Right eye (viewer's right, slightly offset for 3/4 view)
        frame.pixel(hx + 1, hy, core);
        frame.pixel(hx + 2, hy, glow);
        frame.pixel(hx + 1, hy + 1, glow);
        frame.pixel(hx + 2, hy + 1, bright ? palette.A : palette.b);
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
