import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditArtModel,
  bakeAnimatedSpritePixels,
  createArtBuilder,
  modelFromArtRecipe,
  rigFromArtRecipe,
} from '../../../../packages/ridgetop/dist/framework/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const briefsPath = resolve(__dirname, '../../briefs.json');
const briefs = JSON.parse(readFileSync(briefsPath, 'utf8'));
const palette = briefs.palette;

// ---------------------------------------------------------------------------
// 1. Fox Courier (Rigged Organic Character, 48px, idle + walk clips)
// ---------------------------------------------------------------------------
function buildFoxCourier() {
  const art = createArtBuilder('fox-courier', { frameSize: 48 });

  // Custom hero accents harmonized with the base Ridgetop palette
  art.palette('fur', '#dc6c34');
  art.palette('cream', '#f7e6c4');
  art.palette('scarf', '#2d7567');
  art.palette('leather', '#6c3f26');

  // Skeleton joints (model-space pivots; finish() auto-centers and grounds!)
  art.joint('root', undefined, [0, 0, 0]);
  art.joint('body', 'root', [0, 0.44, 0]);
  art.joint('head', 'body', [0, 0.92, 0.02]);
  art.joint('left-arm', 'body', [-0.27, 0.80, 0.0]);
  art.joint('right-arm', 'body', [0.27, 0.80, 0.0]);
  art.joint('satchel', 'body', [0.27, 0.64, -0.05]);
  art.joint('tail', 'body', [0, 0.46, -0.14]);
  art.joint('left-leg', 'root', [-0.15, 0.43, 0.0]);
  art.joint('right-leg', 'root', [0.15, 0.43, 0.0]);

  // Grounded boots with warm leather uppers and tapered fox legs (clear daylight between legs)
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    const legJoint = `${side}-leg`;
    art.solid(`${side}-boot`, 'prism', [0.19, 0.17, 0.30], 'ink', [s * 0.15, 0.085, 0.04], [0, 0, 0], {
      shade: 0.06,
      joint: legJoint,
    });
    art.between(`${side}-leg`, [s * 0.15, 0.44, 0.0], [s * 0.15, 0.15, 0.0], 0.17, 'fur', 'taper', {
      shade: -0.10,
      joint: legJoint,
    });
  }

  // Torso, cream chest fluff, and cinched courier belt
  art.solid('torso', 'prism', [0.46, 0.46, 0.36], 'fur', [0, 0.65, 0.0], [0, 0, 0], {
    joint: 'body',
  });
  art.solid('chest-fluff', 'prism', [0.28, 0.30, 0.12], 'cream', [0, 0.67, 0.15], [0, 0, 0], {
    shade: 0.06,
    joint: 'body',
  });
  art.solid('belt', 'prism', [0.50, 0.085, 0.39], 'leather', [0, 0.47, 0.01], [0, 0, 0], {
    shade: -0.08,
    joint: 'body',
  });

  // Cozy hooded neck scarf + pulled-down hood cowl + draped scarf tail
  art.solid('scarf-collar', 'prism', [0.56, 0.16, 0.48], 'scarf', [0, 0.89, 0.01], [0, 0, 0], {
    joint: 'body',
  });
  art.solid('scarf-hood', 'prism', [0.46, 0.22, 0.28], 'scarf', [0, 0.96, -0.17], [-0.42, 0, 0], {
    shade: -0.16,
    joint: 'body',
  });
  art.solid('scarf-tail', 'prism', [0.13, 0.23, 0.085], 'scarf', [-0.14, 0.75, 0.20], [-0.18, 0.08, -0.14], {
    shade: 0.15,
    joint: 'body',
  });

  // Crossbody leather strap + slung courier mailbag with contrasting flap & peeking letter
  art.between('satchel-strap', [-0.19, 0.87, 0.15], [0.27, 0.56, 0.05], [0.065, 0.05], 'leather', 'box', {
    shade: 0.10,
    joint: 'body',
  });
  art.solid('satchel-body', 'prism', [0.18, 0.27, 0.29], 'leather', [0.33, 0.49, -0.05], [0, 0, 0.12], {
    joint: 'satchel',
  });
  art.solid('satchel-flap', 'prism', [0.20, 0.11, 0.30], 'leather', [0.34, 0.58, -0.05], [0, 0, 0.12], {
    shade: 0.22,
    joint: 'satchel',
  });
  art.solid('letter-peek', 'box', [0.06, 0.12, 0.19], 'light', [0.31, 0.65, -0.07], [0, 0.06, -0.15], {
    shade: 0.04,
    joint: 'satchel',
  });

  // Arms & dark paws (clear separation from torso & satchel)
  art.between('left-arm', [-0.26, 0.80, 0.0], [-0.36, 0.52, 0.08], 0.14, 'fur', 'taper', {
    shade: -0.06,
    joint: 'left-arm',
  });
  art.solid('left-paw', 'prism', [0.125, 0.125, 0.135], 'ink', [-0.36, 0.49, 0.09], [0, 0, 0], {
    shade: 0.08,
    joint: 'left-arm',
  });
  art.between('right-arm', [0.26, 0.80, 0.02], [0.36, 0.53, 0.14], 0.14, 'fur', 'taper', {
    shade: -0.06,
    joint: 'right-arm',
  });
  art.solid('right-paw', 'prism', [0.125, 0.125, 0.135], 'ink', [0.36, 0.50, 0.15], [0, 0, 0], {
    shade: 0.08,
    joint: 'right-arm',
  });

  // Sculpted fox head: faceted oval cranium, cream cheek/muzzle mask, tapered snout, dark nose, crisp eyes
  art.solid('head', 'oval', [0.54, 0.43, 0.46], 'fur', [0, 1.15, 0.03], [0, 0, 0], {
    joint: 'head',
  });
  art.solid('muzzle-mask', 'prism', [0.58, 0.15, 0.30], 'cream', [0, 1.05, 0.18], [0, 0, 0], {
    shade: 0.03,
    joint: 'head',
  });
  art.solid('snout-top', 'wedge', [0.24, 0.15, 0.28], 'fur', [0, 1.14, 0.30], [0, 0, 0], {
    shade: 0.08,
    joint: 'head',
  });
  art.solid('nose', 'octahedron', [0.095, 0.08, 0.085], 'ink', [0, 1.09, 0.44], [0, 0, 0], {
    shade: -0.10,
    joint: 'head',
  });

  // Crisp expressive symmetric eyes with bright unlit catchlights
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    art.solid(`${side}-eye`, 'prism', [0.088, 0.105, 0.055], 'ink', [s * 0.135, 1.21, 0.228], [0, 0, 0], {
      shade: -0.12,
      joint: 'head',
    });
    art.solid(`${side}-eye-glint`, 'box', [0.046, 0.048, 0.025], 'light', [s * 0.135, 1.23, 0.252], [0, 0, 0], {
      unlit: 0.95,
      joint: 'head',
    });
  }

  // Iconic large pointed triangular fox ears with bold dark tips & dark inner hollows
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    art.solid(`${side}-ear-base`, 'taper', [0.23, 0.29, 0.14], 'fur', [s * 0.18, 1.40, 0.01], [0.05, 0, s * -0.22], {
      shade: 0.04,
      joint: 'head',
    });
    art.solid(`${side}-ear-tip`, 'cone', [0.15, 0.23, 0.105], 'ink', [s * 0.23, 1.61, 0.02], [0.05, 0, s * -0.22], {
      shade: -0.06,
      joint: 'head',
    });
    art.solid(`${side}-ear-inner`, 'prism', [0.095, 0.18, 0.055], 'ink', [s * 0.175, 1.41, 0.068], [0.05, 0, s * -0.22], {
      shade: 0.12,
      joint: 'head',
    });
  }

  // Bushy curved pale-tipped fox tail arching gracefully behind (stays clear of ears in front view!)
  art.curve(
    'tail',
    [
      [0, 0.45, -0.13],
      [0, 0.43, -0.42],
      [0, 0.68, -0.66],
      [0, 0.94, -0.55],
    ],
    [0.20, 0.29, 0.28],
    'fur',
    {
      shape: 'cylinder',
      overlap: 0.32,
      tipTone: 'cream',
      style: { joint: 'tail' },
    },
  );
  art.solid('tail-tip', 'teardrop', [0.25, 0.30, 0.25], 'cream', [0, 1.00, -0.49], [0.55, 0, 0], {
    shade: 0.08,
    joint: 'tail',
  });

  // Lively breathing & curious-glance idle clip (auto-grounded)
  const idleStart = {
    root: { position: [0, 0, 0] },
    body: { position: [0, 0, 0], rotation: [0.02, 0, 0], scale: [1, 1, 1] },
    head: { rotation: [0.0, 0.08, 0.03] },
    'left-arm': { rotation: [0.06, 0, 0.04] },
    'right-arm': { rotation: [-0.04, 0, -0.04] },
    tail: { rotation: [0.04, 0.20, 0] },
    satchel: { rotation: [0.02, 0, 0.02] },
    'left-leg': { rotation: [0, 0, 0] },
    'right-leg': { rotation: [0, 0, 0] },
  };
  art.clip(
    'idle',
    {
      duration: 1.6,
      loop: true,
      easing: 'easeInOut',
      frames: [
        { time: 0, poses: idleStart },
        {
          time: 0.8,
          poses: {
            root: { position: [0, 0, 0] },
            body: { position: [0, 0.028, 0], rotation: [-0.03, 0, 0], scale: [1.025, 1.04, 1.025] },
            head: { rotation: [-0.06, -0.12, -0.04] },
            'left-arm': { rotation: [-0.05, 0, 0.08] },
            'right-arm': { rotation: [0.06, 0, -0.08] },
            tail: { rotation: [0.14, -0.22, 0] },
            satchel: { rotation: [-0.05, 0, 0.06] },
            'left-leg': { rotation: [0, 0, 0] },
            'right-leg': { rotation: [0, 0, 0] },
          },
        },
        { time: 1.6, poses: idleStart },
      ],
    },
    { autoGround: true },
  );

  // Expressive indie walk cycle: strong stride, opposite arm swing, double bounce, tail wag & satchel swing
  const walkStrideA = {
    root: { position: [0, 0, 0] },
    body: { position: [0, 0.0, 0], rotation: [0.11, 0.11, 0.03] },
    head: { rotation: [-0.07, -0.07, -0.03] },
    'left-leg': { rotation: [-0.54, 0, 0] },
    'right-leg': { rotation: [0.54, 0, 0] },
    'left-arm': { rotation: [0.48, 0, 0.08] },
    'right-arm': { rotation: [-0.46, 0, -0.08] },
    tail: { rotation: [0.12, -0.34, 0] },
    satchel: { rotation: [0.20, 0, 0.09] },
  };
  const walkPassA = {
    root: { position: [0, 0, 0] },
    body: { position: [0, 0.055, 0], rotation: [0.08, 0, -0.02] },
    head: { rotation: [-0.04, 0, 0.02] },
    'left-leg': { rotation: [0.08, 0, 0] },
    'right-leg': { rotation: [-0.16, 0, 0] },
    'left-arm': { rotation: [0.04, 0, 0.04] },
    'right-arm': { rotation: [-0.04, 0, -0.04] },
    tail: { rotation: [-0.04, 0.04, 0] },
    satchel: { rotation: [-0.06, 0, -0.03] },
  };
  const walkStrideB = {
    root: { position: [0, 0, 0] },
    body: { position: [0, 0.0, 0], rotation: [0.11, -0.11, -0.03] },
    head: { rotation: [-0.07, 0.07, 0.03] },
    'left-leg': { rotation: [0.54, 0, 0] },
    'right-leg': { rotation: [-0.54, 0, 0] },
    'left-arm': { rotation: [-0.46, 0, 0.08] },
    'right-arm': { rotation: [0.48, 0, -0.08] },
    tail: { rotation: [0.12, 0.34, 0] },
    satchel: { rotation: [-0.18, 0, 0.04] },
  };
  const walkPassB = {
    root: { position: [0, 0, 0] },
    body: { position: [0, 0.055, 0], rotation: [0.08, 0, 0.02] },
    head: { rotation: [-0.04, 0, -0.02] },
    'left-leg': { rotation: [-0.16, 0, 0] },
    'right-leg': { rotation: [0.08, 0, 0] },
    'left-arm': { rotation: [-0.04, 0, 0.04] },
    'right-arm': { rotation: [0.04, 0, -0.04] },
    tail: { rotation: [-0.04, -0.04, 0] },
    satchel: { rotation: [0.06, 0, 0.07] },
  };
  art.clip(
    'walk',
    {
      duration: 0.72,
      loop: true,
      easing: 'easeInOut',
      frames: [
        { time: 0, poses: walkStrideA },
        { time: 0.18, poses: walkPassA },
        { time: 0.36, poses: walkStrideB },
        { time: 0.54, poses: walkPassB },
        { time: 0.72, poses: walkStrideA },
      ],
    },
    { autoGround: true },
  );

  return art.finish();
}

