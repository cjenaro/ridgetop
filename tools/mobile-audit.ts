import assert from 'node:assert/strict'
import type { BrowserPage, ChromiumPage, UiRect } from './browser-driver.ts'
import { assertGameViewport, isRecord, uiRect, until } from './browser-driver.ts'

export interface MobileViewportSpec {
  readonly id: string
  readonly name: string
  readonly width: number
  readonly height: number
  readonly captureScreenshots: boolean
}

export const MOBILE_VIEWPORTS: readonly MobileViewportSpec[] = [
  { id: '375x667', name: 'iPhone SE Portrait', width: 375, height: 667, captureScreenshots: true },
  { id: '390x844', name: 'iPhone 14/15 Portrait', width: 390, height: 844, captureScreenshots: true },
  { id: '844x390', name: 'Phone Landscape', width: 844, height: 390, captureScreenshots: true },
  { id: '667x375', name: 'Compact Phone Landscape', width: 667, height: 375, captureScreenshots: false },
  { id: '915x412', name: 'Large Phone Landscape', width: 915, height: 412, captureScreenshots: false }
]

export type InteractiveWidgetKind = 'button' | 'toggle' | 'select' | 'slider'

export interface UiWidgetSnapshot {
  readonly id: string
  readonly kind: InteractiveWidgetKind
  readonly role: string
  readonly label: string
  readonly disabled: boolean
  readonly bounds: UiRect
}

export interface MobileLayoutViolation {
  readonly kind: 'offscreen' | 'undersized' | 'overlap'
  readonly widgetId: string
  readonly otherWidgetId?: string
  readonly message: string
}

export interface MobileLayoutAuditOptions {
  readonly stage: string
  readonly uiLayer: string
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly label: string
  readonly minTouchWidth?: number
  readonly minTouchHeight?: number
  readonly maxOverlapRatio?: number
  readonly edgeTolerancePx?: number
  readonly ignoreIds?: readonly string[]
  readonly ignoreOverlapPairs?: ReadonlyArray<readonly [string, string]>
  /** Prefixes of 3D world-space projected pins (e.g. zoomable diorama map markers) excluded from HUD overlap/edge checks. */
  readonly ignoreWorldProjectedPrefixes?: readonly string[]
}

export interface MobileLayoutAuditReport {
  readonly label: string
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly widgetCount: number
  readonly widgets: readonly UiWidgetSnapshot[]
  readonly violations: readonly MobileLayoutViolation[]
}

function isInteractiveKind(value: unknown): value is InteractiveWidgetKind {
  return value === 'button' || value === 'toggle' || value === 'select' || value === 'slider'
}

function parseUiRect(value: unknown): UiRect | null {
  if (!isRecord(value)) return null
  if (
    typeof value.x !== 'number' || !Number.isFinite(value.x) ||
    typeof value.y !== 'number' || !Number.isFinite(value.y) ||
    typeof value.width !== 'number' || !Number.isFinite(value.width) ||
    typeof value.height !== 'number' || !Number.isFinite(value.height)
  ) {
    return null
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

function parseWidgetSnapshot(value: unknown): UiWidgetSnapshot | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !isInteractiveKind(value.kind)) return null
  const bounds = parseUiRect(value.bounds)
  if (!bounds) return null
  return {
    id: value.id,
    kind: value.kind,
    role: typeof value.role === 'string' ? value.role : value.kind,
    label: typeof value.label === 'string' ? value.label : value.id,
    disabled: Boolean(value.disabled),
    bounds
  }
}

export async function waitAnimationFrames(page: BrowserPage, frames = 2): Promise<void> {
  const count = Math.max(1, Math.floor(frames))
  await page.evaluate(`new Promise(resolve => {
    let left = ${count}
    const tick = () => {
      left -= 1
      if (left <= 0) resolve(true)
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })`)
}

export async function readUiSnapshot(page: BrowserPage): Promise<UiWidgetSnapshot[]> {
  const raw = await page.evaluate('window.__ridgetopUi?.snapshot?.() ?? []')
  if (!Array.isArray(raw)) {
    assert.fail(`Expected array from window.__ridgetopUi.snapshot(), got ${typeof raw}`)
  }
  const out: UiWidgetSnapshot[] = []
  for (const item of raw) {
    const parsed = parseWidgetSnapshot(item)
    if (parsed) out.push(parsed)
  }
  return out
}

function isFullscreenBackdrop(widget: UiWidgetSnapshot, viewportW: number, viewportH: number): boolean {
  const coversViewport = widget.bounds.width >= viewportW * 0.9 && widget.bounds.height >= viewportH * 0.9
  const looksLikeBackdrop = /scrim|backdrop|dismiss-bg|overlay-bg/i.test(widget.id)
  return coversViewport && looksLikeBackdrop
}

function formatRect(r: UiRect): string {
  return `[x=${r.x.toFixed(1)}, y=${r.y.toFixed(1)}, w=${r.width.toFixed(1)}, h=${r.height.toFixed(1)}]`
}

