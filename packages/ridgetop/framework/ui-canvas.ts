import type { HudPainter } from './hud.ts'
import { createHudPainter } from './hud.ts'
import { readConnectedGamepads } from './input.ts'
import type { LayoutNode, LayoutRect, SafeInsets } from './ui-layout.ts'
import { resolveLayout } from './ui-layout.ts'
import { isTestingActive, isTestingPaused, onTestingPause, recordCanvasUiRegions } from './testing-runtime.ts'
import type { HudRegion } from './testing-runtime.ts'

export type CanvasUiUnderlay = (painter: HudPainter, ctx: CanvasRenderingContext2D) => void

export interface CanvasUiViewport {
  width: number
  height: number
  pixelRatio?: number
  underlay?: CanvasUiUnderlay | null
}

export interface UiTheme {
  readonly surface: string
  readonly surfaceAlt: string
  readonly surfaceTop: string
  readonly border: string
  readonly accent: string
  readonly accentText: string
  readonly text: string
  readonly muted: string
  readonly scrim: string
  readonly bevel: number
  readonly font: string
  readonly mono: string
}

/** Build a low-poly UI theme harmonized with a game's art palette. */
export function createUiTheme(palette: Partial<Record<string, string>> = {}): UiTheme {
  return {
    surface: palette.uiSurface ?? '#16282ce8',
    surfaceAlt: palette.uiSurfaceAlt ?? '#213a3ff0',
    surfaceTop: palette.uiTop ?? '#35575c99',
    border: palette.uiBorder ?? '#63867f99',
    accent: palette.accent ?? '#efac62',
    accentText: palette.accentText ?? '#162326',
    text: palette.light ?? '#f3f6e4',
    muted: palette.muted ?? '#bcd2c8',
    scrim: palette.scrim ?? '#0b161bc8',
    bevel: 7,
    font: '"Avenir Next", system-ui, sans-serif',
    mono: 'ui-monospace, SFMono-Regular, monospace'
  }
}

export interface CanvasWidgetDrawState {
  readonly hovered: boolean
  readonly pressed: boolean
  readonly focused: boolean
  readonly selected: boolean
  readonly disabled: boolean
}

export interface CanvasSelectOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}

export type CanvasWidget =
  | {
      type: 'panel'
      fill?: string
      stroke?: string
      scrim?: boolean
      bevel?: number
      blocksPointer?: boolean
      draw?(ctx: CanvasRenderingContext2D, rect: LayoutRect, state: CanvasWidgetDrawState): void
    }
  | { type: 'text'; text: string; size?: number; weight?: number; color?: string; align?: CanvasTextAlign; mono?: boolean; wrap?: boolean }
  | { type: 'icon'; image: CanvasImageSource; padding?: number; pixelated?: boolean }
  | {
      type: 'button'
      label: string
      subtitle?: string
      primary?: boolean
      disabled?: boolean
      selected?: boolean
      fill?: string
      stroke?: string
      accent?: string
      badge?: { text: string; fill?: string; color?: string }
      icon?: CanvasImageSource
      pips?: { filled: number; total: number }
      draw?(ctx: CanvasRenderingContext2D, rect: LayoutRect, state: CanvasWidgetDrawState): void
      onPress?(): void
      onHold?(active: boolean): void
    }
  | { type: 'toggle'; label: string; checked: boolean; disabled?: boolean; onToggle?(next: boolean): void }
  | {
      type: 'select'
      label: string
      valueLabel: string
      value?: string
      options?: readonly CanvasSelectOption[]
      disabled?: boolean
      onNext?(): void
      onPrev?(): void
      onSelect?(value: string): void
    }
  | {
      type: 'slider'
      label: string
      ratio: number
      step?: number
      valueText?: string
      disabled?: boolean
      onChange?(ratio: number): void
      onDragEnd?(): void
    }
  | { type: 'bar'; ratio: number; label?: string; valueText?: string; fill?: string; track?: string; stroke?: string }

export type CanvasWidgetKind = 'button' | 'toggle' | 'select' | 'slider'

export type CanvasWidgetState =
  | 'disabled'
  | 'pressed'
  | 'hovered'
  | 'focused'
  | 'checked'
  | 'unchecked'
  | 'selected'
  | 'idle'

export interface CanvasUiWidgetSnapshot {
  readonly id: string
  readonly kind: CanvasWidgetKind
  readonly role: CanvasWidgetKind
  readonly label: string
  readonly subtitle?: string
  readonly state: CanvasWidgetState
  readonly value?: string | number | boolean
  readonly checked?: boolean
  readonly disabled: boolean
  readonly focused: boolean
  readonly hovered: boolean
  readonly pressed: boolean
  readonly selected?: boolean
  readonly bounds: LayoutRect
  readonly actions: readonly string[]
}

export interface CanvasUiQuery {
  id?: string
  kind?: string
  role?: string
  state?: string
  label?: string
  disabled?: boolean
}

type InteractiveCanvasWidget = Extract<CanvasWidget, { type: CanvasWidgetKind }>

