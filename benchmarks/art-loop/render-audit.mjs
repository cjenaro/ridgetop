import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  artPartBounds, auditArtModel, bakeAnimatedSpritePixels, bakeSpritePixels, createArtKit, modelFromArtRecipe
} from '../../packages/ridgetop/dist/framework/index.js'
import { encodePng } from '../../packages/ridgetop/dist/framework/png.js'

function fillRect(buf, W, H, x, y, w, h, r, g, b, a = 255) {
  const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(W, Math.ceil(x + w)), y1 = Math.min(H, Math.ceil(y + h))
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * W + px) * 4
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a
    }
  }
}

function blit(dst, dW, dH, src, sW, sH, dx, dy, scale = 1, sx0 = 0, sy0 = 0, sw = sW, sh = sH, silhouette = null) {
  for (let py = 0; py < sh * scale; py++) {
    const ty = dy + py
    if (ty < 0 || ty >= dH) continue
    const sy = sy0 + Math.floor(py / scale)
    for (let px = 0; px < sw * scale; px++) {
      const tx = dx + px
      if (tx < 0 || tx >= dW) continue
      const sx = sx0 + Math.floor(px / scale)
      const si = (sy * sW + sx) * 4
      const sa = src[si + 3]
      if (!sa) continue
      const di = (ty * dW + tx) * 4
      const sr = silhouette ? silhouette[0] : src[si]
      const sg = silhouette ? silhouette[1] : src[si + 1]
      const sb = silhouette ? silhouette[2] : src[si + 2]
      if (sa === 255) {
        dst[di] = sr; dst[di + 1] = sg; dst[di + 2] = sb; dst[di + 3] = 255
      } else {
        const a = sa / 255, ia = 1 - a
        dst[di] = Math.round(sr * a + dst[di] * ia)
        dst[di + 1] = Math.round(sg * a + dst[di + 1] * ia)
        dst[di + 2] = Math.round(sb * a + dst[di + 2] * ia)
        dst[di + 3] = 255
      }
    }
  }
}

function checkConnectivity(model) {
  const boxes = model.parts.map(p => artPartBounds(p))
  const n = boxes.length
  if (n <= 1) return { components: n, detached: [] }
  const margin = Math.max(0.03, model.span * 0.02)
  const adj = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = boxes[i], b = boxes[j]
      const overlap =
        a.min[0] - margin <= b.max[0] && a.max[0] + margin >= b.min[0] &&
        a.min[1] - margin <= b.max[1] && a.max[1] + margin >= b.min[1] &&
        a.min[2] - margin <= b.max[2] && a.max[2] + margin >= b.min[2]
      if (overlap) { adj[i].push(j); adj[j].push(i) }
    }
  }
  const visited = new Uint8Array(n)
  const comps = []
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue
    const comp = []
    const q = [i]
    visited[i] = 1
    while (q.length) {
      const cur = q.shift()
      comp.push(cur)
      for (const nxt of adj[cur]) if (!visited[nxt]) { visited[nxt] = 1; q.push(nxt) }
    }
    comps.push(comp)
  }
  comps.sort((a, b) => b.length - a.length)
  const detached = comps.slice(1).flat().map(idx => model.parts[idx].name ?? `part-${idx + 1}`)
  return { components: comps.length, detached }
}

function analyzeFramePixels(pixels, W, H, x0, y0, fw, fh) {
  let opaque = 0, edgeTouches = 0, lumSum = 0, lumMin = 255, lumMax = 0
  let minY = fh, maxY = -1, minX = fw, maxX = -1
  const colors = new Set()
  let orphans = 0
  const isOpaque = (px, py) => {
    if (px < 0 || px >= fw || py < 0 || py >= fh) return false
    return pixels[((y0 + py) * W + (x0 + px)) * 4 + 3] > 16
  }
  for (let py = 0; py < fh; py++) {
    for (let px = 0; px < fw; px++) {
      const i = ((y0 + py) * W + (x0 + px)) * 4
      if (pixels[i + 3] <= 16) continue
      opaque++
      if (px === 0 || px === fw - 1 || py === 0 || py === fh - 1) edgeTouches++
      if (px < minX) minX = px; if (px > maxX) maxX = px
      if (py < minY) minY = py; if (py > maxY) maxY = py
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
      colors.add((r << 16) | (g << 8) | b)
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      lumSum += lum
      if (lum < lumMin) lumMin = lum
      if (lum > lumMax) lumMax = lum
      let neighbors = 0
      if (isOpaque(px - 1, py)) neighbors++
      if (isOpaque(px + 1, py)) neighbors++
      if (isOpaque(px, py - 1)) neighbors++
      if (isOpaque(px, py + 1)) neighbors++
      if (neighbors === 0) orphans++
    }
  }
  return {
    opaque,
    fillRatio: +(opaque / (fw * fh)).toFixed(3),
    edgeTouches,
    uniqueColors: colors.size,
    orphans,
    lumRange: opaque ? Math.round(lumMax - lumMin) : 0,
    lumMean: opaque ? Math.round(lumSum / opaque) : 0,
    bounds: opaque ? { minX, maxX, minY, maxY, footY: maxY } : null
  }
}

