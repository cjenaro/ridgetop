import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { artModels, bakeAnimatedSpritePixels, box, createArtBuilder, createArtKit, createArtRecipe, createMeshPool,
  modelFromArtRecipe, renderRig, rigFromArtModel, rigFromArtRecipe } from '../packages/ridgetop/framework/index.ts'
import type { ArtModel, ArtRecipe } from '../packages/ridgetop/framework/index.ts'

test('custom art shares mesh buffers and applies the kit palette and object transform', () => {
  const sign: ArtModel = { span: 4, centerY: 1, parts: [
    { mesh: box, position: [0, 1, 1], scale: [1, 2, .5], tone: 'accent' }
  ] }
  const kit = createArtKit({ palette: { accent: '#ff0080' }, models: { sign } })
  const group = kit.group()
  group.add('sign', [3, 0, 4], { yaw: Math.PI / 2, scale: 2 })
  group.add('sign', [0, 0, 0])
  assert.equal(group.batches.length, 1)
  const [batch] = group.batches
  assert.equal(batch.count, 2)
  assert.deepEqual([...batch.data.slice(0, 3)], [5, 2, 4])
  assert.deepEqual([...batch.data.slice(4, 7)], [2, 4, 1])
  assert.deepEqual([...batch.data.slice(8, 11)], [1, 0, Math.fround(128 / 255)])
  group.clear()
  group.add('sign', [2, 1, 0])
  assert.equal(group.batches[0], batch)
  assert.equal(batch.count, 1)
  for (const name of Object.keys(artModels) as (keyof typeof artModels)[]) {
    group.clear()
    group.add(name, [0, 0, 0])
    assert.equal(group.batches.reduce((n, b) => n + b.count, 0), kit.model(name).parts.length)
  }
})

test('invalid authored art fails before placing a partial object', () => {
  assert.throws(() => createArtKit({ palette: { glow: 'warm' } }), /RGB.*glow/)
  assert.throws(() => createArtKit({ models: { broken: { span: 0, centerY: 0, parts: [] } } }), /broken/)
  const group = createArtKit().group()
  assert.throws(() => group.add('pine', [0, 0, 0], { scale: -1 }), /transform/)
  assert.equal(group.batches.length, 0)
})

test('editable model JSON reproduces all stock geometry, colors and part transforms', () => {
  const stock = createArtKit()
  for (const name of Object.keys(artModels) as (keyof typeof artModels)[]) {
    const source = createArtRecipe(name)
    const model = modelFromArtRecipe(JSON.parse(JSON.stringify(source)))
    const copy = createArtKit({ models: { copy: model } })
    const expected = stock.group(), actual = copy.group()
    expected.add(name, [1, 2, 3], { yaw: .7 })
    actual.add('copy', [1, 2, 3], { yaw: .7 })
    assert.equal(actual.batches.length, expected.batches.length)
    for (const [i, batch] of actual.batches.entries()) {
      assert.equal(batch.mesh, expected.batches[i].mesh)
      assert.equal(batch.count, expected.batches[i].count)
      assert.deepEqual(batch.data, expected.batches[i].data)
    }
    assert.equal(new Set(source.parts.map(p => p.name)).size, source.parts.length)
  }
})

test('a model palette changes one asset while preserving shared mesh batching', () => {
  const source = createArtRecipe('ranger')
  source.parts = [{ name: 'coat', shape: 'box', position: [0, 0, 0], scale: [1, 1, 1], tone: 'accent' }]
  source.palette = { accent: '#ff0000' }
  source.timings = { turntable: 120 }
  const model = modelFromArtRecipe(source)
  source.palette.accent = '#000000'
  source.timings.turntable = 400
  assert.equal(model.timings.turntable, 120)
  const group = createArtKit({ palette: { accent: '#0000ff' }, models: {
    red: model, blue: { ...model, palette: {} }
  } }).group()
  group.add('red', [0, 0, 0])
  group.add('blue', [1, 0, 0])
  assert.equal(group.batches.length, 1)
  const { data } = group.batches[0]
  assert.deepEqual([...data.slice(8, 11)], [1, 0, 0])
  assert.deepEqual([...data.slice(24, 27)], [0, 0, 1])
  assert.equal(createArtRecipe('ranger').parts[0].name, 'left-boot')
})

