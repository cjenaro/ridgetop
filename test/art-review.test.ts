import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { createArtRecipe } from '../framework/art.ts'
import { createGameHost } from '../framework/host.ts'
import { createArtReviewHandler } from '../framework/review-store.ts'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDLsAAAAASUVORK5CYII='
const target = { scope: 'sprite', region: [.1, .2, .4, .5], view: { surface: 'sprite', asset: 'ranger', instance: 'player',
  source: 'art/scout.json', sheet: 'art/scout.png', position: [1, 0, 2], width: 32, height: 48, yaw: 0,
  elevation: Math.PI / 6, span: 1.8, centerY: .6, frame: 1, column: 3, row: 0, clip: 'run', handDrawn: true } }

async function host(folder: string, testing = true) {
  const root = pathToFileURL(folder + '/')
  const app = createGameHost({ root, files: [], handle: testing ? createArtReviewHandler(root) : undefined })
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve))
  const address = app.server.address()
  assert.ok(address && typeof address === 'object')
  const origin = 'http://127.0.0.1:' + address.port
  const request = (path: string, method = 'GET', data?: unknown) => fetch(origin + '/__testing/' + path, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: data && JSON.stringify(data)
  })
  return { close: app.close, request }
}

test('art reviews survive a host restart, preserve the before image and detect an intervening agent reply', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-review-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const first = await host(folder)
  t.after(first.close)
  const id = randomUUID(), scene = { player: [1, 0, 2], time: 160 }
  const data = { id, comment: 'Keep the outline readable in this frame.', png, target, scene }
  const initial = await (await first.request('reviews', 'POST', data)).json()
  assert.equal(initial.note.status, 'open')
  assert.equal((await (await first.request('reviews', 'POST', data)).json()).revision, initial.revision)
  assert.equal((await first.request('reviews', 'POST', { ...data, comment: 'Different target' })).status, 409)
  await first.close()

  const next = await host(folder)
  t.after(next.close)
  const path = join(folder, 'reviews', id + '.json')
  const note = JSON.parse(await readFile(path, 'utf8'))
  assert.deepEqual(note.target, target)
  assert.deepEqual(note.scene, scene)
  assert.equal(note.before, id + '.png')
  assert.deepEqual(Buffer.from(await (await next.request('reviews/' + id + '/before.png')).arrayBuffer()), Buffer.from(png, 'base64'))
  note.status = 'ready'
  note.replies.push({ text: 'Added a brighter edge to the run frame.', date: new Date().toISOString() })
  await writeFile(path, JSON.stringify(note))
  const change = { status: 'resolved', reply: 'Looks good in motion.' }
  assert.equal((await next.request('reviews/' + id, 'PATCH', { ...change, revision: initial.revision })).status, 409)
  const { entries, errors } = await (await next.request('reviews')).json()
  assert.deepEqual(errors, [])
  assert.deepEqual(entries.map(e => e.note), [note])
  const resolved = await (await next.request('reviews/' + id, 'PATCH', { ...change, revision: entries[0].revision })).json()
  assert.equal(resolved.note.status, 'resolved')
  assert.equal(resolved.note.replies.length, 2)
  const opened = await (await next.request('reviews/' + id, 'PATCH', { revision: resolved.revision, status: 'open' })).json()
  assert.equal(opened.note.status, 'open')
  assert.deepEqual(opened.note.target, target)
  assert.deepEqual(await readFile(join(folder, 'reviews', id + '.png')), Buffer.from(png, 'base64'))
  const normal = await host(folder, false)
  t.after(normal.close)
  assert.equal((await normal.request('reviews')).status, 404)
  assert.equal((await normal.request('recipe', 'POST', {})).status, 405)
})

test('part edits preserve other roles and reject an outdated or invalid recipe without changing the file', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-edit-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const app = await host(folder)
  t.after(app.close)
  await mkdir(join(folder, 'art'))
  const ranger = createArtRecipe('ranger'), crate = createArtRecipe('crate')
  const first = { asset: 'ranger', file: null, base: null, recipe: ranger }
  const second = { asset: 'crate', file: null, base: null, recipe: crate }
  const saved = await Promise.all([first, second].map(edit => app.request('recipe', 'POST', edit)))
  assert.deepEqual(saved.map(r => r.status), [200, 200])
  const file = join(folder, 'art', 'overrides.json')
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ranger, crate })
  assert.equal((await app.request('recipe', 'POST', first)).status, 409)

  const bound = 'art/Rain Ranger.art.json', edited = structuredClone(ranger)
  edited.parts[0].position = [.2, .3, .4]
  await writeFile(join(folder, bound), JSON.stringify(ranger))
  const change = { ...first, file: bound, base: ranger, recipe: edited }
  assert.equal((await app.request('recipe', 'POST', change)).status, 200)
  assert.equal((await app.request('recipe', 'POST', change)).status, 409)
  const broken = { ...edited, parts: [] }
  assert.equal((await app.request('recipe', 'POST', { ...change, base: edited, recipe: broken })).status, 400)
  assert.deepEqual(JSON.parse(await readFile(join(folder, bound), 'utf8')), edited)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { ranger, crate })
})