async function auditLowPoly(iterDir, briefs, palette, lighting) {
  const results = []
  const cardW = 860
  const rowH = 220
  const sheetH = briefs.length * rowH + 16
  const sheet = new Uint8ClampedArray(cardW * sheetH * 4)
  fillRect(sheet, cardW, sheetH, 0, 0, cardW, sheetH, 22, 34, 42)

  for (let idx = 0; idx < briefs.length; idx++) {
    const brief = briefs[idx]
    const file = join(iterDir, 'low-poly', `${brief.id}.art.json`)
    const ry = 8 + idx * rowH
    fillRect(sheet, cardW, sheetH, 8, ry, cardW - 16, rowH - 12, 33, 49, 58)
    try {
      const source = JSON.parse(await readFile(file, 'utf8'))
      const model = modelFromArtRecipe(source)
      const kit = createArtKit({ palette, models: { [brief.id]: model }, frameSize: brief.frameSize })
      const group = kit.group()
      group.add(brief.id, [0, 0, 0])
      const cam = { span: model.span, center: [0, model.centerY, 0], lighting }
      const native = bakeSpritePixels(group.batches, { ...cam, frameSize: brief.frameSize })
      const large = bakeSpritePixels(group.batches, { ...cam, frameSize: 144 })
      const artAudit = auditArtModel(model, { palette, frameSize: brief.frameSize })
      const hiddenParts = artAudit.hiddenParts
      const conn = checkConnectivity(model)
      let edgeHits = 0
      for (let d = 0; d < 8; d++) {
        const stats = analyzeFramePixels(native.pixels, native.width, native.height, d * brief.frameSize, 0, brief.frameSize, brief.frameSize)
        edgeHits += stats.edgeTouches
      }
      const frontStats = analyzeFramePixels(native.pixels, native.width, native.height, 0, 0, brief.frameSize, brief.frameSize)
      const tris = model.parts.reduce((s, p) => s + p.mesh.vertexCount / 3, 0)

      // Native sprite (1x) + 2x on dark & light tiles
      fillRect(sheet, cardW, sheetH, 20, ry + 16, brief.frameSize + 12, brief.frameSize + 12, 24, 34, 42)
      blit(sheet, cardW, sheetH, native.pixels, native.width, native.height, 26, ry + 22, 1, brief.frameSize, 0, brief.frameSize, brief.frameSize)
      fillRect(sheet, cardW, sheetH, 20, ry + 90, brief.frameSize + 12, brief.frameSize + 12, 212, 224, 216)
      blit(sheet, cardW, sheetH, native.pixels, native.width, native.height, 26, ry + 96, 1, brief.frameSize, 0, brief.frameSize, brief.frameSize)

      // 4 high-res angles: front (0), front-right (1), right (2), back-right (3)
      const angles = [0, 1, 2, 3]
      for (let a = 0; a < angles.length; a++) {
        const ax = 104 + a * 150
        fillRect(sheet, cardW, sheetH, ax, ry + 14, 144, 144, 24, 36, 44)
        blit(sheet, cardW, sheetH, large.pixels, large.width, large.height, ax, ry + 14, 1, angles[a] * 144, 0, 144, 144)
      }

      // Animation strip (if clips exist) or silhouette
      let animMetrics = null
      const clipNames = Object.keys(model.clips ?? {})
      if (clipNames.length) {
        const targetClip = clipNames.includes('walk') ? 'walk' : clipNames[0]
        const anim = bakeAnimatedSpritePixels(model, {
          clip: targetClip, frames: 4, frameSize: 64, directions: ['front-right'], palette, lighting
        })
        const footYs = []
        let motionPixels = 0
        for (let f = 0; f < 4; f++) {
          const st = analyzeFramePixels(anim.pixels, anim.width, anim.height, f * 64, 0, 64, 64)
          if (st.bounds) footYs.push(st.bounds.footY)
          const fx = 710 + (f % 2) * 68
          const fy = ry + 14 + Math.floor(f / 2) * 68
          fillRect(sheet, cardW, sheetH, fx, fy, 64, 64, 20, 30, 38)
          blit(sheet, cardW, sheetH, anim.pixels, anim.width, anim.height, fx, fy, 1, f * 64, 0, 64, 64)
        }
        // Pixel diff between frame 0 and frame 1
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          const i0 = (y * anim.width + x) * 4
          const i1 = (y * anim.width + 64 + x) * 4
          if (Math.abs(anim.pixels[i0] - anim.pixels[i1]) + Math.abs(anim.pixels[i0 + 1] - anim.pixels[i1 + 1]) +
              Math.abs(anim.pixels[i0 + 2] - anim.pixels[i1 + 2]) + Math.abs(anim.pixels[i0 + 3] - anim.pixels[i1 + 3]) > 24) {
            motionPixels++
          }
        }
        const footDrift = footYs.length ? Math.max(...footYs) - Math.min(...footYs) : 0
        animMetrics = { clips: clipNames, inspectedClip: targetClip, footDriftPx: footDrift, frameDeltaPx: motionPixels }
      } else {
        // Silhouette check tile
        fillRect(sheet, cardW, sheetH, 710, ry + 14, 136, 144, 232, 238, 234)
        blit(sheet, cardW, sheetH, large.pixels, large.width, large.height, 706, ry + 14, 1, 144, 0, 144, 144, [24, 34, 44])
      }

      results.push({
        id: brief.id, ok: true, parts: model.parts.length, triangles: Math.round(tris),
        hiddenParts, detachedParts: conn.detached, components: conn.components,
        edgeTouchesAll8: edgeHits, fillRatio: frontStats.fillRatio,
        lumRange: frontStats.lumRange, hasClips: clipNames.length > 0, animMetrics
      })
    } catch (err) {
      results.push({ id: brief.id, ok: false, error: String(err?.message ?? err) })
    }
  }
  const outPng = join(iterDir, 'low-poly-sheet.png')
  await writeFile(outPng, encodePng(cardW, sheetH, sheet))
  return { outPng, results }
}

