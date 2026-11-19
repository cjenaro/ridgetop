import { writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

const frameWidth = 40
const frameHeight = 48
const width = frameWidth * 8
const height = frameHeight * 9
const pixels = Buffer.alloc(width * height * 4)
const ink = '101c2c'
const navy = '263b53'
const steel = '58788a'
const cream = 'fff2bf'
const glass = '173f54'
const teal = '388d9c'
const mint = '99ebdb'
const suits = [
  ['783d4c', 'bb5746', 'ef8a50', 'ffd184'],
  ['6f3457', 'ac4970', 'e47b89', 'ffd0a7'],
  ['245655', '378478', '72be91', 'd6f3b0'],
  ['50365e', '845674', 'ca86b0', 'ffd4e6'],
  ['303d6e', '4c68a1', '80aadc', 'd4eaff'],
  ['62502f', '9e7a39', 'dbb853', 'fff1a8'],
  ['48355d', '73549a', 'ac88d7', 'ebcaff'],
  ['255166', '3b7c98', '6fb9ce', 'c3f2ed']
]

type Point = readonly [number, number]

function frame(column: number, row: number) {
  const ox = column * frameWidth
  const oy = row * frameHeight
  function pixel(x: number, y: number, tint: number) {
    if (x < 0 || x >= frameWidth || y < 0 || y >= frameHeight) throw new RangeError('Drawing outside sprite frame')
    const offset = ((oy + y) * width + ox + x) * 4
    pixels[offset] = tint >> 16
    pixels[offset + 1] = tint >> 8
    pixels[offset + 2] = tint
    pixels[offset + 3] = 255
  }
  function rect(x: number, y: number, w: number, h: number, hex: string) {
    const tint = Number.parseInt(hex, 16)
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) pixel(px, py, tint)
    }
  }
  function polygon(points: readonly Point[], hex: string) {
    const tint = Number.parseInt(hex, 16)
    const top = Math.min(...points.map(([, y]) => y))
    const bottom = Math.max(...points.map(([, y]) => y))
    for (let y = top; y < bottom; y++) {
      const cuts: number[] = []
      const scan = y + .5
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i]
        const [bx, by] = points[(i + 1) % points.length]
        if ((ay > scan) !== (by > scan)) cuts.push(ax + (bx - ax) * (scan - ay) / (by - ay))
      }
      cuts.sort((a, b) => a - b)
      for (let i = 0; i < cuts.length; i += 2) {
        for (let x = Math.ceil(cuts[i] - .5); x < cuts[i + 1] - .5; x++) pixel(x, y, tint)
      }
    }
  }
  return { rect, polygon }
}

function scout(slot: number, pose: number) {
  const { rect: r, polygon } = frame(pose, slot)
  const [dark, shade, mid, bright] = suits[slot]
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

for (let slot = 0; slot < suits.length; slot++) {
  for (let pose = 0; pose < 8; pose++) scout(slot, pose)
}
for (let pose = 0; pose < 4; pose++) {
  const { rect: r, polygon: p } = frame(pose, 8)
  // Gold contacts and a glowing core distinguish the optional chip from the cyan relay crystals.
  p([[10, 29], [12, 19], [26, 10], [32, 14], [31, 25], [17, 35]], ink)
  p([[12, 29], [14, 20], [26, 12], [30, 15], [29, 24], [17, 33]], '8d5266')
  p([[13, 27], [15, 20], [26, 13], [29, 15], [27, 22], [17, 30]], 'e5988e')
  p([[18, 24], [19, 19], [25, 16], [27, 17], [25, 22], [20, 26]], cream)
  r(14, 25, 2, 2, 'ffd39a')
  r(17, 28, 2, 2, 'ffd39a')
  r(25, 22, 2, 2, 'ffd39a')
  r(4 + pose, 18 - pose, 2, 2, cream)
  r(33 - pose, 27 + pose, 2, 2, 'ffbe9c')
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  const header = Buffer.alloc(4)
  const footer = Buffer.alloc(4)
  header.writeUInt32BE(data.length)
  let crc = 0xffffffff
  for (const byte of body) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([header, body, footer])
}

function encodePng(imageWidth, imageHeight) {
  const info = Buffer.alloc(13)
  info.writeUInt32BE(imageWidth, 0)
  info.writeUInt32BE(imageHeight, 4)
  info.set([8, 6], 8)
  const rowSize = imageWidth * 4
  const scanlines = Buffer.alloc((rowSize + 1) * imageHeight)
  for (let y = 0; y < imageHeight; y++) {
    pixels.copy(scanlines, y * (rowSize + 1) + 1, y * width * 4, y * width * 4 + rowSize)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', info), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))
  ])
}

await writeFile(new URL('../game/assets/sprites.png', import.meta.url), encodePng(width, height))
await writeFile(new URL('../game/assets/scout.png', import.meta.url), encodePng(frameWidth, frameHeight))
