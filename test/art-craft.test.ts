import assert from 'node:assert/strict'
import test from 'node:test'
import {
  auditArtModel, auditSpriteSheet, bakeSpritePixels, bakeVertexAO, color, createArtBuilder, createArtKit,
  createPixelRig, createShadowBatch, createSpriteSheet, extrudeMesh, gableMesh, hueShiftRamp, instances, mesh,
  modelFromArtRecipe, normalTiltQuaternion, packLighting, pixelClips, renderPixelRig, tubeMesh, wedgeMesh
} from '../packages/ridgetop/framework/index.ts'
import { encodeGlb } from '../packages/ridgetop/framework/export-godot.ts'

test('stylized hemisphere, toon, rim lighting, and shadow map pack cleanly and alter Canvas 2D sprite shading', () => {
  const packed = packLighting({
    direction: [-0.4, 0.8, 0.3],
    ambient: 0.45,
    skyColor: [0.75, 0.88, 1.0],
    groundColor: [0.5, 0.4, 0.35],
    toonSteps: 3,
    rimColor: [1, 0.98, 0.92],
    rimStrength: 0.25,
    shadows: { enabled: true, center: [1, 2, 3], extent: 20, bias: 0.002, strength: 0.48, color: [0.24, 0.34, 0.52] }
  })
  assert.equal(packed.length, 72)
  assert.equal(packed[51], 1)
  assert.equal(packed[55], 3)
  assert.equal(packed[59], 0.25)
  assert.equal(packed[60], 1)
  assert.equal(packed[63], 20)
  assert.equal(packed[64], 1)
  assert.ok(Math.abs(packed[66] - 0.48) < 1e-5)
  assert.ok(Math.abs(packed[68] - 0.24) < 1e-5)

  const kit = createArtKit()
  const grp = kit.group()
  grp.add('ranger', [0, 0, 0])
  const flat = bakeSpritePixels(grp.batches, { span: 1.8, center: [0, 0.7, 0], frameSize: 32 })
  const hemi = bakeSpritePixels(grp.batches, {
    span: 1.8, center: [0, 0.7, 0], frameSize: 32,
    lighting: { skyColor: [0.7, 0.88, 1.0], groundColor: [0.5, 0.36, 0.3], rimStrength: 0.25 }
  })
  assert.notDeepEqual(hemi.pixels, flat.pixels)
})

test('new low-poly shapes, custom palette, alpha glass, curve(), autoGround clip, and auditArtModel work end to end', () => {
  assert.ok(wedgeMesh().vertexCount > 0)
  assert.ok(gableMesh().vertexCount > 0)
  assert.ok(extrudeMesh([[0, 0], [1, 0], [0.5, 1]], 0.2).vertexCount > 0)
  assert.ok(tubeMesh([[0, 0, 0], [0, 0.5, 0.2], [0, 1, 0]], [0.1, 0.08, 0.05], 6).vertexCount > 0)

  const art = createArtBuilder('glass-beacon', { frameSize: 32 })
  art.palette('brass', '#d8a648')
  art.palette('glass', '#9adcf0')
  art.solid('base', 'prism', [0.7, 0.2, 0.7], 'brass', [0, 0.1, 0])
  art.solid('core', 'teardrop', [0.22, 0.32, 0.22], 'glow', [0, 0.42, 0], [0, 0, 0], { unlit: 0.95 })
  art.solid('globe', 'cylinder', [0.52, 0.48, 0.52], 'glass', [0, 0.44, 0], [0, 0, 0], { alpha: 0.32, blend: 'alpha' })
  art.solid('roof', 'gable', [0.74, 0.28, 0.74], 'brass', [0, 0.82, 0], [0, 0, 0], { shade: -0.15 })
  art.curve('bail', [[-0.25, 0.92, 0], [-0.22, 1.24, 0], [0.22, 1.24, 0], [0.25, 0.92, 0]], 0.06, 'ink')
  const recipe = art.finish()
  assert.equal(recipe.version, 2)
  const model = modelFromArtRecipe(recipe)
  const audit = auditArtModel(model, { frameSize: 32 })
  assert.equal(audit.hiddenParts.length, 0, 'Inner core should remain visible through translucent glass')
  assert.equal(audit.detachedParts.length, 0)
  assert.equal(audit.edgeTouches, 0)
})

