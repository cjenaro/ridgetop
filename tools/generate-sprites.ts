import { writeFile } from 'node:fs/promises'
import { encodePng } from '../framework/png.ts'
import { createSpriteSheet } from '../framework/index.ts'
import { chipClips, chipPalette, frameHeight, frameWidth, paintChip, paintScout, scoutClips, suits } from '../game/sprite-art.ts'

const columns = Math.max(...Object.values(scoutClips).map(clip => clip.column + clip.frames))
const sheet = createSpriteSheet(frameWidth, frameHeight, columns, suits.length + 1)
for (const [slot, palette] of suits.entries()) {
  for (let pose = 0; pose < columns; pose++) paintScout(sheet.frame(pose, slot), pose, palette)
}
for (let pose = 0; pose < chipClips.sparkle.frames; pose++) paintChip(sheet.frame(pose, suits.length), pose, chipPalette)

const assets = new URL('../game/assets/', import.meta.url)
const manifest = {
  src: 'sprites.png', frameWidth, frameHeight,
  clips: { ...scoutClips, sparkle: { ...chipClips.sparkle, row: suits.length } }
}
await writeFile(new URL('sprites.png', assets), encodePng(sheet.width, sheet.height, sheet.pixels))
await writeFile(new URL('scout.png', assets), encodePng(frameWidth, frameHeight, sheet.pixels, sheet.width))
await writeFile(new URL('sprites.json', assets), JSON.stringify(manifest, null, 2) + '\n')
