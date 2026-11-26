import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'
import { modelFromArtRecipe } from './art-recipe.ts'
import type { ArtReview } from './art-review.ts'
import { sendJson } from './host.ts'
import {
  REVIEW_UUID_RE, checkPin, checkReview, checkSpriteManifest, isRecord, isReviewStatus,
  protocolError, validateReviewComment, validateReviewId
} from './testing-protocol.ts'

export interface ArtReviewHandlerOptions {
  /** Directory (relative to `root` or absolute) for `.art.json`, `overrides.json`, and sprite assets. Defaults to `'art'`. */
  artDir?: string
  /** Directory (relative to `root` or absolute) for saved review threads and PNGs. Defaults to `'reviews'`. */
  reviewsDir?: string
}

const digest = (data: string) => createHash('sha256').update(data).digest('hex')

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return undefined
}

function checkPngBytes(raw: unknown, maxDim: number, label = 'PNG preview'): Buffer {
  const bytes = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.alloc(0)
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.subarray(-8, -4).toString('ascii') !== 'IEND' ||
      ![bytes.readUInt32BE(16), bytes.readUInt32BE(20)].every(size => size > 0 && size <= maxDim)) {
    protocolError(`Expected a ${label} up to ${maxDim} pixels.`)
  }
  return bytes
}

async function payload(req: IncomingMessage): Promise<Record<string, unknown>> {
  const ct = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
  if (ct !== 'application/json') protocolError('Expected JSON.', 415)
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 2_500_000) protocolError('Review is too large.', 413)
    chunks.push(chunk)
  }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.concat(chunks).toString()) } catch { protocolError('Invalid JSON.') }
  if (!isRecord(parsed)) protocolError('Expected a JSON object.')
  return parsed
}

async function regular(path: string) {
  try { if (!(await lstat(path)).isFile()) protocolError('Expected a regular project file.'); return await readFile(path) }
  catch (error) { if (errorCode(error) !== 'ENOENT') throw error }
}

async function atomic(path: string, body: string | Buffer) {
  const temp = path + '.' + randomUUID() + '.tmp'
  try { await writeFile(temp, body, { flag: 'wx' }); await rename(temp, path) }
  finally { await rm(temp, { force: true }) }
}

