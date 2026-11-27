import assert from 'node:assert/strict'
import test from 'node:test'
import type { LowPolyRenderer, RenderStats } from '../packages/ridgetop/framework/index.ts'
import {
  CHAPTER_BY_ID,
  ENEMY_SPECS,
  PLAYABLE_CHAPTERS
} from '../examples/crownshard/crownshard/data.ts'
import { ENEMY_CHARACTER_SPECS, ENEMY_RIGS } from '../examples/crownshard/crownshard/characters.ts'
import { bakePortraitPixels } from '../examples/crownshard/crownshard/art.ts'
import { createCrownshardScene } from '../examples/crownshard/crownshard/scene.ts'
import {
  BIOME_ENEMY_ARCHETYPES,
  ICE_WRAITH_CHILLED_BONUS_MUL,
  NECROMANCER_SUMMON_CAP,
  NECROMANCER_SUMMON_COOLDOWN,
  REGIONAL_MINIBOSS_ARCHETYPES,
  RIVER_TROLL_REGEN_AMOUNT,
  canEvadeZoneOfControl,
  canSummonerRaiseMinion,
  chooseEnemySpecialMove,
  computeEnemyArchetypeDamageMul,
  countActiveSummonsFor,
  createInitialState,
  createSummonedEnemyUnit,
  endPlayerTurn,
  evaluateTurnStartRegeneration,
  findBestSummonTile,
  getEnemyAttackElement,
  getEnemyBasicAttackStatus,
  getEnemyBiomeAffinity,
  getEnemyProjectileStyle,
  hasZoneOfControl,
  isRegeneratingArchetype,
  isRegionalMiniBoss,
  isSummonerArchetype,
  previewPathOpportunityAttacks,
  restoreBattleState,
  serializeBattleState,
  startStageBattle,
  stepGame
} from '../examples/crownshard/crownshard/simulation.ts'
import {
  cellHeightLevel,
  gridToWorld,
  terrainElevation,
  terrainWalkable
} from '../examples/crownshard/crownshard/types.ts'
import type {
  BattleState,
  BattleUnit,
  EnemyArchetypeId,
  GameState,
  TileTerrain
} from '../examples/crownshard/crownshard/types.ts'

function setCell(battle: BattleState, col: number, row: number, terrain: TileTerrain, heightLevel = 0): void {
  battle.cells[row][col] = {
    col,
    row,
    terrain,
    elevation: terrainElevation(terrain, heightLevel),
    walkable: terrainWalkable(terrain),
    heightLevel
  }
}

function clearFlatBoard(battle: BattleState, terrain: TileTerrain = 'stone'): void {
  for (let r = 0; r < battle.rows; r++) {
    for (let c = 0; c < battle.cols; c++) {
      setCell(battle, c, r, terrain, 0)
    }
  }
}

function placeUnit(battle: BattleState, unit: BattleUnit, col: number, row: number): void {
  unit.col = col
  unit.row = row
  const cell = battle.cells[row][col]
  const [x, y, z] = gridToWorld(col, row, cell.elevation, battle.cols, battle.rows)
  unit.x = x
  unit.y = y
  unit.z = z
  unit.path = []
  unit.moveProgress = 0
}

function stepEnemyTurnToCompletion(state: GameState, enemy: BattleUnit): void {
  const battle = state.battle!
  battle.phase = 'enemy'
  battle.activeUnitUid = enemy.uid
  battle.selectedUnitUid = enemy.uid
  battle.enemyDelay = 0
  battle.enemyActedThisTurn = false
  enemy.acted = false
  enemy.moved = false
  // Step enough frames for movement + attack + end of enemy turn
  for (let i = 0; i < 80; i++) {
    stepGame(state, 0.05)
    const phase: string = battle.phase
    if (battle.activeUnitUid !== enemy.uid || phase === 'victory' || phase === 'defeat') break
  }
}