// ---------------------------------------------------------------------------
// 2. Apothecary Storm Lantern (Hero Prop, 48px, Silhouette + Translucent Glow)
// ---------------------------------------------------------------------------
function buildApothecaryLantern() {
  const art = createArtBuilder('apothecary-lantern', { frameSize: 48 });

  // Custom hero material accents (forged gunmetal iron pops cleanly on both dark & light backdrops)
  art.palette('brass', '#dda43e');
  art.palette('iron', '#415366');
  art.palette('glass', '#cdeef7');
  art.palette('ember', '#ffae3b');

  // Tiered octagonal base (dark grounded foot + stepped antique brass gallery)
  art.solid('base-foot', 'prism', [0.76, 0.095, 0.76], 'iron', [0, 0.048, 0], [0, Math.PI / 8, 0], {
    shade: -0.22,
  });
  art.solid('base-tier-1', 'prism', [0.64, 0.115, 0.64], 'brass', [0, 0.145, 0], [0, 0, 0], {
    shade: -0.10,
  });
  art.solid('base-tier-2', 'taper', [0.54, 0.12, 0.54], 'brass', [0, 0.25, 0], [0, 0, 0], {
    shade: 0.12,
  });
  art.solid('burner-ring', 'ring', [0.46, 0.055, 0.46], 'iron', [0, 0.33, 0], [0, 0, 0], {
    shade: -0.06,
  });

  // Warm unlit glowing ember core inside a translucent sea-glass chamber
  art.solid('ember-bed', 'dome', [0.30, 0.14, 0.30], 'ember', [0, 0.38, 0], [0, 0, 0], {
    unlit: 0.90,
  });
  art.solid('ember-flame', 'teardrop', [0.22, 0.46, 0.22], 'light', [0, 0.65, 0], [0, 0, 0], {
    unlit: 0.98,
  });
  art.solid('glass-chamber', 'cylinder', [0.44, 0.34, 0.44], 'glass', [0, 0.73, 0], [0, 0, 0], {
    alpha: 0.30,
    blend: 'alpha',
    shade: 0.10,
  });

  // Four bowed forged-iron protective corner cage ribs using curve() — bold enough for unbroken 48px silhouette!
  const ribCorners = [
    ['fl', -1, 1],
    ['fr', 1, 1],
    ['bl', -1, -1],
    ['br', 1, -1],
  ];
  const diag = Math.SQRT1_2;
  for (const [tag, sx, sz] of ribCorners) {
    art.curve(
      `rib-${tag}`,
      [
        [sx * 0.26 * diag, 0.29, sz * 0.26 * diag],
        [sx * 0.40 * diag, 0.50, sz * 0.40 * diag],
        [sx * 0.40 * diag, 0.76, sz * 0.40 * diag],
        [sx * 0.27 * diag, 0.96, sz * 0.27 * diag],
      ],
      0.058,
      'iron',
      {
        shape: 'cylinder',
        overlap: 0.32,
        style: { shade: 0.14 },
      },
    );
  }

  // Domed rain cap with wide overhanging brass brim and tall chimney vent
  art.solid('rain-brim', 'cone', [0.80, 0.16, 0.80], 'brass', [0, 1.03, 0], [0, 0, 0], {
    shade: 0.12,
  });
  art.solid('rain-dome', 'dome', [0.52, 0.21, 0.52], 'iron', [0, 1.13, 0], [0, 0, 0], {
    shade: -0.06,
  });
  art.solid('chimney-vent', 'cylinder', [0.24, 0.19, 0.24], 'brass', [0, 1.27, 0], [0, 0, 0], {
    shade: 0.04,
  });
  art.solid('chimney-cap', 'cone', [0.34, 0.10, 0.34], 'iron', [0, 1.38, 0], [0, 0, 0], {
    shade: -0.10,
  });

  // Tall open overhead arched carry handle with crisp brass bail lugs & wide negative-space daylight loop
  art.solid('lug-left', 'prism', [0.09, 0.09, 0.09], 'brass', [-0.29, 1.09, 0], [0, 0, 0], {
    shade: 0.16,
  });
  art.solid('lug-right', 'prism', [0.09, 0.09, 0.09], 'brass', [0.29, 1.09, 0], [0, 0, 0], {
    shade: 0.16,
  });
  art.curve(
    'carry-handle',
    [
      [-0.29, 1.10, 0],
      [-0.33, 1.38, 0],
      [-0.20, 1.63, 0],
      [0.0, 1.72, 0],
      [0.20, 1.63, 0],
      [0.33, 1.38, 0],
      [0.29, 1.10, 0],
    ],
    0.062,
    'iron',
    {
      shape: 'cylinder',
      overlap: 0.34,
      style: { shade: 0.18 },
    },
  );

  return art.finish();
}

