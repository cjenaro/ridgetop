import assert from 'node:assert/strict'
import test from 'node:test'
import { artBases, artPartBounds, bakeSpritePixels, createArtBuilder, createArtKit, fitArtRecipe, modelFromArtRecipe,
  quaternionFromEuler, rotateVec3 } from '../framework/index.ts'
import type { ArtRecipe, Vec3 } from '../framework/index.ts'
import { spritePartVisibility } from '../framework/art-review.ts'

const near = (value: number, target: number) => assert.ok(Math.abs(value-target) < 1e-5, value+' should equal '+target)

test('starter bodies export editable named parts, inherit the game palette and ground their geometry', () => {
  for (const base of artBases.filter(base => base !== 'empty')) {
    const art = createArtBuilder('sample', { base, proportions: [1.4,.87,1.1], primary: 'accent' })
    art.attach('marker', 'body', 'front', 'box', [.18,.18,.08], 'glow')
    const recipe = art.finish(), copy = art.finish()
    assert.deepEqual(recipe, copy)
    assert.deepEqual(copy.palette, {})
    assert.equal(copy.frameSize, 32)
    assert.equal(new Set(copy.parts.map(p => p.name)).size, copy.parts.length)
    const model = modelFromArtRecipe(JSON.parse(JSON.stringify(copy)))
    const bounds = model.parts.map(artPartBounds)
    near(Math.min(...bounds.map(b => b.min[1])), 0)
    for (const i of [0,2]) near(Math.min(...bounds.map(b => b.min[i]))+Math.max(...bounds.map(b => b.max[i])), 0)
    recipe.parts[0].tone = 'ink'
    assert.deepEqual(art.finish(), copy)
  }
})

test('endpoint links connect in any direction and retain their orientation under object yaw', () => {
  for (const end of [[0,-2,0],[2,0,0],[0,0,2],[1,.4,-.7]] as Vec3[]) {
    const b = createArtBuilder('tool')
    b.between('link',[0,0,0],end,.3,'accent','taper')
    const model = modelFromArtRecipe(b.finish()), p = model.parts[0]
    const q = quaternionFromEuler(p.pitch,p.yaw,p.roll)
    const direction = rotateVec3(q,[0,1,0]), length = Math.hypot(...end)
    for (let i=0;i<3;i++) near(direction[i]*length,end[i])
    const group = createArtKit({ models: { tool:model } }).group()
    group.add('tool',[0,0,0],{ yaw:.7 })
    const packed = group.batches[0].data.slice(12,16)
    const result = rotateVec3([packed[0],packed[1],packed[2],packed[3]],[0,1,0])
    const expected = rotateVec3(quaternionFromEuler(0,.7),direction)
    for (let i=0;i<3;i++) near(result[i],expected[i])
  }
})

test('framing projects every tilted vertex inside the two-pixel gutter at all eight angles', () => {
  const art = createArtBuilder('boom')
  art.solid('base','bowl',[.85,.7,.63],'leaf',[3,1,-2])
  const tip = art.point('base','top',[1.4,.9,.34])
  art.between('arm',art.point('base','top'),tip,.18,'wood','taper')
  art.solid('lamp','dome',[.4,.3,.56],'accent',tip,[.9,.3,-.2])
  const result = art.finish(), original = structuredClone(result)
  const fitted = fitArtRecipe(result)
  assert.deepEqual(result, original)
  const model = modelFromArtRecipe(fitted), elevation = Math.PI/6
  for (const p of model.parts) {
    const q = quaternionFromEuler(p.pitch,p.yaw,p.roll)
    for (let k=0;k<p.mesh.data.length;k+=6) {
      const [x,y,z] = rotateVec3(q,[p.mesh.data[k]*p.scale[0],p.mesh.data[k+1]*p.scale[1],p.mesh.data[k+2]*p.scale[2]])
      for (let d=0;d<8;d++) {
        const a=d*Math.PI/4, px=x+p.position[0], pz=z+p.position[2]
        const u=Math.cos(a)*px-Math.sin(a)*pz
        const v=Math.cos(elevation)*(y+p.position[1]-model.centerY)-Math.sin(elevation)*(Math.sin(a)*px+Math.cos(a)*pz)
        assert.ok(Math.max(Math.abs(u),Math.abs(v))*32/model.span <= 14+1e-6)
      }
    }
  }
})