function fakeRenderer() {
  let drawn = 0
  const stats: RenderStats = { drawCalls: 0, triangles: 0, instances: 0, culled: 0 } as unknown as RenderStats
  const renderer = {
    setLighting() {},
    release() {},
    render() {
      drawn++
      return stats
    }
  }
  return { renderer: renderer as unknown as LowPolyRenderer, get drawn() { return drawn } }
}

// ============================================================================
// 1. Definitions, Rigs, Portraits & Biome Metadata
// ============================================================================

test('all biome enemy archetypes and regional mini-bosses have valid ENEMY_SPECS, ENEMY_RIGS, and bust portraits', () => {
  const allNew: readonly EnemyArchetypeId[] = [
    ...BIOME_ENEMY_ARCHETYPES,
    ...REGIONAL_MINIBOSS_ARCHETYPES
  ]
  assert.equal(BIOME_ENEMY_ARCHETYPES.length, 5)
  assert.equal(REGIONAL_MINIBOSS_ARCHETYPES.length, 5)

  const portraits = bakePortraitPixels(48)

  for (const id of Object.keys(ENEMY_SPECS) as EnemyArchetypeId[]) {
    const spec = ENEMY_SPECS[id]
    assert.ok(spec, `missing ENEMY_SPECS[${id}]`)
    assert.equal(spec.id, id)
    assert.ok(spec.maxHp >= 20 && spec.atk >= 8 && spec.speed >= 4 && spec.move >= 2)

    const charSpec = ENEMY_CHARACTER_SPECS[id]
    assert.ok(charSpec, `missing ENEMY_CHARACTER_SPECS[${id}]`)

    const rig = ENEMY_RIGS[id]
    assert.ok(rig, `missing ENEMY_RIGS[${id}]`)
    assert.ok(rig.joints.length > 0, `ENEMY_RIGS[${id}] must have joints`)
    const parts = rig.joints.flatMap(j => j.parts ?? [])
    assert.ok(parts.length >= 6, `ENEMY_RIGS[${id}] must have detailed parts`)
    for (const part of parts) {
      assert.ok(part.mesh.vertexCount > 0, `${id} part ${part.name ?? 'unnamed'} must have vertices`)
      assert.equal(part.mesh.data.length, part.mesh.vertexCount * 6, `${id} part ${part.name ?? 'unnamed'} interleaved vertex buffer`)
      assert.ok(part.mesh.radius > 0, `${id} part ${part.name ?? 'unnamed'} must have positive radius`)
    }

    const portrait = portraits[id]
    assert.ok(portrait, `missing baked portrait for ${id}`)
    assert.equal(portrait.size, 48)
    let opaquePixels = 0
    for (let i = 3; i < portrait.pixels.length; i += 4) {
      if (portrait.pixels[i] > 0) opaquePixels++
    }
    assert.ok(opaquePixels > 120, `portrait for ${id} should contain a visible bust (${opaquePixels} px)`)
  }

  // Verify specific new biome archetype traits
  assert.equal(ENEMY_SPECS.ember_pyromancer.range, 3)
  assert.equal(ENEMY_SPECS.ember_pyromancer.zoc, false)
  assert.equal(getEnemyBiomeAffinity('ember_pyromancer'), 'volcano')
  assert.equal(getEnemyProjectileStyle('ember_pyromancer'), 'fire')
  assert.equal(getEnemyAttackElement('ember_pyromancer'), 'fire')

  assert.equal(ENEMY_SPECS.ice_wraith.move, 5)
  assert.equal(ENEMY_SPECS.ice_wraith.jump, 2)
  assert.equal(ENEMY_SPECS.ice_wraith.range, 2)
  assert.equal(ENEMY_SPECS.ice_wraith.zoc, false)
  assert.equal(ENEMY_SPECS.ice_wraith.evadeZoc, true)
  assert.equal(getEnemyBiomeAffinity('ice_wraith'), 'frost')
  assert.equal(getEnemyProjectileStyle('ice_wraith'), 'frost')

  assert.equal(ENEMY_SPECS.bone_necromancer.range, 3)
  assert.equal(ENEMY_SPECS.bone_necromancer.zoc, false)
  assert.equal(isSummonerArchetype('bone_necromancer'), true)
  assert.equal(getEnemyBiomeAffinity('bone_necromancer'), 'crypt')

  assert.equal(ENEMY_SPECS.bone_thrall.zoc, true)
  assert.equal(ENEMY_SPECS.bone_thrall.range, 1)

  assert.equal(ENEMY_SPECS.river_troll.zoc, true)
  assert.equal(ENEMY_SPECS.river_troll.move, 4)
  assert.ok(ENEMY_SPECS.river_troll.maxHp >= 90)
  assert.equal(isRegeneratingArchetype('river_troll'), true)
  assert.equal(getEnemyBiomeAffinity('river_troll'), 'river')

  for (const bossId of REGIONAL_MINIBOSS_ARCHETYPES) {
    assert.equal(ENEMY_SPECS[bossId].isBoss, true, `${bossId} must have isBoss: true`)
    assert.equal(isRegionalMiniBoss(bossId), true, `${bossId} must satisfy isRegionalMiniBoss`)
  }
  for (const id of allNew) {
    assert.ok(ENEMY_SPECS[id].name.length > 0)
  }
})

