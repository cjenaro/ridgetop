import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  artPoseBounds,
  createArtBuilder,
  modelFromArtRecipe,
  rigFromArtRecipe
} from '../../../../packages/ridgetop/dist/framework/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Ground every keyframe of custom clips on a fitted recipe so lowest vertex rests at y = 0. */
function groundClips(recipe) {
  if (!recipe.clips || !recipe.joints?.some(j => j.id === 'root')) return recipe;
  const model = modelFromArtRecipe(recipe);
  for (const clip of Object.values(recipe.clips)) {
    for (const frame of clip.frames) {
      const existingRoot = frame.poses.root;
      const rx = existingRoot?.position?.[0] ?? 0;
      const rz = existingRoot?.position?.[2] ?? 0;
      const probe = { ...frame.poses };
      if (existingRoot) {
        probe.root = { ...existingRoot, position: [rx, 0, rz] };
      }
      const b = artPoseBounds(model, probe);
      const lift = Math.abs(b.min[1]) > 1e-6 ? Number((-b.min[1]).toFixed(5)) : 0;
      frame.poses.root = { ...existingRoot, position: [rx, lift, rz] };
    }
  }
  return recipe;
}

/**
 * 1. Fox Courier (48px, rigged + idle & walk clips)
 * Standing indie-game fox courier facing +Z:
 * - pointed triangular ears with inner dark tips
 * - tapered snout with dark nose
 * - cozy hooded neck scarf
 * - bushy curved pale-tipped tail arching behind
 * - slung leather courier mailbag at the side
 * - idle and walk animation clips with grounded feet
 */
