import { artBases, artModels, artPalette, bakeSpriteDirections, color, createArtBuilder, createArtKit, createArtRecipe, createSpriteSheet,
  modelFromArtRecipe, spriteColumn, spriteDirections } from './framework/index.ts'
import type { ArtRecipe, ArtTone, SpriteAtlasSource, SpriteClip, SpriteFrame } from './framework/index.ts'
import { chipClips, chipPalette, frameHeight, frameWidth, paintChip, paintScout, scoutClips, suits } from './game/sprite-art.ts'
import { createCarModels, liveryColors } from './racing/car-art.ts'
import { createPartEditor, createViewComparison } from './sprite-model-editor.ts'

type Manifest = SpriteAtlasSource & { clips: Record<string, SpriteClip> }
type Asset = { image: HTMLCanvasElement; manifest: Manifest }
type Template = {
  palette: string[]; roles: string[]; palettes?: string[][]; variant: number; asset?: Asset; recipe?: ArtRecipe
  generate(palette: string[], variant: number): Asset
}

const templates: Record<string, Template> = {
  scout: { palette: [...suits[0]], roles: ['Shadow', 'Shade', 'Suit', 'Light'], palettes: suits, variant: 0,
    generate: palette => pixelAsset('scout', scoutClips, paintScout, palette) },
  chip: { palette: [...chipPalette], roles: ['Shadow', 'Shell', 'Core', 'Contacts'], variant: 0,
    generate: palette => pixelAsset('signal-chip', chipClips, paintChip, palette) },
  car: { palette: [...liveryColors[0]], roles: ['Body', 'Stripe', 'Accent'], palettes: liveryColors, variant: 0,
    generate(palette, variant) {
      const models = createCarModels(palette.map(color))
      models.add({ x: 0, z: 0, yaw: 0, slot: variant }, 0, 0, false)
      return bakeSpriteDirections(models.full, { span: 4.4, center: [0, .55, 0], src: 'rally-car-sheet.png' })
    } }
}
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const art = element<HTMLSelectElement>('art')
const library = document.createElement('optgroup')
library.label = 'Built-in 3D models'
function bakeRecipe(recipe: ArtRecipe) {
  const model = modelFromArtRecipe(recipe)
  return createArtKit({ models: { [recipe.name]: model } }).sprite(recipe.name)
}