// ============================================================================
// 2. Bone Necromancer Summoning, Cap, Cooldown & Save/Resume Persistence
// ============================================================================

test('Bone Necromancer raises Bone Thralls onto walkable adjacent tiles, enforces cap & cooldown, and persists in BattleSaveSnapshot', () => {
  const state = createInitialState(404)
  const battle = startStageBattle(state, 'lantern_crypt')
  clearFlatBoard(battle)

  const necromancer = battle.units.find(u => u.enemyId === 'bone_necromancer')!
  assert.ok(necromancer, 'Lantern Crypt should spawn a Bone Necromancer')

  // Isolate the necromancer and one healthy ally
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== necromancer.uid) {
      u.alive = false
      u.hp = 0
    }
  }
  const ally = battle.units.find(u => u.team === 'ally' && u.alive)!
  for (const u of battle.units) {
    if (u.team === 'ally' && u.uid !== ally.uid) {
      u.alive = false
      u.hp = 0
    }
  }
  ally.hp = 200
  ally.maxHp = 200
  placeUnit(battle, ally, 1, 2)
  placeUnit(battle, necromancer, 5, 2)
  // Block 3 orthogonal sides with water/pillar so only (4, 2) is valid & walkable
  setCell(battle, 5, 1, 'water')
  setCell(battle, 5, 3, 'pillar')
  setCell(battle, 6, 2, 'lava')
  setCell(battle, 4, 2, 'stone')

  assert.equal(countActiveSummonsFor(battle, necromancer.uid), 0)
  assert.equal(canSummonerRaiseMinion(battle, necromancer), true)
  const bestTile = findBestSummonTile(battle, necromancer, ally)
  assert.deepEqual(bestTile, { col: 4, row: 2 })

  // Turn 1: Necromancer raises first Bone Thrall at (4, 2)
  necromancer.cooldowns = [0, 0, 0]
  stepEnemyTurnToCompletion(state, necromancer)

  assert.equal(countActiveSummonsFor(battle, necromancer.uid), 1, 'Should have raised 1 Bone Thrall')
  assert.equal(necromancer.cooldowns[0], NECROMANCER_SUMMON_COOLDOWN, 'Summon should trigger 3-turn cooldown')
  const thrall1 = battle.units.find(u => u.enemyId === 'bone_thrall' && u.summonerUid === necromancer.uid)!
  assert.ok(thrall1, 'Summoned Bone Thrall must exist in battle.units')
  assert.equal(thrall1.col, 4)
  assert.equal(thrall1.row, 2)
  assert.equal(thrall1.alive, true)
  assert.equal(canSummonerRaiseMinion(battle, necromancer), false, 'Cooldown must block immediate re-summon')

  // Verify summoned unit appears in turn order preview
  assert.ok(
    battle.turnOrder.some(e => e.uid === thrall1.uid),
    'Summoned Bone Thrall must appear in battle.turnOrder'
  )

  // Save & restore battle mid-combat with summoned Bone Thrall active!
  battle.phase = 'player'
  battle.activeUnitUid = ally.uid
  battle.selectedUnitUid = ally.uid
  const snap = serializeBattleState(battle, state.campaign.seed)
  assert.ok(snap, 'Battle with summoned Bone Thrall must serialize cleanly')
  const savedThrall = snap.units.find(u => u.uid === thrall1.uid)
  assert.ok(savedThrall, 'Snapshot must contain summoned Bone Thrall')
  assert.equal(savedThrall.enemyId, 'bone_thrall')
  assert.equal(savedThrall.summonerUid, necromancer.uid)

  const resumedState = createInitialState(999)
  assert.equal(restoreBattleState(resumedState, snap), true, 'Restoring battle with summoned unit must succeed')
  const rb = resumedState.battle!
  const restoredNecro = rb.units.find(u => u.uid === necromancer.uid)!
  const restoredThrall1 = rb.units.find(u => u.uid === thrall1.uid)!
  assert.ok(restoredThrall1, 'Restored battle must include summoned Bone Thrall')
  assert.equal(restoredThrall1.summonerUid, restoredNecro.uid)
  assert.equal(countActiveSummonsFor(rb, restoredNecro.uid), 1)

  // Open an adjacent tile, reset cooldown, raise second thrall -> reaches cap (2)
  setCell(rb, 6, 2, 'stone')
  restoredNecro.cooldowns = [0, 0, 0]
  stepEnemyTurnToCompletion(resumedState, restoredNecro)
  assert.equal(countActiveSummonsFor(rb, restoredNecro.uid), NECROMANCER_SUMMON_CAP)

  const thralls = rb.units.filter(u => u.enemyId === 'bone_thrall' && u.summonerUid === restoredNecro.uid)
  assert.equal(thralls.length, 2)
  assert.notEqual(thralls[0].uid, thralls[1].uid, 'Summoned units must have unique UIDs')

  // Even with cooldown = 0 and open tiles, cap (2) prevents a 3rd active summon; necromancer attacks instead!
  setCell(rb, 5, 1, 'stone')
  restoredNecro.cooldowns = [0, 0, 0]
  assert.equal(canSummonerRaiseMinion(rb, restoredNecro), false, 'Cap of 2 active summons must prevent 3rd raise')
  const restoredAlly = rb.units.find(u => u.uid === ally.uid)!
  placeUnit(rb, restoredAlly, 3, 2) // in range 3 of necromancer at (5, 2)
  const allyHpBefore = restoredAlly.hp
  stepEnemyTurnToCompletion(resumedState, restoredNecro)
  assert.equal(countActiveSummonsFor(rb, restoredNecro.uid), 2, 'Active summon count must remain capped at 2')
  assert.ok(restoredAlly.hp < allyHpBefore, 'Necromancer at summon cap should attack with dark bolt')

  // Verify summoned thrall counts toward Rout objective (killing necromancer alone does NOT win while thrall lives)
  const routState = createInitialState(405)
  const routBattle = startStageBattle(routState, 'briar_hollow')
  clearFlatBoard(routBattle)
  for (const u of routBattle.units) {
    if (u.team === 'enemy') { u.alive = false; u.hp = 0 }
  }
  const fakeSummoner = routBattle.units.find(u => u.team === 'enemy')!
  const raised = createSummonedEnemyUnit(routBattle, fakeSummoner, 'bone_thrall', 4, 2)
  routBattle.units.push(raised)
  assert.equal(routBattle.phase === 'victory', false)
  endPlayerTurn(routState)
  assert.notEqual(routBattle.phase, 'victory', 'Rout victory must wait until summoned Bone Thrall is defeated')
})

