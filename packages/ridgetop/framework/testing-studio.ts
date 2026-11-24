import { artModels, createArtKit, createArtRecipe } from './art.ts'
import { fitArtRecipe } from './art-builder.ts'
import { artPalette, artShapes, modelFromArtRecipe } from './art-recipe.ts'
import type { ArtRecipe, ArtShape, ArtTone } from './art-recipe.ts'
import { modelReviewFrame, pickRenderedScene, pickSpriteDraws } from './art-review.ts'
import type { ArtPin, ArtReview, ArtView, PickedSpriteDraw, ReviewScope, ReviewSurface } from './art-review.ts'
import { multiply, orthographic, view } from './geometry.ts'
import { bakeSpriteDirections, renderMeshFrame } from './low-poly.ts'
import {
  findRegisteredArtModel, getHudRegions, getLastFrame, getLastSpriteDraws, getTestingHooks,
  isTestingPaused, onTestingHooksRegistered, onTestingPause, recognizeAssetFromPick, setTestingActive, setTestingPaused
} from './testing-runtime.ts'
import type { ArtSourceInfo, HudRegion, RecognizedAsset, SpriteDrawRecord } from './testing-runtime.ts'
import type { InstanceBatch, Vec3 } from './types.ts'

interface ReviewEntry {
  note: ArtReview
  revision: string
}

interface Selection {
  surface: ReviewSurface
  asset: string
  instanceId: string
  source: string
  part?: string
  scope: ReviewScope
  region: [number, number, number, number]
  recognized?: RecognizedAsset
  spriteHit?: PickedSpriteDraw
  hudRegion?: HudRegion
  screenRect?: { left: number; top: number; width: number; height: number }
  artSource?: ArtSourceInfo
  originalRecipe?: ArtRecipe
  draftRecipe?: ArtRecipe
  previewYaw: number
  previewElevation: number
  spriteClip?: string
  spriteFrame: number
  spriteFrameMs: number
  spriteImport?: HTMLCanvasElement
  savedView?: ArtView
}

const REVIEWS_API = '/__testing/reviews'
const RECIPE_API = '/__testing/recipe'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

function isBuiltInArtModel(name: string): name is keyof typeof artModels {
  return Object.hasOwn(artModels, name)
}

function isArtShape(value: string): value is ArtShape {
  return Object.hasOwn(artShapes, value)
}

function isArtTone(value: string): value is ArtTone {
  return Object.hasOwn(artPalette, value)
}

function isReviewScope(value: string): value is ReviewScope {
  return value === 'asset' || value === 'instance' || value === 'sprite' || value === 'hud'
}

function isReviewEntry(value: unknown): value is ReviewEntry {
  return (
    isRecord(value) &&
    typeof value.revision === 'string' &&
    isRecord(value.note) &&
    typeof value.note.id === 'string' &&
    typeof value.note.comment === 'string' &&
    isRecord(value.note.target) &&
    isRecord(value.note.target.view) &&
    Array.isArray(value.note.replies)
  )
}

function parseReviewEntry(value: unknown): ReviewEntry {
  if (!isReviewEntry(value)) throw new Error('Unexpected review response from server.')
  return value
}

function parseReviewList(value: unknown): { entries: ReviewEntry[]; errors: string[] } {
  if (!isRecord(value) || !Array.isArray(value.entries) || !Array.isArray(value.errors)) {
    throw new Error('Unexpected reviews list response from server.')
  }
  const entries = value.entries.filter(isReviewEntry)
  const errors = value.errors.filter((item): item is string => typeof item === 'string')
  return { entries, errors }
}

async function apiJson(url: string, method = 'GET', body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    cache: 'no-store',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const data: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = isRecord(data) && typeof data.error === 'string' ? data.error : `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: { className?: string; text?: string; type?: string; title?: string; id?: string },
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (attrs?.className) node.className = attrs.className
  if (attrs?.text !== undefined) node.textContent = attrs.text
  if (attrs?.id) node.id = attrs.id
  if (attrs?.title) node.title = attrs.title
  if (attrs?.type) {
    if (node instanceof HTMLInputElement) node.type = attrs.type
    else if (node instanceof HTMLButtonElement && (attrs.type === 'button' || attrs.type === 'submit' || attrs.type === 'reset')) {
      node.type = attrs.type
    } else if ('type' in node) {
      node.setAttribute('type', attrs.type)
    }
  }
  if (children.length) node.append(...children)
  return node
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function measureNormalized(target: HTMLElement, event: PointerEvent): [number, number] {
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return [0.5, 0.5]
  return [
    Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  ]
}

function drawPinOverlay(canvas: HTMLCanvasElement, region: readonly [number, number, number, number]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const [x0, y0, x1, y1] = region
  const w = canvas.width, h = canvas.height
  ctx.save()
  ctx.strokeStyle = '#ffcc76'
  ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) / 96))
  if (Math.abs(x1 - x0) > 0.005 || Math.abs(y1 - y0) > 0.005) {
    ctx.strokeRect(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h)
  } else {
    ctx.beginPath()
    ctx.arc(x0 * w, y0 * h, Math.max(5, Math.round(Math.min(w, h) / 28)), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function lookupArtSource(asset: string): ArtSourceInfo | undefined {
  for (const hook of getTestingHooks()) {
    const info = hook.getArtSource?.(asset)
    if (info) return info
  }
  const found = findRegisteredArtModel(asset)
  if (found) {
    const recipe = found.kit.recipeFor?.(asset)
    return {
      path: found.kit.sourceSite ?? `art/overrides.json#${asset}`,
      file: null,
      base: null,
      recipe
    }
  }
  if (isBuiltInArtModel(asset)) {
    return {
      path: `art/overrides.json#${asset}`,
      file: null,
      base: null,
      recipe: createArtRecipe(asset)
    }
  }
  return undefined
}

function resolveSnapshot(): unknown {
  for (const hook of getTestingHooks()) {
    if (hook.snapshot) {
      try { return hook.snapshot() } catch { /* Fall back to default scene metadata. */ }
    }
  }
  return { url: location.pathname + location.search, capturedAt: new Date().toISOString() }
}

async function restoreSnapshot(scene: unknown): Promise<void> {
  for (const hook of getTestingHooks()) {
    if (hook.restore) await hook.restore(scene)
  }
}

function renderRecognizedPreview(recognized: RecognizedAsset, size = 256, yaw = 0.55, elevation = 0.42): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const frame = getLastFrame()
  if (!frame) return canvas

  // Render the isolated recognized assembly with an auto-fitted orthographic camera so it is always crisp
  // and completely independent of WebGL/WebGPU preserveDrawingBuffer.
  const { center, size: dim } = recognized.bounds
  const span = Math.max(0.5, Math.hypot(dim[0], dim[1], dim[2]) * 1.25)
  const r = span * 4
  const horiz = r * Math.cos(elevation)
  const eye: Vec3 = [
    center[0] + horiz * Math.sin(yaw),
    center[1] + r * Math.sin(elevation),
    center[2] + horiz * Math.cos(yaw)
  ]
  const cam = multiply(orthographic(span, span, span / 100, span * 8), view(eye, center))
  const batchIndices = new Set(recognized.members.map(m => m.batchIndex))
  const subset: InstanceBatch[] = []
  for (const bi of batchIndices) {
    const b = frame.batches[bi]
    if (b) subset.push(b)
  }
  if (subset.length) renderMeshFrame(canvas, cam, subset)
  return canvas
}

function renderSpriteFrameCanvas(draw: SpriteDrawRecord, column: number, row: number, flip = false, customImage?: HTMLCanvasElement): HTMLCanvasElement {
  const { frameWidth, frameHeight, image } = draw.atlas
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, frameWidth)
  canvas.height = Math.max(1, frameHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.imageSmoothingEnabled = false
  if (customImage) {
    ctx.drawImage(customImage, 0, 0, canvas.width, canvas.height)
    return canvas
  }
  if (!image) return canvas
  if (flip) {
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(image, column * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight)
    ctx.restore()
  } else {
    ctx.drawImage(image, column * frameWidth, row * frameHeight, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight)
  }
  return canvas
}

