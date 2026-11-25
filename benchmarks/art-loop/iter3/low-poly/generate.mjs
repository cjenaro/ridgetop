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

const here = dirname(fileURLToPath(import.meta.url));
const briefs = JSON.parse(readFileSync(resolve(here, '../../briefs.json'), 'utf8'));
const palette = briefs.palette;

function buildFoxCourier() {
  const art = createArtBuilder('fox-courier', { frameSize: 48 });

  // Luminous cozy indie palette with strong value separation
  art.palette('fur', '#e8803c');
  art.palette('cream', '#fff2d0');
  art.palette('tunic', '#28645b');
  art.palette('scarf', '#44a88e');
  art.palette('leather', '#824d2c');
  art.palette('brass', '#e8ba4c');
  art.palette('seal', '#e25242');

  // Articulated rig hierarchy matching standard clip presets
  art.joint('root', undefined, [0, 0, 0]);
  art.joint('body', 'root', [0, 0.44, 0]);
  art.joint('head', 'body', [0, 0.90, 0.02]);
  art.joint('left-arm', 'body', [-0.25, 0.80, 0]);
  art.joint('right-arm', 'body', [0.25, 0.80, 0]);
  art.joint('left-leg', 'root', [-0.145, 0.44, 0]);
  art.joint('right-leg', 'root', [0.145, 0.44, 0]);
  art.joint('tail', 'body', [0, 0.48, -0.16]);
  art.joint('mailbag', 'body', [0.26, 0.56, 0.02]);

  // --- Legs & grounded boots with bright ankle cuffs ---
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    const legJoint = `${side}-leg`;
    art.solid(`${side}-boot`, 'prism', [0.19, 0.18, 0.30], 'ink', [s * 0.145, 0.09, 0.04], [0, 0, 0], {
      shade: -0.10,
      joint: legJoint,
    });
    art.solid(`${side}-cuff`, 'cylinder', [0.175, 0.08, 0.185], 'cream', [s * 0.145, 0.21, 0.01], [0, 0, 0], {
      shade: 0.06,
      joint: legJoint,
    });
    art.between(`${side}-leg`, [s * 0.145, 0.45, 0], [s * 0.145, 0.21, 0.01], 0.145, 'fur', 'taper', {
      shade: -0.05,
      joint: legJoint,
    });
  }

  // --- Torso, cozy courier tunic, belt, hooded neck scarf ---
  art.solid('torso', 'prism', [0.47, 0.46, 0.34], 'tunic', [0, 0.65, 0], [0, 0, 0], {
    shade: 0.04,
    joint: 'body',
  });
  art.solid('chest-fluff', 'prism', [0.23, 0.24, 0.12], 'cream', [0, 0.71, 0.155], [0, 0, 0], {
    shade: 0.06,
    joint: 'body',
  });
  art.solid('belt', 'prism', [0.50, 0.085, 0.37], 'leather', [0, 0.49, 0], [0, 0, 0], {
    shade: -0.12,
    joint: 'body',
  });
  art.solid('belt-buckle', 'box', [0.11, 0.095, 0.05], 'brass', [0, 0.49, 0.195], [0, 0, 0], {
    shade: 0.14,
    joint: 'body',
  });
  art.solid('scarf-collar', 'prism', [0.55, 0.15, 0.45], 'scarf', [0, 0.86, 0.02], [0, 0, 0], {
    shade: 0.08,
    joint: 'body',
  });
  art.solid('hood-drape', 'dome', [0.43, 0.23, 0.27], 'scarf', [0, 0.86, -0.19], [-0.42, 0, 0], {
    shade: -0.08,
    joint: 'body',
  });
  art.solid('scarf-tail', 'wedge', [0.14, 0.23, 0.09], 'scarf', [-0.14, 0.71, 0.20], [0.08, 0, 0.15], {
    shade: 0.14,
    joint: 'body',
  });
  art.between('satchel-strap-front', [-0.18, 0.83, 0.175], [0.25, 0.54, 0.155], [0.06, 0.04], 'leather', 'box', {
    shade: -0.06,
    joint: 'body',
  });
  art.between('satchel-strap-back', [-0.18, 0.82, -0.175], [0.24, 0.54, -0.145], [0.06, 0.04], 'leather', 'box', {
    shade: -0.10,
    joint: 'body',
  });

  // --- Asymmetric slung leather courier mailbag ---
  art.solid('mailbag-body', 'prism', [0.19, 0.26, 0.28], 'leather', [0.33, 0.47, 0.01], [0, 0, -0.10], {
    shade: 0.06,
    joint: 'mailbag',
  });
  art.solid('mailbag-flap', 'prism', [0.205, 0.115, 0.295], 'leather', [0.345, 0.55, 0.01], [0, 0, -0.12], {
    shade: -0.12,
    joint: 'mailbag',
  });
  art.solid('mailbag-clasp', 'box', [0.045, 0.065, 0.075], 'brass', [0.44, 0.51, 0.02], [0, 0, -0.10], {
    shade: 0.16,
    joint: 'mailbag',
  });
  art.solid('mailbag-letter', 'box', [0.075, 0.135, 0.175], 'cream', [0.325, 0.635, -0.02], [-0.10, 0, -0.14], {
    shade: 0.10,
    joint: 'mailbag',
  });
  art.solid('mailbag-seal', 'octahedron', [0.065, 0.065, 0.065], 'seal', [0.37, 0.635, -0.01], [0, 0, 0], {
    shade: 0.06,
    joint: 'mailbag',
  });

  // --- Arms & dark paws (right arm clears satchel with crisp negative space) ---
  art.between('left-arm', [-0.245, 0.80, 0], [-0.37, 0.50, 0.06], 0.135, 'fur', 'taper', {
    shade: -0.03,
    joint: 'left-arm',
  });
  art.solid('left-paw', 'prism', [0.125, 0.13, 0.13], 'ink', [-0.375, 0.47, 0.07], [0, 0, 0], {
    shade: -0.08,
    joint: 'left-arm',
  });

  art.between('right-arm', [0.245, 0.80, 0.02], [0.39, 0.55, 0.16], 0.135, 'fur', 'taper', {
    shade: -0.03,
    joint: 'right-arm',
  });
  art.solid('right-paw', 'prism', [0.125, 0.13, 0.13], 'ink', [0.40, 0.52, 0.175], [0, 0, 0], {
    shade: -0.08,
    joint: 'right-arm',
  });

  // --- Expressive Fox Head (sleek foxy diamond silhouette, snout, catchlights, bold pointed ears) ---
  art.solid('head', 'oval', [0.49, 0.40, 0.44], 'fur', [0, 1.13, 0.02], [0, 0, 0], {
    shade: 0.05,
    joint: 'head',
  });
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    art.solid(`${side}-cheek`, 'prism', [0.165, 0.125, 0.21], 'cream', [s * 0.175, 1.03, 0.09], [0, s * 0.38, -s * 0.14], {
      shade: 0.07,
      joint: 'head',
    });
  }
  art.solid('snout-top', 'wedge', [0.22, 0.155, 0.28], 'fur', [0, 1.095, 0.30], [0, 0, 0], {
    shade: 0.08,
    joint: 'head',
  });
  art.solid('snout-jaw', 'prism', [0.20, 0.09, 0.23], 'cream', [0, 1.01, 0.265], [0, 0, 0], {
    shade: 0.05,
    joint: 'head',
  });
  art.solid('nose', 'octahedron', [0.095, 0.08, 0.09], 'ink', [0, 1.055, 0.44], [0, 0, 0], {
    shade: -0.14,
    joint: 'head',
  });

  for (const [side, s] of [['left', -1], ['right', 1]]) {
    art.solid(`${side}-eye`, 'prism', [0.08, 0.10, 0.06], 'ink', [s * 0.13, 1.165, 0.22], [0, s * 0.18, 0], {
      shade: -0.16,
      joint: 'head',
    });
    art.solid(`${side}-eye-glint`, 'box', [0.04, 0.04, 0.03], 'light', [s * 0.118, 1.19, 0.252], [0, s * 0.18, 0], {
      unlit: 0.96,
      joint: 'head',
    });
    // Chunky pointed triangular ears with dark inner hollows and dark tips (readable from all 8 angles)
    art.solid(`${side}-ear`, 'cone', [0.23, 0.39, 0.185], 'fur', [s * 0.18, 1.41, -0.01], [0.08, 0, -s * 0.23], {
      shade: 0.02,
      joint: 'head',
    });
    art.solid(`${side}-ear-inner`, 'cone', [0.115, 0.22, 0.075], 'ink', [s * 0.18, 1.385, 0.062], [0.08, 0, -s * 0.23], {
      shade: 0.08,
      joint: 'head',
    });
    art.solid(`${side}-ear-tip`, 'cone', [0.125, 0.165, 0.115], 'ink', [s * 0.225, 1.54, 0.005], [0.08, 0, -s * 0.23], {
      shade: -0.10,
      joint: 'head',
    });
  }

  // --- Seamless bushy curved pale-tipped tail via art.tube() (gentle charismatic sweep to -X) ---
  const tailJoin = [-0.14, 0.90, -0.59];
  art.tube(
    'tail-base',
    [
      [0, 0.48, -0.15],
      [-0.03, 0.46, -0.34],
      [-0.08, 0.58, -0.51],
      [-0.12, 0.74, -0.60],
      tailJoin,
    ],
    [0.075, 0.135, 0.195, 0.215, 0.185],
    'fur',
    { sides: 7, style: { shade: 0.04, joint: 'tail' } },
  );
  art.tube(
    'tail-tip',
    [
      tailJoin,
      [-0.16, 1.03, -0.57],
      [-0.17, 1.13, -0.51],
      [-0.16, 1.20, -0.45],
    ],
    [0.185, 0.155, 0.10, 0.032],
    'cream',
    { sides: 7, style: { shade: 0.10, joint: 'tail' } },
  );

  // Expressive grounded clips via applyClipPreset
  art.applyClipPreset('idle', 'biped-idle', { autoGround: true });
  art.applyClipPreset('walk', 'biped-walk', { stride: 0.56, autoGround: true });
  art.applyClipPreset('run', 'biped-run', { stride: 0.72, autoGround: true });

  art.bakeCreviceShade(0.10);
  return art.finish();
}

