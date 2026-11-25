import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditArtModel,
  bakeAnimatedSpritePixels,
  createArtBuilder,
  modelFromArtRecipe,
  rigFromArtRecipe
} from '../../../../packages/ridgetop/dist/framework/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const briefs = JSON.parse(readFileSync(resolve(here, '../../briefs.json'), 'utf8'));
const sharedPalette = briefs.palette;

function buildFoxCourier() {
  const art = createArtBuilder('fox-courier', { frameSize: 48 });

  // Luminous cozy indie palette extending shared base roles
  art.palette('fur', '#ee813c');
  art.palette('cream', '#fff3d9');
  art.palette('scarf', '#2f8276');
  art.palette('leather', '#945c37');
  art.palette('brass', '#f4c85b');
  art.palette('boot', '#445064');

  // Rig skeleton (autoGround uses 'root')
  art.joint('root', undefined, [0, 0, 0]);
  art.joint('torso', 'root', [0, 0.46, 0]);
  art.joint('head', 'torso', [0, 0.94, 0.02]);
  art.joint('tail', 'torso', [0, 0.50, -0.16]);
  art.joint('bag', 'torso', [0.27, 0.56, -0.02]);
  art.joint('leftLeg', 'root', [-0.14, 0.46, 0]);
  art.joint('rightLeg', 'root', [0.14, 0.46, 0]);
  art.joint('leftArm', 'torso', [-0.27, 0.80, 0]);
  art.joint('rightArm', 'torso', [0.27, 0.80, 0]);

  // Grounded legs & courier boots with bright cream cuffs framing dark boots
  for (const [side, s, legJoint] of [
    ['left', -1, 'leftLeg'],
    ['right', 1, 'rightLeg']
  ]) {
    art.solid(
      `${side}-boot`,
      'prism',
      [0.19, 0.17, 0.29],
      'boot',
      [s * 0.14, 0.085, 0.05],
      [0, 0, 0],
      { shade: -0.12, joint: legJoint }
    );
    art.solid(
      `${side}-cuff`,
      'cylinder',
      [0.175, 0.08, 0.195],
      'cream',
      [s * 0.14, 0.20, 0.01],
      [0, 0, 0],
      { shade: 0.06, joint: legJoint }
    );
    art.between(
      `${side}-leg`,
      [s * 0.14, 0.48, 0],
      [s * 0.14, 0.22, 0.01],
      0.16,
      'fur',
      'taper',
      { shade: -0.08, joint: legJoint }
    );
  }

  // Torso, cream belly bib, leather belt & brass buckle
  art.solid('torso', 'prism', [0.48, 0.46, 0.36], 'fur', [0, 0.65, 0], [0, 0, 0], {
    joint: 'torso'
  });
  art.solid('belly', 'prism', [0.30, 0.34, 0.14], 'cream', [0, 0.64, 0.14], [0, 0, 0], {
    shade: 0.04,
    joint: 'torso'
  });
  art.solid('belt', 'box', [0.52, 0.08, 0.40], 'leather', [0, 0.48, 0.01], [0, 0, 0], {
    shade: -0.22,
    joint: 'torso'
  });
  art.solid('belt-buckle', 'box', [0.12, 0.10, 0.06], 'brass', [0, 0.48, 0.21], [0, 0, 0], {
    unlit: 0.35,
    joint: 'torso'
  });

  // Cozy hooded neck scarf
  art.solid('scarf-collar', 'prism', [0.58, 0.17, 0.46], 'scarf', [0, 0.89, 0.02], [0, 0, 0], {
    shade: 0.06,
    joint: 'torso'
  });
  art.solid(
    'scarf-hood',
    'prism',
    [0.46, 0.21, 0.26],
    'scarf',
    [0, 0.91, -0.20],
    [-0.28, 0, 0],
    { shade: -0.10, joint: 'torso' }
  );
  art.solid(
    'scarf-tail',
    'prism',
    [0.14, 0.26, 0.09],
    'scarf',
    [-0.14, 0.72, 0.21],
    [0.10, 0, 0.12],
    { shade: 0.14, joint: 'torso' }
  );

  // Arms angled slightly outward for clear negative space against torso
  for (const [side, s, armJoint] of [
    ['left', -1, 'leftArm'],
    ['right', 1, 'rightArm']
  ]) {
    art.between(
      `${side}-arm`,
      [s * 0.26, 0.81, 0.0],
      [s * 0.39, 0.50, 0.05],
      0.145,
      'fur',
      'taper',
      { shade: -0.05, joint: armJoint }
    );
    art.solid(
      `${side}-paw`,
      'prism',
      [0.12, 0.13, 0.13],
      'boot',
      [s * 0.40, 0.47, 0.06],
      [0, 0, s * 0.12],
      { shade: -0.10, joint: armJoint }
    );
  }

  // Diagonal courier strap across torso + slung leather mailbag on right hip
  art.between(
    'bag-strap-front',
    [-0.18, 0.88, 0.19],
    [0.27, 0.56, 0.12],
    [0.07, 0.05],
    'leather',
    'box',
    { shade: -0.16, joint: 'torso' }
  );
  art.between(
    'bag-strap-back',
    [-0.18, 0.88, -0.17],
    [0.27, 0.56, -0.12],
    [0.07, 0.05],
    'leather',
    'box',
    { shade: -0.20, joint: 'torso' }
  );
  art.solid(
    'mailbag',
    'prism',
    [0.18, 0.30, 0.30],
    'leather',
    [0.33, 0.48, -0.01],
    [0, 0, 0.14],
    { joint: 'bag' }
  );
  art.solid(
    'mailbag-flap',
    'prism',
    [0.20, 0.13, 0.32],
    'leather',
    [0.35, 0.58, -0.01],
    [0, 0, 0.18],
    { shade: 0.14, joint: 'bag' }
  );
  art.solid(
    'mailbag-clasp',
    'box',
    [0.06, 0.08, 0.08],
    'brass',
    [0.44, 0.52, 0.02],
    [0, 0, 0.16],
    { unlit: 0.45, joint: 'bag' }
  );
  art.solid(
    'mailbag-letter',
    'box',
    [0.06, 0.15, 0.18],
    'light',
    [0.31, 0.67, -0.05],
    [0.10, 0, -0.16],
    { unlit: 0.25, joint: 'bag' }
  );

  // Expressive Fox Head, fluffy cheek tufts, tapered snout, dark nose, flush eyes, big pointed ears
  art.solid('head', 'oval', [0.50, 0.42, 0.44], 'fur', [0, 1.15, 0.03], [0, 0, 0], {
    shade: 0.05,
    joint: 'head'
  });
  art.solid(
    'cheek-left',
    'wedge',
    [0.17, 0.15, 0.21],
    'cream',
    [-0.22, 1.07, 0.08],
    [0.10, -Math.PI / 2, 0],
    { shade: 0.06, joint: 'head' }
  );
  art.solid(
    'cheek-right',
    'wedge',
    [0.17, 0.15, 0.21],
    'cream',
    [0.22, 1.07, 0.08],
    [0.10, Math.PI / 2, 0],
    { shade: 0.06, joint: 'head' }
  );
  art.between(
    'snout',
    [0, 1.13, 0.15],
    [0, 1.09, 0.45],
    [0.25, 0.20],
    'fur',
    'taper',
    { shade: 0.12, joint: 'head' }
  );
  art.solid(
    'snout-chin',
    'prism',
    [0.18, 0.08, 0.22],
    'cream',
    [0, 1.04, 0.27],
    [0.08, 0, 0],
    { shade: 0.08, joint: 'head' }
  );
  art.solid('nose', 'octahedron', [0.095, 0.085, 0.095], 'ink', [0, 1.10, 0.46], [0, 0, 0], {
    shade: -0.28,
    joint: 'head'
  });
  for (const [side, s] of [
    ['left', -1],
    ['right', 1]
  ]) {
    art.solid(
      `${side}-eye`,
      'prism',
      [0.075, 0.09, 0.05],
      'ink',
      [s * 0.135, 1.205, 0.21],
      [0, s * 0.28, 0],
      { shade: -0.35, joint: 'head' }
    );
    art.solid(
      `${side}-eye-glint`,
      'box',
      [0.032, 0.036, 0.022],
      'light',
      [s * 0.124, 1.225, 0.228],
      [0, s * 0.28, 0],
      { unlit: 0.95, joint: 'head' }
    );
    // Iconic tall pointed fox ears with dark tips & inner dark hollows
    art.solid(
      `${side}-ear`,
      'cone',
      [0.21, 0.39, 0.15],
      'fur',
      [s * 0.19, 1.46, -0.01],
      [0.06, s * 0.12, -s * 0.24],
      { shade: 0.04, joint: 'head' }
    );
    art.solid(
      `${side}-ear-tip`,
      'cone',
      [0.115, 0.17, 0.095],
      'ink',
      [s * 0.235, 1.60, 0.0],
      [0.06, s * 0.12, -s * 0.24],
      { shade: -0.24, joint: 'head' }
    );
    art.solid(
      `${side}-ear-inner`,
      'cone',
      [0.12, 0.25, 0.06],
      'ink',
      [s * 0.185, 1.44, 0.055],
      [0.06, s * 0.12, -s * 0.24],
      { shade: -0.10, joint: 'head' }
    );
  }

  // Lush sweeping curved pale-tipped fox tail (4 smooth segments via curve() with overlap: 0)
  art.curve(
    'tail',
    [
      [0, 0.50, -0.15],
      [0, 0.43, -0.34],
      [0, 0.47, -0.53],
      [0, 0.64, -0.68],
      [0, 0.87, -0.74]
    ],
    [0.16, 0.23, 0.27, 0.29],
    'fur',
    { shape: 'cylinder', overlap: 0, style: { shade: 0.02, joint: 'tail' } }
  );
  art.solid(
    'tail-tip',
    'teardrop',
    [0.29, 0.36, 0.29],
    'cream',
    [0, 0.98, -0.75],
    [-0.24, 0, 0],
    { shade: 0.10, joint: 'tail' }
  );

  // Expressive grounded walk cycle (readable at 48 px!)
  art.clip(
    'walk',
    {
      duration: 0.64,
      loop: true,
      easing: 'smooth',
      frames: [
        {
          time: 0,
          poses: {
            torso: { position: [0, -0.02, 0], rotation: [0.11, -0.11, 0.03] },
            head: { rotation: [-0.08, 0.09, -0.03] },
            leftLeg: { rotation: [-0.54, 0, 0] },
            rightLeg: { rotation: [0.52, 0, 0] },
            leftArm: { rotation: [0.46, 0, 0.06] },
            rightArm: { rotation: [-0.46, 0, -0.06] },
            tail: { rotation: [0.10, 0.34, 0.08] },
            bag: { rotation: [0.18, 0, 0.10] }
          }
        },
        {
          time: 0.16,
          poses: {
            torso: { position: [0, 0.055, 0], rotation: [0.06, 0, 0] },
            head: { rotation: [-0.04, 0, 0] },
            leftLeg: { rotation: [-0.08, 0, 0] },
            rightLeg: { rotation: [0.10, 0, 0] },
            leftArm: { rotation: [0.06, 0, 0.03] },
            rightArm: { rotation: [-0.06, 0, -0.03] },
            tail: { rotation: [0.26, 0, 0] },
            bag: { rotation: [-0.05, 0, 0.03] }
          }
        },
        {
          time: 0.32,
          poses: {
            torso: { position: [0, -0.02, 0], rotation: [0.11, 0.11, -0.03] },
            head: { rotation: [-0.08, -0.09, 0.03] },
            leftLeg: { rotation: [0.52, 0, 0] },
            rightLeg: { rotation: [-0.54, 0, 0] },
            leftArm: { rotation: [-0.46, 0, 0.06] },
            rightArm: { rotation: [0.46, 0, -0.06] },
            tail: { rotation: [0.10, -0.34, -0.08] },
            bag: { rotation: [-0.18, 0, 0.14] }
          }
        },
        {
          time: 0.48,
          poses: {
            torso: { position: [0, 0.055, 0], rotation: [0.06, 0, 0] },
            head: { rotation: [-0.04, 0, 0] },
            leftLeg: { rotation: [0.10, 0, 0] },
            rightLeg: { rotation: [-0.08, 0, 0] },
            leftArm: { rotation: [-0.06, 0, 0.03] },
            rightArm: { rotation: [0.06, 0, -0.03] },
            tail: { rotation: [0.26, 0, 0] },
            bag: { rotation: [0.05, 0, 0.03] }
          }
        },
        {
          time: 0.64,
          poses: {
            torso: { position: [0, -0.02, 0], rotation: [0.11, -0.11, 0.03] },
            head: { rotation: [-0.08, 0.09, -0.03] },
            leftLeg: { rotation: [-0.54, 0, 0] },
            rightLeg: { rotation: [0.52, 0, 0] },
            leftArm: { rotation: [0.46, 0, 0.06] },
            rightArm: { rotation: [-0.46, 0, -0.06] },
            tail: { rotation: [0.10, 0.34, 0.08] },
            bag: { rotation: [0.18, 0, 0.10] }
          }
        }
      ]
    },
    { autoGround: true }
  );

  // Lively breathing & glance idle clip
  art.clip(
    'idle',
    {
      duration: 1.6,
      loop: true,
      easing: 'smooth',
      frames: [
        {
          time: 0,
          poses: {
            torso: { position: [0, 0, 0], rotation: [0.02, 0, 0] },
            head: { rotation: [0, 0, 0] },
            leftArm: { rotation: [0.04, 0, 0.04] },
            rightArm: { rotation: [-0.04, 0, -0.04] },
            tail: { rotation: [0.04, -0.18, 0] },
            bag: { rotation: [0.02, 0, 0.02] }
          }
        },
        {
          time: 0.4,
          poses: {
            torso: { position: [0, 0.03, 0], rotation: [-0.02, 0.03, 0] },
            head: { rotation: [-0.04, 0.14, 0.04] },
            leftArm: { rotation: [-0.04, 0, 0.08] },
            rightArm: { rotation: [0.04, 0, -0.08] },
            tail: { rotation: [0.12, 0.04, 0.03] },
            bag: { rotation: [-0.04, 0, 0.05] }
          }
        },
        {
          time: 0.8,
          poses: {
            torso: { position: [0, 0.01, 0], rotation: [0.02, 0, 0] },
            head: { rotation: [0.02, 0.06, 0] },
            leftArm: { rotation: [0.03, 0, 0.04] },
            rightArm: { rotation: [-0.03, 0, -0.04] },
            tail: { rotation: [0.06, 0.22, 0] },
            bag: { rotation: [0.03, 0, 0.02] }
          }
        },
        {
          time: 1.2,
          poses: {
            torso: { position: [0, 0.03, 0], rotation: [-0.02, -0.03, 0] },
            head: { rotation: [-0.03, -0.14, -0.04] },
            leftArm: { rotation: [-0.03, 0, 0.08] },
            rightArm: { rotation: [0.03, 0, -0.08] },
            tail: { rotation: [0.12, -0.04, -0.03] },
            bag: { rotation: [-0.03, 0, 0.05] }
          }
        },
        {
          time: 1.6,
          poses: {
            torso: { position: [0, 0, 0], rotation: [0.02, 0, 0] },
            head: { rotation: [0, 0, 0] },
            leftArm: { rotation: [0.04, 0, 0.04] },
            rightArm: { rotation: [-0.04, 0, -0.04] },
            tail: { rotation: [0.04, -0.18, 0] },
            bag: { rotation: [0.02, 0, 0.02] }
          }
        }
      ]
    },
    { autoGround: true }
  );

  return art.finish();
}

