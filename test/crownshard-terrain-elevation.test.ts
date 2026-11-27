import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { buildStaticBoardBatches } from '../examples/crownshard/crownshard/art.ts'
import { CHAPTER_BY_ID, PLAYABLE_CHAPTERS } from '../examples/crownshard/crownshard/data.ts'
import { createCrownshardScene, pickCellFromRay } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill, canTraverseStep, computeCombatForecast, computeCoverBonus, computeMoveTiles,
  computeTargetTiles, createInitialState, effectiveAttackRange, elevationDamageMultiplier,
  findGridPath, getUnitByUid, hasLineOfSight, isIndirectSkill, selectHeroByUid, selectTile,
  startChapterBattle, startStageBattle
} from '../examples/crownshard/crownshard/simulation.ts'
import {
  HEIGHT_STEP, cellElevation, cellHeightAt, cellHeightLevel, gridToWorld,
  terrainDefBonus, terrainElevation, terrainMoveCost, terrainWalkable
} from '../examples/crownshard/crownshard/types.ts'
import type { BiomeId, GridCell, TileTerrain } from '../examples/crownshard/crownshard/types.ts'

function makeCell(col: number, row: number, terrain: TileTerrain, heightLevel = 0): GridCell {
  const h = terrain === 'void' ? -1 : heightLevel
  return {
    col,
    row,
    terrain,
    elevation: terrainElevation(terrain, h),
    walkable: terrainWalkable(terrain),
    heightLevel: h
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

test('Per-cell integer heightmap (0..4), unit Jump climb limits, and stairs/ramp climbing', () => {
  const state = createInitialState(5001)
  const battle = startChapterBattle(state, 0)

  // Verify elevation scaling across height levels 0..4
  for (let lvl = 0; lvl <= 4; lvl++) {
    const c = makeCell(0, 0, 'stone', lvl)
    assert.equal(cellHeightLevel(c), lvl)
    assert.ok(Math.abs(c.elevation - lvl * HEIGHT_STEP) < 1e-6)
  }

  // Build a custom 5x3 terraced test arena:
  // row 0: [0, 2, 2, 4, 4] (sheer 2-level cliff jump!)
  // row 1: [0, 1(stairs), 2, 3(stairs), 4] (smooth stair corridor!)
  // row 2: [0, 0, 0, 0, 0]
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, 'grass', 0)
    }
  }
  battle.cells[0][1] = makeCell(1, 0, 'stone', 2)
  battle.cells[0][2] = makeCell(2, 0, 'stone', 2)
  battle.cells[0][3] = makeCell(3, 0, 'stone', 4)
  battle.cells[1][1] = makeCell(1, 1, 'stairs', 1)
  battle.cells[1][2] = makeCell(2, 1, 'stone', 2)
  battle.cells[1][3] = makeCell(3, 1, 'stairs', 3)
  battle.cells[1][4] = makeCell(4, 1, 'stone', 4)

  // Clear other units out of the way
  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== archer.uid) {
      u.alive = false
      u.hp = 0
    }
  }
  assert.equal(knight.jump, 1, 'Heavy Knight should have jump = 1')
  assert.equal(archer.jump, 2, 'Agile Archer should have jump = 2')

  // Direct 0 -> 2 step: blocked for jump 1 Knight, allowed for jump 2 Archer!
  assert.equal(canTraverseStep(battle.cells[0][0], battle.cells[0][1], knight.jump), false)
  assert.equal(canTraverseStep(battle.cells[0][0], battle.cells[0][1], archer.jump), true)

  // Stairs bridge a 2-level step even for a jump 1 unit!
  const stairs2 = makeCell(1, 0, 'stairs', 2)
  assert.equal(canTraverseStep(battle.cells[0][0], stairs2, knight.jump), true, 'Stairs grant +1 climb reach for jump 1 units')

  // Place Knight at (0,0) and verify moveTiles cannot scale the sheer 0->2 cliff at (1,0)
  // directly, but CAN climb via stairs (1,1) -> (2,1) -> (2,0)!
  knight.col = 0
  knight.row = 0
  knight.move = 4
  knight.moved = false
  archer.col = 6
  archer.row = 4

  const knightMoves = computeMoveTiles(battle, knight)
  assert.equal(knightMoves.some(m => m.col === 1 && m.row === 1), true, 'Knight can step onto height-1 stairs')
  assert.equal(knightMoves.some(m => m.col === 2 && m.row === 1), true, 'Knight can climb from stairs to height-2 terrace')
  // Knight cannot hop directly 0->2 to (1,0), so path detours 3 steps via stairs (0,1)->(1,1)->(1,0)
  const pathViaStairs = findGridPath(battle, knight, 1, 0)
  assert.equal(pathViaStairs.length, 3, 'Knight must detour 3 steps via stairs instead of hopping the sheer 0->2 cliff')
  assert.deepEqual(pathViaStairs[0], { col: 0, row: 1 })
  assert.deepEqual(pathViaStairs[1], { col: 1, row: 1 })
  assert.deepEqual(pathViaStairs[2], { col: 1, row: 0 })
  // With move = 2, Knight cannot reach (1,0) at all since direct 0->2 hop is blocked
  knight.move = 2
  assert.equal(findGridPath(battle, knight, 1, 0).length, 0, 'Knight with move 2 cannot hop 0->2 cliff directly')

  // Archer (jump 2) CAN directly hop 0 -> 2 onto (1,0) in 1 step!
  archer.col = 0
  archer.row = 0
  archer.moved = false
  knight.col = 6
  knight.row = 4
  const archerPath = findGridPath(battle, archer, 1, 0)
  assert.equal(archerPath.length, 1, 'Archer (jump 2) hops straight onto height-2 cliff in 1 step')
  assert.deepEqual(archerPath[0], { col: 1, row: 0 })
  assert.equal(cellHeightAt(battle, 1, 0), 2)
  assert.ok(Math.abs(cellElevation(battle, 1, 0) - 2 * HEIGHT_STEP) < 1e-6)
})

