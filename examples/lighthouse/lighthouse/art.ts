import {
  archMesh, box, chamferedPrism, color, createRig, cylinder, instances, mesh, octahedron, revolvedMesh
} from 'ridgetop'
import type { AnimationClip, Color, InstanceBatch, Mesh, Rig, Vec3 } from 'ridgetop'
import { COTTAGE_POS, LIGHTHOUSE_POS, PIER_POS, islandHeight } from './types.ts'

export const TIDEWATCH_PALETTE = {
  ground: '#7cb56b',
  leaf: '#2f6d5c',
  wood: '#9e6b43',
  stone: '#7b8f98',
  ink: '#263844',
  accent: '#e87646',
  light: '#ffebb0',
  glow: '#7ff7df'
} as const

// --- Shared Sculpted Low-Poly Meshes (using revolvedMesh, archMesh, chamferedPrism) ---
export const drum = cylinder(10)
export const drum12 = cylinder(12)
export const cone = cylinder(10, 0)
export const pineCone = cylinder(7, 0)
export const rockMesh = chamferedPrism(.20, .66, .78)
export const softBox = chamferedPrism(.15, .90, .90)
export const taperedCoat = chamferedPrism(.16, .76, .78)
export const arch = archMesh()
export const domeMesh = revolvedMesh([[0, -.5], [.44, -.5], [.50, -.34], [.47, -.08], [.37, .18], [.22, .39], [0, .5]], 10)
export const ovalMesh = revolvedMesh([[0, -.5], [.32, -.38], [.48, -.15], [.50, .08], [.42, .30], [.25, .44], [0, .5]], 8)
export const barrelMesh = revolvedMesh([[0, -.5], [.38, -.5], [.49, -.22], [.50, 0], [.49, .22], [.38, .5], [0, .5]], 9)
export const buoyFloatMesh = revolvedMesh([[0, -.5], [.34, -.46], [.50, -.12], [.48, .18], [.34, .44], [.22, .5], [0, .5]], 10)
export const ringTorus = revolvedMesh([[.36, -.5], [.48, -.5], [.50, -.28], [.50, .28], [.48, .5], [.36, .5], [.33, .28], [.33, -.28], [.36, -.5]], 10)
export const coinMesh = cylinder(8)

// Gable roof mesh (ridge along X)
export const roofMesh = mesh([
  -.5, 0, -.5,  .5, 0, -.5,  -.5, 0, .5,  .5, 0, .5,  -.5, 1, 0,  .5, 1, 0
], [2, 3, 5, 2, 5, 4, 0, 4, 5, 0, 5, 1, 0, 2, 4, 1, 5, 3, 0, 1, 3, 0, 3, 2])

// Tapered lighthouse light-beam cone (apex at origin, extends along +Z)
export const beamMesh = (() => {
  const sides = 8
  const positions: number[] = [0, 0, 0]
  const indices: number[] = []
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    positions.push(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1)
  }
  for (let i = 0; i < sides; i++) {
    const next = ((i + 1) % sides) + 1
    indices.push(0, next, i + 1)
  }
  return mesh(positions, indices)
})()

// Sculpted curved billowing sail mesh (faces +X, billows outward along +X)
export const sailMesh = mesh([
  // Left edge (z = -0.5)
  0.00, -0.5, -0.5,   0.18, 0.0, -0.5,   0.00, 0.5, -0.5,
  // Center belly (z = 0)
  0.10, -0.5,  0.0,   0.32, 0.0,  0.0,   0.10, 0.5,  0.0,
  // Right edge (z = +0.5)
  0.00, -0.5,  0.5,   0.18, 0.0,  0.5,   0.00, 0.5,  0.5,
  // Back offset thickness
  -0.06, -0.5, -0.5,  0.10, 0.0, -0.5,  -0.06, 0.5, -0.5,
   0.02, -0.5,  0.0,  0.22, 0.0,  0.0,   0.02, 0.5,  0.0,
  -0.06, -0.5,  0.5,  0.10, 0.0,  0.5,  -0.06, 0.5,  0.5
], [
  // Front (+X normal)
  0, 3, 4,  0, 4, 1,   1, 4, 5,  1, 5, 2,
  3, 6, 7,  3, 7, 4,   4, 7, 8,  4, 8, 5,
  // Back (-X normal)
  9, 13, 12,  9, 10, 13,  10, 14, 13, 10, 11, 14,
  12, 16, 15, 12, 13, 16, 13, 17, 16, 13, 14, 17
])

// Sculpted ship hull mesh (pointed prow at +X, raised stern at -X)
export const hullMesh = mesh([
  -0.52,  0.55, -0.34, // 0 stern-port
  -0.52,  0.55,  0.34, // 1 stern-stbd
   0.24,  0.48,  0.38, // 2 bow-shoulder-stbd
   0.64,  0.58,  0.00, // 3 prow-tip
   0.24,  0.48, -0.38, // 4 bow-shoulder-port
  -0.38, -0.50, -0.20, // 5
  -0.38, -0.50,  0.20, // 6
   0.18, -0.50,  0.22, // 7
   0.42, -0.34,  0.00, // 8
   0.18, -0.50, -0.22  // 9
], [
  0, 1, 2,  0, 2, 4,  4, 2, 3,
  0, 5, 6,  0, 6, 1,
  1, 6, 7,  1, 7, 2,
  2, 7, 8,  2, 8, 3,
  3, 8, 9,  3, 9, 4,
  4, 9, 5,  4, 5, 0,
  5, 9, 7,  5, 7, 6,  7, 9, 8
])

// Flat upward-facing ring for interactive ground pads & sea ripples
export const flatRing = (() => {
  const segs = 18
  const inner = 0.80, outer = 1.0
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    pos.push(c * inner, 0, s * inner, c * outer, 0, s * outer)
    const cur = i * 2
    const nxt = ((i + 1) % segs) * 2
    idx.push(cur, nxt + 1, cur + 1, cur, nxt, nxt + 1)
  }
  return mesh(pos, idx)
})()

// --- Color Palette Helpers ---
const C_INK = color('263844')
const C_SKIN = color('f0c5a2')
const C_BEARD = color('efe4cb')
const C_HAT = color('ebb336')
const C_HAT_TRIM = color('c98c24')
const C_SCARF = color('d95943')
const C_BRASS = color('e8b954')
const C_LANTERN_GLOW = color('84ffdf')
const C_LANTERN_WARM = color('ffe79c')
const C_SWEATER = color('2e5874')
const C_APRON = color('e8dcc0')
const C_CAP_RED = color('d14f3c')
const C_WOOD_DARK = color('6b4831')
const C_WOOD_MID = color('9e6b43')
const C_WOOD_LIGHT = color('c49160')
const C_WHITE = color('f5f0e1')
const C_GRAY = color('8a9ca3')
const C_BEAK = color('f09c3e')
const C_PINE_DARK = color('275c4f')
const C_PINE_MID = color('337560')
const C_PINE_TOP = color('4c9674')
const C_RED_FLAG = color('e65440')

