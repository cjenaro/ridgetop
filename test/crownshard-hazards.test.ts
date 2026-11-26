import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { buildStaticBoardBatches } from '../examples/crownshard/crownshard/art.ts'
import { PLAYABLE_CHAPTERS } from '../examples/crownshard/crownshard/data.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill, canTraverseStep, canUndoMove, computeCombatForecast, computeCoverBonus,
  computeMoveTiles, computeTargetTiles, createInitialState, endPlayerTurn, findGridPath,
  getUnitByUid, hasLineOfSight, isGeyserEruptingOnTurn, isIntactBarricade, restoreBattleState,
  selectHeroByUid, selectTile, serializeBattleState, startChapterBattle, startStageBattle,
  stepGame, syncLavaGeysers
} from '../examples/crownshard/crownshard/simulation.ts'
import {
  BARRICADE_DEFAULT_HP, CURSED_ALTAR_HP_COST, TALL_GRASS_RANGED_COVER,
  terrainElevation, terrainWalkable
} from '../examples/crownshard/crownshard/types.ts'
import type { GridCell, TileTerrain } from '../examples/crownshard/crownshard/types.ts'

function makeCell(col: number, row: number, terrain: TileTerrain, heightLevel = 0): GridCell {
  const h = terrain === 'void' ? -1 : heightLevel
  return {
    col,
    row,
    terrain,
    elevation: terrainElevation(terrain, h),
    walkable: terrainWalkable(terrain),
    heightLevel: h,
    ...(terrain === 'barricade' ? { barricadeHp: BARRICADE_DEFAULT_HP, barricadeMaxHp: BARRICADE_DEFAULT_HP } : {}),
    ...(terrain === 'lava_geyser' ? { geyserActive: false } : {}),
    ...(terrain === 'cursed_altar' ? { altarUsed: false } : {})
  }
}

function fakeRenderer() {
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render() { return stats }
  }
  return renderer as unknown as LowPolyRenderer
}

function flattenBoard(battle: { cols: number; rows: number; cells: GridCell[][] }) {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, 'grass', 0)
    }
  }
}

test('Lava Geyser cycles periodically, deals fire damage + Burn on step and turn-start, and locks Undo Move', () => {
  assert.equal(isGeyserEruptingOnTurn(1), false, 'Turn 1 geysers should start dormant (telegraphed)')
  assert.equal(isGeyserEruptingOnTurn(2), true, 'Turn 2 geysers should erupt')
  assert.equal(isGeyserEruptingOnTurn(3), false, 'Turn 3 geysers should go dormant again')
  assert.equal(isGeyserEruptingOnTurn(4), true, 'Turn 4 geysers should erupt again')

  const state = createInitialState(8101)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== hero.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  hero.col = 1
  hero.row = 2
  hero.hp = 60
  hero.maxHp = 60
  hero.shield = 0
  hero.burnTurns = 0
  hero.moved = false
  enemy.col = 6
  enemy.row = 4

  // Place Lava Geyser at (2, 2)
  battle.cells[2][2] = makeCell(2, 2, 'lava_geyser', 0)
  assert.equal(battle.cells[2][2].walkable, true, 'Lava Geyser must be walkable')

  // Activate eruption cycle (turn 2)
  battle.turn = 2
  syncLavaGeysers(battle)
  assert.equal(battle.cells[2][2].geyserActive, true)
  selectHeroByUid(state, hero.uid)

  // Step onto the active Lava Geyser!
  const hpBefore = hero.hp
  assert.equal(selectTile(state, 2, 2), true)
  for (let i = 0; i < 60; i++) stepGame(state, STEP)

  assert.equal(hero.col, 2)
  assert.equal(hero.row, 2)
  assert.ok(hero.hp < hpBefore, `Stepping onto erupting geyser must deal magma damage (before=${hpBefore}, after=${hero.hp})`)
  assert.ok(hero.burnTurns >= 2, `Stepping onto erupting geyser must inflict Burn (got ${hero.burnTurns})`)
  assert.equal(canUndoMove(battle), false, 'Triggering an erupting Lava Geyser must lock out Undo Move')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'GEYSER!'), 'Should emit GEYSER! callout')

  // Verify turn-start eruption damage when standing on a geyser on an erupting turn
  hero.burnTurns = 0
  hero.hp = 60
  hero.ct = 200
  enemy.ct = 0
  battle.turn = 3 // Next turn becomes 4 (erupting!)
  const hpBeforeTurnStart = hero.hp
  endPlayerTurn(state)
  assert.equal(battle.turn, 4)
  assert.equal(battle.cells[2][2].geyserActive, true)
  assert.ok(hero.hp < hpBeforeTurnStart, 'Starting turn on an erupting Lava Geyser must deal fire damage')
  assert.ok(hero.burnTurns >= 2, 'Starting turn on an erupting Lava Geyser must apply Burn')
})

