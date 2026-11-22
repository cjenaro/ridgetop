import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createGameHost } from '../../framework/host.ts'
import { game } from '../../starter/game.ts'
import { openTab, until } from '../../tools/browser-driver.ts'

// This function runs inside Chromium. Both sheets use the framework's public art API.
function renderAsset(api, palette, id, source, checkFraming) {
  function frameMargins(sheet) {
    const size = sheet.height
    const pixels = sheet.getContext('2d').getImageData(0, 0, sheet.width, size).data
    const margins = []
    for (let frame = 0; frame < sheet.width / size; frame++) {
      let margin = Infinity
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (pixels[4 * (y * sheet.width + frame * size + x) + 3]) {
            margin = Math.min(margin, x, y, size - 1 - x, size - 1 - y)
          }
        }
      }
      margins.push(Number.isFinite(margin) ? margin : null)
    }
    return margins
  }
  const model = api.modelFromArtRecipe(source)
  const kit = api.createArtKit({ palette, models: { subject: model } })
  const group = kit.group()
  group.add('subject', [0, 0, 0])
  const center = [0, model.centerY, 0]
  const small = kit.sprite('subject').image
  const big = api.bakeSpriteDirections(group.batches, { span: model.span, center, frameSize: 128 }).image
  const size = small.height
  const margins = frameMargins(small)
  let ground = Infinity, triangles = 0
  for (const part of model.parts) {
    triangles += part.mesh.vertexCount / 3
    for (let i = 1; i < part.mesh.data.length; i += 6) {
      ground = Math.min(ground, part.position[1] + part.scale[1] * part.mesh.data[i])
    }
  }
  const failures = []
  if (id !== source.name) failures.push('recipe ID')
  if (size !== 32) failures.push('frame size')
  if (Object.keys(source.palette).length) failures.push('palette override')
  if (model.parts.length > 32) failures.push('part budget')
  if (margins.includes(null)) failures.push('empty direction')
  if (margins.includes(0)) failures.push('sprite touches frame edge')
  if (Math.abs(ground) > .05 * model.span) failures.push('ground offset')
  const stats = { failures, parts: model.parts.length, triangles, minY: ground, span: model.span, margins }
  const sheets = { small: small.toDataURL(), big: big.toDataURL() }
  if (checkFraming && margins.includes(0)) {
    let span = model.span
    let adjustedMargins = margins
    let steps = 0
    while (adjustedMargins.includes(0) && steps < 24) {
      span *= 1.05
      steps++
      const sheet = api.bakeSpriteDirections(group.batches, { span, center, frameSize: size }).image
      adjustedMargins = frameMargins(sheet)
      sheets.fit = sheet.toDataURL()
    }
    stats.framingTrial = { span, steps, margins: adjustedMargins }
  }
  return { sheets, stats }
}

const [sourceDir, outputDir, option] = process.argv.slice(2)
if (!sourceDir || !outputDir || (option && option !== '--check-framing')) {
  throw new Error('Usage: node benchmarks/asset-authoring/render.mjs <recipe-directory> <output-directory> [--check-framing]')
}
const root = new URL('../../starter/', import.meta.url)
const host = createGameHost({ root, files: [], handle(_req, res, path) {
  if (path !== '/') return false
  res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Ridgetop art render</title>')
  return true
} })
await new Promise(resolve => host.server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + host.server.address().port
let tab
try {
  tab = await openTab(origin)
  await until(() => tab.evaluate('location.origin'), origin, 'render page loaded')
  await mkdir(outputDir, { recursive: true })
  const stats = {}
  for (const file of (await readdir(sourceDir)).filter(f => f.endsWith('.art.json')).sort()) {
    const key = file.slice(0, -'.art.json'.length)
    const id = key.split('__')[0]
    let source
    try { source = JSON.parse(await readFile(join(sourceDir, file), 'utf8')) }
    catch { stats[key] = { failures: ['invalid JSON'] }; continue }
    const result = await tab.evaluate(`(async () => {
      const api = await import('/framework/index.js')
      try { return (${renderAsset})(api, ${JSON.stringify(game.palette)}, ${JSON.stringify(id)}, ${JSON.stringify(source)}, ${option === '--check-framing'}) }
      catch (error) { return { stats: { failures: [error.message] } } }
    })()`)
    stats[key] = result.stats
    for (const [name, url] of Object.entries(result.sheets ?? {})) {
      await writeFile(join(outputDir, key + '.' + name + '.png'), Buffer.from(url.split(',')[1], 'base64'))
    }
  }
  await writeFile(join(outputDir, 'metrics.json'), JSON.stringify(stats, null, 2) + '\n')
  if (tab.errors.length) throw new Error(tab.errors.join('\n'))
  console.log('Inspected ' + Object.keys(stats).length + ' recipes.')
} finally {
  try { if (tab) await tab.close() } finally { await host.close() }
}
