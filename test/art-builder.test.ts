import assert from 'node:assert/strict'
import test from 'node:test'
import { artBases, artPartBounds, artPoseBounds, bakeAnimatedSpritePixels, bakeSpritePixels, createArtBuilder, createArtKit,
  createMeshPool, fitArtRecipe, modelFromArtRecipe, quaternionFromEuler, renderRig, rigFromArtRecipe, rotateVec3, sampleClip } from '../packages/ridgetop/framework/index.ts'
import type { ArtRecipe, Vec3 } from '../packages/ridgetop/framework/index.ts'
import { spritePartVisibility } from '../packages/ridgetop/framework/art-review.ts'

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
  assert.throws(() => art.attach('bad-face','body','center' as 'top','box',[1,1,1],'wood'), /surface face/)
  assert.throws(() => art.attach('bad-size','body','top','box',null as unknown as Vec3,'wood'), RangeError)
  assert.throws(() => art.between('arm',[1,0,0],[1,0,0],.1,'wood'), /endpoints/)
  assert.throws(() => art.solid('body','oval',[1,1,1],'wood'), /unique/)
  assert.throws(() => art.solid('bad','ring',[1,0,1],'ink'), /positive/)
  const sparse = new Array(3)
  sparse[0] = 1
  assert.throws(() => art.solid('sparse','box',sparse as unknown as Vec3,'wood'), RangeError)
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

test('biped, quadruped and bird starters generate default joint rigs and grounded idle/walk clips', () => {
  const expectedJoints = {
    biped: ['root', 'body', 'head', 'left-arm', 'right-arm', 'left-leg', 'right-leg'],
    quadruped: ['root', 'body', 'head', 'left-fore-leg', 'right-fore-leg', 'left-hind-leg', 'right-hind-leg'],
    bird: ['root', 'body', 'head', 'tail', 'left-wing', 'right-wing', 'left-leg', 'right-leg']
  } as const
  for (const base of ['biped', 'quadruped', 'bird'] as const) {
    for (const proportions of [[1, 1, 1], [1.35, 0.85, 1.15]] as Vec3[]) {
      const art = createArtBuilder(base + '-hero', { base, proportions, primary: 'accent', trim: 'wood' })
      art.attach('crest', 'head', 'top', 'cone', [0.16, 0.22, 0.16], 'glow')
      const recipe = art.finish()
      assert.ok(recipe.joints && recipe.clips, base + ' should include joints and clips')
      assert.deepEqual(recipe.joints.map(j => j.id), expectedJoints[base])
      assert.equal(recipe.parts.find(p => p.name === 'crest')?.joint, 'head', 'attached parts inherit parent joint')
      assert.ok(recipe.clips.idle && recipe.clips.walk, base + ' should include idle and walk clips')

      const model = modelFromArtRecipe(JSON.parse(JSON.stringify(recipe)))
      const { rig, clips } = rigFromArtRecipe(recipe)
      assert.equal(rig.joints.length, expectedJoints[base].length)
      assert.ok(clips.idle && clips.walk)

      // Every keyframe in idle and walk is grounded to y = 0.
      for (const clipName of ['idle', 'walk'] as const) {
        const recipeClip = recipe.clips[clipName]
        for (const frame of recipeClip.frames) {
          const b = artPoseBounds(model, frame.poses)
          near(b.min[1], 0)
        }
        // Continuous sampling across the full cycle keeps feet tightly grounded (no floating or sinking).
        const animClip = clips[clipName]
        for (let step = 0; step <= 24; step++) {
          const t = (step / 24) * animClip.duration
          const b = artPoseBounds(model, sampleClip(animClip, t))
          assert.ok(b.min[1] >= -0.025 && b.min[1] <= 0.025,
            `${base} ${clipName} at t=${t.toFixed(3)} drifted to minY=${b.min[1]}`)
        }
      }
    }
  }
  // Static bases remain clean with no default rig overhead.
  for (const base of ['case', 'vessel'] as const) {
    const recipe = createArtBuilder(base + '-prop', { base }).finish()
    assert.equal(recipe.joints, undefined)
    assert.equal(recipe.clips, undefined)
  }
})

