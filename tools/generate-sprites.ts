import { writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { createSpriteSheet } from '../framework/index.ts'
import { chipClips, chipPalette, frameHeight, frameWidth, paintChip, paintScout, scoutClips, suits } from '../game/sprite-art.ts'

const columns = Math.max(...Object.values(scoutClips).map(clip => clip.column + clip.frames))
const sheet = createSpriteSheet(frameWidth, frameHeight, columns, suits.length + 1)
for (const [slot, palette] of suits.entries()) {
  for (let pose = 0; pose < columns; pose++) paintScout(sheet.frame(pose, slot), pose, palette)
}
for (let pose = 0; pose < chipClips.sparkle.frames; pose++) paintChip(sheet.frame(pose, suits.length), pose, chipPalette)

const pixels = Buffer.from(sheet.pixels.buffer)
function chunk(type: string, data: Buffer) {
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

function encodePng(imageWidth: number, imageHeight: number) {
  const info = Buffer.alloc(13)
  info.writeUInt32BE(imageWidth, 0)
  info.writeUInt32BE(imageHeight, 4)
  info.set([8, 6], 8)
  const rowSize = imageWidth * 4
  const scanlines = Buffer.alloc((rowSize + 1) * imageHeight)
  for (let y = 0; y < imageHeight; y++) {
    pixels.copy(scanlines, y * (rowSize + 1) + 1, y * sheet.width * 4, y * sheet.width * 4 + rowSize)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', info), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))
  ])
}

const assets = new URL('../game/assets/', import.meta.url)
const manifest = {
  src: 'sprites.png', frameWidth, frameHeight,
  clips: { ...scoutClips, sparkle: { ...chipClips.sparkle, row: suits.length } }
}
await writeFile(new URL('sprites.png', assets), encodePng(sheet.width, sheet.height))
await writeFile(new URL('scout.png', assets), encodePng(frameWidth, frameHeight))
await writeFile(new URL('sprites.json', assets), JSON.stringify(manifest, null, 2) + '\n')
