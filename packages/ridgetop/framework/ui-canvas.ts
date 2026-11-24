import type { LayoutNode, LayoutRect, SafeInsets } from './ui-layout.ts'
import type { UiPrimitiveInstance } from './ui-machine.ts'
import { resolveLayout } from './ui-layout.ts'
import { createUiAgent } from './ui-machine.ts'
import { isTestingActive, isTestingPaused, onTestingPause, recordCanvasUiRegions } from './testing-runtime.ts'
import type { HudRegion } from './testing-runtime.ts'

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

export type CanvasWidget =
  | { type: 'panel'; fill?: string; stroke?: string; scrim?: boolean; bevel?: number }
  | { type: 'text'; text: string; size?: number; weight?: number; color?: string; align?: CanvasTextAlign; mono?: boolean; wrap?: boolean }
  | { type: 'icon'; image: CanvasImageSource; padding?: number; pixelated?: boolean }
  | {
      type: 'button'
      label: string
      subtitle?: string
      primary?: boolean
      disabled?: boolean
      selected?: boolean
      icon?: CanvasImageSource
      pips?: { filled: number; total: number }
      primitive?: UiPrimitiveInstance
      onPress?(): void
      onHold?(active: boolean): void
    }
  | { type: 'toggle'; label: string; checked: boolean; disabled?: boolean; primitive?: UiPrimitiveInstance; onToggle?(next: boolean): void }
  | { type: 'select'; label: string; valueLabel: string; disabled?: boolean; primitive?: UiPrimitiveInstance; onNext?(): void; onPrev?(): void }
  | { type: 'slider'; label: string; ratio: number; valueText?: string; disabled?: boolean; primitive?: UiPrimitiveInstance; onChange?(ratio: number): void }
  | { type: 'bar'; ratio: number; label?: string; valueText?: string; fill?: string; track?: string; stroke?: string }

