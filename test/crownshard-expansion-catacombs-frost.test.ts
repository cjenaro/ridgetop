import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { InstanceBatch, LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { compileTsToGd } from '../packages/ridgetop/tools/ts-to-gd.ts'
import {
  CHAPTER_BY_ID,
  ENEMY_SPECS,
  PLAYABLE_CHAPTERS
} from '../examples/crownshard/crownshard/data.ts'
import {
  ENEMY_CHARACTER_SPECS,
  ENEMY_RIGS
} from '../examples/crownshard/crownshard/characters.ts'
import {
  attackClipFor,
  deathClipFor,
  gaitFor,
  stanceOffsetFor
} from '../examples/crownshard/crownshard/animations.ts'
import { bakePortraitPixels } from '../examples/crownshard/crownshard/art.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  ACT2_EXPANSION_STAGE_IDS,
  FROSTWYRM_BREATH_COOLDOWN,
  FROSTWYRM_WING_BUFFET_COOLDOWN,
  LICH_VAELEN_SOUL_NOVA_COOLDOWN,
  LICH_VAELEN_SUMMON_COOLDOWN,
  armSkill,
  armTacticCard,
  canTraverseStep,
  chooseFrostwyrmSpecial,
  chooseLichVaelenSoulNova,
  computeCombatForecast,
  computeFootprintWorldCenter,
  computeGlacialBreathCells,
  computeMoveTiles,
  computeTargetTiles,
  createInitialState,
  distanceBetweenUnits,
  getInnateStageMutators,
  getUnitByUid,
  getUnitFootprintCells,
  getUnitFootprintSize,
  hasMutator,
  isEnemyShrouded,
  isValidFootprintAnchor,
  refreshHighlights,
  resolveDisplacementPreview,
  restoreBattleState,
  selectTile,
  serializeBattleState,
  startStageBattle,
  stepGame,
  unitAt,
  validateBattleSnapshot
} from '../examples/crownshard/crownshard/simulation.ts'
import { cellHeightLevel, terrainWalkable } from '../examples/crownshard/crownshard/types.ts'
import type { BattleUnit, EnemyArchetypeId } from '../examples/crownshard/crownshard/types.ts'

function fakeRenderer(): { renderer: LowPolyRenderer; draws: () => number; lastInstances: () => number } {
  let drawn = 0
  let lastCount = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_camera: unknown, batches: readonly InstanceBatch[]) {
      drawn++
      lastCount = batches.reduce((sum, b) => sum + b.count, 0)
      return stats
    }
  } as unknown as LowPolyRenderer
  return { renderer, draws: () => drawn, lastInstances: () => lastCount }
}

function advanceEnemyTurn(state: ReturnType<typeof createInitialState>, enemy: BattleUnit): void {
  const battle = state.battle!
  battle.phase = 'enemy'
  battle.activeUnitUid = enemy.uid
  battle.selectedUnitUid = enemy.uid
  battle.enemyActedThisTurn = false
  battle.enemyDelay = 0
  enemy.acted = false
  enemy.moved = false
  for (let step = 0; step < 80 && !battle.enemyActedThisTurn; step++) {
    stepGame(state, 0.05)
  }
  for (let step = 0; step < 80 && enemy.path.length > 0; step++) {
    stepGame(state, 0.05)
  }
}