test('Ice Sheet grants +1 slick glide movement reach compared to standard grass', () => {
  const state = createInitialState(8102)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  for (const u of battle.units) {
    if (u.uid !== hero.uid) { u.alive = false; u.hp = 0 }
  }

  hero.col = 0
  hero.row = 2
  hero.move = 3
  hero.moved = false

  // Baseline on pure grass: move 3 reaches col 3, NOT col 4
  const grassMoves = computeMoveTiles(battle, hero)
  assert.equal(grassMoves.some(m => m.col === 3 && m.row === 2), true, 'Grass reach with move 3 includes col 3')
  assert.equal(grassMoves.some(m => m.col === 4 && m.row === 2), false, 'Grass reach with move 3 does NOT include col 4')

  // Place an Ice Sheet at (1, 2): stepping onto ice grants +1 slick glide momentum!
  battle.cells[2][1] = makeCell(1, 2, 'ice', 0)
  battle.cells[2][2] = makeCell(2, 2, 'ice', 0)
  const iceMoves = computeMoveTiles(battle, hero)
  assert.equal(iceMoves.some(m => m.col === 4 && m.row === 2), true, 'Ice Sheet glide must extend move 3 reach to col 4 (+1 tile)')
  assert.equal(iceMoves.some(m => m.col === 5 && m.row === 2), false, 'Ice Sheet glide caps cleanly at +1 bonus tile (not infinite slide)')

  const icePath = findGridPath(battle, hero, 4, 2)
  assert.equal(icePath.length, 4, 'Path across ice sheet to col 4 should be 4 steps')
  assert.deepEqual(icePath[0], { col: 1, row: 2 })
  assert.deepEqual(icePath[3], { col: 4, row: 2 })

  // Actually move hero across the ice sheet and verify arrival at col 4!
  selectHeroByUid(state, hero.uid)
  assert.equal(selectTile(state, 4, 2), true)
  for (let i = 0; i < 160; i++) stepGame(state, STEP)
  assert.equal(hero.col, 4)
  assert.equal(hero.row, 2)
})

