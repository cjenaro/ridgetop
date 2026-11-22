import type { SpriteClip, SpriteFrame } from '../framework/index.ts'

export const frameWidth = 40
export const frameHeight = 48
export const scoutClips = {
  idle: { column: 0, frames: 2, frameMs: 650 },
  run:  { column: 2, frames: 4, frameMs: 83 },
  jump: { column: 6, frames: 1, frameMs: 83 },
  fall: { column: 7, frames: 1, frameMs: 83 }
} satisfies Record<string, SpriteClip>
export const chipClips = { sparkle: { column: 0, frames: 4, frameMs: 140 } } satisfies Record<string, SpriteClip>

const ink = '101c2c'
const navy = '263b53'
const steel = '58788a'
const cream = 'fff2bf'
const glass = '173f54'
const teal = '388d9c'
const mint = '99ebdb'
export const suits = [
  ['783d4c', 'bb5746', 'ef8a50', 'ffd184'],
  ['6f3457', 'ac4970', 'e47b89', 'ffd0a7'],
  ['245655', '378478', '72be91', 'd6f3b0'],
  ['50365e', '845674', 'ca86b0', 'ffd4e6'],
  ['303d6e', '4c68a1', '80aadc', 'd4eaff'],
  ['62502f', '9e7a39', 'dbb853', 'fff1a8'],
  ['48355d', '73549a', 'ac88d7', 'ebcaff'],
  ['255166', '3b7c98', '6fb9ce', 'c3f2ed']
]

export const chipPalette = ['8d5266', 'e5988e', 'fff2bf', 'ffd39a']
type Point = readonly [number, number]