test('Void chasm cells are non-walkable and all 14 retrofitted playable chapters have valid irregular layouts, height variety, and jump-1 connectivity', () => {
  assert.equal(terrainWalkable('void'), false)
  assert.equal(terrainMoveCost('void'), 99)

  let stagesWithVoid = 0
  let stagesWithStairs = 0
  const observedHeights = new Set<number>()

  for (const ch of PLAYABLE_CHAPTERS) {
    assert.ok(ch.heights, `${ch.id} must define an explicit per-cell heightmap`)
    const rows = ch.grid.length
    const cols = ch.grid[0].length
    assert.equal(ch.heights.length, rows, `${ch.id} heights row count must match grid`)
    for (let r = 0; r < rows; r++) {
      assert.equal(ch.heights[r].length, cols, `${ch.id} heights row ${r} length must match grid`)
    }

    const state = createInitialState(6000 + ch.index)
    const battle = startStageBattle(state, ch.id)

    let hasVoid = false
    let hasStairs = false
    for (let r = 0; r < battle.rows; r++) {
      for (let c = 0; c < battle.cols; c++) {
        const cell = battle.cells[r][c]
        if (cell.terrain === 'void') {
          hasVoid = true
          assert.equal(cell.walkable, false, `${ch.id} void cell (${c},${r}) must not be walkable`)
        } else {
          const h = cellHeightLevel(cell)
          assert.ok(h >= 0 && h <= 4, `${ch.id} height (${c},${r}) out of 0..4 range: ${h}`)
          observedHeights.add(h)
          if (cell.terrain === 'stairs') hasStairs = true
        }
      }
    }
    if (hasVoid) stagesWithVoid++
    if (hasStairs) stagesWithStairs++

    // Verify all hero spawns and enemy spawns sit on walkable non-void tiles
    // AND every enemy spawn is reachable from every hero spawn with jump=1!
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
      assert.notEqual(battle.cells[hr][hc].terrain, 'void')
      const reach = reachableFrom(hc, hr)
      for (const sp of ch.enemies) {
        assert.equal(battle.cells[sp.row][sp.col].walkable, true, `${ch.id} enemy spawn (${sp.col},${sp.row}) must be walkable`)
        assert.notEqual(battle.cells[sp.row][sp.col].terrain, 'void')
        assert.equal(
          reach.has(`${sp.col},${sp.row}`),
          true,
          `${ch.id}: hero spawn (${hc},${hr}) must be able to reach enemy (${sp.col},${sp.row}) with jump=1`
        )
      }
    }
  }

  assert.equal(stagesWithVoid, PLAYABLE_CHAPTERS.length, 'All 14 playable stages should have irregular void cutouts')
  assert.equal(stagesWithStairs, PLAYABLE_CHAPTERS.length, 'All 14 playable stages should feature stairs/ramps')
  for (let lvl = 0; lvl <= 4; lvl++) {
    assert.equal(observedHeights.has(lvl), true, `Height level ${lvl} must appear across playable chapters`)
  }
})

