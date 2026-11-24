import { artPalette, artShapes, fitArtRecipe } from 'ridgetop'
import type { ArtRecipe, ArtShape, ArtTone, SpriteSheetImage, Vec3 } from 'ridgetop'

function query<T extends Element>(parent: ParentNode, selector: string): T {
  const el = parent.querySelector<T>(selector)
  if (!el) throw new Error('Missing element ' + selector)
  return el
}

function require2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  return ctx
}

export function createPartEditor(root: HTMLDetailsElement, onApply: (source: ArtRecipe) => void) {
  const select = query<HTMLSelectElement>(root, '#part-name')
  const shape = query<HTMLSelectElement>(root, '#part-shape')
  const tone = query<HTMLSelectElement>(root, '#part-tone')
  const frameSize = query<HTMLInputElement>(root, '#model-frame-size')
  const status = query<HTMLOutputElement>(root, '#part-status')
  shape.replaceChildren(...Object.keys(artShapes).map(key => new Option(key, key)))
  tone.replaceChildren(...Object.keys(artPalette).map(key => new Option(key, key)))
  let source: ArtRecipe | undefined

  function vectorControls(id: string) {
    const area = query(root, '#part-' + id)
    return ['X', 'Y', 'Z'].map(axis => {
      const label = document.createElement('label')
      const input = document.createElement('input')
      input.type = 'number'
      input.step = 'any'
      input.required = true
      input.setAttribute('aria-label', id + ' ' + axis)
      label.append(axis, input)
      area.append(label)
      return input
    })
  }
  const position = vectorControls('position'), scale = vectorControls('scale')
  const rotation = vectorControls('rotation'), angles = ['pitch', 'yaw', 'roll'] as const
  const values = ([x, y, z]: HTMLInputElement[]): Vec3 => [x.valueAsNumber, y.valueAsNumber, z.valueAsNumber]
  function showPart() {
    if (!source) return
    const part = source.parts[select.selectedIndex]
    shape.value = part.shape
    tone.value = part.tone
    for (let i = 0; i < 3; i++) {
      position[i].value = String(part.position[i])
      scale[i].value = String(part.scale[i])
      rotation[i].value = String((part[angles[i]] ?? 0) * 180 / Math.PI)
    }
    frameSize.value = String(source.frameSize)
    status.textContent = ''
  }
  select.onchange = showPart
  query<HTMLFormElement>(root, 'form').onsubmit = event => {
    event.preventDefault()
    if (!source) return
    try {
      const next = structuredClone(source)
      const part = next.parts[select.selectedIndex]
      part.shape = shape.value as ArtShape
      part.tone = tone.value as ArtTone
      part.position = values(position)
      part.scale = values(scale)
      angles.forEach((axis, i) => {
        const degrees = rotation[i].valueAsNumber
        if (degrees !== (part[axis] ?? 0) * 180 / Math.PI) part[axis] = degrees * Math.PI / 180
      })
      next.frameSize = frameSize.valueAsNumber
      const fit = (event.submitter as HTMLElement)?.id === 'fit-model'
      onApply(fit ? fitArtRecipe(next) : next)
      status.textContent = fit ? 'Grounded the model and fitted all eight views.' : 'Updated ' + part.name + '.'
    } catch (error) { status.textContent = error.message }
  }
  return {
    show(recipe?: ArtRecipe) {
      const previous = select.value
      source = recipe
      root.hidden = !recipe
      if (!recipe) return
      select.replaceChildren(...recipe.parts.map(part => new Option(part.name, part.name)))
      if (recipe.parts.some(part => part.name === previous)) select.value = previous
      showPart()
    }
  }
}

export function createViewComparison(root: HTMLDetailsElement) {
  const grid = query(root, '#view-comparison')
  const outline = query<HTMLInputElement>(root, '#silhouette')
  outline.onchange = () => grid.classList.toggle('silhouettes', outline.checked)
  let active = ''
  const cells = ['front', 'right', 'back'].map(angle => {
    const figure = document.createElement('figure')
    const title = document.createElement('figcaption')
    title.textContent = angle[0].toUpperCase() + angle.slice(1)
    const model = document.createElement('canvas')
    model.className = 'comparison-model checker'
    model.setAttribute('aria-label', angle + ' model view')
    const guide = document.createElement('canvas')
    guide.width = guide.height = 256
    guide.className = 'comparison-guide checker'
    guide.setAttribute('aria-label', angle + ' reference')
    const file = document.createElement('input')
    file.type = 'file'
    file.accept = 'image/png,image/jpeg,image/webp'
    file.hidden = true
    const choose = document.createElement('button')
    choose.type = 'button'
    choose.className = 'quiet'
    choose.textContent = 'Add guide'
    choose.setAttribute('aria-label', 'Choose ' + angle + ' reference')
    choose.onclick = () => file.click()
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'quiet'
    remove.textContent = 'Clear'
    remove.setAttribute('aria-label', 'Clear ' + angle + ' reference')
    const message = document.createElement('span')
    message.setAttribute('role', 'status')
    const guides = new Map<string, HTMLCanvasElement>()
    let request = 0
    function refreshGuide() {
      const current = guides.get(active)
      guide.hidden = remove.hidden = !current
      if (current) {
        const context = require2d(guide)
        context.clearRect(0, 0, guide.width, guide.height)
        context.drawImage(current, 0, 0)
      }
      choose.textContent = current ? 'Replace guide' : 'Add guide'
      message.textContent = ''
    }
    file.onchange = async () => {
      const image = file.files?.[0]
      if (!image) return
      file.value = ''
      const ticket = ++request
      const target = active
      let bitmap: ImageBitmap | undefined
      try {
        bitmap = await createImageBitmap(image)
        if (active !== target || ticket !== request) return
        const thumbnail = document.createElement('canvas')
        const size = thumbnail.width = thumbnail.height = guide.width
        const scale = size / Math.max(bitmap.width, bitmap.height)
        const w = bitmap.width * scale, h = bitmap.height * scale
        require2d(thumbnail).drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
        guides.set(target, thumbnail)
        refreshGuide()
      } catch {
        if (ticket === request) message.textContent = 'Could not read this image.'
      } finally { bitmap?.close() }
    }
    remove.onclick = () => {
      request++
      guides.delete(active)
      refreshGuide()
    }
    figure.append(title, model, guide, choose, remove, file, message)
    grid.append(figure)
    return { angle, model, refreshGuide, invalidate() { request++ } }
  })
  return {
    show(key: string, asset: SpriteSheetImage) {
      const { frameWidth: w, frameHeight: h, clips } = asset.manifest
      root.hidden = !clips || !cells.every(({ angle }) => Object.hasOwn(clips, angle))
      const changed = active !== key
      active = key
      for (const cell of cells) {
        if (changed) { cell.invalidate(); cell.refreshGuide() }
        if (root.hidden || !clips) continue
        const clip = clips[cell.angle]
        cell.model.width = w
        cell.model.height = h
        require2d(cell.model).drawImage(asset.image, clip.column * w, (clip.row ?? 0) * h, w, h, 0, 0, w, h)
      }
    }
  }
}
