import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'

const runtimes = {
  node: [process.execPath],
  bun: [process.env.RIDGETOP_BUN ?? 'bun'],
  deno: [process.env.RIDGETOP_DENO ?? 'deno', 'run', '--allow-read', '--allow-write', '--allow-net', '--allow-env']
}
type RuntimeName = keyof typeof runtimes
const names = process.argv.slice(2)
for (const name of names.length ? names : Object.keys(runtimes)) {
  if (!Object.hasOwn(runtimes, name)) throw new Error('Unknown runtime: ' + name)
  const [command, ...args] = runtimes[name as RuntimeName]
  const temporary = await mkdtemp(join(tmpdir(), 'ridgetop-runtime-'))
  const save = join(temporary, 'characters.json')
  const server = spawn(command, [...args, 'dist/server.js'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', RIDGETOP_CHARACTER_SAVE: save },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const closed = once(server, 'close')
  // A missing binary is reported by the readiness check.
  closed.catch(() => {})
  const lifetime = new AbortController()
  let log = ''
  function record(chunk: Buffer) { log += chunk.toString() }
  server.stderr.on('data', record)
  try {
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(name + ' startup timed out\n' + log)), 8_000)
      server.once('error', reject)
      server.once('close', code => { clearTimeout(timer); reject(new Error(name + ' exited ' + code + '\n' + log)) })
      server.stdout.on('data', chunk => {
        record(chunk)
        const ready = /listening on port (\d+)/.exec(log)?.[1]
        if (ready) { clearTimeout(timer); resolve(ready) }
      })
    })
    const base = 'http://127.0.0.1:' + port
    const request = (path: string, options: RequestInit = {}) => fetch(base + path, {
      ...options, signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(4_000)])
    })
    assert.equal(await (await request('/healthz')).text(), 'ok')
    assert.match(await (await request('/')).text(), /Beacon Run/)
    assert.match(await (await request('/racing')).text(), /Signal Drift/)
    assert.match(await (await request('/sprites')).text(), /Sprite workshop/)
    assert.match(await (await request('/models')).text(), /Low-poly models/)
    assert.match(await (await request('/models/main.js')).text(), /createLowPolyRenderer/)
    assert.match(await (await request('/models/headland.js')).text(), /export function createHeadland/)
    assert.match(await (await request('/starter')).text(), /Ridgetop game starter/)
    assert.match(await (await request('/starter/game.js')).text(), /Lantern Grove/)
    assert.equal((await (await request('/starter/art/rain-ranger.art.json')).json()).name, 'rain-ranger')
    assert.match(await (await request('/framework/art.js')).text(), /export function createArtKit/)
    assert.match(await (await request('/framework/art-recipe.js')).text(), /export function modelFromArtRecipe/)
    assert.match(await (await request('/sprite-model-editor.js')).text(), /export function createPartEditor/)
    const atlas = await request('/game/assets/sprites.json')
    assert.match(atlas.headers.get('content-type') ?? '', /application\/json/)
    assert.equal((await atlas.json()).clips.run.frames, 4)
    assert.equal((await request('/framework/sprite-sheet.js')).status, 200)
    assert.match(await (await request('/racing/main.js')).text(), /createLowPolyRenderer/)
    assert.match(await (await request('/racing/progression.js')).text(), /export function buyUpgrade/)
    assert.match(await (await request('/racing/garage.js')).text(), /export function createGarageState/)
    assert.match(await (await request('/framework/ui-canvas.js')).text(), /export function createCanvasUi/)
    assert.match(await (await request('/framework/ui-layout.js')).text(), /export function resolveLayout/)
    assert.match(await (await request('/racing/garage-art.js')).text(), /export function createGarageBay/)
    assert.match(await (await request('/racing/car-art.js')).text(), /export function createCarModels/)
    assert.match(await (await request('/game-ui.css')).text(), /\.game-viewport/)
    assert.match(await (await request('/framework/hud.js')).text(), /export function createHud/)
    assert.equal((await request('/framework/server.js')).status, 404)
    const profile = await request('/expeditions/character', { method: 'POST' })
    assert.equal(profile.status, 200)
    const setCookie = profile.headers.get('set-cookie')
    assert.ok(setCookie)
    const cookie = setCookie.split(';')[0]
    assert.match(await profile.text(), /"xp":0/)
    assert.match(await readFile(save, 'utf8'), /"cleared":\[\]/)
    const zone = '/expeditions/ridge/runtime-smoke'
    const stream = await request(zone + '/events', { headers: { Cookie: cookie } })
    assert.equal(stream.status, 200)
    let received = ''
    const decoder = new TextDecoder()
    assert.ok(stream.body)
    const reader = stream.body.getReader()
    let token: string | undefined
    while (!token) {
      const { value, done } = await reader.read()
      assert.equal(done, false)
      received += decoder.decode(value, { stream: true })
      token = /"token":"([a-f0-9-]+)"/.exec(received)?.[1]
    }
    const accept = await request(zone + '/input', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token },
      body: JSON.stringify({ left: false, right: true, jump: 0, restart: 0 })
    })
    assert.equal(accept.status, 204)
    while (!received.includes('"moving":true')) {
      const { value, done } = await reader.read()
      assert.equal(done, false)
      received += decoder.decode(value, { stream: true })
    }
    await reader.cancel()
    console.log(name + ' passed static game assets, character persistence, SSE and authoritative input')
  } finally {
    lifetime.abort()
    server.kill('SIGTERM')
    const shutdown = setTimeout(() => server.kill('SIGKILL'), 4000)
    try { await closed } finally { clearTimeout(shutdown); await rm(temporary, { recursive: true }) }
  }
}
