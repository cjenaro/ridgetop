import assert from 'node:assert/strict'
import test from 'node:test'
import { STEP } from '../packages/ridgetop/framework/index.ts'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import { HERO_SPECS, TACTIC_BY_ID } from '../examples/crownshard/crownshard/data.ts'
import { applyDisplacement, resolveDisplacementPreview } from '../examples/crownshard/crownshard/forced-movement.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  armSkill, armTacticCard, computeCombatForecast, createInitialState,
  selectHeroByUid, selectTile, startChapterBattle, stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import {
  BARRICADE_DEFAULT_HP, COLLISION_IMPACT_DAMAGE, FALL_DAMAGE_PER_LEVEL, LEDGE_STOP_DAMAGE,
  gridToWorld, terrainElevation, terrainWalkable
} from '../examples/crownshard/crownshard/types.ts'
import type { BattleState, BattleUnit, GridCell, TileTerrain } from '../examples/crownshard/crownshard/types.ts'
import { drawCombatForecast, drawTacticCard } from '../examples/crownshard/crownshard/ui-art.ts'

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

function flattenBoard(battle: BattleState, terrain: TileTerrain = 'grass', heightLevel = 0): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      battle.cells[r][c] = makeCell(c, r, terrain, heightLevel)
    }
  }
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number): void {
  const cell = battle.cells[row][col]
  const [x, y, z] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.col = col
  unit.row = row
  unit.x = x
  unit.y = y
  unit.z = z
  unit.path = []
  unit.moveProgress = 0
}

function fakeRenderer() {
  let maxInstances = 0
  let framesRendered = 0
  const stats = { drawCalls: 0, triangles: 0, instances: 0, culledBatches: 0, uploadBytes: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render(_m: unknown, batches: readonly { count: number }[]) {
      framesRendered++
      let n = 0
      for (const b of batches) n += b.count
      maxInstances = Math.max(maxInstances, n)
      return stats
    }
  }
  return {
    renderer: renderer as unknown as LowPolyRenderer,
    get maxInstances() { return maxInstances },
    get framesRendered() { return framesRendered }
  }
}

function mockCanvasCtx() {
  let ops = 0
  const texts: string[] = []
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
    fillText(s: string) { ops++; texts.push(s) },
    strokeText() {},
    drawImage() {},
    setLineDash() {},
    measureText(s: string) { return { width: s.length * 6.5 } },
    createLinearGradient() { return grad },
    createRadialGradient() { return grad }
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts, get ops() { return ops } }
}

test('Knockback onto open tiles updates col, row, x, y, z cleanly and emits displace VFX', () => {
  const state = createInitialState(9001)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  enemy.hp = 60
  enemy.maxHp = 60
  enemy.shield = 0

  const preview = resolveDisplacementPreview(battle, knight, enemy, { kind: 'knockback', distance: 2 })
  assert.equal(preview.moved, true)
  assert.equal(preview.toCol, 4)
  assert.equal(preview.toRow, 2)
  assert.equal(preview.collidedWith, 'none')
  assert.equal(preview.totalBonusDmg, 0)

  state.vfx.length = 0
  const res = applyDisplacement(state, knight, enemy, { kind: 'knockback', distance: 2 })
  assert.equal(res.moved, true)
  assert.equal(res.targetDmgDealt, 0)
  assert.equal(enemy.col, 4)
  assert.equal(enemy.row, 2)

  const [ex, ey, ez] = gridToWorld(4, 2, battle.cells[2][4].elevation, battle.cols, battle.rows)
  assert.equal(enemy.x, ex)
  assert.equal(enemy.y, ey)
  assert.equal(enemy.z, ez)
  assert.equal(enemy.hp, 60)

  const dispEv = state.vfx.find(ev => ev.kind === 'displace' && ev.uid === enemy.uid)
  assert.ok(dispEv, 'applyDisplacement must emit a displace VFX event')
})