export function paintScout({ rect: r, polygon }: SpriteFrame, pose: number, [dark, shade, mid, bright]: readonly string[]) {
  const run = pose >= 2 && pose <= 5
  const air = pose >= 6
  const dy = [0, 1, 1, -1, 1, -1, -2, 0][pose]
  const stride = [-5, -2, 5, 2][pose - 2] ?? 0
  const lean = run ? 2 : Number(air)
  const p = (points: readonly Point[], hex: string) => polygon(points.map(([x, y]) => [x, y + dy]), hex)

  const tail = air ? -8 : run ? -5 + (pose % 2) * 3 : 0
  p([[19, 23], [11, 24], [3, 23 + tail], [0, 26 + tail], [4, 29 + tail], [12, 29], [20, 26]], ink)
  p([[17, 24], [11, 25], [3, 24 + tail], [2, 26 + tail], [5, 28 + tail], [12, 28], [18, 25]], shade)
  p([[16, 24], [11, 25], [4, 24 + tail], [3, 25 + tail], [11, 27]], bright)
  p([[14, 23], [8, 25], [7, 32], [10, 35], [15, 32]], ink)
  p([[12, 25], [9, 27], [9, 31], [12, 32], [14, 28]], navy)
  r(9, 27 + dy, 2, 2, mint)

  function boot(x: number, y: number, front: boolean) {
    polygon([[x + 1, y - 9], [x + 6, y - 9], [x + 8, y - 4], [x + 9, y - 2],
      [x + 9, y], [x, y], [x - 1, y - 3]], ink)
    polygon([[x + 2, y - 8], [x + 5, y - 8], [x + 7, y - 4], [x + 8, y - 3],
      [x + 8, y - 1], [x + 1, y - 1], [x, y - 3]], front ? navy : dark)
    r(x + 2, y - 7, 3, 3, front ? mid : shade)
    r(x + 4, y - 3, 3, 1, front ? steel : shade)
  }

  boot(13 - stride, air ? 39 + (pose - 6) * 2 : 43 - (stride > 0 ? 4 : 0), false)
  boot(19 + stride, air ? 41 - (pose - 6) * 3 : 43 - (stride < 0 ? 4 : 0), true)
  p([[14, 22], [23, 21], [28, 25], [27, 33], [23, 37], [15, 36], [11, 31], [11, 26]], ink)
  p([[15, 24], [23, 23], [27, 26], [25, 32], [23, 35], [16, 35], [13, 31], [13, 26]], shade)
  p([[16, 24], [23, 24], [25, 26], [23, 30], [16, 31], [14, 29]], mid)
  p([[15, 26], [20, 25], [22, 26], [19, 28], [15, 28]], bright)
  r(15, 32 + dy, 9, 2, navy)
  r(19, 32 + dy, 3, 2, cream)
  r(20, 32 + dy, 1, 1, mint)

  // The stepped visor and contrasting ear silhouette read even at one sprite pixel per screen pixel.
  const helmet = (points: readonly Point[], hex: string) => p(points.map(([x, y]) => [x + lean, y]), hex)
  helmet([[13, 11], [13, 5], [15, 3], [19, 8], [24, 8], [28, 4], [30, 5], [30, 11],
    [34, 15], [34, 21], [30, 25], [19, 26], [12, 23], [9, 19], [9, 15]], ink)
  helmet([[14, 11], [14, 5], [16, 6], [19, 10], [25, 9], [28, 6], [29, 12],
    [33, 16], [32, 21], [28, 24], [19, 25], [13, 22], [11, 19], [11, 15]], shade)
  helmet([[12, 15], [15, 12], [15, 8], [18, 11], [24, 10], [27, 9], [28, 13],
    [31, 15], [26, 18], [17, 19], [12, 18]], mid)
  helmet([[13, 15], [17, 12], [21, 11], [26, 11], [28, 13], [22, 13], [17, 15]], bright)
  helmet([[17, 17], [21, 14], [30, 13], [33, 16], [33, 19], [30, 22], [21, 23], [17, 21]], ink)
  helmet([[19, 17], [22, 15], [30, 14], [32, 16], [31, 20], [28, 21], [21, 22], [18, 20]], glass)
  helmet([[20, 18], [24, 16], [30, 15], [32, 16], [30, 18], [24, 18], [21, 20]], teal)
  helmet([[24, 16], [30, 15], [31, 16], [27, 17], [24, 18]], mint)
  r(14 + lean, 20 + dy, 2, 2, bright)
  r(19 + lean, 23 + dy, 8, 1, dark)

  const hand = run && stride < 0 ? -2 : 0
  const lift = air ? -4 : 0
  p([[24 + hand, 25 + lift], [28 + hand, 25 + lift], [30 + hand, 29 + lift],
    [27 + hand, 33 + lift], [23 + hand, 31 + lift], [22 + hand, 28 + lift]], ink)
  p([[25 + hand, 26 + lift], [27 + hand, 26 + lift], [29 + hand, 29 + lift],
    [26 + hand, 32 + lift], [24 + hand, 30 + lift], [23 + hand, 28 + lift]], mid)
  r(25 + hand, 29 + lift + dy, 2, 2, bright)
}

export function paintChip({ rect: r, polygon: p }: SpriteFrame, pose: number, [shade, shell, core, contacts]: readonly string[]) {
  // Gold contacts and a glowing core distinguish the optional chip from the cyan relay crystals.
  p([[10, 29], [12, 19], [26, 10], [32, 14], [31, 25], [17, 35]], ink)
  p([[12, 29], [14, 20], [26, 12], [30, 15], [29, 24], [17, 33]], shade)
  p([[13, 27], [15, 20], [26, 13], [29, 15], [27, 22], [17, 30]], shell)
  p([[18, 24], [19, 19], [25, 16], [27, 17], [25, 22], [20, 26]], core)
  r(14, 25, 2, 2, contacts)
  r(17, 28, 2, 2, contacts)
  r(25, 22, 2, 2, contacts)
  r(4 + pose, 18 - pose, 2, 2, core)
  r(33 - pose, 27 + pose, 2, 2, 'ffbe9c')
}
