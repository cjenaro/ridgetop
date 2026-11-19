import type { AddressInfo } from 'node:net'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openCharacterStore } from '../game/character-store.ts'
import { canEnterRegion, characterView } from '../game/expedition.ts'
import { createGameServer } from '../server.ts'

test('expedition characters persist, progression gates zones and duplicate rewards are idempotent', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ridgetop-characters-'))
  const file = join(folder, 'characters.json')
  const store = await openCharacterStore(file)
  const id = store.create()
  assert.equal(canEnterRegion(store.get(id).cleared, 'ruins'), false)
  assert.equal(store.award(id, 'foundry', { finished: true, signal: true }), false)
  assert.equal(store.award(id, 'ridge', { finished: false, signal: true }), false)
  assert.equal(store.award(id, 'ridge', { finished: true, signal: true }), true)
  assert.equal(store.awardGuild('ridge', [id, id]), false)
  assert.equal(characterView(store.get(id)).xp, 125)
  const teammate = store.create()
  assert.equal(store.awardGuild('ridge', [id, teammate]), false)
  assert.equal(store.award(teammate, 'ridge', { finished: true }), true)
  assert.equal(store.awardGuild('ridge', [id, teammate]), true)
  assert.equal(store.awardGuild('ridge', [id, teammate]), false)
  assert.equal(characterView(store.get(teammate)).xp, 160)
  assert.equal(canEnterRegion(store.get(id).cleared, 'ruins'), true)
  await store.save()
  const loaded = await openCharacterStore(file)
  assert.deepEqual(characterView(loaded.get(id)), {
    name: store.get(id).name, cleared: ['ridge'], chips: ['ridge'], guild: ['ridge'], xp: 185, level: 2
  })
})

test('expedition endpoint grants stable anonymous characters and isolates the public world from races', async t => {
  const app = createGameServer()
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  t.after(() => app.close())
  const base = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port
  const endpoint = base + '/expeditions/character'
  const create = await fetch(endpoint, { method: 'POST' })
  assert.equal(create.status, 200)
  const cookie = create.headers.get('set-cookie').split(';')[0]
  const profile = await create.json()
  const known = await fetch(endpoint, { method: 'POST', headers: { Cookie: cookie } })
  assert.deepEqual(await known.json(), profile)
  assert.equal(known.headers.has('set-cookie'), false)
  const other = await fetch(endpoint, { method: 'POST' })
  assert.notEqual((await other.json()).name, profile.name)
  assert.equal((await fetch(base + '/expeditions/ruins/wayfarers/events', { headers: { Cookie: cookie } })).status, 403)
  assert.equal((await fetch(base + '/expeditions/ridge/wayfarers/events')).status, 401)
  const abort = new AbortController()
  t.after(() => abort.abort())
  const race = await fetch(base + '/rooms/ridge/wayfarers/events', { signal: abort.signal })
  const expedition = await fetch(base + '/expeditions/ridge/wayfarers/events', {
    signal: abort.signal, headers: { Cookie: cookie }
  })
  assert.equal(race.status, 200)
  assert.equal(expedition.status, 200)
  async function snapshot(stream) {
    let text = ''
    const reader = stream.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const next = await reader.read()
      if (next.done) throw new Error('Stream ended before a player snapshot')
      text += decoder.decode(next.value, { stream: true })
      const event = /^data: (\{"tick":[^\n]+)\n/m.exec(text)
      if (event) return JSON.parse(event[1])
    }
  }
  const local = await snapshot(expedition)
  assert.equal(local.players.length, 1)
  assert.deepEqual(local.players[0].character, profile)
  assert.equal((await snapshot(race)).players[0].character, undefined)
})