// ============================================================================
// 3. River Troll Start-of-Turn Regeneration & Suppression + Tidal Slam
// ============================================================================

test('River Troll regenerates +8 HP at turn start, is suppressed by Burn or Poison, and slams with knockback', () => {
  const state = createInitialState(505)
  const battle = startStageBattle(state, 'sunken_bridge')
  clearFlatBoard(battle)

  const troll = battle.units.find(u => u.enemyId === 'river_troll')!
  assert.ok(troll, 'Sunken Bridge should spawn a River Troll')

  // Pure helper checks
  assert.deepEqual(
    evaluateTurnStartRegeneration({
      alive: true, enemyId: 'river_troll', hp: 50, maxHp: 94, burnTurns: 0, poisonStacks: 0
    }),
    { amount: RIVER_TROLL_REGEN_AMOUNT, suppressedBy: 'none' }
  )
  assert.deepEqual(
    evaluateTurnStartRegeneration({
      alive: true, enemyId: 'river_troll', hp: 90, maxHp: 94, burnTurns: 0, poisonStacks: 0
    }),
    { amount: 4, suppressedBy: 'none' }
  )
  assert.deepEqual(
    evaluateTurnStartRegeneration({
      alive: true, enemyId: 'river_troll', hp: 50, maxHp: 94, burnTurns: 2, poisonStacks: 0
    }),
    { amount: 0, suppressedBy: 'burn' }
  )
  assert.deepEqual(
    evaluateTurnStartRegeneration({
      alive: true, enemyId: 'river_troll', hp: 50, maxHp: 94, burnTurns: 0, poisonStacks: 2
    }),
    { amount: 0, suppressedBy: 'poison' }
  )

  // Live simulation: isolate troll + one ally far away so troll takes next turn cleanly
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== troll.uid) { u.alive = false; u.hp = 0 }
  }
  const ally = battle.units.find(u => u.team === 'ally' && u.alive)!
  for (const u of battle.units) {
    if (u.team === 'ally' && u.uid !== ally.uid) { u.alive = false; u.hp = 0 }
  }
  placeUnit(battle, ally, 0, 2)
  placeUnit(battle, troll, 6, 2)

  // Case A: Unburned/unpoisoned troll starts turn -> heals +8 HP
  troll.hp = 60
  troll.burnTurns = 0
  troll.poisonStacks = 0
  troll.ct = 100
  ally.ct = 0
  battle.phase = 'player'
  battle.activeUnitUid = ally.uid
  endPlayerTurn(state)
  assert.equal(battle.activeUnitUid, troll.uid)
  assert.equal(troll.hp, 60 + RIVER_TROLL_REGEN_AMOUNT, 'River Troll must heal +8 HP at start of turn')

  // Case B: Burning troll starts turn -> takes burn damage and gets ZERO regen!
  setCell(battle, 6, 2, 'grass')
  troll.hp = 60
  troll.burnTurns = 1
  troll.poisonStacks = 0
  troll.ct = 100
  ally.ct = 0
  battle.phase = 'player'
  battle.activeUnitUid = ally.uid
  battle.floatingNumbers.length = 0
  endPlayerTurn(state)
  assert.equal(battle.activeUnitUid, troll.uid)
  assert.equal(troll.hp, 52, 'Burn deals 8 DMG on flat grass and completely suppresses Troll regen')
  assert.ok(
    battle.floatingNumbers.some(f => f.text === 'REGEN BLOCKED'),
    'Burning River Troll should emit REGEN BLOCKED floating feedback'
  )

  // Case C: Tidal Slam knockback when adjacent to ally (ensure open tile behind ally)
  setCell(battle, 5, 2, 'grass')
  setCell(battle, 6, 2, 'grass')
  setCell(battle, 7, 2, 'grass')
  placeUnit(battle, ally, 6, 2)
  placeUnit(battle, troll, 7, 2)
  ally.hp = 200
  ally.maxHp = 200
  troll.cooldowns = [0, 0, 0]
  troll.burnTurns = 0
  stepEnemyTurnToCompletion(state, troll)
  assert.equal(ally.col, 5, 'River Troll Tidal Slam must knock ally back 1 tile away from (7,2) to (5,2)')
  assert.ok(ally.hp < 200, 'Tidal Slam must deal damage')
  assert.ok(troll.cooldowns[0] > 0, 'Tidal Slam must enter cooldown')
})