test('All 4 Ashen Catacombs & Frostspire expansion nodes are playable with valid grids, heights, spawns, and jump-1 connectivity', () => {
  const expectedIds = ['gloomwood_heart', 'bone_cathedral', 'runeforge_peak', 'wyrm_eyrie'] as const
  assert.deepEqual([...ACT2_EXPANSION_STAGE_IDS], [...expectedIds])

  for (const id of expectedIds) {
    const ch = CHAPTER_BY_ID[id]
    assert.ok(ch, `Chapter ${id} must exist`)
    assert.equal(Boolean(ch.comingSoon), false, `${id} must no longer be marked comingSoon`)
    assert.ok(PLAYABLE_CHAPTERS.some(p => p.id === id), `${id} must appear in PLAYABLE_CHAPTERS`)
    assert.ok(ch.heights, `${id} must define an explicit heightmap`)
    assert.equal(ch.heights.length, ch.grid.length, `${id} heightmap rows must match grid`)

    const state = createInitialState(2600 + ch.index)
    const battle = startStageBattle(state, id, 0, { deployPhase: true })

    let hasVoid = false
    let hasStairs = false
    for (let r = 0; r < battle.rows; r++) {
      for (let c = 0; c < battle.cols; c++) {
        const cell = battle.cells[r][c]
        if (cell.terrain === 'void') hasVoid = true
        if (cell.terrain === 'stairs') hasStairs = true
      }
    }
    assert.equal(hasVoid, true, `${id} must include irregular void cutouts`)
    assert.equal(hasStairs, true, `${id} must include stairs/ramps`)

    // Non-overlapping walkable spawns across full footprints
    const occupied = new Set<string>()
    for (const u of battle.units) {
      const cells = getUnitFootprintCells(u)
      for (const fc of cells) {
        assert.ok(fc.col >= 0 && fc.col < battle.cols && fc.row >= 0 && fc.row < battle.rows, `${id}: ${u.uid} cell in bounds`)
        assert.equal(battle.cells[fc.row][fc.col].walkable, true, `${id}: ${u.uid} cell (${fc.col},${fc.row}) walkable`)
        assert.equal(terrainWalkable(battle.cells[fc.row][fc.col].terrain), true)
        const key = `${fc.col},${fc.row}`
        assert.equal(occupied.has(key), false, `${id}: duplicate spawn cell (${key})`)
        occupied.add(key)
      }
    }

    // Jump-1 BFS connectivity from every hero spawn to every enemy footprint tile & objective tile
    const reachableFrom = (sc: number, sr: number): Set<string> => {
      const seen = new Set<string>([`${sc},${sr}`])
      const q: [number, number][] = [[sc, sr]]
      while (q.length > 0) {
        const [cc, cr] = q.shift()!
        const from = battle.cells[cr][cc]
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nc = cc + dc
          const nr = cr + dr
          if (nc < 0 || nc >= battle.cols || nr < 0 || nr >= battle.rows) continue
          const k = `${nc},${nr}`
          if (seen.has(k)) continue
          const to = battle.cells[nr][nc]
          if (!canTraverseStep(from, to, 1)) continue
          seen.add(k)
          q.push([nc, nr])
        }
      }
      return seen
    }

    for (const [hc, hr] of ch.heroSpawns) {
      const reach = reachableFrom(hc, hr)
      for (const enemy of battle.units.filter(u => u.team === 'enemy')) {
        for (const fc of getUnitFootprintCells(enemy)) {
          assert.equal(
            reach.has(`${fc.col},${fc.row}`),
            true,
            `${id}: hero spawn (${hc},${hr}) must reach ${enemy.uid} tile (${fc.col},${fc.row}) with jump=1`
          )
        }
      }
      if (battle.objective.goalTile) {
        const g = battle.objective.goalTile
        assert.equal(reach.has(`${g.col},${g.row}`), true, `${id}: goalTile (${g.col},${g.row}) must be jump-1 reachable`)
      }
      for (const ct of battle.objective.chestTiles) {
        assert.equal(reach.has(`${ct.col},${ct.row}`), true, `${id}: chestTile (${ct.col},${ct.row}) must be jump-1 reachable`)
      }
    }
  }
})

test('Gloomwood activates innate Fog of War by default on first clear and shrouds distant stalkers until spotted', () => {
  assert.deepEqual([...getInnateStageMutators('gloomwood_heart')], ['fog_of_war'])
  assert.deepEqual([...getInnateStageMutators('border_watch')], [])

  const state = createInitialState(3101)
  // Fresh campaign: gloomwood_heart has never been cleared, yet innate Fog of War MUST still activate!
  const battle = startStageBattle(state, 'gloomwood_heart')
  assert.equal(hasMutator(battle, 'fog_of_war'), true, 'Gloomwood must automatically enable fog_of_war')
  assert.equal(battle.objective.kind, 'assassinate')

  const enemies = battle.units.filter(u => u.team === 'enemy')
  assert.ok(enemies.some(e => e.enemyId === 'crypt_knight'), 'Gloomwood must include Dread Knight stalker')
  assert.ok(enemies.some(e => e.enemyId === 'bone_archer'), 'Gloomwood must include Bone Archers')
  assert.ok(enemies.some(e => e.enemyId === 'bone_necromancer'), 'Gloomwood must include Bone Necromancer')

  // Distant stalkers start shrouded (> Manhattan distance 4 from all heroes)
  for (const e of enemies) {
    assert.equal(isEnemyShrouded(battle, e), true, `${e.name} at (${e.col},${e.row}) should start shrouded in Fog of War`)
  }

  // Tall grass ambush cover & cursed altar exist on map
  let tallGrassCount = 0
  let cursedAltarCount = 0
  for (const row of battle.cells) {
    for (const cell of row) {
      if (cell.terrain === 'tall_grass') tallGrassCount++
      if (cell.terrain === 'cursed_altar') cursedAltarCount++
    }
  }
  assert.ok(tallGrassCount >= 8, 'Gloomwood must feature tall_grass ambush cover')
  assert.ok(cursedAltarCount >= 1, 'Gloomwood must include a cursed_altar')

  // Moving a hero within distance 4 reveals the stalker captain
  const captain = enemies.find(e => e.enemyId === 'crypt_knight')!
  const hero = battle.units.find(u => u.team === 'ally')!
  hero.col = captain.col - 3
  hero.row = captain.row
  assert.equal(isEnemyShrouded(battle, captain), false, 'Advancing within vision radius 4 must spot Gloom Stalker Captain')
})

