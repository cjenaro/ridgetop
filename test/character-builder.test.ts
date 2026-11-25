import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bakeZoneColors,
  CHARACTER_SOCKETS,
  createCharacterBuilder,
  createCharacterPalette,
  createMeshPool,
  mixColor,
  renderCharacterTurntablePixels,
  renderRig,
  sculptLoft,
  shadeColor
} from '../packages/ridgetop/framework/index.ts'
import type { Mesh, Rig } from '../packages/ridgetop/framework/index.ts'

function verifyOutwardWinding(m: Mesh) {
  const data = m.data
  let minY = Infinity
  let maxY = -Infinity
  let sumX = 0
  let sumY = 0
  let sumZ = 0
  for (let i = 0; i < m.vertexCount; i++) {
    const o = i * 6
    const x = data[o], y = data[o + 1], z = data[o + 2]
    sumX += x; sumY += y; sumZ += z
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const cx = sumX / m.vertexCount
  const cy = sumY / m.vertexCount
  const cz = sumZ / m.vertexCount

  let outwardCount = 0
  const triCount = m.vertexCount / 3
  for (let i = 0; i < m.vertexCount; i += 3) {
    const o0 = i * 6, o1 = (i + 1) * 6, o2 = (i + 2) * 6
    const tx = (data[o0] + data[o1] + data[o2]) / 3 - cx
    const ty = (data[o0 + 1] + data[o1 + 1] + data[o2 + 1]) / 3 - cy
    const tz = (data[o0 + 2] + data[o1 + 2] + data[o2 + 2]) / 3 - cz
    const nx = data[o0 + 3], ny = data[o0 + 4], nz = data[o0 + 5]
    if (tx * nx + ty * ny + tz * nz > 0) outwardCount++
  }
  assert.equal(outwardCount, triCount, 'Every face normal on a convex loft must point outward')
  return { minY, maxY }
}

function measureRigBoundsY(rig: Rig): { minY: number; maxY: number } {
  const pool = createMeshPool(32)
  const joints = renderRig(rig, { position: [0, 0, 0] }, {}, pool)
  let minY = Infinity
  let maxY = -Infinity
  for (const joint of rig.joints) {
    const world = joints[joint.id]
    if (!world || !joint.parts) continue
    for (const part of joint.parts) {
      const lp = part.position ?? [0, 0, 0]
      const ps = part.scale ?? [1, 1, 1]
      const baseY = world.position[1] + lp[1] * world.scale[1]
      const sy = ps[1] * world.scale[1]
      const data = part.mesh.data
      for (let i = 0; i < part.mesh.vertexCount; i++) {
        const wy = baseY + data[i * 6 + 1] * sy
        if (wy < minY) minY = wy
        if (wy > maxY) maxY = wy
      }
    }
  }
  return { minY, maxY }
}

test('sculptLoft generates closed flat-faceted meshes with verified outward CCW winding', () => {
  const parametric = sculptLoft([
    { y: 0, rx: 0.25, rz: 0.20, frontFlat: 0.1 },
    { y: 0.5, rx: 0.30, rz: 0.24, frontFlat: 0.1 },
    { y: 1.0, rx: 0.18, rz: 0.16 }
  ], { sides: 8, aoStrength: 0.16 })
  assert.ok(parametric.vertexCount > 0)
  assert.ok(parametric.colors && parametric.colors.length === parametric.vertexCount * 3)
  const bounds = verifyOutwardWinding(parametric)
  assert.ok(Math.abs(bounds.minY - 0) < 1e-5)
  assert.ok(Math.abs(bounds.maxY - 1) < 1e-5)

  // Reversed ring order (top-to-bottom) must still produce outward winding
  const reversed = sculptLoft([
    { y: 1.0, rx: 0.2, rz: 0.2 },
    { y: 0.0, rx: 0.3, rz: 0.3 }
  ], { sides: 6 })
  verifyOutwardWinding(reversed)

  // Custom 2D polygon rings (even CW-ordered) must auto-normalize to outward winding
  const cwSquare: readonly (readonly [number, number])[] = [
    [-0.2, -0.2], [-0.2, 0.2], [0.2, 0.2], [0.2, -0.2]
  ]
  const polyLoft = sculptLoft([
    { y: -0.5, points: cwSquare },
    { y: 0.5, points: cwSquare }
  ])
  verifyOutwardWinding(polyLoft)
})

test('shadeColor, mixColor, bakeZoneColors, and createCharacterPalette work cleanly', () => {
  const darker = shadeColor([0.5, 0.4, 0.3, 0.8], -0.2)
  assert.ok(Math.abs(darker[0] - 0.3) < 1e-6)
  assert.ok(Math.abs(darker[3] - 0.8) < 1e-6)

  const mid = mixColor([0, 0, 0, 1], [1, 0.5, 0.2, 1], 0.5)
  assert.ok(Math.abs(mid[0] - 0.5) < 1e-6)
  assert.ok(Math.abs(mid[1] - 0.25) < 1e-6)

  const pal = createCharacterPalette({ primary: '#336699', skin: [0.9, 0.7, 0.6, 1] })
  assert.ok(pal.primary[2] > pal.primary[0])
  assert.ok(pal.primaryDark[2] < pal.primary[2])
  assert.ok(pal.skinShade[0] < pal.skin[0])

  const baseMesh = sculptLoft([
    { y: 0, rx: 0.2, rz: 0.2 },
    { y: 1, rx: 0.2, rz: 0.2 }
  ], { sides: 6 })
  const zoned = bakeZoneColors(baseMesh, (_cx, cy) => (cy > 0.5 ? [1, 0, 0, 1] : [0, 0, 1, 1]))
  assert.ok(zoned.colors && zoned.colors.length === zoned.vertexCount * 3)
  let sawRed = false
  let sawBlue = false
  for (let i = 0; i < zoned.vertexCount; i++) {
    const ci = i * 3
    if (zoned.colors[ci] > 0.9 && zoned.colors[ci + 2] < 0.1) sawRed = true
    if (zoned.colors[ci + 2] > 0.9 && zoned.colors[ci] < 0.1) sawBlue = true
  }
  assert.ok(sawRed && sawBlue)
})

test('createCharacterBuilder assembles grounded humanoid rig with interchangeable socket parts', () => {
  const builder = createCharacterBuilder()
  assert.ok(builder.hasBody('humanoid'))
  assert.ok(builder.hasBody('humanoid_slim'))
  assert.ok(builder.hasBody('humanoid_broad'))
  assert.ok(builder.hasPart('chest', 'tunic_basic'))
  assert.ok(builder.hasPart('belt', 'belt_basic'))
  assert.ok(builder.hasPart('hair', 'hair_short'))
  assert.ok(builder.hasPart('brows', 'brows_bold'))
  assert.equal(builder.sockets.mainHand.joint, 'armR')
  assert.equal(builder.sockets.offHand.joint, 'armL')
  assert.equal(builder.sockets.back.joint, 'cape')
  assert.ok(Object.keys(CHARACTER_SOCKETS).length === 18)

  const bareRig = builder.assemble({ body: 'humanoid' })
  const bareBounds = measureRigBoundsY(bareRig)
  assert.ok(Math.abs(bareBounds.minY) < 0.01, `Bare mannequin feet must sit cleanly at y=0 (got ${bareBounds.minY})`)
  assert.ok(bareBounds.maxY >= 1.58 && bareBounds.maxY <= 1.66, `Bare mannequin height should be ~1.62 (got ${bareBounds.maxY})`)

  // Register a custom socket part and assemble a dressed character
  builder.registerPart('mainHand', 'club_test', (palette) => [{
    name: 'club_shaft',
    mesh: sculptLoft([{ y: -0.05, rx: 0.03, rz: 0.03 }, { y: 0.40, rx: 0.05, rz: 0.05 }], { sides: 6 }),
    color: palette.leather
  }])
  assert.ok(builder.listParts('mainHand').includes('club_test'))

  const dressedUnmerged = builder.assemble({
    body: 'humanoid',
    mergeJointMeshes: false,
    palette: { primary: '#2d6a6e', hair: '#b84a27', accent: '#eab308' },
    parts: {
      chest: 'tunic_basic',
      belt: 'belt_basic',
      hair: 'hair_short',
      brows: 'brows_bold',
      mainHand: 'club_test'
    }
  })
  const armR = dressedUnmerged.joints.find(j => j.id === 'armR')
  assert.ok(armR?.parts?.some(p => p.name === 'club_shaft'))
  const bodyJoint = dressedUnmerged.joints.find(j => j.id === 'body')
  assert.ok(bodyJoint?.parts?.some(p => p.name === 'tunic_body'))
  assert.ok(bodyJoint?.parts?.some(p => p.name === 'belt_strap'))

  // Default mergeJointMeshes=true collapses per-joint opaque sub-meshes for low draw calls
  const dressedMerged = builder.assemble({
    body: 'humanoid',
    palette: { primary: '#2d6a6e', hair: '#b84a27', accent: '#eab308' },
    parts: {
      chest: 'tunic_basic',
      belt: 'belt_basic',
      hair: 'hair_short',
      brows: 'brows_bold',
      mainHand: 'club_test'
    }
  })
  const mergedParts = dressedMerged.joints.reduce((sum, j) => sum + (j.parts?.length ?? 0), 0)
  const unmergedParts = dressedUnmerged.joints.reduce((sum, j) => sum + (j.parts?.length ?? 0), 0)
  assert.ok(mergedParts < unmergedParts, `Expected merged parts (${mergedParts}) < unmerged (${unmergedParts})`)
  assert.ok(mergedParts <= 10, `Expected <= 10 merged joint meshes, got ${mergedParts}`)

  // Scale option scales height cleanly while staying grounded at y=0
  const tallRig = builder.assemble({ body: 'humanoid', scale: 1.5 })
  const tallBounds = measureRigBoundsY(tallRig)
  assert.ok(Math.abs(tallBounds.minY) < 0.015)
  assert.ok(tallBounds.maxY > 2.35 && tallBounds.maxY < 2.50)
})

test('renderCharacterTurntablePixels produces a crisp 4-angle RGBA studio strip', () => {
  const builder = createCharacterBuilder()
  const rig = builder.assemble({
    parts: { chest: 'tunic_basic', belt: 'belt_basic', hair: 'hair_short', brows: 'brows_bold' }
  })
  const result = renderCharacterTurntablePixels(rig, { cellSize: 64 })
  assert.equal(result.width, 256)
  assert.equal(result.height, 64)
  assert.equal(result.pixels.length, 256 * 64 * 4)

  // Verify every one of the 4 cells contains distinct foreground character pixels (not blank backdrop)
  const bgR = result.pixels[0]
  const bgG = result.pixels[1]
  const bgB = result.pixels[2]
  for (let col = 0; col < 4; col++) {
    let diffPixels = 0
    for (let y = 0; y < 64; y++) {
      for (let x = 2; x < 62; x++) {
        const idx = (y * 256 + col * 64 + x) * 4
        if (Math.abs(result.pixels[idx] - bgR) + Math.abs(result.pixels[idx + 1] - bgG) + Math.abs(result.pixels[idx + 2] - bgB) > 40) {
          diffPixels++
        }
      }
    }
    assert.ok(diffPixels > 250, `Turntable cell ${col} should contain visible character pixels (found ${diffPixels})`)
  }
})
