import assert from 'node:assert/strict'
import test from 'node:test'
import {
  box, color, createAnimator, createArtBuilder, createMeshPool, createParticles, createRig, createRng,
  createSoundscape, multiply, multiplyQuat, perspective, quaternionFromEuler, renderRig, view, worldToScreen
} from '../packages/ridgetop/framework/index.ts'

test('createRig + renderRig composes hierarchical parent-child transforms and emits batches', () => {
  const rig = createRig([
    { id: 'body', pivot: [0, 1, 0], parts: [{ mesh: box, scale: [1, 1, 1], color: color('e0a040') }] },
    { id: 'arm', parent: 'body', pivot: [0.5, 0.2, 0], parts: [{ mesh: box, position: [0, -0.3, 0], scale: [0.2, 0.6, 0.2], color: color('304050') }] },
    { id: 'lantern', parent: 'arm', pivot: [0, -0.6, 0], parts: [{ mesh: box, scale: [0.2, 0.3, 0.2], color: color('80f0d0'), unlit: 1 }] }
  ])
  const pool = createMeshPool()
  const joints = renderRig(
    rig,
    { position: [2, 0, 3], yaw: 0 },
    { body: { rotation: [0, 0, 0] }, arm: { rotation: [Math.PI / 2, 0, 0] } },
    pool
  )
  assert.equal(pool.batches.length, 1)
  assert.equal(pool.batches[0].count, 3)
  // Rotating arm +90° around X swings the child lantern pivot (0, -0.6, 0) forward along -Z
  assert.ok(Math.abs(joints.lantern.position[0] - 2.5) < 1e-4)
  assert.ok(Math.abs(joints.lantern.position[1] - 1.2) < 1e-4)
  assert.ok(Math.abs(joints.lantern.position[2] - (3 - 0.6)) < 1e-4)
})

test('createAnimator samples keyframes and smoothly cross-fades between clips', () => {
  const animator = createAnimator({
    idle: {
      duration: 1,
      tracks: {
        body: [
          { t: 0, position: [0, 0, 0] },
          { t: 0.5, position: [0, 0.2, 0] },
          { t: 1, position: [0, 0, 0] }
        ]
      }
    },
    run: {
      duration: 0.5,
      tracks: {
        body: [
          { t: 0, position: [0, 0.4, 0], rotation: [0.2, 0, 0] },
          { t: 0.5, position: [0, 0.4, 0], rotation: [0.2, 0, 0] }
        ]
      }
    }
  }, 'idle')

  animator.step(0.5)
  const midIdle = animator.evaluate()
  assert.ok(Math.abs((midIdle.body.position?.[1] ?? 0) - 0.2) < 1e-4)

  animator.play('run', 0.2)
  animator.step(0.1) // halfway through cross-fade
  const blended = animator.evaluate()
  assert.ok((blended.body.position?.[1] ?? 0) > 0.2 && (blended.body.position?.[1] ?? 0) < 0.4)

  animator.step(0.2) // fade finished
  const fullRun = animator.evaluate()
  assert.ok(Math.abs((fullRun.body.position?.[1] ?? 0) - 0.4) < 1e-4)
})

test('createParticles advances velocity particles and parabolic item arcs', () => {
  const particles = createParticles(32)
  const pool = createMeshPool()
  particles.arc({
    mesh: box,
    from: [0, 0, 0],
    to: [4, 0, 0],
    peak: 2,
    scale: [0.3, 0.3, 0.3],
    color: color('ffdd77'),
    duration: 1.0
  })
  particles.step(0.5)
  particles.emit(pool)
  assert.equal(pool.batches[0].count, 1)
  // At midpoint u = 0.5, x = 2 and y = peak = 2
  assert.ok(Math.abs(pool.batches[0].data[0] - 2) < 1e-4)
  assert.ok(Math.abs(pool.batches[0].data[1] - 2) < 1e-4)
  particles.step(0.6)
  assert.equal(particles.count, 0)

  const q = multiplyQuat(quaternionFromEuler(0, Math.PI / 2, 0), quaternionFromEuler(0, Math.PI / 2, 0))
  assert.ok(Math.abs(q[1] - 1) < 1e-5)
})

test('instances and MeshPool support alpha/additive blend modes and pack per-instance opacity', () => {
  const pool = createMeshPool()
  pool.add(box, [0, 0, 0], [1, 1, 1], 0, [1, 1, 1, 1], 0, 'opaque')
  pool.add(box, [1, 0, 0], [1, 1, 1], 0, [1, 0.8, 0.4, 0.35], 1, 'alpha')
  pool.add(box, [2, 0, 0], [1, 1, 1], 0, [1, 0.9, 0.5, 0.20], 1, 'additive')
  assert.equal(pool.batches.length, 3)
  assert.equal(pool.batches[0].blend, 'opaque')
  assert.equal(pool.batches[1].blend, 'alpha')
  assert.equal(pool.batches[2].blend, 'additive')
  // Opacity is packed in origin.w (data[3])
  assert.ok(Math.abs(pool.batches[0].data[3] - 1) < 1e-5)
  assert.ok(Math.abs(pool.batches[1].data[3] - 0.35) < 1e-5)
  assert.ok(Math.abs(pool.batches[2].data[3] - 0.20) < 1e-5)
})

test('worldToScreen projects visible points to CSS pixels and rejects behind-camera points', () => {
  const cam = multiply(perspective(Math.PI / 3, 2, 0.5, 100), view([0, 0, 10], [0, 0, 0]))
  const center = worldToScreen(cam, 0, 0, 0, 800, 400)
  assert.ok(center && Math.abs(center.x - 400) < 1e-3 && Math.abs(center.y - 200) < 1e-3)
  assert.equal(worldToScreen(cam, 0, 0, 20, 800, 400), null)
})