// =========================================================================
// ARTICULATED HIERARCHICAL RIGS (powered by framework/animation.ts!)
// =========================================================================

/** 10-joint Lighthouse Keeper rig inspired by Ridgetop's lighthouse-keeper reference. */
export const keeperRig: Rig = createRig([
  { id: 'hips', pivot: [0, 0.44, 0] },
  {
    id: 'left-leg', parent: 'hips', pivot: [-0.16, -0.02, 0],
    parts: [
      { name: 'trouser', mesh: softBox, position: [0, -0.14, 0], scale: [0.18, 0.24, 0.19], color: C_INK },
      { name: 'boot', mesh: softBox, position: [0, -0.32, 0.05], scale: [0.22, 0.20, 0.32], color: C_INK },
      { name: 'cuff', mesh: drum, position: [0, -0.22, 0.01], scale: [0.12, 0.06, 0.12], color: C_HAT_TRIM }
    ]
  },
  {
    id: 'right-leg', parent: 'hips', pivot: [0.16, -0.02, 0],
    parts: [
      { name: 'trouser', mesh: softBox, position: [0, -0.14, 0], scale: [0.18, 0.24, 0.19], color: C_INK },
      { name: 'boot', mesh: softBox, position: [0, -0.32, 0.05], scale: [0.22, 0.20, 0.32], color: C_INK },
      { name: 'cuff', mesh: drum, position: [0, -0.22, 0.01], scale: [0.12, 0.06, 0.12], color: C_HAT_TRIM }
    ]
  },
  {
    id: 'torso', parent: 'hips', pivot: [0, 0.04, 0],
    parts: [
      { name: 'coat-hem', mesh: taperedCoat, position: [0, 0.08, 0], scale: [0.68, 0.24, 0.50], color: C_HAT },
      { name: 'coat-body', mesh: taperedCoat, position: [0, 0.38, 0], scale: [0.60, 0.62, 0.44], color: C_HAT },
      { name: 'placket', mesh: box, position: [0, 0.36, 0.22], scale: [0.06, 0.56, 0.04], color: C_WHITE },
      { name: 'belt', mesh: box, position: [0, 0.19, 0.01], scale: [0.62, 0.09, 0.46], color: C_INK },
      { name: 'buckle', mesh: box, position: [0, 0.19, 0.245], scale: [0.12, 0.10, 0.04], color: C_BRASS },
      { name: 'scarf', mesh: ringTorus, position: [0, 0.69, 0.01], scale: [0.44, 0.13, 0.40], color: C_SCARF }
    ]
  },
  {
    id: 'head', parent: 'torso', pivot: [0, 0.74, 0.01],
    parts: [
      { name: 'face', mesh: ovalMesh, position: [0, 0.20, 0.01], scale: [0.44, 0.42, 0.42], color: C_SKIN },
      { name: 'beard', mesh: softBox, position: [0, 0.08, 0.16], scale: [0.34, 0.24, 0.18], color: C_BEARD },
      { name: 'nose', mesh: octahedron, position: [0, 0.20, 0.22], scale: [0.055, 0.045, 0.055], color: color('e5a382') },
      { name: 'left-eye', mesh: octahedron, position: [-0.10, 0.25, 0.20], scale: [0.042, 0.045, 0.04], color: C_INK },
      { name: 'right-eye', mesh: octahedron, position: [0.10, 0.25, 0.20], scale: [0.042, 0.045, 0.04], color: C_INK },
      { name: 'hat-brim', mesh: drum, position: [0, 0.38, -0.02], scale: [0.42, 0.07, 0.46], rotation: [-0.10, 0, 0], color: C_HAT },
      { name: 'hat-band', mesh: drum, position: [0, 0.43, -0.02], scale: [0.27, 0.06, 0.29], rotation: [-0.10, 0, 0], color: C_INK },
      { name: 'hat-crown', mesh: domeMesh, position: [0, 0.50, -0.03], scale: [0.50, 0.26, 0.52], rotation: [-0.10, 0, 0], color: C_HAT }
    ]
  },
  {
    id: 'left-arm', parent: 'torso', pivot: [-0.34, 0.58, 0.01],
    parts: [
      { name: 'sleeve', mesh: softBox, position: [-0.04, -0.20, 0.02], scale: [0.19, 0.44, 0.21], color: C_HAT },
      { name: 'hand', mesh: ovalMesh, position: [-0.04, -0.44, 0.04], scale: [0.14, 0.14, 0.14], color: C_SKIN }
    ]
  },
  {
    id: 'right-arm', parent: 'torso', pivot: [0.34, 0.58, 0.01],
    parts: [
      { name: 'sleeve', mesh: softBox, position: [0.04, -0.20, 0.02], scale: [0.19, 0.44, 0.21], color: C_HAT },
      { name: 'hand', mesh: ovalMesh, position: [0.05, -0.44, 0.05], scale: [0.14, 0.14, 0.14], color: C_SKIN }
    ]
  },
  {
    id: 'lantern', parent: 'right-arm', pivot: [0.08, -0.48, 0.10],
    parts: [
      { name: 'bail', mesh: arch, position: [0, -0.05, 0], scale: [0.18, 0.14, 0.04], color: C_INK },
      { name: 'cap', mesh: cone, position: [0, -0.14, 0], scale: [0.14, 0.10, 0.14], color: C_SCARF },
      { name: 'glow', mesh: drum, position: [0, -0.26, 0], scale: [0.11, 0.20, 0.11], color: C_LANTERN_GLOW, unlit: 0.98 },
      { name: 'base', mesh: drum, position: [0, -0.38, 0], scale: [0.14, 0.08, 0.14], color: C_INK }
    ]
  },
  {
    id: 'pack', parent: 'torso', pivot: [0, 0.40, -0.26],
    parts: [
      { name: 'pack-main', mesh: softBox, position: [0, 0, -0.05], scale: [0.46, 0.50, 0.24], color: C_WOOD_MID },
      { name: 'pack-flap', mesh: softBox, position: [0, 0.21, -0.06], scale: [0.48, 0.14, 0.26], color: C_WOOD_LIGHT },
      { name: 'pack-pocket', mesh: softBox, position: [0, -0.10, -0.17], scale: [0.32, 0.20, 0.08], color: C_WOOD_DARK },
      { name: 'pack-strap-l', mesh: box, position: [-0.14, 0.04, -0.17], scale: [0.05, 0.44, 0.04], color: C_INK },
      { name: 'pack-strap-r', mesh: box, position: [0.14, 0.04, -0.17], scale: [0.05, 0.44, 0.04], color: C_INK }
    ]
  }
])

