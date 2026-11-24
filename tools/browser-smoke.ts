import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { courses } from '../examples/beacon-run/game/level.ts'
import { ROUTE, SAVE_KEY } from '../examples/beacon-run/game/campaign.ts'
import { courseRoute } from './course-route.ts'
import type { BrowserTab } from './browser-driver.ts'
import { openTab, until, status, click, key } from './browser-driver.ts'

type SmokeBackend = 'webgpu' | 'webgl2' | 'canvas'
const base = process.env.RIDGETOP_URL ?? 'http://localhost:3000'
const tabs: BrowserTab[] = []
const room = 'test-' + Date.now().toString(36)
async function open(path: string, beforeLoad?: string) {
  const tab = await openTab(base + path, beforeLoad)
  tabs.push(tab)
  return tab
}
const selected = (process.env.RIDGETOP_BACKENDS?.split(',') ?? ['webgpu', 'webgl2', 'canvas']) as SmokeBackend[]
const rendererNames: Record<SmokeBackend, string> = { webgpu: 'WebGPU', webgl2: 'WebGL 2', canvas: 'Canvas 2D' }

const uiState = <T = any>(tab: BrowserTab, field: string) => tab.evaluate<T>(`window.__ridgetopUi?.state?.()?.[${JSON.stringify(field)}]`)
const uiAct = (tab: BrowserTab, id: string, action = 'press', payload?: unknown) =>
  tab.evaluate(`window.__ridgetopUi?.act(${JSON.stringify(id)}, ${JSON.stringify(action)}, ${JSON.stringify(payload)})`)
type UiRect = { x: number; y: number; width: number; height: number }
const uiRect = (tab: BrowserTab, id: string) => tab.evaluate<UiRect | undefined>(`window.__ridgetopUi?.rects?.()?.[${JSON.stringify(id)}]`)

async function assertGameViewport(tab: BrowserTab, stage: string, hud: string, uiLayer: string) {
  const layout = await tab.evaluate(`(() => {
    const world = document.getElementById('${stage}')
    const layer = document.getElementById('${hud}')
    const ui = document.getElementById('${uiLayer}')
    const fillsViewport = element => {
      const rect = element.getBoundingClientRect()
      return rect.top === 0 && rect.left === 0 && rect.width === innerWidth && rect.height === innerHeight
    }
    return {
      playfield: fillsViewport(world), hud: fillsViewport(layer), ui: fillsViewport(ui),
      noHtmlMenus: document.querySelectorAll('button, select').length === 0,
      noScroll: document.scrollingElement.scrollHeight === innerHeight,
      matchingPixels: layer.width === world.width && layer.height === world.height,
      painted: layer.getContext('2d').getImageData(40, 40, 1, 1).data[3] > 0
    }
  })()`)
  assert.deepEqual(layout, { playfield: true, hud: true, ui: true, noHtmlMenus: true, noScroll: true, matchingPixels: true, painted: true }, stage)
}