test('pixel-art stamp, palette-locked selout, hueShiftRamp, and multi-frame auditSpriteSheet work cleanly', () => {
  const green = hueShiftRamp('#559e5a')
  const warm = hueShiftRamp('#d96638')
  assert.match(green.ink, /^#[0-9a-f]{6}$/)
  assert.match(warm.dark, /^#[0-9a-f]{6}$/)
  const pal = {
    i: green.ink, d: green.dark, m: green.mid, l: green.light, h: green.highlight,
    w: warm.mid, s: warm.dark
  }
  const sheet = createSpriteSheet(16, 16, 2, 1)
  for (let f = 0; f < 2; f++) {
    const cell = sheet.frame(f, 0)
    cell.stamp(4, 3 + f, [
      '..hl..',
      '.hmml.',
      '.mddd.',
      '.smmw.',
      '..dd..'
    ], pal)
    cell.outline('selout', { palette: pal })
  }
  const report = auditSpriteSheet(sheet, { maxColors: 10, maxFillRatio: 0.6 })
  assert.equal(report.passed, true, `Unexpected audit warnings: ${report.warnings.join('; ')}`)
  assert.ok(report.uniqueColors <= 7, `Palette-locked selout should add zero extra colors (got ${report.uniqueColors})`)
  assert.equal(report.orphans, 0)
  assert.ok(report.frameDeltaPx >= 10)
})

test('ArtBuilder seamless tube, bakeCreviceShade, and applyClipPreset work end to end', () => {
  const art = createArtBuilder('tailed-scout', { base: 'biped', frameSize: 32 })
  art.joint('tail', 'body', [0, 0.45, -0.22])
  art.tube('fox-tail', [[0, 0.45, -0.22], [0, 0.36, -0.55], [0, 0.65, -0.82]], [0.10, 0.16, 0.06], 'accent', { sides: 6, style: { joint: 'tail' } })
  art.bakeCreviceShade(0.12)
  art.applyClipPreset('idle', 'biped-idle')
  art.applyClipPreset('walk', 'biped-walk')
  art.applyClipPreset('run', 'biped-run')
  const recipe = art.finish()
  assert.equal(recipe.version, 2)
  assert.ok(recipe.parts.some(p => p.shape === 'tube'))
  const model = modelFromArtRecipe(recipe)
  assert.ok(model.clips?.walk && model.clips?.run && model.clips?.idle)
  const audit = auditArtModel(model, { frameSize: 32 })
  assert.equal(audit.detachedParts.length, 0)
  assert.equal(audit.edgeTouches, 0)
})

test('2D PixelRig animation skeleton composes parent-child joints, z-order, variants, and palette-locked selout', () => {
  const green = hueShiftRamp('#4d9a54')
  const pal = { i: green.ink, d: green.dark, m: green.mid, l: green.light, h: green.highlight }
  const rig = createPixelRig([
    { id: 'torso', pivot: [0, 0], z: 2, stamp: { offset: [-2, -3], rows: ['.lm.', 'lmmd', 'dmmd', '.dd.'] } },
    { id: 'head', parent: 'torso', pivot: [0, -4], z: 3, stamp: { offset: [-2, -3], rows: ['.hl.', 'hmml', 'mmdd'] } },
    { id: 'crest', parent: 'head', pivot: [0, -3], z: 4, variants: {
      f0: { offset: [-1, -2], rows: ['h.h', '.l.'] },
      f1: { offset: [-1, -2], rows: ['.hl', '.l.'] },
      f2: { offset: [-1, -2], rows: ['h.h', '.l.'] },
      f3: { offset: [-1, -2], rows: ['lh.', '.l.'] }
    } },
    { id: 'backLeg', pivot: [-1, 2], z: 0, stamp: { offset: [-1, 0], rows: ['dd', 'dd', 'id'] } },
    { id: 'frontLeg', pivot: [1, 2], z: 1, stamp: { offset: [-1, 0], rows: ['mm', 'dd', 'id'] } }
  ])
  const sheet = createSpriteSheet(24, 24, 4, 1)
  const poses = pixelClips.bipedRun(4, { stride: 2, bob: 1 })
  for (let f = 0; f < 4; f++) {
    renderPixelRig(sheet.frame(f, 0), rig, [12, 14], poses[f], pal, { outline: 'selout' })
  }
  const report = auditSpriteSheet(sheet, { maxColors: 8, maxFillRatio: 0.65, maxFootDriftPx: 1 })
  assert.equal(report.passed, true, `Unexpected PixelRig warnings: ${report.warnings.join('; ')}`)
  assert.ok(report.uniqueColors <= 5)
  assert.ok(report.frameDeltaPx >= 12)
  assert.equal(poses[0].frontLeg?.variant, 'f0')
  assert.equal(poses[2].frontLeg?.variant, 'f2')
})

test('vertex-colored meshes, bakeVertexAO, slope-conforming shadows, frame.glint, and 3D-to-pixel selout baking work cleanly', () => {
  const vMesh = mesh(
    [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1],
    [0, 2, 1, 1, 2, 3],
    [1, 0.5, 0.2, 0.2, 0.8, 0.4, 0.3, 0.5, 0.9, 1, 1, 1]
  )
  assert.ok(vMesh.colors && vMesh.colors.length === vMesh.vertexCount * 3)
  const aoMesh = bakeVertexAO(vMesh, { strength: 0.3, verticalGradient: 0.2 })
  assert.ok(aoMesh.colors && aoMesh.colors.length === aoMesh.vertexCount * 3)
  // Lowest vertex should be darkened relative to original color
  assert.ok(aoMesh.colors[0] < vMesh.colors[0])

  // GLB export carries COLOR_0 for vertex-colored batches
  const batch = instances(aoMesh)
  batch.add([0, 0, 0], [1, 1, 1], 0, color('ffffff'))
  const glb = encodeGlb([batch], 'VertexColorTerrain')
  assert.ok(glb.includes(Buffer.from('COLOR_0')))

  // Slope-conforming shadow batch tilts onto sloped ground normals
  const qSlope = normalTiltQuaternion([0.3, 0.9, 0.1])
  assert.ok(Math.abs(Math.hypot(qSlope[0], qSlope[1], qSlope[2], qSlope[3]) - 1) < 1e-5)
  const shadows = createShadowBatch({
    heightAt: (x, z) => x * 0.25 + z * 0.1,
    normalAt: () => [0.25, 0.95, 0.1],
    penumbra: 0.35
  })
  shadows.add([2, 1.8, 1], { radius: 1.2, radiusZ: 0.8 })
  assert.equal(shadows.batch.count, 2) // umbra + penumbra

  // frame.glint draws a crisp cross highlight and clips safely near edges
  const sheet = createSpriteSheet(12, 12, 1, 1)
  const cell = sheet.frame(0, 0)
  cell.glint(6, 6, '#ffffff', '#ffd875', 5)
  assert.equal(cell.getPixel(6, 6), '#ffffff')
  assert.equal(cell.getPixel(4, 6), '#ffd875')
  assert.equal(cell.getPixel(8, 6), '#ffd875')

  // 3D-to-pixel bake with outline:'selout' adds crisp dark border pixels around the baked silhouette
  const kit = createArtKit()
  const grp = kit.group()
  grp.add('ranger', [0, 0, 0])
  const raw = bakeSpritePixels(grp.batches, { span: 1.8, center: [0, 0.7, 0], frameSize: 32 })
  const outlined = bakeSpritePixels(grp.batches, { span: 1.8, center: [0, 0.7, 0], frameSize: 32, outline: 'selout' })
  let rawOpaque = 0, outOpaque = 0
  for (let i = 3; i < raw.pixels.length; i += 4) {
    if (raw.pixels[i] >= 128) rawOpaque++
    if (outlined.pixels[i] >= 128) outOpaque++
  }
  assert.ok(outOpaque > rawOpaque, `Expected selout outline to add silhouette border pixels (${outOpaque} vs ${rawOpaque})`)
})

test('bug-hunt regressions: mesh/AO/extrude/tube/shadows/pixel-engine/pixel-rig/art-review edge cases', () => {
  // 1. Indexed mesh with indices.length === positions.length/3 resolves per-position colors via indices
  const permuted = mesh(
    [0, 0, 0, 1, 0, 0, 0, 1, 0],
    [0, 2, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 1]
  )
  assert.deepEqual([...permuted.colors!], [1, 0, 0, 0, 0, 1, 0, 1, 0])
  assert.throws(() => mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], undefined, [NaN, 0, 0, 0, 1, 0, 0, 0, 1]), RangeError)

  // 2. bakeVertexAO preserves full brightness on flat planes (no artificial 14% darkening) and handles NaN options
  const flat = mesh([0, 0, 0, 1, 0, 0, 0, 0, 1], [0, 2, 1])
  const flatAO = bakeVertexAO(flat, { strength: NaN, verticalGradient: NaN })
  assert.ok(Math.abs(flatAO.colors![0] - 1) < 1e-5)

  // 3. extrudeMesh handles collinear vertices & CW polygons; tubeMesh handles hairpins & rejects bad radii
  const colExtrude = extrudeMesh([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]], 0.2)
  assert.ok(colExtrude.vertexCount >= 36)
  const hairpin = tubeMesh([[0, 0, 0], [0, 1, 0], [0, 0, 0]], [0.1, 0.1, 0.1], 5)
  assert.ok(hairpin.vertexCount > 0)
  assert.throws(() => tubeMesh([[0, 0, 0], [0, 1, 0]], [], 5), RangeError)

  // 4. packLighting partial shadows update preserves enabled, strength: 0, and black [0, 0, 0]
  const l1 = packLighting({ shadows: { enabled: true, strength: 0, color: [0, 0, 0], center: [1, 2, 3] } })
  const l2 = packLighting({ shadows: { center: [4, 5, 6] } }, l1)
  assert.equal(l2[64], 1)
  assert.equal(l2[66], 0)
  assert.equal(l2[68], 0)
  assert.equal(l2[69], 0)
  assert.equal(l2[70], 0)

  // 5. SpriteFrame clipping, rounding, NaN safety, grayscale hueShiftRamp, and out-of-bounds audit row
  const s = createSpriteSheet(12, 12, 2, 1)
  const f0 = s.frame(0, 0)
  f0.pixel(1, 0, '#112233')
  f0.pixel(2, 0, '#445566')
  assert.equal(f0.getPixel(1.4, 0), '#112233')
  assert.equal(f0.getPixel(NaN, 0), null)
  f0.line(NaN, 0, 5, 5, '#ffffff')
  f0.line(-1e9, 2, 1e9, 2, '#ffffff')
  assert.equal(f0.getPixel(6, 2), '#ffffff')
  f0.mirrorX(Infinity)
  s.frame(1, 0).copyFrom(0, 0, 1.4, 0)
  assert.equal(s.frame(1, 0).getPixel(2, 0), '#112233')
  assert.throws(() => auditSpriteSheet(s, { row: 1 }), RangeError)

  // Grayscale hueShiftRamp shifts cool slate blue (B > R), not pink/magenta
  const gray = hueShiftRamp('#808080')
  const rDark = Number.parseInt(gray.dark.slice(1, 3), 16)
  const bDark = Number.parseInt(gray.dark.slice(5, 7), 16)
  assert.ok(bDark >= rDark, `Expected cool blue-slate shadow for gray, got ${gray.dark}`)

  // 6. PixelRig rejects prototype pollution keys and isolates outline from pre-existing backdrop pixels
  assert.throws(() => createPixelRig([{ id: '__proto__' }]))
  const rigSheet = createSpriteSheet(16, 16, 1, 1)
  const rf = rigSheet.frame(0, 0)
  rf.pixel(1, 1, '#224466') // existing background pixel
  const tinyRig = createPixelRig([{ id: 'body', pivot: [0, 0], stamp: { offset: [0, 0], rows: ['aa', 'aa'] } }])
  renderPixelRig(rf, tinyRig, [8, 8], {}, { a: '#88cc66' }, { outline: '#111111' })
  assert.equal(rf.getPixel(1, 0), null, 'Backdrop pixel should NOT be outlined by renderPixelRig')
  assert.equal(rf.getPixel(7, 8), '#111111', 'Rig itself should be outlined cleanly')

  // 7. auditArtModel accepts ArtRecipe directly and sees additive inner flame inside translucent globe
  const art = createArtBuilder('lantern-check', { frameSize: 32 })
  art.palette('glass', '#9adcf0')
  art.solid('core', 'teardrop', [0.24, 0.34, 0.24], 'glow', [0, 0.42, 0], [0, 0, 0], { unlit: 1, blend: 'additive' })
  art.solid('globe', 'cylinder', [0.56, 0.50, 0.56], 'glass', [0, 0.44, 0], [0, 0, 0], { alpha: 0.3, blend: 'alpha' })
  art.solid('base', 'prism', [0.7, 0.2, 0.7], 'ink', [0, 0.1, 0])
  art.bakeCreviceShade(0.12)
  const rec = art.finish()
  const rep = auditArtModel(rec, { frameSize: 32 })
  assert.equal(rep.hiddenParts.length, 0, `Expected additive inner core visible through glass, got hidden: ${rep.hiddenParts.join(',')}`)

  // 8. ID picking & auditArtModel work accurately on dark vertex-colored / bakeVertexAO meshes
  const darkAO = bakeVertexAO(mesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], [0, 1, 2, 1, 3, 2], [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]))
  const aoModel = {
    span: 2.2,
    centerY: 0.5,
    frameSize: 32,
    parts: [
      { name: 'a', mesh: darkAO, position: [-0.6, 0, 0] as const, scale: [0.5, 0.5, 0.5] as const, tone: 'ground' },
      { name: 'b', mesh: darkAO, position: [0.6, 0, 0] as const, scale: [0.5, 0.5, 0.5] as const, tone: 'accent' }
    ]
  }
  const aoAudit = auditArtModel(aoModel, { frameSize: 32 })
  assert.equal(aoAudit.hiddenParts.length, 0, 'Vertex-colored dark meshes must not corrupt RGB ID picking')

  // 9. Extreme-overflow line() and white/black hueShiftRamp bounds
  f0.line(-1e308, 5, 1e308, 5, '#ffffff')
  const whiteRamp = hueShiftRamp('#ffffff')
  assert.equal(whiteRamp.highlight, '#ffffff')
  const blackRamp = hueShiftRamp('#000000')
  assert.equal(blackRamp.ink, '#000000')
})