// ============================================================================
// 4. Ember Pyromancer (Burn + Elemental Combos) & Ice Wraith (Slow + evadeZoc)
// ============================================================================

test('Ember Pyromancer applies Burn and detonates Wave 4 Elemental Combos (Shatter / Wildfire)', () => {
  const state = createInitialState(606)
  const battle = startStageBattle(state, 'obsidian_gate')
  clearFlatBoard(battle)

  const pyro = battle.units.find(u => u.enemyId === 'ember_pyromancer')!
  assert.ok(pyro, 'Obsidian Gate should spawn an Ember Pyromancer')
  assert.equal(hasZoneOfControl(pyro), false, 'Ember Pyromancer must not project ZoC')

  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== pyro.uid) { u.alive = false; u.hp = 0 }
  }
  const ally = battle.units.find(u => u.team === 'ally' && u.alive)!
  for (const u of battle.units) {
    if (u.team === 'ally' && u.uid !== ally.uid) { u.alive = false; u.hp = 0 }
  }

  ally.hp = 220
  ally.maxHp = 220
  ally.shield = 0
  ally.slowTurns = 2 // Chilled! Fire should trigger SHATTER combo!
  placeUnit(battle, ally, 2, 2)
  placeUnit(battle, pyro, 5, 2) // range 3

  pyro.cooldowns = [0, 0, 0]
  state.vfx.length = 0
  stepEnemyTurnToCompletion(state, pyro)

  assert.ok(ally.burnTurns >= 1, 'Cinder Nova must inflict Burn')
  assert.equal(ally.slowTurns, 0, 'Fire Cinder Nova hitting Slowed ally must consume Slow via Shatter combo')
  assert.ok(
    state.vfx.some(v => v.kind === 'combo' && v.combo === 'shatter'),
    'Ember Pyromancer fire skill must emit a Shatter elemental combo VFX event'
  )
  assert.ok(pyro.cooldowns[0] > 0, 'Cinder Nova must set cooldown')

  // Basic attack while Cinder Nova is on cooldown still applies Burn + triggers Wildfire on tall grass!
  setCell(battle, 2, 2, 'tall_grass')
  setCell(battle, 2, 3, 'tall_grass')
  ally.burnTurns = 0
  ally.slowTurns = 0
  pyro.cooldowns = [2, 0, 0]
  state.vfx.length = 0
  stepEnemyTurnToCompletion(state, pyro)
  assert.ok(ally.burnTurns >= 1, 'Pyromancer basic Ember Bolt must apply Burn')
  assert.ok(
    state.vfx.some(v => v.kind === 'combo' && v.combo === 'wildfire'),
    'Pyromancer fire basic attack on tall_grass must trigger Wildfire combo'
  )
})

