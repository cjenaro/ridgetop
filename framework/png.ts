import { deflateSync } from 'node:zlib'

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

/** Write RGBA pixels, optionally cropping rows from a wider source sheet. */
export function encodePng(imageWidth: number, imageHeight: number, rgba: Uint8ClampedArray | Uint8Array, stride = imageWidth) {
  if (![imageWidth, imageHeight, stride].every(n => Number.isSafeInteger(n) && n > 0) || stride < imageWidth ||
      rgba.byteLength < 4 * ((imageHeight - 1) * stride + imageWidth)) throw new RangeError('Invalid RGBA image dimensions')
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  const info = Buffer.alloc(13)
  info.writeUInt32BE(imageWidth, 0)
  info.writeUInt32BE(imageHeight, 4)
  info.set([8, 6], 8)
  const rowSize = imageWidth * 4
  const scanlines = Buffer.alloc((rowSize + 1) * imageHeight)
  for (let y = 0; y < imageHeight; y++) {
    pixels.copy(scanlines, y * (rowSize + 1) + 1, y * stride * 4, y * stride * 4 + rowSize)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', info), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))
  ])
}