test('Terrain movement costs (deep snow costs 2 move vs grass/stone/bridge cost 1) and terrain defense modifiers', () => {
  assert.equal(terrainMoveCost('snow'), 2)
  assert.equal(terrainMoveCost('grass'), 1)
  assert.equal(terrainMoveCost('stone'), 1)
  assert.equal(terrainMoveCost('bridge'), 1)
  assert.equal(terrainMoveCost('stairs'), 1)

  assert.equal(terrainDefBonus('darkstone'), 2)
  assert.equal(terrainDefBonus('stone'), 1)
  assert.equal(terrainDefBonus('shrine'), 1)
  assert.equal(terrainDefBonus('bridge'), -1)
  assert.equal(terrainDefBonus('grass'), 0)

  const state = createInitialState(5002)
  const battle = startChapterBattle(state, 0)
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, 'grass', 0)
    }
  }
  // Row 1 is a snowfield (cost 2 per tile); row 2 is paved flagstone (cost 1 per tile)
  for (let c = 1; c < battle.cols; c++) {
    battle.cells[1][c] = makeCell(c, 1, 'snow', 0)
    battle.cells[2][c] = makeCell(c, 2, 'stone', 0)
  }

  const unit = getUnitByUid(battle, battle.activeUnitUid)!
  for (const u of battle.units) {
    if (u.uid !== unit.uid) { u.alive = false; u.hp = 0 }
  }
  unit.col = 0
  unit.row = 1
  unit.move = 3
  unit.moved = false

  // On pure snow row (cost 2 each), move=3 can enter (1,1) (cost 2) but NOT (2,1) (cost 4)!
  //Wait: (0,1)->(0,2)[grass:1]->(1,2)[stone:2]->(2,2)[stone:3] can reach col 2 on row 2,
  // while (2,1) would cost 1+1+1+2=5 or 2+2=4 > 3!
  const moves = computeMoveTiles(battle, unit)
  assert.equal(moves.some(m => m.col === 1 && m.row === 1), true, 'Can step 1 tile into deep snow (cost 2 <= 3)')
  assert.equal(moves.some(m => m.col === 2 && m.row === 1), false, 'Cannot move 2 tiles across deep snow with move 3 (cost 4 > 3)')
  assert.equal(moves.some(m => m.col === 2 && m.row === 2), true, 'Can step onto stone road and travel 3 tiles (cost 3 <= 3)')
})