export const keeperClips: Record<'idle' | 'run' | 'carryRun' | 'wade' | 'celebrate', AnimationClip> = {
  idle: {
    duration: 2.2,
    tracks: {
      hips: [
        { t: 0, position: [0, 0, 0] },
        { t: 1.1, position: [0, 0.035, 0] },
        { t: 2.2, position: [0, 0, 0] }
      ],
      torso: [
        { t: 0, rotation: [0.02, 0, 0] },
        { t: 1.1, rotation: [-0.02, 0, 0] },
        { t: 2.2, rotation: [0.02, 0, 0] }
      ],
      head: [
        { t: 0, rotation: [0, -0.14, 0] },
        { t: 1.1, rotation: [0.04, 0.16, 0.04] },
        { t: 2.2, rotation: [0, -0.14, 0] }
      ],
      'right-arm': [
        { t: 0, rotation: [-0.28, 0, 0.08] },
        { t: 1.1, rotation: [-0.34, 0, 0.12] },
        { t: 2.2, rotation: [-0.28, 0, 0.08] }
      ],
      lantern: [
        { t: 0, rotation: [0.24, 0, -0.06] },
        { t: 1.1, rotation: [0.34, 0, 0.06] },
        { t: 2.2, rotation: [0.24, 0, -0.06] }
      ]
    }
  },
  run: {
    duration: 0.56,
    tracks: {
      hips: [
        { t: 0, position: [0, 0.02, 0] },
        { t: 0.14, position: [0, 0.12, 0] },
        { t: 0.28, position: [0, 0.02, 0] },
        { t: 0.42, position: [0, 0.12, 0] },
        { t: 0.56, position: [0, 0.02, 0] }
      ],
      torso: [
        { t: 0, rotation: [0.20, 0.12, -0.05] },
        { t: 0.28, rotation: [0.20, -0.12, 0.05] },
        { t: 0.56, rotation: [0.20, 0.12, -0.05] }
      ],
      head: [
        { t: 0, rotation: [-0.14, -0.08, 0.04] },
        { t: 0.28, rotation: [-0.14, 0.08, -0.04] },
        { t: 0.56, rotation: [-0.14, -0.08, 0.04] }
      ],
      'left-leg': [
        { t: 0, rotation: [-0.72, 0, 0] },
        { t: 0.28, rotation: [0.72, 0, 0] },
        { t: 0.56, rotation: [-0.72, 0, 0] }
      ],
      'right-leg': [
        { t: 0, rotation: [0.72, 0, 0] },
        { t: 0.28, rotation: [-0.72, 0, 0] },
        { t: 0.56, rotation: [0.72, 0, 0] }
      ],
      'left-arm': [
        { t: 0, rotation: [0.68, 0, -0.10] },
        { t: 0.28, rotation: [-0.62, 0, -0.08] },
        { t: 0.56, rotation: [0.68, 0, -0.10] }
      ],
      'right-arm': [
        { t: 0, rotation: [-0.66, 0, 0.14] },
        { t: 0.28, rotation: [-0.26, 0, 0.18] },
        { t: 0.56, rotation: [-0.66, 0, 0.14] }
      ],
      lantern: [
        { t: 0, rotation: [0.46, 0, -0.16] },
        { t: 0.28, rotation: [0.10, 0, 0.18] },
        { t: 0.56, rotation: [0.46, 0, -0.16] }
      ]
    }
  },
  carryRun: {
    duration: 0.62,
    tracks: {
      hips: [
        { t: 0, position: [0, -0.02, 0] },
        { t: 0.155, position: [0, 0.09, 0] },
        { t: 0.31, position: [0, -0.02, 0] },
        { t: 0.465, position: [0, 0.09, 0] },
        { t: 0.62, position: [0, -0.02, 0] }
      ],
      torso: [
        { t: 0, rotation: [0.30, 0.10, -0.08] },
        { t: 0.31, rotation: [0.30, -0.10, 0.08] },
        { t: 0.62, rotation: [0.30, 0.10, -0.08] }
      ],
      head: [
        { t: 0, rotation: [-0.22, -0.06, 0.05] },
        { t: 0.31, rotation: [-0.22, 0.06, -0.05] },
        { t: 0.62, rotation: [-0.22, -0.06, 0.05] }
      ],
      'left-leg': [
        { t: 0, rotation: [-0.64, 0, 0] },
        { t: 0.31, rotation: [0.64, 0, 0] },
        { t: 0.62, rotation: [-0.64, 0, 0] }
      ],
      'right-leg': [
        { t: 0, rotation: [0.64, 0, 0] },
        { t: 0.31, rotation: [-0.64, 0, 0] },
        { t: 0.62, rotation: [0.64, 0, 0] }
      ],
      'left-arm': [
        { t: 0, rotation: [0.42, 0, -0.22] },
        { t: 0.31, rotation: [-0.36, 0, -0.22] },
        { t: 0.62, rotation: [0.42, 0, -0.22] }
      ],
      'right-arm': [
        { t: 0, rotation: [-0.55, 0, 0.24] },
        { t: 0.31, rotation: [-0.35, 0, 0.24] },
        { t: 0.62, rotation: [-0.55, 0, 0.24] }
      ],
      pack: [
        { t: 0, rotation: [0.06, 0, -0.09] },
        { t: 0.31, rotation: [0.06, 0, 0.09] },
        { t: 0.62, rotation: [0.06, 0, -0.09] }
      ]
    }
  },
  wade: {
    duration: 0.78,
    tracks: {
      hips: [
        { t: 0, position: [0, 0, 0] },
        { t: 0.20, position: [0, 0.08, 0] },
        { t: 0.39, position: [0, 0, 0] },
        { t: 0.58, position: [0, 0.08, 0] },
        { t: 0.78, position: [0, 0, 0] }
      ],
      torso: [
        { t: 0, rotation: [0.16, 0.14, -0.10] },
        { t: 0.39, rotation: [0.16, -0.14, 0.10] },
        { t: 0.78, rotation: [0.16, 0.14, -0.10] }
      ],
      'left-leg': [
        { t: 0, rotation: [-0.88, 0, 0] },
        { t: 0.39, rotation: [0.55, 0, 0] },
        { t: 0.78, rotation: [-0.88, 0, 0] }
      ],
      'right-leg': [
        { t: 0, rotation: [0.55, 0, 0] },
        { t: 0.39, rotation: [-0.88, 0, 0] },
        { t: 0.78, rotation: [0.55, 0, 0] }
      ],
      'left-arm': [
        { t: 0, rotation: [0.22, 0, -0.35] },
        { t: 0.39, rotation: [-0.22, 0, -0.35] },
        { t: 0.78, rotation: [0.22, 0, -0.35] }
      ],
      'right-arm': [
        { t: 0, rotation: [-0.72, 0, 0.30] },
        { t: 0.39, rotation: [-0.52, 0, 0.30] },
        { t: 0.78, rotation: [-0.72, 0, 0.30] }
      ]
    }
  },
  celebrate: {
    duration: 0.72,
    loop: false,
    tracks: {
      hips: [
        { t: 0, position: [0, -0.06, 0], scale: [1.10, 0.90, 1.10] },
        { t: 0.26, position: [0, 0.44, 0], scale: [0.92, 1.12, 0.92], ease: 'easeOut' },
        { t: 0.56, position: [0, -0.04, 0], scale: [1.08, 0.92, 1.08] },
        { t: 0.72, position: [0, 0, 0], scale: [1, 1, 1] }
      ],
      'right-arm': [
        { t: 0, rotation: [-0.4, 0, 0.1] },
        { t: 0.28, rotation: [-2.2, 0, 0.25], ease: 'easeOut' },
        { t: 0.72, rotation: [-0.3, 0, 0.1] }
      ],
      'left-arm': [
        { t: 0, rotation: [0, 0, -0.1] },
        { t: 0.28, rotation: [-1.8, 0, -0.35], ease: 'easeOut' },
        { t: 0.72, rotation: [0, 0, -0.1] }
      ]
    }
  }
}