test('Ice Wraith evades ZoC without provoking Opportunity Attacks, inflicts Slow, and deals bonus damage to Chilled targets', () => {
  const state = createInitialState(707)
  const battle = startStageBattle(state, 'frostspire_pass')
  clearFlatBoard(battle)

  const wraith = battle.units.find(u => u.enemyId === 'ice_wraith')!
  assert.ok(wraith, 'Frostspire Pass should spawn an Ice Wraith')
  assert.equal(hasZoneOfControl(wraith), false, 'Ice Wraith must not project ZoC')
  assert.equal(canEvadeZoneOfControl(wraith), true, 'Ice Wraith must have evadeZoc')

  // Verify ZoC evasion: moving out of an adjacent Knight's ZoC provokes 0 opportunity attacks
  const knight = battle.units.find(u => u.team === 'ally' && u.alive && u.heroId === 'knight')
    ?? battle.units.find(u => u.team === 'ally' && u.alive)!
  placeUnit(battle, knight, 3, 2)
  placeUnit(battle, wraith, 4, 2)
  const oaPreview = previewPathOpportunityAttacks(battle, wraith, [{ col: 5, row: 2 }, { col: 6, row: 2 }])
  assert.equal(oaPreview.triggers.length, 0, 'Ice Wraith must slip past enemy ZoC with 0 Opportunity Attacks')

  // Verify Chilled bonus damage multiplier
  assert.equal(
    computeEnemyArchetypeDamageMul(wraith, { slowTurns: 0, burnTurns: 0, poisonStacks: 0 }),
    1.0
  )
  assert.equal(
    computeEnemyArchetypeDamageMul(wraith, { slowTurns: 2, burnTurns: 0, poisonStacks: 0 }),
    ICE_WRAITH_CHILLED_BONUS_MUL
  )
  assert.deepEqual(getEnemyBasicAttackStatus('ice_wraith'), { status: 'slow' })

  // Verify live attack applies Slow and triggers Frostbite bonus on follow-up hit
  for (const u of battle.units) {
    if (u.team === 'enemy' && u.uid !== wraith.uid) { u.alive = false; u.hp = 0 }
    if (u.team === 'ally' && u.uid !== knight.uid) { u.alive = false; u.hp = 0 }
  }
  knight.hp = 200
  knight.maxHp = 200
  knight.shield = 0
  knight.slowTurns = 0
  placeUnit(battle, knight, 3, 2)
  placeUnit(battle, wraith, 5, 2) // range 2

  stepEnemyTurnToCompletion(state, wraith)
  const dmgNormal = 200 - knight.hp
  assert.ok(dmgNormal > 0, 'Ice Wraith should damage target')
  assert.ok(knight.slowTurns >= 1, 'Ice Wraith basic attack must inflict Slow')

  // Second hit against the now-Slowed target deals higher Frostbite damage
  knight.hp = 200
  knight.slowTurns = 2
  placeUnit(battle, wraith, 5, 2)
  stepEnemyTurnToCompletion(state, wraith)
  const dmgChilled = 200 - knight.hp
  assert.ok(dmgChilled > dmgNormal, `Chilled target should take bonus Frostbite damage (${dmgChilled} > ${dmgNormal})`)
})