function renderHudPreviewCanvas(region: HudRegion): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const w = Math.max(1, Math.min(512, Math.round(region.rect.width)))
  const h = Math.max(1, Math.min(512, Math.round(region.rect.height)))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  if (region.canvas && region.viewportWidth && region.viewportHeight) {
    const sx = region.canvas.width / region.viewportWidth
    const sy = region.canvas.height / region.viewportHeight
    try {
      ctx.drawImage(
        region.canvas,
        region.rect.x * sx, region.rect.y * sy, region.rect.width * sx, region.rect.height * sy,
        0, 0, w, h
      )
      return canvas
    } catch { /* Fall through to schematic preview if canvas is unavailable. */ }
  }
  ctx.fillStyle = '#183034'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#eaa555'
  ctx.strokeRect(1, 1, w - 2, h - 2)
  ctx.fillStyle = '#edf5ef'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(region.label, w / 2, h / 2, Math.max(1, w - 12))
  return canvas
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function surfaceLabel(surface: ReviewSurface): string {
  if (surface === 'model') return '3D Model'
  if (surface === 'rig') return '3D Rig'
  if (surface === 'mesh') return '3D Mesh'
  if (surface === 'sprite') return '2D Sprite'
  return 'HUD'
}

export interface TestingStudioHandle {
  readonly root: HTMLDivElement
  pause(paused: boolean): void
  refreshReviews(): Promise<void>
  dispose(): void
}

let activeStudioHandle: TestingStudioHandle | undefined

/**
 * Mount the game-agnostic Ridgetop Testing Mode bar and unified In-Game Asset Studio drawer.
 * Isolated inside `#ridgetop-testing-root` appended to `document.body` — works with any game page.
 */