function buildApothecaryLantern() {
  const art = createArtBuilder('apothecary-lantern', { frameSize: 48 });

  // Three-material contrast: blue-steel forged iron, burnished brass, translucent sea-glass + unlit ember glow
  art.palette('iron', '#3c4e61');
  art.palette('brass', '#e6b248');
  art.palette('glass', '#8ee6f2');
  art.palette('ember', '#ff8024');
  art.palette('flame', '#fff1aa');

  // --- Tiered octagonal base ---
  art.solid('base-foot', 'prism', [0.76, 0.12, 0.76], 'iron', [0, 0.06, 0], [0, 0, 0], { shade: -0.18 });
  art.solid('base-step', 'prism', [0.64, 0.11, 0.64], 'iron', [0, 0.165, 0], [0, 0, 0], { shade: 0.02 });
  art.solid('base-brass-ring', 'prism', [0.60, 0.075, 0.60], 'brass', [0, 0.25, 0], [0, 0, 0], { shade: 0.10 });
  art.solid('fuel-well', 'cylinder', [0.46, 0.07, 0.46], 'iron', [0, 0.305, 0], [0, 0, 0], { shade: 0.08 });
  art.solid('wick-burner', 'cylinder', [0.24, 0.065, 0.24], 'brass', [0, 0.36, 0], [0, 0, 0], { shade: -0.06 });

  // --- Opaque unlit glowing ember core + bright teardrop flame ---
  art.solid('ember-core', 'dome', [0.25, 0.13, 0.25], 'ember', [0, 0.435, 0], [0, 0, 0], { unlit: 0.96 });
  art.solid('ember-flame', 'teardrop', [0.19, 0.31, 0.19], 'flame', [0, 0.62, 0], [0, 0, 0], { unlit: 0.98 });

  // --- Closed translucent sea-glass dome ---
  art.solid('glass-dome', 'dome', [0.50, 0.57, 0.50], 'glass', [0, 0.595, 0], [0, 0, 0], {
    alpha: 0.27,
    blend: 'alpha',
    unlit: 0.26,
  });

  // --- Four bowed forged-iron corner cage ribs via seamless art.tube() ---
  const ribAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
  ribAngles.forEach((angle, idx) => {
    const cx = Math.cos(angle);
    const cz = Math.sin(angle);
    const pts = [
      [cx * 0.27, 0.25, cz * 0.27],
      [cx * 0.36, 0.40, cz * 0.36],
      [cx * 0.385, 0.58, cz * 0.385],
      [cx * 0.355, 0.75, cz * 0.355],
      [cx * 0.28, 0.92, cz * 0.28],
    ];
    art.tube(`cage-rib-${idx + 1}`, pts, 0.033, 'iron', {
      sides: 6,
      style: { shade: 0.06 },
    });
  });

  // --- Domed rain cap & chimney vent (brass crown ring seated outward for 30° downward visibility) ---
  art.solid('rain-brim', 'prism', [0.78, 0.075, 0.78], 'iron', [0, 0.945, 0], [0, 0, 0], { shade: -0.14 });
  art.solid('cap-collar', 'prism', [0.64, 0.065, 0.64], 'brass', [0, 1.005, 0], [0, 0, 0], { shade: 0.10 });
  art.solid('rain-dome', 'dome', [0.56, 0.20, 0.56], 'iron', [0, 1.09, 0], [0, 0, 0], { shade: 0.06 });
  art.solid('chimney-neck', 'cylinder', [0.24, 0.14, 0.24], 'iron', [0, 1.22, 0], [0, 0, 0], { shade: -0.08 });
  art.solid('chimney-vent-band', 'cylinder', [0.275, 0.058, 0.275], 'brass', [0, 1.22, 0], [0, 0, 0], { shade: 0.12 });
  art.solid('chimney-cap', 'cone', [0.33, 0.10, 0.33], 'iron', [0, 1.33, 0], [0, 0, 0], { shade: 0.08 });
  art.solid('finial', 'octahedron', [0.105, 0.115, 0.105], 'brass', [0, 1.405, 0], [0, 0, 0], { shade: 0.16 });

  // --- Open overhead arched brass carry handle via seamless art.tube() ---
  art.solid('handle-lug-l', 'box', [0.09, 0.08, 0.08], 'brass', [-0.33, 1.01, 0], [0, 0, 0], { shade: -0.05 });
  art.solid('handle-lug-r', 'box', [0.09, 0.08, 0.08], 'brass', [0.33, 1.01, 0], [0, 0, 0], { shade: -0.05 });

  const handlePts = [];
  const handleRadii = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = Math.PI * (1 - t); // PI -> 0 (left to right)
    const x = Math.cos(theta) * 0.35;
    const y = 1.01 + Math.sin(theta) * 0.72 + (1 - Math.abs(t - 0.5) * 2) * 0.04;
    handlePts.push([x, y, 0]);
    const grip = Math.exp(-Math.pow((t - 0.5) / 0.24, 2));
    handleRadii.push(0.031 + grip * 0.013);
  }
  art.tube('carry-handle', handlePts, handleRadii, 'brass', {
    sides: 6,
    style: { shade: 0.12 },
  });

  art.bakeCreviceShade(0.10);
  return art.finish();
}