function buildFoxCourier() {
  const art = createArtBuilder('fox-courier', {
    base: 'biped',
    primary: 'accent',
    trim: 'accent',
    proportions: [0.96, 1.0, 0.96],
    frameSize: 48
  });

  // Refine starter biped body proportions & tones for a nimble fox silhouette
  // Lift torso slightly so the legs & boots show crisp stride separation in walk
  art.adjust('body', { tone: 'accent', scaleBy: [0.92, 0.90, 0.94], moveBy: [0, 0.03, 0] });
  art.adjust('head', { tone: 'accent', scaleBy: [1.14, 0.94, 1.04], moveBy: [0, 0.015, 0.01] });
  art.adjust('collar', { tone: 'leaf', scaleBy: [1.28, 1.85, 1.30], moveBy: [0, 0.005, 0.01] });

  // Pale cream chest fur patch for unmistakable fox belly contrast
  art.solid('chest-fur', 'oval', [0.33, 0.34, 0.16], 'light', [0, 0.67, 0.16]);
  art.bind('chest-fur', 'body');

  // Dark fox paws and grounded dark boots with clearer upper legs
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    art.adjust(`${side}-boot`, { tone: 'ink', scaleBy: [0.92, 0.88, 1.05], moveBy: [0, -0.01, 0] });
    art.adjust(`${side}-leg`, { tone: 'accent', scaleBy: [0.92, 1.06, 0.92], moveBy: [0, 0.01, 0] });
    art.adjust(`${side}-hand`, { tone: 'ink', scaleBy: [0.90, 0.90, 0.94] });
    art.adjust(`${side}-arm`, {
      tone: 'accent',
      scaleBy: [0.90, 0.94, 0.90],
      // Right arm angles slightly forward/outward so the leather mailbag sits cleanly on the hip
      ...(side === 'right' ? { moveBy: [0.055, 0.03, 0.06] } : { moveBy: [-0.02, 0.01, 0.02] })
    });
    if (side === 'right') {
      art.adjust('right-hand', { moveBy: [0.065, 0.03, 0.075] });
    } else {
      art.adjust('left-hand', { moveBy: [-0.02, 0.01, 0.02] });
    }
    // Crisp dark eyes positioned cleanly above pale cheeks and snout
    art.adjust(`${side}-eye`, {
      tone: 'ink',
      scaleBy: [1.24, 1.30, 1.15],
      moveBy: [s * 0.044, 0.015, 0.032]
    });
  }

  // Pale fox cheek tufts flaring gently outward on lower sides of head
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    art.solid(
      `${side}-cheek`,
      'taper',
      [0.24, 0.21, 0.24],
      'light',
      [s * 0.195, 1.065, 0.095],
      [0.12, s * 0.2, -s * 1.15]
    );
    art.bind(`${side}-cheek`, 'head');
  }

  // Tapered fox snout (upper orange bridge + pale lower muzzle + dark nose)
  art.between('snout-upper', [0, 1.135, 0.19], [0, 1.06, 0.455], [0.23, 0.16], 'accent', 'taper');
  art.bind('snout-upper', 'head');
  art.between('snout-muzzle', [0, 1.065, 0.18], [0, 1.035, 0.485], [0.22, 0.13], 'light', 'taper');
  art.bind('snout-muzzle', 'head');
  art.solid('nose', 'oval', [0.098, 0.078, 0.088], 'ink', [0, 1.05, 0.49]);
  art.bind('nose', 'head');

  // Pointed triangular fox ears with bold dark inner hollows and dark tips
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    const earBase = [s * 0.175, 1.28, -0.01];
    const earMid = [s * 0.245, 1.495, 0.02];
    const earTip = [s * 0.295, 1.675, 0.04];

    art.between(`${side}-ear-base`, earBase, earMid, [0.24, 0.14], 'accent', 'taper');
    art.bind(`${side}-ear-base`, 'head');

    // Crisp dark tip capping the upper third of each pointed ear
    art.between(`${side}-ear-tip`, [s * 0.230, 1.445, 0.015], earTip, [0.15, 0.098], 'ink', 'cone');
    art.bind(`${side}-ear-tip`, 'head');

    // Dark inner ear recess facing forward (+Z)
    art.between(
      `${side}-ear-inner`,
      [s * 0.182, 1.32, 0.06],
      [s * 0.268, 1.565, 0.072],
      [0.125, 0.05],
      'ink',
      'cone'
    );
    art.bind(`${side}-ear-inner`, 'head');
  }

  // Cozy hooded neck scarf (leaf green): fuller draped back hood cowl + front scarf tail
  art.solid('scarf-hood', 'oval', [0.50, 0.27, 0.36], 'leaf', [0, 0.935, -0.21], [0.46, 0, 0]);
  art.bind('scarf-hood', 'body');
  art.solid('scarf-hood-rim', 'ring', [0.45, 0.11, 0.31], 'ground', [0, 0.96, -0.10], [0.58, 0, 0]);
  art.bind('scarf-hood-rim', 'body');
  art.solid('scarf-end', 'prism', [0.175, 0.28, 0.09], 'leaf', [-0.145, 0.765, 0.21], [-0.16, 0.12, 0.16]);
  art.bind('scarf-end', 'body');
  art.solid('scarf-stripe', 'box', [0.165, 0.045, 0.095], 'ground', [-0.165, 0.685, 0.225], [-0.16, 0.12, 0.16]);
  art.bind('scarf-stripe', 'body');

  // Bushy curved pale-tipped tail arching behind (-Z and up) on its own animated joint
  art.joint('tail', 'body', [0, 0.50, -0.18]);
  art.between('tail-root', [0, 0.50, -0.15], [0, 0.45, -0.46], [0.23, 0.21], 'accent', 'oval');
  art.bind('tail-root', 'tail');
  art.solid('tail-bush', 'oval', [0.34, 0.35, 0.47], 'accent', [0, 0.57, -0.58], [0.54, 0, 0]);
  art.bind('tail-bush', 'tail');
  art.between('tail-tip', [0, 0.65, -0.68], [0, 0.89, -0.87], [0.29, 0.28], 'light', 'cone');
  art.bind('tail-tip', 'tail');

  // Slung leather courier mailbag at the right hip (+X) — raised clear of boots with crisp leather flap & letter
  art.between('bag-strap-front', [-0.21, 0.89, 0.19], [0.28, 0.60, 0.15], [0.068, 0.045], 'wood', 'box');
  art.bind('bag-strap-front', 'body');
  art.between('bag-strap-back', [-0.21, 0.89, -0.18], [0.28, 0.60, -0.15], [0.068, 0.045], 'wood', 'box');
  art.bind('bag-strap-back', 'body');

  art.joint('mailbag', 'body', [0.32, 0.61, 0.0]);
  art.solid('mailbag-body', 'prism', [0.21, 0.30, 0.34], 'wood', [0.37, 0.50, -0.02], [0, 0, -0.10]);
  art.bind('mailbag-body', 'mailbag');
  art.solid('mailbag-flap', 'prism', [0.23, 0.13, 0.35], 'wood', [0.385, 0.60, -0.02], [0, 0, -0.16]);
  art.bind('mailbag-flap', 'mailbag');
  art.solid('mailbag-trim', 'box', [0.045, 0.045, 0.355], 'ink', [0.475, 0.56, -0.02], [0, 0, -0.14]);
  art.bind('mailbag-trim', 'mailbag');
  art.solid('mailbag-buckle', 'box', [0.055, 0.085, 0.085], 'light', [0.485, 0.525, -0.01], [0, 0, -0.12]);
  art.bind('mailbag-buckle', 'mailbag');
  art.solid('mailbag-letter', 'box', [0.055, 0.145, 0.165], 'light', [0.36, 0.64, 0.07], [0.24, 0.18, -0.24]);
  art.bind('mailbag-letter', 'mailbag');

  // Custom lively idle clip (breathing, alert fox head turn, wagging bushy tail, grounded feet)
  const idleA = {
    root: { position: [0, 0, 0] },
    body: { position: [0, 0, 0], rotation: [0, 0, 0] },
    head: { rotation: [0, -0.06, 0.02] },
    'left-arm': { rotation: [0.03, 0, 0.03] },
    'right-arm': { rotation: [-0.02, 0, -0.04] },
    'left-leg': { rotation: [0, 0, 0] },
    'right-leg': { rotation: [0, 0, 0] },
    tail: { rotation: [0.02, -0.16, -0.04] },
    mailbag: { rotation: [0, 0, -0.02] }
  };
  art.clip('idle', {
    duration: 1.6,
    loop: true,
    easing: 'smooth',
    frames: [
      { time: 0, poses: structuredClone(idleA) },
      {
        time: 0.8,
        poses: {
          root: { position: [0, 0, 0] },
          body: { position: [0, 0.024, 0], rotation: [0.03, 0, 0] },
          head: { rotation: [-0.04, 0.08, -0.03] },
          'left-arm': { rotation: [-0.04, 0, 0.06] },
          'right-arm': { rotation: [0.04, 0, -0.06] },
          'left-leg': { rotation: [0, 0, 0] },
          'right-leg': { rotation: [0, 0, 0] },
          tail: { rotation: [0.08, 0.18, 0.05] },
          mailbag: { rotation: [0.04, 0, 0.03] }
        }
      },
      { time: 1.6, poses: structuredClone(idleA) }
    ]
  });

  // Custom jaunty courier walk clip (expressive leg stride, opposite arm swing, tail counterbalance, bag bounce)
  const walkA = {
    root: { position: [0, 0, 0] },
    body: { position: [0, 0, 0], rotation: [0.065, 0.08, -0.035] },
    head: { rotation: [-0.05, -0.07, 0.025] },
    'left-leg': { position: [0, 0, 0], rotation: [-0.44, 0, 0] },
    'right-leg': { position: [0, 0, 0], rotation: [0.44, 0, 0] },
    'left-arm': { rotation: [0.40, 0, 0.05] },
    'right-arm': { rotation: [-0.32, 0, -0.06] },
    tail: { rotation: [0.06, -0.26, -0.06] },
    mailbag: { rotation: [0.16, 0, -0.06] }
  };
  art.clip('walk', {
    duration: 0.8,
    loop: true,
    easing: 'smooth',
    frames: [
      { time: 0, poses: structuredClone(walkA) },
      {
        time: 0.2,
        poses: {
          root: { position: [0, 0, 0] },
          body: { position: [0, 0.032, 0], rotation: [0.03, 0, 0] },
          head: { rotation: [-0.02, 0, 0] },
          'left-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
          'right-leg': { position: [0, 0.055, 0], rotation: [0, 0, 0] },
          'left-arm': { rotation: [0, 0, 0.03] },
          'right-arm': { rotation: [0, 0, -0.04] },
          tail: { rotation: [-0.06, 0, 0] },
          mailbag: { rotation: [-0.05, 0, 0.06] }
        }
      },
      {
        time: 0.4,
        poses: {
          root: { position: [0, 0, 0] },
          body: { position: [0, 0, 0], rotation: [0.065, -0.08, 0.035] },
          head: { rotation: [-0.05, 0.07, -0.025] },
          'left-leg': { position: [0, 0, 0], rotation: [0.44, 0, 0] },
          'right-leg': { position: [0, 0, 0], rotation: [-0.44, 0, 0] },
          'left-arm': { rotation: [-0.40, 0, 0.05] },
          'right-arm': { rotation: [0.32, 0, -0.06] },
          tail: { rotation: [0.06, 0.26, 0.06] },
          mailbag: { rotation: [-0.14, 0, 0.05] }
        }
      },
      {
        time: 0.6,
        poses: {
          root: { position: [0, 0, 0] },
          body: { position: [0, 0.032, 0], rotation: [0.03, 0, 0] },
          head: { rotation: [-0.02, 0, 0] },
          'left-leg': { position: [0, 0.055, 0], rotation: [0, 0, 0] },
          'right-leg': { position: [0, 0, 0], rotation: [0, 0, 0] },
          'left-arm': { rotation: [0, 0, 0.03] },
          'right-arm': { rotation: [0, 0, -0.04] },
          tail: { rotation: [-0.06, 0, 0] },
          mailbag: { rotation: [0.05, 0, -0.05] }
        }
      },
      { time: 0.8, poses: structuredClone(walkA) }
    ]
  });

  return groundClips(art.finish());
}

