import { createArtKit } from './art.ts'
import { modelFromArtRecipe } from './art-recipe.ts'
import type { ArtShape } from './art-recipe.ts'
import { modelReviewFrame } from './art-review.ts'
import { createTurntableCamera } from './geometry.ts'
import { bakeSpriteDirections, renderMeshFrame } from './low-poly.ts'
import { allowedScopesForSurface, isReviewScope, resolveTestingUrlActivation } from './testing-protocol.ts'
import type { ReviewStorePort } from './testing-protocol.ts'
import { createTestingStudioSession, surfaceLabel } from './testing-session.ts'
import type { ArtRecipeEditor, StudioSelection, TestingStudioSession } from './testing-session.ts'
import { mountDecisionAgentPane } from './testing-decision-ui.ts'
import { getLastFrame, isTestingPaused, setTestingActive } from './testing-runtime.ts'
import type { HudRegion, RecognizedAsset, SpriteDrawRecord } from './testing-runtime.ts'
import type { BlendMode, InstanceBatch } from './types.ts'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
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

function renderRecognizedPreview(recognized: RecognizedAsset, size = 256, yaw = 0.55, elevation = 0.42): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const frame = getLastFrame()
  if (!frame) return canvas
  const { center, size: dim } = recognized.bounds
  const span = Math.max(0.5, Math.hypot(dim[0], dim[1], dim[2]) * 1.25)
  const cam = createTurntableCamera(span, center, yaw, elevation)
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

function isBlendModeOption(value: string): value is BlendMode {
  return value === 'opaque' || value === 'alpha' || value === 'additive'
}

function bindOrbitDrag(
  canvas: HTMLCanvasElement,
  sel: StudioSelection,
  session: TestingStudioSession,
  paint: () => void
) {
  let orbitDrag: { id: number; x: number; y: number; yaw: number; elev: number } | undefined
  canvas.onpointerdown = event => {
    if (event.button !== 0) return
    orbitDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: sel.previewYaw, elev: sel.previewElevation }
    try { canvas.setPointerCapture(event.pointerId) } catch { /* Ignore synthetic capture failure. */ }
  }
  canvas.onpointermove = event => {
    if (!orbitDrag || orbitDrag.id !== event.pointerId) return
    session.setPreviewOrbit(
      orbitDrag.yaw + (event.clientX - orbitDrag.x) * 0.015,
      orbitDrag.elev + (event.clientY - orbitDrag.y) * 0.012
    )
    paint()
  }
  canvas.onpointerup = event => {
    if (orbitDrag?.id === event.pointerId) orbitDrag = undefined
  }
}

function bindRegionDrag(
  canvas: HTMLCanvasElement,
  session: TestingStudioSession,
  paint: () => void
) {
  let drag: { id: number; x: number; y: number } | undefined
  canvas.onpointerdown = event => {
    if (event.button !== 0) return
    const [u, v] = measureNormalized(canvas, event)
    drag = { id: event.pointerId, x: u, y: v }
    session.setRegion([u, v, u, v])
    try { canvas.setPointerCapture(event.pointerId) } catch { /* Ignore capture error. */ }
    paint()
  }
  canvas.onpointermove = event => {
    if (!drag || drag.id !== event.pointerId) return
    const [u, v] = measureNormalized(canvas, event)
    session.setRegion([Math.min(drag.x, u), Math.min(drag.y, v), Math.max(drag.x, u), Math.max(drag.y, v)])
    paint()
  }
  canvas.onpointerup = event => {
    if (drag?.id === event.pointerId) drag = undefined
  }
}

/**
 * Determine whether the injected Testing Studio script should auto-mount for the current URL search string.
 * Unifies `?testing=0|false` opt-out and `?testing=1|true` / `?review=` activation with `testing-runtime.ts`.
 */
export function shouldAutoMountTestingStudio(search?: string): boolean {
  return resolveTestingUrlActivation(search, true)
}

export interface TestingStudioHandle {
  readonly root: HTMLDivElement
  readonly session: TestingStudioSession
  pause(paused: boolean): void
  refreshReviews(): Promise<void>
  dispose(): void
}

let activeStudioHandle: TestingStudioHandle | undefined