test('Pillar, Map Edge, Cliff Wall, Barricade, and Unit collisions deal impact damage and secondary effects', () => {
  const state = createInitialState(9002)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const enemies = battle.units.filter(u => u.team === 'enemy')
  const enemyA = enemies[0]
  const enemyB = enemies[1]
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== enemyA.uid && u.uid !== enemyB.uid) { u.alive = false; u.hp = 0 }
  }

  // 1. Pillar collision: +10 DMG + 1 turn Stun
  battle.cells[2][4] = makeCell(4, 2, 'pillar', 0)
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemyA, 2, 2)
  placeUnit(battle, enemyB, 6, 4)
  enemyA.hp = 80
  enemyA.maxHp = 80
  enemyA.shield = 0
  enemyA.stunTurns = 0

  const resPillar = applyDisplacement(state, knight, enemyA, { kind: 'knockback', distance: 2 })
  assert.equal(resPillar.preview.collidedWith, 'pillar')
  assert.equal(enemyA.col, 3, 'Should stop on last valid tile before pillar')
  assert.equal(enemyA.row, 2)
  assert.equal(enemyA.hp, 80 - COLLISION_IMPACT_DAMAGE, 'Pillar collision must deal bonus impact damage')
  assert.equal(enemyA.stunTurns, 1, 'Hard pillar collision must Stun for 1 turn')

  // 2. Unit collision: BOTH units take collision impact damage!
  flattenBoard(battle)
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemyA, 2, 2)
  placeUnit(battle, enemyB, 4, 2)
  enemyA.hp = 70
  enemyA.shield = 0
  enemyA.stunTurns = 0
  enemyB.hp = 70
  enemyB.maxHp = 70
  enemyB.shield = 0

  const resUnit = applyDisplacement(state, knight, enemyA, { kind: 'knockback', distance: 2 })
  assert.equal(resUnit.preview.collidedWith, 'unit')
  assert.equal(resUnit.preview.collidedUnitUid, enemyB.uid)
  assert.equal(enemyA.col, 3, 'Pushed unit stops adjacent to blocking unit')
  assert.equal(enemyB.col, 4, 'Blocking unit stays put')
  assert.equal(enemyA.hp, 70 - COLLISION_IMPACT_DAMAGE, 'Pushed unit takes collision damage')
  assert.equal(enemyB.hp, 70 - COLLISION_IMPACT_DAMAGE, 'Blocking unit ALSO takes collision damage')
  assert.equal(resUnit.secondaryDmgDealt, COLLISION_IMPACT_DAMAGE)

  // 3. Intact Barricade collision: damages unit (+Stun) AND damages/shatters barricade!
  flattenBoard(battle)
  battle.cells[2][3] = makeCell(3, 2, 'barricade', 0)
  battle.cells[2][3].barricadeHp = COLLISION_IMPACT_DAMAGE // Will shatter on 10 impact DMG!
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemyA, 2, 2)
  enemyA.hp = 60
  enemyA.stunTurns = 0

  const resBar = applyDisplacement(state, knight, enemyA, { kind: 'knockback', distance: 1 })
  assert.equal(resBar.preview.collidedWith, 'barricade')
  assert.equal(enemyA.col, 2)
  assert.equal(enemyA.hp, 60 - COLLISION_IMPACT_DAMAGE)
  assert.equal(enemyA.stunTurns, 1)
  assert.equal(resBar.barricadeDmgDealt, COLLISION_IMPACT_DAMAGE)
  assert.equal(resBar.barricadeShattered, true, 'Barricade at 10 HP must shatter on collision')
  assert.equal(battle.cells[2][3].terrain, 'stone', 'Shattered barricade becomes walkable stone')
  assert.equal(battle.cells[2][3].walkable, true)

  // 4. Cliff wall collision (height rise > jump)
  flattenBoard(battle, 'grass', 0)
  battle.cells[2][3] = makeCell(3, 2, 'hill', 3) // rise of 3 > enemy jump
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemyA, 2, 2)
  enemyA.jump = 1
  enemyA.hp = 50
  enemyA.stunTurns = 0

  const resCliff = applyDisplacement(state, knight, enemyA, { kind: 'knockback', distance: 1 })
  assert.equal(resCliff.preview.collidedWith, 'cliff')
  assert.equal(enemyA.col, 2)
  assert.equal(enemyA.hp, 50 - COLLISION_IMPACT_DAMAGE)
  assert.equal(enemyA.stunTurns, 1)

  // 5. Map edge collision
  flattenBoard(battle)
  placeUnit(battle, knight, battle.cols - 2, 2)
  placeUnit(battle, enemyA, battle.cols - 1, 2)
  enemyA.hp = 50
  enemyA.stunTurns = 0

  const resEdge = applyDisplacement(state, knight, enemyA, { kind: 'knockback', distance: 1 })
  assert.equal(resEdge.preview.collidedWith, 'edge')
  assert.equal(enemyA.col, battle.cols - 1)
  assert.equal(enemyA.hp, 50 - COLLISION_IMPACT_DAMAGE)
  assert.equal(enemyA.stunTurns, 1)
})