test('invalid placements fail without appending parts and edits reject invalid rotations', () => {
  const art = createArtBuilder('test', {base:'case'})
  const before = art.finish()
  assert.throws(() => art.attach('handle','missing','top','arch',[1,1,1],'wood'), /missing/)
  assert.throws(() => art.between('arm',[1,0,0],[1,0,0],.1,'wood'), /endpoints/)
  assert.throws(() => art.solid('body','oval',[1,1,1],'wood'), /unique/)
  assert.throws(() => art.solid('bad','ring',[1,0,1],'ink'), /positive/)
  assert.deepEqual(art.finish(),before)
  const invalid: ArtRecipe = structuredClone(before)
  invalid.parts[0].pitch = Infinity
  assert.throws(() => modelFromArtRecipe(invalid), /body/)
})

test('the headless sprite baker preserves transparent gutters, openings and all eight directions', () => {
  const art = createArtBuilder('arch')
  art.solid('arch','arch',[1,1,.18],'accent')
  const recipe = art.finish(), model = modelFromArtRecipe(recipe)
  const group = createArtKit({models:{arch:model}}).group()
  group.add('arch',[0,0,0])
  const {width,height,pixels} = bakeSpritePixels(group.batches,{span:model.span,center:[0,model.centerY,0],frameSize:32})
  assert.equal(width,256)
  assert.equal(height,32)
  const alpha = (x:number,y:number) => pixels[4*(y*width+x)+3]
  assert.equal(alpha(16,18),0, 'the front view has an open center')
  for (let d=0;d<8;d++) {
    let count = 0
    for (let y=0;y<height;y++) for (let x=0;x<height;x++) {
      if (alpha(32*d+x,y)) {
        count++
        assert.ok(x>0 && x<31 && y>0 && y<31)
      }
    }
    assert.ok(count>0)
  }
})

test('references preserve named geometry, allow local changes and yield independent project-colored variants', () => {
  const base = createArtBuilder('carrier',{base:'case'})
  base.handle('grip','body','top',.55,.24,.12,'ink')
  const reference = base.finish()
  reference.palette = { ink:'#123456' }
  reference.timings = { turntable:190 }
  const original = structuredClone(reference)
  const design = createArtBuilder('tool-carrier',{reference})
  const old = design.point('body','right')
  design.adjust('body',{scaleBy:[1.6,1,1],moveBy:[.2,0,0],tone:'stone'})
  assert.ok(design.point('body','right')[0] > old[0]+.2)
  design.remove('grip')
  assert.throws(() => design.point('grip'),/grip/)
  design.disc('badge','body','front',.16,.05,'accent')
  const result = design.finish()
  assert.deepEqual(result.parts.map(p=>p.name),['body','base','badge'])
  assert.deepEqual(result.palette,{})
  assert.deepEqual(result.timings,reference.timings)
  assert.deepEqual(reference,original)
})

test('part visibility distinguishes an occluded mark from a front-facing badge', () => {
  const art = createArtBuilder('case')
  art.solid('body','box',[1,1,1],'wood')
  art.solid('inside','box',[.3,.3,.3],'light')
  art.attach('badge','body','front','box',[.42,.42,.08],'light')
  const model = modelFromArtRecipe(art.finish())
  const counts = spritePartVisibility(createArtKit({models:{subject:model}}),'subject', 32)
  assert.deepEqual(counts.parts.inside,Array(8).fill(0))
  assert.ok(counts.parts.badge[0] > 10)
  assert.equal(counts.parts.badge[4],0)
})