test('Ash Cathedral features Lich Vaelen on elevated dais with Bone Thrall summoning, Cursed-Soul Nova, and Assassinate victory', () => {
  const state = createInitialState(3202)
  const battle = startStageBattle(state, 'bone_cathedral')

  assert.equal(battle.objective.kind, 'assassinate')
  const lich = battle.units.find(u => u.enemyId === 'lich_vaelen')
  assert.ok(lich, 'Ash Cathedral must spawn Lich Vaelen')
  assert.equal(lich.isBoss, true)
  assert.equal(battle.objective.targetEnemyUid, lich.uid)
  assert.ok(cellHeightLevel(battle.cells[lich.row][lich.col]) >= 2, 'Lich Vaelen must stand on elevated altar dais')

  // 1. First Lich turn: summons a Bone Thrall onto an adjacent open tile
  const beforeUnits = battle.units.length
  state.vfx.length = 0
  advanceEnemyTurn(state, lich)
  assert.equal(battle.units.length, beforeUnits + 1, 'Lich Vaelen must summon a Bone Thrall')
  const thrall = battle.units.find(u => u.enemyId === 'bone_thrall' && u.summonerUid === lich.uid)
  assert.ok(thrall, 'Summoned minion must be bone_thrall owned by Lich Vaelen')
  assert.equal(lich.cooldowns[0], LICH_VAELEN_SUMMON_COOLDOWN)
  assert.ok(state.vfx.some(v => v.kind === 'special' && v.move === 'lich_summon'), 'Summon must emit lich_summon VFX')

  // 2. Next turn while summon is on cooldown: place an ally within range 3 -> Lich unleashes Cursed-Soul Nova!
  const ally = battle.units.find(u => u.team === 'ally')!
  ally.col = lich.col - 2
  ally.row = lich.row
  const [ax, ay, az] = computeFootprintWorldCenter(battle, ally.col, ally.row, 1)
  ally.x = ax
  ally.y = ay
  ally.z = az
  ally.hp = ally.maxHp
  ally.shield = 0
  ally.poisonStacks = 0
  assert.ok(chooseLichVaelenSoulNova(lich), 'Lich Vaelen Cursed-Soul Nova must be ready on slot 1')

  state.vfx.length = 0
  advanceEnemyTurn(state, lich)
  assert.equal(lich.cooldowns[1], LICH_VAELEN_SOUL_NOVA_COOLDOWN, 'Cursed-Soul Nova must set cooldown slot 1')
  assert.ok(ally.hp < ally.maxHp, 'Cursed-Soul Nova must damage hero in range')
  assert.ok(ally.poisonStacks >= 2 || !ally.alive, 'Cursed-Soul Nova must inflict Poison stacks')
  assert.ok(state.vfx.some(v => v.kind === 'special' && v.move === 'eclipse_nova'), 'Cursed-Soul Nova must emit special VFX')

  // 3. Defeating Lich Vaelen immediately wins the Assassinate mission even with guards still alive!
  const striker = battle.units.find(u => u.team === 'ally' && u.alive)!
  striker.col = lich.col - 1
  striker.row = lich.row
  const [sx, sy, sz] = computeFootprintWorldCenter(battle, striker.col, striker.row, 1)
  striker.x = sx
  striker.y = sy
  striker.z = sz
  striker.acted = false
  striker.moved = false
  striker.atk = 999
  lich.hp = 1
  lich.shield = 0
  battle.phase = 'player'
  battle.activeUnitUid = striker.uid
  battle.selectedUnitUid = striker.uid
  battle.armedSkillIndex = null
  battle.armedTacticUid = null
  refreshHighlights(battle, state.campaign)

  const struck = selectTile(state, lich.col, lich.row)
  assert.equal(struck, true, 'Hero must be able to strike Lich Vaelen')
  assert.equal(lich.alive, false)
  assert.equal(battle.phase, 'victory', 'Slaying Lich Vaelen must immediately win Ash Cathedral')
})

