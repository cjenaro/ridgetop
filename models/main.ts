import { color, createArtKit, createLowPolyRenderer, modelFromArtRecipe, multiply, orthographic, view } from '../framework/index.ts'
import type { Backend, Color, InstanceBatch } from '../framework/index.ts'
import { createCarModels } from '../racing/car-art.ts'
import { createHeadland } from './headland.ts'

type Study = {
  title: string; category: string; description: string; batches: readonly InstanceBatch[]
  span: number; centerY: number; yaw: number; pitch: number; background: Color
}
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

function recipeStudy(source: unknown, title: string, description: string): Study {
  const model = modelFromArtRecipe(source)
  const group = createArtKit({ models: { subject: model } }).group()
  group.add('subject', [0, 0, 0])
  return { title, category: 'Model recipe', description, batches: group.batches, span: model.span,
    centerY: model.centerY, yaw: .58, pitch: .18, background: color('e6ece2') }
}

async function rangerStudy() {
  const source = element('rain-source')
  let json = source.textContent.trim()
  if (!json) {
    const response = await fetch(source.dataset.src)
    if (!response.ok) throw new Error('Could not load the ranger recipe.')
    json = await response.text()
  }
  return { ...recipeStudy(JSON.parse(json), 'Raincoat ranger', 'Orbit the ranger to see the brim, the lip of the storm collar, and the roll-top pack on its back.'), category: 'Character' }
}