try {
  for (const backend of selected) {
    const models = await open('/models?renderer=' + backend)
    await until(() => status(models, 'stats'), s => s?.includes('triangles · ' + rendererNames[backend]), backend + ' live geometry')
    await click(models, 'ranger')
    await until(() => status(models, 'model-title'), 'Field ranger', 'loaded the built-in ranger model')
    await models.evaluate("document.querySelector('#orbit').focus()")
    const clip = await models.evaluate(`(() => {
      const {x,y,width,height} = document.querySelector('#orbit').getBoundingClientRect()
      return {x,y,width,height,scale:1}
    })()`)
    async function renderedView() {
      await models.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      return (await models.call('Page.captureScreenshot', { format: 'png', clip })).data
    }
    const first = await renderedView()
    const rangerStats = await status(models, 'stats')
    await key(models, 'keyDown', 'ArrowRight', 'ArrowRight')
    await key(models, 'keyUp', 'ArrowRight', 'ArrowRight')
    await until(async () => await renderedView() !== first, true, 'orbit redraws the mesh from a new angle', 16)
    await click(models, 'lantern')
    await until(() => status(models, 'model-title'), 'Signal lantern', 'selected the built-in lantern model')
    await until(() => status(models, 'stats'), s => s?.includes('triangles') && s !== rangerStats, 'submitted the lantern geometry')
    assert.deepEqual(models.errors, [])
    await models.close()
    tabs.pop()
    console.log(backend + ' drew the three low-poly examples and changed the mesh view on keyboard input')
  }

  const workshop = await open('/sprites')
  await until(() => workshop.evaluate("document.querySelector('#frames')?.children.length"), 8, 'ranger turntable preview')
  await workshop.evaluate("document.querySelector('#frames button').click()")
  const preview = () => workshop.evaluate("document.querySelector('#preview').toDataURL()")
  const original = await preview()
  await click(workshop, 'next-palette')
  assert.notEqual(await preview(), original, 'palette changes the rendered pose')
  const views = await workshop.evaluate(`[...document.querySelectorAll('#frames canvas')].map(frame => {
    const pixels = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height).data
    if (pixels[3] !== 0 || !pixels.some((value, i) => i % 4 === 3 && value === 255)) return null
    return frame.toDataURL()
  })`)
  assert.ok(views.every(Boolean))
  assert.equal(new Set(views).size, 8, 'eight distinct model views on transparent backgrounds')
  await workshop.evaluate(`(() => {
    const art = document.querySelector('#art')
    art.value = 'ranger'
    art.dispatchEvent(new Event('change'))
    const parts = document.querySelector('#part-name')
    parts.value = 'backpack'
    parts.dispatchEvent(new Event('change'))
  })()`)
  const backView = () => workshop.evaluate("document.querySelector('[aria-label=\"back model view\"]').toDataURL()")
  const firstBack = await backView()
  await workshop.evaluate(`(() => {
    document.querySelector('#part-scale input').value = '.92'
    document.querySelector('#part-form').requestSubmit()
  })()`)
  assert.match((await status(workshop, 'part-status')) ?? '', /Updated backpack/)
  const editedBack = await backView()
  assert.notEqual(editedBack, firstBack, 'a named part edit reaches the rendered back view')
  await click(workshop, 'silhouette')
  assert.equal(await workshop.evaluate("document.querySelector('#view-comparison').classList.contains('silhouettes')"), true)
  assert.equal(await backView(), editedBack, 'the silhouette overlay preserves the art pixels')
  await workshop.evaluate(`(() => {
    const art = document.querySelector('#art')
    art.value = 'starter-vessel'
    art.dispatchEvent(new Event('change'))
    const parts = document.querySelector('#part-name')
    parts.value = 'rim'
    parts.dispatchEvent(new Event('change'))
    document.querySelector('#part-rotation input').value = '28'
    document.querySelector('#fit-model').click()
  })()`)
  assert.match((await status(workshop, 'part-status')) ?? '', /fitted all eight views/)
  assert.equal(await workshop.evaluate("document.querySelector('#part-name').value"), 'rim')
  assert.ok(await workshop.evaluate(`[...document.querySelectorAll('#frames canvas')].length === 8 &&
    [...document.querySelectorAll('#frames canvas')].every(frame => {
      const { width, height } = frame
      const { data } = frame.getContext('2d').getImageData(0,0,width,height)
      return data.some((alpha,i) => i % 4 === 3 && alpha) && data.every((alpha,i) => {
        if (i % 4 !== 3 || !alpha) return true
        const x = Math.floor(i / 4) % width, y = Math.floor(i / (4 * width))
        return x > 0 && y > 0 && x < width - 1 && y < height - 1
      })
    })`))
  await workshop.evaluate(`(async () => {
    const portrait = await fetch('/game/assets/scout.png').then(response => response.blob())
    const transfer = new DataTransfer()
    transfer.items.add(new File([portrait], 'scout.png', { type: 'image/png' }))
    const input = document.querySelector('#import-files')
    input.files = transfer.files
    input.dispatchEvent(new Event('change'))
  })()`)
  await until(() => workshop.evaluate("document.querySelector('#clip').value"), 'hover', 'single PNG becomes a hover')
  assert.equal(await workshop.evaluate("document.querySelector('#frames').children.length"), 4)
  assert.equal(await workshop.evaluate("document.querySelector('#part-editor').hidden && document.querySelector('#model-review').hidden"), true)
  assert.deepEqual(workshop.errors, [])
  await workshop.close()
  tabs.pop()
  console.log('sprite workshop generated palette variants, eight car views, a named part edit, silhouettes, and an imported hover')

  const starter = await open('/starter/?view=2d&renderer=' + selected[0])
  await until(() => starter.evaluate(`(() => {
    const layer = document.querySelector('#sprites')
    if (!layer || layer.hidden) return false
    const pixels = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
    return pixels.some((v, i) => i % 4 === 3 && v > 0)
  })()`), true, 'starter renders from the in-memory sprite sheets')
  assert.equal(await uiState(starter, 'count'), '0 / 3')
  await key(starter, 'keyDown', 'ArrowRight', 'ArrowRight')
  await until(() => uiState(starter, 'count'), '1 / 3', 'starter collected a crystal')
  await key(starter, 'keyUp', 'ArrowRight', 'ArrowRight')
  await uiAct(starter, 'hud-view-toggle', 'toggle')
  await until(() => starter.evaluate("!document.querySelector('#world').hidden && document.querySelector('#sprites').hidden"), true, 'live meshes selected')
  assert.equal(await uiState(starter, 'count'), '1 / 3')
  await uiAct(starter, 'menu-btn')
  await uiAct(starter, 'restart-btn')
  assert.equal(await uiState(starter, 'count'), '0 / 3')
  assert.deepEqual(starter.errors, [])
  await starter.close()
  tabs.pop()
  console.log('the playable starter collected a pickup in 2D, kept progress in 3D, and restarted')

  for (const backend of selected) {
    const tab = await open('/?mode=practice&renderer=' + backend)
    await until(() => uiState(tab, 'backend'), rendererNames[backend], backend + ' initialized')
    await until(() => uiState(tab, 'connection'), 'Solo practice', 'solo practice loaded')
    await assertGameViewport(tab, 'stage', 'beacon-hud', 'ui')
    const hasSprite = await tab.evaluate(`(() => {
      const layer = document.querySelector('#sprites')
      const pixels = layer.getContext('2d').getImageData(0, 0, layer.width, layer.height).data
      return pixels.some((value, index) => index % 4 === 3 && value === 255)
    })()`)
    assert.equal(hasSprite, true, 'generated sprite pixels are visible')
    await key(tab, 'keyDown', 'Escape', 'Escape')
    await until(() => uiState(tab, 'screen'), 'pause', 'pause opens')
    await uiAct(tab, 'resume')
    await until(() => uiState(tab, 'screen'), 'play', 'resume closes pause')
    if (process.env.RIDGETOP_SCREENSHOT && backend === selected[0]) {
      const screenshot = await tab.call('Page.captureScreenshot', { format: 'png' })
      await writeFile(process.env.RIDGETOP_SCREENSHOT, Buffer.from(screenshot.data, 'base64'))
    }
    await key(tab, 'keyDown', 'KeyD', 'd')
    await until(() => uiState(tab, 'falls'), '1 fall', backend + ' solo movement and respawn')
    await key(tab, 'keyUp', 'KeyD', 'd')
    await uiAct(tab, 'pause')
    await until(() => uiState(tab, 'screen'), 'pause', 'in-game menu opens')
    await uiAct(tab, 'reset')
    await until(() => uiState(tab, 'falls'), '0 falls', backend + ' reset')
    await uiAct(tab, 'pause')
    await uiAct(tab, 'course', 'select', 'summit')
    await until(() => tab.evaluate("location.search.includes('course=summit')"), true, 'course changed')
    if (backend === 'webgl2') {
      const loss = await tab.evaluate("Boolean(document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context'))")
      if (loss) {
        await tab.evaluate("document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
        await until(() => uiState(tab, 'backend'), 'Canvas 2D', 'WebGL 2 context loss uses Canvas 2D')
      }
    }
    if (backend === 'canvas') {
      await tab.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      await tab.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
      const rect = await until(() => uiRect(tab, 'touch-right'), r => Boolean(r), 'touch right button laid out')
      assert.ok(rect)
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      assert.ok(point.y > 0 && point.y < 844)
      await tab.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await until(() => uiState(tab, 'falls'), '1 fall', 'touch movement and respawn')
      await tab.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await assertGameViewport(tab, 'stage', 'beacon-hud', 'ui')
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
    await until(() => uiState(racer, 'backend'), rendererNames[backend], backend + ' initialized in Signal Drift')
    await uiAct(racer, 'race-events')
    await until(() => uiState(racer, 'overlayTitle'), 'Events', 'championship schedule opens')
    assert.deepEqual(await uiState(racer, 'eventsLocked'), [false, true, true, true])
    await uiAct(racer, 'race-garage')
    await until(() => uiState(racer, 'screen'), 'garage', 'garage opens with the live car viewport')
    await uiAct(racer, 'upgrade-armor')
    assert.equal(await uiState(racer, 'garagePart'), 'Shield')
    assert.equal(await uiState(racer, 'garageCredits'), '100', 'choosing a part leaves the balance alone')
    assert.match(await uiState(racer, 'garageStats'), /100→120/)
    await uiAct(racer, 'garage-install')
    assert.equal(await uiState(racer, 'garageCredits'), '20')
    assert.equal(await uiState(racer, 'garageTier'), 'Tier 1 of 3 fitted')
    assert.match(await uiState(racer, 'garageStats'), /120→140/)
    await uiAct(racer, 'garage-install')
    assert.equal(await uiState(racer, 'garageCredits'), '20', 'an unaffordable tier does not deduct credits')
    await uiAct(racer, 'garage-back')
    assert.equal(await uiState(racer, 'overlayTitle'), 'Events', 'Back returns to the source screen')
    await racer.call('Page.reload')
    await until(() => racer.evaluate(`(() => {
      const s = window.__ridgetopUi?.state?.()
      return s && s.screen === 'home' && s.overlayTitle === 'Signal Drift' && s.purse === '20 credits'
    })()`), true, 'garage purchase saved and starting grid ready after reload')
    await uiAct(racer, 'race-start')
    await key(racer, 'keyDown', 'KeyW', 'w')
    await until(() => uiState(racer, 'speed'), label => Number.parseInt(label) >= 12, 'race accelerated')
    await assertGameViewport(racer, 'race-stage', 'race-hud', 'race-ui')
    await key(racer, 'keyUp', 'KeyW', 'w')
    assert.equal(await uiState(racer, 'shield'), 'Shield 120 / 120')
    await key(racer, 'keyDown', 'KeyJ', 'j')
    await key(racer, 'keyUp', 'KeyJ', 'j')
    await key(racer, 'keyDown', 'KeyK', 'k')
    await key(racer, 'keyUp', 'KeyK', 'k')
    await until(() => uiState(racer, 'ammo'), 'Pulse 3  ·  Snare 1', 'race weapons deployed')
    await key(racer, 'keyDown', 'Escape', 'Escape')
    await key(racer, 'keyUp', 'Escape', 'Escape')
    await until(() => uiState(racer, 'overlayTitle'), 'Race paused', 'race paused')
    await uiAct(racer, 'race-start')
    await uiAct(racer, 'race-recover')
    await until(() => uiState(racer, 'speed'), '0 km/h', 'race recovered')
    if (backend === 'canvas') {
      await racer.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
      await racer.call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 })
      const rect = await until(() => uiRect(racer, 'touch-throttle'), r => Boolean(r), 'touch throttle laid out')
      assert.ok(rect)
      const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      assert.ok(point.y > 0 && point.y < 844)
      await racer.call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await until(() => uiState(racer, 'speed'), label => Number.parseInt(label) >= 12, 'portrait racing touch throttle')
      await racer.call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await assertGameViewport(racer, 'race-stage', 'race-hud', 'race-ui')
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

  for (const backend of selected) {
    const lh = await open('/lighthouse?renderer=' + backend, `(() => {
      const storage = window.localStorage
      const prefix = ${JSON.stringify(room + '.lighthouse.' + backend + '.')}
      Object.defineProperty(window, 'localStorage', { value: {
        getItem: key => storage.getItem(prefix + key),
        setItem: (key, value) => storage.setItem(prefix + key, value),
        removeItem: key => storage.removeItem(prefix + key)
      } })
    })()`)
    await until(() => uiState(lh, 'screen'), 'title', backend + ' Tidewatch title screen loaded')
    const titleLayout = await lh.evaluate(`(() => {
      const world = document.getElementById('lh-stage')
      const layer = document.getElementById('lh-hud')
      const ui = document.getElementById('lh-ui')
      const fillsViewport = el => {
        const r = el.getBoundingClientRect()
        return r.top === 0 && r.left === 0 && r.width === innerWidth && r.height === innerHeight
      }
      const uiPixels = ui.getContext('2d').getImageData(0, 0, ui.width, ui.height).data
      let uiPainted = false
      for (let i = 3; i < uiPixels.length; i += 64) { if (uiPixels[i] > 0) { uiPainted = true; break } }
      return {
        playfield: fillsViewport(world),
        hud: fillsViewport(layer),
        ui: fillsViewport(ui),
        noHtmlMenus: document.querySelectorAll('button, select').length === 0,
        noScroll: document.scrollingElement.scrollHeight === innerHeight,
        uiPainted
      }
    })()`)
    assert.deepEqual(titleLayout, { playfield: true, hud: true, ui: true, noHtmlMenus: true, noScroll: true, uiPainted: true }, backend + ' Tidewatch title layout')

    // Start gameplay via Canvas UI action
    await uiAct(lh, 'lh-play')
    await until(() => uiState(lh, 'screen'), 'playing', backend + ' Tidewatch gameplay started')
    await assertGameViewport(lh, 'lh-stage', 'lh-hud', 'lh-ui')

    // Verify movement / keyboard input updates the rendered viewport and state stays finite
    const stageClip = await lh.evaluate(`(() => {
      const { x, y, width, height } = document.getElementById('lh-stage').getBoundingClientRect()
      return { x, y, width, height, scale: 1 }
    })()`)
    async function captureStage() {
      await lh.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      return (await lh.call('Page.captureScreenshot', { format: 'png', clip: stageClip })).data
    }
    const beforeMove = await captureStage()
    await key(lh, 'keyDown', 'KeyD', 'd')
    await key(lh, 'keyDown', 'KeyS', 's')
    await until(async () => await captureStage() !== beforeMove, true, backend + ' Tidewatch movement updates live frame', 40)
    await key(lh, 'keyUp', 'KeyD', 'd')
    await key(lh, 'keyUp', 'KeyS', 's')

    const playState = await lh.evaluate('window.__ridgetopUi?.state?.()')
    for (const metric of ['day', 'coins', 'fuel', 'warmth', 'carry', 'shipsGuided']) {
      assert.ok(typeof playState[metric] === 'number' && Number.isFinite(playState[metric]), `${backend} Tidewatch ${metric} must be finite`)
    }

    // Open and close the upgrade shop modal
    await key(lh, 'keyDown', 'KeyE', 'e')
    await key(lh, 'keyUp', 'KeyE', 'e')
    await until(() => uiState(lh, 'screen'), 'shop', backend + ' Tidewatch upgrade shop opens')
    await until(() => lh.evaluate("window.__ridgetopUi?.query?.({ id: 'lh-upg-boots' })?.length"), 1, backend + ' Tidewatch upgrade button rendered in shop modal')
    await until(() => uiRect(lh, 'lh-shop-close'), Boolean, backend + ' Tidewatch shop close button laid out')
    await uiAct(lh, 'lh-shop-close')
    await until(() => uiState(lh, 'screen'), 'playing', backend + ' Tidewatch upgrade shop closes')

    // Pause and resume
    await key(lh, 'keyDown', 'Escape', 'Escape')
    await key(lh, 'keyUp', 'Escape', 'Escape')
    await until(() => uiState(lh, 'screen'), 'paused', backend + ' Tidewatch pause opens')
    await until(() => uiRect(lh, 'lh-resume'), Boolean, backend + ' Tidewatch resume button laid out')
    await uiAct(lh, 'lh-resume')
    await until(() => uiState(lh, 'screen'), 'playing', backend + ' Tidewatch pause closes')

    // Confirm active rendering stats on this backend (instances/triangles > 0, no NaN, alpha/additive blending & dynamic lighting active)
    const renderProbe = await lh.evaluate(`(async () => {
      const [{ createLowPolyRenderer }, { createInitialState, stepGame }, { createLighthouseScene }] = await Promise.all([
        import('/framework/index.js'),
        import('/lighthouse/simulation.js'),
        import('/lighthouse/scene.js')
      ])
      const probeCanvas = document.createElement('canvas')
      probeCanvas.width = 640
      probeCanvas.height = 360
      probeCanvas.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;opacity:0;pointer-events:none'
      document.body.appendChild(probeCanvas)
      let renderer
      let scene
      try {
        renderer = await createLowPolyRenderer(probeCanvas, {
          backend: ${JSON.stringify(backend)},
          canvasDepth: true,
          lighting: { direction: [-0.45, 0.82, 0.36], ambient: 0.50 }
        })
        let lastLighting = null
        let alphaInstances = 0
        let additiveInstances = 0
        let opaqueInstances = 0
        let hasNonFiniteInstance = false
        const tracked = {
          get name() { return renderer.name },
          get canvas() { return renderer.canvas },
          setLighting(opts) {
            lastLighting = opts
            return renderer.setLighting(opts)
          },
          render(camera, batches, clear) {
            alphaInstances = 0
            additiveInstances = 0
            opaqueInstances = 0
            hasNonFiniteInstance = false
            for (const b of batches) {
              const mode = b.blend ?? 'opaque'
              if (mode === 'alpha') alphaInstances += b.count
              else if (mode === 'additive') additiveInstances += b.count
              else opaqueInstances += b.count
              const len = b.count * 16
              for (let i = 0; i < len; i++) {
                if (!Number.isFinite(b.data[i])) { hasNonFiniteInstance = true; break }
              }
            }
            return renderer.render(camera, batches, clear)
          },
          release(batch) { return renderer.release(batch) },
          releaseMesh(m) { return renderer.releaseMesh(m) },
          dispose() { return renderer.dispose() }
        }
        scene = createLighthouseScene(tracked)
        const state = createInitialState(1337)
        for (let i = 0; i < 6; i++) stepGame(state, { x: 0.8, z: 0.4 }, 1 / 60)
        const stats = scene.render(state, 1 / 60, false)
        return {
          backend: renderer.name,
          stats,
          alphaInstances,
          additiveInstances,
          opaqueInstances,
          hasNonFiniteInstance,
          pointLights: lastLighting?.points?.length ?? 0,
          fogActive: Number.isFinite(lastLighting?.fogNear) && Number.isFinite(lastLighting?.fogFar) && lastLighting.fogFar > lastLighting.fogNear
        }
      } finally {
        scene?.dispose()
        renderer?.dispose()
        probeCanvas.remove()
      }
    })()`)
    assert.equal(renderProbe.backend, rendererNames[backend], backend + ' Tidewatch backend matched')
    assert.ok(renderProbe.stats.instances > 0 && Number.isFinite(renderProbe.stats.instances), backend + ' Tidewatch instances > 0')
    assert.ok(renderProbe.stats.triangles > 0 && Number.isFinite(renderProbe.stats.triangles), backend + ' Tidewatch triangles > 0')
    assert.ok(renderProbe.stats.drawCalls > 0 && Number.isFinite(renderProbe.stats.drawCalls), backend + ' Tidewatch drawCalls > 0')
    assert.equal(renderProbe.hasNonFiniteInstance, false, backend + ' Tidewatch instance transforms have no NaN/Infinity')
    assert.ok(renderProbe.alphaInstances > 0, backend + ' Tidewatch alpha blending active')
    assert.ok(renderProbe.additiveInstances > 0, backend + ' Tidewatch additive blending active')
    assert.ok(renderProbe.pointLights >= 3, backend + ' Tidewatch dynamic point lighting active')
    assert.equal(renderProbe.fogActive, true, backend + ' Tidewatch distance fog active')

    if (process.env.RIDGETOP_LIGHTHOUSE_SCREENSHOT && backend === selected[0]) {
      const shot = await lh.call('Page.captureScreenshot', { format: 'png' })
      await writeFile(process.env.RIDGETOP_LIGHTHOUSE_SCREENSHOT, Buffer.from(shot.data, 'base64'))
    }
    assert.deepEqual(lh.errors, [])
    await lh.close()
    tabs.pop()
    console.log(backend + ' rendered Tidewatch (/lighthouse) with alpha/additive blending, dynamic lighting, movement, and shop modal')
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
  await until(() => uiState(campaign, 'screen'), 'title', 'campaign title loaded')
  if (process.env.RIDGETOP_TITLE_SCREENSHOT) {
    await campaign.evaluate('advanceGame(6)')
    const shot = await campaign.call('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.RIDGETOP_TITLE_SCREENSHOT, Buffer.from(shot.data, 'base64'))
  }
  await campaign.call('Emulation.setDeviceMetricsOverride', { width: 640, height: 680, deviceScaleFactor: 1, mobile: false })
  await uiAct(campaign, 'sound', 'toggle')
  await uiAct(campaign, 'campaign')

  for (const [index, id] of ROUTE.entries()) {
    const course = courses[id]
    assert.equal(await uiState(campaign, 'courseName'), course.name)
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
    assert.equal(await uiState(campaign, 'finished'), true, course.name)
    assert.equal(await uiState(campaign, 'finishMedal'), 'Gold · Signal chip recovered')
    assert.equal(await uiState(campaign, 'campaignProgress'), (index + 1) + ' / 6 relays online')
    await uiAct(campaign, 'next')
    console.log(course.name + ' complete with gold and the signal chip')
  }

  assert.equal(await uiState(campaign, 'screen'), 'ending')
  assert.match(await uiState(campaign, 'endingStats'), /6 \/ 6 signal chips · 6 \/ 6 gold/)
  const save = await campaign.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}))`)
  assert.deepEqual(Object.keys(save.levels), ROUTE)
  await campaign.call('Page.reload')
  await until(() => uiState(campaign, 'screen'), 'title', 'campaign reloaded')
  assert.equal(await uiState(campaign, 'campaignProgress'), '6 / 6 relays online')
  assert.equal(await uiState(campaign, 'sound'), 'Sound off')
  await uiAct(campaign, 'view-ending')
  assert.equal(await uiState(campaign, 'screen'), 'ending')
  await campaign.evaluate(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`)
  for (const id of ROUTE) await campaign.evaluate(`localStorage.removeItem('ridgetop.best.${id}')`)
  assert.deepEqual(campaign.errors, [])
  await campaign.close()
  tabs.pop()
  console.log('all six courses finished through browser input, every chip recovered, ending and saved progress verified')

  const roomPath = '/?room=' + room + '&canvas=1'
  const a = await open(roomPath)
  await until(() => uiState(a, 'connection'), 'Room online', 'first player connected')
  const b = await open(roomPath)
  await until(() => uiState<string[] | undefined>(b, 'standings'), lines => lines?.some(l => l.includes('You')) && lines?.some(l => l.includes('Scout 1')), 'second player sees first')
  await a.call('Page.bringToFront')
  await until(() => uiState<string[] | undefined>(a, 'standings'), lines => lines?.some(l => l.includes('You')) && lines?.some(l => l.includes('Scout 2')), 'first player sees second')
  await b.call('Page.bringToFront')
  await uiAct(b, 'journal-open')
  await until(() => uiState(b, 'screen'), 'journal', 'in-game roster opens')
  await uiAct(b, 'journal-close')
  await uiAct(b, 'pause')
  await uiAct(b, 'mode')
  await until(() => uiState(b, 'connection'), 'Solo practice', 'second player left for practice')
  await a.call('Page.bringToFront')
  await until(() => uiState<string[] | undefined>(a, 'standings'), lines => lines?.some(l => l.includes('You')) && !lines?.some(l => l.includes('Scout 2')), 'first player sees departure')
  assert.deepEqual([...a.errors, ...b.errors], [])
  await a.close()
  await b.close()
  tabs.length = 0
  console.log('two tabs joined, saw one another, and observed a departure')

  const guild = await open('/?canvas=1')
  await until(() => uiState(guild, 'screen'), 'title', 'expedition title loaded')
  await uiAct(guild, 'expedition')
  await until(() => uiState(guild, 'connection'), 'Expedition online', 'expedition connected from the title')
  const character = await until(() => guild.evaluate("window.__ridgetopUi?.state?.()?.character?.name"),
    name => /^Scout [A-F0-9]{6}$/.test(name), 'character journal loaded')
  await uiAct(guild, 'journal-open')
  await until(() => uiState(guild, 'screen'), 'journal', 'expedition journal is visible over the course')
  await uiAct(guild, 'journal-close')
  assert.equal(await guild.evaluate("window.__ridgetopUi?.state?.()?.courseDisabled?.ruins"), true)
  const expedition = await open('/?mode=expedition&canvas=1')
  await until(() => uiState(expedition, 'connection'), 'Expedition online', 'second tab connected to the guild')
  await until(() => expedition.evaluate("window.__ridgetopUi?.state?.()?.standings?.length"), 2, 'guild roster shows both players')
  assert.equal(await expedition.evaluate("window.__ridgetopUi?.state?.()?.character?.name"), character)
  await uiAct(expedition, 'pause')
  await uiAct(expedition, 'mode')
  await until(() => uiState(expedition, 'screen'), 'title', 'left expedition for menu')
  await guild.call('Page.bringToFront')
  await until(() => guild.evaluate("window.__ridgetopUi?.state?.()?.standings?.length"), 1, 'guild roster reflects the departure')
  assert.deepEqual([...guild.errors, ...expedition.errors], [])
  await expedition.close()
  await guild.close()
  tabs.length = 0
  console.log('two expedition tabs shared a zone and reused the saved character')

  const benchmark = await open('/benchmark')
  await until(() => benchmark.evaluate("document.readyState === 'complete'"), true, 'benchmark loaded')
  for (const backend of selected) {
    await benchmark.evaluate(`document.querySelector('[name=backend]').value='${backend}';document.querySelector('[name=count]').value='144';document.querySelector('#run').click()`)
    const line = await until(() => status(benchmark, 'result'), result => Boolean(result && result !== 'Running…'), 'benchmark ' + backend, 200)
    assert.ok(line && line.startsWith(rendererNames[backend] + ' ·'), line ?? '')
    if (backend !== 'canvas') assert.match(line, /· 2 draws · 0 bytes uploaded per frame/)
    console.log(line)
  }
  const gpu = selected.find(backend => backend !== 'canvas')
  if (gpu) {
    await benchmark.evaluate(`document.querySelector('[name=backend]').value='${gpu}';document.querySelector('[name=workload]').value='dynamic';document.querySelector('#run').click()`)
    const line = await until(() => status(benchmark, 'result'), result => Boolean(result && result !== 'Running…'), 'dynamic benchmark', 200)
    assert.ok(line)
    assert.match(line, /2 draws · 9,216 bytes uploaded per frame/)
    assert.equal(await benchmark.evaluate("document.querySelector('#download').href.startsWith('blob:')"), true)
    console.log(line)
  }
  assert.deepEqual(benchmark.errors, [])
} finally {
  await Promise.allSettled(tabs.map(tab => tab.close()))
}
