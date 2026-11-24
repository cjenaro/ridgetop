import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { bakeSpritePixels, createArtKit, modelFromArtRecipe } from '../../framework/index.ts'
import { encodePng } from '../../framework/png.ts'
import { spritePartVisibility } from '../../framework/art-review.ts'
import { game } from './game.ts'

const [file, outputDirectory, ...extra] = process.argv.slice(2)
if (!file || extra.length || file === '--help') {
  console.log('Usage: npm run preview-art -- <recipe.art.json> [output-directory]')
  process.exitCode = file === '--help' ? 0 : 1
} else {
  const source = JSON.parse(await readFile(file, 'utf8'))
  const model = modelFromArtRecipe(source)
  const kit = createArtKit({ palette: game.palette, models: { subject: model } })
  const group = kit.group()
  group.add('subject', [0,0,0])
  const camera = { span: model.span, center: [0,model.centerY,0] as const }
  const native = bakeSpritePixels(group.batches, { ...camera, frameSize: model.frameSize })
  const size = 128
  const large = model.frameSize === size ? native : bakeSpritePixels(group.batches, { ...camera, frameSize: size })
  const width = 4 * size
  const grid = new Uint8ClampedArray(width * 2 * size * 4)
  for (let y = 0; y < size; y++) {
    const start = y * large.width * 4
    grid.set(large.pixels.subarray(start, start + width*4), y*width*4)
    grid.set(large.pixels.subarray(start + width*4, start + large.width*4), (size+y)*width*4)
  }
  const directory = resolve(outputDirectory ?? join(dirname(file), 'previews'))
  await mkdir(directory, { recursive: true })
  const sheetPath = join(directory, source.name + '-sprites.png')
  const viewsPath = join(directory, source.name + '-views.png')
  const visibilityPath = join(directory, source.name + '-visibility.json')
  await writeFile(sheetPath, encodePng(native.width, native.height, native.pixels))
  await writeFile(viewsPath, encodePng(width, 2*size, grid))
  const visibility = spritePartVisibility(kit, 'subject', model.frameSize ?? native.height)
  await writeFile(visibilityPath, JSON.stringify(visibility, null, 2) + '\n')
  console.log(native.height + ' px directional sprites: ' + sheetPath + '\nEight larger mesh views: ' + viewsPath)
  const hidden = Object.entries(visibility.parts).filter(([,counts]) => counts.every(n => n === 0)).map(([name]) => name)
  if (hidden.length) console.log('Hidden in every direction: ' + hidden.join(', '))
  console.log('Visible pixels per named part: ' + visibilityPath)
}