test('Cursed Altar triggers a one-time non-lethal dark pact (+Empower, +1 AP, HP drain) and locks Undo Move', () => {
  const state = createInitialState(8103)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const hero = getUnitByUid(battle, battle.activeUnitUid)!
  const enemy = battle.units.find(u => u.alive && u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== hero.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  hero.col = 1
  hero.row = 2
  hero.hp = 40
  hero.maxHp = 60
  hero.empowerTurns = 0
  hero.moved = false
  enemy.col = 6
  enemy.row = 4

  battle.ap = 2
  battle.maxAp = 4
  battle.cells[2][2] = makeCell(2, 2, 'cursed_altar', 0)
  assert.equal(battle.cells[2][2].altarUsed, false)
  selectHeroByUid(state, hero.uid)

  // Step onto the unused Cursed Altar!
  assert.equal(selectTile(state, 2, 2), true)
  for (let i = 0; i < 60; i++) stepGame(state, STEP)

  assert.equal(battle.cells[2][2].altarUsed, true, 'Cursed Altar must be marked spent after first use')
  assert.equal(hero.hp, 40 - CURSED_ALTAR_HP_COST, 'Cursed Altar must sacrifice HP cost')
  assert.equal(hero.empowerTurns, 2, 'Cursed Altar must grant +2 turns of Empower')
  assert.equal(battle.ap, 3, 'Cursed Altar must grant +1 AP to allies')
  assert.equal(canUndoMove(battle), false, 'Claiming a Cursed Altar pact must lock out Undo Move')
  assert.ok(state.vfx.some(ev => ev.kind === 'burst' && ev.style === 'shadow'), 'Cursed Altar must emit dark-violet shadow burst VFX')

  // Verify non-lethal guarantee: stepping onto a second fresh altar at 5 HP leaves hero alive at 1 HP!
  battle.cells[2][3] = makeCell(3, 2, 'cursed_altar', 0)
  hero.hp = 5
  hero.moved = false
  selectHeroByUid(state, hero.uid)
  assert.equal(selectTile(state, 3, 2), true)
  for (let i = 0; i < 60; i++) stepGame(state, STEP)
  assert.equal(hero.alive, true, 'Cursed Altar HP sacrifice must be strictly non-lethal')
  assert.equal(hero.hp, 1, 'Low-HP hero must be left at 1 HP after dark pact')
  assert.equal(hero.empowerTurns, 4, 'Second altar stacks +2 Empower turns')

  // Stepping back onto an already-spent altar does NOT re-trigger HP drain or buffs
  const hpAfter = hero.hp
  const empAfter = hero.empowerTurns
  const apAfter = battle.ap
  hero.moved = false
  selectHeroByUid(state, hero.uid)
  assert.equal(selectTile(state, 2, 2), true)
  for (let i = 0; i < 60; i++) stepGame(state, STEP)
  assert.equal(hero.hp, hpAfter)
  assert.equal(hero.empowerTurns, empAfter)
  assert.equal(battle.ap, apAfter)
})

test('Tall Grass grants ranged Cover/Evasion bonus and crit reduction in forecast and combat, but not against melee', () => {
  const state = createInitialState(8104)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const archer = battle.units.find(u => u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== archer.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  archer.col = 1
  archer.row = 2
  archer.range = 4
  archer.crit = 0.25
  archer.acted = false
  enemy.col = 4
  enemy.row = 2
  enemy.hp = 100
  enemy.maxHp = 100
  enemy.shield = 0
  enemy.facing = 'w'

  // Open grass ranged baseline (dist = 3)
  selectHeroByUid(state, archer.uid)
  const fcOpen = computeCombatForecast(state, 4, 2)!
  assert.ok(fcOpen)
  assert.equal(fcOpen.coverBonus, 0)

  // Place Tall Grass under defender at (4, 2)
  battle.cells[2][4] = makeCell(4, 2, 'tall_grass', 0)
  assert.equal(computeCoverBonus(battle, 1, 2, 4, 2), TALL_GRASS_RANGED_COVER, 'Tall Grass must grant +3 ranged Cover DEF')
  assert.equal(computeCoverBonus(battle, 3, 2, 4, 2), 0, 'Tall Grass must grant 0 Cover DEF against adjacent melee')

  selectHeroByUid(state, archer.uid)
  const fcTallGrassRanged = computeCombatForecast(state, 4, 2)!
  assert.ok(fcTallGrassRanged)
  assert.equal(fcTallGrassRanged.coverBonus, TALL_GRASS_RANGED_COVER, 'CombatForecast must expose Tall Grass ranged Cover DEF')
  assert.ok(fcTallGrassRanged.normalDmg < fcOpen.normalDmg, 'Tall Grass must reduce ranged damage')
  assert.ok(fcTallGrassRanged.critChance < fcOpen.critChance, 'Tall Grass concealment must reduce ranged crit chance')

  // Verify actual resolved ranged damage matches Tall Grass forecast (with crit=0)
  archer.crit = 0
  selectHeroByUid(state, archer.uid)
  const fcDet = computeCombatForecast(state, 4, 2)!
  const hpBefore = enemy.hp
  assert.equal(selectTile(state, 4, 2), true)
  assert.equal(hpBefore - enemy.hp, fcDet.normalDmg, 'Actual ranged damage against Tall Grass must match forecast')

  // Adjacent melee shot (dist = 1) ignores Tall Grass cover & crit penalty!
  archer.col = 3
  archer.row = 2
  archer.crit = 0.25
  archer.acted = false
  selectHeroByUid(state, archer.uid)
  const fcMelee = computeCombatForecast(state, 4, 2)!
  assert.ok(fcMelee)
  assert.equal(fcMelee.coverBonus, 0, 'Melee attack into Tall Grass must have 0 cover bonus')
  assert.equal(fcMelee.normalDmg, fcOpen.normalDmg, 'Melee attack deals full unmitigated damage into Tall Grass')
  assert.equal(fcMelee.critChance, fcOpen.critChance, 'Melee attack suffers no Tall Grass crit penalty')
})

test('Destructible Barricade blocks movement & LoS while intact, takes damage, and shatters at 0 HP opening path & LoS', () => {
  const state = createInitialState(8105)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const archer = battle.units.find(u => u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== archer.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // Seal a narrow corridor across row 2 with a barricade at (2, 2)
  battle.cells[2][2] = makeCell(2, 2, 'barricade', 0)
  assert.equal(isIntactBarricade(battle.cells[2][2]), true)
  assert.equal(battle.cells[2][2].walkable, false)
  assert.equal(battle.cells[2][2].barricadeHp, BARRICADE_DEFAULT_HP)

  archer.col = 1
  archer.row = 2
  archer.atk = 15
  archer.range = 4
  archer.acted = false
  archer.moved = false
  enemy.col = 4
  enemy.row = 2

  // 1. Intact barricade blocks movement onto (2,2) and blocks direct LoS from (1,2) -> (4,2)
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), false, 'Intact barricade must block direct LoS')
  const movesBefore = computeMoveTiles(battle, archer)
  assert.equal(movesBefore.some(m => m.col === 2 && m.row === 2), false, 'Intact barricade must block movement')

  // 2. Barricade IS targetable by basic attacks & shows a CombatForecast!
  selectHeroByUid(state, archer.uid)
  const targets = computeTargetTiles(battle, archer, -1)
  assert.equal(targets.some(t => t.col === 2 && t.row === 2), true, 'Intact barricade must appear in targetTiles')
  const fcBar = computeCombatForecast(state, 2, 2)!
  assert.ok(fcBar, 'Hovering an intact barricade must return a CombatForecast')
  assert.equal(fcBar.targetName, 'Timber Barricade')
  assert.equal(fcBar.targetHpBefore, 25)
  assert.equal(fcBar.normalDmg, 15)
  assert.equal(fcBar.targetHpAfterNormal, 10)
  assert.equal(fcBar.lethalNormal, false)

  // 3. First attack damages barricade (25 -> 10 HP), still intact
  assert.equal(selectTile(state, 2, 2), true)
  assert.equal(battle.cells[2][2].terrain, 'barricade')
  assert.equal(battle.cells[2][2].barricadeHp, 10)
  assert.equal(battle.cells[2][2].walkable, false)
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), false)

  // 4. Second attack shatters barricade (10 -> 0 HP) -> transforms into walkable stone, opening path & LoS!
  archer.acted = false
  selectHeroByUid(state, archer.uid)
  const fcShatter = computeCombatForecast(state, 2, 2)!
  assert.equal(fcShatter.lethalNormal, true, 'Finishing blow on barricade should forecast lethal shatter')
  assert.equal(selectTile(state, 2, 2), true)

  assert.equal(battle.cells[2][2].terrain, 'stone', 'Destroyed barricade must become walkable stone rubble')
  assert.equal(battle.cells[2][2].walkable, true)
  assert.equal(isIntactBarricade(battle.cells[2][2]), false)
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), true, 'Destroying barricade must immediately open direct LoS')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'SHATTERED!'))

  const movesAfter = computeMoveTiles(battle, archer)
  assert.equal(movesAfter.some(m => m.col === 2 && m.row === 2), true, 'Destroyed barricade tile must now be reachable for movement')

  // Verify skills can also shatter barricades
  battle.cells[2][3] = makeCell(3, 2, 'barricade', 0)
  battle.cells[2][3].barricadeHp = 10
  archer.acted = false
  archer.cooldowns = [0, 0, 0]
  assert.equal(armSkill(state, 0), true)
  assert.equal(selectTile(state, 3, 2), true)
  assert.equal(battle.cells[2][3].terrain, 'stone', 'Offensive hero skill must be able to destroy barricades')
})

