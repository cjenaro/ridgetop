import { Buffer } from 'node:buffer'
import * as zlib from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_MAX_DIM = 0x7fffffff

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0)
  crcTable[n] = c >>> 0
}

const nativeCrc32 = typeof (zlib as { crc32?: (buf: Uint8Array) => number }).crc32 === 'function'
  ? (zlib as { crc32: (buf: Uint8Array) => number }).crc32
  : null

function computeCrc32(bytes: Uint8Array) {
  if (nativeCrc32) return nativeCrc32(bytes) >>> 0
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer) {
  const out = Buffer.allocUnsafe(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(computeCrc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** Write RGBA pixels, optionally cropping rows from a wider source sheet. */
export function encodePng(imageWidth: number, imageHeight: number, rgba: Uint8ClampedArray | Uint8Array, stride = imageWidth) {
  if (![imageWidth, imageHeight, stride].every(n => Number.isSafeInteger(n) && n > 0 && n <= PNG_MAX_DIM) ||
      stride < imageWidth ||
      rgba.byteLength < 4 * ((imageHeight - 1) * stride + imageWidth)) {
    throw new RangeError('Invalid RGBA image dimensions')
  }
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)
  const info = Buffer.alloc(13)
  info.writeUInt32BE(imageWidth, 0)
  info.writeUInt32BE(imageHeight, 4)
  info[8] = 8
  info[9] = 6
  const rowSize = imageWidth * 4
  const strideBytes = stride * 4
  const scanlineSize = rowSize + 1
  const scanlines = Buffer.allocUnsafe(scanlineSize * imageHeight)
  for (let y = 0; y < imageHeight; y++) {
    const dest = y * scanlineSize
    scanlines[dest] = 0
    pixels.copy(scanlines, dest + 1, y * strideBytes, y * strideBytes + rowSize)
  }
  const idat = zlib.deflateSync(scanlines)
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', info),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}