test('High-ground ranged reach (+1 downhill, -1 steep uphill) and multi-tier elevation damage scaling', () => {
  const state = createInitialState(5003)
  const battle = startChapterBattle(state, 0)
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, 'grass', 0)
    }
  }
  battle.cells[2][1] = makeCell(1, 2, 'hill', 3) // High tower (H3)
  battle.cells[2][5] = makeCell(5, 2, 'grass', 0) // Low valley (H0), dist = 4!
  battle.cells[2][3] = makeCell(3, 2, 'grass', 0) // Mid valley (H0), dist = 2

  const archer = battle.units.find(u => u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== archer.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // Downhill: H3 -> H0 grants +1 ranged reach (range 3 -> 4!)
  assert.equal(effectiveAttackRange(battle, 1, 2, 5, 2, 3), 4)
  // Flat: H0 -> H0 stays base range 3
  assert.equal(effectiveAttackRange(battle, 3, 2, 5, 2, 3), 3)
  // Steep uphill: H0 -> H3 (-3 levels <= -2) reduces ranged reach by -1 (range 3 -> 2!)
  assert.equal(effectiveAttackRange(battle, 5, 2, 1, 2, 3), 2)
  // Melee (baseRange 1) never shrinks below 1 or expands to 2
  assert.equal(effectiveAttackRange(battle, 1, 2, 2, 2, 1), 1)
  assert.equal(effectiveAttackRange(battle, 2, 2, 1, 2, 1), 1)

  // Elevation damage multiplier progression
  assert.ok(elevationDamageMultiplier(3, 0) > elevationDamageMultiplier(2, 0))
  assert.ok(elevationDamageMultiplier(2, 0) > elevationDamageMultiplier(1, 0))
  assert.ok(elevationDamageMultiplier(1, 0) > elevationDamageMultiplier(0, 0))
  assert.ok(elevationDamageMultiplier(0, 0) > elevationDamageMultiplier(0, 1))
  assert.ok(elevationDamageMultiplier(0, 1) > elevationDamageMultiplier(0, 2))

  // Verify Archer on H3 (1,2) with range 3 CAN target enemy at dist 4 on H0 (5,2)!
  archer.col = 1
  archer.row = 2
  archer.range = 3
  archer.acted = false
  enemy.col = 5
  enemy.row = 2
  enemy.hp = 100
  enemy.maxHp = 100
  enemy.shield = 0
  enemy.facing = 'w'
  selectHeroByUid(state, archer.uid)
  const targetsDownhill = computeTargetTiles(battle, archer, -1)
  assert.equal(targetsDownhill.some(t => t.col === 5 && t.row === 2), true, 'High ground extends Archer range 3 -> 4 downhill')
  const fcDown = computeCombatForecast(state, 5, 2)!
  assert.ok(fcDown)
  assert.equal(fcDown.highGround, true)
  assert.equal(fcDown.elevationDiff, 3)

  // Swap elevations: Archer at H0 (3,2) shooting uphill at enemy on H3 (1,2) (dist 2 = max uphill range 3-1)
  archer.col = 3
  archer.row = 2
  enemy.col = 1
  enemy.row = 2
  enemy.facing = 'e'
  selectHeroByUid(state, archer.uid)
  const fcUp = computeCombatForecast(state, 1, 2)!
  assert.ok(fcUp)
  assert.equal(fcUp.highGround, false)
  assert.equal(fcUp.elevationDiff, -3)
  assert.ok(fcDown.normalDmg > fcUp.normalDmg, `Towering downhill (${fcDown.normalDmg}) must deal much more damage than steep uphill (${fcUp.normalDmg})`)

  // At dist 3 uphill (0 -> 3), range 3 shrinks to 2 so enemy at (1,2) from (4,2) is OUT of range!
  archer.col = 4
  archer.row = 2
  const targetsUphill = computeTargetTiles(battle, archer, -1)
  assert.equal(targetsUphill.some(t => t.col === 1 && t.row === 2), false, 'Steep uphill (-3 levels) shrinks range 3 -> 2')
})