function isIgnoredPair(
  a: string,
  b: string,
  pairs: ReadonlyArray<readonly [string, string]> | undefined
): boolean {
  if (!pairs || pairs.length === 0) return false
  return pairs.some(([p1, p2]) => (p1 === a && p2 === b) || (p1 === b && p2 === a))
}

export async function auditMobileLayout(
  page: BrowserPage,
  options: MobileLayoutAuditOptions
): Promise<MobileLayoutAuditReport> {
  const {
    stage,
    uiLayer,
    viewportWidth,
    viewportHeight,
    label,
    minTouchWidth = 24,
    minTouchHeight = 22,
    maxOverlapRatio = 0.15,
    edgeTolerancePx = 1,
    ignoreIds = [],
    ignoreOverlapPairs,
    ignoreWorldProjectedPrefixes = []
  } = options

  await waitAnimationFrames(page, 2)

  await assertGameViewport(page, {
    stage,
    uiLayer,
    matchingPixels: false,
    noScroll: true,
    waitForFrame: false,
    label
  })
  assert.deepEqual(page.errors, [], `${label}: zero console/JS errors`)

  const allWidgets = await readUiSnapshot(page)
  const ignored = new Set(ignoreIds)
  const isWorldProjected = (id: string) => ignoreWorldProjectedPrefixes.some(prefix => id.startsWith(prefix))
  const widgets = allWidgets.filter(
    w => !ignored.has(w.id) && !isWorldProjected(w.id) && !isFullscreenBackdrop(w, viewportWidth, viewportHeight)
  )

  const violations: MobileLayoutViolation[] = []

  for (const w of widgets) {
    const r = w.bounds
    if (
      r.x < -edgeTolerancePx ||
      r.y < -edgeTolerancePx ||
      r.x + r.width > viewportWidth + edgeTolerancePx ||
      r.y + r.height > viewportHeight + edgeTolerancePx
    ) {
      violations.push({
        kind: 'offscreen',
        widgetId: w.id,
        message: `Widget "${w.id}" (${w.label}) clipped/off-screen ${formatRect(r)} outside ${viewportWidth}x${viewportHeight}`
      })
    }

    if (r.width <= 0 || r.height <= 0 || r.width < minTouchWidth || r.height < minTouchHeight) {
      violations.push({
        kind: 'undersized',
        widgetId: w.id,
        message: `Widget "${w.id}" (${w.label}) below min touch size (${minTouchWidth}x${minTouchHeight}): ${formatRect(r)}`
      })
    }
  }

  for (let i = 0; i < widgets.length; i++) {
    const a = widgets[i]
    for (let j = i + 1; j < widgets.length; j++) {
      const b = widgets[j]
      if (isIgnoredPair(a.id, b.id, ignoreOverlapPairs)) continue
      const ix = Math.max(0, Math.min(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width) - Math.max(a.bounds.x, b.bounds.x))
      const iy = Math.max(0, Math.min(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height) - Math.max(a.bounds.y, b.bounds.y))
      if (ix <= 0 || iy <= 0) continue
      const overlapArea = ix * iy
      const areaA = a.bounds.width * a.bounds.height
      const areaB = b.bounds.width * b.bounds.height
      const minArea = Math.min(areaA, areaB)
      if (minArea <= 0) continue
      const ratio = overlapArea / minArea
      if (ratio > maxOverlapRatio) {
        violations.push({
          kind: 'overlap',
          widgetId: a.id,
          otherWidgetId: b.id,
          message: `Widgets "${a.id}" ${formatRect(a.bounds)} and "${b.id}" ${formatRect(b.bounds)} overlap by ${(ratio * 100).toFixed(1)}% (limit ${(maxOverlapRatio * 100).toFixed(0)}%)`
        })
      }
    }
  }

  return {
    label,
    viewportWidth,
    viewportHeight,
    widgetCount: widgets.length,
    widgets,
    violations
  }
}

export async function assertMobileLayout(
  page: BrowserPage,
  options: MobileLayoutAuditOptions
): Promise<MobileLayoutAuditReport> {
  const report = await auditMobileLayout(page, options)
  if (report.violations.length > 0) {
    const details = report.violations.map((v, idx) => `  ${idx + 1}. [${v.kind}] ${v.message}`).join('\n')
    assert.fail(
      `Mobile layout geometry audit failed for ${report.label} (${report.viewportWidth}x${report.viewportHeight}, ${report.widgetCount} widgets):\n${details}`
    )
  }
  return report
}

export async function touchTapRect(page: ChromiumPage, rect: UiRect): Promise<void> {
  const point = {
    x: Math.round(rect.x + rect.width * 0.5),
    y: Math.round(rect.y + rect.height * 0.5)
  }
  await page.dispatchTouch('touchStart', [point])
  await page.dispatchTouch('touchEnd', [])
}

export async function touchTapWidget(
  page: ChromiumPage,
  id: string,
  description?: string
): Promise<UiRect> {
  const rect = await until(
    () => uiRect(page, id),
    r => Boolean(r && r.width > 0 && r.height > 0),
    description ?? `widget "${id}" laid out for touch tap`
  )
  assert.ok(rect, `Expected layout rect for widget "${id}"`)
  await touchTapRect(page, rect)
  return rect
}