/** Mount only on the author's loopback testing host. Files remain ordinary project assets for editors and agents. */
export function createArtReviewHandler(root: URL, options: ArtReviewHandlerOptions = {}) {
  const project = resolve(fileURLToPath(root))
  const reviews = options.reviewsDir ? resolve(project, options.reviewsDir) : join(project, 'reviews')
  const art = options.artDir ? resolve(project, options.artDir) : join(project, 'art')
  const artPrefix = relative(project, art).replace(/\\/g, '/')

  function resolveArtPath(rawFile: unknown, extPattern: RegExp, errorMessage: string): string {
    if (typeof rawFile !== 'string' || !rawFile || rawFile.startsWith('/') || /[\\\0]/.test(rawFile) || !extPattern.test(rawFile)) {
      protocolError(errorMessage)
    }
    let rel = rawFile
    if (artPrefix && !artPrefix.startsWith('..') && rel.startsWith(artPrefix + '/')) {
      rel = rel.slice(artPrefix.length + 1)
    } else if (rel.startsWith('art/')) {
      rel = rel.slice(4)
    }
    const parts = rel.split('/')
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..')) protocolError(errorMessage)
    const destination = resolve(art, rel)
    if (!destination.startsWith(art + sep)) protocolError(errorMessage)
    return destination
  }

  async function directory(path: string) {
    await mkdir(path, { recursive: true })
    if (!(await lstat(path)).isDirectory()) protocolError('Expected a project directory.')
  }

  async function note(id: string) {
    validateReviewId(id)
    const raw = await regular(join(reviews, id + '.json'))
    if (!raw) protocolError('Review not found.', 404)
    const source = raw.toString()
    let parsed: unknown
    try { parsed = JSON.parse(source) } catch { protocolError('Invalid review file.') }
    checkReview(parsed, id)
    return { note: parsed, revision: digest(source) }
  }

  let queue = Promise.resolve()
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn)
    queue = run.then(() => {}, () => {})
    return run
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string) {
    if (!path.startsWith('/__testing/')) return false
    const host = req.headers.host
    const port = req.socket.localPort
    const remote = req.socket.remoteAddress
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
    const local = ['127.0.0.1', 'localhost', '[::1]'].some(name => host === name + ':' + port || (port === 80 && host === name))
    if (!loopback || !local || (req.method !== 'GET' && req.headers.origin !== new URL('http://' + host).origin)) {
      protocolError('Use the local testing origin.', 403)
    }
    if (path === '/__testing/recipe' && req.method === 'POST') {
      const { asset, file, base, recipe } = await payload(req)
      if (typeof asset !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(asset) ||
          asset === '__proto__' || asset === 'constructor' || asset === 'prototype') {
        protocolError('Invalid model role.')
      }
      try { modelFromArtRecipe(recipe) } catch (error) { protocolError(error instanceof Error ? error.message : String(error)) }
      const useOverrides = file === null || file === undefined
      const destination = useOverrides
        ? join(art, 'overrides.json')
        : resolveArtPath(file, /\.art\.json$/i, 'Save editable recipes as .art.json files inside the art directory.')
      await serialized(async () => {
        await directory(dirname(destination))
        const raw = await regular(destination)
        let parsedDoc: unknown = {}
        if (raw) {
          try { parsedDoc = JSON.parse(raw.toString()) } catch { protocolError('Existing art file is not valid JSON.') }
        }
        if (useOverrides) {
          if (!isRecord(parsedDoc)) protocolError('Existing art overrides file must be a JSON object.')
          const original = Object.hasOwn(parsedDoc, asset) ? parsedDoc[asset] : null
          if (!isDeepStrictEqual(original, base)) protocolError('The model changed on disk. Reload before editing it.', 409)
          const nextDoc = Object.assign(Object.create(null), parsedDoc, { [asset]: recipe })
          await atomic(destination, JSON.stringify(nextDoc, null, 2) + '\n')
        } else {
          const original = raw ? parsedDoc : null
          if (!isDeepStrictEqual(original, base)) protocolError('The model changed on disk. Reload before editing it.', 409)
          await atomic(destination, JSON.stringify(recipe, null, 2) + '\n')
        }
      })
      sendJson(res, { saved: true, file: relative(project, destination).replace(/\\/g, '/') })
      return true
    }
    if (path === '/__testing/sprite' && req.method === 'POST') {
      const { name, file, png, manifest } = await payload(req)
      if (png === undefined && manifest === undefined) protocolError('Provide a PNG image, a sprite manifest, or both.')
      let stem: string
      if (file !== undefined && file !== null) {
        const resolvedFile = resolveArtPath(file, /\.(?:png|json)$/i, 'Save sprite assets as .png or .json files inside the art directory.')
        if (/\.art\.json$/i.test(resolvedFile) || resolvedFile === join(art, 'overrides.json')) {
          protocolError('Sprite endpoint cannot overwrite recipe or overrides files.')
        }
        stem = resolvedFile.replace(/\.(?:png|json)$/i, '')
      } else if (typeof name === 'string' && /^[a-z0-9][a-z0-9 _-]*$/i.test(name)) {
        stem = resolve(art, name)
        if (!stem.startsWith(art + sep) || stem === join(art, 'overrides') || /\.art$/i.test(stem)) {
          protocolError('Invalid sprite name.')
        }
      } else {
        protocolError('Provide a valid sprite name or art file path.')
      }
      const pngBytes = png !== undefined ? checkPngBytes(png, 4096, 'sprite PNG') : undefined
      if (manifest !== undefined) checkSpriteManifest(manifest)
      const savedFiles = await serialized(async () => {
        const folder = dirname(stem)
        await directory(folder)
        const written: string[] = []
        if (pngBytes) {
          const pngName = isRecord(manifest) && typeof manifest.src === 'string' ? manifest.src : undefined
          const pngPath = pngName ? resolve(folder, pngName) : stem + '.png'
          if (!pngPath.startsWith(art + sep)) protocolError('Invalid sprite PNG target.')
          await atomic(pngPath, pngBytes)
          written.push(relative(project, pngPath).replace(/\\/g, '/'))
        }
        if (manifest !== undefined) {
          const jsonPath = stem + '.json'
          await atomic(jsonPath, JSON.stringify(manifest, null, 2) + '\n')
          written.push(relative(project, jsonPath).replace(/\\/g, '/'))
        }
        return written
      })
      sendJson(res, { saved: true, files: savedFiles })
      return true
    }
    if (path === '/__testing/reviews' && req.method === 'GET') {
      await directory(reviews)
      const files = (await readdir(reviews)).filter(file => file.endsWith('.json') && REVIEW_UUID_RE.test(file.slice(0, -5)))
      const entries: Awaited<ReturnType<typeof note>>[] = []
      const errors: string[] = []
      await Promise.all(files.map(async file => {
        try { entries.push(await note(file.slice(0, -5))) } catch { errors.push(file) }
      }))
      sendJson(res, { entries: entries.sort((a, b) => b.note.created.localeCompare(a.note.created)), errors })
    } else if (path === '/__testing/reviews' && req.method === 'POST') {
      await directory(reviews)
      const { id, target, scene, comment, png } = await payload(req)
      const reviewId = validateReviewId(id)
      checkPin(target)
      const text = validateReviewComment(comment)
      const bytes = checkPngBytes(png, 1024)
      const result = await serialized(async () => {
        if (await regular(join(reviews, reviewId + '.json'))) {
          const saved = (await note(reviewId)).note
          if (saved.comment !== text || !isDeepStrictEqual(saved.target, target) || !isDeepStrictEqual(saved.scene, scene)) {
            protocolError('This review ID already belongs to a different comment.', 409)
          }
        } else {
          const value: ArtReview = {
            version: 1, id: reviewId, created: new Date().toISOString(), status: 'open', comment: text,
            target, scene, before: reviewId + '.png', replies: []
          }
          const before = join(reviews, value.before)
          await atomic(before, bytes)
          try { await atomic(join(reviews, reviewId + '.json'), JSON.stringify(value, null, 2) + '\n') }
          catch (error) { await rm(before, { force: true }); throw error }
        }
        return note(reviewId)
      })
      sendJson(res, result)
    } else {
      const match = /^\/__testing\/reviews\/([0-9a-f-]+)(\/before\.png)?$/.exec(path)
      if (!match || !REVIEW_UUID_RE.test(match[1])) protocolError('Unknown testing endpoint.', 404)
      await directory(reviews)
      if (req.method === 'GET' && match[2]) {
        await note(match[1])
        const bytes = await regular(join(reviews, match[1] + '.png'))
        if (!bytes) protocolError('The before image is missing.', 404)
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(bytes)
      } else if (req.method === 'PATCH' && !match[2]) {
        const { revision, status, reply } = await payload(req)
        const updated = await serialized(async () => {
          const entry = await note(match[1])
          if (entry.revision !== revision) protocolError('The review changed on disk. Refresh the reviews and try again.', 409)
          if (!isReviewStatus(status)) protocolError('Invalid review status.')
          entry.note.status = status
          if (reply) entry.note.replies.push({ text: validateReviewComment(reply), date: new Date().toISOString() })
          await atomic(join(reviews, match[1] + '.json'), JSON.stringify(entry.note, null, 2) + '\n')
          return note(match[1])
        })
        sendJson(res, updated)
      } else if (req.method === 'DELETE' && !match[2]) {
        await serialized(async () => {
          const jsonPath = join(reviews, match[1] + '.json')
          if (!(await regular(jsonPath))) protocolError('Review not found.', 404)
          await rm(jsonPath, { force: true })
          await rm(join(reviews, match[1] + '.png'), { force: true })
        })
        sendJson(res, { deleted: true, id: match[1] })
      } else protocolError('Unsupported review operation.', 405)
    }
    return true
  }

  return async (req: IncomingMessage, res: ServerResponse, path: string) => {
    if (!path.startsWith('/__testing/')) return false
    try { return await handle(req, res, path) } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined
      const message = error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : undefined
      res.writeHead(status ?? 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ error: status ? message : 'Could not read or write the project review files.' }))
      return true
    }
  }
}
