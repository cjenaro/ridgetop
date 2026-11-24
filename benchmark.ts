import type { Backend, Vec3 } from 'ridgetop'
import { box, color, createLowPolyRenderer, instances, multiply, octahedron, orthographic, view } from 'ridgetop'

const width = 960
const height = 540
const clear = color('22394b')
const tints = ['55b69d', 'c0ed9d', 'ffc477', '73afcf'].map(color)
function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error('Missing element ' + selector)
  return el
}

const config = requireElement<HTMLFormElement>('#config')
const runButton = requireElement<HTMLButtonElement>('#run')
const result = requireElement('#result')
const download = requireElement<HTMLAnchorElement>('#download')
const nextFrame = () => new Promise<number>(resolve => requestAnimationFrame(resolve))

function percentile(values: number[], fraction: number) {
  values.sort((a, b) => a - b)
  return Number(values[Math.ceil(values.length * fraction) - 1].toFixed(2))
}

function parseBackend(value: FormDataEntryValue | null): Backend {
  if (value === 'auto' || value === 'webgpu' || value === 'webgl2' || value === 'canvas') return value
  throw new Error('Unknown renderer backend: ' + String(value))
}

config.addEventListener('submit', async event => {
  event.preventDefault()
  const options = new FormData(config)
  const backend = parseBackend(options.get('backend'))
  const count = Number(options.get('count'))
  const workload = options.get('workload')
  runButton.disabled = true
  if (!download.hidden) URL.revokeObjectURL(download.href)
  download.hidden = true
  result.textContent = 'Running…'
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.style.width = width + 'px'
  canvas.style.maxWidth = 'none'
  requireElement('#viewport').replaceChildren(canvas)
  let renderer
  try {
    renderer = await createLowPolyRenderer(canvas, { backend, pixelRatio: 1 })
    const name = renderer.name
    const batches = [instances(box, count / 2), instances(octahedron, count / 2)]
    const columns = Math.ceil(Math.sqrt(count))
    const camera = multiply(orthographic(columns * 1.7, columns * 1.7 * height / width, 1, 900),
      view([columns * .38, columns * 1.5, columns * 1.1], [0, 0, 0]))
    const positions = Array.from({ length: count }, (_, i): Vec3 => [
      i % columns - columns / 2, (i * 43 % 83) * .013, Math.floor(i / columns) - columns / 2
    ])
    const scale: Vec3 = [.55, .65, .55]
    function populate(yaw: number) {
      for (const batch of batches) batch.clear()
      for (let i = 0; i < count; i++) {
        batches[i % 2].add(positions[i], scale, i * .71 + yaw, tints[i % 4])
      }
    }

    populate(0)
    const cpu: number[] = []
    const frame: number[] = []
    let stats
    const start = await nextFrame()
    let previous = start
    for (;;) {
      const now = await nextFrame()
      if (renderer.name !== name) throw new Error('The selected device was lost during the run.')
      if (document.hidden) throw new Error('Keep the benchmark tab visible.')
      const elapsed = now - start
      const at = performance.now()
      if (workload === 'dynamic') populate(elapsed / 900)
      stats = renderer.render(camera, batches, clear)
      if (elapsed >= 1000) {
        cpu.push(performance.now() - at)
        frame.push(now - previous)
      }
      previous = now
      if (elapsed >= 4000) break
    }
    const measurements = {
      backend: name, workload, width: renderer.canvas.width, height: renderer.canvas.height, count,
      ...stats, samples: frame.length, cpuMedianMs: percentile(cpu, .5),
      cpuP95Ms: percentile(cpu, .95), frameMedianMs: percentile(frame, .5), frameP95Ms: percentile(frame, .95),
      browser: navigator.userAgent
    }
    const { triangles, samples, cpuMedianMs, cpuP95Ms, frameP95Ms, drawCalls, uploadBytes } = measurements
    result.textContent = `${name} · ${triangles.toLocaleString()} triangles · ${drawCalls} draws · ${uploadBytes.toLocaleString()} bytes uploaded per frame · CPU ${cpuMedianMs} ms median / ${cpuP95Ms} ms p95 · frame p95 ${frameP95Ms} ms (${samples} samples)`
    const blob = new Blob([JSON.stringify(measurements, null, 2)], { type: 'application/json' })
    download.href = URL.createObjectURL(blob)
    download.hidden = false
  } catch (error) {
    result.textContent = error.message
  } finally {
    renderer?.dispose()
    runButton.disabled = false
  }
})