async function start() {
  const orbit = element('orbit'), turn = element<HTMLButtonElement>('turn')
  const choiceButtons = [...element('choices').querySelectorAll('button')]
  const zoomIn = element<HTMLButtonElement>('zoom-in'), zoomOut = element<HTMLButtonElement>('zoom-out')
  const params = new URLSearchParams(location.search)
  const renderer = await createLowPolyRenderer(element<HTMLCanvasElement>('model-canvas'), {
    backend: (params.get('renderer') ?? 'auto') as Backend, canvasDepth: true,
    lighting: { direction: [-.55, .88, .62], ambient: .57 }
  })
  const car = createCarModels([color('dd674b'), color('ffe3aa'), color('843e42')])
  car.add({ x: 0, z: 0, yaw: 0, slot: 1 }, 0, 0, false)
  const studies = new Map<string, Study>([
    ['headland', { title: 'Headland lighthouse', category: 'Environment',
      description: 'A striped watchtower above a cut-rock shoreline, with a keeper’s cottage and timber landing.',
      batches: createHeadland(), span: 5.40, centerY: .67, yaw: .53, pitch: .43, background: color('e4ece5') }],
    ['rally', { title: 'Signal Drift rally car', category: 'Vehicle',
      description: 'The car from Signal Drift. Circle it to see the spoiler, wheel hubs, and two-tone bodywork.',
      batches: car.full, span: 3.75, centerY: .56, yaw: .83, pitch: .34, background: color('f0e8df') }]
  ])

  let active: Study, yaw = 0, pitch = 0, zoom = 1
  let spinning = false, movingPointer: number | undefined, lastX = 0, lastY = 0
  let frame = 0, lastTime = 0, request = 0
  const redraw = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(draw) }
  function draw(now: number) {
    frame = 0
    if (!active || !orbit.clientWidth || !orbit.clientHeight) return
    if (spinning && lastTime) yaw += Math.min(now - lastTime, 75) * .00055
    lastTime = now
    const aspect = orbit.clientWidth / orbit.clientHeight
    const height = active.span / (Math.min(1, aspect) * zoom)
    const distance = active.span * 3
    const horizontal = distance * Math.cos(pitch)
    const camera = view([horizontal * Math.sin(yaw), active.centerY + distance * Math.sin(pitch), horizontal * Math.cos(yaw)], [0, active.centerY, 0])
    const projection = orthographic(height * aspect, height, active.span / 100, distance * 2)
    const stats = renderer.render(multiply(projection, camera), active.batches, active.background)
    const label = stats.triangles.toLocaleString() + ' triangles · ' + renderer.name
    if (element('stats').textContent !== label) element('stats').textContent = label
    if (spinning) redraw()
  }
  function spin(on: boolean) {
    spinning = on
    lastTime = 0
    turn.setAttribute('aria-pressed', String(on))
    redraw()
  }
  function setZoom(value: number) {
    zoom = clamp(value, .65, 2)
    zoomIn.disabled = zoom >= 2
    zoomOut.disabled = zoom <= .65
    redraw()
  }
  function reset() {
    if (!active) return
    yaw = active.yaw
    pitch = active.pitch
    setZoom(1)
    spin(false)
  }
  function show(id: string, study: Study) {
    active = study
    element('model-title').textContent = study.title
    element('kind').textContent = study.category
    element('model-description').textContent = study.description
    element('notice').textContent = ''
    for (const button of choiceButtons) button.setAttribute('aria-pressed', String(button.id === id))
    reset()
  }
  let rangerPending: Promise<Study> | undefined
  async function select(id: string) {
    const current = ++request
    try {
      if (id === 'ranger' && !studies.has(id)) {
        rangerPending ??= rangerStudy().then(study => { studies.set(id, study); return study })
          .finally(() => { rangerPending = undefined })
        await rangerPending
      }
      if (current === request && studies.has(id)) show(id, studies.get(id))
    } catch (error) { if (current === request) element('notice').textContent = error.message }
  }
  for (const button of choiceButtons) button.onclick = () => select(button.id)
  const fileInput = element<HTMLInputElement>('source-file')
  element('open').onclick = () => fileInput.click()
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    fileInput.value = ''
    const current = ++request
    try {
      const source = JSON.parse(await file.text())
      if (current !== request) return
      const study = recipeStudy(source, source?.name, 'Live geometry from ' + file.name + '.')
      for (const batch of studies.get('custom')?.batches ?? []) renderer.release(batch)
      studies.set('custom', study)
      element('custom').hidden = false
      element('custom').textContent = study.title
      show('custom', study)
    } catch (error) { if (current === request) element('notice').textContent = 'Could not open model. ' + error.message }
  }

  turn.onclick = () => spin(!spinning)
  element('reset').onclick = reset
  zoomIn.onclick = () => setZoom(zoom * 1.18)
  zoomOut.onclick = () => setZoom(zoom / 1.18)
  function rotate(dx: number, dy: number) {
    spin(false)
    yaw += dx
    pitch = clamp(pitch + dy, -1.25, 1.4)
  }
  orbit.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary) return
    orbit.focus({ preventScroll: true })
    movingPointer = event.pointerId
    lastX = event.clientX
    lastY = event.clientY
    orbit.setPointerCapture(event.pointerId)
    spin(false)
  }
  orbit.onpointermove = event => {
    if (event.pointerId !== movingPointer) return
    rotate((lastX - event.clientX) * .009, (event.clientY - lastY) * .007)
    lastX = event.clientX
    lastY = event.clientY
  }
  orbit.onlostpointercapture = () => { movingPointer = undefined }
  orbit.onkeydown = event => {
    switch (event.key) {
      case 'ArrowLeft': rotate(-.15, 0); break
      case 'ArrowRight': rotate(.15, 0); break
      case 'ArrowUp': rotate(0, .10); break
      case 'ArrowDown': rotate(0, -.10); break
      case '+': case '=': setZoom(zoom * 1.18); break
      case '-': setZoom(zoom / 1.18); break
      case 'Home': reset(); break
      default: return
    }
    event.preventDefault()
  }
  const resize = new ResizeObserver(redraw)
  resize.observe(orbit)
  // Ridgetop replaces the canvas if a device is lost. Redraw even when the model is stationary.
  const replacement = new MutationObserver(redraw)
  replacement.observe(orbit, { childList: true })
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame)
    frame = lastTime = 0
    redraw()
  })
  window.addEventListener('pagehide', event => {
    if (event.persisted) return
    cancelAnimationFrame(frame)
    resize.disconnect()
    replacement.disconnect()
    renderer.dispose()
  })
  await select(['ranger', 'rally'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'headland')
}

start().catch(error => {
  element('stats').textContent = 'Renderer unavailable'
  element('notice').textContent = error.message
})
