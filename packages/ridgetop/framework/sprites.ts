import { captureSourceSite, isTestingActive, nextSpriteAtlasId, recordSpriteBegin, recordSpriteDraw } from './testing-runtime.ts'
import type { SpriteAtlasMeta } from './testing-runtime.ts'

export interface SpriteClip {
  /** First column of a horizontal sequence. The default row is zero. */
  column: number
  row?: number
  frames: number
  frameMs: number
}

export interface SpriteAtlasSource {
  src: string
  frameWidth: number
  frameHeight: number
  clips?: Readonly<Record<string, SpriteClip>>
}

export interface SpriteSheetImage {
  image: HTMLCanvasElement
  manifest: SpriteAtlasSource
}

type DrawOptions = { height: number; anchor?: number; flip?: boolean }
type Point = readonly [number, number]

/** Sample a looping clip using elapsed milliseconds. Pass zero for its first pose. */
export function spriteColumn(clip: SpriteClip, elapsedMs: number) {
  return clip.column + Math.floor(Math.max(0, elapsedMs) / clip.frameMs) % clip.frames
}

async function readManifest(url: string | URL): Promise<SpriteAtlasSource> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Could not load sprite manifest (' + response.status + ')')
  const manifest: SpriteAtlasSource = await response.json()
  if (typeof manifest?.src !== 'string' || !manifest.src) throw new Error('Expected a sprite image path in the manifest')
  return { ...manifest, src: new URL(manifest.src, response.url).href }
}

async function loadSpriteImage(src: string) {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

export async function createSpriteAtlas(canvas: HTMLCanvasElement, source: SpriteAtlasSource | SpriteSheetImage | string | URL) {
  const manifestUrl = typeof source === 'string' ? source : source instanceof URL ? source.href : undefined
  const atlas = typeof source === 'string' || source instanceof URL ? await readManifest(source) : source
  const { src, frameWidth, frameHeight, clips = {} } = 'manifest' in atlas ? atlas.manifest : atlas
  if (![frameWidth, frameHeight].every(n => Number.isSafeInteger(n) && n > 0)) throw new RangeError('Invalid sprite frame dimensions')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not create the sprite layer')
  const image = 'image' in atlas ? atlas.image : await loadSpriteImage(src)
  const rows = Math.floor(('naturalHeight' in image ? image.naturalHeight : image.height) / frameHeight)
  const columns = Math.floor(('naturalWidth' in image ? image.naturalWidth : image.width) / frameWidth)
  for (const [name, clip] of Object.entries(clips)) {
    const row = clip?.row ?? 0
    if (!Number.isSafeInteger(clip?.column) || clip.column < 0 ||
        !Number.isSafeInteger(clip.frames) || clip.frames < 1 || clip.column + clip.frames > columns ||
        !Number.isSafeInteger(row) || row < 0 || row >= rows || !(clip.frameMs > 0 && Number.isFinite(clip.frameMs))) {
      throw new RangeError('Invalid sprite clip: ' + name)
    }
  }

  let atlasMeta: SpriteAtlasMeta | undefined
  function ensureAtlasMeta(): SpriteAtlasMeta {
    atlasMeta ??= {
      id: nextSpriteAtlasId(),
      src,
      manifestUrl,
      frameWidth,
      frameHeight,
      rows,
      columns,
      clips,
      image,
      sourceSite: captureSourceSite()
    }
    return atlasMeta
  }
  if (isTestingActive()) ensureAtlasMeta()

  function inferClip(column: number, row: number): { clip?: string; frame: number } {
    for (const [name, spec] of Object.entries(clips)) {
      const specRow = spec.row ?? 0
      if (specRow === row && column >= spec.column && column < spec.column + spec.frames) {
        return { clip: name, frame: column - spec.column }
      }
    }
    return { frame: 0 }
  }

  function drawInternal(column: number, row: number, point: Point, { height, anchor = .9, flip = false }: DrawOptions, clipInfo?: { clip: string; frame: number }) {
    const h = canvas.height * height
    const w = h * frameWidth / frameHeight
    const x = Math.round((point[0] + 1) * canvas.width / 2)
    const y = Math.round((1 - point[1]) * canvas.height / 2)
    const left = x - w / 2
    const top = y - h * anchor
    if (left + w <= 0 || left >= canvas.width || top + h <= 0 || top >= canvas.height) return
    if (flip) {
      context.save()
      context.translate(x, y)
      context.scale(-1, 1)
      context.drawImage(image, column * frameWidth, row * frameHeight, frameWidth, frameHeight, -w / 2, -h * anchor, w, h)
      context.restore()
    } else {
      context.drawImage(image, column * frameWidth, row * frameHeight, frameWidth, frameHeight, left, top, w, h)
    }
    if (isTestingActive()) {
      const info = clipInfo ?? inferClip(column, row)
      recordSpriteDraw({
        canvas,
        atlas: ensureAtlasMeta(),
        clip: info.clip,
        frame: info.frame,
        column,
        row,
        flip,
        rect: { x: left, y: top, width: w, height: h },
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        point
      })
    }
  }

  function draw(column: number, row: number, point: Point, options: DrawOptions) {
    drawInternal(column, row, point, options)
  }

  return {
    clips, frameWidth, frameHeight, src,
    frame(column: number, row = 0) {
      if (!Number.isInteger(column) || column < 0 || column >= columns || !Number.isInteger(row) || row < 0 || row >= rows) {
        throw new RangeError('Sprite frame outside atlas')
      }
      const copy = document.createElement('canvas')
      copy.width = frameWidth
      copy.height = frameHeight
      copy.getContext('2d').drawImage(image, column * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight)
      return copy
    },
    begin(stage: HTMLCanvasElement) {
      if (canvas.width !== stage.width) canvas.width = stage.width
      if (canvas.height !== stage.height) canvas.height = stage.height
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = false
      if (isTestingActive()) recordSpriteBegin(canvas)
    },
    draw,
    drawClip(name: string, elapsedMs: number, point: Point, options: DrawOptions & { row?: number }) {
      if (!Object.hasOwn(clips, name)) throw new RangeError('Unknown sprite clip: ' + name)
      const clip = clips[name]
      const row = options.row ?? clip.row ?? 0
      if (!Number.isInteger(row) || row < 0 || row >= rows) throw new RangeError('Sprite row outside atlas')
      const col = spriteColumn(clip, elapsedMs)
      drawInternal(col, row, point, options, { clip: name, frame: col - clip.column })
    },
    marker(point: readonly [number, number], { offset, size, minimumSize = 0, fill }: { offset: number; size: number; minimumSize?: number; fill: string }) {
      const x = (point[0] + 1) * canvas.width / 2
      const y = (1 - point[1]) * canvas.height / 2 - offset * canvas.height
      const radius = Math.max(minimumSize, canvas.height * size)
      context.fillStyle = fill
      context.beginPath()
      context.moveTo(x - radius, y)
      context.lineTo(x + radius, y)
      context.lineTo(x, y + radius)
      context.fill()
    }
  }
}