export interface CanvasUiHit {
  readonly id: string
  readonly rect: LayoutRect
  readonly widget: InteractiveCanvasWidget
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function sliderStep(widget: Extract<CanvasWidget, { type: 'slider' }>): number {
  return widget.step !== undefined && Number.isFinite(widget.step) && widget.step > 0 ? widget.step : 0.1
}

function stepSelectOption(widget: Extract<CanvasWidget, { type: 'select' }>, direction: 1 | -1): boolean {
  if (direction > 0 && widget.onNext) {
    widget.onNext()
    return true
  }
  if (direction < 0 && widget.onPrev) {
    widget.onPrev()
    return true
  }
  const options = widget.options
  if (!options?.length || !widget.onSelect) return false
  const current = widget.value !== undefined
    ? options.findIndex(opt => opt.value === widget.value)
    : options.findIndex(opt => opt.label === widget.valueLabel)
  const len = options.length
  const start = current < 0 ? (direction > 0 ? -1 : len) : current
  for (let step = 1; step <= len; step++) {
    const idx = ((start + direction * step) % len + len) % len
    const opt = options[idx]
    if (!opt.disabled) {
      if (opt.value !== widget.value) widget.onSelect(opt.value)
      return true
    }
  }
  return false
}

function selectOptionValue(widget: Extract<CanvasWidget, { type: 'select' }>, value: string): boolean {
  if (!widget.onSelect) return false
  if (widget.options) {
    const opt = widget.options.find(item => item.value === value)
    if (!opt || opt.disabled) return false
    widget.onSelect(opt.value)
    return true
  }
  widget.onSelect(value)
  return true
}

function chamferPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, bevel: number) {
  const b = Math.min(bevel, w / 3, h / 3)
  ctx.beginPath()
  ctx.moveTo(x + b, y)
  ctx.lineTo(x + w - b, y)
  ctx.lineTo(x + w, y + b)
  ctx.lineTo(x + w, y + h - b)
  ctx.lineTo(x + w - b, y + h)
  ctx.lineTo(x + b, y + h)
  ctx.lineTo(x, y + h - b)
  ctx.lineTo(x, y + b)
  ctx.closePath()
}

function drawFacetedBox(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  { fill, stroke, topHighlight, bevel, innerGlow }: { fill: string; stroke: string; topHighlight?: string; bevel: number; innerGlow?: string }
) {
  chamferPath(ctx, rect.x, rect.y, rect.width, rect.height, bevel)
  ctx.fillStyle = fill
  ctx.fill()
  if (topHighlight && rect.height >= 16) {
    ctx.save()
    ctx.clip()
    ctx.fillStyle = topHighlight
    ctx.fillRect(rect.x, rect.y, rect.width, Math.max(2, Math.round(rect.height * 0.16)))
    ctx.fillStyle = '#00000028'
    ctx.fillRect(rect.x, rect.y + rect.height - Math.max(2, Math.round(rect.height * 0.10)), rect.width, Math.max(2, Math.round(rect.height * 0.10)))
    ctx.restore()
  }
  if (innerGlow && rect.width >= 24 && rect.height >= 24) {
    chamferPath(ctx, rect.x + 3, rect.y + 3, rect.width - 6, rect.height - 6, Math.max(2, bevel - 2))
    ctx.strokeStyle = innerGlow
    ctx.lineWidth = 1
    ctx.stroke()
  }
  chamferPath(ctx, rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1, bevel)
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.75
  ctx.stroke()
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: LayoutRect,
  size: number,
  align: CanvasTextAlign
) {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const trimmed = paragraph.trim()
    if (!trimmed) {
      lines.push('')
      continue
    }
    const words = trimmed.split(/\s+/)
    let current = ''
    for (const word of words) {
      const candidate = current ? current + ' ' + word : word
      if (ctx.measureText(candidate).width <= rect.width || !current) current = candidate
      else {
        lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
  }
  const lineHeight = Math.round(size * 1.32)
  const maxLines = Math.max(1, Math.floor(rect.height / lineHeight))
  const shown = lines.slice(0, maxLines)
  const totalH = shown.length * lineHeight
  const startY = rect.y + Math.max(0, (rect.height - totalH) / 2) + lineHeight / 2
  const tx = align === 'center' ? rect.x + rect.width / 2 : align === 'right' ? rect.x + rect.width : rect.x
  for (const [i, line] of shown.entries()) {
    if (line) ctx.fillText(line, tx, startY + i * lineHeight, rect.width)
  }
}

function collectNodes(node: LayoutNode, out: LayoutNode[]) {
  if (node.hidden) return
  out.push(node)
  for (const child of node.children ?? []) collectNodes(child, out)
}

function isCanvasWidget(value: unknown): value is CanvasWidget {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false
  const t = value.type
  return t === 'panel' || t === 'text' || t === 'icon' || t === 'button' ||
    t === 'toggle' || t === 'select' || t === 'slider' || t === 'bar'
}

function getCanvasWidget(node: LayoutNode): CanvasWidget | undefined {
  return isCanvasWidget(node.widget) ? node.widget : undefined
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof target !== 'object' || target === null) return false
  if ('isContentEditable' in target && Boolean(target.isContentEditable)) return true
  if ('closest' in target && typeof target.closest === 'function') {
    return Boolean(Reflect.apply(target.closest, target, ['input, textarea, select']))
  }
  return false
}