/**
 * 2. Apothecary Storm Lantern (48px, static hero prop)
 * Handcrafted brass-and-iron apothecary storm lantern:
 * - tiered octagonal base
 * - four thin protective corner cage ribs surrounding a warm glowing ember chamber
 * - domed rain cap with chimney vent
 * - open overhead arched carry handle with visible negative space inside the loop
 */
function buildApothecaryLantern() {
  const art = createArtBuilder('apothecary-lantern', {
    base: 'empty',
    frameSize: 48
  });

  // Tiered octagonal base (iron plinth -> stepped brass middle tier -> iron chamber collar)
  art.solid('base-tier-low', 'prism', [0.88, 0.14, 0.88], 'ink', [0, 0.07, 0]);
  art.solid('base-tier-mid', 'prism', [0.71, 0.13, 0.71], 'accent', [0, 0.185, 0]);
  art.solid('base-collar', 'prism', [0.58, 0.075, 0.58], 'ink', [0, 0.275, 0]);

  // Warm glowing ember chamber: glowing amber ember hearth below + bright warm glass flame chamber above
  art.solid('ember-bed', 'oval', [0.40, 0.18, 0.40], 'accent', [0, 0.39, 0], [0, 0, 0], 0.88);
  art.solid('ember-chamber', 'oval', [0.38, 0.46, 0.38], 'light', [0, 0.62, 0], [0, 0, 0], 0.94);

  // Upper chamber bezel (clean iron collar supporting the overhanging brass dome)
  art.solid('upper-collar', 'prism', [0.60, 0.08, 0.60], 'ink', [0, 0.90, 0]);

  // Four thin protective iron corner cage ribs cleanly separated around the ember chamber
  const corners = [
    ['fl', -1, 1],
    ['fr', 1, 1],
    ['bl', -1, -1],
    ['br', 1, -1]
  ];
  for (const [tag, sx, sz] of corners) {
    const bot = [sx * 0.245, 0.28, sz * 0.245];
    const mid = [sx * 0.335, 0.585, sz * 0.335];
    const top = [sx * 0.255, 0.89, sz * 0.255];
    art.between(`rib-${tag}-lower`, bot, mid, 0.060, 'ink', 'cylinder');
    art.between(`rib-${tag}-upper`, mid, top, 0.060, 'ink', 'cylinder');
    // Brass corner studs at the bowed cage elbows
    art.solid(`rib-${tag}-stud`, 'octahedron', [0.084, 0.084, 0.084], 'accent', mid);
  }

  // Domed brass rain cap overhanging the cage + iron eaves lip
  art.solid('rain-cap-lip', 'cylinder', [0.84, 0.055, 0.84], 'ink', [0, 0.97, 0]);
  art.solid('rain-cap-dome', 'dome', [0.78, 0.26, 0.78], 'accent', [0, 1.115, 0]);

  // Compact stepped chimney vent rising cleanly from the dome crown (leaving generous air below the handle)
  art.solid('chimney-neck', 'cylinder', [0.28, 0.14, 0.28], 'ink', [0, 1.275, 0]);
  art.solid('chimney-vent-ring', 'cylinder', [0.33, 0.045, 0.33], 'accent', [0, 1.245, 0]);
  art.solid('chimney-top', 'dome', [0.35, 0.085, 0.35], 'ink', [0, 1.37, 0]);

  // Open overhead arched carry handle anchored on side lugs with tall clear negative space above the chimney
  art.solid('handle-lug-left', 'cylinder', [0.10, 0.10, 0.10], 'accent', [-0.34, 1.16, 0]);
  art.solid('handle-lug-right', 'cylinder', [0.10, 0.10, 0.10], 'accent', [0.34, 1.16, 0]);
  art.solid('carry-handle', 'arch', [0.82, 0.78, 0.078], 'stone', [0, 1.56, 0]);
  // Brass wrapped handle grip at the crown of the arch for crisp silhouette & brass-iron unity
  art.solid('handle-grip', 'cylinder', [0.10, 0.24, 0.10], 'accent', [0, 1.88, 0], [0, 0, Math.PI / 2]);

  return art.finish();
}