function recipeTemplate(recipe: ArtRecipe): Template {
  const roles = [...new Set(recipe.parts.map(p => p.tone))]
  return { recipe, roles, palette: roles.map(role => (recipe.palette[role] ?? artPalette[role]).replace(/^#/, '')),
    variant: 0, generate: () => bakeRecipe(recipe) }
}
for (const name of Object.keys(artModels) as (keyof typeof artModels)[]) {
  templates[name] = recipeTemplate(createArtRecipe(name))
  library.append(new Option(name[0].toUpperCase() + name.slice(1), name))
}
art.append(library)
const forms = document.createElement('optgroup')
forms.label = 'Art builder starter forms'
for (const base of artBases) {
  if (base === 'empty') continue
  const key = 'starter-' + base
  templates[key] = recipeTemplate(createArtBuilder(key, { base }).finish())
  forms.append(new Option(base[0].toUpperCase() + base.slice(1), key))
}
art.append(forms)
const opened = document.createElement('optgroup')
opened.label = 'Opened models'
const clipSelect = element<HTMLSelectElement>('clip')
const frameMs = element<HTMLInputElement>('frame-ms')
const preview = element<HTMLCanvasElement>('preview')
const frames = element('frames')
const play = element<HTMLButtonElement>('play')
const files = element<HTMLInputElement>('import-files')
const recipeFile = element<HTMLInputElement>('recipe-file')
const review = createViewComparison(element<HTMLDetailsElement>('model-review'))
const partEditor = createPartEditor(element<HTMLDetailsElement>('part-editor'), next => {
  const baked = bakeRecipe(next)
  templates[art.value] = { ...recipeTemplate(next), asset: baked }
  showAsset(clipSelect.value, index)
})
let asset: Asset
let imported: Asset
let importRequest = 0
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches
let animation = 0
let index = 0

function canvas(width: number, height: number) {
  const image = document.createElement('canvas')
  image.width = width
  image.height = height
  return image
}

function pixelAsset(name: string, clips: Record<string, SpriteClip>,
  paint: (frame: SpriteFrame, pose: number, palette: string[]) => void, palette: string[]): Asset {
  const columns = Math.max(...Object.values(clips).map(clip => clip.column + clip.frames))
  const sheet = createSpriteSheet(frameWidth, frameHeight, columns)
  for (let column = 0; column < columns; column++) paint(sheet.frame(column), column, palette)
  const image = canvas(sheet.width, sheet.height)
  image.getContext('2d').putImageData(new ImageData(sheet.pixels, sheet.width, sheet.height), 0, 0)
  return { image, manifest: { src: name + '-sheet.png', frameWidth, frameHeight, clips: structuredClone(clips) } }
}

async function importPngs(input: File[]): Promise<Asset> {
  if (input.length > 64) throw new Error('Choose up to 64 PNG frames for a sheet.')
  input.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  const single = input.length === 1
  const columns = single ? 4 : input.length
  let image: HTMLCanvasElement
  let width: number, height: number, rise: number
  for (const [i, file] of input.entries()) {
    if (file.type !== 'image/png' && !/\.png$/i.test(file.name)) throw new Error(file.name + ' must be a PNG.')
    const bitmap = await createImageBitmap(file)
    try {
      if (i === 0) {
        width = bitmap.width
        height = bitmap.height
        rise = single ? Math.max(1, Math.round(height / 24)) : 0
        const sheetWidth = width * columns
        const sheetHeight = height + 2 * rise
        if (Math.max(sheetWidth, sheetHeight) > 8192 || sheetWidth * sheetHeight > 16_777_216) {
          throw new Error('Use smaller frames. A sheet fits within 8192 pixels per side and 16 megapixels.')
        }
        image = canvas(sheetWidth, sheetHeight)
      }
      if (bitmap.width !== width || bitmap.height !== height) {
        throw new Error(file.name + ' must match the first frame (' + width + ' × ' + height + ' px).')
      }
      const ctx = image.getContext('2d')
      if (single) {
        for (const [column, y] of [2 * rise, rise, 0, rise].entries()) ctx.drawImage(bitmap, column * width, y)
      } else ctx.drawImage(bitmap, i * width, 0)
    } finally { bitmap.close() }
  }
  const name = input[0].name.replace(/\.png$/i, '').normalize('NFKD')
    .replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'sprite'
  const clips: Record<string, SpriteClip> = single
    ? { hover: { column: 0, frames: 4, frameMs: 140 }, still: { column: 0, frames: 1, frameMs: 140 } }
    : { loop: { column: 0, frames: columns, frameMs: 100 } }
  return { image, manifest: { src: name + '-sheet.png', frameWidth: width, frameHeight: image.height, clips } }
}

function paintFrame(target: HTMLCanvasElement, column: number, row = 0) {
  const { frameWidth: w, frameHeight: h } = asset.manifest
  const ctx = target.getContext('2d')
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(asset.image, column * w, row * h, w, h, 0, 0, target.width, target.height)
}

function display(frame: number) {
  const clip = asset.manifest.clips[clipSelect.value]
  frames.children[index]?.setAttribute('aria-pressed', 'false')
  index = frame
  frames.children[index]?.setAttribute('aria-pressed', 'true')
  paintFrame(preview, clip.column + index, clip.row ?? 0)
}

function startPlayback(first = 0) {
  cancelAnimationFrame(animation)
  const clip = asset.manifest.clips[clipSelect.value]
  play.disabled = clip.frames === 1
  play.textContent = playing && !play.disabled ? 'Pause' : 'Play'
  display(first)
  if (!playing || play.disabled) return
  const start = performance.now() - first * clip.frameMs
  function advance(now: number) {
    const next = spriteColumn(clip, now - start) - clip.column
    if (index !== next) display(next)
    animation = requestAnimationFrame(advance)
  }
  animation = requestAnimationFrame(advance)
}

function showModelCode() {
  const name = art.value
  const recipe = templates[name]?.recipe
  element('live-model').hidden = !recipe && name !== 'car'
  if (recipe) {
    element('model-help').textContent = 'Save the editable model in game/art/. Assign its file to a role in the starter’s modelFiles, or place it directly with the art kit.'
    element('model-snippet').textContent = [
      "import { createArtKit, modelFromArtRecipe } from '../framework/index.js'",
      'const source = await fetch(' + JSON.stringify('art/' + recipe.name + '.art.json') + ').then(r => r.json())',
      'const art = createArtKit({ models: { [source.name]: modelFromArtRecipe(source) } })',
      'const world = art.group()',
      'world.add(source.name, [0, 0, 0])',
      'renderer.render(camera, world.batches)'
    ].join('\n')
  } else if (name === 'car') {
    const { palette, variant } = templates.car
    element('model-help').textContent = 'The full framework archive includes the live Signal Drift car model in racing/car-art.js after building.'
    element('model-snippet').textContent = [
      "import { color } from './framework/index.js'",
      "import { createCarModels } from './racing/car-art.js'",
      'const cars = createCarModels(' + JSON.stringify(palette) + '.map(color))',
      'cars.add({ x: 0, z: 0, yaw: 0, slot: ' + variant + ' }, 0, 0, false)',
      'renderer.render(camera, cars.full)'
    ].join('\n')
  }
}

function showClip(first = 0) {
  const clip = asset.manifest.clips[clipSelect.value]
  const { frameWidth: w, frameHeight: h } = asset.manifest
  const path = 'art/' + asset.manifest.src.replace(/\.png$/, '.json')
  element('snippet').textContent = [
    "import { createSpriteAtlas } from '../framework/index.js'",
    'const atlas = await createSpriteAtlas(layer, ' + JSON.stringify(path) + ')',
    '', '// Draw each frame using elapsed milliseconds.',
    'atlas.begin(stage)',
    'atlas.drawClip(' + JSON.stringify(clipSelect.value) + ', now, [0, 0], { height: 0.2 })'
  ].join('\n')
  showModelCode()
  element('clip-name').textContent = clipSelect.value
  element('clip-details').textContent = w + ' × ' + h + ' px · ' + clip.frames + (clip.frames === 1 ? ' frame' : ' frames')
  frameMs.value = String(clip.frameMs)
  preview.width = w
  preview.height = h
  frames.replaceChildren()
  const scale = Math.min(1, 64 / Math.max(w, h))
  for (let frame = 0; frame < clip.frames; frame++) {
    const thumbnail = canvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)))
    paintFrame(thumbnail, clip.column + frame, clip.row ?? 0)
    const button = document.createElement('button')
    button.className = 'checker'
    const direction = clipSelect.value === 'turntable' ? spriteDirections[frame] : undefined
    button.setAttribute('aria-label', direction ?? ('Frame ' + (frame + 1)))
    if (direction) button.title = direction
    button.setAttribute('aria-pressed', 'false')
    button.append(thumbnail)
    button.onclick = () => { playing = false; startPlayback(frame) }
    frames.append(button)
  }
  startPlayback(first)
}