function isInteractive(widget?: CanvasWidget): widget is InteractiveCanvasWidget {
  return Boolean(widget && (widget.type === 'button' || widget.type === 'toggle' || widget.type === 'select' || widget.type === 'slider'))
}

function isDisabled(widget?: CanvasWidget): boolean {
  return Boolean(widget && isInteractive(widget) && widget.disabled)
}

/** Cross-platform Canvas 2D UI runtime (multi-touch, pointer, keyboard, gamepad, HUD underlay, and headless agent API — zero HTML/CSS menus). */
export function createCanvasUi(canvas: HTMLCanvasElement, options: {
  theme?: UiTheme
  safeArea?: SafeInsets
  keyboardEnabled?(): boolean
  onBack?(): void
  underlay?: CanvasUiUnderlay
} = {}) {
  const rawCtx = canvas.getContext('2d')
  if (!rawCtx) throw new Error('Could not create the Canvas UI context')
  const ctx: CanvasRenderingContext2D = rawCtx
  const theme = options.theme ?? createUiTheme()
  const controller = new AbortController()
  const signal = { signal: controller.signal }

  let rects = new Map<string, LayoutRect>()
  let nodes: LayoutNode[] = []
  let hoveredId: string | null = null
  let focusedId: string | null = null
  const activePointers = new Map<number, {
    id: string
    isHold: boolean
    onHold?: (active: boolean) => void
    isSlider?: boolean
    onDragEnd?: () => void
  }>()
  let viewportW = 0
  let viewportH = 0
  let currentUnderlay: CanvasUiUnderlay | null = options.underlay ?? null
  let underlayKey: string | undefined
  let disposed = false
  let dirty = true
  let padFrame: number | undefined
  let padDir = 0
  let padMoveAt = 0
  let padConfirm = false
  let padBack = false

  const hudPainter = createHudPainter(ctx, () => ({ width: viewportW, height: viewportH }))
  canvas.addEventListener('contextrestored', () => { dirty = true }, signal)

  function setUnderlay(paint: CanvasUiUnderlay | null, key?: string): boolean {
    if (key !== undefined && key === underlayKey) {
      currentUnderlay = paint
      return false
    }
    if (key === undefined && underlayKey === undefined && paint === currentUnderlay) {
      return false
    }
    underlayKey = key
    currentUnderlay = paint
    dirty = true
    return true
  }

  function interactiveHits(includeDisabled = false, respectScrim = true): CanvasUiHit[] {
    let startIndex = 0
    if (respectScrim) {
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]
        const widget = getCanvasWidget(node)
        if (widget?.type === 'panel' && widget.scrim && node.id) {
          const rect = rects.get(node.id)
          if (rect && rect.width > 0 && rect.height > 0) {
            startIndex = i + 1
            break
          }
        }
      }
    }
    const hits: CanvasUiHit[] = []
    for (let i = startIndex; i < nodes.length; i++) {
      const node = nodes[i]
      const widget = getCanvasWidget(node)
      if (!node.id || !isInteractive(widget)) continue
      if (!includeDisabled && isDisabled(widget)) continue
      const rect = rects.get(node.id)
      if (rect && rect.width > 0 && rect.height > 0) hits.push({ id: node.id, rect, widget })
    }
    return hits
  }

  function findHit(x: number, y: number): CanvasUiHit | undefined {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]
      if (!node.id) continue
      const widget = getCanvasWidget(node)
      if (!widget) continue
      const rect = rects.get(node.id)
      if (!rect || rect.width <= 0 || rect.height <= 0) continue
      if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue
      if (isInteractive(widget)) return isDisabled(widget) ? undefined : { id: node.id, rect, widget }
      if (widget.type === 'panel' && widget.scrim) return undefined
    }
    return undefined
  }

  function blocksPoint(x: number, y: number): boolean {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i]
      if (!node.id) continue
      const widget = getCanvasWidget(node)
      if (!widget) continue
      const rect = rects.get(node.id)
      if (!rect || rect.width <= 0 || rect.height <= 0) continue
      if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height) continue
      if (isInteractive(widget)) return true
      if (widget.type === 'panel' && (widget.scrim || widget.blocksPointer)) return true
    }
    return false
  }

  function activateHit(hit: CanvasUiHit, direction: 1 | -1 = 1): boolean {
    const w = hit.widget
    if (isDisabled(w)) return false
    if (w.type === 'button') {
      if (w.onPress) w.onPress()
      else if (w.onHold) {
        w.onHold(true)
        w.onHold(false)
      }
    } else if (w.type === 'toggle') {
      w.onToggle?.(!w.checked)
    } else if (w.type === 'select') {
      if (!stepSelectOption(w, direction)) return false
    } else if (w.type === 'slider') {
      w.onChange?.(clamp01(w.ratio + direction * sliderStep(w)))
    }
    dirty = true
    return true
  }

  function moveFocus(delta: 1 | -1) {
    const hits = interactiveHits().filter(h => !(h.widget.type === 'button' && h.widget.onHold))
    if (!hits.length) { focusedId = null; return }
    const idx = focusedId ? hits.findIndex(h => h.id === focusedId) : -1
    const next = idx < 0 ? (delta > 0 ? 0 : hits.length - 1) : (idx + delta + hits.length) % hits.length
    focusedId = hits[next].id
    dirty = true
  }

  function isPressed(id: string) {
    for (const entry of activePointers.values()) if (entry.id === id) return true
    return false
  }

  function releasePointer(pointerId: number, x?: number, y?: number) {
    const entry = activePointers.get(pointerId)
    if (!entry) return
    activePointers.delete(pointerId)
    if (entry.isSlider) {
      let stillDragging = false
      for (const other of activePointers.values()) {
        if (other.isSlider && other.id === entry.id) { stillDragging = true; break }
      }
      if (!stillDragging) entry.onDragEnd?.()
      dirty = true
      return
    }
    if (entry.isHold) {
      if (!isPressed(entry.id)) entry.onHold?.(false)
      dirty = true
      return
    }
    if (x !== undefined && y !== undefined) {
      const hit = findHit(x, y)
      if (hit && hit.id === entry.id) activateHit(hit)
    }
    dirty = true
  }

  function clearHolds() {
    for (const [pid] of Array.from(activePointers)) releasePointer(pid)
  }

  const unsubPause = onTestingPause(paused => {
    if (paused) {
      clearHolds()
      hoveredId = null
      canvas.style.cursor = ''
    }
  })

  function canvasPoint(event: PointerEvent) {
    const box = canvas.getBoundingClientRect()
    const rawX = event.clientX - box.left
    const rawY = event.clientY - box.top
    if (box.width > 0 && box.height > 0 && viewportW > 0 && viewportH > 0) {
      return { x: rawX * (viewportW / box.width), y: rawY * (viewportH / box.height) }
    }
    return { x: rawX, y: rawY }
  }

  canvas.addEventListener('pointermove', event => {
    if (isTestingPaused()) return
    const { x, y } = canvasPoint(event)
    const active = activePointers.get(event.pointerId)
    if (active?.isSlider) {
      const hit = interactiveHits(false, false).find(h => h.id === active.id)
      if (hit && hit.widget.type === 'slider') {
        const ratio = clamp01((x - hit.rect.x) / Math.max(1, hit.rect.width))
        hit.widget.onChange?.(ratio)
        dirty = true
      }
      return
    }
    const hit = findHit(x, y)
    const next = hit?.id ?? null
    if (next !== hoveredId) {
      hoveredId = next
      canvas.style.cursor = next ? 'pointer' : ''
      dirty = true
    }
  }, signal)

  canvas.addEventListener('pointerdown', event => {
    if (isTestingPaused()) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    const { x, y } = canvasPoint(event)
    const hit = findHit(x, y)
    if (!hit) return
    event.preventDefault()
    event.stopPropagation()
    try { canvas.setPointerCapture?.(event.pointerId) } catch { /* Synthetic or detached pointer events cannot be captured. */ }
    focusedId = hit.id
    const wasPressed = isPressed(hit.id)
    const holdCb = hit.widget.type === 'button' && typeof hit.widget.onHold === 'function' ? hit.widget.onHold : undefined
    const isHold = Boolean(holdCb)
    const isSlider = hit.widget.type === 'slider'
    const dragEndCb = hit.widget.type === 'slider' ? hit.widget.onDragEnd : undefined
    activePointers.set(event.pointerId, {
      id: hit.id,
      isHold,
      onHold: holdCb,
      isSlider,
      onDragEnd: dragEndCb
    })
    if (holdCb && hit.widget.type === 'button') {
      if (!wasPressed) holdCb(true)
      hit.widget.onPress?.()
    } else if (hit.widget.type === 'slider') {
      const ratio = clamp01((x - hit.rect.x) / Math.max(1, hit.rect.width))
      hit.widget.onChange?.(ratio)
    }
    dirty = true
  }, signal)

  canvas.addEventListener('pointerup', event => {
    if (isTestingPaused()) { releasePointer(event.pointerId); return }
    const { x, y } = canvasPoint(event)
    releasePointer(event.pointerId, x, y)
  }, signal)

  const onPointerCancel = (event: PointerEvent) => releasePointer(event.pointerId)
  canvas.addEventListener('pointercancel', onPointerCancel, signal)
  canvas.addEventListener('lostpointercapture', onPointerCancel, signal)

  globalThis.window?.addEventListener('blur', clearHolds, signal)
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (globalThis.document.hidden) clearHolds()
  }, signal)

  globalThis.window?.addEventListener('keydown', event => {
    if (isTestingPaused()) return
    if (options.keyboardEnabled && !options.keyboardEnabled()) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (isEditableTarget(event.target)) return
    const hits = interactiveHits().filter(h => !(h.widget.type === 'button' && h.widget.onHold))
    if (!hits.length) return
    if (event.code === 'ArrowDown' || (event.code === 'Tab' && !event.shiftKey)) {
      event.preventDefault()
      moveFocus(1)
    } else if (event.code === 'ArrowUp' || (event.code === 'Tab' && event.shiftKey)) {
      event.preventDefault()
      moveFocus(-1)
    } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      const hit = hits.find(h => h.id === focusedId)
      const dir = event.code === 'ArrowRight' ? 1 : -1
      event.preventDefault()
      if (hit && (hit.widget.type === 'select' || hit.widget.type === 'slider')) {
        activateHit(hit, dir)
      } else {
        moveFocus(dir)
      }
    } else if ((event.code === 'Enter' || event.code === 'Space') && !event.repeat) {
      const hit = hits.find(h => h.id === focusedId) ?? hits[0]
      if (hit) {
        event.preventDefault()
        focusedId = hit.id
        activateHit(hit)
      }
    }
  }, signal)

  function pollGamepad(now = performance.now()) {
    if (disposed || isTestingPaused()) return
    const pads = readConnectedGamepads()
    if (!pads.length) {
      padDir = 0; padConfirm = false; padBack = false
      return
    }
    const confirm = pads.some(p => p.buttons?.[0]?.pressed)
    const back = pads.some(p => p.buttons?.[1]?.pressed)
    const navEnabled = !options.keyboardEnabled || options.keyboardEnabled()
    const hits = interactiveHits().filter(h => !(h.widget.type === 'button' && h.widget.onHold))
    if (!navEnabled || !hits.length) {
      padDir = 0
      padConfirm = confirm
      padBack = back
      return
    }
    const vPrev = pads.some(p => p.buttons?.[12]?.pressed || (p.axes?.[1] ?? 0) < -0.5)
    const vNext = pads.some(p => p.buttons?.[13]?.pressed || (p.axes?.[1] ?? 0) > 0.5)
    const hPrev = pads.some(p => p.buttons?.[14]?.pressed || (p.axes?.[0] ?? 0) < -0.5)
    const hNext = pads.some(p => p.buttons?.[15]?.pressed || (p.axes?.[0] ?? 0) > 0.5)
    const vDir = vNext ? 1 : vPrev ? -1 : 0
    const hDir = hNext ? 1 : hPrev ? -1 : 0
    const dir = vDir || hDir
    const shouldMove = dir !== 0 && (dir !== padDir || now - padMoveAt >= 200)
    const shouldConfirm = confirm && !padConfirm
    const shouldBack = back && !padBack
    padDir = dir
    padConfirm = confirm
    padBack = back
    if (shouldMove) {
      const focused = hits.find(h => h.id === focusedId)
      if (!vDir && hDir && focused && (focused.widget.type === 'select' || focused.widget.type === 'slider')) {
        activateHit(focused, hDir)
      } else {
        moveFocus(dir)
      }
      padMoveAt = now
    }
    if (shouldConfirm) {
      const hit = hits.find(h => h.id === focusedId) ?? hits[0]
      if (hit) { focusedId = hit.id; activateHit(hit) }
    }
    if (shouldBack) options.onBack?.()
  }

  function ensurePadLoop() {
    if (disposed || padFrame !== undefined || typeof globalThis.requestAnimationFrame !== 'function') return
    const tick = (now: number) => {
      padFrame = undefined
      if (disposed) return
      pollGamepad(now)
      if (!disposed && readConnectedGamepads().length) padFrame = globalThis.requestAnimationFrame(tick)
    }
    padFrame = globalThis.requestAnimationFrame(tick)
  }

  globalThis.window?.addEventListener('gamepadconnected', () => ensurePadLoop(), signal)
  if (readConnectedGamepads().length) ensurePadLoop()

  function paintNode(node: LayoutNode) {
    if (node.hidden) return
    const rect = node.id ? rects.get(node.id) : undefined
    const widget = getCanvasWidget(node)
    if (rect && widget) {
      if (widget.type === 'panel') {
        if (widget.draw) {
          ctx.save()
          widget.draw(ctx, rect, { hovered: false, pressed: false, focused: false, selected: false, disabled: false })
          ctx.restore()
        } else if (widget.scrim) {
          ctx.fillStyle = widget.fill ?? theme.scrim
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
        } else {
          drawFacetedBox(ctx, rect, {
            fill: widget.fill ?? theme.surface,
            stroke: widget.stroke ?? theme.border,
            topHighlight: theme.surfaceTop,
            bevel: widget.bevel ?? theme.bevel,
            innerGlow: widget.stroke ? '#ffe8b024' : undefined
          })
        }
      } else if (widget.type === 'text') {
        const size = widget.size ?? 15
        const align = widget.align ?? 'left'
        ctx.fillStyle = widget.color ?? theme.text
        ctx.font = `${widget.weight ?? 600} ${size}px ${widget.mono ? theme.mono : theme.font}`
        ctx.textAlign = align
        ctx.textBaseline = 'middle'
        if (widget.wrap) {
          drawWrappedText(ctx, widget.text, rect, size, align)
        } else {
          const tx = align === 'center' ? rect.x + rect.width / 2 : align === 'right' ? rect.x + rect.width : rect.x
          ctx.fillText(widget.text, tx, rect.y + rect.height / 2, rect.width)
        }
      } else if (widget.type === 'icon') {
        const pad = widget.padding ?? 2
        const size = Math.max(1, Math.min(rect.width - pad * 2, rect.height - pad * 2))
        ctx.save()
        if (widget.pixelated) ctx.imageSmoothingEnabled = false
        ctx.drawImage(widget.image, rect.x + (rect.width - size) / 2, rect.y + (rect.height - size) / 2, size, size)
        ctx.restore()
      } else if (widget.type === 'button' || widget.type === 'toggle' || widget.type === 'select') {
        const disabled = isDisabled(widget)
        const isHovered = !disabled && hoveredId === node.id
        const isFocused = !disabled && focusedId === node.id
        const pressed = !disabled && Boolean(node.id && isPressed(node.id))
        const selected = widget.type === 'button' && Boolean(widget.selected)
        if (widget.type === 'button' && widget.draw) {
          ctx.save()
          widget.draw(ctx, rect, { hovered: isHovered, pressed, focused: isFocused, selected, disabled })
          ctx.restore()
        } else {
          const primary = widget.type === 'button' ? Boolean(widget.primary) : widget.type === 'toggle' && widget.checked
          const customFill = widget.type === 'button' ? widget.fill : undefined
          const customStroke = widget.type === 'button' ? widget.stroke : undefined
          const customAccent = widget.type === 'button' ? widget.accent : undefined
          const fill = disabled ? '#152024b0'
            : customFill ?? (primary ? theme.accent
            : pressed ? theme.surfaceTop
            : selected || isHovered ? theme.surfaceAlt
            : theme.surface)
          const stroke = disabled ? '#3b4e5066'
            : selected || isFocused || isHovered ? (customAccent ?? theme.accent)
            : (customStroke ?? theme.border)
          const offsetY = pressed ? 1 : 0
          ctx.save()
          if (disabled) ctx.globalAlpha = 0.62
          const highlight = customAccent && /^#[0-9a-f]{6}$/i.test(customAccent)
            ? customAccent + '44'
            : primary ? '#ffffff30' : theme.surfaceTop
          drawFacetedBox(ctx, { ...rect, y: rect.y + offsetY }, {
            fill,
            stroke,
            topHighlight: highlight,
            bevel: theme.bevel
          })

          let textLeft = rect.x + 10
          let textRight = rect.x + rect.width - 10
          if (widget.type === 'button' && widget.icon) {
            const iconSize = Math.min(38, rect.height - 8)
            if (iconSize > 0) {
              ctx.imageSmoothingEnabled = false
              ctx.drawImage(widget.icon, textLeft - 2, rect.y + offsetY + (rect.height - iconSize) / 2, iconSize, iconSize)
              textLeft += iconSize + 8
            }
          }

          const label = widget.type === 'button'
            ? widget.label
            : widget.type === 'toggle'
              ? `${widget.label}: ${widget.checked ? 'ON' : 'OFF'}`
              : `${widget.label}: ${widget.valueLabel}`

          if (widget.type === 'button' && widget.badge && widget.badge.text) {
            ctx.font = `800 10px ${theme.mono}`
            const bw = Math.min(Math.max(24, Math.ceil(ctx.measureText(widget.badge.text).width) + 12), Math.max(24, rect.width * 0.45))
            const bh = 16
            const bx = textRight - bw
            const by = rect.y + offsetY + 6
            ctx.fillStyle = widget.badge.fill ?? customAccent ?? theme.accent
            chamferPath(ctx, bx, by, bw, bh, 3)
            ctx.fill()
            ctx.fillStyle = widget.badge.color ?? theme.accentText
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(widget.badge.text, bx + bw / 2, by + bh / 2 + 0.5, bw - 4)
            textRight = Math.max(textLeft + 16, bx - 6)
          }

          ctx.fillStyle = primary && !customFill ? theme.accentText : theme.text
          if (widget.type === 'button' && (widget.subtitle || widget.pips)) {
            ctx.textAlign = 'left'
            ctx.textBaseline = 'middle'
            ctx.font = `700 13px ${theme.font}`
            ctx.fillText(label, textLeft, rect.y + offsetY + rect.height * 0.34, Math.max(1, textRight - textLeft))
            const fullRight = rect.x + rect.width - 10
            if (widget.pips) {
              const pipW = 12, pipH = 5, gap = 4
              const py = rect.y + offsetY + rect.height * 0.68 - pipH / 2
              for (let i = 0; i < widget.pips.total; i++) {
                ctx.fillStyle = i < widget.pips.filled ? (customAccent ?? theme.accent) : '#ffffff26'
                ctx.fillRect(textLeft + i * (pipW + gap), py, pipW, pipH)
              }
            }
            if (widget.subtitle) {
              ctx.fillStyle = primary && !customFill ? theme.accentText : theme.muted
              ctx.font = `600 11px ${theme.mono}`
              ctx.textAlign = widget.pips ? 'right' : 'left'
              const sx = widget.pips ? fullRight : textLeft
              ctx.fillText(widget.subtitle, sx, rect.y + offsetY + rect.height * 0.68, Math.max(1, fullRight - textLeft))
            }
          } else {
            ctx.font = `700 14px ${theme.font}`
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(label, (textLeft + textRight) / 2, rect.y + offsetY + rect.height / 2, Math.max(1, textRight - textLeft))
          }
          ctx.restore()
        }
      } else if (widget.type === 'slider') {
        const disabled = isDisabled(widget)
        const isFocused = !disabled && (focusedId === node.id || hoveredId === node.id)
        ctx.save()
        if (disabled) ctx.globalAlpha = 0.62
        drawFacetedBox(ctx, rect, {
          fill: disabled ? '#152024b0' : theme.surface,
          stroke: disabled ? '#3b4e5066' : isFocused ? theme.accent : theme.border,
          bevel: 4
        })
        const fillW = Math.max(0, Math.round((rect.width - 6) * clamp01(widget.ratio)))
        if (fillW > 0) {
          ctx.fillStyle = theme.accent
          ctx.fillRect(rect.x + 3, rect.y + 3, fillW, Math.max(2, rect.height - 6))
        }
        ctx.fillStyle = theme.text
        ctx.font = `700 12px ${theme.mono}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(widget.valueText ?? widget.label, rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(1, rect.width - 10))
        ctx.restore()
      } else if (widget.type === 'bar') {
        const clamped = clamp01(widget.ratio)
        ctx.save()
        drawFacetedBox(ctx, rect, {
          fill: widget.track ?? '#0c1b23cc',
          stroke: widget.stroke ?? theme.border,
          bevel: 4
        })
        const fillW = Math.round((rect.width - 6) * clamped)
        if (fillW > 0) {
          ctx.fillStyle = widget.fill ?? theme.accent
          ctx.fillRect(rect.x + 3, rect.y + 3, Math.max(2, fillW), Math.max(2, rect.height - 6))
        }
        const caption = widget.valueText ?? widget.label
        if (caption) {
          ctx.fillStyle = theme.text
          ctx.font = `700 11px ${theme.mono}`
          ctx.textAlign = widget.valueText && widget.label ? 'left' : 'center'
          ctx.textBaseline = 'middle'
          if (widget.valueText && widget.label) {
            ctx.fillText(widget.label, rect.x + 8, rect.y + rect.height / 2, Math.max(1, rect.width * 0.6))
            ctx.textAlign = 'right'
            ctx.fillText(widget.valueText, rect.x + rect.width - 8, rect.y + rect.height / 2, Math.max(1, rect.width * 0.4))
          } else {
            ctx.fillText(caption, rect.x + rect.width / 2, rect.y + rect.height / 2, Math.max(1, rect.width - 10))
          }
        }
        ctx.restore()
      }
    }
    for (const child of node.children ?? []) paintNode(child)
  }

  function snapshotHit(hit: CanvasUiHit): CanvasUiWidgetSnapshot {
    const w = hit.widget
    const disabled = isDisabled(w)
    const hovered = !disabled && hoveredId === hit.id
    const focused = !disabled && focusedId === hit.id
    const pressed = !disabled && isPressed(hit.id)
    const state: CanvasWidgetState = disabled
      ? 'disabled'
      : pressed
        ? 'pressed'
        : hovered
          ? 'hovered'
          : focused
            ? 'focused'
            : w.type === 'toggle'
              ? (w.checked ? 'checked' : 'unchecked')
              : w.type === 'button' && w.selected
                ? 'selected'
                : 'idle'
    const actions: readonly string[] = disabled
      ? []
      : w.type === 'button'
        ? (w.onHold ? ['press', 'hold', 'focus'] : ['press', 'focus'])
        : w.type === 'toggle'
          ? ['toggle', 'set', 'focus']
          : w.type === 'select'
            ? (w.onSelect || w.options ? ['next', 'prev', 'select', 'focus'] : ['next', 'prev', 'focus'])
            : ['set', 'increment', 'decrement', 'focus']

    return {
      id: hit.id,
      kind: w.type,
      role: w.type,
      label: w.label,
      ...(w.type === 'button' && w.subtitle ? { subtitle: w.subtitle } : {}),
      state,
      ...(w.type === 'toggle'
        ? { value: w.checked, checked: w.checked }
        : w.type === 'select'
          ? { value: w.value ?? w.valueLabel }
          : w.type === 'slider'
            ? { value: clamp01(w.ratio) }
            : {}),
      disabled,
      focused,
      hovered,
      pressed,
      ...(w.type === 'button' ? { selected: Boolean(w.selected) } : {}),
      bounds: { x: hit.rect.x, y: hit.rect.y, width: hit.rect.width, height: hit.rect.height },
      actions
    }
  }

  function snapshot(): CanvasUiWidgetSnapshot[] {
    return interactiveHits(true, true).map(snapshotHit)
  }

  function query(filter: CanvasUiQuery = {}): CanvasUiWidgetSnapshot[] {
    return snapshot().filter(item =>
      (filter.id === undefined || item.id === filter.id) &&
      (filter.kind === undefined || item.kind === filter.kind) &&
      (filter.role === undefined || item.role === filter.role) &&
      (filter.state === undefined || item.state === filter.state) &&
      (filter.label === undefined || item.label === filter.label) &&
      (filter.disabled === undefined || item.disabled === filter.disabled)
    )
  }

  function activate(id: string, direction: 1 | -1 = 1) {
    const hit = interactiveHits().find(h => h.id === id)
    if (!hit) return false
    return activateHit(hit, direction)
  }

  function act(id: string, action: string, payload?: unknown): boolean {
    const hit = interactiveHits(false, true).find(h => h.id === id)
    if (!hit) return false
    if (action === 'focus') {
      focusedId = hit.id
      dirty = true
      return true
    }
    if (action === 'blur') {
      if (focusedId === hit.id) {
        focusedId = null
        dirty = true
      }
      return true
    }
    const w = hit.widget
    if (w.type === 'button') {
      if (action === 'press' || action === 'click') return activateHit(hit)
      if (action === 'hold' && typeof payload === 'boolean' && w.onHold) {
        w.onHold(payload)
        dirty = true
        return true
      }
      return false
    }
    if (w.type === 'toggle') {
      if (action === 'toggle' || action === 'press' || action === 'click') return activateHit(hit)
      if (action === 'set' && typeof payload === 'boolean') {
        if (payload !== w.checked) w.onToggle?.(payload)
        dirty = true
        return true
      }
      return false
    }
    if (w.type === 'select') {
      if (action === 'next' || action === 'press' || action === 'click') return activateHit(hit, 1)
      if (action === 'prev') return activateHit(hit, -1)
      if (action === 'select' && typeof payload === 'string') {
        const ok = selectOptionValue(w, payload)
        if (ok) dirty = true
        return ok
      }
      return false
    }
    if (action === 'set' && typeof payload === 'number' && Number.isFinite(payload)) {
      w.onChange?.(clamp01(payload))
      dirty = true
      return true
    }
    if (action === 'increment' || action === 'decrement') {
      const mult = payload === undefined ? 1 : (typeof payload === 'number' && Number.isFinite(payload) ? payload : Number.NaN)
      if (!Number.isFinite(mult)) return false
      const dir = action === 'increment' ? 1 : -1
      w.onChange?.(clamp01(w.ratio + dir * sliderStep(w) * mult))
      dirty = true
      return true
    }
    if (action === 'step' && typeof payload === 'number' && Number.isFinite(payload)) {
      w.onChange?.(clamp01(w.ratio + sliderStep(w) * payload))
      dirty = true
      return true
    }
    return false
  }

  return {
    theme,
    setUnderlay,
    render(tree: LayoutNode, viewport?: CanvasUiViewport) {
      const w = Math.max(1, viewport?.width ?? canvas.clientWidth)
      const h = Math.max(1, viewport?.height ?? canvas.clientHeight)
      viewportW = w
      viewportH = h
      const ratio = Math.min(viewport?.pixelRatio ?? globalThis.devicePixelRatio ?? 1, 2)
      const pw = Math.max(1, Math.round(w * ratio))
      const ph = Math.max(1, Math.round(h * ratio))
      if (canvas.width !== pw) canvas.width = pw
      if (canvas.height !== ph) canvas.height = ph
      nodes = []
      collectNodes(tree, nodes)
      rects = resolveLayout(tree, { width: w, height: h }, options.safeArea)
      const enabledIds = new Set(interactiveHits(false, true).map(hit => hit.id))
      if (hoveredId && !enabledIds.has(hoveredId)) {
        hoveredId = null
        canvas.style.cursor = ''
      }
      if (focusedId && !enabledIds.has(focusedId)) {
        focusedId = null
      }
      ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const underlay = viewport?.underlay !== undefined ? viewport.underlay : currentUnderlay
      if (underlay) {
        ctx.save()
        underlay(hudPainter, ctx)
        ctx.restore()
      }
      paintNode(tree)
      if (isTestingActive()) {
        const hudRegions: HudRegion[] = []
        for (const node of nodes) {
          if (!node.id) continue
          const widget = getCanvasWidget(node)
          if (!widget || (widget.type === 'panel' && widget.scrim)) continue
          const rect = rects.get(node.id)
          if (!rect || rect.width <= 0 || rect.height <= 0) continue
          const label = 'label' in widget && widget.label
            ? widget.label
            : widget.type === 'text' ? widget.text.slice(0, 32) : node.id
          hudRegions.push({
            id: node.id,
            label,
            asset: node.id,
            source: 'canvas-ui#' + node.id,
            canvas,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            viewportWidth: w,
            viewportHeight: h
          })
        }
        recordCanvasUiRegions(canvas, hudRegions)
      }
      dirty = false
      return rects
    },
    hitTest: findHit,
    blocksPoint,
    clearHolds,
    get rects(): ReadonlyMap<string, LayoutRect> { return rects },
    get dirty() { return dirty },
    focus(id: string | null) { focusedId = id; dirty = true },
    moveFocus,
    activate,
    snapshot,
    query,
    act,
    dispose() {
      disposed = true
      unsubPause()
      hoveredId = null
      focusedId = null
      canvas.style.cursor = ''
      clearHolds()
      controller.abort()
      if (padFrame !== undefined) {
        globalThis.cancelAnimationFrame?.(padFrame)
        padFrame = undefined
      }
    }
  }
}