function buildWindsweptCottage() {
  const art = createArtBuilder('windswept-cottage', { frameSize: 64 });

  // Cozy cliffside coastal palette
  art.palette('timber', '#c68f5e');
  art.palette('roof', '#43637a');
  art.palette('trim', '#f2e6cb');
  art.palette('coral', '#df6449');
  art.palette('terracotta', '#cb6843');
  art.palette('winGlow', '#ffdc7a');
  art.palette('brass', '#e6b64c');

  // --- Tiered stone foundation plinth ---
  art.solid('plinth-lower', 'prism', [1.72, 0.14, 1.48], 'stone', [0, 0.07, 0], [0, 0, 0], { shade: -0.18 });
  art.solid('plinth-upper', 'prism', [1.58, 0.12, 1.34], 'stone', [0, 0.19, 0], [0, 0, 0], { shade: 0.02 });

  // --- Warm timber walls & corner structural timber posts ---
  art.solid('main-walls', 'box', [1.40, 0.78, 1.18], 'timber', [0, 0.64, 0], [0, 0, 0], { shade: 0.04 });
  for (const [sxName, sx] of [['l', -1], ['r', 1]]) {
    for (const [szName, sz] of [['f', 1], ['b', -1]]) {
      art.solid(`post-${sxName}${szName}`, 'box', [0.10, 0.80, 0.10], 'wood', [sx * 0.69, 0.64, sz * 0.58], [0, 0, 0], {
        shade: -0.20,
      });
    }
  }
  art.solid('eave-beam', 'box', [1.46, 0.065, 1.24], 'wood', [0, 1.03, 0], [0, 0, 0], { shade: -0.18 });

  // --- Recessed gable attic wall ---
  art.solid('gable-attic', 'gable', [1.34, 0.56, 1.12], 'timber', [0, 1.31, 0], [0, 0, 0], { shade: 0.08 });
  art.solid('attic-vent', 'prism', [0.18, 0.18, 0.055], 'wood', [0, 1.25, 0.575], [0, 0, 0], { shade: -0.20 });

  // --- Overhanging pitched coastal roof + flared wedge eaves + crisp fascia trim ---
  const slopeAngle = Math.atan2(0.56, 0.67); // ~0.696 rad
  const roofLen = 1.06;
  const roofDepth = 1.44;
  const midX = 0.405;
  const midY = 1.30;
  art.solid('roof-left', 'box', [roofLen, 0.105, roofDepth], 'roof', [-midX, midY, 0], [0, 0, slopeAngle], {
    shade: 0.05,
  });
  art.solid('roof-right', 'box', [roofLen, 0.105, roofDepth], 'roof', [midX, midY, 0], [0, 0, -slopeAngle], {
    shade: -0.05,
  });
  art.solid('roof-ridge', 'prism', [0.16, 0.115, 1.48], 'roof', [0, 1.64, 0], [0, 0, 0], { shade: 0.15 });

  // Flared coastal wedge eaves smoothly continuing lower roofline (Euler roll -> pitch -> yaw)
  art.solid('eave-left', 'wedge', [roofDepth, 0.125, 0.23], 'roof', [-0.84, 0.94, 0], [0.05, -Math.PI / 2, 0], {
    shade: -0.08,
  });
  art.solid('eave-right', 'wedge', [roofDepth, 0.125, 0.23], 'roof', [0.84, 0.94, 0], [0.05, Math.PI / 2, 0], {
    shade: -0.12,
  });

  // Crisp fascia trim boards flush along front & back overhanging roof gable edges
  art.solid('fascia-front-l', 'box', [1.06, 0.072, 0.05], 'trim', [-midX, midY, 0.725], [0, 0, slopeAngle], {
    shade: 0.10,
  });
  art.solid('fascia-front-r', 'box', [1.06, 0.072, 0.05], 'trim', [midX, midY, 0.725], [0, 0, -slopeAngle], {
    shade: 0.06,
  });
  art.solid('fascia-back-l', 'box', [1.06, 0.072, 0.05], 'trim', [-midX, midY, -0.725], [0, 0, slopeAngle], {
    shade: 0.06,
  });
  art.solid('fascia-back-r', 'box', [1.06, 0.072, 0.05], 'trim', [midX, midY, -0.725], [0, 0, -slopeAngle], {
    shade: 0.02,
  });

  // --- Crooked coastal stone chimney + terracotta pot (asymmetric left-back) ---
  art.solid('chimney-stack', 'prism', [0.28, 0.64, 0.28], 'stone', [-0.43, 1.44, -0.22], [-0.04, 0, 0.07], {
    shade: -0.05,
  });
  art.solid('chimney-crown', 'prism', [0.34, 0.10, 0.34], 'stone', [-0.46, 1.76, -0.235], [-0.05, 0, 0.10], {
    shade: 0.09,
  });
  art.solid('chimney-pot', 'taper', [0.165, 0.21, 0.165], 'terracotta', [-0.485, 1.89, -0.245], [-0.05, 0, 0.13], {
    shade: 0.07,
  });

  // --- Framed coral front door + sloped porch awning + porch posts + stone steps ---
  art.solid('door-frame', 'box', [0.42, 0.62, 0.08], 'trim', [-0.25, 0.56, 0.60], [0, 0, 0], { shade: 0.06 });
  art.solid('door-panel', 'box', [0.32, 0.54, 0.055], 'coral', [-0.25, 0.54, 0.625], [0, 0, 0], { shade: 0.05 });
  art.solid('door-knob', 'octahedron', [0.06, 0.06, 0.06], 'brass', [-0.13, 0.52, 0.665], [0, 0, 0], { shade: 0.14 });
  art.solid('porch-awning', 'wedge', [0.58, 0.165, 0.38], 'roof', [-0.25, 0.94, 0.78], [0, 0, 0], { shade: 0.08 });
  art.solid('porch-post-l', 'box', [0.06, 0.64, 0.06], 'trim', [-0.48, 0.56, 0.92], [0, 0, 0], { shade: -0.04 });
  art.solid('porch-post-r', 'box', [0.06, 0.64, 0.06], 'trim', [-0.02, 0.56, 0.92], [0, 0, 0], { shade: -0.04 });
  art.solid('porch-step-top', 'box', [0.60, 0.12, 0.36], 'stone', [-0.25, 0.21, 0.80], [0, 0, 0], { shade: 0.06 });
  art.solid('porch-step-low', 'box', [0.68, 0.14, 0.24], 'stone', [-0.25, 0.09, 0.94], [0, 0, 0], { shade: -0.14 });

  // --- Glowing round porthole window + flower box on front-right facade ---
  art.solid('porthole-frame', 'cylinder', [0.365, 0.075, 0.365], 'trim', [0.32, 0.67, 0.605], [Math.PI / 2, 0, 0], {
    shade: 0.14,
  });
  art.solid('porthole-glow', 'cylinder', [0.265, 0.085, 0.265], 'winGlow', [0.32, 0.67, 0.615], [Math.PI / 2, 0, 0], {
    unlit: 0.96,
  });
  art.solid('porthole-bar-h', 'box', [0.265, 0.024, 0.028], 'trim', [0.32, 0.67, 0.66], [0, 0, 0], { shade: 0.06 });
  art.solid('porthole-bar-v', 'box', [0.024, 0.265, 0.028], 'trim', [0.32, 0.67, 0.66], [0, 0, 0], { shade: 0.06 });

  art.solid('flower-box', 'box', [0.36, 0.11, 0.145], 'wood', [0.32, 0.42, 0.665], [0, 0, 0], { shade: -0.10 });
  art.solid('flower-foliage', 'prism', [0.32, 0.095, 0.125], 'leaf', [0.32, 0.495, 0.67], [0, 0, 0], { shade: 0.06 });
  art.solid('flower-bloom-l', 'octahedron', [0.08, 0.08, 0.08], 'coral', [0.23, 0.54, 0.685], [0, 0, 0], { shade: 0.12 });
  art.solid('flower-bloom-r', 'octahedron', [0.078, 0.078, 0.078], 'light', [0.40, 0.54, 0.68], [0, 0, 0], { shade: 0.10 });

  // --- Side window (+X wall) ---
  art.solid('side-win-frame', 'box', [0.075, 0.34, 0.34], 'trim', [0.71, 0.66, 0.02], [0, 0, 0], { shade: 0.06 });
  art.solid('side-win-glow', 'box', [0.055, 0.24, 0.24], 'winGlow', [0.73, 0.66, 0.02], [0, 0, 0], { unlit: 0.90 });
  art.solid('side-win-sill', 'box', [0.12, 0.055, 0.40], 'wood', [0.74, 0.47, 0.02], [0, 0, 0], { shade: -0.12 });

  // --- Rain barrel (-X wall, firmly seated on stone plinth) ---
  art.solid('rain-barrel', 'cylinder', [0.28, 0.38, 0.28], 'wood', [-0.80, 0.33, 0.24], [0, 0, 0], { shade: -0.05 });
  art.solid('barrel-hoop-bot', 'cylinder', [0.295, 0.036, 0.295], 'ink', [-0.80, 0.24, 0.24], [0, 0, 0], { shade: 0.04 });
  art.solid('barrel-hoop-top', 'cylinder', [0.295, 0.036, 0.295], 'ink', [-0.80, 0.43, 0.24], [0, 0, 0], { shade: 0.04 });
  art.solid('barrel-water', 'cylinder', [0.23, 0.024, 0.23], 'glow', [-0.80, 0.525, 0.24], [0, 0, 0], {
    unlit: 0.32,
    shade: -0.10,
  });

  // --- Back window & stepped stone chimney hearth buttress (360° completeness) ---
  art.solid('back-win-frame', 'box', [0.30, 0.30, 0.07], 'trim', [0.20, 0.66, -0.60], [0, 0, 0], { shade: 0.04 });
  art.solid('back-win-glow', 'box', [0.21, 0.21, 0.05], 'winGlow', [0.20, 0.66, -0.618], [0, 0, 0], { unlit: 0.84 });
  art.solid('back-buttress', 'wedge', [0.36, 0.50, 0.24], 'stone', [-0.43, 0.45, -0.67], [0, Math.PI, 0], {
    shade: 0.04,
  });

  art.bakeCreviceShade(0.12);
  return art.finish();
}