test('Runeforge Peak features ice slide lanes, height 0..3 terraces, and awards guaranteed Cryomancer on first clear', () => {
  const ch = CHAPTER_BY_ID.runeforge_peak
  assert.equal(ch.rewardHeroId, 'cryomancer')
  assert.equal(ch.objective?.kind, 'seize')

  const state = createInitialState(3303)
  const cryoBefore = state.campaign.heroes.filter(h => h.heroId === 'cryomancer').length
  const battle = startStageBattle(state, 'runeforge_peak')

  const observedHeights = new Set<number>()
  let iceCount = 0
  let snowCount = 0
  for (const row of battle.cells) {
    for (const cell of row) {
      if (cell.terrain === 'void') continue
      observedHeights.add(cellHeightLevel(cell))
      if (cell.terrain === 'ice') iceCount++
      if (cell.terrain === 'snow') snowCount++
    }
  }
  assert.ok(iceCount >= 6, 'Runeforge Peak must feature ice slide lanes')
  assert.ok(snowCount >= 6, 'Runeforge Peak must feature snow drifts')
  for (const h of [0, 1, 2, 3]) {
    assert.equal(observedHeights.has(h), true, `Runeforge Peak must include heightLevel ${h}`)
  }

  // Step onto Runeforge Anvil goalTile to seize victory and claim Cryomancer reward!
  const goal = battle.objective.goalTile!
  assert.ok(goal)
  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  hero.col = goal.col - 1
  hero.row = goal.row
  hero.path = [{ col: goal.col, row: goal.row }]
  hero.moveProgress = 0.92
  stepGame(state, 0.05)

  assert.equal(battle.phase, 'victory', 'Seizing the Runeforge Anvil must win Runeforge Peak')
  assert.ok(battle.reward, 'Clearing Runeforge Peak must issue BattleReward')
  assert.equal(battle.reward.firstClear, true)
  assert.equal(battle.reward.heroCard?.heroId, 'cryomancer', 'First clear must award guaranteed Cryomancer card')
  assert.equal(
    state.campaign.heroes.filter(h => h.heroId === 'cryomancer').length,
    cryoBefore + 1,
    'Cryomancer must be added to campaign roster'
  )
})

