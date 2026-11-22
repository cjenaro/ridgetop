import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { click, key, openTab, status, until } from './browser-driver.ts'
import { createGame } from './create-game.ts'
import { createArtRecipe } from '../framework/art.ts'
import { multiply, orthographic, projectPoint, view } from '../framework/geometry.ts'

type Tab = Awaited<ReturnType<typeof openTab>>
const backend = process.env.RIDGETOP_REVIEW_RENDERER ?? 'canvas'
const temp = await mkdtemp(join(tmpdir(), 'ridgetop-playtest-'))
let server: ReturnType<typeof spawn>, tab: Tab

function change(selector: string, value: string) {
  return tab.evaluate(`{const f=document.querySelector(${JSON.stringify(selector)}); f.value=${JSON.stringify(value)}; f.dispatchEvent(new Event('change'))}`)
}
const value = (id: string) => tab.evaluate(`document.getElementById('${id}')?.value`)
const currentImage = () => tab.evaluate("document.getElementById('game-size')?.toDataURL()")
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
async function comment(text: string) {
  await until(() => tab.evaluate("document.getElementById('save-comment')?.disabled"), false, 'pinned art ready to save')
  await change('#review-text', text)
  await click(tab, 'save-comment')
  await until(() => status(tab, 'testing-status'), s => s?.startsWith('Saved in reviews/'), 'saved project review')
  return value('review-list')
}
try {
  const project = await createGame(join(temp, 'demo'))
  const game = join(project, 'game'), bindings = join(game, 'game.js')
  // A real, rectangular four-frame override exercises picking and replay on imported artwork.
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
  const url = origin + '/?renderer=' + backend
  tab = await openTab(url)
  await until(() => status(tab, 'inspect'), 'Pause & inspect', 'loaded testing host through its normal entry point')
  await click(tab, 'inspect')
  assert.equal(await value('view'), '3d')
  const aspect = await tab.evaluate("document.querySelector('#world').width / document.querySelector('#world').height")
  const span = Math.max(6.9, 10.65 / aspect)
  const camera = multiply(orthographic(span * aspect, span, .1, 52), view([4, 13.5, 3 + 26 * Math.cos(Math.PI / 6)], [4, .5, 3]))
  const visor = projectPoint(camera, 1.07, 1.06, 1.32)
  await press('#world', (visor[0] + 1) / 2, (1 - visor[1]) / 2)
  await until(() => value('object-list'), 'player', 'picked player through the playfield')
  const part = await value('pin-part')
  assert.match(part, /^visor(-light)?$/)
  assert.equal(await value('pin-scope'), 'asset')
  await key(tab, 'keyDown', 'ArrowRight', 'ArrowRight')
  await key(tab, 'keyUp', 'ArrowRight', 'ArrowRight')
  const id = await comment('Make this visor wider so it reads at game size.')
  const file = join(game, 'reviews', id + '.json')
  const disk = async () => JSON.parse(await readFile(file, 'utf8'))
  const original = await disk()
  assert.equal(original.target.part, part)
  assert.equal(original.target.view.surface, 'model')
  assert.deepEqual(original.scene.player, [1, 1, 0])
  assert.match(original.target.view.source, /overrides\.json#ranger$/)
  const beforeFile = join(game, 'reviews', original.before)
  const png = await readFile(beforeFile)
  const previous = await currentImage()

  await tab.evaluate("document.getElementById('direct-edit').open = true")
  const oldX = await tab.evaluate("document.querySelector('#edit-position input').value")
  await click(tab, 'move-part')
  await press('#pin-image', .48, .34, [.52, .37])
  await until(() => tab.evaluate("document.querySelector('#edit-position input').value"), x => x !== oldX, 'dragged the selected part in model space')
  const width = Number(await tab.evaluate("document.querySelector('#edit-scale input').value")) + .32
  await change('#edit-scale input', String(width))
  await until(() => currentImage(), image => image !== previous, 'preview changed before saving')
  const originalLoad = await tab.evaluate('performance.timeOrigin')
  await click(tab, 'save-part')
  await until(() => tab.evaluate('performance.timeOrigin'), time => time > originalLoad, 'navigated after saving the recipe')
  await until(() => status(tab, 'thread-status'), s => s?.endsWith('open'), 'reopened saved pin')
  await until(() => tab.evaluate("document.querySelector('#edit-scale input')?.value"), String(width), 'reloaded new recipe')
  const saved = JSON.parse(await readFile(join(game, 'art/overrides.json'), 'utf8')).ranger
  assert.equal(saved.parts.find(p => p.name === part).scale[0], width)
  assert.deepEqual(saved.palette, {})
  await until(() => tab.evaluate("document.getElementById('before-image')?.naturalWidth"), 384, 'original PNG decoded')

  const artistPreview = await currentImage()
  saved.parts.find(p => p.name === part).tone = 'accent'
  await writeFile(join(game, 'art/overrides.json'), JSON.stringify({ ranger: saved }, null, 2))
  const ready = await disk()
  ready.status = 'ready'
  ready.replies.push({ text: 'Gave the wider visor an amber highlight. Check it at game size.', date: new Date().toISOString() })
  await writeFile(file, JSON.stringify(ready, null, 2))
  await click(tab, 'refresh-reviews')
  await until(() => status(tab, 'thread-status'), 'Review · ready', 'read the agent reply from disk')
  const savedLoad = await tab.evaluate('performance.timeOrigin')
  await click(tab, 'compare-latest')
  await until(() => tab.evaluate('performance.timeOrigin'), time => time > savedLoad, 'reloaded latest project source')
  await until(() => status(tab, 'thread-status'), 'Review · ready', 'restored the reviewed scene')
  await until(() => value('pin-part'), part, 'restored named part')
  await until(() => currentImage(), image => image && image !== previous && image !== artistPreview, 'current image includes the agent revision')
  assert.deepEqual(await readFile(beforeFile), png)
  await change('#review-text', 'I can read it now.')
  await click(tab, 'resolve-review')
  await until(() => status(tab, 'thread-status'), 'Review · resolved', 'creator resolved with a reply')
  assert.equal((await disk()).replies.length, 2)

  await click(tab, 'inspect')
  await change('#view', '2d')
  await until(() => tab.evaluate("document.getElementById('sprites').hidden"), false, 'switched to 2D')
  await click(tab, 'inspect')
  // Click an opaque pixel of the actual frozen sprite, avoiding the transparent frame margin.
  const center = projectPoint(camera, 1, .68, 1)
  await press('#sprites', (center[0]+1)/2, (1-center[1])/2)
  await until(() => value('object-list'), 'player', 'picked imported 2D art through the playfield')
  assert.equal(await value('pin-scope'), 'sprite')
  await until(() => tab.evaluate("document.getElementById('pin-image').width < document.getElementById('pin-image').height && !document.getElementById('save-comment').disabled"), true, 'rectangular sprite ready for pinning')
  await press('#pin-image', .34, .23, [.66, .47])
  const spriteId = await comment('Brighten this section of the running scout.')
  const sprite = JSON.parse(await readFile(join(game, 'reviews', spriteId + '.json'), 'utf8'))
  const v = sprite.target.view
  assert.equal(v.source, 'art/sprites.json')
  assert.equal(v.sheet, 'art/sprites.png')
  assert.equal(v.clip, 'run')
  assert.equal(v.handDrawn, true)
  assert.equal(v.column, v.frame + 2)
  assert.equal(v.row, 0)
  assert.ok(v.width < v.height)
  assert.ok(sprite.target.region.every((n, i) => Math.abs(n - [.34, .23, .66, .47][i]) < .02), 'dragged region ' + JSON.stringify(sprite.target.region))

  await press('#icon', .5, .5)
  await until(() => value('object-list'), 'inventory', 'picked inventory icon')
  assert.equal(await value('pin-scope'), 'hud')
  const hudId = await comment('Give just the inventory icon more contrast.')
  const hud = JSON.parse(await readFile(join(game, 'reviews', hudId + '.json'), 'utf8'))
  assert.equal(hud.target.view.surface, 'hud')
  assert.equal(hud.target.view.width, 34)
  assert.equal(hud.target.view.source, 'art/Moon Crystal.art.json')
  assert.equal(await currentImage(), await tab.evaluate("document.getElementById('icon').toDataURL()"))
  assert.ok(hud.target.part)
  assert.equal(hud.target.scope, 'hud')
  assert.equal(hud.target.editSource, 'main.js#inventory')
  await change('#object-list', 'prop-3-0')
  await until(() => status(tab, 'pin-title'), 'flower', 'selected a code-defined model')
  await change('#pin-part', 'petals')
  await change('#pin-scope', 'instance')
  const propId = await comment('Move just this flower one tile.')
  const prop = JSON.parse(await readFile(join(game, 'reviews', propId + '.json'), 'utf8'))
  assert.equal(prop.target.part, 'petals')
  assert.equal(prop.target.editSource, 'game.js#game.map')
  assert.equal(prop.target.view.source, 'game.js#models.flower')
  assert.deepEqual(tab.errors, [])
  await tab.close()
  tab = await openTab(url + '&testing=1&review=' + spriteId)
  await until(() => value('review-list'), spriteId, 'review deep link opened in a fresh tab')
  assert.equal(await value('view'), '2d')
  assert.match(await status(tab, 'pin-context'), new RegExp('run · frame ' + (v.frame + 1)))
  await change('#review-list', id)
  await until(() => status(tab, 'thread-status'), 'Review · resolved', 'restored model from a sprite review')
  assert.equal(await value('view'), '3d')
  await click(tab, 'resolve-review')
  await until(() => status(tab, 'thread-status'), 'Review · open', 'reopened resolved feedback')
  assert.equal((await disk()).status, 'open')
  assert.deepEqual(tab.errors, [])
  console.log('Passed on ' + backend + ': picked a 3D part, saved a recipe, compared revisions, pinned an animated sprite region and HUD icon, and reopened the reviews.')
} catch (error) {
  if (tab) console.error(await tab.evaluate("({ objective:document.getElementById('objective')?.textContent, status:document.getElementById('testing-status')?.textContent, object:document.getElementById('object-list')?.value })").catch(() => ''), tab.errors)
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