function recolor(template: Template) {
  // Keep the edited clip timings and current pose while replacing the artwork.
  asset.image = template.generate(template.palette, template.variant).image
  review.show(art.value, asset)
  showClip(index)
}

let pendingRecolor = 0
function scheduleRecolor(template: Template) {
  if (pendingRecolor) return
  pendingRecolor = requestAnimationFrame(() => {
    pendingRecolor = 0
    if (templates[art.value] === template) recolor(template)
  })
}

function showPalette(template: Template | undefined) {
  element('colors').hidden = !template
  element('next-palette').hidden = !template?.palettes
  const swatches = element('swatches')
  swatches.replaceChildren()
  template?.roles.forEach((role, i) => {
    const input = document.createElement('input')
    input.type = 'color'
    input.value = '#' + template.palette[i]
    input.oninput = () => {
      template.palette[i] = input.value.slice(1)
      if (template.recipe) template.recipe.palette[role as ArtTone] = input.value
      scheduleRecolor(template)
    }
    const label = document.createElement('label')
    label.append(input, role)
    swatches.append(label)
  })
}

function showAsset(preferredClip?: string, first = 0) {
  const template = templates[art.value]
  asset = template ? (template.asset ??= template.generate(template.palette, template.variant)) : imported
  clipSelect.replaceChildren(...Object.keys(asset.manifest.clips).map(name => new Option(name, name)))
  if (art.value === 'scout') clipSelect.value = 'run'
  if (preferredClip && Object.hasOwn(asset.manifest.clips, preferredClip)) clipSelect.value = preferredClip
  element('sheet-details').textContent = 'Full sheet · ' + asset.image.width + ' × ' + asset.image.height + ' px'
  showPalette(template)
  element('save-recipe').hidden = !template?.recipe
  partEditor.show(template?.recipe)
  review.show(art.value, asset)
  showClip(Math.min(first, asset.manifest.clips[clipSelect.value].frames - 1))
}

