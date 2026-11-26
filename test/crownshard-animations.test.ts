import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLIP_IMPACT, UNIT_CLIPS, attackClipFor, deathClipFor, gaitFor, hitClipFor, runClipFor, runRateFor, skillClipFor,
  statusClipFor, turnClipFor
} from '../examples/crownshard/crownshard/animations.ts'
import type { UnitClipName } from '../examples/crownshard/crownshard/animations.ts'
import { HERO_SPECS } from '../examples/crownshard/crownshard/data.ts'

const TAU = Math.PI * 2
const clipNames = Object.keys(UNIT_CLIPS) as UnitClipName[]

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps
}

test('every hero skill maps to its own distinct clip in UNIT_CLIPS', () => {
  const pairs = Object.values(HERO_SPECS).flatMap(spec => spec.skills.map(skill => ({ hero: spec.id, skill: skill.id })))
  assert.equal(pairs.length, 24)
  const clips = pairs.map(({ hero, skill }) => skillClipFor(skill, hero))
  assert.equal(new Set(clips).size, 24)
  for (const clip of clips) assert.ok(UNIT_CLIPS[clip], `missing clip ${clip}`)
  assert.equal(skillClipFor('not_a_skill', 'mage'), 'cast')
  assert.equal(skillClipFor('not_a_skill', 'knight'), 'cast_rally')
})

test('every clip has ascending keys within [0, duration] and loop clips close seamlessly', () => {
  for (const name of clipNames) {
    const clip = UNIT_CLIPS[name]
    assert.ok(clip.duration > 0, `${name} duration`)
    for (const [joint, frames] of Object.entries(clip.tracks)) {
      assert.ok(frames.length > 0, `${name}.${joint} empty`)
      for (let i = 0; i < frames.length; i++) {
        const t = frames[i].t
        assert.ok(t >= 0 && t <= clip.duration + 1e-9, `${name}.${joint} key ${i} t=${t} outside [0, ${clip.duration}]`)
        if (i > 0) assert.ok(t > frames[i - 1].t, `${name}.${joint} key ${i} not ascending`)
        for (const v of [...(frames[i].rotation ?? []), ...(frames[i].position ?? [])]) assert.ok(Number.isFinite(v), `${name}.${joint} non-finite`)
      }
      if (!clip.loop || frames.length < 2) continue
      const first = frames[0], last = frames[frames.length - 1]
      const r0 = first.rotation ?? [0, 0, 0], r1 = last.rotation ?? [0, 0, 0]
      const p0 = first.position ?? [0, 0, 0], p1 = last.position ?? [0, 0, 0]
      for (let a = 0; a < 3; a++) {
        const dr = r1[a] - r0[a]
        // Full turns (e.g. a 360-degree spin) are seamless orientations.
        assert.ok(near(dr - Math.round(dr / TAU) * TAU, 0), `${name}.${joint} loop rotation mismatch on axis ${a}`)
        assert.ok(near(p1[a], p0[a]), `${name}.${joint} loop position mismatch on axis ${a}`)
      }
    }
  }
})

test('CLIP_IMPACT times every attack, skill, and special inside its clip', () => {
  const required = clipNames.filter(name => name.startsWith('attack_') || name.startsWith('sk_') || name === 'attack')
  required.push('boss_nova', 'boss_summon', 'boss_breath', 'boss_slam', 'shaman_chant', 'command')
  for (const name of required) {
    const impact = CLIP_IMPACT[name]
    assert.equal(typeof impact, 'number', `missing impact for ${name}`)
    assert.ok(impact! > 0 && impact! < UNIT_CLIPS[name].duration, `${name} impact ${impact} outside (0, ${UNIT_CLIPS[name].duration})`)
    if (name.startsWith('sk_')) assert.ok(impact! <= 0.6, `${name} impact too slow`)
  }
})

test('attack selection is archetype-distinct and honours weapon overrides', () => {
  const picks = [
    attackClipFor('knight'), attackClipFor('rogue'), attackClipFor('mage'), attackClipFor('cleric'),
    attackClipFor(undefined, 'orc_brute'), attackClipFor(undefined, 'frost_golem')
  ]
  assert.equal(new Set(picks).size, picks.length)
  for (const clip of picks) assert.ok(UNIT_CLIPS[clip])
  assert.equal(attackClipFor('knight', undefined, 'dragonfang_spear'), 'attack_thrust')
  assert.equal(attackClipFor('rogue', undefined, 'ember_wand'), 'attack_staff')
  assert.equal(attackClipFor('mage', undefined, 'hunter_bow'), 'attack_bow')
  assert.equal(attackClipFor('rogue', undefined, 'iron_sword'), 'attack')
  assert.equal(attackClipFor('paladin', undefined, 'sunsteel_blade'), 'attack_overhead')
  assert.equal(attackClipFor('champion', undefined, 'solis_crownblade'), 'attack_heavy')
  assert.equal(attackClipFor(undefined, 'goblin', 'dragonfang_spear'), 'attack_stab')
})