function buildApothecaryLantern() {
  const art = createArtBuilder('apothecary-lantern', { frameSize: 48 });

  // Warm antique brass + hammered forged iron + pale sea-glass + incandescent ember core
  art.palette('brass', '#edb953');
  art.palette('iron', '#4d5d72');
  art.palette('glass', '#c8f4ed');
  art.palette('ember', '#ff9426');
  art.palette('flame', '#fff6cc');

  // Tiered octagonal base (forged iron anchored + gleaming brass accent steps)
  art.solid('base-plinth', 'prism', [0.88, 0.13, 0.88], 'iron', [0, 0.065, 0], [0, 0, 0], {
    shade: -0.16
  });
  art.solid('base-brass-step', 'prism', [0.76, 0.095, 0.76], 'brass', [0, 0.175, 0], [0, 0, 0], {
    shade: 0.10
  });
  art.solid('base-collar', 'prism', [0.62, 0.11, 0.62], 'iron', [0, 0.275, 0], [0, 0, 0], {
    shade: 0.04
  });
  art.solid('base-seat-ring', 'prism', [0.58, 0.055, 0.58], 'brass', [0, 0.345, 0], [0, 0, 0], {
    shade: 0.18
  });

  // Glowing ember core + flame inside closed translucent glass globe
  art.solid('burner-cup', 'taper', [0.28, 0.11, 0.28], 'brass', [0, 0.40, 0], [0, 0, 0], {
    shade: -0.08
  });
  art.solid('ember-core', 'octahedron', [0.29, 0.28, 0.29], 'ember', [0, 0.56, 0], [0, 0.4, 0], {
    unlit: 0.96
  });
  art.solid('flame-heart', 'teardrop', [0.19, 0.36, 0.19], 'flame', [0, 0.73, 0], [0, 0, 0], {
    unlit: 0.98
  });
  art.solid('glass-globe', 'oval', [0.56, 0.66, 0.56], 'glass', [0, 0.67, 0], [0, 0, 0], {
    alpha: 0.26,
    blend: 'alpha',
    unlit: 0.20
  });

  // Four silky smooth bowed corner cage ribs via curve() with overlap: 0
  const diag = Math.SQRT1_2;
  const corners = [
    ['rib-fl', -diag, diag],
    ['rib-fr', diag, diag],
    ['rib-bl', -diag, -diag],
    ['rib-br', diag, -diag]
  ];
  for (const [ribId, dx, dz] of corners) {
    art.curve(
      ribId,
      [
        [dx * 0.34, 0.29, dz * 0.34],
        [dx * 0.46, 0.48, dz * 0.46],
        [dx * 0.49, 0.68, dz * 0.49],
        [dx * 0.45, 0.87, dz * 0.45],
        [dx * 0.34, 1.03, dz * 0.34]
      ],
      0.06,
      'iron',
      { shape: 'cylinder', overlap: 0, style: { shade: 0.08 } }
    );
  }

  // Domed rain cap with overhanging brass lip, forged dome & visible glowing chimney vent
  art.solid('rain-lip', 'prism', [0.90, 0.08, 0.90], 'brass', [0, 1.05, 0], [0, 0, 0], {
    shade: 0.18
  });
  art.solid('rain-dome', 'dome', [0.84, 0.30, 0.84], 'iron', [0, 1.21, 0], [0, 0, 0], {
    shade: -0.02
  });
  art.solid('chimney-stack', 'taper', [0.36, 0.16, 0.36], 'iron', [0, 1.39, 0], [0, 0, 0], {
    shade: 0.06
  });
  art.solid('chimney-vent', 'cylinder', [0.30, 0.12, 0.30], 'ember', [0, 1.50, 0], [0, 0, 0], {
    unlit: 0.88
  });
  art.solid('chimney-cap', 'cone', [0.46, 0.16, 0.46], 'brass', [0, 1.64, 0], [0, 0, 0], {
    shade: 0.18
  });

  // Brass bail lugs & tall open arched carry handle via curve() with generous negative space
  art.solid('lug-left', 'box', [0.11, 0.10, 0.10], 'brass', [-0.36, 1.15, 0], [0, 0, 0], {
    shade: 0.06
  });
  art.solid('lug-right', 'box', [0.11, 0.10, 0.10], 'brass', [0.36, 1.15, 0], [0, 0, 0], {
    shade: 0.06
  });
  art.curve(
    'carry-handle',
    [
      [-0.38, 1.16, 0],
      [-0.46, 1.48, 0],
      [-0.37, 1.79, 0],
      [-0.19, 1.99, 0],
      [0.0, 2.05, 0],
      [0.19, 1.99, 0],
      [0.37, 1.79, 0],
      [0.46, 1.48, 0],
      [0.38, 1.16, 0]
    ],
    0.064,
    'brass',
    { shape: 'cylinder', overlap: 0, style: { shade: 0.14 } }
  );

  return art.finish();
}

