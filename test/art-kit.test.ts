import assert from 'node:assert/strict'
import test from 'node:test'
import { artModels, box, createArtKit, createArtRecipe, modelFromArtRecipe } from '../framework/index.ts'
import type { ArtModel } from '../framework/index.ts'

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