test('invalid editable sources report the offending version, named part or frame setting', () => {
  const source = createArtRecipe('ranger')
  const part = source.parts[0]
  assert.throws(() => modelFromArtRecipe({ ...source, version: 9 }), /version/)
  assert.throws(() => modelFromArtRecipe({ ...source, parts: [part, part] }), /unique name/)
  assert.throws(() => modelFromArtRecipe({ ...source, parts: [{ ...part, shape: 'missing' }] }), /left-boot/)
  assert.throws(() => modelFromArtRecipe({ ...source, parts: [{ ...part, scale: [1, 0, 1] }] }), /left-boot/)
  assert.throws(() => modelFromArtRecipe({ ...source, frameSize: 0 }), /Frame size/)
  assert.throws(() => modelFromArtRecipe({ ...source, timings: { front: -2 } }), /frame time/)
  assert.throws(() => modelFromArtRecipe({ ...source, palette: { accent: 'blue' } }), /accent/)
})

test('rigged art schema validates joints, parent refs, cycles, part bindings, clips and prototype safety', () => {
  const base = createArtBuilder('scout', { base: 'biped' }).finish()
  // Both v1 and v2 rigged recipes parse cleanly.
  assert.ok(modelFromArtRecipe(base).joints?.length)
  assert.ok(modelFromArtRecipe({ ...base, version: 2 }).clips?.walk)

  // Duplicate / empty / forbidden joint IDs.
  assert.throws(() => modelFromArtRecipe({ ...base, joints: [{ id: 'root' }, { id: 'root' }] }), /unique valid id/)
  assert.throws(() => modelFromArtRecipe({ ...base, joints: [{ id: '   ' }] }), /unique valid id/)
  assert.throws(() => modelFromArtRecipe({ ...base, joints: [{ id: '__proto__' }] }), /unique valid id/)
  assert.throws(() => modelFromArtRecipe({ ...base, joints: [{ id: 'constructor' }] }), /unique valid id/)

  // Missing parent & non-finite pivot.
  assert.throws(() => modelFromArtRecipe({
    ...base,
    parts: base.parts.map(p => ({ ...p, joint: undefined })),
    clips: undefined,
    joints: [{ id: 'child', parent: 'missing' }]
  }), /Unknown parent joint/)
  assert.throws(() => modelFromArtRecipe({
    ...base,
    parts: base.parts.map(p => ({ ...p, joint: undefined })),
    clips: undefined,
    joints: [{ id: 'root', pivot: [0, NaN, 0] }]
  }), /Invalid pivot/)

  // Direct and multi-node cycles.
  assert.throws(() => modelFromArtRecipe({
    ...base,
    parts: base.parts.map(p => ({ ...p, joint: undefined })),
    clips: undefined,
    joints: [{ id: 'a', parent: 'a' }]
  }), /Cyclic joint/)
  assert.throws(() => modelFromArtRecipe({
    ...base,
    parts: base.parts.map(p => ({ ...p, joint: undefined })),
    clips: undefined,
    joints: [{ id: 'a', parent: 'c' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'b' }]
  }), /Cyclic joint/)

  // Unknown joint on part.
  assert.throws(() => modelFromArtRecipe({
    ...base,
    parts: [{ ...base.parts[0], joint: 'ghost-joint' }]
  }), /Unknown joint/)

  // Invalid clip duration, easing, empty frames, out-of-range / unsorted frame times, unknown joint in pose, invalid pose scale.
  const badClip = (clip: unknown) => ({ ...base, clips: { test: clip } })
  assert.throws(() => modelFromArtRecipe(badClip({ duration: 0, frames: [{ time: 0, poses: {} }] })), /positive finite duration/)
  assert.throws(() => modelFromArtRecipe(badClip({ duration: -1, frames: [{ time: 0, poses: {} }] })), /positive finite duration/)
  assert.throws(() => modelFromArtRecipe(badClip({ duration: Infinity, frames: [{ time: 0, poses: {} }] })), /positive finite duration/)
  assert.throws(() => modelFromArtRecipe(badClip({ duration: 1, easing: 'bounce', frames: [{ time: 0, poses: {} }] })), /Unknown easing/)
  assert.throws(() => modelFromArtRecipe(badClip({ duration: 1, loop: 'yes', frames: [{ time: 0, poses: {} }] })), /boolean/)
  assert.throws(() => modelFromArtRecipe(badClip({ duration: 1, frames: [] })), /at least one keyframe/)
  assert.throws(() => modelFromArtRecipe(badClip({
    duration: 1,
    frames: [{ time: 0.6, poses: {} }, { time: 0.2, poses: {} }]
  })), /sorted/)
  assert.throws(() => modelFromArtRecipe(badClip({
    duration: 1,
    frames: [{ time: 1.5, poses: {} }]
  })), /Invalid keyframe time/)
  assert.throws(() => modelFromArtRecipe(badClip({
    duration: 1,
    frames: [{ time: 0, poses: { nonexistent: { rotation: [0, 0, 0] } } }]
  })), /Unknown joint/)
  assert.throws(() => modelFromArtRecipe(badClip({
    duration: 1,
    frames: [{ time: 0, poses: { body: { scale: [1, 0, 1] } } }]
  })), /Invalid pose scale/)
  assert.throws(() => modelFromArtRecipe(badClip({
    duration: 1,
    frames: [{ time: 0, poses: { body: { rotation: [0, Infinity, 0] } } }]
  })), /Invalid pose rotation/)

  // Prototype-pollution keys rejected via both JSON.parse and object literals.
  const protoClipJson = JSON.parse(
    JSON.stringify({ ...base, clips: {} }).replace('"clips":{}', '"clips":{"__proto__":{"duration":1,"frames":[{"time":0,"poses":{}}]}}')
  )
  assert.throws(() => modelFromArtRecipe(protoClipJson), /Invalid animation clip/)
  const protoPoseJson = JSON.parse(
    JSON.stringify({ ...base, clips: { ok: { duration: 1, frames: [{ time: 0, poses: {} }] } } })
      .replace('"poses":{}', '"poses":{"__proto__":{"rotation":[0,0,0]}}')
  )
  assert.throws(() => modelFromArtRecipe(protoPoseJson), /Invalid pose|Unknown joint/)
  const protoLiteralClips = { ...base, clips: { __proto__: { duration: 1, frames: [{ time: 0, poses: {} }] } } }
  assert.throws(() => modelFromArtRecipe(protoLiteralClips), /Expected clips map/)
  const protoConstructorClips = { ...base, clips: { constructor: { duration: 1, frames: [{ time: 0, poses: {} }] } } }
  assert.throws(() => modelFromArtRecipe(protoConstructorClips), /Invalid animation clip/)
})