art.onchange = () => { importRequest++; element('import-status').textContent = ''; showAsset() }
clipSelect.onchange = () => showClip()
play.onclick = () => { playing = !playing; startPlayback(index) }
frameMs.onchange = () => {
  const clip = asset.manifest.clips[clipSelect.value]
  if (frameMs.checkValidity() && Number.isSafeInteger(frameMs.valueAsNumber)) {
    clip.frameMs = frameMs.valueAsNumber
    const recipe = templates[art.value]?.recipe
    if (recipe) (recipe.timings ??= {})[clipSelect.value] = clip.frameMs
  }
  frameMs.value = String(clip.frameMs)
  startPlayback(index)
}
element('next-palette').onclick = () => {
  const template = templates[art.value]
  template.variant = (template.variant + 1) % template.palettes.length
  template.palette = [...template.palettes[template.variant]]
  showPalette(template)
  recolor(template)
}
files.onchange = async () => {
  const input = Array.from(files.files)
  if (!input.length) return
  const request = ++importRequest
  const status = element('import-status')
  status.textContent = 'Reading artwork…'
  try {
    const result = await importPngs(input)
    if (request !== importRequest) return
    imported = result
    const option = art.querySelector<HTMLOptionElement>('[value=imported]') ?? new Option('', 'imported')
    option.text = input.length === 1 ? input[0].name : input.length + ' imported frames'
    art.add(option)
    art.value = 'imported'
    showAsset()
    status.textContent = ''
  } catch (error) {
    if (request === importRequest) status.textContent = 'Could not import artwork. ' + error.message
  } finally {
    if (request === importRequest) files.value = ''
  }
}

element('open-model').onclick = () => recipeFile.click()
recipeFile.onchange = async () => {
  const file = recipeFile.files?.[0]
  if (!file) return
  recipeFile.value = ''
  const request = ++importRequest
  const status = element('import-status')
  try {
    const recipe: ArtRecipe = JSON.parse(await file.text())
    if (request !== importRequest) return
    const baked = bakeRecipe(recipe)
    const key = 'recipe/' + recipe.name
    if (!templates[key]) opened.append(new Option(recipe.name, key))
    if (!opened.parentNode) art.append(opened)
    templates[key] = { ...recipeTemplate(recipe), asset: baked }
    art.value = key
    showAsset()
    status.textContent = ''
  } catch (error) {
    if (request === importRequest) status.textContent = 'Could not open model. ' + error.message
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
element('save-png').onclick = () => {
  const filename = asset.manifest.src
  asset.image.toBlob(blob => {
    if (blob) download(blob, filename)
    else element('import-status').textContent = 'Could not encode the sprite sheet.'
  }, 'image/png')
}
element('save-json').onclick = () => {
  download(new Blob([JSON.stringify(asset.manifest, null, 2) + '\n'], { type: 'application/json' }),
    asset.manifest.src.replace(/\.png$/, '.json'))
}
element('save-recipe').onclick = () => {
  const recipe = templates[art.value].recipe
  download(new Blob([JSON.stringify(recipe, null, 2) + '\n'], { type: 'application/json' }), recipe.name + '.art.json')
}
showAsset()
