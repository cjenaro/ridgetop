import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applySpriteOutline, createSpriteSheet, outlinePixelRegion, parseHexRgba, spriteColumn
} from '../packages/ridgetop/framework/index.ts'
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

test('SpriteFrame.blit performs bounds-clipped alpha-over RGBA copies and rejects invalid source sizes', () => {
  const sheet = createSpriteSheet(4, 4, 2, 1)
  const dst = sheet.frame(0, 0)
  const neighbor = sheet.frame(1, 0)
  dst.rect(0, 0, 4, 4, '#204080')

  // 2x2 source: opaque red, transparent, 50% green, opaque white
  const src = new Uint8ClampedArray([
    255, 0, 0, 255,       0, 0, 0, 0,
    0, 255, 0, 128,       255, 255, 255, 255
  ])
  // Blit across the right edge (dx = 3) so column 1 clips cleanly without bleeding into cell (1, 0)
  dst.blit(src, 2, 2, 3, 1)
  assert.equal(dst.getPixel(3, 1), '#ff0000')
  assert.equal(neighbor.getPixel(0, 1), null, 'Blit must clip to cell bounds without bleeding into adjacent cell')

  // Alpha-over blend on (3, 2): 50% green (a=128) over #204080 (32, 64, 128, 255)
  const blendIdx = (2 * sheet.width + 3) * 4
  assert.equal(sheet.pixels[blendIdx + 3], 255)
  assert.ok(sheet.pixels[blendIdx + 1] > 140 && sheet.pixels[blendIdx + 1] < 180)
  assert.ok(sheet.pixels[blendIdx + 2] > 50 && sheet.pixels[blendIdx + 2] < 80)

  // Negative offset clips top-left cleanly and skips transparent pixels
  dst.blit(src, 2, 2, -1, -1)
  assert.equal(dst.getPixel(0, 0), '#ffffff')

  // Self-aliasing blit (source shares backing buffer with sheet) shifts without corrupting pixels
  const selfSheet = createSpriteSheet(4, 4, 1, 1)
  const sf = selfSheet.frame(0, 0)
  sf.pixel(0, 0, '#ffaa00')
  sf.blit(selfSheet.pixels, 4, 4, 1, 0)
  assert.equal(sf.getPixel(0, 0), '#ffaa00')
  assert.equal(sf.getPixel(1, 0), '#ffaa00')
  assert.equal(sf.getPixel(2, 0), null)

  // Non-finite offsets are safe no-ops; invalid dimensions throw RangeError
  sf.blit(src, 2, 2, NaN, 0)
  assert.throws(() => sf.blit(new Uint8ClampedArray(4), 2, 2), RangeError)
  assert.throws(() => sf.blit(src, -1, 2), RangeError)
})

test('parseHexRgba, outlinePixelRegion, SpriteFrame.outline, and applySpriteOutline share one unified outline core', () => {
  assert.deepEqual(parseHexRgba('#123456'), [0x12, 0x34, 0x56, 255])
  assert.deepEqual(parseHexRgba('12345680'), [0x12, 0x34, 0x56, 0x80])
  assert.deepEqual(parseHexRgba('#f08', true), [255, 0, 136, 255])
  assert.throws(() => parseHexRgba('#f08'), RangeError)
  assert.throws(() => parseHexRgba('invalid'), RangeError)

  // SpriteFrame.outline and applySpriteOutline produce identical output for both selout and #rrggbbaa
  const makeFixture = () => {
    const s = createSpriteSheet(8, 8, 2, 1)
    s.frame(0, 0).rect(2, 2, 4, 4, '#55a05a')
    // Touching the right edge of cell 0 tests zero bleed into cell 1
    s.frame(0, 0).rect(7, 3, 1, 2, '#d87040')
    s.frame(1, 0).rect(3, 3, 2, 2, '#d87040')
    return s
  }

  const viaFrameSelout = makeFixture()
  viaFrameSelout.frame(0, 0).outline('selout')
  viaFrameSelout.frame(1, 0).outline('selout')
  const viaBakerSelout = makeFixture()
  applySpriteOutline(viaBakerSelout.pixels, viaBakerSelout.width, viaBakerSelout.height, 8, 'selout')
  assert.deepEqual(viaBakerSelout.pixels, viaFrameSelout.pixels)
  // Cell 0 edge pixel at x=7 must not bleed an outline into cell 1 at x=0
  assert.equal(viaBakerSelout.frame(1, 0).getPixel(0, 3), null)

  // Translucent #rrggbbaa outline works in both SpriteFrame.outline and applySpriteOutline
  const viaFrameAlpha = makeFixture()
  viaFrameAlpha.frame(0, 0).outline('#10203080')
  viaFrameAlpha.frame(1, 0).outline('#10203080')
  const viaBakerAlpha = makeFixture()
  applySpriteOutline(viaBakerAlpha.pixels, viaBakerAlpha.width, viaBakerAlpha.height, 8, '#10203080')
  assert.deepEqual(viaBakerAlpha.pixels, viaFrameAlpha.pixels)
  const outlineIdx = (2 * viaBakerAlpha.width + 1) * 4
  assert.deepEqual(Array.from(viaBakerAlpha.pixels.subarray(outlineIdx, outlineIdx + 4)), [0x10, 0x20, 0x30, 0x80])

  // Direct outlinePixelRegion validates bounds and supports palette-snapped selout
  const pal = ['#101824', '#2c4a34', '#55a05a']
  const snapSheet = createSpriteSheet(8, 8, 1, 1)
  snapSheet.frame(0, 0).rect(2, 2, 4, 4, '#55a05a')
  outlinePixelRegion(snapSheet.pixels, 8, 0, 0, 8, 8, 'selout', { palette: pal })
  assert.ok(pal.includes(snapSheet.frame(0, 0).getPixel(1, 2)!))
  assert.throws(() => outlinePixelRegion(snapSheet.pixels, 8, 4, 0, 8, 8, '#112233'), RangeError)
  assert.throws(() => applySpriteOutline(snapSheet.pixels, 8, 8, 8, 'not-a-color'), RangeError)
})
