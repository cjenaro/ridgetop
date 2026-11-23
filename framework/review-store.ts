import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'
import { modelFromArtRecipe } from './art-recipe.ts'
import type { ArtPin, ArtReview, ReviewStatus } from './art-review.ts'
import { sendJson } from './host.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const states: ReviewStatus[] = ['open', 'ready', 'resolved']
const digest = (data: string) => createHash('sha256').update(data).digest('hex')
function bad(message: string, status = 400): never { throw Object.assign(new Error(message), { status }) }
function words(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8_000) bad('Enter between 1 and 8,000 characters.')
  return value.trim()
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function checkPin(pin: ArtPin) {
  const v = pin?.view
  if (!isRecord(pin) || !isRecord(v) || !['model', 'sprite', 'hud'].includes(v.surface as string) || !['asset', 'instance', 'sprite', 'hud'].includes(pin.scope as string) ||
      (pin.scope === 'hud' && v.surface !== 'hud') || (pin.scope === 'sprite' && v.surface === 'model') ||
      ![v.asset, v.instance, v.source].every(s => typeof s === 'string' && s.length && s.length <= 1024) ||
      ![v.span, v.width, v.height].every(n => typeof n === 'number' && Number.isFinite(n) && n > 0) ||
      ![v.centerY, v.yaw, v.elevation].every(n => typeof n === 'number' && Number.isFinite(n)) ||
      Math.abs(v.elevation as number) >= Math.PI / 2 ||
      (pin.part !== undefined && (typeof pin.part !== 'string' || pin.part.length > 256)) ||
      (pin.editSource !== undefined && (typeof pin.editSource !== 'string' || pin.editSource.length > 1024)) ||
      (v.sheet !== undefined && (typeof v.sheet !== 'string' || v.sheet.length > 1024)) ||
      (v.handDrawn !== undefined && typeof v.handDrawn !== 'boolean') ||
      !Array.isArray(v.position) || v.position.length !== 3 || !v.position.every(n => typeof n === 'number' && Number.isFinite(n)) ||
      !Array.isArray(pin.region) || pin.region.length !== 4 || !pin.region.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) ||
      pin.region[0] > pin.region[2] || pin.region[1] > pin.region[3] ||
      (v.surface !== 'model' && (typeof v.clip !== 'string' || !v.clip || v.clip.length > 256 ||
        ![v.frame, v.column, v.row].every(n => Number.isSafeInteger(n) && (n as number) >= 0)))) bad('Invalid art review target.')
}
async function payload(req: IncomingMessage): Promise<Record<string, any>> {
  const ct = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
  if (ct !== 'application/json') bad('Expected JSON.', 415)
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 2_500_000) bad('Review is too large.', 413)
    chunks.push(chunk)
  }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.concat(chunks).toString()) } catch { bad('Invalid JSON.') }
  if (!isRecord(parsed)) bad('Expected a JSON object.')
  return parsed
}
async function regular(path: string) {
  try { if (!(await lstat(path)).isFile()) bad('Expected a regular project file.'); return await readFile(path) }
  catch (error) { if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw error }
}
async function atomic(path: string, body: string | Buffer) {
  const temp = path + '.' + randomUUID() + '.tmp'
  try { await writeFile(temp, body, { flag: 'wx' }); await rename(temp, path) }
  finally { await rm(temp, { force: true }) }
}

