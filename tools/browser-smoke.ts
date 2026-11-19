import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { setTimeout as wait } from 'node:timers/promises'
import { courses } from '../game/level.ts'
import { ROUTE, SAVE_KEY } from '../game/campaign.ts'
import { courseRoute } from './course-route.ts'

const base = process.env.RIDGETOP_URL ?? 'http://localhost:3000'
const debug = process.env.CHROMIUM_DEBUG ?? 'http://localhost:9222'
const tabs = []
const room = 'test-' + Date.now().toString(36)

async function open(path: string, beforeLoad?: string) {
  const target = await fetch(debug + '/json/new?about:blank', { method: 'PUT' }).then(response => response.json())
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map()
  const errors = []
  let message = 0
  socket.onmessage = ({ data }) => {
    const packet = JSON.parse(data)
    if (packet.id) {
      const action = pending.get(packet.id)
      if (!action) return
      clearTimeout(action.timeout)
      pending.delete(packet.id)
      if (packet.error) action.reject(new Error(packet.error.message))
      else action.resolve(packet.result)
    }
    if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.text)
    if (packet.method === 'Log.entryAdded' && packet.params.entry.level === 'error') {
      errors.push(packet.params.entry.text)
    }
  }
  const call = <T = any>(method: string, params?: object) => new Promise<T>((resolve, reject) => {
    const id = ++message
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Timed out calling ' + method))
    }, 45_000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const tab = {
    call, errors,
    async evaluate(expression) {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result?.value
    },
    async close() {
      socket.close()
      await fetch(debug + '/json/close/' + target.id)
    }
  }
  tabs.push(tab)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Log.enable')
  if (beforeLoad) await call('Page.addScriptToEvaluateOnNewDocument', { source: beforeLoad })
  await call('Page.navigate', { url: base + path })
  await call('Page.bringToFront')
  return tab
}

async function until(read, expected, description, limit = 160) {
  let actual
  for (let i = 0; i < limit; i++) {
    actual = await read()
    if (typeof expected === 'function' ? expected(actual) : expected === actual) return actual
    await wait(100)
  }
  assert.fail(description + '. Last value: ' + actual)
}
const status = (tab, id) => tab.evaluate(`document.querySelector('#${id}')?.textContent`)
const click = (tab, id) => tab.evaluate(`document.querySelector('#${id}').click()`)
const key = (tab, type, code, key) => tab.call('Input.dispatchKeyEvent', { type, key, code })
const selected = process.env.RIDGETOP_BACKENDS?.split(',') ?? ['webgpu', 'webgl2', 'canvas']
const rendererNames = { webgpu: 'WebGPU', webgl2: 'WebGL 2', canvas: 'Canvas 2D' }

async function assertGameViewport(tab, stage: string, hud: string, overlay: string) {
  const layout = await tab.evaluate(`(() => {
    const world = document.getElementById('${stage}')
    const layer = document.getElementById('${hud}')
    const root = world.parentElement
    const fillsViewport = element => {
      const rect = element.getBoundingClientRect()
      return rect.top === 0 && rect.left === 0 && rect.width === innerWidth && rect.height === innerHeight
    }
    return {
      playfield: fillsViewport(world), hud: fillsViewport(layer), overlay: root.contains(document.getElementById('${overlay}')),
      noScroll: document.scrollingElement.scrollHeight === innerHeight,
      matchingPixels: layer.width === world.width && layer.height === world.height,
      painted: layer.getContext('2d').getImageData(40, 40, 1, 1).data[3] > 0
    }
  })()`)
  assert.deepEqual(layout, { playfield: true, hud: true, overlay: true, noScroll: true, matchingPixels: true, painted: true }, stage)
}