test('builder joint/bind/clip helpers and fitArtRecipe shift joint pivots alongside parts', () => {
  const art = createArtBuilder('turret')
  art.solid('pedestal', 'cylinder', [0.8, 0.6, 0.8], 'stone', [3, 2.3, -1])
  art.solid('barrel', 'box', [0.24, 0.24, 0.9], 'accent', [3, 2.75, -0.6])
  art.joint('root', undefined, [3, 2, -1])
  art.joint('head', 'root', [3, 2.6, -1])
  art.bind('pedestal', 'root')
  art.bind('barrel', 'head')
  art.clip('sweep', {
    duration: 1,
    loop: true,
    easing: 'linear',
    frames: [
      { time: 0, poses: { head: { rotation: [0, -0.5, 0] } } },
      { time: 0.5, poses: { head: { rotation: [0, 0.5, 0] } } },
      { time: 1, poses: { head: { rotation: [0, -0.5, 0] } } }
    ]
  })
  assert.throws(() => art.joint('head', 'root', [0, 0, 0]), /unique/)
  assert.throws(() => art.joint('bad', 'missing'), /Unknown parent/)
  assert.throws(() => art.bind('missing', 'root'), /Unknown part/)
  assert.throws(() => art.bind('barrel', 'missing'), /Unknown joint/)
  assert.throws(() => art.clip('bad', { duration: 0, frames: [{ time: 0, poses: {} }] }), /duration/)

  const recipe = art.finish()
  const model = modelFromArtRecipe(recipe)
  // Rest pose is grounded and centered at X/Z = 0.
  const restBounds = artPoseBounds(model)
  near(restBounds.min[1], 0)
  near(restBounds.min[0] + restBounds.max[0], 0)
  near(restBounds.min[2] + restBounds.max[2], 0)
  // Joint pivots shifted by exact same delta as parts (floor=2, cx=3).
  const rootJoint = recipe.joints!.find(j => j.id === 'root')!
  const headJoint = recipe.joints!.find(j => j.id === 'head')!
  near(rootJoint.pivot![1], 0)
  near(headJoint.pivot![1], 0.6)
  near(headJoint.pivot![0] - rootJoint.pivot![0], 0)
  near(headJoint.pivot![2] - rootJoint.pivot![2], 0)

  // References preserve joints and clips independently.
  const variant = createArtBuilder('turret-v2', { reference: recipe })
  variant.adjust('barrel', { tone: 'glow' })
  const copy = variant.finish()
  assert.deepEqual(copy.joints, recipe.joints)
  assert.deepEqual(copy.clips, recipe.clips)
  assert.equal(copy.parts.find(p => p.name === 'barrel')?.joint, 'head')

  // Runtime renderRig matches the shifted joint pivots cleanly.
  const { rig, createAnimator } = rigFromArtRecipe(recipe)
  const anim = createAnimator('sweep')
  anim.step(0.5)
  const pool = createMeshPool()
  const joints = renderRig(rig, { position: [0, 0, 0] }, anim.evaluate(), pool)
  assert.equal(pool.batches.reduce((n, b) => n + b.count, 0), 2)
  near(joints.head.position[1], 0.6)
})