/** Mount only on the author's loopback testing host. Files remain ordinary project assets for editors and agents. */
export function createArtReviewHandler(root: URL) {
  const project = fileURLToPath(root), reviews = join(project, 'reviews'), art = join(project, 'art')
  async function directory(path: string) {
    await mkdir(path, { recursive: true })
    if (!(await lstat(path)).isDirectory()) bad('Expected a project directory.')
  }
  async function note(id: string) {
    if (!uuid.test(id)) bad('Invalid review ID.')
    const raw = await regular(join(reviews, id + '.json'))
    if (!raw) bad('Review not found.', 404)
    const source = raw.toString()
    let parsed: unknown
    try { parsed = JSON.parse(source) } catch { bad('Invalid review file.') }
    if (!isRecord(parsed)) bad('Invalid review file.')
    const value = parsed as unknown as ArtReview
    if (value.version !== 1 || value.id !== id || !states.includes(value.status) || typeof value.created !== 'string' ||
        typeof value.comment !== 'string' || !Array.isArray(value.replies) || value.replies.some(r => typeof r?.text !== 'string')) bad('Invalid review file.')
    checkPin(value.target)
    return { note: value, revision: digest(source) }
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
    if (!loopback || !local || (req.method !== 'GET' && req.headers.origin !== new URL('http://' + host).origin)) bad('Use the local testing origin.', 403)
    if (path === '/__testing/recipe' && req.method === 'POST') {
      const { asset, file, base, recipe } = await payload(req)
      if (typeof asset !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(asset)) bad('Invalid model role.')
      try { modelFromArtRecipe(recipe) } catch (error) { bad(error.message) }
      if (file !== null && (typeof file !== 'string' || !/^art\/[^/\\\0]+\.art\.json$/i.test(file))) bad('Save editable recipes directly in game/art/.')
      await serialized(async () => {
        await directory(art)
        const destination = join(art, file ? file.slice(4) : 'overrides.json')
        const raw = await regular(destination)
        let parsedDoc: unknown = {}
        if (raw) {
          try { parsedDoc = JSON.parse(raw.toString()) } catch { bad('Existing art file is not valid JSON.') }
        }
        if (!file && !isRecord(parsedDoc)) bad('Existing art overrides file must be a JSON object.')
        const document = parsedDoc as Record<string, unknown>
        const original = file ? (raw ? parsedDoc : null) : (Object.hasOwn(document, asset) ? document[asset] : null)
        if (!isDeepStrictEqual(original, base)) bad('The model changed on disk. Reload before editing it.', 409)
        await atomic(destination, JSON.stringify(file ? recipe : { ...document, [asset]: recipe }, null, 2) + '\n')
      })
      sendJson(res, { saved: true })
      return true
    }
    await directory(reviews)
    if (path === '/__testing/reviews' && req.method === 'GET') {
      const files = (await readdir(reviews)).filter(file => file.endsWith('.json') && uuid.test(file.slice(0, -5)))
      const entries: Awaited<ReturnType<typeof note>>[] = []
      const errors: string[] = []
      await Promise.all(files.map(async file => {
        try { entries.push(await note(file.slice(0, -5))) } catch { errors.push(file) }
      }))
      sendJson(res, { entries: entries.sort((a, b) => b.note.created.localeCompare(a.note.created)), errors })
    } else if (path === '/__testing/reviews' && req.method === 'POST') {
      const { id, target, scene, comment, png } = await payload(req)
      if (typeof id !== 'string' || !uuid.test(id)) bad('Invalid review ID.')
      checkPin(target)
      const text = words(comment)
      const bytes = typeof png === 'string' ? Buffer.from(png, 'base64') : Buffer.alloc(0)
      if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
          bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.subarray(-8, -4).toString('ascii') !== 'IEND' ||
          ![bytes.readUInt32BE(16), bytes.readUInt32BE(20)].every(size => size > 0 && size <= 1024)) bad('Expected a PNG preview up to 1024 pixels.')
      const result = await serialized(async () => {
        if (await regular(join(reviews, id + '.json'))) {
          const saved = (await note(id)).note
          if (saved.comment !== text || !isDeepStrictEqual(saved.target, target) || !isDeepStrictEqual(saved.scene, scene)) bad('This review ID already belongs to a different comment.', 409)
        } else {
          const value: ArtReview = { version: 1, id, created: new Date().toISOString(), status: 'open', comment: text,
            target, scene, before: id + '.png', replies: [] }
          const before = join(reviews, value.before)
          await atomic(before, bytes)
          try { await atomic(join(reviews, id + '.json'), JSON.stringify(value, null, 2) + '\n') }
          catch (error) { await rm(before, { force: true }); throw error }
        }
        return note(id)
      })
      sendJson(res, result)
    } else {
      const match = /^\/__testing\/reviews\/([0-9a-f-]+)(\/before\.png)?$/.exec(path)
      if (!match || !uuid.test(match[1])) bad('Unknown testing endpoint.', 404)
      if (req.method === 'GET' && match[2]) {
        await note(match[1])
        const bytes = await regular(join(reviews, match[1] + '.png'))
        if (!bytes) bad('The before image is missing.', 404)
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(bytes)
      } else if (req.method === 'PATCH' && !match[2]) {
        const { revision, status, reply } = await payload(req)
        const updated = await serialized(async () => {
          const entry = await note(match[1])
          if (entry.revision !== revision) bad('The review changed on disk. Refresh the reviews and try again.', 409)
          if (!states.includes(status)) bad('Invalid review status.')
          entry.note.status = status
          if (reply) entry.note.replies.push({ text: words(reply), date: new Date().toISOString() })
          await atomic(join(reviews, match[1] + '.json'), JSON.stringify(entry.note, null, 2) + '\n')
          return note(match[1])
        })
        sendJson(res, updated)
      } else bad('Unsupported review operation.', 405)
    }
    return true
  }
  return async (req: IncomingMessage, res: ServerResponse, path: string) => {
    if (!path.startsWith('/__testing/')) return false
    try { return await handle(req, res, path) } catch (error) {
      const err = error as { status?: number; message?: string } | undefined
      res.writeHead(err?.status ?? 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ error: err?.status ? err.message : 'Could not read or write the project review files.' }))
      return true
    }
  }
}