try {
  for (const backend of selected) {
    const tab = await open('/?mode=practice&renderer=' + backend)
    await until(() => status(tab, 'backend'), rendererNames[backend], backend + ' initialized')
    await until(() => status(tab, 'connection'), 'Solo practice', 'solo practice loaded')
    await assertGameViewport(tab, 'stage', 'beacon-hud', 'pause-screen')
    const hasSprite = await tab.evaluate(`(() => {
      const layer = document.querySelector('#sprites')
      const pixels = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
      return pixels.some((value, index) => index % 4 === 3 && value === 255)
    })()`)
    assert.equal(hasSprite, true, 'generated sprite pixels are visible')
    await key(tab, 'keyDown', 'Escape', 'Escape')
    await until(() => tab.evaluate("document.querySelector('#pause-screen').hidden"), false, 'pause opens')
    await click(tab, 'resume')
    await until(() => tab.evaluate("document.querySelector('#pause-screen').hidden"), true, 'resume closes pause')
    if (process.env.RIDGETOP_SCREENSHOT && backend === selected[0]) {
      const screenshot = await tab.call('Page.captureScreenshot', { format: 'png' })
      await writeFile(process.env.RIDGETOP_SCREENSHOT, Buffer.from(screenshot.data, 'base64'))
    }
    await key(tab, 'keyDown', 'KeyD', 'd')
    await until(() => status(tab, 'falls'), '1 fall', backend + ' solo movement and respawn')
    await key(tab, 'keyUp', 'KeyD', 'd')
    await click(tab, 'pause')
    await until(() => tab.evaluate("document.querySelector('#pause-screen').hidden"), false, 'in-game menu opens')
    await click(tab, 'reset')
    await until(() => status(tab, 'falls'), '0 falls', backend + ' reset')
    await click(tab, 'pause')
    await tab.evaluate("document.querySelector('#course').value='summit';document.querySelector('#course').dispatchEvent(new Event('change'))")
    await until(() => tab.evaluate("location.search.includes('course=summit')"), true, 'course changed')
    if (backend === 'webgl2') {
      const loss = await tab.evaluate("Boolean(document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context'))")
      if (loss) {
        await tab.evaluate("document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
        await until(() => status(tab, 'backend'), 'Canvas 2D', 'WebGL 2 context loss uses Canvas 2D')
      }
    }
    if (backend === 'canvas') {
      await tab.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      await tab.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
      const button = '[data-control=right]'
      const point = await tab.evaluate(`(() => {
        const rect = document.querySelector('${button}').getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })()`)
      assert.ok(point.y > 0 && point.y < 844)
      await tab.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await until(() => status(tab, 'falls'), '1 fall', 'touch movement and respawn')
      await tab.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await assertGameViewport(tab, 'stage', 'beacon-hud', 'pause-screen')
    }
    assert.deepEqual(tab.errors, [])
    await tab.close()
    tabs.pop()
    console.log(backend + ' rendered solo, accepted movement, recovered from a fall and switched courses')
  }

  for (const backend of selected) {
    const racer = await open('/racing?renderer=' + backend, `(() => {
      const storage = window.localStorage
      const prefix = ${JSON.stringify(room + '.racing.' + backend + '.')}
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: key => storage.getItem(prefix + key),
        setItem: (key, value) => storage.setItem(prefix + key, value)
      } })
    })()`)
    await until(() => status(racer, 'race-backend'), rendererNames[backend], backend + ' initialized in Signal Drift')
    await click(racer, 'race-events')
    await until(() => status(racer, 'race-overlay-title'), 'Events', 'championship schedule opens')
    assert.deepEqual(await racer.evaluate("[...document.querySelectorAll('[data-event]')].map(button => button.disabled)"), [false, true, true, true])
    await click(racer, 'race-garage')
    await until(() => racer.evaluate("!document.querySelector('#garage-screen').hidden && document.querySelector('#race-stage').parentElement.id === 'garage-bay'"), true, 'garage opens with the live car viewport')
    await racer.evaluate("document.querySelector('[data-upgrade=armor]').click()")
    assert.equal(await status(racer, 'garage-part-name'), 'Shield')
    assert.equal(await status(racer, 'garage-credits'), '100', 'choosing a part leaves the balance alone')
    assert.match(await status(racer, 'garage-stats'), /100→120/)
    await click(racer, 'garage-install')
    assert.equal(await status(racer, 'garage-credits'), '20')
    assert.equal(await status(racer, 'garage-tier'), 'Tier 1 of 3 fitted')
    assert.match(await status(racer, 'garage-stats'), /120→140/)
    await click(racer, 'garage-install')
    assert.equal(await status(racer, 'garage-credits'), '20', 'an unaffordable tier does not deduct credits')
    await click(racer, 'garage-back')
    assert.equal(await status(racer, 'race-overlay-title'), 'Events', 'Back returns to the source screen')
    await racer.call('Page.reload')
    await until(() => racer.evaluate(`(() => {
      const start = document.querySelector('#race-start')
      return start && !start.disabled && !start.hidden &&
        document.querySelector('#race-overlay-title').textContent === 'Signal Drift' &&
        document.querySelector('#race-purse').textContent === '20 credits'
    })()`), true, 'garage purchase saved and starting grid ready after reload')
    await click(racer, 'race-start')
    await key(racer, 'keyDown', 'KeyW', 'w')
    await until(() => status(racer, 'race-speed'), label => Number.parseInt(label) >= 12, 'race accelerated')
    await assertGameViewport(racer, 'race-stage', 'race-hud', 'race-overlay')
    await key(racer, 'keyUp', 'KeyW', 'w')
    assert.equal(await racer.evaluate("document.querySelector('#race-camera') === null"), true)
    assert.equal(await status(racer, 'race-shield'), 'Shield 120 / 120')
    await key(racer, 'keyDown', 'KeyJ', 'j')
    await key(racer, 'keyUp', 'KeyJ', 'j')
    await key(racer, 'keyDown', 'KeyK', 'k')
    await key(racer, 'keyUp', 'KeyK', 'k')
    await until(() => status(racer, 'race-ammo'), 'Pulse 3  ·  Snare 1', 'race weapons deployed')
    await key(racer, 'keyDown', 'Escape', 'Escape')
    await key(racer, 'keyUp', 'Escape', 'Escape')
    await until(() => status(racer, 'race-overlay-title'), 'Race paused', 'race paused')
    await click(racer, 'race-start')
    await click(racer, 'race-recover')
    await until(() => status(racer, 'race-speed'), '0 km/h', 'race recovered')
    if (backend === 'canvas') {
      await racer.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      await racer.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
      const point = await racer.evaluate(`(() => {
        const rect = document.querySelector('[data-control=throttle]').getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })()`)
      assert.ok(point.y > 0 && point.y < 844)
      await racer.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await until(() => status(racer, 'race-speed'), label => Number.parseInt(label) >= 12, 'portrait racing touch throttle')
      await racer.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await assertGameViewport(racer, 'race-stage', 'race-hud', 'race-overlay')
    }
    if (process.env.RIDGETOP_RACING_SCREENSHOT && backend === selected[0]) {
      const shot = await racer.call('Page.captureScreenshot', { format: 'png' })
      await writeFile(process.env.RIDGETOP_RACING_SCREENSHOT, Buffer.from(shot.data, 'base64'))
    }
    assert.deepEqual(racer.errors, [])
    await racer.close()
    tabs.pop()
    console.log(backend + ' rendered Signal Drift and handled garage preview, installation, save, driving, weapons, pause and recovery')
  }

  const campaign = await open('/?canvas=1', `
    (() => {
      const realStorage = window.localStorage
      const namespace = 'ridgetop.smoke.' + ${JSON.stringify(room)} + '.'
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: key => realStorage.getItem(namespace + key),
        setItem: (key, value) => realStorage.setItem(namespace + key, value),
        removeItem: key => realStorage.removeItem(namespace + key)
      } })
      let clock = 0
      let next = 0
      const pending = new Map()
      Object.defineProperty(performance, 'now', { value: () => clock })
      window.requestAnimationFrame = callback => { pending.set(++next, callback); return next }
      window.cancelAnimationFrame = id => pending.delete(id)
      window.advanceGame = count => {
        for (let remaining = count; remaining > 0;) {
          const steps = Math.min(remaining, 4)
          remaining -= steps
          clock += steps * (1000 / 60 + 0.000001)
          const current = Array.from(pending.values())
          pending.clear()
          for (const callback of current) callback(clock)
        }
      }
    })()
  `)
  await until(() => campaign.evaluate("document.querySelector('#campaign')?.disabled"), false, 'campaign title loaded')
  if (process.env.RIDGETOP_TITLE_SCREENSHOT) {
    await campaign.evaluate('advanceGame(6)')
    const shot = await campaign.call('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.RIDGETOP_TITLE_SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }
  await campaign.call('Emulation.setDeviceMetricsOverride', { width: 640, height: 680, deviceScaleFactor: 1, mobile: false })
  await click(campaign, 'sound')
  await click(campaign, 'campaign')

  for (const [index, id] of ROUTE.entries()) {
    const course = courses[id]
    assert.equal(await status(campaign, 'course-heading'), course.name)
    const { actions } = courseRoute(course, { collectSignal: true })
    await campaign.evaluate(`(${JSON.stringify(actions)}).reduce((previous, action) => {
      function press(code, type) {
        window.dispatchEvent(new KeyboardEvent(type, { code }))
      }
      if (action.left !== previous.left) press('KeyA', action.left ? 'keydown' : 'keyup')
      if (action.right !== previous.right) press('KeyD', action.right ? 'keydown' : 'keyup')
      if (action.jump !== previous.jump) {
        press('Space', 'keydown')
        press('Space', 'keyup')
      }
      advanceGame(action.frames)
      return action
    }, { left: false, right: false, jump: 0 })`)
    assert.equal(await campaign.evaluate("document.querySelector('#finish').hidden"), false, course.name)
    assert.equal(await status(campaign, 'finish-medal'), 'Gold · Signal chip recovered')
    assert.equal(await status(campaign, 'campaign-progress'), (index + 1) + ' / 6 relays online')
    await click(campaign, 'next')
    console.log(course.name + ' complete with gold and the signal chip')
  }

  assert.equal(await campaign.evaluate("document.querySelector('#ending').hidden"), false)
  assert.match(await status(campaign, 'ending-stats'), /6 \/ 6 signal chips · 6 \/ 6 gold/)
  const save = await campaign.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}))`)
  assert.deepEqual(Object.keys(save.levels), ROUTE)
  await campaign.call('Page.reload')
  await until(() => campaign.evaluate("document.querySelector('#campaign')?.disabled"), false, 'campaign reloaded')
  assert.equal(await status(campaign, 'campaign-progress'), '6 / 6 relays online')
  assert.equal(await status(campaign, 'sound'), 'Sound off')
  await click(campaign, 'view-ending')
  assert.equal(await campaign.evaluate("document.querySelector('#ending').hidden"), false)
  await campaign.evaluate(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`)
  for (const id of ROUTE) await campaign.evaluate(`localStorage.removeItem('ridgetop.best.${id}')`)
  assert.deepEqual(campaign.errors, [])
  await campaign.close()
  tabs.pop()
  console.log('all six courses finished through browser input, every chip recovered, ending and saved progress verified')

  const roomPath = '/?room=' + room + '&canvas=1'
  const a = await open(roomPath)
  await until(() => status(a, 'connection'), 'Room online', 'first player connected')
  const b = await open(roomPath)
  await until(() => status(b, 'standings'), lines => lines?.includes('You') && lines.includes('Scout 1'), 'second player sees first')
  await a.call('Page.bringToFront')
  await until(() => status(a, 'standings'), lines => lines?.includes('You') && lines.includes('Scout 2'), 'first player sees second')
  await b.call('Page.bringToFront')
  await click(b, 'journal-open')
  await until(() => b.evaluate("document.querySelector('#journal-screen').hidden"), false, 'in-game roster opens')
  await click(b, 'journal-close')
  await click(b, 'pause')
  await click(b, 'mode')
  await until(() => status(b, 'connection'), 'Solo practice', 'second player left for practice')
  await a.call('Page.bringToFront')
  await until(() => status(a, 'standings'), lines => lines?.includes('You') && !lines.includes('Scout 2'), 'first player sees departure')
  assert.deepEqual([...a.errors, ...b.errors], [])
  await a.close()
  await b.close()
  tabs.length = 0
  console.log('two tabs joined, saw one another, and observed a departure')

  const guild = await open('/?canvas=1')
  await until(() => guild.evaluate("document.querySelector('#expedition')?.disabled"), false, 'expedition title loaded')
  await click(guild, 'expedition')
  await until(() => status(guild, 'connection'), 'Expedition online', 'expedition connected from the title')
  const character = await until(() => status(guild, 'character-name'),
    name => /^Scout [A-F0-9]{6}$/.test(name), 'character journal loaded')
  assert.match(await status(guild, 'character-rank'), /Level [0-9]+ · [0-9]+ XP/)
  await click(guild, 'journal-open')
  await until(() => guild.evaluate("document.querySelector('#journal').getClientRects().length"), 1, 'expedition journal is visible over the course')
  await click(guild, 'journal-close')
  assert.equal(await guild.evaluate("document.querySelector('#journal').hidden"), false)
  assert.equal(await guild.evaluate("document.querySelector('#time').hidden"), true)
  assert.equal(await guild.evaluate("document.querySelector('#course option[value=ruins]').disabled"), true)
  const expedition = await open('/?mode=expedition&canvas=1')
  await until(() => status(expedition, 'connection'), 'Expedition online', 'second tab connected to the guild')
  await until(() => expedition.evaluate("document.querySelectorAll('#standings li').length"), 2, 'guild roster shows both players')
  assert.equal(await status(expedition, 'character-name'), character)
  await click(expedition, 'pause')
  await click(expedition, 'mode')
  await until(() => expedition.evaluate("document.querySelector('#title-screen').hidden"), false, 'left expedition for menu')
  await guild.call('Page.bringToFront')
  await until(() => guild.evaluate("document.querySelectorAll('#standings li').length"), 1, 'guild roster reflects the departure')
  assert.deepEqual([...guild.errors, ...expedition.errors], [])
  await expedition.close()
  await guild.close()
  tabs.length = 0
  console.log('two expedition tabs shared a zone and reused the saved character')

  const benchmark = await open('/benchmark')
  await until(() => benchmark.evaluate("document.readyState === 'complete'"), true, 'benchmark loaded')
  for (const backend of selected) {
    await benchmark.evaluate(`document.querySelector('[name=backend]').value='${backend}';document.querySelector('[name=count]').value='144';document.querySelector('#run').click()`)
    const line = await until(() => status(benchmark, 'result'), result => result && result !== 'Running…', 'benchmark ' + backend, 200)
    assert.ok(line.startsWith(rendererNames[backend] + ' ·'), line)
    if (backend !== 'canvas') assert.match(line, /· 2 draws · 0 bytes uploaded per frame/)
    console.log(line)
  }
  const gpu = selected.find(backend => backend !== 'canvas')
  if (gpu) {
    await benchmark.evaluate(`document.querySelector('[name=backend]').value='${gpu}';document.querySelector('[name=workload]').value='dynamic';document.querySelector('#run').click()`)
    const line = await until(() => status(benchmark, 'result'), result => result && result !== 'Running…', 'dynamic benchmark', 200)
    assert.match(line, /2 draws · 9,216 bytes uploaded per frame/)
    assert.equal(await benchmark.evaluate("document.querySelector('#download').href.startsWith('blob:')"), true)
    console.log(line)
  }
  assert.deepEqual(benchmark.errors, [])
} finally {
  await Promise.allSettled(tabs.map(tab => tab.close()))
}
