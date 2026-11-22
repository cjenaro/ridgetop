import { cylinder, octahedron } from '../framework/index.ts'
import type { ArtModel } from '../framework/index.ts'

// Edit this file first. Each map character occupies one tile.
export const game = {
  title: 'Lantern Grove',
  objective: 'Collect the crystals and return to the lantern.',
  returnToGoal: 'All crystals collected. Reach the lantern.',
  victory: 'Lantern lit. Grove complete!',
  palette: { leaf: '#387a65', accent: '#efac62', glow: '#83f0d6' },
  player: 'ranger', ground: 'tile', pickup: 'crystal', goal: 'lantern', effect: 'spark',
  scenery: { T: 'pine', O: 'rock', C: 'crate', f: 'flower' },
  // @ starts the player, * places a pickup, L marks the goal, . is open ground.
  map: [
    '..Tf..OT.',
    '.@.*...L.',
    '..C.T..f.',
    'T....*..O',
    '....O....',
    '..*...C..',
    '.Tf....T.'
  ],
  stepSeconds: .16
} as const

// Game-specific recipes work everywhere the built-in art does.
export const models = {
  flower: { span: .95, centerY: .28, parts: [
    { mesh: cylinder(5), position: [0, .16, 0], scale: [.035, .32, .035], tone: 'leaf' },
    { mesh: octahedron, position: [0, .37, 0], scale: [.21, .14, .19], tone: 'accent' },
    { mesh: octahedron, position: [0, .46, .02], scale: [.095, .085, .085], tone: 'light' }
  ] }
} satisfies Record<string, ArtModel>

// A workshop model can replace any named asset in both views. Put its saved JSON in game/art/.
// The starter includes a raincoat variant. Try { ranger: 'art/rain-ranger.art.json' }.
export const modelFiles: Record<string, string> = {}

// Optional hand-drawn art for the sprite view and inventory. Paths are relative to the game page.
// For example, ranger: { manifest: 'art/scout-sheet.json', clip: 'run' }.
export const sprites: Record<string, { manifest: string; clip: string }> = {}