function measureAnimation(recipe, clipName, frames = 4, frameSize = 64) {
  const baked = bakeAnimatedSpritePixels(recipe, {
    clip: clipName,
    frames,
    frameSize,
    directions: ['right'],
    palette,
    alignFeet: true,
  });
  const bottomY = [];
  for (let f = 0; f < frames; f++) {
    let maxY = -1;
    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const idx = (y * baked.width + f * frameSize + x) * 4;
        if (baked.pixels[idx + 3] > 16) maxY = Math.max(maxY, y);
      }
    }
    bottomY.push(maxY);
  }
  const footDriftPx = Math.max(...bottomY) - Math.min(...bottomY);
  let totalDelta = 0;
  for (let f = 0; f < frames; f++) {
    const fNext = (f + 1) % frames;
    let changed = 0;
    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const i0 = (y * baked.width + f * frameSize + x) * 4;
        const i1 = (y * baked.width + fNext * frameSize + x) * 4;
        const diff =
          Math.abs(baked.pixels[i0] - baked.pixels[i1]) +
          Math.abs(baked.pixels[i0 + 1] - baked.pixels[i1 + 1]) +
          Math.abs(baked.pixels[i0 + 2] - baked.pixels[i1 + 2]) +
          Math.abs(baked.pixels[i0 + 3] - baked.pixels[i1 + 3]);
        if (diff > 36) changed++;
      }
    }
    totalDelta += changed;
  }
  return { footDriftPx, avgMotionPx: Math.round(totalDelta / frames), bottomY };
}