/**
 * 3. Windswept Cliff Cottage (64px, static architecture)
 * Cozy cliffside fisher's cottage facing +Z:
 * - stone foundation base
 * - warm timber walls
 * - overhanging pitched gable roof with a raised chimney on one side
 * - framed front doorway with a tiny porch awning
 * - glowing round porthole window facing forward
 */
function buildWindsweptCottage() {
  const art = createArtBuilder('windswept-cottage', {
    base: 'empty',
    frameSize: 64
  });

  // Stone foundation base + corner masonry blocks
  art.solid('foundation-main', 'prism', [1.54, 0.30, 1.24], 'stone', [0, 0.15, 0]);
  art.solid('foundation-plinth', 'box', [1.60, 0.11, 1.30], 'ink', [0, 0.055, 0]);
  art.solid('foundation-stone-fl', 'prism', [0.24, 0.22, 0.24], 'stone', [-0.67, 0.15, 0.51]);
  art.solid('foundation-stone-fr', 'prism', [0.24, 0.22, 0.24], 'stone', [0.67, 0.15, 0.51]);
  art.solid('foundation-stone-bl', 'prism', [0.24, 0.22, 0.24], 'stone', [-0.67, 0.15, -0.51]);
  art.solid('foundation-stone-br', 'prism', [0.24, 0.22, 0.24], 'stone', [0.67, 0.15, -0.51]);

  // Warm timber walls + dark timber corner posts & wall sill beam
  art.solid('walls-main', 'box', [1.34, 0.64, 1.06], 'wood', [0, 0.60, 0]);
  art.solid('walls-sill', 'box', [1.40, 0.06, 1.12], 'ink', [0, 0.30, 0]);

  for (const [tag, sx, sz] of [['fl', -1, 1], ['fr', 1, 1], ['bl', -1, -1], ['br', 1, -1]]) {
    art.solid(`corner-post-${tag}`, 'box', [0.095, 0.66, 0.095], 'ink', [sx * 0.65, 0.61, sz * 0.51]);
  }

  // Front & back triangular gable peak wall (45-degree rotated box tucked seamlessly inside main wall)
  const gableS = 0.918;
  art.solid('gable-wall', 'box', [gableS, gableS, 1.056], 'wood', [0, 0.91, 0], [0, 0, Math.PI / 4]);
  // Subtle dark timber collar beams across both front and back gable eaves
  art.solid('gable-beam-front', 'box', [1.28, 0.055, 0.055], 'ink', [0, 0.93, 0.528]);
  art.solid('gable-beam-back', 'box', [1.28, 0.055, 0.055], 'ink', [0, 0.93, -0.528]);

  // Overhanging pitched gable roof (two 45-degree sloped slabs + slim ridge cap + front eaves trim)
  const slopeAngle = Math.PI / 4;
  const slopeLen = 1.15;
  const roofDepth = 1.34;
  const roofThick = 0.125;
  const roofOffset = 0.37;
  art.solid(
    'roof-slope-left',
    'box',
    [slopeLen, roofThick, roofDepth],
    'leaf',
    [-roofOffset, 1.605 - roofOffset, 0],
    [0, 0, slopeAngle]
  );
  art.solid(
    'roof-slope-right',
    'box',
    [slopeLen, roofThick, roofDepth],
    'leaf',
    [roofOffset, 1.605 - roofOffset, 0],
    [0, 0, -slopeAngle]
  );
  art.solid('roof-ridge', 'prism', [0.13, 0.11, 1.38], 'ink', [0, 1.63, 0]);
  art.solid(
    'roof-trim-left',
    'box',
    [slopeLen + 0.03, 0.055, 0.075],
    'ink',
    [-roofOffset, 1.585 - roofOffset, 0.645],
    [0, 0, slopeAngle]
  );
  art.solid(
    'roof-trim-right',
    'box',
    [slopeLen + 0.03, 0.055, 0.075],
    'ink',
    [roofOffset, 1.585 - roofOffset, 0.645],
    [0, 0, -slopeAngle]
  );

  // Raised stone chimney on the right roof slope, rising cleanly above the ridge
  art.solid('chimney-stack', 'prism', [0.30, 0.94, 0.30], 'stone', [0.42, 1.47, -0.14]);
  art.solid('chimney-collar', 'prism', [0.36, 0.08, 0.36], 'ink', [0.42, 1.90, -0.14]);
  art.solid('chimney-pot', 'cylinder', [0.16, 0.13, 0.16], 'accent', [0.42, 1.99, -0.14]);
  // Exterior stone hearth buttress on the right wall beneath the chimney
  art.solid('hearth-buttress', 'prism', [0.16, 0.68, 0.36], 'stone', [0.69, 0.56, -0.14]);

  // Framed front doorway (left-of-center on +Z wall) with stone doorstep & tiny porch awning
  const doorX = -0.26;
  const frontZ = 0.53;
  art.solid('door-step', 'prism', [0.46, 0.13, 0.28], 'stone', [doorX, 0.24, frontZ + 0.13]);
  art.solid('door-frame-left', 'box', [0.068, 0.54, 0.095], 'ink', [doorX - 0.19, 0.58, frontZ + 0.025]);
  art.solid('door-frame-right', 'box', [0.068, 0.54, 0.095], 'ink', [doorX + 0.19, 0.58, frontZ + 0.025]);
  art.solid('door-frame-top', 'box', [0.45, 0.068, 0.11], 'ink', [doorX, 0.855, frontZ + 0.03]);
  art.solid('door-panel', 'box', [0.32, 0.50, 0.06], 'accent', [doorX, 0.57, frontZ + 0.015]);
  art.solid('door-knob', 'oval', [0.065, 0.065, 0.065], 'light', [doorX + 0.095, 0.55, frontZ + 0.06]);

  // Tiny sloped porch awning raised slightly clear of door lintel with sturdy timber brackets
  art.solid('porch-awning', 'box', [0.56, 0.068, 0.32], 'leaf', [doorX, 0.955, frontZ + 0.145], [0.34, 0, 0]);
  art.solid('porch-awning-lip', 'box', [0.58, 0.048, 0.055], 'ink', [doorX, 0.90, frontZ + 0.295]);
  art.between(
    'porch-bracket-left',
    [doorX - 0.21, 0.72, frontZ + 0.015],
    [doorX - 0.21, 0.895, frontZ + 0.23],
    0.052,
    'ink',
    'box'
  );
  art.between(
    'porch-bracket-right',
    [doorX + 0.21, 0.72, frontZ + 0.015],
    [doorX + 0.21, 0.895, frontZ + 0.23],
    0.052,
    'ink',
    'box'
  );

  // Hero glowing round porthole window facing forward (+Z) — bold, unobstructed warm circular glow
  const portOffset = [0.31, 0.03, 0];
  art.disc('porthole-frame', 'walls-main', 'front', 0.43, 0.095, 'ink', portOffset, 'ring');
  art.disc('porthole-bezel', 'walls-main', 'front', 0.34, 0.075, 'accent', portOffset, 'ring');
  art.disc('porthole-glass', 'walls-main', 'front', 0.29, 0.06, 'light', portOffset, 'cylinder');
  art.adjust('porthole-glass', { unlit: 0.94 });

  // Warm side window on the left wall (-X) and cozy shuttered timber window on the back wall (-Z)
  art.solid('side-window-frame', 'box', [0.065, 0.28, 0.28], 'ink', [-0.68, 0.63, -0.04]);
  art.solid('side-window-glass', 'box', [0.08, 0.19, 0.19], 'light', [-0.685, 0.63, -0.04], [0, 0, 0], 0.86);
  art.solid('back-window-frame', 'box', [0.30, 0.28, 0.065], 'ink', [-0.14, 0.63, -0.54]);
  art.solid('back-window-glass', 'box', [0.20, 0.19, 0.08], 'light', [-0.14, 0.63, -0.545], [0, 0, 0], 0.82);

  return art.finish();
}