async function auditPixelArt(iterDir, briefs) {
  const results = []
  const cardW = 860
  const rowH = 210
  const sheetH = briefs.length * rowH + 16
  const sheet = new Uint8ClampedArray(cardW * sheetH * 4)
  fillRect(sheet, cardW, sheetH, 0, 0, cardW, sheetH, 22, 34, 42)

  for (let idx = 0; idx < briefs.length; idx++) {
    const brief = briefs[idx]
    const file = join(iterDir, 'pixel-art', `${brief.id}.mjs`)
    const ry = 8 + idx * rowH
    fillRect(sheet, cardW, sheetH, 8, ry, cardW - 16, rowH - 12, 33, 49, 58)
    try {
      const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`)
      const built = typeof mod.build === 'function' ? mod.build() : mod.default()
      const { frameWidth: fw, frameHeight: fh, width: W, height: H, pixels } = built
      const frames = Math.floor(W / fw)
      const scale = Math.max(2, Math.min(4, Math.floor(144 / Math.max(fw, fh))))

      // Save raw native PNG too
      await writeFile(join(iterDir, 'pixel-art', `${brief.id}.png`), encodePng(W, H, pixels))

      // 1x native on dark + light
      fillRect(sheet, cardW, sheetH, 20, ry + 18, fw + 12, fh + 12, 24, 34, 42)
      blit(sheet, cardW, sheetH, pixels, W, H, 26, ry + 24, 1, 0, 0, fw, fh)
      fillRect(sheet, cardW, sheetH, 20, ry + 84, fw + 12, fh + 12, 214, 224, 218)
      blit(sheet, cardW, sheetH, pixels, W, H, 26, ry + 90, 1, 0, 0, fw, fh)

      // Magnified frames
      const frameStats = []
      const showFrames = Math.min(frames, 4)
      for (let f = 0; f < showFrames; f++) {
        const st = analyzeFramePixels(pixels, W, H, f * fw, 0, fw, fh)
        frameStats.push(st)
        const fx = 92 + f * (fw * scale + 12)
        const fy = ry + Math.floor((rowH - 12 - fh * scale) / 2)
        // Checkerboard background
        for (let cy = 0; cy < fh * scale; cy += 8) {
          for (let cx = 0; cx < fw * scale; cx += 8) {
            const dark = ((cx >> 3) + (cy >> 3)) & 1
            fillRect(sheet, cardW, sheetH, fx + cx, fy + cy, Math.min(8, fw * scale - cx), Math.min(8, fh * scale - cy),
              dark ? 28 : 38, dark ? 40 : 52, dark ? 48 : 62)
          }
        }
        blit(sheet, cardW, sheetH, pixels, W, H, fx, fy, scale, f * fw, 0, fw, fh)
      }

      // Pure silhouette of frame 0 on light paper
      const sx = cardW - fw * scale - 24
      const sy = ry + Math.floor((rowH - 12 - fh * scale) / 2)
      fillRect(sheet, cardW, sheetH, sx - 4, sy - 4, fw * scale + 8, fh * scale + 8, 232, 238, 234)
      blit(sheet, cardW, sheetH, pixels, W, H, sx, sy, scale, 0, 0, fw, fh, [24, 34, 44])

      let frameDeltaPx = 0
      if (frames >= 2) {
        for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
          const i0 = (y * W + x) * 4
          const i1 = (y * W + fw + x) * 4
          if (Math.abs(pixels[i0] - pixels[i1]) + Math.abs(pixels[i0 + 1] - pixels[i1 + 1]) +
              Math.abs(pixels[i0 + 2] - pixels[i1 + 2]) + Math.abs(pixels[i0 + 3] - pixels[i1 + 3]) > 16) {
            frameDeltaPx++
          }
        }
      }
      const footYs = frameStats.map(s => s.bounds?.footY).filter(v => v !== undefined)
      const footDriftPx = footYs.length ? Math.max(...footYs) - Math.min(...footYs) : 0
      const totalOrphans = frameStats.reduce((s, f) => s + f.orphans, 0)
      const totalEdge = frameStats.reduce((s, f) => s + f.edgeTouches, 0)

      results.push({
        id: brief.id, ok: true, frames, frameWidth: fw, frameHeight: fh,
        uniqueColors: frameStats[0]?.uniqueColors ?? 0,
        fillRatio: frameStats[0]?.fillRatio ?? 0,
        lumRange: frameStats[0]?.lumRange ?? 0,
        orphans: totalOrphans, edgeTouches: totalEdge,
        footDriftPx, frameDeltaPx
      })
    } catch (err) {
      results.push({ id: brief.id, ok: false, error: String(err?.message ?? err) })
    }
  }
  const outPng = join(iterDir, 'pixel-art-sheet.png')
  await writeFile(outPng, encodePng(cardW, sheetH, sheet))
  return { outPng, results }
}

const iterArg = process.argv[2]
if (!iterArg) {
  console.error('Usage: node render-audit.mjs <iter-dir> [--hemi]')
  process.exit(1)
}
const useHemi = process.argv.includes('--hemi')
const iterDir = resolve(iterArg)
const briefs = JSON.parse(await readFile(new URL('./briefs.json', import.meta.url), 'utf8'))
await mkdir(iterDir, { recursive: true })
const lighting = useHemi ? {
  direction: [-0.45, 0.82, 0.36],
  ambient: 0.46,
  color: [1.0, 0.96, 0.88],
  skyColor: [0.76, 0.88, 1.0],
  groundColor: [0.54, 0.44, 0.38],
  rimColor: [0.96, 0.99, 1.0],
  rimStrength: 0.24
} : undefined

const lp = await auditLowPoly(iterDir, briefs.lowPoly, briefs.palette, lighting)
const px = await auditPixelArt(iterDir, briefs.pixelArt)
const report = { iteration: iterArg, useHemi, lowPoly: lp.results, pixelArt: px.results }
await writeFile(join(iterDir, 'audit.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