test('headless multi-frame animated directional sprite baking produces distinct aligned frames across clips and directions', () => {
  const recipe = createArtBuilder('walker', { base: 'biped', primary: 'accent', trim: 'wood' }).finish()
  const baked = bakeAnimatedSpritePixels(recipe, {
    clips: ['idle', 'walk'],
    frames: { idle: 2, walk: 4 },
    frameSize: 32
  })
  const cols = 6, rows = 8
  assert.equal(baked.width, cols * 32)
  assert.equal(baked.height, rows * 32)
  assert.equal(baked.pixels.length, baked.width * baked.height * 4)
  assert.equal(baked.manifest.frameWidth, 32)
  assert.equal(baked.manifest.frameHeight, 32)
  assert.equal(Object.keys(baked.manifest.clips).length, 16)

  // Verify every manifest clip stays within sheet bounds and has positive frameMs.
  for (const [name, clip] of Object.entries(baked.manifest.clips)) {
    assert.ok(clip.column >= 0 && clip.column + clip.frames <= cols, name + ' column bounds')
    assert.ok((clip.row ?? 0) >= 0 && (clip.row ?? 0) < rows, name + ' row bounds')
    assert.ok(clip.frameMs > 0 && Number.isFinite(clip.frameMs), name + ' frameMs')
  }
  assert.deepEqual(baked.manifest.clips['idle-front'], { column: 0, row: 0, frames: 2, frameMs: 800 })
  assert.deepEqual(baked.manifest.clips['walk-right'], { column: 2, row: 2, frames: 4, frameMs: 200 })

  const cellMetrics = (col: number, row: number) => {
    let count = 0, maxY = -1
    const bytes: number[] = []
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = ((row * 32 + y) * baked.width + col * 32 + x) * 4
        const a = baked.pixels[i + 3]
        bytes.push(baked.pixels[i], baked.pixels[i + 1], baked.pixels[i + 2], a)
        if (a > 0) {
          count++
          if (y > maxY) maxY = y
        }
      }
    }
    return { count, maxY, hash: bytes.join(',') }
  }

  // Side view ('right', row 2) walk frames are non-empty, visibly distinct across phases, and keep feet aligned.
  const walkRight = [2, 3, 4, 5].map(col => cellMetrics(col, 2))
  for (const m of walkRight) assert.ok(m.count > 20, 'walk frame should render visible pixels')
  assert.ok(new Set(walkRight.map(m => m.hash)).size >= 3, 'walk phases should produce distinct frames')
  const footRows = walkRight.map(m => m.maxY)
  assert.ok(Math.max(...footRows) - Math.min(...footRows) <= 1,
    'feet baseline should stay aligned across walk frames: ' + footRows.join(', '))

  // Custom direction subset + fps option works cleanly.
  const subset = bakeAnimatedSpritePixels(recipe, {
    clip: 'walk',
    fps: 10,
    frameSize: 24,
    directions: ['front', 'right', 'back', 'left']
  })
  assert.equal(subset.width, 8 * 24)
  assert.equal(subset.height, 4 * 24)
  assert.equal(subset.manifest.clips['walk-front'].frameMs, 100)
  assert.equal(subset.manifest.clips['walk-front'].frames, 8)
  assert.deepEqual(Object.keys(subset.manifest.clips), ['walk-front', 'walk-right', 'walk-back', 'walk-left'])

  // fitArtRecipe shifts root joints with omitted pivot alongside parts and child joints
  const offsetRecipe = {
    format: 'ridgetop-art' as const,
    version: 2 as const,
    name: 'offset-rig',
    span: 2,
    centerY: 0.5,
    frameSize: 64,
    palette: { wood: '#aa8866' },
    parts: [
      { name: 'torso', shape: 'box' as const, joint: 'root', position: [2, 0.7, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number], tone: 'wood' as const }
    ],
    joints: [
      { id: 'root' },
      { id: 'head', parent: 'root', pivot: [2, 1.5, 0] as [number, number, number] }
    ]
  }
  const fitted = fitArtRecipe(offsetRecipe)
  assert.ok(fitted.joints?.[0].pivot)
  assert.ok(Math.abs(fitted.joints![0].pivot![0] - (-2)) < 1e-9)
  assert.ok(Math.abs(fitted.joints![0].pivot![1] - (-0.2)) < 1e-9)
  assert.equal(fitted.joints![0].pivot![2], 0)
  assert.ok(Math.abs(fitted.joints![1].pivot![0] - 0) < 1e-9)
  assert.ok(Math.abs(fitted.joints![1].pivot![1] - 1.3) < 1e-9)
  assert.equal(fitted.joints![1].pivot![2], 0)
})