test('Ledge drop (>= 2 height levels) deals height-scaled fall damage; void/water ledges stop safely with heavy stagger', () => {
  const state = createInitialState(9003)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle, 'grass', 0)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // 1. High terrace drop (height 3 -> height 0 = drop 3 -> 21 FALL DMG!)
  battle.cells[2][1] = makeCell(1, 2, 'hill', 3)
  battle.cells[2][2] = makeCell(2, 2, 'hill', 3)
  battle.cells[2][3] = makeCell(3, 2, 'grass', 0)
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  enemy.hp = 80
  enemy.maxHp = 80
  enemy.shield = 0
  battle.floatingNumbers.length = 0

  const resFall = applyDisplacement(state, knight, enemy, { kind: 'knockback', distance: 1 })
  assert.equal(enemy.col, 3)
  assert.equal(enemy.row, 2)
  assert.equal(resFall.preview.fallDrop, 3)
  assert.equal(resFall.preview.fallDmg, 3 * FALL_DAMAGE_PER_LEVEL)
  assert.equal(enemy.hp, 80 - 3 * FALL_DAMAGE_PER_LEVEL)
  assert.ok(
    battle.floatingNumbers.some(fn => fn.text === `FALL -${3 * FALL_DAMAGE_PER_LEVEL}`),
    'Ledge fall must emit FALL -N callout'
  )

  // 2. Void chasm ledge stop: never strands unit on unwalkable void tile!
  flattenBoard(battle, 'grass', 0)
  battle.cells[2][3] = makeCell(3, 2, 'void', 0)
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  enemy.hp = 60
  enemy.slowTurns = 0
  enemy.stunTurns = 0

  const resVoid = applyDisplacement(state, knight, enemy, { kind: 'knockback', distance: 2 })
  assert.equal(resVoid.preview.collidedWith, 'void')
  assert.equal(enemy.col, 2, 'Must stop at safe ledge before void chasm')
  assert.equal(enemy.row, 2)
  assert.equal(battle.cells[enemy.row][enemy.col].walkable, true, 'Unit must NEVER be stranded on void')
  assert.equal(enemy.hp, 60 - LEDGE_STOP_DAMAGE, 'Void ledge stop must deal heavy stagger damage')
  assert.ok(enemy.slowTurns > 0 || enemy.stunTurns > 0, 'Void ledge stop must inflict stagger status')

  // 3. Water ledge stop
  battle.cells[2][3] = makeCell(3, 2, 'water', 0)
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  enemy.hp = 60
  enemy.slowTurns = 0
  enemy.stunTurns = 0

  const resWater = applyDisplacement(state, knight, enemy, { kind: 'knockback', distance: 2 })
  assert.equal(resWater.preview.collidedWith, 'water')
  assert.equal(enemy.col, 2, 'Must stop safely at water ledge')
  assert.equal(enemy.hp, 60 - LEDGE_STOP_DAMAGE)
  assert.ok(enemy.slowTurns >= 2, 'Water ledge stop must apply Slow')
})