/**
 * Mount the game-agnostic Ridgetop Testing Mode bar and unified In-Game Asset Studio drawer.
 * Thin DOM presentation adapter over the headless `createTestingStudioSession` controller.
 */
export function mountTestingStudio(options: { store?: ReviewStorePort; session?: TestingStudioSession } = {}): TestingStudioHandle {
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

  const session = options.session ?? createTestingStudioSession({ store: options.store })
  const controller = new AbortController()
  const signal = { signal: controller.signal }

  const root = el('div', { id: 'ridgetop-testing-root' })
  const pickLayer = el('div', { className: 'rt-pick-layer' })
  const highlight = el('div', { className: 'rt-highlight' })
  highlight.hidden = true
  const highlightLabel = el('span', { className: 'rt-highlight-label' })
  highlight.append(highlightLabel)

  const bar = el('div', { className: 'rt-bar', id: 'ridgetop-testing-bar' })
  const brand = el('span', { className: 'rt-brand', text: 'TESTING' })
  const pauseBtn = el('button', { className: 'rt-btn rt-btn-primary', type: 'button', id: 'rt-pause-btn', text: 'Pause & Inspect (F9)' })
  const agentBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-agent-btn', text: 'Decision Agent' })
  const popoutBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-popout-btn', text: 'Pop Out ↗', title: 'Open Decision Agent in a separate window and minimize this bar' })
  const reviewSelect = el('select', { className: 'rt-select', id: 'rt-review-select' })
  reviewSelect.setAttribute('aria-label', 'Saved reviews')
  reviewSelect.append(new Option('Reviews (0)', ''))
  const refreshBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-refresh-btn', text: 'Refresh' })
  const statusPill = el('span', { className: 'rt-status-pill', id: 'rt-status-pill', text: 'Live' })
  const collapseBtn = el('button', { className: 'rt-btn', type: 'button', id: 'rt-collapse-btn', text: '–', title: 'Minimize testing bar' })
  bar.append(brand, pauseBtn, agentBtn, popoutBtn, reviewSelect, refreshBtn, statusPill, collapseBtn)

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
  const agentTabBtn = el('button', { className: 'rt-tab', type: 'button', id: 'rt-tab-agent', text: 'Decision Agent' })
  tabs.append(editorTabBtn, reviewsTabBtn, agentTabBtn)

  const body = el('div', { className: 'rt-drawer-body' })
  const editorPane = el('div', { className: 'rt-pane' })
  const reviewsPane = el('div', { className: 'rt-pane' })
  const agentPane = el('div', { className: 'rt-pane', id: 'rt-agent-pane' })
  reviewsPane.hidden = true
  agentPane.hidden = true
  body.append(editorPane, reviewsPane, agentPane)

  const footerMsg = el('div', { className: 'rt-footer-msg', text: '' })
  drawer.append(drawerHead, tabs, body, footerMsg)

  root.append(pickLayer, highlight, bar, drawer)
  document.body.append(root)

  let lastPreviewCanvas: HTMLCanvasElement | undefined
  let spriteImportCanvas: HTMLCanvasElement | undefined
  let spriteAnimTimer: number | undefined

  function stopSpriteAnim() {
    if (spriteAnimTimer !== undefined) {
      clearInterval(spriteAnimTimer)
      spriteAnimTimer = undefined
    }
  }

  function syncFooter() {
    footerMsg.textContent = session.getStatus()
  }

  function notifyTestingBarChange() {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('ridgetop:testing-bar-change'))
    }
  }

  function setBarCollapsed(collapsed: boolean) {
    bar.classList.toggle('rt-bar-collapsed', collapsed)
    collapseBtn.textContent = collapsed ? 'TESTING ▾' : '–'
    collapseBtn.title = collapsed ? 'Expand testing bar' : 'Minimize testing bar'
    notifyTestingBarChange()
  }

  function openAgentPopout() {
    window.open('/__testing/agent', 'ridgetop-decision-agent', 'width=480,height=880')
    drawer.hidden = true
    setBarCollapsed(true)
  }

  collapseBtn.onclick = () => {
    setBarCollapsed(!bar.classList.contains('rt-bar-collapsed'))
  }
  popoutBtn.onclick = () => {
    decisionUi.stop()
    openAgentPopout()
  }

  const decisionUi = mountDecisionAgentPane(agentPane, {
    onStatus(msg) {
      footerMsg.textContent = msg
    },
    onPopout: openAgentPopout
  })

  function setTab(next: 'editor' | 'reviews' | 'agent') {
    editorTabBtn.classList.toggle('rt-tab-active', next === 'editor')
    reviewsTabBtn.classList.toggle('rt-tab-active', next === 'reviews')
    agentTabBtn.classList.toggle('rt-tab-active', next === 'agent')
    editorPane.hidden = next !== 'editor'
    reviewsPane.hidden = next !== 'reviews'
    agentPane.hidden = next !== 'agent'
    if (next === 'agent') {
      badge.textContent = 'AI Agent'
      titleEl.textContent = 'Decision API Inspector'
      metaEl.textContent = 'Live action selection & probabilities'
      decisionUi.refresh()
    }
  }

  editorTabBtn.onclick = () => setTab('editor')
  reviewsTabBtn.onclick = () => setTab('reviews')
  agentTabBtn.onclick = () => setTab('agent')
  agentBtn.onclick = () => {
    const opening = drawer.hidden || agentPane.hidden
    if (opening) {
      drawer.hidden = false
      setTab('agent')
    } else {
      drawer.hidden = true
    }
  }
  closeDrawerBtn.onclick = () => {
    drawer.hidden = true
    highlight.hidden = true
    stopSpriteAnim()
  }

  function updateHighlight() {
    const sel = session.getSelection()
    if (!session.isPaused() || !sel?.screenRect) {
      highlight.hidden = true
      return
    }
    const r = sel.screenRect
    highlight.hidden = false
    highlight.style.left = `${Math.round(r.left)}px`
    highlight.style.top = `${Math.round(r.top)}px`
    highlight.style.width = `${Math.max(12, Math.round(r.width))}px`
    highlight.style.height = `${Math.max(12, Math.round(r.height))}px`
    highlightLabel.textContent = sel.part ? `${sel.asset} · ${sel.part}` : sel.asset
  }

  function syncReviewSelect() {
    const saved = session.listReviews()
    const activeId = session.getActiveReview()?.note.id ?? ''
    reviewSelect.replaceChildren(new Option(`Reviews (${saved.length})`, ''))
    for (const e of saved) {
      reviewSelect.append(new Option(`${e.note.status} · ${e.note.target.view.asset} · ${e.note.comment.slice(0, 32)}`, e.note.id))
    }
    reviewSelect.value = activeId
  }

  function syncPauseUi() {
    const paused = session.isPaused()
    pauseBtn.textContent = paused ? 'Resume (F9)' : 'Pause & Inspect (F9)'
    pickLayer.classList.toggle('rt-picking', paused)
    statusPill.textContent = paused ? 'Paused — click to inspect' : 'Live'
    statusPill.classList.toggle('rt-paused', paused)
    if (!paused) {
      stopSpriteAnim()
      spriteImportCanvas = undefined
      drawer.hidden = true
      highlight.hidden = true
      reviewSelect.value = ''
    }
  }

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

  function renderCurrentAssetImage(sel: StudioSelection): HTMLCanvasElement {
    const recipe = sel.recipeEditor?.getRecipe()
    if (sel.surface === 'model' && recipe) {
      const model = modelFromArtRecipe(recipe)
      const kit = createArtKit<string>({ palette: recipe.palette, models: { [sel.asset]: model } })
      const pose = session.buildArtView(sel)
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
      return renderSpriteFrameCanvas(d, col, row, d.flip, spriteImportCanvas)
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
    syncFooter()
    const sel = session.getSelection()
    if (!sel) {
      renderEmptyDrawer()
      return
    }
    drawer.hidden = false
    badge.textContent = surfaceLabel(sel.surface)
    titleEl.replaceChildren(badge, document.createTextNode(sel.asset))
    metaEl.textContent = [sel.instanceId, sel.part ? `part: ${sel.part}` : undefined, sel.source].filter(Boolean).join(' · ')
    updateHighlight()
    renderEditorPane(sel)
    renderReviewsPane(sel)
  }

  function renderEditorPane(sel: StudioSelection) {
    editorPane.replaceChildren()
    if (sel.surface === 'model' && sel.recipeEditor) {
      renderArtRecipeEditor(sel, sel.recipeEditor)
    } else if (sel.surface === 'sprite' && sel.spriteHit) {
      renderSpriteEditor(sel)
    } else {
      renderReadOnlyInspector(sel)
    }
  }

  function renderArtRecipeEditor(sel: StudioSelection, editor: ArtRecipeEditor) {
    const previewSection = el('div', { className: 'rt-section' })
    const previewWrap = el('div', { className: 'rt-preview-wrap' })
    const previewCanvas = el('canvas', { className: 'rt-preview-canvas' })
    previewWrap.append(previewCanvas)

    const orbitRow = el('div', { className: 'rt-row' })
    const fitBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Fit & Ground' })
    const undoBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Undo' })
    orbitRow.append(el('span', { className: 'rt-muted rt-grow', text: 'Drag preview to orbit' }), undoBtn, fitBtn)
    previewSection.append(previewWrap, orbitRow)

    const compareDetails = document.createElement('details')
    compareDetails.className = 'rt-section'
    const compareSummary = el('summary', { className: 'rt-section-title', text: '3-Angle & Silhouette Compare' })
    const silLabel = el('label', { className: 'rt-row' })
    const silCheck = el('input', { type: 'checkbox' })
    silLabel.append(silCheck, el('span', { text: 'Silhouette mode' }))
    const compareGrid = el('div', { className: 'rt-compare-grid' })
    const angleCanvases = (['front', 'right', 'back'] as const).map(angle => {
      const fig = el('figure', { className: 'rt-compare-cell' })
      const c = document.createElement('canvas')
      fig.append(el('figcaption', { text: angle[0].toUpperCase() + angle.slice(1) }), c)
      compareGrid.append(fig)
      return { angle, canvas: c }
    })
    silCheck.onchange = () => compareGrid.classList.toggle('rt-silhouettes', silCheck.checked)
    compareDetails.append(compareSummary, silLabel, compareGrid)

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
    const toneSelect = el('select', { className: 'rt-select' })
    for (const tone of editor.getAvailableTones()) toneSelect.append(new Option(tone, tone))
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

    const styleRow = el('div', { className: 'rt-grid-3' })
    const unlitInput = el('input', { className: 'rt-input', type: 'number' })
    unlitInput.min = '0'; unlitInput.max = '1'; unlitInput.step = '0.05'
    const alphaInput = el('input', { className: 'rt-input', type: 'number' })
    alphaInput.min = '0'; alphaInput.max = '1'; alphaInput.step = '0.05'
    const shadeInput = el('input', { className: 'rt-input', type: 'number' })
    shadeInput.min = '-0.5'; shadeInput.max = '0.5'; shadeInput.step = '0.05'
    styleRow.append(
      el('label', { className: 'rt-field', text: 'Unlit (0–1)' }, unlitInput),
      el('label', { className: 'rt-field', text: 'Alpha (0–1)' }, alphaInput),
      el('label', { className: 'rt-field', text: 'Shade (-0.5–0.5)' }, shadeInput)
    )

    const blendSelect = el('select', { className: 'rt-select' })
    for (const mode of ['', 'opaque', 'alpha', 'additive']) blendSelect.append(new Option(mode || 'auto', mode))
    const blendWrap = el('label', { className: 'rt-field', text: 'Blend' }, blendSelect)

    partsSection.append(partRow, nameShapeRow, posCtrl.grid, sclCtrl.grid, rotCtrl.grid, styleRow, blendWrap)

    const paletteSection = el('div', { className: 'rt-section' })
    paletteSection.append(el('h3', { className: 'rt-section-title', text: 'Palette Swatches' }))
    const swatches = el('div', { className: 'rt-swatches' })
    for (const tone of editor.getAvailableTones()) {
      const picker = el('input', { type: 'color' })
      picker.value = editor.getPaletteColor(tone)
      picker.oninput = () => {
        try {
          editor.setPaletteColor(tone, picker.value)
          paintPreviews()
          syncSaveButtons()
        } catch (error) {
          session.setStatus(errorMessage(error))
        }
      }
      swatches.append(el('label', { className: 'rt-swatch' }, picker, document.createTextNode(tone)))
    }
    paletteSection.append(swatches)

    const actionRow = el('div', { className: 'rt-row' })
    const saveBtn = el('button', { className: 'rt-btn rt-btn-primary', type: 'button', text: 'Save Recipe' })
    const discardBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Discard' })
    const downloadBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Download .art.json' })
    actionRow.append(saveBtn, discardBtn, downloadBtn)

    function syncSaveButtons() {
      const busy = session.isBusy()
      const dirty = editor.isDirty()
      saveBtn.disabled = !dirty || busy
      discardBtn.disabled = !dirty || busy
      undoBtn.disabled = !editor.canUndo() || busy
      delPartBtn.disabled = editor.getRecipe().parts.length <= 1 || busy
    }

    function paintPreviews() {
      try {
        const recipe = editor.getRecipe()
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
        session.setStatus(errorMessage(error))
      }
    }

    function populatePartFields() {
      const recipe = editor.getRecipe()
      partSelect.replaceChildren(...recipe.parts.map((p, idx) => new Option(p.name, String(idx))))
      partSelect.value = String(editor.getSelectedPartIndex())
      const part = editor.getSelectedPart()
      sel.part = part.name
      nameInput.value = part.name
      const shapes = editor.getAvailableShapes()
      shapeSelect.replaceChildren(...shapes.map(s => new Option(s, s)))
      shapeSelect.value = part.shape
      shapeSelect.disabled = part.shape === 'tube'
      toneSelect.value = part.tone
      for (let i = 0; i < 3; i++) {
        posCtrl.inputs[i].value = String(round3(part.position[i]))
        sclCtrl.inputs[i].value = String(round3(part.scale[i]))
      }
      rotCtrl.inputs[0].value = String(round3((part.pitch ?? 0) * 180 / Math.PI))
      rotCtrl.inputs[1].value = String(round3((part.yaw ?? 0) * 180 / Math.PI))
      rotCtrl.inputs[2].value = String(round3((part.roll ?? 0) * 180 / Math.PI))
      unlitInput.value = String(round3(part.unlit ?? 0))
      alphaInput.value = String(round3(part.alpha ?? 1))
      shadeInput.value = String(round3(part.shade ?? 0))
      blendSelect.value = part.blend ?? ''
      syncSaveButtons()
    }

    function applyFieldChanges() {
      try {
        const part = editor.getSelectedPart()
        const shapeVal = shapeSelect.value
        const nextShape: ArtShape | 'tube' | undefined = part.shape === 'tube'
          ? undefined
          : editor.getAvailableShapes().find(s => s === shapeVal)
        const alphaVal = alphaInput.valueAsNumber
        const shadeVal = shadeInput.valueAsNumber
        const blendVal = blendSelect.value
        const updated = editor.updatePart({
          name: nameInput.value,
          ...(nextShape !== undefined ? { shape: nextShape } : {}),
          tone: toneSelect.value,
          position: [posCtrl.inputs[0].valueAsNumber, posCtrl.inputs[1].valueAsNumber, posCtrl.inputs[2].valueAsNumber],
          scale: [sclCtrl.inputs[0].valueAsNumber, sclCtrl.inputs[1].valueAsNumber, sclCtrl.inputs[2].valueAsNumber],
          rotationDeg: [rotCtrl.inputs[0].valueAsNumber, rotCtrl.inputs[1].valueAsNumber, rotCtrl.inputs[2].valueAsNumber],
          unlit: unlitInput.valueAsNumber,
          alpha: Number.isFinite(alphaVal) && alphaVal < 1 ? alphaVal : null,
          shade: Number.isFinite(shadeVal) && shadeVal !== 0 ? shadeVal : null,
          blend: isBlendModeOption(blendVal) ? blendVal : null
        })
        sel.part = updated.name
        partSelect.options[editor.getSelectedPartIndex()].text = updated.name
        session.setStatus('')
        paintPreviews()
        syncSaveButtons()
      } catch (error) {
        session.setStatus(errorMessage(error))
      }
    }

    partSelect.onchange = () => {
      editor.selectPart(Number(partSelect.value) || 0)
      populatePartFields()
    }
    nameInput.onchange = applyFieldChanges
    shapeSelect.onchange = applyFieldChanges
    toneSelect.onchange = applyFieldChanges
    unlitInput.onchange = applyFieldChanges
    alphaInput.onchange = applyFieldChanges
    shadeInput.onchange = applyFieldChanges
    blendSelect.onchange = applyFieldChanges
    for (const inp of [...posCtrl.inputs, ...sclCtrl.inputs, ...rotCtrl.inputs]) inp.onchange = applyFieldChanges

    addPartBtn.onclick = () => {
      editor.addPart()
      populatePartFields()
      paintPreviews()
    }
    dupPartBtn.onclick = () => {
      editor.duplicatePart()
      populatePartFields()
      paintPreviews()
    }
    delPartBtn.onclick = () => {
      try {
        editor.deletePart()
        populatePartFields()
        paintPreviews()
      } catch (error) {
        session.setStatus(errorMessage(error))
      }
    }
    undoBtn.onclick = () => {
      if (session.undoRecipeEdit()) renderSelection()
    }
    fitBtn.onclick = () => {
      try {
        session.fitRecipe()
        renderSelection()
      } catch (error) {
        session.setStatus(errorMessage(error))
      }
    }
    discardBtn.onclick = () => {
      session.discardRecipeEdits()
      renderSelection()
    }
    downloadBtn.onclick = () => {
      const recipe = editor.getRecipe()
      const blob = new Blob([editor.toJson()], { type: 'application/json' })
      downloadBlob(blob, `${recipe.name}.art.json`)
    }
    saveBtn.onclick = async () => {
      syncSaveButtons()
      try {
        await session.saveRecipe()
      } catch (error) {
        session.setStatus(errorMessage(error))
      } finally {
        syncSaveButtons()
      }
    }

    bindOrbitDrag(previewCanvas, sel, session, paintPreviews)
    editorPane.append(previewSection, compareDetails, partsSection, paletteSection, actionRow)
    populatePartFields()
    paintPreviews()
  }

  function renderSpriteEditor(sel: StudioSelection) {
    const spriteHit = sel.spriteHit
    if (!spriteHit) return
    const draw = spriteHit.draw
    const atlas = draw.atlas
    const clipNames = Object.keys(atlas.clips)
    if (!sel.spriteClip && clipNames.length) session.selectSpriteClip(draw.clip ?? clipNames[0])

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
    const saveSpriteBtn = el('button', { className: 'rt-btn rt-btn-primary', type: 'button', text: 'Save Sprite' })
    const importInput = el('input', { type: 'file' })
    importInput.accept = 'image/png,image/jpeg,image/webp'
    importInput.hidden = true
    ioRow.append(exportPngBtn, importBtn, saveSpriteBtn, importInput)

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
      session.selectSpriteClip(clipSelect.value || undefined)
      const clip = sel.spriteClip ? atlas.clips[sel.spriteClip] : undefined
      frameMsInput.value = String(sel.spriteFrameMs)
      frameSlider.max = String(Math.max(0, (clip?.frames ?? 1) - 1))
      frameSlider.value = '0'
      paintSprite()
    }
    frameSlider.oninput = () => {
      session.setSpriteFrame(Number(frameSlider.value) || 0)
      paintSprite()
    }
    frameMsInput.onchange = () => {
      session.setSpriteFrameMs(frameMsInput.valueAsNumber)
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
        session.setSpriteFrame((sel.spriteFrame + 1) % frames)
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
        spriteImportCanvas = copy
        paintSprite()
        session.setStatus(`Loaded preview image ${file.name}.`)
      } catch {
        session.setStatus('Could not decode imported image.')
      }
    }
    saveSpriteBtn.onclick = async () => {
      saveSpriteBtn.disabled = true
      try {
        const pngBase64 = spriteImportCanvas ? spriteImportCanvas.toDataURL('image/png').split(',')[1] : undefined
        await session.saveSprite(pngBase64)
      } catch (error) {
        session.setStatus(errorMessage(error))
      } finally {
        saveSpriteBtn.disabled = false
      }
    }

    bindRegionDrag(previewCanvas, session, paintSprite)
    section.append(previewWrap, regionInfo, controlsRow, scrubRow, ioRow, metaList)
    editorPane.append(section)
    paintSprite()
  }

  function renderReadOnlyInspector(sel: StudioSelection) {
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
      bindOrbitDrag(previewCanvas, sel, session, paint)

      const infoSection = el('div', { className: 'rt-section' })
      infoSection.append(
        el('h3', { className: 'rt-section-title', text: 'Recognized Asset Metadata' }),
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
        item.append(left, el('span', { className: 'rt-muted', text: `${m.shape ?? 'mesh'} · ${m.triangles}△` }))
        item.onclick = () => {
          session.selectPart(m.part)
          renderSelection()
        }
        list.append(item)
      }
      membersSection.append(list, el('div', { className: 'rt-muted', text: 'Switch to Comments / Reviews to pin visual feedback with source attribution.' }))
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

  function renderReviewsPane(sel: StudioSelection) {
    reviewsPane.replaceChildren()
    const activeReview = session.getActiveReview()

    const previewSection = el('div', { className: 'rt-section' })
    const pinCanvas = el('canvas', { className: 'rt-preview-canvas' + (sel.surface === 'sprite' ? ' rt-pixelated' : '') })

    if (activeReview) {
      const grid = el('div', { className: 'rt-before-grid' })
      const beforeImg = document.createElement('img')
      beforeImg.alt = 'Saved before snapshot'
      beforeImg.src = session.beforeImageUrl(activeReview.note.id)
      grid.append(
        el('figure', undefined, el('figcaption', { text: 'Before' }), beforeImg),
        el('figure', undefined, el('figcaption', { text: 'Current' }), pinCanvas)
      )
      previewSection.append(grid)
    } else {
      previewSection.append(
        el('div', { className: 'rt-preview-wrap' }, pinCanvas),
        el('div', { className: 'rt-muted', text: 'Click to pin a point or drag a box on the preview.' })
      )
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

    if (!activeReview) bindRegionDrag(pinCanvas, session, paintPinPreview)

    const targetSection = el('div', { className: 'rt-section' })
    const row = el('div', { className: 'rt-grid-2' })
    const scopeSelect = el('select', { className: 'rt-select' })
    const allowedScopes = allowedScopesForSurface(sel.surface)
    for (const sc of allowedScopes) scopeSelect.append(new Option(sc, sc))
    if (!allowedScopes.includes(sel.scope)) sel.scope = allowedScopes[0]
    scopeSelect.value = sel.scope
    scopeSelect.disabled = Boolean(activeReview)
    scopeSelect.onchange = () => {
      if (isReviewScope(scopeSelect.value)) session.setScope(scopeSelect.value)
    }

    const partInput = el('input', { className: 'rt-input', type: 'text' })
    partInput.value = sel.part ?? ''
    partInput.placeholder = 'Whole asset'
    partInput.disabled = Boolean(activeReview)
    partInput.onchange = () => { session.selectPart(partInput.value) }

    row.append(
      el('label', { className: 'rt-field', text: 'Scope' }, scopeSelect),
      el('label', { className: 'rt-field', text: 'Part / Joint' }, partInput)
    )
    targetSection.append(row, el('div', { className: 'rt-muted', text: `Edit source: ${sel.source}` }))

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
    const deleteBtn = el('button', { className: 'rt-btn rt-btn-danger', type: 'button', text: 'Delete' })
    deleteBtn.hidden = !activeReview
    const reloadCompareBtn = el('button', { className: 'rt-btn', type: 'button', text: 'Reload & Compare' })
    btnRow.append(submitBtn, resolveBtn, deleteBtn, reloadCompareBtn)
    formSection.append(
      el('label', { className: 'rt-field', text: activeReview ? 'Reply' : 'Comment' }, textarea),
      btnRow
    )
    reviewsPane.append(formSection)

    submitBtn.onclick = async () => {
      const commentText = textarea.value.trim()
      if (!commentText) { session.setStatus('Write a comment first.'); return }
      submitBtn.disabled = true
      try {
        if (session.getActiveReview()) {
          await session.replyToReview(commentText)
        } else {
          const preview = lastPreviewCanvas ?? renderCurrentAssetImage(sel)
          const pngBase64 = preview.toDataURL('image/png').split(',')[1]
          await session.createReview(commentText, pngBase64)
        }
        syncReviewSelect()
        renderReviewsPane(sel)
      } catch (error) {
        session.setStatus(errorMessage(error))
      } finally {
        submitBtn.disabled = false
      }
    }

    resolveBtn.onclick = async () => {
      resolveBtn.disabled = true
      try {
        await session.toggleResolveReview(textarea.value)
        syncReviewSelect()
        renderReviewsPane(sel)
      } catch (error) {
        session.setStatus(errorMessage(error))
      } finally {
        resolveBtn.disabled = false
      }
    }

    deleteBtn.onclick = async () => {
      deleteBtn.disabled = true
      try {
        await session.deleteReview()
        syncReviewSelect()
        renderReviewsPane(sel)
      } catch (error) {
        session.setStatus(errorMessage(error))
      } finally {
        deleteBtn.disabled = false
      }
    }

    reloadCompareBtn.onclick = () => {
      history.replaceState(session.prepareReloadCompareState(), '')
      location.reload()
    }

    paintPinPreview()
  }

  function setPaused(paused: boolean) {
    const result = session.setPaused(paused)
    if (!result.ok) return
    if (paused && !session.getSelection()) {
      drawer.hidden = false
      renderEmptyDrawer()
    }
  }

  const unsubSession = session.onChange(() => {
    if (disposed) return
    syncFooter()
    syncPauseUi()
    syncReviewSelect()
  })

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

  pickLayer.addEventListener('click', event => {
    const res = session.pickAt(event.clientX, event.clientY)
    if (res.picked) {
      spriteImportCanvas = undefined
      renderSelection()
    }
  }, signal)

  async function refreshReviews() {
    try {
      await session.refreshReviews()
      syncReviewSelect()
    } catch (error) {
      session.setStatus(errorMessage(error))
    }
  }

  reviewSelect.onchange = () => {
    const id = reviewSelect.value
    if (!id) return
    session.openReview(id).then(() => {
      setTab('reviews')
      renderSelection()
    }).catch(err => {
      reviewSelect.value = session.getActiveReview()?.note.id ?? ''
      session.setStatus(errorMessage(err))
    })
  }

  refreshBtn.onclick = () => {
    refreshReviews().then(() => {
      const sel = session.getSelection()
      if (sel && session.getActiveReview()) renderReviewsPane(sel)
    })
  }

  window.addEventListener('resize', () => updateHighlight(), signal)

  // Initial load + resume review from URL or reload-compare state
  refreshReviews().then(async () => {
    if (disposed) return
    const resumed = await session.resumeFromNavigation({
      historyState: history.state,
      search: location.search
    })
    if (disposed) return
    if (resumed.openedReview) {
      setTab('reviews')
      renderSelection()
    }
    if (resumed.clearHistoryState) history.replaceState(null, '')
  }).catch(err => {
    if (!disposed) session.setStatus(errorMessage(err))
  })

  // Auto-open Decision Agent drawer when `?agent=1` is present in the URL.
  try {
    const params = new URLSearchParams(location.search)
    if (params.get('agent') === '1' || params.get('agent') === 'true') {
      drawer.hidden = false
      setTab('agent')
    }
  } catch { /* Ignore invalid location search. */ }

  const handle: TestingStudioHandle = {
    root,
    session,
    pause: setPaused,
    refreshReviews,
    dispose() {
      if (disposed) return
      disposed = true
      if (activeStudioHandle === handle) activeStudioHandle = undefined
      stopSpriteAnim()
      decisionUi.dispose()
      unsubSession()
      session.dispose()
      controller.abort()
      root.remove()
      notifyTestingBarChange()
    }
  }
  activeStudioHandle = handle
  notifyTestingBarChange()
  return handle
}

// Auto-boot when injected into a game page by `createGameHost({ testing: true })`.
if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  if (shouldAutoMountTestingStudio(location.search)) {
    setTestingActive(true)
    const start = () => {
      if (document.getElementById('ridgetop-testing-root')) return
      mountTestingStudio()
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true })
    } else {
      start()
    }
  } else {
    setTestingActive(false)
  }
}