test('Line-of-Sight blocks direct shots through pillars & cliffs, allows indirect arcing skills, and adjacent Cover reduces forecast & actual damage', () => {
  const state = createInitialState(5004)
  // Promote Archer to 2* before battle so Skill 1 (Volley Rain, indirect area3) is unlocked
  state.campaign.heroes.find(h => h.heroId === 'archer')!.stars = 2
  const battle = startChapterBattle(state, 0)
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, 'grass', 0)
    }
  }

  const archer = battle.units.find(u => u.heroId === 'archer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== archer.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // 1. Stone pillar directly between Archer (1,2) and Enemy (4,2) blocks direct LoS!
  battle.cells[2][2] = makeCell(2, 2, 'pillar', 0)
  archer.col = 1
  archer.row = 2
  archer.range = 4
  archer.acted = false
  archer.crit = 0 // deterministic non-crit damage comparison!
  enemy.col = 4
  enemy.row = 2
  enemy.hp = 100
  enemy.maxHp = 100
  enemy.shield = 0
  enemy.facing = 'w'

  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), false, 'Pillar directly on sightline must block direct LoS')
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, true), true, 'Indirect arcing skills clear pillars')
  assert.equal(isIndirectSkill(null), false)

  selectHeroByUid(state, archer.uid)
  const directTargets = computeTargetTiles(battle, archer, -1)
  assert.equal(directTargets.some(t => t.col === 4 && t.row === 2), false, 'Basic ranged attack blocked by pillar')

  // Volley Rain (skill 1, area3) IS indirect and can arc over the pillar!
  assert.equal(armSkill(state, 1), true)
  assert.equal(battle.targetTiles.some(t => t.col === 4 && t.row === 2), true, 'Arcing Volley Rain clears pillar')
  armSkill(state, null)

  // 2. High cliff wall between two valley units also blocks direct LoS!
  battle.cells[2][2] = makeCell(2, 2, 'stone', 3)
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), false, 'Height-3 cliff wall blocks valley-to-valley direct LoS')
  battle.cells[2][2] = makeCell(2, 2, 'grass', 0)
  assert.equal(hasLineOfSight(battle, 1, 2, 4, 2, false), true, 'Clearing obstacle restores direct LoS')

  // 3. Adjacent Cover: shooter at (2,0), enemy at (4,2) — first measure Open Ground, then place Cover pillar at (3,2)!
  archer.col = 2
  archer.row = 0
  enemy.col = 4
  enemy.row = 2
  enemy.facing = 'n'
  selectHeroByUid(state, archer.uid)
  const fcOpen = computeCombatForecast(state, 4, 2)!
  assert.ok(fcOpen)
  assert.equal(fcOpen.coverBonus, 0, 'No adjacent pillar -> 0 cover bonus')

  // Place pillar at (3,2): LoS from (2,0) to (4,2) passes through (3,1) cleanly, while pillar (3,2) shields enemy's attacker-facing flank!
  battle.cells[2][3] = makeCell(3, 2, 'pillar', 0)
  assert.equal(hasLineOfSight(battle, 2, 0, 4, 2, false), true, 'Angled shot past adjacent pillar has clear LoS')
  assert.equal(computeCoverBonus(battle, 2, 0, 4, 2), 4, 'Attacker-facing adjacent pillar grants +4 DEF Cover')

  selectHeroByUid(state, archer.uid)
  const fcCover = computeCombatForecast(state, 4, 2)!
  assert.ok(fcCover)
  assert.equal(fcCover.coverBonus, 4, 'CombatForecast must expose +4 Cover DEF')
  assert.ok(fcCover.normalDmg < fcOpen.normalDmg, `Cover damage (${fcCover.normalDmg}) must be strictly less than open-ground damage (${fcOpen.normalDmg})`)

  // Execute the actual attack and verify resolved HP damage matches forecast!
  const hpBefore = enemy.hp
  assert.equal(selectTile(state, 4, 2), true)
  assert.equal(hpBefore - enemy.hp, fcCover.normalDmg, 'Resolved combat damage must match Cover-adjusted forecast')
})