test('Frostwyrm Eyrie 2x2 multi-tile boss Rimefang supports 4-tile targeting, AoE dedupe, Glacial Breath, Wing Buffet, and save/resume parity', () => {
  const state = createInitialState(3404)
  const battle = startStageBattle(state, 'wyrm_eyrie')
  const rimefang = battle.units.find(u => u.enemyId === 'frostwyrm_rimefang')!
  assert.ok(rimefang, 'Frostwyrm Eyrie must spawn Rimefang')
  assert.equal(rimefang.isBoss, true)
  assert.equal(getUnitFootprintSize(rimefang), 2, 'Rimefang must have a 2x2 footprint')

  const fpCells = getUnitFootprintCells(rimefang)
  assert.equal(fpCells.length, 4)
  assert.deepEqual(fpCells, [
    { col: 8, row: 3 },
    { col: 9, row: 3 },
    { col: 8, row: 4 },
    { col: 9, row: 4 }
  ])

  // 1. Occupancy: ALL 4 tiles resolve to Rimefang via unitAt
  for (const fc of fpCells) {
    assert.equal(unitAt(battle, fc.col, fc.row)?.uid, rimefang.uid, `unitAt(${fc.col},${fc.row}) must resolve to Rimefang`)
  }
  assert.equal(unitAt(battle, 7, 3), undefined)

  // 2. Targeting ANY of the 4 footprint tiles damages Rimefang!
  const hero = battle.units.find(u => u.team === 'ally')!
  battle.phase = 'player'
  battle.activeUnitUid = hero.uid
  battle.selectedUnitUid = hero.uid
  rimefang.shield = 0
  rimefang.hp = rimefang.maxHp

  const testCases: readonly { heroPos: [number, number]; hitTile: [number, number] }[] = [
    { heroPos: [7, 3], hitTile: [8, 3] }, // top-left anchor
    { heroPos: [10, 3], hitTile: [9, 3] }, // top-right
    { heroPos: [7, 4], hitTile: [8, 4] }, // bottom-left
    { heroPos: [10, 4], hitTile: [9, 4] }  // bottom-right
  ]
  for (const tc of testCases) {
    hero.col = tc.heroPos[0]
    hero.row = tc.heroPos[1]
    const [hx, hy, hz] = computeFootprintWorldCenter(battle, hero.col, hero.row, 1)
    hero.x = hx
    hero.y = hy
    hero.z = hz
    hero.moved = false
    hero.acted = false
    battle.armedSkillIndex = null
    battle.armedTacticUid = null
    refreshHighlights(battle, state.campaign)

    // Hero must NOT be allowed to walk onto any of Rimefang's 4 tiles
    const moves = computeMoveTiles(battle, hero)
    for (const fc of fpCells) {
      assert.equal(
        moves.some(m => m.col === fc.col && m.row === fc.row),
        false,
        `Hero must not move onto Rimefang footprint tile (${fc.col},${fc.row})`
      )
    }

    const targets = computeTargetTiles(battle, hero, -1)
    assert.equal(
      targets.some(t => t.col === tc.hitTile[0] && t.row === tc.hitTile[1]),
      true,
      `Footprint tile (${tc.hitTile[0]},${tc.hitTile[1]}) must be targetable from (${tc.heroPos[0]},${tc.heroPos[1]})`
    )
    const forecast = computeCombatForecast(state, tc.hitTile[0], tc.hitTile[1])
    assert.equal(forecast?.targetUid, rimefang.uid)

    const hpBefore = rimefang.hp
    const ok = selectTile(state, tc.hitTile[0], tc.hitTile[1])
    assert.equal(ok, true, `Striking Rimefang at (${tc.hitTile[0]},${tc.hitTile[1]}) must succeed`)
    assert.ok(rimefang.hp < hpBefore, `Striking footprint tile (${tc.hitTile[0]},${tc.hitTile[1]}) must damage Rimefang`)
  }

  // 3. Multi-tile boss is immovable against knockback/pull/swap
  const kbPreview = resolveDisplacementPreview(battle, hero, rimefang, { kind: 'knockback', distance: 2 })
  assert.equal(kbPreview.moved, false)
  assert.equal(kbPreview.summaryTag, 'IMMOVABLE')
  const swapPreview = resolveDisplacementPreview(battle, hero, rimefang, { kind: 'swap', distance: 1 })
  assert.equal(swapPreview.moved, false)

  // 4. AoE hit deduplication: casting a cross AoE overlapping 3 tiles of Rimefang damages Rimefang ONCE!
  const mage = battle.units.find(u => u.team === 'ally' && u.heroId === 'mage')!
  ;(mage as { stars: 1 | 2 | 3 }).stars = 2
  mage.col = 7
  mage.row = 3
  mage.acted = false
  mage.moved = false
  mage.cooldowns = [0, 0, 0]
  mage.crit = 0
  battle.activeUnitUid = mage.uid
  battle.selectedUnitUid = mage.uid
  rimefang.hp = rimefang.maxHp
  rimefang.shield = 0
  const aoeForecast = (() => {
    armSkill(state, 1) // Ember Nova (cross pattern)
    return computeCombatForecast(state, 8, 3)
  })()
  assert.ok(aoeForecast, 'Ember Nova forecast against Rimefang must exist')
  const hpBeforeAoe = rimefang.hp
  selectTile(state, 8, 3)
  const dmgDealt = hpBeforeAoe - rimefang.hp
  assert.equal(dmgDealt, aoeForecast.normalDmg, 'AoE overlapping multiple 2x2 tiles must damage Rimefang exactly once')

  // 5. Tactic Card targeting any of the 4 tiles works
  const flameCard = state.campaign.tactics.find(t => t.tacticId === 'flame_scroll')
  if (flameCard) {
    battle.hand = [flameCard.uid]
    battle.ap = 4
    armTacticCard(state, flameCard.uid)
    assert.ok(battle.targetTiles.some(t => t.col === 9 && t.row === 4), 'Enemy tactic must allow clicking bottom-right 2x2 tile')
    const hpBeforeTac = rimefang.hp
    assert.equal(selectTile(state, 9, 4), true)
    assert.ok(rimefang.hp < hpBeforeTac, 'Enemy tactic on (9,4) must damage Rimefang')
  }

  // 6. Rimefang movement only returns valid 2x2 anchors where all 4 tiles are walkable & free
  rimefang.moved = false
  rimefang.stunTurns = 0
  const wyrmMoves = computeMoveTiles(battle, rimefang)
  assert.ok(wyrmMoves.length > 0, 'Rimefang should have valid 2x2 perches on the summit platform')
  for (const m of wyrmMoves) {
    assert.equal(isValidFootprintAnchor(battle, m.col, m.row, 2, rimefang.uid), true)
  }

  // 7. Glacial Breath: wide frost cone/cross, pillar cover exclusion, Slow + Freeze combo!
  // Place hero at (4, 2) (range 2 from Rimefang's (6,2), with pillar at (3,3) nearby)
  const victimA = battle.units.find(u => u.team === 'ally')!
  const otherAllies = battle.units.filter(u => u.team === 'ally' && u.uid !== victimA.uid)
  for (let i = 0; i < otherAllies.length; i++) {
    otherAllies[i].col = 0
    otherAllies[i].row = 2 + i
  }
  victimA.col = rimefang.col - 2
  victimA.row = rimefang.row
  victimA.hp = victimA.maxHp
  victimA.shield = 0
  victimA.slowTurns = 1 // Already Slowed -> Frost breath triggers FREEZE (Stun)!
  victimA.stunTurns = 0
  rimefang.cooldowns = [0, 0, 0]

  const breathCells = computeGlacialBreathCells(battle, rimefang, victimA.col, victimA.row)
  assert.ok(breathCells.length >= 4, 'Glacial Breath must cover a wide cone/cross')
  assert.equal(
    breathCells.some(c => battle.cells[c.row][c.col].terrain === 'pillar'),
    false,
    'Stone pillars must block Glacial Breath cells'
  )

  const planBreath = chooseFrostwyrmSpecial(battle, rimefang, battle.units.filter(u => u.team === 'ally'))
  assert.equal(planBreath?.move, 'glacial_breath')

  state.vfx.length = 0
  advanceEnemyTurn(state, rimefang)
  assert.equal(rimefang.cooldowns[0], FROSTWYRM_BREATH_COOLDOWN)
  assert.ok(victimA.hp < victimA.maxHp, 'Glacial Breath must damage hero')
  assert.equal(victimA.stunTurns >= 1, true, 'Glacial Breath on Slowed hero must trigger FREEZE Stun combo')
  assert.ok(state.vfx.some(v => v.kind === 'special' && v.move === 'frostwyrm_breath'), 'Glacial Breath must emit frostwyrm_breath VFX')

  // 8. Wing Buffet: adjacent hero knocked back 2 tiles into cover pillar!
  victimA.col = rimefang.col - 1
  victimA.row = rimefang.row + 1
  battle.cells[victimA.row][victimA.col - 2].terrain = 'pillar'
  battle.cells[victimA.row][victimA.col - 2].walkable = false
  victimA.hp = victimA.maxHp
  victimA.shield = 0
  victimA.stunTurns = 0
  assert.equal(distanceBetweenUnits(rimefang, victimA), 1)
  rimefang.cooldowns = [2, 0, 0] // Breath on CD, Wing Buffet ready!

  const planBuffet = chooseFrostwyrmSpecial(battle, rimefang, battle.units.filter(u => u.team === 'ally'))
  assert.equal(planBuffet?.move, 'wing_buffet')

  advanceEnemyTurn(state, rimefang)
  assert.equal(rimefang.cooldowns[1], FROSTWYRM_WING_BUFFET_COOLDOWN)
  assert.equal(victimA.col, rimefang.col - 2, 'Wing Buffet knockback 2 west must slam into pillar and stop 1 tile east of it')
  assert.equal(victimA.row, rimefang.row + 1)
  assert.ok(victimA.stunTurns >= 1, 'Slamming into stone pillar from Wing Buffet must stun hero')

  // 9. Save / Resume round-trip parity for 2x2 raid boss!
  battle.phase = 'player'
  battle.activeUnitUid = victimA.uid
  battle.selectedUnitUid = victimA.uid
  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap, 'Battle with 2x2 boss must serialize cleanly')
  const roundTrip = JSON.parse(JSON.stringify(snap))
  const validated = validateBattleSnapshot(roundTrip)
  assert.ok(validated, '2x2 boss snapshot must pass validateBattleSnapshot')
  const bossSnap = validated.units.find(u => u.enemyId === 'frostwyrm_rimefang')
  assert.equal(bossSnap?.footprintSize, 2)

  // Corrupt snapshot placing a hero inside Rimefang's bottom-right cell must be rejected!
  const corrupt = JSON.parse(JSON.stringify(snap))
  const heroSnap = corrupt.units.find((u: { team: string }) => u.team === 'ally')
  heroSnap.col = rimefang.col + 1
  heroSnap.row = rimefang.row + 1
  assert.equal(validateBattleSnapshot(corrupt), null, 'Snapshot overlapping a 2x2 boss footprint cell must be rejected')

  const resumed = createInitialState(9999)
  assert.equal(restoreBattleState(resumed, roundTrip), true)
  const resumedBoss = resumed.battle!.units.find(u => u.enemyId === 'frostwyrm_rimefang')!
  assert.equal(getUnitFootprintSize(resumedBoss), 2)
  assert.equal(unitAt(resumed.battle!, resumedBoss.col + 1, resumedBoss.row + 1)?.uid, resumedBoss.uid)
  const [ex, ey, ez] = computeFootprintWorldCenter(resumed.battle!, resumedBoss.col, resumedBoss.row, 2)
  assert.ok(Math.abs(resumedBoss.x - ex) < 1e-6 && Math.abs(resumedBoss.y - ey) < 1e-6 && Math.abs(resumedBoss.z - ez) < 1e-6)
})