// ---------------------------------------------------------------------------
// 3. Windswept Cliff Cottage (Stylized Architecture, 64px)
// ---------------------------------------------------------------------------
function buildWindsweptCottage() {
  const art = createArtBuilder('windswept-cottage', { frameSize: 64 });

  // Custom coastal architecture palette accents
  art.palette('slate', '#3d586e');
  art.palette('timber', '#ba7c4d');
  art.palette('cobble', '#728592');
  art.palette('brass', '#e4a849');

  // Stone foundation plinth + front doorstep + asymmetric cliff boulder
  art.solid('stone-plinth', 'prism', [1.48, 0.26, 1.24], 'cobble', [0, 0.13, 0], [0, 0, 0], {
    shade: -0.22,
  });
  art.solid('porch-step', 'prism', [0.60, 0.13, 0.38], 'cobble', [-0.22, 0.065, 0.72], [0, 0, 0], {
    shade: -0.05,
  });
  art.solid('cliff-rock', 'prism', [0.36, 0.20, 0.32], 'cobble', [0.68, 0.10, 0.48], [0, 0.30, 0], {
    shade: -0.30,
  });

  // Warm timber walls, dark timber sill beam, four corner timber posts, and true pitched gable attic
  art.solid('wall-sill', 'box', [1.32, 0.09, 1.09], 'wood', [0, 0.295, 0], [0, 0, 0], {
    shade: -0.16,
  });
  art.solid('wall-core', 'box', [1.26, 0.68, 1.04], 'timber', [0, 0.62, 0]);
  art.solid('gable-attic', 'gable', [1.26, 0.58, 1.04], 'timber', [0, 1.25, 0], [0, 0, 0], {
    shade: 0.12,
  });
  for (const [tag, sx, sz] of [['fl', -1, 1], ['fr', 1, 1], ['bl', -1, -1], ['br', 1, -1]]) {
    art.solid(`post-${tag}`, 'box', [0.11, 0.72, 0.11], 'wood', [sx * 0.61, 0.62, sz * 0.50], [0, 0, 0], {
      shade: -0.24,
    });
  }

  // Overhanging pitched roof planes + smoothly flared wedge eaves + proud lighter ridge beam
  const roofAngle = Math.atan2(0.58, 0.63);
  art.solid('roof-left', 'prism', [1.08, 0.11, 1.38], 'slate', [-0.39, 1.24, 0], [0, 0, roofAngle], {
    shade: -0.02,
  });
  art.solid('roof-right', 'prism', [1.08, 0.11, 1.38], 'slate', [0.39, 1.24, 0], [0, 0, -roofAngle], {
    shade: -0.09,
  });
  // Flared windswept wedge eaves seated level front-to-back along the lower roof edges
  // Note: Euler applies roll -> pitch -> yaw, so pitch tilts the wedge around its lengthwise axis before yaw!
  art.solid('eave-left', 'wedge', [1.38, 0.13, 0.22], 'slate', [-0.80, 0.88, 0], [0.22, -Math.PI / 2, 0], {
    shade: 0.12,
  });
  art.solid('eave-right', 'wedge', [1.38, 0.13, 0.22], 'slate', [0.80, 0.88, 0], [0.22, Math.PI / 2, 0], {
    shade: 0.05,
  });
  art.solid('roof-ridge', 'prism', [0.17, 0.14, 1.44], 'slate', [0, 1.60, 0], [0, 0, 0], {
    shade: 0.22,
  });
  // Horizontal timber tie-beam separating lower wall from upper gable triangle
  art.solid('gable-beam', 'box', [1.28, 0.08, 0.08], 'wood', [0, 0.97, 0.52], [0, 0, 0], {
    shade: -0.20,
  });

  // Raised slightly windswept stone chimney on the right slope with terracotta pot
  art.solid('chimney-stack', 'prism', [0.30, 0.90, 0.30], 'cobble', [0.46, 1.48, -0.18], [0, 0, -0.05], {
    shade: 0.10,
  });
  art.solid('chimney-collar', 'prism', [0.37, 0.10, 0.37], 'cobble', [0.48, 1.92, -0.18], [0, 0, -0.05], {
    shade: -0.14,
  });
  art.solid('chimney-pot', 'taper', [0.19, 0.18, 0.19], 'accent', [0.49, 2.04, -0.18], [0, 0, -0.05], {
    shade: -0.14,
  });

  // Framed front doorway (left-of-center) + sloped wedge porch awning + grounded porch posts
  art.solid('door-frame', 'prism', [0.44, 0.58, 0.10], 'wood', [-0.22, 0.56, 0.53], [0, 0, 0], {
    shade: -0.26,
  });
  art.solid('door-panel', 'box', [0.32, 0.50, 0.08], 'accent', [-0.22, 0.53, 0.56], [0, 0, 0], {
    shade: -0.18,
  });
  art.solid('door-knob', 'box', [0.06, 0.06, 0.06], 'brass', [-0.10, 0.53, 0.61], [0, 0, 0], {
    shade: 0.18,
  });
  art.solid('porch-awning', 'wedge', [0.66, 0.19, 0.38], 'slate', [-0.22, 0.93, 0.69], [0, 0, 0], {
    shade: 0.14,
  });
  art.solid('porch-post-l', 'cylinder', [0.07, 0.72, 0.07], 'wood', [-0.47, 0.49, 0.82], [0, 0, 0], {
    shade: -0.18,
  });
  art.solid('porch-post-r', 'cylinder', [0.07, 0.72, 0.07], 'wood', [0.03, 0.49, 0.82], [0, 0, 0], {
    shade: -0.18,
  });

  // Glowing round porthole window facing forward (single luminous hero focal point!)
  art.disc('porthole-frame', 'wall-core', 'front', 0.43, 0.09, 'brass', [0.30, 0.03, 0], 'ring', {
    shade: 0.10,
  });
  art.disc('porthole-glow', 'wall-core', 'front', 0.31, 0.065, 'light', [0.30, 0.03, 0], 'cylinder', {
    unlit: 0.96,
  });

  // Front attic vent louver + coastal green side & rear shutters + stacked firewood log for 360-degree richness
  art.solid('attic-vent', 'prism', [0.22, 0.18, 0.08], 'ink', [0, 1.24, 0.52], [0, 0, 0], {
    shade: 0.06,
  });
  art.solid('side-shutter', 'prism', [0.08, 0.34, 0.30], 'leaf', [-0.65, 0.64, 0.06], [0, 0, 0], {
    shade: -0.04,
  });
  art.solid('back-shutter', 'prism', [0.34, 0.32, 0.08], 'leaf', [-0.12, 0.64, -0.54], [0, 0, 0], {
    shade: -0.06,
  });
  art.solid('log-stack', 'cylinder', [0.18, 0.46, 0.18], 'wood', [-0.74, 0.34, -0.18], [Math.PI / 2, 0, 0], {
    shade: 0.08,
  });

  return art.finish();
}