test('Hazard combos: pushing onto erupting Lava Geyser deals fire DMG + Burn; pushing onto Ice slides 1 extra tile', () => {
  const state = createInitialState(9004)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // 1. Knock onto active Lava Geyser
  battle.cells[2][3] = makeCell(3, 2, 'lava_geyser', 0)
  battle.cells[2][3].geyserActive = true
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  enemy.hp = 70
  enemy.maxHp = 70
  enemy.shield = 0
  enemy.burnTurns = 0
  battle.floatingNumbers.length = 0

  const prevGeyser = resolveDisplacementPreview(battle, knight, enemy, { kind: 'knockback', distance: 1 })
  assert.equal(prevGeyser.hazardKind, 'lava_geyser')
  assert.ok(prevGeyser.hazardDmg > 0)
  assert.equal(prevGeyser.causesBurn, true)

  const resGeyser = applyDisplacement(state, knight, enemy, { kind: 'knockback', distance: 1 })
  assert.equal(enemy.col, 3)
  assert.equal(enemy.hp, 70 - prevGeyser.hazardDmg, 'Geyser combo damage must match preview')
  assert.ok(enemy.burnTurns >= 2, 'Geyser combo must inflict Burn')
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'GEYSER!'))
  assert.equal(resGeyser.targetDmgDealt, prevGeyser.hazardDmg)

  // 2. Knock onto Ice slides 1 extra tile along push vector (distance 1 -> lands 2 tiles away!)
  flattenBoard(battle)
  battle.cells[2][3] = makeCell(3, 2, 'ice', 0)
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  battle.floatingNumbers.length = 0

  const prevIce = resolveDisplacementPreview(battle, knight, enemy, { kind: 'knockback', distance: 1 })
  assert.equal(prevIce.iceSlid, true)
  assert.equal(prevIce.toCol, 4, 'Ice must add +1 extra slide tile (2 -> 3 -> 4)')
  assert.equal(prevIce.toRow, 2)

  applyDisplacement(state, knight, enemy, { kind: 'knockback', distance: 1 })
  assert.equal(enemy.col, 4)
  assert.equal(enemy.row, 2)
  assert.ok(battle.floatingNumbers.some(fn => fn.text === 'ICE SLIDE!'))
})

test('Pull moves target toward caster stopping adjacent without self-collision; Swap exchanges positions cleanly', () => {
  const state = createInitialState(9005)
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const hero = battle.units.find(u => u.team === 'ally')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== hero.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // Pull from (5, 2) toward hero at (1, 2) by 2 -> lands at (3, 2)
  placeUnit(battle, hero, 1, 2)
  placeUnit(battle, enemy, 5, 2)
  enemy.hp = 60
  const resPull1 = applyDisplacement(state, hero, enemy, { kind: 'pull', distance: 2 })
  assert.equal(resPull1.moved, true)
  assert.equal(enemy.col, 3)
  assert.equal(enemy.row, 2)
  assert.equal(enemy.hp, 60, 'Open pull deals no collision damage')

  // Pull again by 3 -> stops cleanly adjacent to caster at (2, 2) with NO collision damage!
  const resPull2 = applyDisplacement(state, hero, enemy, { kind: 'pull', distance: 3 })
  assert.equal(enemy.col, 2, 'Pull must stop adjacent to caster')
  assert.equal(resPull2.preview.collidedWith, 'none')
  assert.equal(enemy.hp, 60, 'Stopping adjacent to caster must NOT cause collision damage')

  // Swap exchanges hero (1, 2) and enemy (4, 2)
  placeUnit(battle, hero, 1, 2)
  placeUnit(battle, enemy, 4, 2)
  const resSwap = applyDisplacement(state, hero, enemy, { kind: 'swap', distance: 1 })
  assert.equal(resSwap.moved, true)
  assert.equal(hero.col, 4)
  assert.equal(hero.row, 2)
  assert.equal(enemy.col, 1)
  assert.equal(enemy.row, 2)
  const [hx, , hz] = gridToWorld(4, 2, battle.cells[2][4].elevation, battle.cols, battle.rows)
  const [ex, , ez] = gridToWorld(1, 2, battle.cells[2][1].elevation, battle.cols, battle.rows)
  assert.equal(hero.x, hx)
  assert.equal(hero.z, hz)
  assert.equal(enemy.x, ex)
  assert.equal(enemy.z, ez)
})

