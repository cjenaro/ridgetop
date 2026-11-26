import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats, Vec3 } from '../packages/ridgetop/framework/index.ts'
import { HERO_SPECS, TACTIC_LIST } from '../examples/crownshard/crownshard/data.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import { createInitialState, endPlayerTurn, startChapterBattle, stepGame } from '../examples/crownshard/crownshard/simulation.ts'
import type { GameState } from '../examples/crownshard/crownshard/types.ts'
import { FANFARE_DURATION, drawFanfare } from '../examples/crownshard/crownshard/ui-art.ts'

function fakeRenderer() {
  let drawn = 0
  let maxInstances = 0
  const stats: RenderStats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      drawn++
      let n = 0
      for (const b of batches) n += b.count
      maxInstances = Math.max(maxInstances, n)
      return stats
    }
  }
  return { renderer: renderer as unknown as LowPolyRenderer, get drawn() { return drawn }, get maxInstances() { return maxInstances } }
}

function frames(scene: ReturnType<typeof createCrownshardScene>, state: GameState, seconds: number) {
  const dt = 1 / 60
  for (let t = 0; t < seconds; t += dt) {
    stepGame(state, dt)
    scene.render(state, dt, 1280, 720)
  }
}

test('Crownshard scene choreographs every skill, tactic, special, and impact without throwing', () => {
  const state = createInitialState(7)
  const battle = startChapterBattle(state, 0)
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)
  frames(scene, state, 0.2)

  const ally = battle.units.find(u => u.team === 'ally')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  const from: Vec3 = [ally.x, ally.y, ally.z]
  const at: Vec3 = [enemy.x, enemy.y, enemy.z]
  const cells: Vec3[] = [at, [at[0] + 1.65, at[1], at[2]], [at[0], at[1], at[2] + 1.65]]

  for (const hero of Object.values(HERO_SPECS)) {
    for (const skill of hero.skills) {
      state.vfx.push({ kind: 'skill', uid: ally.uid, skillId: skill.id, style: skill.vfx, from, at, cells })
      state.vfx.push({ kind: 'impact', uid: enemy.uid, attackerUid: ally.uid, arc: 'flank', crit: true, blocked: false, absorbed: 0, damage: 10 })
      ally.animState = skill.vfx === 'slash' ? 'attack' : 'cast'
      ally.animTimer = 0.42
      frames(scene, state, 0.25)
    }
  }
  for (const card of TACTIC_LIST) {
    state.vfx.push({ kind: 'tactic', tacticId: card.id, style: card.vfx, at, cells, casterUid: ally.uid })
    frames(scene, state, 0.2)
  }
  for (const move of ['eclipse_nova', 'shaman_mend', 'lich_summon', 'frostwyrm_breath', 'titan_slam'] as const) {
    state.vfx.push({ kind: 'special', uid: enemy.uid, move, at: from, cells: [from, at] })
    enemy.animState = 'cast'
    enemy.animTimer = 0.5
    frames(scene, state, 0.35)
  }
  for (const arc of ['front', 'flank', 'back'] as const) {
    for (const blocked of [false, true]) {
      state.vfx.push({ kind: 'impact', uid: ally.uid, attackerUid: enemy.uid, arc, crit: arc === 'back', blocked, absorbed: blocked ? 5 : 0, damage: blocked ? 0 : 7 })
      frames(scene, state, 0.2)
    }
  }
  // Persistent status auras + onset reactions + burn tick
  enemy.burnTurns = 2
  enemy.slowTurns = 2
  enemy.empowerTurns = 2
  enemy.stunTurns = 1
  frames(scene, state, 0.8)
  enemy.burnTurns = 1
  state.vfx.push({ kind: 'impact', uid: enemy.uid, attackerUid: null, arc: 'front', crit: false, blocked: false, absorbed: 0, damage: 8 })
  frames(scene, state, 0.8)
  frames(scene, state, 2.5) // let every queued effect expire
  assert.ok(fake.drawn > 100)
  assert.ok(fake.maxInstances > 50, 'VFX should add instances to the frame')
})

test('Hero Ascension ceremony and rare equip fanfare draw across all phases without throwing', () => {
  let ops = 0
  const grad = { addColorStop() {} }
  const ctx = {
    save() { ops++ },
    restore() { ops++ },
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    ellipse() {},
    rect() {},
    clip() {},
    fill() { ops++ },
    stroke() { ops++ },
    fillRect() { ops++ },
    strokeRect() {},
    fillText() { ops++ },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 7 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D

  const rect = { x: 0, y: 0, width: 1280, height: 720 }
  const knight = HERO_SPECS.knight
  const sk2 = knight.skills[1]
  for (const t of [0.05, 0.4, 0.78, 1.3, 2.2, FANFARE_DURATION - 0.1]) {
    drawFanfare(ctx, rect, {
      kind: 'ascend',
      elapsed: t,
      title: 'Ascended ★★',
      subtitle: `${knight.name}, ${knight.title} — Tier 2`,
      accent: '#c075ff',
      stars: 2,
      skill: { tier: sk2.tier, name: sk2.name, desc: sk2.desc, vfx: sk2.vfx, skillId: sk2.id }
    })
    drawFanfare(ctx, rect, {
      kind: 'equip',
      elapsed: t,
      title: 'Legendary Equipped!',
      subtitle: 'Solis Crownblade → Sir Aldric',
      accent: '#ffc83b',
      item: { slot: 'weapon', equipId: 'solis_crownblade', accentHex: '#ffe478', rarityLabel: 'Legendary' }
    })
  }
  assert.ok(ops > 100)
})

test('Crownshard autoplayed battles render archetype gaits, attacks, hits, and deaths without throwing', () => {
  for (const chapter of [0, 4, 8]) {
    const state = createInitialState(11 + chapter)
    startChapterBattle(state, chapter)
    const fake = fakeRenderer()
    const scene = createCrownshardScene(fake.renderer)
    for (let round = 0; round < 24 && state.battle && state.battle.phase !== 'victory' && state.battle.phase !== 'defeat'; round++) {
      if (state.battle.phase === 'player') endPlayerTurn(state)
      frames(scene, state, 1.2)
    }
    assert.ok(fake.drawn > 0)
  }
})