test('Auto-Save round-trip preserves hazard tile dynamic states (barricadeHp, altarUsed, geyserActive)', () => {
  const state = createInitialState(8106)
  const battle = startStageBattle(state, 'eclipse_throne')

  // Set distinct dynamic states across all hazard types on the board
  battle.cells[2][2] = makeCell(2, 2, 'barricade', 1)
  battle.cells[2][2].barricadeHp = 13
  battle.cells[2][2].barricadeMaxHp = 25

  battle.cells[2][3] = makeCell(3, 2, 'cursed_altar', 1)
  battle.cells[2][3].altarUsed = true

  battle.cells[2][4] = makeCell(4, 2, 'lava_geyser', 2)
  battle.cells[2][4].geyserActive = true

  battle.cells[3][2] = makeCell(2, 3, 'ice', 1)
  battle.cells[3][3] = makeCell(3, 3, 'tall_grass', 1)

  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap, 'Battle with hazards must serialize cleanly')

  const restoredState = createInitialState(9999)
  assert.equal(restoreBattleState(restoredState, snap), true, 'Serialized hazard battle must restore cleanly')
  const rb = restoredState.battle!

  assert.equal(rb.cells[2][2].terrain, 'barricade')
  assert.equal(rb.cells[2][2].barricadeHp, 13, 'barricadeHp must survive Auto-Save round-trip')
  assert.equal(rb.cells[2][2].barricadeMaxHp, 25)
  assert.equal(rb.cells[2][2].walkable, false)

  assert.equal(rb.cells[2][3].terrain, 'cursed_altar')
  assert.equal(rb.cells[2][3].altarUsed, true, 'altarUsed must survive Auto-Save round-trip')

  assert.equal(rb.cells[2][4].terrain, 'lava_geyser')
  assert.equal(rb.cells[2][4].geyserActive, true, 'geyserActive must survive Auto-Save round-trip')

  assert.equal(rb.cells[3][2].terrain, 'ice')
  assert.equal(rb.cells[3][3].terrain, 'tall_grass')
})