function buildWindsweptCottage() {
  const art = createArtBuilder('windswept-cottage', { frameSize: 64 });

  // Cozy bright coastal palette
  art.palette('plinth', '#91a4b0');
  art.palette('timber', '#e3ac72');
  art.palette('beam', '#805235');
  art.palette('slate', '#3c7f8f');
  art.palette('trim', '#faf2e1');
  art.palette('door', '#d46041');
  art.palette('hearth', '#ffe591');

  // Stone cliff foundation plinth + ledge + welcoming porch deck
  art.solid('foundation', 'prism', [1.70, 0.28, 1.46], 'plinth', [0, 0.14, 0], [0, 0, 0], {
    shade: -0.12
  });
  art.solid('foundation-ledge', 'box', [1.74, 0.065, 1.50], 'plinth', [0, 0.29, 0], [0, 0, 0], {
    shade: 0.12
  });
  art.solid('porch-deck', 'prism', [0.70, 0.18, 0.44], 'plinth', [-0.25, 0.09, 0.80], [0, 0, 0], {
    shade: 0.04
  });

  // Warm timber walls + corner posts + recessed timber gable wall (using true `gable`!)
  art.solid('walls', 'box', [1.48, 0.82, 1.24], 'timber', [0, 0.72, 0], [0, 0, 0]);
  for (const [label, sx, sz] of [
    ['fl', -1, 1],
    ['fr', 1, 1],
    ['bl', -1, -1],
    ['br', 1, -1]
  ]) {
    art.solid(
      `post-${label}`,
      'box',
      [0.11, 0.84, 0.11],
      'beam',
      [sx * 0.73, 0.72, sz * 0.61],
      [0, 0, 0],
      { shade: -0.06 }
    );
  }
  art.solid('gable-wall', 'gable', [1.48, 0.66, 1.24], 'timber', [0, 1.46, 0], [0, 0, 0], {
    shade: 0.05
  });

  // Overhanging pitched roof slopes exposing recessed timber gable + crisp flared wedge roof eaves
  const slopeAngle = Math.atan2(0.66, 0.74);
  const sinA = Math.sin(slopeAngle);
  const cosA = Math.cos(slopeAngle);
  const slabOff = 0.055;
  art.solid(
    'roof-slope-l',
    'box',
    [1.14, 0.11, 1.58],
    'slate',
    [-0.42 - slabOff * sinA, 1.415 + slabOff * cosA, 0],
    [0, 0, slopeAngle],
    { shade: 0.06 }
  );
  art.solid(
    'roof-slope-r',
    'box',
    [1.14, 0.11, 1.58],
    'slate',
    [0.42 + slabOff * sinA, 1.415 + slabOff * cosA, 0],
    [0, 0, -slopeAngle],
    { shade: 0.02 }
  );
  // Crisp windswept flared wedge eaves extending past the walls (Euler: roll -> pitch -> yaw)
  art.solid(
    'eave-left',
    'wedge',
    [1.60, 0.16, 0.36],
    'slate',
    [-0.95, 1.07, 0],
    [0.34, -Math.PI / 2, 0],
    { shade: -0.10 }
  );
  art.solid(
    'eave-right',
    'wedge',
    [1.60, 0.16, 0.36],
    'slate',
    [0.95, 1.07, 0],
    [0.34, Math.PI / 2, 0],
    { shade: -0.10 }
  );
  // Sunlit driftwood ridge beam & front/back verge trim boards
  art.solid('roof-ridge', 'box', [0.16, 0.13, 1.64], 'trim', [0, 1.87, 0], [0, 0, 0], {
    shade: 0.05
  });
  for (const [end, sz] of [
    ['front', 0.785],
    ['back', -0.785]
  ]) {
    art.solid(
      `verge-${end}-l`,
      'box',
      [1.16, 0.08, 0.06],
      'trim',
      [-0.44, 1.47, sz],
      [0, 0, slopeAngle],
      { shade: 0.0 }
    );
    art.solid(
      `verge-${end}-r`,
      'box',
      [1.16, 0.08, 0.06],
      'trim',
      [0.44, 1.47, sz],
      [0, 0, -slopeAngle],
      { shade: 0.0 }
    );
  }

  // Crooked coastal stone chimney rising from right roof slope
  art.solid(
    'chimney-lower',
    'prism',
    [0.34, 0.62, 0.34],
    'plinth',
    [0.54, 1.50, -0.24],
    [0, 0, -0.07],
    { shade: -0.08 }
  );
  art.solid(
    'chimney-upper',
    'prism',
    [0.30, 0.44, 0.30],
    'plinth',
    [0.61, 1.94, -0.25],
    [-0.05, 0, -0.17],
    { shade: 0.04 }
  );
  art.solid(
    'chimney-crown',
    'prism',
    [0.40, 0.10, 0.40],
    'beam',
    [0.65, 2.16, -0.26],
    [-0.05, 0, -0.17],
    { shade: -0.10 }
  );
  art.solid(
    'chimney-pot',
    'taper',
    [0.18, 0.18, 0.18],
    'door',
    [0.68, 2.27, -0.27],
    [-0.05, 0, -0.17],
    { shade: -0.06 }
  );

  // Framed front doorway with coral door, brass knob, posts & overhanging wedge porch awning
  art.solid('door-frame', 'box', [0.48, 0.68, 0.08], 'beam', [-0.25, 0.66, 0.63], [0, 0, 0], {
    shade: -0.08
  });
  art.solid('door-panel', 'box', [0.36, 0.60, 0.07], 'door', [-0.25, 0.63, 0.655], [0, 0, 0]);
  art.solid(
    'door-knob',
    'octahedron',
    [0.065, 0.065, 0.065],
    'light',
    [-0.13, 0.61, 0.70],
    [0, 0, 0],
    { unlit: 0.40 }
  );
  art.solid(
    'porch-awning',
    'wedge',
    [0.72, 0.24, 0.46],
    'slate',
    [-0.25, 1.07, 0.82],
    [0, 0, 0],
    { shade: 0.10 }
  );
  art.solid('porch-post-l', 'cylinder', [0.065, 0.80, 0.065], 'trim', [-0.52, 0.56, 0.94], [0, 0, 0], {
    shade: -0.04
  });
  art.solid('porch-post-r', 'cylinder', [0.065, 0.80, 0.065], 'trim', [0.02, 0.56, 0.94], [0, 0, 0], {
    shade: -0.04
  });

  // Hero glowing round porthole window facing forward (+Z)
  art.solid(
    'porthole-frame',
    'ring',
    [0.43, 0.12, 0.43],
    'trim',
    [0.35, 0.78, 0.63],
    [Math.PI / 2, 0, 0],
    { shade: 0.02 }
  );
  art.solid(
    'porthole-glow',
    'cylinder',
    [0.32, 0.07, 0.32],
    'hearth',
    [0.35, 0.78, 0.63],
    [Math.PI / 2, 0, 0],
    { unlit: 0.96 }
  );
  art.solid('porthole-bar-h', 'box', [0.30, 0.04, 0.05], 'beam', [0.35, 0.78, 0.675], [0, 0, 0]);
  art.solid('porthole-bar-v', 'box', [0.04, 0.30, 0.05], 'beam', [0.35, 0.78, 0.675], [0, 0, 0]);

  // Cozy gable attic round window visible under the overhanging gable eaves!
  art.solid(
    'gable-window-rim',
    'cylinder',
    [0.24, 0.07, 0.24],
    'trim',
    [0, 1.38, 0.63],
    [Math.PI / 2, 0, 0],
    { shade: 0.0 }
  );
  art.solid(
    'gable-window',
    'cylinder',
    [0.17, 0.07, 0.17],
    'hearth',
    [0, 1.38, 0.65],
    [Math.PI / 2, 0, 0],
    { unlit: 0.88 }
  );

  // Flower box + coastal rain barrel + small side window for 360-degree craft
  art.solid('flower-box', 'box', [0.38, 0.12, 0.15], 'beam', [0.35, 0.49, 0.68], [0, 0, 0], {
    shade: 0.05
  });
  art.solid('flower-leaves', 'prism', [0.34, 0.10, 0.13], 'leaf', [0.35, 0.57, 0.68], [0, 0, 0], {
    shade: 0.12
  });
  art.solid('rain-barrel', 'cylinder', [0.26, 0.38, 0.26], 'beam', [-0.84, 0.44, -0.26], [0, 0, 0], {
    shade: 0.06
  });
  art.solid(
    'barrel-band',
    'cylinder',
    [0.28, 0.06, 0.28],
    'ink',
    [-0.84, 0.46, -0.26],
    [0, 0, 0],
    { shade: 0.05 }
  );
  art.solid('side-window-frame', 'box', [0.08, 0.34, 0.38], 'trim', [0.74, 0.74, 0.06], [0, 0, 0]);
  art.solid(
    'side-window-glow',
    'box',
    [0.06, 0.24, 0.28],
    'hearth',
    [0.76, 0.74, 0.06],
    [0, 0, 0],
    { unlit: 0.86 }
  );

  return art.finish();
}