test('Real hero skills (Shield Bash, Piercing Shot, Shadow Strike, Frost Lance) and Gale Gust tactic card match CombatForecast and execute displacement', () => {
  const state = createInitialState(9006)
  // Add Rogue, Cryomancer, and Gale Gust tactic card to campaign before battle
  state.campaign.heroes.push(
    { uid: 'h_rogue', heroId: 'rogue', stars: 1, weaponUid: null, armorUid: null, relicUid: null },
    { uid: 'h_cryo', heroId: 'cryomancer', stars: 1, weaponUid: null, armorUid: null, relicUid: null }
  )
  state.campaign.clearedStageIds.push('sunken_bridge')
  state.campaign.squadUids = [state.campaign.heroes[0].uid, state.campaign.heroes[1].uid, 'h_rogue', 'h_cryo']
  state.campaign.tactics.push({ uid: 'tac_gale_gust', tacticId: 'gale_gust' })
  assert.ok(TACTIC_BY_ID.gale_gust, 'gale_gust must be registered in TACTIC_BY_ID')
  assert.deepEqual(HERO_SPECS.knight.skills[0].displacement, { kind: 'knockback', distance: 1 })
  assert.deepEqual(HERO_SPECS.archer.skills[0].displacement, { kind: 'knockback', distance: 1 })
  assert.deepEqual(HERO_SPECS.rogue.skills[0].displacement, { kind: 'swap', distance: 1 })
  assert.deepEqual(HERO_SPECS.cryomancer.skills[0].displacement, { kind: 'pull', distance: 2 })

  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const archer = battle.units.find(u => u.heroId === 'archer')!
  const rogue = battle.units.find(u => u.heroId === 'rogue')!
  const cryo = battle.units.find(u => u.heroId === 'cryomancer')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  // Ensure deterministic non-crit hits for exact forecast vs execution verification
  knight.crit = 0
  archer.crit = 0
  rogue.crit = 0
  cryo.crit = 0
  enemy.hp = 200
  enemy.maxHp = 200
  enemy.shield = 0

  // 1. Knight Shield Bash pushes enemy into a Pillar -> forecast predicts collision + stun + exact HP!
  battle.cells[2][4] = makeCell(4, 2, 'pillar', 0)
  placeUnit(battle, knight, 2, 2)
  placeUnit(battle, enemy, 3, 2)
  placeUnit(battle, archer, 0, 0)
  placeUnit(battle, rogue, 0, 1)
  placeUnit(battle, cryo, 0, 4)

  battle.phase = 'player'
  battle.activeUnitUid = knight.uid
  knight.acted = false
  knight.cooldowns = [0, 0, 0]
  selectHeroByUid(state, knight.uid)
  assert.equal(armSkill(state, 0), true)

  const fcBash = computeCombatForecast(state, 3, 2)!
  assert.ok(fcBash?.displacementPreview, 'Shield Bash forecast must include displacementPreview')
  assert.equal(fcBash.displacementPreview!.collidedWith, 'pillar')
  assert.equal(fcBash.displacementPreview!.collisionDmg, COLLISION_IMPACT_DAMAGE)
  assert.equal(fcBash.displacementPreview!.causesStun, true)

  assert.equal(selectTile(state, 3, 2), true)
  assert.equal(enemy.hp, fcBash.targetHpAfterNormal, 'Executed HP after Shield Bash + Pillar collision must match forecast exactly')
  assert.equal(enemy.stunTurns, 1, 'Shield Bash into Pillar must Stun')

  // 2. Archer Piercing Shot knocks enemy back 1 tile onto open ground
  flattenBoard(battle)
  placeUnit(battle, archer, 1, 2)
  placeUnit(battle, enemy, 3, 2)
  enemy.hp = 150
  battle.activeUnitUid = archer.uid
  archer.acted = false
  archer.cooldowns = [0, 0, 0]
  selectHeroByUid(state, archer.uid)
  assert.equal(armSkill(state, 0), true)
  const fcPierce = computeCombatForecast(state, 3, 2)!
  assert.equal(fcPierce.displacementPreview?.toCol, 4)
  assert.equal(selectTile(state, 3, 2), true)
  assert.equal(enemy.col, 4, 'Piercing Shot must knock enemy from col 3 to col 4')

  // 3. Rogue Shadow Strike swaps Rogue and Enemy positions
  placeUnit(battle, rogue, 2, 2)
  placeUnit(battle, enemy, 4, 2)
  battle.activeUnitUid = rogue.uid
  rogue.acted = false
  rogue.cooldowns = [0, 0, 0]
  selectHeroByUid(state, rogue.uid)
  assert.equal(armSkill(state, 0), true)
  const fcSwap = computeCombatForecast(state, 4, 2)!
  assert.equal(fcSwap.displacementPreview?.kind, 'swap')
  assert.equal(fcSwap.displacementPreview?.toCol, 2)
  assert.equal(fcSwap.displacementPreview?.actorToCol, 4)
  assert.equal(selectTile(state, 4, 2), true)
  assert.equal(rogue.col, 4, 'Rogue must swap onto enemy tile')
  assert.equal(enemy.col, 2, 'Enemy must swap onto Rogue tile')

  // 4. Cryomancer Frost Lance pulls enemy 2 tiles closer
  placeUnit(battle, cryo, 1, 3)
  placeUnit(battle, enemy, 5, 3)
  battle.activeUnitUid = cryo.uid
  cryo.acted = false
  cryo.cooldowns = [0, 0, 0]
  selectHeroByUid(state, cryo.uid)
  assert.equal(armSkill(state, 0), true)
  const fcPull = computeCombatForecast(state, 5, 3)!
  assert.equal(fcPull.displacementPreview?.kind, 'pull')
  assert.equal(fcPull.displacementPreview?.toCol, 3)
  assert.equal(selectTile(state, 5, 3), true)
  assert.equal(enemy.col, 3, 'Frost Lance must pull enemy 2 tiles closer')

  // 5. Gale Gust Tactic Card blasts enemy 2 tiles back into a high terrace drop!
  flattenBoard(battle, 'grass', 0)
  battle.cells[2][1] = makeCell(1, 2, 'hill', 2)
  battle.cells[2][2] = makeCell(2, 2, 'hill', 2)
  battle.cells[2][3] = makeCell(3, 2, 'hill', 2)
  battle.cells[2][4] = makeCell(4, 2, 'grass', 0) // Drop 2 -> 14 FALL DMG!
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  placeUnit(battle, rogue, 0, 1)
  placeUnit(battle, archer, 0, 0)
  placeUnit(battle, cryo, 0, 4)
  enemy.hp = 120
  battle.activeUnitUid = knight.uid
  battle.ap = 3
  battle.hand = ['tac_gale_gust']
  assert.equal(armTacticCard(state, 'tac_gale_gust'), true)

  const fcGale = computeCombatForecast(state, 2, 2)!
  assert.equal(fcGale.mode, 'tactic')
  assert.equal(fcGale.displacementPreview?.kind, 'knockback')
  assert.equal(fcGale.displacementPreview?.toCol, 4)
  assert.equal(fcGale.displacementPreview?.fallDmg, 2 * FALL_DAMAGE_PER_LEVEL)

  assert.equal(selectTile(state, 2, 2), true)
  assert.equal(enemy.col, 4, 'Gale Gust must blast enemy 2 tiles back to col 4')
  assert.equal(enemy.hp, fcGale.targetHpAfterNormal, 'Gale Gust damage + Fall damage must match forecast exactly')
})