export function mountTestingStudio(): TestingStudioHandle {
  if (activeStudioHandle) {
    activeStudioHandle.dispose()
    activeStudioHandle = undefined
  }
  const existing = document.getElementById('ridgetop-testing-root')
  if (existing) existing.remove()
  let disposed = false

  setTestingActive(true)

  if (!document.querySelector('link[href="/framework/testing-overlay.css"]')) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/framework/testing-overlay.css'
    document.head.append(link)
  }

  const controller = new AbortController()
  const signal = { signal: controller.signal }

  const root = el('div', { id: 'ridgetop-testing-root' })
  const pickLayer = el('div', { className: 'rt-pick-layer' })
  const highlight = el('div', { className: 'rt-highlight' })
  highlight.hidden = true
  const highlightLabel = el('span', { className: 'rt-highlight-label' })
  highlight.append(highlightLabel)

  // Floating bar
  const bar = el('div', { className: 'rt-bar', id: 'ridgetop-testing-bar' })
  const brand = el('span', { className: 'rt-brand', text: 'TESTING' })
  const pauseBtn = el('button', { className: 'rt-btn rt-btn-primary', type: 'button', id: 'rt-pause-btn', text: 'Pause & Inspect (F9)' })
  const reviewSelect = el('select', { className: 'rt-select', id: 'rt-review-select' })
  reviewSelect.setAttribute('aria-label', 'Saved reviews')
  reviewSelect.append(new Option('Reviews (0)', ''))
  const refreshBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-refresh-btn', text: 'Refresh' })
  const statusPill = el('span', { className: 'rt-status-pill', id: 'rt-status-pill', text: 'Live' })
  bar.append(brand, pauseBtn, reviewSelect, refreshBtn, statusPill)

  // Drawer shell
  const drawer = el('aside', { className: 'rt-drawer', id: 'ridgetop-testing-drawer' })
  drawer.hidden = true

  const drawerHead = el('div', { className: 'rt-drawer-head' })
  const titleWrap = el('div', { className: 'rt-title-wrap' })
  const badge = el('span', { className: 'rt-badge', text: 'Asset' })
  const titleEl = el('h2', { className: 'rt-title', text: 'Click any asset on screen' })
  const metaEl = el('div', { className: 'rt-meta', text: 'Paused viewport picking active' })
  titleWrap.append(titleEl, metaEl)
  const closeDrawerBtn = el('button', { className: 'rt-btn', type: 'button', text: '×', title: 'Close drawer' })
  drawerHead.append(titleWrap, closeDrawerBtn)

  const tabs = el('div', { className: 'rt-tabs' })
  const editorTabBtn = el('button', { className: 'rt-tab rt-tab-active', type: 'button', text: 'Editor' })
  const reviewsTabBtn = el('button', { className: 'rt-tab', type: 'button', text: 'Comments / Reviews' })
  tabs.append(editorTabBtn, reviewsTabBtn)

  const body = el('div', { className: 'rt-drawer-body' })
  const editorPane = el('div', { className: 'rt-pane' })
  const reviewsPane = el('div', { className: 'rt-pane' })
  reviewsPane.hidden = true
  body.append(editorPane, reviewsPane)

  const footerMsg = el('div', { className: 'rt-footer-msg', text: '' })
  drawer.append(drawerHead, tabs, body, footerMsg)

  root.append(pickLayer, highlight, bar, drawer)
  document.body.append(root)

  const entries = new Map<string, ReviewEntry>()
  let selection: Selection | undefined
  let activeReview: ReviewEntry | undefined
  let dirty = false
  let busy = false
  let draftReviewId = crypto.randomUUID()
  let lastPreviewCanvas: HTMLCanvasElement | undefined
  let spriteAnimTimer: number | undefined

  function setStatus(message: string) {
    footerMsg.textContent = message
  }

  function stopSpriteAnim() {
    if (spriteAnimTimer !== undefined) {
      clearInterval(spriteAnimTimer)
      spriteAnimTimer = undefined
    }
  }

  function setTab(next: 'editor' | 'reviews') {
    editorTabBtn.classList.toggle('rt-tab-active', next === 'editor')
    reviewsTabBtn.classList.toggle('rt-tab-active', next === 'reviews')
    editorPane.hidden = next !== 'editor'
    reviewsPane.hidden = next !== 'reviews'
  }

  editorTabBtn.onclick = () => setTab('editor')
  reviewsTabBtn.onclick = () => setTab('reviews')
  closeDrawerBtn.onclick = () => {
    drawer.hidden = true
    highlight.hidden = true
    stopSpriteAnim()
  }

  function updateHighlight() {
    if (!isTestingPaused() || !selection?.screenRect) {
      highlight.hidden = true
      return
    }
    const r = selection.screenRect
    highlight.hidden = false
    highlight.style.left = `${Math.round(r.left)}px`
    highlight.style.top = `${Math.round(r.top)}px`
    highlight.style.width = `${Math.max(12, Math.round(r.width))}px`
    highlight.style.height = `${Math.max(12, Math.round(r.height))}px`
    highlightLabel.textContent = selection.part ? `${selection.asset} · ${selection.part}` : selection.asset
  }

  function syncPauseUi(paused: boolean) {
    pauseBtn.textContent = paused ? 'Resume (F9)' : 'Pause & Inspect (F9)'
    pickLayer.classList.toggle('rt-picking', paused)
    statusPill.textContent = paused ? 'Paused — click to inspect' : 'Live'
    statusPill.classList.toggle('rt-paused', paused)
    if (!paused) {
      stopSpriteAnim()
      drawer.hidden = true
      highlight.hidden = true
      selection = undefined
      activeReview = undefined
      dirty = false
      reviewSelect.value = ''
    }
  }

  const unsubPause = onTestingPause(syncPauseUi)

  function setPaused(paused: boolean) {
    if (busy) return
    if (!paused && dirty) {
      setStatus('Save or discard your pending recipe edits before resuming.')
      return
    }
    setTestingPaused(paused)
    if (paused && !selection) {
      drawer.hidden = false
      renderEmptyDrawer()
    }
  }

  pauseBtn.onclick = () => setPaused(!isTestingPaused())

  window.addEventListener('keydown', event => {
    if (event.code === 'F9' && !event.repeat) {
      event.preventDefault()
      setPaused(!isTestingPaused())
    } else if (event.code === 'Escape' && isTestingPaused()) {
      const target = event.target
      if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return
      event.preventDefault()
      setPaused(false)
    }
  }, signal)

  function renderEmptyDrawer() {
    titleEl.textContent = 'Paused — Click viewport to pick'
    metaEl.textContent = 'Click any 3D model, rig, mesh, 2D sprite, or HUD element.'
    editorPane.replaceChildren(el('div', { className: 'rt-section' },
      el('p', { className: 'rt-muted', text: 'Click directly on the game viewport to inspect any rendered asset, edit .art.json parts, scrub sprites, or pin visual review comments.' })
    ))
    reviewsPane.replaceChildren(el('div', { className: 'rt-section' },
      el('p', { className: 'rt-muted', text: 'Pick an asset on screen or choose an existing review from the top bar.' })
    ))
  }

  function buildArtView(sel: Selection): ArtView {
    if (sel.savedView) return structuredClone(sel.savedView)
    if (sel.surface === 'sprite' && sel.spriteHit) {
      const d = sel.spriteHit.draw
      const clipName = sel.spriteClip ?? d.clip ?? Object.keys(d.atlas.clips)[0] ?? 'frame'
      const clipSpec = d.atlas.clips[clipName]
      const col = clipSpec ? clipSpec.column + (sel.spriteFrame % Math.max(1, clipSpec.frames)) : d.column
      const row = clipSpec?.row ?? d.row
      return {
        surface: 'sprite',
        asset: sel.asset,
        instance: sel.instanceId,
        source: d.atlas.manifestUrl ?? d.atlas.sourceSite ?? d.atlas.src,
        sheet: d.atlas.src,
        position: [0, 0, 0],
        yaw: 0,
        elevation: 0,
        span: 1,
        centerY: 0,
        width: Math.max(1, Math.round(d.rect.width)),
        height: Math.max(1, Math.round(d.rect.height)),
        clip: clipName,
        frame: sel.spriteFrame,
        column: col,
        row,
        handDrawn: true
      }
    }
    if (sel.surface === 'hud' && sel.hudRegion) {
      return {
        surface: 'hud',
        asset: sel.asset,
        instance: sel.instanceId,
        source: sel.source,
        position: [0, 0, 0],
        yaw: 0,
        elevation: 0,
        span: 1,
        centerY: 0,
        width: Math.max(1, Math.round(sel.hudRegion.rect.width)),
        height: Math.max(1, Math.round(sel.hudRegion.rect.height)),
        clip: 'hud',
        frame: 0,
        column: 0,
        row: 0
      }
    }
    const recipe = sel.draftRecipe ?? sel.originalRecipe
    const center = sel.recognized?.bounds.center ?? [0, 0, 0]
    const size = sel.recognized?.bounds.size ?? [1, 1, 1]
    const span = recipe?.span ?? Math.max(0.5, Math.hypot(size[0], size[1], size[2]) * 1.25)
    const centerY = recipe?.centerY ?? center[1]
    const w = Math.max(1, Math.round(sel.screenRect?.width ?? 128))
    const h = Math.max(1, Math.round(sel.screenRect?.height ?? 128))
    return {
      surface: sel.surface,
      asset: sel.asset,
      instance: sel.instanceId,
      source: sel.source,
      position: [...center],
      yaw: sel.previewYaw,
      elevation: Math.max(-1.45, Math.min(1.45, sel.previewElevation)),
      span,
      centerY,
      width: w,
      height: h
    }
  }

  function renderCurrentAssetImage(sel: Selection): HTMLCanvasElement {
    const recipe = sel.draftRecipe ?? sel.originalRecipe
    if (sel.surface === 'model' && recipe) {
      const model = modelFromArtRecipe(recipe)
      const kit = createArtKit<string>({ palette: recipe.palette, models: { [sel.asset]: model } })
      const pose = buildArtView(sel)
      return modelReviewFrame(kit, { ...pose, surface: 'model', yaw: sel.previewYaw, elevation: sel.previewElevation }, 256, false)
    }
    if ((sel.surface === 'rig' || sel.surface === 'mesh' || sel.surface === 'model') && sel.recognized) {
      return renderRecognizedPreview(sel.recognized, 256, sel.previewYaw, sel.previewElevation)
    }
    if (sel.surface === 'sprite' && sel.spriteHit) {
      const d = sel.spriteHit.draw
      const clipName = sel.spriteClip ?? d.clip
      const spec = clipName ? d.atlas.clips[clipName] : undefined
      const col = spec ? spec.column + (sel.spriteFrame % Math.max(1, spec.frames)) : d.column
      const row = spec?.row ?? d.row
      return renderSpriteFrameCanvas(d, col, row, d.flip, sel.spriteImport)
    }
    if (sel.surface === 'hud' && sel.hudRegion) {
      return renderHudPreviewCanvas(sel.hudRegion)
    }
    const fallback = document.createElement('canvas')
    fallback.width = 128
    fallback.height = 128
    return fallback
  }

  function renderSelection() {
    stopSpriteAnim()
    if (!selection) {
      renderEmptyDrawer()
      return
    }
    const sel = selection
    drawer.hidden = false
    badge.textContent = surfaceLabel(sel.surface)
    titleEl.replaceChildren(badge, document.createTextNode(sel.asset))
    metaEl.textContent = [sel.instanceId, sel.part ? `part: ${sel.part}` : undefined, sel.source].filter(Boolean).join(' · ')
    updateHighlight()
    renderEditorPane(sel)
    renderReviewsPane(sel)
  }

  function renderEditorPane(sel: Selection) {
    editorPane.replaceChildren()
    if (sel.surface === 'model' && sel.draftRecipe) {
      renderArtRecipeEditor(sel, sel.draftRecipe)
    } else if (sel.surface === 'sprite' && sel.spriteHit) {
      renderSpriteEditor(sel, sel.spriteHit)
    } else {
      renderReadOnlyInspector(sel)
    }
  }

  function renderArtRecipeEditor(sel: Selection, recipe: ArtRecipe) {
    let selectedPartIndex = Math.max(0, recipe.parts.findIndex(p => p.name === sel.part))

    // Live interactive preview section
    const previewSection = el('div', { className: 'rt-section' })
    const previewWrap = el('div', { className: 'rt-preview-wrap' })
    const previewCanvas = el('canvas', { className: 'rt-preview-canvas' })
    previewWrap.append(previewCanvas)

    const orbitRow = el('div', { className: 'rt-row' })
    const yawLabel = el('span', { className: 'rt-muted rt-grow', text: 'Drag preview to orbit' })
    const fitBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Fit & Ground' })
    orbitRow.append(yawLabel, fitBtn)
    previewSection.append(previewWrap, orbitRow)

    // 3-angle & silhouette compare
    const compareDetails = document.createElement('details')
    compareDetails.className = 'rt-section'
    const compareSummary = el('summary', { className: 'rt-section-title', text: '3-Angle & Silhouette Compare' })
    const silLabel = el('label', { className: 'rt-row' })
    const silCheck = el('input', { type: 'checkbox' })
    silLabel.append(silCheck, el('span', { text: 'Silhouette mode' }))
    const compareGrid = el('div', { className: 'rt-compare-grid' })
    const angles = ['front', 'right', 'back'] as const
    const angleCanvases = angles.map(angle => {
      const fig = el('figure', { className: 'rt-compare-cell' })
      const c = document.createElement('canvas')
      fig.append(el('figcaption', { text: angle[0].toUpperCase() + angle.slice(1) }), c)
      compareGrid.append(fig)
      return { angle, canvas: c }
    })
    silCheck.onchange = () => compareGrid.classList.toggle('rt-silhouettes', silCheck.checked)
    compareDetails.append(compareSummary, silLabel, compareGrid)

    // Part list + add/duplicate/delete
    const partsSection = el('div', { className: 'rt-section' })
    partsSection.append(el('h3', { className: 'rt-section-title', text: 'Model Parts' }))
    const partRow = el('div', { className: 'rt-row' })
    const partSelect = el('select', { className: 'rt-select rt-grow' })
    const addPartBtn = el('button', { className: 'rt-btn', type: 'button', text: '+ Add' })
    const dupPartBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Duplicate' })
    const delPartBtn = el('button', { className: 'rt-btn rt-btn-danger', type: 'button', text: 'Delete' })
    partRow.append(partSelect, addPartBtn, dupPartBtn, delPartBtn)

    const nameShapeRow = el('div', { className: 'rt-grid-3' })
    const nameInput = el('input', { className: 'rt-input', type: 'text' })
    const shapeSelect = el('select', { className: 'rt-select' })
    for (const shape of Object.keys(artShapes)) shapeSelect.append(new Option(shape, shape))
    const toneSelect = el('select', { className: 'rt-select' })
    for (const tone of Object.keys(artPalette)) toneSelect.append(new Option(tone, tone))
    nameShapeRow.append(
      el('label', { className: 'rt-field', text: 'Name' }, nameInput),
      el('label', { className: 'rt-field', text: 'Shape' }, shapeSelect),
      el('label', { className: 'rt-field', text: 'Tone' }, toneSelect)
    )

    function makeVec3Row(title: string) {
      const grid = el('div', { className: 'rt-grid-3' })
      const inputs = ['X', 'Y', 'Z'].map(axis => {
        const input = el('input', { className: 'rt-input', type: 'number' })
        input.step = '0.05'
        grid.append(el('label', { className: 'rt-field', text: `${title} ${axis}` }, input))
        return input
      })
      return { grid, inputs }
    }

    const posCtrl = makeVec3Row('Pos')
    const sclCtrl = makeVec3Row('Scale')
    const rotCtrl = makeVec3Row('Rot°')
    const unlitInput = el('input', { className: 'rt-input', type: 'number' })
    unlitInput.min = '0'
    unlitInput.max = '1'
    unlitInput.step = '0.05'
    const unlitWrap = el('label', { className: 'rt-field', text: 'Unlit (0–1)' }, unlitInput)

    partsSection.append(partRow, nameShapeRow, posCtrl.grid, sclCtrl.grid, rotCtrl.grid, unlitWrap)

    // Palette swatches
    const paletteSection = el('div', { className: 'rt-section' })
    paletteSection.append(el('h3', { className: 'rt-section-title', text: 'Palette Swatches' }))
    const swatches = el('div', { className: 'rt-swatches' })
    for (const tone of Object.keys(artPalette)) {
      if (!isArtTone(tone)) continue
      const picker = el('input', { type: 'color' })
      picker.value = recipe.palette[tone] ?? artPalette[tone]
      picker.oninput = () => {
        recipe.palette[tone] = picker.value
        dirty = true
        paintPreviews()
        syncSaveButtons()
      }
      swatches.append(el('label', { className: 'rt-swatch' }, picker, document.createTextNode(tone)))
    }
    paletteSection.append(swatches)

    // Save / Download actions
    const actionRow = el('div', { className: 'rt-row' })
    const saveBtn = el('button', { className: 'rt-btn rt-btn-primary', type: 'button', text: 'Save Recipe' })
    const discardBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Discard' })
    const downloadBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Download .art.json' })
    actionRow.append(saveBtn, discardBtn, downloadBtn)

    function syncSaveButtons() {
      saveBtn.disabled = !dirty || busy
      discardBtn.disabled = !dirty || busy
      delPartBtn.disabled = recipe.parts.length <= 1 || busy
    }

    function paintPreviews() {
      try {
        const rendered = renderCurrentAssetImage(sel)
        lastPreviewCanvas = rendered
        previewCanvas.width = rendered.width
        previewCanvas.height = rendered.height
        previewCanvas.getContext('2d')?.drawImage(rendered, 0, 0)

        const model = modelFromArtRecipe(recipe)
        const kit = createArtKit<string>({ palette: recipe.palette, models: { [sel.asset]: model } })
        const g = kit.group()
        g.add(sel.asset, [0, 0, 0])
        const sheet = bakeSpriteDirections(g.batches, { span: model.span, center: [0, model.centerY, 0], frameSize: Math.min(96, recipe.frameSize || 64) })
        for (const cell of angleCanvases) {
          const clip = sheet.manifest.clips[cell.angle]
          const fw = sheet.manifest.frameWidth, fh = sheet.manifest.frameHeight
          cell.canvas.width = fw
          cell.canvas.height = fh
          cell.canvas.getContext('2d')?.drawImage(sheet.image, clip.column * fw, (clip.row ?? 0) * fh, fw, fh, 0, 0, fw, fh)
        }
      } catch (error) {
        setStatus(errorMessage(error))
      }
    }

    function populatePartFields() {
      partSelect.replaceChildren(...recipe.parts.map((p, idx) => new Option(p.name, String(idx))))
      selectedPartIndex = Math.max(0, Math.min(recipe.parts.length - 1, selectedPartIndex))
      partSelect.value = String(selectedPartIndex)
      const part = recipe.parts[selectedPartIndex]
      sel.part = part.name
      nameInput.value = part.name
      shapeSelect.value = part.shape
      toneSelect.value = part.tone
      for (let i = 0; i < 3; i++) {
        posCtrl.inputs[i].value = String(round3(part.position[i]))
        sclCtrl.inputs[i].value = String(round3(part.scale[i]))
      }
      rotCtrl.inputs[0].value = String(round3((part.pitch ?? 0) * 180 / Math.PI))
      rotCtrl.inputs[1].value = String(round3((part.yaw ?? 0) * 180 / Math.PI))
      rotCtrl.inputs[2].value = String(round3((part.roll ?? 0) * 180 / Math.PI))
      unlitInput.value = String(round3(part.unlit ?? 0))
      syncSaveButtons()
    }

    function applyFieldChanges() {
      const part = recipe.parts[selectedPartIndex]
      const nextName = nameInput.value.trim()
      if (nextName && nextName !== part.name && !recipe.parts.some((p, i) => i !== selectedPartIndex && p.name === nextName)) {
        part.name = nextName
        sel.part = nextName
        partSelect.options[selectedPartIndex].text = nextName
      }
      if (isArtShape(shapeSelect.value)) part.shape = shapeSelect.value
      if (isArtTone(toneSelect.value)) part.tone = toneSelect.value
      const pos: Vec3 = [posCtrl.inputs[0].valueAsNumber, posCtrl.inputs[1].valueAsNumber, posCtrl.inputs[2].valueAsNumber]
      const scl: Vec3 = [sclCtrl.inputs[0].valueAsNumber, sclCtrl.inputs[1].valueAsNumber, sclCtrl.inputs[2].valueAsNumber]
      if (!pos.every(Number.isFinite) || !scl.every(n => Number.isFinite(n) && n > 0)) {
        setStatus('Positions must be finite and scales must be positive.')
        return
      }
      part.position = pos
      part.scale = scl
      const pitch = rotCtrl.inputs[0].valueAsNumber * Math.PI / 180
      const yaw = rotCtrl.inputs[1].valueAsNumber * Math.PI / 180
      const roll = rotCtrl.inputs[2].valueAsNumber * Math.PI / 180
      if (Number.isFinite(pitch)) part.pitch = pitch || undefined
      if (Number.isFinite(yaw)) part.yaw = yaw || undefined
      if (Number.isFinite(roll)) part.roll = roll || undefined
      const unlit = unlitInput.valueAsNumber
      if (Number.isFinite(unlit) && unlit >= 0 && unlit <= 1) part.unlit = unlit || undefined
      dirty = true
      setStatus('')
      paintPreviews()
      syncSaveButtons()
    }

    partSelect.onchange = () => {
      selectedPartIndex = Number(partSelect.value) || 0
      populatePartFields()
    }
    nameInput.onchange = applyFieldChanges
    shapeSelect.onchange = applyFieldChanges
    toneSelect.onchange = applyFieldChanges
    unlitInput.onchange = applyFieldChanges
    for (const inp of [...posCtrl.inputs, ...sclCtrl.inputs, ...rotCtrl.inputs]) inp.onchange = applyFieldChanges

    function uniquePartName(base: string): string {
      let idx = 2
      let candidate = base
      while (recipe.parts.some(p => p.name === candidate)) candidate = `${base}-${idx++}`
      return candidate
    }

    addPartBtn.onclick = () => {
      const name = uniquePartName('part')
      recipe.parts.push({ name, shape: 'prism', position: [0, 0.5, 0], scale: [0.35, 0.35, 0.35], tone: 'accent' })
      selectedPartIndex = recipe.parts.length - 1
      dirty = true
      populatePartFields()
      paintPreviews()
    }

    dupPartBtn.onclick = () => {
      const cur = recipe.parts[selectedPartIndex]
      const copy = structuredClone(cur)
      copy.name = uniquePartName(cur.name + '-copy')
      copy.position = [round3(cur.position[0] + 0.15), cur.position[1], cur.position[2]]
      recipe.parts.splice(selectedPartIndex + 1, 0, copy)
      selectedPartIndex += 1
      dirty = true
      populatePartFields()
      paintPreviews()
    }

    delPartBtn.onclick = () => {
      if (recipe.parts.length <= 1) return
      recipe.parts.splice(selectedPartIndex, 1)
      selectedPartIndex = Math.max(0, selectedPartIndex - 1)
      dirty = true
      populatePartFields()
      paintPreviews()
    }

    fitBtn.onclick = () => {
      try {
        const fitted = fitArtRecipe(structuredClone(recipe))
        sel.draftRecipe = fitted
        dirty = true
        setStatus('Grounded and fitted model bounds.')
        renderSelection()
      } catch (error) {
        setStatus(errorMessage(error))
      }
    }

    discardBtn.onclick = () => {
      if (!sel.originalRecipe) return
      sel.draftRecipe = structuredClone(sel.originalRecipe)
      dirty = false
      setStatus('Discarded unsaved edits.')
      renderSelection()
    }

    downloadBtn.onclick = () => {
      const blob = new Blob([JSON.stringify(recipe, null, 2) + '\n'], { type: 'application/json' })
      downloadBlob(blob, `${recipe.name}.art.json`)
    }

    saveBtn.onclick = async () => {
      if (busy) return
      busy = true
      syncSaveButtons()
      try {
        const src = sel.artSource
        await apiJson(RECIPE_API, 'POST', {
          asset: sel.asset,
          file: src?.file ?? null,
          base: src?.base ?? null,
          recipe
        })
        sel.originalRecipe = structuredClone(recipe)
        if (sel.artSource) sel.artSource = { ...sel.artSource, base: structuredClone(recipe), recipe: structuredClone(recipe) }
        dirty = false
        for (const hook of getTestingHooks()) hook.onRecipeSaved?.(sel.asset, structuredClone(recipe))
        setStatus(`Saved ${src?.file ?? 'art/overrides.json'}! Reload to apply in-game.`)
      } catch (error) {
        setStatus(errorMessage(error))
      } finally {
        busy = false
        syncSaveButtons()
      }
    }

    // Drag to orbit preview
    let orbitDrag: { id: number; x: number; y: number; yaw: number; elev: number } | undefined
    previewCanvas.onpointerdown = event => {
      if (event.button !== 0) return
      orbitDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: sel.previewYaw, elev: sel.previewElevation }
      try { previewCanvas.setPointerCapture(event.pointerId) } catch { /* Ignore synthetic capture failure. */ }
    }
    previewCanvas.onpointermove = event => {
      if (!orbitDrag || orbitDrag.id !== event.pointerId) return
      sel.previewYaw = orbitDrag.yaw + (event.clientX - orbitDrag.x) * 0.015
      sel.previewElevation = Math.max(-1.35, Math.min(1.35, orbitDrag.elev + (event.clientY - orbitDrag.y) * 0.012))
      paintPreviews()
    }
    previewCanvas.onpointerup = event => {
      if (orbitDrag?.id === event.pointerId) orbitDrag = undefined
    }

    editorPane.append(previewSection, compareDetails, partsSection, paletteSection, actionRow)
    populatePartFields()
    paintPreviews()
  }

  function renderSpriteEditor(sel: Selection, spriteHit: PickedSpriteDraw) {
    const draw = spriteHit.draw
    const atlas = draw.atlas
    const clipNames = Object.keys(atlas.clips)
    if (!sel.spriteClip && clipNames.length) sel.spriteClip = draw.clip ?? clipNames[0]

    const section = el('div', { className: 'rt-section' })
    const previewWrap = el('div', { className: 'rt-preview-wrap' })
    const previewCanvas = el('canvas', { className: 'rt-preview-canvas rt-pixelated' })
    previewWrap.append(previewCanvas)

    const regionInfo = el('div', { className: 'rt-muted', text: 'Drag on sprite to select pixel region' })

    const controlsRow = el('div', { className: 'rt-grid-2' })
    const clipSelect = el('select', { className: 'rt-select' })
    if (clipNames.length) {
      for (const name of clipNames) clipSelect.append(new Option(name, name))
      clipSelect.value = sel.spriteClip ?? clipNames[0]
    } else {
      clipSelect.append(new Option(`col ${draw.column}, row ${draw.row}`, ''))
    }
    const frameMsInput = el('input', { className: 'rt-input', type: 'number' })
    frameMsInput.min = '16'
    frameMsInput.step = '10'
    const activeClip = sel.spriteClip ? atlas.clips[sel.spriteClip] : undefined
    sel.spriteFrameMs = activeClip?.frameMs ?? sel.spriteFrameMs ?? 120
    frameMsInput.value = String(sel.spriteFrameMs)

    controlsRow.append(
      el('label', { className: 'rt-field', text: 'Clip' }, clipSelect),
      el('label', { className: 'rt-field', text: 'Frame Timing (ms)' }, frameMsInput)
    )

    const scrubRow = el('div', { className: 'rt-row' })
    const frameSlider = el('input', { className: 'rt-grow', type: 'range' })
    frameSlider.min = '0'
    frameSlider.max = String(Math.max(0, (activeClip?.frames ?? 1) - 1))
    frameSlider.value = String(sel.spriteFrame)
    const frameBadge = el('span', { className: 'rt-muted', text: `Frame ${sel.spriteFrame + 1}/${activeClip?.frames ?? 1}` })
    const playBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Play' })
    scrubRow.append(frameSlider, frameBadge, playBtn)

    const ioRow = el('div', { className: 'rt-row' })
    const exportPngBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Export Frame PNG' })
    const importBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Import Preview PNG' })
    const importInput = el('input', { type: 'file' })
    importInput.accept = 'image/png,image/jpeg,image/webp'
    importInput.hidden = true
    ioRow.append(exportPngBtn, importBtn, importInput)

    const metaList = el('div', { className: 'rt-muted', text: [
      `${atlas.frameWidth}×${atlas.frameHeight} px`,
      atlas.src,
      atlas.sourceSite ? `src: ${atlas.sourceSite}` : undefined
    ].filter(Boolean).join(' · ') })

    function paintSprite() {
      const rendered = renderCurrentAssetImage(sel)
      lastPreviewCanvas = rendered
      const zoom = Math.max(1, Math.min(8, Math.floor(200 / Math.max(rendered.width, rendered.height))))
      previewCanvas.width = rendered.width * zoom
      previewCanvas.height = rendered.height * zoom
      const ctx = previewCanvas.getContext('2d')
      if (ctx) {
        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height)
        ctx.drawImage(rendered, 0, 0, previewCanvas.width, previewCanvas.height)
        drawPinOverlay(previewCanvas, sel.region)
      }
      const [u0, v0, u1, v1] = sel.region
      const x0 = Math.round(u0 * atlas.frameWidth), y0 = Math.round(v0 * atlas.frameHeight)
      const x1 = Math.round(u1 * atlas.frameWidth), y1 = Math.round(v1 * atlas.frameHeight)
      regionInfo.textContent = `Region: (${x0}, ${y0}) – (${x1}, ${y1}) px · ${Math.max(1, x1 - x0)}×${Math.max(1, y1 - y0)}`
      const clip = sel.spriteClip ? atlas.clips[sel.spriteClip] : undefined
      frameBadge.textContent = `Frame ${sel.spriteFrame + 1}/${clip?.frames ?? 1}`
    }

    clipSelect.onchange = () => {
      stopSpriteAnim()
      playBtn.textContent = 'Play'
      sel.spriteClip = clipSelect.value || undefined
      const clip = sel.spriteClip ? atlas.clips[sel.spriteClip] : undefined
      sel.spriteFrame = 0
      sel.spriteFrameMs = clip?.frameMs ?? 120
      frameMsInput.value = String(sel.spriteFrameMs)
      frameSlider.max = String(Math.max(0, (clip?.frames ?? 1) - 1))
      frameSlider.value = '0'
      paintSprite()
    }

    frameSlider.oninput = () => {
      sel.spriteFrame = Number(frameSlider.value) || 0
      paintSprite()
    }

    frameMsInput.onchange = () => {
      const ms = frameMsInput.valueAsNumber
      if (Number.isFinite(ms) && ms >= 16) sel.spriteFrameMs = Math.round(ms)
      if (spriteAnimTimer !== undefined) {
        stopSpriteAnim()
        startAnim()
      }
    }

    function startAnim() {
      const clip = sel.spriteClip ? atlas.clips[sel.spriteClip] : undefined
      const frames = clip?.frames ?? 1
      if (frames <= 1) return
      spriteAnimTimer = window.setInterval(() => {
        sel.spriteFrame = (sel.spriteFrame + 1) % frames
        frameSlider.value = String(sel.spriteFrame)
        paintSprite()
      }, Math.max(16, sel.spriteFrameMs))
      playBtn.textContent = 'Stop'
    }

    playBtn.onclick = () => {
      if (spriteAnimTimer !== undefined) {
        stopSpriteAnim()
        playBtn.textContent = 'Play'
      } else {
        startAnim()
      }
    }

    exportPngBtn.onclick = () => {
      const frameCanvas = renderCurrentAssetImage(sel)
      frameCanvas.toBlob(blob => {
        if (blob) downloadBlob(blob, `${sel.asset}-${sel.spriteClip ?? 'frame'}-${sel.spriteFrame}.png`)
      }, 'image/png')
    }

    importBtn.onclick = () => importInput.click()
    importInput.onchange = async () => {
      const file = importInput.files?.[0]
      if (!file) return
      importInput.value = ''
      try {
        const bitmap = await createImageBitmap(file)
        const copy = document.createElement('canvas')
        copy.width = atlas.frameWidth
        copy.height = atlas.frameHeight
        const ctx = copy.getContext('2d')
        if (ctx) {
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(bitmap, 0, 0, copy.width, copy.height)
        }
        bitmap.close()
        sel.spriteImport = copy
        paintSprite()
        setStatus(`Loaded preview image ${file.name}.`)
      } catch {
        setStatus('Could not decode imported image.')
      }
    }

    let boxDrag: { id: number; x: number; y: number } | undefined
    previewCanvas.onpointerdown = event => {
      if (event.button !== 0) return
      const [u, v] = measureNormalized(previewCanvas, event)
      boxDrag = { id: event.pointerId, x: u, y: v }
      sel.region = [u, v, u, v]
      try { previewCanvas.setPointerCapture(event.pointerId) } catch { /* Ignore capture error. */ }
      paintSprite()
    }
    previewCanvas.onpointermove = event => {
      if (!boxDrag || boxDrag.id !== event.pointerId) return
      const [u, v] = measureNormalized(previewCanvas, event)
      sel.region = [Math.min(boxDrag.x, u), Math.min(boxDrag.y, v), Math.max(boxDrag.x, u), Math.max(boxDrag.y, v)]
      paintSprite()
    }
    previewCanvas.onpointerup = event => {
      if (boxDrag?.id === event.pointerId) boxDrag = undefined
    }

    section.append(previewWrap, regionInfo, controlsRow, scrubRow, ioRow, metaList)
    editorPane.append(section)
    paintSprite()
  }

  function renderReadOnlyInspector(sel: Selection) {
    const previewSection = el('div', { className: 'rt-section' })
    const previewWrap = el('div', { className: 'rt-preview-wrap' })
    const previewCanvas = el('canvas', { className: 'rt-preview-canvas' })
    previewWrap.append(previewCanvas)
    previewSection.append(previewWrap)

    const paint = () => {
      const rendered = renderCurrentAssetImage(sel)
      lastPreviewCanvas = rendered
      previewCanvas.width = rendered.width
      previewCanvas.height = rendered.height
      previewCanvas.getContext('2d')?.drawImage(rendered, 0, 0)
    }

    if (sel.recognized) {
      const rec = sel.recognized
      let orbitDrag: { id: number; x: number; y: number; yaw: number; elev: number } | undefined
      previewCanvas.onpointerdown = event => {
        if (event.button !== 0) return
        orbitDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: sel.previewYaw, elev: sel.previewElevation }
        try { previewCanvas.setPointerCapture(event.pointerId) } catch { /* Ignore capture error. */ }
      }
      previewCanvas.onpointermove = event => {
        if (!orbitDrag || orbitDrag.id !== event.pointerId) return
        sel.previewYaw = orbitDrag.yaw + (event.clientX - orbitDrag.x) * 0.015
        sel.previewElevation = Math.max(-1.35, Math.min(1.35, orbitDrag.elev + (event.clientY - orbitDrag.y) * 0.012))
        paint()
      }
      previewCanvas.onpointerup = event => {
        if (orbitDrag?.id === event.pointerId) orbitDrag = undefined
      }

      const infoSection = el('div', { className: 'rt-section' })
      infoSection.append(el('h3', { className: 'rt-section-title', text: 'Recognized Asset Metadata' }))
      infoSection.append(
        el('div', { className: 'rt-muted', text: `Source: ${rec.sourceSite}` }),
        el('div', { className: 'rt-muted', text: `Stats: ${rec.stats.instanceCount} parts · ${rec.stats.triangleCount} triangles · ${rec.stats.batchCount} batch(es)` }),
        el('div', { className: 'rt-muted', text: `Bounds: ${rec.bounds.size.map(round3).join(' × ')} @ (${rec.bounds.center.map(round3).join(', ')})` })
      )

      const colorRow = el('div', { className: 'rt-row' })
      colorRow.append(el('span', { className: 'rt-muted', text: 'Colors:' }))
      for (const hex of rec.colors.slice(0, 12)) {
        const chip = el('span', { className: 'rt-color-chip', title: hex })
        chip.style.backgroundColor = hex
        colorRow.append(chip)
      }
      infoSection.append(colorRow)

      const membersSection = el('div', { className: 'rt-section' })
      membersSection.append(el('h3', { className: 'rt-section-title', text: rec.kind === 'rig' ? 'Rig Joints & Parts' : 'Grouped Mesh Parts' }))
      const list = el('ul', { className: 'rt-member-list' })
      for (const m of rec.members) {
        const item = el('li', { className: 'rt-member-item' + (m.part === sel.part ? ' rt-selected' : '') })
        const left = el('span')
        const chip = el('span', { className: 'rt-color-chip' })
        chip.style.backgroundColor = m.colorHex
        const label = m.joint && m.joint !== m.part ? `${m.joint} / ${m.part}` : m.part
        left.append(chip, document.createTextNode(' ' + label))
        const right = el('span', { className: 'rt-muted', text: `${m.shape ?? 'mesh'} · ${m.triangles}△` })
        item.append(left, right)
        item.onclick = () => {
          sel.part = m.part
          renderSelection()
        }
        list.append(item)
      }
      membersSection.append(list)
      membersSection.append(el('div', { className: 'rt-muted', text: 'Switch to Comments / Reviews to pin visual feedback with source attribution.' }))
      editorPane.append(previewSection, infoSection, membersSection)
    } else if (sel.hudRegion) {
      const infoSection = el('div', { className: 'rt-section' })
      infoSection.append(
        el('h3', { className: 'rt-section-title', text: 'HUD Region' }),
        el('div', { className: 'rt-muted', text: `ID: ${sel.hudRegion.id}` }),
        el('div', { className: 'rt-muted', text: `Rect: ${Math.round(sel.hudRegion.rect.x)}, ${Math.round(sel.hudRegion.rect.y)} (${Math.round(sel.hudRegion.rect.width)}×${Math.round(sel.hudRegion.rect.height)})` }),
        el('div', { className: 'rt-muted', text: `Source: ${sel.source}` })
      )
      editorPane.append(previewSection, infoSection)
    }
    paint()
  }

  function renderReviewsPane(sel: Selection) {
    reviewsPane.replaceChildren()

    const previewSection = el('div', { className: 'rt-section' })
    const pinCanvas = el('canvas', { className: 'rt-preview-canvas' + (sel.surface === 'sprite' ? ' rt-pixelated' : '') })

    if (activeReview) {
      const grid = el('div', { className: 'rt-before-grid' })
      const beforeImg = document.createElement('img')
      beforeImg.alt = 'Saved before snapshot'
      beforeImg.src = `${REVIEWS_API}/${activeReview.note.id}/before.png`
      const beforeFig = el('figure', undefined, el('figcaption', { text: 'Before' }), beforeImg)
      const currentFig = el('figure', undefined, el('figcaption', { text: 'Current' }), pinCanvas)
      grid.append(beforeFig, currentFig)
      previewSection.append(grid)
    } else {
      const wrap = el('div', { className: 'rt-preview-wrap' }, pinCanvas)
      previewSection.append(wrap, el('div', { className: 'rt-muted', text: 'Click to pin a point or drag a box on the preview.' }))
    }

    const paintPinPreview = () => {
      const rendered = renderCurrentAssetImage(sel)
      lastPreviewCanvas = rendered
      pinCanvas.width = rendered.width
      pinCanvas.height = rendered.height
      const ctx = pinCanvas.getContext('2d')
      if (ctx) {
        ctx.imageSmoothingEnabled = sel.surface !== 'sprite'
        ctx.clearRect(0, 0, pinCanvas.width, pinCanvas.height)
        ctx.drawImage(rendered, 0, 0)
        drawPinOverlay(pinCanvas, sel.region)
      }
    }

    if (!activeReview) {
      let drag: { id: number; x: number; y: number } | undefined
      pinCanvas.onpointerdown = event => {
        if (event.button !== 0) return
        const [u, v] = measureNormalized(pinCanvas, event)
        drag = { id: event.pointerId, x: u, y: v }
        sel.region = [u, v, u, v]
        try { pinCanvas.setPointerCapture(event.pointerId) } catch { /* Ignore capture error. */ }
        paintPinPreview()
      }
      pinCanvas.onpointermove = event => {
        if (!drag || drag.id !== event.pointerId) return
        const [u, v] = measureNormalized(pinCanvas, event)
        sel.region = [Math.min(drag.x, u), Math.min(drag.y, v), Math.max(drag.x, u), Math.max(drag.y, v)]
        paintPinPreview()
      }
      pinCanvas.onpointerup = event => {
        if (drag?.id === event.pointerId) drag = undefined
      }
    }

    // Scope & Part controls
    const targetSection = el('div', { className: 'rt-section' })
    const row = el('div', { className: 'rt-grid-2' })
    const scopeSelect = el('select', { className: 'rt-select' })
    const allowedScopes: ReviewScope[] = sel.surface === 'hud'
      ? ['hud', 'asset', 'instance']
      : sel.surface === 'sprite'
        ? ['sprite', 'asset', 'instance']
        : ['asset', 'instance']
    for (const sc of allowedScopes) scopeSelect.append(new Option(sc, sc))
    if (!allowedScopes.includes(sel.scope)) sel.scope = allowedScopes[0]
    scopeSelect.value = sel.scope
    scopeSelect.disabled = Boolean(activeReview)
    scopeSelect.onchange = () => {
      if (isReviewScope(scopeSelect.value)) sel.scope = scopeSelect.value
    }

    const partInput = el('input', { className: 'rt-input', type: 'text' })
    partInput.value = sel.part ?? ''
    partInput.placeholder = 'Whole asset'
    partInput.disabled = Boolean(activeReview)
    partInput.onchange = () => { sel.part = partInput.value.trim() || undefined }

    row.append(
      el('label', { className: 'rt-field', text: 'Scope' }, scopeSelect),
      el('label', { className: 'rt-field', text: 'Part / Joint' }, partInput)
    )
    targetSection.append(row, el('div', { className: 'rt-muted', text: `Edit source: ${sel.source}` }))

    // Thread display for existing review
    if (activeReview) {
      const threadSection = el('div', { className: 'rt-section' })
      threadSection.append(el('h3', { className: 'rt-section-title', text: `Review · ${activeReview.note.status}` }))
      const list = el('ul', { className: 'rt-thread-list' })
      list.append(el('li', { text: activeReview.note.comment }))
      for (const r of activeReview.note.replies) list.append(el('li', { text: r.text }))
      threadSection.append(list)
      reviewsPane.append(previewSection, targetSection, threadSection)
    } else {
      reviewsPane.append(previewSection, targetSection)
    }

    // Comment / reply form
    const formSection = el('div', { className: 'rt-section' })
    const textarea = el('textarea', { className: 'rt-textarea', id: 'rt-review-comment' })
    textarea.placeholder = activeReview ? 'Write a reply…' : 'Describe the visual issue or change requested…'
    const btnRow = el('div', { className: 'rt-row' })
    const submitBtn = el('button', {
      className: 'rt-btn rt-btn-primary',
      type: 'button',
      text: activeReview ? 'Save Reply' : 'Save Comment'
    })
    const resolveBtn = el('button', {
      className: 'rt-btn',
      type: 'button',
      text: activeReview?.note.status === 'resolved' ? 'Reopen' : 'Resolve'
    })
    resolveBtn.hidden = !activeReview
    const reloadCompareBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Reload & Compare' })
    btnRow.append(submitBtn, resolveBtn, reloadCompareBtn)
    formSection.append(
      el('label', { className: 'rt-field', text: activeReview ? 'Reply' : 'Comment' }, textarea),
      btnRow
    )
    reviewsPane.append(formSection)

    submitBtn.onclick = async () => {
      if (busy) return
      const commentText = textarea.value.trim()
      if (!commentText) { setStatus('Write a comment first.'); return }
      busy = true
      submitBtn.disabled = true
      try {
        if (activeReview) {
          const updated = parseReviewEntry(await apiJson(`${REVIEWS_API}/${activeReview.note.id}`, 'PATCH', {
            revision: activeReview.revision,
            status: activeReview.note.status,
            reply: commentText
          }))
          activeReview = updated
          await refreshReviews()
          setStatus(`Saved reply on reviews/${updated.note.id}.json.`)
          renderReviewsPane(sel)
        } else {
          const preview = lastPreviewCanvas ?? renderCurrentAssetImage(sel)
          const pngBase64 = preview.toDataURL('image/png').split(',')[1]
          const target: ArtPin = {
            view: buildArtView(sel),
            scope: sel.scope,
            part: sel.part,
            editSource: sel.source,
            region: [...sel.region]
          }
          const created = parseReviewEntry(await apiJson(REVIEWS_API, 'POST', {
            id: draftReviewId,
            target,
            scene: resolveSnapshot(),
            comment: commentText,
            png: pngBase64
          }))
          activeReview = created
          draftReviewId = crypto.randomUUID()
          await refreshReviews()
          reviewSelect.value = created.note.id
          setStatus(`Saved reviews/${created.note.id}.json + before PNG.`)
          renderReviewsPane(sel)
        }
      } catch (error) {
        setStatus(errorMessage(error))
      } finally {
        busy = false
        submitBtn.disabled = false
      }
    }

    resolveBtn.onclick = async () => {
      if (busy || !activeReview) return
      busy = true
      resolveBtn.disabled = true
      try {
        const nextStatus = activeReview.note.status === 'resolved' ? 'open' : 'resolved'
        const updated = parseReviewEntry(await apiJson(`${REVIEWS_API}/${activeReview.note.id}`, 'PATCH', {
          revision: activeReview.revision,
          status: nextStatus,
          reply: textarea.value.trim() || undefined
        }))
        activeReview = updated
        await refreshReviews()
        setStatus(`Marked review ${nextStatus}.`)
        renderReviewsPane(sel)
      } catch (error) {
        setStatus(errorMessage(error))
      } finally {
        busy = false
        resolveBtn.disabled = false
      }
    }

    reloadCompareBtn.onclick = () => {
      history.replaceState({
        ridgetopStudio: {
          reviewId: activeReview?.note.id,
          scene: resolveSnapshot()
        }
      }, '')
      location.reload()
    }

    paintPinPreview()
  }

  // Viewport picking when paused
  pickLayer.addEventListener('click', event => {
    if (!isTestingPaused() || busy) return
    if (dirty) {
      setStatus('Save or discard your current recipe edit before picking another asset.')
      return
    }
    const cx = event.clientX, cy = event.clientY

    // 1. Check registered HUD regions (topmost leaf non-fullscreen regions first)
    const hudRegions = getHudRegions()
    for (let i = hudRegions.length - 1; i >= 0; i--) {
      const reg = hudRegions[i]
      const baseRect = reg.canvas ? reg.canvas.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
      const vw = reg.viewportWidth ?? baseRect.width
      const vh = reg.viewportHeight ?? baseRect.height
      if (vw <= 0 || vh <= 0) continue
      // Skip giant full-screen container panels so 3D/sprite clicks still pass through
      if (reg.rect.width >= vw * 0.88 && reg.rect.height >= vh * 0.88) continue
      const sx = baseRect.width / vw
      const sy = baseRect.height / vh
      const left = baseRect.left + reg.rect.x * sx
      const top = baseRect.top + reg.rect.y * sy
      const width = reg.rect.width * sx
      const height = reg.rect.height * sy
      if (cx >= left && cx <= left + width && cy >= top && cy <= top + height) {
        activeReview = undefined
        draftReviewId = crypto.randomUUID()
        selection = {
          surface: 'hud',
          asset: reg.asset ?? reg.id,
          instanceId: reg.id,
          source: reg.source ?? `hud#${reg.id}`,
          scope: 'hud',
          region: [0.5, 0.5, 0.5, 0.5],
          hudRegion: reg,
          screenRect: { left, top, width, height },
          previewYaw: 0,
          previewElevation: 0,
          spriteFrame: 0,
          spriteFrameMs: 120
        }
        setStatus(`Picked HUD region "${reg.label}".`)
        renderSelection()
        return
      }
    }

    // 2. Check 2D sprite draws (group per visible canvas; reverse draw order with alpha hit-test)
    const spriteDraws = getLastSpriteDraws()
    if (spriteDraws.length) {
      const byCanvas = new Map<HTMLCanvasElement, SpriteDrawRecord[]>()
      for (let i = 0; i < spriteDraws.length; i++) {
        const d = spriteDraws[i]
        let list = byCanvas.get(d.canvas)
        if (!list) {
          list = []
          byCanvas.set(d.canvas, list)
        }
        list.push(d)
      }
      const canvases = Array.from(byCanvas.keys())
      for (let c = canvases.length - 1; c >= 0; c--) {
        const spriteCanvas = canvases[c]
        const rect = spriteCanvas.getBoundingClientRect()
        if (!(rect.width > 0 && rect.height > 0 && cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom)) continue
        const u = (cx - rect.left) / rect.width
        const v = (cy - rect.top) / rect.height
        const canvasDraws = byCanvas.get(spriteCanvas)
        if (!canvasDraws) continue
        const hit = pickSpriteDraws(canvasDraws, u, v)
        if (hit) {
          const d = hit.draw
          const scaleX = rect.width / d.canvasWidth
          const scaleY = rect.height / d.canvasHeight
          const name = d.atlas.src.split('/').at(-1)?.replace(/\.png$/i, '') || d.atlas.id
          activeReview = undefined
          draftReviewId = crypto.randomUUID()
          selection = {
            surface: 'sprite',
            asset: name,
            instanceId: `${d.atlas.id}#${hit.index}`,
            source: d.atlas.manifestUrl ?? d.atlas.sourceSite ?? d.atlas.src,
            scope: 'sprite',
            region: [hit.localU, hit.localV, hit.localU, hit.localV],
            spriteHit: hit,
            screenRect: {
              left: rect.left + d.rect.x * scaleX,
              top: rect.top + d.rect.y * scaleY,
              width: d.rect.width * scaleX,
              height: d.rect.height * scaleY
            },
            previewYaw: 0,
            previewElevation: 0,
            spriteClip: d.clip,
            spriteFrame: d.frame,
            spriteFrameMs: (d.clip ? d.atlas.clips[d.clip]?.frameMs : undefined) ?? 120
          }
          setStatus(`Picked 2D sprite "${name}".`)
          renderSelection()
          return
        }
      }
    }

    // 3. Check 3D rendered frame (perspective + orthographic exact batch ID picking)
    const frame = getLastFrame()
    if (frame) {
      const rect = frame.canvas.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom) {
        const u = (cx - rect.left) / rect.width
        const v = (cy - rect.top) / rect.height
        const hit = pickRenderedScene(frame.batches, frame.viewProjection, frame.width, frame.height, u, v)
        if (hit) {
          const recognized = recognizeAssetFromPick(frame.batches, frame.viewProjection, hit)
          const artSource = recognized.kind === 'model' ? lookupArtSource(recognized.asset) : undefined
          const originalRecipe = artSource?.recipe ? structuredClone(artSource.recipe) : undefined
          const sb = recognized.screenBounds
          activeReview = undefined
          draftReviewId = crypto.randomUUID()
          selection = {
            surface: recognized.kind,
            asset: recognized.asset,
            instanceId: recognized.instanceId,
            source: artSource?.path ?? recognized.sourceSite,
            part: recognized.part,
            scope: 'asset',
            region: [0.5, 0.5, 0.5, 0.5],
            recognized,
            artSource,
            originalRecipe,
            draftRecipe: originalRecipe ? structuredClone(originalRecipe) : undefined,
            screenRect: sb ? {
              left: rect.left + sb[0] * rect.width,
              top: rect.top + sb[1] * rect.height,
              width: (sb[2] - sb[0]) * rect.width,
              height: (sb[3] - sb[1]) * rect.height
            } : undefined,
            previewYaw: 0.55,
            previewElevation: 0.42,
            spriteFrame: 0,
            spriteFrameMs: 120
          }
          setStatus(`Picked ${surfaceLabel(recognized.kind)} "${recognized.asset}" (${recognized.stats.triangleCount} tris).`)
          renderSelection()
          return
        }
      }
    }

    setStatus('No visible asset under that click.')
  }, signal)

  async function refreshReviews() {
    try {
      const { entries: saved, errors } = parseReviewList(await apiJson(REVIEWS_API))
      entries.clear()
      reviewSelect.replaceChildren(new Option(`Reviews (${saved.length})`, ''))
      for (const e of saved) {
        entries.set(e.note.id, e)
        reviewSelect.append(new Option(`${e.note.status} · ${e.note.target.view.asset} · ${e.note.comment.slice(0, 32)}`, e.note.id))
      }
      if (activeReview) {
        const refreshed = entries.get(activeReview.note.id)
        if (refreshed) {
          activeReview = refreshed
          reviewSelect.value = refreshed.note.id
        }
      }
      if (errors.length) setStatus('Could not load: ' + errors.join(', '))
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }

  let pendingRestore: { scene: unknown; entryId: string } | undefined
  const unsubHooks = onTestingHooksRegistered(hooks => {
    if (!pendingRestore || !hooks.restore) return
    const { scene, entryId } = pendingRestore
    pendingRestore = undefined
    Promise.resolve(hooks.restore(scene)).then(() => {
      if (activeReview?.note.id === entryId && selection) {
        const v = activeReview.note.target.view
        if (v.surface === 'model' && !selection.artSource) {
          const artSource = lookupArtSource(v.asset)
          if (artSource) {
            selection.artSource = artSource
            selection.originalRecipe = artSource.recipe ? structuredClone(artSource.recipe) : undefined
            selection.draftRecipe = selection.originalRecipe ? structuredClone(selection.originalRecipe) : undefined
          }
        }
        renderSelection()
      }
    }).catch(err => setStatus(errorMessage(err)))
  })

  async function openReview(entry: ReviewEntry) {
    if (!isTestingPaused()) setTestingPaused(true)
    const hasRestore = getTestingHooks().some(h => typeof h.restore === 'function')
    if (hasRestore) {
      pendingRestore = undefined
      await restoreSnapshot(entry.note.scene)
    } else if (entry.note.scene !== undefined && entry.note.scene !== null) {
      pendingRestore = { scene: entry.note.scene, entryId: entry.note.id }
    }
    const pin = entry.note.target
    const v = pin.view
    const artSource = v.surface === 'model' ? lookupArtSource(v.asset) : undefined
    const originalRecipe = artSource?.recipe ? structuredClone(artSource.recipe) : undefined
    activeReview = entry
    selection = {
      surface: v.surface,
      asset: v.asset,
      instanceId: v.instance,
      source: pin.editSource ?? v.source,
      part: pin.part,
      scope: pin.scope,
      region: [...pin.region],
      artSource,
      originalRecipe,
      draftRecipe: originalRecipe ? structuredClone(originalRecipe) : undefined,
      previewYaw: v.yaw,
      previewElevation: v.elevation,
      spriteClip: v.clip,
      spriteFrame: v.frame ?? 0,
      spriteFrameMs: 120,
      savedView: structuredClone(v)
    }
    reviewSelect.value = entry.note.id
    setTab('reviews')
    renderSelection()
  }

  reviewSelect.onchange = () => {
    const chosen = entries.get(reviewSelect.value)
    if (!chosen) return
    if (dirty) {
      reviewSelect.value = activeReview?.note.id ?? ''
      setStatus('Save or discard pending edits first.')
      return
    }
    openReview(chosen).catch(err => setStatus(errorMessage(err)))
  }

  refreshBtn.onclick = () => {
    refreshReviews().then(() => {
      if (selection && activeReview) renderReviewsPane(selection)
    })
  }

  window.addEventListener('resize', () => updateHighlight(), signal)

  // Initial load + resume review from URL or reload-compare state
  refreshReviews().then(async () => {
    if (disposed) return
    const rawState: unknown = history.state
    const studioState = isRecord(rawState) && isRecord(rawState.ridgetopStudio)
      ? rawState.ridgetopStudio
      : undefined
    const stateReviewId = typeof studioState?.reviewId === 'string' ? studioState.reviewId : undefined
    const stateScene = studioState?.scene
    const urlReview = new URLSearchParams(location.search).get('review')
    const wanted = stateReviewId ?? urlReview
    const wantedEntry = wanted ? entries.get(wanted) : undefined
    if (wantedEntry) {
      await openReview(wantedEntry)
    } else if (studioState && stateScene !== undefined && stateScene !== null) {
      if (!isTestingPaused()) setTestingPaused(true)
      const hasRestore = getTestingHooks().some(h => typeof h.restore === 'function')
      if (hasRestore) {
        await restoreSnapshot(stateScene)
      } else {
        pendingRestore = { scene: stateScene, entryId: '' }
      }
      setStatus('Restored pre-reload scene snapshot.')
    }
    if (!disposed && studioState) history.replaceState(null, '')
  }).catch(err => {
    if (!disposed) setStatus(errorMessage(err))
  })

  const handle: TestingStudioHandle = {
    root,
    pause: setPaused,
    refreshReviews,
    dispose() {
      if (disposed) return
      disposed = true
      if (activeStudioHandle === handle) activeStudioHandle = undefined
      stopSpriteAnim()
      unsubPause()
      unsubHooks()
      controller.abort()
      if (isTestingPaused()) setTestingPaused(false)
      root.remove()
    }
  }
  activeStudioHandle = handle
  return handle
}
