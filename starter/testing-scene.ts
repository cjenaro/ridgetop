import { createArtKit, modelFromArtRecipe, projectPoint, spriteColumn, spriteDirections } from '../framework/index.ts'
import type { ArtRecipe, Matrix } from '../framework/index.ts'
import type { createSpriteAtlas } from '../framework/sprites.ts'
import { modelReviewFrame, partName, pickArtScene, pickId, reviewCanvas } from '../framework/art-review.ts'
import type { ArtPin, ArtView, ReviewKit, ReviewObject } from '../framework/art-review.ts'

type Atlas = Awaited<ReturnType<typeof createSpriteAtlas>>
export interface InspectGame {
  kit: ReviewKit
  frame(): { objects: ReviewObject[]; matrix: Matrix; spanY: number; now: number; sprite: boolean; surface: HTMLCanvasElement }
  hud: HTMLCanvasElement; pickup: string
  hudRect?(): { x: number; y: number; width: number; height: number } | undefined
  source(name: string): { path: string; file: string | null; recipe?: ArtRecipe; base: ArtRecipe | null }
  sprite(name: string): { manifest: string; clip: string } | undefined
  atlas(name: string): Promise<Atlas>
  pause(on: boolean): void
  snapshot(): unknown
  restore(value: unknown): Promise<void>
}
const unit = (n: number) => Math.max(0, Math.min(1, n))
export function measurePoint(canvas: HTMLCanvasElement, event: PointerEvent | MouseEvent) {
  const rect = canvas.getBoundingClientRect()
  return [unit((event.clientX - rect.left) / rect.width), unit((event.clientY - rect.top) / rect.height)] as const
}
export function reviewScene(game: InspectGame) {
  function hudBox(surface: HTMLCanvasElement) {
    const domRect = game.hud.getBoundingClientRect()
    if (domRect.width > 0 && domRect.height > 0) return domRect
    const layout = game.hudRect?.()
    const base = surface.getBoundingClientRect()
    if (layout && layout.width > 0 && layout.height > 0) {
      return { left: base.left + layout.x, top: base.top + layout.y, width: layout.width, height: layout.height }
    }
    return { left: base.left, top: base.top, width: Math.max(1, game.hud.width), height: Math.max(1, game.hud.height) }
  }
  async function describe(obj: ReviewObject, hud: boolean) {
    const scene = game.frame(), model = game.kit.model(obj.name)
    const canvas = hud ? game.hud : scene.surface
    const { width: w, height: h } = hud ? hudBox(scene.surface) : canvas.getBoundingClientRect()
    const surface = hud ? 'hud' : scene.sprite ? 'sprite' : 'model'
    const point = hud ? [0, 0] : projectPoint(scene.matrix, obj.x, (obj.y ?? 0) + model.centerY, obj.z)
    const view: ArtView = { asset: obj.name, instance: hud ? 'inventory' : obj.id, surface, source: game.source(obj.name).path,
      position: [obj.x, obj.y ?? 0, obj.z], yaw: obj.yaw ?? 0, elevation: Math.PI / 6, centerY: model.centerY, span: model.span,
      height: hud ? h : h * model.span / scene.spanY, width: 0 }
    view.width = view.height
    if (surface !== 'model') {
      const atlas = await game.atlas(obj.name), override = game.sprite(obj.name)
      const direction = (Math.round(-view.yaw * 4 / Math.PI) % 8 + 8) % 8
      view.clip = override?.clip ?? (hud ? 'front-right' : spriteDirections[direction])
      const clip = atlas.clips[view.clip]
      view.column = spriteColumn(clip, hud ? 0 : scene.now)
      view.row = clip.row ?? 0
      view.frame = view.column - clip.column
      view.handDrawn = Boolean(override)
      if (override) {
        view.source = override.manifest
        const sheet = new URL(atlas.src, location.href), page = new URL('.', location.href)
        view.sheet = sheet.href.startsWith(page.href) ? sheet.href.slice(page.href.length) : sheet.href
      }
      view.width = hud ? w : view.height * atlas.frameWidth / atlas.frameHeight
    }
    const cx = Math.round((point[0] + 1) * canvas.width / 2) * w / canvas.width
    const cy = Math.round((1 - point[1]) * canvas.height / 2) * h / canvas.height
    return { view, left: cx - view.width / 2, top: cy - view.height / 2 }
  }
  function hudObject(): ReviewObject { return { id: 'inventory', name: game.pickup, x: 0, z: 0 } }
  function locate(id: string) {
    const hud = id === 'inventory', obj = hud ? hudObject() : game.frame().objects.find(o => o.id === id)
    if (obj) return describe(obj, hud)
  }
  async function image(v: ArtView, ids = false, draft?: ArtRecipe) {
    const kit = draft ? createArtKit({ palette: game.kit.palette, models: { [v.asset]: modelFromArtRecipe(draft) } }) : game.kit
    if (v.surface === 'model') return modelReviewFrame(kit, v, 384, ids)
    const scale = 384 / Math.max(v.width, v.height)
    const canvas = reviewCanvas(v.width * scale, v.height * scale), ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    if (v.surface === 'hud' && !ids && !draft) {
      ctx.drawImage(game.hud, 0, 0, canvas.width, canvas.height)
      return canvas
    }
    let raw: HTMLCanvasElement
    if (ids || (draft && !v.handDrawn)) {
      if (v.handDrawn) throw new Error('This frame uses hand-drawn pixels.')
      raw = modelReviewFrame(kit, v, kit.model(v.asset).frameSize ?? 64, ids)
    } else {
      const atlas = await game.atlas(v.asset), clip = atlas.clips[v.clip]
      if (!clip || v.frame >= clip.frames) throw new Error('The original animation frame is missing from the current asset.')
      raw = atlas.frame(clip.column + v.frame, clip.row ?? 0)
    }
    const h = canvas.height * (v.surface === 'hud' ? 1.1 : 1), w = h * raw.width / raw.height
    ctx.drawImage(raw, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
    return canvas
  }
  async function partAt(v: ArtView, u: number, y: number, draft?: ArtRecipe) {
    if (v.handDrawn) return undefined
    const index = pickId(await image(v, true, draft), u, y) - 1
    const parts = draft?.parts ?? game.kit.model(v.asset).parts
    return parts[index] ? parts[index].name ?? 'part-' + (index + 1) : undefined
  }
  function editSource(v: ArtView, scope: ArtPin['scope']) {
    if (scope === 'hud') return 'main.js#inventory'
    if (scope === 'instance') return v.instance === 'inventory' || v.instance === 'pickup-effect' ? 'main.js' : 'game.js#game.map'
    if (scope === 'sprite' && !v.handDrawn) return 'game.js#sprites'
    return v.source
  }
  function pin(view: ArtView, u: number, v: number, part?: string): ArtPin {
    const scope = view.surface === 'hud' ? 'hud' : view.handDrawn ? 'sprite' : 'asset'
    return { view, scope, editSource: editSource(view, scope),
      region: [u, v, u, v], ...(part ? { part } : {}) }
  }
  async function select(id: string) {
    const subject = await locate(id)
    if (!subject) throw new Error('This object is no longer in the scene.')
    return pin(subject.view, .5, .5)
  }
  async function pick(u: number, v: number, hud: boolean) {
    const scene = game.frame(), canvas = hud ? game.hud : scene.surface
    const rect = hud ? hudBox(scene.surface) : canvas.getBoundingClientRect(), x = u * rect.width, y = v * rect.height
    if (!hud && !scene.sprite) {
      const hit = pickArtScene(game.kit, scene.objects, scene.matrix, canvas.width, canvas.height, u, v)
      if (!hit) return
      const { view, left, top } = await describe(hit.object, false)
      return pin(view, unit((x - left) / view.width), unit((y - top) / view.height), hit.part)
    }
    // Reverse the actual painter order and sample alpha. Transparent corners pass through to the item behind.
    for (const obj of hud ? [hudObject()] : [...scene.objects].reverse()) {
      const { view, left, top } = await describe(obj, hud)
      const ux = (x - left) / view.width, vy = (y - top) / view.height
      if (ux < 0 || ux >= 1 || vy < 0 || vy >= 1) continue
      const pixels = await image(view)
      if (!pixels.getContext('2d').getImageData(Math.floor(ux * pixels.width), Math.floor(vy * pixels.height), 1, 1).data[3]) continue
      return pin(view, ux, vy, await partAt(view, ux, vy))
    }
  }
  return { select, pick, locate, image, partAt, editSource, parts: (name: string) => game.kit.model(name).parts.map(partName) }
}