test('All 14 playable chapters remain jump-1 connected, include all 5 hazards across biomes, and render cleanly in CrownshardScene', () => {
  const seenHazards = new Set<TileTerrain>()
  const scene = createCrownshardScene(fakeRenderer())

  for (const ch of PLAYABLE_CHAPTERS) {
    const state = createInitialState(8200 + ch.index)
    const battle = startStageBattle(state, ch.id)

    for (let r = 0; r < battle.rows; r++) {
      for (let c = 0; c < battle.cols; c++) {
        const t = battle.cells[r][c].terrain
        if (t === 'lava_geyser' || t === 'ice' || t === 'cursed_altar' || t === 'tall_grass' || t === 'barricade') {
          seenHazards.add(t)
        }
      }
    }

    // Verify jump-1 connectivity from every hero spawn to every enemy spawn
    const reachableFrom = (startCol: number, startRow: number): Set<string> => {
      const seen = new Set<string>([`${startCol},${startRow}`])
      const q: [number, number][] = [[startCol, startRow]]
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
      while (q.length > 0) {
        const [cc, cr] = q.shift()!
        const from = battle.cells[cr][cc]
        for (const [dc, dr] of dirs) {
          const nc = cc + dc
          const nr = cr + dr
          if (nr < 0 || nr >= battle.rows || nc < 0 || nc >= battle.cols) continue
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
      assert.equal(battle.cells[hr][hc].walkable, true, `${ch.id} hero spawn (${hc},${hr}) must be walkable`)
      const reach = reachableFrom(hc, hr)
      for (const sp of ch.enemies) {
        assert.equal(battle.cells[sp.row][sp.col].walkable, true, `${ch.id} enemy spawn (${sp.col},${sp.row}) must be walkable`)
        assert.equal(
          reach.has(`${sp.col},${sp.row}`),
          true,
          `${ch.id}: hero spawn (${hc},${hr}) must reach enemy (${sp.col},${sp.row}) with jump=1`
        )
      }
    }

    // Verify static diorama build AND per-frame CrownshardScene render succeed cleanly (both dormant and erupting!)
    const built = buildStaticBoardBatches(battle.biome, battle.cells)
    assert.ok(built.batches.length >= 6, `${ch.id} static batches should build cleanly`)
    scene.render(state, 1 / 60, 1280, 720)
    battle.turn = 2
    syncLavaGeysers(battle)
    scene.render(state, 1 / 60, 1280, 720)
  }

  for (const h of ['lava_geyser', 'ice', 'cursed_altar', 'tall_grass', 'barricade'] as const) {
    assert.equal(seenHazards.has(h), true, `Expected hazard '${h}' to appear in playable campaign stages`)
  }
  scene.dispose()
})
