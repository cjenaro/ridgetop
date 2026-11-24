import assert from 'node:assert/strict'
import test from 'node:test'
import { createSpriteSheet, spriteColumn } from '../packages/ridgetop/framework/index.ts'
import { paintScout, scoutClips, suits } from '../examples/beacon-run/game/sprite-art.ts'

test('pixel art stays within its cell and preserves transparent pixels and RGB channels', () => {
  const sheet = createSpriteSheet(3, 2, 2, 2)
  const cell = sheet.frame(1, 1)
  cell.polygon([[0, 0], [3, 0], [3, 2], [0, 2]], '#2055aa')
  cell.rect(1, 1, 1, 1, 'ff0080')
  for (let y = 0; y < sheet.height; y++) {
    for (let x = 0; x < sheet.width; x++) {
      const offset = (y * sheet.width + x) * 4
      const expected = y < 2 || x < 3 ? [0, 0, 0, 0] : x === 4 && y === 3 ? [255, 0, 128, 255] : [32, 85, 170, 255]
      assert.deepEqual(Array.from(sheet.pixels.subarray(offset, offset + 4)), expected)
    }
  }
  assert.throws(() => sheet.frame(2, 0), /outside/)
  assert.throws(() => cell.rect(2, 0, 2, 1, 'ffffff'), /outside/)
  assert.throws(() => cell.polygon([[0, 0], [4, 0], [0, 2]], 'ffffff'), /within/)
  assert.throws(() => cell.polygon([[null as unknown as number, 0], [2, 0], [0, 2]], 'ffffff'), /within/)
  assert.throws(() => cell.rect(0, 0, 1, 1, 'sand'), /RGB/)
  assert.throws(() => cell.rect(0, 0, 1, 1, 123456 as unknown as string), RangeError)
})

test('regenerating a scout changes its palette while preserving its animated silhouette', () => {
  const makePose = (suit: number, pose: number) => {
    const sheet = createSpriteSheet(40, 48, 1)
    paintScout(sheet.frame(0), pose, suits[suit])
    return sheet.pixels
  }
  const base = makePose(0, 2)
  const variant = makePose(1, 2)
  const alpha = (pixels: Uint8ClampedArray) => pixels.filter((_, i) => i % 4 === 3)
  assert.deepEqual(makePose(0, 2), base)
  assert.notDeepEqual(variant, base)
  assert.deepEqual(alpha(variant), alpha(base))
  assert.notDeepEqual(alpha(makePose(0, 3)), alpha(base))
})

test('named clips start, advance and loop at the authored millisecond boundaries', () => {
  assert.deepEqual([-1, 0, 82, 83, 331, 332].map(ms => spriteColumn(scoutClips.run, ms)), [2, 2, 2, 3, 5, 2])
  assert.equal(spriteColumn(scoutClips.fall, 5000), 7)
})