test('rigFromArtRecipe and kit.rig integrate with createAnimator and renderRig with exact rest-pose parity', () => {
  const recipe = createArtBuilder('ranger-rig', { base: 'biped', primary: 'accent', trim: 'wood' }).finish()
  const model = modelFromArtRecipe(recipe)
  const kit = createArtKit({ palette: { accent: '#ff8822' }, models: { hero: model } })

  // Rest pose via renderRig matches kit.group() transforms, scales and colors exactly.
  const staticGroup = kit.group()
  staticGroup.add('hero', [2, 1, -3], { yaw: 0.7, scale: 1.5 })
  const heroRig = kit.rig('hero')
  assert.equal(kit.rig('hero'), heroRig, 'kit.rig caches compiled rig')
  const pool = createMeshPool()
  renderRig(heroRig.rig, { position: [2, 1, -3], yaw: 0.7, scale: 1.5 }, {}, pool)
  assert.equal(pool.batches.reduce((n, b) => n + b.count, 0), staticGroup.batches.reduce((n, b) => n + b.count, 0))
  const collectInstances = (batches: readonly { mesh: unknown; count: number; data: Float32Array }[]) => {
    const entries: number[][] = []
    for (const b of batches) {
      for (let i = 0; i < b.count; i++) entries.push([...b.data.slice(i * 16, i * 16 + 16)])
    }
    return entries.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]))
  }
  const expected = collectInstances(staticGroup.batches)
  const actual = collectInstances(pool.batches)
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    for (let j = 0; j < 16; j++) {
      assert.ok(Math.abs(actual[i][j] - expected[i][j]) < 1e-4, `mismatch at instance ${i} float ${j}`)
    }
  }

  // Animator transitions cleanly from idle to walk and drives renderRig.
  const animator = heroRig.createAnimator()
  assert.equal(animator.clip, 'idle')
  animator.step(0.4)
  animator.play('walk', 0.1)
  animator.step(0.2)
  pool.clear()
  const worldJoints = renderRig(heroRig.rig, { position: [0, 0, 0] }, animator.evaluate(), pool)
  assert.ok(worldJoints.head && worldJoints['left-leg'] && worldJoints['right-leg'])
  assert.equal(pool.batches.reduce((n, b) => n + b.count, 0), model.parts.length)

  // Standalone rigFromArtModel + kit.animatedSpritePixels work on both rigged and static built-in models.
  const directRig = rigFromArtModel(model, { accent: '#ff8822' })
  assert.equal(directRig.rig.joints.length, heroRig.rig.joints.length)
  const stockRig = kit.rig('ranger')
  const stockAnim = stockRig.createAnimator()
  pool.clear()
  renderRig(stockRig.rig, { position: [0, 0, 0] }, stockAnim.evaluate(), pool)
  assert.equal(pool.batches.reduce((n, b) => n + b.count, 0), artModels.ranger.parts.length)
  const baked = kit.animatedSpritePixels('hero', { clip: 'walk', frames: 4, frameSize: 24 })
  assert.equal(baked.width, 4 * 24)
  assert.equal(baked.height, 8 * 24)
  assert.ok(baked.manifest.clips['walk-front'])
})

