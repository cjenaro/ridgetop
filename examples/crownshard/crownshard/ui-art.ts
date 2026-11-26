import type { CanvasWidgetDrawState, LayoutRect } from 'ridgetop/ui'
import type {
  BattleHeroXpGain, BattleUnit, ChapterSpec, CombatForecast, CombatForecastAlt, DifficultyLevel,
  ElementalComboPreview, EquipSlot, EquipmentSpec, FacingDir, FacingExposureLevel, HeroSpec,
  LandmarkKind, OwnedHeroCard, PackPityStatus, PackRevealItem, PackSpec, Rarity, SkillSpec, StatusKind,
  TacticCardSpec, TurnOrderActionPreview, TurnPreviewEntry
} from './types.ts'
import { ARMORY_STAT_ORDER, formatStatDelta, formatStatValue } from './armory-diff.ts'
import type { EquipmentStatDiff } from './armory-diff.ts'
import { DIFFICULTY_META, RARITY_META, RARITY_ORDER } from './data.ts'
import { EPIC_PITY_THRESHOLD, LEGENDARY_PITY_THRESHOLD } from './forge.ts'
import { heroLevelProgress } from './leveling.ts'
import { RECOMMENDED_MIN_TACTIC_DECK, getEquipEffect, getHeroPassive } from './passives.ts'
import type { EquipEffectSpec, HeroPassiveSpec, TacticDeckCurve } from './passives.ts'

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
  | 'chevron-left' | 'chevron-right' | 'chevron-up' | 'chevron-down' | 'pause' | 'play' | 'music' | 'volume' | 'mute' | 'gauge'
  | 'rotate-left' | 'rotate-right' | 'sword' | 'shield' | 'heart' | 'boot' | 'bolt' | 'target'
  | 'crit' | 'star' | 'coin' | 'gem' | 'hourglass' | 'lock' | 'check' | 'plus' | 'minus' | 'sparkle' | 'flag'
  | 'users' | 'bag' | 'cards' | 'camp' | 'arrow-right' | 'up' | 'sell' | 'retreat'
  | 'map' | 'skull' | 'crown' | 'chest'

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
  kind: 'coin' | 'gem' | 'deck' | 'dust' | 'shards',
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
  ctx.strokeStyle = kind === 'dust' ? '#8c5ad9' : kind === 'shards' ? '#3d99d6' : '#4e6394'
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
  } else if (kind === 'dust') {
    drawFacetedGem(ctx, icx, cy, iconR, '#e0a8ff', '#7c3aed')
  } else if (kind === 'shards') {
    drawFacetedGem(ctx, icx, cy, iconR, '#7ae7ff', '#1d82d9')
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
    color: kind === 'coin'
      ? COLOR.accentHi
      : kind === 'deck'
        ? '#b8ffd6'
        : kind === 'dust'
          ? '#e5bfff'
          : kind === 'shards'
            ? '#9ceeff'
            : '#ffffff',
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
    case 'chevron-up':
      ctx.moveTo(cx - s * 0.62, cy + s * 0.32); ctx.lineTo(cx, cy - s * 0.34); ctx.lineTo(cx + s * 0.62, cy + s * 0.32); ctx.stroke(); break
    case 'chevron-down':
      ctx.moveTo(cx - s * 0.62, cy - s * 0.32); ctx.lineTo(cx, cy + s * 0.34); ctx.lineTo(cx + s * 0.62, cy - s * 0.32); ctx.stroke(); break
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
    case 'map':
      ctx.moveTo(cx - s * 0.8, cy - s * 0.55); ctx.lineTo(cx - s * 0.25, cy - s * 0.78); ctx.lineTo(cx + s * 0.25, cy - s * 0.52); ctx.lineTo(cx + s * 0.8, cy - s * 0.75)
      ctx.lineTo(cx + s * 0.8, cy + s * 0.55); ctx.lineTo(cx + s * 0.25, cy + s * 0.78); ctx.lineTo(cx - s * 0.25, cy + s * 0.52); ctx.lineTo(cx - s * 0.8, cy + s * 0.75)
      ctx.closePath(); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx - s * 0.25, cy - s * 0.78); ctx.lineTo(cx - s * 0.25, cy + s * 0.52)
      ctx.moveTo(cx + s * 0.25, cy - s * 0.52); ctx.lineTo(cx + s * 0.25, cy + s * 0.78); ctx.stroke(); break
    case 'skull':
      ctx.arc(cx, cy - s * 0.12, s * 0.66, Math.PI * 0.85, Math.PI * 2.15)
      ctx.lineTo(cx + s * 0.44, cy + s * 0.72); ctx.lineTo(cx - s * 0.44, cy + s * 0.72); ctx.closePath(); ctx.fill()
      ctx.fillStyle = COLOR.outline
      ctx.beginPath(); ctx.arc(cx - s * 0.24, cy - s * 0.1, s * 0.16, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(cx + s * 0.24, cy - s * 0.1, s * 0.16, 0, Math.PI * 2); ctx.fill(); break
    case 'crown':
      ctx.moveTo(cx - s * 0.78, cy + s * 0.52); ctx.lineTo(cx - s * 0.84, cy - s * 0.34); ctx.lineTo(cx - s * 0.34, cy + s * 0.04)
      ctx.lineTo(cx, cy - s * 0.76); ctx.lineTo(cx + s * 0.34, cy + s * 0.04); ctx.lineTo(cx + s * 0.84, cy - s * 0.34)
      ctx.lineTo(cx + s * 0.78, cy + s * 0.52); ctx.closePath(); ctx.fill(); break
    case 'chest':
      rr(ctx, cx - s * 0.78, cy - s * 0.56, s * 1.56, s * 1.18, s * 0.22); ctx.fill()
      ctx.strokeStyle = COLOR.outline; ctx.lineWidth = Math.max(1.6, size * 0.12)
      ctx.beginPath(); ctx.moveTo(cx - s * 0.78, cy - s * 0.06); ctx.lineTo(cx + s * 0.78, cy - s * 0.06); ctx.stroke()
      ctx.fillStyle = COLOR.accentHi; ctx.fillRect(cx - s * 0.18, cy - s * 0.2, s * 0.36, s * 0.34); break
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

/** Compact live camera compass dial button showing North relative to the battle camera's 360-degree yaw. */
export function drawCameraCompassButton(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  yawRad: number,
  heading: 'N' | 'W' | 'S' | 'E',
  st: CanvasWidgetDrawState
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
  ctx.fillStyle = '#141c33'
  ctx.fill()

  // Face
  const faceH = Math.max(4, drawH - lip)
  rr(ctx, x + 1, y + 1, w - 2, faceH - 1, Math.max(2, r - 1))
  const g = ctx.createLinearGradient(0, y, 0, y + faceH)
  g.addColorStop(0, hot ? '#5770ab' : '#3a4d7a')
  g.addColorStop(1, hot ? '#394c7a' : '#243154')
  ctx.fillStyle = g
  ctx.fill()

  // Dark ink outline
  rr(ctx, x + 1, y + 1, w - 2, drawH - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()

  // Recessed compass dial
  const cx = x + w / 2
  const cy = y + faceH / 2
  const dialR = Math.max(7, Math.min(w, faceH) * 0.41)
  ctx.beginPath()
  ctx.arc(cx, cy, dialR, 0, Math.PI * 2)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()
  ctx.strokeStyle = hot ? COLOR.accentHi : COLOR.border
  ctx.lineWidth = 1.4
  ctx.stroke()

  // Rotating North / South diamond needle (+yawRad rotates North tip clockwise to match screen-space North)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(yawRad)
  const tip = dialR * 0.78
  const side = dialR * 0.28
  // North half (bright coral-gold pointer)
  ctx.beginPath()
  ctx.moveTo(0, -tip)
  ctx.lineTo(side, 0)
  ctx.lineTo(-side, 0)
  ctx.closePath()
  ctx.fillStyle = heading === 'N' ? COLOR.accentHi : COLOR.danger
  ctx.fill()
  // South half (cool steel tail)
  ctx.beginPath()
  ctx.moveTo(0, tip * 0.82)
  ctx.lineTo(side * 0.85, 0)
  ctx.lineTo(-side * 0.85, 0)
  ctx.closePath()
  ctx.fillStyle = '#6f85b8'
  ctx.fill()
  ctx.restore()

  // Crisp heading badge at bottom-right corner of the compass button
  drawText(ctx, heading, x + w - 5, y + faceH - 5, {
    size: 8.5,
    weight: 900,
    color: heading === 'N' ? COLOR.accentHi : '#e6eeff',
    align: 'right',
    display: true,
    stroke: true,
    strokeWidth: 2
  })

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

export interface ObjectiveHudDrawInfo {
  readonly kind: 'rout' | 'assassinate' | 'defend' | 'seize'
  readonly label: string
  readonly progressText: string
  readonly urgent?: boolean
  readonly compact?: boolean
}

export function drawObjectiveBadge(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  info: ObjectiveHudDrawInfo
) {
  const accent = info.urgent
    ? COLOR.danger
    : info.kind === 'assassinate'
      ? '#ff6b78'
      : info.kind === 'defend'
        ? '#5eeeff'
        : info.kind === 'seize'
          ? COLOR.accentHi
          : '#8de8b0'
  const fillTop = info.urgent
    ? '#4a1b2b'
    : info.kind === 'assassinate'
      ? '#3d1c2b'
      : info.kind === 'defend'
        ? '#18374a'
        : info.kind === 'seize'
          ? '#3d3018'
          : '#1c3330'
  const fillBot = info.urgent ? '#2d101b' : '#141d34'
  drawSurface(ctx, rect, { r: RADIUS.md, lipH: 3, fill: fillTop, fillBot })

  const { x, y, width: w, height: h } = rect
  const cy = y + (h - 3) / 2
  const iconR = info.compact ? 9 : 10.5
  const iconX = x + iconR + 7
  ctx.beginPath()
  ctx.arc(iconX, cy, iconR, 0, Math.PI * 2)
  ctx.fillStyle = COLOR.wellDeep
  ctx.fill()
  ctx.strokeStyle = accent
  ctx.lineWidth = 1.6
  ctx.stroke()

  const iconName: IconName = info.kind === 'assassinate'
    ? 'target'
    : info.kind === 'defend'
      ? 'shield'
      : info.kind === 'seize'
        ? 'flag'
        : 'sword'
  drawIcon(ctx, iconName, iconX, cy, iconR * 1.15, accent)

  const textX = iconX + iconR + 7
  const maxW = Math.max(40, w - (textX - x) - 8)
  drawText(ctx, info.progressText, textX, cy + 0.5, {
    size: info.compact ? 10.5 : 11.5,
    weight: 900,
    color: info.urgent ? '#ffd6dc' : '#ffffff',
    maxW,
    display: true,
    stroke: true,
    strokeWidth: 2
  })
}

export function drawDeployHeroChip(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  opts: {
    readonly name: string
    readonly facing: string
    readonly portrait?: CanvasImageSource
    readonly selected: boolean
    readonly compact?: boolean
  },
  st: CanvasWidgetDrawState
) {
  const active = opts.selected || st.selected
  drawSurface(ctx, rect, {
    r: RADIUS.md,
    lipH: st.pressed ? 1 : 3,
    fill: active ? '#2b4d7c' : st.hovered ? '#283960' : '#1d2846',
    fillBot: active ? '#1a3254' : '#141c34',
    border: active ? COLOR.accent : undefined
  })
  const { x, y, width: w, height: h } = rect
  const cy = y + (h - 3) / 2
  const pSize = Math.min(h - 10, opts.compact ? 28 : 34)
  if (opts.portrait) {
    drawPortraitTile(ctx, x + 5, cy - pSize / 2, pSize, opts.portrait, { ring: active ? COLOR.accentHi : COLOR.ally })
  }
  const tx = x + (opts.portrait ? pSize + 10 : 8)
  const shortName = opts.name.split(' ').pop() ?? opts.name
  drawText(ctx, shortName, tx, cy - 5, {
    size: opts.compact ? 10.5 : 11.5,
    weight: 900,
    color: active ? COLOR.accentHi : '#ffffff',
    maxW: Math.max(24, w - (tx - x) - 6)
  })
  drawText(ctx, `FACE ${opts.facing.toUpperCase()}`, tx, cy + 7, {
    size: opts.compact ? 8.5 : 9,
    weight: 800,
    color: active ? '#9cecff' : COLOR.muted,
    maxW: Math.max(24, w - (tx - x) - 6)
  })
}

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

export interface TurnTokenDrawOpts {
  /** True when this unit is spotlighted via hovering any matching token in the turn-order bar. */
  spotlighted?: boolean
  /** True when this slot is the active hero's projected landing slot in a CT preview. */
  projectedSlot?: boolean
  /** Optional short badge shown on a projected slot (e.g. 'NEXT #2' or '+40 CT'). */
  projectedBadge?: string
  /** Accent color for projected slot highlight. */
  projectedAccent?: string
  /** True when this slot was the full-spend baseline slot shifted earlier by Waiting. */
  wasBaselineSlot?: boolean
  /** Subtle dimming for non-matching tokens while another unit is spotlighted. */
  dimmed?: boolean
}

export interface TurnOrderCalloutInfo {
  readonly name: string
  readonly team: 'ally' | 'enemy'
  readonly hp: number
  readonly maxHp: number
  readonly shield: number
  readonly ct: number
  readonly speed: number
  readonly slotIndex: number
  readonly isCurrent: boolean
}

export interface TurnTimelinePreviewOpts {
  /** Active hero portrait drawn inside the ghost/projected token marker. */
  readonly activePortrait?: CanvasImageSource
  /** Total visible slots in the top bar. */
  readonly slotCount: number
  /** Width of each turn token slot in px. */
  readonly tokenW: number
  /** Horizontal gap between token slots in px. */
  readonly gap: number
  /** Horizontal inner padding of the timeline container in px. */
  readonly padX: number
  /** Optional animation time in seconds (for smooth pulse; falls back to 0 in headless tests). */
  readonly time?: number
}

export function drawTurnToken(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  entry: TurnPreviewEntry,
  portrait: CanvasImageSource | undefined,
  st: CanvasWidgetDrawState,
  opts: TurnTokenDrawOpts = {}
) {
  const team = entry.team === 'ally' ? COLOR.ally : COLOR.enemy
  const current = entry.isCurrent
  const spotlighted = Boolean(st.hovered || opts.spotlighted)
  const projectedSlot = Boolean(opts.projectedSlot)
  const lift = st.pressed ? 1 : spotlighted ? -3 : projectedSlot ? -1.5 : 0
  const labelH = 15
  const s = Math.min(rect.width - 2, rect.height - labelH + (current ? 1 : 2))
  const x = rect.x + (rect.width - s) / 2
  const y = rect.y + lift

  ctx.save()
  if (opts.dimmed && !spotlighted && !current && !projectedSlot) {
    ctx.globalAlpha *= 0.62
  }

  if (spotlighted) {
    const spotGlow = entry.team === 'ally' ? '#5ce1ffbb' : '#ff7b54bb'
    const spotRing = entry.team === 'ally' ? '#7cf0ff' : '#ff9c6e'
    ctx.save()
    ctx.shadowColor = spotGlow
    ctx.shadowBlur = 14
    rr(ctx, x - 2.5, y - 2.5, s + 5, s + 5, s * 0.25)
    ctx.fillStyle = spotRing
    ctx.fill()
    ctx.restore()
  } else if (current) {
    ctx.save()
    ctx.shadowColor = COLOR.glow
    ctx.shadowBlur = 12
    rr(ctx, x - 1, y - 1, s + 2, s + 2, s * 0.24)
    ctx.fillStyle = COLOR.accent
    ctx.fill()
    ctx.restore()
  } else if (projectedSlot) {
    const pAccent = opts.projectedAccent ?? COLOR.ap
    ctx.save()
    ctx.shadowColor = `${pAccent}99`
    ctx.shadowBlur = 10
    rr(ctx, x - 1.5, y - 1.5, s + 3, s + 3, s * 0.24)
    ctx.strokeStyle = pAccent
    ctx.lineWidth = 2.2
    ctx.stroke()
    ctx.restore()
  }

  drawPortraitTile(ctx, x, y, s, portrait, {
    ring: spotlighted
      ? (entry.team === 'ally' ? '#8cf4ff' : '#ffaa7a')
      : projectedSlot
        ? (opts.projectedAccent ?? COLOR.ap)
        : current
          ? COLOR.accentHi
          : team,
    ringW: spotlighted || current ? 3 : projectedSlot ? 2.6 : 2.2,
    r: s * 0.22,
    bg: entry.team === 'ally' ? '#365f99' : '#7a3040',
    dim: Boolean(opts.wasBaselineSlot && !projectedSlot)
  })

  if (opts.wasBaselineSlot && !projectedSlot) {
    ctx.save()
    ctx.setLineDash([4, 3])
    rr(ctx, x - 1, y - 1, s + 2, s + 2, s * 0.22)
    ctx.strokeStyle = '#ff9c6eaa'
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.restore()
  }

  // Bottom plaque: golden NOW ribbon, projected badge, or dark-outlined speed badge
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
  } else if (projectedSlot && opts.projectedBadge) {
    const pw = Math.min(rect.width + 6, Math.max(36, measureText(ctx, opts.projectedBadge, 8.5, 900, true) + 10))
    const py = y + s - 3
    const pAccent = opts.projectedAccent ?? COLOR.ap
    rr(ctx, rect.x + (rect.width - pw) / 2, py, pw, 14, 7)
    ctx.fillStyle = pAccent
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.6
    ctx.stroke()
    drawText(ctx, opts.projectedBadge, rect.x + rect.width / 2, py + 7.5, {
      size: 8.5,
      weight: 900,
      color: COLOR.ink,
      align: 'center',
      display: true
    })
  } else {
    const pw = 34
    const py = y + s - 2
    rr(ctx, rect.x + (rect.width - pw) / 2, py, pw, 14, 7)
    ctx.fillStyle = spotlighted ? '#24345c' : COLOR.wellDeep
    ctx.fill()
    ctx.strokeStyle = spotlighted ? (entry.team === 'ally' ? '#7cf0ff' : '#ff9c6e') : COLOR.outline
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

/** Compact floating callout strip beneath the turn-order bar when hovering a unit token. */
export function drawTurnOrderCallout(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  info: TurnOrderCalloutInfo
) {
  const accent = info.team === 'ally' ? COLOR.ally : COLOR.enemy
  drawSurface(ctx, rect, {
    r: rect.height / 2,
    lipH: 3,
    fill: '#233052',
    fillBot: '#151e36',
    border: accent,
    glow: `${accent}55`
  })
  const cy = rect.y + (rect.height - 3) / 2
  let cx = rect.x + 12

  // Team dot
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx + 4, cy, 4.5, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
  cx += 14

  // Unit name
  const nameW = drawText(ctx, info.name, cx, cy + 0.5, {
    size: 11.5,
    weight: 900,
    color: '#ffffff',
    display: true,
    maxW: Math.max(60, rect.width * 0.34),
    shadow: true
  })
  cx += nameW + 8

  // Rank chip (ACTING NOW or #N)
  const rankLabel = info.isCurrent ? 'NOW' : `#${info.slotIndex + 1}`
  const rankW = drawChip(ctx, cx, cy - 8.5, rankLabel, {
    h: 17,
    size: 9.5,
    bg: info.isCurrent ? COLOR.accent : '#1b2645',
    border: info.isCurrent ? COLOR.outline : accent,
    color: info.isCurrent ? COLOR.accentText : accent
  })
  cx += rankW + 8

  // HP / Shield / CT / SPD readout
  const shieldPart = info.shield > 0 ? `+${info.shield}` : ''
  const statText = `HP ${info.hp}/${info.maxHp}${shieldPart} · CT ${Math.round(info.ct)}/100 · SPD ${info.speed}`
  drawText(ctx, statText, cx, cy + 0.5, {
    size: 10.5,
    weight: 800,
    color: COLOR.muted,
    maxW: Math.max(40, rect.x + rect.width - cx - 10)
  })
}

/**
 * Draws the dashed connector arc + ghost/projected hero token directly over the top turn-order bar
 * when hovering Wait, Strike/Skill, or a board move/attack target.
 */
export function drawTurnTimelinePreviewOverlay(
  ctx: CanvasRenderingContext2D,
  barRect: LayoutRect,
  preview: TurnOrderActionPreview,
  opts: TurnTimelinePreviewOpts
) {
  if (opts.slotCount < 2) return
  const isBonus = preview.ctSaved > 0
  const accent = isBonus ? COLOR.ap : '#ff9a44'
  const glow = isBonus ? '#5ce1ffaa' : '#ff9a44aa'

  // Slot 0 is NOW; projectedIndex 0 = acts next (slot 1), etc.
  const rawTargetSlot = preview.projectedIndex >= 0 ? 1 + preview.projectedIndex : opts.slotCount - 1
  const clampedSlot = Math.max(1, Math.min(opts.slotCount - 1, rawTargetSlot))
  const overflowRight = preview.projectedIndex < 0 || rawTargetSlot >= opts.slotCount

  const slotCenterX = (idx: number) =>
    barRect.x + opts.padX + idx * (opts.tokenW + opts.gap) + opts.tokenW * 0.5

  const startX = slotCenterX(0)
  // If Wait shifted the hero ahead of another unit, place ghost right at the left edge of the shifted slot
  // so it visually inserts ahead of the unit it overtook; otherwise center on the landing slot.
  const shiftInsert = preview.slotsGained > 0 && !overflowRight
  const endX = overflowRight
    ? barRect.x + barRect.width - 14
    : shiftInsert
      ? barRect.x + opts.padX + clampedSlot * (opts.tokenW + opts.gap) - opts.gap * 0.5
      : slotCenterX(clampedSlot)

  const topY = barRect.y + 4
  const arcPeakY = Math.max(2, topY - 12)
  const pulse = 0.5 + 0.5 * Math.sin((opts.time ?? 0) * 6.5)

  ctx.save()

  // Dashed connector arc from NOW (slot 0) to projected landing spot
  ctx.save()
  ctx.shadowColor = glow
  ctx.shadowBlur = 8
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.moveTo(startX, topY + 2)
  ctx.quadraticCurveTo((startX + endX) * 0.5, arcPeakY, endX, topY + 3)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()

  // Origin dot on NOW slot
  ctx.beginPath()
  ctx.arc(startX, topY + 2, 3.8, 0, Math.PI * 2)
  ctx.fillStyle = COLOR.accentHi
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Vertical dashed insertion beam + ghost mini-portrait at projected landing position
  const ghostS = Math.min(26, Math.max(20, opts.tokenW * 0.48))
  const gx = Math.max(barRect.x + 4, Math.min(barRect.x + barRect.width - ghostS - 4, endX - ghostS * 0.5))
  const gy = barRect.y + (barRect.height - ghostS) * 0.5 - 3

  if (shiftInsert) {
    ctx.save()
    ctx.strokeStyle = accent
    ctx.lineWidth = 2.2
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(endX, barRect.y + 5)
    ctx.lineTo(endX, barRect.y + barRect.height - 5)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.restore()
  }

  // Downward caret above landing spot
  ctx.beginPath()
  ctx.moveTo(endX, topY + 8)
  ctx.lineTo(endX - 5, topY + 1)
  ctx.lineTo(endX + 5, topY + 1)
  ctx.closePath()
  ctx.fillStyle = accent
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.4
  ctx.stroke()

  // Ghost projected hero portrait marker
  ctx.save()
  ctx.globalAlpha = 0.88 + pulse * 0.12
  ctx.shadowColor = glow
  ctx.shadowBlur = 10
  drawPortraitTile(ctx, gx, gy, ghostS, opts.activePortrait, {
    ring: accent,
    ringW: 2.2,
    r: ghostS * 0.25,
    bg: '#234a7a'
  })
  ctx.restore()

  // Dashed outer ring around the ghost marker to unmistakably mark it as a projection
  ctx.save()
  ctx.setLineDash([3.5, 2.5])
  rr(ctx, gx - 2, gy - 2, ghostS + 4, ghostS + 4, ghostS * 0.28)
  ctx.strokeStyle = '#ffffffdd'
  ctx.lineWidth = 1.6
  ctx.stroke()
  ctx.restore()

  ctx.restore()
}

/** Tactical CT Shift Preview summary pill shown beneath the top turn-order bar. */
export function drawTurnOrderPreviewBanner(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  preview: TurnOrderActionPreview,
  waitComparison?: TurnOrderActionPreview | null
) {
  const isBonus = preview.ctSaved > 0
  const accent = isBonus ? COLOR.ap : '#ff9a44'
  drawSurface(ctx, rect, {
    r: rect.height / 2,
    lipH: 3,
    fill: isBonus ? '#1e3557' : '#3a293f',
    fillBot: isBonus ? '#12213b' : '#23172b',
    border: accent,
    glow: `${accent}55`
  })
  const cy = rect.y + (rect.height - 3) / 2
  let cx = rect.x + 10

  // Action chip: WAIT +40 CT / MOVE +20 CT / ACT +20 CT / FULL TURN
  const actionLabel = preview.actionKind === 'wait'
    ? (preview.ctSaved > 0 ? `WAIT +${preview.ctSaved} CT` : 'END TURN')
    : preview.actionKind === 'move_only'
      ? (preview.ctSaved > 0 ? `MOVE +${preview.ctSaved} CT` : 'MOVE')
      : preview.actionKind === 'act'
        ? (preview.ctSaved > 0 ? `ACT +${preview.ctSaved} CT` : 'ACT -100 CT')
        : 'MOVE+ACT -100 CT'

  const chipW = drawChip(ctx, cx, cy - 8.5, actionLabel, {
    h: 17,
    size: 9.5,
    bg: accent,
    border: COLOR.outline,
    color: COLOR.ink
  })
  cx += chipW + 8

  const nextRank = preview.projectedIndex >= 0 ? `#${preview.projectedIndex + 1}` : '#9+'
  const rankText = isBonus ? `NEXT ${nextRank}` : `${nextRank} AFTER ACT`
  const rankW = drawText(ctx, rankText, cx, cy + 0.5, {
    size: 11.5,
    weight: 900,
    color: '#ffffff',
    display: true,
    shadow: true
  })
  cx += rankW + 8

  const avail = rect.x + rect.width - cx - 10
  if (preview.slotsGained > 0 && avail >= 66) {
    const gainText = `▲ +${preview.slotsGained} SLOT${preview.slotsGained > 1 ? 'S' : ''}`
    const gw = drawChip(ctx, cx, cy - 8.5, gainText, {
      h: 17,
      size: 9.5,
      bg: '#133d2c',
      border: COLOR.good,
      color: COLOR.good
    })
    cx += gw + 6
    const rem = rect.x + rect.width - cx - 10
    if (preview.baselineIndex >= 0 && rem >= 60) {
      drawText(ctx, `vs #${preview.baselineIndex + 1} act`, cx, cy + 0.5, {
        size: 10,
        weight: 800,
        color: COLOR.muted,
        maxW: rem
      })
    }
  } else if (!isBonus && waitComparison && waitComparison.ctSaved > 0 && avail >= 72) {
    const waitRank = waitComparison.projectedIndex >= 0 ? `#${waitComparison.projectedIndex + 1}` : '#9+'
    const cmpText = waitComparison.slotsGained > 0
      ? `WAIT → ${waitRank} (▲${waitComparison.slotsGained})`
      : `WAIT +${waitComparison.ctSaved} CT → ${waitRank}`
    drawText(ctx, cmpText, cx, cy + 0.5, {
      size: 10,
      weight: 800,
      color: COLOR.ap,
      maxW: avail
    })
  } else if (avail >= 52) {
    drawText(ctx, `CT ${Math.round(preview.remainingCt)}/100`, cx, cy + 0.5, {
      size: 10,
      weight: 800,
      color: COLOR.muted,
      maxW: avail
    })
  }
}

/**
 * Stylized RPG Unit Frame (inspired by classic angled armor-plate HP HUDs):
 * Chunky square portrait housing with glowing side accent tab, overlapping circular
 * Star-Tier badge, dynamic color-shifting segmented HP bar, shield/CT micro-bars,
 * and dark-outlined stat badges.
 */
interface StatusBadgeSpec {
  readonly text: string
  readonly bg: string
  readonly color: string
}

function statusChipStyle(status: StatusKind, prefix = ''): StatusBadgeSpec {
  if (status === 'taunt') return { text: `${prefix}TAUNT`, bg: '#8a241b', color: '#ffd4c2' }
  if (status === 'haste') return { text: `${prefix}HASTE`, bg: '#115e57', color: '#b8fff2' }
  if (status === 'poison') return { text: `${prefix}POISON`, bg: '#2d5414', color: '#d8ff9e' }
  if (status === 'burn') return { text: `${prefix}BURN`, bg: '#7a340e', color: '#ffd5a3' }
  if (status === 'slow') return { text: `${prefix}SLOW`, bg: '#184b6e', color: '#c2f0ff' }
  if (status === 'stun') return { text: `${prefix}STUN`, bg: '#6e540c', color: '#fff2a6' }
  return { text: `${prefix}BUFF`, bg: '#61450b', color: '#ffe899' }
}

function getUnitStatusBadges(unit: BattleUnit): StatusBadgeSpec[] {
  const badges: StatusBadgeSpec[] = []
  if (unit.tauntTurns > 0) badges.push({ text: 'TAUNT', bg: '#8a241b', color: '#ffd4c2' })
  if (unit.hasteTurns > 0) badges.push({ text: 'HASTE', bg: '#115e57', color: '#b8fff2' })
  if (unit.poisonStacks > 0) badges.push({ text: `PSN x${unit.poisonStacks}`, bg: '#2d5414', color: '#d8ff9e' })
  if (unit.burnTurns > 0) badges.push({ text: 'BURN', bg: '#7a340e', color: '#ffd5a3' })
  if (unit.slowTurns > 0) badges.push({ text: 'SLOW', bg: '#184b6e', color: '#c2f0ff' })
  if (unit.stunTurns > 0) badges.push({ text: 'STUN', bg: '#6e540c', color: '#fff2a6' })
  if (unit.empowerTurns > 0) badges.push({ text: 'BUFF', bg: '#61450b', color: '#ffe899' })
  return badges
}

export function drawUnitCard(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  unit: BattleUnit | undefined,
  portrait: CanvasImageSource | undefined,
  speedValue: number,
  roleLabel: string,
  xpProgress?: { readonly xp: number; readonly xpForNext: number; readonly ratio: number; readonly isMaxLevel: boolean }
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
  const roleW = drawChip(ctx, tx, py + 20, roleLabel.toUpperCase(), {
    h: 16,
    size: 8.5,
    color: ally ? '#b8e8ff' : '#ffd0d6',
    bg: ally ? '#16355e' : '#541826',
    border: COLOR.outline
  })
  const badgeMaxX = x + w - pad
  let badgeX = tx + roleW + 4
  const lvLabel = `Lv.${unit.level ?? 1}`
  const lvEstW = Math.round(measureText(ctx, lvLabel, 8.5, 800, true) + 12)
  if (badgeX + lvEstW <= badgeMaxX) {
    const lvW = drawChip(ctx, badgeX, py + 20, lvLabel, {
      h: 16,
      size: 8.5,
      color: ally ? '#8ef5ff' : '#ffd6a8',
      bg: ally ? '#112a4a' : '#4a1d28',
      border: COLOR.outline
    })
    badgeX += lvW + 3
  }
  const unitBadges = getUnitStatusBadges(unit)
  for (const b of unitBadges) {
    const estW = Math.round(measureText(ctx, b.text, 8, 800, true) + 12)
    if (badgeX + estW > badgeMaxX) break
    const drawnW = drawChip(ctx, badgeX, py + 20, b.text, {
      h: 16,
      size: 8,
      color: b.color,
      bg: b.bg,
      border: COLOR.outline
    })
    badgeX += drawnW + 3
  }

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
    if (ally && xpProgress && barW > 24) {
      const xpY = barY + barH + (unit.shield > 0 ? 7 : 3)
      if (xpY + 4 <= y + faceH - 2) {
        drawBar(ctx, barX, xpY, barW, 4, xpProgress.ratio, xpProgress.isMaxLevel ? COLOR.accent : COLOR.ap, COLOR.wellDeep)
      }
    }
    return
  }

  // Crisp HP readout + shield + Innate Passive tag (or compact XP bar)
  const passive = unit.heroId ? getHeroPassive(unit.heroId) : null
  const showXpBar = ally && xpProgress !== undefined && barW >= 96
  const xpBarW = showXpBar ? Math.min(60, Math.max(36, Math.round(barW * 0.28))) : 0
  const hpText = `HP ${unit.hp}/${unit.maxHp}${unit.shield > 0 ? ` +${unit.shield}` : ''}`
  const passiveTagW = !showXpBar && passive && barW >= 150 ? Math.min(barW * 0.52, measureText(ctx, `★ ${passive.name}`, 9, 800, true) + 6) : 0
  drawText(ctx, hpText, barX + 2, barY + barH + 10, {
    size: 10.5,
    weight: 900,
    color: '#e8f0ff',
    maxW: Math.max(40, barW - (showXpBar ? xpBarW + 8 : passiveTagW ? passiveTagW + 6 : 4)),
    display: true,
    shadow: true
  })
  if (showXpBar && xpProgress) {
    const xpBarX = barX + barW - xpBarW
    drawBar(ctx, xpBarX, barY + barH + 7, xpBarW, 6, xpProgress.ratio, xpProgress.isMaxLevel ? COLOR.accent : COLOR.ap, COLOR.wellDeep)
  } else if (passive && passiveTagW > 0) {
    drawText(ctx, `★ ${passive.name}`, barX + barW - 2, barY + barH + 10, {
      size: 9,
      weight: 900,
      color: passive.accentHex,
      align: 'right',
      maxW: passiveTagW,
      display: true,
      shadow: true
    })
  }

  // Chunky outlined stat pills along bottom
  const stats: [IconName, number, string][] = [['sword', unit.atk, '#ffaa54'], ['shield', unit.def, '#69c2ff'], ['bolt', speedValue, '#ffe066']]
  const cw = (barW - 8) / 3
  const cy = y + faceH - pad - 10
  if (cy - 10 < barY + barH + 15) return
  if (passive && cy - 24 > barY + barH + 17) {
    drawText(ctx, passive.shortLabel, barX + 2, barY + barH + 22, {
      size: 8.5,
      weight: 700,
      color: COLOR.muted,
      maxW: barW - 4
    })
  }
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

/** Chunky golden Wait / End Turn arcade button (or pulsing crimson Enemy Turn plate / Wait-to-Face confirm). */
export function drawEndTurnButton(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: {
    isPlayerTurn: boolean
    ctBonus: number
    facingPicker?: { facing: FacingDir; exposureLevel: FacingExposureLevel } | null
  },
  st: CanvasWidgetDrawState
) {
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

  const fp = o.facingPicker
  if (fp) {
    const variant = fp.exposureLevel === 'back' ? 'danger' : fp.exposureLevel === 'flank' ? 'primary' : 'success'
    drawButton(ctx, rect, '', st, { variant, r })
    const pressed = st.pressed && !st.disabled
    const y = rect.y + (pressed ? 3 : 0)
    const faceH = h - 4
    const cx = x + w / 2
    const tall = faceH >= 80
    const txtColor = variant === 'primary' ? COLOR.accentText : '#ffffff'
    const dirLabel = `Face ${fp.facing.toUpperCase()}`
    if (tall) drawIcon(ctx, 'check', cx, y + faceH * 0.27, 20, txtColor)
    drawText(ctx, dirLabel, cx, tall ? y + faceH * 0.54 : y + faceH / 2 - (o.ctBonus > 0 ? 7 : 0), {
      size: w < 100 ? 14 : 17,
      weight: 900,
      color: txtColor,
      align: 'center',
      display: true,
      maxW: w - 10,
      stroke: variant !== 'primary'
    })
    const sub = fp.exposureLevel === 'back'
      ? 'BACK RISK'
      : fp.exposureLevel === 'flank'
        ? 'FLANK'
        : o.ctBonus > 0
          ? `+${o.ctBonus} CT`
          : 'Confirm'
    const cy = tall ? y + faceH * 0.79 : y + faceH / 2 + 11
    drawChip(ctx, cx, cy - 8.5, sub, {
      h: 17,
      size: 9.5,
      bg: '#090d1a44',
      border: '#ffffff55',
      color: txtColor,
      align: 'center'
    })
    if (tall) drawKeycap(ctx, x + w - 45, y + 6, 'Space', 15)
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

function comboBadgeStyle(combo: ElementalComboPreview): { text: string; bg: string; color: string; border: string } {
  if (combo.id === 'shatter') {
    return { text: combo.badgeText, bg: '#1a4f7a', color: '#ffe66e', border: '#7ef0ff' }
  }
  if (combo.id === 'freeze') {
    return { text: combo.badgeText, bg: '#0f4c75', color: '#c8f8ff', border: '#84e8ff' }
  }
  if (combo.id === 'wildfire') {
    return { text: combo.badgeText, bg: '#8a2708', color: '#ffdf78', border: '#ff8f38' }
  }
  return { text: combo.badgeText, bg: '#3f5908', color: '#c8ff5c', border: '#ff8f38' }
}

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
  const isRevive = Boolean(fc.isRevive)
  const isHeal = isRevive || (!fc.isOffensive && fc.targetTeam === 'ally')
  const isEmpty = fc.emptyTileTarget || fc.targetTeam === 'none'
  const showCounterWarn = !isEmpty && !isHeal && Boolean(fc.canCounter && (fc.counterDmg ?? 0) > 0)
  const showCounterAvoid = !isEmpty && !isHeal && !showCounterWarn && (fc.counterAvoidReason === 'flank' || fc.counterAvoidReason === 'backstab')
  const comboStyle = fc.elementalCombo ? comboBadgeStyle(fc.elementalCombo) : null
  const accent = fc.friendlyFire
    ? '#ff4588'
    : isRevive
      ? COLOR.accent
      : fc.lethalNormal
        ? '#ff5768'
        : showCounterWarn && fc.counterLethal
          ? '#ff5768'
          : comboStyle
            ? comboStyle.border
            : isHeal
            ? COLOR.good
            : isEmpty
              ? COLOR.muted
              : fc.requiresMove ? '#ff9f38' : COLOR.accent
  drawSurface(ctx, rect, {
    r: RADIUS.lg,
    lipH: 4,
    fill: fc.friendlyFire ? '#47223d' : '#2b3961',
    fillBot: fc.friendlyFire ? '#261224' : '#18223d',
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

  // Right: Target portrait or Empty Ground crosshair tile
  const rpx = x + w - pad - ps
  if (isEmpty) {
    rr(ctx, rpx, topY, ps, ps, 8)
    ctx.fillStyle = '#1b243d'
    ctx.fill()
    ctx.strokeStyle = comboStyle ? comboStyle.border : '#6c7ea8'
    ctx.lineWidth = 2
    ctx.stroke()
    drawIcon(ctx, 'target', rpx + ps / 2, topY + ps / 2, ps * 0.56, comboStyle ? comboStyle.color : COLOR.muted)
  } else {
    drawPortraitTile(ctx, rpx, topY, ps, o.targetPortrait, {
      ring: fc.friendlyFire ? '#ff5ca8' : isHeal ? COLOR.good : COLOR.enemy,
      ringW: 2.2,
      r: 8,
      bg: fc.friendlyFire ? '#6e2249' : isHeal ? '#235e46' : '#7a3040'
    })
  }

  // Center header: "Attacker -> Target" + action pill
  const midX = x + pad + ps + 8
  const midW = w - (pad + ps + 8) * 2
  const cx = midX + midW / 2
  const attShort = fc.attackerName.split(' ').pop() ?? fc.attackerName
  const tgtShort = fc.targetName
  drawText(ctx, `${attShort}  >  ${tgtShort}`, cx, topY + 9, {
    size: o.compact ? 11.5 : 12.5,
    weight: 900,
    color: fc.friendlyFire ? '#ffc2dd' : '#ffffff',
    align: 'center',
    maxW: midW,
    display: true,
    stroke: true,
    strokeWidth: 2.2
  })

  // Action + tactical modifier chips (priority: Elemental Combo / OA Risk / Revive / Friendly Fire / Pincer / Backstab / Flank first!)
  const tags: { text: string; bg: string; color: string; border?: string }[] = []
  if (comboStyle) {
    tags.push(comboStyle)
  }
  if (fc.opportunityAttacks && fc.opportunityAttacks.triggers.length > 0) {
    const oa = fc.opportunityAttacks
    const oaLabel = oa.lethal
      ? `⚠ OA LETHAL!`
      : oa.totalHpLoss > 0
        ? `⚠ OA -${oa.totalHpLoss} HP`
        : `⚠ OA BLK`
    tags.push({
      text: oaLabel,
      bg: oa.lethal ? '#8c1424' : '#7a2c0e',
      color: oa.lethal ? '#ffd6dc' : '#ffd28a'
    })
  }
  if (isRevive) {
    tags.push({
      text: fc.reviveKoCountdown ? `REVIVE · KO ${fc.reviveKoCountdown}` : 'REVIVE!',
      bg: '#6e4d08',
      color: '#ffe88a'
    })
  }
  if (fc.friendlyFire) {
    tags.push({
      text: fc.friendlyFireCount > 1 ? `ALLY HIT x${fc.friendlyFireCount}!` : 'FRIENDLY FIRE!',
      bg: '#8a1647',
      color: '#ffd4e6'
    })
  }
  const hasPincer = Boolean(fc.pincerAssisterUid && (fc.pincerDmg ?? 0) > 0)
  if (hasPincer && fc.pincerDmg) {
    const allyShort = (fc.pincerAssisterName ?? 'Ally').split(' ').pop() ?? 'Ally'
    const fullLabel = `PINCER +${fc.pincerDmg} (${allyShort})`
    const fullW = Math.round(measureText(ctx, fullLabel, 8.5, 900, true) + 12)
    tags.push({
      text: fullW <= midW + 6 ? fullLabel : `PINCER +${fc.pincerDmg}`,
      bg: '#7a4d04',
      color: '#ffe878',
      border: '#ffd45c'
    })
  }
  if (fc.isOffensive && !isEmpty) {
    if (fc.attackArc === 'back') tags.push({ text: 'BACKSTAB +30%', bg: '#5e1a6e', color: '#ffbaff' })
    else if (fc.attackArc === 'flank') tags.push({ text: 'FLANK +15%', bg: '#6e450a', color: '#ffe078' })
  }
  if (fc.displacementPreview) {
    const dp = fc.displacementPreview
    if (dp.kind === 'swap') {
      tags.push({
        text: dp.moved ? 'SWAP' : 'SWAP BLOCKED',
        bg: dp.moved ? '#4e2778' : '#3a2d4a',
        color: dp.moved ? '#e8c4ff' : '#b8aec9'
      })
    } else {
      const verb = dp.kind === 'pull' ? 'PULL' : 'PUSH'
      const isLedge = dp.collidedWith === 'void' || dp.collidedWith === 'water' || dp.collidedWith === 'lava'
      const pushLabel = dp.collidedWith !== 'none' && dp.collisionDmg > 0
        ? `${verb} ${dp.distance} → ${isLedge ? 'LEDGE' : 'COLLIDE'} +${dp.collisionDmg}`
        : `${verb} ${dp.distance}${dp.iceSlid ? ' +ICE' : ''}`
      tags.push({
        text: pushLabel,
        bg: dp.collisionDmg > 0 ? '#7d3012' : '#16586b',
        color: dp.collisionDmg > 0 ? '#ffd08a' : '#9ef7ff'
      })
      if (dp.fallDmg > 0) {
        tags.push({ text: `FALL +${dp.fallDmg}`, bg: '#7a2514', color: '#ffc285' })
      }
      if (dp.hazardKind === 'lava_geyser') {
        tags.push({ text: 'GEYSER!', bg: '#8a230e', color: '#ffbd7a' })
      } else if (dp.hazardKind === 'cursed_altar') {
        tags.push({ text: 'ALTAR!', bg: '#5a1e78', color: '#ebb8ff' })
      }
      if (dp.causesStun) {
        tags.push({ text: '+STUN', bg: '#6e5208', color: '#ffe88a' })
      }
    }
  }
  tags.push({
    text: fc.actionName.toUpperCase(),
    bg: fc.mode === 'strike' ? '#3d4f80' : fc.mode === 'tactic' ? '#633487' : '#1b558a',
    color: '#ffffff'
  })
  if (fc.requiresMove) tags.push({ text: 'MOVE+HIT', bg: '#7d4408', color: '#ffd98a' })
  if (fc.elevationDiff > 0) {
    const pct = fc.elevationDiff >= 3 ? 35 : fc.elevationDiff === 2 ? 28 : 20
    tags.push({ text: `HIGH +${pct}%`, bg: '#6e5208', color: COLOR.accentHi })
  } else if (fc.elevationDiff < 0 && fc.isOffensive) {
    const pct = fc.elevationDiff <= -2 ? -15 : -8
    tags.push({ text: `UPHILL ${pct}%`, bg: '#5e2c26', color: '#ffb5a8' })
  }
  if (fc.coverBonus > 0 && fc.isOffensive) {
    tags.push({ text: `COVER +${fc.coverBonus} DEF`, bg: '#27466b', color: '#a8dcff' })
  }
  if (fc.terrainDefBonus !== 0 && fc.isOffensive) {
    tags.push({
      text: fc.terrainDefBonus > 0 ? `TERRAIN +${fc.terrainDefBonus}` : `EXPOSED ${fc.terrainDefBonus}`,
      bg: fc.terrainDefBonus > 0 ? '#2b4752' : '#69341a',
      color: fc.terrainDefBonus > 0 ? '#a8e6e2' : '#ffd1a3'
    })
  }
  if (fc.empowered) tags.push({ text: 'BUFF +35%', bg: '#6e5208', color: COLOR.accentHi })
  if (fc.targetTaunting) tags.push({ text: 'TAUNT', bg: '#8a241b', color: '#ffd4c2' })
  if (fc.aoeTargets > 1) tags.push({ text: `AOE x${fc.aoeTargets}`, bg: '#6e2336', color: '#ffd0d6' })
  if (fc.status) tags.push(statusChipStyle(fc.status))
  if (fc.selfStatus && fc.selfStatus !== fc.status) tags.push(statusChipStyle(fc.selfStatus, '+'))

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
    drawChip(ctx, tx, chipY, t.text, { h: chipH, size: 8.5, color: t.color, bg: t.bg, border: t.border ?? COLOR.outline })
    tx += t.cw + 4
  }

  // Divider well for damage readout + projected HP bar
  const wellY = topY + ps + 6
  const wellH = o.compact ? 42 : 46
  drawWell(ctx, { x: x + pad, y: wellY, width: w - pad * 2, height: wellH }, RADIUS.sm)

  const innerX = x + pad + 8
  const innerW = w - pad * 2 - 16

  if (isEmpty) {
    if (fc.elementalCombo?.id === 'wildfire') {
      drawText(ctx, 'WILDFIRE SPREAD', innerX, wellY + 15, {
        size: o.compact ? 12 : 13,
        weight: 900,
        color: '#ffad42',
        maxW: innerW * 0.65,
        display: true
      })
      drawText(ctx, `${fc.elementalCombo.affectedTiles.length} GRASS TILES`, innerX + innerW, wellY + 15, {
        size: 10,
        weight: 800,
        color: '#ffdf78',
        align: 'right',
        display: true
      })
      drawText(ctx, 'Ignites connected tall grass (10 Fire DMG + Burn)', innerX, wellY + wellH - 11, {
        size: 9.5,
        weight: 700,
        color: '#ffd0a6',
        maxW: innerW,
        display: true
      })
      return
    }
    drawText(ctx, 'NO TARGETS IN AREA', innerX, wellY + 15, {
      size: o.compact ? 12 : 13,
      weight: 900,
      color: COLOR.muted,
      maxW: innerW * 0.65,
      display: true
    })
    drawText(ctx, fc.selfShield > 0 ? `+${fc.selfShield} SELF SHD` : 'FREE TARGET', innerX + innerW, wellY + 15, {
      size: 10,
      weight: 800,
      color: fc.selfShield > 0 ? COLOR.ap : COLOR.faint,
      align: 'right',
      display: true
    })
    drawText(ctx, 'Click to cast on empty ground anyway (spends action & cooldown)', innerX, wellY + wellH - 11, {
      size: 9.5,
      weight: 700,
      color: COLOR.faint,
      maxW: innerW,
      display: true
    })
    return
  }

  if (isHeal) {
    const parts: string[] = []
    if (isRevive) parts.push(`REVIVE +${fc.healAmount} HP`)
    else if (fc.healAmount > 0) parts.push(`+${fc.healAmount} HP`)
    if (fc.shieldAmount > 0) parts.push(`+${fc.shieldAmount} SHD`)
    drawText(ctx, parts.join('  ') || 'SUPPORT', innerX, wellY + 14, {
      size: o.compact ? 13.5 : 15.5,
      weight: 900,
      color: isRevive ? '#ffe88a' : COLOR.good,
      maxW: innerW * 0.62,
      display: true,
      stroke: true,
      strokeWidth: 2.6
    })
    drawText(ctx, isRevive ? `KO -> ${fc.targetHpAfterNormal} HP` : `HP ${fc.targetHpBefore} -> ${fc.targetHpAfterNormal}`, innerX + innerW, wellY + 14, {
      size: 11,
      weight: 900,
      color: isRevive ? '#ffe88a' : '#b8ffda',
      align: 'right',
      maxW: innerW * 0.38,
      display: true
    })
  } else {
    const totalBonusDmg = (fc.pincerDmg && fc.pincerDmg > 0 ? fc.pincerDmg : 0)
      + (fc.displacementPreview?.totalBonusDmg ?? 0)
      + (fc.elementalCombo?.bonusDamage ?? 0)
    const bonusSuffix = totalBonusDmg > 0 ? ` (+${totalBonusDmg})` : ''
    const dmgStr = fc.critChance > 0 && fc.critDmg > fc.normalDmg
      ? `${fc.normalDmg}-${fc.critDmg}${bonusSuffix} DMG`
      : `${fc.normalDmg}${bonusSuffix} DMG`
    drawText(ctx, dmgStr, innerX, wellY + 14, {
      size: o.compact ? 14 : 16.5,
      weight: 900,
      color: fc.lethalNormal ? '#ff7c89' : comboStyle ? comboStyle.color : COLOR.accentHi,
      maxW: innerW * 0.56,
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

  // Counter-Attack Warning / Avoidance Strip
  if (showCounterWarn || showCounterAvoid) {
    const stripY = wellY + wellH + 4
    const stripH = 18
    const hasStripRoom = stripY + stripH <= y + rect.height - 2
    if (showCounterWarn) {
      const dmg = fc.counterDmg ?? 0
      const lethal = Boolean(fc.counterLethal)
      const label = lethal ? 'COUNTER LETHAL!' : `COUNTER -${dmg} HP`
      const bg = lethal ? '#8a1628' : '#733510'
      const border = lethal ? '#ff6b7a' : '#ffad42'
      const textCol = lethal ? '#ffd9de' : '#ffe2a8'
      if (hasStripRoom) {
        const sx = x + pad
        const sw = w - pad * 2
        ctx.save()
        rr(ctx, sx, stripY, sw, stripH, 6)
        ctx.fillStyle = bg
        ctx.fill()
        ctx.strokeStyle = border
        ctx.lineWidth = 1.6
        ctx.stroke()
        drawIcon(ctx, lethal ? 'skull' : 'sword', sx + 11, stripY + stripH / 2, 10, textCol)
        drawText(ctx, label, sx + 21, stripY + stripH / 2 + 0.5, {
          size: 9.5,
          weight: 900,
          color: textCol,
          maxW: sw - 82,
          display: true,
          shadow: true
        })
        drawText(ctx, lethal ? `-${dmg} HP` : 'FRONTAL', sx + sw - 7, stripY + stripH / 2 + 0.5, {
          size: 8.5,
          weight: 900,
          color: lethal ? '#ff99a5' : '#ffc978',
          align: 'right',
          display: true
        })
        ctx.restore()
      } else {
        drawChip(ctx, x + w - pad, wellY - 11, label, {
          h: 16,
          size: 8.5,
          color: textCol,
          bg,
          border,
          align: 'right'
        })
      }
    } else if (showCounterAvoid) {
      const avoidTag = fc.counterAvoidReason === 'backstab' ? 'NO COUNTER (BACKSTAB)' : 'NO COUNTER (FLANK)'
      const bg = '#15402c'
      const border = '#3ee07f'
      const textCol = '#a8ffd0'
      if (hasStripRoom) {
        const sx = x + pad
        const sw = w - pad * 2
        ctx.save()
        rr(ctx, sx, stripY, sw, stripH, 6)
        ctx.fillStyle = bg
        ctx.fill()
        ctx.strokeStyle = border
        ctx.lineWidth = 1.4
        ctx.stroke()
        drawIcon(ctx, 'check', sx + 11, stripY + stripH / 2, 9.5, textCol)
        drawText(ctx, avoidTag, sx + 21, stripY + stripH / 2 + 0.5, {
          size: 9,
          weight: 900,
          color: textCol,
          maxW: sw - 28,
          display: true
        })
        ctx.restore()
      } else {
        drawChip(ctx, x + w - pad, wellY - 11, avoidTag, {
          h: 16,
          size: 8.5,
          color: textCol,
          bg,
          border,
          align: 'right'
        })
      }
    }
  }
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

  const valStr = alt.isRevive
    ? `REV +${alt.healAmount}`
    : alt.healAmount > 0
      ? `+${alt.healAmount} HP`
      : alt.lethalNormal
        ? `${alt.normalDmg} KO!`
        : alt.critDmg > alt.normalDmg
          ? `${alt.normalDmg}-${alt.critDmg}`
          : `${alt.normalDmg}`
  const valCol = alt.isRevive ? '#ffe88a' : alt.healAmount > 0 ? COLOR.good : alt.lethalNormal ? '#ff7c89' : COLOR.accentHi
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

export function drawCampHeader(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  gold: number,
  deckValue: number,
  compact: boolean,
  forgeBalances?: { dust: number; shards: number }
) {
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
  cx += drawCurrencyBadge(ctx, cx, cy, `${gold}`, 'coin', 28) + 8
  if (forgeBalances && !compact && cx + 150 < x + w) {
    cx += drawCurrencyBadge(ctx, cx, cy, `${forgeBalances.dust}`, 'dust', 26) + 8
    if (cx + 76 < x + w) {
      cx += drawCurrencyBadge(ctx, cx, cy, `${forgeBalances.shards}`, 'shards', 26) + 8
    }
  }
  if (!compact && cx + 106 < x + w) {
    drawCurrencyBadge(ctx, cx, cy, `${deckValue}g`, 'deck', 26)
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
  const prog = heroLevelProgress(o.hero.level, o.hero.xp)
  const lvText = `Lv.${prog.level}`
  if (o.token) {
    const ps = Math.min(w - 10, faceH - 20)
    const px = x + (w - ps) / 2
    drawPortraitTile(ctx, px, y + 3, ps, o.portrait, { ring: meta.hex, ringW: 2 })
    drawBar(ctx, px + 2, y + 3 + ps + 1.5, Math.max(8, ps - 4), 3.5, prog.ratio, prog.isMaxLevel ? COLOR.accent : COLOR.ap, COLOR.wellDeep)
    drawStars(ctx, x + w / 2, y + faceH - 6.5, o.hero.stars, 3, 8, 'center')
    drawChip(ctx, x + 3, y + 3, lvText, { h: 13, size: 7.5, color: '#a8f2ff', bg: '#102442e8', border: COLOR.outline })
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
      ctx.arc(x + w - 8, y + 20, 4.5, 0, Math.PI * 2)
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
  let rightUsed = 0
  if (o.inSquad) {
    rightUsed += drawChip(ctx, right, y + faceH * 0.28 - 8, 'SQUAD', { h: 16, size: 8, color: '#072e17', bg: COLOR.good, border: COLOR.outline, align: 'right' }) + 4
  }
  rightUsed += drawChip(ctx, right - rightUsed, y + faceH * 0.28 - 8, lvText, {
    h: 16,
    size: 8.5,
    color: prog.isMaxLevel ? COLOR.accentHi : '#8ef5ff',
    bg: '#132b4f',
    border: COLOR.outline,
    align: 'right'
  }) + 4
  drawText(ctx, o.spec.name, tx, y + faceH * 0.28, { size: 13, weight: 900, maxW: Math.max(12, right - tx - rightUsed), display: true, stroke: true, strokeWidth: 2 })
  const sw = drawStars(ctx, tx, y + faceH * 0.62, o.hero.stars, 3, 9)
  if (o.hero.stars < 3 && o.need > 0) {
    const bx = tx + sw + 7
    const bw = Math.max(0, right - bx - 30)
    if (bw > 16) drawBar(ctx, bx, y + faceH * 0.62 - 3, bw, 6, o.copies / o.need, o.readyMerge ? COLOR.accent : COLOR.ally)
    drawText(ctx, `${o.copies}/${o.need}`, right, y + faceH * 0.62 + 0.5, { size: 9.5, weight: 900, color: o.readyMerge ? COLOR.accentHi : COLOR.muted, align: 'right', display: true })
  } else {
    drawText(ctx, 'MAX', right, y + faceH * 0.62 + 0.5, { size: 9.5, weight: 900, color: COLOR.accentHi, align: 'right', display: true })
  }
  const xpBarW = Math.max(0, right - tx)
  if (xpBarW > 18) {
    drawBar(ctx, tx, y + faceH - 6.5, xpBarW, 4, prog.ratio, prog.isMaxLevel ? COLOR.accent : COLOR.ap, COLOR.wellDeep)
  }
  ctx.restore()
  if (st.focused) drawFocusRing(ctx, x, y, w, drawH, r)
}

export function drawHeroHeader(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: { name: string; title: string; stars: number; rarity: Rarity; power: number; portrait?: CanvasImageSource; inSquad: boolean; level?: number; xp?: number }
) {
  const meta = RARITY_META[o.rarity]
  const prog = heroLevelProgress(o.level, o.xp)
  const { x, y, width: w, height: h } = rect
  const ps = h
  drawPortraitTile(ctx, x, y, ps, o.portrait, { ring: meta.hex, ringW: 2.5, bg: '#3e598c' })
  const tx = x + ps + 12
  const powerW = 86
  const midRight = x + w - powerW
  const lvLabel = `Lv.${prog.level}`
  const lvW = drawChip(ctx, midRight, y + h * 0.24 - 8.5, lvLabel, {
    h: 17,
    size: 9.5,
    color: prog.isMaxLevel ? COLOR.accentHi : '#8ef5ff',
    bg: '#132b4f',
    border: COLOR.outline,
    align: 'right'
  })
  drawText(ctx, o.name, tx, y + h * 0.24, { size: 18, weight: 900, maxW: Math.max(20, midRight - tx - lvW - 6), display: true, stroke: true, strokeWidth: 3 })
  const sw = drawStars(ctx, tx, y + h * 0.58, o.stars, 3, 12)
  let cx = tx + sw + 8
  cx += drawChip(ctx, cx, y + h * 0.58 - 8.5, o.title, { h: 17, size: 9.5, color: '#ffffff', bg: '#2c3d66', border: COLOR.outline }) + 5
  if (cx + 64 < midRight) drawChip(ctx, cx, y + h * 0.58 - 8.5, meta.label, { h: 17, size: 9.5, color: meta.hex, bg: COLOR.wellDeep, border: COLOR.outline })

  // Compact XP progress bar + readout along the bottom edge of the inspector header
  const xpText = prog.isMaxLevel ? 'MAX LV' : `${prog.xp}/${prog.xpForNext} XP`
  const xpTextW = Math.round(measureText(ctx, xpText, 9, 800, true)) + 4
  const xpBarW = Math.max(0, midRight - tx - xpTextW - 6)
  if (xpBarW > 18) {
    drawBar(ctx, tx, y + h - 7, xpBarW, 5.5, prog.ratio, prog.isMaxLevel ? COLOR.accent : COLOR.ap, COLOR.wellDeep)
  }
  drawText(ctx, xpText, midRight, y + h - 4, {
    size: 9,
    weight: 800,
    color: prog.isMaxLevel ? COLOR.accentHi : '#8ef5ff',
    align: 'right',
    display: true
  })

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

export interface StatStripItem {
  readonly icon: IconName
  readonly label: string
  readonly value: string
  readonly color: string
  /** Optional live Armory hover stat delta (positive = upgrade, negative = downgrade). */
  readonly delta?: number
  /** Optional formatted delta badge (e.g. "▲+5", "▼-2", "▲+8%"). */
  readonly deltaText?: string
}

export function drawStatStrip(ctx: CanvasRenderingContext2D, rect: LayoutRect, stats: readonly StatStripItem[]) {
  const { x, y, width: w, height: h } = rect
  if (stats.length === 0) return
  const gap = stats.length >= 7 ? 5 : 6
  const cw = (w - gap * (stats.length - 1)) / stats.length
  const showLabel = cw >= 58
  stats.forEach((s, i) => {
    const cx = x + i * (cw + gap)
    const delta = s.delta ?? 0
    const hasDelta = delta !== 0
    const deltaColor = delta > 0 ? '#52f598' : '#ff6b7a'
    const deltaText = hasDelta
      ? (s.deltaText ?? (delta > 0 ? `▲+${delta}` : `▼${delta}`))
      : ''

    rr(ctx, cx, y, cw, h, RADIUS.sm)
    ctx.fillStyle = hasDelta ? (delta > 0 ? '#163528' : '#3a1824') : '#1f2b4a'
    ctx.fill()
    ctx.strokeStyle = hasDelta ? (delta > 0 ? COLOR.good : COLOR.danger) : COLOR.outline
    ctx.lineWidth = hasDelta ? 2 : 1.8
    ctx.stroke()

    if (showLabel) {
      drawIcon(ctx, s.icon, cx + 12, y + h / 2, 12.5, hasDelta ? deltaColor : s.color)
      const valX = cx + 23
      const rightX = cx + cw - 5
      if (hasDelta) {
        if (cw >= 82) {
          drawText(ctx, s.value, valX, y + h / 2 - (h >= 30 ? 5.5 : 0) + 0.5, {
            size: 12.5, weight: 900, maxW: Math.max(18, cw * 0.36), display: true, shadow: true
          })
          drawText(ctx, deltaText, rightX, y + h / 2 - (h >= 30 ? 5.5 : 0) + 0.5, {
            size: 10.5, weight: 900, color: deltaColor, align: 'right', maxW: Math.max(24, cw - 46), display: true, shadow: true
          })
          if (h >= 30) {
            drawText(ctx, s.label, valX, y + h / 2 + 8, {
              size: 8.5, weight: 800, color: COLOR.muted, upper: true, spacing: 0.6, maxW: cw - 28, display: true
            })
          }
        } else {
          drawText(ctx, s.value, valX, y + h * 0.32, {
            size: 11.5, weight: 900, maxW: cw - 26, display: true, shadow: true
          })
          drawText(ctx, deltaText, valX, y + h * 0.72, {
            size: 9.5, weight: 900, color: deltaColor, maxW: cw - 26, display: true, shadow: true
          })
        }
      } else {
        drawText(ctx, s.value, valX, y + h / 2 - (h >= 34 ? 6 : 0) + 0.5, { size: 13, weight: 900, maxW: cw - 28, display: true, shadow: true })
        if (h >= 34) drawText(ctx, s.label, valX, y + h / 2 + 8.5, { size: 8.5, weight: 800, color: COLOR.muted, upper: true, spacing: 0.6, maxW: cw - 28, display: true })
      }
    } else if (hasDelta) {
      drawText(ctx, s.value, cx + cw / 2, y + h * 0.30, { size: 10.5, weight: 900, align: 'center', maxW: cw - 4, display: true })
      drawText(ctx, deltaText, cx + cw / 2, y + h * 0.73, { size: 9, weight: 900, color: deltaColor, align: 'center', maxW: cw - 4, display: true, shadow: true })
    } else {
      drawIcon(ctx, s.icon, cx + cw / 2, y + h * 0.32, 11, s.color)
      drawText(ctx, s.value, cx + cw / 2, y + h * 0.72, { size: 11, weight: 900, align: 'center', maxW: cw - 4, display: true })
    }
  })
}

export function drawEquipCard(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: { slot: EquipSlot; spec?: EquipmentSpec; effect?: EquipEffectSpec; ownerText?: string; equippedOnSelected?: boolean },
  st: CanvasWidgetDrawState
) {
  const spec = o.spec
  const effect = o.effect ?? (spec ? getEquipEffect(spec.id) ?? undefined : undefined)
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
  const threeLine = Boolean(effect) && faceH >= 47
  const nameY = threeLine ? y + 11.5 : y + faceH / 2 - (twoLine ? 8 : 0)
  drawText(ctx, spec.name, tx, nameY, { size: 12, weight: 900, maxW: right - tx - tagW - 4, display: true, shadow: true })
  if (threeLine && effect) {
    drawText(ctx, spec.desc, tx, y + 25.5, { size: 9.5, weight: 600, color: COLOR.muted, maxW: right - tx })
    drawText(ctx, `★ ${effect.name}: ${effect.shortLabel}`, tx, y + 38.5, {
      size: 9.5,
      weight: 800,
      color: effect.accentHex,
      maxW: right - tx,
      display: true
    })
  } else if (twoLine) {
    const subText = effect ? `${spec.desc} · ★ ${effect.shortLabel}` : spec.desc
    drawText(ctx, subText, tx, y + faceH / 2 + 8.5, { size: 10, weight: 600, color: effect ? effect.accentHex : COLOR.muted, maxW: right - tx })
  }
  if (o.ownerText) {
    drawChip(ctx, right, threeLine ? y + 4 : y + faceH / 2 - (twoLine ? 16 : 8.5), fitWithin(ctx, o.ownerText, 56, 9.5), {
      h: 17,
      size: 9.5,
      color: o.ownerText === 'Bag' ? COLOR.muted : '#ffffff',
      bg: o.ownerText === 'Bag' ? COLOR.wellDeep : COLOR.allyDark,
      border: COLOR.outline,
      align: 'right'
    })
  } else if (on) {
    const chkY = threeLine ? y + 12 : y + faceH / 2 - (twoLine ? 8 : 0)
    ctx.beginPath()
    ctx.arc(right - 8, chkY, 8, 0, Math.PI * 2)
    ctx.fillStyle = COLOR.accent
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.6
    ctx.stroke()
    drawIcon(ctx, 'check', right - 8, chkY, 9, COLOR.accentText)
  }
  drawCornerRibbon(ctx, x, y, w, faceH + 1, r, meta?.hex ?? '#888', 13)
  ctx.restore()
  if (st.focused) drawFocusRing(ctx, x, y, w, drawH, r)
}

/**
 * Live Armory equipment comparison dock showing candidate vs current slot (or Empty Slot),
 * cross-hero swap notice, net power delta, and green/red ▲/▼ stat diffs across all 7 stats.
 */
export function drawArmoryStatDiffPanel(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  diff: EquipmentStatDiff
) {
  const { x, y, width: w, height: h } = rect
  if (w < 40 || h < 34) return

  const candMeta = RARITY_META[diff.candidateRarity]
  const rimColor = diff.isAlreadyEquipped
    ? COLOR.accent
    : diff.netPowerDelta > 0
      ? COLOR.good
      : diff.netPowerDelta < 0
        ? COLOR.danger
        : COLOR.borderHi

  ctx.save()
  drawSurface(ctx, rect, {
    r: RADIUS.md,
    lipH: 3,
    fill: '#233054',
    fillBot: '#151d36',
    rim: rimColor + '88',
    border: COLOR.outline,
    glow: diff.isAlreadyEquipped ? undefined : rimColor + '33'
  })

  // Crisp inner colored border highlight
  rr(ctx, x + 2, y + 2, w - 4, h - 5, Math.max(2, RADIUS.md - 2))
  ctx.strokeStyle = rimColor + 'aa'
  ctx.lineWidth = 1.4
  ctx.stroke()

  const padX = w < 420 ? 8 : 10
  const padY = h < 60 ? 5 : 6
  const innerW = w - padX * 2
  const headerH = h < 60 ? 18 : 20
  const headerCy = y + padY + headerH / 2

  // Right-aligned Power delta badge (+ optional cross-hero swap pill)
  let rightCursor = x + w - padX
  const pwrText = diff.isAlreadyEquipped
    ? 'EQUIPPED'
    : diff.netPowerDelta > 0
      ? `▲ +${diff.netPowerDelta} PWR`
      : diff.netPowerDelta < 0
        ? `▼ ${diff.netPowerDelta} PWR`
        : '±0 PWR'
  const pwrColor = diff.isAlreadyEquipped
    ? COLOR.accentHi
    : diff.netPowerDelta > 0
      ? '#52f598'
      : diff.netPowerDelta < 0
        ? '#ff6b7a'
        : COLOR.muted
  const pwrBg = diff.isAlreadyEquipped
    ? '#382a14'
    : diff.netPowerDelta > 0
      ? '#123824'
      : diff.netPowerDelta < 0
        ? '#3f1520'
        : COLOR.wellDeep
  const pwrW = drawChip(ctx, rightCursor, headerCy - 9, pwrText, {
    h: 18,
    size: 9.5,
    color: pwrColor,
    bg: pwrBg,
    border: diff.isAlreadyEquipped ? COLOR.accent : diff.netPowerDelta !== 0 ? pwrColor : COLOR.outline,
    align: 'right'
  })
  rightCursor -= pwrW + 6

  if (diff.currentOwnerName && w >= 420) {
    const swapLabel = `⇄ Held by ${diff.currentOwnerName}`
    const swapW = drawChip(ctx, rightCursor, headerCy - 9, swapLabel, {
      h: 18,
      size: 9,
      color: '#ffe299',
      bg: '#382c16',
      border: '#d99a26',
      align: 'right'
    })
    rightCursor -= swapW + 6
  }

  // Left side: Slot badge + "Comparing: Candidate vs Current (or Empty Slot)"
  let leftCursor = x + padX
  const slotW = drawChip(ctx, leftCursor, headerCy - 9, diff.slot.toUpperCase(), {
    h: 18,
    size: 9,
    color: candMeta.hex,
    bg: COLOR.wellDeep,
    border: candMeta.hex + '99'
  })
  leftCursor += slotW + 7

  const vsLabel = diff.currentItemName ?? 'Empty Slot'
  const headerText = diff.isAlreadyEquipped
    ? `Equipped: ${diff.candidateName} (${diff.heroName})`
    : diff.currentOwnerName && w < 420
      ? `${diff.candidateName} vs ${vsLabel} (⇄ ${diff.currentOwnerName})`
      : `Comparing: ${diff.candidateName} vs ${vsLabel}`
  const headerMaxW = Math.max(40, rightCursor - leftCursor)
  drawText(ctx, headerText, leftCursor, headerCy + 0.5, {
    size: w < 420 ? 10.5 : 11.5,
    weight: 800,
    color: COLOR.text,
    maxW: headerMaxW,
    display: true,
    shadow: true
  })

  // Stat-diff grid across all 7 stats: ATK, DEF, HP, SPD, MOVE, RANGE, CRIT
  const statsY = y + padY + headerH + (h < 60 ? 3 : 4)
  const statsH = Math.max(20, y + h - 5 - statsY)
  const twoRow = w < 520 && statsH >= 38

  const drawStatRow = (
    items: readonly (typeof ARMORY_STAT_ORDER)[number][],
    rowY: number,
    rowH: number
  ) => {
    const gap = w < 460 ? 4 : 5
    const availW = innerW - gap * (items.length - 1)
    let totalWeight = 0
    for (const meta of items) {
      const entry = diff.stats[meta.key]
      totalWeight += entry.delta !== 0 ? 1.55 : 0.78
    }
    let sx = x + padX
    for (const meta of items) {
      const entry = diff.stats[meta.key]
      const changed = entry.delta !== 0
      const weight = changed ? 1.55 : 0.78
      const cellW = (availW * weight) / totalWeight
      const positive = entry.delta > 0
      const cellBg = changed ? (positive ? '#143828' : '#3d1623') : '#12192d'
      const cellBorder = changed ? (positive ? COLOR.good : COLOR.danger) : '#2a3759'
      const arrowColor = positive ? '#52f598' : '#ff6b7a'

      rr(ctx, sx, rowY, cellW, rowH, RADIUS.xs)
      ctx.fillStyle = cellBg
      ctx.fill()
      ctx.strokeStyle = cellBorder
      ctx.lineWidth = changed ? 1.6 : 1.1
      ctx.stroke()

      const statLabel = cellW < 62 ? meta.shortLabel : meta.label
      if (changed) {
        const deltaStr = formatStatDelta(entry.delta, meta.isPercent, true)
        const showBeforeAfter = cellW >= 112
        const cy = rowY + rowH / 2 + 0.5
        if (cellW >= 78) {
          drawText(ctx, statLabel, sx + 6, cy, {
            size: 9,
            weight: 900,
            color: '#d9e6ff',
            display: true
          })
          const textRight = sx + cellW - 6
          if (showBeforeAfter) {
            const afterStr = `${formatStatValue(entry.before, meta.isPercent)}→${formatStatValue(entry.after, meta.isPercent)}`
            drawText(ctx, `${deltaStr} (${afterStr})`, textRight, cy, {
              size: 10,
              weight: 900,
              color: arrowColor,
              align: 'right',
              maxW: cellW - 42,
              display: true,
              shadow: true
            })
          } else {
            drawText(ctx, deltaStr, textRight, cy, {
              size: 10.5,
              weight: 900,
              color: arrowColor,
              align: 'right',
              maxW: cellW - 36,
              display: true,
              shadow: true
            })
          }
        } else {
          drawText(ctx, statLabel, sx + cellW / 2, rowY + rowH * 0.30, {
            size: 8,
            weight: 800,
            color: '#d9e6ff',
            align: 'center',
            maxW: cellW - 4,
            display: true
          })
          drawText(ctx, deltaStr, sx + cellW / 2, rowY + rowH * 0.72, {
            size: 9.5,
            weight: 900,
            color: arrowColor,
            align: 'center',
            maxW: cellW - 4,
            display: true,
            shadow: true
          })
        }
      } else {
        // Compact, muted zero-delta cell
        if (cellW >= 54) {
          const cy = rowY + rowH / 2 + 0.5
          drawText(ctx, statLabel, sx + 5, cy, {
            size: 8.5,
            weight: 700,
            color: COLOR.faint,
            display: true
          })
          drawText(ctx, '0', sx + cellW - 5, cy, {
            size: 9.5,
            weight: 700,
            color: '#5f7099',
            align: 'right',
            display: true
          })
        } else {
          drawText(ctx, statLabel, sx + cellW / 2, rowY + rowH * 0.34, {
            size: 7.5,
            weight: 700,
            color: COLOR.faint,
            align: 'center',
            maxW: cellW - 3,
            display: true
          })
          drawText(ctx, '0', sx + cellW / 2, rowY + rowH * 0.72, {
            size: 8.5,
            weight: 700,
            color: '#5f7099',
            align: 'center',
            display: true
          })
        }
      }
      sx += cellW + gap
    }
  }

  if (twoRow) {
    const rowGap = 4
    const rowH = Math.floor((statsH - rowGap) / 2)
    drawStatRow(ARMORY_STAT_ORDER.slice(0, 4), statsY, rowH)
    drawStatRow(ARMORY_STAT_ORDER.slice(4), statsY + rowH + rowGap, rowH)
  } else {
    drawStatRow(ARMORY_STAT_ORDER, statsY, statsH)
  }

  ctx.restore()
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

/** Innate Hero Passive banner for Camp Hero Inspector. */
export function drawPassiveBanner(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  passive: HeroPassiveSpec,
  compact = false
) {
  const { x, y, width: w, height: h } = rect
  drawSurface(ctx, rect, {
    r: RADIUS.md,
    lipH: 2,
    fill: '#2b3d66',
    fillBot: '#1b2644',
    rim: passive.accentHex + 'aa',
    shadow: false
  })
  const faceH = Math.max(8, h - 2)
  // Colored left accent strip
  rr(ctx, x + 2, y + 4, 4, Math.max(6, faceH - 8), 2)
  ctx.fillStyle = passive.accentHex
  ctx.fill()

  const twoLine = !compact && faceH >= 34
  const tx = x + 12
  if (twoLine) {
    const chipW = drawChip(ctx, tx, y + 4, 'INNATE', {
      h: 15,
      size: 8,
      color: COLOR.accentText,
      bg: passive.accentHex,
      border: COLOR.outline
    })
    drawText(ctx, passive.name, tx + chipW + 6, y + 12, {
      size: 11.5,
      weight: 900,
      color: '#ffffff',
      maxW: Math.max(30, w - chipW - 24),
      display: true,
      shadow: true
    })
    drawText(ctx, passive.desc, tx, y + 28, {
      size: 10,
      weight: 600,
      color: '#d4e2ff',
      maxW: Math.max(30, w - 18)
    })
  } else {
    const chipW = drawChip(ctx, tx, y + (faceH - 15) / 2, 'INNATE', {
      h: 15,
      size: 8,
      color: COLOR.accentText,
      bg: passive.accentHex,
      border: COLOR.outline
    })
    const label = `${passive.name} · ${passive.shortLabel}`
    drawText(ctx, label, tx + chipW + 6, y + faceH / 2 + 0.5, {
      size: 10.5,
      weight: 800,
      color: '#e8f0ff',
      maxW: Math.max(30, w - chipW - 22),
      display: true
    })
  }
}

/** Curated Tactic Deck Builder header showing Deck: N/12 and AP cost curve. */
export function drawTacticDeckHeader(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  curve: TacticDeckCurve,
  ownedCount: number
) {
  const { x, y, width: w, height: h } = rect
  const cy = y + h / 2
  const healthy = curve.total >= RECOMMENDED_MIN_TACTIC_DECK && curve.total <= curve.max
  const deckColor = healthy ? COLOR.good : COLOR.accentHi

  let cx = x + 2
  cx += drawChip(ctx, cx, cy - 11, `DECK: ${curve.total} / ${curve.max}`, {
    h: 22,
    size: 10.5,
    color: healthy ? '#072e17' : COLOR.accentText,
    bg: deckColor,
    border: COLOR.outline
  }) + 8

  if (cx + 78 < x + w) {
    cx += drawChip(ctx, cx, cy - 10, `OWNED ${ownedCount}`, {
      h: 20,
      size: 9.5,
      color: COLOR.muted,
      bg: COLOR.wellDeep,
      border: COLOR.outline
    }) + 6
  }
  if (cx + 80 < x + w) {
    cx += drawChip(ctx, cx, cy - 10, `AVG ${curve.avgCost.toFixed(1)} AP`, {
      h: 20,
      size: 9.5,
      color: COLOR.ap,
      bg: '#14294a',
      border: COLOR.outline
    }) + 8
  }

  // AP curve pills [0 AP, 1 AP, 2+ AP]
  const buckets: readonly [string, number, string][] = [
    ['0 AP', curve.byCost[0], '#6ee09e'],
    ['1 AP', curve.byCost[1], '#69c2ff'],
    ['2+ AP', curve.byCost[2], '#d482ff']
  ]
  for (const [lbl, cnt, col] of buckets) {
    const label = `${lbl}: ${cnt}`
    const estW = measureText(ctx, label, 9, 800, true) + 14
    if (cx + estW > x + w - 4) break
    cx += drawChip(ctx, cx, cy - 9.5, label, {
      h: 19,
      size: 9,
      color: col,
      bg: COLOR.wellDeep,
      border: COLOR.outline
    }) + 5
  }
}

/** Curated Tactic Deck toggleable card row in Camp. */
export function drawTacticDeckCard(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: { spec: TacticCardSpec; inDeck: boolean },
  st: CanvasWidgetDrawState
) {
  const meta = RARITY_META[o.spec.rarity]
  const { x, width: w, height: h } = rect
  const pressed = st.pressed
  const y = rect.y + (pressed ? 2 : 0)
  const drawH = Math.max(12, h - (pressed ? 2 : 0))
  const hot = st.hovered || st.focused
  const r = RADIUS.md

  ctx.save()
  drawSurface(ctx, { x, y, width: w, height: drawH }, {
    r,
    lipH: pressed ? 1 : 3,
    fill: o.inDeck ? (hot ? '#425d94' : '#334a7a') : (hot ? '#2d3b5e' : '#202b47'),
    fillBot: o.inDeck ? '#23355c' : '#161e36',
    rim: o.inDeck ? COLOR.good + 'aa' : '#ffffff1c',
    shadow: false
  })
  if (o.inDeck) {
    rr(ctx, x + 2, y + 2, w - 4, drawH - 4, Math.max(1, r - 2))
    ctx.strokeStyle = COLOR.good
    ctx.lineWidth = 2
    ctx.stroke()
  }

  const faceH = drawH - (pressed ? 1 : 3)
  const cy = y + faceH / 2
  // AP crystal on left
  drawApCrystal(ctx, x + 20, cy, Math.min(13, faceH * 0.32), true, `${o.spec.cost}`)

  const tx = x + 38
  const right = x + w - 9
  const badgeText = o.inDeck ? 'IN DECK' : 'BENCH'
  const badgeW = 58
  const twoLine = faceH >= 40
  drawText(ctx, o.spec.name, tx, twoLine ? y + faceH * 0.34 : cy, {
    size: 12,
    weight: 900,
    color: o.inDeck ? '#ffffff' : COLOR.muted,
    maxW: Math.max(40, right - tx - badgeW - 6),
    display: true,
    shadow: o.inDeck
  })
  if (twoLine) {
    drawText(ctx, o.spec.desc, tx, y + faceH * 0.72, {
      size: 9.5,
      weight: 600,
      color: o.inDeck ? '#d2e0ff' : COLOR.faint,
      maxW: Math.max(40, right - tx - 4)
    })
  }
  drawChip(ctx, right, twoLine ? y + 6 : cy - 8.5, badgeText, {
    h: 17,
    size: 8.5,
    color: o.inDeck ? '#072e17' : COLOR.muted,
    bg: o.inDeck ? COLOR.good : COLOR.wellDeep,
    border: COLOR.outline,
    align: 'right'
  })
  drawCornerRibbon(ctx, x, y, w, faceH + 1, r, meta.hex, 12)
  ctx.restore()
  if (st.focused) drawFocusRing(ctx, x, y, w, drawH, r)
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
    convertedShards?: number
    pityTriggered?: 'epic' | 'legendary'
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
  drawParagraph(ctx, o.detail, x + 10, bannerY + 36, w - 20, y + h - bannerY - 58, {
    size: 10,
    weight: o.convertedShards ? 900 : 700,
    color: o.convertedShards ? '#9ceeff' : '#d8e3ff',
    align: 'center',
    lineHeight: 12.5
  })

  // Bottom value / shard conversion badge
  if (o.convertedShards && o.convertedShards > 0) {
    drawChip(ctx, x + w / 2, y + h - 22, `+${o.convertedShards} SHARDS`, {
      icon: 'gem', h: 18, size: 9.5, color: '#9ceeff', bg: '#152b4a', border: COLOR.outline, align: 'center'
    })
  } else {
    drawChip(ctx, x + w / 2, y + h - 22, `${o.value}g`, { icon: 'coin', h: 18, size: 10, color: COLOR.accentHi, bg: COLOR.wellDeep, border: COLOR.outline, align: 'center' })
  }

  drawCornerRibbon(ctx, x, y, w, h, r, meta.hex, 22)
  rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1))
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2.4
  ctx.stroke()

  let badgeY = y + 8
  if (o.convertedShards && o.convertedShards > 0) {
    drawChip(ctx, x + 8, badgeY, 'MAX ★', { h: 18, size: 9, color: '#072236', bg: '#7ae7ff', border: COLOR.outline })
    badgeY += 20
  } else if (o.isNew) {
    drawChip(ctx, x + 8, badgeY, 'NEW', { h: 18, size: 9.5, color: COLOR.accentText, bg: COLOR.accentHi, border: COLOR.outline })
    badgeY += 20
  }
  if (o.pityTriggered) {
    const pityColor = o.pityTriggered === 'legendary' ? '#ffcb57' : '#d79eff'
    drawChip(ctx, x + 8, badgeY, 'PITY', {
      h: 17, size: 8.5, color: o.pityTriggered === 'legendary' ? COLOR.accentText : '#1e0b36', bg: pityColor, border: COLOR.outline
    })
  }
  ctx.restore()
}

/**
 * Visible Pack Pity Counter banner showing remaining packs until guaranteed Epic+ and Legendary drops
 * with crisp segmented progress bars.
 */
export function drawPityBanner(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  pity: PackPityStatus,
  compact = false
) {
  const { x, y, width: w, height: h } = rect
  if (w < 40 || h < 18) return

  const epicRatio = Math.max(0, Math.min(1, pity.packsSinceEpic / EPIC_PITY_THRESHOLD))
  const legRatio = Math.max(0, Math.min(1, pity.packsSinceLegendary / LEGENDARY_PITY_THRESHOLD))
  const epicHot = pity.epicIn <= 1
  const legHot = pity.legendaryIn <= 1

  ctx.save()
  drawSurface(ctx, rect, {
    r: RADIUS.md,
    lipH: 2,
    fill: '#232d52',
    fillBot: '#151c36',
    rim: legHot ? '#ffcb5788' : epicHot ? '#c87dff88' : '#7590c844',
    shadow: false
  })

  const padX = compact ? 10 : 14
  const epicWord = pity.epicIn === 1 ? 'pack' : 'packs'
  const legWord = pity.legendaryIn === 1 ? 'pack' : 'packs'
  const headline = compact
    ? `Epic in ${pity.epicIn} ${epicWord} · Leg in ${pity.legendaryIn} ${legWord}`
    : `Pity Guarantee: Epic in ${pity.epicIn} ${epicWord} · Legendary in ${pity.legendaryIn} ${legWord}`

  const barRowY = y + h - 14
  const headlineY = y + (h >= 36 ? 12 : h * 0.34)
  drawText(ctx, headline, x + padX, headlineY, {
    size: compact ? 10 : 11,
    weight: 900,
    color: legHot ? '#ffe078' : epicHot ? '#e5bfff' : '#dce6ff',
    maxW: w - padX * 2,
    display: true,
    shadow: true
  })

  const halfGap = compact ? 10 : 18
  const colW = Math.max(40, (w - padX * 2 - halfGap) / 2)
  const labelW = compact ? 52 : 76

  // Epic segmented meter
  const ex = x + padX
  drawText(ctx, compact ? `EP ${pity.packsSinceEpic}/${EPIC_PITY_THRESHOLD}` : `EPIC ${pity.packsSinceEpic}/${EPIC_PITY_THRESHOLD}`, ex, barRowY + 4, {
    size: 9.5,
    weight: 900,
    color: epicHot ? '#f0ccff' : '#c87dff',
    display: true,
    maxW: labelW
  })
  const eBarW = Math.max(24, colW - labelW - 4)
  drawBar(ctx, ex + labelW + 2, barRowY, eBarW, 8, epicRatio, '#c87dff', COLOR.wellDeep, Math.min(10, EPIC_PITY_THRESHOLD))

  // Legendary segmented meter
  const lx = ex + colW + halfGap
  drawText(ctx, compact ? `LG ${pity.packsSinceLegendary}/${LEGENDARY_PITY_THRESHOLD}` : `LEG ${pity.packsSinceLegendary}/${LEGENDARY_PITY_THRESHOLD}`, lx, barRowY + 4, {
    size: 9.5,
    weight: 900,
    color: legHot ? '#fff0a6' : '#ffcb57',
    display: true,
    maxW: labelW
  })
  const lBarW = Math.max(24, colW - labelW - 4)
  drawBar(ctx, lx + labelW + 2, barRowY, lBarW, 8, legRatio, '#ffcb57', COLOR.wellDeep, 8)

  ctx.restore()
}

/** Armory Forge currency strip showing current Arcane Dust and Hero Shards balances. */
export function drawForgeBalanceBanner(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  dust: number,
  shards: number,
  compact = false
) {
  const { x, y, width: w, height: h } = rect
  if (w < 40 || h < 20) return
  const cy = y + h / 2

  ctx.save()
  drawSurface(ctx, rect, {
    r: RADIUS.md,
    lipH: 2,
    fill: '#232e54',
    fillBot: '#151c36',
    rim: '#8c69d666',
    shadow: false
  })

  let cx = x + 8
  const badgeH = Math.min(26, h - 6)
  cx += drawCurrencyBadge(ctx, cx, cy, compact ? `${dust}` : `${dust} Dust`, 'dust', badgeH) + 8
  cx += drawCurrencyBadge(ctx, cx, cy, compact ? `${shards}` : `${shards} Shards`, 'shards', badgeH) + 10

  const remW = x + w - cx - 10
  if (!compact && remW > 120) {
    drawText(ctx, 'Salvage gear → Dust · Heroes / Max ★ → Shards', cx, cy + 0.5, {
      size: 10,
      weight: 700,
      color: COLOR.muted,
      maxW: remW
    })
  }
  ctx.restore()
}

/** Armory Forge craftable Hero / Equipment recipe card. */
export function drawForgeRecipeCard(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: {
    kind: 'hero' | EquipSlot
    rarity: Rarity
    name: string
    subtitle: string
    refId: string
    accentHex?: string
    portrait?: CanvasImageSource
    ownedCount: number
    maxed?: boolean
    cost: number
    currency: 'dust' | 'shards'
    affordable: boolean
  },
  st?: CanvasWidgetDrawState
) {
  const meta = RARITY_META[o.rarity]
  const { x, y, width: w, height: h } = rect
  const hot = Boolean(st?.hovered || st?.focused)
  const r = RADIUS.md

  ctx.save()
  drawSurface(ctx, rect, {
    r,
    lipH: 3,
    fill: hot ? '#3a4d7a' : '#2a385e',
    fillBot: '#1c2642',
    rim: o.affordable ? meta.hex + '66' : '#ffffff14',
    shadow: false
  })

  const faceH = h - 3
  const is = Math.min(faceH - 10, 38)
  const ix = x + 6
  const iy = y + (faceH - is) / 2

  if (o.kind === 'hero') {
    drawPortraitTile(ctx, ix, iy, is, o.portrait, { ring: meta.hex, ringW: 2, r: 8 })
  } else {
    rr(ctx, ix, iy, is, is, RADIUS.sm)
    const ig = ctx.createLinearGradient(0, iy, 0, iy + is)
    ig.addColorStop(0, meta.hex + 'aa')
    ig.addColorStop(1, '#141c33')
    ctx.fillStyle = ig
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.8
    ctx.stroke()
    drawEquipIcon(ctx, o.kind, o.refId, o.accentHex ?? meta.hex, ix + is / 2, iy + is / 2, is * 0.36)
  }

  const tx = ix + is + 9
  const right = x + w - 10
  const statusText = o.maxed ? 'MAX ★' : o.ownedCount > 0 ? `Owned x${o.ownedCount}` : 'Unowned'
  const statusColor = o.maxed ? '#7ae7ff' : o.ownedCount > 0 ? '#b8ffd6' : COLOR.accentHi
  const statusBg = o.maxed ? '#13314a' : o.ownedCount > 0 ? '#143627' : '#362712'
  const statusW = Math.min(72, measureText(ctx, statusText, 9, 800, true) + 14)

  const twoLine = faceH >= 40
  drawText(ctx, o.name, tx, y + faceH / 2 - (twoLine ? 8 : 0), {
    size: 12,
    weight: 900,
    color: '#ffffff',
    maxW: Math.max(30, right - tx - statusW - 44),
    display: true,
    shadow: true
  })

  // Rarity pill right next to status chip
  const chipY = y + faceH / 2 - (twoLine ? 16 : 8)
  const sw = drawChip(ctx, right, chipY, statusText, {
    h: 16, size: 8.5, color: statusColor, bg: statusBg, border: COLOR.outline, align: 'right'
  })
  drawChip(ctx, right - sw - 4, chipY, meta.short, {
    h: 16, size: 8.5, color: meta.hex, bg: COLOR.wellDeep, border: COLOR.outline, align: 'right'
  })

  if (twoLine) {
    drawText(ctx, o.subtitle, tx, y + faceH / 2 + 8.5, {
      size: 10,
      weight: 600,
      color: COLOR.muted,
      maxW: Math.max(40, right - tx)
    })
  }

  drawCornerRibbon(ctx, x, y, w, faceH + 1, r, meta.hex, 12)
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
  } else if (tacticId === 'phoenix_sigil') {
    bg.addColorStop(0, '#a64d14')
    bg.addColorStop(1, '#2b100c')
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
  } else if (tacticId === 'gale_gust') {
    bg.addColorStop(0, '#1c7c85')
    bg.addColorStop(1, '#0a202c')
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
  } else if (tacticId === 'gale_gust') {
    // Roaring cyan-white cyclone vortex + surging horizontal knockback chevrons
    ctx.beginPath()
    ctx.arc(cx, cy, s * 0.78, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(72, 236, 224, 0.18)'
    ctx.fill()

    // Sweeping gale streams
    ctx.lineCap = 'round'
    for (let i = -1; i <= 1; i++) {
      const yOff = i * s * 0.34
      ctx.strokeStyle = i === 0 ? '#e6ffff' : '#6ef5ea'
      ctx.lineWidth = i === 0 ? 2.6 : 1.9
      ctx.beginPath()
      ctx.moveTo(cx - s * 0.88, cy + yOff + s * 0.1)
      ctx.bezierCurveTo(
        cx - s * 0.28,
        cy + yOff - s * 0.28,
        cx + s * 0.15,
        cy + yOff + s * 0.24,
        cx + s * 0.62,
        cy + yOff - s * 0.04
      )
      ctx.stroke()
    }

    // Twin forward-push wind chevrons (conveying 2-tile knockback!)
    for (let k = 0; k < 2; k++) {
      const ax = cx + s * (0.28 + k * 0.32)
      ctx.strokeStyle = k === 1 ? '#ffffff' : '#9cfcf2'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.moveTo(ax - s * 0.2, cy - s * 0.32)
      ctx.lineTo(ax + s * 0.12, cy)
      ctx.lineTo(ax - s * 0.2, cy + s * 0.32)
      ctx.stroke()
    }

    // Swirling breeze motes
    for (const [mx, my, mr] of [[-0.56, -0.44, 2.2], [0.05, -0.52, 2.5], [-0.42, 0.48, 2.0], [0.46, 0.46, 1.9]]) {
      ctx.beginPath()
      ctx.arc(cx + mx * s, cy + my * s, mr, 0, Math.PI * 2)
      ctx.fillStyle = '#c8fffb'
      ctx.fill()
    }
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
  } else if (tacticId === 'taunt_banner') {
    // Vanguard Challenge: crimson-gold aggro crest & radiating battle ring
    ctx.beginPath()
    ctx.arc(cx, cy, s * 0.78, 0, Math.PI * 2)
    ctx.strokeStyle = '#ff6d52'
    ctx.lineWidth = 2.2
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, cy - s * 0.72)
    ctx.lineTo(cx + s * 0.54, cy - s * 0.42)
    ctx.lineTo(cx + s * 0.44, cy + s * 0.24)
    ctx.lineTo(cx, cy + s * 0.74)
    ctx.lineTo(cx - s * 0.44, cy + s * 0.24)
    ctx.lineTo(cx - s * 0.54, cy - s * 0.42)
    ctx.closePath()
    const tg = ctx.createLinearGradient(cx, cy - s * 0.7, cx, cy + s * 0.7)
    tg.addColorStop(0, '#ff7354')
    tg.addColorStop(0.55, '#b82525')
    tg.addColorStop(1, '#5e1118')
    ctx.fillStyle = tg
    ctx.fill()
    ctx.strokeStyle = '#ffdb73'
    ctx.lineWidth = 2
    ctx.stroke()
    drawStarShape(ctx, cx, cy - s * 0.04, s * 0.28, s * 0.12, 4)
    ctx.fillStyle = '#fff0a6'
    ctx.fill()
  } else if (tacticId === 'venom_vial') {
    // Venom Flask: bubbling acid-green & toxic-violet alchemical bottle
    ctx.beginPath()
    ctx.arc(cx, cy + s * 0.16, s * 0.62, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(130, 255, 72, 0.22)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy + s * 0.20, s * 0.48, 0, Math.PI * 2)
    const vg = ctx.createRadialGradient(cx - s * 0.12, cy + s * 0.08, s * 0.05, cx, cy + s * 0.2, s * 0.52)
    vg.addColorStop(0, '#e0ff8c')
    vg.addColorStop(0.55, '#68d92e')
    vg.addColorStop(1, '#265c14')
    ctx.fillStyle = vg
    ctx.fill()
    ctx.strokeStyle = '#d49eff'
    ctx.lineWidth = 1.8
    ctx.stroke()
    rr(ctx, cx - s * 0.16, cy - s * 0.54, s * 0.32, s * 0.34, 3)
    ctx.fillStyle = '#c8f0c0'
    ctx.fill()
    ctx.strokeStyle = '#1d3616'
    ctx.lineWidth = 1.4
    ctx.stroke()
    for (const [bx, by, br, col] of [[-0.42, -0.34, 3.2, '#a3ff5c'], [0.44, -0.42, 2.8, '#c578ff'], [0.24, -0.68, 2.2, '#b8ff7a']] as const) {
      ctx.beginPath()
      ctx.arc(cx + bx * s, cy + by * s, br, 0, Math.PI * 2)
      ctx.fillStyle = col
      ctx.fill()
    }
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
  if (tacticId === 'phoenix_sigil') {
    // Rising phoenix feather wings framing the radiant sun core
    ctx.beginPath()
    ctx.moveTo(cx, cy + s * 0.35)
    ctx.quadraticCurveTo(cx - s * 0.85, cy + s * 0.05, cx - s * 0.72, cy - s * 0.62)
    ctx.quadraticCurveTo(cx - s * 0.25, cy - s * 0.22, cx, cy - s * 0.68)
    ctx.quadraticCurveTo(cx + s * 0.25, cy - s * 0.22, cx + s * 0.72, cy - s * 0.62)
    ctx.quadraticCurveTo(cx + s * 0.85, cy + s * 0.05, cx, cy + s * 0.35)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255, 196, 72, 0.86)'
    ctx.fill()
    ctx.strokeStyle = '#fff4c2'
    ctx.lineWidth = 1.5
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

// ===========================================================================
// WORLD MAP OVERWORLD & STAGE NODES
// ===========================================================================

function hash1(n: number): number {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return v - Math.floor(v)
}

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return 1 - (1 - c) * (1 - c) * (1 - c)
}

function easeOutBack(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2)
}

const BIOME_MAP_COLOR: Record<ChapterSpec['biome'], { readonly fill: string; readonly ring: string; readonly label: string }> = {
  meadow: { fill: '#3f8a4b', ring: '#7be078', label: 'Meadow' },
  river: { fill: '#2c7699', ring: '#6cd9ff', label: 'River' },
  crypt: { fill: '#48406e', ring: '#9f87ff', label: 'Crypt' },
  frost: { fill: '#4a81ad', ring: '#a8ecff', label: 'Frost' },
  volcano: { fill: '#8c3728', ring: '#ff8a4c', label: 'Volcano' },
  throne: { fill: '#572770', ring: '#e878ff', label: 'Throne' }
}

export function drawDifficultyBadge(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  difficulty: DifficultyLevel,
  opts: { align?: 'left' | 'right' | 'center'; h?: number; showLabel?: boolean } = {}
) {
  const meta = DIFFICULTY_META[difficulty]
  const h = opts.h ?? 22
  const pipCount = 5
  const pipR = h * 0.19
  const pipGap = pipR * 2.5
  const isBeyond = difficulty > 5
  const pipsW = isBeyond ? h * 0.72 : pipCount * pipGap + 2
  const labelText = opts.showLabel ? `${meta.label} (${meta.short})` : `TIER ${meta.short}`
  const textW = measureText(ctx, labelText, Math.round(h * 0.48), 900, true)
  const w = Math.round(textW + pipsW + 22)
  const left = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x

  ctx.save()
  rr(ctx, left, y, w, h, h / 2)
  ctx.fillStyle = meta.bgHex
  ctx.fill()
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 2
  ctx.stroke()
  rr(ctx, left + 1.5, y + 1.5, w - 3, h - 3, Math.max(2, h / 2 - 1.5))
  ctx.strokeStyle = meta.hex + '88'
  ctx.lineWidth = 1.2
  ctx.stroke()

  const cy = y + h / 2
  if (isBeyond) {
    drawIcon(ctx, difficulty >= 8 ? 'crown' : 'skull', left + 10 + pipsW * 0.4, cy, h * 0.58, meta.hex)
  } else {
    for (let i = 0; i < pipCount; i++) {
      const px = left + 10 + i * pipGap + pipR
      ctx.beginPath()
      ctx.arc(px, cy, pipR, 0, Math.PI * 2)
      ctx.fillStyle = i < difficulty ? meta.hex : '#131a2e'
      ctx.fill()
      ctx.strokeStyle = COLOR.outline
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
  }
  drawText(ctx, labelText, left + 14 + pipsW, cy + 0.5, {
    size: Math.round(h * 0.48),
    weight: 900,
    color: meta.hex,
    display: true
  })
  ctx.restore()
  return w
}

export const WORLD_MAP_W = 2200
export const WORLD_MAP_H = 1360

export interface WorldMapViewport {
  readonly panX: number // normalized center X (0..1)
  readonly panY: number // normalized center Y (0..1)
  readonly zoom: number // 0.62..1.75 (1 = fit width nicely)
}

export function worldMapScale(rect: LayoutRect, zoom: number): number {
  const base = Math.max(rect.width / WORLD_MAP_W, rect.height / WORLD_MAP_H)
  return base * zoom
}

export function worldMapToScreen(
  mapX: number,
  mapY: number,
  rect: LayoutRect,
  vp: WorldMapViewport
): { x: number; y: number } {
  const scale = worldMapScale(rect, vp.zoom)
  const cx = rect.x + rect.width * 0.5
  const cy = rect.y + rect.height * 0.5
  return {
    x: cx + (mapX - vp.panX) * WORLD_MAP_W * scale,
    y: cy + (mapY - vp.panY) * WORLD_MAP_H * scale
  }
}

// Sculpted Solis Mainland + outer future-frontier landmasses/archipelagos.
type MapPoly = readonly (readonly [number, number])[]

const SOLIS_MAINLAND: MapPoly = [
  [0.048, 0.34], [0.072, 0.24], [0.115, 0.18], [0.165, 0.13], [0.225, 0.11],
  [0.295, 0.12], [0.355, 0.16], [0.415, 0.13], [0.455, 0.08], [0.525, 0.07],
  [0.605, 0.08], [0.685, 0.08], [0.735, 0.13], [0.715, 0.21], [0.685, 0.28],
  [0.735, 0.35], [0.745, 0.43], [0.715, 0.50], [0.760, 0.57], [0.745, 0.66],
  [0.685, 0.70], [0.615, 0.72], [0.545, 0.75], [0.475, 0.79], [0.415, 0.81],
  [0.345, 0.77], [0.275, 0.75], [0.205, 0.77], [0.145, 0.74], [0.125, 0.66],
  [0.145, 0.59], [0.095, 0.54], [0.058, 0.46]
]

const SUNBLEACHED_DUNES_LAND: MapPoly = [
  [0.065, 0.83], [0.135, 0.80], [0.215, 0.82], [0.295, 0.83], [0.385, 0.85],
  [0.435, 0.89], [0.415, 0.95], [0.325, 0.96], [0.225, 0.96], [0.125, 0.94],
  [0.062, 0.90]
]

const AETHER_ISLES_MAIN: MapPoly = [
  [0.775, 0.23], [0.835, 0.14], [0.905, 0.10], [0.955, 0.15], [0.945, 0.23],
  [0.970, 0.30], [0.955, 0.39], [0.885, 0.40], [0.825, 0.36], [0.768, 0.31]
]

const ABYSSAL_ISLE: MapPoly = [
  [0.585, 0.82], [0.645, 0.79], [0.705, 0.82], [0.715, 0.90], [0.655, 0.94], [0.595, 0.91]
]

const SHATTERED_EXPANSE_LAND: MapPoly = [
  [0.765, 0.69], [0.835, 0.67], [0.895, 0.72], [0.955, 0.78], [0.965, 0.89],
  [0.915, 0.95], [0.835, 0.93], [0.785, 0.86], [0.755, 0.78]
]

const WEST_ISLET: MapPoly = [
  [0.032, 0.62], [0.068, 0.60], [0.084, 0.66], [0.062, 0.71], [0.028, 0.68]
]

const MAP_ISLANDS: readonly MapPoly[] = [
  SOLIS_MAINLAND, SUNBLEACHED_DUNES_LAND, AETHER_ISLES_MAIN, ABYSSAL_ISLE, SHATTERED_EXPANSE_LAND, WEST_ISLET
]

// 9 tinted political & biome provinces (6 core Solis + 3 future frontier regions).
// Labels are inked straight onto the chart BENEATH roads so no route ever appears to dead-end at a banner.
const REGION_POLYS: readonly {
  readonly pts: MapPoly
  readonly fill: string
  readonly stroke: string
  readonly labelX: number
  readonly labelY: number
  readonly labelSize: number
  readonly labelAngle: number
  readonly label: string
  readonly subLabel: string
  readonly textCol: string
  readonly future?: boolean
}[] = [
  {
    pts: [[0.03, 0.11], [0.25, 0.09], [0.27, 0.34], [0.21, 0.60], [0.03, 0.60]],
    fill: 'rgba(146, 190, 92, 0.42)', stroke: 'rgba(66, 98, 40, 0.55)',
    labelX: 0.106, labelY: 0.318, labelSize: 18, labelAngle: -0.08,
    label: 'SOLIS VALE', subLabel: 'TIER I–II', textCol: '#2d4318'
  },
  {
    pts: [[0.23, 0.11], [0.43, 0.11], [0.42, 0.48], [0.20, 0.66], [0.21, 0.45]],
    fill: 'rgba(98, 178, 150, 0.38)', stroke: 'rgba(38, 96, 82, 0.55)',
    labelX: 0.33, labelY: 0.352, labelSize: 18, labelAngle: -0.05,
    label: 'THE SILVERFEN', subLabel: 'TIER II–III', textCol: '#17453a'
  },
  {
    pts: [[0.12, 0.59], [0.49, 0.49], [0.51, 0.83], [0.12, 0.81]],
    fill: 'rgba(136, 112, 176, 0.40)', stroke: 'rgba(68, 50, 106, 0.55)',
    labelX: 0.36, labelY: 0.638, labelSize: 16, labelAngle: 0.04,
    label: 'ASHEN CATACOMBS', subLabel: 'TIER II–IV', textCol: '#312052'
  },
  {
    pts: [[0.42, 0.05], [0.75, 0.05], [0.73, 0.34], [0.43, 0.37]],
    fill: 'rgba(196, 230, 248, 0.55)', stroke: 'rgba(68, 118, 152, 0.55)',
    labelX: 0.575, labelY: 0.1, labelSize: 22, labelAngle: 0,
    label: 'FROSTSPIRE', subLabel: 'TIER III–V', textCol: '#1b4361'
  },
  {
    pts: [[0.49, 0.42], [0.77, 0.46], [0.77, 0.76], [0.48, 0.76]],
    fill: 'rgba(210, 112, 74, 0.44)', stroke: 'rgba(128, 46, 26, 0.55)',
    labelX: 0.606, labelY: 0.57, labelSize: 18, labelAngle: -0.06,
    label: 'EMBERWASTE', subLabel: 'TIER IV–V', textCol: '#591c10'
  },
  {
    pts: [[0.62, 0.30], [0.76, 0.30], [0.76, 0.51], [0.62, 0.49]],
    fill: 'rgba(150, 82, 182, 0.44)', stroke: 'rgba(78, 28, 108, 0.6)',
    labelX: 0.665, labelY: 0.332, labelSize: 15, labelAngle: 0,
    label: 'ECLIPSE DOMINION', subLabel: 'TIER V', textCol: '#3b1252'
  },
  {
    pts: [[0.05, 0.79], [0.45, 0.82], [0.45, 0.97], [0.05, 0.97]],
    fill: 'rgba(236, 192, 104, 0.5)', stroke: 'rgba(148, 98, 32, 0.6)',
    labelX: 0.29, labelY: 0.846, labelSize: 13, labelAngle: 0.03,
    label: 'SUNBLEACHED DUNES', subLabel: 'FUTURE · V–VI', textCol: '#5c380c', future: true
  },
  {
    pts: [[0.76, 0.09], [0.98, 0.09], [0.98, 0.42], [0.76, 0.40]],
    fill: 'rgba(120, 172, 228, 0.46)', stroke: 'rgba(52, 92, 166, 0.6)',
    labelX: 0.905, labelY: 0.252, labelSize: 13, labelAngle: -0.04,
    label: 'AETHER ISLES', subLabel: 'FUTURE · VI–VII', textCol: '#1b356b', future: true
  },
  {
    pts: [[0.57, 0.66], [0.98, 0.66], [0.98, 0.97], [0.57, 0.97]],
    fill: 'rgba(146, 70, 124, 0.46)', stroke: 'rgba(96, 26, 78, 0.62)',
    labelX: 0.832, labelY: 0.842, labelSize: 13, labelAngle: 0.1,
    label: 'SHATTERED EXPANSE', subLabel: 'FUTURE · VI–VIII', textCol: '#470f38', future: true
  }
]

// Rivers flow from a real source (lake / spring) to the coast, so none of them read as a road to nowhere.
const MAP_RIVERS: readonly { readonly pts: MapPoly; readonly w0: number; readonly w1: number; readonly lava?: boolean }[] = [
  // Silverfen: drains Mirror Tarn, runs under Sunken Bridge and out through the southern delta
  {
    pts: [[0.536, 0.192], [0.49, 0.172], [0.43, 0.176], [0.372, 0.194], [0.318, 0.236], [0.282, 0.318],
      [0.263, 0.42], [0.248, 0.54], [0.238, 0.655], [0.226, 0.755], [0.218, 0.805]],
    w0: 5, w1: 17
  },
  // Millers' Creek: spring-fed pond -> Millers' Ford -> joins the Silverfen
  { pts: [[0.104, 0.478], [0.135, 0.51], [0.168, 0.543], [0.205, 0.574], [0.242, 0.598]], w0: 4, w1: 9 },
  // Emberwaste lava flow: crater -> southern coast, hissing into the sea
  { pts: [[0.6, 0.632], [0.604, 0.67], [0.598, 0.702], [0.602, 0.75]], w0: 4, w1: 9, lava: true }
]

const MAP_MOUNTAINS: readonly [number, number, number, number, 'snow' | 'volcano' | 'hill'][] = [
  // Frostspire northern alpine range
  [0.42, 0.13, 68, 52, 'snow'], [0.47, 0.10, 82, 64, 'snow'], [0.51, 0.14, 72, 56, 'snow'],
  [0.58, 0.12, 86, 68, 'snow'], [0.63, 0.15, 76, 58, 'snow'], [0.68, 0.11, 88, 70, 'snow'],
  [0.71, 0.19, 72, 54, 'snow'], [0.60, 0.25, 62, 46, 'snow'], [0.51, 0.26, 58, 42, 'snow'],
  [0.545, 0.09, 60, 46, 'snow'], [0.65, 0.085, 58, 44, 'snow'],
  // Emberwaste volcanic ridges
  [0.54, 0.46, 62, 46, 'volcano'], [0.65, 0.50, 74, 58, 'volcano'], [0.71, 0.56, 78, 62, 'volcano'],
  [0.60, 0.66, 62, 46, 'volcano'], [0.70, 0.66, 66, 50, 'volcano'],
  // Western & central foothills
  [0.08, 0.30, 52, 34, 'hill'], [0.19, 0.23, 50, 32, 'hill'], [0.28, 0.18, 56, 36, 'hill'],
  [0.43, 0.49, 52, 34, 'hill'], [0.49, 0.56, 56, 36, 'hill'], [0.098, 0.468, 40, 26, 'hill'],
  // Sunbleached Dunes sandstone mesas
  [0.19, 0.87, 62, 38, 'hill'], [0.31, 0.92, 68, 44, 'hill'],
  // Aether Isles glacial crystal peaks
  [0.84, 0.18, 74, 58, 'snow'], [0.91, 0.21, 78, 62, 'snow'],
  // Shattered Expanse obsidian volcanic peaks
  [0.84, 0.76, 76, 62, 'volcano'], [0.91, 0.80, 82, 68, 'volcano']
]

function pointInPoly(px: number, py: number, pts: MapPoly): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function isMapLand(nx: number, ny: number): boolean {
  for (const poly of MAP_ISLANDS) if (pointInPoly(nx, ny, poly)) return true
  return false
}

function islandOf(nx: number, ny: number): number {
  return MAP_ISLANDS.findIndex(poly => pointInPoly(nx, ny, poly))
}

function hash2i(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function valueNoise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2i(xi, yi, seed)
  const b = hash2i(xi + 1, yi, seed)
  const c = hash2i(xi, yi + 1, seed)
  const d = hash2i(xi + 1, yi + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + o * 17)
    freq *= 2.03
    amp *= 0.5
  }
  return sum
}

function traceSmoothPolygon(ctx: CanvasRenderingContext2D, pts: MapPoly, w: number, h: number) {
  const n = pts.length
  if (n < 3) return
  const px = (i: number) => pts[((i % n) + n) % n][0] * w
  const py = (i: number) => pts[((i % n) + n) % n][1] * h
  ctx.beginPath()
  const mx0 = (px(n - 1) + px(0)) * 0.5
  const my0 = (py(n - 1) + py(0)) * 0.5
  ctx.moveTo(mx0, my0)
  for (let i = 0; i < n; i++) {
    const cx = px(i)
    const cy = py(i)
    const nx = (px(i) + px(i + 1)) * 0.5
    const ny = (py(i) + py(i + 1)) * 0.5
    ctx.quadraticCurveTo(cx, cy, nx, ny)
  }
  ctx.closePath()
}

/** Trace every landmass into a single compound path (one fill/clip instead of one per island). */
function traceIslands(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath()
  for (const pts of MAP_ISLANDS) {
    const n = pts.length
    const px = (i: number) => pts[((i % n) + n) % n][0] * w
    const py = (i: number) => pts[((i % n) + n) % n][1] * h
    ctx.moveTo((px(n - 1) + px(0)) * 0.5, (py(n - 1) + py(0)) * 0.5)
    for (let i = 0; i < n; i++) ctx.quadraticCurveTo(px(i), py(i), (px(i) + px(i + 1)) * 0.5, (py(i) + py(i + 1)) * 0.5)
    ctx.closePath()
  }
}

/** Sample a Catmull-Rom spline through normalized points into pixel space. */
function sampleSpline(pts: MapPoly, w: number, h: number, stepsPerSeg = 10): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  const p = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = p(i - 1)
    const p1 = p(i)
    const p2 = p(i + 1)
    const p3 = p(i + 2)
    for (let s = 0; s < stepsPerSeg; s++) {
      const t = s / stepsPerSeg
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]) * w, y: f(p0[1], p1[1], p2[1], p3[1]) * h })
    }
  }
  const last = pts[pts.length - 1]
  out.push({ x: last[0] * w, y: last[1] * h })
  return out
}

function drawInkedTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  style: 'oak' | 'autumn' | 'pine' | 'snow' | 'dead'
) {
  ctx.save()
  ctx.beginPath()
  ctx.ellipse(x + size * 0.25, y + 1.5, size * 0.8, size * 0.3, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(40, 28, 14, 0.24)'
  ctx.fill()

  if (style === 'pine' || style === 'snow') {
    ctx.fillStyle = '#4a3220'
    ctx.fillRect(x - size * 0.09, y - size * 0.35, size * 0.18, size * 0.42)
    const dark = style === 'snow' ? '#3f6a78' : '#2e5242'
    const light = style === 'snow' ? '#5f8f9c' : '#4b7d5e'
    for (let tier = 0; tier < 3; tier++) {
      const by = y - size * (0.3 + tier * 0.42)
      const tw = size * (0.74 - tier * 0.17)
      const th = size * 0.7
      ctx.beginPath()
      ctx.moveTo(x, by - th)
      ctx.lineTo(x + tw, by)
      ctx.lineTo(x - tw, by)
      ctx.closePath()
      ctx.fillStyle = dark
      ctx.fill()
      // Sunlit west half
      ctx.beginPath()
      ctx.moveTo(x, by - th)
      ctx.lineTo(x, by)
      ctx.lineTo(x - tw, by)
      ctx.closePath()
      ctx.fillStyle = light
      ctx.fill()
      if (style === 'snow') {
        ctx.beginPath()
        ctx.moveTo(x, by - th)
        ctx.lineTo(x + tw * 0.38, by - th * 0.55)
        ctx.lineTo(x - tw * 0.38, by - th * 0.55)
        ctx.closePath()
        ctx.fillStyle = '#f2fbff'
        ctx.fill()
      }
    }
    ctx.beginPath()
    ctx.moveTo(x, y - size * 1.84)
    ctx.lineTo(x + size * 0.74, y - size * 0.3)
    ctx.lineTo(x - size * 0.74, y - size * 0.3)
    ctx.closePath()
    ctx.strokeStyle = 'rgba(30, 22, 14, 0.75)'
    ctx.lineWidth = 1.1
    ctx.stroke()
  } else if (style === 'dead') {
    ctx.strokeStyle = '#3a2f42'
    ctx.lineWidth = 1.7
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, y); ctx.lineTo(x, y - size * 1.1)
    ctx.moveTo(x, y - size * 0.6); ctx.lineTo(x - size * 0.5, y - size * 1.0)
    ctx.moveTo(x - size * 0.3, y - size * 0.82); ctx.lineTo(x - size * 0.42, y - size * 1.22)
    ctx.moveTo(x, y - size * 0.76); ctx.lineTo(x + size * 0.48, y - size * 1.14)
    ctx.stroke()
  } else {
    ctx.fillStyle = '#5a3d24'
    ctx.fillRect(x - size * 0.1, y - size * 0.45, size * 0.2, size * 0.5)
    const hi = style === 'autumn' ? '#e9a253' : '#86b95f'
    const mid = style === 'autumn' ? '#c8713a' : '#5d9446'
    const lo = style === 'autumn' ? '#8e4424' : '#3d6b34'
    const blob = (ox: number, oy: number, r: number, col: string) => {
      ctx.beginPath()
      ctx.arc(x + ox * size, y + oy * size, r * size, 0, Math.PI * 2)
      ctx.fillStyle = col
      ctx.fill()
    }
    // Outline pass
    ctx.beginPath()
    ctx.arc(x - size * 0.32, y - size * 0.6, size * 0.44, 0, Math.PI * 2)
    ctx.arc(x + size * 0.32, y - size * 0.58, size * 0.42, 0, Math.PI * 2)
    ctx.arc(x, y - size * 0.92, size * 0.5, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(32, 24, 14, 0.85)'
    ctx.lineWidth = 2.2
    ctx.stroke()
    blob(-0.32, -0.6, 0.44, lo)
    blob(0.32, -0.58, 0.42, lo)
    blob(0, -0.92, 0.5, mid)
    blob(-0.2, -0.78, 0.34, mid)
    blob(-0.16, -1.02, 0.24, hi)
    blob(-0.4, -0.7, 0.16, hi)
  }
  ctx.restore()
}

function drawInkedMountain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  style: 'snow' | 'volcano' | 'hill',
  seed: number
) {
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const peakX = x + (hash1(seed * 3.1) - 0.5) * w * 0.12
  const peakY = y - h
  const leftX = x - w * 0.52
  const rightX = x + w * 0.52

  // Soft cast shadow to the south-east
  ctx.beginPath()
  ctx.ellipse(x + w * 0.16, y + 2, w * 0.56, h * 0.13, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(30, 20, 10, 0.2)'
  ctx.fill()

  if (style === 'hill') {
    // Rounded hill with a lit crown and hatch shading
    ctx.beginPath()
    ctx.moveTo(leftX, y)
    ctx.bezierCurveTo(leftX + w * 0.18, peakY + h * 0.05, rightX - w * 0.3, peakY - h * 0.05, rightX, y)
    ctx.closePath()
    const g = ctx.createLinearGradient(leftX, peakY, rightX, y)
    g.addColorStop(0, '#c9b88a')
    g.addColorStop(0.55, '#a39168')
    g.addColorStop(1, '#7d6c4d')
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = 'rgba(52, 38, 22, 0.55)'
    ctx.lineWidth = 1.1
    for (let i = 0; i < 4; i++) {
      const t = 0.56 + i * 0.1
      const hx = leftX + (rightX - leftX) * t
      ctx.beginPath()
      ctx.moveTo(hx, y - h * (0.62 - i * 0.12))
      ctx.lineTo(hx + w * 0.04, y - 2)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(leftX, y)
    ctx.bezierCurveTo(leftX + w * 0.18, peakY + h * 0.05, rightX - w * 0.3, peakY - h * 0.05, rightX, y)
    ctx.strokeStyle = '#2c2014'
    ctx.lineWidth = 1.8
    ctx.stroke()
    ctx.restore()
    return
  }

  const litCol = style === 'snow' ? '#9ab4c8' : '#6c4a4e'
  const shadeCol = style === 'snow' ? '#58738c' : '#3a252c'
  const midX = peakX + w * 0.08
  // Jagged secondary shoulder peak behind
  ctx.beginPath()
  ctx.moveTo(x + w * 0.05, y)
  ctx.lineTo(x + w * 0.32, y - h * 0.62)
  ctx.lineTo(x + w * 0.66, y)
  ctx.closePath()
  ctx.fillStyle = shadeCol
  ctx.fill()
  ctx.strokeStyle = '#241b13'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Sunlit west slope
  ctx.beginPath()
  ctx.moveTo(leftX, y)
  ctx.lineTo(peakX - w * 0.2, y - h * 0.55)
  ctx.lineTo(peakX - w * 0.12, y - h * 0.62)
  ctx.lineTo(peakX, peakY)
  ctx.lineTo(midX, y)
  ctx.closePath()
  ctx.fillStyle = litCol
  ctx.fill()
  // Shaded east slope
  ctx.beginPath()
  ctx.moveTo(peakX, peakY)
  ctx.lineTo(peakX + w * 0.2, y - h * 0.58)
  ctx.lineTo(rightX, y)
  ctx.lineTo(midX, y)
  ctx.closePath()
  ctx.fillStyle = shadeCol
  ctx.fill()
  // Hatching on the shadow side
  ctx.strokeStyle = 'rgba(20, 14, 18, 0.45)'
  ctx.lineWidth = 1
  for (let i = 1; i <= 4; i++) {
    const t = i / 5
    const sx = peakX + (rightX - peakX) * t * 0.82
    const sy = peakY + (y - peakY) * t * 0.82
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(sx - w * 0.06, y - 1)
    ctx.stroke()
  }

  if (style === 'snow') {
    ctx.beginPath()
    ctx.moveTo(peakX, peakY)
    ctx.lineTo(peakX - w * 0.2, peakY + h * 0.38)
    ctx.lineTo(peakX - w * 0.1, peakY + h * 0.3)
    ctx.lineTo(peakX - w * 0.02, peakY + h * 0.42)
    ctx.lineTo(peakX + w * 0.08, peakY + h * 0.32)
    ctx.lineTo(peakX + w * 0.17, peakY + h * 0.4)
    ctx.closePath()
    ctx.fillStyle = '#f4faff'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(peakX, peakY)
    ctx.lineTo(peakX + w * 0.08, peakY + h * 0.32)
    ctx.lineTo(peakX + w * 0.17, peakY + h * 0.4)
    ctx.closePath()
    ctx.fillStyle = '#c4d8e8'
    ctx.fill()
  } else {
    // Glowing crater and lava rivulet
    ctx.beginPath()
    ctx.ellipse(peakX, peakY + h * 0.06, w * 0.09, h * 0.04, 0, 0, Math.PI * 2)
    ctx.fillStyle = '#ffb04a'
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(peakX - w * 0.03, peakY + h * 0.08)
    ctx.quadraticCurveTo(peakX - w * 0.08, peakY + h * 0.35, peakX - w * 0.04, peakY + h * 0.6)
    ctx.strokeStyle = '#ff7433'
    ctx.lineWidth = 2.6
    ctx.stroke()
    // Smoke plume
    for (let i = 0; i < 3; i++) {
      ctx.beginPath()
      ctx.arc(peakX + i * w * 0.07, peakY - h * (0.14 + i * 0.13), w * (0.06 + i * 0.025), 0, Math.PI * 2)
      ctx.fillStyle = `rgba(70, 60, 64, ${0.4 - i * 0.1})`
      ctx.fill()
    }
  }

  // Ink silhouette & ridge crest
  ctx.beginPath()
  ctx.moveTo(leftX, y)
  ctx.lineTo(peakX - w * 0.2, y - h * 0.55)
  ctx.lineTo(peakX - w * 0.12, y - h * 0.62)
  ctx.lineTo(peakX, peakY)
  ctx.lineTo(peakX + w * 0.2, y - h * 0.58)
  ctx.lineTo(rightX, y)
  ctx.moveTo(peakX, peakY)
  ctx.lineTo(midX, y - h * 0.1)
  ctx.strokeStyle = '#211810'
  ctx.lineWidth = 1.9
  ctx.stroke()
  ctx.restore()
}

/** Tiny ink sailing ship (sea-lane marker and ocean decoration). */
function drawMapShip(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, facingLeft: boolean, sail = '#f3e6c4') {
  ctx.save()
  ctx.translate(x, y)
  if (facingLeft) ctx.scale(-1, 1)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // Wake
  ctx.strokeStyle = 'rgba(230, 248, 255, 0.55)'
  ctx.lineWidth = s * 0.08
  ctx.beginPath()
  ctx.moveTo(-s * 0.7, s * 0.28)
  ctx.quadraticCurveTo(-s * 1.1, s * 0.32, -s * 1.45, s * 0.24)
  ctx.stroke()
  // Hull
  ctx.beginPath()
  ctx.moveTo(-s * 0.62, s * 0.02)
  ctx.lineTo(s * 0.66, s * 0.02)
  ctx.quadraticCurveTo(s * 0.5, s * 0.34, s * 0.3, s * 0.34)
  ctx.lineTo(-s * 0.44, s * 0.34)
  ctx.closePath()
  ctx.fillStyle = '#6b4526'
  ctx.fill()
  ctx.strokeStyle = '#1b120a'
  ctx.lineWidth = Math.max(1, s * 0.07)
  ctx.stroke()
  // Mast + sails
  ctx.beginPath()
  ctx.moveTo(0, s * 0.02)
  ctx.lineTo(0, -s * 0.9)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(s * 0.04, -s * 0.82)
  ctx.quadraticCurveTo(s * 0.5, -s * 0.5, s * 0.06, -s * 0.12)
  ctx.closePath()
  ctx.fillStyle = sail
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(-s * 0.04, -s * 0.7)
  ctx.quadraticCurveTo(-s * 0.36, -s * 0.42, -s * 0.06, -s * 0.16)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  // Pennant
  ctx.beginPath()
  ctx.moveTo(0, -s * 0.9)
  ctx.lineTo(s * 0.26, -s * 0.84)
  ctx.lineTo(0, -s * 0.78)
  ctx.fillStyle = '#d2402f'
  ctx.fill()
  ctx.restore()
}

/** Generates the relief (hillshade) layer from fBm noise + mountain/hill bumps. */
function bakeReliefLayer(W: number, H: number): HTMLCanvasElement | null {
  const RW = Math.round(W / 5)
  const RH = Math.round(H / 5)
  const canvas = document.createElement('canvas')
  canvas.width = RW
  canvas.height = RH
  const rctx = canvas.getContext('2d')
  if (!rctx) return null
  const height = new Float32Array(RW * RH)
  const bumps = MAP_MOUNTAINS.map(([mx, my, mw, mh, st]) => ({
    x: mx * W,
    y: my * H - mh * 0.3,
    s: mw * (st === 'hill' ? 0.75 : 0.95),
    a: (mh / 60) * (st === 'hill' ? 0.55 : 1.1)
  }))
  for (let j = 0; j < RH; j++) {
    for (let i = 0; i < RW; i++) {
      const px = (i + 0.5) * (W / RW)
      const py = (j + 0.5) * (H / RH)
      let z = fbm2(px / 150, py / 150, 7, 5) * 0.9
      for (const b of bumps) {
        const dx = px - b.x
        const dy = py - b.y
        const d2 = (dx * dx + dy * dy) / (b.s * b.s)
        if (d2 < 9) z += b.a * Math.exp(-d2)
      }
      height[j * RW + i] = z
    }
  }
  const img = rctx.createImageData(RW, RH)
  const lx = -0.62
  const ly = -0.62
  const lz = 0.48
  for (let j = 0; j < RH; j++) {
    for (let i = 0; i < RW; i++) {
      const hL = height[j * RW + Math.max(0, i - 1)]
      const hR = height[j * RW + Math.min(RW - 1, i + 1)]
      const hU = height[Math.max(0, j - 1) * RW + i]
      const hD = height[Math.min(RH - 1, j + 1) * RW + i]
      const dx = (hR - hL) * 3.2
      const dy = (hD - hU) * 3.2
      const len = Math.hypot(dx, dy, 1)
      const shade = (-dx * lx - dy * ly + lz) / len - lz
      const o = (j * RW + i) * 4
      if (shade >= 0) {
        img.data[o] = 255; img.data[o + 1] = 246; img.data[o + 2] = 220
        img.data[o + 3] = Math.min(255, shade * 260)
      } else {
        img.data[o] = 54; img.data[o + 1] = 34; img.data[o + 2] = 18
        img.data[o + 3] = Math.min(255, -shade * 300)
      }
    }
  }
  rctx.putImageData(img, 0, 0)
  return canvas
}

let cachedSolisMapCanvas: HTMLCanvasElement | null = null

function getBakedSolisMap(chapters: readonly ChapterSpec[]): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (cachedSolisMapCanvas) return cachedSolisMapCanvas

  const canvas = document.createElement('canvas')
  canvas.width = WORLD_MAP_W
  canvas.height = WORLD_MAP_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const W = WORLD_MAP_W
  const H = WORLD_MAP_H
  const nodePts = chapters.map(c => ({ x: c.mapX * W, y: c.mapY * H }))
  const nearNode = (tx: number, ty: number, r = 64) => nodePts.some(p => Math.hypot(p.x - tx, (p.y + 14 - ty) * 1.1) < r)

  // 1. Deep ocean with mottled depth variation
  const sea = ctx.createRadialGradient(W * 0.48, H * 0.48, W * 0.08, W * 0.5, H * 0.5, W * 0.72)
  sea.addColorStop(0, '#2f6a80')
  sea.addColorStop(0.65, '#21495e')
  sea.addColorStop(1, '#152c3d')
  ctx.fillStyle = sea
  ctx.fillRect(0, 0, W, H)
  {
    const NW = Math.round(W / 8)
    const NH = Math.round(H / 8)
    const nc = document.createElement('canvas')
    nc.width = NW
    nc.height = NH
    const nctx = nc.getContext('2d')
    if (nctx) {
      const img = nctx.createImageData(NW, NH)
      for (let j = 0; j < NH; j++) {
        for (let i = 0; i < NW; i++) {
          const n = fbm2(i / 22, j / 22, 31, 4) - 0.5
          const o = (j * NW + i) * 4
          if (n > 0) { img.data[o] = 140; img.data[o + 1] = 210; img.data[o + 2] = 226 }
          else { img.data[o] = 6; img.data[o + 1] = 18; img.data[o + 2] = 30 }
          img.data[o + 3] = Math.min(255, Math.abs(n) * 150)
        }
      }
      nctx.putImageData(img, 0, 0)
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(nc, 0, 0, W, H)
      ctx.restore()
    }
  }

  // Stylised wave glyphs scattered through open water (kept off coasts)
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < 260; i++) {
    const wx = hash1(i * 4.17 + 0.3) * W
    const wy = hash1(i * 8.73 + 1.1) * H
    const nx = wx / W
    const ny = wy / H
    if (isMapLand(nx, ny) || isMapLand(nx + 0.03, ny) || isMapLand(nx - 0.03, ny) || isMapLand(nx, ny + 0.045) || isMapLand(nx, ny - 0.045)) continue
    const s = 7 + (i % 4) * 2
    ctx.strokeStyle = 'rgba(196, 236, 246, 0.26)'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(wx - s * 1.5, wy)
    ctx.quadraticCurveTo(wx - s * 0.75, wy - s * 0.7, wx, wy)
    ctx.quadraticCurveTo(wx + s * 0.75, wy - s * 0.7, wx + s * 1.5, wy)
    ctx.stroke()
  }
  ctx.restore()

  // 2. Island drop shadow + concentric shallow-water ripple rings
  for (const poly of MAP_ISLANDS) {
    ctx.save()
    ctx.translate(7, 9)
    traceSmoothPolygon(ctx, poly, W, H)
    ctx.fillStyle = 'rgba(8, 18, 28, 0.45)'
    ctx.fill()
    ctx.restore()
  }
  const shelves: readonly [number, string][] = [[36, '#29637a'], [22, '#317389'], [10, '#468fa3']]
  for (const [d, col] of shelves) {
    for (const poly of MAP_ISLANDS) {
      traceSmoothPolygon(ctx, poly, W, H)
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(214, 244, 250, 0.26)'
      ctx.lineWidth = d * 2 + 2.5
      ctx.stroke()
    }
    for (const poly of MAP_ISLANDS) {
      traceSmoothPolygon(ctx, poly, W, H)
      ctx.strokeStyle = col
      ctx.lineWidth = d * 2
      ctx.stroke()
    }
  }
  // Surf foam hugging every coast
  for (const poly of MAP_ISLANDS) {
    traceSmoothPolygon(ctx, poly, W, H)
    ctx.strokeStyle = 'rgba(240, 252, 255, 0.6)'
    ctx.lineWidth = 6
    ctx.stroke()
  }

  const relief = bakeReliefLayer(W, H)

  // 3. Land: parchment base, watercolour provinces, relief shading (one compound clip for every island)
  {
    ctx.save()
    traceIslands(ctx, W, H)
    const landGrad = ctx.createLinearGradient(0, 0, W, H)
    landGrad.addColorStop(0, '#ead7a6')
    landGrad.addColorStop(0.5, '#dcc38c')
    landGrad.addColorStop(1, '#c8aa72')
    ctx.fillStyle = landGrad
    ctx.fill()
    ctx.clip()

    // Watercolour province washes with soft bleeding edges
    ctx.save()
    if ('filter' in ctx) ctx.filter = 'blur(10px)'
    for (const reg of REGION_POLYS) {
      traceSmoothPolygon(ctx, reg.pts, W, H)
      ctx.fillStyle = reg.fill
      ctx.fill()
    }
    ctx.restore()

    if (relief) {
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.globalAlpha = 0.85
      ctx.drawImage(relief, 0, 0, W, H)
      ctx.restore()
    }

    // Paper grain
    for (let i = 0; i < 900; i++) {
      const sx = hash1(i * 11.7) * W
      const sy = hash1(i * 19.1) * H
      ctx.fillStyle = i % 2 === 0 ? 'rgba(92, 68, 36, 0.07)' : 'rgba(255, 248, 224, 0.1)'
      ctx.fillRect(sx, sy, 2 + (i % 4), 1.5 + (i % 3))
    }

    // Hand-inked province borders
    ctx.save()
    ctx.setLineDash([2, 6])
    ctx.lineCap = 'round'
    for (const reg of REGION_POLYS) {
      traceSmoothPolygon(ctx, reg.pts, W, H)
      ctx.strokeStyle = reg.stroke
      ctx.lineWidth = 2.6
      ctx.stroke()
    }
    ctx.restore()

    // Inner coastal cliff bevel
    traceIslands(ctx, W, H)
    ctx.strokeStyle = 'rgba(92, 62, 30, 0.32)'
    ctx.lineWidth = 16
    ctx.stroke()
    ctx.restore()
  }

  // Biome detailing, kept inland and clear of every location medallion
  const scatter = (count: number, seed: number, region: number, draw: (x: number, y: number, k: number) => void, clear = 58) => {
    const reg = REGION_POLYS[region]
    let minX = 1, minY = 1, maxX = 0, maxY = 0
    for (const [px, py] of reg.pts) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px)
      minY = Math.min(minY, py); maxY = Math.max(maxY, py)
    }
    for (let i = 0; i < count; i++) {
      const nx = minX + hash1(seed + i * 3.31) * (maxX - minX)
      const ny = minY + hash1(seed + i * 7.77 + 0.5) * (maxY - minY)
      if (!pointInPoly(nx, ny, reg.pts) || !isMapLand(nx, ny)) continue
      // Stay off the coast so details never spill into the sea
      if (!isMapLand(nx + 0.012, ny) || !isMapLand(nx - 0.012, ny) || !isMapLand(nx, ny + 0.02) || !isMapLand(nx, ny - 0.02)) continue
      const px = nx * W
      const py = ny * H
      if (nearNode(px, py, clear)) continue
      draw(px, py, i)
    }
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Solis Vale: patchwork farm fields + grass tufts
  scatter(26, 101, 0, (px, py, k) => {
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(-0.35 + hash1(k * 5.1) * 0.7)
    const fw = 26 + hash1(k * 2.3) * 18
    const fh = 16 + hash1(k * 3.9) * 10
    const cols = ['#c9c46a', '#a9c063', '#dcc277', '#94b55a']
    ctx.fillStyle = cols[k % cols.length]
    ctx.globalAlpha = 0.75
    ctx.fillRect(-fw / 2, -fh / 2, fw, fh)
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(92, 72, 34, 0.45)'
    ctx.lineWidth = 1
    for (let r = -fh / 2 + 4; r < fh / 2; r += 4) {
      ctx.beginPath(); ctx.moveTo(-fw / 2 + 2, r); ctx.lineTo(fw / 2 - 2, r); ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(70, 52, 26, 0.6)'
    ctx.strokeRect(-fw / 2, -fh / 2, fw, fh)
    ctx.restore()
  }, 70)
  // Silverfen: marsh reeds and small pools
  scatter(70, 211, 1, (px, py, k) => {
    if (k % 6 === 0) {
      ctx.beginPath()
      ctx.ellipse(px, py, 11, 5, 0, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(78, 160, 182, 0.7)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(30, 64, 70, 0.6)'
      ctx.lineWidth = 1
      ctx.stroke()
      return
    }
    ctx.strokeStyle = 'rgba(38, 86, 66, 0.6)'
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(px - 4, py); ctx.lineTo(px - 6, py - 7)
    ctx.moveTo(px, py); ctx.lineTo(px, py - 9)
    ctx.moveTo(px + 4, py); ctx.lineTo(px + 6, py - 7)
    ctx.moveTo(px - 8, py + 1); ctx.lineTo(px + 8, py + 1)
    ctx.stroke()
  })
  // Ashen Catacombs: weathered gravestones
  scatter(46, 331, 2, (px, py, k) => {
    const s = 5 + (k % 3)
    ctx.beginPath()
    ctx.moveTo(px - s * 0.6, py)
    ctx.lineTo(px - s * 0.6, py - s * 1.1)
    ctx.arc(px, py - s * 1.1, s * 0.6, Math.PI, 0)
    ctx.lineTo(px + s * 0.6, py)
    ctx.closePath()
    ctx.fillStyle = '#b3a9b8'
    ctx.fill()
    ctx.strokeStyle = 'rgba(40, 30, 50, 0.8)'
    ctx.lineWidth = 1.1
    ctx.stroke()
  })
  // Frostspire: snowdrift sparkles
  scatter(90, 401, 3, (px, py) => {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    ctx.beginPath()
    ctx.ellipse(px, py, 7, 2.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(80, 120, 150, 0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px - 7, py + 2); ctx.quadraticCurveTo(px, py + 4, px + 7, py + 2)
    ctx.stroke()
  }, 50)
  // Emberwaste: cracked ash ground
  scatter(60, 503, 4, (px, py, k) => {
    ctx.strokeStyle = k % 4 === 0 ? 'rgba(255, 120, 50, 0.55)' : 'rgba(70, 30, 18, 0.45)'
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(px - 8, py - 2)
    ctx.lineTo(px - 2, py + 1)
    ctx.lineTo(px + 3, py - 3)
    ctx.lineTo(px + 9, py + 1)
    ctx.moveTo(px - 2, py + 1)
    ctx.lineTo(px - 1, py + 6)
    ctx.stroke()
  }, 50)
  // Sunbleached Dunes: sweeping dune crests
  scatter(40, 601, 6, (px, py) => {
    ctx.strokeStyle = 'rgba(150, 96, 30, 0.42)'
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(px - 26, py + 4)
    ctx.quadraticCurveTo(px, py - 10, px + 28, py + 5)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 238, 190, 0.45)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(px - 22, py + 1)
    ctx.quadraticCurveTo(px - 2, py - 11, px + 20, py)
    ctx.stroke()
  }, 46)
  // Aether Isles: floating sky-crystal shards
  scatter(26, 701, 7, (px, py, k) => {
    const s = 5 + (k % 3) * 2
    ctx.save()
    ctx.shadowColor = 'rgba(140, 230, 255, 0.9)'
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.moveTo(px, py - s * 1.6)
    ctx.lineTo(px + s * 0.6, py)
    ctx.lineTo(px, py + s * 0.6)
    ctx.lineTo(px - s * 0.6, py)
    ctx.closePath()
    ctx.fillStyle = '#bff2ff'
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = 'rgba(30, 70, 120, 0.8)'
    ctx.lineWidth = 1
    ctx.stroke()
  }, 50)
  // Shattered Expanse: jagged obsidian shards glowing with void light
  scatter(22, 809, 8, (px, py, k) => {
    ctx.save()
    ctx.shadowColor = 'rgba(255, 90, 180, 0.85)'
    ctx.shadowBlur = 9
    for (let c = 0; c < 3; c++) {
      const ox = (c - 1) * 6
      const s = (c === 1 ? 1.25 : 0.85) * (5 + (k % 3) * 1.5)
      ctx.beginPath()
      ctx.moveTo(px + ox, py - s * 1.7)
      ctx.lineTo(px + ox + s * 0.55, py)
      ctx.lineTo(px + ox - s * 0.55, py)
      ctx.closePath()
      ctx.fillStyle = c === 1 ? '#4a1f4a' : '#36163a'
      ctx.fill()
    }
    ctx.restore()
    ctx.strokeStyle = 'rgba(255, 140, 210, 0.85)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(px, py - 8)
    ctx.lineTo(px + 1.5, py - 1)
    ctx.stroke()
  }, 56)
  ctx.restore()

  // 4. Tapered rivers flowing source -> sea (mainland only), and the Emberwaste lava flow
  ctx.save()
  traceSmoothPolygon(ctx, SOLIS_MAINLAND, W, H)
  ctx.clip()
  // Source ponds
  const pond = (nx: number, ny: number, rx: number, ry: number, col: string) => {
    ctx.beginPath()
    ctx.ellipse(nx * W, ny * H, rx, ry, 0.12, 0, Math.PI * 2)
    ctx.fillStyle = col
    ctx.fill()
    ctx.strokeStyle = '#1f3b4e'
    ctx.lineWidth = 2.6
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(nx * W - rx * 0.2, ny * H - ry * 0.25, rx * 0.5, ry * 0.3, 0.12, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
    ctx.fill()
  }
  for (const river of MAP_RIVERS) {
    const pts = sampleSpline(river.pts, W, H, 12)
    const n = pts.length
    const passes: readonly [number, string][] = river.lava
      ? [[5, '#3b1612'], [0, '#ff6a2a'], [-0.6, '#ffd36a']]
      : [[5, '#1f3b4e'], [0, '#3d9cc0'], [-0.7, 'rgba(220, 246, 255, 0.55)']]
    for (const [extra, col] of passes) {
      ctx.strokeStyle = col
      ctx.lineCap = 'round'
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1)
        const base = river.w0 + (river.w1 - river.w0) * t
        const lw = extra < 0 ? Math.max(1.2, base * -extra * 0.45) : base + extra
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
        ctx.lineTo(pts[i].x, pts[i].y)
        ctx.stroke()
      }
    }
    if (river.lava) {
      // Steam where the lava meets the sea
      const end = pts[n - 1]
      for (let i = 0; i < 4; i++) {
        ctx.beginPath()
        ctx.arc(end.x + (i - 1.5) * 9, end.y - 8 - i * 6, 7 + i * 2, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(235, 235, 235, ${0.4 - i * 0.07})`
        ctx.fill()
      }
    }
  }
  pond(0.55, 0.19, 54, 30, '#78cbe8') // Mirror Tarn, Silverfen headwaters
  pond(0.104, 0.478, 15, 9, '#62b4d3') // Millers' spring
  ctx.restore()

  // 5. Crisp inked coastlines
  for (const poly of MAP_ISLANDS) {
    traceSmoothPolygon(ctx, poly, W, H)
    ctx.strokeStyle = '#22170e'
    ctx.lineWidth = 4
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  // 6 & 7. Mountains and forests depth-sorted together so nothing overlaps awkwardly
  type Prop = { y: number; draw: () => void }
  const props: Prop[] = []
  MAP_MOUNTAINS.forEach(([mx, my, mw, mh, st], i) => {
    const px = mx * W
    const py = my * H
    if (nearNode(px, py - mh * 0.4, 58)) return
    props.push({ y: py, draw: () => drawInkedMountain(ctx, px, py, mw, mh, st, i + 1) })
  })
  const forestClusters: readonly [number, number, number, number, 'oak' | 'autumn' | 'pine' | 'snow' | 'dead'][] = [
    [0.08, 0.45, 85, 16, 'oak'],
    [0.16, 0.32, 78, 18, 'oak'],
    [0.21, 0.40, 70, 14, 'oak'],
    [0.28, 0.32, 75, 16, 'autumn'],
    [0.37, 0.30, 70, 14, 'autumn'],
    [0.30, 0.50, 70, 14, 'autumn'],
    [0.22, 0.68, 92, 18, 'dead'],
    [0.37, 0.64, 85, 16, 'dead'],
    [0.47, 0.72, 75, 12, 'dead'],
    [0.46, 0.22, 82, 15, 'snow'],
    [0.60, 0.29, 80, 14, 'snow'],
    [0.67, 0.27, 65, 10, 'snow'],
    [0.53, 0.40, 72, 14, 'pine'],
    [0.87, 0.31, 60, 10, 'snow']
  ]
  let seedIdx = 1
  for (const [fx, fy, radius, count, style] of forestClusters) {
    for (let i = 0; i < count; i++) {
      seedIdx++
      const ang = hash1(seedIdx * 3.7) * Math.PI * 2
      const dist = Math.sqrt(hash1(seedIdx * 7.9)) * radius
      const tx = fx * W + Math.cos(ang) * dist * 1.25
      const ty = fy * H + Math.sin(ang) * dist * 0.85
      if (nearNode(tx, ty) || !isMapLand(tx / W, ty / H) || !isMapLand(tx / W, ty / H + 0.015)) continue
      const size = 10 + (seedIdx % 5) * 1.5
      props.push({ y: ty, draw: () => drawInkedTree(ctx, tx, ty, size, style) })
    }
  }
  props.sort((a, b) => a.y - b.y)
  for (const p of props) p.draw()

  // 8. Ocean set-dressing: ships and a sea serpent, placed clear of every sea lane
  drawMapShip(ctx, 0.515 * W, 0.935 * H, 26, false)
  drawMapShip(ctx, 0.05 * W, 0.255 * H, 20, true)
  {
    const sx = 0.85 * W
    const sy = 0.545 * H
    ctx.save()
    ctx.lineCap = 'round'
    for (let i = 0; i < 3; i++) {
      const hx = sx - 46 + i * 30
      ctx.beginPath()
      ctx.arc(hx, sy, 11, Math.PI, 0)
      ctx.strokeStyle = '#183c34'
      ctx.lineWidth = 10
      ctx.stroke()
      ctx.strokeStyle = '#4f9a74'
      ctx.lineWidth = 6
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(hx - 14, sy + 1)
      ctx.quadraticCurveTo(hx, sy + 5, hx + 14, sy + 1)
      ctx.strokeStyle = 'rgba(220, 245, 250, 0.6)'
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
    // Head
    ctx.beginPath()
    ctx.moveTo(sx + 44, sy)
    ctx.quadraticCurveTo(sx + 46, sy - 26, sx + 60, sy - 24)
    ctx.quadraticCurveTo(sx + 70, sy - 20, sx + 62, sy - 15)
    ctx.quadraticCurveTo(sx + 54, sy - 14, sx + 54, sy)
    ctx.closePath()
    ctx.fillStyle = '#4f9a74'
    ctx.fill()
    ctx.strokeStyle = '#183c34'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(sx + 58, sy - 20, 1.8, 0, Math.PI * 2)
    ctx.fillStyle = '#ffe36a'
    ctx.fill()
    ctx.restore()
  }

  // 9. Ornate 16-point compass rose
  {
    const crx = W * 0.048
    const cry = H * 0.135
    ctx.save()
    ctx.beginPath()
    ctx.arc(crx, cry, 56, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(16, 32, 48, 0.55)'
    ctx.fill()
    ctx.strokeStyle = '#e8cf94'
    ctx.lineWidth = 2.2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(crx, cry, 48, 0, Math.PI * 2)
    ctx.lineWidth = 1
    ctx.stroke()
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2
      const r0 = i % 4 === 0 ? 42 : 45
      ctx.beginPath()
      ctx.moveTo(crx + Math.cos(a) * r0, cry + Math.sin(a) * r0)
      ctx.lineTo(crx + Math.cos(a) * 48, cry + Math.sin(a) * 48)
      ctx.stroke()
    }
    const point = (a: number, len: number, wid: number, light: string, dark: string) => {
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const tipX = crx + ca * len
      const tipY = cry + sa * len
      const lx = crx - sa * wid
      const ly = cry + ca * wid
      const rx = crx + sa * wid
      const ry = cry - ca * wid
      ctx.beginPath(); ctx.moveTo(crx, cry); ctx.lineTo(tipX, tipY); ctx.lineTo(lx, ly); ctx.closePath()
      ctx.fillStyle = light; ctx.fill()
      ctx.beginPath(); ctx.moveTo(crx, cry); ctx.lineTo(tipX, tipY); ctx.lineTo(rx, ry); ctx.closePath()
      ctx.fillStyle = dark; ctx.fill()
      ctx.strokeStyle = '#1e150c'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(tipX, tipY); ctx.lineTo(rx, ry); ctx.stroke()
    }
    for (let i = 0; i < 8; i++) point(Math.PI / 8 + (i * Math.PI) / 4, 26, 4, '#d9c08a', '#8f7446')
    for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, 34, 6, '#efdcae', '#a8895a')
    for (let i = 0; i < 4; i++) point((i * Math.PI) / 2 - Math.PI / 2, 46, 8, i === 0 ? '#ffe9a8' : '#f4e6c2', i === 0 ? '#c4402f' : '#7a6240')
    ctx.beginPath()
    ctx.arc(crx, cry, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#e8cf94'
    ctx.fill()
    ctx.stroke()
    drawText(ctx, 'N', crx, cry - 66, { size: 16, weight: 900, color: '#f5e2b3', align: 'center', display: true, stroke: true })
    ctx.restore()
  }

  // Warm antique vignette
  const vig = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.36, W * 0.5, H * 0.5, W * 0.68)
  vig.addColorStop(0, 'rgba(20, 14, 8, 0)')
  vig.addColorStop(1, 'rgba(14, 10, 8, 0.38)')
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, W, H)

  // 10. Atlas border: double rule with an alternating degree scale and corner bosses
  ctx.save()
  const b0 = 12
  const b1 = 30
  ctx.fillStyle = '#20170e'
  ctx.fillRect(0, 0, W, b1)
  ctx.fillRect(0, H - b1, W, b1)
  ctx.fillRect(0, 0, b1, H)
  ctx.fillRect(W - b1, 0, b1, H)
  ctx.strokeStyle = '#d9bf86'
  ctx.lineWidth = 2
  ctx.strokeRect(b0 - 4, b0 - 4, W - (b0 - 4) * 2, H - (b0 - 4) * 2)
  ctx.strokeRect(b1, b1, W - b1 * 2, H - b1 * 2)
  const seg = 50
  const bandA = b0 + 2
  const bandW = b1 - b0 - 6
  for (let sx = b1, k = 0; sx < W - b1; sx += seg, k++) {
    ctx.fillStyle = k % 2 === 0 ? '#e9d7a8' : '#6b5232'
    const ww = Math.min(seg, W - b1 - sx)
    ctx.fillRect(sx, bandA, ww, bandW)
    ctx.fillRect(sx, H - bandA - bandW, ww, bandW)
  }
  for (let sy = b1, k = 0; sy < H - b1; sy += seg, k++) {
    ctx.fillStyle = k % 2 === 0 ? '#e9d7a8' : '#6b5232'
    const hh = Math.min(seg, H - b1 - sy)
    ctx.fillRect(bandA, sy, bandW, hh)
    ctx.fillRect(W - bandA - bandW, sy, bandW, hh)
  }
  for (const [cxp, cyp] of [[b0 + 9, b0 + 9], [W - b0 - 9, b0 + 9], [b0 + 9, H - b0 - 9], [W - b0 - 9, H - b0 - 9]] as const) {
    ctx.fillStyle = '#20170e'
    ctx.fillRect(cxp - 15, cyp - 15, 30, 30)
    ctx.strokeStyle = '#d9bf86'
    ctx.strokeRect(cxp - 13, cyp - 13, 26, 26)
    drawStarShape(ctx, cxp, cyp, 11, 4, 4)
    ctx.fillStyle = '#e8cf94'
    ctx.fill()
  }
  ctx.restore()

  cachedSolisMapCanvas = canvas
  return canvas
}

interface WorldMapRoad {
  readonly from: ChapterSpec
  readonly to: ChapterSpec
  readonly x0: number
  readonly y0: number
  readonly cx: number
  readonly cy: number
  readonly x1: number
  readonly y1: number
  readonly sea: boolean
  /** Curve parameter where the lane's ship marker floats (always over open water). */
  readonly shipT: number
}

let cachedWorldMapRoads: { readonly chapters: readonly ChapterSpec[]; readonly roads: readonly WorldMapRoad[] } | null = null

/**
 * Route every prerequisite -> stage connection once, in map pixel space.
 * Each road picks the gentlest bend that keeps it clear of unrelated medallions, and is classified as a
 * sea lane purely from how much of it crosses open water.
 */
function getWorldMapRoads(chapters: readonly ChapterSpec[]): readonly WorldMapRoad[] {
  if (cachedWorldMapRoads && cachedWorldMapRoads.chapters === chapters) return cachedWorldMapRoads.roads
  const W = WORLD_MAP_W
  const H = WORLD_MAP_H
  const byId = new Map(chapters.map(ch => [ch.id, ch]))
  const roads: WorldMapRoad[] = []
  const quad = (x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number) => {
    const it = 1 - t
    return { x: it * it * x0 + 2 * it * t * cx + t * t * x1, y: it * it * y0 + 2 * it * t * cy + t * t * y1 }
  }
  for (const ch of chapters) {
    for (const reqId of ch.requires) {
      const from = byId.get(reqId)
      if (!from) continue
      const x0 = from.mapX * W
      const y0 = from.mapY * H
      const x1 = ch.mapX * W
      const y1 = ch.mapY * H
      const dx = x1 - x0
      const dy = y1 - y0
      const len = Math.max(1, Math.hypot(dx, dy))
      const nx = -dy / len
      const ny = dx / len
      const mx = (x0 + x1) * 0.5
      const my = (y0 + y1) * 0.5
      let best = { score: -Infinity, cx: mx, cy: my }
      for (const k of [0.06, -0.06, 0.14, -0.14, 0.22, -0.22, 0.3, -0.3, 0.38, -0.38]) {
        const cx = mx + nx * k * len
        const cy = my + ny * k * len
        let clearance = Infinity
        for (let t = 0.06; t <= 0.94; t += 0.02) {
          const p = quad(x0, y0, cx, cy, x1, y1, t)
          for (const o of chapters) {
            if (o === ch || o === from) continue
            // Medallion + name plaque footprint (plaque hangs below the pin)
            const ox = (p.x - o.mapX * W) / 78
            const oy = (p.y - (o.mapY * H + 26)) / 64
            clearance = Math.min(clearance, Math.hypot(ox, oy))
          }
        }
        const score = Math.min(clearance, 1.5) - Math.abs(k) * 0.9
        if (score > best.score) best = { score, cx, cy }
      }
      // Sea lane whenever the two ends sit on different landmasses, or the route spends real time over water
      let water = 0
      let shipT = 0.5
      const samples = 24
      for (let i = 1; i < samples; i++) {
        const t = i / samples
        const p = quad(x0, y0, best.cx, best.cy, x1, y1, t)
        if (!isMapLand(p.x / W, p.y / H)) {
          water++
          if (water === 1 || Math.abs(t - 0.5) < Math.abs(shipT - 0.5)) shipT = t
        }
      }
      const sea = islandOf(from.mapX, from.mapY) !== islandOf(ch.mapX, ch.mapY) || water / (samples - 1) > 0.22
      roads.push({ from, to: ch, x0, y0, cx: best.cx, cy: best.cy, x1, y1, sea, shipT })
    }
  }
  cachedWorldMapRoads = { chapters, roads }
  return roads
}

/** Draw the baked Solis atlas, inked region names, roads & sea lanes, and drifting cloud shadows. */
export function drawWorldMapCanvas(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  vp: WorldMapViewport,
  time: number,
  chapters: readonly ChapterSpec[],
  clearedSet: ReadonlySet<string>,
  unlockedSet: ReadonlySet<string>
) {
  const { x, y, width: w, height: h } = rect
  const scale = worldMapScale(rect, vp.zoom)
  const mapDrawW = WORLD_MAP_W * scale
  const mapDrawH = WORLD_MAP_H * scale
  const mapLeft = x + w * 0.5 - vp.panX * mapDrawW
  const mapTop = y + h * 0.5 - vp.panY * mapDrawH

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()

  // Dark chart-table backdrop beyond the atlas sheet
  const table = ctx.createRadialGradient(x + w * 0.5, y + h * 0.5, Math.min(w, h) * 0.2, x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.8)
  table.addColorStop(0, '#1a3346')
  table.addColorStop(1, '#0c1824')
  ctx.fillStyle = table
  ctx.fillRect(x, y, w, h)

  const baked = getBakedSolisMap(chapters)
  if (baked) {
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
    ctx.shadowBlur = 24
    ctx.shadowOffsetY = 8
    ctx.fillStyle = '#152c3d'
    ctx.fillRect(mapLeft, mapTop, mapDrawW, mapDrawH)
    ctx.restore()
    ctx.drawImage(baked, mapLeft, mapTop, mapDrawW, mapDrawH)
  }

  const sx = (mx: number) => mapLeft + mx * scale
  const sy = (my: number) => mapTop + my * scale

  // Inked region names sit UNDER the roads so routes always read as continuous
  for (const reg of REGION_POLYS) {
    const px = mapLeft + reg.labelX * mapDrawW
    const py = mapTop + reg.labelY * mapDrawH
    const titleSz = Math.max(8, Math.round(reg.labelSize * 1.3 * scale))
    const subSz = Math.max(7, Math.round(titleSz * 0.5))
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(reg.labelAngle)
    ctx.globalAlpha = 0.86
    drawText(ctx, reg.label, 0, -subSz * 0.35, {
      size: titleSz,
      weight: 900,
      color: reg.textCol,
      align: 'center',
      spacing: titleSz * 0.2,
      display: true,
      stroke: 'rgba(250, 238, 206, 0.7)',
      strokeWidth: Math.max(2, titleSz * 0.22)
    })
    drawText(ctx, reg.subLabel, 0, titleSz * 0.62, {
      size: subSz,
      weight: 900,
      color: reg.future ? '#8c2046' : 'rgba(70, 52, 30, 0.92)',
      align: 'center',
      spacing: subSz * 0.25,
      display: true,
      stroke: 'rgba(250, 238, 206, 0.6)',
      strokeWidth: Math.max(1.6, subSz * 0.2)
    })
    ctx.restore()
  }

  const quadPoint = (
    x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, t: number
  ) => {
    const it = 1 - t
    const px = it * it * x0 + 2 * it * t * cx + t * t * x1
    const py = it * it * y0 + 2 * it * t * cy + t * t * y1
    const tx = 2 * it * (cx - x0) + 2 * t * (x1 - cx)
    const ty = 2 * it * (cy - y0) + 2 * t * (y1 - cy)
    return { x: px, y: py, ang: Math.atan2(ty, tx) }
  }

  const drawRoadChevron = (px: number, py: number, ang: number, sz: number, fill: string) => {
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(ang)
    ctx.beginPath()
    ctx.moveTo(sz, 0)
    ctx.lineTo(-sz * 0.72, -sz * 0.72)
    ctx.lineTo(-sz * 0.28, 0)
    ctx.lineTo(-sz * 0.72, sz * 0.72)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = '#1e1209'
    ctx.lineWidth = Math.max(1.2, sz * 0.25)
    ctx.stroke()
    ctx.restore()
  }

  const z = Math.max(0.72, vp.zoom)
  const roads = getWorldMapRoads(chapters)
  // Paint order: future trails -> locked -> active -> cleared, so live progress is never buried
  const rank = (r: WorldMapRoad) => {
    if (r.to.comingSoon) return 0
    const fromCleared = clearedSet.has(r.from.id)
    if (fromCleared && clearedSet.has(r.to.id)) return 3
    if (fromCleared && unlockedSet.has(r.to.id)) return 2
    return 1
  }
  const ordered = [...roads].sort((a, b) => rank(a) - rank(b))

  for (const road of ordered) {
    const x0 = sx(road.x0)
    const y0 = sy(road.y0)
    const cx = sx(road.cx)
    const cy = sy(road.cy)
    const x1 = sx(road.x1)
    const y1 = sy(road.y1)
    const minX = Math.min(x0, cx, x1)
    const maxX = Math.max(x0, cx, x1)
    const minY = Math.min(y0, cy, y1)
    const maxY = Math.max(y0, cy, y1)
    if (maxX < x - 20 || minX > x + w + 20 || maxY < y - 20 || minY > y + h + 20) continue

    const r = rank(road)
    const isSoon = r === 0
    const completedRoad = r === 3
    const activeRoad = r === 2

    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(cx, cy, x1, y1)

    if (road.sea) {
      // Nautical shipping lane: dark halo + parchment dashes, with a little ship riding the lane
      ctx.setLineDash([9 * z, 8 * z])
      if (activeRoad) ctx.lineDashOffset = -time * 26
      ctx.strokeStyle = 'rgba(8, 20, 32, 0.6)'
      ctx.lineWidth = 5.4 * z
      ctx.stroke()
      ctx.strokeStyle = completedRoad || activeRoad ? '#ffe484' : isSoon ? 'rgba(236, 222, 186, 0.78)' : '#efe0b8'
      ctx.lineWidth = 2.6 * z
      ctx.stroke()
      ctx.setLineDash([])
      const t = activeRoad ? 0.2 + ((time * 0.08) % 0.6) : road.shipT
      const mid = quadPoint(x0, y0, cx, cy, x1, y1, t)
      drawMapShip(ctx, mid.x, mid.y + 3 * z, 11 * z, Math.cos(mid.ang) < 0, activeRoad || completedRoad ? '#ffe484' : '#f3e6c4')
    } else if (completedRoad) {
      // Cleared royal highway: ink border, gold paving, cream highlight
      ctx.strokeStyle = 'rgba(18, 10, 4, 0.3)'
      ctx.lineWidth = 10.5 * z
      ctx.stroke()
      ctx.strokeStyle = '#24160a'
      ctx.lineWidth = 7.8 * z
      ctx.stroke()
      ctx.strokeStyle = '#efb835'
      ctx.lineWidth = 4.6 * z
      ctx.stroke()
      ctx.strokeStyle = '#fff3c4'
      ctx.lineWidth = 1.6 * z
      ctx.stroke()
    } else if (activeRoad) {
      // Frontier road: glowing vermilion trail with marching dashes and a chevron pointing onward
      ctx.strokeStyle = 'rgba(255, 170, 70, 0.28)'
      ctx.lineWidth = 15 * z
      ctx.stroke()
      ctx.strokeStyle = '#24160a'
      ctx.lineWidth = 8.4 * z
      ctx.stroke()
      ctx.strokeStyle = '#e8622c'
      ctx.lineWidth = 5.2 * z
      ctx.stroke()
      ctx.setLineDash([9 * z, 8 * z])
      ctx.lineDashOffset = -time * 32
      ctx.strokeStyle = '#fff094'
      ctx.lineWidth = 2.4 * z
      ctx.stroke()
      ctx.setLineDash([])
      const animT = 0.28 + ((time * 0.38) % 0.48)
      const chev = quadPoint(x0, y0, cx, cy, x1, y1, animT)
      drawRoadChevron(chev.x, chev.y, chev.ang, 6 * z, '#fff29e')
    } else if (isSoon) {
      // Uncharted trail: a light dotted path, clearly secondary to playable roads
      ctx.setLineDash([0.1, 7 * z])
      ctx.strokeStyle = 'rgba(255, 244, 214, 0.5)'
      ctx.lineWidth = 5 * z
      ctx.stroke()
      ctx.strokeStyle = 'rgba(74, 48, 26, 0.85)'
      ctx.lineWidth = 3.2 * z
      ctx.stroke()
    } else {
      // Locked dirt road: inked edges, packed-earth fill and stitched centre line
      ctx.strokeStyle = 'rgba(30, 18, 8, 0.22)'
      ctx.lineWidth = 9.5 * z
      ctx.stroke()
      ctx.strokeStyle = '#3a2614'
      ctx.lineWidth = 6.8 * z
      ctx.stroke()
      ctx.strokeStyle = '#cfa877'
      ctx.lineWidth = 4.2 * z
      ctx.stroke()
      ctx.setLineDash([5 * z, 6 * z])
      ctx.strokeStyle = '#7b5532'
      ctx.lineWidth = 1.4 * z
      ctx.stroke()
    }
    ctx.restore()
  }

  // Gentle drifting cloud shadows over the chart
  for (let i = 0; i < 6; i++) {
    const cxp = x + (((hash1(i * 6.3) + time * (0.008 + i * 0.002)) % 1.25) - 0.12) * w
    const cyp = y + hash1(i * 9.1) * h
    ctx.save()
    ctx.globalAlpha = 0.06
    ctx.beginPath()
    ctx.ellipse(cxp, cyp, 110 * vp.zoom, 36 * vp.zoom, -0.1, 0, Math.PI * 2)
    ctx.ellipse(cxp + 60 * vp.zoom, cyp - 14 * vp.zoom, 70 * vp.zoom, 26 * vp.zoom, -0.1, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()
}

/** Miniature FFTA / Summerlands hand-inked landmark silhouette drawn inside each World Map medallion! */
function drawLandmarkArt(ctx: CanvasRenderingContext2D, kind: LandmarkKind, cx: number, cy: number, r: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = COLOR.outline
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (kind === 'watchtower' || kind === 'citadel' || kind === 'town') {
    // Battlement keep / tower silhouette
    const tw = kind === 'watchtower' ? r * 0.66 : r * 1.15
    const th = r * 0.92
    ctx.beginPath()
    ctx.rect(cx - tw * 0.5, cy - th * 0.35, tw, th * 0.88)
    ctx.fill(); ctx.stroke()
    // Crenellations
    const merlons = kind === 'watchtower' ? 2 : 3
    const mw = tw / (merlons * 2 - 1)
    for (let i = 0; i < merlons; i++) {
      ctx.fillRect(cx - tw * 0.5 + i * mw * 2, cy - th * 0.62, mw, th * 0.3)
      ctx.strokeRect(cx - tw * 0.5 + i * mw * 2, cy - th * 0.62, mw, th * 0.3)
    }
    // Arched gate
    ctx.fillStyle = '#141a2b'
    ctx.beginPath()
    ctx.arc(cx, cy + th * 0.52, tw * 0.2, Math.PI, 0)
    ctx.fill()
  } else if (kind === 'bridge') {
    // Stone twin-arch bridge
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.72, cy - r * 0.16)
    ctx.lineTo(cx + r * 0.72, cy - r * 0.16)
    ctx.lineTo(cx + r * 0.72, cy + r * 0.45)
    ctx.lineTo(cx + r * 0.44, cy + r * 0.45)
    ctx.arc(cx + r * 0.22, cy + r * 0.45, r * 0.22, 0, Math.PI, true)
    ctx.arc(cx - r * 0.22, cy + r * 0.45, r * 0.22, 0, Math.PI, true)
    ctx.lineTo(cx - r * 0.72, cy + r * 0.45)
    ctx.closePath()
    ctx.fill(); ctx.stroke()
  } else if (kind === 'shrine') {
    // Radiant Torii / Sun Temple arch + glowing crystal
    ctx.fillRect(cx - r * 0.52, cy - r * 0.35, r * 0.2, r * 0.85)
    ctx.fillRect(cx + r * 0.32, cy - r * 0.35, r * 0.2, r * 0.85)
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.75, cy - r * 0.32)
    ctx.lineTo(cx, cy - r * 0.72)
    ctx.lineTo(cx + r * 0.75, cy - r * 0.32)
    ctx.closePath()
    ctx.fill(); ctx.stroke()
    drawStarShape(ctx, cx, cy + r * 0.08, r * 0.26, r * 0.11, 4)
    ctx.fillStyle = '#fff5b8'; ctx.fill()
  } else if (kind === 'crypt' || kind === 'ruins') {
    drawIcon(ctx, 'skull', cx, cy, r * 1.15, color)
  } else if (kind === 'vault' || kind === 'foundry') {
    drawIcon(ctx, 'chest', cx, cy, r * 1.12, color)
  } else if (kind === 'pass' || kind === 'peak') {
    // Jagged twin mountain peak emblem
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.74, cy + r * 0.5)
    ctx.lineTo(cx - r * 0.16, cy - r * 0.62)
    ctx.lineTo(cx + r * 0.18, cy + r * 0.04)
    ctx.lineTo(cx + r * 0.42, cy - r * 0.38)
    ctx.lineTo(cx + r * 0.78, cy + r * 0.5)
    ctx.closePath()
    ctx.fill(); ctx.stroke()
  } else if (kind === 'forest') {
    // Twin miniature trees
    ctx.beginPath()
    ctx.arc(cx - r * 0.24, cy - r * 0.12, r * 0.38, 0, Math.PI * 2)
    ctx.arc(cx + r * 0.26, cy - r * 0.04, r * 0.34, 0, Math.PI * 2)
    ctx.arc(cx, cy - r * 0.36, r * 0.36, 0, Math.PI * 2)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#5c3c24'
    ctx.fillRect(cx - r * 0.1, cy + r * 0.16, r * 0.2, r * 0.36)
  } else if (kind === 'lake' || kind === 'atoll') {
    // Crystal island over wave ripple
    drawFacetedGem(ctx, cx, cy - r * 0.12, r * 0.44, '#ffffff', color)
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.62, cy + r * 0.44)
    ctx.quadraticCurveTo(cx, cy + r * 0.24, cx + r * 0.62, cy + r * 0.44)
    ctx.strokeStyle = '#a8f2ff'; ctx.lineWidth = 2.2; ctx.stroke()
  } else if (kind === 'gate' || kind === 'arena') {
    // Obsidian spiked arch
    ctx.beginPath()
    ctx.moveTo(cx - r * 0.66, cy + r * 0.52)
    ctx.lineTo(cx - r * 0.52, cy - r * 0.56)
    ctx.lineTo(cx, cy - r * 0.28)
    ctx.lineTo(cx + r * 0.52, cy - r * 0.56)
    ctx.lineTo(cx + r * 0.66, cy + r * 0.52)
    ctx.closePath()
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#ff8040'
    ctx.beginPath()
    ctx.arc(cx, cy + r * 0.2, r * 0.24, Math.PI, 0)
    ctx.fill()
  } else if (kind === 'throne') {
    drawIcon(ctx, 'crown', cx, cy, r * 1.22, color)
  } else {
    // Abyssal whirlpool spiral
    ctx.strokeStyle = color
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 1.65)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.3, Math.PI * 0.6, Math.PI * 2.15)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawWorldMapNode(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  stage: ChapterSpec,
  opts: {
    unlocked: boolean
    cleared: boolean
    selected: boolean
    time: number
    compact?: boolean
  },
  st: CanvasWidgetDrawState
) {
  const { x, y, width: w } = rect
  const cx = x + w / 2
  const isSoon = Boolean(stage.comingSoon)
  const r = opts.compact ? 16 : stage.kind === 'boss' ? 23 : stage.kind !== 'story' ? 20 : 18
  const cy = y + r + 5
  const biomeCol = BIOME_MAP_COLOR[stage.biome]
  const diffMeta = DIFFICULTY_META[stage.difficulty]
  const frontier = !isSoon && opts.unlocked && !opts.cleared
  const hot = st.hovered || st.focused || opts.selected

  ctx.save()

  // Pulsing beacon halo on unlocked frontier nodes & selected node
  if (frontier || opts.selected) {
    const pulse = 1 + Math.sin(opts.time * 4.5 + stage.index) * 0.12
    ctx.beginPath()
    ctx.arc(cx, cy, (r + 7.5) * pulse, 0, Math.PI * 2)
    ctx.fillStyle = opts.selected
      ? 'rgba(255, 232, 128, 0.36)'
      : stage.kind === 'boss' ? 'rgba(255, 82, 102, 0.28)' : 'rgba(255, 200, 59, 0.26)'
    ctx.fill()
    ctx.strokeStyle = opts.selected ? COLOR.accentHi : frontier ? COLOR.accent : biomeCol.ring
    ctx.lineWidth = opts.selected ? 2.6 : 1.8
    ctx.stroke()
  }

  // Ground pedestal shadow (FFTA medallion feel!)
  ctx.beginPath()
  ctx.ellipse(cx, cy + r * 0.85, r * 0.92, r * 0.34, 0, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(18, 12, 8, 0.44)'
  ctx.fill()

  // Medallion shape: octagon for treasure/vault, hex for special/town, shield-circle for story/boss
  ctx.beginPath()
  if (stage.kind === 'special' || stage.kind === 'treasure' || stage.kind === 'town') {
    const sides = stage.kind === 'treasure' ? 8 : 6
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2
      const px = cx + Math.cos(a) * (r + 1)
      const py = cy + Math.sin(a) * (r + 1)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
  }

  const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r)
  if (isSoon) {
    grad.addColorStop(0, hot ? '#6b5a4a' : '#4f4238')
    grad.addColorStop(1, '#29211c')
  } else if (!opts.unlocked) {
    grad.addColorStop(0, '#3e465c')
    grad.addColorStop(1, '#1e2333')
  } else {
    grad.addColorStop(0, hot ? biomeCol.ring : biomeCol.fill)
    grad.addColorStop(1, '#172038')
  }
  ctx.fillStyle = grad
  ctx.fill()

  ctx.lineWidth = 2.6
  ctx.strokeStyle = COLOR.outline
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(cx, cy, r - 3.2, 0, Math.PI * 2)
  ctx.strokeStyle = isSoon
    ? '#a68c6d'
    : !opts.unlocked
      ? '#626f8c'
      : opts.selected ? COLOR.accentHi : opts.cleared ? COLOR.good : diffMeta.hex
  ctx.lineWidth = opts.selected ? 2.4 : 1.7
  ctx.stroke()

  // Miniature landmark artwork inside medallion
  const artCol = isSoon
    ? '#d9c3a3'
    : !opts.unlocked
      ? '#8e9bb8'
      : stage.kind === 'boss' ? '#ff9ea8'
      : stage.kind === 'treasure' || stage.kind === 'special' ? COLOR.accentHi
      : '#f7f2e4'
  drawLandmarkArt(ctx, stage.landmark, cx, cy, r * 0.78, artCol)

  // Top-right status badge: Cleared Check / Unclaimed Special Star / Locked Padlock / SOON Wax Seal!
  if (isSoon) {
    drawChip(ctx, cx + r + 10, cy - r - 3, 'SOON', {
      h: 14,
      size: 7.5,
      color: '#fff4d6',
      bg: '#6e3226',
      border: COLOR.outline,
      align: 'right'
    })
  } else if (opts.cleared) {
    const bx = cx + r * 0.72
    const by = cy - r * 0.68
    ctx.beginPath()
    ctx.arc(bx, by, 7.5, 0, Math.PI * 2)
    ctx.fillStyle = COLOR.good
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.8
    ctx.stroke()
    drawIcon(ctx, 'check', bx, by, 8.5, '#072b16')
  } else if (!opts.unlocked) {
    const bx = cx + r * 0.72
    const by = cy - r * 0.68
    ctx.beginPath()
    ctx.arc(bx, by, 7.5, 0, Math.PI * 2)
    ctx.fillStyle = '#232a3d'
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.6
    ctx.stroke()
    drawIcon(ctx, 'lock', bx, by, 8, '#a0aec9')
  } else if (stage.kind !== 'story') {
    const bx = cx + r * 0.72
    const by = cy - r * 0.68
    ctx.beginPath()
    ctx.arc(bx, by, 7.5, 0, Math.PI * 2)
    ctx.fillStyle = COLOR.accent
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.8
    ctx.stroke()
    drawIcon(ctx, 'star', bx, by, 8.5, COLOR.accentText)
  }

  // Top-left difficulty pip (hidden on peaceful town hubs)
  if (stage.kind !== 'town') {
    const dx = cx - r * 0.74
    const dy = cy - r * 0.68
    const pipW = stage.difficulty >= 6 ? 18 : 14.5
    rr(ctx, dx - pipW / 2, dy - 7.4, pipW, 14.8, 7.4)
    ctx.fillStyle = isSoon ? (stage.difficulty >= 6 ? diffMeta.bgHex : '#3b2e24') : opts.unlocked ? diffMeta.bgHex : '#1b2133'
    ctx.fill()
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 1.6
    ctx.stroke()
    drawText(ctx, `${stage.difficulty}`, dx, dy + 0.5, {
      size: 8.8,
      weight: 900,
      color: isSoon ? (stage.difficulty >= 6 ? diffMeta.hex : '#d9be98') : opts.unlocked ? diffMeta.hex : '#7886a6',
      align: 'center',
      display: true
    })
  }

  // Crisp parchment/slate name ribbon below the medallion
  const plaqueY = cy + r + 3
  const plaqueH = opts.compact ? 16 : 18
  const plaqueW = Math.min(w, Math.max(70, measureText(ctx, stage.title, opts.compact ? 9 : 10, 900, true) + 12))
  const plaqueX = cx - plaqueW / 2
  rr(ctx, plaqueX, plaqueY, plaqueW, plaqueH, 5)
  ctx.fillStyle = opts.selected
    ? '#35497a'
    : isSoon ? 'rgba(42, 32, 24, 0.88)' : !opts.unlocked ? 'rgba(20, 26, 43, 0.88)' : 'rgba(24, 34, 58, 0.92)'
  ctx.fill()
  ctx.strokeStyle = opts.selected ? COLOR.accentHi : isSoon ? '#8f7454' : COLOR.outline
  ctx.lineWidth = opts.selected ? 2 : 1.5
  ctx.stroke()
  drawText(ctx, stage.title, cx, plaqueY + plaqueH / 2 + 0.5, {
    size: opts.compact ? 9 : 10,
    weight: 900,
    color: isSoon ? '#e0cca8' : !opts.unlocked ? '#9aa7c4' : opts.selected ? COLOR.accentHi : '#ffffff',
    align: 'center',
    maxW: plaqueW - 8,
    display: true
  })

  if (st.focused) drawFocusRing(ctx, cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4, r + 2)
  ctx.restore()
}

// ===========================================================================
// PACK OPENING LOTTERY CEREMONY & 3D CARD FLIP ANIMATION
// ===========================================================================

const LOTTERY_STRIP_RARITIES: readonly Rarity[] = [
  'common', 'uncommon', 'common', 'rare', 'common', 'uncommon', 'common', 'epic',
  'common', 'uncommon', 'rare', 'common', 'uncommon', 'common', 'legendary', 'common',
  'uncommon', 'rare', 'common', 'uncommon'
]

export function drawPackCeremonyBackdrop(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  opts: {
    pack: PackSpec
    bestRarity: Rarity
    elapsed: number
    phase: 'spin' | 'reveal'
    cards: readonly PackRevealItem[]
  }
) {
  const { x, y, width: w, height: h } = rect
  const cx = x + w / 2
  const cy = y + h * 0.44
  const bestMeta = RARITY_META[opts.bestRarity]
  const spinDur = 1.35
  const u = Math.min(1, opts.elapsed / spinDur)

  ctx.save()
  // Dramatic dark velvet backdrop
  ctx.fillStyle = 'rgba(7, 10, 22, 0.95)'
  ctx.fillRect(x, y, w, h)

  // Rotating celebratory sunburst rays tinted by pack / best pulled rarity!
  const rayAlpha = opts.phase === 'reveal'
    ? 0.24
    : 0.08 + u * 0.28
  const rayColor = u > 0.65 || opts.phase === 'reveal' ? bestMeta.hex : opts.pack.accentHex
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(opts.elapsed * (opts.phase === 'spin' ? 1.4 : 0.35))
  const rayCount = opts.bestRarity === 'legendary' ? 16 : opts.bestRarity === 'epic' ? 12 : 10
  const maxR = Math.hypot(w, h) * 0.65
  for (let i = 0; i < rayCount; i++) {
    const a0 = (i / rayCount) * Math.PI * 2
    const a1 = a0 + (Math.PI / rayCount) * 0.72
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, maxR, a0, a1)
    ctx.closePath()
    const rg = ctx.createRadialGradient(0, 0, 12, 0, 0, maxR)
    rg.addColorStop(0, rayColor)
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = rayAlpha
    ctx.fillStyle = rg
    ctx.fill()
  }
  ctx.restore()

  // Phase 1: Pack Seal Charge + Lottery Rarity Reel!
  if (opts.phase === 'spin') {
    const ease = easeOutCubic(u)
    const shakeAmt = (2 + u * 11) * (1 - Math.max(0, (u - 0.92) / 0.08))
    const sx = Math.sin(opts.elapsed * 58) * shakeAmt
    const sy = Math.cos(opts.elapsed * 64) * shakeAmt * 0.6

    // Charging booster pack emblem above the lottery reel
    const packW = 92
    const packH = 114
    const packScale = 1 + Math.sin(u * Math.PI) * 0.16 + (u > 0.88 ? (u - 0.88) * 3.5 : 0)
    ctx.save()
    ctx.translate(cx + sx, cy - 86 + sy)
    ctx.scale(packScale, packScale)
    ctx.shadowColor = rayColor
    ctx.shadowBlur = 18 + u * 30
    rr(ctx, -packW / 2, -packH / 2, packW, packH, 14)
    const pg = ctx.createLinearGradient(0, -packH / 2, 0, packH / 2)
    pg.addColorStop(0, opts.pack.accentHex)
    pg.addColorStop(1, '#18223d')
    ctx.fillStyle = pg
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = COLOR.outline
    ctx.stroke()
    // Foil crimp stripes
    ctx.fillStyle = '#ffffff44'
    ctx.fillRect(-packW / 2 + 8, -packH / 2 + 8, packW - 16, 6)
    ctx.fillRect(-packW / 2 + 8, packH / 2 - 14, packW - 16, 6)
    drawShardMark(ctx, 0, -4, 24)
    drawText(ctx, 'UNSEALING...', 0, 34, { size: 10, weight: 900, color: '#ffffff', align: 'center', display: true, stroke: true })
    ctx.restore()

    // Horizontal Lottery Rarity Reel!
    const reelW = Math.min(w - 48, 520)
    const reelH = 74
    const reelX = cx - reelW / 2
    const reelY = cy + 16
    drawSurface(ctx, { x: reelX, y: reelY, width: reelW, height: reelH }, {
      r: RADIUS.lg,
      lipH: 4,
      fill: '#1b2644',
      fillBot: '#0f162a',
      glow: rayColor + '88'
    })

    const tileW = 86
    const tileGap = 8
    const stride = tileW + tileGap
    const targetIdx = 22
    const scrollTiles = ease * targetIdx
    const bestIndex = RARITY_ORDER.indexOf(opts.bestRarity)

    ctx.save()
    rr(ctx, reelX + 5, reelY + 5, reelW - 10, reelH - 13, RADIUS.md)
    ctx.clip()

    for (let i = -4; i <= targetIdx + 5; i++) {
      const tx = cx + (i - scrollTiles) * stride - tileW / 2
      if (tx + tileW < reelX || tx > reelX + reelW) continue
      const tileRarity: Rarity = i === targetIdx
        ? opts.bestRarity
        : LOTTERY_STRIP_RARITIES[((i % LOTTERY_STRIP_RARITIES.length) + LOTTERY_STRIP_RARITIES.length) % LOTTERY_STRIP_RARITIES.length]
      const meta = RARITY_META[tileRarity]
      const distFromCenter = Math.abs((tx + tileW / 2) - cx)
      const centered = distFromCenter < tileW * 0.55

      rr(ctx, tx, reelY + 10, tileW, reelH - 22, 9)
      const tg = ctx.createLinearGradient(0, reelY + 10, 0, reelY + reelH - 12)
      tg.addColorStop(0, centered ? meta.hex : meta.bgHex)
      tg.addColorStop(1, '#121a30')
      ctx.fillStyle = tg
      ctx.fill()
      ctx.strokeStyle = centered ? '#ffffff' : meta.hex
      ctx.lineWidth = centered ? 2.4 : 1.6
      ctx.stroke()

      drawIcon(ctx, tileRarity === 'legendary' ? 'crown' : tileRarity === 'epic' ? 'sparkle' : 'gem', tx + tileW / 2, reelY + 26, 16, centered ? '#ffffff' : meta.hex)
      drawText(ctx, meta.short, tx + tileW / 2, reelY + 47, {
        size: 11,
        weight: 900,
        color: centered ? '#ffffff' : meta.hex,
        align: 'center',
        display: true,
        stroke: centered
      })
    }

    // Left/right drum vignette fade
    const lf = ctx.createLinearGradient(reelX, 0, reelX + 64, 0)
    lf.addColorStop(0, '#0b1020ee'); lf.addColorStop(1, '#0b102000')
    ctx.fillStyle = lf; ctx.fillRect(reelX, reelY, 64, reelH)
    const rf = ctx.createLinearGradient(reelX + reelW - 64, 0, reelX + reelW, 0)
    rf.addColorStop(0, '#0b102000'); rf.addColorStop(1, '#0b1020ee')
    ctx.fillStyle = rf; ctx.fillRect(reelX + reelW - 64, reelY, 64, reelH)
    ctx.restore()

    // Golden center lottery needle pointers (top & bottom)
    ctx.fillStyle = COLOR.accentHi
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx, reelY + 14); ctx.lineTo(cx - 10, reelY - 3); ctx.lineTo(cx + 10, reelY - 3); ctx.closePath()
    ctx.fill(); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, reelY + reelH - 16); ctx.lineTo(cx - 10, reelY + reelH + 1); ctx.lineTo(cx + 10, reelY + reelH + 1); ctx.closePath()
    ctx.fill(); ctx.stroke()

    // Teaser text underneath
    const hint = u > 0.78 && bestIndex >= 2
      ? `${bestMeta.label.toUpperCase()} PULL INCOMING!`
      : `Drawing ${opts.cards.length} cards from ${opts.pack.name}...`
    drawText(ctx, hint, cx, reelY + reelH + 24, {
      size: 14,
      weight: 900,
      color: u > 0.78 && bestIndex >= 2 ? bestMeta.hex : COLOR.muted,
      align: 'center',
      display: true,
      stroke: true
    })
  } else {
    // Phase 2: Burst flash fading out smoothly after unseal!
    const revealElapsed = Math.max(0, opts.elapsed - spinDur)
    if (revealElapsed < 0.38) {
      const flash = (1 - revealElapsed / 0.38) * 0.36
      ctx.fillStyle = bestMeta.hex
      ctx.globalAlpha = flash
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 1
    }
    // Floating celebration sparkles matching best pulled rarity
    const sparkCount = opts.bestRarity === 'legendary' ? 28 : opts.bestRarity === 'epic' ? 20 : 12
    for (let i = 0; i < sparkCount; i++) {
      const spx = x + hash1(i * 4.7) * w
      const spy = y + ((hash1(i * 9.3) - opts.elapsed * (0.08 + hash1(i * 2.1) * 0.08)) % 1 + 1) % 1 * h
      const sz = 3 + (i % 3) * 1.8
      ctx.save()
      ctx.globalAlpha = 0.45 + Math.sin(opts.elapsed * 5 + i) * 0.35
      drawStarShape(ctx, spx, spy, sz, sz * 0.42, 4)
      ctx.fillStyle = i % 2 === 0 ? bestMeta.hex : '#ffffff'
      ctx.fill()
      ctx.restore()
    }
  }
  ctx.restore()
}

export function drawAnimatedRevealCard(
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
    convertedShards?: number
    pityTriggered?: 'epic' | 'legendary'
    portrait?: CanvasImageSource
    tacticSpec?: TacticCardSpec
    equipAccent?: string
  },
  anim: {
    enterT: number   // 0..1 spring arrival
    flipT: number    // 0 = face down, 0..1 = flipping, 1 = face up
    elapsed: number
    hovered?: boolean
  }
) {
  const meta = RARITY_META[o.rarity]
  const rarityIdx = RARITY_ORDER.indexOf(o.rarity)
  const enterScale = anim.enterT < 1 ? 0.25 + 0.75 * easeOutBack(anim.enterT) : 1
  const flipClamped = Math.max(0, Math.min(1, anim.flipT))
  const scaleX = Math.max(0.03, Math.abs(Math.cos(flipClamped * Math.PI)))
  const faceUp = flipClamped >= 0.5
  const liftY = (1 - Math.min(1, anim.enterT)) * 36 + (anim.hovered && !faceUp ? -5 : 0)

  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2 + liftY

  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(enterScale * scaleX, enterScale)
  const localRect: LayoutRect = { x: -rect.width / 2, y: -rect.height / 2, width: rect.width, height: rect.height }

  if (!faceUp) {
    // Face-down ornate Crownshard card back with teasing rarity aura!
    const { x, y, width: w, height: h } = localRect
    const r = RADIUS.lg
    const auraPulse = 10 + Math.sin(anim.elapsed * 6.5) * 6
    ctx.save()
    ctx.shadowColor = rarityIdx >= 2 ? meta.hex : '#5ca8ff88'
    ctx.shadowBlur = rarityIdx >= 3 ? 28 + auraPulse : rarityIdx >= 2 ? 18 + auraPulse * 0.5 : 10
    rr(ctx, x, y, w, h, r)
    ctx.fillStyle = rarityIdx >= 2 ? meta.hex : '#4e6396'
    ctx.fill()
    ctx.restore()

    rr(ctx, x + 4, y + 4, w - 8, h - 8, Math.max(3, r - 3))
    const bg = ctx.createLinearGradient(0, y, 0, y + h)
    bg.addColorStop(0, '#2a3a66')
    bg.addColorStop(1, '#121a30')
    ctx.fillStyle = bg
    ctx.fill()

    // Ornate diamond filigree inside card back
    ctx.strokeStyle = (rarityIdx >= 2 ? meta.hex : COLOR.accent) + '88'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(0, y + 18); ctx.lineTo(x + w - 16, 0); ctx.lineTo(0, y + h - 18); ctx.lineTo(x + 16, 0); ctx.closePath()
    ctx.stroke()

    drawShardMark(ctx, 0, -6, Math.min(w, h) * 0.16)
    drawText(ctx, 'TAP TO FLIP', 0, y + h - 22, {
      size: 10,
      weight: 900,
      color: rarityIdx >= 2 ? meta.hex : COLOR.accentHi,
      align: 'center',
      display: true
    })

    rr(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1))
    ctx.strokeStyle = COLOR.outline
    ctx.lineWidth = 2.4
    ctx.stroke()
  } else {
    drawRevealCard(ctx, localRect, o)
    // Bright diagonal sheen sweep right after flipping face-up!
    const sweepT = (flipClamped - 0.5) * 2
    if (sweepT > 0 && sweepT < 1) {
      ctx.save()
      rr(ctx, localRect.x + 2, localRect.y + 2, localRect.width - 4, localRect.height - 4, RADIUS.lg - 2)
      ctx.clip()
      const sx = localRect.x - localRect.width * 0.6 + sweepT * localRect.width * 2.2
      const sg = ctx.createLinearGradient(sx - 28, localRect.y, sx + 28, localRect.y + localRect.height)
      sg.addColorStop(0, 'rgba(255,255,255,0)')
      sg.addColorStop(0.5, 'rgba(255,255,255,0.62)')
      sg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = sg
      ctx.fillRect(localRect.x, localRect.y, localRect.width, localRect.height)
      ctx.restore()
    }
  }
  ctx.restore()

  // Radial flip burst particles around the card when it flips open!
  if (flipClamped >= 0.5 && flipClamped < 0.99) {
    const bt = (flipClamped - 0.5) * 2
    const pCount = rarityIdx >= 4 ? 18 : rarityIdx >= 3 ? 14 : rarityIdx >= 2 ? 10 : 6
    const maxDist = Math.max(rect.width, rect.height) * (0.48 + rarityIdx * 0.08)
    ctx.save()
    for (let i = 0; i < pCount; i++) {
      const a = (i / pCount) * Math.PI * 2 + 0.3
      const dist = maxDist * easeOutCubic(bt)
      const px = cx + Math.cos(a) * dist
      const py = cy + Math.sin(a) * dist
      const sz = (1 - bt) * (4 + rarityIdx * 1.4)
      ctx.globalAlpha = 1 - bt
      drawStarShape(ctx, px, py, sz, sz * 0.45, 4)
      ctx.fillStyle = i % 2 === 0 ? meta.hex : '#ffffff'
      ctx.fill()
    }
    ctx.restore()
  }
}

// ===========================================================================
// VICTORY CELEBRATION & DEFEAT GRIM ANIMATIONS
// ===========================================================================

const CONFETTI_COLORS = ['#ffe680', '#ffc83b', '#42c2ff', '#5cf294', '#ff7096', '#c87dff'] as const

export function drawVictoryBackdrop(ctx: CanvasRenderingContext2D, rect: LayoutRect, elapsed: number) {
  const { x, y, width: w, height: h } = rect
  const cx = x + w / 2
  const cy = y + h * 0.46
  const fadeIn = Math.min(1, elapsed / 0.35)

  ctx.save()
  // Warm golden-tinted dark scrim
  ctx.fillStyle = `rgba(10, 14, 28, ${0.68 * fadeIn})`
  ctx.fillRect(x, y, w, h)

  // Rotating golden sunburst rays behind the Victory modal
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(elapsed * 0.24)
  const rayCount = 14
  const maxR = Math.hypot(w, h) * 0.65
  for (let i = 0; i < rayCount; i++) {
    const a0 = (i / rayCount) * Math.PI * 2
    const a1 = a0 + (Math.PI / rayCount) * 0.65
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, maxR, a0, a1)
    ctx.closePath()
    const rg = ctx.createRadialGradient(0, 0, 20, 0, 0, maxR)
    rg.addColorStop(0, 'rgba(255, 224, 112, 0.32)')
    rg.addColorStop(0.55, 'rgba(255, 190, 58, 0.10)')
    rg.addColorStop(1, 'rgba(255, 190, 58, 0)')
    ctx.globalAlpha = fadeIn
    ctx.fillStyle = rg
    ctx.fill()
  }
  ctx.restore()

  // Cascading festive confetti ribbons & golden rising stars!
  for (let i = 0; i < 42; i++) {
    const seedX = hash1(i * 11.3)
    const speedY = 0.14 + hash1(i * 5.9) * 0.18
    const phase = hash1(i * 17.1)
    const py = y + ((phase + elapsed * speedY) % 1.15 - 0.1) * h
    const px = x + seedX * w + Math.sin(elapsed * 2.6 + i * 1.9) * 24
    const rot = elapsed * (2.5 + (i % 4)) + i
    const col = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    const cw = 6 + (i % 4) * 2
    const ch = 3 + (i % 3) * 1.5

    ctx.save()
    ctx.globalAlpha = fadeIn * 0.85
    ctx.translate(px, py)
    ctx.rotate(rot)
    ctx.scale(1, Math.cos(elapsed * 6 + i))
    ctx.fillStyle = col
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch)
    ctx.restore()
  }

  for (let i = 0; i < 14; i++) {
    const sx = x + hash1(i * 23.7) * w
    const sy = y + (1 - ((hash1(i * 13.1) + elapsed * 0.12) % 1)) * h
    const sz = 4 + (i % 3) * 2
    ctx.save()
    ctx.globalAlpha = fadeIn * (0.4 + Math.sin(elapsed * 4 + i) * 0.35)
    drawStarShape(ctx, sx, sy, sz, sz * 0.42, 4)
    ctx.fillStyle = '#fff2a6'
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()
}

export function drawDefeatBackdrop(ctx: CanvasRenderingContext2D, rect: LayoutRect, elapsed: number) {
  const { x, y, width: w, height: h } = rect
  const cx = x + w / 2
  const cy = y + h * 0.5
  const creep = easeOutCubic(Math.min(1, elapsed / 0.75))
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4)

  ctx.save()
  // Heavy grim slate-obsidian darkness
  ctx.fillStyle = `rgba(7, 6, 14, ${0.78 * creep})`
  ctx.fillRect(x, y, w, h)

  // Creeping crimson dread vignette pulsing from screen edges
  const vig = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.16, cx, cy, Math.hypot(w, h) * 0.62)
  vig.addColorStop(0, 'rgba(20, 8, 16, 0)')
  vig.addColorStop(0.68, `rgba(92, 14, 28, ${(0.24 + pulse * 0.08) * creep})`)
  vig.addColorStop(1, `rgba(145, 16, 36, ${(0.58 + pulse * 0.12) * creep})`)
  ctx.fillStyle = vig
  ctx.fillRect(x, y, w, h)

  // Slow creeping bottom ash mist wave
  const fogH = h * 0.28
  const fog = ctx.createLinearGradient(0, y + h - fogH, 0, y + h)
  fog.addColorStop(0, 'rgba(18, 8, 18, 0)')
  fog.addColorStop(1, `rgba(38, 10, 18, ${0.78 * creep})`)
  ctx.fillStyle = fog
  ctx.fillRect(x, y + h - fogH, w, fogH)

  // Sinking ash flakes and dying red embers drifting downward
  for (let i = 0; i < 36; i++) {
    const isEmber = i % 5 === 0
    const speedY = isEmber ? 0.06 + hash1(i * 7.7) * 0.07 : 0.08 + hash1(i * 4.3) * 0.1
    const py = y + ((hash1(i * 19.3) + elapsed * speedY) % 1.1 - 0.05) * h
    const px = x + hash1(i * 8.1) * w + Math.sin(elapsed * 1.1 + i * 2.3) * 18
    const r = isEmber ? 2.2 : 2.5 + (i % 3) * 1.1

    ctx.save()
    ctx.globalAlpha = creep * (isEmber ? 0.55 + Math.sin(elapsed * 5 + i) * 0.3 : 0.34)
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fillStyle = isEmber ? '#ff5247' : '#8a8499'
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()
}

export function drawResultHeadlineAnimated(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  title: string,
  sub: string,
  won: boolean,
  elapsed: number
) {
  const cx = rect.x + rect.width / 2
  const pop = won ? easeOutBack(Math.min(1, elapsed / 0.42)) : easeOutCubic(Math.min(1, elapsed / 0.5))
  const shakeX = !won && elapsed < 0.35 ? Math.sin(elapsed * 65) * (1 - elapsed / 0.35) * 6 : 0

  ctx.save()
  ctx.translate(cx + shakeX, rect.y + rect.height * 0.5)
  ctx.scale(won ? pop : 1, won ? pop : 1)
  ctx.translate(-cx, -(rect.y + rect.height * 0.5))

  if (won) {
    // Gleaming golden crown emblem above victory text
    drawShardMark(ctx, cx, rect.y - 10, 15)
  } else {
    // Cracked somber crimson emblem above defeat text
    ctx.save()
    const ey = rect.y - 8
    ctx.beginPath()
    ctx.arc(cx, ey, 14, 0, Math.PI * 2)
    ctx.fillStyle = '#38121d'
    ctx.fill()
    ctx.strokeStyle = COLOR.enemy
    ctx.lineWidth = 2.2
    ctx.stroke()
    drawIcon(ctx, 'skull', cx, ey, 14, '#ff8d99')
    // Fracture lightning crack across emblem
    ctx.beginPath()
    ctx.moveTo(cx - 10, ey - 12); ctx.lineTo(cx - 2, ey - 2); ctx.lineTo(cx + 3, ey + 2); ctx.lineTo(cx + 9, ey + 13)
    ctx.strokeStyle = '#ff4d63'
    ctx.lineWidth = 1.8
    ctx.stroke()
    ctx.restore()
  }

  drawResultHeadline(ctx, rect, title, sub, won)
  ctx.restore()
}

export function drawRewardRowAnimated(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  o: { icon?: IconName; portrait?: CanvasImageSource; title: string; detail: string; color: string; badge?: string },
  revealT: number
) {
  const t = Math.max(0, Math.min(1, revealT))
  if (t <= 0.01) return
  const slide = (1 - easeOutCubic(t)) * 22
  ctx.save()
  ctx.globalAlpha = Math.min(1, t * 1.4)
  ctx.translate(slide, 0)
  drawRewardRow(ctx, rect, o)
  // Brief celebratory gleam sweep as the reward locks in
  if (t > 0.2 && t < 0.95) {
    const u = (t - 0.2) / 0.75
    ctx.save()
    rr(ctx, rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 4, RADIUS.md)
    ctx.clip()
    const sx = rect.x - 40 + u * (rect.width + 80)
    const g = ctx.createLinearGradient(sx - 24, rect.y, sx + 24, rect.y + rect.height)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.34)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.restore()
  }
  ctx.restore()
}

/** Victory summary strip displaying each deployed hero's Lv.N, +XP gain, XP bar, and LEVEL UP! badge. */
export function drawHeroXpSummaryAnimated(
  ctx: CanvasRenderingContext2D,
  rect: LayoutRect,
  gains: readonly BattleHeroXpGain[],
  portraits: Readonly<Record<string, CanvasImageSource | undefined>>,
  revealT: number
) {
  if (gains.length === 0) return
  const t = Math.max(0, Math.min(1, revealT))
  if (t <= 0.01) return
  const eased = easeOutCubic(t)
  const slide = (1 - eased) * 18

  ctx.save()
  ctx.globalAlpha = Math.min(1, t * 1.4)
  ctx.translate(slide, 0)
  drawSurface(ctx, rect, { r: RADIUS.md, lipH: 3, fill: '#26365c', fillBot: '#192340', shadow: false })

  const { x, y, width: w, height: h } = rect
  const faceH = h - 3
  const pad = 7
  const gap = 6
  const cols = gains.length
  const colW = (w - pad * 2 - gap * (cols - 1)) / cols
  const ps = Math.min(34, Math.max(22, faceH - 22))

  for (let i = 0; i < cols; i++) {
    const g = gains[i]
    const cx = x + pad + i * (colW + gap)
    const leveled = g.levelsGained > 0
    rr(ctx, cx, y + 4, colW, faceH - 8, RADIUS.sm)
    ctx.fillStyle = leveled ? '#2c3d68' : COLOR.wellDeep
    ctx.fill()
    ctx.strokeStyle = leveled ? COLOR.accent : COLOR.outline
    ctx.lineWidth = leveled ? 1.8 : 1.5
    ctx.stroke()

    const px = cx + 5
    const py = y + 8
    drawPortraitTile(ctx, px, py, ps, portraits[g.uid] ?? portraits[g.heroId], {
      ring: leveled ? COLOR.accentHi : COLOR.ally,
      ringW: 2,
      r: 7
    })

    const tx = px + ps + 6
    const tw = Math.max(12, cx + colW - 5 - tx)
    drawText(ctx, `Lv.${g.newLevel}`, tx, py + 7, {
      size: 11,
      weight: 900,
      color: leveled ? COLOR.accentHi : '#ffffff',
      maxW: tw,
      display: true,
      shadow: true
    })
    drawText(ctx, `+${g.xpGained} XP`, tx, py + 19, {
      size: 10,
      weight: 800,
      color: '#7ef0ff',
      maxW: tw,
      display: true
    })
    if (leveled) {
      drawText(ctx, 'LEVEL UP!', tx, py + 30, {
        size: 8.5,
        weight: 900,
        color: COLOR.accentHi,
        maxW: tw,
        display: true,
        shadow: true
      })
    }

    const ratio = g.isMaxLevel ? 1 : (g.xpForNext > 0 ? Math.min(1, g.currentXp / g.xpForNext) : 1)
    drawBar(
      ctx,
      cx + 5,
      y + faceH - 10,
      Math.max(12, colW - 10),
      5,
      ratio * eased,
      leveled || g.isMaxLevel ? COLOR.accent : COLOR.ap,
      '#0b1020'
    )
  }

  ctx.restore()
}

// =========================================================================
// HERO ASCENSION MERGE CEREMONY & RARE EQUIP FANFARE
// =========================================================================

/** Total length of the ascension / equip fanfare before it auto-dismisses. */
export const FANFARE_DURATION = 4.2

export interface FanfareDrawOpts {
  readonly kind: 'ascend' | 'equip'
  readonly elapsed: number
  readonly title: string
  readonly subtitle: string
  readonly accent: string
  readonly portrait?: CanvasImageSource
  /** Ascension only: new star count and the skill it unlocked. */
  readonly stars?: 1 | 2 | 3
  readonly skill?: { readonly tier: 1 | 2 | 3; readonly name: string; readonly desc: string; readonly vfx: SkillSpec['vfx']; readonly skillId: string }
  /** Equip only: the item being equipped. */
  readonly item?: { readonly slot: EquipSlot; readonly equipId: string; readonly accentHex: string; readonly rarityLabel: string }
}

function fanfareCard(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, accent: string, portrait: CanvasImageSource | undefined, alpha: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  rr(ctx, cx - w / 2, cy - h / 2, w, h, 12)
  const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2)
  g.addColorStop(0, '#3a4c78')
  g.addColorStop(1, '#141c33')
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = accent
  ctx.stroke()
  if (portrait) {
    const ps = Math.min(w, h) * 0.86
    ctx.save()
    rr(ctx, cx - w / 2 + 4, cy - h / 2 + 4, w - 8, h - 8, 9)
    ctx.clip()
    ctx.drawImage(portrait, cx - ps / 2, cy - ps / 2 - h * 0.04, ps, ps)
    ctx.restore()
  }
  ctx.restore()
}

/**
 * Full-screen ceremony: for 'ascend', three ghost copies fly in and fuse in a light beam into the
 * upgraded hero card, stars pop in, then the newly unlocked skill slides up; for 'equip' an
 * Epic/Legendary item bursts onto a rarity sunburst with a shimmer sweep.
 */
export function drawFanfare(ctx: CanvasRenderingContext2D, rect: LayoutRect, o: FanfareDrawOpts) {
  const { x, y, width: w, height: h } = rect
  const t = o.elapsed
  const cx = x + w / 2
  const compact = h < 520 || w < 560
  const cy = y + h * (compact ? 0.40 : 0.38)
  const fadeIn = Math.min(1, t / 0.25)
  const fadeOut = Math.min(1, Math.max(0, (FANFARE_DURATION - t) / 0.4))
  const a = fadeIn * fadeOut
  const fuseT = o.kind === 'ascend' ? 0.75 : 0.18

  ctx.save()
  ctx.fillStyle = `rgba(6, 9, 20, ${0.80 * a})`
  ctx.fillRect(x, y, w, h)

  // Rotating rarity/tier sunburst after the fusion moment
  const burst = Math.max(0, Math.min(1, (t - fuseT) / 0.35))
  if (burst > 0) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(t * 0.3)
    const maxR = Math.hypot(w, h) * 0.6
    const rays = 16
    for (let i = 0; i < rays; i++) {
      const a0 = (i / rays) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, maxR * easeOutCubic(burst), a0, a0 + (Math.PI / rays) * 0.6)
      ctx.closePath()
      const rg = ctx.createRadialGradient(0, 0, 10, 0, 0, maxR)
      rg.addColorStop(0, `${o.accent}66`)
      rg.addColorStop(1, `${o.accent}00`)
      ctx.globalAlpha = a
      ctx.fillStyle = rg
      ctx.fill()
    }
    ctx.restore()
  }

  const cardW = compact ? 104 : 136
  const cardH = cardW * 1.32

  if (o.kind === 'ascend') {
    // Phase 1: three ghost copies converge, spinning, trailing light
    if (t < fuseT) {
      const u = easeOutCubic(t / fuseT)
      const starts: readonly (readonly [number, number])[] = [[-w * 0.42, -h * 0.1], [w * 0.42, -h * 0.1], [0, h * 0.5]]
      for (let i = 0; i < 3; i++) {
        const sx = cx + starts[i][0] * (1 - u)
        const sy = cy + starts[i][1] * (1 - u)
        ctx.save()
        ctx.translate(sx, sy)
        ctx.rotate((1 - u) * (i - 1) * 1.4)
        fanfareCard(ctx, 0, 0, cardW * 0.82, cardH * 0.82, o.accent, o.portrait, a * (0.45 + 0.4 * u))
        ctx.restore()
        // energy trail
        ctx.save()
        ctx.globalAlpha = a * 0.5
        ctx.strokeStyle = o.accent
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(cx + starts[i][0] * (1 - u * 0.6), cy + starts[i][1] * (1 - u * 0.6))
        ctx.stroke()
        ctx.restore()
      }
    }
    // Phase 2: fusion beam + white flash
    const beamT = (t - fuseT + 0.12) / 0.7
    if (beamT > 0 && beamT < 1) {
      const bw = cardW * 0.9 * Math.sin(beamT * Math.PI)
      const bg = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0)
      bg.addColorStop(0, 'rgba(255,255,255,0)')
      bg.addColorStop(0.5, `rgba(255, 246, 210, ${0.9 * a})`)
      bg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = bg
      ctx.fillRect(cx - bw / 2, y, bw, h)
    }
    const flash = t > fuseT ? Math.max(0, 1 - (t - fuseT) / 0.3) : 0
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 250, 225, ${0.55 * flash * a})`
      ctx.fillRect(x, y, w, h)
    }
  }

  // Phase 3: hero card / item pops in
  const popT = Math.max(0, (t - fuseT) / 0.45)
  if (popT > 0) {
    const pop = easeOutBack(popT)
    ctx.save()
    ctx.translate(cx, cy + Math.sin(t * 2.2) * 3)
    ctx.scale(pop, pop)
    if (o.kind === 'ascend') {
      fanfareCard(ctx, 0, 0, cardW, cardH, o.accent, o.portrait, a)
    } else if (o.item) {
      ctx.globalAlpha = a
      ctx.beginPath()
      ctx.arc(0, 0, cardW * 0.52, 0, Math.PI * 2)
      const ig = ctx.createRadialGradient(0, 0, 4, 0, 0, cardW * 0.52)
      ig.addColorStop(0, '#2a3760')
      ig.addColorStop(1, '#0f1528')
      ctx.fillStyle = ig
      ctx.fill()
      ctx.lineWidth = 4
      ctx.strokeStyle = o.accent
      ctx.stroke()
      drawEquipIcon(ctx, o.item.slot, o.item.equipId, o.item.accentHex, 0, 0, cardW * 0.36)
      // diagonal shimmer sweep across the medallion
      const sweep = ((t - fuseT) * 0.8) % 1.6 - 0.3
      ctx.save()
      ctx.beginPath()
      ctx.arc(0, 0, cardW * 0.5, 0, Math.PI * 2)
      ctx.clip()
      const sx = (sweep - 0.5) * cardW * 1.6
      const sg = ctx.createLinearGradient(sx - 18, -cardW, sx + 18, cardW)
      sg.addColorStop(0, 'rgba(255,255,255,0)')
      sg.addColorStop(0.5, 'rgba(255,255,255,0.55)')
      sg.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = sg
      ctx.fillRect(-cardW, -cardW, cardW * 2, cardW * 2)
      ctx.restore()
    }
    ctx.restore()

    // Stars pop in one by one under the card
    if (o.kind === 'ascend' && o.stars) {
      const starY = cy + cardH / 2 + (compact ? 16 : 22)
      const size = compact ? 18 : 24
      const gap = size * 1.25
      for (let i = 0; i < o.stars; i++) {
        const st = Math.max(0, Math.min(1, (t - fuseT - 0.25 - i * 0.16) / 0.3))
        if (st <= 0) continue
        const s = easeOutBack(st)
        const sx = cx + (i - (o.stars - 1) / 2) * gap
        ctx.save()
        ctx.globalAlpha = a
        ctx.translate(sx, starY)
        ctx.scale(s, s)
        drawStarShape(ctx, 0, 0, size * 0.54, size * 0.25)
        ctx.fillStyle = COLOR.accent
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = COLOR.outline
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  // Titles
  const textT = Math.max(0, Math.min(1, (t - fuseT - 0.1) / 0.35))
  if (textT > 0) {
    const ty = cy - cardH / 2 - (compact ? 34 : 46)
    ctx.save()
    ctx.globalAlpha = a * textT
    drawText(ctx, o.title, cx, ty - 14 * (1 - textT), { size: compact ? 22 : 30, display: true, align: 'center', color: o.accent, stroke: true, upper: true, spacing: 1.5, maxW: w - 24 })
    drawText(ctx, o.subtitle, cx, ty + (compact ? 22 : 28), { size: compact ? 12 : 14, align: 'center', color: COLOR.text, shadow: true, maxW: w - 24 })
    ctx.restore()
  }

  // Newly unlocked skill showcase slides up
  if (o.kind === 'ascend' && o.skill) {
    const sT = Math.max(0, Math.min(1, (t - fuseT - 0.85) / 0.45))
    if (sT > 0) {
      const pw = Math.min(w - 32, compact ? 300 : 380)
      const ph = compact ? 62 : 74
      const px = cx - pw / 2
      const py = cy + cardH / 2 + (compact ? 38 : 52) + (1 - easeOutCubic(sT)) * 40
      ctx.save()
      ctx.globalAlpha = a * sT
      rr(ctx, px, py, pw, ph, 12)
      ctx.fillStyle = '#121a30ee'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = TIER_COLOR[o.skill.tier]
      ctx.stroke()
      const ir = ph * 0.32
      ctx.beginPath()
      ctx.arc(px + ph / 2, py + ph / 2, ir + 4, 0, Math.PI * 2)
      ctx.fillStyle = '#0b1020'
      ctx.fill()
      drawSkillIcon(ctx, o.skill.vfx, o.skill.skillId, px + ph / 2, py + ph / 2, ir)
      drawText(ctx, 'NEW SKILL UNLOCKED', px + ph, py + ph * 0.26, { size: 10, color: TIER_COLOR[o.skill.tier], spacing: 1.2 })
      drawText(ctx, o.skill.name, px + ph, py + ph * 0.50, { size: compact ? 14 : 16, display: true, maxW: pw - ph - 12 })
      drawText(ctx, o.skill.desc, px + ph, py + ph * 0.76, { size: 10.5, weight: 600, color: COLOR.muted, maxW: pw - ph - 12 })
      ctx.restore()
    }
  }

  // Rising sparkles
  for (let i = 0; i < 22; i++) {
    const sx = x + hash1(i * 9.7) * w
    const sy = y + (1 - ((hash1(i * 3.3) + t * (0.12 + hash1(i * 1.7) * 0.1)) % 1)) * h
    ctx.save()
    ctx.globalAlpha = a * burst * (0.35 + Math.sin(t * 5 + i) * 0.3)
    drawStarShape(ctx, sx, sy, 5 + (i % 3) * 2, 2, 4)
    ctx.fillStyle = i % 3 === 0 ? '#ffffff' : o.accent
    ctx.fill()
    ctx.restore()
  }

  if (t > 1.6) {
    ctx.globalAlpha = a * (0.5 + Math.sin(t * 4) * 0.25)
    drawText(ctx, 'Tap to continue', cx, y + h - (compact ? 22 : 34), { size: 11, align: 'center', color: COLOR.muted })
  }
  ctx.restore()
}