// ---------------------------------------------------------------------------
// Generate, Validate, Audit, and Write Outputs
// ---------------------------------------------------------------------------
mkdirSync(__dirname, { recursive: true });

const assets = [
  { id: 'fox-courier', frameSize: 48, animated: true, recipe: buildFoxCourier() },
  { id: 'apothecary-lantern', frameSize: 48, animated: false, recipe: buildApothecaryLantern() },
  { id: 'windswept-cottage', frameSize: 64, animated: false, recipe: buildWindsweptCottage() },
];

let allPassed = true;

for (const asset of assets) {
  const outPath = resolve(__dirname, `${asset.id}.art.json`);
  writeFileSync(outPath, `${JSON.stringify(asset.recipe, null, 2)}\n`, 'utf8');

  const model = modelFromArtRecipe(asset.recipe);
  const report = auditArtModel(model, {
    palette,
    frameSize: asset.frameSize,
    maxTriangles: 1500,
  });

  console.log(`\n=== ${asset.id} (${asset.frameSize}px) ===`);
  console.log(JSON.stringify(report, null, 2));

  if (!report.passed || report.warnings.length > 0) {
    allPassed = false;
  }

  if (asset.animated) {
    const rig = rigFromArtRecipe(asset.recipe, palette);
    console.log(`Rig joints: ${rig.rig.joints.length}, clips: ${Object.keys(rig.clips).join(', ')}`);

    const bakedWalk = bakeAnimatedSpritePixels(asset.recipe, {
      clip: 'walk',
      frames: 4,
      frameSize: asset.frameSize,
      directions: ['front', 'right'],
      palette,
    });

    const rowLabels = ['front', 'right'];
    for (let r = 0; r < rowLabels.length; r++) {
      const bottoms = [];
      const frameBuffers = [];
      for (let f = 0; f < 4; f++) {
        let maxY = -1;
        const buf = new Uint8Array(asset.frameSize * asset.frameSize * 4);
        for (let py = 0; py < asset.frameSize; py++) {
          for (let px = 0; px < asset.frameSize; px++) {
            const sx = f * asset.frameSize + px;
            const sy = r * asset.frameSize + py;
            const srcIdx = (sy * bakedWalk.width + sx) * 4;
            const dstIdx = (py * asset.frameSize + px) * 4;
            const a = bakedWalk.pixels[srcIdx + 3];
            buf[dstIdx] = bakedWalk.pixels[srcIdx];
            buf[dstIdx + 1] = bakedWalk.pixels[srcIdx + 1];
            buf[dstIdx + 2] = bakedWalk.pixels[srcIdx + 2];
            buf[dstIdx + 3] = a;
            if (a > 16 && py > maxY) maxY = py;
          }
        }
        bottoms.push(maxY);
        frameBuffers.push(buf);
      }
      const footDriftPx = Math.max(...bottoms) - Math.min(...bottoms);
      let diffSum = 0;
      for (let f = 0; f < 4; f++) {
        const next = frameBuffers[(f + 1) % 4];
        const cur = frameBuffers[f];
        let changed = 0;
        for (let i = 0; i < cur.length; i += 4) {
          if (
            Math.abs(cur[i] - next[i]) +
            Math.abs(cur[i + 1] - next[i + 1]) +
            Math.abs(cur[i + 2] - next[i + 2]) +
            Math.abs(cur[i + 3] - next[i + 3]) > 32
          ) {
            changed++;
          }
        }
        diffSum += changed;
      }
      console.log(
        `  walk[${rowLabels[r]}]: bottoms=${JSON.stringify(bottoms)}, footDriftPx=${footDriftPx}, avgFrameDiffPx=${Math.round(diffSum / 4)}`,
      );
      if (footDriftPx > 2) allPassed = false;
    }
  }
}

if (!allPassed) {
  console.error('\nAudit failed on one or more assets!');
  process.exitCode = 1;
} else {
  console.log('\nAll 3 assets passed audit with 0 warnings!');
}