async function main() {
  await mkdir(__dirname, { recursive: true });
  const specs = [
    ['fox-courier.art.json', buildFoxCourier()],
    ['apothecary-lantern.art.json', buildApothecaryLantern()],
    ['windswept-cottage.art.json', buildWindsweptCottage()]
  ];

  for (const [file, recipe] of specs) {
    // Validate with modelFromArtRecipe (and rigFromArtRecipe when rigged)
    const model = modelFromArtRecipe(recipe);
    if (recipe.joints?.length) {
      const rig = rigFromArtRecipe(recipe);
      for (const [clipName, clipDef] of Object.entries(recipe.clips ?? {})) {
        for (const frame of clipDef.frames) {
          const b = artPoseBounds(model, frame.poses);
          if (Math.abs(b.min[1]) > 0.01) {
            throw new Error(`${file} clip "${clipName}" t=${frame.time} is not grounded (minY=${b.min[1]})`);
          }
        }
      }
      console.log(
        `OK ${file}: ${model.parts.length} parts, ${recipe.joints.length} joints, clips=[${Object.keys(rig.clips).join(', ')}], frameSize=${recipe.frameSize}, span=${recipe.span.toFixed(3)}`
      );
    } else {
      console.log(
        `OK ${file}: ${model.parts.length} parts, frameSize=${recipe.frameSize}, span=${recipe.span.toFixed(3)}`
      );
    }

    const outPath = path.join(__dirname, file);
    await writeFile(outPath, JSON.stringify(recipe, null, 2) + '\n', 'utf8');
  }
}

await main();