export interface CanvasUiHit {
  readonly id: string
  readonly rect: LayoutRect
  readonly widget: CanvasWidget
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
  { fill, stroke, topHighlight, bevel }: { fill: string; stroke: string; topHighlight?: string; bevel: number }
) {
  chamferPath(ctx, rect.x, rect.y, rect.width, rect.height, bevel)
  ctx.fillStyle = fill
  ctx.fill()
  if (topHighlight && rect.height >= 16) {
    ctx.save()
    ctx.clip()
    ctx.fillStyle = topHighlight
    ctx.fillRect(rect.x, rect.y, rect.width, Math.max(2, Math.round(rect.height * 0.14)))
    ctx.restore()
  }
  chamferPath(ctx, rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1, bevel)
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  ctx.stroke()
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: LayoutRect,
  size: number,
  align: CanvasTextAlign
) {
  const words = text.split(/\s+/)
  const lines: string[] = []
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
  const lineHeight = Math.round(size * 1.32)
  const maxLines = Math.max(1, Math.floor(rect.height / lineHeight))
  const shown = lines.slice(0, maxLines)
  const totalH = shown.length * lineHeight
  const startY = rect.y + Math.max(0, (rect.height - totalH) / 2) + lineHeight / 2
  const tx = align === 'center' ? rect.x + rect.width / 2 : align === 'right' ? rect.x + rect.width : rect.x
  for (const [i, line] of shown.entries()) {
    ctx.fillText(line, tx, startY + i * lineHeight, rect.width)
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

function isUiPrimitiveInstance(value: unknown): value is UiPrimitiveInstance {
  return typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'string' &&
    'snapshot' in value && typeof value.snapshot === 'function' &&
    'act' in value && typeof value.act === 'function'
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof target !== 'object' || target === null) return false
  if ('isContentEditable' in target && Boolean(target.isContentEditable)) return true
  if ('closest' in target && typeof target.closest === 'function') {
    return Boolean(Reflect.apply(target.closest, target, ['input, textarea, select']))
  }
  return false
}

function isInteractive(widget?: CanvasWidget): widget is Extract<CanvasWidget, { type: 'button' | 'toggle' | 'select' | 'slider' }> {
  return Boolean(widget && (widget.type === 'button' || widget.type === 'toggle' || widget.type === 'select' || widget.type === 'slider'))
}

function isDisabled(widget?: CanvasWidget): boolean {
  if (!widget || !isInteractive(widget)) return false
  if ('disabled' in widget && widget.disabled) return true
  if ('primitive' in widget && widget.primitive?.slots.root?.disabled) return true
  return false
}

/** Cross-platform Canvas 2D UI runtime (multi-touch, pointer, keyboard, gamepad, and headless agent API — zero HTML/CSS menus). */
export function createCanvasUi(canvas: HTMLCanvasElement, options: {
  theme?: UiTheme
  safeArea?: SafeInsets
  keyboardEnabled?(): boolean
  onBack?(): void
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
  let disposed = false
  let dirty = true
  let padFrame: number | undefined
  let padDir = 0
  let padMoveAt = 0
  let padConfirm = false
  let padBack = false

  function connectedPads(): readonly Gamepad[] {
    const getGamepads = globalThis.navigator?.getGamepads
    if (typeof getGamepads !== 'function') return []
    try {
      return Array.from(getGamepads.call(globalThis.navigator) ?? []).filter((p): p is Gamepad => Boolean(p && p.connected))
    } catch { return [] }
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

  function driveSlider(widget: Extract<CanvasWidget, { type: 'slider' }>, ratio: number, phase: 'start' | 'move') {
    const prim = widget.primitive
    if (prim) {
      const fn = phase === 'start' ? prim.api.dragStart : prim.api.dragMove
      if (typeof fn === 'function') Reflect.apply(fn, prim.api, [ratio])
      else if (typeof prim.api.setRatio === 'function') Reflect.apply(prim.api.setRatio, prim.api, [ratio])
    } else {
      widget.onChange?.(ratio)
    }
  }

  function activateHit(hit: CanvasUiHit, direction: 1 | -1 = 1) {
    const w = hit.widget
    if (isDisabled(w)) return
    if (w.type === 'button') {
      if (w.primitive) w.primitive.act('press')
      else w.onPress?.()
    } else if (w.type === 'toggle') {
      if (w.primitive) w.primitive.act('toggle')
      else w.onToggle?.(!w.checked)
    } else if (w.type === 'select') {
      if (w.primitive) w.primitive.act(direction > 0 ? 'next' : 'prev')
      else if (direction > 0) w.onNext?.()
      else w.onPrev?.()
    } else if (w.type === 'slider') {
      if (w.primitive) w.primitive.act('step', direction)
      else w.onChange?.(Math.max(0, Math.min(1, w.ratio + direction * 0.1)))
    }
    dirty = true
  }

  function moveFocus(delta: 1 | -1) {
    const hits = interactiveHits().filter(h => !(h.widget.type === 'button' && h.widget.onHold))
    if (!hits.length) { focusedId = null; return }
    const idx = focusedId ? hits.findIndex(h => h.id === focusedId) : -1
    const next = idx < 0 ? (delta > 0 ? 0 : hits.length - 1) : (idx + delta + hits.length) % hits.length
    focusedId = hits[next].id
    dirty = true
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
        const ratio = Math.max(0, Math.min(1, (x - hit.rect.x) / Math.max(1, hit.rect.width)))
        driveSlider(hit.widget, ratio, 'move')
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
    const sliderPrimitiveRef = isSlider ? hit.widget.primitive : undefined
    activePointers.set(event.pointerId, {
      id: hit.id,
      isHold,
      onHold: holdCb,
      isSlider,
      onDragEnd: sliderPrimitiveRef
        ? () => {
            const end = sliderPrimitiveRef.api.dragEnd
            if (typeof end === 'function') Reflect.apply(end, sliderPrimitiveRef.api, [])
          }
        : undefined
    })
    if (holdCb && hit.widget.type === 'button') {
      if (!wasPressed) holdCb(true)
      hit.widget.onPress?.()
    } else if (hit.widget.type === 'slider') {
      const ratio = Math.max(0, Math.min(1, (x - hit.rect.x) / Math.max(1, hit.rect.width)))
      driveSlider(hit.widget, ratio, 'start')
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
    const pads = connectedPads()
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
      if (!disposed && connectedPads().length) padFrame = globalThis.requestAnimationFrame(tick)
    }
    padFrame = globalThis.requestAnimationFrame(tick)
  }

  globalThis.window?.addEventListener('gamepadconnected', () => ensurePadLoop(), signal)
  if (connectedPads().length) ensurePadLoop()

  function isPressed(id: string) {
    for (const entry of activePointers.values()) if (entry.id === id) return true
    return false
  }

  function paintNode(node: LayoutNode) {
    if (node.hidden) return
    const rect = node.id ? rects.get(node.id) : undefined
    const widget = getCanvasWidget(node)
    if (rect && widget) {
      if (widget.type === 'panel') {
        if (widget.scrim) {
          ctx.fillStyle = widget.fill ?? theme.scrim
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
        } else {
          drawFacetedBox(ctx, rect, {
            fill: widget.fill ?? theme.surface,
            stroke: widget.stroke ?? theme.border,
            topHighlight: theme.surfaceTop,
            bevel: widget.bevel ?? theme.bevel
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
        const primary = widget.type === 'button' ? Boolean(widget.primary) : widget.type === 'toggle' && widget.checked
        const fill = disabled ? '#152024b0'
          : primary ? theme.accent
          : pressed ? theme.surfaceTop
          : selected || isHovered ? theme.surfaceAlt
          : theme.surface
        const stroke = disabled ? '#3b4e5066' : selected || isFocused || isHovered ? theme.accent : theme.border
        const offsetY = pressed ? 1 : 0
        ctx.save()
        if (disabled) ctx.globalAlpha = 0.62
        drawFacetedBox(ctx, { ...rect, y: rect.y + offsetY }, {
          fill,
          stroke,
          topHighlight: primary ? '#ffffff30' : theme.surfaceTop,
          bevel: theme.bevel
        })

        let textLeft = rect.x + 10
        let textRight = rect.x + rect.width - 10
        if (widget.type === 'button' && widget.icon) {
          const iconSize = Math.min(28, rect.height - 12)
          if (iconSize > 0) {
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(widget.icon, textLeft, rect.y + offsetY + (rect.height - iconSize) / 2, iconSize, iconSize)
            textLeft += iconSize + 10
          }
        }

        const label = widget.type === 'button'
          ? widget.label
          : widget.type === 'toggle'
            ? `${widget.label}: ${widget.checked ? 'ON' : 'OFF'}`
            : `${widget.label}: ${widget.valueLabel}`

        ctx.fillStyle = primary ? theme.accentText : theme.text
        if (widget.type === 'button' && (widget.subtitle || widget.pips)) {
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.font = `700 14px ${theme.font}`
          ctx.fillText(label, textLeft, rect.y + offsetY + rect.height * 0.34, Math.max(1, textRight - textLeft))
          if (widget.pips) {
            const pipW = 12, pipH = 5, gap = 4
            const py = rect.y + offsetY + rect.height * 0.68 - pipH / 2
            for (let i = 0; i < widget.pips.total; i++) {
              ctx.fillStyle = i < widget.pips.filled ? theme.accent : '#ffffff26'
              ctx.fillRect(textLeft + i * (pipW + gap), py, pipW, pipH)
            }
          }
          if (widget.subtitle) {
            ctx.fillStyle = primary ? theme.accentText : theme.muted
            ctx.font = `600 11px ${theme.mono}`
            ctx.textAlign = widget.pips ? 'right' : 'left'
            const sx = widget.pips ? textRight : textLeft
            ctx.fillText(widget.subtitle, sx, rect.y + offsetY + rect.height * 0.68, Math.max(1, textRight - textLeft))
          }
        } else {
          ctx.font = `700 14px ${theme.font}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, (textLeft + textRight) / 2, rect.y + offsetY + rect.height / 2, Math.max(1, textRight - textLeft))
        }
        ctx.restore()
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
        const fillW = Math.max(0, Math.round((rect.width - 6) * Math.max(0, Math.min(1, widget.ratio))))
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
        const clamped = Math.max(0, Math.min(1, Number.isFinite(widget.ratio) ? widget.ratio : 0))
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

  function primitives() {
    const out: UiPrimitiveInstance[] = []
    for (const node of nodes) {
      const prim = node.widget?.primitive
      if (isUiPrimitiveInstance(prim)) out.push(prim)
    }
    return out
  }

  const agent = createUiAgent(primitives)

  function activate(id: string, direction: 1 | -1 = 1) {
    const hit = interactiveHits().find(h => h.id === id)
    if (!hit) return false
    activateHit(hit, direction)
    return true
  }

  return {
    theme,
    render(tree: LayoutNode, viewport?: { width: number; height: number; pixelRatio?: number }) {
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
      ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0)
      ctx.clearRect(0, 0, w, h)
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
    clearHolds,
    get rects(): ReadonlyMap<string, LayoutRect> { return rects },
    get dirty() { return dirty },
    focus(id: string | null) { focusedId = id; dirty = true },
    moveFocus,
    activate,
    snapshot: () => agent.snapshot(),
    query: (filter?: { id?: string; kind?: string; state?: string; label?: string }) => agent.query(filter),
    act: (id: string, action: string, payload?: unknown) => {
      if (agent.act(id, action, payload)) { dirty = true; return true }
      if (action === 'press' || action === 'click' || action === 'toggle') return activate(id)
      if (action === 'next') return activate(id, 1)
      if (action === 'prev') return activate(id, -1)
      return false
    },
    dispose() {
      disposed = true
      unsubPause()
      hoveredId = null
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