/** Articulated Harbor Merchant behind the Trading Pier counter. */
export const merchantRig: Rig = createRig([
  {
    id: 'torso', pivot: [0, 0.55, 0],
    parts: [
      { mesh: taperedCoat, position: [0, 0.22, 0], scale: [0.62, 0.62, 0.46], color: C_SWEATER },
      { mesh: box, position: [0, 0.14, 0.22], scale: [0.42, 0.48, 0.05], color: C_APRON }
    ]
  },
  {
    id: 'head', parent: 'torso', pivot: [0, 0.56, 0],
    parts: [
      { mesh: ovalMesh, position: [0, 0.19, 0], scale: [0.40, 0.38, 0.38], color: C_SKIN },
      { mesh: softBox, position: [0, 0.09, 0.14], scale: [0.30, 0.18, 0.16], color: C_WOOD_DARK },
      { mesh: octahedron, position: [-0.09, 0.22, 0.18], scale: [0.04, 0.04, 0.04], color: C_INK },
      { mesh: octahedron, position: [0.09, 0.22, 0.18], scale: [0.04, 0.04, 0.04], color: C_INK },
      { mesh: domeMesh, position: [0, 0.35, -0.02], scale: [0.44, 0.24, 0.44], color: C_CAP_RED },
      { mesh: ringTorus, position: [0, 0.28, 0], scale: [0.44, 0.09, 0.44], color: C_WHITE }
    ]
  },
  {
    id: 'left-arm', parent: 'torso', pivot: [-0.34, 0.42, 0],
    parts: [
      { mesh: softBox, position: [-0.04, -0.16, 0.04], scale: [0.16, 0.36, 0.18], color: C_SWEATER },
      { mesh: ovalMesh, position: [-0.04, -0.35, 0.06], scale: [0.13, 0.13, 0.13], color: C_SKIN }
    ]
  },
  {
    id: 'right-arm', parent: 'torso', pivot: [0.34, 0.42, 0],
    parts: [
      { mesh: softBox, position: [0.04, -0.16, 0.04], scale: [0.16, 0.36, 0.18], color: C_SWEATER },
      { mesh: ovalMesh, position: [0.04, -0.35, 0.06], scale: [0.13, 0.13, 0.13], color: C_SKIN }
    ]
  }
])

/** Flapping Coastal Seagull Rig (hinged left & right wings!). */
export const gullRig: Rig = createRig([
  {
    id: 'body', pivot: [0, 0, 0],
    parts: [
      { mesh: ovalMesh, position: [0, 0, 0], scale: [0.34, 0.26, 0.72], color: C_WHITE },
      { mesh: ovalMesh, position: [0, 0.12, 0.36], scale: [0.22, 0.22, 0.26], color: C_WHITE },
      { mesh: cone, position: [0, 0.11, 0.56], scale: [0.06, 0.20, 0.06], rotation: [Math.PI / 2, 0, 0], color: C_BEAK },
      { mesh: box, position: [0, 0.03, -0.44], scale: [0.28, 0.05, 0.24], color: C_GRAY }
    ]
  },
  {
    id: 'left-wing', parent: 'body', pivot: [-0.14, 0.06, 0.04],
    parts: [
      { mesh: box, position: [-0.34, 0, -0.02], scale: [0.68, 0.05, 0.30], color: C_WHITE },
      { mesh: box, position: [-0.74, -0.01, -0.05], scale: [0.30, 0.04, 0.20], color: C_INK }
    ]
  },
  {
    id: 'right-wing', parent: 'body', pivot: [0.14, 0.06, 0.04],
    parts: [
      { mesh: box, position: [0.34, 0, -0.02], scale: [0.68, 0.05, 0.30], color: C_WHITE },
      { mesh: box, position: [0.74, -0.01, -0.05], scale: [0.30, 0.04, 0.20], color: C_INK }
    ]
  }
])

/** Wind-Swaying 3-Joint Coastal Pine Rig! */
export const pineRig: Rig = createRig([
  {
    id: 'trunk', pivot: [0, 0, 0],
    parts: [
      { mesh: drum, position: [0, 0.42, 0], scale: [0.18, 0.84, 0.18], color: C_WOOD_DARK }
    ]
  },
  {
    id: 'lower', parent: 'trunk', pivot: [0, 0.65, 0],
    parts: [
      { mesh: pineCone, position: [0, 0.48, 0], scale: [0.88, 1.05, 0.88], color: C_PINE_DARK }
    ]
  },
  {
    id: 'mid', parent: 'lower', pivot: [0, 0.56, 0],
    parts: [
      { mesh: pineCone, position: [0, 0.42, 0], scale: [0.68, 0.92, 0.68], rotation: [0, 0.45, 0], color: C_PINE_MID }
    ]
  },
  {
    id: 'crown', parent: 'mid', pivot: [0, 0.50, 0],
    parts: [
      { mesh: pineCone, position: [0, 0.34, 0], scale: [0.46, 0.78, 0.46], rotation: [0, 0.9, 0], color: C_PINE_TOP }
    ]
  }
])

/** Bobbing Harbor Signal Buoy Rig (modeled on Ridgetop's signal-buoy.art.json!). */
export const buoyRig: Rig = createRig([
  {
    id: 'float', pivot: [0, 0, 0],
    parts: [
      { mesh: buoyFloatMesh, position: [0, 0.14, 0], scale: [1.15, 0.76, 1.15], color: C_SCARF },
      { mesh: ringTorus, position: [0, 0.24, 0], scale: [1.16, 0.14, 1.16], color: C_INK },
      { mesh: drum, position: [0, 0.60, 0], scale: [0.14, 0.65, 0.14], color: C_GRAY },
      { mesh: drum, position: [0, 0.95, 0], scale: [0.22, 0.12, 0.22], color: C_INK },
      { name: 'beacon-lamp', mesh: drum, position: [0, 1.14, 0], scale: [0.16, 0.26, 0.16], color: C_LANTERN_GLOW, unlit: 0.98 },
      { mesh: cone, position: [0, 1.34, 0], scale: [0.24, 0.16, 0.24], color: C_SCARF },
      { mesh: arch, position: [0, 1.18, 0], scale: [0.48, 0.46, 0.06], color: C_GRAY }
    ]
  }
])