test('createArtBuilder supports unlit on solid/attach/adjust, and createRng/createSoundscape work headlessly', () => {
  const b = createArtBuilder('glow-beacon', { base: 'case' })
  b.attach('lamp', 'body', 'top', 'octahedron', [0.3, 0.4, 0.3], 'glow', [0, 0, 0], 0.85)
  b.adjust('body', { unlit: 0.2 })
  const recipe = b.finish()
  assert.equal(recipe.parts.find(p => p.name === 'lamp')?.unlit, 0.85)
  assert.equal(recipe.parts.find(p => p.name === 'body')?.unlit, 0.2)

  const rngA = createRng(99), rngB = createRng(99)
  assert.equal(rngA.next(), rngB.next())
  assert.equal(rngA.next(), rngB.next())

  const s = createSoundscape({ beds: { ocean: { type: 'lowpass', frequency: 400, gain: 0.1 } } })
  s.setMuted(true)
  assert.equal(s.isMuted(), true)
  s.setMusicEnabled(false)
  assert.equal(s.isMusicEnabled(), false)
  s.tone({ frequency: 440, duration: 0.1 })
  s.noiseBurst({ duration: 0.1 })
  s.close()

  // createParticles(0) must enforce zero capacity
  const emptyParticles = createParticles(0)
  emptyParticles.spawn({ mesh: box, position: [0, 0, 0], scale: [1, 1, 1], color: [1, 1, 1, 1], life: 1 })
  assert.equal(emptyParticles.count, 0)
})

test('mirrorClip swaps left/right tracks and negates yaw, roll, and x translation', async () => {
  const { mirrorClip } = await import('../packages/ridgetop/framework/index.ts')
  const clip = {
    duration: 0.4,
    tracks: {
      armL: [{ t: 0, rotation: [0.1, 0.2, 0.3] as const }, { t: 0.4, rotation: [-0.5, 0.4, -0.2] as const, ease: 'easeOut' as const }],
      root: [{ t: 0, position: [0.25, 0.1, -0.2] as const }]
    }
  }
  const m = mirrorClip(clip)
  assert.equal(m.duration, 0.4)
  assert.equal(m.tracks.armL, undefined)
  assert.deepEqual(m.tracks.armR[0].rotation, [0.1, -0.2, -0.3])
  assert.deepEqual(m.tracks.armR[1].rotation, [-0.5, -0.4, 0.2])
  assert.equal(m.tracks.armR[1].ease, 'easeOut')
  assert.deepEqual(m.tracks.root[0].position, [-0.25, 0.1, -0.2])
  // Mirroring twice restores the original
  assert.deepEqual(mirrorClip(m).tracks.armL[1].rotation, [-0.5, 0.4, -0.2])
})

test('retimeClip scales key times uniformly', async () => {
  const { retimeClip, sampleClip } = await import('../packages/ridgetop/framework/index.ts')
  const clip = { duration: 1, loop: false, tracks: { body: [{ t: 0, position: [0, 0, 0] as const }, { t: 0.5, position: [0, 1, 0] as const }, { t: 1, position: [0, 0, 0] as const }] } }
  const fast = retimeClip(clip, 0.5)
  assert.equal(fast.duration, 0.5)
  assert.deepEqual(fast.tracks.body.map(k => k.t), [0, 0.25, 0.5])
  assert.ok(Math.abs((sampleClip(fast, 0.25).body.position?.[1] ?? 0) - 1) < 1e-6)
  assert.throws(() => retimeClip(clip, 0))
})

test('createAnimator keeps the outgoing clip at its own playback rate during a cross-fade', () => {
  const clips = {
    walk: { duration: 1, loop: true, tracks: { body: [{ t: 0, position: [0, 0, 0] as const, ease: 'linear' as const }, { t: 1, position: [0, 1, 0] as const, ease: 'linear' as const }] } },
    idle: { duration: 1, loop: true, tracks: { body: [{ t: 0, position: [0, 0, 0] as const }, { t: 1, position: [0, 0, 0] as const }] } }
  }
  const animator = createAnimator(clips, 'walk')
  animator.play('walk', 0, 0.5)
  animator.step(0.2) // walk time 0.1
  animator.play('idle', 1, 1)
  animator.step(0.2) // walk should advance 0.1 more (rate 0.5), blend weight ~ smooth(0.2)
  const pose = animator.evaluate()
  const w = 0.2 * 0.2 * (3 - 2 * 0.2)
  const expected = 0.2 * (1 - w)
  assert.ok(Math.abs((pose.body.position?.[1] ?? 0) - expected) < 1e-4)
})

test('createParticles delays hidden particles and applies pitch/roll tilt', () => {
  const particles = createParticles(8)
  const pool = createMeshPool()
  particles.spawn({ mesh: box, position: [0, 0, 0], velocity: [1, 0, 0], scale: [1, 1, 1], color: color('ffffff'), life: 1, delay: 0.3, pitch: Math.PI / 2 })
  particles.step(0.2)
  particles.emit(pool)
  assert.equal(pool.batches.length, 0, 'still waiting out its delay')
  particles.step(0.2) // 0.1 s of life elapsed after the delay
  particles.emit(pool)
  assert.equal(pool.batches[0].count, 1)
  assert.ok(Math.abs(pool.batches[0].data[0] - 0.1) < 1e-4, 'moved only for the post-delay slice')
})