function measureWalkMetrics(recipe) {
  const model = modelFromArtRecipe(recipe);
  const rig = rigFromArtRecipe(recipe, sharedPalette);
  if (!rig.clips.walk || !rig.clips.idle) {
    throw new Error('Expected walk and idle clips on rigged asset');
  }
  const baked = bakeAnimatedSpritePixels(model, {
    clip: 'walk',
    frames: 4,
    frameSize: recipe.frameSize,
    palette: sharedPalette,
    directions: ['front', 'right', 'back', 'left']
  });
  const fs = recipe.frameSize;
  const footY = [];
  const frameDiffs = [];
  const row = 1; // 'right' side profile for clearest stride & foot-grounding check
  for (let f = 0; f < 4; f++) {
    let maxY = -1;
    for (let py = 0; py < fs; py++) {
      for (let px = 0; px < fs; px++) {
        const idx = ((row * fs + py) * baked.width + (f * fs + px)) * 4;
        if (baked.pixels[idx + 3] > 16 && py > maxY) maxY = py;
      }
    }
    footY.push(maxY);
  }
  for (let f = 0; f < 4; f++) {
    const next = (f + 1) % 4;
    let changed = 0;
    for (let py = 0; py < fs; py++) {
      for (let px = 0; px < fs; px++) {
        const a = ((row * fs + py) * baked.width + (f * fs + px)) * 4;
        const b = ((row * fs + py) * baked.width + (next * fs + px)) * 4;
        const da = Math.abs(baked.pixels[a + 3] - baked.pixels[b + 3]);
        const dr = Math.abs(baked.pixels[a] - baked.pixels[b]);
        const dg = Math.abs(baked.pixels[a + 1] - baked.pixels[b + 1]);
        const db = Math.abs(baked.pixels[a + 2] - baked.pixels[b + 2]);
        if (da > 24 || dr + dg + db > 45) changed++;
      }
    }
    frameDiffs.push(changed);
  }
  const footDriftPx = Math.max(...footY) - Math.min(...footY);
  return { footY, footDriftPx, frameDiffs, clipNames: Object.keys(rig.clips) };
}