/** Articulated Offshore Sailing Ship Rig (rocking hull + billowing sail + fluttering pennant!). */
export const shipRig: Rig = createRig([
  {
    id: 'hull', pivot: [0, 0, 0],
    parts: [
      { mesh: hullMesh, position: [0, 0, 0], scale: [3.8, 0.92, 1.6], color: C_WOOD_DARK },
      { mesh: hullMesh, position: [0, 0.06, 0], scale: [3.84, 0.16, 1.64], color: C_WHITE },
      { mesh: softBox, position: [-0.85, 0.68, 0], scale: [1.18, 0.66, 0.96], color: C_WOOD_MID },
      { mesh: box, position: [-0.85, 1.03, 0], scale: [1.28, 0.10, 1.06], color: C_SCARF },
      { mesh: box, position: [-0.85, 0.72, 0.49], scale: [0.28, 0.22, 0.04], color: C_LANTERN_WARM, unlit: 0.9 },
      { mesh: box, position: [-0.85, 0.72, -0.49], scale: [0.28, 0.22, 0.04], color: C_LANTERN_WARM, unlit: 0.9 },
      // Bowsprit & Mast
      { mesh: drum, position: [2.10, 0.58, 0], scale: [0.08, 1.15, 0.08], rotation: [0, 0, -1.25], color: C_WOOD_LIGHT },
      { mesh: drum, position: [0.35, 1.85, 0], scale: [0.10, 3.05, 0.10], color: C_WOOD_LIGHT },
      { mesh: box, position: [0.35, 2.75, 0], scale: [0.10, 0.10, 2.05], color: C_WOOD_DARK },
      { mesh: box, position: [0.35, 1.10, 0], scale: [0.09, 0.09, 1.85], color: C_WOOD_DARK },
      // Bow lantern (turns cyan-gold once guided!)
      { name: 'ship-lantern', mesh: octahedron, position: [2.25, 0.76, 0], scale: [0.22, 0.28, 0.22], color: C_LANTERN_WARM, unlit: 0.98 }
    ]
  },
  {
    id: 'sail', parent: 'hull', pivot: [0.42, 1.92, 0],
    parts: [
      { mesh: sailMesh, position: [0, 0, 0], scale: [1.0, 1.68, 1.80], color: C_WHITE },
      { mesh: box, position: [0.22, 0, 0], scale: [0.06, 0.24, 1.72], color: C_SCARF }
    ]
  },
  {
    id: 'flag', parent: 'hull', pivot: [0.35, 3.35, 0],
    parts: [
      { mesh: box, position: [-0.36, 0, 0], scale: [0.72, 0.26, 0.05], color: C_RED_FLAG }
    ]
  }
])

/** Articulated Pier Auto-Salvage Winch Crane Rig. */
export const winchRig: Rig = createRig([
  {
    id: 'base', pivot: [0, 0, 0],
    parts: [
      { mesh: drum, position: [0, 0.18, 0], scale: [0.58, 0.36, 0.58], color: C_INK },
      { mesh: ringTorus, position: [0, 0.36, 0], scale: [0.62, 0.12, 0.62], color: C_BRASS }
    ]
  },
  {
    id: 'turret', parent: 'base', pivot: [0, 0.40, 0],
    parts: [
      { mesh: softBox, position: [0, 0.28, -0.10], scale: [0.52, 0.56, 0.62], color: C_SCARF },
      { mesh: drum, position: [0, 0.98, 0], scale: [0.14, 1.45, 0.14], color: C_WOOD_DARK },
      { mesh: box, position: [0, 1.62, 0.68], scale: [0.16, 0.18, 1.75], rotation: [-0.32, 0, 0], color: C_BRASS },
      { mesh: ringTorus, position: [0, 1.90, 1.42], scale: [0.24, 0.10, 0.24], rotation: [0, 0, Math.PI / 2], color: C_INK }
    ]
  },
  {
    id: 'cable', parent: 'turret', pivot: [0, 1.88, 1.44],
    parts: [
      { mesh: drum, position: [0, -0.45, 0], scale: [0.035, 0.90, 0.035], color: C_INK },
      { mesh: softBox, position: [0, -0.98, 0], scale: [0.46, 0.40, 0.42], color: C_WOOD_LIGHT },
      { mesh: box, position: [0, -0.98, 0], scale: [0.48, 0.10, 0.44], color: C_INK }
    ]
  }
])

// --- High-Craft Resource Pickup Rigs (bobbing, sparkling, distinct silhouettes!) ---
export const driftwoodRig: Rig = createRig([
  {
    id: 'root', pivot: [0, 0, 0],
    parts: [
      { mesh: drum, position: [0, 0.16, 0], scale: [0.16, 1.05, 0.16], rotation: [0, 0.15, Math.PI / 2], color: C_WOOD_MID },
      { mesh: drum, position: [0.05, 0.14, 0.22], scale: [0.14, 0.88, 0.14], rotation: [0, -0.22, Math.PI / 2], color: C_WOOD_DARK },
      { mesh: drum, position: [-0.04, 0.30, 0.10], scale: [0.13, 0.82, 0.13], rotation: [0.08, 0.32, Math.PI / 2], color: C_WOOD_LIGHT },
      { mesh: ringTorus, position: [-0.14, 0.21, 0.09], scale: [0.42, 0.08, 0.42], rotation: [0, 0.1, Math.PI / 2], color: C_BEARD },
      { mesh: ringTorus, position: [0.18, 0.21, 0.09], scale: [0.40, 0.08, 0.40], rotation: [0, -0.1, Math.PI / 2], color: C_BEARD }
    ]
  }
])

export const salvageRig: Rig = createRig([
  {
    id: 'root', pivot: [0, 0, 0],
    parts: [
      { mesh: softBox, position: [0, 0.30, 0], scale: [0.76, 0.56, 0.56], color: C_WOOD_MID },
      { mesh: domeMesh, position: [0, 0.62, 0], scale: [0.78, 0.22, 0.58], color: C_SCARF },
      { mesh: box, position: [-0.24, 0.36, 0], scale: [0.08, 0.62, 0.60], color: C_INK },
      { mesh: box, position: [0.24, 0.36, 0], scale: [0.08, 0.62, 0.60], color: C_INK },
      { mesh: box, position: [0, 0.44, 0.30], scale: [0.18, 0.18, 0.06], color: C_BRASS, unlit: 0.3 },
      { mesh: arch, position: [-0.40, 0.36, 0], scale: [0.16, 0.14, 0.05], rotation: [0, Math.PI / 2, 0], color: C_BRASS },
      { mesh: arch, position: [0.40, 0.36, 0], scale: [0.16, 0.14, 0.05], rotation: [0, Math.PI / 2, 0], color: C_BRASS }
    ]
  }
])