// ============================================================================
// 5. Regional Mini-Bosses & Dynamic Summon Scene Rendering Safety
// ============================================================================

test('regional mini-bosses spawn in Special/Elite nodes, trigger distinct specials, and scene renders dynamic summons safely', () => {
  const expectedMiniBossStages: readonly [string, EnemyArchetypeId, string][] = [
    ['briar_hollow', 'briar_warlord', 'warlord_slam'],
    ['sunwell_glade', 'mire_matriarch', 'mire_miasma'],
    ['whispering_barrow', 'ash_inquisitor', 'ash_nova'],
    ['glacial_citadel', 'frost_jarl', 'frost_breath'],
    ['ashfall_foundry', 'magma_warden', 'magma_slam']
  ]

  for (const [stageId, bossId, expectedMove] of expectedMiniBossStages) {
    const state = createInitialState(808)
    const battle = startStageBattle(state, stageId)
    const boss = battle.units.find(u => u.enemyId === bossId)
    assert.ok(boss, `${stageId} must spawn regional mini-boss ${bossId}`)
    assert.equal(boss.isBoss, true, `${bossId} unit must have isBoss: true`)

    boss.cooldowns = [0, 0, 0]
    const decision = chooseEnemySpecialMove(battle, boss)
    assert.ok(decision, `${bossId} must have a signature special move`)
    assert.equal(decision.move, expectedMove)

    // Render with scene + dynamically raise a Bone Thrall mid-battle to verify zero crashes/leaks
    const fake = fakeRenderer()
    const scene = createCrownshardScene(fake.renderer)
    scene.render(state, 1 / 60, 1280, 720)
    const summoned = createSummonedEnemyUnit(battle, boss, 'bone_thrall', 0, 0)
    battle.units.push(summoned)
    for (let f = 0; f < 10; f++) {
      stepGame(state, 1 / 60)
      scene.render(state, 1 / 60, 1280, 720)
    }
    // Kill the summoned unit and render its full death sink
    summoned.hp = 0
    summoned.alive = false
    for (let f = 0; f < 90; f++) {
      stepGame(state, 1 / 60)
      scene.render(state, 1 / 60, 1280, 720)
    }
    assert.ok(fake.drawn >= 100)
  }
})