test('flank hits are exact mirror images of each other', () => {
  const l = UNIT_CLIPS.hit_flank_l, r = UNIT_CLIPS.hit_flank_r
  assert.equal(l.duration, r.duration)
  const pairs: [string, string][] = [['armL', 'armR'], ['armR', 'armL'], ['legL', 'legR'], ['legR', 'legL'], ['body', 'body'], ['root', 'root']]
  for (const [a, b] of pairs) {
    const fa = l.tracks[a], fb = r.tracks[b]
    assert.ok(fa && fb, `${a}/${b} tracks present`)
    assert.equal(fa.length, fb.length)
    fa.forEach((key, i) => {
      const other = fb[i]
      assert.equal(key.t, other.t)
      if (key.rotation) {
        assert.ok(near(key.rotation[0], other.rotation![0]))
        assert.ok(near(key.rotation[1], -other.rotation![1]))
        assert.ok(near(key.rotation[2], -other.rotation![2]))
      }
      if (key.position) assert.ok(near(key.position[0], -other.position![0]))
    })
  }
  assert.equal(hitClipFor('flank', 'left', false), 'hit_flank_l')
  assert.equal(hitClipFor('flank', 'right', true), 'hit_flank_r')
  assert.equal(hitClipFor('front', 'left', true), 'hit_heavy')
  assert.equal(hitClipFor('front', 'left', false), 'hit')
  assert.equal(hitClipFor('back', 'right', false), 'hit_back')
})

test('gaits cover every archetype and stride-match their run clips', () => {
  assert.equal(gaitFor('knight'), 'heavy')
  assert.equal(gaitFor('paladin'), 'heavy')
  assert.equal(gaitFor(undefined, 'crypt_knight'), 'heavy')
  assert.equal(gaitFor('rogue'), 'agile')
  assert.equal(gaitFor(undefined, 'goblin'), 'agile')
  assert.equal(gaitFor('mage'), 'glide')
  assert.equal(gaitFor('cryomancer'), 'glide')
  assert.equal(gaitFor(undefined, 'eclipse_archon'), 'glide')
  assert.equal(gaitFor(undefined, 'frost_golem'), 'stomp')
  assert.equal(gaitFor(undefined, 'orc_brute'), 'stomp')
  for (const hero of ['archer', 'cleric', 'champion'] as const) assert.equal(gaitFor(hero), 'normal')
  for (const enemy of ['bone_archer', 'bog_shaman'] as const) assert.equal(gaitFor(undefined, enemy), 'normal')
  const gaits = ['normal', 'heavy', 'agile', 'glide', 'stomp'] as const
  assert.equal(new Set(gaits.map(runClipFor)).size, gaits.length)
  assert.equal(runClipFor('normal'), 'run')
  assert.ok(near(runRateFor('normal'), (0.44 / 2) * 5.2))
  for (const gait of gaits) {
    const clip = UNIT_CLIPS[runClipFor(gait)]
    assert.ok(clip.loop, `${gait} run loops`)
    const rate = runRateFor(gait)
    assert.ok(rate > 0.5 && rate < 3, `${gait} rate ${rate}`)
  }
  const hover = UNIT_CLIPS.run_glide.tracks.root.map(key => key.position![1])
  assert.ok(Math.min(...hover) >= 0.08 - 1e-9 && Math.max(...hover) <= 0.12 + 1e-9)
})

test('turn, status, and death selectors resolve to authored clips', () => {
  assert.deepEqual(['left', 'right', 'about'].map(d => turnClipFor(d as 'left')), ['turn_l', 'turn_r', 'turn_about'])
  for (const name of ['turn_l', 'turn_r', 'turn_about'] as const) {
    const root = UNIT_CLIPS[name].tracks.root ?? []
    assert.ok(root.every(key => !key.rotation || near(key.rotation[1], 0)), `${name} must not yaw the root`)
  }
  assert.equal(statusClipFor('burn'), 'status_burn')
  assert.equal(statusClipFor('slow'), 'status_freeze')
  assert.equal(statusClipFor('stun'), 'status_stun')
  assert.equal(statusClipFor('empower'), 'status_empower')
  assert.equal(deathClipFor(undefined, 'frost_golem'), 'death_crumble')
  assert.equal(deathClipFor(undefined, 'orc_brute'), 'death_crumble')
  assert.equal(deathClipFor(undefined, 'eclipse_archon', true), 'death_dissolve')
  assert.equal(deathClipFor(undefined, 'bog_shaman'), 'death_dissolve')
  assert.equal(deathClipFor(undefined, 'goblin'), 'death_tumble')
  assert.equal(deathClipFor('knight'), 'death_kneel')
  assert.equal(deathClipFor(undefined, 'crypt_knight'), 'death_kneel')
  assert.equal(deathClipFor('archer'), 'death')
  for (const name of ['death', 'death_crumble', 'death_dissolve', 'death_tumble', 'death_kneel'] as const) {
    const clip = UNIT_CLIPS[name]
    assert.equal(clip.loop, false)
    for (const frames of Object.values(clip.tracks)) {
      const last = frames[frames.length - 1]
      // Still from ~0.9 s: any key after 0.92 s must repeat the pose it holds from.
      const held = frames.filter(key => key.t > 0.92)
      const anchor = [...frames].reverse().find(key => key.t <= 0.92) ?? last
      for (const key of held) assert.deepEqual(key.rotation ?? null, anchor.rotation ?? null, `${name} moves after 0.92 s`)
    }
  }
})