mkdirSync(here, { recursive: true });

const builders = [
  { id: 'fox-courier', frameSize: 48, animated: true, build: buildFoxCourier },
  { id: 'apothecary-lantern', frameSize: 48, animated: false, build: buildApothecaryLantern },
  { id: 'windswept-cottage', frameSize: 64, animated: false, build: buildWindsweptCottage },
];

let allPassed = true;
for (const entry of builders) {
  const recipe = entry.build();
  const outPath = resolve(here, `${entry.id}.art.json`);
  writeFileSync(outPath, JSON.stringify(recipe, null, 2) + '\n', 'utf8');

  const model = modelFromArtRecipe(recipe);
  const report = auditArtModel(model, { palette, frameSize: entry.frameSize });
  console.log(`\n=== ${entry.id} ===`);
  console.log(
    JSON.stringify({
      passed: report.passed,
      parts: report.parts,
      triangles: report.triangles,
      components: report.components,
      edgeTouches: report.edgeTouches,
      fillRatio: report.fillRatio,
      lumRange: report.lumRange,
      warnings: report.warnings,
    }),
  );

  if (entry.animated) {
    const rig = rigFromArtRecipe(recipe, palette);
    const clipNames = Object.keys(rig.clips);
    console.log('clips:', clipNames);
    for (const clipName of clipNames) {
      const anim = measureAnimation(recipe, clipName, 4, 64);
      console.log(`  clip ${clipName}:`, anim);
    }
  }

  if (!report.passed || report.triangles > 1350) {
    allPassed = false;
  }
}

if (!allPassed) {
  process.exitCode = 1;
}