// ============================================================================
// 6. Chapter 1 Safety & Playable Chapter Reachability / Spawn Integrity
// ============================================================================

test('Chapter 1 border_watch stays intact and every playable chapter spawns valid, non-overlapping, jump-reachable units', () => {
  // Chapter 1 starter contract must remain intact
  const ch1 = CHAPTER_BY_ID.border_watch
  assert.equal(ch1.index, 0)
  assert.deepEqual(
    ch1.enemies.map(e => ({ id: e.id, col: e.col, row: e.row })),
    [
      { id: 'goblin', col: 6, row: 2 },
      { id: 'goblin', col: 7, row: 4 },
      { id: 'bone_archer', col: 8, row: 1 }
    ]
  )

  for (const ch of PLAYABLE_CHAPTERS) {
    const state = createInitialState(909 + ch.index)
    const battle = startStageBattle(state, ch.id)

    const occupied = new Set<string>()
    for (const u of battle.units) {
      assert.ok(
        u.col >= 0 && u.col < battle.cols && u.row >= 0 && u.row < battle.rows,
        `${ch.id}: unit ${u.uid} out of bounds (${u.col},${u.row})`
      )
      const cell = battle.cells[u.row][u.col]
      assert.equal(
        cell.walkable && terrainWalkable(cell.terrain),
        true,
        `${ch.id}: unit ${u.uid} spawned on non-walkable tile ${cell.terrain} at (${u.col},${u.row})`
      )
      const key = `${u.col},${u.row}`
      assert.equal(occupied.has(key), false, `${ch.id}: overlapping unit spawn at (${key})`)
      occupied.add(key)
    }

    // BFS jump-connected reachability (jump >= 1, ignoring destructible barricades as traversable once broken)
    const allies = battle.units.filter(u => u.team === 'ally')
    const enemies = battle.units.filter(u => u.team === 'enemy')
    assert.ok(allies.length > 0 && enemies.length > 0, `${ch.id} must have allies and enemies`)

    const visited = new Set<string>()
    const queue: { col: number; row: number }[] = []
    for (const a of allies) {
      const k = `${a.col},${a.row}`
      visited.add(k)
      queue.push({ col: a.col, row: a.row })
    }
    while (queue.length > 0) {
      const cur = queue.shift()!
      const curH = cellHeightLevel(battle.cells[cur.row][cur.col])
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = cur.col + dc
        const nr = cur.row + dr
        if (nc < 0 || nc >= battle.cols || nr < 0 || nr >= battle.rows) continue
        const key = `${nc},${nr}`
        if (visited.has(key)) continue
        const nCell = battle.cells[nr][nc]
        const passable = nCell.walkable || nCell.terrain === 'barricade'
        if (!passable) continue
        const nextH = cellHeightLevel(nCell)
        if (Math.abs(nextH - curH) > 2) continue
        visited.add(key)
        queue.push({ col: nc, row: nr })
      }
    }

    for (const e of enemies) {
      assert.equal(
        visited.has(`${e.col},${e.row}`),
        true,
        `${ch.id}: enemy ${e.uid} (${e.enemyId}) at (${e.col},${e.row}) must be jump-reachable from hero spawns`
      )
    }
  }
})
