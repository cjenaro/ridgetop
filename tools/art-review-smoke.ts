import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { click, key, openTab, status, until } from './browser-driver.ts'
import { createGame } from '../packages/ridgetop/tools/create-game.ts'
import { createArtRecipe, multiply, orthographic, projectPoint, view } from 'ridgetop'

type Tab = Awaited<ReturnType<typeof openTab>>
const backend = process.env.RIDGETOP_REVIEW_RENDERER ?? 'canvas'
const temp = await mkdtemp(join(tmpdir(), 'ridgetop-playtest-'))
let server: ReturnType<typeof spawn>, tab: Tab

function change(selector: string, value: string) {
  return tab.evaluate(`{const f=document.querySelector(${JSON.stringify(selector)}); f.value=${JSON.stringify(value)}; f.dispatchEvent(new Event('change'))}`)
}
const value = (id: string) => tab.evaluate(`document.getElementById('${id}')?.value`)
const viewMode = () => tab.evaluate("window.__ridgetopUi?.state?.()?.view")
const footerText = () => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-footer-msg')?.textContent?.trim()")
const clickButtonByText = (text: string) => tab.evaluate(`(() => {
  const btn = [...document.querySelectorAll('#ridgetop-testing-drawer button')].find(b => b.textContent?.trim() === ${JSON.stringify(text)})
  if (!btn) throw new Error('Missing button: ' + ${JSON.stringify(text)})
  btn.click()
})()`)
async function point(selector: string, u: number, v: number) {
  return tab.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect(); return { x:r.x+r.width*${u}, y:r.y+r.height*${v} } })()`)
}
async function press(selector: string, u: number, v: number, end?: [number, number]) {
  const start = await point(selector, u, v)
  const at = end ? await point(selector, ...end) : start
  await tab.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 })
  if (end) await tab.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, buttons: 1 })
  await tab.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: 1 })
}
async function saveComment(text: string) {
  await clickButtonByText('Comments / Reviews')
  await until(() => tab.evaluate("Boolean(document.getElementById('rt-review-comment'))"), true, 'review form mounted')
  await tab.evaluate(`{const f=document.getElementById('rt-review-comment'); f.value=${JSON.stringify(text)}; f.dispatchEvent(new Event('input'))}`)
  await clickButtonByText('Save Comment')
  await until(footerText, s => typeof s === 'string' && s.startsWith('Saved reviews/'), 'saved project review')
  return value('rt-review-select')
}

try {
  const project = await createGame(join(temp, 'demo'))
  const game = join(project, 'game'), bindings = join(game, 'game.js')
  const source = await readFile(bindings, 'utf8')
  assert.ok(source.includes('export const sprites = {};'))
  await writeFile(bindings, source.replace('export const sprites = {};', "export const sprites = { ranger: { manifest: 'art/sprites.json', clip: 'run' } };")
    .replace('export const modelFiles = {};', "export const modelFiles = { crystal: './art/Moon%20Crystal.art.json' };"))
  await writeFile(join(game, 'art/Moon Crystal.art.json'), JSON.stringify(createArtRecipe('crystal')))
  for (const name of ['sprites.json', 'sprites.png']) await copyFile(new URL('../game/assets/' + name, import.meta.url), join(game, 'art', name))

  server = spawn(process.execPath, ['game/serve.js', '--testing'], { cwd: project, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] })
  let origin: string
  for await (const line of createInterface({ input: server.stdout })) {
    const port = /listening on port (\d+)/.exec(line)?.[1]
    if (port) { origin = 'http://127.0.0.1:' + port; break }
  }
  assert.ok(origin, 'testing host started')
  const url = origin + '/?testing=1&renderer=' + backend
  tab = await openTab(url)
  await until(() => status(tab, 'rt-pause-btn'), 'Pause & Inspect (F9)', 'loaded framework testing studio')
  await click(tab, 'rt-pause-btn')
  assert.equal(await viewMode(), '3d')

  const aspect = await tab.evaluate("document.querySelector('#world').width / document.querySelector('#world').height")
  const span = Math.max(6.9, 10.65 / aspect)
  const camera = multiply(orthographic(span * aspect, span, .1, 52), view([4, 13.5, 3 + 26 * Math.cos(Math.PI / 6)], [4, .5, 3]))
  const visor = projectPoint(camera, 1.07, 1.06, 1.32)
  await press('#world', (visor[0] + 1) / 2, (1 - visor[1]) / 2)
  await until(() => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-title')?.textContent"), t => typeof t === 'string' && t.includes('ranger'), 'picked ranger through the playfield')

  // Verify keyboard input is ignored while paused
  await key(tab, 'keyDown', 'ArrowRight', 'ArrowRight')
  await key(tab, 'keyUp', 'ArrowRight', 'ArrowRight')
  const id = await saveComment('Make this visor wider so it reads at game size.')
  const file = join(game, 'reviews', id + '.json')
  const disk = async () => JSON.parse(await readFile(file, 'utf8'))
  const original = await disk()
  assert.equal(original.target.view.surface, 'model')
  assert.equal(original.target.view.asset, 'ranger')
  assert.deepEqual(original.scene.player, [1, 1, 0])
  assert.match(original.target.view.source, /overrides\.json#ranger$/)
  const beforeFile = join(game, 'reviews', original.before)
  const png = await readFile(beforeFile)

  // Edit part scale in Editor tab and save recipe to disk
  await clickButtonByText('Editor')
  const scaleX = await tab.evaluate(`(() => {
    const label = [...document.querySelectorAll('#ridgetop-testing-drawer label')].find(l => l.textContent?.includes('Scale X'))
    const input = label?.querySelector('input')
    if (!input) throw new Error('Missing Scale X input')
    const next = Number(input.value) + 0.25
    input.value = String(next)
    input.dispatchEvent(new Event('change'))
    return next
  })()`)
  await clickButtonByText('Save Recipe')
  await until(footerText, s => typeof s === 'string' && s.includes('Saved art/overrides.json'), 'saved recipe edit to overrides.json')
  const saved = JSON.parse(await readFile(join(game, 'art/overrides.json'), 'utf8')).ranger
  assert.ok(saved.parts.some((p: { scale: number[] }) => Math.abs(p.scale[0] - scaleX) < 1e-3))

  // Simulate an external agent marking the review ready on disk, then Reload & Compare
  const ready = await disk()
  ready.status = 'ready'
  ready.replies.push({ text: 'Widened the visor. Check it at game size.', date: new Date().toISOString() })
  await writeFile(file, JSON.stringify(ready, null, 2))
  await click(tab, 'rt-refresh-btn')
  await clickButtonByText('Comments / Reviews')
  await until(() => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-section-title')?.textContent"), 'Review · ready', 'read the agent reply from disk')
  const savedLoad = await tab.evaluate('performance.timeOrigin')
  await clickButtonByText('Reload & Compare')
  await until(() => tab.evaluate('performance.timeOrigin'), time => time > savedLoad, 'reloaded latest project source')
  await until(() => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-section-title')?.textContent"), 'Review · ready', 'restored the reviewed scene')
  assert.deepEqual(await readFile(beforeFile), png)
  await tab.evaluate(`{const f=document.getElementById('rt-review-comment'); f.value='I can read it now.'; f.dispatchEvent(new Event('input'))}`)
  await clickButtonByText('Resolve')
  await until(() => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-section-title')?.textContent"), 'Review · resolved', 'creator resolved with a reply')
  assert.equal((await disk()).replies.length, 2)

  // Resume, switch to 2D sprites, pause, pick 2D sprite & HUD icon
  await click(tab, 'rt-pause-btn')
  await tab.evaluate("window.__ridgetopUi.act('hud-view-toggle', 'toggle')")
  await until(() => tab.evaluate("document.getElementById('sprites').hidden"), false, 'switched to 2D')
  await click(tab, 'rt-pause-btn')
  const center = projectPoint(camera, 1, .68, 1)
  await press('#sprites', (center[0] + 1) / 2, (1 - center[1]) / 2)
  await until(() => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-badge')?.textContent"), '2D Sprite', 'picked 2D sprite')
  const spriteId = await saveComment('Brighten this section of the running sprite.')
  const sprite = JSON.parse(await readFile(join(game, 'reviews', spriteId + '.json'), 'utf8'))
  assert.equal(sprite.target.view.surface, 'sprite')
  assert.equal(sprite.target.view.clip, 'run')

  // Pick Canvas UI pickup-icon HUD region
  const iconCenter = await tab.evaluate(`(() => {
    const board = document.querySelector('.board')
    board.scrollIntoView({ block: 'center' })
    const b = board.getBoundingClientRect()
    const r = window.__ridgetopUi.rects()['pickup-icon']
    return { x: b.x + r.x + r.width / 2, y: b.y + r.y + r.height / 2 }
  })()`)
  await tab.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...iconCenter, button: 'left', buttons: 1, clickCount: 1 })
  await tab.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...iconCenter, button: 'left', clickCount: 1 })
  await until(() => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-badge')?.textContent"), 'HUD', 'picked HUD icon')
  const hudId = await saveComment('Give just the inventory icon more contrast.')
  const hud = JSON.parse(await readFile(join(game, 'reviews', hudId + '.json'), 'utf8'))
  assert.equal(hud.target.view.surface, 'hud')
  assert.equal(hud.target.scope, 'hud')
  assert.deepEqual(tab.errors, [])

  // Deep link opens saved review in a fresh tab and restores view mode
  await tab.close()
  tab = await openTab(url + '&review=' + spriteId)
  await until(() => value('rt-review-select'), spriteId, 'review deep link opened in a fresh tab')
  assert.equal(await viewMode(), '2d')
  await change('#rt-review-select', id)
  await until(() => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-section-title')?.textContent"), 'Review · resolved', 'restored 3D review from 2D sprite review')
  assert.equal(await viewMode(), '3d')
  await clickButtonByText('Reopen')
  await until(() => tab.evaluate("document.querySelector('#ridgetop-testing-drawer .rt-section-title')?.textContent"), 'Review · open', 'reopened resolved feedback')
  assert.equal((await disk()).status, 'open')
  assert.deepEqual(tab.errors, [])
  console.log('Passed on ' + backend + ': picked 3D model, edited & saved recipe, compared revisions, pinned 2D sprite and HUD icon, and reopened reviews.')
} catch (error) {
  if (tab) console.error(await tab.evaluate("({ status: document.getElementById('rt-status-pill')?.textContent, footer: document.querySelector('#ridgetop-testing-drawer .rt-footer-msg')?.textContent })").catch(() => ''), tab.errors)
  throw error
} finally {
  if (tab) await tab.close().catch(() => {})
  if (server && server.exitCode === null && server.signalCode === null) {
    const stopped = once(server, 'exit')
    server.kill()
    await stopped
  }
  await rm(temp, { recursive: true, force: true })
}