test('CrownshardScene renders displacement preview arcs & slide animations and ui-art draws forecast badges + Gale Gust card cleanly', () => {
  const state = createInitialState(9007)
  state.campaign.tactics.push({ uid: 'tac_gale_ui', tacticId: 'gale_gust' })
  const battle = startChapterBattle(state, 0)
  flattenBoard(battle)

  const knight = battle.units.find(u => u.heroId === 'knight')!
  const enemy = battle.units.find(u => u.team === 'enemy')!
  for (const u of battle.units) {
    if (u.uid !== knight.uid && u.uid !== enemy.uid) { u.alive = false; u.hp = 0 }
  }

  battle.cells[2][4] = makeCell(4, 2, 'pillar', 0)
  placeUnit(battle, knight, 1, 2)
  placeUnit(battle, enemy, 2, 2)
  battle.activeUnitUid = knight.uid
  battle.ap = 3
  battle.hand = ['tac_gale_ui']

  const fake = fakeRenderer()
  const scene = createCrownshardScene(fake.renderer)

  // Preview Gale Gust pushing enemy into pillar at (4, 2)
  assert.equal(armTacticCard(state, 'tac_gale_ui'), true)
  const fc = computeCombatForecast(state, 2, 2)!
  assert.ok(fc?.displacementPreview)
  scene.setForecast(fc)
  for (let i = 0; i < 12; i++) {
    stepGame(state, STEP)
    scene.render(state, STEP, 1280, 720)
  }

  // Render CombatForecast UI card + Gale Gust tactic card art
  const ui = mockCanvasCtx()
  drawCombatForecast(ui.ctx, { x: 0, y: 0, width: 340, height: 112 }, fc)
  drawTacticCard(
    ui.ctx,
    { x: 0, y: 0, width: 110, height: 150 },
    TACTIC_BY_ID.gale_gust,
    { hovered: true, pressed: false, focused: false, disabled: false, selected: false }
  )
  assert.ok(ui.ops > 20, 'Forecast & Gale Gust tactic card should draw cleanly')
  assert.ok(
    ui.texts.some(t => t.includes('PUSH 2') && t.includes('COLLIDE')),
    `Expected displacement badge in forecast text, got: ${ui.texts.join(', ')}`
  )

  // Execute Gale Gust -> triggers slide & impact animation in scene while preserving sim coords!
  assert.equal(selectTile(state, 2, 2), true)
  const simX = enemy.x
  const simY = enemy.y
  const simZ = enemy.z
  scene.setForecast(null)
  for (let i = 0; i < 30; i++) {
    stepGame(state, STEP)
    scene.render(state, STEP, 1280, 720)
  }
  assert.equal(enemy.x, simX, 'Scene slide animation must NEVER mutate deterministic unit.x')
  assert.equal(enemy.y, simY, 'Scene slide animation must NEVER mutate deterministic unit.y')
  assert.equal(enemy.z, simZ, 'Scene slide animation must NEVER mutate deterministic unit.z')
  assert.ok(fake.framesRendered >= 42)
  assert.ok(fake.maxInstances > 40)
  scene.dispose()
})