test('all existing v1 starter and library .art.json recipes remain 100% compatible', async () => {
  const root = new URL('../examples/starter/art/', import.meta.url)
  const libraryDir = new URL('library/', root)
  const libraryFiles = (await readdir(libraryDir)).filter(f => f.endsWith('.art.json'))
  assert.ok(libraryFiles.length >= 10, 'expected library art recipes')
  const urls = [new URL('rain-ranger.art.json', root), ...libraryFiles.map(f => new URL(f, libraryDir))]
  for (const url of urls) {
    const raw: ArtRecipe = JSON.parse(await readFile(url, 'utf8'))
    const model = modelFromArtRecipe(raw)
    assert.ok(model.parts.length > 0, url.pathname)
    const { rig, createAnimator } = rigFromArtRecipe(raw)
    const pool = createMeshPool()
    renderRig(rig, { position: [0, 0, 0] }, createAnimator().evaluate(), pool)
    assert.equal(pool.batches.reduce((n, b) => n + b.count, 0), model.parts.length, url.pathname)
  }
  // Headless animated baker handles static v1 recipes cleanly via fallback rest clip.
  const rainRanger = JSON.parse(await readFile(new URL('rain-ranger.art.json', root), 'utf8'))
  const restSheet = bakeAnimatedSpritePixels(rainRanger, { frameSize: 16, directions: ['front', 'right'] })
  assert.equal(restSheet.width, 16)
  assert.equal(restSheet.height, 32)
  assert.deepEqual(Object.keys(restSheet.manifest.clips), ['rest-front', 'rest-right'])
})