export const amberRig: Rig = createRig([
  {
    id: 'root', pivot: [0, 0, 0],
    parts: [
      { mesh: rockMesh, position: [0, 0.14, 0], scale: [0.76, 0.28, 0.72], color: C_INK },
      { mesh: octahedron, position: [0, 0.56, 0], scale: [0.24, 0.52, 0.22], rotation: [0.08, 0.3, -0.06], color: C_LANTERN_GLOW, unlit: 0.78 },
      { mesh: octahedron, position: [-0.22, 0.40, 0.14], scale: [0.15, 0.34, 0.15], rotation: [-0.20, 0.4, 0.28], color: C_LANTERN_WARM, unlit: 0.72 },
      { mesh: octahedron, position: [0.21, 0.36, -0.10], scale: [0.14, 0.30, 0.14], rotation: [0.16, -0.3, -0.30], color: color('ffae52'), unlit: 0.68 }
    ]
  }
])

/** Coastal pine locations (animated dynamically via pineRig for wind sway!). */
export const COASTAL_PINES: readonly (readonly [x: number, z: number, scale: number, phase: number])[] = [
  [-6.6, -4.2, 1.38, 0.1], [-5.4, -5.2, 1.08, 1.2], [-7.5, -2.5, 1.18, 2.3],
  [5.8, -4.5, 1.34, 0.7], [6.8, -3.2, 1.02, 1.9], [4.4, -5.4, 1.15, 3.1],
  [7.4, -0.4, 1.08, 2.7], [-1.8, -5.6, 1.28, 0.5], [1.2, -5.8, 0.98, 4.0]
]

/** Offshore floating signal buoy coordinates. */
export const HARBOR_BUOYS: readonly (readonly [x: number, z: number, phase: number])[] = [
  [-11.8, 7.6, 0.0],
  [12.6, 8.2, 2.1],
  [1.8, 10.6, 4.2]
]

function bareTerrainHeight(x: number, z: number): number {
  if (x >= -8.4 && x <= -3.6 && z >= 2.2 && z <= 6.8) {
    const t = Math.max(0, Math.min(1, (z - 2.0) / 4.8))
    return 0.42 - t * 0.92
  }
  return islandHeight(x, z)
}

/** Generate the static faceted low-poly coastal headland, beach, and tidal shoals. */
export function buildTerrainBatches(): InstanceBatch[] {
  const cols = 40
  const rows = 32
  const minX = -17.5, maxX = 18.5
  const minZ = -11.5, maxZ = 14.5
  const stepX = (maxX - minX) / cols
  const stepZ = (maxZ - minZ) / rows

  const pts: Vec3[] = []
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const bx = minX + c * stepX
      const bz = minZ + r * stepZ
      const interior = r > 0 && r < rows && c > 0 && c < cols
      const jx = interior ? Math.sin(r * 3.7 + c * 2.1) * stepX * 0.22 : 0
      const jz = interior ? Math.cos(c * 4.1 - r * 1.9) * stepZ * 0.22 : 0
      const x = bx + jx
      const z = bz + jz
      const edge = Math.min(r, rows - r, c, cols - c)
      const sink = edge < 3 ? (3 - edge) * 0.34 : 0
      pts.push([x, bareTerrainHeight(x, z) - sink, z])
    }
  }

  const buckets = new Map<string, number[]>()
  const addTri = (hex: string, a: number, b: number, c: number) => {
    let arr = buckets.get(hex)
    if (!arr) { arr = []; buckets.set(hex, arr) }
    arr.push(a, b, c)
  }

  const grassTones = ['76b066', '6ba45e', '84bc70', '649a58']
  const cliffTones = ['6b7f89', '7b8f96', '5c707a', '899a9e']
  const sandTones = ['e0ca96', 'd6be89', 'e8d4a2']
  const shoalTones = ['9d957a', '8d8770', 'aba184']
  const seabedTones = ['2f5a6b', '264e5e']

  const classify = (a: Vec3, b: Vec3, c: Vec3, hash: number): string => {
    const avgY = (a[1] + b[1] + c[1]) / 3
    const slope = Math.max(a[1], b[1], c[1]) - Math.min(a[1], b[1], c[1])
    if (avgY > 1.02 && slope < 0.28) return grassTones[hash % grassTones.length]
    if (avgY > 0.66 && slope >= 0.22) return cliffTones[hash % cliffTones.length]
    if (avgY > 0.34) return sandTones[hash % sandTones.length]
    if (avgY > -0.18) return shoalTones[hash % shoalTones.length]
    return seabedTones[hash % seabedTones.length]
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c
      const b = a + cols + 1
      addTri(classify(pts[a], pts[b], pts[a + 1], (r * 7 + c * 13) & 15), a, b, a + 1)
      addTri(classify(pts[a + 1], pts[b], pts[b + 1], (r * 11 + c * 5 + 3) & 15), a + 1, b, b + 1)
    }
  }

  const packed = pts.flat()
  const batches: InstanceBatch[] = []
  for (const [hex, indices] of buckets) {
    const batch = instances(mesh(packed, indices))
    batch.add([0, 0, 0], [1, 1, 1], 0, color(hex))
    batches.push(batch)
  }
  return batches
}

const SHARED_LIGHTHOUSE_MESHES = new Set<Mesh>([
  box, octahedron, drum, drum12, cone, pineCone, rockMesh, softBox, taperedCoat, arch,
  domeMesh, ovalMesh, barrelMesh, buoyFloatMesh, ringTorus, coinMesh, roofMesh, beamMesh, sailMesh, hullMesh
])

export function isSharedLighthouseMesh(candidate: Mesh): boolean {
  return SHARED_LIGHTHOUSE_MESHES.has(candidate)
}