const assets = [
  { file: 'fox-courier.art.json', build: buildFoxCourier, rigged: true },
  { file: 'apothecary-lantern.art.json', build: buildApothecaryLantern, rigged: false },
  { file: 'windswept-cottage.art.json', build: buildWindsweptCottage, rigged: false }
];

let failed = false;
for (const item of assets) {
  const recipe = item.build();
  const outPath = resolve(here, item.file);
  writeFileSync(outPath, JSON.stringify(recipe, null, 2) + '\n', 'utf8');

  const model = modelFromArtRecipe(recipe);
  const audit = auditArtModel(model, {
    palette: sharedPalette,
    frameSize: recipe.frameSize,
    maxTriangles: 1350
  });

  console.log(`\n=== ${item.file} ===`);
  console.log(
    JSON.stringify(
      {
        passed: audit.passed,
        parts: audit.parts,
        triangles: audit.triangles,
        hiddenParts: audit.hiddenParts,
        detachedParts: audit.detachedParts,
        components: audit.components,
        edgeTouches: audit.edgeTouches,
        fillRatio: audit.fillRatio,
        lumRange: audit.lumRange,
        warnings: audit.warnings
      },
      null,
      2
    )
  );

  if (item.rigged) {
    const walk = measureWalkMetrics(recipe);
    console.log('walkCheck:', JSON.stringify(walk));
    if (walk.footDriftPx > 2) {
      console.error(`FAIL: footDriftPx=${walk.footDriftPx} > 2`);
      failed = true;
    }
  }

  if (!audit.passed || audit.warnings.length > 0 || audit.triangles > 1350 || audit.lumRange < 90) {
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}
