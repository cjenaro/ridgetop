import type { LayoutRect } from 'ridgetop/ui-layout'
import type { CanvasWidgetDrawState } from 'ridgetop/ui-canvas'
import type {
  BattleUnit, CombatForecast, CombatForecastAlt, EquipSlot, EquipmentSpec, HeroSpec, OwnedHeroCard,
  PackSpec, Rarity, SkillSpec, TacticCardSpec, TurnPreviewEntry
} from './types.ts'
import { RARITY_META } from './data.ts'

// ===========================================================================
// Stylized Game UI Tokens
// Chunky 3D-beveled slate-steel plates, thick dark ink outlines, physical
// extruded press depth, outlined display type, faceted gems & coins,
// segmented glowing bars, and diagonal rarity ribbons — matching Crownshard's
// colorful low-poly tabletop miniature world.
// ===========================================================================

export const FONT = '"Trebuchet MS", "Segoe UI", "SF Pro Rounded", system-ui, -apple-system, sans-serif'
export const FONT_DISPLAY = '"Trebuchet MS", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif'
export const FONT_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

export const COLOR = {
  ink: '#090d1a',
  outline: '#0b1020',
  surface: '#263354',
  surfaceTop: '#3a4c78',
  surfaceBot: '#1d2742',
  surfaceLip: '#11172a',
  surfaceAlt: '#324269',
  surfaceHi: '#465c8f',
  well: '#131a2e',
  wellDeep: '#0d1324',
  top: '#7590c855',
  border: '#5a72a6',
  borderHi: '#9cb5eb',
  text: '#ffffff',
  muted: '#b8c7e6',
  faint: '#7889b0',
  accent: '#ffc83b',
  accentHi: '#ffe680',
  accentLo: '#eb8d0e',
  accentLip: '#995005',
  accentText: '#2b1600',
  glow: '#ffc83b88',
  ally: '#42c2ff',
  allyDark: '#1b6eb8',
  enemy: '#ff5266',
  enemyDark: '#a61c32',
  good: '#3ee07f',
  goodLo: '#17a654',
  goodLip: '#0d6634',
  danger: '#ff5768',
  dangerLo: '#cf273b',
  dangerLip: '#7d1322',
  ap: '#5ce1ff',
  apLo: '#188ae0',
  scrim: '#070a14b8'
} as const

export const RADIUS = { xs: 5, sm: 8, md: 11, lg: 14, xl: 18 } as const
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const
export const TYPE = { micro: 10, caption: 11, label: 12, body: 13, lead: 15, title: 18, h2: 24, h1: 32 } as const

/** Tier 1/2/3 skill colors (0 = basic strike). */
export const TIER_COLOR: Record<0 | 1 | 2 | 3, string> = { 0: '#ffc83b', 1: '#42c2ff', 2: '#c075ff', 3: '#ffad33' }

/** Canvas UI theme palette (fed to createUiTheme and mirrored by the packaged build). */
export const UI_THEME_PALETTE = {
  uiSurface: COLOR.surface,
  uiSurfaceAlt: COLOR.surfaceAlt,
  uiTop: COLOR.top,
  uiBorder: COLOR.border,
  accent: COLOR.accent,
  accentText: COLOR.accentText,
  light: COLOR.text,
  muted: COLOR.muted,
  scrim: COLOR.scrim
} as const

export type IconName =
  | 'chevron-left' | 'chevron-right' | 'pause' | 'play' | 'music' | 'volume' | 'mute' | 'gauge'
  | 'rotate-left' | 'rotate-right' | 'sword' | 'shield' | 'heart' | 'boot' | 'bolt' | 'target'
  | 'crit' | 'star' | 'coin' | 'gem' | 'hourglass' | 'lock' | 'check' | 'plus' | 'minus' | 'sparkle' | 'flag'
  | 'users' | 'bag' | 'cards' | 'camp' | 'arrow-right' | 'up' | 'sell' | 'retreat'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

// ===========================================================================
// Core Game UI Primitives
// ===========================================================================

export function font(size: number, weight = 700, display = false) {
  return `${weight} ${size}px ${display ? FONT_DISPLAY : FONT}`
}

export function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, w * 0.5, h * 0.5))
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

function drawStarShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number, points = 5) {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (i * Math.PI) / points - Math.PI / 2
    const px = cx + Math.cos(angle) * r
    const py = cy + Math.sin(angle) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`
}

/** Shorten `text` with an ellipsis so it fits in `maxW` at the current font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (maxW <= 0) return ''
  if (ctx.measureText(text).width <= maxW) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid).trimEnd() + '...').width <= maxW) lo = mid
    else hi = mid - 1
  }
  return lo <= 0 ? '' : text.slice(0, lo).trimEnd() + '...'
}

export interface TextOpts {
  size?: number
  weight?: number
  color?: string
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  maxW?: number
  display?: boolean
  spacing?: number
  upper?: boolean
  /** Draw crisp dark game-UI ink stroke around glyphs (default false; pass true or hex). */
  stroke?: boolean | string
  strokeWidth?: number
  /** Draw hard 1.5px dark game drop shadow (default false). */
  shadow?: boolean
}

/** Single line of bold game-styled text, ellipsized cleanly to maxW. Returns drawn width. */
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: TextOpts = {}) {
  const size = o.size ?? TYPE.body
  ctx.font = font(size, o.weight ?? 700, o.display)
  setSpacing(ctx, o.spacing ?? 0)
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = o.baseline ?? 'middle'
  const str = o.upper ? text.toUpperCase() : text
  const shown = o.maxW !== undefined ? fitText(ctx, str, o.maxW) : str
  if (o.stroke) {
    ctx.save()
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = o.strokeWidth ?? Math.max(2.4, size * 0.2)
    ctx.strokeStyle = typeof o.stroke === 'string' ? o.stroke : COLOR.outline
    ctx.strokeText(shown, x, y + 0.5)
    ctx.restore()
  } else if (o.shadow) {
    ctx.fillStyle = '#070b18cc'
    ctx.fillText(shown, x, y + 1.5)
  }
  ctx.fillStyle = o.color ?? COLOR.text
  ctx.fillText(shown, x, y)
  const w = ctx.measureText(shown).width
  setSpacing(ctx, 0)
  return w
}

export function measureText(ctx: CanvasRenderingContext2D, text: string, size: number, weight = 700, display = false) {
  ctx.font = font(size, weight, display)
  return ctx.measureText(text).width
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean)
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width <= maxW || !line) line = next
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

/** Wrapped paragraph clipped to the box with an ellipsis on the last visible line. Returns used height. */
export function drawParagraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  o: TextOpts & { lineHeight?: number; valign?: 'top' | 'middle' } = {}
) {
  const size = o.size ?? TYPE.body
  ctx.font = font(size, o.weight ?? 600, o.display)
  ctx.textBaseline = 'middle'
  const align = o.align ?? 'left'
  ctx.textAlign = align
  const lh = o.lineHeight ?? Math.round(size * 1.35)
  const lines = wrapLines(ctx, text, w)
  const maxLines = Math.max(1, Math.floor(h / lh))
  const shown = lines.slice(0, maxLines)
  if (lines.length > maxLines) shown[maxLines - 1] = fitText(ctx, shown[maxLines - 1] + ' ...........', w)
  const total = shown.length * lh
  const startY = (o.valign === 'middle' ? y + Math.max(0, (h - total) / 2) : y) + lh / 2
  const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x
  shown.forEach((line, i) => {
    const ly = startY + i * lh
    if (o.shadow) {
      ctx.fillStyle = '#070b18aa'
      ctx.fillText(line, tx, ly + 1.2)
    }
    ctx.fillStyle = o.color ?? COLOR.text
    ctx.fillText(line, tx, ly)
  })
  return total
}

export interface SurfaceOpts {
  r?: number
  fill?: string
  fillBot?: string
  lip?: string
  lipH?: number
  border?: string
  rim?: string
  shadow?: boolean
  highlight?: boolean
  glow?: string
  alpha?: number
}

/**
 * Chunky 3D-beveled game plate: solid dark-ink outer border, physical extruded bottom lip,
 * metallic/slate vertical gradient, and crisp inner top rim highlight.
 */
export function drawSurface(ctx: CanvasRenderingContext2D, rect: LayoutRect, o: SurfaceOpts = {}) {
  const { x, y, width: w, height: h } = rect
  if (w < 2 || h < 2) return
  const r = Math.min(o.r ?? RADIUS.lg, w * 0.5, h * 0.5)
  const lipH = o.lipH ?? (h >= 34 ? 4 : 2)
  const topCol = o.fill ?? COLOR.surfaceTop
  const botCol = o.fillBot ?? (o.fill ? o.fill : COLOR.surfaceBot)
  const lipCol = o.lip ?? COLOR.surfaceLip

  ctx.save()
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha

  // Grounded drop shadow
  if (o.shadow !== false || o.glow) {
    ctx.save()
    ctx.shadowColor = o.glow ?? '#05081499'
    ctx.shadowBlur = o.glow ? 16 : 14
    ctx.shadowOffsetY = o.glow ? 0 : 5
    rr(ctx, x, y, w, h, r)
    ctx.fillStyle = COLOR.outline
    ctx.fill()
    ctx.restore()
  }

  // Extruded lower thickness (base lip)
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = lipCol
  ctx.fill()

  // Main raised plate face
  const faceH = Math.max(2, h - lipH)
  rr(ctx, x + 1, y + 1, w - 2, faceH - 1, Math.max(0, r - 1))
  const g = ctx.createLinearGradient(0, y, 0, y + faceH)
  g.addColorStop(0, topCol)
  g.addColorStop(1, botCol)
  ctx.fillStyle = g
  ctx.fill()

  // Crisp inner top bevel highlight
  if (o.highlight !== false && faceH > 12) {
    ctx.save()
    rr(ctx, x + 2, y + 2, w - 4, faceH - 3, Math.max(0, r - 2))
    ctx.clip()
    const hi = ctx.createLinearGradient(0, y + 2, 0, y + Math.min(faceH * 0.55, 22))
    hi.addColorStop(0, '#ffffff26')
    hi.addColorStop(1, '#ffffff00')
    ctx.fillStyle = hi
    ctx.fillRect(x + 2, y + 2, w - 4, Math.min(faceH * 0.55, 22))
    ctx.restore()
    rr(ctx, x + 2, y + 2, w - 4, faceH - 3, Math.max(0, r - 2))
    ctx.strokeStyle = o.rim ?? '#ffffff24'
    ctx.lineWidth = 1.25
    ctx.stroke()
  }

  // Bold dark-ink game outline
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1))
  ctx.strokeStyle = o.border ?? COLOR.outline
  ctx.lineWidth = 2.2
  ctx.stroke()
  ctx.restore()
}

/** Diagonal corner rarity ribbon clipped cleanly to a card's top-right corner. */
function drawCornerRibbon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string, size = 22) {
  ctx.save()
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1))
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(x + w - size, y)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x + w, y + size)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + w - size, y)
  ctx.lineTo(x + w, y + size)
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
  // Thin highlight stripe parallel to edge
  ctx.beginPath()
  ctx.moveTo(x + w - size + 5, y)
  ctx.lineTo(x + w, y + size - 5)
  ctx.strokeStyle = '#ffffff55'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

/** Stylized illustrated 3D gold coin or faceted crystal overlapping a chunky dark counter pill. */
function drawCurrencyBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  text: string,
  kind: 'coin' | 'gem' | 'deck',
  h = 26
) {
  const pillH = h - 4
  const pillY = cy - pillH / 2
  const textW = measureText(ctx, text, 12.5, 800, true)
  const iconR = h * 0.56
  const pillX = x + iconR * 0.72
  const pillW = Math.round(textW + iconR * 1.1 + 14)

  ctx.save()
  // Recessed dark counter bar with steel rim & thick ink border
  rr(ctx, pillX, pillY, pillW, pillH, pillH / 2)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()
  rr(ctx, pillX + 1.5, pillY + 1.5, pillW - 3, pillH - 3, pillH / 2 - 1)
  ctx.strokeStyle = '#4e6394'
  ctx.lineWidth = 1.5
  ctx.stroke()
  rr(ctx, pillX, pillY, pillW, pillH, pillH / 2)
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.2
  ctx.stroke()

  // Overlapping oversized 3D emblem on the left
  const icx = x + iconR
  if (kind === 'coin') {
    draw3DCoin(ctx, icx, cy, iconR)
  } else if (kind === 'gem') {
    drawFacetedGem(ctx, icx, cy, iconR, '#66ff9e', '#17a654')
  } else {
    // Deck badge disc
    ctx.beginPath()
    ctx.arc(icx, cy, iconR * 0.92, 0, Math.PI * 2)
    const g = ctx.createLinearGradient(0, cy - iconR, 0, cy + iconR)
    g.addColorStop(0, '#5ef0a0')
    g.addColorStop(1, '#1a9c58')
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = 2.2
    ctx.strokeStyle = COLOR.outline
    ctx.stroke()
    drawIcon(ctx, 'cards', icx, cy, iconR * 1.05, '#072b16')
  }

  drawText(ctx, text, pillX + iconR * 0.95 + 4, cy + 0.5, {
    size: 12.5,
    weight: 900,
    color: kind === 'coin' ? COLOR.accentHi : kind === 'deck' ? '#b8ffd6' : '#ffffff',
    display: true,
    stroke: true,
    strokeWidth: 2.6
  })
  ctx.restore()
  return pillX - x + pillW
}

function draw3DCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save()
  // Outer thick ink shadow
  ctx.beginPath()
  ctx.arc(cx, cy + 1.2, r, 0, Math.PI * 2)
  ctx.fillStyle = COLOR.outline
  ctx.fill()
  // Rim
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2)
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  g.addColorStop(0, '#fff2a6')
  g.addColorStop(0.45, '#ffc83b')
  g.addColorStop(1, '#d97706')
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = COLOR.outline
  ctx.stroke()
  // Inner recessed coin face
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.66, 0, Math.PI * 2)
  const ig = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
  ig.addColorStop(0, '#e3870e')
  ig.addColorStop(1, '#ffd966')
  ctx.fillStyle = ig
  ctx.fill()
  // Tiny crown stamp in center
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.34, cy + r * 0.22)
  ctx.lineTo(cx - r * 0.38, cy - r * 0.18)
  ctx.lineTo(cx - r * 0.14, cy + r * 0.02)
  ctx.lineTo(cx, cy - r * 0.28)
  ctx.lineTo(cx + r * 0.14, cy + r * 0.02)
  ctx.lineTo(cx + r * 0.38, cy - r * 0.18)
  ctx.lineTo(cx + r * 0.34, cy + r * 0.22)
  ctx.closePath()
  ctx.fillStyle = '#fff5bd'
  ctx.fill()
  ctx.restore()
}

function drawFacetedGem(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, hi: string, lo: string) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx, cy - r)
  ctx.lineTo(cx + r * 0.82, cy - r * 0.28)
  ctx.lineTo(cx + r * 0.82, cy + r * 0.32)
  ctx.lineTo(cx, cy + r)
  ctx.lineTo(cx - r * 0.82, cy + r * 0.32)
  ctx.lineTo(cx - r * 0.82, cy - r * 0.28)
  ctx.closePath()
  const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.28, hi)
  g.addColorStop(1, lo)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = COLOR.outline
  ctx.stroke()
  // Inner center facet highlight
  ctx.beginPath()
  ctx.moveTo(cx, cy - r * 0.56)
  ctx.lineTo(cx + r * 0.44, cy - r * 0.1)
  ctx.lineTo(cx, cy + r * 0.56)
  ctx.lineTo(cx - r * 0.44, cy - r * 0.1)
  ctx.closePath()
  ctx.fillStyle = '#ffffff55'
  ctx.fill()
  ctx.restore()
}

export function drawFocusRing(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save()
  rr(ctx, x - 3, y - 3, w + 6, h + 6, r + 3)
  ctx.strokeStyle = COLOR.accentHi
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.restore()
}

export function drawStars(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  filled: number,
  total = 3,
  size = 11,
  align: 'left' | 'center' | 'right' = 'left',
  color: string = COLOR.accent
) {
  const gap = size * 1.15
  const width = gap * (total - 1) + size
  const start = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x
  ctx.save()
  for (let i = 0; i < total; i++) {
    const cx = start + size / 2 + i * gap
    drawStarShape(ctx, cx, cy, size * 0.54, size * 0.25)
    ctx.fillStyle = i < filled ? color : '#182038'
    ctx.fill()
    ctx.lineWidth = 1.6
    ctx.strokeStyle = COLOR.outline
    ctx.stroke()
  }
  ctx.restore()
  return width
}

/** Dynamic health color: green -> warm amber -> danger red (like classic tactical RPGs). */
function hpBarColor(ratio: number, isEnemy = false): [string, string] {
  if (isEnemy) return ['#ff6b7a', '#cf2539']
  if (ratio <= 0.3) return ['#ff6373', '#d42438']
  if (ratio <= 0.6) return ['#ffba42', '#e07b0c']
  return ['#5cf294', '#1cb85c']
}

export function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  color: string,
  track: string = COLOR.wellDeep,
  segments = 0
) {
  const r = Math.min(h / 2, 6)
  ctx.save()
  // Recessed dark track with crisp ink border
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = track
  ctx.fill()

  const clamped = Math.max(0, Math.min(1, ratio))
  if (segments > 0 && w >= segments * 6) {
    const pad = 2
    const gap = 2
    const segW = (w - pad * 2 - gap * (segments - 1)) / segments
    const lit = clamped * segments
    for (let i = 0; i < segments; i++) {
      const sx = x + pad + i * (segW + gap)
      const sy = y + pad
      const sh = Math.max(2, h - pad * 2)
      const fillAmt = Math.max(0, Math.min(1, lit - i))
      rr(ctx, sx, sy, segW, sh, 2.5)
      ctx.fillStyle = '#202b47'
      ctx.fill()
      if (fillAmt > 0.05) {
        rr(ctx, sx, sy, Math.max(2, segW * fillAmt), sh, 2.5)
        ctx.fillStyle = color
        ctx.fill()
        // Gloss top strip
        rr(ctx, sx, sy, Math.max(2, segW * fillAmt), Math.max(1, sh * 0.42), 2)
        ctx.fillStyle = '#ffffff44'
        ctx.fill()
      }
    }
  } else {
    const fw = clamped * (w - 3)
    if (fw > 1) {
      rr(ctx, x + 1.5, y + 1.5, Math.max(h - 3, fw), h - 3, Math.max(1, r - 1))
      ctx.fillStyle = color
      ctx.fill()
      if (h >= 6) {
        rr(ctx, x + 2, y + 2, Math.max(h - 4, fw - 1), Math.max(1.5, (h - 3) * 0.42), Math.max(1, r - 1))
        ctx.fillStyle = '#ffffff4c'
        ctx.fill()
      }
    }
  }

  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r)
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.8
  ctx.stroke()
  ctx.restore()
}

export function drawKeycap(ctx: CanvasRenderingContext2D, x: number, y: number, key: string, size = 17, dim = false) {
  const w = Math.max(size, measureText(ctx, key, size * 0.58, 900, true) + size * 0.56)
  ctx.save()
  if (dim) ctx.globalAlpha *= 0.5
  // Chunky physical keycap with 2px lip
  rr(ctx, x, y, w, size, 5)
  ctx.fillStyle = '#12182b'
  ctx.fill()
  rr(ctx, x + 1, y + 1, w - 2, size - 3, 4)
  ctx.fillStyle = '#3c4e78'
  ctx.fill()
  rr(ctx, x + 1, y + 1, w - 2, size - 2, 4.5)
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.6
  ctx.stroke()
  drawText(ctx, key, x + w / 2, y + (size - 2) / 2 + 0.5, {
    size: Math.round(size * 0.58),
    weight: 900,
    color: '#f2f6ff',
    align: 'center',
    display: true
  })
  ctx.restore()
  return w
}

/** Chunky outlined game badge chip with optional icon. Returns its width. */
export function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  o: { color?: string; bg?: string; icon?: IconName; h?: number; size?: number; align?: 'left' | 'right' | 'center'; border?: string } = {}
) {
  const h = o.h ?? 20
  const size = o.size ?? Math.round(h * 0.54)
  const iconW = o.icon ? h * 0.62 + 4 : 0
  const w = Math.round(measureText(ctx, text, size, 800, true) + iconW + h * 0.78)
  const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x
  ctx.save()
  rr(ctx, left, y, w, h, h / 2)
  ctx.fillStyle = o.bg ?? '#1c2642'
  ctx.fill()
  ctx.strokeStyle = o.border ?? COLOR.outline
  ctx.lineWidth = 1.8
  ctx.stroke()
  const color = o.color ?? COLOR.text
  let tx = left + h * 0.38
  if (o.icon) {
    drawIcon(ctx, o.icon, tx + h * 0.3, y + h / 2, h * 0.6, color)
    tx += iconW
  }
  drawText(ctx, text, tx, y + h / 2 + 0.5, { size, weight: 800, color, display: true })
  ctx.restore()
  return w
}

export function drawOverline(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW?: number, color: string = COLOR.accentHi) {
  return drawText(ctx, text, x, y, { size: TYPE.micro, weight: 900, color, upper: true, spacing: 1.2, maxW, display: true, shadow: true })
}

/** Chunky dark-outlined portrait tile with beveled colored border & radial studio backdrop. */
export function drawPortraitTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  portrait: CanvasImageSource | undefined,
  o: { ring?: string; r?: number; ringW?: number; dim?: boolean; bg?: string } = {}
) {
  const r = o.r ?? Math.round(size * 0.22)
  ctx.save()
  // Outer thick ink frame
  rr(ctx, x, y, size, size, r)
  const g = ctx.createRadialGradient(x + size * 0.5, y + size * 0.35, size * 0.08, x + size * 0.5, y + size * 0.5, size * 0.78)
  g.addColorStop(0, o.bg ?? '#455b8f')
  g.addColorStop(1, '#151d33')
  ctx.fillStyle = g
  ctx.fill()
  ctx.save()
  ctx.clip()
  if (portrait) {
    ctx.imageSmoothingEnabled = false
    const s = size * 1.06
    ctx.drawImage(portrait, x + (size - s) / 2, y + (size - s) * 0.3, s, s)
  }
  // Subtle top gloss
  const gl = ctx.createLinearGradient(0, y, 0, y + size * 0.35)
  gl.addColorStop(0, '#ffffff24')
  gl.addColorStop(1, '#ffffff00')
  ctx.fillStyle = gl
  ctx.fillRect(x, y, size, size * 0.35)
  if (o.dim) {
    ctx.fillStyle = '#090d1aa6'
    ctx.fillRect(x, y, size, size)
  }
  ctx.restore()
  // Colored team/rarity bezel inside dark outer outline
  rr(ctx, x + 2, y + 2, size - 4, size - 4, Math.max(0, r - 2))
  ctx.strokeStyle = o.ring ?? COLOR.borderHi
  ctx.lineWidth = o.ringW ?? 2.2
  ctx.stroke()
  rr(ctx, x + 0.5, y + 0.5, size - 1, size - 1, r)
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.2
  ctx.stroke()
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Bold Game Vector Icon Set
// ---------------------------------------------------------------------------

export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, size: number, color: string) {
  const s = size / 2
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(1.8, size * 0.15)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  switch (name) {
    case 'chevron-left':
      ctx.moveTo(cx + s * 0.32, cy - s * 0.62); ctx.lineTo(cx - s * 0.34, cy); ctx.lineTo(cx + s * 0.32, cy + s * 0.62); ctx.stroke(); break
    case 'chevron-right':
      ctx.moveTo(cx - s * 0.32, cy - s * 0.62); ctx.lineTo(cx + s * 0.34, cy); ctx.lineTo(cx - s * 0.32, cy + s * 0.62); ctx.stroke(); break
    case 'arrow-right':
      ctx.moveTo(cx - s * 0.7, cy); ctx.lineTo(cx + s * 0.6, cy); ctx.moveTo(cx + s * 0.1, cy - s * 0.5); ctx.lineTo(cx + s * 0.65, cy); ctx.lineTo(cx + s * 0.1, cy + s * 0.5); ctx.stroke(); break
    case 'up':
      ctx.moveTo(cx, cy + s * 0.7); ctx.lineTo(cx, cy - s * 0.6); ctx.moveTo(cx - s * 0.5, cy - s * 0.1); ctx.lineTo(cx, cy - s * 0.65); ctx.lineTo(cx + s * 0.5, cy - s * 0.1); ctx.stroke(); break
    case 'pause':
      rr(ctx, cx - s * 0.58, cy - s * 0.68, s * 0.4, s * 1.36, s * 0.14); ctx.fill()
      rr(ctx, cx + s * 0.18, cy - s * 0.68, s * 0.4, s * 1.36, s * 0.14); ctx.fill(); break
    case 'play':
      ctx.moveTo(cx - s * 0.42, cy - s * 0.68); ctx.lineTo(cx + s * 0.64, cy); ctx.lineTo(cx - s * 0.42, cy + s * 0.68); ctx.closePath(); ctx.fill(); break
    case 'music':
      ctx.moveTo(cx - s * 0.25, cy + s * 0.45); ctx.lineTo(cx - s * 0.25, cy - s * 0.65); ctx.lineTo(cx + s * 0.6, cy - s * 0.8); ctx.lineTo(cx + s * 0.6, cy + s * 0.3); ctx.stroke()
      ctx.beginPath(); ctx.ellipse(cx - s * 0.48, cy + s * 0.5, s * 0.28, s * 0.22, -0.3, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(cx + s * 0.37, cy + s * 0.35, s * 0.28, s * 0.22, -0.3, 0, Math.PI * 2); ctx.fill(); break
    case 'volume':
    case 'mute':
      ctx.moveTo(cx - s * 0.8, cy - s * 0.3); ctx.lineTo(cx - s * 0.4, cy - s * 0.3); ctx.lineTo(cx + s * 0.05, cy - s * 0.72); ctx.lineTo(cx + s * 0.05, cy + s * 0.72); ctx.lineTo(cx - s * 0.4, cy + s * 0.3); ctx.lineTo(cx - s * 0.8, cy + s * 0.3); ctx.closePath(); ctx.fill()
      ctx.beginPath()
      if (name === 'volume') { ctx.arc(cx + s * 0.1, cy, s * 0.5, -0.8, 0.8); ctx.moveTo(cx + s * 0.38, cy - s * 0.62); ctx.arc(cx + s * 0.1, cy, s * 0.82, -0.8, 0.8) }
      else { ctx.moveTo(cx + s * 0.35, cy - s * 0.35); ctx.lineTo(cx + s * 0.85, cy + s * 0.35); ctx.moveTo(cx + s * 0.85, cy - s * 0.35); ctx.lineTo(cx + s * 0.35, cy + s * 0.35) }
      ctx.stroke(); break
    case 'gauge':
      ctx.arc(cx, cy + s * 0.25, s * 0.78, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.25); ctx.lineTo(cx + s * 0.42, cy - s * 0.3); ctx.stroke(); break
    case 'rotate-left':
    case 'rotate-right': {
      const dir = name === 'rotate-left' ? -1 : 1
      ctx.arc(cx, cy, s * 0.62, dir < 0 ? -0.3 : Math.PI + 0.3, dir < 0 ? Math.PI * 1.35 : -Math.PI * 0.35, dir < 0)
      ctx.stroke()
      const ax = cx + dir * s * 0.6
      const ay = cy - s * 0.18
      ctx.beginPath(); ctx.moveTo(ax - dir * s * 0.02, ay - s * 0.5); ctx.lineTo(ax + dir * s * 0.02, ay + s * 0.08); ctx.lineTo(ax - dir * s * 0.55, ay - s * 0.05); ctx.stroke(); break
    }
    case 'sword':
      ctx.moveTo(cx - s * 0.7, cy + s * 0.7); ctx.lineTo(cx + s * 0.7, cy - s * 0.7); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx - s * 0.55, cy + s * 0.05); ctx.lineTo(cx - s * 0.05, cy + s * 0.55); ctx.stroke(); break
    case 'shield':
      ctx.moveTo(cx, cy - s * 0.8); ctx.lineTo(cx + s * 0.7, cy - s * 0.5); ctx.quadraticCurveTo(cx + s * 0.7, cy + s * 0.45, cx, cy + s * 0.82); ctx.quadraticCurveTo(cx - s * 0.7, cy + s * 0.45, cx - s * 0.7, cy - s * 0.5); ctx.closePath(); ctx.fill(); break
    case 'heart':
      ctx.moveTo(cx, cy + s * 0.75)
      ctx.bezierCurveTo(cx - s * 1.1, cy - s * 0.05, cx - s * 0.55, cy - s * 0.95, cx, cy - s * 0.35)
      ctx.bezierCurveTo(cx + s * 0.55, cy - s * 0.95, cx + s * 1.1, cy - s * 0.05, cx, cy + s * 0.75)
      ctx.fill(); break
    case 'boot':
      ctx.moveTo(cx - s * 0.35, cy - s * 0.8); ctx.lineTo(cx - s * 0.35, cy + s * 0.5); ctx.lineTo(cx + s * 0.7, cy + s * 0.5); ctx.lineTo(cx + s * 0.6, cy + s * 0.1); ctx.lineTo(cx + s * 0.15, cy); ctx.lineTo(cx + s * 0.15, cy - s * 0.8); ctx.closePath(); ctx.fill(); break
    case 'bolt':
      ctx.moveTo(cx + s * 0.15, cy - s * 0.9); ctx.lineTo(cx - s * 0.55, cy + s * 0.12); ctx.lineTo(cx - s * 0.02, cy + s * 0.12); ctx.lineTo(cx - s * 0.18, cy + s * 0.9); ctx.lineTo(cx + s * 0.55, cy - s * 0.15); ctx.lineTo(cx + s * 0.02, cy - s * 0.15); ctx.closePath(); ctx.fill(); break
    case 'target':
      ctx.arc(cx, cy, s * 0.7, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2); ctx.fill(); break
    case 'crit':
      drawStarShape(ctx, cx, cy, s * 0.88, s * 0.34, 4); ctx.fill(); break
    case 'star':
      drawStarShape(ctx, cx, cy, s * 0.92, s * 0.42, 5); ctx.fill(); break
    case 'coin':
      draw3DCoin(ctx, cx, cy, s * 0.9); break
    case 'gem':
      drawFacetedGem(ctx, cx, cy, s * 0.95, color, COLOR.outline); break
    case 'hourglass':
      ctx.moveTo(cx - s * 0.6, cy - s * 0.8); ctx.lineTo(cx + s * 0.6, cy - s * 0.8); ctx.lineTo(cx - s * 0.6, cy + s * 0.8); ctx.lineTo(cx + s * 0.6, cy + s * 0.8); ctx.closePath(); ctx.stroke(); break
    case 'lock':
      rr(ctx, cx - s * 0.64, cy - s * 0.1, s * 1.28, s * 0.98, s * 0.2); ctx.fill()
      ctx.beginPath(); ctx.arc(cx, cy - s * 0.12, s * 0.42, Math.PI, 0); ctx.stroke(); break
    case 'check':
      ctx.moveTo(cx - s * 0.6, cy); ctx.lineTo(cx - s * 0.15, cy + s * 0.5); ctx.lineTo(cx + s * 0.65, cy - s * 0.5); ctx.stroke(); break
    case 'plus':
      ctx.moveTo(cx - s * 0.6, cy); ctx.lineTo(cx + s * 0.6, cy); ctx.moveTo(cx, cy - s * 0.6); ctx.lineTo(cx, cy + s * 0.6); ctx.stroke(); break
    case 'minus':
      ctx.moveTo(cx - s * 0.6, cy); ctx.lineTo(cx + s * 0.6, cy); ctx.stroke(); break
    case 'sparkle':
      ctx.moveTo(cx, cy - s * 0.85); ctx.quadraticCurveTo(cx + s * 0.14, cy - s * 0.14, cx + s * 0.85, cy)
      ctx.quadraticCurveTo(cx + s * 0.14, cy + s * 0.14, cx, cy + s * 0.85)
      ctx.quadraticCurveTo(cx - s * 0.14, cy + s * 0.14, cx - s * 0.85, cy)
      ctx.quadraticCurveTo(cx - s * 0.14, cy - s * 0.14, cx, cy - s * 0.85)
      ctx.closePath(); ctx.fill(); break
    case 'flag':
      ctx.moveTo(cx - s * 0.55, cy + s * 0.85); ctx.lineTo(cx - s * 0.55, cy - s * 0.8); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx - s * 0.5, cy - s * 0.8); ctx.lineTo(cx + s * 0.72, cy - s * 0.46); ctx.lineTo(cx - s * 0.5, cy - s * 0.1); ctx.closePath(); ctx.fill(); break
    case 'users':
      ctx.arc(cx - s * 0.25, cy - s * 0.35, s * 0.32, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(cx - s * 0.25, cy + s * 0.75, s * 0.62, Math.PI, 0); ctx.fill()
      ctx.beginPath(); ctx.arc(cx + s * 0.45, cy - s * 0.25, s * 0.26, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(cx + s * 0.5, cy + s * 0.72, s * 0.45, Math.PI, 0); ctx.fill(); break
    case 'bag':
      rr(ctx, cx - s * 0.7, cy - s * 0.35, s * 1.4, s * 1.15, s * 0.22); ctx.fill()
      ctx.beginPath(); ctx.arc(cx, cy - s * 0.35, s * 0.36, Math.PI, 0); ctx.stroke(); break
    case 'cards':
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.22)
      rr(ctx, -s * 0.75, -s * 0.72, s * 0.95, s * 1.35, s * 0.14); ctx.stroke(); ctx.restore()
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.18)
      rr(ctx, -s * 0.2, -s * 0.68, s * 0.95, s * 1.35, s * 0.14); ctx.fill(); ctx.restore(); break
    case 'camp':
      ctx.moveTo(cx - s * 0.85, cy + s * 0.72); ctx.lineTo(cx, cy - s * 0.78); ctx.lineTo(cx + s * 0.85, cy + s * 0.72); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(cx, cy + s * 0.72); ctx.lineTo(cx, cy + s * 0.05); ctx.strokeStyle = COLOR.outline; ctx.lineWidth = Math.max(2, s * 0.28); ctx.stroke(); break
    case 'sell':
      draw3DCoin(ctx, cx, cy, s * 0.88); break
    case 'retreat':
      ctx.moveTo(cx + s * 0.7, cy); ctx.lineTo(cx - s * 0.6, cy); ctx.moveTo(cx - s * 0.1, cy - s * 0.5); ctx.lineTo(cx - s * 0.65, cy); ctx.lineTo(cx - s * 0.1, cy + s * 0.5); ctx.stroke(); break
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Tactile 3D Game Buttons
// ---------------------------------------------------------------------------

export interface ButtonOpts {
  variant?: ButtonVariant
  size?: number
  icon?: IconName
  sub?: string
  r?: number
  align?: 'center' | 'left'
  trailing?: string
}

/** Chunky 3D-extruded game button with thick dark ink border, top gloss, and physical press depression. */
export function drawButton(ctx: CanvasRenderingContext2D, rect: LayoutRect, label: string, st: CanvasWidgetDrawState, o: ButtonOpts = {}) {
  const variant = o.variant ?? 'secondary'
  const r = Math.min(o.r ?? RADIUS.md, rect.height / 2)
  const hot = (st.hovered || st.focused) && !st.disabled
  const pressed = st.pressed && !st.disabled
  const lip = variant === 'ghost' ? 2 : pressed ? 1 : 4
  const pressShift = pressed ? 3 : 0
  const { x, width: w, height: h } = rect
  const y = rect.y + pressShift
  const drawH = Math.max(8, h - pressShift)

  ctx.save()
  if (st.disabled) ctx.globalAlpha *= 0.48

  let hi = '#576fa8'
  let lo = '#394b78'
  let lipCol = '#1e2947'
  let textColor: string = COLOR.text
  let strokeText: boolean | string = COLOR.outline

  if (variant === 'primary') {
    hi = hot ? '#fff09c' : COLOR.accentHi
    lo = hot ? '#ffaa1d' : COLOR.accentLo
    lipCol = COLOR.accentLip
    textColor = COLOR.accentText
    strokeText = false
  } else if (variant === 'success') {
    hi = hot ? '#85ffbd' : COLOR.good
    lo = hot ? '#26cc70' : COLOR.goodLo
    lipCol = COLOR.goodLip
    textColor = '#ffffff'
    strokeText = '#07381c'
  } else if (variant === 'danger') {
    hi = hot ? '#ff8c98' : COLOR.danger
    lo = hot ? '#e03449' : COLOR.dangerLo
    lipCol = COLOR.dangerLip
    textColor = '#ffffff'
    strokeText = '#4d0a13'
  } else if (variant === 'ghost') {
    hi = hot || st.selected ? '#4a5f91' : '#2d3b5e'
    lo = hot || st.selected ? '#35456e' : '#202b47'
    lipCol = '#12182b'
    textColor = hot || st.selected ? '#ffffff' : COLOR.muted
    strokeText = false
  } else if (st.selected) {
    hi = '#58bfff'
    lo = '#2678d9'
    lipCol = '#144485'
    textColor = '#ffffff'
    strokeText = '#0c264d'
  } else if (hot) {
    hi = '#6681bd'
    lo = '#465c91'
  }

  // Drop shadow under button
  if (!pressed && !st.disabled) {
    ctx.save()
    ctx.shadowColor = variant === 'primary' && hot ? '#ffc83b88' : '#05081499'
    ctx.shadowBlur = variant === 'primary' && hot ? 14 : 8
    ctx.shadowOffsetY = 3
    rr(ctx, x, y, w, drawH, r)
    ctx.fillStyle = COLOR.outline
    ctx.fill()
    ctx.restore()
  }

  // Extruded lower lip
  rr(ctx, x, y, w, drawH, r)
  ctx.fillStyle = lipCol
  ctx.fill()

  // Main glossy face
  const faceH = Math.max(4, drawH - lip)
  rr(ctx, x + 1, y + 1, w - 2, faceH - 1, Math.max(2, r - 1))
  const g = ctx.createLinearGradient(0, y, 0, y + faceH)
  g.addColorStop(0, hi)
  g.addColorStop(1, lo)
  ctx.fillStyle = g
  ctx.fill()

  // Top candy gloss curve
  rr(ctx, x + 3, y + 2.5, w - 6, Math.max(3, faceH * 0.42), Math.max(2, r - 2))
  ctx.fillStyle = variant === 'primary' ? '#ffffff58' : '#ffffff2c'
  ctx.fill()

  // Crisp dark ink outer border
  rr(ctx, x + 1, y + 1, w - 2, drawH - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.2
  ctx.stroke()

  const size = o.size ?? Math.max(11, Math.min(15, Math.round(faceH * 0.38)))
  const iconSize = Math.round(size * 1.15)
  const hasSub = Boolean(o.sub) && faceH >= 34
  const centerY = y + faceH / 2
  const labelY = hasSub ? centerY - size * 0.44 : centerY + 0.5
  const textW = measureText(ctx, label, size, 850, true)
  const gap = o.icon && label ? 7 : 0
  const contentW = Math.min(w - 18, textW + (o.icon ? iconSize + gap : 0))
  let cx = o.align === 'left' ? x + 14 : x + (w - contentW) / 2
  if (o.icon) {
    drawIcon(ctx, o.icon, cx + iconSize / 2, hasSub ? centerY : labelY, iconSize, textColor)
    cx += iconSize + gap
  }
  if (label) {
    drawText(ctx, label, cx, labelY, {
      size,
      weight: 900,
      color: textColor,
      maxW: Math.max(8, x + w - 10 - cx),
      display: true,
      stroke: strokeText,
      strokeWidth: 2.6
    })
  }
  if (hasSub && o.sub) {
    drawText(ctx, o.sub, cx, centerY + size * 0.62, {
      size: Math.max(9.5, size - 2.5),
      weight: 800,
      color: variant === 'danger' ? '#ffe0e4' : textColor,
      maxW: Math.max(8, x + w - 10 - cx),
      display: true
    })
  }
  if (o.trailing) {
    drawText(ctx, o.trailing, x + w - 12, centerY + 0.5, { size: size - 1, weight: 800, color: textColor, align: 'right', display: true })
  }
  ctx.restore()
  if (st.focused && !st.disabled) drawFocusRing(ctx, x, y, w, drawH, r)
}

/** Chunky tactile square/pill icon button (toolbar). */
export function drawIconButton(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  icon: IconName | null,
  st: CanvasWidgetDrawState,
  o: { active?: boolean; label?: string; color?: string } = {}
) {
  const { x, width: w, height: h } = rect
  const pressed = st.pressed && !st.disabled
  const hot = (st.hovered || st.focused) && !st.disabled
  const y = rect.y + (pressed ? 2 : 0)
  const drawH = Math.max(8, h - (pressed ? 2 : 0))
  const r = Math.min(RADIUS.sm + 2, drawH / 2)
  const lip = pressed ? 1 : 3

  ctx.save()
  if (st.disabled) ctx.globalAlpha *= 0.45

  // Base lip
  rr(ctx, x, y, w, drawH, r)
  ctx.fillStyle = o.active ? COLOR.accentLip : '#141c33'
  ctx.fill()

  // Face
  const faceH = Math.max(4, drawH - lip)
  rr(ctx, x + 1, y + 1, w - 2, faceH - 1, Math.max(2, r - 1))
  const g = ctx.createLinearGradient(0, y, 0, y + faceH)
  if (o.active) {
    g.addColorStop(0, hot ? '#fff09c' : COLOR.accentHi)
    g.addColorStop(1, COLOR.accentLo)
  } else {
    g.addColorStop(0, hot ? '#647db8' : '#4a5f91')
    g.addColorStop(1, hot ? '#44598c' : '#314169')
  }
  ctx.fillStyle = g
  ctx.fill()

  // Top gloss
  rr(ctx, x + 3, y + 2, w - 6, Math.max(2, faceH * 0.4), Math.max(1, r - 2))
  ctx.fillStyle = '#ffffff33'
  ctx.fill()

  // Dark ink outline
  rr(ctx, x + 1, y + 1, w - 2, drawH - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()

  const color = o.color ?? (o.active ? COLOR.accentText : '#ffffff')
  const cy = y + faceH / 2
  if (icon && o.label) {
    const iw = faceH * 0.46
    const tw = measureText(ctx, o.label, 11, 900, true)
    const start = x + (w - iw - 4 - tw) / 2
    drawIcon(ctx, icon, start + iw / 2, cy, iw, color)
    drawText(ctx, o.label, start + iw + 4, cy + 0.5, { size: 11, weight: 900, color, display: true, stroke: !o.active })
  } else if (icon) {
    drawIcon(ctx, icon, x + w / 2, cy, Math.min(w, faceH) * 0.5, color)
  } else if (o.label) {
    drawText(ctx, o.label, x + w / 2, cy + 0.5, { size: 11, weight: 900, color, align: 'center', maxW: w - 8, display: true })
  }
  ctx.restore()
  if (st.focused && !st.disabled) drawFocusRing(ctx, x, y, w, drawH, r)
}

/** Popped-out 3D game tab button (replaces flat web segmented control). */
export function drawTab(ctx: CanvasRenderingContext2D, rect: LayoutRect, label: string, st: CanvasWidgetDrawState, o: { icon?: IconName; count?: string } = {}) {
  const { x, width: w, height: h } = rect
  const y = rect.y + (st.pressed && !st.selected ? 1 : 0)
  const r = RADIUS.sm + 1
  const hot = st.hovered || st.focused
  ctx.save()

  if (st.selected) {
    // Active raised tactile gold-accented blue-steel game tab
    rr(ctx, x, y, w, h, r)
    ctx.fillStyle = COLOR.accentLip
    ctx.fill()
    rr(ctx, x + 1, y + 1, w - 2, h - 4, Math.max(2, r - 1))
    const g = ctx.createLinearGradient(0, y, 0, y + h - 3)
    g.addColorStop(0, COLOR.accentHi)
    g.addColorStop(1, COLOR.accentLo)
    ctx.fillStyle = g
    ctx.fill()
    rr(ctx, x + 3, y + 2, w - 6, Math.max(3, (h - 4) * 0.4), Math.max(1, r - 2))
    ctx.fillStyle = '#ffffff50'
    ctx.fill()
    rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1))
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 2
    ctx.stroke()
  } else {
    rr(ctx, x + 1, y + 2, w - 2, h - 3, r)
    ctx.fillStyle = hot ? '#3a4c78' : '#243152'
    ctx.fill()
    rr(ctx, x + 1, y + 2, w - 2, h - 3, r)
    ctx.strokeStyle = hot ? '#6b85bd' : '#101628'
    ctx.lineWidth = 1.6
    ctx.stroke()
  }

  const cy = y + (st.selected ? (h - 3) / 2 : h / 2 + 1)
  const textColor = st.selected ? COLOR.accentText : hot ? '#ffffff' : COLOR.muted
  const size = h < 30 ? 11.5 : 13
  const countW = o.count ? measureText(ctx, o.count, 10, 900, true) + 14 : 0
  const iconW = o.icon ? 19 : 0
  const availTextW = Math.max(24, w - 16 - iconW - (countW ? countW + 6 : 0))
  const textW = Math.min(measureText(ctx, label, size, 900, true), availTextW)
  let cx = x + (w - (iconW + textW + (countW ? countW + 6 : 0))) / 2
  if (o.icon) {
    drawIcon(ctx, o.icon, cx + 7, cy, 14, st.selected ? COLOR.accentText : hot ? COLOR.accentHi : COLOR.muted)
    cx += iconW
  }
  drawText(ctx, label, cx, cy + 0.5, { size, weight: 900, color: textColor, maxW: availTextW, display: true })
  if (o.count) {
    const bx = cx + textW + 6
    rr(ctx, bx, cy - 8.5, countW, 17, 8.5)
    ctx.fillStyle = st.selected ? '#2b160030' : COLOR.wellDeep
    ctx.fill()
    ctx.strokeStyle = st.selected ? '#2b160055' : COLOR.outline
    ctx.lineWidth = 1.4
    ctx.stroke()
    drawText(ctx, o.count, bx + countW / 2, cy + 0.5, {
      size: 10,
      weight: 900,
      color: st.selected ? COLOR.accentText : COLOR.accentHi,
      align: 'center',
      display: true
    })
  }
  ctx.restore()
  if (st.focused) drawFocusRing(ctx, x, y, w, h, r)
}

export function drawSegmentTrack(ctx: CanvasRenderingContext2D, rect: LayoutRect) {
  const r = RADIUS.md
  rr(ctx, rect.x, rect.y, rect.width, rect.height, r)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()
  rr(ctx, rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
}

// ===========================================================================
// Game Panels, Carved Wells, Modals, & Console Trays
// ===========================================================================

export function drawPanel(ctx: CanvasRenderingContext2D, rect: LayoutRect, o: SurfaceOpts = {}) {
  drawSurface(ctx, rect, o)
}

/** Carved recessed inner socket well (deep game relief inside a steel plate). */
export function drawWell(ctx: CanvasRenderingContext2D, rect: LayoutRect, r: number = RADIUS.md) {
  const { x, y, width: w, height: h } = rect
  ctx.save()
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = COLOR.well
  ctx.fill()
  // Inner top shadow for recessed depth
  ctx.save()
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1))
  ctx.clip()
  const sh = ctx.createLinearGradient(0, y, 0, y + 12)
  sh.addColorStop(0, '#050814aa')
  sh.addColorStop(1, '#05081400')
  ctx.fillStyle = sh
  ctx.fillRect(x, y, w, 12)
  ctx.restore()
  // Bottom inner catch-light
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1))
  ctx.strokeStyle = '#3f528066'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // Dark outer seam
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r)
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

/** Chunky beveled game dialog frame with gold/crimson crest trim & corner rivets. */
export function drawModal(ctx: CanvasRenderingContext2D, rect: LayoutRect, accent: string = COLOR.accent) {
  drawSurface(ctx, rect, { r: RADIUS.xl, lipH: 6 })
  const { x, y, width: w, height: h } = rect
  ctx.save()
  // Decorative top header accent bar (like Image 3's yellow-orange brackets)
  const capW = Math.min(w * 0.44, 140)
  const cx = x + (w - capW) / 2
  rr(ctx, cx, y - 4, capW, 10, 5)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.2
  ctx.stroke()
  // Side hardware studs
  for (const sx of [x + 12, x + w - 12]) {
    for (const sy of [y + 12, y + h - 16]) {
      ctx.beginPath()
      ctx.arc(sx, sy, 3.2, 0, Math.PI * 2)
      ctx.fillStyle = '#5e75ab'
      ctx.fill()
      ctx.strokeStyle = COLOR.outline
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Chunky tactical war-console bottom sheet with steel top trim & golden corner brackets. */
export function drawSheet(ctx: CanvasRenderingContext2D, rect: LayoutRect) {
  drawSurface(ctx, rect, { r: RADIUS.xl, lipH: 5 })
  const { x, y, width: w } = rect
  ctx.save()
  // Center metallic crest tab perched cleanly on the top edge
  const tabW = 68
  rr(ctx, x + (w - tabW) / 2, y - 4, tabW, 10, 5)
  const g = ctx.createLinearGradient(0, y - 4, 0, y + 6)
  g.addColorStop(0, COLOR.accentHi)
  g.addColorStop(1, COLOR.accentLo)
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
  // Left/right cyan tech/arcane accent notches along top edge
  for (const nx of [x + 26, x + w - 50]) {
    rr(ctx, nx, y - 2, 24, 5, 2.5)
    ctx.fillStyle = COLOR.ally
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.6
    ctx.stroke()
  }
  ctx.restore()
}

/** Top-of-screen readability gradient. */
export function drawTopFade(ctx: CanvasRenderingContext2D, rect: LayoutRect, strength = 0.55) {
  const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height)
  g.addColorStop(0, `rgba(9, 13, 26, ${strength})`)
  g.addColorStop(1, 'rgba(9, 13, 26, 0)')
  ctx.fillStyle = g
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
}

export function drawBottomFade(ctx: CanvasRenderingContext2D, rect: LayoutRect, strength = 0.6) {
  const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height)
  g.addColorStop(0, 'rgba(9, 13, 26, 0)')
  g.addColorStop(1, `rgba(9, 13, 26, ${strength})`)
  ctx.fillStyle = g
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
}

export function drawLabel(ctx: CanvasRenderingContext2D, rect: LayoutRect, text: string, o: TextOpts & { wrap?: boolean; lineHeight?: number } = {}) {
  if (o.wrap) {
    drawParagraph(ctx, text, rect.x, rect.y, rect.width, rect.height, { ...o, valign: 'middle' })
    return
  }
  const align = o.align ?? 'left'
  const x = align === 'center' ? rect.x + rect.width / 2 : align === 'right' ? rect.x + rect.width : rect.x
  drawText(ctx, text, x, rect.y + rect.height / 2 + 0.5, { ...o, maxW: rect.width })
}

export function drawToast(ctx: CanvasRenderingContext2D, rect: LayoutRect, text: string) {
  ctx.font = font(TYPE.label, 800, true)
  const w = Math.min(rect.width, ctx.measureText(text).width + 48)
  const x = rect.x + (rect.width - w) / 2
  drawSurface(ctx, { x, y: rect.y, width: w, height: rect.height }, {
    r: rect.height / 2,
    fill: '#2e406b',
    fillBot: '#1d2947',
    lipH: 3
  })
  // Green check badge circle
  ctx.beginPath()
  ctx.arc(x + 17, rect.y + (rect.height - 3) / 2, 8.5, 0, Math.PI * 2)
  ctx.fillStyle = COLOR.good
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.8
  ctx.stroke()
  drawIcon(ctx, 'check', x + 17, rect.y + (rect.height - 3) / 2, 10, '#07331a')
  drawText(ctx, text, x + 31, rect.y + (rect.height - 3) / 2 + 0.5, {
    size: TYPE.label,
    weight: 800,
    maxW: w - 42,
    display: true,
    stroke: true,
    strokeWidth: 2.2
  })
}

// ===========================================================================
// Title Screen Logo & Plaque
// ===========================================================================

function drawShardMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  ctx.save()
  ctx.shadowColor = '#05081499'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  // Chunky dark-outlined 3D crown silhouette
  ctx.beginPath()
  ctx.moveTo(cx - s, cy + s * 0.48)
  ctx.lineTo(cx - s * 1.06, cy - s * 0.36)
  ctx.lineTo(cx - s * 0.46, cy + s * 0.04)
  ctx.lineTo(cx, cy - s * 0.84)
  ctx.lineTo(cx + s * 0.46, cy + s * 0.04)
  ctx.lineTo(cx + s * 1.06, cy - s * 0.36)
  ctx.lineTo(cx + s, cy + s * 0.48)
  ctx.closePath()
  const g = ctx.createLinearGradient(0, cy - s, 0, cy + s * 0.5)
  g.addColorStop(0, '#fff4b8')
  g.addColorStop(0.55, COLOR.accent)
  g.addColorStop(1, COLOR.accentLo)
  ctx.fillStyle = g
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.lineWidth = 2.6
  ctx.lineJoin = 'round'
  ctx.strokeStyle = COLOR.outline
  ctx.stroke()
  // Glowing cyan crystal shard in center
  drawFacetedGem(ctx, cx, cy + s * 0.02, s * 0.36, '#9ef0ff', '#188ae0')
  ctx.restore()
}

export function drawTitleLogo(ctx: CanvasRenderingContext2D, rect: LayoutRect) {
  const { x, y, width: w, height: h } = rect
  const cx = x + w / 2

  const markS = Math.min(24, h * 0.19)
  drawShardMark(ctx, cx, y + markS + 4, markS)

  const size = Math.min(62, w / 6.6, h * 0.44)
  const wy = y + markS * 2 + 12 + size * 0.46
  ctx.save()
  ctx.font = font(size, 900, true)
  setSpacing(ctx, size * 0.04)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2

  // 3D extruded dark-bronze depth layer
  ctx.lineWidth = Math.max(7, size * 0.16)
  ctx.strokeStyle = COLOR.outline
  ctx.strokeText('CROWNSHARD', cx, wy + 5)
  ctx.fillStyle = COLOR.accentLip
  ctx.fillText('CROWNSHARD', cx, wy + 4)

  // Primary bold ink outline + gold-cream vertical gradient
  ctx.lineWidth = Math.max(6, size * 0.14)
  ctx.strokeStyle = COLOR.outline
  ctx.strokeText('CROWNSHARD', cx, wy)
  const g = ctx.createLinearGradient(0, wy - size * 0.48, 0, wy + size * 0.48)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.45, '#fff0b3')
  g.addColorStop(1, '#f5a11b')
  ctx.fillStyle = g
  ctx.fillText('CROWNSHARD', cx, wy)
  setSpacing(ctx, 0)
  ctx.restore()

  // Stylized angled game subtitle ribbon plaque
  const sub = 'TACTICS  •  CARDS  •  HEROES'
  const subSize = Math.max(10, Math.round(size * 0.2))
  const rw = Math.min(w - 20, measureText(ctx, sub, subSize, 900, true) + 46)
  const rh = 22
  const ry = wy + size * 0.56
  drawSurface(ctx, { x: cx - rw / 2, y: ry, width: rw, height: rh }, {
    r: rh / 2,
    fill: '#2c3c66',
    fillBot: '#1b2645',
    lipH: 2,
    shadow: true
  })
  drawText(ctx, sub, cx, ry + rh / 2, {
    size: subSize,
    weight: 900,
    color: COLOR.accentHi,
    align: 'center',
    spacing: 2,
    display: true,
    stroke: true,
    strokeWidth: 2.2
  })
}

export function drawTitleCard(ctx: CanvasRenderingContext2D, rect: LayoutRect) {
  drawSheet(ctx, rect)
}

/** Row of tactile keycap + label hints. */
export function drawControlHints(ctx: CanvasRenderingContext2D, rect: LayoutRect, items: readonly (readonly [string, string])[]) {
  const size = 18
  const parts = items.map(([k, label]) => ({ k, label, w: Math.max(size, measureText(ctx, k, 10, 900, true) + 10) + 6 + measureText(ctx, label, 11, 700) }))
  const gap = 14
  let shown = parts
  while (shown.length > 1 && shown.reduce((s, p) => s + p.w, 0) + gap * (shown.length - 1) > rect.width) shown = shown.slice(0, -1)
  const total = shown.reduce((s, p) => s + p.w, 0) + gap * (shown.length - 1)
  let cx = rect.x + (rect.width - total) / 2
  const cy = rect.y + rect.height / 2
  for (const p of shown) {
    const kw = drawKeycap(ctx, cx, cy - size / 2, p.k, size)
    drawText(ctx, p.label, cx + kw + 6, cy + 0.5, { size: 11, weight: 700, color: COLOR.muted, shadow: true })
    cx += p.w + gap
  }
}

// ===========================================================================
// Story Briefing (Cinematic Letterbox + Stylized Dialogue Frame)
// ===========================================================================

export function drawLetterbox(ctx: CanvasRenderingContext2D, rect: LayoutRect, topH: number, bottomH: number) {
  const { x, y, width: w, height: h } = rect
  ctx.fillStyle = 'rgba(7, 10, 20, 0.16)'
  ctx.fillRect(x, y, w, h)
  const t = ctx.createLinearGradient(0, y, 0, y + topH)
  t.addColorStop(0, 'rgba(9, 13, 26, 0.94)')
  t.addColorStop(0.72, 'rgba(9, 13, 26, 0.78)')
  t.addColorStop(1, 'rgba(9, 13, 26, 0)')
  ctx.fillStyle = t
  ctx.fillRect(x, y, w, topH)
  const by = y + h - bottomH
  const b = ctx.createLinearGradient(0, by, 0, y + h)
  b.addColorStop(0, 'rgba(9, 13, 26, 0)')
  b.addColorStop(Math.min(0.32, 60 / Math.max(1, bottomH)), 'rgba(9, 13, 26, 0.80)')
  b.addColorStop(1, 'rgba(9, 13, 26, 0.96)')
  ctx.fillStyle = b
  ctx.fillRect(x, by, w, bottomH)
}

export function drawStoryHeading(ctx: CanvasRenderingContext2D, rect: LayoutRect, kicker: string, title: string) {
  const cx = rect.x + rect.width / 2
  const size = Math.min(TYPE.h2 + 4, Math.max(18, rect.width / 20))
  // Subtitle ribbon badge
  drawChip(ctx, cx, rect.y + 1, kicker.toUpperCase(), {
    h: 19,
    size: 10,
    color: COLOR.accentHi,
    bg: '#243154',
    border: COLOR.outline,
    align: 'center'
  })
  drawText(ctx, title, cx, rect.y + 24 + size * 0.62, {
    size,
    weight: 900,
    align: 'center',
    display: true,
    maxW: rect.width,
    stroke: true,
    strokeWidth: 4
  })
}

export function drawSpeakerPortrait(ctx: CanvasRenderingContext2D, rect: LayoutRect, portrait: CanvasImageSource | undefined) {
  const s = Math.min(rect.width, rect.height)
  const x = rect.x + (rect.width - s) / 2
  const y = rect.y + (rect.height - s) / 2
  drawPortraitTile(ctx, x, y, s, portrait, { ring: COLOR.accent, ringW: 3, r: s * 0.2, bg: '#486094' })
}

export function drawLootRow(ctx: CanvasRenderingContext2D, rect: LayoutRect, items: readonly { icon: IconName; text: string; color?: string }[], align: 'left' | 'center' = 'left') {
  const h = Math.min(26, rect.height)
  const y = rect.y + (rect.height - h) / 2
  const labelW = measureText(ctx, 'SPOILS', TYPE.micro, 900, true) + 16
  const widths = items.map(it => measureText(ctx, it.text, Math.round(h * 0.46), 800, true) + h * 0.65 + 4 + h * 0.78)
  const total = labelW + widths.reduce((s, v) => s + v + 6, 0)
  let x = align === 'center' ? rect.x + Math.max(0, (rect.width - total) / 2) : rect.x
  drawOverline(ctx, 'Spoils', x, y + h / 2 + 0.5)
  x += labelW
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (x + Math.min(widths[i], 60) > rect.x + rect.width) break
    const w = drawChip(ctx, x, y, fitWithin(ctx, it.text, rect.x + rect.width - x - h * 1.4, Math.round(h * 0.46)), {
      icon: it.icon,
      h,
      color: it.color ?? COLOR.text,
      bg: '#1c2642',
      border: COLOR.outline
    })
    x += w + 6
  }
}

function fitWithin(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number) {
  ctx.font = font(size, 800, true)
  return fitText(ctx, text, maxW)
}

// ===========================================================================
// Battle HUD (Chunky Game Plates, Segmented HP, Angled Unit Frame, Cards)
// ===========================================================================

export function drawBattleInfo(ctx: CanvasRenderingContext2D, rect: LayoutRect, chapter: string, gold: number) {
  drawSurface(ctx, rect, { r: RADIUS.lg, lipH: 4 })
  const { x, y, width: w, height: h } = rect
  const cy = y + (h - 4) / 2
  // Gold flag badge on left
  ctx.beginPath()
  ctx.arc(x + 19, cy, 11, 0, Math.PI * 2)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.8
  ctx.stroke()
  drawIcon(ctx, 'flag', x + 19, cy, 12, COLOR.accentHi)

  const goldStr = `${gold}`
  const coinBadgeW = Math.round(measureText(ctx, goldStr, 12.5, 800, true) + 38)
  drawText(ctx, chapter, x + 36, cy + 0.5, {
    size: 13,
    weight: 900,
    maxW: w - 42 - coinBadgeW,
    display: true,
    stroke: true,
    strokeWidth: 2.2
  })
  drawCurrencyBadge(ctx, x + w - coinBadgeW - 8, cy, goldStr, 'coin', 24)
}

export function drawToolbarBg(ctx: CanvasRenderingContext2D, rect: LayoutRect) {
  drawSurface(ctx, rect, { r: RADIUS.lg, lipH: 4 })
}

export function drawTimelineBg(ctx: CanvasRenderingContext2D, rect: LayoutRect) {
  drawSurface(ctx, rect, { r: RADIUS.lg, lipH: 4, fill: '#2c3a61', fillBot: '#1b2540' })
}

export function drawTurnToken(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  entry: TurnPreviewEntry,
  portrait: CanvasImageSource | undefined,
  st: CanvasWidgetDrawState
) {
  const team = entry.team === 'ally' ? COLOR.ally : COLOR.enemy
  const current = entry.isCurrent
  const lift = st.pressed ? 1 : st.hovered ? -2 : 0
  const labelH = 15
  const s = Math.min(rect.width - 2, rect.height - labelH + (current ? 1 : 2))
  const x = rect.x + (rect.width - s) / 2
  const y = rect.y + lift

  ctx.save()
  if (current) {
    ctx.save()
    ctx.shadowColor = COLOR.glow
    ctx.shadowBlur = 12
    rr(ctx, x - 1, y - 1, s + 2, s + 2, s * 0.24)
    ctx.fillStyle = COLOR.accent
    ctx.fill()
    ctx.restore()
  }

  drawPortraitTile(ctx, x, y, s, portrait, {
    ring: current ? COLOR.accentHi : st.hovered ? '#ffffff' : team,
    ringW: current ? 3 : 2.2,
    r: s * 0.22,
    bg: entry.team === 'ally' ? '#365f99' : '#7a3040'
  })

  // Bottom plaque: golden NOW ribbon or dark-outlined speed badge
  if (current) {
    const pw = Math.min(rect.width, 38)
    const py = y + s - 4
    rr(ctx, rect.x + (rect.width - pw) / 2, py, pw, 15, 7)
    const g = ctx.createLinearGradient(0, py, 0, py + 15)
    g.addColorStop(0, COLOR.accentHi)
    g.addColorStop(1, COLOR.accentLo)
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.8
    ctx.stroke()
    drawText(ctx, 'NOW', rect.x + rect.width / 2, py + 8, {
      size: 9,
      weight: 900,
      color: COLOR.accentText,
      align: 'center',
      display: true
    })
  } else {
    const pw = 34
    const py = y + s - 2
    rr(ctx, rect.x + (rect.width - pw) / 2, py, pw, 14, 7)
    ctx.fillStyle = COLOR.wellDeep
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.5
    ctx.stroke()
    drawIcon(ctx, 'bolt', rect.x + rect.width / 2 - 8, py + 7, 8, COLOR.accent)
    drawText(ctx, `${entry.speed}`, rect.x + rect.width / 2 - 2, py + 7.5, {
      size: 9.5,
      weight: 900,
      color: '#e8f0ff',
      display: true
    })
  }
  ctx.restore()
}

/**
 * Stylized RPG Unit Frame (inspired by classic angled armor-plate HP HUDs):
 * Chunky square portrait housing with glowing side accent tab, overlapping circular
 * Star-Tier badge, dynamic color-shifting segmented HP bar, shield/CT micro-bars,
 * and dark-outlined stat badges.
 */
export function drawUnitCard(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  unit: BattleUnit | undefined,
  portrait: CanvasImageSource | undefined,
  speedValue: number,
  roleLabel: string
) {
  const ally = !unit || unit.team === 'ally'
  const team = ally ? COLOR.ally : COLOR.enemy
  drawSurface(ctx, rect, { r: RADIUS.lg, lipH: 4, fill: '#32426b', fillBot: '#202c4a' })
  if (!unit) return

  const { x, y, width: w, height: h } = rect
  const faceH = h - 4
  const pad = 9
  const compact = faceH < 84

  // Glowing side accent strip on left edge (signature tactical HUD detail!)
  rr(ctx, x - 2, y + 12, 5, Math.min(36, faceH - 24), 2.5)
  ctx.fillStyle = team
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.6
  ctx.stroke()

  const ps = compact ? faceH - pad * 2 : Math.min(48, faceH * 0.42)
  const px = x + pad + 2
  const py = y + pad
  drawPortraitTile(ctx, px, py, ps, portrait, { ring: team, ringW: 2.5, r: 10, bg: ally ? '#38629e' : '#7a3040' })

  // Overlapping circular Star-Tier medallion at bottom-right of portrait
  if (unit.team === 'ally') {
    const br = compact ? 9 : 10
    const bx = px + ps - 3
    const by = py + ps - 3
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fillStyle = team
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(bx, by, br - 2.6, 0, Math.PI * 2)
    ctx.fillStyle = COLOR.wellDeep
    ctx.fill()
    drawText(ctx, `${unit.stars}`, bx, by + 0.5, { size: compact ? 10 : 10.5, weight: 900, color: COLOR.accentHi, align: 'center', display: true })
  }

  const tx = px + ps + 10
  const tw = x + w - pad - tx
  drawText(ctx, unit.name, tx, py + 9, { size: 14, weight: 900, maxW: tw, display: true, stroke: true, strokeWidth: 2.4 })
  drawChip(ctx, tx, py + 20, roleLabel.toUpperCase(), {
    h: 16,
    size: 8.5,
    color: ally ? '#b8e8ff' : '#ffd0d6',
    bg: ally ? '#16355e' : '#541826',
    border: COLOR.outline
  })

  const hpRatio = unit.hp / Math.max(1, unit.maxHp)
  const [hpHi] = hpBarColor(hpRatio, !ally)
  const barX = compact ? tx : x + pad + 2
  const barW = compact ? tw : w - pad * 2 - 2
  const barY = compact ? py + 38 : py + ps + 6
  const barH = compact ? 11 : 11

  // Segmented chunky HP bar!
  drawBar(ctx, barX, barY, barW, barH, hpRatio, hpHi, COLOR.wellDeep, compact ? 8 : 10)
  if (unit.shield > 0) {
    const sr = Math.min(1, unit.shield / Math.max(1, unit.maxHp))
    rr(ctx, barX + 1, barY + barH + 2, Math.max(6, (barW - 2) * sr), 4, 2)
    ctx.fillStyle = COLOR.ap
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  if (compact) {
    drawText(ctx, `${unit.hp}/${unit.maxHp}`, x + w - pad, py + 9, {
      size: 11,
      weight: 900,
      color: COLOR.accentHi,
      align: 'right',
      display: true,
      stroke: true,
      strokeWidth: 2
    })
    return
  }

  // Crisp HP readout + shield
  drawText(ctx, `HP ${unit.hp}/${unit.maxHp}${unit.shield > 0 ? ` +${unit.shield}` : ''}`, barX + 2, barY + barH + 10, {
    size: 10.5,
    weight: 900,
    color: '#e8f0ff',
    maxW: barW - 4,
    display: true,
    shadow: true
  })

  // Chunky outlined stat pills along bottom
  const stats: [IconName, number, string][] = [['sword', unit.atk, '#ffaa54'], ['shield', unit.def, '#69c2ff'], ['bolt', speedValue, '#ffe066']]
  const cw = (barW - 8) / 3
  const cy = y + faceH - pad - 10
  if (cy - 10 < barY + barH + 15) return
  stats.forEach(([icon, val, col], i) => {
    const cx = barX + i * (cw + 4)
    rr(ctx, cx, cy - 10.5, cw, 21, 7)
    ctx.fillStyle = COLOR.wellDeep
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.8
    ctx.stroke()
    drawIcon(ctx, icon, cx + 12, cy, 11, col)
    drawText(ctx, `${val}`, cx + 22, cy + 0.5, { size: 12, weight: 900, maxW: cw - 24, display: true })
  })
}

/** Chunky arcade/tactics skill button with physical press depth, colored tier bar, and keycap badge. */
export function drawSkillTile(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: {
    name: string
    subtitle: string
    keycap: string
    vfx: 'strike' | SkillSpec['vfx']
    skillId: string
    tier?: 1 | 2 | 3
    unlocked: boolean
    cooldown: number
  },
  st: CanvasWidgetDrawState
) {
  const tierColor = TIER_COLOR[o.tier ?? 0]
  const armed = st.selected && !st.disabled
  const pressed = st.pressed && !st.disabled
  const hot = (st.hovered || st.focused) && !st.disabled
  const lip = pressed ? 1 : 4
  const y = rect.y + (pressed ? 3 : 0)
  const drawH = Math.max(10, rect.height - (pressed ? 3 : 0))
  const { x, width: w } = rect
  const r = RADIUS.md

  ctx.save()
  if (armed) {
    ctx.save()
    ctx.shadowColor = tierColor
    ctx.shadowBlur = 16
    rr(ctx, x, y, w, drawH, r)
    ctx.fillStyle = tierColor
    ctx.fill()
    ctx.restore()
  }

  // Extruded lip
  rr(ctx, x, y, w, drawH, r)
  ctx.fillStyle = armed ? COLOR.accentLip : '#141c33'
  ctx.fill()

  // Main face
  const faceH = Math.max(6, drawH - lip)
  rr(ctx, x + 1, y + 1, w - 2, faceH - 1, Math.max(2, r - 1))
  const g = ctx.createLinearGradient(0, y, 0, y + faceH)
  if (armed) {
    g.addColorStop(0, '#465d96')
    g.addColorStop(1, '#263661')
  } else {
    g.addColorStop(0, hot ? '#4c6296' : '#394b75')
    g.addColorStop(1, hot ? '#334570' : '#243254')
  }
  ctx.fillStyle = g
  ctx.fill()

  // Colored top accent bar when armed or unlocked
  if (armed) {
    rr(ctx, x + 2, y + 2, w - 4, faceH - 3, Math.max(2, r - 2))
    ctx.strokeStyle = tierColor
    ctx.lineWidth = 2.6
    ctx.stroke()
  } else {
    rr(ctx, x + 3, y + 2, w - 6, Math.max(3, faceH * 0.34), Math.max(1, r - 2))
    ctx.fillStyle = '#ffffff22'
    ctx.fill()
  }

  // Dark ink outer outline
  rr(ctx, x + 1, y + 1, w - 2, drawH - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.2
  ctx.stroke()

  const dim = !o.unlocked || st.disabled
  const showName = faceH >= 52
  const iconR = Math.min(w * 0.21, (showName ? faceH - 20 : faceH) * 0.29)
  const icx = x + w / 2
  const icy = showName ? y + (faceH - 16) * 0.5 + 1 : y + faceH / 2

  ctx.save()
  if (dim) ctx.globalAlpha *= 0.42
  // Carved dark icon medallion with colored rim
  ctx.beginPath()
  ctx.arc(icx, icy, iconR * 1.38, 0, Math.PI * 2)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()
  ctx.strokeStyle = tierColor
  ctx.lineWidth = 1.8
  ctx.stroke()
  drawSkillIcon(ctx, o.vfx, o.skillId, icx, icy, iconR)
  ctx.restore()

  if (!o.unlocked) {
    drawIcon(ctx, 'lock', icx, icy, iconR * 1.15, '#e0e7fa')
  } else if (o.cooldown > 0) {
    ctx.beginPath()
    ctx.arc(icx, icy, iconR * 1.38, 0, Math.PI * 2)
    ctx.fillStyle = '#090d1ac8'
    ctx.fill()
    drawText(ctx, `${o.cooldown}`, icx, icy + 1, { size: Math.round(iconR * 1.25), weight: 900, align: 'center', display: true, stroke: true })
  }
  if (showName) {
    drawText(ctx, o.name, icx, y + faceH - 8.5, {
      size: w < 78 ? 9.5 : 11,
      weight: 900,
      color: dim ? COLOR.faint : '#ffffff',
      align: 'center',
      maxW: w - 6,
      display: true,
      stroke: !dim,
      strokeWidth: 2
    })
  }
  if (w >= 62) {
    drawKeycap(ctx, x + 5, y + 5, o.keycap, w < 78 ? 13 : 15, dim)
  }
  if (o.tier) {
    if (o.unlocked) {
      ctx.beginPath()
      ctx.arc(x + w - 10, y + 10, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = tierColor
      ctx.fill()
      ctx.strokeStyle = COLOR.outline
      ctx.lineWidth = 1.5
      ctx.stroke()
    } else {
      drawStars(ctx, x + w - 5, y + 11, o.tier, o.tier, 7.5, 'right', '#c8d4f0')
    }
  }
  ctx.restore()
  if (st.focused && !st.disabled) drawFocusRing(ctx, x, y, w, drawH, r)
}

/** Chunky vertical AP crystal gauge with 3D glowing gems. */
export function drawApMeter(ctx: CanvasRenderingContext2D, rect: LayoutRect, ap: number, maxAp: number) {
  const { x, y, width: w, height: h } = rect
  drawSurface(ctx, rect, { r: RADIUS.md, lipH: 4, fill: '#223b66', fillBot: '#152545', rim: '#66d9ff66' })
  const cx = x + w / 2
  const faceH = h - 4
  const big = Math.min(26, w * 0.54)
  drawText(ctx, 'AP', cx, y + 12, { size: 9.5, weight: 900, color: COLOR.ap, align: 'center', spacing: 1.4, display: true, stroke: true, strokeWidth: 2 })
  drawText(ctx, `${ap}`, cx, y + 16 + big * 0.58, { size: big, weight: 900, align: 'center', display: true, stroke: true, strokeWidth: 3.4 })
  const pipR = Math.min(6, (faceH - 40 - big) / (maxAp * 2.5))
  if (pipR >= 2.8) {
    const total = maxAp * pipR * 2.5
    let py = y + faceH - 7 - total + pipR * 1.25
    for (let i = maxAp - 1; i >= 0; i--) {
      drawApCrystal(ctx, cx, py, pipR * 1.25, i < ap)
      py += pipR * 2.5
    }
  } else {
    drawText(ctx, `/ ${maxAp}`, cx, y + faceH - 11, { size: 10, weight: 800, color: COLOR.muted, align: 'center', display: true })
  }
}

/** Faceted 3D AP gem with crisp ink outline. */
export function drawApCrystal(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, filled: boolean, numeral?: string) {
  ctx.save()
  if (filled) {
    drawFacetedGem(ctx, cx, cy, radius, '#6ce6ff', '#1674d6')
  } else {
    ctx.beginPath()
    ctx.moveTo(cx, cy - radius)
    ctx.lineTo(cx + radius * 0.82, cy - radius * 0.28)
    ctx.lineTo(cx + radius * 0.82, cy + radius * 0.32)
    ctx.lineTo(cx, cy + radius)
    ctx.lineTo(cx - radius * 0.82, cy + radius * 0.32)
    ctx.lineTo(cx - radius * 0.82, cy - radius * 0.28)
    ctx.closePath()
    ctx.fillStyle = COLOR.wellDeep
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.8
    ctx.stroke()
  }
  if (numeral !== undefined) {
    drawText(ctx, numeral, cx, cy + 0.5, { size: Math.round(radius * 1.1), weight: 900, color: '#ffffff', align: 'center', display: true, stroke: true })
  }
  ctx.restore()
}

/**
 * Collectible Game Tactic Card:
 * Thick dark-outlined card body, diagonal corner rarity ribbon, full-bleed art window,
 * vibrant solid-colored name plaque, and oversized 3D blue AP cost gem!
 */
export function drawTacticCard(ctx: CanvasRenderingContext2D, rect: LayoutRect, spec: TacticCardSpec, st: CanvasWidgetDrawState) {
  const meta = RARITY_META[spec.rarity]
  const active = (st.hovered || st.selected) && !st.disabled
  const lift = st.disabled ? 0 : st.pressed ? 2 : st.selected ? -10 : st.hovered ? -6 : 0
  const { x, width: w, height: h } = rect
  const y = rect.y + lift
  const r = RADIUS.md

  ctx.save()
  if (st.disabled) ctx.globalAlpha *= 0.52

  // Card drop shadow / golden armed glow
  ctx.save()
  ctx.shadowColor = st.selected && !st.disabled ? COLOR.accent : active ? meta.hex : '#050814aa'
  ctx.shadowBlur = st.selected ? 18 : active ? 14 : 8
  ctx.shadowOffsetY = active ? 7 : 4
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = COLOR.outline
  ctx.fill()
  ctx.restore()

  // Card metallic frame body
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = st.selected && !st.disabled ? COLOR.accent : '#34456e'
  ctx.fill()

  const inset = 3.5
  const showDesc = h >= 116 && w >= 78
  const nameH = 22
  const artH = Math.round(showDesc ? h * 0.46 : h - nameH - inset * 2)

  // Clipped inner card content
  ctx.save()
  rr(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(3, r - 2))
  ctx.clip()
  drawTacticIllustration(ctx, spec.id, x + inset, y + inset, w - inset * 2, artH)
  // Dark text backdrop below illustration
  ctx.fillStyle = '#18213b'
  ctx.fillRect(x + inset, y + inset + artH, w - inset * 2, h - artH)
  ctx.restore()

  // Colored name ribbon plaque across the art-to-text seam
  const bannerY = y + inset + artH - (showDesc ? 9 : 2)
  rr(ctx, x + 5, bannerY, w - 10, 20, 6)
  ctx.fillStyle = st.selected && !st.disabled ? COLOR.accent : meta.hex
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.8
  ctx.stroke()
  drawText(ctx, spec.name, x + w / 2, bannerY + 10.5, {
    size: w < 84 ? 10 : 11,
    weight: 900,
    color: st.selected && !st.disabled ? COLOR.accentText : '#ffffff',
    align: 'center',
    maxW: w - 16,
    display: true,
    stroke: !(st.selected && !st.disabled),
    strokeWidth: 2.2
  })

  if (showDesc) {
    drawParagraph(ctx, spec.desc, x + 8, bannerY + 22, w - 16, y + h - bannerY - 26, {
      size: 10,
      weight: 700,
      color: '#dce6ff',
      align: 'center',
      valign: 'middle',
      lineHeight: 12.5
    })
  }

  // Diagonal corner rarity ribbon (signature Image 3 card touch!)
  drawCornerRibbon(ctx, x, y, w, h, r, meta.hex, 20)

  // Thick dark ink outer border
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.4
  ctx.stroke()

  // Oversized 3D faceted AP cost gem overlapping top-left corner
  drawApCrystal(ctx, x + 12, y + 12, 11.5, !st.disabled, `${spec.cost}`)
  ctx.restore()
  if (st.focused && !st.disabled) drawFocusRing(ctx, x, y, w, h, r)
}

/** Chunky golden Wait / End Turn arcade button (or pulsing crimson Enemy Turn plate). */
export function drawEndTurnButton(ctx: CanvasRenderingContext2D, rect: LayoutRect, o: { isPlayerTurn: boolean; ctBonus: number }, st: CanvasWidgetDrawState) {
  const { x, width: w, height: h } = rect
  const r = RADIUS.lg
  if (!o.isPlayerTurn) {
    drawSurface(ctx, rect, { r, lipH: 4, fill: '#6e2233', fillBot: '#471522', lip: '#2b0b14' })
    const cx = x + w / 2
    const t = (performance.now() / 280) % 3
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.arc(cx - 12 + i * 12, rect.y + h / 2 - 10, 4, 0, Math.PI * 2)
      ctx.fillStyle = Math.floor(t) === i ? '#ff8f9b' : '#2b0b14'
      ctx.fill()
      ctx.strokeStyle = COLOR.outline
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    drawText(ctx, 'Enemy Turn', cx, rect.y + h / 2 + 10, { size: 12, weight: 900, color: '#ffd0d6', align: 'center', maxW: w - 10, display: true, stroke: true })
    return
  }

  const label = o.ctBonus > 0 ? 'Wait' : 'End Turn'
  drawButton(ctx, rect, '', st, { variant: 'primary', r })
  const pressed = st.pressed && !st.disabled
  const y = rect.y + (pressed ? 3 : 0)
  const faceH = h - (pressed ? 4 : 4)
  const cx = x + w / 2
  const tall = faceH >= 80
  if (tall) drawIcon(ctx, 'hourglass', cx, y + faceH * 0.30, 22, COLOR.accentText)
  drawText(ctx, label, cx, tall ? y + faceH * 0.56 : y + faceH / 2 - (o.ctBonus > 0 ? 7 : 0), {
    size: w < 100 ? 15 : 18,
    weight: 900,
    color: COLOR.accentText,
    align: 'center',
    display: true,
    maxW: w - 10
  })
  if (o.ctBonus > 0) {
    const cy = tall ? y + faceH * 0.80 : y + faceH / 2 + 11
    drawChip(ctx, cx, cy - 8.5, `+${o.ctBonus} CT`, { h: 17, size: 10, bg: '#2b160030', border: '#2b160066', color: COLOR.accentText, align: 'center' })
  }
  if (tall) drawKeycap(ctx, x + w - 45, y + 6, 'Space', 15)
}

export function drawHintPill(ctx: CanvasRenderingContext2D, rect: LayoutRect, text: string, accent: string) {
  drawSurface(ctx, rect, { r: rect.height / 2, lipH: 3, fill: '#2a385c', fillBot: '#1b2440' })
  const cy = rect.y + (rect.height - 3) / 2
  ctx.beginPath()
  ctx.arc(rect.x + 15, cy, 5, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.6
  ctx.stroke()
  drawText(ctx, text, rect.x + 28, cy + 0.5, { size: 12, weight: 800, maxW: rect.width - 42, display: true, shadow: true })
}

export function drawEmptyNote(ctx: CanvasRenderingContext2D, rect: LayoutRect, text: string, accent?: string) {
  drawWell(ctx, rect, RADIUS.md)
  drawParagraph(ctx, text, rect.x + 12, rect.y + 6, rect.width - 24, rect.height - 12, {
    size: 12,
    weight: 700,
    color: accent ? '#ffc9cf' : COLOR.muted,
    align: 'center',
    valign: 'middle'
  })
}

// ===========================================================================
// Pre-Attack Combat Forecast Card & Skill Comparison Chips
// ===========================================================================

/**
 * Chunky stylized Tactics Combat Forecast banner ("X -> Y", projected damage/crit range,
 * segmented HP preview with pulsing damage chunk + KO stamp, high ground & status badges).
 */
export function drawCombatForecast(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  fc: CombatForecast,
  o: {
    attackerPortrait?: CanvasImageSource
    targetPortrait?: CanvasImageSource
    compact?: boolean
    locked?: boolean
  } = {}
) {
  const isHeal = fc.targetTeam === 'ally'
  const accent = fc.lethalNormal ? '#ff5768' : isHeal ? COLOR.good : fc.requiresMove ? '#ff9f38' : COLOR.accent
  drawSurface(ctx, rect, {
    r: RADIUS.lg,
    lipH: 4,
    fill: '#2b3961',
    fillBot: '#18223d',
    rim: accent + 'aa'
  })

  const { x, y, width: w } = rect
  const pad = o.compact ? 8 : 10
  const ps = o.compact ? 30 : 34
  const topY = y + pad

  // Left: Attacker portrait
  drawPortraitTile(ctx, x + pad, topY, ps, o.attackerPortrait, {
    ring: COLOR.ally,
    ringW: 2.2,
    r: 8,
    bg: '#365f99'
  })

  // Right: Target portrait
  drawPortraitTile(ctx, x + w - pad - ps, topY, ps, o.targetPortrait, {
    ring: isHeal ? COLOR.good : COLOR.enemy,
    ringW: 2.2,
    r: 8,
    bg: isHeal ? '#235e46' : '#7a3040'
  })

  // Center header: "Attacker -> Target" + action pill
  const midX = x + pad + ps + 8
  const midW = w - (pad + ps + 8) * 2
  const cx = midX + midW / 2
  const attShort = fc.attackerName.split(' ').pop() ?? fc.attackerName
  const tgtShort = fc.targetName
  drawText(ctx, `${attShort}  >  ${tgtShort}`, cx, topY + 9, {
    size: o.compact ? 11.5 : 12.5,
    weight: 900,
    color: '#ffffff',
    align: 'center',
    maxW: midW,
    display: true,
    stroke: true,
    strokeWidth: 2.2
  })

  // Action + tactical modifier chips
  const tags: { text: string; bg: string; color: string }[] = [
    {
      text: fc.actionName.toUpperCase(),
      bg: fc.mode === 'strike' ? '#3d4f80' : fc.mode === 'tactic' ? '#633487' : '#1b558a',
      color: '#ffffff'
    }
  ]
  if (fc.requiresMove) tags.push({ text: 'MOVE+HIT', bg: '#7d4408', color: '#ffd98a' })
  if (fc.highGround) tags.push({ text: 'HIGH +20%', bg: '#6e5208', color: COLOR.accentHi })
  if (fc.empowered) tags.push({ text: 'BUFF +35%', bg: '#6e5208', color: COLOR.accentHi })
  if (fc.aoeTargets > 1) tags.push({ text: `AOE x${fc.aoeTargets}`, bg: '#6e2336', color: '#ffd0d6' })
  if (fc.status) tags.push({ text: fc.status.toUpperCase(), bg: '#452463', color: '#e6c2ff' })

  const chipH = 15
  const chipY = topY + 19
  let tagTotal = 0
  const measured = tags.map(t => {
    const cw = Math.round(measureText(ctx, t.text, 8.5, 900, true) + 12)
    return { ...t, cw }
  })
  const visibleTags: typeof measured = []
  for (const t of measured) {
    const nextW = tagTotal + (visibleTags.length > 0 ? 4 : 0) + t.cw
    if (nextW <= midW + 6) {
      visibleTags.push(t)
      tagTotal = nextW
    }
  }
  let tx = cx - tagTotal / 2
  for (const t of visibleTags) {
    drawChip(ctx, tx, chipY, t.text, { h: chipH, size: 8.5, color: t.color, bg: t.bg, border: COLOR.outline })
    tx += t.cw + 4
  }

  // Divider well for damage readout + projected HP bar
  const wellY = topY + ps + 6
  const wellH = o.compact ? 42 : 46
  drawWell(ctx, { x: x + pad, y: wellY, width: w - pad * 2, height: wellH }, RADIUS.sm)

  const innerX = x + pad + 8
  const innerW = w - pad * 2 - 16

  if (isHeal) {
    const parts: string[] = []
    if (fc.healAmount > 0) parts.push(`+${fc.healAmount} HP`)
    if (fc.shieldAmount > 0) parts.push(`+${fc.shieldAmount} SHD`)
    drawText(ctx, parts.join('  ') || 'SUPPORT', innerX, wellY + 14, {
      size: o.compact ? 14 : 16,
      weight: 900,
      color: COLOR.good,
      maxW: innerW * 0.56,
      display: true,
      stroke: true,
      strokeWidth: 2.6
    })
    drawText(ctx, `HP ${fc.targetHpBefore} -> ${fc.targetHpAfterNormal}`, innerX + innerW, wellY + 14, {
      size: 11,
      weight: 900,
      color: '#b8ffda',
      align: 'right',
      maxW: innerW * 0.44,
      display: true
    })
  } else {
    const dmgStr = fc.critChance > 0 && fc.critDmg > fc.normalDmg
      ? `${fc.normalDmg}-${fc.critDmg} DMG`
      : `${fc.normalDmg} DMG`
    drawText(ctx, dmgStr, innerX, wellY + 14, {
      size: o.compact ? 14 : 16.5,
      weight: 900,
      color: fc.lethalNormal ? '#ff7c89' : COLOR.accentHi,
      maxW: innerW * 0.54,
      display: true,
      stroke: true,
      strokeWidth: 2.8
    })

    // Right side of damage row: KO stamp or Crit % / Self-Shield
    const rightX = innerX + innerW
    if (fc.lethalNormal) {
      drawChip(ctx, rightX, wellY + 5, 'KO!', {
        h: 18,
        size: 10,
        color: '#ffffff',
        bg: COLOR.danger,
        border: COLOR.outline,
        align: 'right'
      })
    } else if (fc.lethalCrit) {
      drawChip(ctx, rightX, wellY + 5, `CRIT KO ${Math.round(fc.critChance * 100)}%`, {
        h: 18,
        size: 9,
        color: COLOR.accentText,
        bg: COLOR.accent,
        border: COLOR.outline,
        align: 'right'
      })
    } else if (fc.critChance > 0) {
      drawText(ctx, `CRIT ${Math.round(fc.critChance * 100)}%${fc.selfShield > 0 ? `  +${fc.selfShield} SHD` : ''}`, rightX, wellY + 14, {
        size: 10,
        weight: 800,
        color: COLOR.muted,
        align: 'right',
        maxW: innerW * 0.46,
        display: true
      })
    } else if (fc.selfShield > 0) {
      drawText(ctx, `+${fc.selfShield} SELF SHD`, rightX, wellY + 14, {
        size: 10,
        weight: 800,
        color: COLOR.ap,
        align: 'right',
        maxW: innerW * 0.46,
        display: true
      })
    }
  }

  // Projected Target HP Bar (shows remaining HP + pulsing preview delta!)
  const barY = wellY + wellH - 14
  const barH = 9
  const hpText = isHeal
    ? `${fc.targetHpAfterNormal}/${fc.targetMaxHp}`
    : `${fc.targetHpBefore} -> ${fc.targetHpAfterNormal}${fc.targetShieldBefore > 0 ? ` (SHD ${fc.targetShieldBefore})` : ''}`
  const hpTextW = Math.min(innerW * 0.44, measureText(ctx, hpText, 9.5, 800, true) + 6)
  const barW = Math.max(60, innerW - hpTextW - 6)

  rr(ctx, innerX, barY, barW, barH, 4.5)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()

  const maxHp = Math.max(1, fc.targetMaxHp)
  const beforeRatio = Math.max(0, Math.min(1, fc.targetHpBefore / maxHp))
  const afterRatio = Math.max(0, Math.min(1, fc.targetHpAfterNormal / maxHp))
  const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 160)

  if (isHeal) {
    if (afterRatio > 0) {
      rr(ctx, innerX + 1, barY + 1, Math.max(4, (barW - 2) * afterRatio), barH - 2, 3.5)
      ctx.fillStyle = `rgba(62, 224, 127, ${pulse.toFixed(2)})`
      ctx.fill()
    }
    if (beforeRatio > 0) {
      rr(ctx, innerX + 1, barY + 1, Math.max(4, (barW - 2) * beforeRatio), barH - 2, 3.5)
      ctx.fillStyle = COLOR.goodLo
      ctx.fill()
    }
  } else {
    // Pulsing amber-gold damage loss preview
    if (beforeRatio > 0) {
      rr(ctx, innerX + 1, barY + 1, Math.max(4, (barW - 2) * beforeRatio), barH - 2, 3.5)
      ctx.fillStyle = `rgba(255, 200, 59, ${pulse.toFixed(2)})`
      ctx.fill()
    }
    // Remaining HP after normal hit
    if (afterRatio > 0) {
      rr(ctx, innerX + 1, barY + 1, Math.max(4, (barW - 2) * afterRatio), barH - 2, 3.5)
      ctx.fillStyle = COLOR.enemy
      ctx.fill()
    }
  }
  rr(ctx, innerX, barY, barW, barH, 4.5)
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.6
  ctx.stroke()

  drawText(ctx, hpText, innerX + innerW, barY + barH / 2 + 0.5, {
    size: 9.5,
    weight: 900,
    color: fc.lethalNormal ? '#ff8a96' : '#dce6ff',
    align: 'right',
    maxW: hpTextW,
    display: true
  })
}

/** Clickable Strike vs Skill comparison chip rendered inside the Combat Forecast card. */
export function drawForecastAltChip(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  alt: CombatForecastAlt,
  st: CanvasWidgetDrawState
) {
  const active = alt.active
  const hot = st.hovered || st.focused
  const pressed = st.pressed
  const { x, width: w, height: h } = rect
  const y = rect.y + (pressed ? 1.5 : 0)
  const drawH = h - (pressed ? 1.5 : 0)
  const r = RADIUS.sm

  drawSurface(ctx, { x, y, width: w, height: drawH }, {
    r,
    lipH: pressed ? 1 : 2.5,
    fill: active ? '#4a62a0' : hot ? '#3a4e7d' : '#243154',
    fillBot: active ? '#2b3d6e' : '#18223d',
    rim: active ? COLOR.accentHi : '#ffffff22',
    shadow: false
  })
  if (active) {
    rr(ctx, x + 1.5, y + 1.5, w - 3, drawH - 3, Math.max(2, r - 1))
    ctx.strokeStyle = COLOR.accent
    ctx.lineWidth = 2
    ctx.stroke()
  }

  const faceH = drawH - (pressed ? 1 : 2.5)
  const cy = y + faceH / 2
  drawKeycap(ctx, x + 5, cy - 7.5, alt.keycap, 15)

  const valStr = alt.healAmount > 0
    ? `+${alt.healAmount} HP`
    : alt.lethalNormal
      ? `${alt.normalDmg} KO!`
      : alt.critDmg > alt.normalDmg
        ? `${alt.normalDmg}-${alt.critDmg}`
        : `${alt.normalDmg}`
  const valCol = alt.healAmount > 0 ? COLOR.good : alt.lethalNormal ? '#ff7c89' : COLOR.accentHi
  const valW = Math.min(w * 0.44, measureText(ctx, valStr, 10.5, 900, true) + 6)

  drawText(ctx, alt.name, x + 24, cy + 0.5, {
    size: 10.5,
    weight: 900,
    color: active ? '#ffffff' : '#d2ddf7',
    maxW: Math.max(24, w - 30 - valW),
    display: true,
    shadow: true
  })
  drawText(ctx, valStr, x + w - 6, cy + 0.5, {
    size: 10.5,
    weight: 900,
    color: valCol,
    align: 'right',
    maxW: valW,
    display: true,
    stroke: true,
    strokeWidth: 1.8
  })
}

// ===========================================================================
// Vanguard Camp (Chunky Currency Counters, Character Roster, Armory, Packs)
// ===========================================================================

export function drawCampHeader(ctx: CanvasRenderingContext2D, rect: LayoutRect, gold: number, deckValue: number, compact: boolean) {
  const { x, y, width: w, height: h } = rect
  const cy = y + h / 2
  const title = compact && w < 165 ? 'Camp' : 'Vanguard Camp'

  // Bold emblem disc + dark-outlined title
  ctx.beginPath()
  ctx.arc(x + 16, cy, 13, 0, Math.PI * 2)
  const g = ctx.createLinearGradient(0, cy - 13, 0, cy + 13)
  g.addColorStop(0, COLOR.accentHi)
  g.addColorStop(1, COLOR.accentLo)
  ctx.fillStyle = g
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.2
  ctx.stroke()
  drawIcon(ctx, 'camp', x + 16, cy, 14, COLOR.accentText)

  const tw = drawText(ctx, title, x + 36, cy + 0.5, {
    size: compact ? 16 : 20,
    weight: 900,
    display: true,
    maxW: Math.max(40, w - 40),
    stroke: true,
    strokeWidth: 3.2
  })
  let cx = x + 36 + tw + 14
  if (cx + 76 > x + w) return
  cx += drawCurrencyBadge(ctx, cx, cy, `${gold}`, 'coin', 28) + 10
  if (!compact && cx + 116 < x + w) {
    drawCurrencyBadge(ctx, cx, cy, `${deckValue}g`, 'deck', 28)
  }
}

export function drawChapterPicker(ctx: CanvasRenderingContext2D, rect: LayoutRect, label: string, sub: string) {
  const { x, y, width: w, height: h } = rect
  drawText(ctx, sub, x + w / 2, y + h * 0.28, { size: 9.5, weight: 900, color: COLOR.accentHi, align: 'center', upper: true, spacing: 1, maxW: w, display: true })
  drawText(ctx, label, x + w / 2, y + h * 0.70, { size: 13, weight: 900, align: 'center', maxW: w, display: true, stroke: true, strokeWidth: 2 })
}

export function drawHeroRosterCard(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: { hero: OwnedHeroCard; spec: HeroSpec; portrait?: CanvasImageSource; inSquad: boolean; copies: number; need: number; readyMerge: boolean; token?: boolean },
  st: CanvasWidgetDrawState
) {
  const meta = RARITY_META[o.spec.rarity]
  const { x, width: w, height: h } = rect
  const pressed = st.pressed
  const y = rect.y + (pressed ? 2 : 0)
  const drawH = h - (pressed ? 2 : 0)
  const hot = st.hovered || st.focused
  const r = RADIUS.md

  ctx.save()
  drawSurface(ctx, { x, y, width: w, height: drawH }, {
    r,
    lipH: pressed ? 1 : 3,
    fill: st.selected ? '#4c659e' : hot ? '#3d5180' : '#2d3b61',
    fillBot: st.selected ? '#2e406e' : '#1e2845',
    rim: st.selected ? COLOR.accentHi : '#ffffff24',
    shadow: false
  })
  if (st.selected) {
    rr(ctx, x + 2, y + 2, w - 4, drawH - 4, Math.max(1, r - 2))
    ctx.strokeStyle = COLOR.accent
    ctx.lineWidth = 2.2
    ctx.stroke()
  }

  const faceH = drawH - (pressed ? 1 : 3)
  if (o.token) {
    const ps = Math.min(w - 10, faceH - 18)
    drawPortraitTile(ctx, x + (w - ps) / 2, y + 4, ps, o.portrait, { ring: meta.hex, ringW: 2 })
    drawStars(ctx, x + w / 2, y + faceH - 7, o.hero.stars, 3, 8.5, 'center')
    if (o.inSquad) {
      ctx.beginPath()
      ctx.arc(x + w - 8, y + 8, 5, 0, Math.PI * 2)
      ctx.fillStyle = COLOR.good
      ctx.fill()
      ctx.strokeStyle = COLOR.outline
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
    if (o.readyMerge) {
      ctx.beginPath()
      ctx.arc(x + 8, y + 8, 5, 0, Math.PI * 2)
      ctx.fillStyle = COLOR.accent
      ctx.fill()
      ctx.strokeStyle = COLOR.outline
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
    ctx.restore()
    if (st.focused) drawFocusRing(ctx, x, y, w, drawH, r)
    return
  }

  const ps = faceH - 10
  drawPortraitTile(ctx, x + 6, y + 5, ps, o.portrait, { ring: meta.hex, ringW: 2 })
  const tx = x + ps + 14
  const right = x + w - 10
  const badgeW = o.inSquad ? 48 : 0
  drawText(ctx, o.spec.name, tx, y + faceH * 0.32, { size: 13, weight: 900, maxW: right - tx - badgeW - 4, display: true, stroke: true, strokeWidth: 2 })
  const sw = drawStars(ctx, tx, y + faceH * 0.72, o.hero.stars, 3, 9.5)
  if (o.hero.stars < 3 && o.need > 0) {
    const bx = tx + sw + 7
    const bw = Math.max(0, right - bx - 30)
    if (bw > 16) drawBar(ctx, bx, y + faceH * 0.72 - 3.5, bw, 7, o.copies / o.need, o.readyMerge ? COLOR.accent : COLOR.ally)
    drawText(ctx, `${o.copies}/${o.need}`, right, y + faceH * 0.72 + 0.5, { size: 10, weight: 900, color: o.readyMerge ? COLOR.accentHi : COLOR.muted, align: 'right', display: true })
  } else {
    drawText(ctx, 'MAX', right, y + faceH * 0.72 + 0.5, { size: 10, weight: 900, color: COLOR.accentHi, align: 'right', display: true })
  }
  if (o.inSquad) drawChip(ctx, right, y + faceH * 0.32 - 8.5, 'SQUAD', { h: 17, size: 8.5, color: '#072e17', bg: COLOR.good, border: COLOR.outline, align: 'right' })
  ctx.restore()
  if (st.focused) drawFocusRing(ctx, x, y, w, drawH, r)
}

export function drawHeroHeader(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: { name: string; title: string; stars: number; rarity: Rarity; power: number; portrait?: CanvasImageSource; inSquad: boolean }
) {
  const meta = RARITY_META[o.rarity]
  const { x, y, width: w, height: h } = rect
  const ps = h
  drawPortraitTile(ctx, x, y, ps, o.portrait, { ring: meta.hex, ringW: 2.5, bg: '#3e598c' })
  const tx = x + ps + 12
  const powerW = 86
  drawText(ctx, o.name, tx, y + h * 0.28, { size: 19, weight: 900, maxW: w - ps - 12 - powerW, display: true, stroke: true, strokeWidth: 3 })
  const sw = drawStars(ctx, tx, y + h * 0.74, o.stars, 3, 13)
  let cx = tx + sw + 10
  cx += drawChip(ctx, cx, y + h * 0.74 - 9.5, o.title, { h: 19, size: 10, color: '#ffffff', bg: '#2c3d66', border: COLOR.outline }) + 6
  if (cx + 70 < x + w - powerW) drawChip(ctx, cx, y + h * 0.74 - 9.5, meta.label, { h: 19, size: 10, color: meta.hex, bg: COLOR.wellDeep, border: COLOR.outline })

  // Power crest badge on right
  const pw = 76
  rr(ctx, x + w - pw, y + 2, pw, h - 4, 10)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
  drawText(ctx, 'POWER', x + w - pw / 2, y + h * 0.3, { size: 9, weight: 900, color: COLOR.muted, align: 'center', spacing: 1, display: true })
  drawText(ctx, `${o.power}`, x + w - pw / 2, y + h * 0.68, { size: 19, weight: 900, color: COLOR.accentHi, align: 'center', display: true, stroke: true, strokeWidth: 2.6 })
}

export function drawStatStrip(ctx: CanvasRenderingContext2D, rect: LayoutRect, stats: readonly { icon: IconName; label: string; value: string; color: string }[]) {
  const { x, y, width: w, height: h } = rect
  const gap = 6
  const cw = (w - gap * (stats.length - 1)) / stats.length
  const showLabel = cw >= 58
  stats.forEach((s, i) => {
    const cx = x + i * (cw + gap)
    rr(ctx, cx, y, cw, h, RADIUS.sm)
    ctx.fillStyle = '#1f2b4a'
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.8
    ctx.stroke()
    if (showLabel) {
      drawIcon(ctx, s.icon, cx + 13, y + h / 2, 13, s.color)
      drawText(ctx, s.value, cx + 24, y + h / 2 - (h >= 34 ? 6 : 0) + 0.5, { size: 13, weight: 900, maxW: cw - 28, display: true, shadow: true })
      if (h >= 34) drawText(ctx, s.label, cx + 24, y + h / 2 + 8.5, { size: 8.5, weight: 800, color: COLOR.muted, upper: true, spacing: 0.6, maxW: cw - 28, display: true })
    } else {
      drawIcon(ctx, s.icon, cx + cw / 2, y + h * 0.32, 11, s.color)
      drawText(ctx, s.value, cx + cw / 2, y + h * 0.72, { size: 11, weight: 900, align: 'center', maxW: cw - 4, display: true })
    }
  })
}

export function drawEquipCard(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: { slot: EquipSlot; spec?: EquipmentSpec; ownerText?: string; equippedOnSelected?: boolean },
  st: CanvasWidgetDrawState
) {
  const spec = o.spec
  const meta = spec ? RARITY_META[spec.rarity] : undefined
  const { x, width: w, height: h } = rect
  const pressed = st.pressed
  const y = rect.y + (pressed ? 2 : 0)
  const drawH = h - (pressed ? 2 : 0)
  const hot = st.hovered || st.focused
  const r = RADIUS.md
  const on = st.selected || o.equippedOnSelected

  const narrowSlot = w < 138
  ctx.save()
  if (!spec) {
    drawWell(ctx, { x, y, width: w, height: drawH }, r)
    const slotName = o.slot[0].toUpperCase() + o.slot.slice(1)
    if (narrowSlot) {
      const cy = y + drawH * 0.38
      ctx.beginPath()
      ctx.arc(x + w / 2, cy, 11, 0, Math.PI * 2)
      ctx.fillStyle = hot ? '#364975' : '#1d2742'
      ctx.fill()
      ctx.strokeStyle = COLOR.outline
      ctx.lineWidth = 1.6
      ctx.stroke()
      drawIcon(ctx, 'plus', x + w / 2, cy, 10, hot ? COLOR.accentHi : COLOR.muted)
      drawText(ctx, slotName, x + w / 2, y + drawH - 10, { size: 10, weight: 800, color: COLOR.muted, align: 'center', maxW: w - 8, display: true })
    } else {
      const is = Math.min(drawH - 14, 32)
      ctx.beginPath()
      ctx.arc(x + 8 + is / 2, y + drawH / 2, is / 2, 0, Math.PI * 2)
      ctx.fillStyle = hot ? '#364975' : '#1d2742'
      ctx.fill()
      ctx.strokeStyle = COLOR.outline
      ctx.lineWidth = 1.6
      ctx.stroke()
      drawIcon(ctx, 'plus', x + 8 + is / 2, y + drawH / 2, is * 0.45, hot ? COLOR.accentHi : COLOR.muted)
      drawText(ctx, `Empty ${slotName}`, x + is + 16, y + drawH / 2 - (drawH >= 42 ? 7 : 0), { size: 12, weight: 800, color: COLOR.muted, maxW: w - is - 22, display: true })
      if (drawH >= 42) drawText(ctx, 'Browse Armory', x + is + 16, y + drawH / 2 + 8, { size: 10, weight: 700, color: COLOR.faint, maxW: w - is - 22 })
    }
    ctx.restore()
    if (st.focused) drawFocusRing(ctx, x, y, w, drawH, r)
    return
  }

  drawSurface(ctx, { x, y, width: w, height: drawH }, {
    r,
    lipH: pressed ? 1 : 3,
    fill: on ? '#4a5f94' : hot ? '#3d507d' : '#2c3a61',
    fillBot: on ? '#2d3f6b' : '#1d2745',
    shadow: false
  })
  if (on) {
    rr(ctx, x + 2, y + 2, w - 4, drawH - 4, Math.max(1, r - 2))
    ctx.strokeStyle = COLOR.accent
    ctx.lineWidth = 2
    ctx.stroke()
  }

  const faceH = drawH - (pressed ? 1 : 3)
  if (narrowSlot) {
    const is = Math.min(faceH - 22, 24)
    const ix = x + (w - is) / 2
    const iy = y + 4
    rr(ctx, ix, iy, is, is, 6)
    const ig = ctx.createLinearGradient(0, iy, 0, iy + is)
    ig.addColorStop(0, (meta?.hex ?? '#888888') + 'aa')
    ig.addColorStop(1, '#141c33')
    ctx.fillStyle = ig
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.6
    ctx.stroke()
    drawEquipIcon(ctx, spec.slot, spec.id, spec.accentHex, ix + is / 2, iy + is / 2, is * 0.36)
    drawText(ctx, spec.name, x + w / 2, y + faceH - 9, {
      size: 10,
      weight: 900,
      align: 'center',
      maxW: w - 8,
      display: true,
      shadow: true
    })
    drawCornerRibbon(ctx, x, y, w, faceH + 1, r, meta?.hex ?? '#888', 11)
    ctx.restore()
    if (st.focused) drawFocusRing(ctx, x, y, w, drawH, r)
    return
  }
  const is = Math.min(faceH - 10, 38)
  const ix = x + 6
  const iy = y + (faceH - is) / 2
  rr(ctx, ix, iy, is, is, RADIUS.sm)
  const ig = ctx.createLinearGradient(0, iy, 0, iy + is)
  ig.addColorStop(0, (meta?.hex ?? '#888888') + 'aa')
  ig.addColorStop(1, '#141c33')
  ctx.fillStyle = ig
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.8
  ctx.stroke()
  drawEquipIcon(ctx, spec.slot, spec.id, spec.accentHex, ix + is / 2, iy + is / 2, is * 0.36)

  const tx = ix + is + 9
  const right = x + w - 9
  const tagW = o.ownerText ? Math.min(72, measureText(ctx, o.ownerText, 9.5, 800, true) + 16) : on ? 22 : 0
  const twoLine = faceH >= 42
  drawText(ctx, spec.name, tx, y + faceH / 2 - (twoLine ? 8 : 0), { size: 12, weight: 900, maxW: right - tx - tagW - 4, display: true, shadow: true })
  if (twoLine) drawText(ctx, spec.desc, tx, y + faceH / 2 + 8.5, { size: 10, weight: 600, color: COLOR.muted, maxW: right - tx })
  if (o.ownerText) {
    drawChip(ctx, right, y + faceH / 2 - (twoLine ? 16 : 8.5), fitWithin(ctx, o.ownerText, 56, 9.5), {
      h: 17,
      size: 9.5,
      color: o.ownerText === 'Bag' ? COLOR.muted : '#ffffff',
      bg: o.ownerText === 'Bag' ? COLOR.wellDeep : COLOR.allyDark,
      border: COLOR.outline,
      align: 'right'
    })
  } else if (on) {
    ctx.beginPath()
    ctx.arc(right - 8, y + faceH / 2 - (twoLine ? 8 : 0), 8, 0, Math.PI * 2)
    ctx.fillStyle = COLOR.accent
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.6
    ctx.stroke()
    drawIcon(ctx, 'check', right - 8, y + faceH / 2 - (twoLine ? 8 : 0), 9, COLOR.accentText)
  }
  drawCornerRibbon(ctx, x, y, w, faceH + 1, r, meta?.hex ?? '#888', 13)
  ctx.restore()
  if (st.focused) drawFocusRing(ctx, x, y, w, drawH, r)
}

export function drawSkillRow(ctx: CanvasRenderingContext2D, rect: LayoutRect, o: { tier: 1 | 2 | 3; name: string; desc: string; unlocked: boolean; vfx: SkillSpec['vfx']; skillId: string }) {
  const { x, y, width: w, height: h } = rect
  const color = TIER_COLOR[o.tier]
  drawSurface(ctx, rect, {
    r: RADIUS.md,
    lipH: 2,
    fill: o.unlocked ? '#334675' : '#202a45',
    fillBot: o.unlocked ? '#223054' : '#161e33',
    rim: o.unlocked ? color + '88' : '#ffffff14',
    shadow: false
  })
  const faceH = h - 2
  const is = faceH - 10
  const icx = x + 6 + is / 2
  const icy = y + faceH / 2
  ctx.beginPath()
  ctx.arc(icx, icy, is / 2, 0, Math.PI * 2)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()
  ctx.strokeStyle = o.unlocked ? color : COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
  if (o.unlocked) drawSkillIcon(ctx, o.vfx, o.skillId, icx, icy, is * 0.34)
  else drawIcon(ctx, 'lock', icx, icy, is * 0.44, COLOR.faint)

  const tx = x + is + 14
  const sw = 38
  const twoLine = faceH >= 38
  drawText(ctx, o.name, tx, icy - (twoLine ? 8 : 0), {
    size: 12,
    weight: 900,
    color: o.unlocked ? '#ffffff' : COLOR.muted,
    maxW: twoLine ? w - is - 24 - sw : 130,
    display: true,
    shadow: o.unlocked
  })
  if (twoLine) {
    drawText(ctx, o.desc, tx, icy + 8.5, { size: 10.5, weight: 600, color: o.unlocked ? '#d0dbf5' : COLOR.faint, maxW: w - is - 24 })
  } else {
    const nw = Math.min(130, measureText(ctx, o.name, 12, 900, true))
    drawText(ctx, o.desc, tx + nw + 8, icy + 0.5, { size: 10.5, weight: 600, color: o.unlocked ? '#d0dbf5' : COLOR.faint, maxW: x + w - (tx + nw + 8) - sw - 6 })
  }
  drawStars(ctx, x + w - 8, twoLine ? y + 12 : icy, o.tier, o.tier, 8.5, 'right', o.unlocked ? color : '#55658a')
}

/** Tactile foil-wrapped game Booster Pack card with bold 3D price button & rarity ribbon. */
export function drawBoosterPack(ctx: CanvasRenderingContext2D, rect: LayoutRect, pack: PackSpec, st: CanvasWidgetDrawState, gold: number) {
  const affordable = !st.disabled
  const pressed = st.pressed && affordable
  const lift = st.disabled ? 0 : pressed ? 2 : st.hovered ? -4 : 0
  const { x, width: w, height: h } = rect
  const y = rect.y + lift
  const r = RADIUS.lg
  const hot = (st.hovered || st.focused) && affordable
  const lip = pressed ? 1 : 4

  ctx.save()
  ctx.save()
  ctx.shadowColor = hot ? pack.accentHex : '#05081499'
  ctx.shadowBlur = hot ? 18 : 10
  ctx.shadowOffsetY = 5
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = COLOR.outline
  ctx.fill()
  ctx.restore()

  // Extruded lip
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = '#12182b'
  ctx.fill()

  const faceH = h - lip
  rr(ctx, x + 1, y + 1, w - 2, faceH - 1, Math.max(2, r - 1))
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + faceH)
  g.addColorStop(0, pack.accentHex)
  g.addColorStop(0.55, '#2b3c66')
  g.addColorStop(1, '#18223d')
  ctx.fillStyle = g
  ctx.fill()

  // Animated diagonal foil glint
  ctx.save()
  rr(ctx, x + 1, y + 1, w - 2, faceH - 1, Math.max(2, r - 1))
  ctx.clip()
  const t = (performance.now() / 2400) % 1
  const sx = x - w + t * w * 3
  const sheen = ctx.createLinearGradient(sx, y, sx + w * 0.5, y + faceH)
  sheen.addColorStop(0, '#ffffff00')
  sheen.addColorStop(0.5, hot ? '#ffffff38' : '#ffffff1a')
  sheen.addColorStop(1, '#ffffff00')
  ctx.fillStyle = sheen
  ctx.fillRect(x, y, w, faceH)
  ctx.restore()

  // Corner rarity ribbon + thick dark ink border
  drawCornerRibbon(ctx, x, y, w, faceH + 1, r, pack.accentHex, 20)
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.4
  ctx.stroke()

  const priceH = 28
  const tall = faceH >= 116
  const artCy = tall ? y + (faceH - priceH - 42) * 0.46 + 4 : y + faceH / 2
  const artS = tall ? Math.min(w * 0.16, (faceH - priceH - 42) * 0.28) : Math.min(faceH * 0.32, 20)
  const artCx = tall ? x + w / 2 : x + 16 + artS * 1.25

  // Fan of dark-outlined stylized cards (side cards behind, hero gem card in front!)
  for (const i of [-1, 1, 0]) {
    ctx.save()
    ctx.translate(artCx + i * artS * 0.56, artCy + Math.abs(i) * artS * 0.12)
    ctx.rotate(i * 0.22)
    rr(ctx, -artS * 0.64, -artS, artS * 1.28, artS * 2, artS * 0.2)
    ctx.fillStyle = i === 0 ? pack.accentHex : '#43588a'
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 2
    ctx.stroke()
    if (i === 0) {
      drawFacetedGem(ctx, 0, 0, artS * 0.48, '#ffffff', pack.accentHex)
    }
    ctx.restore()
  }

  if (tall) {
    drawText(ctx, pack.name, x + w / 2, y + faceH - priceH - 34, {
      size: 15,
      weight: 900,
      align: 'center',
      maxW: w - 16,
      display: true,
      stroke: true,
      strokeWidth: 2.8
    })
    drawText(ctx, pack.subtitle, x + w / 2, y + faceH - priceH - 16, { size: 10.5, weight: 700, color: '#dce6ff', align: 'center', maxW: w - 12 })

    // Chunky 3D coin price button
    const py = y + faceH - priceH - 8
    const label = affordable ? `${pack.cost}` : `Need ${pack.cost - gold}g`
    rr(ctx, x + 12, py, w - 24, priceH, priceH / 2)
    ctx.fillStyle = affordable ? COLOR.accentLip : '#12182b'
    ctx.fill()
    rr(ctx, x + 13, py + 1, w - 26, priceH - 4, priceH / 2 - 1)
    const pg = ctx.createLinearGradient(0, py, 0, py + priceH)
    pg.addColorStop(0, affordable ? (hot ? '#fff09c' : COLOR.accentHi) : '#314066')
    pg.addColorStop(1, affordable ? COLOR.accentLo : '#1f2a47')
    ctx.fillStyle = pg
    ctx.fill()
    rr(ctx, x + 12.5, py + 0.5, w - 25, priceH - 1, priceH / 2)
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 2
    ctx.stroke()

    const tw = measureText(ctx, label, 13, 900, true) + 20
    const sx2 = x + w / 2 - tw / 2
    draw3DCoin(ctx, sx2 + 7, py + (priceH - 2) / 2, 7.5)
    drawText(ctx, label, sx2 + 19, py + (priceH - 2) / 2 + 0.5, {
      size: 13,
      weight: 900,
      color: affordable ? COLOR.accentText : COLOR.muted,
      maxW: w - 46,
      display: true
    })
  } else {
    const label = `${pack.cost}g`
    const pw = Math.max(58, measureText(ctx, label, 11.5, 900, true) + 28)
    const ph = 26
    const px = x + w - pw - 10
    const py = y + (faceH - ph) / 2
    const tx = artCx + artS * 1.45
    const textMax = Math.max(36, px - tx - 8)
    drawText(ctx, pack.name, tx, y + faceH / 2 - 8, { size: 13, weight: 900, maxW: textMax, display: true, stroke: true, strokeWidth: 2.2 })
    drawText(ctx, pack.subtitle, tx, y + faceH / 2 + 8, { size: 10, weight: 700, color: '#d0dcf5', maxW: textMax })

    rr(ctx, px, py, pw, ph, ph / 2)
    ctx.fillStyle = affordable ? COLOR.accentLip : COLOR.wellDeep
    ctx.fill()
    rr(ctx, px + 1, py + 1, pw - 2, ph - 3, ph / 2 - 1)
    ctx.fillStyle = affordable ? (hot ? COLOR.accentHi : COLOR.accent) : '#2a3759'
    ctx.fill()
    rr(ctx, px + 0.5, py + 0.5, pw - 1, ph - 1, ph / 2)
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.8
    ctx.stroke()
    draw3DCoin(ctx, px + 12, py + ph / 2 - 0.5, 6.5)
    drawText(ctx, label, px + 22, py + ph / 2, { size: 11.5, weight: 900, color: affordable ? COLOR.accentText : COLOR.muted, display: true })
  }
  ctx.restore()
  if (st.focused && !st.disabled) drawFocusRing(ctx, x, y, w, h, r)
}

/** Collectible Game Reveal Card with diagonal rarity ribbon & vibrant name plaque. */
export function drawRevealCard(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: {
    rarity: Rarity
    kind: 'hero' | 'weapon' | 'armor' | 'relic' | 'tactic'
    refId: string
    name: string
    detail: string
    value: number
    isNew: boolean
    portrait?: CanvasImageSource
    tacticSpec?: TacticCardSpec
    equipAccent?: string
  }
) {
  const meta = RARITY_META[o.rarity]
  const { x, y, width: w, height: h } = rect
  const r = RADIUS.lg
  const shiny = o.rarity === 'legendary' || o.rarity === 'epic'

  ctx.save()
  ctx.save()
  ctx.shadowColor = shiny ? meta.hex : '#05081499'
  ctx.shadowBlur = shiny ? 20 : 10
  ctx.shadowOffsetY = 5
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = COLOR.outline
  ctx.fill()
  ctx.restore()

  // Metallic rarity frame
  rr(ctx, x, y, w, h, r)
  ctx.fillStyle = meta.hex
  ctx.fill()

  const inset = 3.5
  const artH = Math.round(h * 0.52)
  ctx.save()
  rr(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(3, r - 2))
  ctx.clip()
  if (o.kind === 'tactic' && o.tacticSpec) {
    drawTacticIllustration(ctx, o.tacticSpec.id, x + inset, y + inset, w - inset * 2, artH)
  } else {
    const bg = ctx.createRadialGradient(x + w / 2, y + artH * 0.45, 6, x + w / 2, y + artH / 2, w * 0.72)
    bg.addColorStop(0, meta.hex)
    bg.addColorStop(1, '#1a2542')
    ctx.fillStyle = bg
    ctx.fillRect(x + inset, y + inset, w - inset * 2, artH)
    if (o.kind === 'hero' && o.portrait) {
      const s = Math.min(w * 0.84, artH * 0.96)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(o.portrait, x + (w - s) / 2, y + inset + artH - s, s, s)
    } else if (o.kind !== 'hero' && o.kind !== 'tactic') {
      drawEquipIcon(ctx, o.kind, o.refId, o.equipAccent ?? meta.hex, x + w / 2, y + inset + artH * 0.5, Math.min(w, artH) * 0.34)
    }
  }
  // Lower card info tray
  ctx.fillStyle = '#1b2542'
  ctx.fillRect(x + inset, y + inset + artH, w - inset * 2, h - artH)
  ctx.restore()

  // Vibrant colored name ribbon across center seam
  const bannerY = y + inset + artH - 10
  rr(ctx, x + 10, bannerY, w - 20, 22, 8)
  ctx.fillStyle = meta.hex
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
  drawText(ctx, o.name, x + w / 2, bannerY + 11.5, {
    size: 12.5,
    weight: 900,
    color: '#ffffff',
    align: 'center',
    maxW: w - 28,
    display: true,
    stroke: true,
    strokeWidth: 2.4
  })

  const kindLabel = o.kind === 'hero' ? 'Hero' : o.kind === 'tactic' ? 'Tactic' : o.kind[0].toUpperCase() + o.kind.slice(1)
  drawText(ctx, `${meta.label} ${kindLabel}`, x + w / 2, bannerY + 30, { size: 9, weight: 900, color: meta.hex, align: 'center', upper: true, spacing: 0.8, maxW: w - 14, display: true })
  drawParagraph(ctx, o.detail, x + 10, bannerY + 36, w - 20, y + h - bannerY - 58, { size: 10, weight: 700, color: '#d8e3ff', align: 'center', lineHeight: 12.5 })

  // Bottom value badge
  drawChip(ctx, x + w / 2, y + h - 22, `${o.value}g`, { icon: 'coin', h: 18, size: 10, color: COLOR.accentHi, bg: COLOR.wellDeep, border: COLOR.outline, align: 'center' })

  drawCornerRibbon(ctx, x, y, w, h, r, meta.hex, 22)
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.4
  ctx.stroke()

  if (o.isNew) {
    drawChip(ctx, x + 8, y + 8, 'NEW', { h: 18, size: 9.5, color: COLOR.accentText, bg: COLOR.accentHi, border: COLOR.outline })
  }
  ctx.restore()
}

// ===========================================================================
// Results & Pause Modals
// ===========================================================================

export function drawResultHeadline(ctx: CanvasRenderingContext2D, rect: LayoutRect, title: string, sub: string, won: boolean) {
  const cx = rect.x + rect.width / 2
  const color = won ? COLOR.accent : COLOR.enemy
  drawChip(ctx, cx, rect.y + 2, sub.toUpperCase(), { h: 19, size: 9.5, color: won ? COLOR.accentText : '#ffffff', bg: color, border: COLOR.outline, align: 'center' })
  const size = Math.min(34, rect.width / Math.max(6, title.length * 0.62))
  const ty = rect.y + 28 + size * 0.55
  drawText(ctx, title, cx, ty, {
    size,
    weight: 900,
    color: won ? COLOR.accentHi : '#ff9ca6',
    align: 'center',
    display: true,
    maxW: rect.width,
    stroke: true,
    strokeWidth: 4.5
  })
}

export function drawRewardRow(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: { icon?: IconName; portrait?: CanvasImageSource; title: string; detail: string; color: string; badge?: string }
) {
  const { x, y, width: w, height: h } = rect
  drawSurface(ctx, rect, { r: RADIUS.md, lipH: 3, fill: '#2c3b63', fillBot: '#1d2745', shadow: false })
  const faceH = h - 3
  const is = faceH - 10
  if (o.portrait) {
    drawPortraitTile(ctx, x + 6, y + 5, is, o.portrait, { ring: o.color, ringW: 2 })
  } else {
    rr(ctx, x + 6, y + 5, is, is, RADIUS.sm)
    ctx.fillStyle = COLOR.wellDeep
    ctx.fill()
    ctx.strokeStyle = o.color
    ctx.lineWidth = 2
    ctx.stroke()
    if (o.icon) drawIcon(ctx, o.icon, x + 6 + is / 2, y + faceH / 2, is * 0.52, o.color)
  }
  const tx = x + is + 16
  const badgeW = o.badge ? measureText(ctx, o.badge, 9.5, 800, true) + 20 : 0
  drawText(ctx, o.title, tx, y + faceH / 2 - 8, { size: 13, weight: 900, color: o.color, maxW: w - is - 24 - badgeW, display: true, shadow: true })
  drawText(ctx, o.detail, tx, y + faceH / 2 + 8.5, { size: 11, weight: 600, color: '#d0dcf5', maxW: w - is - 24 })
  if (o.badge) drawChip(ctx, x + w - 9, y + faceH / 2 - 17, o.badge, { h: 17, size: 9, color: COLOR.accentText, bg: COLOR.accent, border: COLOR.outline, align: 'right' })
}

/** Tactile 3D game ON/OFF toggle plate (replaces web iOS toggle switch!). */
export function drawSettingRow(ctx: CanvasRenderingContext2D, rect: LayoutRect, label: string, icon: IconName, on: boolean, st: CanvasWidgetDrawState) {
  const { x, width: w, height: h } = rect
  const y = rect.y + (st.pressed ? 2 : 0)
  const drawH = h - (st.pressed ? 2 : 0)
  const hot = st.hovered || st.focused

  drawSurface(ctx, { x, y, width: w, height: drawH }, {
    r: RADIUS.md,
    lipH: st.pressed ? 1 : 3,
    fill: hot ? '#3d5180' : '#2d3c63',
    fillBot: '#1f2a47',
    shadow: false
  })
  const cy = y + (drawH - (st.pressed ? 1 : 3)) / 2
  drawIcon(ctx, icon, x + 22, cy, 16, on ? COLOR.accentHi : COLOR.muted)
  drawText(ctx, label, x + 42, cy + 0.5, { size: 13, weight: 800, maxW: w - 118, display: true, shadow: true })

  // Chunky tactile ON / OFF pill switch
  const sw = 54
  const sh = 24
  const sx = x + w - sw - 10
  const sy = cy - sh / 2
  rr(ctx, sx, sy, sw, sh, 8)
  ctx.fillStyle = on ? COLOR.goodLip : '#12182b'
  ctx.fill()
  rr(ctx, sx + 1, sy + 1, sw - 2, sh - 3, 7)
  const sg = ctx.createLinearGradient(0, sy, 0, sy + sh)
  sg.addColorStop(0, on ? COLOR.good : '#435582')
  sg.addColorStop(1, on ? COLOR.goodLo : '#293554')
  ctx.fillStyle = sg
  ctx.fill()
  rr(ctx, sx + 1, sy + 1, sw - 2, sh - 2, 7.5)
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
  drawText(ctx, on ? 'ON' : 'OFF', sx + sw / 2, sy + (sh - 2) / 2 + 0.5, {
    size: 10.5,
    weight: 900,
    color: on ? '#ffffff' : COLOR.muted,
    align: 'center',
    display: true,
    stroke: on ? '#07381c' : false
  })
  if (st.focused) drawFocusRing(ctx, x, y, w, drawH, RADIUS.md)
}

// ===========================================================================
// Illustrations (tactic card art, skill glyphs, equipment icons)
// ===========================================================================

function drawTacticIllustration(
  ctx: CanvasRenderingContext2D,
  tacticId: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const cx = x + w * 0.5
  const cy = y + h * 0.5
  const s = Math.min(w, h) * 0.44

  ctx.save()
  // Atmospheric art window backdrop
  const bg = ctx.createRadialGradient(cx, cy - s * 0.15, s * 0.12, cx, cy, Math.max(w, h) * 0.78)
  if (tacticId === 'healing_draught') {
    bg.addColorStop(0, '#2a6e54')
    bg.addColorStop(1, '#0d221c')
  } else if (tacticId === 'rally_banner') {
    bg.addColorStop(0, '#783324')
    bg.addColorStop(1, '#240f12')
  } else if (tacticId === 'iron_ward') {
    bg.addColorStop(0, '#33587a')
    bg.addColorStop(1, '#121b2b')
  } else if (tacticId === 'flame_scroll') {
    bg.addColorStop(0, '#8c3114')
    bg.addColorStop(1, '#290d0c')
  } else if (tacticId === 'wind_step') {
    bg.addColorStop(0, '#1e6e73')
    bg.addColorStop(1, '#0c232b')
  } else if (tacticId === 'frost_nova_scroll') {
    bg.addColorStop(0, '#22598a')
    bg.addColorStop(1, '#0c1c33')
  } else if (tacticId === 'arcane_surge') {
    bg.addColorStop(0, '#5a328a')
    bg.addColorStop(1, '#1a0e30')
  } else if (tacticId === 'lightning_chain') {
    bg.addColorStop(0, '#4c2c82')
    bg.addColorStop(1, '#140c29')
  } else {
    // solar_blessing
    bg.addColorStop(0, '#9e6c19')
    bg.addColorStop(1, '#2e1a0a')
  }
  ctx.fillStyle = bg
  ctx.fillRect(x, y, w, h)

  // Clip artwork neatly inside window
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  if (tacticId === 'healing_draught') {
    // Glowing emerald alchemist flask
    ctx.beginPath()
    ctx.arc(cx, cy + s * 0.22, s * 0.68, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(72, 232, 148, 0.22)'
    ctx.fill()

    // Flask body
    ctx.beginPath()
    ctx.arc(cx, cy + s * 0.24, s * 0.56, 0, Math.PI * 2)
    const fl = ctx.createRadialGradient(cx - s * 0.16, cy + s * 0.08, s * 0.06, cx, cy + s * 0.24, s * 0.56)
    fl.addColorStop(0, '#b5ffd8')
    fl.addColorStop(0.5, '#3cd482')
    fl.addColorStop(1, '#135e3a')
    ctx.fillStyle = fl
    ctx.fill()
    ctx.strokeStyle = '#d9ffea'
    ctx.lineWidth = 1.6
    ctx.stroke()

    // Neck + cork
    ctx.fillStyle = '#c8eee0'
    ctx.fillRect(cx - s * 0.18, cy - s * 0.52, s * 0.36, s * 0.3)
    ctx.fillStyle = '#b57b42'
    ctx.fillRect(cx - s * 0.14, cy - s * 0.72, s * 0.28, s * 0.22)
    ctx.strokeStyle = '#5c3818'
    ctx.lineWidth = 1
    ctx.strokeRect(cx - s * 0.14, cy - s * 0.72, s * 0.28, s * 0.22)

    // Healing cross gleam
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(cx - s * 0.07, cy + s * 0.05, s * 0.14, s * 0.38)
    ctx.fillRect(cx - s * 0.19, cy + s * 0.17, s * 0.38, s * 0.14)
    // Sparkles
    drawStarShape(ctx, cx + s * 0.62, cy - s * 0.36, 4.5, 1.8, 4)
    ctx.fillStyle = '#fff4a8'
    ctx.fill()
  } else if (tacticId === 'rally_banner') {
    // Golden war standard banner on spear pole
    ctx.strokeStyle = '#f5d278'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(cx - s * 0.45, cy - s * 0.82)
    ctx.lineTo(cx - s * 0.45, cy + s * 0.85)
    ctx.stroke()
    // Spear finial
    ctx.beginPath()
    ctx.moveTo(cx - s * 0.45, cy - s * 0.96)
    ctx.lineTo(cx - s * 0.32, cy - s * 0.72)
    ctx.lineTo(cx - s * 0.58, cy - s * 0.72)
    ctx.closePath()
    ctx.fillStyle = '#fff1b5'
    ctx.fill()

    // Swallowtail crimson & gold banner
    ctx.beginPath()
    ctx.moveTo(cx - s * 0.42, cy - s * 0.62)
    ctx.quadraticCurveTo(cx + s * 0.12, cy - s * 0.74, cx + s * 0.78, cy - s * 0.56)
    ctx.lineTo(cx + s * 0.46, cy - s * 0.12)
    ctx.lineTo(cx + s * 0.78, cy + s * 0.34)
    ctx.quadraticCurveTo(cx + s * 0.12, cy + s * 0.22, cx - s * 0.42, cy + s * 0.36)
    ctx.closePath()
    const bg2 = ctx.createLinearGradient(cx - s * 0.4, cy - s * 0.6, cx + s * 0.7, cy + s * 0.3)
    bg2.addColorStop(0, '#d93842')
    bg2.addColorStop(0.6, '#9e1c28')
    bg2.addColorStop(1, '#5e0e18')
    ctx.fillStyle = bg2
    ctx.fill()
    ctx.strokeStyle = '#ffda75'
    ctx.lineWidth = 1.6
    ctx.stroke()

    // Golden sun crest on banner
    drawStarShape(ctx, cx + s * 0.05, cy - s * 0.12, s * 0.3, s * 0.13, 6)
    ctx.fillStyle = '#ffe582'
    ctx.fill()
  } else if (tacticId === 'iron_ward') {
    // Radiant winged kite shield
    for (const dir of [-1, 1]) {
      ctx.beginPath()
      ctx.moveTo(cx + dir * s * 0.35, cy - s * 0.22)
      ctx.quadraticCurveTo(cx + dir * s * 0.98, cy - s * 0.65, cx + dir * s * 0.88, cy - s * 0.05)
      ctx.quadraticCurveTo(cx + dir * s * 0.75, cy + s * 0.25, cx + dir * s * 0.35, cy + s * 0.2)
      ctx.closePath()
      ctx.fillStyle = '#8ad8ff'
      ctx.fill()
      ctx.strokeStyle = '#e0f6ff'
      ctx.lineWidth = 1.1
      ctx.stroke()
    }
    // Kite shield body
    ctx.beginPath()
    ctx.moveTo(cx, cy - s * 0.76)
    ctx.lineTo(cx + s * 0.58, cy - s * 0.48)
    ctx.lineTo(cx + s * 0.48, cy + s * 0.22)
    ctx.lineTo(cx, cy + s * 0.78)
    ctx.lineTo(cx - s * 0.48, cy + s * 0.22)
    ctx.lineTo(cx - s * 0.58, cy - s * 0.48)
    ctx.closePath()
    const sg = ctx.createLinearGradient(cx - s * 0.5, cy - s * 0.7, cx + s * 0.5, cy + s * 0.7)
    sg.addColorStop(0, '#e3eef7')
    sg.addColorStop(0.5, '#7e9bb5')
    sg.addColorStop(1, '#324459')
    ctx.fillStyle = sg
    ctx.fill()
    ctx.strokeStyle = '#ffdc7a'
    ctx.lineWidth = 2
    ctx.stroke()
    // Center boss cross
    ctx.strokeStyle = '#ffe9a6'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx, cy - s * 0.52)
    ctx.lineTo(cx, cy + s * 0.52)
    ctx.moveTo(cx - s * 0.34, cy - s * 0.08)
    ctx.lineTo(cx + s * 0.34, cy - s * 0.08)
    ctx.stroke()
  } else if (tacticId === 'flame_scroll') {
    // Blazing ember fireball + scroll
    ctx.beginPath()
    ctx.arc(cx, cy + s * 0.1, s * 0.78, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 118, 40, 0.28)'
    ctx.fill()

    // Outer flame tongue
    ctx.beginPath()
    ctx.moveTo(cx, cy - s * 0.85)
    ctx.bezierCurveTo(cx + s * 0.72, cy - s * 0.22, cx + s * 0.68, cy + s * 0.58, cx, cy + s * 0.76)
    ctx.bezierCurveTo(cx - s * 0.68, cy + s * 0.58, cx - s * 0.72, cy - s * 0.22, cx, cy - s * 0.85)
    const fg = ctx.createLinearGradient(cx, cy - s * 0.85, cx, cy + s * 0.75)
    fg.addColorStop(0, '#fff4a3')
    fg.addColorStop(0.42, '#ff8629')
    fg.addColorStop(1, '#b81d18')
    ctx.fillStyle = fg
    ctx.fill()

    // Inner white-hot flame core
    ctx.beginPath()
    ctx.moveTo(cx, cy - s * 0.36)
    ctx.bezierCurveTo(cx + s * 0.34, cy + s * 0.05, cx + s * 0.3, cy + s * 0.5, cx, cy + s * 0.58)
    ctx.bezierCurveTo(cx - s * 0.3, cy + s * 0.5, cx - s * 0.34, cy + s * 0.05, cx, cy - s * 0.36)
    ctx.fillStyle = '#fff9d6'
    ctx.fill()

    // Embers
    for (const [ex, ey, er] of [[-0.58, -0.45, 2.2], [0.56, -0.52, 2.6], [0.64, 0.1, 1.8]]) {
      ctx.beginPath()
      ctx.arc(cx + ex * s, cy + ey * s, er, 0, Math.PI * 2)
      ctx.fillStyle = '#ffd566'
      ctx.fill()
    }
  } else if (tacticId === 'wind_step') {
    // Turquoise feathered gale wing & wind currents
    ctx.strokeStyle = '#7bf5ea'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath()
      ctx.moveTo(cx - s * 0.85, cy + i * s * 0.34)
      ctx.quadraticCurveTo(cx - s * 0.1, cy + i * s * 0.26 - 6, cx + s * 0.42, cy + i * s * 0.3)
      ctx.stroke()
    }
    // Feathered wing
    ctx.beginPath()
    ctx.moveTo(cx - s * 0.45, cy + s * 0.56)
    ctx.quadraticCurveTo(cx - s * 0.15, cy - s * 0.55, cx + s * 0.82, cy - s * 0.68)
    ctx.quadraticCurveTo(cx + s * 0.55, cy - s * 0.05, cx + s * 0.58, cy + s * 0.08)
    ctx.quadraticCurveTo(cx + s * 0.22, cy + s * 0.18, cx + s * 0.28, cy + s * 0.34)
    ctx.quadraticCurveTo(cx - s * 0.1, cy + s * 0.48, cx - s * 0.45, cy + s * 0.56)
    ctx.closePath()
    const wg = ctx.createLinearGradient(cx - s * 0.4, cy + s * 0.5, cx + s * 0.8, cy - s * 0.7)
    wg.addColorStop(0, '#2bb8a8')
    wg.addColorStop(0.6, '#9cfcf2')
    wg.addColorStop(1, '#ffffff')
    ctx.fillStyle = wg
    ctx.fill()
    ctx.strokeStyle = '#0d474a'
    ctx.lineWidth = 1.2
    ctx.stroke()
  } else if (tacticId === 'frost_nova_scroll') {
    // Ornate 6-point crystal snowflake
    ctx.strokeStyle = '#b5eeff'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3
      const ex = cx + Math.cos(a) * s * 0.78
      const ey = cy + Math.sin(a) * s * 0.78
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(ex, ey)
      ctx.stroke()
      const bx = cx + Math.cos(a) * s * 0.46
      const by = cy + Math.sin(a) * s * 0.46
      for (const da of [-0.6, 0.6]) {
        ctx.beginPath()
        ctx.moveTo(bx, by)
        ctx.lineTo(bx + Math.cos(a + da) * s * 0.26, by + Math.sin(a + da) * s * 0.26)
        ctx.stroke()
      }
    }
    drawApCrystal(ctx, cx, cy, s * 0.34, true)
  } else if (tacticId === 'arcane_surge') {
    // Crown Surge: radiant mana crystal burst with orbiting gold crown ring
    ctx.beginPath()
    ctx.ellipse(cx, cy + s * 0.08, s * 0.76, s * 0.28, -0.25, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffd970'
    ctx.lineWidth = 2
    ctx.stroke()

    drawApCrystal(ctx, cx, cy, s * 0.62, true)
    drawStarShape(ctx, cx + s * 0.58, cy - s * 0.48, 5, 2, 4)
    ctx.fillStyle = '#fff3b8'
    ctx.fill()
    drawStarShape(ctx, cx - s * 0.6, cy + s * 0.42, 4.5, 1.8, 4)
    ctx.fillStyle = '#9ce2ff'
    ctx.fill()
  } else if (tacticId === 'lightning_chain') {
    // Storm Decree: glowing amethyst orb with forked lightning bolts
    ctx.beginPath()
    ctx.arc(cx, cy, s * 0.65, 0, Math.PI * 2)
    const lg = ctx.createRadialGradient(cx, cy, s * 0.08, cx, cy, s * 0.65)
    lg.addColorStop(0, '#f2dbff')
    lg.addColorStop(0.5, '#9d5cff')
    lg.addColorStop(1, 'rgba(64, 24, 128, 0)')
    ctx.fillStyle = lg
    ctx.fill()

    // Forked lightning bolt
    ctx.beginPath()
    ctx.moveTo(cx + s * 0.24, cy - s * 0.82)
    ctx.lineTo(cx - s * 0.26, cy - s * 0.06)
    ctx.lineTo(cx + s * 0.12, cy - s * 0.02)
    ctx.lineTo(cx - s * 0.28, cy + s * 0.82)
    ctx.lineTo(cx + s * 0.34, cy + s * 0.02)
    ctx.lineTo(cx - s * 0.04, cy - s * 0.02)
    ctx.closePath()
    ctx.fillStyle = '#fff9c4'
    ctx.fill()
    ctx.strokeStyle = '#7cdbff'
    ctx.lineWidth = 1.4
    ctx.stroke()
  } else {
    // solar_blessing: radiant golden sunflare crown
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * s * 0.92, cy + Math.sin(a) * s * 0.92)
      ctx.strokeStyle = i % 2 === 0 ? 'rgba(255, 224, 118, 0.55)' : 'rgba(255, 180, 62, 0.28)'
      ctx.lineWidth = i % 2 === 0 ? 2.4 : 1.2
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(cx, cy, s * 0.44, 0, Math.PI * 2)
    const sg = ctx.createRadialGradient(cx, cy, s * 0.05, cx, cy, s * 0.44)
    sg.addColorStop(0, '#ffffff')
    sg.addColorStop(0.5, '#ffe06b')
    sg.addColorStop(1, '#d47c15')
    ctx.fillStyle = sg
    ctx.fill()
    // Mini crown silhouette on top
    ctx.beginPath()
    ctx.moveTo(cx - s * 0.45, cy + s * 0.15)
    ctx.lineTo(cx - s * 0.52, cy - s * 0.35)
    ctx.lineTo(cx - s * 0.18, cy - s * 0.05)
    ctx.lineTo(cx, cy - s * 0.48)
    ctx.lineTo(cx + s * 0.18, cy - s * 0.05)
    ctx.lineTo(cx + s * 0.52, cy - s * 0.35)
    ctx.lineTo(cx + s * 0.45, cy + s * 0.15)
    ctx.closePath()
    ctx.fillStyle = '#fff0b2'
    ctx.fill()
    ctx.strokeStyle = '#6e3d0a'
    ctx.lineWidth = 1.3
    ctx.stroke()
  }

  ctx.restore()
}
function drawSkillIcon(
  ctx: CanvasRenderingContext2D,
  kind: 'strike' | SkillSpec['vfx'],
  skillId: string,
  cx: number,
  cy: number,
  r: number
) {
  ctx.save()
  if (kind === 'strike' || skillId === 'solar_cleave' || skillId === 'solar_slash' || skillId === 'crownbreaker') {
    // Diagonal steel/gold sword slash
    ctx.strokeStyle = kind === 'strike' ? '#e8f0f7' : '#ffe073'
    ctx.lineWidth = 2.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.65, cy + r * 0.65)
    ctx.lineTo(cx + r * 0.72, cy - r * 0.72)
    ctx.stroke()
    // Crossguard
    ctx.strokeStyle = '#e8b343'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.52, cy + r * 0.14)
    ctx.lineTo(cx - r * 0.14, cy + r * 0.52)
    ctx.stroke()
    if (skillId !== 'strike') {
      // Radiant slash crescent
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.72, -Math.PI * 0.75, Math.PI * 0.15)
      ctx.strokeStyle = '#ffcb57'
      ctx.lineWidth = 1.8
      ctx.stroke()
    }
  } else if (kind === 'slash' || skillId === 'shield_bash') {
    // Shield + impact lines
    ctx.beginPath()
    ctx.moveTo(cx, cy - r * 0.72)
    ctx.lineTo(cx + r * 0.58, cy - r * 0.42)
    ctx.lineTo(cx + r * 0.46, cy + r * 0.25)
    ctx.lineTo(cx, cy + r * 0.76)
    ctx.lineTo(cx - r * 0.46, cy + r * 0.25)
    ctx.lineTo(cx - r * 0.58, cy - r * 0.42)
    ctx.closePath()
    ctx.fillStyle = '#8aa8c2'
    ctx.fill()
    ctx.strokeStyle = '#ffe082'
    ctx.lineWidth = 1.5
    ctx.stroke()
  } else if (kind === 'arrow') {
    // Drawn bow & arrow
    ctx.strokeStyle = '#d9a45b'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx - r * 0.12, cy, r * 0.68, -Math.PI * 0.45, Math.PI * 0.45)
    ctx.stroke()
    ctx.strokeStyle = '#e6f5ff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.65, cy + r * 0.35)
    ctx.lineTo(cx + r * 0.7, cy - r * 0.45)
    ctx.stroke()
    ctx.fillStyle = '#ffe27a'
    ctx.beginPath()
    ctx.moveTo(cx + r * 0.82, cy - r * 0.52)
    ctx.lineTo(cx + r * 0.42, cy - r * 0.5)
    ctx.lineTo(cx + r * 0.62, cy - r * 0.16)
    ctx.closePath()
    ctx.fill()
  } else if (kind === 'fire') {
    // Blazing flame icon
    ctx.beginPath()
    ctx.moveTo(cx, cy - r * 0.82)
    ctx.bezierCurveTo(cx + r * 0.72, cy - r * 0.15, cx + r * 0.62, cy + r * 0.65, cx, cy + r * 0.78)
    ctx.bezierCurveTo(cx - r * 0.62, cy + r * 0.65, cx - r * 0.72, cy - r * 0.15, cx, cy - r * 0.82)
    ctx.fillStyle = '#ff7d2e'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy + r * 0.24, r * 0.3, 0, Math.PI * 2)
    ctx.fillStyle = '#fff2a6'
    ctx.fill()
  } else if (kind === 'frost') {
    // Six-point frost crystal
    ctx.strokeStyle = '#8ce6ff'
    ctx.lineWidth = 2
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.24, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  } else if (kind === 'holy') {
    // Radiant golden sun / chalice cross
    drawStarShape(ctx, cx, cy, r * 0.78, r * 0.32, 4)
    ctx.fillStyle = '#ffe173'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.24, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  } else if (kind === 'shadow') {
    // Twin crescent violet daggers
    ctx.strokeStyle = '#c880ff'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.62, -Math.PI * 0.8, Math.PI * 0.25)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.55, cy + r * 0.55)
    ctx.lineTo(cx + r * 0.65, cy - r * 0.65)
    ctx.strokeStyle = '#f0d8ff'
    ctx.stroke()
  } else {
    // arcane orb & star
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2)
    ctx.fillStyle = '#5bb8ff'
    ctx.fill()
    ctx.strokeStyle = '#e0f6ff'
    ctx.lineWidth = 1.6
    ctx.stroke()
    drawStarShape(ctx, cx, cy, r * 0.4, r * 0.16, 4)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
  ctx.restore()
}
export function drawEquipIcon(
  ctx: CanvasRenderingContext2D,
  slot: EquipSlot,
  equipId: string,
  accentHex: string,
  cx: number,
  cy: number,
  r: number
) {
  ctx.save()
  if (slot === 'weapon') {
    if (equipId.includes('bow')) {
      ctx.strokeStyle = accentHex
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.arc(cx - r * 0.15, cy, r * 0.72, -Math.PI * 0.45, Math.PI * 0.45)
      ctx.stroke()
      ctx.strokeStyle = '#e8f4ff'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.5, cy + r * 0.25)
      ctx.lineTo(cx + r * 0.7, cy - r * 0.35)
      ctx.stroke()
    } else if (equipId.includes('wand') || equipId.includes('staff')) {
      ctx.strokeStyle = '#a87c4b'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.65, cy + r * 0.65)
      ctx.lineTo(cx + r * 0.48, cy - r * 0.48)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx + r * 0.5, cy - r * 0.5, r * 0.32, 0, Math.PI * 2)
      ctx.fillStyle = accentHex
      ctx.fill()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.1
      ctx.stroke()
    } else if (equipId.includes('spear')) {
      ctx.strokeStyle = '#c49456'
      ctx.lineWidth = 2.3
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.7, cy + r * 0.7)
      ctx.lineTo(cx + r * 0.5, cy - r * 0.5)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx + r * 0.82, cy - r * 0.82)
      ctx.lineTo(cx + r * 0.2, cy - r * 0.55)
      ctx.lineTo(cx + r * 0.55, cy - r * 0.2)
      ctx.closePath()
      ctx.fillStyle = accentHex
      ctx.fill()
    } else {
      // Sword / Crownblade
      ctx.strokeStyle = accentHex
      ctx.lineWidth = 3.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.58, cy + r * 0.58)
      ctx.lineTo(cx + r * 0.68, cy - r * 0.68)
      ctx.stroke()
      ctx.strokeStyle = '#ffe38a'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.5, cy + r * 0.08)
      ctx.lineTo(cx - r * 0.08, cy + r * 0.5)
      ctx.stroke()
    }
  } else if (slot === 'armor') {
    if (equipId.includes('cloak')) {
      // Flowing ranger cloak
      ctx.beginPath()
      ctx.moveTo(cx, cy - r * 0.72)
      ctx.lineTo(cx + r * 0.62, cy + r * 0.65)
      ctx.quadraticCurveTo(cx, cy + r * 0.45, cx - r * 0.62, cy + r * 0.65)
      ctx.closePath()
      ctx.fillStyle = accentHex
      ctx.fill()
      ctx.strokeStyle = '#ffe6a3'
      ctx.lineWidth = 1.4
      ctx.stroke()
    } else {
      // Cuirass / Breastplate
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.55, cy - r * 0.65)
      ctx.lineTo(cx - r * 0.2, cy - r * 0.45)
      ctx.lineTo(cx + r * 0.2, cy - r * 0.45)
      ctx.lineTo(cx + r * 0.55, cy - r * 0.65)
      ctx.lineTo(cx + r * 0.65, cy - r * 0.1)
      ctx.lineTo(cx + r * 0.45, cy + r * 0.68)
      ctx.lineTo(cx, cy + r * 0.8)
      ctx.lineTo(cx - r * 0.45, cy + r * 0.68)
      ctx.lineTo(cx - r * 0.65, cy - r * 0.1)
      ctx.closePath()
      ctx.fillStyle = accentHex
      ctx.fill()
      ctx.strokeStyle = '#ffe6a3'
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
  } else {
    if (equipId.includes('boots')) {
      // Winged Strider Boot
      ctx.beginPath()
      ctx.moveTo(cx - r * 0.35, cy - r * 0.62)
      ctx.lineTo(cx + r * 0.12, cy - r * 0.62)
      ctx.lineTo(cx + r * 0.18, cy + r * 0.2)
      ctx.lineTo(cx + r * 0.7, cy + r * 0.35)
      ctx.lineTo(cx + r * 0.7, cy + r * 0.68)
      ctx.lineTo(cx - r * 0.45, cy + r * 0.68)
      ctx.closePath()
      ctx.fillStyle = accentHex
      ctx.fill()
      ctx.strokeStyle = '#ffe6a3'
      ctx.lineWidth = 1.3
      ctx.stroke()
    } else if (equipId.includes('signet')) {
      // Gold Signet Ring
      ctx.beginPath()
      ctx.arc(cx, cy + r * 0.1, r * 0.52, 0, Math.PI * 2)
      ctx.strokeStyle = '#ffd96b'
      ctx.lineWidth = 3.2
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy - r * 0.42, r * 0.24, 0, Math.PI * 2)
      ctx.fillStyle = accentHex
      ctx.fill()
    } else {
      // Radiant Amulet / Crest / Heart of Solis
      drawStarShape(ctx, cx, cy, r * 0.7, r * 0.36, 6)
      ctx.fillStyle = accentHex
      ctx.fill()
      ctx.strokeStyle = '#fff3c4'
      ctx.lineWidth = 1.3
      ctx.stroke()
    }
  }
  ctx.restore()
}
