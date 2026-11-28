import type { SpringConfig, SpringPresetName } from './animation.ts'

export type Align = 'start' | 'center' | 'end' | 'stretch'
export type Justify = 'start' | 'center' | 'end' | 'between'
export type Anchor = 'fill' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top' | 'bottom'
export type Padding = number | readonly [number, number] | readonly [number, number, number, number]
export type LayoutTransitionPreset = 'fade' | 'pop' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight'

export interface LayoutTransition {
  /** Spring animation preset for enter/exit. Default: 'fade'. */
  readonly preset?: LayoutTransitionPreset
  /** Spring config or preset name for entering. Default: matched to preset. */
  readonly spring?: SpringConfig | SpringPresetName
  /** Spring config or preset name for exiting. Default: 'stiff'. */
  readonly exitSpring?: SpringConfig | SpringPresetName
  /** Travel distance in logical pixels for slide presets. Default: 24. */
  readonly distance?: number
  /** Starting scale for 'pop' preset. Default: 0.92. */
  readonly scale?: number
  /** Whether to animate when the node leaves the tree. Default: true. */
  readonly exit?: boolean
}

export interface SafeInsets {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export interface LayoutRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface LayoutStyle {
  width?: number
  height?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  grow?: number
  gap?: number
  padding?: Padding
  align?: Align
  justify?: Justify
  anchor?: Anchor
  inset?: number | readonly [number, number]
  respectSafeArea?: boolean
}

export interface LayoutNode {
  readonly id?: string
  readonly kind: 'column' | 'row' | 'overlay' | 'box' | 'spacer'
  readonly style?: LayoutStyle
  readonly children?: readonly LayoutNode[]
  readonly hidden?: boolean
  /** Optional spring enter/exit transition (requires a stable `id`). */
  readonly transition?: LayoutTransition
  /** Optional custom widget payload (consumed by Canvas UI or Godot `.tscn` exporter). */
  readonly widget?: Record<string, unknown>
}

function normalizePadding(padding: Padding = 0): readonly [number, number, number, number] {
  if (typeof padding === 'number') return [padding, padding, padding, padding]
  if (padding.length === 2) return [padding[0], padding[1], padding[0], padding[1]]
  return padding
}

function clamp(value: number, min?: number, max?: number) {
  let next = value
  if (min !== undefined) next = Math.max(min, next)
  if (max !== undefined) next = Math.min(max, next)
  return Math.max(0, next)
}

interface Size { width: number; height: number }

function measureNode(node: LayoutNode, availW: number, availH: number, cache: WeakMap<LayoutNode, Size>): Size {
  if (node.hidden) return { width: 0, height: 0 }
  const s = node.style ?? {}
  const [pt, pr, pb, pl] = normalizePadding(s.padding)
  const padW = pl + pr
  const padH = pt + pb
  const resolvedW = s.width !== undefined ? clamp(s.width, s.minWidth, s.maxWidth) : clamp(availW, s.minWidth, s.maxWidth)
  const resolvedH = s.height !== undefined ? clamp(s.height, s.minHeight, s.maxHeight) : clamp(availH, s.minHeight, s.maxHeight)
  const innerMaxW = Math.max(0, resolvedW - padW)
  const innerMaxH = Math.max(0, resolvedH - padH)
  const children = (node.children ?? []).filter(child => !child.hidden)
  const gap = s.gap ?? 0

  let contentW = 0
  let contentH = 0

  if (node.kind === 'column') {
    for (const [i, child] of children.entries()) {
      const m = measureNode(child, innerMaxW, innerMaxH, cache)
      contentW = Math.max(contentW, m.width)
      contentH += m.height + (i > 0 ? gap : 0)
    }
  } else if (node.kind === 'row') {
    for (const [i, child] of children.entries()) {
      const m = measureNode(child, innerMaxW, innerMaxH, cache)
      contentW += m.width + (i > 0 ? gap : 0)
      contentH = Math.max(contentH, m.height)
    }
  } else if (node.kind === 'overlay' || node.kind === 'box') {
    for (const child of children) {
      const m = measureNode(child, innerMaxW, innerMaxH, cache)
      contentW = Math.max(contentW, m.width)
      contentH = Math.max(contentH, m.height)
    }
  }

  const width = s.width !== undefined ? resolvedW : clamp(contentW + padW, s.minWidth, s.maxWidth)
  const height = s.height !== undefined ? resolvedH : clamp(contentH + padH, s.minHeight, s.maxHeight)
  const size = { width, height }
  cache.set(node, size)
  return size
}

function placeInOverlay(box: LayoutRect, child: LayoutNode, size: Size, safe: Required<SafeInsets>): LayoutRect {
  const s = child.style ?? {}
  const anchor = s.anchor ?? 'top-left'
  const [ix, iy] = typeof s.inset === 'number' ? [s.inset, s.inset] : (s.inset ?? [0, 0])
  const st = s.respectSafeArea ? safe.top : 0
  const sr = s.respectSafeArea ? safe.right : 0
  const sb = s.respectSafeArea ? safe.bottom : 0
  const sl = s.respectSafeArea ? safe.left : 0

  const symX = anchor === 'fill' || anchor === 'center' || anchor === 'top' || anchor === 'bottom'
  const symY = anchor === 'fill' || anchor === 'center'
  const availW = Math.max(0, box.width - sl - sr - (symX ? ix * 2 : ix))
  const availH = Math.max(0, box.height - st - sb - (symY ? iy * 2 : iy))
  const w = anchor === 'fill' ? availW : Math.min(availW, clamp(s.width ?? size.width, s.minWidth, s.maxWidth))
  const h = anchor === 'fill' ? availH : Math.min(availH, clamp(s.height ?? size.height, s.minHeight, s.maxHeight))

  let x = box.x + sl + ix
  let y = box.y + st + iy
  if (anchor === 'center' || anchor === 'top' || anchor === 'bottom') {
    x = box.x + sl + (box.width - sl - sr - w) / 2
  } else if (anchor === 'top-right' || anchor === 'bottom-right') {
    x = box.x + box.width - sr - ix - w
  }
  if (anchor === 'center') {
    y = box.y + st + (box.height - st - sb - h) / 2
  } else if (anchor === 'bottom-left' || anchor === 'bottom-right' || anchor === 'bottom') {
    y = box.y + box.height - sb - iy - h
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
}

function arrangeNode(
  node: LayoutNode,
  rect: LayoutRect,
  cache: WeakMap<LayoutNode, Size>,
  rects: Map<string, LayoutRect>,
  safe: Required<SafeInsets>
) {
  if (node.hidden) return
  if (node.id) rects.set(node.id, rect)
  const children = (node.children ?? []).filter(child => !child.hidden)
  if (!children.length) return

  const s = node.style ?? {}
  const [pt, pr, pb, pl] = normalizePadding(s.padding)
  const inner: LayoutRect = {
    x: rect.x + pl,
    y: rect.y + pt,
    width: Math.max(0, rect.width - pl - pr),
    height: Math.max(0, rect.height - pt - pb)
  }

  if (node.kind === 'overlay') {
    for (const child of children) {
      const measured = cache.get(child) ?? { width: 0, height: 0 }
      arrangeNode(child, placeInOverlay(inner, child, measured, safe), cache, rects, safe)
    }
    return
  }

  if (node.kind === 'box') {
    for (const child of children) {
      arrangeNode(child, inner, cache, rects, safe)
    }
    return
  }

  const isRow = node.kind === 'row'
  const mainAvail = isRow ? inner.width : inner.height
  const crossAvail = isRow ? inner.height : inner.width
  const gap = s.gap ?? 0
  const align = s.align ?? 'stretch'
  const justify = s.justify ?? 'start'
  const totalGap = gap * Math.max(0, children.length - 1)

  let fixedMain = 0
  let totalGrow = 0
  const sizes = children.map(child => {
    const measured = cache.get(child) ?? { width: 0, height: 0 }
    const grow = child.style?.grow ?? (child.kind === 'spacer' ? 1 : 0)
    const baseMain = isRow ? measured.width : measured.height
    fixedMain += grow > 0 ? 0 : baseMain
    totalGrow += grow
    return { child, measured, grow, baseMain }
  })

  const remaining = Math.max(0, mainAvail - fixedMain - totalGap)
  const allocated = sizes.map(item => {
    const rawMain = item.grow > 0 ? (remaining * item.grow) / totalGrow : item.baseMain
    const main = isRow
      ? clamp(rawMain, item.child.style?.minWidth, item.child.style?.maxWidth)
      : clamp(rawMain, item.child.style?.minHeight, item.child.style?.maxHeight)
    const measuredCross = isRow ? item.measured.height : item.measured.width
    const explicitCross = isRow ? item.child.style?.height : item.child.style?.width
    const cross = explicitCross !== undefined
      ? (isRow
        ? clamp(explicitCross, item.child.style?.minHeight, item.child.style?.maxHeight)
        : clamp(explicitCross, item.child.style?.minWidth, item.child.style?.maxWidth))
      : align === 'stretch'
        ? (isRow
          ? clamp(crossAvail, item.child.style?.minHeight, item.child.style?.maxHeight)
          : clamp(crossAvail, item.child.style?.minWidth, item.child.style?.maxWidth))
        : Math.min(crossAvail, measuredCross)
    return { ...item, main, cross }
  })

  const usedMain = allocated.reduce((sum, item) => sum + item.main, 0) + totalGap
  const freeMain = Math.max(0, mainAvail - usedMain)
  let cursor = justify === 'center' ? freeMain / 2 : justify === 'end' ? freeMain : 0
  const extraGap = justify === 'between' && children.length > 1 ? freeMain / (children.length - 1) : 0

  for (const item of allocated) {
    let crossOffset = 0
    if (align === 'center') crossOffset = (crossAvail - item.cross) / 2
    else if (align === 'end') crossOffset = crossAvail - item.cross
    const childRect: LayoutRect = isRow
      ? {
          x: Math.round(inner.x + cursor),
          y: Math.round(inner.y + crossOffset),
          width: Math.round(item.main),
          height: Math.round(item.cross)
        }
      : {
          x: Math.round(inner.x + crossOffset),
          y: Math.round(inner.y + cursor),
          width: Math.round(item.cross),
          height: Math.round(item.main)
        }
    arrangeNode(item.child, childRect, cache, rects, safe)
    cursor += item.main + gap + extraGap
  }
}

/** Resolve exact pixel rectangles for a declarative layout tree without any DOM or CSS. */
export function resolveLayout(
  root: LayoutNode,
  viewport: { width: number; height: number },
  safeArea: SafeInsets = {}
): Map<string, LayoutRect> {
  const safe: Required<SafeInsets> = {
    top: safeArea.top ?? 0,
    right: safeArea.right ?? 0,
    bottom: safeArea.bottom ?? 0,
    left: safeArea.left ?? 0
  }
  const cache = new WeakMap<LayoutNode, Size>()
  const rects = new Map<string, LayoutRect>()
  measureNode(root, viewport.width, viewport.height, cache)
  arrangeNode(root, { x: 0, y: 0, width: Math.round(viewport.width), height: Math.round(viewport.height) }, cache, rects, safe)
  return rects
}

export function column(props: { id?: string; style?: LayoutStyle; hidden?: boolean; transition?: LayoutTransition; widget?: Record<string, unknown> }, children: readonly LayoutNode[] = []): LayoutNode {
  return { ...props, kind: 'column', children }
}

export function row(props: { id?: string; style?: LayoutStyle; hidden?: boolean; transition?: LayoutTransition; widget?: Record<string, unknown> }, children: readonly LayoutNode[] = []): LayoutNode {
  return { ...props, kind: 'row', children }
}

export function overlay(props: { id?: string; style?: LayoutStyle; hidden?: boolean; transition?: LayoutTransition; widget?: Record<string, unknown> }, children: readonly LayoutNode[] = []): LayoutNode {
  return { ...props, kind: 'overlay', children }
}

export function boxNode(props: { id?: string; style?: LayoutStyle; hidden?: boolean; transition?: LayoutTransition; widget?: Record<string, unknown> }, children: readonly LayoutNode[] = []): LayoutNode {
  return { ...props, kind: 'box', children }
}

export function spacerNode(grow = 1): LayoutNode {
  return { kind: 'spacer', style: { grow } }
}