test('Lich Vaelen & Rimefang have valid 3D rigs, portraits, animations, scene rendering, and Godot compilation', () => {
  const bosses: readonly EnemyArchetypeId[] = ['lich_vaelen', 'frostwyrm_rimefang']
  const portraits = bakePortraitPixels(48)

  for (const id of bosses) {
    assert.ok(ENEMY_SPECS[id], `ENEMY_SPECS[${id}] must exist`)
    assert.ok(ENEMY_CHARACTER_SPECS[id], `ENEMY_CHARACTER_SPECS[${id}] must exist`)
    const rig = ENEMY_RIGS[id]
    assert.ok(rig, `ENEMY_RIGS[${id}] must exist`)
    assert.ok(rig.joints.length >= 6, `${id} rig must have full joint hierarchy`)
    assert.ok(attackClipFor(undefined, id).length > 0)
    assert.ok(deathClipFor(undefined, id, true).length > 0)
    assert.ok(gaitFor(undefined, id).length > 0)
    assert.ok(stanceOffsetFor(undefined, id))

    const p = portraits[id]
    assert.ok(p, `Portrait for ${id} must be baked`)
    let opaque = 0
    for (let i = 3; i < p.pixels.length; i += 4) {
      if (p.pixels[i] > 128) opaque++
    }
    assert.ok(opaque > 120, `Portrait for ${id} must render visible opaque silhouette (got ${opaque} pixels)`)
  }

  // Render all 4 expansion stages in CrownshardScene without throwing
  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)
  for (const stageId of ACT2_EXPANSION_STAGE_IDS) {
    const st = createInitialState(4040)
    startStageBattle(st, stageId)
    scene.render(st, 1 / 60, 1280, 720)
    assert.ok(fake.lastInstances() > 25, `${stageId} scene render must emit diorama + unit instances`)
  }
  scene.dispose()

  // Verify expansion-act2.ts compiles cleanly to Godot GDScript via compileTsToGd
  const srcPath = resolve('examples/crownshard/crownshard/expansion-act2.ts')
  const source = readFileSync(srcPath, 'utf8')
  const gdCode = compileTsToGd(source, 'expansion-act2.ts')
  assert.ok(gdCode.length > 200, 'expansion-act2.ts must emit valid GDScript output')
  assert.ok(gdCode.includes('func getUnitFootprintCells') || gdCode.includes('func get_unit_footprint_cells'), 'Compiled GDScript must export footprint helper')
  assert.ok(gdCode.includes('func chooseFrostwyrmSpecial') || gdCode.includes('func choose_frostwyrm_special'), 'Compiled GDScript must export Frostwyrm special helper')
})