/** Assemble all static island landmarks & detailed architecture once (zero per-frame uploads!). */
export function buildStaticIslandBatches(): InstanceBatch[] {
  const byMesh = new Map<Mesh, InstanceBatch>()
  const put = (shape: Mesh, position: Vec3, scale: Vec3, tint: string, yaw = 0, unlit = 0) => {
    let batch = byMesh.get(shape)
    if (!batch) { batch = instances(shape); byMesh.set(shape, batch) }
    batch.add(position, scale, yaw, color(tint), unlit)
  }

  // --- 1. HERO LIGHTHOUSE TOWER (detailed stonework, arched door, gallery, cupola) ---
  const tx = LIGHTHOUSE_POS.x, tz = LIGHTHOUSE_POS.z
  const ty = islandHeight(tx, tz) - 0.12
  const cream = 'f6ebd0', red = 'da583e', iron = '273a45', stone = '8f9a97', copper = '4b857b'

  // Stepped stone plinth & entrance stairs
  put(drum12, [tx, ty + 0.24, tz], [1.74, 0.56, 1.74], '7d8c8b')
  put(drum12, [tx, ty + 0.58, tz], [1.54, 0.24, 1.54], stone)
  put(box, [tx, ty + 0.34, tz + 1.62], [0.92, 0.22, 0.44], stone)
  put(box, [tx, ty + 0.54, tz + 1.44], [0.78, 0.20, 0.34], '9ea8a4')

  // 5 tapered painted courses
  const courses = [
    [0.68, 1.60, 1.36, 1.22, cream],
    [1.60, 2.52, 1.22, 1.09, red],
    [2.52, 3.44, 1.09, 0.96, cream],
    [3.44, 4.36, 0.96, 0.85, red],
    [4.36, 5.26, 0.85, 0.76, cream]
  ] as const
  for (const [low, high, rBot, rTop, tint] of courses) {
    put(cylinder(12, rTop / rBot), [tx, ty + (low + high) / 2, tz], [rBot, high - low, rBot], tint)
  }

  // Arched timber doorway, brass handle & overhead warm transom lamp
  put(arch, [tx, ty + 1.26, tz + 1.28], [0.64, 0.94, 0.16], iron)
  put(box, [tx, ty + 1.18, tz + 1.26], [0.46, 0.78, 0.10], '5c3e2b')
  put(octahedron, [tx + 0.14, ty + 1.16, tz + 1.33], [0.05, 0.05, 0.05], 'f0c056', 0, 0.3)
  put(octahedron, [tx, ty + 1.78, tz + 1.32], [0.10, 0.12, 0.10], 'ffe599', 0, 0.95)

  // Framed recessed windows with stone sills
  for (const [wx, wy, wz, wyaw] of [
    [tx, ty + 2.98, tz + 1.02, 0],
    [tx + 0.90, ty + 3.88, tz, Math.PI / 2],
    [tx - 0.96, ty + 2.08, tz, -Math.PI / 2]
  ] as const) {
    put(box, [wx, wy, wz], [0.38, 0.50, 0.10], iron, wyaw)
    put(box, [wx, wy, wz], [0.26, 0.38, 0.13], 'ffdf8e', wyaw, 0.85)
    put(box, [wx, wy - 0.27, wz], [0.46, 0.08, 0.18], stone, wyaw)
  }

  // Corbelled gallery deck, 12-post railing & lantern room mullions
  put(cylinder(12, 1.32), [tx, ty + 5.20, tz], [0.84, 0.22, 0.84], stone)
  put(drum12, [tx, ty + 5.38, tz], [1.14, 0.20, 1.14], iron)
  const posts = 12
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2
    const b = ((i + 1) / posts) * Math.PI * 2
    const ax = Math.cos(a) * 1.04, az = Math.sin(a) * 1.04
    const bx = Math.cos(b) * 1.04, bz = Math.sin(b) * 1.04
    put(box, [tx + ax, ty + 5.72, tz + az], [0.055, 0.50, 0.055], iron)
    put(box, [tx + (ax + bx) / 2, ty + 5.95, tz + (az + bz) / 2],
      [0.055, 0.055, Math.hypot(bx - ax, bz - az)], iron, Math.atan2(bx - ax, bz - az))
    if (i % 2 === 0) {
      put(box, [tx + Math.cos(a) * 0.68, ty + 6.02, tz + Math.sin(a) * 0.68], [0.06, 1.12, 0.06], iron)
    }
  }
  // Copper-trimmed domed red cupola roof & spire
  put(drum12, [tx, ty + 6.58, tz], [0.84, 0.14, 0.84], copper)
  put(domeMesh, [tx, ty + 6.96, tz], [1.72, 0.72, 1.72], red)
  put(cone, [tx, ty + 7.40, tz], [0.44, 0.42, 0.44], copper)
  put(drum, [tx, ty + 7.72, tz], [0.06, 0.44, 0.06], iron)
  put(octahedron, [tx, ty + 7.98, tz], [0.12, 0.12, 0.12], 'f0c056', 0, 0.5)

  // Fuel hopper chute next to lighthouse door
  put(softBox, [tx + 1.38, ty + 0.44, tz + 1.1], [0.84, 0.68, 0.78], '6b4a33', -0.25)
  put(box, [tx + 1.38, ty + 0.78, tz + 1.1], [0.90, 0.10, 0.84], iron, -0.25)
  put(drum, [tx + 1.18, ty + 0.88, tz + 1.05], [0.12, 0.52, 0.12], '9e6b43', 0.4)

  // --- 2. KEEPER'S COTTAGE, PORCH & WORKSHOP FORGE ---
  const hx = COTTAGE_POS.x, hz = COTTAGE_POS.z
  const hy = islandHeight(hx, hz) - 0.10
  const cyaw = 0.12
  // Stone foundation plinth
  put(box, [hx, hy + 0.14, hz], [2.66, 0.34, 2.04], '7e8b8c', cyaw)
  // Stucco walls + timber corner beams
  put(box, [hx, hy + 0.90, hz], [2.46, 1.28, 1.86], cream, cyaw)
  for (const cx of [-1.22, 1.22]) for (const cz of [-0.92, 0.92]) {
    const rx = hx + cx * Math.cos(cyaw) + cz * Math.sin(cyaw)
    const rz = hz + cz * Math.cos(cyaw) - cx * Math.sin(cyaw)
    put(box, [rx, hy + 0.90, rz], [0.14, 1.32, 0.14], '5e422e', cyaw)
  }
  // Overhanging shingled gable roof + dark ridge beam
  put(roofMesh, [hx, hy + 1.50, hz], [2.92, 1.06, 2.34], 'b34f3b', cyaw)
  put(box, [hx, hy + 2.54, hz], [2.98, 0.12, 0.16], '4c3528', cyaw)
  // Tapered stone chimney
  put(box, [hx - 0.72, hy + 2.24, hz - 0.26], [0.42, 1.08, 0.44], '777e80', cyaw)
  put(box, [hx - 0.72, hy + 2.80, hz - 0.26], [0.50, 0.10, 0.52], '5c6568', cyaw)
  // Covered front porch + door + hanging warm lantern
  put(box, [hx + 0.45, hy + 0.68, hz + 0.94], [0.54, 0.98, 0.10], '396a73', cyaw)
  put(box, [hx + 0.45, hy + 1.24, hz + 1.18], [0.92, 0.10, 0.62], '8c3f30', cyaw)
  put(box, [hx + 0.08, hy + 0.68, hz + 1.40], [0.09, 1.12, 0.09], '5e422e', cyaw)
  put(box, [hx + 0.82, hy + 0.68, hz + 1.40], [0.09, 1.12, 0.09], '5e422e', cyaw)
  put(octahedron, [hx + 0.45, hy + 1.06, hz + 1.36], [0.10, 0.13, 0.10], 'ffe599', 0, 0.95)
  // Shuttered glowing front & side windows + flowerbox
  put(box, [hx - 0.56, hy + 0.92, hz + 0.94], [0.56, 0.48, 0.09], 'ffe08a', cyaw, 0.88)
  put(box, [hx - 0.92, hy + 0.92, hz + 0.95], [0.16, 0.50, 0.07], '386a73', cyaw)
  put(box, [hx - 0.20, hy + 0.92, hz + 0.95], [0.16, 0.50, 0.07], '386a73', cyaw)
  put(box, [hx - 0.56, hy + 0.64, hz + 1.02], [0.64, 0.14, 0.16], '6b4a33', cyaw)
  put(box, [hx + 1.25, hy + 0.92, hz + 0.05], [0.09, 0.46, 0.50], 'ffe08a', cyaw, 0.88)
  // Stacked firewood outside cottage
  for (let i = 0; i < 4; i++) {
    put(drum, [hx - 1.44, hy + 0.34 + (i > 1 ? 0.16 : 0), hz - 0.1 + (i % 2) * 0.22], [0.11, 0.58, 0.11], '8a5c3a', cyaw)
  }

  // Workshop Workbench & Anvil at Workshop Pad
  const wx = COTTAGE_POS.x + 0.25, wz = COTTAGE_POS.z + 1.75
  const wy = islandHeight(wx, wz)
  put(box, [wx, wy + 0.46, wz], [1.34, 0.12, 0.78], '9e6b43', 0.15)
  for (const lx of [-0.55, 0.55]) for (const lz of [-0.28, 0.28]) {
    put(box, [wx + lx, wy + 0.22, wz + lz], [0.12, 0.46, 0.12], '6b4831', 0.15)
  }
  put(softBox, [wx - 0.32, wy + 0.64, wz], [0.40, 0.24, 0.26], iron, 0.15)
  put(box, [wx - 0.32, wy + 0.76, wz], [0.54, 0.10, 0.22], '485c66', 0.15)
  put(octahedron, [wx + 0.42, wy + 0.66, wz + 0.14], [0.12, 0.18, 0.12], 'ffdf85', 0, 0.92)

  // --- 3. WARMTH BRAZIER HEARTH ---
  const bx = -1.3, bz = -2.1
  const by = islandHeight(bx, bz)
  put(drum, [bx, by + 0.16, bz], [0.64, 0.30, 0.64], '7d8b8c')
  put(ringTorus, [bx, by + 0.40, bz], [0.58, 0.24, 0.58], iron)
  put(box, [bx, by + 0.52, bz], [0.46, 0.10, 0.14], '5e3c28', 0.45)
  put(box, [bx, by + 0.52, bz], [0.46, 0.10, 0.14], '5e3c28', -0.85)

  // --- 4. WOODEN TRADING PIER, RAILINGS, BARRELS & CANOPY ---
  const px = PIER_POS.x, pz = PIER_POS.z
  for (let i = 0; i < 16; i++) {
    const zPos = 2.15 + i * 0.31
    put(box, [px, 0.63, zPos], [4.3, 0.10, 0.26], i % 2 ? 'ad8056' : '9b7048')
  }
  // Pilings & rope bollards
  for (const ox of [-1.92, 0, 1.92]) {
    for (const oz of [2.4, 4.3, 6.4]) {
      put(drum, [px + ox, -0.08, oz], [0.19, 1.54, 0.19], '634733')
      put(drum, [px + ox, 0.92, oz], [0.21, 0.34, 0.21], '7c5c43')
      put(ringTorus, [px + ox, 0.94, oz], [0.24, 0.08, 0.24], 'd8c69d')
    }
  }
  // Side wooden railings along the pier edge
  put(box, [px + 1.92, 1.06, 4.4], [0.08, 0.08, 4.0], '8a6443')
  // Merchant market counter & striped canvas canopy
  const mx = px - 1.38, mz = pz - 0.35
  put(box, [mx, 1.12, mz], [1.14, 0.88, 2.1], '7a5238')
  put(box, [mx + 0.06, 1.56, mz], [1.24, 0.09, 2.2], 'ad8056')
  for (const oz of [-0.94, 0.94]) {
    put(box, [mx - 0.48, 1.82, mz + oz], [0.10, 1.75, 0.10], '5a3d29')
    put(box, [mx + 0.48, 1.82, mz + oz], [0.10, 1.75, 0.10], '5a3d29')
  }
  for (let i = 0; i < 5; i++) {
    put(box, [mx, 2.66, mz - 0.88 + i * 0.44], [1.58, 0.12, 0.42], i % 2 ? 'df5e43' : 'f8ecd0')
  }
  put(octahedron, [mx + 0.66, 2.26, mz + 0.88], [0.16, 0.22, 0.16], 'ffe48c', 0, 0.96)
  // Merchant cargo barrels & fish crates on the pier
  put(barrelMesh, [px - 1.45, 0.98, pz + 1.35], [0.56, 0.64, 0.56], '8c5e3c')
  put(barrelMesh, [px - 0.92, 0.95, pz + 1.58], [0.48, 0.58, 0.48], '7a5032')
  put(softBox, [px + 1.25, 0.90, 2.55], [0.56, 0.46, 0.50], 'b8834b', 0.25)

  // Wooden coastal steps connecting headland to beach
  for (let s = 0; s < 5; s++) {
    const sx = -2.6 - s * 0.42, sz = 0.6 + s * 0.34
    put(box, [sx, islandHeight(sx, sz) + 0.04, sz], [0.95, 0.10, 0.36], 'a87d52', -0.62)
  }

  // Flagstone path between cottage and lighthouse
  for (const [sx, sz] of [[-2.3, -0.7], [-1.3, -0.4], [-0.2, -0.4], [0.9, -0.5]] as const) {
    put(drum, [sx, islandHeight(sx, sz) + 0.03, sz], [0.46, 0.06, 0.38], 'cfc5a5', sx * 0.7)
  }

  // --- 5. COASTAL ROCKS, REEF OUTCROPS & WILDFLOWERS ---
  const rocks: [number, number, number][] = [
    [6.4, -4.2, 1.50], [-7.2, -4.4, 1.44], [7.8, 1.4, 1.38],
    [10.2, 4.8, 1.18], [9.4, 6.2, 0.88], [-2.5, 8.2, 1.08],
    [-8.6, 0.4, 1.24], [4.2, 8.6, 0.98], [11.6, 2.5, 0.92]
  ]
  for (const [x, z, s] of rocks) {
    const ry = islandHeight(x, z)
    put(rockMesh, [x, ry + s * 0.25, z], [s, s * 0.76, s * 0.86], '6d818a', x * 0.9)
    put(rockMesh, [x + s * 0.38, ry + s * 0.14, z + s * 0.28], [s * 0.54, s * 0.44, s * 0.52], '5a6e77', -z)
  }

  // Coastal meadow wildflowers & sea-grass tufts on the grassy headland
  const flowers: [number, number, string][] = [
    [-4.8, -0.9, 'ffe07a'], [-4.5, -1.1, 'f58b6c'], [-0.6, -4.1, 'ffe07a'],
    [0.2, -4.4, '96f0dc'], [3.8, -3.9, 'ffe07a'], [4.2, -3.5, 'f58b6c'],
    [-2.8, -4.4, 'ffe07a'], [4.5, -1.4, '96f0dc']
  ]
  for (const [fx, fz, tint] of flowers) {
    const fy = islandHeight(fx, fz)
    put(pineCone, [fx, fy + 0.14, fz], [0.22, 0.26, 0.22], '488c5b', fx)
    put(octahedron, [fx, fy + 0.30, fz], [0.09, 0.09, 0.09], tint, fz, 0.3)
  }

  return [...buildTerrainBatches(), ...byMesh.values()]
}
