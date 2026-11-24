import { performance } from 'node:perf_hooks'
import { box, createArtKit, createArtRecipe, instances, multiply, orthographic, view } from '../../../../packages/ridgetop/framework/index.ts'
import { fitArtRecipe } from '../../../../packages/ridgetop/framework/art-builder.ts'
import { encodeGlb } from '../../../../packages/ridgetop/framework/export-godot.ts'
import { bakeSpritePixels } from '../../../../packages/ridgetop/framework/low-poly.ts'
import { canvasMeshes } from '../../../../packages/ridgetop/framework/mesh-canvas.ts'
import { encodePng } from '../../../../packages/ridgetop/framework/png.ts'
import { createSpriteSheet } from '../../../../packages/ridgetop/framework/sprite-sheet.ts'
import { verifyBounded } from '../../../../packages/ridgetop/framework/verification.ts'
import { circuits } from '../../../../examples/signal-drift/racing/track.ts'
import { buildCircuitBatches } from '../../../../examples/signal-drift/racing/scene.ts'

const args = process.argv.slice(2)
const onlyIdx = args.indexOf('--only')
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null
const jsonMode = args.includes('--json')

function runCase(name, fn) {
  if (only && name !== only) return null
  fn() // warmup
  const t0 = performance.now()
  fn()
  const ms = Number((performance.now() - t0).toFixed(2))
  return { name, ms }
}

const results = []

// 1. canvasMeshes: 40 moving-camera frames over 500 instances
{
  const fakeCanvas = {
    width: 640,
    height: 360,
    getContext() {
      return {
        fillStyle: '',
        fillRect() {},
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill() {}
      }
    }
  }
  const light = new Float32Array([-0.48, 0.8, 0.36, 0.52])
  const backend = canvasMeshes(fakeCanvas, light)
  const batch = instances(box, 500)
  for (let i = 0; i < 500; i++) {
    batch.add([(i % 25) - 12, (i % 5) * 0.4, Math.floor(i / 25) - 10], [0.6, 0.6, 0.6], i * 0.2, [0.4, 0.7, 0.6, 1])
  }
  const proj = orthographic(32, 18, 0.1, 200)
  const clear = [0.05, 0.08, 0.12, 1]
  const stats = { drawCalls: 0, triangles: 0, instances: 0, uploadBytes: 0, culledBatches: 0 }
  const r = runCase('canvasMeshes', () => {
    for (let f = 0; f < 40; f++) {
      const a = f * 0.12
      const cam = multiply(proj, view([Math.sin(a) * 35, 25, Math.cos(a) * 35], [0, 0, 0]))
      backend.draw(cam, clear, [batch], stats)
    }
  })
  if (r) results.push(r)
}

// 2. bakeSpritePixels: 256px x 5 bakes of starter ranger
{
  const kit = createArtKit()
  const group = kit.group()
  group.add('ranger', [0, 0, 0])
  const model = kit.model('ranger')
  const r = runCase('bakeSpritePixels', () => {
    for (let i = 0; i < 5; i++) {
      bakeSpritePixels(group.batches, { span: model.span, center: [0, model.centerY, 0], frameSize: 256 })
    }
  })
  if (r) results.push(r)
}

// 3. circuit.nearest: 50,000 queries
{
  const route = circuits[0].route
  const r = runCase('circuit.nearest', () => {
    let acc = 0
    for (let i = 0; i < 50000; i++) {
      const x = Math.sin(i * 0.013) * 45
      const z = Math.cos(i * 0.017) * 45
      acc += route.nearest(x, z).distance
    }
    if (acc < 0) throw new Error('unreachable')
  })
  if (r) results.push(r)
}

// 4. instances.add quaternion: 200,000 packs
{
  const batch = instances(box, 1024)
  const q = [0.1, 0.5, 0.2, 0.8]
  const r = runCase('instances.add', () => {
    for (let i = 0; i < 200000; i++) {
      if (batch.count === 1024) batch.clear()
      batch.add([1, 2, 3], [1, 1, 1], q, [0.5, 0.6, 0.7, 1])
    }
  })
  if (r) results.push(r)
}

// 5. verifyBounded: 50,000 transitions
{
  const r = runCase('verifyBounded', () => {
    verifyBounded({
      initial: { x: 0, y: 0 },
      alphabet: [{ dx: 1 }, { dx: -1 }],
      step: (s, a) => ({ x: (s.x + a.dx + 100) % 100, y: s.y + 1 }),
      checks: [{ id: 'ok', test: () => true }],
      depth: 20,
      maxTransitions: 50000
    })
  })
  if (r) results.push(r)
}

// 6. encodePng: 1024x1024 RGBA
{
  const pixels = new Uint8ClampedArray(1024 * 1024 * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i >> 2) & 255
    pixels[i + 1] = (i >> 6) & 255
    pixels[i + 2] = 140
    pixels[i + 3] = 255
  }
  const r = runCase('encodePng', () => {
    const out = encodePng(1024, 1024, pixels)
    if (out.length < 100) throw new Error('bad png')
  })
  if (r) results.push(r)
}

// 7. sprite-sheet: 20 x 200-vertex polygons (512x512)
{
  const poly = Array.from({ length: 200 }, (_, i) => {
    const a = (i / 200) * Math.PI * 2
    const rad = 180 + (i % 7) * 8
    return [256 + Math.cos(a) * rad, 256 + Math.sin(a) * rad]
  })
  const r = runCase('sprite-sheet', () => {
    const sheet = createSpriteSheet(512, 512, 1)
    const frame = sheet.frame(0)
    for (let i = 0; i < 20; i++) frame.polygon(poly, '#efac62')
  })
  if (r) results.push(r)
}

// 8. fitArtRecipe: 50 x ranger
{
  const recipe = createArtRecipe('ranger')
  const r = runCase('fitArtRecipe', () => {
    for (let i = 0; i < 50; i++) fitArtRecipe(recipe)
  })
  if (r) results.push(r)
}

// 9. encodeGlb: 20 x Signal Drift circuit static batches
{
  const batches = buildCircuitBatches(circuits[0]).staticBatches
  const r = runCase('encodeGlb', () => {
    for (let i = 0; i < 20; i++) {
      const out = encodeGlb(batches, 'circuit-0')
      if (out.length < 1000) throw new Error('bad glb')
    }
  })
  if (r) results.push(r)
}

if (only && results.length === 0) {
  console.error(`Unknown benchmark: ${only}`)
  process.exit(1)
}

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2))
} else {
  for (const { name, ms } of results) {
    console.log(`${name.padEnd(20)} ${ms.toFixed(2).padStart(8)} ms`)
  }
}