test('Multi-height pickCellAt() accurately picks cells across height levels 0..4 and ignores void chasms', () => {
  const state = createInitialState(5005)
  const battle = startStageBattle(state, 'eclipse_throne')
  // Build a staircase row with heights 0, 1, 2, 3, 4 plus a void chasm cell
  const testCells: readonly [number, number, number][] = [
    [1, 4, 0], // H0
    [2, 4, 1], // H1
    [5, 4, 2], // H2
    [7, 4, 3], // H3
    [8, 4, 4]  // H4
  ]
  for (const [c, r, expectedH] of testCells) {
    assert.equal(cellHeightAt(battle, c, r), expectedH, `Eclipse Throne (${c},${r}) should be H${expectedH}`)
  }

  const scene = createCrownshardScene(fakeRenderer())
  const width = 1280
  const height = 720
  scene.render(state, 1 / 60, width, height)

  for (const [col, row, expectedH] of testCells) {
    const cell = battle.cells[row][col]
    const [wx, wy, wz] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
    const screen = scene.project(wx, wy, wz, width, height)
    assert.ok(screen, `Cell (${col},${row}) H${expectedH} must project on screen`)
    const picked = scene.pickCellAt(battle, screen.x, screen.y, width, height)
    assert.deepEqual(picked, { col, row }, `pickCellAt must accurately pick (${col},${row}) at height level ${expectedH}`)
  }

  // Casting a vertical ray straight down through a void chasm cell returns null
  assert.equal(battle.cells[0][0].terrain, 'void')
  const [vx, , vz] = gridToWorld(0, 0, 0, battle.cols, battle.rows)
  const voidPick = pickCellFromRay(battle, [vx, 8, vz], [0, -1, 0])
  assert.equal(voidPick, null, 'Void chasm cell must not be pickable')
})

test('buildStaticBoardBatches builds distinct biome perimeter architecture across all 9 biomes without throwing', () => {
  const biomes: readonly BiomeId[] = ['meadow', 'river', 'crypt', 'frost', 'volcano', 'throne', 'dunes', 'aether', 'expanse']
  const stageByBiome: Record<BiomeId, string> = {
    meadow: 'border_watch',
    river: 'sunken_bridge',
    crypt: 'lantern_crypt',
    frost: 'glacial_citadel',
    volcano: 'ashfall_foundry',
    throne: 'eclipse_throne',
    dunes: 'dune_sovereign',
    aether: 'skybreak_bastion',
    expanse: 'first_sun_sanctum'
  }

  const signatures = new Set<string>()
  for (const biome of biomes) {
    const ch = CHAPTER_BY_ID[stageByBiome[biome]]
    const state = createInitialState(7000 + ch.index)
    const battle = startStageBattle(state, ch.id)
    const built = buildStaticBoardBatches(biome, battle.cells)
    assert.ok(built.batches.length >= 6, `${biome} diorama should emit rich multi-mesh batches`)
    assert.ok(built.brazierPositions.length >= 2, `${biome} diorama should emit biome light/brazier anchors`)
    const totalInstances = built.batches.reduce((sum, b) => sum + b.count, 0)
    assert.ok(totalInstances > 60, `${biome} diorama should have substantial geometry (${totalInstances} instances)`)
    const sig = `${built.batches.length}:${built.brazierPositions.length}:${totalInstances}`
    signatures.add(sig)
  }
  assert.ok(signatures.size >= 5, `Biomes must produce distinct board architecture signatures, got ${[...signatures].join(', ')}`)

  // Verify void cells reduce board geometry cleanly compared to solid grass
  const solidCells: GridCell[][] = Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) => makeCell(c, r, 'grass', 0))
  )
  const hollowCells: GridCell[][] = Array.from({ length: 5 }, (_, r) =>
    Array.from({ length: 5 }, (_, c) => makeCell(c, r, (r === 0 || c === 0) ? 'void' : 'grass', 0))
  )
  const solidCount = buildStaticBoardBatches('meadow', solidCells).batches.reduce((s, b) => s + b.count, 0)
  const hollowCount = buildStaticBoardBatches('meadow', hollowCells).batches.reduce((s, b) => s + b.count, 0)
  assert.ok(hollowCount < solidCount, `Void cutouts (${hollowCount}) must emit fewer tile instances than solid grid (${solidCount})`)
})
